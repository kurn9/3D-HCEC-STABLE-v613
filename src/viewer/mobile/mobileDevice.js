(function () {
  const MOBILE_MAX_LONG_EDGE = 1366;

  function hasCoarsePointer() {
    return window.matchMedia?.('(pointer: coarse)')?.matches || false;
  }

  function hasTouch() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
  }

  function getLongEdge() {
    return Math.max(window.innerWidth || 0, window.innerHeight || 0);
  }

  function getShortEdge() {
    return Math.min(window.innerWidth || 0, window.innerHeight || 0);
  }

  function isTouchLike() {
    return hasTouch() || hasCoarsePointer();
  }

  function isMobileViewer() {
    return isTouchLike() && getLongEdge() <= MOBILE_MAX_LONG_EDGE;
  }

  function isTabletLike() {
    return isTouchLike() && getLongEdge() > 767 && getLongEdge() <= MOBILE_MAX_LONG_EDGE;
  }

  function isPortrait() {
    return window.innerHeight >= window.innerWidth;
  }

  function isLandscape() {
    return window.innerWidth > window.innerHeight;
  }

  function getPlatform() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    return { isIOS, isAndroid };
  }

  function updateBodyClasses() {
    const body = document.body;
    if (!body) return;

    const mobile = isMobileViewer();
    const touch = isTouchLike();
    const tablet = isTabletLike();
    const portrait = isPortrait();
    const landscape = isLandscape();
    const platform = getPlatform();

    body.classList.toggle('is-touch-device', touch);
    body.classList.toggle('viewer-mobile', mobile);
    body.classList.toggle('viewer-tablet', tablet);
    body.classList.toggle('viewer-phone', mobile && !tablet);
    body.classList.toggle('viewer-portrait', mobile && portrait);
    body.classList.toggle('viewer-landscape', mobile && landscape);
    body.classList.toggle('viewer-ios', platform.isIOS);
    body.classList.toggle('viewer-android', platform.isAndroid);
  }

  window.viewerMobileDevice = {
    hasTouch,
    hasCoarsePointer,
    isTouchLike,
    isMobileViewer,
    isTabletLike,
    isPortrait,
    isLandscape,
    getLongEdge,
    getShortEdge,
    getPlatform,
    updateBodyClasses
  };

  updateBodyClasses();
  window.addEventListener('resize', updateBodyClasses, { passive: true });
  window.addEventListener('orientationchange', () => window.setTimeout(updateBodyClasses, 120), { passive: true });
})();
