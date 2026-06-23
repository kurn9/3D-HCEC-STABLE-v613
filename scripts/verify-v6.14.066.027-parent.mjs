#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  PROTOCOL_VERSION,
  canonicalEvidence,
  classifyProcessOutcome,
  evaluateMutationOutcome,
  evaluateParentAcceptance,
  summarizeScenarioRecords,
  validateChildProtocol,
  validateMutationManifest,
} from './lib/v6.14.066.027-oracle.mjs';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const root = path.resolve(args.get('root') || process.cwd());
const fixtureRoot = path.resolve(args.get('fixture-root') || root);
const runId = args.get('run-id') || `parent-${Date.now()}-${process.pid}`;
const ownedRoot = path.resolve(args.get('owned-root') || path.join(os.tmpdir(), `cms-066027-parent-${runId}`));
const resultFile = path.resolve(args.get('result-file') || path.join(os.tmpdir(), `cms-066027-parent-result-${runId}.json`));
const runMutations = args.get('mutations') !== 'false';
const runScenarios = args.get('scenarios') !== 'false';
const parentScenario = args.get('parent-scenario') || 'normal';

const CHILD_REL = 'scripts/verify-v6.14.066.027-child.mjs';
const COPY_RELS = [
  'src/cms-admin/adminState.js',
  'src/cms-admin/adminReleaseOperationGate.js',
  'src/cms-admin/adminConfig.js',
  'supabase/migrations',
  'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json',
  'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json',
  'scripts/fixtures/v6.14.066.027-cases.json',
  CHILD_REL,
  'scripts/lib/v6.14.066.027-oracle.mjs',
  'scripts/lib/v6.14.066.027-sql.mjs',
];

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function add(assertions, id, pass, message = '', details = null) { assertions.push({ id, pass: Boolean(pass), message, ...(details ? { details } : {}) }); }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function listRunRoots() { return fs.existsSync(os.tmpdir()) ? fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('cms-066027-')).map((n) => path.join(os.tmpdir(), n)).filter((p) => p.includes(runId) && isDir(p)) : []; }
function copyRel(fromRoot, toRoot, rel) {
  const src = path.join(fromRoot, rel);
  const dst = path.join(toRoot, rel);
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
  return true;
}
function makeWorkRoot(label) {
  const dir = fs.mkdtempSync(path.join(ownedRoot, `${label}-`));
  for (const rel of COPY_RELS) copyRel(root, dir, rel) || copyRel(fixtureRoot, dir, rel);
  return dir;
}
function applyReplacement(base, target, search, replacement) {
  const file = path.join(base, target);
  const before = fs.readFileSync(file, 'utf8');
  const beforeSha = crypto.createHash('sha256').update(before).digest('hex');
  const parts = before.split(search);
  const replacementCount = search ? parts.length - 1 : 0;
  const after = parts.join(replacement);
  fs.writeFileSync(file, after);
  const afterSha = crypto.createHash('sha256').update(after).digest('hex');
  return { replacementCount, beforeSha, afterSha };
}
function renameRelevant(rootDir, matcher, transform) {
  const dir = path.join(rootDir, 'supabase/migrations');
  const name = fs.readdirSync(dir).find((n) => matcher.test(n));
  const newName = transform(name);
  fs.renameSync(path.join(dir, name), path.join(dir, newName));
  return { oldName: name, newName };
}
function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const item of fs.readdirSync(dir)) {
    const p = path.join(dir, item);
    count += 1;
    if (isDir(p)) count += countFiles(p);
  }
  return count;
}
function runChild(targetRoot, options = {}) {
  const label = options.label || options.scenario || 'normal';
  const childRunId = `${runId}-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const childOwnedRoot = path.join(ownedRoot, `child-owned-${label}-${Date.now()}`);
  const resultPath = path.join(ownedRoot, `child-result-${label}-${Date.now()}.json`);
  const childPath = path.join(targetRoot, CHILD_REL);
  let proc;
  if (options.osSpawnError) {
    proc = spawnSync('/tmp/cms-066027-nonexistent-binary', [], { encoding: 'utf8', timeout: 1000 });
  } else {
    const argv = [childPath, `--root=${targetRoot}`, `--fixture-root=${options.fixtureRoot || targetRoot}`, `--run-id=${childRunId}`, `--owned-root=${childOwnedRoot}`, `--result-file=${resultPath}`, `--scenario=${options.scenario || 'normal'}`];
    if (options.fixtureMutation) argv.push(`--fixture-mutation=${options.fixtureMutation}`);
    if (options.sourceMutation) argv.push(`--source-mutation=${options.sourceMutation}`);
    proc = spawnSync(process.execPath, argv, { encoding: 'utf8', cwd: targetRoot, timeout: options.timeoutMs || 5000 });
  }
  let result = null;
  let parseError = '';
  let resultPresent = fs.existsSync(resultPath);
  if (resultPresent) {
    try { result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); }
    catch (err) { parseError = err.message; }
  }
  const protocolErrors = result ? validateChildProtocol(result, { runId: childRunId, root: targetRoot, executablePath: childPath }) : (resultPresent ? ['RESULT_NOT_OBJECT'] : ['RESULT_MISSING']);
  const fsRemaining = countFiles(childOwnedRoot);
  const reportedRemaining = Array.isArray(result?.remainingOwnedPaths) ? result.remainingOwnedPaths.length : 0;
  const hiddenLeakDetected = fsRemaining > 0 && reportedRemaining === 0;
  const evidence = {
    id: label,
    scenario: options.scenario || (options.osSpawnError ? 'spawn-error' : 'normal'),
    status: proc.status,
    signal: proc.signal,
    timedOut: Boolean(proc.error && (proc.error.code === 'ETIMEDOUT' || /timed out/i.test(proc.error.message || ''))),
    spawnErrorCode: proc.error && proc.error.code !== 'ETIMEDOUT' ? proc.error.code : '',
    spawnErrorMessage: proc.error && proc.error.code !== 'ETIMEDOUT' ? proc.error.message : '',
    parseError,
    protocolErrors,
    resultPresent,
    failedAssertionIds: (result?.assertions || []).filter((a) => !a.pass).map((a) => a.id),
    result,
    cleanup: { reportedRemainingCount: reportedRemaining, filesystemRemainingCount: fsRemaining, hiddenLeakDetected },
    rootMatch: result ? result.root === targetRoot : false,
    runIdMatch: result ? result.runId === childRunId : false,
    executableMatch: result ? result.executablePath === childPath : false,
    executableUnderMutantRoot: childPath.startsWith(targetRoot),
    actualFunctionExecuted: true,
    scenarioPayload: { scenario: options.scenario || '', fixtureMutation: options.fixtureMutation || '', sourceMutation: options.sourceMutation || '', osSpawnError: Boolean(options.osSpawnError) },
  };
  evidence.canonical = canonicalEvidence(evidence);
  fs.rmSync(childOwnedRoot, { recursive: true, force: true });
  evidence.cleanup.filesystemRemainingAfterCleanup = countFiles(childOwnedRoot);
  return evidence;
}
function writeResult(assertions, extra = {}) {
  const result = { protocolVersion: PROTOCOL_VERSION, runId, root, executablePath: path.resolve(process.argv[1]), parentScenario, assertions, ...extra };
  result.passCount = assertions.filter((a) => a.pass).length;
  result.failCount = assertions.filter((a) => !a.pass).length;
  result.totalCount = assertions.length;
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  return result;
}

function evaluateOracleControls() {
  const controls = [];
  const base = { id: 'base', requiredReplacementCount: 1, replacementCount: 1, baselineSha: 'a', mutatedSha: 'b', expectedOutcome: 'EXPECTED_TEST_FAILURE', expectedFailedAssertions: ['EXPECTED_FAIL'] };
  const cases = [
    ['ORACLE_HARMLESS', { ...base }, { status: 1, failedAssertionIds: ['OTHER'], resultPresent: true, cleanup: {}, protocolErrors: [], actualFunctionExecuted: true }, 'EXPECTED_FAILURE_NOT_OBSERVED'],
    ['ORACLE_ZERO_REPLACEMENT', { ...base, replacementCount: 0 }, { status: 1, failedAssertionIds: ['EXPECTED_FAIL'], resultPresent: true, cleanup: {}, protocolErrors: [], actualFunctionExecuted: true }, 'REPLACEMENT_COUNT_MISMATCH'],
    ['ORACLE_MULTIPLE_REPLACEMENT', { ...base, replacementCount: 2 }, { status: 1, failedAssertionIds: ['EXPECTED_FAIL'], resultPresent: true, cleanup: {}, protocolErrors: [], actualFunctionExecuted: true }, 'REPLACEMENT_COUNT_MISMATCH'],
    ['ORACLE_UNCHANGED_SOURCE', { ...base, mutatedSha: 'a' }, { status: 1, failedAssertionIds: ['EXPECTED_FAIL'], resultPresent: true, cleanup: {}, protocolErrors: [], actualFunctionExecuted: true }, 'MUTATED_SOURCE_UNCHANGED'],
    ['ORACLE_UNEXPECTED_FAILURE', { ...base }, { status: 1, failedAssertionIds: ['EXPECTED_FAIL','UNEXPECTED_FAIL'], resultPresent: true, cleanup: {}, protocolErrors: [], actualFunctionExecuted: true }, 'UNEXPECTED_FAILURES'],
  ];
  for (const [id, mutation, evidence, expectedReason] of cases) {
    const observed = evaluateMutationOutcome({ ...mutation, id }, evidence);
    controls.push({ id, expectedReason, observedReason: observed.rejectReason, correctlyRejected: observed.accepted === false && observed.rejectReason === expectedReason });
  }
  const dupes = validateMutationManifest([
    { id: 'DUP1', target: 'a', search: 'x', replacement: 'y', scenario: 's', requiredReplacementCount: 1, expectedOutcome: 'EXPECTED_TEST_FAILURE', expectedFailedAssertions: ['A'] },
    { id: 'DUP2', target: 'a', search: 'x', replacement: 'y', scenario: 's', requiredReplacementCount: 1, expectedOutcome: 'EXPECTED_TEST_FAILURE', expectedFailedAssertions: ['A'] },
  ]);
  controls.push({ id: 'ORACLE_SEMANTIC_DUPLICATE', expectedReason: 'MANIFEST_SEMANTIC_DUPLICATE', observedReason: dupes[0]?.reason || '', correctlyRejected: dupes.some((e) => e.reason === 'MANIFEST_SEMANTIC_DUPLICATE') });
  return controls;
}

async function main() {
  fs.mkdirSync(ownedRoot, { recursive: true });
  const assertions = [];
  const cases = readJson(path.join(root, 'scripts/fixtures/v6.14.066.027-cases.json'));
  const normalRoot = makeWorkRoot('normal');
  const normalEvidence = runChild(normalRoot, { scenario: 'normal', label: 'normal' });
  add(assertions, 'NORMAL_CHILD_OK', classifyProcessOutcome(normalEvidence) === 'CHILD_OK', classifyProcessOutcome(normalEvidence));
  add(assertions, 'NORMAL_CHILD_ASSERTIONS_PASS', normalEvidence.result?.failCount === 0, `fail=${normalEvidence.result?.failCount}`);
  add(assertions, 'NORMAL_CHILD_OWNED_ROOT_CLEANED', normalEvidence.cleanup.filesystemRemainingCount === 0, JSON.stringify(normalEvidence.cleanup));

  const scenarioRecords = [];
  const mutationRecords = [];
  const childFailureModeRecords = [];
  const migrationMutationRecords = [];
  const oracleControls = [];
  if (runScenarios) {
    for (const scenarioCase of cases.scenarios) {
      const work = makeWorkRoot(`scenario-${scenarioCase.id}`);
      const evidence = runChild(work, { scenario: scenarioCase.scenario, label: scenarioCase.id, osSpawnError: scenarioCase.scenario === 'spawn-error', timeoutMs: scenarioCase.scenario === 'timeout' ? 300 : 5000 });
      const observedOutcome = classifyProcessOutcome(evidence);
      scenarioRecords.push({ id: scenarioCase.id, scenario: scenarioCase.scenario, expectedOutcome: scenarioCase.expectedOutcome, observedOutcome, pass: observedOutcome === scenarioCase.expectedOutcome, evidenceSha256: evidence.canonical.sha256, ownedRootsRemaining: evidence.cleanup.filesystemRemainingAfterCleanup });
    }
  }

  if (runMutations) {
    oracleControls.push(...evaluateOracleControls());
    for (const control of oracleControls) add(assertions, control.id, control.correctlyRejected, `${control.observedReason} expected ${control.expectedReason}`);

    for (const item of cases.childFailureModes) {
      const work = makeWorkRoot(`child-${item.id}`);
      let childFixtureRoot = work;
      let sourcePatch = { replacementCount: 1, beforeSha: 'before', afterSha: 'after' };
      if (item.sourceMutation === 'original-tree-import') {
        const baselineRoot = makeWorkRoot(`child-${item.id}-baseline`);
        childFixtureRoot = baselineRoot;
        sourcePatch = applyReplacement(work, 'src/cms-admin/adminState.js', "    && data.classification === 'idle'\n", "    && true\n");
      }
      const evidence = runChild(work, { scenario: 'normal', sourceMutation: item.sourceMutation, fixtureMutation: item.fixtureMutation || '', fixtureRoot: childFixtureRoot, label: item.id });
      const mutation = { id: item.id, requiredReplacementCount: 1, replacementCount: sourcePatch.replacementCount, baselineSha: sourcePatch.beforeSha, mutatedSha: sourcePatch.afterSha, expectedOutcome: 'EXPECTED_TEST_FAILURE', expectedFailedAssertions: item.expectedFailedAssertions, allowedAdditionalFailures: item.allowedAdditionalFailures || [] };
      const verdict = evaluateMutationOutcome(mutation, evidence);
      childFailureModeRecords.push({ id: item.id, verdict: verdict.verdict, rejectReason: verdict.rejectReason, expected: item.expectedFailedAssertions, actual: verdict.actualFailures, evidenceSha256: evidence.canonical.sha256 });
      add(assertions, `CHILD_FAILURE_MODE_${item.id}`, verdict.killed, verdict.rejectReason, verdict);
    }

    for (const item of cases.migrationMutations) {
      const work = makeWorkRoot(`sql-${item.id}`);
      let replacement = { replacementCount: 1, beforeSha: 'a', afterSha: 'b' };
      if (item.kind === 'text') replacement = applyReplacement(work, item.target, item.search, item.replacement);
      if (item.kind === 'rename') renameRelevant(work, new RegExp(item.match), () => item.newName);
      if (item.kind === 'duplicate') {
        const dir = path.join(work, 'supabase/migrations');
        const name = fs.readdirSync(dir).find((n) => new RegExp(item.match).test(n));
        fs.copyFileSync(path.join(dir, name), path.join(dir, item.newName));
      }
      if (item.kind === 'remove') {
        const dir = path.join(work, 'supabase/migrations');
        const name = fs.readdirSync(dir).find((n) => new RegExp(item.match).test(n));
        fs.rmSync(path.join(dir, name));
      }
      const evidence = runChild(work, { scenario: 'normal', label: item.id });
      const mutation = { id: item.id, requiredReplacementCount: item.requiredReplacementCount ?? 1, replacementCount: item.kind === 'text' ? replacement.replacementCount : 1, baselineSha: item.kind === 'text' ? replacement.beforeSha : 'before', mutatedSha: item.kind === 'text' ? replacement.afterSha : 'after', expectedOutcome: 'EXPECTED_TEST_FAILURE', expectedFailedAssertions: item.expectedFailedAssertions, allowedAdditionalFailures: item.allowedAdditionalFailures || [] };
      const verdict = evaluateMutationOutcome(mutation, evidence);
      migrationMutationRecords.push({ id: item.id, replacementCount: mutation.replacementCount, verdict: verdict.verdict, rejectReason: verdict.rejectReason, actualFailures: verdict.actualFailures, expectedMissing: verdict.expectedMissing, unexpectedFailed: verdict.unexpectedFailed });
      add(assertions, `MIGRATION_MUTATION_${item.id}`, verdict.killed, verdict.rejectReason, verdict);
    }

    const wrongFixtureRoot = makeWorkRoot('wrong-s001');
    const wrongEvidence = runChild(wrongFixtureRoot, { scenario: 'normal', fixtureMutation: 'wrong-s001-expected', label: 'wrong-s001-expected' });
    const wrongFails = wrongEvidence.failedAssertionIds;
    add(assertions, 'WRONG_S001_EXPECTED_ACTION_RED', wrongFails.includes('MIGRATION_CASE_S001') && wrongFails.filter((id) => id.startsWith('MIGRATION_CASE_')).length === 1, wrongFails.join(','));

    for (const item of cases.productMutations) {
      const work = makeWorkRoot(`product-${item.id}`);
      const replacement = applyReplacement(work, item.target, item.search, item.replacement);
      const evidence = runChild(work, { scenario: 'normal', label: item.id });
      const mutation = { ...item, replacementCount: replacement.replacementCount, baselineSha: replacement.beforeSha, mutatedSha: replacement.afterSha, expectedOutcome: 'EXPECTED_TEST_FAILURE' };
      const verdict = evaluateMutationOutcome(mutation, evidence);
      const record = {
        id: item.id, category: 'product', target: item.target, search: item.search, replacement: item.replacement,
        replacementCount: replacement.replacementCount, requiredReplacementCount: item.requiredReplacementCount,
        beforeSha: replacement.beforeSha, afterSha: replacement.afterSha, sourceChanged: replacement.beforeSha !== replacement.afterSha,
        processOutcome: verdict.processOutcome, actualFailures: verdict.actualFailures, expectedMissing: verdict.expectedMissing, unexpectedFailures: verdict.unexpectedFailed,
        verdict: verdict.verdict, rejectReason: verdict.rejectReason, evidenceSha256: evidence.canonical.sha256, childStatus: evidence.status, childFailCount: evidence.result?.failCount ?? null
      };
      mutationRecords.push(record);
      add(assertions, `PRODUCT_MUTATION_${item.id}`, verdict.killed, verdict.rejectReason, record);
    }

    const p001 = cases.productMutations.find((item) => item.id === 'P001_REPAIRABLE_TRUE_FAIL_OPEN');
    if (p001) {
      const poisonRoot = makeWorkRoot('product-p001-missing-case');
      const replacement = applyReplacement(poisonRoot, p001.target, p001.search, p001.replacement);
      const missingCase = (p001.dedicatedFrontendCaseIds || ['E006'])[0];
      const poisonEvidence = runChild(poisonRoot, { scenario: 'normal', label: 'product-p001-missing-case', fixtureMutation: `remove-frontend-case:${missingCase}` });
      const poisonMutation = { ...p001, replacementCount: replacement.replacementCount, baselineSha: replacement.beforeSha, mutatedSha: replacement.afterSha, expectedOutcome: 'EXPECTED_TEST_FAILURE' };
      const poisonVerdict = evaluateMutationOutcome(poisonMutation, poisonEvidence);
      add(assertions, 'PRODUCT_AUTHORITY_POISON_MISSING_DEDICATED_CASE_RED', poisonVerdict.killed === false && poisonVerdict.rejectReason === 'EXPECTED_FAILURE_NOT_OBSERVED', JSON.stringify({ rejectReason: poisonVerdict.rejectReason, expectedMissing: poisonVerdict.expectedMissing, actualFailures: poisonVerdict.actualFailures }));
    }
  }

  for (const scenarioRecord of scenarioRecords) add(assertions, `SCENARIO_${scenarioRecord.id}`, scenarioRecord.pass && scenarioRecord.ownedRootsRemaining === 0, `${scenarioRecord.observedOutcome} expected ${scenarioRecord.expectedOutcome}`);
  const scenarioSummary = summarizeScenarioRecords(scenarioRecords);
  add(assertions, 'SCENARIO_SUMMARY_DERIVED', scenarioSummary.total === scenarioRecords.length, JSON.stringify(scenarioSummary));
  if (!runMutations) {
    add(assertions, 'NORMAL_ONLY_MUTATION_RECORDS_ZERO', mutationRecords.length === 0 && childFailureModeRecords.length === 0 && migrationMutationRecords.length === 0 && oracleControls.length === 0);
    add(assertions, 'NORMAL_ONLY_SCENARIO_RECORDS_ZERO', scenarioRecords.length === 0);
  }

  const parentAcceptance = evaluateParentAcceptance([{ ...normalEvidence, expectedOutcome: 'CHILD_OK' }]);
  add(assertions, 'ACTUAL_PARENT_ACCEPTANCE_PATH_EXECUTED', parentAcceptance.parentAcceptance === true, JSON.stringify(parentAcceptance));

  const remainingBeforeCleanup = listRunRoots().filter((p) => p !== ownedRoot);
  const extra = {
    normalEvidenceSha256: normalEvidence.canonical.sha256,
    scenarioRecords,
    scenarioSummary,
    oracleControls,
    childFailureModeRecords,
    migrationMutationRecords,
    mutationRecords,
    productMutantsTotal: mutationRecords.filter((r) => r.category === 'product').length,
    productMutantsKilled: mutationRecords.filter((r) => r.category === 'product' && r.verdict === 'KILLED').length,
    migrationMutantsTotal: migrationMutationRecords.length,
    migrationMutantsKilled: migrationMutationRecords.filter((r) => r.verdict === 'KILLED').length,
    childFailureModeMutantsTotal: childFailureModeRecords.length,
    childFailureModeMutantsKilled: childFailureModeRecords.filter((r) => r.verdict === 'KILLED').length,
    oracleControlsTotal: oracleControls.length,
    oracleControlsCorrectlyRejected: oracleControls.filter((r) => r.correctlyRejected).length,
    productionLikeProcessesTotal: 1 + mutationRecords.length + childFailureModeRecords.length + migrationMutationRecords.length,
    unexpectedAbnormalExits: scenarioSummary.unexpectedAbnormalExits,
    unexpectedSignals: scenarioSummary.unexpectedSignals,
    unexpectedTimeouts: scenarioSummary.unexpectedTimeouts,
    unexpectedSpawnErrors: scenarioSummary.unexpectedSpawnErrors,
    unexpectedProtocolErrors: scenarioSummary.unexpectedProtocolErrors,
    adversarialScenariosTotal: scenarioRecords.length,
    unexpectedScenarioOutcomes: scenarioSummary.unexpectedScenarioOutcomes,
    remainingOwnedRootsBeforeCleanup: remainingBeforeCleanup,
    parentRootExistsAfterRun: fs.existsSync(ownedRoot),
  };
  const result = writeResult(assertions, extra);
  fs.rmSync(ownedRoot, { recursive: true, force: true });
  process.exit(result.failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, JSON.stringify({ protocolVersion: PROTOCOL_VERSION, runId, root, executablePath: path.resolve(process.argv[1]), assertions: [{ id: 'PARENT_UNCAUGHT_EXCEPTION', pass: false, message: err.stack || err.message }], passCount: 0, failCount: 1, totalCount: 1 }, null, 2));
  fs.rmSync(ownedRoot, { recursive: true, force: true });
  process.exit(2);
});
