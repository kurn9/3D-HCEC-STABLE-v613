import crypto from 'node:crypto';

export const PROTOCOL_VERSION = 'v6.14.066.027';

export function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function stableStringify(value) {
  return JSON.stringify(sortStable(value));
}

export function sortStable(value) {
  if (Array.isArray(value)) return value.map(sortStable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortStable(value[key]);
    return out;
  }
  return value;
}

export function canonicalEvidence(record = {}) {
  const sanitized = {
    status: record.status ?? null,
    signal: record.signal ?? null,
    timedOut: Boolean(record.timedOut),
    spawnErrorCode: record.spawnErrorCode || '',
    spawnErrorMessage: record.spawnErrorMessage || '',
    parseError: record.parseError || '',
    protocolErrors: [...(record.protocolErrors || [])].sort(),
    failedAssertionIds: [...(record.failedAssertionIds || [])].sort(),
    cleanup: {
      reportedRemainingCount: Number(record.cleanup?.reportedRemainingCount || 0),
      filesystemRemainingCount: Number(record.cleanup?.filesystemRemainingCount || 0),
      hiddenLeakDetected: Boolean(record.cleanup?.hiddenLeakDetected),
    },
    scenarioPayload: sortStable(record.scenarioPayload || {}),
    resultPresent: Boolean(record.resultPresent),
    rootMatch: record.rootMatch !== false,
    runIdMatch: record.runIdMatch !== false,
    executableMatch: record.executableMatch !== false,
    actualFunctionExecuted: Boolean(record.actualFunctionExecuted),
  };
  const text = stableStringify(sanitized);
  return { bytes: text, sha256: sha256Bytes(text) };
}

export function classifyProcessOutcome(record = {}) {
  if (record.spawnErrorCode || record.spawnErrorMessage) return 'CHILD_SPAWN_ERROR';
  if (record.timedOut === true) return 'CHILD_TIMEOUT';
  if (record.signal) return 'CHILD_SIGNAL';
  if (record.resultPresent === false) return 'CHILD_RESULT_MISSING';
  if (record.parseError) return 'CHILD_MALFORMED_JSON';
  if ((record.protocolErrors || []).length > 0) return 'CHILD_PROTOCOL_INVALID';
  if (record.cleanup?.hiddenLeakDetected) return 'CHILD_HIDDEN_CLEANUP_LEAK';
  if (Number(record.cleanup?.filesystemRemainingCount || 0) > 0 || Number(record.cleanup?.reportedRemainingCount || 0) > 0) return 'CHILD_CLEANUP_LEAK';
  if (record.status === 0) return 'CHILD_OK';
  if (record.status === 1) return 'CHILD_EXPECTED_TEST_FAILURE';
  if (typeof record.status === 'number' && record.status >= 2) return 'CHILD_ABNORMAL_EXIT';
  return 'CHILD_UNKNOWN';
}

export function validateChildProtocol(result = {}, expected = {}) {
  const errors = [];
  if (!result || typeof result !== 'object') return ['RESULT_NOT_OBJECT'];
  if (result.protocolVersion !== PROTOCOL_VERSION) errors.push('PROTOCOL_VERSION');
  if (expected.runId && result.runId !== expected.runId) errors.push('RUN_ID');
  if (expected.root && result.root !== expected.root) errors.push('ROOT');
  if (expected.executablePath && result.executablePath !== expected.executablePath) errors.push('EXECUTABLE_PATH');
  if (!Array.isArray(result.assertions)) errors.push('ASSERTIONS_ARRAY');
  const ids = (result.assertions || []).map((item) => item.id);
  if (new Set(ids).size !== ids.length) errors.push('DUPLICATE_ASSERTIONS');
  const pass = (result.assertions || []).filter((item) => item.pass).length;
  const fail = (result.assertions || []).filter((item) => !item.pass).length;
  if (result.passCount !== pass || result.failCount !== fail || result.totalCount !== ids.length) errors.push('COUNT_MISMATCH');
  return errors;
}

export function validateMutationManifest(records = []) {
  const errors = [];
  const ids = new Set();
  const semanticKeys = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object') { errors.push({ id: '<invalid>', reason: 'RECORD_NOT_OBJECT' }); continue; }
    if (!record.id || ids.has(record.id)) errors.push({ id: record.id || '<missing>', reason: 'DUPLICATE_OR_MISSING_ID' });
    ids.add(record.id);
    const key = [record.target || '', record.search || '', record.replacement ?? '', record.scenario || ''].join('\u0001');
    if (semanticKeys.has(key)) {
      errors.push({ id: record.id, reason: 'MANIFEST_SEMANTIC_DUPLICATE', duplicateOf: semanticKeys.get(key) });
    }
    semanticKeys.set(key, record.id);
    if (!Number.isInteger(record.requiredReplacementCount) || record.requiredReplacementCount < 0) errors.push({ id: record.id, reason: 'INVALID_REPLACEMENT_COUNT' });
    if (!['EXPECTED_TEST_FAILURE','EXPECTED_EXECUTION_INVALID','EXPECTED_PARENT_REJECTION','EXPECTED_ORACLE_REJECTION'].includes(record.expectedOutcome)) errors.push({ id: record.id, reason: 'UNKNOWN_EXPECTED_OUTCOME' });
    if (record.expectedOutcome === 'EXPECTED_TEST_FAILURE' && !(record.expectedFailedAssertions || []).length) errors.push({ id: record.id, reason: 'EXPECTED_FAILURES_EMPTY' });
    if (record.expectedOutcome === 'EXPECTED_EXECUTION_INVALID' && !record.expectedInvalidReason) errors.push({ id: record.id, reason: 'EXPECTED_INVALID_REASON_EMPTY' });
    if (record.expectedOutcome === 'EXPECTED_ORACLE_REJECTION' && !record.expectedRejectReason) errors.push({ id: record.id, reason: 'EXPECTED_REJECT_REASON_EMPTY' });
  }
  return errors;
}

function failureIdsFromRecord(record = {}) {
  if (Array.isArray(record.failedAssertionIds)) return record.failedAssertionIds;
  const result = record.result || {};
  return (result.assertions || []).filter((item) => !item.pass).map((item) => item.id);
}

export function evaluateMutationOutcome(mutation = {}, record = {}) {
  const actualFunctionExecuted = record.actualFunctionExecuted !== false;
  const replacementCountMatches = mutation.replacementCount === mutation.requiredReplacementCount;
  const sourceChanged = Boolean(mutation.baselineSha && mutation.mutatedSha && mutation.baselineSha !== mutation.mutatedSha);
  const executableUnderMutantRoot = record.executableUnderMutantRoot !== false;
  const processOutcome = classifyProcessOutcome(record);
  const actualFailures = failureIdsFromRecord(record);
  const expected = mutation.expectedFailedAssertions || [];
  const allowed = new Set([...expected, ...(mutation.allowedAdditionalFailures || [])]);
  const expectedMissing = expected.filter((id) => !actualFailures.includes(id));
  const unexpectedFailed = actualFailures.filter((id) => !allowed.has(id));
  let accepted = false;
  let verdict = 'SURVIVED';
  let rejectReason = '';

  if (!replacementCountMatches) rejectReason = 'REPLACEMENT_COUNT_MISMATCH';
  else if (!sourceChanged) rejectReason = 'MUTATED_SOURCE_UNCHANGED';
  else if (!actualFunctionExecuted) rejectReason = 'ACTUAL_FUNCTION_NOT_EXECUTED';
  else if (!executableUnderMutantRoot) rejectReason = 'EXECUTABLE_NOT_UNDER_MUTANT_ROOT';
  else if (mutation.expectedOutcome === 'EXPECTED_TEST_FAILURE') {
    if (processOutcome !== 'CHILD_EXPECTED_TEST_FAILURE') rejectReason = processOutcome === 'CHILD_OK' ? 'EXPECTED_FAILURE_NOT_OBSERVED' : processOutcome;
    else if (expectedMissing.length) rejectReason = 'EXPECTED_FAILURE_NOT_OBSERVED';
    else if (unexpectedFailed.length) rejectReason = 'UNEXPECTED_FAILURES';
    else accepted = true;
  } else if (mutation.expectedOutcome === 'EXPECTED_EXECUTION_INVALID') {
    if (processOutcome !== mutation.expectedInvalidReason) rejectReason = processOutcome;
    else accepted = true;
  } else if (mutation.expectedOutcome === 'EXPECTED_ORACLE_REJECTION') {
    rejectReason = mutation.actualRejectReason || rejectReason || 'EXPECTED_ORACLE_REJECTION';
    accepted = rejectReason === mutation.expectedRejectReason;
  } else if (mutation.expectedOutcome === 'EXPECTED_PARENT_REJECTION') {
    if (mutation.actualRejectReason !== mutation.expectedRejectReason) rejectReason = mutation.actualRejectReason || 'PARENT_REJECTION_MISMATCH';
    else accepted = true;
  }

  if (accepted) {
    verdict = 'KILLED';
    rejectReason = '';
  }
  return {
    id: mutation.id || '',
    accepted,
    killed: accepted,
    verdict,
    rejectReason,
    replacementCountMatches,
    sourceChanged,
    actualFunctionExecuted,
    executableUnderMutantRoot,
    processOutcome,
    actualFailures,
    expectedMissing,
    unexpectedFailed,
  };
}

export function evaluateParentAcceptance(evidenceRecords = []) {
  const guardViolations = [];
  const processOutcomes = [];
  for (const record of evidenceRecords) {
    const outcome = classifyProcessOutcome(record);
    processOutcomes.push({ id: record.id || record.scenario || '', outcome });
    if (record.expectedOutcome && outcome !== record.expectedOutcome) guardViolations.push(`${record.id || record.scenario}:EXPECTED_${record.expectedOutcome}_OBSERVED_${outcome}`);
    if (outcome !== 'CHILD_OK' && !record.allowNonOk) guardViolations.push(`${record.id || record.scenario}:NON_OK_${outcome}`);
    if ((record.protocolErrors || []).length && !record.allowProtocolErrors) guardViolations.push(`${record.id || record.scenario}:PROTOCOL_ERRORS`);
    if (record.cleanup?.hiddenLeakDetected || Number(record.cleanup?.filesystemRemainingCount || 0) > 0) guardViolations.push(`${record.id || record.scenario}:CLEANUP_REMAINING`);
  }
  return {
    parentAcceptance: guardViolations.length === 0,
    guardViolations,
    processOutcomes,
    acceptanceDecisionSource: 'raw-child-evidence',
  };
}

export function summarizeScenarioRecords(records = []) {
  const unexpected = records.filter((record) => record.expectedOutcome !== record.observedOutcome);
  return {
    total: records.length,
    unexpectedScenarioOutcomes: unexpected.length,
    unexpectedAbnormalExits: records.filter((r) => r.observedOutcome === 'CHILD_ABNORMAL_EXIT' && r.expectedOutcome !== 'CHILD_ABNORMAL_EXIT').length,
    unexpectedSignals: records.filter((r) => r.observedOutcome === 'CHILD_SIGNAL' && r.expectedOutcome !== 'CHILD_SIGNAL').length,
    unexpectedTimeouts: records.filter((r) => r.observedOutcome === 'CHILD_TIMEOUT' && r.expectedOutcome !== 'CHILD_TIMEOUT').length,
    unexpectedSpawnErrors: records.filter((r) => r.observedOutcome === 'CHILD_SPAWN_ERROR' && r.expectedOutcome !== 'CHILD_SPAWN_ERROR').length,
    unexpectedProtocolErrors: records.filter((r) => r.observedOutcome === 'CHILD_PROTOCOL_INVALID' && r.expectedOutcome !== 'CHILD_PROTOCOL_INVALID').length,
  };
}
