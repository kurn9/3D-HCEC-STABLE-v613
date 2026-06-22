#!/usr/bin/env node
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const root = resolve(process.argv.find((arg) => !arg.startsWith('--') && arg !== process.argv[0] && arg !== process.argv[1]) || process.cwd());
const runMutations = process.argv.includes('--mutations');
const migration = 'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql';
const fixturePath = 'scripts/fixtures/v6.14.066.015-cms-lineage-cases.json';

function text(path) {
  try { return readFileSync(join(root, path), 'utf8'); } catch { return ''; }
}
function sha256(s) { return createHash('sha256').update(s).digest('hex'); }
function countOccurrences(s, needle) { return String(s).split(needle).length - 1; }
function assert(id, name, pass, detail = '') { return { id, name, pass: Boolean(pass), detail }; }
function latestMigrationSql(base = root) {
  try { return readFileSync(join(base, migration), 'utf8'); } catch { return ''; }
}
function fixedAssertions(base = root) {
  const sql = latestMigrationSql(base);
  const state = readFileSync(join(base, 'src/cms-admin/adminState.js'), 'utf8');
  const gate = readFileSync(join(base, 'src/cms-admin/adminRollbackGate.js'), 'utf8');
  const audit = readFileSync(join(base, 'supabase/functions/_shared/cmsReleaseAudit.ts'), 'utf8');
  const fixtureRaw = readFileSync(join(base, fixturePath), 'utf8');
  const fixture = JSON.parse(fixtureRaw);
  const results = [];
  results.push(assert('A01', 'v6.14.066.015 migration exists', Boolean(sql), 'migration must exist'));
  results.push(assert('A02', 'acquire RPC is recreated by exact DROP + CREATE, not incompatible CREATE OR REPLACE', /drop function if exists public\.acquire_cms_release_operation\(jsonb\);[\s\S]*create function public\.acquire_cms_release_operation\(p_operation jsonb\)/.test(sql) && !/create or replace function public\.acquire_cms_release_operation\(p_operation jsonb\)/.test(sql)));
  results.push(assert('A03', 'terminal audit RPC is recreated by exact DROP + CREATE, not incompatible CREATE OR REPLACE', /drop function if exists public\.ensure_cms_terminal_operation_audit\(uuid, text, jsonb, jsonb\);[\s\S]*create function public\.ensure_cms_terminal_operation_audit\(/.test(sql) && !/create or replace function public\.ensure_cms_terminal_operation_audit\(/.test(sql)));
  results.push(assert('A04', 'service-role grants preserved for recreated RPCs', /grant execute on function public\.acquire_cms_release_operation\(jsonb\) to service_role;/.test(sql) && /grant execute on function public\.ensure_cms_terminal_operation_audit\(uuid, text, jsonb, jsonb\) to service_role;/.test(sql)));
  results.push(assert('A05', 'legacy publish logs may omit verify_json.draftId only when relational draft matches', countOccurrences(sql, "not (coalesce(terminal_log.verify_json, '{}'::jsonb) ? 'draftId')") >= 2 && /terminal_log\.draft_id = v_op\.draft_id/.test(sql)));
  results.push(assert('A06', 'explicit verify_json.draftId is still validated when present', /terminal_log\.verify_json ->> 'draftId' = v_op\.draft_id::text/.test(sql) && !/or true\s*(?:\)|$)/.test(sql)));
  results.push(assert('A07', 'global severity ranks identity-invalid before conflict before repairable', /when 'terminal_audit_identity_invalid' then 2[\s\S]*when 'terminal_audit_conflict' then 3[\s\S]*when 'lineage_repair_required' then 4/.test(sql)));
  results.push(assert('A08', 'full-history selection is severity-ranked, not first chronological blocker', /v_best_rank/.test(sql) && /if v_rank < v_best_rank then/.test(sql) && !/if coalesce\(v_class\.classification, 'clean'\) <> 'clean' then\s*return query select v_class\.classification/.test(sql)));
  results.push(assert('A09', 'terminal audit insert preserves p_log_payload.published_version', /nullif\(p_log_payload ->> 'published_version', ''\)/.test(sql)));
  results.push(assert('A10', 'terminal audit insert preserves p_log_payload.backup_path', /nullif\(p_log_payload ->> 'backup_path', ''\)/.test(sql)));
  results.push(assert('A11', 'unique conflict path reclassifies existing log before reuse', /terminal audit conflict after unique conflict/.test(sql) && /from public\.classify_cms_terminal_lineage_operation\(v_op\.id\)/.test(sql)));
  results.push(assert('A12', 'resolved HTTP error branch triggers fresh status before clearing gate', /function isResolvedCapableReleaseResponse/.test(gate) && /if \(result\.error\) \{[\s\S]*if \(isResolvedCapableReleaseResponse\(data\)\) \{[\s\S]*refreshReleaseGateAfterPotentialResolution/.test(gate)));
  results.push(assert('A13', 'single canonical exact-idle reset helper exists in state', /export function clearReleaseOperationGateFromExactIdle/.test(state) && /createEmptyReleaseOperationGateState\(\)/.test(state)));
  results.push(assert('A14', 'repair flow uses canonical exact-idle reset helper', /handleRepairReleaseLineage[\s\S]*clearReleaseOperationGateFromExactIdle\(statusData \|\| repairData \|\| null\)/.test(gate)));
  results.push(assert('A15', 'exact idle reset clears conflict and identity-invalid flags', /terminalAuditIdentityInvalid: false/.test(state) && /terminalAuditConflict: false/.test(state) && /classification: 'idle'/.test(state)));
  results.push(assert('A16', 'mutation runner rejects unexpected assertion failures', /unexpectedFailedAssertionIds/.test(readFileSync(join(base, 'scripts/verify-v6.14.066.015-cms-rpc-compatibility-and-lineage.mjs'), 'utf8')) && /unexpectedFailedAssertionIds\.length === 0/.test(readFileSync(join(base, 'scripts/verify-v6.14.066.015-cms-rpc-compatibility-and-lineage.mjs'), 'utf8'))));
  results.push(assert('A17', 'fixture covers legacy draftId compatibility', fixture.cases.some((c) => /legacy publish without/.test(c.name))));
  results.push(assert('A18', 'fixture covers resolved active_other_release HTTP error status refresh', fixture.cases.some((c) => c.expectedStatusRefresh === true)));
  results.push(assert('A19', 'no DROP CASCADE in additive migration', !/drop\s+[^;]*cascade/i.test(sql)));
  results.push(assert('A20', 'audit helper preserves structured conflict and identity-invalid mapping', /TERMINAL_AUDIT_CONFLICT/.test(audit) && /terminal_audit_identity_invalid/.test(audit) && /repairable: false/.test(audit)));
  for (const c of fixture.cases) {
    results.push(assert(`F-${c.id}`, `fixture model ${c.name}`, runFixtureCase(c), JSON.stringify(c)));
  }
  return results;
}
function runFixtureCase(c) {
  if (c.history) return rankClassifications(c.history.map((x) => x.classification)) === c.expected;
  if (c.payload) return c.payload.published_version === c.expectedPublishedVersion && c.payload.backup_path === c.expectedBackupPath;
  if (c.frontend) return frontendBlocked(c.frontend) === c.expectedBlocked;
  if (c.response) return resolvedCapable(c.response.data) === c.expectedStatusRefresh;
  if (c.operation && c.logs) return classifyOperationLog(c.operation, c.logs[0]) === c.expected;
  return false;
}
function rankClassifications(list) {
  const rank = { release_operation_blocked: 1, terminal_audit_identity_invalid: 2, terminal_audit_conflict: 3, lineage_repair_required: 4, clean: 999 };
  return list.slice().sort((a,b) => (rank[a] || 999) - (rank[b] || 999))[0] || 'clean';
}
function classifyOperationLog(op, log) {
  if (!op.actorId || op.state !== 'succeeded' || !['pointer_verified','resolved'].includes(op.phase)) return 'terminal_audit_identity_invalid';
  if (!log) return 'lineage_repair_required';
  if (log.status !== (op.type === 'publish' ? 'published' : 'rolled_back')) return 'terminal_audit_conflict';
  if (log.operationType !== op.type || log.actorId !== op.actorId || log.path !== op.path || log.hash !== op.hash) return 'terminal_audit_conflict';
  if (op.type === 'publish') {
    if (log.draftId !== op.draftId) return 'terminal_audit_conflict';
    if (Object.prototype.hasOwnProperty.call(log.verify || {}, 'draftId') && log.verify.draftId !== op.draftId) return 'terminal_audit_conflict';
    return 'clean';
  }
  return log.rollbackVerified === true ? 'clean' : 'terminal_audit_identity_invalid';
}
function frontendBlocked(data) {
  return !(data.ok === true && data.mode === 'status' && data.classification === 'idle' && data.state === 'idle' && !data.operationId && data.lineageRepairRequired !== true && data.repairRequired !== true && data.terminalAuditConflict !== true && data.terminalAuditIdentityInvalid !== true);
}
function resolvedCapable(data = {}) {
  return ['active_expected_release', 'active_other_release', 'operation_already_resolved', 'operation_already_resolved_non_success', 'lineage_repaired', 'failed_before_pointer', 'resolved_active_other'].includes(String(data.classification || '')) || ['succeeded', 'resolved_active_other', 'failed_before_pointer', 'failed'].includes(String(data.operation?.state || data.state || '')) || data.operationResolved === true;
}

function applyReplacement(base, target, from, to) {
  const path = join(base, target);
  const before = readFileSync(path, 'utf8');
  if (!before.includes(from)) return false;
  writeFileSync(path, before.replace(from, to));
  return true;
}
function mutationSuite() {
  const mutants = [
    { id:'M01', target:migration, from:'drop function if exists public.acquire_cms_release_operation(jsonb);\ncreate function public.acquire_cms_release_operation', to:'-- broken: illegal in-place replacement\ncreate or replace function public.acquire_cms_release_operation', expected:['A02'] },
    { id:'M02', target:migration, from:'grant execute on function public.acquire_cms_release_operation(jsonb) to service_role;', to:'-- grant removed by mutant', expected:['A04'] },
    { id:'M03', target:migration, from:"not (coalesce(terminal_log.verify_json, '{}'::jsonb) ? 'draftId')\n          or terminal_log.verify_json ->> 'draftId' = v_op.draft_id::text", to:"terminal_log.verify_json ->> 'draftId' = v_op.draft_id::text", expected:['A05'] },
    { id:'M04', target:migration, from:"or terminal_log.verify_json ->> 'draftId' = v_op.draft_id::text", to:"or true", expected:['A06'] },
    { id:'M05', target:migration, from:'if v_rank < v_best_rank then', to:'if v_rank < 999 then', expected:['A08'] },
    { id:'M06', target:migration, from:"when 'terminal_audit_conflict' then 3", to:"when 'terminal_audit_conflict' then 5", expected:['A07'] },
    { id:'M07', target:migration, from:"nullif(p_log_payload ->> 'published_version', '')", to:'null', expected:['A09'] },
    { id:'M08', target:migration, from:"nullif(p_log_payload ->> 'backup_path', '')", to:'null', expected:['A10'] },
    { id:'M09', target:migration, from:"raise exception '%: %', coalesce(v_class.code, 'TERMINAL_AUDIT_CONFLICT'), coalesce(v_class.message, 'terminal audit conflict after unique conflict');", to:"-- mutant wrongly reuses existing log without revalidation", expected:['A11'] },
    { id:'M10', target:'src/cms-admin/adminRollbackGate.js', from:'if (isResolvedCapableReleaseResponse(data)) {', to:'if (false && isResolvedCapableReleaseResponse(data)) {', expected:['A12'] },
    { id:'M11', target:'src/cms-admin/adminRollbackGate.js', from:'clearReleaseOperationGateFromExactIdle(statusData || repairData || null);', to:"setReleaseOperationGateState({ blocked: false, state: 'idle' });", expected:['A14'] },
    { id:'M12', target:migration, from:"nullif(p_log_payload ->> 'published_version', '')", to:'null', expected:['A09'] }
  ];
  let pass = 0;
  for (const m of mutants) {
    const tmp = mkdtempSync(join(tmpdir(), `cms-066015-${m.id}-`));
    cpSync(root, tmp, { recursive: true, dereference: false, filter: (src) => !/node_modules|\.git|backups|reports/.test(src) });
    const applied = applyReplacement(tmp, m.target, m.from, m.to);
    const failures = fixedAssertions(tmp).filter((r) => !r.pass).map((r) => r.id);
    const expectedMissing = m.expected.filter((id) => !failures.includes(id));
    const unexpectedFailedAssertionIds = failures.filter((id) => !m.expected.includes(id));
    const ok = applied && expectedMissing.length === 0 && unexpectedFailedAssertionIds.length === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} MUTATION ${m.id}: applied=${applied} expected=${m.expected.join(',')} failed=${failures.join(',') || 'none'} unexpected=${unexpectedFailedAssertionIds.join(',') || 'none'}`);
    if (ok) pass += 1;
    rmSync(tmp, { recursive: true, force: true });
  }
  return { pass, total: mutants.length };
}

const results = fixedAssertions(root);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id}: ${r.name}${r.pass ? '' : ` :: ${r.detail}`}`);
const failed = results.filter((r) => !r.pass);
console.log(`SUMMARY: pass=${results.length - failed.length} fail=${failed.length} total=${results.length}`);
console.log(`HARNESS_SHA256=${sha256(readFileSync(join(root, 'scripts/verify-v6.14.066.015-cms-rpc-compatibility-and-lineage.mjs')))}`);
if (runMutations) {
  const m = mutationSuite();
  console.log(`MUTATION_SUMMARY: pass=${m.pass} fail=${m.total - m.pass} total=${m.total}`);
  if (m.pass !== m.total) process.exitCode = 1;
}
if (failed.length) process.exitCode = 1;
