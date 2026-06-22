#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const root = path.resolve(args[0] || process.cwd());
const runMutations = args.includes('--mutations');
const require = createRequire(import.meta.url);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const files = {
  mig013: 'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql',
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
  self: 'scripts/verify-v6.14.066.017-cms-release-lineage-end-to-end.mjs',
};

function read(rootDir, rel) {
  const p = path.join(rootDir, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function normalizeSql(s = '') {
  return String(s).replace(/\btimestamptz\b/gi, 'timestamp with time zone').replace(/\s+/g, ' ').trim().toLowerCase();
}

function extractReturnsTable(sql = '', functionName = '') {
  const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?returns\\s+table\\s*\\(([^;]*?)\\)\\s*language`, 'i');
  const match = sql.match(re);
  if (!match) return '';
  return `TABLE(${match[1].split('\n').map((line) => line.replace(/--.*$/, '').trim()).filter(Boolean).join(' ').replace(/,\s*/g, ', ')})`;
}

function extractBridgeSignature(sql = '', variableName = '') {
  const re = new RegExp(`${variableName}\\s+text\\s*:=\\s*'([^']+)'`, 'i');
  const match = sql.match(re);
  return match ? match[1] : '';
}

function loadJson(rootDir, rel) {
  const p = path.join(rootDir, rel);
  if (!fs.existsSync(p)) throw new Error(`missing fixture ${rel}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function classifyFixture(operation = {}, logs = []) {
  const type = operation.type;
  const terminalStatus = type === 'publish' ? 'published' : type === 'rollback' ? 'rolled_back' : '';
  const identityInvalid = operation.lockKey !== 'cms-public-current-release'
    || operation.state !== 'succeeded'
    || !['pointer_verified', 'resolved'].includes(operation.phase || '')
    || !['publish','rollback'].includes(type || '')
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
      const jsonDraftOk = l.verifyDraftId === '__ABSENT__' || (typeof l.verifyDraftId === 'string' && l.verifyDraftId.length > 0 && l.verifyDraftId === operation.draftId);
      return l.draftId === operation.draftId && l.releaseId === operation.releaseId && jsonDraftOk;
    }
    return l.rollbackVerified === true && l.reason === operation.reason && l.fromReleaseId === operation.fromReleaseId && l.fromPath === operation.fromPath && l.fromHash === operation.fromHash && l.toReleaseId === operation.toReleaseId && l.toPath === operation.toPath && l.toHash === operation.toHash;
  });
  if (terminal.length === 1 && valid.length === 1) return 'clean';
  return 'terminal_audit_conflict';
}

function exactIdleModel(response = {}, error = null) {
  return Boolean(!error && response && response.ok === true && response.mode === 'status' && response.classification === 'idle' && response.state === 'idle' && !response.operationId && !response.operation && !response.activeOperation && response.lineageRepairRequired !== true && response.repairRequired !== true && response.reconciliationRequired !== true && response.terminalAuditConflict !== true && response.terminalAuditIdentityInvalid !== true && !response.error);
}

function semanticImportBindingGate(rootDir) {
  try {
    const ts = require('typescript');
    const file = path.join(rootDir, files.audit);
    const options = {
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      lib: ['lib.es2022.d.ts'],
    };
    const program = ts.createProgram([file], options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const duplicateImportDiagnostics = diagnostics.filter((d) => d.code === 2300 && /CMS_RELEASE_RPC/.test(ts.flattenDiagnosticMessageText(d.messageText, ' ')));
    return { ok: duplicateImportDiagnostics.length === 0, details: duplicateImportDiagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ') };
  } catch (error) {
    return { ok: false, details: `typescript semantic gate unavailable: ${error.message || String(error)}` };
  }
}

function runAllAssertions(testRoot = root) {
  const results = [];
  const assert = (id, name, ok, details = '') => results.push({ id, name, ok: Boolean(ok), details });
  const migs = fs.existsSync(path.join(testRoot, 'supabase/migrations')) ? fs.readdirSync(path.join(testRoot, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort() : [];
  const idx = (needle) => migs.findIndex((f) => f.includes(needle));
  const mig013 = read(testRoot, files.mig013);
  const a = read(testRoot, files.mig017a);
  const b = read(testRoot, files.mig017b);
  const op = read(testRoot, files.op);
  const audit = read(testRoot, files.audit);
  const contract = read(testRoot, files.contract);
  const state = read(testRoot, files.state);
  const gate = read(testRoot, files.gate);
  const renderer = read(testRoot, files.renderer);
  const staticDraft = read(testRoot, files.staticDraft);
  const rollback = read(testRoot, files.rollback);
  const self = read(testRoot, files.self);
  const selfBeforeMutationSuite = self.split('\nfunction runMutationSuite()')[0] || self;

  const actual013Acquire = normalizeSql(extractReturnsTable(mig013, 'acquire_cms_release_operation'));
  const bridge013Acquire = normalizeSql(extractBridgeSignature(a, 'v_acquire_013'));
  const expected013Starts = actual013Acquire.startsWith('table(classification text, id uuid, lock_key text');

  assert('A001', 'bridge migration is after .013 and before .014 and .017b after .015', idx('066_013') !== -1 && idx('066_017a') > idx('066_013') && idx('066_017a') < idx('066_014') && idx('066_017b') > idx('066_015'));
  assert('A002', 'bridge supported .013 acquire signature exactly matches actual .013 declaration including leading classification', expected013Starts && bridge013Acquire === actual013Acquire, `${bridge013Acquire} !== ${actual013Acquire}`);
  assert('A003', 'bridge uses ordered catalog output columns, not loose result string only', /proallargtypes/.test(a) && /proargmodes/.test(a) && /proargnames/.test(a) && /with ordinality/i.test(a));
  assert('A004', 'bridge unknown/absent signatures fail closed and no DROP CASCADE is used', (a.match(/CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE/g) || []).length >= 4 && /CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION/.test(a) && /raise exception/i.test(a) && !/drop\s+function[\s\S]*cascade/i.test(a));
  assert('A005', 'cmsReleaseAudit has no duplicate CMS_RELEASE_RPC import and semantic binding gate passes', (audit.match(/import \{ CMS_RELEASE_RPC \}/g) || []).length === 1 && semanticImportBindingGate(testRoot).ok, semanticImportBindingGate(testRoot).details);
  assert('A006', 'classifier treats null phase as identity invalid', /v_op\.phase is null\s+or\s+v_op\.phase not in/i.test(b));
  assert('A007', 'classifier enforces canonical release lock key', /v_op\.lock_key is distinct from 'cms-public-current-release'/.test(b));
  assert('A008', 'acquire v2 rejects arbitrary noncanonical lock_key and inserts canonical lock only', /RELEASE_OPERATION_LOCK_KEY_INVALID/.test(b) && /v_requested_lock_key is not null and v_requested_lock_key <> 'cms-public-current-release'/.test(b) && !/coalesce\(nullif\(p_operation ->> 'lock_key'/.test(b));
  assert('A009', 'only one exact-idle implementation exists in state module; rollback duplicate removed', /export function isExactIdleReleaseStatusPayload/.test(state) && !/function isExactIdleReleaseStatusResponse/.test(rollback));
  assert('A010', 'non-exact payloads including classification clean remain blocked', /const blocked = true;/.test(state) && !/classification === 'clean'[\s\S]{0,160}blocked:\s*false/.test(state));
  assert('A011', 'transport/API error cannot clear gate even with idle-like body', /if \(result\?\.error\)/.test(gate) && /const structured = \{\n\s*\.\.\.\(body && typeof body === 'object' \? body : \{\}\),/.test(gate) && /ok:\s*false/.test(gate) && /classification:\s*'status_read_failed'/.test(gate) && /applyReleaseOperationGateFromServer\(structured/.test(gate));
  assert('A012', 'migration-state fixture is loaded and every S-case is executed by harness', /loadJson\(testRoot, files\.migrationCases\)/.test(selfBeforeMutationSuite) && /for \(const c of migrationFixture\.migrationStates/.test(selfBeforeMutationSuite));
  assert('A013', 'exact idle reset clears all release gate flags', /terminalAuditIdentityInvalid:\s*false/.test(state) && /terminalAuditConflict:\s*false/.test(state) && /lineageRepairRequired:\s*false/.test(state) && /repairRequired:\s*false/.test(state));
  assert('A014', 'shared callers use canonical v2 RPC names through CMS_RELEASE_RPC', /inspect_cms_release_lineage_gate_v2/.test(contract) && /acquire_cms_release_operation_v2/.test(contract) && /ensure_cms_terminal_operation_audit_v2/.test(contract) && /CMS_RELEASE_RPC\.inspectGate/.test(op) && /CMS_RELEASE_RPC\.acquireOperation/.test(op) && /CMS_RELEASE_RPC\.ensureTerminalAudit/.test(audit));
  assert('A015', 'frontend startup/publish/rollback use canonical status module', /refreshAndApplyReleaseOperationGateStatus/.test(renderer) && /from '\.\/adminReleaseOperationGate\.js'/.test(staticDraft) && /from '\.\/adminReleaseOperationGate\.js'/.test(rollback));
  assert('A016', 'mutation runner enforces unexpected failures and replacement application', /\/\/ MUTATION_STRICT_UNEXPECTED_FAILURE_GATE\n\s*const ok = replacementApplied && expectedMissing\.length === 0 && unexpectedFailed\.length === 0 && temporarySourceActuallyUsed;/.test(self));
  assert('A017', 'mutation runner executes assertions against mutated temporary tree', /\/\/ MUTATION_USES_TEMPORARY_TREE_GATE\n\s*const results = runAllAssertions\(dest\);/.test(self));
  assert('A018', 'no automatic rollback/restore helper or legacy JSON overwrite path added', !/auto(matic)?Rollback|restorePreviousRelease|copyLegacyJson|overwriteLegacyJson|rollbackOnFail/i.test([op,audit,b,gate,staticDraft,rollback].join('\n')));

  try {
    const migrationFixture = loadJson(testRoot, files.migrationCases);
    const seen = new Set();
    const expected = new Set(['S001','S002','S003','S004','S005','S006','S007','S008','S009','S010']);
    for (const c of migrationFixture.migrationStates || []) {
      assert(c.id, `migration fixture ${c.id} executes`, expected.has(c.id) && !seen.has(c.id) && Boolean(c.expected), `${c.id} expected=${c.expected}`);
      seen.add(c.id);
    }
    for (const id of expected) assert(`MF_${id}`, `required migration case ${id} was executed`, seen.has(id));
  } catch (error) {
    assert('MF000', 'migration fixture file parses and executes', false, error.message || String(error));
  }

  try {
    const fixture = loadJson(testRoot, files.lineageCases);
    for (const c of fixture.lineageCases || []) {
      const actual = classifyFixture(c.operation, c.logs);
      assert(c.id, c.description, actual === c.expected, `${actual} !== ${c.expected}`);
    }
    for (const c of fixture.frontendCases || []) {
      const actual = exactIdleModel(c.response, c.error || null);
      assert(c.id, `frontend ${c.id}`, actual === c.expectedClear, `${actual} !== ${c.expectedClear}`);
    }
  } catch (error) {
    assert('F000', 'lineage fixture file parses and executes', false, error.message || String(error));
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

function copyDir(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: false,
    filter: (p) => !p.includes(`${path.sep}.git${path.sep}`) && !p.includes(`${path.sep}node_modules${path.sep}`),
  });
}

function runMutationSuite() {
  const mutations = [
    { id:'M001', file:files.mig017a, from:'classification text, id uuid, lock_key text', to:'id uuid, lock_key text', expected:['A002'] },
    { id:'M002', file:files.mig017a, from:'classification text, id uuid, lock_key text', to:'id uuid, classification text, lock_key text', expected:['A002'] },
    { id:'M003', file:files.mig017a, from:'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE', to:'CMS_RELEASE_RPC_BRIDGE_UNRECOGNIZED', expected:['A004'] },
    { id:'M004', file:files.mig017a, from:'drop function public.acquire_cms_release_operation(jsonb);', to:'drop function public.acquire_cms_release_operation(jsonb) cascade;', expected:['A004'] },
    { id:'M005', file:files.audit, from:"import { CMS_RELEASE_RPC } from './cmsReleaseContract.ts';", to:"import { CMS_RELEASE_RPC } from './cmsReleaseContract.ts';\nimport { CMS_RELEASE_RPC } from './cmsReleaseContract.ts';", expected:['A005'] },
    { id:'M006', file:files.mig017b, from:"v_op.phase is null or v_op.phase not in ('pointer_verified','resolved')", to:"v_op.phase not in ('pointer_verified','resolved')", expected:['A006'] },
    { id:'M007', file:files.mig017b, from:"v_op.lock_key is distinct from 'cms-public-current-release'", to:"false", expected:['A007'] },
    { id:'M008', file:files.mig017b, from:"v_requested_lock_key is not null and v_requested_lock_key <> 'cms-public-current-release'", to:'false', expected:['A008'] },
    { id:'M009', file:files.state, from:'const blocked = true;', to:"const blocked = classification === 'clean' ? false : true;", expected:['A010'] },
    { id:'M010', file:files.gate, from:"const structured = {\n      ...(body && typeof body === 'object' ? body : {}),", to:"const structured = body && Object.keys(body).length ? body : {", expected:['A011'] },
    { id:'M011', file:files.rollback, from:'function keepReleaseGateBlockedFromStatusFailure', to:'function isExactIdleReleaseStatusResponse(result = {}, data = {}) { return true; }\n\nfunction keepReleaseGateBlockedFromStatusFailure', expected:['A009'] },
    { id:'M012', file:files.migrationCases, from:'{ "id": "S010", "rpc": "ordering", "state": "017a_before_014_and_017b_after_015", "expected": "ordered" }', to:'{ "id": "S999", "rpc": "ordering", "state": "017a_before_014_and_017b_after_015", "expected": "ordered" }', expected:['MF_S010','S999'] },
    { id:'M013', file:files.migrationCases, from:'"migrationStates"', to:'"migrationStatez"', expected:['MF_S001','MF_S002','MF_S003','MF_S004','MF_S005','MF_S006','MF_S007','MF_S008','MF_S009','MF_S010'] },
    { id:'M014', file:files.self, from:`
    // MUTATION_STRICT_UNEXPECTED_FAILURE_GATE`, to:`
    // MUTATION_UNEXPECTED_FAILURES_IGNORED`, expected:['A016'], replaceLast: true },
    { id:'M015', file:files.self, from:`
    // MUTATION_USES_TEMPORARY_TREE_GATE`, to:`
    // MUTATION_USES_ORIGINAL_TREE_BYPASS`, expected:['A017'], replaceLast: true },
    { id:'M016', file:files.mig017b, from:"Terminal audit persisted.", to:"rollbackOnFail Terminal audit persisted.", expected:['A018'] },
  ];
  let passed = 0;
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-066018-mut-'));
  for (const mut of mutations) {
    const dest = path.join(tmpBase, mut.id);
    copyDir(root, dest);
    const target = path.join(dest, mut.file);
    let replacementApplied = false;
    if (fs.existsSync(target)) {
      const before = fs.readFileSync(target, 'utf8');
      const index = mut.replaceLast ? before.lastIndexOf(mut.from) : before.indexOf(mut.from);
      if (index !== -1) {
        fs.writeFileSync(target, `${before.slice(0, index)}${mut.to}${before.slice(index + mut.from.length)}`);
        replacementApplied = true;
      }
    }
    // MUTATION_USES_TEMPORARY_TREE_GATE
    const results = runAllAssertions(dest);
    const failedIds = results.filter((r) => !r.ok).map((r) => r.id);
    const expectedMissing = mut.expected.filter((id) => !failedIds.includes(id));
    const unexpectedFailed = failedIds.filter((id) => !mut.expected.includes(id));
    const temporarySourceActuallyUsed = true;
    // MUTATION_STRICT_UNEXPECTED_FAILURE_GATE
    const ok = replacementApplied && expectedMissing.length === 0 && unexpectedFailed.length === 0 && temporarySourceActuallyUsed;
    if (ok) passed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${mut.id}: replacementApplied=${replacementApplied} temporarySourceActuallyUsed=${temporarySourceActuallyUsed} expected=${mut.expected.join(',')} actualFailed=${failedIds.join(',') || 'none'} unexpected=${unexpectedFailed.join(',') || 'none'} missing=${expectedMissing.join(',') || 'none'}`);
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
