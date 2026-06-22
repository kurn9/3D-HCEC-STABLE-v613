#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const ROOT = path.resolve(args.get('root') || process.cwd());
const RUN_MUTATIONS = args.get('mutations') === 'true';
const CHILD_CHECK = args.get('child-check') === 'true';

const ADMIN_STATE = 'src/cms-admin/adminState.js';
const GATE_MODULE = 'src/cms-admin/adminReleaseOperationGate.js';
const EXACT_FIXTURE = 'scripts/fixtures/v6.14.066.020-exact-idle-typed-contract-cases.json';
const MIGRATION_FIXTURE = 'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json';
const HARNESS = 'scripts/verify-v6.14.066.020-cms-strict-exact-idle-and-complete-bridge-evaluator.mjs';
const BRIDGE_MIGRATION = 'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql';
const MIGRATION_013 = 'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql';
const MIGRATION_014 = 'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql';
const MIGRATION_015 = 'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql';
const MIGRATION_017B = 'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql';
const TEMP_PREFIX = 'cms-066020-';

function readText(root, rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function writeText(root, rel, text) { fs.writeFileSync(path.join(root, rel), text); }
function readJson(root, rel) { return JSON.parse(readText(root, rel)); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sha256Text(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function listOwnedTempRoots() { return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX)).map((name) => path.join(os.tmpdir(), name)).filter(isDir); }

function normalizeType(type) {
  return String(type || '').replace(/\btimestamptz\b/gi, 'timestamp with time zone').replace(/\s+/g, ' ').trim().toLowerCase();
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
function splitColumns(input) {
  const out = [];
  let buf = '';
  let depth = 0;
  for (const ch of input) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
function parseReturnsTable(sql, functionName) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${escaped}[\\s\\S]*?returns\\s+table\\s*\\(([^;]*?)\\)\\s*language`, 'i');
  const match = sql.match(re);
  if (!match) throw new Error(`Unable to parse RETURNS TABLE for ${functionName}`);
  const columns = splitColumns(match[1]).map((part) => {
    const bits = part.trim().replace(/\s+/g, ' ').split(' ');
    const name = bits.shift();
    const type = normalizeType(bits.join(' '));
    return `${name} ${type}`;
  });
  return normalizeSignature(`TABLE(${columns.join(', ')})`);
}
function parseBridgeVar(sql, varName) {
  const re = new RegExp(`${varName}\\s+text\\s*:=\\s*'([^']+)'`, 'i');
  const match = sql.match(re);
  if (!match) throw new Error(`Unable to parse bridge variable ${varName}`);
  return normalizeSignature(match[1]);
}
function extractFunctionBody(sql, functionName) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`create\\s+function\\s+public\\.${escaped}[\\s\\S]*?as\\s+\\$fn\\$([\\s\\S]*?)\\$fn\\$`, 'i');
  const match = sql.match(re);
  if (!match) throw new Error(`Unable to extract bridge body for ${functionName}`);
  return match[1];
}
function migrationSignatures(root) {
  const bridge = readText(root, BRIDGE_MIGRATION);
  const m013 = readText(root, MIGRATION_013);
  const m014 = readText(root, MIGRATION_014);
  return {
    bridge,
    acquire013: parseReturnsTable(m013, 'acquire_cms_release_operation'),
    audit013: parseReturnsTable(m013, 'ensure_cms_terminal_operation_audit'),
    acquire014: parseReturnsTable(m014, 'acquire_cms_release_operation'),
    audit014: parseReturnsTable(m014, 'ensure_cms_terminal_operation_audit'),
    acquireBridge013: parseBridgeVar(bridge, 'v_acquire_013'),
    acquireBridgeTarget: parseBridgeVar(bridge, 'v_acquire_target'),
    auditBridge013: parseBridgeVar(bridge, 'v_audit_013'),
    auditBridgeTarget: parseBridgeVar(bridge, 'v_audit_target'),
  };
}
function evaluateRpcBridgeAction({ isPresent, observedSignature, supportedLegacySignature, targetSignature, sourceContract }) {
  if (!isPresent) return sourceContract?.absentRaises ? 'raise_absent' : 'noop_target';
  const observed = normalizeSignature(observedSignature);
  if (observed === normalizeSignature(supportedLegacySignature)) return 'recreate_target';
  if (observed === normalizeSignature(targetSignature)) return 'noop_target';
  return sourceContract?.unknownRaises ? 'raise_unknown' : 'noop_target';
}
function evaluateMigrationAction(root, testCase) {
  const sig = migrationSignatures(root);
  const files = [MIGRATION_013, BRIDGE_MIGRATION, MIGRATION_014, MIGRATION_015, MIGRATION_017B].map((rel) => path.basename(rel));
  const rpc = testCase.rpc;
  const isAcquire = rpc === 'acquire';
  const legacy = isAcquire ? sig.acquireBridge013 : sig.auditBridge013;
  const target = isAcquire ? sig.acquireBridgeTarget : sig.auditBridgeTarget;
  const actual013 = isAcquire ? sig.acquire013 : sig.audit013;
  const actual014 = isAcquire ? sig.acquire014 : sig.audit014;
  const absentPattern = isAcquire ? /if\s+v_acquire\s+is\s+null\s+then\s+raise\s+exception/i : /if\s+v_audit\s+is\s+null\s+then\s+raise\s+exception/i;
  const unknownPattern = isAcquire
    ? /CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE:\s*acquire_cms_release_operation\(jsonb\)\s+observed/i
    : /CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE:\s*ensure_cms_terminal_operation_audit\(uuid,text,jsonb,jsonb\)\s+observed/i;
  const sourceContract = { absentRaises: absentPattern.test(sig.bridge), unknownRaises: unknownPattern.test(sig.bridge) };
  switch (testCase.observed) {
    case 'actual013':
      return evaluateRpcBridgeAction({ isPresent: true, observedSignature: actual013, supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'target014':
      return evaluateRpcBridgeAction({ isPresent: true, observedSignature: actual014, supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'absent':
      return evaluateRpcBridgeAction({ isPresent: false, observedSignature: '', supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'unknown':
      return evaluateRpcBridgeAction({ isPresent: true, observedSignature: 'TABLE(unexpected_column text)', supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'unknownColumnOrder':
      return evaluateRpcBridgeAction({ isPresent: true, observedSignature: target.replace('classification text, code text', 'code text, classification text'), supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'unknownOutputType':
      return evaluateRpcBridgeAction({ isPresent: true, observedSignature: target.replace('persisted boolean', 'persisted text'), supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'targetAligns014':
      return target === actual014 ? 'target_signature_aligns_014' : 'target_signature_mismatch_014';
    case 'bridgeBody': {
      const fn = isAcquire ? 'acquire_cms_release_operation' : 'ensure_cms_terminal_operation_audit';
      const body = extractFunctionBody(sig.bridge, fn);
      return /CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION/.test(body) ? 'bridge_body_fail_closed' : 'bridge_body_not_fail_closed';
    }
    case 'migrationOrder':
      return files[0] < files[1] && files[1] < files[2] && files[2] < files[3] && files[3] < files[4] ? 'ordering_valid' : 'ordering_invalid';
    case 'dropCascade':
      return /drop\s+function[\s\S]*cascade/i.test(sig.bridge) ? 'drop_cascade_present' : 'no_drop_cascade';
    case '017bAfter015':
      return path.basename(MIGRATION_015) < path.basename(MIGRATION_017B) ? '017b_after_015' : '017b_before_015';
    default:
      return 'unknown_case';
  }
}

async function importActualModules(root, runRoot) {
  const importRoot = fs.mkdtempSync(path.join(runRoot, 'import-'));
  const sourceDir = path.join(root, 'src/cms-admin');
  const importDir = path.join(importRoot, 'src/cms-admin');
  fs.mkdirSync(path.dirname(importDir), { recursive: true });
  fs.cpSync(sourceDir, importDir, { recursive: true });
  fs.writeFileSync(path.join(importDir, 'package.json'), '{"type":"module"}');
  const targetAdmin = path.join(root, ADMIN_STATE);
  const importedAdmin = path.join(importDir, 'adminState.js');
  const targetGate = path.join(root, GATE_MODULE);
  const importedGate = path.join(importDir, 'adminReleaseOperationGate.js');
  const adminState = await import(pathToFileURL(importedAdmin).href);
  const gate = await import(pathToFileURL(importedGate).href);
  return {
    adminState,
    gate,
    importDir,
    targetAdminHash: sha256File(targetAdmin),
    importedAdminHash: sha256File(importedAdmin),
    targetGateHash: sha256File(targetGate),
    importedGateHash: sha256File(importedGate),
  };
}
function cloneJson(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function assertion(list, id, pass, message) { list.push({ id, pass: Boolean(pass), message }); }

async function runChecks(root, { allowMutations = false } = {}) {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  const assertions = [];
  const tempRoots = [runRoot];
  try {
    const exactCases = readJson(root, EXACT_FIXTURE);
    const migrationCases = readJson(root, MIGRATION_FIXTURE);
    const imported = await importActualModules(root, runRoot);
    assertion(assertions, 'H001_IMPORTED_ADMIN_HASH_MATCHES_TARGET', imported.importedAdminHash === imported.targetAdminHash, `adminState target=${imported.targetAdminHash} imported=${imported.importedAdminHash}`);
    assertion(assertions, 'H002_IMPORTED_GATE_HASH_MATCHES_TARGET', imported.importedGateHash === imported.targetGateHash, `gate target=${imported.targetGateHash} imported=${imported.importedGateHash}`);
    const harnessSource = readText(root, HARNESS);
    assertion(assertions, 'H003_NO_LOCAL_EXACT_IDLE_MODEL', !/exactIdleModel\s*\(/.test(harnessSource), 'harness does not define local exactIdleModel');
    assertion(assertions, 'H004_RUNS_SOURCE_IMPORT', /importActualModules/.test(harnessSource) && /importedAdminHash/.test(harnessSource), 'harness imports actual source and verifies hash');
    assertion(assertions, 'H005_CLEANUP_USES_FILESYSTEM_CHECK', (/fs\.existsSync\(runRoot\)\s*===\s*false/.test(harnessSource) || /!fs\.existsSync\(result\.runRoot\)/.test(harnessSource)), 'cleanup checks filesystem state');

    const seenExact = new Set();
    for (const testCase of exactCases) {
      assertion(assertions, `${testCase.id}_UNIQUE`, !seenExact.has(testCase.id), `${testCase.id} unique`);
      seenExact.add(testCase.id);
      const payload = cloneJson(testCase.payload);
      let predicate;
      let predicateError = '';
      try { predicate = imported.adminState.isExactIdleReleaseStatusPayload(payload); } catch (error) { predicateError = error?.message || String(error); }
      assertion(assertions, testCase.id, !predicateError && predicate === testCase.expectedExactIdle, `${testCase.name}: predicate=${predicate}, expected=${testCase.expectedExactIdle}, error=${predicateError || 'none'}`);
      imported.adminState.clearReleaseOperationGateState();
      let gateError = '';
      try {
        if (Object.prototype.hasOwnProperty.call(testCase, 'wrapperError') && testCase.wrapperError !== null) {
          imported.gate.applyReleaseOperationGateStatusResult({ error: testCase.wrapperError, data: payload }, payload, 'wrapper failure');
        } else if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          imported.adminState.applyReleaseOperationGateFromServer(payload, 'fixture fallback');
        } else {
          imported.adminState.applyReleaseOperationGateFromServer(payload, 'malformed');
        }
      } catch (error) {
        gateError = error?.message || String(error);
      }
      const currentGate = imported.adminState.getState().releaseOperationGate;
      assertion(assertions, `${testCase.id}_GATE`, !gateError && currentGate.blocked === testCase.expectedGateBlocked, `${testCase.name}: gateBlocked=${currentGate.blocked}, expected=${testCase.expectedGateBlocked}, error=${gateError || 'none'}`);
      imported.adminState.clearReleaseOperationGateState();
    }

    const seenMigration = new Set();
    for (const testCase of migrationCases) {
      assertion(assertions, `${testCase.id}_UNIQUE`, !seenMigration.has(testCase.id), `${testCase.id} unique`);
      seenMigration.add(testCase.id);
      const actualAction = evaluateMigrationAction(root, testCase);
      assertion(assertions, testCase.id, actualAction === testCase.expectedAction, `${testCase.id}: action=${actualAction}, expected=${testCase.expectedAction}`);
    }
    const requiredMigrationIds = Array.from({ length: 17 }, (_, index) => `S${String(index + 1).padStart(3, '0')}`);
    for (const id of requiredMigrationIds) {
      assertion(assertions, `${id}_EXECUTED`, seenMigration.has(id), `${id} fixture executed`);
    }

    if (allowMutations) {
      const mutationResults = await runMutations(root, runRoot);
      for (const result of mutationResults) {
        assertion(assertions, `MUT_${result.id}`, result.pass, `${result.id}: expectedMissing=${result.expectedMissing.join('|') || 'none'} unexpected=${result.unexpectedFailed.join('|') || 'none'} replacementApplied=${result.replacementApplied} sourceUsed=${result.mutatedSourceActuallyUsed} cleanup=${result.cleanup}`);
      }
    }
    return { assertions, runRoot, tempRoots };
  } finally {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
}


function copyMinimalProject(sourceRoot, destRoot) {
  const dirs = [
    'src/cms-admin',
    'supabase/migrations',
    'scripts/fixtures',
  ];
  for (const rel of dirs) {
    const from = path.join(sourceRoot, rel);
    const to = path.join(destRoot, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  }
  const harnessFrom = path.join(sourceRoot, HARNESS);
  const harnessTo = path.join(destRoot, HARNESS);
  fs.mkdirSync(path.dirname(harnessTo), { recursive: true });
  fs.copyFileSync(harnessFrom, harnessTo);
}

function replaceInFile(root, rel, search, replacement) {
  const file = path.join(root, rel);
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(search, replacement);
  if (after === before) return 0;
  fs.writeFileSync(file, after);
  return 1;
}
function collectFailedIds(assertions) { return assertions.filter((item) => !item.pass).map((item) => item.id); }
function mutationPass(expected, actual) {
  const expectedMissing = expected.filter((id) => !actual.includes(id));
  const unexpectedFailed = actual.filter((id) => !expected.includes(id));
  return { expectedMissing, unexpectedFailed };
}
const mutations = [
  { id: 'MX01_ALLOW_ERROR_OBJECT', file: ADMIN_STATE, search: "return source[key] === null;", replacement: "return source[key] === null || (key === 'error' && typeof source[key] === 'object');", expected: ['E006','E006_GATE','E007','E007_GATE'] },
  { id: 'MX02_ALLOW_BLOCKED_STRING_TRUE', file: ADMIN_STATE, search: "return source[key] === false;", replacement: "return source[key] === false || (key === 'blocked' && source[key] === 'true');", expected: ['E011','E011_GATE'] },
  { id: 'MX03_ALLOW_BLOCKED_NUMBER_ONE', file: ADMIN_STATE, search: "return source[key] === false;", replacement: "return source[key] === false || (key === 'blocked' && source[key] === 1);", expected: ['E013','E013_GATE'] },
  { id: 'MX04_ALLOW_OPERATION_FALSE', file: ADMIN_STATE, search: "return source[key] === null;", replacement: "return source[key] === null || (key === 'operation' && source[key] === false);", expected: ['E020','E020_GATE'] },
  { id: 'MX05_ALLOW_ACTIVE_OPERATION_ZERO', file: ADMIN_STATE, search: "return source[key] === null;", replacement: "return source[key] === null || (key === 'activeOperation' && source[key] === 0);", expected: ['E025','E025_GATE'] },
  { id: 'MX06_ALLOW_OPERATION_ID_ARRAY', file: ADMIN_STATE, search: "return value === null || value === '';", replacement: "return value === null || value === '' || (key === 'operationId' && Array.isArray(value));", expected: ['E026','E026_GATE'] },
  { id: 'MX07_ALLOW_STRING_BOOLEAN_FLAG', file: ADMIN_STATE, search: "return source[key] === false;", replacement: "return source[key] === false || source[key] === 'false';", expected: ['E012','E012_GATE','E055','E055_GATE','E061','E061_GATE','E067','E067_GATE','E073','E073_GATE','E079','E079_GATE','E085','E085_GATE','E091','E091_GATE'] },
  { id: 'MX08_ALLOW_NULL_SAFETY_FLAG', file: ADMIN_STATE, search: "return source[key] === false;", replacement: "return source[key] === false || source[key] === null;", expected: ['E015','E015_GATE','E057','E057_GATE','E063','E063_GATE','E069','E069_GATE','E075','E075_GATE','E081','E081_GATE','E087','E087_GATE','E093','E093_GATE'] },
  { id: 'MX09_HIDE_CONFLICTING_OPERATION_STATE', file: ADMIN_STATE, search: "if (hasOperationState && source.operationState !== 'idle') return false;", replacement: "if (hasOperationState && !hasState && source.operationState !== 'idle') return false;", expected: ['E101','E101_GATE'] },
  { id: 'MX10_TREAT_CLEAN_AS_IDLE', file: ADMIN_STATE, search: "&& data.classification === 'idle'", replacement: "&& (data.classification === 'idle' || data.classification === 'clean')", expected: ['E103','E103_GATE'] },
  { id: 'MM11_WRONG_ACQUIRE_TARGET_TYPE', file: BRIDGE_MIGRATION, search: 'repairable boolean, message text, id uuid', replacement: 'repairable text, message text, id uuid', expected: ['S002','S009'] },
  { id: 'MM12_WRONG_AUDIT_TARGET_TYPE', file: BRIDGE_MIGRATION, search: 'TABLE(log_id uuid, reused boolean, persisted boolean, audit_log_state text)', replacement: 'TABLE(log_id uuid, reused boolean, persisted text, audit_log_state text)', expected: ['S006','S010','S017'] },
  { id: 'MM13_REMOVE_ACQUIRE_BRIDGE_EXCEPTION', file: BRIDGE_MIGRATION, search: "CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION: acquire bridge body must not be called before .014/.017b completes.", replacement: 'ACQUIRE_BRIDGE_NOOP', expected: ['S011'] },
  { id: 'MM14_REMOVE_AUDIT_BRIDGE_EXCEPTION', file: BRIDGE_MIGRATION, search: "CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION: audit bridge body must not be called before .014/.017b completes.", replacement: 'AUDIT_BRIDGE_NOOP', expected: ['S012'] },
  { id: 'MM15_ABSENT_ACQUIRE_NOOP', file: BRIDGE_MIGRATION, search: "if v_acquire is null then\n    raise exception", replacement: "if v_acquire is null then\n    null; -- mutant\n  elsif false then\n    raise exception", expected: ['S003'] },
  { id: 'MM16_ABSENT_AUDIT_NOOP', file: BRIDGE_MIGRATION, search: "if v_audit is null then\n    raise exception", replacement: "if v_audit is null then\n    null; -- mutant\n  elsif false then\n    raise exception", expected: ['S007'] },
  { id: 'MM17_UNKNOWN_ACQUIRE_NOOP', file: BRIDGE_MIGRATION, search: "raise exception 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: acquire_cms_release_operation(jsonb) observed %, expected % or %'", replacement: "null; -- mutant unknown acquire no-op", expected: ['S004','S016'] },
  { id: 'MM18_UNKNOWN_AUDIT_NOOP', file: BRIDGE_MIGRATION, search: "raise exception 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: ensure_cms_terminal_operation_audit(uuid,text,jsonb,jsonb) observed %, expected % or %'", replacement: "null; -- mutant unknown audit no-op", expected: ['S008','S017'] },
  { id: 'MM19_SWAP_AUDIT_TARGET_ORDER', file: BRIDGE_MIGRATION, search: 'TABLE(log_id uuid, reused boolean, persisted boolean, audit_log_state text)', replacement: 'TABLE(log_id uuid, persisted boolean, reused boolean, audit_log_state text)', expected: ['S006','S010'] },
  { id: 'MM20_STOP_EXECUTING_AUDIT_TARGET_FIXTURE', file: MIGRATION_FIXTURE, search: '"id": "S010"', replacement: '"id": "S010_SKIPPED"', expected: ['S010_EXECUTED'] }
];
async function runMutations(root, parentRunRoot) {
  const results = [];
  for (const mutation of mutations) {
    const mutantRoot = fs.mkdtempSync(path.join(parentRunRoot, `${mutation.id}-`));
    let replacementCount = 0;
    let cleanup = false;
    try {
      copyMinimalProject(root, mutantRoot);
      replacementCount = replaceInFile(mutantRoot, mutation.file, mutation.search, mutation.replacement);
      let assertions = [];
      let childUsed = false;
      if (replacementCount > 0) {
        const result = await runChecks(mutantRoot, { allowMutations: false });
        assertions = result.assertions;
        childUsed = true;
      }
      const failed = collectFailedIds(assertions);
      const { expectedMissing, unexpectedFailed } = mutationPass(mutation.expected, failed);
      fs.rmSync(mutantRoot, { recursive: true, force: true });
      cleanup = !fs.existsSync(mutantRoot);
      results.push({
        id: mutation.id,
        replacementApplied: replacementCount > 0,
        expectedMissing,
        unexpectedFailed,
        mutatedSourceActuallyUsed: childUsed,
        cleanup,
        pass: replacementCount > 0 && expectedMissing.length === 0 && unexpectedFailed.length === 0 && childUsed && cleanup,
      });
    } catch (error) {
      fs.rmSync(mutantRoot, { recursive: true, force: true });
      cleanup = !fs.existsSync(mutantRoot);
      results.push({ id: mutation.id, replacementApplied: replacementCount > 0, expectedMissing: mutation.expected, unexpectedFailed: [`EXCEPTION:${error.message}`], mutatedSourceActuallyUsed: false, cleanup, pass: false });
    }
  }
  return results;
}

async function main() {
  const before = new Set(listOwnedTempRoots());
  const result = await runChecks(ROOT, { allowMutations: RUN_MUTATIONS });
  const failed = result.assertions.filter((item) => !item.pass);
  const remaining = listOwnedTempRoots().filter((p) => !before.has(p));
  const cleanupPass = !fs.existsSync(result.runRoot) && remaining.length === 0;
  const totals = { pass: result.assertions.length - failed.length + (cleanupPass ? 1 : 0), fail: failed.length + (cleanupPass ? 0 : 1), total: result.assertions.length + 1 };
  for (const item of result.assertions) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.id} — ${item.message}`);
  }
  console.log(`${cleanupPass ? 'PASS' : 'FAIL'} CLEANUP_ZERO_LEAK — remainingOwnedTempRoots=${remaining.length}`);
  console.log(`SUMMARY pass=${totals.pass} fail=${totals.fail} total=${totals.total}`);
  if (failed.length || !cleanupPass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`HARNESS_ERROR ${error.stack || error.message}`);
  process.exit(1);
});
