(function () {
  const getMobileConfig = () => (window.CONFIG && CONFIG.mobile) || {};

  function getMobileDevice() {
    return window.viewerMobileDevice || null;
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

  function resizeViewerRenderer() {
    updateCssViewportVars();
    getMobileDevice()?.updateBodyClasses?.();

    if (typeof camera !== 'undefined' && typeof renderer !== 'undefined' && camera && renderer) {
      const width = window.innerWidth || document.documentElement.clientWidth || 1;
      const height = window.innerHeight || document.documentElement.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      renderer.setPixelRatio(getViewerPixelRatio());
      if (typeof updateMiniMap === 'function') updateMiniMap(1 / 60);
    }
  }

  function scheduleResize() {
    window.requestAnimationFrame(resizeViewerRenderer);
    window.setTimeout(resizeViewerRenderer, 180);
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

    scheduleResize();
    window.refreshMobileOrientationOverlay?.();
    return result;
  }

  window.getViewerPixelRatio = getViewerPixelRatio;
  window.resizeViewerForMobileViewport = resizeViewerRenderer;
  window.requestMobileLandscapeMode = requestMobileLandscapeMode;

  updateCssViewportVars();
  window.addEventListener('resize', scheduleResize, { passive: true });
  window.addEventListener('orientationchange', scheduleResize, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleResize, { passive: true });
  window.visualViewport?.addEventListener('scroll', updateCssViewportVars, { passive: true });
  window.setTimeout(resizeViewerRenderer, 0);
})();
