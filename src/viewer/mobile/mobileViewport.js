(function () {
  const getMobileConfig = () => (window.CONFIG && CONFIG.mobile) || {};
  const getRuntimeConfig = () => (window.CONFIG && CONFIG.mobileRuntimeThrottling) || {};

  let resizeRafId = 0;
  let resizeTrailingTimer = 0;
  let pendingResizeEvents = 0;
  let pendingResizeReason = 'resize';
  let lastAppliedWidth = 0;
  let lastAppliedHeight = 0;
  let lastAppliedDpr = 0;

  function getMobileDevice() {
    return window.viewerMobileDevice || null;
  }

  function isMobileResizeCoalescingEnabled() {
    const cfg = getRuntimeConfig();
    return Boolean(
      cfg.enabled !== false
      && cfg.resizeCoalescingEnabled !== false
      && getMobileDevice()?.isMobileViewer?.()
    );
  }

  function getViewportHeight() {
    return Math.max(1, Math.round(window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 1));
  }

  function getViewportWidth() {
    return Math.max(1, Math.round(window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 1));
  }

  function getViewerPixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    const device = getMobileDevice();
    const mobile = device?.isMobileViewer?.() || false;
    const tablet = device?.isTabletLike?.() || false;
    const cfg = getMobileConfig();
    const phoneMax = Number(cfg.maxPixelRatio || 1.25);
    const tabletMax = Number(cfg.tabletMaxPixelRatio || 1.5);
    const desktopMax = Number(CONFIG?.maxPixelRatio || 2);
    return Math.min(dpr, mobile ? (tablet ? tabletMax : phoneMax) : desktopMax);
  }

  function updateCssViewportVars() {
    const root = document.documentElement;
    root.style.setProperty('--app-height', `${getViewportHeight()}px`);
    root.style.setProperty('--app-width', `${getViewportWidth()}px`);
    root.style.setProperty('--safe-top', 'env(safe-area-inset-top, 0px)');
    root.style.setProperty('--safe-right', 'env(safe-area-inset-right, 0px)');
    root.style.setProperty('--safe-bottom', 'env(safe-area-inset-bottom, 0px)');
    root.style.setProperty('--safe-left', 'env(safe-area-inset-left, 0px)');
  }

  function resizeViewerRenderer(options = {}) {
    const force = options.force === true;
    const reason = String(options.reason || pendingResizeReason || 'resize');
    const eventCount = Math.max(1, Number(options.eventCount || pendingResizeEvents || 1));

    updateCssViewportVars();
    getMobileDevice()?.updateBodyClasses?.();

    if (typeof camera === 'undefined' || typeof renderer === 'undefined' || !camera || !renderer) return false;

    const width = Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1));
    const height = Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1));
    const dpr = getViewerPixelRatio();
    const mobileCoalescing = isMobileResizeCoalescingEnabled();
    const sizeChanged = width !== lastAppliedWidth || height !== lastAppliedHeight;
    const dprChanged = Math.abs(dpr - lastAppliedDpr) > 0.001;

    if (!force && mobileCoalescing && !sizeChanged && !dprChanged) return false;

    if (sizeChanged || force || !mobileCoalescing) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      lastAppliedWidth = width;
      lastAppliedHeight = height;
    }

    if (dprChanged || force || !mobileCoalescing) {
      const currentDpr = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 0;
      if (force || !mobileCoalescing || Math.abs(currentDpr - dpr) > 0.001) renderer.setPixelRatio(dpr);
      lastAppliedDpr = dpr;
    }

    if (typeof updateMiniMap === 'function') updateMiniMap(1 / 60);

    if (mobileCoalescing) {
      window.__MobilePerfProbe?.mark?.('mobile-resize-coalesced', {
        reason,
        eventCount,
        width,
        height,
        dpr: Number(dpr.toFixed(2))
      });
    }
    return true;
  }

  function flushScheduledResize(reason = pendingResizeReason) {
    const eventCount = pendingResizeEvents;
    pendingResizeEvents = 0;
    pendingResizeReason = 'resize';
    resizeViewerRenderer({ reason, eventCount });
  }

  function scheduleResize(reason = 'resize') {
    pendingResizeEvents += 1;
    pendingResizeReason = reason || pendingResizeReason;

    if (!isMobileResizeCoalescingEnabled()) {
      window.requestAnimationFrame(() => resizeViewerRenderer({ force: true, reason }));
      window.setTimeout(() => resizeViewerRenderer({ force: true, reason }), 180);
      pendingResizeEvents = 0;
      pendingResizeReason = 'resize';
      return;
    }

    if (!resizeRafId) {
      resizeRafId = window.requestAnimationFrame(() => {
        resizeRafId = 0;
        updateCssViewportVars();
        getMobileDevice()?.updateBodyClasses?.();
      });
    }

    if (resizeTrailingTimer) window.clearTimeout(resizeTrailingTimer);
    const trailingMs = Math.max(150, Math.min(250, Number(getRuntimeConfig().resizeTrailingMs || 180)));
    resizeTrailingTimer = window.setTimeout(() => {
      resizeTrailingTimer = 0;
      flushScheduledResize(pendingResizeReason);
    }, trailingMs);
  }

  async function requestMobileLandscapeMode() {
    const device = getMobileDevice();
    if (!device?.isMobileViewer?.()) return { attempted: false, fullscreen: false, locked: false };

    const result = { attempted: true, fullscreen: false, locked: false };
    const root = document.documentElement;

    try {
      if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
        await root.requestFullscreen({ navigationUI: 'hide' });
        result.fullscreen = true;
      }
    } catch {
      // iOS Safari and some in-app browsers can reject fullscreen. Fallback overlay remains available.
    }

    try {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        await screen.orientation.lock('landscape');
        result.locked = true;
      }
    } catch {
      // Orientation lock is not guaranteed on iOS/iPadOS or without fullscreen.
    }

    scheduleResize('landscape-request');
    window.refreshMobileOrientationOverlay?.();
    return result;
  }

  window.getViewerPixelRatio = getViewerPixelRatio;
  window.resizeViewerForMobileViewport = () => resizeViewerRenderer({ force: true, reason: 'manual' });
  window.scheduleViewerMobileResize = scheduleResize;
  window.requestMobileLandscapeMode = requestMobileLandscapeMode;

  updateCssViewportVars();
  window.addEventListener('resize', () => scheduleResize('window-resize'), { passive: true });
  window.addEventListener('orientationchange', () => scheduleResize('orientation-change'), { passive: true });
  window.visualViewport?.addEventListener('resize', () => scheduleResize('visual-viewport-resize'), { passive: true });
  window.visualViewport?.addEventListener('scroll', updateCssViewportVars, { passive: true });
  window.setTimeout(() => resizeViewerRenderer({ force: true, reason: 'startup' }), 0);
})();
