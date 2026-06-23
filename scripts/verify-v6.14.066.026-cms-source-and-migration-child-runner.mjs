#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateMigrationSource } from './lib/v6.14.066.026-migration-source-control-flow-evaluator.mjs';
import { writeJson, sha256File, listOwned } from './lib/v6.14.066.026-mutation-outcome-oracle.mjs';

const CHILD_PROTOCOL_VERSION = 'v6.14.066.026-child';
const TEMP_PREFIX = 'cms-066026-';
const args = new Map(process.argv.slice(2).map((a)=>{ const [k,...r]=a.split('='); return [k.replace(/^--/,''), r.length?r.join('='):'true']; }));
const root = path.resolve(args.get('root') || process.cwd());
const fixtureRoot = path.resolve(args.get('fixture-root') || root);
const baselineRoot = path.resolve(args.get('baseline-root') || root);
const runId = args.get('run-id') || `child-${Date.now()}-${process.pid}`;
const ownedRoot = path.resolve(args.get('owned-root') || path.join(os.tmpdir(), `${TEMP_PREFIX}child-${runId}`));
const resultFile = path.resolve(args.get('result-file') || path.join(os.tmpdir(), `${TEMP_PREFIX}child-result-${runId}.json`));
const scenario = args.get('scenario') || 'normal';

function add(assertions, id, pass, message='') { assertions.push({ id, pass:Boolean(pass), message }); }
function readJson(rel, fallback=[]) { try { return JSON.parse(fs.readFileSync(path.join(fixtureRoot, rel),'utf8')); } catch { return fallback; } }
function copyRel(fromRoot, toRoot, rel) { const src = path.join(fromRoot, rel); const dst = path.join(toRoot, rel); fs.mkdirSync(path.dirname(dst), { recursive:true }); fs.cpSync(src,dst,{recursive:true}); }
function sha256Bytes(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
async function importAdmin(importRoot, suffix) { return import(`${pathToFileURL(path.join(importRoot,'src/cms-admin/adminState.js')).href}?run=${encodeURIComponent(suffix)}`); }
function runCleanupProbe(assertions, importRoot) {
  const remaining = fs.existsSync(importRoot) ? [importRoot] : [];
  add(assertions, 'CLEANUP_REMAINING_ZERO', remaining.length === 0, remaining.join('|'));
  return remaining;
}
async function runCacheProbe(assertions) {
  const dir = path.join(ownedRoot, 'cache-probe'); fs.mkdirSync(dir, {recursive:true});
  const mod = path.join(dir, 'probe.mjs');
  fs.writeFileSync(mod, 'export const marker = "A";\n');
  const first = await import(pathToFileURL(mod).href);
  fs.writeFileSync(mod, 'export const marker = "B";\n');
  const secondUrl = scenario === 'cache-stale' ? pathToFileURL(mod).href : `${pathToFileURL(mod).href}?v=${Date.now()}-${Math.random()}`;
  const second = await import(secondUrl);
  const staleModuleDetected = first.marker === second.marker;
  add(assertions, 'IMPORT_CACHE_ISOLATION', !staleModuleDetected, JSON.stringify({ firstImportSha: sha256Bytes('A'), secondTargetSha: sha256Bytes('B'), secondObservedBehavior: second.marker, staleModuleDetected }));
}
async function main() {
  fs.mkdirSync(path.dirname(resultFile), {recursive:true});
  fs.mkdirSync(ownedRoot, {recursive:true});
  const assertions = [];
  const importRoot = path.join(ownedRoot, 'import-root');
  const effectiveImportSource = scenario === 'original-tree-import' ? baselineRoot : root;
  for (const rel of ['src/cms-admin/adminConfig.js','src/cms-admin/adminState.js','src/cms-admin/adminReleaseOperationGate.js']) copyRel(effectiveImportSource, importRoot, rel);
  if (scenario === 'admin-hash-mismatch') fs.appendFileSync(path.join(importRoot,'src/cms-admin/adminState.js'), '\n/* actual admin import hash mismatch */\n');
  if (scenario === 'gate-hash-mismatch') fs.appendFileSync(path.join(importRoot,'src/cms-admin/adminReleaseOperationGate.js'), '\n/* actual gate import hash mismatch */\n');
  if (scenario === 'empty-frontend-fixture') fs.writeFileSync(path.join(fixtureRoot, 'scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json'), '[]');
  if (scenario === 'empty-migration-fixture') fs.writeFileSync(path.join(fixtureRoot, 'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json'), '[]');

  const targetAdmin = path.join(root,'src/cms-admin/adminState.js');
  const importedAdmin = path.join(importRoot,'src/cms-admin/adminState.js');
  const targetGate = path.join(root,'src/cms-admin/adminReleaseOperationGate.js');
  const importedGate = path.join(importRoot,'src/cms-admin/adminReleaseOperationGate.js');
  const targetAdminSha256 = fs.existsSync(targetAdmin) ? sha256File(targetAdmin) : '';
  const importedAdminSha256 = fs.existsSync(importedAdmin) ? sha256File(importedAdmin) : '';
  const targetGateSha256 = fs.existsSync(targetGate) ? sha256File(targetGate) : '';
  const importedGateSha256 = fs.existsSync(importedGate) ? sha256File(importedGate) : '';
  add(assertions, 'HASH_ADMIN_SOURCE_MATCH', targetAdminSha256 === importedAdminSha256, `${targetAdminSha256}:${importedAdminSha256}`);
  add(assertions, 'HASH_GATE_SOURCE_MATCH', targetGateSha256 === importedGateSha256, `${targetGateSha256}:${importedGateSha256}`);
  add(assertions, 'IMPORT_SOURCE_MATCHES_MUTANT_TREE', path.resolve(effectiveImportSource) === path.resolve(root), `${effectiveImportSource}`);

  const admin = await importAdmin(importRoot, runId);
  const exactCases = readJson('scripts/fixtures/v6.14.066.021-exact-idle-closed-schema-cases.json', []);
  const required = readJson('scripts/fixtures/v6.14.066.026-required-verification-cases.json', {});
  add(assertions, 'FRONTEND_FIXTURE_NON_EMPTY', exactCases.length > 0, `count=${exactCases.length}`);
  const executedFrontendCaseIds = [];
  for (const c of exactCases) {
    executedFrontendCaseIds.push(c.id);
    const predicate = admin.isExactIdleReleaseStatusPayload(c.payload);
    add(assertions, `${c.id}_PREDICATE`, predicate === c.expectedExactIdle, `predicate=${predicate} expected=${c.expectedExactIdle}`);
    if (typeof admin.applyReleaseOperationGateFromServer === 'function') {
      admin.applyReleaseOperationGateFromServer(c.payload, 'fallback');
      const blocked = c.wrapperError ? true : admin.getState?.().releaseOperationGate?.blocked === true;
      add(assertions, `${c.id}_GATE`, blocked === c.expectedBlocked, `blocked=${blocked} expected=${c.expectedBlocked}`);
    }
  }
  const requiredFrontend = required.frontendCaseIds || ['E001','E006','E012'];
  const missingFrontend = requiredFrontend.filter((id)=>!exactCases.some((c)=>c.id===id));
  add(assertions, 'REQUIRED_FRONTEND_CASES_PRESENT', missingFrontend.length === 0, missingFrontend.join(','));
  add(assertions, 'REQUIRED_FRONTEND_CASES_EXECUTED', missingFrontend.length === 0 && requiredFrontend.every((id)=>executedFrontendCaseIds.includes(id)), executedFrontendCaseIds.join(','));

  const migration = evaluateMigrationSource(root, fixtureRoot);
  const migrationAssertions = migration.caseResults || [];
  for (const a of migrationAssertions) assertions.push(a);
  const migrationFixture = readJson('scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json', []);
  add(assertions, 'MIGRATION_FIXTURE_NON_EMPTY', migrationFixture.length > 0, `count=${migrationFixture.length}`);
  const requiredMigration = required.migrationCaseIds || ['S001','S011'];
  const executedMigrationCaseIds = migrationAssertions.map((a)=>a.id);
  const missingMigration = requiredMigration.filter((id)=>!executedMigrationCaseIds.includes(id));
  add(assertions, 'REQUIRED_MIGRATION_CASES_PRESENT', missingMigration.length === 0, missingMigration.join(','));
  add(assertions, 'REQUIRED_MIGRATION_CASES_EXECUTED', missingMigration.length === 0, executedMigrationCaseIds.join(','));

  await runCacheProbe(assertions);
  let remainingBeforeCleanup = [];
  if (scenario !== 'cleanup-skip' && scenario !== 'hidden-cleanup') fs.rmSync(importRoot, {recursive:true, force:true});
  remainingBeforeCleanup = fs.existsSync(importRoot) ? [importRoot] : [];
  if (scenario === 'hidden-cleanup') remainingBeforeCleanup = [];
  const filesystemRemainingBeforeCleanup = fs.existsSync(importRoot) ? [importRoot] : [];
  add(assertions, 'REPORTED_CLEANUP_DIFFERS_FROM_FILESYSTEM', scenario === 'hidden-cleanup' ? remainingBeforeCleanup.join('|') !== filesystemRemainingBeforeCleanup.join('|') : true, JSON.stringify({remainingBeforeCleanup, filesystemRemainingBeforeCleanup}));
  add(assertions, 'CLEANUP_REMAINING_ZERO', remainingBeforeCleanup.length === 0, remainingBeforeCleanup.join('|'));

  const result = { protocolVersion: CHILD_PROTOCOL_VERSION, runId, root, executablePath: fileURLToPath(import.meta.url), pid: process.pid, scenario, assertions, targetAdminSha256, importedAdminSha256, targetGateSha256, importedGateSha256, executedFrontendCaseIds, executedMigrationCaseIds, migrationSourceFilesRead: migration.migrationFiles.map((f)=>f.relativePath), migrationSourceHashes: Object.fromEntries(migration.migrationFiles.map((f)=>[f.relativePath,f.sha256])), migrationDirectoryEntries: migration.migrationDirectoryEntries, migrationRelevantEntries: migration.migrationRelevantEntries, migrationOrderObserved: migration.migrationOrderObserved, migrationOrderExpected: migration.migrationOrderExpected, migrationOrderValid: migration.migrationOrderValid, remainingBeforeCleanup, filesystemRemainingBeforeCleanup, remainingAfterCleanup: [] };
  result.passCount = assertions.filter((a)=>a.pass).length; result.failCount = assertions.filter((a)=>!a.pass).length; result.totalCount = assertions.length;
  if (scenario === 'wrong-root') result.root = path.join(root, '__wrong_root__');
  if (scenario === 'wrong-run-id') result.runId = `${runId}-wrong`;
  if (scenario === 'wrong-executable') result.executablePath = path.join(root, '__wrong_exec__.mjs');
  if (scenario === 'malformed-result') { fs.writeFileSync(resultFile, '{ malformed json'); process.exit(0); }
  if (scenario !== 'missing-result') writeJson(resultFile, result);
  if (scenario === 'timeout') { await new Promise((resolve)=>setTimeout(resolve, 120000)); }
  if (scenario === 'signal-after-result') process.kill(process.pid, 'SIGTERM');
  if (scenario === 'exit-2-after-result') process.exit(2);
  fs.rmSync(ownedRoot, {recursive:true, force:true});
  const remainingGlobal = listOwned(TEMP_PREFIX).filter((p)=>p.includes(runId));
  if (remainingGlobal.length) process.exit(1);
  process.exit(result.failCount > 0 ? 1 : 0);
}
main().catch((err)=>{ try { writeJson(resultFile, { protocolVersion: CHILD_PROTOCOL_VERSION, runId, root, executablePath: fileURLToPath(import.meta.url), pid: process.pid, scenario, assertions:[{id:'CHILD_UNCAUGHT_EXCEPTION', pass:false, message:err.stack||err.message}], passCount:0, failCount:1, totalCount:1 }); } catch {} process.exit(2); });
