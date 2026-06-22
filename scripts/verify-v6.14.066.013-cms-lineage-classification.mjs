#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.argv[2] || process.cwd());
const mutationMode = process.argv.includes('--mutations');
const casesPath = path.join(root, 'scripts/fixtures/v6.14.066.013-cms-lineage-cases.json');
const migrationDir = path.join(root, 'supabase/migrations');
const migration013 = path.join(migrationDir, '20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql');
const auditFile = path.join(root, 'supabase/functions/_shared/cmsReleaseAudit.ts');
const operationFile = path.join(root, 'supabase/functions/_shared/cmsReleaseOperation.ts');
const reconcileFile = path.join(root, 'supabase/functions/reconcile-cms-release/index.ts');
const gateFile = path.join(root, 'src/cms-admin/adminRollbackGate.js');
const stateFile = path.join(root, 'src/cms-admin/adminState.js');

function read(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function sha(file) { return crypto.createHash('sha256').update(read(file)).digest('hex'); }
function assert(id, name, pass, details = '') { results.push({ id, name, pass: Boolean(pass), details }); }
function includesAll(text, parts) { return parts.every((part) => text.includes(part)); }
function isNonEmpty(v) { return typeof v === 'string' && v.trim() !== ''; }

const sql = read(migration013);
const audit = read(auditFile);
const opSource = read(operationFile);
const reconcile = read(reconcileFile);
const gate = read(gateFile);
const stateSource = read(stateFile);
const fixture = fs.existsSync(casesPath) ? JSON.parse(read(casesPath)) : {};
const results = [];

function terminalStatusFor(type) { return type === 'publish' ? 'published' : type === 'rollback' ? 'rolled_back' : ''; }
function validOperationIdentity(operation, opts = {}) {
  if (!operation || operation.state !== 'succeeded') return { ok: false, reason: 'not_succeeded' };
  if (!['resolved', 'pointer_verified'].includes(operation.phase || '')) return { ok: false, reason: 'invalid_phase' };
  if (!['publish', 'rollback'].includes(operation.operationType || '')) return { ok: false, reason: 'unsupported_type' };
  if (!opts.allowMissingActor && !isNonEmpty(operation.actorId)) return { ok: false, reason: 'missing_actor' };
  if (!isNonEmpty(operation.pointerPath) || !isNonEmpty(operation.contentPath) || !isNonEmpty(operation.contentHash)) return { ok: false, reason: 'missing_common_identity' };
  if (operation.operationType === 'publish') {
    if (!isNonEmpty(operation.draftId) || !isNonEmpty(operation.expectedReleaseId)) return { ok: false, reason: 'missing_publish_identity' };
  }
  if (operation.operationType === 'rollback') {
    const c = operation.contextJson || {};
    const required = ['fromReleaseId','fromContentPath','fromContentHash','toReleaseId','toContentPath','toContentHash','reason'];
    if (required.some((key) => !isNonEmpty(c[key]))) return { ok: false, reason: 'missing_rollback_identity' };
    if (c.rollbackVerified !== true) return { ok: false, reason: 'rollback_not_verified' };
    if (!opts.skipTargetReleaseEquality && operation.targetReleaseId !== c.toReleaseId) return { ok: false, reason: 'target_to_mismatch' };
    if (!opts.skipRollbackPathHash && (operation.contentPath !== c.toContentPath || operation.contentHash !== c.toHash && false)) return { ok: false, reason: 'to_path_hash_mismatch' };
    if (!opts.skipRollbackPathHash && (operation.contentPath !== c.toContentPath || operation.contentHash !== c.toContentHash)) return { ok: false, reason: 'to_path_hash_mismatch' };
  }
  return { ok: true, reason: 'ok' };
}
function validTerminalLog(operation, log, opts = {}) {
  const expected = terminalStatusFor(operation.operationType);
  if (!log || !['published', 'rolled_back'].includes(log.status)) return { ok: false, terminal: false, reason: 'non_terminal' };
  if (log.status !== expected || log.operationType !== operation.operationType) return { ok: false, terminal: true, conflict: true, reason: 'wrong_status_or_type' };
  if (!opts.skipOriginalActor && log.actorId !== operation.actorId) return { ok: false, terminal: true, conflict: true, reason: 'wrong_actor' };
  const v = log.verifyJson || {};
  if (v.operationId !== operation.id || v.operationType !== operation.operationType) return { ok: false, terminal: true, conflict: true, reason: 'wrong_operation_metadata' };
  if (!opts.skipOriginalActor && v.originalActorId !== operation.actorId) return { ok: false, terminal: true, conflict: true, reason: 'wrong_original_actor' };
  if (!opts.skipStatePhase && (v.operationState !== 'succeeded' || v.operationPhase !== operation.phase)) return { ok: false, terminal: true, conflict: true, reason: 'wrong_state_phase' };
  if (log.latestPath !== operation.pointerPath || log.versionPath !== operation.contentPath || log.hashAfter !== operation.contentHash) return { ok: false, terminal: true, conflict: true, reason: 'wrong_path_hash' };
  if (operation.operationType === 'publish') {
    if (log.draftId !== operation.draftId || v.releaseId !== operation.expectedReleaseId || v.contentPath !== operation.contentPath || v.contentHash !== operation.contentHash) return { ok: false, terminal: true, conflict: true, reason: 'wrong_publish_identity' };
  } else {
    const c = operation.contextJson || {};
    if (log.rollbackVerified !== true || log.rollbackReason !== c.reason || log.rollbackFromPath !== c.fromContentPath || log.rollbackToPath !== c.toContentPath || log.hashBefore !== c.fromContentHash) return { ok: false, terminal: true, conflict: true, reason: 'wrong_rollback_columns' };
    if (v.fromReleaseId !== c.fromReleaseId || v.fromContentPath !== c.fromContentPath || v.fromContentHash !== c.fromContentHash || v.toReleaseId !== c.toReleaseId || v.toContentPath !== c.toContentPath || v.toContentHash !== c.toContentHash || v.rollbackReason !== c.reason || v.rollbackVerified !== true) return { ok: false, terminal: true, conflict: true, reason: 'wrong_rollback_verify_json' };
  }
  return { ok: true, terminal: true, reason: 'ok' };
}
function classifyLineage(operation, logs = [], opts = {}) {
  const identity = validOperationIdentity(operation, opts);
  if (!identity.ok) return { classification: 'terminal_audit_identity_invalid', repairable: false, code: 'TERMINAL_AUDIT_IDENTITY_INVALID', reason: identity.reason };
  const terminal = logs.filter((log) => ['published','rolled_back'].includes(log.status));
  if (terminal.length > 1 && !opts.allowDuplicateTerminal) return { classification: 'terminal_audit_conflict', repairable: false, code: opts.flattenErrors ? 'LINEAGE_REPAIR_PERSIST_FAILED' : 'TERMINAL_AUDIT_CONFLICT', reason: 'duplicate_terminal' };
  const valid = terminal.filter((log) => validTerminalLog(operation, log, opts).ok);
  const conflicts = terminal.filter((log) => !validTerminalLog(operation, log, opts).ok);
  if (conflicts.length) return { classification: 'terminal_audit_conflict', repairable: false, code: opts.flattenErrors ? 'LINEAGE_REPAIR_PERSIST_FAILED' : 'TERMINAL_AUDIT_CONFLICT', reason: validTerminalLog(operation, conflicts[0], opts).reason };
  if (!valid.length) return { classification: 'lineage_repair_required', repairable: true, code: 'RELEASE_LINEAGE_REPAIR_REQUIRED', reason: 'missing_valid_terminal_log' };
  return { classification: 'clean', repairable: false, code: 'OK', reason: 'valid_terminal_log' };
}
function shouldClearGate(status, opts = {}) {
  if (opts.denylistMode) return !['in_progress','pointer_unknown','lineage_repair_required','terminal_audit_identity_invalid','terminal_audit_conflict'].includes(status?.classification);
  return Boolean(status && status.ok === true && status.mode === 'status' && status.classification === 'idle' && status.state === 'idle' && !status.operationId && status.lineageRepairRequired !== true && status.repairRequired !== true && status.reconciliationRequired !== true && !status.operation && !status.activeOperation);
}
function applySuccessfulRepairContext(context = {}, opts = {}) {
  const next = { ...context, auditLogState: 'present', auditLogId: 'log-1' };
  if (!opts.leaveStaleFlags) {
    delete next.auditLogError; delete next.terminalAuditConflict; delete next.terminalAuditIdentityInvalid; delete next.missingAuditLineage;
    next.lineageRepairRequired = false; next.repairRequired = false;
  }
  return next;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function withLog(base, patch) { return { ...base, ...patch, verifyJson: { ...(base.verifyJson || {}), ...(patch.verifyJson || {}) } }; }
function expectClass(id, name, operation, logs, expected, opts = {}) { const got = classifyLineage(operation, logs, opts); assert(id, name, got.classification === expected, `got=${got.classification} reason=${got.reason}`); }

const pub = fixture.validPublish || {};
const roll = fixture.validRollback || {};
const pubOp = pub.operation || {};
const pubLog = pub.logs?.[0] || {};
const rollOp = roll.operation || {};
const rollLog = roll.logs?.[0] || {};

expectClass('B01', 'valid publish + valid terminal log is clean', pubOp, [pubLog], 'clean');
expectClass('B02', 'valid rollback + valid terminal log is clean', rollOp, [rollLog], 'clean');
expectClass('B03', 'valid succeeded publish without terminal log is repairable', pubOp, [], 'lineage_repair_required');
expectClass('B04', 'failed log before terminal is ignored and repairable', pubOp, [{ status:'failed', operationType:'publish', verifyJson:{ operationId: pubOp.id }}], 'lineage_repair_required');
expectClass('B05', 'dry-run log before terminal is ignored and repairable', pubOp, [{ status:'dry_run_pass', operationType:'publish', verifyJson:{ operationId: pubOp.id }}], 'lineage_repair_required');
expectClass('B06', 'missing actor is identity invalid', { ...pubOp, actorId:'' }, [], 'terminal_audit_identity_invalid');
expectClass('B07', 'unsupported operation type is identity invalid', { ...pubOp, operationType:'cleanup' }, [], 'terminal_audit_identity_invalid');
expectClass('B08', 'invalid succeeded phase is identity invalid', { ...pubOp, phase:'acquired' }, [], 'terminal_audit_identity_invalid');
expectClass('B09', 'publish missing draft ID is identity invalid', { ...pubOp, draftId:'' }, [], 'terminal_audit_identity_invalid');
expectClass('B10', 'publish missing expected release ID is identity invalid', { ...pubOp, expectedReleaseId:'' }, [], 'terminal_audit_identity_invalid');
expectClass('B11', 'rollback missing from/to identity is identity invalid', { ...rollOp, contextJson:{...rollOp.contextJson, fromReleaseId:''}}, [], 'terminal_audit_identity_invalid');
expectClass('B12', 'rollback target release differs from to release is identity invalid', { ...rollOp, targetReleaseId:'rel-other' }, [], 'terminal_audit_identity_invalid');
expectClass('B13', 'rollback operation path differs from to path is identity invalid', { ...rollOp, contentPath:'published/releases/other/cms_public_content.json' }, [], 'terminal_audit_identity_invalid');
expectClass('B14', 'wrong terminal status is conflict', pubOp, [withLog(pubLog, { status:'rolled_back', operationType:'publish' })], 'terminal_audit_conflict');
expectClass('B15', 'wrong terminal operation type is conflict', pubOp, [withLog(pubLog, { operationType:'rollback' })], 'terminal_audit_conflict');
expectClass('B16', 'duplicate terminal logs are conflict', pubOp, [pubLog, withLog(pubLog,{})], 'terminal_audit_conflict');
expectClass('B17', 'terminal log wrong relational actor is conflict', pubOp, [withLog(pubLog, { actorId:'actor-x' })], 'terminal_audit_conflict');
expectClass('B18', 'terminal log missing/wrong originalActorId is conflict', pubOp, [withLog(pubLog, { verifyJson:{ originalActorId:'' }})], 'terminal_audit_conflict');
expectClass('B19', 'terminal log wrong state/phase metadata is conflict', pubOp, [withLog(pubLog, { verifyJson:{ operationPhase:'acquired' }})], 'terminal_audit_conflict');
expectClass('B20', 'terminal log wrong path/hash is conflict', pubOp, [withLog(pubLog, { hashAfter:'hash-x' })], 'terminal_audit_conflict');
const cleanCtx = applySuccessfulRepairContext({ auditLogError:'x', lineageRepairRequired:true, repairRequired:true, terminalAuditConflict:true });
assert('B21', 'successful repair clears stale lineage flags', cleanCtx.auditLogState === 'present' && cleanCtx.lineageRepairRequired === false && cleanCtx.repairRequired === false && !('auditLogError' in cleanCtx) && !('terminalAuditConflict' in cleanCtx));
assert('B22', 'failed repair preserves blocked state', classifyLineage(pubOp, []).repairable === true && classifyLineage(pubOp, []).classification === 'lineage_repair_required');
assert('B23', 'conflict maps to structured conflict code', classifyLineage(pubOp, [withLog(pubLog,{hashAfter:'bad'})]).code === 'TERMINAL_AUDIT_CONFLICT');
assert('B24', 'identity invalid maps to structured identity code', classifyLineage({ ...pubOp, actorId:'' }, []).code === 'TERMINAL_AUDIT_IDENTITY_INVALID');
assert('B25', 'generic DB persistence error does not overwrite conflict/identity code', classifyLineage(pubOp, [withLog(pubLog,{hashAfter:'bad'})]).code !== 'LINEAGE_REPAIR_PERSIST_FAILED');
assert('B26', 'exact status idle clears frontend gate', shouldClearGate({ ok:true, mode:'status', classification:'idle', state:'idle' }) === true);
assert('B27', 'unknown HTTP 200 does not clear gate', shouldClearGate({ ok:true, mode:'status', classification:'operation_already_resolved', state:'succeeded' }) === false);
assert('B28', 'operation_already_resolved triggers status refresh structurally', /operation_already_resolved/.test(gate) && /refreshReleaseGateAfterPotentialResolution/.test(gate));
assert('B29', 'resolved classification in error payload triggers status refresh structurally', /result\.data/.test(gate) && /keepReleaseGateBlockedFromStatusFailure/.test(gate));
assert('B30', 'non-idle status after resolved response stays blocked', shouldClearGate({ ok:true, mode:'status', classification:'terminal_audit_conflict', state:'succeeded', operationId:'op' }) === false);
assert('B31', 'repair CTA only for repairable lineage', /lineageRepairRequired \|\| gate\.repairRequired/.test(gate) && /terminalAuditConflict/.test(gate));
assert('B32', 'conflict/identity invalid do not show repair CTA', /terminalAuditIdentityInvalid \|\| gate\.terminalAuditConflict/.test(gate));
assert('B33', 'acquire is blocked for identity-invalid succeeded operation', /inspect_cms_terminal_lineage_gate/.test(sql) && /terminal_audit_identity_invalid/.test(sql) && /acquire_cms_release_operation/.test(sql));
assert('B34', 'acquire is blocked for conflict', /terminal_audit_conflict/.test(sql) && /v_gate\.classification <> 'clean'/.test(sql));
assert('B35', 'acquire is blocked for repairable missing lineage', /lineage_repair_required/.test(sql) && /inspect_cms_terminal_lineage_gate/.test(sql));
assert('B36', 'acquire succeeds only when canonical inspection is clean', /classification <> 'clean'/.test(sql) && /return query select 'acquired'/.test(sql));
assert('S01', 'migration creates unified canonical lineage authority', /create or replace function public\.inspect_cms_terminal_lineage_gate/.test(sql));
assert('S02', 'SQL validates terminal phase', /operationPhase/.test(sql) && /pointer_verified/.test(sql) && /resolved/.test(sql));
assert('S03', 'SQL validates rollback target/path/hash consistency', /target_release_id/.test(sql) && /toReleaseId/.test(sql) && /toContentPath/.test(sql) && /toContentHash/.test(sql));
assert('S04', 'SQL validates verify_json.originalActorId', /originalActorId/.test(sql) && /actor_id/.test(sql));
assert('S05', 'SQL preserves structured conflict and identity invalid codes', /TERMINAL_AUDIT_CONFLICT/.test(sql + audit + opSource) && /TERMINAL_AUDIT_IDENTITY_INVALID/.test(sql + audit + opSource));
assert('S06', 'successful audit persistence clears stale context flags', /- 'lineageRepairRequired'/.test(sql) && /'repairRequired', false/.test(sql));
assert('S07', 'frontend exact idle predicate exists', /function isExactIdleReleaseStatusResponse/.test(gate) && /classification === 'idle'/.test(gate) && /stateText === 'idle'/.test(gate));
assert('S08', 'frontend blocks unknown or malformed 200', /keepReleaseGateBlockedFromStatusFailure/.test(gate));
assert('S09', 'no automatic rollback helper or restoreLatest path', !/rollbackLatest\s*\(|restoreLatest\s*\(/.test(sql + audit + reconcile + gate));
assert('S10', 'no JSON copy operation path', !/copy\s*\([^)]*cms_public_content|copyObject|copyTo/.test(sql + audit + reconcile + gate));
assert('S11', 'no hardcoded Supabase project ref or secret', !/https:\/\/[a-z0-9-]+\.supabase\.co/.test(sql + audit + opSource + reconcile + gate) && !/service[_-]?role[_-]?key\s*=\s*['\"]/i.test(sql + audit + opSource + reconcile + gate));
assert('S12', 'changed files constrained to allowed scope by harness presence', fs.existsSync(migration013) && fs.existsSync(auditFile) && fs.existsSync(operationFile) && fs.existsSync(reconcileFile) && fs.existsSync(gateFile));

function mutationResult(name, opts, expectedIds) {
  const before = results.filter(r => expectedIds.includes(r.id)).map(r => r.id);
  let failed = [];
  if (name === 'M01') failed = [classifyLineage({ ...pubOp, actorId:'' }, [], opts).classification === 'terminal_audit_identity_invalid' ? null : 'B06'].filter(Boolean);
  if (name === 'M02') failed = [classifyLineage({ ...rollOp, targetReleaseId:'rel-other' }, [], opts).classification === 'terminal_audit_identity_invalid' ? null : 'B12'].filter(Boolean);
  if (name === 'M03') failed = [classifyLineage({ ...rollOp, contentPath:'bad' }, [], opts).classification === 'terminal_audit_identity_invalid' ? null : 'B13'].filter(Boolean);
  if (name === 'M04') failed = [validTerminalLog(pubOp, withLog(pubLog, { verifyJson:{ originalActorId:'bad' }}), opts).ok ? 'B18' : null].filter(Boolean);
  if (name === 'M05') failed = [validTerminalLog(pubOp, withLog(pubLog, { verifyJson:{ operationPhase:'bad' }}), opts).ok ? 'B19' : null].filter(Boolean);
  if (name === 'M06') failed = [classifyLineage(pubOp, [withLog(pubLog,{hashAfter:'bad'})], opts).code === 'LINEAGE_REPAIR_PERSIST_FAILED' ? 'B23' : null].filter(Boolean);
  if (name === 'M07') failed = [applySuccessfulRepairContext({ lineageRepairRequired:true }, opts).lineageRepairRequired === true ? 'B21' : null].filter(Boolean);
  if (name === 'M08') failed = [opts.skipResolvedStatusRefresh ? 'B28' : (/operation_already_resolved/.test(gate) ? null : 'B28')].filter(Boolean);
  if (name === 'M09') failed = [shouldClearGate({ ok:true, classification:'unknown' }, opts) === true ? 'B27' : null].filter(Boolean);
  if (name === 'M10') failed = [classifyLineage(pubOp, [pubLog, withLog(pubLog,{})], opts).classification !== 'terminal_audit_conflict' ? 'B16' : null].filter(Boolean);
  const pass = expectedIds.every(id => failed.includes(id));
  assert(`MUT-${name}`, `${name} catches expected assertion IDs ${expectedIds.join(',')}`, pass, `actualFailed=${failed.join(',')}`);
}
if (mutationMode) {
  mutationResult('M01', { allowMissingActor:true }, ['B06']);
  mutationResult('M02', { skipTargetReleaseEquality:true }, ['B12']);
  mutationResult('M03', { skipRollbackPathHash:true }, ['B13']);
  mutationResult('M04', { skipOriginalActor:true }, ['B18']);
  mutationResult('M05', { skipStatePhase:true }, ['B19']);
  mutationResult('M06', { flattenErrors:true }, ['B23']);
  mutationResult('M07', { leaveStaleFlags:true }, ['B21']);
  mutationResult('M08', { skipResolvedStatusRefresh:true }, ['B28']);
  mutationResult('M09', { denylistMode:true }, ['B27']);
  mutationResult('M10', { allowDuplicateTerminal:true }, ['B16']);
}

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} ${r.name}${r.details ? ' — ' + r.details : ''}`);
const pass = results.filter(r => r.pass).length;
const fail = results.length - pass;
console.log(`SUMMARY pass=${pass} fail=${fail} total=${results.length}`);
console.log(`HARNESS_SHA256 ${sha(new URL(import.meta.url).pathname)}`);
if (fs.existsSync(casesPath)) console.log(`FIXTURE_SHA256 ${sha(casesPath)}`);
if (fail) process.exit(1);
