import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export function sha256Bytes(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
export function sha256File(file) { return sha256Bytes(fs.readFileSync(file)); }
export function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
export function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
export function writeJson(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
export function applyReplacement(root, mutation) {
  const target = path.join(root, mutation.target || '');
  if (!fs.existsSync(target)) return { replacementCount: 0, beforeSha: '', afterSha: '', sourceChanged: false, target };
  const before = fs.readFileSync(target);
  const beforeText = before.toString('utf8');
  const search = String(mutation.search || '');
  if (!search) return { replacementCount: 0, beforeSha: sha256Bytes(before), afterSha: sha256Bytes(before), sourceChanged: false, target };
  const parts = beforeText.split(search);
  const replacementCount = parts.length - 1;
  const afterText = parts.join(String(mutation.replacement ?? ''));
  fs.writeFileSync(target, afterText);
  const after = fs.readFileSync(target);
  return { replacementCount, beforeSha: sha256Bytes(before), afterSha: sha256Bytes(after), sourceChanged: sha256Bytes(before) !== sha256Bytes(after), target };
}
export function semanticKey(m) { return [m.target || '', m.search || '', m.replacement ?? '', m.scenario || 'normal'].join('\u0001'); }
export function validateManifest(records = []) {
  const errors = []; const ids = new Set(); const sem = new Map();
  for (const r of records) {
    if (!r.id) errors.push('MANIFEST_ID_MISSING');
    if (ids.has(r.id)) errors.push(`MANIFEST_ID_DUPLICATE:${r.id}`); ids.add(r.id);
    if (!['EXPECTED_TEST_FAILURE','EXPECTED_EXECUTION_INVALID','EXPECTED_PARENT_REJECTION','EXPECTED_ORACLE_REJECTION','EXPECTED_META_REJECTION'].includes(r.expectedOutcome)) errors.push(`OUTCOME_UNKNOWN:${r.id}`);
    if (!Number.isInteger(r.requiredReplacementCount) || r.requiredReplacementCount < 0) errors.push(`REPLACEMENT_COUNT_INVALID:${r.id}`);
    if (r.expectedOutcome === 'EXPECTED_TEST_FAILURE' && !(r.expectedFailedAssertions || []).length) errors.push(`EXPECTED_FAILURES_EMPTY:${r.id}`);
    if (r.expectedOutcome === 'EXPECTED_EXECUTION_INVALID' && !r.expectedInvalidReason) errors.push(`EXPECTED_INVALID_REASON_EMPTY:${r.id}`);
    const key = semanticKey(r); if (sem.has(key)) errors.push(`MANIFEST_SEMANTIC_DUPLICATE:${sem.get(key)}:${r.id}`); else sem.set(key, r.id);
  }
  return errors;
}
export function failedIds(result) { return (result?.assertions || []).filter((a)=>!a.pass).map((a)=>a.id); }
export function protocolErrors(result, expected = {}) {
  const errors = [];
  if (!result || typeof result !== 'object') return ['RESULT_NOT_OBJECT'];
  if (expected.protocolVersion && result.protocolVersion !== expected.protocolVersion) errors.push('PROTOCOL_VERSION');
  if (expected.runId && result.runId !== expected.runId) errors.push('RUN_ID');
  if (expected.root && path.resolve(result.root || '') !== path.resolve(expected.root)) errors.push('ROOT');
  if (expected.executablePath && path.resolve(result.executablePath || '') !== path.resolve(expected.executablePath)) errors.push('EXECUTABLE_PATH');
  if (!Array.isArray(result.assertions)) errors.push('ASSERTIONS_ARRAY');
  const ids = (result.assertions || []).map((a)=>a.id);
  if (new Set(ids).size !== ids.length) errors.push('DUPLICATE_ASSERTIONS');
  const pass = (result.assertions || []).filter((a)=>a.pass).length;
  const fail = (result.assertions || []).filter((a)=>!a.pass).length;
  if (result.passCount !== pass || result.failCount !== fail || result.totalCount !== ids.length) errors.push('COUNT_MISMATCH');
  return errors;
}
export function inspectProcess(record = {}, expected = {}) {
  const parseErrors = record.parseError ? ['PARSE_ERROR'] : [];
  const pErrors = record.result ? protocolErrors(record.result, expected) : ['RESULT_MISSING'];
  const timedOut = Boolean(record.timedOut || (record.error && /timed out/i.test(record.error)));
  const spawnError = String(record.spawnError || record.error || '');
  let invalidReason = '';
  if (spawnError && !timedOut) invalidReason = 'CHILD_SPAWN_ERROR';
  else if (timedOut) invalidReason = 'CHILD_TIMEOUT';
  else if (record.signal) invalidReason = 'CHILD_SIGNAL';
  else if ((record.status ?? 0) >= 2) invalidReason = 'ABNORMAL_CHILD_EXIT';
  else if (parseErrors.length || pErrors.length) invalidReason = 'PROTOCOL_INVALID';
  return { protocolErrors: [...parseErrors, ...pErrors], timedOut, spawnError, invalidReason };
}
export function evaluateExpectedTestFailure(mutation, replacement, processRecord, expected = {}) {
  const actualFailedAssertions = failedIds(processRecord.result);
  const expectedFailedAssertions = mutation.expectedFailedAssertions || [];
  const allowed = new Set([...expectedFailedAssertions, ...(mutation.allowedAdditionalFailures || [])]);
  const expectedMissing = expectedFailedAssertions.filter((id)=>!actualFailedAssertions.includes(id));
  const unexpectedFailed = actualFailedAssertions.filter((id)=>!allowed.has(id));
  const proc = inspectProcess(processRecord, expected);
  const replacementCountMatches = replacement.replacementCount === mutation.requiredReplacementCount;
  const executableUnderMutantRoot = !processRecord.executablePath || !processRecord.root ? true : path.resolve(processRecord.executablePath).startsWith(path.resolve(processRecord.root));
  const killed = Boolean(replacementCountMatches && replacement.sourceChanged && executableUnderMutantRoot && processRecord.status === 1 && !processRecord.signal && !proc.timedOut && !proc.spawnError && proc.protocolErrors.length === 0 && expectedMissing.length === 0 && unexpectedFailed.length === 0);
  let rejectReason = '';
  if (!killed) rejectReason = !replacementCountMatches ? 'REPLACEMENT_COUNT_MISMATCH' : !replacement.sourceChanged ? 'MUTATED_SOURCE_UNCHANGED' : !executableUnderMutantRoot ? 'EXECUTABLE_PATH_MISMATCH' : processRecord.status === 0 ? 'MUTANT_SURVIVED' : proc.invalidReason || expectedMissing.length ? 'EXPECTED_FAILURE_NOT_OBSERVED' : unexpectedFailed.length ? 'UNEXPECTED_FAILURES' : 'UNKNOWN_REJECTION';
  return { id: mutation.id, status: killed ? 'KILLED' : 'SURVIVED', accepted: killed, rejectReason, replacementCountMatches, sourceChanged: replacement.sourceChanged, actualFailedAssertions, expectedFailedAssertions, expectedMissing, unexpectedFailed, processStatus: processRecord.status, processSignal: processRecord.signal || null, protocolErrors: proc.protocolErrors };
}
export function listOwned(prefix) { try { return fs.readdirSync('/tmp').filter((n)=>n.startsWith(prefix)).map((n)=>path.join('/tmp',n)).filter(isDir); } catch { return []; } }
export function cleanupPath(p) { if (p) fs.rmSync(p, { recursive: true, force: true }); }
