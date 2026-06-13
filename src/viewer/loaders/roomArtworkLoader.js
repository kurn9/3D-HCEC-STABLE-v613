

const VALID_SCENE_ITEM_TYPES = new Set(['artwork', 'logo', 'text', 'video']);

function getSceneItemType(item) {
  const type = String(item?.type || 'artwork').toLowerCase();
  return VALID_SCENE_ITEM_TYPES.has(type) ? type : 'artwork';
}

function getSceneItemTypeLabel(type) {
  const t = VALID_SCENE_ITEM_TYPES.has(String(type)) ? String(type) : 'artwork';
  return t === 'logo' ? 'LOGO' : t === 'text' ? 'TEXT' : t === 'video' ? 'VIDEO' : 'ARTWORK';
}


function getViewerMediaSrc(data = {}) {
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

function getViewerVideoSrc(data = {}) {
  if (window.cmsContentLoader?.getArtworkVideoSrc) return window.cmsContentLoader.getArtworkVideoSrc(data);
  const direct = data?.videoUrl || data?.video_url || data?.video || data?.mediaUrl || data?.media_url || data?.contentUrl || data?.content_url;
  if (direct) return String(direct).trim();
  // K_O_G_B: một số CMS/export cũ dùng src/url chung. Chỉ coi là video URL khi item là video.
  if (String(data?.type || data?.kind || data?.mediaType || '').toLowerCase() === 'video') {
    return String(data?.src || data?.url || '').trim();
  }
  return '';
}

function getViewerPosterSrc(data = {}) {
  if (window.cmsContentLoader?.getArtworkPosterSrc) return window.cmsContentLoader.getArtworkPosterSrc(data);
  return String(data?.poster || data?.posterUrl || data?.poster_url || data?.thumbnail || data?.image || '').trim();
}

function isMobileFastArtworkLoad() {
  return Boolean(window.isViewerMobileFastLoad?.() && CONFIG?.mobile?.progressiveArtworkLoading !== false);
}

function markViewerUsableSoon(message = '✅ <strong>Sẵn sàng tham quan</strong>') {
  setLoadingProgress(100);
  setStatus(message);
  if (!window.__viewerUsableDispatched) {
    window.__viewerUsableDispatched = true;
    window.dispatchEvent(new CustomEvent('viewer:usable'));
  }
  window.scheduleMobilePixelRatioUpgrade?.();
}

let sharedArtworkPlaceholderTexture = null;

function createArtworkPlaceholderTexture() {
  if (sharedArtworkPlaceholderTexture) return sharedArtworkPlaceholderTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#18202d');
  gradient.addColorStop(1, '#080d15');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(232,192,109,0.22)';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
  ctx.fillStyle = 'rgba(244,246,251,0.58)';
  ctx.font = '700 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Đang tải', canvas.width / 2, canvas.height / 2 - 8);
  ctx.fillText('tác phẩm', canvas.width / 2, canvas.height / 2 + 10);

  sharedArtworkPlaceholderTexture = new THREE.CanvasTexture(canvas);
  sharedArtworkPlaceholderTexture.colorSpace = THREE.SRGBColorSpace;
  sharedArtworkPlaceholderTexture.minFilter = THREE.LinearFilter;
  sharedArtworkPlaceholderTexture.magFilter = THREE.LinearFilter;
  sharedArtworkPlaceholderTexture.generateMipmaps = false;
  return sharedArtworkPlaceholderTexture;
}

// K_O_F_E_B — video artwork surfaces must never remain in an infinite loading state.
function applySceneVideoFallbackTexture(root, item = {}, reason = '') {
  const mat = root?.userData?.imageMaterial;
  if (!root || !mat) return null;
  const texture = createScenePlaceholderTexture(item?.title || item?.id || 'Video trình chiếu', 'VIDEO');
  texture.userData = { ...(texture.userData || {}), sceneVideoFallback: true, reason };
  mat.map = texture;
  mat.needsUpdate = true;
  root.userData.videoFallbackTexture = texture;
  root.userData.textureFailed = false;
  // Keep textureLoaded false: this is a safe poster/placeholder, not a decoded video frame.
  if (!root.userData.videoPlayer?.video) root.userData.textureLoaded = false;
  return texture;
}

function restoreSceneVideoFallbackTexture(root, item = {}, reason = '') {
  if (!root?.userData?.imageMaterial) return false;
  const texture = root.userData.videoPosterTexture || root.userData.videoFallbackTexture || applySceneVideoFallbackTexture(root, item, reason);
  if (!texture) return false;
  root.userData.imageMaterial.map = texture;
  root.userData.imageMaterial.needsUpdate = true;
  root.userData.textureLoaded = false;
  root.userData.videoSurfaceState = reason || 'placeholder';
  return true;
}

function hasSceneVideoFirstFrame(video) {
  return Boolean(video && video.readyState >= 2 && Number(video.videoWidth || 0) > 0 && Number(video.videoHeight || 0) > 0);
}

// HOTFIX/FEATURE V6.11.1 — runtime video preview/autoplay for scene video items.
// Không tạo poster file; frame đầu chỉ được vẽ vào canvas runtime.
const sceneVideoRoots = [];
const sceneVideoMissingUrlCache = new Set();
const videoPreviewQueue = [];
let videoPreviewActiveCount = 0;
let sceneVideoAutoplayTimer = 0;

function isSceneVideoPreviewDebug() {
  return CONFIG?.sceneVideoPreviewDebug === true || CONFIG?.videoPreviewDebug === true;
}

function logSceneVideoPreview(event, data = {}, level = 'debug') {
  const prefix = `[video-preview] ${event}`;
  if (level === 'warn') {
    console.warn(prefix, data);
    return;
  }
  if (!isSceneVideoPreviewDebug()) return;
  const fn = console[level] || console.debug || console.log;
  fn.call(console, prefix, data);
}

function isOutdoorRoomActive() {
  return String(CONFIG?.currentRoomId || '').toLowerCase() === 'outdoor';
}

function getViewerQualityForMedia() {
  return typeof window.getViewerQualityState === 'function' ? window.getViewerQualityState() : null;
}

function isSceneVideoFirstFramePreviewEnabled() {
  return CONFIG?.videoFirstFramePreviewEnabled !== false && CONFIG?.sceneVideoPreviewEnabled !== false;
}

function getSceneVideoPreviewMode() {
  if (!isSceneVideoFirstFramePreviewEnabled()) return 'off';
  const configuredMode = CONFIG?.sceneVideoPreviewMode;
  const quality = getViewerQualityForMedia();
  if (configuredMode) return configuredMode;
  if (quality?.isMobile && quality.profile?.videoPreview) return quality.profile.videoPreview;
  return 'auto';
}

function getSceneVideoAutoplayProfileLimit() {
  const quality = getViewerQualityForMedia();
  if (quality?.isMobile && Number.isFinite(Number(quality.profile?.videoAutoplayMax))) {
    return Math.max(0, Number(quality.profile.videoAutoplayMax));
  }
  return null;
}

function getSceneVideoPreviewConcurrency() {
  const quality = getViewerQualityForMedia();
  const mobile = Boolean(window.viewerMobileDevice?.isMobileViewer?.() || quality?.isMobile);
  const fallback = mobile || isOutdoorRoomActive() ? 1 : 2;
  const configured = Math.max(1, Number(CONFIG?.sceneVideoPreviewConcurrency || fallback));
  return quality?.isMobile ? Math.min(configured, 1) : configured;
}

function getSceneVideoAutoplayLimit() {
  const profileLimit = getSceneVideoAutoplayProfileLimit();
  if (profileLimit !== null) return profileLimit;
  const mobile = Boolean(window.viewerMobileDevice?.isMobileViewer?.());
  const fallback = mobile || isOutdoorRoomActive() ? 1 : 2;
  return Math.max(0, Number(CONFIG?.sceneVideoAutoplayMax || fallback));
}


function getSceneVideoAutoplayMaxDistance() {
  const fallback = isOutdoorRoomActive() ? 14 : 18;
  return Math.max(4, Number(CONFIG?.sceneVideoAutoplayMaxDistance || fallback));
}

function isSceneVideoRootVisible(root, margin = 0.18) {
  if (!root || !camera) return false;
  const p = root.getWorldPosition ? root.getWorldPosition(new THREE.Vector3()) : root.position.clone();
  p.project(camera);
  return p.z >= -1 && p.z <= 1 && Math.abs(p.x) <= 1 + margin && Math.abs(p.y) <= 1 + margin;
}

function shouldDeferVideoPreviewCapture(root = null) {
  const budget = window.__viewerFrameBudget;
  if (CONFIG?.sceneVideoPreviewDeferOnSpike !== false && (budget?.isSpikeFrame || budget?.wasRecentlySpike || budget?.isLowFps || budget?.isCriticalFps)) return true;
  if (!roomLoaded) return true;
  if (root && !isSceneVideoRootVisible(root, isOutdoorRoomActive() ? 0.55 : 0.42)) return true;
  return false;
}

function waitForVideoEvent(video, events, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => {
      events.forEach((name) => video.removeEventListener(name, onReady));
      video.removeEventListener('error', onError);
      window.clearTimeout(timer);
    };
    const finish = (ok, value) => {
      if (done) return;
      done = true;
      cleanup();
      ok ? resolve(value) : reject(value);
    };
    const onReady = (event) => finish(true, event);
    const onError = () => finish(false, new Error('video-error'));
    const timer = window.setTimeout(() => finish(false, new Error('video-timeout')), timeoutMs);
    events.forEach((name) => video.addEventListener(name, onReady, { once: true }));
    video.addEventListener('error', onError, { once: true });
  });
}

function pauseSceneVideosOutsideRange() {
  const maxDistance = getSceneVideoAutoplayMaxDistance() * 1.35;
  sceneVideoRoots.forEach((root) => {
    const player = root?.userData?.videoPlayer;
    if (!player?.video || player.video.paused) return;
    const dist = camera.position.distanceTo(root.position);
    if (dist > maxDistance || !isSceneVideoRootVisible(root, 0.36)) {
      try { player.video.pause(); } catch (_) {}
    }
  });
}

function drawVideoFrameToTexture(video, item) {
  const canvas = document.createElement('canvas');
  const width = Math.max(320, Math.min(1920, Number(CONFIG?.videoFirstFrameCanvasWidth || CONFIG?.sceneVideoPreviewCanvasWidth || 1024)));
  const height = Math.max(180, Math.min(1080, Number(CONFIG?.videoFirstFrameCanvasHeight || CONFIG?.sceneVideoPreviewCanvasHeight || 576)));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, width, height);

  const vw = Number(video.videoWidth || 0);
  const vh = Number(video.videoHeight || 0);
  if (vw > 0 && vh > 0) {
    const canvasAspect = width / height;
    const videoAspect = vw / vh;
    let sx = 0; let sy = 0; let sw = vw; let sh = vh;
    if (videoAspect > canvasAspect) {
      sw = vh * canvasAspect;
      sx = (vw - sw) / 2;
    } else {
      sh = vw / canvasAspect;
      sy = (vh - sh) / 2;
    }
    try {
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
    } catch (error) {
      console.warn('Không vẽ được frame đầu video scene item:', item?.videoUrl, error);
      return null;
    }
  }

  const footer = ctx.createLinearGradient(0, height * 0.58, 0, height);
  footer.addColorStop(0, 'rgba(0,0,0,0)');
  footer.addColorStop(1, 'rgba(0,0,0,.52)');
  ctx.fillStyle = footer;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(232,192,109,.42)';
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, width - 36, height - 36);
  ctx.fillStyle = 'rgba(255,250,232,.92)';
  ctx.font = '800 38px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  const label = String(item?.title || item?.id || 'Video trình chiếu');
  ctx.fillText(label.slice(0, 42), 38, height - 42);
  ctx.font = '700 19px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(255,250,232,.72)';
  ctx.fillText('Click để phát · nhấp đúp để xem lớn', 40, height - 92);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function captureVideoFramePreviewTexture(item) {
  if (!isSceneVideoFirstFramePreviewEnabled()) return Promise.resolve(null);
  if (!item?.videoUrl) return Promise.resolve(null);
  if (sceneVideoMissingUrlCache.has(item.videoUrl)) {
    logSceneVideoPreview('fallback: reason', { title: item?.title || item?.id || '', videoUrl: item.videoUrl, reason: 'cached-missing-video' }, 'warn');
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    let timeoutId = 0;

    const timeoutMs = Math.max(1800, Number(CONFIG?.videoFirstFrameTimeoutMs || CONFIG?.sceneVideoPreviewTimeoutMs || 4500));
    const debugData = {
      title: item?.title || item?.id || '',
      videoUrl: item?.videoUrl || ''
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      try { video.pause?.(); } catch (_) {}
      video.removeAttribute('src');
      try { video.load?.(); } catch (_) {}
    };

    const finish = (texture, reason = '') => {
      if (settled) return;
      settled = true;
      cleanup();
      if (texture) {
        logSceneVideoPreview('texture applied', debugData);
      } else if (reason) {
        logSceneVideoPreview('fallback: reason', { ...debugData, reason }, 'warn');
      }
      resolve(texture || null);
    };

    const drawNow = (reasonOnFail = 'draw-not-ready') => {
      if (settled) return false;
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        return false;
      }
      const texture = drawVideoFrameToTexture(video, item);
      finish(texture, texture ? '' : reasonOnFail);
      return Boolean(texture);
    };

    timeoutId = window.setTimeout(() => finish(null, 'timeout'), timeoutMs);

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = CONFIG?.videoFirstFramePreload || CONFIG?.sceneVideoPreviewPreload || 'metadata';
    video.crossOrigin = 'anonymous';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');

    const run = async () => {
      logSceneVideoPreview('start', debugData);
      try {
        video.src = item.videoUrl;
        try { video.load?.(); } catch (_) {}

        await waitForVideoEvent(video, ['loadedmetadata'], Math.min(timeoutMs, 2600));
        logSceneVideoPreview('metadata loaded', {
          ...debugData,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          duration: Number.isFinite(video.duration) ? video.duration : null
        });

        if (!video.videoWidth || !video.videoHeight) {
          try {
            await waitForVideoEvent(video, ['loadeddata', 'canplay'], Math.min(timeoutMs, 1800));
          } catch (_) {}
        }

        const duration = Number(video.duration || 0);
        const configuredSeek = Number(CONFIG?.videoFirstFrameSeekTime);
        const seekMin = Number(CONFIG?.sceneVideoPreviewSeekMin || 0.05);
        const seekMax = Number(CONFIG?.sceneVideoPreviewSeekMax || 0.35);
        const seekRatio = Number(CONFIG?.sceneVideoPreviewSeekRatio || 0.03);
        const seekAt = Number.isFinite(configuredSeek) && configuredSeek >= 0
          ? configuredSeek
          : (Number.isFinite(duration) && duration > 0.2
            ? Math.min(seekMax, Math.max(seekMin, duration * seekRatio))
            : 0.05);

        try {
          video.currentTime = Math.min(Math.max(0, seekAt), Math.max(0, (duration || seekAt + 0.1) - 0.02));
          await waitForVideoEvent(video, ['seeked'], Math.min(timeoutMs, 2200));
          logSceneVideoPreview('seeked', { ...debugData, currentTime: video.currentTime || 0 });
          if (drawNow('draw-after-seek-failed')) return;
        } catch (error) {
          logSceneVideoPreview('seek fallback', { ...debugData, reason: error?.message || 'seeked-timeout' });
        }

        try {
          await waitForVideoEvent(video, ['loadeddata', 'canplay'], Math.min(timeoutMs, 1600));
          if (drawNow('draw-after-loadeddata-failed')) return;
        } catch (_) {}

        try {
          const playPromise = video.play?.();
          if (playPromise && typeof playPromise.then === 'function') await playPromise;
          window.setTimeout(() => {
            try { video.pause?.(); } catch (_) {}
            if (drawNow('draw-after-play-failed')) return;
            finish(null, 'play-frame-not-ready');
          }, 140);
        } catch (error) {
          if (drawNow('draw-after-play-blocked-failed')) return;
          finish(null, error?.message || 'play-blocked');
        }
      } catch (error) {
        sceneVideoMissingUrlCache.add(item.videoUrl);
        finish(null, error?.message || 'metadata-failed');
      }
    };

    run();
  });
}

function pumpVideoPreviewQueue() {
  const limit = getSceneVideoPreviewConcurrency();
  while (videoPreviewActiveCount < limit && videoPreviewQueue.length) {
    const task = videoPreviewQueue.shift();
    if (task.root && shouldDeferVideoPreviewCapture(task.root)) {
      videoPreviewQueue.push(task);
      window.setTimeout(pumpVideoPreviewQueue, isOutdoorRoomActive() ? 900 : 520);
      return;
    }
    videoPreviewActiveCount += 1;
    task.run()
      .then(task.resolve)
      .catch(() => task.resolve(false))
      .finally(() => {
        videoPreviewActiveCount = Math.max(0, videoPreviewActiveCount - 1);
        window.setTimeout(pumpVideoPreviewQueue, isOutdoorRoomActive() ? 260 : 120);
      });
  }
}

function enqueueVideoPreviewTexture(root, item, options = {}) {
  if (!root || !item?.videoUrl) return Promise.resolve(false);
  const previewMode = getSceneVideoPreviewMode();
  if (previewMode === 'off') {
    root.userData.videoPreviewDisabled = true;
    return Promise.resolve(false);
  }
  if (previewMode === 'on-demand' && options.force !== true) {
    root.userData.videoPreviewDeferred = true;
    return Promise.resolve(false);
  }
  if (root.userData?.videoPreviewAttempted) return Promise.resolve(false);
  root.userData.videoPreviewAttempted = true;
  return new Promise((resolve) => {
    videoPreviewQueue.push({
      root,
      resolve,
      run: async () => {
        if (root.userData?.videoPlayer?.video) return false;
        const texture = await captureVideoFramePreviewTexture(item);
        if (!texture || root.userData?.videoPlayer?.video) {
          root.userData.textureFailed = true;
          return false;
        }
        applyArtworkTextureToRoot(root, texture);
        return true;
      }
    });
    pumpVideoPreviewQueue();
  });
}

function scheduleSceneVideoAutoplay() {
  if (sceneVideoAutoplayTimer || CONFIG?.sceneVideoAutoplayAfterDelay === false) return;
  const delay = Math.max(3000, Number(CONFIG?.sceneVideoAutoplayDelayMs || 15000));
  sceneVideoAutoplayTimer = window.setTimeout(() => {
    sceneVideoAutoplayTimer = 0;
    autoplaySceneVideosControlled();
  }, delay);
}

function autoplaySceneVideosControlled() {
  const limit = getSceneVideoAutoplayLimit();
  if (limit <= 0 || !sceneVideoRoots.length) return;

  pauseSceneVideosOutsideRange();

  const maxDistance = getSceneVideoAutoplayMaxDistance();
  const requireView = CONFIG?.sceneVideoAutoplayRequireView !== false;
  const candidates = sceneVideoRoots
    .filter((root) => root?.userData?.artData?.videoUrl)
    .map((root) => ({ root, dist: camera.position.distanceTo(root.position) }))
    .filter(({ root, dist }) => dist <= maxDistance && (!requireView || isSceneVideoRootVisible(root)))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);

  candidates.forEach(({ root }) => {
    attachVideoTextureToRoot(root, root.userData.artData, { play: true, forceMuted: true, source: 'delayed-autoplay' });
  });
}

window.autoplaySceneVideosControlled = autoplaySceneVideosControlled;

function getViewerTextureAnisotropy() {
  const max = renderer.capabilities.getMaxAnisotropy?.() || 1;
  const cap = isOutdoorRoomActive() ? 2 : 4;
  return Math.max(1, Math.min(cap, max));
}

function applyArtworkTextureToRoot(root, texture) {
  if (!root || !texture) return;
  const mat = root.userData?.imageMaterial;
  if (!mat) return;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = getViewerTextureAnisotropy();
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  mat.map = texture;
  applySceneLogoFit(root, texture);
  mat.needsUpdate = true;
  root.userData.textureLoaded = true;
}

function applySceneLogoFit(root, texture) {
  const artData = root?.userData?.artData;
  const mesh = root?.userData?.imageMesh;
  if (!artData || artData.type !== 'logo' || !mesh || !texture?.image) return;

  const mode = String(artData.fitMode || 'contain').toLowerCase();
  mesh.scale.set(1, 1, 1);
  texture.repeat.set(1, 1);
  texture.offset.set(0, 0);

  if (mode === 'stretch') return;

  const boxW = Math.max(0.001, Number(artData.size?.[0] || 1));
  const boxH = Math.max(0.001, Number(artData.size?.[1] || 1));
  const imageW = Number(texture.image.naturalWidth || texture.image.width || 1);
  const imageH = Number(texture.image.naturalHeight || texture.image.height || 1);
  const boxAspect = boxW / boxH;
  const imageAspect = imageW / imageH;
  if (!Number.isFinite(imageAspect) || imageAspect <= 0) return;

  if (mode === 'cover') {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    if (imageAspect > boxAspect) {
      const repeatX = boxAspect / imageAspect;
      texture.repeat.set(repeatX, 1);
      texture.offset.set((1 - repeatX) / 2, 0);
    } else {
      const repeatY = imageAspect / boxAspect;
      texture.repeat.set(1, repeatY);
      texture.offset.set(0, (1 - repeatY) / 2);
    }
    return;
  }

  if (imageAspect > boxAspect) mesh.scale.y = boxAspect / imageAspect;
  else mesh.scale.x = imageAspect / boxAspect;
}

function loadArtworkTextureIntoRoot(root) {
  if (!root || !root.userData?.artData) return Promise.resolve(false);
  if (root.userData.textureLoaded) return Promise.resolve(true);
  if (root.userData.texturePromise) return root.userData.texturePromise;
  const artData = root.userData.artData;
  const itemType = getSceneItemType(artData);

  if (itemType === 'text') {
    applyArtworkTextureToRoot(root, createTextSceneTexture(artData));
    return Promise.resolve(true);
  }

  if (itemType === 'video') {
    // V6.11.1: ưu tiên poster; nếu không có, lấy frame đầu runtime bằng canvas texture.
    // K_O_F_E_B: luôn đặt placeholder video lịch sự trước để không còn “Đang tải tác phẩm” vô hạn.
    applySceneVideoFallbackTexture(root, artData, artData.poster ? 'poster-pending' : 'no-poster');
    if (artData.poster) {
      root.userData.texturePromise = new Promise((resolve) => {
        textureLoader.load(
          artData.poster,
          (texture) => {
            logSceneVideoPreview('poster loaded', { title: artData.title || artData.id || '', poster: artData.poster || '' });
            applyArtworkTextureToRoot(root, texture);
            root.userData.videoPosterTexture = texture;
            resolve(true);
          },
          undefined,
          (error) => {
            logSceneVideoPreview('fallback: reason', { title: artData.title || artData.id || '', poster: artData.poster || '', reason: 'poster-load-failed', error }, 'warn');
            restoreSceneVideoFallbackTexture(root, artData, 'poster-load-failed');
            enqueueVideoPreviewTexture(root, artData).then((ok) => {
              if (!ok) restoreSceneVideoFallbackTexture(root, artData, 'preview-unavailable');
              resolve(ok);
            });
          }
        );
      });
      return root.userData.texturePromise;
    }
    root.userData.texturePromise = enqueueVideoPreviewTexture(root, artData).then((ok) => {
      if (!ok) restoreSceneVideoFallbackTexture(root, artData, 'preview-deferred-or-unavailable');
      return ok;
    });
    return root.userData.texturePromise;
  }

  root.userData.texturePromise = new Promise((resolve) => {
    textureLoader.load(
      artData.image,
      (texture) => {
        applyArtworkTextureToRoot(root, texture);
        resolve(true);
      },
      undefined,
      (error) => {
        root.userData.textureFailed = true;
        console.warn('Không load được ảnh tác phẩm, giữ placeholder:', artData.image, error);
        resolve(false);
      }
    );
  });

  return root.userData.texturePromise;
}

function scheduleArtworkTextureBatches(roots, options = {}) {
  const cfg = CONFIG.mobile || {};
  const quality = getViewerQualityForMedia();
  const profile = quality?.isMobile ? quality.profile || {} : {};
  const configuredBatchSize = Math.max(1, Number(options.batchSize || cfg.artworkBatchSize || 3));
  const configuredDelayMs = Math.max(60, Number(options.delayMs || cfg.artworkBatchDelayMs || 220));
  const batchSize = quality?.isMobile && Number.isFinite(Number(profile.artworkBatchSize))
    ? Math.max(1, Math.min(configuredBatchSize, Number(profile.artworkBatchSize)))
    : configuredBatchSize;
  const delayMs = quality?.isMobile && Number.isFinite(Number(profile.artworkBatchDelayMs))
    ? Math.max(configuredDelayMs, Number(profile.artworkBatchDelayMs))
    : configuredDelayMs;
  let index = 0;

  const loadNextBatch = () => {
    if (index >= roots.length) return;
    const batch = roots.slice(index, index + batchSize);
    index += batchSize;
    batch.forEach((root) => loadArtworkTextureIntoRoot(root));
    window.setTimeout(loadNextBatch, delayMs);
  };

  window.setTimeout(loadNextBatch, delayMs);
}


function isRoomRuntimeDebugEnabled() {
  if (typeof window.isViewerRoomDebugEnabled === 'function' && window.isViewerRoomDebugEnabled()) return true;
  try {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('debugRoom') === '1' || params.get('debugLighting') === '1';
  } catch {
    return Boolean(CONFIG?.debugRoomModel);
  }
}

function getMaterialArray(material) {
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

function countRoomModelRuntimeObjects(gltf, model) {
  const clips = Array.isArray(gltf?.animations) ? gltf.animations : [];
  const lightNodes = [];
  const materialSet = new Set();
  let meshCount = 0;
  let emissiveMaterialCount = 0;

  model?.traverse?.((object) => {
    if (object?.isLight) lightNodes.push(object);
    if (!object?.isMesh) return;
    meshCount += 1;
    getMaterialArray(object.material).forEach((material) => {
      if (!material || materialSet.has(material)) return;
      materialSet.add(material);
      const emissive = material.emissive;
      const emissiveIntensity = Number(material.emissiveIntensity || 0);
      const hasEmissiveColor = Boolean(emissive && typeof emissive.getHex === 'function' && emissive.getHex() !== 0x000000);
      if (hasEmissiveColor || emissiveIntensity > 0.001) emissiveMaterialCount += 1;
    });
  });

  const parserJson = gltf?.parser?.json || {};
  const extensionsUsed = Array.isArray(parserJson.extensionsUsed) ? parserJson.extensionsUsed : [];
  const hasPunctualLights = extensionsUsed.includes('KHR_lights_punctual') || Boolean(parserJson.extensions?.KHR_lights_punctual);

  return {
    roomId: CONFIG?.currentRoomId || 'unknown',
    roomUrl: CONFIG?.roomUrl || '',
    animations: clips.length,
    animationClips: clips.map((clip) => ({
      name: clip?.name || '(unnamed)',
      duration: Number.isFinite(clip?.duration) ? Number(clip.duration.toFixed(3)) : null,
      tracks: Array.isArray(clip?.tracks) ? clip.tracks.length : 0
    })),
    lights: lightNodes.length,
    lightNodes: lightNodes.map((light) => ({
      name: light.name || '(unnamed)',
      type: light.type || 'Light',
      intensity: Number.isFinite(light.intensity) ? Number(light.intensity.toFixed(3)) : null,
      position: light.position?.toArray?.().map((value) => Number(value.toFixed(3))) || null
    })),
    meshes: meshCount,
    materials: materialSet.size,
    emissiveMaterials: emissiveMaterialCount,
    extensionsUsed,
    hasKHRLightsPunctual: hasPunctualLights
  };
}

function logRoomModelRuntimeDebug(gltf, model, phase = 'room-loaded') {
  if (!isRoomRuntimeDebugEnabled()) return;
  const summary = countRoomModelRuntimeObjects(gltf, model);
  console.info('[room-debug]', { phase, ...summary });
  if (summary.animations === 0) {
    console.info('[room-debug] GLB hiện tại không có animation clip. Nếu cần đèn/quạt/vật thể quay, hãy export lại GLB từ Blender kèm animation.');
  }
  if (summary.lights === 0 && !summary.hasKHRLightsPunctual) {
    console.info('[room-debug] Không phát hiện embedded light/KHR_lights_punctual trong GLB runtime; ánh sáng chính đang do Three.js viewer bổ sung.');
  }
}


function isMaterialRuntimeDebugEnabled() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const configuredParam = CONFIG?.debugMaterialQueryParam || 'debugMaterial';
    return params.get(configuredParam) === '1'
      || params.get('debugMaterial') === '1'
      || params.get('debugLighting') === '1'
      || Boolean(CONFIG?.debugMaterialProfile || CONFIG?.lightingProfile?.debugMaterialProfile);
  } catch {
    return Boolean(CONFIG?.debugMaterialProfile || CONFIG?.lightingProfile?.debugMaterialProfile);
  }
}

function materialColorToHex(color) {
  if (!color || typeof color.getHexString !== 'function') return null;
  return `#${color.getHexString()}`;
}

function shouldLogMaterialRisk(meshName, material) {
  const profile = CONFIG?.lightingProfile || {};
  const keywords = Array.isArray(profile.materialDebugRiskKeywords)
    ? profile.materialDebugRiskKeywords
    : ['wall', 'floor', 'ceiling', 'corridor', 'room', 'interior', 'panel', 'black', 'dark', 'metal'];
  const haystack = `${meshName || ''} ${material?.name || ''}`.toLowerCase();
  const keywordHit = keywords.some((keyword) => keyword && haystack.includes(String(keyword).toLowerCase()));
  const color = material?.color;
  const brightness = color ? (color.r + color.g + color.b) / 3 : 1;
  const metalness = Number(material?.metalness || 0);
  const roughness = Number(material?.roughness || 0);
  return keywordHit || brightness < 0.20 || metalness > 0.58 || roughness > 0.88;
}

function logRoomMaterialRuntimeDebug(model, roomBox, phase = 'room-loaded') {
  if (!isMaterialRuntimeDebugEnabled()) return;

  const profile = CONFIG?.lightingProfile || {};
  const maxItems = Math.max(6, Number(profile.materialDebugMaxItems || 24));
  const records = [];
  const seen = new Set();

  model?.traverse?.((object) => {
    if (!object?.isMesh) return;
    const meshName = object.name || getObjectNameTrail(object) || '(unnamed mesh)';
    const materials = getMaterialArray(object.material);
    materials.forEach((material) => {
      if (!material) return;
      const key = `${meshName}::${material.uuid || material.name || records.length}`;
      if (seen.has(key)) return;
      if (!shouldLogMaterialRisk(meshName, material) && records.length >= Math.ceil(maxItems / 2)) return;
      seen.add(key);

      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      records.push({
        mesh: meshName,
        material: material.name || material.type || '(unnamed material)',
        type: material.type || null,
        color: materialColorToHex(material.color),
        roughness: Number.isFinite(material.roughness) ? Number(material.roughness.toFixed(3)) : null,
        metalness: Number.isFinite(material.metalness) ? Number(material.metalness.toFixed(3)) : null,
        emissive: materialColorToHex(material.emissive),
        emissiveIntensity: Number.isFinite(material.emissiveIntensity) ? Number(material.emissiveIntensity.toFixed(3)) : null,
        envMapIntensity: Number.isFinite(material.envMapIntensity) ? Number(material.envMapIntensity.toFixed(3)) : null,
        side: material.side,
        transparent: Boolean(material.transparent),
        hasMap: Boolean(material.map),
        hasEmissiveMap: Boolean(material.emissiveMap),
        center: center.toArray().map((value) => Number(value.toFixed(3))),
        bounds: {
          min: box.min.toArray().map((value) => Number(value.toFixed(3))),
          max: box.max.toArray().map((value) => Number(value.toFixed(3)))
        }
      });
    });
  });

  console.info('[material-debug]', {
    phase,
    roomId: CONFIG?.currentRoomId || 'unknown',
    roomUrl: CONFIG?.roomUrl || '',
    roomBounds: roomBox ? {
      min: roomBox.min.toArray().map((value) => Number(value.toFixed(3))),
      max: roomBox.max.toArray().map((value) => Number(value.toFixed(3))),
      size: roomBox.getSize(new THREE.Vector3()).toArray().map((value) => Number(value.toFixed(3))),
      center: roomBox.getCenter(new THREE.Vector3()).toArray().map((value) => Number(value.toFixed(3)))
    } : null,
    logged: Math.min(records.length, maxItems),
    records: records.slice(0, maxItems)
  });
}



function getIndoorMaterialLiftConfig() {
  const base = CONFIG?.indoorMaterialLift || CONFIG?.lightingProfile?.indoorMaterialLift || null;
  if (!base || typeof base !== 'object') return null;
  return {
    enabled: base.enabled === true,
    roomIds: Array.isArray(base.roomIds) ? base.roomIds.map((id) => String(id).toLowerCase()) : ['indoor'],
    targetObjectName: base.targetObjectName || 'ROOM_EXT',
    cloneMaterial: base.cloneMaterial !== false,
    colorLift: Math.max(0, Math.min(0.22, Number(base.colorLift ?? 0.16))),
    maxMetalness: Math.max(0, Math.min(0.25, Number(base.maxMetalness ?? 0.18))),
    roughnessMin: Math.max(0, Math.min(1, Number(base.roughnessMin ?? 0.48))),
    roughnessMax: Math.max(0, Math.min(1, Number(base.roughnessMax ?? 0.78))),
    envMapIntensity: Math.max(0, Math.min(0.70, Number(base.envMapIntensity ?? 0.58))),
    emissiveColor: base.emissiveColor ?? 0x111111,
    emissiveIntensity: Math.max(0, Math.min(0.08, Number(base.emissiveIntensity ?? 0.045))),
    excludeNamePattern: base.excludeNamePattern || '(neon|emissive|glow|hologram|light|screen|video|poster|art|logo|avatar|glass)',
    debugMaxItems: Math.max(4, Math.min(40, Number(base.debugMaxItems || 18)))
  };
}

function shouldSkipRoomExtMaterialLift(object, material, excludePattern) {
  const name = `${object?.name || ''} ${getObjectNameTrail(object) || ''} ${material?.name || ''}`.toLowerCase();
  if (!name.trim()) return false;
  try {
    return new RegExp(excludePattern, 'i').test(name);
  } catch {
    return /(neon|emissive|glow|hologram|light|screen|video|poster|art|logo|avatar|glass)/i.test(name);
  }
}

function cloneAndLiftRoomExtMaterial(material, cfg) {
  if (!material || material.__roomExtLiftedMaterial) return material;
  const lifted = cfg.cloneMaterial && typeof material.clone === 'function' ? material.clone() : material;
  if (lifted !== material) {
    lifted.name = material.name ? `${material.name}__ROOM_EXT_LIFT` : 'ROOM_EXT_LIFT_MATERIAL';
    lifted.userData = { ...(lifted.userData || {}), sourceMaterialName: material.name || '' };
  }

  if (lifted.color && typeof lifted.color.lerp === 'function') {
    lifted.color.lerp(new THREE.Color(0xffffff), cfg.colorLift);
  }

  if ('metalness' in lifted && Number.isFinite(Number(lifted.metalness))) {
    lifted.metalness = Math.min(Number(lifted.metalness), cfg.maxMetalness);
  }

  if ('roughness' in lifted && Number.isFinite(Number(lifted.roughness))) {
    lifted.roughness = Math.max(cfg.roughnessMin, Math.min(cfg.roughnessMax, Number(lifted.roughness)));
  }

  if ('envMapIntensity' in lifted) {
    lifted.envMapIntensity = Math.max(Number(lifted.envMapIntensity || 0), cfg.envMapIntensity);
  }

  if (lifted.emissive && typeof lifted.emissive.set === 'function') {
    try {
      const currentHex = typeof lifted.emissive.getHex === 'function' ? lifted.emissive.getHex() : 0;
      if (currentHex === 0x000000) lifted.emissive.set(cfg.emissiveColor);
      else lifted.emissive.lerp(new THREE.Color(cfg.emissiveColor), 0.28);
    } catch (_) {}
  }

  if ('emissiveIntensity' in lifted) {
    lifted.emissiveIntensity = Math.max(Number(lifted.emissiveIntensity || 0), cfg.emissiveIntensity);
  }

  lifted.__roomExtLiftedMaterial = true;
  lifted.needsUpdate = true;
  return lifted;
}

function applyRoomExtMaterialLift(roomRoot) {
  const cfg = getIndoorMaterialLiftConfig();
  const roomId = String(CONFIG?.currentRoomId || '').toLowerCase();
  const debug = isMaterialRuntimeDebugEnabled();

  if (!cfg?.enabled || !cfg.roomIds.includes(roomId)) return null;

  const target = roomRoot?.getObjectByName?.(cfg.targetObjectName);
  if (!target) {
    if (debug) console.warn('[material-lift] ROOM_EXT not found; skip material lift', { roomId, targetObjectName: cfg.targetObjectName });
    return { found: false, lifted: 0, skipped: 0, meshes: 0 };
  }

  let meshCount = 0;
  let liftedCount = 0;
  let skippedCount = 0;
  let clonedCount = 0;
  const liftedSamples = [];
  const skippedSamples = [];

  target.traverse((object) => {
    if (!object?.isMesh || !object.material) return;
    meshCount += 1;

    const liftOne = (material) => {
      if (!material) return material;
      if (shouldSkipRoomExtMaterialLift(object, material, cfg.excludeNamePattern)) {
        skippedCount += 1;
        if (skippedSamples.length < cfg.debugMaxItems) skippedSamples.push({ mesh: object.name || getObjectNameTrail(object), material: material.name || material.type || '(unnamed)' });
        return material;
      }
      const next = cloneAndLiftRoomExtMaterial(material, cfg);
      if (next !== material) clonedCount += 1;
      liftedCount += 1;
      if (liftedSamples.length < cfg.debugMaxItems) {
        liftedSamples.push({
          mesh: object.name || getObjectNameTrail(object),
          material: next.name || next.type || '(unnamed)',
          color: materialColorToHex(next.color),
          roughness: Number.isFinite(next.roughness) ? Number(next.roughness.toFixed(3)) : null,
          metalness: Number.isFinite(next.metalness) ? Number(next.metalness.toFixed(3)) : null,
          envMapIntensity: Number.isFinite(next.envMapIntensity) ? Number(next.envMapIntensity.toFixed(3)) : null,
          emissiveIntensity: Number.isFinite(next.emissiveIntensity) ? Number(next.emissiveIntensity.toFixed(3)) : null
        });
      }
      return next;
    };

    if (Array.isArray(object.material)) {
      object.material = object.material.map(liftOne);
    } else {
      object.material = liftOne(object.material);
    }
  });

  const result = {
    found: true,
    roomId,
    targetObjectName: cfg.targetObjectName,
    meshes: meshCount,
    cloned: clonedCount,
    lifted: liftedCount,
    skipped: skippedCount,
    liftedSamples,
    skippedSamples
  };

  target.userData.roomExtMaterialLift = result;
  window.__roomExtMaterialLift = result;

  if (debug) console.info('[material-lift] ROOM_EXT material lift applied', result);
  return result;
}

function isRoomAnimationPlayAllMode(cfg = {}) {
  const maxClips = String(cfg.maxClips ?? '').toLowerCase();
  return Boolean(
    CONFIG?.roomAnimationFullExperience === true
    || cfg.fullExperience === true
    || cfg.playAll === true
    || maxClips === 'all'
  );
}

function initRoomAnimations(gltf, model) {
  const cfg = CONFIG?.roomAnimations || {};
  if (cfg.enabled === false || cfg.autoplay === false) return;
  const clips = Array.isArray(gltf?.animations) ? gltf.animations : [];
  if (!clips.length) {
    console.info('[RoomAnimation] Không tìm thấy animation clip trong GLB phòng.');
    return;
  }

  const skipPattern = /collider|collision|camera/i;
  const allPlayableClips = clips.filter((clip) => !skipPattern.test(String(clip?.name || '')));
  const playAll = isRoomAnimationPlayAllMode(cfg);
  const parsedMaxClips = Number(cfg.maxClips);
  const maxClips = Number.isFinite(parsedMaxClips) && parsedMaxClips > 0 ? Math.floor(parsedMaxClips) : 8;
  const playableClips = playAll ? allPlayableClips : allPlayableClips.slice(0, maxClips);
  if (!playableClips.length) {
    console.info(`[RoomAnimation] Có ${clips.length} clip nhưng đều bị bỏ qua theo tên an toàn.`);
    return;
  }

  try { roomAnimationMixer?.stopAllAction?.(); } catch (_) {}
  roomAnimationActions = [];
  roomAnimationMixer = new THREE.AnimationMixer(model);
  roomAnimationMixer.timeScale = Number(cfg.timeScale || 1);
  const startDelayMs = Math.max(0, Number(cfg.startDelayMs || CONFIG.roomAnimationStartDelayMs || 0));
  roomAnimationActions = playableClips.map((clip) => {
    const action = roomAnimationMixer.clipAction(clip);
    action.enabled = true;
    if (startDelayMs <= 0) action.play();
    return action;
  });
  if (startDelayMs > 0) {
    window.setTimeout(() => {
      roomAnimationActions.forEach((action) => { try { action.play(); } catch (_) {} });
    }, startDelayMs);
  }
  console.info(`[RoomAnimation] Tìm thấy ${clips.length} clip, playable ${allPlayableClips.length} clip, chuẩn bị chạy ${roomAnimationActions.length} clip${playAll ? ' (full)' : ''}${startDelayMs ? ` sau ${startDelayMs}ms` : ''}.`);
}

function loadRoom() {
  setStatus(`Đang tải phòng: ${CONFIG.currentRoomLabel || 'không gian triển lãm'}...`);
  setLoadingProgress(2);

  gltfLoader.load(
    CONFIG.roomUrl,
    (gltf) => {
      const model = gltf.scene;
      model.traverse((obj) => {
        if (!obj.isMesh) return;
        const name = getObjectNameTrail(obj);
        setMaterialDoubleSide(obj);

        const isCollider = name.includes('collider');

        const isWalkable =
          name.includes('floor') ||
          name.includes('stair') ||
          name.includes('stairs') ||
          name.includes('walk') ||
          name.includes('ramp');

        const isNavigationHelper =
          name.includes('walk_') ||
          name.includes('navmesh') ||
          name.includes('walkmesh');

        if (isWalkable) {
          walkableObjects.push(obj);

          // Nếu Blender có mặt phẳng ẩn tên WALK_RAMP / WALK_STAIR_RAMP,
          // ưu tiên dùng nó để đi cầu thang mượt như character controller thật.
          if (
            name.includes('walk_ramp') ||
            name.includes('walk_stair_ramp') ||
            name.includes('stair_ramp') ||
            name.includes('ramp_stair')
          ) {
            rampWalkableObjects.push(obj);
          }
        }

        // Collider thủ công tạo trong Blender.
        // Ví dụ: COLLIDER_BENCH_001, COLLIDER_WALL_001, COLLIDER_TREE_001.
        if (isCollider) {
          colliderObjects.push(obj);
          setMaterialInvisible(obj);

          if (
            name.includes('bench') ||
            name.includes('chair') ||
            name.includes('seat') ||
            name.includes('sofa') ||
            name.includes('ghe') ||
            name.includes('sit')
          ) {
            seatObjects.push(obj);
          }
        }

        // Fallback nhẹ: chỉ dùng các mặt tường/vách/cửa lớn để tránh xuyên tường.
        // Không đưa toàn bộ tranh/ghế/chi tiết nhỏ vào raycast vì dễ gây giật.
        if (!isWalkable && !isNavigationHelper && !isCollider) {
          blockingObjects.push(obj);

          if (
            name.includes('wall') ||
            name.includes('walls') ||
            name.includes('door') ||
            name.includes('doors') ||
            name.includes('window') ||
            name.includes('corner') ||
            name.includes('column') ||
            name.includes('pillar')
          ) {
            wallFallbackObjects.push(obj);
          }
        }

        if (isNavigationHelper) setMaterialInvisible(obj);
      });

      scene.add(model);
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const roomLightingContext = {
        model,
        box,
        size: box.getSize(new THREE.Vector3()),
        center: box.getCenter(new THREE.Vector3()),
        roomId: CONFIG?.currentRoomId || 'unknown'
      };
      if (typeof window.setViewerRoomLightingContext === 'function') {
        window.setViewerRoomLightingContext(roomLightingContext, 'room-loaded-bounds');
      } else {
        window.applyViewerLightingProfile?.({}, 'room-loaded');
      }
      applyRoomExtMaterialLift(model);
      logRoomModelRuntimeDebug(gltf, model, 'room-loaded');
      logRoomMaterialRuntimeDebug(model, box, 'room-loaded');
      initRoomAnimations(gltf, model);
      fallbackFloorY = Number.isFinite(box.min.y) ? box.min.y : 0;

      buildBlockingBoxes();
      buildSeatPoints();
      placeCameraAtStartPoint(model, box);
      if (CONFIG.avatarEnabled && !avatar) {
        createVisitorAvatar();
        syncAvatarToCameraStart();
        forceAvatarCameraView();
      }

      roomLoaded = true;
      if (window.isViewerMobileFastLoad?.()) {
        window.dispatchEvent(new CustomEvent('viewer:room-ready'));
        window.scheduleMobilePixelRatioUpgrade?.();
      }

      setStatus(`✅ <strong>Load phòng thành công</strong><br>${CONFIG.currentRoomLabel ? `Phòng: ${CONFIG.currentRoomLabel}<br>` : ''}Walkable: ${walkableObjects.length}<br>Collider: ${colliderObjects.length}<br>Manual colliders: ${colliderObjects.length}<br>Ramp đi bộ: ${rampWalkableObjects.length}<br>Seat points: ${seatPoints.length}<br>Đang tải dữ liệu tranh...`);
      loadArtworks();
    },
    (xhr) => {
      if (xhr.total) {
        const percent = Math.round((xhr.loaded / xhr.total) * 80);
        setLoadingProgress(percent);
        setStatus(`Đang tải GLB phòng ${CONFIG.currentRoomLabel || 'triển lãm'}: ${Math.round((xhr.loaded / xhr.total) * 100)}%`);
      } else setStatus(`Đang tải GLB phòng: ${CONFIG.currentRoomLabel || 'triển lãm'}...`);
    },
    (error) => {
      showError(`Không load được phòng ${CONFIG.currentRoomId || '3D'}.`, `Kiểm tra file: ${CONFIG.roomUrl}`);
      console.error(error);
    }
  );
}

function placeCameraAtStartPoint(model, box) {
  const startPoint = findObjectByNameCaseInsensitive(model, 'START_POINT') || findObjectByNameCaseInsensitive(model, 'Empty');
  if (startPoint) {
    const pos = new THREE.Vector3();
    startPoint.getWorldPosition(pos);
    camera.position.copy(pos);
  } else {
    const center = box.getCenter(new THREE.Vector3());
    camera.position.set(center.x, fallbackFloorY + CONFIG.eyeHeight, center.z);
  }
  yaw = 0;
  pitch = 0;
  camera.rotation.set(pitch, yaw, 0);
}



async function loadCmsMergedSceneItems(legacyItems) {
  const cms = window.cmsContentLoader;
  if (!cms?.loadCmsContent || !cms?.mergeCmsArtworkMetadata) return Array.isArray(legacyItems) ? legacyItems.slice() : legacyItems;
  const roomKey = String(CONFIG?.currentRoomId || 'indoor').toLowerCase();
  try {
    const content = await cms.loadCmsContent({
      context: 'gallery',
      timeoutMs: Number(CONFIG?.cmsContent?.galleryTimeoutMs || CONFIG?.cmsContent?.timeoutMs || 1600)
    });
    if (!content) return legacyItems.slice();
    return cms.mergeCmsArtworkMetadata(legacyItems, roomKey, content, { context: 'gallery' });
  } catch (error) {
    if (cms.isDebugCms?.()) console.warn('[cms] gallery metadata merge skipped', { roomKey, error: error?.message || String(error) });
    return legacyItems.slice();
  }
}

async function loadArtworks() {
  try {
    let legacyArtworks = null;
    let previewResult = null;

    if (window.sceneDraftPreview?.isLocalDraftPreview?.()) {
      previewResult = window.sceneDraftPreview.loadLocalDraftScene?.(CONFIG.currentRoomId);
      window.sceneDraftPreview.injectPreviewBanner?.(previewResult, { room: CONFIG.currentRoomId });
      if (previewResult?.ok && Array.isArray(previewResult.items)) {
        legacyArtworks = previewResult.items;
        console.info('[preview] Gallery đang dùng local draft scene.', {
          room: CONFIG.currentRoomId,
          draftId: previewResult.manifest?.draftId || 'no-manifest',
          items: legacyArtworks.length
        });
      } else {
        console.warn('[preview] Không đọc được local draft; fallback public scene JSON.', previewResult);
      }
    }

    if (!legacyArtworks && CONFIG?.publishedScene?.enabled === true && window.publishedSceneLoader?.loadPublishedSceneForRoom) {
      const publishedResult = await window.publishedSceneLoader.loadPublishedSceneForRoom(CONFIG.currentRoomId);
      if (publishedResult?.ok && Array.isArray(publishedResult.items)) {
        legacyArtworks = publishedResult.items;
        if (CONFIG?.publishedScene?.debug === true) {
          console.info('[published-scene] Viewer đang dùng published scene.', {
            room: CONFIG.currentRoomId,
            version: publishedResult.manifest?.latestVersion || 'unknown',
            items: legacyArtworks.length
          });
        }
      } else if (CONFIG?.publishedScene?.debug === true) {
        console.warn('[published-scene] Không đọc được published scene; fallback static scene JSON.', publishedResult);
      }
    }

    if (!legacyArtworks) {
      const response = await fetch(CONFIG.sceneJsonUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      legacyArtworks = await response.json();
    }

    if (!Array.isArray(legacyArtworks)) throw new Error('scene.json phải là một mảng JSON.');
    const cmsMergedArtworks = await loadCmsMergedSceneItems(legacyArtworks);
    const artworks = (previewResult?.ok && Array.isArray(previewResult.items) && window.sceneDraftPreview?.reapplyDraftItemOverrides)
      ? window.sceneDraftPreview.reapplyDraftItemOverrides(cmsMergedArtworks, previewResult.items, { room: CONFIG.currentRoomId })
      : cmsMergedArtworks;

    if (previewResult?.ok && artworks !== cmsMergedArtworks) {
      console.info('[preview] Local draft metadata được ưu tiên sau CMS merge.', {
        room: CONFIG.currentRoomId,
        draftId: previewResult.manifest?.draftId || 'no-manifest',
        items: artworks.length
      });
    }

    if (isMobileFastArtworkLoad()) {
      const placeholder = createArtworkPlaceholderTexture();
      const roots = [];
      let invalidCount = 0;

      artworks.forEach((art, index) => {
        const err = validateArtworkData(art, index);
        if (err) {
          invalidCount += 1;
          console.warn(err);
          return;
        }
        try {
          const root = buildArtworkGroup(art, placeholder, { placeholder: true });
          scene.add(root);
          roots.push(root);
        } catch (error) {
          invalidCount += 1;
          console.warn('Không tạo được placeholder tác phẩm:', art?.id || index, error);
        }
      });

      artworksLoaded = true;
      if (typeof refreshArtworkList === 'function') refreshArtworkList();
      markViewerUsableSoon(`✅ <strong>Sẵn sàng tham quan</strong><br>${CONFIG.currentRoomLabel ? `Phòng: ${CONFIG.currentRoomLabel}<br>` : 'Phòng: đã load<br>'}Tác phẩm: ${roots.length}/${artworks.length}<br>${invalidCount > 0 ? `Lỗi dữ liệu: ${invalidCount}<br>` : ''}Ảnh đang tải dần trong nền.`);

      const initialCount = Math.max(1, Number(CONFIG.mobile?.artworkInitialBatchSize || 8));
      const initialRoots = roots.slice(0, initialCount);
      const laterRoots = roots.slice(initialCount);
      initialRoots.forEach((root) => loadArtworkTextureIntoRoot(root));
      scheduleArtworkTextureBatches(laterRoots);
      scheduleSceneVideoAutoplay();
      return;
    }

    const results = await Promise.allSettled(artworks.map((art, index) => createArtworkFromData(art, index)));
    const successCount = results.filter((item) => item.status === 'fulfilled').length;
    const failCount = results.length - successCount;
    artworksLoaded = true;
    if (typeof refreshArtworkList === 'function') refreshArtworkList();
    setLoadingProgress(100);
    setStatus(`✅ <strong>Sẵn sàng</strong><br>${CONFIG.currentRoomLabel ? `Phòng: ${CONFIG.currentRoomLabel}<br>` : 'Phòng: đã load<br>'}Tranh / đối tượng: ${successCount}/${artworks.length}<br>${failCount > 0 ? `Lỗi ảnh: ${failCount}<br>` : ''}Click vào màn hình để bắt đầu · Bấm V để đổi góc nhìn`);
    scheduleSceneVideoAutoplay();
  } catch (error) {
    setLoadingProgress(100);
    showError(`Không load được dữ liệu tranh của phòng ${CONFIG.currentRoomId || ''}.`, `Kiểm tra file: ${CONFIG.sceneJsonUrl}`);
    console.error(error);
  }
}

function validateArtworkData(art, index) {
  if (!art || typeof art !== 'object') return `Scene item index ${index} không hợp lệ.`;
  if (!art.id) return `Scene item index ${index} thiếu id.`;
  const type = getSceneItemType(art);
  if ((type === 'artwork' || type === 'logo') && !getViewerMediaSrc(art)) return `Scene item ${art.id} thiếu image.`;
  if (type === 'video' && !getViewerVideoSrc(art) && !getViewerPosterSrc(art)) return `Scene item ${art.id} thiếu videoUrl hoặc poster.`;
  if (!Array.isArray(art.position) || art.position.length !== 3) return `Scene item ${art.id} thiếu position [x,y,z].`;
  if (!Array.isArray(art.rotation) || art.rotation.length !== 3) return `Scene item ${art.id} thiếu rotation [x,y,z].`;
  if (!Array.isArray(art.size) || art.size.length !== 2) return `Scene item ${art.id} thiếu size [width,height].`;
  return null;
}

function createArtworkFromData(art, index) {
  return new Promise((resolve, reject) => {
    const err = validateArtworkData(art, index);
    if (err) return reject(new Error(err));

    const itemType = getSceneItemType(art);

    if (itemType === 'text') {
      const group = buildArtworkGroup(art, createTextSceneTexture(art));
      scene.add(group);
      resolve(group);
      return;
    }

    if (itemType === 'video') {
      const group = buildArtworkGroup(art, createScenePlaceholderTexture(art.title || art.id, 'VIDEO'), { placeholder: true });
      scene.add(group);
      loadArtworkTextureIntoRoot(group);
      resolve(group);
      return;
    }

    const artworkMediaSrc = getViewerMediaSrc(art);
    textureLoader.load(
      artworkMediaSrc,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = getViewerTextureAnisotropy();
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;

        const group = buildArtworkGroup(art, texture);
        scene.add(group);
        resolve(group);
      },
      undefined,
      (error) => {
        console.warn('Không load được media, dùng placeholder:', artworkMediaSrc, error);
        const group = buildArtworkGroup(art, createScenePlaceholderTexture(art.id, getSceneItemTypeLabel(itemType)));
        scene.add(group);
        resolve(group);
      }
    );
  });
}

function createScenePlaceholderTexture(label, kind = 'MEDIA') {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 432;
  const ctx = canvas.getContext('2d');
  const isVideo = String(kind || '').toUpperCase() === 'VIDEO';
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, isVideo ? '#101827' : '#121925');
  gradient.addColorStop(0.55, '#08101a');
  gradient.addColorStop(1, '#04070c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = isVideo ? 'rgba(232,192,109,0.34)' : 'rgba(232,192,109,0.55)';
  ctx.lineWidth = 5;
  ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

  if (isVideo) {
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2 - 36, 42, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(232,192,109,.15)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,192,109,.45)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - 12, canvas.height / 2 - 58);
    ctx.lineTo(canvas.width / 2 - 12, canvas.height / 2 - 14);
    ctx.lineTo(canvas.width / 2 + 26, canvas.height / 2 - 36);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,250,232,.88)';
    ctx.fill();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,250,232,0.92)';
  ctx.font = '800 32px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(isVideo ? 'VIDEO' : kind, canvas.width / 2, isVideo ? canvas.height / 2 + 48 : canvas.height / 2 - 28);
  ctx.font = '700 26px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(244,246,251,0.82)';
  ctx.fillText(String(label || 'Nội dung trưng bày').slice(0, 34), canvas.width / 2, isVideo ? canvas.height / 2 + 86 : canvas.height / 2 + 26);
  if (isVideo) {
    ctx.font = '750 19px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,250,232,0.74)';
    ctx.fillText(CONFIG?.sceneVideoPlaceholderText || 'Chạm để phát video', canvas.width / 2, canvas.height / 2 + 120);
    ctx.font = '650 16px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(244,246,251,0.56)';
    ctx.fillText(CONFIG?.sceneVideoPlaceholderHint || 'Chạm đúp để xem lớn', canvas.width / 2, canvas.height / 2 + 148);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function createTextSceneTexture(item) {
  const canvas = document.createElement('canvas');
  canvas.width = 1536;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');
  const bg = String(item.backgroundColor || 'transparent').trim();
  if (bg && bg !== 'transparent') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else ctx.clearRect(0, 0, canvas.width, canvas.height);

  const fontSize = Math.max(26, Math.min(180, Number(item.fontSize || 72)));
  const fontWeight = String(item.fontWeight || '800');
  const align = ['left', 'right', 'center'].includes(item.align) ? item.align : 'center';
  const text = String(item.text || item.title || 'TEXT');
  const color = item.color || '#ffffff';

  ctx.font = `${fontWeight} ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  const padding = 96;
  const maxWidth = canvas.width - padding * 2;
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else line = test;
  });
  if (line) lines.push(line);
  if (lines.length === 0) lines.push('TEXT');

  const lineHeight = fontSize * 1.18;
  const totalHeight = lineHeight * lines.length;
  const startY = canvas.height / 2 - totalHeight / 2 + lineHeight / 2;
  const x = align === 'left' ? padding : align === 'right' ? canvas.width - padding : canvas.width / 2;

  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.58)';
  ctx.lineWidth = Math.max(4, fontSize * 0.07);
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 5;

  lines.slice(0, 6).forEach((lineText, idx) => {
    const y = startY + idx * lineHeight;
    ctx.strokeText(lineText, x, y, maxWidth);
    ctx.fillStyle = color;
    ctx.fillText(lineText, x, y, maxWidth);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}


function createSceneVideoStatusTexture(item = {}, primaryText = '', secondaryText = '', state = 'loading') {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 432;
  const ctx = canvas.getContext('2d');
  if (!ctx) return createScenePlaceholderTexture(item?.title || item?.id || 'Video trình chiếu', 'VIDEO');

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, state === 'error' ? '#1c1014' : '#07151b');
  gradient.addColorStop(1, '#03060b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = state === 'loading' ? 'rgba(143,217,255,.34)' : 'rgba(232,192,109,.34)';
  ctx.lineWidth = 3;
  ctx.strokeRect(22, 22, canvas.width - 44, canvas.height - 44);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2 - 30;
  ctx.beginPath();
  ctx.arc(cx, cy, 46, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(232,192,109,.58)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 13, cy - 24);
  ctx.lineTo(cx - 13, cy + 24);
  ctx.lineTo(cx + 28, cy);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,250,232,.90)';
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,250,232,.94)';
  ctx.font = '800 30px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(primaryText || CONFIG?.sceneVideoPlaceholderText || 'Chạm để phát video', cx, cy + 76);
  ctx.fillStyle = 'rgba(244,246,251,.68)';
  ctx.font = '650 18px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(secondaryText || CONFIG?.sceneVideoPlaceholderHint || 'Chạm đúp để xem lớn', cx, cy + 110);

  const title = String(item?.title || item?.id || '').trim();
  if (title) {
    ctx.fillStyle = 'rgba(244,246,251,.48)';
    ctx.font = '700 15px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(title.slice(0, 54), cx, canvas.height - 38);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function applySceneVideoStatusTexture(root, item = {}, state = 'loading', primaryText = '', secondaryText = '') {
  const mat = root?.userData?.imageMaterial;
  if (!root || !mat) return null;
  const old = root.userData.videoStatusTexture;
  if (old && old !== root.userData.videoFallbackTexture && old !== root.userData.videoPosterTexture) {
    try { old.dispose?.(); } catch (_) {}
  }
  const texture = createSceneVideoStatusTexture(item, primaryText, secondaryText, state);
  texture.userData = { ...(texture.userData || {}), sceneVideoStatus: state };
  mat.map = texture;
  mat.needsUpdate = true;
  root.userData.videoStatusTexture = texture;
  root.userData.videoSurfaceState = state;
  root.userData.textureLoaded = false;
  return texture;
}

function disposeSceneVideoPlayer(root) {
  const player = root?.userData?.videoPlayer;
  if (!player) return;
  try { player.video.pause(); } catch (_) {}
  try { player.texture.dispose(); } catch (_) {}
  root.userData.videoPlayer = null;
}

function attachVideoTextureToRoot(root, item, { play = false, forceMuted = false } = {}) {
  const mat = root?.userData?.imageMaterial;
  if (!mat || !item?.videoUrl) return Promise.resolve(false);
  if (sceneVideoMissingUrlCache.has(item.videoUrl)) {
    restoreSceneVideoFallbackTexture(root, item, 'cached-video-error');
    return Promise.resolve(false);
  }

  const existingPlayer = root.userData.videoPlayer;
  if (existingPlayer?.video) {
    const video = existingPlayer.video;
    if (!play) return Promise.resolve(true);
    if (forceMuted) video.muted = true;
    if (!video.paused) {
      try { video.pause(); } catch (_) {}
      root.userData.videoSurfaceState = 'paused';
      setStatus?.('⏸️ <strong>Video đã tạm dừng</strong><br>Click để phát tiếp · nhấp đúp để xem lớn.');
      return Promise.resolve(true);
    }
    const restoreVideoMap = () => {
      if (existingPlayer.texture && mat.map !== existingPlayer.texture) {
        mat.map = existingPlayer.texture;
        mat.needsUpdate = true;
      }
      root.userData.textureLoaded = true;
      root.userData.videoSurfaceState = 'playing';
    };
    const promise = video.play?.();
    if (promise && typeof promise.then === 'function') {
      return promise.then(() => {
        restoreVideoMap();
        return true;
      }).catch((err) => {
        logSceneVideoPreview('surface play rejected', { title: item?.title || item?.id || '', videoUrl: item.videoUrl, reason: err?.message || 'play-rejected' }, 'warn');
        restoreSceneVideoFallbackTexture(root, item, 'play-rejected');
        return false;
      });
    }
    restoreVideoMap();
    return Promise.resolve(true);
  }

  applySceneVideoStatusTexture(
    root,
    item,
    'loading',
    CONFIG?.sceneVideoSurfaceLoadingText || 'Đang chuẩn bị video',
    CONFIG?.sceneVideoSurfaceLoadingHint || 'Nếu trình duyệt chặn, chạm lại để phát'
  );

  const video = document.createElement('video');
  video.src = item.videoUrl;
  video.muted = forceMuted ? true : item.muted !== false;
  video.defaultMuted = video.muted;
  video.loop = item.loop !== false;
  video.playsInline = true;
  video.preload = CONFIG?.sceneVideoSurfacePreload || 'metadata';
  video.crossOrigin = 'anonymous';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  if (video.muted) video.setAttribute('muted', '');

  return new Promise((resolve) => {
    let settled = false;
    let textureAttached = false;
    let playRejected = false;
    const timeoutMs = Math.max(2200, Number(CONFIG?.sceneVideoAttachTimeoutMs || 6500));

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', onPlaying);
      video.removeEventListener('error', onError);
      window.clearTimeout(timeoutId);
    };

    const finish = (ok, reason = '') => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!ok) {
        try { video.pause?.(); } catch (_) {}
        restoreSceneVideoFallbackTexture(root, item, reason || 'video-unavailable');
      }
      resolve(Boolean(ok));
    };

    const attachTextureIfReady = () => {
      if (textureAttached) return true;
      if (CONFIG?.sceneVideoAttachAfterFirstFrame !== false && !hasSceneVideoFirstFrame(video)) return false;
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      mat.map = tex;
      mat.needsUpdate = true;
      root.userData.videoPlayer = { video, texture: tex };
      root.userData.textureLoaded = true;
      root.userData.videoSurfaceState = video.paused ? 'ready' : 'playing';
      textureAttached = true;
      return true;
    };

    const onReady = () => {
      if (!attachTextureIfReady()) return;
      if (!play || !video.paused) finish(true);
    };

    const onPlaying = () => {
      if (attachTextureIfReady()) finish(true);
    };

    const onError = () => {
      root.userData.textureFailed = true;
      sceneVideoMissingUrlCache.add(item.videoUrl);
      logSceneVideoPreview('surface video error', { title: item?.title || item?.id || '', videoUrl: item.videoUrl }, 'warn');
      finish(false, 'video-error');
    };

    const timeoutId = window.setTimeout(() => {
      if (attachTextureIfReady()) {
        finish(true);
        return;
      }
      finish(false, playRejected ? 'play-rejected' : 'video-timeout');
    }, timeoutMs);

    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('timeupdate', onPlaying);
    video.addEventListener('error', onError, { once: true });

    try { video.load?.(); } catch (error) {
      logSceneVideoPreview('surface load call failed', { title: item?.title || item?.id || '', videoUrl: item.videoUrl, reason: error?.message || 'load-call-failed' }, 'warn');
      finish(false, 'load-call-failed');
      return;
    }

    if (play) {
      const playPromise = video.play?.();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            if (attachTextureIfReady()) finish(true);
          })
          .catch((err) => {
            playRejected = true;
            logSceneVideoPreview('surface play rejected', { title: item?.title || item?.id || '', videoUrl: item.videoUrl, reason: err?.message || 'play-rejected' }, 'warn');
            finish(false, 'play-rejected');
          });
      } else if (attachTextureIfReady()) {
        finish(true);
      }
    }
  });
}

function toggleSceneVideoRoot(root) {
  const item = root?.userData?.artData;
  if (!root || !item || item.type !== 'video' || !item.videoUrl) return false;
  const existingVideo = root.userData?.videoPlayer?.video;
  if (existingVideo && !existingVideo.paused) {
    attachVideoTextureToRoot(root, item, { play: true }).then(() => {
      setStatus('⏸️ <strong>Video đã tạm dừng</strong><br>Click để phát tiếp · nhấp đúp để xem lớn.');
    });
    return true;
  }
  setStatus('⏳ <strong>Đang chuẩn bị video</strong><br>Nếu trình duyệt chặn phát, thử chạm lại hoặc chạm đúp để xem lớn.');
  attachVideoTextureToRoot(root, item, { play: true }).then((ok) => {
    if (ok) setStatus('▶️ <strong>Video</strong><br>Click để phát/tạm dừng · nhấp đúp để xem lớn.');
    else setStatus('⚠️ <strong>Chưa phát được video</strong><br>Surface đã giữ placeholder; chạm đúp để thử xem lớn.');
  });
  return true;
}

window.toggleSceneVideoRoot = toggleSceneVideoRoot;
window.pauseSceneVideoRoot = function pauseSceneVideoRoot(root) {
  const player = root?.userData?.videoPlayer;
  if (!player?.video) return false;
  try { player.video.pause(); return true; } catch (_) { return false; }
};

function buildArtworkGroup(art, texture, options = {}) {
  const width = Number(art.size[0]);
  const height = Number(art.size[1]);
  const itemType = getSceneItemType(art);
  const clickable = art.clickable !== false;
  const withFrame = art.frame !== false;
  const transparent = itemType === 'logo' ? true : art.transparent === true;

  const root = new THREE.Group();
  root.name = art.id;
  root.position.set(Number(art.position[0]), Number(art.position[1]), Number(art.position[2]));
  root.rotation.set(Number(art.rotation[0]), Number(art.rotation[1]), Number(art.rotation[2]));

  const artData = {
    id: art.id,
    type: itemType,
    title: art.title || art.id,
    description: art.description || art.desc || '',
    image: getViewerMediaSrc(art),
    imageUrl: art.imageUrl || art.image_url || '',
    thumbnail: art.thumbnail || art.thumbnail_url || '',
    videoUrl: getViewerVideoSrc(art),
    poster: getViewerPosterSrc(art),
    autoplay: art.autoplay === true,
    muted: art.muted !== false,
    loop: art.loop !== false,
    controls: art.controls === true,
    fitMode: ['contain', 'cover', 'stretch'].includes(art.fitMode) ? art.fitMode : 'contain',
    text: art.text || '',
    color: art.color || '#ffffff',
    backgroundColor: art.backgroundColor || 'transparent',
    fontSize: art.fontSize || 72,
    fontWeight: art.fontWeight || '800',
    align: art.align || 'center',
    author: readField(art, ['author', 'artist', 'creator', 'authorUnit'], ''),
    year: readField(art, ['year', 'date', 'nam'], ''),
    material: readField(art, ['material', 'medium', 'chatLieu', 'typeLabel'], ''),
    medium: readField(art, ['medium', 'material', 'chatLieu', 'typeLabel'], ''),
    realSize: readField(art, ['realSize', 'actualSize', 'kichThuocThat', 'sizeReal'], ''),
    content: readField(art, ['content', 'story', 'longDescription', 'thuyetMinh', 'body'], ''),
    note: readField(art, ['note', 'internalNote', 'ghiChu', 'noteDisplay'], ''),
    group: art.group || 'Không phân nhóm',
    size: [width, height],
    clickable,
  };

  root.userData = {
    type: 'artworkRoot',
    itemType,
    artData,
    clickable,
    emphasis: 0,
    textureLoaded: options.placeholder !== true,
    textureLoading: false,
    textureFailed: false,
  };

  const display = new THREE.Group();
  display.name = `${art.id}_DISPLAY`;
  root.add(display);
  root.userData.display = display;

  const imageGeometry = new THREE.PlaneGeometry(width, height);
  const imageMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent,
    alphaTest: transparent ? 0.05 : 0,
    roughness: 0.78,
    metalness: 0.0,
    emissive: new THREE.Color(0x000000),
  });

  root.userData.imageMaterial = imageMaterial;

  const imageMesh = new THREE.Mesh(imageGeometry, imageMaterial);
  imageMesh.name = `${art.id}_IMAGE`;
  imageMesh.position.z = CONFIG.frameDepth / 2 + (withFrame ? 0.004 : 0.015);
  imageMesh.userData.artRoot = root;
  root.userData.imageMesh = imageMesh;
  display.add(imageMesh);

  if (clickable) interactiveArtworkMeshes.push(imageMesh);

  if (withFrame) {
    const frame = buildFrame(width, height, root, clickable);
    display.add(frame);
  }

  // Viền sáng outline khi ngắm/chọn tranh.
  const glowOutline = buildGlowOutline(width, height, root);
  display.add(glowOutline);
  root.userData.glowOutline = glowOutline;

  artworkRoots.push(root);
  if (itemType === 'video') sceneVideoRoots.push(root);
  return root;
}


function buildGlowOutline(width, height, root) {
  const group = new THREE.Group();
  group.name = 'MINIMAL_CYAN_HUD_OUTLINE';

  const hardMat = new THREE.MeshBasicMaterial({
    color: 0x86f7ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });

  const softMat = new THREE.MeshBasicMaterial({
    color: 0xaefbff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });

  const whiteMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });

  const makeBar = (w, h, x, y, mat, z, name, role) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.name = name;
    mesh.userData.isGlowOutline = true;
    mesh.userData.glowRole = role;
    mesh.userData.artRoot = root;
    return mesh;
  };

  const p = CONFIG.outlinePadding;
  const sp = CONFIG.outlineSoftPadding;
  const t = CONFIG.outlineThickness;

  const hardW = width + p * 2;
  const hardH = height + p * 2;
  const softW = width + sp * 2;
  const softH = height + sp * 2;

  const zHard = CONFIG.frameDepth / 2 + 0.036;
  const zSoft = CONFIG.frameDepth / 2 + 0.030;
  const zWhite = CONFIG.frameDepth / 2 + 0.040;

  // Soft glow sát tranh, rất mỏng.
  const st = t * 2.4;
  group.add(makeBar(softW, st, 0, softH / 2, softMat, zSoft, 'SOFT_TOP', 'soft'));
  group.add(makeBar(softW, st, 0, -softH / 2, softMat, zSoft, 'SOFT_BOTTOM', 'soft'));
  group.add(makeBar(st, softH, -softW / 2, 0, softMat, zSoft, 'SOFT_LEFT', 'soft'));
  group.add(makeBar(st, softH, softW / 2, 0, softMat, zSoft, 'SOFT_RIGHT', 'soft'));

  // Hairline chính sát mép tranh.
  group.add(makeBar(hardW, t, 0, hardH / 2, hardMat, zHard, 'HUD_TOP', 'hard'));
  group.add(makeBar(hardW, t, 0, -hardH / 2, hardMat, zHard, 'HUD_BOTTOM', 'hard'));
  group.add(makeBar(t, hardH, -hardW / 2, 0, hardMat, zHard, 'HUD_LEFT', 'hard'));
  group.add(makeBar(t, hardH, hardW / 2, 0, hardMat, zHard, 'HUD_RIGHT', 'hard'));

  // Corner bracket hiện đại, không dùng vàng.
  const c = Math.min(width, height) * 0.28;
  const ct = t * 2.2;

  const xL = -hardW / 2;
  const xR = hardW / 2;
  const yT = hardH / 2;
  const yB = -hardH / 2;

  // top-left
  group.add(makeBar(c, ct, xL + c / 2, yT, whiteMat, zWhite, 'CORNER_TL_H', 'corner'));
  group.add(makeBar(ct, c, xL, yT - c / 2, whiteMat, zWhite, 'CORNER_TL_V', 'corner'));

  // top-right
  group.add(makeBar(c, ct, xR - c / 2, yT, whiteMat, zWhite, 'CORNER_TR_H', 'corner'));
  group.add(makeBar(ct, c, xR, yT - c / 2, whiteMat, zWhite, 'CORNER_TR_V', 'corner'));

  // bottom-left
  group.add(makeBar(c, ct, xL + c / 2, yB, whiteMat, zWhite, 'CORNER_BL_H', 'corner'));
  group.add(makeBar(ct, c, xL, yB + c / 2, whiteMat, zWhite, 'CORNER_BL_V', 'corner'));

  // bottom-right
  group.add(makeBar(c, ct, xR - c / 2, yB, whiteMat, zWhite, 'CORNER_BR_H', 'corner'));
  group.add(makeBar(ct, c, xR, yB + c / 2, whiteMat, zWhite, 'CORNER_BR_V', 'corner'));

  // Scan line mảnh ở cạnh dưới, tạo cảm giác HUD nhưng không lòe loẹt.
  const scanW = hardW * 0.42;
  group.add(makeBar(scanW, t * 0.8, 0, yB - t * 3.2, hardMat, zWhite, 'SCAN_LINE', 'scan'));

  group.visible = false;
  return group;
}

function buildFrame(width, height, root, clickable) {
  const border = CONFIG.frameBorder;
  const depth = CONFIG.frameDepth;
  const frameGroup = new THREE.Group();
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: CONFIG.frameColor,
    roughness: 0.6,
    metalness: 0.12,
    emissive: new THREE.Color(0x000000),
  });

  const topBottomGeometry = new THREE.BoxGeometry(width + border * 2, border, depth);
  const sideGeometry = new THREE.BoxGeometry(border, height, depth);
  const top = new THREE.Mesh(topBottomGeometry, frameMaterial);
  const bottom = new THREE.Mesh(topBottomGeometry, frameMaterial);
  const left = new THREE.Mesh(sideGeometry, frameMaterial);
  const right = new THREE.Mesh(sideGeometry, frameMaterial);
  top.position.set(0, height / 2 + border / 2, 0);
  bottom.position.set(0, -height / 2 - border / 2, 0);
  left.position.set(-width / 2 - border / 2, 0, 0);
  right.position.set(width / 2 + border / 2, 0, 0);
  frameGroup.add(top, bottom, left, right);
  if (clickable) {
    frameGroup.traverse((child) => {
      if (child.isMesh) {
        child.userData.artRoot = root;
        interactiveArtworkMeshes.push(child);
      }
    });
  }
  return frameGroup;
}



