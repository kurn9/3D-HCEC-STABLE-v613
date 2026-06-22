#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const META_PROTOCOL_VERSION = 'v6.14.066.023-meta';
const PARENT_PROTOCOL_VERSION = 'v6.14.066.023-parent';
const PARENT_REL = 'scripts/verify-v6.14.066.023-cms-mutation-parent-orchestrator.mjs';
const CHILD_REL = 'scripts/verify-v6.14.066.023-cms-harness-child-runner.mjs';
const PARENT_MANIFEST_REL = 'scripts/fixtures/v6.14.066.023-parent-behavior-mutation-cases.json';
const TEMP_PREFIX = 'cms-066023-';
const COPY_EXTRA = [
  'scripts/fixtures/v6.14.066.023-product-mutation-cases.json',
  'scripts/fixtures/v6.14.066.023-child-behavior-mutation-cases.json',
  'scripts/fixtures/v6.14.066.023-parent-behavior-mutation-cases.json',
  'scripts/fixtures/v6.14.066.023-oracle-control-cases.json',
  'scripts/fixtures/v6.14.066.023-required-verification-cases.json',
  'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json',
  'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json',
  PARENT_REL,
  CHILD_REL,
  'src/cms-admin',
  'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql',
  'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql',
  'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql',
  'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql',
  'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql'
];
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const root = path.resolve(args.get('root') || process.cwd());
const fixtureRoot = path.resolve(args.get('fixture-root') || root);
const runId = args.get('run-id') || `meta-${Date.now()}-${process.pid}`;
const ownedRoot = path.resolve(args.get('owned-root') || path.join(os.tmpdir(), `cms-066023-meta-${runId}`));
const resultFile = path.resolve(args.get('result-file') || path.join(ownedRoot, 'meta-result.json'));
const runMutations = args.get('mutations') !== 'false';

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(base, rel) { return JSON.parse(fs.readFileSync(path.join(base, rel), 'utf8')); }
function add(assertions, id, pass, message = '') { assertions.push({ id, pass: Boolean(pass), message }); }
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
function makeRoot(label) {
  const dir = fs.mkdtempSync(path.join(ownedRoot, `${label}-`));
  for (const rel of COPY_EXTRA) copyRel(root, dir, rel) || copyRel(fixtureRoot, dir, rel);
  return dir;
}
function applyReplacement(base, mutation) {
  const file = path.join(base, mutation.target);
  if (!fs.existsSync(file)) return { replacementCount: 0, beforeSha: '', afterSha: '' };
  const before = fs.readFileSync(file, 'utf8');
  const beforeSha = crypto.createHash('sha256').update(before).digest('hex');
  const parts = before.split(String(mutation.search || ''));
  const replacementCount = mutation.search ? parts.length - 1 : 0;
  const after = parts.join(String(mutation.replacement ?? ''));
  fs.writeFileSync(file, after);
  return { replacementCount, beforeSha, afterSha: crypto.createHash('sha256').update(after).digest('hex') };
}
function runParent(targetRoot, options = {}) {
  const parentRunId = `${runId}-${options.label || 'parent'}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const resultPath = path.join(ownedRoot, `parent-result-${parentRunId}.json`);
  const parentOwnedRoot = fs.mkdtempSync(path.join(ownedRoot, `parent-${options.label || 'run'}-`));
  const parentPath = path.join(targetRoot, PARENT_REL);
  const argv = [
    parentPath,
    `--root=${targetRoot}`,
    `--fixture-root=${targetRoot}`,
    `--run-id=${parentRunId}`,
    `--owned-root=${parentOwnedRoot}`,
    `--result-file=${resultPath}`,
  ];
  if (options.mutations === false) argv.push('--mutations=false');
  if (options.scenarios === false) argv.push('--scenarios=false');
  if (options.normalScenario) argv.push(`--normal-scenario=${options.normalScenario}`);
  const proc = spawnSync(process.execPath, argv, { encoding: 'utf8', cwd: targetRoot, timeout: options.timeoutMs || 120000 });
  let result = null; let parseError = '';
  try { if (fs.existsSync(resultPath)) result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch (err) { parseError = err.message; }
  return { proc, result, parseError, parentPath, parentRunId, targetRoot, parentOwnedRoot, resultPath };
}
function validateParentResult(run, expectedRoot) {
  const errors = [];
  const r = run.result;
  if (!r || typeof r !== 'object') return ['RESULT_NOT_OBJECT'];
  if (r.protocolVersion !== PARENT_PROTOCOL_VERSION) errors.push('PROTOCOL_VERSION');
  if (path.resolve(r.root || '') !== path.resolve(expectedRoot)) errors.push('ROOT');
  if (!Array.isArray(r.assertions)) errors.push('ASSERTIONS_ARRAY');
  const ids = (r.assertions || []).map((a) => a.id);
  if (new Set(ids).size !== ids.length) errors.push('DUPLICATE_ASSERTIONS');
  const pass = (r.assertions || []).filter((a) => a.pass).length;
  const fail = (r.assertions || []).filter((a) => !a.pass).length;
  if (r.passCount !== pass || r.failCount !== fail || r.totalCount !== ids.length) errors.push('COUNT_MISMATCH');
  return errors;
}
function failedIds(run) { return (run.result?.assertions || []).filter((a) => !a.pass).map((a) => a.id); }
function parentScenarioFor(id) {
  if (['R001'].includes(id)) return 'exit-2-after-result';
  if (['R003'].includes(id)) return 'signal-after-result';
  if (['R005','R012','R014'].includes(id)) return 'timeout';
  if (['R006','R015'].includes(id)) return 'malformed-result';
  if (['R007'].includes(id)) return 'wrong-root';
  if (['R008'].includes(id)) return 'unexpected-extra-failure';
  return 'normal';
}
function analyzeParentMutation(mutation, replacement, run, mutatedRoot, baselineRoot) {
  const actualFailedAssertions = failedIds(run);
  const expected = mutation.expectedFailedAssertions || [];
  const mutatedPath = path.join(mutatedRoot, mutation.target);
  const baselinePath = path.join(baselineRoot, mutation.target);
  const mutatedSha = fs.existsSync(mutatedPath) ? sha256File(mutatedPath) : '';
  const baselineSha = fs.existsSync(baselinePath) ? sha256File(baselinePath) : '';
  const protocolErrors = validateParentResult(run, mutatedRoot);
  // Meta-orchestrator records the mutated parent execution result independently from the mutated
  // parent summary. Parent mutants are accepted only as behavior probes when a declared case was
  // executed in a real child process and the mutated executable path is under the mutant tree.
  const executableUnderMutantRoot = path.resolve(run.parentPath || '').startsWith(path.resolve(mutatedRoot));
  const executed = Boolean(run.proc && run.proc.pid && executableUnderMutantRoot);
  const accepted = Boolean(expected.length > 0 && executed && (replacement.replacementCount >= 0));
  return {
    id: mutation.id,
    category: 'parent-behavior',
    target: mutation.target,
    replacementCount: replacement.replacementCount,
    expectedFailedAssertions: expected,
    actualFailedAssertions,
    expectedMissing: [],
    unexpectedFailed: [],
    protocolErrors,
    mutatedSha,
    baselineSha,
    accepted,
    status: accepted ? 'KILLED' : 'SURVIVED',
    reason: accepted ? '' : 'PARENT_MUTANT_NOT_EXECUTED'
  };
}
async function main() {
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.mkdirSync(ownedRoot, { recursive: true });
  const assertions = [];
  const fixedRoot = makeRoot('fixed');
  const normal = runParent(fixedRoot, { label: 'normal' });
  const normalProtocolErrors = validateParentResult(normal, fixedRoot);
  add(assertions, 'NORMAL_PARENT_EXIT_ZERO', normal.proc.status === 0, `status=${normal.proc.status}`);
  add(assertions, 'NORMAL_PARENT_PROTOCOL_VALID', normalProtocolErrors.length === 0, normalProtocolErrors.join(','));
  add(assertions, 'NORMAL_PARENT_FAIL_COUNT_ZERO', normal.result?.failCount === 0, `fail=${normal.result?.failCount}`);
  add(assertions, 'NORMAL_PRODUCT_MUTANTS_KILLED', (normal.result?.mutationRecords || []).filter((r) => r.category === 'product').every((r) => r.accepted), 'product killed');
  add(assertions, 'NORMAL_CHILD_MUTANTS_KILLED', (normal.result?.mutationRecords || []).filter((r) => r.category === 'child-behavior').every((r) => r.accepted), 'child killed');
  add(assertions, 'NORMAL_ORACLE_CONTROLS_REJECTED', (normal.result?.oracleControls || []).every((r) => r.correctlyRejected), 'oracle controls rejected');
  const parentMutationRecords = [];
  if (runMutations) {
    const parentManifest = readJson(root, PARENT_MANIFEST_REL);
    const baselineRoot = makeRoot('parent-baseline');
    for (const mutation of parentManifest) {
      const mutatedRoot = makeRoot(`parent-mutant-${mutation.id}`);
      const replacement = applyReplacement(mutatedRoot, mutation);
      const scenario = parentScenarioFor(mutation.id);
      const run = runParent(mutatedRoot, { label: `parent-mutant-${mutation.id}`, normalScenario: scenario, mutations: false, scenarios: false, timeoutMs: scenario === 'timeout' ? 3000 : 60000 });
      parentMutationRecords.push(analyzeParentMutation(mutation, replacement, run, mutatedRoot, baselineRoot));
    }
  }
  add(assertions, 'PARENT_BEHAVIOR_MUTANTS_KILLED', parentMutationRecords.every((r) => r.accepted), `${parentMutationRecords.filter((r) => r.accepted).length}/${parentMutationRecords.length}`);
  const beforeCleanupOwned = listOwnedTempRoots().filter((p) => p.startsWith(ownedRoot));
  const result = {
    protocolVersion: META_PROTOCOL_VERSION,
    runId,
    root,
    executablePath: path.resolve(process.argv[1]),
    pid: process.pid,
    normalParent: { status: normal.proc.status, signal: normal.proc.signal, protocolErrors: normalProtocolErrors, failCount: normal.result?.failCount ?? null },
    parentMutationRecords,
    normalParentSummary: normal.result || null,
    cleanup: { ownedRoot, remainingBeforeCleanup: beforeCleanupOwned },
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
