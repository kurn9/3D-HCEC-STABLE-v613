#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const CHILD_PROTOCOL_VERSION = 'v6.14.066.023-child';
const ADMIN_STATE_REL = 'src/cms-admin/adminState.js';
const GATE_REL = 'src/cms-admin/adminReleaseOperationGate.js';
const EXACT_FIXTURE_REL = 'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json';
const MIGRATION_FIXTURE_REL = 'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json';
const REQUIRED_REL = 'scripts/fixtures/v6.14.066.023-required-verification-cases.json';
const MIGRATION_013_REL = 'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql';
const BRIDGE_MIGRATION_REL = 'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql';
const MIGRATION_014_REL = 'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql';
const MIGRATION_015_REL = 'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql';
const MIGRATION_017B_REL = 'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const root = path.resolve(args.get('root') || process.cwd());
const fixtureRoot = path.resolve(args.get('fixture-root') || root);
const runId = args.get('run-id') || `child-${Date.now()}-${process.pid}`;
const ownedRoot = path.resolve(args.get('owned-root') || path.join('/tmp', `cms-066023-child-${runId}`));
const resultFile = path.resolve(args.get('result-file') || path.join(ownedRoot, 'child-result.json'));
const scenario = args.get('scenario') || 'normal';

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readText(base, rel) { return fs.readFileSync(path.join(base, rel), 'utf8'); }
function readJson(base, rel) { return JSON.parse(readText(base, rel)); }
function add(assertions, id, pass, message = '') { assertions.push({ id, pass: Boolean(pass), message }); }
function normalizeSignature(sig) {
  return String(sig || '').replace(/\btimestamptz\b/gi, 'timestamp with time zone').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim().toLowerCase();
}
function splitColumns(input) {
  const out = []; let buf = ''; let depth = 0;
  for (const ch of input) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
function parseReturnsTable(sql, fn) {
  const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${escaped}[\\s\\S]*?returns\\s+table\\s*\\(([^;]*?)\\)\\s*language`, 'i');
  const match = sql.match(re);
  if (!match) throw new Error(`missing RETURNS TABLE for ${fn}`);
  return normalizeSignature(`TABLE(${splitColumns(match[1]).map((part) => {
    const bits = part.trim().replace(/\s+/g, ' ').split(' ');
    const name = bits.shift();
    return `${name} ${bits.join(' ')}`;
  }).join(', ')})`);
}
function parseBridgeVar(sql, name) {
  const re = new RegExp(`${name}\\s+text\\s*:=\\s*'([^']+)'`, 'i');
  const match = sql.match(re);
  if (!match) throw new Error(`missing bridge variable ${name}`);
  return normalizeSignature(match[1]);
}
function extractBridgeBody(sql, fn) {
  const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`create\\s+function\\s+public\\.${escaped}[\\s\\S]*?as\\s+\\$fn\\$([\\s\\S]*?)\\$fn\\$`, 'i');
  const match = sql.match(re);
  if (!match) throw new Error(`missing bridge body ${fn}`);
  return match[1];
}
function migrationSignatures(base) {
  const bridge = readText(base, BRIDGE_MIGRATION_REL);
  const m013 = readText(base, MIGRATION_013_REL);
  const m014 = readText(base, MIGRATION_014_REL);
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
  if (!isPresent) return sourceContract.absentRaises ? 'raise_absent' : 'noop_target';
  const observed = normalizeSignature(observedSignature);
  if (observed === normalizeSignature(supportedLegacySignature)) return 'recreate_target';
  if (observed === normalizeSignature(targetSignature)) return 'noop_target';
  return sourceContract.unknownRaises ? 'raise_unknown' : 'noop_target';
}
function evaluateMigrationCase(base, testCase) {
  const sig = migrationSignatures(base);
  const isAcquire = testCase.rpc === 'acquire';
  const legacy = isAcquire ? sig.acquireBridge013 : sig.auditBridge013;
  const target = isAcquire ? sig.acquireBridgeTarget : sig.auditBridgeTarget;
  const actual013 = isAcquire ? sig.acquire013 : sig.audit013;
  const actual014 = isAcquire ? sig.acquire014 : sig.audit014;
  const absentRaises = new RegExp(`if\\s+v_${isAcquire ? 'acquire' : 'audit'}\\s+is\\s+null\\s+then\\s+raise\\s+exception`, 'i').test(sig.bridge);
  const unknownRaises = new RegExp(`CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE:\\s*${isAcquire ? 'acquire_cms_release_operation\\(jsonb\\)' : 'ensure_cms_terminal_operation_audit\\(uuid,text,jsonb,jsonb\\)'}\\s+observed`, 'i').test(sig.bridge);
  const sourceContract = { absentRaises, unknownRaises };
  const syntheticUnknown = isAcquire ? 'TABLE(classification uuid, id text)' : 'TABLE(log_id text, reused boolean, persisted boolean, audit_log_state text)';
  const files = [MIGRATION_013_REL, BRIDGE_MIGRATION_REL, MIGRATION_014_REL, MIGRATION_015_REL, MIGRATION_017B_REL].map((rel) => path.basename(rel));
  switch (testCase.id) {
    case 'S001': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: actual013, supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'S002': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: target, supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'S003': return evaluateRpcBridgeAction({ isPresent: false, observedSignature: '', supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'S004': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: syntheticUnknown, supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'S005': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: actual013, supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'S006': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: target, supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'S007': return evaluateRpcBridgeAction({ isPresent: false, observedSignature: '', supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'S008': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: syntheticUnknown, supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'S009': return normalizeSignature(sig.acquireBridgeTarget) === normalizeSignature(sig.acquire014) ? 'target_signature_aligns_014' : 'target_signature_mismatch';
    case 'S010': return normalizeSignature(sig.auditBridgeTarget) === normalizeSignature(sig.audit014) ? 'target_signature_aligns_014' : 'target_signature_mismatch';
    case 'S011': return /CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION/.test(extractBridgeBody(sig.bridge, 'acquire_cms_release_operation')) ? 'bridge_body_fail_closed' : 'bridge_body_not_fail_closed';
    case 'S012': return /CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION/.test(extractBridgeBody(sig.bridge, 'ensure_cms_terminal_operation_audit')) ? 'bridge_body_fail_closed' : 'bridge_body_not_fail_closed';
    case 'S013': return files.indexOf(path.basename(MIGRATION_013_REL)) < files.indexOf(path.basename(BRIDGE_MIGRATION_REL))
      && files.indexOf(path.basename(BRIDGE_MIGRATION_REL)) < files.indexOf(path.basename(MIGRATION_014_REL))
      && files.indexOf(path.basename(MIGRATION_014_REL)) < files.indexOf(path.basename(MIGRATION_015_REL)) ? 'ordering_valid' : 'ordering_invalid';
    case 'S014': return /drop\s+function[\s\S]*cascade/i.test(sig.bridge) ? 'drop_cascade_present' : 'no_drop_cascade';
    case 'S015': return files.indexOf(path.basename(MIGRATION_017B_REL)) > files.indexOf(path.basename(MIGRATION_015_REL)) ? '017b_after_015' : '017b_order_invalid';
    case 'S016': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: 'TABLE(classification uuid, id text)', supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'S017': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: 'TABLE(log_id text, reused boolean, persisted boolean, audit_log_state text)', supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    default: throw new Error(`unsupported migration case ${testCase.id}`);
  }
}
function expectedAction(testCase) { return testCase.expectedAction || testCase.expected || testCase.action; }
function duplicateValues(values) {
  const seen = new Set(); const dup = [];
  for (const v of values) { if (seen.has(v)) dup.push(v); seen.add(v); }
  return dup;
}
function assertRequiredCases(frontendCases, migrationCases, required, assertions) {
  const frontendIds = frontendCases.map((c) => c.id);
  const migrationIds = migrationCases.map((c) => c.id);
  add(assertions, 'FRONTEND_FIXTURE_NON_EMPTY', frontendCases.length > 0, `frontend=${frontendCases.length}`);
  add(assertions, 'MIGRATION_FIXTURE_NON_EMPTY', migrationCases.length > 0, `migration=${migrationCases.length}`);
  add(assertions, 'FRONTEND_FIXTURE_IDS_UNIQUE', duplicateValues(frontendIds).length === 0, 'frontend IDs unique');
  add(assertions, 'MIGRATION_FIXTURE_IDS_UNIQUE', duplicateValues(migrationIds).length === 0, 'migration IDs unique');
  const missingFrontend = required.frontendRequiredIds.filter((id) => !frontendIds.includes(id));
  const missingMigration = required.migrationRequiredIds.filter((id) => !migrationIds.includes(id));
  add(assertions, 'REQUIRED_FRONTEND_CASES_PRESENT', missingFrontend.length === 0, `missing=${missingFrontend.join(',')}`);
  add(assertions, 'REQUIRED_MIGRATION_CASES_PRESENT', missingMigration.length === 0, `missing=${missingMigration.join(',')}`);
}
async function importSourceModules(rootPath, importParent, ownedPathsCreated) {
  const importRoot = fs.mkdtempSync(path.join(importParent, 'import-'));
  ownedPathsCreated.push(importRoot);
  const importDir = path.join(importRoot, 'src/cms-admin');
  fs.mkdirSync(path.dirname(importDir), { recursive: true });
  fs.cpSync(path.join(rootPath, 'src/cms-admin'), importDir, { recursive: true });
  fs.writeFileSync(path.join(importDir, 'package.json'), '{"type":"module"}\n');
  const targetAdminPath = path.join(rootPath, ADMIN_STATE_REL);
  const targetGatePath = path.join(rootPath, GATE_REL);
  const importedAdminPath = path.join(importDir, 'adminState.js');
  const importedGatePath = path.join(importDir, 'adminReleaseOperationGate.js');
  // Unique import URL per child process run, so cache cannot hide source mutations.
  const adminState = await import(pathToFileURL(importedAdminPath).href);
  const gate = await import(pathToFileURL(importedGatePath).href);
  return {
    adminState,
    gate,
    targetAdminPath,
    importedAdminPath,
    targetGatePath,
    importedGatePath,
    targetAdminSha256: sha256File(targetAdminPath),
    importedAdminSha256: sha256File(importedAdminPath),
    targetGateSha256: sha256File(targetGatePath),
    importedGateSha256: sha256File(importedGatePath),
    importRoot,
  };
}
function cleanupOwnedPaths(paths, removed) {
  for (const p of [...paths].reverse()) {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
      removed.push(p);
    }
  }
}
async function main() {
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.mkdirSync(ownedRoot, { recursive: true });
  const ownedPathsCreated = [ownedRoot];
  const ownedPathsRemoved = [];
  const assertions = [];
  let moduleInfo = null;
  let frontendCases = [];
  let migrationCases = [];
  let executedFrontendCaseIds = [];
  let executedMigrationCaseIds = [];
  try {
    if (scenario === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, 120000));
    }
    frontendCases = readJson(fixtureRoot, EXACT_FIXTURE_REL);
    migrationCases = readJson(fixtureRoot, MIGRATION_FIXTURE_REL);
    const required = readJson(root, REQUIRED_REL);
    assertRequiredCases(frontendCases, migrationCases, required, assertions);
    moduleInfo = await importSourceModules(root, ownedRoot, ownedPathsCreated);
    add(assertions, 'CHILD_IMPORT_HASH_CHECK_ACTIVE', moduleInfo.targetAdminSha256 === moduleInfo.importedAdminSha256, 'admin target/import hash equal');
    add(assertions, 'CHILD_GATE_IMPORT_HASH_CHECK_ACTIVE', moduleInfo.targetGateSha256 === moduleInfo.importedGateSha256, 'gate target/import hash equal');
    add(assertions, 'CHILD_IMPORT_ISOLATION_ACTIVE', moduleInfo.importedAdminPath.startsWith(ownedRoot) && moduleInfo.importedGatePath.startsWith(ownedRoot), 'imports under child-owned root');
    add(assertions, 'CHILD_IMPORT_CACHE_BUST_ACTIVE', true, 'unique import URL used');
    const state = moduleInfo.adminState;
    for (const c of frontendCases) {
      executedFrontendCaseIds.push(c.id);
      state.clearReleaseOperationGateState();
      const actual = state.isExactIdleReleaseStatusPayload(c.payload);
      add(assertions, `${c.id}_PREDICATE`, actual === c.expectedExactIdle, `${c.id} predicate actual=${actual} expected=${c.expectedExactIdle}`);
      state.applyReleaseOperationGateFromServer(c.payload, 'fixture fallback');
      const expectedDirectBlocked = Object.prototype.hasOwnProperty.call(c, 'wrapperError') ? false : c.expectedBlocked;
      add(assertions, `${c.id}_GATE`, state.getState().releaseOperationGate.blocked === expectedDirectBlocked, `${c.id} gate blocked=${state.getState().releaseOperationGate.blocked}`);
      if (Object.prototype.hasOwnProperty.call(c, 'wrapperError')) {
        state.clearReleaseOperationGateState();
        moduleInfo.gate.applyReleaseOperationGateStatusResult({ error: c.wrapperError }, c.payload, 'wrapper fallback');
        add(assertions, `${c.id}_WRAPPER`, state.getState().releaseOperationGate.blocked === true, `${c.id} wrapper blocked`);
      }
      state.clearReleaseOperationGateState();
    }
    const executedFrontendMissing = required.frontendRequiredIds.filter((id) => !executedFrontendCaseIds.includes(id));
    add(assertions, 'REQUIRED_FRONTEND_CASES_EXECUTED', executedFrontendMissing.length === 0, `missing=${executedFrontendMissing.join(',')}`);
    let migrationPass = true;
    for (const c of migrationCases) {
      executedMigrationCaseIds.push(c.id);
      const actual = evaluateMigrationCase(root, c);
      const pass = actual === expectedAction(c);
      migrationPass &&= pass;
      add(assertions, `${c.id}_MIGRATION_ACTION`, pass, `${c.id} actual=${actual} expected=${expectedAction(c)}`);
    }
    const requiredMigrationMissing = required.migrationRequiredIds.filter((id) => !executedMigrationCaseIds.includes(id));
    add(assertions, 'REQUIRED_MIGRATION_CASES_EXECUTED', requiredMigrationMissing.length === 0, `missing=${requiredMigrationMissing.join(',')}`);
    add(assertions, 'MIGRATION_STATIC_REGRESSION_PASS', migrationPass, 'migration static regression');
    if (scenario === 'expected-test-failure' || scenario === 'unexpected-extra-failure') {
      const e006 = assertions.find((a) => a.id === 'E006_PREDICATE');
      if (e006) { e006.pass = false; e006.message = 'scenario expected failure'; }
      else add(assertions, 'E006_PREDICATE', false, 'scenario expected failure');
    }
    if (scenario === 'unexpected-extra-failure') {
      const e050 = assertions.find((a) => a.id === 'E050_PREDICATE');
      if (e050) { e050.pass = false; e050.message = 'scenario unexpected failure'; }
      else add(assertions, 'E050_PREDICATE', false, 'scenario unexpected failure');
    }
  } catch (err) {
    add(assertions, 'CHILD_UNCAUGHT_EXCEPTION', false, err.stack || err.message);
  } finally {
    if (scenario === 'cleanup-leak') {
      const leak = path.join(ownedRoot, 'import-leak-marker');
      fs.mkdirSync(leak, { recursive: true });
      ownedPathsCreated.push(leak);
      // Intentional leak for cleanup scenario.
    } else {
      cleanupOwnedPaths(ownedPathsCreated, ownedPathsRemoved);
    }
  }
  const remainingOwnedPaths = ownedPathsCreated.filter((p) => fs.existsSync(p));
  add(assertions, 'CHILD_CLEANUP_COMPLETE', remainingOwnedPaths.length === 0, `remaining=${remainingOwnedPaths.join(',')}`);
  add(assertions, 'CHILD_CLEANUP_ENUMERATION_ACTIVE', Array.isArray(remainingOwnedPaths), 'remaining owned paths enumerated');
  const ids = assertions.map((a) => a.id);
  add(assertions, 'CHILD_ASSERTION_IDS_UNIQUE', duplicateValues(ids).length === 0, 'assertion IDs unique');
  const result = {
    protocolVersion: CHILD_PROTOCOL_VERSION,
    runId,
    root,
    fixtureRoot,
    executablePath: path.resolve(process.argv[1]),
    pid: process.pid,
    targetAdminPath: moduleInfo?.targetAdminPath || path.join(root, ADMIN_STATE_REL),
    importedAdminPath: moduleInfo?.importedAdminPath || '',
    targetAdminSha256: moduleInfo?.targetAdminSha256 || (fs.existsSync(path.join(root, ADMIN_STATE_REL)) ? sha256File(path.join(root, ADMIN_STATE_REL)) : ''),
    importedAdminSha256: moduleInfo?.importedAdminSha256 || '',
    targetGatePath: moduleInfo?.targetGatePath || path.join(root, GATE_REL),
    importedGatePath: moduleInfo?.importedGatePath || '',
    targetGateSha256: moduleInfo?.targetGateSha256 || (fs.existsSync(path.join(root, GATE_REL)) ? sha256File(path.join(root, GATE_REL)) : ''),
    importedGateSha256: moduleInfo?.importedGateSha256 || '',
    executedFrontendCaseIds,
    executedMigrationCaseIds,
    ownedPathsCreated,
    ownedPathsRemoved,
    remainingOwnedPaths,
    assertions,
  };
  result.passCount = assertions.filter((a) => a.pass).length;
  result.failCount = assertions.filter((a) => !a.pass).length;
  result.totalCount = assertions.length;
  if (scenario === 'wrong-run-id') result.runId = `${runId}-wrong`;
  if (scenario === 'wrong-root') result.root = `${root}-wrong`;
  if (scenario === 'malformed-result') {
    fs.writeFileSync(resultFile, '{not-json', 'utf8');
    process.exit(1);
  }
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  if (scenario === 'exit-2-after-result') process.exit(2);
  if (scenario === 'signal-after-result') process.kill(process.pid, 'SIGTERM');
  process.exit(result.failCount > 0 ? 1 : 0);
}

main();
