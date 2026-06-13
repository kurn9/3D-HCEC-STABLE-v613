(function () {
  const STORAGE_KEY = 'mobileOrientationAccepted';

  function getDevice() {
    return window.viewerMobileDevice || null;
  }

  function getConfig() {
    return (window.CONFIG && CONFIG.mobile) || {};
  }

  function hasAcceptedPortrait() {
    try { return window.sessionStorage.getItem(STORAGE_KEY) === '1'; }
    catch { return false; }
  }

  function acceptPortraitFallback() {
    try { window.sessionStorage.setItem(STORAGE_KEY, '1'); } catch {}
  }

  function shouldUseOverlay() {
    const device = getDevice();
    if (!device?.isMobileViewer?.()) return false;
    if (getConfig().showRotateOverlay === false) return false;
    return device.isPortrait?.() && !hasAcceptedPortrait();
  }

  function leaveOverlay({ quiet = false } = {}) {
    acceptPortraitFallback();
    updateOverlay();
    window.enableMobileViewerSession?.({ quiet });
    window.resizeViewerForMobileViewport?.();
  }

  function createOverlay() {
    const existing = document.getElementById('mobileOrientationOverlay');
    if (existing) return existing;

    const overlay = document.createElement('div');
    overlay.id = 'mobileOrientationOverlay';
    overlay.className = 'mobile-orientation-overlay';
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
      <div class="mobile-orientation-card" role="dialog" aria-modal="true" aria-label="Khuyến nghị xoay ngang thiết bị">
        <div class="mobile-orientation-icon" aria-hidden="true">↻</div>
        <strong>Xoay ngang thiết bị</strong>
        <p>Trải nghiệm tốt nhất khi xoay ngang thiết bị. Bạn vẫn có thể tiếp tục ở chế độ dọc.</p>
        <div class="mobile-orientation-actions">
          <button type="button" class="mobile-orientation-primary" data-mobile-portrait-continue>Tiếp tục tham quan</button>
        </div>
        <small class="mobile-orientation-note" data-mobile-orientation-note>Trình duyệt trong ứng dụng như Zalo/iOS có thể không hỗ trợ khóa xoay ổn định.</small>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('[data-mobile-portrait-continue]')?.addEventListener('click', () => {
      leaveOverlay({ quiet: false });
    });

    return overlay;
  }

  function updateOverlay() {
    const overlay = createOverlay();
    const visible = shouldUseOverlay();
    overlay.classList.toggle('is-visible', visible);
    overlay.setAttribute('aria-hidden', String(!visible));
    document.body.classList.toggle('mobile-orientation-blocked', visible);

    if (!visible && getDevice()?.isMobileViewer?.()) {
      window.enableMobileViewerSession?.({ quiet: true });
      window.resizeViewerForMobileViewport?.();
    }
  }

  window.refreshMobileOrientationOverlay = updateOverlay;
  window.acceptMobilePortraitFallback = leaveOverlay;

  createOverlay();
  updateOverlay();
  window.addEventListener('resize', updateOverlay, { passive: true });
  window.addEventListener('orientationchange', () => window.setTimeout(updateOverlay, 180), { passive: true });
})();
