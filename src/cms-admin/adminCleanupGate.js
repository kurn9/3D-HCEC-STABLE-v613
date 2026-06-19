import { ADMIN_COPY } from './adminCopy.js';
import { ADMIN_FEATURE_FLAGS, ADMIN_ROLES, CMS_STORAGE_CLEANUP_CONFIG } from './adminConfig.js';
import { dryRunCmsStorageCleanup, safeDeleteSelectedPublicVersionCleanup, scanCmsStorageCleanup } from './adminApi.js';
import { getState, setCmsStorageCleanupState } from './adminState.js';
import {
  appendChildren,
  createElement,
  formatCount,
  formatDateTime,
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

function getCleanupRetentionDays(stateOrCleanup = {}) {
  const cleanup = stateOrCleanup.storageCleanup || stateOrCleanup || {};
  return cleanup.retentionDays || CMS_STORAGE_CLEANUP_CONFIG.defaultRetentionDays || 1;
}

function renderCleanupTitle(copy = {}) {
  const header = createElement('div', { className: 'cms-admin-cleanup-header' });
  const left = createElement('div');
  left.appendChild(createElement('h3', { className: 'cms-admin-section-title', text: copy.title || 'Quét & dọn tệp' }));
  left.appendChild(createElement('p', { className: 'cms-admin-compact-copy', text: copy.intro || 'Chỉ quét và kiểm tra. Không xóa dữ liệu.' }));
  const badges = createElement('div', { className: 'cms-admin-cleanup-badges' });
  badges.appendChild(renderBadge(copy.status || 'Giữ 10 bản gần nhất', 'warning'));
  badges.appendChild(renderBadge('Chỉ dọn kho nội dung website', 'info'));
  badges.appendChild(renderBadge('Xóa thô đang tắt', 'success'));
  badges.appendChild(renderBadge('Không xóa website đang chạy', 'success'));
  appendChildren(header, [left, badges]);
  return header;
}

function renderCleanupNotice(copy = {}) {
  const wrap = createElement('div', { className: 'cms-admin-alert cms-admin-alert-info' });
  wrap.appendChild(createElement('strong', { text: 'An toàn dữ liệu' }));
  wrap.appendChild(createElement('p', { text: copy.deleteDisabled || 'Dọn dẹp tự do đang bị tắt ở cả giao diện và server.' }));
  wrap.appendChild(createElement('p', { text: 'Mặc định giữ lại 10 bản gần nhất. Quét/kiểm tra có thể ghi log kiểm tra nhưng không xóa file.' }));
  wrap.appendChild(createElement('p', { text: 'Màn này không tự xóa bản cũ khi chỉ mở, chọn bản, quét hoặc kiểm tra.' }));
  return wrap;
}

function renderCleanupControls(state, options = {}) {
  const cleanup = state.storageCleanup || {};
  const copy = ADMIN_COPY.cleanup || {};
  const controls = createElement('section', { className: 'cms-admin-cleanup-controls cms-admin-cleanup-controls-simple' });

  const scopeValue = createElement('div', { className: 'cms-admin-cleanup-scope-static', text: 'Phiên bản & backup cũ trong kho nội dung website' });

  const retentionInput = createElement('input', {
    className: 'cms-admin-input cms-admin-cleanup-number',
    type: 'number',
    value: getCleanupRetentionDays(cleanup),
    attrs: { min: String(CMS_STORAGE_CLEANUP_CONFIG.minRetentionDays || 1), step: '1' },
  });
  retentionInput.addEventListener('change', () => setCmsStorageCleanupState({ retentionDays: normalizeControlNumber(retentionInput.value, 1, CMS_STORAGE_CLEANUP_CONFIG.minRetentionDays || 1, 3650) }));

  const keepInput = createElement('input', {
    className: 'cms-admin-input cms-admin-cleanup-number',
    type: 'number',
    value: cleanup.keepLastVersions || CMS_STORAGE_CLEANUP_CONFIG.defaultKeepLastVersions || 10,
    attrs: { min: String(CMS_STORAGE_CLEANUP_CONFIG.minKeepLastVersions || 10), step: '1' },
  });
  keepInput.addEventListener('change', () => setCmsStorageCleanupState({ keepLastVersions: normalizeControlNumber(keepInput.value, 10, CMS_STORAGE_CLEANUP_CONFIG.minKeepLastVersions || 10, 500) }));

  const dryRunButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary cms-admin-cleanup-primary-check-button',
    text: cleanup.loading && cleanup.action === 'dryRun' ? (copy.controls?.dryRunning || 'Đang quét & kiểm tra...') : (copy.controls?.dryRun || 'Quét & kiểm tra bản cũ'),
    type: 'button',
  });
  dryRunButton.disabled = cleanup.loading || !ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupScan;
  dryRunButton.addEventListener('click', () => handleCleanupAction('dryRun', options));

  appendChildren(controls, [
    renderLabeledControl(copy.controls?.scope || 'Phạm vi', scopeValue),
    renderLabeledControl(copy.controls?.retentionDays || 'Số ngày giữ lại', retentionInput),
    renderLabeledControl(copy.controls?.keepLastVersions || 'Giữ bản gần nhất', keepInput),
    createElement('div', { className: 'cms-admin-cleanup-actions' }),
  ]);
  controls.querySelector('.cms-admin-cleanup-actions')?.append(dryRunButton);

  const advanced = createElement('details', { className: 'cms-admin-cleanup-advanced-controls' });
  advanced.appendChild(createElement('summary', { text: 'Tùy chọn nâng cao' }));
  const scanButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    text: cleanup.loading && cleanup.action === 'scan' ? (copy.controls?.scanning || 'Đang quét...') : (copy.controls?.scan || 'Chỉ quét danh sách'),
    type: 'button',
  });
  scanButton.disabled = cleanup.loading || !ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupScan;
  scanButton.addEventListener('click', () => handleCleanupAction('scan', options));
  const advancedBody = createElement('div', { className: 'cms-admin-cleanup-advanced-body' });
  advancedBody.appendChild(createElement('p', { text: 'Tùy chọn này chỉ đọc dữ liệu để xem bề mặt lưu trữ, không tạo kế hoạch xóa.' }));
  advancedBody.appendChild(scanButton);
  advanced.appendChild(advancedBody);
  controls.appendChild(advanced);
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
  const resultWrap = createElement('section', { className: 'cms-admin-cleanup-result cms-admin-cleanup-single-workspace' });

  if (cleanup.error) resultWrap.appendChild(renderErrorBox(cleanup.error, 'Không thể quét hoặc kiểm tra tệp'));
  if (!result) {
    resultWrap.appendChild(renderCleanupEmptyWorkspace(copy));
    return resultWrap;
  }

  resultWrap.appendChild(renderCleanupSummary(result));
  if (safeArray(result.warnings).length) resultWrap.appendChild(renderWarnings(result.warnings));
  resultWrap.appendChild(renderCleanupOperatorWorkspace(state, result, options));
  if (cleanup.safeDeleteResult) resultWrap.appendChild(renderSafeDeleteResult(cleanup.safeDeleteResult));
  return resultWrap;
}

function renderCleanupEmptyWorkspace(copy = {}) {
  const empty = createElement('section', { className: 'cms-admin-cleanup-empty-workspace' });
  empty.appendChild(createElement('h4', { className: 'cms-admin-subsection-title', text: 'Chưa có kết quả quét' }));
  empty.appendChild(createElement('p', { className: 'cms-admin-help-text', text: copy.noResult || 'Chưa có kết quả. Hãy bấm “Quét & kiểm tra bản cũ”.' }));
  const steps = createElement('div', { className: 'cms-admin-cleanup-empty-steps' });
  [
    ['1', 'Quét & kiểm tra bản cũ', 'Server kiểm tra phiên bản/backup cũ trong kho nội dung website; chưa xóa file.'],
    ['2', 'Chọn một bản cũ', 'Danh sách ưu tiên phiên bản hoặc bản sao lưu có thể xóa ở phía trên.'],
    ['3', 'Xóa bản đã chọn', 'Nút xóa chỉ mở khi bản đã chọn nằm ngoài vùng giữ 10 bản gần nhất và đạt kiểm tra an toàn.'],
    ['4', 'Xác nhận bằng popup', 'Server chỉ xóa đúng bản đã chọn sau khi tự kiểm tra lại.'],
  ].forEach(([number, title, body]) => {
    const step = createElement('div', { className: 'cms-admin-cleanup-empty-step' });
    step.appendChild(createElement('span', { className: 'cms-admin-operator-step-number', text: number }));
    const text = createElement('div');
    text.appendChild(createElement('strong', { text: title }));
    text.appendChild(createElement('p', { text: body }));
    step.appendChild(text);
    steps.appendChild(step);
  });
  empty.appendChild(steps);
  return empty;
}

function renderCleanupOperatorWorkspace(state, result = {}, options = {}) {
  const items = getCleanupDisplayItems(result);
  const safeDeleteCandidates = items.filter(isPublicVersionSafeDeleteCandidate);
  const cleanup = state.storageCleanup || {};
  const selectedKey = cleanup.selectedCleanupCandidateKey || '';
  const selectedItem = items.find((item) => cleanupItemKey(item) === selectedKey) || null;
  const workspace = createElement('section', { className: 'cms-admin-cleanup-workflow-grid' });
  workspace.appendChild(renderCleanupCandidateList(items, selectedItem, options));
  workspace.appendChild(renderCleanupCandidateDetail(selectedItem, result));
  workspace.appendChild(renderCleanupRightActionRail(state, result, selectedItem, safeDeleteCandidates, items, options));
  return workspace;
}

function renderCleanupRightActionRail(state, result = {}, selectedItem, safeDeleteCandidates = [], items = [], options = {}) {
  const rail = createElement('aside', { className: 'cms-admin-cleanup-right-rail', attrs: { 'aria-label': 'Thao tác xóa bản cũ an toàn' } });
  rail.appendChild(renderCleanupChecklistAndActions(state, result, selectedItem, safeDeleteCandidates, options));
  rail.appendChild(renderCleanupActivityPanel(result, items, safeDeleteCandidates));
  return rail;
}

function getCleanupDisplayItems(result = {}) {
  const items = safeArray(result.eligibleItems).concat(safeArray(result.blockedItems), safeArray(result.items));
  return dedupeItems(items)
    .filter(isPublicVersionCleanupItem)
    .sort((a, b) => {
      const aSafe = isPublicVersionSafeDeleteCandidate(a) ? 0 : 1;
      const bSafe = isPublicVersionSafeDeleteCandidate(b) ? 0 : 1;
      if (aSafe !== bSafe) return aSafe - bSafe;
      const aEligible = a.eligible ? 0 : 1;
      const bEligible = b.eligible ? 0 : 1;
      if (aEligible !== bEligible) return aEligible - bEligible;
      return String(a.path || '').localeCompare(String(b.path || ''));
    });
}

function renderCleanupCandidateList(items = [], selectedItem, options = {}) {
  const section = createElement('section', { className: 'cms-admin-cleanup-candidate-list-panel' });
  const header = createElement('div', { className: 'cms-admin-cleanup-panel-header' });
  const titleWrap = createElement('div');
  titleWrap.appendChild(createElement('h4', { className: 'cms-admin-subsection-title', text: 'Danh sách bản/backup cũ' }));
  titleWrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Chọn một phiên bản hoặc bản sao lưu cũ để xem chi tiết. Chọn chỉ cập nhật giao diện, không gọi API và không xóa file.' }));
  header.appendChild(titleWrap);
  header.appendChild(renderBadge(`${formatCount(items.length)} bản`, 'info'));
  section.appendChild(header);

  if (!items.length) {
    section.appendChild(renderEmptyState('Chưa có bản/backup cũ trong kết quả hiện tại. Hãy bấm “Quét & kiểm tra bản cũ” để server tạo danh sách an toàn.'));
    return section;
  }

  const list = createElement('div', { className: 'cms-admin-cleanup-candidate-list' });
  items.slice(0, 250).forEach((item) => list.appendChild(renderCleanupCandidateCard(item, selectedItem, options)));
  if (items.length > 250) {
    list.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Danh sách đang giới hạn 250 bản đầu tiên để tránh quá tải giao diện. Hãy lọc hoặc quét lại nếu cần xem thêm.' }));
  }
  section.appendChild(list);
  return section;
}

function renderCleanupCandidateCard(item = {}, selectedItem, options = {}) {
  const key = cleanupItemKey(item);
  const selected = selectedItem && cleanupItemKey(selectedItem) === key;
  const card = createElement('article', {
    className: `cms-admin-cleanup-candidate-card${selected ? ' is-selected' : ''}${isPublicVersionSafeDeleteCandidate(item) ? ' is-eligible' : ' is-blocked'}`,
  });
  const top = createElement('div', { className: 'cms-admin-cleanup-candidate-top' });
  const title = createElement('div', { className: 'cms-admin-cleanup-candidate-title' });
  title.appendChild(createElement('strong', { text: getCleanupCandidateTitle(item) }));
  title.appendChild(createElement('span', { text: item.bucket === 'cms-public' ? 'Kho nội dung website' : item.bucket === 'cms-media' ? 'Kho ảnh/video' : (item.bucket || 'Không rõ kho lưu trữ') }));
  top.appendChild(title);
  top.appendChild(renderCleanupCandidateStatusBadge(item));
  card.appendChild(top);

  const meta = createElement('div', { className: 'cms-admin-cleanup-candidate-meta' });
  meta.appendChild(createElement('span', { text: `Kết luận: ${getCleanupClassificationLabel(item.classification)}` }));
  meta.appendChild(createElement('span', { text: `Số nơi đang dùng: ${formatCount(getCleanupReferenceCount(item))}` }));
  meta.appendChild(createElement('span', { text: `Dung lượng: ${formatCount(item.sizeBytes || 0)} bytes` }));
  if (item.objectKind) meta.appendChild(createElement('span', { text: `Loại: ${getCleanupObjectKindLabel(item.objectKind)}` }));
  card.appendChild(meta);

  const reason = getCleanupCandidateReason(item);
  if (reason) card.appendChild(createElement('p', { className: 'cms-admin-cleanup-candidate-reason', text: reason }));

  const actions = createElement('div', { className: 'cms-admin-cleanup-candidate-actions' });
  const selectButton = createElement('button', {
    className: `cms-admin-button ${selected ? 'cms-admin-button-muted' : 'cms-admin-button-secondary'}`,
    type: 'button',
    text: selected ? 'Đang xem bản' : 'Chọn bản',
    attrs: { 'aria-pressed': selected ? 'true' : 'false' },
  });
  selectButton.addEventListener('click', () => {
    setCmsStorageCleanupState({ selectedCleanupCandidateKey: key });
    options.onRerender?.();
  });
  actions.appendChild(selectButton);
  actions.appendChild(renderCleanupItemDetails(item, 'Thông tin kỹ thuật'));
  card.appendChild(actions);
  return card;
}

function renderCleanupCandidateStatusBadge(item = {}) {
  if (isPublicVersionSafeDeleteCandidate(item)) return renderBadge('Có thể xóa', 'success');
  if (isPublicVersionCleanupItem(item)) return renderBadge('Được bảo vệ', 'warning');
  return renderBadge('Không xử lý ở màn này', 'danger');
}

function renderCleanupCandidateDetail(item, result = {}) {
  const section = createElement('section', { className: 'cms-admin-cleanup-detail-panel' });
  const header = createElement('div', { className: 'cms-admin-cleanup-panel-header' });
  const titleWrap = createElement('div');
  titleWrap.appendChild(createElement('h4', { className: 'cms-admin-subsection-title', text: 'Chi tiết bản đã chọn' }));
  titleWrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Chỉ xem để đối chiếu đường dẫn, vùng giữ lại và lý do vì sao bản có thể xóa hoặc được bảo vệ.' }));
  header.appendChild(titleWrap);
  header.appendChild(renderBadge('Chỉ xem', 'info'));
  section.appendChild(header);

  if (!item) {
    section.appendChild(renderEmptyState('Chọn một bản trong danh sách để xem kho lưu trữ, đường dẫn, vùng giữ lại và thông tin kỹ thuật.'));
    return section;
  }

  const identity = createElement('div', { className: 'cms-admin-cleanup-selected-identity' });
  identity.appendChild(createElement('strong', { text: getCleanupCandidateTitle(item) }));
  identity.appendChild(createElement('p', { text: item.path || 'Không có đường dẫn trong dữ liệu trả về.' }));
  identity.appendChild(renderCleanupCandidateStatusBadge(item));
  section.appendChild(identity);

  const facts = createElement('div', { className: 'cms-admin-cleanup-fact-grid' });
  [
    ['Kho nội dung', item.bucket === 'cms-public' ? 'Kho nội dung website' : (item.bucket || '—')],
    ['Loại bản', getCleanupObjectKindLabel(item.objectKind)],
    ['Kết luận', getCleanupClassificationLabel(item.classification)],
    ['Có thể xóa', isPublicVersionSafeDeleteCandidate(item) ? 'Có' : 'Không'],
    ['Số nơi đang dùng', formatCount(getCleanupReferenceCount(item))],
    ['Dung lượng', `${formatCount(item.sizeBytes || 0)} bytes`],
    ['Mã lần quét', result.runId ? 'Đã có' : '—'],
    ['Mã kiểm tra', result.planHash ? 'Đã có' : '—'],
  ].forEach(([label, value]) => facts.appendChild(renderCleanupFact(label, value)));
  section.appendChild(facts);

  const refs = safeArray(item.references);
  const usage = createElement('div', { className: 'cms-admin-cleanup-usage-box' });
  usage.appendChild(createElement('h5', { text: 'Nơi bản đang được dùng' }));
  if (!refs.length) {
    usage.appendChild(createElement('p', { text: getCleanupReferenceCount(item) > 0 ? 'Có số nơi đang dùng nhưng phản hồi không kèm danh sách chi tiết.' : 'Chưa thấy nơi dùng trong dữ liệu đã kiểm tra.' }));
  } else {
    const list = createElement('ul');
    refs.slice(0, 12).forEach((ref) => list.appendChild(createElement('li', { text: formatCleanupReference(ref) })));
    if (refs.length > 12) list.appendChild(createElement('li', { text: `Còn ${formatCount(refs.length - 12)} nơi dùng khác trong phản hồi.` }));
    usage.appendChild(list);
  }
  section.appendChild(usage);
  section.appendChild(renderCleanupItemDetails(item, 'Thông tin kỹ thuật'));
  return section;
}

function renderCleanupChecklistAndActions(state, result = {}, selectedItem, safeDeleteCandidates = [], options = {}) {
  const cleanup = state.storageCleanup || {};
  const section = createElement('section', { className: 'cms-admin-cleanup-action-panel cms-admin-cleanup-simple-delete-panel' });
  const header = createElement('div', { className: 'cms-admin-cleanup-panel-header' });
  const titleWrap = createElement('div');
  titleWrap.appendChild(createElement('h4', { className: 'cms-admin-subsection-title', text: 'Bản đã chọn' }));
  titleWrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Chọn một phiên bản hoặc bản sao lưu cũ, kiểm tra trạng thái rồi xác nhận xóa bằng popup tiếng Việt.' }));
  header.appendChild(titleWrap);
  header.appendChild(renderBadge('Xóa có kiểm soát', ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupSafeDelete ? 'success' : 'danger'));
  section.appendChild(header);
  section.appendChild(renderCleanupRetentionStatus(state, result));

  const responseLooksLimited = hasLimitedCleanupItems(result);
  const readiness = getCleanupSelectedDeleteReadiness(state, result, selectedItem, responseLooksLimited);

  const selectedBox = createElement('div', { className: `cms-admin-cleanup-selected-delete-summary ${readiness.canDelete ? 'is-ready' : 'is-blocked'}` });
  selectedBox.appendChild(createElement('span', { className: 'cms-admin-cleanup-selected-label', text: 'Bản đang chọn' }));
  selectedBox.appendChild(createElement('strong', { text: selectedItem ? getCleanupCandidateTitle(selectedItem) : 'Chưa chọn bản' }));
  if (selectedItem?.path) selectedBox.appendChild(createElement('p', { text: selectedItem.path }));
  selectedBox.appendChild(renderBadge(readiness.canDelete ? 'Có thể xóa' : 'Không xóa được', readiness.canDelete ? 'success' : 'danger'));
  selectedBox.appendChild(createElement('p', { text: readiness.primaryReason }));
  if (selectedItem) {
    const miniFacts = createElement('div', { className: 'cms-admin-cleanup-selected-mini-facts' });
    [
      ['Dung lượng', `${formatCount(selectedItem.sizeBytes || 0)} bytes`],
      ['Số nơi đang dùng', formatCount(getCleanupReferenceCount(selectedItem))],
      ['Kết luận', getCleanupClassificationLabel(selectedItem.classification)],
    ].forEach(([label, value]) => miniFacts.appendChild(renderCleanupFact(label, value)));
    selectedBox.appendChild(miniFacts);
  }
  section.appendChild(selectedBox);

  const deleteButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-danger cms-admin-cleanup-delete-selected-button',
    type: 'button',
    text: cleanup.loading && cleanup.action === 'safeDeleteSelectedPublicVersion' ? 'Đang xóa bản...' : 'Xóa bản đã chọn',
  });
  deleteButton.disabled = cleanup.loading || !readiness.canDelete;
  deleteButton.addEventListener('click', () => openCleanupDeleteConfirmModal({
    item: selectedItem,
    onConfirm: () => handleSafeDeleteSelectedAction(result, selectedItem, options),
  }));
  section.appendChild(deleteButton);

  if (!readiness.canDelete && readiness.blockingReasons.length) {
    const block = createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning cms-admin-cleanup-block-reasons' });
    block.appendChild(createElement('strong', { text: 'Chưa thể xóa vì' }));
    const ul = createElement('ul');
    readiness.blockingReasons.forEach((reason) => ul.appendChild(createElement('li', { text: reason })));
    block.appendChild(ul);
    section.appendChild(block);
  }

  const details = createElement('details', { className: 'cms-admin-cleanup-technical-details cms-admin-cleanup-auto-check-details' });
  details.appendChild(createElement('summary', { text: `Kiểm tra an toàn tự động — ${readiness.canDelete ? 'Đạt, có thể xóa' : 'Chưa đạt, chưa thể xóa'}` }));
  const list = createElement('div', { className: 'cms-admin-cleanup-checklist' });
  readiness.checks.forEach(({ label, pass, detail }) => list.appendChild(renderCleanupChecklistItem(label, pass, detail)));
  details.appendChild(list);
  section.appendChild(details);
  return section;
}


function renderCleanupRetentionStatus(state = getState(), result = {}) {
  const cleanup = state.storageCleanup || {};
  const retentionDays = result.retentionDays || getCleanupRetentionDays(cleanup);
  const box = createElement('div', { className: 'cms-admin-cleanup-retention-status' });
  box.appendChild(createElement('span', { text: 'Thời gian giữ lại hiện tại' }));
  box.appendChild(createElement('strong', { text: `${formatCount(retentionDays)} ngày` }));
  box.appendChild(createElement('p', { text: 'Quét/kiểm tra có thể ghi log nhưng không xóa file. Dọn thật chỉ theo kế hoạch đã được server kiểm tra lại.' }));
  return box;
}

function renderCleanupChecklistItem(label, pass, detail) {
  const item = createElement('div', { className: `cms-admin-cleanup-checklist-item ${pass ? 'is-pass' : 'is-blocked'}` });
  item.appendChild(createElement('span', { className: 'cms-admin-cleanup-check-icon', text: pass ? '✓' : '•', attrs: { 'aria-hidden': 'true' } }));
  const body = createElement('div');
  body.appendChild(createElement('strong', { text: label }));
  body.appendChild(createElement('p', { text: detail }));
  item.appendChild(body);
  return item;
}

function renderCleanupActivityPanel(result = {}, items = [], safeDeleteCandidates = []) {
  const section = createElement('section', { className: 'cms-admin-cleanup-activity-panel' });
  const header = createElement('div', { className: 'cms-admin-cleanup-panel-header' });
  const titleWrap = createElement('div');
  titleWrap.appendChild(createElement('h4', { className: 'cms-admin-subsection-title', text: 'Thông tin kiểm tra' }));
  titleWrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Thông tin kỹ thuật dùng để đối chiếu lần quét, không thay thế kiểm tra an toàn trên server.' }));
  header.appendChild(titleWrap);
  header.appendChild(renderBadge('Chỉ xem', 'info'));
  section.appendChild(header);

  const summary = result.summary || {};
  const facts = createElement('div', { className: 'cms-admin-cleanup-fact-grid' });
  [
    ['Thao tác', result.action === 'dryRun' ? 'Quét & kiểm tra bản cũ' : result.action === 'scan' ? 'Chỉ quét danh sách' : (result.action || '—')],
    ['Mã lần quét', result.runId || '—'],
    ['Mã kiểm tra', result.planHash ? 'Đã có' : '—'],
    ['Thời điểm tải', formatDateTime(result.generatedAt || result.createdAt || result.timestamp || result.loadedAt)],
    ['Tổng số bản', formatCount(items.length)],
    ['Bản có thể xóa', formatCount(safeDeleteCandidates.length)],
    ['Bản đồ liên kết chưa đủ', result.graphIncomplete || summary.graphIncomplete ? 'Có' : 'Không'],
    ['Phản hồi bị giới hạn', hasLimitedCleanupItems(result) ? 'Có' : 'Không'],
  ].forEach(([label, value]) => facts.appendChild(renderCleanupFact(label, value)));
  section.appendChild(facts);

  const details = createElement('details', { className: 'cms-admin-cleanup-technical-details' });
  details.appendChild(createElement('summary', { text: 'Thông tin kỹ thuật của lần quét' }));
  const pre = createElement('pre', { className: 'cms-admin-cleanup-metadata-pre', text: JSON.stringify({
    runId: result.runId || null,
    planHash: result.planHash || null,
    action: result.action || null,
    graphIncomplete: Boolean(result.graphIncomplete || summary.graphIncomplete),
    itemsTruncated: Boolean(result.itemsTruncated || result.responseTruncated || summary.itemsTruncated || summary.responseTruncated),
    summary,
  }, null, 2) });
  details.appendChild(pre);
  section.appendChild(details);
  return section;
}

function deriveCleanupBlockingReasons(result = {}, selectedItem, responseLooksLimited, selectedSafe) {
  return getCleanupSelectedDeleteReadiness(getState(), result, selectedItem, responseLooksLimited, selectedSafe).blockingReasons;
}

function getCleanupSelectedDeleteReadiness(state = getState(), result = {}, selectedItem, responseLooksLimited = hasLimitedCleanupItems(result), selectedSafe = null) {
  const summary = result.summary || {};
  const graphReady = !(result.graphIncomplete || summary.graphIncomplete);
  const safeCandidate = selectedSafe === null ? Boolean(selectedItem && isPublicVersionSafeDeleteCandidate(selectedItem)) : Boolean(selectedSafe);
  const selectedRefCount = selectedItem ? getCleanupReferenceCount(selectedItem) : 0;
  const selectedHasActiveReference = selectedItem ? hasActiveCleanupReference(selectedItem) : true;
  const checks = [
    { label: 'Tài khoản quản trị đang hoạt động', pass: canUseCleanupScan(state), detail: 'Chỉ quản trị viên đang hoạt động mới được xóa có kiểm soát.' },
    { label: 'Chức năng quét đang bật', pass: Boolean(ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupScan), detail: 'Màn này phải được bật trong cấu hình giao diện.' },
    { label: 'Chức năng xóa có kiểm soát đang bật', pass: Boolean(ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupSafeDelete), detail: 'Chỉ mở nút xóa khi cấu hình cho phép và server vẫn tự kiểm tra lại.' },
    { label: 'Đã quét & kiểm tra bản cũ', pass: result.action === 'dryRun', detail: 'Kết quả kiểm tra tạo kế hoạch an toàn trước khi xóa bản cũ.' },
    { label: 'Có mã lần quét', pass: Boolean(result.runId), detail: 'Server cần mã lần quét để đối chiếu kế hoạch.' },
    { label: 'Có mã kiểm tra', pass: Boolean(result.planHash), detail: 'Server cần mã kiểm tra để phát hiện kế hoạch bị thay đổi.' },
    { label: 'Bản đồ nơi dùng đã đủ', pass: graphReady, detail: 'Không xóa nếu chưa kiểm tra đủ nơi bản có thể đang được dùng.' },
    { label: 'Phản hồi không bị giới hạn', pass: !responseLooksLimited, detail: 'Không xóa nếu danh sách kiểm tra bị cắt ngắn.' },
    { label: 'Đã chọn bản', pass: Boolean(selectedItem), detail: 'Người vận hành phải chọn một bản cụ thể.' },
    { label: 'Bản có kho và đường dẫn rõ', pass: Boolean(selectedItem?.bucket && selectedItem?.path), detail: 'Bản phải có kho lưu trữ và đường dẫn rõ ràng.' },
    { label: 'Bản nằm ngoài vùng giữ lại', pass: Boolean(selectedItem && ['version_only_old', 'backup_old', 'rollback_backup_old'].includes(selectedItem.classification)), detail: 'Chỉ bản/backup cũ nằm ngoài vùng giữ 10 bản gần nhất mới được xét xóa.' },
    { label: 'Bản thuộc nhóm được phép xóa', pass: safeCandidate, detail: 'Guard hiện tại chỉ cho phiên bản, bản sao lưu hoặc bản sao khôi phục cũ trong kho nội dung website.' },
    { label: 'Không có nơi đang dùng active', pass: selectedItem ? !selectedHasActiveReference : false, detail: 'Không xóa nếu bản vẫn có nơi đang dùng active.' },
  ];
  const blockingReasons = [];
  if (!ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupSafeDelete) blockingReasons.push('Chức năng xóa có kiểm soát đang bị khóa.');
  if (result.action !== 'dryRun') blockingReasons.push('Chưa có kết quả “Quét & kiểm tra bản cũ”.');
  if (!result.runId) blockingReasons.push('Thiếu mã lần quét. Hãy quét & kiểm tra lại.');
  if (!result.planHash) blockingReasons.push('Thiếu mã kiểm tra. Hãy quét & kiểm tra lại.');
  if (!graphReady) blockingReasons.push('Danh sách nơi dùng chưa được kiểm tra đầy đủ.');
  if (responseLooksLimited) blockingReasons.push('Danh sách kiểm tra bị giới hạn hoặc chưa đầy đủ.');
  if (!selectedItem) blockingReasons.push('Chưa chọn bản cần xóa.');
  if (selectedItem && !safeCandidate) blockingReasons.push(getCleanupCandidateReason(selectedItem));
  if (selectedItem && selectedHasActiveReference) blockingReasons.push('Bản vẫn có nơi đang dùng active.');
  const canDelete = checks.every((check) => check.pass);
  return {
    canDelete,
    checks,
    blockingReasons,
    primaryReason: canDelete
      ? 'Bản này đạt kiểm tra hiện tại. Khi xác nhận, server vẫn kiểm tra lại trước khi xóa đúng bản này.'
      : blockingReasons[0] || 'Bản chưa đủ điều kiện xóa.',
  };
}

function renderCleanupFact(label, value) {
  const item = createElement('div', { className: 'cms-admin-cleanup-fact' });
  item.appendChild(createElement('span', { text: label }));
  item.appendChild(createElement('strong', { text: String(value ?? '—') }));
  return item;
}

function renderCleanupItemDetails(item = {}, label = 'Chi tiết kỹ thuật') {
  const details = createElement('details', { className: 'cms-admin-cleanup-technical-details' });
  details.appendChild(createElement('summary', { text: label }));
  const dl = createElement('dl', { className: 'cms-admin-cleanup-technical-list' });
  [
    ['Bucket', item.bucket],
    ['Path', item.path],
    ['Loại kỹ thuật', item.objectKind],
    ['Kết luận kỹ thuật', item.classification],
    ['Có thể xóa theo kế hoạch', item.eligible ? 'true' : 'false'],
    ['Số nơi đang dùng', getCleanupReferenceCount(item)],
    ['Lý do chặn kỹ thuật', item.blockedReason],
    ['Dung lượng byte', item.sizeBytes],
  ].forEach(([key, value]) => {
    const row = createElement('div');
    row.appendChild(createElement('dt', { text: key }));
    row.appendChild(createElement('dd', { text: String(value ?? '—') }));
    dl.appendChild(row);
  });
  details.appendChild(dl);
  return details;
}

function cleanupItemKey(item = {}) {
  return `${item.bucket || ''}/${item.path || ''}/${item.objectKind || ''}/${item.classification || ''}`;
}

function getCleanupSelectedItemKey(item = {}) {
  return [item.bucket, item.path, item.objectKind, item.classification].map((value) => String(value || '').trim()).join('::');
}

function getCleanupCandidateTitle(item = {}) {
  const path = String(item.path || '').trim();
  if (!path) return 'Bản chưa có đường dẫn';
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

function getCleanupClassificationLabel(classification) {
  const labels = ADMIN_COPY.cleanup?.filters || {};
  return labels[classification] || classification || 'Không rõ';
}

function getCleanupObjectKindLabel(objectKind) {
  const labels = {
    media_object: 'Tệp ảnh/video',
    version: 'Phiên bản',
    backup: 'Bản sao lưu',
    rollback_backup: 'Bản sao khôi phục',
    media_metadata: 'Dòng thông tin quản lý',
  };
  return labels[objectKind] || objectKind || 'Không rõ';
}

function getCleanupCandidateReason(item = {}) {
  if (isPublicVersionSafeDeleteCandidate(item)) return 'Bản này nằm ngoài vùng giữ lại và có thể xóa có kiểm soát.';
  if (!isPublicVersionCleanupItem(item)) return 'Ảnh/video hoặc dữ liệu ngoài kho nội dung website không phải trọng tâm của màn này.';
  if (getCleanupReferenceCount(item) > 0) return 'Bản này còn được lịch sử hoặc khôi phục tham chiếu nên đang được bảo vệ.';
  if (item.blockedReason) return translateCleanupReason(item.blockedReason);
  if (item.eligible) return 'Bản có thể dọn theo kết quả kiểm tra nhưng chưa thuộc nhóm xóa trong màn này.';
  return 'Bản đang được bảo vệ trong lần kiểm tra hiện tại.';
}

function translateCleanupReason(reason = '') {
  const text = String(reason || '').trim();
  if (!text) return '';
  if (/referenced by latest/i.test(text)) return 'Đây là bản website đang dùng.';
  if (/referenced by active CMS draft/i.test(text)) return 'Bản này đang được bản nháp CMS tham chiếu.';
  if (/referenced by public version/i.test(text)) return 'Bản này còn nằm trong phiên bản hoặc bản sao public.';
  if (/Storage object has references/i.test(text)) return 'Bản vẫn có nơi đang dùng active.';
  if (/newer than retention/i.test(text)) return 'Bản còn mới hơn số ngày giữ lại nên đang được bảo vệ.';
  if (/Latest CMS JSON/i.test(text)) return 'Đây là nội dung public mới nhất, không được xóa.';
  if (/keepLastVersions/i.test(text)) return 'Bản nằm trong 10 bản gần nhất cần giữ lại.';
  return text;
}

function getCleanupReferenceCount(item = {}) {
  const count = Number(item.referenceCount);
  if (Number.isFinite(count)) return count;
  return safeArray(item.references).length;
}

function formatCleanupReference(ref = {}) {
  if (typeof ref === 'string') return translateCleanupReferenceSource(ref);
  const source = translateCleanupReferenceSource(ref.source);
  const parts = [source, ref.owner, ref.fieldPath || ref.field, ref.path].filter(Boolean);
  return parts.join(' / ') || JSON.stringify(ref);
}

function translateCleanupReferenceSource(source = '') {
  const labels = {
    latest: 'Website đang chạy',
    'publish-log': 'Lịch sử vận hành',
    version: 'Phiên bản/bản sao',
    'draft-active': 'Bản nháp đang hoạt động',
    'draft-discarded': 'Bản nháp đã bỏ',
  };
  const key = String(source || '');
  return labels[key] || key;
}

function renderCleanupSummary(result = {}) {
  const summary = result.summary || {};
  const cards = createElement('div', { className: 'cms-admin-cleanup-summary-grid' });
  const rows = [
    ['Mã lần quét', result.runId || '—'],
    ['Thao tác', result.action === 'dryRun' ? 'Kiểm tra bản cũ có thể dọn' : result.action === 'scan' ? 'Quét danh sách' : (result.action || '—')],
    ['Mã kiểm tra', result.planHash || '—'],
    ['Ảnh/video phụ', formatCount(summary.cmsMediaObjects)],
    ['Phiên bản/backup trong kho nội dung', formatCount(summary.cmsPublicVersionObjects)],
    ['Dòng thông tin quản lý', formatCount(summary.metadataRows)],
    ['Bản nháp', formatCount(summary.draftRows)],
    ['Lịch sử vận hành', formatCount(summary.publishLogRows)],
    ['Bản có thể xóa', formatCount(summary.eligibleCount)],
    ['Bản được bảo vệ', formatCount(summary.blockedCount)],
    ['Dung lượng có thể giảm', formatCount(summary.estimatedBytesRecoverable)],
    ['Không an toàn để xóa', formatCount(summary.unsafeToDelete)],
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
  safeArray(warnings).forEach((warning) => list.appendChild(createElement('li', { text: translateCleanupWarning(warning) })));
  box.appendChild(list);
  return box;
}

function translateCleanupWarning(warning = '') {
  const text = String(warning || '').trim();
  if (!text) return '';
  if (/No objects were deleted/i.test(text)) return 'Quét/kiểm tra không xóa file. Xóa thật cần bước xác nhận riêng.';
  if (/Cleanup dependency graph is incomplete/i.test(text)) return 'Danh sách kiểm tra chưa đầy đủ; các bản nghi ngờ được bảo vệ.';
  return translateCleanupReason(text);
}


function renderSafeDeleteResult(result = {}) {
  const ok = result.ok !== false && !(result.failedCount > 0);
  const box = createElement('div', { className: `cms-admin-alert ${ok ? 'cms-admin-alert-success' : 'cms-admin-alert-warning'} cms-admin-safe-delete-result` });
  box.appendChild(createElement('strong', { text: ok ? 'Đã xóa bản đã chọn' : 'Kết quả xóa bản cần kiểm tra' }));
  box.appendChild(createElement('p', { text: result.message || `Đã xóa: ${formatCount(result.deletedCount || 0)} · Lỗi: ${formatCount(result.failedCount || 0)} · Bỏ qua: ${formatCount(result.skippedCount || 0)}` }));
  if (safeArray(result.results).length) {
    const list = createElement('ul');
    safeArray(result.results).slice(0, 5).forEach((row) => list.appendChild(createElement('li', { text: `${row.path || 'Bản'} — ${translateCleanupDeleteStatus(row.deleteStatus || row.status)}${row.message ? `: ${translateCleanupReason(row.message)}` : ''}` })));
    box.appendChild(list);
  }
  return box;
}

function translateCleanupDeleteStatus(status = '') {
  const labels = {
    deleted: 'đã xóa',
    delete_failed: 'xóa thất bại',
    delete_skipped: 'đã bỏ qua',
    delete_pending: 'đang xử lý',
    delete_aborted: 'đã hủy',
  };
  return labels[status] || status || 'không rõ';
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

function isPublicVersionCleanupItem(item = {}) {
  return item.bucket === 'cms-public'
    && ['version', 'backup', 'rollback_backup'].includes(item.objectKind);
}

function isPublicVersionSafeDeleteCandidate(item = {}) {
  return isPublicVersionCleanupItem(item)
    && ['version_only_old', 'backup_old', 'rollback_backup_old'].includes(item.classification)
    && item.eligible === true
    && !hasActiveCleanupReference(item);
}

function hasActiveCleanupReference(item = {}) {
  return safeArray(item.references).some((ref) => {
    const source = typeof ref === 'string' ? ref : ref.source;
    return !['publish-log', 'rollback-log', 'history-log'].includes(String(source || ''));
  });
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

function openCleanupDeleteConfirmModal({ item, onConfirm }) {
  if (!item) return;
  const overlay = createElement('div', { className: 'cms-admin-cleanup-confirm-overlay', attrs: { role: 'presentation' } });
  const dialog = createElement('section', {
    className: 'cms-admin-cleanup-confirm-dialog',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Xác nhận xóa bản đã chọn' },
  });
  dialog.appendChild(createElement('h3', { text: 'Xóa bản đã chọn?' }));
  dialog.appendChild(createElement('p', { text: 'Thao tác này xóa file khỏi kho nội dung website và không thể hoàn tác từ CMS.' }));
  const facts = createElement('div', { className: 'cms-admin-cleanup-confirm-facts' });
  [
    ['Tên bản', getCleanupCandidateTitle(item)],
    ['Đường dẫn', item.path || '—'],
    ['Dung lượng', `${formatCount(item.sizeBytes || 0)} bytes`],
  ].forEach(([label, value]) => facts.appendChild(renderCleanupFact(label, value)));
  dialog.appendChild(facts);
  const actions = createElement('div', { className: 'cms-admin-cleanup-confirm-actions' });
  const cancelButton = createElement('button', { className: 'cms-admin-button cms-admin-button-secondary', type: 'button', text: 'Hủy' });
  const confirmButton = createElement('button', { className: 'cms-admin-button cms-admin-button-danger', type: 'button', text: 'Xóa bản này' });
  const close = () => {
    globalThis.document?.removeEventListener?.('keydown', onKeyDown);
    overlay.remove();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') close();
  };
  cancelButton.addEventListener('click', close);
  confirmButton.addEventListener('click', () => {
    close();
    onConfirm?.();
  });
  actions.append(cancelButton, confirmButton);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  globalThis.document?.body?.appendChild(overlay);
  globalThis.document?.addEventListener?.('keydown', onKeyDown);
  confirmButton.focus?.();
}

async function handleSafeDeleteSelectedAction(result = {}, selectedItem, options = {}) {
  if (!selectedItem) {
    setCmsStorageCleanupState({ error: 'Chưa chọn bản cần xóa.' });
    options.onRerender?.();
    return;
  }

  const current = getState();
  const cleanup = current.storageCleanup || {};
  setCmsStorageCleanupState({ loading: true, action: 'safeDeleteSelectedPublicVersion', error: null });
  options.onRerender?.();

  const { data, error } = await safeDeleteSelectedPublicVersionCleanup(current.supabase, {
    runId: result.runId,
    planHash: result.planHash,
    selectedItemKey: getCleanupSelectedItemKey(selectedItem),
    scope: 'versions',
    retentionDays: result.retentionDays || getCleanupRetentionDays(cleanup),
    keepLastVersions: result.keepLastVersions || cleanup.keepLastVersions || CMS_STORAGE_CLEANUP_CONFIG.defaultKeepLastVersions || 10,
  });

  if (error) {
    setCmsStorageCleanupState({ loading: false, action: '', error: normalizeCleanupOperatorError(error), safeDeleteResult: data || null });
    options.onRerender?.();
    return;
  }

  setCmsStorageCleanupState({
    loading: false,
    action: '',
    error: null,
    safeDeleteResult: data,
    selectedCleanupCandidateKey: '',
    loadedAt: new Date().toISOString(),
  });
  options.onRerender?.();
}

function normalizeCleanupOperatorError(error) {
  const message = normalizeErrorMessage(error);
  if (/REFERENCE|referenc|đang được dùng|vẫn đang được dùng/i.test(message)) return 'Không thể xóa vì bản này còn được dùng hoặc được lịch sử tham chiếu.';
  if (/PLAN_EXPIRED|TTL|quá TTL|hết hạn/i.test(message)) return 'Không thể xóa vì kết quả kiểm tra đã cũ. Hãy quét lại.';
  if (/PLAN_HASH|planHash|mã kiểm tra/i.test(message)) return 'Không thể xóa vì thiếu hoặc sai mã kiểm tra. Hãy quét & kiểm tra lại.';
  if (/GRAPH|graph|dependency|liên kết/i.test(message)) return 'Không thể xóa vì danh sách kiểm tra chưa đầy đủ.';
  if (/classification|object|bucket|allow/i.test(message)) return 'Không thể xóa loại bản này trong màn này.';
  return message || 'Xóa thất bại. Không có bản nào khác bị ảnh hưởng.';
}

async function handleCleanupAction(action, options = {}) {
  const current = getState();
  const cleanup = current.storageCleanup || {};
  setCmsStorageCleanupState({ loading: true, action, error: null });
  options.onRerender?.();

  const payload = {
    scope: 'versions',
    retentionDays: getCleanupRetentionDays(cleanup),
    keepLastVersions: cleanup.keepLastVersions || CMS_STORAGE_CLEANUP_CONFIG.defaultKeepLastVersions || 10,
    includeVersions: true,
    includeDrafts: false,
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
