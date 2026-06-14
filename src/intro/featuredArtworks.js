// v6.14.006 — Continuous Orbit Motion + Mobile Parity.
// DOM/CSS 3D only: no canvas, WebGL, external carousel library or continuous frame loop.

const MAX_SOURCE_ITEMS = 12;
const MAX_VISUAL_ITEMS = 8;
const MAX_DESKTOP_IMAGE_NODES = 8;
const MAX_TABLET_IMAGE_NODES = 5;
const MAX_MOBILE_IMAGE_NODES = 3;
const DEFAULT_AUTOPLAY_MS = 3000;
const MIN_VISUAL_AUTOPLAY_MS = 2600;
const MAX_VISUAL_AUTOPLAY_MS = 4200;
const MAX_EFFECTIVE_STEP_DELAY_MS = 3200;
const ORBIT_TRANSITION_MS = 1050;
const ORBIT_MOVING_CLASS_MS = 1120;
const USER_PAUSE_MS = 12000;
const IMAGE_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']);
const ASPECT_CLASSES = Object.freeze(['is-wide', 'is-landscape', 'is-square', 'is-portrait']);
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
    return params.get('debugFeatured') === '1' || params.get('debugCMS') === '1';
  } catch {
    return false;
  }
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

function getCircularOffset(index, activeIndex, count) {
  if (count <= 1) return 0;
  let offset = modulo(index - activeIndex, count);
  if (offset > count / 2) offset -= count;
  if (count % 2 === 0 && offset === count / 2) offset = count / 2;
  return offset;
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
    this.activeIndex = 0;
    this.previousActiveIndex = 0;
    this.rotationStep = 0;
    this.lastDirection = 1;
    this.shuttleDirection = 1;
    this.failedIds = new Set();
    this.cardById = new Map();
    this.timerId = 0;
    this.resumeTimerId = 0;
    this.visibilityCheckTimerId = 0;
    this.orbitMotionTimerId = 0;
    this.userPauseUntil = 0;
    this.isInViewport = false;
    this.isInteractionHover = false;
    this.mediaReady = false;
    this.lastPauseReason = '';
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    this.mobileLayout = window.matchMedia?.('(max-width: 700px)') || null;
    this.tabletLayout = window.matchMedia?.('(max-width: 1024px)') || null;
    this.debug = isDebugEnabled(options);

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

    this.bindEvents();
    section.dataset.featuredInitialized = '1';
  }

  log(message, detail = undefined) {
    if (!this.debug) return;
    if (detail === undefined) console.debug(`[FeaturedArtworks] ${message}`);
    else console.debug(`[FeaturedArtworks] ${message}`, detail);
  }

  bindEvents() {
    const { carousel, prev, next } = this.nodes;

    prev?.addEventListener('click', () => this.move(-1, 'user'));
    next?.addEventListener('click', () => this.move(1, 'user'));

    carousel?.addEventListener('keydown', (event) => {
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

    this.section.addEventListener('pointerover', (event) => {
      if (event.pointerType === 'touch') return;
      const pauseTarget = safeClosest(event.target, '[data-featured-interactive], .infinity-gate-card.is-active');
      if (!pauseTarget || !this.section.contains(pauseTarget)) return;
      this.isInteractionHover = true;
      this.schedule('interaction-hover');
    }, { passive: true });

    this.section.addEventListener('pointerout', (event) => {
      if (event.pointerType === 'touch') return;
      const fromTarget = safeClosest(event.target, '[data-featured-interactive], .infinity-gate-card.is-active');
      if (!fromTarget) return;
      const toTarget = safeClosest(event.relatedTarget, '[data-featured-interactive], .infinity-gate-card.is-active');
      if (toTarget && this.section.contains(toTarget)) return;
      this.isInteractionHover = false;
      this.schedule('interaction-leave');
    }, { passive: true });

    document.addEventListener('visibilitychange', () => this.schedule('visibilitychange'), { passive: true });

    if ('IntersectionObserver' in window) {
      this.viewportObserver = new IntersectionObserver((entries) => {
        const entry = entries[0];
        const nextVisible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.10);
        if (nextVisible !== this.isInViewport) {
          this.isInViewport = nextVisible;
          if (nextVisible) {
            this.mediaReady = true;
            this.renderOrbit('viewport-enter');
          }
        }
        this.schedule(nextVisible ? 'viewport-enter' : 'viewport-exit');
      }, { threshold: [0, 0.10, 0.25, 0.55], rootMargin: '14% 0px 14% 0px' });
      this.viewportObserver.observe(this.section);
    } else {
      this.isInViewport = true;
      this.mediaReady = true;
    }

    const handleMotionChange = () => {
      this.renderOrbit('motion-change');
      this.schedule('motion-change');
    };
    if (this.reducedMotion?.addEventListener) this.reducedMotion.addEventListener('change', handleMotionChange);
    else this.reducedMotion?.addListener?.(handleMotionChange);

    const handleLayoutChange = () => {
      this.renderOrbit('layout-change');
      this.schedule('layout-change');
    };
    [this.mobileLayout, this.tabletLayout].forEach((query) => {
      if (query?.addEventListener) query.addEventListener('change', handleLayoutChange);
      else query?.addListener?.(handleLayoutChange);
    });

    if ('MutationObserver' in window && document.body) {
      this.modalObserver = new MutationObserver(() => this.schedule('modal-state'));
      this.modalObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }

  update(featuredData, options = {}) {
    this.options = { ...this.options, ...options };
    this.debug = isDebugEnabled(this.options);
    this.clearTimers();
    this.failedIds.clear();
    this.userPauseUntil = 0;
    this.mediaReady = this.isInViewport || !('IntersectionObserver' in window);
    this.resetCards();

    const enabled = featuredData?.enabled === true;
    const sourceCount = Array.isArray(featuredData?.items) ? featuredData.items.length : 0;
    this.items = enabled ? normalizeItems(featuredData, this.options) : [];
    this.activeIndex = 0;
    this.previousActiveIndex = 0;
    this.rotationStep = 0;
    this.lastDirection = 1;
    this.shuttleDirection = 1;

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
    this.buildDots();
    this.updateControlVisibility();
    this.render(0, { source: 'init', preserveRotation: true });
    this.queueVisibilityCheck();
    this.schedule('init');
    this.log('initialized', {
      sourceCount,
      itemCount: this.items.length,
      capped: sourceCount > this.items.length,
      layoutMode: this.getLayoutMode(),
      visualCount: this.getNodeBudget(),
      autoplayMs: this.autoplayMs,
      effectiveAutoplayDelayMs: this.getEffectiveAutoplayDelay(),
      orbitTransitionMs: ORBIT_TRANSITION_MS
    });
    return this.getState('ready');
  }

  getState(reason = '') {
    return {
      visible: !this.section.hidden && this.items.length > 0,
      itemCount: this.items.length,
      autoplay: this.canAutoplay(),
      layoutMode: this.getLayoutMode(),
      reason
    };
  }

  setText(node, value, fallback = '') {
    if (!node) return;
    node.textContent = getText(value, fallback);
  }

  hide(reason) {
    this.clearTimers();
    this.resetCards();
    this.section.hidden = true;
    this.section.dataset.featuredState = reason;
    this.section.dataset.featuredCount = '0';
    this.section.dataset.featuredLayout = 'hidden';
    this.nodes.rail?.replaceChildren();
    this.log(`hidden: ${reason}`);
  }

  resetCards() {
    this.cardById.clear();
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
        this.isInViewport = true;
        this.mediaReady = true;
        this.renderOrbit('visibility-fallback');
        this.schedule('visibility-fallback');
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
    if (this.reducedMotion?.matches) return 'reduced-motion';
    if (count === 1) return 'static-single';
    if (count === 2) return 'shuttle-two';
    if (this.mobileLayout?.matches) return 'mobile-compact';
    if (count <= 5) return 'compact-orbit';
    return 'full-orbit';
  }

  getNodeBudget() {
    if (this.items.length <= 1 || this.reducedMotion?.matches) return 1;
    if (this.mobileLayout?.matches) return Math.min(MAX_MOBILE_IMAGE_NODES, this.items.length);
    if (this.tabletLayout?.matches) return Math.min(MAX_TABLET_IMAGE_NODES, this.items.length);
    return Math.min(MAX_DESKTOP_IMAGE_NODES, this.items.length);
  }

  getRenderedIndices() {
    const count = this.items.length;
    const budget = this.getNodeBudget();
    if (budget >= count) return Array.from({ length: count }, (_, index) => index);

    const result = [this.activeIndex];
    for (let distance = 1; result.length < budget; distance += 1) {
      const previous = modulo(this.activeIndex - distance, count);
      if (!result.includes(previous)) result.push(previous);
      if (result.length >= budget) break;
      const next = modulo(this.activeIndex + distance, count);
      if (!result.includes(next)) result.push(next);
    }
    return result;
  }

  getEffectiveAutoplayDelay() {
    const transitionAdjustedDelay = this.autoplayMs - ORBIT_TRANSITION_MS;
    return clamp(transitionAdjustedDelay, MIN_VISUAL_AUTOPLAY_MS, MAX_EFFECTIVE_STEP_DELAY_MS);
  }

  startOrbitMotion(direction, source = 'autoplay') {
    window.clearTimeout(this.orbitMotionTimerId);
    this.orbitMotionTimerId = 0;

    if (this.reducedMotion?.matches || this.items.length < 2) {
      this.section.classList.remove('is-orbit-moving');
      this.section.removeAttribute('data-featured-orbit-direction');
      return;
    }

    const normalizedDirection = direction < 0 ? 'reverse' : 'forward';
    this.section.classList.remove('is-orbit-moving');
    this.section.dataset.featuredOrbitDirection = normalizedDirection;
    // Restart the finite transition pulse even when the user clicks repeatedly.
    void this.section.offsetWidth;
    this.section.classList.add('is-orbit-moving');
    this.section.dataset.featuredMotionSource = source;

    this.orbitMotionTimerId = window.setTimeout(() => {
      this.orbitMotionTimerId = 0;
      this.section.classList.remove('is-orbit-moving');
      this.section.removeAttribute('data-featured-motion-source');
    }, ORBIT_MOVING_CLASS_MS);
  }

  move(direction, source = 'user') {
    if (this.items.length < 2) return;
    const normalizedDirection = direction < 0 ? -1 : 1;
    if (this.items.length === 2) this.shuttleDirection *= -1;
    this.lastDirection = normalizedDirection;
    this.startOrbitMotion(normalizedDirection, source);
    this.rotationStep += normalizedDirection;
    this.render(modulo(this.rotationStep, this.items.length), { source, preserveRotation: true });
    if (source === 'user') {
      this.userPauseUntil = Date.now() + USER_PAUSE_MS;
      this.announceManualSelection();
    }
    this.schedule(source);
  }

  goTo(index, source = 'user') {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) return;
    if (index === this.activeIndex) {
      if (source === 'user') {
        this.userPauseUntil = Date.now() + USER_PAUSE_MS;
        this.schedule('same-item-user');
      }
      return;
    }

    const delta = getShortestStepDelta(this.activeIndex, index, this.items.length, this.lastDirection);
    this.lastDirection = delta < 0 ? -1 : 1;
    this.startOrbitMotion(this.lastDirection, source);
    if (this.items.length === 2) this.shuttleDirection *= -1;
    this.rotationStep += delta;
    if (source === 'user') this.userPauseUntil = Date.now() + USER_PAUSE_MS;
    this.render(index, { source, preserveRotation: true });
    if (source === 'user') this.announceManualSelection();
    this.schedule(source);
  }

  render(index, { source = 'autoplay', preserveRotation = false } = {}) {
    if (!this.items.length) return;
    this.previousActiveIndex = this.activeIndex;
    this.activeIndex = modulo(index, this.items.length);
    if (!preserveRotation) this.rotationStep = this.activeIndex;
    const item = this.items[this.activeIndex];
    const numberText = String(this.activeIndex + 1).padStart(2, '0');
    const countText = String(this.items.length).padStart(2, '0');

    this.setText(this.nodes.counter, `${numberText} / ${countText}`);
    this.setText(this.nodes.itemTitle, item.title);
    this.updateCta(item);
    this.updateDots();
    this.renderOrbit(source);
    this.section.dataset.featuredActive = item.id;
    this.section.dataset.featuredRotationStep = String(this.rotationStep);
    this.section.dataset.featuredAutoplayDelay = String(this.getEffectiveAutoplayDelay());
    this.log('render', {
      source,
      index: this.activeIndex,
      id: item.id,
      rotationStep: this.rotationStep,
      layoutMode: this.getLayoutMode()
    });
  }

  updateCta(item) {
    const cta = this.nodes.cta;
    if (!cta) return;
    if (!item.room) {
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

  getOrbitGeometry(itemIndex, layoutMode) {
    const count = this.items.length;
    if (count <= 1 || layoutMode === 'reduced-motion') {
      return { rawAngle: 0, normalizedAngle: 0 };
    }

    if (count === 2) {
      const isActive = itemIndex === this.activeIndex;
      const angle = isActive ? 0 : this.shuttleDirection * 72;
      return { rawAngle: angle, normalizedAngle: angle };
    }

    if (layoutMode === 'mobile-compact' && count > 5) {
      const offset = getCircularOffset(itemIndex, this.activeIndex, count);
      const angle = offset * 82;
      return { rawAngle: angle, normalizedAngle: normalizeAngle(angle) };
    }

    if (this.tabletLayout?.matches && count > MAX_TABLET_IMAGE_NODES) {
      const offset = getCircularOffset(itemIndex, this.activeIndex, count);
      const angle = offset * 62;
      return { rawAngle: angle, normalizedAngle: normalizeAngle(angle) };
    }

    const stepAngle = 360 / count;
    const rawAngle = (itemIndex - this.rotationStep) * stepAngle;
    return { rawAngle, normalizedAngle: normalizeAngle(rawAngle) };
  }

  updateCardGeometry(card, item, itemIndex, layoutMode) {
    const { rawAngle, normalizedAngle } = this.getOrbitGeometry(itemIndex, layoutMode);
    const radians = normalizedAngle * (Math.PI / 180);
    const depth = Math.cos(radians);
    const side = Math.sin(radians);
    const isActive = itemIndex === this.activeIndex;
    const absAngle = Math.abs(normalizedAngle);
    const sparseOrbit = this.items.length <= 3;

    let opacity = isActive ? 1 : 0.24 + ((depth + 1) / 2) * 0.62;
    let scale = isActive ? 1 : 0.56 + ((depth + 1) / 2) * 0.36;
    if (sparseOrbit && !isActive) {
      opacity = Math.max(opacity, 0.56);
      scale = Math.max(scale, 0.74);
    }
    if (layoutMode === 'mobile-compact' && !isActive) {
      opacity = Math.max(opacity, 0.52);
      scale = Math.max(scale, 0.68);
    }
    if (layoutMode === 'reduced-motion' && !isActive) opacity = 0;

    const y = isActive ? -4 : Math.round((1 - depth) * 12 + Math.abs(side) * 7);
    const yaw = isActive ? 0 : Math.round(side * -16);
    const layer = Math.round((depth + 1) * 50) + (isActive ? 100 : 10);

    card.style?.setProperty?.('--orbit-angle', `${rawAngle.toFixed(3)}deg`);
    card.style?.setProperty?.('--orbit-counter-angle', `${(-rawAngle).toFixed(3)}deg`);
    card.style?.setProperty?.('--orbit-y', `${y}px`);
    card.style?.setProperty?.('--orbit-scale', scale.toFixed(4));
    card.style?.setProperty?.('--orbit-opacity', opacity.toFixed(4));
    card.style?.setProperty?.('--orbit-yaw', `${yaw}deg`);
    card.style?.setProperty?.('--orbit-layer', String(layer));

    card.classList.toggle('is-active', isActive);
    card.classList.toggle('is-near', !isActive && absAngle <= 78);
    card.classList.toggle('is-far', !isActive && absAngle > 78 && absAngle <= 138);
    card.classList.toggle('is-back', !isActive && absAngle > 138);
    card.dataset.orbitAngle = normalizedAngle.toFixed(2);
    card.dataset.orbitPosition = isActive ? 'active' : absAngle <= 78 ? 'near' : absAngle <= 138 ? 'far' : 'back';
    card.style.zIndex = String(layer);
    card.setAttribute('aria-hidden', isActive ? 'false' : 'true');

    if (isActive) {
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', `${String(itemIndex + 1).padStart(2, '0')} trên ${String(this.items.length).padStart(2, '0')}: ${item.title}`);
    } else {
      card.removeAttribute('role');
      card.removeAttribute('aria-label');
    }

    return { isActive, absAngle, depth };
  }

  ensureImage(card, item, geometry) {
    const image = card.querySelector('img');
    if (!image) return;

    image.dataset.itemId = item.id;
    image.alt = geometry.isActive ? item.alt : '';
    image.setAttribute('aria-hidden', geometry.isActive ? 'false' : 'true');
    image.fetchPriority = geometry.isActive ? 'high' : 'low';

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

    const shouldLoad = this.mediaReady && (
      geometry.isActive ||
      geometry.absAngle <= 132 ||
      this.items.length <= 5 ||
      this.mobileLayout?.matches
    );

    if (shouldLoad && image.getAttribute('src') !== item.imageUrl) {
      card.classList.remove('is-loaded');
      image.setAttribute('src', item.imageUrl);
    } else if (shouldLoad && image.complete && image.naturalWidth > 0) {
      this.applyAspectRatio(card, item, image.naturalWidth, image.naturalHeight);
      card.classList.add('is-loaded');
    } else if (item.ratioClass) {
      this.applyAspectRatio(card, item, item.ratio * 1000, 1000);
    }
  }

  renderOrbit(source = 'render') {
    const slides = this.nodes.slides;
    if (!slides || !this.items.length || this.section.hidden) return;

    const layoutMode = this.getLayoutMode();
    const renderedIndices = this.getRenderedIndices();
    const renderedIds = new Set(renderedIndices.map((index) => this.items[index]?.id).filter(Boolean));

    for (const [itemId, card] of this.cardById.entries()) {
      if (renderedIds.has(itemId)) continue;
      card.remove();
      this.cardById.delete(itemId);
    }

    renderedIndices.forEach((itemIndex) => {
      const item = this.items[itemIndex];
      if (!item) return;
      const card = this.cardById.get(item.id) || this.createCard(item);
      const geometry = this.updateCardGeometry(card, item, itemIndex, layoutMode);
      this.ensureImage(card, item, geometry);
      slides.appendChild(card);
    });

    this.section.dataset.featuredLayout = layoutMode;
    this.section.dataset.featuredVisualCount = String(renderedIndices.length);
    slides.dataset.featuredVisibleSlots = String(renderedIndices.length);
    slides.dataset.featuredLayout = layoutMode;
    this.log('orbit layout', {
      source,
      layoutMode,
      renderedIndices,
      activeIndex: this.activeIndex,
      rotationStep: this.rotationStep
    });
  }

  handleImageFailure(itemId) {
    if (this.failedIds.has(itemId)) return;
    this.failedIds.add(itemId);
    const failedIndex = this.items.findIndex((item) => item.id === itemId);
    if (failedIndex < 0) return;

    const activeIdBeforeFailure = this.items[this.activeIndex]?.id;
    const failedCard = this.cardById.get(itemId);
    failedCard?.classList.add('has-media-error');
    failedCard?.remove();
    this.cardById.delete(itemId);
    this.items.splice(failedIndex, 1);

    if (!this.items.length) {
      this.hide('all-media-failed');
      return;
    }

    const preservedIndex = activeIdBeforeFailure && activeIdBeforeFailure !== itemId
      ? this.items.findIndex((item) => item.id === activeIdBeforeFailure)
      : Math.min(failedIndex, this.items.length - 1);
    this.activeIndex = Math.max(0, preservedIndex);
    this.previousActiveIndex = this.activeIndex;
    this.rotationStep = this.activeIndex;

    this.section.dataset.featuredCount = String(this.items.length);
    this.nodes.carousel?.setAttribute('aria-label', `Tác phẩm tiêu biểu — ${this.items.length} tác phẩm`);
    this.buildDots();
    this.updateControlVisibility();
    this.render(this.activeIndex, { source: 'media-recovery', preserveRotation: true });
    this.schedule('media-recovery');
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
    if (this.items.length < 2) return 'single-item';
    if (this.section.hidden) return 'section-hidden';
    if (this.reducedMotion?.matches) return 'reduced-motion';
    if (!this.isInViewport) return 'offscreen';
    if (document.hidden) return 'tab-hidden';
    if (this.isModalOpen()) return 'video-modal';
    if (this.isInteractionHover) return 'interaction-hover';
    if (Date.now() < this.userPauseUntil) return 'manual-pause';
    return '';
  }

  canAutoplay() {
    return this.getPauseReason() === '';
  }

  clearTimers() {
    window.clearTimeout(this.timerId);
    window.clearTimeout(this.resumeTimerId);
    window.clearTimeout(this.visibilityCheckTimerId);
    window.clearTimeout(this.orbitMotionTimerId);
    this.timerId = 0;
    this.resumeTimerId = 0;
    this.visibilityCheckTimerId = 0;
    this.orbitMotionTimerId = 0;
    this.section.classList.remove('is-orbit-moving');
    this.section.removeAttribute('data-featured-motion-source');
  }

  schedule(trigger = 'schedule') {
    window.clearTimeout(this.timerId);
    window.clearTimeout(this.resumeTimerId);
    this.timerId = 0;
    this.resumeTimerId = 0;

    const pauseReason = this.getPauseReason();
    if (pauseReason !== this.lastPauseReason) {
      this.lastPauseReason = pauseReason;
      this.log('autoplay state', { trigger, pauseReason: pauseReason || 'running' });
    }

    if (pauseReason === 'manual-pause') {
      const pauseRemaining = Math.max(0, this.userPauseUntil - Date.now());
      this.resumeTimerId = window.setTimeout(() => this.schedule('manual-pause-ended'), pauseRemaining + 24);
      return;
    }
    if (pauseReason) return;

    const autoplayDelay = this.getEffectiveAutoplayDelay();
    this.timerId = window.setTimeout(() => {
      this.move(1, 'autoplay');
    }, autoplayDelay);
  }
}

export function initFeaturedArtworks(section, featuredData, options = {}) {
  if (!(section instanceof HTMLElement)) {
    return { visible: false, itemCount: 0, autoplay: false, layoutMode: 'hidden', reason: 'section-missing' };
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
  classifyImageRatio
};
