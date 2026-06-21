// v6.14.038 — Canonical Index CMS latest/fallback normalizer with per-item media recovery.
// Keeps schema aliasing, validation and fallback merging outside intro/main.js.

const IMAGE_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']);
const VIDEO_EXTENSIONS = Object.freeze(['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v']);

const DEFAULT_INDEX_CMS_LOADER_OPTIONS = Object.freeze({
  context: 'index',
  remoteEnabled: true,
  pointerUrl: 'https://ocmidhgabyrvqbvqgorw.supabase.co/storage/v1/object/public/cms-public/published/current_release.json',
  legacyLatestUrl: 'https://ocmidhgabyrvqbvqgorw.supabase.co/storage/v1/object/public/cms-public/published/cms_public_content.json',
  releasePublicBaseUrl: 'https://ocmidhgabyrvqbvqgorw.supabase.co/storage/v1/object/public/cms-public',
  remoteUrl: 'https://ocmidhgabyrvqbvqgorw.supabase.co/storage/v1/object/public/cms-public/published/cms_public_content.json',
  fallbackUrl: './data/cms_content_fallback.json',
  timeoutMs: 1200,
  allowRemoteMedia: true,
  allowedMediaOrigins: Object.freeze([
    'https://ocmidhgabyrvqbvqgorw.supabase.co',
    'https://pub-d00970587980484399ff842b58cd1e9e.r2.dev'
  ]),
  allowedMediaHosts: Object.freeze([
    'ocmidhgabyrvqbvqgorw.supabase.co',
    'pub-d00970587980484399ff842b58cd1e9e.r2.dev'
  ]),
  allowedMediaPathPrefixes: Object.freeze(['/storage/v1/object/public/', '/']),
  strictIndexContract: true,
  requireIndexFeatured: true,
  allowFeaturedItemFallback: true,
  strictRoomMedia: false
});

function getIndexCmsLoaderOptions(options = {}) {
  const runtimeOptions = isPlainObject(globalThis.INDEX_CMS_CONTENT_CONFIG)
    ? globalThis.INDEX_CMS_CONTENT_CONFIG
    : {};
  const merged = {
    ...DEFAULT_INDEX_CMS_LOADER_OPTIONS,
    ...runtimeOptions,
    ...options
  };
  return {
    ...merged,
    allowedMediaOrigins: merged.allowedMediaOrigins || DEFAULT_INDEX_CMS_LOADER_OPTIONS.allowedMediaOrigins,
    allowedMediaHosts: merged.allowedMediaHosts || DEFAULT_INDEX_CMS_LOADER_OPTIONS.allowedMediaHosts,
    allowedMediaPathPrefixes: merged.allowedMediaPathPrefixes || DEFAULT_INDEX_CMS_LOADER_OPTIONS.allowedMediaPathPrefixes
  };
}

const DEFAULT_INDEX_CONTENT = Object.freeze({
  hero: Object.freeze({
    eyebrow: '',
    title: '',
    lead: '',
    proofChips: Object.freeze([]),
    recommendation: '',
    media: Object.freeze({ videoUrl: '', caption: '' })
  }),
  experience: Object.freeze({
    kicker: '',
    title: '',
    lead: '',
    routes: Object.freeze([])
  }),
  guide: Object.freeze({
    kicker: '',
    title: '',
    lead: '',
    steps: Object.freeze([])
  }),
  contact: Object.freeze({
    label: '',
    organizationName: '',
    address: '',
    phoneFax: ''
  }),
  featuredArtworks: Object.freeze({
    enabled: false,
    kicker: 'Tuyển chọn từ không gian trưng bày',
    title: 'Tác phẩm tiêu biểu',
    exhibitionTitle: '',
    lead: 'Những điểm nhấn hình ảnh được tuyển chọn trong không gian triển lãm.',
    autoplayMs: 4200,
    items: Object.freeze([])
  })
});

function getValidator() {
  return globalThis.cmsSchemaValidator || {};
}

function isPlainObject(value) {
  return getValidator().isPlainObject
    ? getValidator().isPlainObject(value)
    : Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getLimits() {
  return getValidator().INDEX_LIMITS || {
    proofChips: 6,
    routes: 4,
    steps: 6,
    featuredItems: 12,
    featuredAutoplayMin: 3600,
    featuredAutoplayMax: 5600
  };
}

function getTextLimits() {
  return getValidator().INDEX_TEXT_LIMITS || {
    eyebrow: 120,
    kicker: 120,
    title: 240,
    exhibitionTitle: 220,
    lead: 900,
    recommendation: 600,
    caption: 240,
    label: 160,
    description: 900,
    ctaLabel: 120,
    number: 24,
    organizationName: 300,
    address: 600,
    phoneFax: 220,
    id: 160,
    subtitle: 300,
    alt: 600,
    room: 80,
    artworkId: 160,
    imageUrl: 2048
  };
}

function sanitizeText(value, fallback = '', maxLength = 0) {
  if (typeof value !== 'string') return fallback;
  if (getValidator().sanitizeText) return getValidator().sanitizeText(value, fallback, maxLength);
  const text = value.replace(/<[^>]+>/g, '').trim();
  if (!text) return fallback;
  return maxLength > 0 ? text.slice(0, maxLength).trim() : text;
}

function cloneDefaults() {
  return {
    hero: {
      eyebrow: DEFAULT_INDEX_CONTENT.hero.eyebrow,
      title: DEFAULT_INDEX_CONTENT.hero.title,
      lead: DEFAULT_INDEX_CONTENT.hero.lead,
      proofChips: [],
      recommendation: DEFAULT_INDEX_CONTENT.hero.recommendation,
      media: { ...DEFAULT_INDEX_CONTENT.hero.media }
    },
    experience: {
      kicker: DEFAULT_INDEX_CONTENT.experience.kicker,
      title: DEFAULT_INDEX_CONTENT.experience.title,
      lead: DEFAULT_INDEX_CONTENT.experience.lead,
      routes: []
    },
    guide: {
      kicker: DEFAULT_INDEX_CONTENT.guide.kicker,
      title: DEFAULT_INDEX_CONTENT.guide.title,
      lead: DEFAULT_INDEX_CONTENT.guide.lead,
      steps: []
    },
    contact: { ...DEFAULT_INDEX_CONTENT.contact },
    featuredArtworks: {
      enabled: DEFAULT_INDEX_CONTENT.featuredArtworks.enabled,
      kicker: DEFAULT_INDEX_CONTENT.featuredArtworks.kicker,
      title: DEFAULT_INDEX_CONTENT.featuredArtworks.title,
      exhibitionTitle: DEFAULT_INDEX_CONTENT.featuredArtworks.exhibitionTitle,
      lead: DEFAULT_INDEX_CONTENT.featuredArtworks.lead,
      autoplayMs: DEFAULT_INDEX_CONTENT.featuredArtworks.autoplayMs,
      items: []
    }
  };
}

function getIndexObject(content) {
  if (isPlainObject(content?.index)) return content.index;
  if (isPlainObject(content) && ['hero', 'experience', 'guide', 'contact', 'featured', 'featuredArtworks'].some((key) => key in content)) return content;
  return null;
}

function getSiteObject(content) {
  return isPlainObject(content?.site) ? content.site : null;
}

function getMediaOptions(cms, options = {}) {
  if (typeof cms?.getCmsMediaValidationOptions === 'function') {
    return cms.getCmsMediaValidationOptions(options);
  }
  const config = typeof cms?.getCmsConfig === 'function' ? cms.getCmsConfig(options) : options;
  return {
    allowRemoteMedia: config?.allowRemoteMedia === true,
    allowedMediaOrigins: config?.allowedMediaOrigins || [],
    allowedMediaHosts: config?.allowedMediaHosts || [],
    allowedMediaPathPrefixes: config?.allowedMediaPathPrefixes || [],
    disallowSignedMediaUrls: true
  };
}

function isSafeMediaUrl(value, mediaOptions, allowedMediaExtensions) {
  const validator = getValidator();
  if (!validator.isSafeMediaUrl) return false;
  return validator.isSafeMediaUrl(value, {
    ...mediaOptions,
    allowedMediaExtensions,
    disallowSignedMediaUrls: true
  });
}

function addWarning(diagnostics, message) {
  if (!diagnostics.warnings.includes(message)) diagnostics.warnings.push(message);
}

function addError(diagnostics, message) {
  if (!diagnostics.errors.includes(message)) diagnostics.errors.push(message);
}

function readText(source, keys, maxLength, diagnostics, path) {
  if (!isPlainObject(source)) return '';
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      addWarning(diagnostics, `${path}.${key} ignored because it is not a string.`);
      continue;
    }
    const clean = sanitizeText(value, '', maxLength);
    if (clean) return clean;
  }
  return '';
}

function applyText(target, field, source, keys, maxLength, diagnostics, path) {
  const clean = readText(source, keys, maxLength, diagnostics, path);
  if (clean) target[field] = clean;
}

function normalizeTextArray(value, maxItems, maxLength, diagnostics, path) {
  if (!Array.isArray(value)) {
    if (value !== undefined) addWarning(diagnostics, `${path} ignored because it is not an array.`);
    return [];
  }
  if (value.length > maxItems) addWarning(diagnostics, `${path} capped at ${maxItems} items.`);
  return value.slice(0, maxItems).map((item, index) => {
    if (typeof item !== 'string') {
      addWarning(diagnostics, `${path}[${index}] ignored because it is not a string.`);
      return '';
    }
    return sanitizeText(item, '', maxLength);
  }).filter(Boolean);
}

function mergeObjectByKey(existing, incoming, keyField, maxItems) {
  const result = existing.map((item) => ({ ...item }));
  incoming.forEach((item) => {
    const key = item[keyField];
    const index = key ? result.findIndex((candidate) => candidate[keyField] === key) : -1;
    if (index >= 0) result[index] = { ...result[index], ...item };
    else if (result.length < maxItems) result.push({ ...item });
  });
  return result.slice(0, maxItems);
}

function normalizeRoutes(value, diagnostics, path) {
  const limits = getLimits();
  const textLimits = getTextLimits();
  if (!Array.isArray(value)) {
    if (value !== undefined) addWarning(diagnostics, `${path} ignored because it is not an array.`);
    return [];
  }
  if (value.length > limits.routes) addWarning(diagnostics, `${path} capped at ${limits.routes} items.`);
  return value.slice(0, limits.routes).map((item, index) => {
    if (!isPlainObject(item)) {
      addWarning(diagnostics, `${path}[${index}] ignored because it is not an object.`);
      return null;
    }
    const roomKey = readText(item, ['room_key', 'roomKey'], textLimits.room, diagnostics, `${path}[${index}]`).toLowerCase();
    if (!roomKey) {
      addWarning(diagnostics, `${path}[${index}] ignored because room_key is missing.`);
      return null;
    }
    const route = { room_key: roomKey };
    applyText(route, 'label', item, ['label'], textLimits.label, diagnostics, `${path}[${index}]`);
    applyText(route, 'title', item, ['title'], textLimits.title, diagnostics, `${path}[${index}]`);
    applyText(route, 'description', item, ['description'], textLimits.description, diagnostics, `${path}[${index}]`);
    applyText(route, 'ctaLabel', item, ['ctaLabel', 'cta_label'], textLimits.ctaLabel, diagnostics, `${path}[${index}]`);
    return route;
  }).filter(Boolean);
}

function normalizeSteps(value, diagnostics, path) {
  const limits = getLimits();
  const textLimits = getTextLimits();
  if (!Array.isArray(value)) {
    if (value !== undefined) addWarning(diagnostics, `${path} ignored because it is not an array.`);
    return [];
  }
  if (value.length > limits.steps) addWarning(diagnostics, `${path} capped at ${limits.steps} items.`);
  return value.slice(0, limits.steps).map((item, index) => {
    if (!isPlainObject(item)) {
      addWarning(diagnostics, `${path}[${index}] ignored because it is not an object.`);
      return null;
    }
    const number = readText(item, ['number', 'id'], textLimits.number, diagnostics, `${path}[${index}]`) || String(index + 1).padStart(2, '0');
    const step = { number };
    applyText(step, 'title', item, ['title'], textLimits.title, diagnostics, `${path}[${index}]`);
    applyText(step, 'description', item, ['description'], textLimits.description, diagnostics, `${path}[${index}]`);
    if (!step.title && !step.description) {
      addWarning(diagnostics, `${path}[${index}] ignored because it contains no usable content.`);
      return null;
    }
    return step;
  }).filter(Boolean);
}

function getFeaturedBoolean(item, fallbackItem, keys, fallback = true) {
  for (const key of keys) {
    if (typeof item?.[key] === 'boolean') return item[key];
  }
  if (fallbackItem && typeof fallbackItem.visible === 'boolean') return fallbackItem.visible;
  return fallback;
}

function getFeaturedOrder(item, fallbackItem, index) {
  for (const key of ['sortOrder', 'sort_order', 'order']) {
    if (item?.[key] === null || item?.[key] === undefined || item?.[key] === '') continue;
    const value = Number(item[key]);
    if (Number.isFinite(value)) return value;
  }
  if (Number.isFinite(Number(fallbackItem?.sortOrder))) return Number(fallbackItem.sortOrder);
  return index + 1;
}

function findFeaturedFallback(fallbackItems, rawId, rawArtworkId, index) {
  const normalizedId = String(rawId || '').trim();
  const normalizedArtworkId = String(rawArtworkId || '').trim().toUpperCase();
  const exact = fallbackItems.find((item) => {
    if (normalizedId && item.id === normalizedId) return true;
    return normalizedArtworkId && String(item.artworkId || '').trim().toUpperCase() === normalizedArtworkId;
  });
  return exact || fallbackItems[index] || null;
}

function normalizeFeaturedItems(value, mediaOptions, diagnostics, path, fallbackItems = []) {
  const limits = getLimits();
  const textLimits = getTextLimits();
  if (!Array.isArray(value)) {
    if (value !== undefined) addWarning(diagnostics, `${path} ignored because it is not an array.`);
    return [];
  }
  if (value.length > limits.featuredItems) addWarning(diagnostics, `${path} capped at ${limits.featuredItems} items.`);

  const result = [];
  const seenIds = new Set();
  value.slice(0, limits.featuredItems).forEach((item, index) => {
    if (!isPlainObject(item)) {
      addWarning(diagnostics, `${path}[${index}] ignored because it is not an object.`);
      return;
    }

    const itemPath = `${path}[${index}]`;
    const rawId = readText(item, ['id', 'code'], textLimits.id, diagnostics, itemPath);
    const rawArtworkId = readText(item, ['artworkId', 'artwork_id'], textLimits.artworkId, diagnostics, itemPath);
    const fallbackItem = findFeaturedFallback(fallbackItems, rawId, rawArtworkId, index);
    const id = rawId || fallbackItem?.id || rawArtworkId;
    if (!id) {
      addWarning(diagnostics, `${itemPath} ignored because id is missing and no per-item fallback matched.`);
      return;
    }
    if (seenIds.has(id)) {
      addWarning(diagnostics, `${itemPath} ignored because id "${id}" is duplicated.`);
      return;
    }

    const visible = getFeaturedBoolean(item, fallbackItem, ['visible', 'isVisible', 'is_visible', 'enabled'], true);
    const title = readText(item, ['title', 'name'], textLimits.title, diagnostics, itemPath) || fallbackItem?.title || '';
    const rawImageUrl = readText(
      item,
      ['imageUrl', 'image', 'image_url', 'src', 'url', 'thumbnailUrl', 'thumbnail', 'thumbnail_url', 'posterUrl', 'poster', 'poster_url', 'mediaUrl', 'media_url'],
      textLimits.imageUrl,
      diagnostics,
      itemPath
    );
    const safePrimaryImage = rawImageUrl && isSafeMediaUrl(rawImageUrl, mediaOptions, IMAGE_EXTENSIONS) ? rawImageUrl : '';
    const safeFallbackImage = fallbackItem?.imageUrl && isSafeMediaUrl(fallbackItem.imageUrl, mediaOptions, IMAGE_EXTENSIONS)
      ? fallbackItem.imageUrl
      : '';
    const imageUrl = safePrimaryImage || safeFallbackImage;

    if (rawImageUrl && !safePrimaryImage) addWarning(diagnostics, `${itemPath}.imageUrl ignored by media policy; per-item fallback was attempted.`);
    if (!rawImageUrl && safeFallbackImage) addWarning(diagnostics, `${itemPath}.imageUrl missing; matched fallback item media was used.`);
    if (visible && !title) {
      addWarning(diagnostics, `${itemPath} ignored because visible items require title and no fallback title matched.`);
      return;
    }
    if (visible && !imageUrl) {
      addWarning(diagnostics, `${itemPath} ignored because visible items require a safe imageUrl and no fallback image matched.`);
      return;
    }

    const normalized = {
      id,
      title,
      imageUrl,
      visible,
      sortOrder: getFeaturedOrder(item, fallbackItem, index)
    };

    const subtitle = readText(item, ['subtitle'], textLimits.subtitle, diagnostics, itemPath) || fallbackItem?.subtitle || '';
    const description = readText(item, ['description', 'caption'], textLimits.description, diagnostics, itemPath) || fallbackItem?.description || '';
    const room = readText(item, ['room', 'room_key', 'roomKey'], textLimits.room, diagnostics, itemPath) || fallbackItem?.room || '';
    const artworkId = rawArtworkId || fallbackItem?.artworkId || '';
    const ctaLabel = readText(item, ['ctaLabel', 'cta_label'], textLimits.ctaLabel, diagnostics, itemPath) || fallbackItem?.ctaLabel || '';
    if (subtitle) normalized.subtitle = subtitle;
    if (description) normalized.description = description;
    if (room) normalized.room = room;
    if (artworkId) normalized.artworkId = artworkId;
    if (ctaLabel) normalized.ctaLabel = ctaLabel;

    const alt = readText(item, ['alt'], textLimits.alt, diagnostics, itemPath) || fallbackItem?.alt || title;
    normalized.alt = alt;
    if (visible && !readText(item, ['alt'], textLimits.alt, { warnings: [], errors: [] }, itemPath) && !fallbackItem?.alt) {
      addWarning(diagnostics, `${itemPath}.alt missing; title used as fallback.`);
    }

    seenIds.add(id);
    result.push({ ...normalized, __sourceIndex: index });
  });

  return result
    .sort((a, b) => (a.sortOrder - b.sortOrder) || (a.__sourceIndex - b.__sourceIndex))
    .map(({ __sourceIndex, ...item }) => item);
}

function applySiteContactLayer(target, content, diagnostics, sourceLabel) {
  const site = getSiteObject(content);
  if (!site) return;
  const textLimits = getTextLimits();
  applyText(target, 'organizationName', site, ['organizationName'], textLimits.organizationName, diagnostics, `${sourceLabel}.site`);
  applyText(target, 'address', site, ['address'], textLimits.address, diagnostics, `${sourceLabel}.site`);
  const phone = readText(site, ['phone'], textLimits.phoneFax, diagnostics, `${sourceLabel}.site`);
  const fax = readText(site, ['fax'], textLimits.phoneFax, diagnostics, `${sourceLabel}.site`);
  const phoneFax = [phone, fax ? `Fax: ${fax}` : ''].filter(Boolean).join(' - ');
  if (phoneFax) target.phoneFax = phoneFax;
}

function applyIndexLayer(target, content, mediaOptions, diagnostics, sourceLabel) {
  const index = getIndexObject(content);
  if (!index) return false;
  const limits = getLimits();
  const textLimits = getTextLimits();

  const validation = getValidator().validateCmsIndexContent?.(index, mediaOptions);
  if (validation) {
    validation.errors?.forEach((message) => addWarning(diagnostics, `${sourceLabel}: ${message}`));
    validation.warnings?.forEach((message) => addWarning(diagnostics, `${sourceLabel}: ${message}`));
  }

  applySiteContactLayer(target.contact, content, diagnostics, sourceLabel);

  if (isPlainObject(index.hero)) {
    const hero = index.hero;
    applyText(target.hero, 'eyebrow', hero, ['eyebrow'], textLimits.eyebrow, diagnostics, `${sourceLabel}.index.hero`);
    applyText(target.hero, 'title', hero, ['title'], textLimits.title, diagnostics, `${sourceLabel}.index.hero`);
    applyText(target.hero, 'lead', hero, ['lead'], textLimits.lead, diagnostics, `${sourceLabel}.index.hero`);
    applyText(target.hero, 'recommendation', hero, ['recommendation'], textLimits.recommendation, diagnostics, `${sourceLabel}.index.hero`);

    const chipsSource = Array.isArray(hero.proofChips) ? hero.proofChips : hero.items;
    const chips = normalizeTextArray(chipsSource, limits.proofChips, textLimits.label, diagnostics, `${sourceLabel}.index.hero.${Array.isArray(hero.proofChips) ? 'proofChips' : 'items'}`);
    if (chips.length) target.hero.proofChips = chips;

    if (isPlainObject(hero.media)) {
      applyText(target.hero.media, 'caption', hero.media, ['caption'], textLimits.caption, diagnostics, `${sourceLabel}.index.hero.media`);
      const videoUrl = readText(hero.media, ['videoUrl', 'video_url'], textLimits.imageUrl, diagnostics, `${sourceLabel}.index.hero.media`);
      if (videoUrl) {
        if (isSafeMediaUrl(videoUrl, mediaOptions, VIDEO_EXTENSIONS)) target.hero.media.videoUrl = videoUrl;
        else addWarning(diagnostics, `${sourceLabel}.index.hero.media.videoUrl ignored by media policy.`);
      }
    }
  }

  if (isPlainObject(index.experience)) {
    const experience = index.experience;
    applyText(target.experience, 'kicker', experience, ['kicker', 'eyebrow'], textLimits.kicker, diagnostics, `${sourceLabel}.index.experience`);
    applyText(target.experience, 'title', experience, ['title'], textLimits.title, diagnostics, `${sourceLabel}.index.experience`);
    applyText(target.experience, 'lead', experience, ['lead'], textLimits.lead, diagnostics, `${sourceLabel}.index.experience`);
    const routeSource = Array.isArray(experience.routes) ? experience.routes : experience.items;
    const routes = normalizeRoutes(routeSource, diagnostics, `${sourceLabel}.index.experience.${Array.isArray(experience.routes) ? 'routes' : 'items'}`);
    if (routes.length) target.experience.routes = mergeObjectByKey(target.experience.routes, routes, 'room_key', limits.routes);
  }

  if (isPlainObject(index.guide)) {
    const guide = index.guide;
    applyText(target.guide, 'kicker', guide, ['kicker', 'eyebrow'], textLimits.kicker, diagnostics, `${sourceLabel}.index.guide`);
    applyText(target.guide, 'title', guide, ['title'], textLimits.title, diagnostics, `${sourceLabel}.index.guide`);
    applyText(target.guide, 'lead', guide, ['lead'], textLimits.lead, diagnostics, `${sourceLabel}.index.guide`);
    const stepSource = Array.isArray(guide.steps) ? guide.steps : guide.items;
    const steps = normalizeSteps(stepSource, diagnostics, `${sourceLabel}.index.guide.${Array.isArray(guide.steps) ? 'steps' : 'items'}`);
    if (steps.length) target.guide.steps = mergeObjectByKey(target.guide.steps, steps, 'number', limits.steps);
  }

  if (isPlainObject(index.contact)) {
    const contact = index.contact;
    applyText(target.contact, 'label', contact, ['label'], textLimits.label, diagnostics, `${sourceLabel}.index.contact`);
    applyText(target.contact, 'organizationName', contact, ['organizationName'], textLimits.organizationName, diagnostics, `${sourceLabel}.index.contact`);
    applyText(target.contact, 'address', contact, ['address'], textLimits.address, diagnostics, `${sourceLabel}.index.contact`);
    applyText(target.contact, 'phoneFax', contact, ['phoneFax'], textLimits.phoneFax, diagnostics, `${sourceLabel}.index.contact`);
  }

  const featured = isPlainObject(index.featuredArtworks)
    ? index.featuredArtworks
    : (isPlainObject(index.featured) ? index.featured : null);
  if (featured) {
    const featuredPath = `${sourceLabel}.index.${isPlainObject(index.featuredArtworks) ? 'featuredArtworks' : 'featured'}`;
    const enabledValue = [featured.enabled, featured.isVisible, featured.is_visible, featured.visible].find((value) => typeof value === 'boolean');
    if (typeof enabledValue === 'boolean') target.featuredArtworks.enabled = enabledValue;
    else if ([featured.enabled, featured.isVisible, featured.is_visible, featured.visible].some((value) => value !== undefined)) {
      addWarning(diagnostics, `${featuredPath}.enabled/isVisible ignored because it is not boolean.`);
    }
    applyText(target.featuredArtworks, 'kicker', featured, ['kicker', 'eyebrow'], textLimits.kicker, diagnostics, featuredPath);
    applyText(target.featuredArtworks, 'title', featured, ['title'], textLimits.title, diagnostics, featuredPath);
    applyText(target.featuredArtworks, 'exhibitionTitle', featured, ['exhibitionTitle'], textLimits.exhibitionTitle, diagnostics, featuredPath);
    applyText(target.featuredArtworks, 'lead', featured, ['lead'], textLimits.lead, diagnostics, featuredPath);

    if (featured.autoplayMs !== undefined) {
      const autoplayMs = Number(featured.autoplayMs);
      if (Number.isFinite(autoplayMs)) {
        target.featuredArtworks.autoplayMs = Math.min(limits.featuredAutoplayMax, Math.max(limits.featuredAutoplayMin, Math.round(autoplayMs)));
      } else {
        addWarning(diagnostics, `${featuredPath}.autoplayMs ignored because it is not numeric.`);
      }
    }

    if (featured.items !== undefined) {
      const items = normalizeFeaturedItems(
        featured.items,
        mediaOptions,
        diagnostics,
        `${featuredPath}.items`,
        target.featuredArtworks.items
      );
      target.featuredArtworks.items = items;
    }
  }

  return true;
}

export function normalizeCmsIndexContent(primaryContent, fallbackContent = null, options = {}) {
  const cms = options.cms || globalThis.cmsContentLoader;
  const mediaOptions = options.mediaOptions || getMediaOptions(cms, options.loaderOptions || {});
  const diagnostics = {
    errors: [],
    warnings: [],
    appliedSources: [],
    mediaRemoteEnabled: mediaOptions.allowRemoteMedia === true
  };
  const canonical = cloneDefaults();

  if (fallbackContent && applyIndexLayer(canonical, fallbackContent, mediaOptions, diagnostics, 'fallback')) {
    diagnostics.appliedSources.push('fallback');
  }
  if (primaryContent && primaryContent !== fallbackContent && applyIndexLayer(canonical, primaryContent, mediaOptions, diagnostics, 'primary')) {
    diagnostics.appliedSources.push('primary');
  }
  if (!primaryContent && !fallbackContent) addError(diagnostics, 'No usable CMS source was available; canonical safe defaults returned.');

  const visibleFeaturedCount = canonical.featuredArtworks.items.filter((item) => item.visible !== false).length;
  if (canonical.featuredArtworks.enabled && visibleFeaturedCount === 0) {
    canonical.featuredArtworks.enabled = false;
    addWarning(diagnostics, 'featuredArtworks.enabled was forced to false because no valid visible items remain.');
  }

  return { index: canonical, diagnostics, mediaOptions };
}

export async function loadNormalizedIndexCmsContent(cms, options = {}) {
  const loaderOptions = getIndexCmsLoaderOptions(options);
  if (!cms) return normalizeCmsIndexContent(null, null, { cms, loaderOptions });

  if (typeof cms.loadCmsContentSources === 'function') {
    const sources = await cms.loadCmsContentSources(loaderOptions);
    const result = normalizeCmsIndexContent(sources.remoteContent, sources.fallbackContent, {
      cms,
      loaderOptions: sources.config || options,
      mediaOptions: cms.getCmsMediaValidationOptions?.(sources.config || options)
    });
    return {
      ...result,
      source: sources.source,
      remoteStatus: sources.remoteStatus,
      fallbackStatus: sources.fallbackStatus,
      validation: {
        remote: sources.remoteValidation || null,
        fallback: sources.fallbackValidation || null
      }
    };
  }

  const selected = typeof cms.loadCmsContent === 'function' ? await cms.loadCmsContent(loaderOptions) : null;
  const result = normalizeCmsIndexContent(selected, null, { cms, loaderOptions });
  return { ...result, source: cms.getCmsSource?.() || (selected ? 'selected' : 'legacy') };
}

export { DEFAULT_INDEX_CONTENT, DEFAULT_INDEX_CMS_LOADER_OPTIONS, getIndexCmsLoaderOptions };
