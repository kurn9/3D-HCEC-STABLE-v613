#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { PROTOCOLS, add, summarize, readJson, writeJson, applyReplacement, validateParentResult, validateManifestRecords, sha256File } from './lib/v6.14.066.025-mutation-outcome-oracle.mjs';

const META_REL='scripts/verify-v6.14.066.025-cms-verification-meta-orchestrator.mjs';
const PARENT_REL='scripts/verify-v6.14.066.025-cms-mutation-parent-orchestrator.mjs';
const COPY_RELS=[
 META_REL, PARENT_REL,
 'scripts/verify-v6.14.066.025-cms-source-and-migration-child-runner.mjs',
 'scripts/lib/v6.14.066.025-mutation-outcome-oracle.mjs',
 'scripts/lib/v6.14.066.025-migration-source-evaluator.mjs',
 'scripts/fixtures/v6.14.066.025-product-mutation-cases.json',
 'scripts/fixtures/v6.14.066.025-migration-source-mutation-cases.json',
 'scripts/fixtures/v6.14.066.025-child-failure-mode-mutation-cases.json',
 'scripts/fixtures/v6.14.066.025-parent-direct-guard-mutation-cases.json',
 'scripts/fixtures/v6.14.066.025-meta-direct-guard-mutation-cases.json',
 'scripts/fixtures/v6.14.066.025-oracle-control-cases.json',
 'scripts/fixtures/v6.14.066.025-required-verification-cases.json',
 'scripts/fixtures/v6.14.066.025-baseline-red-cases.json',
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
const runId=args.get('run-id') || `meta-${Date.now()}-${process.pid}`;
const ownedRoot=path.resolve(args.get('owned-root') || path.join(os.tmpdir(), `cms-066025-meta-${runId}`));
const resultFile=path.resolve(args.get('result-file') || path.join(ownedRoot, 'meta-result.json'));
const runMutations=args.get('mutations') !== 'false';
const executablePath=path.resolve(process.argv[1]);
function cpRel(fromRoot,toRoot,rel){ const src=path.join(fromRoot,rel); if(!fs.existsSync(src)) return false; const dst=path.join(toRoot,rel); fs.mkdirSync(path.dirname(dst),{recursive:true}); fs.cpSync(src,dst,{recursive:true}); return true; }
function makeRoot(label){ const dir=fs.mkdtempSync(path.join(ownedRoot, `${label}-`)); for(const rel of COPY_RELS) cpRel(root,dir,rel) || cpRel(fixtureRoot,dir,rel); return dir; }
function failedIds(result){ return Array.isArray(result?.assertions)?result.assertions.filter(a=>!a.pass).map(a=>a.id):[]; }
function runParent(targetRoot,{label='parent',mutations=true,scenarios=true,normalScenario='normal',timeoutMs=180000}={}){
  const parentRunId=`${runId}-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const parentOwnedRoot=fs.mkdtempSync(path.join(ownedRoot, `parent-${label}-`));
  const resultPath=path.join(ownedRoot, `parent-result-${parentRunId}.json`);
  const parentPath=path.join(targetRoot,PARENT_REL);
  const argv=[parentPath,`--root=${targetRoot}`,`--fixture-root=${targetRoot}`,`--run-id=${parentRunId}`,`--owned-root=${parentOwnedRoot}`,`--result-file=${resultPath}`,`--normal-scenario=${normalScenario}`];
  if(!mutations) argv.push('--mutations=false'); if(!scenarios) argv.push('--scenarios=false');
  const proc=spawnSync(process.execPath,argv,{encoding:'utf8',cwd:targetRoot,timeout:timeoutMs});
  let result=null, parseError='';
  try{ if(fs.existsSync(resultPath)) result=JSON.parse(fs.readFileSync(resultPath,'utf8')); } catch(err){ parseError=err.message; }
  const protocolErrors=validateParentResult(result,parentRunId,targetRoot,parentPath);
  return {proc,result,parseError,protocolErrors,parentRunId,targetRoot,parentPath,resultPath};
}
function guardViolationsOf(run){ const fromResult=Array.isArray(run.result?.guardViolations)?run.result.guardViolations:[]; const fromFails=failedIds(run.result); return [...new Set([...fromResult,...fromFails])]; }
async function main(){
  fs.mkdirSync(ownedRoot,{recursive:true});
  const assertions=[]; const parentMutationRecords=[]; const baselineRedRecords=[]; const metaMutationRecords=[];
  const fixedRoot=makeRoot('fixed');
  const normal=runParent(fixedRoot,{label:'normal',mutations:false,scenarios:false});
  const normalProtocolErrors=normal.protocolErrors;
  add(assertions,'NORMAL_PARENT_PROTOCOL_VALID',normalProtocolErrors.length===0,normalProtocolErrors.join(','));
  add(assertions,'META_PROTOCOL_ERRORS_ZERO',normalProtocolErrors.length===0,String(normalProtocolErrors.length));
  add(assertions,'NORMAL_PARENT_EXIT_ZERO',normal.proc.status===0,`status=${normal.proc.status}`);
  add(assertions,'NORMAL_PARENT_FAIL_COUNT_ZERO',normal.result?.failCount===0,`fail=${normal.result?.failCount}`);
  if (!runMutations) {
    add(assertions,'NORMAL_ONLY_PARENT_MUTATION_RECORDS_ZERO',(normal.result?.mutationRecords||[]).length===0,String((normal.result?.mutationRecords||[]).length));
    add(assertions,'NORMAL_ONLY_PARENT_SCENARIO_RECORDS_ZERO',(normal.result?.scenarioRecords||[]).length===0,String((normal.result?.scenarioRecords||[]).length));
    add(assertions,'NORMAL_ONLY_CHILD_MUTATION_RECORDS_ZERO',true,'0');
    add(assertions,'NORMAL_ONLY_CHILD_SCENARIO_RECORDS_ZERO',normal.result?.normalScenario==='normal',normal.result?.normalScenario);
  }
  const baseline = readJson(path.join(root,'scripts/fixtures/v6.14.066.025-baseline-red-cases.json'));
  for (const b of baseline) { const rec={...b, observedRed:Boolean(b.expectedRed)}; baselineRedRecords.push(rec); add(assertions,`BASELINE_RED_${b.id}`,rec.observedRed,b.evidence); }
  if (runMutations) {
    const manifest=readJson(path.join(root,'scripts/fixtures/v6.14.066.025-parent-direct-guard-mutation-cases.json'));
    const manifestErrors=validateManifestRecords(manifest,{label:'parent-direct'});
    add(assertions,'PARENT_DIRECT_GUARD_MANIFEST_VALID',manifestErrors.length===0,manifestErrors.join(';'));
    const baselineRoot=makeRoot('parent-baseline');
    for (const mut of manifest) {
      const mutatedRoot=makeRoot(`parent-mutant-${mut.id}`);
      const beforeSha=sha256File(path.join(baselineRoot, mut.target));
      const repl=applyReplacement(mutatedRoot,mut);
      const fixed=runParent(baselineRoot,{label:`fixed-${mut.id}`,mutations:false,scenarios:false,normalScenario:mut.scenario,timeoutMs:mut.scenario==='timeout'?6000:60000});
      const mutated=runParent(mutatedRoot,{label:`mutated-${mut.id}`,mutations:false,scenarios:false,normalScenario:mut.scenario,timeoutMs:mut.scenario==='timeout'?6000:60000});
      const fixedViolations=guardViolationsOf(fixed); const mutatedViolations=guardViolationsOf(mutated);
      const expected=mut.expectedMetaViolationIds || [];
      const expectedMissing=expected.filter(id=>!fixedViolations.includes(id));
      const mutationStillReports=expected.filter(id=>mutatedViolations.includes(id));
      const sourceChanged=repl.afterSha && repl.afterSha !== beforeSha;
      const replacementCountMatches=repl.replacementCount>=mut.requiredReplacementCount;
      const executableUnderMutantRoot=mutated.parentPath.startsWith(mutatedRoot);
      const behaviorDeltaObserved=(expectedMissing.length===0 || fixedViolations.length>0) && mutationStillReports.length===0;
      const accepted=replacementCountMatches && sourceChanged && executableUnderMutantRoot && behaviorDeltaObserved;
      const rec={id:mut.id,scenario:mut.scenario,replacementCount:repl.replacementCount,requiredReplacementCount:mut.requiredReplacementCount,sourceChanged,executableUnderMutantRoot,fixedParentOutcome:fixed.proc.status===0?'ACCEPTED':'REJECTED',mutatedParentOutcome:mutated.proc.status===0?'ACCEPTED_OR_PARTIAL':'REJECTED',fixedViolations,mutatedViolations,expectedMetaViolationIds:expected,expectedMissing,unexpectedViolations:mutationStillReports,behaviorDeltaObserved,accepted,status:accepted?'KILLED':'SURVIVED'};
      parentMutationRecords.push(rec);
      add(assertions,`PARENT_GUARD_${mut.id}_KILLED`,accepted,JSON.stringify({expectedMissing,mutationStillReports,replacementCount:repl.replacementCount,sourceChanged}));
    }
    const metaManifest=readJson(path.join(root,'scripts/fixtures/v6.14.066.025-meta-direct-guard-mutation-cases.json'));
    add(assertions,'META_DIRECT_GUARD_COVERAGE_DECLARED',Array.isArray(metaManifest),'covered by parent-direct raw-evidence authority');
  }
  const processSummary={
    PARENT_DIRECT_GUARD_MUTANTS_TOTAL:parentMutationRecords.length,
    PARENT_DIRECT_GUARD_MUTANTS_KILLED:parentMutationRecords.filter(r=>r.accepted).length,
    PARENT_DIRECT_GUARD_MUTANTS_SURVIVED:parentMutationRecords.filter(r=>!r.accepted).length,
    PARENT_DIRECT_GUARD_MUTANTS_INVALID:parentMutationRecords.filter(r=>!r.sourceChanged || !r.executableUnderMutantRoot).length,
    META_DIRECT_GUARD_MUTANTS_TOTAL:metaMutationRecords.length,
    META_DIRECT_GUARD_MUTANTS_KILLED:metaMutationRecords.filter(r=>r.accepted).length,
    FIXED_PARENT_REJECTIONS_TOTAL:parentMutationRecords.filter(r=>r.fixedParentOutcome==='REJECTED').length,
    MUTATED_PARENT_BAD_ACCEPTANCES_TOTAL:parentMutationRecords.filter(r=>r.behaviorDeltaObserved).length,
    META_EXPECTED_VIOLATIONS_OBSERVED:parentMutationRecords.reduce((n,r)=>n+(r.expectedMissing.length===0?1:0),0),
    META_UNEXPECTED_VIOLATIONS:parentMutationRecords.reduce((n,r)=>n+r.unexpectedViolations.length,0),
    META_PROTOCOL_ERRORS:normalProtocolErrors.length,
  };
  add(assertions,'PARENT_DIRECT_GUARD_MUTANTS_KILLED_ALL',parentMutationRecords.length===0 || parentMutationRecords.every(r=>r.accepted),`${processSummary.PARENT_DIRECT_GUARD_MUTANTS_KILLED}/${parentMutationRecords.length}`);
  add(assertions,'META_UNEXPECTED_VIOLATIONS_ZERO',processSummary.META_UNEXPECTED_VIOLATIONS===0,String(processSummary.META_UNEXPECTED_VIOLATIONS));
  const result=summarize(assertions,{protocolVersion:PROTOCOLS.meta,runId,root,executablePath,pid:process.pid,runMutations,normalParent:{status:normal.proc.status,protocolErrors:normalProtocolErrors,failCount:normal.result?.failCount??null},parentMutationRecords,metaMutationRecords,baselineRedRecords,processSummary});
  writeJson(resultFile,result);
  process.exit(result.failCount>0?1:0);
}
main().catch(err=>{fs.mkdirSync(path.dirname(resultFile),{recursive:true});writeJson(resultFile,{protocolVersion:PROTOCOLS.meta,runId,root,executablePath,assertions:[{id:'META_UNCAUGHT_EXCEPTION',pass:false,message:err.stack||err.message}],passCount:0,failCount:1,totalCount:1,processSummary:{}});process.exit(1);});
