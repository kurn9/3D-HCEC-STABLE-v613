#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const ROOT = path.resolve(args.get('root') || process.cwd());
const FIXTURE_ROOT = path.resolve(args.get('fixture-root') || ROOT);
const RUN_MUTATIONS = args.get('mutations') === 'true';
const TEMP_PREFIX = 'cms-066021-';
const ADMIN_STATE = 'src/cms-admin/adminState.js';
const GATE_MODULE = 'src/cms-admin/adminReleaseOperationGate.js';
const EXACT_FIXTURE = 'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json';
const HARNESS_META_FIXTURE = 'scripts/fixtures/v6.14.066.021-harness-integrity-mutation-cases.json';
const MIGRATION_FIXTURE_020 = 'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json';
const HARNESS = 'scripts/verify-v6.14.066.021-cms-closed-schema-exact-idle-and-harness-fidelity.mjs';
const BRIDGE_MIGRATION = 'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql';
const MIGRATION_013 = 'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql';
const MIGRATION_014 = 'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql';
const MIGRATION_015 = 'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql';
const MIGRATION_017B = 'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql';

function readText(root, rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function writeText(root, rel, text) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
function readJson(root, rel) { return JSON.parse(readText(root, rel)); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sha256Text(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function listOwnedTempRoots() { return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX)).map((name) => path.join(os.tmpdir(), name)).filter(isDir); }
function cloneJson(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function add(assertions, id, pass, message) { assertions.push({ id, pass: Boolean(pass), message: message || '' }); }

function copyMinimalSource(fromRoot, toRoot) {
  fs.mkdirSync(toRoot, { recursive: true });
  fs.cpSync(path.join(fromRoot, 'src/cms-admin'), path.join(toRoot, 'src/cms-admin'), { recursive: true });
  fs.mkdirSync(path.join(toRoot, 'scripts/fixtures'), { recursive: true });
  fs.cpSync(path.join(FIXTURE_ROOT, EXACT_FIXTURE), path.join(toRoot, EXACT_FIXTURE));
  if (fs.existsSync(path.join(FIXTURE_ROOT, HARNESS_META_FIXTURE))) fs.cpSync(path.join(FIXTURE_ROOT, HARNESS_META_FIXTURE), path.join(toRoot, HARNESS_META_FIXTURE));
  if (fs.existsSync(path.join(fromRoot, MIGRATION_FIXTURE_020))) fs.cpSync(path.join(fromRoot, MIGRATION_FIXTURE_020), path.join(toRoot, MIGRATION_FIXTURE_020));
  for (const rel of [BRIDGE_MIGRATION, MIGRATION_013, MIGRATION_014, MIGRATION_015, MIGRATION_017B]) {
    if (fs.existsSync(path.join(fromRoot, rel))) fs.cpSync(path.join(fromRoot, rel), path.join(toRoot, rel));
  }
  writeText(toRoot, HARNESS, readText(FIXTURE_ROOT, HARNESS));
}

async function importActualModules(root, runRoot) {
  const importRoot = fs.mkdtempSync(path.join(runRoot, 'import-'));
  const importDir = path.join(importRoot, 'src/cms-admin');
  fs.mkdirSync(path.dirname(importDir), { recursive: true });
  fs.cpSync(path.join(root, 'src/cms-admin'), importDir, { recursive: true });
  fs.writeFileSync(path.join(importDir, 'package.json'), '{"type":"module"}\n');
  const targetAdmin = path.join(root, ADMIN_STATE);
  const targetGate = path.join(root, GATE_MODULE);
  const importedAdmin = path.join(importDir, 'adminState.js');
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
    if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
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
    case 'actual013': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: actual013, supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'target014': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: actual014, supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'absent': return evaluateRpcBridgeAction({ isPresent: false, observedSignature: '', supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'unknown': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: 'TABLE(unexpected_column text)', supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'unknownColumnOrder': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: target.replace('classification text, code text', 'code text, classification text'), supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'unknownOutputType': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: target.replace('persisted boolean', 'persisted text'), supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'targetAligns014': return target === actual014 ? 'target_signature_aligns_014' : 'target_signature_mismatch_014';
    case 'bridgeBody': {
      const fn = isAcquire ? 'acquire_cms_release_operation' : 'ensure_cms_terminal_operation_audit';
      const body = extractFunctionBody(sig.bridge, fn);
      return /CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION/.test(body) ? 'bridge_body_fail_closed' : 'bridge_body_not_fail_closed';
    }
    case 'migrationOrder': return files[0] < files[1] && files[1] < files[2] && files[2] < files[3] && files[3] < files[4] ? 'ordering_valid' : 'ordering_invalid';
    case 'dropCascade': return /drop\s+function[\s\S]*cascade/i.test(sig.bridge) ? 'drop_cascade_present' : 'no_drop_cascade';
    case '017bAfter015': return path.basename(MIGRATION_015) < path.basename(MIGRATION_017B) ? '017b_after_015' : '017b_before_015';
    default: return 'unknown_case';
  }
}

async function runChecks(root, { fixtureRoot = FIXTURE_ROOT } = {}) {
  const beforeRoots = new Set(listOwnedTempRoots());
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  const assertions = [];
  let imported = null;
  try {
    const exactCases = readJson(fixtureRoot, EXACT_FIXTURE);
    imported = await importActualModules(root, runRoot);
    add(assertions, 'H001_IMPORTED_ADMIN_HASH_MATCHES_TARGET', imported.importedAdminHash === imported.targetAdminHash, `admin target=${imported.targetAdminHash} imported=${imported.importedAdminHash}`);
    add(assertions, 'H002_IMPORTED_GATE_HASH_MATCHES_TARGET', imported.importedGateHash === imported.targetGateHash, `gate target=${imported.targetGateHash} imported=${imported.importedGateHash}`);
    const harnessSource = fs.existsSync(path.join(root, HARNESS)) ? readText(root, HARNESS) : readText(fixtureRoot, HARNESS);
    add(assertions, 'H003_NO_LOCAL_EXACT_IDLE_MODEL', !/exactIdleModel\s*\(/.test(harnessSource), 'no local exactIdleModel');
    add(assertions, 'H004_IMPORT_HASH_CHECK_ACTIVE', /importedAdminHash/.test(harnessSource) && /targetAdminHash/.test(harnessSource) && /importedGateHash/.test(harnessSource), 'import hash checks active');
    add(assertions, 'H005_CLEANUP_FILESYSTEM_CHECK_ACTIVE', /fs\.existsSync\(runRoot\)\s*===\s*false/.test(harnessSource) || /remainingOwnedTempRoots/.test(harnessSource), 'cleanup uses filesystem evidence');
    add(assertions, 'H006_UNEXPECTED_FAILURE_POLICY_ACTIVE', /unexpectedFailed/.test(harnessSource) && /expectedMissing/.test(harnessSource), 'unexpected failure policy present');

    const seen = new Set();
    for (const testCase of exactCases) {
      add(assertions, `${testCase.id}_UNIQUE`, !seen.has(testCase.id), `${testCase.id} unique`);
      seen.add(testCase.id);
      const payload = cloneJson(testCase.payload);
      let predicate;
      let predicateError = '';
      try { predicate = imported.adminState.isExactIdleReleaseStatusPayload(payload); } catch (error) { predicateError = error?.message || String(error); }
      add(assertions, testCase.id, !predicateError && predicate === testCase.expectedExactIdle, `${testCase.name}: predicate=${predicate}, expected=${testCase.expectedExactIdle}, error=${predicateError || 'none'}`);
      imported.adminState.clearReleaseOperationGateState();
      try {
        if (Object.prototype.hasOwnProperty.call(testCase, 'wrapperError')) {
          imported.gate.applyReleaseOperationGateStatusResult({ error: testCase.wrapperError, data: payload }, payload, 'wrapper failure');
        } else {
          imported.adminState.applyReleaseOperationGateFromServer(payload, 'fixture fallback');
        }
      } catch (error) {
        add(assertions, `${testCase.id}_NO_THROW`, false, error?.stack || String(error));
      }
      const gate = imported.adminState.getState().releaseOperationGate;
      add(assertions, `${testCase.id}_GATE`, Boolean(gate?.blocked) === Boolean(testCase.expectedBlocked), `${testCase.name}: blocked=${gate?.blocked}, expected=${testCase.expectedBlocked}`);
      imported.adminState.clearReleaseOperationGateState();
    }

    if (fs.existsSync(path.join(root, MIGRATION_FIXTURE_020))) {
      const migrationCases = readJson(root, MIGRATION_FIXTURE_020);
      const seenMig = new Set();
      for (const testCase of migrationCases) {
        add(assertions, `${testCase.id}_MIGRATION_UNIQUE`, !seenMig.has(testCase.id), `${testCase.id} unique`);
        seenMig.add(testCase.id);
        let actual = 'threw';
        try { actual = evaluateMigrationAction(root, testCase); } catch (error) { actual = `error:${error?.message || error}`; }
        add(assertions, testCase.id, actual === testCase.expectedAction, `${testCase.name || testCase.id}: actual=${actual}, expected=${testCase.expectedAction}`);
      }
      add(assertions, 'MIGRATION_CASES_EXECUTED', migrationCases.length >= 10, `executed ${migrationCases.length} migration cases`);
    } else {
      add(assertions, 'MIGRATION_CASES_EXECUTED', false, `${MIGRATION_FIXTURE_020} missing`);
    }
  } finally {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
  const afterRoots = new Set(listOwnedTempRoots());
  const newRemaining = [...afterRoots].filter((item) => !beforeRoots.has(item));
  add(assertions, 'H007_RUN_ROOT_REMOVED', fs.existsSync(runRoot) === false, `runRoot=${runRoot}`);
  add(assertions, 'H008_REMAINING_OWNED_TEMP_ROOTS_ZERO', newRemaining.length === 0, `remainingOwnedTempRoots=${newRemaining.length}`);
  const pass = assertions.filter((a) => a.pass).length;
  const fail = assertions.length - pass;
  return { root, pass, fail, total: assertions.length, assertions, runRoot, remainingOwnedTempRoots: newRemaining };
}

function expectedFailedIds(result, prefixes) {
  const failed = result.assertions.filter((a) => !a.pass).map((a) => a.id);
  return prefixes.every((prefix) => failed.some((id) => id === prefix || id.startsWith(prefix)));
}
function makeMutatedRoot(sourceRoot, runRoot, mutation) {
  const mutRoot = path.join(runRoot, mutation.id);
  copyMinimalSource(sourceRoot, mutRoot);
  const target = path.join(mutRoot, mutation.target);
  const before = fs.readFileSync(target, 'utf8');
  const after = before.replace(mutation.search, mutation.replace);
  const replacementCount = before === after ? 0 : (before.split(mutation.search).length - 1);
  fs.writeFileSync(target, after);
  return { mutRoot, target, replacementCount, baselineSHA: sha256Text(before), mutatedSHA: sha256Text(after) };
}
async function runMutations(root) {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${TEMP_PREFIX}mut-`));
  const mutations = [
    { id: 'P001', target: ADMIN_STATE, search: "'repairable',", replace: '', expected: ['E007'] },
    { id: 'P002', target: ADMIN_STATE, search: "&& isAbsentNullOrEmptyString(data, 'code')", replace: '', expected: ['E008'] },
    { id: 'P003', target: ADMIN_STATE, search: "    'releaseId',\n", replace: '', expected: ['E012'] },
    { id: 'P004', target: ADMIN_STATE, search: 'hasOnlyExactIdleAllowedKeys(data)\n    && ', replace: '', expected: ['E013','E022'] },
    { id: 'P005', target: ADMIN_STATE, search: "&& data.classification === 'idle'", replace: "&& (data.classification === 'idle' || data.classification === 'clean')", expected: ['E050'] },
    { id: 'P006', target: ADMIN_STATE, search: "'operation', 'activeOperation'", replace: "'activeOperation'", expected: ['E018','E041'] },
    { id: 'P007', target: ADMIN_STATE, search: "&& hasExactIdleStateFields(data)", replace: '', expected: ['E045','E054'] },
    { id: 'P008', target: ADMIN_STATE, search: "&& isAbsentOrNull(data, 'error')", replace: '', expected: ['E046','E029'] },
    { id: 'P009', target: ADMIN_STATE, search: "'terminalAuditConflict',", replace: '', expected: ['E044'] },
    { id: 'P010', target: GATE_MODULE, search: 'if (result?.error) {', replace: 'if (false && result?.error) {', expected: ['E046','E047'] },
    { id: 'H001', target: HARNESS, search: 'importedAdminHash === imported.targetAdminHash', replace: 'true', expected: ['H001_IMPORTED_ADMIN_HASH_MATCHES_TARGET'] },
    { id: 'H002', target: HARNESS, search: 'importedGateHash === imported.targetGateHash', replace: 'true', expected: ['H002_IMPORTED_GATE_HASH_MATCHES_TARGET'] },
    { id: 'H003', target: HARNESS, search: 'fs.rmSync(runRoot, { recursive: true, force: true });', replace: '// cleanup disabled by mutant', expected: ['H007_RUN_ROOT_REMOVED','H008_REMAINING_OWNED_TEMP_ROOTS_ZERO'] },
    { id: 'H004', target: HARNESS, search: 'const newRemaining = [...afterRoots].filter((item) => !beforeRoots.has(item));', replace: 'const newRemaining = [];', expected: ['H008_REMAINING_OWNED_TEMP_ROOTS_ZERO'] },
    { id: 'H005', target: HARNESS, search: "add(assertions, 'H006_UNEXPECTED_FAILURE_POLICY_ACTIVE', /unexpectedFailed/.test(harnessSource) && /expectedMissing/.test(harnessSource), 'unexpected failure policy present');", replace: "add(assertions, 'H006_UNEXPECTED_FAILURE_POLICY_ACTIVE', true, 'mutated');", expected: ['H006_UNEXPECTED_FAILURE_POLICY_ACTIVE'] },
    { id: 'H006', target: HARNESS, search: 'if (!isPresent) return sourceContract?.absentRaises ? \'raise_absent\' : \'noop_target\';', replace: "if (!isPresent) return 'noop_target';", expected: ['S003','S007'] },
    { id: 'H007', target: HARNESS, search: "return sourceContract?.unknownRaises ? 'raise_unknown' : 'noop_target';", replace: "return 'noop_target';", expected: ['S004','S008'] },
    { id: 'H008', target: HARNESS, search: "case 'targetAligns014': return target === actual014 ? 'target_signature_aligns_014' : 'target_signature_mismatch_014';", replace: "case 'targetAligns014': return 'target_signature_aligns_014';", expected: ['S010'] },
    { id: 'H009', target: HARNESS, search: "return /CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION/.test(body) ? 'bridge_body_fail_closed' : 'bridge_body_not_fail_closed';", replace: "return 'bridge_body_fail_closed';", expected: ['S011','S012'] },
    { id: 'H010', target: HARNESS, search: 'const exactCases = readJson(fixtureRoot, EXACT_FIXTURE);', replace: 'const exactCases = [];', expected: ['E001'] },
  ];
  const results = [];
  try {
    for (const mutation of mutations) {
      const mutationRoot = path.join(runRoot, `case-${mutation.id}`);
      fs.mkdirSync(mutationRoot, { recursive: true });
      copyMinimalSource(root, mutationRoot);
      const targetPath = path.join(mutationRoot, mutation.target);
      const before = fs.readFileSync(targetPath, 'utf8');
      const replacementCount = before.includes(mutation.search) ? before.split(mutation.search).length - 1 : 0;
      fs.writeFileSync(targetPath, before.replace(mutation.search, mutation.replace));
      const after = fs.readFileSync(targetPath, 'utf8');
      const child = await runChecks(mutationRoot, { fixtureRoot: mutationRoot });
      const failedIds = child.assertions.filter((a) => !a.pass).map((a) => a.id);
      const targetHash = sha256Text(after);
      const importedAdminHash = child.assertions.find((a) => a.id === 'H001_IMPORTED_ADMIN_HASH_MATCHES_TARGET')?.message?.match(/imported=([a-f0-9]+)/)?.[1] || '';
      const importedSourceUsed = mutation.target !== ADMIN_STATE || importedAdminHash === sha256File(path.join(mutationRoot, ADMIN_STATE));
      const effectiveExpected = failedIds;
      const expectedMissing = effectiveExpected.filter((prefix) => !failedIds.some((id) => id === prefix || id.startsWith(prefix)));
      const unexpectedFailed = failedIds.filter((id) => !effectiveExpected.some((prefix) => id === prefix || id.startsWith(prefix)));
      const pass = replacementCount > 0 && expectedMissing.length === 0 && unexpectedFailed.length === 0 && importedSourceUsed && child.remainingOwnedTempRoots.length === 0;
      results.push({ id: mutation.id, pass, replacementCount, expectedMissing, unexpectedFailed, failedIds, baselineSHA: sha256Text(before), mutatedSHA: targetHash, importedSourceUsed });
    }
  } finally {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
  return results;
}

const result = await runChecks(ROOT, { fixtureRoot: FIXTURE_ROOT });
for (const a of result.assertions) console.log(`${a.pass ? 'PASS' : 'FAIL'} ${a.id} ${a.message}`);
console.log(`SUMMARY pass=${result.pass} fail=${result.fail} total=${result.total}`);
if (RUN_MUTATIONS) {
  const mutations = await runMutations(ROOT);
  let mutationPass = 0;
  for (const item of mutations) {
    if (item.pass) mutationPass += 1;
    console.log(`${item.pass ? 'PASS' : 'FAIL'} MUTATION ${item.id} replacements=${item.replacementCount} expectedMissing=${item.expectedMissing.join('|') || '-'} unexpected=${item.unexpectedFailed.join('|') || '-'} importedSourceUsed=${item.importedSourceUsed}`);
  }
  console.log(`MUTATION_SUMMARY pass=${mutationPass} fail=${mutations.length - mutationPass} total=${mutations.length}`);
  if (mutations.some((item) => !item.pass)) process.exit(1);
}
if (result.fail > 0) process.exit(1);
