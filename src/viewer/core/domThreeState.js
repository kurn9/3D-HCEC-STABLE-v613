const statusEl = document.getElementById('status');
const loadingWrap = document.getElementById('loadingWrap');
const loadingBar = document.getElementById('loadingBar');
const crosshair = document.getElementById('crosshair');
const startHint = document.getElementById('startHint');
const focusCard = document.getElementById('focusCard');
const focusTitle = document.getElementById('focusTitle');
const focusSub = document.getElementById('focusSub');

const modalOverlay = document.getElementById('modalOverlay');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalImage = document.getElementById('modalImage');
const modalBadge = document.getElementById('modalBadge');
const modalTag = document.getElementById('modalTag');
const modalTitle = document.getElementById('modalTitle');
const modalShortDesc = document.getElementById('modalShortDesc');
const metaAuthor = document.getElementById('metaAuthor');
const metaYear = document.getElementById('metaYear');
const metaMedium = document.getElementById('metaMedium');
const metaRealSize = document.getElementById('metaRealSize');
const modalContent = document.getElementById('modalContent');
const openImageBtn = document.getElementById('openImageBtn');

function isViewerMobileFastLoad() {
  const mobileCfg = CONFIG?.mobile || {};
  const device = window.viewerMobileDevice;
  const mobile = Boolean(device?.isMobileViewer?.()) || Boolean(window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches);
  return Boolean(mobileCfg.enabled !== false && mobileCfg.fastFirstLoad !== false && mobile);
}

function getInitialViewerPixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  const qualityMax = typeof window.getViewerQualityMaxDpr === 'function' ? window.getViewerQualityMaxDpr() : Number(CONFIG?.maxPixelRatio || 2);
  if (isViewerMobileFastLoad()) {
    const cfg = CONFIG.mobile || {};
    const initial = Number(cfg.fastLoadInitialPixelRatio || 1.0);
    return Math.max(0.75, Math.min(dpr, initial, qualityMax));
  }
  return Math.min(dpr, qualityMax);
}

window.isViewerMobileFastLoad = isViewerMobileFastLoad;
window.viewerMobileDprState = window.viewerMobileDprState || { upgraded: false };

function isViewerMobileQualityDevice() {
  const device = window.viewerMobileDevice;
  return Boolean(
    device?.isMobileViewer?.()
    || window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
  );
}

function chooseViewerMobileQualityProfileName() {
  const profiles = CONFIG?.mobileQualityProfiles || {};
  if (!isViewerMobileQualityDevice() || !profiles.low || !profiles.mid || !profiles.high) return 'desktop';

  const memory = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  const dpr = Number(window.devicePixelRatio || 1);
  const longEdge = Math.max(window.innerWidth || 0, window.innerHeight || 0);
  const shortEdge = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  const tabletLike = Boolean(window.viewerMobileDevice?.isTabletLike?.()) || longEdge >= 1024 && shortEdge >= 700;

  if ((memory && memory <= 4) || (cores && cores <= 4) || dpr >= 3.2 || longEdge <= 812) return 'low';
  if (tabletLike && (memory >= 8 || cores >= 8) && dpr <= 2.5) return 'high';
  if ((memory && memory >= 8) && (cores && cores >= 8) && dpr <= 2.25) return 'high';
  return 'mid';
}

function getViewerQualityProfileByName(name) {
  const profiles = CONFIG?.mobileQualityProfiles || {};
  return name && profiles[name] ? profiles[name] : null;
}

function calculateViewerAdaptiveMaxDpr(profile, adaptiveLevel = 0) {
  const adaptive = CONFIG?.adaptiveQuality || {};
  const base = Number(profile?.maxDpr || CONFIG?.mobile?.maxPixelRatio || CONFIG?.maxPixelRatio || 1.25);
  const step = Math.max(0.05, Number(adaptive.dprStep || 0.25));
  const minDpr = Math.max(0.5, Number(adaptive.minDpr || 0.75));
  return Math.max(minDpr, base - Math.max(0, adaptiveLevel) * step);
}

function configureInitialViewerQualityProfile() {
  const profileName = chooseViewerMobileQualityProfileName();
  const profile = getViewerQualityProfileByName(profileName);
  const isMobile = profileName !== 'desktop' && Boolean(profile);
  const adaptiveLevel = Number(window.__viewerQuality?.adaptiveLevel || 0);
  const maxDpr = isMobile ? calculateViewerAdaptiveMaxDpr(profile, adaptiveLevel) : Number(CONFIG?.maxPixelRatio || 2);

  const state = {
    isMobile,
    device: isMobile ? 'mobile' : 'desktop',
    profileName,
    profile: profile || null,
    adaptiveLevel: isMobile ? adaptiveLevel : 0,
    maxDpr,
    dpr: Math.min(window.devicePixelRatio || 1, maxDpr),
    videoPreviewMode: profile?.videoPreview || 'default',
    minimapFps: profile?.minimapFps || null,
    artworkProbeFps: profile?.artworkProbeFps || null,
    raycastFps: profile?.raycastFps || null,
    videoAutoplayMax: Number.isFinite(Number(profile?.videoAutoplayMax)) ? Number(profile.videoAutoplayMax) : null,
    reason: window.__viewerQuality?.reason || 'initial',
    appliedAt: performance?.now?.() || Date.now()
  };

  window.__viewerQuality = state;

  if (isMobile && CONFIG.mobile) {
    if (!window.__viewerQualityBaseline) {
      window.__viewerQualityBaseline = {
        mobileMaxPixelRatio: Number(CONFIG.mobile.maxPixelRatio || maxDpr),
        tabletMaxPixelRatio: Number(CONFIG.mobile.tabletMaxPixelRatio || maxDpr)
      };
    }
    const baseline = window.__viewerQualityBaseline;
    CONFIG.mobile.activeQualityProfile = profileName;
    CONFIG.mobile.maxPixelRatio = Math.min(Number(baseline.mobileMaxPixelRatio || maxDpr), maxDpr);
    CONFIG.mobile.tabletMaxPixelRatio = Math.min(Number(baseline.tabletMaxPixelRatio || maxDpr), maxDpr);
    if (Number.isFinite(Number(profile.avatarModelDeferredLoadMs))) {
      CONFIG.mobile.avatarModelDeferredLoadMs = Math.max(Number(CONFIG.mobile.avatarModelDeferredLoadMs || 0), Number(profile.avatarModelDeferredLoadMs));
    }
    if (Number.isFinite(Number(profile.artworkBatchSize))) {
      CONFIG.mobile.artworkBatchSize = Math.min(Number(CONFIG.mobile.artworkBatchSize || profile.artworkBatchSize), Number(profile.artworkBatchSize));
    }
    if (Number.isFinite(Number(profile.artworkBatchDelayMs))) {
      CONFIG.mobile.artworkBatchDelayMs = Math.max(Number(CONFIG.mobile.artworkBatchDelayMs || 0), Number(profile.artworkBatchDelayMs));
    }
  }

  return state;
}

function applyViewerQualityProfile(reason = 'manual') {
  const state = configureInitialViewerQualityProfile();
  state.reason = reason;
  const rendererRef = window.__viewerRenderer;
  if (rendererRef && typeof rendererRef.setPixelRatio === 'function') {
    const nextDpr = Math.min(window.devicePixelRatio || 1, state.maxDpr);
    rendererRef.setPixelRatio(nextDpr);
    state.dpr = nextDpr;
  }
  return state;
}

function setViewerAdaptiveQualityLevel(level, reason = 'adaptive') {
  const adaptive = CONFIG?.adaptiveQuality || {};
  const maxLevel = Math.max(0, Number(adaptive.maxAdaptiveLevel || 2));
  const nextLevel = Math.max(0, Math.min(maxLevel, Math.round(Number(level) || 0)));
  const current = window.__viewerQuality || configureInitialViewerQualityProfile();
  if (!current.isMobile) return current;
  if (current.adaptiveLevel === nextLevel && current.reason === reason) return current;
  current.adaptiveLevel = nextLevel;
  current.reason = reason;
  window.__viewerQuality = current;
  return applyViewerQualityProfile(reason);
}

function getViewerQualityState() {
  return window.__viewerQuality || configureInitialViewerQualityProfile();
}

function getViewerQualityMaxDpr() {
  return getViewerQualityState().maxDpr || Number(CONFIG?.maxPixelRatio || 2);
}

window.getViewerQualityState = getViewerQualityState;
window.applyViewerQualityProfile = applyViewerQualityProfile;
window.setViewerAdaptiveQualityLevel = setViewerAdaptiveQualityLevel;
window.getViewerQualityMaxDpr = getViewerQualityMaxDpr;
configureInitialViewerQualityProfile();

function applyMobileFastLoadPixelRatioConfig() {
  if (!isViewerMobileFastLoad() || !CONFIG.mobile) return;
  const cfg = CONFIG.mobile;
  const initial = Math.max(0.75, Number(cfg.fastLoadInitialPixelRatio || 1.0));
  window.viewerMobileDprState.originalMaxPixelRatio = Number(cfg.maxPixelRatio || 1.25);
  window.viewerMobileDprState.originalTabletMaxPixelRatio = Number(cfg.tabletMaxPixelRatio || 1.5);
  cfg.maxPixelRatio = Math.min(window.viewerMobileDprState.originalMaxPixelRatio, initial);
  cfg.tabletMaxPixelRatio = Math.min(window.viewerMobileDprState.originalTabletMaxPixelRatio, initial);
}

function scheduleMobilePixelRatioUpgrade(delayOverride) {
  if (!isViewerMobileFastLoad() || !CONFIG.mobile) return;
  const state = window.viewerMobileDprState || {};
  if (state.upgraded || state.upgradeScheduled) return;
  state.upgradeScheduled = true;
  window.viewerMobileDprState = state;

  const cfg = CONFIG.mobile;
  const delay = Number.isFinite(delayOverride) ? delayOverride : Number(cfg.fastLoadUpgradePixelRatioAfterMs || 20000);
  window.setTimeout(() => {
    if (!isViewerMobileFastLoad() || state.upgraded) return;
    const upgradeMax = Math.max(1, Number(cfg.fastLoadUpgradePixelRatio || 1.25));
    cfg.maxPixelRatio = Math.min(Number(state.originalMaxPixelRatio || 1.25), upgradeMax);
    cfg.tabletMaxPixelRatio = Math.min(Number(state.originalTabletMaxPixelRatio || 1.5), Math.max(upgradeMax, 1.25));
    state.upgraded = true;
    window.applyViewerQualityProfile?.('fast-load-upgrade');
    if (typeof window.resizeViewerForMobileViewport === 'function') {
      window.resizeViewerForMobileViewport();
    } else if (window.__viewerRenderer) {
      window.__viewerRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.getViewerQualityMaxDpr?.() || cfg.maxPixelRatio));
    }
  }, Math.max(8000, delay));
}

applyMobileFastLoadPixelRatioConfig();
window.scheduleMobilePixelRatioUpgrade = scheduleMobilePixelRatioUpgrade;

const DEFAULT_VIEWER_LIGHTING_PROFILE = {
  rendererExposure: 1.08,
  hemisphereSkyColor: 0xffffff,
  hemisphereGroundColor: 0x40495a,
  hemisphereIntensity: 1.20,
  ambientColor: 0xffffff,
  ambientIntensity: 0.16,
  keyLightColor: 0xffffff,
  keyLightIntensity: 1.62,
  keyLightPosition: [6, 10, 5],
  fillLightColor: 0xbfd9ff,
  fillLightIntensity: 0.56,
  fillLightPosition: [-6, 6, -5],
  indoorFillColor: 0xfff2d4,
  indoorFillIntensity: 0.0,
  indoorFillPosition: [0, 4.2, 2.8],
  localFills: [],
  localFillBoundsPadding: 0.06,
  materialDebugMaxItems: 24,
  materialDebugRiskKeywords: ['wall', 'floor', 'ceiling', 'corridor', 'room', 'interior', 'panel', 'black', 'dark', 'metal', 'plaster'],
  materialLift: {
    enabled: false,
    roomIds: ['indoor'],
    meshKeywords: [],
    materialKeywords: [],
    maxMetalness: 0.35,
    minRoughness: 0.62,
    minEnvMapIntensity: 0.18
  },
  debugLightProfile: false,
  debugMaterialProfile: false
};

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function toThreeColor(value, fallback) {
  const color = new THREE.Color(fallback);
  if (value === undefined || value === null) return color;
  try {
    color.set(value);
  } catch {
    color.set(fallback);
  }
  return color;
}

function toVector3(value, fallback) {
  const source = Array.isArray(value) && value.length >= 3 ? value : fallback;
  return new THREE.Vector3(
    Number(source[0]) || 0,
    Number(source[1]) || 0,
    Number(source[2]) || 0
  );
}

function normalizeRoomLightingContext(context) {
  if (!context || typeof context !== 'object') return null;

  let box = context.box || null;
  if (box && typeof box.clone === 'function') box = box.clone();
  else if (context.model && typeof THREE.Box3 === 'function') {
    try {
      box = new THREE.Box3().setFromObject(context.model);
    } catch {
      box = null;
    }
  }

  if (!box || !Number.isFinite(box.min?.x) || !Number.isFinite(box.max?.x)) return null;

  const size = context.size?.clone?.() || box.getSize(new THREE.Vector3());
  const center = context.center?.clone?.() || box.getCenter(new THREE.Vector3());

  return {
    model: context.model || null,
    box,
    size,
    center,
    roomId: context.roomId || CONFIG?.currentRoomId || 'unknown'
  };
}

function resolveBoundsRelativeVector(spec, key, fallbackKey, context, fallback) {
  const ratio = Array.isArray(spec?.[key]) ? spec[key] : null;
  const ctx = context || viewerLightingState.roomContext;
  if (String(spec?.mode || '').toLowerCase() === 'boundsrelative' && ratio && ctx?.box) {
    const padding = clampNumber(spec.boundsPadding ?? ctx.boundsPadding ?? CONFIG?.lightingProfile?.localFillBoundsPadding, 0, 0.4, 0.06);
    const min = ctx.box.min;
    const max = ctx.box.max;
    const spanX = max.x - min.x;
    const spanY = max.y - min.y;
    const spanZ = max.z - min.z;

    const x = min.x + spanX * clampNumber(ratio[0], 0 - padding, 1 + padding, 0.5);
    const y = min.y + spanY * clampNumber(ratio[1], 0 - padding, 1 + padding, 0.55);
    const z = min.z + spanZ * clampNumber(ratio[2], 0 - padding, 1 + padding, 0.35);
    return new THREE.Vector3(x, y, z);
  }

  return toVector3(spec?.[fallbackKey] || spec?.position || spec?.target, fallback);
}

function readViewerQueryFlag(...names) {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return names.some((name) => {
      if (!name) return false;
      const value = params.get(name);
      return value === '1' || value === 'true' || value === 'yes';
    });
  } catch {
    return false;
  }
}

function isViewerLightingDebugEnabled() {
  return Boolean(
    CONFIG?.debugLightingProfile ||
    CONFIG?.lightingProfile?.debugLightProfile ||
    CONFIG?.debugPerformance ||
    readViewerQueryFlag(CONFIG?.debugLightingQueryParam || 'debugLighting', 'debugLight', 'debugPerf')
  );
}

function isViewerRoomDebugEnabled() {
  return Boolean(
    CONFIG?.debugRoomModel ||
    readViewerQueryFlag(CONFIG?.debugRoomQueryParam || 'debugRoom', 'debugRoomModel', 'debugLighting')
  );
}

function normalizeLocalFills(localFills) {
  return Array.isArray(localFills)
    ? localFills.filter((fill) => fill && typeof fill === 'object')
    : [];
}

function getViewerLightingProfile(overrides = {}) {
  const base = {
    ...DEFAULT_VIEWER_LIGHTING_PROFILE,
    ...(CONFIG?.lightingProfile || {}),
    ...(overrides || {})
  };
  return {
    ...base,
    localFills: normalizeLocalFills(base.localFills)
  };
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x121317);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, CONFIG.eyeHeight, 5);
camera.rotation.order = 'YXZ';

const initialQuality = typeof window.getViewerQualityState === 'function' ? window.getViewerQualityState() : null;
const renderer = new THREE.WebGLRenderer({
  antialias: initialQuality?.isMobile ? initialQuality?.profile?.antialias !== false : true,
  powerPreference: 'high-performance'
});
window.__viewerRenderer = renderer;
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(getInitialViewerPixelRatio());
window.applyViewerQualityProfile?.('renderer-init');
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const viewerLightingState = {
  profile: null,
  hemiLight: null,
  ambientLight: null,
  keyLight: null,
  fillLight: null,
  indoorFillLight: null,
  localFillEntries: [],
  roomContext: null
};

function disposeLocalFillEntry(entry) {
  if (!entry) return;
  if (entry.light) scene.remove(entry.light);
  if (entry.target) scene.remove(entry.target);
}

function createLocalFillLight(spec) {
  const type = String(spec.type || 'point').toLowerCase();
  let light;
  let target = null;

  if (type === 'spot') {
    light = new THREE.SpotLight(0xffffff, 0);
    light.angle = clampNumber(spec.angle, 0.12, Math.PI / 2, 0.72);
    light.penumbra = clampNumber(spec.penumbra, 0, 1, 0.65);
    target = new THREE.Object3D();
    target.name = `${spec.name || 'viewer-local-fill'}-target`;
    scene.add(target);
    light.target = target;
  } else if (type === 'directional') {
    light = new THREE.DirectionalLight(0xffffff, 0);
    target = new THREE.Object3D();
    target.name = `${spec.name || 'viewer-local-fill'}-target`;
    scene.add(target);
    light.target = target;
  } else {
    light = new THREE.PointLight(0xffffff, 0);
  }

  light.name = spec.name || `viewer-local-fill-${viewerLightingState.localFillEntries.length + 1}`;
  light.userData.viewerManagedLocalFill = true;
  scene.add(light);
  return { type, light, target };
}

function updateLocalFillEntry(entry, spec, context = viewerLightingState.roomContext) {
  const light = entry.light;
  const fallbackColor = spec.type === 'point' ? 0xfff0d2 : 0xffffff;
  light.name = spec.name || light.name || 'viewer-local-fill';
  light.color.copy(toThreeColor(spec.color, fallbackColor));
  light.intensity = clampNumber(spec.intensity, 0, 4.0, 0);
  light.position.copy(resolveBoundsRelativeVector(spec, 'positionRatio', 'fallbackPosition', context, [0, 3, -7]));
  light.visible = light.intensity > 0.001;

  if ('distance' in light) light.distance = clampNumber(spec.distance, 0, 120, 18);
  if ('decay' in light) light.decay = clampNumber(spec.decay, 0, 3, 1.5);
  if ('angle' in light) light.angle = clampNumber(spec.angle, 0.12, Math.PI / 2, 0.72);
  if ('penumbra' in light) light.penumbra = clampNumber(spec.penumbra, 0, 1, 0.65);

  if (entry.target) {
    entry.target.position.copy(resolveBoundsRelativeVector(spec, 'targetRatio', 'fallbackTarget', context, [0, 1.8, -12]));
    entry.target.updateMatrixWorld(true);
  }

  light.userData.viewerLocalFillSpec = {
    mode: spec.mode || 'absolute',
    positionRatio: spec.positionRatio || null,
    targetRatio: spec.targetRatio || null
  };
}

function syncLocalFillLights(profile, context = viewerLightingState.roomContext) {
  const fills = normalizeLocalFills(profile.localFills);
  const entries = viewerLightingState.localFillEntries;

  fills.forEach((spec, index) => {
    const type = String(spec.type || 'point').toLowerCase();
    let entry = entries[index];
    if (!entry || entry.type !== type) {
      disposeLocalFillEntry(entry);
      entry = createLocalFillLight(spec);
      entries[index] = entry;
    }
    updateLocalFillEntry(entry, spec, context);
  });

  for (let index = fills.length; index < entries.length; index += 1) {
    disposeLocalFillEntry(entries[index]);
  }
  entries.length = fills.length;
}

function applyViewerLightingProfile(overrides = {}, reason = 'manual', roomContext = null) {
  const normalizedContext = normalizeRoomLightingContext(roomContext);
  if (normalizedContext) {
    normalizedContext.boundsPadding = clampNumber(overrides?.localFillBoundsPadding ?? CONFIG?.lightingProfile?.localFillBoundsPadding, 0, 0.4, 0.06);
    viewerLightingState.roomContext = normalizedContext;
  }
  const profile = getViewerLightingProfile(overrides);
  renderer.toneMappingExposure = clampNumber(profile.rendererExposure, 0.65, 1.75, 1.08);

  if (!viewerLightingState.hemiLight) {
    viewerLightingState.hemiLight = new THREE.HemisphereLight(0xffffff, 0x40495a, 1);
    scene.add(viewerLightingState.hemiLight);
  }
  viewerLightingState.hemiLight.color.copy(toThreeColor(profile.hemisphereSkyColor, 0xffffff));
  viewerLightingState.hemiLight.groundColor.copy(toThreeColor(profile.hemisphereGroundColor, 0x40495a));
  viewerLightingState.hemiLight.intensity = clampNumber(profile.hemisphereIntensity, 0, 2.4, 1.2);

  if (!viewerLightingState.ambientLight) {
    viewerLightingState.ambientLight = new THREE.AmbientLight(0xffffff, 0);
    scene.add(viewerLightingState.ambientLight);
  }
  viewerLightingState.ambientLight.color.copy(toThreeColor(profile.ambientColor, 0xffffff));
  viewerLightingState.ambientLight.intensity = clampNumber(profile.ambientIntensity, 0, 0.65, 0.16);
  viewerLightingState.ambientLight.visible = viewerLightingState.ambientLight.intensity > 0.001;

  if (!viewerLightingState.keyLight) {
    viewerLightingState.keyLight = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(viewerLightingState.keyLight);
  }
  viewerLightingState.keyLight.color.copy(toThreeColor(profile.keyLightColor, 0xffffff));
  viewerLightingState.keyLight.intensity = clampNumber(profile.keyLightIntensity, 0, 2.8, 1.62);
  viewerLightingState.keyLight.position.copy(toVector3(profile.keyLightPosition, [6, 10, 5]));

  if (!viewerLightingState.fillLight) {
    viewerLightingState.fillLight = new THREE.DirectionalLight(0xbfd9ff, 1);
    scene.add(viewerLightingState.fillLight);
  }
  viewerLightingState.fillLight.color.copy(toThreeColor(profile.fillLightColor, 0xbfd9ff));
  viewerLightingState.fillLight.intensity = clampNumber(profile.fillLightIntensity, 0, 1.6, 0.56);
  viewerLightingState.fillLight.position.copy(toVector3(profile.fillLightPosition, [-6, 6, -5]));
  viewerLightingState.fillLight.visible = viewerLightingState.fillLight.intensity > 0.001;

  if (!viewerLightingState.indoorFillLight) {
    viewerLightingState.indoorFillLight = new THREE.DirectionalLight(0xfff2d4, 0);
    scene.add(viewerLightingState.indoorFillLight);
  }
  viewerLightingState.indoorFillLight.color.copy(toThreeColor(profile.indoorFillColor, 0xfff2d4));
  viewerLightingState.indoorFillLight.intensity = clampNumber(profile.indoorFillIntensity, 0, 1.2, 0);
  viewerLightingState.indoorFillLight.position.copy(toVector3(profile.indoorFillPosition, [0, 4.2, 2.8]));
  viewerLightingState.indoorFillLight.visible = viewerLightingState.indoorFillLight.intensity > 0.001;

  syncLocalFillLights(profile, viewerLightingState.roomContext);

  viewerLightingState.profile = profile;
  window.__viewerLightingState = viewerLightingState;

  if (isViewerLightingDebugEnabled() || profile.debugLightProfile) {
    console.info('[lighting] profile applied', {
      reason,
      room: CONFIG?.currentRoomId || 'unknown',
      exposure: renderer.toneMappingExposure,
      hemisphere: viewerLightingState.hemiLight.intensity,
      ambient: viewerLightingState.ambientLight.intensity,
      key: viewerLightingState.keyLight.intensity,
      fill: viewerLightingState.fillLight.intensity,
      indoorFill: viewerLightingState.indoorFillLight.intensity,
      localFills: viewerLightingState.localFillEntries.map((entry) => ({
        name: entry.light?.name,
        type: entry.type,
        intensity: entry.light?.intensity,
        position: entry.light?.position?.toArray?.(),
        target: entry.target?.position?.toArray?.(),
        spec: entry.light?.userData?.viewerLocalFillSpec || null
      })),
      bounds: viewerLightingState.roomContext ? {
        min: viewerLightingState.roomContext.box.min.toArray(),
        max: viewerLightingState.roomContext.box.max.toArray(),
        size: viewerLightingState.roomContext.size.toArray(),
        center: viewerLightingState.roomContext.center.toArray()
      } : null
    });
  }
}

function setViewerRoomLightingContext(context, reason = 'room-context') {
  const normalized = normalizeRoomLightingContext(context);
  if (!normalized) return null;
  normalized.boundsPadding = clampNumber(CONFIG?.lightingProfile?.localFillBoundsPadding, 0, 0.4, 0.06);
  viewerLightingState.roomContext = normalized;
  applyViewerLightingProfile({}, reason, normalized);
  return normalized;
}

window.applyViewerLightingProfile = applyViewerLightingProfile;
window.setViewerRoomLightingContext = setViewerRoomLightingContext;
window.isViewerRoomDebugEnabled = isViewerRoomDebugEnabled;
window.isViewerLightingDebugEnabled = isViewerLightingDebugEnabled;
applyViewerLightingProfile({}, 'init');

const clock = new THREE.Clock();
const keys = {};
let isLocked = false;
let yaw = 0;
let pitch = 0;
let targetYaw = 0;
let targetPitch = 0;
let roomLoaded = false;
let artworksLoaded = false;
let fallbackFloorY = 0;
let artworkProbeTimer = 0;
let modalOpen = false;

// Avatar state
let viewMode = 'third'; // 'third' = thấy avatar, 'first' = góc nhìn người xem
let avatar = null;
let avatarTargetYaw = 0;
let avatarVelocity = new THREE.Vector3();
let smoothedMoveSpeed = 0;

let avatarMixer = null;
let roomAnimationMixer = null;
let roomAnimationActions = [];
let avatarActions = {};
let currentAvatarAction = null;
let currentAvatarActionName = null;
let avatarMotionState = 'idle';
let avatarModelLoaded = false;

const cameraDesiredPosition = new THREE.Vector3();
const cameraLookTarget = new THREE.Vector3();

const mouseNdc = new THREE.Vector2(2, 2);
const downVector = new THREE.Vector3(0, -1, 0);
const groundRaycaster = new THREE.Raycaster();
const wallRaycaster = new THREE.Raycaster();
const cameraCollisionRaycaster = new THREE.Raycaster();
const artRaycaster = new THREE.Raycaster();

const walkableObjects = [];
const rampWalkableObjects = [];
const colliderObjects = [];
const blockingObjects = [];
const wallFallbackObjects = [];
const blockingBoxes = [];
const colliderBoxes = [];
const seatObjects = [];
const seatPoints = [];
const seatBoxes = [];
const interactiveArtworkMeshes = [];
const artworkRoots = [];

let currentFocusedRoot = null;
let hoveredRoot = null;
let openedRoot = null;

let isSitting = false;
let activeSeat = null;
let lastStandingPosition = new THREE.Vector3();

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');
const gltfLoader = new GLTFLoader();
