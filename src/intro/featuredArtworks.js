// v6.14.003 — Heritage Portal Infinity / Portal Center Stage + Infinity Flow.
// DOM-only, CMS-driven, idempotent and isolated from Viewer, CMS Admin and cursor runtime.

const MAX_RENDERED_ITEMS = 8;
const MAX_DESKTOP_IMAGE_NODES = 5;
const MAX_COMPACT_IMAGE_NODES = 3;
const DEFAULT_AUTOPLAY_MS = 4200;
const MIN_VISUAL_AUTOPLAY_MS = 3800;
const MAX_VISUAL_AUTOPLAY_MS = 4800;
const USER_PAUSE_MS = 12000;
const IMAGE_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']);
const controllers = new WeakMap();

function getText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
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
        ctaLabel: getText(item.ctaLabel, 'Xem trong không gian 3D')
      };
    })
    .filter(Boolean)
    .slice(0, MAX_RENDERED_ITEMS);
}

function modulo(value, length) {
  if (!length) return 0;
  return ((value % length) + length) % length;
}

function getSlotAssignments(itemCount, activeIndex, compact) {
  if (itemCount <= 0) return [];
  if (itemCount === 1) return [{ index: 0, slot: 'active' }];
  if (itemCount === 2) {
    return [
      { index: activeIndex, slot: 'active' },
      { index: modulo(activeIndex + 1, itemCount), slot: 'next' }
    ];
  }

  const definitions = compact || itemCount === 3
    ? [
        { offset: -1, slot: 'prev' },
        { offset: 0, slot: 'active' },
        { offset: 1, slot: 'next' }
      ]
    : itemCount === 4
      ? [
          { offset: -1, slot: 'prev' },
          { offset: 0, slot: 'active' },
          { offset: 1, slot: 'next' },
          { offset: 2, slot: 'far-next' }
        ]
      : [
          { offset: -2, slot: 'far-prev' },
          { offset: -1, slot: 'prev' },
          { offset: 0, slot: 'active' },
          { offset: 1, slot: 'next' },
          { offset: 2, slot: 'far-next' }
        ];

  const seen = new Set();
  return definitions.reduce((result, definition) => {
    const index = modulo(activeIndex + definition.offset, itemCount);
    if (seen.has(index)) return result;
    seen.add(index);
    result.push({ index, slot: definition.slot });
    return result;
  }, []);
}

class FeaturedArtworksController {
  constructor(section, options = {}) {
    this.section = section;
    this.options = options;
    this.items = [];
    this.activeIndex = 0;
    this.failedIds = new Set();
    this.cardById = new Map();
    this.timerId = 0;
    this.resumeTimerId = 0;
    this.visibilityCheckTimerId = 0;
    this.userPauseUntil = 0;
    this.isInViewport = false;
    this.isHovering = false;
    this.hasFocusWithin = false;
    this.mediaReady = false;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    this.compactLayout = window.matchMedia?.('(max-width: 900px)') || null;
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
        const nextVisible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.12);
        if (nextVisible !== this.isInViewport) {
          this.isInViewport = nextVisible;
          if (nextVisible) {
            this.mediaReady = true;
            this.renderSlots();
          }
        }
        this.schedule();
      }, { threshold: [0, 0.12, 0.3, 0.6], rootMargin: '10% 0px 10% 0px' });
      this.viewportObserver.observe(this.section);
    } else {
      this.isInViewport = true;
      this.mediaReady = true;
    }

    const handleMotionChange = () => {
      this.renderSlots();
      this.schedule();
    };
    if (this.reducedMotion?.addEventListener) this.reducedMotion.addEventListener('change', handleMotionChange);
    else this.reducedMotion?.addListener?.(handleMotionChange);

    const handleCompactChange = () => this.renderSlots();
    if (this.compactLayout?.addEventListener) this.compactLayout.addEventListener('change', handleCompactChange);
    else this.compactLayout?.addListener?.(handleCompactChange);

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
    this.mediaReady = this.isInViewport || !('IntersectionObserver' in window);
    this.resetCards();

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
    this.setText(
      this.nodes.exhibitionTitle,
      featuredData.exhibitionTitle,
      getText(featuredData.title, 'Tác phẩm tiêu biểu')
    );

    this.autoplayMs = clampAutoplay(featuredData.autoplayMs);
    this.buildIndicators();
    this.updateControlVisibility();
    this.render(0, { source: 'init' });
    this.queueVisibilityCheck();
    this.schedule();
    this.log('initialized', {
      items: this.items.length,
      autoplayMs: this.autoplayMs,
      imageNodeBudget: this.getImageNodeBudget()
    });
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
    this.resetCards();
    this.section.hidden = true;
    this.section.dataset.featuredState = reason;
    this.section.dataset.featuredCount = '0';
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
      if (rect.bottom >= -80 && rect.top <= viewportHeight + 80) {
        this.isInViewport = true;
        this.mediaReady = true;
        this.renderSlots();
        this.schedule();
      }
    }, 0);
  }

  buildIndicators() {
    const rail = this.nodes.rail;
    if (!rail) return;
    rail.replaceChildren();

    this.items.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'heritage-portal-indicator';
      button.dataset.featuredIndex = String(index);
      button.setAttribute('aria-label', `Xem tác phẩm ${String(index + 1).padStart(2, '0')}: ${item.title}`);
      button.textContent = String(index + 1).padStart(2, '0');
      button.addEventListener('click', () => this.goTo(index, 'user'));
      rail.appendChild(button);
    });
  }

  updateControlVisibility() {
    const hasMultiple = this.items.length > 1;
    if (this.nodes.controls) this.nodes.controls.hidden = !hasMultiple;
    if (this.nodes.rail) this.nodes.rail.hidden = !hasMultiple;
  }

  getImageNodeBudget() {
    return this.compactLayout?.matches ? MAX_COMPACT_IMAGE_NODES : MAX_DESKTOP_IMAGE_NODES;
  }

  move(direction, source = 'user') {
    if (this.items.length < 2) return;
    this.goTo(modulo(this.activeIndex + direction, this.items.length), source);
  }

  goTo(index, source = 'user') {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) return;
    if (source === 'user') this.userPauseUntil = Date.now() + USER_PAUSE_MS;
    this.render(index, { source });
    if (source === 'user') this.announceManualSelection();
    this.schedule();
  }

  render(index, { source = 'autoplay' } = {}) {
    if (!this.items.length) return;
    this.activeIndex = modulo(index, this.items.length);
    const item = this.items[this.activeIndex];
    const numberText = String(this.activeIndex + 1).padStart(2, '0');
    const countText = String(this.items.length).padStart(2, '0');

    this.setText(this.nodes.counter, `${numberText} / ${countText}`);
    this.setText(this.nodes.itemTitle, item.title);
    this.updateCta(item);
    this.updateIndicators();
    this.renderSlots();
    this.section.dataset.featuredActive = item.id;
    this.log('render', { source, index: this.activeIndex, id: item.id });
  }

  updateCta(item) {
    const cta = this.nodes.cta;
    if (!cta) return;
    if (!item.room) {
      cta.hidden = true;
      cta.removeAttribute('href');
      return;
    }
    cta.hidden = false;
    cta.href = `./gallery.html?room=${encodeURIComponent(item.room)}`;
    cta.textContent = item.ctaLabel;
  }

  updateIndicators() {
    this.nodes.rail?.querySelectorAll('[data-featured-index]').forEach((button, buttonIndex) => {
      const isActive = buttonIndex === this.activeIndex;
      button.classList.toggle('is-active', isActive);
      if (isActive) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  }

  createCard(item) {
    const card = document.createElement('figure');
    card.className = 'heritage-portal-card';
    card.dataset.featuredItemId = item.id;

    const image = document.createElement('img');
    image.className = 'heritage-portal-image';
    image.width = 1276;
    image.height = 956;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.draggable = false;

    const sheen = document.createElement('span');
    sheen.className = 'heritage-portal-card-sheen';
    sheen.setAttribute('aria-hidden', 'true');

    card.append(image, sheen);
    this.cardById.set(item.id, card);
    return card;
  }

  renderSlots() {
    const slides = this.nodes.slides;
    if (!slides || !this.items.length || this.section.hidden) return;

    const compact = this.compactLayout?.matches === true;
    const assignments = getSlotAssignments(this.items.length, this.activeIndex, compact)
      .slice(0, this.getImageNodeBudget());
    const visibleIds = new Set(assignments.map(({ index }) => this.items[index]?.id).filter(Boolean));

    for (const [itemId, card] of this.cardById.entries()) {
      if (visibleIds.has(itemId)) continue;
      card.remove();
      this.cardById.delete(itemId);
    }

    assignments.forEach(({ index, slot }) => {
      const item = this.items[index];
      if (!item) return;
      const card = this.cardById.get(item.id) || this.createCard(item);
      const image = card.querySelector('img');
      const isActive = slot === 'active';

      card.className = `heritage-portal-card is-slot-${slot}`;
      card.dataset.featuredIndex = String(index);
      card.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      if (isActive) {
        card.setAttribute('role', 'group');
        card.setAttribute('aria-label', `${String(index + 1).padStart(2, '0')} trên ${String(this.items.length).padStart(2, '0')}: ${item.title}`);
      } else {
        card.removeAttribute('role');
        card.removeAttribute('aria-label');
      }

      if (image) {
        image.dataset.itemId = item.id;
        image.alt = isActive ? item.alt : '';
        image.setAttribute('aria-hidden', isActive ? 'false' : 'true');
        image.onerror = () => {
          if (image.dataset.itemId !== item.id) return;
          this.handleImageFailure(item.id);
        };
        image.onload = () => {
          if (image.dataset.itemId !== item.id) return;
          card.classList.add('is-loaded');
          card.classList.remove('has-media-error');
        };
        if (this.mediaReady && image.getAttribute('src') !== item.imageUrl) {
          card.classList.remove('is-loaded');
          image.setAttribute('src', item.imageUrl);
        } else if (this.mediaReady && image.complete && image.naturalWidth > 0) {
          card.classList.add('is-loaded');
        }
      }

      slides.appendChild(card);
    });

    slides.dataset.featuredVisibleSlots = String(assignments.length);
  }

  handleImageFailure(itemId) {
    if (this.failedIds.has(itemId)) return;
    this.failedIds.add(itemId);
    const failedIndex = this.items.findIndex((item) => item.id === itemId);
    if (failedIndex < 0) return;

    const failedCard = this.cardById.get(itemId);
    failedCard?.classList.add('has-media-error');
    failedCard?.remove();
    this.cardById.delete(itemId);
    this.items.splice(failedIndex, 1);

    if (!this.items.length) {
      this.hide('all-media-failed');
      return;
    }

    if (failedIndex < this.activeIndex) this.activeIndex -= 1;
    if (this.activeIndex >= this.items.length) this.activeIndex = 0;

    this.section.dataset.featuredCount = String(this.items.length);
    this.nodes.carousel?.setAttribute('aria-label', `Tác phẩm tiêu biểu — ${this.items.length} tác phẩm`);
    this.buildIndicators();
    this.updateControlVisibility();
    this.render(this.activeIndex, { source: 'media-recovery' });
    this.schedule();
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
    window.clearTimeout(this.visibilityCheckTimerId);
    this.timerId = 0;
    this.resumeTimerId = 0;
    this.visibilityCheckTimerId = 0;
  }

  schedule() {
    window.clearTimeout(this.timerId);
    window.clearTimeout(this.resumeTimerId);
    this.timerId = 0;
    this.resumeTimerId = 0;

    if (this.items.length < 2 || this.section.hidden || this.reducedMotion?.matches) return;
    if (
      !this.isInViewport ||
      document.hidden ||
      this.isHovering ||
      this.hasFocusWithin ||
      this.isModalOpen()
    ) return;

    const pauseRemaining = this.userPauseUntil - Date.now();
    if (pauseRemaining > 0) {
      this.resumeTimerId = window.setTimeout(() => this.schedule(), pauseRemaining + 24);
      return;
    }

    if (!this.canAutoplay()) return;
    this.timerId = window.setTimeout(() => {
      this.goTo(modulo(this.activeIndex + 1, this.items.length), 'autoplay');
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

export {
  MAX_RENDERED_ITEMS,
  MAX_DESKTOP_IMAGE_NODES,
  MAX_COMPACT_IMAGE_NODES
};
