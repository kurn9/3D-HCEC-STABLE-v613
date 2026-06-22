#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const root = path.resolve(args[0] || process.cwd());
const runMutations = args.includes('--mutations');
const rel = (p) => path.join(root, p);
const read = (p) => fs.existsSync(rel(p)) ? fs.readFileSync(rel(p), 'utf8') : '';
const exists = (p) => fs.existsSync(rel(p));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const files = {
  mig017a: 'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql',
  mig014: 'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql',
  mig015: 'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql',
  mig017b: 'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql',
  op: 'supabase/functions/_shared/cmsReleaseOperation.ts',
  audit: 'supabase/functions/_shared/cmsReleaseAudit.ts',
  contract: 'supabase/functions/_shared/cmsReleaseContract.ts',
  recon: 'supabase/functions/reconcile-cms-release/index.ts',
  state: 'src/cms-admin/adminState.js',
  gate: 'src/cms-admin/adminReleaseOperationGate.js',
  renderer: 'src/cms-admin/adminRenderer.js',
  staticDraft: 'src/cms-admin/adminStaticCmsDraft.js',
  rollback: 'src/cms-admin/adminRollbackGate.js',
  migrationCases: 'scripts/fixtures/v6.14.066.017-migration-state-cases.json',
  lineageCases: 'scripts/fixtures/v6.14.066.017-cms-release-lineage-cases.json',
};

function classifyFixture(operation = {}, logs = []) {
  const type = operation.type;
  const terminalStatus = type === 'publish' ? 'published' : type === 'rollback' ? 'rolled_back' : '';
  const identityInvalid = operation.state !== 'succeeded'
    || !['publish','rollback'].includes(type)
    || !operation.actor
    || !operation.path
    || !operation.hash
    || (type === 'publish' && (!operation.draftId || !operation.releaseId))
    || (type === 'rollback' && (!operation.targetReleaseId || !operation.fromReleaseId || !operation.fromPath || !operation.fromHash || !operation.toReleaseId || !operation.toPath || !operation.toHash || !operation.reason || operation.rollbackVerified !== true || operation.targetReleaseId !== operation.toReleaseId || operation.path !== operation.toPath || operation.hash !== operation.toHash));
  if (identityInvalid) return 'terminal_audit_identity_invalid';
  const terminal = logs.filter((l) => ['published','rolled_back'].includes(l.status));
  if (terminal.length === 0) return 'lineage_repair_required';
  const valid = terminal.filter((l) => {
    if (l.status !== terminalStatus || l.operationType !== type || l.actor !== operation.actor || l.path !== operation.path || l.hash !== operation.hash) return false;
    if (type === 'publish') {
      const jsonDraftOk = l.verifyDraftId === '__ABSENT__' || (l.verifyDraftId && l.verifyDraftId === operation.draftId);
      return l.draftId === operation.draftId && l.releaseId === operation.releaseId && jsonDraftOk;
    }
    return l.rollbackVerified === true && l.reason === operation.reason && l.fromReleaseId === operation.fromReleaseId && l.fromPath === operation.fromPath && l.fromHash === operation.fromHash && l.toReleaseId === operation.toReleaseId && l.toPath === operation.toPath && l.toHash === operation.toHash;
  });
  if (terminal.length === 1 && valid.length === 1) return 'clean';
  return 'terminal_audit_conflict';
}

function exactIdleModel(response = {}) {
  return Boolean(response && response.ok === true && response.mode === 'status' && response.classification === 'idle' && response.state === 'idle' && !response.operationId && !response.operation && response.lineageRepairRequired !== true && response.repairRequired !== true && response.reconciliationRequired !== true && response.terminalAuditConflict !== true && response.terminalAuditIdentityInvalid !== true);
}

function runAllAssertions(testRoot = root) {
  const oldRoot = root;
  const r = (p) => path.join(testRoot, p);
  const R = (p) => fs.existsSync(r(p)) ? fs.readFileSync(r(p), 'utf8') : '';
  const results = [];
  const assert = (id, name, ok, details = '') => results.push({ id, name, ok: Boolean(ok), details });
  const migs = fs.existsSync(r('supabase/migrations')) ? fs.readdirSync(r('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort() : [];
  const idx = (needle) => migs.findIndex((f) => f.includes(needle));
  const a = R(files.mig017a), b = R(files.mig017b), op = R(files.op), audit = R(files.audit), contract = R(files.contract), state = R(files.state), gate = R(files.gate), renderer = R(files.renderer), staticDraft = R(files.staticDraft), rollback = R(files.rollback);
  assert('A001', 'bridge migration is after .013 and before .014 and .017b after .015', idx('066_013') !== -1 && idx('066_017a') > idx('066_013') && idx('066_017a') < idx('066_014') && idx('066_017b') > idx('066_015'));
  assert('A002', 'bridge unknown signature state raises fail-closed exception', (a.match(/CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE/g) || []).length >= 3 && (a.match(/CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION/g) || []).length >= 2 && /raise exception/i.test(a));
  assert('A003', 'bridge does not use DROP CASCADE', !/drop\s+function[\s\S]*cascade/i.test(a));
  assert('A004', 'versioned v2 RPCs are created without changing old return shape in-place', /create or replace function public\.inspect_cms_release_lineage_gate_v2/.test(b) && /create or replace function public\.acquire_cms_release_operation_v2/.test(b) && /create or replace function public\.ensure_cms_terminal_operation_audit_v2/.test(b) && !/create or replace function public\.acquire_cms_release_operation\(/.test(b));
  assert('A005', 'shared callers use canonical v2 RPC names through CMS_RELEASE_RPC', /inspect_cms_release_lineage_gate_v2/.test(contract) && /acquire_cms_release_operation_v2/.test(contract) && /ensure_cms_terminal_operation_audit_v2/.test(contract) && /CMS_RELEASE_RPC\.inspectGate/.test(op) && /CMS_RELEASE_RPC\.acquireOperation/.test(op) && /CMS_RELEASE_RPC\.ensureTerminalAudit/.test(audit));
  assert('A006', 'null-safe terminal classifier uses terminal_count/valid_count rather than nullable negation conflict_count', /v_terminal_count integer/.test(b) && /v_valid_count integer/.test(b) && /v_terminal_count = 0/.test(b) && /v_terminal_count = 1 and v_valid_count = 1/i.test(b) && !/v_conflict_count/.test(b));
  assert('A007', 'legacy publish missing verify_json.draftId is allowed but explicit null/empty mismatch is not', /not \(coalesce\(terminal_log\.verify_json, '\{\}'::jsonb\) \? 'draftId'\)/.test(b) && /nullif\(terminal_log\.verify_json ->> 'draftId', ''\) is not null/.test(b));
  assert('A008', 'rollback verification is strict true and not defaulted true', /v_rollback_verified_text is distinct from 'true'/.test(b) && !/coalesce\([^\n]*rollbackVerified[^\n]*true/i.test(b));
  assert('A009', 'severity precedence ranks identity-invalid before conflict before repairable', /terminal_audit_identity_invalid' then 2/.test(b) && /terminal_audit_conflict' then 3/.test(b) && /lineage_repair_required' then 4/.test(b));
  assert('A010', 'canonical frontend gate module performs fresh status and exact idle check', /refreshAndApplyReleaseOperationGateStatus/.test(gate) && /reconcileCmsReleasePointer\(activeClient, \{ mode: 'status' \}\)/.test(gate) && /isExactIdleReleaseStatusPayload/.test(gate));
  assert('A011', 'startup uses canonical status authority', /refreshAndApplyReleaseOperationGateStatus/.test(renderer) && !/function refreshReleaseOperationGate[\s\S]*clearReleaseOperationGateState\(/.test(renderer));
  assert('A012', 'publish operation flow does not directly set blocked false', !/setReleaseOperationGateState\(\{[^}]*blocked:\s*false/.test(staticDraft));
  { const resetBody = (state.match(/export function clearReleaseOperationGateFromExactIdle[\s\S]*?\n}/) || [''])[0]; assert('A013', 'exact idle reset clears all conflict and identity flags', /terminalAuditIdentityInvalid:\s*false/.test(resetBody) && /terminalAuditConflict:\s*false/.test(resetBody) && /lineageRepairRequired:\s*false/.test(resetBody) && /repairRequired:\s*false/.test(resetBody)); }
  assert('A014', 'acquire v2 calls inspect v2 inside advisory transaction', /pg_advisory_xact_lock\(hashtext\('cms-public-current-release'\)\)/.test(b) && /from public\.inspect_cms_release_lineage_gate_v2\(1\)/.test(b));
  assert('A015', 'audit v2 preserves non-authoritative payload metadata', /p_log_payload ->> 'published_version'/.test(b) && /p_log_payload ->> 'backup_path'/.test(b) && /p_log_payload ->> 'error_message'/.test(b));
  assert('A016', 'rollback and static draft import canonical frontend gate helper', /from '\.\/adminReleaseOperationGate\.js'/.test(rollback) && /from '\.\/adminReleaseOperationGate\.js'/.test(staticDraft));
  assert('A017', 'service role grants are present for v2 RPCs', /grant execute on function public\.acquire_cms_release_operation_v2\(jsonb\) to service_role/.test(b) && /grant execute on function public\.ensure_cms_terminal_operation_audit_v2\(uuid, text, jsonb, jsonb\) to service_role/.test(b));
  assert('A018', 'no automatic rollback/restore helper or legacy JSON overwrite path added', !/auto(matic)?Rollback|restorePreviousRelease|copyLegacyJson|overwriteLegacyJson|rollbackOnFail/i.test([op,audit,b,gate,staticDraft,rollback].join('\n')));
  if (fs.existsSync(r(files.lineageCases))) {
    const fixture = JSON.parse(R(files.lineageCases));
    for (const c of fixture.lineageCases || []) assert(c.id, c.description, classifyFixture(c.operation, c.logs) === c.expected, `${classifyFixture(c.operation, c.logs)} !== ${c.expected}`);
    for (const c of fixture.frontendCases || []) assert(c.id, 'frontend '+c.id, exactIdleModel(c.response) === c.expectedClear, `${exactIdleModel(c.response)} !== ${c.expectedClear}`);
  } else {
    assert('F000', 'fixture file exists', false, 'missing fixture');
  }
  return results;
}

function printResults(label, results) {
  console.log(`## ${label}`);
  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.ok) { pass++; console.log(`PASS ${r.id}: ${r.name}`); }
    else { fail++; console.log(`FAIL ${r.id}: ${r.name}${r.details ? ' — '+r.details : ''}`); }
  }
  console.log(`SUMMARY ${label}: pass=${pass} fail=${fail} total=${results.length}`);
  return { pass, fail, total: results.length };
}

function copyDir(src, dest) { fs.cpSync(src, dest, { recursive: true, dereference: false, filter: (p) => !p.includes(`${path.sep}.git${path.sep}`) && !p.includes(`${path.sep}node_modules${path.sep}`) }); }

function runMutationSuite() {
  const mutations = [
    { id:'M001', file:files.mig017a, from:'CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION', to:'CMS_RELEASE_RPC_BRIDGE_NOOP_STATE', expected:['A002'] },
    { id:'M002', file:files.mig017a, from:'drop function public.acquire_cms_release_operation(jsonb);', to:'drop function public.acquire_cms_release_operation(jsonb) cascade;', expected:['A003'] },
    { id:'M003', file:files.mig017b, from:'create or replace function public.acquire_cms_release_operation_v2', to:'create or replace function public.acquire_cms_release_operation', expected:['A004'] },
    { id:'M004', file:files.op, from:'CMS_RELEASE_RPC.inspectGate', to:"'inspect_cms_terminal_lineage_gate'", expected:['A005'] },
    { id:'M005', file:files.mig017b, from:'v_terminal_count = 0', to:'v_terminal_count >= 0', expected:['A006'] },
    { id:'M006', file:files.mig017b, from:"v_rollback_verified_text is distinct from 'true'", to:'false', expected:['A008'] },
    { id:'M007', file:files.mig017b, from:"terminal_audit_conflict' then 3", to:"terminal_audit_conflict' then 5", expected:['A009'] },
    { id:'M008', file:files.gate, from:"reconcileCmsReleasePointer(activeClient, { mode: 'status' })", to:"Promise.resolve({ data: { ok: true, mode: 'status', classification: 'idle', state: 'idle' } })", expected:['A010'] },
    { id:'M009', file:files.staticDraft, from:"await refreshAndApplyReleaseOperationGateStatus({ successResult: data, fallbackMessage: 'Operation đã resolve nhưng máy chủ chưa xác nhận exact idle.' });", to:"setReleaseOperationGateState({ blocked: false, state: 'succeeded' });", expected:['A012'] },
    { id:'M010', file:files.state, from:"terminalAuditIdentityInvalid: false,\n    terminalAuditConflict: false,\n    reconciliationRequired: false,", to:"terminalAuditIdentityInvalid: false,\n    terminalAuditConflict: true,\n    reconciliationRequired: false,", expected:['A013'] },
    { id:'M011', file:files.mig017b, from:'from public.inspect_cms_release_lineage_gate_v2(1)', to:'from public.inspect_cms_terminal_lineage_gate(1)', expected:['A014'] },
    { id:'M012', file:files.mig017b, from:"nullif(p_log_payload ->> 'backup_path', '')", to:'null', expected:['A015'] },
    { id:'M013', file:files.rollback, from:"from './adminReleaseOperationGate.js';", to:"from './adminReleaseOperationGateLegacy.js';", expected:['A016'] },
    { id:'M014', file:files.mig017b, from:'grant execute on function public.acquire_cms_release_operation_v2(jsonb) to service_role;', to:'-- grant removed', expected:['A017'] },
    { id:'M015', file:files.mig017b, from:'Terminal lineage hợp lệ.', to:'rollbackOnFail Terminal lineage hợp lệ.', expected:['A018'] },
    { id:'M016', file:files.mig017b, from:"lineage_repair_required' then 4", to:"lineage_repair_required' then 1", expected:['A009'] },
  ];
  let passed = 0;
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-066017-mut-'));
  for (const mut of mutations) {
    const dest = path.join(tmpBase, mut.id);
    copyDir(root, dest);
    const target = path.join(dest, mut.file);
    let replacementApplied = false;
    if (fs.existsSync(target)) {
      const before = fs.readFileSync(target, 'utf8');
      if (before.includes(mut.from)) {
        fs.writeFileSync(target, before.replace(mut.from, mut.to));
        replacementApplied = true;
      }
    }
    const results = runAllAssertions(dest);
    const failedIds = results.filter((r) => !r.ok).map((r) => r.id);
    const expectedMissing = mut.expected.filter((id) => !failedIds.includes(id));
    const unexpectedFailed = failedIds.filter((id) => !mut.expected.includes(id));
    const ok = replacementApplied && expectedMissing.length === 0 && unexpectedFailed.length === 0;
    if (ok) passed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${mut.id}: replacementApplied=${replacementApplied} expected=${mut.expected.join(',')} actualFailed=${failedIds.join(',') || 'none'} unexpected=${unexpectedFailed.join(',') || 'none'}`);
  }
  fs.rmSync(tmpBase, { recursive: true, force: true });
  console.log(`SUMMARY mutations: pass=${passed} fail=${mutations.length - passed} total=${mutations.length}`);
  return passed === mutations.length;
}

const results = runAllAssertions(root);
const summary = printResults('fixed/source', results);
let ok = summary.fail === 0;
if (runMutations) ok = runMutationSuite() && ok;
console.log(`HARNESS_SHA256 ${sha(fs.readFileSync(new URL(import.meta.url)))}`);
process.exit(ok ? 0 : 1);
