import { ADMIN_FEATURE_FLAGS, CMS_ROLLBACK_GATE_CONFIG } from './adminConfig.js';
import { ADMIN_COPY } from './adminCopy.js';
import { listCmsPublishLogs, previewCmsPublishedVersion, reconcileCmsReleasePointer, rollbackCmsJson } from './adminApi.js';
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
  applyReleaseOperationGateFromServer,
  clearReleaseOperationGateFromExactIdle,
  setReleaseOperationGateState,
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
  const panel = createElement('section', { className: 'cms-admin-grid cms-admin-rollback-history-view cms-admin-version-history-workspace' });

  panel.appendChild(renderHistoryIntro(state, historyState, handlers));

  const workflow = createElement('section', {
    className: 'cms-admin-version-history-flow-grid',
    attrs: { 'aria-label': 'Luồng chọn phiên bản, preview và khôi phục có kiểm soát' },
  });
  workflow.appendChild(renderHistoryListPanel(state, historyState, handlers));
  workflow.appendChild(renderVersionPreviewPanel(state, historyState, handlers));
  workflow.appendChild(renderRollbackPanel(state, historyState, handlers));
  panel.appendChild(workflow);

  panel.appendChild(renderHistoryAuditPanel(historyState));

  if (shouldAutoLoadHistory(state, historyState)) {
    queueLoadPublishHistory(handlers);
  }

  return panel;
}

function renderHistoryIntro(state = {}, historyState = {}, handlers = {}) {
  const historyView = buildHistoryViewModels(historyState.items);
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-rollback-hero-panel cms-admin-version-history-hero' });
  const top = createElement('div', { className: 'cms-admin-panel-title-row cms-admin-version-history-title-row' });
  const heading = createElement('div', { className: 'cms-admin-cell-stack' });
  heading.appendChild(createElement('p', { className: 'cms-admin-kicker', text: 'VẬN HÀNH / ROLLBACK' }));
  heading.appendChild(createElement('h2', { className: 'cms-admin-panel-title', text: 'Lịch sử phiên bản' }));
  heading.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Workspace này gom một luồng vận hành liền mạch: chọn phiên bản, xem preview, kiểm tra khôi phục, nhập lý do và chỉ rollback khi đủ guard. Xem hoặc chọn phiên bản không tự đổi website.',
  }));
  top.appendChild(heading);
  top.appendChild(renderBadge(isRollbackAdmin(state) ? 'Rollback có kiểm soát' : 'Chỉ xem', isRollbackAdmin(state) ? 'warning' : 'default'));
  panel.appendChild(top);

  const summary = createElement('div', { className: 'cms-admin-version-history-summary-grid' });
  [
    {
      title: 'Lịch sử/audit canonical',
      value: `${safeArray(historyState.items).length} log`,
      detail: 'cms_publish_logs là nguồn đối chiếu publish/rollback thật.',
      badge: 'cms_publish_logs',
      variant: 'success',
    },
    {
      title: 'Bản có thể khôi phục',
      value: `${historyView.restorePoints.length} bản`,
      detail: 'Nguồn restore là Storage version/backup path an toàn từ log.',
      badge: 'Storage versions',
      variant: 'warning',
    },
    {
      title: 'Bản ghi tham chiếu DB',
      value: 'reference',
      detail: 'published_bundles nếu xuất hiện chỉ là legacy/cache, không phải audit canonical.',
      badge: 'published_bundles',
      variant: 'default',
    },
  ].forEach((item) => {
    const card = createElement('article', { className: 'cms-admin-version-history-source-card' });
    const cardHead = createElement('div', { className: 'cms-admin-panel-title-row' });
    cardHead.appendChild(createElement('strong', { text: item.title }));
    cardHead.appendChild(renderBadge(item.badge, item.variant));
    card.appendChild(cardHead);
    card.appendChild(createElement('div', { className: 'cms-admin-version-history-source-value', text: item.value }));
    card.appendChild(createElement('p', { className: 'cms-admin-help-text', text: item.detail }));
    summary.appendChild(card);
  });
  panel.appendChild(summary);

  const safety = createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning cms-admin-version-history-safety-note' });
  safety.appendChild(createElement('strong', { text: 'Nguyên tắc an toàn' }));
  safety.appendChild(createElement('span', {
    text: ' Preview chỉ đọc. Rollback thật sẽ đổi website public và chỉ được mở trong panel checklist bên phải khi đúng bản, dry-run server đạt, có lý do và xác nhận hai bước.',
  }));
  panel.appendChild(safety);
  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-version-history-hero-actions' });
  const refreshButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    type: 'button',
    text: historyState.loading ? 'Đang tải lịch sử...' : 'Làm mới lịch sử',
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



function renderHistoryAuditPanel(historyState = {}) {
  const historyView = buildHistoryViewModels(historyState.items);
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-rollback-audit-panel cms-admin-version-audit-panel', attrs: { id: 'cms-version-history-audit' } });
  const title = createElement('div', { className: 'cms-admin-panel-title-row' });
  const heading = createElement('div', { className: 'cms-admin-cell-stack' });
  heading.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: 'Activity / Audit' }));
  heading.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'cms_publish_logs là lịch sử vận hành canonical. published_bundles nếu còn xuất hiện chỉ dùng tham chiếu nhanh, không thay thế audit log.',
  }));
  title.appendChild(heading);
  title.appendChild(renderBadge(`${safeArray(historyState.items).length} log`, 'default'));
  panel.appendChild(title);

  const summary = createElement('div', { className: 'cms-admin-version-history-summary-grid cms-admin-version-audit-summary' });
  [
    ['Bản restore', historyView.restorePoints.length, 'Storage version/backup path có thể chọn.'],
    ['Hoạt động phụ', historyView.activities.length, 'Dry-run, lỗi hoặc thao tác không có nguồn restore.'],
    ['Nguồn audit', 'cms_publish_logs', 'Đối chiếu publish/rollback thật tại đây.'],
  ].forEach(([label, value, detail]) => {
    const item = createElement('article', { className: 'cms-admin-version-history-source-card' });
    item.appendChild(createElement('strong', { text: label }));
    item.appendChild(createElement('div', { className: 'cms-admin-version-history-source-value', text: String(value) }));
    item.appendChild(createElement('p', { className: 'cms-admin-help-text', text: detail }));
    summary.appendChild(item);
  });
  panel.appendChild(summary);

  if (!historyView.activities.length) {
    panel.appendChild(renderEmptyState('Chưa có hoạt động dry-run/lỗi riêng để hiển thị.'));
  } else {
    const details = createElement('details', { className: 'cms-admin-rollback-activity-details' });
    details.appendChild(createElement('summary', { text: `Hoạt động không thể chọn (${historyView.activities.length})` }));
    const activityList = createElement('div', { className: 'cms-admin-rollback-activity-list' });
    historyView.activities.forEach((activity) => activityList.appendChild(renderNonSelectableActivityCard(activity)));
    details.appendChild(activityList);
    panel.appendChild(details);
  }

  const legacy = createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning cms-admin-version-legacy-note' });
  legacy.appendChild(createElement('strong', { text: 'published_bundles: reference / legacy cache' }));
  legacy.appendChild(createElement('span', { text: ' Không dùng bảng này làm audit canonical hoặc bằng chứng website đang chạy.' }));
  panel.appendChild(legacy);
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
      'Kiểm tra khôi phục chạy qua bộ kiểm tra trên server và vẫn chưa khôi phục thật.',
      'Khôi phục thật sẽ thay đổi website và cần xác nhận rõ.',
    ].forEach((note) => list.appendChild(createElement('li', { text: note })));
  }
  wrap.appendChild(list);
  return wrap;
}

function renderHistoryListPanel(state = {}, historyState = {}, handlers = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-rollback-list-panel cms-admin-version-list-panel', attrs: { id: 'cms-version-history-list' } });
  const historyView = buildHistoryViewModels(historyState.items);
  const title = createElement('div', { className: 'cms-admin-panel-title-row' });
  const heading = createElement('div', { className: 'cms-admin-cell-stack' });
  heading.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: 'Danh sách phiên bản' }));
  heading.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Chọn đúng phiên bản nguồn để xem trước và kiểm tra khôi phục. Chọn bản chỉ cập nhật workspace, không đổi website.',
  }));
  title.appendChild(heading);
  title.appendChild(renderBadge(`${historyView.restorePoints.length} bản restore`, 'default'));
  panel.appendChild(title);

  if (historyState.error) {
    panel.appendChild(renderErrorBox(historyState.error, 'Không tải được lịch sử'));
  }
  if (historyState.loading && !safeArray(historyState.items).length) {
    panel.appendChild(renderEmptyState('Đang tải các bản có thể khôi phục...'));
    return panel;
  }

  if (!historyView.restorePoints.length) {
    panel.appendChild(renderEmptyState('Chưa có phiên bản hoặc bản sao hợp lệ để khôi phục. Hãy đối chiếu cms_publish_logs hoặc quay lại màn công khai.'));
  } else {
    const list = createElement('div', { className: 'cms-admin-rollback-table cms-admin-version-list' });
    prioritizeRestorePoints(historyView.restorePoints, historyState.selectedSourcePath)
      .forEach((point) => list.appendChild(renderRestorePointCard(point, state, historyState, handlers)));
    panel.appendChild(list);
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
        sourcePath: log.rollback_to_path || log.version_path,
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
    rollbackToPath: log.rollback_to_path || '',
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

function prioritizeRestorePoints(points = [], selectedSourcePath = '') {
  const selectedPath = String(selectedSourcePath || '').trim();
  return [...safeArray(points)].sort((a, b) => {
    if (selectedPath) {
      if (a.sourcePath === selectedPath && b.sourcePath !== selectedPath) return -1;
      if (b.sourcePath === selectedPath && a.sourcePath !== selectedPath) return 1;
    }
    if ((b.kindPriority || 0) !== (a.kindPriority || 0)) return (b.kindPriority || 0) - (a.kindPriority || 0);
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
}

function getRestorePointDisplayTitle(point = {}, selected = false) {
  if (selected) return 'Bản đang chọn';
  const status = String(point.status || '').toLowerCase();
  if (point.kind === 'restored' || status === 'rolled_back') return 'Bản đã khôi phục';
  if (point.kind === 'published' || status === 'published') return 'Bản đã công khai';
  if (point.kind === 'backup') return `Backup ${formatDateTime(point.createdAt)}`;
  return 'Phiên bản có thể khôi phục';
}

function getRestorePointVersionLine(point = {}) {
  const version = String(point.version || point.title || '').trim();
  if (version) return version;
  return point.sourceFile || getPathFileName(point.sourcePath) || 'Không rõ mã phiên bản';
}

function getRestorePointStatusLabel(point = {}) {
  const status = String(point.status || '').toLowerCase();
  if (point.kind === 'backup') return 'Backup/reference';
  if (point.kind === 'restored' || status === 'rolled_back') return 'Đã khôi phục';
  if (point.kind === 'published' || status === 'published') return 'Đã công khai';
  return STATUS_LABELS[status] || point.label || 'Có thể khôi phục';
}

function getRestorePointSourceShortLabel(point = {}) {
  if (point.kind === 'backup') return 'Backup';
  if (point.kind === 'restored') return 'Restore source';
  return 'Version';
}

function getRestorePointStatusVariant(point = {}) {
  if (point.kind === 'backup') return 'warning';
  if (point.kind === 'restored') return 'success';
  if (String(point.status || '').toLowerCase() === 'published') return 'success';
  return 'default';
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
    className: `cms-admin-rollback-log-card cms-admin-restore-point-card cms-admin-version-card cms-admin-version-card-${point.kind || 'published'}${selected ? ' is-selected' : ''}`,
    attrs: { 'aria-selected': selected ? 'true' : 'false' },
  });

  const statusRow = createElement('div', { className: 'cms-admin-version-card-status-row' });
  const statusCluster = createElement('div', { className: 'cms-admin-version-card-badges' });
  if (selected) statusCluster.appendChild(renderBadge('Đang chọn', 'success'));
  statusCluster.appendChild(renderBadge(getRestorePointStatusLabel(point), getRestorePointStatusVariant(point)));
  statusCluster.appendChild(renderBadge(getRestorePointSourceShortLabel(point), point.kind === 'backup' ? 'warning' : 'default'));
  const time = createElement('span', { className: 'cms-admin-version-card-time', text: formatDateTime(point.createdAt) });
  appendChildren(statusRow, [statusCluster, time]);
  card.appendChild(statusRow);

  const identity = createElement('div', { className: 'cms-admin-version-card-identity' });
  identity.appendChild(createElement('strong', { text: getRestorePointDisplayTitle(point, selected) }));
  identity.appendChild(createElement('span', {
    className: 'cms-admin-cell-sub cms-admin-version-card-version',
    text: getRestorePointVersionLine(point),
  }));
  card.appendChild(identity);

  const summary = createElement('div', { className: 'cms-admin-restore-point-summary cms-admin-version-card-facts' });
  summary.appendChild(renderMeta('Nguồn', point.kind === 'backup' ? 'Storage backup' : 'Storage version'));
  summary.appendChild(renderMeta('Audit', 'cms_publish_logs'));
  if (point.operationType) summary.appendChild(renderMeta('Thao tác', point.operationType));
  card.appendChild(summary);

  if (selected) {
    card.appendChild(createElement('div', {
      className: 'cms-admin-alert cms-admin-alert-success cms-admin-restore-point-selected',
      text: 'Đang dùng bản này cho preview và checklist khôi phục.',
    }));
  }

  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-rollback-log-actions' });
  const selectButton = createElement('button', {
    className: `cms-admin-button ${selected ? 'cms-admin-button-secondary' : 'cms-admin-button-primary'}`,
    type: 'button',
    text: selected ? 'Đang chọn' : 'Chọn phiên bản',
    title: `${ROLLBACK_COPY.actions?.select || 'Chọn bản này làm nguồn rollback'} ${point.version || point.title || point.sourceFile}`,
    ariaLabel: `${ROLLBACK_COPY.actions?.select || 'Chọn bản này làm nguồn rollback'} ${point.version || point.title || point.sourceFile}`,
  });
  selectButton.disabled = !isRollbackAdmin(state) || historyState.isRollingBack || selected;
  selectButton.addEventListener('click', () => handleSelectRestorePoint(point, handlers));
  actions.appendChild(selectButton);
  card.appendChild(actions);

  const technical = createElement('details', { className: 'cms-admin-rollback-technical-details cms-admin-version-card-technical' });
  technical.appendChild(createElement('summary', { text: 'Đường dẫn và metadata kỹ thuật' }));
  const grid = createElement('div', { className: 'cms-admin-rollback-meta-grid cms-admin-rollback-technical-grid' });
  [
    ['Tên file', point.sourceFile || getPathFileName(point.sourcePath)],
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
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-rollback-preview-panel cms-admin-version-preview-panel', attrs: { id: 'cms-version-history-preview' } });
  const selectedPath = String(historyState.selectedSourcePath || '').trim();
  const preview = historyState.previewResult?.sourcePath === selectedPath ? historyState.previewResult : null;
  const selectedPoint = findRestorePointByPath(historyState.items, selectedPath);

  const title = createElement('div', { className: 'cms-admin-panel-title-row' });
  const heading = createElement('div', { className: 'cms-admin-cell-stack' });
  heading.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: 'Preview phiên bản đã chọn' }));
  heading.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Preview chỉ đọc nội dung của bản đã chọn. Không ghi Storage, không rollback, không thay đổi website.',
  }));
  title.appendChild(heading);
  title.appendChild(renderBadge('Preview read-only', 'default'));
  panel.appendChild(title);

  if (!selectedPath) {
    panel.appendChild(renderEmptyState('Chọn một phiên bản trong danh sách để xem preview đọc-only.'));
    return panel;
  }

  panel.appendChild(createElement('div', {
    className: 'cms-admin-rollback-selected-source cms-admin-version-selected-source',
    text: selectedPoint ? `${selectedPoint.title} — ${selectedPoint.label}` : getPathFileName(selectedPath),
  }));

  const previewActions = createElement('div', { className: 'cms-admin-actions cms-admin-rollback-preview-actions' });
  const previewButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    type: 'button',
    text: historyState.isPreviewing ? 'Đang đọc bản đã chọn...' : (preview ? 'Làm mới preview' : 'Xem preview đọc-only'),
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
    panel.appendChild(renderEmptyState('Chưa có preview cho bản này. Bấm “Xem preview đọc-only” trước khi rollback.'));
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
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-rollback-action-panel cms-admin-version-rollback-panel', attrs: { id: 'cms-version-history-rollback' } });
  const selectedPath = String(historyState.selectedSourcePath || '').trim();
  const selectedPoint = findRestorePointByPath(historyState.items, selectedPath);
  const previewMatches = Boolean(selectedPath && historyState.previewResult?.sourcePath === selectedPath);
  const dryRunMatches = hasValidDryRunForSource(historyState, selectedPath);
  const hasReason = hasValidRollbackReason(historyState.rollbackReason);
  const gate = state.releaseOperationGate || {};
  const serverGateBlocked = Boolean(gate.blocked || gate.lineageRepairRequired || gate.repairRequired || gate.terminalAuditIdentityInvalid || gate.terminalAuditConflict);
  const needsReconciliation = Boolean(historyState.rollbackRequiresReconciliation || historyState.rollbackPointerState === 'unknown' || gate.reconciliationRequired);
  const ready = !serverGateBlocked && !needsReconciliation && canDoRealRollback(historyState, selectedPath);

  const title = createElement('div', { className: 'cms-admin-panel-title-row' });
  const heading = createElement('div', { className: 'cms-admin-cell-stack' });
  heading.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: 'Checklist & khôi phục' }));
  heading.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Panel thao tác cho phiên bản đang chọn: kiểm tra điều kiện, nhập lý do và chỉ khôi phục khi guard hiện có cho phép.',
  }));
  title.appendChild(heading);
  title.appendChild(renderBadge(ready ? 'Đủ điều kiện UI' : (serverGateBlocked ? 'Đang bị khóa bởi trạng thái máy chủ' : 'Guarded rollback'), ready ? 'success' : 'warning'));
  panel.appendChild(title);

  panel.appendChild(renderSelectedRollbackTarget(selectedPoint, selectedPath));
  panel.appendChild(renderRollbackReadinessPanel(state, historyState, {
    selectedPath,
    previewMatches,
    dryRunMatches,
    hasReason,
  }));

  const dryRunActions = createElement('div', { className: 'cms-admin-actions cms-admin-rollback-actions cms-admin-version-primary-actions' });
  const dryRunButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    type: 'button',
    text: historyState.isRollingBack ? 'Đang kiểm tra...' : 'Kiểm tra khôi phục',
    title: getDryRunDisabledReason(state, historyState, selectedPath) || ROLLBACK_COPY.actions?.dryRun || 'Kiểm tra khôi phục cho bản đã chọn.',
    ariaLabel: getDryRunDisabledReason(state, historyState, selectedPath) || ROLLBACK_COPY.actions?.dryRun || 'Kiểm tra khôi phục cho bản đã chọn.',
  });
  dryRunButton.disabled = !isRollbackAdmin(state) || !selectedPath || historyState.isRollingBack || needsReconciliation || serverGateBlocked;
  dryRunButton.addEventListener('click', () => handleRollbackCmsJson({ sourcePath: selectedPath, dryRun: true, handlers }));
  dryRunActions.appendChild(dryRunButton);
  panel.appendChild(dryRunActions);
  if (serverGateBlocked && (gate.lineageRepairRequired || gate.repairRequired)) {
    panel.appendChild(createElement('div', {
      className: 'cms-admin-alert cms-admin-alert-warning',
      text: 'Bản công khai đã được xác nhận nhưng lịch sử vận hành chưa hoàn tất. Không công khai hoặc khôi phục thêm. Hãy sửa lịch sử vận hành trước.',
    }));
    const repairButton = createElement('button', { className: 'cms-admin-button cms-admin-button-secondary', type: 'button', text: gate.reconciling ? 'Đang sửa lịch sử...' : 'Sửa lịch sử vận hành' });
    repairButton.disabled = Boolean(gate.reconciling);
    repairButton.addEventListener('click', () => handleRepairReleaseLineage({ handlers }));
    panel.appendChild(repairButton);
  }
  if (serverGateBlocked && (gate.terminalAuditIdentityInvalid || gate.terminalAuditConflict)) {
    panel.appendChild(createElement('div', {
      className: 'cms-admin-alert cms-admin-alert-warning',
      text: gate.terminalAuditConflict
        ? 'Lịch sử vận hành có bản ghi mâu thuẫn. Không công khai hoặc khôi phục thêm; cần kiểm tra forensic.'
        : 'Lịch sử vận hành thiếu hoặc mâu thuẫn thông tin định danh. Không công khai hoặc khôi phục thêm; cần kiểm tra dữ liệu vận hành.',
    }));
  }
  if (needsReconciliation && !(gate.lineageRepairRequired || gate.repairRequired || gate.terminalAuditIdentityInvalid || gate.terminalAuditConflict)) {
    panel.appendChild(createElement('div', {
      className: 'cms-admin-alert cms-admin-alert-warning',
      text: 'Chưa xác định website đang dùng bản nào. Không bấm khôi phục lại. Bấm “Kiểm tra trạng thái hiện tại”.',
    }));
    const reconcileButton = createElement('button', {
      className: 'cms-admin-button cms-admin-button-secondary',
      type: 'button',
      text: historyState.isReconcilingRollbackPointer ? 'Đang kiểm tra trạng thái...' : 'Kiểm tra trạng thái hiện tại',
    });
    reconcileButton.disabled = Boolean(historyState.isReconcilingRollbackPointer);
    reconcileButton.addEventListener('click', () => handleReconcileRollbackPointer({ handlers }));
    panel.appendChild(reconcileButton);
  }

  const reasonInput = createElement('textarea', {
    className: 'cms-admin-input cms-admin-rollback-reason-input',
    value: historyState.rollbackReason || '',
    title: ROLLBACK_COPY.actions?.reason || 'Lý do khôi phục',
    ariaLabel: ROLLBACK_COPY.actions?.reason || 'Lý do khôi phục',
    attrs: { rows: '3', placeholder: 'Nhập lý do vận hành, ví dụ: Khôi phục bản sạch sau khi kiểm tra UAT.' },
  });
  reasonInput.disabled = !selectedPath || historyState.isRollingBack || needsReconciliation || serverGateBlocked;
  panel.appendChild(labeledControl('Lý do khôi phục bắt buộc', reasonInput));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text cms-admin-rollback-reason-help',
    text: 'Lý do được ghi vào log vận hành. Rollback thật vẫn yêu cầu xác nhận hai bước tại thời điểm bấm nút.',
  }));

  const guidance = createElement('p', {
    className: `cms-admin-rollback-guidance${ready ? ' is-ready' : ''}`,
    text: getRollbackGuidance({ selectedPath, dryRunMatches, hasReason }),
  });
  panel.appendChild(guidance);

  const rollbackActions = createElement('div', { className: 'cms-admin-actions cms-admin-rollback-actions cms-admin-version-danger-actions' });
  const rollbackButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-danger',
    type: 'button',
    text: historyState.isRollingBack ? 'Đang khôi phục...' : 'Khôi phục thật — đổi website public',
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
    const nowReady = Boolean(selectedPath && dryRunMatches && reasonReady && !serverGateBlocked && !needsReconciliation);
    rollbackButton.disabled = !isRollbackAdmin(state) || historyState.isRollingBack || !nowReady;
    rollbackButton.title = getRollbackDisabledReason(state, historyState, selectedPath, dryRunMatches, reasonReady) || ROLLBACK_COPY.actions?.rollback || 'Khôi phục thật bản đã chọn.';
    rollbackButton.setAttribute('aria-label', rollbackButton.title);
    guidance.className = `cms-admin-rollback-guidance${nowReady ? ' is-ready' : ''}`;
    guidance.textContent = getRollbackGuidance({ selectedPath, dryRunMatches, hasReason: reasonReady });
  });

  if (!isRollbackAdmin(state)) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: 'Chỉ quản trị viên đang hoạt động được khôi phục.' }));
  }
  if (historyState.rollbackReconciliationStatus) {
    panel.appendChild(createElement('div', { className: needsReconciliation ? 'cms-admin-alert cms-admin-alert-warning' : 'cms-admin-alert cms-admin-alert-success', text: historyState.rollbackReconciliationStatus }));
  }
  if (historyState.rollbackReconciliationError) {
    panel.appendChild(renderErrorBox(historyState.rollbackReconciliationError, 'Kiểm tra trạng thái chưa thành công'));
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
  panel.appendChild(createElement('div', {
    className: 'cms-admin-alert cms-admin-alert-warning cms-admin-version-danger-note',
    text: 'Rollback thật chỉ đổi release pointer sau khi server xác minh target. Nếu trạng thái pointer chưa xác định, hệ thống khóa thao tác để kiểm tra lại; không tự phục hồi hoặc ghi đè JSON.',
  }));
  return panel;
}

function renderSelectedRollbackTarget(selectedPoint, selectedPath = '') {
  const wrap = createElement('div', { className: 'cms-admin-selected-rollback-target' });
  if (!selectedPath) {
    wrap.appendChild(createElement('strong', { text: 'Chưa chọn phiên bản' }));
    wrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Chọn một phiên bản ở danh sách bên trái để mở preview và checklist khôi phục.' }));
    return wrap;
  }
  wrap.appendChild(createElement('strong', { text: selectedPoint?.version || selectedPoint?.title || 'Phiên bản đã chọn' }));
  wrap.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: selectedPoint ? `${selectedPoint.label} · ${formatDateTime(selectedPoint.createdAt)}` : getPathFileName(selectedPath),
  }));
  const details = createElement('details', { className: 'cms-admin-rollback-technical-details cms-admin-selected-rollback-details' });
  details.appendChild(createElement('summary', { text: 'Nguồn khôi phục và metadata' }));
  const grid = createElement('div', { className: 'cms-admin-rollback-meta-grid cms-admin-rollback-technical-grid' });
  [
    ['Storage source path', selectedPath],
    ['Audit source', 'cms_publish_logs'],
    ['Loại bản', selectedPoint?.kind === 'backup' ? 'Storage backup path' : 'Storage version path'],
    ['Trạng thái log', selectedPoint ? (STATUS_LABELS[String(selectedPoint.status || '').toLowerCase()] || selectedPoint.status || '—') : '—'],
  ].forEach(([label, value]) => grid.appendChild(renderMeta(label, value)));
  details.appendChild(grid);
  wrap.appendChild(details);
  return wrap;
}

function renderFlowSteps({ selectedPath = '', previewMatches = false, dryRunMatches = false, ready = false } = {}) {
  const steps = createElement('ol', { className: 'cms-admin-rollback-flow-steps cms-admin-version-flow-steps' });
  [
    ['1', 'Chọn phiên bản', Boolean(selectedPath), 'Chọn đúng Storage version/backup path từ cms_publish_logs.'],
    ['2', 'Preview đọc-only', previewMatches, 'Xem tóm tắt nội dung, không đổi website.'],
    ['3', 'Dry-run rollback', dryRunMatches, 'Server kiểm tra điều kiện trước khi khôi phục.'],
    ['4', 'Lý do & xác nhận', ready, 'Rollback thật cần lý do và confirm hai bước.'],
  ].forEach(([number, label, complete, detail]) => {
    const item = createElement('li', { className: complete ? 'is-complete' : '' });
    item.appendChild(createElement('span', { className: 'cms-admin-rollback-step-number', text: complete ? '✓' : number }));
    const content = createElement('span', { className: 'cms-admin-version-step-copy' });
    content.appendChild(createElement('strong', { text: label }));
    content.appendChild(createElement('small', { text: detail }));
    item.appendChild(content);
    steps.appendChild(item);
  });
  return steps;
}

function renderRollbackReadinessPanel(state = {}, historyState = {}, flags = {}) {
  const selectedPath = String(flags.selectedPath || '').trim();
  const selected = Boolean(selectedPath && isSafeVersionPath(selectedPath));
  const historyItems = safeArray(historyState.items);
  const entries = [
    ['Tài khoản quản trị đang hoạt động', isRollbackAdminSession(state), 'Tài khoản quản trị đang hoạt động mới có thể kiểm tra/khôi phục.'],
    ['Quyền khôi phục đã bật', isRollbackFeatureEnabled(), 'Quyền khôi phục phải được bật trong cấu hình hiện có.'],
    ['Lịch sử đã tải', Boolean(historyState.loadedAt || historyItems.length), 'Danh sách lịch sử đã được tải để chọn bản cần khôi phục.'],
    ['Đã chọn phiên bản', selected, 'Chỉ chọn phiên bản hợp lệ trong danh sách.'],
    ['Đã xem trước bản chọn', Boolean(flags.previewMatches), 'Xem trước chỉ đọc bản đã chọn.'],
    ['Kiểm tra khôi phục đã đạt', Boolean(flags.dryRunMatches), 'Kiểm tra khôi phục chạy qua bộ kiểm tra trên server.'],
    ['Có lý do vận hành', Boolean(flags.hasReason), 'Cần lý do vận hành trước khi rollback thật.'],
    ['Không bị khóa bởi trạng thái máy chủ', !Boolean((state.releaseOperationGate || {}).blocked || (state.releaseOperationGate || {}).lineageRepairRequired || (state.releaseOperationGate || {}).repairRequired), 'Server gate phải idle trước khi thao tác nguy hiểm.'],
    ['Sẵn sàng xác nhận khôi phục', Boolean(flags.dryRunMatches && flags.hasReason && !((state.releaseOperationGate || {}).blocked || (state.releaseOperationGate || {}).lineageRepairRequired || (state.releaseOperationGate || {}).repairRequired)), 'Hai hộp xác nhận vẫn xuất hiện tại thời điểm bấm khôi phục thật.'],
  ];
  const blockedReasons = getRollbackBlockedReasons(state, historyState, {
    selectedPath,
    previewMatches: Boolean(flags.previewMatches),
    dryRunMatches: Boolean(flags.dryRunMatches),
    hasReason: Boolean(flags.hasReason),
  });

  const wrap = createElement('div', { className: 'cms-admin-rollback-readiness-panel' });
  const head = createElement('div', { className: 'cms-admin-panel-title-row' });
  head.appendChild(createElement('strong', { text: ROLLBACK_COPY.readinessTitle || 'Checklist của bản đang chọn' }));
  head.appendChild(renderBadge(blockedReasons.length ? 'Đang bị chặn' : 'Đủ điều kiện UI', blockedReasons.length ? 'warning' : 'success'));
  wrap.appendChild(head);
  wrap.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: ROLLBACK_COPY.readinessIntro || 'Checklist này bám theo phiên bản đang chọn và không mở khóa rollback nếu server/dry-run/lý do chưa đạt.',
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
    blocked.appendChild(createElement('strong', { text: ROLLBACK_COPY.disabledReasonsTitle || 'Chưa thể khôi phục vì' }));
    const reasonList = createElement('ul');
    blockedReasons.forEach((reason) => reasonList.appendChild(createElement('li', { text: reason })));
    blocked.appendChild(reasonList);
    wrap.appendChild(blocked);
  }

  return wrap;
}

function getRollbackBlockedReasons(state = {}, historyState = {}, flags = {}) {
  const reasons = [];
  if (!isRollbackAdminSession(state)) reasons.push('Tài khoản hiện tại không phải quản trị viên đang hoạt động.');
  if (!isRollbackFeatureEnabled()) reasons.push('Quyền khôi phục chưa bật trong cấu hình hiện có.');
  if (!historyState.loadedAt && !safeArray(historyState.items).length) reasons.push('Chưa tải lịch sử phiên bản.');
  if (!flags.selectedPath) reasons.push('Chưa chọn phiên bản cần khôi phục.');
  if (flags.selectedPath && !isSafeVersionPath(flags.selectedPath)) reasons.push('Phiên bản được chọn không hợp lệ.');
  if (!flags.previewMatches) reasons.push('Chưa xem trước đúng bản đang chọn.');
  if (!flags.dryRunMatches) reasons.push('Chưa có kiểm tra khôi phục đạt cho đúng bản đang chọn.');
  if (!flags.hasReason) reasons.push('Chưa nhập lý do khôi phục.');
  if (historyState.isRollingBack) reasons.push('Đang có thao tác kiểm tra/khôi phục chạy.');
  return reasons;
}

function getDryRunDisabledReason(state = {}, historyState = {}, selectedPath = '') {
  const gate = state.releaseOperationGate || {};
  if (gate.lineageRepairRequired || gate.repairRequired) return 'Đang bị khóa bởi trạng thái máy chủ: cần sửa lịch sử vận hành trước.';
  if (gate.blocked) return gate.message || 'Đang bị khóa bởi trạng thái máy chủ.';
  if (!isRollbackAdmin(state)) return 'Chỉ quản trị viên đang hoạt động mới chạy được kiểm tra khôi phục.';
  if (!selectedPath) return 'Hãy chọn phiên bản trước khi kiểm tra khôi phục.';
  if (!isSafeVersionPath(selectedPath)) return 'Đường dẫn bản được chọn không hợp lệ.';
  if (historyState.isRollingBack) return 'Đang có thao tác kiểm tra/khôi phục chạy.';
  return '';
}

function getRollbackDisabledReason(state = {}, historyState = {}, selectedPath = '', dryRunMatches = false, hasReason = false) {
  const gate = state.releaseOperationGate || {};
  if (gate.lineageRepairRequired || gate.repairRequired) return 'Đang bị khóa bởi trạng thái máy chủ: cần sửa lịch sử vận hành trước.';
  if (gate.blocked) return gate.message || 'Đang bị khóa bởi trạng thái máy chủ.';
  if (!isRollbackAdmin(state)) return 'Chỉ quản trị viên đang hoạt động mới khôi phục thật.';
  if (!selectedPath) return 'Hãy chọn phiên bản trước khi khôi phục.';
  if (!isSafeVersionPath(selectedPath)) return 'Đường dẫn bản được chọn không hợp lệ.';
  if (!dryRunMatches) return 'Khôi phục thật bị chặn cho đến khi kiểm tra khôi phục đạt đúng bản đã chọn.';
  if (!hasReason) return 'Khôi phục thật bị chặn cho đến khi có lý do vận hành.';
  if (historyState.isRollingBack) return 'Đang có thao tác kiểm tra/khôi phục chạy.';
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
    rollbackPointerState: '',
    rollbackRequiresReconciliation: false,
    rollbackPendingTargetReleaseId: '',
    rollbackPendingContentPath: '',
    rollbackPendingContentHash: '',
    rollbackReconciliationStatus: '',
    rollbackReconciliationError: null,
    rollbackReconciliationResult: null,
    isReconcilingRollbackPointer: false,
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
  const gate = state.releaseOperationGate || {};
  const selectedPath = String(historyState.selectedSourcePath || '').trim();

  if (gate.blocked) {
    setCmsPublishHistoryState({ rollbackError: gate.message || 'Đang có một thao tác công khai hoặc khôi phục chưa hoàn tất. Hãy kiểm tra trạng thái hiện tại trước khi tiếp tục.' });
    handlers.onRerender?.();
    return;
  }

  if (historyState.rollbackRequiresReconciliation || historyState.rollbackPointerState === 'unknown') {
    setCmsPublishHistoryState({ rollbackError: 'Chưa xác định website đang dùng bản nào. Không bấm khôi phục lại. Hãy bấm “Kiểm tra trạng thái hiện tại”.' });
    handlers.onRerender?.();
    return;
  }

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
    targetContentHash: confirmHash,
    expectedCurrentReleaseId: dryRunResult?.expectedCurrentReleaseId || dryRunResult?.currentReleaseId || '',
    expectedCurrentContentHash: dryRunResult?.expectedCurrentContentHash || dryRunResult?.currentContentHash || '',
    reason: historyState.rollbackReason || '',
    dryRun,
  });

  const latestHistoryState = getState().publishHistory || {};
  if (latestHistoryState.selectedSourcePath !== sourcePath || latestHistoryState.rollbackRequestPath !== sourcePath) {
    return;
  }

  if (result.error) {
    const resultCode = result.error?.code || result.data?.code || '';
    const isPointerUnknown = resultCode === 'POINTER_STATE_UNKNOWN' || result.data?.pointerState === 'unknown';
    if (isPointerUnknown) {
      applyReleaseOperationGateFromServer({
        operationId: String(result.data?.operationId || ''),
        operationType: 'rollback',
        state: 'pointer_unknown',
        phase: 'pointer_written',
        targetReleaseId: String(result.data?.targetReleaseId || ''),
        contentHash: String(result.data?.targetContentHash || ''),
        contentPath: String(result.data?.targetContentPath || ''),
      });
      setCmsPublishHistoryState({
        isRollingBack: false,
        rollbackRequestPath: '',
        rollbackPointerState: 'unknown',
        rollbackRequiresReconciliation: true,
        rollbackPendingTargetReleaseId: String(result.data?.targetReleaseId || ''),
        rollbackPendingContentPath: String(result.data?.targetContentPath || ''),
        rollbackPendingContentHash: String(result.data?.targetContentHash || ''),
        rollbackReconciliationStatus: '',
        rollbackReconciliationError: null,
        rollbackReconciliationResult: null,
        isReconcilingRollbackPointer: false,
        rollbackError: 'Chưa xác định website đang dùng bản nào. Không bấm khôi phục lại. Hãy bấm “Kiểm tra trạng thái hiện tại”.',
        rollbackStatus: '',
        rollbackResult: result.data || null,
        rollbackDryRunResult: null,
      });
      handlers.onRerender?.();
      return;
    }
    if (resultCode === 'CURRENT_RELEASE_CHANGED') {
      setCmsPublishHistoryState({
        isRollingBack: false,
        rollbackRequestPath: '',
        rollbackError: 'Bản đang công khai đã thay đổi sau lần kiểm tra. Không khôi phục bằng xác nhận cũ. Hãy tải lại lịch sử và kiểm tra khôi phục lại.',
        rollbackStatus: '',
        rollbackResult: result.data || null,
        rollbackDryRunResult: null,
        rollbackReason: '',
      });
      await handleLoadPublishHistory({ onRerender: () => {} }, { resetWorkflow: false });
      handlers.onRerender?.();
      return;
    }
    if (resultCode === 'RELEASE_LINEAGE_REPAIR_REQUIRED') {
      applyReleaseOperationGateFromServer(result.data || {}, 'Bản công khai đã được xác nhận nhưng lịch sử vận hành chưa hoàn tất. Hãy sửa lịch sử vận hành trước khi tiếp tục.');
      setCmsPublishHistoryState({ isRollingBack: false, rollbackRequestPath: '', rollbackError: 'Bản công khai đã được xác nhận nhưng lịch sử vận hành chưa hoàn tất. Hãy sửa lịch sử vận hành trước.', rollbackStatus: '', rollbackResult: result.data || null, rollbackDryRunResult: null });
      handlers.onRerender?.();
      return;
    }
    if (resultCode === 'RELEASE_OPERATION_BLOCKED') {
      applyReleaseOperationGateFromServer(result.data || {}, 'Đang có một thao tác công khai hoặc khôi phục chưa hoàn tất. Hãy kiểm tra trạng thái hiện tại trước khi tiếp tục.');
      setCmsPublishHistoryState({ isRollingBack: false, rollbackRequestPath: '', rollbackError: 'Đang có một thao tác công khai hoặc khôi phục chưa hoàn tất. Hãy kiểm tra trạng thái hiện tại trước khi tiếp tục.', rollbackStatus: '', rollbackResult: result.data || null, rollbackDryRunResult: null });
      handlers.onRerender?.();
      return;
    }
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
    rollbackPointerState: '',
    rollbackRequiresReconciliation: false,
    rollbackPendingTargetReleaseId: '',
    rollbackPendingContentPath: '',
    rollbackPendingContentHash: '',
    rollbackReconciliationStatus: '',
    rollbackReconciliationError: null,
    rollbackReconciliationResult: null,
    isReconcilingRollbackPointer: false,
    rollbackStatus: 'Khôi phục thành công. Bản đang công khai đã được xác minh. Hãy kiểm tra website.',
    rollbackDryRunResult: null,
    rollbackResult: result.data,
    rollbackReason: '',
  });
  await handleLoadPublishHistory({ onRerender: () => {} }, { resetWorkflow: false });
  handlers.onRerender?.();
}



function isExactIdleReleaseStatusResponse(result = {}, data = {}) {
  if (result?.error) return false;
  const body = data && typeof data === 'object' ? data : {};
  const classification = String(body.classification || '').trim();
  const stateText = String(body.state || '').trim();
  return Boolean(
    body.ok === true
    && String(body.mode || '').trim() === 'status'
    && classification === 'idle'
    && stateText === 'idle'
    && !String(body.operationId || body.id || '').trim()
    && body.lineageRepairRequired !== true
    && body.repairRequired !== true
    && body.reconciliationRequired !== true
    && body.terminalAuditIdentityInvalid !== true
    && body.terminalAuditConflict !== true
    && !body.operation
    && !body.activeOperation
  );
}

function keepReleaseGateBlockedFromStatusFailure({ statusResult = {}, statusData = {}, fallbackMessage = '', successResult = null } = {}) {
  const message = statusResult?.error
    ? normalizeErrorMessage(statusResult.error)
    : (fallbackMessage || 'Máy chủ chưa xác nhận trạng thái an toàn. Không công khai hoặc khôi phục thêm.');
  const body = statusData && typeof statusData === 'object' ? statusData : {};
  if (body.operationId || body.lineageRepairRequired === true || body.repairRequired === true || body.reconciliationRequired === true || ['in_progress', 'pointer_unknown', 'lineage_repair_required', 'terminal_audit_identity_invalid', 'terminal_audit_conflict', 'release_operation_blocked'].includes(String(body.classification || body.state || ''))) {
    applyReleaseOperationGateFromServer(body, message);
    return;
  }
  setReleaseOperationGateState({
    blocked: true,
    reconciling: false,
    error: message,
    result: successResult || body || null,
    lastCheckedAt: new Date().toISOString(),
  });
}


function isResolvedCapableReleaseResponse(data = {}) {
  if (!data || typeof data !== 'object') return false;
  const classification = String(data.classification || '').trim();
  const operationState = String(data.state || data.operationState || data.operation?.state || '').trim();
  return Boolean(
    data.operationResolved === true
    || ['active_expected_release', 'active_other_release', 'operation_already_resolved', 'operation_already_resolved_non_success', 'lineage_repaired', 'failed_before_pointer', 'resolved_active_other'].includes(classification)
    || ['succeeded', 'resolved_active_other', 'failed_before_pointer', 'failed'].includes(operationState)
  );
}


async function refreshReleaseGateAfterPotentialResolution({ handlers = {}, blockedMessage = 'Máy chủ vẫn đang khóa thao tác. Hãy xử lý trạng thái được hiển thị trước khi tiếp tục.', successResult = null } = {}) {
  const statusResult = await reconcileCmsReleasePointer(getState().supabase, { mode: 'status' });
  const statusData = statusResult.data || {};
  if (!isExactIdleReleaseStatusResponse(statusResult, statusData)) {
    keepReleaseGateBlockedFromStatusFailure({ statusResult, statusData, fallbackMessage: blockedMessage, successResult });
    setCmsPublishHistoryState({ rollbackError: statusResult.error ? normalizeErrorMessage(statusResult.error) : blockedMessage });
    handlers.onRerender?.();
    return false;
  }
  clearReleaseOperationGateFromExactIdle(statusData || successResult || null);
  return true;
}

async function handleReconcileRollbackPointer({ handlers = {} } = {}) {
  const current = getState().publishHistory || {};
  const expectedReleaseId = String(current.rollbackPendingTargetReleaseId || current.rollbackResult?.targetReleaseId || current.rollbackResult?.toReleaseId || '').trim();
  const expectedContentHash = String(current.rollbackPendingContentHash || current.rollbackResult?.targetContentHash || current.rollbackResult?.hashAfter || '').trim();
  setCmsPublishHistoryState({
    isReconcilingRollbackPointer: true,
    rollbackReconciliationStatus: 'Đang kiểm tra trạng thái hiện tại...',
    rollbackReconciliationError: null,
  });
  handlers.onRerender?.();
  setReleaseOperationGateState({ reconciling: true, error: null });
  const result = await reconcileCmsReleasePointer(getState().supabase, { mode: 'reconcile', operationId: current.rollbackResult?.operationId || getState().releaseOperationGate?.operationId || '', releaseId: expectedReleaseId, contentHash: expectedContentHash });
  const data = result.data || {};
  if (result.error) {
    const errorMessage = normalizeErrorMessage(result.error);
    if (isResolvedCapableReleaseResponse(data)) {
      const gateIdle = await refreshReleaseGateAfterPotentialResolution({
        handlers,
        successResult: data,
        blockedMessage: 'Máy chủ chưa xác nhận trạng thái idle sau phản hồi lỗi đã resolve. Không thao tác tiếp.',
      });
      setCmsPublishHistoryState({
        isReconcilingRollbackPointer: false,
        rollbackReconciliationError: gateIdle ? null : errorMessage,
        rollbackReconciliationStatus: gateIdle
          ? 'Operation đã resolve và máy chủ xác nhận trạng thái an toàn.'
          : 'Operation có thể đã resolve nhưng máy chủ vẫn chưa xác nhận trạng thái idle. Không thao tác tiếp.',
        rollbackError: gateIdle ? null : 'Máy chủ vẫn đang khóa thao tác. Không khôi phục lại.',
      });
      handlers.onRerender?.();
      return;
    }
    if (data.lineageRepairRequired === true || data.classification === 'lineage_repair_required' || data.classification === 'terminal_audit_identity_invalid' || data.classification === 'terminal_audit_conflict' || result.error.code === 'LINEAGE_REPAIR_PERSIST_FAILED' || result.error.code === 'TERMINAL_AUDIT_IDENTITY_INVALID' || result.error.code === 'TERMINAL_AUDIT_CONFLICT') {
      applyReleaseOperationGateFromServer(data, data.classification === 'terminal_audit_conflict'
        ? 'Lịch sử vận hành có bản ghi terminal mâu thuẫn. Cần kiểm tra forensic trước khi tiếp tục.'
        : data.classification === 'terminal_audit_identity_invalid'
          ? 'Lịch sử vận hành của bản công khai thiếu hoặc mâu thuẫn thông tin định danh. Cần kiểm tra dữ liệu vận hành trước khi tiếp tục.'
          : 'Bản công khai đã được xác nhận nhưng lịch sử vận hành chưa hoàn tất. Hãy sửa lịch sử vận hành trước khi tiếp tục.');
    } else if (data.operationId || data.state === 'pointer_unknown') {
      applyReleaseOperationGateFromServer(data, 'Chưa xác định website đang dùng bản nào. Không khôi phục lại. Hãy kiểm tra trạng thái hiện tại.');
    } else {
      setReleaseOperationGateState({ reconciling: false, error: errorMessage, lastCheckedAt: new Date().toISOString() });
    }
    setCmsPublishHistoryState({
      isReconcilingRollbackPointer: false,
      rollbackReconciliationError: errorMessage,
      rollbackReconciliationStatus: '',
    });
    handlers.onRerender?.();
    return;
  }
  const classification = String(data.classification || 'read_failed');
  if (classification === 'active_expected_release') {
    const gateIdle = await refreshReleaseGateAfterPotentialResolution({
      handlers,
      successResult: data,
      blockedMessage: 'Máy chủ vẫn đang khóa thao tác sau khi kiểm tra. Không khôi phục lại.',
    });
    setCmsPublishHistoryState({
      isReconcilingRollbackPointer: false,
      rollbackPointerState: 'active_expected_release',
      rollbackRequiresReconciliation: !gateIdle,
      rollbackReconciliationResult: data,
      rollbackReconciliationError: null,
      rollbackReconciliationStatus: gateIdle
        ? 'Đã kiểm tra: website đang dùng bản khôi phục vừa thao tác. Không bấm khôi phục lại.'
        : 'Website đã được kiểm tra nhưng máy chủ vẫn chưa xác nhận mở khóa thao tác.',
      rollbackError: gateIdle ? null : 'Máy chủ vẫn đang khóa thao tác. Không khôi phục lại.',
      rollbackStatus: gateIdle ? 'Website đang dùng bản khôi phục vừa thao tác. Hãy mở website để kiểm tra.' : '',
      rollbackDryRunResult: null,
      rollbackReason: '',
    });
  } else if (classification === 'active_other_release') {
    const gateIdle = await refreshReleaseGateAfterPotentialResolution({
      handlers,
      successResult: data,
      blockedMessage: 'Máy chủ vẫn đang khóa thao tác sau khi phát hiện release khác đang active.',
    });
    setCmsPublishHistoryState({
      isReconcilingRollbackPointer: false,
      rollbackPointerState: 'active_other_release',
      rollbackRequiresReconciliation: !gateIdle,
      rollbackReconciliationResult: data,
      rollbackReconciliationError: null,
      rollbackReconciliationStatus: 'Đã kiểm tra: website đang dùng một bản khác. Hãy tải lại lịch sử và kiểm tra lại trước khi thao tác tiếp.',
      rollbackError: gateIdle ? 'Website đang dùng một bản khác với bản vừa khôi phục. Không bấm khôi phục lại bằng confirmation cũ.' : 'Máy chủ vẫn đang khóa thao tác. Không khôi phục lại.',
      rollbackDryRunResult: null,
    });
  } else if (['operation_already_resolved', 'operation_already_resolved_non_success', 'lineage_repaired'].includes(classification) || data.operationResolved === true) {
    const gateIdle = await refreshReleaseGateAfterPotentialResolution({
      handlers,
      successResult: data,
      blockedMessage: 'Máy chủ vẫn chưa xác nhận trạng thái idle sau khi operation đã được resolve.',
    });
    setCmsPublishHistoryState({
      isReconcilingRollbackPointer: false,
      rollbackPointerState: gateIdle ? 'resolved' : 'unknown',
      rollbackRequiresReconciliation: !gateIdle,
      rollbackReconciliationResult: data,
      rollbackReconciliationError: null,
      rollbackReconciliationStatus: gateIdle
        ? 'Máy chủ xác nhận operation đã resolve và trạng thái hiện tại đã an toàn.'
        : 'Operation có thể đã resolve nhưng máy chủ chưa trả trạng thái idle. Không thao tác tiếp.',
      rollbackError: gateIdle ? null : 'Máy chủ vẫn đang khóa thao tác. Không khôi phục lại.',
      rollbackDryRunResult: null,
    });
  } else {
    setCmsPublishHistoryState({
      isReconcilingRollbackPointer: false,
      rollbackPointerState: 'unknown',
      rollbackRequiresReconciliation: true,
      rollbackReconciliationResult: data,
      rollbackReconciliationError: null,
      rollbackReconciliationStatus: 'Vẫn chưa xác định website đang dùng bản nào. Không bấm khôi phục lại. Có thể thử kiểm tra trạng thái lại hoặc tải lại lịch sử.',
      rollbackError: 'Chưa xác định website đang dùng bản nào. Không bấm khôi phục lại.',
      rollbackDryRunResult: null,
    });
  }
  handlers.onRerender?.();
}


async function handleRepairReleaseLineage({ handlers = {} } = {}) {
  const gate = getState().releaseOperationGate || {};
  if (!gate.operationId) {
    setCmsPublishHistoryState({ rollbackError: 'Không tìm thấy thao tác cần sửa lịch sử vận hành.' });
    handlers.onRerender?.();
    return;
  }
  setReleaseOperationGateState({ reconciling: true, error: null });
  setCmsPublishHistoryState({ rollbackStatus: 'Đang sửa lịch sử vận hành...', rollbackError: null });
  handlers.onRerender?.();
  const result = await reconcileCmsReleasePointer(getState().supabase, { mode: 'repair-lineage', operationId: gate.operationId });
  const repairData = result.data || {};
  const auditRepair = repairData.auditRepair || {};
  const auditLogId = repairData.auditLogId || auditRepair.auditLogId || auditRepair.id || '';
  const repairPersisted = result.error ? false : Boolean(repairData.persisted === true && repairData.auditLogState === 'present' && auditLogId);
  if (result.error || !repairPersisted) {
    const message = result.error
      ? normalizeErrorMessage(result.error)
      : 'Sửa lịch sử vận hành chưa được lưu xác nhận trên máy chủ. Trạng thái khóa vẫn được giữ.';
    applyReleaseOperationGateFromServer(repairData && Object.keys(repairData).length ? repairData : {
      classification: 'lineage_repair_required',
      code: 'LINEAGE_REPAIR_PERSIST_FAILED',
      lineageRepairRequired: true,
      repairable: true,
      operationId: gate.operationId,
      operationType: gate.operationType,
      blocked: true,
      error: message,
    }, message);
    setCmsPublishHistoryState({ rollbackStatus: '', rollbackError: message });
    handlers.onRerender?.();
    return;
  }

  const statusResult = await reconcileCmsReleasePointer(getState().supabase, { mode: 'status' });
  const statusData = statusResult.data || {};
  if (!isExactIdleReleaseStatusResponse(statusResult, statusData)) {
    const message = statusResult.error
      ? normalizeErrorMessage(statusResult.error)
      : 'Máy chủ vẫn đang khóa thao tác. Hãy xử lý trạng thái được hiển thị trước khi tiếp tục.';
    keepReleaseGateBlockedFromStatusFailure({ statusResult, statusData, fallbackMessage: message, successResult: repairData });
    setCmsPublishHistoryState({ rollbackStatus: statusResult.error ? 'Đã gửi yêu cầu sửa lịch sử, nhưng chưa xác nhận được trạng thái máy chủ. Không khôi phục lại.' : '', rollbackError: message });
    handlers.onRerender?.();
    return;
  }
  clearReleaseOperationGateFromExactIdle(statusData || repairData || null);
  setCmsPublishHistoryState({ rollbackStatus: 'Đã sửa lịch sử vận hành và máy chủ xác nhận trạng thái an toàn. Hãy tải lại lịch sử trước khi thao tác tiếp.', rollbackError: null });
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
    rollbackPointerState: '',
    rollbackRequiresReconciliation: false,
    rollbackPendingTargetReleaseId: '',
    rollbackPendingContentPath: '',
    rollbackPendingContentHash: '',
    rollbackReconciliationStatus: '',
    rollbackReconciliationError: null,
    rollbackReconciliationResult: null,
    isReconcilingRollbackPointer: false,
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
  if (historyState.rollbackRequiresReconciliation || historyState.rollbackPointerState === 'unknown') return false;
  const dryRun = historyState.rollbackDryRunResult;
  return Boolean(
    sourcePath
    && dryRun?.ok === true
    && dryRun?.dryRun === true
    && dryRun?.sourcePath === sourcePath
    && dryRun?.sourceHash
    && dryRun?.expectedCurrentReleaseId
    && dryRun?.expectedCurrentContentHash
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
  const text = String(path || '').trim();
  if (!text || text.includes('..') || text.includes('\\') || text.includes('//')) return false;
  return /^published\/releases\/[0-9a-f-]{36}\/cms_public_content\.json$/i.test(text)
    || /^published\/versions\/cms_public_content_[A-Za-z0-9._-]+\.json$/.test(text);
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
