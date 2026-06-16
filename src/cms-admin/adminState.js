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
  roomsEdit: createEmptyRoomsEditState(),
  artworksEdit: createEmptyArtworksEditState(),
  staticCmsDraft: createEmptyStaticCmsDraftState(),
  publishHistory: createEmptyPublishHistoryState(),
  storageCleanup: createEmptyStorageCleanupState(),
  data: {
    siteSettings: null,
    indexSections: [],
    gateContent: null,
    rooms: [],
    artworks: [],
    artworksPage: null,
    artworkStats: { total: 0, indoor: 0, outdoor: 0, warning: 0 },
    publishedBundles: [],
    mediaAssets: [],
    errors: {},
  },
};

let state = structuredCloneSafe(initialState);
const listeners = new Set();

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
    default_language: siteSettings.default_language || 'vi',
  };
}

export function hasSiteSettingsDraftChanged(draftValues = {}, originalValues = {}) {
  const keys = ['site_title', 'organization_name', 'address', 'phone', 'fax', 'email', 'default_language'];
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
  return {
    caption: firstText(object, ['caption', 'alt', 'title', 'label']),
  };
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
    media: {
      caption: normalizeDraftValue(values.media?.caption),
    },
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


export function createEmptyRoomsEditState() {
  return {
    isEditing: false,
    editingRoomId: null,
    editingRoomKey: null,
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

export function extractRoomEditableValues(room = {}) {
  return {
    name: room.name || '',
    description: room.description || '',
  };
}

export function hasRoomDraftChanged(draftValues = {}, originalValues = {}) {
  return normalizeDraftValue(draftValues.name) !== normalizeDraftValue(originalValues.name)
    || normalizeDraftValue(draftValues.description) !== normalizeDraftValue(originalValues.description);
}


export function createEmptyArtworksEditState() {
  return {
    isEditing: false,
    editingArtworkId: null,
    editingArtworkCode: null,
    editingRoomKey: null,
    editingCanonicalIndex: -1,
    editingBridgeStatus: '',
    editingSource: '',
    draftValues: {},
    originalValues: {},
    dirty: false,
    saving: false,
    mediaUploading: false,
    mediaUploadError: null,
    mediaUploadStatus: {},
    saveError: null,
    saveSuccess: null,
    validationErrors: {},
    validationWarnings: {},
  };
}

export function extractArtworkTextEditableValues(artwork = {}) {
  const realSize = artwork.realSize ?? artwork.real_size ?? '';
  return {
    title: artwork.title || '',
    subtitle: artwork.subtitle || '',
    description: artwork.description || '',
    content: artwork.content || '',
    author: artwork.author || '',
    artist: artwork.artist || artwork.author || '',
    year: artwork.year || '',
    material: artwork.material || '',
    realSize,
    real_size: realSize,
    note: artwork.note || '',
    imageUrl: artwork.imageUrl || artwork.image_url || artwork.image || artwork.src || artwork.url || '',
    thumbnailUrl: artwork.thumbnailUrl || artwork.thumbnail_url || artwork.thumbnail || '',
    posterUrl: artwork.posterUrl || artwork.poster_url || artwork.poster || '',
    videoUrl: artwork.videoUrl || artwork.video_url || '',
  };
}

export function hasArtworkTextDraftChanged(draftValues = {}, originalValues = {}) {
  const keys = ['title', 'subtitle', 'description', 'content', 'author', 'artist', 'year', 'material', 'realSize', 'real_size', 'note', 'imageUrl', 'thumbnailUrl', 'posterUrl', 'videoUrl'];
  return keys.some((key) => normalizeDraftValue(draftValues[key]) !== normalizeDraftValue(originalValues[key]));
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
    publishLastVerifiedAt: null,
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
  return setStaticCmsDraftState({
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
    publishLastVerifiedAt: null,
  });
}

export function resetStaticCmsDraftToBaseline(validation = null) {
  const current = state.staticCmsDraft || createEmptyStaticCmsDraftState();
  const baseline = structuredCloneSafe(current.baselineJson || {});
  const selectedRoom = current.selectedRoom || getFirstStaticCmsRoom(baseline) || 'indoor';
  const selectedItemCode = getFirstStaticCmsItemCode(baseline, selectedRoom);
  return setStaticCmsDraftState({
    draftJson: baseline,
    selectedRoom,
    selectedItemCode,
    dirty: false,
    validation: validation || current.validation,
    previewField: '',
    exportError: null,
    exportSuccess: 'Đã reset draft về baseline CMS hiện tại.',
    lastExportName: '',
    currentDraftId: '',
    draftTitle: createDefaultStaticCmsDraftTitle(baseline),
    draftTitleTouched: false,
    draftNote: '',
    draftSaveStatus: '',
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
    rollbackStatus: '',
    isRollingBack: false,
  });
}


export function createEmptyStorageCleanupState() {
  return {
    scope: 'all',
    retentionDays: 30,
    keepLastVersions: 20,
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
    currentState.roomsEdit?.isEditing ? { type: 'room', id: String(currentState.roomsEdit.editingRoomId || currentState.roomsEdit.editingRoomKey || 'room'), key: currentState.roomsEdit.editingRoomKey || '', label: 'Phòng trưng bày', dirty: Boolean(currentState.roomsEdit.dirty), saving: Boolean(currentState.roomsEdit.saving) } : null,
    currentState.artworksEdit?.isEditing ? { type: 'artwork', id: String(currentState.artworksEdit.editingArtworkId || currentState.artworksEdit.editingArtworkCode || 'artwork'), key: currentState.artworksEdit.editingArtworkCode || '', label: 'Tác phẩm', dirty: Boolean(currentState.artworksEdit.dirty), saving: Boolean(currentState.artworksEdit.saving) } : null,
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
    roomsEdit: createEmptyRoomsEditState(),
    artworksEdit: createEmptyArtworksEditState(),
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

export function resetRoomDraftToOriginal() {
  const current = state.roomsEdit || createEmptyRoomsEditState();
  if (!current.isEditing) return state;
  return setState({ roomsEdit: restoreDraftFromOriginal(current) });
}

export function resetArtworkTextDraftToOriginal() {
  const current = state.artworksEdit || createEmptyArtworksEditState();
  if (!current.isEditing) return state;
  return setState({ artworksEdit: restoreDraftFromOriginal(current) });
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
