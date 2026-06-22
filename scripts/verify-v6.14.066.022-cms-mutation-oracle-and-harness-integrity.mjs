#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const PROTOCOL_VERSION = 'v6.14.066.022';
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const ROOT = path.resolve(args.get('root') || process.cwd());
const FIXTURE_ROOT = path.resolve(args.get('fixture-root') || ROOT);
const RUN_MUTATIONS = args.get('mutations') !== 'false';
const RUN_ID = `cms-066022-${Date.now()}-${process.pid}`;
const TEMP_PREFIX = 'cms-066022-';
const RUN_ROOT = path.join(os.tmpdir(), RUN_ID);
const CHILD_RUNNER_REL = 'scripts/verify-v6.14.066.022-cms-harness-child-runner.mjs';
const PARENT_REL = 'scripts/verify-v6.14.066.022-cms-mutation-oracle-and-harness-integrity.mjs';
const PRODUCT_MUTATIONS_REL = 'scripts/fixtures/v6.14.066.022-product-mutation-cases.json';
const HARNESS_MUTATIONS_REL = 'scripts/fixtures/v6.14.066.022-harness-mutation-cases.json';
const REQUIRED_FIXTURE_REL = 'scripts/fixtures/v6.14.066.022-required-verification-cases.json';
const EXACT_FIXTURE_021_REL = 'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json';
const MIGRATION_FIXTURE_020_REL = 'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json';
const MIGRATIONS = [
  'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql',
  'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql',
  'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql',
  'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql',
  'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql'
];

function sha256Bytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function sha256File(file) { return sha256Bytes(fs.readFileSync(file)); }
function readText(root, rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function writeText(root, rel, text) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
function readJson(root, rel) { return JSON.parse(readText(root, rel)); }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function listOwnedTempRoots() { return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX)).map((name) => path.join(os.tmpdir(), name)).filter(isDir); }
function addAssertion(assertions, id, pass, message = '') { assertions.push({ id, pass: Boolean(pass), message }); }
function uniqueIds(items, label) {
  const seen = new Set();
  const dupes = [];
  for (const item of items) {
    if (!item?.id) dupes.push('<missing>');
    if (seen.has(item.id)) dupes.push(item.id);
    seen.add(item.id);
  }
  if (dupes.length) throw new Error(`${label} duplicate or missing IDs: ${dupes.join(',')}`);
}
function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  return true;
}
function copyVerificationAndSource(fromRoot, toRoot) {
  fs.mkdirSync(toRoot, { recursive: true });
  fs.cpSync(path.join(fromRoot, 'src/cms-admin'), path.join(toRoot, 'src/cms-admin'), { recursive: true });
  for (const rel of MIGRATIONS) copyIfExists(path.join(fromRoot, rel), path.join(toRoot, rel));
  for (const rel of [
    CHILD_RUNNER_REL,
    PARENT_REL,
    PRODUCT_MUTATIONS_REL,
    HARNESS_MUTATIONS_REL,
    REQUIRED_FIXTURE_REL,
    EXACT_FIXTURE_021_REL,
    MIGRATION_FIXTURE_020_REL,
  ]) {
    const sourcePath = fs.existsSync(path.join(fromRoot, rel)) ? path.join(fromRoot, rel) : path.join(FIXTURE_ROOT, rel);
    copyIfExists(sourcePath, path.join(toRoot, rel));
  }
}
function applyReplacement(root, mutation) {
  const file = path.join(root, mutation.target);
  if (!fs.existsSync(file)) return { replacementCount: 0, beforeSha: '', afterSha: '' };
  const before = fs.readFileSync(file, 'utf8');
  const beforeSha = sha256Bytes(before);
  const search = String(mutation.search ?? '');
  if (!search) return { replacementCount: 0, beforeSha, afterSha: beforeSha };
  let count = 0;
  const after = before.split(search).join(() => { count += 1; return mutation.replacement; });
  // String.prototype.join callback is not supported. Use explicit split below.
  const parts = before.split(search);
  count = parts.length - 1;
  const finalText = parts.join(String(mutation.replacement ?? ''));
  fs.writeFileSync(file, finalText);
  return { replacementCount: count, beforeSha, afterSha: sha256Bytes(finalText) };
}
function validateProtocol(result, expectedRunId, expectedRoot) {
  const errors = [];
  if (!result || typeof result !== 'object') errors.push('result not object');
  if (result?.protocolVersion !== PROTOCOL_VERSION) errors.push(`protocol=${result?.protocolVersion}`);
  if (result?.runId !== expectedRunId) errors.push(`runId=${result?.runId}`);
  if (path.resolve(result?.root || '') !== path.resolve(expectedRoot)) errors.push(`root=${result?.root}`);
  if (!Array.isArray(result?.assertions)) errors.push('assertions missing');
  const ids = (result?.assertions || []).map((a) => a.id);
  if (new Set(ids).size !== ids.length) errors.push('duplicate assertion IDs');
  const actualPass = (result?.assertions || []).filter((a) => a.pass).length;
  const actualFail = (result?.assertions || []).filter((a) => !a.pass).length;
  if (result?.passCount !== actualPass || result?.failCount !== actualFail || result?.totalCount !== ids.length) errors.push('count mismatch');
  if (!result?.targetAdminSha256 || !result?.importedAdminSha256 || !result?.targetGateSha256 || !result?.importedGateSha256) errors.push('hash fields missing');
  if (!result?.cleanup || !Array.isArray(result.cleanup.remainingOwnedRoots)) errors.push('cleanup evidence missing');
  return errors;
}
function runChild({ root, fixtureRoot, runId, childRunnerPath, childOwnedRoot, timeoutMs = 45000 }) {
  fs.mkdirSync(childOwnedRoot, { recursive: true });
  const resultFile = path.join(childOwnedRoot, 'child-result.json');
  const child = spawnSync(process.execPath, [
    childRunnerPath,
    `--root=${root}`,
    `--fixture-root=${fixtureRoot}`,
    `--run-id=${runId}`,
    `--owned-root=${childOwnedRoot}`,
    `--result-file=${resultFile}`,
  ], {
    encoding: 'utf8',
    timeout: timeoutMs,
    cwd: root,
  });
  let result = null;
  let parseError = '';
  try {
    if (fs.existsSync(resultFile)) result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    else if (child.stdout && child.stdout.trim().startsWith('{')) result = JSON.parse(child.stdout);
  } catch (err) {
    parseError = err.message;
  }
  const protocolErrors = result ? validateProtocol(result, runId, root) : ['missing structured result'];
  return { child, result, resultFile, parseError, protocolErrors };
}
function analyzeMutation(mutation, childRun, replacement, mutatedRoot, baselineRoot) {
  const assertionList = childRun.result?.assertions || [];
  const actualFailedAssertions = assertionList.filter((a) => !a.pass).map((a) => a.id);
  const expected = mutation.expectedFailedAssertions || [];
  const allowed = mutation.allowedAdditionalFailures || [];
  const expectedMissing = expected.filter((id) => !actualFailedAssertions.includes(id));
  const allowedSet = new Set([...expected, ...allowed]);
  const unexpectedFailed = actualFailedAssertions.filter((id) => !allowedSet.has(id));
  const requiredReplacementCount = mutation.requiredReplacementCount ?? 1;
  const replacementCountOk = replacement.replacementCount === requiredReplacementCount;
  const expectedNonEmpty = expected.length > 0;
  const childExecuted = Boolean(childRun.result && Array.isArray(childRun.result.assertions));
  const childRootOk = childRun.result && path.resolve(childRun.result.root) === path.resolve(mutatedRoot);
  const hashProofPass = Boolean(childRun.result
    && childRun.result.targetAdminSha256 === childRun.result.importedAdminSha256
    && childRun.result.targetGateSha256 === childRun.result.importedGateSha256);
  const isProductMutation = mutation.category === 'product';
  const targetFile = path.join(mutatedRoot, mutation.target);
  const baselineFile = path.join(baselineRoot, mutation.target);
  const targetSha = fs.existsSync(targetFile) ? sha256File(targetFile) : '';
  const baselineSha = fs.existsSync(baselineFile) ? sha256File(baselineFile) : '';
  const productHashChanged = !isProductMutation || (targetSha && baselineSha && targetSha !== baselineSha);
  const protocolPass = childRun.protocolErrors.length === 0;
  const cleanupPass = mutation.allowCleanupFailure === true ? true : childRun.result?.cleanup?.remainingOwnedRoots?.length === 0;
  const accepted = Boolean(
    replacementCountOk
    && expectedNonEmpty
    && expectedMissing.length === 0
    && unexpectedFailed.length === 0
    && childExecuted
    && childRootOk
    && hashProofPass
    && productHashChanged
    && protocolPass
    && cleanupPass
  );
  let rejectReason = '';
  if (accepted) rejectReason = '';
  else if (!replacementCountOk) rejectReason = 'REPLACEMENT_COUNT_MISMATCH';
  else if (!expectedNonEmpty) rejectReason = 'EXPECTED_FAILURES_EMPTY';
  else if (expectedMissing.length) rejectReason = 'EXPECTED_FAILURE_NOT_OBSERVED';
  else if (unexpectedFailed.length) rejectReason = 'UNEXPECTED_FAILURES';
  else if (!childExecuted) rejectReason = 'CHILD_NOT_EXECUTED';
  else if (!childRootOk) rejectReason = 'CHILD_ROOT_MISMATCH';
  else if (!hashProofPass || !productHashChanged) rejectReason = 'HASH_PROOF_FAILED';
  else if (!protocolPass) rejectReason = 'PROTOCOL_INVALID';
  else if (!cleanupPass) rejectReason = 'CLEANUP_FAILED';
  else rejectReason = 'UNKNOWN_REJECTION';
  return {
    id: mutation.id,
    category: mutation.category,
    target: mutation.target,
    replacementCount: replacement.replacementCount,
    requiredReplacementCount,
    baselineSha,
    mutatedSha: targetSha,
    childStatus: childRun.child.status,
    childSignal: childRun.child.signal,
    childError: childRun.child.error?.message || '',
    protocolErrors: childRun.protocolErrors,
    actualFailedAssertions,
    expectedFailedAssertions: expected,
    expectedMissing,
    unexpectedFailed,
    accepted,
    rejectReason,
    expectedRejection: mutation.expectAccepted === false,
    expectedRejectReason: mutation.expectedRejectReason || '',
    correctlyRejected: mutation.expectAccepted === false && !accepted && (!mutation.expectedRejectReason || mutation.expectedRejectReason === rejectReason),
    childExecuted,
    childRootOk,
    hashProofPass,
    cleanupPass,
  };
}
function mutationRootFor(id) { return path.join(RUN_ROOT, `mutation-${id}`); }
function childRunnerForMutation(root, mutation) {
  return path.join(root, CHILD_RUNNER_REL);
}
function summarizeMutations(records) {
  const product = records.filter((r) => r.category === 'product');
  const harness = records.filter((r) => r.category === 'harness');
  const controls = records.filter((r) => r.expectedRejection);
  return {
    PRODUCT_MUTANTS_TOTAL: product.length,
    PRODUCT_MUTANTS_KILLED: product.filter((r) => r.accepted).length,
    PRODUCT_MUTANTS_SURVIVED: product.filter((r) => !r.accepted).length,
    PRODUCT_MUTANTS_INVALID: product.filter((r) => !r.accepted).length,
    HARNESS_MUTANTS_TOTAL: harness.length,
    HARNESS_MUTANTS_KILLED: harness.filter((r) => r.accepted).length,
    HARNESS_MUTANTS_SURVIVED: harness.filter((r) => !r.accepted).length,
    HARNESS_MUTANTS_INVALID: harness.filter((r) => !r.accepted).length,
    ORACLE_CONTROLS_TOTAL: controls.length,
    ORACLE_CONTROLS_CORRECTLY_REJECTED: controls.filter((r) => r.correctlyRejected).length,
    ORACLE_CONTROLS_INCORRECTLY_ACCEPTED: controls.filter((r) => !r.correctlyRejected).length,
  };
}

const startedRoots = listOwnedTempRoots();
const finalAssertions = [];
let normal = null;
let mutationRecords = [];
let rootsCreated = 0;
let rootsRemoved = 0;
try {
  fs.mkdirSync(RUN_ROOT, { recursive: true });
  rootsCreated += 1;
  for (const rel of [CHILD_RUNNER_REL, PRODUCT_MUTATIONS_REL, HARNESS_MUTATIONS_REL, REQUIRED_FIXTURE_REL]) {
    addAssertion(finalAssertions, `FILE_PRESENT_${path.basename(rel)}`, fs.existsSync(path.join(ROOT, rel)), rel);
  }
  const productManifest = readJson(ROOT, PRODUCT_MUTATIONS_REL);
  const harnessManifest = readJson(ROOT, HARNESS_MUTATIONS_REL);
  uniqueIds(productManifest, 'product mutation manifest');
  uniqueIds(harnessManifest, 'harness mutation manifest');
  addAssertion(finalAssertions, 'PRODUCT_MUTATION_MANIFEST_NON_EMPTY', productManifest.length > 0, `count=${productManifest.length}`);
  addAssertion(finalAssertions, 'HARNESS_MUTATION_MANIFEST_NON_EMPTY', harnessManifest.length > 0, `count=${harnessManifest.length}`);

  const normalRoot = path.join(RUN_ROOT, 'normal-source');
  copyVerificationAndSource(ROOT, normalRoot);
  const normalChildRoot = path.join(RUN_ROOT, 'normal-child');
  normal = runChild({ root: normalRoot, fixtureRoot: normalRoot, runId: `${RUN_ID}-normal`, childRunnerPath: path.join(normalRoot, CHILD_RUNNER_REL), childOwnedRoot: normalChildRoot });
  addAssertion(finalAssertions, 'NORMAL_SOURCE_CHILD_PROTOCOL_VALID', normal.protocolErrors.length === 0, normal.protocolErrors.join(';'));
  addAssertion(finalAssertions, 'NORMAL_SOURCE_PASS', normal.result?.failCount === 0, `fail=${normal.result?.failCount}`);
  addAssertion(finalAssertions, 'NORMAL_REQUIRED_FRONTEND_EXECUTED', (normal.result?.executedFrontendCaseIds || []).length > 0, `count=${normal.result?.executedFrontendCaseIds?.length || 0}`);
  addAssertion(finalAssertions, 'NORMAL_REQUIRED_MIGRATION_EXECUTED', (normal.result?.executedMigrationCaseIds || []).length > 0, `count=${normal.result?.executedMigrationCaseIds?.length || 0}`);

  if (RUN_MUTATIONS) {
    const allMutations = [...productManifest, ...harnessManifest];
    for (const mutation of allMutations) {
      const mutatedRoot = mutationRootFor(mutation.id);
      copyVerificationAndSource(ROOT, mutatedRoot);
      const replacement = applyReplacement(mutatedRoot, mutation);
      const mutatedChildRoot = path.join(RUN_ROOT, `child-${mutation.id}`);
      const childRunnerPath = mutation.category === 'harness' || mutation.target === CHILD_RUNNER_REL
        ? childRunnerForMutation(mutatedRoot, mutation)
        : path.join(ROOT, CHILD_RUNNER_REL);
      const childRun = runChild({
        root: mutatedRoot,
        fixtureRoot: mutatedRoot,
        runId: `${RUN_ID}-${mutation.id}`,
        childRunnerPath,
        childOwnedRoot: mutatedChildRoot,
      });
      const record = analyzeMutation(mutation, childRun, replacement, mutatedRoot, ROOT);
      mutationRecords.push(record);
      if (mutation.expectAccepted === false) {
        addAssertion(finalAssertions, `MUTATION_${mutation.id}_CORRECTLY_REJECTED`, record.correctlyRejected, `${record.rejectReason}`);
      } else {
        addAssertion(finalAssertions, `MUTATION_${mutation.id}_KILLED`, record.accepted, `${record.rejectReason}; missing=${record.expectedMissing.join(',')}; unexpected=${record.unexpectedFailed.join(',')}`);
      }
    }
  }
  const summary = summarizeMutations(mutationRecords);
  addAssertion(finalAssertions, 'PRODUCT_MUTANTS_KILLED_ALL', summary.PRODUCT_MUTANTS_TOTAL > 0 && summary.PRODUCT_MUTANTS_KILLED === summary.PRODUCT_MUTANTS_TOTAL, JSON.stringify(summary));
  addAssertion(finalAssertions, 'HARNESS_MUTANTS_KILLED_ALL', summary.HARNESS_MUTANTS_TOTAL > 0 && summary.HARNESS_MUTANTS_KILLED === summary.HARNESS_MUTANTS_TOTAL, JSON.stringify(summary));
  addAssertion(finalAssertions, 'ORACLE_CONTROLS_REJECTED_ALL', summary.ORACLE_CONTROLS_TOTAL > 0 && summary.ORACLE_CONTROLS_CORRECTLY_REJECTED === summary.ORACLE_CONTROLS_TOTAL, JSON.stringify(summary));

  // Emergency cleanup is separate from child cleanup evidence. The child reports its own cleanup before parent removes the run root.
  fs.rmSync(RUN_ROOT, { recursive: true, force: true });
  rootsRemoved += 1;
} catch (err) {
  addAssertion(finalAssertions, 'PARENT_UNCAUGHT_EXCEPTION', false, err.stack || err.message);
} finally {
  if (fs.existsSync(RUN_ROOT)) {
    fs.rmSync(RUN_ROOT, { recursive: true, force: true });
    rootsRemoved += 1;
  }
}
const endedRoots = listOwnedTempRoots();
const newRemaining = endedRoots.filter((root) => !startedRoots.includes(root));
addAssertion(finalAssertions, 'PARENT_TEMP_ROOTS_ZERO_LEAK', newRemaining.length === 0, newRemaining.join(','));
const finalPassCount = finalAssertions.filter((a) => a.pass).length;
const finalFailCount = finalAssertions.length - finalPassCount;
const mutationSummary = summarizeMutations(mutationRecords);
const output = {
  protocolVersion: PROTOCOL_VERSION,
  root: ROOT,
  fixtureRoot: FIXTURE_ROOT,
  runId: RUN_ID,
  normal: normal?.result || null,
  mutationRecords,
  mutationSummary,
  childProcessSummary: {
    CHILD_PROCESS_TOTAL: mutationRecords.length + (normal ? 1 : 0),
    CHILD_PROCESS_TIMEOUTS: mutationRecords.filter((r) => /timed out/i.test(r.childError || '')).length,
    CHILD_PROCESS_CRASHES: mutationRecords.filter((r) => r.childSignal || (typeof r.childStatus === 'number' && r.childStatus !== 0 && r.actualFailedAssertions.length === 0)).length,
  },
  cleanupSummary: {
    TEMP_ROOTS_CREATED: rootsCreated,
    TEMP_ROOTS_REMOVED: rootsRemoved,
    TEMP_ROOTS_REMAINING: newRemaining,
  },
  assertions: finalAssertions,
  passCount: finalPassCount,
  failCount: finalFailCount,
  totalCount: finalAssertions.length,
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (finalFailCount > 0) process.exit(1);
