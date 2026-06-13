let wallVideoPanelState = null;

function isMobileDeferredWallVideo() {
  return Boolean(window.isViewerMobileFastLoad?.() && CONFIG?.mobile?.deferWallVideoOnMobile !== false);
}

function getWallVideoConfigNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getWallVideoVector3(values, fallback = [0, 0, 0]) {
  const source = Array.isArray(values) && values.length >= 3 ? values : fallback;
  return new THREE.Vector3(
    getWallVideoConfigNumber(source[0], fallback[0]),
    getWallVideoConfigNumber(source[1], fallback[1]),
    getWallVideoConfigNumber(source[2], fallback[2])
  );
}

function getWallVideoEuler(values, fallback = [0, 0, 0]) {
  const source = Array.isArray(values) && values.length >= 3 ? values : fallback;
  return new THREE.Euler(
    getWallVideoConfigNumber(source[0], fallback[0]),
    getWallVideoConfigNumber(source[1], fallback[1]),
    getWallVideoConfigNumber(source[2], fallback[2]),
    'XYZ'
  );
}

function getWallVideoNormal(rotation) {
  return new THREE.Vector3(0, 0, 1).applyEuler(rotation).normalize();
}

function ensureWallVideoInteractables() {
  if (!Array.isArray(window.wallVideoInteractables)) window.wallVideoInteractables = [];
  return window.wallVideoInteractables;
}

function registerWallVideoInteractable(object) {
  const list = ensureWallVideoInteractables();
  if (object && !list.includes(object)) list.push(object);
}

function unregisterWallVideoInteractable(object) {
  if (!Array.isArray(window.wallVideoInteractables)) return;
  window.wallVideoInteractables = window.wallVideoInteractables.filter((item) => item !== object);
}

function createWallVideoFallbackTexture(message = 'Đang tải video…') {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 576;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#111827');
  gradient.addColorStop(1, '#030712');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let x = 0; x < canvas.width; x += 64) ctx.fillRect(x, 0, 1, canvas.height);
  for (let y = 0; y < canvas.height; y += 64) ctx.fillRect(0, y, canvas.width, 1);

  ctx.fillStyle = '#e8c06d';
  ctx.font = '700 42px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, canvas.width / 2, canvas.height / 2 - 18);

  ctx.fillStyle = 'rgba(244,246,251,0.72)';
  ctx.font = '500 24px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('assets/videos/intro.mp4', canvas.width / 2, canvas.height / 2 + 34);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createWallVideoTexture(video) {
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createWallVideoFrame(width, height) {
  const group = new THREE.Group();
  group.name = 'WALL_VIDEO_FRAME';

  const padding = getWallVideoConfigNumber(CONFIG.wallVideoFramePadding, 0.08);
  const depth = getWallVideoConfigNumber(CONFIG.wallVideoFrameDepth, 0.025);
  const border = Math.max(0.035, padding * 0.45);
  const material = new THREE.MeshStandardMaterial({
    color: CONFIG.wallVideoFrameColor ?? 0x111111,
    roughness: 0.58,
    metalness: 0.18,
  });

  const outerWidth = width + padding * 2;
  const outerHeight = height + padding * 2;

  const topBottomGeometry = new THREE.BoxGeometry(outerWidth, border, depth);
  const sideGeometry = new THREE.BoxGeometry(border, outerHeight, depth);

  const top = new THREE.Mesh(topBottomGeometry, material);
  const bottom = new THREE.Mesh(topBottomGeometry, material);
  const left = new THREE.Mesh(sideGeometry, material);
  const right = new THREE.Mesh(sideGeometry, material);

  top.position.set(0, height / 2 + padding - border / 2, -depth / 2);
  bottom.position.set(0, -height / 2 - padding + border / 2, -depth / 2);
  left.position.set(-width / 2 - padding + border / 2, 0, -depth / 2);
  right.position.set(width / 2 + padding - border / 2, 0, -depth / 2);

  group.add(top, bottom, left, right);
  return group;
}

function createWallVideoMesh(texture) {
  const size = Array.isArray(CONFIG.wallVideoSize) ? CONFIG.wallVideoSize : [3.4, 1.91];
  const width = getWallVideoConfigNumber(size[0], 3.4);
  const height = getWallVideoConfigNumber(size[1], 1.91);

  const group = new THREE.Group();
  group.name = 'WALL_VIDEO_PANEL';

  const rotation = getWallVideoEuler(CONFIG.wallVideoRotation, [0, 1.5708, 0]);
  const position = getWallVideoVector3(CONFIG.wallVideoPosition, [10.22, 1.18, -0.04]);
  const normal = getWallVideoNormal(rotation);
  const wallOffset = getWallVideoConfigNumber(CONFIG.wallVideoWallOffset, 0.04);

  group.position.copy(position).addScaledVector(normal, wallOffset);
  group.rotation.copy(rotation);

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const emissiveBoost = getWallVideoConfigNumber(CONFIG.wallVideoEmissiveBoost, 0.65);
  material.color.setScalar(Math.max(0.7, Math.min(1.5, 1 + emissiveBoost * 0.25)));

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  screen.name = 'WALL_VIDEO_SCREEN';
  screen.position.z = getWallVideoConfigNumber(CONFIG.wallVideoFrameDepth, 0.025) / 2 + 0.003;
  screen.userData.type = 'wallVideoPanel';
  screen.userData.clickable = true;
  screen.userData.videoUrl = CONFIG.wallVideoUrl || './assets/videos/intro.mp4';
  group.add(screen);

  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.16, height + 0.16, getWallVideoConfigNumber(CONFIG.wallVideoFrameDepth, 0.025)),
    new THREE.MeshStandardMaterial({
      color: CONFIG.wallVideoFrameColor ?? 0x111111,
      roughness: 0.7,
      metalness: 0.08,
    })
  );
  backing.name = 'WALL_VIDEO_BACKING';
  backing.position.z = -getWallVideoConfigNumber(CONFIG.wallVideoFrameDepth, 0.025) / 2;
  group.add(backing);

  group.add(createWallVideoFrame(width, height));

  return { group, screen, material };
}

function notifyWallVideoMissing() {
  const message = 'Chưa tìm thấy hoặc trình duyệt không đọc được video intro tại assets/videos/intro.mp4';
  console.warn(`${message}. Nếu lỗi chỉ xảy ra trên iPhone Safari, hãy kiểm tra codec video: Safari cần H.264/AAC thay vì AV1.`);
  if (CONFIG.wallVideoShowStatusOnError && typeof setStatus === 'function') {
    setStatus(`⚠️ <strong>Video đang cập nhật</strong><br>${message}`);
  }
}

function createWallVideoElement({ deferSource = false } = {}) {
  const video = document.createElement('video');
  video.muted = CONFIG.wallVideoMuted !== false;
  video.defaultMuted = video.muted;
  video.loop = CONFIG.wallVideoLoop !== false;
  video.playsInline = true;
  video.preload = deferSource ? 'none' : 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.style.display = 'none';
  document.body.appendChild(video);

  if (!deferSource) {
    attachWallVideoSourceToElement(video, 'desktop-init', 'auto');
    try { video.load(); } catch {}
  }

  return video;
}

function attachWallVideoSourceToElement(video, reason = 'attach', preload = 'metadata') {
  if (!video) return false;
  const url = CONFIG.wallVideoUrl || './assets/videos/intro.mp4';
  if (video.getAttribute('src') === url) return true;
  video.preload = preload;
  video.src = url;
  try {
    const videoUrl = new URL(video.src, window.location.href);
    if (videoUrl.origin !== window.location.origin) video.crossOrigin = 'anonymous';
  } catch {
    // Local relative video path does not need CORS.
  }
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  console.info('[WallVideo] attach source:', reason, url);
  return true;
}

function attachWallVideoSource(reason = 'scheduled', preload = 'metadata') {
  if (!wallVideoPanelState || wallVideoPanelState.disposed) return false;
  if (wallVideoPanelState.hasWallVideoSrcAttached) return true;
  wallVideoPanelState.hasWallVideoSrcAttached = attachWallVideoSourceToElement(wallVideoPanelState.video, reason, preload);
  if (wallVideoPanelState.hasWallVideoSrcAttached) {
    wallVideoPanelState.material.map = createWallVideoFallbackTexture('Đang tải video…');
    wallVideoPanelState.material.needsUpdate = true;
    try { wallVideoPanelState.video.load(); } catch {}
  }
  return wallVideoPanelState.hasWallVideoSrcAttached;
}

function tryPlayWallVideo() {
  if (!wallVideoPanelState || !wallVideoPanelState.video || wallVideoPanelState.disposed) return Promise.resolve(false);
  if (wallVideoPanelState.videoFailed) return Promise.resolve(false);
  if (!wallVideoPanelState.hasWallVideoSrcAttached && isMobileDeferredWallVideo()) return Promise.resolve(false);
  if (wallVideoPanelState.playing) return Promise.resolve(true);

  const playPromise = wallVideoPanelState.video.play();
  if (!playPromise || typeof playPromise.then !== 'function') {
    wallVideoPanelState.playing = true;
    return Promise.resolve(true);
  }

  return playPromise
    .then(() => {
      wallVideoPanelState.playing = true;
      return true;
    })
    .catch((error) => {
      wallVideoPanelState.playing = false;
      if (!wallVideoPanelState.playBlockedLogged) {
        wallVideoPanelState.playBlockedLogged = true;
        console.warn('Video panel chưa tự phát được, sẽ thử lại sau tương tác người dùng.', error);
      }
      return false;
    });
}

function forceLoadWallVideoNow(reason = 'user-request') {
  if (!wallVideoPanelState || wallVideoPanelState.disposed || wallVideoPanelState.videoFailed) return Promise.resolve(false);
  attachWallVideoSource(reason, 'auto');
  return tryPlayWallVideo().then((ok) => {
    if (!ok) installWallVideoGestureRetry();
    return ok;
  });
}

function scheduleMobileWallVideoLoad() {
  if (!wallVideoPanelState || wallVideoPanelState.mobileLoadScheduled) return;
  wallVideoPanelState.mobileLoadScheduled = true;
  const delay = Math.max(0, Number(CONFIG.mobile?.wallVideoDeferredLoadMs || 30000));

  const scheduleAfterReady = () => {
    if (!wallVideoPanelState || wallVideoPanelState.disposed || wallVideoPanelState.hasWallVideoSrcAttached) return;
    window.setTimeout(() => {
      if (!wallVideoPanelState || wallVideoPanelState.disposed || wallVideoPanelState.hasWallVideoSrcAttached) return;
      forceLoadWallVideoNow('mobile-30s-auto');
    }, delay);
  };

  if (window.__viewerUsableDispatched) scheduleAfterReady();
  else window.addEventListener('viewer:usable', scheduleAfterReady, { once: true });

  // Fallback nếu event usable không phát ra vì lỗi dữ liệu tranh.
  window.setTimeout(() => {
    if (!wallVideoPanelState || wallVideoPanelState.disposed || wallVideoPanelState.hasWallVideoSrcAttached) return;
    forceLoadWallVideoNow('mobile-30s-fallback');
  }, delay + 12000);
}

function installWallVideoGestureRetry() {
  if (!wallVideoPanelState || wallVideoPanelState.gestureRetryInstalled) return;
  wallVideoPanelState.gestureRetryInstalled = true;

  const retry = () => {
    if (!wallVideoPanelState || wallVideoPanelState.playing || wallVideoPanelState.videoFailed) return;
    if (!wallVideoPanelState.hasWallVideoSrcAttached && isMobileDeferredWallVideo()) return;
    tryPlayWallVideo().then((ok) => {
      if (ok) remove();
    });
  };

  const remove = () => {
    window.removeEventListener('pointerdown', retry, true);
    window.removeEventListener('keydown', retry, true);
    window.removeEventListener('touchstart', retry, true);
  };

  wallVideoPanelState.removeGestureRetry = remove;
  window.addEventListener('pointerdown', retry, true);
  window.addEventListener('keydown', retry, true);
  window.addEventListener('touchstart', retry, true);
}

function playWallVideoAfterGestureIfNeeded() {
  if (!wallVideoPanelState || wallVideoPanelState.disposed) return;
  if (wallVideoPanelState.playing || wallVideoPanelState.videoFailed) return;
  if (!wallVideoPanelState.hasWallVideoSrcAttached && isMobileDeferredWallVideo()) {
    forceLoadWallVideoNow('gesture-before-30s');
    return;
  }
  tryPlayWallVideo();
}

function initWallVideoPanel() {
  if (CONFIG.wallVideoEnabled === false) return null;
  if (wallVideoPanelState) return wallVideoPanelState;
  if (typeof THREE === 'undefined' || typeof scene === 'undefined') {
    console.warn('Không thể tạo wall video panel: THREE/scene chưa sẵn sàng.');
    return null;
  }

  const deferSource = isMobileDeferredWallVideo();
  const fallbackTexture = createWallVideoFallbackTexture(deferSource ? 'Video sẽ tải sau…' : 'Đang tải video…');
  const meshParts = createWallVideoMesh(fallbackTexture);
  scene.add(meshParts.group);
  registerWallVideoInteractable(meshParts.screen);

  const video = createWallVideoElement({ deferSource });
  const videoTexture = createWallVideoTexture(video);

  wallVideoPanelState = {
    group: meshParts.group,
    screen: meshParts.screen,
    material: meshParts.material,
    fallbackTexture,
    videoTexture,
    video,
    playing: false,
    videoFailed: false,
    disposed: false,
    playBlockedLogged: false,
    gestureRetryInstalled: false,
    removeGestureRetry: null,
    hasWallVideoSrcAttached: !deferSource,
    mobileDeferred: deferSource,
    mobileLoadScheduled: false,
  };
  window.wallVideoPanelState = wallVideoPanelState;

  const applyVideoTexture = () => {
    if (!wallVideoPanelState || wallVideoPanelState.disposed || wallVideoPanelState.videoFailed) return;
    wallVideoPanelState.material.map = wallVideoPanelState.videoTexture;
    wallVideoPanelState.material.needsUpdate = true;
  };

  video.addEventListener('loadeddata', applyVideoTexture);
  video.addEventListener('canplay', () => {
    applyVideoTexture();
    if (CONFIG.wallVideoAutoplay !== false) tryPlayWallVideo();
  });
  video.addEventListener('playing', () => {
    if (!wallVideoPanelState || wallVideoPanelState.disposed) return;
    wallVideoPanelState.playing = true;
    applyVideoTexture();
  });
  video.addEventListener('waiting', () => {
    if (!wallVideoPanelState || wallVideoPanelState.disposed || wallVideoPanelState.videoFailed) return;
    wallVideoPanelState.playing = false;
  });

  const failWallVideo = () => {
    if (!wallVideoPanelState || wallVideoPanelState.disposed || wallVideoPanelState.videoFailed) return;
    wallVideoPanelState.videoFailed = true;
    wallVideoPanelState.playing = false;
    wallVideoPanelState.material.map = createWallVideoFallbackTexture('Video chưa sẵn sàng');
    wallVideoPanelState.material.needsUpdate = true;
    notifyWallVideoMissing();
  };

  video.addEventListener('error', failWallVideo);

  const armLoadTimeout = () => {
    window.setTimeout(() => {
      if (!wallVideoPanelState || wallVideoPanelState.disposed || wallVideoPanelState.videoFailed) return;
      if (!wallVideoPanelState.hasWallVideoSrcAttached) return;
      if (video.readyState < 2 && video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) failWallVideo();
    }, Number(CONFIG.wallVideoLoadTimeoutMs || 10000));
  };

  if (deferSource) {
    scheduleMobileWallVideoLoad();
  } else {
    armLoadTimeout();
    if (CONFIG.wallVideoAutoplay !== false) {
      window.setTimeout(() => {
        tryPlayWallVideo().then((ok) => {
          if (!ok) installWallVideoGestureRetry();
        });
      }, Number(CONFIG.wallVideoAutoplayDelayMs || 700));
    }
  }

  return wallVideoPanelState;
}

function disposeWallVideoPanel() {
  if (!wallVideoPanelState) return;

  wallVideoPanelState.disposed = true;
  if (typeof wallVideoPanelState.removeGestureRetry === 'function') wallVideoPanelState.removeGestureRetry();
  unregisterWallVideoInteractable(wallVideoPanelState.screen);

  if (wallVideoPanelState.video) {
    wallVideoPanelState.video.pause();
    wallVideoPanelState.video.removeAttribute('src');
    wallVideoPanelState.video.load();
    wallVideoPanelState.video.remove();
  }

  if (wallVideoPanelState.group && wallVideoPanelState.group.parent) {
    wallVideoPanelState.group.parent.remove(wallVideoPanelState.group);
  }

  wallVideoPanelState.group?.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((mat) => mat.dispose?.());
      else obj.material.dispose?.();
    }
  });

  wallVideoPanelState.videoTexture?.dispose?.();
  wallVideoPanelState.fallbackTexture?.dispose?.();
  wallVideoPanelState = null;
  window.wallVideoPanelState = null;
}

window.initWallVideoPanel = initWallVideoPanel;
window.createWallVideoTexture = createWallVideoTexture;
window.createWallVideoMesh = createWallVideoMesh;
window.playWallVideoAfterGestureIfNeeded = playWallVideoAfterGestureIfNeeded;
window.forceLoadWallVideoNow = forceLoadWallVideoNow;
window.attachWallVideoSource = attachWallVideoSource;
window.disposeWallVideoPanel = disposeWallVideoPanel;
