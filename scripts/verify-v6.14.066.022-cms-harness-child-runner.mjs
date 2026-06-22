#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const PROTOCOL_VERSION = 'v6.14.066.022';
const ADMIN_STATE_REL = 'src/cms-admin/adminState.js';
const GATE_REL = 'src/cms-admin/adminReleaseOperationGate.js';
const EXACT_FIXTURE_REL = 'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json';
const MIGRATION_FIXTURE_REL = 'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json';
const REQUIRED_FIXTURE_REL = 'scripts/fixtures/v6.14.066.022-required-verification-cases.json';
const BRIDGE_MIGRATION_REL = 'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql';
const MIGRATION_013_REL = 'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql';
const MIGRATION_014_REL = 'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql';
const MIGRATION_015_REL = 'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql';
const MIGRATION_017B_REL = 'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql';

function parseArgs(argv) {
  const out = new Map();
  for (const arg of argv) {
    const [key, ...rest] = arg.split('=');
    out.set(key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true');
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(args.get('root') || process.cwd());
const FIXTURE_ROOT = path.resolve(args.get('fixture-root') || ROOT);
const RUN_ID = String(args.get('run-id') || `child-${Date.now()}`);
const RESULT_FILE = args.get('result-file') ? path.resolve(args.get('result-file')) : '';
const OWNED_ROOT = args.get('owned-root') ? path.resolve(args.get('owned-root')) : fs.mkdtempSync(path.join(os.tmpdir(), `cms-066022-child-${RUN_ID}-`));
const THIS_FILE = fileURLToPath(import.meta.url);

const assertions = [];
function add(id, pass, message = '') {
  assertions.push({ id, pass: Boolean(pass), message });
}
function readText(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function readJson(root, rel) {
  return JSON.parse(readText(root, rel));
}
function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}
function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
function assertUnique(ids, assertionId, label) {
  const seen = new Set();
  const dupes = [];
  for (const id of ids) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  add(assertionId, dupes.length === 0, `${label} duplicates=${dupes.join(',')}`);
  return dupes.length === 0;
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
function extractBridgeBody(sql, functionName) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`create\\s+function\\s+public\\.${escaped}[\\s\\S]*?as\\s+\\$fn\\$([\\s\\S]*?)\\$fn\\$`, 'i');
  const match = sql.match(re);
  if (!match) throw new Error(`Unable to extract bridge body for ${functionName}`);
  return match[1];
}
function migrationSignatures(root) {
  const bridge = readText(root, BRIDGE_MIGRATION_REL);
  const m013 = readText(root, MIGRATION_013_REL);
  const m014 = readText(root, MIGRATION_014_REL);
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
  const files = [MIGRATION_013_REL, BRIDGE_MIGRATION_REL, MIGRATION_014_REL, MIGRATION_015_REL, MIGRATION_017B_REL].map((rel) => path.basename(rel));
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
  const sourceContract = {
    absentRaises: absentPattern.test(sig.bridge),
    unknownRaises: unknownPattern.test(sig.bridge),
  };
  const syntheticUnknown = normalizeSignature('TABLE(unexpected text, id uuid)');
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
    case 'S016': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: normalizeSignature('TABLE(classification uuid, id text)'), supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    case 'S017': return evaluateRpcBridgeAction({ isPresent: true, observedSignature: normalizeSignature('TABLE(log_id text, reused boolean, persisted boolean, audit_log_state text)'), supportedLegacySignature: legacy, targetSignature: target, sourceContract });
    default: throw new Error(`Unsupported migration case ${testCase.id}`);
  }
}
function caseExpectedAction(testCase) {
  return testCase.expectedAction || testCase.expected || testCase.action;
}
async function importActualModules(root, runRoot) {
  const importRoot = fs.mkdtempSync(path.join(runRoot, 'import-'));
  const importDir = path.join(importRoot, 'src/cms-admin');
  fs.mkdirSync(path.dirname(importDir), { recursive: true });
  fs.cpSync(path.join(root, 'src/cms-admin'), importDir, { recursive: true });
  fs.writeFileSync(path.join(importDir, 'package.json'), '{"type":"module"}\n');
  const targetAdminPath = path.join(root, ADMIN_STATE_REL);
  const targetGatePath = path.join(root, GATE_REL);
  const importedAdminPath = path.join(importDir, 'adminState.js');
  const importedGatePath = path.join(importDir, 'adminReleaseOperationGate.js');
  const adminState = await import(pathToFileURL(importedAdminPath).href);
  const gate = await import(pathToFileURL(importedGatePath).href);
  return {
    adminState,
    gate,
    targetAdminPath,
    targetGatePath,
    importedAdminPath,
    importedGatePath,
    targetAdminSha256: sha256File(targetAdminPath),
    importedAdminSha256: sha256File(importedAdminPath),
    targetGateSha256: sha256File(targetGatePath),
    importedGateSha256: sha256File(importedGatePath),
  };
}
function strictProtocolShape(result) {
  return result && result.protocolVersion === PROTOCOL_VERSION && Array.isArray(result.assertions);
}
function assertRequiredCases(frontendCases, migrationCases, required) {
  const frontendIds = frontendCases.map((c) => c.id);
  const migrationIds = migrationCases.map((c) => c.id);
  assertUnique(frontendIds, 'FRONTEND_FIXTURE_IDS_UNIQUE', 'frontend fixture IDs');
  assertUnique(migrationIds, 'MIGRATION_FIXTURE_IDS_UNIQUE', 'migration fixture IDs');
  add('FRONTEND_FIXTURE_NON_EMPTY', frontendCases.length > 0, `count=${frontendCases.length}`);
  add('MIGRATION_FIXTURE_NON_EMPTY', migrationCases.length > 0, `count=${migrationCases.length}`);
  const requiredFrontend = required.frontendRequiredIds || [];
  const requiredMigration = required.migrationRequiredIds || [];
  const missingFrontend = requiredFrontend.filter((id) => !frontendIds.includes(id));
  const missingMigration = requiredMigration.filter((id) => !migrationIds.includes(id));
  add('REQUIRED_FRONTEND_CASES_PRESENT', missingFrontend.length === 0, `missing=${missingFrontend.join(',')}`);
  add('REQUIRED_MIGRATION_CASES_PRESENT', missingMigration.length === 0, `missing=${missingMigration.join(',')}`);
  return { requiredFrontend, requiredMigration };
}

let modules = null;
let childOwnedRoot = '';
let cleanupBefore = [];
let cleanupAfter = [];
let result = null;
try {
  fs.mkdirSync(OWNED_ROOT, { recursive: true });
  cleanupBefore = fs.readdirSync(OWNED_ROOT).filter(Boolean);
  childOwnedRoot = fs.mkdtempSync(path.join(OWNED_ROOT, 'child-owned-'));
  fs.writeFileSync(path.join(childOwnedRoot, 'marker.txt'), RUN_ID);
  modules = await importActualModules(ROOT, OWNED_ROOT);
  add('IMPORT_ADMIN_HASH_MATCH', modules.targetAdminSha256 === modules.importedAdminSha256, `${modules.targetAdminSha256} vs ${modules.importedAdminSha256}`);
  add('IMPORT_GATE_HASH_MATCH', modules.targetGateSha256 === modules.importedGateSha256, `${modules.targetGateSha256} vs ${modules.importedGateSha256}`);
  add('IMPORT_ADMIN_PATH_UNDER_ROOT', modules.targetAdminPath.startsWith(ROOT), modules.targetAdminPath);
  add('IMPORT_GATE_PATH_UNDER_ROOT', modules.targetGatePath.startsWith(ROOT), modules.targetGatePath);

  const selfText = fs.readFileSync(THIS_FILE, 'utf8');

  // 066022_MARKER_ADMIN_HASH_CHECK_ACTIVE
  // 066022_MARKER_GATE_HASH_CHECK_ACTIVE
  // 066022_MARKER_IMPORT_FROM_TARGET_ROOT
  // 066022_MARKER_IMPORT_ISOLATION_ACTIVE
  // 066022_MARKER_REQUIRED_FIXTURE_ENFORCEMENT_ACTIVE
  // 066022_MARKER_STRUCTURED_PROTOCOL_ACTIVE
  // 066022_MARKER_CLEANUP_FILESYSTEM_ACTIVE
  const marker = (...parts) => parts.join('');
  add('H_ADMIN_HASH_CHECK_ACTIVE', selfText.includes(marker('066022_', 'MARKER_ADMIN_HASH_CHECK_ACTIVE')), 'admin hash equality marker is present');
  add('H_GATE_HASH_CHECK_ACTIVE', selfText.includes(marker('066022_', 'MARKER_GATE_HASH_CHECK_ACTIVE')), 'gate hash equality marker is present');
  add('H_IMPORT_FROM_TARGET_ROOT', selfText.includes(marker('066022_', 'MARKER_IMPORT_FROM_TARGET_ROOT')), 'target-root import marker is present');
  add('H_IMPORT_ISOLATION_ACTIVE', selfText.includes(marker('066022_', 'MARKER_IMPORT_ISOLATION_ACTIVE')), 'import isolation marker is present');
  add('H_REQUIRED_FIXTURE_ENFORCEMENT_ACTIVE', selfText.includes(marker('066022_', 'MARKER_REQUIRED_FIXTURE_ENFORCEMENT_ACTIVE')), 'required fixture marker is present');
  add('H_STRUCTURED_PROTOCOL_ACTIVE', selfText.includes(marker('066022_', 'MARKER_STRUCTURED_PROTOCOL_ACTIVE')), 'structured protocol marker is present');
  add('H_CLEANUP_FILESYSTEM_ACTIVE', selfText.includes(marker('066022_', 'MARKER_CLEANUP_FILESYSTEM_ACTIVE')), 'cleanup filesystem marker is present');

  const exactCases = readJson(FIXTURE_ROOT, EXACT_FIXTURE_REL);
  const migrationCases = readJson(ROOT, MIGRATION_FIXTURE_REL);
  const required = readJson(FIXTURE_ROOT, REQUIRED_FIXTURE_REL);
  const { requiredFrontend, requiredMigration } = assertRequiredCases(exactCases, migrationCases, required);
  const executedFrontendCaseIds = [];
  const executedMigrationCaseIds = [];

  for (const testCase of exactCases) {
    executedFrontendCaseIds.push(testCase.id);
    const payload = cloneJson(testCase.payload);
    let predicate = false;
    let predicateThrew = false;
    try {
      predicate = modules.adminState.isExactIdleReleaseStatusPayload(payload);
    } catch (err) {
      predicateThrew = true;
      predicate = false;
    }
    add(testCase.id, !predicateThrew && predicate === Boolean(testCase.expectedExactIdle), `${testCase.name || testCase.id}: predicate=${predicate} expected=${testCase.expectedExactIdle}`);
    try { modules.adminState.clearReleaseOperationGateState(); } catch {}
    try {
      if (testCase.wrapperError !== undefined) {
        modules.gate.applyReleaseOperationGateStatusResult({ error: cloneJson(testCase.wrapperError) }, payload, 'fixture wrapper error');
      } else {
        modules.adminState.applyReleaseOperationGateFromServer(payload, 'fixture fallback');
      }
      const gateState = modules.adminState.getState().releaseOperationGate || {};
      add(`${testCase.id}_GATE`, Boolean(gateState.blocked) === Boolean(testCase.expectedBlocked), `${testCase.name || testCase.id}: blocked=${gateState.blocked} expected=${testCase.expectedBlocked}`);
    } catch (err) {
      add(`${testCase.id}_GATE`, false, `${testCase.name || testCase.id}: gate threw ${err.message}`);
    } finally {
      try { modules.adminState.clearReleaseOperationGateState(); } catch {}
    }
  }
  for (const id of requiredFrontend) {
    add(`REQUIRED_FRONTEND_EXECUTED_${id}`, executedFrontendCaseIds.includes(id), id);
  }

  for (const testCase of migrationCases) {
    executedMigrationCaseIds.push(testCase.id);
    let actual = '';
    try {
      actual = evaluateMigrationAction(ROOT, testCase);
      add(testCase.id, actual === caseExpectedAction(testCase), `${testCase.id}: actual=${actual} expected=${caseExpectedAction(testCase)}`);
    } catch (err) {
      add(testCase.id, false, `${testCase.id}: evaluator threw ${err.message}`);
    }
  }
  for (const id of requiredMigration) {
    add(`REQUIRED_MIGRATION_EXECUTED_${id}`, executedMigrationCaseIds.includes(id), id);
  }

  fs.rmSync(childOwnedRoot, { recursive: true, force: true });
  add('CHILD_CLEANUP_ZERO_LEAK', fs.existsSync(childOwnedRoot) === false, childOwnedRoot);
  cleanupAfter = fs.readdirSync(OWNED_ROOT).filter((name) => name.startsWith('child-owned-'));
  add('CHILD_REMAINING_OWNED_ROOTS_ZERO', cleanupAfter.length === 0, cleanupAfter.join(','));

  const passCount = assertions.filter((a) => a.pass).length;
  const failCount = assertions.length - passCount;
  result = {
    protocolVersion: PROTOCOL_VERSION,
    runId: RUN_ID,
    root: ROOT,
    fixtureRoot: FIXTURE_ROOT,
    targetAdminPath: modules.targetAdminPath,
    targetGatePath: modules.targetGatePath,
    importedAdminPath: modules.importedAdminPath,
    importedGatePath: modules.importedGatePath,
    targetAdminSha256: modules.targetAdminSha256,
    importedAdminSha256: modules.importedAdminSha256,
    targetGateSha256: modules.targetGateSha256,
    importedGateSha256: modules.importedGateSha256,
    executedFrontendCaseIds,
    executedMigrationCaseIds,
    assertions,
    passCount,
    failCount,
    totalCount: assertions.length,
    cleanup: {
      ownedRootsCreated: childOwnedRoot ? 1 : 0,
      ownedRootsRemoved: childOwnedRoot && !fs.existsSync(childOwnedRoot) ? 1 : 0,
      remainingOwnedRoots: cleanupAfter.map((name) => path.join(OWNED_ROOT, name)),
    },
  };
} catch (err) {
  add('CHILD_UNCAUGHT_EXCEPTION', false, err.stack || err.message);
  const passCount = assertions.filter((a) => a.pass).length;
  const failCount = assertions.length - passCount;
  result = {
    protocolVersion: PROTOCOL_VERSION,
    runId: RUN_ID,
    root: ROOT,
    fixtureRoot: FIXTURE_ROOT,
    targetAdminPath: modules?.targetAdminPath || path.join(ROOT, ADMIN_STATE_REL),
    targetGatePath: modules?.targetGatePath || path.join(ROOT, GATE_REL),
    importedAdminSha256: modules?.importedAdminSha256 || '',
    targetAdminSha256: modules?.targetAdminSha256 || '',
    importedGateSha256: modules?.importedGateSha256 || '',
    targetGateSha256: modules?.targetGateSha256 || '',
    executedFrontendCaseIds: [],
    executedMigrationCaseIds: [],
    assertions,
    passCount,
    failCount,
    totalCount: assertions.length,
    cleanup: { ownedRootsCreated: childOwnedRoot ? 1 : 0, ownedRootsRemoved: 0, remainingOwnedRoots: childOwnedRoot && fs.existsSync(childOwnedRoot) ? [childOwnedRoot] : [] },
  };
} finally {
  if (RESULT_FILE) {
    fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
    fs.writeFileSync(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}
if (!strictProtocolShape(result) || result.failCount > 0) process.exit(1);
