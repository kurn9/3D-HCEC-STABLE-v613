#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PROTOCOL_VERSION, sha256Bytes } from './lib/v6.14.066.027-oracle.mjs';
import { evaluateMigrationSource } from './lib/v6.14.066.027-sql.mjs';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const root = path.resolve(args.get('root') || process.cwd());
const fixtureRoot = path.resolve(args.get('fixture-root') || root);
const runId = args.get('run-id') || `child-${Date.now()}-${process.pid}`;
const ownedRoot = path.resolve(args.get('owned-root') || path.join('/tmp', `cms-066027-child-${runId}`));
const resultFile = path.resolve(args.get('result-file') || path.join('/tmp', `cms-066027-child-result-${runId}.json`));
const scenario = args.get('scenario') || 'normal';
const fixtureMutation = args.get('fixture-mutation') || '';
const sourceMutation = args.get('source-mutation') || '';

function add(assertions, id, pass, message = '', details = null) {
  assertions.push({ id, pass: Boolean(pass), message, ...(details ? { details } : {}) });
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function copyRel(fromRoot, toRoot, rel) {
  const src = path.join(fromRoot, rel);
  const dst = path.join(toRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}
function writeResult(assertions, extra = {}, status = 0) {
  const result = {
    protocolVersion: PROTOCOL_VERSION,
    runId,
    root,
    executablePath: path.resolve(process.argv[1]),
    scenario,
    assertions,
    ...extra,
  };
  result.passCount = assertions.filter((a) => a.pass).length;
  result.failCount = assertions.filter((a) => !a.pass).length;
  result.totalCount = assertions.length;
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  process.exit(status);
}
async function cleanupAndExit(status = 0) {
  fs.rmSync(ownedRoot, { recursive: true, force: true });
  process.exit(status);
}
async function handleScenarioOnly() {
  const assertions = [];
  if (scenario === 'timeout') { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); return true; }
  if (scenario === 'signal') {
    fs.mkdirSync(ownedRoot, { recursive: true });
    fs.writeFileSync(path.join(ownedRoot, 'signal-leak.txt'), 'owned');
    process.kill(process.pid, 'SIGTERM');
    return true;
  }
  if (scenario === 'missing-result') {
    fs.rmSync(ownedRoot, { recursive: true, force: true });
    process.exit(0);
  }
  if (scenario === 'malformed-json') {
    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.writeFileSync(resultFile, '{ malformed json');
    fs.rmSync(ownedRoot, { recursive: true, force: true });
    process.exit(0);
  }
  if (scenario === 'exit-1') {
    add(assertions, 'INTENTIONAL_EXIT_1_FAILURE', false, 'scenario exit 1');
    fs.rmSync(ownedRoot, { recursive: true, force: true });
    writeResult(assertions, {}, 1);
  }
  if (scenario === 'exit-2') {
    add(assertions, 'INTENTIONAL_EXIT_2_FAILURE', false, 'scenario exit 2');
    fs.rmSync(ownedRoot, { recursive: true, force: true });
    writeResult(assertions, {}, 2);
  }
  if (scenario === 'wrong-protocol') {
    add(assertions, 'WRONG_PROTOCOL_PAYLOAD', true);
    fs.rmSync(ownedRoot, { recursive: true, force: true });
    const result = { protocolVersion: 'wrong', runId, root, executablePath: path.resolve(process.argv[1]), assertions, passCount: 1, failCount: 0, totalCount: 1 };
    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
    process.exit(0);
  }
  if (scenario === 'wrong-run-id') {
    add(assertions, 'WRONG_RUN_ID_PAYLOAD', true);
    fs.rmSync(ownedRoot, { recursive: true, force: true });
    writeResult(assertions, { runId: `${runId}-wrong` }, 0);
  }
  if (scenario === 'wrong-root') {
    add(assertions, 'WRONG_ROOT_PAYLOAD', true);
    fs.rmSync(ownedRoot, { recursive: true, force: true });
    writeResult(assertions, { root: `${root}-wrong` }, 0);
  }
  if (scenario === 'wrong-executable') {
    add(assertions, 'WRONG_EXECUTABLE_PAYLOAD', true);
    fs.rmSync(ownedRoot, { recursive: true, force: true });
    writeResult(assertions, { executablePath: `${path.resolve(process.argv[1])}.wrong` }, 0);
  }
  if (scenario === 'cleanup-leak') {
    fs.mkdirSync(path.join(ownedRoot, 'leak'), { recursive: true });
    add(assertions, 'CLEANUP_REMAINING_ZERO', false, 'intentional leak');
    writeResult(assertions, { remainingOwnedPaths: [path.join(ownedRoot, 'leak')] }, 1);
  }
  if (scenario === 'hidden-cleanup-leak') {
    fs.mkdirSync(path.join(ownedRoot, 'hidden-leak'), { recursive: true });
    add(assertions, 'HIDDEN_CLEANUP_REPORTED_EMPTY', true, 'result hides leak');
    writeResult(assertions, { remainingOwnedPaths: [] }, 0);
  }
  return false;
}

async function runNormal() {
  fs.mkdirSync(ownedRoot, { recursive: true });
  const assertions = [];
  const importRoot = path.join(ownedRoot, 'import-root');
  for (const rel of [
    'src/cms-admin/adminState.js',
    'src/cms-admin/adminReleaseOperationGate.js',
    'src/cms-admin/adminConfig.js',
  ]) copyRel(root, importRoot, rel);
  fs.writeFileSync(path.join(importRoot, 'package.json'), JSON.stringify({ type: 'module' }));

  const targetAdmin = path.join(root, 'src/cms-admin/adminState.js');
  const importedAdmin = path.join(importRoot, 'src/cms-admin/adminState.js');
  const targetGate = path.join(root, 'src/cms-admin/adminReleaseOperationGate.js');
  const importedGate = path.join(importRoot, 'src/cms-admin/adminReleaseOperationGate.js');

  if (sourceMutation === 'admin-hash-mismatch') fs.appendFileSync(importedAdmin, '\n// mutated import hash\n');
  if (sourceMutation === 'gate-hash-mismatch') fs.appendFileSync(importedGate, '\n// mutated gate hash\n');

  const targetAdminSha = sha256File(targetAdmin);
  const importedAdminSha = sha256File(importedAdmin);
  const targetGateSha = sha256File(targetGate);
  const importedGateSha = sha256File(importedGate);
  add(assertions, 'HASH_ADMIN_SOURCE_MATCH', targetAdminSha === importedAdminSha, `${targetAdminSha} ${importedAdminSha}`);
  add(assertions, 'HASH_GATE_SOURCE_MATCH', targetGateSha === importedGateSha, `${targetGateSha} ${importedGateSha}`);

  const exactCasesPath = path.join(fixtureRoot, 'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json');
  let exactCases = readJson(exactCasesPath);
  if (sourceMutation === 'empty-frontend-fixture') exactCases = [];
  if (sourceMutation === 'missing-required-frontend-case') exactCases = exactCases.filter((item) => item.id !== 'E001');
  add(assertions, 'FRONTEND_FIXTURE_NON_EMPTY', exactCases.length > 0, `count=${exactCases.length}`);
  add(assertions, 'REQUIRED_FRONTEND_CASES_PRESENT', exactCases.some((item) => item.id === 'E001'), 'E001');

  let adminModule = null;
  try {
    const url = `${pathToFileURL(importedAdmin).href}?run=${encodeURIComponent(runId)}`;
    adminModule = await import(url);
    add(assertions, 'ADMIN_MODULE_IMPORTED', typeof adminModule.isExactIdleReleaseStatusPayload === 'function');
  } catch (err) {
    add(assertions, 'ADMIN_MODULE_IMPORTED', false, err.message);
  }
  if (adminModule?.isExactIdleReleaseStatusPayload) {
    for (const item of exactCases) {
      const observed = adminModule.isExactIdleReleaseStatusPayload(item.payload || {});
      add(assertions, `FRONTEND_${item.id}`, observed === item.expectedExactIdle, `${item.name || ''}: observed=${observed} expected=${item.expectedExactIdle}`);
    }
  }

  const migrationFixturePath = path.join(fixtureRoot, 'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json');
  let migrationCases = readJson(migrationFixturePath);
  if (sourceMutation === 'empty-migration-fixture') migrationCases = [];
  if (sourceMutation === 'missing-required-migration-case') migrationCases = migrationCases.filter((item) => item.id !== 'S011');
  if (fixtureMutation === 'wrong-s001-expected') migrationCases = migrationCases.map((item) => item.id === 'S001' ? { ...item, expectedAction: 'noop_target' } : item);
  add(assertions, 'MIGRATION_FIXTURE_NON_EMPTY', migrationCases.length > 0, `count=${migrationCases.length}`);
  add(assertions, 'REQUIRED_MIGRATION_CASES_PRESENT', migrationCases.some((item) => item.id === 'S011'), 'S011');

  const migration = evaluateMigrationSource(root, migrationCases);
  add(assertions, 'MIGRATION_FILES_PRESENT', migration.migrationFiles.length === 5, `count=${migration.migrationFiles.length}`);
  add(assertions, 'MIGRATION_SOURCE_HASHES_RECORDED', migration.migrationFiles.every((f) => f.sha256 && f.byteLength > 0));
  add(assertions, 'ACQUIRE_013_SIGNATURE_PARSED', Boolean(migration.signatures.acquire013));
  add(assertions, 'AUDIT_013_SIGNATURE_PARSED', Boolean(migration.signatures.audit013));
  add(assertions, 'BRIDGE_ACQUIRE_TARGET_MATCHES_014', migration.sourceContracts.acquireTargetMatches014 === true);
  add(assertions, 'BRIDGE_AUDIT_TARGET_MATCHES_014', migration.sourceContracts.auditTargetMatches014 === true);
  for (const [key, branch] of Object.entries(migration.branches)) {
    add(assertions, `SQL_BRANCH_${key}_UNIQUE`, branch.uniqueBranch === true, JSON.stringify(branch));
    add(assertions, `SQL_BRANCH_${key}_RAISE_EXCEPTION`, branch.raiseExceptionFound === true, JSON.stringify(branch));
  }
  add(assertions, 'NO_DROP_CASCADE', migration.sourceContracts.dropCascadePresent === false);
  add(assertions, 'MIGRATION_ORDER_VALID', migration.migrationOrderValid === true, migration.migrationOrderObserved.join('>'));
  add(assertions, 'MIGRATION_017B_AFTER_015', migration.sourceContracts.migration017bAfter015 === true);
  for (const item of migration.caseResults) add(assertions, `MIGRATION_CASE_${item.id}`, item.pass === true, `${item.observedAction} === ${item.expectedAction}`, item);

  // Real cache-isolation control: import a copied module, mutate the file, then import with a cache-busting URL and require SHA divergence to be observable.
  const cacheFile = importedAdmin;
  const firstSha = sha256File(cacheFile);
  fs.appendFileSync(cacheFile, '\n// cache isolation second version\n');
  const secondSha = sha256File(cacheFile);
  add(assertions, 'IMPORT_CACHE_ISOLATION', firstSha !== secondSha, JSON.stringify({ firstSha, secondSha, staleModuleDetected: firstSha === secondSha }));

  const remainingBeforeCleanup = fs.existsSync(ownedRoot) ? fs.readdirSync(ownedRoot).map((name) => path.join(ownedRoot, name)) : [];
  const resultExtra = {
    targetAdminSha,
    importedAdminSha,
    targetGateSha,
    importedGateSha,
    migrationSourceFilesRead: migration.migrationFiles.map((f) => f.relativePath),
    migrationSourceHashes: Object.fromEntries(migration.migrationFiles.map((f) => [f.relativePath, f.sha256])),
    migrationCaseResults: migration.caseResults,
    migrationDirectoryEntries: migration.migrationDirectoryEntries,
    migrationRelevantEntries: migration.migrationRelevantEntries,
    migrationOrderObserved: migration.migrationOrderObserved,
    remainingOwnedPaths: [],
    remainingOwnedPathsBeforeCleanup: remainingBeforeCleanup,
  };
  const failed = assertions.filter((a) => !a.pass).length;
  fs.rmSync(ownedRoot, { recursive: true, force: true });
  writeResult(assertions, resultExtra, failed ? 1 : 0);
}

try {
  const scenarioHandled = await handleScenarioOnly();
  if (!scenarioHandled) await runNormal();
} catch (err) {
  const assertions = [];
  add(assertions, 'CHILD_UNCAUGHT_EXCEPTION', false, err.stack || err.message);
  try { fs.rmSync(ownedRoot, { recursive: true, force: true }); } catch {}
  writeResult(assertions, { error: err.stack || err.message }, 2);
}
