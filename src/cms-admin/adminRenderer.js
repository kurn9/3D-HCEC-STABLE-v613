import { ADMIN_FEATURE_FLAGS, ADMIN_ROLES, getSupabaseConfigStatus } from './adminConfig.js';
import {
  createSupabaseClient,
  onAuthStateChange,
  requireAdminAccess,
  signInWithEmailPassword,
  signOut,
} from './adminAuth.js';
import { fetchDashboardData, updateExperienceIndexSectionDraft, updateGateContentDraft, updateGuideIndexSectionDraft, updateIndexSectionDraft, updateSiteSettingsDraft } from './adminApi.js';
import {
  appendChildren,
  byId,
  clearNode,
  createElement,
  formatCount,
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
  getActiveEditSession,
  getAllActiveEditSessions,
  hasDirtyEditSession,
  resetGateEdit,
  resetHomeEdit,
  resetSiteSettingsEdit,
  resetActiveEditSession,
  resetGateDraftToOriginal,
  resetHomeDraftToOriginal,
  resetSiteSettingsDraftToOriginal,
  setActiveTab,
  setError,
  setLoading,
  setNestedData,
  setGateEditState,
  setHomeEditState,
  setSiteSettingsEditState,
  setState,
  startGateEdit,
  startHomeExperienceEdit,
  startHomeGuideEdit,
  startHomeHeroEdit,
  startSiteSettingsEdit,
  updateGateDraftField,
  updateGateRoomDraftField,
  updateHomeExperienceDraftField,
  updateHomeExperienceItemDraftField,
  updateHomeGuideDraftField,
  updateHomeGuideItemDraftField,
  updateHomeHeroCtaDraftField,
  updateHomeHeroDraftField,
  updateHomeHeroItemDraftField,
  updateHomeHeroMediaDraftField,
  updateSiteSettingsDraftField,
} from './adminState.js';
import {
  ADMIN_COPY,
  getActiveLabel,
  getFriendlyNote,
  getLanguageLabel,
  getPageCopy,
  getRoleLabel,
  getRoomLabel,
  getStatusLabel,
  getVisibleLabel,
} from './adminCopy.js';
import { validateGateContentDraft, validateHomeExperienceSectionDraft, validateHomeGuideSectionDraft, validateIndexSectionDraft, validateSiteSettingsDraft } from './adminValidation.js';
import { buildDbFallbackDashboardSummary } from './adminDashboardSummary.js';
import { renderStaticCmsDraftTab } from './adminStaticCmsDraft.js';
import { renderRollbackHistoryTab } from './adminRollbackGate.js';
import { renderCmsStorageCleanupTab } from './adminCleanupGate.js';

const NAV_GROUPS = ADMIN_COPY.navGroups || [{ key: 'main', items: ADMIN_COPY.nav }];

let root = null;
let unsubscribeAuth = null;
let pendingEditFocusTarget = null;
let pendingEntityHighlight = null;
let beforeUnloadGuardBound = false;



boot();

async function boot() {
  root = byId('cms-admin-root');
  if (!root) return;

  const { client, error, status } = createSupabaseClient();
  setState({ supabase: client });

  if (error || !status.ready) {
    renderLogin({ configWarning: status, bootError: error });
    return;
  }

  unsubscribeAuth = onAuthStateChange(client, async ({ event }) => {
    if (event === 'SIGNED_OUT') {
      setState({ session: null, profile: null });
      renderLogin();
      return;
    }

    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      await hydrateAuthorizedSession(client);
    }
  });

  await hydrateAuthorizedSession(client);
}

async function hydrateAuthorizedSession(client) {
  setLoading(true);
  const access = await requireAdminAccess(client);
  setLoading(false);

  if (!access.allowed) {
    if (access.reason === 'no_session') {
      renderLogin();
      return;
    }

    setState({ session: access.session, profile: access.profile, error: access.error });
    renderAccessDenied(access);
    return;
  }

  setState({ session: access.session, profile: access.profile, error: null });
  await loadDashboardData(client);
  renderAdminShell();
}

async function loadDashboardData(client) {
  setLoading(true);
  setError(null);
  const { data, errors } = await fetchDashboardData(client);
  setNestedData({ ...data, errors });
  setLoading(false);
}

function renderLogin(options = {}) {
  syncBeforeUnloadGuard({});
  clearNode(root);
  const wrap = createElement('main', { className: 'cms-admin-login-wrap' });
  const card = createElement('section', { className: 'cms-admin-card cms-admin-login-card' });

  const brand = renderBrandBlock();
  const copy = createElement('div');
  copy.appendChild(createElement('p', { className: 'cms-admin-eyebrow', text: ADMIN_COPY.app.loginEyebrow }));
  copy.appendChild(createElement('h1', { className: 'cms-admin-title', text: ADMIN_COPY.app.title }));
  copy.appendChild(createElement('p', {
    className: 'cms-admin-subtitle',
    text: ADMIN_COPY.app.subtitle,
  }));

  const configStatus = options.configWarning || getSupabaseConfigStatus();
  const warnings = [];
  if (!configStatus.ready) {
    warnings.push(renderConfigWarning(configStatus));
  }
  if (options.bootError && configStatus.ready) {
    warnings.push(renderErrorBox(options.bootError, 'Không thể khởi tạo kết nối dữ liệu'));
  }

  const form = createElement('form', { className: 'cms-admin-form', attrs: { novalidate: 'true' } });
  const emailField = renderInputField('email', ADMIN_COPY.login.fields.email, 'email', ADMIN_COPY.login.placeholders.email);
  const passwordField = renderInputField('password', ADMIN_COPY.login.fields.password, 'password', ADMIN_COPY.login.placeholders.password);
  const errorBox = createElement('div', { className: 'cms-admin-hidden', attrs: { role: 'alert' } });

  const submit = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    text: ADMIN_COPY.login.submit,
    type: 'submit',
  });
  submit.disabled = !configStatus.ready;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearLoginError(errorBox);
    submit.disabled = true;
    submit.textContent = ADMIN_COPY.login.submitting;

    const client = getState().supabase;
    const email = form.elements.email?.value;
    const password = form.elements.password?.value;
    const { error } = await signInWithEmailPassword(client, email, password);

    if (error) {
      showLoginError(errorBox, error);
      submit.disabled = false;
      submit.textContent = ADMIN_COPY.login.submit;
      return;
    }

    await hydrateAuthorizedSession(client);
  });

  appendChildren(form, [emailField, passwordField, errorBox, createElement('div', { className: 'cms-admin-actions' })]);
  form.querySelector('.cms-admin-actions')?.appendChild(submit);

  appendChildren(card, [brand, copy, ...warnings, form]);
  wrap.appendChild(card);
  root.appendChild(wrap);
}

function renderAccessDenied(access) {
  clearNode(root);
  const wrap = createElement('main', { className: 'cms-admin-denied-wrap' });
  const card = createElement('section', { className: 'cms-admin-card cms-admin-denied-card' });
  const profile = access.profile;

  appendChildren(card, [
    renderBrandBlock(),
    createElement('p', { className: 'cms-admin-eyebrow', text: 'Không có quyền truy cập' }),
    createElement('h1', { className: 'cms-admin-title', text: ADMIN_COPY.notices.accessDeniedTitle }),
    createElement('p', {
      className: 'cms-admin-help-text',
      text: profile
        ? `Vai trò hiện tại: ${getRoleLabel(profile.role)}, trạng thái: ${getActiveLabel(Boolean(profile.is_active))}.`
        : ADMIN_COPY.notices.accessDeniedFallback,
    }),
    access.error ? renderErrorBox(access.error, 'Chi tiết') : null,
  ]);

  const actions = createElement('div', { className: 'cms-admin-actions' });
  const logoutButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    text: 'Đăng xuất',
    type: 'button',
  });
  logoutButton.addEventListener('click', async () => handleLogout());
  actions.appendChild(logoutButton);
  card.appendChild(actions);

  wrap.appendChild(card);
  root.appendChild(wrap);
}

function renderAdminShell() {
  clearNode(root);
  const state = getState();
  syncBeforeUnloadGuard(state);
  const shell = createElement('div', { className: 'cms-admin-shell' });
  shell.appendChild(renderSidebar(state));

  const main = createElement('main', { className: 'cms-admin-main' });
  main.appendChild(renderTopbar(state));
  main.appendChild(renderMobileSafeModeNotice());
  try {
    main.appendChild(renderActiveTab(state));
  } catch (error) {
    console.error('[cms-admin] failed to render active tab', error);
    main.appendChild(renderRuntimeFallbackPanel(error));
  }
  shell.appendChild(main);
  root.appendChild(shell);
  focusPendingEditTarget();
}

function renderRuntimeFallbackPanel(error) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-runtime-error-panel' });
  panel.appendChild(renderPanelTitle('Không render được màn này', 'Kiểm tra Console'));
  panel.appendChild(renderErrorBox(normalizeErrorMessage(error)));
  panel.appendChild(renderCompactNotice('Dữ liệu chưa bị thay đổi. Hãy mở DevTools Console để xem lỗi kỹ thuật đầu tiên.'));
  return panel;
}

function queueEditPanelFocus(type, id, fieldName = '') {
  if (!type) return;
  pendingEditFocusTarget = {
    type,
    id: id === undefined || id === null ? '' : String(id),
    fieldName: fieldName || '',
  };
}

function queueEntityHighlight(type, id) {
  if (!type || id === undefined || id === null) return;
  pendingEntityHighlight = { type, id: String(id) };
}

function matchesPendingHighlight(type, id) {
  return Boolean(pendingEntityHighlight && pendingEntityHighlight.type === type && pendingEntityHighlight.id === String(id));
}

function focusPendingEditTarget() {
  const target = pendingEditFocusTarget;
  if (!target || !root) return;
  pendingEditFocusTarget = null;
  requestAnimationFrame(() => {
    const panel = findCmsTarget('data-cms-edit-panel', target.type, target.id);
    const row = findCmsTarget('data-cms-edit-row', target.type, target.id);
    const targetNode = panel || row;
    if (!targetNode) return;
    targetNode.classList.add('is-scroll-focus');
    const reducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    targetNode.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    const field = panel?.querySelector(target.fieldName ? `[name="${target.fieldName}"]` : 'input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), select:not([disabled])')
      || panel?.querySelector('input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), select:not([disabled])');
    if (field && typeof field.focus === 'function') {
      field.focus({ preventScroll: true });
      if (typeof field.select === 'function' && field.tagName !== 'SELECT') field.select();
    }
  });
}

function findCmsTarget(attributeName, type, id) {
  const selector = `[${attributeName}="${type}"]`;
  return Array.from(root.querySelectorAll(selector)).find((node) => String(node.dataset.cmsEditId || '') === String(id || '')) || null;
}


function isMobileSafeModeViewport() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 767px)').matches;
}

function renderMobileSafeModeNotice() {
  return createElement('div', {
    className: 'cms-admin-mobile-safe-mode-notice',
    text: ADMIN_COPY.globalEdit?.mobileSafeMode || 'Thiết bị này đang ở chế độ xem an toàn. Hãy dùng tablet hoặc máy tính để chỉnh sửa nội dung.',
    attrs: { role: 'note' },
  });
}

function getGlobalLeaveMessage() {
  return ADMIN_COPY.globalEdit?.leaveConfirm || 'Bạn có thay đổi chưa lưu. Rời màn này sẽ mất thay đổi. Tiếp tục?';
}

function getSavingBlockedMessage() {
  return ADMIN_COPY.globalEdit?.savingBlocked || 'Đang lưu bản nháp, vui lòng chờ hoàn tất.';
}

function isSameEditSession(current, target = {}) {
  if (!current || !target?.type) return false;
  if (current.type !== target.type) return false;
  if (target.id === undefined || target.id === null) return true;
  return String(current.id || '') === String(target.id || '');
}

function requestLeaveEditSession(reason = 'navigate') {
  const sessions = getAllActiveEditSessions(getState());
  if (!sessions.length) return true;
  if (sessions.some((session) => session.saving)) {
    window.alert(getSavingBlockedMessage());
    return false;
  }
  if (sessions.some((session) => session.dirty)) {
    const shouldLeave = window.confirm(getGlobalLeaveMessage());
    if (!shouldLeave) return false;
  }
  resetActiveEditSession();
  syncBeforeUnloadGuard(getState());
  return true;
}

function requestStartEditSession(target = {}) {
  const sessions = getAllActiveEditSessions(getState());
  if (!sessions.length) return { allowed: true, same: false };
  if (sessions.length === 1 && isSameEditSession(sessions[0], target)) return { allowed: true, same: true };
  if (sessions.some((session) => session.saving)) {
    window.alert(getSavingBlockedMessage());
    return { allowed: false, same: false };
  }
  if (sessions.some((session) => session.dirty)) {
    const shouldLeave = window.confirm(getGlobalLeaveMessage());
    if (!shouldLeave) return { allowed: false, same: false };
  }
  resetActiveEditSession();
  syncBeforeUnloadGuard(getState());
  return { allowed: true, same: false };
}

function syncBeforeUnloadGuard(currentState = getState()) {
  const shouldBind = hasDirtyEditSession(currentState);
  if (shouldBind && !beforeUnloadGuardBound) {
    window.addEventListener('beforeunload', handleDirtyBeforeUnload);
    beforeUnloadGuardBound = true;
  }
  if (!shouldBind && beforeUnloadGuardBound) {
    window.removeEventListener('beforeunload', handleDirtyBeforeUnload);
    beforeUnloadGuardBound = false;
  }
}

function handleDirtyBeforeUnload(event) {
  if (!hasDirtyEditSession(getState())) return undefined;
  event.preventDefault();
  event.returnValue = '';
  return '';
}

function renderCleanEditNotice(editState = {}, copy = {}) {
  const shouldHide = Boolean(editState.saving) || Boolean(editState.dirty) || Boolean(editState.saveError);
  return createElement('p', {
    className: `cms-admin-clean-edit-notice${shouldHide ? ' cms-admin-hidden' : ''}`,
    text: copy.cleanEditing || ADMIN_COPY.globalEdit?.cleanEditing || 'Đang chỉnh sửa — chưa có thay đổi.',
    attrs: { role: 'status' },
  });
}

function renderSaveDisabledReason(editState = {}, copy = {}) {
  const shouldHide = Boolean(editState.saving) || Boolean(editState.dirty);
  return createElement('p', {
    className: `cms-admin-save-disabled-reason${shouldHide ? ' cms-admin-hidden' : ''}`,
    text: copy.noChanges || ADMIN_COPY.globalEdit?.noChanges || 'Chưa có thay đổi để lưu.',
    attrs: { role: 'note' },
  });
}

function updateSaveDisabledReason(form, editState = {}) {
  const cleanNotice = form?.querySelector?.('.cms-admin-clean-edit-notice');
  if (cleanNotice) {
    cleanNotice.classList.toggle('cms-admin-hidden', Boolean(editState.saving) || Boolean(editState.dirty) || Boolean(editState.saveError));
  }
  const reason = form?.querySelector?.('.cms-admin-save-disabled-reason');
  if (reason) {
    reason.classList.toggle('cms-admin-hidden', Boolean(editState.saving) || Boolean(editState.dirty));
  }
  const resetButton = form?.querySelector?.('[data-cms-reset-draft="true"]');
  if (resetButton) {
    resetButton.disabled = Boolean(editState.saving) || !Boolean(editState.dirty);
  }
}

function renderEditActionBlock(editState = {}, copy = {}, handlers = {}) {
  const block = createElement('div', { className: 'cms-admin-edit-action-block' });
  const actions = createElement('div', { className: 'cms-admin-edit-action-row' });
  const cancelButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost',
    text: copy.cancel || ADMIN_COPY.globalEdit?.cancel || 'Hủy',
    type: 'button',
  });
  cancelButton.addEventListener('click', () => handlers.onCancel?.());

  const resetButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary cms-admin-reset-draft-button',
    text: copy.reset || ADMIN_COPY.globalEdit?.reset || 'Đặt lại thay đổi',
    type: 'button',
    attrs: { 'data-cms-reset-draft': 'true' },
  });
  resetButton.disabled = Boolean(editState.saving) || !Boolean(editState.dirty);
  resetButton.addEventListener('click', () => handlers.onReset?.());

  const saveButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    text: editState.saving ? (copy.saving || 'Đang lưu...') : (copy.save || 'Lưu bản nháp'),
    type: 'submit',
  });
  saveButton.disabled = Boolean(editState.saving) || !Boolean(editState.dirty);

  appendChildren(actions, [cancelButton, resetButton, saveButton]);
  block.appendChild(actions);
  block.appendChild(renderCleanEditNotice(editState, copy));
  block.appendChild(renderSaveDisabledReason(editState, copy));
  return block;
}

function getResetConfirmMessage() {
  return ADMIN_COPY.globalEdit?.resetConfirm || 'Đặt lại các thay đổi chưa lưu trong form này?';
}

function getFocusTargetForActiveSession(session = getActiveEditSession(getState())) {
  const currentState = getState();
  if (!session) return null;
  switch (session.type) {
    case 'site-settings':
      return { type: 'site-settings', id: 'site-settings', fieldName: 'site_title' };
    case 'gate':
      return { type: 'gate', id: currentState.data.gateContent?.id || 'gate', fieldName: 'eyebrow' };
    case 'home': {
      const sectionKey = currentState.homeEdit?.editingSectionKey || 'home';
      const panelType = sectionKey === 'hero' ? 'home-hero' : sectionKey === 'guide' ? 'home-guide' : sectionKey === 'experience' ? 'home-experience' : 'home';
      return { type: panelType, id: currentState.homeEdit?.editingSectionId || sectionKey, fieldName: 'title' };
    }
    default:
      return null;
  }
}

function handleResetActiveDraft(expectedType) {
  const session = getActiveEditSession(getState());
  if (!session || (expectedType && session.type !== expectedType)) return;
  if (session.saving) {
    window.alert(getSavingBlockedMessage());
    return;
  }
  if (!session.dirty) return;
  if (!window.confirm(getResetConfirmMessage())) return;
  const focusTarget = getFocusTargetForActiveSession(session);
  switch (session.type) {
    case 'site-settings':
      resetSiteSettingsDraftToOriginal();
      break;
    case 'gate':
      resetGateDraftToOriginal();
      break;
    case 'home':
      resetHomeDraftToOriginal();
      break;
    default:
      return;
  }
  syncBeforeUnloadGuard(getState());
  if (focusTarget) queueEditPanelFocus(focusTarget.type, focusTarget.id, focusTarget.fieldName);
  renderAdminShell();
}


function renderSidebar(state) {
  const sidebar = createElement('aside', { className: 'cms-admin-sidebar' });
  const brand = createElement('div', { className: 'cms-admin-brand' });
  const mark = createElement('div', { className: 'cms-admin-logo-mark', text: ADMIN_COPY.app.logoMark });
  const text = createElement('div');
  text.appendChild(createElement('h1', { className: 'cms-admin-sidebar-title', text: ADMIN_COPY.app.title }));
  text.appendChild(createElement('p', { className: 'cms-admin-sidebar-subtitle', text: ADMIN_COPY.app.shortSubtitle }));
  appendChildren(brand, [mark, text]);

  const nav = createElement('nav', { className: 'cms-admin-nav cms-admin-nav-grouped', attrs: { 'aria-label': 'Điều hướng quản trị nội dung' } });
  NAV_GROUPS.forEach((group) => {
    const groupWrap = createElement('div', { className: 'cms-admin-nav-group' });
    if (group.label) {
      groupWrap.appendChild(createElement('p', { className: 'cms-admin-nav-group-label', text: group.label }));
    }
    safeArray(group.items).forEach((item) => {
      const button = createElement('button', {
        className: `cms-admin-nav-button${state.activeTab === item.key ? ' is-active' : ''}`,
        text: item.label,
        type: 'button',
        dataset: { tab: item.key },
      });
      button.addEventListener('click', () => switchAdminTab(item.key));
      groupWrap.appendChild(button);
    });
    nav.appendChild(groupWrap);
  });

  const footer = createElement('div', { className: 'cms-admin-sidebar-footer' });
  footer.appendChild(renderProfileCard(state.profile));
  const logout = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost cms-admin-logout-button',
    text: 'Đăng xuất',
    type: 'button',
  });
  logout.addEventListener('click', async () => handleLogout());
  footer.appendChild(logout);

  appendChildren(sidebar, [brand, nav, footer]);
  return sidebar;
}

const EDITOR_CMS_HANDOFF_KEYS = Object.freeze({
  launched: 'hcecEditorLaunchFromCms',
  launchedAt: 'hcecEditorLaunchAt',
  nonce: 'hcecEditorLaunchNonce'
});

function createEditorLaunchNonce() {
  try {
    return crypto.randomUUID();
  } catch (_error) {
    const bytes = new Uint32Array(4);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(8, '0')).join('');
  }
}

function openEditorFromCms(roomKey = 'indoor') {
  const room = roomKey === 'outdoor' ? 'outdoor' : 'indoor';
  if (!requestLeaveEditSession('open-editor')) return;
  try {
    sessionStorage.setItem(EDITOR_CMS_HANDOFF_KEYS.launched, '1');
    sessionStorage.setItem(EDITOR_CMS_HANDOFF_KEYS.launchedAt, String(Date.now()));
    sessionStorage.setItem(EDITOR_CMS_HANDOFF_KEYS.nonce, createEditorLaunchNonce());
  } catch (error) {
    console.error('[CmsEditorHandoff] sessionStorage unavailable', error);
    window.alert('Không thể tạo phiên mở Editor trong trình duyệt này. Hãy cho phép sessionStorage rồi thử lại.');
    return;
  }
  window.location.assign(`./editor.html?room=${room}&from=cms`);
}

function renderEditorLauncher() {
  const launcher = createElement('div', { className: 'cms-admin-editor-launcher' });
  const roomSelect = createElement('select', {
    className: 'cms-admin-select cms-admin-editor-room-select',
    ariaLabel: 'Chọn phòng cần mở trong trình chỉnh sửa',
    attrs: { id: 'cms-admin-editor-room-select', name: 'editorRoom' },
  });
  roomSelect.appendChild(createElement('option', { text: 'Trong nhà', value: 'indoor' }));
  roomSelect.appendChild(createElement('option', { text: 'Ngoài trời', value: 'outdoor' }));

  const launchButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary cms-admin-editor-launch-button',
    text: 'Mở trình chỉnh sửa',
    type: 'button',
    attrs: { title: 'Mở Editor cho phòng đã chọn' },
  });
  launchButton.addEventListener('click', () => openEditorFromCms(roomSelect.value));
  appendChildren(launcher, [roomSelect, launchButton]);
  return launcher;
}

function renderTopbar(state) {
  const page = getPageCopy(state.activeTab);
  const topbar = createElement('header', { className: 'cms-admin-topbar' });
  const left = createElement('div', { className: 'cms-admin-topbar-copy' });
  left.appendChild(createElement('p', { className: 'cms-admin-eyebrow', text: ADMIN_COPY.app.eyebrow }));
  left.appendChild(createElement('h2', { className: 'cms-admin-page-title', text: page.title }));
  left.appendChild(createElement('p', {
    className: 'cms-admin-page-lead',
    text: page.subtitle,
  }));

  const right = createElement('div', { className: 'cms-admin-status-row' });
  right.appendChild(renderEditorLauncher());
  right.appendChild(renderHelpBadge(ADMIN_COPY.badges.viewMode, 'warning', 'viewMode'));
  right.appendChild(renderBadge(getRoleLabel(state.profile?.role), state.profile?.role === 'admin' ? 'success' : 'default'));
  right.appendChild(renderHelpBadge(ADMIN_FEATURE_FLAGS.allowWrites ? ADMIN_COPY.badges.editingEnabled : ADMIN_COPY.badges.lockedEditing, ADMIN_FEATURE_FLAGS.allowWrites ? 'danger' : 'success', 'lockedEditing'));

  appendChildren(topbar, [left, right]);
  return topbar;
}


function renderHelpBadge(label, variant, helpKey) {
  const button = createElement('button', {
    className: ['cms-admin-badge', getBadgeVariantClass(variant), 'cms-admin-help-trigger'].filter(Boolean).join(' '),
    text: label,
    type: 'button',
    attrs: {
      'aria-haspopup': 'dialog',
      'aria-label': `${label}: xem giải thích`,
    },
  });
  button.addEventListener('click', () => openHelpDialog(helpKey, button));
  return button;
}

function getBadgeVariantClass(variant) {
  if (variant === 'success') return 'cms-admin-badge-success';
  if (variant === 'warning') return 'cms-admin-badge-warning';
  if (variant === 'danger') return 'cms-admin-badge-danger';
  return '';
}

function openHelpDialog(helpKey, triggerNode) {
  const copy = ADMIN_COPY.help?.[helpKey];
  if (!copy) return;
  closeHelpDialog();

  const titleId = `cms-admin-help-title-${helpKey}`;
  const backdrop = createElement('div', { className: 'cms-admin-help-backdrop' });
  const dialog = createElement('section', {
    className: 'cms-admin-help-dialog',
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      tabindex: '-1',
    },
  });

  dialog.appendChild(createElement('h3', {
    className: 'cms-admin-help-title',
    text: copy.title,
    attrs: { id: titleId },
  }));

  const content = createElement('div', { className: 'cms-admin-help-content' });
  safeArray(copy.paragraphs).forEach((paragraph) => {
    content.appendChild(createElement('p', { text: paragraph }));
  });
  if (copy.listTitle) {
    content.appendChild(createElement('p', { className: 'cms-admin-help-list-title', text: copy.listTitle }));
  }
  if (safeArray(copy.bullets).length) {
    const list = createElement('ul');
    safeArray(copy.bullets).forEach((item) => list.appendChild(createElement('li', { text: item })));
    content.appendChild(list);
  }
  if (copy.footer) {
    content.appendChild(createElement('p', { className: 'cms-admin-help-safe-line', text: copy.footer }));
  }
  dialog.appendChild(content);

  const actions = createElement('div', { className: 'cms-admin-help-actions' });
  const closeButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    text: copy.button || 'Đã hiểu',
    type: 'button',
  });
  closeButton.addEventListener('click', () => closeHelpDialog(triggerNode));
  actions.appendChild(closeButton);
  dialog.appendChild(actions);
  backdrop.appendChild(dialog);

  const onBackdropClick = (event) => {
    if (event.target === backdrop) closeHelpDialog(triggerNode);
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') closeHelpDialog(triggerNode);
  };
  backdrop.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onKeydown);
  backdrop._cmsAdminCleanup = () => {
    backdrop.removeEventListener('click', onBackdropClick);
    document.removeEventListener('keydown', onKeydown);
  };

  document.body.appendChild(backdrop);
  setTimeout(() => closeButton.focus(), 0);
}

function closeHelpDialog(focusTarget) {
  const current = document.querySelector('.cms-admin-help-backdrop');
  if (!current) return;
  if (typeof current._cmsAdminCleanup === 'function') current._cmsAdminCleanup();
  current.remove();
  if (focusTarget && typeof focusTarget.focus === 'function') {
    setTimeout(() => focusTarget.focus(), 0);
  }
}

function renderActiveTab(state) {
  if (state.loading) {
    return renderLoadingPanel();
  }

  switch (state.activeTab) {
    case 'dashboard':
      return renderDashboard(state);
    case 'home':
      return renderHomeTab(state);
    case 'gate':
      return renderGateTab(state);
    case 'media':
      return renderMediaTab(state);
    case 'staticDraft':
      return renderStaticCmsDraftTab(state, { onRerender: renderAdminShell, onOpenHistory: () => switchAdminTab('history') });
    case 'publish':
      return renderPublishTab(state);
    case 'history':
      return renderRollbackHistoryTab(state, { onRerender: renderAdminShell });
    case 'cleanup':
      return renderCmsStorageCleanupTab(state, { onRerender: renderAdminShell });
    case 'settings':
      return renderSettingsTab(state);
    default:
      return renderDashboard(state);
  }
}

function renderDashboard(state) {
  const data = state.data;
  const rooms = safeArray(data.rooms);
  const artworks = safeArray(data.artworks);
  const artworkStats = data.artworkStats || {};
  const bundles = safeArray(data.publishedBundles);
  const mediaAssets = safeArray(data.mediaAssets);
  const errors = data.errors || {};
  const published = getCurrentPublishedBundle(bundles);
  const canonicalSummary = data.canonicalSummary?.valid ? data.canonicalSummary : null;
  const dashboardSummary = canonicalSummary || buildDbFallbackDashboardSummary(data, { sourceLabel: ADMIN_COPY.dashboard.status.fallbackSource });
  const usingCanonicalSummary = Boolean(canonicalSummary);

  const wrap = createElement('section', { className: 'cms-admin-grid cms-admin-dashboard-view cms-admin-operator-dashboard' });

  if (Object.keys(errors).length > 0) {
    wrap.appendChild(renderSystemErrors(errors));
  }

  const top = createElement('div', { className: 'cms-admin-dashboard-top-grid' });
  top.appendChild(renderWebsiteStatusPanel({ published, errors, siteSettings: data.siteSettings, dashboardSummary, canonicalError: data.canonicalError }));
  top.appendChild(renderTaskPanel({
    warningItems: usingCanonicalSummary ? [] : getWarningItems(artworks),
    warningMessages: usingCanonicalSummary ? safeArray(dashboardSummary.warnings) : [],
    warningCount: dashboardSummary.warningCount || 0,
    mediaCount: usingCanonicalSummary ? dashboardSummary.mediaPresentCount : mediaAssets.length,
    warningHint: usingCanonicalSummary
      ? ADMIN_COPY.dashboard.tasks.canonicalWarningHint
      : ADMIN_COPY.dashboard.tasks.fallbackWarningHint,
  }));
  top.appendChild(renderQuickActionsPanel());

  const metrics = renderMetricsPanel({
    rooms: usingCanonicalSummary ? dashboardSummary.roomCount : rooms.length,
    artworks: usingCanonicalSummary ? dashboardSummary.totalRoomItems : (artworkStats.total ?? artworks.length),
    indoor: usingCanonicalSummary ? dashboardSummary.indoorCount : (artworkStats.indoor ?? 0),
    outdoor: usingCanonicalSummary ? dashboardSummary.outdoorCount : (artworkStats.outdoor ?? 0),
    media: usingCanonicalSummary ? dashboardSummary.mediaPresentCount : mediaAssets.length,
    featured: usingCanonicalSummary ? dashboardSummary.featuredVisibleCount : undefined,
  });

  const twoCol = createElement('div', { className: 'cms-admin-two-col cms-admin-dashboard-reference-grid' });
  twoCol.appendChild(renderSiteSettingsPanel(data.siteSettings));
  twoCol.appendChild(renderLatestBundlePanel(published));

  appendChildren(wrap, [top, metrics, twoCol, renderReadOnlyNoticePanel()]);
  return wrap;
}

function renderMediaTab(state) {
  const mediaAssets = safeArray(state.data.mediaAssets).map(normalizeMediaLibraryAsset);
  const mediaError = state.data.errors?.mediaAssets;
  const usageContext = buildMediaUsageContext(state);
  const enrichedAssets = mediaAssets.map((asset) => ({
    ...asset,
    usage: getMediaUsage(asset, usageContext),
  }));
  const summary = summarizeMediaLibrary(enrichedAssets);

  const panel = createElement('section', { className: 'cms-admin-grid cms-admin-media-view cms-admin-media-library-readonly-view' });
  const library = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-media-library-panel' });
  library.appendChild(renderPanelTitle(ADMIN_COPY.media.mainTitle, `${formatCount(enrichedAssets.length)} ${ADMIN_COPY.media.countLabel}`));
  library.appendChild(renderMediaLibraryReadOnlyBanner());

  if (mediaError) {
    library.appendChild(renderErrorBox(mediaError, 'Không đọc được danh sách media upload'));
  }

  if (!enrichedAssets.length) {
    library.appendChild(renderMediaLibraryEmptyState());
  } else {
    library.appendChild(renderMediaLibrarySummary(summary));
    library.appendChild(renderMediaLibraryControls(enrichedAssets));
    library.appendChild(renderMediaLibraryGrid(enrichedAssets));
  }

  const safety = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-media-safety-panel' });
  safety.appendChild(renderPanelTitle('Giới hạn an toàn của phase này', ADMIN_COPY.media.readOnlyBadge));
  const safetyList = createElement('ul', { className: 'cms-admin-media-safety-list' });
  [
    ADMIN_COPY.media.safeNotice,
    ADMIN_COPY.media.readOnlyNotice,
    ADMIN_COPY.media.deleteDisabled,
  ].forEach((item) => safetyList.appendChild(createElement('li', { text: item })));
  safety.appendChild(safetyList);

  const technical = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-technical-subtle-panel' });
  technical.appendChild(renderPanelTitle(ADMIN_COPY.media.technicalTitle));
  technical.appendChild(renderTechnicalKeyValueList(ADMIN_COPY.media.technicalRows));

  appendChildren(panel, [library, safety, technical]);
  return panel;
}

function normalizeMediaLibraryAsset(asset = {}) {
  const publicUrl = firstAvailableValue(asset, ['public_url', 'publicUrl', 'url']);
  const storagePath = firstAvailableValue(asset, ['storage_path', 'storagePath', 'path', 'file_name', 'fileName']);
  const fieldName = firstAvailableValue(asset, ['field_name', 'fieldName']);
  const mediaKind = normalizeMediaKind(firstAvailableValue(asset, ['media_kind', 'mediaKind', 'asset_type', 'assetType']), fieldName, firstAvailableValue(asset, ['mime_type', 'mimeType']));
  return {
    ...asset,
    id: firstAvailableValue(asset, ['id']) || storagePath || publicUrl || '',
    publicUrl,
    storageBucket: firstAvailableValue(asset, ['storage_bucket', 'storageBucket']) || 'cms-media',
    storagePath,
    fileName: getMediaFileName(storagePath, publicUrl),
    mediaKind,
    mimeType: firstAvailableValue(asset, ['mime_type', 'mimeType']),
    sizeBytes: Number(firstAvailableValue(asset, ['size_bytes', 'sizeBytes'])) || 0,
    targetType: firstAvailableValue(asset, ['target_type', 'targetType']) || '',
    roomKey: firstAvailableValue(asset, ['room_key', 'roomKey']) || '',
    sectionKey: firstAvailableValue(asset, ['section_key', 'sectionKey']) || '',
    itemId: firstAvailableValue(asset, ['item_id', 'itemId']) || '',
    artworkCode: firstAvailableValue(asset, ['artwork_code', 'artworkCode']) || '',
    fieldName,
    status: firstAvailableValue(asset, ['status']) || '',
    createdAt: firstAvailableValue(asset, ['created_at', 'createdAt']),
  };
}

function firstAvailableValue(object = {}, keys = []) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return '';
}

function normalizeMediaKind(value, fieldName = '', mimeType = '') {
  const raw = String(value || '').toLowerCase();
  const field = String(fieldName || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  if (raw.includes('video') || mime.startsWith('video/') || field.includes('video')) return 'video';
  if (raw.includes('poster') || field.includes('poster')) return 'poster';
  if (raw.includes('image') || mime.startsWith('image/') || field.includes('image')) return 'image';
  return 'unknown';
}

function getMediaFileName(storagePath = '', publicUrl = '') {
  const source = String(storagePath || publicUrl || '').split('?')[0];
  const pieces = source.split('/').filter(Boolean);
  const rawName = pieces[pieces.length - 1] || source || 'media';
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function buildMediaUsageContext(state = {}) {
  return {
    publicText: collectJsonStringValues(state.data?.canonicalCms?.json).join('\n'),
    draftText: collectJsonStringValues(state.staticCmsDraft?.draftJson).join('\n'),
  };
}

function collectJsonStringValues(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectJsonStringValues(entry, out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectJsonStringValues(entry, out));
  }
  return out;
}

function getMediaUsage(asset, context = {}) {
  const needles = [asset.publicUrl, asset.storagePath].map((value) => String(value || '').trim()).filter(Boolean);
  const inPublic = needles.some((value) => context.publicText.includes(value));
  const inDraft = needles.some((value) => context.draftText.includes(value));
  if (inPublic && inDraft) return { key: 'publicAndDraft', label: ADMIN_COPY.media.usageLabels.publicAndDraft, variant: 'success' };
  if (inPublic) return { key: 'public', label: ADMIN_COPY.media.usageLabels.public, variant: 'success' };
  if (inDraft) return { key: 'draft', label: ADMIN_COPY.media.usageLabels.draft, variant: 'warning' };
  return { key: 'uncertain', label: ADMIN_COPY.media.usageLabels.uncertain, variant: 'default' };
}

function summarizeMediaLibrary(assets = []) {
  return safeArray(assets).reduce((acc, asset) => {
    acc.total += 1;
    acc[asset.mediaKind] = (acc[asset.mediaKind] || 0) + 1;
    acc[asset.usage?.key] = (acc[asset.usage?.key] || 0) + 1;
    return acc;
  }, { total: 0, image: 0, poster: 0, video: 0, unknown: 0, public: 0, publicAndDraft: 0, draft: 0, uncertain: 0 });
}

function renderMediaLibraryReadOnlyBanner() {
  const banner = createElement('div', { className: 'cms-admin-media-readonly-banner' });
  appendChildren(banner, [
    renderBadge(ADMIN_COPY.media.readOnlyBadge, 'warning'),
    createElement('span', { text: ADMIN_COPY.media.safeNotice }),
  ]);
  return banner;
}

function renderMediaLibraryEmptyState() {
  const empty = createElement('div', { className: 'cms-admin-media-empty-state' });
  empty.appendChild(createElement('div', { className: 'cms-admin-media-empty-icon is-locked', text: ADMIN_COPY.media.emptyBadge }));
  empty.appendChild(createElement('h3', { text: ADMIN_COPY.media.emptyTitle }));
  empty.appendChild(createElement('p', { text: ADMIN_COPY.media.intro }));
  empty.appendChild(createElement('p', { text: ADMIN_COPY.media.body }));

  const listBlock = createElement('div', { className: 'cms-admin-media-upload-types' });
  listBlock.appendChild(createElement('strong', { text: ADMIN_COPY.media.uploadTypesTitle }));
  const list = createElement('ul');
  ADMIN_COPY.media.uploadTypes.forEach((item) => list.appendChild(createElement('li', { text: item })));
  listBlock.appendChild(list);
  empty.appendChild(listBlock);
  empty.appendChild(renderLockedNotice(ADMIN_COPY.media.readOnlyNotice));
  return empty;
}

function renderMediaLibrarySummary(summary = {}) {
  const grid = createElement('div', { className: 'cms-admin-media-summary-grid' });
  [
    ['Tất cả media', summary.total],
    [ADMIN_COPY.media.kindLabels.image, summary.image],
    [ADMIN_COPY.media.kindLabels.poster, summary.poster],
    [ADMIN_COPY.media.kindLabels.video, summary.video],
    ['Đang dùng trên website', Number(summary.public || 0) + Number(summary.publicAndDraft || 0)],
    ['Bản nháp đang mở', Number(summary.draft || 0) + Number(summary.publicAndDraft || 0)],
    ['Chưa đủ dữ liệu', summary.uncertain],
  ].forEach(([label, value]) => {
    const card = createElement('div', { className: 'cms-admin-media-summary-card' });
    appendChildren(card, [
      createElement('span', { text: label }),
      createElement('strong', { text: formatCount(value) }),
    ]);
    grid.appendChild(card);
  });
  return grid;
}

function renderMediaLibraryControls(assets = []) {
  const controls = createElement('div', { className: 'cms-admin-media-controls' });
  const search = createElement('input', {
    className: 'cms-admin-input cms-admin-media-search',
    type: 'search',
    placeholder: ADMIN_COPY.media.searchPlaceholder,
    attrs: { 'data-media-search': 'true' },
  });

  const kindSelect = renderMediaFilterSelect('kind', ADMIN_COPY.media.filters.allKinds, [
    ['image', ADMIN_COPY.media.kindLabels.image],
    ['poster', ADMIN_COPY.media.kindLabels.poster],
    ['video', ADMIN_COPY.media.kindLabels.video],
    ['unknown', ADMIN_COPY.media.kindLabels.unknown],
  ]);
  const usageSelect = renderMediaFilterSelect('usage', ADMIN_COPY.media.filters.allUsage, [
    ['publicAndDraft', ADMIN_COPY.media.usageLabels.publicAndDraft],
    ['public', ADMIN_COPY.media.usageLabels.public],
    ['draft', ADMIN_COPY.media.usageLabels.draft],
    ['uncertain', ADMIN_COPY.media.usageLabels.uncertain],
  ]);
  const targetOptions = Array.from(new Set(safeArray(assets).map((asset) => asset.targetType || 'unknown')))
    .sort()
    .map((value) => [value, getMediaTargetLabel({ targetType: value })]);
  const targetSelect = renderMediaFilterSelect('target', ADMIN_COPY.media.filters.allTargets, targetOptions);

  const applyFilters = () => applyMediaLibraryFilters(controls.closest('.cms-admin-media-library-panel'));
  [search, kindSelect, usageSelect, targetSelect].forEach((control) => {
    control.addEventListener('input', applyFilters);
    control.addEventListener('change', applyFilters);
  });

  appendChildren(controls, [search, kindSelect, usageSelect, targetSelect]);
  return controls;
}

function renderMediaFilterSelect(filterName, allLabel, options = []) {
  const select = createElement('select', {
    className: 'cms-admin-input cms-admin-media-filter',
    attrs: { 'data-media-filter': filterName },
  });
  select.appendChild(createElement('option', { value: 'all', text: allLabel }));
  safeArray(options).forEach(([value, label]) => {
    select.appendChild(createElement('option', { value, text: label }));
  });
  return select;
}

function renderMediaLibraryGrid(assets = []) {
  const wrap = createElement('div', { className: 'cms-admin-media-grid-wrap' });
  const grid = createElement('div', { className: 'cms-admin-media-grid', attrs: { 'data-media-grid': 'true' } });
  safeArray(assets).forEach((asset) => grid.appendChild(renderMediaLibraryCard(asset)));
  const empty = createElement('div', {
    className: 'cms-admin-media-filter-empty cms-admin-hidden',
    text: ADMIN_COPY.media.emptyFiltered,
    attrs: { 'data-media-filter-empty': 'true' },
  });
  appendChildren(wrap, [grid, empty]);
  return wrap;
}

function renderMediaLibraryCard(asset = {}) {
  const card = createElement('article', {
    className: 'cms-admin-media-card',
    attrs: {
      'data-media-kind': asset.mediaKind,
      'data-media-usage': asset.usage?.key || 'uncertain',
      'data-media-target': asset.targetType || 'unknown',
      'data-media-search-text': buildMediaSearchText(asset),
    },
  });

  card.appendChild(renderMediaPreview(asset));

  const body = createElement('div', { className: 'cms-admin-media-card-body' });
  const titleRow = createElement('div', { className: 'cms-admin-media-card-title-row' });
  appendChildren(titleRow, [
    createElement('h3', { text: asset.fileName || 'media' }),
    renderBadge(getMediaKindLabel(asset.mediaKind), asset.mediaKind === 'video' ? 'warning' : 'default'),
  ]);

  const badges = createElement('div', { className: 'cms-admin-media-card-badges' });
  badges.appendChild(renderBadge(asset.usage?.label || ADMIN_COPY.media.usageLabels.uncertain, asset.usage?.variant || 'default'));
  badges.appendChild(renderBadge(getMediaTargetLabel(asset), 'default'));

  const details = createElement('dl', { className: 'cms-admin-media-detail-list' });
  [
    [ADMIN_COPY.media.fields.uploadTime, formatDateTime(asset.createdAt)],
    [ADMIN_COPY.media.fields.fileSize, formatBytes(asset.sizeBytes)],
    [ADMIN_COPY.media.fields.room, asset.roomKey ? getRoomLabel(asset.roomKey) : '—'],
    [ADMIN_COPY.media.fields.item, asset.itemId || asset.artworkCode || '—'],
    [ADMIN_COPY.media.fields.field, formatMediaFieldName(asset.fieldName)],
    [ADMIN_COPY.media.fields.status, formatMediaUploadStatus(asset.status)],
  ].forEach(([label, value]) => appendMediaDetail(details, label, value));

  const path = createElement('p', { className: 'cms-admin-media-path', text: asset.storagePath || asset.publicUrl || '—' });

  const actions = createElement('div', { className: 'cms-admin-media-actions' });
  if (asset.publicUrl) {
    const copyButton = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost', text: ADMIN_COPY.media.actions.copyUrl, type: 'button' });
    copyButton.addEventListener('click', () => copyMediaUrl(copyButton, asset.publicUrl));
    const openLink = createElement('a', {
      className: 'cms-admin-button cms-admin-button-ghost',
      text: ADMIN_COPY.media.actions.openUrl,
      href: asset.publicUrl,
      attrs: { target: '_blank', rel: 'noopener noreferrer' },
    });
    appendChildren(actions, [copyButton, openLink]);
  } else {
    actions.appendChild(createElement('span', { className: 'cms-admin-help-text', text: 'Media này chưa có đường dẫn public.' }));
  }

  appendChildren(body, [titleRow, badges, details, path, actions]);
  card.appendChild(body);
  return card;
}

function renderMediaPreview(asset = {}) {
  const preview = createElement('div', { className: 'cms-admin-media-preview' });
  if (!asset.publicUrl) {
    preview.appendChild(createElement('span', { text: ADMIN_COPY.media.previewUnavailable }));
    return preview;
  }

  if (asset.mediaKind === 'video') {
    const video = createElement('video', {
      attrs: {
        controls: 'true',
        preload: 'metadata',
        playsinline: 'true',
        src: asset.publicUrl,
      },
    });
    video.addEventListener('error', () => showMediaPreviewError(preview));
    preview.appendChild(video);
    return preview;
  }

  if (asset.mediaKind === 'image' || asset.mediaKind === 'poster') {
    const image = createElement('img', {
      attrs: {
        src: asset.publicUrl,
        alt: asset.fileName || 'CMS media',
        loading: 'lazy',
        decoding: 'async',
      },
    });
    image.addEventListener('error', () => showMediaPreviewError(preview));
    preview.appendChild(image);
    return preview;
  }

  preview.appendChild(createElement('span', { text: ADMIN_COPY.media.previewUnavailable }));
  return preview;
}

function showMediaPreviewError(preview) {
  if (!preview) return;
  clearNode(preview);
  preview.classList.add('has-error');
  preview.appendChild(createElement('span', { text: ADMIN_COPY.media.previewError }));
}

function appendMediaDetail(parent, label, value) {
  parent.appendChild(createElement('dt', { text: label }));
  parent.appendChild(createElement('dd', { text: toDisplayText(value) }));
}

function buildMediaSearchText(asset = {}) {
  return [
    asset.fileName,
    asset.publicUrl,
    asset.storagePath,
    asset.mediaKind,
    asset.targetType,
    asset.roomKey,
    asset.sectionKey,
    asset.itemId,
    asset.artworkCode,
    asset.fieldName,
    asset.status,
    asset.usage?.label,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
}

function applyMediaLibraryFilters(panel) {
  if (!panel) return;
  const searchValue = String(panel.querySelector('[data-media-search]')?.value || '').trim().toLowerCase();
  const kindValue = panel.querySelector('[data-media-filter="kind"]')?.value || 'all';
  const usageValue = panel.querySelector('[data-media-filter="usage"]')?.value || 'all';
  const targetValue = panel.querySelector('[data-media-filter="target"]')?.value || 'all';
  const cards = Array.from(panel.querySelectorAll('.cms-admin-media-card'));
  let visibleCount = 0;

  cards.forEach((card) => {
    const matchesSearch = !searchValue || String(card.getAttribute('data-media-search-text') || '').includes(searchValue);
    const matchesKind = kindValue === 'all' || card.getAttribute('data-media-kind') === kindValue;
    const matchesUsage = usageValue === 'all' || card.getAttribute('data-media-usage') === usageValue;
    const matchesTarget = targetValue === 'all' || card.getAttribute('data-media-target') === targetValue;
    const visible = matchesSearch && matchesKind && matchesUsage && matchesTarget;
    card.classList.toggle('cms-admin-hidden', !visible);
    if (visible) visibleCount += 1;
  });

  const empty = panel.querySelector('[data-media-filter-empty]');
  if (empty) empty.classList.toggle('cms-admin-hidden', visibleCount !== 0);
}

function getMediaKindLabel(kind) {
  return ADMIN_COPY.media.kindLabels?.[kind] || ADMIN_COPY.media.kindLabels.unknown;
}

function getMediaTargetLabel(asset = {}) {
  const targetType = asset.targetType || 'unknown';
  return ADMIN_COPY.media.targetLabels?.[targetType] || ADMIN_COPY.media.targetLabels.unknown;
}

function formatMediaFieldName(fieldName = '') {
  const normalized = String(fieldName || '').trim();
  if (!normalized) return '—';
  const labels = {
    image: 'Ảnh',
    imageUrl: 'Ảnh',
    image_url: 'Ảnh',
    poster: 'Poster',
    posterUrl: 'Poster',
    poster_url: 'Poster',
    videoUrl: 'Video',
    video_url: 'Video',
  };
  return labels[normalized] || normalized;
}

function formatMediaUploadStatus(status = '') {
  const value = String(status || '').trim();
  const labels = {
    draft: 'Trong bản nháp',
    attached: 'Đã gắn vào draft',
    published: 'Đã từng công khai',
    orphaned: 'Có thể chưa dùng',
    deleted: 'Đã đánh dấu xóa',
  };
  return labels[value] || value || '—';
}

function formatBytes(value = 0) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

async function copyMediaUrl(button, url) {
  const originalText = button.textContent;
  button.disabled = true;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const textarea = createElement('textarea', { value: url, attrs: { readonly: 'true' } });
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    button.textContent = ADMIN_COPY.media.actions.copied;
  } catch (error) {
    console.warn('[cms-admin] copy media URL failed', error);
    button.textContent = ADMIN_COPY.media.actions.copyFailed;
  } finally {
    window.setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1400);
  }
}

function renderPublishTab(state) {
  const bundle = getCurrentPublishedBundle(state.data.publishedBundles);
  const panel = createElement('section', { className: 'cms-admin-grid cms-admin-publish-view' });
  const summary = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel' });
  summary.appendChild(renderPanelTitle(ADMIN_COPY.publish.currentTitle, bundle ? getStatusLabel(bundle.status) : 'Chưa có'));
  if (bundle) {
    summary.appendChild(renderKeyValueList([
      [ADMIN_COPY.publish.fields.version, bundle.version],
      [ADMIN_COPY.publish.fields.schema, bundle.schema_version],
      [ADMIN_COPY.publish.fields.status, getStatusLabel(bundle.status)],
      [ADMIN_COPY.publish.fields.publishedAt, formatDateTime(bundle.published_at)],
      [ADMIN_COPY.publish.fields.createdAt, formatDateTime(bundle.created_at)],
      [ADMIN_COPY.publish.fields.note, getFriendlyNote(bundle.note)],
    ]));
  } else {
    summary.appendChild(renderEmptyState(ADMIN_COPY.publish.noCurrent));
  }

  const workflow = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel' });
  workflow.appendChild(renderPanelTitle(ADMIN_COPY.publish.workflowTitle, ADMIN_COPY.publish.workflowStatus));
  workflow.appendChild(renderWorkflowSteps(ADMIN_COPY.publish.workflowSteps));
  workflow.appendChild(renderDisabledActionRow(ADMIN_COPY.publish.actions));
  workflow.appendChild(renderLockedNotice(ADMIN_COPY.publish.lockedNote));
  workflow.appendChild(renderRequirementList(ADMIN_COPY.publish.requirementsTitle, ADMIN_COPY.publish.requirements));
  workflow.appendChild(renderPublicLink(ADMIN_COPY.publish.publicLink, './index.html'));
  workflow.appendChild(renderCompactNotice(ADMIN_COPY.publish.notice));

  appendChildren(panel, [summary, workflow]);
  return panel;
}

function renderHistoryTab(state) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-history-view' });
  panel.appendChild(renderPanelTitle(ADMIN_COPY.history.title, `${formatCount(state.data.publishedBundles.length)} ${ADMIN_COPY.history.countLabel}`));
  panel.appendChild(renderLockedNotice(ADMIN_COPY.history.lockedNotice));
  panel.appendChild(renderBundlesTable(state.data.publishedBundles));
  return panel;
}

function renderSettingsTab(state) {
  const siteSettings = state.data.siteSettings;
  const editState = state.siteSettingsEdit || {};
  const canEdit = canEditSiteSettings(state);
  const wrap = createElement('section', { className: 'cms-admin-grid cms-admin-settings-view cms-admin-settings-grouped-view' });

  if (editState.saveSuccess && !editState.isEditing) {
    wrap.appendChild(renderNoticeBox(editState.saveSuccess, 'success'));
  }

  if (siteSettings && editState.isEditing) {
    wrap.appendChild(renderSiteSettingsEditPanel(state, siteSettings, editState));
  } else {
    wrap.appendChild(renderSiteSettingsBasicPanel(state, siteSettings, canEdit));
  }

  wrap.appendChild(renderSiteSettingsIdentityPanel(siteSettings, editState.isEditing));
  wrap.appendChild(renderSettingsAdminPanel(state));
  return wrap;
}

function renderSiteSettingsBasicPanel(state, siteSettings, canEdit) {
  const basic = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel' });
  basic.appendChild(renderPanelTitle(ADMIN_COPY.settings.basicTitle, siteSettings ? 'Đã đọc dữ liệu' : 'Chưa có dữ liệu'));

  if (!siteSettings) {
    basic.appendChild(renderEmptyState(ADMIN_COPY.settings.siteMissing));
    return basic;
  }

  basic.appendChild(renderKeyValueList([
    [ADMIN_COPY.settings.websiteFields.siteTitle, siteSettings.site_title],
    [ADMIN_COPY.settings.websiteFields.organization, siteSettings.organization_name],
    [ADMIN_COPY.settings.websiteFields.address, siteSettings.address],
    [ADMIN_COPY.settings.websiteFields.phone, siteSettings.phone],
    [ADMIN_COPY.settings.websiteFields.fax, siteSettings.fax],
    [ADMIN_COPY.settings.websiteFields.email, siteSettings.email || '—'],
  ]));
  if (!siteSettings.email) basic.appendChild(renderCompactWarning(ADMIN_COPY.settings.missingEmail));

  const actions = createElement('div', { className: 'cms-admin-settings-edit-actions' });
  if (canEdit) {
    const editButton = createElement('button', {
      className: 'cms-admin-button cms-admin-button-primary',
      text: ADMIN_COPY.settings.edit.button,
      type: 'button',
    });
    editButton.addEventListener('click', () => {
      const guard = requestStartEditSession({ type: 'site-settings', id: 'site-settings' });
      if (!guard.allowed) return;
      if (!guard.same) startSiteSettingsEdit(siteSettings);
      queueEditPanelFocus('site-settings', 'site-settings', 'site_title');
      renderAdminShell();
    });
    actions.appendChild(editButton);
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: ADMIN_COPY.settings.edit.safeNote }));
  } else {
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: ADMIN_COPY.settings.edit.noPermission }));
  }
  basic.appendChild(actions);
  return basic;
}

function renderSiteSettingsIdentityPanel(siteSettings, isEditing = false) {
  const identity = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel' });
  identity.appendChild(renderPanelTitle(ADMIN_COPY.settings.identityTitle));
  if (siteSettings) {
    identity.appendChild(renderKeyValueList([
      [ADMIN_COPY.settings.websiteFields.logoUrl, siteSettings.logo_url],
      [ADMIN_COPY.settings.websiteFields.status, getStatusLabel(siteSettings.site_status)],
      [ADMIN_COPY.settings.websiteFields.language, getLanguageLabel(siteSettings.default_language)],
    ]));
    identity.appendChild(renderCompactNotice(ADMIN_COPY.settings.logoNote));
    identity.appendChild(renderCompactNotice(ADMIN_COPY.settings.cmsStatusNote));
    if (isEditing) {
      identity.appendChild(renderCompactNotice(ADMIN_COPY.settings.edit.logoReadonly));
      identity.appendChild(renderCompactNotice(ADMIN_COPY.settings.edit.statusReadonly));
    }
  } else {
    identity.appendChild(renderEmptyState(ADMIN_COPY.settings.siteMissing));
  }
  return identity;
}

function renderSettingsAdminPanel(state) {
  const admin = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel' });
  admin.appendChild(renderPanelTitle(ADMIN_COPY.settings.adminTitle, ADMIN_COPY.badges.viewMode));
  admin.appendChild(renderKeyValueList([
    [ADMIN_COPY.settings.adminFields.role, getRoleLabel(state.profile?.role)],
    [ADMIN_COPY.settings.adminFields.viewMode, ADMIN_FEATURE_FLAGS.readOnlyMode ? ADMIN_COPY.maps.viewMode.on : ADMIN_COPY.maps.viewMode.off],
    [ADMIN_COPY.settings.adminFields.writeActions, getWriteActionStatusLabel()],
    [ADMIN_COPY.settings.adminFields.connection, Object.keys(state.data.errors || {}).length ? ADMIN_COPY.dashboard.cards.connection.warning : ADMIN_COPY.dashboard.cards.connection.ok],
  ]));
  admin.appendChild(renderCompactNotice(ADMIN_COPY.settings.notice));
  if (ADMIN_FEATURE_FLAGS.allowSiteSettingsEdit) {
    admin.appendChild(renderCompactNotice(`${ADMIN_COPY.settings.edit.enabledScope}. ${ADMIN_COPY.settings.edit.readOnlyScope}`));
  }
  return admin;
}

function renderSiteSettingsEditPanel(state, siteSettings, editState) {
  const copy = ADMIN_COPY.settings.edit;
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-settings-edit-panel cms-admin-edit-panel-highlight', dataset: { cmsEditPanel: 'site-settings', cmsEditId: 'site-settings' } });
  panel.appendChild(renderPanelTitle(copy.title, copy.enabledScope));
  panel.appendChild(renderCompactNotice(copy.safeNote));

  if (editState.saveError) {
    panel.appendChild(renderNoticeBox(`${copy.error} ${normalizeErrorMessage(editState.saveError)}`, 'error'));
  }
  if (editState.saveSuccess) {
    panel.appendChild(renderNoticeBox(editState.saveSuccess, 'success'));
  }

  const form = createElement('form', { className: 'cms-admin-edit-form cms-admin-settings-edit-form', attrs: { novalidate: 'true' } });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    handleSaveSiteSettingsDraft();
  });

  const fields = createElement('div', { className: 'cms-admin-edit-field-grid' });
  fields.appendChild(renderEditableTextField('site_title', copy.fields.site_title, editState, { required: true, placeholder: copy.placeholders.site_title }));
  fields.appendChild(renderEditableTextField('organization_name', copy.fields.organization_name, editState, { required: true, placeholder: copy.placeholders.organization_name }));
  fields.appendChild(renderEditableTextField('address', copy.fields.address, editState, { multiline: true, placeholder: copy.placeholders.address }));
  fields.appendChild(renderEditableTextField('phone', copy.fields.phone, editState, { placeholder: copy.placeholders.phone }));
  fields.appendChild(renderEditableTextField('fax', copy.fields.fax, editState, { placeholder: copy.placeholders.fax }));
  fields.appendChild(renderEditableTextField('email', copy.fields.email, editState, { inputType: 'email', placeholder: copy.placeholders.email }));
  fields.appendChild(renderEditableLanguageField(editState));
  form.appendChild(fields);

  const readonly = createElement('div', { className: 'cms-admin-readonly-field-grid' });
  readonly.appendChild(renderReadonlyField(copy.fields.logo_url, siteSettings.logo_url, copy.logoReadonly));
  readonly.appendChild(renderReadonlyField(copy.fields.site_status, getStatusLabel(siteSettings.site_status), copy.statusReadonly));
  form.appendChild(readonly);

  const dirtyNotice = createElement('p', {
    className: `cms-admin-dirty-notice${editState.dirty ? '' : ' cms-admin-hidden'}`,
    text: copy.dirty,
    attrs: { role: 'status' },
  });
  form.appendChild(dirtyNotice);

  form.appendChild(renderEditActionBlock(editState, copy, {
    onCancel: handleCancelSiteSettingsEdit,
    onReset: () => handleResetActiveDraft('site-settings'),
  }));

  form.addEventListener('input', () => updateSiteSettingsFormControls(form));
  form.addEventListener('change', () => updateSiteSettingsFormControls(form));
  panel.appendChild(form);
  return panel;
}

function renderEditableTextField(fieldName, label, editState, options = {}) {
  const field = createElement('label', { className: 'cms-admin-edit-field' });
  const labelNode = createElement('span', { className: 'cms-admin-edit-label', text: options.required ? `${label} *` : label });
  const value = editState.draftValues?.[fieldName] || '';
  const input = options.multiline
    ? createElement('textarea', {
      className: 'cms-admin-edit-input cms-admin-edit-textarea',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fieldName, rows: '3' },
    })
    : createElement('input', {
      className: 'cms-admin-edit-input',
      type: options.inputType || 'text',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fieldName, autocomplete: 'off' },
    });
  input.addEventListener('input', () => updateSiteSettingsDraftField(fieldName, input.value));
  appendChildren(field, [labelNode, input, renderFieldMessage(fieldName, editState)]);
  return field;
}

function renderEditableLanguageField(editState) {
  const fieldName = 'default_language';
  const copy = ADMIN_COPY.settings.edit;
  const field = createElement('label', { className: 'cms-admin-edit-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: copy.fields.default_language }));
  const select = createElement('select', { className: 'cms-admin-edit-input cms-admin-edit-select', attrs: { name: fieldName } });
  select.appendChild(createElement('option', { text: getLanguageLabel('vi'), value: 'vi' }));
  select.value = editState.draftValues?.default_language || 'vi';
  select.addEventListener('change', () => updateSiteSettingsDraftField(fieldName, select.value));
  appendChildren(field, [select, renderFieldMessage(fieldName, editState)]);
  return field;
}

function renderFieldMessage(fieldName, editState) {
  const message = editState.validationErrors?.[fieldName] || editState.validationWarnings?.[fieldName];
  if (!message) return createElement('span', { className: 'cms-admin-field-message cms-admin-field-message-empty' });
  return createElement('span', {
    className: editState.validationErrors?.[fieldName] ? 'cms-admin-field-message is-error' : 'cms-admin-field-message is-warning',
    text: message,
  });
}

function renderReadonlyField(label, value, note) {
  const field = createElement('div', { className: 'cms-admin-readonly-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: label }));
  field.appendChild(createElement('span', { className: 'cms-admin-readonly-value', text: toDisplayText(value) }));
  if (note) field.appendChild(createElement('span', { className: 'cms-admin-readonly-note', text: note }));
  return field;
}

function updateSiteSettingsFormControls(form) {
  const state = getState();
  syncBeforeUnloadGuard(state);
  const dirty = Boolean(state.siteSettingsEdit?.dirty);
  const notice = form.querySelector('.cms-admin-dirty-notice');
  const saveButton = form.querySelector('button[type="submit"]');
  if (notice) notice.classList.toggle('cms-admin-hidden', !dirty);
  if (saveButton) saveButton.disabled = Boolean(state.siteSettingsEdit?.saving) || !dirty;
  updateSaveDisabledReason(form, state.siteSettingsEdit || {});
}

function canEditSiteSettings(state) {
  const role = state.profile?.role;
  const active = state.profile?.is_active === true;
  const allowedRole = role === ADMIN_ROLES.admin || role === ADMIN_ROLES.editor;
  return Boolean(!isMobileSafeModeViewport() && ADMIN_FEATURE_FLAGS.allowSiteSettingsEdit && state.supabase && allowedRole && active && state.data.siteSettings?.id);
}

function getWriteActionStatusLabel() {
  if (ADMIN_FEATURE_FLAGS.allowWrites) return ADMIN_COPY.maps.writeActions.enabled;
  if (ADMIN_FEATURE_FLAGS.allowSiteSettingsEdit && ADMIN_FEATURE_FLAGS.allowGateContentEdit) return ADMIN_COPY.maps.writeActions.siteSettingsAndGate;
  if (ADMIN_FEATURE_FLAGS.allowSiteSettingsEdit) return ADMIN_COPY.maps.writeActions.siteSettingsOnly;
  return ADMIN_COPY.maps.writeActions.locked;
}

async function handleSaveSiteSettingsDraft() {
  const state = getState();
  const copy = ADMIN_COPY.settings.edit;
  if (!canEditSiteSettings(state)) return;

  const validation = validateSiteSettingsDraft(state.siteSettingsEdit?.draftValues || {}, copy);
  if (!validation.valid) {
    setSiteSettingsEditState({
      validationErrors: validation.errors,
      validationWarnings: validation.warnings,
      saveError: null,
      saveSuccess: null,
    });
    renderAdminShell();
    return;
  }

  setSiteSettingsEditState({
    saving: true,
    saveError: null,
    saveSuccess: null,
    validationErrors: {},
    validationWarnings: validation.warnings,
  });
  renderAdminShell();

  const latestState = getState();
  const { error } = await updateSiteSettingsDraft(
    latestState.supabase,
    latestState.data.siteSettings?.id,
    validation.values,
    latestState.session?.user?.id || null
  );

  if (error) {
    setSiteSettingsEditState({ saving: false, saveError: error, validationWarnings: validation.warnings });
    renderAdminShell();
    return;
  }

  await loadDashboardData(latestState.supabase);
  setSiteSettingsEditState({
    isEditing: false,
    draftValues: {},
    originalValues: {},
    dirty: false,
    saving: false,
    saveError: null,
    saveSuccess: copy.success,
    validationErrors: {},
    validationWarnings: {},
  });
  renderAdminShell();
}

function handleCancelSiteSettingsEdit() {
  const editState = getState().siteSettingsEdit || {};
  if (editState.dirty && !window.confirm(ADMIN_COPY.settings.edit.leaveConfirm)) return;
  resetSiteSettingsEdit();
  renderAdminShell();
}


function renderGateEditPanel(state, gate, editState) {
  const copy = ADMIN_COPY.contentViews.gate.edit;
  const panel = createElement('section', { className: 'cms-admin-data-card cms-admin-gate-edit-panel cms-admin-edit-panel-highlight', dataset: { cmsEditPanel: 'gate', cmsEditId: gate.id || 'gate' } });
  panel.appendChild(renderDataCardTitle(copy.title, copy.enabledScope));
  panel.appendChild(renderCompactNotice(copy.safeNote));
  panel.appendChild(renderCompactNotice(copy.jsonSafeNote));

  if (editState.saveError) {
    panel.appendChild(renderNoticeBox(`${copy.error} ${normalizeErrorMessage(editState.saveError)}`, 'error'));
  }
  if (editState.saveSuccess) {
    panel.appendChild(renderNoticeBox(editState.saveSuccess, 'success'));
  }

  const form = createElement('form', { className: 'cms-admin-edit-form cms-admin-gate-edit-form', attrs: { novalidate: 'true' } });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleSaveGateContentDraft();
  });

  const mainGroup = createElement('section', { className: 'cms-admin-gate-form-section' });
  mainGroup.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: copy.groups.main }));
  const mainFields = createElement('div', { className: 'cms-admin-edit-field-grid' });
  mainFields.appendChild(renderGateEditableTextField('eyebrow', copy.fields.eyebrow, editState, { placeholder: copy.placeholders.eyebrow }));
  mainFields.appendChild(renderGateEditableTextField('title', copy.fields.title, editState, { required: true, placeholder: copy.placeholders.title }));
  mainFields.appendChild(renderGateEditableTextField('description', copy.fields.description, editState, { multiline: true, placeholder: copy.placeholders.description }));
  mainFields.appendChild(renderGateEditableTextField('back_label', copy.fields.back_label, editState, { placeholder: copy.placeholders.back_label }));
  mainGroup.appendChild(mainFields);
  form.appendChild(mainGroup);

  const roomGrid = createElement('div', { className: 'cms-admin-gate-room-edit-grid' });
  roomGrid.appendChild(renderGateRoomEditCard('indoor', copy.groups.indoor, editState));
  roomGrid.appendChild(renderGateRoomEditCard('outdoor', copy.groups.outdoor, editState));
  form.appendChild(roomGrid);

  form.appendChild(renderGateTechnicalReadonlyBlock(gate, copy));

  const dirtyNotice = createElement('p', {
    className: `cms-admin-dirty-notice${editState.dirty ? '' : ' cms-admin-hidden'}`,
    text: copy.dirty,
    attrs: { role: 'status' },
  });
  form.appendChild(dirtyNotice);

  form.appendChild(renderEditActionBlock(editState, copy, {
    onCancel: handleCancelGateEdit,
    onReset: () => handleResetActiveDraft('gate'),
  }));

  form.addEventListener('input', () => updateGateFormControls(form));
  form.addEventListener('change', () => updateGateFormControls(form));
  panel.appendChild(form);
  return panel;
}

function renderGateEditableTextField(fieldName, label, editState, options = {}) {
  const field = createElement('label', { className: 'cms-admin-edit-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: options.required ? `${label} *` : label }));
  const value = editState.draftValues?.[fieldName] || '';
  const input = options.multiline
    ? createElement('textarea', {
      className: 'cms-admin-edit-input cms-admin-edit-textarea',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fieldName, rows: '3' },
    })
    : createElement('input', {
      className: 'cms-admin-edit-input',
      type: 'text',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fieldName, autocomplete: 'off' },
    });
  input.addEventListener('input', () => updateGateDraftField(fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fieldName, editState)]);
  return field;
}

function renderGateRoomEditCard(roomKey, title, editState) {
  const copy = ADMIN_COPY.contentViews.gate.edit;
  const roomDraft = editState.draftValues?.rooms?.[roomKey] || {};
  const card = createElement('section', { className: 'cms-admin-data-card cms-admin-gate-room-edit-card' });
  card.appendChild(renderDataCardTitle(title, roomKey));
  card.appendChild(renderReadonlyField(copy.fields.roomKey, roomKey, copy.jsonSafeNote));
  card.appendChild(renderReadonlyField(copy.fields.route, `gallery.html?room=${roomKey}`, copy.fields.route));

  const fields = createElement('div', { className: 'cms-admin-edit-field-grid' });
  fields.appendChild(renderGateRoomTextField(roomKey, 'displayName', copy.fields.displayName, roomDraft, editState, { required: true, placeholder: copy.placeholders.displayName }));
  fields.appendChild(renderGateRoomTextField(roomKey, 'description', copy.fields.roomDescription, roomDraft, editState, { multiline: true, placeholder: copy.placeholders.roomDescription }));
  if (roomDraft.ctaEditable) {
    fields.appendChild(renderGateRoomTextField(roomKey, 'ctaLabel', copy.fields.ctaLabel, roomDraft, editState, { placeholder: copy.placeholders.ctaLabel }));
  } else {
    fields.appendChild(createElement('p', { className: 'cms-admin-compact-copy cms-admin-gate-cta-note', text: copy.noCtaLabel }));
  }
  card.appendChild(fields);
  return card;
}

function renderGateRoomTextField(roomKey, fieldName, label, roomDraft, editState, options = {}) {
  const fullFieldName = `rooms.${roomKey}.${fieldName}`;
  const field = createElement('label', { className: 'cms-admin-edit-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: options.required ? `${label} *` : label }));
  const value = roomDraft?.[fieldName] || '';
  const input = options.multiline
    ? createElement('textarea', {
      className: 'cms-admin-edit-input cms-admin-edit-textarea',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fullFieldName, rows: '3' },
    })
    : createElement('input', {
      className: 'cms-admin-edit-input',
      type: 'text',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fullFieldName, autocomplete: 'off' },
    });
  input.addEventListener('input', () => updateGateRoomDraftField(roomKey, fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fullFieldName, editState)]);
  return field;
}

function renderGateTechnicalReadonlyBlock(gate, copy) {
  const block = createElement('section', { className: 'cms-admin-readonly-field-grid cms-admin-gate-technical-strip' });
  block.appendChild(renderReadonlyField(copy.fields.active, getActiveLabel(Boolean(gate.is_active)), 'Không chỉnh ở bước này.'));
  block.appendChild(renderReadonlyField('editor_json', gate.editor_json ? 'Đã có dữ liệu kỹ thuật' : '—', copy.editorReadonly));
  block.appendChild(renderReadonlyField(copy.fields.route, 'gallery.html?room=indoor / gallery.html?room=outdoor', copy.jsonSafeNote));
  return block;
}

function updateGateFormControls(form) {
  const state = getState();
  syncBeforeUnloadGuard(state);
  const dirty = Boolean(state.gateEdit?.dirty);
  const notice = form.querySelector('.cms-admin-dirty-notice');
  const saveButton = form.querySelector('button[type="submit"]');
  if (notice) notice.classList.toggle('cms-admin-hidden', !dirty);
  if (saveButton) saveButton.disabled = Boolean(state.gateEdit?.saving) || !dirty;
  updateSaveDisabledReason(form, state.gateEdit || {});
}

function canEditGateContent(state) {
  const role = state.profile?.role;
  const active = state.profile?.is_active === true;
  const allowedRole = role === ADMIN_ROLES.admin || role === ADMIN_ROLES.editor;
  return Boolean(!isMobileSafeModeViewport() && ADMIN_FEATURE_FLAGS.allowGateContentEdit && state.supabase && allowedRole && active && state.data.gateContent?.id);
}

async function handleSaveGateContentDraft() {
  const state = getState();
  const copy = ADMIN_COPY.contentViews.gate.edit;
  if (!canEditGateContent(state)) return;

  const validation = validateGateContentDraft(state.gateEdit?.draftValues || {}, copy);
  if (!validation.valid) {
    setGateEditState({
      validationErrors: validation.errors,
      validationWarnings: validation.warnings,
      saveError: null,
      saveSuccess: null,
    });
    renderAdminShell();
    return;
  }

  setGateEditState({
    saving: true,
    saveError: null,
    saveSuccess: null,
    validationErrors: {},
    validationWarnings: validation.warnings,
  });
  renderAdminShell();

  const latestState = getState();
  const { error } = await updateGateContentDraft(
    latestState.supabase,
    latestState.data.gateContent?.id,
    validation.values,
    latestState.session?.user?.id || null
  );

  if (error) {
    setGateEditState({ saving: false, saveError: error, validationWarnings: validation.warnings });
    renderAdminShell();
    return;
  }

  await loadDashboardData(latestState.supabase);
  setGateEditState({
    isEditing: false,
    draftValues: {},
    originalValues: {},
    dirty: false,
    saving: false,
    saveError: null,
    saveSuccess: copy.success,
    validationErrors: {},
    validationWarnings: {},
  });
  renderAdminShell();
}

function handleCancelGateEdit() {
  const editState = getState().gateEdit || {};
  if (editState.dirty && !window.confirm(ADMIN_COPY.contentViews.gate.edit.leaveConfirm)) return;
  resetGateEdit();
  renderAdminShell();
}

function renderNoticeBox(message, variant = 'info') {
  const className = variant === 'success'
    ? 'cms-admin-alert cms-admin-alert-success'
    : variant === 'error'
      ? 'cms-admin-alert cms-admin-alert-error'
      : 'cms-admin-alert cms-admin-alert-info';
  return createElement('div', { className, text: message, attrs: { role: 'status' } });
}


function renderHomeTab(state) {
  return renderHomeDataView(state);
}

function renderGateTab(state) {
  return renderGateDataView(state);
}

function renderHomeDataView(state) {
  const copy = ADMIN_COPY.contentViews.home;
  const sections = safeArray(state.data.indexSections);
  const editState = state.homeEdit || {};
  const wrap = createElement('section', { className: 'cms-admin-grid cms-admin-readonly-data-view cms-admin-home-data-view' });

  if (editState.saveSuccess && !editState.isEditing) {
    wrap.appendChild(renderNoticeBox(editState.saveSuccess, 'success'));
  }

  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel' });
  panel.appendChild(renderPanelTitle(copy.sourceTitle, sections.length ? `${formatCount(sections.length)} phần nội dung` : 'Chưa có dữ liệu'));
  panel.appendChild(renderSourceStrip('Nguồn dữ liệu', sections.length ? 'CMS index_sections, bản nháp quản trị' : 'Chưa đọc được dữ liệu Trang chủ'));
  panel.appendChild(renderPublicLink(copy.publicLink, './index.html'));

  if (!sections.length) {
    panel.appendChild(renderEmptyState(`${copy.emptyTitle}. ${copy.emptyBody}`));
  } else {
    const grid = createElement('div', { className: 'cms-admin-content-card-grid' });
    sections.forEach((section) => grid.appendChild(renderIndexSectionCard(section, copy, state, editState)));
    panel.appendChild(grid);
    const focusedEditPanel = renderHomeFocusedEditPanel(state, sections, editState);
    if (focusedEditPanel) panel.appendChild(focusedEditPanel);
  }

  panel.appendChild(renderLockedNotice(copy.safety));
  wrap.appendChild(panel);
  return wrap;
}

function renderGateDataView(state) {
  const copy = ADMIN_COPY.contentViews.gate;
  const gate = state.data.gateContent;
  const editState = state.gateEdit || {};
  const canEdit = canEditGateContent(state);
  const wrap = createElement('section', { className: 'cms-admin-grid cms-admin-readonly-data-view cms-admin-gate-data-view' });

  if (editState.saveSuccess && !editState.isEditing) {
    wrap.appendChild(renderNoticeBox(editState.saveSuccess, 'success'));
  }

  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel' });
  panel.appendChild(renderPanelTitle(copy.sourceTitle, gate ? 'Đã đọc dữ liệu' : 'Chưa có dữ liệu'));
  panel.appendChild(renderSourceStrip('Nguồn dữ liệu', gate ? 'CMS gate_content, bản nháp quản trị' : 'Chưa đọc được dữ liệu Cổng vào'));
  panel.appendChild(renderPublicLink(copy.publicLink, './gallery.html'));

  if (!gate) {
    panel.appendChild(renderEmptyState(`${copy.emptyTitle}. ${copy.emptyBody}`));
    panel.appendChild(renderLockedNotice(copy.safety));
    wrap.appendChild(panel);
    return wrap;
  }

  if (editState.isEditing) {
    panel.appendChild(renderGateEditPanel(state, gate, editState));
    wrap.appendChild(panel);
    return wrap;
  }

  const main = createElement('section', { className: 'cms-admin-data-card cms-admin-gate-main-card' });
  main.appendChild(renderDataCardTitle(copy.mainInfo, gate.is_active ? ADMIN_COPY.maps.status.active : ADMIN_COPY.maps.status.inactive));
  main.appendChild(renderKeyValueList([
    [copy.fields.eyebrow, gate.eyebrow],
    [copy.fields.title, gate.title],
    [copy.fields.description, gate.description],
    [copy.fields.backLabel, gate.back_label],
    [copy.fields.active, getActiveLabel(Boolean(gate.is_active))],
    [copy.fields.updatedAt, formatDateTime(gate.updated_at)],
  ]));

  const roomsPanel = createElement('section', { className: 'cms-admin-data-card' });
  roomsPanel.appendChild(renderDataCardTitle(copy.roomsInfo));
  const roomGrid = createElement('div', { className: 'cms-admin-gate-room-grid' });
  const roomEntries = getGateRoomEntries(gate.rooms_json);
  if (roomEntries.length) {
    roomEntries.forEach(([roomKey, roomData]) => roomGrid.appendChild(renderGateRoomCard(roomKey, roomData, copy)));
    roomsPanel.appendChild(roomGrid);
  } else {
    roomsPanel.appendChild(renderEmptyState('Chưa đọc được dữ liệu lựa chọn không gian trong rooms_json.'));
  }

  const actions = createElement('div', { className: 'cms-admin-settings-edit-actions cms-admin-gate-edit-actions' });
  if (canEdit) {
    const editButton = createElement('button', {
      className: 'cms-admin-button cms-admin-button-primary',
      text: copy.edit.button,
      type: 'button',
    });
    editButton.addEventListener('click', () => {
      const guard = requestStartEditSession({ type: 'gate', id: 'gate' });
      if (!guard.allowed) return;
      if (!guard.same) startGateEdit(gate);
      queueEditPanelFocus('gate', gate.id || 'gate', 'eyebrow');
      renderAdminShell();
    });
    actions.appendChild(editButton);
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: copy.edit.safeNote }));
  } else {
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: copy.edit.noPermission }));
  }

  panel.appendChild(main);
  panel.appendChild(roomsPanel);
  panel.appendChild(actions);
  panel.appendChild(renderLockedNotice(copy.safety));
  wrap.appendChild(panel);
  return wrap;
}

function renderIndexSectionCard(section, copy, state = getState(), editState = {}) {
  const key = section?.section_key || 'section';
  const title = copy.sectionLabels?.[key] || key;
  const isHero = key === 'hero';
  const isGuide = key === 'guide';
  const isExperience = key === 'experience';
  const isContact = key === 'contact';
  const isEditingHero = Boolean(isHero && editState.isEditing && editState.editingSectionId === section?.id);
  const isEditingGuide = Boolean(isGuide && editState.isEditing && editState.editingSectionId === section?.id);
  const isEditingExperience = Boolean(isExperience && editState.isEditing && editState.editingSectionId === section?.id);
  const card = createElement('article', {
    className: `cms-admin-data-card cms-admin-index-section-card${isHero ? ' cms-admin-home-hero-card' : ''}${isGuide ? ' cms-admin-home-guide-card' : ''}${isExperience ? ' cms-admin-home-experience-card' : ''}`,
  });
  card.appendChild(renderDataCardTitle(title, getVisibleLabel(section?.is_visible)));

  if (isEditingHero || isEditingGuide || isEditingExperience) {
    card.classList.add('is-editing');
    card.appendChild(renderCompactNotice(ADMIN_COPY.contentViews.home.focusedEditNote || 'Đang chỉnh ở panel bên dưới.'));
  }

  const mainRows = filterVisibleRows([
    [copy.fields.eyebrow, section?.eyebrow],
    [copy.fields.title, section?.title],
    [copy.fields.subtitle, section?.subtitle],
    [copy.fields.lead, section?.lead],
    [copy.fields.body, section?.body],
  ]);
  if (mainRows.length) {
    card.appendChild(renderDataGroup(copy.presentation.mainContent, renderKeyValueList(mainRows)));
  }

  const ctaNode = renderCtaSummary(section?.cta_json, copy);
  if (ctaNode) card.appendChild(renderDataGroup(copy.presentation.cta, ctaNode));

  const mediaNode = renderMediaSummary(section?.media_json, copy);
  if (mediaNode) card.appendChild(renderDataGroup(copy.presentation.media, mediaNode));

  const itemsNode = renderItemsList(section?.items_json, copy);
  if (itemsNode) card.appendChild(renderDataGroup(copy.presentation.childItems, itemsNode));

  const missingFields = getMissingIndexSectionFields(section, copy);
  if (missingFields.length) {
    card.appendChild(renderMissingFieldsNotice(copy.presentation.missingFields, missingFields));
  }

  if (isContact) {
    card.appendChild(renderHomeContactSourceOfTruthBlock(state, section, copy));
  }

  card.appendChild(renderDataGroup(copy.presentation.statusInfo, renderKeyValueList([
    [copy.fields.status, getVisibleLabel(section?.is_visible)],
    [copy.fields.updatedAt, formatDateTime(section?.updated_at)],
  ])));

  if (isHero && !editState.isEditing) {
    card.appendChild(renderHomeHeroEditActions(state, section));
  }

  if (isGuide && !editState.isEditing) {
    card.appendChild(renderHomeGuideEditActions(state, section));
  }

  if (isExperience && !editState.isEditing) {
    card.appendChild(renderHomeExperienceEditActions(state, section));
  }

  return card;
}


function renderHomeFocusedEditPanel(state, sections = [], editState = {}) {
  if (!editState.isEditing) return null;
  const section = safeArray(sections).find((item) => item.id === editState.editingSectionId || item.section_key === editState.editingSectionKey);
  if (!section) return null;
  const wrap = createElement('div', { className: 'cms-admin-focused-edit-panel cms-admin-home-focused-edit-panel' });
  if (section.section_key === 'hero') {
    wrap.appendChild(renderHomeHeroEditPanel(state, section, editState));
  } else if (section.section_key === 'guide') {
    wrap.appendChild(renderHomeGuideEditPanel(state, section, editState));
  } else if (section.section_key === 'experience') {
    wrap.appendChild(renderHomeExperienceEditPanel(state, section, editState));
  }
  return wrap.childNodes.length ? wrap : null;
}


function renderHomeContactSourceOfTruthBlock(state, section, homeCopy) {
  const copy = homeCopy.contactSource || {};
  const siteSettings = state?.data?.siteSettings || {};
  const block = createElement('section', { className: 'cms-admin-source-of-truth-panel cms-admin-contact-source-panel' });

  block.appendChild(renderDataCardTitle(copy.title || 'Nguồn dữ liệu liên hệ chính thức', copy.readonly || 'Chỉ xem'));
  block.appendChild(renderCompactNotice(copy.notice || 'Thông tin liên hệ chính thức được quản lý tại Thông tin website.'));
  block.appendChild(renderCompactNotice(copy.detail || 'Địa chỉ, điện thoại, fax và email không chỉnh tại section này để tránh lệch dữ liệu.'));

  const fieldCopy = copy.fields || {};
  const missing = copy.missing || 'Chưa khai báo';
  const mirrorRows = [
    [fieldCopy.organization || 'Đơn vị quản lý', siteSettings.organization_name || missing],
    [fieldCopy.address || 'Địa chỉ', siteSettings.address || missing],
    [fieldCopy.phone || 'Điện thoại', siteSettings.phone || missing],
    [fieldCopy.fax || 'Fax', siteSettings.fax || missing],
    [fieldCopy.email || 'Email', siteSettings.email || missing],
  ];
  block.appendChild(renderDataGroup(copy.mirrorTitle || 'Dữ liệu liên hệ đang dùng', renderKeyValueList(mirrorRows)));

  const sectionRows = filterVisibleRows([
    [homeCopy.fields?.eyebrow || 'Nhãn nhỏ', section?.eyebrow],
    [homeCopy.fields?.title || 'Tiêu đề', section?.title],
    [homeCopy.fields?.subtitle || 'Tiêu đề phụ', section?.subtitle],
    [homeCopy.fields?.lead || 'Mô tả ngắn', section?.lead],
    [homeCopy.fields?.body || 'Nội dung mô tả', section?.body],
  ]);
  if (sectionRows.length) {
    block.appendChild(renderDataGroup(copy.sectionDataTitle || 'Nội dung section Contact hiện tại', renderKeyValueList(sectionRows)));
  }

  const actions = createElement('div', { className: 'cms-admin-settings-edit-actions cms-admin-contact-source-actions' });
  const openButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost',
    text: copy.openSettings || 'Mở Thông tin website',
    type: 'button',
  });
  openButton.addEventListener('click', () => switchAdminTab('settings'));
  actions.appendChild(openButton);
  actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: copy.settingsHint || 'Nếu cần cập nhật thông tin liên hệ, hãy chỉnh tại Thông tin website.' }));
  block.appendChild(actions);
  return block;
}

function renderHomeHeroEditActions(state, section) {
  const copy = ADMIN_COPY.contentViews.home.edit;
  const actions = createElement('div', { className: 'cms-admin-settings-edit-actions cms-admin-home-edit-actions' });
  if (canEditHomeHero(state, section)) {
    const editButton = createElement('button', {
      className: 'cms-admin-button cms-admin-button-primary',
      text: copy.button,
      type: 'button',
    });
    editButton.addEventListener('click', () => {
      const editId = section.id || section.section_key || 'hero';
      const guard = requestStartEditSession({ type: 'home', id: editId });
      if (!guard.allowed) return;
      if (!guard.same) startHomeHeroEdit(section);
      queueEditPanelFocus('home-hero', editId, 'eyebrow');
      renderAdminShell();
    });
    actions.appendChild(editButton);
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: copy.safeNote }));
  } else {
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: copy.noPermission }));
  }
  return actions;
}

function renderHomeHeroEditPanel(state, section, editState) {
  const copy = ADMIN_COPY.contentViews.home.edit;
  const panel = createElement('section', { className: 'cms-admin-home-hero-edit-panel cms-admin-edit-panel-highlight', dataset: { cmsEditPanel: 'home-hero', cmsEditId: section.id || section.section_key || 'hero' } });
  panel.appendChild(renderDataCardTitle(copy.title, copy.enabledScope));
  panel.appendChild(renderCompactNotice(copy.safeNote));
  panel.appendChild(renderCompactNotice(copy.jsonSafeNote));

  if (editState.saveError) {
    panel.appendChild(renderNoticeBox(`${copy.error} ${normalizeErrorMessage(editState.saveError)}`, 'error'));
  }
  if (editState.saveSuccess) {
    panel.appendChild(renderNoticeBox(editState.saveSuccess, 'success'));
  }

  const form = createElement('form', { className: 'cms-admin-edit-form cms-admin-home-hero-edit-form', attrs: { novalidate: 'true' } });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleSaveHomeHeroDraft();
  });

  const mainGroup = createElement('section', { className: 'cms-admin-home-form-section' });
  mainGroup.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: copy.groups.main }));
  const mainFields = createElement('div', { className: 'cms-admin-edit-field-grid' });
  mainFields.appendChild(renderHomeHeroEditableTextField('eyebrow', copy.fields.eyebrow, editState, { placeholder: copy.placeholders.eyebrow }));
  mainFields.appendChild(renderHomeHeroEditableTextField('title', copy.fields.title, editState, { required: true, placeholder: copy.placeholders.title }));
  if (sectionHasFieldOrData(section, 'subtitle')) {
    mainFields.appendChild(renderHomeHeroEditableTextField('subtitle', copy.fields.subtitle, editState, { placeholder: copy.placeholders.subtitle }));
  }
  mainFields.appendChild(renderHomeHeroEditableTextField('lead', copy.fields.lead, editState, { multiline: true, placeholder: copy.placeholders.lead }));
  if (sectionHasFieldOrData(section, 'body')) {
    mainFields.appendChild(renderHomeHeroEditableTextField('body', copy.fields.body, editState, { multiline: true, rows: '4', placeholder: copy.placeholders.body }));
  }
  mainGroup.appendChild(mainFields);
  form.appendChild(mainGroup);

  form.appendChild(renderHomeHeroMediaEditGroup(section, editState, copy));
  form.appendChild(renderHomeHeroItemsEditGroup(section, editState, copy));
  const ctaGroup = renderHomeHeroCtaEditGroup(section, editState, copy);
  if (ctaGroup) form.appendChild(ctaGroup);
  form.appendChild(renderHomeHeroTechnicalReadonlyBlock(section, copy));

  const dirtyNotice = createElement('p', {
    className: `cms-admin-dirty-notice${editState.dirty ? '' : ' cms-admin-hidden'}`,
    text: copy.dirty,
    attrs: { role: 'status' },
  });
  form.appendChild(dirtyNotice);

  form.appendChild(renderEditActionBlock(editState, copy, {
    onCancel: handleCancelHomeHeroEdit,
    onReset: () => handleResetActiveDraft('home'),
  }));

  form.addEventListener('input', () => updateHomeHeroFormControls(form));
  form.addEventListener('change', () => updateHomeHeroFormControls(form));
  panel.appendChild(form);
  return panel;
}

function renderHomeHeroEditableTextField(fieldName, label, editState, options = {}) {
  const field = createElement('label', { className: 'cms-admin-edit-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: options.required ? `${label} *` : label }));
  const value = editState.draftValues?.[fieldName] || '';
  const input = options.multiline
    ? createElement('textarea', {
      className: 'cms-admin-edit-input cms-admin-edit-textarea',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fieldName, rows: options.rows || '3' },
    })
    : createElement('input', {
      className: 'cms-admin-edit-input',
      type: 'text',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fieldName, autocomplete: 'off' },
    });
  input.addEventListener('input', () => updateHomeHeroDraftField(fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fieldName, editState)]);
  return field;
}

function renderHomeHeroMediaEditGroup(section, editState, copy) {
  const group = createElement('section', { className: 'cms-admin-home-form-section cms-admin-home-media-edit-group' });
  group.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: copy.groups.media }));
  group.appendChild(renderCompactNotice(copy.mediaReadonlyNote));

  const fields = createElement('div', { className: 'cms-admin-edit-field-grid' });
  fields.appendChild(renderHomeHeroMediaTextField('caption', copy.fields.mediaCaption, editState, { placeholder: copy.placeholders.mediaCaption }));
  group.appendChild(fields);

  const media = normalizePlainObject(section?.media_json);
  const readonlyRows = getMediaReadonlyRows(media, copy);
  if (readonlyRows.length) {
    const readonlyGrid = createElement('div', { className: 'cms-admin-readonly-field-grid cms-admin-home-media-readonly-grid' });
    readonlyRows.forEach(([label, value]) => readonlyGrid.appendChild(renderReadonlyField(label, value, copy.mediaReadonlyNote)));
    group.appendChild(readonlyGrid);
  }
  return group;
}

function renderHomeHeroMediaTextField(fieldName, label, editState, options = {}) {
  const fullFieldName = `media.${fieldName}`;
  const field = createElement('label', { className: 'cms-admin-edit-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: label }));
  const value = editState.draftValues?.media?.[fieldName] || '';
  const input = createElement('input', {
    className: 'cms-admin-edit-input',
    type: 'text',
    value,
    placeholder: options.placeholder || '',
    attrs: { name: fullFieldName, autocomplete: 'off' },
  });
  input.addEventListener('input', () => updateHomeHeroMediaDraftField(fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fullFieldName, editState)]);
  return field;
}

function renderHomeHeroItemsEditGroup(section, editState, copy) {
  const group = createElement('section', { className: 'cms-admin-home-form-section cms-admin-home-items-edit-group' });
  group.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: copy.groups.items }));
  group.appendChild(renderCompactNotice(copy.itemsReadonlyNote));

  const originalItems = normalizeJsonValue(section?.items_json);
  if (!Array.isArray(originalItems)) {
    group.appendChild(renderCompactNotice(copy.unsupportedItems));
    return group;
  }
  if (!originalItems.length) {
    group.appendChild(renderCompactNotice(copy.emptyItems));
    return group;
  }

  const list = createElement('div', { className: 'cms-admin-home-item-edit-list' });
  safeArray(editState.draftValues?.items).forEach((item, index) => {
    list.appendChild(renderHomeHeroItemEditCard(item, index, copy, editState));
  });
  group.appendChild(list);
  return group;
}

function renderHomeHeroItemEditCard(item, index, copy, editState) {
  const card = createElement('section', { className: 'cms-admin-data-card cms-admin-home-item-edit-card' });
  card.appendChild(renderDataCardTitle(`${copy.fields.item} ${index + 1}`));
  const fields = createElement('div', { className: 'cms-admin-edit-field-grid' });
  if (item?.kind === 'string') {
    fields.appendChild(renderHomeHeroItemTextField(index, 'text', copy.fields.itemText, item, editState, { placeholder: copy.placeholders.itemText }));
  } else {
    fields.appendChild(renderHomeHeroItemTextField(index, 'title', copy.fields.itemText, item, editState, { placeholder: copy.placeholders.itemText }));
    fields.appendChild(renderHomeHeroItemTextField(index, 'description', copy.fields.itemDescription, item, editState, { multiline: true, placeholder: copy.placeholders.itemDescription }));
  }
  card.appendChild(fields);
  return card;
}

function renderHomeHeroItemTextField(index, fieldName, label, item, editState, options = {}) {
  const fullFieldName = `items.${index}.${fieldName === 'text' ? 'title' : fieldName}`;
  const field = createElement('label', { className: 'cms-admin-edit-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: label }));
  const value = item?.[fieldName] || '';
  const input = options.multiline
    ? createElement('textarea', {
      className: 'cms-admin-edit-input cms-admin-edit-textarea',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fullFieldName, rows: '3' },
    })
    : createElement('input', {
      className: 'cms-admin-edit-input',
      type: 'text',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fullFieldName, autocomplete: 'off' },
    });
  input.addEventListener('input', () => updateHomeHeroItemDraftField(index, fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fullFieldName, editState)]);
  return field;
}

function renderHomeHeroCtaEditGroup(section, editState, copy) {
  const cta = normalizePlainObject(section?.cta_json);
  const ctaLabelEditable = hasAnyOwnValueKey(cta, ['label', 'text', 'title', 'name']);
  const group = createElement('section', { className: 'cms-admin-home-form-section cms-admin-home-cta-edit-group' });
  group.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: copy.groups.cta }));
  if (!ctaLabelEditable) {
    group.appendChild(renderCompactNotice(copy.noCtaLabel));
    const hrefValue = firstValue(cta, ['href', 'url', 'to', 'link']);
    if (!isBlank(hrefValue)) group.appendChild(renderReadonlyField(copy.fields.ctaPath, hrefValue, copy.ctaReadonlyNote));
    return group;
  }

  const fields = createElement('div', { className: 'cms-admin-edit-field-grid' });
  fields.appendChild(renderHomeHeroCtaTextField('label', copy.fields.ctaLabel, editState, { placeholder: copy.placeholders.ctaLabel }));
  group.appendChild(fields);
  const hrefValue = firstValue(cta, ['href', 'url', 'to', 'link']);
  if (!isBlank(hrefValue)) group.appendChild(renderReadonlyField(copy.fields.ctaPath, hrefValue, copy.ctaReadonlyNote));
  return group;
}

function renderHomeHeroCtaTextField(fieldName, label, editState, options = {}) {
  const fullFieldName = `cta.${fieldName}`;
  const field = createElement('label', { className: 'cms-admin-edit-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: label }));
  const value = editState.draftValues?.cta?.[fieldName] || '';
  const input = createElement('input', {
    className: 'cms-admin-edit-input',
    type: 'text',
    value,
    placeholder: options.placeholder || '',
    attrs: { name: fullFieldName, autocomplete: 'off' },
  });
  input.addEventListener('input', () => updateHomeHeroCtaDraftField(fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fullFieldName, editState)]);
  return field;
}

function renderHomeHeroTechnicalReadonlyBlock(section, copy) {
  const block = createElement('section', { className: 'cms-admin-readonly-field-grid cms-admin-home-technical-strip' });
  block.appendChild(renderReadonlyField(copy.fields.sectionKey, section.section_key, copy.technicalReadonlyNote));
  block.appendChild(renderReadonlyField(copy.fields.sortOrder, section.sort_order, copy.technicalReadonlyNote));
  block.appendChild(renderReadonlyField(copy.fields.visible, getVisibleLabel(section.is_visible), copy.technicalReadonlyNote));
  block.appendChild(renderReadonlyField(copy.fields.updatedAt, formatDateTime(section.updated_at), copy.technicalReadonlyNote));
  return block;
}

function getMediaReadonlyRows(media = {}, copy) {
  const rows = [];
  const pathKeys = ['videoUrl', 'video_url', 'video', 'mp4', 'src', 'url', 'imageUrl', 'image_url', 'image', 'poster', 'posterUrl', 'poster_url', 'thumbnail', 'path'];
  pathKeys.forEach((key) => {
    if (!isBlank(media?.[key])) rows.push([`${copy.fields.mediaPath} (${key})`, media[key]]);
  });
  const typeValue = firstValue(media, ['type', 'kind', 'mimeType', 'mime_type']);
  if (!isBlank(typeValue)) rows.push([copy.fields.mediaType, typeValue]);
  return rows;
}


function renderHomeGuideEditActions(state, section) {
  const copy = ADMIN_COPY.contentViews.home.guideEdit || {};
  const actions = createElement('div', { className: 'cms-admin-settings-edit-actions cms-admin-home-edit-actions' });
  if (canEditHomeGuide(state, section)) {
    const editButton = createElement('button', {
      className: 'cms-admin-button cms-admin-button-primary',
      text: copy.button || 'Chỉnh sửa phần này',
      type: 'button',
    });
    editButton.addEventListener('click', () => {
      const editId = section.id || section.section_key || 'guide';
      const guard = requestStartEditSession({ type: 'home', id: editId });
      if (!guard.allowed) return;
      if (!guard.same) startHomeGuideEdit(section);
      queueEditPanelFocus('home-guide', editId, 'eyebrow');
      renderAdminShell();
    });
    actions.appendChild(editButton);
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: copy.safeNote || 'Chức năng này chỉ lưu bản nháp CMS, không công khai lên website.' }));
  } else {
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: copy.noPermission || 'Tài khoản hiện tại chỉ được xem Trang chủ hoặc chưa bật chỉnh sửa Hướng dẫn tham quan.' }));
  }
  return actions;
}

function renderHomeGuideEditPanel(state, section, editState = {}) {
  const copy = ADMIN_COPY.contentViews.home.guideEdit || {};
  const panel = createElement('section', { className: 'cms-admin-home-hero-edit-panel cms-admin-home-guide-edit-panel cms-admin-edit-panel-highlight', dataset: { cmsEditPanel: 'home-guide', cmsEditId: section.id || section.section_key || 'guide' } });
  panel.appendChild(renderDataCardTitle(copy.title || 'Chỉnh sửa Hướng dẫn tham quan', copy.enabledScope || 'Chỉ bật chỉnh sửa Hướng dẫn tham quan'));
  panel.appendChild(renderCompactNotice(copy.safeNote || 'Chức năng này chỉ lưu bản nháp CMS, không công khai lên website.'));
  panel.appendChild(renderCompactNotice(copy.jsonSafeNote || 'Bạn chỉ sửa chữ hiển thị của Hướng dẫn tham quan. Dữ liệu kỹ thuật được khóa ở bước này.'));
  if (copy.readOnlyScope) panel.appendChild(renderCompactNotice(copy.readOnlyScope));

  if (editState.saveError) {
    panel.appendChild(renderNoticeBox(`${copy.error || 'Không thể lưu, vui lòng kiểm tra lại thông tin.'} ${normalizeErrorMessage(editState.saveError)}`, 'error'));
  }
  if (editState.saveSuccess) {
    panel.appendChild(renderNoticeBox(editState.saveSuccess, 'success'));
  }

  const form = createElement('form', { className: 'cms-admin-edit-form cms-admin-home-guide-edit-form', attrs: { novalidate: 'true' } });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleSaveHomeGuideDraft();
  });

  const mainGroup = createElement('section', { className: 'cms-admin-home-form-section' });
  mainGroup.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: copy.groups?.main || 'Nội dung chính' }));
  const mainFields = createElement('div', { className: 'cms-admin-edit-field-grid' });
  mainFields.appendChild(renderHomeGuideEditableTextField('eyebrow', copy.fields?.eyebrow || 'Nhãn nhỏ', editState, { placeholder: copy.placeholders?.eyebrow || '' }));
  mainFields.appendChild(renderHomeGuideEditableTextField('title', copy.fields?.title || 'Tiêu đề', editState, { required: true, placeholder: copy.placeholders?.title || '' }));
  if (sectionHasFieldOrData(section, 'subtitle')) {
    mainFields.appendChild(renderHomeGuideEditableTextField('subtitle', copy.fields?.subtitle || 'Tiêu đề phụ', editState, { placeholder: copy.placeholders?.subtitle || '' }));
  }
  mainFields.appendChild(renderHomeGuideEditableTextField('lead', copy.fields?.lead || 'Mô tả ngắn', editState, { multiline: true, placeholder: copy.placeholders?.lead || '' }));
  if (sectionHasFieldOrData(section, 'body')) {
    mainFields.appendChild(renderHomeGuideEditableTextField('body', copy.fields?.body || 'Nội dung mô tả', editState, { multiline: true, rows: '4', placeholder: copy.placeholders?.body || '' }));
  }
  mainGroup.appendChild(mainFields);
  form.appendChild(mainGroup);

  form.appendChild(renderHomeGuideItemsEditGroup(section, editState, copy));
  form.appendChild(renderHomeGuideTechnicalReadonlyBlock(section, copy));

  const dirtyNotice = createElement('p', {
    className: `cms-admin-dirty-notice${editState.dirty ? '' : ' cms-admin-hidden'}`,
    text: copy.dirty || 'Có thay đổi chưa lưu.',
    attrs: { role: 'status' },
  });
  form.appendChild(dirtyNotice);

  form.appendChild(renderEditActionBlock(editState, copy, {
    onCancel: handleCancelHomeGuideEdit,
    onReset: () => handleResetActiveDraft('home'),
  }));

  form.addEventListener('input', () => updateHomeGuideFormControls(form));
  form.addEventListener('change', () => updateHomeGuideFormControls(form));
  panel.appendChild(form);
  return panel;
}

function renderHomeGuideEditableTextField(fieldName, label, editState, options = {}) {
  const field = createElement('label', { className: 'cms-admin-edit-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: options.required ? `${label} *` : label }));
  const value = editState.draftValues?.[fieldName] || '';
  const input = options.multiline
    ? createElement('textarea', {
      className: 'cms-admin-edit-input cms-admin-edit-textarea',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fieldName, rows: options.rows || '3' },
    })
    : createElement('input', {
      className: 'cms-admin-edit-input',
      type: 'text',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fieldName, autocomplete: 'off' },
    });
  input.addEventListener('input', () => updateHomeGuideDraftField(fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fieldName, editState)]);
  return field;
}

function renderHomeGuideItemsEditGroup(section, editState, copy) {
  const group = createElement('section', { className: 'cms-admin-home-form-section cms-admin-home-items-edit-group cms-admin-home-guide-items-edit-group' });
  group.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: copy.groups?.items || 'Danh sách bước hướng dẫn' }));
  group.appendChild(renderCompactNotice(copy.itemsReadonlyNote || 'Không thể thêm, xóa hoặc sắp xếp lại bước hướng dẫn ở bước này.'));

  const originalItems = normalizeJsonValue(section?.items_json);
  if (!Array.isArray(originalItems)) {
    group.appendChild(renderCompactNotice(copy.unsupportedItems || 'Cấu trúc bước hướng dẫn chưa hỗ trợ chỉnh sửa ở bước này.'));
    return group;
  }
  if (!originalItems.length) {
    group.appendChild(renderCompactNotice(copy.emptyItems || 'Danh sách bước hướng dẫn đang trống.'));
    return group;
  }

  const list = createElement('div', { className: 'cms-admin-home-item-edit-list' });
  safeArray(editState.draftValues?.items).forEach((item, index) => {
    list.appendChild(renderHomeGuideItemEditCard(item, originalItems[index], index, copy, editState));
  });
  group.appendChild(list);
  return group;
}

function renderHomeGuideItemEditCard(item, originalItem, index, copy, editState) {
  const card = createElement('section', { className: 'cms-admin-data-card cms-admin-home-item-edit-card cms-admin-home-guide-item-edit-card' });
  card.appendChild(renderDataCardTitle(`${copy.fields?.step || 'Bước'} ${index + 1}`));
  const fields = createElement('div', { className: 'cms-admin-edit-field-grid' });
  if (!item || (item.kind !== 'string' && item.kind !== 'object')) {
    card.appendChild(renderCompactNotice(copy.unsupportedItems || 'Cấu trúc bước hướng dẫn chưa hỗ trợ chỉnh sửa ở bước này.'));
    return card;
  }
  if (item.kind === 'string') {
    fields.appendChild(renderHomeGuideItemTextField(index, 'text', copy.fields?.stepText || 'Tên bước', item, editState, { placeholder: copy.placeholders?.stepText || '' }));
  } else {
    fields.appendChild(renderHomeGuideItemTextField(index, 'title', copy.fields?.stepTitle || 'Tên bước', item, editState, { placeholder: copy.placeholders?.stepTitle || '' }));
    fields.appendChild(renderHomeGuideItemTextField(index, 'description', copy.fields?.stepDescription || 'Mô tả bước', item, editState, { multiline: true, placeholder: copy.placeholders?.stepDescription || '' }));
  }
  card.appendChild(fields);

  const readonlyRows = getHomeGuideReadonlyMetaRows(originalItem, copy);
  if (readonlyRows.length) {
    const readonlyGrid = createElement('div', { className: 'cms-admin-readonly-field-grid cms-admin-home-guide-item-readonly-grid' });
    readonlyRows.forEach(([label, value]) => readonlyGrid.appendChild(renderReadonlyField(label, value, copy.technicalReadonlyNote || 'Thông tin kỹ thuật chỉ xem, không chỉnh trong bước này.')));
    card.appendChild(readonlyGrid);
  }
  return card;
}

function renderHomeGuideItemTextField(index, fieldName, label, item, editState, options = {}) {
  const fullFieldName = `items.${index}.${fieldName === 'text' ? 'title' : fieldName}`;
  const field = createElement('label', { className: 'cms-admin-edit-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: label }));
  const value = item?.[fieldName] || '';
  const input = options.multiline
    ? createElement('textarea', {
      className: 'cms-admin-edit-input cms-admin-edit-textarea',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fullFieldName, rows: '3' },
    })
    : createElement('input', {
      className: 'cms-admin-edit-input',
      type: 'text',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fullFieldName, autocomplete: 'off' },
    });
  input.addEventListener('input', () => updateHomeGuideItemDraftField(index, fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fullFieldName, editState)]);
  return field;
}

function renderHomeGuideTechnicalReadonlyBlock(section, copy) {
  const originalItems = normalizeJsonValue(section?.items_json);
  const block = createElement('section', { className: 'cms-admin-readonly-field-grid cms-admin-home-technical-strip cms-admin-home-guide-technical-strip' });
  block.appendChild(renderReadonlyField(copy.fields?.sectionKey || 'Mã section', section?.section_key, copy.technicalReadonlyNote || 'Thông tin kỹ thuật chỉ xem, không chỉnh trong bước này.'));
  block.appendChild(renderReadonlyField(copy.fields?.sortOrder || 'Thứ tự hiển thị', section?.sort_order, copy.technicalReadonlyNote || 'Thông tin kỹ thuật chỉ xem, không chỉnh trong bước này.'));
  block.appendChild(renderReadonlyField(copy.fields?.visible || 'Trạng thái hiển thị', getVisibleLabel(section?.is_visible), copy.technicalReadonlyNote || 'Thông tin kỹ thuật chỉ xem, không chỉnh trong bước này.'));
  block.appendChild(renderReadonlyField(copy.fields?.updatedAt || 'Cập nhật gần nhất', formatDateTime(section?.updated_at), copy.technicalReadonlyNote || 'Thông tin kỹ thuật chỉ xem, không chỉnh trong bước này.'));
  block.appendChild(renderReadonlyField(copy.fields?.itemCount || 'Số lượng bước', Array.isArray(originalItems) ? originalItems.length : 0, copy.itemsReadonlyNote || 'Số lượng và thứ tự bước hướng dẫn chưa chỉnh ở bước này.'));
  return block;
}

function getHomeGuideReadonlyMetaRows(originalItem, copy) {
  if (!originalItem || typeof originalItem !== 'object' || Array.isArray(originalItem)) return [];
  const item = normalizePlainObject(originalItem);
  const rows = [];
  ['number', 'step', 'order', 'key', 'type', 'icon', 'link', 'href', 'url', 'path', 'to', 'route', 'query'].forEach((key) => {
    if (!isBlank(item[key])) rows.push([`${copy.fields?.readonlyMeta || 'Thông tin chỉ xem'} (${key})`, item[key]]);
  });
  return rows;
}

function updateHomeGuideFormControls(form) {
  const state = getState();
  syncBeforeUnloadGuard(state);
  const dirty = Boolean(state.homeEdit?.dirty);
  const notice = form.querySelector('.cms-admin-dirty-notice');
  const saveButton = form.querySelector('button[type="submit"]');
  if (notice) notice.classList.toggle('cms-admin-hidden', !dirty);
  if (saveButton) saveButton.disabled = Boolean(state.homeEdit?.saving) || !dirty;
  updateSaveDisabledReason(form, state.homeEdit || {});
}


function canEditHomeGuide(state, section) {
  const role = state.profile?.role;
  const active = state.profile?.is_active === true;
  const allowedRole = role === ADMIN_ROLES.admin || role === ADMIN_ROLES.editor;
  return Boolean(!isMobileSafeModeViewport() && ADMIN_FEATURE_FLAGS.allowHomeGuideEdit && state.supabase && allowedRole && active && section?.id && section?.section_key === 'guide');
}

async function handleSaveHomeGuideDraft() {
  const state = getState();
  const copy = ADMIN_COPY.contentViews.home.guideEdit;
  const section = safeArray(state.data.indexSections).find((item) => item.id === state.homeEdit?.editingSectionId && item.section_key === 'guide');
  if (!canEditHomeGuide(state, section)) return;

  const validation = validateHomeGuideSectionDraft(state.homeEdit?.draftValues || {}, copy);
  if (!validation.valid) {
    setHomeEditState({
      validationErrors: validation.errors,
      validationWarnings: validation.warnings,
      saveError: null,
      saveSuccess: null,
    });
    renderAdminShell();
    return;
  }

  setHomeEditState({
    saving: true,
    saveError: null,
    saveSuccess: null,
    validationErrors: {},
    validationWarnings: validation.warnings,
  });
  renderAdminShell();

  const latestState = getState();
  const { error } = await updateGuideIndexSectionDraft(
    latestState.supabase,
    latestState.homeEdit?.editingSectionId,
    validation.values,
    latestState.session?.user?.id || null
  );

  if (error) {
    setHomeEditState({ saving: false, saveError: error, validationWarnings: validation.warnings });
    renderAdminShell();
    return;
  }

  await loadDashboardData(latestState.supabase);
  setHomeEditState({
    isEditing: false,
    editingSectionId: null,
    editingSectionKey: null,
    draftValues: {},
    originalValues: {},
    dirty: false,
    saving: false,
    saveError: null,
    saveSuccess: copy.success,
    validationErrors: {},
    validationWarnings: {},
  });
  renderAdminShell();
}

function handleCancelHomeGuideEdit() {
  const editState = getState().homeEdit || {};
  const copy = ADMIN_COPY.contentViews.home.guideEdit;
  if (editState.dirty && !window.confirm(copy.leaveConfirm)) return;
  resetHomeEdit();
  renderAdminShell();
}

function renderHomeExperienceEditActions(state, section) {
  const copy = ADMIN_COPY.contentViews.home.experienceEdit;
  const actions = createElement('div', { className: 'cms-admin-settings-edit-actions cms-admin-home-edit-actions cms-admin-home-experience-edit-actions' });
  if (canEditHomeExperience(state, section)) {
    const editButton = createElement('button', {
      className: 'cms-admin-button cms-admin-button-primary',
      text: copy?.button || 'Chỉnh sửa phần này',
      type: 'button',
    });
    editButton.addEventListener('click', () => {
      const editId = section.id || section.section_key || 'experience';
      const guard = requestStartEditSession({ type: 'home', id: editId });
      if (!guard.allowed) return;
      if (!guard.same) startHomeExperienceEdit(section);
      queueEditPanelFocus('home-experience', editId, 'eyebrow');
      renderAdminShell();
    });
    actions.appendChild(editButton);
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: copy?.safeNote || 'Chức năng này chỉ lưu bản nháp CMS, không công khai lên website.' }));
  } else {
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: copy?.noPermission || 'Tài khoản hiện tại chỉ được xem Trang chủ hoặc chưa bật chỉnh sửa Khu vực trải nghiệm.' }));
  }
  return actions;
}

function renderHomeExperienceEditPanel(state, section, editState = {}) {
  const copy = ADMIN_COPY.contentViews.home.experienceEdit;
  const panel = createElement('section', { className: 'cms-admin-home-hero-edit-panel cms-admin-home-experience-edit-panel cms-admin-edit-panel-highlight', dataset: { cmsEditPanel: 'home-experience', cmsEditId: section.id || section.section_key || 'experience' } });
  panel.appendChild(renderDataCardTitle(copy?.title || 'Chỉnh sửa Khu vực trải nghiệm', copy?.enabledScope || 'Chỉ bật chỉnh sửa Khu vực trải nghiệm'));
  panel.appendChild(renderCompactNotice(copy?.safeNote || 'Chức năng này chỉ lưu bản nháp CMS, không công khai lên website.'));
  panel.appendChild(renderCompactNotice(copy?.jsonSafeNote || 'Bạn chỉ sửa chữ hiển thị. Mã phòng, đường dẫn tham quan và nhãn nút vào phòng được khóa ở bước này.'));

  if (editState.saveError) {
    panel.appendChild(renderNoticeBox(`${copy?.error || 'Không thể lưu, vui lòng kiểm tra lại thông tin.'} ${normalizeErrorMessage(editState.saveError)}`, 'error'));
  }

  const form = createElement('form', { className: 'cms-admin-edit-form cms-admin-home-hero-edit-form cms-admin-home-experience-edit-form', attrs: { novalidate: 'true' } });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleSaveHomeExperienceDraft();
  });

  const mainGroup = createElement('section', { className: 'cms-admin-home-form-section' });
  mainGroup.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: copy?.groups?.main || 'Nội dung chính' }));
  const mainFields = createElement('div', { className: 'cms-admin-edit-field-grid' });
  mainFields.appendChild(renderHomeExperienceEditableTextField('eyebrow', copy?.fields?.eyebrow || 'Nhãn nhỏ', editState, { placeholder: copy?.placeholders?.eyebrow || '' }));
  mainFields.appendChild(renderHomeExperienceEditableTextField('title', copy?.fields?.title || 'Tiêu đề', editState, { required: true, placeholder: copy?.placeholders?.title || '' }));
  if (sectionHasFieldOrData(section, 'subtitle')) {
    mainFields.appendChild(renderHomeExperienceEditableTextField('subtitle', copy?.fields?.subtitle || 'Tiêu đề phụ', editState, { placeholder: copy?.placeholders?.subtitle || '' }));
  }
  mainFields.appendChild(renderHomeExperienceEditableTextField('lead', copy?.fields?.lead || 'Mô tả ngắn', editState, { multiline: true, placeholder: copy?.placeholders?.lead || '' }));
  if (sectionHasFieldOrData(section, 'body')) {
    mainFields.appendChild(renderHomeExperienceEditableTextField('body', copy?.fields?.body || 'Nội dung mô tả', editState, { multiline: true, rows: '4', placeholder: copy?.placeholders?.body || '' }));
  }
  mainGroup.appendChild(mainFields);
  form.appendChild(mainGroup);

  form.appendChild(renderHomeExperienceItemsEditGroup(section, editState, copy || {}));
  form.appendChild(renderHomeExperienceTechnicalReadonlyBlock(section, copy || {}));

  const dirtyNotice = createElement('p', {
    className: `cms-admin-dirty-notice${editState.dirty ? '' : ' cms-admin-hidden'}`,
    text: copy?.dirty || 'Có thay đổi chưa lưu.',
    attrs: { role: 'status' },
  });
  form.appendChild(dirtyNotice);

  form.appendChild(renderEditActionBlock(editState, copy, {
    onCancel: handleCancelHomeExperienceEdit,
    onReset: () => handleResetActiveDraft('home'),
  }));

  form.addEventListener('input', () => updateHomeExperienceFormControls(form));
  form.addEventListener('change', () => updateHomeExperienceFormControls(form));
  panel.appendChild(form);
  return panel;
}

function renderHomeExperienceEditableTextField(fieldName, label, editState, options = {}) {
  const field = createElement('label', { className: 'cms-admin-edit-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: options.required ? `${label} *` : label }));
  const value = editState.draftValues?.[fieldName] || '';
  const input = options.multiline
    ? createElement('textarea', {
      className: 'cms-admin-edit-input cms-admin-edit-textarea',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fieldName, rows: options.rows || '3' },
    })
    : createElement('input', {
      className: 'cms-admin-edit-input',
      type: 'text',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fieldName, autocomplete: 'off' },
    });
  input.addEventListener('input', () => updateHomeExperienceDraftField(fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fieldName, editState)]);
  return field;
}

function renderHomeExperienceItemsEditGroup(section, editState, copy) {
  const group = createElement('section', { className: 'cms-admin-home-form-section cms-admin-home-items-edit-group cms-admin-home-experience-items-edit-group' });
  group.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: copy.groups?.items || 'Danh sách card trải nghiệm' }));
  group.appendChild(renderCompactNotice(copy.itemsReadonlyNote || 'Không thể thêm, xóa hoặc sắp xếp lại card trải nghiệm ở bước này.'));
  group.appendChild(renderCompactNotice(copy.routeReadonlyNote || 'Mã phòng, nhãn nút vào phòng và đường dẫn tham quan chỉ xem ở bước này.'));

  const originalItems = normalizeJsonValue(section?.items_json);
  if (!Array.isArray(originalItems)) {
    group.appendChild(renderCompactNotice(copy.unsupportedItems || 'Cấu trúc card trải nghiệm chưa hỗ trợ chỉnh sửa ở bước này.'));
    return group;
  }
  if (!originalItems.length) {
    group.appendChild(renderCompactNotice(copy.emptyItems || 'Danh sách card trải nghiệm đang trống.'));
    return group;
  }

  const list = createElement('div', { className: 'cms-admin-home-item-edit-list' });
  safeArray(editState.draftValues?.items).forEach((item, index) => {
    list.appendChild(renderHomeExperienceItemEditCard(item, originalItems[index], index, copy, editState));
  });
  group.appendChild(list);
  return group;
}

function renderHomeExperienceItemEditCard(item, originalItem, index, copy, editState) {
  const card = createElement('section', { className: 'cms-admin-data-card cms-admin-home-item-edit-card cms-admin-home-experience-item-edit-card' });
  card.appendChild(renderDataCardTitle(`${copy.fields?.card || 'Card'} ${index + 1}`));
  const fields = createElement('div', { className: 'cms-admin-edit-field-grid' });
  if (!item || (item.kind !== 'string' && item.kind !== 'object')) {
    card.appendChild(renderCompactNotice(copy.unsupportedItems || 'Cấu trúc card trải nghiệm chưa hỗ trợ chỉnh sửa ở bước này.'));
    return card;
  }
  if (item.kind === 'string') {
    fields.appendChild(renderHomeExperienceItemTextField(index, 'text', copy.fields?.cardText || 'Tên card', item, editState, { placeholder: copy.placeholders?.cardText || '' }));
  } else {
    fields.appendChild(renderHomeExperienceItemTextField(index, 'title', copy.fields?.cardTitle || 'Tên card', item, editState, { placeholder: copy.placeholders?.cardTitle || '' }));
    fields.appendChild(renderHomeExperienceItemTextField(index, 'description', copy.fields?.cardDescription || 'Mô tả card', item, editState, { multiline: true, placeholder: copy.placeholders?.cardDescription || '' }));
  }
  card.appendChild(fields);

  const readonlyRows = getHomeExperienceReadonlyMetaRows(originalItem, copy);
  if (readonlyRows.length) {
    const readonlyGrid = createElement('div', { className: 'cms-admin-readonly-field-grid cms-admin-home-experience-item-readonly-grid' });
    readonlyRows.forEach(([label, value]) => readonlyGrid.appendChild(renderReadonlyField(label, value, copy.routeReadonlyNote || 'Mã phòng và đường dẫn tham quan chỉ xem ở bước này.')));
    card.appendChild(readonlyGrid);
  }
  return card;
}

function renderHomeExperienceItemTextField(index, fieldName, label, item, editState, options = {}) {
  const fullFieldName = `items.${index}.${fieldName === 'text' ? 'title' : fieldName}`;
  const field = createElement('label', { className: 'cms-admin-edit-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: label }));
  const value = item?.[fieldName] || '';
  const input = options.multiline
    ? createElement('textarea', {
      className: 'cms-admin-edit-input cms-admin-edit-textarea',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fullFieldName, rows: '3' },
    })
    : createElement('input', {
      className: 'cms-admin-edit-input',
      type: 'text',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fullFieldName, autocomplete: 'off' },
    });
  input.addEventListener('input', () => updateHomeExperienceItemDraftField(index, fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fullFieldName, editState)]);
  return field;
}

function renderHomeExperienceTechnicalReadonlyBlock(section, copy) {
  const originalItems = normalizeJsonValue(section?.items_json);
  const block = createElement('section', { className: 'cms-admin-readonly-field-grid cms-admin-home-technical-strip cms-admin-home-experience-technical-strip' });
  block.appendChild(renderReadonlyField(copy.fields?.sectionKey || 'Mã section', section?.section_key, copy.technicalReadonlyNote || 'Thông tin kỹ thuật chỉ xem, không chỉnh trong bước này.'));
  block.appendChild(renderReadonlyField(copy.fields?.sortOrder || 'Thứ tự hiển thị', section?.sort_order, copy.technicalReadonlyNote || 'Thông tin kỹ thuật chỉ xem, không chỉnh trong bước này.'));
  block.appendChild(renderReadonlyField(copy.fields?.visible || 'Trạng thái hiển thị', getVisibleLabel(section?.is_visible), copy.technicalReadonlyNote || 'Thông tin kỹ thuật chỉ xem, không chỉnh trong bước này.'));
  block.appendChild(renderReadonlyField(copy.fields?.updatedAt || 'Cập nhật gần nhất', formatDateTime(section?.updated_at), copy.technicalReadonlyNote || 'Thông tin kỹ thuật chỉ xem, không chỉnh trong bước này.'));
  block.appendChild(renderReadonlyField(copy.fields?.itemCount || 'Số lượng card', Array.isArray(originalItems) ? originalItems.length : 0, copy.itemsReadonlyNote || 'Số lượng và thứ tự card trải nghiệm chưa chỉnh ở bước này.'));
  return block;
}

function getHomeExperienceReadonlyMetaRows(originalItem, copy) {
  if (!originalItem || typeof originalItem !== 'object' || Array.isArray(originalItem)) return [];
  const item = normalizePlainObject(originalItem);
  const rows = [];
  ['room_key', 'room', 'ctaLabel', 'key', 'type', 'icon', 'href', 'url', 'link', 'path', 'to', 'route', 'query', 'order', 'sort_order'].forEach((key) => {
    if (!isBlank(item[key])) rows.push([`${copy.fields?.readonlyMeta || 'Thông tin chỉ xem'} (${key})`, item[key]]);
  });
  return rows;
}

function updateHomeExperienceFormControls(form) {
  const state = getState();
  syncBeforeUnloadGuard(state);
  const dirty = Boolean(state.homeEdit?.dirty);
  const notice = form.querySelector('.cms-admin-dirty-notice');
  const saveButton = form.querySelector('button[type="submit"]');
  if (notice) notice.classList.toggle('cms-admin-hidden', !dirty);
  if (saveButton) saveButton.disabled = Boolean(state.homeEdit?.saving) || !dirty;
  updateSaveDisabledReason(form, state.homeEdit || {});
}

function canEditHomeExperience(state, section) {
  const role = state.profile?.role;
  const active = state.profile?.is_active === true;
  const allowedRole = role === ADMIN_ROLES.admin || role === ADMIN_ROLES.editor;
  return Boolean(!isMobileSafeModeViewport() && ADMIN_FEATURE_FLAGS.allowHomeExperienceEdit && state.supabase && allowedRole && active && section?.id && section?.section_key === 'experience');
}

async function handleSaveHomeExperienceDraft() {
  const state = getState();
  const copy = ADMIN_COPY.contentViews.home.experienceEdit;
  const section = safeArray(state.data.indexSections).find((item) => item.id === state.homeEdit?.editingSectionId && item.section_key === 'experience');
  if (!canEditHomeExperience(state, section)) return;

  const validation = validateHomeExperienceSectionDraft(state.homeEdit?.draftValues || {}, copy);
  if (!validation.valid) {
    setHomeEditState({
      validationErrors: validation.errors,
      validationWarnings: validation.warnings,
      saveError: null,
      saveSuccess: null,
    });
    renderAdminShell();
    return;
  }

  setHomeEditState({
    saving: true,
    saveError: null,
    saveSuccess: null,
    validationErrors: {},
    validationWarnings: validation.warnings,
  });
  renderAdminShell();

  const latestState = getState();
  const { error } = await updateExperienceIndexSectionDraft(
    latestState.supabase,
    latestState.homeEdit?.editingSectionId,
    validation.values,
    latestState.session?.user?.id || null
  );

  if (error) {
    setHomeEditState({ saving: false, saveError: error, validationWarnings: validation.warnings });
    renderAdminShell();
    return;
  }

  await loadDashboardData(latestState.supabase);
  setHomeEditState({
    isEditing: false,
    editingSectionId: null,
    editingSectionKey: null,
    draftValues: {},
    originalValues: {},
    dirty: false,
    saving: false,
    saveError: null,
    saveSuccess: copy.success,
    validationErrors: {},
    validationWarnings: {},
  });
  renderAdminShell();
}

function handleCancelHomeExperienceEdit() {
  const editState = getState().homeEdit || {};
  const copy = ADMIN_COPY.contentViews.home.experienceEdit;
  if (editState.dirty && !window.confirm(copy?.leaveConfirm || 'Bạn có thay đổi chưa lưu. Rời màn này sẽ mất thay đổi. Tiếp tục?')) return;
  resetHomeEdit();
  renderAdminShell();
}

function canEditHomeHero(state, section) {
  const role = state.profile?.role;
  const active = state.profile?.is_active === true;
  const allowedRole = role === ADMIN_ROLES.admin || role === ADMIN_ROLES.editor;
  return Boolean(!isMobileSafeModeViewport() && ADMIN_FEATURE_FLAGS.allowHomeHeroEdit && state.supabase && allowedRole && active && section?.id && section?.section_key === 'hero');
}

function updateHomeHeroFormControls(form) {
  const state = getState();
  syncBeforeUnloadGuard(state);
  const dirty = Boolean(state.homeEdit?.dirty);
  const notice = form.querySelector('.cms-admin-dirty-notice');
  const saveButton = form.querySelector('button[type="submit"]');
  if (notice) notice.classList.toggle('cms-admin-hidden', !dirty);
  if (saveButton) saveButton.disabled = Boolean(state.homeEdit?.saving) || !dirty;
  updateSaveDisabledReason(form, state.homeEdit || {});
}

async function handleSaveHomeHeroDraft() {
  const state = getState();
  const copy = ADMIN_COPY.contentViews.home.edit;
  const section = safeArray(state.data.indexSections).find((item) => item.id === state.homeEdit?.editingSectionId && item.section_key === 'hero');
  if (!canEditHomeHero(state, section)) return;

  const validation = validateIndexSectionDraft(state.homeEdit?.draftValues || {}, copy);
  if (!validation.valid) {
    setHomeEditState({
      validationErrors: validation.errors,
      validationWarnings: validation.warnings,
      saveError: null,
      saveSuccess: null,
    });
    renderAdminShell();
    return;
  }

  setHomeEditState({
    saving: true,
    saveError: null,
    saveSuccess: null,
    validationErrors: {},
    validationWarnings: validation.warnings,
  });
  renderAdminShell();

  const latestState = getState();
  const { error } = await updateIndexSectionDraft(
    latestState.supabase,
    latestState.homeEdit?.editingSectionId,
    validation.values,
    latestState.session?.user?.id || null
  );

  if (error) {
    setHomeEditState({ saving: false, saveError: error, validationWarnings: validation.warnings });
    renderAdminShell();
    return;
  }

  await loadDashboardData(latestState.supabase);
  setHomeEditState({
    isEditing: false,
    editingSectionId: null,
    editingSectionKey: null,
    draftValues: {},
    originalValues: {},
    dirty: false,
    saving: false,
    saveError: null,
    saveSuccess: copy.success,
    validationErrors: {},
    validationWarnings: {},
  });
  renderAdminShell();
}

function handleCancelHomeHeroEdit() {
  const editState = getState().homeEdit || {};
  if (editState.dirty && !window.confirm(ADMIN_COPY.contentViews.home.edit.leaveConfirm)) return;
  resetHomeEdit();
  renderAdminShell();
}

function sectionHasFieldOrData(section, fieldName) {
  return Object.prototype.hasOwnProperty.call(section || {}, fieldName) || !isBlank(section?.[fieldName]);
}

function hasAnyOwnValueKey(object, keys = []) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(object || {}, key));
}

function renderGateRoomCard(roomKey, roomData, copy) {
  const room = normalizePlainObject(roomData);
  const card = createElement('article', { className: 'cms-admin-data-card cms-admin-gate-room-card' });
  card.appendChild(renderDataCardTitle(getRoomLabel(roomKey), roomKey));
  const rows = [
    [copy.fields.roomTitle, firstText(room, ['label', 'title', 'name'])],
    [copy.fields.roomDescription, firstText(room, ['description', 'lead', 'subtitle'])],
    [copy.fields.roomKey, roomKey],
  ];
  const roomCtaLabel = getGateRoomCtaLabel(room);
  if (!isBlank(roomCtaLabel)) {
    rows.splice(2, 0, [copy.fields.roomCta, roomCtaLabel]);
  }
  card.appendChild(renderKeyValueList(rows));
  if (isBlank(roomCtaLabel)) {
    card.appendChild(renderCompactNotice(`${copy.fields.roomCta}: Chưa khai báo nút bắt đầu tham quan.`));
  }
  return card;
}

function getGateRoomCtaLabel(room = {}) {
  const topLevelLabel = firstValue(room, ['ctaLabel']);
  if (!isBlank(topLevelLabel)) return summarizeData(topLevelLabel);

  const ctaObject = firstValue(room, ['cta', 'button', 'action']);
  const normalizedCta = normalizePlainObject(ctaObject);
  const nestedLabel = firstValue(normalizedCta, ['label', 'text', 'title', 'name']);
  return isBlank(nestedLabel) ? '' : summarizeData(nestedLabel);
}

function renderDataGroup(title, contentNode) {
  const group = createElement('div', { className: 'cms-admin-data-group' });
  group.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: title }));
  if (contentNode) group.appendChild(contentNode);
  return group;
}

function filterVisibleRows(rows = []) {
  return rows.filter(([, value]) => !isBlank(normalizeJsonValue(value)));
}

function renderCtaSummary(value, copy) {
  const normalized = normalizeJsonValue(value);
  if (isBlank(normalized)) return null;
  if (Array.isArray(normalized)) return renderItemsList(normalized, copy);
  if (normalized && typeof normalized === 'object') {
    const rows = filterVisibleRows([
      [copy.presentation.buttonLabel, firstValue(normalized, ['label', 'text', 'title', 'name'])],
      [copy.presentation.path, firstValue(normalized, ['href', 'url', 'to', 'link'])],
      [copy.presentation.actionType, firstValue(normalized, ['type', 'action', 'variant'])],
    ]);
    if (rows.length) return renderKeyValueList(rows);
    return renderDeclaredFieldsFallback(copy.presentation, normalized, copy.presentation.cta);
  }
  return renderKeyValueList([[copy.presentation.buttonLabel, normalized]]);
}

function renderMediaSummary(value, copy) {
  const normalized = normalizeJsonValue(value);
  if (isBlank(normalized)) return null;
  if (Array.isArray(normalized)) return renderItemsList(normalized, copy);
  if (normalized && typeof normalized === 'object') {
    const rows = filterVisibleRows([
      [copy.presentation.caption, firstValue(normalized, ['caption', 'alt', 'title', 'label'])],
      [copy.presentation.videoPath, firstValue(normalized, ['videoUrl', 'video_url', 'video', 'mp4', 'src', 'url'])],
      [copy.presentation.imagePath, firstValue(normalized, ['imageUrl', 'image_url', 'image', 'poster', 'posterUrl', 'poster_url', 'thumbnail'])],
      [copy.presentation.fileType, firstValue(normalized, ['type', 'mimeType', 'mime_type', 'kind'])],
    ]);
    if (rows.length) return renderKeyValueList(rows);
    return renderDeclaredFieldsFallback(copy.presentation, normalized, copy.presentation.media);
  }
  return renderKeyValueList([[copy.presentation.path, normalized]]);
}

function renderItemsList(value, copy) {
  const normalized = normalizeJsonValue(value);
  if (isBlank(normalized)) return null;
  const items = Array.isArray(normalized) ? normalized : [normalized];
  if (!items.length) return null;
  const list = createElement('ol', { className: 'cms-admin-structured-list' });
  items.forEach((item, index) => {
    const li = createElement('li');
    const normalizedItem = normalizeJsonValue(item);
    if (normalizedItem && typeof normalizedItem === 'object' && !Array.isArray(normalizedItem)) {
      const title = firstValue(normalizedItem, ['title', 'label', 'name', 'heading', 'text']) || `${copy.presentation.itemTitleFallback} ${index + 1}`;
      const description = firstValue(normalizedItem, ['description', 'lead', 'subtitle', 'body', 'note']);
      li.appendChild(createElement('span', { className: 'cms-admin-structured-main', text: shortenText(title, 96) }));
      if (!isBlank(description)) {
        li.appendChild(createElement('span', { className: 'cms-admin-structured-sub', text: shortenText(description, 140) }));
      }
      const fallback = getUnmappedObjectKeys(normalizedItem, ['title', 'label', 'name', 'heading', 'text', 'description', 'lead', 'subtitle', 'body', 'note']);
      if (!description && fallback.length) {
        li.appendChild(createElement('span', { className: 'cms-admin-structured-sub', text: `${copy.presentation.dataFields}: ${fallback.slice(0, 4).join(', ')}` }));
      }
    } else {
      li.appendChild(createElement('span', { className: 'cms-admin-structured-main', text: summarizeData(normalizedItem) }));
    }
    list.appendChild(li);
  });
  return list;
}

function renderDeclaredFieldsFallback(labels, object, groupLabel) {
  const rows = [[groupLabel, labels.declaredData]];
  const keys = Object.keys(normalizePlainObject(object));
  if (keys.length) rows.push([labels.dataFields, keys.slice(0, 5).join(', ')]);
  return renderKeyValueList(rows);
}

function getMissingIndexSectionFields(section, copy) {
  const optionalFields = [
    [copy.fields.subtitle, section?.subtitle],
    [copy.fields.body, section?.body],
    [copy.fields.cta, section?.cta_json],
    [copy.fields.media, section?.media_json],
    [copy.fields.items, section?.items_json],
  ];
  return optionalFields
    .filter(([, value]) => isBlank(normalizeJsonValue(value)))
    .map(([label]) => label);
}

function renderMissingFieldsNotice(title, fields = []) {
  const list = fields.filter(Boolean);
  if (!list.length) return null;
  return createElement('p', {
    className: 'cms-admin-compact-copy cms-admin-missing-fields-note',
    text: `${title}: ${list.join(', ')}.`,
  });
}

function getUnmappedObjectKeys(object, mappedKeys = []) {
  const mapped = new Set(mappedKeys);
  return Object.keys(normalizePlainObject(object)).filter((key) => !mapped.has(key));
}

function renderDataCardTitle(title, meta) {
  const head = createElement('div', { className: 'cms-admin-data-card-title' });
  head.appendChild(createElement('h3', { text: title }));
  if (meta) head.appendChild(renderBadge(meta));
  return head;
}

function renderSourceStrip(label, value) {
  const strip = createElement('div', { className: 'cms-admin-source-strip' });
  strip.appendChild(createElement('span', { text: label }));
  strip.appendChild(createElement('strong', { text: value }));
  return strip;
}

function renderPublicLink(label, href) {
  const row = createElement('div', { className: 'cms-admin-public-link-row' });
  row.appendChild(createElement('a', {
    className: 'cms-admin-button cms-admin-button-ghost cms-admin-public-link',
    text: label,
    href,
    attrs: { target: '_blank', rel: 'noopener' },
  }));
  return row;
}

function getGateRoomEntries(value) {
  const rooms = normalizePlainObject(value);
  const preferred = ['indoor', 'outdoor'];
  const entries = [];
  preferred.forEach((key) => {
    if (rooms[key]) entries.push([key, rooms[key]]);
  });
  Object.entries(rooms).forEach(([key, entry]) => {
    if (!preferred.includes(key)) entries.push([key, entry]);
  });
  return entries;
}

function getFriendlyDataKey(key) {
  const labels = {
    label: 'Nhãn',
    title: 'Tiêu đề',
    text: 'Nội dung',
    name: 'Tên',
    href: 'Đường dẫn',
    url: 'Đường dẫn',
    src: 'Đường dẫn',
    type: 'Loại',
  };
  return labels[key] || key;
}

function summarizeData(value) {
  const normalized = normalizeJsonValue(value);
  if (isBlank(normalized)) return '—';
  if (Array.isArray(normalized)) {
    if (!normalized.length) return '—';
    const sample = normalized.slice(0, 3).map((item) => summarizeData(item)).filter((item) => item !== '—').join('; ');
    return `${formatCount(normalized.length)} mục${sample ? `: ${sample}` : ''}`;
  }
  if (typeof normalized === 'object') {
    const preferred = ['label', 'title', 'text', 'name', 'href', 'url', 'src', 'type'];
    const parts = preferred
      .map((key) => normalized[key] ? `${getFriendlyDataKey(key)}: ${summarizeData(normalized[key])}` : '')
      .filter(Boolean);
    if (parts.length) return parts.slice(0, 4).join(' · ');
    const keys = Object.keys(normalized);
    return keys.length ? `Đã khai báo dữ liệu · Trường dữ liệu: ${keys.slice(0, 5).join(', ')}` : '—';
  }
  return shortenText(String(normalized));
}

function normalizeJsonValue(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return '';
  if (!['{', '['].includes(text[0])) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizePlainObject(value) {
  const normalized = normalizeJsonValue(value);
  return normalized && typeof normalized === 'object' && !Array.isArray(normalized) ? normalized : {};
}

function firstValue(object, keys = []) {
  return keys.map((key) => object?.[key]).find((value) => !isBlank(value));
}

function firstText(object, keys = []) {
  return summarizeData(firstValue(object, keys));
}

function isBlank(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);
}

function shortenText(text, maxLength = 120) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized || '—';
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function getWarningItems(artworks) {
  return safeArray(artworks).filter((item) => item?.cms_warning);
}

function renderReadOnlyPlanningView(key) {
  const copy = ADMIN_COPY.planningScreens[key];
  const wrap = createElement('section', { className: 'cms-admin-grid cms-admin-planning-view' });
  const main = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-planning-panel' });
  main.appendChild(renderPanelTitle(copy.title, copy.status));
  main.appendChild(createElement('p', { className: 'cms-admin-planning-lead', text: copy.intro }));

  const featurePanel = renderFeatureListPanel(copy.sectionsTitle, copy.sections);
  const note = createElement('section', { className: 'cms-admin-alert cms-admin-alert-info cms-admin-compact-notice' });
  note.appendChild(createElement('strong', { text: copy.noteTitle }));
  note.appendChild(createElement('div', { text: copy.note }));

  appendChildren(main, [featurePanel, note]);
  wrap.appendChild(main);
  return wrap;
}

function renderFeatureListPanel(title, items = []) {
  const panel = createElement('div', { className: 'cms-admin-feature-list-panel' });
  panel.appendChild(createElement('h3', { text: title }));
  const grid = createElement('div', { className: 'cms-admin-feature-list-grid' });
  safeArray(items).forEach((item, index) => {
    const row = createElement('div', { className: 'cms-admin-feature-item' });
    row.appendChild(createElement('span', { className: 'cms-admin-feature-index', text: String(index + 1).padStart(2, '0') }));
    row.appendChild(createElement('span', { text: item }));
    grid.appendChild(row);
  });
  panel.appendChild(grid);
  return panel;
}

function renderSectionIntroCard(title, body, meta) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-section-intro' });
  panel.appendChild(renderPanelTitle(title, meta));
  panel.appendChild(createElement('p', { text: body }));
  return panel;
}

function renderWebsiteStatusPanel({ published, errors, siteSettings, dashboardSummary, canonicalError }) {
  const copy = ADMIN_COPY.dashboard.status;
  const hasErrors = Object.keys(errors || {}).length > 0;
  const usingFallback = dashboardSummary?.source === 'db-fallback';
  const sourceLabel = usingFallback ? copy.fallbackSource : copy.canonicalSource;
  const sourceDetail = canonicalError && usingFallback
    ? `${sourceLabel} · ${normalizeErrorMessage(canonicalError)}`
    : sourceLabel;
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-dashboard-status-panel' });
  panel.appendChild(renderPanelTitle(copy.title, hasErrors || usingFallback ? 'Cần kiểm tra' : 'Ổn định'));
  panel.appendChild(renderKeyValueList([
    [copy.currentVersion, dashboardSummary?.version || published?.version || '—'],
    [copy.publishedAt, formatDateTime(published?.published_at)],
    [copy.cmsRecordStatus, getStatusLabel(siteSettings?.site_status)],
    [copy.dataSource, sourceDetail],
    [copy.readOnlyMode, copy.readOnly],
    [copy.website, hasErrors ? 'Cần kiểm tra kết nối dữ liệu' : copy.active],
  ]));
  panel.appendChild(renderCompactNotice(copy.sourceNote));
  return panel;
}

function renderQuickActionsPanel() {
  const copy = ADMIN_COPY.dashboard.quickActions;
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-quick-actions-panel' });
  panel.appendChild(renderPanelTitle(copy.title));
  const grid = createElement('div', { className: 'cms-admin-quick-action-grid' });
  copy.actions.forEach((action) => {
    const button = createElement('button', {
      className: 'cms-admin-quick-action-card',
      type: 'button',
    });
    button.appendChild(createElement('strong', { text: action.label }));
    button.appendChild(createElement('span', { text: action.note }));
    button.addEventListener('click', () => switchAdminTab(action.key));
    grid.appendChild(button);
  });

  const website = createElement('a', {
    className: 'cms-admin-quick-action-card cms-admin-quick-action-card-link',
    href: './index.html',
    attrs: { target: '_blank', rel: 'noopener' },
  });
  website.appendChild(createElement('strong', { text: copy.website.label }));
  website.appendChild(createElement('span', { text: copy.website.note }));
  grid.appendChild(website);

  panel.appendChild(grid);
  return panel;
}

function renderMetricsPanel({ rooms, artworks, indoor, outdoor, media, featured }) {
  const copy = ADMIN_COPY.dashboard.metrics;
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-metrics-panel' });
  panel.appendChild(renderPanelTitle(copy.title));
  const stats = createElement('div', { className: 'cms-admin-metric-grid' });
  const entries = [
    [copy.rooms, rooms],
    [copy.artworks, artworks],
    [copy.indoor, indoor],
    [copy.outdoor, outdoor],
    [copy.media, media],
  ];
  if (featured !== undefined) {
    entries.push([copy.featured, featured]);
  }
  entries.forEach(([label, value]) => stats.appendChild(renderMetricTile(label, value)));
  panel.appendChild(stats);
  return panel;
}

function renderMetricTile(label, value) {
  const tile = createElement('div', { className: 'cms-admin-metric-tile' });
  tile.appendChild(createElement('span', { className: 'cms-admin-metric-value', text: formatCount(value) }));
  tile.appendChild(createElement('span', { className: 'cms-admin-metric-label', text: label }));
  return tile;
}

function renderInfoTile(label, value, technical = false) {
  const tile = createElement('div', { className: technical ? 'cms-admin-info-tile is-technical' : 'cms-admin-info-tile' });
  tile.appendChild(createElement('span', { className: 'cms-admin-info-label', text: label }));
  tile.appendChild(createElement('span', { className: technical ? 'cms-admin-info-value cms-admin-mono' : 'cms-admin-info-value', text: value }));
  return tile;
}

function switchAdminTab(tabKey) {
  const currentState = getState();
  if (currentState.activeTab === tabKey) return true;
  if (!requestLeaveEditSession('tab-switch')) return false;
  setActiveTab(tabKey);
  renderAdminShell();
  return true;
}

function renderBundlesTable(bundles) {
  const list = safeArray(bundles);
  if (!list.length) return renderEmptyState(ADMIN_COPY.history.empty);

  return renderStructuredTable(
    ADMIN_COPY.history.headers,
    list.map((bundle) => [
      cellText(bundle.version, 'cms-admin-mono cms-admin-nowrap'),
      cellText(bundle.schema_version, 'cms-admin-nowrap'),
      cellNode(renderBadge(getStatusLabel(bundle.status), bundle.status === 'published' ? 'success' : 'warning')),
      cellText(formatDateTime(bundle.published_at), 'cms-admin-nowrap'),
      cellText(formatDateTime(bundle.created_at), 'cms-admin-nowrap cms-admin-muted-cell'),
      cellNode(renderHistoryNote(bundle), 'cms-admin-note-cell'),
      cellNode(renderHistoryActions(), 'cms-admin-history-actions-cell'),
    ]),
    'cms-admin-history-table'
  );
}


function renderHistoryNote(bundle) {
  const wrap = createElement('div', { className: 'cms-admin-cell-stack' });
  wrap.appendChild(createElement('span', { className: 'cms-admin-cell-main', text: getFriendlyNote(bundle.note) }));
  const help = bundle.status === 'published'
    ? ADMIN_COPY.history.statusHelp.published
    : bundle.status === 'archived'
      ? ADMIN_COPY.history.statusHelp.archived
      : '';
  if (help) wrap.appendChild(createElement('span', { className: 'cms-admin-cell-sub', text: help }));
  return wrap;
}

function renderHistoryActions() {
  const row = createElement('div', { className: 'cms-admin-history-actions' });
  ADMIN_COPY.history.actions.forEach((label) => {
    row.appendChild(createElement('button', {
      className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-disabled-action cms-admin-mini-action',
      text: label,
      type: 'button',
      attrs: { disabled: 'true', 'aria-disabled': 'true', title: ADMIN_COPY.history.actionDisabled },
    }));
  });
  return row;
}

function renderStructuredTable(headers, rows, tableClass = '') {
  const wrap = createElement('div', { className: 'cms-admin-table-wrap' });
  const table = createElement('table', { className: ['cms-admin-table', tableClass].filter(Boolean).join(' ') });
  const thead = createElement('thead');
  const headRow = createElement('tr');
  headers.forEach((header) => headRow.appendChild(createElement('th', { text: header })));
  thead.appendChild(headRow);

  const tbody = createElement('tbody');
  rows.forEach((row) => {
    const tr = createElement('tr');
    row.forEach((cell) => {
      const td = createElement('td', { className: cell?.className || '' });
      if (cell?.node) {
        td.appendChild(cell.node);
      } else {
        td.textContent = toDisplayText(cell?.text);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  appendChildren(table, [thead, tbody]);
  wrap.appendChild(table);
  return wrap;
}

function cellText(text, className = '') {
  return { text, className };
}

function cellNode(node, className = '') {
  return { node, className };
}

function renderStatCard(label, value, note, options = {}) {
  const card = createElement('article', {
    className: [
      'cms-admin-stat-card',
      options.longValue ? 'is-long-value' : '',
      options.warning ? 'is-warning' : '',
      options.success ? 'is-success' : '',
    ].filter(Boolean).join(' '),
  });
  appendChildren(card, [
    createElement('p', { className: 'cms-admin-stat-label', text: label }),
    createElement('p', { className: `cms-admin-stat-value${options.mono ? ' cms-admin-mono' : ''}`, text: value }),
    createElement('p', { className: 'cms-admin-stat-note', text: note }),
  ]);
  return card;
}

function renderSiteSettingsPanel(siteSettings) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel' });
  panel.appendChild(renderPanelTitle(ADMIN_COPY.dashboard.panels.siteSettings, siteSettings ? 'Đã đọc dữ liệu' : 'Chưa có dữ liệu'));
  if (!siteSettings) {
    panel.appendChild(renderEmptyState(ADMIN_COPY.settings.siteMissing));
    return panel;
  }

  panel.appendChild(renderKeyValueList([
    [ADMIN_COPY.settings.websiteFields.siteTitle, siteSettings.site_title],
    [ADMIN_COPY.settings.websiteFields.organization, siteSettings.organization_name],
    [ADMIN_COPY.settings.websiteFields.address, siteSettings.address],
    [ADMIN_COPY.settings.websiteFields.phone, siteSettings.phone],
    [ADMIN_COPY.settings.websiteFields.fax, siteSettings.fax],
    [ADMIN_COPY.settings.websiteFields.email, siteSettings.email || ADMIN_COPY.settings.missingEmail],
    [ADMIN_COPY.settings.websiteFields.logoUrl, siteSettings.logo_url],
    [ADMIN_COPY.settings.websiteFields.status, getStatusLabel(siteSettings.site_status)],
  ]));
  panel.appendChild(renderCompactNotice(ADMIN_COPY.settings.cmsStatusNote));
  return panel;
}

function renderLatestBundlePanel(bundle) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel' });
  panel.appendChild(renderPanelTitle(ADMIN_COPY.dashboard.panels.contentPublished, bundle ? getStatusLabel(bundle.status) : 'Chưa có'));
  if (!bundle) {
    panel.appendChild(renderEmptyState(ADMIN_COPY.publish.noCurrent));
    return panel;
  }

  panel.appendChild(renderKeyValueList([
    [ADMIN_COPY.publish.fields.version, bundle.version],
    [ADMIN_COPY.publish.fields.schema, bundle.schema_version],
    [ADMIN_COPY.publish.fields.status, getStatusLabel(bundle.status)],
    [ADMIN_COPY.publish.fields.publishedAt, formatDateTime(bundle.published_at)],
    [ADMIN_COPY.publish.fields.createdAt, formatDateTime(bundle.created_at)],
    [ADMIN_COPY.publish.fields.note, getFriendlyNote(bundle.note)],
  ]));
  return panel;
}

function renderTaskPanel({ warningItems = [], warningMessages = [], warningCount = 0, mediaCount = 0, warningHint = ADMIN_COPY.dashboard.tasks.warningHint } = {}) {
  const panel = createElement('section', { className: 'cms-admin-help-panel cms-admin-task-panel' });
  panel.appendChild(createElement('h3', { text: ADMIN_COPY.dashboard.tasks.title }));
  const list = createElement('ul', { className: 'cms-admin-task-list' });
  const effectiveWarningCount = warningCount || warningItems.length || warningMessages.length;
  if (effectiveWarningCount) {
    const names = warningMessages.length
      ? warningMessages.slice(0, 3).join('; ')
      : warningItems.slice(0, 3).map((item) => `${item.artwork_code || '—'} · ${item.title || 'Chưa có tên'}`).join('; ');
    const detail = names ? `: ${names}.` : '.';
    list.appendChild(createElement('li', { text: `Có ${formatCount(effectiveWarningCount)} nội dung cần kiểm tra${detail}` }));
  } else {
    list.appendChild(createElement('li', { text: ADMIN_COPY.dashboard.tasks.warningEmpty }));
  }
  const mediaText = mediaCount > 0
    ? `Thư viện ảnh/video hiện có ${formatCount(mediaCount)} tệp.`
    : ADMIN_COPY.dashboard.tasks.mediaEmpty;
  [mediaText, ADMIN_COPY.dashboard.tasks.locked, ADMIN_COPY.dashboard.tasks.publicSafe].forEach((item) => {
    list.appendChild(createElement('li', { text: item }));
  });
  panel.appendChild(list);
  if (effectiveWarningCount) {
    const action = createElement('button', {
      className: 'cms-admin-button cms-admin-button-ghost cms-admin-task-action',
      text: ADMIN_COPY.dashboard.tasks.warningAction,
      type: 'button',
    });
    action.addEventListener('click', () => {
      switchAdminTab('staticDraft');
    });
    panel.appendChild(action);
    panel.appendChild(renderCompactNotice(warningHint));
  }
  return panel;
}

function renderReadOnlyNoticePanel() {
  const panel = createElement('section', { className: 'cms-admin-alert cms-admin-alert-info cms-admin-compact-notice' });
  panel.appendChild(createElement('strong', { text: ADMIN_COPY.dashboard.safety.title }));
  const note = createElement('div', {
    text: ADMIN_COPY.dashboard.safety.body,
  });
  note.style.marginTop = '4px';
  panel.appendChild(note);
  return panel;
}

function renderSystemErrors(errors) {
  const panel = createElement('section', { className: 'cms-admin-alert cms-admin-alert-warning' });
  panel.appendChild(createElement('strong', { text: 'Một số dữ liệu chưa đọc được' }));
  panel.appendChild(createElement('div', {
    text: 'Có thể bảng chưa tồn tại, quyền xem dữ liệu chưa được cấp, hoặc kết nối dữ liệu chưa sẵn sàng.',
  }));
  const list = createElement('div', { className: 'cms-admin-error-list cms-admin-technical-note' });
  Object.entries(errors).forEach(([key, error]) => {
    list.appendChild(createElement('div', { text: `${key}: ${normalizeErrorMessage(error)}` }));
  });
  panel.appendChild(list);
  return panel;
}

function renderPanelTitle(title, meta) {
  const wrap = createElement('div', { className: 'cms-admin-panel-title' });
  wrap.appendChild(createElement('h3', { text: title }));
  if (meta) wrap.appendChild(renderBadge(meta));
  return wrap;
}

function renderKeyValueList(rows) {
  const list = createElement('div', { className: 'cms-admin-kv-list' });
  rows.forEach(([key, value]) => {
    const row = createElement('div', { className: 'cms-admin-kv-row' });
    row.appendChild(createElement('div', { className: 'cms-admin-kv-key', text: key }));
    row.appendChild(createElement('div', { className: 'cms-admin-kv-value', text: toDisplayText(value) }));
    list.appendChild(row);
  });
  return list;
}


function renderTechnicalKeyValueList(rows) {
  const list = createElement('div', { className: 'cms-admin-kv-list cms-admin-technical-kv-list' });
  rows.forEach(([key, value, technicalCode]) => {
    const row = createElement('div', { className: 'cms-admin-kv-row' });
    row.appendChild(createElement('div', { className: 'cms-admin-kv-key', text: key }));
    const valueWrap = createElement('div', { className: 'cms-admin-kv-value cms-admin-cell-stack' });
    valueWrap.appendChild(createElement('span', { className: 'cms-admin-cell-main', text: toDisplayText(value) }));
    if (technicalCode) {
      valueWrap.appendChild(createElement('span', { className: 'cms-admin-cell-sub cms-admin-technical-muted', text: `Mã kỹ thuật: ${technicalCode}` }));
    }
    row.appendChild(valueWrap);
    list.appendChild(row);
  });
  return list;
}

function renderLockedNotice(message) {
  return createElement('p', { className: 'cms-admin-locked-note', text: message });
}

function renderCompactWarning(message) {
  return createElement('p', { className: 'cms-admin-compact-copy cms-admin-compact-warning', text: message });
}

function renderCompactNotice(message) {
  return createElement('p', { className: 'cms-admin-compact-copy', text: message });
}

function renderRequirementList(title, items = []) {
  const panel = createElement('div', { className: 'cms-admin-requirement-panel' });
  panel.appendChild(createElement('strong', { text: title }));
  const list = createElement('ul');
  safeArray(items).forEach((item) => list.appendChild(createElement('li', { text: item })));
  panel.appendChild(list);
  return panel;
}

function renderWorkflowSteps(steps) {
  const list = createElement('ol', { className: 'cms-admin-workflow-list' });
  steps.forEach((step) => {
    list.appendChild(createElement('li', { text: step }));
  });
  return list;
}

function renderDisabledActionRow(labels) {
  const row = createElement('div', { className: 'cms-admin-disabled-actions' });
  labels.forEach((label) => {
    row.appendChild(createElement('button', {
      className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-disabled-action',
      text: label,
      type: 'button',
      attrs: { disabled: 'true', 'aria-disabled': 'true' },
    }));
  });
  return row;
}

function getCurrentPublishedBundle(bundles = []) {
  const list = safeArray(bundles);
  return list.find((bundle) => bundle.status === 'published') || list[0] || null;
}

function renderLoadingPanel() {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-loading-panel' });
  appendChildren(panel, [
    createElement('div', { className: 'cms-admin-spinner' }),
    createElement('p', { className: 'cms-admin-help-text', text: ADMIN_COPY.notices.loading }),
  ]);
  return panel;
}

function renderBrandBlock() {
  const brand = createElement('div', { className: 'cms-admin-brand' });
  const mark = createElement('div', { className: 'cms-admin-logo-mark', text: '3D' });
  const text = createElement('div');
  text.appendChild(createElement('p', { className: 'cms-admin-eyebrow', text: ADMIN_COPY.app.brandEyebrow }));
  text.appendChild(createElement('p', { className: 'cms-admin-sidebar-title', text: ADMIN_COPY.app.brandTitle }));
  appendChildren(brand, [mark, text]);
  return brand;
}

function renderProfileCard(profile) {
  const card = createElement('div', { className: 'cms-admin-profile-card' });
  card.appendChild(createElement('p', {
    className: 'cms-admin-profile-name',
    text: profile?.display_name || profile?.email || 'Người quản trị',
  }));
  card.appendChild(createElement('p', {
    className: 'cms-admin-profile-meta',
    text: `${getRoleLabel(profile?.role)} · ${getActiveLabel(Boolean(profile?.is_active))}`,
  }));
  return card;
}

function renderInputField(name, label, type, placeholder) {
  const field = createElement('label', { className: 'cms-admin-field' });
  field.appendChild(createElement('span', { className: 'cms-admin-label', text: label }));
  field.appendChild(createElement('input', {
    className: 'cms-admin-input',
    type,
    placeholder,
    attrs: { name, autocomplete: type === 'password' ? 'current-password' : 'email' },
  }));
  return field;
}

function renderConfigWarning(configStatus) {
  const box = createElement('div', { className: 'cms-admin-alert cms-admin-alert-warning' });
  box.appendChild(createElement('strong', { text: ADMIN_COPY.notices.configWarningTitle }));
  const detail = createElement('div', {
    text: `Thiếu: ${configStatus.missing.join(', ')}. ${ADMIN_COPY.notices.configWarningBody}`,
  });
  detail.style.marginTop = '6px';
  box.appendChild(detail);
  return box;
}

function clearLoginError(errorBox) {
  errorBox.className = 'cms-admin-hidden';
  clearNode(errorBox);
}

function showLoginError(errorBox, error) {
  errorBox.className = 'cms-admin-alert cms-admin-alert-error';
  errorBox.textContent = normalizeErrorMessage(error);
}

async function handleLogout() {
  if (!requestLeaveEditSession('logout')) return;
  const client = getState().supabase;
  await signOut(client);
  if (unsubscribeAuth) {
    unsubscribeAuth();
    unsubscribeAuth = null;
  }
  renderLogin();
}
