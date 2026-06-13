let wallVideoCinemaState = null;

function isLegacyWallVideoDisabled() {
  return typeof CONFIG !== 'undefined' && CONFIG.wallVideoEnabled === false;
}

function getWallVideoCinemaElements() {
  return {
    overlay: document.getElementById('wallVideoCinemaOverlay'),
    shell: document.querySelector('#wallVideoCinemaOverlay .wall-video-cinema-shell'),
    closeBtn: document.getElementById('wallVideoCinemaClose'),
    video: document.getElementById('wallVideoCinemaVideo'),
    title: document.getElementById('wallVideoCinemaTitle'),
  };
}

function isWallVideoCinemaOpen() {
  return Boolean(wallVideoCinemaState?.isOpen);
}

function getWallVideoClickIntersections(eventOrPoint) {
  if (isLegacyWallVideoDisabled()) return [];
  const targets = Array.isArray(window.wallVideoInteractables) ? window.wallVideoInteractables.filter(Boolean) : [];
  if (!targets.length || typeof THREE === 'undefined' || typeof camera === 'undefined') return [];

  const raycaster = wallVideoCinemaState?.raycaster || new THREE.Raycaster();
  const pointer = wallVideoCinemaState?.pointer || new THREE.Vector2();
  const hasClientPoint = Number.isFinite(eventOrPoint?.clientX) && Number.isFinite(eventOrPoint?.clientY);

  if (!hasClientPoint && typeof isLocked !== 'undefined' && isLocked) {
    pointer.set(0, 0);
  } else if (renderer?.domElement && hasClientPoint) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((eventOrPoint.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((eventOrPoint.clientY - rect.top) / rect.height) * 2 + 1;
  } else if (renderer?.domElement && eventOrPoint) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((eventOrPoint.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((eventOrPoint.clientY - rect.top) / rect.height) * 2 + 1;
  } else {
    return [];
  }

  raycaster.near = 0.05;
  raycaster.far = Number(CONFIG.wallVideoRaycastFar) || 45;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(targets, true);
}

function isUiClick(event) {
  return Boolean(event.target?.closest?.('#wallVideoCinemaOverlay, #modalOverlay, #imageLightbox, #artworkListPanel, #artworkListToggle, #miniMapPanel, .mobile-touch-controls, .mobile-fullscreen-btn'));
}

function handleWallVideoCanvasClick(event) {
  if (isLegacyWallVideoDisabled()) return;
  if (isWallVideoCinemaOpen()) return;
  if (typeof modalOpen !== 'undefined' && modalOpen) return;
  if (isUiClick(event)) return;

  const hits = getWallVideoClickIntersections(event);
  if (!hits.length) return;

  const hit = hits.find((item) => item.object?.userData?.type === 'wallVideoPanel' || item.object?.parent?.userData?.type === 'wallVideoPanel') || hits[0];
  if (!hit) return;

  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
  openWallVideoCinema();
}


function openWallVideoCinemaAtClientPoint(clientX, clientY) {
  if (isLegacyWallVideoDisabled()) return false;
  if (isWallVideoCinemaOpen()) return false;
  if (typeof modalOpen !== 'undefined' && modalOpen) return false;
  let hits = getWallVideoClickIntersections({ clientX, clientY });
  if (!hits.length && window.viewerMobileDevice?.isMobileViewer?.()) {
    hits = getWallVideoClickIntersections({});
  }
  if (!hits.length) return false;
  window.releaseAllMobileKeys?.();
  openWallVideoCinema();
  return true;
}


function openWallVideoCinemaAtCenter() {
  if (isLegacyWallVideoDisabled()) return false;
  if (isWallVideoCinemaOpen()) return false;
  if (typeof modalOpen !== 'undefined' && modalOpen) return false;
  const hits = getWallVideoClickIntersections({});
  if (!hits.length) return false;
  openWallVideoCinema();
  return true;
}

function showWallVideoCinemaStatus(html) {
  if (typeof statusEl !== 'undefined' && statusEl) statusEl.innerHTML = html;
  else if (typeof setStatus === 'function') setStatus(html);
}

function prepareWallVideoCinemaVideo(video) {
  const url = CONFIG.wallVideoUrl || './assets/videos/intro.mp4';
  if (typeof window.forceLoadWallVideoNow === 'function') {
    window.forceLoadWallVideoNow('cinema-open-before-30s');
  }
  if (video.getAttribute('src') !== url) video.src = url;
  video.controls = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.loop = false;
  video.muted = CONFIG.wallVideoCinemaMuted === true;
  video.volume = Math.max(0, Math.min(1, Number(CONFIG.wallVideoCinemaVolume) || 0.85));
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.load?.();
}

async function openWallVideoCinema() {
  if (isLegacyWallVideoDisabled()) return false;
  if (!wallVideoCinemaState) return;
  const { overlay, video, title } = wallVideoCinemaState.elements;
  if (!overlay || !video) return;

  if (document.pointerLockElement && typeof document.exitPointerLock === 'function') {
    document.exitPointerLock();
  }
  window.releaseAllMobileKeys?.();

  if (title) title.textContent = CONFIG.wallVideoCinemaTitle || 'Video giới thiệu';
  prepareWallVideoCinemaVideo(video);

  wallVideoCinemaState.isOpen = true;
  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('wall-video-cinema-open');

  if (typeof window.pauseAmbientAudioForMedia === 'function') {
    window.pauseAmbientAudioForMedia({ reason: 'wallVideoCinema' });
  }

  if (CONFIG.wallVideoCinemaAutoplay !== false) {
    try {
      await video.play();
    } catch (error) {
      // Trên iOS/Zalo in-app browser, autoplay có tiếng có thể bị chặn dù file video vẫn hợp lệ.
      // Không báo lỗi giả; người xem có thể bấm Play bằng native controls.
      if (video.error) {
        console.warn('Video cinema không phát được:', CONFIG.wallVideoUrl || './assets/videos/intro.mp4', video.error, error);
      }
    }
  }
}

function closeWallVideoCinema() {
  if (!wallVideoCinemaState?.isOpen) return;
  const { overlay, video } = wallVideoCinemaState.elements;
  window.releaseAllMobileKeys?.();

  wallVideoCinemaState.isOpen = false;
  if (overlay) {
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('wall-video-cinema-open');

  if (video) {
    video.pause();
    if (CONFIG.wallVideoCinemaResetOnClose !== false) {
      try { video.currentTime = 0; } catch (error) { /* no-op for unloaded media */ }
    }
  }

  if (typeof window.restoreAmbientAudioAfterMedia === 'function') {
    window.restoreAmbientAudioAfterMedia({ reason: 'wallVideoCinema' });
  }
}

function initWallVideoCinema() {
  if (isLegacyWallVideoDisabled()) return null;
  if (wallVideoCinemaState) return wallVideoCinemaState;

  const elements = getWallVideoCinemaElements();
  if (!elements.overlay || !elements.video) {
    console.warn('Wall Video Cinema chưa có DOM overlay/video. Bỏ qua init.');
    return null;
  }

  wallVideoCinemaState = {
    elements,
    isOpen: false,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
  };

  elements.closeBtn?.addEventListener('click', closeWallVideoCinema);
  elements.overlay.addEventListener('click', (event) => {
    if (event.target === elements.overlay) closeWallVideoCinema();
  });

  elements.video.addEventListener('error', () => {
    if (!isWallVideoCinemaOpen()) return;
    showWallVideoCinemaStatus('⚠️ <strong>Video chưa phát được</strong><br>Kiểm tra file <b>assets/videos/intro.mp4</b> và codec H.264/AAC cho iPhone Safari.');
  });

  window.addEventListener('keydown', (event) => {
    if (!isWallVideoCinemaOpen()) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeWallVideoCinema();
    }
  }, true);

  if (renderer?.domElement) {
    renderer.domElement.addEventListener('click', handleWallVideoCanvasClick, true);
  }

  return wallVideoCinemaState;
}

window.initWallVideoCinema = initWallVideoCinema;
window.openWallVideoCinema = openWallVideoCinema;
window.openWallVideoCinemaAtClientPoint = openWallVideoCinemaAtClientPoint;
window.openWallVideoCinemaAtCenter = openWallVideoCinemaAtCenter;
window.closeWallVideoCinema = closeWallVideoCinema;
window.isWallVideoCinemaOpen = isWallVideoCinemaOpen;
