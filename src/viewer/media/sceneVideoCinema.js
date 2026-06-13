// HOTFIX V6.11.2 — Scene video item cinema modal.
// Dùng cho item type=video trong scene JSON, không dùng legacy wall video.
(function initSceneVideoCinema(global) {
  let modal = null;
  let videoEl = null;
  let titleEl = null;
  let closeBtn = null;
  let backdrop = null;
  let messageEl = null;
  let openedRoot = null;
  let loadGuardTimer = 0;

  function ensureModal() {
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'sceneVideoCinema';
    modal.className = 'scene-video-cinema';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="scene-video-cinema__backdrop" data-scene-video-close></div>
      <section class="scene-video-cinema__dialog" role="dialog" aria-modal="true" aria-label="Video trình chiếu">
        <header class="scene-video-cinema__head">
          <div>
            <span class="scene-video-cinema__eyebrow">Video trình chiếu</span>
            <h2 class="scene-video-cinema__title">Video</h2>
          </div>
          <button class="scene-video-cinema__close" type="button" data-scene-video-close aria-label="Đóng video">×</button>
        </header>
        <div class="scene-video-cinema__body">
          <video class="scene-video-cinema__player" controls playsinline preload="metadata"></video>
          <div class="scene-video-cinema__message" aria-live="polite" hidden>Video chưa phát được trên thiết bị này. Vui lòng thử lại hoặc xem trên Chrome/Edge.</div>
        </div>
      </section>
    `;

    document.body.appendChild(modal);
    videoEl = modal.querySelector('.scene-video-cinema__player');
    titleEl = modal.querySelector('.scene-video-cinema__title');
    closeBtn = modal.querySelector('.scene-video-cinema__close');
    backdrop = modal.querySelector('.scene-video-cinema__backdrop');
    messageEl = modal.querySelector('.scene-video-cinema__message');

    modal.addEventListener('click', (event) => {
      if (event.target?.matches?.('[data-scene-video-close]')) closeSceneVideoCinema();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal?.classList.contains('is-open')) closeSceneVideoCinema();
    });

    videoEl?.addEventListener('loadeddata', () => setCinemaMessage('', false));
    videoEl?.addEventListener('canplay', () => setCinemaMessage('', false));
    videoEl?.addEventListener('playing', () => setCinemaMessage('', false));
    videoEl?.addEventListener('error', () => {
      const src = videoEl?.currentSrc || videoEl?.src || '';
      console.warn('[SceneVideoCinema] Không đọc được video:', src);
      setCinemaMessage(getCinemaErrorText('error'), true);
      global.setStatus?.('⚠️ <strong>Không mở được video</strong><br>Kiểm tra đường dẫn video trong dữ liệu phòng.');
    });

    return modal;
  }

  function setCinemaMessage(text = '', visible = false) {
    if (!messageEl) return;
    messageEl.textContent = text || '';
    messageEl.hidden = !visible;
    messageEl.classList.toggle('is-visible', Boolean(visible));
  }

  function clearCinemaLoadGuard() {
    window.clearTimeout(loadGuardTimer);
    loadGuardTimer = 0;
  }

  function getCinemaErrorText(kind = 'error') {
    if (kind === 'loading') return CONFIG?.sceneVideoCinemaLoadingText || 'Đang chuẩn bị video…';
    if (kind === 'policy') return CONFIG?.sceneVideoCinemaPolicyText || 'Nếu video chưa tự phát, hãy bấm Play trên thanh điều khiển.';
    return CONFIG?.sceneVideoCinemaErrorText || 'Video chưa phát được trên thiết bị này. Vui lòng thử lại hoặc xem trên Chrome/Edge.';
  }

  function getRootAndItem(input) {
    if (!input) return { root: null, item: null };
    if (input.userData?.artData) return { root: input, item: input.userData.artData };
    return { root: null, item: input };
  }

  function openSceneVideoCinema(input) {
    const { root, item } = getRootAndItem(input);
    if (!item || item.type !== 'video' || !item.videoUrl) {
      global.setStatus?.('⚠️ <strong>Video chưa sẵn sàng</strong><br>Thiếu đường dẫn video trong dữ liệu phòng.');
      return false;
    }

    ensureModal();
    openedRoot = root || null;

    if (openedRoot?.userData?.videoPlayer?.video) {
      try { openedRoot.userData.videoPlayer.video.pause(); } catch (_) {}
    }

    titleEl.textContent = item.title || item.id || 'Video trình chiếu';
    if (item.poster) videoEl.setAttribute('poster', item.poster);
    else videoEl.removeAttribute('poster');
    clearCinemaLoadGuard();
    setCinemaMessage(item.poster ? '' : getCinemaErrorText('loading'), !item.poster);

    if (videoEl.getAttribute('src') !== item.videoUrl) {
      videoEl.pause();
      videoEl.setAttribute('src', item.videoUrl);
      try { videoEl.load?.(); } catch (_) {}
    }

    videoEl.muted = item.muted === true;
    videoEl.loop = item.loop === true;
    videoEl.playsInline = true;
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('webkit-playsinline', '');

    document.exitPointerLock?.();
    global.releaseAllMobileKeys?.();
    document.body.classList.add('viewer-scene-video-open');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');

    loadGuardTimer = window.setTimeout(() => {
      if (!videoEl || videoEl.readyState >= 2 || videoEl.currentTime > 0) return;
      setCinemaMessage(getCinemaErrorText(videoEl.error ? 'error' : 'policy'), true);
    }, Math.max(2500, Number(CONFIG?.sceneVideoCinemaFallbackTimeoutMs || 6500)));

    const playPromise = videoEl.play?.();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        // Browser có thể chặn autoplay có tiếng; native controls vẫn cho người dùng bấm play.
        if (!videoEl.error) setCinemaMessage(getCinemaErrorText('policy'), true);
      });
    }

    window.setTimeout(() => closeBtn?.focus?.({ preventScroll: true }), 30);
    return true;
  }

  function closeSceneVideoCinema() {
    if (!modal || !modal.classList.contains('is-open')) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('viewer-scene-video-open');
    clearCinemaLoadGuard();
    setCinemaMessage('', false);
    try { videoEl?.pause?.(); } catch (_) {}
    openedRoot = null;
    global.releaseAllMobileKeys?.();
  }

  global.openSceneVideoCinema = openSceneVideoCinema;
  global.closeSceneVideoCinema = closeSceneVideoCinema;
})(window);
