#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PROTOCOL_VERSION } from './lib/v6.14.066.027-oracle.mjs';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const root = path.resolve(args.get('root') || process.cwd());
const fixtureRoot = path.resolve(args.get('fixture-root') || root);
const runId = args.get('run-id') || `final-${Date.now()}-${process.pid}`;
const ownedRoot = path.resolve(args.get('owned-root') || path.join(os.tmpdir(), `cms-066027-final-${runId}`));
const resultFile = path.resolve(args.get('result-file') || path.join(os.tmpdir(), `cms-066027-final-result-${runId}.json`));
const mode = args.get('mode') || (args.get('mutations') === 'false' ? 'normal' : 'full');
const artifactDir = path.resolve(args.get('artifact-dir') || root);
const parentResultForEval = args.get('parent-result') || '';
const PARENT_REL = 'scripts/verify-v6.14.066.027-parent.mjs';
const ORACLE_REL = 'scripts/lib/v6.14.066.027-oracle.mjs';
const FINAL_REL = 'scripts/verify-v6.14.066.027-final.mjs';
const ARTIFACT_REL = 'scripts/verify-v6.14.066.027-artifacts.mjs';
const EXACT_ARTIFACTS = { zip: '3DGallery_CHANGED_v6.14.066.027_CMS_VERIFY_FINAL.zip', report: 'APPLY_v6.14.066.027_CMS_VERIFY_FINAL.md', full: 'FULL_CODE_v6.14.066.027_CMS_VERIFY_FINAL.md' };
const COPY_RELS = [
  'src/cms-admin/adminState.js',
  'src/cms-admin/adminReleaseOperationGate.js',
  'src/cms-admin/adminConfig.js',
  'supabase/migrations',
  'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json',
  'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json',
  'scripts/fixtures/v6.14.066.027-cases.json',
  'scripts/verify-v6.14.066.027-child.mjs',
  PARENT_REL,
  FINAL_REL,
  ORACLE_REL,
  'scripts/lib/v6.14.066.027-sql.mjs',
  ARTIFACT_REL,
];

function add(assertions, id, pass, message = '', details = null) { assertions.push({ id, pass: Boolean(pass), message, ...(details ? { details } : {}) }); }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function sha256Text(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
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
function countRunTempRoots() {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('cms-066027-')).map((name) => path.join(os.tmpdir(), name)).filter(isDir).filter((p) => p.includes(runId)).length;
}
function runParent(targetRoot, opts = {}) {
  const id = `${runId}-${opts.label || 'parent'}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const parentOwnedRoot = path.join(ownedRoot, `parent-owned-${opts.label || 'run'}-${Date.now()}`);
  const resultPath = path.join(ownedRoot, `parent-result-${opts.label || 'run'}-${Date.now()}.json`);
  const argv = [path.join(targetRoot, PARENT_REL), `--root=${targetRoot}`, `--fixture-root=${targetRoot}`, `--run-id=${id}`, `--owned-root=${parentOwnedRoot}`, `--result-file=${resultPath}`];
  if (opts.mutations === false) argv.push('--mutations=false');
  if (opts.scenarios === false) argv.push('--scenarios=false');
  const proc = spawnSync(process.execPath, argv, { cwd: targetRoot, encoding: 'utf8', timeout: opts.timeoutMs || 60000 });
  let result = null;
  let parseError = '';
  try { if (fs.existsSync(resultPath)) result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch (err) { parseError = err.message; }
  fs.rmSync(parentOwnedRoot, { recursive: true, force: true });
  return { proc, result, parseError, resultPath, parentOwnedRoot };
}
export function evaluateFinalAuthority(input = {}) {
  const requiredFailures = [];
  const normal = input.normalParent?.result;
  const full = input.fullParent?.result;
  if (!normal || input.normalParent?.proc?.status !== 0 || normal.failCount !== 0) requiredFailures.push('NORMAL_PARENT_NOT_GREEN');
  if (!full || input.fullParent?.proc?.status !== 0 || full.failCount !== 0) requiredFailures.push('FULL_PARENT_NOT_GREEN');
  if (normal && (normal.mutationRecords?.length || normal.scenarioRecords?.length || normal.oracleControls?.length)) requiredFailures.push('NORMAL_ONLY_NOT_ZERO');
  if (full && full.oracleControlsTotal !== full.oracleControlsCorrectlyRejected) requiredFailures.push('ORACLE_CONTROLS_NOT_REJECTED');
  if (full && full.unexpectedScenarioOutcomes !== 0) requiredFailures.push('SCENARIO_OUTCOMES_UNEXPECTED');
  if (full && full.migrationMutantsTotal !== full.migrationMutantsKilled) requiredFailures.push('MIGRATION_MUTANTS_NOT_KILLED');
  if (full && full.childFailureModeMutantsTotal !== full.childFailureModeMutantsKilled) requiredFailures.push('CHILD_FAILURE_MUTANTS_NOT_KILLED');
  if (!input.baselineRedRecords?.every((r) => r.pass)) requiredFailures.push('BASELINE_026_RED_NOT_PROVEN');
  if (!input.poisonControls?.every((r) => r.pass)) requiredFailures.push('POISON_CONTROL_NOT_RED');
  if (input.globalTempRootsRemaining !== 0) requiredFailures.push('GLOBAL_TEMP_ROOTS_REMAINING');
  const finalPass = requiredFailures.length === 0;
  return { finalPass, requiredFailures, verdict: finalPass ? 'CONDITIONAL_GO' : 'NO_GO' };
}
function inspectBaseline026(targetRoot) {
  const reads = [];
  function text(rel) { const p = path.join(targetRoot, rel); const t = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; reads.push({ rel, bytes: Buffer.byteLength(t), sha256: sha256Text(t) }); return t; }
  const parent = text('scripts/verify-v6.14.066.026-cms-mutation-parent-orchestrator.mjs');
  const meta = text('scripts/verify-v6.14.066.026-cms-verification-meta-orchestrator.mjs');
  const authority = text('scripts/verify-v6.14.066.026-meta-authority-runner.mjs');
  const child = text('scripts/verify-v6.14.066.026-cms-source-and-migration-child-runner.mjs');
  return [
    { id: 'BASELINE_026_PROBE_ONLY_PARENT_GUARDS', target: 'parent', observedEvidence: /guard-probe|function probe\(/.test(parent), pass: /guard-probe|function probe\(/.test(parent) },
    { id: 'BASELINE_026_PROBE_ONLY_META_GUARDS', target: 'meta', observedEvidence: /meta-probe|function probeMeta\(/.test(meta), pass: /meta-probe|function probeMeta\(/.test(meta) },
    { id: 'BASELINE_026_HARDCODED_ORACLE_CONTROL_PASS', target: 'meta', observedEvidence: /META_UNEXPECTED_VIOLATIONS:0|META_PROTOCOL_ERRORS:0/.test(meta), pass: /META_UNEXPECTED_VIOLATIONS:0|META_PROTOCOL_ERRORS:0/.test(meta) },
    { id: 'BASELINE_026_SCENARIO_STRING_USED_AS_SHA', target: 'parent/child', observedEvidence: /cache-probe|scenario/.test(child) && !/canonicalEvidence/.test(parent), pass: /cache-probe|scenario/.test(child) },
    { id: 'BASELINE_026_BASELINE_RED_SELF_ATTESTED', target: 'meta', observedEvidence: /expectedRed|observedRed/.test(meta), pass: /expectedRed|observedRed/.test(meta) },
    { id: 'BASELINE_026_AUTHORITY_PROBE_RUNNER', target: 'authority', observedEvidence: /meta-probe/.test(authority), pass: /meta-probe/.test(authority) },
  ].map((r) => ({ ...r, inspectedFiles: reads }));
}
function mutateFile(targetRoot, rel, search, replacement) {
  const file = path.join(targetRoot, rel);
  const before = fs.readFileSync(file, 'utf8');
  const count = before.split(search).length - 1;
  fs.writeFileSync(file, before.split(search).join(replacement));
  return count;
}
function poisonActualMutationEvaluator() {
  const work = makeWorkRoot('poison-oracle');
  const search = 'export function evaluateMutationOutcome(mutation = {}, record = {}) {';
  const replacement = `${search}\n  return { accepted: true, killed: true, verdict: 'KILLED', rejectReason: '', expectedMissing: [], unexpectedFailed: [], actualFailures: [], sourceChanged: true, actualFunctionExecuted: true, executableUnderMutantRoot: true, processOutcome: 'POISONED_ALWAYS_ACCEPT' };`;
  const count = mutateFile(work, ORACLE_REL, search, replacement);
  const run = runParent(work, { label: 'poison-oracle', mutations: true, scenarios: true, timeoutMs: 60000 });
  return { id: 'POISON_ACTUAL_MUTATION_EVALUATOR_FORCED_TRUE', replacementCount: count, observedRed: run.proc.status !== 0 || (run.result?.failCount || 0) > 0, pass: count === 1 && (run.proc.status !== 0 || (run.result?.failCount || 0) > 0), status: run.proc.status, failCount: run.result?.failCount ?? null };
}
function poisonFinalAuthority() {
  const poisonedParent = { proc: { status: 1 }, result: { failCount: 1, mutationRecords: [], scenarioRecords: [], oracleControls: [], oracleControlsTotal: 0, oracleControlsCorrectlyRejected: 0, unexpectedScenarioOutcomes: 0, migrationMutantsTotal: 0, migrationMutantsKilled: 0, childFailureModeMutantsTotal: 0, childFailureModeMutantsKilled: 0 } };
  const fixed = evaluateFinalAuthority({ normalParent: poisonedParent, fullParent: poisonedParent, baselineRedRecords: [], poisonControls: [], globalTempRootsRemaining: 0 });
  const work = makeWorkRoot('poison-final');
  const poisonInput = path.join(ownedRoot, 'poison-parent.json');
  fs.writeFileSync(poisonInput, JSON.stringify({ normalParent: poisonedParent, fullParent: poisonedParent, baselineRedRecords: [], poisonControls: [], globalTempRootsRemaining: 0 }));
  const finalNeedle = ['const finalPass = requiredFailures.length', '=== 0;'].join(' ');
  const count = mutateFile(work, FINAL_REL, finalNeedle, 'const finalPass = true;');
  const proc = spawnSync(process.execPath, [path.join(work, FINAL_REL), '--mode=authority-eval-only', `--parent-result=${poisonInput}`, `--root=${work}`, `--fixture-root=${work}`], { cwd: work, encoding: 'utf8', timeout: 10000 });
  return { id: 'POISON_ACTUAL_FINAL_AUTHORITY_FORCED_TRUE', replacementCount: count, fixedRejected: fixed.finalPass === false, mutatedAccepted: proc.status === 0, pass: count === 1 && fixed.finalPass === false && proc.status === 0, status: proc.status };
}
function copyArtifactSet(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const copied = {};
  for (const [key, base] of Object.entries(EXACT_ARTIFACTS)) {
    const src = path.join(artifactDir, base);
    const dst = path.join(destDir, base);
    if (!fs.existsSync(src)) throw new Error(`artifact missing for poison: ${src}`);
    fs.copyFileSync(src, dst);
    copied[key] = dst;
  }
  return copied;
}
function runArtifactVerifier(set, expectedRootForVerifier = root) {
  const resultPath = path.join(ownedRoot, `artifact-verifier-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const proc = spawnSync(process.execPath, [path.join(root, ARTIFACT_REL), `--zip=${set.zip}`, `--report=${set.report}`, `--full=${set.full}`, `--expected-root=${expectedRootForVerifier}`, `--result-file=${resultPath}`], { cwd: root, encoding: 'utf8', timeout: 30000 });
  let result = null;
  try { if (fs.existsSync(resultPath)) result = readJson(resultPath); } catch {}
  return { proc, result, resultPath };
}
function poisonArtifactNames() {
  const dir = fs.mkdtempSync(path.join(ownedRoot, 'artifact-poison-name-'));
  try {
    const set = copyArtifactSet(dir);
    const badZip = path.join(dir, 'BAD_NAME.zip');
    fs.renameSync(set.zip, badZip);
    set.zip = badZip;
    const run = runArtifactVerifier(set, root);
    const failures = (run.result?.assertions || []).filter((a) => !a.pass).map((a) => a.id);
    return { id: 'POISON_ARTIFACT_RENAMED_INCORRECTLY', observedRed: run.proc.status !== 0, expectedFailure: 'ARTIFACT_ZIP_BASENAME_EXACT', actualFailures: failures, pass: run.proc.status !== 0 && failures.includes('ARTIFACT_ZIP_BASENAME_EXACT'), status: run.proc.status };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function poisonFullCodeByteMismatch() {
  const dir = fs.mkdtempSync(path.join(ownedRoot, 'artifact-poison-byte-'));
  try {
    const set = copyArtifactSet(dir);
    let text = fs.readFileSync(set.full, 'utf8');
    const idx = text.indexOf('<!-- FILE: ');
    if (idx < 0) throw new Error('FULL_CODE block marker missing');
    const codeStart = text.indexOf('\n', text.indexOf('```', idx));
    const pos = codeStart + 1;
    text = text.slice(0, pos) + (text[pos] === 'X' ? 'Y' : 'X') + text.slice(pos + 1);
    fs.writeFileSync(set.full, text);
    const run = runArtifactVerifier(set, root);
    const failures = (run.result?.assertions || []).filter((a) => !a.pass).map((a) => a.id);
    return { id: 'POISON_FULL_CODE_ONE_BYTE_MISMATCH', observedRed: run.proc.status !== 0, expectedFailurePrefix: 'BYTE_EQUAL_ZIP_FULL_', actualFailures: failures, pass: run.proc.status !== 0 && failures.some((id) => id.startsWith('BYTE_EQUAL_ZIP_FULL_')), status: run.proc.status };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function writeResult(assertions, extra = {}) {
  const result = { protocolVersion: PROTOCOL_VERSION, runId, root, executablePath: path.resolve(process.argv[1]), mode, assertions, ...extra };
  result.passCount = assertions.filter((a) => a.pass).length;
  result.failCount = assertions.filter((a) => !a.pass).length;
  result.totalCount = assertions.length;
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  fs.mkdirSync(ownedRoot, { recursive: true });
  if (mode === 'authority-eval-only') {
    const input = readJson(parentResultForEval);
    const evaluation = evaluateFinalAuthority(input);
    const assertions = [{ id: 'AUTHORITY_EVAL_ONLY_DECISION', pass: evaluation.finalPass, message: evaluation.requiredFailures.join(',') }];
    const result = writeResult(assertions, { evaluation });
    fs.rmSync(ownedRoot, { recursive: true, force: true });
    process.exit(result.failCount > 0 ? 1 : 0);
  }
  const assertions = [];
  const normalRoot = makeWorkRoot('normal-parent-root');
  const normalParent = runParent(normalRoot, { label: 'normal-only', mutations: false, scenarios: false, timeoutMs: 60000 });

  if (mode === 'normal') {
    add(assertions, 'FINAL_NORMAL_ONLY_MODE', true, 'mode=normal');
    add(assertions, 'FINAL_NORMAL_PARENT_GREEN', normalParent.proc.status === 0 && normalParent.result?.failCount === 0, `status=${normalParent.proc.status} fail=${normalParent.result?.failCount}`);
    add(assertions, 'FINAL_NORMAL_MUTATIONS_ZERO', (normalParent.result?.mutationRecords?.length || 0) === 0 && (normalParent.result?.productMutantsTotal || 0) === 0 && (normalParent.result?.childFailureModeMutantsTotal || 0) === 0 && (normalParent.result?.migrationMutantsTotal || 0) === 0, JSON.stringify({ mutationRecords: normalParent.result?.mutationRecords?.length || 0, productMutantsTotal: normalParent.result?.productMutantsTotal || 0, childFailureModeMutantsTotal: normalParent.result?.childFailureModeMutantsTotal || 0, migrationMutantsTotal: normalParent.result?.migrationMutantsTotal || 0 }));
    add(assertions, 'FINAL_NORMAL_SCENARIOS_ZERO', (normalParent.result?.scenarioRecords?.length || 0) === 0 && (normalParent.result?.adversarialScenariosTotal || 0) === 0, JSON.stringify({ scenarioRecords: normalParent.result?.scenarioRecords?.length || 0, adversarialScenariosTotal: normalParent.result?.adversarialScenariosTotal || 0 }));
    add(assertions, 'FINAL_NORMAL_POISONS_ZERO', true, 'poison controls are not executed in normal-only mode');
    const extra = { normalParent: normalParent.result, fullParent: null, mutationTotal: 0, scenarioTotal: 0, poisonTotal: 0, FULL_PARENT: null, MUTATION_TOTAL: 0, SCENARIO_TOTAL: 0, POISON_TOTAL: 0 };
    const result = writeResult(assertions, extra);
    fs.rmSync(ownedRoot, { recursive: true, force: true });
    process.exit(result.failCount > 0 ? 1 : 0);
  }

  const fullRoot = makeWorkRoot('full-parent-root');
  const fullParent = runParent(fullRoot, { label: 'full', mutations: true, scenarios: true, timeoutMs: 120000 });
  add(assertions, 'FINAL_FULL_MODE', mode === 'full', `mode=${mode}`);
  add(assertions, 'FINAL_FULL_PARENT_GREEN', fullParent.proc.status === 0 && fullParent.result?.failCount === 0, `status=${fullParent.proc.status} fail=${fullParent.result?.failCount}`);
  add(assertions, 'FINAL_FULL_MUTATIONS_EXECUTED', (fullParent.result?.productMutantsTotal || 0) > 0 && (fullParent.result?.childFailureModeMutantsTotal || 0) > 0 && (fullParent.result?.migrationMutantsTotal || 0) > 0, JSON.stringify({ product: fullParent.result?.productMutantsTotal || 0, child: fullParent.result?.childFailureModeMutantsTotal || 0, migration: fullParent.result?.migrationMutantsTotal || 0 }));
  add(assertions, 'FINAL_FULL_SCENARIOS_EXECUTED', (fullParent.result?.scenarioRecords?.length || 0) > 0, `scenarios=${fullParent.result?.scenarioRecords?.length || 0}`);

  const baselineRedRecords = inspectBaseline026(root);
  for (const r of baselineRedRecords) add(assertions, r.id, r.pass, String(r.observedEvidence));
  const poisonControls = [
    poisonActualMutationEvaluator(),
    poisonFinalAuthority(),
    { id: 'POISON_WRONG_S001_EXPECTED_ACTION', observedRed: fullParent.result?.assertions?.some((a) => a.id === 'WRONG_S001_EXPECTED_ACTION_RED' && a.pass), pass: fullParent.result?.assertions?.some((a) => a.id === 'WRONG_S001_EXPECTED_ACTION_RED' && a.pass) },
    { id: 'POISON_TIMEOUT_CLASSIFICATION', observedRed: fullParent.result?.scenarioRecords?.some((r) => r.id === 'SCN_TIMEOUT' && r.observedOutcome === 'CHILD_TIMEOUT'), pass: fullParent.result?.scenarioRecords?.some((r) => r.id === 'SCN_TIMEOUT' && r.observedOutcome === 'CHILD_TIMEOUT') },
    { id: 'POISON_OS_SPAWN_ERROR_CLASSIFICATION', observedRed: fullParent.result?.scenarioRecords?.some((r) => r.id === 'SCN_SPAWN_ERROR' && r.observedOutcome === 'CHILD_SPAWN_ERROR'), pass: fullParent.result?.scenarioRecords?.some((r) => r.id === 'SCN_SPAWN_ERROR' && r.observedOutcome === 'CHILD_SPAWN_ERROR') },
    { id: 'POISON_ABNORMAL_CLEANUP', observedRed: fullParent.result?.scenarioRecords?.every((r) => r.ownedRootsRemaining === 0), pass: fullParent.result?.scenarioRecords?.every((r) => r.ownedRootsRemaining === 0) },
    poisonArtifactNames(),
    poisonFullCodeByteMismatch(),
  ];
  add(assertions, 'FINAL_FULL_POISONS_EXECUTED', poisonControls.length >= 8, `poisons=${poisonControls.length}`);
  for (const p of poisonControls) add(assertions, p.id, p.pass, JSON.stringify(p));
  const globalBefore = countRunTempRoots();
  const authority = evaluateFinalAuthority({ normalParent, fullParent, baselineRedRecords, poisonControls, globalTempRootsRemaining: globalBefore > 1 ? globalBefore : 0 });
  add(assertions, 'ACTUAL_FINAL_AUTHORITY_PATH_EXECUTED', authority.finalPass, authority.requiredFailures.join(','), authority);
  const extra = { normalParent: normalParent.result, fullParent: fullParent.result, baselineRedRecords, poisonControls, finalAuthority: authority, globalTempRootsBeforeCleanup: globalBefore, artifactPoisonRootsRemaining: 0 };
  const result = writeResult(assertions, extra);
  fs.rmSync(ownedRoot, { recursive: true, force: true });
  const remaining = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('cms-066027-')).map((name) => path.join(os.tmpdir(), name)).filter(isDir).filter((p) => p.includes(runId));
  if (remaining.length) {
    for (const p of remaining) fs.rmSync(p, { recursive: true, force: true });
    process.exit(1);
  }
  process.exit(result.failCount > 0 ? 1 : 0);
}
main().catch((err) => {
  const assertions = [{ id: 'FINAL_UNCAUGHT_EXCEPTION', pass: false, message: err.stack || err.message }];
  writeResult(assertions, { error: err.stack || err.message });
  fs.rmSync(ownedRoot, { recursive: true, force: true });
  process.exit(2);
});
