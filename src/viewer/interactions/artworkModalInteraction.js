
const modalFocusBtn = document.getElementById('modalFocusBtn');
const metaAuthorWrap = document.getElementById('metaAuthorWrap');
const metaYearWrap = document.getElementById('metaYearWrap');
const metaMediumWrap = document.getElementById('metaMediumWrap');
const metaRealSizeWrap = document.getElementById('metaRealSizeWrap');

function getGroundYAt(position) {
  if (walkableObjects.length === 0) return CONFIG.useFallbackFloorWhenNoWalkable ? fallbackFloorY : null;

  const origin = new THREE.Vector3(position.x, position.y + 2.0, position.z);
  groundRaycaster.set(origin, downVector);
  groundRaycaster.far = 6;

  // Ưu tiên ramp ẩn nếu có. Đây là cách game/Spatial xử lý cầu thang mượt:
  // nhân vật đi trên mặt ramp vô hình, không bám từng bậc thật.
  const priorityObjects = rampWalkableObjects.length > 0 ? rampWalkableObjects : walkableObjects;
  let hits = groundRaycaster.intersectObjects(priorityObjects, true);

  for (const hit of hits) {
    if (!hit.face) continue;
    const normal = hit.face.normal.clone();
    normal.transformDirection(hit.object.matrixWorld);
    if (normal.y > 0.25) return hit.point.y;
  }

  if (rampWalkableObjects.length > 0) {
    hits = groundRaycaster.intersectObjects(walkableObjects, true);
    for (const hit of hits) {
      if (!hit.face) continue;
      const normal = hit.face.normal.clone();
      normal.transformDirection(hit.object.matrixWorld);
      if (normal.y > 0.25) return hit.point.y;
    }
  }

  return null;
}

function hasColliderAhead(direction) {
  let blockers = colliderObjects.length > 0
    ? [...new Set([...colliderObjects, ...wallFallbackObjects])]
    : blockingObjects;

  // QUAN TRỌNG:
  // Không raycast chặn xa với COLLIDER_BENCH/SEAT/CHAIR.
  // Nếu raycast ghế ở khoảng 0.6m, avatar sẽ bị dừng quá xa.
  // Ghế được xử lý sát mép bằng body box collision bên dưới.
  blockers = blockers.filter((obj) => {
    const name = getObjectNameTrail(obj);
    if (isSeatColliderName(name)) return false;
    if (isStairOrWalkableHelperName(name)) return false;
    return true;
  });

  if (blockers.length === 0) return false;

  const basePosition = avatar && viewMode === 'third'
    ? avatar.position
    : new THREE.Vector3(camera.position.x, camera.position.y - CONFIG.eyeHeight, camera.position.z);

  const side = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
  const sideRadius = CONFIG.avatarCollisionRadius * 0.62;
  const offsets = [0, sideRadius, -sideRadius];

  for (const h of CONFIG.collisionRayHeights) {
    for (const offset of offsets) {
      const origin = new THREE.Vector3(
        basePosition.x + side.x * offset,
        basePosition.y + h,
        basePosition.z + side.z * offset
      );

      wallRaycaster.set(origin, direction);
      wallRaycaster.far = CONFIG.wallDistance * 0.72 + CONFIG.avatarCollisionRadius * 0.45;

      const hits = wallRaycaster.intersectObjects(blockers, true);

      for (const hit of hits) {
        if (!hit.face) return true;

        const normal = hit.face.normal.clone();
        normal.transformDirection(hit.object.matrixWorld).normalize();

        // Chặn mặt đứng/nghiêng; bỏ qua mặt ngang như sàn/trần/mặt ghế.
        if (Math.abs(normal.y) < 0.72) return true;
      }
    }
  }

  return false;
}


function safeExitPointerLock() {
  try {
    if (document.pointerLockElement && typeof document.exitPointerLock === 'function') {
      document.exitPointerLock();
    }
  } catch (error) {
    console.warn('Không thể thoát Pointer Lock trước khi mở popup tác phẩm:', error);
  }
}

function bumpViewerRaycastMetric(kind = 'artwork') {
  window.__viewerRaycastCount = (Number(window.__viewerRaycastCount) || 0) + 1;
  if (kind === 'touch') window.__viewerTouchRaycastCount = (Number(window.__viewerTouchRaycastCount) || 0) + 1;
}

const ARTWORK_FOCUS_STALE_CLEAR_MS = Math.max(260, Number(CONFIG.artworkFocusStaleClearMs || 850));
const ARTWORK_TAP_FALLBACK_MS = Math.max(0, Number(CONFIG.artworkTapFallbackMs || 320));
let lastInteractableRoot = null;
let lastInteractableRootAt = 0;
let focusStaleTimerId = 0;

function nowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
}

// v6.13.011 — Preview V2 focus scheduler.
// This file only schedules dwell/exit transitions. The loader owns hidden-video
// preflight and commits a surface texture only after a decoded frame is ready.
let sceneVideoPreviewV2TargetRoot = null;
let sceneVideoPreviewV2DwellTimer = 0;
let sceneVideoPreviewV2DwellRoot = null;
let sceneVideoPreviewV2MouseEvidence = false;

window.addEventListener('pointermove', (event) => {
  if (event?.pointerType === 'mouse') sceneVideoPreviewV2MouseEvidence = true;
}, { passive: true });
window.addEventListener('mousemove', () => {
  sceneVideoPreviewV2MouseEvidence = true;
}, { passive: true });

function isSceneVideoPreviewV2InteractionDebugEnabled() {
  if (CONFIG?.sceneVideoPreviewV2Debug === true) return true;
  try {
    return new URLSearchParams(window.location.search).get('debugSceneVideoPreviewV2') === '1';
  } catch (_) {
    return false;
  }
}

function logSceneVideoPreviewV2Interaction(event, root = null, detail = {}, level = 'debug') {
  if (!isSceneVideoPreviewV2InteractionDebugEnabled()) return;
  const fn = console[level] || console.debug || console.log;
  fn.call(console, `[SceneVideoPreviewV2] ${event}`, {
    id: String(root?.userData?.artData?.id || root?.name || ''),
    ...detail
  });
}

function isSceneVideoPreviewV2Root(root) {
  return Boolean(
    root?.userData?.type === 'artworkRoot'
    && root.userData?.artData?.type === 'video'
    && root.userData?.artData?.videoUrl
  );
}

function isSceneVideoPreviewV2DesktopEligible() {
  if (CONFIG?.sceneVideoPreviewV2Enabled === false) return false;
  if (CONFIG?.sceneVideoPreviewV2DesktopOnly === false) return true;
  if (window.viewerMobileDevice?.isMobileViewer?.()) return false;
  if (window.getViewerQualityState?.()?.isMobile) return false;
  if (document.body?.classList?.contains('viewer-mobile')) return false;

  let primaryFine = false;
  let anyFine = false;
  let primaryCoarse = false;
  try {
    primaryFine = Boolean(window.matchMedia?.('(pointer: fine)')?.matches);
    anyFine = Boolean(window.matchMedia?.('(any-pointer: fine)')?.matches);
    primaryCoarse = Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
  } catch (_) {}

  if (primaryFine || anyFine || sceneVideoPreviewV2MouseEvidence) return true;
  return !primaryCoarse && sceneVideoPreviewV2MouseEvidence;
}

function clearSceneVideoPreviewV2DwellTimer() {
  if (sceneVideoPreviewV2DwellTimer) window.clearTimeout(sceneVideoPreviewV2DwellTimer);
  sceneVideoPreviewV2DwellTimer = 0;
  sceneVideoPreviewV2DwellRoot = null;
}

function clearSceneVideoPreviewV2ExitTimer(root) {
  const timerId = Number(root?.userData?.sceneVideoPreviewV2ExitTimer || 0);
  if (timerId) window.clearTimeout(timerId);
  if (root?.userData) root.userData.sceneVideoPreviewV2ExitTimer = 0;
}

function scheduleSceneVideoPreviewV2Pause(root, source = 'focus-exit') {
  if (!isSceneVideoPreviewV2Root(root)) return;
  clearSceneVideoPreviewV2ExitTimer(root);
  // A background candidate that has not committed must be cancelled immediately
  // on focus exit. Cooldown applies only to an already visible preview frame.
  const cancelledPrepare = window.cancelSceneVideoPreviewV2Prepare?.(root, { reason: source }) === true;
  if (cancelledPrepare) return;
  const cooldownMs = Math.max(250, Math.min(1200, Number(CONFIG?.sceneVideoPreviewV2ExitCooldownMs || 350)));
  root.userData.sceneVideoPreviewV2ExitTimer = window.setTimeout(() => {
    root.userData.sceneVideoPreviewV2ExitTimer = 0;
    if (sceneVideoPreviewV2TargetRoot === root) return;
    const paused = window.pauseSceneVideoPreviewV2?.(root, { reason: source }) === true;
    if (paused) logSceneVideoPreviewV2Interaction('pause', root, { source });
  }, cooldownMs);
}

function scheduleSceneVideoPreviewV2Prepare(root, source = 'focus-enter') {
  if (!isSceneVideoPreviewV2Root(root) || !isSceneVideoPreviewV2DesktopEligible()) return;
  clearSceneVideoPreviewV2ExitTimer(root);
  clearSceneVideoPreviewV2DwellTimer();

  if (root.userData?.videoPlayer?.video) return;
  const suppressUntil = Number(root.userData?.sceneVideoPreviewV2SuppressUntil || 0);
  if (nowMs() < suppressUntil) return;

  const dwellMs = Math.max(450, Math.min(3000, Number(CONFIG?.sceneVideoPreviewV2DwellMs || 650)));
  sceneVideoPreviewV2DwellRoot = root;
  logSceneVideoPreviewV2Interaction('dwell-start', root, { dwellMs, source });
  sceneVideoPreviewV2DwellTimer = window.setTimeout(() => {
    sceneVideoPreviewV2DwellTimer = 0;
    sceneVideoPreviewV2DwellRoot = null;
    if (sceneVideoPreviewV2TargetRoot !== root) return;
    if (!isSceneVideoPreviewV2DesktopEligible()) return;
    if (modalOpen) return;
    if (document.body?.classList?.contains('viewer-scene-video-open')) return;
    if (nowMs() < Number(root.userData?.sceneVideoPreviewV2SuppressUntil || 0)) return;
    if (typeof window.prepareSceneVideoPreviewV2 !== 'function') return;

    window.prepareSceneVideoPreviewV2(root, { source: 'gaze-dwell' })
      .then((ok) => {
        logSceneVideoPreviewV2Interaction(ok ? 'preview-play' : 'prepare-not-committed', root, { source });
      })
      .catch((error) => {
        logSceneVideoPreviewV2Interaction('fail', root, { reason: error?.message || 'prepare-rejected' }, 'warn');
      });
  }, dwellMs);
}

function setSceneVideoPreviewV2Target(root, source = 'focus') {
  const nextRoot = isSceneVideoPreviewV2Root(root) && isSceneVideoPreviewV2DesktopEligible() ? root : null;
  if (sceneVideoPreviewV2TargetRoot === nextRoot) return;

  const previousRoot = sceneVideoPreviewV2TargetRoot;
  sceneVideoPreviewV2TargetRoot = nextRoot;
  if (previousRoot?.userData) previousRoot.userData.sceneVideoPreviewV2TargetActive = false;
  if (nextRoot?.userData) nextRoot.userData.sceneVideoPreviewV2TargetActive = true;
  clearSceneVideoPreviewV2DwellTimer();
  if (previousRoot) scheduleSceneVideoPreviewV2Pause(previousRoot, source);
  if (nextRoot) scheduleSceneVideoPreviewV2Prepare(nextRoot, source);
}

function refreshSceneVideoPreviewV2Target(source = 'focus') {
  const activeRoot = isLocked ? currentFocusedRoot : hoveredRoot;
  setSceneVideoPreviewV2Target(activeRoot, source);
}

function releaseSceneVideoPreviewV2ForActivation(root, options = {}) {
  clearSceneVideoPreviewV2DwellTimer();
  clearSceneVideoPreviewV2ExitTimer(root);
  if (sceneVideoPreviewV2TargetRoot === root) sceneVideoPreviewV2TargetRoot = null;
  if (root?.userData) root.userData.sceneVideoPreviewV2TargetActive = false;
  return window.releaseSceneVideoPreviewV2ForUserAction?.(root, options) === true;
}

// Pause/cancel Preview V2 for every cinema entry point, including artwork-list
// actions that call window.openSceneVideoCinema directly. The cinema module itself
// remains unchanged.
if (typeof window.openSceneVideoCinema === 'function' && window.openSceneVideoCinema.__previewV2Wrapped !== true) {
  const openSceneVideoCinemaBaseline = window.openSceneVideoCinema;
  const openSceneVideoCinemaWithPreviewV2Guard = function openSceneVideoCinemaWithPreviewV2Guard(input) {
    const root = input?.userData?.artData ? input : null;
    if (root) releaseSceneVideoPreviewV2ForActivation(root, { reason: 'cinema-open', preserveFrame: true });
    return openSceneVideoCinemaBaseline(input);
  };
  openSceneVideoCinemaWithPreviewV2Guard.__previewV2Wrapped = true;
  window.openSceneVideoCinema = openSceneVideoCinemaWithPreviewV2Guard;
}

function isValidArtworkRoot(root) {
  return Boolean(root?.userData?.type === 'artworkRoot' && root.userData?.artData);
}

function rememberInteractableRoot(root) {
  if (!isValidArtworkRoot(root)) return;
  lastInteractableRoot = root;
  lastInteractableRootAt = nowMs();
}

function getRecentInteractableRoot(maxAgeMs = ARTWORK_TAP_FALLBACK_MS) {
  const root = isValidArtworkRoot(currentFocusedRoot) ? currentFocusedRoot : lastInteractableRoot;
  if (!isValidArtworkRoot(root)) return null;
  const age = nowMs() - lastInteractableRootAt;
  if (age > maxAgeMs) return null;
  return root;
}

function clearFocusStaleTimer() {
  if (!focusStaleTimerId) return;
  clearTimeout(focusStaleTimerId);
  focusStaleTimerId = 0;
}

function resetArtworkRootVisualState(root) {
  if (!isValidArtworkRoot(root) || root === openedRoot) return;
  root.userData.emphasis = 0;
  const display = root.userData.display;
  if (display) {
    display.position.z = 0;
    display.scale.set(1, 1, 1);
    display.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        if (!mat || child.userData?.isGlowOutline) return;
        if ('emissiveIntensity' in mat) {
          mat.emissiveIntensity = 0;
          mat.needsUpdate = true;
        }
      });
    });
  }
  const outline = root.userData.glowOutline;
  if (outline) {
    outline.visible = false;
    outline.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      child.material.opacity = 0;
      child.material.needsUpdate = true;
    });
  }
}

function clearArtworkFocus(options = {}) {
  const previous = currentFocusedRoot;
  currentFocusedRoot = null;
  if (previous) resetArtworkRootVisualState(previous);
  if (options.clearHover !== false && hoveredRoot === previous) hoveredRoot = null;
  if (options.keepRecent !== true) {
    lastInteractableRoot = null;
    lastInteractableRootAt = 0;
  }
  crosshair?.classList?.toggle('target', false);
  if (options.hideCard !== false) updateFocusCard(null);
  refreshSceneVideoPreviewV2Target('focus-clear');
}

function scheduleFocusStaleGuard(root) {
  clearFocusStaleTimer();
  if (!isValidArtworkRoot(root)) return;
  focusStaleTimerId = window.setTimeout(() => {
    focusStaleTimerId = 0;
    if (modalOpen) return;
    if (currentFocusedRoot !== root) return;
    const age = nowMs() - lastInteractableRootAt;
    if (age >= ARTWORK_FOCUS_STALE_CLEAR_MS - 20) {
      clearArtworkFocus();
    }
  }, ARTWORK_FOCUS_STALE_CLEAR_MS);
}

function setFocusedArtworkRoot(root, options = {}) {
  if (isValidArtworkRoot(root)) {
    const previous = currentFocusedRoot;
    if (previous && previous !== root) resetArtworkRootVisualState(previous);
    if (hoveredRoot && hoveredRoot !== root && hoveredRoot !== previous) resetArtworkRootVisualState(hoveredRoot);
    currentFocusedRoot = root;
    rememberInteractableRoot(root);
    crosshair?.classList?.toggle('target', !modalOpen);
    if (options.updateCard !== false) updateFocusCard(root);
    scheduleFocusStaleGuard(root);
    refreshSceneVideoPreviewV2Target('center-focus');
    return root;
  }

  clearArtworkFocus({
    hideCard: options.hideCard !== false,
    keepRecent: options.keepRecent === true,
    clearHover: options.clearHover !== false
  });
  return null;
}

function resolveArtworkTapFallback() {
  return getRecentInteractableRoot(ARTWORK_TAP_FALLBACK_MS);
}


function getRoomIdForFocusProbe() {
  return String(CONFIG?.currentRoomId || '').toLowerCase();
}

function resolveFirstArtworkRootFromHits(hits = []) {
  for (const hit of hits) {
    const root = getArtworkRootFromObject(hit?.object);
    if (isValidArtworkRoot(root)) return root;
  }
  return null;
}

function raycastArtworkRootAtNdc(ndc, far = 40) {
  artRaycaster.setFromCamera(ndc, camera);
  artRaycaster.far = far;
  return resolveFirstArtworkRootFromHits(artRaycaster.intersectObjects(interactiveArtworkMeshes, true));
}

function getCenterArtworkFocusRoot() {
  const far = CONFIG.artworkCenterRaycastFar || 40;
  const center = new THREE.Vector2(0, 0);
  const directRoot = raycastArtworkRootAtNdc(center, far);
  if (directRoot) return directRoot;

  // K_O_G_C_C: outdoor GLB + mobile frame budget can make aim feel unforgiving.
  // Use a tiny fallback cross around screen center only for outdoor focus probing.
  if (getRoomIdForFocusProbe() !== 'outdoor') return null;
  const radius = Math.max(0.006, Math.min(0.035, Number(CONFIG.artworkCenterProbeNdcRadius || 0.018)));
  const samples = [
    new THREE.Vector2(radius, 0),
    new THREE.Vector2(-radius, 0),
    new THREE.Vector2(0, radius),
    new THREE.Vector2(0, -radius),
    new THREE.Vector2(radius * 0.7, radius * 0.7),
    new THREE.Vector2(-radius * 0.7, radius * 0.7),
    new THREE.Vector2(radius * 0.7, -radius * 0.7),
    new THREE.Vector2(-radius * 0.7, -radius * 0.7)
  ];
  for (const sample of samples) {
    const root = raycastArtworkRootAtNdc(sample, far);
    if (root) return root;
  }
  return null;
}

function checkArtworkAtCenter(returnRoot = false) {
  if (!artworksLoaded || interactiveArtworkMeshes.length === 0) {
    setFocusedArtworkRoot(null);
    return null;
  }
  bumpViewerRaycastMetric('artwork');
  const root = getCenterArtworkFocusRoot();
  setFocusedArtworkRoot(root);
  return returnRoot ? root : root?.userData?.artData || null;
}

function checkArtworkAtMouse(returnRoot = false) {
  if (!artworksLoaded || interactiveArtworkMeshes.length === 0 || isLocked) {
    if (hoveredRoot && hoveredRoot !== currentFocusedRoot) resetArtworkRootVisualState(hoveredRoot);
    hoveredRoot = null;
    renderer.domElement.style.cursor = 'default';
    refreshSceneVideoPreviewV2Target('mouse-disabled');
    return null;
  }
  bumpViewerRaycastMetric('artwork');
  const nextHoveredRoot = raycastArtworkRootAtNdc(mouseNdc, CONFIG.artworkMouseRaycastFar || 40);
  if (hoveredRoot && hoveredRoot !== nextHoveredRoot && hoveredRoot !== currentFocusedRoot) resetArtworkRootVisualState(hoveredRoot);
  hoveredRoot = nextHoveredRoot;
  if (hoveredRoot) rememberInteractableRoot(hoveredRoot);
  renderer.domElement.style.cursor = hoveredRoot ? 'pointer' : 'default';
  refreshSceneVideoPreviewV2Target('mouse-hover');
  return returnRoot ? hoveredRoot : hoveredRoot?.userData?.artData || null;
}


function checkArtworkAtClientPoint(clientX, clientY, returnRoot = false) {
  if (!artworksLoaded || interactiveArtworkMeshes.length === 0 || !renderer?.domElement) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );

  bumpViewerRaycastMetric('touch');
  const root = raycastArtworkRootAtNdc(pointer, CONFIG.artworkMouseRaycastFar || CONFIG.artworkCenterRaycastFar || 40);

  setFocusedArtworkRoot(root);
  return returnRoot ? root : root?.userData?.artData || null;
}


let lastSceneVideoActivationRoot = null;
let lastSceneVideoActivationAt = 0;

function activateSceneVideoRoot(root) {
  const data = root?.userData?.artData || {};
  if (!root || data.type !== 'video') return false;

  const now = performance.now();
  const doubleActivation = lastSceneVideoActivationRoot === root && (now - lastSceneVideoActivationAt) <= 420;
  lastSceneVideoActivationRoot = root;
  lastSceneVideoActivationAt = now;

  if (doubleActivation && typeof window.openSceneVideoCinema === 'function') {
    window.openSceneVideoCinema(root);
    return true;
  }

  if (typeof window.toggleSceneVideoRoot === 'function') {
    // Preview V2 never owns click playback. Release/cancel the background
    // candidate first, then execute the unchanged baseline surface toggle.
    releaseSceneVideoPreviewV2ForActivation(root, { reason: 'user-click', preserveFrame: false });
    const ok = window.toggleSceneVideoRoot(root);
    if (ok) setStatus('▶️ <strong>Video</strong><br>Click để phát/tạm dừng · nhấp đúp để xem lớn.');
    return ok;
  }
  return false;
}

window.openFocusedSceneVideoCinema = function openFocusedSceneVideoCinema() {
  const root = checkArtworkAtCenter(true) || resolveArtworkTapFallback();
  if (root?.userData?.artData?.type === 'video' && typeof window.openSceneVideoCinema === 'function') {
    return window.openSceneVideoCinema(root);
  }
  return false;
};

function openArtworkAtClientPoint(clientX, clientY) {
  if (modalOpen) return false;
  const root = checkArtworkAtClientPoint(clientX, clientY, true);

  // K_O_G_C_B: a real tap/click point is the source of truth.
  // Do not reopen stale center/current focus when the actual hit test missed.
  if (!root) return false;
  window.releaseAllMobileKeys?.();
  const data = root.userData?.artData || {};
  if (data.type === 'video') {
    return activateSceneVideoRoot(root);
  }
  openModal(root);
  return true;
}

function openCurrentFocusedArtwork() {
  if (modalOpen) return false;
  const root = checkArtworkAtCenter(true) || resolveArtworkTapFallback();
  if (!root) return false;
  const data = root.userData?.artData || {};
  if (data.type === 'video') {
    return activateSceneVideoRoot(root);
  }
  openModal(root);
  return true;
}

window.checkArtworkAtClientPoint = checkArtworkAtClientPoint;
window.openArtworkAtClientPoint = openArtworkAtClientPoint;
window.openCurrentFocusedArtwork = openCurrentFocusedArtwork;
window.clearArtworkFocus = clearArtworkFocus;

function valueOrUpdating(value) {
  const text = String(value || '').trim();
  return text || 'Đang cập nhật';
}

function setMetaField(wrapper, valueElement, value) {
  if (!wrapper || !valueElement) return;
  const text = String(value || '').trim();
  if (!text) {
    wrapper.classList.add('modal-hidden');
    valueElement.textContent = 'Đang cập nhật';
    return;
  }
  wrapper.classList.remove('modal-hidden');
  valueElement.textContent = text;
}


function getModalMediaSrc(data = {}) {
  if (window.cmsContentLoader?.getArtworkMediaSrc) return window.cmsContentLoader.getArtworkMediaSrc(data);
  return String(
    data?.image ||
    data?.imageUrl ||
    data?.image_url ||
    data?.thumbnail ||
    data?.thumbnail_url ||
    data?.src ||
    data?.poster ||
    data?.posterUrl ||
    data?.poster_url ||
    ''
  ).trim();
}

function getModalLargeMediaSrc(data = {}) {
  return String(
    data?.imageLarge ||
    data?.largeImage ||
    data?.large_image ||
    data?.fullImage ||
    getModalMediaSrc(data)
  ).trim();
}

function openModal(root) {
  if (!root) return;
  const data = root.userData.artData || {};
  if (data.type === 'video') {
    activateSceneVideoRoot(root);
    return;
  }
  if (!data.clickable) return;

  safeExitPointerLock();
  window.releaseAllMobileKeys?.();
  modalOpen = true;
  openedRoot = root;
  document.body.classList.add('viewer-modal-open');
  setStatus(`🖼️ <strong>Đang xem ảnh</strong>`);

  const itemType = data.type || 'artwork';
  const title = data.title || data.id || 'Tác phẩm';
  const image = getModalMediaSrc(data);
  const imageLarge = getModalLargeMediaSrc(data);
  const material = data.material || data.medium || '';
  const description = String(data.description || '').trim();
  const content = String(data.content || '').trim();

  const typeLabel = itemType === 'logo' ? 'Logo' : itemType === 'text' ? 'Chữ' : itemType === 'video' ? 'Video' : 'Tác phẩm';
  modalBadge.textContent = data.group || typeLabel;
  modalTag.textContent = material ? `Chi tiết · ${material}` : `Chi tiết ${typeLabel.toLowerCase()}`;
  modalTitle.textContent = title;
  modalShortDesc.textContent = description || (itemType === 'text' ? (data.text || 'Nội dung chữ đang được cập nhật.') : 'Mô tả ngắn đang được cập nhật.');

  setMetaField(metaAuthorWrap, metaAuthor, data.author);
  setMetaField(metaYearWrap, metaYear, data.year);
  setMetaField(metaMediumWrap, metaMedium, material);
  setMetaField(metaRealSizeWrap, metaRealSize, data.realSize);

  modalContent.textContent = content || data.text || data.videoUrl || 'Thông tin thuyết minh đang được cập nhật.';
  modalContent.scrollTop = 0;

  modalImage.loading = 'lazy';
  modalImage.decoding = 'async';
  if (image) {
    modalImage.src = image;
    modalImage.dataset.fullImage = imageLarge || image;
  } else {
    modalImage.removeAttribute('src');
    modalImage.dataset.fullImage = '';
  }
  modalImage.alt = title;

  if (openImageBtn) {
    openImageBtn.dataset.image = imageLarge || image || '';
    openImageBtn.disabled = !(imageLarge || image);
  }

  if (modalFocusBtn) {
    modalFocusBtn.dataset.id = data.id || root.name || '';
    modalFocusBtn.disabled = !(data.id || root.name);
  }

  modalOverlay.classList.add('active');
  hideFocusCard();
}

function closeModal() {
  if (!modalOpen) return;
  modalOpen = false;
  openedRoot = null;
  document.body.classList.remove('viewer-modal-open');
  modalOverlay.classList.remove('active');
  window.releaseAllMobileKeys?.();
  crosshair.classList.toggle('target', !!currentFocusedRoot && isLocked);

  if (isSitting) {
    setStatus(`✅ <strong>Đang ngồi ngắm cảnh</strong>`);
  } else if (isLocked) {
    setStatus(`✅ <strong>Đang tham quan</strong>`);
  } else {
    setStatus(`✅ <strong>Sẵn sàng tham quan</strong>`);
  }
}


if (modalFocusBtn) {
  modalFocusBtn.addEventListener('click', () => {
    const targetId = modalFocusBtn.dataset.id;
    if (targetId && typeof focusArtworkById === 'function') {
      focusArtworkById(targetId, { openModalAfterFocus: false });
    }
  });
}

window.checkArtworkAtClientPoint = checkArtworkAtClientPoint;
window.openArtworkAtClientPoint = openArtworkAtClientPoint;


