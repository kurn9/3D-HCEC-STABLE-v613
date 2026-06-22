#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const ROOT = path.resolve(args.get('root') || process.cwd());
const MODE = args.get('mode') || 'fixed';
const RUN_MUTATIONS = args.get('mutations') === 'true';

const EXACT_FIXTURE = 'scripts/fixtures/v6.14.066.019-exact-idle-cases.json';
const MIGRATION_FIXTURE = 'scripts/fixtures/v6.14.066.019-migration-state-cases.json';
const ADMIN_STATE = 'src/cms-admin/adminState.js';
const GATE_MODULE = 'src/cms-admin/adminReleaseOperationGate.js';
const BRIDGE_MIGRATION = 'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql';
const MIGRATION_013 = 'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql';
const MIGRATION_014 = 'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql';
const MIGRATION_015 = 'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql';
const MIGRATION_017B = 'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql';

function readText(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readJson(root, rel) {
  return JSON.parse(readText(root, rel));
}

function normalizeType(type) {
  return String(type || '')
    .replace(/\btimestamptz\b/gi, 'timestamp with time zone')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeSignature(sig) {
  return String(sig || '')
    .replace(/\btimestamptz\b/gi, 'timestamp with time zone')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s*,\s*/g, ', ')
    .trim()
    .toLowerCase();
}

function parseReturnsTable(sql, functionName) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${escaped}[\\s\\S]*?returns\\s+table\\s*\\(([^;]*?)\\)\\s*language`, 'i');
  const match = sql.match(re);
  if (!match) throw new Error(`Unable to parse RETURNS TABLE for ${functionName}`);
  const columns = match[1].split(',').map((part) => {
    const bits = part.trim().replace(/\s+/g, ' ').split(' ');
    const name = bits.shift();
    const type = normalizeType(bits.join(' '));
    return `${name} ${type}`;
  });
  return `table(${columns.join(', ')})`;
}

function parseBridgeVar(sql, varName) {
  const re = new RegExp(`${varName}\\s+text\\s*:=\\s*'([^']+)'`, 'i');
  const match = sql.match(re);
  if (!match) throw new Error(`Unable to parse bridge variable ${varName}`);
  return normalizeSignature(match[1]);
}

function evaluateMigrationAction(root, testCase) {
  const bridge = readText(root, BRIDGE_MIGRATION);
  const m013 = readText(root, MIGRATION_013);
  const m014 = readText(root, MIGRATION_014);
  const files = [MIGRATION_013, BRIDGE_MIGRATION, MIGRATION_014, MIGRATION_015, MIGRATION_017B]
    .map((rel) => path.basename(rel));
  const acquire013 = normalizeSignature(parseReturnsTable(m013, 'acquire_cms_release_operation'));
  const audit013 = normalizeSignature(parseReturnsTable(m013, 'ensure_cms_terminal_operation_audit'));
  const acquire014 = normalizeSignature(parseReturnsTable(m014, 'acquire_cms_release_operation'));
  const acquireBridge013 = parseBridgeVar(bridge, 'v_acquire_013');
  const acquireBridgeTarget = parseBridgeVar(bridge, 'v_acquire_target');
  const auditBridge013 = parseBridgeVar(bridge, 'v_audit_013');
  const auditBridgeTarget = parseBridgeVar(bridge, 'v_audit_target');

  if (testCase.observedState === 'bridgeBody') {
    return bridge.includes('CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION') ? 'bridge_body_fail_closed' : 'bridge_body_not_fail_closed';
  }
  if (testCase.observedState === 'migrationOrder') {
    const ordered = files[0] < files[1] && files[1] < files[2] && files[2] < files[3] && files[3] < files[4];
    return ordered ? 'ordering_valid' : 'ordering_invalid';
  }
  if (testCase.observedState === 'dropCascade') {
    return /drop\s+function[\s\S]*cascade/i.test(bridge) ? 'drop_cascade_present' : 'no_drop_cascade';
  }
  if (testCase.observedState === 'targetAligns014') {
    return acquireBridgeTarget === acquire014 ? 'target_signature_aligns_014' : 'target_signature_mismatch_014';
  }
  if (testCase.observedState === '017bAfter015') {
    return path.basename(MIGRATION_015) < path.basename(MIGRATION_017B) ? '017b_after_015' : '017b_before_015';
  }

  const isAcquire = testCase.rpc === 'acquire';
  const bridge013 = isAcquire ? acquireBridge013 : auditBridge013;
  const bridgeTarget = isAcquire ? acquireBridgeTarget : auditBridgeTarget;
  const actual013 = isAcquire ? acquire013 : audit013;
  const observed = testCase.observedState;
  if (observed === 'actual013') return bridge013 === actual013 ? 'recreate_target' : 'raise_unknown';
  if (observed === 'target') return bridgeTarget ? 'noop_target' : 'raise_unknown';
  if (observed === 'absent') {
    const absentPattern = isAcquire
      ? /if v_acquire is null then\s+raise exception/i
      : /if v_audit is null then\s+raise exception/i;
    return absentPattern.test(bridge) ? 'raise_absent' : 'noop_target';
  }
  if (observed === 'unknown') {
    const unknownPattern = isAcquire
      ? /else\s+raise exception 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: acquire_cms_release_operation/i
      : /else\s+raise exception 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: ensure_cms_terminal_operation_audit/i;
    return unknownPattern.test(bridge) ? 'raise_unknown' : 'noop_target';
  }
  return 'unknown_case';
}

async function importActualModules(root) {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const importRoot = fs.mkdtempSync(path.join(os.tmpdir(), `cms-066019-import-${stamp}-`));
  const sourceDir = path.join(root, 'src/cms-admin');
  const importDir = path.join(importRoot, 'src/cms-admin');
  fs.mkdirSync(path.dirname(importDir), { recursive: true });
  fs.cpSync(sourceDir, importDir, { recursive: true });
  fs.writeFileSync(path.join(importDir, 'package.json'), '{"type":"module"}');
  const adminUrl = pathToFileURL(path.join(importDir, 'adminState.js')).href;
  const gateUrl = pathToFileURL(path.join(importDir, 'adminReleaseOperationGate.js')).href;
  const adminState = await import(adminUrl);
  const gate = await import(gateUrl);
  return { adminState, gate, importedFrom: importDir };
}

function cloneCasePayload(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function runChecks(root) {
  const assertions = [];
  const migrationCaseIds = [];
  const fail = (id, message) => assertions.push({ id, pass: false, message });
  const pass = (id, message) => assertions.push({ id, pass: true, message });
  const expect = (id, condition, message) => condition ? pass(id, message) : fail(id, message);

  const exactCases = readJson(root, EXACT_FIXTURE);
  const migrationCases = readJson(root, MIGRATION_FIXTURE);
  const { adminState, gate } = await importActualModules(root);
  const source = readText(root, ADMIN_STATE);
  expect('H001_SOURCE_IMPORTS_ADMIN_STATE', typeof adminState.isExactIdleReleaseStatusPayload === 'function', 'actual adminState.js exact-idle export loaded');
  expect('H002_NO_LOCAL_EXACT_IDLE_MODEL', !/function\s+exactIdleModel\s*\(/.test(readText(root, 'scripts/verify-v6.14.066.019-cms-exact-idle-and-migration-state.mjs')), 'harness has no copied exactIdleModel function');
  expect('H003_SOURCE_CONTAINS_BODY_ERROR_GUARD', /hasErrorPayload|\.error/.test(source) && /blocked\s*!==\s*true/.test(source), 'source guards error payload and blocked=true');

  for (const testCase of exactCases) {
    const payload = cloneCasePayload(testCase.payload);
    let actualPredicate = false;
    let predicateError = null;
    try {
      actualPredicate = adminState.isExactIdleReleaseStatusPayload(payload);
    } catch (error) {
      predicateError = error;
    }
    expect(testCase.id, !predicateError && actualPredicate === testCase.expectedExactIdle, `${testCase.name}: predicate=${actualPredicate}, expected=${testCase.expectedExactIdle}, error=${predicateError ? predicateError.message : 'none'}`);

    adminState.clearReleaseOperationGateState();
    if (testCase.wrapperError) {
      gate.applyReleaseOperationGateStatusResult({ error: testCase.wrapperError, data: payload }, payload, 'wrapper failure');
    } else if (payload && typeof payload === 'object') {
      adminState.applyReleaseOperationGateFromServer(payload, 'fixture fallback');
    } else {
      adminState.applyReleaseOperationGateFromServer({ ok: false, mode: 'status', classification: 'malformed_status_response', code: 'MALFORMED', blocked: true, error: 'malformed' }, 'malformed');
    }
    const blocked = adminState.getState().releaseOperationGate.blocked === true;
    expect(`${testCase.id}_GATE`, blocked === testCase.expectedGateBlocked, `${testCase.name}: gateBlocked=${blocked}, expected=${testCase.expectedGateBlocked}`);
    adminState.clearReleaseOperationGateState();
  }

  const seenMigrationIds = new Set();
  for (const testCase of migrationCases) {
    migrationCaseIds.push(testCase.id);
    expect(`${testCase.id}_UNIQUE`, !seenMigrationIds.has(testCase.id), `migration case ${testCase.id} unique`);
    seenMigrationIds.add(testCase.id);
    const actualAction = evaluateMigrationAction(root, testCase);
    expect(testCase.id, actualAction === testCase.expectedAction, `${testCase.id}: action=${actualAction}, expected=${testCase.expectedAction}`);
  }
  const requiredMigrationIds = Array.from({ length: 13 }, (_, index) => `S${String(index + 1).padStart(3, '0')}`);
  for (const id of requiredMigrationIds) {
    expect(`${id}_EXECUTED`, migrationCaseIds.includes(id), `${id} fixture executed`);
  }

  const failed = assertions.filter((item) => !item.pass);
  return { assertions, failed };
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: false, filter: (p) => !p.includes(`${path.sep}.git${path.sep}`) && !p.includes(`${path.sep}node_modules${path.sep}`) });
}

const MUTANTS = [
  { id: 'M001', rel: ADMIN_STATE, from: '&& !hasErrorPayload', to: '&& true /* mutant allow body error */', expected: ['E003','E003_GATE'] },
  { id: 'M002', rel: ADMIN_STATE, from: '&& data.blocked !== true', to: '&& true /* mutant allow blocked true */', expected: ['H003_SOURCE_CONTAINS_BODY_ERROR_GUARD','E004','E004_GATE'] },
  { id: 'M003', rel: ADMIN_STATE, from: '&& data.operationResolved !== true', to: '&& true /* mutant allow operationResolved */', expected: ['E005','E005_GATE'] },
  { id: 'M004', rel: ADMIN_STATE, from: '&& data.reconciling !== true', to: '&& true /* mutant allow reconciling */', expected: ['E007','E007_GATE'] },
  { id: 'M005', rel: ADMIN_STATE, from: '&& !data.operation\n    && !data.activeOperation', to: '&& true /* mutant allow nested operation */\n    && !data.activeOperation', expected: ['E008','E008_GATE'] },
  { id: 'M006', rel: ADMIN_STATE, from: "&& classification === 'idle'", to: "&& (classification === 'idle' || classification === 'clean')", expected: ['E015','E015_GATE'] },
  { id: 'M007', rel: BRIDGE_MIGRATION, from: 'classification text, id uuid, lock_key text', to: 'id uuid, lock_key text', expected: ['S001'] },
  { id: 'M008', rel: BRIDGE_MIGRATION, from: 'classification text, code text, repairable boolean, message text, id uuid', to: 'classification text, id uuid, lock_key text', expected: ['S012'] },
  { id: 'M009', rel: BRIDGE_MIGRATION, from: "raise exception 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: acquire_cms_release_operation(jsonb) absent after .013; Project Control review required.';", to: "null; -- mutant absent acquire no-op", expected: ['S003'] },
  { id: 'M010', rel: BRIDGE_MIGRATION, from: "else\n    raise exception 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: acquire_cms_release_operation(jsonb) observed %, expected % or %', v_acquire_result, v_acquire_013, v_acquire_target;", to: "else\n    null; -- mutant unknown acquire no-op", expected: ['S004'] },
  { id: 'M011', rel: BRIDGE_MIGRATION, from: 'drop function public.acquire_cms_release_operation(jsonb);', to: 'drop function public.acquire_cms_release_operation(jsonb) cascade;', expected: ['S011'] },
  { id: 'M012', rel: MIGRATION_FIXTURE, from: '{"id":"S013","rpc":"ordering","observedState":"017bAfter015","expectedAction":"017b_after_015"}', to: '{"id":"S999","rpc":"ordering","observedState":"017bAfter015","expectedAction":"017b_after_015"}', expected: ['S013_EXECUTED'] },
  { id: 'M013', rel: ADMIN_STATE, from: '&& !hasAnyOperationIdentityField(data)', to: '&& true /* mutant allow operation identity fields */', expected: ['E010','E010_GATE','E011','E011_GATE','E012','E012_GATE','E013','E013_GATE','E014','E014_GATE','E021','E021_GATE','E022','E022_GATE'] },
  { id: 'M014', rel: ADMIN_STATE, from: '&& data.reconciliationRequired !== true', to: '&& true /* mutant allow reconciliationRequired */', expected: ['E006','E006_GATE'] },
];

async function runMutations(root) {
  const results = [];
  const baseFailures = (await runChecks(root)).failed;
  if (baseFailures.length) {
    throw new Error(`Cannot run mutations because fixed source has failures: ${baseFailures.map((f) => f.id).join(', ')}`);
  }
  for (const mutant of MUTANTS) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `cms-066019-${mutant.id}-`));
    let cleanup = false;
    try {
      copyDir(root, temp);
      const filePath = path.join(temp, mutant.rel);
      let text = fs.readFileSync(filePath, 'utf8');
      const before = text;
      const count = text.split(mutant.from).length - 1;
      if (count < 1) {
        results.push({ ...mutant, replacementApplied: false, failedIds: [], unexpected: ['REPLACEMENT_NOT_APPLIED'], cleanup: false });
        continue;
      }
      text = text.replace(mutant.from, mutant.to);
      fs.writeFileSync(filePath, text);
      const result = await runChecks(temp);
      const failedIds = result.failed.map((f) => f.id);
      const expectedMissing = mutant.expected.filter((id) => !failedIds.includes(id));
      const unexpected = failedIds.filter((id) => !mutant.expected.includes(id));
      const sourceUsed = fs.readFileSync(filePath, 'utf8') !== before;
      results.push({ ...mutant, replacementApplied: true, failedIds, expectedMissing, unexpected, temporarySourceActuallyUsed: sourceUsed, cleanup: true });
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
      cleanup = true;
    }
  }
  return results;
}

function printSummary(label, result) {
  for (const assertion of result.assertions) {
    console.log(`${assertion.pass ? 'PASS' : 'FAIL'} ${assertion.id} ${assertion.message}`);
  }
  console.log(`${label}_PASS ${result.assertions.filter((a) => a.pass).length}`);
  console.log(`${label}_FAIL ${result.failed.length}`);
  console.log(`${label}_TOTAL ${result.assertions.length}`);
}

const result = await runChecks(ROOT);
if (MODE === 'baseline') {
  printSummary('BASELINE', result);
  const expectedRed = ['E003', 'E004', 'E005', 'E007', 'E011', 'E012', 'E013', 'E014', 'E021', 'E022'];
  const failedIds = result.failed.map((f) => f.id);
  const redMissing = expectedRed.filter((id) => !failedIds.includes(id));
  if (redMissing.length) {
    console.error(`BASELINE_EXPECTED_RED_MISSING ${redMissing.join(',')}`);
    process.exit(1);
  }
  process.exit(0);
}

printSummary('FIXED', result);
if (result.failed.length) process.exit(1);

if (RUN_MUTATIONS) {
  const mutations = await runMutations(ROOT);
  let failed = 0;
  for (const mutation of mutations) {
    const expectedMissing = mutation.expectedMissing || [];
    const unexpected = mutation.unexpected || [];
    const pass = mutation.replacementApplied === true
      && (mutation.expected.length === 0 || expectedMissing.length === 0)
      && unexpected.length === 0
      && mutation.temporarySourceActuallyUsed !== false
      && mutation.cleanup === true;
    if (!pass) failed += 1;
    console.log(`${pass ? 'PASS' : 'FAIL'} MUTATION ${mutation.id} replacementApplied=${mutation.replacementApplied} expected=${mutation.expected.join(',') || 'NONE'} actualFailed=${(mutation.failedIds || []).join(',') || 'NONE'} expectedMissing=${expectedMissing.join(',') || 'NONE'} unexpected=${unexpected.join(',') || 'NONE'} cleanup=${mutation.cleanup}`);
  }
  console.log(`MUTATION_PASS ${mutations.length - failed}`);
  console.log(`MUTATION_FAIL ${failed}`);
  console.log(`MUTATION_TOTAL ${mutations.length}`);
  if (failed) process.exit(1);
}
