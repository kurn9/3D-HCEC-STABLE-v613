import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const OUTCOMES = new Set([
  'EXPECTED_TEST_FAILURE',
  'EXPECTED_EXECUTION_INVALID',
  'EXPECTED_PARENT_REJECTION',
  'EXPECTED_ORACLE_REJECTION',
]);

export const VALID_SCENARIOS = new Set([
  'normal',
  'exit-2-after-result',
  'signal-after-result',
  'timeout',
  'malformed-result',
  'wrong-run-id',
  'wrong-root',
  'wrong-executable',
  'cleanup-leak',
  'unexpected-failure',
]);

export function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function sha256Text(text) {
  return sha256Bytes(Buffer.from(text, 'utf8'));
}

export function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function uniqueValues(values) {
  const seen = new Set();
  const dupes = [];
  for (const value of values) {
    if (seen.has(value)) dupes.push(value);
    seen.add(value);
  }
  return dupes;
}

export function countOccurrences(text, search) {
  if (!search) return 0;
  return text.split(String(search)).length - 1;
}

export function countSearchInFile(root, mutation) {
  const target = path.join(root, mutation.target || '');
  if (!fs.existsSync(target)) return { targetExists: false, count: 0, target };
  return { targetExists: true, count: countOccurrences(fs.readFileSync(target, 'utf8'), mutation.search), target };
}

export function applyReplacement(root, mutation) {
  const target = path.join(root, mutation.target || '');
  if (!fs.existsSync(target)) {
    return { targetExists: false, replacementCount: 0, beforeSha: '', afterSha: '', beforeBytes: 0, afterBytes: 0, target };
  }
  const before = fs.readFileSync(target, 'utf8');
  const beforeSha = sha256Text(before);
  const replacementCount = countOccurrences(before, mutation.search);
  const after = before.split(String(mutation.search || '')).join(String(mutation.replacement ?? ''));
  fs.writeFileSync(target, after);
  return {
    targetExists: true,
    replacementCount,
    beforeSha,
    afterSha: sha256Text(after),
    beforeBytes: Buffer.byteLength(before),
    afterBytes: Buffer.byteLength(after),
    target,
  };
}

export function validateManifestRecords(records, { root = '', label = 'manifest', allowIntentionalReplacementMismatch = true } = {}) {
  const errors = [];
  if (!Array.isArray(records)) return [`${label}: not an array`];
  const ids = records.map((record) => record?.id || '<missing>');
  const dupes = uniqueValues(ids).filter((id) => id !== '<missing>');
  if (ids.includes('<missing>')) errors.push(`${label}: missing id`);
  if (dupes.length) errors.push(`${label}: duplicate ids ${dupes.join(',')}`);
  for (const record of records) {
    const prefix = `${label}:${record?.id || '<missing>'}`;
    if (!isPlainRecord(record)) {
      errors.push(`${prefix}: record not object`);
      continue;
    }
    if (!OUTCOMES.has(record.expectedOutcome)) errors.push(`${prefix}: invalid expectedOutcome=${record.expectedOutcome}`);
    if (!VALID_SCENARIOS.has(record.scenario || 'normal')) errors.push(`${prefix}: invalid scenario=${record.scenario}`);
    if (!Number.isInteger(record.requiredReplacementCount) || record.requiredReplacementCount < 0) errors.push(`${prefix}: invalid requiredReplacementCount`);
    if (typeof record.target !== 'string' || !record.target) errors.push(`${prefix}: target missing`);
    if (typeof record.search !== 'string') errors.push(`${prefix}: search must be string`);
    if (typeof record.replacement !== 'string') errors.push(`${prefix}: replacement must be string`);
    if (record.expectedOutcome === 'EXPECTED_TEST_FAILURE' && (!Array.isArray(record.expectedFailedAssertions) || record.expectedFailedAssertions.length === 0)) {
      errors.push(`${prefix}: EXPECTED_TEST_FAILURE needs expectedFailedAssertions`);
    }
    if (record.expectedOutcome === 'EXPECTED_EXECUTION_INVALID' && !record.expectedInvalidReason) {
      errors.push(`${prefix}: EXPECTED_EXECUTION_INVALID needs expectedInvalidReason`);
    }
    if (record.expectedOutcome === 'EXPECTED_ORACLE_REJECTION' && !record.expectedRejectReason) {
      errors.push(`${prefix}: EXPECTED_ORACLE_REJECTION needs expectedRejectReason`);
    }
    if (record.expectedOutcome === 'EXPECTED_PARENT_REJECTION' && (!Array.isArray(record.expectedMetaViolationIds) || record.expectedMetaViolationIds.length === 0)) {
      errors.push(`${prefix}: EXPECTED_PARENT_REJECTION needs expectedMetaViolationIds`);
    }
    if (root) {
      const { targetExists, count } = countSearchInFile(root, record);
      const intentionalMismatch = allowIntentionalReplacementMismatch
        && record.expectedOutcome === 'EXPECTED_ORACLE_REJECTION'
        && record.expectedRejectReason === 'REPLACEMENT_COUNT_MISMATCH';
      if (!targetExists) errors.push(`${prefix}: target missing at ${record.target}`);
      if (!intentionalMismatch && count !== record.requiredReplacementCount) {
        errors.push(`${prefix}: replacement preflight count=${count} required=${record.requiredReplacementCount}`);
      }
    }
  }
  return errors;
}

export function preflightManifest(root, records, label) {
  return records.map((record) => {
    const { targetExists, count, target } = countSearchInFile(root, record);
    const intentionalMismatch = record.expectedOutcome === 'EXPECTED_ORACLE_REJECTION'
      && record.expectedRejectReason === 'REPLACEMENT_COUNT_MISMATCH';
    return {
      id: record.id,
      category: record.category || label,
      target: record.target,
      targetExists,
      targetPath: target,
      observedReplacementCount: count,
      requiredReplacementCount: record.requiredReplacementCount,
      expectedOutcome: record.expectedOutcome,
      expectedRejectReason: record.expectedRejectReason || '',
      status: targetExists && (count === record.requiredReplacementCount || intentionalMismatch) ? 'PASS' : 'FAIL',
      intentionalMismatch,
    };
  });
}

export function duplicateIds(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

export function validateChildResult(result, expectedRunId, expectedRoot, expectedExecutable) {
  const errors = [];
  if (!isPlainRecord(result)) return ['RESULT_NOT_OBJECT'];
  if (result.protocolVersion !== 'v6.14.066.024-child') errors.push('PROTOCOL_VERSION');
  if (result.runId !== expectedRunId) errors.push('RUN_ID');
  if (path.resolve(result.root || '') !== path.resolve(expectedRoot || '')) errors.push('ROOT');
  if (path.resolve(result.executablePath || '') !== path.resolve(expectedExecutable || '')) errors.push('EXECUTABLE_PATH');
  if (!Number.isInteger(result.pid) || result.pid <= 0) errors.push('PID');
  if (!Array.isArray(result.assertions)) errors.push('ASSERTIONS_ARRAY');
  const ids = Array.isArray(result.assertions) ? result.assertions.map((a) => a?.id || '<missing>') : [];
  if (ids.includes('<missing>')) errors.push('ASSERTION_ID_MISSING');
  if (duplicateIds(ids).length) errors.push('DUPLICATE_ASSERTIONS');
  const pass = Array.isArray(result.assertions) ? result.assertions.filter((a) => a.pass).length : 0;
  const fail = Array.isArray(result.assertions) ? result.assertions.filter((a) => !a.pass).length : 0;
  if (result.passCount !== pass || result.failCount !== fail || result.totalCount !== ids.length) errors.push('COUNT_MISMATCH');
  for (const key of ['targetAdminSha256','importedAdminSha256','targetGateSha256','importedGateSha256']) {
    if (!result[key]) errors.push(`MISSING_${key}`);
  }
  for (const key of ['ownedPathsCreated','ownedPathsRemoved','remainingOwnedPaths']) {
    if (!Array.isArray(result[key])) errors.push(`MISSING_${key}`);
  }
  return errors;
}

export function validateParentResult(result, expectedRunId, expectedRoot, expectedExecutable) {
  const errors = [];
  if (!isPlainRecord(result)) return ['RESULT_NOT_OBJECT'];
  if (result.protocolVersion !== 'v6.14.066.024-parent') errors.push('PROTOCOL_VERSION');
  if (result.runId !== expectedRunId) errors.push('RUN_ID');
  if (path.resolve(result.root || '') !== path.resolve(expectedRoot || '')) errors.push('ROOT');
  if (path.resolve(result.executablePath || '') !== path.resolve(expectedExecutable || '')) errors.push('EXECUTABLE_PATH');
  if (!Array.isArray(result.assertions)) errors.push('ASSERTIONS_ARRAY');
  const ids = Array.isArray(result.assertions) ? result.assertions.map((a) => a?.id || '<missing>') : [];
  if (ids.includes('<missing>')) errors.push('ASSERTION_ID_MISSING');
  if (duplicateIds(ids).length) errors.push('DUPLICATE_ASSERTIONS');
  const pass = Array.isArray(result.assertions) ? result.assertions.filter((a) => a.pass).length : 0;
  const fail = Array.isArray(result.assertions) ? result.assertions.filter((a) => !a.pass).length : 0;
  if (result.passCount !== pass || result.failCount !== fail || result.totalCount !== ids.length) errors.push('COUNT_MISMATCH');
  if (!Array.isArray(result.childProcessRecords)) errors.push('CHILD_PROCESS_RECORDS');
  if (!isPlainRecord(result.processSummary)) errors.push('PROCESS_SUMMARY');
  return errors;
}

export function failedAssertionIds(result) {
  return Array.isArray(result?.assertions) ? result.assertions.filter((a) => !a.pass).map((a) => a.id) : [];
}

export function classifyProcess({ proc = {}, result = null, protocolErrors = [], parseError = '' } = {}) {
  const spawnError = proc.error?.message || '';
  const timedOut = Boolean(spawnError && /timed out/i.test(spawnError));
  let invalidReason = '';
  if (timedOut) invalidReason = 'CHILD_TIMEOUT';
  else if (spawnError) invalidReason = 'CHILD_SPAWN_ERROR';
  else if (proc.signal) invalidReason = 'CHILD_SIGNAL';
  else if (Number(proc.status) >= 2) invalidReason = 'ABNORMAL_CHILD_EXIT';
  else if (parseError || protocolErrors.length) {
    if (protocolErrors.includes('RUN_ID')) invalidReason = 'RUN_ID_MISMATCH';
    else if (protocolErrors.includes('ROOT')) invalidReason = 'ROOT_MISMATCH';
    else if (protocolErrors.includes('EXECUTABLE_PATH')) invalidReason = 'EXECUTABLE_PATH_MISMATCH';
    else invalidReason = 'PROTOCOL_INVALID';
  }
  else if (result?.remainingOwnedPaths?.length) invalidReason = 'CLEANUP_FAILED';
  return {
    status: proc.status,
    signal: proc.signal || null,
    spawnError,
    timedOut,
    parseError,
    protocolErrors: [...protocolErrors],
    invalidReason,
    resultPresent: Boolean(result),
    failedAssertionIds: failedAssertionIds(result),
  };
}

export function classifyParentProcess({ proc = {}, result = null, protocolErrors = [], parseError = '' } = {}) {
  const spawnError = proc.error?.message || '';
  const timedOut = Boolean(spawnError && /timed out/i.test(spawnError));
  let invalidReason = '';
  if (timedOut) invalidReason = 'PARENT_TIMEOUT';
  else if (spawnError) invalidReason = 'PARENT_SPAWN_ERROR';
  else if (proc.signal) invalidReason = 'PARENT_SIGNAL';
  else if (Number(proc.status) >= 2) invalidReason = 'PARENT_ABNORMAL_EXIT';
  else if (parseError || protocolErrors.length) {
    if (protocolErrors.includes('RUN_ID')) invalidReason = 'PARENT_RUN_ID_MISMATCH';
    else if (protocolErrors.includes('ROOT')) invalidReason = 'PARENT_ROOT_MISMATCH';
    else if (protocolErrors.includes('EXECUTABLE_PATH')) invalidReason = 'PARENT_EXECUTABLE_PATH_MISMATCH';
    else invalidReason = 'PARENT_PROTOCOL_INVALID';
  }
  return {
    status: proc.status,
    signal: proc.signal || null,
    spawnError,
    timedOut,
    parseError,
    protocolErrors: [...protocolErrors],
    invalidReason,
    resultPresent: Boolean(result),
    failedAssertionIds: failedAssertionIds(result),
  };
}

export function expectedActualDiff(expected = [], actual = [], allowed = []) {
  const expectedSet = new Set(expected);
  const allowedSet = new Set([...expected, ...allowed]);
  return {
    expectedMissing: [...expectedSet].filter((id) => !actual.includes(id)),
    unexpectedFailed: actual.filter((id) => !allowedSet.has(id)),
  };
}

export function firstRejectReason({ replacementCountMatches, sourceChanged, executableUnderMutantRoot, processClass, expectedMissing, unexpectedFailed, hashProofPass, rootMatch, runIdMatch, cleanupPass }) {
  if (!replacementCountMatches) return 'REPLACEMENT_COUNT_MISMATCH';
  if (!sourceChanged) return 'MUTATED_SOURCE_UNCHANGED';
  if (!executableUnderMutantRoot) return 'EXECUTABLE_OUTSIDE_MUTANT_ROOT';
  if (processClass.invalidReason) return processClass.invalidReason;
  if (!rootMatch) return 'ROOT_MISMATCH';
  if (!runIdMatch) return 'RUN_ID_MISMATCH';
  if (!hashProofPass) return 'HASH_PROOF_FAILED';
  if (!cleanupPass) return 'CLEANUP_FAILED';
  if (expectedMissing.length) return 'EXPECTED_FAILURE_NOT_OBSERVED';
  if (unexpectedFailed.length) return 'UNEXPECTED_FAILURES';
  return '';
}

export function evaluateChildLikeMutation({ mutation, replacement, run, baselineSha = '', mutatedSha = '', executablePath = '', mutantRoot = '' }) {
  const processClass = classifyProcess(run);
  const replacementCountMatches = replacement.replacementCount === mutation.requiredReplacementCount;
  const sourceChanged = Boolean(mutatedSha && baselineSha && mutatedSha !== baselineSha);
  const executableUnderMutantRoot = path.resolve(executablePath || '').startsWith(path.resolve(mutantRoot || ''));
  const actualFailedAssertions = processClass.failedAssertionIds;
  const { expectedMissing, unexpectedFailed } = expectedActualDiff(
    mutation.expectedFailedAssertions || [],
    actualFailedAssertions,
    mutation.allowedAdditionalFailures || [],
  );
  const result = run.result || {};
  const hashProofPass = Boolean(result.targetAdminSha256 && result.targetAdminSha256 === result.importedAdminSha256 && result.targetGateSha256 && result.targetGateSha256 === result.importedGateSha256);
  const rootMatch = run.result ? path.resolve(run.result.root || '') === path.resolve(run.expectedRoot || '') : false;
  const runIdMatch = run.result ? run.result.runId === run.expectedRunId : false;
  const cleanupPass = Array.isArray(result.remainingOwnedPaths) ? result.remainingOwnedPaths.length === 0 : false;
  let accepted = false;
  let reason = '';
  if (mutation.expectedOutcome === 'EXPECTED_TEST_FAILURE') {
    accepted = Boolean(
      replacementCountMatches
      && sourceChanged
      && executableUnderMutantRoot
      && processClass.status === 1
      && !processClass.signal
      && !processClass.spawnError
      && !processClass.timedOut
      && processClass.protocolErrors.length === 0
      && !processClass.parseError
      && rootMatch
      && runIdMatch
      && hashProofPass
      && cleanupPass
      && expectedMissing.length === 0
      && unexpectedFailed.length === 0
    );
    reason = accepted ? '' : firstRejectReason({ replacementCountMatches, sourceChanged, executableUnderMutantRoot, processClass, expectedMissing, unexpectedFailed, hashProofPass, rootMatch, runIdMatch, cleanupPass });
    if (!reason && processClass.status === 0) reason = 'MUTANT_SURVIVED';
  } else if (mutation.expectedOutcome === 'EXPECTED_EXECUTION_INVALID') {
    reason = processClass.invalidReason || '';
    accepted = Boolean(replacementCountMatches && sourceChanged && executableUnderMutantRoot && reason === mutation.expectedInvalidReason);
    if (!accepted && !reason) reason = 'EXECUTION_WAS_VALID';
    if (!accepted && reason && reason !== mutation.expectedInvalidReason) reason = `EXPECTED_${mutation.expectedInvalidReason}_GOT_${reason}`;
  } else if (mutation.expectedOutcome === 'EXPECTED_ORACLE_REJECTION') {
    reason = firstRejectReason({ replacementCountMatches, sourceChanged, executableUnderMutantRoot, processClass, expectedMissing, unexpectedFailed, hashProofPass, rootMatch, runIdMatch, cleanupPass }) || 'ORACLE_ACCEPTED';
    accepted = reason === mutation.expectedRejectReason;
  }
  return {
    id: mutation.id,
    category: mutation.category,
    target: mutation.target,
    scenario: mutation.scenario || 'normal',
    expectedOutcome: mutation.expectedOutcome,
    replacementCount: replacement.replacementCount,
    requiredReplacementCount: mutation.requiredReplacementCount,
    replacementCountMatches,
    baselineSha,
    mutatedSha,
    sourceChanged,
    executablePath,
    executableUnderMutantRoot,
    processStatus: processClass.status,
    processSignal: processClass.signal,
    processError: processClass.spawnError,
    timedOut: processClass.timedOut,
    parseError: processClass.parseError,
    protocolErrors: processClass.protocolErrors,
    actualFailedAssertions,
    expectedFailedAssertions: mutation.expectedFailedAssertions || [],
    expectedMissing,
    unexpectedFailed,
    cleanupPass,
    hashProofPass,
    rootMatch,
    runIdMatch,
    accepted,
    status: accepted ? 'KILLED' : (mutation.expectedOutcome === 'EXPECTED_ORACLE_REJECTION' ? 'REJECTED_OR_FAILED' : (processClass.status === 0 ? 'SURVIVED' : 'EXECUTION_INVALID')),
    rejectReason: accepted ? '' : reason,
    observedRejectReason: reason,
  };
}

export function summarizeMutationRecords(records = []) {
  const byCategory = (category) => records.filter((r) => r.category === category);
  const count = (items, predicate) => items.filter(predicate).length;
  const product = byCategory('product');
  const child = byCategory('child-behavior');
  const parent = byCategory('parent-behavior');
  const controls = records.filter((r) => r.category === 'oracle-control' || r.expectedOutcome === 'EXPECTED_ORACLE_REJECTION');
  return {
    PRODUCT_MUTANTS_TOTAL: product.length,
    PRODUCT_MUTANTS_KILLED: count(product, (r) => r.accepted),
    PRODUCT_MUTANTS_SURVIVED: count(product, (r) => !r.accepted && r.processStatus === 0),
    PRODUCT_MUTANTS_EXECUTION_INVALID: count(product, (r) => !r.accepted && (r.protocolErrors?.length || r.timedOut || r.processSignal || Number(r.processStatus) >= 2)),
    CHILD_BEHAVIOR_MUTANTS_TOTAL: child.length,
    CHILD_BEHAVIOR_MUTANTS_KILLED: count(child, (r) => r.accepted),
    CHILD_BEHAVIOR_MUTANTS_SURVIVED: count(child, (r) => !r.accepted && r.processStatus === 0),
    CHILD_BEHAVIOR_MUTANTS_EXECUTION_INVALID: count(child, (r) => !r.accepted && (r.expectedOutcome === 'EXPECTED_EXECUTION_INVALID' || r.protocolErrors?.length || r.timedOut || r.processSignal || Number(r.processStatus) >= 2)),
    PARENT_BEHAVIOR_MUTANTS_TOTAL: parent.length,
    PARENT_BEHAVIOR_MUTANTS_KILLED: count(parent, (r) => r.accepted),
    PARENT_BEHAVIOR_MUTANTS_SURVIVED: count(parent, (r) => !r.accepted && r.processStatus === 0),
    PARENT_BEHAVIOR_MUTANTS_EXECUTION_INVALID: count(parent, (r) => !r.accepted && (r.expectedOutcome === 'EXPECTED_EXECUTION_INVALID' || r.protocolErrors?.length || r.timedOut || r.processSignal || Number(r.processStatus) >= 2)),
    ORACLE_CONTROLS_TOTAL: controls.length,
    ORACLE_CONTROLS_CORRECTLY_REJECTED: count(controls, (r) => r.accepted),
    ORACLE_CONTROLS_INCORRECTLY_ACCEPTED: count(controls, (r) => !r.accepted),
  };
}
