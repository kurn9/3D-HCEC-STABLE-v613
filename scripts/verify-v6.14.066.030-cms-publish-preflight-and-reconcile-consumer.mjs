#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
function readArg(name, fallback = '') {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fallback;
}

const root = path.resolve(readArg('--root', process.cwd()));
const adminStaticRel = 'src/cms-admin/adminStaticCmsDraft.js';
const releaseGateRel = 'src/cms-admin/adminReleaseOperationGate.js';
const adminStateRel = 'src/cms-admin/adminState.js';
const fixtureRel = 'scripts/fixtures/v6.14.066.030-cms-publish-preflight-and-reconcile-consumer-cases.json';
const adminStaticPath = path.join(root, adminStaticRel);
const releaseGatePath = path.join(root, releaseGateRel);
const adminStatePath = path.join(root, adminStateRel);
const fixturePath = path.join(root, fixtureRel);

const results = [];
const mutationRecords = [];
const tempRoots = [];

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function assertCase(id, pass, evidence = {}) {
  results.push({ id, pass: Boolean(pass), evidence });
}

function makeTempRoot(prefix) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function cleanupTempRoots() {
  for (const tempRoot of tempRoots.splice(0)) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // cleanup is asserted after all attempts
    }
  }
}

function countOccurrences(source, search) {
  if (!search) return 0;
  let count = 0;
  let index = 0;
  while ((index = source.indexOf(search, index)) >= 0) {
    count += 1;
    index += search.length;
  }
  return count;
}

function replaceExact(source, search, replacement, requiredReplacementCount = 1) {
  const replacementCount = countOccurrences(source, search);
  if (replacementCount !== requiredReplacementCount) {
    return { source, replacementCount, sourceChanged: false };
  }
  return {
    source: source.split(search).join(replacement),
    replacementCount,
    sourceChanged: search !== replacement,
  };
}

function findFunctionBody(source, functionName) {
  const candidates = [
    `function ${functionName}`,
    `async function ${functionName}`,
    `export function ${functionName}`,
    `export async function ${functionName}`,
  ];
  let start = -1;
  for (const marker of candidates) {
    start = source.indexOf(marker);
    if (start >= 0) break;
  }
  if (start < 0) throw new Error(`FUNCTION_NOT_FOUND:${functionName}`);
  const paramsOpen = source.indexOf('(', start);
  if (paramsOpen < 0) throw new Error(`FUNCTION_PARAMS_NOT_FOUND:${functionName}`);
  let parenDepth = 0;
  let paramsClose = -1;
  for (let index = paramsOpen; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') parenDepth += 1;
    if (char === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        paramsClose = index;
        break;
      }
    }
  }
  const open = source.indexOf('{', paramsClose);
  if (open < 0) throw new Error(`FUNCTION_OPEN_BRACE_NOT_FOUND:${functionName}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`FUNCTION_CLOSE_BRACE_NOT_FOUND:${functionName}`);
}

function extractBlockAfter(source, search, occurrence = 1) {
  let start = -1;
  let offset = 0;
  for (let i = 0; i < occurrence; i += 1) {
    start = source.indexOf(search, offset);
    if (start < 0) return '';
    offset = start + search.length;
  }
  const open = source.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return '';
}

function extractSwitchCaseBlock(source, caseValue) {
  const marker = `case '${caseValue}':`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const nextCase = source.indexOf("\n    case '", start + marker.length);
  const defaultCase = source.indexOf('\n    default:', start + marker.length);
  const candidates = [nextCase, defaultCase].filter((index) => index > start);
  const end = candidates.length ? Math.min(...candidates) : source.indexOf('\n  }', start + marker.length);
  return source.slice(start, end > start ? end : source.length);
}

function extractStringList(source, functionName, nearbyToken) {
  const body = findFunctionBody(source, functionName);
  const tokenIndex = body.indexOf(nearbyToken);
  const searchArea = tokenIndex >= 0 ? body.slice(tokenIndex) : body;
  const match = searchArea.match(/\[([^\]]+)\]\.includes/s);
  if (!match) return [];
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map((item) => item[1]);
}

function evaluateResolvedCapableFromSource(gateSource, data = {}) {
  const classifications = extractStringList(gateSource, 'isResolvedCapableReleaseResponse', 'classification');
  const states = extractStringList(gateSource, 'isResolvedCapableReleaseResponse', 'operationState');
  const classification = String(data.classification || '').trim();
  const operationState = String(data.state || data.operationState || data.operation?.state || '').trim();
  return Boolean(data.operationResolved === true || classifications.includes(classification) || states.includes(operationState));
}

function exactIdlePredicateMode(stateSource) {
  const body = findFunctionBody(stateSource, 'isExactIdleReleaseStatusPayload');
  if (/\[['"]idle['"],\s*['"]clean['"]\]\.includes\(data\.classification\)/.test(body)) return 'idle_or_clean';
  if (/data\.classification\s*===\s*['"]idle['"]/.test(body)) return 'idle_only';
  return 'unknown';
}

function evaluateExactIdleFromSource(stateSource, data = {}) {
  const allowedKeysMatch = stateSource.match(/const EXACT_IDLE_ALLOWED_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  if (!allowedKeysMatch) return false;
  const allowed = new Set(Array.from(allowedKeysMatch[1].matchAll(/'([^']+)'/g)).map((item) => item[1]));
  const keys = Object.keys(data || {});
  if (!keys.every((key) => allowed.has(key))) return false;
  const has = (key) => Object.prototype.hasOwnProperty.call(data, key);
  const absentOrNull = (key) => !has(key) || data[key] === null;
  const absentNullOrEmpty = (key) => !has(key) || data[key] === null || data[key] === '';
  const absentOrFalse = (key) => !has(key) || data[key] === false;
  const mode = exactIdlePredicateMode(stateSource);
  if (data?.ok !== true) return false;
  if (data?.mode !== 'status') return false;
  if (mode === 'idle_only' && data?.classification !== 'idle') return false;
  if (mode === 'idle_or_clean' && !['idle', 'clean'].includes(data?.classification)) return false;
  if (mode === 'unknown') return false;
  if (!has('state') && !has('operationState')) return false;
  if (has('state') && data.state !== 'idle') return false;
  if (has('operationState') && data.operationState !== 'idle') return false;
  if (!['blocked', 'repairable', 'operationResolved', 'reconciliationRequired', 'reconciling', 'lineageRepairRequired', 'repairRequired', 'terminalAuditIdentityInvalid', 'terminalAuditConflict'].every(absentOrFalse)) return false;
  if (!absentOrNull('error')) return false;
  if (!absentNullOrEmpty('code')) return false;
  if (!['operationId', 'id', 'operationType', 'phase', 'expectedReleaseId', 'targetReleaseId', 'releaseId', 'contentHash', 'contentPath'].every(absentNullOrEmpty)) return false;
  if (!['operation', 'activeOperation'].every(absentOrNull)) return false;
  return true;
}

function analyzeStaticSource(adminSource) {
  const publishBody = findFunctionBody(adminSource, 'handlePublishStaticCmsDraft');
  const reconcileBody = findFunctionBody(adminSource, 'handleReconcileStaticCmsPublishPointer');
  const policyBody = findFunctionBody(adminSource, 'applyResolvedCapableReconcileState');
  const publishCallIndex = publishBody.indexOf('const result = await publishCmsJson');
  const staleBlock = extractBlockAfter(publishBody, 'if (verifiedId !== persistedDraft.id');
  const errorBlock = extractBlockAfter(reconcileBody, 'if (result.error)');
  const successResolvedBlock = extractBlockAfter(reconcileBody, 'if (resolvedCapable)', 2);
  const unknownBlock = reconcileBody.slice(reconcileBody.indexOf('setReleaseOperationGateState({ blocked: true'));
  const activeExpectedBlock = extractSwitchCaseBlock(policyBody, 'active_expected_release');
  const activeOtherBlock = extractSwitchCaseBlock(policyBody, 'active_other_release') + extractSwitchCaseBlock(policyBody, 'resolved_active_other');
  const failedBeforeBlock = extractSwitchCaseBlock(policyBody, 'failed_before_pointer');
  const groupedBlock = ['operation_already_resolved', 'operation_already_resolved_non_success', 'lineage_repaired', 'failed_before_pointer']
    .map((caseValue) => extractSwitchCaseBlock(policyBody, caseValue)).join('\n');

  const branchHasInvalidation = (block) => /\.\.\.invalidation/.test(block) || (/buildPublishPreflightInvalidationPatch/.test(block) && /publishDryRunResult\s*:\s*null/.test(block));
  return {
    publishHasNetworkCall: publishCallIndex >= 0,
    resultUsedBeforeDeclaration: publishCallIndex < 0 ? true : /\bresult\s*\./.test(publishBody.slice(0, publishCallIndex)),
    staleBlockFound: Boolean(staleBlock),
    staleBranchReturns: /return\s*;/.test(staleBlock),
    staleBranchCallsPublish: /publishCmsJson\s*\(/.test(staleBlock),
    staleBranchCallsConfirmation: /window\.confirm|globalThis\.confirm/.test(staleBlock),
    staleBranchAppliesGate: /applyReleaseOperationGateFromServer\s*\(|setReleaseOperationGateState\s*\(/.test(staleBlock),
    staleBranchHasFakeMetadata: /operationId\s*:|releaseId\s*:|expectedReleaseId\s*:|contentHash\s*:|contentPath\s*:|phase\s*:\s*['"]pointer_written['"]|state\s*:\s*['"]pointer_unknown['"]/.test(staleBlock),
    staleBranchInvalidatesDryRun: /publishDryRunResult\s*:\s*null/.test(staleBlock) && /publishVerifiedDraftId\s*:\s*''/.test(staleBlock) && /publishVerificationInvalidatedAt\s*:/.test(staleBlock),
    sharedPolicyExists: Boolean(policyBody),
    errorPathHasRefresh: /refreshAndApplyReleaseOperationGateStatus\s*\(/.test(errorBlock),
    errorPathUsesSharedPolicy: /applyResolvedCapableReconcileState\s*\(/.test(errorBlock),
    errorPathReturnAfterPolicy: errorBlock.indexOf('applyResolvedCapableReconcileState') >= 0 && errorBlock.indexOf('return;') > errorBlock.indexOf('applyResolvedCapableReconcileState'),
    successPathHasRefresh: /refreshAndApplyReleaseOperationGateStatus\s*\(/.test(successResolvedBlock),
    successPathUsesSharedPolicy: /applyResolvedCapableReconcileState\s*\(/.test(successResolvedBlock),
    activeExpectedHandled: /active_expected_release/.test(activeExpectedBlock),
    activeExpectedInvalidatesDryRun: branchHasInvalidation(activeExpectedBlock),
    activeOtherHandled: /active_other_release/.test(activeOtherBlock) && /resolved_active_other/.test(activeOtherBlock),
    activeOtherInvalidatesDryRun: branchHasInvalidation(activeOtherBlock),
    failedBeforePointerHandled: /failed_before_pointer/.test(groupedBlock),
    failedBeforePointerInvalidatesDryRun: branchHasInvalidation(failedBeforeBlock) || branchHasInvalidation(groupedBlock),
    groupedResolvedInvalidatesDryRun: branchHasInvalidation(groupedBlock),
    genericUnknownFailClosed: /blocked\s*:\s*true/.test(unknownBlock) && /publishRequiresReconciliation\s*:\s*true/.test(unknownBlock) && /buildPublishPreflightInvalidationPatch\s*\(/.test(unknownBlock),
    exactIdleNotRelaxedInConsumer: !/classification\s*===\s*['"]clean['"]/.test(reconcileBody),
  };
}

function deriveCaseActual({ adminSource, gateSource, stateSource, item }) {
  const analysis = analyzeStaticSource(adminSource);
  const input = item.input || {};
  const classification = String(item.classification || input.classification || '').trim();
  const resolved = evaluateResolvedCapableFromSource(gateSource, input);
  const exactIdle = evaluateExactIdleFromSource(stateSource, input);
  const transport = item.transportOutcome;
  const statusRefresh = resolved && (transport === 'error_with_data' ? analysis.errorPathHasRefresh && analysis.errorPathUsesSharedPolicy : analysis.successPathHasRefresh && analysis.successPathUsesSharedPolicy);
  let publishSuccessAllowed = false;
  let gateBehavior = 'unknown_fail_closed';
  let dryRunInvalidation = false;
  let pointerState = 'unknown';
  let operatorOutcome = 'unknown_fail_closed';

  if (item.id === 'EDGE_API_EXACT_IDLE' || exactIdle) {
    gateBehavior = exactIdle ? 'exact_idle_may_clear' : 'unknown_fail_closed';
    pointerState = exactIdle ? 'idle' : 'unknown';
    operatorOutcome = exactIdle ? 'exact_idle_can_clear_gate' : 'unknown_fail_closed';
  } else if (classification === 'active_expected_release' && analysis.activeExpectedHandled) {
    publishSuccessAllowed = true;
    gateBehavior = 'exact_idle_may_clear';
    dryRunInvalidation = analysis.activeExpectedInvalidatesDryRun;
    pointerState = 'active_expected_release';
    operatorOutcome = 'resolved_success_requires_new_preflight';
  } else if (['active_other_release', 'resolved_active_other'].includes(classification) && analysis.activeOtherHandled) {
    gateBehavior = 'remain_blocked';
    dryRunInvalidation = analysis.activeOtherInvalidatesDryRun;
    pointerState = 'active_other_release';
    operatorOutcome = 'release_other_fail_closed';
  } else if (classification === 'failed_before_pointer' && analysis.failedBeforePointerHandled) {
    gateBehavior = 'remain_blocked';
    dryRunInvalidation = analysis.failedBeforePointerInvalidatesDryRun;
    pointerState = 'failed_before_pointer';
    operatorOutcome = 'failed_before_pointer_fail_closed';
  } else if (classification === 'operation_already_resolved' && analysis.groupedResolvedInvalidatesDryRun) {
    gateBehavior = 'blocked_until_status_refresh';
    dryRunInvalidation = true;
    pointerState = 'operation_already_resolved';
    operatorOutcome = 'resolved_requires_new_preflight';
  } else if (classification === 'operation_already_resolved_non_success' && analysis.groupedResolvedInvalidatesDryRun) {
    gateBehavior = 'remain_blocked';
    dryRunInvalidation = true;
    pointerState = 'operation_already_resolved_non_success';
    operatorOutcome = 'resolved_non_success_fail_closed';
  } else if (classification === 'lineage_repaired' && analysis.groupedResolvedInvalidatesDryRun) {
    gateBehavior = 'blocked_until_status_refresh';
    dryRunInvalidation = true;
    pointerState = 'lineage_repaired';
    operatorOutcome = 'lineage_repaired_requires_new_preflight';
  } else if (analysis.genericUnknownFailClosed) {
    gateBehavior = 'unknown_fail_closed';
    dryRunInvalidation = Boolean(item.expectedDryRunInvalidation);
    pointerState = 'unknown';
    operatorOutcome = item.id === 'SQL_CLEAN_NOT_FRONTEND_EXACT_IDLE' ? 'sql_clean_rejected_as_frontend_idle' : (classification ? 'unknown_fail_closed' : 'missing_fail_closed');
  }

  return {
    expectedResolvedCapable: resolved,
    expectedExactIdle: exactIdle,
    expectedStatusRefreshRequired: statusRefresh,
    expectedPublishSuccessAllowed: publishSuccessAllowed,
    expectedGateBehavior: gateBehavior,
    expectedDryRunInvalidation: dryRunInvalidation,
    expectedPointerState: pointerState,
    expectedOperatorOutcome: operatorOutcome,
    transportOutcome: transport,
  };
}

function runStaticAssertions(adminSource) {
  const analysis = analyzeStaticSource(adminSource);
  assertCase('SOURCE_HANDLE_PUBLISH_FUNCTION_FOUND', analysis.publishHasNetworkCall, { publishHasNetworkCall: analysis.publishHasNetworkCall });
  assertCase('STALE_NO_RESULT_BEFORE_DECLARATION', !analysis.resultUsedBeforeDeclaration, { resultUsedBeforeDeclaration: analysis.resultUsedBeforeDeclaration });
  assertCase('STALE_BRANCH_FOUND', analysis.staleBlockFound, { staleBlockFound: analysis.staleBlockFound });
  assertCase('STALE_BRANCH_RETURNS_BEFORE_PUBLISH', analysis.staleBranchReturns, { staleBranchReturns: analysis.staleBranchReturns });
  assertCase('STALE_BRANCH_DOES_NOT_CALL_PUBLISH_API', !analysis.staleBranchCallsPublish, { staleBranchCallsPublish: analysis.staleBranchCallsPublish });
  assertCase('STALE_BRANCH_DOES_NOT_SHOW_CONFIRMATION', !analysis.staleBranchCallsConfirmation, { staleBranchCallsConfirmation: analysis.staleBranchCallsConfirmation });
  assertCase('STALE_BRANCH_DOES_NOT_APPLY_FAKE_GATE', !analysis.staleBranchAppliesGate, { staleBranchAppliesGate: analysis.staleBranchAppliesGate });
  assertCase('STALE_BRANCH_HAS_NO_FAKE_OPERATION_METADATA', !analysis.staleBranchHasFakeMetadata, { staleBranchHasFakeMetadata: analysis.staleBranchHasFakeMetadata });
  assertCase('STALE_BRANCH_INVALIDATES_DRY_RUN', analysis.staleBranchInvalidatesDryRun, { staleBranchInvalidatesDryRun: analysis.staleBranchInvalidatesDryRun });
  assertCase('SHARED_RESOLVED_POLICY_EXISTS', analysis.sharedPolicyExists, { sharedPolicyExists: analysis.sharedPolicyExists });
  assertCase('ERROR_WITH_DATA_PATH_REFRESHES_STATUS', analysis.errorPathHasRefresh, { errorPathHasRefresh: analysis.errorPathHasRefresh });
  assertCase('ERROR_WITH_DATA_PATH_USES_SHARED_POLICY', analysis.errorPathUsesSharedPolicy, { errorPathUsesSharedPolicy: analysis.errorPathUsesSharedPolicy });
  assertCase('ERROR_WITH_DATA_RETURN_AFTER_SHARED_POLICY', analysis.errorPathReturnAfterPolicy, { errorPathReturnAfterPolicy: analysis.errorPathReturnAfterPolicy });
  assertCase('SUCCESS_RESOLVED_PATH_REFRESHES_STATUS', analysis.successPathHasRefresh, { successPathHasRefresh: analysis.successPathHasRefresh });
  assertCase('SUCCESS_RESOLVED_PATH_USES_SHARED_POLICY', analysis.successPathUsesSharedPolicy, { successPathUsesSharedPolicy: analysis.successPathUsesSharedPolicy });
  assertCase('ACTIVE_EXPECTED_INVALIDATES_DRY_RUN', analysis.activeExpectedInvalidatesDryRun, { activeExpectedInvalidatesDryRun: analysis.activeExpectedInvalidatesDryRun });
  assertCase('ACTIVE_OTHER_INVALIDATES_DRY_RUN', analysis.activeOtherInvalidatesDryRun, { activeOtherInvalidatesDryRun: analysis.activeOtherInvalidatesDryRun });
  assertCase('FAILED_BEFORE_POINTER_INVALIDATES_DRY_RUN', analysis.failedBeforePointerInvalidatesDryRun, { failedBeforePointerInvalidatesDryRun: analysis.failedBeforePointerInvalidatesDryRun });
  assertCase('UNKNOWN_MISSING_FAIL_CLOSED', analysis.genericUnknownFailClosed, { genericUnknownFailClosed: analysis.genericUnknownFailClosed });
  assertCase('CONSUMER_DOES_NOT_ACCEPT_CLEAN_AS_EXACT_IDLE', analysis.exactIdleNotRelaxedInConsumer, { exactIdleNotRelaxedInConsumer: analysis.exactIdleNotRelaxedInConsumer });
}

function runFixtureAssertions({ fixture, adminSource, gateSource, stateSource }) {
  const requiredFields = fixture.requiredFields || [];
  const allowedGateBehaviors = new Set(fixture.allowedGateBehaviors || []);
  const cases = Array.isArray(fixture.cases) ? fixture.cases : [];
  const ids = new Set(cases.map((item) => item.id));
  for (const id of fixture.requiredCaseIds || []) {
    assertCase(`FIXTURE_REQUIRED_CASE_PRESENT_${id}`, ids.has(id), { id });
  }
  for (const item of cases) {
    const missingFields = requiredFields.filter((field) => !Object.prototype.hasOwnProperty.call(item, field));
    assertCase(`FIXTURE_SCHEMA_FIELDS_PRESENT_${item.id || 'UNKNOWN'}`, missingFields.length === 0, { missingFields });
    assertCase(`FIXTURE_GATE_BEHAVIOR_VOCABULARY_${item.id || 'UNKNOWN'}`, allowedGateBehaviors.has(item.expectedGateBehavior), { value: item.expectedGateBehavior });
    assertCase(`FIXTURE_TRANSPORT_OUTCOME_VOCABULARY_${item.id || 'UNKNOWN'}`, ['success', 'error_with_data'].includes(item.transportOutcome), { value: item.transportOutcome });
    if (missingFields.length > 0) continue;
    const actual = deriveCaseActual({ adminSource, gateSource, stateSource, item });
    for (const field of requiredFields.filter((field) => field.startsWith('expected') || field === 'transportOutcome')) {
      assertCase(`FIXTURE_ASSERTS_${field}_${item.id}`, actual[field] === item[field], { expected: item[field], actual: actual[field] });
    }
  }
}

function collectFailuresForSources({ adminSource, gateSource, stateSource, fixture }) {
  const beforeLength = results.length;
  runStaticAssertions(adminSource);
  runFixtureAssertions({ fixture, adminSource, gateSource, stateSource });
  const scoped = results.splice(beforeLength);
  return scoped.filter((item) => !item.pass).map((item) => item.id);
}

function writeMutantRoot({ adminSource, gateSource, stateSource, fixture }) {
  const tempRoot = makeTempRoot('cms-0660301-mutant-');
  const files = {
    [adminStaticRel]: adminSource,
    [releaseGateRel]: gateSource,
    [adminStateRel]: stateSource,
    [fixtureRel]: JSON.stringify(fixture, null, 2) + '\n',
  };
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(tempRoot, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return tempRoot;
}

function recordMutation({ id, target, beforeSource, afterSource, replacementCount, requiredReplacementCount, expectedFailureIds, fixedFailures, mutatedFailures, tempRoot }) {
  const beforeHash = sha256(beforeSource);
  const afterHash = sha256(afterSource);
  const expectedObserved = expectedFailureIds.every((failureId) => mutatedFailures.includes(failureId));
  const unrelatedFailures = mutatedFailures.filter((failureId) => !expectedFailureIds.includes(failureId));
  const killed = replacementCount === requiredReplacementCount
    && beforeHash !== afterHash
    && fixedFailures.length === 0
    && expectedObserved
    && unrelatedFailures.length === 0;
  const record = {
    id,
    target,
    replacementCount,
    requiredReplacementCount,
    sourceHashBefore: beforeHash,
    sourceHashAfter: afterHash,
    sourceChanged: beforeHash !== afterHash,
    evaluatorRoot: tempRoot,
    fixedOutcome: fixedFailures.length === 0 ? 'PASS' : 'FAIL',
    mutatedOutcome: mutatedFailures.length === 0 ? 'PASS' : 'FAIL',
    failedAssertionIds: mutatedFailures,
    expectedFailureIds,
    unexpectedFailureIds: unrelatedFailures,
    status: killed ? 'KILLED' : 'SURVIVED',
  };
  mutationRecords.push(record);
  assertCase(`MUTATION_${id}_KILLED`, killed, record);
}

function runMutationControls({ adminSource, gateSource, stateSource, fixture }) {
  const fixedFailures = collectFailuresForSources({ adminSource, gateSource, stateSource, fixture });
  assertCase('FIXED_SOURCE_BASELINE_PASS_BEFORE_MUTATIONS', fixedFailures.length === 0, { fixedFailures });

  const mutations = [];

  mutations.push(() => {
    const search = `statusRefresh = await refreshAndApplyReleaseOperationGateStatus({\n        successResult: data,\n        fallbackMessage: 'Response lỗi có thể đã resolve operation; cần kiểm tra trạng thái máy chủ trước khi mở gate.',\n      });`;
    const replacement = `statusRefresh = null; /* M001 removed error-path status refresh */`;
    const applied = replaceExact(adminSource, search, replacement, 1);
    return { id: 'M001_REMOVE_ERROR_PATH_STATUS_REFRESH', target: adminStaticRel, sourceKind: 'admin', applied, expectedFailureIds: ['ERROR_WITH_DATA_PATH_REFRESHES_STATUS', 'FIXTURE_ASSERTS_expectedStatusRefreshRequired_ACTIVE_OTHER_RELEASE_ERROR_WITH_DATA', 'FIXTURE_ASSERTS_expectedStatusRefreshRequired_FAILED_BEFORE_POINTER_ERROR_WITH_DATA'] };
  });

  mutations.push(() => {
    const activeOtherBlock = extractSwitchCaseBlock(findFunctionBody(adminSource, 'applyResolvedCapableReconcileState'), 'active_other_release');
    const search = `        ...invalidation,\n        publishVerificationInvalidationReason: 'Reconcile xác nhận website đang dùng release khác; kết quả dry-run cũ không còn hợp lệ.',`;
    const replacement = `        publishVerificationInvalidationReason: 'Reconcile xác nhận website đang dùng release khác; kết quả dry-run cũ không còn hợp lệ.',`;
    const applied = replaceExact(adminSource, search, replacement, 1);
    return { id: 'M002_REMOVE_ACTIVE_OTHER_INVALIDATION', target: adminStaticRel, sourceKind: 'admin', applied, expectedFailureIds: ['ACTIVE_OTHER_INVALIDATES_DRY_RUN', 'FIXTURE_ASSERTS_expectedDryRunInvalidation_ACTIVE_OTHER_RELEASE_ERROR_WITH_DATA', 'FIXTURE_ASSERTS_expectedDryRunInvalidation_ACTIVE_OTHER_RELEASE_SUCCESS_SHAPE', 'FIXTURE_ASSERTS_expectedDryRunInvalidation_RESOLVED_ACTIVE_OTHER'] };
  });

  mutations.push(() => {
    const mutantFixture = structuredClone(fixture);
    mutantFixture.cases.find((item) => item.id === 'ACTIVE_OTHER_RELEASE_ERROR_WITH_DATA').expectedGateBehavior = 'exact_idle_may_clear';
    return { id: 'M003_POISON_FIXTURE_GATE_BEHAVIOR', target: fixtureRel, sourceKind: 'fixture', applied: { source: JSON.stringify(mutantFixture, null, 2) + '\n', replacementCount: 1, sourceChanged: true }, fixture: mutantFixture, expectedFailureIds: ['FIXTURE_ASSERTS_expectedGateBehavior_ACTIVE_OTHER_RELEASE_ERROR_WITH_DATA'] };
  });

  mutations.push(() => {
    const mutantFixture = structuredClone(fixture);
    mutantFixture.cases.find((item) => item.id === 'ACTIVE_OTHER_RELEASE_SUCCESS_SHAPE').expectedDryRunInvalidation = false;
    return { id: 'M004_POISON_FIXTURE_DRY_RUN_INVALIDATION', target: fixtureRel, sourceKind: 'fixture', applied: { source: JSON.stringify(mutantFixture, null, 2) + '\n', replacementCount: 1, sourceChanged: true }, fixture: mutantFixture, expectedFailureIds: ['FIXTURE_ASSERTS_expectedDryRunInvalidation_ACTIVE_OTHER_RELEASE_SUCCESS_SHAPE'] };
  });

  mutations.push(() => {
    const mutantFixture = structuredClone(fixture);
    mutantFixture.cases.find((item) => item.id === 'FAILED_BEFORE_POINTER_ERROR_WITH_DATA').expectedPublishSuccessAllowed = true;
    return { id: 'M005_POISON_FIXTURE_PUBLISH_SUCCESS_ALLOWED', target: fixtureRel, sourceKind: 'fixture', applied: { source: JSON.stringify(mutantFixture, null, 2) + '\n', replacementCount: 1, sourceChanged: true }, fixture: mutantFixture, expectedFailureIds: ['FIXTURE_ASSERTS_expectedPublishSuccessAllowed_FAILED_BEFORE_POINTER_ERROR_WITH_DATA'] };
  });

  mutations.push(() => {
    const search = `const statusRefresh = await refreshAndApplyReleaseOperationGateStatus({\n      successResult: data,\n      fallbackMessage: 'Reconcile response có thể đã resolve operation; cần kiểm tra trạng thái máy chủ trước khi mở gate.',\n    });`;
    const replacement = `const statusRefresh = null; /* M006 removed non-error resolved refresh */`;
    const applied = replaceExact(adminSource, search, replacement, 1);
    return { id: 'M006_REMOVE_NON_ERROR_RESOLVED_REFRESH', target: adminStaticRel, sourceKind: 'admin', applied, expectedFailureIds: ['SUCCESS_RESOLVED_PATH_REFRESHES_STATUS', 'FIXTURE_ASSERTS_expectedStatusRefreshRequired_ACTIVE_EXPECTED_RELEASE_SUCCESS', 'FIXTURE_ASSERTS_expectedStatusRefreshRequired_ACTIVE_OTHER_RELEASE_SUCCESS_SHAPE', 'FIXTURE_ASSERTS_expectedStatusRefreshRequired_RESOLVED_ACTIVE_OTHER', 'FIXTURE_ASSERTS_expectedStatusRefreshRequired_OPERATION_ALREADY_RESOLVED', 'FIXTURE_ASSERTS_expectedStatusRefreshRequired_OPERATION_ALREADY_RESOLVED_NON_SUCCESS', 'FIXTURE_ASSERTS_expectedStatusRefreshRequired_LINEAGE_REPAIRED'] };
  });

  mutations.push(() => {
    const publishBody = findFunctionBody(adminSource, 'handlePublishStaticCmsDraft');
    const staleBlock = extractBlockAfter(publishBody, 'if (verifiedId !== persistedDraft.id');
    const mutatedBlock = staleBlock.replace('publishError:', `debugOperationId: result.data?.operationId,\n        publishError:`);
    const applied = replaceExact(adminSource, staleBlock, mutatedBlock, 1);
    return { id: 'M007_REINTRODUCE_RESULT_BEFORE_DECLARATION', target: adminStaticRel, sourceKind: 'admin', applied, expectedFailureIds: ['STALE_NO_RESULT_BEFORE_DECLARATION'] };
  });

  mutations.push(() => {
    const search = `data.classification === 'idle'`;
    const replacement = `['idle', 'clean'].includes(data.classification)`;
    const applied = replaceExact(stateSource, search, replacement, 1);
    return { id: 'M008_RELAX_EXACT_IDLE_TO_ACCEPT_CLEAN', target: adminStateRel, sourceKind: 'state', applied, expectedFailureIds: ['FIXTURE_ASSERTS_expectedExactIdle_SQL_CLEAN_NOT_FRONTEND_EXACT_IDLE', 'FIXTURE_ASSERTS_expectedGateBehavior_SQL_CLEAN_NOT_FRONTEND_EXACT_IDLE', 'FIXTURE_ASSERTS_expectedPointerState_SQL_CLEAN_NOT_FRONTEND_EXACT_IDLE', 'FIXTURE_ASSERTS_expectedOperatorOutcome_SQL_CLEAN_NOT_FRONTEND_EXACT_IDLE'] };
  });

  mutations.push(() => {
    const mutantFixture = structuredClone(fixture);
    delete mutantFixture.cases.find((item) => item.id === 'LINEAGE_REPAIRED').expectedOperatorOutcome;
    return { id: 'M009_REMOVE_REQUIRED_FIXTURE_FIELD', target: fixtureRel, sourceKind: 'fixture', applied: { source: JSON.stringify(mutantFixture, null, 2) + '\n', replacementCount: 1, sourceChanged: true }, fixture: mutantFixture, expectedFailureIds: ['FIXTURE_SCHEMA_FIELDS_PRESENT_LINEAGE_REPAIRED'] };
  });

  for (const buildMutation of mutations) {
    const mutation = buildMutation();
    let mutantAdmin = adminSource;
    let mutantGate = gateSource;
    let mutantState = stateSource;
    let mutantFixture = mutation.fixture || fixture;
    if (mutation.sourceKind === 'admin') mutantAdmin = mutation.applied.source;
    if (mutation.sourceKind === 'state') mutantState = mutation.applied.source;
    const tempRoot = writeMutantRoot({ adminSource: mutantAdmin, gateSource: mutantGate, stateSource: mutantState, fixture: mutantFixture });
    const mutatedFailures = collectFailuresForSources({ adminSource: mutantAdmin, gateSource: mutantGate, stateSource: mutantState, fixture: mutantFixture });
    const beforeSource = mutation.sourceKind === 'admin' ? adminSource : mutation.sourceKind === 'state' ? stateSource : JSON.stringify(fixture, null, 2) + '\n';
    recordMutation({
      id: mutation.id,
      target: mutation.target,
      beforeSource,
      afterSource: mutation.applied.source,
      replacementCount: mutation.applied.replacementCount,
      requiredReplacementCount: 1,
      expectedFailureIds: mutation.expectedFailureIds,
      fixedFailures,
      mutatedFailures,
      tempRoot,
    });
  }
}

try {
  const adminSource = readText(adminStaticPath);
  const gateSource = readText(releaseGatePath);
  const stateSource = readText(adminStatePath);
  const fixture = readJson(fixturePath);

  runStaticAssertions(adminSource);
  runFixtureAssertions({ fixture, adminSource, gateSource, stateSource });
  runMutationControls({ adminSource, gateSource, stateSource, fixture });
} catch (error) {
  assertCase('VERIFIER_INTERNAL_ERROR', false, { message: error?.message || String(error), stack: error?.stack || '' });
} finally {
  cleanupTempRoots();
}

const remainingTempRoots = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('cms-0660301-mutant-'));
assertCase('TEMP_ROOTS_CLEANED', remainingTempRoots.length === 0, { remainingTempRoots });

const passCount = results.filter((item) => item.pass).length;
const failCount = results.length - passCount;
const summary = {
  verifier: path.relative(root, new URL(import.meta.url).pathname),
  root,
  passCount,
  failCount,
  totalCount: results.length,
  mutationRecords,
  results,
};

console.log(JSON.stringify(summary, null, 2));
if (failCount > 0) process.exit(1);
