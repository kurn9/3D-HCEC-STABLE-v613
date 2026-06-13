import { ADMIN_FEATURE_FLAGS, CMS_ROLLBACK_GATE_CONFIG } from './adminConfig.js';
import { listCmsPublishLogs, previewCmsPublishedVersion, rollbackCmsJson } from './adminApi.js';
import {
  appendChildren,
  createElement,
  formatDateTime,
  normalizeErrorMessage,
  renderBadge,
  renderEmptyState,
  renderErrorBox,
  safeArray,
  toDisplayText,
} from './adminUtils.js';
import {
  getState,
  setCmsPublishHistoryItems,
  setCmsPublishHistoryState,
} from './adminState.js';

let historyLoadQueued = false;

export function renderRollbackHistoryTab(state, handlers = {}) {
  const historyState = state.publishHistory || {};
  const panel = createElement('section', { className: 'cms-admin-grid cms-admin-rollback-history-view' });

  panel.appendChild(renderHistoryIntro(state, historyState, handlers));
  panel.appendChild(renderHistoryListPanel(state, historyState, handlers));
  panel.appendChild(renderVersionPreviewPanel(historyState));
  panel.appendChild(renderRollbackPanel(state, historyState, handlers));

  if (shouldAutoLoadHistory(state, historyState)) {
    queueLoadPublishHistory(handlers);
  }

  return panel;
}

function renderHistoryIntro(state = {}, historyState = {}, handlers = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-rollback-hero-panel' });
  const top = createElement('div', { className: 'cms-admin-panel-title-row' });
  top.appendChild(createElement('h2', { className: 'cms-admin-panel-title', text: 'Lịch sử công khai' }));
  top.appendChild(renderBadge(isRollbackAdmin(state) ? 'Admin' : 'Chỉ xem/không đủ quyền', isRollbackAdmin(state) ? 'success' : 'warning'));
  panel.appendChild(top);
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Xem log publish/rollback, preview version JSON và rollback latest qua Edge Function rollback-cms-json. Rollback sẽ thay đổi website public và chỉ dành cho admin đang hoạt động.',
  }));
  panel.appendChild(createElement('div', {
    className: 'cms-admin-alert cms-admin-alert-warning',
    text: 'Không xóa version/backup, không DB-first rollback, không gọi script I_F từ browser. Hãy dry-run và xác nhận 2 bước trước khi rollback thật.',
  }));
  const actions = createElement('div', { className: 'cms-admin-actions' });
  const refreshButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    type: 'button',
    text: historyState.loading ? 'Đang tải...' : 'Làm mới lịch sử',
  });
  refreshButton.disabled = Boolean(historyState.loading) || !isRollbackAdmin(state);
  refreshButton.addEventListener('click', () => handleLoadPublishHistory(handlers));
  actions.appendChild(refreshButton);
  panel.appendChild(actions);
  if (!isRollbackAdmin(state)) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: 'Phase này chỉ admin đang hoạt động được xem lịch sử và rollback.' }));
  }
  return panel;
}

function renderHistoryListPanel(state = {}, historyState = {}, handlers = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-rollback-list-panel' });
  const title = createElement('div', { className: 'cms-admin-panel-title-row' });
  title.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: 'Log publish / rollback' }));
  title.appendChild(renderBadge(`${safeArray(historyState.items).length} dòng`, 'default'));
  panel.appendChild(title);

  if (historyState.error) {
    panel.appendChild(renderErrorBox(historyState.error, 'Không tải được lịch sử'));
  }
  if (historyState.loading && !safeArray(historyState.items).length) {
    panel.appendChild(renderEmptyState('Đang tải lịch sử công khai...'));
    return panel;
  }

  const list = safeArray(historyState.items);
  if (!list.length) {
    panel.appendChild(renderEmptyState('Chưa có log publish/rollback hoặc tài khoản chưa có quyền xem.'));
    return panel;
  }

  const table = createElement('div', { className: 'cms-admin-rollback-table' });
  list.forEach((log) => table.appendChild(renderHistoryLogCard(log, state, historyState, handlers)));
  panel.appendChild(table);
  return panel;
}

function renderHistoryLogCard(log = {}, state = {}, historyState = {}, handlers = {}) {
  const card = createElement('article', { className: 'cms-admin-rollback-log-card' });
  const head = createElement('div', { className: 'cms-admin-rollback-log-head' });
  const title = createElement('div', { className: 'cms-admin-cell-stack' });
  title.appendChild(createElement('strong', { text: log.published_version || 'Không rõ version' }));
  title.appendChild(createElement('span', { className: 'cms-admin-cell-sub', text: `${getOperationLabel(log)} • ${formatDateTime(log.created_at)}` }));
  const statusVariant = log.status === 'published' || log.status === 'rolled_back' || log.status === 'dry_run_pass' ? 'success' : 'warning';
  appendChildren(head, [title, renderBadge(log.status || 'unknown', statusVariant)]);
  card.appendChild(head);

  const meta = createElement('div', { className: 'cms-admin-rollback-meta-grid' });
  [
    ['Latest', log.latest_path],
    ['Version path', log.version_path],
    ['Backup path', log.backup_path],
    ['Rollback source', log.rollback_from_path],
    ['Hash before', shortenHash(log.hash_before)],
    ['Hash after', shortenHash(log.hash_after)],
  ].forEach(([label, value]) => meta.appendChild(renderMeta(label, value)));
  card.appendChild(meta);

  if (log.error_message) {
    card.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-error', text: log.error_message }));
  }
  const sourcePath = getRollbackCandidatePath(log);
  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-rollback-log-actions' });
  const previewButton = createElement('button', { className: 'cms-admin-button cms-admin-button-secondary', type: 'button', text: 'Preview JSON version' });
  previewButton.disabled = !isRollbackAdmin(state) || !sourcePath || historyState.isPreviewing;
  previewButton.addEventListener('click', () => handlePreviewVersion(sourcePath, handlers));

  const dryRunButton = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost', type: 'button', text: 'Dry-run rollback' });
  dryRunButton.disabled = !isRollbackAdmin(state) || !sourcePath || historyState.isRollingBack;
  dryRunButton.addEventListener('click', () => handleRollbackCmsJson({ sourcePath, dryRun: true, handlers }));

  const selectButton = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost', type: 'button', text: 'Chọn để rollback' });
  selectButton.disabled = !isRollbackAdmin(state) || !sourcePath;
  selectButton.addEventListener('click', () => {
    setCmsPublishHistoryState({ selectedLogId: log.id || '', previewError: null, rollbackError: null, rollbackStatus: `Đã chọn ${sourcePath}. Hãy dry-run trước khi rollback thật.` });
    handlers.onRerender?.();
  });

  appendChildren(actions, [previewButton, dryRunButton, selectButton]);
  card.appendChild(actions);
  return card;
}

function renderVersionPreviewPanel(historyState = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-rollback-preview-panel' });
  panel.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: 'Preview version JSON' }));
  if (historyState.previewError) {
    panel.appendChild(renderErrorBox(historyState.previewError, 'Preview chưa thành công'));
  }
  if (historyState.isPreviewing) {
    panel.appendChild(renderEmptyState('Đang đọc version object...'));
    return panel;
  }
  const preview = historyState.previewResult;
  if (!preview) {
    panel.appendChild(renderEmptyState('Chọn một version object để preview. Preview chỉ đọc, không thay đổi website.'));
    return panel;
  }
  const grid = createElement('div', { className: 'cms-admin-rollback-meta-grid' });
  [
    ['Source path', preview.sourcePath],
    ['Version', preview.version],
    ['Schema', preview.schemaVersion],
    ['Indoor', preview.indoorCount],
    ['Outdoor', preview.outdoorCount],
    ['SHA256', shortenHash(preview.hash)],
    ['Size', `${preview.sizeBytes || 0} bytes`],
  ].forEach(([label, value]) => grid.appendChild(renderMeta(label, value)));
  panel.appendChild(grid);
  const details = createElement('details', { className: 'cms-admin-rollback-json-details' });
  details.appendChild(createElement('summary', { text: 'Xem JSON rút gọn' }));
  details.appendChild(createElement('pre', { className: 'cms-admin-code-block', text: JSON.stringify(preview.json, null, 2).slice(0, 8000) }));
  panel.appendChild(details);
  return panel;
}

function renderRollbackPanel(state = {}, historyState = {}, handlers = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-rollback-action-panel' });
  panel.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: 'Rollback có kiểm soát' }));
  const selectedLog = safeArray(historyState.items).find((item) => item.id === historyState.selectedLogId) || null;
  const selectedPath = getRollbackCandidatePath(selectedLog || {}) || historyState.previewResult?.sourcePath || historyState.rollbackDryRunResult?.sourcePath || '';
  if (!selectedPath) {
    panel.appendChild(renderEmptyState('Chưa chọn version để rollback. Hãy preview hoặc dry-run một version trước.'));
  } else {
    panel.appendChild(createElement('p', { className: 'cms-admin-help-text cms-admin-mono', text: selectedPath }));
  }

  const reasonInput = createElement('textarea', {
    className: 'cms-admin-input',
    value: historyState.rollbackReason || '',
    attrs: { rows: '3', placeholder: 'Nhập lý do rollback trước khi rollback thật' },
  });
  reasonInput.addEventListener('change', () => {
    setCmsPublishHistoryState({ rollbackReason: reasonInput.value });
    handlers.onRerender?.();
  });
  panel.appendChild(labeledControl('Lý do rollback', reasonInput));

  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-rollback-actions' });
  const dryRunButton = createElement('button', { className: 'cms-admin-button cms-admin-button-secondary', type: 'button', text: historyState.isRollingBack ? 'Đang kiểm tra...' : 'Dry-run rollback' });
  dryRunButton.disabled = !isRollbackAdmin(state) || !selectedPath || historyState.isRollingBack;
  dryRunButton.addEventListener('click', () => handleRollbackCmsJson({ sourcePath: selectedPath, dryRun: true, handlers }));

  const rollbackButton = createElement('button', { className: 'cms-admin-button cms-admin-button-danger', type: 'button', text: historyState.isRollingBack ? 'Đang rollback...' : 'Rollback về bản này' });
  rollbackButton.disabled = !isRollbackAdmin(state) || !selectedPath || historyState.isRollingBack || !canDoRealRollback(historyState, selectedPath);
  rollbackButton.addEventListener('click', () => handleRollbackCmsJson({ sourcePath: selectedPath, dryRun: false, handlers }));
  appendChildren(actions, [dryRunButton, rollbackButton]);
  panel.appendChild(actions);

  if (!isRollbackAdmin(state)) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: 'Phase này chỉ admin đang hoạt động được rollback.' }));
  }
  if (historyState.rollbackStatus) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: historyState.rollbackStatus }));
  }
  if (historyState.rollbackError) {
    panel.appendChild(renderErrorBox(historyState.rollbackError, 'Rollback chưa thành công'));
  }
  panel.appendChild(renderRollbackResult(historyState.rollbackResult || historyState.rollbackDryRunResult));
  panel.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Rollback thật sẽ backup latest hiện tại, ghi selected version vào latest, verify lại và restore previous latest nếu verify fail.' }));
  return panel;
}

function renderRollbackResult(result) {
  const wrap = createElement('div', { className: 'cms-admin-rollback-result' });
  if (!result) return wrap;
  const grid = createElement('div', { className: 'cms-admin-rollback-meta-grid' });
  [
    ['Trạng thái', result.ok === true ? 'PASS' : 'FAIL'],
    ['Chế độ', result.dryRun ? 'Dry-run' : 'Rollback'],
    ['Source', result.sourcePath],
    ['Latest', result.latestPath || result.wouldWriteLatestPath],
    ['Backup', result.backupPath || result.wouldBackupCurrentLatestPath],
    ['Version', result.rollbackVersion || result.sourceVersion],
    ['Hash', shortenHash(result.hashAfter || result.sourceHash)],
    ['Verify', result.verifyStatus || result.verify?.status || '—'],
  ].forEach(([label, value]) => grid.appendChild(renderMeta(label, value)));
  wrap.appendChild(grid);
  if (result.restoreAttempted) {
    wrap.appendChild(createElement('div', {
      className: result.restoreVerified ? 'cms-admin-alert cms-admin-alert-success' : 'cms-admin-alert cms-admin-alert-error',
      text: result.restoreVerified ? 'Rollback lỗi nhưng latest cũ đã được restore.' : 'Rollback lỗi và restore latest cũ chưa được xác minh. Cần operator kiểm tra ngay.',
    }));
  }
  return wrap;
}

function renderMeta(label, value) {
  const node = createElement('div', { className: 'cms-admin-rollback-meta-item' });
  node.appendChild(createElement('span', { text: label }));
  node.appendChild(createElement('strong', { className: String(value || '').length > 36 ? 'cms-admin-mono' : '', text: toDisplayText(value, '—') }));
  return node;
}

async function handleLoadPublishHistory(handlers = {}) {
  const state = getState();
  if (!isRollbackAdmin(state)) {
    setCmsPublishHistoryState({ error: 'Phase này chỉ admin đang hoạt động được xem lịch sử công khai.' });
    handlers.onRerender?.();
    return;
  }
  setCmsPublishHistoryState({ loading: true, error: null });
  handlers.onRerender?.();
  const result = await listCmsPublishLogs(state.supabase, { limit: 60 });
  if (result.error) {
    setCmsPublishHistoryState({ loading: false, error: normalizeErrorMessage(result.error) });
  } else {
    setCmsPublishHistoryItems(result.data || []);
  }
  handlers.onRerender?.();
}

async function handlePreviewVersion(sourcePath, handlers = {}) {
  setCmsPublishHistoryState({ isPreviewing: true, previewError: null, selectedLogId: '', rollbackStatus: '' });
  handlers.onRerender?.();
  const result = await previewCmsPublishedVersion(sourcePath);
  if (result.error) {
    setCmsPublishHistoryState({ isPreviewing: false, previewError: normalizeErrorMessage(result.error) });
  } else {
    setCmsPublishHistoryState({ isPreviewing: false, previewResult: result.data, previewError: null, rollbackDryRunResult: null, rollbackResult: null, rollbackError: null });
  }
  handlers.onRerender?.();
}

async function handleRollbackCmsJson({ sourcePath, dryRun = true, handlers = {} } = {}) {
  const state = getState();
  const historyState = state.publishHistory || {};
  if (!isRollbackAdmin(state)) {
    setCmsPublishHistoryState({ rollbackError: 'Phase này chỉ admin đang hoạt động được rollback.' });
    handlers.onRerender?.();
    return;
  }
  if (!sourcePath) {
    setCmsPublishHistoryState({ rollbackError: 'Cần chọn sourcePath trong published/versions/.' });
    handlers.onRerender?.();
    return;
  }

  const dryRunHash = historyState.rollbackDryRunResult?.sourcePath === sourcePath
    ? historyState.rollbackDryRunResult?.sourceHash
    : '';
  const previewHash = historyState.previewResult?.sourcePath === sourcePath
    ? historyState.previewResult?.hash
    : '';
  const confirmHash = dryRunHash || previewHash || '';

  if (!dryRun) {
    if (!dryRunHash) {
      setCmsPublishHistoryState({ rollbackError: 'Hãy dry-run rollback PASS trước khi rollback thật.' });
      handlers.onRerender?.();
      return;
    }
    const reason = String(historyState.rollbackReason || '').trim();
    if (!reason) {
      setCmsPublishHistoryState({ rollbackError: 'Cần nhập lý do rollback.' });
      handlers.onRerender?.();
      return;
    }
    const stepOne = window.confirm('Rollback sẽ thay đổi website public. Tiếp tục?');
    if (!stepOne) return;
    const stepTwo = window.confirm(`Xác nhận rollback latest về ${sourcePath} với hash ${shortenHash(confirmHash)}?`);
    if (!stepTwo) return;
  }

  setCmsPublishHistoryState({
    isRollingBack: true,
    rollbackError: null,
    rollbackStatus: dryRun ? 'Đang dry-run rollback...' : 'Đang rollback latest...',
    rollbackResult: dryRun ? historyState.rollbackResult : null,
    rollbackDryRunResult: dryRun ? null : historyState.rollbackDryRunResult,
  });
  handlers.onRerender?.();

  const result = await rollbackCmsJson(state.supabase, {
    sourcePath,
    confirmHash,
    reason: historyState.rollbackReason || '',
    dryRun,
  });

  if (result.error) {
    setCmsPublishHistoryState({
      isRollingBack: false,
      rollbackError: normalizeErrorMessage(result.error),
      rollbackStatus: '',
      rollbackResult: dryRun ? historyState.rollbackResult : (result.data || null),
      rollbackDryRunResult: dryRun ? (result.data || null) : historyState.rollbackDryRunResult,
    });
    handlers.onRerender?.();
    return;
  }

  setCmsPublishHistoryState({
    isRollingBack: false,
    rollbackError: null,
    rollbackStatus: dryRun ? 'Dry-run rollback PASS. Chưa thay đổi website public.' : 'Rollback PASS. Latest đã được verify.',
    rollbackDryRunResult: dryRun ? result.data : historyState.rollbackDryRunResult,
    rollbackResult: dryRun ? historyState.rollbackResult : result.data,
  });
  if (!dryRun) await handleLoadPublishHistory({ onRerender: () => {} });
  handlers.onRerender?.();
}

function queueLoadPublishHistory(handlers = {}) {
  if (historyLoadQueued) return;
  historyLoadQueued = true;
  setTimeout(async () => {
    historyLoadQueued = false;
    const latest = getState();
    if (latest.activeTab !== 'history') return;
    await handleLoadPublishHistory(handlers);
  }, 0);
}

function shouldAutoLoadHistory(state = {}, historyState = {}) {
  return Boolean(
    state.activeTab === 'history'
    && isRollbackAdmin(state)
    && !historyState.loading
    && !historyState.loadedAt
    && !historyState.error
  );
}

function canDoRealRollback(historyState = {}, sourcePath = '') {
  const dryRun = historyState.rollbackDryRunResult;
  return Boolean(dryRun?.ok === true && dryRun?.dryRun === true && dryRun?.sourcePath === sourcePath && dryRun?.sourceHash);
}

function isRollbackAdmin(state = {}) {
  const role = String(state.profile?.role || '').trim().toLowerCase();
  return Boolean(state.session?.user?.id && state.profile?.is_active === true && role === 'admin' && ADMIN_FEATURE_FLAGS.allowStaticCmsRollbackGate && CMS_ROLLBACK_GATE_CONFIG.enabled);
}

function getRollbackCandidatePath(log = {}) {
  const candidates = [log.version_path, log.rollback_from_path, log.backup_path];
  return candidates.map((value) => String(value || '').trim()).find(isSafeVersionPath) || '';
}

function isSafeVersionPath(path = '') {
  return /^published\/versions\/cms_public_content_[A-Za-z0-9._-]+\.json$/.test(String(path || ''))
    && !String(path || '').includes('..')
    && !String(path || '').includes('\\')
    && !String(path || '').includes('//');
}

function getOperationLabel(log = {}) {
  const op = log.operation_type === 'rollback' || log.rollback_from_path ? 'Rollback' : 'Publish';
  return `${op} / ${log.status || 'unknown'}`;
}

function shortenHash(value = '') {
  const text = String(value || '').trim();
  if (!text) return '—';
  return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-8)}` : text;
}

function labeledControl(label, control) {
  const wrap = createElement('label', { className: 'cms-admin-field' });
  wrap.appendChild(createElement('span', { text: label }));
  wrap.appendChild(control);
  return wrap;
}
