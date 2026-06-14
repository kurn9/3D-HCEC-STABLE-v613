// v6.14.001 — CMS-driven Museum Showcase / Spotlight Rail for the index page.
// The module is intentionally DOM-only, idempotent and independent from Viewer/CMS Admin.

const MAX_RENDERED_ITEMS = 8;
const DEFAULT_AUTOPLAY_MS = 4200;
const MIN_AUTOPLAY_MS = 3600;
const MAX_AUTOPLAY_MS = 5600;
const USER_PAUSE_MS = 12000;
const IMAGE_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']);
const controllers = new WeakMap();

function getText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function clampAutoplay(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AUTOPLAY_MS;
  return Math.min(MAX_AUTOPLAY_MS, Math.max(MIN_AUTOPLAY_MS, Math.round(parsed)));
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

  return featuredData.items
    .filter((item) => item && typeof item === 'object' && item.visible !== false)
    .map((item, index) => {
      const title = getText(item.title);
      const imageUrl = getText(item.imageUrl);
      if (!title || !imageUrl || !isSafeImageUrl(imageUrl)) return null;
      return {
        id: getText(item.id, `featured_${index + 1}`),
        title,
        subtitle: getText(item.subtitle),
        description: getText(item.description),
        imageUrl,
        alt: getText(item.alt, title),
        room: ['indoor', 'outdoor'].includes(getText(item.room).toLowerCase())
          ? getText(item.room).toLowerCase()
          : '',
        artworkId: getText(item.artworkId),
        ctaLabel: getText(item.ctaLabel, 'Xem trong không gian 3D')
      };
    })
    .filter(Boolean)
    .slice(0, MAX_RENDERED_ITEMS);
}

class FeaturedArtworksController {
  constructor(section, options = {}) {
    this.section = section;
    this.options = options;
    this.items = [];
    this.activeIndex = 0;
    this.failedIds = new Set();
    this.timerId = 0;
    this.resumeTimerId = 0;
    this.renderToken = 0;
    this.userPauseUntil = 0;
    this.isInViewport = false;
    this.isHovering = false;
    this.hasFocusWithin = false;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    this.debug = isDebugEnabled(options);

    this.nodes = {
      carousel: section.querySelector('[data-featured-carousel]'),
      kicker: section.querySelector('[data-featured-kicker]'),
      title: section.querySelector('[data-featured-title]'),
      lead: section.querySelector('[data-featured-lead]'),
      stage: section.querySelector('[data-featured-stage]'),
      image: section.querySelector('[data-featured-image]'),
      number: section.querySelector('[data-featured-number]'),
      count: section.querySelector('[data-featured-count]'),
      itemTitle: section.querySelector('[data-featured-item-title]'),
      subtitle: section.querySelector('[data-featured-subtitle]'),
      description: section.querySelector('[data-featured-description]'),
      cta: section.querySelector('[data-featured-cta]'),
      prev: section.querySelector('[data-featured-prev]'),
      next: section.querySelector('[data-featured-next]'),
      controls: section.querySelector('[data-featured-controls]'),
      rail: section.querySelector('[data-featured-rail]')
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
      if (event.key === 'ArrowLeft') targetIndex = this.findAvailableIndex(this.activeIndex, -1);
      if (event.key === 'ArrowRight') targetIndex = this.findAvailableIndex(this.activeIndex, 1);
      if (event.key === 'Home') targetIndex = this.findFirstAvailableIndex();
      if (event.key === 'End') targetIndex = this.findLastAvailableIndex();
      if (targetIndex === null || targetIndex < 0) return;
      event.preventDefault();
      this.goTo(targetIndex, 'user');
    });

    this.section.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch') return;
      this.isHovering = true;
      this.schedule();
    }, { passive: true });

    this.section.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch') return;
      this.isHovering = false;
      this.schedule();
    }, { passive: true });

    this.section.addEventListener('focusin', () => {
      this.hasFocusWithin = true;
      this.schedule();
    });

    this.section.addEventListener('focusout', (event) => {
      if (event.relatedTarget && this.section.contains(event.relatedTarget)) return;
      this.hasFocusWithin = false;
      this.schedule();
    });

    document.addEventListener('visibilitychange', () => this.schedule(), { passive: true });

    if ('IntersectionObserver' in window) {
      this.viewportObserver = new IntersectionObserver((entries) => {
        const entry = entries[0];
        this.isInViewport = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.18);
        this.schedule();
      }, { threshold: [0, 0.18, 0.35, 0.6], rootMargin: '6% 0px 6% 0px' });
      this.viewportObserver.observe(this.section);
    } else {
      this.isInViewport = true;
    }

    const handleMotionChange = () => this.schedule();
    if (this.reducedMotion?.addEventListener) this.reducedMotion.addEventListener('change', handleMotionChange);
    else this.reducedMotion?.addListener?.(handleMotionChange);

    if ('MutationObserver' in window && document.body) {
      this.modalObserver = new MutationObserver(() => this.schedule());
      this.modalObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }

  update(featuredData, options = {}) {
    this.options = { ...this.options, ...options };
    this.debug = isDebugEnabled(this.options);
    this.clearTimers();
    this.failedIds.clear();
    this.userPauseUntil = 0;

    const enabled = featuredData?.enabled === true;
    this.items = enabled ? normalizeItems(featuredData, this.options) : [];
    this.activeIndex = 0;

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
    this.nodes.carousel?.setAttribute('aria-label', `Tác phẩm tiêu biểu — ${this.items.length} tác phẩm`);

    this.setText(this.nodes.kicker, featuredData.kicker, 'Tuyển chọn từ không gian trưng bày');
    this.setText(this.nodes.title, featuredData.title, 'Tác phẩm tiêu biểu');
    this.setText(this.nodes.lead, featuredData.lead, 'Những điểm nhấn hình ảnh được tuyển chọn trong không gian triển lãm.');

    this.autoplayMs = clampAutoplay(featuredData.autoplayMs);
    this.buildRail();
    this.updateControlVisibility();
    this.render(0, { immediate: true });
    this.schedule();
    this.log('initialized', { items: this.items.length, autoplayMs: this.autoplayMs });
    return this.getState('ready');
  }

  getState(reason = '') {
    return {
      visible: !this.section.hidden && this.items.length > 0,
      itemCount: this.items.length,
      autoplay: this.canAutoplay(),
      reason
    };
  }

  setText(node, value, fallback = '') {
    if (!node) return;
    node.textContent = getText(value, fallback);
  }

  hide(reason) {
    this.clearTimers();
    this.section.hidden = true;
    this.section.dataset.featuredState = reason;
    this.section.dataset.featuredCount = '0';
    this.log(`hidden: ${reason}`);
  }

  buildRail() {
    const rail = this.nodes.rail;
    if (!rail) return;
    rail.replaceChildren();

    this.items.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'featured-rail-item';
      button.dataset.featuredIndex = String(index);
      button.setAttribute('aria-label', `Xem tác phẩm ${String(index + 1).padStart(2, '0')}: ${item.title}`);

      const number = document.createElement('span');
      number.className = 'featured-rail-number';
      number.textContent = String(index + 1).padStart(2, '0');

      const title = document.createElement('span');
      title.className = 'featured-rail-title';
      title.textContent = item.title;

      button.append(number, title);
      button.addEventListener('click', () => this.goTo(index, 'user'));
      rail.appendChild(button);
    });
  }

  updateControlVisibility() {
    const hasMultiple = this.items.length > 1;
    if (this.nodes.controls) this.nodes.controls.hidden = !hasMultiple;
    if (this.nodes.rail) this.nodes.rail.hidden = !hasMultiple;
  }

  findFirstAvailableIndex() {
    return this.items.findIndex((item) => !this.failedIds.has(item.id));
  }

  findLastAvailableIndex() {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      if (!this.failedIds.has(this.items[index].id)) return index;
    }
    return -1;
  }

  findAvailableIndex(startIndex, direction = 1) {
    if (!this.items.length) return -1;
    for (let step = 1; step <= this.items.length; step += 1) {
      const candidate = (startIndex + (step * direction) + this.items.length) % this.items.length;
      if (!this.failedIds.has(this.items[candidate].id)) return candidate;
    }
    return -1;
  }

  move(direction, source = 'user') {
    const nextIndex = this.findAvailableIndex(this.activeIndex, direction);
    if (nextIndex >= 0) this.goTo(nextIndex, source);
  }

  goTo(index, source = 'user') {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) return;
    if (this.failedIds.has(this.items[index].id)) return;
    if (source === 'user') this.userPauseUntil = Date.now() + USER_PAUSE_MS;
    this.render(index);
    this.schedule();
  }

  render(index, { immediate = false } = {}) {
    const item = this.items[index];
    if (!item) return;
    this.activeIndex = index;
    const token = ++this.renderToken;
    const numberText = String(index + 1).padStart(2, '0');
    const countText = String(this.items.length).padStart(2, '0');

    this.setText(this.nodes.number, numberText);
    this.setText(this.nodes.count, countText);
    this.setText(this.nodes.itemTitle, item.title);
    this.setText(this.nodes.subtitle, item.subtitle);
    this.setText(this.nodes.description, item.description);
    this.nodes.subtitle?.toggleAttribute('hidden', !item.subtitle);
    this.nodes.description?.toggleAttribute('hidden', !item.description);

    const cta = this.nodes.cta;
    if (cta) {
      if (item.room) {
        cta.hidden = false;
        cta.href = `./gallery.html?room=${encodeURIComponent(item.room)}`;
        cta.textContent = item.ctaLabel;
        if (item.artworkId) cta.dataset.artworkId = item.artworkId;
        else delete cta.dataset.artworkId;
      } else {
        cta.hidden = true;
        cta.removeAttribute('href');
        delete cta.dataset.artworkId;
      }
    }

    this.nodes.rail?.querySelectorAll('[data-featured-index]').forEach((button, buttonIndex) => {
      const isActive = buttonIndex === index;
      button.classList.toggle('is-active', isActive);
      if (isActive) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });

    const image = this.nodes.image;
    const stage = this.nodes.stage;
    if (!image || !stage) return;
    stage.classList.add('is-loading');
    if (!immediate) stage.classList.add('is-changing');

    image.onload = () => {
      if (token !== this.renderToken) return;
      stage.classList.remove('is-loading', 'is-changing', 'has-media-error');
    };
    image.onerror = () => {
      if (token !== this.renderToken) return;
      this.failedIds.add(item.id);
      stage.classList.remove('is-loading', 'is-changing');
      stage.classList.add('has-media-error');
      this.log('image failed', { id: item.id, imageUrl: item.imageUrl });
      const nextIndex = this.findAvailableIndex(index, 1);
      if (nextIndex < 0 || nextIndex === index) {
        this.hide('all-media-failed');
        return;
      }
      this.render(nextIndex);
      this.schedule();
    };

    image.alt = item.alt;
    image.loading = 'lazy';
    image.decoding = 'async';
    if (image.getAttribute('src') !== item.imageUrl) image.setAttribute('src', item.imageUrl);
    else if (image.complete && image.naturalWidth > 0) image.onload();
  }

  isModalOpen() {
    return document.body?.classList.contains('is-video-modal-open') === true;
  }

  canAutoplay() {
    return Boolean(
      this.items.length > 1 &&
      !this.section.hidden &&
      !this.reducedMotion?.matches &&
      this.isInViewport &&
      !document.hidden &&
      !this.isHovering &&
      !this.hasFocusWithin &&
      !this.isModalOpen() &&
      Date.now() >= this.userPauseUntil
    );
  }

  clearTimers() {
    window.clearTimeout(this.timerId);
    window.clearTimeout(this.resumeTimerId);
    this.timerId = 0;
    this.resumeTimerId = 0;
  }

  schedule() {
    window.clearTimeout(this.timerId);
    window.clearTimeout(this.resumeTimerId);
    this.timerId = 0;
    this.resumeTimerId = 0;

    if (this.items.length < 2 || this.section.hidden || this.reducedMotion?.matches) return;

    const pauseRemaining = this.userPauseUntil - Date.now();
    if (pauseRemaining > 0) {
      this.resumeTimerId = window.setTimeout(() => this.schedule(), pauseRemaining + 24);
      return;
    }

    if (!this.canAutoplay()) return;
    this.timerId = window.setTimeout(() => {
      const nextIndex = this.findAvailableIndex(this.activeIndex, 1);
      if (nextIndex >= 0 && nextIndex !== this.activeIndex) this.goTo(nextIndex, 'autoplay');
      else this.schedule();
    }, this.autoplayMs);
  }
}

export function initFeaturedArtworks(section, featuredData, options = {}) {
  if (!(section instanceof HTMLElement)) {
    return { visible: false, itemCount: 0, autoplay: false, reason: 'section-missing' };
  }

  let controller = controllers.get(section);
  if (!controller) {
    controller = new FeaturedArtworksController(section, options);
    controllers.set(section, controller);
  }
  return controller.update(featuredData, options);
}

export { MAX_RENDERED_ITEMS };
