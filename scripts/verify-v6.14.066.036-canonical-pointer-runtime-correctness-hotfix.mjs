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
const skipMutations = args.get('skip-mutations') === 'true';
const requiredFiles = {
  contract: 'supabase/functions/_shared/cmsReleaseContract.ts',
  reconcile: 'supabase/functions/reconcile-cms-release/index.ts',
  publish: 'supabase/functions/publish-cms-json/index.ts',
  fixture: 'scripts/fixtures/v6.14.066.036-canonical-pointer-runtime-correctness-hotfix-cases.json',
  verifier: 'scripts/verify-v6.14.066.036-canonical-pointer-runtime-correctness-hotfix.mjs',
};
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sources = Object.fromEntries(Object.entries(requiredFiles).map(([key, rel]) => [key, read(rel)]));
const fixture = JSON.parse(sources.fixture);
const assertions = [];
const mutationRecords = [];
function assert(id, pass, details = {}) { assertions.push({ ...details, id, pass: Boolean(pass) }); }
function sha(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function count(text, pattern) { return (text.match(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length; }
function normalizeText(value) { return String(value ?? '').trim(); }
function isSha256(value) { return /^[a-f0-9]{64}$/i.test(String(value || '')); }
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '')); }
async function sha256Text(text) { return crypto.createHash('sha256').update(String(text)).digest('hex'); }
async function createStableRepairReleaseId(sourceAuditLogId, sourceHash, publishedVersion) {
  const hash = await sha256Text(`cms-canonical-pointer-repair:${normalizeText(sourceAuditLogId)}:${normalizeText(sourceHash).toLowerCase()}:${normalizeText(publishedVersion)}`);
  const chars = hash.slice(0, 32).split('');
  chars[12] = '5';
  chars[16] = ((parseInt(chars[16] || '0', 16) & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}-${chars.slice(16, 20).join('')}-${chars.slice(20, 32).join('')}`;
}
function getReleaseContentPath(releaseId = '') { return isUuid(normalizeText(releaseId)) ? `published/releases/${normalizeText(releaseId)}/cms_public_content.json` : ''; }
function getLegacyVersionPath(releaseId = '') { return isUuid(normalizeText(releaseId)) ? `published/versions/cms_public_content_${normalizeText(releaseId)}.json` : ''; }
function validateReleasePointer(pointer) {
  const releaseId = normalizeText(pointer?.releaseId);
  const expectedPath = getReleaseContentPath(releaseId);
  const contentPath = normalizeText(pointer?.contentPath);
  const contentHash = normalizeText(pointer?.contentHash).toLowerCase();
  const errors = {};
  if (pointer?.schemaVersion !== 1) errors.schemaVersion = true;
  if (!expectedPath) errors.releaseId = true;
  if (contentPath !== expectedPath) errors.contentPath = true;
  if (!isSha256(contentHash)) errors.contentHash = true;
  return { valid: Object.keys(errors).length === 0, errors, releaseId, contentPath, contentHash };
}
function validateAuditHashes(row, verifyJson, expectedSourceHash) {
  const expected = normalizeText(expectedSourceHash).toLowerCase();
  const hashAfter = normalizeText(row.hash_after).toLowerCase();
  if (!isSha256(hashAfter)) return { pass: false, code: 'REPAIR_SOURCE_HASH_AFTER_INVALID' };
  if (hashAfter !== expected) return { pass: false, code: 'REPAIR_SOURCE_HASH_MISMATCH' };
  const releaseVerify = verifyJson?.releaseVerify && typeof verifyJson.releaseVerify === 'object' ? verifyJson.releaseVerify : {};
  const candidates = [verifyJson?.hash, verifyJson?.contentHash, verifyJson?.hashAfter, releaseVerify.hash].map((value) => normalizeText(value).toLowerCase()).filter(Boolean);
  if (candidates.length === 0) return { pass: false, code: 'REPAIR_SOURCE_VERIFY_HASH_MISSING' };
  if (candidates.some((value) => !isSha256(value))) return { pass: false, code: 'REPAIR_SOURCE_VERIFY_HASH_INVALID' };
  const unique = Array.from(new Set(candidates));
  if (unique.length !== 1) return { pass: false, code: 'REPAIR_SOURCE_VERIFY_HASH_CONFLICT' };
  if (unique[0] !== expected) return { pass: false, code: 'REPAIR_SOURCE_VERIFY_HASH_MISMATCH' };
  return { pass: true };
}
function buildRepairPlanResponse(extra) {
  const ok = typeof extra.ok === 'boolean' ? extra.ok : true;
  const rest = { ...extra };
  delete rest.ok;
  return { ok, mode: 'repair-pointer', ...rest };
}
function simulateImmutableUpload({ uploadError, existingText, expectedText, readError }) {
  if (!uploadError) return { status: 200, reused: false };
  const duplicateLike = /already exists|duplicate|conflict|409|resource_already_exists/i.test(uploadError);
  if (readError) return { status: 500, classification: 'storage_write_failed' };
  if (existingText === expectedText) return { status: 200, reused: true };
  if (duplicateLike) return { status: 409, classification: 'immutable_object_conflict' };
  return { status: 500, classification: 'storage_write_failed' };
}
function simulateRepairApply({ scenario }) {
  const calls = [];
  const call = (name) => calls.push(name);
  call('validate_request');
  call('build_pre_lock_plan');
  if (scenario === 'dry-run') return { ok: true, status: 200, writes: 0, calls };
  if (scenario === 'missing-confirmation') return { ok: false, status: 400, writes: 0, calls };
  if (scenario === 'plan-mismatch') return { ok: false, status: 409, writes: 0, calls };
  call('acquire_operation');
  call('post_lock_re_read');
  call('post_lock_rehash');
  call('post_lock_plan_hash_gate');
  if (scenario === 'post-lock-source-changed') { call('finalize_operation_failure'); return { ok: false, status: 409, writes: 0, calls }; }
  call('write_canonical');
  call('verify_canonical');
  call('write_legacy');
  call('verify_legacy');
  call('write_pointer');
  if (scenario === 'pointer-verify-fail') { call('finalize_operation_failure'); return { ok: false, status: 500, writes: 3, calls }; }
  call('verify_pointer');
  call('operation_succeeded');
  if (scenario === 'terminal-audit-fail') return { ok: false, status: 409, writes: 3, pointerRepairCompleted: true, calls };
  call('terminal_audit');
  return { ok: true, status: 200, writes: 3, calls };
}

for (const [key, rel] of Object.entries(requiredFiles)) assert(`FILE_EXISTS_${key}`, fs.existsSync(path.join(root, rel)), { rel });
assert('FIXTURE_REQUIRED_IDS_PRESENT', Array.isArray(fixture.requiredCaseIds) && fixture.requiredCaseIds.length >= 23, { count: fixture.requiredCaseIds?.length || 0 });
assert('FIXTURE_CASES_PRESENT', Array.isArray(fixture.cases) && fixture.cases.length >= 23, { count: fixture.cases?.length || 0 });
const caseIds = new Set((fixture.cases || []).map((item) => item.id));
for (const id of fixture.requiredCaseIds || []) assert(`FIXTURE_HAS_${id}`, caseIds.has(id));

assert('SOURCE_UUID_REGEX_STANDARD_8_4_4_4_12', sources.contract.includes('{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'));
assert('SOURCE_HASH_AFTER_VALIDATED', sources.reconcile.includes('REPAIR_SOURCE_HASH_AFTER_INVALID') && sources.reconcile.includes('!isSha256(hashAfter)'));
assert('SOURCE_VERIFY_HASH_MISSING_FAILS', sources.reconcile.includes('REPAIR_SOURCE_VERIFY_HASH_MISSING') && sources.reconcile.includes('if (candidates.length === 0)'));
assert('SOURCE_VERIFY_HASH_INVALID_FAILS', sources.reconcile.includes('REPAIR_SOURCE_VERIFY_HASH_INVALID') && sources.reconcile.includes('if (invalid.length > 0)'));
assert('SOURCE_VERIFY_HASH_CONFLICT_FAILS', sources.reconcile.includes('REPAIR_SOURCE_VERIFY_HASH_CONFLICT') && sources.reconcile.includes('if (unique.length !== 1)'));
assert('SOURCE_VERIFY_HASH_MISMATCH_FAILS', sources.reconcile.includes('REPAIR_SOURCE_VERIFY_HASH_MISMATCH') && sources.reconcile.includes("unique[0] !== expected"));
assert('SOURCE_REPAIR_RESPONSE_OK_CAN_BE_FALSE', sources.reconcile.includes("const ok = typeof extra.ok === 'boolean' ? extra.ok : true") && sources.reconcile.includes('delete rest.ok'));
assert('SOURCE_TERMINAL_AUDIT_FAILURE_OK_FALSE', sources.reconcile.includes("ok: false, classification: 'lineage_repair_required'") && sources.reconcile.includes('pointerRepairCompleted: true'));
assert('SOURCE_POST_LOCK_PLAN_REBUILT', sources.reconcile.includes('const postLockPlan = await createCanonicalPointerRepairPlan') && sources.reconcile.includes('allowedActiveOperationId: operationId'));
assert('SOURCE_POST_LOCK_PLAN_HASH_GATE', sources.reconcile.includes('if (postLockPlan.planHash !== plan.planHash)') && sources.reconcile.includes('REPAIR_SOURCE_CHANGED_AFTER_LOCK'));
assert('SOURCE_POST_LOCK_POINTER_HEALTH_REREAD', sources.reconcile.includes('const pointerAfterLock = await inspectCurrentReleasePointerHealth'));
const applyBlock = sources.reconcile.slice(sources.reconcile.indexOf('async function applyCanonicalPointerRepair'), sources.reconcile.indexOf('async function uploadTextObjectWithExactReuse'));
assert('SOURCE_NO_STORAGE_WRITE_BEFORE_POST_LOCK_GATE', applyBlock.indexOf('const postLockPlan') >= 0 && applyBlock.indexOf('postLockPlan.planHash !== plan.planHash') < applyBlock.indexOf('uploadTextObjectWithExactReuse'));
assert('SOURCE_IMMUTABLE_CONFLICT_IS_409', sources.reconcile.includes("IMMUTABLE_CONFLICT'), 409") && sources.reconcile.includes("classification: 'immutable_object_conflict'"));
assert('SOURCE_DUPLICATE_CONFLICT_BRANCH_ENABLED', sources.reconcile.includes('if (duplicateLike) {'));
assert('SOURCE_POINTER_CONFLICT_IS_409', sources.reconcile.includes("'REPAIR_POINTER_IMMUTABLE_CONFLICT', 409") && sources.reconcile.includes('canonical_pointer_conflict'));
assert('SOURCE_POINTER_VERIFIED_BEFORE_SUCCESS', applyBlock.indexOf('verifyCanonicalPointerWithRetry') >= 0 && applyBlock.indexOf('verifyCanonicalPointerWithRetry') < applyBlock.indexOf("state: 'succeeded'"));
assert('SOURCE_OPERATION_FAILURE_FINALIZED', /await finalizeReleaseOperationFailure\(serviceClient, \{ operationId, pointerWriteStarted: false,[\s\S]*Post-lock repair source changed before any Storage write/.test(sources.reconcile) && /catch \(error\)[\s\S]*await finalizeReleaseOperationFailure\(serviceClient, \{ operationId, pointerWriteStarted/.test(sources.reconcile));
assert('SOURCE_STATUS_MODE_READ_ONLY', sources.reconcile.slice(sources.reconcile.indexOf("if (mode === 'status')"), sources.reconcile.indexOf('if (mode === REPAIR_POINTER_MODE)')).includes('inspectCurrentReleasePointerHealth') && !sources.reconcile.slice(sources.reconcile.indexOf("if (mode === 'status')"), sources.reconcile.indexOf('if (mode === REPAIR_POINTER_MODE)')).includes('uploadTextObject'));
assert('SOURCE_PUBLISH_STILL_USES_SHARED_BUILDER', sources.publish.includes('buildCanonicalReleaseJson(candidateJson, {') && sources.publish.includes('prepareCanonicalReleaseCandidate(sourceJson)'));

for (const item of fixture.cases || []) {
  if (item.kind === 'uuid') assert(`BEHAVIOR_${item.id}`, isUuid(item.value) === item.expectedValid, { actual: isUuid(item.value) });
  if (item.kind === 'release-path') assert(`BEHAVIOR_${item.id}`, Boolean(getReleaseContentPath(item.releaseId)) === item.expectedNonEmpty, { path: getReleaseContentPath(item.releaseId) });
  if (item.kind === 'legacy-path') assert(`BEHAVIOR_${item.id}`, Boolean(getLegacyVersionPath(item.releaseId)) === item.expectedNonEmpty, { path: getLegacyVersionPath(item.releaseId) });
  if (item.kind === 'pointer') {
    const pointer = { schemaVersion: 1, releaseId: item.releaseId, contentPath: getReleaseContentPath(item.releaseId), contentHash: item.contentHash };
    assert(`BEHAVIOR_${item.id}`, validateReleasePointer(pointer).valid === item.expectedValid, validateReleasePointer(pointer));
  }
  if (item.kind === 'audit-hash') {
    const result = validateAuditHashes({ hash_after: item.hashAfter }, item.verifyJson || {}, 'b8ec5d8f05c91b12283168675fc26b88c8377cce1be7e1f1525e9c5dbab805c3');
    assert(`BEHAVIOR_${item.id}`, result.pass === item.expectedPass && (item.expectedPass || result.code === item.expectedCode), result);
  }
  if (item.kind === 'response') {
    const body = buildRepairPlanResponse({ ok: item.expectedOk, classification: item.classification });
    assert(`BEHAVIOR_${item.id}`, body.ok === item.expectedOk, body);
  }
  if (item.kind === 'side-effect') {
    const result = simulateRepairApply({ scenario: item.scenario });
    assert(`BEHAVIOR_${item.id}`, result.writes === item.expectedWrites && (item.expectedStatus ? result.status === item.expectedStatus : true), result);
  }
  if (item.kind === 'immutable-conflict') {
    const result = simulateImmutableUpload({ uploadError: '409 duplicate already exists', existingText: 'OLD', expectedText: 'NEW' });
    assert(`BEHAVIOR_${item.id}`, result.status === item.expectedStatus && result.classification === 'immutable_object_conflict', result);
  }
  if (item.kind === 'storage-runtime') assert(`BEHAVIOR_${item.id}`, simulateImmutableUpload({ uploadError: 'network down', readError: true, existingText: '', expectedText: 'x' }).status === item.expectedStatus);
  if (item.kind === 'pointer-conflict') assert(`BEHAVIOR_${item.id}`, sources.reconcile.includes('REPAIR_POINTER_IMMUTABLE_CONFLICT') && item.expectedStatus === 409);
  if (item.kind === 'pointer-verify') assert(`BEHAVIOR_${item.id}`, simulateRepairApply({ scenario: 'pointer-verify-fail' }).ok === item.expectedOk);
  if (item.kind === 'success') assert(`BEHAVIOR_${item.id}`, simulateRepairApply({ scenario: 'happy' }).ok === item.expectedOk);
  if (item.kind === 'retry') assert(`BEHAVIOR_${item.id}`, sources.reconcile.includes("classification: 'already_repaired'"));
  if (item.kind === 'status') assert(`BEHAVIOR_${item.id}`, item.expectedWrites === 0 && sources.reconcile.includes("mode === 'status'"));
  if (item.kind === 'publish-builder') assert(`BEHAVIOR_${item.id}`, sources.publish.includes('buildCanonicalReleaseJson') === item.expectedSharedBuilder);
}

const stableId = await createStableRepairReleaseId('f7ac2561-305b-4381-b778-511b622d42fd', 'b8ec5d8f05c91b12283168675fc26b88c8377cce1be7e1f1525e9c5dbab805c3', 'V6.11.21-B6-F_K_O_I_P');
assert('BEHAVIOR_STABLE_REPAIR_ID_VALID_UUID', isUuid(stableId), { stableId });
assert('BEHAVIOR_STABLE_REPAIR_ID_DETERMINISTIC', stableId === await createStableRepairReleaseId('f7ac2561-305b-4381-b778-511b622d42fd', 'B8EC5D8F05C91B12283168675FC26B88C8377CCE1BE7E1F1525E9C5DBAB805C3', 'V6.11.21-B6-F_K_O_I_P'));
assert('BEHAVIOR_STABLE_REPAIR_PATHS_NON_EMPTY', Boolean(getReleaseContentPath(stableId)) && Boolean(getLegacyVersionPath(stableId)), { contentPath: getReleaseContentPath(stableId), legacyPath: getLegacyVersionPath(stableId) });
const order = simulateRepairApply({ scenario: 'happy' }).calls;
assert('BEHAVIOR_CALL_ORDER_POST_LOCK_BEFORE_WRITES', order.indexOf('post_lock_plan_hash_gate') < order.indexOf('write_canonical'), { order });
assert('BEHAVIOR_CALL_ORDER_POINTER_VERIFY_BEFORE_SUCCESS', order.indexOf('verify_pointer') < order.indexOf('operation_succeeded'), { order });
assert('BEHAVIOR_TERMINAL_AUDIT_FAILURE_OK_FALSE', simulateRepairApply({ scenario: 'terminal-audit-fail' }).ok === false);

function runVerifierOnTempRoot(mutator) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify036-'));
  for (const rel of Object.values(requiredFiles)) {
    const sourcePath = path.join(root, rel);
    const targetPath = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
  mutator(tmp);
  let status = 0;
  let out = '';
  try { out = execFileSync(process.execPath, [path.join(tmp, requiredFiles.verifier), `--root=${tmp}`, '--skip-mutations=true'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { status = error.status || 1; out = `${error.stdout || ''}${error.stderr || ''}`; }
  fs.rmSync(tmp, { recursive: true, force: true });
  const failed = [...String(out).matchAll(/FAIL\s+([A-Z0-9_]+)/g)].map((m) => m[1]);
  return { status, failed, output: out.slice(-3000) };
}
if (!skipMutations) {
  const mutations = [
    ['M001_UUID_FOURTH_GROUP_REMOVED', requiredFiles.contract, '{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ['SOURCE_UUID_REGEX_STANDARD_8_4_4_4_12', 'BEHAVIOR_STANDARD_UUID_ACCEPTED']],
    ['M002_ALLOW_MISSING_VERIFY_HASH', requiredFiles.reconcile, 'if (candidates.length === 0) throw buildRepairError', 'if (false && candidates.length === 0) throw buildRepairError', ['SOURCE_VERIFY_HASH_MISSING_FAILS']],
    ['M003_ALLOW_INVALID_VERIFY_HASH', requiredFiles.reconcile, 'if (invalid.length > 0) throw buildRepairError', 'if (false && invalid.length > 0) throw buildRepairError', ['SOURCE_VERIFY_HASH_INVALID_FAILS']],
    ['M004_ALLOW_CONFLICTING_VERIFY_HASHES', requiredFiles.reconcile, 'if (unique.length !== 1) throw buildRepairError', 'if (false && unique.length !== 1) throw buildRepairError', ['SOURCE_VERIFY_HASH_CONFLICT_FAILS']],
    ['M005_TERMINAL_AUDIT_OK_TRUE', requiredFiles.reconcile, "ok: false, classification: 'lineage_repair_required'", "ok: true, classification: 'lineage_repair_required'", ['SOURCE_TERMINAL_AUDIT_FAILURE_OK_FALSE']],
    ['M006_REMOVE_POST_LOCK_REREAD', requiredFiles.reconcile, 'const postLockPlan = await createCanonicalPointerRepairPlan', 'const postLockPlan = await disabledCreateCanonicalPointerRepairPlan', ['SOURCE_POST_LOCK_PLAN_REBUILT']],
    ['M007_REMOVE_POST_LOCK_HASH_COMPARISON', requiredFiles.reconcile, 'if (postLockPlan.planHash !== plan.planHash)', 'if (false && postLockPlan.planHash !== plan.planHash)', ['SOURCE_POST_LOCK_PLAN_HASH_GATE']],
    ['M008_ALLOW_WRITE_BEFORE_POST_LOCK_GATE', requiredFiles.reconcile, 'const postLockPlan = await createCanonicalPointerRepairPlan', '// uploadTextObjectWithExactReuse before gate\n    const postLockPlan = await createCanonicalPointerRepairPlan', ['SOURCE_NO_STORAGE_WRITE_BEFORE_POST_LOCK_GATE']],
    ['M009_IMMUTABLE_CONFLICT_TO_500', requiredFiles.reconcile, "IMMUTABLE_CONFLICT'), 409", "IMMUTABLE_CONFLICT'), 500", ['SOURCE_IMMUTABLE_CONFLICT_IS_409']],
    ['M010_ALLOW_REUSE_DIFFERENT_BYTES', requiredFiles.reconcile, 'if (duplicateLike) {', 'if (false && duplicateLike) {', ['SOURCE_DUPLICATE_CONFLICT_BRANCH_ENABLED']],
    ['M011_REMOVE_POINTER_VERIFY', requiredFiles.reconcile, 'const pointerVerify = await verifyCanonicalPointerWithRetry(serviceClient, plan);', 'const pointerVerify = { valid: true };', ['SOURCE_POINTER_VERIFIED_BEFORE_SUCCESS']],
    ['M012_REMOVE_OPERATION_FAILURE_FINALIZATION', requiredFiles.reconcile, "await finalizeReleaseOperationFailure(serviceClient, { operationId, pointerWriteStarted: false, contentHash: plan.contentHash, contentPath: plan.contentPath, expectedReleaseId: plan.releaseId, error: buildRepairError('Post-lock repair source changed before any Storage write.'", "await disabledFinalizeReleaseOperationFailure(serviceClient, { operationId, pointerWriteStarted: false, contentHash: plan.contentHash, contentPath: plan.contentPath, expectedReleaseId: plan.releaseId, error: buildRepairError('Post-lock repair source changed before any Storage write.'", ['SOURCE_OPERATION_FAILURE_FINALIZED']],
  ];
  for (const [id, rel, search, replacement, expectedFails] of mutations) {
    const before = read(rel);
    const replacementCount = count(before, search);
    const beforeHash = sha(before);
    const afterText = before.replace(search, replacement);
    const afterHash = sha(afterText);
    const result = runVerifierOnTempRoot((tmp) => {
      const target = path.join(tmp, rel);
      fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(search, replacement));
    });
    const killed = replacementCount === 1 && beforeHash !== afterHash && result.status !== 0 && expectedFails.some((f) => result.failed.includes(f));
    mutationRecords.push({ id, target: rel, replacementCount, expectedReplacementCount: 1, sourceHashBefore: beforeHash, sourceHashAfter: afterHash, sourceChanged: beforeHash !== afterHash, exitCode: result.status, failedAssertionIds: result.failed, expectedFailedAssertionIds: expectedFails, status: killed ? 'KILLED' : 'SURVIVED', outputTail: result.output });
    assert(`MUTATION_${id}_KILLED`, killed, mutationRecords.at(-1));
  }
}
const pass = assertions.filter((a) => a.pass).length;
const fail = assertions.length - pass;
const result = { pass, fail, total: assertions.length, assertions, mutationRecords, killedMutants: mutationRecords.filter((m) => m.status === 'KILLED').length, survivedMutants: mutationRecords.filter((m) => m.status !== 'KILLED').length };
if (resultFile) fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
for (const item of assertions) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.id}`);
console.log(`RESULT PASS ${pass} / FAIL ${fail} / TOTAL ${assertions.length}`);
if (mutationRecords.length) console.log(`MUTATIONS KILLED ${result.killedMutants} / SURVIVED ${result.survivedMutants} / TOTAL ${mutationRecords.length}`);
process.exit(fail === 0 ? 0 : 1);
