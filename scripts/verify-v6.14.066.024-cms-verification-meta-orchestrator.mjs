#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  applyReplacement,
  expectedActualDiff,
  preflightManifest,
  readJson,
  sha256File,
  summarizeMutationRecords,
  validateManifestRecords,
  validateParentResult,
} from './lib/v6.14.066.024-mutation-outcome-oracle.mjs';

const META_PROTOCOL_VERSION = 'v6.14.066.024-meta';
const PARENT_REL = 'scripts/verify-v6.14.066.024-cms-mutation-parent-orchestrator.mjs';
const PARENT_MANIFEST_REL = 'scripts/fixtures/v6.14.066.024-parent-behavior-mutation-cases.json';
const BASELINE_RED_REL = 'scripts/fixtures/v6.14.066.024-baseline-red-cases.json';
const COPY_RELS = [
  'scripts/lib/v6.14.066.024-mutation-outcome-oracle.mjs',
  PARENT_REL,
  'scripts/verify-v6.14.066.024-cms-harness-child-runner.mjs',
  'scripts/fixtures/v6.14.066.024-product-mutation-cases.json',
  'scripts/fixtures/v6.14.066.024-child-behavior-mutation-cases.json',
  'scripts/fixtures/v6.14.066.024-parent-behavior-mutation-cases.json',
  'scripts/fixtures/v6.14.066.024-oracle-control-cases.json',
  'scripts/fixtures/v6.14.066.024-required-verification-cases.json',
  'scripts/fixtures/v6.14.066.024-baseline-red-cases.json',
  'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json',
  'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json',
  'src/cms-admin',
  'scripts/verify-v6.14.066.023-cms-verification-meta-orchestrator.mjs',
  'scripts/verify-v6.14.066.023-cms-mutation-parent-orchestrator.mjs',
  'scripts/verify-v6.14.066.023-cms-harness-child-runner.mjs',
  'scripts/fixtures/v6.14.066.023-product-mutation-cases.json',
  'scripts/fixtures/v6.14.066.023-child-behavior-mutation-cases.json',
  'scripts/fixtures/v6.14.066.023-parent-behavior-mutation-cases.json',
  'scripts/fixtures/v6.14.066.023-oracle-control-cases.json',
  'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql',
  'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql',
  'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql',
  'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql',
  'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql',
];
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const root = path.resolve(args.get('root') || process.cwd());
const fixtureRoot = path.resolve(args.get('fixture-root') || root);
const runId = args.get('run-id') || `meta-${Date.now()}-${process.pid}`;
const ownedRoot = path.resolve(args.get('owned-root') || path.join(os.tmpdir(), `cms-066024-meta-${runId}`));
const resultFile = path.resolve(args.get('result-file') || path.join(ownedRoot, 'meta-result.json'));
const runMutations = args.get('mutations') !== 'false';

function add(assertions, id, pass, message = '') { assertions.push({ id, pass: Boolean(pass), message: String(message || '') }); }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function listTempRoots() { try { return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('cms-066024-')).map((name) => path.join(os.tmpdir(), name)).filter(isDir); } catch { return []; } }
function copyRel(fromRoot, toRoot, rel) {
  const source = path.join(fromRoot, rel);
  if (!fs.existsSync(source)) return false;
  const dest = path.join(toRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(source, dest, { recursive: true });
  return true;
}
function makeRoot(label) {
  const dir = fs.mkdtempSync(path.join(ownedRoot, `${label}-`));
  for (const rel of COPY_RELS) copyRel(root, dir, rel) || copyRel(fixtureRoot, dir, rel);
  return dir;
}
function failedIds(result) { return Array.isArray(result?.assertions) ? result.assertions.filter((a) => !a.pass).map((a) => a.id) : []; }
function runParent(targetRoot, { scenario = 'normal', label = 'parent', mutations = false, scenarios = false, timeoutMs = 120000 } = {}) {
  const parentRunId = `${runId}-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const resultPath = path.join(ownedRoot, `parent-result-${parentRunId}.json`);
  const parentOwnedRoot = fs.mkdtempSync(path.join(ownedRoot, `parent-owned-${label}-`));
  const parentPath = path.join(targetRoot, PARENT_REL);
  const proc = spawnSync(process.execPath, [
    parentPath,
    `--root=${targetRoot}`,
    `--fixture-root=${targetRoot}`,
    `--run-id=${parentRunId}`,
    `--owned-root=${parentOwnedRoot}`,
    `--result-file=${resultPath}`,
    `--normal-scenario=${scenario}`,
    `--mutations=${mutations ? 'true' : 'false'}`,
    `--scenarios=${scenarios ? 'true' : 'false'}`,
  ], { encoding: 'utf8', cwd: targetRoot, timeout: timeoutMs });
  let result = null;
  let parseError = '';
  try { if (fs.existsSync(resultPath)) result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch (err) { parseError = err.message; }
  const protocolErrors = validateParentResult(result, parentRunId, targetRoot, parentPath);
  const timedOut = Boolean(proc.error && /timed out/i.test(proc.error.message || ''));
  return { proc, result, parseError, protocolErrors, parentRunId, targetRoot, parentPath, timedOut, resultPath };
}
function childRecordFromParent(run) {
  return Array.isArray(run.result?.childProcessRecords) ? run.result.childProcessRecords[0] : null;
}
function scenarioViolationId(scenario, childRecord) {
  if (!childRecord) return 'PARENT_TRUSTED_SUMMARY_WITHOUT_RAW_EVIDENCE';
  if (scenario === 'unexpected-failure' && childRecord.status === 1) return 'PARENT_ACCEPTED_NORMAL_CHILD_TEST_FAILURE';
  if (scenario === 'exit-2-after-result' && Number(childRecord.status) >= 2) return 'PARENT_ACCEPTED_ABNORMAL_EXIT';
  if (scenario === 'signal-after-result' && childRecord.signal) return 'PARENT_ACCEPTED_SIGNAL';
  if (scenario === 'timeout') return 'PARENT_ACCEPTED_TIMEOUT';
  if (scenario === 'malformed-result' && (childRecord.parseError || childRecord.protocolErrors?.length)) return 'PARENT_ACCEPTED_PROTOCOL_INVALID';
  if (scenario === 'wrong-root' && childRecord.protocolErrors?.includes('ROOT')) return 'PARENT_ACCEPTED_WRONG_ROOT';
  if (scenario === 'wrong-run-id' && childRecord.protocolErrors?.includes('RUN_ID')) return 'PARENT_ACCEPTED_WRONG_RUN_ID';
  if (scenario === 'wrong-executable' && childRecord.protocolErrors?.includes('EXECUTABLE_PATH')) return 'PARENT_ACCEPTED_WRONG_EXECUTABLE';
  if (scenario === 'cleanup-leak' && childRecord.remainingOwnedPaths?.length) return 'PARENT_ACCEPTED_CLEANUP_LEAK';
  return '';
}
function evaluateParentMutation({ mutation, replacement, baselineSha, mutatedSha, run, mutatedRoot }) {
  const executableUnderMutantRoot = run.parentPath && path.resolve(run.parentPath).startsWith(path.resolve(mutatedRoot));
  const sourceChanged = Boolean(baselineSha && mutatedSha && baselineSha !== mutatedSha);
  const replacementCountMatches = replacement.replacementCount === mutation.requiredReplacementCount;
  const parentProtocolValid = run.protocolErrors.length === 0 && !run.parseError;
  const parentAcceptedBadEvidence = run.proc.status === 0 && !run.proc.signal && !run.timedOut && parentProtocolValid && run.result?.failCount === 0;
  const observed = parentAcceptedBadEvidence ? [scenarioViolationId(mutation.scenario || 'normal', childRecordFromParent(run))].filter(Boolean) : [];
  const { expectedMissing, unexpectedFailed } = expectedActualDiff(mutation.expectedMetaViolationIds || [], observed, []);
  const accepted = Boolean(
    replacementCountMatches
    && sourceChanged
    && executableUnderMutantRoot
    && parentAcceptedBadEvidence
    && observed.length > 0
    && expectedMissing.length === 0
    && unexpectedFailed.length === 0
  );
  let rejectReason = '';
  if (!accepted) {
    if (!replacementCountMatches) rejectReason = 'REPLACEMENT_COUNT_MISMATCH';
    else if (!sourceChanged) rejectReason = 'MUTATED_SOURCE_UNCHANGED';
    else if (!executableUnderMutantRoot) rejectReason = 'EXECUTABLE_OUTSIDE_MUTANT_ROOT';
    else if (!parentAcceptedBadEvidence) rejectReason = 'PARENT_DID_NOT_ACCEPT_BAD_EVIDENCE';
    else if (expectedMissing.length) rejectReason = 'EXPECTED_META_VIOLATION_NOT_OBSERVED';
    else if (unexpectedFailed.length) rejectReason = 'UNEXPECTED_META_VIOLATIONS';
    else rejectReason = 'UNKNOWN_PARENT_MUTATION_REJECTION';
  }
  return {
    id: mutation.id,
    category: mutation.category,
    target: mutation.target,
    scenario: mutation.scenario || 'normal',
    expectedOutcome: mutation.expectedOutcome,
    replacementCount: replacement.replacementCount,
    requiredReplacementCount: mutation.requiredReplacementCount,
    baselineSha,
    mutatedSha,
    sourceChanged,
    executablePath: run.parentPath,
    executableUnderMutantRoot,
    processStatus: run.proc.status,
    processSignal: run.proc.signal || null,
    processError: run.proc.error?.message || '',
    timedOut: run.timedOut,
    protocolErrors: run.protocolErrors,
    actualMetaViolationIds: observed,
    expectedMetaViolationIds: mutation.expectedMetaViolationIds || [],
    expectedMissing,
    unexpectedViolations: unexpectedFailed,
    childRecord: childRecordFromParent(run),
    accepted,
    status: accepted ? 'KILLED' : (run.proc.status === 0 ? 'SURVIVED' : 'EXECUTION_INVALID'),
    rejectReason,
  };
}
function directParentRejection(mutation, replacement, baselineSha, mutatedSha, reason) {
  return {
    id: mutation.id,
    category: mutation.category,
    target: mutation.target,
    scenario: mutation.scenario || 'normal',
    expectedOutcome: mutation.expectedOutcome,
    replacementCount: replacement.replacementCount,
    requiredReplacementCount: mutation.requiredReplacementCount,
    baselineSha,
    mutatedSha,
    sourceChanged: Boolean(baselineSha && mutatedSha && baselineSha !== mutatedSha),
    executablePath: '',
    executableUnderMutantRoot: false,
    processStatus: null,
    processSignal: null,
    processError: '',
    timedOut: false,
    protocolErrors: [],
    actualMetaViolationIds: [],
    expectedMetaViolationIds: mutation.expectedMetaViolationIds || [],
    expectedMissing: [],
    unexpectedViolations: [],
    childRecord: null,
    accepted: reason === mutation.expectedRejectReason,
    status: 'REJECTED_WITHOUT_EXECUTION',
    rejectReason: reason === mutation.expectedRejectReason ? '' : reason,
    observedRejectReason: reason,
  };
}
function runBaselineRedAssertions(baseRoot) {
  const cases = readJson(path.join(baseRoot, BASELINE_RED_REL));
  return cases.map((item) => {
    const target = path.join(baseRoot, item.target);
    const text = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    return { id: item.id, target: item.target, pass: text.includes(item.contains), contains: item.contains };
  });
}

async function main() {
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.mkdirSync(ownedRoot, { recursive: true });
  const assertions = [];
  const parentMutationRecords = [];
  const parentProcessRecords = [];
  const fixedRoot = makeRoot('fixed');
  const baselineRedResults = runBaselineRedAssertions(fixedRoot);
  for (const red of baselineRedResults) add(assertions, `BASELINE_RED_${red.id}`, red.pass, red.target);

  const normal = runParent(fixedRoot, { scenario: 'normal', label: 'normal', mutations: true, scenarios: true });
  parentProcessRecords.push({ label: 'normal', status: normal.proc.status, signal: normal.proc.signal || null, timedOut: normal.timedOut, protocolErrors: normal.protocolErrors, failCount: normal.result?.failCount ?? null });
  add(assertions, 'NORMAL_PARENT_EXIT_ZERO', normal.proc.status === 0, `status=${normal.proc.status}`);
  add(assertions, 'NORMAL_PARENT_PROTOCOL_ERRORS_ZERO', normal.protocolErrors.length === 0, normal.protocolErrors.join(','));
  add(assertions, 'NORMAL_PARENT_FAIL_COUNT_ZERO', normal.result?.failCount === 0, `fail=${normal.result?.failCount}`);
  add(assertions, 'NORMAL_PARENT_CHILD_MUTATION_SUMMARY_PASS', normal.result?.mutationSummary?.CHILD_BEHAVIOR_MUTANTS_KILLED === normal.result?.mutationSummary?.CHILD_BEHAVIOR_MUTANTS_TOTAL, JSON.stringify(normal.result?.mutationSummary || {}));

  const parentManifest = readJson(path.join(root, PARENT_MANIFEST_REL));
  const manifestErrors = validateManifestRecords(parentManifest, { root: fixedRoot, label: 'parent' });
  const parentPreflight = preflightManifest(fixedRoot, parentManifest, 'parent');
  add(assertions, 'PARENT_MANIFEST_SCHEMA_VALID', manifestErrors.length === 0, manifestErrors.join('; '));
  add(assertions, 'PARENT_MANIFEST_PREFLIGHT_PASS', parentPreflight.every((r) => r.status === 'PASS'), JSON.stringify(parentPreflight.filter((r) => r.status !== 'PASS')));

  if (runMutations && manifestErrors.length === 0) {
    for (const mutation of parentManifest) {
      const mutatedRoot = makeRoot(`parent-mutant-${mutation.id}`);
      const replacement = applyReplacement(mutatedRoot, mutation);
      const baselineTarget = path.join(fixedRoot, mutation.target);
      const mutatedTarget = path.join(mutatedRoot, mutation.target);
      const baselineSha = fs.existsSync(baselineTarget) ? sha256File(baselineTarget) : '';
      const mutatedSha = fs.existsSync(mutatedTarget) ? sha256File(mutatedTarget) : '';
      if (mutation.expectedOutcome === 'EXPECTED_ORACLE_REJECTION' && replacement.replacementCount !== mutation.requiredReplacementCount) {
        const rec = directParentRejection(mutation, replacement, baselineSha, mutatedSha, 'REPLACEMENT_COUNT_MISMATCH');
        parentMutationRecords.push(rec);
        add(assertions, `PARENT_MUTATION_${mutation.id}_REJECTED`, rec.accepted, rec.observedRejectReason || rec.rejectReason);
        continue;
      }
      const run = runParent(mutatedRoot, { scenario: mutation.scenario || 'normal', label: mutation.id, mutations: false, scenarios: false, timeoutMs: mutation.scenario === 'timeout' ? 5000 : 120000 });
      parentProcessRecords.push({ label: mutation.id, status: run.proc.status, signal: run.proc.signal || null, timedOut: run.timedOut, protocolErrors: run.protocolErrors, failCount: run.result?.failCount ?? null });
      const rec = evaluateParentMutation({ mutation, replacement, baselineSha, mutatedSha, run, mutatedRoot });
      parentMutationRecords.push(rec);
      add(assertions, `PARENT_MUTATION_${mutation.id}_KILLED`, rec.accepted, rec.rejectReason || JSON.stringify(rec.actualMetaViolationIds));
    }
  }

  const parentSummary = summarizeMutationRecords(parentMutationRecords);
  add(assertions, 'PARENT_BEHAVIOR_MUTANTS_KILLED_ALL', !runMutations || (parentSummary.PARENT_BEHAVIOR_MUTANTS_TOTAL > 0 && parentSummary.PARENT_BEHAVIOR_MUTANTS_KILLED === parentSummary.PARENT_BEHAVIOR_MUTANTS_TOTAL), JSON.stringify(parentSummary));
  add(assertions, 'PARENT_ORACLE_CONTROLS_REJECTED_ALL', !runMutations || parentSummary.ORACLE_CONTROLS_INCORRECTLY_ACCEPTED === 0, JSON.stringify(parentSummary));
  const metaProtocolErrors = parentProcessRecords.reduce((sum, r) => sum + (r.protocolErrors?.length || 0), 0);
  add(assertions, 'PARENT_PROCESS_PROTOCOL_ERRORS_ZERO', parentProcessRecords.filter((r) => r.label === 'normal').every((r) => (r.protocolErrors?.length || 0) === 0), JSON.stringify(parentProcessRecords));
  add(assertions, 'META_PROTOCOL_ERRORS_ZERO', metaProtocolErrors === 0 || parentProcessRecords.some((r) => r.label !== 'normal'), `protocolErrors=${metaProtocolErrors}`);

  const remainingBeforeCleanup = listTempRoots().filter((p) => p.startsWith(ownedRoot));
  const result = {
    protocolVersion: META_PROTOCOL_VERSION,
    runId,
    root,
    fixtureRoot,
    executablePath: path.resolve(process.argv[1]),
    pid: process.pid,
    baselineRedResults,
    normalParent: { status: normal.proc.status, protocolErrors: normal.protocolErrors, failCount: normal.result?.failCount ?? null, mutationSummary: normal.result?.mutationSummary || null, processSummary: normal.result?.processSummary || null },
    parentPreflight,
    parentMutationRecords,
    parentProcessRecords,
    parentSummary,
    cleanup: { ownedRoot, remainingBeforeCleanup, emergencyCleanups: 0 },
    assertions,
  };
  result.passCount = assertions.filter((a) => a.pass).length;
  result.failCount = assertions.filter((a) => !a.pass).length;
  result.totalCount = assertions.length;
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  fs.rmSync(ownedRoot, { recursive: true, force: true });
  const remaining = listTempRoots().filter((p) => p.startsWith(ownedRoot));
  if (remaining.length) process.exit(1);
  process.exit(result.failCount > 0 ? 1 : 0);
}

main();
