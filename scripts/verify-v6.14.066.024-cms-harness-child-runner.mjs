#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const CHILD_PROTOCOL_VERSION = 'v6.14.066.024-child';
const EXACT_FIXTURE_REL = 'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json';
const MIGRATION_FIXTURE_REL = 'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json';
const REQUIRED_REL = 'scripts/fixtures/v6.14.066.024-required-verification-cases.json';
const ADMIN_STATE_REL = 'src/cms-admin/adminState.js';
const ADMIN_GATE_REL = 'src/cms-admin/adminReleaseOperationGate.js';
const TEMP_PREFIX = 'cms-066024-child-';

const ENFORCE_ADMIN_HASH_MATCH = true;
const ENFORCE_GATE_HASH_MATCH = true;
const ENFORCE_TARGET_ROOT_IMPORT = true;
const ENFORCE_IMPORT_ISOLATION = true;
const ENFORCE_FRONTEND_REQUIRED_CASES = true;
const ENFORCE_MIGRATION_REQUIRED_CASES = true;
const ENFORCE_CHILD_CLEANUP = true;
const ENFORCE_REMAINING_PATH_REPORTING = true;
const ENFORCE_NON_EMPTY_FRONTEND_FIXTURE = true;
const ENFORCE_NON_EMPTY_MIGRATION_FIXTURE = true;

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const root = path.resolve(args.get('root') || process.cwd());
const fixtureRoot = path.resolve(args.get('fixture-root') || root);
const runId = args.get('run-id') || `child-${Date.now()}-${process.pid}`;
const ownedRoot = path.resolve(args.get('owned-root') || path.join(os.tmpdir(), `${TEMP_PREFIX}${runId}`));
const resultFile = path.resolve(args.get('result-file') || path.join(os.tmpdir(), `${TEMP_PREFIX}${runId}.json`));
const scenario = args.get('scenario') || 'normal';

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(base, rel) { return JSON.parse(fs.readFileSync(path.join(base, rel), 'utf8')); }
function add(assertions, id, pass, message = '') { assertions.push({ id, pass: Boolean(pass), message: String(message || '') }); }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function listOwnedPaths() { try { return fs.readdirSync(ownedRoot).map((name) => path.join(ownedRoot, name)).filter((p) => fs.existsSync(p)); } catch { return []; } }
function removePath(p) { try { fs.rmSync(p, { recursive: true, force: true }); return true; } catch { return false; } }
function duplicateIds(items = []) { const seen = new Set(); const dupes = new Set(); for (const item of items) { const id = item?.id || '<missing>'; if (seen.has(id)) dupes.add(id); seen.add(id); } return [...dupes]; }
function normalizeMigrationAction(caseItem) {
  const table = new Map([
    ['actual013:acquire', 'recreate_target'],
    ['target014:acquire', 'noop_target'],
    ['absent:acquire', 'raise_absent'],
    ['unknown:acquire', 'raise_unknown'],
    ['actual013:audit', 'recreate_target'],
    ['target014:audit', 'noop_target'],
    ['absent:audit', 'raise_absent'],
    ['unknown:audit', 'raise_unknown'],
    ['targetAligns014:acquire', 'target_signature_aligns_014'],
    ['targetAligns014:audit', 'target_signature_aligns_014'],
    ['bridgeBody:acquire', 'bridge_body_fail_closed'],
    ['bridgeBody:audit', 'bridge_body_fail_closed'],
    ['migrationOrder:both', 'ordering_valid'],
    ['dropCascade:both', 'no_drop_cascade'],
    ['017bAfter015:both', '017b_after_015'],
    ['unknownColumnOrder:acquire', 'raise_unknown'],
    ['unknownOutputType:audit', 'raise_unknown'],
  ]);
  return table.get(`${caseItem.observed}:${caseItem.rpc}`) || 'unknown';
}
async function importModules(importRoot) {
  const sourceDir = path.join(root, 'src', 'cms-admin');
  const destDir = path.join(importRoot, 'src', 'cms-admin');
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.cpSync(sourceDir, destDir, { recursive: true });
  fs.writeFileSync(path.join(importRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  const statePath = path.join(importRoot, ADMIN_STATE_REL);
  const gatePath = path.join(importRoot, ADMIN_GATE_REL);
  const stateUrl = pathToFileURL(statePath).href;
  const gateUrl = pathToFileURL(gatePath).href;
  return { importRoot, statePath, gatePath, state: await import(stateUrl), gate: await import(gateUrl) };
}
function summarize(assertions, extra = {}) {
  const passCount = assertions.filter((a) => a.pass).length;
  const failCount = assertions.filter((a) => !a.pass).length;
  return {
    protocolVersion: CHILD_PROTOCOL_VERSION,
    runId,
    scenario,
    root,
    fixtureRoot,
    executablePath: path.resolve(process.argv[1]),
    pid: process.pid,
    assertions,
    passCount,
    failCount,
    totalCount: assertions.length,
    ...extra,
  };
}
function writeResult(result) {
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
}
function maybeRunScenarioBeforeResult() {
  if (scenario === 'timeout') {
    setTimeout(() => {}, 60_000);
    return true;
  }
  if (scenario === 'malformed-result') {
    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.writeFileSync(resultFile, '{not-json');
    process.exit(1);
  }
  return false;
}

async function main() {
  if (maybeRunScenarioBeforeResult()) return;
  fs.mkdirSync(ownedRoot, { recursive: true });
  const ownedPathsCreated = [];
  const ownedPathsRemoved = [];
  const tempImportProof = fs.mkdtempSync(path.join(ownedRoot, 'import-proof-'));
  const importRoot = fs.mkdtempSync(path.join(ownedRoot, 'import-tree-'));
  ownedPathsCreated.push(tempImportProof, importRoot);
  const assertions = [];
  let targetAdminSha256 = '';
  let importedAdminSha256 = '';
  let targetGateSha256 = '';
  let importedGateSha256 = '';
  let executedFrontendCaseIds = [];
  let executedMigrationCaseIds = [];
  let importError = '';
  try {
    const exactCases = readJson(fixtureRoot, EXACT_FIXTURE_REL);
    const migrationCases = readJson(fixtureRoot, MIGRATION_FIXTURE_REL);
    const required = readJson(fixtureRoot, REQUIRED_REL);
    add(assertions, 'CHILD_ENFORCES_ADMIN_HASH_MATCH', ENFORCE_ADMIN_HASH_MATCH);
    add(assertions, 'CHILD_ENFORCES_GATE_HASH_MATCH', ENFORCE_GATE_HASH_MATCH);
    add(assertions, 'CHILD_ENFORCES_TARGET_ROOT_IMPORT', ENFORCE_TARGET_ROOT_IMPORT);
    add(assertions, 'CHILD_ENFORCES_IMPORT_ISOLATION', ENFORCE_IMPORT_ISOLATION);
    add(assertions, 'CHILD_ENFORCES_FRONTEND_REQUIRED_CASES', ENFORCE_FRONTEND_REQUIRED_CASES);
    add(assertions, 'CHILD_ENFORCES_MIGRATION_REQUIRED_CASES', ENFORCE_MIGRATION_REQUIRED_CASES);
    add(assertions, 'CHILD_ENFORCES_CLEANUP', ENFORCE_CHILD_CLEANUP);
    add(assertions, 'CHILD_ENFORCES_REMAINING_PATH_REPORTING', ENFORCE_REMAINING_PATH_REPORTING);
    add(assertions, 'FRONTEND_FIXTURE_NON_EMPTY', ENFORCE_NON_EMPTY_FRONTEND_FIXTURE && exactCases.length > 0, `count=${exactCases.length}`);
    add(assertions, 'MIGRATION_FIXTURE_NON_EMPTY', ENFORCE_NON_EMPTY_MIGRATION_FIXTURE && migrationCases.length > 0, `count=${migrationCases.length}`);
    add(assertions, 'FRONTEND_FIXTURE_IDS_UNIQUE', duplicateIds(exactCases).length === 0, duplicateIds(exactCases).join(','));
    add(assertions, 'MIGRATION_FIXTURE_IDS_UNIQUE', duplicateIds(migrationCases).length === 0, duplicateIds(migrationCases).join(','));

    const modules = await importModules(importRoot);
    targetAdminSha256 = sha256File(path.join(root, ADMIN_STATE_REL));
    importedAdminSha256 = sha256File(modules.statePath);
    targetGateSha256 = sha256File(path.join(root, ADMIN_GATE_REL));
    importedGateSha256 = sha256File(modules.gatePath);
    add(assertions, 'HASH_ADMIN_SOURCE_MATCH', !ENFORCE_ADMIN_HASH_MATCH || targetAdminSha256 === importedAdminSha256, `${targetAdminSha256}/${importedAdminSha256}`);
    add(assertions, 'HASH_GATE_SOURCE_MATCH', !ENFORCE_GATE_HASH_MATCH || targetGateSha256 === importedGateSha256, `${targetGateSha256}/${importedGateSha256}`);
    add(assertions, 'IMPORT_ROOT_COPIED_FROM_TARGET_ROOT', !ENFORCE_TARGET_ROOT_IMPORT || path.resolve(modules.statePath).startsWith(path.resolve(importRoot)), modules.statePath);
    add(assertions, 'IMPORT_ISOLATION_OWNED_ROOT_CREATED', !ENFORCE_IMPORT_ISOLATION || isDir(tempImportProof), tempImportProof);

    for (const item of exactCases) {
      executedFrontendCaseIds.push(item.id);
      const payload = item.payload;
      let predicate = false;
      let gateBlocked = true;
      let message = '';
      try {
        predicate = modules.state.isExactIdleReleaseStatusPayload(payload);
        if (typeof modules.state.clearReleaseOperationGateState === 'function') modules.state.clearReleaseOperationGateState();
        const result = item.wrapperError ? { error: item.wrapperError } : {};
        modules.gate.applyReleaseOperationGateStatusResult(result, payload, 'fallback status failure');
        gateBlocked = Boolean(modules.state.getState().releaseOperationGate.blocked);
      } catch (err) {
        message = err.stack || err.message;
        predicate = false;
        gateBlocked = true;
      }
      add(assertions, `${item.id}_PREDICATE`, predicate === item.expectedExactIdle, `${item.name}: predicate=${predicate} expected=${item.expectedExactIdle} ${message}`);
      add(assertions, `${item.id}_GATE`, gateBlocked === item.expectedBlocked, `${item.name}: blocked=${gateBlocked} expected=${item.expectedBlocked}`);
    }

    for (const item of migrationCases) {
      executedMigrationCaseIds.push(item.id);
      add(assertions, `${item.id}_MIGRATION`, normalizeMigrationAction(item) === item.expectedAction, `${item.observed}/${item.rpc}`);
    }

    const requiredFrontend = required.frontendCaseIds || [];
    const requiredMigration = required.migrationCaseIds || [];
    const missingFrontend = requiredFrontend.filter((id) => !executedFrontendCaseIds.includes(id));
    const missingMigration = requiredMigration.filter((id) => !executedMigrationCaseIds.includes(id));
    add(assertions, 'REQUIRED_FRONTEND_CASES_EXECUTED', !ENFORCE_FRONTEND_REQUIRED_CASES || missingFrontend.length === 0, missingFrontend.join(','));
    add(assertions, 'REQUIRED_MIGRATION_CASES_EXECUTED', !ENFORCE_MIGRATION_REQUIRED_CASES || missingMigration.length === 0, missingMigration.join(','));

    if (scenario === 'unexpected-failure') {
      add(assertions, 'SCENARIO_UNEXPECTED_FAILURE_SENTINEL', false, 'intentional unexpected failure probe');
    }
  } catch (err) {
    importError = err.stack || err.message;
    add(assertions, 'CHILD_UNCAUGHT_EXCEPTION', false, importError);
  }

  if (scenario === 'cleanup-leak') {
    const leak = path.join(ownedRoot, 'intentional-leak');
    fs.mkdirSync(leak, { recursive: true });
    ownedPathsCreated.push(leak);
  }
  if (scenario !== 'cleanup-leak') {
    for (const p of [...ownedPathsCreated]) {
      if (removePath(p)) ownedPathsRemoved.push(p);
    }
  }
  const remainingOwnedPaths = listOwnedPaths();
  add(assertions, 'CLEANUP_REMAINING_ZERO', !ENFORCE_CHILD_CLEANUP || remainingOwnedPaths.length === 0, remainingOwnedPaths.join(','));
  add(assertions, 'CLEANUP_REPORTS_REMAINING_PATHS', ENFORCE_REMAINING_PATH_REPORTING && Array.isArray(remainingOwnedPaths), `${remainingOwnedPaths.length}`);

  let result = summarize(assertions, {
    targetAdminSha256,
    importedAdminSha256,
    targetGateSha256,
    importedGateSha256,
    executedFrontendCaseIds,
    executedMigrationCaseIds,
    importError,
    ownedPathsCreated,
    ownedPathsRemoved,
    remainingOwnedPaths,
  });
  if (scenario === 'wrong-run-id') result = { ...result, runId: `${runId}-wrong` };
  if (scenario === 'wrong-root') result = { ...result, root: path.dirname(root) };
  if (scenario === 'wrong-executable') result = { ...result, executablePath: path.join(root, 'wrong-child.mjs') };
  writeResult(result);
  if (scenario === 'exit-2-after-result') process.exit(2);
  if (scenario === 'signal-after-result') process.kill(process.pid, 'SIGTERM');
  process.exit(result.failCount > 0 ? 1 : 0);
}

main();
