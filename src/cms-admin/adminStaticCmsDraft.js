import { ADMIN_COPY } from './adminCopy.js';
import { createCmsDraft, discardCmsDraft, getCmsDraft, listCmsDrafts, publishCmsJson, updateCmsDraft, uploadCmsMedia } from './adminApi.js';
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
  applySavedStaticCmsDraft,
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
    description: 'Có thể nhập đường dẫn hoặc tải ảnh/video từ máy. Website chỉ thay đổi sau khi công khai.',
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

export function renderStaticCmsDraftTab(state, handlers = {}) {
  const copy = ADMIN_COPY.staticDraft || {};
  const draftState = state.staticCmsDraft || {};
  const currentItem = getSelectedDraftItem(draftState);
  const panel = createElement('section', { className: 'cms-admin-static-draft-shell cms-admin-static-workspace-shell' });

  panel.appendChild(renderStaticWorkspaceCommandBar(draftState, state, currentItem, handlers, copy));

  if (draftState.loadError) {
    panel.appendChild(renderErrorBox(draftState.loadError, 'Không tải được nội dung đang công khai'));
  }

  if (!draftState.draftJson) {
    const empty = createElement('section', { className: 'cms-admin-panel cms-admin-static-empty-panel cms-admin-static-workspace-empty' });
    empty.appendChild(renderEmptyState(copy.noBaseline || 'Chưa tải nội dung đang công khai.'));
    empty.appendChild(createElement('p', {
      className: 'cms-admin-help-text',
      text: 'Bấm “Tải nội dung đang công khai” để lấy nội dung public đang phục vụ Viewer. Thao tác này chỉ mở bản nháp, chưa làm thay đổi website.',
    }));
    panel.appendChild(empty);
    return panel;
  }

  panel.appendChild(renderStaticWorkspaceShell(draftState, state, currentItem, handlers, copy));
  panel.appendChild(renderUtilityDrawers(draftState, state, currentItem, handlers, copy));
  return panel;
}

function renderStaticWorkspaceCommandBar(draftState = {}, appState = {}, currentItem = null, handlers = {}, copy = {}) {
  const activeWorkspace = getActiveWorkspace(draftState);
  const featured = getFeaturedOperatorSection(draftState.draftJson);
  const bar = createElement('section', { className: 'cms-admin-panel cms-admin-static-command-bar cms-admin-operator-command-bar' });

  const left = createElement('div', { className: 'cms-admin-static-command-main' });
  left.appendChild(createElement('p', { className: 'cms-admin-eyebrow', text: 'Quản trị nội dung' }));
  const titleRow = createElement('div', { className: 'cms-admin-static-command-title-row' });
  titleRow.appendChild(createElement('h2', { className: 'cms-admin-static-title', text: 'Nội dung quản trị' }));
  titleRow.appendChild(renderBadge(getFriendlyDraftStateLabel(draftState), getFriendlyDraftStateVariant(draftState)));
  left.appendChild(titleRow);
  left.appendChild(createElement('p', {
    className: 'cms-admin-subtitle cms-admin-static-command-subtitle',
    text: 'Chỉnh nội dung hiển thị trong phòng 3D và khu Tác phẩm tiêu biểu trên Trang chủ.',
  }));
  left.appendChild(renderWorkspaceSwitch(draftState, handlers));

  const context = createElement('div', { className: 'cms-admin-static-command-context' });
  if (activeWorkspace === 'featured') {
    context.appendChild(renderInfoTile('Đang sửa', 'Tác phẩm tiêu biểu'));
    context.appendChild(renderInfoTile('Số mục', String(safeArray(featured.items).length)));
    context.appendChild(renderInfoTile('Trạng thái', featured.enabled === false ? 'Đang ẩn trên Trang chủ' : 'Đang hiển thị'));
  } else {
    const rooms = draftState.draftJson?.rooms || {};
    context.appendChild(renderInfoTile('Đang sửa', currentItem ? `${getRoomLabel(draftState.selectedRoom)} / ${getItemCode(currentItem) || 'item'}` : 'Chưa chọn item'));
    context.appendChild(renderInfoTile('Trong nhà', `${safeArray(rooms.indoor?.artworks).length} item`));
    context.appendChild(renderInfoTile('Ngoài trời', `${safeArray(rooms.outdoor?.artworks).length} item`));
  }

  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-static-command-actions' });
  actions.appendChild(renderMainLoadActions(draftState, handlers));
  if (draftState.draftJson) {
    actions.appendChild(renderPrimaryOperatorActions(draftState, appState, handlers));
    actions.appendChild(renderDrawerTrigger('Quản lý bản nháp', 'drafts', handlers));
    actions.appendChild(renderDrawerTrigger('Dành cho kỹ thuật', 'advanced', handlers));
  }

  appendChildren(bar, [left, context, actions]);
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
  if (draftState.currentDraftId) return 'Đã lưu bản nháp';
  return 'Chưa lưu bản nháp';
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

function renderStaticWorkspaceShell(draftState = {}, appState = {}, currentItem = null, handlers = {}, copy = {}) {
  if (getActiveWorkspace(draftState) === 'featured') {
    return renderFeaturedWorkspaceShell(draftState, appState, handlers, copy);
  }
  const shell = createElement('section', { className: 'cms-admin-static-workspace cms-admin-static-room-workspace' });
  shell.appendChild(renderWorkspaceItemNavigator(draftState, currentItem, handlers));
  shell.appendChild(renderWorkspaceEditor(draftState, currentItem, handlers, copy));
  shell.appendChild(renderWorkspaceInspector(draftState, appState, currentItem, handlers, copy));
  return shell;
}

function renderWorkspaceItemNavigator(draftState = {}, currentItem = null, handlers = {}) {
  const pane = createElement('aside', { className: 'cms-admin-panel cms-admin-static-workspace-pane cms-admin-static-left-pane' });
  pane.appendChild(renderStaticPanelTitle('Chọn item', renderRoomCountMeta(draftState)));
  pane.appendChild(renderRoomAndItemSelector(draftState, handlers));
  pane.appendChild(renderItemCards(draftState, handlers));
  if (currentItem) {
    const note = createElement('details', { className: 'cms-admin-static-locked-note cms-admin-static-locked-note-compact' });
    note.appendChild(createElement('summary', { text: 'Khóa kỹ thuật' }));
    note.appendChild(createElement('p', {
      className: 'cms-admin-help-text',
      text: 'Thông tin kỹ thuật của item được giữ nguyên. Người vận hành chỉ cần sửa nội dung, ảnh/video hoặc thông tin thêm.',
    }));
    pane.appendChild(note);
  }
  return pane;
}

function renderWorkspaceEditor(draftState = {}, currentItem = null, handlers = {}, copy = {}) {
  const pane = createElement('section', { className: 'cms-admin-panel cms-admin-static-workspace-pane cms-admin-static-editor-pane' });
  pane.appendChild(renderStaticPanelTitle('Sửa nội dung', draftState.dirty ? (copy.dirty || 'Có thay đổi chưa lưu') : (copy.clean || 'Đã lưu / chưa có thay đổi')));
  if (!currentItem) {
    pane.appendChild(renderEmptyState(copy.noItem || 'Chưa chọn tác phẩm / item.'));
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
  pane.appendChild(renderPublishInspectorPanel(draftState, appState, handlers));
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
    publishDetails: {
      title: 'Chi tiết kỹ thuật công khai',
      description: 'Thông tin server-side gate, backup, latest/version object và cảnh báo kỹ thuật.',
      content: () => renderPublishGatePanel(draftState, appState, handlers, copy),
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
  const shell = createElement('section', { className: 'cms-admin-static-workspace cms-admin-featured-workspace' });
  shell.appendChild(renderFeaturedWorkspaceNavigator(draftState, featured, validation, handlers));
  shell.appendChild(renderFeaturedWorkspaceEditor(draftState, featured, validation, handlers));
  shell.appendChild(renderFeaturedWorkspaceInspector(featured, validation));
  return shell;
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
  pane.appendChild(renderStaticPanelTitle('Danh sách tiêu biểu', `${safeArray(featured.items).length}/${FEATURED_OPERATOR_MAX_ITEMS}`));
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
  pane.appendChild(renderFeaturedSectionSettings(draftState, featured, handlers));
  const selectedIndex = getSelectedFeaturedIndex(draftState, featured);
  const selectedItem = selectedIndex >= 0 ? featured.items[selectedIndex] : null;
  if (!selectedItem) {
    pane.appendChild(renderEmptyState('Chọn hoặc thêm một tác phẩm tiêu biểu để chỉnh sửa.'));
    return pane;
  }
  pane.appendChild(renderFeaturedItemEditor(draftState, selectedItem, selectedIndex, featured.items.length, validation, handlers));
  return pane;
}

function renderFeaturedWorkspaceInspector(featured = {}, validation = {}) {
  const pane = createElement('aside', { className: 'cms-admin-static-workspace-pane cms-admin-static-inspector-pane cms-admin-featured-inspector' });
  const head = createElement('section', { className: 'cms-admin-panel cms-admin-featured-friendly-status' });
  head.appendChild(renderStaticPanelTitle('Xem trước Trang chủ', validation.valid ? 'Sẵn sàng' : 'Cần sửa'));
  head.appendChild(createElement('p', { className: 'cms-admin-help-text', text: validation.valid ? 'Nội dung tiêu biểu hợp lệ. Hãy lưu bản nháp trước khi công khai.' : 'Có mục thiếu thông tin cần kiểm tra.' }));
  pane.appendChild(head);
  pane.appendChild(renderFeaturedPreview(featured, validation));
  pane.appendChild(renderFeaturedValidationSummary(validation));
  return pane;
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
  const access = getPublishGateAccess(appState);
  const readiness = getPublishReadiness(draftState, access);
  const dryRunReady = hasCurrentDryRunPass(draftState);

  const saveButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    type: 'button',
    text: draftState.isSavingDraft ? 'Đang lưu...' : 'Lưu bản nháp',
    title: draftState.currentDraftId ? 'Cập nhật bản nháp hiện tại.' : 'Tạo bản nháp mới bằng nội dung đang sửa.',
  });
  saveButton.disabled = Boolean(draftState.isSavingDraft || !draftState.draftJson || !draftState.validation?.valid);
  saveButton.addEventListener('click', () => handleSaveStaticCmsDraft({ asNew: !draftState.currentDraftId, handlers }));

  const checkButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    type: 'button',
    text: draftState.isPublishingCms ? 'Đang kiểm tra...' : 'Kiểm tra trước khi công khai',
  });
  checkButton.disabled = Boolean(draftState.isPublishingCms || !readiness.ready);
  checkButton.addEventListener('click', () => handlePublishStaticCmsDraft({ dryRun: true, handlers }));

  const publishButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    type: 'button',
    text: draftState.isPublishingCms ? 'Đang công khai...' : 'Công khai nội dung',
    title: dryRunReady ? 'Công khai bản nháp đã kiểm tra.' : 'Cần kiểm tra trước khi công khai và đạt PASS.',
  });
  publishButton.disabled = Boolean(draftState.isPublishingCms || !readiness.ready || !dryRunReady);
  publishButton.addEventListener('click', () => handlePublishStaticCmsDraft({ dryRun: false, handlers }));

  const historyButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost',
    type: 'button',
    text: 'Khôi phục phiên bản',
  });
  historyButton.addEventListener('click', () => handlers.onOpenHistory?.());

  appendChildren(actions, [saveButton, checkButton, publishButton, historyButton]);
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
  const remove = createElement('button', { className: 'cms-admin-button cms-admin-button-danger cms-admin-button-small', type: 'button', text: 'Xóa khỏi tiêu biểu' });
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

function renderFeaturedImageControl({ item = {}, sourceIndex = 0, required = false, error = '', onChange, onReplace } = {}) {
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
  actions.appendChild(replaceButton);
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
    text: 'Chọn ảnh từ máy là cách khuyến nghị. Ảnh chỉ được gắn vào bản nháp sau khi bạn bấm “Dùng ảnh này”; website công khai chưa thay đổi.',
  }));
  header.appendChild(heading);
  panel.appendChild(header);

  const currentGrid = createElement('div', { className: 'cms-admin-featured-image-current-grid' });
  currentGrid.appendChild(renderFeaturedImageReplaceMedia('Ảnh hiện tại', String(item.imageUrl || '').trim(), item.alt || item.title || ''));
  currentGrid.appendChild(renderFeaturedLocalUploadArea(draftState, item, sourceIndex, handlers));
  panel.appendChild(currentGrid);

  panel.appendChild(renderFeaturedUrlReplaceArea(draftState, item, sourceIndex, handlers));
  panel.appendChild(createElement('div', {
    className: 'cms-admin-alert cms-admin-alert-warning',
    text: 'Upload hoặc thay URL không tự lưu và không tự công khai. Sau khi bấm “Dùng ảnh này”, hãy bấm “Lưu vào bản nháp”, rồi dùng quy trình công khai hiện có.',
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
    text: `Ảnh JPG, PNG hoặc WebP; tối đa ${formatUploadSizeLimit('image')}. Upload đi qua cổng máy chủ an toàn, không ghi trực tiếp vào Storage từ trình duyệt.`,
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
  });
  uploadButton.disabled = !hasDraftId || !featuredImageReplaceState.localFile || featuredImageReplaceState.localStatus === 'uploading';
  uploadButton.addEventListener('click', () => handleUploadFeaturedLocalImage(draftState, item, sourceIndex, handlers));

  const useButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary cms-admin-button-small',
    type: 'button',
    text: 'Dùng ảnh này',
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
  if (!validation.valid) panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-error', text: 'Bản xem trước đang có lỗi nội dung. Hãy sửa các mục được đánh dấu trước khi lưu bản nháp.' }));
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
  }, handlers, 'Đã thêm một mục Tác phẩm tiêu biểu mới. Hãy bổ sung ảnh trước khi lưu bản nháp.');
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
  heading.appendChild(createElement('p', { text: 'Chọn file từ máy hoặc dùng URL có sẵn. Upload chỉ gắn URL vào bản nháp, chưa công khai website.' }));
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
    wrap.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: `Upload thành công: ${draftState.lastMediaUpload.fieldName || ''} đã được gắn vào bản nháp. Website public chưa thay đổi.` }));
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
  card.appendChild(createElement('p', { className: 'cms-admin-help-text', text: `${target.help} Giới hạn: ${formatUploadSizeLimit(target.mediaKind)}.` }));

  const uploadFieldToken = makeCmsControlIdToken(target.fieldName || target.key || 'media');
  const input = createElement('input', {
    className: 'cms-admin-input cms-admin-static-upload-input',
    type: 'file',
    attrs: {
      id: `cms-admin-static-media-upload-${makeCmsControlIdToken(roomKey)}-${makeCmsControlIdToken(itemCode, 'item')}-${uploadFieldToken}`,
      name: `staticMediaUpload-${uploadFieldToken}`,
      accept: getUploadAccept(target.mediaKind),
    },
  });
  const uploadButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary cms-admin-button-small',
    type: 'button',
    text: status.loading ? 'Đang upload...' : 'Upload vào bản nháp',
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
  const access = getPublishGateAccess(appState);
  const readiness = getPublishReadiness(draftState, access);
  const dryRunReady = hasCurrentDryRunPass(draftState);
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-static-publish-panel cms-admin-static-inspector-card' });
  panel.appendChild(renderStaticPanelTitle('Công khai', dryRunReady ? 'Đã kiểm tra' : readiness.ready ? 'Sẵn sàng kiểm tra' : 'Chưa sẵn sàng'));

  const statusText = draftState.publishStatus
    || draftState.publishError
    || (dryRunReady ? 'Đã kiểm tra xong. Có thể công khai nội dung.' : readiness.ready ? 'Bản nháp đã lưu. Hãy kiểm tra trước khi công khai.' : readiness.reason);
  panel.appendChild(createElement('div', {
    className: draftState.publishError ? 'cms-admin-alert cms-admin-alert-error' : dryRunReady || draftState.publishResult?.ok ? 'cms-admin-alert cms-admin-alert-success' : 'cms-admin-alert cms-admin-alert-warning',
    text: statusText,
  }));

  const mini = createElement('div', { className: 'cms-admin-static-readiness-grid' });
  mini.appendChild(renderInfoTile('Bản nháp', draftState.currentDraftId ? 'Đã lưu' : 'Chưa lưu'));
  mini.appendChild(renderInfoTile('Kiểm tra', draftState.validation?.valid ? 'Nội dung hợp lệ' : 'Cần xử lý'));
  mini.appendChild(renderInfoTile('Công khai', dryRunReady ? 'Có thể công khai' : 'Cần kiểm tra trước'));
  panel.appendChild(mini);

  const detailsButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-small',
    type: 'button',
    text: 'Chi tiết kỹ thuật',
  });
  detailsButton.addEventListener('click', () => {
    setStaticCmsDraftDrawer('publishDetails');
    handlers.onRerender?.();
  });
  panel.appendChild(detailsButton);
  return panel;
}


function renderPublishGatePanel(draftState = {}, appState = {}, handlers = {}, copy = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-static-publish-panel' });
  panel.appendChild(renderStaticPanelTitle('Công khai nội dung', draftState.publishResult?.publishedVersion || 'Kiểm tra hệ thống'));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Công khai sẽ thay đổi website public. Phase này chỉ cho admin publish bản nháp đã lưu server-side qua Edge Function publish-cms-json, có backup, verify và rollback tự động nếu lỗi.',
  }));

  if (!ADMIN_FEATURE_FLAGS.allowStaticCmsPublishGate || !CMS_PUBLISH_GATE_CONFIG.enabled) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: 'Cổng công khai server-side đang bị khóa bằng feature flag.' }));
    return panel;
  }

  const access = getPublishGateAccess(appState);
  if (!access.allowed) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: access.reason }));
  }

  const readiness = getPublishReadiness(draftState, access);
  const dryRunReady = hasCurrentDryRunPass(draftState);
  if (!readiness.ready) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning', text: readiness.reason }));
  } else {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: 'Bản nháp đã lưu và đủ điều kiện kiểm tra. Hãy kiểm tra trước khi công khai.' }));
  }

  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-static-publish-actions' });
  const dryRunButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    type: 'button',
    text: draftState.isPublishingCms ? 'Đang kiểm tra...' : 'Kiểm tra trước khi công khai',
  });
  dryRunButton.disabled = draftState.isPublishingCms || !readiness.ready;
  dryRunButton.addEventListener('click', () => handlePublishStaticCmsDraft({ dryRun: true, handlers }));

  const publishButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    type: 'button',
    text: draftState.isPublishingCms ? 'Đang công khai...' : 'Công khai nội dung',
  });
  publishButton.disabled = draftState.isPublishingCms || !readiness.ready || !dryRunReady;
  publishButton.addEventListener('click', () => handlePublishStaticCmsDraft({ dryRun: false, handlers }));
  appendChildren(actions, [dryRunButton, publishButton]);
  panel.appendChild(actions);

  panel.appendChild(renderPublishGateStatus(draftState));
  panel.appendChild(renderPublishGateHelp(draftState));
  return panel;
}

function renderPublishGateStatus(draftState = {}) {
  const wrap = createElement('div', { className: 'cms-admin-static-publish-status' });
  if (draftState.publishStatus) {
    wrap.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-success', text: draftState.publishStatus }));
  }
  if (draftState.publishError) {
    wrap.appendChild(renderErrorBox(draftState.publishError, 'Công khai nội dung chưa thành công'));
  }
  const result = draftState.publishResult || draftState.publishDryRunResult;
  if (!result) return wrap;

  const grid = createElement('div', { className: 'cms-admin-static-publish-result-grid' });
  const entries = [
    ['Trạng thái', result.ok === true ? 'Đạt' : 'Lỗi'],
    ['Chế độ', result.dryRun ? 'Kiểm tra trước' : 'Công khai'],
    ['Phiên bản kỹ thuật', result.publishedVersion || result.plan?.publishedVersion || '—'],
    ['Latest', result.latestPath || result.plan?.latestPath || '—'],
    ['Backup', result.backupPath || result.plan?.backupPath || '—'],
    ['Versioned', result.versionPath || result.plan?.versionPath || '—'],
    ['Verify', result.verifyStatus || result.verify?.status || '—'],
  ];
  entries.forEach(([label, value]) => grid.appendChild(renderStatusChip(label, String(value || '—'), label === 'Trạng thái' && value === 'PASS' ? 'success' : 'default')));
  const details = createElement('details', { className: 'cms-admin-static-technical-details cms-admin-static-publish-technical-details' });
  details.appendChild(createElement('summary', { text: 'Chi tiết kỹ thuật publish' }));
  details.appendChild(grid);
  wrap.appendChild(details);
  if (result.rollbackAttempted) {
    wrap.appendChild(createElement('div', {
      className: result.rollbackVerified ? 'cms-admin-alert cms-admin-alert-success' : 'cms-admin-alert cms-admin-alert-error',
      text: result.rollbackVerified ? 'Publish lỗi nhưng đã rollback latest từ backup.' : 'Publish lỗi và rollback chưa được xác minh. Cần operator kiểm tra ngay.',
    }));
  }
  return wrap;
}

function renderPublishGateHelp() {
  const wrap = createElement('div', { className: 'cms-admin-static-publish-help' });
  const steps = createElement('ol', { className: 'cms-admin-static-steps' });
  [
    'Lưu bản nháp trước khi công khai.',
    'Bấm “Kiểm tra trước khi công khai” để Edge Function validate bản nháp trên server.',
    'Nếu PASS, bấm “Công khai nội dung” và xác nhận 2 bước. Edge Function sẽ backup latest, ghi versioned object, ghi latest, verify và rollback tự động nếu lỗi.',
  ].forEach((step) => steps.appendChild(createElement('li', { text: step })));
  wrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Không gọi script I_F từ browser. Script I_F vẫn là operator fallback khi cần xử lý thủ công có kiểm soát.' }));
  wrap.appendChild(steps);
  return wrap;
}

function getPublishGateAccess(appState = {}) {
  if (!appState.supabase) return { allowed: false, reason: 'Supabase client chưa sẵn sàng.' };
  if (!appState.session?.user?.id) return { allowed: false, reason: 'Cần đăng nhập để công khai bản nháp.' };
  const role = String(appState.profile?.role || '').trim().toLowerCase();
  const active = appState.profile?.is_active === true;
  if (!active || role !== 'admin') {
    return { allowed: false, reason: 'Phase này chỉ tài khoản admin đang hoạt động được công khai bản nháp.' };
  }
  return { allowed: true, userId: appState.session.user.id, role };
}

function hasCurrentDryRunPass(draftState = {}) {
  const result = draftState.publishDryRunResult || null;
  if (!result || result.ok !== true || result.dryRun !== true) return false;
  const version = String(draftState.draftJson?.version || '').trim();
  const resultVersion = String(result.publishedVersion || result.plan?.publishedVersion || '').trim();
  return !version || !resultVersion || version === resultVersion;
}

function getPublishReadiness(draftState = {}, access = {}) {
  if (!access.allowed) return { ready: false, reason: access.reason || 'Không đủ quyền publish.' };
  if (!draftState.draftJson) return { ready: false, reason: 'Chưa load CMS draft.' };
  if (!draftState.currentDraftId) return { ready: false, reason: 'Cần lưu bản nháp trước khi công khai.' };
  if (draftState.dirty) return { ready: false, reason: 'Bản nháp đang có thay đổi chưa lưu. Hãy lưu bản nháp trước khi công khai.' };
  if (draftState.isSavingDraft) return { ready: false, reason: 'Đang lưu bản nháp, vui lòng chờ hoàn tất.' };
  if (draftState.isUploadingMedia) return { ready: false, reason: 'Đang upload media, vui lòng chờ hoàn tất.' };
  if (!draftState.validation?.valid) return { ready: false, reason: 'Nội dung còn lỗi cần xử lý. Chưa được công khai.' };
  return { ready: true, reason: 'OK' };
}

async function handlePublishStaticCmsDraft({ dryRun = true, handlers = {} } = {}) {
  const appState = getState();
  const draftState = appState.staticCmsDraft || {};
  const access = getPublishGateAccess(appState);
  const readiness = getPublishReadiness(draftState, access);
  if (!readiness.ready) {
    setStaticCmsPublishState({ publishError: readiness.reason, publishStatus: '', publishResult: null });
    handlers.onRerender?.();
    return;
  }
  if (!dryRun && !hasCurrentDryRunPass(draftState)) {
    setStaticCmsPublishState({ publishError: 'Cần bấm “Kiểm tra” và nội dung phải đạt trước khi công khai.', publishStatus: '', publishResult: null });
    handlers.onRerender?.();
    return;
  }

  const confirmVersion = String(draftState.draftJson?.version || '').trim();
  if (!dryRun) {
    const stepOne = window.confirm('Thao tác này sẽ thay đổi website public bằng bản nháp CMS đã lưu. Tiếp tục?');
    if (!stepOne) return;
    const indoorCount = getDraftRoomItems(draftState.draftJson, 'indoor').length;
    const outdoorCount = getDraftRoomItems(draftState.draftJson, 'outdoor').length;
    const stepTwo = window.confirm(`Xác nhận công khai version ${confirmVersion || 'không rõ'} với indoor ${indoorCount} item và outdoor ${outdoorCount} item?`);
    if (!stepTwo) return;
  }

  setStaticCmsPublishState({
    isPublishingCms: true,
    publishError: null,
    publishStatus: dryRun ? 'Đang kiểm tra server-side...' : 'Đang công khai bản nháp...',
    publishDryRunResult: dryRun ? null : draftState.publishDryRunResult,
    publishResult: dryRun ? draftState.publishResult : null,
  });
  handlers.onRerender?.();

  const result = await publishCmsJson(appState.supabase, {
    draftId: draftState.currentDraftId,
    confirmVersion,
    dryRun,
  });

  if (result.error) {
    setStaticCmsPublishState({
      isPublishingCms: false,
      publishError: normalizeErrorMessage(result.error),
      publishStatus: '',
      publishResult: dryRun ? draftState.publishResult : (result.data || null),
      publishDryRunResult: dryRun ? (result.data || null) : draftState.publishDryRunResult,
    });
    handlers.onRerender?.();
    return;
  }

  setStaticCmsPublishState({
    isPublishingCms: false,
    publishError: null,
    publishStatus: dryRun ? 'Đã kiểm tra xong. Website chưa thay đổi.' : 'Đã công khai nội dung.',
    publishDryRunResult: dryRun ? result.data : draftState.publishDryRunResult,
    publishResult: dryRun ? draftState.publishResult : result.data,
    publishLastVerifiedAt: new Date().toISOString(),
  });
  handlers.onRerender?.();
}

function renderDraftPersistencePanel(draftState = {}, appState = {}, handlers = {}, copy = {}) {
  const panel = createElement('section', { className: 'cms-admin-static-draft-manager-panel' });
  panel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Quản lý tên, ghi chú, bản sao và danh sách bản nháp đã lưu. Nút “Lưu bản nháp” chính nằm trên command bar để tránh thao tác trùng lặp.',
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
  saveAsButton.addEventListener('click', () => handleSaveStaticCmsDraft({ asNew: true, handlers }));

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
  if (!appState.session?.user?.id) return { allowed: false, reason: 'Cần đăng nhập để lưu bản nháp server-side.' };
  const role = String(appState.profile?.role || '').trim();
  const active = appState.profile?.is_active === true;
  if (!active || !['admin', 'editor'].includes(role)) {
    return { allowed: false, reason: 'Tài khoản không có quyền lưu bản nháp CMS.' };
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

async function handleSaveStaticCmsDraft({ asNew = false, handlers = {} } = {}) {
  const appState = getState();
  const draftState = appState.staticCmsDraft || {};
  const access = getDraftPersistenceAccess(appState);
  if (!access.allowed) {
    setStaticCmsDraftPersistenceState({ draftPersistenceError: access.reason });
    handlers.onRerender?.();
    return;
  }
  if (!draftState.draftJson) return;

  const exportJson = createStaticCmsExportJson(draftState.draftJson);
  const validation = validateStaticCmsDraft(exportJson, STATIC_CMS_DRAFT_CONFIG);
  if (!validation.valid) {
    setStaticCmsDraftPersistenceState({ validation, draftPersistenceError: 'Nội dung còn lỗi cần xử lý. Chưa lưu bản nháp.', draftSaveStatus: '' });
    handlers.onRerender?.();
    return;
  }

  setStaticCmsDraftPersistenceState({ isSavingDraft: true, draftPersistenceError: null, draftSaveStatus: '' });
  handlers.onRerender?.();

  const payload = {
    title: (asNew && !draftState.draftTitleTouched) ? createOperatorDraftTitle(draftState, { forceTimestamp: true }) : (draftState.draftTitle || createOperatorDraftTitle(draftState)),
    status: validation.valid ? 'validated' : 'draft',
    content_json: exportJson,
    validation_json: validation,
    source_version: draftState.draftJson?.version || exportJson.version || '',
    source_url: draftState.sourceUrl || STATIC_CMS_DRAFT_CONFIG.remoteUrl || '',
    source_type: draftState.source || 'draft',
    note: draftState.draftNote || '',
  };

  const result = (!asNew && draftState.currentDraftId)
    ? await updateCmsDraft(appState.supabase, draftState.currentDraftId, payload, access.userId)
    : await createCmsDraft(appState.supabase, payload, access.userId);

  if (result.error) {
    setStaticCmsDraftPersistenceState({ isSavingDraft: false, draftPersistenceError: normalizeErrorMessage(result.error) });
    handlers.onRerender?.();
    return;
  }

  setStaticCmsDraftPersistenceState({
    isSavingDraft: false,
    currentDraftId: result.data?.id || draftState.currentDraftId || '',
    draftLastSavedAt: result.data?.updated_at || new Date().toISOString(),
    draftTitle: payload.title,
    draftTitleTouched: Boolean(draftState.draftTitleTouched || asNew),
    draftSaveStatus: 'Đã lưu bản nháp. Website public chưa thay đổi cho đến khi công khai nội dung.',
    dirty: false,
    validation,
    baselineJson: cloneJson(exportJson),
    draftJson: cloneJson(exportJson),
    draftPersistenceError: null,
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
    setStaticCmsDraftPersistenceState({ isLoadingDrafts: false, draftPersistenceError: 'Bản nháp đã lưu không còn đạt validation hiện tại. Không mở để tránh sai source-of-truth.' });
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
  setStaticCmsDraftPersistenceState({ isLoadingDrafts: false, draftSaveStatus: 'Đã đánh dấu hủy bản nháp. Website public chưa thay đổi.' });
  handlers.onRerender?.();
}

function renderExportPanel(draftState = {}, handlers = {}, copy = {}) {
  const exportPanel = createElement('section', { className: 'cms-admin-static-advanced-panel' });
  exportPanel.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Khu nâng cao chỉ phục vụ kiểm tra/nhập/xuất dữ liệu. Website public chỉ đổi khi công khai nội dung qua server-side gate.',
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
    'Có thể dùng nút “Kiểm tra trước khi công khai” và “Công khai nội dung” nếu bản nháp đã lưu server-side và tài khoản là admin.',
    'File dữ liệu nâng cao vẫn dùng được cho quản trị viên kỹ thuật khi cần xử lý thủ công.',
    'Mọi publish đều phải có backup, verify và rollback-on-fail; không DB-first publish.',
  ].forEach((step) => steps.appendChild(createElement('li', { text: step })));
  wrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Khu nâng cao chỉ phục vụ kiểm tra/nhập/xuất dữ liệu. Website public chỉ đổi khi công khai nội dung qua server-side gate.' }));
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

async function handleLoadStaticCmsBaseline(handlers = {}) {
  if (!ADMIN_FEATURE_FLAGS.allowStaticCmsDraftEdit) return;
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
  const candidates = [
    { source: 'remote', url: STATIC_CMS_DRAFT_CONFIG.remoteUrl },
    { source: 'fallback', url: STATIC_CMS_DRAFT_CONFIG.fallbackUrl },
    { source: 'local', url: STATIC_CMS_DRAFT_CONFIG.localGeneratedUrl },
  ].filter((entry) => entry.url);

  const errors = [];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      const canonicalJson = sanitizeStaticCmsExport(json, { keepVersion: true });
      const validation = validateStaticCmsDraft(canonicalJson, STATIC_CMS_DRAFT_CONFIG);
      if (!validation.valid) {
        throw new Error(`CMS baseline không đạt canonical contract (${Object.keys(validation.errors || {}).length} lỗi).`);
      }
      return { ...candidate, json: canonicalJson, validation };
    } catch (error) {
      errors.push(`${candidate.source}: ${normalizeErrorMessage(error)}`);
    }
  }
  throw new Error(`Không load được CMS static baseline. ${errors.join(' | ')}`);
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
      importSuccess: 'Đã nhập JSON vào bản nháp. Website public chưa thay đổi. Hãy bấm “Lưu thành bản nháp mới” trước khi công khai.',
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
