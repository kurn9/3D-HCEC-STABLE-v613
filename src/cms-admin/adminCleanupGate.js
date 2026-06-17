import { ADMIN_COPY } from './adminCopy.js';
import { ADMIN_FEATURE_FLAGS, ADMIN_ROLES, CMS_STORAGE_CLEANUP_CONFIG } from './adminConfig.js';
import { dryRunCmsStorageCleanup, safeDeleteCmsStorageCleanup, scanCmsStorageCleanup } from './adminApi.js';
import { getState, setCmsStorageCleanupState } from './adminState.js';
import {
  appendChildren,
  createElement,
  formatCount,
  normalizeErrorMessage,
  renderBadge,
  renderEmptyState,
  renderErrorBox,
  safeArray,
} from './adminUtils.js';

function renderCleanupOperatorSteps(copy = {}) {
  const config = copy.operatorSteps || {};
  const steps = safeArray(config.steps);
  if (!config.title && !steps.length) return createElement('div');
  const panel = createElement('section', { className: 'cms-admin-cleanup-step-panel cms-admin-operator-step-panel' });
  panel.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: config.title || 'Các bước quét & dọn tệp' }));
  if (config.subtitle) panel.appendChild(createElement('p', { className: 'cms-admin-help-text', text: config.subtitle }));
  const list = createElement('ol', { className: 'cms-admin-operator-step-list' });
  steps.forEach((step, index) => {
    const item = createElement('li');
    item.appendChild(createElement('span', { className: 'cms-admin-operator-step-number', text: String(index + 1) }));
    item.appendChild(createElement('span', { className: 'cms-admin-operator-step-body', text: step }));
    list.appendChild(item);
  });
  panel.appendChild(list);
  if (config.note) panel.appendChild(createElement('p', { className: 'cms-admin-operator-step-note', text: config.note }));
  return panel;
}

export function renderCmsStorageCleanupTab(state = getState(), options = {}) {
  const copy = ADMIN_COPY.cleanup || {};
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-cleanup-view' });
  panel.appendChild(renderCleanupTitle(copy));
  panel.appendChild(renderCleanupOperatorSteps(copy));
  panel.appendChild(renderCleanupNotice(copy));

  if (!canUseCleanupScan(state)) {
    panel.appendChild(renderErrorBox('Chỉ quản trị viên đang hoạt động được quét và dọn dẹp có xác nhận.', 'Không có quyền dọn dẹp'));
    return panel;
  }

  panel.appendChild(renderCleanupControls(state, options));
  panel.appendChild(renderCleanupResult(state, options));
  return panel;
}

function renderCleanupTitle(copy = {}) {
  const header = createElement('div', { className: 'cms-admin-cleanup-header' });
  const left = createElement('div');
  left.appendChild(createElement('h3', { className: 'cms-admin-section-title', text: copy.title || 'Quét & dọn tệp' }));
  left.appendChild(createElement('p', { className: 'cms-admin-compact-copy', text: copy.intro || 'Chỉ quét và kiểm tra. Không xóa dữ liệu.' }));
  const badges = createElement('div', { className: 'cms-admin-cleanup-badges' });
  badges.appendChild(renderBadge(copy.status || 'Quét và kiểm tra trước', 'warning'));
  badges.appendChild(renderBadge('Dọn dẹp tự do đang tắt', 'success'));
  badges.appendChild(renderBadge('Không dọn nội dung website', 'success'));
  appendChildren(header, [left, badges]);
  return header;
}

function renderCleanupNotice(copy = {}) {
  const wrap = createElement('div', { className: 'cms-admin-alert cms-admin-alert-info' });
  wrap.appendChild(createElement('strong', { text: 'An toàn dữ liệu' }));
  wrap.appendChild(createElement('p', { text: copy.deleteDisabled || 'Dọn dẹp tự do đang bị tắt ở cả giao diện và server.' }));
  wrap.appendChild(createElement('p', { text: 'Màn này không tự xóa tệp khi chỉ mở, quét hoặc kiểm tra.' }));
  return wrap;
}

function renderCleanupControls(state, options = {}) {
  const cleanup = state.storageCleanup || {};
  const copy = ADMIN_COPY.cleanup || {};
  const controls = createElement('section', { className: 'cms-admin-cleanup-controls' });

  const scopeSelect = createElement('select', { className: 'cms-admin-select', ariaLabel: copy.controls?.scope || 'Phạm vi' });
  ['all', 'media', 'versions', 'drafts'].forEach((scope) => {
    scopeSelect.appendChild(createElement('option', { value: scope, text: copy.scopes?.[scope] || scope }));
  });
  scopeSelect.value = cleanup.scope || CMS_STORAGE_CLEANUP_CONFIG.defaultScope || 'all';
  scopeSelect.addEventListener('change', () => setCmsStorageCleanupState({ scope: scopeSelect.value }));

  const retentionInput = createElement('input', {
    className: 'cms-admin-input cms-admin-cleanup-number',
    type: 'number',
    value: cleanup.retentionDays || CMS_STORAGE_CLEANUP_CONFIG.defaultRetentionDays || 30,
    attrs: { min: String(CMS_STORAGE_CLEANUP_CONFIG.minRetentionDays || 7), step: '1' },
  });
  retentionInput.addEventListener('change', () => setCmsStorageCleanupState({ retentionDays: normalizeControlNumber(retentionInput.value, 30, 7, 3650) }));

  const keepInput = createElement('input', {
    className: 'cms-admin-input cms-admin-cleanup-number',
    type: 'number',
    value: cleanup.keepLastVersions || CMS_STORAGE_CLEANUP_CONFIG.defaultKeepLastVersions || 20,
    attrs: { min: String(CMS_STORAGE_CLEANUP_CONFIG.minKeepLastVersions || 5), step: '1' },
  });
  keepInput.addEventListener('change', () => setCmsStorageCleanupState({ keepLastVersions: normalizeControlNumber(keepInput.value, 20, 5, 500) }));

  const scanButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    text: cleanup.loading && cleanup.action === 'scan' ? (copy.controls?.scanning || 'Đang quét...') : (copy.controls?.scan || 'Quét lưu trữ'),
    type: 'button',
  });
  scanButton.disabled = cleanup.loading || !ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupScan;
  scanButton.addEventListener('click', () => handleCleanupAction('scan', options));

  const dryRunButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    text: cleanup.loading && cleanup.action === 'dryRun' ? (copy.controls?.dryRunning || 'Đang kiểm tra tệp...') : (copy.controls?.dryRun || 'Kiểm tra tệp có thể dọn'),
    type: 'button',
  });
  dryRunButton.disabled = cleanup.loading || !ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupScan;
  dryRunButton.addEventListener('click', () => handleCleanupAction('dryRun', options));

  appendChildren(controls, [
    renderLabeledControl(copy.controls?.scope || 'Phạm vi', scopeSelect),
    renderLabeledControl(copy.controls?.retentionDays || 'Retention tối thiểu (ngày)', retentionInput),
    renderLabeledControl(copy.controls?.keepLastVersions || 'Giữ version gần nhất', keepInput),
    createElement('div', { className: 'cms-admin-cleanup-actions' }),
  ]);
  controls.querySelector('.cms-admin-cleanup-actions')?.append(scanButton, dryRunButton);
  return controls;
}

function renderLabeledControl(label, control) {
  const wrap = createElement('label', { className: 'cms-admin-cleanup-control' });
  wrap.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: label }));
  wrap.appendChild(control);
  return wrap;
}

function renderCleanupResult(state, options = {}) {
  const cleanup = state.storageCleanup || {};
  const copy = ADMIN_COPY.cleanup || {};
  const result = cleanup.dryRunResult || cleanup.scanResult;
  const resultWrap = createElement('section', { className: 'cms-admin-cleanup-result' });

  if (cleanup.error) resultWrap.appendChild(renderErrorBox(cleanup.error, 'Không thể quét hoặc kiểm tra tệp'));
  if (!result) {
    resultWrap.appendChild(renderEmptyState(copy.noResult || 'Chưa có kết quả cleanup.'));
    return resultWrap;
  }

  resultWrap.appendChild(renderCleanupSummary(result));
  if (safeArray(result.warnings).length) resultWrap.appendChild(renderWarnings(result.warnings));
  const safeDeletePanel = renderSafeDeletePanel(state, result, options);
  if (safeDeletePanel) resultWrap.appendChild(safeDeletePanel);
  if (cleanup.safeDeleteResult) resultWrap.appendChild(renderSafeDeleteResult(cleanup.safeDeleteResult));
  resultWrap.appendChild(renderCleanupItems(result));
  return resultWrap;
}

function renderCleanupSummary(result = {}) {
  const summary = result.summary || {};
  const cards = createElement('div', { className: 'cms-admin-cleanup-summary-grid' });
  const rows = [
    ['Mã lần quét', result.runId || '—'],
    ['Thao tác', result.action === 'dryRun' ? 'Kiểm tra tệp có thể dọn' : result.action === 'scan' ? 'Quét tệp' : (result.action || '—')],
    ['Mã kế hoạch kiểm tra', result.planHash || '—'],
    ['Tệp media', formatCount(summary.cmsMediaObjects)],
    ['Phiên bản cũ', formatCount(summary.cmsPublicVersionObjects)],
    ['Dòng thông tin quản lý', formatCount(summary.metadataRows)],
    ['Bản nháp', formatCount(summary.draftRows)],
    ['Lịch sử vận hành', formatCount(summary.publishLogRows)],
    ['Có thể dọn', formatCount(summary.eligibleCount)],
    ['Không được dọn', formatCount(summary.blockedCount)],
    ['Dung lượng có thể giảm', formatCount(summary.estimatedBytesRecoverable)],
    ['Không an toàn để dọn', formatCount(summary.unsafeToDelete)],
  ];
  rows.forEach(([label, value]) => {
    const card = createElement('div', { className: 'cms-admin-cleanup-summary-card' });
    card.appendChild(createElement('span', { text: label }));
    card.appendChild(createElement('strong', { text: value }));
    cards.appendChild(card);
  });
  return cards;
}

function renderWarnings(warnings = []) {
  const box = createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning' });
  box.appendChild(createElement('strong', { text: 'Cảnh báo / ghi chú' }));
  const list = createElement('ul');
  safeArray(warnings).forEach((warning) => list.appendChild(createElement('li', { text: warning })));
  box.appendChild(list);
  return box;
}

function renderSafeDeleteResult(result = {}) {
  const box = createElement('div', { className: 'cms-admin-alert cms-admin-alert-info cms-admin-safe-delete-result' });
  box.appendChild(createElement('strong', { text: `Kết quả dọn dẹp có kiểm soát: ${result.executionStatus || result.error || 'result'}` }));
  box.appendChild(createElement('p', { text: `Đã dọn: ${formatCount(result.deletedCount || 0)} · Lỗi: ${formatCount(result.failedCount || 0)} · Bỏ qua: ${formatCount(result.skippedCount || 0)}` }));
  return box;
}

function renderSafeDeletePanel(state, result = {}, options = {}) {
  if (!ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupSafeDelete) return null;
  const cleanup = state.storageCleanup || {};
  const copy = ADMIN_COPY.cleanup || {};
  const summary = result.summary || {};
  const eligibleItems = safeArray(result.eligibleItems);
  const candidateItems = eligibleItems.filter(isA2SafeDeleteCandidate);
  const summaryEligibleCount = Number(summary.eligibleCount || 0);
  const responseHasEligibleButNoCandidates = summaryEligibleCount > candidateItems.length;
  const responseLooksLimited = hasLimitedCleanupItems(result);

  if (result.action !== 'dryRun' || !result.runId || !result.planHash) return null;
  if (result.graphIncomplete || summary.graphIncomplete) {
    return renderSafeDeleteLockedPanel(
      copy.safeDeleteTitle || 'Dọn dẹp có xác nhận',
      copy.safeDeleteGraphIncomplete || 'Không thể xóa vì dependency graph chưa đầy đủ.',
    );
  }
  if (responseLooksLimited) {
    return renderSafeDeleteLockedPanel(
      copy.safeDeleteTitle || 'Dọn dẹp có xác nhận',
      copy.safeDeleteLimited || 'Danh sách candidate cleanup có dấu hiệu bị giới hạn hoặc chưa tải đầy đủ. Dọn dẹp có kiểm soát đang bị khóa để tránh xác nhận khi chưa thấy rõ object sẽ xử lý.',
    );
  }
  if (responseHasEligibleButNoCandidates) {
    return renderSafeDeleteLockedPanel(
      copy.safeDeleteTitle || 'Dọn dẹp có xác nhận',
      copy.safeDeleteCandidateMissing || 'Có tệp có thể dọn trong tổng quan nhưng danh sách chưa hiển thị đầy đủ. Dọn dẹp đang khóa để tránh thao tác khi chưa thấy rõ tệp sẽ xử lý.',
    );
  }
  if (!candidateItems.length) {
    return renderSafeDeleteNoticePanel(
      copy.safeDeleteTitle || 'Dọn dẹp có xác nhận',
      copy.safeDeleteNoCandidates || 'Không có tệp nào đủ điều kiện dọn trong lần kiểm tra hiện tại.',
    );
  }

  const expectedPhrase = `DELETE ${String(result.runId).slice(0, 8)}`;
  const currentPhrase = cleanup.safeDeleteConfirmPhrase || '';
  const phraseMatches = String(currentPhrase).trim() === expectedPhrase;
  const panel = createElement('section', { className: 'cms-admin-safe-delete-panel' });
  panel.appendChild(createElement('h4', { className: 'cms-admin-subsection-title', text: copy.safeDeleteTitle || 'Dọn dẹp có xác nhận' }));
  panel.appendChild(createElement('p', { className: 'cms-admin-danger-copy', text: copy.safeDeleteWarning || 'Thao tác này sẽ xóa object trong Supabase Storage và không thể hoàn tác nếu không có backup.' }));

  const meta = createElement('div', { className: 'cms-admin-safe-delete-meta' });
  const metaRows = [
    ['Mã lần quét', result.runId],
    ['Mã kế hoạch kiểm tra', result.planHash],
    ['Tệp có thể dọn', formatCount(candidateItems.length)],
    ['Dung lượng có thể giảm', formatCount(summary.estimatedBytesRecoverable || 0)],
    ['Số ngày giữ lại', formatCount(result.retentionDays || cleanup.retentionDays || 30)],
    ['Số phiên bản giữ lại', formatCount(result.keepLastVersions || cleanup.keepLastVersions || 20)],
  ];
  metaRows.forEach(([label, value]) => {
    const item = createElement('div', { className: 'cms-admin-safe-delete-meta-item' });
    item.appendChild(createElement('span', { text: label }));
    item.appendChild(createElement('strong', { text: String(value || '—') }));
    meta.appendChild(item);
  });
  panel.appendChild(meta);

  panel.appendChild(renderSafeDeleteCandidateList(candidateItems));

  const confirmInput = createElement('input', {
    className: 'cms-admin-input cms-admin-safe-delete-confirm',
    type: 'text',
    value: currentPhrase,
    attrs: { placeholder: expectedPhrase, autocomplete: 'off' },
  });
  confirmInput.addEventListener('input', () => {
    setCmsStorageCleanupState({ safeDeleteConfirmPhrase: confirmInput.value });
    options.onRerender?.();
  });

  const deleteButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-danger',
    type: 'button',
    text: cleanup.loading && cleanup.action === 'safeDelete'
      ? (copy.controls?.safeDeleting || 'Đang dọn dẹp...')
      : (copy.controls?.safeDelete || 'Dọn dẹp có xác nhận'),
  });
  deleteButton.disabled = cleanup.loading || !phraseMatches;
  deleteButton.addEventListener('click', () => handleSafeDeleteAction(result, options));

  const controls = createElement('div', { className: 'cms-admin-safe-delete-controls' });
  controls.appendChild(createElement('p', { text: `${copy.safeDeleteConfirmHelp || 'Nhập đúng cụm xác nhận để bật nút xóa an toàn.'} Cụm xác nhận: ${expectedPhrase}` }));
  controls.appendChild(confirmInput);
  controls.appendChild(deleteButton);
  panel.appendChild(controls);
  return panel;
}


function renderSafeDeleteLockedPanel(title, message) {
  const warning = createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning cms-admin-safe-delete-panel cms-admin-safe-delete-locked' });
  warning.appendChild(createElement('strong', { text: title }));
  warning.appendChild(createElement('p', { text: message }));
  return warning;
}

function renderSafeDeleteNoticePanel(title, message) {
  const notice = createElement('div', { className: 'cms-admin-alert cms-admin-alert-info cms-admin-safe-delete-panel cms-admin-safe-delete-locked' });
  notice.appendChild(createElement('strong', { text: title }));
  notice.appendChild(createElement('p', { text: message }));
  return notice;
}

function hasLimitedCleanupItems(result = {}) {
  const summary = result.summary || {};
  const itemCount = Number(result.itemCount || 0);
  const responseLimit = Number(result.responseLimit || 0);
  return Boolean(
    result.itemsTruncated
      || result.hasMoreItems
      || result.limitApplied
      || result.responseTruncated
      || summary.itemsTruncated
      || summary.hasMoreItems
      || summary.limitApplied
      || summary.responseTruncated
      || (responseLimit > 0 && itemCount > responseLimit)
  );
}

function renderSafeDeleteCandidateList(items = []) {
  const list = createElement('div', { className: 'cms-admin-safe-delete-list' });
  safeArray(items).forEach((item) => {
    const row = createElement('div', { className: 'cms-admin-safe-delete-candidate' });
    row.appendChild(createElement('strong', { text: item.path || '—' }));
    row.appendChild(createElement('span', { text: `${item.bucket || '—'} · ${item.classification || '—'} · ${formatCount(item.sizeBytes || 0)} bytes` }));
    list.appendChild(row);
  });
  return list;
}

function isA2SafeDeleteCandidate(item = {}) {
  return item.bucket === 'cms-media'
    && item.objectKind === 'media_object'
    && item.classification === 'unreferenced'
    && item.eligible === true;
}

function renderCleanupItems(result = {}) {
  const copy = ADMIN_COPY.cleanup || {};
  const items = safeArray(result.eligibleItems).concat(safeArray(result.blockedItems), safeArray(result.items));
  const uniqueItems = dedupeItems(items);
  const tableWrap = createElement('div', { className: 'cms-admin-table-wrap cms-admin-cleanup-table-wrap' });
  const table = createElement('table', { className: 'cms-admin-table cms-admin-cleanup-table' });
  const thead = createElement('thead');
  const headRow = createElement('tr');
  (copy.headers || ['Bucket', 'Path', 'Loại', 'Phân loại', 'Eligible', 'Dung lượng', 'References', 'Lý do chặn']).forEach((label) => headRow.appendChild(createElement('th', { text: label })));
  thead.appendChild(headRow);
  const tbody = createElement('tbody');

  if (!uniqueItems.length) {
    const row = createElement('tr');
    const cell = createElement('td', { text: 'Không có tệp trong kết quả hoặc kết quả đã bị giới hạn.', attrs: { colspan: '8' } });
    row.appendChild(cell);
    tbody.appendChild(row);
  }

  uniqueItems.slice(0, 250).forEach((item) => {
    const row = createElement('tr');
    appendChildren(row, [
      createElement('td', { text: item.bucket || '—' }),
      createElement('td', { className: 'cms-admin-cleanup-path', text: item.path || '—' }),
      createElement('td', { text: item.objectKind || '—' }),
      createElement('td', { text: item.classification || '—' }),
      createElement('td', { text: item.eligible ? 'Có' : 'Không' }),
      createElement('td', { text: formatCount(item.sizeBytes || 0) }),
      createElement('td', { text: formatCount(item.referenceCount || safeArray(item.references).length) }),
      createElement('td', { text: item.blockedReason || '—' }),
    ]);
    tbody.appendChild(row);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  return tableWrap;
}

function dedupeItems(items = []) {
  const seen = new Set();
  const out = [];
  safeArray(items).forEach((item) => {
    const key = `${item.bucket || ''}/${item.path || ''}/${item.classification || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

async function handleSafeDeleteAction(result = {}, options = {}) {
  const current = getState();
  const cleanup = current.storageCleanup || {};
  const expectedPhrase = `DELETE ${String(result.runId || '').slice(0, 8)}`;
  if (String(cleanup.safeDeleteConfirmPhrase || '').trim() !== expectedPhrase) {
    setCmsStorageCleanupState({ error: 'Cụm xác nhận chưa đúng. Yêu cầu dọn dẹp chưa được gửi.' });
    options.onRerender?.();
    return;
  }

  setCmsStorageCleanupState({ loading: true, action: 'safeDelete', error: null });
  options.onRerender?.();

  const { data, error } = await safeDeleteCmsStorageCleanup(current.supabase, {
    runId: result.runId,
    planHash: result.planHash,
    confirmPhrase: cleanup.safeDeleteConfirmPhrase,
    scope: 'media',
    retentionDays: result.retentionDays || cleanup.retentionDays || 30,
    keepLastVersions: result.keepLastVersions || cleanup.keepLastVersions || 20,
  });

  if (error) {
    setCmsStorageCleanupState({ loading: false, action: '', error: normalizeErrorMessage(error), safeDeleteResult: data || null });
    options.onRerender?.();
    return;
  }

  setCmsStorageCleanupState({
    loading: false,
    action: '',
    error: null,
    safeDeleteResult: data,
    safeDeleteConfirmPhrase: '',
    loadedAt: new Date().toISOString(),
  });
  options.onRerender?.();
}

async function handleCleanupAction(action, options = {}) {
  const current = getState();
  const cleanup = current.storageCleanup || {};
  setCmsStorageCleanupState({ loading: true, action, error: null });
  options.onRerender?.();

  const payload = {
    scope: cleanup.scope || 'all',
    retentionDays: cleanup.retentionDays || 30,
    keepLastVersions: cleanup.keepLastVersions || 20,
    includeVersions: true,
    includeDrafts: true,
    includeLogs: true,
  };

  const { data, error } = action === 'dryRun'
    ? await dryRunCmsStorageCleanup(current.supabase, payload)
    : await scanCmsStorageCleanup(current.supabase, payload);

  if (error) {
    setCmsStorageCleanupState({ loading: false, action: '', error: normalizeErrorMessage(error) });
    options.onRerender?.();
    return;
  }

  setCmsStorageCleanupState({
    loading: false,
    action: '',
    error: null,
    scanResult: action === 'scan' ? data : cleanup.scanResult,
    dryRunResult: action === 'dryRun' ? data : cleanup.dryRunResult,
    loadedAt: new Date().toISOString(),
  });
  options.onRerender?.();
}

function canUseCleanupScan(state = getState()) {
  return Boolean(
    ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupScan
      && state.supabase
      && state.profile?.role === ADMIN_ROLES.admin
      && state.profile?.is_active === true
  );
}

function normalizeControlNumber(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
