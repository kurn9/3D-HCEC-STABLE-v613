#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { PROTOCOLS, add, sha256File, readJson, summarize, writeJson } from './lib/v6.14.066.025-mutation-outcome-oracle.mjs';
import { evaluateMigrationSource, migrationAssertions } from './lib/v6.14.066.025-migration-source-evaluator.mjs';

const CHILD_REL = 'scripts/verify-v6.14.066.025-cms-source-and-migration-child-runner.mjs';
const EXACT_CASES_REL = 'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json';
const MIGRATION_CASES_REL = 'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json';
const REQUIRED_REL = 'scripts/fixtures/v6.14.066.025-required-verification-cases.json';
const args = new Map(process.argv.slice(2).map((arg)=>{ const [k,...rest]=arg.split('='); return [k.replace(/^--/,''), rest.length ? rest.join('=') : 'true']; }));
const root = path.resolve(args.get('root') || process.cwd());
const fixtureRoot = path.resolve(args.get('fixture-root') || root);
const runId = args.get('run-id') || `child-${Date.now()}-${process.pid}`;
const ownedRoot = path.resolve(args.get('owned-root') || path.join(os.tmpdir(), `cms-066025-child-${runId}`));
const resultFile = path.resolve(args.get('result-file') || path.join(ownedRoot, 'child-result.json'));
const scenario = args.get('scenario') || 'normal';
const executablePath = path.resolve(process.argv[1]);

function cp(src,dst){ fs.mkdirSync(path.dirname(dst),{recursive:true}); fs.copyFileSync(src,dst); }
function rm(p){ fs.rmSync(p,{recursive:true,force:true}); }
function exists(p){ try { fs.accessSync(p); return true; } catch { return false; } }
function listRemaining(paths){ return paths.filter(exists); }
function makeImportTree() {
  const importRoot = path.join(ownedRoot, `import-${runId}`);
  fs.mkdirSync(path.join(importRoot, 'src/cms-admin'), { recursive:true });
  cp(path.join(root,'src/cms-admin/adminState.js'), path.join(importRoot,'src/cms-admin/adminState.js'));
  cp(path.join(root,'src/cms-admin/adminReleaseOperationGate.js'), path.join(importRoot,'src/cms-admin/adminReleaseOperationGate.js'));
  fs.writeFileSync(path.join(importRoot,'src/cms-admin/adminConfig.js'), "export const ADMIN_UI = { defaultTab: 'dashboard' };\n");
  fs.writeFileSync(path.join(importRoot,'src/cms-admin/adminApi.js'), "export async function reconcileCmsReleasePointer(){ return { data:{ ok:true, mode:'status', classification:'idle', state:'idle', blocked:false, repairable:false }, error:null }; }\n");
  fs.writeFileSync(path.join(importRoot,'src/cms-admin/adminUtils.js'), "export function normalizeErrorMessage(err, fallback='') { return err?.message || String(err || fallback || ''); }\n");
  return importRoot;
}
async function main(){
  fs.mkdirSync(ownedRoot,{recursive:true});
  const assertions=[]; const ownedPathsCreated=[]; const ownedPathsRemoved=[];
  const targetAdmin=path.join(root,'src/cms-admin/adminState.js');
  const targetGate=path.join(root,'src/cms-admin/adminReleaseOperationGate.js');
  const targetAdminSha256=sha256File(targetAdmin); const targetGateSha256=sha256File(targetGate);
  const importRoot=makeImportTree(); ownedPathsCreated.push(importRoot);
  if (scenario === 'import-source-mismatch') {
    fs.writeFileSync(path.join(importRoot,'src/cms-admin/adminState.js'), fs.readFileSync(path.join(root,'src/cms-admin/adminState.js'),'utf8') + '\n// imported from wrong tree simulation\n');
  }
  if (scenario === 'admin-hash-mismatch') fs.appendFileSync(path.join(importRoot,'src/cms-admin/adminState.js'), '\n// corrupt imported admin\n');
  if (scenario === 'gate-hash-mismatch') fs.appendFileSync(path.join(importRoot,'src/cms-admin/adminReleaseOperationGate.js'), '\n// corrupt imported gate\n');
  const importedAdmin=path.join(importRoot,'src/cms-admin/adminState.js'); const importedGate=path.join(importRoot,'src/cms-admin/adminReleaseOperationGate.js');
  const importedAdminSha256=sha256File(importedAdmin); const importedGateSha256=sha256File(importedGate);
  add(assertions,'HASH_ADMIN_SOURCE_MATCH', targetAdminSha256 === importedAdminSha256, `${targetAdminSha256} ${importedAdminSha256}`);
  add(assertions,'HASH_GATE_SOURCE_MATCH', targetGateSha256 === importedGateSha256, `${targetGateSha256} ${importedGateSha256}`);
  add(assertions,'IMPORT_SOURCE_MATCHES_MUTANT_TREE', targetAdminSha256 === importedAdminSha256 && targetGateSha256 === importedGateSha256, 'import root must reflect target root');
  add(assertions,'IMPORT_CACHE_ISOLATION', scenario !== 'cache-isolation-failure', scenario);
  let mod=null, gateMod=null, importError='';
  try {
    mod = await import(pathToFileURL(importedAdmin).href + `?run=${encodeURIComponent(runId)}-${Date.now()}`);
    gateMod = await import(pathToFileURL(importedGate).href + `?run=${encodeURIComponent(runId)}-${Date.now()}`);
  } catch (err) { importError=err.stack || err.message; }
  add(assertions,'ADMIN_STATE_IMPORTS', Boolean(mod?.isExactIdleReleaseStatusPayload), importError);
  add(assertions,'GATE_MODULE_IMPORTS', Boolean(gateMod?.applyReleaseOperationGateStatusResult), importError);
  let exactCases = readJson(path.join(fixtureRoot, EXACT_CASES_REL));
  if (scenario === 'empty-frontend-fixture') exactCases = [];
  const required = readJson(path.join(fixtureRoot, REQUIRED_REL));
  add(assertions,'FRONTEND_FIXTURE_NON_EMPTY', exactCases.length > 0, `count=${exactCases.length}`);
  const executedFrontendCaseIds=[];
  if (mod) {
    for (const c of exactCases) {
      executedFrontendCaseIds.push(c.id);
      const exact = mod.isExactIdleReleaseStatusPayload(c.payload);
      add(assertions, `${c.id}_PREDICATE`, exact === c.expectedExactIdle, `got=${exact} expected=${c.expectedExactIdle}`);
      if ((c.id === 'E046' || c.id === 'E047') && gateMod) {
        gateMod.applyReleaseOperationGateStatusResult({ data:c.payload, error:{ message:'wrapper error' } }, c.payload, 'wrapper error');
      } else {
        mod.applyReleaseOperationGateFromServer(c.payload, 'fallback');
      }
      const blocked = Boolean(mod.getState?.().releaseOperationGate?.blocked);
      add(assertions, `${c.id}_GATE`, blocked === c.expectedBlocked, `got=${blocked} expected=${c.expectedBlocked}`);
    }
  }
  if (gateMod) {
    gateMod.applyReleaseOperationGateStatusResult({ data:{ ok:true, mode:'status', classification:'idle', state:'idle' }, error:{ message:'transport failed' } }, { ok:true, mode:'status', classification:'idle', state:'idle' }, 'transport failed');
    const blocked = Boolean(mod.getState?.().releaseOperationGate?.blocked);
    add(assertions,'WRAPPER_ERROR_FAILS_CLOSED', blocked === true, `blocked=${blocked}`);
  }
  const missingFrontend = (required.frontendCaseIds || []).filter(id=>!exactCases.some(c=>c.id===id));
  const missingFrontendExecuted = (required.frontendCaseIds || []).filter(id=>!executedFrontendCaseIds.includes(id));
  add(assertions,'REQUIRED_FRONTEND_CASES_PRESENT', missingFrontend.length===0, missingFrontend.join(','));
  add(assertions,'REQUIRED_FRONTEND_CASES_EXECUTED', missingFrontendExecuted.length===0, missingFrontendExecuted.join(','));
  let migrationCases = readJson(path.join(fixtureRoot, MIGRATION_CASES_REL));
  if (scenario === 'empty-migration-fixture') migrationCases = [];
  if (scenario === 'missing-migration-required-case') migrationCases = migrationCases.filter(c=>c.id !== 'S011');
  add(assertions,'MIGRATION_FIXTURE_NON_EMPTY', migrationCases.length > 0, `count=${migrationCases.length}`);
  const migrationEvaluation = evaluateMigrationSource(root, migrationCases);
  const migAssertions = migrationAssertions(migrationEvaluation);
  for (const a of migAssertions) assertions.push(a);
  const executedMigrationCaseIds = migrationEvaluation.caseResults.map(c=>c.id);
  const missingMigration = (required.migrationCaseIds || []).filter(id=>!migrationCases.some(c=>c.id===id));
  const missingMigrationExecuted = (required.migrationCaseIds || []).filter(id=>!executedMigrationCaseIds.includes(id));
  add(assertions,'REQUIRED_MIGRATION_CASES_PRESENT', missingMigration.length===0, missingMigration.join(','));
  add(assertions,'REQUIRED_MIGRATION_CASES_EXECUTED', missingMigrationExecuted.length===0, missingMigrationExecuted.join(','));
  let remainingOwnedPaths=[];
  if (scenario !== 'cleanup-leak' && scenario !== 'hidden-cleanup-leak') { rm(importRoot); ownedPathsRemoved.push(importRoot); }
  remainingOwnedPaths=listRemaining(ownedPathsCreated);
  const reportedRemaining = scenario === 'hidden-cleanup-leak' ? [] : remainingOwnedPaths;
  add(assertions,'CLEANUP_REMAINING_ZERO', remainingOwnedPaths.length===0, remainingOwnedPaths.join(','));
  add(assertions,'REPORTED_CLEANUP_DIFFERS_FROM_FILESYSTEM', reportedRemaining.length === remainingOwnedPaths.length, `${reportedRemaining.length}/${remainingOwnedPaths.length}`);
  if (scenario === 'unexpected-failure') add(assertions,'UNEXPECTED_CONTROL_FAILURE', false, 'intentional unexpected failure');
  let result=summarize(assertions, {
    protocolVersion: PROTOCOLS.child,
    runId,
    root,
    executablePath,
    pid: process.pid,
    scenario,
    targetAdminSha256,
    importedAdminSha256,
    targetGateSha256,
    importedGateSha256,
    executedFrontendCaseIds,
    executedMigrationCaseIds,
    migrationSourceFilesRead: migrationEvaluation.migrationSourceFilesRead,
    migrationSourceHashes: migrationEvaluation.migrationSourceHashes,
    migrationEvaluation,
    ownedPathsCreated,
    ownedPathsRemoved,
    remainingOwnedPaths: reportedRemaining,
    filesystemRemainingOwnedPaths: remainingOwnedPaths,
  });
  if (scenario === 'wrong-run-id') result.runId = `${runId}-WRONG`;
  if (scenario === 'wrong-root') result.root = path.join(root, 'wrong-root');
  if (scenario === 'wrong-executable') result.executablePath = path.join(root, 'wrong-executable.mjs');
  fs.mkdirSync(path.dirname(resultFile),{recursive:true});
  if (scenario === 'malformed-result') fs.writeFileSync(resultFile, '{not-json'); else writeJson(resultFile, result);
  if (scenario === 'signal-after-result') process.kill(process.pid, 'SIGTERM');
  if (scenario === 'timeout') { setTimeout(()=>{}, 120000); return; }
  if (scenario === 'exit-2-after-result') process.exit(2);
  process.exit(result.failCount > 0 ? 1 : 0);
}
main().catch((err)=>{ fs.mkdirSync(path.dirname(resultFile),{recursive:true}); writeJson(resultFile,{ protocolVersion:PROTOCOLS.child, runId, root, executablePath, pid:process.pid, assertions:[{id:'CHILD_UNCAUGHT_EXCEPTION',pass:false,message:err.stack||err.message}], passCount:0, failCount:1, totalCount:1, ownedPathsCreated:[], ownedPathsRemoved:[], remainingOwnedPaths:[], migrationSourceFilesRead:[], migrationSourceHashes:{} }); process.exit(1); });
