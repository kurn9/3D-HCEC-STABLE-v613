import { ADMIN_UI } from './adminConfig.js';

const initialState = {
  supabase: null,
  session: null,
  profile: null,
  activeTab: ADMIN_UI.defaultTab,
  loading: false,
  error: null,
  siteSettingsEdit: createEmptySiteSettingsEditState(),
  gateEdit: createEmptyGateEditState(),
  homeEdit: createEmptyHomeEditState(),
  staticCmsDraft: createEmptyStaticCmsDraftState(),
  publishHistory: createEmptyPublishHistoryState(),
  releaseOperationGate: createEmptyReleaseOperationGateState(),
  scopedPublish: createEmptyScopedPublishState(),
  pointerRepair: createEmptyPointerRepairState(),
  storageCleanup: createEmptyStorageCleanupState(),
  data: {
    siteSettings: null,
    indexSections: [],
    gateContent: null,
    rooms: [],
    artworks: [],
    artworkStats: { total: 0, indoor: 0, outdoor: 0, warning: 0 },
    publishedBundles: [],
    mediaAssets: [],
    cmsMediaUploads: [],
    canonicalCms: null,
    canonicalSummary: null,
    canonicalError: null,
    errors: {},
  },
};

let state = structuredCloneSafe(initialState);
const listeners = new Set();

const HOME_HERO_MEDIA_PATH_KEYS = [
  'videoUrl',
  'video_url',
  'video',
  'mp4',
  'src',
  'url',
  'imageUrl',
  'image_url',
  'image',
  'poster',
  'posterUrl',
  'poster_url',
  'thumbnail',
  'path',
];

export function getState() {
  return state;
}

export function setState(patch = {}) {
  state = {
    ...state,
    ...patch,
  };
  notify();
  return state;
}

export function setNestedData(dataPatch = {}) {
  state = {
    ...state,
    data: {
      ...state.data,
      ...dataPatch,
    },
  };
  notify();
  return state;
}

export function setActiveTab(activeTab) {
  return setState({ activeTab });
}

export function setLoading(loading) {
  return setState({ loading: Boolean(loading) });
}

export function setError(error) {
  return setState({ error });
}


export function startSiteSettingsEdit(siteSettings = {}) {
  const draftValues = extractSiteSettingsEditableValues(siteSettings);
  return setState({
    siteSettingsEdit: {
      ...createEmptySiteSettingsEditState(),
      isEditing: true,
      draftValues,
      originalValues: { ...draftValues },
    },
  });
}

export function updateSiteSettingsDraftField(fieldName, value) {
  const current = state.siteSettingsEdit || createEmptySiteSettingsEditState();
  const draftValues = {
    ...current.draftValues,
    [fieldName]: value,
  };
  return setState({
    siteSettingsEdit: {
      ...current,
      draftValues,
      dirty: hasSiteSettingsDraftChanged(draftValues, current.originalValues),
      saveError: null,
      saveSuccess: null,
    },
  });
}

export function setSiteSettingsEditState(patch = {}) {
  const current = state.siteSettingsEdit || createEmptySiteSettingsEditState();
  return setState({
    siteSettingsEdit: {
      ...current,
      ...patch,
    },
  });
}

export function resetSiteSettingsEdit() {
  return setState({ siteSettingsEdit: createEmptySiteSettingsEditState() });
}

export function createEmptyReleaseOperationGateState() {
  return {
    loading: false,
    blocked: false,
    operationId: '',
    operationType: '',
    state: 'idle',
    phase: '',
    code: '',
    classification: 'idle',
    expectedReleaseId: '',
    targetReleaseId: '',
    contentHash: '',
    contentPath: '',
    message: '',
    reconciliationRequired: false,
    reconciling: false,
    lastCheckedAt: null,
    error: null,
    lineageRepairRequired: false,
    repairRequired: false,
    pointerRepairRequired: false,
    terminalAuditIdentityInvalid: false,
    terminalAuditConflict: false,
    result: null,
  };
}

export function setReleaseOperationGateState(patch = {}) {
  const current = state.releaseOperationGate || createEmptyReleaseOperationGateState();
  return setState({
    releaseOperationGate: {
      ...current,
      ...patch,
    },
  });
}

export function clearReleaseOperationGateState() {
  return setState({ releaseOperationGate: createEmptyReleaseOperationGateState() });
}

export function createEmptyPointerRepairState() {
  return {
    status: 'idle',
    dryRunLoading: false,
    applyLoading: false,
    plan: null,
    planHash: '',
    sourceIdentity: null,
    error: null,
    lastResult: null,
    lastCheckedAt: null,
  };
}

export function setPointerRepairState(patch = {}) {
  const current = state.pointerRepair || createEmptyPointerRepairState();
  return setState({
    pointerRepair: {
      ...current,
      ...patch,
    },
  });
}

export function resetPointerRepairState() {
  return setState({ pointerRepair: createEmptyPointerRepairState() });
}

export function clearReleaseOperationGateFromExactIdle(result = null) {
  return setReleaseOperationGateState({
    ...createEmptyReleaseOperationGateState(),
    blocked: false,
    lineageRepairRequired: false,
    repairRequired: false,
    pointerRepairRequired: false,
    terminalAuditIdentityInvalid: false,
    terminalAuditConflict: false,
    reconciliationRequired: false,
    reconciling: false,
    operationId: '',
    operationType: '',
    state: 'idle',
    phase: '',
    code: '',
    classification: 'idle',
    message: '',
    error: null,
    result: result || null,
    lastCheckedAt: new Date().toISOString(),
  });
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const EXACT_IDLE_ALLOWED_KEYS = new Set([
  'ok',
  'mode',
  'classification',
  'state',
  'operationState',
  'blocked',
  'repairable',
  'pointerHealth',
  'error',
  'code',
  'operationResolved',
  'reconciliationRequired',
  'reconciling',
  'lineageRepairRequired',
  'repairRequired',
  'pointerRepairRequired',
  'terminalAuditIdentityInvalid',
  'terminalAuditConflict',
  'operation',
  'activeOperation',
  'operationId',
  'id',
  'operationType',
  'phase',
  'expectedReleaseId',
  'targetReleaseId',
  'releaseId',
  'contentHash',
  'contentPath',
]);

function hasOwnReleaseGateField(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function hasOnlyExactIdleAllowedKeys(source) {
  const stringKeys = Object.keys(source);
  if (!stringKeys.every((key) => EXACT_IDLE_ALLOWED_KEYS.has(key))) return false;
  return Object.getOwnPropertySymbols(source).length === 0;
}

function isAbsentOrNull(source, key) {
  if (!hasOwnReleaseGateField(source, key)) return true;
  return source[key] === null;
}

function isAbsentNullOrEmptyString(source, key) {
  if (!hasOwnReleaseGateField(source, key)) return true;
  const value = source[key];
  return value === null || value === '';
}

function isAbsentOrFalseBoolean(source, key) {
  if (!hasOwnReleaseGateField(source, key)) return true;
  return source[key] === false;
}

function hasNoOperationIdentityFields(source) {
  return [
    'operationId',
    'id',
    'operationType',
    'phase',
    'expectedReleaseId',
    'targetReleaseId',
    'releaseId',
    'contentHash',
    'contentPath',
  ].every((key) => isAbsentNullOrEmptyString(source, key));
}

function hasNoNestedOperationMetadata(source) {
  return ['operation', 'activeOperation'].every((key) => isAbsentOrNull(source, key));
}

function hasExactIdleStateFields(source) {
  const hasState = hasOwnReleaseGateField(source, 'state');
  const hasOperationState = hasOwnReleaseGateField(source, 'operationState');
  if (!hasState && !hasOperationState) return false;
  if (hasState && source.state !== 'idle') return false;
  if (hasOperationState && source.operationState !== 'idle') return false;
  return true;
}

function hasSafeExactIdleFlags(source) {
  return [
    'blocked',
    'repairable',
    'operationResolved',
    'reconciliationRequired',
    'reconciling',
    'lineageRepairRequired',
    'repairRequired',
    'pointerRepairRequired',
    'terminalAuditIdentityInvalid',
    'terminalAuditConflict',
  ].every((key) => isAbsentOrFalseBoolean(source, key));
}

export function isExactIdleReleaseStatusPayload(data = {}) {
  if (!isPlainRecord(data)) return false;
  return Boolean(
    hasOnlyExactIdleAllowedKeys(data)
    && data.ok === true
    && data.mode === 'status'
    && data.classification === 'idle'
    && hasExactIdleStateFields(data)
    && hasSafeExactIdleFlags(data)
    && isAbsentOrNull(data, 'error')
    && isAbsentNullOrEmptyString(data, 'code')
    && hasNoOperationIdentityFields(data)
    && hasNoNestedOperationMetadata(data)
  );
}

export function applyReleaseOperationGateFromServer(data = {}, fallbackMessage = '') {
  if (isExactIdleReleaseStatusPayload(data)) {
    return clearReleaseOperationGateFromExactIdle(data || null);
  }
  const source = isPlainRecord(data) ? data : {};
  const stateText = typeof source.state === 'string'
    ? source.state.trim()
    : (typeof source.operationState === 'string' ? source.operationState.trim() : '');
  const rawClassification = typeof source.classification === 'string' ? source.classification.trim() : '';
  const rawCode = typeof source.code === 'string' ? source.code.trim() : '';
  const classification = rawClassification || rawCode || 'unknown';
  const identityInvalid = Boolean(source.terminalAuditIdentityInvalid === true || classification === 'terminal_audit_identity_invalid' || rawCode === 'TERMINAL_AUDIT_IDENTITY_INVALID' || rawCode === 'TERMINAL_AUDIT_ORIGINAL_ACTOR_MISSING');
  const auditConflict = Boolean(source.terminalAuditConflict === true || classification === 'terminal_audit_conflict' || rawCode === 'TERMINAL_AUDIT_CONFLICT');
  const pointerRepairRequired = !identityInvalid && !auditConflict && Boolean(
    source.pointerRepairRequired === true
    || (source.repairable === true && (classification === 'canonical_pointer_missing' || rawCode === 'CANONICAL_CURRENT_RELEASE_POINTER_MISSING'))
  );
  const lineageRepairRequired = !identityInvalid && !auditConflict && !pointerRepairRequired && Boolean(source.lineageRepairRequired === true || source.repairable === true || classification === 'lineage_repair_required' || rawCode === 'RELEASE_LINEAGE_REPAIR_REQUIRED');
  const pointerUnknown = Boolean(source.reconciliationRequired === true || classification === 'pointer_unknown' || stateText === 'pointer_unknown' || rawCode === 'POINTER_STATE_UNKNOWN');
  // Fail-closed contract: this function is only reached after exact-idle was rejected.
  // Therefore every non-exact-idle, including classification='clean', remains blocked.
  const blockedMessage = identityInvalid
    ? 'Lịch sử vận hành của bản công khai thiếu hoặc mâu thuẫn thông tin định danh. Cần kiểm tra dữ liệu vận hành trước khi tiếp tục.'
    : auditConflict
      ? 'Lịch sử vận hành có bản ghi terminal mâu thuẫn. Cần kiểm tra forensic trước khi tiếp tục.'
      : pointerRepairRequired
        ? 'Thiếu con trỏ current_release.json. Hãy kiểm tra kế hoạch sửa con trỏ trước khi áp dụng, không dọn tệp hoặc công khai lại.'
        : lineageRepairRequired
          ? 'Bản công khai đã được xác nhận nhưng lịch sử vận hành chưa hoàn tất. Hãy sửa lịch sử vận hành trước khi tiếp tục.'
          : pointerUnknown
          ? 'Chưa xác định website đang dùng bản nào. Không công khai hoặc khôi phục lại. Hãy kiểm tra trạng thái hiện tại.'
          : (fallbackMessage || 'Máy chủ chưa xác nhận trạng thái an toàn. Không công khai hoặc khôi phục thêm.');
  return setReleaseOperationGateState({
    loading: false,
    blocked: true,
    operationId: String(source.operationId || source.id || ''),
    operationType: String(source.operationType || ''),
    state: stateText || 'blocked',
    phase: String(source.phase || ''),
    code: rawCode,
    classification,
    expectedReleaseId: String(source.expectedReleaseId || source.releaseId || ''),
    targetReleaseId: String(source.targetReleaseId || ''),
    contentHash: String(source.contentHash || ''),
    contentPath: String(source.contentPath || ''),
    message: blockedMessage,
    reconciliationRequired: pointerUnknown,
    lineageRepairRequired,
    repairRequired: lineageRepairRequired,
    pointerRepairRequired,
    terminalAuditIdentityInvalid: identityInvalid,
    terminalAuditConflict: auditConflict,
    reconciling: false,
    lastCheckedAt: new Date().toISOString(),
    error: source.error || fallbackMessage || null,
    result: isPlainRecord(data) ? data : null,
  });
}

export function createEmptySiteSettingsEditState() {
  return {
    isEditing: false,
    draftValues: {},
    originalValues: {},
    dirty: false,
    saving: false,
    saveError: null,
    saveSuccess: null,
    validationErrors: {},
    validationWarnings: {},
  };
}

export function extractSiteSettingsEditableValues(siteSettings = {}) {
  return {
    site_title: siteSettings.site_title || '',
    organization_name: siteSettings.organization_name || '',
    address: siteSettings.address || '',
    phone: siteSettings.phone || '',
    fax: siteSettings.fax || '',
    email: siteSettings.email || '',
    logo_url: siteSettings.logo_url || '',
    default_language: siteSettings.default_language || 'vi',
  };
}

export function hasSiteSettingsDraftChanged(draftValues = {}, originalValues = {}) {
  const keys = ['site_title', 'organization_name', 'address', 'phone', 'fax', 'email', 'logo_url', 'default_language'];
  return keys.some((key) => normalizeDraftValue(draftValues[key]) !== normalizeDraftValue(originalValues[key]));
}


export function startGateEdit(gateContent = {}) {
  const draftValues = extractGateEditableValues(gateContent);
  return setState({
    gateEdit: {
      ...createEmptyGateEditState(),
      isEditing: true,
      draftValues: structuredCloneSafe(draftValues),
      originalValues: structuredCloneSafe(draftValues),
    },
  });
}

export function updateGateDraftField(fieldName, value) {
  const current = state.gateEdit || createEmptyGateEditState();
  const draftValues = {
    ...current.draftValues,
    [fieldName]: value,
  };
  return setState({
    gateEdit: {
      ...current,
      draftValues,
      dirty: hasGateDraftChanged(draftValues, current.originalValues),
      saveError: null,
      saveSuccess: null,
    },
  });
}

export function updateGateRoomDraftField(roomKey, fieldName, value) {
  const current = state.gateEdit || createEmptyGateEditState();
  const currentRooms = current.draftValues?.rooms || {};
  const currentRoom = currentRooms?.[roomKey] || {};
  const draftValues = {
    ...current.draftValues,
    rooms: {
      ...currentRooms,
      [roomKey]: {
        ...currentRoom,
        [fieldName]: value,
      },
    },
  };
  return setState({
    gateEdit: {
      ...current,
      draftValues,
      dirty: hasGateDraftChanged(draftValues, current.originalValues),
      saveError: null,
      saveSuccess: null,
    },
  });
}

export function setGateEditState(patch = {}) {
  const current = state.gateEdit || createEmptyGateEditState();
  return setState({
    gateEdit: {
      ...current,
      ...patch,
    },
  });
}

export function resetGateEdit() {
  return setState({ gateEdit: createEmptyGateEditState() });
}

export function createEmptyGateEditState() {
  return {
    isEditing: false,
    draftValues: {},
    originalValues: {},
    dirty: false,
    saving: false,
    saveError: null,
    saveSuccess: null,
    validationErrors: {},
    validationWarnings: {},
  };
}

export function extractGateEditableValues(gateContent = {}) {
  const roomsJson = normalizeObjectValue(gateContent.rooms_json);
  return {
    eyebrow: gateContent.eyebrow || '',
    title: gateContent.title || '',
    description: gateContent.description || '',
    back_label: gateContent.back_label || '',
    rooms: {
      indoor: extractGateRoomEditableValues(roomsJson.indoor || {}),
      outdoor: extractGateRoomEditableValues(roomsJson.outdoor || {}),
    },
    originalRoomsJson: structuredCloneSafe(roomsJson),
  };
}

export function hasGateDraftChanged(draftValues = {}, originalValues = {}) {
  return JSON.stringify(normalizeGateDraftForCompare(draftValues)) !== JSON.stringify(normalizeGateDraftForCompare(originalValues));
}

function extractGateRoomEditableValues(roomData = {}) {
  const room = normalizeObjectValue(roomData);
  return {
    displayName: firstText(room, ['label', 'title', 'name']),
    description: firstText(room, ['description', 'lead', 'subtitle']),
    ctaLabel: extractGateRoomCtaLabel(room),
    ctaEditable: hasGateRoomCtaLabel(room),
  };
}

function normalizeGateDraftForCompare(values = {}) {
  const rooms = values.rooms || {};
  return {
    eyebrow: normalizeDraftValue(values.eyebrow),
    title: normalizeDraftValue(values.title),
    description: normalizeDraftValue(values.description),
    back_label: normalizeDraftValue(values.back_label),
    rooms: {
      indoor: normalizeGateRoomForCompare(rooms.indoor),
      outdoor: normalizeGateRoomForCompare(rooms.outdoor),
    },
  };
}

function normalizeGateRoomForCompare(room = {}) {
  return {
    displayName: normalizeDraftValue(room?.displayName),
    description: normalizeDraftValue(room?.description),
    ctaLabel: normalizeDraftValue(room?.ctaLabel),
  };
}

function extractGateRoomCtaLabel(room = {}) {
  if (hasOwn(room, 'ctaLabel')) return normalizeDraftValue(room.ctaLabel);
  const ctaObject = firstObject(room, ['cta', 'button', 'action']);
  return ctaObject ? firstText(ctaObject, ['label', 'text', 'title', 'name']) : '';
}

function hasGateRoomCtaLabel(room = {}) {
  if (hasOwn(room, 'ctaLabel')) return true;
  const ctaObject = firstObject(room, ['cta', 'button', 'action']);
  return Boolean(ctaObject && ['label', 'text', 'title', 'name'].some((key) => hasOwn(ctaObject, key)));
}

function firstObject(object = {}, keys = []) {
  for (const key of keys) {
    if (object?.[key] && typeof object[key] === 'object' && !Array.isArray(object[key])) return object[key];
  }
  return null;
}

function firstText(object = {}, keys = []) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return '';
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeObjectValue(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? structuredCloneSafe(value) : {};
}


export function startHomeHeroEdit(section = {}) {
  const draftValues = extractHomeHeroEditableValues(section);
  return setState({
    homeEdit: {
      ...createEmptyHomeEditState(),
      isEditing: true,
      editingSectionId: section.id || null,
      editingSectionKey: section.section_key || null,
      draftValues: structuredCloneSafe(draftValues),
      originalValues: structuredCloneSafe(draftValues),
    },
  });
}

export function updateHomeHeroDraftField(fieldName, value) {
  const current = state.homeEdit || createEmptyHomeEditState();
  const draftValues = {
    ...current.draftValues,
    [fieldName]: value,
  };
  return setState({
    homeEdit: {
      ...current,
      draftValues,
      dirty: hasHomeHeroDraftChanged(draftValues, current.originalValues),
      saveError: null,
      saveSuccess: null,
    },
  });
}

export function updateHomeHeroMediaDraftField(fieldName, value) {
  const current = state.homeEdit || createEmptyHomeEditState();
  const currentMedia = current.draftValues?.media || {};
  const draftValues = {
    ...current.draftValues,
    media: {
      ...currentMedia,
      [fieldName]: value,
    },
  };

  if (fieldName !== 'caption') {
    draftValues.originalMediaJson = {
      ...normalizeObjectValue(current.draftValues?.originalMediaJson),
      [fieldName]: value,
    };
  }

  return setState({
    homeEdit: {
      ...current,
      draftValues,
      dirty: hasHomeHeroDraftChanged(draftValues, current.originalValues),
      saveError: null,
      saveSuccess: null,
    },
  });
}

export function updateHomeHeroItemDraftField(index, fieldName, value) {
  const current = state.homeEdit || createEmptyHomeEditState();
  const items = safeArrayClone(current.draftValues?.items);
  const item = items[index] || {};
  items[index] = {
    ...item,
    [fieldName]: value,
  };
  const draftValues = {
    ...current.draftValues,
    items,
  };
  return setState({
    homeEdit: {
      ...current,
      draftValues,
      dirty: hasHomeHeroDraftChanged(draftValues, current.originalValues),
      saveError: null,
      saveSuccess: null,
    },
  });
}

export function updateHomeHeroCtaDraftField(fieldName, value) {
  const current = state.homeEdit || createEmptyHomeEditState();
  const currentCta = current.draftValues?.cta || {};
  const draftValues = {
    ...current.draftValues,
    cta: {
      ...currentCta,
      [fieldName]: value,
    },
  };
  return setState({
    homeEdit: {
      ...current,
      draftValues,
      dirty: hasHomeHeroDraftChanged(draftValues, current.originalValues),
      saveError: null,
      saveSuccess: null,
    },
  });
}

export function setHomeEditState(patch = {}) {
  const current = state.homeEdit || createEmptyHomeEditState();
  return setState({
    homeEdit: {
      ...current,
      ...patch,
    },
  });
}

export function resetHomeEdit() {
  return setState({ homeEdit: createEmptyHomeEditState() });
}

export function createEmptyHomeEditState() {
  return {
    isEditing: false,
    editingSectionId: null,
    editingSectionKey: null,
    draftValues: {},
    originalValues: {},
    dirty: false,
    saving: false,
    saveError: null,
    saveSuccess: null,
    validationErrors: {},
    validationWarnings: {},
  };
}

export function extractHomeHeroEditableValues(section = {}) {
  const mediaJson = normalizeObjectValue(section.media_json);
  const itemsJson = normalizeArrayValue(section.items_json);
  const ctaJson = normalizeObjectValue(section.cta_json);
  return {
    section_key: section.section_key || '',
    eyebrow: section.eyebrow || '',
    title: section.title || '',
    subtitle: section.subtitle || '',
    lead: section.lead || '',
    body: section.body || '',
    media: extractHomeHeroMediaEditableValues(mediaJson),
    items: extractHomeHeroItemsEditableValues(itemsJson),
    cta: extractHomeHeroCtaEditableValues(ctaJson),
    originalMediaJson: structuredCloneSafe(mediaJson),
    originalItemsJson: structuredCloneSafe(itemsJson),
    originalCtaJson: structuredCloneSafe(ctaJson),
  };
}

export function hasHomeHeroDraftChanged(draftValues = {}, originalValues = {}) {
  return JSON.stringify(normalizeHomeHeroDraftForCompare(draftValues)) !== JSON.stringify(normalizeHomeHeroDraftForCompare(originalValues));
}

function extractHomeHeroMediaEditableValues(media = {}) {
  const object = normalizeObjectValue(media);
  const out = {
    caption: firstText(object, ['caption', 'alt', 'title', 'label']),
  };
  HOME_HERO_MEDIA_PATH_KEYS.forEach((key) => {
    if (hasOwn(object, key)) out[key] = normalizeDraftValue(object[key]);
  });
  return out;
}

function extractHomeHeroItemsEditableValues(items = []) {
  const list = normalizeArrayValue(items);
  return list.map((item) => {
    if (typeof item === 'string') {
      return { kind: 'string', text: item };
    }
    const object = normalizeObjectValue(item);
    return {
      kind: 'object',
      title: firstText(object, ['title', 'label', 'name', 'heading', 'text']),
      description: firstText(object, ['description', 'lead', 'body', 'note']),
    };
  });
}

function extractHomeHeroCtaEditableValues(cta = {}) {
  const object = normalizeObjectValue(cta);
  return {
    label: firstText(object, ['label', 'text', 'title', 'name']),
    editable: hasAnyOwn(object, ['label', 'text', 'title', 'name']),
  };
}

function normalizeHomeHeroDraftForCompare(values = {}) {
  return {
    section_key: normalizeDraftValue(values.section_key),
    eyebrow: normalizeDraftValue(values.eyebrow),
    title: normalizeDraftValue(values.title),
    subtitle: normalizeDraftValue(values.subtitle),
    lead: normalizeDraftValue(values.lead),
    body: normalizeDraftValue(values.body),
    media: normalizeHomeHeroMediaDraftForCompare(values.media),
    items: safeArrayClone(values.items).map((item) => ({
      kind: item.kind || 'object',
      text: normalizeDraftValue(item.text),
      title: normalizeDraftValue(item.title),
      description: normalizeDraftValue(item.description),
    })),
    cta: {
      label: normalizeDraftValue(values.cta?.label),
      editable: Boolean(values.cta?.editable),
    },
  };
}

function normalizeHomeHeroMediaDraftForCompare(media = {}) {
  const out = { caption: normalizeDraftValue(media?.caption) };
  HOME_HERO_MEDIA_PATH_KEYS.forEach((key) => {
    if (hasOwn(media, key)) out[key] = normalizeDraftValue(media[key]);
  });
  return out;
}

function normalizeArrayValue(value) {
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? structuredCloneSafe(value) : [];
}

function safeArrayClone(value) {
  return Array.isArray(value) ? structuredCloneSafe(value) : [];
}

function hasAnyOwn(object, keys = []) {
  return keys.some((key) => hasOwn(object, key));
}


export function startHomeGuideEdit(section = {}) {
  const draftValues = extractHomeGuideEditableValues(section);
  return setState({
    homeEdit: {
      ...createEmptyHomeEditState(),
      isEditing: true,
      editingSectionId: section.id || null,
      editingSectionKey: section.section_key || null,
      draftValues: structuredCloneSafe(draftValues),
      originalValues: structuredCloneSafe(draftValues),
    },
  });
}

export function updateHomeGuideDraftField(fieldName, value) {
  const current = state.homeEdit || createEmptyHomeEditState();
  const draftValues = {
    ...current.draftValues,
    [fieldName]: value,
  };
  return setState({
    homeEdit: {
      ...current,
      draftValues,
      dirty: hasHomeGuideDraftChanged(draftValues, current.originalValues),
      saveError: null,
      saveSuccess: null,
    },
  });
}

export function updateHomeGuideItemDraftField(index, fieldName, value) {
  const current = state.homeEdit || createEmptyHomeEditState();
  const items = safeArrayClone(current.draftValues?.items);
  const item = items[index] || {};
  items[index] = {
    ...item,
    [fieldName]: value,
  };
  const draftValues = {
    ...current.draftValues,
    items,
  };
  return setState({
    homeEdit: {
      ...current,
      draftValues,
      dirty: hasHomeGuideDraftChanged(draftValues, current.originalValues),
      saveError: null,
      saveSuccess: null,
    },
  });
}

export function extractHomeGuideEditableValues(section = {}) {
  const itemsJson = normalizeArrayValue(section.items_json);
  return {
    section_key: section.section_key || '',
    eyebrow: section.eyebrow || '',
    title: section.title || '',
    subtitle: section.subtitle || '',
    lead: section.lead || '',
    body: section.body || '',
    items: extractHomeGuideItemsEditableValues(itemsJson),
    originalItemsJson: structuredCloneSafe(itemsJson),
  };
}

export function hasHomeGuideDraftChanged(draftValues = {}, originalValues = {}) {
  return JSON.stringify(normalizeHomeGuideDraftForCompare(draftValues)) !== JSON.stringify(normalizeHomeGuideDraftForCompare(originalValues));
}

function extractHomeGuideItemsEditableValues(items = []) {
  const list = normalizeArrayValue(items);
  return list.map((item) => {
    if (typeof item === 'string') {
      return { kind: 'string', text: item };
    }
    const object = normalizeObjectValue(item);
    return {
      kind: 'object',
      title: firstText(object, ['title', 'label', 'name', 'heading', 'text']),
      description: firstText(object, ['description', 'lead', 'body', 'note']),
      number: firstText(object, ['number', 'step', 'order']),
    };
  });
}

function normalizeHomeGuideDraftForCompare(values = {}) {
  return {
    section_key: normalizeDraftValue(values.section_key),
    eyebrow: normalizeDraftValue(values.eyebrow),
    title: normalizeDraftValue(values.title),
    subtitle: normalizeDraftValue(values.subtitle),
    lead: normalizeDraftValue(values.lead),
    body: normalizeDraftValue(values.body),
    items: safeArrayClone(values.items).map((item) => ({
      kind: item.kind || 'object',
      text: normalizeDraftValue(item.text),
      title: normalizeDraftValue(item.title),
      description: normalizeDraftValue(item.description),
    })),
  };
}

export function startHomeExperienceEdit(section = {}) {
  const draftValues = extractHomeExperienceEditableValues(section);
  return setState({
    homeEdit: {
      ...createEmptyHomeEditState(),
      isEditing: true,
      editingSectionId: section.id || null,
      editingSectionKey: section.section_key || null,
      draftValues: structuredCloneSafe(draftValues),
      originalValues: structuredCloneSafe(draftValues),
    },
  });
}

export function updateHomeExperienceDraftField(fieldName, value) {
  const current = state.homeEdit || createEmptyHomeEditState();
  const draftValues = {
    ...current.draftValues,
    [fieldName]: value,
  };
  return setState({
    homeEdit: {
      ...current,
      draftValues,
      dirty: hasHomeExperienceDraftChanged(draftValues, current.originalValues),
      saveError: null,
      saveSuccess: null,
    },
  });
}

export function updateHomeExperienceItemDraftField(index, fieldName, value) {
  const current = state.homeEdit || createEmptyHomeEditState();
  const items = safeArrayClone(current.draftValues?.items);
  const item = items[index] || {};
  items[index] = {
    ...item,
    [fieldName]: value,
  };
  const draftValues = {
    ...current.draftValues,
    items,
  };
  return setState({
    homeEdit: {
      ...current,
      draftValues,
      dirty: hasHomeExperienceDraftChanged(draftValues, current.originalValues),
      saveError: null,
      saveSuccess: null,
    },
  });
}

export function extractHomeExperienceEditableValues(section = {}) {
  const itemsJson = normalizeArrayValue(section.items_json);
  return {
    section_key: section.section_key || '',
    eyebrow: section.eyebrow || '',
    title: section.title || '',
    subtitle: section.subtitle || '',
    lead: section.lead || '',
    body: section.body || '',
    items: extractHomeExperienceItemsEditableValues(itemsJson),
    originalItemsJson: structuredCloneSafe(itemsJson),
  };
}

export function hasHomeExperienceDraftChanged(draftValues = {}, originalValues = {}) {
  return JSON.stringify(normalizeHomeExperienceDraftForCompare(draftValues)) !== JSON.stringify(normalizeHomeExperienceDraftForCompare(originalValues));
}

function extractHomeExperienceItemsEditableValues(items = []) {
  const list = normalizeArrayValue(items);
  return list.map((item) => {
    if (typeof item === 'string') {
      return { kind: 'string', text: item };
    }
    const object = normalizeObjectValue(item);
    return {
      kind: 'object',
      title: firstText(object, ['title', 'label', 'name', 'heading', 'text']),
      description: firstText(object, ['description', 'lead', 'body', 'note']),
      roomKey: firstText(object, ['room_key', 'room', 'key']),
      ctaLabel: firstText(object, ['ctaLabel']),
    };
  });
}

function normalizeHomeExperienceDraftForCompare(values = {}) {
  return {
    section_key: normalizeDraftValue(values.section_key),
    eyebrow: normalizeDraftValue(values.eyebrow),
    title: normalizeDraftValue(values.title),
    subtitle: normalizeDraftValue(values.subtitle),
    lead: normalizeDraftValue(values.lead),
    body: normalizeDraftValue(values.body),
    items: safeArrayClone(values.items).map((item) => ({
      kind: item.kind || 'object',
      text: normalizeDraftValue(item.text),
      title: normalizeDraftValue(item.title),
      description: normalizeDraftValue(item.description),
    })),
  };
}




const SCOPED_CMS_PUBLISH_KEYS = ['home', 'gate', 'rooms3d'];

export function createEmptyScopedPublishScopeState() {
  return {
    checking: false,
    publishing: false,
    checked: false,
    candidateHash: '',
    candidateSummary: null,
    validationSummary: null,
    warnings: null,
    error: null,
    result: null,
    dryRunResult: null,
    checkedAt: null,
    publishedAt: null,
    expectedCurrentReleaseId: '',
    expectedCurrentContentHash: '',
    draftId: '',
    expectedDraftUpdatedAt: null,
    expectedDraftVersion: '',
    stale: false,
    staleReason: '',
    status: '',
  };
}

export function createEmptyScopedPublishState() {
  return SCOPED_CMS_PUBLISH_KEYS.reduce((acc, key) => {
    acc[key] = createEmptyScopedPublishScopeState();
    return acc;
  }, {});
}

function normalizeScopedPublishKey(scopeKey) {
  const key = String(scopeKey || '').trim().toLowerCase();
  return SCOPED_CMS_PUBLISH_KEYS.includes(key) ? key : '';
}

function createScopedPublishPatchForInvalidation(scopeState = {}, reason = '') {
  const text = String(reason || 'Nội dung hoặc website đang chạy đã thay đổi. Hãy kiểm tra lại trước khi đưa lên website.').trim();
  return {
    ...scopeState,
    checking: false,
    publishing: false,
    checked: false,
    candidateHash: '',
    candidateSummary: null,
    validationSummary: null,
    error: null,
    dryRunResult: null,
    stale: true,
    staleReason: text,
    status: text,
  };
}

export function setScopedCmsPublishState(scopeKey, patch = {}) {
  const key = normalizeScopedPublishKey(scopeKey);
  if (!key) return state;
  const currentAll = state.scopedPublish || createEmptyScopedPublishState();
  const current = currentAll[key] || createEmptyScopedPublishScopeState();
  return setState({
    scopedPublish: {
      ...currentAll,
      [key]: {
        ...current,
        ...patch,
      },
    },
  });
}

export function resetScopedCmsPublishState(scopeKey) {
  const key = normalizeScopedPublishKey(scopeKey);
  if (!key) return state;
  const currentAll = state.scopedPublish || createEmptyScopedPublishState();
  return setState({
    scopedPublish: {
      ...currentAll,
      [key]: createEmptyScopedPublishScopeState(),
    },
  });
}

export function invalidateScopedCmsPublishScope(scopeKey, reason = '') {
  const key = normalizeScopedPublishKey(scopeKey);
  if (!key) return state;
  const currentAll = state.scopedPublish || createEmptyScopedPublishState();
  const current = currentAll[key] || createEmptyScopedPublishScopeState();
  if (!current.candidateHash && !current.checked && !current.publishing && !current.checking) return state;
  return setState({
    scopedPublish: {
      ...currentAll,
      [key]: createScopedPublishPatchForInvalidation(current, reason),
    },
  });
}

export function invalidateAllScopedCmsPublishCandidates(reason = '') {
  const currentAll = state.scopedPublish || createEmptyScopedPublishState();
  const nextAll = { ...currentAll };
  let changed = false;
  SCOPED_CMS_PUBLISH_KEYS.forEach((key) => {
    const current = currentAll[key] || createEmptyScopedPublishScopeState();
    if (current.candidateHash || current.checked || current.publishing || current.checking) {
      nextAll[key] = createScopedPublishPatchForInvalidation(current, reason);
      changed = true;
    }
  });
  if (!changed) return state;
  return setState({ scopedPublish: nextAll });
}

export function createEmptyStaticCmsDraftState() {
  return {
    baselineJson: null,
    draftJson: null,
    source: '',
    sourceUrl: '',
    loading: false,
    loadError: null,
    selectedRoom: 'indoor',
    selectedItemCode: '',
    dirty: false,
    validation: { valid: false, errors: {}, warnings: {} },
    previewField: '',
    exportError: null,
    exportSuccess: null,
    lastExportName: '',
    lastLoadedAt: null,
    currentDraftId: '',
    draftTitle: '',
    draftTitleTouched: false,
    draftNote: '',
    savedDrafts: [],
    isSavingDraft: false,
    isLoadingDrafts: false,
    draftSaveStatus: '',
    draftLastSavedAt: null,
    persistedDraftId: '',
    persistedDraftUpdatedAt: null,
    persistedDraftVersion: '',
    publishVerifiedDraftId: '',
    publishVerifiedDraftUpdatedAt: null,
    publishVerifiedDraftVersion: '',
    publishVerifiedCandidateHash: '',
    publishVerificationInvalidatedAt: null,
    publishVerificationInvalidationReason: '',
    draftPersistenceError: null,
    draftListLoadedAt: null,
    mediaUploadStatus: {},
    mediaUploadError: null,
    lastMediaUpload: null,
    isUploadingMedia: false,
    isPublishingCms: false,
    publishDryRunResult: null,
    publishResult: null,
    publishStatus: '',
    publishError: null,
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
    publishLastVerifiedAt: null,
    isComposingPreparationDraft: false,
    preparationCompositionStatus: '',
    preparationCompositionError: null,
    preparationCompositionResult: null,
    activeWorkspace: 'room',
    activeEditorTab: 'content',
    activeDrawer: '',
    selectedFeaturedIndex: 0,
  };
}

export function setStaticCmsDraftState(patch = {}) {
  const current = state.staticCmsDraft || createEmptyStaticCmsDraftState();
  return setState({
    staticCmsDraft: {
      ...current,
      ...patch,
    },
  });
}

export function resetStaticCmsDraftState() {
  return setState({ staticCmsDraft: createEmptyStaticCmsDraftState() });
}

export function setStaticCmsDraftBaseline({ baselineJson = null, source = '', sourceUrl = '', validation = null } = {}) {
  const baseline = structuredCloneSafe(baselineJson || {});
  const draft = structuredCloneSafe(baseline);
  const selectedRoom = getFirstStaticCmsRoom(draft) || 'indoor';
  const selectedItemCode = getFirstStaticCmsItemCode(draft, selectedRoom);
  return setState({
    staticCmsDraft: {
      ...createEmptyStaticCmsDraftState(),
      baselineJson: baseline,
      draftJson: draft,
      source,
      sourceUrl,
      selectedRoom,
      selectedItemCode,
      dirty: false,
      validation: validation || { valid: false, errors: {}, warnings: {} },
      lastLoadedAt: new Date().toISOString(),
      currentDraftId: '',
      draftTitle: createDefaultStaticCmsDraftTitle(draft),
      draftTitleTouched: false,
      draftNote: '',
      draftSaveStatus: '',
      draftLastSavedAt: null,
      persistedDraftId: '',
      persistedDraftUpdatedAt: null,
      persistedDraftVersion: '',
      publishVerifiedDraftId: '',
      publishVerifiedDraftUpdatedAt: null,
      publishVerifiedDraftVersion: '',
      publishVerifiedCandidateHash: '',
      publishVerificationInvalidatedAt: null,
      publishVerificationInvalidationReason: '',
      draftPersistenceError: null,
      mediaUploadStatus: {},
      mediaUploadError: null,
      lastMediaUpload: null,
      isUploadingMedia: false,
      publishDryRunResult: null,
      publishResult: null,
      publishStatus: '',
      publishError: null,
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
      publishLastVerifiedAt: null,
      isComposingPreparationDraft: false,
      preparationCompositionStatus: '',
      preparationCompositionError: null,
      preparationCompositionResult: null,
      activeWorkspace: 'room',
      activeEditorTab: 'content',
      activeDrawer: '',
      selectedFeaturedIndex: 0,
    },
  });
}

export function updateStaticCmsDraftRoom(selectedRoom) {
  const current = state.staticCmsDraft || createEmptyStaticCmsDraftState();
  const room = String(selectedRoom || 'indoor');
  const selectedItemCode = getFirstStaticCmsItemCode(current.draftJson, room);
  return setStaticCmsDraftState({ selectedRoom: room, selectedItemCode, exportError: null, exportSuccess: null, activeDrawer: '' });
}

export function updateStaticCmsDraftItem(selectedItemCode) {
  return setStaticCmsDraftState({
    selectedItemCode: String(selectedItemCode || ''),
    exportError: null,
    exportSuccess: null,
    draftSaveStatus: '',
    draftPersistenceError: null,
    activeDrawer: '',
  });
}

export function updateStaticCmsDraftJson(draftJson, validation = null) {
  const current = state.staticCmsDraft || createEmptyStaticCmsDraftState();
  setStaticCmsDraftState({
    draftJson: structuredCloneSafe(draftJson || {}),
    dirty: JSON.stringify(draftJson || {}) !== JSON.stringify(current.baselineJson || {}),
    validation: validation || current.validation,
    exportError: null,
    exportSuccess: null,
    draftSaveStatus: current.currentDraftId ? 'Có thay đổi chưa lưu lại bản nháp server.' : current.draftSaveStatus,
    draftPersistenceError: null,
    publishDryRunResult: null,
    publishResult: null,
    publishStatus: '',
    publishError: null,
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
    publishLastVerifiedAt: null,
    publishVerifiedDraftId: '',
    publishVerifiedDraftUpdatedAt: null,
    publishVerifiedDraftVersion: '',
    publishVerifiedCandidateHash: '',
    publishVerificationInvalidatedAt: new Date().toISOString(),
    publishVerificationInvalidationReason: 'Bản chuẩn bị trong trình duyệt đã thay đổi.',
    preparationCompositionStatus: '',
    preparationCompositionError: null,
  });
  return invalidateScopedCmsPublishScope('rooms3d', 'Nội dung phòng 3D đã thay đổi. Hãy lưu và kiểm tra lại trước khi đưa lên website.');
}

export function resetStaticCmsDraftToBaseline(validation = null, options = {}) {
  const current = state.staticCmsDraft || createEmptyStaticCmsDraftState();
  const baseline = structuredCloneSafe(current.baselineJson || {});
  const selectedRoom = current.selectedRoom || getFirstStaticCmsRoom(baseline) || 'indoor';
  const selectedItemCode = getFirstStaticCmsItemCode(baseline, selectedRoom);
  const invalidationReason = options.invalidationReason || 'Working copy đã được phục hồi về baseline; cần kiểm tra lại trước khi công khai.';
  return setStaticCmsDraftState({
    draftJson: baseline,
    selectedRoom,
    selectedItemCode,
    dirty: false,
    validation: validation || current.validation,
    previewField: '',
    exportError: null,
    exportSuccess: options.successMessage || 'Đã phục hồi nội dung về bản đã lưu/baseline đang mở.',
    lastExportName: '',
    currentDraftId: current.currentDraftId || '',
    draftTitle: current.draftTitle || createDefaultStaticCmsDraftTitle(baseline),
    draftTitleTouched: Boolean(current.draftTitleTouched),
    draftNote: current.draftNote || '',
    draftSaveStatus: current.currentDraftId ? 'Đã phục hồi working copy. Nếu chỉnh tiếp, hãy lưu lại vào bản chuẩn bị hiện tại.' : '',
    draftLastSavedAt: current.draftLastSavedAt || null,
    persistedDraftId: current.persistedDraftId || '',
    persistedDraftUpdatedAt: current.persistedDraftUpdatedAt || null,
    persistedDraftVersion: current.persistedDraftVersion || '',
    publishVerifiedDraftId: '',
    publishVerifiedDraftUpdatedAt: null,
    publishVerifiedDraftVersion: '',
    publishVerifiedCandidateHash: '',
    publishVerificationInvalidatedAt: new Date().toISOString(),
    publishVerificationInvalidationReason: invalidationReason,
    draftPersistenceError: null,
    mediaUploadStatus: {},
    mediaUploadError: null,
    lastMediaUpload: null,
    isUploadingMedia: false,
    publishDryRunResult: null,
    publishResult: null,
    publishStatus: '',
    publishError: null,
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
    publishLastVerifiedAt: null,
    preparationCompositionStatus: '',
    preparationCompositionError: null,
    preparationCompositionResult: null,
  });
}

export function clearStaticCmsDraftSession(options = {}) {
  const current = state.staticCmsDraft || createEmptyStaticCmsDraftState();
  return setStaticCmsDraftState({
    currentDraftId: '',
    draftTitle: options.resetTitle ? createDefaultStaticCmsDraftTitle(current.draftJson || {}) : (current.draftTitle || ''),
    draftTitleTouched: options.resetTitle ? false : Boolean(current.draftTitleTouched),
    draftNote: options.resetNote ? '' : (current.draftNote || ''),
    draftSaveStatus: options.status || '',
    draftLastSavedAt: null,
    persistedDraftId: '',
    persistedDraftUpdatedAt: null,
    persistedDraftVersion: '',
    draftPersistenceError: null,
    publishDryRunResult: null,
    publishResult: null,
    publishStatus: '',
    publishError: null,
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
    publishLastVerifiedAt: null,
    publishVerifiedDraftId: '',
    publishVerifiedDraftUpdatedAt: null,
    publishVerifiedDraftVersion: '',
    publishVerifiedCandidateHash: '',
    publishVerificationInvalidatedAt: new Date().toISOString(),
    publishVerificationInvalidationReason: options.invalidationReason || 'Draft session đã được rời hoặc xóa; cần lưu và kiểm tra lại trước khi công khai.',
  });
}

export function setStaticCmsSavedDrafts(savedDrafts = []) {
  return setStaticCmsDraftState({
    savedDrafts: safeArrayClone(savedDrafts),
    isLoadingDrafts: false,
    draftListLoadedAt: new Date().toISOString(),
    draftPersistenceError: null,
  });
}

export function setStaticCmsDraftPersistenceState(patch = {}) {
  const current = state.staticCmsDraft || createEmptyStaticCmsDraftState();
  return setStaticCmsDraftState({
    ...current,
    ...patch,
  });
}

export function setStaticCmsMediaUploadState(patch = {}) {
  const current = state.staticCmsDraft || createEmptyStaticCmsDraftState();
  return setStaticCmsDraftState({
    ...current,
    ...patch,
    mediaUploadStatus: {
      ...(current.mediaUploadStatus || {}),
      ...(patch.mediaUploadStatus || {}),
    },
  });
}

export function setStaticCmsPublishState(patch = {}) {
  const current = state.staticCmsDraft || createEmptyStaticCmsDraftState();
  return setStaticCmsDraftState({
    ...current,
    ...patch,
  });
}

export function invalidateStaticCmsPublishVerification(reason = 'Nội dung đã lưu ở màn khác đã thay đổi.') {
  return setStaticCmsPublishState({
    publishDryRunResult: null,
    publishResult: null,
    publishStatus: '',
    publishError: null,
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
    publishLastVerifiedAt: null,
    publishVerifiedDraftId: '',
    publishVerifiedDraftUpdatedAt: null,
    publishVerifiedDraftVersion: '',
    publishVerifiedCandidateHash: '',
    publishVerificationInvalidatedAt: new Date().toISOString(),
    publishVerificationInvalidationReason: String(reason || 'Nội dung đã lưu ở màn khác đã thay đổi.'),
  });
}

export function setStaticCmsDraftWorkspace(activeWorkspace = 'room') {
  const next = ['room', 'featured'].includes(String(activeWorkspace || '')) ? String(activeWorkspace || '') : 'room';
  return setStaticCmsDraftState({ activeWorkspace: next, activeDrawer: '' });
}

export function setStaticCmsDraftEditorTab(activeEditorTab) {
  const next = ['content', 'media', 'metadata'].includes(String(activeEditorTab || '')) ? String(activeEditorTab) : 'content';
  return setStaticCmsDraftState({ activeEditorTab: next });
}

export function setStaticCmsFeaturedIndex(selectedFeaturedIndex = 0) {
  const index = Number(selectedFeaturedIndex);
  return setStaticCmsDraftState({ selectedFeaturedIndex: Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0 });
}

export function setStaticCmsDraftDrawer(activeDrawer = '') {
  const allowed = ['', 'drafts', 'advanced', 'publishDetails'];
  const next = allowed.includes(String(activeDrawer || '')) ? String(activeDrawer || '') : '';
  return setStaticCmsDraftState({ activeDrawer: next });
}

export function updateStaticCmsDraftMeta(fieldName, value) {
  if (!['draftTitle', 'draftNote'].includes(fieldName)) return state;
  const patch = {
    [fieldName]: String(value ?? ''),
    draftSaveStatus: '',
    draftPersistenceError: null,
  };
  if (fieldName === 'draftTitle') {
    patch.draftTitleTouched = true;
  }
  return setStaticCmsDraftState(patch);
}

export function applySavedStaticCmsDraft(savedDraft = {}, validation = null) {
  const draftJson = structuredCloneSafe(savedDraft.content_json || savedDraft.contentJson || {});
  const selectedRoom = getFirstStaticCmsRoom(draftJson) || 'indoor';
  const selectedItemCode = getFirstStaticCmsItemCode(draftJson, selectedRoom);
  return setStaticCmsDraftState({
    baselineJson: structuredCloneSafe(draftJson),
    draftJson,
    source: 'saved-draft',
    sourceUrl: savedDraft.id ? `cms_drafts:${savedDraft.id}` : 'cms_drafts',
    selectedRoom,
    selectedItemCode,
    dirty: false,
    validation: validation || savedDraft.validation_json || { valid: false, errors: {}, warnings: {} },
    currentDraftId: savedDraft.id || '',
    draftTitle: savedDraft.title || createDefaultStaticCmsDraftTitle(draftJson),
    draftTitleTouched: Boolean(savedDraft.title),
    draftNote: savedDraft.note || '',
    draftSaveStatus: 'Đã mở bản nháp đã lưu. Chưa publish website.',
    draftLastSavedAt: savedDraft.updated_at || savedDraft.updatedAt || null,
    persistedDraftId: savedDraft.id || '',
    persistedDraftUpdatedAt: savedDraft.updated_at || savedDraft.updatedAt || null,
    persistedDraftVersion: draftJson.version || savedDraft.source_version || savedDraft.sourceVersion || '',
    publishVerifiedDraftId: '',
    publishVerifiedDraftUpdatedAt: null,
    publishVerifiedDraftVersion: '',
    publishVerifiedCandidateHash: '',
    publishVerificationInvalidatedAt: null,
    publishVerificationInvalidationReason: '',
    draftPersistenceError: null,
    mediaUploadStatus: {},
    mediaUploadError: null,
    lastMediaUpload: null,
    isUploadingMedia: false,
    publishDryRunResult: null,
    publishResult: null,
    publishStatus: '',
    publishError: null,
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
    publishLastVerifiedAt: null,
    exportError: null,
    exportSuccess: null,
    lastLoadedAt: new Date().toISOString(),
  });
}

function createDefaultStaticCmsDraftTitle(cmsJson = {}) {
  const version = cmsJson?.version ? ` ${cmsJson.version}` : '';
  return `Bản nháp CMS${version}`.trim();
}

function getFirstStaticCmsRoom(cmsJson = {}) {
  const rooms = cmsJson?.rooms || {};
  return ['indoor', 'outdoor'].find((roomKey) => Array.isArray(rooms?.[roomKey]?.artworks)) || '';
}

function getFirstStaticCmsItemCode(cmsJson = {}, roomKey = 'indoor') {
  const items = cmsJson?.rooms?.[roomKey]?.artworks || [];
  const first = Array.isArray(items) ? items[0] : null;
  return first ? String(first.artwork_code || first.id || first.code || '') : '';
}


export function createEmptyPublishHistoryState() {
  return {
    items: [],
    loading: false,
    error: null,
    loadedAt: null,
    selectedLogId: '',
    previewResult: null,
    previewError: null,
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
    isRollingBack: false,
  };
}

export function setCmsPublishHistoryState(patch = {}) {
  const current = state.publishHistory || createEmptyPublishHistoryState();
  return setState({
    publishHistory: {
      ...current,
      ...patch,
    },
  });
}

export function setCmsPublishHistoryItems(items = []) {
  return setCmsPublishHistoryState({
    items: safeArrayClone(items),
    loading: false,
    error: null,
    loadedAt: new Date().toISOString(),
  });
}

export function resetCmsRollbackState() {
  return setCmsPublishHistoryState({
    previewResult: null,
    previewError: null,
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
    isRollingBack: false,
  });
}


export function createEmptyStorageCleanupState() {
  return {
    scope: 'versions',
    retentionDays: 1,
    keepLastVersions: 10,
    loading: false,
    action: '',
    error: null,
    scanResult: null,
    dryRunResult: null,
    loadedAt: null,
    filters: {
      classification: 'all',
      eligible: 'all',
    },
  };
}

export function setCmsStorageCleanupState(patch = {}) {
  const current = state.storageCleanup || createEmptyStorageCleanupState();
  return setState({
    storageCleanup: {
      ...current,
      ...patch,
    },
  });
}

export function resetCmsStorageCleanupState() {
  return setState({ storageCleanup: createEmptyStorageCleanupState() });
}


export function getAllActiveEditSessions(currentState = state) {
  return [
    currentState.siteSettingsEdit?.isEditing ? { type: 'site-settings', id: 'site-settings', label: 'Thông tin website', dirty: Boolean(currentState.siteSettingsEdit.dirty), saving: Boolean(currentState.siteSettingsEdit.saving) } : null,
    currentState.gateEdit?.isEditing ? { type: 'gate', id: 'gate', label: 'Cổng vào triển lãm', dirty: Boolean(currentState.gateEdit.dirty), saving: Boolean(currentState.gateEdit.saving) } : null,
    currentState.homeEdit?.isEditing ? { type: 'home', id: String(currentState.homeEdit.editingSectionId || currentState.homeEdit.editingSectionKey || 'home'), key: currentState.homeEdit.editingSectionKey || '', label: 'Trang chủ', dirty: Boolean(currentState.homeEdit.dirty), saving: Boolean(currentState.homeEdit.saving) } : null,
    currentState.staticCmsDraft?.draftJson ? { type: 'static-cms-draft', id: 'static-cms-draft', label: 'Nội dung phòng 3D', dirty: Boolean(currentState.staticCmsDraft.dirty), saving: Boolean(currentState.staticCmsDraft.isSavingDraft) } : null,
  ].filter(Boolean);
}

export function getActiveEditSession(currentState = state) {
  return getAllActiveEditSessions(currentState)[0] || null;
}

export function hasActiveEditSession(currentState = state) {
  return getAllActiveEditSessions(currentState).length > 0;
}

export function hasDirtyEditSession(currentState = state) {
  return getAllActiveEditSessions(currentState).some((session) => Boolean(session.dirty));
}

export function hasSavingEditSession(currentState = state) {
  return getAllActiveEditSessions(currentState).some((session) => Boolean(session.saving));
}

export function resetActiveEditSession() {
  return setState({
    siteSettingsEdit: createEmptySiteSettingsEditState(),
    gateEdit: createEmptyGateEditState(),
    homeEdit: createEmptyHomeEditState(),
    staticCmsDraft: createEmptyStaticCmsDraftState(),
  });
}

const RESET_UNSAVED_SUCCESS_MESSAGE = 'Đã đặt lại thay đổi chưa lưu.';

function restoreDraftFromOriginal(current = {}) {
  const originalValues = structuredCloneSafe(current.originalValues || {});
  return {
    ...current,
    draftValues: structuredCloneSafe(originalValues),
    originalValues: structuredCloneSafe(originalValues),
    dirty: false,
    saving: false,
    saveError: null,
    saveSuccess: RESET_UNSAVED_SUCCESS_MESSAGE,
    validationErrors: {},
    validationWarnings: {},
  };
}

export function resetSiteSettingsDraftToOriginal() {
  const current = state.siteSettingsEdit || createEmptySiteSettingsEditState();
  if (!current.isEditing) return state;
  return setState({ siteSettingsEdit: restoreDraftFromOriginal(current) });
}

export function resetGateDraftToOriginal() {
  const current = state.gateEdit || createEmptyGateEditState();
  if (!current.isEditing) return state;
  return setState({ gateEdit: restoreDraftFromOriginal(current) });
}

export function resetHomeDraftToOriginal() {
  const current = state.homeEdit || createEmptyHomeEditState();
  if (!current.isEditing) return state;
  return setState({ homeEdit: restoreDraftFromOriginal(current) });
}
export function resetState() {
  state = structuredCloneSafe(initialState);
  notify();
  return state;
}

export function subscribe(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  listeners.add(listener);
  return () => listeners['delete'](listener);
}

function notify() {
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.error('[cms-admin] state listener failed', error);
    }
  });
}


function normalizeDraftValue(value) {
  return String(value ?? '').trim();
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
