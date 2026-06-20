import { ADMIN_FEATURE_FLAGS, ADMIN_ROLES, STATIC_CMS_DRAFT_CONFIG, getSupabaseConfigStatus } from './adminConfig.js';
import {
  createSupabaseClient,
  onAuthStateChange,
  requireAdminAccess,
  signInWithEmailPassword,
  signOut,
} from './adminAuth.js';
import { confirmDeleteCmsMedia, fetchDashboardData, prepareDeleteCmsMedia, updateExperienceIndexSectionDraft, updateGateContentDraft, updateGuideIndexSectionDraft, updateIndexSectionDraft, updateSiteSettingsDraft } from './adminApi.js';
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
  resetStaticCmsDraftToBaseline,
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
let pendingReferenceFocusTarget = null;
let beforeUnloadGuardBound = false;
const workspaceTabState = Object.create(null);
let gateEditTargetKey = '';
const homeMediaPickerState = {
  open: false,
  search: '',
  mediaKindFilter: 'compatible',
  targetField: '',
  error: '',
};

const mediaWorkspaceState = {
  selectedAssetId: '',
  inspectorTab: 'overview',
  deletePrepareByAssetId: Object.create(null),
  deleteConfirmByAssetId: Object.create(null),
  deleteConfirmTextByAssetId: Object.create(null),
  openDeletePanelByAssetId: Object.create(null),
};



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
  focusPendingReferenceTarget();
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

function queueReferenceFocus(type, id, fieldName = '', label = '') {
  if (!type) return;
  pendingReferenceFocusTarget = {
    type,
    id: id === undefined || id === null ? '' : String(id),
    fieldName: fieldName || '',
    label: label || '',
  };
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

function focusPendingReferenceTarget() {
  const target = pendingReferenceFocusTarget;
  if (!target || !root) return;
  pendingReferenceFocusTarget = null;
  requestAnimationFrame(() => {
    const targetNode = findReferenceTarget(target);
    if (!targetNode) return;
    targetNode.classList.add('is-reference-focus', 'is-scroll-focus');
    const reducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    targetNode.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    if (!targetNode.hasAttribute('tabindex')) targetNode.setAttribute('tabindex', '-1');
    if (typeof targetNode.focus === 'function') targetNode.focus({ preventScroll: true });
    window.setTimeout(() => targetNode.classList.remove('is-reference-focus'), 2600);
  });
}

function findReferenceTarget(target = {}) {
  const type = String(target.type || '');
  const id = String(target.id || '');
  const fieldName = String(target.fieldName || '');
  const referenceNodes = Array.from(root.querySelectorAll('[data-cms-reference-target]'));
  const exact = referenceNodes.find((node) => node.dataset.cmsReferenceTarget === type
    && (!id || node.dataset.cmsReferenceId === id)
    && (!fieldName || !node.dataset.cmsReferenceField || node.dataset.cmsReferenceField === fieldName));
  if (exact) return exact;
  const idMatch = referenceNodes.find((node) => node.dataset.cmsReferenceTarget === type
    && (!id || node.dataset.cmsReferenceId === id));
  if (idMatch) return idMatch;
  const typeMatch = referenceNodes.find((node) => node.dataset.cmsReferenceTarget === type);
  if (typeMatch) return typeMatch;
  const panel = findCmsTarget('data-cms-edit-panel', type, id);
  const row = findCmsTarget('data-cms-edit-row', type, id);
  return panel || row || null;
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
    title: copy.cancelTitle || copy.cancelAria || 'Hủy phiên chỉnh sửa hiện tại',
    type: 'button',
    ariaLabel: copy.cancelAria || copy.cancelTitle || 'Hủy phiên chỉnh sửa hiện tại',
  });
  cancelButton.addEventListener('click', () => handlers.onCancel?.());

  const resetButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary cms-admin-reset-draft-button',
    text: copy.reset || ADMIN_COPY.globalEdit?.reset || 'Đặt lại thay đổi',
    title: copy.resetTitle || copy.resetAria || 'Đặt lại các thay đổi chưa lưu trong form hiện tại',
    type: 'button',
    ariaLabel: copy.resetAria || copy.resetTitle || 'Đặt lại các thay đổi chưa lưu trong form hiện tại',
    attrs: { 'data-cms-reset-draft': 'true' },
  });
  resetButton.disabled = Boolean(editState.saving) || !Boolean(editState.dirty);
  resetButton.addEventListener('click', () => handlers.onReset?.());

  const saveButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    text: editState.saving ? (copy.saving || 'Đang lưu...') : (copy.save || 'Lưu bản nháp'),
    title: copy.saveTitle || copy.saveAria || 'Lưu nội dung vào bản nháp CMS',
    type: 'submit',
    ariaLabel: copy.saveAria || copy.saveTitle || 'Lưu nội dung vào bản nháp CMS',
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
    case 'gate': {
      const gateTabKey = getGateWorkspaceSectionKey(gateEditTargetKey || getWorkspaceActiveTab('gate', getWorkspaceTabs('gate')));
      if (gateTabKey === 'indoor' || gateTabKey === 'outdoor') {
        return { type: 'gate-room', id: gateTabKey, fieldName: `rooms.${gateTabKey}.displayName` };
      }
      return { type: 'gate-intro', id: currentState.data.gateContent?.id || 'gate', fieldName: 'eyebrow' };
    }
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
      return renderWorkspaceShell('dashboard', renderDashboardWorkspaceContent(state), state, { hideTabs: true, hideRail: true });
    case 'home':
      return renderWorkspaceShell('home', null, state, {
        hideRail: true,
        renderContent: ({ activeKey }) => renderHomeWorkspaceContent(state, activeKey),
      });
    case 'gate':
      return renderWorkspaceShell('gate', null, state, {
        hideRail: true,
        renderContent: ({ activeKey }) => renderGateWorkspaceContent(state, activeKey),
      });
    case 'media':
      return renderWorkspaceShell('media', null, state, {
        renderContent: ({ activeKey }) => renderMediaTab(state, activeKey),
      });
    case 'staticDraft':
      return renderWorkspaceShell('staticDraft', null, state, {
        renderContent: ({ activeKey }) => renderStaticCmsDraftTab(state, {
          activeWorkspaceKey: activeKey,
          activeRoomKey: activeKey,
          onRerender: renderAdminShell,
          onOpenHistory: () => switchAdminTab('history'),
        }),
      });
    case 'publish':
      return renderWorkspaceShell('publish', null, state, {
        renderContent: ({ activeKey }) => renderPublishWorkspaceContent(state, activeKey),
      });
    case 'history':
      return renderWorkspaceShell('history', renderRollbackHistoryTab(state, { onRerender: renderAdminShell }), state, { hideTabs: true, hideRail: true });
    case 'cleanup':
      return renderWorkspaceShell('cleanup', renderCmsStorageCleanupTab(state, { onRerender: renderAdminShell }), state, { hideTabs: true, hideRail: true });
    case 'settings':
      return renderWorkspaceShell('settings', renderSettingsTab(state), state, { hideTabs: true, hideRail: true });
    default:
      return renderWorkspaceShell('dashboard', renderDashboard(state), state);
  }
}

const WORKSPACE_TAB_DEFINITIONS = Object.freeze({
  dashboard: [
    { key: 'workspace', label: 'Tổng quan website', summary: 'Xem nhanh website đang ổn hay cần kiểm tra và mở nhanh màn cần xử lý.' },
  ],
  home: [
    { key: 'hero', label: 'Khu vực đầu trang', summary: 'Phần người xem thấy đầu tiên khi mở website.' },
    { key: 'experience', label: 'Khu vực trải nghiệm', summary: 'Phần giới thiệu hành trình và cảm giác tham quan.' },
    { key: 'guide', label: 'Hướng dẫn tham quan', summary: 'Phần giúp người xem biết cách bắt đầu và đi tiếp.' },
    { key: 'contact', label: 'Liên hệ tham chiếu', summary: 'Đối chiếu thông tin liên hệ; chỉnh nguồn chính ở Thông tin website.' },
  ],
  gate: [
    { key: 'intro', label: 'Màn chào', summary: 'Phần người xem đọc trước khi chọn không gian.' },
    { key: 'indoor', label: 'Không gian trong nhà', summary: 'Lựa chọn vào phòng trưng bày trong nhà.' },
    { key: 'outdoor', label: 'Không gian ngoài trời', summary: 'Lựa chọn vào phòng trưng bày ngoài trời.' },
  ],
  staticDraft: [
    { key: 'indoor', label: 'Phòng trong nhà', summary: 'Nội dung và item thuộc phòng trưng bày trong nhà.' },
    { key: 'outdoor', label: 'Phòng ngoài trời', summary: 'Nội dung và item thuộc phòng trưng bày ngoài trời.' },
    { key: 'featured', label: 'Tác phẩm tiêu biểu', summary: 'Nội dung nổi bật trên Trang chủ/Intro lấy từ index.featuredArtworks.' },
  ],
  media: [
    { key: 'library', label: 'Thư viện', summary: 'Xem và lọc ảnh/video đã có.' },
    { key: 'usage', label: 'Đang dùng', summary: 'Xem nơi media đang được tham chiếu trong CMS.' },
  ],
  publish: [
    { key: 'status', label: 'Trạng thái', summary: 'Xem bản ghi tham chiếu và điều kiện hiện tại.' },
    { key: 'check', label: 'Kiểm tra', summary: 'Xem checklist trước khi công khai.' },
    { key: 'publish', label: 'Công khai', summary: 'Hiểu rõ nơi thao tác công khai thật đang được khóa.' },
    { key: 'history', label: 'Lịch sử liên quan', summary: 'Chuyển sang lịch sử nếu cần kiểm tra hoặc khôi phục.' },
  ],
  history: [
    { key: 'workspace', label: 'Luồng khôi phục', summary: 'Chọn phiên bản, preview, dry-run, nhập lý do và khôi phục có kiểm soát trong cùng workspace.' },
  ],
  cleanup: [
    { key: 'workspace', label: 'Luồng dọn tệp', summary: 'Quét, kiểm tra candidate, xem chi tiết và chỉ dọn khi checklist an toàn đạt.' },
  ],
  settings: [
    { key: 'workspace', label: 'Workspace thông tin website', summary: 'Chỉnh thông tin, kiểm tra và lưu bản nháp CMS trong một workspace.' },
  ],
});

function getWorkspaceTabs(workspaceKey) {
  return WORKSPACE_TAB_DEFINITIONS[workspaceKey] || WORKSPACE_TAB_DEFINITIONS.dashboard;
}

const WORKSPACE_LEGACY_TAB_FALLBACKS = Object.freeze({
  gate: {
    content: 'intro',
    spaces: 'indoor',
    edit: 'intro',
    details: 'intro',
  },
  staticDraft: {
    select: 'indoor',
    edit: 'indoor',
    media: 'indoor',
    check: 'indoor',
  },
});

function getCompatibleWorkspaceTabKey(workspaceKey, tabKey) {
  const key = tabKey || '';
  return WORKSPACE_LEGACY_TAB_FALLBACKS[workspaceKey]?.[key] || key;
}

function getWorkspaceActiveTab(workspaceKey, tabs) {
  const requested = workspaceTabState[workspaceKey];
  const compatible = getCompatibleWorkspaceTabKey(workspaceKey, requested);
  if (tabs.some((tab) => tab.key === compatible)) {
    if (compatible !== requested) workspaceTabState[workspaceKey] = compatible;
    return compatible;
  }
  return tabs[0]?.key;
}

function setWorkspaceTabState(workspaceKey, tabKey) {
  workspaceTabState[workspaceKey] = getCompatibleWorkspaceTabKey(workspaceKey, tabKey);
}

function getWorkspacePageCopy(workspaceKey) {
  return ADMIN_COPY.pageTitles?.[workspaceKey] || ADMIN_COPY.pageTitles?.dashboard || { title: 'CMS Admin', subtitle: '' };
}

function getWorkspaceStepConfig(workspaceKey) {
  const contentViews = ADMIN_COPY.contentViews || {};
  const configs = {
    dashboard: ADMIN_COPY.dashboard?.nextSteps,
    home: contentViews.home?.operatorSteps,
    gate: contentViews.gate?.operatorSteps,
    staticDraft: ADMIN_COPY.staticDraft?.operatorSteps,
    media: ADMIN_COPY.media?.operatorSteps,
    publish: ADMIN_COPY.publish?.operatorSteps,
    history: {
      title: ADMIN_COPY.rollbackHistoryOperator?.readinessTitle || 'Checklist khôi phục phiên bản',
      subtitle: ADMIN_COPY.rollbackHistoryOperator?.readinessIntro || 'Kiểm tra kỹ trước khi khôi phục.',
      note: ADMIN_COPY.rollbackHistoryOperator?.serverSourceWarning || '',
      steps: [
        'Chọn đúng phiên bản cần xem.',
        'Xem trước nội dung trước khi thao tác.',
        'Kiểm tra khôi phục trên server.',
        'Chỉ khôi phục khi đã nhập lý do và xác nhận.',
      ],
    },
    cleanup: ADMIN_COPY.cleanup?.operatorSteps,
    settings: ADMIN_COPY.settings?.operatorSteps,
  };
  return configs[workspaceKey] || configs.dashboard || {};
}

function getWorkspaceRailStatus(workspaceKey) {
  const statuses = {
    dashboard: 'Tổng quan vận hành',
    home: 'Bản nháp',
    gate: 'Bản nháp',
    staticDraft: 'Bản nháp / công khai có kiểm tra',
    media: 'Chỉ xem',
    publish: 'Không tự ghi',
    history: 'Khôi phục có xác nhận',
    cleanup: 'Dọn có xác nhận',
    settings: 'Bản nháp',
  };
  return statuses[workspaceKey] || 'Hướng dẫn';
}

function renderWorkspaceShell(workspaceKey, sourceNode, state = {}, options = {}) {
  const tabs = getWorkspaceTabs(workspaceKey);
  const activeKey = getWorkspaceActiveTab(workspaceKey, tabs);
  const activeTab = tabs.find((tab) => tab.key === activeKey) || tabs[0];
  const pageCopy = getWorkspacePageCopy(workspaceKey);
  const stepConfig = getWorkspaceStepConfig(workspaceKey);
  const workspace = createElement('section', {
    className: `cms-admin-workspace cms-admin-workspace-${workspaceKey}`,
    dataset: { cmsWorkspace: workspaceKey },
  });
  const layout = createElement('div', { className: 'cms-admin-workspace-layout' });
  const main = createElement('div', { className: 'cms-admin-workspace-main' });
  if (!options.hideTabs) {
    main.appendChild(renderWorkspaceTabs(workspaceKey, tabs, activeKey));
  }

  const panelAttrs = options.hideTabs
    ? {
        role: 'region',
        id: `cms-admin-workspace-panel-${workspaceKey}-${activeKey}`,
        'aria-label': pageCopy.title || activeTab?.label || 'Workspace',
      }
    : {
        role: 'tabpanel',
        id: `cms-admin-workspace-panel-${workspaceKey}-${activeKey}`,
        'aria-labelledby': `cms-admin-workspace-tab-${workspaceKey}-${activeKey}`,
      };
  const panel = createElement('section', {
    className: 'cms-admin-workspace-panel',
    attrs: panelAttrs,
  });

  const customContent = typeof options.renderContent === 'function'
    ? options.renderContent({ workspaceKey, activeKey, activeTab, state })
    : null;

  if (customContent) {
    panel.appendChild(customContent);
  } else if (activeKey === tabs[0]?.key) {
    panel.appendChild(prepareWorkspaceSourceContent(sourceNode, workspaceKey));
  } else {
    panel.appendChild(renderWorkspaceSecondaryPanel(workspaceKey, activeTab, state));
  }

  main.appendChild(panel);
  layout.appendChild(main);
  if (!options.hideRail) {
    layout.appendChild(renderWorkspaceRail({ workspaceKey, pageCopy, stepConfig, status: getWorkspaceRailStatus(workspaceKey), activeTab }));
  }
  workspace.appendChild(layout);
  return workspace;
}

function renderWorkspaceTabs(workspaceKey, tabs, activeKey) {
  const tabList = createElement('div', {
    className: 'cms-admin-workspace-tabs',
    attrs: { role: 'tablist', 'aria-label': `Các vùng làm việc ${getWorkspacePageCopy(workspaceKey).title}` },
  });
  tabs.forEach((tab) => {
    const selected = tab.key === activeKey;
    const button = createElement('button', {
      className: `cms-admin-workspace-tab${selected ? ' is-active' : ''}`,
      text: tab.label,
      type: 'button',
      attrs: {
        role: 'tab',
        id: `cms-admin-workspace-tab-${workspaceKey}-${tab.key}`,
        'aria-selected': selected ? 'true' : 'false',
        'aria-controls': `cms-admin-workspace-panel-${workspaceKey}-${tab.key}`,
        tabindex: selected ? '0' : '-1',
      },
    });
    button.addEventListener('click', () => {
      if (!handleWorkspaceTabSwitch(workspaceKey, tab.key, activeKey)) return;
      renderAdminShell();
    });
    tabList.appendChild(button);
  });
  return tabList;
}

function handleWorkspaceTabSwitch(workspaceKey, tabKey, currentKey) {
  const compatibleTabKey = getCompatibleWorkspaceTabKey(workspaceKey, tabKey);
  if (compatibleTabKey === currentKey) return false;
  if (workspaceKey === 'home') return handleHomeWorkspaceTabSwitch(compatibleTabKey);
  if (workspaceKey === 'gate') return handleGateWorkspaceTabSwitch(compatibleTabKey, currentKey);
  if (workspaceKey === 'staticDraft') return handleStaticDraftWorkspaceTabSwitch(compatibleTabKey, currentKey);
  setWorkspaceTabState(workspaceKey, compatibleTabKey);
  return true;
}

function handleHomeWorkspaceTabSwitch(tabKey) {
  const validTab = getWorkspaceTabs('home').some((tab) => tab.key === tabKey);
  if (!validTab) return false;
  const currentState = getState();
  const editState = currentState.homeEdit || {};
  if (editState.isEditing && editState.editingSectionKey && editState.editingSectionKey !== tabKey) {
    if (editState.saving) {
      window.alert(getSavingBlockedMessage());
      return false;
    }
    if (editState.dirty && !window.confirm(getGlobalLeaveMessage())) return false;
    resetHomeEdit();
    closeHomeMediaPicker();
    syncBeforeUnloadGuard(getState());
  }
  setWorkspaceTabState('home', tabKey);
  return true;
}

function handleGateWorkspaceTabSwitch(tabKey, currentKey) {
  const validTab = getWorkspaceTabs('gate').some((tab) => tab.key === tabKey);
  if (!validTab) return false;
  const editState = getState().gateEdit || {};
  if (editState.isEditing && tabKey !== currentKey) {
    if (editState.saving) {
      window.alert(getSavingBlockedMessage());
      return false;
    }
    if (editState.dirty && !window.confirm(getGlobalLeaveMessage())) return false;
    resetGateEdit();
    gateEditTargetKey = '';
    syncBeforeUnloadGuard(getState());
  }
  setWorkspaceTabState('gate', tabKey);
  return true;
}

function handleStaticDraftWorkspaceTabSwitch(tabKey, currentKey) {
  const validTab = getWorkspaceTabs('staticDraft').some((tab) => tab.key === tabKey);
  if (!validTab) return false;
  const draftState = getState().staticCmsDraft || {};
  if (tabKey !== currentKey && draftState.draftJson) {
    if (draftState.isSavingDraft) {
      window.alert(getSavingBlockedMessage());
      return false;
    }
    if (draftState.dirty) {
      const shouldLeave = window.confirm(getGlobalLeaveMessage());
      if (!shouldLeave) return false;
      resetStaticCmsDraftToBaseline();
      syncBeforeUnloadGuard(getState());
    }
  }
  setWorkspaceTabState('staticDraft', tabKey);
  return true;
}

function prepareWorkspaceSourceContent(sourceNode, workspaceKey) {
  if (!sourceNode) return renderEmptyState('Chưa có nội dung để hiển thị.');
  sourceNode.classList.add('cms-admin-workspace-source-content', `cms-admin-workspace-source-${workspaceKey}`);
  Array.from(sourceNode.children || []).forEach((child) => {
    if (child.classList?.contains('cms-admin-operator-step-panel')) child.remove();
  });
  return sourceNode;
}

function renderWorkspaceSecondaryPanel(workspaceKey, tab = {}, state = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-workspace-secondary-panel' });
  panel.appendChild(renderPanelTitle(tab.label || 'Khu vực làm việc', 'Tab nội bộ'));
  if (tab.summary) panel.appendChild(renderCompactNotice(tab.summary));

  const notes = getWorkspaceSecondaryNotes(workspaceKey, tab.key, state);
  if (notes.length) {
    const list = createElement('ul', { className: 'cms-admin-workspace-note-list' });
    notes.forEach((note) => list.appendChild(createElement('li', { text: note })));
    panel.appendChild(list);
  }

  const primaryTab = getWorkspaceTabs(workspaceKey)[0];
  if (primaryTab && tab.key !== primaryTab.key) {
    const action = createElement('button', {
      className: 'cms-admin-button cms-admin-button-ghost',
      text: `Mở ${primaryTab.label}`,
      type: 'button',
    });
    action.addEventListener('click', () => {
      setWorkspaceTabState(workspaceKey, primaryTab.key);
      renderAdminShell();
    });
    const actions = createElement('div', { className: 'cms-admin-actions' });
    actions.appendChild(action);
    panel.appendChild(actions);
  }

  return panel;
}

function getWorkspaceSecondaryNotes(workspaceKey, tabKey, state = {}) {
  const shared = ['Tab này chỉ sắp xếp lại cách xem nội dung trong trình duyệt, không ghi DB/Storage.', 'Các thao tác nguy hiểm vẫn cần đúng màn, đúng quyền và xác nhận rõ ràng.'];
  const notesByKey = {
    dashboard: {
      workspace: ['Tổng quan chỉ xem thông tin, không tự lưu hay công khai.', 'Mở đúng màn bên dưới khi cần chỉnh nội dung.'],
    },
    home: {
      hero: ['Khu vực đầu trang là phần người xem thấy đầu tiên.', 'Sửa Hero chỉ lưu bản nháp CMS, chưa làm đổi website.'],
      experience: ['Khu vực trải nghiệm chỉ hiển thị nội dung của section experience.', 'Mã phòng và route kỹ thuật không đổi ở tab này.'],
      guide: ['Hướng dẫn tham quan chỉ hiển thị nội dung của section guide.', 'Danh sách/nội dung con được giữ theo dữ liệu hiện có.'],
      contact: ['Thông tin liên hệ là dữ liệu tiện ích để đối chiếu.', 'Muốn sửa liên hệ chính thức thì mở màn Thông tin website.'],
    },
    gate: {
      intro: ['Màn chào chỉ hiển thị nội dung người xem đọc trước khi chọn không gian.', 'Sửa Màn chào chỉ lưu bản nháp CMS, chưa làm đổi website.'],
      indoor: ['Không gian trong nhà chỉ hiển thị dữ liệu phòng indoor.', 'Đường dẫn kỹ thuật được giữ trong phần đối chiếu phụ.'],
      outdoor: ['Không gian ngoài trời chỉ hiển thị dữ liệu phòng outdoor.', 'Đường dẫn kỹ thuật được giữ trong phần đối chiếu phụ.'],
    },
    staticDraft: {
      indoor: ['Tab này chỉ hiển thị item thuộc phòng trong nhà.', 'Chọn item cần sửa trong danh sách indoor; lưu bản nháp chưa làm đổi website.'],
      outdoor: ['Tab này chỉ hiển thị item thuộc phòng ngoài trời.', 'Chọn item cần sửa trong danh sách outdoor; lưu bản nháp chưa làm đổi website.'],
      featured: ['Tab này chỉ hiển thị dữ liệu index.featuredArtworks.', 'Đây là nội dung nổi bật trên Trang chủ/Intro, không phải danh sách item canonical của phòng.'],
    },
    media: {
      usage: ['Dữ liệu tham chiếu cho biết media đang xuất hiện ở đâu trong CMS.', 'Trạng thái này không tự kết luận vòng đời media nếu thiếu dữ liệu.'],
      details: ['URL, storage path và metadata dài được hiển thị theo luồng hiện có.', 'Sao chép/xem trước không làm đổi website.'],
    },
    publish: {
      check: ADMIN_COPY.publish?.requirements || shared,
      publish: ADMIN_COPY.publish?.disabledReasons || shared,
      history: ['Mở Lịch sử phiên bản nếu cần kiểm tra bản đã công khai hoặc khôi phục.', 'Màn này không tự gọi publish/rollback.'],
    },
    history: {
      workspace: ['Chọn phiên bản, preview, kiểm tra khôi phục và nhập lý do trong một workspace liền mạch.', 'Không có rollback khi chỉ mở màn hoặc chuyển vùng xem.'],
    },
    cleanup: {
      results: ['Bảng kết quả có thể cuộn ngang bên trong bảng nếu dữ liệu dài.', 'Chỉ đọc kết quả scan/check; không tự xóa tệp.'],
      confirm: ['Dọn dẹp thật chỉ thực hiện khi có feature flag, quyền admin và cụm xác nhận hợp lệ.', 'Không có auto-delete khi chuyển tab.'],
    },
    settings: {
      edit: ['Chỉnh sửa thông tin website chỉ lưu bản nháp CMS.', 'Website vẫn cần công khai bản đã lưu để thay đổi public.'],
      identity: ['Thông tin hiển thị chỉ gồm tên, đơn vị, liên hệ và ngôn ngữ.', 'Các field legacy không thuộc thao tác operator ở màn này.'],
      details: ['Trạng thái quản trị và dữ liệu kỹ thuật dùng để hỗ trợ vận hành, không phải nội dung chính.'],
    },
  };
  return notesByKey[workspaceKey]?.[tabKey] || shared;
}

function getWorkspaceRailGuidance(workspaceKey, tabKey, pageCopy = {}, stepConfig = {}) {
  const defaults = {
    title: pageCopy.title || 'Màn CMS',
    status: getWorkspaceRailStatus(workspaceKey),
    summary: pageCopy.subtitle || 'Xem nội dung chính, kiểm tra trạng thái rồi thao tác theo quyền hiện có.',
    checklistTitle: 'Bước an toàn tiếp theo',
    steps: safeArray(stepConfig.steps).slice(0, 4),
    note: stepConfig.note || 'Chuyển tab nội bộ chỉ đổi vùng xem, không tự ghi dữ liệu.',
  };

  const guidance = {
    dashboard: {
      workspace: {
        title: 'Tổng quan website',
        status: 'Chỉ xem',
        summary: 'Một màn duy nhất để xem website đang ổn hay cần kiểm tra.',
        steps: ['Đọc trạng thái website.', 'Xem số liệu và cảnh báo chính.', 'Mở màn liên quan nếu cần chỉnh nội dung.'],
      },
    },
    home: {
      hero: {
        title: 'Bạn đang xem Khu vực đầu trang',
        status: 'Quan trọng nhất',
        summary: 'Đây là phần người xem thấy đầu tiên khi mở website. Kiểm tra tiêu đề, mô tả, media và nút trước khi công khai.',
        steps: ['Đọc nội dung người xem thấy đầu tiên.', 'Kiểm tra ảnh/video và nút trong khu vực này.', 'Sửa Hero nếu nội dung chính còn thiếu.'],
      },
      experience: {
        title: 'Bạn đang xem Khu vực trải nghiệm',
        status: 'Phụ trợ',
        summary: 'Phần này giới thiệu cảm giác tham quan và giá trị của triển lãm, không lặp nội dung đầu trang.',
        steps: ['Đọc tiêu đề và mô tả trải nghiệm.', 'Kiểm tra media hoặc nút nếu có.', 'Sửa khu vực này nếu nội dung chưa rõ.'],
      },
      guide: {
        title: 'Bạn đang xem Hướng dẫn tham quan',
        status: 'Phụ trợ',
        summary: 'Phần này giúp người xem biết cách bắt đầu và đi tiếp trong website triển lãm.',
        steps: ['Đọc hướng dẫn chính.', 'Kiểm tra danh sách hoặc nội dung con nếu có.', 'Sửa hướng dẫn nếu chữ chưa rõ.'],
      },
      contact: {
        title: 'Bạn đang xem Thông tin liên hệ',
        status: 'Tham chiếu',
        summary: 'Đây là dữ liệu tiện ích. Thông tin liên hệ chính thức được quản lý ở màn Thông tin website.',
        steps: ['Đối chiếu thông tin liên hệ.', 'Mở Thông tin website nếu cần cập nhật.', 'Không tạo form liên hệ mới ở Trang chủ.'],
      },
    },
    gate: {
      intro: {
        title: 'Bạn đang xem Màn chào',
        status: 'Trước khi chọn không gian',
        summary: 'Kiểm tra nhãn nhỏ, tiêu đề, mô tả và nhãn quay lại Trang chủ mà người xem đọc trước khi vào phòng.',
        steps: ['Đọc tiêu đề và mô tả chính.', 'Kiểm tra nhãn quay lại Trang chủ.', 'Sửa Màn chào nếu nội dung chưa rõ.'],
      },
      indoor: {
        title: 'Bạn đang xem Không gian trong nhà',
        status: 'Phòng indoor',
        summary: 'Chỉ kiểm tra tên, mô tả và nút vào phòng trong nhà. Đường dẫn kỹ thuật chỉ để đối chiếu.',
        steps: ['Kiểm tra tên hiển thị indoor.', 'Kiểm tra mô tả phòng trong nhà.', 'Sửa Không gian trong nhà nếu chữ chưa đúng.'],
      },
      outdoor: {
        title: 'Bạn đang xem Không gian ngoài trời',
        status: 'Phòng outdoor',
        summary: 'Chỉ kiểm tra tên, mô tả và nút vào phòng ngoài trời. Đường dẫn kỹ thuật chỉ để đối chiếu.',
        steps: ['Kiểm tra tên hiển thị outdoor.', 'Kiểm tra mô tả phòng ngoài trời.', 'Sửa Không gian ngoài trời nếu chữ chưa đúng.'],
      },
    },
    staticDraft: {
      indoor: {
        title: 'Bạn đang xem Phòng trong nhà',
        status: 'Room indoor',
        summary: 'Chỉ xem danh sách item và nội dung thuộc phòng trong nhà. Chọn item cần sửa, kiểm tra chữ/media trong đúng ngữ cảnh phòng này.',
        steps: ['Kiểm tra danh sách item indoor.', 'Chọn item cần sửa.', 'Sửa bản nháp nếu chữ hoặc media chưa đúng.', 'Lưu bản nháp chưa làm đổi website.'],
      },
      outdoor: {
        title: 'Bạn đang xem Phòng ngoài trời',
        status: 'Room outdoor',
        summary: 'Chỉ xem danh sách item và nội dung thuộc phòng ngoài trời. Chọn item cần sửa, kiểm tra chữ/media trong đúng ngữ cảnh phòng này.',
        steps: ['Kiểm tra danh sách item outdoor.', 'Chọn item cần sửa.', 'Sửa bản nháp nếu chữ hoặc media chưa đúng.', 'Lưu bản nháp chưa làm đổi website.'],
      },
      featured: {
        title: 'Bạn đang xem Tác phẩm tiêu biểu',
        status: 'index.featuredArtworks',
        summary: 'Đây là nội dung nổi bật trên Trang chủ/Intro. Dữ liệu có thể tham chiếu tác phẩm/phòng nhưng owner là index.featuredArtworks, không phải rooms.indoor/outdoor.artworks.',
        steps: ['Kiểm tra tiêu đề và mô tả khu vực tiêu biểu.', 'Kiểm tra từng mục tiêu biểu, ảnh, room và artworkId nếu có.', 'Sửa bản nháp khi item tiêu biểu thiếu chữ hoặc ảnh.', 'Lưu bản nháp chưa làm đổi website.'],
      },
    },

    history: {
      workspace: {
        title: 'Bạn đang xem Lịch sử phiên bản',
        status: 'Rollback có kiểm soát',
        summary: 'Workspace này gom danh sách, preview, dry-run rollback, lý do xác nhận và audit trong cùng màn. Chọn phiên bản không tự thay đổi website.',
        steps: ['Chọn đúng phiên bản cần xem.', 'Xem preview đọc-only.', 'Chạy dry-run rollback trên server.', 'Chỉ khôi phục khi đã nhập lý do và xác nhận rõ.'],
      },
    },
  };

  return { ...defaults, ...(guidance[workspaceKey]?.[tabKey] || {}) };
}

function renderWorkspaceRail({ workspaceKey, pageCopy = {}, stepConfig = {}, status = '', activeTab = {} } = {}) {
  const activeKey = activeTab?.key || '';
  const tabGuidance = getWorkspaceRailGuidance(workspaceKey, activeKey, pageCopy, stepConfig);
  const rail = createElement('aside', { className: 'cms-admin-workspace-rail', attrs: { 'aria-label': `Hướng dẫn vận hành ${pageCopy.title || ''}` } });
  const card = createElement('section', { className: 'cms-admin-rail-card cms-admin-rail-status' });
  card.appendChild(renderPanelTitle(tabGuidance.title || pageCopy.title || 'Màn CMS', tabGuidance.status || status));
  if (tabGuidance.summary) card.appendChild(createElement('p', { className: 'cms-admin-help-text', text: tabGuidance.summary }));
  if (activeTab?.label) card.appendChild(renderCompactNotice(`Tab hiện tại: ${activeTab.label}.`));
  rail.appendChild(card);

  const checklist = createElement('section', { className: 'cms-admin-rail-card cms-admin-rail-checklist' });
  checklist.appendChild(renderPanelTitle(tabGuidance.checklistTitle || stepConfig.title || 'Bước an toàn tiếp theo', 'Gợi ý'));
  const steps = safeArray(tabGuidance.steps).length ? safeArray(tabGuidance.steps) : safeArray(stepConfig.steps).slice(0, 4);
  const list = createElement('ol', { className: 'cms-admin-rail-step-list' });
  steps.slice(0, 4).forEach((step, index) => {
    const item = createElement('li');
    item.appendChild(createElement('span', { className: 'cms-admin-rail-step-number', text: String(index + 1) }));
    item.appendChild(createElement('span', { text: typeof step === 'string' ? step : step?.label || `Bước ${index + 1}` }));
    list.appendChild(item);
  });
  if (!steps.length) list.appendChild(createElement('li', { text: 'Xem nội dung chính, kiểm tra trạng thái rồi thao tác theo quyền hiện có.' }));
  checklist.appendChild(list);
  if (tabGuidance.note) checklist.appendChild(createElement('p', { className: 'cms-admin-operator-step-note', text: tabGuidance.note }));
  rail.appendChild(checklist);

  const safety = createElement('section', { className: 'cms-admin-rail-card cms-admin-rail-safety' });
  safety.appendChild(renderPanelTitle('Giới hạn an toàn', 'Không tự ghi'));
  const safetyItems = [
    'Chuyển tab nội bộ không công khai, không khôi phục, không dọn tệp.',
    'Website chỉ thay đổi ở các thao tác đã có xác nhận rõ.',
    'Chi tiết kỹ thuật chỉ dùng để đối chiếu khi cần.',
  ];
  const safetyList = createElement('ul', { className: 'cms-admin-workspace-note-list' });
  safetyItems.forEach((item) => safetyList.appendChild(createElement('li', { text: item })));
  safety.appendChild(safetyList);
  rail.appendChild(safety);
  return rail;
}


function renderWorkspaceSlotWrap(workspaceKey, activeKey) {
  return createElement('section', {
    className: `cms-admin-grid cms-admin-workspace-real-content cms-admin-workspace-real-${workspaceKey} cms-admin-workspace-real-${workspaceKey}-${activeKey}`,
    dataset: { cmsWorkspaceSlot: activeKey },
  });
}

function renderOperatorIntroPanel({ title, summary, status = '', items = [] } = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-operator-intro-panel' });
  panel.appendChild(renderPanelTitle(title || 'Việc cần xem', status));
  if (summary) panel.appendChild(createElement('p', { className: 'cms-admin-operator-summary', text: summary }));
  const normalizedItems = safeArray(items).filter((item) => !isBlank(item));
  if (normalizedItems.length) {
    const list = createElement('ul', { className: 'cms-admin-operator-bullet-list' });
    normalizedItems.forEach((item) => list.appendChild(createElement('li', { text: item })));
    panel.appendChild(list);
  }
  return panel;
}

function renderTechnicalSourceNote(label, value) {
  const note = createElement('div', { className: 'cms-admin-technical-source-note' });
  note.appendChild(createElement('span', { text: label || 'Nguồn kỹ thuật' }));
  note.appendChild(createElement('strong', { text: value || 'Không rõ' }));
  return note;
}

function renderOperatorSectionSummary(section, copy = ADMIN_COPY.contentViews.home) {
  const rows = filterVisibleRows([
    ['Người xem thấy tiêu đề', section?.title],
    ['Nội dung mô tả', section?.subtitle || section?.lead || section?.body],
    ['Trạng thái hiển thị', getVisibleLabel(section?.is_visible)],
  ]);
  return rows.length ? renderKeyValueList(rows) : renderEmptyState('Phần này chưa có nội dung hiển thị rõ ràng.');
}

function renderHomeOperatorSectionCard(section, copy, state, editState = {}) {
  const key = section?.section_key || 'section';
  const card = createElement('article', {
    className: 'cms-admin-data-card cms-admin-operator-section-card',
    dataset: {
      cmsReferenceTarget: key === 'hero' ? 'home-hero' : key === 'guide' ? 'home-guide' : key === 'experience' ? 'home-experience' : key === 'contact' ? 'home-contact' : 'home-section',
      cmsReferenceId: key,
    },
  });
  card.appendChild(renderDataCardTitle(copy.sectionLabels?.[key] || key, getVisibleLabel(section?.is_visible)));
  card.appendChild(createElement('p', {
    className: 'cms-admin-operator-summary',
    text: getHomeSectionOperatorHint(key),
  }));
  card.appendChild(renderDataGroup('Người xem sẽ thấy', renderOperatorSectionSummary(section, copy)));

  const missingFields = getMissingIndexSectionFields(section, copy);
  if (missingFields.length) {
    card.appendChild(renderMissingFieldsNotice('Cần bổ sung', missingFields));
  }

  const ctaNode = renderCtaSummary(section?.cta_json, copy);
  const mediaNode = renderMediaSummary(section?.media_json, copy);
  if (ctaNode || mediaNode) {
    const meta = createElement('div', { className: 'cms-admin-operator-secondary-stack' });
    if (ctaNode) meta.appendChild(renderDataGroup('Nút hoặc liên kết đang dùng', ctaNode));
    if (mediaNode) meta.appendChild(renderDataGroup('Ảnh/video liên quan', mediaNode));
    card.appendChild(meta);
  }

  if (key === 'hero' && !editState.isEditing) card.appendChild(renderHomeHeroEditActions(state, section));
  if (key === 'guide' && !editState.isEditing) card.appendChild(renderHomeGuideEditActions(state, section));
  if (key === 'experience' && !editState.isEditing) card.appendChild(renderHomeExperienceEditActions(state, section));
  if (key === 'contact') card.appendChild(renderHomeContactSourceOfTruthBlock(state, section, copy));
  return card;
}

function getHomeSectionOperatorHint(sectionKey) {
  const hints = {
    hero: 'Khu vực đầu trang là phần người xem nhìn thấy đầu tiên.',
    experience: 'Khu vực trải nghiệm giới thiệu hướng tham quan và cảm giác triển lãm.',
    guide: 'Hướng dẫn tham quan giúp người xem hiểu cách bắt đầu.',
    contact: 'Thông tin liên hệ giúp người xem biết đơn vị quản lý và cách liên hệ.',
  };
  return hints[sectionKey] || 'Phần nội dung này đang được đọc từ bản nháp CMS.';
}

function renderGateOperatorMainCard(gate, copy = ADMIN_COPY.contentViews.gate) {
  const card = createElement('section', {
    className: 'cms-admin-data-card cms-admin-gate-main-card cms-admin-operator-section-card',
    dataset: { cmsReferenceTarget: 'gate', cmsReferenceId: 'gate' },
  });
  card.appendChild(renderDataCardTitle('Màn vào triển lãm người xem nhìn thấy gì', gate.is_active ? ADMIN_COPY.maps.status.active : ADMIN_COPY.maps.status.inactive));
  card.appendChild(createElement('p', {
    className: 'cms-admin-operator-summary',
    text: 'Đây là màn chọn không gian trước khi người xem vào phòng trưng bày.',
  }));
  card.appendChild(renderDataGroup('Nội dung hiển thị', renderKeyValueList(filterVisibleRows([
    ['Nhãn nhỏ', gate.eyebrow],
    ['Tiêu đề cổng vào', gate.title],
    ['Mô tả hướng dẫn', gate.description],
    ['Nhãn quay lại Trang chủ', gate.back_label],
  ]))));
  return card;
}

function renderGateOperatorRoomCard(roomKey, roomData, copy = ADMIN_COPY.contentViews.gate) {
  const room = normalizePlainObject(roomData);
  const card = createElement('article', { className: 'cms-admin-data-card cms-admin-gate-room-card cms-admin-operator-section-card' });
  card.appendChild(renderDataCardTitle(getRoomLabel(roomKey), roomKey === 'indoor' ? 'Trong nhà' : roomKey === 'outdoor' ? 'Ngoài trời' : 'Không gian'));
  const roomCtaLabel = getGateRoomCtaLabel(room);
  card.appendChild(renderDataGroup('Người xem sẽ thấy', renderKeyValueList(filterVisibleRows([
    ['Tên hiển thị', firstText(room, ['label', 'title', 'name'])],
    ['Mô tả ngắn', firstText(room, ['description', 'lead', 'subtitle'])],
    ['Nút bắt đầu tham quan', roomCtaLabel],
  ]))));
  if (isBlank(roomCtaLabel)) {
    card.appendChild(renderCompactNotice('Nút bắt đầu tham quan chưa được khai báo rõ.'));
  }
  card.appendChild(renderTechnicalSourceNote('Mã kỹ thuật', roomKey));
  return card;
}

function renderDashboardWorkspaceContent(state) {
  return renderDashboardCommandCenter(state);
}

function renderDashboardCommandCenter(state) {
  const data = state.data || {};
  const rooms = safeArray(data.rooms);
  const artworks = safeArray(data.artworks);
  const artworkStats = data.artworkStats || {};
  const bundles = safeArray(data.publishedBundles);
  const mediaAssets = safeArray(data.mediaAssets);
  const errors = data.errors || {};
  const published = getCurrentPublishedBundle(bundles);
  const publicContentSummary = data['can' + 'onicalSummary']?.valid ? data['can' + 'onicalSummary'] : null;
  const dashboardSummary = publicContentSummary || buildDbFallbackDashboardSummary(data, { sourceLabel: ADMIN_COPY.dashboard.status['fall' + 'backSource'] });
  const usingPublicContent = Boolean(publicContentSummary);
  const warningMessages = usingPublicContent
    ? safeArray(dashboardSummary.warnings)
    : getWarningItems(artworks).map(formatDashboardWarningItem);
  const warningCount = dashboardSummary.warningCount || warningMessages.length || 0;
  const hasReadErrors = Object.keys(errors).length > 0 || Number(dashboardSummary.errorCount || 0) > 0;
  const needsAttention = hasReadErrors || warningCount > 0;
  const metrics = {
    rooms: usingPublicContent ? dashboardSummary.roomCount : rooms.length,
    artworks: usingPublicContent ? dashboardSummary.totalRoomItems : (artworkStats.total ?? artworks.length),
    indoor: usingPublicContent ? dashboardSummary.indoorCount : (artworkStats.indoor ?? 0),
    outdoor: usingPublicContent ? dashboardSummary.outdoorCount : (artworkStats.outdoor ?? 0),
    media: usingPublicContent ? dashboardSummary.mediaPresentCount : mediaAssets.length,
    featured: usingPublicContent ? dashboardSummary.featuredVisibleCount : undefined,
    warningCount,
  };

  const wrap = createElement('section', { className: 'cms-admin-grid cms-admin-dashboard-command-center' });

  if (Object.keys(errors).length > 0) {
    wrap.appendChild(renderSystemErrors(errors));
  }

  wrap.appendChild(renderDashboardStatusHero({
    published,
    dashboardSummary,
    usingPublicContent,
    needsAttention,
    hasReadErrors,
    warningCount,
    publicReadError: data['can' + 'onicalError'],
  }));
  wrap.appendChild(renderDashboardSummaryCards(metrics));

  const main = createElement('div', { className: 'cms-admin-dashboard-command-grid' });
  main.appendChild(renderDashboardAttentionPanel({
    needsAttention,
    hasReadErrors,
    warningCount,
    warningMessages,
    errors,
  }));
  main.appendChild(renderDashboardFastActionsPanel());
  wrap.appendChild(main);
  wrap.appendChild(renderDashboardReferenceDetails({
    published,
    siteSettings: data.siteSettings,
    dashboardSummary,
    usingPublicContent,
    publicReadError: data['can' + 'onicalError'],
  }));
  return wrap;
}

function renderDashboardStatusHero({ published, dashboardSummary = {}, usingPublicContent = false, needsAttention = false, hasReadErrors = false, warningCount = 0, publicReadError = null } = {}) {
  const copy = ADMIN_COPY.dashboard.commandCenter || {};
  const statusLabel = needsAttention ? (copy.needsAttention || 'Cần kiểm tra') : (copy.statusOk || 'Đang ổn');
  const sourceLabel = usingPublicContent ? (copy.publicSource || 'Nội dung website đang dùng') : (copy.cmsSource || 'Dữ liệu đối chiếu trong CMS');
  const hero = createElement('section', {
    className: `cms-admin-panel cms-admin-dashboard-hero${needsAttention ? ' is-warning' : ' is-ok'}`,
    attrs: { 'aria-label': copy.heroAria || 'Tổng quan trạng thái website' },
  });
  const header = createElement('div', { className: 'cms-admin-dashboard-hero-header' });
  const titleWrap = createElement('div');
  titleWrap.appendChild(createElement('p', { className: 'cms-admin-eyebrow', text: copy.eyebrow || 'Tổng quan vận hành' }));
  titleWrap.appendChild(createElement('h3', { text: copy.heroTitle || 'Website đang chạy' }));
  titleWrap.appendChild(createElement('p', {
    className: 'cms-admin-dashboard-hero-lead',
    text: needsAttention
      ? (copy.heroWarning || 'Có nội dung cần xem lại trước khi công khai bản mới.')
      : (copy.heroOk || 'Chưa thấy vấn đề lớn trong dữ liệu đang đọc.'),
  }));
  const badges = createElement('div', { className: 'cms-admin-dashboard-hero-badges' });
  badges.appendChild(renderBadge(statusLabel, needsAttention ? 'warning' : 'success'));
  badges.appendChild(renderBadge(copy.readOnly || 'Chỉ xem', 'info'));
  appendChildren(header, [titleWrap, badges]);
  hero.appendChild(header);

  const facts = createElement('div', { className: 'cms-admin-dashboard-hero-facts' });
  const publishedTime = published?.published_at || published?.created_at;
  [
    [copy.version || 'Phiên bản đang dùng', dashboardSummary.version || published?.version || 'Chưa xác định'],
    [copy.updatedAt || 'Lần cập nhật gần nhất', formatDateTime(publishedTime)],
    [copy.source || 'Nguồn đang đọc', sourceLabel],
    [copy.alerts || 'Cần kiểm tra', warningCount ? `${formatCount(warningCount)} mục` : (hasReadErrors ? 'Có lỗi đọc dữ liệu' : 'Không')],
  ].forEach(([label, value]) => facts.appendChild(renderDashboardHeroFact(label, value)));
  hero.appendChild(facts);

  const noteText = hasReadErrors && publicReadError
    ? `${copy.readOnlyNote || 'Màn này chỉ xem thông tin. Website chỉ thay đổi khi bạn lưu/công khai ở màn riêng.'} Một nguồn dữ liệu cần kiểm tra lại.`
    : (copy.readOnlyNote || 'Màn này chỉ xem thông tin. Website chỉ thay đổi khi bạn lưu/công khai ở màn riêng.');
  hero.appendChild(createElement('p', { className: 'cms-admin-dashboard-hero-note', text: noteText }));
  return hero;
}

function renderDashboardHeroFact(label, value) {
  const item = createElement('div', { className: 'cms-admin-dashboard-hero-fact' });
  item.appendChild(createElement('span', { text: label }));
  item.appendChild(createElement('strong', { text: toDisplayText(value) }));
  return item;
}

function renderDashboardSummaryCards(metrics = {}) {
  const copy = ADMIN_COPY.dashboard.metrics;
  const cards = createElement('section', { className: 'cms-admin-dashboard-summary-cards', attrs: { 'aria-label': 'Số liệu nội dung chính' } });
  const entries = [
    [copy.rooms, metrics.rooms, 'Khu vực tham quan đang có trong dữ liệu.'],
    [copy.artworks, metrics.artworks, 'Tổng nội dung trưng bày chính.'],
    [copy.media, metrics.media, 'Ảnh/video đang đọc được.'],
    ['Cần kiểm tra', metrics.warningCount || 0, metrics.warningCount ? 'Có nội dung nên xem lại.' : 'Chưa thấy cảnh báo chính.'],
  ];
  if (metrics.featured !== undefined) entries.push([copy.featured, metrics.featured, 'Mục nổi bật trên trang giới thiệu.']);
  entries.forEach(([label, value, note]) => cards.appendChild(renderDashboardSummaryCard(label, value, note, label === 'Cần kiểm tra' && Number(value) > 0)));
  return cards;
}

function renderDashboardSummaryCard(label, value, note, warning = false) {
  const card = createElement('article', { className: `cms-admin-dashboard-summary-card${warning ? ' is-warning' : ''}` });
  card.appendChild(createElement('span', { className: 'cms-admin-dashboard-summary-label', text: label }));
  card.appendChild(createElement('strong', { className: 'cms-admin-dashboard-summary-value', text: formatCount(value || 0) }));
  card.appendChild(createElement('p', { text: note || '' }));
  return card;
}

function renderDashboardAttentionPanel({ needsAttention = false, hasReadErrors = false, warningCount = 0, warningMessages = [], errors = {} } = {}) {
  const copy = ADMIN_COPY.dashboard.tasks;
  const panel = createElement('section', { className: `cms-admin-panel cms-admin-dashboard-attention-panel${needsAttention ? ' is-warning' : ' is-ok'}` });
  panel.appendChild(renderPanelTitle('Cần kiểm tra', needsAttention ? 'Có việc cần xem' : 'Đang ổn'));

  if (!needsAttention) {
    panel.appendChild(createElement('p', { className: 'cms-admin-dashboard-attention-good', text: 'Chưa thấy việc cần xử lý ngay.' }));
    panel.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Bạn có thể mở nhanh các màn bên cạnh để chỉnh nội dung khi cần.' }));
    return panel;
  }

  const list = createElement('div', { className: 'cms-admin-dashboard-attention-list' });
  if (hasReadErrors) {
    list.appendChild(renderDashboardAttentionItem('Một số dữ liệu chưa đọc được', 'Hãy kiểm tra kết nối hoặc quyền xem dữ liệu trước khi công khai bản mới.', 'publish'));
  }
  safeArray(warningMessages).slice(0, 3).forEach((message) => {
    list.appendChild(renderDashboardAttentionItem('Nội dung cần xem lại', message, 'staticDraft'));
  });
  if (!list.children.length && warningCount) {
    list.appendChild(renderDashboardAttentionItem('Có nội dung cần kiểm tra', `${formatCount(warningCount)} mục nên được xem lại trước khi công khai.`, 'staticDraft'));
  }
  panel.appendChild(list);
  panel.appendChild(createElement('p', { className: 'cms-admin-help-text', text: copy.warningHint || 'Mở màn liên quan để kiểm tra nội dung. Màn Tổng quan không tự ghi dữ liệu.' }));
  return panel;
}

function renderDashboardAttentionItem(title, body, targetTab = '') {
  const item = createElement('article', { className: 'cms-admin-dashboard-attention-item' });
  const text = createElement('div');
  text.appendChild(createElement('strong', { text: title }));
  text.appendChild(createElement('p', { text: body }));
  item.appendChild(text);
  if (targetTab) {
    const button = createElement('button', { className: 'cms-admin-button cms-admin-button-secondary cms-admin-mini-action', type: 'button', text: targetTab === 'publish' ? 'Mở màn kiểm tra' : 'Mở nội dung' });
    button.addEventListener('click', () => switchAdminTab(targetTab));
    item.appendChild(button);
  }
  return item;
}

function renderDashboardFastActionsPanel() {
  const copy = ADMIN_COPY.dashboard.quickActions;
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-dashboard-fast-actions-panel' });
  panel.appendChild(renderPanelTitle(copy.title || 'Đi nhanh'));
  panel.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Mở màn cần chỉnh. Các nút này chỉ điều hướng, không tự lưu hay công khai.' }));
  const grid = createElement('div', { className: 'cms-admin-dashboard-fast-action-grid' });
  const actions = [
    ...(safeArray(copy.actions)),
    { key: 'media', label: 'Mở Ảnh & video', note: 'Xem thư viện ảnh/video đang có' },
    { key: 'publish', label: 'Mở Đưa website lên bản mới', note: 'Kiểm tra trước khi công khai ở màn riêng' },
  ];
  actions.forEach((action) => grid.appendChild(renderDashboardNavigationAction(action)));
  const website = createElement('a', {
    className: 'cms-admin-quick-action-card cms-admin-quick-action-card-link',
    href: './index.html',
    attrs: { target: '_blank', rel: 'noopener' },
  });
  website.appendChild(createElement('strong', { text: copy.website?.label || 'Xem website public' }));
  website.appendChild(createElement('span', { text: copy.website?.note || 'Mở trang đang chạy trong tab mới' }));
  grid.appendChild(website);
  panel.appendChild(grid);
  return panel;
}

function renderDashboardNavigationAction(action = {}) {
  const button = createElement('button', {
    className: 'cms-admin-quick-action-card',
    type: 'button',
  });
  button.appendChild(createElement('strong', { text: action.label || 'Mở màn' }));
  button.appendChild(createElement('span', { text: action.note || 'Chỉ điều hướng' }));
  button.addEventListener('click', () => switchAdminTab(action.key));
  return button;
}

function renderDashboardReferenceDetails({ published, siteSettings, dashboardSummary = {}, usingPublicContent = false, publicReadError = null } = {}) {
  const details = createElement('details', { className: 'cms-admin-dashboard-reference-details' });
  details.appendChild(createElement('summary', { text: 'Nguồn đối chiếu & chi tiết kỹ thuật' }));
  details.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Chỉ mở phần này khi cần kiểm tra sâu nguồn dữ liệu và bản đã công khai.' }));
  const grid = createElement('div', { className: 'cms-admin-dashboard-reference-detail-grid' });
  const sourceRows = [
    ['Nguồn đang đọc', usingPublicContent ? 'Nội dung website đang dùng' : 'Dữ liệu đối chiếu trong CMS'],
    ['Mã nguồn kỹ thuật', dashboardSummary.sourceLabel || dashboardSummary.source || '—'],
    ['Phiên bản', dashboardSummary.version || published?.version || '—'],
    ['Schema', dashboardSummary.schemaVersion || published?.schema_version || '—'],
    ['Cảnh báo', formatCount(dashboardSummary.warningCount || 0)],
  ];
  if (publicReadError) sourceRows.push(['Ghi chú nguồn đọc', normalizeErrorMessage(publicReadError)]);
  grid.appendChild(renderDashboardDetailBlock('Nguồn đối chiếu', sourceRows));
  grid.appendChild(renderDashboardDetailBlock('Bản đã công khai gần nhất', [
    ['Phiên bản', published?.version || '—'],
    ['Trạng thái', getStatusLabel(published?.status)],
    ['Thời điểm công khai', formatDateTime(published?.published_at)],
    ['Thời điểm tạo', formatDateTime(published?.created_at)],
  ]));
  grid.appendChild(renderDashboardDetailBlock('Thông tin website', [
    ['Tên website', siteSettings?.site_title || '—'],
    ['Đơn vị quản lý', siteSettings?.organization_name || '—'],
    ['Trạng thái CMS', getStatusLabel(siteSettings?.site_status)],
    ['Ngôn ngữ', siteSettings?.default_language || '—'],
  ]));
  details.appendChild(grid);
  return details;
}

function renderDashboardDetailBlock(title, rows = []) {
  const section = createElement('section', { className: 'cms-admin-dashboard-detail-block' });
  section.appendChild(createElement('h4', { text: title }));
  section.appendChild(renderTechnicalKeyValueList(rows));
  return section;
}

function formatDashboardWarningItem(item = {}) {
  const label = item.title || item.name || item.artwork_code || item.id || 'Một nội dung';
  return `${label} cần kiểm tra lại thông tin hoặc ảnh/video.`;
}

function renderHomeWorkspaceContent(state, activeKey = 'hero') {
  const copy = ADMIN_COPY.contentViews.home;
  const sections = safeArray(state.data.indexSections);
  const editState = state.homeEdit || {};
  const normalizedActiveKey = getHomeWorkspaceSectionKey(activeKey);
  const wrap = renderWorkspaceSlotWrap('home', normalizedActiveKey);

  if (editState.saveSuccess && !editState.isEditing) {
    wrap.appendChild(renderNoticeBox(editState.saveSuccess, 'success'));
  }

  if (!sections.length) {
    const emptyPanel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel' });
    emptyPanel.appendChild(renderPanelTitle('Chưa đọc được Trang chủ', 'Thiếu dữ liệu'));
    emptyPanel.appendChild(renderEmptyState(`${copy.emptyTitle}. ${copy.emptyBody}`));
    emptyPanel.appendChild(renderTechnicalSourceNote('Nguồn kỹ thuật phụ', 'CMS index_sections'));
    wrap.appendChild(emptyPanel);
    return wrap;
  }

  wrap.appendChild(renderHomeSectionWorkspacePanel(state, sections, normalizedActiveKey, copy, editState));
  return wrap;
}

function getHomeWorkspaceSectionKey(activeKey = 'hero') {
  const key = String(activeKey || 'hero');
  return ['hero', 'experience', 'guide', 'contact'].includes(key) ? key : 'hero';
}

function getHomeSectionsByRole(sections = []) {
  const normalized = safeArray(sections);
  const findByKey = (key) => normalized.find((section) => section?.section_key === key) || null;
  return {
    hero: findByKey('hero'),
    experience: findByKey('experience'),
    guide: findByKey('guide'),
    contact: findByKey('contact'),
    other: normalized.filter((section) => !['hero', 'experience', 'guide', 'contact'].includes(section?.section_key)),
  };
}

function getHomeSectionPriorityMeta(sectionKey) {
  const meta = {
    hero: {
      label: 'Khu vực đầu trang',
      badge: 'Quan trọng nhất',
      role: 'Phần người xem thấy đầu tiên khi mở website.',
      focus: 'Tiêu đề, mô tả, ảnh/video giới thiệu và nút kêu gọi hành động phải rõ trước khi công khai.',
      technical: 'CMS index_sections.section_key = hero',
    },
    experience: {
      label: 'Khu vực trải nghiệm',
      badge: 'Phụ trợ',
      role: 'Giới thiệu cảm giác tham quan và giá trị của triển lãm.',
      focus: 'Nội dung nên giúp người xem hiểu hành trình hoặc điểm nhấn trước khi vào phòng trưng bày.',
      technical: 'CMS index_sections.section_key = experience',
    },
    guide: {
      label: 'Hướng dẫn tham quan',
      badge: 'Phụ trợ',
      role: 'Giúp người xem biết cách bắt đầu và đi tiếp.',
      focus: 'Các bước hướng dẫn phải ngắn, rõ và không làm người xem lạc hướng.',
      technical: 'CMS index_sections.section_key = guide',
    },
    contact: {
      label: 'Liên hệ tham chiếu',
      badge: 'Tham chiếu',
      role: 'Thông tin đơn vị quản lý và liên hệ hỗ trợ.',
      focus: 'Đây là dữ liệu tiện ích. Thông tin liên hệ chính thức được chỉnh ở màn Thông tin website.',
      technical: 'CMS index_sections.section_key = contact',
    },
  };
  return meta[sectionKey] || {
    label: sectionKey || 'Phần nội dung',
    badge: 'Nội dung phụ',
    role: 'Phần nội dung bổ sung của Trang chủ.',
    focus: 'Kiểm tra nội dung hiển thị và trường còn thiếu nếu có.',
    technical: `CMS index_sections.section_key = ${sectionKey || 'unknown'}`,
  };
}


function renderHomeSectionWorkspacePanel(state, sections = [], sectionKey = 'hero', copy = ADMIN_COPY.contentViews.home, editState = {}) {
  const roles = getHomeSectionsByRole(sections);
  const section = roles[sectionKey] || null;
  const meta = getHomeSectionPriorityMeta(sectionKey);
  const isEditingThisSection = Boolean(editState.isEditing && editState.editingSectionKey === sectionKey);
  const panel = createElement('section', {
    className: `cms-admin-panel cms-admin-view-panel cms-admin-home-section-panel cms-admin-home-section-${sectionKey}-panel${sectionKey === 'hero' ? ' is-primary-section' : ''}${isEditingThisSection ? ' is-editing' : ''}`,
    dataset: { cmsReferenceTarget: `home-${sectionKey}`, cmsReferenceId: section?.id || sectionKey },
  });

  if (sectionKey !== 'contact') {
    panel.appendChild(renderHomeSectionIntroPanel(sectionKey, section, meta, copy, { isEditing: isEditingThisSection }));
  }

  const workspace = createElement('div', {
    className: `cms-admin-home-contextual-workspace cms-admin-home-contextual-workspace-${sectionKey}${isEditingThisSection ? ' is-editing' : ''}`,
  });
  const main = createElement('div', { className: 'cms-admin-home-main-column' });
  const side = renderHomeContextualChecklistPanel(state, section, sectionKey, copy, editState, { isEditing: isEditingThisSection, meta });

  if (sectionKey === 'contact') {
    main.appendChild(renderHomeContactReferencePanel(state, section, meta, copy));
    main.appendChild(renderHomeSectionTechnicalFooter(section, meta));
    main.appendChild(renderLockedNotice(getHomeSectionSafetyNote(sectionKey)));
    appendChildren(workspace, [main, side]);
    panel.appendChild(workspace);
    return panel;
  }

  if (!section) {
    main.appendChild(renderEmptyState(`Chưa tìm thấy ${meta.label} trong dữ liệu Trang chủ.`));
    main.appendChild(renderHomeSectionTechnicalFooter(section, meta));
    appendChildren(workspace, [main, side]);
    panel.appendChild(workspace);
    return panel;
  }

  if (isEditingThisSection) {
    main.appendChild(renderHomeSectionEditZone(state, sections, section, sectionKey, copy, editState));
    main.appendChild(renderHomeSectionTechnicalFooter(section, meta));
    main.appendChild(renderLockedNotice(getHomeSectionSafetyNote(sectionKey)));
    appendChildren(workspace, [main, side]);
    panel.appendChild(workspace);
    return panel;
  }

  const layout = createElement('div', {
    className: `cms-admin-home-section-layout cms-admin-home-section-layout-${sectionKey}${sectionKey === 'hero' ? ' is-hero' : ' is-text-first'}`,
  });
  layout.appendChild(renderHomeSectionAudienceCard(section, sectionKey, copy, meta));

  const supporting = createElement('div', { className: 'cms-admin-home-section-supporting-flow' });
  const mediaCard = renderHomeSectionMediaActionCard(section, sectionKey, copy);
  if (mediaCard) supporting.appendChild(mediaCard);
  if (supporting.childNodes.length) layout.appendChild(supporting);
  main.appendChild(layout);

  main.appendChild(renderHomeSectionTechnicalFooter(section, meta));
  main.appendChild(renderLockedNotice(getHomeSectionSafetyNote(sectionKey)));
  appendChildren(workspace, [main, side]);
  panel.appendChild(workspace);
  return panel;
}

function renderHomeContextualChecklistPanel(state, section, sectionKey, copy = ADMIN_COPY.contentViews.home, editState = {}, options = {}) {
  const meta = options.meta || getHomeSectionPriorityMeta(sectionKey);
  const isEditing = Boolean(options.isEditing);
  const panel = createElement('aside', {
    className: `cms-admin-home-context-panel cms-admin-home-action-rail cms-admin-home-context-panel-${sectionKey}${isEditing ? ' is-editing' : ''}`,
    attrs: { 'aria-label': `Checklist và thao tác ${meta.label}` },
  });
  const header = createElement('header', { className: 'cms-admin-home-action-rail-header' });
  header.appendChild(renderDataCardTitle('Checklist & thao tác', isEditing ? 'Đang chỉnh' : meta.badge));
  header.appendChild(createElement('p', {
    className: 'cms-admin-operator-summary',
    text: isEditing
      ? 'Đang kiểm tra bản nháp của khu vực này. Website public chưa đổi.'
      : getHomeContextSummary(section, sectionKey, meta),
  }));
  header.appendChild(renderHomeActionRailCurrentSection(meta, sectionKey));
  panel.appendChild(header);

  const list = createElement('div', { className: 'cms-admin-home-context-checklist cms-admin-home-action-rail-section' });
  buildHomeSectionChecklistModel(state, section, sectionKey, copy, editState, { isEditing }).forEach((item) => {
    list.appendChild(renderHomeChecklistItem(item));
  });
  panel.appendChild(list);
  panel.appendChild(renderHomeContextualActionPanel(state, section, sectionKey, editState, { isEditing }));
  return panel;
}

function getHomeContextSummary(section, sectionKey, meta = getHomeSectionPriorityMeta(sectionKey)) {
  if (sectionKey === 'contact') return 'Liên hệ trong Trang chủ chỉ để đối chiếu. Dữ liệu chính được chỉnh ở Thông tin website.';
  if (!section) return `Chưa đọc được ${meta.label}.`;
  return `${meta.label} đang ở chế độ xem. Chỉnh sửa chỉ lưu bản nháp trong CMS.`;
}


function renderHomeActionRailCurrentSection(meta = {}, sectionKey = '') {
  const row = createElement('div', { className: 'cms-admin-home-action-rail-current' });
  row.appendChild(createElement('span', { text: 'Đang xem khu vực' }));
  row.appendChild(createElement('strong', { text: meta.label || sectionKey || 'Trang chủ' }));
  return row;
}

function buildHomeSectionChecklistModel(state, section, sectionKey, copy = ADMIN_COPY.contentViews.home, editState = {}, options = {}) {
  const isEditing = Boolean(options.isEditing);
  const missingFields = getHomeSectionImportantMissingFields(section, sectionKey, copy);
  const media = normalizeJsonValue(section?.media_json);
  const cta = normalizeJsonValue(section?.cta_json);
  const items = normalizeJsonValue(section?.items_json);
  const validationErrorCount = Object.keys(editState.validationErrors || {}).length;
  const validationWarningCount = Object.keys(editState.validationWarnings || {}).length;
  const canEdit = getHomeCanEditSection(state, section, sectionKey);
  const checklist = [
    {
      label: 'Dữ liệu khu vực',
      value: section ? 'Đã đọc' : 'Thiếu dữ liệu',
      status: section ? 'pass' : 'warning',
      detail: section ? 'Đang dùng dữ liệu Trang chủ đã tải.' : 'Không thấy dữ liệu khu vực này trong state hiện tại.',
    },
    {
      label: 'Hiển thị trên website',
      value: section ? getVisibleLabel(section?.is_visible) : 'Chưa rõ',
      status: section ? (section?.is_visible === false ? 'warning' : 'pass') : 'warning',
      detail: section?.is_visible === false ? 'Khu vực đang ẩn hoặc chưa bật hiển thị.' : 'Trạng thái hiển thị chỉ thay đổi khi lưu và công khai theo luồng riêng.',
    },
    {
      label: 'Nội dung chính',
      value: missingFields.length ? `${missingFields.length} mục cần xem` : 'Đạt',
      status: missingFields.length ? 'warning' : 'pass',
      detail: missingFields.length ? `Cần kiểm tra: ${missingFields.slice(0, 3).join(', ')}.` : 'Không thấy thiếu trường nội dung chính theo checklist hiện tại.',
    },
    buildHomeMediaChecklistItem(sectionKey, media),
    buildHomeButtonChecklistItem(sectionKey, cta),
  ];

  if (sectionKey === 'guide') {
    checklist.push({
      label: 'Bước hướng dẫn',
      value: Array.isArray(items) && items.length ? `${items.length} bước` : 'Cần kiểm tra',
      status: Array.isArray(items) && items.length ? 'pass' : 'warning',
      detail: Array.isArray(items) && items.length ? 'Danh sách bước hướng dẫn đã có trong dữ liệu.' : 'Chưa thấy danh sách bước hướng dẫn rõ ràng.',
    });
  }

  checklist.push({
    label: 'Quyền chỉnh',
    value: canEdit ? 'Có thể chỉnh' : 'Chỉ xem',
    status: canEdit ? 'pass' : 'info',
    detail: canEdit ? 'Tài khoản và viewport hiện tại đủ điều kiện mở chỉnh sửa.' : 'Không đủ quyền, chưa bật chức năng hoặc đang ở viewport an toàn.',
  });

  if (isEditing) {
    checklist.push(
      {
        label: 'Trạng thái chỉnh sửa',
        value: editState.dirty ? 'Có thay đổi chưa lưu' : 'Chưa có thay đổi',
        status: editState.dirty ? 'warning' : 'info',
        detail: editState.dirty ? 'Rời màn sẽ có cảnh báo mất thay đổi.' : 'Nút lưu sẽ mở khi có thay đổi local.',
      },
      {
        label: 'Kiểm tra dữ liệu',
        value: validationErrorCount ? `${validationErrorCount} lỗi` : validationWarningCount ? `${validationWarningCount} cảnh báo` : 'Chưa thấy lỗi',
        status: validationErrorCount ? 'blocked' : validationWarningCount ? 'warning' : 'pass',
        detail: validationErrorCount ? 'Sửa lỗi trong form trước khi lưu.' : validationWarningCount ? 'Có cảnh báo nên xem lại trước khi công khai.' : 'Chưa có lỗi validation trong state hiện tại.',
      },
      {
        label: 'Đang lưu',
        value: editState.saving ? 'Có' : 'Không',
        status: editState.saving ? 'warning' : 'pass',
        detail: editState.saving ? 'Đợi thao tác lưu kết thúc trước khi rời màn.' : 'Không có thao tác lưu đang chạy.',
      },
    );
    if (editState.saveError) {
      checklist.push({
        label: 'Lỗi lưu',
        value: 'Cần kiểm tra',
        status: 'blocked',
        detail: normalizeErrorMessage(editState.saveError),
      });
    }
  }

  checklist.push({
    label: 'Website public',
    value: 'Chưa tự đổi',
    status: 'info',
    detail: 'Mở, chỉnh hoặc lưu bản nháp trong CMS chưa công khai website. Website chỉ đổi ở workflow công khai riêng.',
  });
  return checklist;
}

function buildHomeMediaChecklistItem(sectionKey, media) {
  if (sectionKey === 'contact') {
    return { label: 'Ảnh/video', value: 'Không dùng ở khu vực này', status: 'info', detail: 'Thông tin liên hệ tham chiếu không quản lý ảnh/video riêng.' };
  }
  if (sectionKey === 'hero') {
    return { label: 'Ảnh/video', value: isBlank(media) ? 'Cần kiểm tra' : 'Đã có', status: isBlank(media) ? 'warning' : 'pass', detail: isBlank(media) ? 'Khu vực đầu trang nên có ảnh/video giới thiệu rõ ràng.' : 'Đã có dữ liệu ảnh/video; đường dẫn kỹ thuật nằm trong details.' };
  }
  return { label: 'Ảnh/video', value: isBlank(media) ? 'Không dùng ở khu vực này' : 'Đã có', status: isBlank(media) ? 'info' : 'pass', detail: isBlank(media) ? 'Khu vực này không bắt buộc có ảnh/video.' : 'Đã có dữ liệu ảnh/video bổ trợ.' };
}

function buildHomeButtonChecklistItem(sectionKey, cta) {
  if (sectionKey === 'contact') {
    return { label: 'Nút', value: 'Mở Thông tin website', status: 'info', detail: 'Liên hệ chính thức chỉnh ở màn Thông tin website.' };
  }
  if (sectionKey === 'hero') {
    return { label: 'Nút', value: isBlank(cta) ? 'Cần kiểm tra' : 'Đã có', status: isBlank(cta) ? 'warning' : 'pass', detail: isBlank(cta) ? 'Khu vực đầu trang nên có nút rõ để người xem đi tiếp.' : 'Đã có dữ liệu nút; đường dẫn kỹ thuật nằm trong details nếu cần đối chiếu.' };
  }
  return { label: 'Nút', value: isBlank(cta) ? 'Không dùng ở khu vực này' : 'Đã có', status: isBlank(cta) ? 'info' : 'pass', detail: isBlank(cta) ? 'Không thấy nút riêng trong khu vực này.' : 'Đã có dữ liệu nút bổ trợ.' };
}

function renderHomeChecklistItem({ label, value, status = 'info', detail = '' } = {}) {
  const item = createElement('div', { className: `cms-admin-home-checklist-item is-${status}` });
  item.appendChild(createElement('span', { className: 'cms-admin-home-checklist-icon', text: status === 'pass' ? '✓' : status === 'blocked' ? '!' : '•', attrs: { 'aria-hidden': 'true' } }));
  const body = createElement('div', { className: 'cms-admin-home-checklist-body' });
  body.appendChild(createElement('strong', { text: label }));
  body.appendChild(createElement('span', { text: value }));
  if (detail) body.appendChild(createElement('p', { text: detail }));
  item.appendChild(body);
  return item;
}

function getHomeCanEditSection(state, section, sectionKey) {
  if (sectionKey === 'hero') return canEditHomeHero(state, section);
  if (sectionKey === 'guide') return canEditHomeGuide(state, section);
  if (sectionKey === 'experience') return canEditHomeExperience(state, section);
  return false;
}

function renderHomeContextualActionPanel(state, section, sectionKey, editState = {}, options = {}) {
  const panel = createElement('section', { className: 'cms-admin-home-context-action-panel cms-admin-home-action-rail-actions' });
  panel.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: 'Thao tác chính' }));
  if (options.isEditing) {
    panel.appendChild(createElement('p', {
      className: 'cms-admin-compact-copy',
      text: 'Nút lưu nằm cuối form đang chỉnh để giữ đúng hành vi lưu hiện có.',
    }));
    panel.appendChild(renderHomeChecklistActionNote(editState.dirty ? 'Có thay đổi chưa lưu.' : 'Chưa có thay đổi để lưu.', editState.dirty ? 'warning' : 'info'));
    return panel;
  }

  if (sectionKey === 'contact') {
    const openButton = createElement('button', {
      className: 'cms-admin-button cms-admin-button-primary',
      text: 'Mở Thông tin website',
      type: 'button',
      ariaLabel: 'Mở màn Thông tin website để chỉnh dữ liệu liên hệ chính thức',
    });
    openButton.addEventListener('click', () => switchAdminTab('settings'));
    panel.appendChild(openButton);
    panel.appendChild(renderHomeChecklistActionNote('Trang chủ chỉ đối chiếu thông tin liên hệ.', 'info'));
    return panel;
  }

  if (sectionKey === 'hero') {
    panel.appendChild(renderPublicLink(ADMIN_COPY.contentViews.home?.publicLink || 'Mở Trang chủ public', './index.html'));
  }

  const editButton = renderHomeContextualEditButton(state, section, sectionKey);
  if (editButton) {
    panel.appendChild(editButton);
    panel.appendChild(renderHomeChecklistActionNote('Mở chỉnh sửa chỉ tạo bản nháp local. Website public chưa đổi.', 'info'));
  } else {
    panel.appendChild(renderHomeChecklistActionNote('Tài khoản hiện tại chỉ xem hoặc chưa đủ điều kiện chỉnh khu vực này.', 'warning'));
  }
  return panel;
}

function renderHomeChecklistActionNote(text, tone = 'info') {
  return createElement('p', { className: `cms-admin-home-context-action-note is-${tone}`, text });
}

function renderHomeContextualEditButton(state, section, sectionKey) {
  if (!getHomeCanEditSection(state, section, sectionKey)) return null;
  const labels = {
    hero: 'Chỉnh sửa khu vực đầu trang',
    experience: 'Chỉnh sửa khu vực trải nghiệm',
    guide: 'Chỉnh sửa hướng dẫn tham quan',
  };
  const button = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    text: labels[sectionKey] || 'Chỉnh sửa phần này',
    type: 'button',
  });
  button.addEventListener('click', () => {
    const editId = section.id || section.section_key || sectionKey;
    const guard = requestStartEditSession({ type: 'home', id: editId });
    if (!guard.allowed) return;
    if (!guard.same) {
      if (sectionKey === 'hero') startHomeHeroEdit(section);
      else if (sectionKey === 'experience') startHomeExperienceEdit(section);
      else if (sectionKey === 'guide') startHomeGuideEdit(section);
    }
    setWorkspaceTabState('home', sectionKey);
    queueEditPanelFocus(`home-${sectionKey}`, editId, sectionKey === 'hero' ? 'eyebrow' : 'title');
    renderAdminShell();
  });
  return button;
}

function renderHomeSectionIntroPanel(sectionKey, section, meta = getHomeSectionPriorityMeta(sectionKey), copy = ADMIN_COPY.contentViews.home, options = {}) {
  const intro = createElement('header', { className: `cms-admin-home-section-intro cms-admin-home-section-intro-${sectionKey}` });
  const text = createElement('div', { className: 'cms-admin-home-section-intro-text' });
  text.appendChild(renderPanelTitle(meta.label, options.isEditing ? 'Đang sửa bản nháp' : meta.badge));
  text.appendChild(createElement('p', { className: 'cms-admin-operator-summary', text: meta.role }));
  if (meta.focus) text.appendChild(createElement('p', { className: 'cms-admin-home-section-focus', text: meta.focus }));
  intro.appendChild(text);

  const summary = getHomeSectionQuickSummary(section, sectionKey, copy);
  if (summary.length) {
    const facts = createElement('div', { className: 'cms-admin-home-section-quick-facts' });
    summary.forEach(([label, value, tone]) => facts.appendChild(renderHomeSectionFactPill(label, value, tone)));
    intro.appendChild(facts);
  }
  return intro;
}


function getHomeSectionQuickSummary(section, sectionKey, copy = ADMIN_COPY.contentViews.home) {
  if (!section) return [['Trạng thái', 'Thiếu dữ liệu', 'warning']];
  const missing = getHomeSectionImportantMissingFields(section, sectionKey, copy);
  const facts = [
    ['Hiển thị', getVisibleLabel(section?.is_visible), section?.is_visible === false ? 'warning' : 'success'],
  ];
  if (sectionKey === 'hero') {
    const media = getHomeMediaHumanSummary(section?.media_json);
    const cta = getHomeCtaHumanSummary(section?.cta_json);
    facts.push(['Cần xem', missing.length ? `${missing.length} mục` : 'Tạm ổn', missing.length ? 'warning' : 'success']);
    facts.push(['Ảnh/video', media.includes('Chưa') ? 'Cần rõ' : 'Đã có dữ liệu', media.includes('Chưa') ? 'warning' : 'success']);
    facts.push(['Nút', cta.includes('Chưa') || cta.includes('thiếu') ? 'Cần rõ' : 'Đã khai báo', cta.includes('Chưa') || cta.includes('thiếu') ? 'warning' : 'success']);
  } else if (missing.length) {
    facts.push(['Cần xem', `${missing.length} mục`, 'warning']);
  }
  return facts;
}

function renderHomeSectionFactPill(label, value, tone = '') {
  const pill = createElement('div', { className: `cms-admin-home-section-fact${tone ? ` is-${tone}` : ''}` });
  pill.appendChild(createElement('span', { text: label }));
  pill.appendChild(createElement('strong', { text: value }));
  return pill;
}

function getHomeSectionPanelTitle(sectionKey, meta = getHomeSectionPriorityMeta(sectionKey)) {
  return meta.label;
}


function renderHomeSectionAudienceCard(section, sectionKey, copy = ADMIN_COPY.contentViews.home, meta = getHomeSectionPriorityMeta(sectionKey)) {
  const card = createElement('article', {
    className: `cms-admin-data-card cms-admin-home-section-card cms-admin-home-section-audience-card${sectionKey === 'hero' ? ' is-featured-preview' : ''}${sectionKey === 'guide' ? ' is-instruction-preview' : ''}`,
  });
  const badge = sectionKey === 'hero' ? 'Đầu tiên' : meta.badge;
  card.appendChild(renderDataCardTitle(sectionKey === 'guide' ? 'Nội dung hướng dẫn chính' : 'Người xem sẽ thấy gì', badge));
  card.appendChild(createElement('p', { className: 'cms-admin-operator-summary', text: getHomeSectionOperatorHint(sectionKey) }));

  const preview = createElement('div', { className: 'cms-admin-home-section-preview-block' });
  const eyebrow = normalizeJsonValue(section?.eyebrow);
  const title = normalizeJsonValue(section?.title);
  const description = normalizeJsonValue(section?.subtitle || section?.lead || section?.body);
  if (!isBlank(eyebrow)) preview.appendChild(createElement('p', { className: 'cms-admin-home-section-preview-eyebrow', text: summarizeData(eyebrow) }));
  preview.appendChild(createElement('h4', { className: 'cms-admin-home-section-preview-title', text: isBlank(title) ? 'Chưa khai báo tiêu đề chính' : summarizeData(title) }));
  preview.appendChild(createElement('p', { className: 'cms-admin-home-section-preview-description', text: isBlank(description) ? 'Chưa có mô tả đủ rõ cho người xem.' : summarizeData(description, 280) }));
  preview.appendChild(renderHomeSectionStatusStrip(section, sectionKey));
  card.appendChild(preview);

  if (sectionKey === 'guide') card.appendChild(renderHomeSectionItemsSummary(section, copy));
  return card;
}

function renderHomeSectionStatusStrip(section, sectionKey) {
  const strip = createElement('div', { className: 'cms-admin-home-section-status-strip' });
  const rows = [
    ['Trạng thái', getVisibleLabel(section?.is_visible)],
    ['Cập nhật', formatDateTime(section?.updated_at)],
  ];
  if (sectionKey === 'hero') rows.push(['Vai trò', 'Ấn tượng đầu tiên']);
  if (sectionKey === 'contact') rows.push(['Nguồn sửa', 'Thông tin website']);
  rows.forEach(([label, value]) => strip.appendChild(renderHomeSectionFactPill(label, value)));
  return strip;
}


function renderHomeSectionMediaActionCard(section, sectionKey, copy = ADMIN_COPY.contentViews.home) {
  if (!shouldRenderHomeSectionMediaCard(section, sectionKey)) return null;
  const card = createElement('article', { className: `cms-admin-data-card cms-admin-home-section-card cms-admin-home-section-media-card cms-admin-home-section-media-card-${sectionKey}` });
  card.appendChild(renderDataCardTitle('Ảnh/video và nút trong khu vực này', sectionKey === 'hero' ? 'Cần rõ' : 'Có dữ liệu'));
  card.appendChild(createElement('p', { className: 'cms-admin-operator-summary', text: getHomeSectionMediaHint(sectionKey) }));
  card.appendChild(renderHomeSectionMediaCtaSummary(section, copy));
  return card;
}


function getHomeSectionMediaHint(sectionKey) {
  const hints = {
    hero: 'Ảnh/video và nút của khu vực đầu trang cần rõ vì đây là điểm người xem nhìn thấy đầu tiên.',
    experience: 'Ảnh/video hoặc nút ở đây chỉ hiển thị khi dữ liệu thật sự có, nhằm bổ trợ cảm giác tham quan.',
    guide: 'Ảnh/video hoặc nút ở đây chỉ hiển thị khi dữ liệu thật sự có và hỗ trợ hướng dẫn.',
    contact: 'Thông tin liên hệ tham chiếu không dùng ảnh/video hoặc nút riêng trong màn Trang chủ.',
  };
  return hints[sectionKey] || 'Kiểm tra ảnh/video và nút gắn với đúng khu vực này.';
}


function renderHomeSectionReadinessCard(section, sectionKey, copy = ADMIN_COPY.contentViews.home) {
  const missingFields = getHomeSectionImportantMissingFields(section, sectionKey, copy);
  if (!shouldRenderHomeSectionReadinessCard(section, sectionKey, missingFields)) return null;
  const isReady = missingFields.length === 0;
  const card = createElement('article', {
    className: `cms-admin-data-card cms-admin-home-section-card cms-admin-home-section-readiness-card${isReady ? ' is-ready' : ' is-warning'}${sectionKey === 'hero' ? ' is-prominent' : ' is-compact'}`,
  });
  card.appendChild(renderDataCardTitle(sectionKey === 'hero' ? 'Cần kiểm tra trước khi công khai' : 'Điểm cần xem', isReady ? 'Tạm ổn' : `${missingFields.length} mục cần xem`));
  card.appendChild(createElement('p', {
    className: 'cms-admin-operator-summary',
    text: isReady
      ? 'Không thấy thiếu mục chính trong khu vực này. Vẫn cần kiểm tra bằng mắt trước khi công khai.'
      : getHomeSectionReadinessHint(sectionKey),
  }));
  card.appendChild(renderHomeSectionReadinessList(section, sectionKey, missingFields));
  return card;
}


function renderHomeSectionReadinessList(section, sectionKey, missingFields = []) {
  const list = createElement('ul', { className: 'cms-admin-home-readiness-list' });
  if (!missingFields.length) {
    list.appendChild(createElement('li', { text: 'Không phát hiện thiếu dữ liệu chính.' }));
    list.appendChild(createElement('li', { text: 'Kiểm tra lại nội dung hiển thị bằng mắt trước khi công khai.' }));
    return list;
  }
  missingFields.forEach((field) => list.appendChild(createElement('li', { text: `Cần xem: ${field}` })));
  return list;
}


function renderHomeSectionEditActionCard(state, section, sectionKey, copy = ADMIN_COPY.contentViews.home) {
  const card = createElement('article', { className: `cms-admin-data-card cms-admin-home-section-card cms-admin-home-section-edit-card cms-admin-home-section-edit-card-${sectionKey}` });
  card.appendChild(renderDataCardTitle('Chỉnh sửa khu vực này', 'Bản nháp trong CMS'));
  card.appendChild(createElement('p', { className: 'cms-admin-operator-summary', text: getHomeSectionEditHint(sectionKey) }));
  if (sectionKey === 'hero') card.appendChild(renderHomeHeroEditActions(state, section));
  else if (sectionKey === 'experience') card.appendChild(renderHomeExperienceEditActions(state, section));
  else if (sectionKey === 'guide') card.appendChild(renderHomeGuideEditActions(state, section));
  return card;
}

function renderHomeSectionEditZone(state, sections = [], section, sectionKey, copy = ADMIN_COPY.contentViews.home, editState = {}) {
  const zone = createElement('section', { className: `cms-admin-home-section-edit-zone cms-admin-home-section-edit-zone-${sectionKey}` });
  zone.appendChild(renderDataCardTitle(`Đang chỉnh sửa ${getHomeSectionPriorityMeta(sectionKey).label}`, 'Bản nháp trong CMS'));
  zone.appendChild(createElement('p', { className: 'cms-admin-operator-summary', text: 'Form này chỉ sửa bản nháp của khu vực đang mở. Website public chưa thay đổi cho đến khi lưu bản nháp và chạy workflow công khai riêng.' }));
  const focusedEditPanel = renderHomeFocusedEditPanel(state, sections, editState);
  if (focusedEditPanel) zone.appendChild(focusedEditPanel);
  else zone.appendChild(renderEmptyState('Không mở được form chỉnh sửa cho khu vực này trong trạng thái hiện tại.'));
  return zone;
}


function renderHomeContactReferencePanel(state, section, meta = getHomeSectionPriorityMeta('contact'), copy = ADMIN_COPY.contentViews.home) {
  const wrap = createElement('div', { className: 'cms-admin-home-contact-reference-flow' });
  const header = createElement('header', { className: 'cms-admin-home-contact-reference-header' });
  header.appendChild(renderPanelTitle(meta.label, meta.badge));
  header.appendChild(createElement('p', { className: 'cms-admin-operator-summary', text: meta.role }));
  header.appendChild(createElement('p', { className: 'cms-admin-home-section-focus', text: meta.focus }));
  wrap.appendChild(header);

  wrap.appendChild(renderHomeContactOfficialInfoCard(state, copy));

  const actionCard = createElement('article', { className: 'cms-admin-data-card cms-admin-home-section-card cms-admin-home-contact-action-card' });
  actionCard.appendChild(renderDataCardTitle('Sửa thông tin liên hệ ở đâu?', 'Nguồn riêng'));
  actionCard.appendChild(createElement('p', {
    className: 'cms-admin-operator-summary',
    text: 'Thông tin liên hệ chính thức được quản lý tại màn Thông tin website. Màn Trang chủ chỉ đối chiếu để tránh lệch nguồn dữ liệu.',
  }));
  const actions = createElement('div', { className: 'cms-admin-settings-edit-actions cms-admin-contact-source-actions' });
  const openButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost',
    text: 'Mở Thông tin website',
    title: 'Mở màn Thông tin website để chỉnh dữ liệu liên hệ chính thức',
    type: 'button',
    ariaLabel: 'Mở màn Thông tin website để chỉnh dữ liệu liên hệ chính thức',
  });
  openButton.addEventListener('click', () => switchAdminTab('settings'));
  actions.appendChild(openButton);
  actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: 'Không tạo form liên hệ mới trong Trang chủ.' }));
  actionCard.appendChild(actions);
  wrap.appendChild(actionCard);

  const sectionNote = createElement('p', {
    className: 'cms-admin-compact-copy cms-admin-home-contact-section-note',
    text: section ? 'Section Contact trong Trang chủ chỉ giữ vai trò tham chiếu/placeholder, không phải nơi nhập dữ liệu liên hệ chính thức.' : 'Chưa thấy section Contact trong dữ liệu Trang chủ; vẫn có thể đối chiếu nguồn liên hệ chính thức từ Thông tin website.',
  });
  wrap.appendChild(sectionNote);
  return wrap;
}

function renderHomeContactOfficialInfoCard(state, copy = ADMIN_COPY.contentViews.home) {
  const siteSettings = state?.data?.siteSettings || {};
  const contactCopy = copy.contactSource || {};
  const missing = contactCopy.missing || 'Chưa khai báo';
  const fieldCopy = contactCopy.fields || {};
  const card = createElement('article', { className: 'cms-admin-data-card cms-admin-home-section-card cms-admin-home-contact-official-card' });
  card.appendChild(renderDataCardTitle('Thông tin liên hệ chính thức đang dùng', 'Nguồn: Thông tin website'));
  card.appendChild(createElement('p', {
    className: 'cms-admin-operator-summary',
    text: 'Dữ liệu dưới đây là nguồn chính thức đang được dùng để người xem biết đơn vị quản lý và cách liên hệ.',
  }));
  card.appendChild(renderKeyValueList([
    [fieldCopy.organization || 'Đơn vị quản lý', siteSettings.organization_name || missing],
    [fieldCopy.address || 'Địa chỉ', siteSettings.address || missing],
    [fieldCopy.phone || 'Điện thoại', siteSettings.phone || missing],
    [fieldCopy.fax || 'Fax', siteSettings.fax || missing],
    [fieldCopy.email || 'Email', siteSettings.email || missing],
  ]));
  return card;
}

function renderHomeContactUtilityCard(state, section, copy = ADMIN_COPY.contentViews.home) {
  return renderHomeContactReferencePanel(state, section, getHomeSectionPriorityMeta('contact'), copy);
}

function renderHomeSectionItemsSummary(section, copy = ADMIN_COPY.contentViews.home) {
  const items = normalizeJsonValue(section?.items_json);
  const group = createElement('div', { className: 'cms-admin-home-section-items-summary' });
  group.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: 'Nội dung con / bước hướng dẫn' }));
  const list = renderItemsList(items, copy);
  group.appendChild(list || createElement('p', { className: 'cms-admin-compact-copy', text: 'Chưa có danh sách nội dung con rõ ràng.' }));
  return group;
}

function renderHomeSectionTechnicalFooter(section, meta = {}) {
  const details = createElement('details', { className: 'cms-admin-home-section-technical-footer' });
  details.appendChild(createElement('summary', { text: 'Thông tin kỹ thuật để đối chiếu' }));
  details.appendChild(renderTechnicalSourceNote('Nguồn kỹ thuật phụ', meta.technical || 'CMS index_sections'));
  if (section) {
    details.appendChild(renderKeyValueList(filterVisibleRows([
      ['Mã section', section?.section_key],
      ['Mã nội dung', section?.id],
      ['Thứ tự hiển thị', section?.sort_order],
    ])));
  } else {
    details.appendChild(renderCompactNotice('Không có dữ liệu kỹ thuật cho khu vực này.'));
  }
  return details;
}

function getHomeSectionEditHint(sectionKey) {
  const hints = {
    hero: 'Sửa tiêu đề, mô tả, media giới thiệu và nút cho phần người xem thấy đầu tiên.',
    experience: 'Sửa chữ hiển thị của khu vực trải nghiệm. Mã phòng/route kỹ thuật vẫn được khóa.',
    guide: 'Sửa chữ hướng dẫn và nội dung con được phép. Không làm đổi website cho đến khi công khai.',
    contact: 'Thông tin liên hệ chính thức được chỉnh tại màn Thông tin website, không tạo form mới trong Trang chủ.',
  };
  return hints[sectionKey] || 'Sửa nội dung được phép trong bản nháp CMS.';
}

function getHomeSectionSafetyNote(sectionKey) {
  if (sectionKey === 'contact') return 'Tab này chỉ đối chiếu thông tin liên hệ. Nếu cần sửa, mở màn Thông tin website.';
  return 'Lưu bản nháp chưa làm đổi website. Website chỉ thay đổi sau khi công khai bản đã lưu ở workflow riêng.';
}

function renderHomeSectionMediaCtaSummary(section, copy = ADMIN_COPY.contentViews.home) {
  const box = createElement('div', { className: 'cms-admin-home-media-cta-summary' });
  const media = normalizeJsonValue(section?.media_json);
  const cta = normalizeJsonValue(section?.cta_json);
  const summaryGrid = createElement('div', { className: 'cms-admin-home-media-cta-grid' });
  summaryGrid.appendChild(renderHomeMiniSummaryCard('Ảnh/video', getHomeMediaHumanSummary(media), isBlank(media) ? 'warning' : 'success'));
  summaryGrid.appendChild(renderHomeMiniSummaryCard('Nút', getHomeCtaHumanSummary(cta), isBlank(cta) ? 'warning' : 'success'));
  box.appendChild(summaryGrid);
  if (!isBlank(media)) {
    const mediaDetails = renderMediaSummary(media, copy);
    if (mediaDetails) {
      const details = createElement('details', { className: 'cms-admin-home-media-technical-details' });
      details.appendChild(createElement('summary', { text: 'Đường dẫn kỹ thuật' }));
      details.appendChild(renderDataGroup('Thông tin kỹ thuật để đối chiếu', mediaDetails));
      box.appendChild(details);
    }
  }
  return box;
}

function renderHomeMiniSummaryCard(label, value, tone = '') {
  const card = createElement('div', { className: `cms-admin-home-mini-summary${tone ? ` is-${tone}` : ''}` });
  card.appendChild(createElement('span', { text: label }));
  card.appendChild(createElement('strong', { text: value }));
  return card;
}

function getHomeMediaHumanSummary(value) {
  const normalized = normalizeJsonValue(value);
  if (isBlank(normalized)) return 'Chưa khai báo ảnh/video rõ ràng.';
  if (Array.isArray(normalized)) return `${normalized.length} mục ảnh/video đã khai báo.`;
  if (normalized && typeof normalized === 'object') {
    const caption = firstValue(normalized, ['caption', 'alt', 'title', 'label']);
    const url = firstValue(normalized, ['videoUrl', 'video_url', 'video', 'mp4', 'src', 'url', 'imageUrl', 'image_url', 'image', 'poster', 'posterUrl', 'poster_url', 'thumbnail']);
    if (!isBlank(caption)) return summarizeData(caption);
    if (!isBlank(url)) return 'Đã có ảnh/video để đối chiếu.';
    return 'Đã khai báo ảnh/video nhưng thiếu nhãn dễ đọc.';
  }
  return 'Đã khai báo ảnh/video.';
}

function getHomeCtaHumanSummary(value) {
  const normalized = normalizeJsonValue(value);
  if (isBlank(normalized)) return 'Chưa khai báo nút rõ ràng.';
  if (Array.isArray(normalized)) return `${normalized.length} nút đã khai báo.`;
  if (normalized && typeof normalized === 'object') {
    const label = firstValue(normalized, ['label', 'text', 'title', 'name']);
    const href = firstValue(normalized, ['href', 'url', 'to', 'link']);
    if (!isBlank(label) && !isBlank(href)) return `${summarizeData(label)} → đã có liên kết.`;
    if (!isBlank(label)) return `${summarizeData(label)} → cần kiểm tra liên kết.`;
    if (!isBlank(href)) return 'Đã có liên kết nhưng thiếu nhãn nút dễ hiểu.';
    return 'Đã khai báo nút nhưng thiếu nhãn dễ đọc.';
  }
  return summarizeData(normalized);
}


function getHomeReadinessSummary(sections = [], copy = ADMIN_COPY.contentViews.home) {
  const roles = getHomeSectionsByRole(sections);
  const ordered = [roles.hero, roles.experience, roles.guide, roles.contact].filter(Boolean);
  const issues = [];
  ordered.forEach((section) => {
    const sectionKey = section?.section_key || 'section';
    const meta = getHomeSectionPriorityMeta(sectionKey);
    const missing = getHomeSectionImportantMissingFields(section, sectionKey, copy);
    if (missing.length) issues.push(`${meta.label}: thiếu ${missing.join(', ')}`);
  });
  if (!roles.hero) issues.push('Thiếu Khu vực đầu trang trong dữ liệu Trang chủ.');
  return {
    issueCount: issues.length,
    issues,
    sectionCount: safeArray(sections).length,
    hasHero: Boolean(roles.hero),
  };
}
function getHomeSectionImportantMissingFields(section, sectionKey, copy = ADMIN_COPY.contentViews.home) {
  if (!section) return ['Dữ liệu khu vực'];
  const labels = copy.fields || {};
  const title = normalizeJsonValue(section?.title);
  const description = normalizeJsonValue(section?.subtitle || section?.lead || section?.body);
  const media = normalizeJsonValue(section?.media_json);
  const cta = normalizeJsonValue(section?.cta_json);
  const items = normalizeJsonValue(section?.items_json);
  const missing = [];

  if (isBlank(title)) missing.push(labels.title || 'Tiêu đề chính');
  if (sectionKey === 'hero') {
    if (isBlank(section?.subtitle)) missing.push(labels.subtitle || 'Tiêu đề phụ');
    if (isBlank(section?.body)) missing.push(labels.body || 'Nội dung mô tả');
    if (isBlank(media)) missing.push(labels.media || 'Ảnh/video giới thiệu');
    if (isBlank(cta)) missing.push(labels.cta || 'Nút');
  } else if (sectionKey === 'experience') {
    if (isBlank(description)) missing.push('Mô tả trải nghiệm');
  } else if (sectionKey === 'guide') {
    if (isBlank(description)) missing.push('Mô tả hướng dẫn');
    if (isBlank(items)) missing.push(labels.items || 'Danh sách nội dung con');
  }
  return [...new Set(missing)];
}

function shouldRenderHomeSectionMediaCard(section, sectionKey) {
  if (!section || sectionKey === 'contact') return false;
  if (sectionKey === 'hero') return true;
  return hasHomeSectionMediaOrCta(section);
}

function hasHomeSectionMediaOrCta(section) {
  return !isBlank(normalizeJsonValue(section?.media_json)) || !isBlank(normalizeJsonValue(section?.cta_json));
}

function shouldRenderHomeSectionReadinessCard(section, sectionKey, missingFields = []) {
  if (!section || sectionKey === 'contact') return false;
  if (sectionKey === 'hero') return true;
  return missingFields.length > 0;
}

function getHomeSectionReadinessHint(sectionKey) {
  const hints = {
    hero: 'Các mục dưới đây nên được xem trước vì khu vực đầu trang là phần quan trọng nhất của Trang chủ.',
    experience: 'Chỉ các mục ảnh hưởng trực tiếp đến nội dung trải nghiệm mới được nhắc ở đây.',
    guide: 'Chỉ các mục ảnh hưởng trực tiếp đến hướng dẫn người xem mới được nhắc ở đây.',
  };
  return hints[sectionKey] || 'Các mục dưới đây nên được xem trước khi chuyển sang workflow công khai.';
}

function renderHomeReadinessSummaryPanel(readiness = {}, options = {}) {
  const panel = createElement('section', { className: `cms-admin-home-readiness-panel${options.compact ? ' is-compact' : ''}` });
  panel.appendChild(renderDataCardTitle('Tóm tắt kiểm tra trước công khai', readiness.issueCount ? `${readiness.issueCount} điểm cần xem` : 'Không thấy lỗi chính'));
  if (!readiness.issueCount) {
    panel.appendChild(createElement('p', { className: 'cms-admin-operator-summary', text: 'Không phát hiện thiếu dữ liệu chính trong các phần Trang chủ đang đọc. Vẫn cần kiểm tra bằng mắt trước khi công khai.' }));
    return panel;
  }
  const list = createElement('ul', { className: 'cms-admin-operator-bullet-list' });
  readiness.issues.slice(0, 8).forEach((issue) => list.appendChild(createElement('li', { text: issue })));
  panel.appendChild(list);
  if (readiness.issues.length > 8) panel.appendChild(renderCompactNotice(`Còn ${readiness.issues.length - 8} điểm khác cần xem trong dữ liệu.`));
  return panel;
}

function renderGateWorkspaceContent(state, activeKey = 'intro') {
  const copy = ADMIN_COPY.contentViews.gate;
  const gate = state.data.gateContent;
  const editState = state.gateEdit || {};
  const sectionKey = getGateWorkspaceSectionKey(activeKey);
  const wrap = renderWorkspaceSlotWrap('gate', sectionKey);

  if (editState.saveSuccess && !editState.isEditing) {
    wrap.appendChild(renderNoticeBox(editState.saveSuccess, 'success'));
  }

  if (!gate) {
    const emptyPanel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel' });
    emptyPanel.appendChild(renderPanelTitle('Chưa đọc được Cổng vào triển lãm', 'Thiếu dữ liệu'));
    emptyPanel.appendChild(renderEmptyState(`${copy.emptyTitle}. ${copy.emptyBody}`));
    emptyPanel.appendChild(renderGateTechnicalDetails('Nguồn kỹ thuật', [
      ['Bảng dữ liệu', 'CMS gate_content'],
      ['Trạng thái', 'Chưa đọc được dữ liệu'],
    ]));
    emptyPanel.appendChild(renderLockedNotice(copy.safety));
    wrap.appendChild(emptyPanel);
    return wrap;
  }

  if (sectionKey === 'indoor' || sectionKey === 'outdoor') {
    wrap.appendChild(renderGateRoomWorkspacePanel(state, gate, sectionKey, editState, copy));
    return wrap;
  }

  wrap.appendChild(renderGateIntroWorkspacePanel(state, gate, editState, copy));
  return wrap;
}

function getGateWorkspaceSectionKey(activeKey) {
  const key = getCompatibleWorkspaceTabKey('gate', activeKey || 'intro');
  return key === 'indoor' || key === 'outdoor' ? key : 'intro';
}

function getGateRoomLabel(roomKey) {
  return roomKey === 'outdoor' ? 'Không gian ngoài trời' : 'Không gian trong nhà';
}

function getGateRoomTone(roomKey) {
  return roomKey === 'outdoor' ? 'Ngoài trời' : 'Trong nhà';
}

function getGateRoomData(gate, roomKey) {
  return normalizePlainObject(normalizePlainObject(gate?.rooms_json)?.[roomKey]);
}


function renderGateContextualWorkspace(leftContent, rightRail, sectionKey = 'intro') {
  const workspace = createElement('div', {
    className: `cms-admin-gate-contextual-workspace cms-admin-gate-contextual-workspace-${sectionKey}`,
  });
  const main = createElement('div', { className: 'cms-admin-gate-main-column' });
  if (leftContent) main.appendChild(leftContent);
  appendChildren(workspace, [main, rightRail]);
  return workspace;
}

function renderGateContextualChecklistPanel(state, gate, sectionKey = 'intro', editState = {}, copy = ADMIN_COPY.contentViews.gate, options = {}) {
  const isEditing = Boolean(options.isEditing);
  const label = getGateContextLabel(sectionKey);
  const panel = createElement('aside', {
    className: `cms-admin-gate-context-panel cms-admin-gate-action-rail cms-admin-gate-action-rail-${sectionKey}${isEditing ? ' is-editing' : ''}`,
    attrs: { 'aria-label': `Checklist và thao tác ${label}` },
  });

  const header = createElement('header', { className: 'cms-admin-gate-action-rail-header' });
  header.appendChild(renderDataCardTitle('Checklist & thao tác', isEditing ? 'Đang chỉnh' : getGateContextBadge(gate, sectionKey)));
  header.appendChild(createElement('p', {
    className: 'cms-admin-operator-summary',
    text: isEditing
      ? 'Đang chỉnh bản nháp trong CMS. Website public chưa đổi.'
      : getGateContextSummary(gate, sectionKey),
  }));
  header.appendChild(renderGateActionRailCurrentSection(label));
  panel.appendChild(header);

  const list = createElement('div', { className: 'cms-admin-gate-context-checklist cms-admin-gate-action-rail-section' });
  buildGateChecklistModel(state, gate, sectionKey, editState, { isEditing }).forEach((item) => {
    list.appendChild(renderGateChecklistItem(item));
  });
  panel.appendChild(list);
  panel.appendChild(renderGateContextualActionPanel(state, gate, sectionKey, editState, copy, { isEditing }));
  return panel;
}

function getGateContextLabel(sectionKey = 'intro') {
  if (sectionKey === 'indoor') return 'Không gian trong nhà';
  if (sectionKey === 'outdoor') return 'Không gian ngoài trời';
  return 'Màn chọn không gian';
}

function getGateContextBadge(gate, sectionKey = 'intro') {
  if (sectionKey === 'intro') return gate?.is_active ? 'Đang hoạt động' : 'Đang ẩn';
  return getGateRoomTone(sectionKey);
}

function getGateContextSummary(gate, sectionKey = 'intro') {
  if (!gate) return 'Chưa đọc được dữ liệu Cổng triển lãm.';
  if (sectionKey === 'intro') return 'Màn người xem đọc trước khi chọn không gian tham quan.';
  return `Kiểm tra chữ hiển thị của ${getGateRoomLabel(sectionKey).toLowerCase()}. Đường dẫn kỹ thuật vẫn giữ nguyên.`;
}

function renderGateActionRailCurrentSection(label = 'Cổng triển lãm') {
  const row = createElement('div', { className: 'cms-admin-gate-action-rail-current' });
  row.appendChild(createElement('span', { text: 'Đang xem khu vực' }));
  row.appendChild(createElement('strong', { text: label }));
  return row;
}

function buildGateChecklistModel(state, gate, sectionKey = 'intro', editState = {}, options = {}) {
  const isEditing = Boolean(options.isEditing);
  const canEdit = canEditGateContent(state);
  const validationErrorCount = Object.keys(editState.validationErrors || {}).length;
  const validationWarningCount = Object.keys(editState.validationWarnings || {}).length;
  const checklist = [];

  if (sectionKey === 'intro') {
    checklist.push(
      {
        label: 'Dữ liệu cổng',
        value: gate ? 'Đã đọc' : 'Thiếu dữ liệu',
        status: gate ? 'pass' : 'warning',
        detail: gate ? 'Đang dùng dữ liệu Cổng triển lãm đã tải.' : 'Không thấy dữ liệu Cổng triển lãm trong state hiện tại.',
      },
      {
        label: 'Màn chọn không gian',
        value: gate?.is_active ? 'Đang hoạt động' : 'Đang ẩn',
        status: gate?.is_active ? 'pass' : 'warning',
        detail: 'Trạng thái này chỉ thay đổi khi lưu và công khai theo luồng riêng.',
      },
      gateTextChecklistItem('Nhãn nhỏ', gate?.eyebrow, 'Cần kiểm tra'),
      gateTextChecklistItem('Tiêu đề', gate?.title, 'Cần tiêu đề'),
      gateTextChecklistItem('Mô tả', gate?.description, 'Cần mô tả'),
      gateTextChecklistItem('Nút quay lại Trang chủ', gate?.back_label, 'Cần nhãn'),
    );
  } else {
    const room = getGateRoomData(gate, sectionKey);
    const roomLabel = getGateRoomLabel(sectionKey).toLowerCase();
    checklist.push(
      {
        label: `Dữ liệu phòng ${sectionKey === 'outdoor' ? 'ngoài trời' : 'trong nhà'}`,
        value: !isBlank(room) ? 'Đã đọc' : 'Thiếu dữ liệu',
        status: !isBlank(room) ? 'pass' : 'warning',
        detail: !isBlank(room) ? `Đang dùng dữ liệu ${roomLabel}.` : 'Không thấy dữ liệu phòng trong state hiện tại.',
      },
      gateTextChecklistItem('Tên hiển thị', firstText(room, ['label', 'title', 'name']), 'Cần tên'),
      gateTextChecklistItem('Mô tả', firstText(room, ['description', 'lead', 'subtitle']), 'Cần mô tả'),
      gateTextChecklistItem('Nút vào phòng', getGateRoomCtaLabel(room), 'Cần nhãn'),
      {
        label: 'Đường dẫn kỹ thuật',
        value: 'Giữ nguyên',
        status: 'info',
        detail: 'Mã phòng và đường dẫn vào phòng chỉ để đối chiếu trong phần kỹ thuật.',
      },
    );
  }

  checklist.push({
    label: 'Quyền chỉnh',
    value: canEdit ? 'Có thể chỉnh' : 'Chỉ xem',
    status: canEdit ? 'pass' : 'info',
    detail: canEdit ? 'Tài khoản hiện tại có thể mở form chỉnh bản nháp.' : 'Tài khoản hiện tại chỉ được xem hoặc chức năng chỉnh đang khóa.',
  });

  if (isEditing) {
    checklist.push(
      {
        label: 'Đang chỉnh bản nháp',
        value: 'Có',
        status: 'warning',
        detail: 'Thay đổi chỉ nằm trong phiên chỉnh sửa cho đến khi bấm lưu.',
      },
      {
        label: 'Có thay đổi chưa lưu',
        value: editState.dirty ? 'Có' : 'Không',
        status: editState.dirty ? 'warning' : 'info',
        detail: editState.dirty ? 'Rời màn sẽ có cảnh báo mất thay đổi.' : 'Nút lưu mở khi có thay đổi local.',
      },
      {
        label: 'Kiểm tra dữ liệu',
        value: validationErrorCount ? `${validationErrorCount} lỗi` : validationWarningCount ? `${validationWarningCount} cảnh báo` : 'Chưa thấy lỗi',
        status: validationErrorCount ? 'blocked' : validationWarningCount ? 'warning' : 'pass',
        detail: validationErrorCount ? 'Sửa lỗi trong form trước khi lưu.' : validationWarningCount ? 'Có cảnh báo nên xem lại trước khi công khai.' : 'Chưa có lỗi validation trong state hiện tại.',
      },
      {
        label: 'Đang lưu',
        value: editState.saving ? 'Có' : 'Không',
        status: editState.saving ? 'warning' : 'pass',
        detail: editState.saving ? 'Đợi thao tác lưu kết thúc trước khi rời màn.' : 'Không có thao tác lưu đang chạy.',
      },
    );
    if (editState.saveError) {
      checklist.push({
        label: 'Lỗi lưu',
        value: 'Cần kiểm tra',
        status: 'blocked',
        detail: normalizeErrorMessage(editState.saveError),
      });
    }
  }

  checklist.push({
    label: 'Website public',
    value: 'Chưa đổi',
    status: 'info',
    detail: 'Mở, chỉnh hoặc lưu bản nháp trong CMS chưa công khai website. Website chỉ đổi ở workflow công khai riêng.',
  });
  return checklist;
}

function gateTextChecklistItem(label, value, missingValue = 'Cần kiểm tra') {
  const hasValue = !isBlank(value);
  return {
    label,
    value: hasValue ? 'Đạt' : missingValue,
    status: hasValue ? 'pass' : 'warning',
    detail: hasValue ? `${label} đã có dữ liệu hiển thị.` : `${label} đang trống hoặc chưa rõ trong dữ liệu hiện tại.`,
  };
}

function renderGateChecklistItem({ label, value, status = 'info', detail = '' } = {}) {
  const item = createElement('div', { className: `cms-admin-gate-checklist-item is-${status}` });
  item.appendChild(createElement('span', { className: 'cms-admin-gate-checklist-icon', text: status === 'pass' ? '✓' : status === 'blocked' ? '!' : '•', attrs: { 'aria-hidden': 'true' } }));
  const body = createElement('div', { className: 'cms-admin-gate-checklist-body' });
  body.appendChild(createElement('strong', { text: label }));
  body.appendChild(createElement('span', { text: value }));
  if (detail) body.appendChild(createElement('p', { text: detail }));
  item.appendChild(body);
  return item;
}

function renderGateContextualActionPanel(state, gate, sectionKey = 'intro', editState = {}, copy = ADMIN_COPY.contentViews.gate, options = {}) {
  const panel = createElement('section', { className: 'cms-admin-gate-context-action-panel cms-admin-gate-action-rail-actions' });
  panel.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: 'Thao tác chính' }));
  if (options.isEditing) {
    panel.appendChild(createElement('p', {
      className: 'cms-admin-compact-copy',
      text: 'Nút lưu nằm trong form đang chỉnh để giữ đúng hành vi lưu hiện có.',
    }));
    panel.appendChild(renderGateChecklistActionNote(editState.dirty ? 'Có thay đổi chưa lưu.' : 'Chưa có thay đổi để lưu.', editState.dirty ? 'warning' : 'info'));
    return panel;
  }

  if (canEditGateContent(state)) {
    const button = createElement('button', {
      className: 'cms-admin-button cms-admin-button-primary',
      text: getGateEditButtonLabel(sectionKey),
      type: 'button',
    });
    button.addEventListener('click', () => {
      const focusField = sectionKey === 'intro' ? 'eyebrow' : `rooms.${sectionKey}.displayName`;
      startGateContextualEdit(gate, sectionKey, focusField);
    });
    panel.appendChild(button);
    panel.appendChild(renderGateChecklistActionNote(copy.edit?.safeNote || 'Lưu vào CMS, chưa đổi website.', 'info'));
  } else {
    panel.appendChild(renderGateChecklistActionNote(copy.edit?.noPermission || 'Tài khoản hiện tại chỉ được xem Cổng triển lãm.', 'warning'));
  }
  panel.appendChild(renderPublicLink(copy.publicLink || 'Mở Cổng triển lãm public', './gallery.html'));
  panel.appendChild(renderGateChecklistActionNote('Màn này chỉ chỉnh chữ hiển thị. Đường dẫn kỹ thuật và mã phòng giữ nguyên.', 'info'));
  return panel;
}

function getGateEditButtonLabel(sectionKey = 'intro') {
  if (sectionKey === 'indoor') return 'Chỉnh sửa Không gian trong nhà';
  if (sectionKey === 'outdoor') return 'Chỉnh sửa Không gian ngoài trời';
  return 'Chỉnh sửa Màn chọn không gian';
}

function renderGateChecklistActionNote(text, tone = 'info') {
  return createElement('p', { className: `cms-admin-gate-context-action-note is-${tone}`, text });
}

function renderGateIntroWorkspacePanel(state, gate, editState = {}, copy = ADMIN_COPY.contentViews.gate) {
  const isEditing = Boolean(editState.isEditing && getGateWorkspaceSectionKey(getWorkspaceActiveTab('gate', getWorkspaceTabs('gate'))) === 'intro');
  const panel = createElement('section', {
    className: `cms-admin-panel cms-admin-view-panel cms-admin-gate-section-panel cms-admin-gate-intro-panel${isEditing ? ' is-editing' : ''}`,
    dataset: { cmsReferenceTarget: 'gate', cmsReferenceId: gate.id || 'gate' },
  });
  panel.appendChild(renderPanelTitle('Màn chọn không gian', isEditing ? 'Đang chỉnh bản nháp' : 'Người xem đọc trước khi chọn không gian'));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-operator-summary',
    text: 'Phần người xem đọc trước khi chọn Không gian trong nhà hoặc Không gian ngoài trời.',
  }));

  const left = createElement('div', { className: 'cms-admin-gate-left-flow' });
  if (isEditing) {
    left.appendChild(renderGateIntroEditPanel(state, gate, editState, copy));
  } else {
    left.appendChild(renderGateIntroPreviewCard(gate, copy));
    left.appendChild(renderGateTechnicalDetails('Thông tin kỹ thuật để đối chiếu', [
      ['Content id', gate.id],
      [copy.fields?.active || 'Trạng thái sử dụng', getActiveLabel(Boolean(gate.is_active))],
      [copy.fields?.updatedAt || 'Cập nhật gần nhất', formatDateTime(gate.updated_at)],
      ['Dữ liệu trình chỉnh sửa', gate.editor_json ? 'Đã có dữ liệu kỹ thuật' : '—'],
      ['Nguồn dữ liệu', 'CMS gate_content, bản nháp quản trị'],
    ]));
  }
  const rail = renderGateContextualChecklistPanel(state, gate, 'intro', editState, copy, { isEditing });
  panel.appendChild(renderGateContextualWorkspace(left, rail, 'intro'));
  return panel;
}

function renderGateIntroPreviewCard(gate, copy = ADMIN_COPY.contentViews.gate) {
  const card = createElement('section', { className: 'cms-admin-data-card cms-admin-gate-preview-card cms-admin-gate-intro-preview-card' });
  card.appendChild(renderDataCardTitle('Người xem sẽ thấy', gate.is_active ? ADMIN_COPY.maps.status.active : ADMIN_COPY.maps.status.inactive));
  card.appendChild(renderDataGroup('Nội dung chính', renderKeyValueList(filterVisibleRows([
    ['Nhãn nhỏ', gate.eyebrow],
    ['Tiêu đề', gate.title],
    ['Mô tả', gate.description],
    ['Nhãn quay lại Trang chủ', gate.back_label],
    ['Trạng thái', getActiveLabel(Boolean(gate.is_active))],
  ]))));
  return card;
}

function renderGateIntroActionCard(state, gate, copy = ADMIN_COPY.contentViews.gate) {
  const card = createElement('section', { className: 'cms-admin-data-card cms-admin-gate-action-card' });
  card.appendChild(renderDataCardTitle('Chỉnh sửa Màn chọn không gian', 'Bản nháp trong CMS'));
  card.appendChild(createElement('p', {
    className: 'cms-admin-compact-copy',
    text: 'Chỉ mở form sửa nhãn nhỏ, tiêu đề, mô tả và nhãn quay lại Trang chủ. Không mở form indoor/outdoor trong tab này.',
  }));
  const actions = createElement('div', { className: 'cms-admin-settings-edit-actions cms-admin-gate-edit-actions' });
  if (canEditGateContent(state)) {
    const button = createElement('button', {
      className: 'cms-admin-button cms-admin-button-primary',
      text: 'Chỉnh sửa Màn chào',
      type: 'button',
    });
    button.addEventListener('click', () => startGateContextualEdit(gate, 'intro', 'eyebrow'));
    actions.appendChild(button);
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: copy.edit?.safeNote || 'Lưu bản nháp chưa làm đổi website.' }));
  } else {
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: copy.edit?.noPermission || 'Tài khoản hiện tại chỉ được xem Cổng vào triển lãm.' }));
  }
  card.appendChild(actions);
  return card;
}

function renderGateRoomWorkspacePanel(state, gate, roomKey, editState = {}, copy = ADMIN_COPY.contentViews.gate) {
  const room = getGateRoomData(gate, roomKey);
  const label = getGateRoomLabel(roomKey);
  const isEditing = Boolean(editState.isEditing && getGateWorkspaceSectionKey(getWorkspaceActiveTab('gate', getWorkspaceTabs('gate'))) === roomKey);
  const panel = createElement('section', {
    className: `cms-admin-panel cms-admin-view-panel cms-admin-gate-section-panel cms-admin-gate-room-section-panel cms-admin-gate-room-section-${roomKey}${isEditing ? ' is-editing' : ''}`,
    dataset: { cmsReferenceTarget: 'gate-room', cmsReferenceId: roomKey },
  });
  panel.appendChild(renderPanelTitle(label, isEditing ? 'Đang chỉnh bản nháp' : getGateRoomTone(roomKey)));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-operator-summary',
    text: `Kiểm tra và chỉnh chữ hiển thị của ${label.toLowerCase()}. Đường dẫn kỹ thuật vào phòng vẫn giữ nguyên.`,
  }));

  const left = createElement('div', { className: 'cms-admin-gate-left-flow' });
  if (isEditing) {
    left.appendChild(renderGateRoomContextualEditPanel(roomKey, gate, editState, copy));
  } else {
    left.appendChild(renderGateRoomPreviewCard(roomKey, room, copy));
    left.appendChild(renderGateTechnicalDetails('Thông tin kỹ thuật để đối chiếu', getGateRoomTechnicalRows(roomKey, room), 'cms-admin-gate-room-technical-details'));
  }
  const rail = renderGateContextualChecklistPanel(state, gate, roomKey, editState, copy, { isEditing });
  panel.appendChild(renderGateContextualWorkspace(left, rail, roomKey));
  return panel;
}

function renderGateRoomPreviewCard(roomKey, room, copy = ADMIN_COPY.contentViews.gate) {
  const card = createElement('section', { className: 'cms-admin-data-card cms-admin-gate-preview-card cms-admin-gate-room-preview-card' });
  card.appendChild(renderDataCardTitle('Người xem sẽ thấy', getGateRoomTone(roomKey)));
  const roomCtaLabel = getGateRoomCtaLabel(room);
  card.appendChild(renderDataGroup('Nội dung không gian', renderKeyValueList(filterVisibleRows([
    ['Tên hiển thị', firstText(room, ['label', 'title', 'name'])],
    ['Mô tả', firstText(room, ['description', 'lead', 'subtitle'])],
    ['Nút bắt đầu tham quan', roomCtaLabel],
  ]))));
  if (isBlank(roomCtaLabel)) {
    card.appendChild(renderCompactNotice('Chưa khai báo nhãn nút bắt đầu tham quan trong dữ liệu gốc. Không tạo nút rỗng mới.'));
  }
  return card;
}

function renderGateRoomActionCard(state, gate, roomKey, copy = ADMIN_COPY.contentViews.gate) {
  const label = getGateRoomLabel(roomKey);
  const card = createElement('section', { className: 'cms-admin-data-card cms-admin-gate-action-card' });
  card.appendChild(renderDataCardTitle(`Chỉnh sửa ${label}`, 'Bản nháp trong CMS'));
  card.appendChild(createElement('p', {
    className: 'cms-admin-compact-copy',
    text: `Chỉ mở form sửa tên hiển thị, mô tả và nhãn nút của ${label.toLowerCase()} nếu dữ liệu gốc cho phép. Đường dẫn kỹ thuật vẫn chỉ xem.`,
  }));
  const actions = createElement('div', { className: 'cms-admin-settings-edit-actions cms-admin-gate-edit-actions' });
  if (canEditGateContent(state)) {
    const button = createElement('button', {
      className: 'cms-admin-button cms-admin-button-primary',
      text: `Chỉnh sửa ${label}`,
      type: 'button',
    });
    button.addEventListener('click', () => startGateContextualEdit(gate, roomKey, `rooms.${roomKey}.displayName`));
    actions.appendChild(button);
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: copy.edit?.safeNote || 'Lưu bản nháp chưa làm đổi website.' }));
  } else {
    actions.appendChild(createElement('span', { className: 'cms-admin-inline-note', text: copy.edit?.noPermission || 'Tài khoản hiện tại chỉ được xem Cổng vào triển lãm.' }));
  }
  card.appendChild(actions);
  return card;
}

function startGateContextualEdit(gate, tabKey = 'intro', focusField = 'eyebrow') {
  const sectionKey = getGateWorkspaceSectionKey(tabKey);
  const guard = requestStartEditSession({ type: 'gate', id: 'gate' });
  if (!guard.allowed) return;
  if (!guard.same) startGateEdit(gate);
  gateEditTargetKey = sectionKey;
  setWorkspaceTabState('gate', sectionKey);
  if (sectionKey === 'indoor' || sectionKey === 'outdoor') {
    queueEditPanelFocus('gate-room', sectionKey, focusField || `rooms.${sectionKey}.displayName`);
  } else {
    queueEditPanelFocus('gate-intro', gate.id || 'gate', focusField || 'eyebrow');
  }
  renderAdminShell();
}

function renderGateIntroEditPanel(state, gate, editState) {
  const copy = ADMIN_COPY.contentViews.gate.edit;
  const panel = createElement('section', {
    className: 'cms-admin-data-card cms-admin-gate-edit-panel cms-admin-gate-contextual-edit-panel cms-admin-gate-intro-edit-panel cms-admin-edit-panel-highlight',
    dataset: { cmsEditPanel: 'gate-intro', cmsEditId: gate.id || 'gate' },
  });
  panel.appendChild(renderDataCardTitle('Đang chỉnh sửa Màn chọn không gian', copy.enabledScope));
  panel.appendChild(renderCompactNotice('Form này chỉ sửa nội dung Màn chọn không gian. Không ảnh hưởng chữ của hai không gian còn lại.'));
  if (editState.saveError) panel.appendChild(renderNoticeBox(`${copy.error} ${normalizeErrorMessage(editState.saveError)}`, 'error'));
  if (editState.saveSuccess) panel.appendChild(renderNoticeBox(editState.saveSuccess, 'success'));

  const form = createElement('form', { className: 'cms-admin-edit-form cms-admin-gate-edit-form cms-admin-gate-contextual-edit-form', attrs: { novalidate: 'true' } });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleSaveGateContentDraft();
  });

  const mainGroup = createElement('section', { className: 'cms-admin-gate-form-section cms-admin-gate-primary-edit-group' });
  mainGroup.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: 'Nội dung chính' }));
  const mainFields = createElement('div', { className: 'cms-admin-edit-field-grid cms-admin-gate-main-field-grid' });
  mainFields.appendChild(renderGateEditableTextField('eyebrow', copy.fields.eyebrow, editState, { placeholder: copy.placeholders.eyebrow }));
  mainFields.appendChild(renderGateEditableTextField('title', copy.fields.title, editState, { required: true, placeholder: copy.placeholders.title }));
  mainFields.appendChild(renderGateEditableTextField('description', copy.fields.description, editState, { multiline: true, placeholder: copy.placeholders.description }));
  mainFields.appendChild(renderGateEditableTextField('back_label', copy.fields.back_label, editState, { placeholder: copy.placeholders.back_label }));
  mainGroup.appendChild(mainFields);
  form.appendChild(mainGroup);

  form.appendChild(renderEditActionBlock(editState, copy, {
    onCancel: handleCancelGateEdit,
    onReset: () => handleResetActiveDraft('gate'),
  }));
  form.appendChild(renderGateDirtyNotice(editState, copy));
  form.appendChild(renderGateTechnicalDetails(copy.technicalTitle || 'Thông tin kỹ thuật chỉ xem', [
    [copy.fields.active, getActiveLabel(Boolean(gate.is_active)), 'Không chỉnh ở form Màn chào.'],
    ['Content id', gate.id, 'Chỉ dùng để đối chiếu.'],
    ['Đường dẫn kỹ thuật', 'gallery.html?room=indoor / gallery.html?room=outdoor', copy.jsonSafeNote],
    ['Dữ liệu trình chỉnh sửa', gate.editor_json ? 'Đã có dữ liệu kỹ thuật' : '—', copy.editorReadonly],
  ], 'cms-admin-gate-edit-technical-details'));

  form.addEventListener('input', () => updateGateFormControls(form));
  form.addEventListener('change', () => updateGateFormControls(form));
  panel.appendChild(form);
  return panel;
}

function renderGateRoomContextualEditPanel(roomKey, gate, editState) {
  const copy = ADMIN_COPY.contentViews.gate.edit;
  const label = getGateRoomLabel(roomKey);
  const roomDraft = editState.draftValues?.rooms?.[roomKey] || {};
  const originalRoom = getGateRoomData(gate, roomKey);
  const panel = createElement('section', {
    className: `cms-admin-data-card cms-admin-gate-edit-panel cms-admin-gate-contextual-edit-panel cms-admin-gate-room-contextual-edit-panel cms-admin-gate-${roomKey}-edit-panel cms-admin-edit-panel-highlight`,
    dataset: { cmsEditPanel: 'gate-room', cmsEditId: roomKey },
  });
  panel.appendChild(renderDataCardTitle(`Đang chỉnh sửa ${label}`, 'Bản nháp trong CMS'));
  panel.appendChild(renderCompactNotice(`Form này chỉ sửa chữ hiển thị của ${label.toLowerCase()}. Không ảnh hưởng Màn chọn không gian hoặc không gian còn lại.`));
  if (editState.saveError) panel.appendChild(renderNoticeBox(`${copy.error} ${normalizeErrorMessage(editState.saveError)}`, 'error'));
  if (editState.saveSuccess) panel.appendChild(renderNoticeBox(editState.saveSuccess, 'success'));

  const form = createElement('form', { className: 'cms-admin-edit-form cms-admin-gate-edit-form cms-admin-gate-contextual-edit-form', attrs: { novalidate: 'true' } });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleSaveGateContentDraft();
  });

  const mainGroup = createElement('section', { className: 'cms-admin-gate-form-section cms-admin-gate-primary-edit-group' });
  mainGroup.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: 'Nội dung chính' }));
  const fields = createElement('div', { className: 'cms-admin-edit-field-grid cms-admin-gate-main-field-grid' });
  fields.appendChild(renderGateRoomTextField(roomKey, 'displayName', copy.fields.displayName, roomDraft, editState, { required: true, placeholder: copy.placeholders.displayName }));
  fields.appendChild(renderGateRoomTextField(roomKey, 'description', copy.fields.roomDescription, roomDraft, editState, { multiline: true, placeholder: copy.placeholders.roomDescription }));
  if (roomDraft.ctaEditable) {
    fields.appendChild(renderGateRoomTextField(roomKey, 'ctaLabel', copy.fields.ctaLabel, roomDraft, editState, { placeholder: copy.placeholders.ctaLabel }));
  } else {
    fields.appendChild(createElement('p', { className: 'cms-admin-compact-copy cms-admin-gate-cta-note', text: copy.noCtaLabel }));
  }
  mainGroup.appendChild(fields);
  form.appendChild(mainGroup);

  form.appendChild(renderEditActionBlock(editState, copy, {
    onCancel: handleCancelGateEdit,
    onReset: () => handleResetActiveDraft('gate'),
  }));
  form.appendChild(renderGateDirtyNotice(editState, copy));
  form.appendChild(renderGateTechnicalDetails(copy.technicalTitle || 'Thông tin kỹ thuật chỉ xem', getGateRoomTechnicalRows(roomKey, originalRoom, copy), 'cms-admin-gate-edit-technical-details'));

  form.addEventListener('input', () => updateGateFormControls(form));
  form.addEventListener('change', () => updateGateFormControls(form));
  panel.appendChild(form);
  return panel;
}

function renderGateDirtyNotice(editState = {}, copy = {}) {
  return createElement('p', {
    className: `cms-admin-dirty-notice${editState.dirty ? '' : ' cms-admin-hidden'}`,
    text: copy.dirty || 'Có thay đổi chưa lưu.',
    attrs: { role: 'status' },
  });
}

function getGateRoomTechnicalRows(roomKey, room = {}, copy = ADMIN_COPY.contentViews.gate.edit) {
  const normalized = normalizePlainObject(room);
  const ctaObject = normalizePlainObject(firstValue(normalized, ['cta', 'button', 'action']));
  return [
    [copy.fields?.roomKey || 'Mã phòng kỹ thuật', roomKey, 'Không chỉnh ở form nội dung.'],
    [copy.fields?.route || 'Đường dẫn tham quan', `gallery.html?room=${roomKey}`, 'Đường dẫn kỹ thuật giữ nguyên.'],
    ['Đường dẫn kỹ thuật của nút', firstText(ctaObject, ['href', 'url', 'link', 'path', 'to', 'route', 'query']) || firstText(normalized, ['href', 'url', 'link', 'path', 'to', 'route', 'query']) || '—', 'Chỉ đối chiếu, không chỉnh ở phase này.'],
    ['Dữ liệu phòng', normalized ? 'Đã đọc dữ liệu kỹ thuật' : '—', 'Dữ liệu gốc vẫn được giữ nguyên.'],
  ];
}

function renderGateTechnicalDetails(summary = 'Thông tin kỹ thuật để đối chiếu', rows = [], className = '') {
  const details = createElement('details', { className: `cms-admin-gate-technical-details${className ? ` ${className}` : ''}` });
  details.appendChild(createElement('summary', { className: 'cms-admin-gate-technical-summary', text: summary }));
  const grid = createElement('div', { className: 'cms-admin-readonly-field-grid cms-admin-gate-technical-grid' });
  const visibleRows = filterVisibleRows(rows);
  if (visibleRows.length) {
    visibleRows.forEach(([label, value, note]) => grid.appendChild(renderReadonlyField(label, value, note)));
  } else {
    grid.appendChild(renderCompactNotice('Không có thông tin kỹ thuật bổ sung.'));
  }
  details.appendChild(grid);
  return details;
}

function renderDashboard(state) {
  return renderDashboardCommandCenter(state);
}

function renderMediaTab(state, activeKey = 'library') {
  const model = buildMediaWorkspaceModel(state);
  if (activeKey === 'usage') return renderMediaUsageWorkspace(model);
  return renderMediaLibraryWorkspace(model);
}

function buildMediaWorkspaceModel(state = {}) {
  const uploadAssets = safeArray(state.data?.cmsMediaUploads).map(normalizeMediaLibraryAsset);
  const mediaError = state.data?.errors?.cmsMediaUploads;
  const usageContext = buildMediaUsageContext(state);
  const enrichedUploads = uploadAssets.map((asset) => {
    const withSource = {
      ...asset,
      sourceKind: 'upload-log',
      sourceLabel: 'Upload log / cms_media_uploads',
      hasUploadLogRecord: true,
    };
    return {
      ...withSource,
      lifecycle: getMediaLifecycleState(withSource),
      usage: getMediaUsage(withSource, usageContext),
    };
  });
  const deletedUploadAssets = enrichedUploads.filter(isDeletedMediaAsset);
  const activeUploadAssets = enrichedUploads.filter((asset) => !isDeletedMediaAsset(asset));
  const virtualReferences = collectVirtualMediaInventoryReferences(usageContext.sources);
  const virtualAssets = buildVirtualMediaAssets(virtualReferences, activeUploadAssets, deletedUploadAssets);
  const allAssets = [...activeUploadAssets, ...virtualAssets];
  if (mediaWorkspaceState.selectedAssetId && !allAssets.some((asset) => asset.id === mediaWorkspaceState.selectedAssetId)) {
    mediaWorkspaceState.selectedAssetId = '';
  }
  if (!mediaWorkspaceState.selectedAssetId && allAssets.length) {
    mediaWorkspaceState.selectedAssetId = allAssets[0].id || '';
  }
  const selectedAsset = mediaWorkspaceState.selectedAssetId
    ? (allAssets.find((asset) => asset.id === mediaWorkspaceState.selectedAssetId) || null)
    : null;
  const summary = summarizeMediaLibrary(allAssets);
  summary.activeUploadLog = activeUploadAssets.length;
  summary.deleted = deletedUploadAssets.length;
  summary.uploadLogTotal = enrichedUploads.length;
  summary.brokenReference = allAssets.filter(isBrokenDeletedMediaReference).length;
  return {
    state,
    mediaError,
    usageContext,
    uploadAssets: activeUploadAssets,
    activeUploadAssets,
    deletedUploadAssets,
    virtualAssets,
    virtualReferences,
    allAssets,
    selectedAsset,
    summary,
  };
}

function renderMediaLibraryWorkspace(model = {}) {
  const panel = createElement('section', { className: 'cms-admin-media-workspace-tab cms-admin-media-library-workspace' });
  const library = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-media-library-panel' });
  library.appendChild(renderPanelTitle('Thư viện ảnh & video', `${formatCount(model.activeUploadAssets?.length || 0)} media active · ${formatCount(model.deletedUploadAssets?.length || 0)} đã xóa`));
  library.appendChild(renderMediaLibraryReadOnlyBanner());
  library.appendChild(renderMediaCountClarityNotice(model));
  library.appendChild(renderMediaCapabilityPolicyPanel(model));
  library.appendChild(renderMediaVirtualInventoryNotice(model));

  if (model.mediaError) {
    library.appendChild(renderErrorBox(model.mediaError, 'Không đọc được danh sách media upload'));
  }

  if (!safeArray(model.activeUploadAssets).length) {
    library.appendChild(renderMediaLibraryEmptyState());
  } else {
    library.appendChild(renderMediaLibrarySummary(model.summary));
    library.appendChild(renderMediaLibraryControls(model.activeUploadAssets));
    library.appendChild(renderMediaProfessionalWorkspace(model, {
      mode: 'library',
      assets: model.activeUploadAssets,
      title: 'Danh sách media active',
      subtitle: 'Chọn một ảnh/video còn usable để xem inspector và thao tác an toàn ở hai card bên cạnh. Media đã xóa được chuyển xuống audit lifecycle, không còn là lựa chọn active.',
      emptyText: 'Không có media active phù hợp với bộ lọc hiện tại.',
    }));
  }

  library.appendChild(renderMediaDeletedLifecyclePanel(model));
  panel.appendChild(library);
  panel.appendChild(renderMediaLibrarySafetyPanel());
  return panel;
}

function renderMediaVirtualInventoryNotice(model = {}) {
  const virtualCount = safeArray(model.virtualAssets).length;
  const notice = createElement('div', { className: 'cms-admin-media-virtual-inventory-notice' });
  notice.appendChild(renderBadge(virtualCount ? `${formatCount(virtualCount)} tham chiếu ảo` : 'Không có tham chiếu ảo', virtualCount ? 'warning' : 'default'));
  const text = virtualCount
    ? 'Ngoài upload log, hệ thống đã surface read-only các media đang được CMS JSON/bản nháp tham chiếu nhưng có thể chưa có record trong cms_media_uploads. Mở tab Đang dùng để xem owner.'
    : 'Chưa phát hiện media reference ngoài upload log trong dữ liệu đã tải.';
  notice.appendChild(createElement('p', { text }));
  return notice;
}

function renderMediaCountClarityNotice(model = {}) {
  const notice = createElement('div', { className: 'cms-admin-media-count-clarity-notice' });
  notice.appendChild(renderBadge('Inventory vận hành', 'info'));
  notice.appendChild(createElement('p', {
    text: `Media active: ${formatCount(model.activeUploadAssets?.length || 0)} record usable. Upload log giữ truy vết: ${formatCount((model.activeUploadAssets?.length || 0) + (model.deletedUploadAssets?.length || 0))} record, trong đó ${formatCount(model.deletedUploadAssets?.length || 0)} đã xóa khỏi Storage. Media/path đang được nội dung tham chiếu: ${formatCount(model.virtualReferences?.length || 0)} field/path đã scan. Reference-only: ${formatCount(model.virtualAssets?.length || 0)} media/path; ${formatCount((model.virtualAssets || []).filter(isBrokenDeletedMediaReference).length)} tham chiếu hỏng tới path đã xóa. Đây không phải bucket crawler đầy đủ; một file có thể xuất hiện ở nhiều field/owner.`,
  }));
  return notice;
}

function renderMediaCapabilityPolicyPanel(model = {}) {
  const panel = createElement('section', { className: 'cms-admin-media-capability-policy-panel' });
  panel.appendChild(renderPanelTitle('Upload và xóa media', 'Xóa có kiểm soát / upload chưa bật'));
  panel.appendChild(createElement('p', {
    text: 'Màn này xem, lọc, preview, sao chép đường dẫn, điều hướng tới nơi dùng media và chỉ cho phép xóa single-media khi server xác nhận zero-reference. Upload vẫn thực hiện ở màn nội dung có owner/field cụ thể. Xóa media xóa object khỏi Storage nhưng không xóa audit log.',
  }));
  const notes = createElement('div', { className: 'cms-admin-media-policy-note-grid' });
  [
    ['Upload chưa bật', 'Muốn thay ảnh/video cho nội dung nào, hãy mở đúng màn nội dung đó và dùng nút thay/chọn media trong ngữ cảnh owner/field.'],
    ['Xóa có guard', 'Chỉ media active có upload-log/path hợp lệ, không còn reference public/draft/CMS và nhập đúng confirm phrase mới được xóa. Media đã xóa chỉ còn audit log, không còn usable.'],
  ].forEach(([title, body]) => {
    const item = createElement('article', { className: 'cms-admin-media-policy-note' });
    item.appendChild(createElement('strong', { text: title }));
    item.appendChild(createElement('p', { text: body }));
    notes.appendChild(item);
  });
  panel.appendChild(notes);
  return panel;
}

function renderMediaDeletePolicyList() {
  const list = createElement('ul', { className: 'cms-admin-media-delete-policy-list' });
  [
    'Không xóa reference-only / virtual media.',
    'Không xóa media đang có tham chiếu ở public, draft hoặc CMS.',
    'Không xóa khi thiếu upload-log record, bucket/path hoặc safe delete helper.',
    'Không chạy cleanup/delete hàng loạt từ màn Ảnh & video.',
  ].forEach((item) => list.appendChild(createElement('li', { text: item })));
  return list;
}

function renderMediaDeletedLifecyclePanel(model = {}) {
  const deletedAssets = safeArray(model.deletedUploadAssets);
  const brokenRefs = safeArray(model.virtualAssets).filter(isBrokenDeletedMediaReference);
  if (!deletedAssets.length && !brokenRefs.length) return createElement('div', { className: 'cms-admin-hidden' });

  const panel = createElement('details', { className: 'cms-admin-media-lifecycle-panel' });
  panel.appendChild(createElement('summary', { text: `Media đã xóa / tham chiếu hỏng (${formatCount(deletedAssets.length + brokenRefs.length)})` }));
  panel.appendChild(renderCompactNotice('Các record này chỉ phục vụ audit/lifecycle. File đã xóa khỏi Storage không còn là media active; nếu nội dung còn trỏ tới path đã xóa, hãy cập nhật tại màn nội dung tương ứng.'));

  if (deletedAssets.length) {
    const deletedList = createElement('div', { className: 'cms-admin-media-lifecycle-list' });
    deletedAssets.slice(0, 30).forEach((asset) => deletedList.appendChild(renderDeletedMediaLifecycleCard(asset, 'deleted')));
    panel.appendChild(deletedList);
    if (deletedAssets.length > 30) panel.appendChild(createElement('p', { className: 'cms-admin-help-text', text: `+${formatCount(deletedAssets.length - 30)} record đã xóa khác đang được giữ trong upload log.` }));
  }

  if (brokenRefs.length) {
    const brokenTitle = createElement('div', { className: 'cms-admin-media-lifecycle-subtitle' });
    brokenTitle.appendChild(renderBadge('Tham chiếu hỏng', 'danger'));
    brokenTitle.appendChild(createElement('p', { text: 'Những path này vẫn xuất hiện trong content/reference scan nhưng trùng với media đã xóa khỏi Storage.' }));
    panel.appendChild(brokenTitle);
    const brokenList = createElement('div', { className: 'cms-admin-media-lifecycle-list' });
    brokenRefs.slice(0, 30).forEach((asset) => brokenList.appendChild(renderDeletedMediaLifecycleCard(asset, 'broken')));
    panel.appendChild(brokenList);
    if (brokenRefs.length > 30) panel.appendChild(createElement('p', { className: 'cms-admin-help-text', text: `+${formatCount(brokenRefs.length - 30)} tham chiếu hỏng khác.` }));
  }
  return panel;
}

function renderDeletedMediaLifecycleCard(asset = {}, mode = 'deleted') {
  const card = createElement('article', { className: `cms-admin-media-lifecycle-card cms-admin-media-lifecycle-card-${mode}` });
  const heading = createElement('div', { className: 'cms-admin-media-lifecycle-card-heading' });
  heading.appendChild(createElement('strong', { text: asset.fileName || asset.storagePath || asset.publicUrlRaw || 'Media đã xóa' }));
  heading.appendChild(renderBadge(mode === 'broken' ? 'Tham chiếu hỏng' : 'Đã xóa khỏi Storage', 'danger'));
  heading.appendChild(renderBadge('Audit log', 'default'));
  card.appendChild(heading);
  const details = createElement('dl', { className: 'cms-admin-media-detail-list cms-admin-media-lifecycle-details' });
  [
    ['Lifecycle', mode === 'broken' ? 'Path đã xóa nhưng còn reference trong content' : 'Record upload giữ để truy vết, file không còn usable'],
    ['Status', asset.status || 'deleted'],
    ['Owner target', asset.ownerLabel || getMediaTargetLabel(asset)],
    ['Path', asset.storagePath || asset.publicUrlRaw || asset.publicUrl || '—'],
    ['Tham chiếu', safeArray(asset.usage?.references).length ? `${formatCount(asset.usage.references.length)} reference cần kiểm tra` : 'Chưa thấy reference active trong dữ liệu đã tải'],
  ].forEach(([label, value]) => appendMediaDetail(details, label, value));
  card.appendChild(details);
  if (safeArray(asset.usage?.references).length) card.appendChild(renderMediaUsageReferences(asset));
  return card;
}


function renderMediaLibrarySafetyPanel() {
  const safety = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-media-safety-panel' });
  safety.appendChild(renderPanelTitle('Giới hạn an toàn của phase này', ADMIN_COPY.media.readOnlyBadge));
  const safetyList = createElement('ul', { className: 'cms-admin-media-safety-list' });
  [
    ADMIN_COPY.media.safeNotice,
    ADMIN_COPY.media.readOnlyNotice,
    ADMIN_COPY.media.deleteDisabled,
  ].forEach((item) => safetyList.appendChild(createElement('li', { text: item })));
  safety.appendChild(safetyList);
  safety.appendChild(renderMediaOperatorHandoffNotes());

  const technical = createElement('details', { className: 'cms-admin-media-technical-details' });
  technical.appendChild(createElement('summary', { text: ADMIN_COPY.media.technicalTitle }));
  technical.appendChild(renderTechnicalKeyValueList(ADMIN_COPY.media.technicalRows));
  safety.appendChild(technical);
  return safety;
}

function renderMediaUsageWorkspace(model = {}) {
  const panel = createElement('section', { className: 'cms-admin-media-workspace-tab cms-admin-media-usage-workspace' });
  const header = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-media-usage-header' });
  header.appendChild(renderPanelTitle('Media đang dùng', `${formatCount(model.virtualReferences?.length || 0)} tham chiếu`));
  header.appendChild(renderCompactNotice('Ma trận này gom media reference từ upload log, CMS JSON, bản nháp và dữ liệu đã tải. Đây là bề mặt read-only, không upload/xóa/công khai.'));
  header.appendChild(renderMediaLibrarySummary(model.summary));
  panel.appendChild(header);

  const usageAssets = safeArray(model.allAssets).filter((asset) => !isDeletedMediaAsset(asset) && !isBrokenDeletedMediaReference(asset) && (safeArray(asset.usage?.references).length || !asset.hasUploadLogRecord));
  if (!usageAssets.length) {
    const empty = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel' });
    empty.appendChild(renderEmptyState('Chưa tìm thấy media reference trong dữ liệu đã tải. Không đồng nghĩa media an toàn để xóa.'));
    panel.appendChild(empty);
    return panel;
  }

  panel.appendChild(renderMediaProfessionalWorkspace(model, {
    mode: 'usage',
    assets: usageAssets,
    title: 'Danh sách media đang dùng',
    subtitle: 'Chọn media/reference để xem owner, field/path và thao tác không ghi dữ liệu.',
    emptyText: 'Không có media đang dùng phù hợp.',
  }));
  return panel;
}

function renderMediaProfessionalWorkspace(model = {}, options = {}) {
  const assets = safeArray(options.assets);
  ensureMediaWorkspaceSelection(assets, model.allAssets);
  const selected = getSelectedMediaAsset(assets, model.allAssets);
  const workspace = createElement('section', {
    className: `cms-admin-media-pro-workspace cms-admin-media-pro-workspace-${options.mode || 'library'}`,
    attrs: { 'data-media-pro-workspace': options.mode || 'library' },
  });
  workspace.appendChild(renderMediaMasterListCard(assets, {
    title: options.title || 'Danh sách media',
    subtitle: options.subtitle || 'Chọn media để xem thông tin và thao tác an toàn.',
    emptyText: options.emptyText || ADMIN_COPY.media.emptyFiltered,
  }));
  workspace.appendChild(renderMediaInspectorCard(selected));
  workspace.appendChild(renderMediaActionSafetyCard(selected));
  return workspace;
}

function ensureMediaWorkspaceSelection(visibleAssets = [], allAssets = []) {
  const visible = safeArray(visibleAssets).filter((asset) => asset?.id);
  const currentId = String(mediaWorkspaceState.selectedAssetId || '');
  if (currentId && visible.some((asset) => String(asset.id) === currentId)) return;
  const fallback = visible[0] || null;
  mediaWorkspaceState.selectedAssetId = fallback?.id || '';
}

function getSelectedMediaAsset(visibleAssets = [], allAssets = []) {
  const id = String(mediaWorkspaceState.selectedAssetId || '');
  if (!id) return null;
  return safeArray(visibleAssets).find((asset) => String(asset.id) === id) || null;
}

function getMediaLifecycleState(asset = {}) {
  const status = String(asset.status || '').trim().toLowerCase();
  const confirmState = getMediaDeleteConfirmState(asset);
  const deletedByLocalConfirm = Boolean(confirmState?.data?.deleted || confirmState?.data?.result === 'confirmed');
  if (status === 'deleted' || deletedByLocalConfirm) {
    return {
      key: 'deleted',
      label: 'Đã xóa khỏi Storage',
      variant: 'danger',
      note: 'Record upload được giữ để truy vết; file không còn là media active/usable.',
    };
  }
  if (asset.isBrokenDeletedReference) {
    return {
      key: 'broken-reference',
      label: 'Tham chiếu hỏng',
      variant: 'danger',
      note: 'Nội dung vẫn trỏ tới path đã xóa khỏi Storage; cần cập nhật ở màn nội dung tương ứng.',
    };
  }
  return {
    key: 'active',
    label: 'Active media',
    variant: 'success',
    note: 'Media đang được xem như record active trong inventory vận hành.',
  };
}

function isDeletedMediaAsset(asset = {}) {
  return getMediaLifecycleState(asset).key === 'deleted';
}

function isBrokenDeletedMediaReference(asset = {}) {
  return Boolean(asset?.isBrokenDeletedReference || getMediaLifecycleState(asset).key === 'broken-reference');
}

function getDeletedMediaIdentitySet(deletedAssets = []) {
  const deletedIdentity = new Set();
  safeArray(deletedAssets).forEach((asset) => {
    buildMediaAssetIdentity(asset).strongValues.forEach((value) => deletedIdentity.add(value));
  });
  return deletedIdentity;
}

function renderMediaLifecycleBadge(asset = {}) {
  const lifecycle = getMediaLifecycleState(asset);
  if (lifecycle.key === 'active') return null;
  return renderBadge(lifecycle.label, lifecycle.variant || 'default');
}

function renderMediaMasterListCard(assets = [], options = {}) {
  const card = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-media-master-card' });
  card.appendChild(renderPanelTitle(options.title || 'Danh sách media', `${formatCount(assets.length)} mục`));
  if (options.subtitle) card.appendChild(createElement('p', { className: 'cms-admin-help-text cms-admin-media-master-subtitle', text: options.subtitle }));
  if (!assets.length) {
    card.appendChild(renderEmptyState(options.emptyText || ADMIN_COPY.media.emptyFiltered));
    return card;
  }
  const list = createElement('div', { className: 'cms-admin-media-master-list', attrs: { role: 'listbox', 'aria-label': 'Danh sách media để chọn' } });
  safeArray(assets).forEach((asset) => list.appendChild(renderMediaMasterListItem(asset)));
  const empty = createElement('div', {
    className: 'cms-admin-media-filter-empty cms-admin-hidden',
    text: options.emptyText || ADMIN_COPY.media.emptyFiltered,
    attrs: { 'data-media-filter-empty': 'true', role: 'status', 'aria-live': 'polite' },
  });
  card.appendChild(list);
  card.appendChild(empty);
  return card;
}

function renderMediaMasterListItem(asset = {}) {
  const isSelected = String(asset.id || '') === String(mediaWorkspaceState.selectedAssetId || '');
  const item = createElement('button', {
    className: `cms-admin-media-card cms-admin-media-master-item${isSelected ? ' is-selected' : ''}${isBrokenDeletedMediaReference(asset) ? ' is-broken-reference' : ''}${isDeletedMediaAsset(asset) ? ' is-deleted-media' : ''}`,
    type: 'button',
    attrs: {
      role: 'option',
      'aria-selected': isSelected ? 'true' : 'false',
      'data-media-kind': asset.mediaKind,
      'data-media-usage': asset.usage?.key || 'insufficient',
      'data-media-target': asset.targetType || 'unknown',
      'data-media-search-text': buildMediaSearchText(asset),
      'data-media-asset-id': String(asset.id || ''),
    },
  });
  item.addEventListener('click', () => selectMediaWorkspaceAsset(asset.id));
  const previewWrap = createElement('div', { className: 'cms-admin-media-master-thumb' });
  previewWrap.appendChild(renderMediaPreview(asset));
  const copy = createElement('div', { className: 'cms-admin-media-master-copy' });
  copy.appendChild(createElement('strong', { text: asset.fileName || asset.storagePath || 'media' }));
  const badges = createElement('div', { className: 'cms-admin-media-card-badges cms-admin-media-master-badges' });
  badges.appendChild(renderBadge(getMediaKindLabel(asset.mediaKind), asset.mediaKind === 'video' ? 'warning' : 'default'));
  const lifecycleBadge = renderMediaLifecycleBadge(asset);
  if (lifecycleBadge) badges.appendChild(lifecycleBadge);
  badges.appendChild(renderBadge(asset.hasUploadLogRecord ? 'Upload log' : 'Reference-only', asset.hasUploadLogRecord ? 'success' : 'warning'));
  badges.appendChild(renderBadge(asset.usage?.label || ADMIN_COPY.media.usageLabels.insufficient, asset.usage?.variant || 'default'));
  copy.appendChild(badges);
  const meta = createElement('p', {
    className: 'cms-admin-media-master-meta',
    text: `${getMediaTargetLabel(asset)} · ${asset.roomKey ? getRoomLabel(asset.roomKey) : 'Không rõ phòng'} · ${asset.itemId || asset.artworkCode || 'Không rõ item'}`,
  });
  copy.appendChild(meta);
  appendChildren(item, [previewWrap, copy]);
  return item;
}

function renderMediaInspectorCard(asset = null) {
  const card = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-media-inspector-card' });
  card.appendChild(renderPanelTitle('Thông tin media', asset ? 'Đang xem media đã chọn' : 'Chọn media'));
  if (!asset) {
    card.appendChild(renderEmptyState('Chọn một media ở danh sách để xem thông tin.'));
    return card;
  }
  card.appendChild(createElement('p', {
    className: 'cms-admin-help-text cms-admin-media-inspector-context',
    text: 'Inspector gọn cho media đang chọn. Tên file, URL/path dài và metadata kỹ thuật nằm trong tab Tham chiếu & kỹ thuật.',
  }));
  card.appendChild(renderMediaInspectorInternalTabs(asset));
  const activeTab = mediaWorkspaceState.inspectorTab === 'technical' ? 'technical' : 'overview';
  if (activeTab === 'technical') {
    card.appendChild(renderMediaInspectorTechnical(asset));
  } else {
    card.appendChild(renderMediaInspectorOverview(asset));
  }
  return card;
}

function renderMediaInspectorInternalTabs(asset = {}) {
  const tabs = createElement('div', { className: 'cms-admin-media-inspector-tabs', attrs: { role: 'tablist', 'aria-label': 'Thông tin media đang chọn' } });
  [
    ['overview', 'Tổng quan'],
    ['technical', 'Tham chiếu & kỹ thuật'],
  ].forEach(([key, label]) => {
    const active = (mediaWorkspaceState.inspectorTab === 'technical' ? 'technical' : 'overview') === key;
    const button = createElement('button', {
      className: `cms-admin-workspace-tab-button cms-admin-media-inspector-tab${active ? ' is-active' : ''}`,
      text: label,
      type: 'button',
      attrs: { role: 'tab', 'aria-selected': active ? 'true' : 'false' },
    });
    button.addEventListener('click', () => setMediaInspectorTab(key));
    tabs.appendChild(button);
  });
  return tabs;
}

function setMediaInspectorTab(tabKey = 'overview') {
  mediaWorkspaceState.inspectorTab = tabKey === 'technical' ? 'technical' : 'overview';
  renderAdminShell();
}

function renderMediaInspectorOverview(asset = {}) {
  const layout = createElement('div', { className: 'cms-admin-media-inspector-overview cms-admin-media-inspector-overview-compact' });
  const badges = createElement('div', { className: 'cms-admin-media-card-badges cms-admin-media-inspector-badges' });
  badges.appendChild(renderBadge(getMediaKindLabel(asset.mediaKind), asset.mediaKind === 'video' ? 'warning' : 'default'));
  const lifecycleBadge = renderMediaLifecycleBadge(asset);
  if (lifecycleBadge) badges.appendChild(lifecycleBadge);
  badges.appendChild(renderBadge(asset.hasUploadLogRecord ? 'Upload log' : 'Reference-only', asset.hasUploadLogRecord ? 'success' : 'warning'));
  badges.appendChild(renderBadge(asset.usage?.label || ADMIN_COPY.media.usageLabels.insufficient, asset.usage?.variant || 'default'));
  layout.appendChild(badges);
  const lifecycle = getMediaLifecycleState(asset);
  if (lifecycle.key !== 'active') layout.appendChild(renderCompactNotice(lifecycle.note));
  const details = createElement('dl', { className: 'cms-admin-media-detail-list cms-admin-media-detail-list-wide cms-admin-media-inspector-facts' });
  [
    ['Loại media', getMediaKindLabel(asset.mediaKind)],
    ['Ngày upload', formatDateTime(asset.createdAt)],
    ['Dung lượng', formatBytes(asset.sizeBytes)],
    ['Phòng', asset.roomKey ? getRoomLabel(asset.roomKey) : '—'],
    ['Item', asset.itemId || asset.artworkCode || '—'],
    ['Trường media', formatMediaFieldName(asset.fieldName)],
    ['Trạng thái usage', asset.usage?.label || ADMIN_COPY.media.usageLabels.insufficient],
    ['Owner target', asset.ownerLabel || getMediaTargetLabel(asset)],
    ['Nguồn record', asset.hasUploadLogRecord ? 'Media upload log' : 'Reference-only / CMS reference'],
    ['Lifecycle', getMediaLifecycleState(asset).label],
  ].forEach(([label, value]) => appendMediaDetail(details, label, value));
  layout.appendChild(details);
  const note = safeArray(asset.usage?.references).length
    ? `${formatCount(asset.usage.references.length)} tham chiếu đã tìm thấy trong dữ liệu CMS đã kiểm tra.`
    : 'Chưa thấy tham chiếu trong dữ liệu đã kiểm tra. Không đồng nghĩa media an toàn để xóa.';
  layout.appendChild(renderCompactNotice(note));
  return layout;
}

function renderMediaInspectorTechnical(asset = {}) {
  const wrap = createElement('div', { className: 'cms-admin-media-inspector-technical' });
  wrap.appendChild(renderMediaUsageReferences(asset));
  const path = createElement('details', { className: 'cms-admin-media-technical-details cms-admin-media-path-details', attrs: { open: 'true' } });
  path.appendChild(createElement('summary', { text: 'Đường dẫn & tên file' }));
  path.appendChild(renderTechnicalKeyValueList([
    ['Tên file', asset.fileName || '—'],
    ['URL/path', asset.publicUrl || asset.publicUrlRaw || asset.storagePath || '—'],
  ]));
  wrap.appendChild(path);
  const technical = createElement('details', { className: 'cms-admin-media-technical-details' });
  technical.appendChild(createElement('summary', { text: 'Metadata kỹ thuật' }));
  technical.appendChild(renderTechnicalKeyValueList([
    ['ID', asset.id || '—'],
    ['Storage bucket', asset.storageBucket || '—'],
    ['Storage path', asset.storagePath || '—'],
    ['Public URL', asset.publicUrl || asset.publicUrlRaw || '—'],
    ['Target type', asset.targetType || '—'],
    ['Field', asset.fieldName || '—'],
    ['Source key', asset.sourceKey || '—'],
    ['Record upload', asset.hasUploadLogRecord ? 'Có' : 'Không / reference-only'],
  ]));
  wrap.appendChild(technical);
  return wrap;
}

function renderMediaActionSafetyCard(asset = null) {
  const card = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-media-action-card' });
  card.appendChild(renderPanelTitle('Thao tác & an toàn', asset ? 'Media đang chọn' : 'Chọn media'));
  if (!asset) {
    card.appendChild(renderEmptyState('Chọn media để sao chép đường dẫn, điều hướng hoặc kiểm tra điều kiện xóa.'));
    return card;
  }
  card.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Mọi thao tác ở đây chỉ xem/copy/điều hướng hoặc gọi prepareDelete. Xóa thật chưa bật.' }));
  const actions = createElement('div', { className: 'cms-admin-media-action-buttons' });
  if (asset.hasSafePublicUrl) {
    const copyButton = createElement('button', {
      className: 'cms-admin-button cms-admin-button-ghost',
      text: ADMIN_COPY.media.actions.copyUrl,
      type: 'button',
      attrs: { 'aria-label': buildCopyMediaUrlLabel(asset) },
    });
    copyButton.addEventListener('click', () => copyMediaUrl(copyButton, asset.publicUrl));
    actions.appendChild(copyButton);
  }
  const firstReference = safeArray(asset.usage?.references)[0];
  const navButton = firstReference ? renderMediaReferenceNavigationButton(firstReference) : null;
  if (navButton) actions.appendChild(navButton);
  if (!actions.childNodes.length) {
    actions.appendChild(createElement('span', { className: 'cms-admin-help-text', text: 'Media này chưa có URL an toàn hoặc owner rõ để thao tác nhanh.' }));
  }
  card.appendChild(actions);
  card.appendChild(renderMediaDeleteGuard(asset, { actionPanel: true }));
  card.appendChild(renderMediaLockedDeleteSection(asset));
  return card;
}

function renderMediaLockedDeleteSection(asset = {}) {
  const lifecycle = getMediaLifecycleState(asset);
  const section = createElement('section', { className: `cms-admin-media-locked-delete-section cms-admin-media-locked-delete-section-${lifecycle.key}` });
  section.appendChild(createElement('h3', { text: lifecycle.key === 'deleted' ? 'Media đã xóa' : lifecycle.key === 'broken-reference' ? 'Tham chiếu hỏng' : 'Xóa media' }));
  section.appendChild(createElement('p', {
    text: lifecycle.key === 'deleted'
      ? 'File đã xóa khỏi Storage; upload log/audit log được giữ để truy vết và không có nút xóa lại.'
      : lifecycle.key === 'broken-reference'
        ? 'Nội dung vẫn trỏ tới path đã xóa. Hãy cập nhật nội dung liên quan, không xóa thêm tại Media Library.'
        : 'Xóa thật chỉ mở trong kết quả prepare đủ điều kiện, sau khi nhập đúng confirm phrase. Server luôn revalidate zero-reference trước khi xóa.',
  }));
  const button = createElement('button', {
    className: 'cms-admin-button cms-admin-button-danger',
    text: lifecycle.key === 'active' ? 'Xóa media — khóa đến khi đủ điều kiện' : 'Không có thao tác xóa',
    type: 'button',
    attrs: { disabled: 'true', 'aria-disabled': 'true' },
  });
  section.appendChild(button);
  return section;
}

function renderMediaSelectedDetailPanel(selected = null, options = {}) {
  const detail = createElement('section', {
    className: 'cms-admin-panel cms-admin-view-panel cms-admin-media-selected-detail-panel',
    attrs: { 'data-media-selected-detail': 'true' },
  });
  const title = options.title || 'Chi tiết media đang chọn';
  const subtitle = selected ? (selected.fileName || selected.storagePath || selected.publicUrl || selected.id) : 'Chọn media để xem';
  const titleRow = createElement('div', { className: 'cms-admin-media-detail-title-row' });
  titleRow.appendChild(renderPanelTitle(title, subtitle));
  const closeButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost cms-admin-media-detail-close-button',
    text: 'Đóng chi tiết',
    type: 'button',
    ariaLabel: 'Đóng panel chi tiết media',
  });
  closeButton.addEventListener('click', () => options.onClose?.());
  titleRow.appendChild(closeButton);
  detail.appendChild(titleRow);
  if (options.subtitle) detail.appendChild(renderCompactNotice(options.subtitle));

  if (!selected) {
    detail.appendChild(renderEmptyState('Chọn một media ở Thư viện hoặc Đang dùng để xem chi tiết.'));
    return detail;
  }

  const layout = createElement('div', { className: 'cms-admin-media-detail-layout' });
  layout.appendChild(renderMediaPreview(selected));
  const body = createElement('div', { className: 'cms-admin-media-detail-body' });
  const badges = createElement('div', { className: 'cms-admin-media-card-badges' });
  badges.appendChild(renderBadge(getMediaKindLabel(selected.mediaKind), selected.mediaKind === 'video' ? 'warning' : 'default'));
  badges.appendChild(renderBadge(selected.sourceLabel || getMediaSourceLabel(selected), selected.hasUploadLogRecord ? 'success' : 'warning'));
  badges.appendChild(renderBadge(selected.usage?.label || ADMIN_COPY.media.usageLabels.insufficient, selected.usage?.variant || 'default'));
  body.appendChild(badges);

  const details = createElement('dl', { className: 'cms-admin-media-detail-list cms-admin-media-detail-list-wide' });
  [
    ['Tên/path', selected.fileName || selected.storagePath || '—'],
    ['Nguồn', selected.sourceLabel || getMediaSourceLabel(selected)],
    ['Loại', getMediaKindLabel(selected.mediaKind)],
    ['URL/path', selected.publicUrl || selected.publicUrlRaw || selected.storagePath || '—'],
    ['Owner', selected.ownerLabel || getMediaTargetLabel(selected)],
    ['Record upload', selected.hasUploadLogRecord ? 'Có trong cms_media_uploads' : 'Không có record upload log / chỉ là reference read-only'],
  ].forEach(([label, value]) => appendMediaDetail(details, label, value));
  body.appendChild(details);

  const actions = createElement('div', { className: 'cms-admin-media-actions' });
  if (selected.hasSafePublicUrl) {
    const copyButton = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost', text: ADMIN_COPY.media.actions.copyUrl, type: 'button' });
    copyButton.addEventListener('click', () => copyMediaUrl(copyButton, selected.publicUrl));
    actions.appendChild(copyButton);
  }
  body.appendChild(actions);
  body.appendChild(renderMediaDeleteGuard(selected, { detail: true }));
  body.appendChild(renderMediaUsageReferences(selected));

  const technical = createElement('details', { className: 'cms-admin-media-technical-details' });
  technical.appendChild(createElement('summary', { text: 'Metadata kỹ thuật' }));
  technical.appendChild(renderTechnicalKeyValueList([
    ['ID', selected.id || '—'],
    ['Storage bucket', selected.storageBucket || '—'],
    ['Storage path', selected.storagePath || '—'],
    ['Target type', selected.targetType || '—'],
    ['Field', selected.fieldName || '—'],
    ['Source key', selected.sourceKey || '—'],
  ]));
  body.appendChild(technical);

  appendChildren(layout, [body]);
  detail.appendChild(layout);
  return detail;
}

function normalizeMediaLibraryAsset(asset = {}) {
  const publicUrlRaw = firstAvailableValue(asset, ['public_url', 'publicUrl', 'url']);
  const publicUrl = normalizeSafeMediaUrl(publicUrlRaw);
  const storagePath = firstAvailableValue(asset, ['storage_path', 'storagePath', 'path', 'file_name', 'fileName']);
  const fieldName = firstAvailableValue(asset, ['field_name', 'fieldName']);
  const mediaKind = normalizeMediaKind(firstAvailableValue(asset, ['media_kind', 'mediaKind', 'asset_type', 'assetType']), fieldName, firstAvailableValue(asset, ['mime_type', 'mimeType']));
  return {
    ...asset,
    id: firstAvailableValue(asset, ['id']) || storagePath || publicUrl || '',
    publicUrlRaw,
    publicUrl,
    hasSafePublicUrl: Boolean(publicUrl),
    publicUrlSafetyMessage: publicUrl ? '' : ADMIN_COPY.media.unsafeUrl,
    storageBucket: firstAvailableValue(asset, ['storage_bucket', 'storageBucket']) || 'cms-media',
    storagePath,
    fileName: getMediaFileName(storagePath, publicUrl || publicUrlRaw),
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

const MEDIA_VIRTUAL_FIELD_TOKENS = Object.freeze([
  'imageurl', 'image_url', 'videourl', 'video_url', 'posterurl', 'poster_url', 'thumbnailurl', 'thumbnail_url',
  'logourl', 'logo_url', 'mediaurl', 'media_url', 'media_json', 'src', 'url', 'poster', 'thumbnail', 'image', 'video', 'logo', 'asset', 'artworkimage'
]);

function collectVirtualMediaInventoryReferences(sources = []) {
  const references = [];
  safeArray(sources).forEach((source) => {
    scanVirtualMediaReferenceValue(source.value, source, references, source.area || 'CMS', 0);
  });
  return dedupeVirtualMediaReferences(references);
}

function scanVirtualMediaReferenceValue(value, source, references, path = '', depth = 0) {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'function') return;
  if (typeof Element !== 'undefined' && value instanceof Element) return;

  if (typeof value === 'string') {
    if (!isLikelyMediaReference(path, value)) return;
    const safeValue = normalizeSafeMediaUrl(value) || String(value || '').trim();
    if (!safeValue) return;
    const target = getMediaReferenceNavigationTarget({
      sourceType: source.sourceType || 'cms',
      sourceKey: source.key || '',
      area: source.area || 'CMS',
      field: path,
      label: buildMediaReferenceLabel(source, path),
      matchType: 'strong',
    });
    references.push(enrichMediaReferenceNavigationTarget({
      sourceType: source.sourceType || 'cms',
      sourceKey: source.key || '',
      area: source.area || 'CMS',
      field: path,
      label: buildMediaReferenceLabel(source, path),
      matchType: 'strong',
      mediaValue: safeValue,
      rawMediaValue: String(value || '').trim(),
      mediaKind: normalizeMediaKind('', path, inferMimeTypeFromPath(value)),
      ownerLabel: target?.label || source.area || 'CMS',
    }));
    return;
  }

  if (Array.isArray(value)) {
    value.slice(0, 200).forEach((entry, index) => {
      scanVirtualMediaReferenceValue(entry, source, references, `${path}[${index}]`, depth + 1);
    });
    return;
  }

  if (typeof value === 'object') {
    Object.entries(value).slice(0, 250).forEach(([key, entry]) => {
      scanVirtualMediaReferenceValue(entry, source, references, path ? `${path}.${key}` : key, depth + 1);
    });
  }
}

function isLikelyMediaReference(path = '', value = '') {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) return false;
  const lowerPath = String(path || '').toLowerCase().replace(/[^a-z0-9_.\[\]-]/g, '');
  const lowerValue = raw.toLowerCase();
  const pathLooksMedia = MEDIA_VIRTUAL_FIELD_TOKENS.some((token) => lowerPath.includes(token));
  const valueLooksMedia = /\.(png|jpe?g|webp|gif|svg|mp4|webm|mov|m4v|avif)(\?|#|$)/i.test(raw)
    || lowerValue.includes('/assets/')
    || lowerValue.includes('/storage/v1/object/public/')
    || lowerValue.includes('cms-media')
    || lowerValue.includes('r2.dev')
    || lowerValue.includes('cloudflare');
  if (!pathLooksMedia && !valueLooksMedia) return false;
  return normalizeMediaReferenceCandidates(raw).length > 0 || Boolean(normalizeSafeMediaUrl(raw));
}

function inferMimeTypeFromPath(value = '') {
  const raw = String(value || '').toLowerCase().split('?')[0];
  if (/\.(mp4|webm|mov|m4v)$/.test(raw)) return 'video/mp4';
  if (/\.(png|jpe?g|webp|gif|svg|avif)$/.test(raw)) return 'image/jpeg';
  return '';
}

function dedupeVirtualMediaReferences(references = []) {
  const seen = new Set();
  const out = [];
  safeArray(references).forEach((reference) => {
    const key = [reference.mediaValue, reference.sourceType, reference.sourceKey, reference.area, reference.field, reference.label].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(reference);
  });
  return out;
}

function buildVirtualMediaAssets(references = [], uploadAssets = [], deletedUploadAssets = []) {
  const uploadIdentity = new Set();
  safeArray(uploadAssets).forEach((asset) => {
    buildMediaAssetIdentity(asset).strongValues.forEach((value) => uploadIdentity.add(value));
  });
  const deletedIdentity = getDeletedMediaIdentitySet(deletedUploadAssets);
  const grouped = new Map();
  safeArray(references).forEach((reference) => {
    const key = getVirtualMediaIdentityKey(reference.mediaValue || reference.rawMediaValue);
    if (!key) return;
    const candidates = normalizeMediaReferenceCandidates(reference.mediaValue || reference.rawMediaValue);
    const hasUploadRecord = candidates.some((candidate) => uploadIdentity.has(candidate));
    if (hasUploadRecord) return;
    if (!grouped.has(key)) grouped.set(key, { refs: [], isBrokenDeletedReference: false });
    const group = grouped.get(key);
    group.refs.push(reference);
    if (candidates.some((candidate) => deletedIdentity.has(candidate))) group.isBrokenDeletedReference = true;
  });

  return Array.from(grouped.entries()).map(([key, group], index) => {
    const refs = safeArray(group.refs);
    const first = refs[0] || {};
    const rawValue = first.mediaValue || first.rawMediaValue || key;
    const publicUrl = normalizeSafeMediaUrl(rawValue);
    const storagePath = publicUrl ? '' : rawValue;
    return {
      id: `virtual-media-${index}-${hashMediaValue(key)}`,
      publicUrlRaw: rawValue,
      publicUrl,
      hasSafePublicUrl: Boolean(publicUrl),
      publicUrlSafetyMessage: publicUrl ? '' : ADMIN_COPY.media.unsafeUrl,
      storageBucket: inferMediaSourceBucket(rawValue),
      storagePath,
      fileName: getMediaFileName(storagePath, publicUrl || rawValue),
      mediaKind: first.mediaKind || normalizeMediaKind('', first.field || '', inferMimeTypeFromPath(rawValue)),
      mimeType: inferMimeTypeFromPath(rawValue),
      sizeBytes: 0,
      targetType: inferMediaTargetTypeFromReferences(refs),
      roomKey: inferRoomKeyFromReferences(refs),
      sectionKey: inferSectionKeyFromReferences(refs),
      itemId: '',
      artworkCode: inferArtworkCodeFromReferences(refs),
      fieldName: first.field || '',
      status: group.isBrokenDeletedReference ? 'deleted-reference' : 'reference-only',
      createdAt: '',
      sourceKind: group.isBrokenDeletedReference ? 'broken-deleted-reference' : 'virtual-reference',
      sourceLabel: group.isBrokenDeletedReference ? 'CMS reference / deleted Storage path / Không còn usable' : getVirtualMediaSourceLabel(first, rawValue),
      isBrokenDeletedReference: Boolean(group.isBrokenDeletedReference),
      sourceKey: first.sourceKey || '',
      ownerLabel: getMediaOwnerGroupLabel(first),
      hasUploadLogRecord: false,
      usage: {
        key: first.sourceType === 'public' ? 'public' : first.sourceType === 'draft' ? 'draft' : 'cms',
        label: first.sourceType === 'public' ? ADMIN_COPY.media.usageLabels.public : first.sourceType === 'draft' ? ADMIN_COPY.media.usageLabels.draft : ADMIN_COPY.media.usageLabels.cms,
        variant: first.sourceType === 'public' ? 'success' : first.sourceType === 'draft' ? 'warning' : 'default',
        references: refs,
      },
    };
  });
}

function getVirtualMediaIdentityKey(value = '') {
  const candidates = normalizeMediaReferenceCandidates(value);
  return candidates[0] || String(value || '').trim();
}

function hashMediaValue(value = '') {
  let hash = 0;
  const raw = String(value || '');
  for (let i = 0; i < raw.length; i += 1) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}

function inferMediaSourceBucket(value = '') {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('/storage/v1/object/public/')) return 'Supabase Storage';
  if (raw.includes('/assets/') || raw.startsWith('assets/') || raw.startsWith('./assets/')) return 'Local asset';
  if (raw.startsWith('http')) return 'External/R2';
  return 'CMS JSON';
}

function getVirtualMediaSourceLabel(reference = {}, value = '') {
  const source = formatMediaReferenceSource(reference.sourceType);
  const bucket = inferMediaSourceBucket(value);
  return `${source} / ${bucket} / Không có record upload log`;
}

function inferMediaTargetTypeFromReferences(refs = []) {
  const haystack = refs.map((ref) => [ref.label, ref.area, ref.field, ref.sourceKey].join(' ')).join(' ').toLowerCase();
  if (includesAny(haystack, ['featuredartworks', 'index.featured', 'tác phẩm tiêu biểu'])) return 'index_featured';
  if (includesAny(haystack, ['site-settings', 'sitesettings'])) return 'site_settings';
  if (includesAny(haystack, ['home', 'trang chủ', 'indexsections', 'index-section'])) return 'home_section';
  if (includesAny(haystack, ['gate', 'cổng vào'])) return 'gate_content';
  if (includesAny(haystack, ['artwork', 'rooms', 'phòng'])) return 'room_artwork';
  return 'unknown';
}

function inferRoomKeyFromReferences(refs = []) {
  const haystack = refs.map((ref) => [ref.label, ref.area, ref.field, ref.sourceKey].join(' ')).join(' ').toLowerCase();
  if (includesAny(haystack, ['outdoor', 'ngoài trời'])) return 'outdoor';
  if (includesAny(haystack, ['indoor', 'trong nhà'])) return 'indoor';
  return '';
}

function inferSectionKeyFromReferences(refs = []) {
  const haystack = refs.map((ref) => [ref.label, ref.area, ref.field, ref.sourceKey].join(' ')).join(' ').toLowerCase();
  if (includesAny(haystack, ['hero', 'khu vực đầu trang'])) return 'hero';
  if (includesAny(haystack, ['guide', 'hướng dẫn'])) return 'guide';
  if (includesAny(haystack, ['experience', 'trải nghiệm'])) return 'experience';
  if (includesAny(haystack, ['featured', 'tác phẩm tiêu biểu'])) return 'featured';
  return '';
}

function inferArtworkCodeFromReferences(refs = []) {
  const haystack = refs.map((ref) => [ref.label, ref.area, ref.field].join(' ')).join(' ');
  const match = haystack.match(/ART[_-]?\d+/i);
  return match ? match[0].toUpperCase() : '';
}

function getMediaSourceLabel(asset = {}) {
  if (asset.sourceLabel) return asset.sourceLabel;
  if (asset.hasUploadLogRecord) return 'Upload log / cms_media_uploads';
  return 'Reference read-only';
}

function groupMediaUsageReferences(model = {}) {
  const entries = [];
  safeArray(model.allAssets).forEach((asset) => {
    const refs = safeArray(asset.usage?.references);
    if (!refs.length && asset.hasUploadLogRecord) {
      entries.push({ asset, reference: null, groupLabel: 'Chưa thấy tham chiếu' });
      return;
    }
    refs.forEach((reference) => {
      entries.push({ asset, reference, groupLabel: getMediaOwnerGroupLabel(reference) });
    });
  });
  const map = new Map();
  entries.forEach((entry) => {
    const key = entry.groupLabel || 'Khác / không phân loại';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  });
  return Array.from(map.entries()).map(([label, entriesForGroup]) => ({ label, entries: entriesForGroup }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
}

function getMediaOwnerGroupLabel(reference = {}) {
  const haystack = [reference.label, reference.area, reference.field, reference.sourceKey].join(' | ').toLowerCase();
  if (includesAny(haystack, ['featuredartworks', 'index.featured', 'index_featured', 'tác phẩm tiêu biểu'])) return 'Nội dung phòng 3D — Tác phẩm tiêu biểu';
  if (includesAny(haystack, ['site-settings', 'sitesettings', 'thông tin website'])) return 'Thông tin website';
  if (includesAny(haystack, ['gate', 'cổng vào triển lãm'])) return 'Cổng vào triển lãm';
  if (includesAny(haystack, ['outdoor', 'ngoài trời'])) return 'Nội dung phòng 3D — Phòng ngoài trời';
  if (includesAny(haystack, ['indoor', 'trong nhà'])) return 'Nội dung phòng 3D — Phòng trong nhà';
  if (includesAny(haystack, ['artwork', 'rooms', 'static cms', 'nội dung phòng 3d'])) return 'Nội dung phòng 3D';
  if (includesAny(haystack, ['home', 'trang chủ', 'hero', 'guide', 'experience', 'index-section'])) return 'Trang chủ';
  if (reference.sourceType === 'public') return 'Website đang công khai / CMS public JSON';
  if (reference.sourceType === 'draft') return 'Bản nháp CMS';
  return reference.area || 'Khác / không phân loại';
}

function renderMediaUsageOwnerGroup(group = {}) {
  const section = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-media-usage-owner-group' });
  section.appendChild(renderPanelTitle(group.label || 'Khác / không phân loại', `${formatCount(group.entries?.length || 0)} reference`));
  const list = createElement('div', { className: 'cms-admin-media-usage-reference-list' });
  safeArray(group.entries).slice(0, 80).forEach((entry) => list.appendChild(renderMediaUsageReferenceCard(entry.asset, entry.reference)));
  section.appendChild(list);
  return section;
}

function renderMediaUsageReferenceCard(asset = {}, reference = null) {
  const card = createElement('article', { className: 'cms-admin-media-usage-reference-card' });
  const header = createElement('div', { className: 'cms-admin-media-usage-reference-card-header' });
  header.appendChild(createElement('h4', { text: asset.fileName || asset.storagePath || asset.publicUrl || 'Media reference' }));
  const lifecycleBadge = renderMediaLifecycleBadge(asset);
  if (lifecycleBadge) header.appendChild(lifecycleBadge);
  header.appendChild(renderBadge(asset.hasUploadLogRecord ? 'Có upload log' : 'Reference-only', asset.hasUploadLogRecord ? 'success' : 'warning'));
  appendChildren(card, [header]);
  const details = createElement('dl', { className: 'cms-admin-media-reference-details' });
  [
    ['Nguồn', reference ? formatMediaReferenceSource(reference.sourceType) : getMediaSourceLabel(asset)],
    ['Field/path', reference?.field || asset.fieldName || '—'],
    ['Loại', getMediaKindLabel(asset.mediaKind)],
    ['URL/path', asset.publicUrl || asset.publicUrlRaw || asset.storagePath || '—'],
    ['Owner target', getResolvedMediaReferenceTarget(reference || {})?.label || asset.ownerLabel || getMediaTargetLabel(asset)],
  ].forEach(([label, value]) => appendMediaDetail(details, label, value));
  card.appendChild(details);
  const actions = createElement('div', { className: 'cms-admin-media-actions' });
  const nav = reference ? renderMediaReferenceNavigationButton(reference) : null;
  if (nav) actions.appendChild(nav);
  card.appendChild(actions);
  return card;
}

function normalizeSafeMediaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const lower = raw.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('blob:') || lower.startsWith('file:')) {
    return '';
  }

  if (isAllowedRelativeMediaPath(raw)) {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return '';
    const allowedOrigins = new Set(safeArray(STATIC_CMS_DRAFT_CONFIG.allowedMediaOrigins).map((origin) => String(origin || '').trim()).filter(Boolean));
    const allowedHosts = new Set(safeArray(STATIC_CMS_DRAFT_CONFIG.allowedMediaHosts).map((host) => String(host || '').trim().toLowerCase()).filter(Boolean));
    if (allowedOrigins.has(parsed.origin) || allowedHosts.has(parsed.hostname.toLowerCase())) {
      return parsed.href;
    }
  } catch {
    return '';
  }

  return '';
}

function isAllowedRelativeMediaPath(value = '') {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  return safeArray(STATIC_CMS_DRAFT_CONFIG.allowedMediaPathPrefixes).some((prefix) => {
    const normalizedPrefix = String(prefix || '').trim();
    return normalizedPrefix && raw.startsWith(normalizedPrefix);
  });
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
  const sources = [];
  const addSource = (source = {}) => {
    if (!isMediaUsageScannableValue(source.value)) return;
    sources.push({
      key: source.key || `source-${sources.length}`,
      sourceType: source.sourceType || 'cms',
      area: source.area || 'CMS',
      label: source.label || source.area || 'CMS',
      value: source.value,
    });
  };

  const canonicalValue = getCanonicalCmsReferenceValue(state.data?.canonicalCms);
  addSource({
    key: 'public-canonical',
    sourceType: 'public',
    area: 'Website',
    label: 'Nội dung website đang dùng',
    value: canonicalValue,
  });

  addSource({
    key: 'static-cms-draft-current',
    sourceType: 'draft',
    area: 'Bản nháp CMS',
    label: 'Bản nháp đang mở',
    value: state.staticCmsDraft?.draftJson,
  });

  addSource({
    key: 'static-cms-draft-baseline',
    sourceType: 'cms',
    area: 'Nội dung phòng 3D',
    label: 'CMS / Static CMS baseline',
    value: state.staticCmsDraft?.baselineJson,
  });

  safeArray(state.data?.indexSections).forEach((section, index) => {
    addSource({
      key: `cms-index-section-${section?.id || section?.section_key || index}`,
      sourceType: 'cms',
      area: 'Trang chủ',
      label: `CMS / Trang chủ / ${getHomeSectionReferenceLabel(section?.section_key)}`,
      value: section,
    });
  });

  addSource({
    key: 'cms-site-settings',
    sourceType: 'cms',
    area: 'Thông tin website',
    label: 'CMS / Thông tin website',
    value: state.data?.siteSettings,
  });

  addSource({
    key: 'local-site-settings-draft',
    sourceType: 'draft',
    area: 'Thông tin website',
    label: 'Bản nháp local / Thông tin website',
    value: state.siteSettingsEdit?.draftValues,
  });

  addSource({
    key: 'local-site-settings-original',
    sourceType: 'cms',
    area: 'Thông tin website',
    label: 'CMS / Thông tin website / Dữ liệu gốc form',
    value: state.siteSettingsEdit?.originalValues,
  });

  safeArray(state.data?.artworks).forEach((artwork, index) => {
    addSource({
      key: `cms-artwork-${artwork?.id || artwork?.artwork_code || index}`,
      sourceType: 'cms',
      area: 'Nội dung phòng 3D',
      label: `CMS / Nội dung phòng 3D / ${artwork?.artwork_code || artwork?.title || `Item ${index + 1}`}`,
      value: artwork,
    });
  });

  safeArray(state.data?.rooms).forEach((room, index) => {
    addSource({
      key: `cms-room-${room?.id || room?.room_key || index}`,
      sourceType: 'cms',
      area: 'Không gian 3D',
      label: `CMS / Không gian 3D / ${getRoomLabel(room?.room_key || room?.id || '')}`,
      value: room,
    });
  });

  addSource({
    key: 'cms-gate-content',
    sourceType: 'cms',
    area: 'Cổng vào triển lãm',
    label: 'CMS / Cổng vào triển lãm',
    value: state.data?.gateContent,
  });

  addSource({
    key: 'local-home-draft',
    sourceType: 'draft',
    area: 'Trang chủ',
    label: 'Bản nháp local / Trang chủ',
    value: state.homeEdit?.draftValues,
  });

  addSource({
    key: 'local-home-original',
    sourceType: 'cms',
    area: 'Trang chủ',
    label: 'CMS / Trang chủ / Dữ liệu gốc form',
    value: state.homeEdit?.originalValues,
  });

  safeArray(state.data?.publishedBundles).forEach((bundle, index) => {
    addSource({
      key: `published-bundle-${bundle?.id || bundle?.version || index}`,
      sourceType: 'cms',
      area: 'Lịch sử công khai',
      label: `CMS / Lịch sử công khai / ${bundle?.version || bundle?.id || `Bản ${index + 1}`}`,
      value: bundle,
    });
  });

  return {
    sources,
    hasScannableSource: sources.length > 0,
    hasPublicSource: sources.some((source) => source.sourceType === 'public'),
    hasDraftSource: sources.some((source) => source.sourceType === 'draft'),
    hasCmsSource: sources.some((source) => source.sourceType === 'cms'),
  };
}

function getCanonicalCmsReferenceValue(canonicalCms = null) {
  if (!canonicalCms) return null;
  if (canonicalCms.json) return canonicalCms.json;
  if (canonicalCms.content_json) return canonicalCms.content_json;
  if (canonicalCms.contentJson) return canonicalCms.contentJson;
  if (canonicalCms.content) return canonicalCms.content;
  if (canonicalCms.data) return canonicalCms.data;
  if (canonicalCms.sections || canonicalCms.rooms || canonicalCms.site || canonicalCms.home || canonicalCms.index) return canonicalCms;
  return null;
}

function isMediaUsageScannableValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

function getHomeSectionReferenceLabel(sectionKey = '') {
  const normalized = String(sectionKey || '').trim().toLowerCase();
  const labels = {
    hero: 'Khu vực đầu trang',
    guide: 'Hướng dẫn tham quan',
    experience: 'Khu vực trải nghiệm',
    contact: 'Thông tin liên hệ',
  };
  return labels[normalized] || normalized || 'Section';
}

function getMediaUsage(asset, context = {}) {
  const identity = buildMediaAssetIdentity(asset);
  if (!identity.strongValues.length) {
    return {
      key: 'insufficient',
      label: ADMIN_COPY.media.usageLabels.insufficient,
      variant: 'default',
      references: [],
      note: ADMIN_COPY.media.usageNotes.insufficient,
    };
  }

  const references = collectMediaUsageReferences(context.sources, identity);
  const strongReferences = references.filter((reference) => reference.matchType === 'strong');
  const publicReferences = strongReferences.filter((reference) => reference.sourceType === 'public');
  const draftReferences = strongReferences.filter((reference) => reference.sourceType === 'draft');
  const cmsReferences = strongReferences.filter((reference) => reference.sourceType === 'cms');

  if (publicReferences.length) {
    return {
      key: 'public',
      label: ADMIN_COPY.media.usageLabels.public,
      variant: 'success',
      references: strongReferences,
    };
  }

  if (draftReferences.length) {
    return {
      key: 'draft',
      label: ADMIN_COPY.media.usageLabels.draft,
      variant: 'warning',
      references: strongReferences,
    };
  }

  if (cmsReferences.length) {
    return {
      key: 'cms',
      label: ADMIN_COPY.media.usageLabels.cms,
      variant: 'default',
      references: strongReferences,
    };
  }

  if (!context.hasScannableSource) {
    return {
      key: 'insufficient',
      label: ADMIN_COPY.media.usageLabels.insufficient,
      variant: 'default',
      references: [],
      note: ADMIN_COPY.media.usageNotes.insufficient,
    };
  }

  return {
    key: 'none',
    label: ADMIN_COPY.media.usageLabels.none,
    variant: 'default',
    references: [],
    note: ADMIN_COPY.media.usageNotes.none,
  };
}

function buildMediaAssetIdentity(asset = {}) {
  const strong = new Set();
  const storageBucket = String(asset.storageBucket || 'cms-media').trim() || 'cms-media';
  [asset.publicUrl, asset.publicUrlRaw, asset.storagePath].forEach((value) => {
    normalizeMediaReferenceCandidates(value).forEach((candidate) => strong.add(candidate));
  });
  addStoragePathReferenceCandidates(strong, asset.storagePath, storageBucket);
  return {
    strongValues: Array.from(strong),
    strongSet: strong,
  };
}

function collectMediaUsageReferences(sources = [], identity = {}) {
  const references = [];
  safeArray(sources).forEach((source) => {
    scanMediaUsageValue(source.value, source, identity, references, source.area || 'CMS', 0);
  });
  return dedupeMediaReferences(references);
}

function scanMediaUsageValue(value, source, identity, references, path, depth) {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'function') return;

  if (typeof Element !== 'undefined' && value instanceof Element) return;

  if (typeof value === 'string') {
    const candidates = normalizeMediaReferenceCandidates(value);
    const hasStrongMatch = candidates.some((candidate) => identity.strongSet.has(candidate));
    if (hasStrongMatch) {
      references.push({
        sourceType: source.sourceType || 'cms',
        sourceKey: source.key || '',
        area: source.area || 'CMS',
        field: path,
        label: buildMediaReferenceLabel(source, path),
        matchType: 'strong',
      });
    }
    return;
  }

  if (typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.slice(0, 200).forEach((entry, index) => {
      scanMediaUsageValue(entry, source, identity, references, `${path}[${index}]`, depth + 1);
    });
    return;
  }

  Object.entries(value).slice(0, 250).forEach(([key, entry]) => {
    scanMediaUsageValue(entry, source, identity, references, path ? `${path}.${key}` : key, depth + 1);
  });
}

function normalizeMediaReferenceCandidates(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('blob:') || lower.startsWith('file:')) return [];
  if (raw.startsWith('//') || raw.includes('..') || raw.includes('\\')) return [];

  const candidates = new Set();
  const safeUrl = normalizeSafeMediaUrl(raw);
  if (safeUrl) {
    addMediaReferenceCandidate(candidates, safeUrl);
    try {
      const parsed = new URL(safeUrl, globalThis.location?.origin || 'https://cms.local');
      addUrlPathReferenceCandidates(candidates, parsed.pathname);
    } catch {
      // Safe URL parsing is best-effort for reference matching only.
    }
  }

  addStoragePathReferenceCandidates(candidates, raw);
  return Array.from(candidates);
}

function addUrlPathReferenceCandidates(candidates, pathname = '') {
  const rawPath = String(pathname || '').trim();
  if (!rawPath) return;
  addMediaReferenceCandidate(candidates, rawPath);
  addMediaReferenceCandidate(candidates, rawPath.replace(/^\/+/, ''));
  let decodedPath = rawPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    decodedPath = rawPath;
  }
  addMediaReferenceCandidate(candidates, decodedPath);
  addMediaReferenceCandidate(candidates, decodedPath.replace(/^\/+/, ''));
  addStorageObjectSuffixCandidates(candidates, rawPath);
  if (decodedPath !== rawPath) {
    addStorageObjectSuffixCandidates(candidates, decodedPath);
  }
}

function addStorageObjectSuffixCandidates(candidates, value = '') {
  const raw = String(value || '').trim();
  if (!raw) return;
  const storagePublicMarker = '/storage/v1/object/public/';
  const markerIndex = raw.indexOf(storagePublicMarker);
  if (markerIndex >= 0) {
    const suffix = raw.slice(markerIndex + storagePublicMarker.length).replace(/^\/+/, '');
    addMediaReferenceCandidate(candidates, suffix);
    const withoutBucket = removeKnownMediaBucketPrefix(suffix);
    addMediaReferenceCandidate(candidates, withoutBucket);
    return;
  }

  const compact = raw.replace(/^\/+/, '');
  if (compact.startsWith('storage/v1/object/public/')) {
    const suffix = compact.slice('storage/v1/object/public/'.length).replace(/^\/+/, '');
    addMediaReferenceCandidate(candidates, suffix);
    addMediaReferenceCandidate(candidates, removeKnownMediaBucketPrefix(suffix));
  }
}

function addStoragePathReferenceCandidates(candidates, value = '', bucket = 'cms-media') {
  const raw = String(value || '').trim();
  if (!isSafeStoragePathCandidate(raw)) return;
  const variants = new Set();
  variants.add(raw);
  variants.add(raw.replace(/^\.\//, ''));
  variants.add(raw.replace(/^\/+/, ''));
  try {
    variants.add(decodeURIComponent(raw));
  } catch {
    // Decoding is best-effort for storage path matching only.
  }

  Array.from(variants).forEach((variant) => {
    const normalized = String(variant || '').trim();
    if (!normalized) return;
    addMediaReferenceCandidate(candidates, normalized);
    addMediaReferenceCandidate(candidates, normalized.replace(/^\.\//, ''));
    addMediaReferenceCandidate(candidates, normalized.replace(/^\/+/, ''));
    addStorageObjectSuffixCandidates(candidates, normalized);
    const compact = normalized.replace(/^\.\//, '').replace(/^\/+/, '');
    const withoutBucket = removeKnownMediaBucketPrefix(compact);
    addMediaReferenceCandidate(candidates, withoutBucket);
    const normalizedBucket = String(bucket || '').trim().replace(/^\/+|\/+$/g, '');
    if (normalizedBucket && withoutBucket && !compact.startsWith(`${normalizedBucket}/`)) {
      addMediaReferenceCandidate(candidates, `${normalizedBucket}/${withoutBucket}`);
    }
  });
}

function removeKnownMediaBucketPrefix(value = '') {
  const raw = String(value || '').trim().replace(/^\/+/, '');
  const knownBuckets = ['cms-media'];
  for (const bucket of knownBuckets) {
    if (raw.startsWith(`${bucket}/`)) {
      return raw.slice(bucket.length + 1);
    }
  }
  return raw;
}

function addMediaReferenceCandidate(candidates, value) {
  const normalized = normalizeMediaReferenceString(value);
  if (normalized) candidates.add(normalized);
}

function normalizeMediaReferenceString(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let withoutQuery = raw.split('#')[0].split('?')[0].replace(/\/+$/, '');
  try {
    withoutQuery = decodeURIComponent(withoutQuery);
  } catch {
    // Keep encoded form when decoding fails.
  }
  return withoutQuery;
}

function isSafeStoragePathCandidate(value = '') {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  if (raw.includes('..') || raw.includes('\\')) return false;
  return raw.includes('/') || raw.startsWith('./') || raw.startsWith('/');
}

function dedupeMediaReferences(references = []) {
  const seen = new Set();
  const out = [];
  safeArray(references).forEach((reference) => {
    const enriched = enrichMediaReferenceNavigationTarget(reference);
    const key = [enriched.sourceType, enriched.sourceKey, enriched.area, enriched.field, enriched.label, enriched.matchType].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(enriched);
  });
  return out;
}

function enrichMediaReferenceNavigationTarget(reference = {}) {
  const target = getMediaReferenceNavigationTarget(reference);
  if (!target) return reference;
  return {
    ...reference,
    targetTab: target.tab,
    targetType: target.type,
    targetId: target.id,
    targetFieldName: target.fieldName,
    targetLabel: target.label,
    targetWorkspaceKey: target.workspaceKey || '',
    targetWorkspaceTab: target.workspaceTab || '',
  };
}

function getMediaReferenceNavigationTarget(reference = {}) {
  const label = String(reference.label || '').toLowerCase();
  const area = String(reference.area || '').toLowerCase();
  const field = String(reference.field || '').toLowerCase();
  const sourceKey = String(reference.sourceKey || '').toLowerCase();
  const haystack = [label, area, field, sourceKey].join(' | ');

  if (includesAny(haystack, ['logo_url', 'logourl'])) {
    return null;
  }

  if (includesAny(haystack, ['thông tin website', 'site-settings', 'sitesettings'])) {
    return {
      tab: 'settings',
      type: 'site-settings',
      id: 'site-settings',
      fieldName: 'site_title',
      label: 'Thông tin website',
    };
  }

  if (includesAny(haystack, ['cổng vào triển lãm', 'gatecontent', 'gate-content', 'cms-gate', 'gate.'])) {
    return {
      tab: 'gate',
      type: 'gate',
      id: 'gate',
      fieldName: field.includes('media') || field.includes('image') ? '' : 'eyebrow',
      label: 'Cổng vào triển lãm',
    };
  }

  if (includesAny(haystack, ['index.featuredartworks', 'featuredartworks', 'index_featured', 'target_type=index_featured', 'tác phẩm tiêu biểu'])) {
    return {
      tab: 'staticDraft',
      type: 'static-draft',
      id: 'static-draft',
      fieldName: '',
      label: 'Nội dung phòng 3D → Tác phẩm tiêu biểu',
      workspaceKey: 'staticDraft',
      workspaceTab: 'featured',
    };
  }

  if (includesAny(haystack, ['trang chủ', 'index-section', 'indexsections', 'home', 'hero', 'khu vực đầu trang'])) {
    const isGuide = includesAny(haystack, ['guide', 'hướng dẫn']);
    const isExperience = includesAny(haystack, ['experience', 'trải nghiệm']);
    const isHero = !isGuide && !isExperience && includesAny(haystack, ['hero', 'khu vực đầu trang', 'videourl', 'video_url', 'media_json', 'video']);
    const type = isGuide ? 'home-guide' : isExperience ? 'home-experience' : 'home-hero';
    const id = isGuide ? 'guide' : isExperience ? 'experience' : 'hero';
    return {
      tab: 'home',
      type,
      id,
      fieldName: isHero && includesAny(field, ['video', 'media_json']) ? 'videoUrl' : 'eyebrow',
      label: 'Trang chủ',
    };
  }

  if (includesAny(haystack, ['nội dung phòng 3d', 'artworks', 'artwork', 'rooms', 'static cms', 'static-cms', 'bản nháp cms', 'art_', 'logo_', 'video_'])) {
    return {
      tab: 'staticDraft',
      type: 'static-draft',
      id: 'static-draft',
      fieldName: '',
      label: 'Nội dung phòng 3D',
    };
  }

  return null;
}

function includesAny(value = '', tokens = []) {
  const raw = String(value || '').toLowerCase();
  return safeArray(tokens).some((token) => raw.includes(String(token || '').toLowerCase()));
}

function buildMediaReferenceLabel(source = {}, path = '') {
  const fieldLabel = getMediaReferenceFieldLabel(path);
  return fieldLabel ? `${source.label || source.area || 'CMS'} / ${fieldLabel}` : (source.label || source.area || 'CMS');
}

function getMediaReferenceFieldLabel(path = '') {
  const normalized = String(path || '').toLowerCase();
  if (normalized.includes('logo_url') || normalized.includes('logourl')) return 'Field kỹ thuật';
  if (normalized.includes('videourl') || normalized.includes('video_url') || normalized.endsWith('.video') || normalized.includes('.mp4') || normalized.endsWith('.src')) return 'Video';
  if (normalized.includes('posterurl') || normalized.includes('poster_url') || normalized.includes('poster')) return 'Poster video';
  if (normalized.includes('thumbnailurl') || normalized.includes('thumbnail_url') || normalized.includes('thumbnail')) return 'Thumbnail';
  if (normalized.includes('imageurl') || normalized.includes('image_url') || normalized.endsWith('.image')) return 'Ảnh';
  if (normalized.includes('audio_url') || normalized.includes('audiourl')) return 'Audio';
  if (normalized.includes('media_json')) return 'Media JSON';
  return '';
}

function summarizeMediaLibrary(assets = []) {
  return safeArray(assets).reduce((acc, asset) => {
    const usageKey = asset.usage?.key || 'insufficient';
    const references = safeArray(asset.usage?.references);
    acc.total += 1;
    acc[asset.mediaKind] = (acc[asset.mediaKind] || 0) + 1;
    acc[usageKey] = (acc[usageKey] || 0) + 1;
    if (asset.hasUploadLogRecord) acc.uploadLog += 1;
    if (!asset.hasUploadLogRecord) acc.referenceOnly += 1;
    acc.references += references.length;
    return acc;
  }, {
    total: 0,
    uploadLog: 0,
    referenceOnly: 0,
    references: 0,
    image: 0,
    poster: 0,
    video: 0,
    unknown: 0,
    public: 0,
    draft: 0,
    cms: 0,
    none: 0,
    insufficient: 0,
  });
}

function renderMediaLibraryReadOnlyBanner() {
  const banner = createElement('div', { className: 'cms-admin-media-readonly-banner' });
  const copy = createElement('div', { className: 'cms-admin-media-readonly-copy' });
  appendChildren(copy, [
    createElement('span', { text: ADMIN_COPY.media.safeNotice }),
    createElement('span', { className: 'cms-admin-media-readonly-subcopy', text: ADMIN_COPY.media.readOnlyNotice }),
  ]);
  appendChildren(banner, [
    renderBadge(ADMIN_COPY.media.readOnlyBadge, 'warning'),
    copy,
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

function renderMediaOperatorHandoffNotes() {
  const notes = safeArray(ADMIN_COPY.media.operatorHandoffNotes);
  const wrap = createElement('div', { className: 'cms-admin-media-operator-notes' });
  if (!notes.length) return wrap;
  wrap.appendChild(createElement('strong', { text: 'Ghi chú vận hành' }));
  const list = createElement('ul');
  notes.forEach((note) => list.appendChild(createElement('li', { text: note })));
  wrap.appendChild(list);
  return wrap;
}

function renderMediaLibrarySummary(summary = {}) {
  const grid = createElement('div', { className: 'cms-admin-media-summary-grid' });
  [
    ['Media active', summary.activeUploadLog ?? summary.uploadLog],
    ['Upload log', summary.uploadLogTotal ?? summary.uploadLog],
    ['Đã xóa', summary.deleted || 0],
    ['Tham chiếu CMS', summary.references],
    ['Reference-only', summary.referenceOnly],
    ['Tham chiếu hỏng', summary.brokenReference || 0],
    ['Chưa thấy tham chiếu', summary.none],
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
    attrs: {
      'data-media-search': 'true',
      'aria-label': ADMIN_COPY.media.searchAriaLabel || ADMIN_COPY.media.searchPlaceholder,
    },
  });

  const kindSelect = renderMediaFilterSelect('kind', ADMIN_COPY.media.filters.allKinds, [
    ['image', ADMIN_COPY.media.kindLabels.image],
    ['poster', ADMIN_COPY.media.kindLabels.poster],
    ['video', ADMIN_COPY.media.kindLabels.video],
    ['unknown', ADMIN_COPY.media.kindLabels.unknown],
  ]);
  const usageSelect = renderMediaFilterSelect('usage', ADMIN_COPY.media.filters.allUsage, [
    ['public', ADMIN_COPY.media.usageLabels.public],
    ['draft', ADMIN_COPY.media.usageLabels.draft],
    ['cms', ADMIN_COPY.media.usageLabels.cms],
    ['none', ADMIN_COPY.media.usageLabels.none],
    ['insufficient', ADMIN_COPY.media.usageLabels.insufficient],
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
    attrs: {
      'data-media-filter': filterName,
      'aria-label': ADMIN_COPY.media.filterAriaLabels?.[filterName] || allLabel,
    },
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
    attrs: { 'data-media-filter-empty': 'true', role: 'status', 'aria-live': 'polite' },
  });
  appendChildren(wrap, [grid, empty]);
  return wrap;
}

function renderMediaLibraryCard(asset = {}) {
  const card = createElement('article', {
    className: 'cms-admin-media-card',
    attrs: {
      'data-media-kind': asset.mediaKind,
      'data-media-usage': asset.usage?.key || 'insufficient',
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
  badges.appendChild(renderBadge(asset.hasUploadLogRecord ? 'Upload log' : 'Reference-only', asset.hasUploadLogRecord ? 'success' : 'warning'));
  badges.appendChild(renderBadge(asset.usage?.label || ADMIN_COPY.media.usageLabels.insufficient, asset.usage?.variant || 'default'));
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

  const statusNote = asset.status
    ? createElement('p', { className: 'cms-admin-help-text cms-admin-media-status-note', text: ADMIN_COPY.media.statusNote })
    : null;
  const usageReferences = renderMediaUsageReferences(asset);
  const path = createElement('p', { className: 'cms-admin-media-path', text: asset.storagePath || asset.publicUrl || '—' });

  const actions = createElement('div', { className: 'cms-admin-media-actions' });
  if (asset.hasSafePublicUrl) {
    const copyButton = createElement('button', {
      className: 'cms-admin-button cms-admin-button-ghost',
      text: ADMIN_COPY.media.actions.copyUrl,
      type: 'button',
      attrs: { 'aria-label': buildCopyMediaUrlLabel(asset) },
    });
    copyButton.addEventListener('click', () => copyMediaUrl(copyButton, asset.publicUrl));
    actions.appendChild(copyButton);
  } else {
    actions.appendChild(createElement('span', { className: 'cms-admin-help-text cms-admin-media-url-warning', text: asset.publicUrlRaw ? ADMIN_COPY.media.unsafeUrl : 'Media này chưa có đường dẫn public.' }));
  }
  appendChildren(body, [titleRow, badges, details, statusNote, usageReferences, path, actions, renderMediaDeleteGuard(asset, { compact: true })]);
  card.appendChild(body);
  return card;
}

function getMediaDeleteEligibility(asset = {}) {
  const references = safeArray(asset.usage?.references);
  if (isDeletedMediaAsset(asset)) {
    return { allowed: false, reason: 'Không thể xóa: media này đã bị xóa khỏi Storage; record upload chỉ còn dùng để audit lifecycle.' };
  }
  if (isBrokenDeletedMediaReference(asset)) {
    return { allowed: false, reason: 'Không thể xóa tại đây: đây là tham chiếu hỏng tới path đã xóa, cần cập nhật nội dung liên quan thay vì xóa thêm media.' };
  }
  if (!asset.hasUploadLogRecord) {
    return { allowed: false, reason: 'Không thể xóa: media này là reference-only/virtual, không có record upload log thật.' };
  }
  if (references.length) {
    return { allowed: false, reason: `Không thể xóa: media đang có ${formatCount(references.length)} tham chiếu trong CMS/draft/public.` };
  }
  if (!asset.storagePath && !asset.publicUrlRaw) {
    return { allowed: false, reason: 'Không thể xóa: thiếu storage path/public URL để đối chiếu object.' };
  }
  return { allowed: false, reason: 'Chưa bật xóa tại Media Library: source hiện tại chưa có helper delete single-media an toàn tách khỏi cleanup gate.' };
}

function renderMediaDeleteGuard(asset = {}, options = {}) {
  const eligibility = getMediaDeleteEligibility(asset);
  const prepareState = getMediaDeletePrepareState(asset);
  const isOpen = isMediaDeletePanelOpen(asset);

  if (options.compact) {
    const compact = createElement('details', {
      className: 'cms-admin-media-delete-guard cms-admin-media-delete-guard-compact',
      attrs: isOpen ? { open: 'true' } : {},
    });
    const disabledLifecycle = isDeletedMediaAsset(asset) || isBrokenDeletedMediaReference(asset);
    compact.appendChild(createElement('summary', { text: disabledLifecycle ? 'Lifecycle / không xóa' : asset.hasUploadLogRecord ? 'Kiểm tra xóa' : 'Xóa khóa an toàn' }));
    compact.addEventListener('toggle', () => setMediaDeletePanelOpen(asset, compact.open));
    compact.appendChild(createElement('p', { text: eligibility.reason }));
    if (asset.hasUploadLogRecord && !disabledLifecycle) {
      compact.appendChild(renderMediaDeletePrepareAction(asset, prepareState, { compact: true }));
      compact.appendChild(renderMediaDeletePrepareResult(asset, prepareState));
    }
    return compact;
  }

  const wrap = createElement('section', { className: 'cms-admin-media-delete-guard cms-admin-media-delete-guard-detail' });
  wrap.appendChild(renderPanelTitle('Kiểm tra điều kiện xóa', 'Prepare-only — chưa xóa media'));
  const disabledLifecycle = isDeletedMediaAsset(asset) || isBrokenDeletedMediaReference(asset);
  wrap.appendChild(createElement('p', {
    text: asset.hasUploadLogRecord && !disabledLifecycle
      ? 'Bạn có thể yêu cầu server kiểm tra điều kiện xóa. Server sẽ revalidate trước mọi thao tác destructive.'
      : eligibility.reason,
  }));
  if (asset.hasUploadLogRecord && !disabledLifecycle) wrap.appendChild(renderMediaDeletePrepareAction(asset, prepareState));
  wrap.appendChild(renderMediaDeletePrepareResult(asset, prepareState));
  const policy = createElement('details', { className: 'cms-admin-media-technical-details' });
  policy.appendChild(createElement('summary', { text: 'Điều kiện an toàn bắt buộc' }));
  policy.appendChild(renderMediaDeletePolicyList());
  wrap.appendChild(policy);
  return wrap;
}

function isMediaDeletePanelOpen(asset = {}) {
  const id = String(asset.id || '');
  return Boolean(id && mediaWorkspaceState.openDeletePanelByAssetId?.[id]);
}

function setMediaDeletePanelOpen(asset = {}, open = false) {
  const id = String(asset.id || '');
  if (!id) return;
  if (open) {
    mediaWorkspaceState.openDeletePanelByAssetId[id] = true;
  } else if (!getMediaDeletePrepareState(asset)?.loading) {
    delete mediaWorkspaceState.openDeletePanelByAssetId[id];
  }
}

function getMediaDeletePrepareState(asset = {}) {
  return mediaWorkspaceState.deletePrepareByAssetId?.[asset.id || ''] || null;
}

function getMediaDeleteConfirmState(asset = {}) {
  return mediaWorkspaceState.deleteConfirmByAssetId?.[asset.id || ''] || null;
}

function getMediaDeleteConfirmText(asset = {}) {
  return mediaWorkspaceState.deleteConfirmTextByAssetId?.[asset.id || ''] || '';
}

function setMediaDeleteConfirmText(asset = {}, value = '') {
  const id = String(asset.id || '');
  if (!id) return;
  mediaWorkspaceState.deleteConfirmTextByAssetId[id] = String(value || '');
}

function renderMediaDeletePrepareAction(asset = {}, prepareState = null, options = {}) {
  const wrap = createElement('div', { className: 'cms-admin-media-delete-prepare-action' });
  const button = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    text: prepareState?.loading ? 'Đang kiểm tra...' : 'Kiểm tra điều kiện xóa',
    type: 'button',
    attrs: {
      title: 'Chỉ gọi prepareDelete server-side. Không xóa Storage object trong phase này.',
      'data-cms-media-prepare-delete': String(asset.id || ''),
    },
  });
  button.disabled = Boolean(prepareState?.loading) || !asset.id;
  button.addEventListener('click', () => handlePrepareDeleteCmsMedia(asset));
  wrap.appendChild(button);
  if (!options.compact) {
    wrap.appendChild(createElement('p', {
      className: 'cms-admin-help-text',
      text: 'Eligibility tạm thời. Phase confirmDelete sau vẫn phải revalidate lại trước khi xóa thật.',
    }));
  }
  return wrap;
}

function renderMediaDeletePrepareResult(asset = {}, prepareState = null) {
  const confirmState = getMediaDeleteConfirmState(asset);
  if (!prepareState && !confirmState) {
    return createElement('p', {
      className: 'cms-admin-help-text',
      text: 'Chưa chạy kiểm tra server-side cho media này. Bấm kiểm tra sẽ chỉ tạo prepare plan/blocked reason, không xóa file.',
    });
  }
  const result = createElement('div', { className: `cms-admin-media-delete-prepare-result${prepareState?.error || confirmState?.error ? ' is-blocked' : prepareState?.data?.eligible ? ' is-eligible' : ' is-blocked'}` });
  if (prepareState?.loading) {
    result.appendChild(renderBadge('Đang kiểm tra', 'warning'));
    result.appendChild(createElement('p', { text: 'Đang gửi yêu cầu prepareDelete tới Edge Function. Không có thao tác xóa.' }));
    return result;
  }
  if (confirmState?.loading) {
    result.appendChild(renderBadge('Đang xác nhận xóa', 'warning'));
    result.appendChild(createElement('p', { text: 'Server đang revalidate zero-reference và confirm phrase trước khi xóa Storage object.' }));
    return result;
  }
  if (confirmState?.data?.deleted) {
    result.appendChild(renderBadge('Đã xóa media', 'success'));
    result.appendChild(createElement('p', { text: confirmState.data.message || 'Storage object đã được xóa và metadata upload được cập nhật.' }));
    if (safeArray(confirmState.data.warnings).length) {
      const warnings = createElement('ul', { className: 'cms-admin-media-delete-reference-list cms-admin-media-delete-reason-list' });
      safeArray(confirmState.data.warnings).forEach((warning) => warnings.appendChild(createElement('li', { text: String(warning || '') })));
      result.appendChild(warnings);
    }
    return result;
  }
  if (confirmState?.data?.result === 'blocked') {
    result.appendChild(renderBadge('Xóa bị server chặn', 'danger'));
    result.appendChild(createElement('p', { text: confirmState.data.message || 'Server revalidation đã chặn xóa trước khi chạm Storage.' }));
    result.appendChild(renderMediaDeleteBlockedDetails(confirmState.data));
    return result;
  }
  if (confirmState?.error) {
    result.appendChild(renderBadge('Xóa thất bại', 'danger'));
    result.appendChild(createElement('p', { text: normalizeErrorMessage(confirmState.error) }));
    if (confirmState.data) result.appendChild(renderMediaDeleteBlockedDetails(confirmState.data));
    return result;
  }
  if (prepareState?.error) {
    result.appendChild(renderBadge('Không thể kiểm tra', 'danger'));
    result.appendChild(createElement('p', { text: normalizeErrorMessage(prepareState.error) }));
    result.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Không có xác nhận xóa thật hoặc xóa Storage object khi prepare thất bại.' }));
    return result;
  }

  const data = prepareState?.data || {};
  const eligible = Boolean(data.eligible);
  result.appendChild(renderBadge(eligible ? 'Đủ điều kiện prepare' : 'Không đủ điều kiện', eligible ? 'success' : 'danger'));
  result.appendChild(createElement('p', {
    text: eligible
      ? 'Đủ điều kiện tạm thời. Server vẫn sẽ revalidate zero-reference, planHash và confirm phrase ngay trước khi xóa thật.'
      : (data.message || 'Server đã chặn xóa media này.'),
  }));

  const blockedReasons = safeArray(data.blockedReasons);
  if (blockedReasons.length) {
    const reasons = createElement('ul', { className: 'cms-admin-media-delete-reference-list cms-admin-media-delete-reason-list' });
    blockedReasons.slice(0, 4).forEach((reason) => reasons.appendChild(createElement('li', { text: String(reason || '') })));
    if (blockedReasons.length > 4) reasons.appendChild(createElement('li', { text: `+${formatCount(blockedReasons.length - 4)} lý do khác trong chi tiết kỹ thuật` }));
    result.appendChild(reasons);
  }

  const references = safeArray(data.references);
  if (references.length && !eligible) {
    const referenceDetails = createElement('details', { className: 'cms-admin-media-technical-details' });
    referenceDetails.appendChild(createElement('summary', { text: `Reference đang chặn (${formatCount(references.length)})` }));
    const list = createElement('ul', { className: 'cms-admin-media-delete-reference-list' });
    references.forEach((reference) => {
      const target = getResolvedMediaReferenceTarget(reference) || reference.target || {};
      const item = createElement('li');
      item.appendChild(createElement('span', { text: reference.label || reference.ownerLabel || reference.area || 'Media reference' }));
      item.appendChild(createElement('small', { text: `${reference.source || reference.sourceType || 'server'} · ${reference.field || reference.path || 'field không rõ'} · ${target.label || reference.ownerTarget || ''}` }));
      list.appendChild(item);
    });
    referenceDetails.appendChild(list);
    result.appendChild(referenceDetails);
  }

  if (eligible && data['confirm' + 'DeleteEnabled']) {
    result.appendChild(renderMediaConfirmDeleteForm(asset, data, confirmState));
  } else if (eligible) {
    result.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Prepare đủ điều kiện nhưng confirmDelete chưa được bật bởi server response hiện tại.' }));
  }

  const details = createElement('details', { className: 'cms-admin-media-technical-details' });
  details.appendChild(createElement('summary', { text: 'Prepare token, path và metadata kỹ thuật' }));
  details.appendChild(renderTechnicalKeyValueList([
    ['Media upload id', data.mediaUploadId || asset.id || '—'],
    ['Storage path', data.storagePath || asset.storagePath || '—'],
    ['Plan hash', data.planHash || '—'],
    ['Confirm phrase', data.confirmPhrase || '—'],
    ['Hết hạn', data.expiresAt ? formatDateTime(data.expiresAt) : '—'],
    ['Xóa thật đã bật?', data['confirm' + 'DeleteEnabled'] ? 'true — vẫn yêu cầu nhập confirm phrase' : 'false'],
  ]));
  result.appendChild(details);
  result.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Eligibility chỉ là trạng thái tạm thời. ConfirmDelete luôn revalidate server-side lại từ đầu.' }));
  return result;
}

function renderMediaDeleteBlockedDetails(data = {}) {
  const details = createElement('details', { className: 'cms-admin-media-technical-details' });
  details.appendChild(createElement('summary', { text: 'Chi tiết server revalidation' }));
  details.appendChild(renderTechnicalKeyValueList([
    ['Kết quả', data.result || data.error || 'blocked'],
    ['Media upload id', data.mediaUploadId || '—'],
    ['Storage path', data.storagePath || '—'],
    ['Graph incomplete', data.graphIncomplete ? 'true' : 'false'],
  ]));
  const references = safeArray(data.references);
  if (references.length) {
    const list = createElement('ul', { className: 'cms-admin-media-delete-reference-list' });
    references.forEach((reference) => {
      const item = createElement('li');
      item.appendChild(createElement('span', { text: reference.label || reference.ownerTarget || 'Reference' }));
      item.appendChild(createElement('small', { text: `${reference.source || 'server'} · ${reference.field || 'field không rõ'}` }));
      list.appendChild(item);
    });
    details.appendChild(list);
  }
  return details;
}

function renderMediaConfirmDeleteForm(asset = {}, prepareData = {}, confirmState = null) {
  const wrap = createElement('section', { className: 'cms-admin-media-confirm-delete-form', attrs: { role: 'group', 'aria-label': 'Xác nhận xóa media thật' } });
  wrap.appendChild(renderBadge('Có thể mở bước xác nhận', 'warning'));
  wrap.appendChild(createElement('p', { text: 'Xóa thật khỏi Storage không thể hoàn tác từ CMS. Nhập chính xác confirm phrase để bật nút xóa media thật.' }));
  const phrase = String(prepareData.confirmPhrase || '');
  const currentText = getMediaDeleteConfirmText(asset);
  const phraseBox = createElement('code', { className: 'cms-admin-media-confirm-phrase', text: phrase || '—' });
  wrap.appendChild(phraseBox);
  const input = createElement('input', {
    className: 'cms-admin-input cms-admin-media-confirm-input',
    attrs: {
      type: 'text',
      value: currentText,
      placeholder: 'Nhập confirm phrase để bật nút xóa thật',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'Nhập confirm phrase để xác nhận xóa media thật',
    },
  });
  const deleteButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-danger',
    text: confirmState?.loading ? 'Đang xóa...' : 'Xóa media thật khỏi Storage',
    type: 'button',
  });
  const syncButton = () => {
    deleteButton.disabled = Boolean(confirmState?.loading) || input.value.trim() !== phrase || !phrase;
  };
  syncButton();
  input.addEventListener('input', () => {
    setMediaDeleteConfirmText(asset, input.value);
    syncButton();
  });
  deleteButton.addEventListener('click', () => handleConfirmDeleteCmsMedia(asset, prepareData));
  const actions = createElement('div', { className: 'cms-admin-media-confirm-actions' });
  actions.appendChild(input);
  actions.appendChild(deleteButton);
  wrap.appendChild(actions);
  wrap.appendChild(createElement('p', { className: 'cms-admin-help-text', text: 'Server sẽ kiểm tra lại reference public/draft/CMS, planHash và confirm phrase trước khi xóa.' }));
  return wrap;
}

async function handlePrepareDeleteCmsMedia(asset = {}) {
  if (!asset?.id) return;
  const existing = getMediaDeletePrepareState(asset);
  if (existing?.loading) return;
  const currentState = getState();
  const client = currentState.supabase;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const activeElement = document.activeElement;
  const focusSelector = activeElement?.getAttribute?.('data-cms-media-prepare-delete')
    ? `[data-cms-media-prepare-delete="${activeElement.getAttribute('data-cms-media-prepare-delete')}"]`
    : '';
  mediaWorkspaceState.openDeletePanelByAssetId[asset.id] = true;
  mediaWorkspaceState.deletePrepareByAssetId[asset.id] = { loading: true, data: null, error: null, requestedAt: new Date().toISOString() };
  renderAdminShell();
  restoreMediaWorkspaceViewport(scrollX, scrollY, focusSelector);
  const { data, error } = await prepareDeleteCmsMedia(client, asset.id);
  mediaWorkspaceState.openDeletePanelByAssetId[asset.id] = true;
  mediaWorkspaceState.deletePrepareByAssetId[asset.id] = {
    loading: false,
    data: data || null,
    error: error || null,
    requestedAt: new Date().toISOString(),
  };
  renderAdminShell();
  restoreMediaWorkspaceViewport(scrollX, scrollY, focusSelector);
}


async function handleConfirmDeleteCmsMedia(asset = {}, prepareData = {}) {
  if (!asset?.id || !prepareData?.planHash) return;
  const existing = getMediaDeleteConfirmState(asset);
  if (existing?.loading) return;
  const currentState = getState();
  const client = currentState.supabase;
  const confirmPhrase = getMediaDeleteConfirmText(asset).trim();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  mediaWorkspaceState.openDeletePanelByAssetId[asset.id] = true;
  mediaWorkspaceState.deleteConfirmByAssetId[asset.id] = { loading: true, data: null, error: null, requestedAt: new Date().toISOString() };
  renderAdminShell();
  restoreMediaWorkspaceViewport(scrollX, scrollY, '');
  const { data, error } = await confirmDeleteCmsMedia(client, {
    mediaUploadId: asset.id,
    planHash: prepareData.planHash,
    confirmPhrase,
  });
  mediaWorkspaceState.openDeletePanelByAssetId[asset.id] = true;
  mediaWorkspaceState.deleteConfirmByAssetId[asset.id] = {
    loading: false,
    data: data || null,
    error: error || null,
    requestedAt: new Date().toISOString(),
  };
  if (data?.deleted) {
    mediaWorkspaceState.deleteConfirmTextByAssetId[asset.id] = '';
    await loadDashboardData(client);
  }
  renderAdminShell();
  restoreMediaWorkspaceViewport(scrollX, scrollY, '');
}

function restoreMediaWorkspaceViewport(scrollX = 0, scrollY = 0, focusSelector = '') {
  requestAnimationFrame(() => {
    window.scrollTo(scrollX, scrollY);
    if (!focusSelector || !root) return;
    const focusTarget = root.querySelector(focusSelector);
    if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus({ preventScroll: true });
  });
}

function renderMediaUsageReferences(asset = {}) {
  const references = safeArray(asset.usage?.references);
  const wrap = createElement('div', {
    className: 'cms-admin-media-usage-references',
    attrs: { 'aria-label': ADMIN_COPY.media.referencesTitle },
  });
  const header = createElement('div', { className: 'cms-admin-media-reference-header' });
  header.appendChild(createElement('strong', { text: ADMIN_COPY.media.referencesTitle }));
  if (references.length) {
    header.appendChild(createElement('span', { text: formatCount(references.length) }));
  }
  wrap.appendChild(header);

  if (!references.length) {
    wrap.appendChild(createElement('p', { text: asset.usage?.note || ADMIN_COPY.media.usageNotes.insufficient }));
    return wrap;
  }

  wrap.appendChild(createElement('p', { className: 'cms-admin-media-reference-intro', text: ADMIN_COPY.media.referencesIntro }));

  const list = createElement('ul', { className: 'cms-admin-media-reference-list' });
  references.slice(0, 3).forEach((reference) => {
    list.appendChild(renderMediaReferenceDetailItem(reference));
  });
  if (references.length > 3) {
    list.appendChild(createElement('li', { className: 'cms-admin-media-reference-more', text: `+${formatCount(references.length - 3)} ${ADMIN_COPY.media.referenceMore || 'tham chiếu khác'}` }));
  }
  wrap.appendChild(list);
  return wrap;
}

function renderMediaReferenceDetailItem(reference = {}) {
  const target = getResolvedMediaReferenceTarget(reference);
  const labels = ADMIN_COPY.media.referenceFields || {};
  const item = createElement('li', { className: 'cms-admin-media-reference-detail' });
  item.appendChild(createElement('span', { className: 'cms-admin-media-reference-label', text: reference.label || reference.area || 'CMS reference' }));

  const detailRows = [
    [labels.source || 'Nguồn', formatMediaReferenceSource(reference.sourceType)],
    [labels.area || 'Khu vực', reference.area || 'CMS'],
    [labels.field || 'Field/path', reference.field || '—'],
    [labels.target || 'Màn điều hướng', target?.label || getTabLabel(target?.tab) || 'Không xác định'],
    [labels.confidence || 'Độ khớp', formatMediaReferenceMatch(reference.matchType)],
  ];
  const details = createElement('dl', { className: 'cms-admin-media-reference-details' });
  detailRows.forEach(([label, value]) => appendMediaDetail(details, label, value));
  item.appendChild(details);

  const button = renderMediaReferenceNavigationButton(reference);
  if (button) item.appendChild(button);
  return item;
}

function renderMediaReferenceNavigationButton(reference = {}) {
  const target = getResolvedMediaReferenceTarget(reference);
  if (!target) return null;
  const button = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost cms-admin-media-reference-nav-button',
    text: ADMIN_COPY.media.actions.goToReference || 'Đi tới nơi dùng',
    type: 'button',
    attrs: {
      title: ADMIN_COPY.media.referenceNavigationHint || 'Chỉ điều hướng trong CMS, không thay đổi website.',
      'aria-label': buildReferenceNavigationAriaLabel(reference, target),
    },
  });
  button.addEventListener('click', () => handleNavigateToMediaReference(reference));
  return button;
}

function buildCopyMediaUrlLabel(asset = {}) {
  const name = asset.fileName || asset.storagePath || ADMIN_COPY.media.actions.copyUrlAria || ADMIN_COPY.media.actions.copyUrl;
  return `${ADMIN_COPY.media.actions.copyUrlAria || ADMIN_COPY.media.actions.copyUrl}: ${name}`;
}

function buildReferenceNavigationAriaLabel(reference = {}, target = {}) {
  const label = reference.label || reference.area || 'tham chiếu media';
  const targetLabel = target?.label || getTabLabel(target?.tab) || 'màn CMS liên quan';
  return `${ADMIN_COPY.media.actions.goToReference || 'Đi tới nơi dùng'}: ${label} (${targetLabel})`;
}

function getTabLabel(tabKey = '') {
  const key = String(tabKey || '').trim();
  return safeArray(ADMIN_COPY.nav).find((item) => item.key === key)?.label || key;
}

function formatMediaReferenceSource(sourceType = '') {
  const key = String(sourceType || '').trim().toLowerCase();
  return ADMIN_COPY.media.referenceSourceLabels?.[key] || ADMIN_COPY.media.referenceSourceLabels?.unknown || 'Không rõ nguồn';
}

function formatMediaReferenceMatch(matchType = '') {
  const key = String(matchType || '').trim().toLowerCase();
  return ADMIN_COPY.media.referenceMatchLabels?.[key] || ADMIN_COPY.media.referenceMatchLabels?.unknown || 'Không rõ';
}

function getResolvedMediaReferenceTarget(reference = {}) {
  if (reference.targetTab) {
    return {
      tab: reference.targetTab,
      type: reference.targetType || '',
      id: reference.targetId || '',
      fieldName: reference.targetFieldName || '',
      label: reference.targetLabel || '',
      workspaceKey: reference.targetWorkspaceKey || '',
      workspaceTab: reference.targetWorkspaceTab || '',
    };
  }
  return getMediaReferenceNavigationTarget(reference);
}

function handleNavigateToMediaReference(reference = {}) {
  const target = getResolvedMediaReferenceTarget(reference);
  if (!target?.tab || !['settings', 'home', 'staticDraft', 'gate'].includes(target.tab)) return;
  const currentState = getState();
  if (currentState.activeTab !== target.tab) {
    if (!requestLeaveEditSession('media-reference-navigation')) return;
    setActiveTab(target.tab);
  }
  if (target.workspaceKey && target.workspaceTab) {
    setWorkspaceTabState(target.workspaceKey, target.workspaceTab);
  }
  queueMediaReferenceFocus(target);
  renderAdminShell();
}

function queueMediaReferenceFocus(target = {}) {
  if (!target.type) return;
  const focusId = target.id || target.type;
  if (target.type === 'static-draft') {
    queueEntityHighlight('static-draft', focusId || 'static-draft');
  }
  queueReferenceFocus(target.type, focusId, target.fieldName || '', target.label || '');
}

function renderMediaPreview(asset = {}) {
  const preview = createElement('div', { className: `cms-admin-media-preview${isDeletedMediaAsset(asset) || isBrokenDeletedMediaReference(asset) ? ' is-deleted-preview' : ''}` });
  if (isDeletedMediaAsset(asset)) {
    preview.appendChild(createElement('span', { text: 'Đã xóa khỏi Storage' }));
    return preview;
  }
  if (isBrokenDeletedMediaReference(asset)) {
    preview.appendChild(createElement('span', { text: 'Tham chiếu hỏng / path đã xóa' }));
    return preview;
  }
  if (!asset.hasSafePublicUrl) {
    preview.appendChild(createElement('span', { text: asset.publicUrlRaw ? ADMIN_COPY.media.unsafeUrl : ADMIN_COPY.media.previewUnavailable }));
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
    getMediaLifecycleState(asset).label,
    asset.usage?.label,
    safeArray(asset.usage?.references).map((reference) => reference.label).join(' '),
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
  const value = String(status || '').trim().toLowerCase();
  const neutralValues = new Set(['draft', 'attached', 'published', 'orphaned', 'deleted']);
  if (neutralValues.has(value)) return value;
  return String(status || '').trim() || '—';
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

function selectMediaWorkspaceAsset(assetId) {
  const nextId = String(assetId || '');
  if (!nextId) return;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  mediaWorkspaceState.selectedAssetId = nextId;
  renderAdminShell();
  restoreMediaWorkspaceViewport(scrollX, scrollY, buildMediaAssetFocusSelector(nextId));
}


function buildMediaAssetFocusSelector(assetId = '') {
  const raw = String(assetId || '');
  if (!raw) return '';
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(raw)
    : raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `[data-media-asset-id="${escaped}"]`;
}

function clearMediaWorkspaceSelection() {
  mediaWorkspaceState.selectedAssetId = '';
  renderAdminShell();
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


function renderPublishWorkspaceContent(state, activeKey = 'status') {
  switch (activeKey) {
    case 'check':
      return renderPublishCheckWorkspacePanel(state);
    case 'publish':
      return renderPublishActionWorkspacePanel(state);
    case 'history':
      return renderPublishHistoryWorkspacePanel(state);
    case 'status':
    default:
      return renderPublishStatusWorkspacePanel(state);
  }
}

function getPublishContext(state = {}) {
  const data = state.data || {};
  const draftState = state.staticCmsDraft || {};
  const bundle = getCurrentPublishedBundle(data.publishedBundles);
  const canonicalKnown = !data.canonicalError;
  const validation = draftState.validation || null;
  const dryRun = draftState.publishDryRunResult || null;
  return { data, draftState, bundle, canonicalKnown, validation, dryRun };
}

function renderPublishStatusWorkspacePanel(state = {}) {
  const { data, bundle, canonicalKnown } = getPublishContext(state);
  const wrap = createElement('section', { className: 'cms-admin-publish-functional-view cms-admin-publish-status-dashboard' });
  wrap.appendChild(renderPublishCanonicalHeroPanel(state));

  const priority = createElement('div', { className: 'cms-admin-publish-priority-grid' });
  priority.appendChild(renderPublishPriorityCard({
    className: 'is-canonical',
    eyebrow: 'Nguồn public đang chạy',
    title: 'Storage latest / CMS public JSON',
    badge: canonicalKnown ? 'PASS' : 'WARNING',
    body: canonicalKnown
      ? 'Website public đọc nội dung từ object latest trong Storage. Đây là bề mặt canonical để đối chiếu nội dung đang chạy.'
      : `Cần kiểm tra canonical public: ${normalizeErrorMessage(data.canonicalError)}`,
    facts: [
      ['Path canonical', 'cms-public/published/cms_public_content.json'],
      ['Trạng thái đọc', canonicalKnown ? 'Chưa ghi nhận lỗi trong dữ liệu đã tải' : normalizeErrorMessage(data.canonicalError)],
    ],
  }));
  priority.appendChild(renderPublishPriorityCard({
    className: 'is-audit',
    eyebrow: 'Lịch sử/audit chuẩn',
    title: 'cms_publish_logs',
    badge: 'CANONICAL',
    body: 'Đây là nơi đối chiếu publish/rollback thật: ai thao tác, lúc nào, kết quả gì, lỗi hoặc warning nào đã xảy ra.',
    facts: [
      ['Dùng cho', 'Audit vận hành và forensic publish/rollback'],
      ['Không thay thế bằng', 'published_bundles'],
    ],
  }));
  priority.appendChild(renderPublishPriorityCard({
    className: 'is-reference',
    eyebrow: 'Bản ghi DB tham chiếu',
    title: 'published_bundles',
    badge: 'REFERENCE',
    body: 'Chỉ dùng để đối chiếu nhanh hoặc legacy cache. Không kết luận website public đang chạy nội dung nào từ bảng này.',
    facts: [
      ['Phiên bản tham chiếu', bundle?.version || 'Chưa có record'],
      ['Vai trò', 'Reference / legacy cache — không phải public canonical'],
    ],
  }));
  wrap.appendChild(priority);

  const details = createElement('details', { className: 'cms-admin-details cms-admin-publish-technical-details' });
  details.appendChild(createElement('summary', { text: 'Nguồn dữ liệu và vai trò từng lớp' }));
  details.appendChild(renderKeyValueList([
    ['Public canonical', 'Storage latest / CMS public JSON — cms-public/published/cms_public_content.json'],
    ['Version source', 'Storage versions — các object version dùng để đối chiếu/khôi phục theo workflow riêng'],
    ['Operational audit', 'cms_publish_logs — lịch sử vận hành canonical cho publish/rollback'],
    ['DB reference/cache', 'published_bundles — bản ghi tham chiếu/legacy cache, không phải nguồn website public đang chạy'],
  ]));
  wrap.appendChild(details);
  return wrap;
}

function renderPublishPriorityCard({ className = '', eyebrow = '', title = '', badge = '', body = '', facts = [] } = {}) {
  const card = createElement('article', { className: ['cms-admin-publish-priority-card', className].filter(Boolean).join(' ') });
  const head = createElement('div', { className: 'cms-admin-publish-priority-head' });
  const titleWrap = createElement('div', { className: 'cms-admin-publish-priority-title' });
  if (eyebrow) titleWrap.appendChild(createElement('span', { className: 'cms-admin-publish-eyebrow', text: eyebrow }));
  titleWrap.appendChild(createElement('h3', { text: title }));
  head.appendChild(titleWrap);
  if (badge) head.appendChild(renderBadge(badge, badge === 'PASS' || badge === 'CANONICAL' ? 'success' : badge === 'WARNING' ? 'warning' : 'default'));
  card.appendChild(head);
  if (body) card.appendChild(createElement('p', { className: 'cms-admin-publish-priority-copy', text: body }));
  if (facts.length) card.appendChild(renderKeyValueList(facts));
  return card;
}

function renderPublishCanonicalHeroPanel(state = {}) {
  const { data, canonicalKnown } = getPublishContext(state);
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-publish-canonical-hero' });
  panel.appendChild(renderPanelTitle('Đưa website lên bản mới', 'Workspace vận hành an toàn'));
  panel.appendChild(renderCompactNotice('Màn này giúp kiểm tra nguồn public, đọc checklist và mở đúng workflow publish hiện có. Chuyển tab hoặc xem trạng thái không tự ghi dữ liệu.'));
  const facts = createElement('div', { className: 'cms-admin-publish-fact-grid' });
  facts.appendChild(renderInfoTile('Nguồn public canonical', 'Storage latest / CMS public JSON', false));
  facts.appendChild(renderInfoTile('Path canonical', 'cms-public/published/cms_public_content.json', true));
  facts.appendChild(renderInfoTile('Trạng thái đọc', canonicalKnown ? 'Chưa ghi nhận lỗi' : normalizeErrorMessage(data.canonicalError), !canonicalKnown));
  facts.appendChild(renderInfoTile('Audit canonical', 'cms_publish_logs', false));
  panel.appendChild(facts);
  if (!canonicalKnown) panel.appendChild(renderCompactWarning(`Cần kiểm tra public canonical: ${normalizeErrorMessage(data.canonicalError)}`));
  return panel;
}

function renderPublishCanonicalStatusPanel({ canonicalKnown, canonicalError }) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-publish-status-card' });
  panel.appendChild(renderPanelTitle('Trạng thái public canonical', canonicalKnown ? 'PASS' : 'WARNING'));
  panel.appendChild(renderKeyValueList([
    ['Nguồn chính', 'Storage latest / CMS public JSON'],
    ['Path', 'cms-public/published/cms_public_content.json'],
    ['Kết luận', canonicalKnown ? 'Không thấy lỗi canonical trong dữ liệu đã tải' : normalizeErrorMessage(canonicalError)],
  ]));
  panel.appendChild(renderCompactNotice('Chỉ nguồn này cùng lịch sử vận hành mới được dùng để kết luận website public đang chạy nội dung nào.'));
  return panel;
}

function renderPublishDbReferencePanel(bundle) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-publish-reference-card' });
  panel.appendChild(renderPanelTitle('Bản ghi DB tham chiếu', bundle ? 'Reference / legacy cache' : 'Chưa có bản ghi'));
  if (bundle) {
    panel.appendChild(renderKeyValueList([
      ['Bảng', 'published_bundles'],
      ['Mã phiên bản', bundle.version || '—'],
      ['Trạng thái record', getStatusLabel(bundle.status)],
      ['Thời điểm record', formatDateTime(bundle.published_at)],
      ['Ghi chú', getFriendlyNote(bundle.note)],
    ]));
  } else {
    panel.appendChild(renderEmptyState('Chưa đọc được published_bundles. Điều này không tự đồng nghĩa website chưa có public content.'));
  }
  panel.appendChild(renderCompactWarning('Không dùng published_bundles để kết luận bản website đang chạy. Đây chỉ là reference/cache có thể lệch Storage latest hoặc cms_publish_logs.'));
  return panel;
}

function renderPublishAuditCanonicalPanel() {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-publish-audit-card' });
  panel.appendChild(renderPanelTitle('Lịch sử/audit canonical', 'cms_publish_logs'));
  panel.appendChild(renderCompactNotice('Publish/rollback thành công, lỗi hoặc cảnh báo cần được đối chiếu với cms_publish_logs. Phase frontend-only này không thêm API fetch log mới.'));
  panel.appendChild(renderRequirementList('Cách dùng an toàn', [
    'Dùng log để biết ai đã công khai, lúc nào, kết quả gì.',
    'Không dùng published_bundles thay cho audit log vận hành.',
    'Nếu cần forensic hoặc rollback, chuyển sang Lịch sử phiên bản / workflow rollback riêng.',
  ]));
  return panel;
}

function renderPublishCheckWorkspacePanel(state = {}) {
  const { bundle, canonicalKnown, validation, dryRun, draftState, data } = getPublishContext(state);
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-publish-check-panel' });
  panel.appendChild(renderPanelTitle('Kiểm tra trước khi công khai', 'Read-only checklist'));
  panel.appendChild(renderCompactNotice('Checklist này chỉ đọc state đã tải sẵn. Không chạy dry-run, không publish và không rollback.'));

  const list = createElement('div', { className: 'cms-admin-publish-checklist' });
  const rows = [
    buildPublishCheckRow({
      label: 'Public canonical',
      status: canonicalKnown ? 'ready' : 'warning',
      value: canonicalKnown ? 'Storage latest / CMS public JSON chưa ghi nhận lỗi.' : normalizeErrorMessage(data.canonicalError),
      nextAction: canonicalKnown ? 'Tiếp tục kiểm tra bản nháp và dry-run.' : 'Mở website public hoặc kiểm tra Storage latest trước khi publish.',
    }),
    buildPublishCheckRow({
      label: 'Bản nháp đã lưu',
      status: draftState.currentDraftId ? 'ready' : 'blocked',
      value: draftState.currentDraftId ? `Đã có bản nháp ${draftState.currentDraftId}.` : 'Chưa có bằng chứng bản nháp đã lưu trong state hiện tại.',
      nextAction: draftState.currentDraftId ? 'Có thể chuyển sang bước dry-run ở publish gate.' : 'Mở Nội dung phòng 3D để lưu bản nháp trước khi công khai.',
      action: draftState.currentDraftId ? null : { label: 'Mở Nội dung phòng 3D để lưu bản nháp', handler: openStaticDraftPublishGateFromPublishScreen },
    }),
    buildPublishCheckRow({
      label: 'Dirty state',
      status: draftState.dirty ? 'blocked' : 'ready',
      value: draftState.dirty ? 'Đang có thay đổi chưa lưu.' : 'Không ghi nhận thay đổi chưa lưu trong state hiện tại.',
      nextAction: draftState.dirty ? 'Lưu hoặc hủy thay đổi trước khi publish.' : 'Không cần xử lý dirty state ở bước này.',
    }),
    buildPublishCheckRow({
      label: 'Validation nội dung',
      status: validation ? (validation.valid ? 'ready' : 'warning') : 'unknown',
      value: validation ? (validation.valid ? 'Validation hiện tại đạt.' : 'Validation còn lỗi/cảnh báo cần xử lý.') : 'Chưa có validation runtime trong state hiện tại.',
      nextAction: validation?.valid ? 'Tiếp tục dry-run.' : 'Kiểm tra cảnh báo ở màn nội dung trước khi publish thật.',
    }),
    buildPublishCheckRow({
      label: 'Dry-run publish',
      status: dryRun?.ok === true && dryRun?.dryRun === true ? 'ready' : 'unknown',
      value: dryRun?.ok === true && dryRun?.dryRun === true ? 'Dry-run gần nhất đạt và không thay đổi website.' : 'Chưa có bằng chứng dry-run đạt cho bản nháp hiện tại.',
      nextAction: 'Chạy dry-run ở publish gate hiện có trong Nội dung phòng 3D.',
    }),
    buildPublishCheckRow({
      label: 'Bản ghi tham chiếu DB',
      status: bundle?.version ? 'reference' : 'unknown',
      value: bundle?.version ? `${bundle.version} chỉ dùng để đối chiếu/legacy cache.` : 'Chưa đọc được published_bundles.',
      nextAction: 'Không dùng record này để quyết định website public đang chạy nội dung nào.',
    }),
    buildPublishCheckRow({
      label: 'Write từ màn này',
      status: 'ready',
      value: 'Không có publish/dry-run/rollback trực tiếp khi render hoặc chuyển tab.',
      nextAction: 'Chỉ CTA điều hướng nội bộ được phép hoạt động ở màn này.',
    }),
  ];
  rows.forEach((row) => list.appendChild(renderPublishCheckItem(row)));
  panel.appendChild(list);
  panel.appendChild(renderRequirementList('Điều kiện bắt buộc trước publish thật', ADMIN_COPY.publish.requirements));
  return panel;
}

function buildPublishCheckRow(row) {
  return row;
}

function renderPublishCheckItem({ label, status, value, nextAction, action }) {
  const variants = {
    ready: ['PASS', 'success'],
    blocked: ['BLOCKED', 'danger'],
    warning: ['WARNING', 'warning'],
    unknown: ['UNKNOWN', 'default'],
    reference: ['REFERENCE', 'default'],
  };
  const [text, variant] = variants[status] || variants.unknown;
  const item = createElement('article', { className: `cms-admin-publish-check-item is-${status || 'unknown'}` });
  const head = createElement('div', { className: 'cms-admin-publish-check-head' });
  head.appendChild(createElement('strong', { text: label }));
  head.appendChild(renderBadge(text, variant));
  item.appendChild(head);
  item.appendChild(createElement('p', { text: value || '—' }));
  if (nextAction) {
    const actionText = createElement('p', { className: 'cms-admin-publish-next-action', text: `Việc cần làm tiếp theo: ${nextAction}` });
    item.appendChild(actionText);
  }
  if (action?.label && typeof action.handler === 'function') {
    const button = createElement('button', {
      className: 'cms-admin-button cms-admin-button-ghost cms-admin-publish-inline-cta',
      text: action.label,
      type: 'button',
    });
    button.addEventListener('click', action.handler);
    item.appendChild(button);
  }
  return item;
}

function renderPublishActionWorkspacePanel(state = {}) {
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-publish-action-panel' });
  panel.appendChild(renderPanelTitle('Publish Launchpad', 'Điều hướng an toàn'));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-publish-action-lead',
    text: 'Mở đúng workflow công khai thật, nhưng màn này không tự publish website.',
  }));
  panel.appendChild(renderPublishLaunchpadSteps());

  const ctaShell = createElement('section', { className: 'cms-admin-publish-primary-cta-panel' });
  ctaShell.appendChild(createElement('strong', { text: 'Bước tiếp theo an toàn' }));
  const actions = createElement('div', { className: 'cms-admin-publish-cta-row' });
  const openButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary cms-admin-publish-navigation-cta',
    text: 'Mở publish gate trong Nội dung phòng 3D',
    type: 'button',
    attrs: { 'aria-label': 'Mở Nội dung phòng 3D để tiếp tục publish gate an toàn' },
  });
  openButton.addEventListener('click', openStaticDraftPublishGateFromPublishScreen);
  actions.appendChild(openButton);
  actions.appendChild(createElement('a', {
    className: 'cms-admin-button cms-admin-button-ghost cms-admin-publish-secondary-cta',
    text: 'Mở website để xem',
    href: './index.html',
    attrs: { target: '_blank', rel: 'noopener' },
  }));
  ctaShell.appendChild(actions);
  ctaShell.appendChild(createElement('p', {
    className: 'cms-admin-publish-safe-note',
    text: 'Nút chính chỉ mở workflow publish hiện có, không tự công khai website. Publish thật chỉ xảy ra sau dry-run, confirmVersion và xác nhận tại gate đó.',
  }));
  panel.appendChild(ctaShell);

  const locked = createElement('div', { className: 'cms-admin-publish-locked-actions' });
  locked.appendChild(renderDisabledActionRow(['Dry-run trực tiếp tại màn này', 'Publish thật trực tiếp tại màn này'], 'Màn này không gọi Edge Function publish-cms-json. Hãy dùng publish gate trong Nội dung phòng 3D.'));
  locked.appendChild(renderRequirementList('Vì sao khóa nút publish trực tiếp', ADMIN_COPY.publish.disabledReasons));
  panel.appendChild(locked);
  return panel;
}

function renderPublishLaunchpadSteps() {
  const steps = [
    ['1', 'Lưu bản nháp', 'Hoàn tất và lưu nội dung CMS trên server.'],
    ['2', 'Kiểm tra/dry-run', 'Chạy kiểm tra tại publish gate hiện có.'],
    ['3', 'Xác nhận version', 'Đọc cảnh báo và confirmVersion rõ ràng.'],
    ['4', 'Công khai thật', 'Chỉ thao tác tại gate hiện có, không tại màn này.'],
    ['5', 'Mở website kiểm tra', 'Đối chiếu website public sau khi publish thành công.'],
  ];
  const wrap = createElement('ol', { className: 'cms-admin-publish-launchpad-steps' });
  steps.forEach(([number, title, copy]) => {
    const item = createElement('li');
    item.appendChild(createElement('span', { className: 'cms-admin-publish-launchpad-number', text: number }));
    const body = createElement('span', { className: 'cms-admin-publish-launchpad-body' });
    body.appendChild(createElement('strong', { text: title }));
    body.appendChild(createElement('small', { text: copy }));
    item.appendChild(body);
    wrap.appendChild(item);
  });
  return wrap;
}

function openStaticDraftPublishGateFromPublishScreen() {
  setWorkspaceTabState('staticDraft', getWorkspaceActiveTab('staticDraft', getWorkspaceTabs('staticDraft')) || 'indoor');
  switchAdminTab('staticDraft');
}

function renderPublishHistoryWorkspacePanel(state = {}) {
  const bundles = safeArray(state.data?.publishedBundles);
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-publish-history-panel' });
  panel.appendChild(renderPanelTitle('Lịch sử liên quan', 'Read-only'));

  const canonical = createElement('section', { className: 'cms-admin-publish-history-canonical' });
  canonical.appendChild(renderPanelTitle('Lịch sử chuẩn: cms_publish_logs', 'Audit canonical'));
  canonical.appendChild(renderCompactNotice('Đối chiếu cms_publish_logs để biết publish/rollback thật: ai thao tác, lúc nào, kết quả, lỗi và warning. Phase này không thêm API fetch log mới.'));
  const historyButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary cms-admin-publish-navigation-cta',
    text: 'Mở Lịch sử phiên bản để xem audit/rollback',
    type: 'button',
    attrs: { 'aria-label': 'Mở màn Lịch sử phiên bản để xem lịch sử publish rollback' },
  });
  historyButton.addEventListener('click', () => switchAdminTab('history'));
  canonical.appendChild(historyButton);
  panel.appendChild(canonical);

  panel.appendChild(renderRequirementList('Khi cần kiểm tra lịch sử publish/rollback', [
    'Đối chiếu cms_publish_logs hoặc màn Lịch sử phiên bản để xem vận hành thật.',
    'Dùng workflow rollback riêng nếu cần xem hoặc khôi phục phiên bản.',
    'published_bundles bên dưới chỉ là reference/cache để đối chiếu nhanh.',
  ]));

  const legacy = createElement('section', { className: 'cms-admin-publish-legacy-history' });
  legacy.appendChild(renderPanelTitle('Bản ghi tham chiếu DB', `${formatCount(bundles.length)} record legacy/cache`));
  legacy.appendChild(renderCompactWarning('Bảng published_bundles này không phải audit log canonical. Có thể lệch Storage latest hoặc cms_publish_logs.'));
  legacy.appendChild(renderBundlesTable(bundles));
  panel.appendChild(legacy);
  return panel;
}

function renderPublishTab(state) {
  const data = state.data || {};
  const bundle = getCurrentPublishedBundle(data.publishedBundles);
  const panel = createElement('section', { className: 'cms-admin-grid cms-admin-publish-view' });
  panel.appendChild(renderOperatorStepPanel(ADMIN_COPY.publish.operatorSteps, { status: 'Không tự ghi' }));

  const summary = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-publish-summary-panel' });
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
  summary.appendChild(renderCompactNotice(ADMIN_COPY.publish.currentHint));
  summary.appendChild(renderCompactWarning(ADMIN_COPY.publish.dbReferenceHint));

  const readiness = renderPublishReadinessPanel(state, bundle);

  const workflow = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-publish-workflow-panel' });
  workflow.appendChild(renderPanelTitle(ADMIN_COPY.publish.workflowTitle, ADMIN_COPY.publish.workflowStatus));
  workflow.appendChild(renderCompactNotice(ADMIN_COPY.publish.surfaceBody));
  workflow.appendChild(renderWorkflowSteps(ADMIN_COPY.publish.workflowSteps));
  workflow.appendChild(renderDisabledActionRow(ADMIN_COPY.publish.actions, ADMIN_COPY.publish.disabledActionReason));
  workflow.appendChild(renderLockedNotice(ADMIN_COPY.publish.lockedNote));
  workflow.appendChild(renderRequirementList(ADMIN_COPY.publish.requirementsTitle, ADMIN_COPY.publish.requirements));
  workflow.appendChild(renderRequirementList(ADMIN_COPY.publish.disabledReasonsTitle, ADMIN_COPY.publish.disabledReasons));
  workflow.appendChild(renderPublicLink(ADMIN_COPY.publish.publicLink, './index.html'));
  workflow.appendChild(renderCompactWarning(ADMIN_COPY.publish.notice));

  appendChildren(panel, [summary, readiness, workflow]);
  return panel;
}

function renderPublishReadinessPanel(state = {}, bundle = null) {
  const copy = ADMIN_COPY.publish;
  const data = state.data || {};
  const draftState = state.staticCmsDraft || {};
  const fields = copy.readinessFields || {};
  const canonicalKnown = !data.canonicalError;
  const validation = draftState.validation || null;
  const dryRun = draftState.publishDryRunResult || null;
  const rows = [
    [fields.canonicalJson, canonicalKnown ? 'Chưa ghi nhận lỗi ở nội dung website đang dùng' : `Cần kiểm tra: ${normalizeErrorMessage(data.canonicalError)}`],
    [fields.publicBundle, bundle?.version ? `Bản ghi tham chiếu ${bundle.version} · chỉ để đối chiếu` : 'Chưa đọc được bản ghi tham chiếu'],
    [fields.savedDraft, draftState.currentDraftId ? `Đã lưu bản nháp ${draftState.currentDraftId}` : 'Chỉ có thể công khai từ bản nháp đã lưu trong Nội dung phòng 3D'],
    [fields.dirtyState, draftState.dirty ? 'Đang có thay đổi chưa lưu — phải lưu trước khi công khai' : 'Không ghi nhận thay đổi chưa lưu trong bản nháp đang mở'],
    [fields.validation, validation ? (validation.valid ? 'Kiểm tra nội dung hiện tại đạt' : 'Kiểm tra nội dung còn lỗi/cảnh báo cần xử lý') : 'Chưa có kết quả kiểm tra nội dung trong trạng thái hiện tại'],
    [fields.dryRun, dryRun?.ok === true && dryRun?.dryRun === true ? 'Kiểm tra an toàn gần nhất đạt' : 'Chưa có kiểm tra an toàn đạt cho bản nháp hiện tại'],
    [fields.mainTabWrite, 'Đã khóa — màn này chỉ hướng dẫn và xem trạng thái'],
    [fields.publishGate, 'Dùng bước công khai trong Nội dung phòng 3D sau khi lưu bản nháp'],
    [fields.history, 'Lịch sử/khôi phục là quy trình riêng, không tự chạy từ màn này'],
  ];

  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-publish-readiness-panel' });
  panel.appendChild(renderPanelTitle(copy.readinessTitle, copy.readinessStatus));
  panel.appendChild(renderCompactNotice(copy.readinessIntro));
  panel.appendChild(renderCompactNotice(copy.canonicalHint));
  const grid = createElement('div', { className: 'cms-admin-publish-readiness-grid' });
  rows.forEach(([label, value]) => grid.appendChild(renderInfoTile(label, value || '—')));
  panel.appendChild(grid);
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
  const wrap = createElement('section', { className: 'cms-admin-settings-workspace cms-admin-settings-single-workspace' });

  const feedback = renderSiteSettingsFeedback(editState);
  if (feedback) wrap.appendChild(feedback);

  wrap.appendChild(renderSiteSettingsWorkspaceHeader());
  wrap.appendChild(renderSiteSettingsSummaryCards(state, siteSettings, editState));

  const workspace = createElement('div', { className: 'cms-admin-settings-workspace-grid' });
  workspace.appendChild(renderSiteSettingsFormWorkspacePanel(state, siteSettings, editState, canEdit));
  workspace.appendChild(renderSiteSettingsActionPanel(state, siteSettings, editState, canEdit));
  wrap.appendChild(workspace);
  wrap.appendChild(renderSettingsAdminDetails(state, siteSettings));
  return wrap;
}

function renderSiteSettingsFeedback(editState = {}) {
  if (editState.saveError) {
    return renderNoticeBox(`${ADMIN_COPY.settings.edit.error} ${normalizeErrorMessage(editState.saveError)}`, 'error');
  }
  if (editState.saveSuccess) {
    return renderNoticeBox(editState.saveSuccess, 'success');
  }
  return null;
}

function renderSiteSettingsWorkspaceHeader() {
  const header = createElement('section', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-settings-workspace-header' });
  const title = createElement('div');
  title.appendChild(createElement('span', { className: 'cms-admin-eyebrow', text: 'CẤU HÌNH / THÔNG TIN WEBSITE' }));
  title.appendChild(createElement('h2', { text: ADMIN_COPY.settings.websiteTitle || 'Thông tin website' }));
  title.appendChild(createElement('p', {
    className: 'cms-admin-compact-copy',
    text: ADMIN_COPY.settings.workspaceIntro || 'Cập nhật thông tin đơn vị, liên hệ và nhận diện. Lưu vào CMS chưa làm đổi website public.',
  }));
  const badges = createElement('div', { className: 'cms-admin-settings-header-badges' });
  badges.appendChild(renderBadge('Bản nháp CMS', 'warning'));
  badges.appendChild(renderBadge('Không tự công khai', 'success'));
  appendChildren(header, [title, badges]);
  return header;
}

function renderSiteSettingsSummaryCards(state, siteSettings, editState = {}) {
  const validation = getSiteSettingsValidationForState(siteSettings, editState);
  const summary = createElement('section', { className: 'cms-admin-settings-summary-grid', attrs: { 'aria-label': 'Tóm tắt trạng thái Thông tin website' } });
  const cards = [
    {
      label: 'Dữ liệu CMS',
      value: siteSettings ? 'Đã đọc' : 'Chưa đọc được',
      note: siteSettings ? 'Đang dùng bản ghi CMS hiện có.' : 'Chưa có dữ liệu để hiển thị.',
      tone: siteSettings ? 'success' : 'warning',
    },
    {
      label: 'Chế độ chỉnh sửa',
      value: editState.isEditing ? 'Đang chỉnh' : 'Chỉ xem',
      note: editState.isEditing ? 'Input chỉ cập nhật bản nháp local.' : 'Mở chỉnh sửa khi cần cập nhật.',
      tone: editState.isEditing ? 'warning' : 'default',
    },
    {
      label: 'Thay đổi chưa lưu',
      value: editState.dirty ? 'Có' : 'Không',
      note: editState.saving ? 'Đang lưu vào CMS.' : editState.dirty ? 'Cần lưu hoặc đặt lại.' : 'Không có thay đổi mới.',
      tone: editState.dirty ? 'warning' : 'success',
    },
    {
      label: 'Website public',
      value: 'Chưa đổi',
      note: 'Chỉ đổi sau luồng công khai riêng.',
      tone: validation.valid ? 'success' : 'warning',
    },
  ];
  cards.forEach((card) => summary.appendChild(renderSiteSettingsSummaryCard(card)));
  return summary;
}

function renderSiteSettingsSummaryCard(card = {}) {
  const item = createElement('article', { className: 'cms-admin-settings-summary-card' });
  item.appendChild(createElement('span', { className: 'cms-admin-stat-label', text: card.label }));
  item.appendChild(createElement('strong', { text: card.value }));
  if (card.note) item.appendChild(createElement('p', { className: 'cms-admin-stat-note', text: card.note }));
  if (card.tone) item.appendChild(renderBadge(card.tone === 'success' ? 'Rõ' : card.tone === 'warning' ? 'Cần chú ý' : 'Thông tin', card.tone));
  return item;
}

function renderSiteSettingsFormWorkspacePanel(state, siteSettings, editState = {}, canEdit = false) {
  const panel = createElement('section', {
    className: 'cms-admin-panel cms-admin-view-panel cms-admin-settings-form-panel',
    dataset: { cmsEditPanel: 'site-settings', cmsEditId: 'site-settings' },
  });
  panel.appendChild(renderPanelTitle('Form thông tin website', editState.isEditing ? 'Đang chỉnh bản nháp CMS' : 'Chỉ xem'));
  panel.appendChild(createElement('p', {
    className: 'cms-admin-compact-copy',
    text: editState.isEditing
      ? 'Sửa thông tin trong form. Website public chưa đổi cho tới khi lưu CMS và công khai ở luồng riêng.'
      : 'Thông tin đang đọc từ CMS. Mở chỉnh sửa để tạo thay đổi local trước khi lưu.',
  }));

  if (!siteSettings) {
    panel.appendChild(renderEmptyState(ADMIN_COPY.settings.siteMissing));
    return panel;
  }

  if (editState.isEditing) {
    panel.appendChild(renderSiteSettingsEditPanel(state, siteSettings, editState));
  } else {
    panel.appendChild(renderSiteSettingsReadOnlyGroups(siteSettings));
    if (canEdit) {
      const editButton = createElement('button', {
        className: 'cms-admin-button cms-admin-button-primary cms-admin-settings-inline-edit-button',
        text: ADMIN_COPY.settings.edit.button,
        type: 'button',
      });
      editButton.addEventListener('click', () => handleStartSiteSettingsEdit(siteSettings));
      panel.appendChild(editButton);
    } else {
      panel.appendChild(renderCompactNotice(ADMIN_COPY.settings.edit.noPermission));
    }
  }
  return panel;
}

function renderSiteSettingsReadOnlyGroups(siteSettings = {}) {
  const groups = createElement('div', { className: 'cms-admin-settings-form-groups' });
  groups.appendChild(renderSiteSettingsReadOnlyGroup('Tên & đơn vị', [
    [ADMIN_COPY.settings.websiteFields.siteTitle, siteSettings.site_title],
    [ADMIN_COPY.settings.websiteFields.organization, siteSettings.organization_name],
  ]));
  groups.appendChild(renderSiteSettingsReadOnlyGroup('Liên hệ', [
    [ADMIN_COPY.settings.websiteFields.address, siteSettings.address || '—'],
    [ADMIN_COPY.settings.websiteFields.phone, siteSettings.phone || '—'],
    [ADMIN_COPY.settings.websiteFields.fax, siteSettings.fax || '—'],
    [ADMIN_COPY.settings.websiteFields.email, siteSettings.email || '—'],
  ]));
  groups.appendChild(renderSiteSettingsDisplayGroup(siteSettings));
  groups.appendChild(renderSiteSettingsTechnicalDetails(siteSettings));
  return groups;
}

function renderSiteSettingsReadOnlyGroup(title, rows = []) {
  const group = createElement('section', { className: 'cms-admin-settings-field-group' });
  group.appendChild(createElement('h3', { className: 'cms-admin-data-group-title', text: title }));
  group.appendChild(renderKeyValueList(rows));
  return group;
}

function renderSiteSettingsDisplayGroup(siteSettings = {}) {
  return renderSiteSettingsReadOnlyGroup('Hiển thị', [
    [ADMIN_COPY.settings.websiteFields.language, getLanguageLabel(siteSettings.default_language)],
  ]);
}

function renderSiteSettingsEditPanel(state, siteSettings, editState) {
  const copy = ADMIN_COPY.settings.edit;
  const form = createElement('form', { className: 'cms-admin-edit-form cms-admin-settings-edit-form cms-admin-settings-single-form', attrs: { novalidate: 'true' } });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    handleSaveSiteSettingsDraft();
  });

  const identityGroup = renderSiteSettingsEditGroup('Tên & đơn vị', [
    renderEditableTextField('site_title', copy.fields.site_title, editState, { required: true, placeholder: copy.placeholders.site_title }),
    renderEditableTextField('organization_name', copy.fields.organization_name, editState, { required: true, placeholder: copy.placeholders.organization_name }),
  ]);
  const contactGroup = renderSiteSettingsEditGroup('Liên hệ', [
    renderEditableTextField('address', copy.fields.address, editState, { multiline: true, placeholder: copy.placeholders.address }),
    renderEditableTextField('phone', copy.fields.phone, editState, { placeholder: copy.placeholders.phone }),
    renderEditableTextField('fax', copy.fields.fax, editState, { placeholder: copy.placeholders.fax }),
    renderEditableTextField('email', copy.fields.email, editState, { inputType: 'email', placeholder: copy.placeholders.email }),
  ]);
  const displayGroup = createElement('section', { className: 'cms-admin-settings-field-group cms-admin-settings-edit-group' });
  displayGroup.appendChild(createElement('h3', { className: 'cms-admin-data-group-title', text: 'Hiển thị' }));
  const displayFields = createElement('div', { className: 'cms-admin-edit-field-grid cms-admin-settings-edit-field-grid' });
  displayFields.appendChild(renderEditableLanguageField(editState));
  displayGroup.appendChild(displayFields);

  const technicalSiteSettings = {
    ...siteSettings,
    default_language: editState.draftValues?.default_language ?? siteSettings.default_language,
  };

  form.appendChild(identityGroup);
  form.appendChild(contactGroup);
  form.appendChild(displayGroup);
  form.appendChild(renderSiteSettingsTechnicalDetails(technicalSiteSettings, true));

  const dirtyNotice = createElement('p', {
    className: `cms-admin-dirty-notice${editState.dirty ? '' : ' cms-admin-hidden'}`,
    text: copy.dirty,
    attrs: { role: 'status' },
  });
  form.appendChild(dirtyNotice);
  form.addEventListener('input', () => updateSiteSettingsFormControls(form));
  form.addEventListener('change', () => updateSiteSettingsFormControls(form));
  return form;
}

function renderSiteSettingsEditGroup(title, fields = []) {
  const group = createElement('section', { className: 'cms-admin-settings-field-group cms-admin-settings-edit-group' });
  group.appendChild(createElement('h3', { className: 'cms-admin-data-group-title', text: title }));
  const grid = createElement('div', { className: 'cms-admin-edit-field-grid cms-admin-settings-edit-field-grid' });
  fields.forEach((field) => grid.appendChild(field));
  group.appendChild(grid);
  return group;
}

function renderSiteSettingsTechnicalDetails(siteSettings = {}, editing = false) {
  const details = createElement('details', { className: 'cms-admin-settings-technical-details cms-admin-technical-details' });
  details.appendChild(createElement('summary', { text: ADMIN_COPY.settings.technicalTitle || 'Thông tin kỹ thuật' }));
  details.appendChild(renderKeyValueList([
    ['Trạng thái bản ghi CMS', getStatusLabel(siteSettings.site_status)],
    ['Record id', siteSettings.id || '—'],
    ['Cập nhật lúc', siteSettings.updated_at ? formatDateTime(siteSettings.updated_at) : '—'],
    ['Cập nhật bởi', siteSettings.updated_by || '—'],
    ['Ngôn ngữ raw', siteSettings.default_language || '—'],
    ['Chế độ', editing ? 'Đang chỉnh bản nháp local' : 'Chỉ xem'],
  ]));
  return details;
}

function renderSiteSettingsActionPanel(state, siteSettings, editState = {}, canEdit = false) {
  const panel = createElement('aside', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-settings-action-panel' });
  panel.appendChild(renderPanelTitle('Trạng thái & thao tác', editState.isEditing ? 'Bản nháp CMS' : 'Chỉ xem'));
  panel.appendChild(renderSiteSettingsDraftStatusBox(state, siteSettings, editState, canEdit));
  panel.appendChild(renderSiteSettingsValidationSummary(siteSettings, editState));
  panel.appendChild(renderSiteSettingsActionButtons(siteSettings, editState, canEdit));
  panel.appendChild(renderCompactNotice(ADMIN_COPY.settings.publicBoundaryNote || 'Lưu vào CMS chưa làm đổi website public. Website chỉ đổi sau luồng công khai riêng.'));
  return panel;
}

function renderSiteSettingsDraftStatusBox(state, siteSettings, editState = {}, canEdit = false) {
  const box = createElement('section', { className: 'cms-admin-settings-status-box' });
  box.appendChild(createElement('h3', { className: 'cms-admin-data-group-title', text: 'Trạng thái bản nháp CMS' }));
  const rows = [
    ['Dữ liệu CMS', siteSettings ? 'Đã đọc' : 'Chưa đọc được'],
    ['Quyền chỉnh sửa', canEdit ? 'Có thể chỉnh' : 'Không đủ điều kiện chỉnh'],
    ['Trạng thái chỉnh sửa', editState.isEditing ? (editState.dirty ? 'Có thay đổi chưa lưu' : 'Đang chỉnh — chưa có thay đổi') : 'Chỉ xem'],
    ['Lưu dữ liệu', editState.saving ? 'Đang lưu vào CMS' : 'Chỉ lưu khi bấm nút lưu'],
  ];
  box.appendChild(renderKeyValueList(rows));
  if (!siteSettings) box.appendChild(renderCompactWarning(ADMIN_COPY.settings.siteMissing));
  return box;
}

function renderSiteSettingsValidationSummary(siteSettings, editState = {}) {
  const validation = getSiteSettingsValidationForState(siteSettings, editState);
  const box = createElement('section', { className: 'cms-admin-settings-validation-panel' });
  box.appendChild(createElement('h3', { className: 'cms-admin-data-group-title', text: 'Kiểm tra thông tin' }));
  const items = [
    ['Tên website', validation.errors.site_title ? 'Cần nhập' : 'Đạt', validation.errors.site_title],
    ['Đơn vị quản lý', validation.errors.organization_name ? 'Cần nhập' : 'Đạt', validation.errors.organization_name],
    ['Email', validation.errors.email ? 'Sai định dạng' : (validation.values.email ? 'Đạt' : 'Chưa khai báo'), validation.errors.email || validation.warnings.email],
    ['Ngôn ngữ', validation.errors.default_language ? 'Không hợp lệ' : 'Đạt', validation.errors.default_language],
  ];
  const list = createElement('div', { className: 'cms-admin-settings-validation-list' });
  items.forEach(([label, status, detail]) => {
    const item = createElement('div', { className: `cms-admin-settings-validation-item${detail ? ' has-warning' : ''}` });
    item.appendChild(createElement('span', { text: label }));
    item.appendChild(renderBadge(status, detail ? 'warning' : 'success'));
    if (detail) item.appendChild(createElement('small', { text: detail }));
    list.appendChild(item);
  });
  box.appendChild(list);
  const warnings = Object.entries(validation.warnings || {}).filter(([key]) => key !== 'email');
  if (warnings.length) {
    const details = createElement('details', { className: 'cms-admin-settings-validation-details' });
    details.appendChild(createElement('summary', { text: 'Warning khác cần rà soát' }));
    const warningList = createElement('ul');
    warnings.forEach(([, message]) => warningList.appendChild(createElement('li', { text: message })));
    details.appendChild(warningList);
    box.appendChild(details);
  }
  return box;
}

function renderSiteSettingsActionButtons(siteSettings, editState = {}, canEdit = false) {
  const box = createElement('section', { className: 'cms-admin-settings-action-box' });
  box.appendChild(createElement('h3', { className: 'cms-admin-data-group-title', text: 'Thao tác' }));
  const actions = createElement('div', { className: 'cms-admin-settings-action-buttons' });
  if (!editState.isEditing) {
    const editButton = createElement('button', {
      className: 'cms-admin-button cms-admin-button-primary',
      text: ADMIN_COPY.settings.edit.button,
      type: 'button',
    });
    editButton.disabled = !canEdit || !siteSettings;
    editButton.addEventListener('click', () => handleStartSiteSettingsEdit(siteSettings));
    actions.appendChild(editButton);
    box.appendChild(actions);
    box.appendChild(renderCompactNotice(getSiteSettingsDisabledReason(siteSettings, editState, canEdit) || ADMIN_COPY.settings.edit.safeNote));
    return box;
  }

  const validation = getSiteSettingsValidationForState(siteSettings, editState);
  const saveButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary',
    text: editState.saving ? (ADMIN_COPY.settings.edit.saving || 'Đang lưu...') : (ADMIN_COPY.settings.edit.save || 'Lưu vào CMS'),
    type: 'button',
  });
  saveButton.disabled = Boolean(editState.saving) || !Boolean(editState.dirty) || !validation.valid || !canEdit;
  saveButton.addEventListener('click', () => handleSaveSiteSettingsDraft());

  const resetButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary',
    text: ADMIN_COPY.settings.edit.reset,
    type: 'button',
  });
  resetButton.disabled = Boolean(editState.saving) || !Boolean(editState.dirty);
  resetButton.addEventListener('click', () => handleResetActiveDraft('site-settings'));

  const cancelButton = createElement('button', {
    className: 'cms-admin-button cms-admin-button-ghost',
    text: ADMIN_COPY.settings.edit.cancel,
    type: 'button',
  });
  cancelButton.disabled = Boolean(editState.saving);
  cancelButton.addEventListener('click', () => handleCancelSiteSettingsEdit());

  appendChildren(actions, [saveButton, resetButton, cancelButton]);
  box.appendChild(actions);
  box.appendChild(renderCompactNotice(getSiteSettingsDisabledReason(siteSettings, editState, canEdit, validation)));
  return box;
}

function handleStartSiteSettingsEdit(siteSettings) {
  const guard = requestStartEditSession({ type: 'site-settings', id: 'site-settings' });
  if (!guard.allowed) return;
  if (!guard.same) startSiteSettingsEdit(siteSettings);
  queueEditPanelFocus('site-settings', 'site-settings', 'site_title');
  renderAdminShell();
}

function getSiteSettingsDisabledReason(siteSettings, editState = {}, canEdit = false, validation = null) {
  if (!siteSettings) return 'Chưa đọc được dữ liệu CMS.';
  if (!canEdit) return ADMIN_COPY.settings.edit.noPermission;
  if (editState.saving) return 'Đang lưu, vui lòng chờ.';
  if (editState.isEditing && validation && !validation.valid) return 'Cần sửa lỗi trước khi lưu.';
  if (editState.isEditing && !editState.dirty) return 'Chưa có thay đổi để lưu.';
  if (editState.isEditing) return 'Lưu vào CMS chưa làm đổi website public.';
  return 'Mở chỉnh sửa để cập nhật bản nháp CMS.';
}

function getSiteSettingsValidationForState(siteSettings, editState = {}) {
  const values = editState.isEditing
    ? (editState.draftValues || {})
    : {
        site_title: siteSettings?.site_title || '',
        organization_name: siteSettings?.organization_name || '',
        address: siteSettings?.address || '',
        phone: siteSettings?.phone || '',
        fax: siteSettings?.fax || '',
        email: siteSettings?.email || '',
        default_language: siteSettings?.default_language || 'vi',
      };
  return validateSiteSettingsDraft(values, ADMIN_COPY.settings.edit);
}

function renderSettingsAdminDetails(state, siteSettings) {
  const details = createElement('details', { className: 'cms-admin-panel cms-admin-view-panel cms-admin-settings-admin-details' });
  details.appendChild(createElement('summary', { text: ADMIN_COPY.settings.adminTitle || 'Trạng thái quản trị' }));
  details.appendChild(renderKeyValueList([
    [ADMIN_COPY.settings.adminFields.role, getRoleLabel(state.profile?.role)],
    [ADMIN_COPY.settings.adminFields.viewMode, ADMIN_FEATURE_FLAGS.readOnlyMode ? ADMIN_COPY.maps.viewMode.on : ADMIN_COPY.maps.viewMode.off],
    [ADMIN_COPY.settings.adminFields.writeActions, getWriteActionStatusLabel()],
    [ADMIN_COPY.settings.adminFields.connection, Object.keys(state.data.errors || {}).length ? ADMIN_COPY.dashboard.cards.connection.warning : ADMIN_COPY.dashboard.cards.connection.ok],
    ['Bảng dữ liệu', 'site_settings'],
    ['Record id', siteSettings?.id || '—'],
  ]));
  details.appendChild(renderCompactNotice(ADMIN_COPY.settings.notice));
  return details;
}

function normalizeSiteLogoPickerMediaAsset(asset = {}) {
  const publicUrl = firstAvailableSiteLogoMediaValue(asset, ['public_url', 'publicUrl', 'url']);
  const storagePath = firstAvailableSiteLogoMediaValue(asset, ['storage_path', 'storagePath', 'path', 'file_name', 'fileName']);
  const rawUrl = publicUrl || storagePath || '';
  const safeUrl = normalizeSafeSiteLogoMediaUrl(rawUrl);
  const fieldName = firstAvailableSiteLogoMediaValue(asset, ['field_name', 'fieldName']);
  const mediaKind = normalizeSiteLogoMediaKind(
    firstAvailableSiteLogoMediaValue(asset, ['media_kind', 'mediaKind', 'asset_type', 'assetType']),
    fieldName,
    firstAvailableSiteLogoMediaValue(asset, ['mime_type', 'mimeType']),
    storagePath || publicUrl,
  );
  const roomKey = firstAvailableSiteLogoMediaValue(asset, ['room_key', 'roomKey']);
  const itemId = firstAvailableSiteLogoMediaValue(asset, ['item_id', 'itemId']);
  const artworkCode = firstAvailableSiteLogoMediaValue(asset, ['artwork_code', 'artworkCode']);
  const sectionKey = firstAvailableSiteLogoMediaValue(asset, ['section_key', 'sectionKey']);
  const fileName = getSiteLogoMediaFileName(storagePath, safeUrl || publicUrl);
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
    firstAvailableSiteLogoMediaValue(asset, ['target_type', 'targetType']),
  ].join(' ').toLowerCase();

  return {
    ...asset,
    id: firstAvailableSiteLogoMediaValue(asset, ['id']) || storagePath || publicUrl || fileName,
    rawUrl,
    safeUrl,
    hasSafeUrl: Boolean(safeUrl),
    storagePath,
    fileName,
    mediaKind,
    mimeType: firstAvailableSiteLogoMediaValue(asset, ['mime_type', 'mimeType']),
    sizeBytes: Number(firstAvailableSiteLogoMediaValue(asset, ['size_bytes', 'sizeBytes'])) || 0,
    targetType: firstAvailableSiteLogoMediaValue(asset, ['target_type', 'targetType']),
    roomKey,
    sectionKey,
    itemId,
    artworkCode,
    fieldName,
    status: firstAvailableSiteLogoMediaValue(asset, ['status']),
    createdAt: firstAvailableSiteLogoMediaValue(asset, ['created_at', 'createdAt']),
    searchText,
  };
}


function isSelectableCmsMediaPickerAsset(asset = {}) {
  const status = String(asset.status || asset.lifecycle || '').trim().toLowerCase();
  if (status === 'deleted' || status === 'deleted-reference' || status === 'broken-reference') return false;
  if (asset.isDeleted || asset.deleted || asset.isBrokenDeletedReference) return false;
  if (!asset.hasSafeUrl || !asset.rawUrl) return false;
  return true;
}

function normalizeSafeSiteLogoMediaUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('blob:') || lower.startsWith('file:')) return '';
  if (isAllowedSiteLogoRelativeMediaPath(raw)) return raw;
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

function isAllowedSiteLogoRelativeMediaPath(value = '') {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('//') || raw.includes('..') || raw.includes('\\')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  return safeArray(STATIC_CMS_DRAFT_CONFIG.allowedMediaPathPrefixes).some((prefix) => {
    const normalizedPrefix = String(prefix || '').trim();
    return normalizedPrefix && raw.startsWith(normalizedPrefix);
  });
}

function normalizeSiteLogoMediaKind(value = '', fieldName = '', mimeType = '', path = '') {
  const raw = String(value || '').toLowerCase();
  const field = String(fieldName || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  const source = String(path || '').split('?')[0].toLowerCase();
  if (raw.includes('video') || mime.startsWith('video/') || field.includes('video') || /\.(mp4|webm|mov)$/i.test(source)) return 'video';
  if (raw.includes('poster') || field.includes('poster')) return 'poster';
  if (raw.includes('image') || raw.includes('ảnh') || mime.startsWith('image/') || field.includes('image') || /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(source)) return 'image';
  return 'unknown';
}

function formatSiteLogoFileBytes(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value <= 0) return 'Không rõ';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function getSiteLogoMediaKindLabel(mediaKind = '') {
  const kind = String(mediaKind || '').toLowerCase();
  if (kind === 'video') return 'Video';
  if (kind === 'poster') return 'Poster';
  if (kind === 'image') return 'Ảnh';
  return 'Không rõ';
}

function getSiteLogoPickerTargetText(asset = {}) {
  const room = asset.roomKey ? getRoomLabel(asset.roomKey) : '';
  const item = asset.artworkCode || asset.itemId || asset.sectionKey || '';
  if (room && item) return `${room} / ${item}`;
  return room || item || 'Không có metadata';
}

function getSiteLogoMediaFileName(storagePath = '', publicUrl = '') {
  const source = String(storagePath || publicUrl || '').split('?')[0];
  const pieces = source.split('/').filter(Boolean);
  const rawName = pieces[pieces.length - 1] || source || 'media';
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function firstAvailableSiteLogoMediaValue(object = {}, keys = []) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function normalizeSiteLogoDraftValue(value = '') {
  return String(value || '').trim();
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
  const valuesToSave = validation.values;
  const { error } = await updateSiteSettingsDraft(
    latestState.supabase,
    latestState.data.siteSettings?.id,
    valuesToSave,
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
  gateEditTargetKey = '';
  renderAdminShell();
}

function handleCancelGateEdit() {
  const editState = getState().gateEdit || {};
  if (editState.dirty && !window.confirm(ADMIN_COPY.contentViews.gate.edit.leaveConfirm)) return;
  resetGateEdit();
  gateEditTargetKey = '';
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
  return renderGateWorkspaceContent(state, getWorkspaceActiveTab('gate', getWorkspaceTabs('gate')));
}

function renderHomeDataView(state) {
  const copy = ADMIN_COPY.contentViews.home;
  const sections = safeArray(state.data.indexSections);
  const editState = state.homeEdit || {};
  const wrap = createElement('section', { className: 'cms-admin-grid cms-admin-readonly-data-view cms-admin-home-data-view' });

  if (editState.saveSuccess && !editState.isEditing) {
    wrap.appendChild(renderNoticeBox(editState.saveSuccess, 'success'));
  }

  wrap.appendChild(renderOperatorStepPanel(copy.operatorSteps, { status: 'Bản nháp' }));

  const panel = createElement('section', {
    className: 'cms-admin-panel cms-admin-view-panel',
    dataset: { cmsReferenceTarget: 'home', cmsReferenceId: 'home' },
  });
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

  wrap.appendChild(renderOperatorStepPanel(copy.operatorSteps, { status: 'Bản nháp' }));

  const panel = createElement('section', {
    className: 'cms-admin-panel cms-admin-view-panel',
    dataset: { cmsReferenceTarget: 'gate', cmsReferenceId: 'gate' },
  });
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

  const main = createElement('section', {
    className: 'cms-admin-data-card cms-admin-gate-main-card',
    dataset: { cmsReferenceTarget: 'gate', cmsReferenceId: 'gate' },
  });
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
  const referenceTargetType = isHero ? 'home-hero' : isGuide ? 'home-guide' : isExperience ? 'home-experience' : isContact ? 'home-contact' : 'home-section';
  const referenceTargetId = isHero ? 'hero' : isGuide ? 'guide' : isExperience ? 'experience' : isContact ? 'contact' : key;
  const card = createElement('article', {
    className: `cms-admin-data-card cms-admin-index-section-card${isHero ? ' cms-admin-home-hero-card' : ''}${isGuide ? ' cms-admin-home-guide-card' : ''}${isExperience ? ' cms-admin-home-experience-card' : ''}`,
    dataset: {
      cmsReferenceTarget: referenceTargetType,
      cmsReferenceId: referenceTargetId,
      cmsReferenceField: isHero ? 'videoUrl' : '',
    },
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
  if (copy.publicNote) block.appendChild(renderCompactNotice(copy.publicNote));

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
    title: copy.openSettingsTitle || 'Mở tab Thông tin website để chỉnh dữ liệu liên hệ chính thức',
    type: 'button',
    ariaLabel: copy.openSettingsAria || 'Mở Thông tin website để chỉnh dữ liệu liên hệ chính thức',
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
      setWorkspaceTabState('home', 'hero');
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

function getHomeEditSectionUiMeta(sectionKey = 'hero') {
  const key = String(sectionKey || 'hero');
  const map = {
    hero: {
      badge: 'Bản nháp trong CMS',
      title: 'Đang chỉnh sửa Khu vực đầu trang',
      lead: 'Sửa phần người xem thấy đầu tiên. Website public chỉ thay đổi sau khi lưu bản nháp và chạy workflow công khai riêng.',
      mainTitle: 'Nội dung chính',
      mainNote: 'Ưu tiên tiêu đề, nhãn nhỏ và mô tả. Đây là phần quan trọng nhất của Trang chủ.',
      role: 'Ấn tượng đầu tiên',
    },
    experience: {
      badge: 'Nội dung chữ',
      title: 'Đang chỉnh sửa Khu vực trải nghiệm',
      lead: 'Sửa phần giới thiệu trải nghiệm và các card hiện có. Mã phòng, đường dẫn và nút kỹ thuật vẫn được khóa.',
      mainTitle: 'Nội dung trải nghiệm',
      mainNote: 'Giữ nội dung ngắn, rõ, giúp người xem hiểu hành trình hoặc điểm nhấn trước khi vào phòng trưng bày.',
      role: 'Bổ trợ hành trình',
    },
    guide: {
      badge: 'Hướng dẫn',
      title: 'Đang chỉnh sửa Hướng dẫn tham quan',
      lead: 'Sửa phần hướng dẫn và các bước hiện có. Không chỉnh route, thứ tự kỹ thuật hoặc dữ liệu điều hướng trong bước này.',
      mainTitle: 'Nội dung hướng dẫn',
      mainNote: 'Tập trung vào câu hướng dẫn và các bước để người xem biết bắt đầu, di chuyển và khám phá nội dung.',
      role: 'Chỉ dẫn tham quan',
    },
  };
  return map[key] || map.hero;
}

function renderHomeEditModeHeader(sectionKey, section, copy = {}) {
  const meta = getHomeEditSectionUiMeta(sectionKey);
  const header = createElement('div', { className: `cms-admin-home-edit-mode-header is-${sectionKey || 'hero'}` });
  const text = createElement('div', { className: 'cms-admin-home-edit-mode-header-text' });
  text.appendChild(createElement('span', { className: 'cms-admin-home-edit-kicker', text: meta.badge }));
  text.appendChild(createElement('h3', { text: meta.title }));
  text.appendChild(createElement('p', { text: meta.lead }));
  const facts = createElement('div', { className: 'cms-admin-home-edit-mode-facts' });
  facts.appendChild(renderHomeSectionFactPill('Trạng thái', getVisibleLabel(section?.is_visible), section?.is_visible === false ? 'warning' : 'success'));
  facts.appendChild(renderHomeSectionFactPill('Cập nhật', formatDateTime(section?.updated_at)));
  facts.appendChild(renderHomeSectionFactPill('Vai trò', meta.role));
  appendChildren(header, [text, facts]);
  return header;
}

function renderHomeEditSectionGroup(title, description = '', className = '') {
  const group = createElement('section', { className: `cms-admin-home-form-section cms-admin-home-edit-section-group${className ? ` ${className}` : ''}` });
  const head = createElement('div', { className: 'cms-admin-home-edit-group-header' });
  head.appendChild(createElement('h4', { className: 'cms-admin-data-group-title', text: title }));
  if (description) head.appendChild(createElement('p', { className: 'cms-admin-compact-copy', text: description }));
  group.appendChild(head);
  return group;
}

function renderHomeEditDirtyNotice(editState = {}, copy = {}) {
  return createElement('p', {
    className: `cms-admin-dirty-notice${editState.dirty ? '' : ' cms-admin-hidden'}`,
    text: copy.dirty || 'Có thay đổi chưa lưu.',
    attrs: { role: 'status' },
  });
}

function appendHomeEditActions(form, editState = {}, copy = {}, handlers = {}) {
  const actionPanel = createElement('section', { className: 'cms-admin-home-form-action-panel' });
  actionPanel.appendChild(renderHomeEditDirtyNotice(editState, copy));
  actionPanel.appendChild(renderEditActionBlock(editState, copy, handlers));
  form.appendChild(actionPanel);
}

function appendHomeEditStateMessages(panel, copy = {}, editState = {}) {
  if (editState.saveError) {
    panel.appendChild(renderNoticeBox(`${copy.error || 'Không thể lưu, vui lòng kiểm tra lại thông tin.'} ${normalizeErrorMessage(editState.saveError)}`, 'error'));
  }
  if (editState.saveSuccess) {
    panel.appendChild(renderNoticeBox(editState.saveSuccess, 'success'));
  }
}

function renderHomeEditDetails(summaryText, bodyNode, className = '') {
  const details = createElement('details', { className: `cms-admin-home-edit-details${className ? ` ${className}` : ''}` });
  details.appendChild(createElement('summary', { text: summaryText }));
  if (bodyNode) details.appendChild(bodyNode);
  return details;
}

function renderHomeTechnicalDetails(rows = [], copy = {}, options = {}) {
  const grid = createElement('div', { className: 'cms-admin-readonly-field-grid cms-admin-home-technical-strip' });
  rows.forEach(([label, value, note]) => grid.appendChild(renderReadonlyField(label, value, note || copy.technicalReadonlyNote || 'Thông tin kỹ thuật chỉ xem, không chỉnh trong bước này.')));
  return renderHomeEditDetails(options.summary || copy.groups?.technical || 'Thông tin kỹ thuật để đối chiếu', grid, 'cms-admin-home-edit-technical-details');
}

function renderHomeItemReadonlyDetails(rows = [], copy = {}, summary = 'Thông tin kỹ thuật của mục') {
  if (!rows.length) return null;
  const grid = createElement('div', { className: 'cms-admin-readonly-field-grid cms-admin-home-item-technical-grid' });
  rows.forEach(([label, value]) => grid.appendChild(renderReadonlyField(label, value, copy.technicalReadonlyNote || copy.routeReadonlyNote || 'Thông tin kỹ thuật chỉ xem, không chỉnh trong bước này.')));
  return renderHomeEditDetails(summary, grid, 'cms-admin-home-item-technical-details');
}

function renderHomeHeroEditPanel(state, section, editState) {
  const copy = ADMIN_COPY.contentViews.home.edit;
  const meta = getHomeEditSectionUiMeta('hero');
  const panel = createElement('section', { className: 'cms-admin-home-hero-edit-panel cms-admin-home-contextual-edit-panel cms-admin-edit-panel-highlight', dataset: { cmsEditPanel: 'home-hero', cmsEditId: section.id || section.section_key || 'hero' } });
  panel.appendChild(renderHomeEditModeHeader('hero', section, copy));
  appendHomeEditStateMessages(panel, copy, editState);

  const form = createElement('form', { className: 'cms-admin-edit-form cms-admin-home-hero-edit-form cms-admin-home-contextual-edit-form', attrs: { novalidate: 'true' } });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleSaveHomeHeroDraft();
  });

  const mainGroup = renderHomeEditSectionGroup(meta.mainTitle, meta.mainNote, 'is-primary-fields');
  const mainFields = createElement('div', { className: 'cms-admin-edit-field-grid cms-admin-home-main-field-grid' });
  mainFields.appendChild(renderHomeHeroEditableTextField('eyebrow', copy.fields.eyebrow, editState, { placeholder: copy.placeholders.eyebrow }));
  mainFields.appendChild(renderHomeHeroEditableTextField('title', copy.fields.title, editState, { required: true, placeholder: copy.placeholders.title }));
  if (sectionHasFieldOrData(section, 'subtitle')) {
    mainFields.appendChild(renderHomeHeroEditableTextField('subtitle', copy.fields.subtitle, editState, { placeholder: copy.placeholders.subtitle }));
  }
  mainFields.appendChild(renderHomeHeroEditableTextField('lead', copy.fields.lead, editState, { multiline: true, rows: '3', placeholder: copy.placeholders.lead }));
  if (sectionHasFieldOrData(section, 'body')) {
    mainFields.appendChild(renderHomeHeroEditableTextField('body', copy.fields.body, editState, { multiline: true, rows: '3', placeholder: copy.placeholders.body }));
  }
  mainGroup.appendChild(mainFields);
  form.appendChild(mainGroup);

  appendHomeEditActions(form, editState, copy, {
    onCancel: handleCancelHomeHeroEdit,
    onReset: () => handleResetActiveDraft('home'),
  });

  form.appendChild(renderHomeHeroMediaEditGroup(section, editState, copy));
  const ctaGroup = renderHomeHeroCtaEditGroup(section, editState, copy);
  if (ctaGroup) form.appendChild(ctaGroup);
  form.appendChild(renderHomeHeroItemsEditGroup(section, editState, copy));
  form.appendChild(renderHomeHeroTechnicalReadonlyBlock(section, copy));

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
  const group = renderHomeEditSectionGroup(copy.groups.media, 'Chỉnh chú thích và chọn media đã upload cho các field media hiện có. Website public chưa thay đổi cho đến khi lưu bản nháp và công khai.', 'cms-admin-home-media-edit-group');

  const fields = createElement('div', { className: 'cms-admin-edit-field-grid cms-admin-home-compact-field-grid' });
  fields.appendChild(renderHomeHeroMediaTextField('caption', copy.fields.mediaCaption, editState, { placeholder: copy.placeholders.mediaCaption }));
  group.appendChild(fields);

  const media = normalizePlainObject(section?.media_json);
  const descriptors = getHomeHeroMediaFieldDescriptors(media, editState);
  if (descriptors.length) {
    const pickerGrid = createElement('div', { className: 'cms-admin-home-media-library-field-grid' });
    descriptors.forEach((descriptor) => pickerGrid.appendChild(renderHomeHeroMediaLibraryField(descriptor)));
    group.appendChild(pickerGrid);

    const activeDescriptor = descriptors.find((descriptor) => descriptor.fieldName === homeMediaPickerState.targetField) || descriptors[0];
    if (homeMediaPickerState.open && activeDescriptor) {
      group.appendChild(renderHomeMediaPicker(getState(), activeDescriptor));
    }
  } else {
    const readonlyRows = getMediaReadonlyRows(media, copy);
    if (readonlyRows.length) {
      const readonlyGrid = createElement('div', { className: 'cms-admin-readonly-field-grid cms-admin-home-media-readonly-grid' });
      readonlyRows.forEach(([label, value]) => readonlyGrid.appendChild(renderReadonlyField(label, value, copy.mediaReadonlyNote)));
      group.appendChild(readonlyGrid);
    } else {
      group.appendChild(createElement('p', { className: 'cms-admin-compact-copy', text: 'Chưa có field media rõ ràng trong dữ liệu gốc.' }));
    }
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
  const originalItems = normalizeJsonValue(section?.items_json);
  const count = Array.isArray(originalItems) ? originalItems.length : 0;
  const group = renderHomeEditSectionGroup(copy.groups.items, copy.itemsReadonlyNote, 'cms-admin-home-items-edit-group cms-admin-home-hero-items-edit-group');

  if (!Array.isArray(originalItems)) {
    group.appendChild(renderCompactNotice(copy.unsupportedItems));
    return renderHomeEditDetails('Nội dung con', group, 'cms-admin-home-edit-items-details');
  }
  if (!originalItems.length) {
    group.appendChild(renderCompactNotice(copy.emptyItems));
    return renderHomeEditDetails('Nội dung con', group, 'cms-admin-home-edit-items-details');
  }

  const list = createElement('div', { className: 'cms-admin-home-item-edit-list' });
  safeArray(editState.draftValues?.items).forEach((item, index) => {
    list.appendChild(renderHomeHeroItemEditCard(item, index, copy, editState));
  });
  group.appendChild(list);
  return renderHomeEditDetails(`${count} mục nội dung con`, group, 'cms-admin-home-edit-items-details');
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
  const rows = [
    [copy.fields.sectionKey, section.section_key, copy.technicalReadonlyNote],
    [copy.fields.sortOrder, section.sort_order, copy.technicalReadonlyNote],
    [copy.fields.visible, getVisibleLabel(section.is_visible), copy.technicalReadonlyNote],
    [copy.fields.updatedAt, formatDateTime(section.updated_at), copy.technicalReadonlyNote],
  ];
  return renderHomeTechnicalDetails(rows, copy, { summary: 'Thông tin kỹ thuật để đối chiếu' });
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

const HOME_MEDIA_PATH_FIELD_KEYS = ['videoUrl', 'video_url', 'video', 'mp4', 'src', 'url', 'imageUrl', 'image_url', 'image', 'poster', 'posterUrl', 'poster_url', 'thumbnail', 'path'];

function getHomeHeroMediaFieldDescriptors(media = {}, editState = {}) {
  const draftMedia = editState.draftValues?.media || {};
  return HOME_MEDIA_PATH_FIELD_KEYS
    .filter((fieldName) => Object.prototype.hasOwnProperty.call(media || {}, fieldName) || Object.prototype.hasOwnProperty.call(draftMedia || {}, fieldName))
    .map((fieldName) => {
      const currentValue = !isBlank(draftMedia?.[fieldName]) || Object.prototype.hasOwnProperty.call(draftMedia || {}, fieldName)
        ? draftMedia[fieldName]
        : media[fieldName];
      const allowedKind = getHomeMediaAllowedKind(fieldName, currentValue);
      return {
        fieldName,
        currentValue: String(currentValue || '').trim(),
        label: getHomeMediaFieldLabel(fieldName),
        allowedKind,
        allowedLabel: allowedKind === 'video' ? 'Video' : 'Ảnh / Poster',
        actionLabel: getHomeMediaPickerOpenLabel(allowedKind),
        chooseLabel: getHomeMediaPickerChooseLabel(allowedKind),
      };
    });
}

function renderHomeHeroMediaLibraryField(descriptor = {}) {
  const card = createElement('section', { className: 'cms-admin-home-media-library-field' });
  const header = createElement('div', { className: 'cms-admin-home-media-library-field-header' });
  const title = createElement('div');
  title.appendChild(createElement('span', { className: 'cms-admin-edit-label', text: descriptor.label }));
  title.appendChild(createElement('p', {
    className: 'cms-admin-readonly-note',
    text: 'Field media hiện có trong media_json. Chọn từ thư viện chỉ cập nhật bản nháp local, chưa tự lưu hoặc công khai.',
  }));
  const button = createElement('button', {
    className: 'cms-admin-button cms-admin-button-secondary cms-admin-button-small',
    type: 'button',
    text: homeMediaPickerState.open && homeMediaPickerState.targetField === descriptor.fieldName ? 'Đóng thư viện media' : descriptor.actionLabel,
    attrs: { 'aria-expanded': homeMediaPickerState.open && homeMediaPickerState.targetField === descriptor.fieldName ? 'true' : 'false' },
  });
  button.addEventListener('click', () => handleToggleHomeMediaPicker(descriptor));
  appendChildren(header, [title, button]);
  card.appendChild(header);

  const value = createElement('div', { className: 'cms-admin-home-media-library-current' });
  value.appendChild(renderHomeMediaCurrentPreview(descriptor));
  const valueText = createElement('div', { className: 'cms-admin-site-logo-current-value' });
  valueText.appendChild(createElement('span', { className: 'cms-admin-readonly-value cms-admin-mono', text: toDisplayText(descriptor.currentValue) }));
  valueText.appendChild(createElement('span', { className: 'cms-admin-readonly-note', text: `Loại hợp lệ: ${descriptor.allowedLabel}.` }));
  value.appendChild(valueText);
  card.appendChild(value);
  return card;
}

function renderHomeMediaCurrentPreview(descriptor = {}) {
  const frame = createElement('div', { className: 'cms-admin-home-media-current-preview' });
  const safeUrl = normalizeSafeSiteLogoMediaUrl(descriptor.currentValue);
  if (!safeUrl) {
    frame.classList.add('has-error');
    frame.appendChild(createElement('span', { text: 'Chưa có media hợp lệ' }));
    return frame;
  }
  if (descriptor.allowedKind === 'video') {
    const video = createElement('video', { attrs: { src: safeUrl, controls: 'true', preload: 'metadata' } });
    video.addEventListener('error', () => {
      video.hidden = true;
      frame.classList.add('has-error');
      frame.appendChild(createElement('span', { text: 'Không tải được video' }));
    }, { once: true });
    frame.appendChild(video);
    return frame;
  }
  const image = createElement('img', { attrs: { src: safeUrl, alt: descriptor.label || 'Media Trang chủ', loading: 'lazy' } });
  image.addEventListener('error', () => {
    image.hidden = true;
    frame.classList.add('has-error');
    frame.appendChild(createElement('span', { text: 'Không tải được ảnh' }));
  }, { once: true });
  frame.appendChild(image);
  return frame;
}

function renderHomeMediaPicker(state = {}, descriptor = {}) {
  const sourceAssets = safeArray(state.data?.cmsMediaUploads)
    .map(normalizeHomePickerMediaAsset)
    .filter(isSelectableCmsMediaPickerAsset);
  const mediaError = state.data?.errors?.cmsMediaUploads || null;
  const filteredAssets = sourceAssets.filter((asset) => matchesHomeMediaPickerFilters(asset, descriptor));
  const panel = createElement('section', { className: 'cms-admin-static-media-picker-panel cms-admin-home-media-picker-panel' });
  const header = createElement('div', { className: 'cms-admin-static-media-picker-header' });
  const heading = createElement('div');
  heading.appendChild(createElement('h5', { text: getHomeMediaPickerTitle(descriptor.allowedKind) }));
  heading.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: 'Chọn media đã upload để gắn vào bản nháp Trang chủ. Website public chưa thay đổi cho đến khi bạn lưu và công khai.',
  }));
  const closeButton = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-small', type: 'button', text: 'Đóng' });
  closeButton.addEventListener('click', () => closeHomeMediaPicker());
  appendChildren(header, [heading, closeButton]);
  panel.appendChild(header);

  panel.appendChild(renderHomeMediaPickerContext(descriptor));

  if (mediaError) {
    panel.appendChild(renderErrorBox(mediaError, 'Không đọc được cms_media_uploads'));
    return panel;
  }

  if (!sourceAssets.length) {
    panel.appendChild(renderEmptyState('Chưa có media trong thư viện upload.'));
    return panel;
  }

  panel.appendChild(renderHomeMediaPickerControls(descriptor));

  if (homeMediaPickerState.error) {
    panel.appendChild(createElement('div', { className: 'cms-admin-alert cms-admin-alert-error', text: homeMediaPickerState.error }));
  }

  if (!filteredAssets.length) {
    panel.appendChild(createElement('div', { className: 'cms-admin-media-filter-empty', text: 'Không có media nào khớp bộ lọc hiện tại.' }));
    return panel;
  }

  const list = createElement('div', { className: 'cms-admin-static-media-picker-grid cms-admin-home-media-picker-grid' });
  filteredAssets.forEach((asset) => list.appendChild(renderHomeMediaPickerCard(asset, descriptor)));
  panel.appendChild(list);
  return panel;
}

function renderHomeMediaPickerContext(descriptor = {}) {
  const meta = createElement('div', { className: 'cms-admin-static-media-picker-context cms-admin-home-media-picker-context' });
  meta.appendChild(renderInfoTile('Trang chủ', 'Khu vực đầu trang'));
  meta.appendChild(renderInfoTile('Field đích', `media_json.${descriptor.fieldName}`, true));
  meta.appendChild(renderInfoTile('Loại hợp lệ', descriptor.allowedLabel));
  meta.appendChild(renderInfoTile('Trạng thái', 'Bản nháp local'));
  return meta;
}

function renderHomeMediaPickerControls(descriptor = {}) {
  const controls = createElement('div', { className: 'cms-admin-static-media-picker-controls cms-admin-home-media-picker-controls' });
  const search = createElement('input', {
    className: 'cms-admin-input cms-admin-static-media-picker-search',
    value: homeMediaPickerState.search,
    placeholder: 'Tìm theo tên file, path, phòng, item, section...',
    attrs: { type: 'search', autocomplete: 'off', 'aria-label': 'Tìm media Trang chủ trong thư viện upload' },
  });
  search.addEventListener('input', () => {
    homeMediaPickerState.search = search.value;
    renderAdminShell();
  });

  const filter = createElement('select', {
    className: 'cms-admin-select cms-admin-static-media-picker-filter',
    attrs: { 'aria-label': 'Lọc loại media cho Trang chủ' },
  });
  getHomeMediaFilterOptions(descriptor.allowedKind).forEach((option) => filter.appendChild(createElement('option', { value: option.value, text: option.label })));
  const allowedValues = getHomeMediaFilterOptions(descriptor.allowedKind).map((option) => option.value);
  filter.value = allowedValues.includes(homeMediaPickerState.mediaKindFilter) ? homeMediaPickerState.mediaKindFilter : 'compatible';
  filter.addEventListener('change', () => {
    homeMediaPickerState.mediaKindFilter = filter.value;
    renderAdminShell();
  });
  appendChildren(controls, [search, filter]);
  return controls;
}

function renderHomeMediaPickerCard(asset = {}, descriptor = {}) {
  const compatibility = getHomeMediaPickerCompatibility(asset, descriptor);
  const card = createElement('article', {
    className: [
      'cms-admin-static-media-picker-card',
      'cms-admin-home-media-picker-card',
      asset.hasSafeUrl && compatibility.allowed ? 'is-selectable' : 'is-disabled',
    ].filter(Boolean).join(' '),
  });

  card.appendChild(renderHomeMediaPickerPreview(asset));

  const body = createElement('div', { className: 'cms-admin-static-media-picker-card-body' });
  const titleRow = createElement('div', { className: 'cms-admin-media-card-title-row' });
  titleRow.appendChild(createElement('h6', { text: asset.fileName || 'media' }));
  titleRow.appendChild(renderBadge(getSiteLogoMediaKindLabel(asset.mediaKind), asset.mediaKind === 'video' ? 'warning' : asset.mediaKind === 'unknown' ? 'default' : 'success'));
  body.appendChild(titleRow);

  const details = createElement('dl', { className: 'cms-admin-media-detail-list' });
  [
    ['Phòng/item/section', getSiteLogoPickerTargetText(asset)],
    ['Field upload', asset.fieldName || 'Không có'],
    ['Dung lượng', formatSiteLogoFileBytes(asset.sizeBytes)],
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

  const actions = createElement('div', { className: 'cms-admin-actions cms-admin-static-media-picker-actions cms-admin-home-media-picker-actions' });
  const choose = createElement('button', {
    className: 'cms-admin-button cms-admin-button-primary cms-admin-button-small',
    type: 'button',
    text: descriptor.chooseLabel,
  });
  choose.disabled = !asset.hasSafeUrl || !compatibility.allowed;
  choose.addEventListener('click', () => handleAttachHomeMediaPickerMedia(asset, descriptor));
  const cancel = createElement('button', { className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-small', type: 'button', text: 'Hủy chọn' });
  cancel.addEventListener('click', () => closeHomeMediaPicker());
  appendChildren(actions, [choose, cancel]);
  body.appendChild(actions);

  card.appendChild(body);
  return card;
}

function renderHomeMediaPickerPreview(asset = {}) {
  const media = createElement('div', { className: 'cms-admin-static-media-picker-preview' });
  if (!asset.hasSafeUrl) {
    media.classList.add('has-error');
    media.appendChild(createElement('span', { text: 'Không có preview an toàn' }));
    return media;
  }
  if (asset.mediaKind === 'video') {
    const video = createElement('video', { attrs: { src: asset.safeUrl, controls: 'true', preload: 'metadata' } });
    video.addEventListener('error', () => {
      video.hidden = true;
      media.classList.add('has-error');
      media.appendChild(createElement('span', { text: 'Không tải được video' }));
    }, { once: true });
    media.appendChild(video);
    return media;
  }
  if (asset.mediaKind === 'image' || asset.mediaKind === 'poster') {
    const image = createElement('img', { attrs: { src: asset.safeUrl, alt: asset.fileName || 'Media Trang chủ', loading: 'lazy' } });
    image.addEventListener('error', () => {
      image.hidden = true;
      media.classList.add('has-error');
      media.appendChild(createElement('span', { text: 'Không tải được ảnh' }));
    }, { once: true });
    media.appendChild(image);
    return media;
  }
  media.classList.add('has-error');
  media.appendChild(createElement('span', { text: 'Không preview trong picker Trang chủ' }));
  return media;
}

function handleToggleHomeMediaPicker(descriptor = {}) {
  if (homeMediaPickerState.open && homeMediaPickerState.targetField === descriptor.fieldName) {
    closeHomeMediaPicker();
    return;
  }
  homeMediaPickerState.open = true;
  homeMediaPickerState.search = '';
  homeMediaPickerState.mediaKindFilter = 'compatible';
  homeMediaPickerState.targetField = descriptor.fieldName || '';
  homeMediaPickerState.error = '';
  renderAdminShell();
}

function closeHomeMediaPicker() {
  homeMediaPickerState.open = false;
  homeMediaPickerState.error = '';
  homeMediaPickerState.targetField = '';
  renderAdminShell();
}

function handleAttachHomeMediaPickerMedia(asset = {}, descriptor = {}) {
  const state = getState();
  if (!state.homeEdit?.isEditing || state.homeEdit?.editingSectionKey !== 'hero') {
    homeMediaPickerState.error = 'Form Trang chủ không còn ở chế độ chỉnh sửa. Hãy mở lại picker.';
    renderAdminShell();
    return;
  }

  if (!isSelectableCmsMediaPickerAsset(asset)) {
    homeMediaPickerState.error = 'Media này đã xóa, bị hỏng hoặc không có URL an toàn nên không thể chọn.';
    renderAdminShell();
    return;
  }

  const safeUrl = normalizeSafeSiteLogoMediaUrl(asset.rawUrl);
  if (!safeUrl) {
    homeMediaPickerState.error = 'Đường dẫn media không thuộc nguồn được phép. Không thể chọn media này.';
    renderAdminShell();
    return;
  }

  const compatibility = getHomeMediaPickerCompatibility(asset, descriptor);
  if (!compatibility.allowed) {
    homeMediaPickerState.error = compatibility.reason;
    renderAdminShell();
    return;
  }

  updateHomeHeroMediaDraftField(descriptor.fieldName, safeUrl);
  homeMediaPickerState.open = false;
  homeMediaPickerState.error = '';
  homeMediaPickerState.targetField = '';
  setHomeEditState({
    saveSuccess: 'Đã gắn media vào bản nháp Trang chủ. Website public chưa thay đổi cho đến khi bạn lưu và công khai.',
    saveError: null,
  });
  renderAdminShell();
}

function matchesHomeMediaPickerFilters(asset = {}, descriptor = {}) {
  const kind = String(homeMediaPickerState.mediaKindFilter || 'compatible');
  if (kind === 'compatible' && !getHomeMediaPickerCompatibility(asset, descriptor).allowed) return false;
  if (kind !== 'compatible' && kind !== 'all' && asset.mediaKind !== kind) return false;
  const search = String(homeMediaPickerState.search || '').trim().toLowerCase();
  if (!search) return true;
  return asset.searchText.includes(search);
}

function getHomeMediaPickerCompatibility(asset = {}, descriptor = {}) {
  if (!isSelectableCmsMediaPickerAsset(asset)) return { allowed: false, reason: 'Media này đã xóa, bị hỏng hoặc không có URL an toàn nên không thể chọn.' };
  if (!asset.hasSafeUrl) return { allowed: false, reason: 'Đường dẫn media không thuộc nguồn được phép. Không thể chọn media này.' };
  if (descriptor.allowedKind === 'video') {
    if (asset.mediaKind !== 'video') return { allowed: false, reason: 'Media này không phù hợp với field Trang chủ đang chọn.' };
    return { allowed: true, reason: '' };
  }
  if (!['image', 'poster'].includes(asset.mediaKind)) {
    return { allowed: false, reason: 'Media này không phù hợp với field Trang chủ đang chọn.' };
  }
  return { allowed: true, reason: '' };
}

function normalizeHomePickerMediaAsset(asset = {}) {
  return normalizeSiteLogoPickerMediaAsset(asset);
}

function getHomeMediaAllowedKind(fieldName = '', currentValue = '') {
  const field = String(fieldName || '').toLowerCase();
  const currentKind = normalizeSiteLogoMediaKind('', fieldName, '', currentValue);
  if (field.includes('video') || field.includes('mp4') || currentKind === 'video') return 'video';
  return 'image';
}

function getHomeMediaFieldLabel(fieldName = '') {
  const key = String(fieldName || '').trim();
  if (!key) return 'Media Trang chủ';
  if (getHomeMediaAllowedKind(key) === 'video') return `Video Trang chủ / ${key}`;
  if (key.toLowerCase().includes('poster')) return `Poster Trang chủ / ${key}`;
  return `Ảnh/poster Trang chủ / ${key}`;
}

function getHomeMediaPickerTitle(allowedKind = '') {
  if (allowedKind === 'video') return 'Chọn video từ thư viện';
  if (allowedKind === 'poster') return 'Chọn poster từ thư viện';
  return 'Chọn ảnh từ thư viện';
}

function getHomeMediaPickerOpenLabel(allowedKind = '') {
  if (allowedKind === 'video') return 'Chọn video từ thư viện';
  if (allowedKind === 'poster') return 'Chọn poster từ thư viện';
  return 'Chọn ảnh từ thư viện';
}

function getHomeMediaPickerChooseLabel(allowedKind = '') {
  if (allowedKind === 'video') return 'Chọn video này';
  if (allowedKind === 'poster') return 'Chọn poster này';
  return 'Chọn ảnh này';
}

function getHomeMediaFilterOptions(allowedKind = '') {
  if (allowedKind === 'video') {
    return [
      { value: 'compatible', label: 'Video phù hợp' },
      { value: 'video', label: 'Video' },
      { value: 'image', label: 'Ảnh (không phù hợp)' },
      { value: 'poster', label: 'Poster (không phù hợp)' },
      { value: 'all', label: 'Tất cả loại media' },
    ];
  }
  return [
    { value: 'compatible', label: 'Ảnh & poster phù hợp' },
    { value: 'image', label: 'Ảnh' },
    { value: 'poster', label: 'Poster' },
    { value: 'video', label: 'Video (không phù hợp)' },
    { value: 'all', label: 'Tất cả loại media' },
  ];
}


function renderHomeGuideEditActions(state, section) {
  const copy = ADMIN_COPY.contentViews.home.guideEdit || {};
  const actions = createElement('div', { className: 'cms-admin-settings-edit-actions cms-admin-home-edit-actions' });
  if (canEditHomeGuide(state, section)) {
    const editButton = createElement('button', {
      className: 'cms-admin-button cms-admin-button-primary',
      text: copy.button || 'Chỉnh sửa phần này',
      title: copy.buttonTitle || 'Chỉnh sửa chữ hiển thị của Hướng dẫn tham quan',
      type: 'button',
      ariaLabel: copy.buttonAria || 'Chỉnh sửa chữ hiển thị của Hướng dẫn tham quan',
    });
    editButton.addEventListener('click', () => {
      const editId = section.id || section.section_key || 'guide';
      const guard = requestStartEditSession({ type: 'home', id: editId });
      if (!guard.allowed) return;
      if (!guard.same) startHomeGuideEdit(section);
      setWorkspaceTabState('home', 'guide');
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
  const meta = getHomeEditSectionUiMeta('guide');
  const panel = createElement('section', { className: 'cms-admin-home-hero-edit-panel cms-admin-home-guide-edit-panel cms-admin-home-contextual-edit-panel cms-admin-edit-panel-highlight', dataset: { cmsEditPanel: 'home-guide', cmsEditId: section.id || section.section_key || 'guide' } });
  panel.appendChild(renderHomeEditModeHeader('guide', section, copy));
  appendHomeEditStateMessages(panel, copy, editState);

  const form = createElement('form', { className: 'cms-admin-edit-form cms-admin-home-guide-edit-form cms-admin-home-contextual-edit-form', attrs: { novalidate: 'true' } });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleSaveHomeGuideDraft();
  });

  const mainGroup = renderHomeEditSectionGroup(meta.mainTitle, meta.mainNote, 'is-primary-fields');
  const mainFields = createElement('div', { className: 'cms-admin-edit-field-grid cms-admin-home-main-field-grid' });
  mainFields.appendChild(renderHomeGuideEditableTextField('eyebrow', copy.fields?.eyebrow || 'Nhãn nhỏ', editState, { placeholder: copy.placeholders?.eyebrow || '' }));
  mainFields.appendChild(renderHomeGuideEditableTextField('title', copy.fields?.title || 'Tiêu đề', editState, { required: true, placeholder: copy.placeholders?.title || '' }));
  if (sectionHasFieldOrData(section, 'subtitle')) {
    mainFields.appendChild(renderHomeGuideEditableTextField('subtitle', copy.fields?.subtitle || 'Tiêu đề phụ', editState, { placeholder: copy.placeholders?.subtitle || '' }));
  }
  mainFields.appendChild(renderHomeGuideEditableTextField('lead', copy.fields?.lead || 'Mô tả ngắn', editState, { multiline: true, rows: '3', placeholder: copy.placeholders?.lead || '' }));
  if (sectionHasFieldOrData(section, 'body')) {
    mainFields.appendChild(renderHomeGuideEditableTextField('body', copy.fields?.body || 'Nội dung mô tả', editState, { multiline: true, rows: '3', placeholder: copy.placeholders?.body || '' }));
  }
  mainGroup.appendChild(mainFields);
  form.appendChild(mainGroup);

  appendHomeEditActions(form, editState, copy, {
    onCancel: handleCancelHomeGuideEdit,
    onReset: () => handleResetActiveDraft('home'),
  });

  form.appendChild(renderHomeGuideItemsEditGroup(section, editState, copy));
  form.appendChild(renderHomeGuideTechnicalReadonlyBlock(section, copy));

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
      attrs: { name: fieldName, rows: options.rows || '3', 'aria-label': options.ariaLabel || `${label} trong Hướng dẫn tham quan` },
    })
    : createElement('input', {
      className: 'cms-admin-edit-input',
      type: 'text',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fieldName, autocomplete: 'off', 'aria-label': options.ariaLabel || `${label} trong Hướng dẫn tham quan` },
    });
  input.addEventListener('input', () => updateHomeGuideDraftField(fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fieldName, editState)]);
  return field;
}

function renderHomeGuideItemsEditGroup(section, editState, copy) {
  const group = renderHomeEditSectionGroup(copy.groups?.items || 'Các bước hướng dẫn', 'Chỉ sửa tên và mô tả của các bước đang có. Thứ tự, route/link và metadata vẫn chỉ xem.', 'cms-admin-home-items-edit-group cms-admin-home-guide-items-edit-group');

  const originalItems = normalizeJsonValue(section?.items_json);
  if (!Array.isArray(originalItems)) {
    group.appendChild(renderCompactNotice(copy.unsupportedItems || 'Cấu trúc bước hướng dẫn chưa hỗ trợ chỉnh sửa ở bước này.'));
    return group;
  }
  if (!originalItems.length) {
    group.appendChild(renderCompactNotice(copy.emptyItems || 'Danh sách bước hướng dẫn đang trống.'));
    return group;
  }

  const list = createElement('div', { className: 'cms-admin-home-item-edit-list cms-admin-home-guide-step-list' });
  safeArray(editState.draftValues?.items).forEach((item, index) => {
    list.appendChild(renderHomeGuideItemEditCard(item, originalItems[index], index, copy, editState));
  });
  group.appendChild(list);
  return group;
}

function renderHomeGuideItemEditCard(item, originalItem, index, copy, editState) {
  const card = createElement('section', { className: 'cms-admin-data-card cms-admin-home-item-edit-card cms-admin-home-guide-item-edit-card' });
  card.appendChild(renderDataCardTitle(`${copy.fields?.step || 'Bước'} ${index + 1}`));
  const fields = createElement('div', { className: 'cms-admin-edit-field-grid cms-admin-home-guide-step-field-grid' });
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
  const details = renderHomeItemReadonlyDetails(readonlyRows, copy, 'Thông tin kỹ thuật của bước');
  if (details) card.appendChild(details);
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
      attrs: { name: fullFieldName, rows: '3', 'aria-label': options.ariaLabel || `${label} của bước hướng dẫn ${index + 1}` },
    })
    : createElement('input', {
      className: 'cms-admin-edit-input',
      type: 'text',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fullFieldName, autocomplete: 'off', 'aria-label': options.ariaLabel || `${label} của bước hướng dẫn ${index + 1}` },
    });
  input.addEventListener('input', () => updateHomeGuideItemDraftField(index, fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fullFieldName, editState)]);
  return field;
}

function renderHomeGuideTechnicalReadonlyBlock(section, copy) {
  const originalItems = normalizeJsonValue(section?.items_json);
  const rows = [
    [copy.fields?.sectionKey || 'Mã section', section?.section_key, copy.technicalReadonlyNote],
    [copy.fields?.sortOrder || 'Thứ tự hiển thị', section?.sort_order, copy.technicalReadonlyNote],
    [copy.fields?.visible || 'Trạng thái hiển thị', getVisibleLabel(section?.is_visible), copy.technicalReadonlyNote],
    [copy.fields?.updatedAt || 'Cập nhật gần nhất', formatDateTime(section?.updated_at), copy.technicalReadonlyNote],
    [copy.fields?.itemCount || 'Số lượng bước', Array.isArray(originalItems) ? originalItems.length : 0, copy.itemsReadonlyNote],
  ];
  return renderHomeTechnicalDetails(rows, copy, { summary: copy.groups?.technical || 'Thông tin kỹ thuật để đối chiếu' });
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
      title: copy?.buttonTitle || 'Chỉnh sửa chữ hiển thị của Khu vực trải nghiệm',
      type: 'button',
      ariaLabel: copy?.buttonAria || 'Chỉnh sửa chữ hiển thị của Khu vực trải nghiệm',
    });
    editButton.addEventListener('click', () => {
      const editId = section.id || section.section_key || 'experience';
      const guard = requestStartEditSession({ type: 'home', id: editId });
      if (!guard.allowed) return;
      if (!guard.same) startHomeExperienceEdit(section);
      setWorkspaceTabState('home', 'experience');
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
  const meta = getHomeEditSectionUiMeta('experience');
  const panel = createElement('section', { className: 'cms-admin-home-hero-edit-panel cms-admin-home-experience-edit-panel cms-admin-home-contextual-edit-panel cms-admin-edit-panel-highlight', dataset: { cmsEditPanel: 'home-experience', cmsEditId: section.id || section.section_key || 'experience' } });
  panel.appendChild(renderHomeEditModeHeader('experience', section, copy));
  appendHomeEditStateMessages(panel, copy, editState);

  const form = createElement('form', { className: 'cms-admin-edit-form cms-admin-home-hero-edit-form cms-admin-home-experience-edit-form cms-admin-home-contextual-edit-form', attrs: { novalidate: 'true' } });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleSaveHomeExperienceDraft();
  });

  const mainGroup = renderHomeEditSectionGroup(meta.mainTitle, meta.mainNote, 'is-primary-fields');
  const mainFields = createElement('div', { className: 'cms-admin-edit-field-grid cms-admin-home-main-field-grid' });
  mainFields.appendChild(renderHomeExperienceEditableTextField('eyebrow', copy?.fields?.eyebrow || 'Nhãn nhỏ', editState, { placeholder: copy?.placeholders?.eyebrow || '' }));
  mainFields.appendChild(renderHomeExperienceEditableTextField('title', copy?.fields?.title || 'Tiêu đề', editState, { required: true, placeholder: copy?.placeholders?.title || '' }));
  if (sectionHasFieldOrData(section, 'subtitle')) {
    mainFields.appendChild(renderHomeExperienceEditableTextField('subtitle', copy?.fields?.subtitle || 'Tiêu đề phụ', editState, { placeholder: copy?.placeholders?.subtitle || '' }));
  }
  mainFields.appendChild(renderHomeExperienceEditableTextField('lead', copy?.fields?.lead || 'Mô tả ngắn', editState, { multiline: true, rows: '3', placeholder: copy?.placeholders?.lead || '' }));
  if (sectionHasFieldOrData(section, 'body')) {
    mainFields.appendChild(renderHomeExperienceEditableTextField('body', copy?.fields?.body || 'Nội dung mô tả', editState, { multiline: true, rows: '3', placeholder: copy?.placeholders?.body || '' }));
  }
  mainGroup.appendChild(mainFields);
  form.appendChild(mainGroup);

  appendHomeEditActions(form, editState, copy, {
    onCancel: handleCancelHomeExperienceEdit,
    onReset: () => handleResetActiveDraft('home'),
  });

  form.appendChild(renderHomeExperienceItemsEditGroup(section, editState, copy || {}));
  form.appendChild(renderHomeExperienceTechnicalReadonlyBlock(section, copy || {}));

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
      attrs: { name: fieldName, rows: options.rows || '3', 'aria-label': options.ariaLabel || `${label} trong Khu vực trải nghiệm` },
    })
    : createElement('input', {
      className: 'cms-admin-edit-input',
      type: 'text',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fieldName, autocomplete: 'off', 'aria-label': options.ariaLabel || `${label} trong Khu vực trải nghiệm` },
    });
  input.addEventListener('input', () => updateHomeExperienceDraftField(fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fieldName, editState)]);
  return field;
}

function renderHomeExperienceItemsEditGroup(section, editState, copy) {
  const originalItems = normalizeJsonValue(section?.items_json);
  const count = Array.isArray(originalItems) ? originalItems.length : 0;
  const group = renderHomeEditSectionGroup(copy.groups?.items || 'Card trải nghiệm hiện có', 'Chỉ sửa chữ hiển thị của card. Mã phòng, nhãn nút, route và thứ tự vẫn chỉ xem.', 'cms-admin-home-items-edit-group cms-admin-home-experience-items-edit-group');

  if (!Array.isArray(originalItems)) {
    group.appendChild(renderCompactNotice(copy.unsupportedItems || 'Cấu trúc card trải nghiệm chưa hỗ trợ chỉnh sửa ở bước này.'));
    return renderHomeEditDetails('Nội dung con', group, 'cms-admin-home-edit-items-details');
  }
  if (!originalItems.length) {
    group.appendChild(renderCompactNotice(copy.emptyItems || 'Danh sách card trải nghiệm đang trống.'));
    return renderHomeEditDetails('Nội dung con', group, 'cms-admin-home-edit-items-details');
  }

  const list = createElement('div', { className: 'cms-admin-home-item-edit-list' });
  safeArray(editState.draftValues?.items).forEach((item, index) => {
    list.appendChild(renderHomeExperienceItemEditCard(item, originalItems[index], index, copy, editState));
  });
  group.appendChild(list);
  return renderHomeEditDetails(`${count} card trải nghiệm`, group, 'cms-admin-home-edit-items-details');
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
  const details = renderHomeItemReadonlyDetails(readonlyRows, copy, 'Thông tin kỹ thuật của card');
  if (details) card.appendChild(details);
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
      attrs: { name: fullFieldName, rows: '3', 'aria-label': options.ariaLabel || `${label} của card trải nghiệm ${index + 1}` },
    })
    : createElement('input', {
      className: 'cms-admin-edit-input',
      type: 'text',
      value,
      placeholder: options.placeholder || '',
      attrs: { name: fullFieldName, autocomplete: 'off', 'aria-label': options.ariaLabel || `${label} của card trải nghiệm ${index + 1}` },
    });
  input.addEventListener('input', () => updateHomeExperienceItemDraftField(index, fieldName, input.value));
  appendChildren(field, [input, renderFieldMessage(fullFieldName, editState)]);
  return field;
}

function renderHomeExperienceTechnicalReadonlyBlock(section, copy) {
  const originalItems = normalizeJsonValue(section?.items_json);
  const rows = [
    [copy.fields?.sectionKey || 'Mã section', section?.section_key, copy.technicalReadonlyNote],
    [copy.fields?.sortOrder || 'Thứ tự hiển thị', section?.sort_order, copy.technicalReadonlyNote],
    [copy.fields?.visible || 'Trạng thái hiển thị', getVisibleLabel(section?.is_visible), copy.technicalReadonlyNote],
    [copy.fields?.updatedAt || 'Cập nhật gần nhất', formatDateTime(section?.updated_at), copy.technicalReadonlyNote],
    [copy.fields?.itemCount || 'Số lượng card', Array.isArray(originalItems) ? originalItems.length : 0, copy.itemsReadonlyNote],
  ];
  return renderHomeTechnicalDetails(rows, copy, { summary: copy.groups?.technical || 'Thông tin kỹ thuật để đối chiếu' });
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
  const dbReferenceVersion = published?.version
    ? `${published.version} · ${getStatusLabel(published.status)}`
    : 'Chưa đọc được bản ghi DB tham chiếu';
  const panel = createElement('section', { className: 'cms-admin-panel cms-admin-dashboard-status-panel' });
  panel.appendChild(renderPanelTitle(copy.title, hasErrors || usingFallback ? 'Cần kiểm tra' : 'Ổn định'));
  panel.appendChild(renderKeyValueList([
    [copy.currentVersion, dashboardSummary?.version || '—'],
    [copy.dbReferenceVersion, dbReferenceVersion],
    [copy.publishedAt, formatDateTime(published?.published_at)],
    [copy.cmsRecordStatus, getStatusLabel(siteSettings?.site_status)],
    [copy.dataSource, sourceDetail],
    [copy.readOnlyMode, copy.readOnly],
    [copy.website, hasErrors ? 'Cần kiểm tra kết nối dữ liệu' : copy.active],
  ]));
  panel.appendChild(renderCompactNotice(copy.sourceNote));
  if (published) {
    panel.appendChild(renderCompactWarning(copy.dbReferenceNote));
  }
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
    panel.appendChild(renderCompactNotice(ADMIN_COPY.publish.dbReferenceHint));
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
  panel.appendChild(renderCompactWarning(ADMIN_COPY.publish.dbReferenceHint));
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

function renderOperatorStepPanel(config = {}, options = {}) {
  const steps = safeArray(config.steps);
  if (!config.title && !steps.length) return createElement('div');
  const panel = createElement('section', {
    className: ['cms-admin-panel', 'cms-admin-view-panel', 'cms-admin-operator-step-panel', options.className || ''].filter(Boolean).join(' '),
  });
  const titleRow = createElement('div', { className: 'cms-admin-panel-title-row' });
  titleRow.appendChild(createElement('h3', { className: 'cms-admin-panel-title', text: config.title || 'Các bước thực hiện' }));
  if (options.status || config.status) titleRow.appendChild(renderBadge(options.status || config.status, options.variant || 'default'));
  panel.appendChild(titleRow);
  if (config.subtitle) panel.appendChild(createElement('p', { className: 'cms-admin-help-text', text: config.subtitle }));
  const list = createElement('ol', { className: 'cms-admin-operator-step-list' });
  steps.forEach((step, index) => {
    const item = createElement('li');
    item.appendChild(createElement('span', { className: 'cms-admin-operator-step-number', text: String(index + 1) }));
    const text = typeof step === 'string' ? step : step?.label;
    const note = typeof step === 'string' ? '' : step?.note;
    const body = createElement('span', { className: 'cms-admin-operator-step-body' });
    body.appendChild(createElement('strong', { text: text || `Bước ${index + 1}` }));
    if (note) body.appendChild(createElement('small', { text: note }));
    item.appendChild(body);
    list.appendChild(item);
  });
  panel.appendChild(list);
  if (config.note) panel.appendChild(createElement('p', { className: 'cms-admin-operator-step-note', text: config.note }));
  return panel;
}

function renderWorkflowSteps(steps) {
  const list = createElement('ol', { className: 'cms-admin-workflow-list' });
  steps.forEach((step) => {
    list.appendChild(createElement('li', { text: step }));
  });
  return list;
}

function renderDisabledActionRow(labels, reason = '') {
  const row = createElement('div', { className: 'cms-admin-disabled-actions' });
  labels.forEach((label) => {
    row.appendChild(createElement('button', {
      className: 'cms-admin-button cms-admin-button-ghost cms-admin-button-disabled-action',
      text: label,
      type: 'button',
      attrs: {
        disabled: 'true',
        'aria-disabled': 'true',
        title: reason || 'Thao tác đang khóa ở màn này.',
        'aria-label': reason ? `${label}. ${reason}` : label,
      },
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
