#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROTOCOLS = {
  child: 'v6.14.066.025-child',
  parent: 'v6.14.066.025-parent',
  meta: 'v6.14.066.025-meta',
};

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
  'hidden-cleanup-leak',
  'unexpected-failure',
  'spawn-error',
  'parse-error',
  'raw-missing',
]);

export function sha256Bytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
export function sha256Text(text) { return sha256Bytes(Buffer.from(String(text), 'utf8')); }
export function sha256File(file) { return sha256Bytes(fs.readFileSync(file)); }
export function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
export function isPlainRecord(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const p=Object.getPrototypeOf(value); return p===Object.prototype || p===null; }
export function add(assertions, id, pass, message='') { assertions.push({ id, pass: Boolean(pass), message: String(message || '') }); }
export function summarize(assertions, extra={}) { const passCount=assertions.filter(a=>a.pass).length; const failCount=assertions.filter(a=>!a.pass).length; return { ...extra, assertions, passCount, failCount, totalCount: assertions.length }; }
export function failedAssertionIds(result) { return Array.isArray(result?.assertions) ? result.assertions.filter(a=>!a.pass).map(a=>a.id) : []; }
export function duplicateValues(values) { const seen=new Set(), dup=new Set(); for (const v of values) { if (seen.has(v)) dup.add(v); seen.add(v); } return [...dup]; }
export function countOccurrences(text, search) { if (!search) return 0; return String(text).split(String(search)).length - 1; }
export function applyReplacement(root, mutation) {
  const target = path.join(root, mutation.target || '');
  if (!fs.existsSync(target)) return { targetExists:false, replacementCount:0, beforeSha:'', afterSha:'', sourceChanged:false, target };
  const before = fs.readFileSync(target, 'utf8');
  const beforeSha = sha256Text(before);
  const replacementCount = countOccurrences(before, mutation.search);
  const after = before.split(String(mutation.search || '')).join(String(mutation.replacement ?? ''));
  fs.writeFileSync(target, after);
  const afterSha = sha256Text(after);
  return { targetExists:true, replacementCount, beforeSha, afterSha, sourceChanged: beforeSha !== afterSha, target };
}
export function preflightManifest(root, records, label='manifest') {
  return records.map((m)=>{
    const target=path.join(root, m.target || '');
    const targetExists=fs.existsSync(target);
    const observedReplacementCount=targetExists ? countOccurrences(fs.readFileSync(target,'utf8'), m.search) : 0;
    return { id:m.id, category:m.category || label, target:m.target, targetExists, observedReplacementCount, requiredReplacementCount:m.requiredReplacementCount, expectedOutcome:m.expectedOutcome };
  });
}
export function validateManifestRecords(records, { root='', label='manifest', allowIntentionalReplacementMismatch=true }={}) {
  const errors=[];
  if (!Array.isArray(records)) return [`${label}: not array`];
  const ids = records.map(r=>r?.id || '<missing>');
  if (ids.includes('<missing>')) errors.push(`${label}: missing id`);
  const dupIds = duplicateValues(ids).filter(x=>x !== '<missing>');
  if (dupIds.length) errors.push(`${label}: duplicate ids ${dupIds.join(',')}`);
  const semantics = records.map(r=>`${r?.target||''}\n${r?.search||''}\n${r?.replacement||''}\n${r?.scenario||'normal'}`);
  if (duplicateValues(semantics).length) errors.push(`${label}: MANIFEST_SEMANTIC_DUPLICATE`);
  for (const r of records) {
    const p=`${label}:${r?.id || '<missing>'}`;
    if (!isPlainRecord(r)) { errors.push(`${p}: not object`); continue; }
    if (!OUTCOMES.has(r.expectedOutcome)) errors.push(`${p}: invalid expectedOutcome=${r.expectedOutcome}`);
    if (!VALID_SCENARIOS.has(r.scenario || 'normal')) errors.push(`${p}: invalid scenario=${r.scenario}`);
    if (!Number.isInteger(r.requiredReplacementCount) || r.requiredReplacementCount < 0) errors.push(`${p}: invalid requiredReplacementCount`);
    if (typeof r.target !== 'string' || !r.target) errors.push(`${p}: target missing`);
    if (typeof r.search !== 'string') errors.push(`${p}: search not string`);
    if (typeof r.replacement !== 'string') errors.push(`${p}: replacement not string`);
    if (r.expectedOutcome === 'EXPECTED_TEST_FAILURE' && (!Array.isArray(r.expectedFailedAssertions) || r.expectedFailedAssertions.length === 0)) errors.push(`${p}: expected assertions required`);
    if (r.expectedOutcome === 'EXPECTED_EXECUTION_INVALID' && !r.expectedInvalidReason) errors.push(`${p}: expected invalid reason required`);
    if (r.expectedOutcome === 'EXPECTED_ORACLE_REJECTION' && !r.expectedRejectReason) errors.push(`${p}: expected reject reason required`);
    if (r.expectedOutcome === 'EXPECTED_PARENT_REJECTION' && (!Array.isArray(r.expectedMetaViolationIds) || r.expectedMetaViolationIds.length === 0)) errors.push(`${p}: expected meta violations required`);
    if (root) {
      const t=path.join(root,r.target||'');
      if (!fs.existsSync(t)) { errors.push(`${p}: target not found`); continue; }
      const count=countOccurrences(fs.readFileSync(t,'utf8'), r.search);
      const intentional = allowIntentionalReplacementMismatch && r.expectedOutcome==='EXPECTED_ORACLE_REJECTION' && r.expectedRejectReason==='REPLACEMENT_COUNT_MISMATCH';
      if (!intentional && count !== r.requiredReplacementCount) errors.push(`${p}: replacement count ${count} != ${r.requiredReplacementCount}`);
    }
  }
  return errors;
}

export function validateChildResult(result, expectedRunId, expectedRoot, expectedExecutable) {
  const errors=[];
  if (!isPlainRecord(result)) return ['RESULT_NOT_OBJECT'];
  if (result.protocolVersion !== PROTOCOLS.child) errors.push('PROTOCOL_VERSION');
  if (result.runId !== expectedRunId) errors.push('RUN_ID');
  if (path.resolve(result.root || '') !== path.resolve(expectedRoot || '')) errors.push('ROOT');
  if (path.resolve(result.executablePath || '') !== path.resolve(expectedExecutable || '')) errors.push('EXECUTABLE_PATH');
  if (!Number.isInteger(result.pid) || result.pid <= 0) errors.push('PID');
  if (!Array.isArray(result.assertions)) errors.push('ASSERTIONS_ARRAY');
  const ids=Array.isArray(result.assertions) ? result.assertions.map(a=>a?.id || '<missing>') : [];
  if (ids.includes('<missing>')) errors.push('ASSERTION_ID_MISSING');
  if (duplicateValues(ids).length) errors.push('DUPLICATE_ASSERTIONS');
  const pass=Array.isArray(result.assertions) ? result.assertions.filter(a=>a.pass).length : 0;
  const fail=Array.isArray(result.assertions) ? result.assertions.filter(a=>!a.pass).length : 0;
  if (result.passCount !== pass || result.failCount !== fail || result.totalCount !== ids.length) errors.push('COUNT_MISMATCH');
  for (const k of ['targetAdminSha256','importedAdminSha256','targetGateSha256','importedGateSha256']) if (!result[k]) errors.push(`MISSING_${k}`);
  for (const k of ['ownedPathsCreated','ownedPathsRemoved','remainingOwnedPaths']) if (!Array.isArray(result[k])) errors.push(`MISSING_${k}`);
  if (!Array.isArray(result.migrationSourceFilesRead) || result.migrationSourceFilesRead.length < 5) errors.push('MIGRATION_SOURCE_FILES_READ');
  if (!isPlainRecord(result.migrationSourceHashes) || Object.keys(result.migrationSourceHashes).length < 5) errors.push('MIGRATION_SOURCE_HASHES');
  return errors;
}

export function validateParentResult(result, expectedRunId, expectedRoot, expectedExecutable) {
  const errors=[];
  if (!isPlainRecord(result)) return ['RESULT_NOT_OBJECT'];
  if (result.protocolVersion !== PROTOCOLS.parent) errors.push('PROTOCOL_VERSION');
  if (result.runId !== expectedRunId) errors.push('RUN_ID');
  if (path.resolve(result.root || '') !== path.resolve(expectedRoot || '')) errors.push('ROOT');
  if (path.resolve(result.executablePath || '') !== path.resolve(expectedExecutable || '')) errors.push('EXECUTABLE_PATH');
  if (!Array.isArray(result.assertions)) errors.push('ASSERTIONS_ARRAY');
  const ids=Array.isArray(result.assertions) ? result.assertions.map(a=>a?.id || '<missing>') : [];
  if (ids.includes('<missing>')) errors.push('ASSERTION_ID_MISSING');
  if (duplicateValues(ids).length) errors.push('DUPLICATE_ASSERTIONS');
  const pass=Array.isArray(result.assertions) ? result.assertions.filter(a=>a.pass).length : 0;
  const fail=Array.isArray(result.assertions) ? result.assertions.filter(a=>!a.pass).length : 0;
  if (result.passCount !== pass || result.failCount !== fail || result.totalCount !== ids.length) errors.push('COUNT_MISMATCH');
  if (!Array.isArray(result.childProcessRecords)) errors.push('CHILD_PROCESS_RECORDS');
  if (!isPlainRecord(result.processSummary)) errors.push('PROCESS_SUMMARY');
  return errors;
}

export function classifyProcess(proc, result, protocolErrors=[], parseError='') {
  const spawnError=proc?.error?.message || '';
  const timedOut=Boolean(spawnError && /timed out/i.test(spawnError));
  if (timedOut) return 'CHILD_TIMEOUT';
  if (spawnError) return 'CHILD_SPAWN_ERROR';
  if (proc?.signal) return 'CHILD_SIGNAL';
  if (parseError || protocolErrors.length) return 'PROTOCOL_INVALID';
  if (!result) return 'PROTOCOL_INVALID';
  if (Number(proc?.status) >= 2) return 'ABNORMAL_CHILD_EXIT';
  return '';
}

export function evaluateProcessMutation(mutation, replacement, run, expectedRoot, expectedExecutable) {
  const actualFailedAssertions=failedAssertionIds(run.result);
  const expected=mutation.expectedFailedAssertions || [];
  const allowed=new Set([...(mutation.allowedAdditionalFailures || []), ...expected]);
  const expectedMissing=expected.filter(id=>!actualFailedAssertions.includes(id));
  const unexpectedFailed=actualFailedAssertions.filter(id=>!allowed.has(id));
  const protocolErrors=run.protocolErrors || [];
  const invalidReason=classifyProcess(run.proc, run.result, protocolErrors, run.parseError || '');
  const executableUnderMutantRoot=path.resolve(run.executablePath || '').startsWith(path.resolve(expectedRoot));
  const cleanupPass=Array.isArray(run.result?.remainingOwnedPaths) && run.result.remainingOwnedPaths.length === 0 && Array.isArray(run.filesystemRemainingOwnedPaths) && run.filesystemRemainingOwnedPaths.length === 0;
  const hashProofPass=Boolean(run.result && run.result.targetAdminSha256 === run.result.importedAdminSha256 && run.result.targetGateSha256 === run.result.importedGateSha256);
  let accepted=false, status='SURVIVED', rejectReason='';
  const replacementCountMatches=replacement.replacementCount === mutation.requiredReplacementCount;
  const sourceChanged=replacement.beforeSha && replacement.afterSha && replacement.beforeSha !== replacement.afterSha;
  if (mutation.expectedOutcome === 'EXPECTED_ORACLE_REJECTION') {
    const actualReject = !replacementCountMatches ? 'REPLACEMENT_COUNT_MISMATCH'
      : !sourceChanged ? 'MUTATED_SOURCE_UNCHANGED'
      : expectedMissing.length ? 'EXPECTED_FAILURE_NOT_OBSERVED'
      : unexpectedFailed.length ? 'UNEXPECTED_FAILURES'
      : 'NOT_REJECTED';
    if (actualReject === mutation.expectedRejectReason) { accepted=true; status='REJECTED'; rejectReason=actualReject; }
    else rejectReason=actualReject;
  } else if (!replacementCountMatches) rejectReason='REPLACEMENT_COUNT_MISMATCH';
  else if (!sourceChanged) rejectReason='MUTATED_SOURCE_UNCHANGED';
  else if (!executableUnderMutantRoot) rejectReason='EXECUTABLE_NOT_UNDER_MUTANT_ROOT';
  else if (mutation.expectedOutcome === 'EXPECTED_TEST_FAILURE') {
    if (invalidReason) rejectReason=invalidReason;
    else if (Number(run.proc.status) === 0) rejectReason='EXPECTED_FAILURE_NOT_OBSERVED';
    else if (Number(run.proc.status) !== 1) rejectReason='ABNORMAL_CHILD_EXIT';
    else if (expectedMissing.length) rejectReason='EXPECTED_FAILURE_NOT_OBSERVED';
    else if (unexpectedFailed.length) rejectReason='UNEXPECTED_FAILURES';
    else if (!hashProofPass && !expected.some((id)=>String(id).startsWith('HASH_') || String(id).startsWith('IMPORT_SOURCE_'))) rejectReason='HASH_PROOF_FAILED';
    else if (!cleanupPass && !expected.some((id)=>String(id).startsWith('CLEANUP_') || String(id).startsWith('REPORTED_CLEANUP_'))) rejectReason='CLEANUP_FAILED';
    else { accepted=true; status='KILLED'; }
  } else if (mutation.expectedOutcome === 'EXPECTED_EXECUTION_INVALID') {
    const effectiveInvalidReason = invalidReason || (!cleanupPass ? 'CLEANUP_FAILED' : '');
    if (effectiveInvalidReason === mutation.expectedInvalidReason) { accepted=true; status='KILLED'; }
    else rejectReason=effectiveInvalidReason || 'EXECUTION_VALID';
  }
  return {
    id: mutation.id,
    category: mutation.category || '',
    expectedOutcome: mutation.expectedOutcome,
    expectedInvalidReason: mutation.expectedInvalidReason || '',
    target: mutation.target,
    replacementCount: replacement.replacementCount,
    requiredReplacementCount: mutation.requiredReplacementCount,
    replacementCountMatches,
    beforeSha: replacement.beforeSha,
    afterSha: replacement.afterSha,
    sourceChanged: Boolean(sourceChanged),
    executablePath: run.executablePath || '',
    executableUnderMutantRoot,
    processStatus: run.proc?.status ?? null,
    processSignal: run.proc?.signal || null,
    processError: run.proc?.error?.message || '',
    protocolErrors,
    invalidReason,
    actualFailedAssertions,
    expectedFailedAssertions: expected,
    expectedMissing,
    unexpectedFailed,
    hashProofPass,
    cleanupPass,
    accepted,
    status,
    rejectReason,
  };
}
