// v6.14.010 — Continuous Geometry + Mobile Runtime Debug.
// Controlled requestAnimationFrame; DOM/CSS 3D only. No canvas, WebGL or external library.

const MAX_SOURCE_ITEMS = 12;
const MAX_VISUAL_ITEMS = 8;
const MAX_DESKTOP_IMAGE_NODES = 8;
const MAX_TABLET_IMAGE_NODES = 5;
const MAX_MOBILE_IMAGE_NODES = 3;
const DEFAULT_AUTOPLAY_MS = 3000;
const MIN_VISUAL_AUTOPLAY_MS = 2600;
const MAX_VISUAL_AUTOPLAY_MS = 4200;
const ORBIT_TRANSITION_MS = 0;
const USER_PAUSE_MS = 12000;
const KEYBOARD_FOCUS_GRACE_MS = 1600;
const MANUAL_SNAP_MS = 320;
const RESIZE_DEBOUNCE_MS = 90;
const MOBILE_FRAME_INTERVAL_MS = 1000 / 30;
const MAX_FRAME_DELTA_MS = 80;
const DEBUG_PANEL_UPDATE_INTERVAL_MS = 1000;
const ACTIVE_CROSSING_HYSTERESIS_STEPS = 0.06;
const IMAGE_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']);
const ASPECT_CLASSES = Object.freeze(['is-wide', 'is-landscape', 'is-square', 'is-portrait']);
const POSITION_CLASSES = Object.freeze(['is-near', 'is-far', 'is-back']);
const controllers = new WeakMap();

function getText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampAutoplay(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AUTOPLAY_MS;
  return Math.min(MAX_VISUAL_AUTOPLAY_MS, Math.max(MIN_VISUAL_AUTOPLAY_MS, Math.round(parsed)));
}

function isLocalImageUrl(value) {
  const url = getText(value);
  if (!url || /[\u0000-\u001F\u007F]/.test(url)) return false;
  if (/^(?:javascript|data|vbscript|file|blob):/i.test(url)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
  const cleanPath = url.split(/[?#]/, 1)[0].toLowerCase();
  const extension = cleanPath.includes('.') ? cleanPath.split('.').pop() : '';
  return IMAGE_EXTENSIONS.includes(extension);
}

function isDebugEnabled(options = {}) {
  if (options.debug === true) return true;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('debugFeatured') === '1';
  } catch {
    return false;
  }
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - (2 * t));
}

function normalizeItems(featuredData, options = {}) {
  if (!Array.isArray(featuredData?.items)) return [];
  const isSafeImageUrl = typeof options.isSafeImageUrl === 'function'
    ? options.isSafeImageUrl
    : isLocalImageUrl;
  const seenIds = new Set();

  return featuredData.items
    .slice(0, MAX_SOURCE_ITEMS)
    .filter((item) => item && typeof item === 'object' && item.visible !== false)
    .map((item, index) => {
      const title = getText(item.title);
      const imageUrl = getText(item.imageUrl);
      const id = getText(item.id, `featured_${index + 1}`);
      if (!title || !imageUrl || !id || seenIds.has(id) || !isSafeImageUrl(imageUrl)) return null;
      seenIds.add(id);
      const room = getText(item.room).toLowerCase();
      return {
        id,
        title,
        imageUrl,
        alt: getText(item.alt, title),
        room: ['indoor', 'outdoor'].includes(room) ? room : '',
        ctaLabel: getText(item.ctaLabel, 'Xem trong không gian 3D'),
        ratio: 4 / 3,
        ratioClass: 'is-landscape'
      };
    })
    .filter(Boolean)
    .slice(0, MAX_VISUAL_ITEMS);
}

function modulo(value, length) {
  if (!length) return 0;
  return ((value % length) + length) % length;
}

function normalizeAngle(value) {
  return modulo(value + 180, 360) - 180;
}

function getShortestStepDelta(currentIndex, targetIndex, count, preferredDirection = 1) {
  if (count <= 1) return 0;
  const forward = modulo(targetIndex - currentIndex, count);
  if (forward === 0) return 0;
  const backward = forward - count;
  if (Math.abs(forward) === Math.abs(backward)) return preferredDirection < 0 ? backward : forward;
  return Math.abs(forward) < Math.abs(backward) ? forward : backward;
}

function classifyImageRatio(width, height) {
  const ratio = Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : 4 / 3;
  if (ratio >= 1.65) return { ratio, ratioClass: 'is-wide' };
  if (ratio > 1.12) return { ratio, ratioClass: 'is-landscape' };
  if (ratio >= 0.88) return { ratio, ratioClass: 'is-square' };
  return { ratio, ratioClass: 'is-portrait' };
}

function safeClosest(node, selector) {
  return node && typeof node.closest === 'function' ? node.closest(selector) : null;
}

class FeaturedArtworksController {
  constructor(section, options = {}) {
    this.section = section;
    this.options = options;
    this.items = [];
    this.visibleItems = this.items;
    this.activeIndex = 0;
    this.previousActiveIndex = 0;
    this.activePhaseStep = 0;
    this.phaseSteps = 0;
    this.lastDirection = 1;
    this.failedIds = new Set();
    this.cardById = new Map();
    this.renderedEntries = [];
    this.lastRenderedIds = [];

    this.rafId = 0;
    this.lastFrameTime = 0;
    this.isOrbitRunning = false;
    this.resumeTimerId = 0;
    this.visibilityCheckTimerId = 0;
    this.resizeTimerId = 0;
    this.manualSnapTimerId = 0;
    this.debugTimerId = 0;
    this.userPauseUntil = 0;
    this.keyboardPauseUntil = 0;

    this.isInViewport = false;
    this.isDocumentVisible = !document.hidden;
    this.isVideoModalOpen = this.isModalOpen();
    this.isKeyboardInteracting = false;
    this.isPointerFineHovering = false;
    this.isReducedMotion = false;
    this.frameSkipMobile = false;
    this.layoutMode = 'hidden';
    this.mediaReady = false;
    this.destroyed = false;
    this.lastPauseReason = '';
    this.lastInputModality = 'pointer';
    this.lastDebugUpdateAt = 0;
    this.lastFrameDelta = 0;
    this.paintCount = 0;
    this.sectionRatio = 0;
    this.visibilitySource = 'init';
    this.debugPanel = null;
    this.debugOutput = null;

    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    this.mobileLayout = window.matchMedia?.('(max-width: 700px)') || null;
    this.tabletLayout = window.matchMedia?.('(max-width: 1024px)') || null;
    this.fineHover = window.matchMedia?.('(hover: hover) and (pointer: fine)') || null;
    this.isReducedMotion = Boolean(this.reducedMotion?.matches);
    this.frameSkipMobile = Boolean(this.mobileLayout?.matches);
    this.debug = isDebugEnabled(options);
    this.onAnimationFrame = this.onAnimationFrame.bind(this);

    this.nodes = {
      carousel: section.querySelector('[data-featured-carousel]'),
      kicker: section.querySelector('[data-featured-kicker]'),
      title: section.querySelector('[data-featured-title]'),
      exhibitionTitle: section.querySelector('[data-featured-exhibition-title]'),
      slides: section.querySelector('[data-featured-slides]'),
      counter: section.querySelector('[data-featured-counter]'),
      itemTitle: section.querySelector('[data-featured-item-title]'),
      cta: section.querySelector('[data-featured-cta]'),
      prev: section.querySelector('[data-featured-prev]'),
      next: section.querySelector('[data-featured-next]'),
      controls: section.querySelector('[data-featured-controls]'),
      rail: section.querySelector('[data-featured-rail]'),
      status: section.querySelector('[data-featured-status]')
    };

    this.configureDebugPanel();
    this.bindEvents();
    section.dataset.featuredInitialized = '1';
  }

  log(message, detail = undefined) {
    if (!this.debug) return;
    if (detail === undefined) console.debug(`[FeaturedArtworks] ${message}`);
    else console.debug(`[FeaturedArtworks] ${message}`, detail);
  }

  configureDebugPanel() {
    if (!this.debug) {
      window.clearTimeout(this.debugTimerId);
      this.debugTimerId = 0;
      this.debugPanel?.remove();
      this.debugPanel = null;
      this.debugOutput = null;
      return;
    }

    if (!this.debugPanel) {
      const panel = document.createElement('aside');
      panel.className = 'featured-runtime-debug';
      panel.dataset.featuredDebugPanel = '';
      panel.setAttribute('aria-hidden', 'true');

      const heading = document.createElement('strong');
      heading.textContent = 'Featured Orbit Runtime';
      const output = document.createElement('pre');
      output.dataset.featuredDebugOutput = '';
      panel.append(heading, output);
      document.body?.appendChild(panel);
      this.debugPanel = panel;
      this.debugOutput = output;
    }

    this.scheduleDebugTick();
    this.updateDebugPanel(true);
  }

  scheduleDebugTick() {
    if (!this.debug || this.debugTimerId) return;
    this.debugTimerId = window.setTimeout(() => {
      this.debugTimerId = 0;
      this.updateDebugPanel(true);
      this.scheduleDebugTick();
    }, DEBUG_PANEL_UPDATE_INTERVAL_MS);
  }

  updateDebugPanel(force = false) {
    if (!this.debug || !this.debugOutput) return;
    const now = Date.now();
    if (!force && now - this.lastDebugUpdateAt < DEBUG_PANEL_UPDATE_INTERVAL_MS) return;
    this.lastDebugUpdateAt = now;

    const pauseReason = this.getPauseReason() || 'none';
    const manualRemaining = Math.max(0, this.userPauseUntil - now);
    const keyboardRemaining = Math.max(0, this.keyboardPauseUntil - now);
    const lines = [
      `raf: ${this.isOrbitRunning ? 'running' : 'stopped'}`,
      `pauseReason: ${pauseReason}`,
      `phaseSteps: ${Number(this.phaseSteps || 0).toFixed(4)}`,
      `activeIndex: ${this.activeIndex}`,
      `itemCount: ${this.items.length}`,
      `renderedCount: ${this.renderedEntries.length}`,
      `isInViewport: ${this.isInViewport}`,
      `sectionRatio: ${this.sectionRatio >= 0 ? this.sectionRatio.toFixed(3) : 'fallback'}`,
      `visibilitySource: ${this.visibilitySource}`,
      `documentVisible: ${this.isDocumentVisible && !document.hidden}`,
      `reducedMotion: ${this.isReducedMotion}`,
      `modalOpen: ${this.isVideoModalOpen || this.isModalOpen()}`,
      `pointerHover: ${this.isPointerFineHovering}`,
      `manualPauseRemaining: ${Math.ceil(manualRemaining / 1000)}s`,
      `keyboardPauseRemaining: ${Math.ceil(keyboardRemaining / 1000)}s`,
      `fpsMode: ${this.frameSkipMobile ? 30 : 60}`,
      `layoutMode: ${this.layoutMode}`,
      `lastInputModality: ${this.lastInputModality}`,
      `fineHover: ${Boolean(this.fineHover?.matches)}`,
      `lastFrameDelta: ${Number(this.lastFrameDelta || 0).toFixed(2)}ms`,
      `paintCount: ${this.paintCount}`
    ];
    this.debugOutput.textContent = lines.join('\n');
    this.section.dataset.featuredPhase = this.phaseSteps.toFixed(4);
    this.section.dataset.featuredSemanticStep = String(this.activePhaseStep);
    this.section.dataset.featuredDebugRaf = this.isOrbitRunning ? 'running' : 'stopped';
    this.section.dataset.featuredDebugPauseReason = pauseReason;
  }

  bindEvents() {
    const { carousel, prev, next } = this.nodes;

    prev?.addEventListener('click', () => this.move(-1, 'user'));
    next?.addEventListener('click', () => this.move(1, 'user'));

    carousel?.addEventListener('keydown', (event) => {
      this.lastInputModality = 'keyboard';
      this.isKeyboardInteracting = true;
      if (!this.items.length) return;
      let targetIndex = null;
      if (event.key === 'ArrowLeft') targetIndex = modulo(this.activeIndex - 1, this.items.length);
      if (event.key === 'ArrowRight') targetIndex = modulo(this.activeIndex + 1, this.items.length);
      if (event.key === 'Home') targetIndex = 0;
      if (event.key === 'End') targetIndex = this.items.length - 1;
      if (targetIndex === null || targetIndex === this.activeIndex) return;
      event.preventDefault();
      this.goTo(targetIndex, 'user');
    });

    carousel?.addEventListener('keyup', () => {
      this.isKeyboardInteracting = false;
      this.syncEngineState('keyboard-keyup');
    });

    this.section.addEventListener('focusin', () => {
      if (this.lastInputModality !== 'keyboard') return;
      this.keyboardPauseUntil = Date.now() + KEYBOARD_FOCUS_GRACE_MS;
      this.scheduleResumeCheck('keyboard-focus');
      this.syncEngineState('keyboard-focus');
    });

    this.section.addEventListener('pointerdown', (event) => {
      this.lastInputModality = 'pointer';
      if (event.pointerType === 'touch') {
        this.isPointerFineHovering = false;
        this.syncEngineState('touch-pointerdown');
      }
    }, { passive: true });

    this.section.addEventListener('pointerover', (event) => {
      if (!this.fineHover?.matches || !['mouse', 'pen'].includes(event.pointerType)) return;
      const pauseTarget = safeClosest(event.target, '[data-featured-interactive], .infinity-gate-card.is-active');
      if (!pauseTarget || !this.section.contains(pauseTarget)) return;
      this.isPointerFineHovering = true;
      this.syncEngineState('fine-hover-enter');
    }, { passive: true });

    this.section.addEventListener('pointerout', (event) => {
      if (!this.fineHover?.matches || !['mouse', 'pen'].includes(event.pointerType)) return;
      const fromTarget = safeClosest(event.target, '[data-featured-interactive], .infinity-gate-card.is-active');
      if (!fromTarget) return;
      const toTarget = safeClosest(event.relatedTarget, '[data-featured-interactive], .infinity-gate-card.is-active');
      if (toTarget && this.section.contains(toTarget)) return;
      this.isPointerFineHovering = false;
      this.syncEngineState('fine-hover-leave');
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      this.isDocumentVisible = document.visibilityState === 'visible' && !document.hidden;
      this.syncEngineState('visibilitychange');
    }, { passive: true });

    window.addEventListener('pagehide', () => {
      this.isDocumentVisible = false;
      this.syncEngineState('pagehide');
    }, { passive: true });

    window.addEventListener('pageshow', () => {
      this.isDocumentVisible = !document.hidden;
      this.lastFrameTime = 0;
      this.syncEngineState('pageshow');
    }, { passive: true });

    if ('IntersectionObserver' in window) {
      this.viewportObserver = new IntersectionObserver((entries) => {
        const entry = entries[0];
        this.sectionRatio = Number(entry?.intersectionRatio) || 0;
        this.visibilitySource = 'intersection-observer';
        const nextVisible = Boolean(entry?.isIntersecting && this.sectionRatio >= 0.10);
        if (nextVisible !== this.isInViewport) {
          this.isInViewport = nextVisible;
          if (nextVisible) {
            this.mediaReady = true;
            this.reconcileCards('viewport-enter');
            this.paintOrbitFrame();
          }
        }
        this.syncEngineState(nextVisible ? 'viewport-enter' : 'viewport-exit');
        this.updateDebugPanel(true);
      }, { threshold: [0, 0.10, 0.25, 0.55], rootMargin: '14% 0px 14% 0px' });
      this.viewportObserver.observe(this.section);
    } else {
      this.isInViewport = true;
      this.mediaReady = true;
      this.sectionRatio = 1;
      this.visibilitySource = 'no-intersection-observer';
    }

    const handleMotionChange = () => {
      this.isReducedMotion = Boolean(this.reducedMotion?.matches);
      if (this.isReducedMotion) this.phaseSteps = Math.round(this.phaseSteps);
      this.refreshLayout('motion-change');
    };
    if (this.reducedMotion?.addEventListener) this.reducedMotion.addEventListener('change', handleMotionChange);
    else this.reducedMotion?.addListener?.(handleMotionChange);

    const handleCapabilityChange = () => {
      if (!this.fineHover?.matches) this.isPointerFineHovering = false;
      this.syncEngineState('pointer-capability-change');
    };
    if (this.fineHover?.addEventListener) this.fineHover.addEventListener('change', handleCapabilityChange);
    else this.fineHover?.addListener?.(handleCapabilityChange);

    const handleLayoutChange = () => this.refreshLayout('media-query-change');
    [this.mobileLayout, this.tabletLayout].forEach((query) => {
      if (query?.addEventListener) query.addEventListener('change', handleLayoutChange);
      else query?.addListener?.(handleLayoutChange);
    });

    const handleViewportChange = () => {
      window.clearTimeout(this.resizeTimerId);
      this.resizeTimerId = window.setTimeout(() => {
        this.resizeTimerId = 0;
        this.refreshLayout('viewport-resize');
      }, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', handleViewportChange, { passive: true });
    window.addEventListener('orientationchange', handleViewportChange, { passive: true });

    if ('MutationObserver' in window && document.body) {
      this.modalObserver = new MutationObserver(() => {
        this.isVideoModalOpen = this.isModalOpen();
        this.syncEngineState('modal-state');
      });
      this.modalObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }

  update(featuredData, options = {}) {
    this.options = { ...this.options, ...options };
    this.debug = isDebugEnabled(this.options);
    this.configureDebugPanel();
    this.stopOrbitEngine('update');
    this.clearAuxiliaryTimers();
    this.failedIds.clear();
    this.userPauseUntil = 0;
    this.keyboardPauseUntil = 0;
    this.isKeyboardInteracting = false;
    this.isPointerFineHovering = false;
    this.mediaReady = this.isInViewport || !('IntersectionObserver' in window);
    this.resetCards();

    const enabled = featuredData?.enabled === true;
    const sourceCount = Array.isArray(featuredData?.items) ? featuredData.items.length : 0;
    this.items = enabled ? normalizeItems(featuredData, this.options) : [];
    this.visibleItems = this.items;
    this.activeIndex = 0;
    this.previousActiveIndex = 0;
    this.activePhaseStep = 0;
    this.phaseSteps = 0;
    this.lastDirection = 1;
    this.paintCount = 0;
    this.lastFrameDelta = 0;

    if (!enabled) {
      this.hide('disabled');
      return this.getState('disabled');
    }

    if (!this.items.length) {
      this.hide('no-valid-items');
      return this.getState('no-valid-items');
    }

    this.section.hidden = false;
    this.section.dataset.featuredState = 'ready';
    this.section.dataset.featuredCount = String(this.items.length);
    this.section.dataset.featuredCapped = sourceCount > this.items.length ? '1' : '0';
    this.nodes.carousel?.setAttribute('aria-label', `Tác phẩm tiêu biểu — ${this.items.length} tác phẩm`);

    this.setText(this.nodes.kicker, featuredData.kicker, 'Tuyển chọn từ không gian trưng bày');
    this.setText(this.nodes.title, featuredData.title, 'Tác phẩm tiêu biểu');
    this.setText(
      this.nodes.exhibitionTitle,
      featuredData.exhibitionTitle,
      getText(featuredData.title, 'Tác phẩm tiêu biểu')
    );

    this.autoplayMs = clampAutoplay(featuredData.autoplayMs);
    this.itemPeriodMs = this.autoplayMs;
    this.buildDots();
    this.updateControlVisibility();
    this.layoutMode = this.getLayoutMode();
    this.frameSkipMobile = Boolean(this.mobileLayout?.matches);
    this.reconcileCards('init');
    this.syncActivePresentation('init', false);
    this.paintOrbitFrame();
    this.queueVisibilityCheck();
    this.syncEngineState('init');
    this.log('initialized', {
      sourceCount,
      itemCount: this.items.length,
      capped: sourceCount > this.items.length,
      layoutMode: this.layoutMode,
      visualCount: this.getNodeBudget(),
      itemPeriodMs: this.itemPeriodMs,
      fpsMode: this.frameSkipMobile ? 30 : 60
    });
    return this.getState('ready');
  }

  getState(reason = '') {
    return {
      visible: !this.section.hidden && this.items.length > 0,
      itemCount: this.items.length,
      autoplay: this.shouldOrbitRun(),
      orbitRunning: this.isOrbitRunning,
      phaseSteps: this.phaseSteps,
      layoutMode: this.getLayoutMode(),
      reason
    };
  }

  setText(node, value, fallback = '') {
    if (!node) return;
    node.textContent = getText(value, fallback);
  }

  hide(reason) {
    this.stopOrbitEngine(reason);
    this.clearAuxiliaryTimers();
    this.resetCards();
    this.section.hidden = true;
    this.section.dataset.featuredState = reason;
    this.section.dataset.featuredCount = '0';
    this.section.dataset.featuredLayout = 'hidden';
    this.nodes.rail?.replaceChildren();
    this.log(`hidden: ${reason}`);
    this.updateDebugPanel(true);
  }

  resetCards() {
    this.cardById.clear();
    this.renderedEntries = [];
    this.lastRenderedIds = [];
    this.nodes.slides?.replaceChildren();
  }

  queueVisibilityCheck() {
    window.clearTimeout(this.visibilityCheckTimerId);
    this.visibilityCheckTimerId = window.setTimeout(() => {
      this.visibilityCheckTimerId = 0;
      if (this.section.hidden || this.isInViewport || typeof this.section.getBoundingClientRect !== 'function') return;
      const rect = this.section.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
      if (rect.bottom >= -100 && rect.top <= viewportHeight + 100) {
        this.visibilitySource = 'visibility-fallback';
        this.sectionRatio = -1;
        this.isInViewport = true;
        this.mediaReady = true;
        this.reconcileCards('visibility-fallback');
        this.paintOrbitFrame();
        this.syncEngineState('visibility-fallback');
      }
    }, 0);
  }

  buildDots() {
    const rail = this.nodes.rail;
    if (!rail) return;
    rail.replaceChildren();

    this.items.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'infinity-gate-dot';
      button.dataset.featuredIndex = String(index);
      button.dataset.featuredInteractive = '';
      button.setAttribute('aria-label', `Xem tác phẩm ${String(index + 1).padStart(2, '0')}: ${item.title}`);
      const visual = document.createElement('span');
      visual.setAttribute('aria-hidden', 'true');
      button.appendChild(visual);
      button.addEventListener('click', () => this.goTo(index, 'user'));
      rail.appendChild(button);
    });
  }

  updateControlVisibility() {
    const hasMultiple = this.items.length > 1;
    if (this.nodes.controls) this.nodes.controls.hidden = !hasMultiple;
    if (this.nodes.rail) this.nodes.rail.hidden = !hasMultiple;
  }

  getLayoutMode() {
    const count = this.items.length;
    if (!count) return 'hidden';
    if (this.isReducedMotion) return 'reduced-motion';
    if (count === 1) return 'static-single';
    if (count === 2) return 'shuttle-two';
    if (this.mobileLayout?.matches) return 'mobile-compact';
    if (count <= 5) return 'compact-orbit';
    return 'full-orbit';
  }

  getNodeBudget() {
    if (this.items.length <= 1 || this.isReducedMotion) return 1;
    if (this.mobileLayout?.matches) return Math.min(MAX_MOBILE_IMAGE_NODES, this.items.length);
    if (this.tabletLayout?.matches) return Math.min(MAX_TABLET_IMAGE_NODES, this.items.length);
    return Math.min(MAX_DESKTOP_IMAGE_NODES, this.items.length);
  }

  getRenderedIndices(activeIndex = this.activeIndex) {
    const count = this.items.length;
    const budget = this.getNodeBudget();
    if (budget >= count) return Array.from({ length: count }, (_, index) => index);

    const result = [activeIndex];
    for (let distance = 1; result.length < budget; distance += 1) {
      const previous = modulo(activeIndex - distance, count);
      if (!result.includes(previous)) result.push(previous);
      if (result.length >= budget) break;
      const next = modulo(activeIndex + distance, count);
      if (!result.includes(next)) result.push(next);
    }
    return result;
  }

  refreshLayout(source) {
    this.lastFrameTime = 0;
    this.isReducedMotion = Boolean(this.reducedMotion?.matches);
    this.frameSkipMobile = Boolean(this.mobileLayout?.matches);
    this.layoutMode = this.getLayoutMode();
    this.reconcileCards(source);
    this.syncActivePresentation(source, false);
    this.paintOrbitFrame();
    this.queueVisibilityCheck();
    this.syncEngineState(source);
  }

  move(direction, source = 'user') {
    if (this.items.length < 2) return;
    const normalizedDirection = direction < 0 ? -1 : 1;
    const basePhase = this.activePhaseStep;
    const targetPhase = basePhase + normalizedDirection;
    this.lastDirection = normalizedDirection;
    this.applyManualPhase(targetPhase, source);
  }

  goTo(index, source = 'user') {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) return;
    const basePhase = this.activePhaseStep;
    const currentIndex = this.activeIndex;
    if (index === currentIndex) {
      if (source === 'user') {
        this.userPauseUntil = Date.now() + USER_PAUSE_MS;
        this.announceManualSelection();
        this.scheduleResumeCheck('same-item-user');
        this.syncEngineState('same-item-user');
      }
      return;
    }

    const delta = getShortestStepDelta(currentIndex, index, this.items.length, this.lastDirection);
    this.lastDirection = delta < 0 ? -1 : 1;
    this.applyManualPhase(basePhase + delta, source);
  }

  applyManualPhase(targetPhase, source = 'user') {
    this.stopOrbitEngine('manual-action');
    this.phaseSteps = targetPhase;
    this.activePhaseStep = Math.round(targetPhase);
    this.activeIndex = modulo(this.activePhaseStep, this.items.length);
    this.userPauseUntil = source === 'user' ? Date.now() + USER_PAUSE_MS : this.userPauseUntil;
    this.startManualSnapClass();
    const nextRenderedIndices = this.getRenderedIndices(this.activeIndex);
    if (this.hasRenderedSetChanged(nextRenderedIndices)) {
      this.reconcileCards(source, nextRenderedIndices);
    }
    this.syncActivePresentation(source, source === 'user');
    this.paintOrbitFrame();
    this.scheduleResumeCheck(source);
    this.syncEngineState(source);
  }

  startManualSnapClass() {
    window.clearTimeout(this.manualSnapTimerId);
    this.section.classList.add('is-manual-snap');
    this.manualSnapTimerId = window.setTimeout(() => {
      this.manualSnapTimerId = 0;
      this.section.classList.remove('is-manual-snap');
    }, MANUAL_SNAP_MS + 40);
  }

  updateCta(item) {
    const cta = this.nodes.cta;
    if (!cta) return;
    if (!item?.room) {
      cta.hidden = true;
      cta.removeAttribute('href');
      cta.removeAttribute('data-featured-interactive');
      return;
    }
    cta.hidden = false;
    cta.dataset.featuredInteractive = '';
    cta.href = `./gallery.html?room=${encodeURIComponent(item.room)}`;
    cta.textContent = item.ctaLabel;
  }

  updateDots() {
    this.nodes.rail?.querySelectorAll('[data-featured-index]').forEach((button, buttonIndex) => {
      const isActive = buttonIndex === this.activeIndex;
      button.classList.toggle('is-active', isActive);
      if (isActive) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  }

  createCard(item) {
    const card = document.createElement('figure');
    card.className = 'infinity-gate-card is-landscape';
    card.dataset.featuredItemId = item.id;

    const matte = document.createElement('span');
    matte.className = 'infinity-gate-media-matte';
    matte.setAttribute('aria-hidden', 'true');

    const image = document.createElement('img');
    image.className = 'infinity-gate-image';
    image.width = 1200;
    image.height = 900;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.draggable = false;

    const glass = document.createElement('span');
    glass.className = 'infinity-gate-card-glass';
    glass.setAttribute('aria-hidden', 'true');

    card.append(matte, image, glass);
    this.cardById.set(item.id, card);
    return card;
  }

  applyAspectRatio(card, item, width, height) {
    const { ratio, ratioClass } = classifyImageRatio(width, height);
    item.ratio = ratio;
    item.ratioClass = ratioClass;
    ASPECT_CLASSES.forEach((name) => card.classList.remove(name));
    card.classList.add(ratioClass);
    const visualRatio = clamp(ratio, 0.70, 1.82);
    card.style?.setProperty?.('--media-ratio', visualRatio.toFixed(4));
    card.dataset.mediaRatio = ratio.toFixed(4);
    card.dataset.mediaRatioClass = ratioClass;
    this.log('image ratio', { id: item.id, ratio, ratioClass });
  }

  ensureImage(card, item) {
    const image = card.querySelector('img');
    if (!image) return;

    image.dataset.itemId = item.id;
    image.onerror = () => {
      if (image.dataset.itemId !== item.id) return;
      this.handleImageFailure(item.id);
    };
    image.onload = () => {
      if (image.dataset.itemId !== item.id) return;
      this.applyAspectRatio(card, item, image.naturalWidth, image.naturalHeight);
      card.classList.add('is-loaded');
      card.classList.remove('has-media-error');
    };

    if (this.mediaReady && image.getAttribute('src') !== item.imageUrl) {
      card.classList.remove('is-loaded');
      image.setAttribute('src', item.imageUrl);
    } else if (this.mediaReady && image.complete && image.naturalWidth > 0) {
      this.applyAspectRatio(card, item, image.naturalWidth, image.naturalHeight);
      card.classList.add('is-loaded');
    } else if (item.ratioClass) {
      this.applyAspectRatio(card, item, item.ratio * 1000, 1000);
    }
  }

  getRenderedIds(renderedIndices) {
    return renderedIndices.map((index) => this.items[index]?.id).filter(Boolean);
  }

  hasRenderedSetChanged(renderedIndices) {
    const nextIds = this.getRenderedIds(renderedIndices);
    if (nextIds.length !== this.lastRenderedIds.length) return true;
    const currentIds = new Set(this.lastRenderedIds);
    return nextIds.some((id) => !currentIds.has(id));
  }

  reconcileCards(source = 'reconcile', renderedIndices = this.getRenderedIndices()) {
    const slides = this.nodes.slides;
    if (!slides || !this.items.length || this.section.hidden) return false;

    this.layoutMode = this.getLayoutMode();
    const renderedIdsList = this.getRenderedIds(renderedIndices);
    const renderedIds = new Set(renderedIdsList);
    const setChanged = this.hasRenderedSetChanged(renderedIndices);

    if (!setChanged) {
      for (const entry of this.renderedEntries) this.ensureImage(entry.card, entry.item);
      this.section.dataset.featuredLayout = this.layoutMode;
      this.section.dataset.featuredVisualCount = String(this.renderedEntries.length);
      slides.dataset.featuredVisibleSlots = String(this.renderedEntries.length);
      slides.dataset.featuredLayout = this.layoutMode;
      return false;
    }

    for (const [itemId, card] of this.cardById.entries()) {
      if (renderedIds.has(itemId)) continue;
      card.remove();
      this.cardById.delete(itemId);
    }

    this.renderedEntries = renderedIndices.map((itemIndex) => {
      const item = this.items[itemIndex];
      if (!item) return null;
      const card = this.cardById.get(item.id) || this.createCard(item);
      card.dataset.featuredItemIndex = String(itemIndex);
      this.ensureImage(card, item);
      if (!card.isConnected) slides.appendChild(card);
      return { itemIndex, item, card };
    }).filter(Boolean);
    this.lastRenderedIds = renderedIdsList;

    this.section.dataset.featuredLayout = this.layoutMode;
    this.section.dataset.featuredVisualCount = String(this.renderedEntries.length);
    slides.dataset.featuredVisibleSlots = String(this.renderedEntries.length);
    slides.dataset.featuredLayout = this.layoutMode;
    this.log('orbit reconcile', {
      source,
      layoutMode: this.layoutMode,
      renderedIndices,
      activeIndex: this.activeIndex,
      phaseSteps: Number(this.phaseSteps.toFixed(4))
    });
    return true;
  }

  getOrbitGeometry(itemIndex) {
    const count = this.items.length;
    if (count <= 1 || this.layoutMode === 'reduced-motion') {
      return { rawAngle: 0, normalizedAngle: 0 };
    }
    const stepAngle = 360 / count;
    const rawAngle = (itemIndex - this.phaseSteps) * stepAngle;
    return { rawAngle, normalizedAngle: normalizeAngle(rawAngle) };
  }

  paintCardGeometry(entry) {
    const { card, itemIndex } = entry;
    const { rawAngle, normalizedAngle } = this.getOrbitGeometry(itemIndex);
    const radians = normalizedAngle * (Math.PI / 180);
    const depth = Math.cos(radians);
    const side = Math.sin(radians);
    const frontness = clamp((depth + 1) / 2, 0, 1);
    const prominence = smoothstep01(frontness);
    const absAngle = Math.abs(normalizedAngle);
    const sparseOrbit = this.items.length <= 3;
    const mobileOrbit = this.layoutMode === 'mobile-compact';

    const minOpacity = sparseOrbit ? 0.54 : mobileOrbit ? 0.46 : 0.20;
    const minScale = sparseOrbit ? 0.72 : mobileOrbit ? 0.64 : 0.55;
    const opacity = lerp(minOpacity, 1, prominence);
    const scale = lerp(minScale, 1, prominence);
    const y = lerp(22, -4, prominence) + (Math.abs(side) * 4);
    const yaw = side * -18 * (1 - (prominence * 0.58));
    const layer = 100 + Math.round(prominence * 900);

    card.style.setProperty('--orbit-angle', `${rawAngle.toFixed(3)}deg`);
    card.style.setProperty('--orbit-counter-angle', `${(-rawAngle).toFixed(3)}deg`);
    card.style.setProperty('--orbit-y', `${y.toFixed(2)}px`);
    card.style.setProperty('--orbit-scale', scale.toFixed(4));
    card.style.setProperty('--orbit-opacity', opacity.toFixed(4));
    card.style.setProperty('--orbit-yaw', `${yaw.toFixed(3)}deg`);
    card.style.setProperty('--orbit-layer', String(layer));
    card.style.setProperty('--orbit-frontness', frontness.toFixed(4));
    card.style.setProperty('--orbit-prominence', prominence.toFixed(4));
    card.style.setProperty('--orbit-frame-opacity', lerp(0.28, 1, prominence).toFixed(4));
    card.style.setProperty('--orbit-glass-opacity', lerp(0.44, 0.78, frontness).toFixed(4));
    card.style.zIndex = String(layer);

    const position = absAngle <= 24 ? 'active' : absAngle <= 78 ? 'near' : absAngle <= 138 ? 'far' : 'back';
    if (card.dataset.orbitPosition !== position) {
      POSITION_CLASSES.forEach((name) => card.classList.remove(name));
      if (position !== 'active') card.classList.add(`is-${position}`);
      card.dataset.orbitPosition = position;
    }

    if (this.debug) {
      card.dataset.orbitAngle = normalizedAngle.toFixed(2);
      card.dataset.orbitFrontness = frontness.toFixed(3);
    }
  }

  paintOrbitFrame() {
    for (const entry of this.renderedEntries) this.paintCardGeometry(entry);
    this.paintCount += 1;
  }

  getSemanticFrontStep() {
    let nextStep = Number.isFinite(this.activePhaseStep)
      ? this.activePhaseStep
      : Math.round(this.phaseSteps);
    const threshold = 0.5 + ACTIVE_CROSSING_HYSTERESIS_STEPS;

    while ((this.phaseSteps - nextStep) >= threshold) nextStep += 1;
    while ((this.phaseSteps - nextStep) <= -threshold) nextStep -= 1;
    return nextStep;
  }

  syncActiveFromPhase(source = 'orbit') {
    const nextPhaseStep = this.getSemanticFrontStep();
    if (nextPhaseStep === this.activePhaseStep) return false;

    const nextIndex = modulo(nextPhaseStep, this.items.length);
    this.previousActiveIndex = this.activeIndex;
    this.activePhaseStep = nextPhaseStep;
    this.activeIndex = nextIndex;

    const nextRenderedIndices = this.getRenderedIndices(nextIndex);
    if (this.hasRenderedSetChanged(nextRenderedIndices)) {
      this.reconcileCards(source, nextRenderedIndices);
    }
    this.syncActivePresentation(source, false);
    return true;
  }

  syncActivePresentation(source = 'render', announce = false) {
    if (!this.items.length) return;
    const item = this.items[this.activeIndex];
    if (!item) return;
    const numberText = String(this.activeIndex + 1).padStart(2, '0');
    const countText = String(this.items.length).padStart(2, '0');

    this.setText(this.nodes.counter, `${numberText} / ${countText}`);
    this.setText(this.nodes.itemTitle, item.title);
    this.updateCta(item);
    this.updateDots();
    this.section.dataset.featuredActive = item.id;
    this.section.dataset.featuredPhase = this.phaseSteps.toFixed(4);
    this.section.dataset.featuredSemanticStep = String(this.activePhaseStep);
    this.section.dataset.featuredItemPeriod = String(this.itemPeriodMs || DEFAULT_AUTOPLAY_MS);

    for (const entry of this.renderedEntries) {
      const isActive = entry.itemIndex === this.activeIndex;
      const { card, item: entryItem } = entry;
      const image = card.querySelector('img');
      card.classList.toggle('is-active', isActive);
      card.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      if (isActive) {
        card.setAttribute('role', 'group');
        card.setAttribute('aria-label', `${String(this.activeIndex + 1).padStart(2, '0')} trên ${countText}: ${entryItem.title}`);
      } else {
        card.removeAttribute('role');
        card.removeAttribute('aria-label');
      }
      if (image) {
        image.alt = isActive ? entryItem.alt : '';
        image.setAttribute('aria-hidden', isActive ? 'false' : 'true');
        image.fetchPriority = isActive ? 'high' : 'low';
      }
    }

    if (announce) this.announceManualSelection();
    this.log('active crossing', {
      source,
      index: this.activeIndex,
      id: item.id,
      phaseSteps: Number(this.phaseSteps.toFixed(4))
    });
  }

  handleImageFailure(itemId) {
    if (this.failedIds.has(itemId)) return;
    this.failedIds.add(itemId);
    const failedIndex = this.items.findIndex((item) => item.id === itemId);
    if (failedIndex < 0) return;

    this.stopOrbitEngine('media-failure');
    const activeIdBeforeFailure = this.items[this.activeIndex]?.id;
    const failedCard = this.cardById.get(itemId);
    failedCard?.classList.add('has-media-error');
    failedCard?.remove();
    this.cardById.delete(itemId);
    this.items.splice(failedIndex, 1);
    this.visibleItems = this.items;

    if (!this.items.length) {
      this.hide('all-media-failed');
      return;
    }

    const preservedIndex = activeIdBeforeFailure && activeIdBeforeFailure !== itemId
      ? this.items.findIndex((item) => item.id === activeIdBeforeFailure)
      : Math.min(failedIndex, this.items.length - 1);
    this.activeIndex = Math.max(0, preservedIndex);
    this.previousActiveIndex = this.activeIndex;
    this.activePhaseStep = this.activeIndex;
    this.phaseSteps = this.activeIndex;
    this.lastFrameTime = 0;

    this.section.dataset.featuredCount = String(this.items.length);
    this.nodes.carousel?.setAttribute('aria-label', `Tác phẩm tiêu biểu — ${this.items.length} tác phẩm`);
    this.buildDots();
    this.updateControlVisibility();
    this.reconcileCards('media-recovery');
    this.syncActivePresentation('media-recovery', false);
    this.paintOrbitFrame();
    this.syncEngineState('media-recovery');
    this.log('image removed after failure', { id: itemId, remaining: this.items.length });
  }

  announceManualSelection() {
    const status = this.nodes.status;
    const item = this.items[this.activeIndex];
    if (!status || !item) return;
    status.textContent = `Đã chọn tác phẩm ${String(this.activeIndex + 1).padStart(2, '0')} trên ${String(this.items.length).padStart(2, '0')}: ${item.title}.`;
  }

  isModalOpen() {
    return document.body?.classList.contains('is-video-modal-open') === true;
  }

  getPauseReason() {
    if (this.destroyed) return 'destroyed';
    if (this.items.length < 2) return 'single-item';
    if (this.section.hidden) return 'section-hidden';
    if (this.isReducedMotion) return 'reduced-motion';
    if (!this.isInViewport) return 'offscreen';
    if (!this.isDocumentVisible || document.hidden) return 'tab-hidden';
    if (this.isVideoModalOpen || this.isModalOpen()) return 'video-modal';
    if (this.isPointerFineHovering) return 'fine-hover';
    if (this.isKeyboardInteracting) return 'keyboard-interaction';
    if (Date.now() < this.keyboardPauseUntil) return 'keyboard-focus-grace';
    if (Date.now() < this.userPauseUntil) return 'manual-pause';
    if (typeof window.requestAnimationFrame !== 'function') return 'raf-unavailable';
    return '';
  }

  shouldOrbitRun() {
    return this.getPauseReason() === '';
  }

  scheduleResumeCheck(trigger) {
    window.clearTimeout(this.resumeTimerId);
    this.resumeTimerId = 0;
    const nextTime = Math.max(this.userPauseUntil, this.keyboardPauseUntil);
    const remaining = nextTime - Date.now();
    if (remaining <= 0) return;
    this.resumeTimerId = window.setTimeout(() => {
      this.resumeTimerId = 0;
      this.syncEngineState(`${trigger}-ended`);
    }, remaining + 24);
  }

  updateEngineClasses(pauseReason) {
    const running = this.isOrbitRunning && !pauseReason;
    this.section.classList.toggle('is-orbit-running', running);
    this.section.classList.toggle('is-orbit-paused', !running && this.items.length > 1);
    this.section.classList.toggle('is-manual-paused', Date.now() < this.userPauseUntil);
    this.section.classList.toggle('is-reduced-motion', this.isReducedMotion);
    this.section.classList.toggle('is-mobile-orbit', Boolean(this.mobileLayout?.matches));
    if (pauseReason) this.section.dataset.featuredPauseReason = pauseReason;
    else this.section.removeAttribute('data-featured-pause-reason');
    this.section.dataset.featuredRaf = running ? 'running' : 'stopped';
    this.section.dataset.featuredFpsMode = this.frameSkipMobile ? '30' : '60';
  }

  syncEngineState(trigger = 'sync') {
    this.isDocumentVisible = document.visibilityState === 'visible' && !document.hidden;
    this.isVideoModalOpen = this.isModalOpen();
    this.isReducedMotion = Boolean(this.reducedMotion?.matches);
    const pauseReason = this.getPauseReason();

    if (pauseReason === 'manual-pause' || pauseReason === 'keyboard-focus-grace') {
      this.scheduleResumeCheck(pauseReason);
    }

    if (pauseReason) this.stopOrbitEngine(pauseReason);
    else this.startOrbitEngine(trigger);

    this.updateEngineClasses(pauseReason);
    this.updateDebugPanel(true);
    if (pauseReason !== this.lastPauseReason) {
      this.lastPauseReason = pauseReason;
      this.log('orbit state', {
        trigger,
        state: pauseReason || 'running',
        phaseSteps: Number(this.phaseSteps.toFixed(4)),
        fpsMode: this.frameSkipMobile ? 30 : 60,
        layoutMode: this.layoutMode
      });
    }
  }

  startOrbitEngine(trigger = 'start') {
    if (this.rafId || this.isOrbitRunning || !this.shouldOrbitRun()) return;
    this.isOrbitRunning = true;
    this.lastFrameTime = 0;
    this.rafId = window.requestAnimationFrame(this.onAnimationFrame);
    this.log('rAF started', { trigger, itemPeriodMs: this.itemPeriodMs, layoutMode: this.layoutMode });
  }

  stopOrbitEngine(reason = 'stop') {
    if (this.rafId) window.cancelAnimationFrame(this.rafId);
    const wasRunning = this.isOrbitRunning || Boolean(this.rafId);
    this.rafId = 0;
    this.lastFrameTime = 0;
    this.isOrbitRunning = false;
    if (wasRunning) this.log('rAF stopped', { reason, phaseSteps: Number(this.phaseSteps.toFixed(4)) });
  }

  onAnimationFrame(timestamp) {
    this.rafId = 0;
    const pauseReason = this.getPauseReason();
    if (pauseReason) {
      this.stopOrbitEngine(pauseReason);
      this.updateEngineClasses(pauseReason);
      return;
    }

    if (!this.lastFrameTime) {
      this.lastFrameTime = timestamp;
      this.rafId = window.requestAnimationFrame(this.onAnimationFrame);
      return;
    }

    const elapsed = timestamp - this.lastFrameTime;
    if (this.frameSkipMobile && elapsed < MOBILE_FRAME_INTERVAL_MS) {
      this.rafId = window.requestAnimationFrame(this.onAnimationFrame);
      return;
    }

    this.lastFrameTime = timestamp;
    const deltaMs = clamp(elapsed, 0, MAX_FRAME_DELTA_MS);
    this.lastFrameDelta = deltaMs;
    const period = Math.max(MIN_VISUAL_AUTOPLAY_MS, Number(this.itemPeriodMs) || DEFAULT_AUTOPLAY_MS);
    this.phaseSteps += deltaMs / period;

    if (Math.abs(this.phaseSteps) > this.items.length * 1000) {
      this.phaseSteps = modulo(this.phaseSteps, this.items.length);
      this.activePhaseStep = Math.round(this.phaseSteps);
      this.activeIndex = modulo(this.activePhaseStep, this.items.length);
    }

    this.syncActiveFromPhase('continuous-orbit');
    this.paintOrbitFrame();

    this.rafId = window.requestAnimationFrame(this.onAnimationFrame);
  }

  clearAuxiliaryTimers() {
    window.clearTimeout(this.resumeTimerId);
    window.clearTimeout(this.visibilityCheckTimerId);
    window.clearTimeout(this.resizeTimerId);
    window.clearTimeout(this.manualSnapTimerId);
    this.resumeTimerId = 0;
    this.visibilityCheckTimerId = 0;
    this.resizeTimerId = 0;
    this.manualSnapTimerId = 0;
    this.section.classList.remove('is-manual-snap');
  }
}

export function initFeaturedArtworks(section, featuredData, options = {}) {
  if (!(section instanceof HTMLElement)) {
    return {
      visible: false,
      itemCount: 0,
      autoplay: false,
      orbitRunning: false,
      phaseSteps: 0,
      layoutMode: 'hidden',
      reason: 'section-missing'
    };
  }

  let controller = controllers.get(section);
  if (!controller) {
    controller = new FeaturedArtworksController(section, options);
    controllers.set(section, controller);
  }
  return controller.update(featuredData, options);
}

export {
  MAX_SOURCE_ITEMS,
  MAX_VISUAL_ITEMS,
  MAX_DESKTOP_IMAGE_NODES,
  MAX_TABLET_IMAGE_NODES,
  MAX_MOBILE_IMAGE_NODES,
  DEFAULT_AUTOPLAY_MS,
  MIN_VISUAL_AUTOPLAY_MS,
  MAX_VISUAL_AUTOPLAY_MS,
  ORBIT_TRANSITION_MS,
  MOBILE_FRAME_INTERVAL_MS,
  ACTIVE_CROSSING_HYSTERESIS_STEPS,
  classifyImageRatio
};
