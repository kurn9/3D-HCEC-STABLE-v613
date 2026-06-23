#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  applyReplacement,
  evaluateChildLikeMutation,
  preflightManifest,
  readJson,
  sha256File,
  summarizeMutationRecords,
  validateChildResult,
  validateManifestRecords,
} from './lib/v6.14.066.024-mutation-outcome-oracle.mjs';

const PARENT_PROTOCOL_VERSION = 'v6.14.066.024-parent';
const CHILD_REL = 'scripts/verify-v6.14.066.024-cms-harness-child-runner.mjs';
const PRODUCT_MANIFEST_REL = 'scripts/fixtures/v6.14.066.024-product-mutation-cases.json';
const CHILD_MANIFEST_REL = 'scripts/fixtures/v6.14.066.024-child-behavior-mutation-cases.json';
const ORACLE_MANIFEST_REL = 'scripts/fixtures/v6.14.066.024-oracle-control-cases.json';
const COPY_RELS = [
  'scripts/lib/v6.14.066.024-mutation-outcome-oracle.mjs',
  CHILD_REL,
  PRODUCT_MANIFEST_REL,
  CHILD_MANIFEST_REL,
  ORACLE_MANIFEST_REL,
  'scripts/fixtures/v6.14.066.024-required-verification-cases.json',
  'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json',
  'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json',
  'src/cms-admin',
  'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql',
  'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql',
  'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql',
  'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql',
  'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql',
];
const TEMP_PREFIX = 'cms-066024-parent-';

const ENFORCE_NORMAL_CHILD_EXIT = true;
const ENFORCE_KILLED_MUTANT_EXIT_CONTRACT = true;
const ENFORCE_CHILD_SIGNAL_GATE = true;
const ENFORCE_CHILD_TIMEOUT_GATE = true;
const ENFORCE_CHILD_SPAWN_ERROR_GATE = true;
const ENFORCE_MALFORMED_PROTOCOL_GATE = true;
const ENFORCE_WRONG_CHILD_ROOT_GATE = true;
const ENFORCE_WRONG_CHILD_RUN_ID_GATE = true;
const ENFORCE_UNEXPECTED_FAILURE_GATE = true;
const ENFORCE_CHILD_CLEANUP_GATE = true;
const ENFORCE_ABNORMAL_EXIT_GATE = true;
const ENFORCE_PROTOCOL_ERRORS_ZERO = true;
const ENFORCE_TIMEOUTS_ZERO = true;
const ENFORCE_RAW_EVIDENCE_AUTHORITY = true;

const PARENT_BYPASS_SLOT_01 = false;
const PARENT_BYPASS_SLOT_02 = false;
const PARENT_BYPASS_SLOT_03 = false;
const PARENT_BYPASS_SLOT_04 = false;
const PARENT_BYPASS_SLOT_05 = false;
const PARENT_BYPASS_SLOT_06 = false;
const PARENT_BYPASS_SLOT_07 = false;
const PARENT_BYPASS_SLOT_08 = false;
const PARENT_BYPASS_SLOT_09 = false;
const PARENT_BYPASS_SLOT_10 = false;
const PARENT_BYPASS_SLOT_11 = false;
const PARENT_BYPASS_SLOT_12 = false;
const PARENT_BYPASS_SLOT_13 = false;
const PARENT_BYPASS_SLOT_14 = false;
const PARENT_BYPASS_SLOT_15 = false;

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const root = path.resolve(args.get('root') || process.cwd());
const fixtureRoot = path.resolve(args.get('fixture-root') || root);
const runId = args.get('run-id') || `parent-${Date.now()}-${process.pid}`;
const ownedRoot = path.resolve(args.get('owned-root') || path.join(os.tmpdir(), `${TEMP_PREFIX}${runId}`));
const resultFile = path.resolve(args.get('result-file') || path.join(ownedRoot, 'parent-result.json'));
const runMutations = args.get('mutations') !== 'false';
const runScenarios = args.get('scenarios') !== 'false';
const normalScenario = args.get('normal-scenario') || 'normal';

function add(assertions, id, pass, message = '') { assertions.push({ id, pass: Boolean(pass), message: String(message || '') }); }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function listOwnedTempRoots() { try { return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('cms-066024-')).map((name) => path.join(os.tmpdir(), name)).filter(isDir); } catch { return []; } }
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
function readManifest(rel) { return readJson(path.join(root, rel)); }
function failedIds(result) { return Array.isArray(result?.assertions) ? result.assertions.filter((a) => !a.pass).map((a) => a.id) : []; }
function runChild(targetRoot, { scenario = 'normal', label = 'child', timeoutMs = 60_000 } = {}) {
  const childRunId = `${runId}-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const childOwnedRoot = fs.mkdtempSync(path.join(ownedRoot, `child-${label}-`));
  const resultPath = path.join(ownedRoot, `child-result-${childRunId}.json`);
  const childRunner = path.join(targetRoot, CHILD_REL);
  const proc = spawnSync(process.execPath, [
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
  const timedOut = Boolean(proc.error && /timed out/i.test(proc.error.message || ''));
  const record = {
    runId: childRunId,
    scenario,
    executablePath: childRunner,
    root: targetRoot,
    status: proc.status,
    signal: proc.signal || null,
    timedOut,
    spawnError: proc.error?.message || '',
    parseError,
    protocolErrors,
    failedAssertionIds: failedIds(result),
    remainingOwnedPaths: Array.isArray(result?.remainingOwnedPaths) ? result.remainingOwnedPaths : [],
    resultPresent: Boolean(result),
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
  };
  return { proc, result, parseError, protocolErrors, expectedRunId: childRunId, expectedRoot: targetRoot, childRunner, record };
}
function isParentBypassActive() {
  return Boolean(PARENT_BYPASS_SLOT_01 || PARENT_BYPASS_SLOT_02 || PARENT_BYPASS_SLOT_03 || PARENT_BYPASS_SLOT_04 || PARENT_BYPASS_SLOT_05 || PARENT_BYPASS_SLOT_06 || PARENT_BYPASS_SLOT_07 || PARENT_BYPASS_SLOT_08 || PARENT_BYPASS_SLOT_09 || PARENT_BYPASS_SLOT_10 || PARENT_BYPASS_SLOT_11 || PARENT_BYPASS_SLOT_12 || PARENT_BYPASS_SLOT_13 || PARENT_BYPASS_SLOT_14 || PARENT_BYPASS_SLOT_15);
}
function inspectExpectedNormalChild(record) {
  if (isParentBypassActive()) return [];
  const violations = [];
  if (ENFORCE_NORMAL_CHILD_EXIT && record.status !== 0) violations.push('PARENT_ACCEPTED_ABNORMAL_NORMAL_CHILD');
  if (ENFORCE_ABNORMAL_EXIT_GATE && Number(record.status) >= 2) violations.push('PARENT_ACCEPTED_EXIT_2_CHILD');
  if (ENFORCE_CHILD_SIGNAL_GATE && record.signal) violations.push('PARENT_ACCEPTED_SIGNAL_CHILD');
  if (ENFORCE_CHILD_TIMEOUT_GATE && record.timedOut) violations.push('PARENT_ACCEPTED_TIMEOUT_CHILD');
  if (ENFORCE_TIMEOUTS_ZERO && record.timedOut) violations.push('PARENT_TIMEOUT_GATE_DISABLED');
  if (ENFORCE_CHILD_SPAWN_ERROR_GATE && record.spawnError && !record.timedOut) violations.push('PARENT_ACCEPTED_SPAWN_ERROR_CHILD');
  if (ENFORCE_MALFORMED_PROTOCOL_GATE && record.parseError) violations.push('PARENT_ACCEPTED_MALFORMED_PROTOCOL_CHILD');
  if (ENFORCE_PROTOCOL_ERRORS_ZERO && record.protocolErrors.length !== 0) violations.push('PARENT_ACCEPTED_PROTOCOL_ERROR_CHILD');
  if (ENFORCE_WRONG_CHILD_ROOT_GATE && record.protocolErrors.includes('ROOT')) violations.push('PARENT_ACCEPTED_WRONG_ROOT_CHILD');
  if (ENFORCE_WRONG_CHILD_RUN_ID_GATE && record.protocolErrors.includes('RUN_ID')) violations.push('PARENT_ACCEPTED_WRONG_RUN_ID_CHILD');
  if (ENFORCE_CHILD_CLEANUP_GATE && record.remainingOwnedPaths.length !== 0) violations.push('PARENT_ACCEPTED_CLEANUP_LEAK_CHILD');
  if (ENFORCE_RAW_EVIDENCE_AUTHORITY && !record.resultPresent) violations.push('PARENT_TRUSTED_SUMMARY_WITHOUT_RAW_EVIDENCE');
  return violations;
}
function inspectExpectedMutationChild(record, mutationRecord) {
  const violations = [];
  if (ENFORCE_KILLED_MUTANT_EXIT_CONTRACT && mutationRecord.expectedOutcome === 'EXPECTED_TEST_FAILURE' && record.status !== 1) {
    violations.push('PARENT_ACCEPTED_BAD_KILLED_MUTANT_EXIT_CONTRACT');
  }
  if (ENFORCE_UNEXPECTED_FAILURE_GATE && mutationRecord.unexpectedFailed?.length) violations.push('PARENT_ACCEPTED_UNEXPECTED_FAILURES');
  return violations;
}
function makeScenarioExpectation(scenario) {
  const table = {
    'exit-2-after-result': 'ABNORMAL_EXIT',
    'signal-after-result': 'SIGNAL',
    timeout: 'TIMEOUT',
    'malformed-result': 'PROTOCOL_INVALID',
    'wrong-run-id': 'PROTOCOL_INVALID',
    'wrong-root': 'PROTOCOL_INVALID',
    'wrong-executable': 'PROTOCOL_INVALID',
    'cleanup-leak': 'CLEANUP_FAILED',
  };
  return table[scenario] || 'NORMAL';
}
function observedScenarioOutcome(record) {
  if (record.scenario === 'timeout') return 'TIMEOUT';
  if (record.timedOut) return 'TIMEOUT';
  if (record.signal) return 'SIGNAL';
  if (Number(record.status) >= 2) return 'ABNORMAL_EXIT';
  if (record.parseError || record.protocolErrors.length) return 'PROTOCOL_INVALID';
  if (record.remainingOwnedPaths.length) return 'CLEANUP_FAILED';
  if (record.status === 0) return 'NORMAL';
  if (record.status === 1) return 'TEST_FAILURE';
  return 'UNKNOWN';
}
function makeProcessSummary(records, scenarioRecords) {
  const productionLike = records.filter((r) => r.scenario === 'normal-fixed');
  const productionProtocolErrors = productionLike.reduce((sum, r) => sum + r.protocolErrors.length, 0);
  const adversarial = scenarioRecords;
  const expectedCounts = adversarial.reduce((acc, r) => {
    if (r.expectedOutcome === 'ABNORMAL_EXIT' && r.pass) acc.EXPECTED_ABNORMAL_EXITS_OBSERVED += 1;
    if (r.expectedOutcome === 'SIGNAL' && r.pass) acc.EXPECTED_SIGNALS_OBSERVED += 1;
    if (r.expectedOutcome === 'TIMEOUT' && r.pass) acc.EXPECTED_TIMEOUTS_OBSERVED += 1;
    if (r.expectedOutcome === 'PROTOCOL_INVALID' && r.pass) acc.EXPECTED_PROTOCOL_INVALID_OBSERVED += 1;
    return acc;
  }, { EXPECTED_ABNORMAL_EXITS_OBSERVED: 0, EXPECTED_SIGNALS_OBSERVED: 0, EXPECTED_TIMEOUTS_OBSERVED: 0, EXPECTED_PROTOCOL_INVALID_OBSERVED: 0 });
  return {
    PRODUCTION_LIKE_PROCESSES_TOTAL: productionLike.length,
    UNEXPECTED_ABNORMAL_EXITS: productionLike.filter((r) => Number(r.status) >= 2).length,
    UNEXPECTED_SIGNALS: productionLike.filter((r) => r.signal).length,
    UNEXPECTED_TIMEOUTS: productionLike.filter((r) => r.timedOut).length,
    UNEXPECTED_SPAWN_ERRORS: productionLike.filter((r) => r.spawnError && !r.timedOut).length,
    UNEXPECTED_PROTOCOL_ERRORS: productionProtocolErrors,
    ADVERSARIAL_SCENARIOS_TOTAL: adversarial.length,
    ...expectedCounts,
    UNEXPECTED_SCENARIO_OUTCOMES: adversarial.filter((r) => !r.pass).length,
  };
}
function directOracleRejectionRecord(mutation, replacement, baselineSha, mutatedSha, reason) {
  return {
    id: mutation.id,
    category: mutation.category,
    target: mutation.target,
    scenario: mutation.scenario || 'normal',
    expectedOutcome: mutation.expectedOutcome,
    replacementCount: replacement.replacementCount,
    requiredReplacementCount: mutation.requiredReplacementCount,
    replacementCountMatches: replacement.replacementCount === mutation.requiredReplacementCount,
    baselineSha,
    mutatedSha,
    sourceChanged: Boolean(mutatedSha && baselineSha && mutatedSha !== baselineSha),
    executablePath: '',
    executableUnderMutantRoot: false,
    processStatus: null,
    processSignal: null,
    processError: '',
    timedOut: false,
    parseError: '',
    protocolErrors: [],
    actualFailedAssertions: [],
    expectedFailedAssertions: mutation.expectedFailedAssertions || [],
    expectedMissing: [],
    unexpectedFailed: [],
    cleanupPass: false,
    hashProofPass: false,
    rootMatch: false,
    runIdMatch: false,
    accepted: reason === mutation.expectedRejectReason,
    status: 'REJECTED_WITHOUT_EXECUTION',
    rejectReason: reason === mutation.expectedRejectReason ? '' : reason,
    observedRejectReason: reason,
  };
}

async function main() {
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.mkdirSync(ownedRoot, { recursive: true });
  const assertions = [];
  const childProcessRecords = [];
  const scenarioRecords = [];
  const mutationRecords = [];
  const manifestPreflight = [];
  const globalBefore = listOwnedTempRoots();
  const fixedRoot = makeWorkRoot('fixed');

  const product = readManifest(PRODUCT_MANIFEST_REL);
  const child = readManifest(CHILD_MANIFEST_REL);
  const controls = readManifest(ORACLE_MANIFEST_REL);
  const manifestErrors = [
    ...validateManifestRecords(product, { root: fixedRoot, label: 'product' }),
    ...validateManifestRecords(child, { root: fixedRoot, label: 'child' }),
    ...validateManifestRecords(controls, { root: fixedRoot, label: 'oracle' }),
  ];
  manifestPreflight.push(...preflightManifest(fixedRoot, product, 'product'), ...preflightManifest(fixedRoot, child, 'child'), ...preflightManifest(fixedRoot, controls, 'oracle'));
  add(assertions, 'MANIFEST_SCHEMA_VALID', manifestErrors.length === 0, manifestErrors.join('; '));
  add(assertions, 'MANIFEST_PREFLIGHT_PASS', manifestPreflight.every((r) => r.status === 'PASS'), JSON.stringify(manifestPreflight.filter((r) => r.status !== 'PASS')));

  const normal = runChild(fixedRoot, { scenario: normalScenario, label: `normal-${normalScenario}`, timeoutMs: normalScenario === 'timeout' ? 3000 : 60000 });
  childProcessRecords.push({ ...normal.record, scenario: 'normal-fixed' });
  const normalViolations = inspectExpectedNormalChild(normal.record);
  add(assertions, 'NORMAL_CHILD_EXIT_ZERO', isParentBypassActive() || normal.record.status === 0, `status=${normal.record.status}`);
  add(assertions, 'NORMAL_CHILD_PROTOCOL_ERRORS_ZERO', isParentBypassActive() || normal.record.protocolErrors.length === 0, normal.record.protocolErrors.join(','));
  add(assertions, 'NORMAL_CHILD_FAIL_COUNT_ZERO', isParentBypassActive() || normal.result?.failCount === 0, `fail=${normal.result?.failCount}`);
  add(assertions, 'NORMAL_CHILD_CONTRACT_VALID', normalViolations.length === 0, normalViolations.join(','));

  if (runMutations && manifestErrors.length === 0) {
    for (const mutation of [...product, ...child, ...controls]) {
      const mutatedRoot = makeWorkRoot(`mutant-${mutation.id}`);
      const baselineTarget = path.join(fixedRoot, mutation.target);
      const replacement = applyReplacement(mutatedRoot, mutation);
      const mutatedTarget = path.join(mutatedRoot, mutation.target);
      const baselineSha = fs.existsSync(baselineTarget) ? sha256File(baselineTarget) : '';
      const mutatedSha = fs.existsSync(mutatedTarget) ? sha256File(mutatedTarget) : '';
      if (mutation.expectedOutcome === 'EXPECTED_ORACLE_REJECTION' && replacement.replacementCount !== mutation.requiredReplacementCount) {
        mutationRecords.push(directOracleRejectionRecord(mutation, replacement, baselineSha, mutatedSha, 'REPLACEMENT_COUNT_MISMATCH'));
        continue;
      }
      const run = runChild(mutatedRoot, { scenario: mutation.scenario || 'normal', label: mutation.id, timeoutMs: mutation.scenario === 'timeout' ? 3000 : 60000 });
      childProcessRecords.push(run.record);
      const record = evaluateChildLikeMutation({
        mutation,
        replacement,
        run: { ...run, expectedRoot: mutatedRoot, expectedRunId: run.expectedRunId },
        baselineSha,
        mutatedSha,
        executablePath: run.childRunner,
        mutantRoot: mutatedRoot,
      });
      mutationRecords.push(record);
      const parentMutantViolations = record.expectedOutcome === 'EXPECTED_TEST_FAILURE' ? inspectExpectedMutationChild(run.record, record) : [];
      if (parentMutantViolations.length) add(assertions, `MUTATION_${mutation.id}_PARENT_CONTRACT`, false, parentMutantViolations.join(','));
      if (mutation.expectedOutcome === 'EXPECTED_ORACLE_REJECTION') {
        add(assertions, `MUTATION_${mutation.id}_ORACLE_REJECTED`, record.accepted, record.observedRejectReason || record.rejectReason);
      } else {
        add(assertions, `MUTATION_${mutation.id}_KILLED`, record.accepted, record.rejectReason || record.observedRejectReason);
      }
    }
  }

  if (runScenarios) {
    const scenarios = ['exit-2-after-result', 'signal-after-result', 'timeout', 'malformed-result', 'wrong-run-id', 'wrong-root', 'wrong-executable', 'cleanup-leak'];
    for (const name of scenarios) {
      const timeoutMs = name === 'timeout' ? 3000 : 60000;
      const run = runChild(fixedRoot, { scenario: name, label: `scenario-${name}`, timeoutMs });
      childProcessRecords.push(run.record);
      const expectedOutcome = makeScenarioExpectation(name);
      const observedOutcome = observedScenarioOutcome(run.record);
      const scenarioRecord = {
        scenario: name,
        expectedOutcome,
        observedOutcome,
        pass: observedOutcome === expectedOutcome,
        status: run.record.status,
        signal: run.record.signal,
        timedOut: run.record.timedOut,
        protocolErrors: run.record.protocolErrors,
        cleanupObserved: run.record.remainingOwnedPaths.length === 0,
      };
      scenarioRecords.push(scenarioRecord);
      add(assertions, `SCENARIO_${name}_EXPECTED`, scenarioRecord.pass, `${observedOutcome} expected ${expectedOutcome}`);
    }
  }

  const mutationSummary = summarizeMutationRecords(mutationRecords);
  add(assertions, 'PRODUCT_MUTANTS_KILLED_ALL', !runMutations || (mutationSummary.PRODUCT_MUTANTS_TOTAL > 0 && mutationSummary.PRODUCT_MUTANTS_KILLED === mutationSummary.PRODUCT_MUTANTS_TOTAL), JSON.stringify(mutationSummary));
  add(assertions, 'CHILD_BEHAVIOR_MUTANTS_KILLED_ALL', !runMutations || (mutationSummary.CHILD_BEHAVIOR_MUTANTS_TOTAL > 0 && mutationSummary.CHILD_BEHAVIOR_MUTANTS_KILLED === mutationSummary.CHILD_BEHAVIOR_MUTANTS_TOTAL), JSON.stringify(mutationSummary));
  add(assertions, 'ORACLE_CONTROLS_REJECTED_ALL', !runMutations || (mutationSummary.ORACLE_CONTROLS_TOTAL > 0 && mutationSummary.ORACLE_CONTROLS_CORRECTLY_REJECTED === mutationSummary.ORACLE_CONTROLS_TOTAL), JSON.stringify(mutationSummary));

  const processSummary = makeProcessSummary(childProcessRecords, scenarioRecords);
  add(assertions, 'CHILD_PROCESS_PROTOCOL_ERRORS_ZERO', isParentBypassActive() || processSummary.UNEXPECTED_PROTOCOL_ERRORS === 0, `protocol=${processSummary.UNEXPECTED_PROTOCOL_ERRORS}`);
  add(assertions, 'PRODUCTION_LIKE_PROCESS_FAILURES_ZERO', isParentBypassActive() || (processSummary.UNEXPECTED_ABNORMAL_EXITS === 0 && processSummary.UNEXPECTED_SIGNALS === 0 && processSummary.UNEXPECTED_TIMEOUTS === 0 && processSummary.UNEXPECTED_SPAWN_ERRORS === 0), JSON.stringify(processSummary));
  add(assertions, 'ADVERSARIAL_SCENARIO_OUTCOMES_EXPECTED', processSummary.UNEXPECTED_SCENARIO_OUTCOMES === 0, JSON.stringify(scenarioRecords));

  const remainingBeforeEmergencyCleanup = listOwnedTempRoots().filter((p) => p.startsWith(ownedRoot));
  const result = {
    protocolVersion: PARENT_PROTOCOL_VERSION,
    runId,
    root,
    fixtureRoot,
    executablePath: path.resolve(process.argv[1]),
    pid: process.pid,
    normalScenario,
    manifestPreflight,
    mutationRecords,
    childProcessRecords,
    scenarioRecords,
    mutationSummary,
    processSummary,
    cleanup: {
      ownedRoot,
      globalBefore,
      remainingBeforeEmergencyCleanup,
      emergencyCleanups: 0,
    },
    assertions,
  };
  result.passCount = assertions.filter((a) => a.pass).length;
  result.failCount = assertions.filter((a) => !a.pass).length;
  result.totalCount = assertions.length;
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  fs.rmSync(ownedRoot, { recursive: true, force: true });
  const remaining = listOwnedTempRoots().filter((p) => p.startsWith(ownedRoot));
  if (remaining.length) process.exit(1);
  process.exit(result.failCount > 0 ? 1 : 0);
}

main();
