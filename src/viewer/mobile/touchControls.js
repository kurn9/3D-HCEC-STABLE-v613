(function () {
  const HELP_STORAGE_KEY = 'mobileHelpSeenV643';
  let activeLookPointerId = null;
  let activeLookElement = null;

  function getDevice() {
    return window.viewerMobileDevice || null;
  }

  function getConfig() {
    return (window.CONFIG && CONFIG.mobile) || {};
  }

  function shouldEnableTouchControls() {
    const device = getDevice();
    return Boolean(getConfig().touchControls !== false && device?.isMobileViewer?.());
  }

  function isTouchControlBlocked() {
    return Boolean(
      document.body.classList.contains('mobile-orientation-blocked') ||
      document.body.classList.contains('artwork-list-open') ||
      document.body.classList.contains('viewer-modal-open') ||
      document.body.classList.contains('wall-video-cinema-open') ||
      (typeof modalOpen !== 'undefined' && modalOpen) ||
      (typeof window.isWallVideoCinemaOpen === 'function' && window.isWallVideoCinemaOpen())
    );
  }

  function isMobileUiTarget(target) {
    return Boolean(target?.closest?.(
      '.mobile-action-stack, .mobile-list-quick-btn, .mobile-joystick, .mobile-fullscreen-btn, #miniMapPanel, #artworkListPanel, #modalOverlay, #wallVideoCinemaOverlay, #imageLightbox, #artworkListToggle, .viewer-home-link'
    ));
  }

  function showMobileToast(message, timeout = 2200) {
    if (!shouldEnableTouchControls()) return;
    let toast = document.getElementById('mobileActionToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mobileActionToast';
      toast.className = 'mobile-action-toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(showMobileToast._timer);
    showMobileToast._timer = window.setTimeout(() => toast.classList.remove('is-visible'), timeout);
  }

  function setMovementKeys(nextKeys) {
    keys.KeyW = Boolean(nextKeys.forward);
    keys.ArrowUp = Boolean(nextKeys.forward);
    keys.KeyS = Boolean(nextKeys.backward);
    keys.ArrowDown = Boolean(nextKeys.backward);
    keys.KeyA = Boolean(nextKeys.left);
    keys.ArrowLeft = Boolean(nextKeys.left);
    keys.KeyD = Boolean(nextKeys.right);
    keys.ArrowRight = Boolean(nextKeys.right);
  }

  function setMobileMoveVector(vector) {
    if (!getConfig().joystickAnalogMovement) {
      window.__mobileMoveVector = null;
      return;
    }

    if (!vector || vector.strength <= 0) {
      window.__mobileMoveVector = { x: 0, y: 0, strength: 0, active: false };
      return;
    }

    window.__mobileMoveVector = {
      x: vector.x,
      y: vector.y,
      strength: vector.strength,
      active: true,
      updatedAt: performance.now()
    };
  }

  function clearMobileMoveVector() {
    window.__mobileMoveVector = { x: 0, y: 0, strength: 0, active: false };
  }

  function setSprintKey(active) {
    keys.ShiftLeft = Boolean(active);
    keys.ShiftRight = false;
    document.body.classList.toggle('mobile-sprint-active', Boolean(active));
  }

  function releaseMovementKeys() {
    setMovementKeys({ forward: false, backward: false, left: false, right: false });
    clearMobileMoveVector();
  }

  function releaseActiveLook() {
    if (activeLookElement && activeLookPointerId !== null) {
      try { activeLookElement.releasePointerCapture?.(activeLookPointerId); } catch {}
    }
    activeLookPointerId = null;
    activeLookElement?.classList?.remove('is-active');
    activeLookElement = null;
  }

  function releaseAllMobileKeys() {
    releaseMovementKeys();
    setSprintKey(false);
    releaseActiveLook();
    document.querySelectorAll('.mobile-skill-run.is-active').forEach((btn) => btn.classList.remove('is-active'));
  }

  function syncLookTargetsToCurrentCamera() {
    try {
      if (Number.isFinite(yaw)) targetYaw = yaw;
      if (Number.isFinite(pitch)) targetPitch = pitch;
    } catch {}
  }

  function getFinitePositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function getClampedNumber(value, fallback, min, max) {
    const parsed = Number(value);
    const next = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(min, Math.min(max, next));
  }

  function lerpAngle(from, to, alpha) {
    const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + delta * alpha;
  }

  function getMobileLookSensitivity(sensitivityBoost) {
    const fallbackBase = getFinitePositiveNumber(CONFIG?.lookSensitivity, 0.00165);
    const touchBase = getFinitePositiveNumber(CONFIG?.touchLookSensitivity, fallbackBase);
    const multiplier = getFinitePositiveNumber(sensitivityBoost, 1);
    return touchBase * multiplier;
  }

  function applyMobileLookDelta(dx, dy, sensitivityBoost) {
    const sensitivity = getMobileLookSensitivity(sensitivityBoost);
    const baseYaw = Number.isFinite(targetYaw) ? targetYaw : (Number.isFinite(yaw) ? yaw : 0);
    const basePitch = Number.isFinite(targetPitch) ? targetPitch : (Number.isFinite(pitch) ? pitch : 0);
    const limit = Math.PI / 2 - 0.08;

    targetYaw = baseYaw - dx * sensitivity;
    targetPitch = Math.max(-limit, Math.min(limit, basePitch - dy * sensitivity));

    // Mobile-only response aid: keep targetYaw/targetPitch as source-of-truth,
    // while reducing the visible third-person lag caused by render-loop damping.
    if (viewMode === 'first') {
      yaw = targetYaw;
      pitch = targetPitch;
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
    } else {
      const immediateRatio = getClampedNumber(getConfig().touchLookImmediateSyncRatio, 0, 0, 0.32);
      if (immediateRatio > 0) {
        const currentYaw = Number.isFinite(yaw) ? yaw : baseYaw;
        const currentPitch = Number.isFinite(pitch) ? pitch : basePitch;
        yaw = lerpAngle(currentYaw, targetYaw, immediateRatio);
        pitch = Math.max(-limit, Math.min(limit, currentPitch + (targetPitch - currentPitch) * immediateRatio));
      }
    }
  }

  function mobileControlIcon(name) {
    const common = 'viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
    const icons = {
      fullscreen: `<svg ${common}><path d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4"/><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5"/></svg>`,
      list: `<svg ${common}><path d="M8 7h11M8 12h11M8 17h11"/><path d="M4.5 7h.1M4.5 12h.1M4.5 17h.1" stroke-linecap="round"/></svg>`,
      view: `<svg ${common}><path d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z"/><circle cx="12" cy="12" r="2.6"/></svg>`,
      escape: `<svg ${common}><path d="M10 5 4 12l6 7"/><path d="M5 12h10.5a4.5 4.5 0 0 1 0 9H14"/></svg>`,
      start: `<svg ${common}><circle cx="12" cy="12" r="7"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/><circle cx="12" cy="12" r="2"/></svg>`,
      sit: `<svg ${common}><path d="M8 5v8h7.5a2.5 2.5 0 0 1 2.5 2.5V19"/><path d="M8 13v6M15 13v6M7 19h12"/><path d="M8 5h6"/></svg>`,
      run: `<svg ${common}><circle cx="14" cy="4.8" r="1.9"/><path d="M10 9.5 13 8l2.8 2.5"/><path d="M13 8 11.5 13l4.5 1.5"/><path d="M11.5 13 8 18.5"/><path d="M16 14.5 19 19"/><path d="M5 12h4"/></svg>`
    };
    return `<span class="mobile-control-icon" aria-hidden="true">${icons[name] || ''}</span>`;
  }

  function enableMobileViewerSession(options = {}) {
    if (!shouldEnableTouchControls()) return;
    try { isLocked = true; } catch {}
    if (options.syncLook !== false) syncLookTargetsToCurrentCamera();
    document.body.classList.add('mobile-viewer-session');
    startHint?.classList.add('hidden');

    if (!options.quiet && typeof setStatus === 'function') {
      setStatus('✅ <strong>Đang tham quan</strong>');
    }
  }

  function createControls() {
    const existing = document.getElementById('mobileTouchControls');
    if (existing) return existing;

    const controls = document.createElement('div');
    controls.id = 'mobileTouchControls';
    controls.className = 'mobile-touch-controls';
    controls.setAttribute('aria-hidden', 'false');
    controls.innerHTML = `
      <button id="mobileFullscreenBtn" class="mobile-fullscreen-btn" type="button" aria-label="Toàn màn hình" title="Toàn màn hình">${mobileControlIcon('fullscreen')}</button>
      <button id="mobileArtworkListQuickBtn" class="mobile-skill-btn mobile-list-quick-btn" type="button" data-mobile-action="list" aria-label="Danh sách tác phẩm" title="Danh sách tác phẩm">${mobileControlIcon('list')}<small>DS</small></button>
      <div class="mobile-look-zone" data-mobile-look-zone aria-label="Vùng kéo để nhìn xung quanh"></div>
      <div class="mobile-joystick" data-mobile-joystick aria-label="Joystick di chuyển">
        <div class="mobile-joystick-base">
          <div class="mobile-joystick-thumb"></div>
        </div>
      </div>
      <div class="mobile-action-stack" aria-label="Điều khiển nhanh">
        <button class="mobile-skill-btn mobile-skill-small" type="button" data-mobile-action="view" aria-label="Đổi góc nhìn" title="Góc nhìn">${mobileControlIcon('view')}<small>Góc</small></button>
        <button class="mobile-skill-btn mobile-skill-small" type="button" data-mobile-action="escape" aria-label="Thoát" title="Thoát">${mobileControlIcon('escape')}<small>Thoát</small></button>
        <button class="mobile-skill-btn mobile-skill-small" type="button" data-mobile-action="start" aria-label="Về điểm bắt đầu" title="Điểm bắt đầu">${mobileControlIcon('start')}<small>Điểm</small></button>
        <button class="mobile-skill-btn mobile-skill-main" type="button" data-mobile-action="sit" aria-label="Ngồi hoặc đứng dậy" title="Ngồi">${mobileControlIcon('sit')}<small>Ngồi</small></button>
        <button class="mobile-skill-btn mobile-skill-run" type="button" data-mobile-action="run" aria-label="Giữ để chạy">${mobileControlIcon('run')}<small>Chạy</small></button>
      </div>
      <div class="mobile-help-toast" data-mobile-help-toast>
        <span>Kéo joystick để di chuyển</span>
        <span>Kéo bên phải để nhìn</span>
        <span>Ngồi · giữ Chạy · mở Danh sách</span>
      </div>
    `;
    document.body.appendChild(controls);
    return controls;
  }

  function showFirstRunHint(controls) {
    try {
      if (localStorage.getItem(HELP_STORAGE_KEY) === '1') return;
      localStorage.setItem(HELP_STORAGE_KEY, '1');
    } catch {}

    const toast = controls.querySelector('[data-mobile-help-toast]');
    if (!toast) return;
    toast.classList.add('is-visible');
    window.setTimeout(() => toast.classList.remove('is-visible'), 3600);
  }

  function initJoystick(controls) {
    const joystick = controls.querySelector('[data-mobile-joystick]');
    const thumb = controls.querySelector('.mobile-joystick-thumb');
    if (!joystick || !thumb) return;

    let activePointerId = null;
    let originX = 0;
    let originY = 0;
    let joystickEngaged = false;

    const readJoystickSettings = () => {
      const config = getConfig();
      const maxRadius = getClampedNumber(config.joystickMaxRadius, 48, 34, 62);
      const deadzone = getClampedNumber(config.joystickDeadzone, 0.13, 0.05, 0.32);
      const releaseDeadzone = Math.min(
        deadzone,
        getClampedNumber(config.joystickReleaseDeadzone, 0.09, 0.03, 0.24)
      );
      const strengthCurve = getClampedNumber(config.joystickStrengthCurve, 0.82, 0.55, 1.45);

      return { maxRadius, deadzone, releaseDeadzone, strengthCurve };
    };

    const moveThumb = (dx, dy) => {
      thumb.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    };

    const resetJoystickInput = () => {
      joystickEngaged = false;
      clearMobileMoveVector();
      releaseMovementKeys();
    };

    const updateFromPointer = (event) => {
      const { maxRadius, deadzone, releaseDeadzone, strengthCurve } = readJoystickSettings();
      const dxRaw = event.clientX - originX;
      const dyRaw = event.clientY - originY;
      const length = Math.hypot(dxRaw, dyRaw);
      const scale = length > maxRadius ? maxRadius / length : 1;
      const dx = dxRaw * scale;
      const dy = dyRaw * scale;
      const nx = dx / maxRadius;
      const ny = dy / maxRadius;
      const radial = Math.min(1, Math.hypot(nx, ny));

      moveThumb(dx, dy);

      if (joystickEngaged) {
        if (radial < releaseDeadzone) joystickEngaged = false;
      } else if (radial >= deadzone) {
        joystickEngaged = true;
      }

      if (!joystickEngaged) {
        setMovementKeys({ forward: false, backward: false, left: false, right: false });
        clearMobileMoveVector();
        return;
      }

      const unitX = radial > 0 ? nx / radial : 0;
      const unitY = radial > 0 ? ny / radial : 0;
      const usableRange = Math.max(0.001, 1 - releaseDeadzone);
      const rawStrength = Math.max(0, Math.min(1, (radial - releaseDeadzone) / usableRange));
      const strength = Math.pow(rawStrength, strengthCurve);
      const vectorX = unitX * strength;
      const vectorY = unitY * strength;
      const keyThreshold = releaseDeadzone;

      setMobileMoveVector({ x: vectorX, y: vectorY, strength });
      setMovementKeys({
        forward: vectorY < -keyThreshold,
        backward: vectorY > keyThreshold,
        left: vectorX < -keyThreshold,
        right: vectorX > keyThreshold
      });
    };

    const stop = (event) => {
      if (event && activePointerId === null) return;
      if (event && activePointerId !== null && event.pointerId !== activePointerId) return;
      if (activePointerId !== null) {
        try { joystick.releasePointerCapture?.(activePointerId); } catch {}
      }
      activePointerId = null;
      resetJoystickInput();
      moveThumb(0, 0);
      joystick.classList.remove('is-active');
    };

    joystick.addEventListener('pointerdown', (event) => {
      if (activePointerId !== null || isTouchControlBlocked()) return;
      enableMobileViewerSession({ quiet: true });
      activePointerId = event.pointerId;
      joystick.setPointerCapture?.(event.pointerId);
      joystick.classList.add('is-active');
      const rect = joystick.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
      updateFromPointer(event);
      event.preventDefault();
      event.stopPropagation();
    });

    joystick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== activePointerId) return;
      updateFromPointer(event);
      event.preventDefault();
      event.stopPropagation();
    });

    joystick.addEventListener('pointerup', stop);
    joystick.addEventListener('pointercancel', stop);
    joystick.addEventListener('lostpointercapture', stop);
    document.addEventListener('pointerup', stop, { passive: true });
    document.addEventListener('pointercancel', stop, { passive: true });
    window.addEventListener('blur', releaseAllMobileKeys);
  }

  function initLookZone(controls) {
    const lookZone = controls.querySelector('[data-mobile-look-zone]');
    if (!lookZone) return;

    let lastX = 0;
    let lastY = 0;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let totalMove = 0;

    const sensitivityBoost = Number(getConfig().touchLookSensitivityMultiplier || 1.28);
    const tapMoveLimit = Number(getConfig().touchTapMoveLimit || 9);
    const tapTimeLimit = Number(getConfig().touchTapTimeLimit || 360);

    const stop = () => {
      releaseActiveLook();
    };

    const openInteractableAtTap = () => {
      const duration = performance.now() - startTime;
      if (totalMove > tapMoveLimit || duration > tapTimeLimit) return false;
      if (isTouchControlBlocked()) return false;

      // K_O_F_C: tap raycast first; focused-root fallback is now short-lived
      // inside openArtworkAtClientPoint(), preventing blank taps from opening an old artwork.
      if (typeof window.openArtworkAtClientPoint === 'function' && window.openArtworkAtClientPoint(startX, startY)) return true;
      if (typeof window.openWallVideoCinemaAtClientPoint === 'function' && window.openWallVideoCinemaAtClientPoint(startX, startY)) return true;
      if (typeof window.openWallVideoCinemaAtCenter === 'function' && window.openWallVideoCinemaAtCenter()) return true;
      return false;
    };

    lookZone.addEventListener('pointerdown', (event) => {
      if (activeLookPointerId !== null || isTouchControlBlocked()) return;
      if (isMobileUiTarget(event.target)) return;
      enableMobileViewerSession({ quiet: true });
      activeLookPointerId = event.pointerId;
      activeLookElement = lookZone;
      lastX = event.clientX;
      lastY = event.clientY;
      startX = event.clientX;
      startY = event.clientY;
      startTime = performance.now();
      totalMove = 0;
      lookZone.setPointerCapture?.(event.pointerId);
      lookZone.classList.add('is-active');
      event.preventDefault();
      event.stopPropagation();
    });

    lookZone.addEventListener('pointermove', (event) => {
      if (event.pointerId !== activeLookPointerId || isTouchControlBlocked()) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      totalMove = Math.max(totalMove, Math.hypot(event.clientX - startX, event.clientY - startY));
      lastX = event.clientX;
      lastY = event.clientY;

      applyMobileLookDelta(dx, dy, sensitivityBoost);
      event.preventDefault();
      event.stopPropagation();
    });

    lookZone.addEventListener('pointerup', (event) => {
      if (event.pointerId !== activeLookPointerId) return;
      const didOpen = openInteractableAtTap();
      stop();
      event.preventDefault();
      event.stopPropagation();
      if (!didOpen) enableMobileViewerSession({ quiet: true });
    });

    lookZone.addEventListener('pointercancel', stop);
    lookZone.addEventListener('lostpointercapture', stop);
    document.addEventListener('pointerup', (event) => {
      if (event.pointerId === activeLookPointerId) stop();
    }, { passive: true });
    document.addEventListener('pointercancel', (event) => {
      if (event.pointerId === activeLookPointerId) stop();
    }, { passive: true });
  }

  function tryMobileSit() {
    if (isTouchControlBlocked()) return;
    if (!avatar || viewMode !== 'third') {
      showMobileToast('Chuyển sang góc nhìn avatar để ngồi.');
      return;
    }

    if (isSitting && typeof standUpFromSeat === 'function') {
      standUpFromSeat();
      return;
    }

    if (typeof sitOnNearestSeat === 'function') {
      const before = Boolean(isSitting);
      sitOnNearestSeat();
      if (!before && !isSitting) showMobileToast('Hãy đứng gần ghế để ngồi.');
    }
  }

  function handleMobileEscape() {
    releaseAllMobileKeys();
    if (typeof closeArtworkListPanel === 'function' && document.body.classList.contains('artwork-list-open')) {
      closeArtworkListPanel();
      return;
    }
    if (typeof closeModal === 'function' && typeof modalOpen !== 'undefined' && modalOpen) {
      closeModal();
      return;
    }
    if (typeof closeWallVideoCinema === 'function' && typeof window.isWallVideoCinemaOpen === 'function' && window.isWallVideoCinemaOpen()) {
      closeWallVideoCinema();
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
    enableMobileViewerSession({ quiet: true });
    showMobileToast('Đã thoát thao tác hiện tại.');
  }

  async function requestMobileFullscreenFromButton() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        window.resizeViewerForMobileViewport?.();
        return;
      }
    } catch {}
    showMobileToast('Trình duyệt này không hỗ trợ toàn màn hình ổn định.');
    window.resizeViewerForMobileViewport?.();
  }

  function initActionButtons(controls) {
    const runButton = controls.querySelector('[data-mobile-action="run"]');

    document.getElementById('mobileFullscreenBtn')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      requestMobileFullscreenFromButton();
    });

    document.getElementById('mobileMapHomeBtn')?.addEventListener('click', (event) => {
      if (!shouldEnableTouchControls()) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.href = './index.html';
    });

    controls.querySelector('[data-mobile-action="view"]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      enableMobileViewerSession({ quiet: true });
      if (!isTouchControlBlocked() && typeof toggleViewMode === 'function') {
        syncLookTargetsToCurrentCamera();
        toggleViewMode();
        syncLookTargetsToCurrentCamera();
      }
    });

    controls.querySelector('[data-mobile-action="escape"]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      handleMobileEscape();
    });

    controls.querySelector('[data-mobile-action="start"]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      enableMobileViewerSession({ quiet: true });
      if (!isTouchControlBlocked() && typeof window.goHome === 'function') {
        const ok = window.goHome();
        if (ok === false) showMobileToast(isSitting ? 'Hãy đứng dậy trước khi về điểm bắt đầu.' : 'Chưa lưu được điểm bắt đầu.');
      }
    });

    controls.querySelector('[data-mobile-action="sit"]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      enableMobileViewerSession({ quiet: true });
      tryMobileSit();
    });

    controls.querySelector('[data-mobile-action="list"]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      releaseAllMobileKeys();
      if (typeof window.openArtworkListPanel === 'function') window.openArtworkListPanel();
      else document.getElementById('artworkListToggle')?.click();
    });

    const runStart = (event) => {
      if (isTouchControlBlocked()) return;
      enableMobileViewerSession({ quiet: true });
      setSprintKey(true);
      runButton?.classList.add('is-active');
      event.preventDefault();
      event.stopPropagation();
    };

    const runStop = (event) => {
      setSprintKey(false);
      runButton?.classList.remove('is-active');
      event?.stopPropagation?.();
    };

    runButton?.addEventListener('pointerdown', runStart);
    runButton?.addEventListener('pointerup', runStop);
    runButton?.addEventListener('pointercancel', runStop);
    runButton?.addEventListener('pointerleave', runStop);
    window.addEventListener('blur', runStop);
  }

  function initTouchControls() {
    if (!shouldEnableTouchControls()) return;
    const controls = createControls();
    showFirstRunHint(controls);
    initJoystick(controls);
    initLookZone(controls);
    initActionButtons(controls);

    window.addEventListener('orientationchange', () => window.setTimeout(releaseAllMobileKeys, 120), { passive: true });
    window.addEventListener('resize', releaseMovementKeys, { passive: true });
  }

  window.enableMobileViewerSession = enableMobileViewerSession;
  window.releaseMobileMovementKeys = releaseMovementKeys;
  window.releaseAllMobileKeys = releaseAllMobileKeys;
  window.showMobileToast = showMobileToast;

  initTouchControls();
})();
