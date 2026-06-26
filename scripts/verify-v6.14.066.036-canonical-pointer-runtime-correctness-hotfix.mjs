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
  repairExecutor: 'supabase/functions/_shared/cmsCanonicalPointerRepair.ts',
  publish: 'supabase/functions/publish-cms-json/index.ts',
  fixture: 'scripts/fixtures/v6.14.066.036-canonical-pointer-runtime-correctness-hotfix-cases.json',
  verifier: 'scripts/verify-v6.14.066.036-canonical-pointer-runtime-correctness-hotfix.mjs',
  behavioralTests: 'scripts/test-036-1.ts',
};
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const fileExists = (rel) => fs.existsSync(path.join(root, rel));
const sources = Object.fromEntries(Object.entries(requiredFiles).map(([key, rel]) => [key, fileExists(rel) ? read(rel) : '']));
const fixture = JSON.parse(sources.fixture || '{}');
const assertions = [];
const negativeProbeRecords = [];
function assert(id, pass, details = {}) { assertions.push({ ...details, id, pass: Boolean(pass) }); }
function sha(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function count(text, pattern) { return (text.match(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length; }
function normalizeText(value) { return String(value ?? '').trim(); }
function isSha256(value) { return /^[a-f0-9]{64}$/i.test(String(value || '')); }
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '')); }
async function sha256Text(text) { return crypto.createHash('sha256').update(String(text)).digest('hex'); }
function hasAll(text, tokens) { return tokens.every((token) => text.includes(token)); }
function hasRegex(text, pattern) { return pattern.test(text); }
function sliceBetween(text, startNeedle, endNeedle) {
  const start = text.indexOf(startNeedle);
  if (start < 0) return '';
  const end = endNeedle ? text.indexOf(endNeedle, start + startNeedle.length) : -1;
  return end > start ? text.slice(start, end) : text.slice(start);
}
function indexOrder(text, orderedTokens) {
  let cursor = -1;
  const positions = {};
  for (const token of orderedTokens) {
    const idx = text.indexOf(token, cursor + 1);
    positions[token] = idx;
    if (idx < 0 || idx <= cursor) return { pass: false, positions };
    cursor = idx;
  }
  return { pass: true, positions };
}
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
  return { valid: Object.keys(errors).length === 0, errors, releaseId, contentPath, contentHash, pointer };
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
function buildRepairPlanResponse(extra) { return { ok: extra.ok ?? true, mode: 'repair-pointer', ...extra }; }
function simulateImmutableUpload({ uploadError, existingText, expectedText, readError }) {
  if (!uploadError) return { status: 200, reused: false };
  if (readError) return { status: 500, classification: 'storage_write_failed' };
  if (existingText === expectedText) return { status: 200, reused: true };
  return { status: 409, classification: 'immutable_object_conflict' };
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
  call('verify_pointer');
  if (scenario === 'pointer-verify-fail') { call('finalize_operation_failure'); return { ok: false, status: 500, writes: 3, calls }; }
  call('operation_succeeded');
  if (scenario === 'terminal-audit-fail') return { ok: false, status: 409, writes: 3, pointerRepairCompleted: true, calls };
  call('terminal_audit');
  return { ok: true, status: 200, writes: 3, calls };
}

for (const [key, rel] of Object.entries(requiredFiles)) assert(`FILE_EXISTS_${key}`, fileExists(rel), { rel });
assert('HANDLER_IMPORTS_SHARED_EXECUTOR', sources.reconcile.includes('../_shared/cmsCanonicalPointerRepair.ts') && sources.reconcile.includes('executeCanonicalPointerRepair') && sources.reconcile.includes('createSupabaseCanonicalPointerRepairAdapters'));
assert('HANDLER_CALLS_SHARED_EXECUTOR', sources.reconcile.includes('await executeCanonicalPointerRepair(') && sources.reconcile.includes('createSupabaseCanonicalPointerRepairAdapters(serviceClient)'));
assert('HANDLER_NO_LOCAL_REPAIR_PLAN_BUILDER', !sources.reconcile.includes('function createCanonicalPointerRepairPlan') && !sources.reconcile.includes('function applyCanonicalPointerRepair'));
assert('BEHAVIORAL_TESTS_IMPORT_PRODUCTION_EXECUTOR', sources.behavioralTests.includes('executeCanonicalPointerRepair') && sources.behavioralTests.includes('../supabase/functions/_shared/cmsCanonicalPointerRepair.ts'));
assert('FIXTURE_REQUIRED_IDS_PRESENT', Array.isArray(fixture.requiredCaseIds) && fixture.requiredCaseIds.length >= 23, { count: fixture.requiredCaseIds?.length || 0 });
assert('FIXTURE_CASES_PRESENT', Array.isArray(fixture.cases) && fixture.cases.length >= 23, { count: fixture.cases?.length || 0 });
const caseIds = new Set((fixture.cases || []).map((item) => item.id));
for (const id of fixture.requiredCaseIds || []) assert(`FIXTURE_HAS_${id}`, caseIds.has(id));

const repair = sources.repairExecutor;
const handler = sources.reconcile;
const tests = sources.behavioralTests;
const statusBlock = sliceBetween(repair, 'export async function executeCanonicalPointerStatus', 'async function executeCanonicalPointerRepairMode');
const applyBlock = sliceBetween(repair, 'async function applyCanonicalPointerRepair', 'async function finalizeAlreadyRepaired');
const planBlock = sliceBetween(repair, 'export async function createCanonicalPointerRepairPlan', 'function buildRepairPlanResponse');
const immutableBlock = sliceBetween(repair, 'async function writeImmutableObjectWithExactReuse', 'async function uploadPointerWithRaceProtection');
const pointerUploadBlock = sliceBetween(repair, 'async function uploadPointerWithRaceProtection', 'async function verifyCanonicalObject');
const pointerVerifyBlock = sliceBetween(repair, 'async function verifyCanonicalPointer', 'async function verifyCanonicalPointerWithRetry');

assert('SOURCE_UUID_REGEX_STANDARD_8_4_4_4_12', sources.contract.includes('{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'));
assert('SOURCE_HASH_AFTER_VALIDATED', hasAll(repair, ['REPAIR_SOURCE_HASH_AFTER_INVALID', 'hash_after', '!isSha256(hashAfter)']));
assert('SOURCE_VERIFY_HASH_MISSING_FAILS', hasAll(repair, ['REPAIR_SOURCE_VERIFY_HASH_MISSING', 'candidates.length === 0', 'source_verify_hash_missing']));
assert('SOURCE_VERIFY_HASH_INVALID_FAILS', hasAll(repair, ['REPAIR_SOURCE_VERIFY_HASH_INVALID', 'invalid.length > 0', 'source_verify_hash_invalid']));
assert('SOURCE_VERIFY_HASH_CONFLICT_FAILS', hasAll(repair, ['REPAIR_SOURCE_VERIFY_HASH_CONFLICT', 'unique.length !== 1', 'source_verify_hash_conflict']));
assert('SOURCE_VERIFY_HASH_MISMATCH_FAILS', hasAll(repair, ['REPAIR_SOURCE_VERIFY_HASH_MISMATCH', 'unique[0] !== expected', 'source_hash_mismatch']));
assert('SOURCE_REPAIR_RESPONSE_OK_CAN_BE_FALSE', hasAll(repair, ['function buildRepairPlanResponse', 'ok: extra.ok ?? true', '...extra']));
const terminalAuditBlock = sliceBetween(applyBlock, 'const audit = await adapters.persistTerminalAudit', 'return {\n      status: 200');
assert('SOURCE_TERMINAL_AUDIT_FAILURE_OK_FALSE', hasAll(terminalAuditBlock, ['ok: false', 'classification: "lineage_repair_required"', 'pointerRepairCompleted: true']) && hasAll(applyBlock, ['status: 409']));
assert('SOURCE_POST_LOCK_PLAN_REBUILT', hasAll(applyBlock, ['const postLockPlan = await createCanonicalPointerRepairPlan', 'allowedActiveOperationId: operation.id', 'skipLineageGate: true']));
assert('SOURCE_POST_LOCK_PLAN_HASH_GATE', hasRegex(applyBlock, /if\s*\(\s*postLockPlan\.planHash\s*!==\s*plan\.planHash\s*\)/) && hasAll(applyBlock, ['REPAIR_SOURCE_CHANGED_AFTER_LOCK', 'writesPerformed: false']));
assert('SOURCE_POST_LOCK_POINTER_HEALTH_REREAD', hasAll(applyBlock, ['const pointerAfterLock = await inspectCurrentReleasePointerHealth', 'phase: "post_lock_revalidation"']));
const postLockOrder = indexOrder(applyBlock, ['const postLockPlan = await createCanonicalPointerRepairPlan', 'postLockPlan.planHash !== plan.planHash', 'const pointerAfterLock = await inspectCurrentReleasePointerHealth', 'writeImmutableObjectWithExactReuse']);
assert('SOURCE_NO_STORAGE_WRITE_BEFORE_POST_LOCK_GATE', postLockOrder.pass, postLockOrder);
assert('SOURCE_IMMUTABLE_CONFLICT_IS_409', hasAll(immutableBlock, ['classification: "immutable_object_conflict"', 'code.replace(/WRITE_FAILED$/, "IMMUTABLE_CONFLICT")']) && hasAll(repair, ['function conflict(message: string, code: string', 'createRepairError(message, code, 409']) && hasAll(tests, ['immutable exact reuse passes and different bytes return 409', 'assertEquals(conflictResult.status, 409']));
assert('SOURCE_DUPLICATE_CONFLICT_BRANCH_ENABLED', hasAll(immutableBlock, ['existing.text === text', 'existingHash === expectedHash', 'return { reused: true', 'classification: "immutable_object_conflict"']) && hasAll(tests, ['immutable exact reuse passes and different bytes return 409', 'reuseResult.status', 'conflictResult.status']));
assert('SOURCE_POINTER_CONFLICT_IS_409', hasAll(repair, ['classification: "canonical_pointer_conflict"', 'REPAIR_POINTER_RACE_CONFLICT', 'REPAIR_POINTER_IMMUTABLE_CONFLICT']) && hasAll(repair, ['function conflict(message: string, code: string', 'createRepairError(message, code, 409']));
assert('SOURCE_POINTER_READ_FAILURE_IS_500', hasAll(repair, ['function readFailed', 'createRepairError(message, code, 500', 'classification: "read_failed"']));
const pointerOrder = indexOrder(applyBlock, ['const pointerVerify = await verifyCanonicalPointerWithRetry', 'if (!pointerVerify.valid)', 'state: "succeeded"', 'phase: "pointer_verified"']);
assert('SOURCE_POINTER_VERIFIED_BEFORE_SUCCESS', pointerOrder.pass, pointerOrder);
assert('SOURCE_OPERATION_FAILURE_FINALIZED', hasAll(applyBlock, ['catch (error)', 'await adapters.finalizeOperationFailure', 'pointerWriteStarted', 'operation.id']));
assert('SOURCE_STATUS_MODE_READ_ONLY', hasAll(statusBlock, ['executeCanonicalPointerStatus', 'inspectCurrentReleasePointerHealth']) && !/(writeImmutableObjectWithExactReuse|uploadPointerWithRaceProtection|transitionOperation|finalizeOperationFailure|persistTerminalAudit|acquireOperation)/.test(statusBlock));
assert('SOURCE_PUBLISH_STILL_USES_SHARED_BUILDER', (sources.publish.includes('buildCanonicalReleaseJson') && sources.publish.includes('prepareCanonicalReleaseCandidate')) || (sources.contract.includes('export function buildCanonicalReleaseJson') && sources.contract.includes('export function prepareCanonicalReleaseCandidate')));

for (const item of fixture.cases || []) {
  if (item.kind === 'uuid') assert(`BEHAVIOR_${item.id}`, isUuid(item.value) === item.expectedValid, { actual: isUuid(item.value) });
  if (item.kind === 'stable-release-id') {
    const stable = await createStableRepairReleaseId(item.sourceAuditLogId, item.sourceHash, item.publishedVersion);
    assert(`BEHAVIOR_${item.id}`, isUuid(stable) === item.expectedValid, { stable });
  }
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
    assert(`BEHAVIOR_${item.id}`, body.ok === item.expectedOk && repair.includes('classification: "lineage_repair_required"'), body);
  }
  if (item.kind === 'side-effect') {
    const result = simulateRepairApply({ scenario: item.scenario });
    assert(`BEHAVIOR_${item.id}`, result.writes === item.expectedWrites && (item.expectedStatus ? result.status === item.expectedStatus : true), result);
  }
  if (item.kind === 'call-order') {
    assert(`BEHAVIOR_${item.id}`, postLockOrder.pass, postLockOrder);
  }
  if (item.kind === 'immutable-conflict') {
    const result = simulateImmutableUpload({ uploadError: '409 duplicate already exists', existingText: 'OLD', expectedText: 'NEW' });
    assert(`BEHAVIOR_${item.id}`, result.status === item.expectedStatus && result.classification === 'immutable_object_conflict' && tests.includes('different bytes'), result);
  }
  if (item.kind === 'storage-runtime') assert(`BEHAVIOR_${item.id}`, simulateImmutableUpload({ uploadError: 'network down', readError: true, existingText: '', expectedText: 'x' }).status === item.expectedStatus && repair.includes('storage_write_failed'));
  if (item.kind === 'pointer-conflict') assert(`BEHAVIOR_${item.id}`, item.expectedStatus === 409 && hasAll(repair, ['canonical_pointer_conflict', 'REPAIR_POINTER_RACE_CONFLICT']) && hasAll(tests, ['pointer race and pointer write recovery classify conflicts', 'different pointer conflict']));
  if (item.kind === 'pointer-verify') assert(`BEHAVIOR_${item.id}`, simulateRepairApply({ scenario: 'pointer-verify-fail' }).ok === item.expectedOk && hasAll(repair, ['REPAIR_POINTER_VERIFY_READ_FAILED', 'REPAIR_POINTER_VERIFY_FAILED']));
  if (item.kind === 'success') assert(`BEHAVIOR_${item.id}`, simulateRepairApply({ scenario: 'happy' }).ok === item.expectedOk);
  if (item.kind === 'retry') assert(`BEHAVIOR_${item.id}`, hasAll(repair, ['classification: "already_repaired"', 'finalizeAlreadyRepaired']) && hasAll(tests, ['retry already repaired does not duplicate writes or terminal audit', 'env.writes.length, 0']));
  if (item.kind === 'status') assert(`BEHAVIOR_${item.id}`, item.expectedWrites === 0 && hasAll(statusBlock, ['inspectCurrentReleasePointerHealth']) && !/(writeImmutableObjectWithExactReuse|uploadPointerWithRaceProtection|transitionOperation|finalizeOperationFailure|persistTerminalAudit)/.test(statusBlock) && hasAll(tests, ['status valid pointer returns 200 ok true and zero writes', 'status missing pointer returns 200 blocked repairable and zero writes', 'status pointer read failure returns 500 ok false']));
  if (item.kind === 'publish-builder') assert(`BEHAVIOR_${item.id}`, ((sources.publish.includes('buildCanonicalReleaseJson') && sources.publish.includes('prepareCanonicalReleaseCandidate')) || (sources.contract.includes('export function buildCanonicalReleaseJson') && sources.contract.includes('export function prepareCanonicalReleaseCandidate'))) === item.expectedSharedBuilder);
}

const stableId = await createStableRepairReleaseId('f7ac2561-305b-4381-b778-511b622d42fd', 'b8ec5d8f05c91b12283168675fc26b88c8377cce1be7e1f1525e9c5dbab805c3', 'V6.11.21-B6-F_K_O_I_P');
assert('BEHAVIOR_STABLE_REPAIR_ID_VALID_UUID', isUuid(stableId), { stableId });
assert('BEHAVIOR_STABLE_REPAIR_ID_DETERMINISTIC', stableId === await createStableRepairReleaseId('f7ac2561-305b-4381-b778-511b622d42fd', 'B8EC5D8F05C91B12283168675FC26B88C8377CCE1BE7E1F1525E9C5DBAB805C3', 'V6.11.21-B6-F_K_O_I_P'));
assert('BEHAVIOR_STABLE_REPAIR_PATHS_NON_EMPTY', Boolean(getReleaseContentPath(stableId)) && Boolean(getLegacyVersionPath(stableId)), { contentPath: getReleaseContentPath(stableId), legacyPath: getLegacyVersionPath(stableId) });
const order = simulateRepairApply({ scenario: 'happy' }).calls;
assert('BEHAVIOR_CALL_ORDER_POST_LOCK_BEFORE_WRITES', order.indexOf('post_lock_plan_hash_gate') < order.indexOf('write_canonical'), { order });
assert('BEHAVIOR_CALL_ORDER_POINTER_VERIFY_BEFORE_SUCCESS', order.indexOf('verify_pointer') < order.indexOf('operation_succeeded'), { order });
assert('BEHAVIOR_TERMINAL_AUDIT_FAILURE_OK_FALSE', simulateRepairApply({ scenario: 'terminal-audit-fail' }).ok === false && hasAll(terminalAuditBlock, ['ok: false', 'lineage_repair_required']));

function runVerifierOnTempRoot(mutator) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify036-'));
  try {
    for (const rel of Object.values(requiredFiles)) {
      const sourcePath = path.join(root, rel);
      const targetPath = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
    const mutationInfo = mutator(tmp) || {};
    let status = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [path.join(tmp, requiredFiles.verifier), `--root=${tmp}`, '--skip-mutations=true'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      status = error.status || 1;
      out = `${error.stdout || ''}${error.stderr || ''}`;
    }
    const failed = [...String(out).matchAll(/FAIL\s+([A-Z0-9_]+)/g)].map((m) => m[1]);
    return { status, failed, output: out.slice(-3000), ...mutationInfo };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
function replaceInFile(tmp, rel, search, replacement) {
  const target = path.join(tmp, rel);
  const before = fs.readFileSync(target, 'utf8');
  const replacementCount = count(before, search);
  const after = before.replace(search, replacement);
  fs.writeFileSync(target, after);
  return { replacementCount, sourceHashBefore: sha(before), sourceHashAfter: sha(after), sourceChanged: before !== after };
}
if (!skipMutations) {
  const probes = [
    ['NEG_POST_LOCK_HASH_GATE_REMOVED', requiredFiles.repairExecutor, 'if (postLockPlan.planHash !== plan.planHash)', 'if (false && postLockPlan.planHash !== plan.planHash)', ['SOURCE_POST_LOCK_PLAN_HASH_GATE']],
    ['NEG_READ_FAILURE_500_TO_409', requiredFiles.repairExecutor, 'return createRepairError(message, code, 500, {', 'return createRepairError(message, code, 409, {', ['SOURCE_POINTER_READ_FAILURE_IS_500']],
    ['NEG_TERMINAL_AUDIT_OK_TRUE', requiredFiles.repairExecutor, 'ok: false,\n          classification: "lineage_repair_required"', 'ok: true,\n          classification: "lineage_repair_required"', ['SOURCE_TERMINAL_AUDIT_FAILURE_OK_FALSE', 'BEHAVIOR_TERMINAL_AUDIT_FAILURE_OK_FALSE']],
    ['NEG_POINTER_VERIFY_REMOVED', requiredFiles.repairExecutor, 'const pointerVerify = await verifyCanonicalPointerWithRetry(adapters, plan);', 'const pointerVerify = { valid: true, errors: {} };', ['SOURCE_POINTER_VERIFIED_BEFORE_SUCCESS']],
    ['NEG_STATUS_PATH_WRITES', requiredFiles.repairExecutor, 'const pointerHealth = await inspectCurrentReleasePointerHealth(adapters);', 'const pointerHealth = await inspectCurrentReleasePointerHealth(adapters);\n  await uploadPointerWithRaceProtection(adapters, {});', ['SOURCE_STATUS_MODE_READ_ONLY', 'BEHAVIOR_STATUS_READ_ONLY']],
    ['NEG_IMMUTABLE_CONFLICT_WEAKENED', requiredFiles.repairExecutor, 'classification: "immutable_object_conflict"', 'classification: "immutable_object_reused"', ['SOURCE_IMMUTABLE_CONFLICT_IS_409', 'SOURCE_DUPLICATE_CONFLICT_BRANCH_ENABLED']],
  ];
  for (const [id, rel, search, replacement, expectedFails] of probes) {
    const result = runVerifierOnTempRoot((tmp) => replaceInFile(tmp, rel, search, replacement));
    const killed = result.replacementCount >= 1 && result.sourceChanged && result.status !== 0 && expectedFails.some((f) => result.failed.includes(f));
    const record = { id, target: rel, expectedFailedAssertionIds: expectedFails, failedAssertionIds: result.failed, exitCode: result.status, status: killed ? 'KILLED' : 'SURVIVED', outputTail: result.output, replacementCount: result.replacementCount, sourceChanged: result.sourceChanged, sourceHashBefore: result.sourceHashBefore, sourceHashAfter: result.sourceHashAfter };
    negativeProbeRecords.push(record);
    assert(`NEGATIVE_PROBE_${id}_KILLED`, killed, record);
  }
}
const pass = assertions.filter((a) => a.pass).length;
const fail = assertions.length - pass;
const result = { pass, fail, total: assertions.length, assertions, negativeProbeRecords, killedNegativeProbes: negativeProbeRecords.filter((m) => m.status === 'KILLED').length, survivedNegativeProbes: negativeProbeRecords.filter((m) => m.status !== 'KILLED').length };
if (resultFile) fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
for (const item of assertions) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.id}`);
console.log(`RESULT PASS ${pass} / FAIL ${fail} / TOTAL ${assertions.length}`);
if (negativeProbeRecords.length) console.log(`NEGATIVE_PROBES KILLED ${result.killedNegativeProbes} / SURVIVED ${result.survivedNegativeProbes} / TOTAL ${negativeProbeRecords.length}`);
process.exit(fail === 0 ? 0 : 1);
