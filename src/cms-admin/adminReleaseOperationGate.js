import { reconcileCmsReleasePointer } from './adminApi.js';
import {
  applyReleaseOperationGateFromServer,
  clearReleaseOperationGateFromExactIdle,
  getState,
  isExactIdleReleaseStatusPayload,
  setReleaseOperationGateState,
} from './adminState.js';
import { normalizeErrorMessage } from './adminUtils.js';

export function isResolvedCapableReleaseResponse(data = {}) {
  if (!data || typeof data !== 'object') return false;
  const classification = String(data.classification || '').trim();
  const operationState = String(data.state || data.operationState || data.operation?.state || '').trim();
  return Boolean(
    data.operationResolved === true
    || ['active_expected_release', 'active_other_release', 'operation_already_resolved', 'operation_already_resolved_non_success', 'lineage_repaired', 'failed_before_pointer', 'resolved_active_other'].includes(classification)
    || ['succeeded', 'resolved_active_other', 'failed_before_pointer', 'failed'].includes(operationState)
  );
}

export function isExactIdleReleaseStatusResult(result = {}, data = {}) {
  return Boolean(!result?.error && isExactIdleReleaseStatusPayload(data || {}));
}

export function applyReleaseOperationGateStatusResult(result = {}, data = {}, fallbackMessage = '') {
  const body = data && typeof data === 'object' ? data : {};
  if (isExactIdleReleaseStatusResult(result, body)) {
    clearReleaseOperationGateFromExactIdle(body);
    return true;
  }
  if (result?.error) {
    const errorMessage = normalizeErrorMessage(result.error) || fallbackMessage || 'Không xác nhận được trạng thái máy chủ. Không công khai hoặc khôi phục thêm.';
    const structured = {
      ...(body && typeof body === 'object' ? body : {}),
      ok: false,
      mode: 'status',
      classification: 'status_read_failed',
      code: result.error.code || 'RELEASE_OPERATION_STATUS_READ_FAILED',
      blocked: true,
      error: errorMessage,
    };
    applyReleaseOperationGateFromServer(structured, errorMessage);
    return false;
  }
  applyReleaseOperationGateFromServer(body && Object.keys(body).length ? body : {
    ok: false,
    mode: 'status',
    classification: 'malformed_status_response',
    code: 'RELEASE_OPERATION_STATUS_MALFORMED',
    blocked: true,
    error: fallbackMessage || 'Máy chủ trả trạng thái không hợp lệ. Gate vẫn khóa.',
  }, fallbackMessage || 'Máy chủ chưa xác nhận trạng thái idle. Gate vẫn khóa.');
  return false;
}

export async function refreshAndApplyReleaseOperationGateStatus({ client = null, fallbackMessage = '', successResult = null } = {}) {
  const activeClient = client || getState().supabase;
  setReleaseOperationGateState({ loading: true, error: null });
  const statusResult = await reconcileCmsReleasePointer(activeClient, { mode: 'status' });
  const statusData = statusResult.data || {};
  const idle = applyReleaseOperationGateStatusResult(statusResult, statusData, fallbackMessage);
  if (!idle && successResult) {
    setReleaseOperationGateState({ result: successResult, lastCheckedAt: new Date().toISOString() });
  }
  return { idle, result: statusResult, data: statusData };
}
