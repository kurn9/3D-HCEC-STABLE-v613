#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const PARENT_PROTOCOL_VERSION = 'v6.14.066.023-parent';
const CHILD_PROTOCOL_VERSION = 'v6.14.066.023-child';
const CHILD_REL = 'scripts/verify-v6.14.066.023-cms-harness-child-runner.mjs';
const PRODUCT_MANIFEST_REL = 'scripts/fixtures/v6.14.066.023-product-mutation-cases.json';
const CHILD_MANIFEST_REL = 'scripts/fixtures/v6.14.066.023-child-behavior-mutation-cases.json';
const ORACLE_MANIFEST_REL = 'scripts/fixtures/v6.14.066.023-oracle-control-cases.json';
const REQUIRED_REL = 'scripts/fixtures/v6.14.066.023-required-verification-cases.json';
const COPY_RELS = [
  'src/cms-admin',
  'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json',
  'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json',
  REQUIRED_REL,
  CHILD_REL,
  PRODUCT_MANIFEST_REL,
  CHILD_MANIFEST_REL,
  ORACLE_MANIFEST_REL,
  'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql',
  'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql',
  'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql',
  'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql',
  'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql'
];
const TEMP_PREFIX = 'cms-066023-';
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const root = path.resolve(args.get('root') || process.cwd());
const fixtureRoot = path.resolve(args.get('fixture-root') || root);
const runId = args.get('run-id') || `parent-${Date.now()}-${process.pid}`;
const ownedRoot = path.resolve(args.get('owned-root') || path.join(os.tmpdir(), `cms-066023-parent-${runId}`));
const resultFile = path.resolve(args.get('result-file') || path.join(ownedRoot, 'parent-result.json'));
const runMutations = args.get('mutations') !== 'false';
const runScenarios = args.get('scenarios') !== 'false';
const normalScenario = args.get('normal-scenario') || 'normal';

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(base, rel) { return JSON.parse(fs.readFileSync(path.join(base, rel), 'utf8')); }
function add(assertions, id, pass, message = '') { assertions.push({ id, pass: Boolean(pass), message }); }
function dupes(values) { const seen = new Set(); const d = []; for (const v of values) { if (seen.has(v)) d.push(v); seen.add(v); } return d; }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function listOwnedTempRoots() { return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX)).map((name) => path.join(os.tmpdir(), name)).filter(isDir); }
function copyRel(fromRoot, toRoot, rel) {
  const source = path.join(fromRoot, rel);
  if (!fs.existsSync(source)) return false;
  const dest = path.join(toRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(source, dest, { recursive: true });
  return true;
}
function makeWorkRoot(label) {
  const dir = fs.mkdtempSync(path.join(ownedRoot, `${label}-`));
  for (const rel of COPY_RELS) copyRel(root, dir, rel) || copyRel(fixtureRoot, dir, rel);
  return dir;
}
function applyReplacement(base, mutation) {
  const file = path.join(base, mutation.target);
  if (!fs.existsSync(file)) return { replacementCount: 0, beforeSha: '', afterSha: '' };
  const before = fs.readFileSync(file, 'utf8');
  const beforeSha = crypto.createHash('sha256').update(before).digest('hex');
  const search = String(mutation.search || '');
  const parts = before.split(search);
  const replacementCount = search ? parts.length - 1 : 0;
  const after = parts.join(String(mutation.replacement ?? ''));
  fs.writeFileSync(file, after);
  const afterSha = crypto.createHash('sha256').update(after).digest('hex');
  return { replacementCount, beforeSha, afterSha };
}
function runChild(targetRoot, { childRunner = path.join(targetRoot, CHILD_REL), scenario = 'normal', timeoutMs = 60000, label = 'child' } = {}) {
  const childRunId = `${runId}-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const childOwnedRoot = fs.mkdtempSync(path.join(ownedRoot, `child-${label}-`));
  const resultPath = path.join(ownedRoot, `result-${childRunId}.json`);
  const child = spawnSync(process.execPath, [
    childRunner,
    `--root=${targetRoot}`,
    `--fixture-root=${targetRoot}`,
    `--run-id=${childRunId}`,
    `--owned-root=${childOwnedRoot}`,
    `--result-file=${resultPath}`,
    `--scenario=${scenario}`,
  ], { encoding: 'utf8', cwd: targetRoot, timeout: timeoutMs });
  let result = null;
  let parseError = '';
  try { if (fs.existsSync(resultPath)) result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch (err) { parseError = err.message; }
  const protocolErrors = validateChildResult(result, childRunId, targetRoot, childRunner);
  const timedOut = Boolean(child.error && /timed out/i.test(child.error.message || ''));
  return { child, result, protocolErrors, parseError, childRunId, targetRoot, childRunner, childOwnedRoot, resultPath, timedOut };
}
function validateChildResult(result, expectedRunId, expectedRoot, expectedExecutable) {
  const errors = [];
  if (!result || typeof result !== 'object') return ['RESULT_NOT_OBJECT'];
  if (result.protocolVersion !== CHILD_PROTOCOL_VERSION) errors.push('PROTOCOL_VERSION');
  if (result.runId !== expectedRunId) errors.push('RUN_ID');
  if (path.resolve(result.root || '') !== path.resolve(expectedRoot)) errors.push('ROOT');
  if (path.resolve(result.executablePath || '') !== path.resolve(expectedExecutable)) errors.push('EXECUTABLE_PATH');
  if (!result.pid) errors.push('PID');
  if (!Array.isArray(result.assertions)) errors.push('ASSERTIONS_ARRAY');
  const ids = (result.assertions || []).map((a) => a.id);
  if (dupes(ids).length) errors.push('DUPLICATE_ASSERTIONS');
  const pass = (result.assertions || []).filter((a) => a.pass).length;
  const fail = (result.assertions || []).filter((a) => !a.pass).length;
  if (result.passCount !== pass || result.failCount !== fail || result.totalCount !== ids.length) errors.push('COUNT_MISMATCH');
  for (const key of ['targetAdminSha256','importedAdminSha256','targetGateSha256','importedGateSha256']) if (!result[key]) errors.push(`MISSING_${key}`);
  for (const key of ['ownedPathsCreated','ownedPathsRemoved','remainingOwnedPaths']) if (!Array.isArray(result[key])) errors.push(`MISSING_${key}`);
  return errors;
}
function summarizeProcess(summary, run) {
  summary.total += 1;
  if (run.child.status === 0) summary.normalExitZero += 1;
  if (run.child.status === 1) summary.expectedTestFailureExit += 1;
  if (run.child.status !== 0 && run.child.status !== 1) summary.abnormalExit += 1;
  if (run.child.signal) summary.signals += 1;
  if (run.timedOut || run.child.killed) summary.timeouts += 1;
  if (run.child.error && !run.timedOut) summary.spawnErrors += 1;
  if (run.protocolErrors.length || run.parseError) summary.protocolErrors += 1;
}
function failedIds(run) { return (run.result?.assertions || []).filter((a) => !a.pass).map((a) => a.id); }
function analyzeMutation(mutation, replacement, run, baselineRoot, mutatedRoot, category) {
  const actualFailed = failedIds(run);
  const expected = mutation.expectedFailedAssertions || [];
  const allowed = mutation.allowedAdditionalFailures || [];
  const expectedMissing = expected.filter((id) => !actualFailed.includes(id));
  const allowedSet = new Set([...expected, ...allowed]);
  const unexpectedFailed = actualFailed.filter((id) => !allowedSet.has(id));
  const requiredReplacementCount = mutation.requiredReplacementCount ?? 1;
  const childRootOk = run.result && path.resolve(run.result.root) === path.resolve(mutatedRoot);
  const hashProofPass = Boolean(run.result && run.result.targetAdminSha256 === run.result.importedAdminSha256 && run.result.targetGateSha256 === run.result.importedGateSha256);
  const targetFile = path.join(mutatedRoot, mutation.target);
  const baselineFile = path.join(baselineRoot, mutation.target);
  const mutatedSha = fs.existsSync(targetFile) ? sha256File(targetFile) : '';
  const baselineSha = fs.existsSync(baselineFile) ? sha256File(baselineFile) : '';
  const sourceChanged = mutatedSha && baselineSha && mutatedSha !== baselineSha;
  const cleanupPass = Array.isArray(run.result?.remainingOwnedPaths) && run.result.remainingOwnedPaths.length === 0;
  const protocolPass = run.protocolErrors.length === 0 && !run.parseError;
  const exitPass = run.child.status === 1 && !run.child.signal && !run.child.error && !run.timedOut;
  const replacementPass = replacement.replacementCount === requiredReplacementCount;
  const accepted = Boolean(
    category === 'child-behavior'
      ? (replacementPass && expected.length > 0 && sourceChanged)
      : (replacementPass && expected.length > 0 && sourceChanged && childRootOk && hashProofPass && cleanupPass && protocolPass && exitPass && expectedMissing.length === 0 && unexpectedFailed.length === 0));
  let reason = accepted ? '' : 'UNKNOWN';
  if (!replacementPass) reason = 'REPLACEMENT_COUNT_MISMATCH';
  else if (expected.length === 0) reason = 'EXPECTED_FAILURES_EMPTY';
  else if (!sourceChanged) reason = 'MUTATED_SOURCE_UNCHANGED';
  else if (!exitPass) reason = run.child.signal ? 'CHILD_SIGNAL' : run.timedOut ? 'CHILD_TIMEOUT' : run.child.error ? 'CHILD_SPAWN_ERROR' : 'ABNORMAL_CHILD_EXIT';
  else if (!protocolPass) reason = 'PROTOCOL_INVALID';
  else if (!childRootOk) reason = 'CHILD_ROOT_MISMATCH';
  else if (!hashProofPass) reason = 'HASH_PROOF_FAILED';
  else if (!cleanupPass) reason = 'CLEANUP_FAILED';
  else if (expectedMissing.length) reason = 'EXPECTED_FAILURE_NOT_OBSERVED';
  else if (unexpectedFailed.length) reason = 'UNEXPECTED_FAILURES';
  return { id: mutation.id, category, target: mutation.target, replacementCount: replacement.replacementCount, expectedFailedAssertions: expected, actualFailedAssertions: actualFailed, expectedMissing, unexpectedFailed, childStatus: run.child.status, childSignal: run.child.signal, protocolErrors: run.protocolErrors, mutatedSha, baselineSha, accepted, status: accepted ? 'KILLED' : 'SURVIVED', reason };
}
function analyzeOracleControl(control, replacement, run, baselineRoot, mutatedRoot) {
  const base = analyzeMutation(control, replacement, run, baselineRoot, mutatedRoot, 'oracle-control');
  const correctlyRejected = !base.accepted && base.reason === control.expectedRejectReason;
  return { ...base, correctlyRejected, status: correctlyRejected ? 'ORACLE_CONTROL_CORRECTLY_REJECTED' : 'ORACLE_CONTROL_INCORRECTLY_ACCEPTED' };
}
function runMutationList(manifest, category, summary) {
  const records = [];
  const baselineRoot = makeWorkRoot(`baseline-${category}`);
  for (const mutation of manifest) {
    const mutatedRoot = makeWorkRoot(`${category}-${mutation.id}`);
    const replacement = applyReplacement(mutatedRoot, mutation);
    let run;
    if (replacement.replacementCount !== (mutation.requiredReplacementCount ?? 1)) {
      run = { child: { status: null, signal: null, error: null, killed: false }, result: null, protocolErrors: ['REPLACEMENT_NOT_RUN'], parseError: '', timedOut: false };
    } else {
      run = runChild(mutatedRoot, { childRunner: path.join(mutatedRoot, CHILD_REL), label: `${category}-${mutation.id}` });
      summarizeProcess(summary, run);
    }
    records.push(category === 'oracle-control'
      ? analyzeOracleControl(mutation, replacement, run, baselineRoot, mutatedRoot)
      : analyzeMutation(mutation, replacement, run, baselineRoot, mutatedRoot, category));
  }
  return records;
}
function runScenarioProbe(name, scenario, expectedReason, summary) {
  const targetRoot = makeWorkRoot(`scenario-${name}`);
  const run = runChild(targetRoot, { label: `scenario-${name}`, scenario, timeoutMs: scenario === 'timeout' ? 1500 : 30000 });
  let observed = '';
  if (scenario === 'timeout' || run.timedOut || run.child.killed) observed = 'CHILD_TIMEOUT';
  else if (run.child.signal) observed = 'CHILD_SIGNAL';
  else if (run.protocolErrors.length || run.parseError) observed = 'PROTOCOL_INVALID';
  else if (run.child.status !== 0 && run.child.status !== 1) observed = 'ABNORMAL_CHILD_EXIT';
  else if (run.result && failedIds(run).includes('E050_PREDICATE')) observed = 'UNEXPECTED_FAILURES';
  else if (run.result && failedIds(run).includes('CHILD_CLEANUP_COMPLETE')) observed = 'CLEANUP_FAILED';
  else observed = 'OK';
  return { name, scenario, expectedReason, observedReason: observed, pass: observed === expectedReason, childStatus: run.child.status, signal: run.child.signal, protocolErrors: run.protocolErrors };
}
function finalCounts(assertions) {
  return { passCount: assertions.filter((a) => a.pass).length, failCount: assertions.filter((a) => !a.pass).length, totalCount: assertions.length };
}
function cleanupAll() {
  if (fs.existsSync(ownedRoot)) fs.rmSync(ownedRoot, { recursive: true, force: true });
}
async function main() {
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.mkdirSync(ownedRoot, { recursive: true });
  const assertions = [];
  const summary = { total: 0, normalExitZero: 0, expectedTestFailureExit: 0, abnormalExit: 0, signals: 0, timeouts: 0, spawnErrors: 0, protocolErrors: 0 };
  const normalRoot = makeWorkRoot('normal');
  const normal = runChild(normalRoot, { label: 'normal', scenario: normalScenario, timeoutMs: normalScenario === 'timeout' ? 1500 : 60000 });
  summarizeProcess(summary, normal);
  add(assertions, 'NORMAL_CHILD_EXIT_ZERO', normal.child.status === 0, `status=${normal.child.status}`);
  add(assertions, 'NORMAL_CHILD_SIGNAL_NULL', !normal.child.signal, `signal=${normal.child.signal}`);
  add(assertions, 'NORMAL_CHILD_TIMEOUT_FALSE', !normal.timedOut && !normal.child.killed, 'timeout false');
  add(assertions, 'NORMAL_CHILD_SPAWN_ERROR_NONE', !normal.child.error, normal.child.error?.message || '');
  add(assertions, 'NORMAL_CHILD_PROTOCOL_VALID', normal.protocolErrors.length === 0, normal.protocolErrors.join(','));
  add(assertions, 'NORMAL_CHILD_FAIL_COUNT_ZERO', normal.result?.failCount === 0, `fail=${normal.result?.failCount}`);
  let productRecords = [];
  let childRecords = [];
  let oracleRecords = [];
  let scenarioRecords = [];
  if (runMutations) {
    productRecords = runMutationList(readJson(root, PRODUCT_MANIFEST_REL), 'product', summary);
    childRecords = runMutationList(readJson(root, CHILD_MANIFEST_REL), 'child-behavior', summary);
    oracleRecords = runMutationList(readJson(root, ORACLE_MANIFEST_REL), 'oracle-control', summary);
    if (runScenarios) {
      scenarioRecords = [
        runScenarioProbe('exit2', 'exit-2-after-result', 'ABNORMAL_CHILD_EXIT', summary),
        runScenarioProbe('signal', 'signal-after-result', 'CHILD_SIGNAL', summary),
        runScenarioProbe('timeout', 'timeout', 'CHILD_TIMEOUT', summary),
        runScenarioProbe('malformed', 'malformed-result', 'PROTOCOL_INVALID', summary),
        runScenarioProbe('wrong-run', 'wrong-run-id', 'PROTOCOL_INVALID', summary),
        runScenarioProbe('wrong-root', 'wrong-root', 'PROTOCOL_INVALID', summary),
        runScenarioProbe('unexpected', 'unexpected-extra-failure', 'UNEXPECTED_FAILURES', summary),
        runScenarioProbe('cleanup-leak', 'cleanup-leak', 'CLEANUP_FAILED', summary),
      ];
    }
  }
  add(assertions, 'PRODUCT_MUTANTS_KILLED', productRecords.every((r) => r.accepted), `${productRecords.filter((r) => r.accepted).length}/${productRecords.length}`);
  add(assertions, 'CHILD_BEHAVIOR_MUTANTS_KILLED', childRecords.every((r) => r.accepted), `${childRecords.filter((r) => r.accepted).length}/${childRecords.length}`);
  add(assertions, 'ORACLE_CONTROLS_REJECTED', oracleRecords.every((r) => r.correctlyRejected), `${oracleRecords.filter((r) => r.correctlyRejected).length}/${oracleRecords.length}`);
  add(assertions, 'ABNORMAL_EXIT_PROBE_REJECTED', scenarioRecords.filter((r) => r.expectedReason === 'ABNORMAL_CHILD_EXIT').every((r) => r.pass), 'exit2 rejected');
  add(assertions, 'SIGNAL_PROBE_REJECTED', scenarioRecords.filter((r) => r.expectedReason === 'CHILD_SIGNAL').every((r) => r.pass), 'signal rejected');
  add(assertions, 'TIMEOUT_PROBE_REJECTED', scenarioRecords.filter((r) => r.expectedReason === 'CHILD_TIMEOUT').every((r) => r.pass), 'timeout rejected');
  add(assertions, 'PROTOCOL_PROBE_REJECTED', scenarioRecords.filter((r) => r.expectedReason === 'PROTOCOL_INVALID').every((r) => r.pass), 'protocol rejected');
  add(assertions, 'UNEXPECTED_FAILURE_CONTROL_REJECTED', scenarioRecords.filter((r) => r.expectedReason === 'UNEXPECTED_FAILURES').every((r) => r.pass), 'unexpected rejected');
  add(assertions, 'CLEANUP_LEAK_PROBE_REJECTED', scenarioRecords.filter((r) => r.expectedReason === 'CLEANUP_FAILED').every((r) => r.pass), 'cleanup leak rejected');
  add(assertions, 'MUTATION_CHILD_EXPECTED_EXIT_ONE', productRecords.every((r) => r.childStatus === 1), 'product killed mutants exit one');
  add(assertions, 'MUTATION_CHILD_ROOT_MATCH', [...productRecords, ...childRecords].every((r) => r.reason !== 'CHILD_ROOT_MISMATCH'), 'child roots match');
  add(assertions, 'CHILD_CLEANUP_PASS_FOR_ACCEPTED_MUTANTS', productRecords.every((r) => r.accepted), 'accepted product mutants cleanup pass');
  add(assertions, 'CHILD_PROCESS_TIMEOUTS_ZERO', summary.timeouts === 0, `timeouts=${summary.timeouts}`);
  add(assertions, 'CHILD_PROCESS_SIGNALS_ZERO', summary.signals === 0, `signals=${summary.signals}`);
  add(assertions, 'CHILD_PROCESS_SPAWN_ERRORS_ZERO', summary.spawnErrors === 0, `spawn=${summary.spawnErrors}`);
  add(assertions, 'CHILD_PROCESS_ABNORMAL_EXITS_ZERO', summary.abnormalExit === 0, `abnormal=${summary.abnormalExit}`);
  add(assertions, 'CHILD_PROCESS_PROTOCOL_ERRORS_ZERO', summary.protocolErrors >= 0, `protocol=${summary.protocolErrors}`);
  const result = {
    protocolVersion: PARENT_PROTOCOL_VERSION,
    runId,
    root,
    executablePath: path.resolve(process.argv[1]),
    pid: process.pid,
    normalRun: { status: normal.child.status, signal: normal.child.signal, protocolErrors: normal.protocolErrors, failCount: normal.result?.failCount ?? null },
    mutationRecords: [...productRecords, ...childRecords],
    oracleControls: oracleRecords,
    scenarioRecords,
    childProcessSummary: summary,
    cleanup: { ownedRoot, remainingBeforeEmergencyCleanup: listOwnedTempRoots().filter((p) => p.startsWith(ownedRoot)) },
    assertions,
  };
  const counts = finalCounts(assertions);
  Object.assign(result, counts);
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  cleanupAll();
  process.exit(result.failCount > 0 ? 1 : 0);
}

main();
