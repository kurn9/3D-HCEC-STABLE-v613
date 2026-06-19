import { ADMIN_COPY } from './adminCopy.js';
import { ADMIN_FEATURE_FLAGS, ADMIN_ROLES, CMS_STORAGE_CLEANUP_CONFIG } from './adminConfig.js';
import { dryRunCmsStorageCleanup, safeDeleteCmsStorageCleanup, scanCmsStorageCleanup } from './adminApi.js';
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
  badges.appendChild(renderBadge(copy.status || 'Dọn thật đang mở theo guard', 'warning'));
  badges.appendChild(renderBadge('Retention mặc định 1 ngày', 'info'));
  badges.appendChild(renderBadge('Raw delete/purge đang tắt', 'success'));
  badges.appendChild(renderBadge('Không dọn nội dung website đang dùng', 'success'));
  appendChildren(header, [left, badges]);
  return header;
}

function renderCleanupNotice(copy = {}) {
  const wrap = createElement('div', { className: 'cms-admin-alert cms-admin-alert-info' });
  wrap.appendChild(createElement('strong', { text: 'An toàn dữ liệu' }));
  wrap.appendChild(createElement('p', { text: copy.deleteDisabled || 'Dọn dẹp tự do đang bị tắt ở cả giao diện và server.' }));
  wrap.appendChild(createElement('p', { text: 'Retention cleanup hiện tại: 1 ngày. Scan/dry-run có thể ghi log kiểm tra nhưng không xóa object.' }));
  wrap.appendChild(createElement('p', { text: 'Màn này không tự xóa tệp khi chỉ mở, chọn candidate, quét hoặc kiểm tra.' }));
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
    value: getCleanupRetentionDays(cleanup),
    attrs: { min: String(CMS_STORAGE_CLEANUP_CONFIG.minRetentionDays || 1), step: '1' },
  });
  retentionInput.addEventListener('change', () => setCmsStorageCleanupState({ retentionDays: normalizeControlNumber(retentionInput.value, 1, CMS_STORAGE_CLEANUP_CONFIG.minRetentionDays || 1, 3650) }));

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
  empty.appendChild(createElement('p', { className: 'cms-admin-help-text', text: copy.noResult || 'Chưa có kết quả. Hãy chạy Quét tệp hoặc Kiểm tra tệp có thể dọn.' }));
  const steps = createElement('div', { className: 'cms-admin-cleanup-empty-steps' });
  [
    ['1', 'Quét tệp', 'Chỉ đọc Storage/CMS để biết bề mặt hiện tại.'],
    ['2', 'Kiểm tra tệp có thể dọn', 'Dry-run tạo runId/planHash; chưa xóa object.'],
    ['3', 'Chọn candidate', 'Xem path, classification, usage/reference trước khi thao tác.'],
    ['4', 'Checklist an toàn', 'Dọn thật chỉ mở khi feature/plan/confirm đủ điều kiện.'],
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
  const safeDeleteCandidates = items.filter(isA2SafeDeleteCandidate);
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
  const rail = createElement('aside', { className: 'cms-admin-cleanup-right-rail', attrs: { 'aria-label': 'Checklist và thao tác dọn tệp an toàn' } });
  rail.appendChild(renderCleanupChecklistAndActions(state, result, selectedItem, safeDeleteCandidates, options));
  rail.appendChild(renderCleanupActivityPanel(result, items, safeDeleteCandidates));
  return rail;
}

function getCleanupDisplayItems(result = {}) {
  const items = safeArray(result.eligibleItems).concat(safeArray(result.blockedItems), safeArray(result.items));
  return dedupeItems(items).sort((a, b) => {
    const aSafe = isA2SafeDeleteCandidate(a) ? 0 : 1;
    const bSafe = isA2SafeDeleteCandidate(b) ? 0 : 1;
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
  titleWrap.appendChild(createElement('h4', { className: 'cms-admin-subsection-title', text: 'Danh sách candidate' }));
  titleWrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Chọn một tệp để xem chi tiết, reference và checklist. Chọn candidate không gọi API và không xóa tệp.' }));
  header.appendChild(titleWrap);
  header.appendChild(renderBadge(`${formatCount(items.length)} mục`, 'info'));
  section.appendChild(header);

  if (!items.length) {
    section.appendChild(renderEmptyState('Không có candidate trong kết quả hiện tại. Nếu chỉ mới quét, hãy chạy “Kiểm tra tệp có thể dọn” để có plan dry-run.'));
    return section;
  }

  const list = createElement('div', { className: 'cms-admin-cleanup-candidate-list' });
  items.slice(0, 250).forEach((item) => list.appendChild(renderCleanupCandidateCard(item, selectedItem, options)));
  if (items.length > 250) {
    list.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Danh sách đang giới hạn 250 candidate đầu tiên để tránh quá tải giao diện. Hãy lọc/chạy lại nếu cần xem thêm.' }));
  }
  section.appendChild(list);
  return section;
}

function renderCleanupCandidateCard(item = {}, selectedItem, options = {}) {
  const key = cleanupItemKey(item);
  const selected = selectedItem && cleanupItemKey(selectedItem) === key;
  const card = createElement('article', {
    className: `cms-admin-cleanup-candidate-card${selected ? ' is-selected' : ''}${item.eligible ? ' is-eligible' : ' is-blocked'}`,
  });
  const top = createElement('div', { className: 'cms-admin-cleanup-candidate-top' });
  const title = createElement('div', { className: 'cms-admin-cleanup-candidate-title' });
  title.appendChild(createElement('strong', { text: getCleanupCandidateTitle(item) }));
  title.appendChild(createElement('span', { text: item.bucket || 'Không rõ bucket' }));
  top.appendChild(title);
  top.appendChild(renderCleanupCandidateStatusBadge(item));
  card.appendChild(top);

  const meta = createElement('div', { className: 'cms-admin-cleanup-candidate-meta' });
  meta.appendChild(createElement('span', { text: `Kết luận: ${getCleanupClassificationLabel(item.classification)}` }));
  meta.appendChild(createElement('span', { text: `Reference: ${formatCount(getCleanupReferenceCount(item))}` }));
  meta.appendChild(createElement('span', { text: `Dung lượng: ${formatCount(item.sizeBytes || 0)} bytes` }));
  if (item.objectKind) meta.appendChild(createElement('span', { text: `Loại: ${item.objectKind}` }));
  card.appendChild(meta);

  const reason = item.blockedReason || getCleanupCandidateReason(item);
  if (reason) card.appendChild(createElement('p', { className: 'cms-admin-cleanup-candidate-reason', text: reason }));

  const actions = createElement('div', { className: 'cms-admin-cleanup-candidate-actions' });
  const selectButton = createElement('button', {
    className: `cms-admin-button ${selected ? 'cms-admin-button-muted' : 'cms-admin-button-secondary'}`,
    type: 'button',
    text: selected ? 'Đang xem candidate' : 'Chọn candidate',
    attrs: { 'aria-pressed': selected ? 'true' : 'false' },
  });
  selectButton.addEventListener('click', () => {
    setCmsStorageCleanupState({ selectedCleanupCandidateKey: key });
    options.onRerender?.();
  });
  actions.appendChild(selectButton);
  actions.appendChild(renderCleanupItemDetails(item, 'Đường dẫn và metadata'));
  card.appendChild(actions);
  return card;
}

function renderCleanupCandidateStatusBadge(item = {}) {
  if (isA2SafeDeleteCandidate(item)) return renderBadge('Có thể dọn theo guard', 'success');
  if (item.eligible) return renderBadge('Eligible nhưng chưa thuộc safe-delete', 'warning');
  return renderBadge('Đang bị chặn', 'danger');
}

function renderCleanupCandidateDetail(item, result = {}) {
  const section = createElement('section', { className: 'cms-admin-cleanup-detail-panel' });
  const header = createElement('div', { className: 'cms-admin-cleanup-panel-header' });
  const titleWrap = createElement('div');
  titleWrap.appendChild(createElement('h4', { className: 'cms-admin-subsection-title', text: 'Chi tiết candidate / usage' }));
  titleWrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Preview chỉ đọc để đối chiếu path, usage và lý do chặn trước khi thao tác.' }));
  header.appendChild(titleWrap);
  header.appendChild(renderBadge('Chỉ xem', 'info'));
  section.appendChild(header);

  if (!item) {
    section.appendChild(renderEmptyState('Chọn một candidate trong danh sách để xem bucket/path, usage references và metadata kỹ thuật.'));
    return section;
  }

  const identity = createElement('div', { className: 'cms-admin-cleanup-selected-identity' });
  identity.appendChild(createElement('strong', { text: getCleanupCandidateTitle(item) }));
  identity.appendChild(createElement('p', { text: item.path || 'Không có path trong dữ liệu trả về.' }));
  identity.appendChild(renderCleanupCandidateStatusBadge(item));
  section.appendChild(identity);

  const facts = createElement('div', { className: 'cms-admin-cleanup-fact-grid' });
  [
    ['Bucket', item.bucket || '—'],
    ['Loại object', item.objectKind || '—'],
    ['Phân loại', getCleanupClassificationLabel(item.classification)],
    ['Eligible', item.eligible ? 'Có' : 'Không'],
    ['Reference count', formatCount(getCleanupReferenceCount(item))],
    ['Dung lượng', `${formatCount(item.sizeBytes || 0)} bytes`],
    ['Run hiện tại', result.runId || '—'],
    ['Plan hash', result.planHash ? 'Đã có' : '—'],
  ].forEach(([label, value]) => facts.appendChild(renderCleanupFact(label, value)));
  section.appendChild(facts);

  const refs = safeArray(item.references);
  const usage = createElement('div', { className: 'cms-admin-cleanup-usage-box' });
  usage.appendChild(createElement('h5', { text: 'Usage / references' }));
  if (!refs.length) {
    usage.appendChild(createElement('p', { text: getCleanupReferenceCount(item) > 0 ? 'Có reference count nhưng response không chứa danh sách reference chi tiết.' : 'Chưa thấy reference active trong dữ liệu đã kiểm tra.' }));
  } else {
    const list = createElement('ul');
    refs.slice(0, 12).forEach((ref) => list.appendChild(createElement('li', { text: formatCleanupReference(ref) })));
    if (refs.length > 12) list.appendChild(createElement('li', { text: `Còn ${formatCount(refs.length - 12)} reference khác trong response.` }));
    usage.appendChild(list);
  }
  section.appendChild(usage);
  section.appendChild(renderCleanupItemDetails(item, 'Metadata kỹ thuật của candidate'));
  return section;
}

function renderCleanupChecklistAndActions(state, result = {}, selectedItem, safeDeleteCandidates = [], options = {}) {
  const cleanup = state.storageCleanup || {};
  const copy = ADMIN_COPY.cleanup || {};
  const section = createElement('section', { className: 'cms-admin-cleanup-action-panel' });
  const header = createElement('div', { className: 'cms-admin-cleanup-panel-header' });
  const titleWrap = createElement('div');
  titleWrap.appendChild(createElement('h4', { className: 'cms-admin-subsection-title', text: 'Checklist an toàn & thao tác' }));
  titleWrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Dọn thật đang mở nhưng chỉ chạy khi checklist đạt, có dry-run plan và confirm phrase đúng.' }));
  header.appendChild(titleWrap);
  header.appendChild(renderBadge(ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupSafeDelete ? 'Safe-delete đang mở theo guard' : 'Safe-delete đang khóa', ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupSafeDelete ? 'success' : 'danger'));
  section.appendChild(header);
  section.appendChild(renderCleanupRetentionStatus(state, result));

  const responseLooksLimited = hasLimitedCleanupItems(result);
  const summary = result.summary || {};
  const selectedRefCount = selectedItem ? getCleanupReferenceCount(selectedItem) : 0;
  const selectedSafe = Boolean(selectedItem && isA2SafeDeleteCandidate(selectedItem));
  const expectedPhrase = `DELETE ${String(result.runId || '').slice(0, 8)}`;
  const phraseMatches = String(cleanup.safeDeleteConfirmPhrase || '').trim() === expectedPhrase;
  const checklist = [
    ['Tài khoản admin đang hoạt động', canUseCleanupScan(state), 'Chỉ admin active mới được dùng cleanup gate.'],
    ['Cleanup scan feature enabled', Boolean(ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupScan), 'Scan/dry-run phải được bật trong cấu hình frontend.'],
    ['Safe delete feature enabled', Boolean(ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupSafeDelete), 'Guarded safe-delete đang mở nhưng vẫn cần dry-run/runId/planHash/candidate/confirm.'],
    ['Đã chạy dry-run', result.action === 'dryRun', 'Scan chỉ đọc tổng quan; dry-run mới tạo plan cleanup.'],
    ['Có runId', Boolean(result.runId), 'Server phải trả runId để đối chiếu plan.'],
    ['Có planHash', Boolean(result.planHash), 'Server phải trả planHash để revalidate trước khi dọn.'],
    ['Dependency graph complete', !(result.graphIncomplete || summary.graphIncomplete), 'Không được dọn nếu graph/reference chưa đầy đủ.'],
    ['Response không bị giới hạn', !responseLooksLimited, 'Không dọn nếu candidate list bị truncate/limit.'],
    ['Đã chọn candidate', Boolean(selectedItem), 'Operator phải chọn một candidate để xem chi tiết trước.'],
    ['Candidate có bucket/path', Boolean(selectedItem?.bucket && selectedItem?.path), 'Candidate phải có định danh Storage rõ ràng.'],
    ['Candidate là unreferenced an toàn', Boolean(selectedItem && selectedItem.classification === 'unreferenced'), 'Chỉ trạng thái chưa thấy tham chiếu mới có thể xét safe-delete.'],
    ['Candidate eligible = true', Boolean(selectedItem?.eligible), 'Candidate bị blocked không được dọn.'],
    ['Reference count = 0', selectedItem ? selectedRefCount === 0 : false, 'Không dọn nếu còn reference active.'],
    ['Candidate thuộc allowlist safe-delete hiện có', selectedSafe, 'Guard hiện tại chỉ cho cms-media / media_object / unreferenced.'],
    ['Confirm phrase đúng', !ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupSafeDelete || phraseMatches, 'Khi safe-delete bật, phải nhập đúng cụm xác nhận.'],
  ];

  const list = createElement('div', { className: 'cms-admin-cleanup-checklist' });
  checklist.forEach(([label, pass, detail]) => list.appendChild(renderCleanupChecklistItem(label, pass, detail)));
  section.appendChild(list);

  const blockingReasons = deriveCleanupBlockingReasons(result, selectedItem, responseLooksLimited, selectedSafe);
  if (blockingReasons.length) {
    const block = createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning cms-admin-cleanup-block-reasons' });
    block.appendChild(createElement('strong', { text: 'Chưa thể dọn thật vì' }));
    const ul = createElement('ul');
    blockingReasons.forEach((reason) => ul.appendChild(createElement('li', { text: reason })));
    block.appendChild(ul);
    section.appendChild(block);
  }

  section.appendChild(renderCleanupPlanAction(state, result, selectedItem, safeDeleteCandidates, responseLooksLimited, options, expectedPhrase, phraseMatches, copy));
  return section;
}


function renderCleanupRetentionStatus(state = getState(), result = {}) {
  const cleanup = state.storageCleanup || {};
  const retentionDays = result.retentionDays || getCleanupRetentionDays(cleanup);
  const box = createElement('div', { className: 'cms-admin-cleanup-retention-status' });
  box.appendChild(createElement('span', { text: 'Retention hiện tại' }));
  box.appendChild(createElement('strong', { text: `${formatCount(retentionDays)} ngày` }));
  box.appendChild(createElement('p', { text: 'Scan/dry-run có thể ghi log kiểm tra nhưng không xóa object. Dọn thật chỉ theo dry-run plan đã được server revalidate.' }));
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

function renderCleanupPlanAction(state, result = {}, selectedItem, safeDeleteCandidates = [], responseLooksLimited, options = {}, expectedPhrase, phraseMatches, copy = {}) {
  const cleanup = state.storageCleanup || {};
  const actionBox = createElement('section', { className: 'cms-admin-cleanup-plan-action' });
  actionBox.appendChild(createElement('h5', { text: 'Thao tác dọn dẹp có kiểm soát' }));
  actionBox.appendChild(createElement('p', { text: 'Safe-delete xử lý dry-run plan trên server, không xóa theo path do trình duyệt tự gửi. Server revalidate runId, planHash, reference graph và confirm phrase trước khi xóa.' }));

  if (!ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupSafeDelete) {
    actionBox.appendChild(renderBadge('Dọn thật đang khóa bởi feature flag', 'danger'));
    actionBox.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Bạn có thể scan, dry-run và xem candidate. Không có nút xóa thật khi safe-delete chưa được bật.' }));
    return actionBox;
  }

  if (result.action !== 'dryRun' || !result.runId || !result.planHash) {
    actionBox.appendChild(renderBadge('Cần dry-run hợp lệ trước', 'warning'));
    return actionBox;
  }

  const graphReady = !(result.graphIncomplete || (result.summary || {}).graphIncomplete);
  const canAttempt = Boolean(result.action === 'dryRun' && result.runId && result.planHash && selectedItem && isA2SafeDeleteCandidate(selectedItem) && getCleanupReferenceCount(selectedItem) === 0 && graphReady && !responseLooksLimited && safeDeleteCandidates.length && phraseMatches);
  const confirmInput = createElement('input', {
    className: 'cms-admin-input cms-admin-safe-delete-confirm',
    type: 'text',
    value: cleanup.safeDeleteConfirmPhrase || '',
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
  deleteButton.disabled = cleanup.loading || !canAttempt;
  deleteButton.addEventListener('click', () => handleSafeDeleteAction(result, options));

  const controls = createElement('div', { className: 'cms-admin-safe-delete-controls' });
  controls.appendChild(createElement('p', { text: `${copy.safeDeleteConfirmHelp || 'Nhập đúng cụm xác nhận để bật nút dọn dẹp theo guard.'} Cụm xác nhận: ${expectedPhrase}` }));
  controls.appendChild(confirmInput);
  controls.appendChild(deleteButton);
  actionBox.appendChild(controls);
  return actionBox;
}

function renderCleanupActivityPanel(result = {}, items = [], safeDeleteCandidates = []) {
  const section = createElement('section', { className: 'cms-admin-cleanup-activity-panel' });
  const header = createElement('div', { className: 'cms-admin-cleanup-panel-header' });
  const titleWrap = createElement('div');
  titleWrap.appendChild(createElement('h4', { className: 'cms-admin-subsection-title', text: 'Activity / audit nhẹ' }));
  titleWrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Thông tin kỹ thuật dùng để đối chiếu run cleanup, không thay thế guard server-side.' }));
  header.appendChild(titleWrap);
  header.appendChild(renderBadge('Read-only metadata', 'info'));
  section.appendChild(header);

  const summary = result.summary || {};
  const facts = createElement('div', { className: 'cms-admin-cleanup-fact-grid' });
  [
    ['Action', result.action === 'dryRun' ? 'Dry-run cleanup' : result.action === 'scan' ? 'Scan cleanup' : (result.action || '—')],
    ['Run ID', result.runId || '—'],
    ['Plan hash', result.planHash ? 'Đã có' : '—'],
    ['Loaded at', formatDateTime(result.generatedAt || result.createdAt || result.timestamp || result.loadedAt)],
    ['Tổng items', formatCount(items.length)],
    ['Safe-delete candidates', formatCount(safeDeleteCandidates.length)],
    ['Graph incomplete', result.graphIncomplete || summary.graphIncomplete ? 'Có' : 'Không'],
    ['Response limited/truncated', hasLimitedCleanupItems(result) ? 'Có' : 'Không'],
  ].forEach(([label, value]) => facts.appendChild(renderCleanupFact(label, value)));
  section.appendChild(facts);

  const details = createElement('details', { className: 'cms-admin-cleanup-technical-details' });
  details.appendChild(createElement('summary', { text: 'Run metadata kỹ thuật' }));
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
  const summary = result.summary || {};
  const reasons = [];
  if (!ADMIN_FEATURE_FLAGS.allowCmsStorageCleanupSafeDelete) reasons.push('Safe-delete đang bị khóa bởi feature flag hiện tại.');
  if (result.action !== 'dryRun') reasons.push('Chưa có dry-run plan; scan chỉ là bước đọc tổng quan.');
  if (!result.runId) reasons.push('Thiếu runId từ server.');
  if (!result.planHash) reasons.push('Thiếu planHash từ server.');
  if (result.graphIncomplete || summary.graphIncomplete) reasons.push('Dependency/reference graph chưa đầy đủ.');
  if (responseLooksLimited) reasons.push('Response có dấu hiệu bị giới hạn/truncated.');
  if (!selectedItem) reasons.push('Chưa chọn candidate để xem chi tiết.');
  if (selectedItem && !selectedItem.eligible) reasons.push('Candidate đang bị blocked hoặc chưa eligible.');
  if (selectedItem && getCleanupReferenceCount(selectedItem) > 0) reasons.push('Candidate còn reference active.');
  if (selectedItem && !selectedSafe) reasons.push('Candidate chưa khớp allowlist safe-delete hiện có.');
  return reasons;
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
    ['Object kind', item.objectKind],
    ['Classification', item.classification],
    ['Eligible', item.eligible ? 'true' : 'false'],
    ['Reference count', getCleanupReferenceCount(item)],
    ['Blocked reason', item.blockedReason],
    ['Size bytes', item.sizeBytes],
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

function getCleanupCandidateTitle(item = {}) {
  const path = String(item.path || '').trim();
  if (!path) return 'Candidate chưa có path';
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

function getCleanupClassificationLabel(classification) {
  const labels = ADMIN_COPY.cleanup?.filters || {};
  return labels[classification] || classification || 'Không rõ';
}

function getCleanupCandidateReason(item = {}) {
  if (isA2SafeDeleteCandidate(item)) return 'Candidate khớp allowlist safe-delete hiện có nhưng dọn thật vẫn phụ thuộc feature flag, confirm phrase và revalidation server-side.';
  if (item.eligible) return 'Candidate eligible trong response nhưng chưa thuộc nhóm safe-delete frontend hiện tại.';
  return 'Candidate không được dọn trong plan hiện tại.';
}

function getCleanupReferenceCount(item = {}) {
  const count = Number(item.referenceCount);
  if (Number.isFinite(count)) return count;
  return safeArray(item.references).length;
}

function formatCleanupReference(ref = {}) {
  if (typeof ref === 'string') return ref;
  const parts = [ref.source, ref.owner, ref.fieldPath || ref.field, ref.path].filter(Boolean);
  return parts.join(' / ') || JSON.stringify(ref);
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
    ['Số ngày giữ lại', formatCount(result.retentionDays || getCleanupRetentionDays(cleanup))],
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
    retentionDays: result.retentionDays || getCleanupRetentionDays(cleanup),
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
    retentionDays: getCleanupRetentionDays(cleanup),
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
