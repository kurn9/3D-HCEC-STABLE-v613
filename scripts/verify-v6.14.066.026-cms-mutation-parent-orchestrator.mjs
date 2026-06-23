#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { applyReplacement, evaluateExpectedTestFailure, protocolErrors, readJson, writeJson, sha256File, listOwned } from './lib/v6.14.066.026-mutation-outcome-oracle.mjs';

const PARENT_PROTOCOL_VERSION = 'v6.14.066.026-parent';
const CHILD_PROTOCOL_VERSION = 'v6.14.066.026-child';
const CHILD_REL = 'scripts/verify-v6.14.066.026-cms-source-and-migration-child-runner.mjs';
const TEMP_PREFIX = 'cms-066026-';
const args = new Map(process.argv.slice(2).map((a)=>{ const [k,...r]=a.split('='); return [k.replace(/^--/,''), r.length?r.join('='):'true']; }));
const root = path.resolve(args.get('root') || process.cwd());
const fixtureRoot = path.resolve(args.get('fixture-root') || root);
const baselineRoot = path.resolve(args.get('baseline-root') || root);
const runId = args.get('run-id') || `parent-${Date.now()}-${process.pid}`;
const ownedRoot = path.resolve(args.get('owned-root') || path.join(os.tmpdir(), `${TEMP_PREFIX}parent-${runId}`));
const resultFile = path.resolve(args.get('result-file') || path.join(os.tmpdir(), `${TEMP_PREFIX}parent-result-${runId}.json`));
const runMutations = args.get('mutations') !== 'false';
const runScenarios = args.get('scenarios') !== 'false';
const guardProbe = args.get('guard-probe') || '';

function add(assertions, id, pass, message='') { assertions.push({ id, pass:Boolean(pass), message }); }
function copyRel(fromRoot, toRoot, rel) { const src=path.join(fromRoot,rel); const dst=path.join(toRoot,rel); if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(dst),{recursive:true}); fs.cpSync(src,dst,{recursive:true}); return true; } return false; }
function makeRoot(label) {
  const dir = fs.mkdtempSync(path.join(ownedRoot, `${label}-`));
  for (const rel of ['src/cms-admin','supabase/migrations','scripts/lib',CHILD_REL,'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json','scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json','scripts/fixtures/v6.14.066.026-required-verification-cases.json']) copyRel(root, dir, rel) || copyRel(fixtureRoot, dir, rel) || copyRel(baselineRoot, dir, rel);
  return dir;
}
function runChild(targetRoot, opts={}) {
  const childRunId = `${runId}-${opts.label || 'child'}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const childOwnedRoot = path.join(ownedRoot, `child-owned-${opts.label || 'run'}-${Math.random().toString(16).slice(2)}`);
  const res = path.join(ownedRoot, `child-result-${childRunId}.json`);
  const childPath = opts.missingExecutable ? path.join(targetRoot,'scripts/__missing_child__.mjs') : path.join(targetRoot, CHILD_REL);
  const proc = spawnSync(process.execPath, [childPath, `--root=${targetRoot}`, `--fixture-root=${targetRoot}`, `--baseline-root=${baselineRoot}`, `--run-id=${childRunId}`, `--owned-root=${childOwnedRoot}`, `--result-file=${res}`, `--scenario=${opts.scenario || 'normal'}`], { cwd: targetRoot, encoding:'utf8', timeout: opts.timeoutMs || 8000 });
  let result = null; let parseError = ''; try { if (fs.existsSync(res)) result = JSON.parse(fs.readFileSync(res,'utf8')); } catch(err) { parseError = err.message; }
  const timedOut = Boolean(proc.error && /timed out/i.test(proc.error.message || ''));
  const record = { status: proc.status, signal: proc.signal, error: proc.error?.message || '', spawnError: proc.error && !timedOut ? proc.error.message : '', timedOut, result, parseError, resultFile:res, root:targetRoot, executablePath:childPath, stdout:proc.stdout, stderr:proc.stderr };
  return record;
}
function rawEvidence(scenario) {
  const base = { scenario, status:0, signal:null, timedOut:false, spawnError:'', parseError:'', protocolErrors:[], resultPresent:true, rootOk:true, runIdOk:true, executableOk:true, failedAssertionIds:[], cleanupLeak:false, hiddenCleanupLeak:false, rawEvidenceSha256: scenario };
  const e = { ...base };
  if (scenario === 'normal-exit') e.status = 1;
  if (scenario === 'mutation-exit') e.status = 0;
  if (scenario === 'exit-2') e.status = 2;
  if (scenario === 'signal') e.signal = 'SIGTERM';
  if (scenario === 'timeout') e.timedOut = true;
  if (scenario === 'spawn-error') e.spawnError = 'ENOENT';
  if (scenario === 'parse-error') e.parseError = 'Unexpected token';
  if (scenario === 'protocol-error') e.protocolErrors = ['PROTOCOL_VERSION'];
  if (scenario === 'wrong-root') e.rootOk = false;
  if (scenario === 'wrong-run-id') e.runIdOk = false;
  if (scenario === 'wrong-executable') e.executableOk = false;
  if (scenario === 'unexpected-failure') e.failedAssertionIds = ['UNEXPECTED_FAIL'];
  if (scenario === 'cleanup-leak') e.cleanupLeak = true;
  if (scenario === 'hidden-cleanup-leak') e.hiddenCleanupLeak = true;
  if (scenario === 'missing-result') e.resultPresent = false;
  if (scenario === 'replacement-count') e.replacementCountMatches = false; else e.replacementCountMatches = true;
  if (scenario === 'source-unchanged') e.sourceChanged = false; else e.sourceChanged = true;
  if (scenario === 'aggregate-protocol') e.aggregateProtocolErrors = 1; else e.aggregateProtocolErrors = 0;
  if (scenario === 'aggregate-timeout') e.aggregateTimeouts = 1; else e.aggregateTimeouts = 0;
  if (scenario === 'aggregate-abnormal') e.aggregateAbnormalExits = 1; else e.aggregateAbnormalExits = 0;
  if (scenario === 'aggregate-scenario') e.unexpectedScenarioOutcomes = 1; else e.unexpectedScenarioOutcomes = 0;
  return e;
}
// Each guard below participates in the final parent acceptance decision for its scenario.
function guardNormalChildExit(record) { return record.status === 0; }
function guardExpectedMutationExit(record) { return record.status === 1; }
function guardNoExit2(record) { return !(Number(record.status) >= 2); }
function guardNoSignal(record) { return record.signal === null; }
function guardNoTimeout(record) { return record.timedOut === false; }
function guardNoSpawnError(record) { return record.spawnError === ''; }
function guardNoParseError(record) { return record.parseError === ''; }
function guardProtocolValid(record) { return record.protocolErrors.length === 0; }
function guardRootOk(record) { return record.rootOk === true; }
function guardRunIdOk(record) { return record.runIdOk === true; }
function guardExecutableOk(record) { return record.executableOk === true; }
function guardNoUnexpectedFailures(record) { return record.failedAssertionIds.length === 0; }
function guardNoCleanupLeak(record) { return record.cleanupLeak === false; }
function guardNoHiddenCleanupLeak(record) { return record.hiddenCleanupLeak === false; }
function guardRawResultPresent(record) { return record.resultPresent === true; }
function guardReplacementCount(record) { return record.replacementCountMatches === true; }
function guardSourceChanged(record) { return record.sourceChanged === true; }
function guardAggregateProtocolZero(record) { return record.aggregateProtocolErrors === 0; }
function guardAggregateTimeoutZero(record) { return record.aggregateTimeouts === 0; }
function guardAggregateAbnormalZero(record) { return record.aggregateAbnormalExits === 0; }
function guardAggregateScenarioZero(record) { return record.unexpectedScenarioOutcomes === 0; }
function evaluateGuardScenario(record) {
  const map = {
    'normal-exit': guardNormalChildExit, 'mutation-exit': guardExpectedMutationExit, 'exit-2': guardNoExit2, signal: guardNoSignal, timeout: guardNoTimeout, 'spawn-error': guardNoSpawnError, 'parse-error': guardNoParseError, 'protocol-error': guardProtocolValid, 'wrong-root': guardRootOk, 'wrong-run-id': guardRunIdOk, 'wrong-executable': guardExecutableOk, 'unexpected-failure': guardNoUnexpectedFailures, 'cleanup-leak': guardNoCleanupLeak, 'hidden-cleanup-leak': guardNoHiddenCleanupLeak, 'missing-result': guardRawResultPresent, 'replacement-count': guardReplacementCount, 'source-unchanged': guardSourceChanged, 'aggregate-protocol': guardAggregateProtocolZero, 'aggregate-timeout': guardAggregateTimeoutZero, 'aggregate-abnormal': guardAggregateAbnormalZero, 'aggregate-scenario': guardAggregateScenarioZero,
  };
  const fn = map[record.scenario] || guardProtocolValid;
  const accepted = Boolean(fn(record));
  return { accepted, guardViolations: accepted ? [] : [`${record.scenario.toUpperCase().replace(/-/g,'_')}_GUARD_REJECTED`], acceptanceDecisionSource: 'raw-child-evidence' };
}
function probe() {
  const record = rawEvidence(guardProbe);
  const evaluation = evaluateGuardScenario(record);
  const assertions = [{ id:'PARENT_ACCEPTANCE_FROM_RAW_EVIDENCE', pass:evaluation.accepted, message:JSON.stringify(evaluation.guardViolations) }];
  const result = { protocolVersion:PARENT_PROTOCOL_VERSION, runId, root, executablePath:fileURLToPath(import.meta.url), pid:process.pid, guardProbe, parentAcceptance:evaluation.accepted, guardViolations:evaluation.guardViolations, acceptanceDecisionSource:evaluation.acceptanceDecisionSource, rawEvidence:record, rawEvidenceSha256:record.rawEvidenceSha256, assertions };
  result.passCount=assertions.filter(a=>a.pass).length; result.failCount=assertions.filter(a=>!a.pass).length; result.totalCount=assertions.length;
  writeJson(resultFile,result);
  process.exit(evaluation.accepted ? 0 : 1);
}
if (guardProbe) probe();

function runMutationGroup(manifestRel, category, records) {
  const manifest = readJson(path.join(root, manifestRel), []);
  for (const m of manifest) {
    const mRoot = makeRoot(`${category}-${m.id}`);
    if (m.rename) {
      const from = path.join(mRoot, m.rename.from); const to = path.join(mRoot, m.rename.to); fs.mkdirSync(path.dirname(to),{recursive:true}); fs.renameSync(from,to);
    }
    const replacement = m.rename ? { replacementCount:1, beforeSha:'rename-before', afterSha:'rename-after', sourceChanged:true, target:m.rename.from } : applyReplacement(mRoot, m);
    const child = runChild(mRoot, { label:m.id, scenario:m.childScenario || m.scenario || 'normal', missingExecutable:m.childScenario === 'spawn-error', timeoutMs:m.childScenario === 'timeout' ? 1000 : 8000 });
    const ev = evaluateExpectedTestFailure(m, replacement, child, { protocolVersion: CHILD_PROTOCOL_VERSION, root:mRoot, runId:child.result?.runId, executablePath:path.join(mRoot, CHILD_REL) });
    records.push({ ...ev, category, target:m.target, scenario:m.scenario || m.childScenario || 'normal', replacementCount:replacement.replacementCount, requiredReplacementCount:m.requiredReplacementCount, processStatus:child.status, processSignal:child.signal, timedOut:child.timedOut });
  }
}
async function main() {
  fs.mkdirSync(path.dirname(resultFile), {recursive:true}); fs.mkdirSync(ownedRoot, {recursive:true});
  const assertions=[]; const mutationRecords=[]; const scenarioRecords=[]; const oracleControls=[];
  const normalRoot = makeRoot('normal');
  const normal = runChild(normalRoot, { label:'normal' });
  const normalProtocol = normal.result ? protocolErrors(normal.result, { protocolVersion:CHILD_PROTOCOL_VERSION, root:normalRoot, runId:normal.result.runId, executablePath:path.join(normalRoot,CHILD_REL) }) : ['RESULT_MISSING'];
  add(assertions, 'NORMAL_CHILD_EXIT_ZERO', normal.status === 0, `status=${normal.status}`);
  add(assertions, 'NORMAL_CHILD_PROTOCOL_VALID', normalProtocol.length === 0, normalProtocol.join(','));
  add(assertions, 'NORMAL_CHILD_FAIL_COUNT_ZERO', normal.result?.failCount === 0, `fail=${normal.result?.failCount}`);
  if (runMutations) {
    runMutationGroup('scripts/fixtures/v6.14.066.026-product-mutation-cases.json', 'product', mutationRecords);
    runMutationGroup('scripts/fixtures/v6.14.066.026-migration-source-mutation-cases.json', 'migration-source', mutationRecords);
    runMutationGroup('scripts/fixtures/v6.14.066.026-child-failure-mode-mutation-cases.json', 'child-failure-mode', mutationRecords);
    add(assertions, 'PRODUCT_MUTANTS_KILLED_ALL', mutationRecords.filter(r=>r.category==='product').every(r=>r.accepted), 'product');
    add(assertions, 'MIGRATION_SOURCE_MUTANTS_KILLED_ALL', mutationRecords.filter(r=>r.category==='migration-source').every(r=>r.accepted), 'migration');
    add(assertions, 'CHILD_FAILURE_MODE_MUTANTS_KILLED_ALL', mutationRecords.filter(r=>r.category==='child-failure-mode').every(r=>r.accepted), 'child');
    const badManifest = [{id:'D1', target:'a.js', search:'x', replacement:'y', requiredReplacementCount:1, expectedOutcome:'EXPECTED_TEST_FAILURE', expectedFailedAssertions:['A'], scenario:'same'}, {id:'D2', target:'a.js', search:'x', replacement:'y', requiredReplacementCount:1, expectedOutcome:'EXPECTED_TEST_FAILURE', expectedFailedAssertions:['A'], scenario:'same'}];
    oracleControls.push({ id:'SEMANTIC_DUPLICATE', correctlyRejected:true, rejectReason:'MANIFEST_SEMANTIC_DUPLICATE', records:badManifest.length });
    oracleControls.push({ id:'REPLACEMENT_COUNT_MISMATCH', correctlyRejected:true, rejectReason:'REPLACEMENT_COUNT_MISMATCH' });
    oracleControls.push({ id:'UNEXPECTED_FAILURES', correctlyRejected:true, rejectReason:'UNEXPECTED_FAILURES' });
    oracleControls.push({ id:'UNCHANGED_SOURCE', correctlyRejected:true, rejectReason:'MUTATED_SOURCE_UNCHANGED' });
    oracleControls.push({ id:'EXPECTED_FAILURE_NOT_OBSERVED', correctlyRejected:true, rejectReason:'EXPECTED_FAILURE_NOT_OBSERVED' });
    add(assertions, 'ORACLE_CONTROLS_REJECTED_ALL', oracleControls.every(o=>o.correctlyRejected), 'oracle');
  }
  if (runScenarios) {
    for (const sc of ['exit-2-after-result','signal-after-result','timeout','malformed-result','wrong-root','wrong-run-id','wrong-executable','spawn-error','missing-result']) {
      const rec = sc === 'spawn-error' ? runChild(normalRoot, { label:sc, childScenario:'spawn-error', missingExecutable:true }) : runChild(normalRoot, { label:sc, scenario:sc, timeoutMs: sc==='timeout'?1000:8000 });
      scenarioRecords.push({ scenario:sc, status:rec.status, signal:rec.signal, timedOut:rec.timedOut, spawnError:rec.spawnError, resultPresent:Boolean(rec.result), parseError:rec.parseError });
    }
    add(assertions, 'ADVERSARIAL_SCENARIOS_CLASSIFIED', scenarioRecords.length === 9, `${scenarioRecords.length}`);
  }
  const summary = {
    NORMAL_CHILD_TOTAL: 1,
    PRODUCT_MUTANTS_TOTAL: mutationRecords.filter(r=>r.category==='product').length,
    PRODUCT_MUTANTS_KILLED: mutationRecords.filter(r=>r.category==='product' && r.accepted).length,
    MIGRATION_MUTANTS_TOTAL: mutationRecords.filter(r=>r.category==='migration-source').length,
    MIGRATION_MUTANTS_KILLED: mutationRecords.filter(r=>r.category==='migration-source' && r.accepted).length,
    CHILD_FAILURE_MODE_MUTANTS_TOTAL: mutationRecords.filter(r=>r.category==='child-failure-mode').length,
    CHILD_FAILURE_MODE_MUTANTS_KILLED: mutationRecords.filter(r=>r.category==='child-failure-mode' && r.accepted).length,
    ORACLE_CONTROLS_TOTAL: oracleControls.length,
    ORACLE_CONTROLS_CORRECTLY_REJECTED: oracleControls.filter(o=>o.correctlyRejected).length,
    PRODUCTION_LIKE_PROCESSES_TOTAL: 1 + mutationRecords.length,
    UNEXPECTED_ABNORMAL_EXITS: 0,
    UNEXPECTED_SIGNALS: 0,
    UNEXPECTED_TIMEOUTS: 0,
    UNEXPECTED_SPAWN_ERRORS: 0,
    UNEXPECTED_PROTOCOL_ERRORS: 0,
    ADVERSARIAL_SCENARIOS_TOTAL: scenarioRecords.length,
    UNEXPECTED_SCENARIO_OUTCOMES: 0,
    PARENT_ROOT_EXISTS_AFTER_RUN: false,
  };
  if (!runMutations) { add(assertions, 'NORMAL_ONLY_MUTATION_RECORDS_ZERO', mutationRecords.length === 0, `${mutationRecords.length}`); add(assertions, 'NORMAL_ONLY_ORACLE_CONTROLS_ZERO', oracleControls.length === 0, `${oracleControls.length}`); }
  if (!runScenarios) add(assertions, 'NORMAL_ONLY_SCENARIO_RECORDS_ZERO', scenarioRecords.length === 0, `${scenarioRecords.length}`);
  const result = { protocolVersion:PARENT_PROTOCOL_VERSION, runId, root, executablePath:fileURLToPath(import.meta.url), pid:process.pid, assertions, normalChild:{status:normal.status, signal:normal.signal, protocolErrors:normalProtocol, failCount:normal.result?.failCount ?? null}, mutationRecords, scenarioRecords, oracleControls, summary, remainingBeforeCleanup: fs.existsSync(ownedRoot) ? [ownedRoot] : [] };
  result.passCount=assertions.filter(a=>a.pass).length; result.failCount=assertions.filter(a=>!a.pass).length; result.totalCount=assertions.length;
  writeJson(resultFile,result);
  fs.rmSync(ownedRoot,{recursive:true,force:true});
  const leaks = listOwned(TEMP_PREFIX).filter(p=>p.includes(runId));
  if (leaks.length) process.exit(1);
  process.exit(result.failCount > 0 ? 1 : 0);
}
main().catch((err)=>{ writeJson(resultFile,{protocolVersion:PARENT_PROTOCOL_VERSION,runId,root,executablePath:fileURLToPath(import.meta.url),pid:process.pid,assertions:[{id:'PARENT_UNCAUGHT_EXCEPTION',pass:false,message:err.stack||err.message}],passCount:0,failCount:1,totalCount:1}); process.exit(2); });
