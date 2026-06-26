#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=') || 'true'];
}));
const root = path.resolve(args.get('root') || process.cwd());
const resultFile = args.get('result-file') ? path.resolve(args.get('result-file')) : '';
const requiredFiles = {
  reconcile: 'supabase/functions/reconcile-cms-release/index.ts',
  publish: 'supabase/functions/publish-cms-json/index.ts',
  rollback: 'supabase/functions/rollback-cms-json/index.ts',
  contract: 'supabase/functions/_shared/cmsReleaseContract.ts',
  operation: 'supabase/functions/_shared/cmsReleaseOperation.ts',
  audit: 'supabase/functions/_shared/cmsReleaseAudit.ts',
  fixture: 'scripts/fixtures/v6.14.066.035-canonical-current-release-pointer-repair-cases.json',
  verifier: 'scripts/verify-v6.14.066.035-canonical-current-release-pointer-repair.mjs',
};
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sources = Object.fromEntries(Object.entries(requiredFiles).map(([key, rel]) => [key, read(rel)]));
const fixture = JSON.parse(sources.fixture);
const assertions = [];
const mutationRecords = [];
function assert(id, pass, details = {}) { assertions.push({ id, pass: Boolean(pass), ...details }); }
function includesAll(text, snippets) { return snippets.every((snippet) => text.includes(snippet)); }
function count(text, pattern) { return (text.match(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length; }
function sha(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

for (const [key, rel] of Object.entries(requiredFiles)) assert(`FILE_EXISTS_${key}`, fs.existsSync(path.join(root, rel)), { rel });
assert('FIXTURE_REQUIRED_CASE_IDS_PRESENT', Array.isArray(fixture.requiredCaseIds) && fixture.requiredCaseIds.length >= 25, { count: fixture.requiredCaseIds?.length || 0 });
assert('FIXTURE_CASE_ARRAY_PRESENT', Array.isArray(fixture.cases) && fixture.cases.length >= 25, { count: fixture.cases?.length || 0 });
const caseIds = new Set((fixture.cases || []).map((item) => item.id));
for (const id of fixture.requiredCaseIds || []) assert(`FIXTURE_HAS_${id}`, caseIds.has(id));
for (const item of fixture.cases || []) {
  assert(`FIXTURE_SCHEMA_${item.id}`, typeof item.id === 'string' && (item.expectedClassification || item.expectedStatus || item.expectedUnchanged || item.expectedSharedBuilder));
}

assert('STATUS_POINTER_HEALTH_INSPECTED_AFTER_LINEAGE_CLEAN', /mode === 'status'[\s\S]*getTerminalLineageGateInspection[\s\S]*inspectCurrentReleasePointerHealth[\s\S]*canonical_pointer_missing/.test(sources.reconcile));
assert('STATUS_POINTER_MISSING_NOT_SILENT_IDLE', sources.reconcile.includes("classification: 'canonical_pointer_missing'") && sources.reconcile.includes("CANONICAL_CURRENT_RELEASE_POINTER_MISSING"));
assert('STATUS_POINTER_MISSING_REPAIRABLE_BLOCKED', includesAll(sources.reconcile, ["repairable = pointerHealth.classification === 'canonical_pointer_missing'", 'blocked: true']));
const statusBranch = sources.reconcile.slice(sources.reconcile.indexOf("if (mode === 'status')"), sources.reconcile.indexOf("if (mode === REPAIR_POINTER_MODE)"));
assert('STATUS_IS_READ_ONLY_NO_REPAIR_CALL', statusBranch.includes('inspectCurrentReleasePointerHealth') && !statusBranch.includes('uploadTextObject') && !statusBranch.includes('acquireReleaseOperation'));
assert('REPAIR_POINTER_MODE_EXISTS', sources.reconcile.includes("const REPAIR_POINTER_MODE = 'repair-pointer'") && sources.reconcile.includes('handleCanonicalPointerRepair'));
assert('REPAIR_ADMIN_AUTH_REUSES_EXISTING_ACCESS_GATE', /getAdminAccess\(serviceClient, user\.id\)[\s\S]*if \(!access\.allowed\)/.test(sources.reconcile));
assert('REPAIR_DRY_RUN_RETURNS_ZERO_WRITES', sources.reconcile.includes("classification: 'canonical_pointer_repair_dry_run'") && sources.reconcile.includes('writesPerformed: false'));
assert('REPAIR_APPLY_REQUIRES_PLAN_HASH', sources.reconcile.includes('if (!expectedPlanHash || expectedPlanHash !== plan.planHash)') && sources.reconcile.includes('REPAIR_POINTER_PLAN_HASH_MISMATCH'));
assert('REPAIR_APPLY_REQUIRES_CONFIRMATION', sources.reconcile.includes('if (confirmation !== REPAIR_CONFIRMATION)') && sources.reconcile.includes('REPAIR_POINTER_CONFIRMATION_REQUIRED'));
assert('REPAIR_SOURCE_AUDIT_ID_EXACT', sources.reconcile.includes(".eq('id', input.sourceAuditLogId)") && sources.reconcile.includes("normalizeText(row.status) !== 'published'") && sources.reconcile.includes("normalizeText(row.operation_type) !== 'publish'"));
assert('REPAIR_SOURCE_PATH_HASH_VERSION_GATES', includesAll(sources.reconcile, ['REPAIR_SOURCE_PATH_MISMATCH', 'REPAIR_SOURCE_HASH_MISMATCH', 'REPAIR_SOURCE_VERSION_MISMATCH', 'REPAIR_SOURCE_VERIFY_HASH_MISMATCH']));
assert('REPAIR_SOURCE_AND_ALIAS_BYTE_HASH_COMPARE', includesAll(sources.reconcile, ['sourceByteLength', 'activeAliasByteLength', 'activeAliasText !== sourceText', 'REPAIR_ACTIVE_ALIAS_MISMATCH']));
assert('SHARED_CANONICAL_BUILDER_EXISTS', includesAll(sources.contract, ['export function buildCanonicalReleaseJson', 'export function prepareCanonicalReleaseCandidate', 'export function buildReleasePointer', 'export async function createStableRepairReleaseId']));
assert('PUBLISH_USES_SHARED_CANONICAL_BUILDER', sources.publish.includes('buildCanonicalReleaseJson(candidateJson, {') && sources.publish.includes('prepareCanonicalReleaseCandidate(sourceJson)') && !sources.publish.includes('function prepareFinalReleaseJson'));
assert('REPAIR_RELEASE_ID_STABLE', sources.reconcile.includes('createStableRepairReleaseId') && sources.contract.includes('cms-canonical-pointer-repair'));
assert('REPAIR_ACQUIRES_OPERATION_LOCK', sources.reconcile.includes('const operation = await acquireReleaseOperation') && sources.reconcile.includes("operationType: 'publish'") && sources.reconcile.includes('repairKind'));
assert('REPAIR_LIFECYCLE_ORDER_PRESENT', includesAll(sources.reconcile, ["phase: 'release_write'", "phase: 'release_verified'", "phase: 'pointer_write_started'", "phase: 'pointer_written'", "phase: 'pointer_verified'"]));
assert('REPAIR_POINTER_WRITES_WITHOUT_UPSERT', sources.reconcile.includes('uploadPointerWithRaceProtection') && sources.reconcile.includes("upsert: false, cacheControl: '30'"));
assert('REPAIR_EXISTING_POINTER_CONFLICT_FAILS', sources.reconcile.includes('REPAIR_POINTER_ALREADY_POINTS_ELSEWHERE') && sources.reconcile.includes('REPAIR_POINTER_UNHEALTHY_NOT_OVERWRITTEN'));
assert('REPAIR_CANONICAL_OBJECT_EXACT_REUSE_ONLY', sources.reconcile.includes('uploadTextObjectWithExactReuse') && sources.reconcile.includes('existing === text'));
const applyRepairBody = sources.reconcile.slice(sources.reconcile.indexOf('async function applyCanonicalPointerRepair'), sources.reconcile.indexOf('async function uploadTextObjectWithExactReuse'));
assert('REPAIR_POINTER_VERIFY_BEFORE_SUCCESS', applyRepairBody.indexOf('verifyCanonicalPointerWithRetry') >= 0 && applyRepairBody.indexOf('verifyCanonicalPointerWithRetry') < applyRepairBody.indexOf("state: 'succeeded'"));
assert('REPAIR_TERMINAL_AUDIT_AFTER_SUCCESS', applyRepairBody.indexOf('ensureTerminalOperationAuditLog') > applyRepairBody.indexOf("state: 'succeeded'"));
assert('REPAIR_TERMINAL_AUDIT_FAILURE_NOT_FULL_SUCCESS', sources.reconcile.includes("classification: 'lineage_repair_required'") && sources.reconcile.includes('Terminal audit persistence failed after pointer repair'));
assert('REPAIR_FAILURE_FINALIZES_OPERATION', sources.reconcile.includes('finalizeReleaseOperationFailure') && sources.reconcile.includes('pointerWriteStarted'));
assert('OPTIONS_200_PRESERVED', sources.reconcile.includes("if (request.method === 'OPTIONS') return jsonResponse({ ok: true }, 200);"));
assert('REPAIR_LINEAGE_MODE_PRESERVED', sources.reconcile.includes("mode === 'repair-lineage'") && sources.reconcile.includes('repairResolvedOperationLineage'));
assert('ROLLBACK_SOURCE_UNCHANGED', sources.rollback.includes('rollback') && !sources.rollback.includes('canonical_current_release_pointer_repair'));
assert('NO_FRONTEND_SOURCE_CHANGE_IN_SCOPE', !Object.values(requiredFiles).some((rel) => rel.startsWith('src/')));

function runVerifierOnTempRoot(mutator) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify035-'));
  fs.cpSync(root, tmp, { recursive: true, filter: (src) => !src.includes(`${path.sep}.git${path.sep}`) && !src.includes(`${path.sep}node_modules${path.sep}`) });
  mutator(tmp);
  let status = 0;
  let out = '';
  try { out = execFileSync(process.execPath, [path.join(tmp, requiredFiles.verifier), `--root=${tmp}`, '--skip-mutations=true'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { status = error.status || 1; out = `${error.stdout || ''}${error.stderr || ''}`; }
  fs.rmSync(tmp, { recursive: true, force: true });
  const failed = [...String(out).matchAll(/FAIL\s+([A-Z0-9_]+)/g)].map((m) => m[1]);
  return { status, failed, output: out.slice(-2000) };
}

if (args.get('skip-mutations') !== 'true') {
  const mutations = [
    ['M001_STATUS_POINTER_MISSING_SILENT_IDLE', requiredFiles.reconcile, "classification: 'canonical_pointer_missing'", "classification: 'idle'", ['STATUS_POINTER_MISSING_NOT_SILENT_IDLE']],
    ['M002_REMOVE_REPAIR_MODE', requiredFiles.reconcile, "const REPAIR_POINTER_MODE = 'repair-pointer';", "const REPAIR_POINTER_MODE = 'repair-disabled';", ['REPAIR_POINTER_MODE_EXISTS']],
    ['M003_REMOVE_PLAN_HASH_GATE', requiredFiles.reconcile, "if (!expectedPlanHash || expectedPlanHash !== plan.planHash)", "if (false && (!expectedPlanHash || expectedPlanHash !== plan.planHash))", ['REPAIR_APPLY_REQUIRES_PLAN_HASH']],
    ['M004_REMOVE_CONFIRMATION_GATE', requiredFiles.reconcile, "if (confirmation !== REPAIR_CONFIRMATION)", "if (false && confirmation !== REPAIR_CONFIRMATION)", ['REPAIR_APPLY_REQUIRES_CONFIRMATION']],
    ['M005_USE_POINTER_UPSERT_TRUE', requiredFiles.reconcile, "upsert: false, cacheControl: '30'", "upsert: true, cacheControl: '30'", ['REPAIR_POINTER_WRITES_WITHOUT_UPSERT']],
    ['M006_REMOVE_OPERATION_LOCK', requiredFiles.reconcile, 'const operation = await acquireReleaseOperation', 'const operation = await disabledAcquireReleaseOperation', ['REPAIR_ACQUIRES_OPERATION_LOCK']],
    ['M007_REMOVE_POINTER_VERIFY', requiredFiles.reconcile, 'const pointerVerify = await verifyCanonicalPointerWithRetry(serviceClient, plan);', 'const pointerVerify = { valid: true };', ['REPAIR_POINTER_VERIFY_BEFORE_SUCCESS']],
    ['M008_REMOVE_TERMINAL_AUDIT', requiredFiles.reconcile, 'const audit = await ensureTerminalOperationAuditLog', 'const audit = await disabledEnsureTerminalOperationAuditLog', ['REPAIR_TERMINAL_AUDIT_AFTER_SUCCESS']],
    ['M009_REMOVE_SHARED_BUILDER_EXPORT', requiredFiles.contract, 'export function buildCanonicalReleaseJson', 'function buildCanonicalReleaseJson', ['SHARED_CANONICAL_BUILDER_EXISTS']],
    ['M010_REINTRODUCE_LOCAL_PUBLISH_BUILDER', requiredFiles.publish, 'buildCanonicalReleaseJson(candidateJson, {', 'prepareFinalReleaseJson(candidateJson, {', ['PUBLISH_USES_SHARED_CANONICAL_BUILDER']],
  ];
  for (const [id, rel, search, replacement, expectedFails] of mutations) {
    const before = read(rel);
    const replacementCount = count(before, search);
    const beforeHash = sha(before);
    const result = runVerifierOnTempRoot((tmp) => {
      const target = path.join(tmp, rel);
      const text = fs.readFileSync(target, 'utf8');
      fs.writeFileSync(target, text.replace(search, replacement));
    });
    const afterHash = sha(before.replace(search, replacement));
    const killed = replacementCount === 1 && beforeHash !== afterHash && result.status !== 0 && expectedFails.some((f) => result.failed.includes(f));
    mutationRecords.push({ id, target: rel, replacementCount, expectedReplacementCount: 1, sourceHashBefore: beforeHash, sourceHashAfter: afterHash, sourceChanged: beforeHash !== afterHash, exitCode: result.status, failedAssertionIds: result.failed, expectedFailedAssertionIds: expectedFails, status: killed ? 'KILLED' : 'SURVIVED', outputTail: result.output });
  }
  for (const rec of mutationRecords) assert(`MUTATION_${rec.id}_KILLED`, rec.status === 'KILLED', rec);
}

const pass = assertions.filter((a) => a.pass).length;
const fail = assertions.length - pass;
const result = { pass, fail, total: assertions.length, assertions, mutationRecords, killedMutants: mutationRecords.filter((m) => m.status === 'KILLED').length, survivedMutants: mutationRecords.filter((m) => m.status !== 'KILLED').length };
if (resultFile) fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
for (const item of assertions) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.id}`);
console.log(`RESULT PASS ${pass} / FAIL ${fail} / TOTAL ${assertions.length}`);
if (mutationRecords.length) console.log(`MUTATIONS KILLED ${result.killedMutants} / SURVIVED ${result.survivedMutants} / TOTAL ${mutationRecords.length}`);
process.exit(fail === 0 ? 0 : 1);
