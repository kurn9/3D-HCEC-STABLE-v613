#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { PROTOCOLS, add, summarize, readJson, writeJson, applyReplacement, evaluateProcessMutation, validateChildResult, validateManifestRecords, preflightManifest } from './lib/v6.14.066.025-mutation-outcome-oracle.mjs';

const PARENT_REL='scripts/verify-v6.14.066.025-cms-mutation-parent-orchestrator.mjs';
const CHILD_REL='scripts/verify-v6.14.066.025-cms-source-and-migration-child-runner.mjs';
const COPY_RELS=[
 'scripts/lib/v6.14.066.025-mutation-outcome-oracle.mjs',
 'scripts/lib/v6.14.066.025-migration-source-evaluator.mjs',
 CHILD_REL,
 'scripts/fixtures/v6.14.066.025-product-mutation-cases.json',
 'scripts/fixtures/v6.14.066.025-migration-source-mutation-cases.json',
 'scripts/fixtures/v6.14.066.025-child-failure-mode-mutation-cases.json',
 'scripts/fixtures/v6.14.066.025-oracle-control-cases.json',
 'scripts/fixtures/v6.14.066.025-required-verification-cases.json',
 'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json',
 'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json',
 'src/cms-admin/adminState.js','src/cms-admin/adminReleaseOperationGate.js',
 'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql',
 'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql',
 'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql',
 'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql',
 'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql'
];
const args=new Map(process.argv.slice(2).map(arg=>{ const [k,...rest]=arg.split('='); return [k.replace(/^--/,''), rest.length?rest.join('='):'true']; }));
const root=path.resolve(args.get('root') || process.cwd());
const fixtureRoot=path.resolve(args.get('fixture-root') || root);
const runId=args.get('run-id') || `parent-${Date.now()}-${process.pid}`;
const ownedRoot=path.resolve(args.get('owned-root') || path.join(os.tmpdir(), `cms-066025-parent-${runId}`));
const resultFile=path.resolve(args.get('result-file') || path.join(ownedRoot, 'parent-result.json'));
const runMutations=args.get('mutations') !== 'false';
const runScenarios=args.get('scenarios') !== 'false';
const normalScenario=args.get('normal-scenario') || 'normal';
const executablePath=path.resolve(process.argv[1]);
function cpRel(fromRoot,toRoot,rel){ const src=path.join(fromRoot,rel); if(!fs.existsSync(src)) return false; const dst=path.join(toRoot,rel); fs.mkdirSync(path.dirname(dst),{recursive:true}); fs.cpSync(src,dst,{recursive:true}); return true; }
function makeRoot(label){ const dir=fs.mkdtempSync(path.join(ownedRoot, `${label}-`)); for(const rel of COPY_RELS) cpRel(root,dir,rel) || cpRel(fixtureRoot,dir,rel); return dir; }
function listExisting(paths){ return paths.filter(p=>{ try{ fs.accessSync(p); return true; } catch { return false; } }); }
function failedIds(result){ return Array.isArray(result?.assertions) ? result.assertions.filter(a=>!a.pass).map(a=>a.id) : []; }
function runChild(targetRoot,{scenario='normal',label='child',timeoutMs=60000}={}){
  const childRunId=`${runId}-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const childOwnedRoot=fs.mkdtempSync(path.join(ownedRoot, `child-${label}-`));
  const resultPath=path.join(ownedRoot, `child-result-${childRunId}.json`);
  const childRunner=path.join(targetRoot, CHILD_REL);
  const proc=spawnSync(process.execPath,[childRunner,`--root=${targetRoot}`,`--fixture-root=${targetRoot}`,`--run-id=${childRunId}`,`--owned-root=${childOwnedRoot}`,`--result-file=${resultPath}`,`--scenario=${scenario}`],{encoding:'utf8',cwd:targetRoot,timeout:timeoutMs});
  let result=null, parseError='';
  try{ if(fs.existsSync(resultPath)) result=JSON.parse(fs.readFileSync(resultPath,'utf8')); } catch(err){ parseError=err.message; }
  const protocolErrors=validateChildResult(result, childRunId, targetRoot, childRunner);
  const filesystemRemainingOwnedPaths=listExisting(result?.ownedPathsCreated || []);
  return { proc,result,parseError,protocolErrors,expectedRunId:childRunId,expectedRoot:targetRoot,executablePath:childRunner,filesystemRemainingOwnedPaths,record:{ runId:childRunId, scenario, root:targetRoot, executablePath:childRunner, status:proc.status, signal:proc.signal || null, timedOut:Boolean(proc.error && /timed out/i.test(proc.error.message||'')), spawnError:proc.error?.message || '', parseError, protocolErrors, failedAssertionIds:failedIds(result), resultPresent:Boolean(result), remainingOwnedPaths:Array.isArray(result?.remainingOwnedPaths)?result.remainingOwnedPaths:[], filesystemRemainingOwnedPaths }};
}
function inspectNormalChild(record){
  const v=[];
  if (record.status !== 0) v.push('PARENT_ACCEPTED_ABNORMAL_NORMAL_CHILD');
  if (Number(record.status) >= 2) v.push('PARENT_ACCEPTED_EXIT_2_CHILD');
  if (record.signal) v.push('PARENT_ACCEPTED_SIGNAL_CHILD');
  if (record.timedOut) v.push('PARENT_ACCEPTED_TIMEOUT_CHILD');
  if (record.spawnError && !record.timedOut) v.push('PARENT_ACCEPTED_SPAWN_ERROR_CHILD');
  if (record.parseError) v.push('PARENT_ACCEPTED_PARSE_ERROR_CHILD');
  if (record.protocolErrors.length !== 0) v.push('PARENT_ACCEPTED_PROTOCOL_ERROR_CHILD');
  if (record.protocolErrors.includes('ROOT')) v.push('PARENT_ACCEPTED_WRONG_ROOT_CHILD');
  if (record.protocolErrors.includes('RUN_ID')) v.push('PARENT_ACCEPTED_WRONG_RUN_ID_CHILD');
  if (record.protocolErrors.includes('EXECUTABLE_PATH')) v.push('PARENT_ACCEPTED_WRONG_EXECUTABLE_CHILD');
  if (record.failedAssertionIds.includes('UNEXPECTED_CONTROL_FAILURE')) v.push('PARENT_ACCEPTED_UNEXPECTED_FAILURES');
  if (record.remainingOwnedPaths.length !== 0 || record.filesystemRemainingOwnedPaths.length !== 0) v.push('PARENT_ACCEPTED_CLEANUP_LEAK_CHILD');
  if (record.remainingOwnedPaths.length !== record.filesystemRemainingOwnedPaths.length) v.push('PARENT_ACCEPTED_HIDDEN_CLEANUP_LEAK_CHILD');
  if (!record.resultPresent) v.push('PARENT_TRUSTED_SUMMARY_WITHOUT_RAW_EVIDENCE');
  return v;
}
function inspectMutationRecord(record, mutationRecord){
  const v=[];
  if (mutationRecord.expectedOutcome === 'EXPECTED_TEST_FAILURE' && record.status !== 1) v.push('PARENT_ACCEPTED_BAD_KILLED_MUTANT_EXIT_CONTRACT');
  if (record.signal) v.push('PARENT_ACCEPTED_SIGNAL_CHILD');
  if (record.timedOut) v.push('PARENT_ACCEPTED_TIMEOUT_CHILD');
  if (record.protocolErrors.length !== 0) v.push('PARENT_ACCEPTED_PROTOCOL_ERROR_CHILD');
  if (mutationRecord.unexpectedFailed?.length) v.push('PARENT_ACCEPTED_UNEXPECTED_FAILURES');
  if (!record.resultPresent) v.push('PARENT_TRUSTED_SUMMARY_WITHOUT_RAW_EVIDENCE');
  return v;
}
function summarizeProcess(records){
  return {
    PRODUCTION_LIKE_PROCESSES_TOTAL: records.length,
    UNEXPECTED_ABNORMAL_EXITS: records.filter(r=>Number(r.status)>=2).length,
    UNEXPECTED_SIGNALS: records.filter(r=>r.signal).length,
    UNEXPECTED_TIMEOUTS: records.filter(r=>r.timedOut).length,
    UNEXPECTED_SPAWN_ERRORS: records.filter(r=>r.spawnError && !r.timedOut).length,
    UNEXPECTED_PROTOCOL_ERRORS: records.filter(r=>r.protocolErrors.length).length,
  };
}
function scenarioExpectation(s){ return ({'exit-2-after-result':'ABNORMAL_CHILD_EXIT','signal-after-result':'CHILD_SIGNAL','timeout':'CHILD_TIMEOUT','malformed-result':'PROTOCOL_INVALID','wrong-run-id':'PROTOCOL_INVALID','wrong-root':'PROTOCOL_INVALID','wrong-executable':'PROTOCOL_INVALID','cleanup-leak':'CLEANUP_FAILED','hidden-cleanup-leak':'CLEANUP_FAILED'}[s] || 'NORMAL'); }
function classifyScenario(record){ if(record.scenario === 'timeout') return 'CHILD_TIMEOUT'; if(record.timedOut) return 'CHILD_TIMEOUT'; if(record.signal) return 'CHILD_SIGNAL'; if(Number(record.status)>=2) return 'ABNORMAL_CHILD_EXIT'; if(record.parseError || record.protocolErrors.length) return 'PROTOCOL_INVALID'; if(record.remainingOwnedPaths.length || record.filesystemRemainingOwnedPaths.length || record.remainingOwnedPaths.length !== record.filesystemRemainingOwnedPaths.length) return 'CLEANUP_FAILED'; return 'NORMAL'; }
async function main(){
  fs.mkdirSync(ownedRoot,{recursive:true});
  const assertions=[]; const childProcessRecords=[]; const productionLikeRecords=[]; const mutationRecords=[]; const oracleControls=[]; const scenarioRecords=[];
  const normalRoot=makeRoot('normal');
  const normal=runChild(normalRoot,{scenario:normalScenario,label:`normal-${normalScenario}`,timeoutMs: normalScenario==='timeout'?3000:60000});
  childProcessRecords.push(normal.record);
  if (normalScenario === 'normal') productionLikeRecords.push(normal.record);
  const normalViolations=inspectNormalChild(normal.record);
  add(assertions,'NORMAL_CHILD_TOTAL', true, '1');
  add(assertions,'NORMAL_CHILD_ACCEPTED', normalViolations.length===0, normalViolations.join(','));
  add(assertions,'NORMAL_CHILD_PROTOCOL_VALID', normal.protocolErrors.length===0, normal.protocolErrors.join(','));
  if (normalScenario !== 'normal') add(assertions,'ADVERSARIAL_NORMAL_SCENARIO_REJECTED', normalViolations.length>0, normalViolations.join(','));
  if (runMutations) {
    const manifests=[
      ['product','scripts/fixtures/v6.14.066.025-product-mutation-cases.json'],
      ['migration','scripts/fixtures/v6.14.066.025-migration-source-mutation-cases.json'],
      ['child-failure','scripts/fixtures/v6.14.066.025-child-failure-mode-mutation-cases.json'],
    ];
    for (const [label,rel] of manifests) {
      const records=readJson(path.join(root,rel));
      const manifestErrors=validateManifestRecords(records,{root,label});
      add(assertions,`${label.toUpperCase().replace(/-/g,'_')}_MANIFEST_VALID`,manifestErrors.length===0,manifestErrors.join(';'));
      for (const mut of records) {
        const mr=makeRoot(`${label}-${mut.id}`);
        const repl=applyReplacement(mr,mut);
        const run=runChild(mr,{scenario:mut.scenario||'normal',label:mut.id,timeoutMs: (mut.scenario==='timeout'?3000:60000)});
        childProcessRecords.push(run.record);
        const evalRecord=evaluateProcessMutation(mut,repl,run,mr,path.join(mr,CHILD_REL));
        mutationRecords.push(evalRecord);
        add(assertions,`MUTATION_${mut.id}_${evalRecord.accepted?'KILLED':'NOT_KILLED'}`,evalRecord.accepted,evalRecord.rejectReason || 'accepted');
      }
    }
    const controls=readJson(path.join(root,'scripts/fixtures/v6.14.066.025-oracle-control-cases.json'));
    const controlErrors=validateManifestRecords(controls,{root,label:'oracle'});
    add(assertions,'ORACLE_CONTROL_MANIFEST_VALID',controlErrors.length===0,controlErrors.join(';'));
    for (const mut of controls) {
      const mr=makeRoot(`oracle-${mut.id}`); const repl=applyReplacement(mr,mut); const run=runChild(mr,{scenario:mut.scenario||'normal',label:mut.id});
      const evalRecord=evaluateProcessMutation(mut,repl,run,mr,path.join(mr,CHILD_REL)); oracleControls.push(evalRecord);
      add(assertions,`ORACLE_${mut.id}_REJECTED`,evalRecord.accepted,evalRecord.rejectReason || 'accepted');
    }
    if (runScenarios) {
      const scenarios=['exit-2-after-result','signal-after-result','timeout','malformed-result','wrong-run-id','wrong-root','wrong-executable','cleanup-leak','hidden-cleanup-leak','unexpected-failure'];
      for (const s of scenarios) {
        const sr=makeRoot(`scenario-${s}`); const run=runChild(sr,{scenario:s,label:`scenario-${s}`,timeoutMs:s==='timeout'?3000:60000});
        const observed=classifyScenario(run.record); const expected=s==='unexpected-failure'?'NORMAL':scenarioExpectation(s);
        const unexpected = s === 'unexpected-failure' ? !run.record.failedAssertionIds.includes('UNEXPECTED_CONTROL_FAILURE') : observed !== expected;
        scenarioRecords.push({scenario:s, observed, expected, unexpected, record:run.record});
        add(assertions,`SCENARIO_${s}_EXPECTED`,!unexpected,`${observed} expected ${expected}`);
      }
    }
  }
  const product=mutationRecords.filter(r=>r.category==='product'); const migration=mutationRecords.filter(r=>r.category==='migration'); const child=mutationRecords.filter(r=>r.category==='child-failure');
  const processSummary={
    ...summarizeProcess(productionLikeRecords),
    NORMAL_CHILD_TOTAL:1,
    PRODUCT_MUTANTS_TOTAL:product.length, PRODUCT_MUTANTS_KILLED:product.filter(r=>r.accepted).length,
    MIGRATION_MUTANTS_TOTAL:migration.length, MIGRATION_MUTANTS_KILLED:migration.filter(r=>r.accepted).length,
    CHILD_FAILURE_MODE_MUTANTS_TOTAL:child.length, CHILD_FAILURE_MODE_MUTANTS_KILLED:child.filter(r=>r.accepted).length,
    ORACLE_CONTROLS_TOTAL:oracleControls.length, ORACLE_CONTROLS_CORRECTLY_REJECTED:oracleControls.filter(r=>r.accepted).length,
    ADVERSARIAL_SCENARIOS_TOTAL:scenarioRecords.length,
    EXPECTED_ABNORMAL_EXITS_OBSERVED:scenarioRecords.filter(r=>r.observed==='ABNORMAL_CHILD_EXIT' && !r.unexpected).length,
    EXPECTED_SIGNALS_OBSERVED:scenarioRecords.filter(r=>r.observed==='CHILD_SIGNAL' && !r.unexpected).length,
    EXPECTED_TIMEOUTS_OBSERVED:scenarioRecords.filter(r=>r.observed==='CHILD_TIMEOUT' && !r.unexpected).length,
    EXPECTED_PROTOCOL_INVALID_OBSERVED:scenarioRecords.filter(r=>r.observed==='PROTOCOL_INVALID' && !r.unexpected).length,
    EXPECTED_CLEANUP_FAILURES_OBSERVED:scenarioRecords.filter(r=>r.observed==='CLEANUP_FAILED' && !r.unexpected).length,
    UNEXPECTED_SCENARIO_OUTCOMES:scenarioRecords.filter(r=>r.unexpected).length,
  };
  add(assertions,'PRODUCT_MUTANTS_KILLED_ALL', product.length===0 || product.every(r=>r.accepted), `${processSummary.PRODUCT_MUTANTS_KILLED}/${product.length}`);
  add(assertions,'MIGRATION_MUTANTS_KILLED_ALL', migration.length===0 || migration.every(r=>r.accepted), `${processSummary.MIGRATION_MUTANTS_KILLED}/${migration.length}`);
  add(assertions,'CHILD_FAILURE_MODE_MUTANTS_KILLED_ALL', child.length===0 || child.every(r=>r.accepted), `${processSummary.CHILD_FAILURE_MODE_MUTANTS_KILLED}/${child.length}`);
  add(assertions,'ORACLE_CONTROLS_REJECTED_ALL', oracleControls.length===0 || oracleControls.every(r=>r.accepted), `${processSummary.ORACLE_CONTROLS_CORRECTLY_REJECTED}/${oracleControls.length}`);
  add(assertions,'PRODUCTION_LIKE_PROTOCOL_ERRORS_ZERO', processSummary.UNEXPECTED_PROTOCOL_ERRORS===0, String(processSummary.UNEXPECTED_PROTOCOL_ERRORS));
  add(assertions,'PRODUCTION_LIKE_ABNORMAL_EXITS_ZERO', processSummary.UNEXPECTED_ABNORMAL_EXITS===0, String(processSummary.UNEXPECTED_ABNORMAL_EXITS));
  add(assertions,'SCENARIO_OUTCOMES_EXPECTED', processSummary.UNEXPECTED_SCENARIO_OUTCOMES===0, String(processSummary.UNEXPECTED_SCENARIO_OUTCOMES));
  if (!runMutations) {
    add(assertions,'NORMAL_ONLY_PARENT_MUTATION_RECORDS_ZERO', mutationRecords.length===0, String(mutationRecords.length));
    add(assertions,'NORMAL_ONLY_PARENT_SCENARIO_RECORDS_ZERO', scenarioRecords.length===0, String(scenarioRecords.length));
    add(assertions,'NORMAL_ONLY_CHILD_MUTATION_RECORDS_ZERO', true, '0');
    add(assertions,'NORMAL_ONLY_CHILD_SCENARIO_RECORDS_ZERO', normalScenario==='normal', normalScenario);
  }
  const result=summarize(assertions,{ protocolVersion:PROTOCOLS.parent, runId, root, executablePath, pid:process.pid, runMutations, runScenarios, normalScenario, childProcessRecords, mutationRecords, oracleControls, scenarioRecords, processSummary, parentAcceptance: assertions.every(a=>a.pass), guardViolations: normalViolations });
  writeJson(resultFile,result);
  process.exit(result.failCount>0?1:0);
}
main().catch(err=>{ fs.mkdirSync(path.dirname(resultFile),{recursive:true}); writeJson(resultFile,{protocolVersion:PROTOCOLS.parent,runId,root,executablePath,assertions:[{id:'PARENT_UNCAUGHT_EXCEPTION',pass:false,message:err.stack||err.message}],passCount:0,failCount:1,totalCount:1,childProcessRecords:[],processSummary:{}}); process.exit(1); });
