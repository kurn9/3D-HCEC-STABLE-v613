window.addEventListener('keydown', (event) => {
  keys[event.code] = true;

  if (event.code === 'Escape') closeModal();

  if (event.code === 'KeyV' && !modalOpen) {
    toggleViewMode();
  }

  if (event.code === 'KeyC' && !modalOpen) {
    const tagName = String(event.target?.tagName || '').toLowerCase();
    const isTypingField = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    if (!isTypingField && typeof cycleCameraShoulderMode === 'function') {
      cycleCameraShoulderMode();
    }
  }

  if (event.code === 'KeyE' && !modalOpen && avatar && viewMode === 'third') {
    if (isSitting) standUpFromSeat();
    else sitOnNearestSeat();
  }
});
window.addEventListener('keyup', (event) => { keys[event.code] = false; });


let mobileCanvasTapStart = null;

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (!window.viewerMobileDevice?.isMobileViewer?.()) return;
  if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
  if (event.target?.closest?.('.mobile-touch-controls, .mobile-fullscreen-btn, #artworkListPanel, #modalOverlay, #wallVideoCinemaOverlay, #imageLightbox, #miniMapPanel, .viewer-home-link, #artworkListToggle')) return;
  mobileCanvasTapStart = { x: event.clientX, y: event.clientY, t: performance.now(), id: event.pointerId };
}, { passive: true });

renderer.domElement.addEventListener('pointerup', (event) => {
  if (!window.viewerMobileDevice?.isMobileViewer?.() || !mobileCanvasTapStart) return;
  if (event.pointerId !== mobileCanvasTapStart.id) return;
  const moved = Math.hypot(event.clientX - mobileCanvasTapStart.x, event.clientY - mobileCanvasTapStart.y);
  const duration = performance.now() - mobileCanvasTapStart.t;
  mobileCanvasTapStart = null;
  if (moved > 10 || duration > 420) return;
  if (typeof modalOpen !== 'undefined' && modalOpen) return;
  if (typeof window.openArtworkAtClientPoint === 'function' && window.openArtworkAtClientPoint(event.clientX, event.clientY)) {
    window.releaseAllMobileKeys?.();
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (typeof window.openWallVideoCinemaAtClientPoint === 'function' && window.openWallVideoCinemaAtClientPoint(event.clientX, event.clientY)) {
    window.releaseAllMobileKeys?.();
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  window.clearArtworkFocus?.();
}, { passive: false });

renderer.domElement.addEventListener('click', (event) => {
  if (modalOpen) return;

  const isMobileTouchViewer = Boolean(window.viewerMobileDevice?.isMobileViewer?.());

  if (isMobileTouchViewer) {
    window.enableMobileViewerSession?.({ quiet: true });
    if (typeof window.openArtworkAtClientPoint === 'function' && window.openArtworkAtClientPoint(event.clientX, event.clientY)) {
      window.releaseAllMobileKeys?.();
      event.stopPropagation();
      return;
    }
    if (typeof window.openWallVideoCinemaAtClientPoint === 'function' && window.openWallVideoCinemaAtClientPoint(event.clientX, event.clientY)) {
      window.releaseAllMobileKeys?.();
      event.stopPropagation();
      return;
    }
    window.clearArtworkFocus?.();
    return;
  }

  if (isLocked) {
    const root = checkArtworkAtCenter(true);
    if (root) {
      event.stopPropagation();
      openModal(root);
    }
    return;
  }

  const hoverRoot = checkArtworkAtMouse(true);
  if (hoverRoot) {
    openModal(hoverRoot);
  } else {
    renderer.domElement.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  isLocked = document.pointerLockElement === renderer.domElement;
  if (isLocked) {
    targetYaw = yaw;
    targetPitch = pitch;
    startHint.classList.add('hidden');
    setStatus(`✅ <strong>Đang tham quan</strong><br>WASD: di chuyển<br>Chuột: nhìn xung quanh<br>E: ngồi/xuống ghế khi gần ghế<br>Click vào tranh: mở chi tiết hiện đại<br>V: đổi góc nhìn · C: đổi vai camera · Shift: đi nhanh · ESC: thoát / đóng`);
  } else {
    startHint.classList.remove('hidden');
    setStatus(`Click vào màn hình 3D để tham quan<br>WASD: điều khiển avatar · E: ngồi ghế · V: đổi góc nhìn · C: đổi vai camera<br>Ở chế độ avatar, tâm màn hình sẽ ngắm về phía trước để chọn tranh<br>Tác phẩm đã load: ${artworkRoots.length}`);
  }
});

document.addEventListener('mousemove', (event) => {
  if (isLocked && !modalOpen) {
    const maxDelta = Math.max(10, Number(CONFIG.maxLookDelta || 28));
    const rawDx = Number(event.movementX || 0);
    const rawDy = Number(event.movementY || 0);
    const absurdDelta = maxDelta * 6;
    if (Math.abs(rawDx) > absurdDelta || Math.abs(rawDy) > absurdDelta) {
      const budget = window.__viewerFrameBudget || (window.__viewerFrameBudget = {});
      budget.lastFastTurnAt = performance.now();
      budget.lastLookDelta = Math.hypot(rawDx, rawDy);
      targetYaw = yaw;
      targetPitch = pitch;
      return;
    }
    const dx = THREE.MathUtils.clamp(rawDx, -maxDelta, maxDelta);
    const dy = THREE.MathUtils.clamp(rawDy, -maxDelta, maxDelta);
    const turnAmount = Math.hypot(dx, dy);
    const budget = window.__viewerFrameBudget || (window.__viewerFrameBudget = {});
    budget.lastLookDelta = turnAmount;
    if (turnAmount >= Number(CONFIG.cameraFastTurnThreshold || 18)) {
      budget.lastFastTurnAt = performance.now();
    }
    targetYaw -= dx * CONFIG.lookSensitivity;
    targetPitch -= dy * CONFIG.lookSensitivity;
    const limit = Math.PI / 2 - 0.08;
    targetPitch = THREE.MathUtils.clamp(targetPitch, -limit, limit);
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  mouseNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
});

modalCloseBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (event) => {
  if (event.target === modalOverlay) closeModal();
});
modalImage.addEventListener('click', () => {
  if (modalImage.src) window.open(modalImage.src, '_blank', 'noopener');
});
