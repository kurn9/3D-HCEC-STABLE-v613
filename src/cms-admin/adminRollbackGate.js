import { ADMIN_FEATURE_FLAGS, CMS_ROLLBACK_GATE_CONFIG } from './adminConfig.js';
import { ADMIN_COPY } from './adminCopy.js';
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

const ROLLBACK_COPY = ADMIN_COPY.rollbackHistoryOperator || {};

const STATUS_LABELS = Object.freeze({
  published: 'Đã công khai',
  rolled_back: 'Đã khôi phục',
  dry_run_pass: 'Chỉ kiểm tra — đạt',
  failed: 'Thao tác lỗi',
});

const RESTORE_KIND_PRIORITY = Object.freeze({
  backup: 1,
  published: 2,
  restored: 3,
});

export function renderRollbackHistoryTab(state, handlers = {}) {
  const historyState = state.publishHistory || {};
  const panel = createElement('section', { className: 'cms-admin-grid cms-admin-rollback-history-view' });

  panel.appendChild(renderHistoryIntro(state, historyState, handlers));
  panel.appendChild(renderHistoryListPanel(state, historyState, handlers));
  panel.appendChild(renderVersionPreviewPanel(state, historyState, handlers));
  panel.appendChild(renderRollbackPanel(state, historyState, handlers));

  if (shouldAutoLoadHistory(state, historyState)) {
    queueLoadPublishHistory(handlers);
  }

  return panel;
}

function renderHistoryIntro(state = {}, historyState = {}, handlers = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-rollback-hero-panel' });
  const top = createElement('div', { className: 'cms-admin-panel-title-row' });
  top.appendChild(createElement('h2', { className: 'cms-admin-panel-title', text: 'Khôi phục phiên bản nội dung' }));
  top.appendChild(renderBadge(isRollbackAdmin(state) ? 'Quản trị viên' : 'Chỉ xem/không đủ quyền', isRollbackAdmin(state) ? 'success' : 'warning'));
  panel.appendChild(top);
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Chọn một bản có thể khôi phục, xem trước, kiểm tra an toàn rồi mới khôi phục. Website chỉ thay đổi ở bước cuối sau hai lần xác nhận.',
  }));
  panel.appendChild(renderRollbackRiskIntro());
  panel.appendChild(createElement('div', {
    className: 'cms-admin-alert cms-admin-alert-warning',
    text: 'Hệ thống vẫn bắt buộc kiểm tra khôi phục, lý do, mã xác nhận và xác minh bản đang công khai. Phiên bản, bản sao lưu và log không bị xóa.',
  }));
  const actions = createElement('div', { className: 'cms-admin-actions' });
  const refreshButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    type: 'button',
    text: historyState.loading ? 'Đang tải...' : 'Làm mới danh sách',
    title: ROLLBACK_COPY.actions?.refresh || 'Làm mới lịch sử phiên bản',
    ariaLabel: ROLLBACK_COPY.actions?.refresh || 'Làm mới lịch sử phiên bản',
  });
  refreshButton.disabled = Boolean(historyState.loading || historyState.isRollingBack) || !isRollbackAdmin(state);
  refreshButton.addEventListener('click', () => handleLoadPublishHistory(handlers, { resetWorkflow: true }));
  actions.appendChild(refreshButton);
  panel.appendChild(actions);
  if (!isRollbackAdmin(state)) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: 'Chỉ quản trị viên đang hoạt động được xem lịch sử và thực hiện khôi phục.' }));
  }
  return panel;
}

function renderRollbackRiskIntro() {
  const wrap = createElement('div', { className: 'cms-admin-rollback-risk-panel' });
  wrap.appendChild(createElement('strong', { text: ROLLBACK_COPY.highRiskTitle || 'Rollback là thao tác high-risk' }));
  wrap.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: ROLLBACK_COPY.highRiskIntro || 'Lịch sử phiên bản có thể khôi phục website public khi admin active thực hiện đủ bước.',
  }));
  const list = createElement('ul', { className: 'cms-admin-rollback-safety-list' });
  safeArray(ROLLBACK_COPY.highRiskNotes).forEach((note) => list.appendChild(createElement('li', { text: note })));
  if (!list.childElementCount) {
    [
      'Mở màn này hoặc tải lại lịch sử chỉ đọc log, không tự rollback.',
      'Preview chỉ đọc file version public đã chọn.',
      'Dry-run gọi Edge Function để kiểm tra; source server-side chưa được audit trong workspace này.',
      'Rollback thật sẽ thay đổi website public và cần xác nhận rõ.',
    ].forEach((note) => list.appendChild(createElement('li', { text: note })));
  }
  wrap.appendChild(list);
  return wrap;
}

function renderHistoryListPanel(state = {}, historyState = {}, handlers = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-rollback-list-panel' });
  const historyView = buildHistoryViewModels(historyState.items);
  const title = createElement('div', { className: 'cms-admin-panel-title-row' });
  title.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: 'Bản có thể khôi phục' }));
  title.appendChild(renderBadge(`${historyView.restorePoints.length} bản`, 'default'));
  panel.appendChild(title);
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Mỗi thẻ bên dưới đại diện cho đúng một tệp nguồn. Các lần chỉ kiểm tra hoặc thao tác lỗi không thể được chọn để khôi phục.',
  }));

  if (historyState.error) {
    panel.appendChild(renderErrorBox(historyState.error, 'Không tải được lịch sử'));
  }
  if (historyState.loading && !safeArray(historyState.items).length) {
    panel.appendChild(renderEmptyState('Đang tải các bản có thể khôi phục...'));
    return panel;
  }

  if (!historyView.restorePoints.length) {
    panel.appendChild(renderEmptyState('Chưa có phiên bản hoặc bản sao hợp lệ để khôi phục.'));
  } else {
    const list = createElement('div', { className: 'cms-admin-rollback-table' });
    historyView.restorePoints.forEach((point) => list.appendChild(renderRestorePointCard(point, state, historyState, handlers)));
    panel.appendChild(list);
  }

  if (historyView.activities.length) {
    const details = createElement('details', { className: 'cms-admin-rollback-activity-details' });
    details.appendChild(createElement('summary', { text: `Hoạt động không thể chọn (${historyView.activities.length})` }));
    const activityList = createElement('div', { className: 'cms-admin-rollback-activity-list' });
    historyView.activities.forEach((activity) => activityList.appendChild(renderNonSelectableActivityCard(activity)));
    details.appendChild(activityList);
    panel.appendChild(details);
  }

  return panel;
}

function buildHistoryViewModels(items = []) {
  const restorePointMap = new Map();
  const activities = [];

  safeArray(items).forEach((log, index) => {
    const status = String(log?.status || '').trim().toLowerCase();
    const operationType = String(log?.operation_type || '').trim().toLowerCase();
    const isRollbackOperation = operationType === 'rollback' || Boolean(log?.rollback_from_path);

    if (status === 'dry_run_pass' || status === 'failed') {
      activities.push(createActivityViewModel(log, index));
      return;
    }

    if (status === 'published') {
      addRestorePoint(restorePointMap, createRestorePoint(log, {
        sourcePath: log.version_path,
        kind: 'published',
        title: log.published_version || 'Phiên bản đã công khai',
        label: 'Đã công khai',
      }, index));
      addRestorePoint(restorePointMap, createRestorePoint(log, {
        sourcePath: log.backup_path,
        kind: 'backup',
        title: 'Bản sao trước thay đổi',
        label: 'Bản sao trước thay đổi',
      }, index));
      return;
    }

    if (status === 'rolled_back' && isRollbackOperation && log.rollback_verified !== false) {
      addRestorePoint(restorePointMap, createRestorePoint(log, {
        sourcePath: log.rollback_from_path || log.version_path,
        kind: 'restored',
        title: log.published_version || 'Phiên bản đã khôi phục',
        label: 'Đã khôi phục',
      }, index));
      addRestorePoint(restorePointMap, createRestorePoint(log, {
        sourcePath: log.backup_path,
        kind: 'backup',
        title: 'Bản sao trước thay đổi',
        label: 'Bản sao trước thay đổi',
      }, index));
      return;
    }

    if (status === 'rolled_back') {
      addRestorePoint(restorePointMap, createRestorePoint(log, {
        sourcePath: log.backup_path,
        kind: 'backup',
        title: 'Bản sao trước thay đổi',
        label: 'Bản sao trước thay đổi',
      }, index));
      activities.push(createActivityViewModel(log, index, 'Hệ thống đã tự khôi phục sau một thao tác công khai không đạt.'));
      return;
    }

    activities.push(createActivityViewModel(log, index, 'Log này không có tệp nguồn hợp lệ để khôi phục.'));
  });

  return {
    restorePoints: Array.from(restorePointMap.values()).sort((a, b) => b.timestamp - a.timestamp),
    activities,
  };
}

function createRestorePoint(log = {}, options = {}, index = 0) {
  const sourcePath = String(options.sourcePath || '').trim();
  if (!isSafeVersionPath(sourcePath)) return null;
  const kind = options.kind || 'published';
  return {
    key: `${sourcePath}::${kind}`,
    logId: String(log.id || ''),
    sourcePath,
    sourceFile: getPathFileName(sourcePath),
    kind,
    kindPriority: RESTORE_KIND_PRIORITY[kind] || 0,
    title: options.title || 'Phiên bản nội dung',
    label: options.label || 'Có thể khôi phục',
    version: log.published_version || '',
    createdAt: log.created_at || '',
    timestamp: Date.parse(log.created_at || '') || (Number.MAX_SAFE_INTEGER - index),
    operationType: log.operation_type || (log.rollback_from_path ? 'rollback' : 'publish'),
    status: log.status || '',
    hashBefore: log.hash_before || '',
    hashAfter: log.hash_after || '',
    backupPath: log.backup_path || '',
    versionPath: log.version_path || '',
    rollbackFromPath: log.rollback_from_path || '',
    rollbackReason: log.rollback_reason || '',
    errorMessage: log.error_message || '',
  };
}

function addRestorePoint(map, point) {
  if (!point) return;
  const current = map.get(point.sourcePath);
  if (!current || point.kindPriority > current.kindPriority) {
    map.set(point.sourcePath, point);
  }
}

function createActivityViewModel(log = {}, index = 0, note = '') {
  const status = String(log.status || '').trim().toLowerCase();
  return {
    key: `${log.id || index}::activity`,
    version: log.published_version || 'Không rõ phiên bản',
    createdAt: log.created_at || '',
    status,
    statusLabel: STATUS_LABELS[status] || status || 'Không rõ trạng thái',
    statusVariant: status === 'dry_run_pass' ? 'success' : 'warning',
    note: note || (status === 'dry_run_pass'
      ? 'Đây chỉ là kết quả kiểm tra kế hoạch, không phải tệp phiên bản có thể khôi phục.'
      : 'Thao tác không hoàn tất nên không thể dùng làm bản khôi phục.'),
    log,
  };
}

function renderRestorePointCard(point, state = {}, historyState = {}, handlers = {}) {
  const selected = historyState.selectedSourcePath === point.sourcePath;
  const card = createElement('article', {
    className: `cms-admin-rollback-log-card cms-admin-restore-point-card${selected ? ' is-selected' : ''}`,
  });
  const head = createElement('div', { className: 'cms-admin-rollback-log-head' });
  const title = createElement('div', { className: 'cms-admin-cell-stack' });
  title.appendChild(createElement('strong', { text: point.title }));
  title.appendChild(createElement('span', {
    className: 'cms-admin-cell-sub',
    text: `${point.label} • ${formatDateTime(point.createdAt)}`,
  }));
  appendChildren(head, [title, renderBadge(point.label, point.kind === 'backup' ? 'warning' : 'success')]);
  card.appendChild(head);

  const summary = createElement('div', { className: 'cms-admin-restore-point-summary' });
  summary.appendChild(renderMeta('Tên tệp nguồn', point.sourceFile));
  summary.appendChild(renderMeta('Phiên bản', point.version || 'Không ghi tên'));
  card.appendChild(summary);

  if (selected) {
    card.appendChild(createElement('div', {
      className: 'cms-admin-alert cms-admin-alert-success cms-admin-restore-point-selected',
      text: 'Đã chọn bản này. Hãy xem trước rồi chuyển sang bước Kiểm tra khôi phục.',
    }));
  }

  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-rollback-log-actions' });
  const previewButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    type: 'button',
    text: historyState.isPreviewing && historyState.previewRequestPath === point.sourcePath ? 'Đang xem...' : 'Xem trước',
    title: `${ROLLBACK_COPY.actions?.preview || 'Xem trước bản public đã chọn'} ${point.sourceFile}`,
    ariaLabel: `${ROLLBACK_COPY.actions?.preview || 'Xem trước bản public đã chọn'} ${point.sourceFile}`,
  });
  previewButton.disabled = !isRollbackAdmin(state) || historyState.isPreviewing || historyState.isRollingBack;
  previewButton.addEventListener('click', () => handleSelectRestorePoint(point, handlers, { preview: true }));

  const selectButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost',
    type: 'button',
    text: selected ? 'Đã chọn' : 'Chọn bản này',
    title: `${ROLLBACK_COPY.actions?.select || 'Chọn bản này làm nguồn rollback'} ${point.sourceFile}`,
    ariaLabel: `${ROLLBACK_COPY.actions?.select || 'Chọn bản này làm nguồn rollback'} ${point.sourceFile}`,
  });
  selectButton.disabled = !isRollbackAdmin(state) || historyState.isRollingBack || selected;
  selectButton.addEventListener('click', () => handleSelectRestorePoint(point, handlers));
  appendChildren(actions, [previewButton, selectButton]);
  card.appendChild(actions);

  const technical = createElement('details', { className: 'cms-admin-rollback-technical-details' });
  technical.appendChild(createElement('summary', { text: 'Chi tiết kỹ thuật' }));
  const grid = createElement('div', { className: 'cms-admin-rollback-meta-grid' });
  [
    ['Đường dẫn phiên bản', point.sourcePath],
    ['Trạng thái gốc', point.status],
    ['Loại thao tác', point.operationType],
    ['Mã kiểm tra trước', shortenHash(point.hashBefore)],
    ['Mã kiểm tra sau', shortenHash(point.hashAfter)],
    ['Bản sao liên quan', point.backupPath],
  ].forEach(([label, value]) => grid.appendChild(renderMeta(label, value)));
  technical.appendChild(grid);
  card.appendChild(technical);
  return card;
}

function renderNonSelectableActivityCard(activity = {}) {
  const card = createElement('article', { className: 'cms-admin-rollback-activity-card' });
  const head = createElement('div', { className: 'cms-admin-rollback-log-head' });
  const title = createElement('div', { className: 'cms-admin-cell-stack' });
  title.appendChild(createElement('strong', { text: activity.version }));
  title.appendChild(createElement('span', { className: 'cms-admin-cell-sub', text: formatDateTime(activity.createdAt) }));
  appendChildren(head, [title, renderBadge(activity.statusLabel, activity.statusVariant)]);
  card.appendChild(head);
  card.appendChild(createElement('p', { className: 'cms-admin-help-text', text: activity.note }));
  const technical = createElement('details', { className: 'cms-admin-rollback-technical-details' });
  technical.appendChild(createElement('summary', { text: 'Chi tiết kỹ thuật' }));
  const grid = createElement('div', { className: 'cms-admin-rollback-meta-grid' });
  [
    ['Trạng thái', activity.log?.status],
    ['Đường dẫn phiên bản', activity.log?.version_path],
    ['Bản sao trước thay đổi', activity.log?.backup_path],
    ['Bản nguồn được chọn', activity.log?.rollback_from_path],
    ['Lỗi', activity.log?.error_message],
  ].forEach(([label, value]) => grid.appendChild(renderMeta(label, value)));
  technical.appendChild(grid);
  card.appendChild(technical);
  return card;
}

function renderVersionPreviewPanel(state = {}, historyState = {}, handlers = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-rollback-preview-panel' });
  const selectedPath = String(historyState.selectedSourcePath || '').trim();
  const preview = historyState.previewResult?.sourcePath === selectedPath ? historyState.previewResult : null;
  const selectedPoint = findRestorePointByPath(historyState.items, selectedPath);

  panel.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: 'Bước 2 — Xem trước bản sẽ khôi phục' }));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: ROLLBACK_COPY.previewNote || 'Preview chỉ đọc bản public đã chọn và không thay đổi website.',
  }));
  if (!selectedPath) {
    panel.appendChild(renderEmptyState('Hãy chọn một bản trong danh sách. Xem trước chỉ đọc dữ liệu và không thay đổi website.'));
    return panel;
  }

  panel.appendChild(createElement('div', {
    className: 'cms-admin-rollback-selected-source',
    text: selectedPoint ? `${selectedPoint.title} — ${selectedPoint.label}` : getPathFileName(selectedPath),
  }));

  const previewActions = createElement('div', { className: 'cms-admin-actions cms-admin-rollback-preview-actions' });
  const previewButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    type: 'button',
    text: historyState.isPreviewing ? 'Đang đọc bản đã chọn...' : (preview ? 'Xem lại bản đã chọn' : 'Xem trước bản đã chọn'),
    title: ROLLBACK_COPY.actions?.preview || 'Xem trước bản public đã chọn. Chỉ đọc dữ liệu.',
    ariaLabel: ROLLBACK_COPY.actions?.preview || 'Xem trước bản public đã chọn. Chỉ đọc dữ liệu.',
  });
  previewButton.disabled = !isRollbackAdmin(state) || historyState.isPreviewing || historyState.isRollingBack;
  previewButton.addEventListener('click', () => handlePreviewVersion(selectedPath, handlers));
  previewActions.appendChild(previewButton);
  panel.appendChild(previewActions);

  if (historyState.previewError) {
    panel.appendChild(renderErrorBox(historyState.previewError, 'Không xem trước được bản đã chọn'));
  }
  if (historyState.isPreviewing) {
    panel.appendChild(renderEmptyState('Đang đọc và tóm tắt bản đã chọn...'));
    return panel;
  }
  if (!preview) {
    panel.appendChild(renderEmptyState('Bản đã chọn chưa được xem trước hoặc kết quả xem trước cũ đã được xóa.'));
    return panel;
  }

  panel.appendChild(renderPreviewSummary(preview));
  return panel;
}

function renderPreviewSummary(preview = {}) {
  const summary = summarizePreview(preview);
  const wrap = createElement('div', { className: 'cms-admin-rollback-preview-summary' });
  const grid = createElement('div', { className: 'cms-admin-rollback-meta-grid' });
  [
    ['Phiên bản', summary.version],
    ['Phiên schema', summary.schemaVersion],
    ['Tác phẩm trong nhà', summary.indoorCount],
    ['Tác phẩm ngoài trời', summary.outdoorCount],
    ['Có Tác phẩm tiêu biểu', summary.hasFeatured ? 'Có' : 'Không'],
    ['Featured đang bật', summary.featuredEnabled],
    ['Số mục Featured', summary.featuredCount],
    ['Dấu hiệu UAT/test', summary.hasTestMarker ? 'Có' : 'Không'],
  ].forEach(([label, value]) => grid.appendChild(renderMeta(label, value)));
  wrap.appendChild(grid);

  if (summary.featuredItems.length) {
    const featured = createElement('div', { className: 'cms-admin-rollback-featured-summary' });
    featured.appendChild(createElement('strong', { text: 'Tối đa 3 mục Tác phẩm tiêu biểu đầu tiên' }));
    const list = createElement('ol', { className: 'cms-admin-rollback-featured-list' });
    summary.featuredItems.forEach((item) => {
      list.appendChild(createElement('li', { text: `${item.id || 'Không có ID'} — ${item.title || 'Không có tiêu đề'}` }));
    });
    featured.appendChild(list);
    wrap.appendChild(featured);
  }

  if (summary.hasTestMarker) {
    wrap.appendChild(createElement('div', {
      className: 'cms-admin-alert cms-admin-alert-warning',
      text: 'Bản này có dấu hiệu nội dung kiểm tra UAT. Chỉ khôi phục khi bạn xác nhận đúng mục tiêu.',
    }));
  }

  const technical = createElement('details', { className: 'cms-admin-rollback-json-details cms-admin-rollback-technical-details' });
  technical.appendChild(createElement('summary', { text: 'Chi tiết kỹ thuật' }));
  const technicalGrid = createElement('div', { className: 'cms-admin-rollback-meta-grid' });
  [
    ['Nguồn khôi phục', preview.sourcePath],
    ['Mã kiểm tra', shortenHash(preview.hash)],
    ['Dung lượng', `${preview.sizeBytes || 0} bytes`],
  ].forEach(([label, value]) => technicalGrid.appendChild(renderMeta(label, value)));
  technical.appendChild(technicalGrid);
  technical.appendChild(createElement('pre', { className: 'cms-admin-code-block', text: JSON.stringify(preview.json, null, 2).slice(0, 8000) }));
  wrap.appendChild(technical);
  return wrap;
}

function renderRollbackPanel(state = {}, historyState = {}, handlers = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-rollback-action-panel' });
  panel.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: 'Bước 3–4 — Kiểm tra và khôi phục' }));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: ROLLBACK_COPY.dryRunNote || 'Dry-run là backend check qua Edge Function; không được coi là rollback thật.',
  }));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: ROLLBACK_COPY.realRollbackNote || 'Rollback thật sẽ ghi lại website public nếu qua đủ gate và xác nhận hai bước.',
  }));

  const selectedPath = String(historyState.selectedSourcePath || '').trim();
  const selectedPoint = findRestorePointByPath(historyState.items, selectedPath);
  const previewMatches = Boolean(selectedPath && historyState.previewResult?.sourcePath === selectedPath);
  const dryRunMatches = hasValidDryRunForSource(historyState, selectedPath);
  const hasReason = hasValidRollbackReason(historyState.rollbackReason);
  const ready = canDoRealRollback(historyState, selectedPath);

  panel.appendChild(renderFlowSteps({ selectedPath, previewMatches, dryRunMatches, ready }));
  panel.appendChild(renderRollbackReadinessPanel(state, historyState, {
    selectedPath,
    previewMatches,
    dryRunMatches,
    hasReason,
  }));

  if (!selectedPath) {
    panel.appendChild(renderEmptyState('Hãy chọn một bản cần khôi phục ở danh sách.'));
  } else {
    panel.appendChild(createElement('div', {
      className: 'cms-admin-rollback-selected-source',
      text: selectedPoint ? `${selectedPoint.title} — ${selectedPoint.label}` : getPathFileName(selectedPath),
    }));
  }

  const dryRunActions = createElement('div', { className: 'cms-admin-actions cms-admin-rollback-actions' });
  const dryRunButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    type: 'button',
    text: historyState.isRollingBack ? 'Đang kiểm tra...' : 'Kiểm tra khôi phục',
    title: getDryRunDisabledReason(state, historyState, selectedPath) || ROLLBACK_COPY.actions?.dryRun || 'Kiểm tra khôi phục bằng Edge Function hiện có.',
    ariaLabel: getDryRunDisabledReason(state, historyState, selectedPath) || ROLLBACK_COPY.actions?.dryRun || 'Kiểm tra khôi phục bằng Edge Function hiện có.',
  });
  dryRunButton.disabled = !isRollbackAdmin(state) || !selectedPath || historyState.isRollingBack;
  dryRunButton.addEventListener('click', () => handleRollbackCmsJson({ sourcePath: selectedPath, dryRun: true, handlers }));
  dryRunActions.appendChild(dryRunButton);
  panel.appendChild(dryRunActions);

  const reasonInput = createElement('textarea', {
    className: 'cms-admin-input',
    value: historyState.rollbackReason || '',
    title: ROLLBACK_COPY.actions?.reason || 'Lý do khôi phục',
    ariaLabel: ROLLBACK_COPY.actions?.reason || 'Lý do khôi phục',
    attrs: { rows: '3', placeholder: 'Ví dụ: Khôi phục bản sạch sau khi hoàn tất kiểm tra UAT' },
  });
  reasonInput.disabled = !selectedPath || historyState.isRollingBack;
  panel.appendChild(labeledControl('Lý do khôi phục', reasonInput));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text cms-admin-rollback-reason-help',
    text: ROLLBACK_COPY.reasonHelp || 'Nhập lý do vận hành cụ thể trước khi rollback thật.',
  }));

  const conditionChecklist = renderConditionChecklist({ selected: Boolean(selectedPath), dryRunMatches, hasReason });
  panel.appendChild(conditionChecklist.node);
  const guidance = createElement('p', {
    className: `cms-admin-rollback-guidance${ready ? ' is-ready' : ''}`,
    text: getRollbackGuidance({ selectedPath, dryRunMatches, hasReason }),
  });
  panel.appendChild(guidance);

  const rollbackActions = createElement('div', { className: 'cms-admin-actions cms-admin-rollback-actions' });
  const rollbackButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-danger',
    type: 'button',
    text: historyState.isRollingBack ? 'Đang khôi phục...' : 'Khôi phục bản này',
    title: getRollbackDisabledReason(state, historyState, selectedPath, dryRunMatches, hasReason) || ROLLBACK_COPY.actions?.rollback || 'Khôi phục thật bản đã chọn.',
    ariaLabel: getRollbackDisabledReason(state, historyState, selectedPath, dryRunMatches, hasReason) || ROLLBACK_COPY.actions?.rollback || 'Khôi phục thật bản đã chọn.',
  });
  rollbackButton.disabled = !isRollbackAdmin(state) || historyState.isRollingBack || !ready;
  rollbackButton.addEventListener('click', () => handleRollbackCmsJson({ sourcePath: selectedPath, dryRun: false, handlers }));
  rollbackActions.appendChild(rollbackButton);
  panel.appendChild(rollbackActions);

  reasonInput.addEventListener('input', () => {
    const reasonReady = hasValidRollbackReason(reasonInput.value);
    setCmsPublishHistoryState({ rollbackReason: reasonInput.value, rollbackError: null });
    conditionChecklist.setReason(reasonReady);
    const nowReady = Boolean(selectedPath && dryRunMatches && reasonReady);
    rollbackButton.disabled = !isRollbackAdmin(state) || historyState.isRollingBack || !nowReady;
    rollbackButton.title = getRollbackDisabledReason(state, historyState, selectedPath, dryRunMatches, reasonReady) || ROLLBACK_COPY.actions?.rollback || 'Khôi phục thật bản đã chọn.';
    rollbackButton.setAttribute('aria-label', rollbackButton.title);
    guidance.className = `cms-admin-rollback-guidance${nowReady ? ' is-ready' : ''}`;
    guidance.textContent = getRollbackGuidance({ selectedPath, dryRunMatches, hasReason: reasonReady });
  });

  if (!isRollbackAdmin(state)) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: 'Chỉ quản trị viên đang hoạt động được khôi phục.' }));
  }
  if (historyState.rollbackStatus) {
    panel.appendChild(createElement('div', {
      className: historyState.rollbackError ? 'cms-admin-alert cms-admin-alert-error' : 'cms-admin-alert cms-admin-alert-success',
      text: historyState.rollbackStatus,
    }));
  }
  if (historyState.rollbackError) {
    panel.appendChild(renderErrorBox(historyState.rollbackError, 'Khôi phục chưa thành công'));
  }
  panel.appendChild(renderRollbackResult(historyState.rollbackResult || historyState.rollbackDryRunResult));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Khôi phục thật vẫn sao lưu bản đang công khai, ghi bản nguồn đã chọn, xác minh lại và tự phục hồi bản trước nếu xác minh thất bại.',
  }));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: ROLLBACK_COPY.serverSourceWarning || 'Chưa audit được source Edge Function rollback-cms-json trong workspace này, nên UI không claim production rollback readiness.',
  }));
  return panel;
}

function renderFlowSteps({ selectedPath = '', previewMatches = false, dryRunMatches = false, ready = false } = {}) {
  const steps = createElement('ol', { className: 'cms-admin-rollback-flow-steps' });
  [
    ['1', 'Chọn bản cần khôi phục', Boolean(selectedPath)],
    ['2', 'Xem trước bản đã chọn', previewMatches],
    ['3', 'Kiểm tra khôi phục', dryRunMatches],
    ['4', 'Khôi phục bản này', ready],
  ].forEach(([number, label, complete]) => {
    const item = createElement('li', { className: complete ? 'is-complete' : '' });
    item.appendChild(createElement('span', { className: 'cms-admin-rollback-step-number', text: complete ? '✓' : number }));
    item.appendChild(createElement('span', { text: label }));
    steps.appendChild(item);
  });
  return steps;
}

function renderRollbackReadinessPanel(state = {}, historyState = {}, flags = {}) {
  const selectedPath = String(flags.selectedPath || '').trim();
  const selected = Boolean(selectedPath && isSafeVersionPath(selectedPath));
  const historyItems = safeArray(historyState.items);
  const entries = [
    ['Tài khoản admin active', isRollbackAdminSession(state), 'Tài khoản admin đang hoạt động mới có thể chạy dry-run/rollback.'],
    ['Rollback gate đã bật', isRollbackFeatureEnabled(), 'Rollback gate phải được bật trong cấu hình hiện có.'],
    ['Lịch sử đã tải', Boolean(historyState.loadedAt || historyItems.length), 'Lịch sử chỉ đọc từ log công khai đã tải.'],
    ['Đã chọn restore point', selected, 'Chỉ chọn path version hợp lệ trong published/versions/.'],
    ['Preview đã đọc bản chọn', Boolean(flags.previewMatches), 'Preview chỉ đọc public JSON của bản đã chọn.'],
    ['Dry-run PASS đúng bản chọn', Boolean(flags.dryRunMatches), 'Dry-run gọi Edge Function; chưa claim server-side no-side-effect.'],
    ['Có lý do vận hành', Boolean(flags.hasReason), 'Cần lý do vận hành trước khi rollback thật.'],
    ['Cổng xác nhận thật sẵn sàng', Boolean(flags.dryRunMatches && flags.hasReason), 'Hai hộp xác nhận vẫn xuất hiện tại thời điểm bấm rollback thật.'],
  ];
  const blockedReasons = getRollbackBlockedReasons(state, historyState, {
    selectedPath,
    previewMatches: Boolean(flags.previewMatches),
    dryRunMatches: Boolean(flags.dryRunMatches),
    hasReason: Boolean(flags.hasReason),
  });

  const wrap = createElement('div', { className: 'cms-admin-rollback-readiness-panel' });
  const head = createElement('div', { className: 'cms-admin-panel-title-row' });
  head.appendChild(createElement('strong', { text: ROLLBACK_COPY.readinessTitle || 'Preflight rollback' }));
  head.appendChild(renderBadge(blockedReasons.length ? 'Đang bị chặn' : 'Đủ điều kiện UI', blockedReasons.length ? 'warning' : 'success'));
  wrap.appendChild(head);
  wrap.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: ROLLBACK_COPY.readinessIntro || 'Các mục dưới đây chỉ dùng state đã có để nhắc operator trước khi rollback.',
  }));
  const list = createElement('ul', { className: 'cms-admin-rollback-readiness-list' });
  entries.forEach(([label, ok, detail]) => {
    const item = createElement('li', { className: ok ? 'is-complete' : '' });
    item.appendChild(createElement('span', { className: 'cms-admin-rollback-condition-icon', text: ok ? '✓' : '□' }));
    const textWrap = createElement('span', { className: 'cms-admin-rollback-readiness-text' });
    textWrap.appendChild(createElement('strong', { text: label }));
    textWrap.appendChild(createElement('small', { text: detail }));
    item.appendChild(textWrap);
    list.appendChild(item);
  });
  wrap.appendChild(list);

  if (blockedReasons.length) {
    const blocked = createElement('div', { className: 'cms-admin-rollback-blocked-reasons' });
    blocked.appendChild(createElement('strong', { text: ROLLBACK_COPY.disabledReasonsTitle || 'Chưa đủ điều kiện rollback vì' }));
    const reasonList = createElement('ul');
    blockedReasons.forEach((reason) => reasonList.appendChild(createElement('li', { text: reason })));
    blocked.appendChild(reasonList);
    wrap.appendChild(blocked);
  }

  return wrap;
}

function getRollbackBlockedReasons(state = {}, historyState = {}, flags = {}) {
  const reasons = [];
  if (!isRollbackAdminSession(state)) reasons.push('Tài khoản hiện tại không phải admin active.');
  if (!isRollbackFeatureEnabled()) reasons.push('Feature rollback gate chưa bật trong cấu hình hiện có.');
  if (!historyState.loadedAt && !safeArray(historyState.items).length) reasons.push('Chưa tải lịch sử phiên bản.');
  if (!flags.selectedPath) reasons.push('Chưa chọn restore point.');
  if (flags.selectedPath && !isSafeVersionPath(flags.selectedPath)) reasons.push('Đường dẫn bản được chọn không thuộc published/versions hợp lệ.');
  if (!flags.previewMatches) reasons.push('Chưa có preview đọc đúng bản đang chọn.');
  if (!flags.dryRunMatches) reasons.push('Chưa có dry-run PASS cho đúng bản đang chọn.');
  if (!flags.hasReason) reasons.push('Chưa nhập lý do rollback.');
  if (historyState.isRollingBack) reasons.push('Đang có thao tác kiểm tra/rollback chạy.');
  return reasons;
}

function getDryRunDisabledReason(state = {}, historyState = {}, selectedPath = '') {
  if (!isRollbackAdmin(state)) return 'Chỉ admin active mới chạy được kiểm tra khôi phục.';
  if (!selectedPath) return 'Hãy chọn restore point trước khi kiểm tra khôi phục.';
  if (!isSafeVersionPath(selectedPath)) return 'Đường dẫn bản được chọn không hợp lệ.';
  if (historyState.isRollingBack) return 'Đang có thao tác rollback/dry-run chạy.';
  return '';
}

function getRollbackDisabledReason(state = {}, historyState = {}, selectedPath = '', dryRunMatches = false, hasReason = false) {
  if (!isRollbackAdmin(state)) return 'Chỉ admin active mới rollback thật.';
  if (!selectedPath) return 'Hãy chọn restore point trước khi rollback.';
  if (!isSafeVersionPath(selectedPath)) return 'Đường dẫn bản được chọn không hợp lệ.';
  if (!dryRunMatches) return 'Rollback thật bị chặn cho đến khi dry-run PASS đúng bản đã chọn.';
  if (!hasReason) return 'Rollback thật bị chặn cho đến khi có lý do vận hành.';
  if (historyState.isRollingBack) return 'Đang có thao tác rollback/dry-run chạy.';
  return '';
}

function renderConditionChecklist({ selected = false, dryRunMatches = false, hasReason = false } = {}) {
  const list = createElement('ul', { className: 'cms-admin-rollback-condition-list' });
  const entries = [
    ['Đã chọn bản cần khôi phục', selected],
    ['Kiểm tra khôi phục đã đạt', dryRunMatches],
    ['Đã nhập lý do khôi phục', hasReason],
  ];
  const refs = entries.map(([label, complete]) => {
    const item = createElement('li', { className: complete ? 'is-complete' : '' });
    const icon = createElement('span', { className: 'cms-admin-rollback-condition-icon', text: complete ? '✓' : '□' });
    item.appendChild(icon);
    item.appendChild(createElement('span', { text: label }));
    list.appendChild(item);
    return { item, icon };
  });
  return {
    node: list,
    setReason(complete) {
      const reasonRef = refs[2];
      reasonRef.item.className = complete ? 'is-complete' : '';
      reasonRef.icon.textContent = complete ? '✓' : '□';
    },
  };
}

function renderRollbackResult(result) {
  const wrap = createElement('div', { className: 'cms-admin-rollback-result' });
  if (!result) return wrap;

  const isDryRun = result.dryRun === true;
  wrap.appendChild(createElement('div', {
    className: result.ok === true ? 'cms-admin-alert cms-admin-alert-success' : 'cms-admin-alert cms-admin-alert-error',
    text: result.ok === true
      ? (isDryRun ? 'Kiểm tra khôi phục đã đạt. Website chưa thay đổi.' : 'Khôi phục đã hoàn tất và bản đang công khai đã được xác minh.')
      : (isDryRun ? 'Kiểm tra khôi phục không đạt.' : 'Khôi phục không thành công.'),
  }));

  const technical = createElement('details', { className: 'cms-admin-rollback-technical-details' });
  technical.appendChild(createElement('summary', { text: 'Chi tiết kỹ thuật' }));
  const grid = createElement('div', { className: 'cms-admin-rollback-meta-grid' });
  [
    ['Trạng thái', result.ok === true ? 'PASS' : 'FAIL'],
    ['Chế độ', isDryRun ? 'Kiểm tra khôi phục' : 'Khôi phục'],
    ['Bản nguồn được chọn', result.sourcePath],
    ['Đường dẫn latest', result.latestPath || result.wouldWriteLatestPath],
    ['Bản sao trước thay đổi', result.backupPath || result.wouldBackupCurrentLatestPath],
    ['Phiên bản', result.rollbackVersion || result.sourceVersion],
    ['Mã kiểm tra', shortenHash(result.hashAfter || result.sourceHash)],
    ['Xác minh', result.verifyStatus || result.verify?.status || '—'],
  ].forEach(([label, value]) => grid.appendChild(renderMeta(label, value)));
  technical.appendChild(grid);
  wrap.appendChild(technical);

  if (result.restoreAttempted) {
    wrap.appendChild(createElement('div', {
      className: result.restoreVerified ? 'cms-admin-alert cms-admin-alert-success' : 'cms-admin-alert cms-admin-alert-error',
      text: result.restoreVerified
        ? 'Khôi phục gặp lỗi nhưng bản công khai trước đó đã được phục hồi và xác minh.'
        : 'Khôi phục gặp lỗi và bản công khai trước đó chưa được xác minh. Cần kiểm tra ngay.',
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

async function handleLoadPublishHistory(handlers = {}, options = {}) {
  const state = getState();
  if (!isRollbackAdmin(state)) {
    setCmsPublishHistoryState({ error: 'Chỉ quản trị viên đang hoạt động được xem lịch sử công khai.' });
    handlers.onRerender?.();
    return;
  }

  const resetWorkflow = options.resetWorkflow !== false;
  setCmsPublishHistoryState({
    loading: true,
    error: null,
    ...(resetWorkflow ? createWorkflowResetPatch() : {}),
  });
  handlers.onRerender?.();

  const result = await listCmsPublishLogs(state.supabase, { limit: 60 });
  if (result.error) {
    setCmsPublishHistoryState({ loading: false, error: normalizeErrorMessage(result.error) });
  } else {
    setCmsPublishHistoryItems(result.data || []);
  }
  handlers.onRerender?.();
}

async function handleSelectRestorePoint(point, handlers = {}, options = {}) {
  if (!point?.sourcePath || !isSafeVersionPath(point.sourcePath)) return;
  const current = getState().publishHistory || {};
  const previewMatches = current.previewResult?.sourcePath === point.sourcePath;
  setCmsPublishHistoryState({
    selectedLogId: point.logId || '',
    selectedRestorePointKey: point.key || '',
    selectedSourcePath: point.sourcePath,
    selectedRestorePointTitle: point.title || '',
    previewResult: previewMatches ? current.previewResult : null,
    previewError: null,
    previewRequestPath: '',
    isPreviewing: false,
    rollbackDryRunResult: null,
    rollbackResult: null,
    rollbackError: null,
    rollbackStatus: 'Bạn đã chọn bản sẽ khôi phục. Hãy xem trước và bấm “Kiểm tra khôi phục”.',
    rollbackReason: '',
  });
  handlers.onRerender?.();
  if (options.preview === true) {
    await handlePreviewVersion(point.sourcePath, handlers);
  }
}

async function handlePreviewVersion(sourcePath, handlers = {}) {
  const state = getState();
  const historyState = state.publishHistory || {};
  if (!sourcePath || sourcePath !== historyState.selectedSourcePath || !isSafeVersionPath(sourcePath)) {
    setCmsPublishHistoryState({ previewError: 'Bản cần xem trước không trùng với bản đang chọn.' });
    handlers.onRerender?.();
    return;
  }

  setCmsPublishHistoryState({
    isPreviewing: true,
    previewRequestPath: sourcePath,
    previewResult: null,
    previewError: null,
    rollbackError: null,
  });
  handlers.onRerender?.();

  const result = await previewCmsPublishedVersion(sourcePath);
  const latestState = getState().publishHistory || {};
  if (latestState.selectedSourcePath !== sourcePath || latestState.previewRequestPath !== sourcePath) {
    return;
  }

  if (result.error) {
    setCmsPublishHistoryState({
      isPreviewing: false,
      previewRequestPath: '',
      previewError: normalizeErrorMessage(result.error),
      previewResult: null,
    });
  } else {
    setCmsPublishHistoryState({
      isPreviewing: false,
      previewRequestPath: '',
      previewResult: result.data,
      previewError: null,
    });
  }
  handlers.onRerender?.();
}

async function handleRollbackCmsJson({ sourcePath, dryRun = true, handlers = {} } = {}) {
  const state = getState();
  const historyState = state.publishHistory || {};
  const selectedPath = String(historyState.selectedSourcePath || '').trim();

  if (!isRollbackAdmin(state)) {
    setCmsPublishHistoryState({ rollbackError: 'Chỉ quản trị viên đang hoạt động được khôi phục.' });
    handlers.onRerender?.();
    return;
  }
  if (!sourcePath || sourcePath !== selectedPath || !isSafeVersionPath(sourcePath)) {
    setCmsPublishHistoryState({ rollbackError: 'Hãy chọn lại một bản khôi phục hợp lệ.' });
    handlers.onRerender?.();
    return;
  }

  const dryRunResult = historyState.rollbackDryRunResult;
  const dryRunHash = dryRunResult?.sourcePath === sourcePath && dryRunResult?.ok === true && dryRunResult?.dryRun === true
    ? dryRunResult?.sourceHash
    : '';
  const previewHash = historyState.previewResult?.sourcePath === sourcePath ? historyState.previewResult?.hash : '';
  const confirmHash = dryRunHash || previewHash || '';

  if (!dryRun) {
    if (!dryRunHash) {
      setCmsPublishHistoryState({ rollbackError: 'Hãy bấm “Kiểm tra khôi phục” và chờ kết quả đạt trước.' });
      handlers.onRerender?.();
      return;
    }
    const reason = String(historyState.rollbackReason || '').trim();
    if (!reason) {
      setCmsPublishHistoryState({ rollbackError: 'Hãy nhập lý do khôi phục để tiếp tục.' });
      handlers.onRerender?.();
      return;
    }
    const stepOne = window.confirm('Khôi phục sẽ thay đổi nội dung đang công khai trên website. Bạn có muốn tiếp tục?');
    if (!stepOne) return;
    const stepTwo = window.confirm(`Xác nhận khôi phục từ bản ${getPathFileName(sourcePath)} với mã kiểm tra ${shortenHash(confirmHash)}?`);
    if (!stepTwo) return;
  }

  setCmsPublishHistoryState({
    isRollingBack: true,
    rollbackRequestPath: sourcePath,
    rollbackError: null,
    rollbackStatus: dryRun ? 'Đang kiểm tra khôi phục...' : 'Đang khôi phục bản đã chọn...',
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

  const latestHistoryState = getState().publishHistory || {};
  if (latestHistoryState.selectedSourcePath !== sourcePath || latestHistoryState.rollbackRequestPath !== sourcePath) {
    return;
  }

  if (result.error) {
    setCmsPublishHistoryState({
      isRollingBack: false,
      rollbackRequestPath: '',
      rollbackError: normalizeErrorMessage(result.error),
      rollbackStatus: dryRun
        ? 'Kiểm tra không đạt. Chưa thể khôi phục. Hãy chọn bản khác hoặc xem chi tiết lỗi.'
        : 'Không thể khôi phục. Hãy kiểm tra lỗi và chạy lại bước Kiểm tra khôi phục.',
      rollbackResult: dryRun ? historyState.rollbackResult : (result.data || null),
      rollbackDryRunResult: null,
    });
    handlers.onRerender?.();
    return;
  }

  if (dryRun) {
    setCmsPublishHistoryState({
      isRollingBack: false,
      rollbackRequestPath: '',
      rollbackError: null,
      rollbackStatus: 'Kiểm tra khôi phục đã đạt. Website chưa thay đổi. Hãy nhập lý do và bấm “Khôi phục bản này”.',
      rollbackDryRunResult: result.data,
    });
    handlers.onRerender?.();
    return;
  }

  setCmsPublishHistoryState({
    isRollingBack: false,
    rollbackRequestPath: '',
    rollbackError: null,
    rollbackStatus: 'Khôi phục thành công. Bản đang công khai đã được xác minh. Hãy kiểm tra website.',
    rollbackDryRunResult: null,
    rollbackResult: result.data,
    rollbackReason: '',
  });
  await handleLoadPublishHistory({ onRerender: () => {} }, { resetWorkflow: false });
  handlers.onRerender?.();
}

function queueLoadPublishHistory(handlers = {}) {
  if (historyLoadQueued) return;
  historyLoadQueued = true;
  setTimeout(async () => {
    historyLoadQueued = false;
    const latest = getState();
    if (latest.activeTab !== 'history') return;
    await handleLoadPublishHistory(handlers, { resetWorkflow: true });
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

function createWorkflowResetPatch() {
  return {
    selectedLogId: '',
    selectedRestorePointKey: '',
    selectedSourcePath: '',
    selectedRestorePointTitle: '',
    previewResult: null,
    previewError: null,
    previewRequestPath: '',
    isPreviewing: false,
    rollbackDryRunResult: null,
    rollbackResult: null,
    rollbackError: null,
    rollbackStatus: '',
    rollbackReason: '',
    rollbackRequestPath: '',
    isRollingBack: false,
  };
}

function findRestorePointByPath(items = [], sourcePath = '') {
  if (!sourcePath) return null;
  const historyView = buildHistoryViewModels(items);
  return historyView.restorePoints.find((point) => point.sourcePath === sourcePath) || null;
}

function hasValidDryRunForSource(historyState = {}, sourcePath = '') {
  const dryRun = historyState.rollbackDryRunResult;
  return Boolean(
    sourcePath
    && dryRun?.ok === true
    && dryRun?.dryRun === true
    && dryRun?.sourcePath === sourcePath
    && dryRun?.sourceHash
  );
}

function canDoRealRollback(historyState = {}, sourcePath = '') {
  return Boolean(hasValidDryRunForSource(historyState, sourcePath) && hasValidRollbackReason(historyState.rollbackReason));
}

function hasValidRollbackReason(value = '') {
  return String(value || '').trim().length > 0;
}

function getRollbackGuidance({ selectedPath = '', dryRunMatches = false, hasReason = false } = {}) {
  if (!selectedPath) return 'Hãy chọn một bản cần khôi phục ở danh sách.';
  if (!dryRunMatches) return 'Hãy bấm “Kiểm tra khôi phục” trước.';
  if (!hasReason) return 'Hãy nhập lý do khôi phục để tiếp tục.';
  return 'Đã đủ điều kiện. Hãy kiểm tra lại bản đã chọn trước khi bấm “Khôi phục bản này”.';
}

function summarizePreview(preview = {}) {
  const json = preview.json && typeof preview.json === 'object' ? preview.json : {};
  const featured = json?.index?.featuredArtworks;
  const featuredItems = collectFeaturedItems(featured);
  return {
    version: preview.version || json.version || 'Không ghi phiên bản',
    schemaVersion: preview.schemaVersion || json.schemaVersion || 'Không ghi schema',
    indoorCount: Number.isFinite(preview.indoorCount) ? preview.indoorCount : countRoomItems(json, 'indoor'),
    outdoorCount: Number.isFinite(preview.outdoorCount) ? preview.outdoorCount : countRoomItems(json, 'outdoor'),
    hasFeatured: Boolean(featured && typeof featured === 'object'),
    featuredEnabled: typeof featured?.enabled === 'boolean' ? (featured.enabled ? 'Có' : 'Không') : (featured ? 'Không ghi rõ' : 'Không'),
    featuredCount: featuredItems.length,
    featuredItems: featuredItems.slice(0, 3).map((item) => ({
      id: String(item?.id || item?.artworkId || item?.artwork_code || '').trim(),
      title: String(item?.title || item?.name || '').trim(),
    })),
    hasTestMarker: hasUatOrTestMarker(json),
  };
}

function collectFeaturedItems(featured) {
  if (Array.isArray(featured)) return featured;
  if (Array.isArray(featured?.items)) return featured.items;
  return [];
}

function countRoomItems(json = {}, roomKey = '') {
  const room = json?.rooms?.[roomKey];
  if (Array.isArray(room?.artworks)) return room.artworks.length;
  if (room?.items && typeof room.items === 'object' && !Array.isArray(room.items)) return Object.keys(room.items).length;
  return 0;
}

function hasUatOrTestMarker(json = {}) {
  let text = '';
  try {
    text = JSON.stringify(json).toUpperCase();
  } catch {
    return false;
  }
  if (text.includes('FEATURED_UAT') || text.includes('KIỂM TRA CMS UAT')) return true;
  return /(^|[^A-Z0-9])UAT([^A-Z0-9]|$)/.test(text)
    || /(^|[^A-Z0-9])TEST([^A-Z0-9]|$)/.test(text);
}

function isRollbackAdmin(state = {}) {
  return Boolean(isRollbackAdminSession(state) && isRollbackFeatureEnabled());
}

function isRollbackAdminSession(state = {}) {
  const role = String(state.profile?.role || '').trim().toLowerCase();
  return Boolean(state.session?.user?.id && state.profile?.is_active === true && role === 'admin');
}

function isRollbackFeatureEnabled() {
  return Boolean(ADMIN_FEATURE_FLAGS.allowStaticCmsRollbackGate && CMS_ROLLBACK_GATE_CONFIG.enabled);
}

function isSafeVersionPath(path = '') {
  return /^published\/versions\/cms_public_content_[A-Za-z0-9._-]+\.json$/.test(String(path || ''))
    && !String(path || '').includes('..')
    && !String(path || '').includes('\\')
    && !String(path || '').includes('//');
}

function getPathFileName(path = '') {
  const text = String(path || '').trim();
  return text.split('/').pop() || text || 'Không rõ tệp';
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
