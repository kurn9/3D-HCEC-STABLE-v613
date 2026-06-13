import '../shared/cmsSchemaValidator.js';
import '../shared/cmsContentLoader.js';
import { loadNormalizedIndexCmsContent } from './indexCmsNormalizer.js';
import { initLiquidCursor } from './liquidCursor.js';
import { INDEX_VIDEO_CONFIG } from './indexVideoConfig.js';

const revealItems = Array.from(document.querySelectorAll('[data-reveal]'));

function revealImmediately() {
  revealItems.forEach((item) => item.classList.add('is-visible'));
}

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12 });

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealImmediately();
}

const videoCard = document.querySelector('.hero-video-card');
const heroVideo = document.querySelector('.hero-video');
const introModalVideo = document.querySelector('.intro-video-player');

function isMobileIntroViewport() {
  return Boolean(
    window.matchMedia?.('(pointer: coarse)')?.matches ||
    window.matchMedia?.('(hover: none)')?.matches ||
    window.innerWidth <= 920
  );
}

function getSafeVideoPreload(value, fallback = 'metadata') {
  return ['none', 'metadata', 'auto'].includes(value) ? value : fallback;
}

function setHeroVideoFallbackText(text) {
  const label = videoCard?.querySelector?.('.video-fallback span');
  if (label && text) label.textContent = text;
}

function getIndexVideoSupport(video) {
  // Probe chỉ hỗ trợ chẩn đoán. Không dùng kết quả canPlayType() để chặn phát video.
  if (!INDEX_VIDEO_CONFIG?.compatibilityProbe) return { supported: true, detail: 'probe-disabled' };
  const mimeType = INDEX_VIDEO_CONFIG?.mimeType;
  if (!mimeType || !video?.canPlayType) return { supported: true, detail: 'probe-unavailable' };
  const support = video.canPlayType(mimeType);
  return { supported: support === 'probably' || support === 'maybe', detail: support || 'unsupported' };
}

function markVideoPlaybackEvidence(video, evidence = 'ready') {
  if (!video) return;
  video.dataset.indexVideoEvidence = evidence;
}

function hasVideoPlaybackEvidence(video) {
  if (!video) return false;
  return Boolean(
    video.dataset.indexVideoEvidence ||
    Number(video.readyState || 0) >= 2 ||
    Number(video.currentTime || 0) > 0 ||
    video.dataset.indexVideoPlaying === '1'
  );
}

function getVideoMediaErrorCode(video) {
  return Number(video?.error?.code || 0);
}

function isCodecOrSourceFailure(video, error) {
  if (hasVideoPlaybackEvidence(video)) return false;
  const code = getVideoMediaErrorCode(video);
  if (code === 3 || code === 4) return true; // MEDIA_ERR_DECODE / MEDIA_ERR_SRC_NOT_SUPPORTED
  return error?.name === 'NotSupportedError';
}

function getUnsupportedVideoText() {
  return INDEX_VIDEO_CONFIG?.unsupportedText || 'Trình duyệt/thiết bị hiện không hỗ trợ định dạng video này. Vui lòng xem trên Chrome/Edge máy tính hoặc dùng bản video tương thích sau.';
}

function getModalVideoMessageNode() {
  const dialog = document.querySelector('.intro-video-dialog');
  if (!dialog) return null;
  let message = dialog.querySelector('.intro-video-message');
  if (!message) {
    message = document.createElement('div');
    message.className = 'intro-video-message';
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    const label = document.createElement('span');
    message.appendChild(label);
    dialog.appendChild(message);
  }
  return message;
}

function setModalVideoMessage(text, mode = 'info') {
  const message = getModalVideoMessageNode();
  const dialog = message?.closest?.('.intro-video-dialog');
  if (!message || !dialog || !text) return;
  const label = message.querySelector('span') || message;
  label.textContent = text;
  dialog.classList.add('has-video-message');
  dialog.dataset.videoMessageMode = mode;
}

function clearModalVideoMessage() {
  const message = document.querySelector('.intro-video-message');
  const dialog = message?.closest?.('.intro-video-dialog');
  if (dialog) {
    dialog.classList.remove('has-video-message');
    delete dialog.dataset.videoMessageMode;
  }
  if (message) {
    const label = message.querySelector('span') || message;
    label.textContent = '';
  }
}

function shouldAutoplayHeroVideo() {
  const isMobile = isMobileIntroViewport();
  return isMobile
    ? INDEX_VIDEO_CONFIG?.mobileHeroAutoplay !== false
    : INDEX_VIDEO_CONFIG?.desktopHeroAutoplay !== false;
}

function applyIndexVideoConfig() {
  const src = INDEX_VIDEO_CONFIG?.src || 'https://pub-d00970587980484399ff842b58cd1e9e.r2.dev/intro.mp4';
  const poster = INDEX_VIDEO_CONFIG?.poster || '';
  const isMobile = isMobileIntroViewport();
  const heroPreload = getSafeVideoPreload(
    isMobile ? INDEX_VIDEO_CONFIG?.mobileHeroPreload : INDEX_VIDEO_CONFIG?.heroPreload,
    isMobile ? 'metadata' : 'auto'
  );
  const modalPreload = getSafeVideoPreload(INDEX_VIDEO_CONFIG?.modalPreload, 'metadata');

  [heroVideo, introModalVideo].forEach((video) => {
    if (!video) return;
    if (video.getAttribute('src') !== src) video.setAttribute('src', src);
    if (poster) video.setAttribute('poster', poster);
    else video.removeAttribute('poster');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
  });

  if (heroVideo) {
    const enableHeroAutoplay = isMobile
      ? INDEX_VIDEO_CONFIG?.mobileHeroAutoplay !== false
      : INDEX_VIDEO_CONFIG?.desktopHeroAutoplay !== false;
    heroVideo.preload = heroPreload;
    heroVideo.setAttribute('preload', heroPreload);
    heroVideo.autoplay = enableHeroAutoplay;
    if (enableHeroAutoplay) heroVideo.setAttribute('autoplay', '');
    else heroVideo.removeAttribute('autoplay');
  }

  if (introModalVideo) {
    introModalVideo.preload = modalPreload;
    introModalVideo.setAttribute('preload', modalPreload);
    introModalVideo.controls = true;
    introModalVideo.setAttribute('controls', '');
  }
}

applyIndexVideoConfig();


function setTextContentSafe(target, value) {
  if (!target || value === null || value === undefined) return false;
  const text = window.cmsContentLoader?.sanitizeText?.(value) ?? String(value).trim();
  if (!text) return false;
  target.textContent = text;
  return true;
}

function setMultilineTextSafe(target, value) {
  if (!target || value === null || value === undefined) return false;
  const text = window.cmsContentLoader?.sanitizeText?.(value) ?? String(value).trim();
  if (!text) return false;
  target.replaceChildren();
  text.split(/\n+/).map((line) => line.trim()).filter(Boolean).forEach((line, index, lines) => {
    const span = document.createElement('span');
    span.textContent = line;
    target.appendChild(span);
    if (index < lines.length - 1) {
      target.appendChild(document.createElement('br'));
    }
  });
  return true;
}

function applyCmsIndexContent(indexContent, mediaOptions = {}) {
  const cms = window.cmsContentLoader;
  if (!indexContent) return 0;

  let changed = 0;
  const hero = indexContent.hero || {};
  const experience = indexContent.experience || {};
  const guide = indexContent.guide || {};
  const contact = indexContent.contact || {};

  changed += setTextContentSafe(document.querySelector('.hero-content .eyebrow'), hero.eyebrow) ? 1 : 0;
  changed += setTextContentSafe(document.getElementById('heroTitle'), hero.title) ? 1 : 0;
  changed += setMultilineTextSafe(document.querySelector('.hero-lead'), hero.lead) ? 1 : 0;
  changed += setTextContentSafe(document.querySelector('.experience-note'), hero.recommendation) ? 1 : 0;
  changed += setTextContentSafe(document.querySelector('.display-case-caption'), hero.media?.caption) ? 1 : 0;

  if (Array.isArray(hero.proofChips) && hero.proofChips.length) {
    const chips = Array.from(document.querySelectorAll('.hero-proof-grid span strong'));
    hero.proofChips.slice(0, chips.length).forEach((label, index) => {
      changed += setTextContentSafe(chips[index], label) ? 1 : 0;
    });
  }

  if (hero.media?.videoUrl && cms?.isSafeMediaUrl?.(hero.media.videoUrl, {
    ...mediaOptions,
    allowedMediaExtensions: ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v'],
    disallowSignedMediaUrls: true
  })) {
    [heroVideo, introModalVideo].forEach((video) => {
      if (!video || video.getAttribute('src') === hero.media.videoUrl) return;
      video.setAttribute('src', hero.media.videoUrl);
      try { video.load?.(); } catch (_) {}
      changed += 1;
    });
  }

  changed += setTextContentSafe(document.querySelector('.stage-section--experience .section-kicker'), experience.kicker) ? 1 : 0;
  changed += setTextContentSafe(document.getElementById('visitTitle'), experience.title) ? 1 : 0;
  changed += setTextContentSafe(document.querySelector('.stage-section--experience .section-header p'), experience.lead) ? 1 : 0;

  if (Array.isArray(experience.routes)) {
    experience.routes.forEach((route) => {
      const roomKey = String(route?.room_key || '').toLowerCase();
      if (!roomKey) return;
      const card = document.querySelector(`.route-card--${roomKey}`);
      if (!card) return;
      changed += setTextContentSafe(card.querySelector('.route-card-topline span'), route.label) ? 1 : 0;
      changed += setTextContentSafe(card.querySelector('h3'), route.title) ? 1 : 0;
      changed += setTextContentSafe(card.querySelector('p'), route.description) ? 1 : 0;
      changed += setTextContentSafe(card.querySelector('.room-link span'), route.ctaLabel) ? 1 : 0;
    });
  }

  changed += setTextContentSafe(document.querySelector('.stage-section--guide .section-kicker'), guide.kicker) ? 1 : 0;
  changed += setTextContentSafe(document.getElementById('visitorGuideTitle'), guide.title) ? 1 : 0;
  changed += setTextContentSafe(document.querySelector('.guide-detail-heading p'), guide.lead) ? 1 : 0;

  if (Array.isArray(guide.steps)) {
    const stepCards = Array.from(document.querySelectorAll('.journey-rail article'));
    guide.steps.slice(0, stepCards.length).forEach((step, index) => {
      const card = stepCards[index];
      changed += setTextContentSafe(card.querySelector('span'), step.number) ? 1 : 0;
      changed += setTextContentSafe(card.querySelector('strong'), step.title) ? 1 : 0;
      changed += setTextContentSafe(card.querySelector('p'), step.description) ? 1 : 0;
    });
  }

  const contactRows = Array.from(document.querySelectorAll('.guide-contact-strip p'));
  if (contactRows[0]) {
    changed += setTextContentSafe(contactRows[0].querySelector('span'), contact.label || 'Đơn vị thực hiện') ? 1 : 0;
    changed += setTextContentSafe(contactRows[0].querySelector('strong'), contact.organizationName) ? 1 : 0;
  }
  if (contactRows[1]) {
    changed += setTextContentSafe(contactRows[1].querySelector('span'), 'Địa chỉ') ? 1 : 0;
    changed += setTextContentSafe(contactRows[1].querySelector('strong'), contact.address) ? 1 : 0;
  }
  if (contactRows[2]) {
    changed += setTextContentSafe(contactRows[2].querySelector('span'), 'Điện thoại / Fax') ? 1 : 0;
    changed += setTextContentSafe(contactRows[2].querySelector('strong'), contact.phoneFax) ? 1 : 0;
  }

  return changed;
}

async function initCmsIndexHydration() {
  const cms = window.cmsContentLoader;
  if (!cms?.loadCmsContent) return;
  try {
    const normalized = await loadNormalizedIndexCmsContent(cms, { context: 'index', timeoutMs: 1000 });
    if (!normalized?.index) return;
    const changed = applyCmsIndexContent(normalized.index, normalized.mediaOptions);
    if (cms.isDebugCms?.()) {
      console.debug('[cms] index hydrated', {
        changed,
        source: normalized.source || cms.getCmsSource?.(),
        remoteStatus: normalized.remoteStatus,
        fallbackStatus: normalized.fallbackStatus,
        warnings: normalized.diagnostics?.warnings || []
      });
    }
  } catch (error) {
    if (cms.isDebugCms?.()) console.warn('[cms] index hydration skipped', error);
  }
}

if (videoCard && heroVideo) {
  const fallbackTimeoutMs = Math.max(3500, Math.min(9000, Number(INDEX_VIDEO_CONFIG?.loadingFallbackTimeoutMs) || 6500));

  videoCard.classList.add('is-video-loading');
  videoCard.classList.remove('is-video-fallback', 'is-video-missing', 'is-video-unsupported');
  setHeroVideoFallbackText(INDEX_VIDEO_CONFIG?.loadingText || 'Video giới thiệu đang tải');

  heroVideo.muted = true;
  heroVideo.defaultMuted = true;
  heroVideo.loop = true;
  heroVideo.playsInline = true;
  heroVideo.setAttribute('playsinline', '');
  heroVideo.setAttribute('webkit-playsinline', '');

  const markReady = (event) => {
    markVideoPlaybackEvidence(heroVideo, event?.type || 'ready');
    videoCard.classList.remove('is-video-loading', 'is-video-fallback', 'is-video-missing', 'is-video-unsupported');
  };

  const markFallback = () => {
    if (hasVideoPlaybackEvidence(heroVideo) || videoCard.classList.contains('is-video-missing')) return;
    videoCard.classList.remove('is-video-loading', 'is-video-unsupported');
    videoCard.classList.add('is-video-fallback');
    setHeroVideoFallbackText(INDEX_VIDEO_CONFIG?.fallbackText || 'Chạm để xem video giới thiệu');
  };

  const markHeroLoadError = (event) => {
    if (hasVideoPlaybackEvidence(heroVideo)) return;
    videoCard.classList.remove('is-video-loading', 'is-video-unsupported');
    videoCard.classList.add('is-video-missing', 'is-video-fallback');
    setHeroVideoFallbackText(INDEX_VIDEO_CONFIG?.fallbackText || 'Chạm để xem video giới thiệu');
    console.warn(`Không đọc được video index tại ${INDEX_VIDEO_CONFIG.src}. Hãy kiểm tra file public build và codec H.264/AAC cho iPhone Safari.`, event?.error || heroVideo.error || '');
  };

  heroVideo.addEventListener('loadeddata', markReady);
  heroVideo.addEventListener('canplay', markReady);
  heroVideo.addEventListener('playing', markReady);
  heroVideo.addEventListener('timeupdate', () => {
    if (heroVideo.currentTime > 0) markVideoPlaybackEvidence(heroVideo, 'timeupdate');
  });
  heroVideo.addEventListener('error', markHeroLoadError);

  const safePlayHeroVideo = () => {
    if (!shouldAutoplayHeroVideo()) return;
    heroVideo.muted = true;
    heroVideo.defaultMuted = true;
    heroVideo.playsInline = true;
    heroVideo.setAttribute('muted', '');
    heroVideo.setAttribute('playsinline', '');
    heroVideo.setAttribute('webkit-playsinline', '');
    const promise = heroVideo.play?.();
    if (promise && typeof promise.catch === 'function') {
      promise.catch((error) => {
        if (isCodecOrSourceFailure(heroVideo, error)) markHeroLoadError({ error });
        else markFallback();
      });
    }
  };

  safePlayHeroVideo();
  if (shouldAutoplayHeroVideo()) {
    window.addEventListener('pageshow', safePlayHeroVideo, { passive: true });
  }

  window.setTimeout(markFallback, fallbackTimeoutMs);
}

const GALLERY_WARMUP_URLS = [
  './gallery.html',
  './styles/viewer.css',
  './src/viewer/main.js',
  './data/scene.json',
  './data/scene_outdoor.json'
];

let galleryWarmupDone = false;

function appendPrefetch(url) {
  const exists = Array.from(document.querySelectorAll('link[rel="prefetch"]'))
    .some((link) => link.getAttribute('href') === url);
  if (exists) return;

  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = url;
  document.head.appendChild(link);
}

function warmupGallery({ immediate = false } = {}) {
  const run = () => {
    if (galleryWarmupDone) return;
    galleryWarmupDone = true;
    GALLERY_WARMUP_URLS.forEach(appendPrefetch);
  };

  if (immediate) {
    run();
    return;
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 900 });
  } else {
    window.setTimeout(run, 80);
  }
}


function updateViewportMetrics() {
  const root = document.documentElement;
  const width = Math.max(window.innerWidth || 0, 1);
  const height = Math.max(window.innerHeight || 0, 1);
  root.style.setProperty('--viewport-w', `${width}px`);
  root.style.setProperty('--viewport-h', `${height}px`);
  root.style.setProperty('--vh', `${height * 0.01}px`);

  const compactDisplay = width <= 1280 || height <= 760;
  const smallDisplay = width <= 1024 || height <= 680;
  const tinyDisplay = width <= 820 || height <= 620;
  const ultraWide = width / height >= 2.05;
  const tallDisplay = height >= 1100 && width >= 1280;
  document.body.classList.toggle('is-compact-display', compactDisplay);
  document.body.classList.toggle('is-small-display', smallDisplay);
  document.body.classList.toggle('is-tiny-display', tinyDisplay);
  document.body.classList.toggle('is-ultrawide-display', ultraWide);
  document.body.classList.toggle('is-tall-display', tallDisplay);
}


function initHeaderScrollState() {
  const header = document.querySelector('.site-header, [data-site-header]');
  if (!header) return;

  let rafId = 0;
  const update = () => {
    rafId = 0;
    const scrolled = window.scrollY > 24;
    document.body.classList.toggle('is-header-scrolled', scrolled);
    header.classList.toggle('is-scrolled', scrolled);
  };

  const requestUpdate = () => {
    if (rafId) return;
    rafId = window.requestAnimationFrame(update);
  };

  update();
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
}

function initViewportMetrics() {
  updateViewportMetrics();
  window.addEventListener('resize', updateViewportMetrics, { passive: true });
  window.addEventListener('orientationchange', () => window.setTimeout(updateViewportMetrics, 120), { passive: true });
}

function initStagePresence() {
  const sections = Array.from(document.querySelectorAll('[data-intro-section]'));
  if (!sections.length || !('IntersectionObserver' in window)) return;

  // V6.11.15: giữ observer nhẹ cho reveal/state, nhưng không mutate --stage-depth theo scroll.
  // Scroll-depth/parallax cũ tạo cảm giác section bị co/dính sau khi cuộn hoặc bấm nav.
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      entry.target.classList.toggle('is-stage-near', entry.isIntersecting);
    });
  }, { threshold: [0.18, 0.42, 0.66], rootMargin: '-10% 0px -12% 0px' });

  sections.forEach((section) => {
    section.style.removeProperty('--stage-depth');
    observer.observe(section);
  });
}

function updateHeaderOffset() {
  const header = document.querySelector('.site-header, .intro-header, [data-site-header]');
  const height = header ? Math.ceil(header.getBoundingClientRect().height) : 88;
  const viewportHeight = Math.max(window.innerHeight || 0, 1);
  const extra = viewportHeight <= 700 ? 18 : 34;
  document.documentElement.style.setProperty('--header-height', `${height}px`);
  document.documentElement.style.setProperty('--header-offset', `${height + extra}px`);
}

function getHeaderOffset() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--header-offset');
  const parsed = parseFloat(raw);
  if (Number.isFinite(parsed)) return parsed;
  updateHeaderOffset();
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-offset')) || 116;
}

function scrollToSection(section) {
  if (!section) return;
  updateHeaderOffset();
  const offset = getHeaderOffset();
  const top = section.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function initHeaderOffsetRuntime() {
  updateHeaderOffset();
  window.addEventListener('resize', updateHeaderOffset, { passive: true });
  window.addEventListener('orientationchange', () => window.setTimeout(updateHeaderOffset, 120), { passive: true });
  document.fonts?.ready?.then(updateHeaderOffset).catch(() => {});
}

const navStateLinks = Array.from(document.querySelectorAll('[data-nav-section]'));

function setActiveNav(sectionName) {
  navStateLinks.forEach((link) => {
    link.classList.toggle('is-active', link.dataset.navSection === sectionName);
  });
}

let navActiveLockUntil = 0;
let navActiveLockSection = null;

function lockActiveNav(sectionName, duration = 360) {
  navActiveLockSection = sectionName;
  navActiveLockUntil = performance.now() + duration;
  setActiveNav(sectionName);
}

function initSmoothNavigation() {
  const scrollTopLinks = Array.from(document.querySelectorAll('[data-scroll-top]'));
  const anchorLinks = Array.from(document.querySelectorAll('a[href^="#"]:not([data-scroll-top])'));

  scrollTopLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      lockActiveNav('intro', 720);
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: reduceMotion ? 'auto' : 'smooth'
      });
      window.setTimeout(() => setActiveNav('intro'), reduceMotion ? 80 : 520);
    });
  });

  anchorLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const targetId = link.getAttribute('href');
      if (!targetId || targetId === '#') return;
      const target = document.querySelector(targetId);
      if (!target) return;

      event.preventDefault();

      if (link.dataset.navSection) {
        lockActiveNav(link.dataset.navSection);
      } else if (targetId === '#trai-nghiem') {
        lockActiveNav('experience');
      } else if (targetId === '#huong-dan') {
        lockActiveNav('guide');
      } else if (targetId === '#top') {
        lockActiveNav('intro');
      }

      scrollToSection(target);

      window.setTimeout(() => {
        if (targetId === '#trai-nghiem' || targetId === '#gioi-thieu-them') setActiveNav('experience');
        if (targetId === '#huong-dan') setActiveNav('guide');
        if (targetId === '#top') setActiveNav('intro');
      }, 420);
    });
  });
}

function initNavActiveState() {
  const sections = Array.from(document.querySelectorAll('[data-intro-section]'));
  if (!sections.length || !navStateLinks.length) return;

  let rafId = 0;

  const readActiveSection = () => {
    const viewportHeight = Math.max(window.innerHeight || 0, 1);
    const focusLine = viewportHeight * 0.42;
    let bestSection = 'intro';
    let bestScore = -Infinity;

    sections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      const visible = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
      const visibleRatio = Math.max(0, visible) / Math.max(rect.height, 1);
      const lineInside = rect.top <= focusLine && rect.bottom >= focusLine ? 1 : 0;
      const distancePenalty = Math.abs(rect.top - focusLine) / viewportHeight;
      const score = (lineInside * 2) + visibleRatio - distancePenalty;

      if (score > bestScore) {
        bestScore = score;
        bestSection = section.dataset.introSection || 'intro';
      }
    });

    return bestSection;
  };

  const update = () => {
    rafId = 0;
    if (navActiveLockSection && performance.now() < navActiveLockUntil) {
      setActiveNav(navActiveLockSection);
      return;
    }
    navActiveLockSection = null;
    setActiveNav(readActiveSection());
  };

  const requestUpdate = () => {
    if (rafId) return;
    rafId = window.requestAnimationFrame(update);
  };

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(() => requestUpdate(), {
      threshold: [0.15, 0.3, 0.45, 0.6, 0.75],
      rootMargin: '-8% 0px -18% 0px'
    });
    sections.forEach((section) => observer.observe(section));
  }

  update();
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('wheel', requestUpdate, { passive: true });
  window.addEventListener('touchmove', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
}

function initHeroMagneticHover() {
  const card = document.querySelector('.hero-video-card');
  if (!card) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  if (reduceMotion || coarsePointer) return;

  const maxTilt = 3;

  const reset = () => {
    card.classList.remove('is-magnetic');
    card.style.setProperty('--tilt-x', '0deg');
    card.style.setProperty('--tilt-y', '0deg');
    card.style.setProperty('--glow-x', '50%');
    card.style.setProperty('--glow-y', '50%');
    card.style.setProperty('--liquid-x', '50%');
    card.style.setProperty('--liquid-y', '50%');
    card.classList.remove('is-liquid-surface');
  };

  card.addEventListener('pointermove', (event) => {
    const rect = card.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    const tiltY = (px - 0.5) * maxTilt;
    const tiltX = (0.5 - py) * maxTilt * 0.62;

    card.classList.add('is-magnetic');
    card.style.setProperty('--tilt-x', `${tiltX.toFixed(2)}deg`);
    card.style.setProperty('--tilt-y', `${tiltY.toFixed(2)}deg`);
    card.style.setProperty('--glow-x', `${(px * 100).toFixed(1)}%`);
    card.style.setProperty('--glow-y', `${(py * 100).toFixed(1)}%`);
    card.style.setProperty('--liquid-x', `${(px * 100).toFixed(1)}%`);
    card.style.setProperty('--liquid-y', `${(py * 100).toFixed(1)}%`);
    card.classList.add('is-liquid-surface');
  }, { passive: true });

  card.addEventListener('pointerleave', reset, { passive: true });
  card.addEventListener('blur', reset, true);
}

function initIntroVideoModal() {
  const modal = document.getElementById('introVideoModal');
  const openers = Array.from(document.querySelectorAll('[data-intro-video-open]'));
  if (!modal || !openers.length) return;

  const dialog = modal.querySelector('.intro-video-dialog');
  const player = modal.querySelector('.intro-video-player');
  const closeButtons = Array.from(modal.querySelectorAll('[data-close-intro-video]'));
  let lastActiveElement = null;

  const openModal = (event) => {
    if (event.defaultPrevented) return;
    if (event.type === 'click') {
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    }

    event.preventDefault();
    lastActiveElement = document.activeElement;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-video-modal-open');

    heroVideo?.pause?.();
    clearModalVideoMessage();

    if (player) {
      player.controls = true;
      player.setAttribute('controls', '');
      player.preload = getSafeVideoPreload(INDEX_VIDEO_CONFIG?.modalPreload, 'metadata');
      setModalVideoMessage(INDEX_VIDEO_CONFIG?.modalLoadingText || 'Đang mở video giới thiệu…');

      try {
        if (player.readyState === 0 || player.error) player.load?.();
        player.currentTime = 0;
      } catch {
        // Some browsers can throw if metadata is not ready yet. Playback still remains safe.
      }

      const modalTimeoutMs = Math.max(2500, Math.min(9000, Number(INDEX_VIDEO_CONFIG?.modalFallbackTimeoutMs) || 6200));
      window.clearTimeout(openModal._modalVideoTimer);
      openModal._modalVideoTimer = window.setTimeout(() => {
        if (hasVideoPlaybackEvidence(player)) return;
        getIndexVideoSupport(player); // diagnostic only; avoid false unsupported on Safari/Chromium variants.
        if (getVideoMediaErrorCode(player)) {
          setModalVideoMessage(getUnsupportedVideoText(), 'error');
        } else {
          setModalVideoMessage(INDEX_VIDEO_CONFIG?.modalPlayFallbackText || 'Video chưa tự phát. Vui lòng bấm nút Play trên khung video.');
        }
      }, modalTimeoutMs);

      const playPromise = player.play?.();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((error) => {
          if (isCodecOrSourceFailure(player, error)) {
            setModalVideoMessage(getUnsupportedVideoText(), 'error');
          } else {
            setModalVideoMessage(INDEX_VIDEO_CONFIG?.modalPlayFallbackText || 'Video chưa tự phát. Vui lòng bấm nút Play trên khung video.');
          }
        });
      } else {
        window.setTimeout(() => {
          if (hasVideoPlaybackEvidence(player)) clearModalVideoMessage();
        }, 400);
      }
    }

    window.setTimeout(() => {
      modal.querySelector('.intro-video-close')?.focus?.({ preventScroll: true });
    }, 40);
  };

  const closeModal = () => {
    if (!modal.classList.contains('is-open')) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-video-modal-open');
    player?.pause?.();

    window.clearTimeout(openModal._modalVideoTimer);
    if (heroVideo && !heroVideo.closest('.is-video-missing') && shouldAutoplayHeroVideo()) {
      heroVideo.play?.().catch(() => {});
    }

    if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
      lastActiveElement.focus({ preventScroll: true });
    }
  };

  openers.forEach((opener) => {
    opener.addEventListener('click', openModal);
  });

  closeButtons.forEach((button) => {
    button.addEventListener('click', closeModal);
  });

  const markModalVideoReady = (event) => {
    markVideoPlaybackEvidence(player, event?.type || 'ready');
    clearModalVideoMessage();
  };
  player?.addEventListener('loadeddata', markModalVideoReady);
  player?.addEventListener('canplay', markModalVideoReady);
  player?.addEventListener('playing', markModalVideoReady);
  player?.addEventListener('timeupdate', () => {
    if (player.currentTime > 0) markVideoPlaybackEvidence(player, 'timeupdate');
  });
  player?.addEventListener('error', () => {
    setModalVideoMessage(getUnsupportedVideoText(), 'error');
    console.warn(`Chưa tìm thấy hoặc không đọc được video index tại ${INDEX_VIDEO_CONFIG.src}`);
  });

  modal.addEventListener('click', (event) => {
    if (event.target?.matches?.('[data-close-intro-video]')) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });

  dialog?.addEventListener('click', (event) => event.stopPropagation());
}

function isGalleryHref(href) {
  if (!href) return false;
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return false;
    return url.pathname.endsWith('/gallery.html') || url.pathname.endsWith('gallery.html');
  } catch {
    return href === './gallery.html' || href === 'gallery.html';
  }
}

function initGalleryWarmup() {
  const galleryLinks = Array.from(document.querySelectorAll('a[href]'))
    .filter((link) => isGalleryHref(link.getAttribute('href')));

  galleryLinks.forEach((link) => {
    link.addEventListener('pointerenter', warmupGallery, { passive: true });
    link.addEventListener('focus', warmupGallery, { passive: true });
    link.addEventListener('touchstart', warmupGallery, { passive: true });
  });
}

function initPortalEnterTransition() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const transitionDelay = reduceMotion ? 80 : 1120;
  let isNavigatingToGallery = false;

  const galleryLinks = Array.from(document.querySelectorAll('a[href]'))
    .filter((link) => isGalleryHref(link.getAttribute('href')));

  galleryLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented) return;
      if (typeof event.button === 'number' && event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (link.target && link.target !== '_self') return;

      const destination = link.href;
      if (!destination) return;

      event.preventDefault();
      if (isNavigatingToGallery || document.body.classList.contains('is-entering-gallery')) return;

      isNavigatingToGallery = true;
      warmupGallery({ immediate: true });
      link.classList.add('is-click-pulsing');
      link.closest('.route-card, .hero-video-card, .nav-cta')?.classList.add('is-click-pulsing');
      document.body.classList.add('is-entering-gallery');

      window.setTimeout(() => {
        window.location.href = destination;
      }, transitionDelay);
    });
  });
}

initViewportMetrics();
initHeaderOffsetRuntime();
initHeaderScrollState();
initStagePresence();
initSmoothNavigation();
initNavActiveState();
initHeroMagneticHover();
initIntroVideoModal();
initGalleryWarmup();
initPortalEnterTransition();
initCmsIndexHydration();
initLiquidCursor();