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


// v6.13.021 — Debug-only mobile runtime instrumentation and on-screen evidence overlay.
// The probe is never created unless ?debugMobilePerf=1 is present.
function createMobilePerfProbeV613021() {
  let enabled = false;
  try {
    enabled = new URLSearchParams(window.location.search || '').get('debugMobilePerf') === '1';
  } catch (_) {}
  if (!enabled) return null;

  const STORAGE_KEY = 'mobilePerfLastSnapshot';
  const MAX_EVENTS = 200;
  const startedAt = performance.now();
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const params = new URLSearchParams(window.location.search || '');
  const room = String(params.get('room') || CONFIG?.currentRoomId || 'indoor').toLowerCase();
  const navigationEntry = performance.getEntriesByType?.('navigation')?.[0] || null;
  const previousSnapshot = (() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.sessionId !== sessionId ? parsed : null;
    } catch (_) {
      return null;
    }
  })();

  const events = [];
  const onceMilestones = new Set();
  const boundCinemaVideos = new WeakSet();
  const state = {
    room,
    lastMilestone: 'initializing',
    lastElapsedMs: 0,
    currentElapsedMs: 0,
    lastOverlayUpdateAt: 0,
    lastHeartbeatPersistAt: 0,
    avatar: 'not-started',
    video: 'idle',
    webgl: 'unknown',
    lifecycle: document.visibilityState || 'visible',
    currentResource: 'viewer scripts',
    previous: previousSnapshot,
    collapsed: false,
    cinemaOpen: false,
    overlay: null,
    bodyEl: null,
    toggleButton: null,
    copyButton: null,
    resourceObserver: null,
    bodyClassObserver: null,
    bodyChildObserver: null,
    lastResizeLogAt: 0,
    lastVisualResizeLogAt: 0
  };

  function compactValue(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value.slice(0, 180);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= 2) return String(value).slice(0, 180);
    if (Array.isArray(value)) return value.slice(0, 8).map((item) => compactValue(item, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      Object.entries(value).slice(0, 24).forEach(([key, item]) => {
        if (typeof item === 'function') return;
        out[key] = compactValue(item, depth + 1);
      });
      return out;
    }
    return String(value).slice(0, 180);
  }

  function getQualityState() {
    try {
      return window.getViewerQualityState?.() || window.__viewerQuality || null;
    } catch (_) {
      return window.__viewerQuality || null;
    }
  }

  function getRendererSnapshot() {
    const rendererRef = window.__viewerRenderer;
    const info = rendererRef?.info;
    const canvas = rendererRef?.domElement;
    let pixelRatio = null;
    try { pixelRatio = rendererRef?.getPixelRatio?.() ?? null; } catch (_) {}
    return {
      geometries: Number(info?.memory?.geometries ?? 0),
      textures: Number(info?.memory?.textures ?? 0),
      calls: Number(info?.render?.calls ?? 0),
      triangles: Number(info?.render?.triangles ?? 0),
      programs: Array.isArray(info?.programs) ? info.programs.length : null,
      canvas: canvas ? `${canvas.width}x${canvas.height}` : null,
      pixelRatio
    };
  }

  function getBaseSnapshot() {
    const quality = getQualityState();
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    let effectiveDpr = null;
    try { effectiveDpr = window.__viewerRenderer?.getPixelRatio?.() ?? null; } catch (_) {}
    return {
      room: state.room,
      mobile: Boolean(
        window.viewerMobileDevice?.isMobileViewer?.()
        || quality?.isMobile
        || window.matchMedia?.('(pointer: coarse)')?.matches
      ),
      profile: quality?.profileName || CONFIG?.mobile?.activeQualityProfile || 'unknown',
      dpr: Number(window.devicePixelRatio || 1),
      effectiveDpr,
      viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
      visualViewport: window.visualViewport
        ? `${Math.round(window.visualViewport.width)}x${Math.round(window.visualViewport.height)}`
        : null,
      deviceMemory: navigator.deviceMemory ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      connection: connection?.effectiveType || null,
      saveData: Boolean(connection?.saveData),
      visibility: document.visibilityState || 'unknown',
      navigationType: navigationEntry?.type || 'unknown',
      userAgent: String(navigator.userAgent || '').slice(0, 120)
    };
  }

  function getTrackedResources() {
    const pattern = /(room_base|room_outdoor|visitor\.glb|intro\.mp4|scene(?:_outdoor)?\.json|cms_public_content\.generated\.json|\/src\/.*\.js(?:\?|$)|\/styles\/.*\.css(?:\?|$))/i;
    return (performance.getEntriesByType?.('resource') || [])
      .filter((entry) => pattern.test(String(entry.name || '')))
      .map((entry) => {
        const rawName = String(entry.name || '');
        let shortName = rawName;
        try {
          const url = new URL(rawName, window.location.href);
          shortName = url.pathname.split('/').filter(Boolean).slice(-3).join('/');
        } catch (_) {}
        return {
          name: shortName.slice(0, 120),
          initiatorType: entry.initiatorType || '',
          transferSize: Number(entry.transferSize || 0),
          encodedBodySize: Number(entry.encodedBodySize || 0),
          decodedBodySize: Number(entry.decodedBodySize || 0),
          duration: Number((entry.duration || 0).toFixed(1)),
          responseStart: Number((entry.responseStart || 0).toFixed(1)),
          responseEnd: Number((entry.responseEnd || 0).toFixed(1)),
          fetchStart: Number((entry.fetchStart || 0).toFixed(1)),
          nextHopProtocol: entry.nextHopProtocol || '',
          cacheHint: entry.transferSize === 0 && entry.decodedBodySize > 0
            ? 'cache-or-TAO'
            : (entry.transferSize > 0 ? 'network' : 'unknown')
        };
      });
  }

  function persistSnapshot() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        sessionId,
        timestamp: Date.now(),
        room: state.room,
        lastMilestone: state.lastMilestone,
        lastElapsedMs: state.lastElapsedMs,
      currentElapsedMs: state.currentElapsedMs,
        snapshotElapsedMs: state.currentElapsedMs,
        lastEvents: events.slice(-10).map((event) => ({ milestone: event.milestone, elapsedMs: event.elapsedMs })),
        url: `${window.location.pathname}${window.location.search}`,
        visibilityState: document.visibilityState || 'unknown',
        navigationType: navigationEntry?.type || 'unknown'
      }));
    } catch (_) {}
  }

  function updateSemanticState(milestone, data) {
    if (milestone.startsWith('avatar-')) state.avatar = milestone.replace(/^avatar-/, '');
    if (milestone.startsWith('video-')) state.video = milestone.replace(/^video-/, '');
    if (milestone.startsWith('cinema-')) state.video = milestone;
    if (milestone === 'webglcontextlost') state.webgl = 'lost';
    if (milestone === 'webglcontextrestored') state.webgl = 'restored';
    if (milestone === 'pagehide' || milestone === 'pageshow' || milestone === 'beforeunload' || milestone.startsWith('visibilitychange-') || milestone === 'freeze' || milestone === 'resume') {
      state.lifecycle = milestone;
    }
    if (data?.resource) {
      const status = data.resourceStatus ? ` · ${data.resourceStatus}` : '';
      state.currentResource = `${String(data.resource).slice(0, 78)}${status}`;
    }
  }

  function formatElapsed(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function renderOverlay() {
    if (!state.bodyEl) return;
    const quality = getQualityState();
    let effectiveDpr = null;
    try { effectiveDpr = window.__viewerRenderer?.getPixelRatio?.() ?? null; } catch (_) {}
    const previous = state.previous;
    const lines = [
      `room: ${state.room}`,
      `profile: ${quality?.profileName || CONFIG?.mobile?.activeQualityProfile || 'unknown'}`,
      `DPR: ${Number(window.devicePixelRatio || 1).toFixed(2)} / ${effectiveDpr === null ? '—' : Number(effectiveDpr).toFixed(2)}`,
      `viewport: ${window.innerWidth || 0}×${window.innerHeight || 0}`,
      `elapsed: ${formatElapsed(state.currentElapsedMs || state.lastElapsedMs)}`,
      `last: ${state.lastMilestone}`,
      `avatar: ${state.avatar}`,
      `video: ${state.video}`,
      `WebGL: ${state.webgl}`,
      `lifecycle: ${state.lifecycle}`,
      `resource: ${state.currentResource || '—'}`
    ];
    if (previous) {
      const previousSnapshotElapsed = Math.round(previous.snapshotElapsedMs || previous.lastElapsedMs || 0);
      lines.push(`Previous: ${previous.lastMilestone || 'unknown'} at ${Math.round(previous.lastElapsedMs || 0)}ms`);
      if (previousSnapshotElapsed > Number(previous.lastElapsedMs || 0) + 1000) {
        lines.push(`Previous snapshot: ${previousSnapshotElapsed}ms`);
      }
    }
    state.bodyEl.textContent = lines.join('\n');
    state.overlay?.classList.toggle('is-collapsed', state.collapsed);
    if (state.toggleButton) {
      state.toggleButton.textContent = state.collapsed ? '+' : '−';
      state.toggleButton.setAttribute('aria-expanded', String(!state.collapsed));
      state.toggleButton.title = state.collapsed ? 'Mở debug' : 'Thu gọn debug';
    }
  }

  function makeCopySummary() {
    const quality = getQualityState();
    let effectiveDpr = null;
    try { effectiveDpr = window.__viewerRenderer?.getPixelRatio?.() ?? null; } catch (_) {}
    return [
      `MobilePerf room=${state.room}`,
      `profile=${quality?.profileName || CONFIG?.mobile?.activeQualityProfile || 'unknown'}`,
      `dpr=${window.devicePixelRatio || 1}/${effectiveDpr ?? 'unknown'}`,
      `viewport=${window.innerWidth || 0}x${window.innerHeight || 0}`,
      `elapsedMs=${Math.round(state.currentElapsedMs || state.lastElapsedMs)}`,
      `last=${state.lastMilestone}`,
      `avatar=${state.avatar}`,
      `video=${state.video}`,
      `webgl=${state.webgl}`,
      `lifecycle=${state.lifecycle}`,
      `resource=${state.currentResource || 'unknown'}`,
      state.previous ? `previous=${state.previous.lastMilestone || 'unknown'}@${Math.round(state.previous.lastElapsedMs || 0)}ms` : ''
    ].filter(Boolean).join('\n');
  }

  function createOverlay() {
    const style = document.createElement('style');
    style.id = 'mobilePerfOverlayStyle';
    style.textContent = `
      #mobilePerfOverlay {
        position: fixed;
        top: max(8px, env(safe-area-inset-top));
        left: max(8px, env(safe-area-inset-left));
        z-index: 2147483000;
        width: min(292px, calc(100vw - 16px));
        color: #f4f8ff;
        background: rgba(5, 10, 18, .88);
        border: 1px solid rgba(122, 224, 255, .42);
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, .28);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        font: 600 10px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        pointer-events: auto;
        user-select: text;
        overflow: hidden;
      }
      #mobilePerfOverlay .mobile-perf-head {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 7px;
        border-bottom: 1px solid rgba(122, 224, 255, .20);
        background: rgba(14, 29, 43, .88);
      }
      #mobilePerfOverlay .mobile-perf-title { flex: 1; color: #9cecff; font-weight: 800; letter-spacing: .02em; }
      #mobilePerfOverlay button {
        min-width: 26px;
        height: 24px;
        padding: 0 7px;
        border: 1px solid rgba(156, 236, 255, .32);
        border-radius: 6px;
        color: #f4f8ff;
        background: rgba(255, 255, 255, .08);
        font: inherit;
        cursor: pointer;
      }
      #mobilePerfOverlay .mobile-perf-body {
        margin: 0;
        padding: 7px 8px 8px;
        max-height: min(42vh, 270px);
        overflow: auto;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      #mobilePerfOverlay.is-collapsed { width: auto; min-width: 116px; }
      #mobilePerfOverlay.is-collapsed .mobile-perf-body,
      #mobilePerfOverlay.is-collapsed .mobile-perf-copy { display: none; }
      @media (max-width: 620px) {
        #mobilePerfOverlay { width: min(260px, calc(100vw - 16px)); font-size: 9px; }
        #mobilePerfOverlay .mobile-perf-body { max-height: 36vh; }
      }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('section');
    overlay.id = 'mobilePerfOverlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
      <div class="mobile-perf-head">
        <strong class="mobile-perf-title">Mobile Perf</strong>
        <button class="mobile-perf-copy" type="button" title="Copy debug">Copy</button>
        <button class="mobile-perf-toggle" type="button" aria-label="Thu gọn debug" aria-expanded="true">−</button>
      </div>
      <pre class="mobile-perf-body"></pre>
    `;
    document.body.appendChild(overlay);
    state.overlay = overlay;
    state.bodyEl = overlay.querySelector('.mobile-perf-body');
    state.toggleButton = overlay.querySelector('.mobile-perf-toggle');
    state.copyButton = overlay.querySelector('.mobile-perf-copy');

    state.toggleButton?.addEventListener('click', () => {
      state.collapsed = !state.collapsed;
      renderOverlay();
    });
    state.copyButton?.addEventListener('click', async () => {
      if (!navigator.clipboard?.writeText) return;
      try {
        await navigator.clipboard.writeText(makeCopySummary());
        const original = state.copyButton.textContent;
        state.copyButton.textContent = 'Đã copy';
        window.setTimeout(() => { if (state.copyButton) state.copyButton.textContent = original || 'Copy'; }, 1200);
      } catch (_) {}
    });
    renderOverlay();
  }

  function mark(milestone, data = {}, options = {}) {
    const elapsedMs = Math.max(0, performance.now() - startedAt);
    const compactData = compactValue(data || {});
    updateSemanticState(milestone, compactData);
    state.lastMilestone = String(milestone || 'unknown');
    state.lastElapsedMs = elapsedMs;
    state.currentElapsedMs = elapsedMs;
    const event = {
      milestone: state.lastMilestone,
      elapsedMs: Number(elapsedMs.toFixed(1)),
      at: Date.now(),
      data: compactData
    };
    if (options.snapshot === true) event.renderer = getRendererSnapshot();
    events.push(event);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    persistSnapshot();
    renderOverlay();
    console.log(`[MobilePerf] ${event.milestone}`, event);
    if (milestone === 'pagehide' || milestone === 'webglcontextlost') printResourceSummary(true);
    return event;
  }

  function markOnce(milestone, data = {}, options = {}) {
    if (onceMilestones.has(milestone)) return null;
    onceMilestones.add(milestone);
    return mark(milestone, data, options);
  }

  function tick(now = performance.now()) {
    const elapsedMs = Math.max(0, now - startedAt);
    state.currentElapsedMs = elapsedMs;
    if (now - state.lastOverlayUpdateAt >= 1000) {
      state.lastOverlayUpdateAt = now;
      renderOverlay();
    }
    if (now - state.lastHeartbeatPersistAt >= 5000) {
      state.lastHeartbeatPersistAt = now;
      persistSnapshot();
    }
  }

  function printResourceSummary(compact = false) {
    const resources = getTrackedResources();
    if (compact) {
      const tail = resources.slice(-6).map((entry) => ({
        name: entry.name,
        duration: entry.duration,
        transferSize: entry.transferSize,
        cacheHint: entry.cacheHint
      }));
      console.info('[MobilePerf] resource-summary', tail);
      return tail;
    }
    console.groupCollapsed(`[MobilePerf] resource-summary (${resources.length})`);
    console.table(resources);
    console.groupEnd();
    return resources;
  }

  function dump() {
    console.group('[MobilePerf] dump');
    console.info('base', getBaseSnapshot());
    console.info('renderer', getRendererSnapshot());
    console.info('previous', state.previous);
    console.table(events.map((event) => ({
      elapsedMs: event.elapsedMs,
      milestone: event.milestone,
      resource: event.data?.resource || '',
      reason: event.data?.reason || ''
    })));
    printResourceSummary(false);
    console.groupEnd();
    return { base: getBaseSnapshot(), renderer: getRendererSnapshot(), events: events.slice(), resources: getTrackedResources(), previous: state.previous };
  }

  function findResource(term = '') {
    const needle = String(term || '').toLowerCase();
    const matches = getTrackedResources().filter((entry) => entry.name.toLowerCase().includes(needle));
    console.table(matches);
    return matches;
  }

  function clear() {
    events.length = 0;
    onceMilestones.clear();
    state.lastMilestone = 'cleared';
    state.lastElapsedMs = performance.now() - startedAt;
    state.previous = null;
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) {}
    renderOverlay();
  }

  function bindCinemaVideo(videoEl, kind = 'cinema') {
    if (!videoEl || boundCinemaVideos.has(videoEl)) return;
    boundCinemaVideos.add(videoEl);
    videoEl.addEventListener('playing', () => mark('cinema-play-start', {
      kind,
      resource: String(videoEl.currentSrc || videoEl.src || '').split('/').pop() || 'video',
      resourceStatus: 'playing'
    }));
    videoEl.addEventListener('error', () => mark('cinema-play-error', {
      kind,
      errorCode: videoEl.error?.code || 0,
      resource: String(videoEl.currentSrc || videoEl.src || '').split('/').pop() || 'video',
      resourceStatus: 'error'
    }));
  }

  function bindCinemaElements() {
    bindCinemaVideo(document.querySelector('#sceneVideoCinema video'), 'scene-video');
    bindCinemaVideo(document.getElementById('wallVideoCinemaVideo'), 'wall-video');
  }

  function installCinemaObservers() {
    bindCinemaElements();
    state.bodyClassObserver = new MutationObserver(() => {
      const open = document.body.classList.contains('viewer-scene-video-open')
        || document.body.classList.contains('wall-video-cinema-open');
      if (open && !state.cinemaOpen) {
        state.cinemaOpen = true;
        bindCinemaElements();
        mark('cinema-open', { className: document.body.className });
      } else if (!open) {
        state.cinemaOpen = false;
      }
    });
    state.bodyClassObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    state.bodyChildObserver = new MutationObserver(() => bindCinemaElements());
    state.bodyChildObserver.observe(document.body, { childList: true, subtree: true });
  }

  function attachRenderer(rendererRef, canvas) {
    if (!canvas || canvas.dataset.mobilePerfContextBound === '1') return;
    canvas.dataset.mobilePerfContextBound = '1';
    state.webgl = rendererRef?.getContext?.() ? 'ok' : 'unknown';
    canvas.addEventListener('webglcontextlost', (event) => {
      state.webgl = 'lost';
      mark('webglcontextlost', { statusMessage: event.statusMessage || '', defaultPrevented: event.defaultPrevented }, { snapshot: true });
    });
    canvas.addEventListener('webglcontextrestored', () => {
      state.webgl = 'restored';
      mark('webglcontextrestored', {}, { snapshot: true });
    });
    renderOverlay();
  }

  function installLifecycleListeners() {
    window.addEventListener('pagehide', (event) => mark('pagehide', { persisted: Boolean(event.persisted) }, { snapshot: true }));
    window.addEventListener('pageshow', (event) => mark('pageshow', { persisted: Boolean(event.persisted), navigationType: navigationEntry?.type || 'unknown' }));
    window.addEventListener('beforeunload', () => mark('beforeunload'));
    document.addEventListener('visibilitychange', () => {
      mark(document.hidden ? 'visibilitychange-hidden' : 'visibilitychange-visible', { visibilityState: document.visibilityState });
    });
    document.addEventListener('freeze', () => mark('freeze'));
    document.addEventListener('resume', () => mark('resume'));
    window.addEventListener('orientationchange', () => mark('orientation-change', {
      orientation: screen.orientation?.type || window.orientation || 'unknown',
      viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`
    }));
    window.addEventListener('resize', () => {
      const now = performance.now();
      if (now - state.lastResizeLogAt < 350) return;
      state.lastResizeLogAt = now;
      mark('resize', { viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}` });
    });
    window.visualViewport?.addEventListener('resize', () => {
      const now = performance.now();
      if (now - state.lastVisualResizeLogAt < 350) return;
      state.lastVisualResizeLogAt = now;
      mark('visual-viewport-resize', {
        viewport: `${Math.round(window.visualViewport.width)}x${Math.round(window.visualViewport.height)}`,
        scale: window.visualViewport.scale
      });
    });
  }

  function installResourceObserver() {
    if (typeof PerformanceObserver !== 'function' || !PerformanceObserver.supportedEntryTypes?.includes('resource')) return;
    try {
      state.resourceObserver = new PerformanceObserver((list) => {
        const tracked = list.getEntries().filter((entry) => /(room_base|room_outdoor|visitor\.glb|intro\.mp4|scene(?:_outdoor)?\.json|cms_public_content\.generated\.json)/i.test(String(entry.name || '')));
        const latest = tracked[tracked.length - 1];
        if (!latest) return;
        let shortName = String(latest.name || '').split('/').pop() || 'resource';
        shortName = shortName.split('?')[0];
        state.currentResource = `${shortName} · done ${Math.round(latest.duration || 0)}ms`;
        renderOverlay();
      });
      state.resourceObserver.observe({ type: 'resource', buffered: true });
    } catch (_) {}
  }

  createOverlay();
  installLifecycleListeners();
  installResourceObserver();
  installCinemaObservers();

  const api = {
    enabled: true,
    mark,
    markOnce,
    tick,
    attachRenderer,
    snapshotRenderer: getRendererSnapshot,
    printResourceSummary,
    dump,
    clear,
    findResource,
    getEvents: () => events.slice(),
    getState: () => ({
      room: state.room,
      lastMilestone: state.lastMilestone,
      lastElapsedMs: state.lastElapsedMs,
      avatar: state.avatar,
      video: state.video,
      webgl: state.webgl,
      lifecycle: state.lifecycle,
      currentResource: state.currentResource,
      previous: state.previous
    })
  };

  markOnce('probe-init', getBaseSnapshot());
  markOnce('viewer-script-start', { script: 'src/viewer/core/domThreeState.js' });
  mark('pageshow', { initial: true, persisted: false, navigationType: navigationEntry?.type || 'unknown' });
  if (previousSnapshot) {
    markOnce('previous-session-found', {
      previousLastMilestone: previousSnapshot.lastMilestone || 'unknown',
      previousElapsedMs: Math.round(previousSnapshot.lastElapsedMs || 0),
      timeSincePreviousMs: Math.max(0, Date.now() - Number(previousSnapshot.timestamp || Date.now())),
      previousRoom: previousSnapshot.room || 'unknown'
    });
  }
  return api;
}

const mobilePerfProbeV613021 = createMobilePerfProbeV613021();
if (mobilePerfProbeV613021) window.__MobilePerfProbe = mobilePerfProbeV613021;

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
window.__MobilePerfProbe?.attachRenderer?.(renderer, renderer.domElement);
window.__MobilePerfProbe?.markOnce?.('viewer-boot-start', {
  renderer: 'WebGLRenderer',
  antialias: initialQuality?.isMobile ? initialQuality?.profile?.antialias !== false : true
}, { snapshot: true });

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
