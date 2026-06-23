import { ADMIN_COPY } from './adminCopy.js';
import { createCmsDraft, discardCmsDraft, fetchDashboardData, getCmsDraft, listCmsDrafts, publishCmsJson, reconcileCmsReleasePointer, updateCmsDraft, uploadCmsMedia } from './adminApi.js';
import { ADMIN_FEATURE_FLAGS, CMS_MEDIA_UPLOAD_CONFIG, CMS_PUBLISH_GATE_CONFIG, STATIC_CMS_DRAFT_CONFIG } from './adminConfig.js';
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
  setReleaseOperationGateState,
  applySavedStaticCmsDraft,
  setNestedData,
  setStaticCmsDraftBaseline,
  setStaticCmsDraftPersistenceState,
  setStaticCmsDraftState,
  setStaticCmsDraftDrawer,
  setStaticCmsDraftEditorTab,
  setStaticCmsDraftWorkspace,
  setStaticCmsFeaturedIndex,
  setStaticCmsMediaUploadState,
  setStaticCmsPublishState,
  setStaticCmsSavedDrafts,
  updateStaticCmsDraftItem,
  updateStaticCmsDraftJson,
  updateStaticCmsDraftMeta,
  updateStaticCmsDraftRoom,
  resetStaticCmsDraftToBaseline,
  clearStaticCmsDraftSession,
} from './adminState.js';
import { validateStaticCmsDraft, validateStaticCmsMediaUrl } from './adminValidation.js';
import { renderStaticCmsMediaPreview } from './adminMediaPreview.js';
import {
  INDEX_FEATURED_MEDIA_UPLOAD_TARGET,
  STATIC_CMS_MEDIA_UPLOAD_TARGETS,
  formatUploadSizeLimit,
  getMediaUploadStatusKey,
  getUploadAccept,
  getUploadedUrl,
  validateClientMediaFile,
  validateFeaturedImageFile,
} from './adminMediaUpload.js';

import { isResolvedCapableReleaseResponse, refreshAndApplyReleaseOperationGateStatus } from './adminReleaseOperationGate.js';
const ROOM_KEYS = ['indoor', 'outdoor'];
const TEXT_FIELDS = ['title', 'description', 'content', 'author', 'artist', 'year', 'material', 'realSize', 'real_size', 'note'];
const MEDIA_FIELDS = [
  'image', 'imageUrl', 'image_url', 'src', 'url',
  'thumbnail', 'thumbnailUrl', 'thumbnail_url',
  'videoUrl', 'video_url',
  'poster', 'posterUrl', 'poster_url',
];
const DISPLAY_FIELD_GROUPS = [
  {
    key: 'display',
    title: 'Thông tin hiển thị',
    description: 'Nội dung người xem nhìn thấy trong danh sách và popup tác phẩm.',
    fields: ['title', 'description', 'content'],
  },
  {
    key: 'metadata',
    title: 'Thông tin thêm',
    description: 'Thông tin bổ sung. Có thể để trống nếu chưa có dữ liệu chính thức.',
    fields: ['author', 'artist', 'year', 'material', 'realSize', 'note'],
  },
  {
    key: 'media',
    title: 'Ảnh & video',
    description: 'Có thể nhập đường dẫn hoặc tải media từ máy. Website chỉ thay đổi sau khi công khai.',
    fields: ['imageUrl', 'thumbnailUrl', 'videoUrl', 'posterUrl'],
  },
];
const TECHNICAL_ALIAS_FIELDS = [
  'image', 'imageUrl', 'image_url', 'src', 'url',
  'thumbnail', 'thumbnailUrl', 'thumbnail_url',
  'videoUrl', 'video_url',
  'poster', 'posterUrl', 'poster_url',
  'realSize', 'real_size',
];
const LOCKED_EXPORT_FIELDS = new Set([
  'position', 'rotation', 'size', 'scale', 'group', 'frame', 'clickable', 'transparent',
  'collider', 'physics', 'mesh', 'object3D', 'geometry', 'materialConfig', 'renderConfig',
]);
const OPTIONAL_EMPTY_ALLOWED = new Set([...TEXT_FIELDS, ...MEDIA_FIELDS]);
const MAX_JSON_IMPORT_BYTES = 2 * 1024 * 1024;
const FEATURED_OPERATOR_MAX_ITEMS = 12;
const FEATURED_OPERATOR_DEFAULTS = Object.freeze({
  enabled: true,
  title: 'Tác phẩm tiêu biểu',
  lead: '',
  items: Object.freeze([]),
});
const FEATURED_OPERATOR_ROOM_OPTIONS = Object.freeze([
  { value: '', label: 'Không gắn liên kết 3D' },
  { value: 'indoor', label: 'Trong nhà' },
  { value: 'outdoor', label: 'Ngoài trời' },
]);

const featuredImageReplaceState = {
  itemKey: '',
  mode: 'local',
  candidateUrl: '',
  previewUrl: '',
  previewStatus: 'idle',
  error: '',
  localFile: null,
  localPreviewUrl: '',
  localStatus: 'idle',
  localError: '',
  uploadedUrl: '',
  uploadedStoragePath: '',
  uploadedMetadataId: '',
  uploadedPreviewStatus: 'idle',
};

const staticMediaLibraryPickerState = {
  open: false,
  roomKey: '',
  itemCode: '',
  fieldName: '',
  search: '',
  mediaKindFilter: 'all',
  error: '',
};

const featuredMediaLibraryPickerState = {
  open: false,
  itemKey: '',
  itemIndex: -1,
  search: '',
  mediaKindFilter: 'compatible',
  error: '',
};

const AUTO_DRAFT_TITLE_MAX_LENGTH = 160;

function formatOperatorTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function compactTitlePart(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateDraftTitle(title = '', maxLength = AUTO_DRAFT_TITLE_MAX_LENGTH) {
  const text = compactTitlePart(title);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function getRoomLabel(roomKey = '') {
  return String(roomKey || '').toLowerCase() === 'outdoor' ? 'Ngoài trời' : 'Trong nhà';
}

function createOperatorDraftTitle(draftState = {}, { forceTimestamp = false, date = new Date() } = {}) {
  const timestamp = formatOperatorTimestamp(date);
  const currentItem = getSelectedDraftItem(draftState);
  const itemCode = compactTitlePart(getItemCode(currentItem));
  const itemTitle = compactTitlePart(currentItem?.title || currentItem?.name || '');
  if (itemCode) {
    return truncateDraftTitle(`Nội dung phòng 3D — ${getRoomLabel(draftState.selectedRoom)} — ${itemCode}${itemTitle ? ` — ${itemTitle}` : ''} — ${timestamp}`);
  }
  const versionOrSource = compactTitlePart(draftState.draftJson?.version || draftState.source || 'CMS');
  const base = forceTimestamp ? `${versionOrSource} — ${timestamp}` : `${versionOrSource} — ${timestamp}`;
  return truncateDraftTitle(`Nội dung phòng 3D — ${base}`);
}

function getDraftTitleForDisplay(draftState = {}) {
  return draftState.draftTitleTouched && draftState.draftTitle
    ? draftState.draftTitle
    : createOperatorDraftTitle(draftState);
}

function normalizeStaticRoomKey(roomKey = '') {
  return String(roomKey || '').toLowerCase() === 'outdoor' ? 'outdoor' : 'indoor';
}

function getRoomFirstDraftState(draftState = {}, roomKey = 'indoor') {
  const selectedRoom = normalizeStaticRoomKey(roomKey || draftState.selectedRoom || 'indoor');
  const roomItems = getDraftRoomItems(draftState.draftJson, selectedRoom);
  const selectedItemCode = roomItems.some((item) => getItemCode(item) === draftState.selectedItemCode)
    ? draftState.selectedItemCode
    : getItemCode(roomItems[0]) || '';
  return {
    ...draftState,
    selectedRoom,
    selectedItemCode,
    activeWorkspace: 'room',
    activeEditorTab: 'content',
  };
}

function getFeaturedFirstDraftState(draftState = {}) {
  return {
    ...draftState,
    selectedRoom: normalizeStaticRoomKey(draftState.selectedRoom || 'indoor'),
    activeWorkspace: 'featured',
    activeEditorTab: 'content',
    activeDrawer: draftState.activeDrawer || '',
  };
}

function selectStaticRoomItem(roomKey = 'indoor', itemCode = '', handlers = {}) {
  const room = normalizeStaticRoomKey(roomKey);
  setStaticCmsDraftState({
    selectedRoom: room,
    selectedItemCode: String(itemCode || ''),
    exportError: null,
    exportSuccess: null,
    draftSaveStatus: '',
    draftPersistenceError: null,
    activeWorkspace: 'room',
    activeEditorTab: 'content',
    activeDrawer: '',
  });
  handlers.onRerender?.();
}

function getStaticRoomCopy(roomKey = 'indoor') {
  const room = normalizeStaticRoomKey(roomKey);
  return room === 'outdoor'
    ? {
        key: 'outdoor',
        title: 'Phòng ngoài trời',
        status: 'Ngoài trời',
        summary: 'Nội dung trong phòng ngoài trời mà người xem sẽ thấy khi tham quan không gian ngoài trời.',
        listTitle: 'Nội dung phòng ngoài trời',
        editTitle: 'Chỉnh nội dung phòng ngoài trời',
      }
    : {
        key: 'indoor',
        title: 'Phòng trong nhà',
        status: 'Trong nhà',
        summary: 'Nội dung trong phòng trong nhà mà người xem sẽ thấy khi tham quan không gian 3D.',
        listTitle: 'Nội dung phòng trong nhà',
        editTitle: 'Chỉnh nội dung phòng trong nhà',
      };
}

function getStaticDraftItemMissingFields(item = {}) {
  const missing = [];
  if (!String(item.title || item.name || '').trim()) missing.push('Tiêu đề');
  if (!String(item.description || item.content || '').trim()) missing.push('Mô tả / thuyết minh');
  return missing;
}

function countRoomItemsMissingMainContent(items = []) {
  return safeArray(items).filter((item) => getStaticDraftItemMissingFields(item).length > 0).length;
}

function getItemPrimaryMediaUrl(item = {}) {
  return getDraftFieldDisplayValue(item, 'imageUrl')
    || getDraftFieldDisplayValue(item, 'thumbnailUrl')
    || getDraftFieldDisplayValue(item, 'posterUrl')
    || getDraftFieldDisplayValue(item, 'videoUrl')
    || '';
}

function hasStaticItemMedia(item = {}) {
  return MEDIA_FIELDS.some((field) => String(item?.[field] || '').trim())
    || Boolean(getItemPrimaryMediaUrl(item));
}

function renderStaticOperatorStepPanel(config = {}, options = {}) {
  const steps = safeArray(config.steps);
  if (!config.title && !steps.length) return createElement('div');
  const panel = createElement('section', {
    className: ['cms-admin-panel', 'cms-admin-static-operator-steps', options.className || ''].filter(Boolean).join(' '),
  });
  const header = createElement('div', { className: 'cms-admin-panel-title-row' });
  header.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: config.title || 'Các bước thực hiện' }));
  if (options.status) header.appendChild(renderBadge(options.status, 'success'));
  panel.appendChild(header);
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

export function renderStaticCmsDraftTab(state, handlers = {}) {
  const copy = ADMIN_COPY.staticDraft || {};
  const baseDraftState = state.staticCmsDraft || {};
  const requestedWorkspaceKey = String(handlers.activeWorkspaceKey || handlers.activeRoomKey || baseDraftState.selectedRoom || 'indoor').toLowerCase();
  const isFeaturedWorkspace = requestedWorkspaceKey === 'featured';
  const activeRoomKey = isFeaturedWorkspace
    ? normalizeStaticRoomKey(baseDraftState.selectedRoom || 'indoor')
    : normalizeStaticRoomKey(requestedWorkspaceKey || baseDraftState.selectedRoom || 'indoor');
  const draftState = isFeaturedWorkspace
    ? getFeaturedFirstDraftState(baseDraftState)
    : getRoomFirstDraftState(baseDraftState, activeRoomKey);
  const currentItem = isFeaturedWorkspace ? null : getSelectedDraftItem(draftState);
  const panel = createElement('section', {
    className: [
      'cms-admin-static-draft-shell',
      'cms-admin-static-workspace-shell',
      isFeaturedWorkspace ? 'cms-admin-static-featured-shell' : 'cms-admin-static-room-first-shell',
      isFeaturedWorkspace ? 'cms-admin-static-workspace-featured' : `cms-admin-static-room-first-${activeRoomKey}`,
    ].filter(Boolean).join(' '),
    dataset: { cmsReferenceTarget: 'static-draft', cmsReferenceId: isFeaturedWorkspace ? 'featured' : activeRoomKey },
  });

  panel.appendChild(isFeaturedWorkspace
    ? renderFeaturedWorkspaceCommandBar(draftState, state, handlers, copy)
    : renderStaticWorkspaceCommandBar(draftState, state, currentItem, handlers, copy, activeRoomKey));

  if (draftState.loadError) {
    panel.appendChild(renderErrorBox(draftState.loadError, 'Không tải được nội dung đang công khai'));
  }

  if (!draftState.draftJson) {
    const empty = createElement('section', { className: 'cms-admin-panel cms-admin-static-empty-panel cms-admin-static-workspace-empty' });
    empty.appendChild(renderEmptyState(copy.noBaseline || 'Chưa tải nội dung đang công khai.'));
    empty.appendChild(createElement('p', {
      className: 'cms-admin-help-text',
      text: 'Bấm “Tải nội dung đang công khai” để lấy nội dung website đang dùng. Thao tác này chỉ mở bản nháp, chưa làm thay đổi website.',
    }));
    panel.appendChild(empty);
    return panel;
  }

  panel.appendChild(isFeaturedWorkspace
    ? renderFeaturedWorkspaceShell(draftState, state, handlers, copy)
    : renderStaticWorkspaceShell(draftState, state, currentItem, handlers, copy, activeRoomKey));
  panel.appendChild(renderUtilityDrawers(draftState, state, currentItem, handlers, copy));
  return panel;
}

function renderStaticWorkspaceCommandBar(draftState = {}, appState = {}, currentItem = null, handlers = {}, copy = {}, activeRoomKey = 'indoor') {
  const roomCopy = getStaticRoomCopy(activeRoomKey);
  const bar = createElement('section', {
    className: 'cms-admin-panel cms-admin-static-command-bar cms-admin-operator-command-bar',
    dataset: { cmsReferenceTarget: 'static-draft', cmsReferenceId: 'static-draft' },
  });

  const left = createElement('div', { className: 'cms-admin-static-command-main' });
  left.appendChild(createElement('p', { className: 'cms-admin-eyebrow', text: 'Quản trị nội dung' }));
  const titleRow = createElement('div', { className: 'cms-admin-static-command-title-row' });
  titleRow.appendChild(createElement('h2', { className: 'cms-admin-static-title', text: roomCopy.title }));
  titleRow.appendChild(renderBadge(getFriendlyDraftStateLabel(draftState), getFriendlyDraftStateVariant(draftState)));
  left.appendChild(titleRow);
  left.appendChild(createElement('p', {
    className: 'cms-admin-subtitle cms-admin-static-command-subtitle',
    text: `${roomCopy.summary} Chọn nội dung, xem trước, chỉnh bản nháp trong CMS và lưu khi đã kiểm tra.`,
  }));

  const context = createElement('div', { className: 'cms-admin-static-command-context' });
  const roomItems = getDraftRoomItems(draftState.draftJson, activeRoomKey);
  context.appendChild(renderInfoTile('Đang sửa', currentItem ? `${roomCopy.title} / ${currentItem.title || currentItem.name || getItemCode(currentItem) || 'nội dung'}` : `${roomCopy.title} / chưa chọn nội dung`));
  context.appendChild(renderInfoTile('Số nội dung', `${roomItems.length} mục`));
  context.appendChild(renderInfoTile('Cần kiểm tra', `${countRoomItemsMissingMainContent(roomItems)} mục`));

  const compactActions = createElement('div', { className: 'cms-admin-actions cms-admin-static-command-actions cms-admin-static-command-actions-compact' });
  if (!draftState.draftJson) compactActions.appendChild(renderMainLoadActions(draftState, handlers));

  appendChildren(bar, compactActions.childNodes.length ? [left, context, compactActions] : [left, context]);
  return bar;
}

function renderFeaturedWorkspaceCommandBar(draftState = {}, appState = {}, handlers = {}, copy = {}) {
  const featured = getFeaturedOperatorSection(draftState.draftJson);
  const validation = validateFeaturedOperatorSection(featured, STATIC_CMS_DRAFT_CONFIG);
  const issueCount = validation.errors.length + validation.warnings.length;
  const bar = createElement('section', {
    className: 'cms-admin-panel cms-admin-static-command-bar cms-admin-operator-command-bar cms-admin-featured-command-bar',
    dataset: { cmsReferenceTarget: 'static-draft', cmsReferenceId: 'featured' },
  });

  const left = createElement('div', { className: 'cms-admin-static-command-main' });
  left.appendChild(createElement('p', { className: 'cms-admin-eyebrow', text: 'Nội dung nổi bật' }));
  const titleRow = createElement('div', { className: 'cms-admin-static-command-title-row' });
  titleRow.appendChild(createElement('h2', { className: 'cms-admin-static-title', text: 'Tác phẩm tiêu biểu' }));
  titleRow.appendChild(renderBadge(featured.enabled === false ? 'Đang tắt' : 'Đang hiển thị', featured.enabled === false ? 'warning' : 'success'));
  titleRow.appendChild(renderBadge(getFriendlyDraftStateLabel(draftState), getFriendlyDraftStateVariant(draftState)));
  left.appendChild(titleRow);
  left.appendChild(createElement('p', {
    className: 'cms-admin-subtitle cms-admin-static-command-subtitle',
    text: 'Surface này quản lý tác phẩm nổi bật dùng ở Trang chủ. Đây không phải danh sách đầy đủ trong phòng 3D.',
  }));

  const context = createElement('div', { className: 'cms-admin-static-command-context' });
  context.appendChild(renderInfoTile('Nguồn dữ liệu', 'Tác phẩm tiêu biểu trên Trang chủ'));
  context.appendChild(renderInfoTile('Số mục', `${safeArray(featured.items).length}/${FEATURED_OPERATOR_MAX_ITEMS}`));
  context.appendChild(renderInfoTile('Cần xem', issueCount ? `${issueCount} cảnh báo/lỗi` : 'Sạch'));

  const compactActions = createElement('div', { className: 'cms-admin-actions cms-admin-static-command-actions cms-admin-static-command-actions-compact' });
  if (!draftState.draftJson) compactActions.appendChild(renderMainLoadActions(draftState, handlers));

  appendChildren(bar, compactActions.childNodes.length ? [left, context, compactActions] : [left, context]);
  return bar;
}

function getActiveWorkspace(draftState = {}) {
  return String(draftState.activeWorkspace || 'room') === 'featured' ? 'featured' : 'room';
}

function renderWorkspaceSwitch(draftState = {}, handlers = {}) {
  const wrap = createElement('div', { className: 'cms-admin-workspace-switch', attrs: { role: 'tablist', 'aria-label': 'Chọn khu vực nội dung' } });
  const active = getActiveWorkspace(draftState);
  [
    { key: 'room', label: 'Phòng 3D' },
    { key: 'featured', label: 'Tác phẩm tiêu biểu' },
  ].forEach((item) => {
    const button = createElement('button', {
      className: ['cms-admin-workspace-switch-button', active === item.key ? 'is-active' : ''].filter(Boolean).join(' '),
      type: 'button',
      text: item.label,
      attrs: { role: 'tab', 'aria-selected': active === item.key ? 'true' : 'false' },
    });
    button.addEventListener('click', () => {
      setStaticCmsDraftWorkspace(item.key);
      handlers.onRerender?.();
    });
    wrap.appendChild(button);
  });
  return wrap;
}

function getFriendlyDraftStateLabel(draftState = {}) {
  if (!draftState.draftJson) return 'Chưa tải nội dung';
  if (draftState.isSavingDraft) return 'Đang lưu';
  if (draftState.isPublishingCms) return 'Đang xử lý';
  if (draftState.dirty) return 'Có thay đổi chưa lưu';
  if (draftState.publishResult?.ok === true) return 'Đã công khai nội dung';
  if (draftState.currentDraftId) return 'Đã lưu thay đổi';
  return 'Chưa lưu thay đổi';
}

function getFriendlyDraftStateVariant(draftState = {}) {
  if (!draftState.draftJson) return 'default';
  if (draftState.dirty || !draftState.currentDraftId) return 'warning';
  if (draftState.publishResult?.ok === true || draftState.currentDraftId) return 'success';
  return 'default';
}

function renderDrawerTrigger(label, drawerKey, handlers = {}, variant = 'ghost') {
  const button = createElement('button', {
    className: `cms-admin-button cms-admin-button-${variant} cms-admin-button-small`,
    type: 'button',
    text: label,
  });
  button.addEventListener('click', () => {
    setStaticCmsDraftDrawer(drawerKey);
    handlers.onRerender?.();
  });
  return button;
}

function renderStaticWorkspaceShell(draftState = {}, appState = {}, currentItem = null, handlers = {}, copy = {}, activeRoomKey = 'indoor') {
  return renderStaticRoomFirstWorkspace(draftState, appState, currentItem, handlers, copy, activeRoomKey);
}

function renderStaticRoomFirstWorkspace(draftState = {}, appState = {}, currentItem = null, handlers = {}, copy = {}, activeRoomKey = 'indoor') {
  const roomKey = normalizeStaticRoomKey(activeRoomKey || draftState.selectedRoom || 'indoor');
  const roomCopy = getStaticRoomCopy(roomKey);
  const roomItems = getDraftRoomItems(draftState.draftJson, roomKey);
  const shell = createElement('section', {
    className: `cms-admin-static-room-first-workspace cms-admin-static-room-first-workspace-${roomKey} cms-admin-static-contextual-workspace-root`,
    dataset: { cmsStaticRoom: roomKey },
  });
  const layout = createElement('div', { className: 'cms-admin-static-contextual-workspace cms-admin-static-room-contextual-workspace' });
  const mainColumn = createElement('div', { className: 'cms-admin-static-main-column cms-admin-static-room-main-column' });
  mainColumn.appendChild(renderStaticRoomItemList(draftState, roomItems, currentItem, handlers, roomCopy));
  mainColumn.appendChild(renderStaticRoomSelectedItemPanel(draftState, appState, currentItem, handlers, copy, roomCopy));
  layout.appendChild(mainColumn);
  layout.appendChild(renderStaticRoomContextualActionRail(draftState, appState, currentItem, handlers, copy, roomCopy, roomItems));
  shell.appendChild(layout);
  return shell;
}

function renderStaticRoomContextualActionRail(draftState = {}, appState = {}, currentItem = null, handlers = {}, copy = {}, roomCopy = {}, roomItems = []) {
  const rail = createElement('aside', {
    className: 'cms-admin-panel cms-admin-static-action-rail cms-admin-static-room-action-rail',
    attrs: { 'aria-label': 'Checklist và thao tác nội dung phòng 3D' },
  });
  rail.appendChild(renderStaticActionRailHeader('Checklist & thao tác', roomCopy.title || 'Nội dung phòng 3D'));
  rail.appendChild(renderStaticRailFocusBox('Đang xem phòng', roomCopy.title || getRoomLabel(draftState.selectedRoom), currentItem ? (currentItem.title || currentItem.name || getItemCode(currentItem) || 'Nội dung đang chọn') : 'Chưa chọn nội dung'));
  const checklist = createElement('div', { className: 'cms-admin-static-checklist' });
  buildStaticRoomChecklistModel(draftState, currentItem, roomCopy, roomItems).forEach((item) => checklist.appendChild(renderStaticChecklistItem(item)));
  rail.appendChild(checklist);
  rail.appendChild(renderStaticRoomRailActions(draftState, appState, handlers, copy));
  rail.appendChild(createElement('p', {
    className: 'cms-admin-help-text cms-admin-static-public-note',
    text: 'Lưu thay đổi sẽ lưu nội dung vào bản chuẩn bị. Website đang hoạt động chưa thay đổi.',
  }));
  return rail;
}

function renderStaticActionRailHeader(title = 'Checklist & thao tác', badge = '') {
  const header = createElement('div', { className: 'cms-admin-static-action-rail-header' });
  const copy = createElement('div');
  copy.appendChild(createElement('p', { className: 'cms-admin-eyebrow', text: 'Nội dung phòng 3D' }));
  copy.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: title }));
  header.appendChild(copy);
  if (badge) header.appendChild(renderBadge(badge, 'info'));
  return header;
}

function renderStaticRailFocusBox(label = '', value = '', note = '') {
  const box = createElement('div', { className: 'cms-admin-static-rail-focus-box' });
  box.appendChild(createElement('span', { text: label }));
  box.appendChild(createElement('strong', { text: value || '—' }));
  if (note) box.appendChild(createElement('p', { text: note }));
  return box;
}

function buildStaticRoomChecklistModel(draftState = {}, currentItem = null, roomCopy = {}, roomItems = []) {
  const missing = currentItem ? getStaticDraftItemMissingFields(currentItem) : [];
  const validation = draftState.validation || {};
  const hasItem = Boolean(currentItem);
  return [
    {
      label: 'Dữ liệu phòng',
      status: draftState.draftJson ? 'Đã đọc' : 'Thiếu dữ liệu',
      state: draftState.draftJson ? 'pass' : 'warning',
      detail: `${safeArray(roomItems).length} mục nội dung trong ${roomCopy.title || 'phòng này'}.`,
    },
    {
      label: 'Đã chọn nội dung',
      status: hasItem ? 'Có' : 'Chưa',
      state: hasItem ? 'pass' : 'warning',
      detail: hasItem ? 'Cột trái đang hiển thị nội dung đã chọn.' : 'Chọn một mục trong danh sách để xem và chỉnh.',
    },
    {
      label: 'Tiêu đề',
      status: hasItem && !missing.includes('Tiêu đề') ? 'Đạt' : 'Cần tiêu đề',
      state: hasItem && !missing.includes('Tiêu đề') ? 'pass' : 'warning',
      detail: hasItem ? 'Tiêu đề dùng cho danh sách và popup.' : 'Chưa chọn nội dung để kiểm tra.',
    },
    {
      label: 'Mô tả',
      status: hasItem && !missing.includes('Mô tả / thuyết minh') ? 'Đạt' : 'Cần mô tả',
      state: hasItem && !missing.includes('Mô tả / thuyết minh') ? 'pass' : 'warning',
      detail: 'Mô tả giúp người xem hiểu nội dung trưng bày.',
    },
    {
      label: 'Ảnh/video',
      status: hasItem && hasStaticItemMedia(currentItem) ? 'Đã có' : 'Cần kiểm tra',
      state: hasItem && hasStaticItemMedia(currentItem) ? 'pass' : 'warning',
      detail: 'Ảnh/video có thể chỉnh trong details của cột trái.',
    },
    {
      label: 'Có thay đổi chưa lưu',
      status: draftState.dirty ? 'Có' : 'Không',
      state: draftState.dirty ? 'warning' : 'pass',
      detail: draftState.dirty ? 'Hãy lưu thay đổi nếu muốn giữ nội dung trong bản chuẩn bị.' : 'Bản chuẩn bị chưa có thay đổi mới.',
    },
    {
      label: 'Kiểm tra dữ liệu',
      status: validation.valid === false ? 'Có lỗi' : validation.warnings?.length ? 'Có cảnh báo' : 'Đạt',
      state: validation.valid === false ? 'danger' : validation.warnings?.length ? 'warning' : 'pass',
      detail: validation.valid === false ? 'Cần sửa lỗi trước khi lưu thay đổi.' : 'Có thể lưu thay đổi khi cần.',
    },
    {
      label: 'Đang lưu',
      status: draftState.isSavingDraft ? 'Có' : 'Không',
      state: draftState.isSavingDraft ? 'warning' : 'pass',
      detail: 'Không rời màn khi đang lưu.',
    },
    {
      label: 'Website đang hoạt động',
      status: 'Chưa đổi',
      state: 'neutral',
      detail: 'Chỉ đổi sau workflow công khai riêng.',
    },
  ];
}

function renderStaticRoomRailActions(draftState = {}, appState = {}, handlers = {}, copy = {}) {
  const wrap = createElement('div', { className: 'cms-admin-static-action-rail-actions' });
  const primary = createElement('div', { className: 'cms-admin-static-rail-primary-actions' });
  primary.appendChild(renderMainLoadActions(draftState, handlers));
  if (draftState.draftJson) primary.appendChild(renderPrimaryOperatorActions(draftState, appState, handlers));
  wrap.appendChild(primary);

  const technical = createElement('details', { className: 'cms-admin-static-rail-technical-actions' });
  technical.appendChild(createElement('summary', { text: 'Thao tác phụ và kỹ thuật' }));
  const technicalActions = createElement('div', { className: 'cms-admin-actions cms-admin-static-rail-secondary-actions' });
  technicalActions.appendChild(renderDrawerTrigger('Quản lý bản nháp', 'drafts', handlers));
  technicalActions.appendChild(renderDrawerTrigger('Dành cho kỹ thuật', 'advanced', handlers));
  technical.appendChild(technicalActions);
  wrap.appendChild(technical);

  wrap.appendChild(renderValidationPanelCompact(draftState, copy));
  if (draftState.currentDraftId && !draftState.dirty && !draftState.isSavingDraft) {
    wrap.appendChild(renderContinueToPublishAction(handlers));
  }
  wrap.appendChild(createElement('p', {
    className: 'cms-admin-help-text cms-admin-static-form-note',
    text: 'Màn này chỉ dùng để chỉnh nội dung và lưu thay đổi. Website chỉ đổi ở màn Đưa website lên bản mới.',
  }));
  return wrap;
}

function renderStaticChecklistItem(item = {}) {
  const node = createElement('div', { className: `cms-admin-static-checklist-item is-${item.state || 'neutral'}` });
  node.appendChild(createElement('span', { className: 'cms-admin-static-checklist-icon', text: item.state === 'pass' ? '✓' : item.state === 'danger' ? '!' : '•', attrs: { 'aria-hidden': 'true' } }));
  const body = createElement('div');
  body.appendChild(createElement('strong', { text: item.label || 'Kiểm tra' }));
  body.appendChild(createElement('span', { text: item.status || '—' }));
  if (item.detail) body.appendChild(createElement('p', { text: item.detail }));
  node.appendChild(body);
  return node;
}

function renderStaticRoomIntroPanel(draftState = {}, roomItems = [], currentItem = null, roomCopy = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-static-room-intro-panel' });
  panel.appendChild(renderStaticPanelTitle(roomCopy.title, roomCopy.status));
  panel.appendChild(createElement('p', { className: 'cms-admin-help-text', text: roomCopy.summary }));
  const summary = createElement('div', { className: 'cms-admin-static-room-summary-grid' });
  summary.appendChild(renderInfoTile('Số nội dung', `${roomItems.length} mục`));
  summary.appendChild(renderInfoTile('Cần kiểm tra', `${countRoomItemsMissingMainContent(roomItems)} mục`));
  summary.appendChild(renderInfoTile('Nội dung đang chọn', currentItem ? `${currentItem.title || currentItem.name || getItemCode(currentItem) || 'Chưa có tiêu đề'}` : 'Chưa chọn nội dung'));
  summary.appendChild(renderInfoTile('Bản nháp trong CMS', draftState.dirty ? 'Có thay đổi chưa lưu' : 'Chưa có thay đổi'));
  panel.appendChild(summary);
  return panel;
}

function renderStaticRoomItemList(draftState = {}, roomItems = [], currentItem = null, handlers = {}, roomCopy = {}) {
  const pane = createElement('aside', { className: 'cms-admin-panel cms-admin-static-room-item-pane' });
  pane.appendChild(renderStaticPanelTitle(roomCopy.listTitle, `${roomItems.length} mục`));
  if (!roomItems.length) {
    pane.appendChild(renderEmptyState(`${roomCopy.title} chưa có nội dung.`));
    return pane;
  }
  const list = createElement('div', { className: 'cms-admin-static-room-item-list' });
  const selectedCode = getItemCode(currentItem);
  roomItems.forEach((item) => {
    const code = getItemCode(item);
    const missing = getStaticDraftItemMissingFields(item);
    const usedInFeatured = isStaticItemReferencedByFeatured(draftState.draftJson, roomCopy.key, item);
    const active = code === selectedCode;
    const button = createElement('button', {
      className: ['cms-admin-static-room-item-card', active ? 'is-active' : '', missing.length ? 'has-warning' : ''].filter(Boolean).join(' '),
      type: 'button',
      attrs: { 'aria-pressed': active ? 'true' : 'false' },
    });
    button.appendChild(renderItemTypeBadge(item));
    const text = createElement('span', { className: 'cms-admin-static-item-card-text' });
    text.appendChild(createElement('strong', { text: item.title || item.name || code || 'Chưa có tiêu đề' }));
    text.appendChild(createElement('small', { text: missing.length ? `Cần kiểm tra: ${missing.join(', ')}` : (code ? `Mã kỹ thuật: ${code}` : 'Chưa có mã kỹ thuật') }));
    button.appendChild(text);
    if (usedInFeatured) button.appendChild(renderBadge('Tiêu biểu', 'success'));
    button.addEventListener('click', () => selectStaticRoomItem(roomCopy.key, code, handlers));
    list.appendChild(button);
  });
  pane.appendChild(list);
  return pane;
}

function renderStaticRoomSelectedItemPanel(draftState = {}, appState = {}, currentItem = null, handlers = {}, copy = {}, roomCopy = {}) {
  const panel = createElement('section', { className: 'cms-admin-static-room-selected-panel' });
  if (!currentItem) {
    const empty = createElement('section', { className: 'cms-admin-panel cms-admin-static-selected-empty' });
    empty.appendChild(renderEmptyState(`Chưa có nội dung trong ${roomCopy.title}.`));
    empty.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Tab này chỉ hiển thị nội dung của phòng đang mở.' }));
    panel.appendChild(empty);
    return panel;
  }
  panel.appendChild(renderStaticRoomSelectedPreview(draftState, currentItem, copy, roomCopy));
  panel.appendChild(renderStaticRoomItemForm(draftState, currentItem, handlers, roomCopy));
  return panel;
}

function renderStaticRoomSelectedPreview(draftState = {}, currentItem = {}, copy = {}, roomCopy = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-static-selected-preview-panel' });
  panel.appendChild(renderStaticPanelTitle('Người xem sẽ thấy', getItemCode(currentItem) || roomCopy.status));
  const body = createElement('div', { className: 'cms-admin-static-selected-preview-body' });
  const text = createElement('div', { className: 'cms-admin-static-selected-preview-text' });
  text.appendChild(createElement('p', { className: 'cms-admin-eyebrow', text: roomCopy.title }));
  text.appendChild(createElement('h3', { text: currentItem.title || currentItem.name || 'Chưa có tiêu đề' }));
  text.appendChild(createElement('p', { className: 'cms-admin-help-text', text: currentItem.description || currentItem.content || 'Chưa có mô tả/thuyết minh chính.' }));
  const facts = createElement('div', { className: 'cms-admin-static-room-facts' });
  facts.appendChild(renderInfoTile('Mã kỹ thuật', getItemCode(currentItem) || 'Chưa có', true));
  facts.appendChild(renderInfoTile('Loại nội dung', getItemType(currentItem)));
  facts.appendChild(renderInfoTile('Trạng thái', getStaticItemVisibilityLabel(currentItem)));
  facts.appendChild(renderInfoTile('Ảnh/video', hasStaticItemMedia(currentItem) ? 'Đã có' : 'Cần kiểm tra'));
  text.appendChild(facts);
  body.appendChild(text);
  const media = createElement('div', { className: 'cms-admin-static-selected-preview-media' });
  media.appendChild(renderStaticCmsMediaPreview({
    item: currentItem || {},
    fieldName: draftState.previewField || '',
    config: STATIC_CMS_DRAFT_CONFIG,
  }));
  body.appendChild(media);
  panel.appendChild(body);
  if (isStaticItemReferencedByFeatured(draftState.draftJson, roomCopy.key, currentItem)) {
    panel.appendChild(createElement('div', {
      className: 'cms-admin-alert cms-admin-alert-success',
      text: 'Đang được dùng trong Tác phẩm tiêu biểu. Thông tin này chỉ để đối chiếu, không ghi dữ liệu.',
    }));
  }
  const missing = getStaticDraftItemMissingFields(currentItem);
  if (missing.length) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: `Cần bổ sung: ${missing.join(', ')}.` }));
  }
  return panel;
}

function renderStaticRoomItemForm(draftState = {}, item = {}, handlers = {}, roomCopy = {}) {
  const form = createElement('form', { className: 'cms-admin-form cms-admin-static-draft-form cms-admin-static-room-item-form', attrs: { novalidate: 'true' } });
  form.addEventListener('submit', (event) => event.preventDefault());
  form.appendChild(renderStaticRoomMainFieldGroup(draftState, item, handlers));
  form.appendChild(renderStaticRoomEditActionBlock(draftState, handlers));
  form.appendChild(renderStaticRoomMediaDetails(draftState, item, handlers));
  form.appendChild(renderStaticRoomMetadataDetails(draftState, item, handlers));
  form.appendChild(renderStaticRoomTechnicalDetails(draftState, item, roomCopy));
  return form;
}

function renderStaticRoomMainFieldGroup(draftState = {}, item = {}, handlers = {}) {
  const group = DISPLAY_FIELD_GROUPS.find((entry) => entry.key === 'display') || DISPLAY_FIELD_GROUPS[0];
  return renderFieldGroup(draftState, item, group, handlers);
}

function renderStaticRoomEditActionBlock(draftState = {}, handlers = {}) {
  const block = createElement('section', { className: 'cms-admin-static-room-action-block' });
  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-static-room-action-row' });
  const cancelButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost',
    type: 'button',
    text: 'Hủy',
    title: 'Hủy thay đổi chưa lưu trong bản nháp đang mở',
  });
  cancelButton.disabled = Boolean(draftState.isSavingDraft || !draftState.dirty);
  cancelButton.addEventListener('click', () => {
    if (!draftState.dirty) return;
    const confirmed = globalThis.confirm?.('Hủy các thay đổi chưa lưu trong bản nháp Nội dung phòng 3D?');
    if (!confirmed) return;
    resetStaticCmsDraftToBaseline(validateStaticCmsDraft(draftState.baselineJson || {}, STATIC_CMS_DRAFT_CONFIG));
    handlers.onRerender?.();
  });

  const resetButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    type: 'button',
    text: 'Đặt lại thay đổi',
    title: 'Đặt lại bản nháp về nội dung đang công khai/baseline đang mở',
  });
  resetButton.disabled = Boolean(draftState.isSavingDraft || !draftState.dirty);
  resetButton.addEventListener('click', () => {
    if (!draftState.dirty) return;
    const confirmed = globalThis.confirm?.('Đặt lại toàn bộ thay đổi chưa lưu về baseline đang mở?');
    if (!confirmed) return;
    resetStaticCmsDraftToBaseline(validateStaticCmsDraft(draftState.baselineJson || {}, STATIC_CMS_DRAFT_CONFIG));
    handlers.onRerender?.();
  });

  const saveButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    type: 'button',
    text: draftState.isSavingDraft ? 'Đang lưu...' : 'Lưu thay đổi',
    title: draftState.currentDraftId ? 'Lưu thay đổi vào bản chuẩn bị hiện tại.' : 'Lưu nội dung đang sửa thành bản chuẩn bị.',
  });
  saveButton.disabled = Boolean(draftState.isSavingDraft || !draftState.draftJson || !draftState.validation?.valid);
  saveButton.addEventListener('click', () => handleSaveStaticCmsDraft({ handlers }));

  appendChildren(actions, [cancelButton, resetButton, saveButton]);
  block.appendChild(actions);
  block.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: draftState.dirty ? 'Có thay đổi chưa lưu. Lưu thay đổi sẽ cập nhật bản chuẩn bị; website đang hoạt động chưa thay đổi.' : 'Chưa có thay đổi để lưu.',
  }));
  return block;
}

function renderStaticRoomMediaDetails(draftState = {}, item = {}, handlers = {}) {
  const details = createElement('details', { className: 'cms-admin-static-room-details cms-admin-static-room-media-details' });
  details.appendChild(createElement('summary', { text: hasStaticItemMedia(item) ? 'Ảnh & video của nội dung này' : 'Ảnh & video — chưa có dữ liệu chính' }));
  const group = DISPLAY_FIELD_GROUPS.find((entry) => entry.key === 'media');
  details.appendChild(renderFieldGroup(draftState, item, group, handlers));
  return details;
}

function renderStaticRoomMetadataDetails(draftState = {}, item = {}, handlers = {}) {
  const details = createElement('details', { className: 'cms-admin-static-room-details cms-admin-static-room-metadata-details' });
  details.appendChild(createElement('summary', { text: 'Thông tin thêm' }));
  const group = DISPLAY_FIELD_GROUPS.find((entry) => entry.key === 'metadata');
  details.appendChild(renderFieldGroup(draftState, item, group, handlers));
  return details;
}

function renderStaticRoomTechnicalDetails(draftState = {}, item = {}, roomCopy = {}) {
  const details = createElement('details', { className: 'cms-admin-static-room-details cms-admin-static-room-technical-details' });
  details.appendChild(createElement('summary', { text: 'Thông tin kỹ thuật để đối chiếu' }));
  const rows = [
    ['Mã phòng', roomCopy.key || draftState.selectedRoom || 'indoor'],
    ['Mã nội dung', getItemCode(item) || 'Chưa có'],
    ['ID nội dung', item.id || '—'],
    ['Loại nội dung', getItemType(item)],
    ['Thứ tự', item.sortOrder ?? item.sort_order ?? '—'],
    ['Trạng thái hiển thị', item.isVisible === false || item.is_visible === false ? 'Không hiển thị' : 'Đang hiển thị'],
  ];
  details.appendChild(renderStaticTechnicalKeyValue(rows));
  details.appendChild(renderTechnicalAliasDetails(item));
  details.appendChild(createElement('pre', { className: 'cms-admin-code-block', text: JSON.stringify(item, null, 2) }));
  return details;
}

function renderStaticTechnicalKeyValue(rows = []) {
  const list = createElement('dl', { className: 'cms-admin-static-technical-kv' });
  rows.forEach(([label, value]) => {
    list.appendChild(createElement('dt', { text: label }));
    list.appendChild(createElement('dd', { text: toDisplayText(value, '—') }));
  });
  return list;
}

function renderWorkspaceItemNavigator(draftState = {}, currentItem = null, handlers = {}) {
  const pane = createElement('aside', { className: 'cms-admin-panel cms-admin-static-workspace-pane cms-admin-static-left-pane' });
  pane.appendChild(renderStaticPanelTitle('Chọn nội dung', renderRoomCountMeta(draftState)));
  pane.appendChild(renderRoomAndItemSelector(draftState, handlers));
  pane.appendChild(renderItemCards(draftState, handlers));
  if (currentItem) {
    const note = createElement('details', { className: 'cms-admin-static-locked-note cms-admin-static-locked-note-compact' });
    note.appendChild(createElement('summary', { text: 'Khóa kỹ thuật' }));
    note.appendChild(createElement('p', {
      className: 'cms-admin-help-text',
      text: 'Thông tin kỹ thuật được giữ nguyên. Người vận hành chỉ cần sửa nội dung, media hoặc thông tin thêm.',
    }));
    pane.appendChild(note);
  }
  return pane;
}

function renderWorkspaceEditor(draftState = {}, currentItem = null, handlers = {}, copy = {}) {
  const pane = createElement('section', { className: 'cms-admin-panel cms-admin-static-workspace-pane cms-admin-static-editor-pane' });
  pane.appendChild(renderStaticPanelTitle('Sửa nội dung', draftState.dirty ? (copy.dirty || 'Có thay đổi chưa lưu') : (copy.clean || 'Đã lưu / chưa có thay đổi')));
  if (!currentItem) {
    pane.appendChild(renderEmptyState(copy.noItem || 'Chưa chọn tác phẩm hoặc nội dung.'));
    return pane;
  }
  pane.appendChild(renderEditorTabs(draftState, handlers));
  pane.appendChild(renderStaticCmsDraftForm(draftState, currentItem, handlers));
  return pane;
}

function renderEditorTabs(draftState = {}, handlers = {}) {
  const tabs = createElement('div', { className: 'cms-admin-static-editor-tabs', attrs: { role: 'tablist' } });
  const active = getActiveEditorTab(draftState);
  [
    { key: 'content', label: 'Nội dung' },
    { key: 'media', label: 'Ảnh & video' },
    { key: 'metadata', label: 'Thông tin thêm' },
  ].forEach((tab) => {
    const button = createElement('button', {
      className: ['cms-admin-static-editor-tab', active === tab.key ? 'is-active' : ''].filter(Boolean).join(' '),
      type: 'button',
      text: tab.label,
      attrs: { role: 'tab', 'aria-selected': active === tab.key ? 'true' : 'false' },
    });
    button.addEventListener('click', () => {
      setStaticCmsDraftEditorTab(tab.key);
      handlers.onRerender?.();
    });
    tabs.appendChild(button);
  });
  return tabs;
}

function getActiveEditorTab(draftState = {}) {
  const tab = String(draftState.activeEditorTab || 'content');
  return ['content', 'media', 'metadata'].includes(tab) ? tab : 'content';
}

function renderWorkspaceInspector(draftState = {}, appState = {}, currentItem = null, handlers = {}, copy = {}) {
  const pane = createElement('aside', { className: 'cms-admin-static-workspace-pane cms-admin-static-inspector-pane' });
  pane.appendChild(renderPreviewPanel(draftState, currentItem, copy));
  pane.appendChild(renderValidationPanelCompact(draftState, copy));
  return pane;
}

function renderUtilityDrawers(draftState = {}, appState = {}, currentItem = null, handlers = {}, copy = {}) {
  const active = String(draftState.activeDrawer || '');
  if (!active) return createElement('div', { className: 'cms-admin-static-drawer-root is-empty' });
  const drawerMap = {
    drafts: {
      title: 'Quản lý bản nháp',
      description: 'Đặt tên, ghi chú, lưu bản sao và mở lại bản nháp đã lưu. Nút lưu chính vẫn nằm ở command bar.',
      content: () => renderDraftPersistencePanel(draftState, appState, handlers, copy),
    },
    advanced: {
      title: 'Dành cho kỹ thuật',
      description: 'Khu vực dành cho quản trị viên kỹ thuật. Người vận hành thông thường không cần dùng khu này.',
      content: () => renderExportPanel(draftState, handlers, copy),
    },
  };
  const config = drawerMap[active];
  if (!config) return createElement('div', { className: 'cms-admin-static-drawer-root is-empty' });

  const root = createElement('div', { className: 'cms-admin-static-drawer-root is-open' });
  const overlay = createElement('button', {
    className: 'cms-admin-static-drawer-overlay',
    type: 'button',
    attrs: { 'aria-label': 'Đóng panel phụ' },
  });
  overlay.addEventListener('click', () => {
    setStaticCmsDraftDrawer('');
    handlers.onRerender?.();
  });
  const drawer = createElement('aside', { className: 'cms-admin-static-drawer-panel', attrs: { role: 'dialog', 'aria-modal': 'true' } });
  const head = createElement('div', { className: 'cms-admin-static-drawer-head' });
  const heading = createElement('div');
  heading.appendChild(createElement('h3', { text: config.title }));
  heading.appendChild(createElement('p', { className: 'cms-admin-help-text', text: config.description }));
  const close = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-small', type: 'button', text: 'Đóng' });
  close.addEventListener('click', () => {
    setStaticCmsDraftDrawer('');
    handlers.onRerender?.();
  });
  appendChildren(head, [heading, close]);
  drawer.appendChild(head);
  drawer.appendChild(config.content());
  appendChildren(root, [overlay, drawer]);
  return root;
}



function renderFeaturedWorkspaceShell(draftState = {}, appState = {}, handlers = {}, copy = {}) {
  const featured = getFeaturedOperatorSection(draftState.draftJson);
  const validation = validateFeaturedOperatorSection(featured, STATIC_CMS_DRAFT_CONFIG);
  const selectedIndex = getSelectedFeaturedIndex(draftState, featured);
  const selectedItem = selectedIndex >= 0 ? featured.items[selectedIndex] : null;
  const shell = createElement('section', { className: 'cms-admin-static-workspace cms-admin-featured-workspace cms-admin-featured-workspace-restored cms-admin-featured-workspace-repaired cms-admin-featured-contextual-root' });
  const layout = createElement('div', { className: 'cms-admin-static-contextual-workspace cms-admin-featured-contextual-workspace' });
  const mainColumn = createElement('div', { className: 'cms-admin-static-main-column cms-admin-featured-main-column' });
  mainColumn.appendChild(renderFeaturedWorkspaceNavigator(draftState, featured, validation, handlers));
  const detail = createElement('div', { className: 'cms-admin-featured-detail-stack' });
  detail.appendChild(renderFeaturedSelectedItemPreview(selectedItem, selectedIndex, validation));
  detail.appendChild(renderFeaturedWorkspaceEditor(draftState, featured, validation, handlers));
  detail.appendChild(renderFeaturedSecondaryDetails(featured, validation));
  mainColumn.appendChild(detail);
  layout.appendChild(mainColumn);
  layout.appendChild(renderFeaturedContextualActionRail(draftState, featured, selectedItem, selectedIndex, validation, handlers));

  shell.appendChild(layout);
  return shell;
}

function renderFeaturedContextualActionRail(draftState = {}, featured = {}, selectedItem = null, selectedIndex = -1, validation = {}, handlers = {}) {
  const rail = createElement('aside', {
    className: 'cms-admin-panel cms-admin-static-action-rail cms-admin-featured-action-rail',
    attrs: { 'aria-label': 'Checklist và thao tác Tác phẩm tiêu biểu' },
  });
  rail.appendChild(renderStaticActionRailHeader('Checklist & thao tác', 'Tác phẩm tiêu biểu'));
  rail.appendChild(renderStaticRailFocusBox('Đang xem khu vực', 'Tác phẩm tiêu biểu trên Trang chủ', selectedItem ? (selectedItem.title || selectedItem.id || `Mục ${selectedIndex + 1}`) : 'Chưa chọn mục'));
  const checklist = createElement('div', { className: 'cms-admin-static-checklist' });
  buildFeaturedChecklistModel(draftState, featured, selectedItem, selectedIndex, validation).forEach((item) => checklist.appendChild(renderStaticChecklistItem(item)));
  rail.appendChild(checklist);
  rail.appendChild(renderFeaturedRailActions(draftState, handlers));
  return rail;
}

function renderFeaturedRailActions(draftState = {}, handlers = {}) {
  const wrap = createElement('div', { className: 'cms-admin-static-action-rail-actions' });
  const primary = createElement('div', { className: 'cms-admin-static-rail-primary-actions' });
  primary.appendChild(renderMainLoadActions(draftState, handlers));
  const technical = createElement('details', { className: 'cms-admin-static-rail-technical-actions' });
  technical.appendChild(createElement('summary', { text: 'Thao tác phụ và kỹ thuật' }));
  const technicalActions = createElement('div', { className: 'cms-admin-actions cms-admin-static-rail-secondary-actions' });
  technicalActions.appendChild(renderDrawerTrigger('Quản lý bản nháp', 'drafts', handlers));
  technicalActions.appendChild(renderDrawerTrigger('Dành cho kỹ thuật', 'advanced', handlers));
  technical.appendChild(technicalActions);
  wrap.appendChild(primary);
  wrap.appendChild(technical);
  if (draftState.currentDraftId && !draftState.dirty && !draftState.isSavingDraft) {
    wrap.appendChild(renderContinueToPublishAction(handlers));
  }
  wrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Nút thêm, sửa, lưu và đặt lại vẫn nằm trong cột nội dung để giữ đúng hành vi hiện có.' }));
  wrap.appendChild(createElement('p', { className: 'cms-admin-help-text cms-admin-static-public-note', text: 'Lưu thay đổi sẽ lưu nội dung vào bản chuẩn bị. Website chỉ đổi ở màn Đưa website lên bản mới.' }));
  return wrap;
}

function renderContinueToPublishAction(handlers = {}) {
  const box = createElement('section', { className: 'cms-admin-static-next-step-box' });
  box.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Đã lưu trong bản chuẩn bị. Khi hoàn tất chỉnh sửa, mở màn Đưa website lên bản mới.',
  }));
  const button = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary cms-admin-button-small',
    type: 'button',
    text: 'Tiếp tục: Đưa website lên bản mới',
    attrs: { 'aria-label': 'Mở màn Đưa website lên bản mới' },
  });
  button.addEventListener('click', () => handlers.onOpenPublish?.());
  box.appendChild(button);
  return box;
}

function buildFeaturedChecklistModel(draftState = {}, featured = {}, selectedItem = null, selectedIndex = -1, validation = {}) {
  const itemErrors = selectedIndex >= 0 ? validation.itemErrors?.[selectedIndex] || {} : {};
  const hasSelected = Boolean(selectedItem);
  const hasImage = Boolean(String(selectedItem?.imageUrl || '').trim());
  const hasLink = Boolean(String(selectedItem?.room || '').trim() || String(selectedItem?.artworkId || selectedItem?.id || '').trim());
  return [
    {
      label: 'Nguồn dữ liệu',
      status: 'Tác phẩm tiêu biểu trên Trang chủ',
      state: 'pass',
      detail: 'Không phải danh sách đầy đủ trong phòng 3D.',
    },
    {
      label: 'Đã chọn mục',
      status: hasSelected ? 'Có' : 'Chưa',
      state: hasSelected ? 'pass' : 'warning',
      detail: hasSelected ? 'Cột trái đang hiển thị mục đã chọn.' : 'Chọn hoặc thêm một tác phẩm tiêu biểu.',
    },
    {
      label: 'Tên hiển thị',
      status: hasSelected && !itemErrors.title ? 'Đạt' : 'Cần kiểm tra',
      state: hasSelected && !itemErrors.title ? 'pass' : 'warning',
      detail: 'Tên dùng trên khu Tác phẩm tiêu biểu.',
    },
    {
      label: 'Ảnh đại diện',
      status: hasImage && !itemErrors.imageUrl ? 'Đạt' : 'Cần kiểm tra',
      state: hasImage && !itemErrors.imageUrl ? 'pass' : 'warning',
      detail: 'Ảnh đại diện phải thuộc nguồn media được phép.',
    },
    {
      label: 'Liên kết phòng/tác phẩm',
      status: hasLink ? 'Đạt' : 'Cần kiểm tra',
      state: hasLink ? 'pass' : 'warning',
      detail: 'Liên kết giúp người xem mở đúng không gian hoặc tác phẩm.',
    },
    {
      label: 'Không nhầm với danh sách phòng',
      status: 'Đã ghi rõ',
      state: 'pass',
      detail: 'Khu vực này chỉ là nội dung nổi bật trên Trang chủ.',
    },
    {
      label: 'Có thay đổi chưa lưu',
      status: draftState.dirty ? 'Có' : 'Không',
      state: draftState.dirty ? 'warning' : 'pass',
      detail: draftState.dirty ? 'Hãy lưu thay đổi nếu muốn giữ nội dung trong bản chuẩn bị.' : 'Bản chuẩn bị chưa có thay đổi mới.',
    },
    {
      label: 'Kiểm tra dữ liệu',
      status: validation.valid === false ? 'Có lỗi' : validation.warnings?.length ? 'Có cảnh báo' : 'Đạt',
      state: validation.valid === false ? 'danger' : validation.warnings?.length ? 'warning' : 'pass',
      detail: validation.valid === false ? 'Cần sửa lỗi trước khi lưu thay đổi.' : 'Có thể lưu thay đổi khi cần.',
    },
    {
      label: 'Website đang hoạt động',
      status: 'Chưa đổi',
      state: 'neutral',
      detail: 'Chỉ đổi sau workflow công khai riêng.',
    },
  ];
}

function renderFeaturedOperatorIntro(featured = {}, validation = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-featured-operator-intro' });
  panel.appendChild(renderStaticPanelTitle('Tác phẩm tiêu biểu', featured.enabled === false ? 'Đang tắt' : 'Đang hiển thị'));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Tác phẩm tiêu biểu là nội dung nổi bật dùng ở Trang chủ, không phải danh sách đầy đủ trong phòng 3D.',
  }));
  const grid = createElement('div', { className: 'cms-admin-static-room-summary-grid cms-admin-featured-summary-grid' });
  grid.appendChild(renderInfoTile('Nguồn dữ liệu', 'Tác phẩm tiêu biểu trên Trang chủ'));
  grid.appendChild(renderInfoTile('Số mục', `${safeArray(featured.items).length}/${FEATURED_OPERATOR_MAX_ITEMS}`));
  grid.appendChild(renderInfoTile('Hiển thị', featured.enabled === false ? 'Đang tắt' : 'Đang bật'));
  grid.appendChild(renderInfoTile('Cần xem', validation.valid ? `${validation.warnings.length} cảnh báo` : `${validation.errors.length} lỗi`));
  panel.appendChild(grid);
  return panel;
}

function getSelectedFeaturedIndex(draftState = {}, featured = {}) {
  const items = safeArray(featured.items);
  if (!items.length) return -1;
  const index = Number(draftState.selectedFeaturedIndex ?? 0);
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(Math.floor(index), items.length - 1);
}

function renderFeaturedWorkspaceNavigator(draftState = {}, featured = {}, validation = {}, handlers = {}) {
  const pane = createElement('aside', { className: 'cms-admin-panel cms-admin-static-workspace-pane cms-admin-static-left-pane cms-admin-featured-navigator' });
  pane.appendChild(renderStaticPanelTitle('Danh sách tác phẩm tiêu biểu', `${safeArray(featured.items).length}/${FEATURED_OPERATOR_MAX_ITEMS}`));
  const add = createElement('button', { className: 'cms-admin-button cms-admin-button-primary cms-admin-button-small', type: 'button', text: 'Thêm tác phẩm' });
  add.disabled = safeArray(featured.items).length >= FEATURED_OPERATOR_MAX_ITEMS;
  add.addEventListener('click', () => {
    setStaticCmsFeaturedIndex(safeArray(featured.items).length);
    handleAddFeaturedItem(draftState, handlers);
  });
  pane.appendChild(add);
  pane.appendChild(renderBadge(featured.enabled === false ? 'Đang ẩn trên Trang chủ' : 'Đang hiển thị trên Trang chủ', featured.enabled === false ? 'warning' : 'success'));

  const list = createElement('div', { className: 'cms-admin-featured-nav-list' });
  const selectedIndex = getSelectedFeaturedIndex(draftState, featured);
  safeArray(featured.items).forEach((item, index) => {
    const errors = validation.itemErrors?.[index] || {};
    const button = createElement('button', {
      className: ['cms-admin-featured-nav-item', selectedIndex === index ? 'is-active' : '', Object.keys(errors).length ? 'has-error' : ''].filter(Boolean).join(' '),
      type: 'button',
    });
    button.appendChild(createElement('strong', { text: item.title || item.id || `Tác phẩm ${index + 1}` }));
    button.appendChild(createElement('small', { text: item.isVisible === false ? 'Đang ẩn' : 'Đang hiển thị' }));
    if (!String(item.imageUrl || '').trim()) button.appendChild(renderBadge('Thiếu ảnh', 'warning'));
    button.addEventListener('click', () => {
      setStaticCmsFeaturedIndex(index);
      handlers.onRerender?.();
    });
    list.appendChild(button);
  });
  if (!safeArray(featured.items).length) list.appendChild(renderEmptyState('Chưa có tác phẩm tiêu biểu.'));
  pane.appendChild(list);
  return pane;
}

function renderFeaturedWorkspaceEditor(draftState = {}, featured = {}, validation = {}, handlers = {}) {
  const pane = createElement('section', { className: 'cms-admin-panel cms-admin-static-workspace-pane cms-admin-static-editor-pane cms-admin-featured-editor-pane' });
  pane.appendChild(renderStaticPanelTitle('Sửa tác phẩm tiêu biểu', validation.valid ? 'Nội dung hợp lệ' : 'Cần kiểm tra'));
  pane.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Sửa nội dung hiển thị ở khu Tác phẩm tiêu biểu trên Trang chủ.' }));
  if (draftState.featuredOperatorStatus) {
    pane.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: draftState.featuredOperatorStatus }));
  }
  if (draftState.featuredOperatorError) {
    pane.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-error', text: normalizeErrorMessage(draftState.featuredOperatorError) }));
  }
  pane.appendChild(renderFeaturedSectionSettings(draftState, featured, handlers));
  const selectedIndex = getSelectedFeaturedIndex(draftState, featured);
  const selectedItem = selectedIndex >= 0 ? featured.items[selectedIndex] : null;
  if (!selectedItem) {
    pane.appendChild(renderFeaturedEditActionBlock(draftState, handlers));
    pane.appendChild(renderEmptyState('Chọn hoặc thêm một tác phẩm tiêu biểu để chỉnh sửa.'));
    return pane;
  }
  pane.appendChild(renderFeaturedItemEditor(draftState, selectedItem, selectedIndex, featured.items.length, validation, handlers));
  pane.appendChild(renderFeaturedEditActionBlock(draftState, handlers));
  return pane;
}

function renderFeaturedSelectedItemPreview(item = null, selectedIndex = -1, validation = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-featured-selected-preview' });
  panel.appendChild(renderStaticPanelTitle('Xem trước mục đang chọn', item ? `Mục ${selectedIndex + 1}` : 'Chưa chọn'));
  if (!item) {
    panel.appendChild(renderEmptyState('Chọn một tác phẩm tiêu biểu trong danh sách để xem trước chi tiết.'));
    return panel;
  }

  const errors = validation.itemErrors?.[selectedIndex] || {};
  const body = createElement('div', { className: 'cms-admin-featured-selected-preview-body' });
  body.appendChild(renderFeaturedPreviewMedia(item));

  const copy = createElement('div', { className: 'cms-admin-featured-selected-preview-copy' });
  const titleRow = createElement('div', { className: 'cms-admin-featured-selected-preview-title-row' });
  titleRow.appendChild(createElement('h3', { text: item.title || item.id || 'Chưa có tiêu đề' }));
  titleRow.appendChild(renderBadge(item.isVisible === false ? 'Đang ẩn' : 'Đang hiển thị', item.isVisible === false ? 'warning' : 'success'));
  appendChildren(copy, [titleRow]);

  if (item.description) {
    copy.appendChild(createElement('p', { className: 'cms-admin-featured-selected-preview-description', text: item.description }));
  } else {
    copy.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Chưa có mô tả ngắn cho mục này.' }));
  }

  const meta = createElement('div', { className: 'cms-admin-featured-selected-meta' });
  meta.appendChild(renderStatusChip('Phòng', item.room === 'outdoor' ? 'Ngoài trời' : item.room === 'indoor' ? 'Trong nhà' : 'Chưa liên kết'));
  meta.appendChild(renderStatusChip('Mã tác phẩm', item.artworkId || item.id || '—'));
  meta.appendChild(renderStatusChip('Thứ tự', Number.isFinite(Number(item.sortOrder)) ? String(item.sortOrder) : String(selectedIndex + 1)));
  meta.appendChild(renderStatusChip('Ảnh', String(item.imageUrl || '').trim() ? 'Có ảnh' : 'Thiếu ảnh', String(item.imageUrl || '').trim() ? 'success' : 'warning'));
  copy.appendChild(meta);

  if (Object.keys(errors).length) {
    const warnings = createElement('ul', { className: 'cms-admin-static-message-list cms-admin-featured-selected-warnings' });
    Object.values(errors).slice(0, 6).forEach((message) => warnings.appendChild(createElement('li', { text: message })));
    copy.appendChild(warnings);
  }

  body.appendChild(copy);
  panel.appendChild(body);
  return panel;
}

function renderFeaturedPreviewMedia(item = {}) {
  const media = createElement('div', { className: 'cms-admin-featured-selected-preview-media' });
  const imageUrl = String(item.imageUrl || '').trim();
  if (imageUrl && validateStaticCmsMediaUrl(imageUrl, STATIC_CMS_DRAFT_CONFIG).valid) {
    const image = createElement('img', {
      attrs: { src: imageUrl, alt: item.alt || item.title || '', loading: 'lazy' },
    });
    image.addEventListener('error', () => {
      image.hidden = true;
      media.classList.add('has-error');
      media.appendChild(createElement('span', { text: 'Không tải được ảnh' }));
    }, { once: true });
    media.appendChild(image);
    return media;
  }
  media.classList.add('has-error');
  media.appendChild(createElement('span', { text: 'Thiếu ảnh hợp lệ' }));
  return media;
}

function renderFeaturedSecondaryDetails(featured = {}, validation = {}) {
  const wrap = createElement('div', { className: 'cms-admin-featured-secondary-stack' });
  const previewDetails = createElement('details', { className: 'cms-admin-static-technical-details cms-admin-featured-home-preview-details' });
  previewDetails.appendChild(createElement('summary', { text: 'Xem trước toàn bộ khu Tác phẩm tiêu biểu trên Trang chủ' }));
  previewDetails.appendChild(renderFeaturedPreview(featured, validation));
  wrap.appendChild(previewDetails);
  wrap.appendChild(renderFeaturedTechnicalDetails(featured));
  return wrap;
}

function renderFeaturedWorkspaceInspector(featured = {}, validation = {}) {
  const pane = createElement('aside', { className: 'cms-admin-static-workspace-pane cms-admin-static-inspector-pane cms-admin-featured-inspector' });
  const head = createElement('section', { className: 'cms-admin-panel cms-admin-featured-friendly-status' });
  head.appendChild(renderStaticPanelTitle('Xem trước Trang chủ', validation.valid ? 'Sẵn sàng' : 'Cần sửa'));
  head.appendChild(createElement('p', { className: 'cms-admin-help-text', text: validation.valid ? 'Nội dung tiêu biểu hợp lệ. Hãy lưu thay đổi trước khi công khai.' : 'Có mục thiếu thông tin cần kiểm tra.' }));
  pane.appendChild(head);
  pane.appendChild(renderFeaturedPreview(featured, validation));
  pane.appendChild(renderFeaturedValidationSummary(validation));
  pane.appendChild(renderFeaturedTechnicalDetails(featured));
  return pane;
}

function renderFeaturedEditActionBlock(draftState = {}, handlers = {}) {
  const block = createElement('section', { className: 'cms-admin-static-room-action-block cms-admin-featured-action-block' });
  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-static-room-action-row cms-admin-featured-action-row' });
  const cancelButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost',
    type: 'button',
    text: 'Hủy',
    title: 'Hủy thay đổi chưa lưu trong bản nháp Tác phẩm tiêu biểu',
  });
  cancelButton.disabled = Boolean(draftState.isSavingDraft || !draftState.dirty);
  cancelButton.addEventListener('click', () => {
    if (!draftState.dirty) return;
    const confirmed = globalThis.confirm?.('Hủy các thay đổi chưa lưu trong bản nháp Tác phẩm tiêu biểu?');
    if (!confirmed) return;
    resetStaticCmsDraftToBaseline(validateStaticCmsDraft(draftState.baselineJson || {}, STATIC_CMS_DRAFT_CONFIG));
    handlers.onRerender?.();
  });

  const resetButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    type: 'button',
    text: 'Đặt lại thay đổi',
    title: 'Đặt lại bản nháp về nội dung đang công khai/baseline đang mở',
  });
  resetButton.disabled = Boolean(draftState.isSavingDraft || !draftState.dirty);
  resetButton.addEventListener('click', () => {
    if (!draftState.dirty) return;
    const confirmed = globalThis.confirm?.('Đặt lại toàn bộ thay đổi chưa lưu về baseline đang mở?');
    if (!confirmed) return;
    resetStaticCmsDraftToBaseline(validateStaticCmsDraft(draftState.baselineJson || {}, STATIC_CMS_DRAFT_CONFIG));
    handlers.onRerender?.();
  });

  const saveButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    type: 'button',
    text: draftState.isSavingDraft ? 'Đang lưu...' : 'Lưu thay đổi',
    title: draftState.currentDraftId ? 'Lưu thay đổi vào bản chuẩn bị hiện tại.' : 'Lưu nội dung đang sửa thành bản chuẩn bị.',
  });
  saveButton.disabled = Boolean(draftState.isSavingDraft || !draftState.draftJson || !draftState.validation?.valid);
  saveButton.addEventListener('click', () => handleSaveStaticCmsDraft({ handlers }));

  appendChildren(actions, [cancelButton, resetButton, saveButton]);
  block.appendChild(actions);
  block.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: draftState.dirty ? 'Có thay đổi chưa lưu. Lưu thay đổi sẽ cập nhật bản chuẩn bị; website đang hoạt động chưa thay đổi.' : 'Chưa có thay đổi để lưu.',
  }));
  return block;
}

function renderInfoTile(label, value, technical = false) {
  const tile = createElement('div', {
    className: ['cms-admin-info-tile', technical ? 'is-technical' : ''].filter(Boolean).join(' '),
  });
  tile.appendChild(createElement('span', { className: 'cms-admin-info-label', text: label || '' }));
  tile.appendChild(createElement('span', {
    className: ['cms-admin-info-value', technical ? 'cms-admin-mono' : ''].filter(Boolean).join(' '),
    text: toDisplayText(value),
  }));
  return tile;
}

function renderPrimaryOperatorActions(draftState = {}, appState = {}, handlers = {}) {
  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-static-primary-actions' });
  const saveButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    type: 'button',
    text: draftState.isSavingDraft ? 'Đang lưu...' : 'Lưu thay đổi',
    title: draftState.currentDraftId ? 'Lưu thay đổi vào bản chuẩn bị hiện tại.' : 'Lưu nội dung đang sửa thành bản chuẩn bị.',
  });
  saveButton.disabled = Boolean(draftState.isSavingDraft || !draftState.draftJson || !draftState.validation?.valid);
  saveButton.addEventListener('click', () => handleSaveStaticCmsDraft({ handlers }));
  actions.appendChild(saveButton);
  return actions;
}

function renderStatusChip(label, value, variant = 'default') {
  const chip = createElement('div', {
    className: ['cms-admin-static-status-chip', variant !== 'default' ? `cms-admin-static-status-chip-${variant}` : ''].filter(Boolean).join(' '),
  });
  chip.appendChild(createElement('span', { text: label }));
  chip.appendChild(createElement('strong', { text: toDisplayText(value) }));
  return chip;
}

function shortenUrl(url = '') {
  const text = String(url || '').trim();
  if (!text || text.length <= 74) return text || '—';
  return `${text.slice(0, 42)}…${text.slice(-26)}`;
}

function renderStaticPanelTitle(title, meta = '') {
  const wrap = createElement('div', { className: 'cms-admin-panel-title-row cms-admin-static-panel-title-row' });
  wrap.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: title }));
  if (meta) wrap.appendChild(renderBadge(meta, meta === 'PASS' || meta === 'Sạch' ? 'success' : 'warning'));
  return wrap;
}

function renderFeaturedSectionSettings(draftState = {}, featured = {}, handlers = {}) {
  const section = createElement('section', { className: 'cms-admin-featured-settings' });
  section.appendChild(renderStaticPanelTitle('Thiết lập khu vực', featured.enabled ? 'Đang hiển thị' : 'Đang tắt'));
  const grid = createElement('div', { className: 'cms-admin-featured-settings-grid' });

  const enabledLabel = createElement('label', { className: 'cms-admin-featured-toggle' });
  const enabled = createElement('input', { type: 'checkbox', attrs: { id: 'cms-admin-featured-enabled', name: 'featuredEnabled' } });
  enabled.checked = featured.enabled !== false;
  enabled.addEventListener('change', () => commitFeaturedDraftChange(draftState, (next) => {
    next.enabled = enabled.checked;
  }, handlers, enabled.checked ? 'Đã bật khu vực Tác phẩm tiêu biểu trong bản nháp.' : 'Đã tắt khu vực Tác phẩm tiêu biểu trong bản nháp.'));
  enabledLabel.appendChild(enabled);
  const enabledText = createElement('span');
  enabledText.appendChild(createElement('strong', { text: 'Hiển thị trên trang chủ' }));
  enabledText.appendChild(createElement('small', { className: 'cms-admin-help-text', text: 'Tắt công tắc để giữ dữ liệu nhưng không hiển thị khu vực này trên Trang chủ.' }));
  enabledLabel.appendChild(enabledText);

  const titleField = renderFeaturedTextControl({
    label: 'Tiêu đề khu vực',
    value: featured.title,
    placeholder: 'Tác phẩm tiêu biểu',
    controlId: 'cms-admin-featured-section-title',
    controlName: 'featuredSectionTitle',
    onChange: (value) => commitFeaturedDraftChange(draftState, (next) => { next.title = value; }, handlers),
  });
  const leadField = renderFeaturedTextControl({
    label: 'Mô tả khu vực',
    value: featured.lead,
    placeholder: 'Giới thiệu ngắn về các tác phẩm được tuyển chọn',
    multiline: true,
    controlId: 'cms-admin-featured-section-lead',
    controlName: 'featuredSectionLead',
    onChange: (value) => commitFeaturedDraftChange(draftState, (next) => {
      next.lead = value;
      if (Object.prototype.hasOwnProperty.call(next, 'description')) next.description = value;
    }, handlers),
  });

  appendChildren(grid, [enabledLabel, titleField, leadField]);
  section.appendChild(grid);
  return section;
}

function renderFeaturedItemEditor(draftState = {}, item = {}, sourceIndex = 0, itemCount = 0, validation = {}, handlers = {}) {
  const itemErrors = validation.itemErrors?.[sourceIndex] || {};
  const card = createElement('article', {
    className: ['cms-admin-featured-item-editor', item.isVisible === false ? 'is-hidden' : '', Object.keys(itemErrors).length ? 'has-error' : ''].filter(Boolean).join(' '),
  });
  const head = createElement('div', { className: 'cms-admin-featured-item-head' });
  const identity = createElement('div', { className: 'cms-admin-featured-item-identity' });
  identity.appendChild(createElement('strong', { text: `${sourceIndex + 1}. ${item.title || item.id || 'Tác phẩm mới'}` }));
  identity.appendChild(createElement('small', { className: 'cms-admin-help-text', text: item.id || 'Chưa có ID' }));
  const badges = createElement('div', { className: 'cms-admin-featured-item-badges' });
  badges.appendChild(renderBadge(item.isVisible === false ? 'Đang ẩn' : 'Đang hiển thị', item.isVisible === false ? 'warning' : 'success'));
  if (!String(item.imageUrl || '').trim()) badges.appendChild(renderBadge('Thiếu ảnh', 'danger'));
  appendChildren(head, [identity, badges]);
  card.appendChild(head);

  const grid = createElement('div', { className: 'cms-admin-featured-item-grid' });
  grid.appendChild(renderFeaturedTextControl({
    label: 'ID',
    value: item.id,
    required: true,
    error: itemErrors.id,
    placeholder: 'featured_local_001',
    controlId: getFeaturedControlAttrs(sourceIndex, 'id', item).id,
    controlName: getFeaturedControlAttrs(sourceIndex, 'id', item).name,
    onChange: (value) => handleFeaturedItemFieldChange(draftState, sourceIndex, 'id', value, handlers),
  }));
  grid.appendChild(renderFeaturedTextControl({
    label: 'Tiêu đề',
    value: item.title,
    required: item.isVisible !== false,
    error: itemErrors.title,
    placeholder: 'Tên tác phẩm',
    controlId: getFeaturedControlAttrs(sourceIndex, 'title', item).id,
    controlName: getFeaturedControlAttrs(sourceIndex, 'title', item).name,
    onChange: (value) => handleFeaturedItemFieldChange(draftState, sourceIndex, 'title', value, handlers),
  }));
  grid.appendChild(renderFeaturedTextControl({
    label: 'Mô tả ngắn',
    value: item.description,
    error: itemErrors.description,
    multiline: true,
    placeholder: 'Thông tin ngắn hiển thị cùng tác phẩm',
    controlId: getFeaturedControlAttrs(sourceIndex, 'description', item).id,
    controlName: getFeaturedControlAttrs(sourceIndex, 'description', item).name,
    onChange: (value) => handleFeaturedItemFieldChange(draftState, sourceIndex, 'description', value, handlers),
  }));
  grid.appendChild(renderFeaturedImageControl({
    item,
    sourceIndex,
    required: item.isVisible !== false,
    error: itemErrors.imageUrl,
    onChange: (value) => handleFeaturedItemFieldChange(draftState, sourceIndex, 'imageUrl', value, handlers),
    onReplace: () => handleOpenFeaturedImageReplace(item, sourceIndex, handlers),
    onLibrary: () => handleOpenFeaturedMediaLibraryPicker(item, sourceIndex, handlers),
  }));
  grid.appendChild(renderFeaturedTextControl({
    label: 'Alt text',
    value: item.alt,
    error: itemErrors.alt,
    placeholder: 'Mô tả ảnh dành cho trợ năng',
    hint: !String(item.alt || '').trim() ? 'Có thể để trống; Index sẽ dùng tiêu đề làm nội dung thay thế.' : '',
    controlId: getFeaturedControlAttrs(sourceIndex, 'alt', item).id,
    controlName: getFeaturedControlAttrs(sourceIndex, 'alt', item).name,
    onChange: (value) => handleFeaturedItemFieldChange(draftState, sourceIndex, 'alt', value, handlers),
  }));
  grid.appendChild(renderFeaturedNumberControl({
    label: 'Thứ tự',
    value: item.sortOrder,
    error: itemErrors.sortOrder,
    controlId: getFeaturedControlAttrs(sourceIndex, 'sortOrder', item).id,
    controlName: getFeaturedControlAttrs(sourceIndex, 'sortOrder', item).name,
    onChange: (value) => handleFeaturedItemFieldChange(draftState, sourceIndex, 'sortOrder', value, handlers),
  }));
  grid.appendChild(renderFeaturedRoomControl(item.room, itemErrors.room, (value) => handleFeaturedItemFieldChange(draftState, sourceIndex, 'room', value, handlers), getFeaturedControlAttrs(sourceIndex, 'room', item)));
  grid.appendChild(renderFeaturedTextControl({
    label: 'Mã tác phẩm trong phòng 3D',
    value: item.artworkId,
    error: itemErrors.artworkId,
    placeholder: 'ART_001 (không bắt buộc)',
    hint: 'Chỉ tạo liên kết đến object đã tồn tại; không tạo object 3D mới.',
    controlId: getFeaturedControlAttrs(sourceIndex, 'artworkId', item).id,
    controlName: getFeaturedControlAttrs(sourceIndex, 'artworkId', item).name,
    onChange: (value) => handleFeaturedItemFieldChange(draftState, sourceIndex, 'artworkId', value, handlers),
  }));
  grid.appendChild(renderFeaturedTextControl({
    label: 'Nhãn nút liên kết',
    value: item.ctaLabel,
    error: itemErrors.ctaLabel,
    placeholder: 'Xem trong không gian 3D',
    controlId: getFeaturedControlAttrs(sourceIndex, 'ctaLabel', item).id,
    controlName: getFeaturedControlAttrs(sourceIndex, 'ctaLabel', item).name,
    onChange: (value) => handleFeaturedItemFieldChange(draftState, sourceIndex, 'ctaLabel', value, handlers),
  }));

  const visibleField = createElement('label', { className: 'cms-admin-featured-toggle cms-admin-featured-item-visible' });
  const visible = createElement('input', { type: 'checkbox', attrs: { id: getFeaturedControlAttrs(sourceIndex, 'visible', item).id, name: getFeaturedControlAttrs(sourceIndex, 'visible', item).name } });
  visible.checked = item.isVisible !== false;
  visible.addEventListener('change', () => handleFeaturedItemFieldChange(draftState, sourceIndex, 'isVisible', visible.checked, handlers));
  const visibleText = createElement('span');
  visibleText.appendChild(createElement('strong', { text: 'Hiển thị mục này' }));
  visibleText.appendChild(createElement('small', { className: 'cms-admin-help-text', text: visible.checked ? 'Mục này đang hiển thị.' : 'Mục này đang tắt hiển thị.' }));
  visibleField.appendChild(visible);
  visibleField.appendChild(visibleText);
  grid.appendChild(visibleField);
  card.appendChild(grid);

  if (featuredImageReplaceState.itemKey === getFeaturedImageReplaceKey(item, sourceIndex)) {
    card.appendChild(renderFeaturedImageReplacePanel(draftState, item, sourceIndex, handlers));
  }

  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-featured-item-actions' });
  const up = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-small', type: 'button', text: 'Lên' });
  up.disabled = sourceIndex === 0;
  up.addEventListener('click', () => handleMoveFeaturedItem(draftState, sourceIndex, -1, handlers));
  const down = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-small', type: 'button', text: 'Xuống' });
  down.disabled = sourceIndex >= itemCount - 1;
  down.addEventListener('click', () => handleMoveFeaturedItem(draftState, sourceIndex, 1, handlers));
  const toggle = createElement('button', { className: 'cms-admin-button cms-admin-button-secondary cms-admin-button-small', type: 'button', text: item.isVisible === false ? 'Hiện' : 'Ẩn' });
  toggle.addEventListener('click', () => handleFeaturedItemFieldChange(draftState, sourceIndex, 'isVisible', item.isVisible === false, handlers));
  const remove = createElement('button', { className: 'cms-admin-button cms-admin-button-danger cms-admin-button-small', type: 'button', text: 'Gỡ khỏi tiêu biểu' });
  remove.addEventListener('click', () => handleRemoveFeaturedItem(draftState, sourceIndex, handlers));
  appendChildren(actions, [up, down, toggle, remove]);
  card.appendChild(actions);
  return card;
}

function renderFeaturedTextControl({ label, value = '', required = false, error = '', hint = '', placeholder = '', multiline = false, controlId = '', controlName = '', onChange } = {}) {
  const wrap = createElement('label', { className: ['cms-admin-field', 'cms-admin-featured-field', multiline ? 'cms-admin-featured-field-wide' : ''].filter(Boolean).join(' ') });
  const labelNode = createElement('span', { className: 'cms-admin-static-field-label' });
  labelNode.appendChild(createElement('span', { text: label || '' }));
  if (required) labelNode.appendChild(renderBadge('Bắt buộc', 'warning'));
  wrap.appendChild(labelNode);
  const control = createElement(multiline ? 'textarea' : 'input', {
    className: ['cms-admin-input', error ? 'is-invalid' : ''].filter(Boolean).join(' '),
    value: String(value ?? ''),
    placeholder,
    attrs: { id: controlId || undefined, name: controlName || controlId || undefined, rows: multiline ? '3' : undefined, autocomplete: 'off' },
  });
  control.addEventListener('change', () => onChange?.(control.value));
  wrap.appendChild(control);
  if (error) wrap.appendChild(createElement('small', { className: 'cms-admin-help-text cms-admin-danger-text', text: error }));
  else if (hint) wrap.appendChild(createElement('small', { className: 'cms-admin-help-text', text: hint }));
  return wrap;
}

function renderFeaturedNumberControl({ label, value = 0, error = '', controlId = '', controlName = '', onChange } = {}) {
  const wrap = createElement('label', { className: 'cms-admin-field cms-admin-featured-field' });
  wrap.appendChild(createElement('span', { className: 'cms-admin-static-field-label', text: label || '' }));
  const control = createElement('input', {
    className: ['cms-admin-input', error ? 'is-invalid' : ''].filter(Boolean).join(' '),
    type: 'number',
    value: Number.isFinite(Number(value)) ? String(value) : '0',
    attrs: { id: controlId || undefined, name: controlName || controlId || undefined, min: '0', step: '1' },
  });
  control.addEventListener('change', () => onChange?.(Number.isFinite(Number(control.value)) ? Number(control.value) : 0));
  wrap.appendChild(control);
  if (error) wrap.appendChild(createElement('small', { className: 'cms-admin-help-text cms-admin-danger-text', text: error }));
  return wrap;
}

function renderFeaturedRoomControl(value = '', error = '', onChange, attrs = {}) {
  const wrap = createElement('label', { className: 'cms-admin-field cms-admin-featured-field' });
  wrap.appendChild(createElement('span', { className: 'cms-admin-static-field-label', text: 'Liên kết đến không gian 3D' }));
  const select = createElement('select', { className: ['cms-admin-select', error ? 'is-invalid' : ''].filter(Boolean).join(' '), attrs });
  FEATURED_OPERATOR_ROOM_OPTIONS.forEach((option) => select.appendChild(createElement('option', { value: option.value, text: option.label })));
  select.value = ['indoor', 'outdoor'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : '';
  select.addEventListener('change', () => onChange?.(select.value));
  wrap.appendChild(select);
  if (error) wrap.appendChild(createElement('small', { className: 'cms-admin-help-text cms-admin-danger-text', text: error }));
  return wrap;
}

function renderFeaturedImageControl({ item = {}, sourceIndex = 0, required = false, error = '', onChange, onReplace, onLibrary } = {}) {
  const wrap = createElement('div', { className: 'cms-admin-featured-image-control' });
  wrap.appendChild(renderFeaturedTextControl({
    label: 'Đường dẫn ảnh / URL ảnh đã có',
    value: item.imageUrl,
    required,
    error,
    placeholder: './assets/... hoặc https://...',
    controlId: getFeaturedControlAttrs(sourceIndex, 'imageUrl', item).id,
    controlName: getFeaturedControlAttrs(sourceIndex, 'imageUrl', item).name,
    hint: !String(item.imageUrl || '').trim()
      ? 'Mục này đang thiếu ảnh nên có thể không hiển thị đúng trên trang chủ.'
      : 'Bạn có thể bấm “Thay ảnh” để đổi ảnh cho tác phẩm này. Thao tác này chỉ cập nhật bản nháp, chưa công khai website.',
    onChange,
  }));
  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-featured-image-actions' });
  const replaceButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary cms-admin-button-small',
    type: 'button',
    text: 'Thay ảnh',
    attrs: { 'aria-expanded': featuredImageReplaceState.itemKey === getFeaturedImageReplaceKey(item, sourceIndex) ? 'true' : 'false' },
  });
  replaceButton.addEventListener('click', () => onReplace?.());
  const libraryButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary cms-admin-button-small',
    type: 'button',
    text: 'Chọn ảnh từ thư viện',
    attrs: { 'aria-expanded': isFeaturedMediaLibraryPickerOpenForItem(item, sourceIndex) ? 'true' : 'false' },
  });
  libraryButton.addEventListener('click', () => onLibrary?.());
  appendChildren(actions, [replaceButton, libraryButton]);
  wrap.appendChild(actions);
  return wrap;
}

function renderFeaturedImageReplacePanel(draftState = {}, item = {}, sourceIndex = 0, handlers = {}) {
  const itemKey = getFeaturedImageReplaceKey(item, sourceIndex);
  const panel = createElement('section', { className: 'cms-admin-featured-image-replace-panel' });
  const header = createElement('div', { className: 'cms-admin-featured-image-replace-header' });
  const heading = createElement('div');
  heading.appendChild(createElement('h4', { text: 'Thay ảnh cho tác phẩm này' }));
  heading.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Chọn ảnh từ máy là cách khuyến nghị. Upload chỉ tạo media trong kho và chỉ gắn vào bản nháp sau khi bạn bấm “Dùng ảnh này”; website đang hoạt động chưa thay đổi cho đến khi lưu và công khai.',
  }));
  header.appendChild(heading);
  panel.appendChild(header);

  const currentGrid = createElement('div', { className: 'cms-admin-featured-image-current-grid' });
  currentGrid.appendChild(renderFeaturedImageReplaceMedia('Ảnh hiện tại', String(item.imageUrl || '').trim(), item.alt || item.title || ''));
  currentGrid.appendChild(renderFeaturedLocalUploadArea(draftState, item, sourceIndex, handlers));
  panel.appendChild(currentGrid);

  const libraryPicker = renderFeaturedMediaLibraryPicker(draftState, item, sourceIndex, handlers);
  if (libraryPicker) panel.appendChild(libraryPicker);

  panel.appendChild(renderFeaturedUrlReplaceArea(draftState, item, sourceIndex, handlers));
  panel.appendChild(createElement('div', {
    className: 'cms-admin-alert cms-admin-alert-warning',
    text: 'Upload hoặc thay URL không tự lưu và không tự công khai. Sau khi bấm “Dùng ảnh này”, hãy bấm “Lưu vào bản nháp”, rồi dùng quy trình công khai hiện có để cập nhật website đang hoạt động.',
  }));
  return panel;
}

function renderFeaturedLocalUploadArea(draftState = {}, item = {}, sourceIndex = 0, handlers = {}) {
  const itemKey = getFeaturedImageReplaceKey(item, sourceIndex);
  const wrap = createElement('section', { className: 'cms-admin-featured-local-upload' });
  const title = createElement('div', { className: 'cms-admin-featured-upload-title' });
  title.appendChild(createElement('strong', { text: 'Chọn ảnh từ máy' }));
  title.appendChild(renderBadge('Khuyến nghị', 'success'));
  wrap.appendChild(title);
  wrap.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: `Ảnh JPG, PNG hoặc WebP; tối đa ${formatUploadSizeLimit('image')}. Upload đi qua cổng máy chủ an toàn; sau upload vẫn cần bấm “Dùng ảnh này” và lưu thay đổi.`,
  }));

  const hasDraftId = Boolean(String(draftState.currentDraftId || '').trim());
  if (!hasDraftId) {
    wrap.appendChild(createElement('div', {
      className: 'cms-admin-alert cms-admin-alert-warning',
      text: 'Hãy lưu nội dung hiện tại thành bản nháp trước khi tải ảnh từ máy.',
    }));
  }

  const fileField = createElement('label', { className: 'cms-admin-featured-file-picker' });
  fileField.appendChild(createElement('span', { text: 'Chọn ảnh từ máy' }));
  const fileInput = createElement('input', {
    type: 'file',
    attrs: {
      id: `cms-admin-featured-image-file-${makeCmsControlIdToken(itemKey, `item-${sourceIndex}`)}`,
      name: `featuredImageFile-${sourceIndex}`,
      accept: getUploadAccept('image'),
      'aria-label': 'Chọn ảnh từ máy cho Tác phẩm tiêu biểu',
    },
  });
  fileInput.disabled = !hasDraftId || featuredImageReplaceState.localStatus === 'uploading';
  fileInput.addEventListener('change', () => handleSelectFeaturedLocalImage(item, sourceIndex, fileInput.files?.[0] || null, handlers));
  fileField.appendChild(fileInput);
  wrap.appendChild(fileField);

  if (featuredImageReplaceState.localFile) {
    const file = featuredImageReplaceState.localFile;
    const meta = createElement('div', { className: 'cms-admin-featured-file-meta' });
    meta.appendChild(createElement('strong', { text: file.name || 'Ảnh đã chọn' }));
    meta.appendChild(createElement('span', { text: `${formatFileBytes(file.size)} · ${file.type || 'không rõ loại'}` }));
    wrap.appendChild(meta);
  } else {
    wrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Chưa chọn ảnh.' }));
  }

  if (featuredImageReplaceState.localPreviewUrl) {
    const localPreview = createElement('div', { className: 'cms-admin-featured-local-preview' });
    localPreview.appendChild(createElement('strong', { text: 'Xem trước trên máy' }));
    const frame = createElement('div', { className: 'cms-admin-featured-image-replace-frame' });
    const image = createElement('img', {
      attrs: { src: featuredImageReplaceState.localPreviewUrl, alt: item.alt || item.title || 'Ảnh đang chọn' },
    });
    image.addEventListener('error', () => {
      image.hidden = true;
      frame.classList.add('has-error');
      frame.appendChild(createElement('span', { text: 'Không xem trước được file ảnh này' }));
    }, { once: true });
    frame.appendChild(image);
    localPreview.appendChild(frame);
    wrap.appendChild(localPreview);
  }

  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-featured-image-replace-actions' });
  const uploadButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary cms-admin-button-small',
    type: 'button',
    text: featuredImageReplaceState.localStatus === 'uploading' ? 'Đang tải ảnh lên...' : 'Tải ảnh lên',
    attrs: { 'aria-label': 'Tải ảnh lên kho media cho bản nháp Tác phẩm tiêu biểu' },
  });
  uploadButton.disabled = !hasDraftId || !featuredImageReplaceState.localFile || featuredImageReplaceState.localStatus === 'uploading';
  uploadButton.addEventListener('click', () => handleUploadFeaturedLocalImage(draftState, item, sourceIndex, handlers));

  const useButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary cms-admin-button-small',
    type: 'button',
    text: 'Dùng ảnh này',
    attrs: { 'aria-label': 'Gắn ảnh đã upload vào bản nháp Tác phẩm tiêu biểu' },
  });
  useButton.disabled = !featuredImageReplaceState.uploadedUrl || featuredImageReplaceState.uploadedPreviewStatus !== 'success';
  useButton.addEventListener('click', () => handleUseFeaturedUploadedImage(draftState, item, sourceIndex, handlers));

  const cancelButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-small',
    type: 'button',
    text: 'Hủy',
  });
  cancelButton.addEventListener('click', () => handleCancelFeaturedImageReplace(handlers));
  appendChildren(actions, [uploadButton, useButton, cancelButton]);
  wrap.appendChild(actions);

  if (featuredImageReplaceState.localStatus === 'selected') {
    wrap.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-info', text: 'Đã chọn ảnh, chưa tải lên.' }));
  }
  if (featuredImageReplaceState.localStatus === 'uploading') {
    wrap.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-info', text: 'Đang tải ảnh lên qua cổng máy chủ an toàn...' }));
  }
  if (featuredImageReplaceState.localError) {
    wrap.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-error', text: featuredImageReplaceState.localError }));
  }
  if (featuredImageReplaceState.uploadedUrl) {
    wrap.appendChild(createElement('div', {
      className: 'cms-admin-alert cms-admin-alert-success',
      text: 'Tải ảnh thành công. Hãy bấm “Dùng ảnh này” để gắn ảnh vào tác phẩm.',
    }));
    wrap.appendChild(renderFeaturedUploadedImagePreview(itemKey, featuredImageReplaceState.uploadedUrl, item.alt || item.title || '', handlers));
  }
  return wrap;
}

function renderFeaturedUrlReplaceArea(draftState = {}, item = {}, sourceIndex = 0, handlers = {}) {
  const itemKey = getFeaturedImageReplaceKey(item, sourceIndex);
  const details = createElement('details', { className: 'cms-admin-featured-url-replace' });
  details.open = featuredImageReplaceState.mode === 'url';
  details.appendChild(createElement('summary', { text: 'Dùng URL/path có sẵn (nâng cao)' }));
  const body = createElement('div', { className: 'cms-admin-featured-url-replace-body' });
  body.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Dành cho người dùng nâng cao hoặc ảnh đã có sẵn trên kho nội dung. URL/path phải thuộc nguồn media được phép.',
  }));
  const field = createElement('label', { className: 'cms-admin-field cms-admin-featured-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-static-field-label', text: 'Dán đường dẫn ảnh / URL ảnh mới' }));
  const input = createElement('input', {
    className: ['cms-admin-input', featuredImageReplaceState.error ? 'is-invalid' : ''].filter(Boolean).join(' '),
    value: featuredImageReplaceState.candidateUrl,
    placeholder: './assets/... hoặc https://...',
    attrs: {
      id: `cms-admin-featured-image-url-${makeCmsControlIdToken(itemKey, `item-${sourceIndex}`)}`,
      name: `featuredImageUrl-${sourceIndex}`,
      autocomplete: 'off',
    },
  });
  input.addEventListener('focus', () => { featuredImageReplaceState.mode = 'url'; });
  input.addEventListener('input', () => {
    featuredImageReplaceState.mode = 'url';
    featuredImageReplaceState.candidateUrl = input.value;
    if (input.value.trim() !== featuredImageReplaceState.previewUrl) {
      featuredImageReplaceState.previewUrl = '';
      featuredImageReplaceState.previewStatus = 'idle';
      featuredImageReplaceState.error = '';
    }
  });
  field.appendChild(input);
  body.appendChild(field);

  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-featured-image-replace-actions' });
  const previewButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary cms-admin-button-small',
    type: 'button',
    text: 'Xem thử ảnh',
  });
  previewButton.addEventListener('click', () => handlePreviewFeaturedImageCandidate(item, sourceIndex, input.value, handlers));
  const useButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary cms-admin-button-small',
    type: 'button',
    text: 'Dùng ảnh này',
    attrs: { 'aria-label': 'Gắn ảnh đã upload vào bản nháp Tác phẩm tiêu biểu' },
  });
  useButton.addEventListener('click', () => handleUseFeaturedImageCandidate(draftState, item, sourceIndex, input.value, handlers));
  const cancelButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-small',
    type: 'button',
    text: 'Hủy',
  });
  cancelButton.addEventListener('click', () => handleCancelFeaturedImageReplace(handlers));
  appendChildren(actions, [previewButton, useButton, cancelButton]);
  body.appendChild(actions);

  if (featuredImageReplaceState.error) {
    body.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-error', text: featuredImageReplaceState.error }));
  }
  if (featuredImageReplaceState.previewUrl) {
    body.appendChild(renderFeaturedImageCandidatePreview(itemKey, featuredImageReplaceState.previewUrl, item.alt || item.title || ''));
  } else {
    body.appendChild(createElement('div', {
      className: 'cms-admin-featured-image-preview-placeholder',
      text: 'Dán đường dẫn ảnh mới rồi bấm “Xem thử ảnh”.',
    }));
  }
  details.appendChild(body);
  return details;
}

function renderFeaturedMediaLibraryPicker(draftState = {}, item = {}, sourceIndex = 0, handlers = {}) {
  if (!isFeaturedMediaLibraryPickerOpenForItem(item, sourceIndex)) return null;

  const appState = getState();
  const sourceAssets = safeArray(appState.data?.cmsMediaUploads)
    .map(normalizeStaticPickerMediaAsset)
    .filter(isSelectableStaticPickerMediaAsset);
  const mediaError = appState.data?.errors?.cmsMediaUploads || null;
  const filteredAssets = sourceAssets.filter((asset) => matchesFeaturedPickerFilters(asset, featuredMediaLibraryPickerState));

  const panel = createElement('section', { className: 'cms-admin-static-media-picker-panel cms-admin-featured-library-picker-panel' });
  const header = createElement('div', { className: 'cms-admin-static-media-picker-header' });
  const heading = createElement('div');
  heading.appendChild(createElement('h5', { text: 'Chọn ảnh từ thư viện' }));
  heading.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Chọn media đã upload để gắn vào Tác phẩm tiêu biểu trong bản nháp hiện tại. Website đang hoạt động chưa thay đổi cho đến khi bạn lưu và công khai.',
  }));
  const closeButton = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-small', type: 'button', text: 'Đóng' });
  closeButton.addEventListener('click', () => closeFeaturedMediaLibraryPicker(handlers));
  appendChildren(header, [heading, closeButton]);
  panel.appendChild(header);

  panel.appendChild(renderFeaturedPickerContext(item, sourceIndex));

  if (mediaError) {
    panel.appendChild(renderErrorBox(mediaError, 'Không đọc được cms_media_uploads'));
    return panel;
  }

  if (!sourceAssets.length) {
    panel.appendChild(renderEmptyState('Chưa có media trong thư viện upload.'));
    return panel;
  }

  panel.appendChild(renderFeaturedPickerControls(handlers));

  if (featuredMediaLibraryPickerState.error) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-error', text: featuredMediaLibraryPickerState.error }));
  }

  if (!filteredAssets.length) {
    panel.appendChild(createElement('div', { className: 'cms-admin-media-filter-empty', text: 'Không có ảnh/video nào khớp bộ lọc hiện tại. Hãy đổi từ khóa hoặc loại media.' }));
    return panel;
  }

  const list = createElement('div', { className: 'cms-admin-static-media-picker-grid cms-admin-featured-library-picker-grid' });
  filteredAssets.forEach((asset) => {
    list.appendChild(renderFeaturedPickerMediaCard(asset, draftState, item, sourceIndex, handlers));
  });
  panel.appendChild(list);
  return panel;
}

function renderFeaturedPickerContext(item = {}, sourceIndex = 0) {
  const meta = createElement('div', { className: 'cms-admin-static-media-picker-context cms-admin-featured-library-picker-context' });
  meta.appendChild(renderInfoTile('Tác phẩm tiêu biểu', item.title || item.id || `Mục ${sourceIndex + 1}`));
  meta.appendChild(renderInfoTile('Trường ảnh', 'Ảnh đại diện'));
  meta.appendChild(renderInfoTile('Loại hợp lệ', 'Ảnh / Poster'));
  meta.appendChild(renderInfoTile('Trạng thái', 'Bản nháp trong CMS'));
  return meta;
}

function renderFeaturedPickerControls(handlers = {}) {
  const controls = createElement('div', { className: 'cms-admin-static-media-picker-controls cms-admin-featured-library-picker-controls' });

  const search = createElement('input', {
    className: 'cms-admin-input cms-admin-static-media-picker-search',
    value: featuredMediaLibraryPickerState.search,
    placeholder: 'Tìm theo tên file, đường dẫn, phòng, nội dung...',
    attrs: { type: 'search', autocomplete: 'off', 'aria-label': 'Tìm ảnh trong thư viện upload' },
  });
  search.addEventListener('input', () => {
    featuredMediaLibraryPickerState.search = search.value;
    handlers.onRerender?.();
  });

  const filter = createElement('select', {
    className: 'cms-admin-select cms-admin-static-media-picker-filter',
    attrs: { 'aria-label': 'Lọc loại media cho ảnh Tác phẩm tiêu biểu' },
  });
  [
    { value: 'compatible', label: 'Ảnh & poster phù hợp' },
    { value: 'image', label: 'Ảnh' },
    { value: 'poster', label: 'Poster' },
    { value: 'video', label: 'Video (không phù hợp)' },
    { value: 'all', label: 'Tất cả media' },
  ].forEach((option) => filter.appendChild(createElement('option', { value: option.value, text: option.label })));
  filter.value = ['compatible', 'all', 'image', 'poster', 'video'].includes(featuredMediaLibraryPickerState.mediaKindFilter)
    ? featuredMediaLibraryPickerState.mediaKindFilter
    : 'compatible';
  filter.addEventListener('change', () => {
    featuredMediaLibraryPickerState.mediaKindFilter = filter.value;
    handlers.onRerender?.();
  });

  appendChildren(controls, [search, filter]);
  return controls;
}

function renderFeaturedPickerMediaCard(asset = {}, draftState = {}, item = {}, sourceIndex = 0, handlers = {}) {
  const compatibility = getFeaturedPickerCompatibility(asset);
  const card = createElement('article', {
    className: [
      'cms-admin-static-media-picker-card',
      'cms-admin-featured-library-picker-card',
      asset.hasSafeUrl && compatibility.allowed ? 'is-selectable' : 'is-disabled',
    ].filter(Boolean).join(' '),
  });

  card.appendChild(renderFeaturedPickerMediaPreview(asset));

  const body = createElement('div', { className: 'cms-admin-static-media-picker-card-body' });
  const titleRow = createElement('div', { className: 'cms-admin-media-card-title-row' });
  titleRow.appendChild(createElement('h6', { text: asset.fileName || 'Ảnh/video' }));
  titleRow.appendChild(renderBadge(getMediaKindLabel(asset.mediaKind), asset.mediaKind === 'video' ? 'warning' : asset.mediaKind === 'unknown' ? 'default' : 'success'));
  body.appendChild(titleRow);

  const details = createElement('dl', { className: 'cms-admin-media-detail-list' });
  [
    ['Phòng/item/section', getPickerTargetText(asset)],
    ['Trường upload', asset.fieldName || 'Không có'],
    ['Dung lượng', formatFileBytes(asset.sizeBytes)],
    ['Ngày upload', asset.createdAt ? formatDateTime(asset.createdAt) : 'Không rõ'],
    ['Trạng thái', asset.status || 'Không rõ'],
  ].forEach(([label, value]) => {
    details.appendChild(createElement('dt', { text: label }));
    details.appendChild(createElement('dd', { text: value }));
  });
  body.appendChild(details);

  if (asset.storagePath) {
    body.appendChild(createElement('p', { className: 'cms-admin-media-path', text: asset.storagePath }));
  }

  if (!asset.hasSafeUrl) {
    body.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: 'Đường dẫn media không thuộc nguồn được phép. Không thể chọn media này.' }));
  } else if (!compatibility.allowed) {
    body.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: compatibility.reason }));
  }

  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-static-media-picker-actions cms-admin-featured-library-picker-actions' });
  const choose = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary cms-admin-button-small',
    type: 'button',
    text: 'Chọn ảnh này',
  });
  choose.disabled = !asset.hasSafeUrl || !compatibility.allowed;
  choose.addEventListener('click', () => handleAttachFeaturedPickerMedia(asset, draftState, item, sourceIndex, handlers));
  const cancel = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-small', type: 'button', text: 'Hủy chọn' });
  cancel.addEventListener('click', () => closeFeaturedMediaLibraryPicker(handlers));
  appendChildren(actions, [choose, cancel]);
  body.appendChild(actions);

  card.appendChild(body);
  return card;
}

function renderFeaturedPickerMediaPreview(asset = {}) {
  if (asset.mediaKind === 'image' || asset.mediaKind === 'poster') {
    return renderStaticPickerMediaPreview(asset);
  }
  const media = createElement('div', { className: 'cms-admin-static-media-picker-preview has-error' });
  media.appendChild(createElement('span', { text: 'Không preview trong picker ảnh' }));
  return media;
}

function isFeaturedMediaLibraryPickerOpenForItem(item = {}, sourceIndex = 0) {
  return Boolean(
    featuredMediaLibraryPickerState.open
    && featuredMediaLibraryPickerState.itemKey === getFeaturedImageReplaceKey(item, sourceIndex)
    && featuredMediaLibraryPickerState.itemIndex === sourceIndex
  );
}

function handleOpenFeaturedMediaLibraryPicker(item = {}, sourceIndex = 0, handlers = {}) {
  const itemKey = getFeaturedImageReplaceKey(item, sourceIndex);
  const sameContext = isFeaturedMediaLibraryPickerOpenForItem(item, sourceIndex);
  resetFeaturedImageReplaceState();
  featuredImageReplaceState.itemKey = itemKey;
  featuredImageReplaceState.mode = 'library';
  featuredImageReplaceState.candidateUrl = String(item.imageUrl || '').trim();
  featuredMediaLibraryPickerState.open = true;
  featuredMediaLibraryPickerState.itemKey = itemKey;
  featuredMediaLibraryPickerState.itemIndex = sourceIndex;
  featuredMediaLibraryPickerState.error = '';
  if (!sameContext) {
    featuredMediaLibraryPickerState.search = '';
    featuredMediaLibraryPickerState.mediaKindFilter = 'compatible';
  }
  setStaticCmsDraftState({ featuredOperatorStatus: '', featuredOperatorError: null });
  handlers.onRerender?.();
}

function resetFeaturedMediaLibraryPickerState() {
  featuredMediaLibraryPickerState.open = false;
  featuredMediaLibraryPickerState.itemKey = '';
  featuredMediaLibraryPickerState.itemIndex = -1;
  featuredMediaLibraryPickerState.search = '';
  featuredMediaLibraryPickerState.mediaKindFilter = 'compatible';
  featuredMediaLibraryPickerState.error = '';
}

function closeFeaturedMediaLibraryPicker(handlers = {}) {
  resetFeaturedMediaLibraryPickerState();
  resetFeaturedImageReplaceState();
  handlers.onRerender?.();
}

function matchesFeaturedPickerFilters(asset = {}, pickerState = {}) {
  const kind = String(pickerState.mediaKindFilter || 'compatible');
  if (kind === 'compatible' && !['image', 'poster'].includes(asset.mediaKind)) return false;
  if (kind !== 'compatible' && kind !== 'all' && asset.mediaKind !== kind) return false;
  const search = String(pickerState.search || '').trim().toLowerCase();
  if (!search) return true;
  return asset.searchText.includes(search);
}

function getFeaturedPickerCompatibility(asset = {}) {
  if (!isSelectableStaticPickerMediaAsset(asset)) return { allowed: false, reason: 'Media này đã xóa, bị hỏng hoặc không có URL an toàn nên không thể chọn.' };
  if (!asset.hasSafeUrl) return { allowed: false, reason: 'Đường dẫn media không thuộc nguồn được phép. Không thể chọn media này.' };
  if (!['image', 'poster'].includes(asset.mediaKind)) {
    return { allowed: false, reason: 'Media này không phù hợp với ảnh Tác phẩm tiêu biểu.' };
  }
  return { allowed: true, reason: '' };
}

function handleAttachFeaturedPickerMedia(asset = {}, draftState = {}, item = {}, sourceIndex = 0, handlers = {}) {
  const current = getState().staticCmsDraft || draftState;
  const featured = getFeaturedOperatorSection(current.draftJson);
  const currentItem = featured.items[sourceIndex];
  if (!current.draftJson || getFeaturedImageReplaceKey(currentItem, sourceIndex) !== featuredMediaLibraryPickerState.itemKey) {
    featuredMediaLibraryPickerState.error = 'Tác phẩm tiêu biểu đang chỉnh đã thay đổi. Hãy mở lại picker để chọn đúng field đích.';
    handlers.onRerender?.();
    return;
  }

  if (!isSelectableStaticPickerMediaAsset(asset)) {
    featuredMediaLibraryPickerState.error = 'Media này đã xóa, bị hỏng hoặc không có URL an toàn nên không thể chọn.';
    handlers.onRerender?.();
    return;
  }

  const safeUrl = normalizeSafeStaticPickerMediaUrl(asset.rawUrl);
  if (!safeUrl) {
    featuredMediaLibraryPickerState.error = 'Đường dẫn media không thuộc nguồn được phép. Không thể chọn media này.';
    handlers.onRerender?.();
    return;
  }

  const compatibility = getFeaturedPickerCompatibility(asset);
  if (!compatibility.allowed) {
    featuredMediaLibraryPickerState.error = compatibility.reason;
    handlers.onRerender?.();
    return;
  }

  resetFeaturedMediaLibraryPickerState();
  resetFeaturedImageReplaceState();
  commitFeaturedDraftChange(current, (nextFeatured) => {
    const target = nextFeatured.items[sourceIndex];
    if (!target) return;
    target.imageUrl = safeUrl;
  }, handlers, 'Đã gắn ảnh vào Tác phẩm tiêu biểu trong bản nháp. Website đang hoạt động chưa thay đổi cho đến khi bạn lưu và công khai.');
}

function renderFeaturedImageReplaceMedia(label = '', imageUrl = '', alt = '') {
  const wrap = createElement('div', { className: 'cms-admin-featured-image-replace-media' });
  wrap.appendChild(createElement('strong', { text: label }));
  const media = createElement('div', { className: 'cms-admin-featured-image-replace-frame' });
  if (imageUrl && validateStaticCmsMediaUrl(imageUrl, STATIC_CMS_DRAFT_CONFIG).valid) {
    const image = createElement('img', { attrs: { src: imageUrl, alt, loading: 'lazy' } });
    image.addEventListener('error', () => {
      image.hidden = true;
      media.classList.add('has-error');
      media.appendChild(createElement('span', { text: 'Không tải được ảnh hiện tại' }));
    }, { once: true });
    media.appendChild(image);
  } else {
    media.classList.add('has-error');
    media.appendChild(createElement('span', { text: 'Chưa có ảnh hợp lệ' }));
  }
  wrap.appendChild(media);
  return wrap;
}

function renderFeaturedImageCandidatePreview(itemKey = '', imageUrl = '', alt = '') {
  const wrap = createElement('div', { className: 'cms-admin-featured-image-candidate-preview' });
  const status = createElement('div', {
    className: 'cms-admin-help-text cms-admin-featured-image-preview-status',
    text: featuredImageReplaceState.previewStatus === 'success' ? 'Ảnh có thể tải được.' : 'Đang kiểm tra khả năng tải ảnh...',
  });
  const frame = createElement('div', { className: 'cms-admin-featured-image-replace-frame' });
  const image = createElement('img', { attrs: { src: imageUrl, alt, loading: 'eager' } });
  image.addEventListener('load', () => {
    if (featuredImageReplaceState.itemKey !== itemKey || featuredImageReplaceState.previewUrl !== imageUrl) return;
    featuredImageReplaceState.previewStatus = 'success';
    featuredImageReplaceState.error = '';
    status.textContent = 'Ảnh có thể tải được.';
    status.classList.remove('cms-admin-danger-text');
    status.classList.add('cms-admin-success-text');
  }, { once: true });
  image.addEventListener('error', () => {
    if (featuredImageReplaceState.itemKey !== itemKey || featuredImageReplaceState.previewUrl !== imageUrl) return;
    featuredImageReplaceState.previewStatus = 'error';
    featuredImageReplaceState.error = 'Không tải được ảnh từ đường dẫn này. Vui lòng kiểm tra lại.';
    image.hidden = true;
    frame.classList.add('has-error');
    frame.appendChild(createElement('span', { text: 'Không tải được ảnh' }));
    status.textContent = featuredImageReplaceState.error;
    status.classList.remove('cms-admin-success-text');
    status.classList.add('cms-admin-danger-text');
  }, { once: true });
  frame.appendChild(image);
  wrap.appendChild(frame);
  wrap.appendChild(status);
  return wrap;
}

function renderFeaturedUploadedImagePreview(itemKey = '', imageUrl = '', alt = '', handlers = {}) {
  const wrap = createElement('div', { className: 'cms-admin-featured-image-candidate-preview' });
  wrap.appendChild(createElement('strong', { text: 'Ảnh đã tải lên' }));
  const frame = createElement('div', { className: 'cms-admin-featured-image-replace-frame' });
  const status = createElement('p', {
    className: 'cms-admin-help-text cms-admin-featured-image-preview-status',
    text: featuredImageReplaceState.uploadedPreviewStatus === 'success' ? 'Ảnh trên kho có thể tải được.' : 'Đang kiểm tra ảnh trên kho...',
  });
  const image = createElement('img', { attrs: { src: imageUrl, alt, loading: 'eager' } });
  image.addEventListener('load', () => {
    if (featuredImageReplaceState.itemKey !== itemKey || featuredImageReplaceState.uploadedUrl !== imageUrl) return;
    if (featuredImageReplaceState.uploadedPreviewStatus !== 'success') {
      featuredImageReplaceState.uploadedPreviewStatus = 'success';
      handlers.onRerender?.();
    }
  }, { once: true });
  image.addEventListener('error', () => {
    if (featuredImageReplaceState.itemKey !== itemKey || featuredImageReplaceState.uploadedUrl !== imageUrl) return;
    if (featuredImageReplaceState.uploadedPreviewStatus !== 'error') {
      featuredImageReplaceState.uploadedPreviewStatus = 'error';
      featuredImageReplaceState.localError = 'Ảnh đã upload nhưng không tải được từ public URL. Chưa thể dùng ảnh này.';
      handlers.onRerender?.();
    }
  }, { once: true });
  frame.appendChild(image);
  wrap.appendChild(frame);
  wrap.appendChild(status);
  return wrap;
}

function getFeaturedImageReplaceKey(item = {}, sourceIndex = 0) {
  return `${String(item?.id || '').trim() || 'featured-item'}::${sourceIndex}`;
}

function makeCmsControlIdToken(value = '', fallback = 'field') {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return token || fallback;
}

function getFeaturedControlAttrs(sourceIndex = 0, fieldName = 'field', item = {}) {
  const itemToken = makeCmsControlIdToken(item?.id || `item-${sourceIndex}`, `item-${sourceIndex}`);
  const fieldToken = makeCmsControlIdToken(fieldName, 'field');
  return {
    id: `cms-admin-featured-${itemToken}-${fieldToken}`,
    name: `featured-${fieldToken}-${sourceIndex}`,
  };
}

function releaseFeaturedLocalPreview() {
  const url = featuredImageReplaceState.localPreviewUrl;
  if (url && globalThis.URL?.revokeObjectURL) {
    try { globalThis.URL.revokeObjectURL(url); } catch { /* no-op */ }
  }
  featuredImageReplaceState.localPreviewUrl = '';
}

function resetFeaturedImageReplaceState() {
  releaseFeaturedLocalPreview();
  featuredImageReplaceState.itemKey = '';
  featuredImageReplaceState.mode = 'local';
  featuredImageReplaceState.candidateUrl = '';
  featuredImageReplaceState.previewUrl = '';
  featuredImageReplaceState.previewStatus = 'idle';
  featuredImageReplaceState.error = '';
  featuredImageReplaceState.localFile = null;
  featuredImageReplaceState.localStatus = 'idle';
  featuredImageReplaceState.localError = '';
  featuredImageReplaceState.uploadedUrl = '';
  featuredImageReplaceState.uploadedStoragePath = '';
  featuredImageReplaceState.uploadedMetadataId = '';
  featuredImageReplaceState.uploadedPreviewStatus = 'idle';
  resetFeaturedMediaLibraryPickerState();
}

function handleOpenFeaturedImageReplace(item = {}, sourceIndex = 0, handlers = {}) {
  const itemKey = getFeaturedImageReplaceKey(item, sourceIndex);
  if (featuredImageReplaceState.itemKey === itemKey) {
    resetFeaturedImageReplaceState();
  } else {
    resetFeaturedImageReplaceState();
    featuredImageReplaceState.itemKey = itemKey;
    featuredImageReplaceState.mode = 'local';
    featuredImageReplaceState.candidateUrl = String(item.imageUrl || '').trim();
  }
  handlers.onRerender?.();
}

function handleCancelFeaturedImageReplace(handlers = {}) {
  if (featuredImageReplaceState.uploadedUrl) {
    const confirmed = globalThis.confirm?.('Ảnh đã được tải lên kho nhưng chưa gắn vào bản nháp. Đóng panel có thể để lại tệp chưa sử dụng. Tiếp tục?');
    if (!confirmed) return;
  }
  resetFeaturedImageReplaceState();
  handlers.onRerender?.();
}

function handleSelectFeaturedLocalImage(item = {}, sourceIndex = 0, file = null, handlers = {}) {
  const itemKey = getFeaturedImageReplaceKey(item, sourceIndex);
  releaseFeaturedLocalPreview();
  featuredImageReplaceState.itemKey = itemKey;
  featuredImageReplaceState.mode = 'local';
  featuredImageReplaceState.localFile = null;
  featuredImageReplaceState.localStatus = 'idle';
  featuredImageReplaceState.localError = '';
  featuredImageReplaceState.uploadedUrl = '';
  featuredImageReplaceState.uploadedStoragePath = '';
  featuredImageReplaceState.uploadedMetadataId = '';
  featuredImageReplaceState.uploadedPreviewStatus = 'idle';

  const check = validateFeaturedImageFile(file);
  if (!check.valid) {
    featuredImageReplaceState.localError = check.reason;
    handlers.onRerender?.();
    return;
  }
  featuredImageReplaceState.localFile = file;
  featuredImageReplaceState.localStatus = 'selected';
  try {
    featuredImageReplaceState.localPreviewUrl = globalThis.URL?.createObjectURL?.(file) || '';
  } catch {
    featuredImageReplaceState.localPreviewUrl = '';
  }
  handlers.onRerender?.();
}

async function handleUploadFeaturedLocalImage(draftState = {}, item = {}, sourceIndex = 0, handlers = {}) {
  const itemKey = getFeaturedImageReplaceKey(item, sourceIndex);
  const appState = getState();
  const access = getDraftPersistenceAccess(appState);
  featuredImageReplaceState.itemKey = itemKey;
  featuredImageReplaceState.mode = 'local';
  featuredImageReplaceState.localError = '';

  if (!access.allowed) {
    featuredImageReplaceState.localStatus = 'error';
    featuredImageReplaceState.localError = access.reason;
    handlers.onRerender?.();
    return;
  }
  if (!draftState.currentDraftId) {
    featuredImageReplaceState.localStatus = 'error';
    featuredImageReplaceState.localError = 'Hãy lưu nội dung hiện tại thành bản nháp trước khi tải ảnh từ máy.';
    handlers.onRerender?.();
    return;
  }
  const itemId = String(item.id || '').trim();
  if (!itemId) {
    featuredImageReplaceState.localStatus = 'error';
    featuredImageReplaceState.localError = 'ID Tác phẩm tiêu biểu không được để trống trước khi upload.';
    handlers.onRerender?.();
    return;
  }
  const file = featuredImageReplaceState.localFile;
  const fileCheck = validateFeaturedImageFile(file);
  if (!fileCheck.valid) {
    featuredImageReplaceState.localStatus = 'error';
    featuredImageReplaceState.localError = fileCheck.reason;
    handlers.onRerender?.();
    return;
  }

  featuredImageReplaceState.localStatus = 'uploading';
  featuredImageReplaceState.uploadedUrl = '';
  featuredImageReplaceState.uploadedPreviewStatus = 'idle';
  handlers.onRerender?.();

  const result = await uploadCmsMedia(appState.supabase, {
    file,
    targetType: INDEX_FEATURED_MEDIA_UPLOAD_TARGET.targetType,
    sectionKey: INDEX_FEATURED_MEDIA_UPLOAD_TARGET.sectionKey,
    itemId,
    fieldName: INDEX_FEATURED_MEDIA_UPLOAD_TARGET.fieldName,
    mediaKind: INDEX_FEATURED_MEDIA_UPLOAD_TARGET.mediaKind,
    draftId: draftState.currentDraftId,
  });

  if (featuredImageReplaceState.itemKey !== itemKey) return;
  if (result.error) {
    featuredImageReplaceState.localStatus = 'error';
    featuredImageReplaceState.localError = normalizeErrorMessage(result.error);
    handlers.onRerender?.();
    return;
  }
  const publicUrl = getUploadedUrl(result.data || {});
  if (!publicUrl || !validateStaticCmsMediaUrl(publicUrl, STATIC_CMS_DRAFT_CONFIG).valid) {
    featuredImageReplaceState.localStatus = 'error';
    featuredImageReplaceState.localError = 'Upload thành công nhưng public URL trả về không hợp lệ hoặc không thuộc nguồn media được phép.';
    handlers.onRerender?.();
    return;
  }
  featuredImageReplaceState.localStatus = 'uploaded';
  featuredImageReplaceState.localError = '';
  featuredImageReplaceState.uploadedUrl = publicUrl;
  featuredImageReplaceState.uploadedStoragePath = String(result.data?.storagePath || '').trim();
  featuredImageReplaceState.uploadedMetadataId = String(result.data?.metadataId || '').trim();
  featuredImageReplaceState.uploadedPreviewStatus = 'loading';
  handlers.onRerender?.();
}

function handlePreviewFeaturedImageCandidate(item = {}, sourceIndex = 0, rawValue = '', handlers = {}) {
  const candidateUrl = String(rawValue || '').trim();
  const itemKey = getFeaturedImageReplaceKey(item, sourceIndex);
  featuredImageReplaceState.itemKey = itemKey;
  featuredImageReplaceState.mode = 'url';
  featuredImageReplaceState.candidateUrl = candidateUrl;
  featuredImageReplaceState.previewUrl = '';
  featuredImageReplaceState.previewStatus = 'idle';
  featuredImageReplaceState.error = '';
  if (!candidateUrl) {
    featuredImageReplaceState.error = 'Vui lòng nhập đường dẫn ảnh mới trước khi xem thử.';
  } else if (!validateStaticCmsMediaUrl(candidateUrl, STATIC_CMS_DRAFT_CONFIG).valid) {
    featuredImageReplaceState.error = 'Đường dẫn ảnh không hợp lệ hoặc không thuộc nguồn media được phép.';
  } else {
    featuredImageReplaceState.previewUrl = candidateUrl;
    featuredImageReplaceState.previewStatus = 'loading';
  }
  handlers.onRerender?.();
}

function handleUseFeaturedImageCandidate(draftState = {}, item = {}, sourceIndex = 0, rawValue = '', handlers = {}) {
  const candidateUrl = String(rawValue || '').trim();
  const itemKey = getFeaturedImageReplaceKey(item, sourceIndex);
  featuredImageReplaceState.itemKey = itemKey;
  featuredImageReplaceState.mode = 'url';
  featuredImageReplaceState.candidateUrl = candidateUrl;
  featuredImageReplaceState.error = '';
  if (!candidateUrl) {
    featuredImageReplaceState.error = 'Vui lòng nhập đường dẫn ảnh mới trước khi dùng ảnh này.';
    handlers.onRerender?.();
    return;
  }
  if (!validateStaticCmsMediaUrl(candidateUrl, STATIC_CMS_DRAFT_CONFIG).valid) {
    featuredImageReplaceState.error = 'Đường dẫn ảnh không hợp lệ hoặc không thuộc nguồn media được phép.';
    handlers.onRerender?.();
    return;
  }
  resetFeaturedImageReplaceState();
  commitFeaturedDraftChange(draftState, (featured) => {
    const target = featured.items[sourceIndex];
    if (!target) return;
    target.imageUrl = candidateUrl;
  }, handlers, 'Đã thay ảnh trong bản nháp. Website công khai chưa thay đổi. Hãy bấm “Lưu vào bản nháp” để tiếp tục.');
}

function handleUseFeaturedUploadedImage(draftState = {}, item = {}, sourceIndex = 0, handlers = {}) {
  const publicUrl = String(featuredImageReplaceState.uploadedUrl || '').trim();
  if (!publicUrl || featuredImageReplaceState.uploadedPreviewStatus !== 'success') {
    featuredImageReplaceState.localError = 'Ảnh tải lên chưa sẵn sàng. Hãy đợi kiểm tra ảnh trên kho hoàn tất.';
    handlers.onRerender?.();
    return;
  }
  if (!validateStaticCmsMediaUrl(publicUrl, STATIC_CMS_DRAFT_CONFIG).valid) {
    featuredImageReplaceState.localError = 'Public URL của ảnh upload không hợp lệ hoặc không thuộc nguồn media được phép.';
    handlers.onRerender?.();
    return;
  }
  resetFeaturedImageReplaceState();
  commitFeaturedDraftChange(draftState, (featured) => {
    const target = featured.items[sourceIndex];
    if (!target) return;
    target.imageUrl = publicUrl;
  }, handlers, 'Đã thay ảnh trong bản nháp. Website công khai chưa thay đổi. Hãy bấm “Lưu vào bản nháp” để tiếp tục.');
}

function formatFileBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 KB';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function renderFeaturedPreview(featured = {}, validation = {}) {
  const panel = createElement('section', { className: 'cms-admin-featured-preview', attrs: { id: 'cms-admin-featured-preview' } });
  panel.appendChild(renderStaticPanelTitle('Xem trước tác phẩm tiêu biểu', featured.enabled ? 'Đang bật' : 'Đang tắt'));
  panel.appendChild(createElement('h4', { text: featured.title || 'Tác phẩm tiêu biểu' }));
  if (featured.lead) panel.appendChild(createElement('p', { className: 'cms-admin-help-text', text: featured.lead }));
  if (featured.enabled === false) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: 'Khu vực Featured đang tắt và sẽ không hiển thị trên trang chủ.' }));
  }

  const sorted = featured.items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (Number(a.item.sortOrder || a.index + 1) - Number(b.item.sortOrder || b.index + 1)) || (a.index - b.index));
  const visibleItems = sorted.filter(({ item }) => item.isVisible !== false);
  if (!visibleItems.length) {
    panel.appendChild(renderEmptyState('Chưa có mục đang hiển thị để xem trước.'));
  } else {
    const list = createElement('div', { className: 'cms-admin-featured-preview-list' });
    visibleItems.forEach(({ item }) => list.appendChild(renderFeaturedPreviewCard(item)));
    panel.appendChild(list);
  }

  const hiddenCount = featured.items.filter((item) => item.isVisible === false).length;
  if (hiddenCount) panel.appendChild(createElement('p', { className: 'cms-admin-help-text', text: `${hiddenCount} mục đang tắt hiển thị.` }));
  if (!validation.valid) panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-error', text: 'Bản xem trước đang có lỗi nội dung. Hãy sửa các mục được đánh dấu trước khi lưu thay đổi.' }));
  return panel;
}

function renderFeaturedPreviewCard(item = {}) {
  const card = createElement('article', { className: 'cms-admin-featured-preview-card' });
  const media = createElement('div', { className: 'cms-admin-featured-preview-media' });
  const imageUrl = String(item.imageUrl || '').trim();
  if (imageUrl && validateStaticCmsMediaUrl(imageUrl, STATIC_CMS_DRAFT_CONFIG).valid) {
    const image = createElement('img', {
      attrs: { src: imageUrl, alt: item.alt || item.title || '', loading: 'lazy' },
    });
    image.addEventListener('error', () => {
      image.hidden = true;
      media.classList.add('has-error');
      media.appendChild(createElement('span', { text: 'Không tải được ảnh' }));
    }, { once: true });
    media.appendChild(image);
  } else {
    media.classList.add('has-error');
    media.appendChild(createElement('span', { text: 'Thiếu ảnh hợp lệ' }));
  }
  const copy = createElement('div', { className: 'cms-admin-featured-preview-copy' });
  copy.appendChild(createElement('strong', { text: item.title || 'Chưa có tiêu đề' }));
  if (item.description) copy.appendChild(createElement('p', { text: item.description }));
  if (item.room) copy.appendChild(renderBadge(`${item.room === 'outdoor' ? 'Ngoài trời' : 'Trong nhà'}${item.artworkId ? ` · ${item.artworkId}` : ''}`, 'default'));
  appendChildren(card, [media, copy]);
  return card;
}

function renderFeaturedValidationSummary(validation = {}) {
  const panel = createElement('section', { className: 'cms-admin-featured-validation' });
  panel.appendChild(renderStaticPanelTitle('Kiểm tra nội dung', validation.valid ? 'PASS' : 'Cần sửa'));
  if (validation.valid) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: 'Phần Tác phẩm tiêu biểu đã đủ điều kiện ghi vào bản nháp.' }));
  } else {
    const list = createElement('ul', { className: 'cms-admin-static-message-list cms-admin-danger-text' });
    validation.errors.slice(0, 12).forEach((message) => list.appendChild(createElement('li', { text: message })));
    panel.appendChild(list);
  }
  if (validation.warnings.length) {
    const warnings = createElement('ul', { className: 'cms-admin-static-message-list' });
    validation.warnings.slice(0, 8).forEach((message) => warnings.appendChild(createElement('li', { text: message })));
    panel.appendChild(warnings);
  }
  return panel;
}

function renderFeaturedTechnicalDetails(featured = {}) {
  const details = createElement('details', { className: 'cms-admin-static-technical-details cms-admin-featured-technical' });
  details.appendChild(createElement('summary', { text: 'Chi tiết kỹ thuật' }));
  details.appendChild(createElement('pre', { className: 'cms-admin-code-block', text: JSON.stringify(featured, null, 2) }));
  return details;
}

function handleAddFeaturedItem(draftState = {}, handlers = {}) {
  commitFeaturedDraftChange(draftState, (featured) => {
    if (featured.items.length >= FEATURED_OPERATOR_MAX_ITEMS) return;
    featured.items.push(createFeaturedOperatorItem(featured));
    normalizeFeaturedSortOrder(featured.items);
  }, handlers, 'Đã thêm một mục Tác phẩm tiêu biểu mới. Hãy bổ sung ảnh trước khi lưu thay đổi.');
}

function handleFeaturedItemFieldChange(draftState = {}, sourceIndex = 0, fieldName = '', value, handlers = {}) {
  const currentItem = getFeaturedOperatorSection(draftState.draftJson).items[sourceIndex];
  if (fieldName === 'imageUrl' && featuredImageReplaceState.itemKey === getFeaturedImageReplaceKey(currentItem, sourceIndex)) {
    featuredImageReplaceState.candidateUrl = String(value ?? '').trim();
    featuredImageReplaceState.previewUrl = '';
    featuredImageReplaceState.previewStatus = 'idle';
    featuredImageReplaceState.error = '';
  }
  commitFeaturedDraftChange(draftState, (featured) => {
    const item = featured.items[sourceIndex];
    if (!item) return;
    if (fieldName === 'isVisible') item.isVisible = Boolean(value);
    else if (fieldName === 'sortOrder') item.sortOrder = Number.isFinite(Number(value)) ? Number(value) : sourceIndex + 1;
    else item[fieldName] = String(value ?? '').trim();
    if (fieldName === 'description' && Object.prototype.hasOwnProperty.call(item, 'caption')) item.caption = item.description;
  }, handlers);
}

function handleMoveFeaturedItem(draftState = {}, sourceIndex = 0, direction = 0, handlers = {}) {
  resetFeaturedImageReplaceState();
  commitFeaturedDraftChange(draftState, (featured) => {
    const targetIndex = sourceIndex + direction;
    if (targetIndex < 0 || targetIndex >= featured.items.length) return;
    [featured.items[sourceIndex], featured.items[targetIndex]] = [featured.items[targetIndex], featured.items[sourceIndex]];
    normalizeFeaturedSortOrder(featured.items);
  }, handlers, 'Đã cập nhật thứ tự Tác phẩm tiêu biểu trong bản nháp.');
}

function handleRemoveFeaturedItem(draftState = {}, sourceIndex = 0, handlers = {}) {
  const item = getFeaturedOperatorSection(draftState.draftJson).items[sourceIndex];
  const confirmed = globalThis.confirm?.(`Xóa “${item?.title || item?.id || 'mục này'}” khỏi Tác phẩm tiêu biểu? Thao tác này không xóa ảnh, media hoặc object 3D.`);
  if (!confirmed) return;
  resetFeaturedImageReplaceState();
  commitFeaturedDraftChange(draftState, (featured) => {
    featured.items.splice(sourceIndex, 1);
    normalizeFeaturedSortOrder(featured.items);
  }, handlers, 'Đã xóa mục khỏi danh sách Tác phẩm tiêu biểu. Media và object 3D không bị xóa.');
}

function handleRevertFeaturedSection(draftState = {}, handlers = {}) {
  const confirmed = globalThis.confirm?.('Hoàn tác toàn bộ thay đổi chưa lưu trong phần Tác phẩm tiêu biểu về baseline đang mở?');
  if (!confirmed) return;
  resetFeaturedImageReplaceState();
  const baselineFeatured = getRawFeaturedSection(draftState.baselineJson);
  const draftJson = cloneJson(draftState.draftJson || {});
  if (!draftJson.index || typeof draftJson.index !== 'object' || Array.isArray(draftJson.index)) draftJson.index = {};
  if (baselineFeatured) draftJson.index.featuredArtworks = cloneJson(baselineFeatured);
  else delete draftJson.index.featuredArtworks;
  delete draftJson.index.featured;
  const validation = validateStaticCmsDraft(draftJson, STATIC_CMS_DRAFT_CONFIG);
  updateStaticCmsDraftJson(draftJson, validation);
  setStaticCmsDraftState({ featuredOperatorStatus: 'Đã hoàn tác phần Tác phẩm tiêu biểu về bản gốc đang mở.', featuredOperatorError: null });
  handlers.onRerender?.();
}

function commitFeaturedDraftChange(draftState = {}, mutator, handlers = {}, status = 'Đã cập nhật Tác phẩm tiêu biểu trong bản nháp. Website công khai chưa thay đổi.') {
  try {
    const nextJson = applyFeaturedOperatorMutation(draftState.draftJson, mutator);
    const sanitized = sanitizeStaticCmsExport(nextJson, { keepVersion: true });
    const validation = validateStaticCmsDraft(sanitized, STATIC_CMS_DRAFT_CONFIG);
    updateStaticCmsDraftJson(sanitized, validation);
    setStaticCmsDraftState({ featuredOperatorStatus: status, featuredOperatorError: null });
  } catch (error) {
    setStaticCmsDraftState({ featuredOperatorError: normalizeErrorMessage(error), featuredOperatorStatus: '' });
  }
  handlers.onRerender?.();
}

export function getFeaturedOperatorSection(cmsJson = {}) {
  const raw = getRawFeaturedSection(cmsJson) || {};
  const section = cloneJson(raw);
  section.enabled = typeof raw.enabled === 'boolean'
    ? raw.enabled
    : typeof raw.isVisible === 'boolean'
      ? raw.isVisible
      : FEATURED_OPERATOR_DEFAULTS.enabled;
  section.title = String(raw.title ?? FEATURED_OPERATOR_DEFAULTS.title).trim();
  section.lead = String(raw.lead ?? raw.description ?? FEATURED_OPERATOR_DEFAULTS.lead).trim();
  section.items = safeArray(raw.items).map((item, index) => normalizeFeaturedOperatorItem(item, index));
  return section;
}

export function createFeaturedOperatorItem(featured = {}) {
  const existingIds = new Set(safeArray(featured.items).map((item) => String(item?.id || '').trim().toLowerCase()).filter(Boolean));
  let sequence = 1;
  let id = '';
  do {
    id = `featured_local_${String(sequence).padStart(3, '0')}`;
    sequence += 1;
  } while (existingIds.has(id.toLowerCase()));
  return {
    id,
    title: 'Tác phẩm tiêu biểu mới',
    description: '',
    imageUrl: '',
    alt: '',
    room: '',
    artworkId: '',
    ctaLabel: 'Xem trong không gian 3D',
    isVisible: true,
    sortOrder: safeArray(featured.items).length + 1,
  };
}

export function applyFeaturedOperatorMutation(cmsJson = {}, mutator) {
  const draftJson = cloneJson(cmsJson || {});
  if (!draftJson.index || typeof draftJson.index !== 'object' || Array.isArray(draftJson.index)) draftJson.index = {};
  const featured = getFeaturedOperatorSection(draftJson);
  if (typeof mutator === 'function') mutator(featured);
  draftJson.index.featuredArtworks = featured;
  delete draftJson.index.featured;
  return draftJson;
}

export function validateFeaturedOperatorSection(featured = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const itemErrors = {};
  if (!featured || typeof featured !== 'object' || Array.isArray(featured)) {
    return { valid: false, errors: ['Tác phẩm tiêu biểu phải là một object hợp lệ.'], warnings, itemErrors };
  }
  if (!Array.isArray(featured.items)) {
    return { valid: false, errors: ['Danh sách Tác phẩm tiêu biểu phải là một mảng.'], warnings, itemErrors };
  }
  if (featured.enabled === true && featured.items.length === 0) errors.push('Khu vực đang bật nhưng chưa có tác phẩm tiêu biểu.');
  if (featured.items.length > FEATURED_OPERATOR_MAX_ITEMS) warnings.push(`Chỉ nên dùng tối đa ${FEATURED_OPERATOR_MAX_ITEMS} mục Featured.`);
  const ids = new Map();
  featured.items.forEach((item, index) => {
    const fieldErrors = {};
    const id = String(item?.id || '').trim();
    const visible = item?.isVisible !== false;
    const title = String(item?.title || '').trim();
    const imageUrl = String(item?.imageUrl || '').trim();
    if (!id) fieldErrors.id = 'ID không được để trống.';
    else if (ids.has(id)) fieldErrors.id = 'ID này đã tồn tại trong danh sách Tác phẩm tiêu biểu.';
    else ids.set(id, index);
    if (visible && !title) fieldErrors.title = 'Tiêu đề không được để trống khi mục đang hiển thị.';
    if (visible && !imageUrl) fieldErrors.imageUrl = 'Ảnh không được để trống khi mục đang hiển thị.';
    if (imageUrl && !validateStaticCmsMediaUrl(imageUrl, options).valid) fieldErrors.imageUrl = 'Đường dẫn ảnh không hợp lệ hoặc không thuộc nguồn media được phép.';
    if (!Number.isFinite(Number(item?.sortOrder))) fieldErrors.sortOrder = 'Thứ tự phải là số.';
    if (item?.room && !['indoor', 'outdoor'].includes(String(item.room).toLowerCase())) fieldErrors.room = 'Không gian liên kết chỉ được là Trong nhà hoặc Ngoài trời.';
    if (Object.keys(fieldErrors).length) {
      itemErrors[index] = fieldErrors;
      Object.values(fieldErrors).forEach((message) => errors.push(`Mục ${index + 1}: ${message}`));
    }
    if (visible && title && !String(item?.alt || '').trim()) warnings.push(`Mục ${index + 1}: Alt text đang trống; Index sẽ dùng tiêu đề làm nội dung thay thế.`);
  });
  return { valid: errors.length === 0, errors, warnings, itemErrors };
}

function hasFeaturedOperatorChanges(draftJson = {}, baselineJson = {}) {
  return JSON.stringify(getFeaturedOperatorSection(draftJson)) !== JSON.stringify(getFeaturedOperatorSection(baselineJson));
}

function getRawFeaturedSection(cmsJson = {}) {
  const index = cmsJson?.index;
  if (!index || typeof index !== 'object' || Array.isArray(index)) return null;
  if (index.featuredArtworks && typeof index.featuredArtworks === 'object' && !Array.isArray(index.featuredArtworks)) return index.featuredArtworks;
  if (index.featured && typeof index.featured === 'object' && !Array.isArray(index.featured)) return index.featured;
  return null;
}

function normalizeFeaturedOperatorItem(item = {}, index = 0) {
  const sharedValidator = globalThis.cmsSchemaValidator || null;
  const normalized = sharedValidator?.normalizeFeaturedItemAliases
    ? sharedValidator.normalizeFeaturedItemAliases(item, index, { dropLegacyAliases: true })
    : cloneJson(item || {});
  return {
    ...normalized,
    id: String(normalized?.id || item?.id || '').trim(),
    title: String(normalized?.title || item?.title || item?.name || '').trim(),
    description: String(normalized?.description || item?.description || item?.caption || '').trim(),
    imageUrl: String(normalized?.imageUrl || item?.imageUrl || item?.image || item?.src || item?.url || '').trim(),
    alt: String(normalized?.alt || item?.alt || '').trim(),
    room: String(normalized?.room || item?.room || item?.room_key || item?.roomKey || '').trim().toLowerCase(),
    artworkId: String(normalized?.artworkId || item?.artworkId || item?.artwork_id || '').trim(),
    ctaLabel: String(normalized?.ctaLabel || item?.ctaLabel || item?.cta_label || '').trim(),
    isVisible: normalized?.isVisible !== false,
    sortOrder: Number.isFinite(Number(normalized?.sortOrder)) ? Number(normalized.sortOrder) : index + 1,
  };
}

function normalizeFeaturedSortOrder(items = []) {
  safeArray(items).forEach((item, index) => { item.sortOrder = index + 1; });
  return items;
}

function renderMainLoadActions(draftState = {}, handlers = {}) {
  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-static-actions cms-admin-static-main-load-actions' });
  const loadButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    text: draftState.loading ? 'Đang tải...' : 'Tải nội dung đang công khai',
    type: 'button',
  });
  loadButton.disabled = Boolean(draftState.loading) || !ADMIN_FEATURE_FLAGS.allowStaticCmsDraftEdit;
  loadButton.addEventListener('click', () => handleLoadStaticCmsBaseline(handlers));
  actions.appendChild(loadButton);
  return actions;
}

function renderAdvancedDataActions(draftState = {}, handlers = {}) {
  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-static-actions cms-admin-static-advanced-actions' });
  const importInput = createElement('input', {
    type: 'file',
    attrs: {
      id: 'cms-admin-static-json-import',
      name: 'staticCmsJsonImport',
      accept: '.json,application/json',
      'aria-hidden': 'true',
      tabindex: '-1',
    },
  });
  importInput.hidden = true;
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0] || null;
    if (!file) return;
    try {
      await handleImportStaticDraftJson({ file, handlers });
    } finally {
      importInput.value = '';
    }
  });

  const resetButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost',
    text: 'Hoàn tác về lúc tải gần nhất',
    type: 'button',
  });
  resetButton.disabled = Boolean(draftState.loading) || !Boolean(draftState.draftJson);
  resetButton.addEventListener('click', () => handleResetStaticDraft(handlers));

  const importButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    text: 'Nhập JSON kỹ thuật',
    title: 'Chọn file JSON từ máy tính để đưa vào bản nháp hiện tại. Chưa công khai website.',
    type: 'button',
  });
  importButton.disabled = Boolean(draftState.loading)
    || Boolean(draftState.isSavingDraft)
    || Boolean(draftState.isPublishingCms)
    || Boolean(draftState.isUploadingMedia)
    || !ADMIN_FEATURE_FLAGS.allowStaticCmsDraftEdit;
  importButton.addEventListener('click', () => {
    const current = getState().staticCmsDraft || draftState;
    if (current.dirty) {
      const confirmed = globalThis.confirm('Bản nháp hiện tại có thay đổi chưa lưu. Nhập JSON mới sẽ thay thế nội dung bản nháp đang xem. Bạn có muốn tiếp tục không?');
      if (!confirmed) return;
    }
    importInput.click();
  });

  const exportButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    text: 'Xuất JSON kỹ thuật',
    type: 'button',
  });
  exportButton.disabled = !Boolean(draftState.draftJson) || !ADMIN_FEATURE_FLAGS.allowStaticCmsExport;
  exportButton.addEventListener('click', () => handleExportStaticDraft(handlers));

  const copyButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost',
    text: 'Sao chép JSON kỹ thuật',
    type: 'button',
  });
  copyButton.disabled = !Boolean(draftState.draftJson) || !navigator?.clipboard;
  copyButton.addEventListener('click', () => handleCopyStaticDraft(handlers));

  appendChildren(actions, [resetButton, importButton, importInput, exportButton, copyButton]);
  return actions;
}

function renderRoomCountMeta(draftState = {}) {
  const indoor = getDraftRoomItems(draftState.draftJson, 'indoor').length;
  const outdoor = getDraftRoomItems(draftState.draftJson, 'outdoor').length;
  return `indoor ${indoor} / outdoor ${outdoor}`;
}

function renderRoomAndItemSelector(draftState = {}, handlers = {}) {
  const wrap = createElement('div', { className: 'cms-admin-static-selector-stack' });
  const roomSelect = createElement('select', {
    className: 'cms-admin-select',
    ariaLabel: 'Chọn không gian',
    attrs: { id: 'cms-admin-static-room-select', name: 'staticDraftRoom' },
  });
  ROOM_KEYS.forEach((roomKey) => {
    const count = getDraftRoomItems(draftState.draftJson, roomKey).length;
    const label = roomKey === 'indoor' ? `Trong nhà (${count})` : `Ngoài trời (${count})`;
    roomSelect.appendChild(createElement('option', { value: roomKey, text: label }));
  });
  roomSelect.value = draftState.selectedRoom || 'indoor';
  roomSelect.addEventListener('change', () => {
    updateStaticCmsDraftRoom(roomSelect.value);
    handlers.onRerender?.();
  });

  const itemSelect = createElement('select', {
    className: 'cms-admin-select',
    ariaLabel: 'Chọn tác phẩm hoặc item',
    attrs: { id: 'cms-admin-static-item-select', name: 'staticDraftItem' },
  });
  getDraftRoomItems(draftState.draftJson, draftState.selectedRoom).forEach((item) => {
    const code = getItemCode(item);
    const label = `${code} — ${item.title || item.name || getItemType(item)}`;
    itemSelect.appendChild(createElement('option', { value: code, text: label }));
  });
  itemSelect.value = draftState.selectedItemCode || '';
  itemSelect.addEventListener('change', () => {
    updateStaticCmsDraftItem(itemSelect.value);
    handlers.onRerender?.();
  });

  appendChildren(wrap, [
    labeledControl('Phòng', roomSelect),
    labeledControl('Tác phẩm / item', itemSelect),
  ]);
  return wrap;
}

function labeledControl(label, control) {
  const wrap = createElement('label', { className: 'cms-admin-field cms-admin-inline-field cms-admin-static-control' });
  wrap.appendChild(createElement('span', { className: 'cms-admin-label', text: label }));
  wrap.appendChild(control);
  return wrap;
}

function renderItemCards(draftState = {}, handlers = {}) {
  const list = createElement('div', { className: 'cms-admin-static-item-list' });
  getDraftRoomItems(draftState.draftJson, draftState.selectedRoom).forEach((item) => {
    const code = getItemCode(item);
    const active = code === draftState.selectedItemCode;
    const button = createElement('button', {
      className: ['cms-admin-static-item-card', active ? 'is-active' : ''].filter(Boolean).join(' '),
      type: 'button',
    });
    button.appendChild(renderItemTypeBadge(item));
    const text = createElement('span', { className: 'cms-admin-static-item-card-text' });
    text.appendChild(createElement('strong', { text: code || 'NO_CODE' }));
    text.appendChild(createElement('small', { text: item.title || item.name || 'Chưa có tiêu đề' }));
    button.appendChild(text);
    button.addEventListener('click', () => {
      updateStaticCmsDraftItem(code);
      handlers.onRerender?.();
    });
    list.appendChild(button);
  });
  return list;
}

function renderItemTypeBadge(item = {}) {
  const type = getItemType(item);
  const label = type === 'video' ? 'VIDEO' : type === 'logo' ? 'LOGO' : 'ARTWORK';
  const variant = type === 'video' ? 'warning' : type === 'logo' ? 'success' : 'default';
  return renderBadge(label, variant);
}

function getItemType(item = {}) {
  return String(item.mediaType || item.type || '').trim().toLowerCase() || 'artwork';
}

function renderStaticCmsDraftForm(draftState = {}, item = {}, handlers = {}) {
  const form = createElement('form', { className: 'cms-admin-form cms-admin-static-draft-form cms-admin-static-tabbed-form', attrs: { novalidate: 'true' } });
  form.addEventListener('submit', (event) => event.preventDefault());

  const activeTab = getActiveEditorTab(draftState);
  const groupKey = activeTab === 'metadata' ? 'metadata' : activeTab === 'media' ? 'media' : 'display';
  const group = DISPLAY_FIELD_GROUPS.find((entry) => entry.key === groupKey) || DISPLAY_FIELD_GROUPS[0];
  form.appendChild(renderFieldGroup(draftState, item, group, handlers));
  return form;
}

function renderFieldGroup(draftState = {}, item = {}, group = {}, handlers = {}) {
  const section = createElement('section', { className: `cms-admin-static-field-section cms-admin-static-field-section-${group.key}` });
  const heading = createElement('div', { className: 'cms-admin-static-field-section-heading' });
  heading.appendChild(createElement('h4', { text: group.title }));
  heading.appendChild(createElement('p', { text: group.description }));
  section.appendChild(heading);

  const grid = createElement('div', { className: 'cms-admin-static-field-grid' });
  safeArray(group.fields).forEach((fieldName) => {
    grid.appendChild(renderDraftField(draftState, item, fieldName, handlers, group.key));
  });
  section.appendChild(grid);
  if (group.key === 'media') {
    const picker = renderStaticMediaLibraryPicker(draftState, item, handlers);
    if (picker) section.appendChild(picker);
    if (draftState.mediaLibraryPickerStatus) {
      section.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: draftState.mediaLibraryPickerStatus }));
    }
    if (draftState.mediaLibraryPickerError) {
      section.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-error', text: normalizeErrorMessage(draftState.mediaLibraryPickerError) }));
    }
    section.appendChild(renderMediaUploadGate(draftState, item, handlers));
  }
  return section;
}

function renderMediaUploadGate(draftState = {}, item = {}, handlers = {}) {
  const appState = getState();
  const access = getDraftPersistenceAccess(appState);
  const wrap = createElement('section', { className: 'cms-admin-static-upload-gate' });
  const heading = createElement('div', { className: 'cms-admin-static-upload-heading' });
  heading.appendChild(createElement('h5', { text: 'Ảnh & video' }));
  heading.appendChild(createElement('p', { text: 'Chọn file từ máy hoặc dùng URL có sẵn. Upload chỉ gắn URL vào bản nháp hiện tại; website đang hoạt động chưa thay đổi cho đến khi lưu và công khai.' }));
  wrap.appendChild(heading);

  if (!ADMIN_FEATURE_FLAGS.allowStaticCmsMediaUpload || !CMS_MEDIA_UPLOAD_CONFIG.enabled) {
    wrap.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: 'Media Upload Gate đang bị khóa bằng feature flag.' }));
    return wrap;
  }
  if (!access.allowed) {
    wrap.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: access.reason }));
    return wrap;
  }

  const grid = createElement('div', { className: 'cms-admin-static-upload-grid' });
  STATIC_CMS_MEDIA_UPLOAD_TARGETS.forEach((target) => {
    grid.appendChild(renderMediaUploadTarget(draftState, item, target, handlers));
  });
  wrap.appendChild(grid);

  if (draftState.mediaUploadError) {
    wrap.appendChild(renderErrorBox(draftState.mediaUploadError, 'Upload media chưa thành công'));
  }
  if (draftState.lastMediaUpload?.publicUrl) {
    wrap.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: `Upload thành công: ${draftState.lastMediaUpload.fieldName || ''} đã được gắn vào bản nháp. Website đang hoạt động chưa thay đổi cho đến khi lưu và công khai.` }));
  }
  return wrap;
}

function renderMediaUploadTarget(draftState = {}, item = {}, target = {}, handlers = {}) {
  const roomKey = draftState.selectedRoom || 'indoor';
  const itemCode = getItemCode(item);
  const statusKey = getMediaUploadStatusKey(roomKey, itemCode, target.fieldName);
  const status = draftState.mediaUploadStatus?.[statusKey] || {};
  const card = createElement('article', { className: 'cms-admin-static-upload-card' });
  card.appendChild(createElement('strong', { text: target.label }));
  card.appendChild(createElement('p', { className: 'cms-admin-help-text', text: `${target.help} Giới hạn: ${formatUploadSizeLimit(target.mediaKind)}. Upload chỉ cập nhật bản nháp, không tự công khai.` }));

  const uploadFieldToken = makeCmsControlIdToken(target.fieldName || target.key || 'media');
  const input = createElement('input', {
    className: 'cms-admin-input cms-admin-static-upload-input',
    type: 'file',
    attrs: {
      id: `cms-admin-static-media-upload-${makeCmsControlIdToken(roomKey)}-${makeCmsControlIdToken(itemCode, 'item')}-${uploadFieldToken}`,
      name: `staticMediaUpload-${uploadFieldToken}`,
      accept: getUploadAccept(target.mediaKind),
      'aria-label': `Chọn file upload cho ${target.label}`,
    },
  });
  const uploadButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary cms-admin-button-small',
    type: 'button',
    text: status.loading ? 'Đang upload...' : 'Upload vào bản nháp',
    attrs: { 'aria-label': `Upload ${target.label} vào bản nháp hiện tại` },
  });
  uploadButton.disabled = Boolean(status.loading || draftState.isUploadingMedia || !itemCode);
  uploadButton.addEventListener('click', () => handleUploadStaticCmsMedia({ input, target, handlers }));

  const actions = createElement('div', { className: 'cms-admin-static-upload-actions' });
  actions.appendChild(input);
  actions.appendChild(uploadButton);
  card.appendChild(actions);

  if (status.error) {
    card.appendChild(createElement('small', { className: 'cms-admin-help-text cms-admin-danger-text', text: status.error }));
  }
  if (status.success) {
    card.appendChild(createElement('small', { className: 'cms-admin-help-text', text: status.success }));
  }
  return card;
}

function renderDraftField(draftState = {}, item = {}, fieldName, handlers = {}, groupKey = '') {
  if (groupKey === 'media') {
    return renderMediaDraftField(draftState, item, fieldName, handlers);
  }

  const label = createElement('label', {
    className: ['cms-admin-field', 'cms-admin-static-field', isLongTextField(fieldName) ? 'cms-admin-static-field-wide' : ''].filter(Boolean).join(' '),
  });
  label.appendChild(renderFieldLabel(fieldName, groupKey));

  const value = getDraftFieldDisplayValue(item, fieldName);
  const control = createElement(isLongTextField(fieldName) ? 'textarea' : 'input', {
    className: 'cms-admin-input',
    value: String(value ?? ''),
    attrs: { name: fieldName, rows: isLongTextField(fieldName) ? '4' : undefined, autocomplete: 'off', spellcheck: 'false' },
  });
  control.addEventListener('change', () => {
    const result = applyDraftFieldChange(draftState, fieldName, control.value);
    updateStaticCmsDraftJson(result.draftJson, result.validation);
    setStaticCmsDraftState({ previewField: MEDIA_FIELDS.includes(fieldName) ? fieldName : draftState.previewField || '' });
    handlers.onRerender?.();
  });

  label.appendChild(control);
  const hint = getFieldHintNode(fieldName, value, groupKey);
  if (hint) label.appendChild(hint);
  return label;
}


function renderMediaDraftField(draftState = {}, item = {}, fieldName, handlers = {}) {
  const value = getDraftFieldDisplayValue(item, fieldName);
  const wrap = createElement('div', {
    className: [
      'cms-admin-field',
      'cms-admin-static-field',
      'cms-admin-static-media-field',
      staticMediaLibraryPickerState.open && staticMediaLibraryPickerState.fieldName === fieldName ? 'is-picker-active' : '',
    ].filter(Boolean).join(' '),
  });

  const label = createElement('label', { className: 'cms-admin-static-media-field-control' });
  label.appendChild(renderFieldLabel(fieldName, 'media'));
  const control = createElement('input', {
    className: 'cms-admin-input',
    value: String(value ?? ''),
    attrs: { name: fieldName, autocomplete: 'off', spellcheck: 'false' },
  });
  control.addEventListener('change', () => {
    const result = applyDraftFieldChange(draftState, fieldName, control.value);
    updateStaticCmsDraftJson(result.draftJson, result.validation);
    setStaticCmsDraftState({ previewField: fieldName, mediaLibraryPickerStatus: '' });
    handlers.onRerender?.();
  });
  label.appendChild(control);
  const hint = getFieldHintNode(fieldName, value, 'media');
  if (hint) label.appendChild(hint);
  wrap.appendChild(label);

  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-static-media-field-actions' });
  const button = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary cms-admin-button-small',
    type: 'button',
    text: getOpenPickerLabel(fieldName),
    attrs: { 'aria-expanded': isPickerOpenForField(draftState, item, fieldName) ? 'true' : 'false' },
  });
  button.addEventListener('click', () => {
    openStaticMediaLibraryPicker(draftState, item, fieldName);
    handlers.onRerender?.();
  });
  actions.appendChild(button);
  wrap.appendChild(actions);
  return wrap;
}

function getOpenPickerLabel(fieldName = '') {
  if (getPrimaryMediaFieldKind(fieldName) === 'video') return 'Chọn video từ thư viện';
  if (getPrimaryMediaFieldKind(fieldName) === 'poster') return 'Chọn ảnh/poster từ thư viện';
  return 'Chọn từ thư viện';
}

function isPickerOpenForField(draftState = {}, item = {}, fieldName = '') {
  return Boolean(
    staticMediaLibraryPickerState.open
    && staticMediaLibraryPickerState.fieldName === fieldName
    && staticMediaLibraryPickerState.roomKey === String(draftState.selectedRoom || '')
    && staticMediaLibraryPickerState.itemCode === getItemCode(item)
  );
}

function openStaticMediaLibraryPicker(draftState = {}, item = {}, fieldName = '') {
  const roomKey = String(draftState.selectedRoom || 'indoor');
  const itemCode = getItemCode(item);
  const sameContext = staticMediaLibraryPickerState.open
    && staticMediaLibraryPickerState.roomKey === roomKey
    && staticMediaLibraryPickerState.itemCode === itemCode
    && staticMediaLibraryPickerState.fieldName === fieldName;
  staticMediaLibraryPickerState.open = true;
  staticMediaLibraryPickerState.roomKey = roomKey;
  staticMediaLibraryPickerState.itemCode = itemCode;
  staticMediaLibraryPickerState.fieldName = fieldName;
  staticMediaLibraryPickerState.error = '';
  if (!sameContext) {
    staticMediaLibraryPickerState.search = '';
    staticMediaLibraryPickerState.mediaKindFilter = 'all';
  }
  setStaticCmsDraftState({ mediaLibraryPickerStatus: '', mediaLibraryPickerError: null });
}

function closeStaticMediaLibraryPicker(handlers = {}) {
  staticMediaLibraryPickerState.open = false;
  staticMediaLibraryPickerState.error = '';
  handlers.onRerender?.();
}

function renderStaticMediaLibraryPicker(draftState = {}, item = {}, handlers = {}) {
  if (!isPickerOpenForField(draftState, item, staticMediaLibraryPickerState.fieldName)) return null;

  const appState = getState();
  const sourceAssets = safeArray(appState.data?.cmsMediaUploads)
    .map(normalizeStaticPickerMediaAsset)
    .filter(isSelectableStaticPickerMediaAsset);
  const mediaError = appState.data?.errors?.cmsMediaUploads || null;
  const fieldName = staticMediaLibraryPickerState.fieldName;
  const filteredAssets = sourceAssets.filter((asset) => matchesStaticPickerFilters(asset, staticMediaLibraryPickerState));

  const panel = createElement('section', { className: 'cms-admin-static-media-picker-panel' });
  const header = createElement('div', { className: 'cms-admin-static-media-picker-header' });
  const heading = createElement('div');
  heading.appendChild(createElement('h5', { text: 'Chọn ảnh/video từ thư viện' }));
  heading.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Chọn media đã upload để gắn vào bản nháp hiện tại. Website đang hoạt động chưa thay đổi cho đến khi bạn lưu và công khai.',
  }));
  const closeButton = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-small', type: 'button', text: 'Đóng' });
  closeButton.addEventListener('click', () => closeStaticMediaLibraryPicker(handlers));
  appendChildren(header, [heading, closeButton]);
  panel.appendChild(header);

  panel.appendChild(renderStaticPickerContext(draftState, item, fieldName));

  if (mediaError) {
    panel.appendChild(renderErrorBox(mediaError, 'Không đọc được cms_media_uploads'));
    return panel;
  }

  if (!sourceAssets.length) {
    panel.appendChild(renderEmptyState('Chưa có media trong thư viện upload.'));
    return panel;
  }

  panel.appendChild(renderStaticPickerControls(handlers));

  if (staticMediaLibraryPickerState.error) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-error', text: staticMediaLibraryPickerState.error }));
  }

  const list = createElement('div', { className: 'cms-admin-static-media-picker-grid' });
  filteredAssets.forEach((asset) => {
    list.appendChild(renderStaticPickerMediaCard(asset, draftState, item, fieldName, handlers));
  });

  if (!filteredAssets.length) {
    panel.appendChild(createElement('div', { className: 'cms-admin-media-filter-empty', text: 'Không có ảnh/video nào khớp bộ lọc hiện tại. Hãy đổi từ khóa hoặc loại media.' }));
  } else {
    panel.appendChild(list);
  }

  if (draftState.mediaLibraryPickerStatus) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: draftState.mediaLibraryPickerStatus }));
  }

  return panel;
}

function renderStaticPickerContext(draftState = {}, item = {}, fieldName = '') {
  const meta = createElement('div', { className: 'cms-admin-static-media-picker-context' });
  meta.appendChild(renderInfoTile('Trường ảnh/video', getFieldLabel(fieldName)));
  meta.appendChild(renderInfoTile('Nội dung', item.title || item.name || getItemCode(item) || 'Chưa xác định'));
  meta.appendChild(renderInfoTile('Phòng', getRoomLabel(draftState.selectedRoom)));
  meta.appendChild(renderInfoTile('Loại hợp lệ', getAllowedMediaKindLabel(fieldName)));
  return meta;
}

function renderStaticPickerControls(handlers = {}) {
  const controls = createElement('div', { className: 'cms-admin-static-media-picker-controls' });

  const search = createElement('input', {
    className: 'cms-admin-input cms-admin-static-media-picker-search',
    value: staticMediaLibraryPickerState.search,
    placeholder: 'Tìm theo tên file, đường dẫn, phòng, nội dung...',
    attrs: { type: 'search', autocomplete: 'off', 'aria-label': 'Tìm media trong thư viện upload' },
  });
  search.addEventListener('input', () => {
    staticMediaLibraryPickerState.search = search.value;
    handlers.onRerender?.();
  });

  const filter = createElement('select', {
    className: 'cms-admin-select cms-admin-static-media-picker-filter',
    attrs: { 'aria-label': 'Lọc loại media' },
  });
  [
    { value: 'all', label: 'Tất cả media' },
    { value: 'image', label: 'Ảnh' },
    { value: 'poster', label: 'Poster' },
    { value: 'video', label: 'Video' },
  ].forEach((option) => filter.appendChild(createElement('option', { value: option.value, text: option.label })));
  filter.value = ['all', 'image', 'poster', 'video'].includes(staticMediaLibraryPickerState.mediaKindFilter)
    ? staticMediaLibraryPickerState.mediaKindFilter
    : 'all';
  filter.addEventListener('change', () => {
    staticMediaLibraryPickerState.mediaKindFilter = filter.value;
    handlers.onRerender?.();
  });

  appendChildren(controls, [search, filter]);
  return controls;
}

function renderStaticPickerMediaCard(asset = {}, draftState = {}, item = {}, fieldName = '', handlers = {}) {
  const compatibility = getStaticPickerCompatibility(asset, fieldName);
  const card = createElement('article', {
    className: [
      'cms-admin-static-media-picker-card',
      asset.hasSafeUrl && compatibility.allowed ? 'is-selectable' : 'is-disabled',
    ].filter(Boolean).join(' '),
  });

  card.appendChild(renderStaticPickerMediaPreview(asset));

  const body = createElement('div', { className: 'cms-admin-static-media-picker-card-body' });
  const titleRow = createElement('div', { className: 'cms-admin-media-card-title-row' });
  titleRow.appendChild(createElement('h6', { text: asset.fileName || 'Ảnh/video' }));
  titleRow.appendChild(renderBadge(getMediaKindLabel(asset.mediaKind), asset.mediaKind === 'video' ? 'warning' : asset.mediaKind === 'unknown' ? 'default' : 'success'));
  body.appendChild(titleRow);

  const details = createElement('dl', { className: 'cms-admin-media-detail-list' });
  [
    ['Phòng/item', getPickerTargetText(asset)],
    ['Trường upload', asset.fieldName || 'Không có'],
    ['Dung lượng', formatFileBytes(asset.sizeBytes)],
    ['Ngày upload', asset.createdAt ? formatDateTime(asset.createdAt) : 'Không rõ'],
    ['Trạng thái', asset.status || 'Không rõ'],
  ].forEach(([label, value]) => {
    details.appendChild(createElement('dt', { text: label }));
    details.appendChild(createElement('dd', { text: value }));
  });
  body.appendChild(details);

  if (asset.storagePath) {
    body.appendChild(createElement('p', { className: 'cms-admin-media-path', text: asset.storagePath }));
  }

  if (!asset.hasSafeUrl) {
    body.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: 'Đường dẫn media không thuộc nguồn được phép. Không thể chọn media này.' }));
  } else if (!compatibility.allowed) {
    body.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: compatibility.reason }));
  }

  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-static-media-picker-actions' });
  const choose = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary cms-admin-button-small',
    type: 'button',
    text: getPickerActionLabel(fieldName),
    attrs: { 'aria-label': `${getPickerActionLabel(fieldName)} cho bản nháp hiện tại` },
  });
  choose.disabled = !asset.hasSafeUrl || !compatibility.allowed;
  choose.addEventListener('click', () => handleAttachStaticPickerMedia(asset, draftState, item, fieldName, handlers));
  const cancel = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-small', type: 'button', text: 'Hủy chọn' });
  cancel.addEventListener('click', () => closeStaticMediaLibraryPicker(handlers));
  appendChildren(actions, [choose, cancel]);
  body.appendChild(actions);

  card.appendChild(body);
  return card;
}

function renderStaticPickerMediaPreview(asset = {}) {
  const media = createElement('div', { className: 'cms-admin-static-media-picker-preview' });
  if (!asset.hasSafeUrl) {
    media.classList.add('has-error');
    media.appendChild(createElement('span', { text: 'Không có preview an toàn' }));
    return media;
  }

  if (asset.mediaKind === 'video') {
    const video = createElement('video', {
      attrs: { src: asset.safeUrl, controls: 'true', preload: 'metadata' },
    });
    video.addEventListener('error', () => {
      video.hidden = true;
      media.classList.add('has-error');
      media.appendChild(createElement('span', { text: 'Không tải được video' }));
    }, { once: true });
    media.appendChild(video);
    return media;
  }

  if (asset.mediaKind === 'image' || asset.mediaKind === 'poster') {
    const image = createElement('img', {
      attrs: { src: asset.safeUrl, alt: asset.fileName || 'Media trong thư viện', loading: 'lazy' },
    });
    image.addEventListener('error', () => {
      image.hidden = true;
      media.classList.add('has-error');
      media.appendChild(createElement('span', { text: 'Không tải được ảnh' }));
    }, { once: true });
    media.appendChild(image);
    return media;
  }

  media.classList.add('has-error');
  media.appendChild(createElement('span', { text: 'Không rõ loại media' }));
  return media;
}

function handleAttachStaticPickerMedia(asset = {}, draftState = {}, item = {}, fieldName = '', handlers = {}) {
  const current = getState().staticCmsDraft || draftState;
  const currentItem = getSelectedDraftItem(current);
  const itemCode = getItemCode(item);
  if (!current.draftJson || getItemCode(currentItem) !== itemCode || current.selectedRoom !== staticMediaLibraryPickerState.roomKey) {
    staticMediaLibraryPickerState.error = 'Item đang chỉnh đã thay đổi. Hãy mở lại picker để chọn đúng field đích.';
    handlers.onRerender?.();
    return;
  }

  if (!isSelectableStaticPickerMediaAsset(asset)) {
    staticMediaLibraryPickerState.error = 'Media này đã xóa, bị hỏng hoặc không có URL an toàn nên không thể chọn.';
    handlers.onRerender?.();
    return;
  }

  const safeUrl = normalizeSafeStaticPickerMediaUrl(asset.rawUrl);
  if (!safeUrl) {
    staticMediaLibraryPickerState.error = 'Đường dẫn media không thuộc nguồn được phép. Không thể chọn media này.';
    handlers.onRerender?.();
    return;
  }

  const compatibility = getStaticPickerCompatibility(asset, fieldName);
  if (!compatibility.allowed) {
    staticMediaLibraryPickerState.error = compatibility.reason;
    handlers.onRerender?.();
    return;
  }

  const result = applyDraftFieldChange(current, fieldName, safeUrl);
  updateStaticCmsDraftJson(result.draftJson, result.validation);
  staticMediaLibraryPickerState.open = false;
  staticMediaLibraryPickerState.error = '';
  setStaticCmsDraftState({
    previewField: fieldName,
    mediaLibraryPickerError: null,
    mediaLibraryPickerStatus: 'Đã gắn media vào bản nháp. Website đang hoạt động chưa thay đổi cho đến khi bạn lưu và công khai.',
  });
  handlers.onRerender?.();
}

function normalizeStaticPickerMediaAsset(asset = {}) {
  const publicUrl = firstAvailableMediaValue(asset, ['public_url', 'publicUrl', 'url']);
  const storagePath = firstAvailableMediaValue(asset, ['storage_path', 'storagePath', 'path', 'file_name', 'fileName']);
  const rawUrl = publicUrl || '';
  const safeUrl = normalizeSafeStaticPickerMediaUrl(rawUrl);
  const fieldName = firstAvailableMediaValue(asset, ['field_name', 'fieldName']);
  const mediaKind = normalizeStaticPickerMediaKind(
    firstAvailableMediaValue(asset, ['media_kind', 'mediaKind', 'asset_type', 'assetType']),
    fieldName,
    firstAvailableMediaValue(asset, ['mime_type', 'mimeType']),
    storagePath || publicUrl,
  );
  const roomKey = firstAvailableMediaValue(asset, ['room_key', 'roomKey']);
  const itemId = firstAvailableMediaValue(asset, ['item_id', 'itemId']);
  const artworkCode = firstAvailableMediaValue(asset, ['artwork_code', 'artworkCode']);
  const sectionKey = firstAvailableMediaValue(asset, ['section_key', 'sectionKey']);
  const fileName = getStaticPickerFileName(storagePath, safeUrl || publicUrl);
  const searchText = [
    fileName,
    storagePath,
    publicUrl,
    mediaKind,
    fieldName,
    roomKey,
    itemId,
    artworkCode,
    sectionKey,
    firstAvailableMediaValue(asset, ['target_type', 'targetType']),
  ].join(' ').toLowerCase();

  return {
    ...asset,
    id: firstAvailableMediaValue(asset, ['id']) || storagePath || publicUrl || fileName,
    rawUrl,
    safeUrl,
    hasSafeUrl: Boolean(safeUrl),
    storagePath,
    fileName,
    mediaKind,
    mimeType: firstAvailableMediaValue(asset, ['mime_type', 'mimeType']),
    sizeBytes: Number(firstAvailableMediaValue(asset, ['size_bytes', 'sizeBytes'])) || 0,
    targetType: firstAvailableMediaValue(asset, ['target_type', 'targetType']),
    roomKey,
    sectionKey,
    itemId,
    artworkCode,
    fieldName,
    status: firstAvailableMediaValue(asset, ['status']),
    createdAt: firstAvailableMediaValue(asset, ['created_at', 'createdAt']),
    searchText,
  };
}


function isSelectableStaticPickerMediaAsset(asset = {}) {
  const status = String(asset.status || asset.lifecycle || '').trim().toLowerCase();
  if (status === 'deleted' || status === 'deleted-reference' || status === 'broken-reference') return false;
  if (asset.isDeleted || asset.deleted || asset.isBrokenDeletedReference) return false;
  if (!asset.hasSafeUrl || !asset.rawUrl) return false;
  return true;
}

function normalizeSafeStaticPickerMediaUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('blob:') || lower.startsWith('file:')) return '';
  if (isAllowedStaticPickerRelativeMediaPath(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return '';
    const allowedOrigins = new Set(safeArray(STATIC_CMS_DRAFT_CONFIG.allowedMediaOrigins).map((origin) => String(origin || '').trim()).filter(Boolean));
    const allowedHosts = new Set(safeArray(STATIC_CMS_DRAFT_CONFIG.allowedMediaHosts).map((host) => String(host || '').trim().toLowerCase()).filter(Boolean));
    if (allowedOrigins.has(parsed.origin) || allowedHosts.has(parsed.hostname.toLowerCase()) || allowedHosts.has(parsed.host.toLowerCase())) {
      return parsed.href;
    }
  } catch {
    return '';
  }
  return '';
}

function isAllowedStaticPickerRelativeMediaPath(value = '') {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('//') || raw.includes('..') || raw.includes('\\')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  return safeArray(STATIC_CMS_DRAFT_CONFIG.allowedMediaPathPrefixes).some((prefix) => {
    const normalizedPrefix = String(prefix || '').trim();
    return normalizedPrefix && raw.startsWith(normalizedPrefix);
  });
}

function normalizeStaticPickerMediaKind(value = '', fieldName = '', mimeType = '', path = '') {
  const raw = String(value || '').toLowerCase();
  const field = String(fieldName || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  const source = String(path || '').split('?')[0].toLowerCase();
  if (raw.includes('video') || mime.startsWith('video/') || field.includes('video') || /\.(mp4|webm|mov)$/i.test(source)) return 'video';
  if (raw.includes('poster') || field.includes('poster')) return 'poster';
  if (raw.includes('image') || raw.includes('ảnh') || mime.startsWith('image/') || field.includes('image') || /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(source)) return 'image';
  return 'unknown';
}

function matchesStaticPickerFilters(asset = {}, pickerState = {}) {
  const kind = String(pickerState.mediaKindFilter || 'all');
  if (kind !== 'all' && asset.mediaKind !== kind) return false;
  const search = String(pickerState.search || '').trim().toLowerCase();
  if (!search) return true;
  return asset.searchText.includes(search);
}

function getStaticPickerCompatibility(asset = {}, fieldName = '') {
  if (!isSelectableStaticPickerMediaAsset(asset)) return { allowed: false, reason: 'Media này đã xóa, bị hỏng hoặc không có URL an toàn nên không thể chọn.' };
  if (!asset.hasSafeUrl) return { allowed: false, reason: 'Đường dẫn media không thuộc nguồn được phép. Không thể chọn media này.' };
  if (asset.mediaKind === 'unknown') return { allowed: false, reason: 'Không xác định được loại media nên chưa thể gắn vào field này.' };
  if (!isMediaKindCompatibleWithField(asset.mediaKind, fieldName)) {
    return { allowed: false, reason: `Loại ${getMediaKindLabel(asset.mediaKind).toLowerCase()} không phù hợp với field ${getFieldLabel(fieldName)}.` };
  }
  return { allowed: true, reason: '' };
}

function isMediaKindCompatibleWithField(mediaKind = '', fieldName = '') {
  return getAllowedMediaKindsForField(fieldName).includes(String(mediaKind || '').toLowerCase());
}

function getAllowedMediaKindsForField(fieldName = '') {
  const kind = getPrimaryMediaFieldKind(fieldName);
  if (kind === 'video') return ['video'];
  if (kind === 'poster') return ['image', 'poster'];
  return ['image', 'poster'];
}

function getPrimaryMediaFieldKind(fieldName = '') {
  const field = String(fieldName || '').toLowerCase();
  if (field.includes('video')) return 'video';
  if (field.includes('poster') || field.includes('thumbnail')) return 'poster';
  return 'image';
}

function getAllowedMediaKindLabel(fieldName = '') {
  const allowed = getAllowedMediaKindsForField(fieldName).map(getMediaKindLabel);
  return allowed.join(' / ');
}

function getMediaKindLabel(mediaKind = '') {
  const kind = String(mediaKind || '').toLowerCase();
  if (kind === 'video') return 'Video';
  if (kind === 'poster') return 'Poster';
  if (kind === 'image') return 'Ảnh';
  return 'Không rõ';
}

function getPickerActionLabel(fieldName = '') {
  return getPrimaryMediaFieldKind(fieldName) === 'video' ? 'Chọn video này' : 'Chọn ảnh này';
}

function getPickerTargetText(asset = {}) {
  const room = asset.roomKey ? getRoomLabel(asset.roomKey) : '';
  const item = asset.artworkCode || asset.itemId || asset.sectionKey || '';
  if (room && item) return `${room} / ${item}`;
  return room || item || 'Không có metadata';
}

function getStaticPickerFileName(storagePath = '', publicUrl = '') {
  const source = String(storagePath || publicUrl || '').split('?')[0];
  const pieces = source.split('/').filter(Boolean);
  const rawName = pieces[pieces.length - 1] || source || 'media';
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function firstAvailableMediaValue(object = {}, keys = []) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function renderFieldLabel(fieldName, groupKey) {
  const wrap = createElement('span', { className: 'cms-admin-static-field-label' });
  wrap.appendChild(createElement('span', { text: getFieldLabel(fieldName) }));
  if (isOptionalField(fieldName)) {
    wrap.appendChild(createElement('small', { text: 'Không bắt buộc' }));
  }
  if (groupKey === 'media') {
    wrap.appendChild(renderBadge('URL/path', 'warning'));
  }
  return wrap;
}

function getFieldLabel(fieldName) {
  const labels = {
    title: 'Tiêu đề',
    description: 'Mô tả ngắn',
    content: 'Nội dung chi tiết',
    author: 'Tác giả',
    artist: 'Nghệ sĩ / tác giả',
    year: 'Năm',
    material: 'Chất liệu',
    realSize: 'Kích thước thực',
    note: 'Ghi chú',
    imageUrl: 'Ảnh chính / imageUrl',
    thumbnailUrl: 'Ảnh đại diện / thumbnailUrl',
    videoUrl: 'Video MP4 / videoUrl',
    posterUrl: 'Poster video / posterUrl',
  };
  return labels[fieldName] || fieldName;
}

function getFieldHintNode(fieldName, value, groupKey) {
  if (groupKey === 'media') {
    const urlCheck = validateStaticCmsMediaUrl(value, STATIC_CMS_DRAFT_CONFIG);
    const hint = createElement('small', {
      className: urlCheck.valid ? 'cms-admin-help-text' : 'cms-admin-help-text cms-admin-danger-text',
      text: value ? (urlCheck.valid ? `OK: ${getMediaSyncHint(fieldName)}` : `Lỗi: ${urlCheck.reason}`) : `${getMediaSyncHint(fieldName)} Có thể để trống nếu item không dùng media này.`,
    });
    return hint;
  }
  if (fieldName === 'author') return createElement('small', { className: 'cms-admin-help-text', text: 'Khi lưu/công khai sẽ đồng bộ author/artist.' });
  if (fieldName === 'realSize') return createElement('small', { className: 'cms-admin-help-text', text: 'Khi lưu/công khai sẽ đồng bộ realSize/real_size.' });
  return null;
}

function getMediaSyncHint(fieldName) {
  if (fieldName === 'imageUrl') return 'Hệ thống sẽ tự đồng bộ image / imageUrl / image_url.';
  if (fieldName === 'thumbnailUrl') return 'Hệ thống sẽ tự đồng bộ thumbnail / thumbnailUrl / thumbnail_url.';
  if (fieldName === 'videoUrl') return 'Hệ thống sẽ tự đồng bộ videoUrl / video_url.';
  if (fieldName === 'posterUrl') return 'Hệ thống sẽ tự đồng bộ poster / posterUrl / poster_url.';
  return 'Hệ thống sẽ giữ alias tương thích Viewer.';
}

function isLongTextField(fieldName) {
  return ['description', 'content', 'note'].includes(fieldName);
}

function isOptionalField(fieldName) {
  return fieldName !== 'title';
}

function getDraftFieldDisplayValue(item = {}, fieldName) {
  if (fieldName === 'imageUrl') return item.imageUrl || item.image_url || item.image || '';
  if (fieldName === 'thumbnailUrl') return item.thumbnailUrl || item.thumbnail_url || item.thumbnail || '';
  if (fieldName === 'videoUrl') return item.videoUrl || item.video_url || '';
  if (fieldName === 'posterUrl') return item.posterUrl || item.poster_url || item.poster || '';
  if (fieldName === 'realSize') return item.realSize || item.real_size || '';
  return item[fieldName] ?? '';
}

function renderTechnicalAliasDetails(item = {}) {
  const details = createElement('details', { className: 'cms-admin-static-technical-details' });
  details.appendChild(createElement('summary', { text: 'Chi tiết kỹ thuật alias' }));
  const list = createElement('div', { className: 'cms-admin-static-alias-list' });
  TECHNICAL_ALIAS_FIELDS.forEach((field) => {
    const row = createElement('div', { className: 'cms-admin-static-alias-row' });
    row.appendChild(createElement('span', { text: field }));
    row.appendChild(createElement('code', { text: toDisplayText(item[field], '') }));
    list.appendChild(row);
  });
  details.appendChild(list);
  return details;
}

function renderPreviewPanel(draftState = {}, currentItem = {}, copy = {}) {
  const preview = createElement('section', { className: 'cms-admin-panel cms-admin-static-preview-panel' });
  preview.appendChild(renderStaticPanelTitle(copy.previewTitle || 'Preview media'));
  preview.appendChild(renderStaticCmsMediaPreview({
    item: currentItem || {},
    fieldName: draftState.previewField || '',
    config: STATIC_CMS_DRAFT_CONFIG,
  }));
  return preview;
}

function renderValidationPanelCompact(draftState = {}, copy = {}) {
  const validation = draftState.validation || {};
  const errors = Object.keys(validation.errors || {});
  const warnings = Object.keys(validation.warnings || {});
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-static-validation-panel cms-admin-static-inspector-card' });
  panel.appendChild(renderStaticPanelTitle(copy.validationTitle || 'Tình trạng nội dung', validation.valid ? 'Nội dung hợp lệ' : 'Cần kiểm tra'));
  const summary = validation.valid
    ? (warnings.length ? `Nội dung hợp lệ, có ${warnings.length} cảnh báo cần xem.` : 'Nội dung hợp lệ.')
    : (errors.length ? `${errors.length} lỗi cần xử lý.` : 'Chưa có kết quả kiểm tra.');
  panel.appendChild(createElement('div', {
    className: validation.valid ? 'cms-admin-alert cms-admin-alert-success' : 'cms-admin-alert cms-admin-alert-warning',
    text: summary,
  }));
  if (warnings.length) {
    const list = createElement('ul', { className: 'cms-admin-static-message-list cms-admin-static-message-list-compact' });
    warnings.slice(0, 3).forEach((key) => list.appendChild(createElement('li', { text: `${key}: ${validation.warnings[key]}` })));
    if (warnings.length > 3) list.appendChild(createElement('li', { text: `... còn ${warnings.length - 3} cảnh báo. Mở chi tiết kỹ thuật để xem đầy đủ.` }));
    panel.appendChild(list);
  }
  return panel;
}

function renderPublishInspectorPanel(draftState = {}, appState = {}, handlers = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-static-publish-panel cms-admin-static-inspector-card' });
  panel.appendChild(renderStaticPanelTitle('Đưa website lên bản mới', 'Màn riêng'));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Màn chỉnh sửa chỉ dùng để chỉnh và lưu thay đổi. Kiểm tra trước khi đưa lên và công khai website nằm ở màn Đưa website lên bản mới.',
  }));
  const button = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary cms-admin-button-small',
    type: 'button',
    text: 'Tiếp tục: Đưa website lên bản mới',
  });
  button.addEventListener('click', () => handlers.onOpenPublish?.());
  panel.appendChild(button);
  return panel;
}


function renderPublishGatePanel(draftState = {}, appState = {}, handlers = {}, copy = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-static-publish-panel' });
  panel.appendChild(renderStaticPanelTitle('Đưa website lên bản mới', 'Màn riêng'));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Kiểm tra trước khi đưa lên và công khai website đã được tập trung tại màn Đưa website lên bản mới để tránh thao tác trùng lặp trong màn chỉnh sửa.',
  }));
  const button = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    type: 'button',
    text: 'Mở Đưa website lên bản mới',
  });
  button.addEventListener('click', () => handlers.onOpenPublish?.());
  panel.appendChild(button);
  return panel;
}

function renderPublishGateSafetyChecklist(draftState = {}, access = {}, readiness = {}, dryRunReady = false) {
  const list = createElement('ul', { className: 'cms-admin-static-publish-safety-list' });
  const items = [
    ['Quản trị viên đang hoạt động', access.allowed ? 'Đạt' : (access.reason || 'Chưa đủ quyền')],
    ['Bản nháp đã lưu', draftState.currentDraftId ? 'Đạt' : 'Cần lưu thay đổi trước'],
    ['Không dirty', draftState.dirty ? 'Cần lưu thay đổi trước' : 'Đạt'],
    ['Kiểm tra nội dung', draftState.validation?.valid ? 'Đạt' : 'Cần xử lý lỗi/cảnh báo'],
    ['Không đang xử lý', draftState.isSavingDraft || draftState.isUploadingMedia || draftState.isPublishingCms ? 'Đang xử lý, chờ hoàn tất' : 'Đạt'],
    ['Kiểm tra an toàn', dryRunReady ? 'Đạt cho phiên bản hiện tại' : 'Cần chạy kiểm tra trước'],
    ['Công khai thật', readiness.ready && dryRunReady ? 'Cần bấm Công khai và xác nhận' : 'Đang khóa cho đến khi đủ điều kiện'],
  ];
  items.forEach(([label, value]) => {
    const item = createElement('li');
    item.appendChild(createElement('strong', { text: `${label}: ` }));
    item.appendChild(createElement('span', { text: value }));
    list.appendChild(item);
  });
  const wrap = createElement('div', { className: 'cms-admin-static-publish-safety' });
  wrap.appendChild(list);
  return wrap;
}

function renderPublishGateStatus(draftState = {}) {
  const wrap = createElement('div', { className: 'cms-admin-static-publish-status' });
  if (draftState.publishStatus) {
    wrap.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: draftState.publishStatus }));
  }
  if (draftState.publishError) {
    wrap.appendChild(renderErrorBox(draftState.publishError, 'Đưa bản này lên website chưa thành công'));
  }
  const result = draftState.publishResult || draftState.publishDryRunResult;
  if (!result) return wrap;

  const grid = createElement('div', { className: 'cms-admin-static-publish-result-grid' });
  const entries = [
    ['Trạng thái', result.ok === true ? 'Đạt' : 'Lỗi'],
    ['Chế độ', result.dryRun ? 'Kiểm tra an toàn' : 'Công khai'],
    ['Phiên bản kỹ thuật', result.publishedVersion || result.plan?.publishedVersion || '—'],
    ['Latest', result.latestPath || result.plan?.latestPath || '—'],
    ['Backup', result.backupPath || result.plan?.backupPath || '—'],
    ['Versioned', result.versionPath || result.plan?.versionPath || '—'],
    ['Verify', result.verifyStatus || result.verify?.status || '—'],
  ];
  entries.forEach(([label, value]) => grid.appendChild(renderStatusChip(label, String(value || '—'), label === 'Trạng thái' && value === 'PASS' ? 'success' : 'default')));
  const details = createElement('details', { className: 'cms-admin-static-technical-details cms-admin-static-publish-technical-details' });
  details.appendChild(createElement('summary', { text: 'Chi tiết kỹ thuật công khai / kiểm tra' }));
  details.appendChild(grid);
  wrap.appendChild(details);
  if (result.rollbackAttempted) {
    wrap.appendChild(createElement('div', {
      className: result.rollbackVerified ? 'cms-admin-alert cms-admin-alert-success' : 'cms-admin-alert cms-admin-alert-error',
      text: result.rollbackVerified ? 'Công khai lỗi nhưng đã phục hồi nội dung website đang dùng từ bản sao lưu.' : 'Công khai lỗi và phục hồi chưa được xác minh. Cần người vận hành kiểm tra ngay.',
    }));
  }
  return wrap;
}

function renderPublishGateHelp() {
  const wrap = createElement('div', { className: 'cms-admin-static-publish-help' });
  const steps = createElement('ol', { className: 'cms-admin-static-steps' });
  [
    'Lưu thay đổi trước khi công khai; lưu thay đổi không làm đổi website.',
    'Bấm “Kiểm tra an toàn” để bộ kiểm tra trên server kiểm tra bản nháp đã lưu.',
    'Nếu kiểm tra an toàn đạt, bấm “Đưa bản này lên website” và xác nhận 2 bước. Lúc này website mới có thể thay đổi.',
    'Lịch sử/khôi phục là quy trình riêng để xử lý sau công khai; không tự chạy khi chỉ mở màn này.',
  ].forEach((step) => steps.appendChild(createElement('li', { text: step })));
  wrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Chi tiết kỹ thuật được giữ cho người quản trị kỹ thuật. Người vận hành chỉ cần làm theo các bước ở trên.' }));
  wrap.appendChild(steps);
  return wrap;
}

export function buildCmsPublishInclusionStatus({ data = {}, draftState = {} } = {}) {
  const draftJson = draftState.draftJson || null;
  const draftSavedAt = normalizePublishTimestamp(draftState.draftLastSavedAt);
  const hasSavedDraft = Boolean(String(draftState.currentDraftId || '').trim());
  const hasDraftJson = Boolean(draftJson);
  const hasDraftVersion = Boolean(String(draftJson?.version || draftState.draftMeta?.version || '').trim());
  const draftClean = hasSavedDraft && hasDraftJson && !draftState.dirty;
  const baselineJson = draftState.baselineJson || null;
  const context = { draftJson, baselineJson, draftSavedAt, hasSavedDraft, hasDraftJson, hasDraftVersion, draftClean };
  const items = [
    buildDraftContentBackedInclusionItem({
      key: 'static_rooms',
      label: 'Nội dung phòng 3D',
      context,
      fragmentGetter: pickRoomsCompositionFragment,
      technical: 'draft.rooms.indoor + draft.rooms.outdoor compared against persisted baseline snapshot',
    }),
    buildDraftContentBackedInclusionItem({
      key: 'featured_artworks',
      label: 'Tác phẩm tiêu biểu',
      context,
      fragmentGetter: pickFeaturedCompositionFragment,
      technical: 'draft.index.featuredArtworks compared against persisted baseline snapshot',
    }),
    buildContentBackedInclusionItem({
      key: 'home',
      label: 'Trang chủ',
      projection: projectIndexSectionsToDraftPatch(safeArray(data.indexSections), draftJson?.index || {}),
      context,
      updatedAt: getLatestUpdatedAt(safeArray(data.indexSections)),
      required: true,
    }),
    buildContentBackedInclusionItem({
      key: 'gate',
      label: 'Cổng vào triển lãm',
      projection: projectGateContentToDraftPatch(data.gateContent || null, draftJson?.gate || {}),
      context,
      updatedAt: data.gateContent?.updated_at || data.gateContent?.updatedAt || '',
      required: true,
    }),
    buildContentBackedInclusionItem({
      key: 'site_settings',
      label: 'Thông tin website',
      projection: projectSiteSettingsToDraftPatch(data.siteSettings || null, draftJson || {}),
      context,
      updatedAt: data.siteSettings?.updated_at || data.siteSettings?.updatedAt || '',
      required: true,
    }),
  ];
  const blocksPublish = items.some((item) => item.blocksPublish === true);
  const firstBlock = items.find((item) => item.blocksPublish);
  const hasDifferent = items.some((item) => item.status === 'different');
  const hasNewerChanges = hasDifferent || items.some((item) => item.status === 'newer_than_draft');
  const hasUnverifiableCritical = items.some((item) => item.blocksPublish && ['unverifiable', 'missing_draft'].includes(item.status));
  return {
    items,
    blocksPublish,
    firstBlock,
    hasDifferent,
    hasNewerChanges,
    hasUnverifiableCritical,
    hasDraftTimestamp: Boolean(draftSavedAt),
    summary: blocksPublish
      ? hasDifferent
        ? 'Có nội dung đã lưu khác với bản chuẩn bị.'
        : 'Có khu vực cần đối chiếu trước khi công khai.'
      : 'Các khu vực quan trọng đã được đối chiếu bằng nội dung thật.',
    primaryActionLabel: hasDifferent ? 'Cập nhật bản chuẩn bị từ nội dung đã lưu' : 'Xem khu vực cần đối chiếu',
    primaryActionNote: hasDifferent
      ? 'Đưa nội dung đã lưu ở các màn vào bản chuẩn bị trong trình duyệt. Website đang hoạt động chưa thay đổi.'
      : (firstBlock?.reason || 'Cần xem bảng đối chiếu bản chuẩn bị trước khi tiếp tục.'),
  };
}

function buildDraftContentBackedInclusionItem({ key, label, context = {}, fragmentGetter = null, technical = '' } = {}) {
  const draftSavedAt = context.draftSavedAt || '';
  if (!context.hasDraftJson) {
    return buildPublishInclusionItem({
      key,
      label,
      status: 'missing_draft',
      reason: 'Chưa có bản chuẩn bị trong trình duyệt để đối chiếu.',
      draftSavedAt,
      blocksPublish: true,
      nextAction: 'Tải nội dung website hiện tại rồi lưu bản chuẩn bị.',
      technical,
    });
  }
  if (!context.hasSavedDraft || !draftSavedAt) {
    return buildPublishInclusionItem({
      key,
      label,
      status: 'unverifiable',
      reason: 'Chưa có thời điểm lưu bản chuẩn bị để chứng minh nội dung này thuộc bản sẽ công khai.',
      draftSavedAt,
      blocksPublish: true,
      nextAction: 'Lưu bản chuẩn bị trước khi kiểm tra hoặc công khai.',
      technical,
    });
  }
  if (!context.hasDraftVersion) {
    return buildPublishInclusionItem({
      key,
      label,
      status: 'unverifiable',
      reason: 'Bản chuẩn bị thiếu phiên bản dữ liệu để đối chiếu an toàn.',
      draftSavedAt,
      blocksPublish: true,
      nextAction: 'Kiểm tra lại nội dung bản chuẩn bị trước khi tiếp tục.',
      technical,
    });
  }
  if (!context.draftClean) {
    return buildPublishInclusionItem({
      key,
      label,
      status: 'unverifiable',
      reason: 'Bản chuẩn bị đang có thay đổi chưa lưu nên chưa thể chứng minh nội dung này đã nằm trong bản sẽ công khai.',
      draftSavedAt,
      blocksPublish: true,
      nextAction: 'Lưu thay đổi vào bản chuẩn bị.',
      technical,
    });
  }
  if (typeof fragmentGetter !== 'function' || !isPlainObjectValue(context.baselineJson)) {
    return buildPublishInclusionItem({
      key,
      label,
      status: 'unverifiable',
      reason: 'Chưa có bản đã lưu để đối chiếu nội dung thật của khu vực này.',
      draftSavedAt,
      blocksPublish: true,
      nextAction: 'Lưu bản chuẩn bị rồi kiểm tra lại.',
      technical,
    });
  }
  if (!hasRequiredDraftBackedFragment(key, context.draftJson || {}) || !hasRequiredDraftBackedFragment(key, context.baselineJson || {})) {
    return buildPublishInclusionItem({
      key,
      label,
      status: 'unverifiable',
      reason: `${label} thiếu fragment quan trọng trong bản chuẩn bị đã lưu hoặc bản đang mở.`,
      draftSavedAt,
      blocksPublish: true,
      nextAction: 'Tải lại hoặc lưu lại bản chuẩn bị trước khi kiểm tra.',
      technical,
    });
  }
  const draftFragment = fragmentGetter(context.draftJson || {});
  const persistedFragment = fragmentGetter(context.baselineJson || {});
  if (!normalizedDeepEqual(draftFragment, persistedFragment)) {
    return buildPublishInclusionItem({
      key,
      label,
      status: 'different',
      reason: `${label} trong trình duyệt khác với bản chuẩn bị đã lưu. Cần lưu lại bản chuẩn bị trước khi kiểm tra hoặc công khai.`,
      draftSavedAt,
      blocksPublish: true,
      nextAction: 'Lưu thay đổi vào bản chuẩn bị.',
      technical,
    });
  }
  return buildPublishInclusionItem({
    key,
    label,
    status: 'included',
    reason: 'Nội dung này đã khớp với bản chuẩn bị đã lưu.',
    draftSavedAt,
    updatedAt: draftSavedAt,
    blocksPublish: false,
    nextAction: '',
    technical,
  });
}


function hasRequiredDraftBackedFragment(key = '', cmsJson = {}) {
  if (key === 'static_rooms') {
    return Array.isArray(cmsJson?.rooms?.indoor?.artworks) && Array.isArray(cmsJson?.rooms?.outdoor?.artworks);
  }
  if (key === 'featured_artworks') {
    const featured = getRawFeaturedSection(cmsJson);
    return isPlainObjectValue(featured) && Array.isArray(featured.items);
  }
  return true;
}

function pickRoomsCompositionFragment(cmsJson = {}) {
  return {
    rooms: {
      indoor: cloneJson(cmsJson?.rooms?.indoor || {}),
      outdoor: cloneJson(cmsJson?.rooms?.outdoor || {}),
    },
  };
}

function pickFeaturedCompositionFragment(cmsJson = {}) {
  return {
    index: {
      featuredArtworks: cloneJson(cmsJson?.index?.featuredArtworks || []),
    },
  };
}

function buildContentBackedInclusionItem({ key, label, projection, context = {}, updatedAt = '', required = true } = {}) {
  const draftSavedAt = context.draftSavedAt || '';
  const normalizedUpdatedAt = normalizePublishTimestamp(updatedAt);
  if (!context.hasDraftJson) {
    return buildPublishInclusionItem({
      key,
      label,
      status: 'missing_draft',
      reason: 'Chưa có bản chuẩn bị để đối chiếu nội dung đã lưu.',
      updatedAt: normalizedUpdatedAt,
      draftSavedAt,
      blocksPublish: required,
      nextAction: 'Tải nội dung website hiện tại rồi lưu bản chuẩn bị.',
    });
  }
  if (!projection?.ok) {
    return buildPublishInclusionItem({
      key,
      label,
      status: 'unverifiable',
      reason: projection?.reason || 'Thiếu dữ liệu hoặc mapping để đối chiếu khu vực này.',
      updatedAt: normalizedUpdatedAt,
      draftSavedAt,
      blocksPublish: required,
      nextAction: 'Tải lại trạng thái hoặc kiểm tra nguồn dữ liệu của khu vực này.',
      technical: projection?.technical || '',
    });
  }
  const included = normalizedDeepEqual(projection.draftFragment, projection.sourceFragment);
  if (!included) {
    return buildPublishInclusionItem({
      key,
      label,
      status: 'different',
      reason: `${label} đang khác với nội dung trong bản chuẩn bị. Cần cập nhật bản chuẩn bị trước khi kiểm tra hoặc công khai.`,
      updatedAt: normalizedUpdatedAt,
      draftSavedAt,
      blocksPublish: true,
      nextAction: 'Cập nhật bản chuẩn bị từ nội dung đã lưu.',
      technical: projection.technical || '',
    });
  }
  return buildPublishInclusionItem({
    key,
    label,
    status: 'included',
    reason: 'Nội dung tương ứng đã có trong bản chuẩn bị đang chọn.',
    updatedAt: normalizedUpdatedAt,
    draftSavedAt,
    blocksPublish: false,
    nextAction: '',
    technical: projection.technical || '',
  });
}

function buildPublishInclusionItem({ key = '', label = '', status = 'unverifiable', reason = '', updatedAt = '', draftSavedAt = '', blocksPublish = false, nextAction = '', technical = '' } = {}) {
  return {
    key,
    label,
    status,
    reason,
    updatedAt: updatedAt || '',
    draftSavedAt: draftSavedAt || '',
    blocksPublish: Boolean(blocksPublish),
    nextAction,
    technical,
  };
}

export function composeCmsPreparationDraft({ draftJson = null, data = {} } = {}) {
  if (!isPlainObjectValue(draftJson)) {
    return {
      ok: false,
      draftJson: null,
      changed: false,
      changedAreas: [],
      unchangedAreas: [],
      blockedAreas: [{ key: 'draft', label: 'Bản chuẩn bị', reason: 'Chưa có draft JSON hợp lệ để cập nhật.' }],
      errors: ['Chưa có draft JSON hợp lệ để cập nhật.'],
      changes: [],
    };
  }
  const nextDraft = cloneJson(draftJson);
  const changedAreas = [];
  const unchangedAreas = [];
  const blockedAreas = [];
  const errors = [];
  const changes = [];
  const areas = [
    {
      key: 'home',
      label: 'Trang chủ',
      projection: projectIndexSectionsToDraftPatch(safeArray(data.indexSections), draftJson.index || {}),
      apply: (draft, sourceFragment, projection) => { draft.index = cloneJson(projection.fullIndex || sourceFragment.index); },
    },
    {
      key: 'gate',
      label: 'Cổng vào triển lãm',
      projection: projectGateContentToDraftPatch(data.gateContent || null, draftJson.gate || {}),
      apply: (draft, sourceFragment) => { draft.gate = cloneJson(sourceFragment.gate); },
    },
    {
      key: 'site_settings',
      label: 'Thông tin website',
      projection: projectSiteSettingsToDraftPatch(data.siteSettings || null, draftJson),
      apply: (draft, sourceFragment) => {
        draft.site = cloneJson(sourceFragment.site);
        draft.index = isPlainObjectValue(draft.index) ? draft.index : {};
        if (isPlainObjectValue(sourceFragment.indexContact)) {
          draft.index.contact = cloneJson(sourceFragment.indexContact);
        }
      },
    },
  ];

  areas.forEach((area) => {
    const projection = area.projection || {};
    if (!projection.ok) {
      const reason = projection.reason || `Không thể đối chiếu ${area.label}.`;
      blockedAreas.push({ key: area.key, label: area.label, reason });
      errors.push(`${area.label}: ${reason}`);
      return;
    }
    if (normalizedDeepEqual(projection.draftFragment, projection.sourceFragment)) {
      unchangedAreas.push({ key: area.key, label: area.label });
      return;
    }
    area.apply(nextDraft, projection.sourceFragment, projection);
    changedAreas.push({ key: area.key, label: area.label });
    changes.push({ key: area.key, label: area.label, technical: projection.technical || '' });
  });

  return {
    ok: blockedAreas.length === 0,
    draftJson: blockedAreas.length === 0 ? nextDraft : cloneJson(draftJson),
    changed: changedAreas.length > 0,
    changedAreas,
    unchangedAreas,
    blockedAreas,
    errors,
    changes,
  };
}

export async function handleComposeCmsPreparationDraft({ handlers = {} } = {}) {
  const appState = getState();
  const draftState = appState.staticCmsDraft || {};
  if (!draftState.draftJson) {
    setStaticCmsDraftState({ preparationCompositionError: 'Cần tải nội dung hoặc mở bản chuẩn bị trước khi cập nhật.', preparationCompositionStatus: '', preparationCompositionResult: null });
    handlers.onRerender?.();
    return;
  }
  if (draftState.isSavingDraft || draftState.isPublishingCms || draftState.isComposingPreparationDraft) {
    setStaticCmsDraftState({ preparationCompositionError: 'Đang có thao tác lưu/kiểm tra/công khai. Hãy chờ thao tác hiện tại hoàn tất.', preparationCompositionStatus: '', preparationCompositionResult: null });
    handlers.onRerender?.();
    return;
  }
  const dirtyExternal = getBlockingExternalEditSessions(appState);
  if (dirtyExternal.length) {
    setStaticCmsDraftState({
      preparationCompositionError: `Bạn đang có thay đổi chưa lưu ở ${dirtyExternal.map((item) => item.label).join(', ')}. Hãy lưu hoặc hủy thay đổi đó trước khi cập nhật bản chuẩn bị.`,
      preparationCompositionStatus: '',
      preparationCompositionResult: null,
    });
    handlers.onRerender?.();
    return;
  }

  const currentDraftJson = cloneJson(draftState.draftJson);
  setStaticCmsDraftState({
    isComposingPreparationDraft: true,
    preparationCompositionError: null,
    preparationCompositionStatus: 'Đang đọc nội dung đã lưu mới nhất...',
    preparationCompositionResult: null,
  });
  handlers.onRerender?.();

  try {
    const refresh = await fetchDashboardData(appState.supabase);
    const refreshErrors = refresh?.errors || {};
    const criticalError = refreshErrors.siteSettings || refreshErrors.indexSections || refreshErrors.gateContent || null;
    if (criticalError) {
      throw new Error(`Không đọc được dữ liệu cần ghép: ${normalizeErrorMessage(criticalError)}`);
    }
    if (refresh?.data) setNestedData(refresh.data);
    const composition = composeCmsPreparationDraft({ draftJson: currentDraftJson, data: refresh?.data || appState.data || {} });
    if (!composition.ok) {
      setStaticCmsDraftState({
        isComposingPreparationDraft: false,
        preparationCompositionError: composition.errors.join(' | ') || 'Không thể cập nhật bản chuẩn bị từ nội dung đã lưu.',
        preparationCompositionStatus: '',
        preparationCompositionResult: composition,
      });
      handlers.onRerender?.();
      return;
    }
    const validation = validateStaticCmsDraft(composition.draftJson, STATIC_CMS_DRAFT_CONFIG);
    if (!validation.valid) {
      setStaticCmsDraftState({
        isComposingPreparationDraft: false,
        preparationCompositionError: `Bản chuẩn bị sau cập nhật chưa đạt kiểm tra cấu trúc (${Object.keys(validation.errors || {}).length} lỗi). Chưa cập nhật vào state.`,
        preparationCompositionStatus: '',
        preparationCompositionResult: { ...composition, validation },
      });
      handlers.onRerender?.();
      return;
    }
    setStaticCmsDraftState({
      draftJson: composition.draftJson,
      dirty: true,
      validation,
      isComposingPreparationDraft: false,
      preparationCompositionError: null,
      preparationCompositionStatus: composition.changed
        ? `Đã cập nhật vào bản chuẩn bị: ${composition.changedAreas.map((area) => area.label).join(', ')}. Chưa lưu bản chuẩn bị.`
        : 'Bản chuẩn bị đã khớp với nội dung đã lưu. Không có thay đổi mới cần ghép.',
      preparationCompositionResult: composition,
      draftSaveStatus: composition.changed ? 'Có thay đổi chưa lưu lại bản chuẩn bị server.' : draftState.draftSaveStatus,
      draftPersistenceError: null,
      publishDryRunResult: null,
      publishResult: null,
      publishStatus: '',
      publishError: null,
      publishLastVerifiedAt: null,
    });
  } catch (error) {
    setStaticCmsDraftState({
      isComposingPreparationDraft: false,
      preparationCompositionError: normalizeErrorMessage(error),
      preparationCompositionStatus: '',
      preparationCompositionResult: null,
    });
  }
  handlers.onRerender?.();
}

function getBlockingExternalEditSessions(appState = {}) {
  const blockers = [];
  if (appState.siteSettingsEdit?.dirty || appState.siteSettingsEdit?.saving) blockers.push({ label: 'Thông tin website' });
  if (appState.gateEdit?.dirty || appState.gateEdit?.saving) blockers.push({ label: 'Cổng vào triển lãm' });
  if (appState.homeEdit?.dirty || appState.homeEdit?.saving) blockers.push({ label: 'Trang chủ' });
  if (appState.staticCmsDraft?.isSavingDraft || appState.staticCmsDraft?.isPublishingCms) blockers.push({ label: 'Bản chuẩn bị CMS' });
  return blockers;
}

function projectIndexSectionsToDraftPatch(indexSections = [], draftIndex = {}) {
  if (!Array.isArray(indexSections)) {
    return { ok: false, reason: 'Không đọc được danh sách khu vực Trang chủ.', technical: 'index_sections not array' };
  }
  if (!indexSections.length) {
    return { ok: false, reason: 'Chưa có dữ liệu Trang chủ để đối chiếu.', technical: 'index_sections empty' };
  }
  const byKey = new Map(indexSections.map((section) => [String(section?.section_key || '').trim(), section]).filter(([key]) => key));
  const nextIndex = cloneJson(draftIndex || {});
  const hero = byKey.get('hero');
  if (hero) nextIndex.hero = projectHeroSection(hero, nextIndex.hero || {});
  const experience = byKey.get('experience');
  if (experience) nextIndex.experience = projectExperienceSection(experience, nextIndex.experience || {});
  const guide = byKey.get('guide');
  if (guide) nextIndex.guide = projectGuideSection(guide, nextIndex.guide || {});
  const contact = byKey.get('contact');
  if (contact) nextIndex.contact = projectIndexContactSection(contact, nextIndex.contact || {});
  return {
    ok: true,
    draftFragment: { index: pickIndexCompositionFragment(draftIndex || {}) },
    sourceFragment: { index: pickIndexCompositionFragment(nextIndex) },
    fullIndex: nextIndex,
    technical: 'index_sections -> index.hero, index.experience, index.guide, index.contact; index.featuredArtworks preserved',
  };
}

function pickIndexCompositionFragment(index = {}) {
  const source = isPlainObjectValue(index) ? index : {};
  const fragment = {};
  ['hero', 'experience', 'guide', 'contact'].forEach((key) => {
    if (isPlainObjectValue(source[key])) fragment[key] = cloneJson(source[key]);
  });
  return fragment;
}

function projectHeroSection(section = {}, existing = {}) {
  const out = cloneJson(existing || {});
  setTextIfOwn(out, 'eyebrow', section, 'eyebrow');
  setTextIfOwn(out, 'title', section, 'title');
  setTextIfOwn(out, 'subtitle', section, 'subtitle');
  setTextIfOwn(out, 'lead', section, 'lead');
  if (hasOwn(section, 'body') && String(section.body || '').trim()) {
    if (hasOwn(out, 'recommendation')) out.recommendation = normalizeTextValue(section.body);
    else out.body = normalizeTextValue(section.body);
  }
  const items = coerceArrayValue(section.items_json);
  if (Array.isArray(items)) out.proofChips = items.map((item) => typeof item === 'string' ? item : firstTextValue(item, ['title', 'label', 'name', 'text'])).filter(Boolean);
  const media = coerceObjectValue(section.media_json);
  if (media) out.media = media;
  const cta = coerceObjectValue(section.cta_json);
  if (cta) out.cta = cta;
  return out;
}

function projectExperienceSection(section = {}, existing = {}) {
  const out = cloneJson(existing || {});
  if (hasOwn(section, 'eyebrow')) out.kicker = normalizeTextValue(section.eyebrow);
  setTextIfOwn(out, 'title', section, 'title');
  setTextIfOwn(out, 'subtitle', section, 'subtitle');
  setTextIfOwn(out, 'lead', section, 'lead');
  setTextIfOwn(out, 'body', section, 'body');
  const items = coerceArrayValue(section.items_json);
  if (Array.isArray(items)) out.routes = items.map((item) => coerceObjectValue(item) || { title: normalizeTextValue(item) });
  const media = coerceObjectValue(section.media_json);
  if (media) out.media = media;
  const cta = coerceObjectValue(section.cta_json);
  if (cta) out.cta = cta;
  return out;
}

function projectGuideSection(section = {}, existing = {}) {
  const out = cloneJson(existing || {});
  if (hasOwn(section, 'eyebrow')) out.kicker = normalizeTextValue(section.eyebrow);
  setTextIfOwn(out, 'title', section, 'title');
  setTextIfOwn(out, 'subtitle', section, 'subtitle');
  setTextIfOwn(out, 'lead', section, 'lead');
  setTextIfOwn(out, 'body', section, 'body');
  const items = coerceArrayValue(section.items_json);
  if (Array.isArray(items)) out.steps = items.map((item) => coerceObjectValue(item) || { title: normalizeTextValue(item) });
  return out;
}

function projectIndexContactSection(section = {}, existing = {}) {
  const out = cloneJson(existing || {});
  if (hasOwn(section, 'eyebrow') && String(section.eyebrow || '').trim()) out.label = normalizeTextValue(section.eyebrow);
  if (hasOwn(section, 'title') && String(section.title || '').trim()) out.organizationName = normalizeTextValue(section.title);
  if (hasOwn(section, 'lead') && String(section.lead || '').trim()) out.address = normalizeTextValue(section.lead);
  if (hasOwn(section, 'body') && String(section.body || '').trim()) out.phoneFax = normalizeTextValue(section.body);
  return out;
}

function projectGateContentToDraftPatch(gateContent = null, draftGate = {}) {
  if (!isPlainObjectValue(gateContent)) {
    return { ok: false, reason: 'Không đọc được dữ liệu Cổng vào triển lãm.', technical: 'gate_content missing' };
  }
  const nextGate = cloneJson(draftGate || {});
  setTextIfOwn(nextGate, 'eyebrow', gateContent, 'eyebrow');
  setTextIfOwn(nextGate, 'title', gateContent, 'title');
  setTextIfOwn(nextGate, 'description', gateContent, 'description');
  if (hasOwn(gateContent, 'back_label')) nextGate.backLabel = normalizeTextValue(gateContent.back_label);
  const rooms = coerceObjectValue(gateContent.rooms_json);
  if (rooms) nextGate.rooms = rooms;
  const editor = coerceObjectValue(gateContent.editor_json);
  if (editor) nextGate.editor = editor;
  return {
    ok: true,
    draftFragment: { gate: cloneJson(draftGate || {}) },
    sourceFragment: { gate: nextGate },
    technical: 'gate_content -> gate.eyebrow/title/description/backLabel/rooms/editor',
  };
}

function projectSiteSettingsToDraftPatch(siteSettings = null, draftJson = {}) {
  if (!isPlainObjectValue(siteSettings)) {
    return { ok: false, reason: 'Không đọc được dữ liệu Thông tin website.', technical: 'site_settings missing' };
  }
  const currentSite = isPlainObjectValue(draftJson.site) ? draftJson.site : {};
  const nextSite = cloneJson(currentSite || {});
  const fieldMap = [
    ['site_title', 'siteTitle'],
    ['organization_name', 'organizationName'],
    ['address', 'address'],
    ['phone', 'phone'],
    ['fax', 'fax'],
    ['email', 'email'],
    ['logo_url', 'logoUrl'],
  ];
  fieldMap.forEach(([sourceKey, targetKey]) => setTextIfOwn(nextSite, targetKey, siteSettings, sourceKey));

  const currentContact = isPlainObjectValue(draftJson.index?.contact) ? draftJson.index.contact : {};
  const nextContact = cloneJson(currentContact || {});
  if (!nextContact.label) nextContact.label = 'Đơn vị thực hiện';
  if (hasOwn(siteSettings, 'organization_name')) nextContact.organizationName = normalizeTextValue(siteSettings.organization_name);
  if (hasOwn(siteSettings, 'address')) nextContact.address = normalizeTextValue(siteSettings.address);
  if (hasOwn(siteSettings, 'phone') || hasOwn(siteSettings, 'fax')) {
    const phone = hasOwn(siteSettings, 'phone') ? normalizeTextValue(siteSettings.phone) : normalizeTextValue(currentSite.phone || '');
    const fax = hasOwn(siteSettings, 'fax') ? normalizeTextValue(siteSettings.fax) : normalizeTextValue(currentSite.fax || '');
    nextContact.phoneFax = buildPhoneFaxLabel(phone, fax);
  }
  return {
    ok: true,
    draftFragment: {
      site: cloneJson(currentSite || {}),
      indexContact: cloneJson(currentContact || {}),
    },
    sourceFragment: {
      site: nextSite,
      indexContact: nextContact,
    },
    technical: 'site_settings -> site.* and index.contact display fields',
  };
}

function buildPhoneFaxLabel(phone = '', fax = '') {
  const normalizedPhone = normalizeTextValue(phone);
  const normalizedFax = normalizeTextValue(fax);
  if (normalizedPhone && normalizedFax) return `${normalizedPhone} - Fax: ${normalizedFax}`;
  if (normalizedPhone) return normalizedPhone;
  if (normalizedFax) return `Fax: ${normalizedFax}`;
  return '';
}

function setTextIfOwn(target = {}, targetKey = '', source = {}, sourceKey = '') {
  if (!hasOwn(source, sourceKey)) return;
  target[targetKey] = normalizeTextValue(source[sourceKey]);
}

function firstTextValue(object = {}, keys = []) {
  const source = isPlainObjectValue(object) ? object : {};
  for (const key of keys) {
    if (!hasOwn(source, key)) continue;
    const text = normalizeTextValue(source[key]);
    if (text) return text;
  }
  return '';
}

function coerceObjectValue(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObjectValue(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainObjectValue(value) ? cloneJson(value) : null;
}

function coerceArrayValue(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? cloneJson(parsed) : null;
    } catch {
      return null;
    }
  }
  return Array.isArray(value) ? cloneJson(value) : null;
}

function normalizeTextValue(value = '') {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value.trim() : String(value).trim();
}

function normalizedDeepEqual(left, right) {
  return JSON.stringify(normalizeForStableCompare(left)) === JSON.stringify(normalizeForStableCompare(right));
}

function normalizeForStableCompare(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeForStableCompare(item));
  if (isPlainObjectValue(value)) {
    return Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .reduce((out, key) => {
        out[key] = normalizeForStableCompare(value[key]);
        return out;
      }, {});
  }
  return value;
}

function isPlainObjectValue(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object = {}, key = '') {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function getLatestUpdatedAt(records = []) {
  let latest = '';
  safeArray(records).forEach((record) => {
    const value = normalizePublishTimestamp(record?.updated_at || record?.updatedAt || '');
    if (value && (!latest || isPublishTimestampAfter(value, latest))) latest = value;
  });
  return latest;
}

function normalizePublishTimestamp(value = '') {
  const time = toComparableTimestampMs(value);
  if (time === null) return '';
  return new Date(time).toISOString();
}

function normalizeDraftRevisionToken(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return Number.isFinite(Date.parse(text)) ? text : '';
}

function toComparableTimestampMs(value = '') {
  const time = Date.parse(String(value || '').trim());
  return Number.isFinite(time) ? time : null;
}

function areDraftRevisionTokensEqual(left = '', right = '') {
  const leftToken = normalizeDraftRevisionToken(left);
  const rightToken = normalizeDraftRevisionToken(right);
  return Boolean(leftToken && rightToken && leftToken === rightToken);
}

function normalizeSha256Hash(value = '') {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : '';
}

function isPublishTimestampAfter(left = '', right = '') {
  const leftTime = toComparableTimestampMs(left);
  const rightTime = toComparableTimestampMs(right);
  return leftTime !== null && rightTime !== null && leftTime > rightTime;
}


export function normalizePersistedCmsDraftSnapshot(row = {}, expectedDraftId = '') {
  const expectedId = String(expectedDraftId || '').trim();
  const id = String(row?.id || '').trim();
  if (!id) return { ok: false, code: 'missing_id', reason: 'Không đọc lại được ID bản chuẩn bị đã lưu.' };
  if (expectedId && id !== expectedId) return { ok: false, code: 'draft_id_mismatch', reason: 'Bản đã đọc lại không khớp ID bản đang mở.' };
  const rawContent = row?.content_json || row?.contentJson || null;
  if (!isPlainObjectValue(rawContent)) return { ok: false, code: 'missing_content_json', reason: 'Không đọc lại được nội dung bản chuẩn bị đã lưu.' };
  const contentJson = sanitizeStaticCmsExport(rawContent, { keepVersion: true });
  const version = String(contentJson?.version || row?.source_version || row?.sourceVersion || '').trim();
  if (!version) return { ok: false, code: 'missing_version', reason: 'Bản chuẩn bị đã lưu thiếu phiên bản dữ liệu.' };
  const updatedAtRaw = normalizeDraftRevisionToken(row?.updated_at || row?.updatedAt || '');
  if (!updatedAtRaw) return { ok: false, code: 'missing_updated_at', reason: 'Bản chuẩn bị đã lưu thiếu revision cập nhật hợp lệ.' };
  const updatedAtMs = toComparableTimestampMs(updatedAtRaw);
  if (updatedAtMs === null) return { ok: false, code: 'invalid_updated_at', reason: 'Revision cập nhật của bản chuẩn bị không hợp lệ.' };
  return {
    ok: true,
    snapshot: {
      id,
      updatedAt: updatedAtRaw,
      updatedAtRaw,
      updatedAtMs,
      version,
      contentJson,
      title: row?.title || '',
      note: row?.note || '',
      sourceVersion: row?.source_version || row?.sourceVersion || '',
    },
  };
}

async function readPersistedCmsDraftSnapshot(client, expectedDraftId = '') {
  const result = await getCmsDraft(client, expectedDraftId);
  if (result.error || !result.data) {
    return { ok: false, code: 'readback_failed', reason: normalizeErrorMessage(result.error || 'Không tìm thấy bản chuẩn bị đã lưu.') };
  }
  return normalizePersistedCmsDraftSnapshot(result.data, expectedDraftId);
}

export async function verifyPersistedDraftForPublish({ appState = getState(), draftState = null, expectedDraftId = '' } = {}) {
  const currentDraftState = draftState || appState.staticCmsDraft || {};
  const draftId = String(expectedDraftId || currentDraftState.currentDraftId || '').trim();
  const persistedDraftId = String(currentDraftState.persistedDraftId || '').trim();
  if (!draftId) return { ok: false, code: 'missing_draft_id', reason: 'Cần lưu bản chuẩn bị trước khi kiểm tra hoặc đưa lên website.' };
  if (persistedDraftId && persistedDraftId !== draftId) return { ok: false, code: 'draft_identity_mismatch', reason: 'Bản đang mở không khớp persisted draft đã đọc lại.' };
  if (currentDraftState.dirty) return { ok: false, code: 'local_dirty', reason: 'Bản chuẩn bị trong trình duyệt có thay đổi chưa lưu.' };
  const readback = await readPersistedCmsDraftSnapshot(appState.supabase, draftId);
  if (!readback.ok) return readback;
  const persistedDraft = readback.snapshot;
  const localJson = isPlainObjectValue(currentDraftState.draftJson)
    ? sanitizeStaticCmsExport(currentDraftState.draftJson, { keepVersion: true })
    : null;
  if (!localJson || !normalizedDeepEqual(localJson, persistedDraft.contentJson)) {
    return {
      ok: false,
      code: 'local_persisted_mismatch',
      reason: 'Bản đang mở không khớp bản đã lưu trong CMS. Hãy lưu lại bản chuẩn bị rồi kiểm tra lại.',
      persistedDraft,
    };
  }
  const validation = validateStaticCmsDraft(persistedDraft.contentJson, STATIC_CMS_DRAFT_CONFIG);
  if (!validation.valid) {
    return {
      ok: false,
      code: 'persisted_validation_failed',
      reason: 'Bản chuẩn bị đã lưu chưa đạt kiểm tra cấu trúc. Hãy sửa và lưu lại trước khi đưa lên website.',
      persistedDraft,
      validation,
    };
  }
  const dashboard = await fetchDashboardData(appState.supabase);
  const refreshErrors = dashboard?.errors || {};
  const criticalError = refreshErrors.siteSettings || refreshErrors.indexSections || refreshErrors.gateContent || null;
  if (criticalError) {
    return {
      ok: false,
      code: 'dashboard_refresh_failed',
      reason: `Không đọc được nội dung đã lưu mới nhất để đối chiếu: ${normalizeErrorMessage(criticalError)}`,
      persistedDraft,
      validation,
      dashboardData: dashboard?.data || null,
    };
  }
  const persistedDraftState = {
    ...currentDraftState,
    draftJson: persistedDraft.contentJson,
    baselineJson: persistedDraft.contentJson,
    currentDraftId: persistedDraft.id,
    draftLastSavedAt: persistedDraft.updatedAt,
    persistedDraftId: persistedDraft.id,
    persistedDraftUpdatedAt: persistedDraft.updatedAt,
    persistedDraftVersion: persistedDraft.version,
    dirty: false,
    validation,
  };
  const inclusionStatus = buildCmsPublishInclusionStatus({ data: dashboard?.data || {}, draftState: persistedDraftState });
  if (inclusionStatus.blocksPublish) {
    return {
      ok: false,
      code: 'inclusion_blocked',
      reason: inclusionStatus.firstBlock?.reason || 'Một số khu vực chưa có trong bản chuẩn bị.',
      persistedDraft,
      validation,
      dashboardData: dashboard?.data || null,
      inclusionStatus,
    };
  }
  return {
    ok: true,
    code: 'ok',
    reason: 'OK',
    persistedDraft,
    validation,
    dashboardData: dashboard?.data || null,
    inclusionStatus,
  };
}


export function getPublishGateAccess(appState = {}) {
  if (!appState.supabase) return { allowed: false, reason: 'Supabase client chưa sẵn sàng.' };
  if (!appState.session?.user?.id) return { allowed: false, reason: 'Cần đăng nhập để công khai bản nháp.' };
  const role = String(appState.profile?.role || '').trim().toLowerCase();
  const active = appState.profile?.is_active === true;
  if (!active || role !== 'admin') {
    return { allowed: false, reason: 'Phase này chỉ tài khoản admin đang hoạt động được công khai bản nháp.' };
  }
  return { allowed: true, userId: appState.session.user.id, role };
}

export function hasCurrentDryRunPass(draftState = {}) {
  const result = draftState.publishDryRunResult || null;
  if (!result || result.ok !== true || result.dryRun !== true) return false;
  if (draftState.publishRequiresReconciliation || draftState.publishPointerState === 'unknown') return false;
  if (draftState.dirty) return false;
  if (draftState.publishVerificationInvalidatedAt) return false;
  const currentDraftId = String(draftState.currentDraftId || '').trim();
  const persistedId = String(draftState.persistedDraftId || currentDraftId || '').trim();
  const verifiedId = String(draftState.publishVerifiedDraftId || '').trim();
  if (!currentDraftId || !persistedId || !verifiedId || currentDraftId !== persistedId || verifiedId !== currentDraftId) return false;
  const currentUpdatedAt = normalizeDraftRevisionToken(draftState.persistedDraftUpdatedAt || draftState.draftLastSavedAt || '');
  const verifiedUpdatedAt = normalizeDraftRevisionToken(draftState.publishVerifiedDraftUpdatedAt || '');
  if (!areDraftRevisionTokensEqual(currentUpdatedAt, verifiedUpdatedAt)) return false;
  const currentVersion = String(draftState.persistedDraftVersion || draftState.draftJson?.version || '').trim();
  const verifiedVersion = String(draftState.publishVerifiedDraftVersion || '').trim();
  if (!currentVersion || !verifiedVersion || currentVersion !== verifiedVersion) return false;
  const resultVersion = String(result.publishedVersion || result.plan?.publishedVersion || '').trim();
  if (!resultVersion || resultVersion !== currentVersion) return false;
  const resultCandidateHash = normalizeSha256Hash(result.candidateHash || result.plan?.candidateHash || '');
  const verifiedCandidateHash = normalizeSha256Hash(draftState.publishVerifiedCandidateHash || '');
  if (!resultCandidateHash || !verifiedCandidateHash || resultCandidateHash !== verifiedCandidateHash) return false;
  if (!isPlainObjectValue(draftState.draftJson) || !isPlainObjectValue(draftState.baselineJson)) return false;
  const localJson = sanitizeStaticCmsExport(draftState.draftJson, { keepVersion: true });
  const baselineJson = sanitizeStaticCmsExport(draftState.baselineJson, { keepVersion: true });
  if (!normalizedDeepEqual(localJson, baselineJson)) return false;
  return true;
}

export function getPublishReadiness(draftState = {}, access = {}, publishInclusionStatus = null) {
  const gate = getState().releaseOperationGate || {};
  if (gate.blocked) return { ready: false, reason: gate.message || 'Đang có một thao tác công khai hoặc khôi phục chưa hoàn tất. Hãy kiểm tra trạng thái hiện tại trước khi tiếp tục.' };
  if (!access.allowed) return { ready: false, reason: access.reason || 'Không đủ quyền công khai.' };
  if (draftState.publishRequiresReconciliation || draftState.publishPointerState === 'unknown') {
    return { ready: false, reason: 'Chưa xác định website đang dùng bản nào. Không bấm công khai lại; hãy kiểm tra trạng thái hiện tại.' };
  }
  if (!draftState.draftJson) return { ready: false, reason: 'Chưa tải bản nháp.' };
  if (!draftState.currentDraftId) return { ready: false, reason: 'Cần lưu thay đổi trước khi công khai.' };
  if (draftState.persistedDraftId && String(draftState.persistedDraftId) !== String(draftState.currentDraftId)) {
    return { ready: false, reason: 'Bản đang mở không khớp bản đã lưu trong CMS. Hãy lưu lại bản chuẩn bị.' };
  }
  if (!draftState.persistedDraftUpdatedAt || !draftState.persistedDraftVersion) {
    return { ready: false, reason: 'Bản chuẩn bị thiếu revision đã đọc lại từ server. Hãy lưu lại trước khi kiểm tra hoặc công khai.' };
  }
  if (draftState.dirty) return { ready: false, reason: 'Bản nháp đang có thay đổi chưa lưu. Hãy lưu thay đổi trước khi công khai.' };
  if (draftState.isSavingDraft) return { ready: false, reason: 'Đang lưu thay đổi, vui lòng chờ hoàn tất.' };
  if (draftState.isUploadingMedia) return { ready: false, reason: 'Đang upload media, vui lòng chờ hoàn tất.' };
  if (!draftState.validation?.valid) return { ready: false, reason: 'Nội dung còn lỗi cần xử lý. Chưa được công khai.' };
  if (publishInclusionStatus?.blocksPublish) {
    return { ready: false, reason: publishInclusionStatus.firstBlock?.reason || 'Bản chuẩn bị chưa đủ điều kiện đối chiếu dữ liệu liên màn.' };
  }
  return { ready: true, reason: 'OK' };
}

export async function handlePublishStaticCmsDraft({ dryRun = true, handlers = {} } = {}) {
  const appState = getState();
  const draftState = appState.staticCmsDraft || {};
  const gate = appState.releaseOperationGate || {};
  if (gate.blocked) {
    setStaticCmsPublishState({ publishError: gate.message || 'Đang có một thao tác công khai hoặc khôi phục chưa hoàn tất. Hãy kiểm tra trạng thái hiện tại trước khi tiếp tục.', publishStatus: '', publishResult: null });
    handlers.onRerender?.();
    return;
  }
  if (draftState.publishRequiresReconciliation || draftState.publishPointerState === 'unknown') {
    setStaticCmsPublishState({
      publishError: 'Không xác định được website đang dùng bản cũ hay bản mới. Không bấm công khai lại. Hãy bấm “Kiểm tra trạng thái hiện tại”.',
      publishStatus: '',
    });
    handlers.onRerender?.();
    return;
  }
  const access = getPublishGateAccess(appState);
  const publishInclusionStatus = buildCmsPublishInclusionStatus({ data: appState.data || {}, draftState });
  const readiness = getPublishReadiness(draftState, access, publishInclusionStatus);
  if (!readiness.ready) {
    setStaticCmsPublishState({ publishError: readiness.reason, publishStatus: '', publishResult: null });
    handlers.onRerender?.();
    return;
  }
  if (!dryRun && !hasCurrentDryRunPass(draftState)) {
    setStaticCmsPublishState({ publishError: 'Cần bấm “Kiểm tra trước khi đưa lên” và nội dung phải đạt cho đúng bản chuẩn bị đã lưu.', publishStatus: '', publishResult: null });
    handlers.onRerender?.();
    return;
  }

  setStaticCmsPublishState({
    isPublishingCms: true,
    publishError: null,
    publishStatus: dryRun ? 'Đang đọc lại bản chuẩn bị đã lưu trước khi kiểm tra...' : 'Đang xác minh lại bản chuẩn bị đã lưu trước khi đưa lên...',
    publishResult: dryRun ? draftState.publishResult : null,
  });
  handlers.onRerender?.();

  const preflight = await verifyPersistedDraftForPublish({ appState: getState(), draftState: getState().staticCmsDraft || {}, expectedDraftId: draftState.currentDraftId });
  if (preflight.dashboardData) setNestedData(preflight.dashboardData);
  if (!preflight.ok) {
    setStaticCmsPublishState({
      isPublishingCms: false,
      publishError: preflight.reason || 'Bản chuẩn bị chưa qua bước xác minh trước khi đưa lên website.',
      publishStatus: '',
      publishResult: dryRun ? draftState.publishResult : null,
      publishDryRunResult: null,
      publishLastVerifiedAt: null,
      publishVerifiedDraftId: '',
      publishVerifiedDraftUpdatedAt: null,
      publishVerifiedDraftVersion: '',
      publishVerifiedCandidateHash: '',
      publishVerificationInvalidatedAt: new Date().toISOString(),
      publishVerificationInvalidationReason: preflight.reason || 'Bản chuẩn bị chưa qua bước xác minh.',
    });
    handlers.onRerender?.();
    return;
  }

  const persistedDraft = preflight.persistedDraft;
  setStaticCmsPublishState({
    currentDraftId: persistedDraft.id,
    persistedDraftId: persistedDraft.id,
    persistedDraftUpdatedAt: persistedDraft.updatedAt,
    persistedDraftVersion: persistedDraft.version,
    draftLastSavedAt: persistedDraft.updatedAt,
    baselineJson: cloneJson(persistedDraft.contentJson),
    draftJson: cloneJson(persistedDraft.contentJson),
    dirty: false,
    validation: preflight.validation,
    preparationCompositionError: null,
  });

  if (!dryRun) {
    const verifiedId = String(draftState.publishVerifiedDraftId || '').trim();
    const verifiedUpdatedAt = normalizeDraftRevisionToken(draftState.publishVerifiedDraftUpdatedAt || '');
    const verifiedVersion = String(draftState.publishVerifiedDraftVersion || '').trim();
    const verifiedCandidateHash = normalizeSha256Hash(draftState.publishVerifiedCandidateHash || draftState.publishDryRunResult?.candidateHash || draftState.publishDryRunResult?.plan?.candidateHash || '');
    if (verifiedId !== persistedDraft.id || !areDraftRevisionTokensEqual(verifiedUpdatedAt, persistedDraft.updatedAt) || verifiedVersion !== persistedDraft.version || !verifiedCandidateHash) {
      setStaticCmsPublishState({
        isPublishingCms: false,
        publishError: 'Bản chuẩn bị đã thay đổi sau lần kiểm tra. Hãy lưu và bấm “Kiểm tra trước khi đưa lên” lại trước khi công khai.',
        publishStatus: '',
        publishDryRunResult: null,
        publishResult: null,
        publishLastVerifiedAt: null,
        publishVerifiedDraftId: '',
        publishVerifiedDraftUpdatedAt: null,
        publishVerifiedDraftVersion: '',
        publishVerifiedCandidateHash: '',
        publishVerificationInvalidatedAt: new Date().toISOString(),
        publishVerificationInvalidationReason: 'Bản chuẩn bị đã thay đổi sau lần kiểm tra; request công khai chưa được gửi.',
      });
      handlers.onRerender?.();
      return;
    }
  }

  const confirmVersion = String(persistedDraft.version || '').trim();
  if (!dryRun) {
    const stepOne = window.confirm('Thao tác này sẽ thay đổi website đang hoạt động bằng bản chuẩn bị đã lưu. Tiếp tục?');
    if (!stepOne) {
      setStaticCmsPublishState({ isPublishingCms: false, publishStatus: '' });
      handlers.onRerender?.();
      return;
    }
    const indoorCount = getDraftRoomItems(persistedDraft.contentJson, 'indoor').length;
    const outdoorCount = getDraftRoomItems(persistedDraft.contentJson, 'outdoor').length;
    const stepTwo = window.confirm(`Xác nhận công khai version ${confirmVersion || 'không rõ'} với indoor ${indoorCount} item và outdoor ${outdoorCount} item?`);
    if (!stepTwo) {
      setStaticCmsPublishState({ isPublishingCms: false, publishStatus: '' });
      handlers.onRerender?.();
      return;
    }
  }

  setStaticCmsPublishState({
    isPublishingCms: true,
    publishError: null,
    publishStatus: dryRun ? 'Đang kiểm tra trước khi đưa lên...' : 'Đang đưa bản chuẩn bị lên website...',
    publishDryRunResult: dryRun ? null : draftState.publishDryRunResult,
    publishResult: dryRun ? draftState.publishResult : null,
  });
  handlers.onRerender?.();

  const result = await publishCmsJson(appState.supabase, {
    draftId: persistedDraft.id,
    confirmVersion,
    dryRun,
    expectedDraftUpdatedAt: persistedDraft.updatedAt,
    expectedDraftVersion: persistedDraft.version,
    expectedCandidateHash: dryRun ? '' : normalizeSha256Hash(draftState.publishVerifiedCandidateHash || draftState.publishDryRunResult?.candidateHash || draftState.publishDryRunResult?.plan?.candidateHash || ''),
  });

  if (result.error) {
    const resultCode = result.error?.code || result.data?.code || '';
    const isPointerUnknown = resultCode === 'POINTER_STATE_UNKNOWN' || result.data?.pointerState === 'unknown';
    if (isPointerUnknown) {
      setStaticCmsPublishState({
        isPublishingCms: false,
        publishPointerState: 'unknown',
        publishRequiresReconciliation: true,
        publishPendingReleaseId: String(result.data?.releaseId || ''),
        publishPendingContentPath: String(result.data?.contentPath || ''),
        publishPendingContentHash: normalizeSha256Hash(result.data?.contentHash || ''),
        publishPendingCandidateHash: normalizeSha256Hash(result.data?.candidateHash || ''),
        publishReconciliationStatus: '',
        publishReconciliationError: null,
        publishReconciliationResult: null,
        isReconcilingPublishPointer: false,
        publishError: 'Không xác định được website đang dùng bản cũ hay bản mới. Không bấm công khai lại. Hãy bấm “Kiểm tra trạng thái hiện tại”.',
        publishStatus: '',
        publishResult: result.data || null,
        publishDryRunResult: null,
        publishLastVerifiedAt: null,
        publishVerifiedDraftId: '',
        publishVerifiedDraftUpdatedAt: null,
        publishVerifiedDraftVersion: '',
        publishVerifiedCandidateHash: '',
        publishVerificationInvalidatedAt: new Date().toISOString(),
        publishVerificationInvalidationReason: 'Pointer công khai chưa xác định sau khi server ghi pointer.',
      });
      handlers.onRerender?.();
      return;
    }
    if (resultCode === 'RELEASE_OPERATION_BLOCKED' || resultCode === 'RELEASE_LINEAGE_REPAIR_REQUIRED') {
      applyReleaseOperationGateFromServer(result.data || {}, resultCode === 'RELEASE_LINEAGE_REPAIR_REQUIRED' ? 'Bản công khai đã được xác nhận nhưng lịch sử vận hành chưa hoàn tất. Hãy sửa lịch sử vận hành trước khi tiếp tục.' : 'Đang có một thao tác công khai hoặc khôi phục chưa hoàn tất. Hãy kiểm tra trạng thái hiện tại trước khi tiếp tục.');
      setStaticCmsPublishState({ isPublishingCms: false, publishError: resultCode === 'RELEASE_LINEAGE_REPAIR_REQUIRED' ? 'Bản công khai đã được xác nhận nhưng lịch sử vận hành chưa hoàn tất. Hãy sửa lịch sử vận hành trước khi tiếp tục.' : 'Đang có một thao tác công khai hoặc khôi phục chưa hoàn tất. Hãy kiểm tra trạng thái hiện tại trước khi tiếp tục.', publishStatus: '', publishResult: result.data || null });
      handlers.onRerender?.();
      return;
    }
    const isCandidateHashMismatch = resultCode === 'CANDIDATE_HASH_MISMATCH';
    const isRevisionConflict = resultCode === 'DRAFT_REVISION_CONFLICT'
      || isCandidateHashMismatch
      || result.error?.status === 409;
    setStaticCmsPublishState({
      isPublishingCms: false,
      publishError: isCandidateHashMismatch
        ? 'Nội dung bản chuẩn bị đã khác với lần kiểm tra trước. Website chưa được cập nhật. Hãy kiểm tra lại trước khi đưa lên website.'
        : (isRevisionConflict
          ? 'Bản chuẩn bị đã thay đổi sau lần kiểm tra trước. Website chưa được cập nhật. Hãy tải lại bản chuẩn bị, kiểm tra lại rồi thực hiện lại bước đưa lên website.'
          : normalizeErrorMessage(result.error)),
      publishStatus: '',
      publishResult: dryRun ? draftState.publishResult : (result.data || null),
      publishDryRunResult: isRevisionConflict ? null : (dryRun ? (result.data || null) : draftState.publishDryRunResult),
      publishLastVerifiedAt: isRevisionConflict ? null : draftState.publishLastVerifiedAt,
      publishVerifiedDraftId: isRevisionConflict ? '' : draftState.publishVerifiedDraftId,
      publishVerifiedDraftUpdatedAt: isRevisionConflict ? null : draftState.publishVerifiedDraftUpdatedAt,
      publishVerifiedDraftVersion: isRevisionConflict ? '' : draftState.publishVerifiedDraftVersion,
      publishVerifiedCandidateHash: isRevisionConflict ? '' : draftState.publishVerifiedCandidateHash,
      publishVerificationInvalidatedAt: isRevisionConflict ? new Date().toISOString() : draftState.publishVerificationInvalidatedAt,
      publishVerificationInvalidationReason: isRevisionConflict ? 'Server phát hiện revision draft đã thay đổi sau lần kiểm tra.' : draftState.publishVerificationInvalidationReason,
    });
    handlers.onRerender?.();
    return;
  }

  setStaticCmsPublishState({
    isPublishingCms: false,
    publishError: null,
    publishStatus: dryRun ? 'Đã kiểm tra xong. Website chưa thay đổi.' : 'Đã đưa bản này lên website.',
    publishDryRunResult: dryRun ? result.data : draftState.publishDryRunResult,
    publishResult: dryRun ? draftState.publishResult : result.data,
    publishPointerState: '',
    publishRequiresReconciliation: false,
    publishPendingReleaseId: '',
    publishPendingContentPath: '',
    publishPendingContentHash: '',
    publishPendingCandidateHash: '',
    publishReconciliationStatus: '',
    publishReconciliationError: null,
    publishReconciliationResult: null,
    isReconcilingPublishPointer: false,
    publishLastVerifiedAt: new Date().toISOString(),
    publishVerifiedDraftId: dryRun ? persistedDraft.id : draftState.publishVerifiedDraftId,
    publishVerifiedDraftUpdatedAt: dryRun ? persistedDraft.updatedAt : draftState.publishVerifiedDraftUpdatedAt,
    publishVerifiedDraftVersion: dryRun ? persistedDraft.version : draftState.publishVerifiedDraftVersion,
    publishVerifiedCandidateHash: dryRun ? normalizeSha256Hash(result.data?.candidateHash || result.data?.plan?.candidateHash || '') : draftState.publishVerifiedCandidateHash,
    publishVerificationInvalidatedAt: null,
    publishVerificationInvalidationReason: '',
  });
  handlers.onRerender?.();
}



function buildPublishPreflightInvalidationPatch(reason = '') {
  return {
    publishDryRunResult: null,
    publishLastVerifiedAt: null,
    publishVerifiedDraftId: '',
    publishVerifiedDraftUpdatedAt: null,
    publishVerifiedDraftVersion: '',
    publishVerifiedCandidateHash: '',
    publishVerificationInvalidatedAt: new Date().toISOString(),
    publishVerificationInvalidationReason: reason || 'Trạng thái reconcile đã thay đổi; cần kiểm tra trước khi công khai lại.',
  };
}

function applyResolvedCapableReconcileState({
  data = {},
  classification = '',
  current = {},
  gate = {},
  expectedReleaseId = '',
  expectedContentHash = '',
  statusRefresh = null,
  transportError = null,
} = {}) {
  const normalizedClassification = String(classification || data.classification || '').trim();
  const exactIdle = statusRefresh?.idle === true;
  const transportMessage = transportError ? normalizeErrorMessage(transportError) : '';
  const invalidation = buildPublishPreflightInvalidationPatch(`${normalizedClassification || 'resolved'} yêu cầu preflight mới trước lần công khai tiếp theo.`);

  switch (normalizedClassification) {
    case 'active_expected_release': {
      setStaticCmsPublishState({
        isReconcilingPublishPointer: false,
        publishPointerState: 'active_expected_release',
        publishRequiresReconciliation: exactIdle !== true,
        publishReconciliationResult: data,
        publishReconciliationError: transportMessage || null,
        publishReconciliationStatus: exactIdle
          ? 'Đã kiểm tra: website đang dùng bản vừa thao tác và máy chủ đã trở về trạng thái idle. Hãy kiểm tra lại trước lần công khai tiếp theo.'
          : 'Đã kiểm tra: website đang dùng bản vừa thao tác, nhưng máy chủ chưa xác nhận exact idle. Hãy kiểm tra trạng thái hiện tại trước thao tác tiếp.',
        publishError: exactIdle ? null : 'Máy chủ chưa xác nhận exact idle. Không bấm công khai lại bằng kết quả kiểm tra cũ.',
        publishStatus: exactIdle
          ? 'Website đang dùng bản vừa thao tác. Hãy mở website để kiểm tra hiển thị, rồi chạy preflight mới trước lần công khai tiếp theo.'
          : '',
        publishResult: {
          ...(current.publishResult || {}),
          ok: true,
          dryRun: false,
          releaseId: data.releaseId || expectedReleaseId,
          contentPath: data.contentPath || current.publishPendingContentPath || '',
          contentHash: data.contentHash || expectedContentHash,
          verifyStatus: 'pass',
          reconciled: true,
          operationId: data.operationId || gate.operationId || '',
        },
        ...invalidation,
        publishVerificationInvalidationReason: 'Reconcile xác nhận website đang dùng bản vừa thao tác; cần preflight mới trước lần công khai tiếp theo.',
      });
      return true;
    }

    case 'active_other_release':
    case 'resolved_active_other': {
      setStaticCmsPublishState({
        isReconcilingPublishPointer: false,
        publishPointerState: 'active_other_release',
        publishRequiresReconciliation: true,
        publishReconciliationResult: data,
        publishReconciliationError: transportMessage || null,
        publishReconciliationStatus: 'Đã kiểm tra: website đang dùng một bản khác. Hãy tải lại bản chuẩn bị và kiểm tra lại trước khi thao tác tiếp.',
        publishError: 'Website đang dùng một bản khác với bản vừa thao tác. Không bấm công khai lại bằng kết quả cũ.',
        publishStatus: '',
        ...invalidation,
        publishVerificationInvalidationReason: 'Reconcile xác nhận website đang dùng release khác; kết quả dry-run cũ không còn hợp lệ.',
      });
      return true;
    }

    case 'operation_already_resolved':
    case 'operation_already_resolved_non_success':
    case 'lineage_repaired':
    case 'failed_before_pointer': {
      const statusLabel = {
        operation_already_resolved: 'Operation đã được resolve trước đó.',
        operation_already_resolved_non_success: 'Operation đã resolve nhưng không phải trạng thái publish thành công.',
        lineage_repaired: 'Lineage đã được sửa hoặc hoàn tất lại.',
        failed_before_pointer: 'Operation thất bại trước khi pointer công khai được xác nhận.',
      }[normalizedClassification] || 'Reconcile đã trả trạng thái resolved cần xác minh lại.';
      setStaticCmsPublishState({
        isReconcilingPublishPointer: false,
        publishPointerState: normalizedClassification,
        publishRequiresReconciliation: exactIdle !== true,
        publishReconciliationResult: data,
        publishReconciliationError: transportMessage || null,
        publishReconciliationStatus: exactIdle
          ? `${statusLabel} Máy chủ hiện đã idle; hãy bấm kiểm tra trước khi thao tác publish mới.`
          : `${statusLabel} Máy chủ chưa xác nhận exact idle; gate vẫn khóa.`,
        publishError: normalizedClassification === 'failed_before_pointer'
          ? 'Operation đã dừng trước khi pointer công khai được xác nhận. Không bấm công khai lại bằng kết quả kiểm tra cũ; hãy kiểm tra lại từ đầu.'
          : 'Trạng thái publish cũ đã được xử lý. Không bấm công khai lại bằng kết quả kiểm tra cũ; hãy kiểm tra lại từ đầu.',
        publishStatus: '',
        ...invalidation,
        publishVerificationInvalidationReason: `${normalizedClassification} yêu cầu preflight mới trước lần công khai tiếp theo.`,
      });
      return true;
    }

    default:
      return false;
  }
}

export async function handleReconcileStaticCmsPublishPointer({ handlers = {} } = {}) {
  const current = getState().staticCmsDraft || {};
  const gate = getState().releaseOperationGate || {};
  const expectedReleaseId = String(current.publishPendingReleaseId || current.publishResult?.releaseId || gate.expectedReleaseId || '').trim();
  const expectedContentHash = normalizeSha256Hash(current.publishPendingContentHash || current.publishResult?.contentHash || gate.contentHash || '');
  setReleaseOperationGateState({ reconciling: true, error: null });
  setStaticCmsPublishState({
    isReconcilingPublishPointer: true,
    publishReconciliationStatus: 'Đang kiểm tra trạng thái hiện tại...',
    publishReconciliationError: null,
  });
  handlers.onRerender?.();
  const result = await reconcileCmsReleasePointer(getState().supabase, {
    mode: 'reconcile',
    operationId: current.publishResult?.operationId || gate.operationId || '',
    releaseId: expectedReleaseId,
    contentHash: expectedContentHash,
  });
  const data = result.data || {};
  const classification = String(data.classification || 'read_failed');
  const resolvedCapable = isResolvedCapableReleaseResponse(data);

  if (result.error) {
    if (resolvedCapable) {
      const statusRefresh = await refreshAndApplyReleaseOperationGateStatus({
        successResult: data,
        fallbackMessage: 'Response lỗi có thể đã resolve operation; cần kiểm tra trạng thái máy chủ trước khi mở gate.',
      });
      const handled = applyResolvedCapableReconcileState({
        data,
        classification,
        current,
        gate,
        expectedReleaseId,
        expectedContentHash,
        statusRefresh,
        transportError: result.error,
      });
      if (handled) {
        handlers.onRerender?.();
        return;
      }
    }

    setReleaseOperationGateState({ reconciling: false, error: normalizeErrorMessage(result.error), lastCheckedAt: new Date().toISOString() });
    setStaticCmsPublishState({
      isReconcilingPublishPointer: false,
      publishPointerState: 'unknown',
      publishRequiresReconciliation: true,
      publishReconciliationError: normalizeErrorMessage(result.error),
      publishReconciliationStatus: '',
      publishError: 'Không xác định được trạng thái reconcile. Không bấm công khai lại; hãy kiểm tra trạng thái hiện tại.',
      ...buildPublishPreflightInvalidationPatch('Reconcile trả lỗi không đủ dữ liệu resolved; kết quả dry-run cũ không còn hợp lệ.'),
    });
    handlers.onRerender?.();
    return;
  }

  if (resolvedCapable) {
    const statusRefresh = await refreshAndApplyReleaseOperationGateStatus({
      successResult: data,
      fallbackMessage: 'Reconcile response có thể đã resolve operation; cần kiểm tra trạng thái máy chủ trước khi mở gate.',
    });
    const handled = applyResolvedCapableReconcileState({
      data,
      classification,
      current,
      gate,
      expectedReleaseId,
      expectedContentHash,
      statusRefresh,
      transportError: null,
    });
    if (handled) {
      handlers.onRerender?.();
      return;
    }
  }

  setReleaseOperationGateState({ blocked: true, reconciliationRequired: true, reconciling: false, state: 'pointer_unknown', message: 'Chưa xác định website đang dùng bản nào. Không bấm công khai hoặc khôi phục lại. Hãy kiểm tra trạng thái hiện tại.', lastCheckedAt: new Date().toISOString(), result: data });
  setStaticCmsPublishState({
    isReconcilingPublishPointer: false,
    publishPointerState: 'unknown',
    publishRequiresReconciliation: true,
    publishReconciliationResult: data,
    publishReconciliationError: null,
    publishReconciliationStatus: 'Vẫn chưa xác định website đang dùng bản nào. Không bấm công khai lại. Có thể thử kiểm tra trạng thái lại hoặc mở lịch sử phiên bản.',
    publishError: 'Chưa xác định website đang dùng bản nào. Không bấm công khai lại.',
    ...buildPublishPreflightInvalidationPatch('Reconcile không xác định được classification an toàn; kết quả dry-run cũ không còn hợp lệ.'),
  });
  handlers.onRerender?.();
}

function renderDraftPersistencePanel(draftState = {}, appState = {}, handlers = {}, copy = {}) {
  const panel = createElement('section', { className: 'cms-admin-static-draft-manager-panel' });
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Quản lý tên, ghi chú, bản sao và danh sách bản nháp đã lưu. Nút “Lưu thay đổi” chính nằm trên command bar để tránh thao tác trùng lặp.',
  }));

  const access = getDraftPersistenceAccess(appState);
  if (!ADMIN_FEATURE_FLAGS.allowStaticCmsDraftPersistence) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: 'Draft persistence đang bị khóa bằng feature flag.' }));
    return panel;
  }
  if (!access.allowed) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: access.reason }));
    return panel;
  }

  const form = createElement('div', { className: 'cms-admin-static-save-form' });
  const titleInput = createElement('input', {
    className: 'cms-admin-input',
    value: getDraftTitleForDisplay(draftState),
    attrs: { id: 'cms-admin-static-draft-title', name: 'draftTitle', autocomplete: 'off' },
  });
  titleInput.addEventListener('change', () => {
    updateStaticCmsDraftMeta('draftTitle', titleInput.value);
    handlers.onRerender?.();
  });
  const noteInput = createElement('textarea', {
    className: 'cms-admin-input',
    value: draftState.draftNote || '',
    attrs: { id: 'cms-admin-static-draft-note', name: 'draftNote', rows: '3', autocomplete: 'off' },
  });
  noteInput.addEventListener('change', () => {
    updateStaticCmsDraftMeta('draftNote', noteInput.value);
    handlers.onRerender?.();
  });
  form.appendChild(labeledControl('Tên bản nháp', titleInput));
  form.appendChild(labeledControl('Ghi chú nội bộ', noteInput));
  panel.appendChild(form);

  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-static-save-actions' });
  const saveAsButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    text: 'Lưu thành bản sao mới',
    type: 'button',
  });
  saveAsButton.disabled = draftState.isSavingDraft || !draftState.draftJson;
  saveAsButton.addEventListener('click', () => {
    if (draftState.currentDraftId) {
      const confirmed = globalThis.confirm?.('Lưu thành bản sao mới tách khỏi bản chuẩn bị đang mở? Thao tác này chỉ nên dùng khi thật sự muốn tạo một draft khác.');
      if (!confirmed) return;
    }
    handleSaveStaticCmsDraft({ asNew: true, explicitCopy: true, handlers });
  });

  const loadListButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost',
    text: draftState.isLoadingDrafts ? 'Đang tải danh sách...' : 'Tải danh sách bản nháp',
    type: 'button',
  });
  loadListButton.disabled = draftState.isLoadingDrafts;
  loadListButton.addEventListener('click', () => handleLoadSavedCmsDrafts(handlers));

  const resetButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost',
    text: 'Hoàn tác về lúc tải gần nhất',
    type: 'button',
  });
  resetButton.disabled = Boolean(draftState.loading) || !Boolean(draftState.draftJson);
  resetButton.addEventListener('click', () => handleResetStaticDraft(handlers));

  appendChildren(actions, [saveAsButton, loadListButton, resetButton]);
  panel.appendChild(actions);

  panel.appendChild(renderDraftPersistenceStatus(draftState));
  panel.appendChild(renderSavedDraftList(draftState, handlers));
  return panel;
}

function renderDraftPersistenceStatus(draftState = {}) {
  const wrap = createElement('div', { className: 'cms-admin-static-save-status' });
  if (draftState.currentDraftId) {
    wrap.appendChild(renderStatusChip('Draft ID', shortenDraftId(draftState.currentDraftId)));
  }
  if (draftState.draftLastSavedAt) {
    wrap.appendChild(renderStatusChip('Lưu lần cuối', formatDateTime(draftState.draftLastSavedAt), 'success'));
  }
  if (draftState.draftSaveStatus) {
    wrap.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: draftState.draftSaveStatus }));
  }
  if (draftState.draftPersistenceError) {
    wrap.appendChild(renderErrorBox(draftState.draftPersistenceError, 'Lỗi lưu/mở bản nháp'));
  }
  return wrap;
}

function renderSavedDraftList(draftState = {}, handlers = {}) {
  const wrap = createElement('div', { className: 'cms-admin-static-saved-drafts' });
  wrap.appendChild(createElement('h4', { text: 'Bản nháp đã lưu' }));
  const drafts = safeArray(draftState.savedDrafts);
  if (!drafts.length) {
    wrap.appendChild(createElement('p', {
      className: 'cms-admin-help-text',
      text: draftState.draftListLoadedAt ? 'Không có bản nháp đang hoạt động.' : 'Bấm “Tải danh sách bản nháp” để xem bản nháp đã lưu server-side.',
    }));
    return wrap;
  }

  const list = createElement('div', { className: 'cms-admin-static-saved-draft-list' });
  drafts.forEach((draft) => {
    const row = createElement('article', { className: 'cms-admin-static-saved-draft-card' });
    const summary = createElement('div', { className: 'cms-admin-static-saved-draft-summary' });
    summary.appendChild(createElement('strong', { text: draft.title || 'Bản nháp nội dung' }));
    summary.appendChild(createElement('small', {
      text: `${draft.status || 'draft'} · ${formatDateTime(draft.updated_at)} · ${draft.source_version || 'không rõ version'}`,
    }));
    summary.appendChild(createElement('small', { text: formatDraftValidationBrief(draft.validation_json) }));

    const actions = createElement('div', { className: 'cms-admin-actions cms-admin-static-saved-draft-actions' });
    const openButton = createElement('button', { className: 'cms-admin-button cms-admin-button-secondary cms-admin-button-small', text: 'Mở', type: 'button' });
    openButton.addEventListener('click', () => handleOpenSavedCmsDraft(draft.id, handlers));
    actions.appendChild(openButton);

    if (ADMIN_FEATURE_FLAGS.allowStaticCmsDraftDiscard) {
      const discardButton = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-small', text: 'Đánh dấu hủy', type: 'button' });
      discardButton.addEventListener('click', () => handleDiscardSavedCmsDraft(draft.id, handlers));
      actions.appendChild(discardButton);
    }

    appendChildren(row, [summary, actions]);
    list.appendChild(row);
  });
  wrap.appendChild(list);
  return wrap;
}

function getDraftPersistenceAccess(appState = {}) {
  if (!appState.supabase) return { allowed: false, reason: 'Supabase client chưa sẵn sàng.' };
  if (!appState.session?.user?.id) return { allowed: false, reason: 'Cần đăng nhập để lưu thay đổi server-side.' };
  const role = String(appState.profile?.role || '').trim();
  const active = appState.profile?.is_active === true;
  if (!active || !['admin', 'editor'].includes(role)) {
    return { allowed: false, reason: 'Tài khoản không có quyền lưu thay đổi CMS.' };
  }
  return { allowed: true, userId: appState.session.user.id, role };
}

function formatDraftValidationBrief(validation = {}) {
  const errors = Object.keys(validation?.errors || {}).length;
  const warnings = Object.keys(validation?.warnings || {}).length;
  if (errors) return `${errors} lỗi blocker`;
  if (warnings) return `${warnings} cảnh báo`;
  if (validation?.valid === true) return 'Nội dung hợp lệ';
  return 'Chưa có validation';
}

function shortenDraftId(id = '') {
  const text = String(id || '').trim();
  if (text.length <= 12) return text || '—';
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

async function handleLoadSavedCmsDrafts(handlers = {}) {
  const appState = getState();
  const access = getDraftPersistenceAccess(appState);
  if (!access.allowed) {
    setStaticCmsDraftPersistenceState({ draftPersistenceError: access.reason });
    handlers.onRerender?.();
    return;
  }
  setStaticCmsDraftPersistenceState({ isLoadingDrafts: true, draftPersistenceError: null });
  handlers.onRerender?.();
  const result = await listCmsDrafts(appState.supabase, { limit: 30 });
  if (result.error) {
    setStaticCmsDraftPersistenceState({ isLoadingDrafts: false, draftPersistenceError: normalizeErrorMessage(result.error) });
  } else {
    setStaticCmsSavedDrafts(result.data || []);
  }
  handlers.onRerender?.();
}

export async function handleSaveStaticCmsDraft({ asNew = false, explicitCopy = false, handlers = {} } = {}) {
  const appState = getState();
  const draftState = appState.staticCmsDraft || {};
  const access = getDraftPersistenceAccess(appState);
  if (!access.allowed) {
    setStaticCmsDraftPersistenceState({ draftPersistenceError: access.reason });
    handlers.onRerender?.();
    return;
  }
  if (!draftState.draftJson) return;

  const currentDraftId = String(draftState.currentDraftId || '').trim();
  const persistedDraftId = String(draftState.persistedDraftId || '').trim();
  const saveAsCopy = asNew === true;

  if (persistedDraftId && !currentDraftId) {
    setStaticCmsDraftPersistenceState({
      draftPersistenceError: 'Trạng thái bản chuẩn bị không nhất quán: có persisted draft nhưng thiếu current draft ID. Hãy tải lại bản nháp trước khi lưu.',
      draftSaveStatus: '',
      publishDryRunResult: null,
      publishResult: null,
      publishStatus: '',
      publishError: null,
      publishLastVerifiedAt: null,
      publishVerifiedDraftId: '',
      publishVerifiedDraftUpdatedAt: null,
      publishVerifiedDraftVersion: '',
      publishVerifiedCandidateHash: '',
      publishVerificationInvalidatedAt: new Date().toISOString(),
      publishVerificationInvalidationReason: 'Trạng thái draft không nhất quán trước khi lưu.',
    });
    handlers.onRerender?.();
    return;
  }

  if (currentDraftId && persistedDraftId && currentDraftId !== persistedDraftId) {
    setStaticCmsDraftPersistenceState({
      draftPersistenceError: 'Bản đang mở không khớp bản đã lưu trong CMS. Không tự tạo bản mới để tránh phân nhánh sai.',
      draftSaveStatus: '',
      publishDryRunResult: null,
      publishResult: null,
      publishStatus: '',
      publishError: null,
      publishLastVerifiedAt: null,
      publishVerifiedDraftId: '',
      publishVerifiedDraftUpdatedAt: null,
      publishVerifiedDraftVersion: '',
      publishVerifiedCandidateHash: '',
      publishVerificationInvalidatedAt: new Date().toISOString(),
      publishVerificationInvalidationReason: 'Draft identity mismatch trước khi lưu.',
    });
    handlers.onRerender?.();
    return;
  }

  if (saveAsCopy && currentDraftId && explicitCopy !== true) {
    setStaticCmsDraftPersistenceState({
      draftPersistenceError: 'Không tạo bản sao mới khi đang mở draft hiện tại nếu người dùng chưa xác nhận thao tác “Lưu thành bản sao mới”.',
      draftSaveStatus: '',
    });
    handlers.onRerender?.();
    return;
  }

  const shouldCreate = saveAsCopy ? true : !currentDraftId;
  const expectedUpdatedAt = normalizeDraftRevisionToken(draftState.persistedDraftUpdatedAt || draftState.draftLastSavedAt || '');
  if (!shouldCreate && !expectedUpdatedAt) {
    setStaticCmsDraftPersistenceState({
      draftPersistenceError: 'Thiếu revision của bản chuẩn bị hiện tại. Hãy tải lại bản nháp rồi lưu lại.',
      draftSaveStatus: '',
      dirty: true,
      publishDryRunResult: null,
      publishResult: null,
      publishStatus: '',
      publishError: null,
      publishLastVerifiedAt: null,
      publishVerifiedDraftId: '',
      publishVerifiedDraftUpdatedAt: null,
      publishVerifiedDraftVersion: '',
      publishVerifiedCandidateHash: '',
      publishVerificationInvalidatedAt: new Date().toISOString(),
      publishVerificationInvalidationReason: 'Thiếu revision khi lưu bản chuẩn bị.',
    });
    handlers.onRerender?.();
    return;
  }

  const exportJson = createStaticCmsExportJson(draftState.draftJson);
  const validation = validateStaticCmsDraft(exportJson, STATIC_CMS_DRAFT_CONFIG);
  if (!validation.valid) {
    setStaticCmsDraftPersistenceState({ validation, draftPersistenceError: 'Nội dung còn lỗi cần xử lý. Chưa lưu thay đổi.', draftSaveStatus: '' });
    handlers.onRerender?.();
    return;
  }

  setStaticCmsDraftPersistenceState({ isSavingDraft: true, draftPersistenceError: null, draftSaveStatus: '' });
  handlers.onRerender?.();

  const payload = {
    title: (shouldCreate && !draftState.draftTitleTouched) ? createOperatorDraftTitle(draftState, { forceTimestamp: true }) : (draftState.draftTitle || createOperatorDraftTitle(draftState)),
    status: validation.valid ? 'validated' : 'draft',
    content_json: exportJson,
    validation_json: validation,
    source_version: draftState.draftJson?.version || exportJson.version || '',
    source_url: draftState.sourceUrl || STATIC_CMS_DRAFT_CONFIG.remoteUrl || '',
    source_type: draftState.source || 'draft',
    note: draftState.draftNote || '',
  };

  const result = shouldCreate
    ? await createCmsDraft(appState.supabase, payload, access.userId)
    : await updateCmsDraft(appState.supabase, currentDraftId, payload, access.userId, { expectedUpdatedAt });

  if (result.error) {
    const isConflict = result.conflict === true || result.error?.code === 'DRAFT_SAVE_CONFLICT';
    const isRevisionContractMismatch = result.error?.code === 'DRAFT_SAVE_REVISION_CONTRACT_MISMATCH';
    setStaticCmsDraftPersistenceState({
      isSavingDraft: false,
      draftPersistenceError: isRevisionContractMismatch
        ? 'Không xác minh được phiên bản đã lưu của bản chuẩn bị. Website chưa thay đổi. Hãy tải lại bản chuẩn bị rồi thử lại.'
        : isConflict
          ? 'Bản chuẩn bị đã được thay đổi ở phiên khác. Nội dung của bạn chưa bị ghi đè. Hãy tải lại bản mới nhất trước khi lưu lại.'
          : normalizeErrorMessage(result.error),
      draftSaveStatus: '',
      dirty: true,
      publishDryRunResult: null,
      publishResult: null,
      publishStatus: '',
      publishError: null,
      publishLastVerifiedAt: null,
      publishVerifiedDraftId: '',
      publishVerifiedDraftUpdatedAt: null,
      publishVerifiedDraftVersion: '',
      publishVerifiedCandidateHash: '',
      publishVerificationInvalidatedAt: new Date().toISOString(),
      publishVerificationInvalidationReason: isRevisionContractMismatch
        ? 'Revision token bị biến dạng trước khi gửi update.'
        : isConflict ? 'Save conflict với revision mới hơn trên server.' : 'Lưu bản chuẩn bị chưa thành công.',
    });
    handlers.onRerender?.();
    return;
  }

  const savedDraftId = result.data?.id || (shouldCreate ? '' : currentDraftId);
  const readback = await readPersistedCmsDraftSnapshot(appState.supabase, savedDraftId);
  if (!readback.ok) {
    setStaticCmsDraftPersistenceState({
      isSavingDraft: false,
      draftPersistenceError: readback.reason || 'Không đọc lại được bản chuẩn bị đã lưu.',
      draftSaveStatus: '',
      dirty: true,
      publishDryRunResult: null,
      publishResult: null,
      publishStatus: '',
      publishError: null,
      publishLastVerifiedAt: null,
      publishVerifiedDraftId: '',
      publishVerifiedDraftUpdatedAt: null,
      publishVerifiedDraftVersion: '',
      publishVerifiedCandidateHash: '',
      publishVerificationInvalidatedAt: new Date().toISOString(),
      publishVerificationInvalidationReason: 'Không đọc lại được bản chuẩn bị đã lưu.',
    });
    handlers.onRerender?.();
    return;
  }

  const persistedDraft = readback.snapshot;
  if (!shouldCreate && persistedDraft.id !== currentDraftId) {
    setStaticCmsDraftPersistenceState({
      isSavingDraft: false,
      draftPersistenceError: 'Readback trả về draft ID khác bản đang cập nhật. Chưa chuyển sang trạng thái đã lưu.',
      draftSaveStatus: '',
      dirty: true,
      publishDryRunResult: null,
      publishResult: null,
      publishStatus: '',
      publishError: null,
      publishLastVerifiedAt: null,
      publishVerifiedDraftId: '',
      publishVerifiedDraftUpdatedAt: null,
      publishVerifiedDraftVersion: '',
      publishVerifiedCandidateHash: '',
      publishVerificationInvalidatedAt: new Date().toISOString(),
      publishVerificationInvalidationReason: 'Readback draft ID mismatch sau khi lưu.',
    });
    handlers.onRerender?.();
    return;
  }

  const persistedValidation = validateStaticCmsDraft(persistedDraft.contentJson, STATIC_CMS_DRAFT_CONFIG);
  if (!persistedValidation.valid) {
    setStaticCmsDraftPersistenceState({
      isSavingDraft: false,
      currentDraftId: persistedDraft.id,
      persistedDraftId: persistedDraft.id,
      persistedDraftUpdatedAt: persistedDraft.updatedAt,
      persistedDraftVersion: persistedDraft.version,
      draftPersistenceError: 'Bản chuẩn bị đã lưu nhưng nội dung đọc lại chưa đạt kiểm tra cấu trúc. Chưa thể dùng để công khai.',
      draftSaveStatus: '',
      dirty: true,
      publishDryRunResult: null,
      publishResult: null,
      publishStatus: '',
      publishError: null,
      publishLastVerifiedAt: null,
      publishVerifiedDraftId: '',
      publishVerifiedDraftUpdatedAt: null,
      publishVerifiedDraftVersion: '',
      publishVerifiedCandidateHash: '',
      publishVerificationInvalidatedAt: new Date().toISOString(),
      publishVerificationInvalidationReason: 'Bản chuẩn bị đọc lại chưa đạt kiểm tra cấu trúc.',
    });
    handlers.onRerender?.();
    return;
  }

  setStaticCmsDraftPersistenceState({
    isSavingDraft: false,
    currentDraftId: persistedDraft.id,
    persistedDraftId: persistedDraft.id,
    persistedDraftUpdatedAt: persistedDraft.updatedAt,
    persistedDraftVersion: persistedDraft.version,
    draftLastSavedAt: persistedDraft.updatedAt,
    draftTitle: result.data?.title || payload.title,
    draftTitleTouched: Boolean(draftState.draftTitleTouched || shouldCreate),
    draftSaveStatus: shouldCreate ? 'Đã lưu thành bản chuẩn bị mới. Website đang hoạt động chưa thay đổi.' : 'Đã cập nhật bản chuẩn bị hiện tại. Website đang hoạt động chưa thay đổi.',
    dirty: false,
    validation: persistedValidation,
    baselineJson: cloneJson(persistedDraft.contentJson),
    draftJson: cloneJson(persistedDraft.contentJson),
    draftPersistenceError: null,
    publishDryRunResult: null,
    publishResult: null,
    publishStatus: '',
    publishError: null,
    publishLastVerifiedAt: null,
    publishVerifiedDraftId: '',
    publishVerifiedDraftUpdatedAt: null,
    publishVerifiedDraftVersion: '',
    publishVerificationInvalidatedAt: new Date().toISOString(),
    publishVerificationInvalidationReason: 'Bản chuẩn bị vừa được lưu; cần kiểm tra lại trước khi công khai.',
  });
  await handleLoadSavedCmsDrafts({ onRerender: () => {} });
  handlers.onRerender?.();
}

async function handleOpenSavedCmsDraft(draftId, handlers = {}) {
  const appState = getState();
  const access = getDraftPersistenceAccess(appState);
  if (!access.allowed) {
    setStaticCmsDraftPersistenceState({ draftPersistenceError: access.reason });
    handlers.onRerender?.();
    return;
  }
  if (appState.staticCmsDraft?.dirty) {
    const ok = window.confirm('Bạn có thay đổi chưa lưu. Mở bản nháp khác sẽ thay thế bản nháp hiện tại. Tiếp tục?');
    if (!ok) return;
  }
  setStaticCmsDraftPersistenceState({ isLoadingDrafts: true, draftPersistenceError: null });
  handlers.onRerender?.();
  const result = await getCmsDraft(appState.supabase, draftId);
  if (result.error || !result.data) {
    setStaticCmsDraftPersistenceState({ isLoadingDrafts: false, draftPersistenceError: normalizeErrorMessage(result.error || 'Không tìm thấy bản nháp.') });
    handlers.onRerender?.();
    return;
  }
  const sanitized = sanitizeStaticCmsExport(result.data.content_json || {}, { keepVersion: true });
  const validation = validateStaticCmsDraft(sanitized, STATIC_CMS_DRAFT_CONFIG);
  if (!validation.valid) {
    setStaticCmsDraftPersistenceState({ isLoadingDrafts: false, draftPersistenceError: 'Bản nháp đã lưu không còn đạt kiểm tra nội dung hiện tại. Không mở để tránh lệch dữ liệu.' });
    handlers.onRerender?.();
    return;
  }
  applySavedStaticCmsDraft({ ...result.data, content_json: sanitized, validation_json: validation }, validation);
  setStaticCmsDraftPersistenceState({ isLoadingDrafts: false });
  handlers.onRerender?.();
}

async function handleDiscardSavedCmsDraft(draftId, handlers = {}) {
  const appState = getState();
  const access = getDraftPersistenceAccess(appState);
  if (!access.allowed) {
    setStaticCmsDraftPersistenceState({ draftPersistenceError: access.reason });
    handlers.onRerender?.();
    return;
  }
  const ok = window.confirm('Đánh dấu hủy bản nháp này? Thao tác không publish website và không xóa remote CMS.');
  if (!ok) return;
  setStaticCmsDraftPersistenceState({ isLoadingDrafts: true, draftPersistenceError: null });
  handlers.onRerender?.();
  const result = await discardCmsDraft(appState.supabase, draftId, access.userId);
  if (result.error) {
    setStaticCmsDraftPersistenceState({ isLoadingDrafts: false, draftPersistenceError: normalizeErrorMessage(result.error) });
    handlers.onRerender?.();
    return;
  }
  await handleLoadSavedCmsDrafts({ onRerender: () => {} });
  if (String(appState.staticCmsDraft?.currentDraftId || '') === String(draftId || '')) {
    clearStaticCmsDraftSession({
      status: 'Đã đánh dấu hủy bản nháp hiện tại. Website đang hoạt động chưa thay đổi.',
      resetTitle: true,
      resetNote: true,
      invalidationReason: 'Bản chuẩn bị hiện tại đã được hủy trên server.',
    });
  }
  setStaticCmsDraftPersistenceState({ isLoadingDrafts: false, draftSaveStatus: 'Đã đánh dấu hủy bản nháp. Website đang hoạt động chưa thay đổi.' });
  handlers.onRerender?.();
}

function renderExportPanel(draftState = {}, handlers = {}, copy = {}) {
  const exportPanel = createElement('section', { className: 'cms-admin-static-advanced-panel' });
  exportPanel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Khu nâng cao chỉ phục vụ kiểm tra/nhập/xuất dữ liệu. Website đang hoạt động chỉ đổi ở màn Đưa website lên bản mới.',
  }));
  exportPanel.appendChild(renderAdvancedDataActions(draftState, handlers));
  exportPanel.appendChild(renderExportHelp(draftState));
  return exportPanel;
}

function renderValidationSummary(validation = {}) {
  const wrap = createElement('div', { className: 'cms-admin-validation-summary cms-admin-static-validation-summary' });
  const errors = validation?.errors || {};
  const warnings = validation?.warnings || {};
  const hasErrors = Object.keys(errors).length > 0;
  const hasWarnings = Object.keys(warnings).length > 0;

  if (validation?.valid) {
    wrap.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: hasWarnings ? 'Đủ điều kiện kiểm tra/công khai. Có cảnh báo cần operator kiểm tra.' : 'Đủ điều kiện kiểm tra/công khai.' }));
  }
  if (!Object.keys(errors).length && !Object.keys(warnings).length && !validation?.valid) {
    wrap.appendChild(renderEmptyState('Chưa có kết quả kiểm tra. Hãy tải nội dung hiện tại.'));
    return wrap;
  }
  appendValidationList(wrap, 'Lỗi cần xử lý', errors, 'cms-admin-alert cms-admin-alert-error');
  appendValidationList(wrap, 'Cảnh báo', warnings, 'cms-admin-alert cms-admin-alert-warning');
  if (!hasErrors && !hasWarnings && validation?.valid) {
    wrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Không có lỗi hoặc cảnh báo.' }));
  }
  return wrap;
}

function appendValidationList(parent, title, entries, className) {
  const keys = Object.keys(entries || {});
  if (!keys.length) return;
  const box = createElement('div', { className });
  box.appendChild(createElement('strong', { text: title }));
  const list = createElement('ul', { className: 'cms-admin-static-message-list' });
  keys.slice(0, 20).forEach((key) => list.appendChild(createElement('li', { text: `${key}: ${entries[key]}` })));
  if (keys.length > 20) list.appendChild(createElement('li', { text: `... còn ${keys.length - 20} mục.` }));
  box.appendChild(list);
  parent.appendChild(box);
}

function renderExportHelp(draftState = {}) {
  const wrap = createElement('div', { className: 'cms-admin-static-export-help' });
  if (draftState.importError) {
    wrap.appendChild(renderErrorBox(draftState.importError, 'Nhập JSON chưa thành công'));
  }
  if (draftState.importSuccess) {
    wrap.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: draftState.importSuccess }));
  }
  if (draftState.exportError) {
    wrap.appendChild(renderErrorBox(draftState.exportError, 'Export chưa thành công'));
  }
  if (draftState.exportSuccess) {
    wrap.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: draftState.exportSuccess }));
  }
  const steps = createElement('ol', { className: 'cms-admin-static-steps' });
  [
    'Khi hoàn tất chỉnh sửa, mở màn “Đưa website lên bản mới” để kiểm tra và công khai có kiểm soát.',
    'File dữ liệu nâng cao vẫn dùng được cho quản trị viên kỹ thuật khi cần xử lý thủ công.',
    'Mọi publish đều phải có backup, verify và rollback-on-fail; không DB-first publish.',
  ].forEach((step) => steps.appendChild(createElement('li', { text: step })));
  wrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Khu nâng cao chỉ phục vụ kiểm tra/nhập/xuất dữ liệu. Website đang hoạt động chỉ đổi ở màn Đưa website lên bản mới.' }));
  wrap.appendChild(steps);
  return wrap;
}


async function handleUploadStaticCmsMedia({ input, target = {}, handlers = {} } = {}) {
  const appState = getState();
  const draftState = appState.staticCmsDraft || {};
  const access = getDraftPersistenceAccess(appState);
  const roomKey = draftState.selectedRoom || 'indoor';
  const item = getSelectedDraftItem(draftState);
  const itemCode = getItemCode(item);
  const statusKey = getMediaUploadStatusKey(roomKey, itemCode, target.fieldName);

  if (!access.allowed) {
    setStaticCmsMediaUploadState({ mediaUploadError: access.reason });
    handlers.onRerender?.();
    return;
  }
  if (!itemCode || !draftState.draftJson) {
    setStaticCmsMediaUploadState({ mediaUploadError: 'Cần chọn item CMS trước khi upload media.' });
    handlers.onRerender?.();
    return;
  }

  const file = input?.files?.[0] || null;
  const fileCheck = validateClientMediaFile(file, target.mediaKind);
  if (!fileCheck.valid) {
    setStaticCmsMediaUploadState({
      mediaUploadError: fileCheck.reason,
      mediaUploadStatus: { [statusKey]: { error: fileCheck.reason, loading: false } },
    });
    handlers.onRerender?.();
    return;
  }

  setStaticCmsMediaUploadState({
    isUploadingMedia: true,
    mediaUploadError: null,
    mediaUploadStatus: { [statusKey]: { loading: true, error: '', success: '' } },
  });
  handlers.onRerender?.();

  const result = await uploadCmsMedia(appState.supabase, {
    file,
    roomKey,
    itemId: itemCode,
    artworkCode: itemCode,
    fieldName: target.fieldName,
    mediaKind: target.mediaKind,
    draftId: draftState.currentDraftId || '',
  });

  if (result.error) {
    const message = normalizeErrorMessage(result.error);
    setStaticCmsMediaUploadState({
      isUploadingMedia: false,
      mediaUploadError: message,
      mediaUploadStatus: { [statusKey]: { loading: false, error: message, success: '' } },
    });
    handlers.onRerender?.();
    return;
  }

  const publicUrl = getUploadedUrl(result.data || {});
  if (!publicUrl) {
    const message = 'Upload thành công nhưng không nhận được publicUrl hợp lệ.';
    setStaticCmsMediaUploadState({
      isUploadingMedia: false,
      mediaUploadError: message,
      mediaUploadStatus: { [statusKey]: { loading: false, error: message, success: '' } },
    });
    handlers.onRerender?.();
    return;
  }

  const latestDraftState = getState().staticCmsDraft || draftState;
  const patchResult = applyDraftFieldChange(latestDraftState, target.fieldName, publicUrl);
  updateStaticCmsDraftJson(patchResult.draftJson, patchResult.validation);
  setStaticCmsMediaUploadState({
    isUploadingMedia: false,
    mediaUploadError: null,
    previewField: target.fieldName,
    lastMediaUpload: {
      ...(result.data || {}),
      fieldName: target.fieldName,
      roomKey,
      itemCode,
    },
    mediaUploadStatus: { [statusKey]: { loading: false, error: '', success: 'Đã upload và gắn URL vào bản nháp.' } },
  });
  handlers.onRerender?.();
}

export async function handleLoadStaticCmsBaseline(handlers = {}) {
  if (!ADMIN_FEATURE_FLAGS.allowStaticCmsDraftEdit) return;
  const currentDraftState = getState().staticCmsDraft || {};
  if (currentDraftState.currentDraftId) {
    const ok = window.confirm('Mở lại nội dung website đang chạy sẽ rời bản chuẩn bị hiện tại. Các thay đổi đã lưu vẫn còn trong CMS nhưng sẽ không còn là bản đang mở. Tiếp tục?');
    if (!ok) return;
  }
  setStaticCmsDraftState({ loading: true, loadError: null, exportError: null, exportSuccess: null });
  handlers.onRerender?.();
  try {
    const result = await loadStaticCmsBaseline();
    const sanitizedBaseline = sanitizeStaticCmsExport(result.json, { keepVersion: true });
    const validation = validateStaticCmsDraft(sanitizedBaseline, STATIC_CMS_DRAFT_CONFIG);
    setStaticCmsDraftBaseline({
      baselineJson: sanitizedBaseline,
      source: result.source,
      sourceUrl: result.url,
      validation,
    });
  } catch (error) {
    setStaticCmsDraftState({ loading: false, loadError: normalizeErrorMessage(error) });
  }
  handlers.onRerender?.();
}

async function loadStaticCmsBaseline() {
  if (!globalThis.cmsContentLoader?.loadCmsContentSources) {
    await import('../shared/cmsContentLoader.js');
  }
  const loader = globalThis.cmsContentLoader;
  if (!loader?.loadCmsContentSources) {
    throw new Error('Canonical release loader chưa sẵn sàng. Không tải legacy trực tiếp để tránh sai nguồn công khai.');
  }
  const sources = await loader.loadCmsContentSources({
    forceReload: true,
    remoteEnabled: true,
    pointerUrl: STATIC_CMS_DRAFT_CONFIG.pointerUrl,
    legacyLatestUrl: STATIC_CMS_DRAFT_CONFIG.legacyLatestUrl,
    remoteUrl: STATIC_CMS_DRAFT_CONFIG.legacyLatestUrl,
    releasePublicBaseUrl: STATIC_CMS_DRAFT_CONFIG.releasePublicBaseUrl,
    fallbackUrl: STATIC_CMS_DRAFT_CONFIG.fallbackUrl,
  });
  if (!sources.selectedContent) {
    throw new Error(sources.remoteStatus === 'pointer-missing'
      ? 'Chưa có release pointer và không tải được nguồn legacy dự phòng.'
      : `Không tải được release hiện tại (${sources.remoteStatus || sources.source}).`);
  }
  if (sources.source === 'release-error') {
    throw new Error('Release pointer tồn tại nhưng không hợp lệ hoặc release không xác minh được. Không fallback về nội dung cũ.');
  }
  const canonicalJson = sanitizeStaticCmsExport(sources.selectedContent, { keepVersion: true });
  const validation = validateStaticCmsDraft(canonicalJson, STATIC_CMS_DRAFT_CONFIG);
  if (!validation.valid) {
    throw new Error(`Nội dung release hiện tại không đạt kiểm tra cấu trúc (${Object.keys(validation.errors || {}).length} lỗi).`);
  }
  return {
    source: sources.sourceType || sources.source || 'release-pointer',
    url: sources.contentPath || STATIC_CMS_DRAFT_CONFIG.pointerUrl,
    json: canonicalJson,
    validation,
    releaseId: sources.releaseId || '',
    contentPath: sources.contentPath || '',
    contentHash: sources.contentHash || '',
    legacyFallbackUsed: Boolean(sources.legacyFallbackUsed),
  };
}

function handleResetStaticDraft(handlers = {}) {
  const current = getState().staticCmsDraft || {};
  if (!current.draftJson) return;
  const validation = validateStaticCmsDraft(current.baselineJson || {}, STATIC_CMS_DRAFT_CONFIG);
  const baselineSource = current.importPreviousSource || current.source;
  const baselineSourceUrl = current.importPreviousSourceUrl || current.sourceUrl;
  resetStaticCmsDraftToBaseline(validation);
  setStaticCmsDraftState({
    source: baselineSource,
    sourceUrl: baselineSourceUrl,
    importPreviousSource: '',
    importPreviousSourceUrl: '',
    importedFileName: '',
    importedAt: null,
    importError: null,
    importSuccess: null,
  });
  handlers.onRerender?.();
}

async function handleImportStaticDraftJson({ file, handlers = {} } = {}) {
  const current = getState().staticCmsDraft || {};
  const fileCheck = validateStaticCmsJsonFile(file);
  if (!fileCheck.valid) {
    setStaticCmsDraftState({
      importError: fileCheck.message,
      importSuccess: null,
      exportError: null,
      exportSuccess: null,
    });
    handlers.onRerender?.();
    return;
  }

  try {
    const rawText = await readLocalJsonFile(file);
    const parsed = JSON.parse(String(rawText || '').replace(/^\uFEFF/, ''));
    if (!isPlainJsonObject(parsed)) {
      throw new Error('CMS JSON phải là một object ở cấp gốc.');
    }

    const canonicalJson = sanitizeStaticCmsExport(parsed, { keepVersion: true });
    const validation = validateStaticCmsDraft(canonicalJson, STATIC_CMS_DRAFT_CONFIG);
    if (!validation.valid) {
      const detail = getFirstValidationMessage(validation);
      console.error('[CMS JSON import] Validation blocked:', validation.errors || {});
      setStaticCmsDraftState({
        importError: `Không nhập được file JSON. File không đúng định dạng hoặc thiếu cấu trúc CMS hợp lệ.${detail ? ` Chi tiết: ${detail}` : ''}`,
        importSuccess: null,
        exportError: null,
        exportSuccess: null,
      });
      handlers.onRerender?.();
      return;
    }

    const selectedRoom = ROOM_KEYS.find((roomKey) => getDraftRoomItems(canonicalJson, roomKey).length > 0) || 'indoor';
    const selectedItemCode = getItemCode(getDraftRoomItems(canonicalJson, selectedRoom)[0] || {});
    const localFileSourceUrl = `local-file:${file.name}`;
    const hasExistingBaseline = isPlainJsonObject(current.baselineJson);
    const previousSource = current.source === 'imported-json'
      ? (current.importPreviousSource || '')
      : (hasExistingBaseline ? (current.source || '') : 'imported-json');
    const previousSourceUrl = current.source === 'imported-json'
      ? (current.importPreviousSourceUrl || '')
      : (hasExistingBaseline ? (current.sourceUrl || '') : localFileSourceUrl);

    setStaticCmsDraftState({
      baselineJson: hasExistingBaseline ? current.baselineJson : cloneJson(canonicalJson),
      draftJson: cloneJson(canonicalJson),
      source: 'imported-json',
      loading: false,
      loadError: null,
      sourceUrl: localFileSourceUrl,
      selectedRoom,
      selectedItemCode,
      dirty: true,
      validation,
      previewField: '',
      importError: null,
      importSuccess: 'Đã nhập JSON vào bản nháp. Website đang hoạt động chưa thay đổi. Hãy bấm “Lưu thành bản nháp mới” trước khi công khai.',
      exportError: null,
      exportSuccess: null,
      lastExportName: '',
      currentDraftId: '',
      draftTitle: createImportedDraftTitle(canonicalJson, file.name),
      draftNote: '',
      draftSaveStatus: 'Bản nháp đã nhập từ file JSON, chưa lưu server-side.',
      draftLastSavedAt: null,
      draftPersistenceError: null,
      mediaUploadStatus: {},
      mediaUploadError: null,
      lastMediaUpload: null,
      isUploadingMedia: false,
      publishDryRunResult: null,
      publishResult: null,
      publishStatus: '',
      publishError: null,
      publishLastVerifiedAt: null,
      importPreviousSource: previousSource,
      importPreviousSourceUrl: previousSourceUrl,
      importedFileName: file.name,
      importedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CMS JSON import] Parse/read failed:', error);
    setStaticCmsDraftState({
      importError: 'Không nhập được file JSON. File không đúng định dạng hoặc thiếu cấu trúc CMS hợp lệ.',
      importSuccess: null,
      exportError: null,
      exportSuccess: null,
    });
  }
  handlers.onRerender?.();
}

function validateStaticCmsJsonFile(file) {
  if (!file) {
    return { valid: false, message: 'Chưa chọn file JSON.' };
  }
  const fileName = String(file.name || '').trim();
  if (!/\.json$/i.test(fileName)) {
    return { valid: false, message: 'Không nhập được file. Vui lòng chọn đúng file có phần mở rộng .json.' };
  }
  if (Number(file.size || 0) > MAX_JSON_IMPORT_BYTES) {
    return { valid: false, message: 'Không nhập được file JSON. Dung lượng tối đa cho phép là 2 MB.' };
  }
  return { valid: true, message: '' };
}

function readLocalJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Không đọc được file JSON.'));
    reader.onabort = () => reject(new Error('Đã hủy đọc file JSON.'));
    reader.readAsText(file, 'utf-8');
  });
}

function isPlainJsonObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getFirstValidationMessage(validation = {}) {
  const errors = validation.errors || {};
  const firstKey = Object.keys(errors)[0];
  return firstKey ? String(errors[firstKey] || '') : '';
}

function createImportedDraftTitle(cmsJson = {}, fileName = '') {
  const version = String(cmsJson?.version || '').trim();
  const baseName = String(fileName || 'file JSON').replace(/\.json$/i, '').trim();
  const suffix = version || baseName || 'file JSON';
  return `Bản nháp nhập ${suffix}`.slice(0, 160);
}

function handleExportStaticDraft(handlers = {}) {
  const current = getState().staticCmsDraft || {};
  if (!current.draftJson) return;
  const exportJson = createStaticCmsExportJson(current.draftJson);
  const validation = validateStaticCmsDraft(exportJson, STATIC_CMS_DRAFT_CONFIG);
  if (!validation.valid) {
    setStaticCmsDraftState({ validation, exportError: 'Validation còn lỗi blocker. Chưa export JSON.', exportSuccess: null });
    handlers.onRerender?.();
    return;
  }
  const fileName = `cms_public_content.draft_I_H_${timestampForFileName(new Date())}.json`;
  downloadJson(fileName, exportJson);
  setStaticCmsDraftState({ validation, lastExportName: fileName, exportSuccess: `Đã export ${fileName}.`, exportError: null });
  handlers.onRerender?.();
}

async function handleCopyStaticDraft(handlers = {}) {
  const current = getState().staticCmsDraft || {};
  if (!current.draftJson || !navigator?.clipboard) return;
  const exportJson = createStaticCmsExportJson(current.draftJson);
  const validation = validateStaticCmsDraft(exportJson, STATIC_CMS_DRAFT_CONFIG);
  if (!validation.valid) {
    setStaticCmsDraftState({ validation, exportError: 'Validation còn lỗi blocker. Chưa copy JSON.', exportSuccess: null });
    handlers.onRerender?.();
    return;
  }
  await navigator.clipboard.writeText(JSON.stringify(exportJson, null, 2));
  setStaticCmsDraftState({ validation, exportSuccess: 'Đã copy JSON draft vào clipboard.', exportError: null });
  handlers.onRerender?.();
}

function applyDraftFieldChange(draftState = {}, fieldName, value) {
  const draftJson = cloneJson(draftState.draftJson || {});
  const roomKey = draftState.selectedRoom || 'indoor';
  const itemCode = draftState.selectedItemCode || '';
  const items = getDraftRoomItems(draftJson, roomKey);
  const item = items.find((entry) => getItemCode(entry) === itemCode);
  if (!item || LOCKED_EXPORT_FIELDS.has(fieldName)) {
    return { draftJson, validation: validateStaticCmsDraft(draftJson, STATIC_CMS_DRAFT_CONFIG) };
  }
  patchFieldAliases(item, fieldName, value);
  const sanitized = sanitizeStaticCmsExport(draftJson, { keepVersion: true });
  return { draftJson: sanitized, validation: validateStaticCmsDraft(sanitized, STATIC_CMS_DRAFT_CONFIG) };
}

function patchFieldAliases(item, fieldName, value) {
  const normalized = String(value ?? '').trim();
  if (['image', 'imageUrl', 'image_url', 'src', 'url'].includes(fieldName)) {
    ['image', 'imageUrl', 'image_url', 'src', 'url'].forEach((key) => { item[key] = normalized; });
    return;
  }
  if (['thumbnail', 'thumbnailUrl', 'thumbnail_url'].includes(fieldName)) {
    ['thumbnail', 'thumbnailUrl', 'thumbnail_url'].forEach((key) => { item[key] = normalized; });
    return;
  }
  if (['videoUrl', 'video_url'].includes(fieldName)) {
    ['videoUrl', 'video_url'].forEach((key) => { item[key] = normalized; });
    return;
  }
  if (['poster', 'posterUrl', 'poster_url'].includes(fieldName)) {
    ['poster', 'posterUrl', 'poster_url'].forEach((key) => { item[key] = normalized; });
    return;
  }
  if (['author', 'artist'].includes(fieldName)) {
    ['author', 'artist'].forEach((key) => { item[key] = normalized; });
    return;
  }
  if (['realSize', 'real_size'].includes(fieldName)) {
    ['realSize', 'real_size'].forEach((key) => { item[key] = normalized; });
    return;
  }
  item[fieldName] = normalized;
}

function createStaticCmsExportJson(draftJson = {}) {
  const out = sanitizeStaticCmsExport(draftJson, { keepVersion: false });
  out.schemaVersion = out.schemaVersion || 1;
  out.version = STATIC_CMS_DRAFT_CONFIG.exportVersion;
  out.source = STATIC_CMS_DRAFT_CONFIG.exportSource;
  out.updatedAt = new Date().toISOString();
  out.publishedAt = out.publishedAt || '';
  return out;
}

function sanitizeStaticCmsExport(cmsJson = {}, options = {}) {
  const sharedValidator = globalThis.cmsSchemaValidator || null;
  const json = sharedValidator?.normalizeCmsContentDocument
    ? sharedValidator.normalizeCmsContentDocument(cmsJson, {
      keepLegacyRoomItems: false,
      keepLegacyFeaturedAlias: false,
      dropLegacyAliases: true,
    })
    : cloneJson(cmsJson || {});
  normalizeStaticCmsRooms(json);
  ROOM_KEYS.forEach((roomKey) => {
    const room = json.rooms[roomKey];
    room.artworks = safeArray(room.artworks).map((item, index) => sanitizeStaticCmsArtwork(item, roomKey, index));
  });
  if (!options.keepVersion) {
    json.version = STATIC_CMS_DRAFT_CONFIG.exportVersion;
    json.source = STATIC_CMS_DRAFT_CONFIG.exportSource;
  }
  return json;
}

function sanitizeStaticCmsArtwork(item = {}, roomKey, index) {
  const clean = {};
  Object.entries(item || {}).forEach(([key, value]) => {
    if (LOCKED_EXPORT_FIELDS.has(key)) return;
    if ((value === null || value === undefined || value === '') && !OPTIONAL_EMPTY_ALLOWED.has(key)) return;
    clean[key] = value;
  });
  const code = getItemCode(clean) || `ITEM_${String(index + 1).padStart(3, '0')}`;
  clean.artwork_code = code;
  clean.id = clean.id || code;
  clean.room_key = roomKey;
  clean.isVisible = clean.isVisible !== false && clean.is_visible !== false;
  clean.sortOrder = Number.isFinite(Number(clean.sortOrder ?? clean.sort_order)) ? Number(clean.sortOrder ?? clean.sort_order) : index + 1;
  const sharedValidator = globalThis.cmsSchemaValidator || null;
  return sharedValidator?.normalizeCmsArtworkAliases
    ? sharedValidator.normalizeCmsArtworkAliases(clean, code, { fallbackOrder: index + 1, dropLegacyAliases: true })
    : clean;
}

function normalizeStaticCmsRooms(json = {}) {
  if (!json.rooms || typeof json.rooms !== 'object') json.rooms = {};
  ROOM_KEYS.forEach((roomKey) => {
    if (!json.rooms[roomKey] || typeof json.rooms[roomKey] !== 'object') json.rooms[roomKey] = {};
    if (!Array.isArray(json.rooms[roomKey].artworks)) json.rooms[roomKey].artworks = [];
  });
  return json;
}

function getSelectedDraftItem(draftState = {}) {
  const items = getDraftRoomItems(draftState.draftJson, draftState.selectedRoom);
  return items.find((item) => getItemCode(item) === draftState.selectedItemCode) || items[0] || null;
}

function getDraftRoomItems(cmsJson = {}, roomKey = 'indoor') {
  return safeArray(cmsJson?.rooms?.[roomKey]?.artworks);
}

function getStaticItemVisibilityLabel(item = {}) {
  const visible = item?.isVisible !== false && item?.is_visible !== false && item?.visible !== false && item?.active !== false;
  return visible ? 'Đang hiển thị' : 'Đang ẩn';
}

function getStaticItemReferenceKeys(item = {}) {
  return [
    item?.artwork_code,
    item?.artworkId,
    item?.artwork_id,
    item?.id,
    item?.code,
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
}

function isStaticItemReferencedByFeatured(cmsJson = {}, roomKey = 'indoor', item = {}) {
  const itemKeys = new Set(getStaticItemReferenceKeys(item));
  if (!itemKeys.size) return false;
  const room = normalizeStaticRoomKey(roomKey);
  const featured = getFeaturedOperatorSection(cmsJson);
  return safeArray(featured.items).some((entry) => {
    const entryRoom = String(entry?.room || '').trim().toLowerCase();
    if (entryRoom && entryRoom !== room) return false;
    const references = [entry?.artworkId, entry?.id, entry?.code, entry?.artwork_code]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    return references.some((value) => itemKeys.has(value));
  });
}

function getItemCode(item = {}) {
  return String(item?.artwork_code || item?.id || item?.code || '').trim();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function downloadJson(fileName, json) {
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function timestampForFileName(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
