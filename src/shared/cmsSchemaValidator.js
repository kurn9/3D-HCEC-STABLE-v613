// v6.14.038 — Canonical CMS source-of-truth schema/media validator and legacy alias normalizer.
// Dependency-free; safe to load as a classic script or ES module.
(function initCmsSchemaValidator(global) {
  if (global.cmsSchemaValidator) return;

  const SAFE_RELATIVE_MEDIA_PREFIXES = ['./assets/', 'assets/', '/assets/'];
  const UNSAFE_TEXT_PATTERN = /<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
  const HTML_TAG_PATTERN = /<[^>]+>/g;
  const BLOCKED_MEDIA_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:']);
  const SIGNED_QUERY_PATTERN = /token|expires|signature|x-amz|jwt/i;

  const INDEX_LIMITS = Object.freeze({
    proofChips: 6,
    routes: 4,
    steps: 6,
    featuredItems: 12,
    featuredAutoplayMin: 3600,
    featuredAutoplayMax: 5600
  });

  const INDEX_TEXT_LIMITS = Object.freeze({
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
  });

  const CANONICAL_CMS_SCHEMA_VERSION = 1;
  const ROOM_MEDIA_ALIAS_FIELDS = Object.freeze([
    'imageUrl', 'image', 'image_url', 'src', 'url', 'mediaUrl', 'media_url',
    'thumbnailUrl', 'thumbnail', 'thumbnail_url',
    'posterUrl', 'poster', 'poster_url',
    'videoUrl', 'video', 'video_url', 'contentUrl', 'content_url',
    'audioUrl', 'audio_url'
  ]);
  const FEATURED_IMAGE_ALIAS_FIELDS = Object.freeze([
    'imageUrl', 'image', 'image_url', 'src', 'url', 'thumbnailUrl', 'thumbnail',
    'thumbnail_url', 'posterUrl', 'poster', 'poster_url', 'mediaUrl', 'media_url'
  ]);
  const VIDEO_MEDIA_PATTERN = /\.(mp4|webm|ogg|ogv|mov|m4v)(?:[?#]|$)/i;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function truncateText(value, maxLength = 0) {
    const text = String(value || '');
    const limit = Number(maxLength || 0);
    if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return text;
    return text.slice(0, limit).trim();
  }

  function sanitizeText(value, fallback = '', maxLength = 0) {
    if (value === null || value === undefined) return truncateText(fallback, maxLength);
    const text = String(value)
      .replace(UNSAFE_TEXT_PATTERN, '')
      .replace(HTML_TAG_PATTERN, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim();
    return truncateText(text || fallback, maxLength);
  }

  function sanitizeTextArray(value, options = {}) {
    if (!Array.isArray(value)) return [];
    const maxItems = Math.max(0, Number(options.maxItems || value.length));
    const maxLength = Math.max(0, Number(options.maxLength || 0));
    return value
      .slice(0, maxItems || value.length)
      .map((item) => sanitizeText(item, '', maxLength))
      .filter(Boolean);
  }

  function normalizeStringList(value, options = {}) {
    if (Array.isArray(value)) return sanitizeTextArray(value, options);
    if (typeof value === 'string' && value.trim()) {
      return sanitizeTextArray(value.split(','), options);
    }
    return [];
  }

  function normalizeAllowList(value) {
    if (Array.isArray(value)) return value.map((item) => sanitizeText(item)).filter(Boolean);
    const one = sanitizeText(value);
    return one ? [one] : [];
  }

  function normalizeCmsItemId(item, fallback = '') {
    const raw = isPlainObject(item)
      ? (item.artwork_code || item.artworkCode || item.artwork_id || item.artworkId || item.id || item.code || fallback)
      : fallback;
    return sanitizeText(raw).toUpperCase();
  }

  function cloneJsonSafe(value) {
    try { return JSON.parse(JSON.stringify(value || {})); } catch { return {}; }
  }

  function firstUsableValue(source, keys) {
    if (!isPlainObject(source)) return '';
    for (const key of keys) {
      const value = source[key];
      if (value === null || value === undefined) continue;
      if (typeof value === 'string' && !value.trim()) continue;
      return value;
    }
    return '';
  }

  function isVideoLike(value, source = {}) {
    const mediaType = sanitizeText(source.mediaType || source.media_type || source.kind || source.type).toLowerCase();
    return mediaType === 'video' || VIDEO_MEDIA_PATTERN.test(sanitizeText(value));
  }

  function normalizeVisibilityAlias(source, fallback = true) {
    for (const key of ['isVisible', 'is_visible', 'visible', 'enabled']) {
      if (typeof source?.[key] === 'boolean') return source[key];
    }
    return fallback;
  }

  function normalizeOrderAlias(source, fallback = null) {
    const raw = firstUsableValue(source, ['sortOrder', 'sort_order', 'order']);
    if (raw === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  function dropLegacyMediaAliases(target, kind = 'room') {
    const aliases = kind === 'featured'
      ? ['image', 'image_url', 'src', 'url', 'mediaUrl', 'media_url', 'thumbnail', 'thumbnail_url', 'poster', 'poster_url', 'video', 'video_url', 'contentUrl', 'content_url', 'is_visible', 'visible', 'enabled', 'sort_order', 'order']
      : ['image', 'image_url', 'src', 'url', 'mediaUrl', 'media_url', 'thumbnail', 'thumbnail_url', 'poster', 'poster_url', 'video', 'video_url', 'contentUrl', 'content_url', 'is_visible', 'visible', 'enabled', 'sort_order', 'order'];
    aliases.forEach((key) => { delete target[key]; });
    return target;
  }

  function normalizeCmsArtworkAliases(item, fallbackKey = '', options = {}) {
    if (!isPlainObject(item)) return null;
    const out = cloneJsonSafe(item);
    const id = normalizeCmsItemId(item, fallbackKey);
    if (id) {
      out.id = id;
      out.artwork_code = sanitizeText(item.artwork_code || item.artworkCode || id).toUpperCase();
    }

    const imageValue = firstUsableValue(item, ['imageUrl', 'image', 'image_url']);
    const genericMedia = firstUsableValue(item, ['src', 'url', 'mediaUrl', 'media_url']);
    const directVideo = firstUsableValue(item, ['videoUrl', 'video', 'video_url', 'contentUrl', 'content_url']);
    const poster = firstUsableValue(item, ['posterUrl', 'poster', 'poster_url']);
    const thumbnail = firstUsableValue(item, ['thumbnailUrl', 'thumbnail', 'thumbnail_url']);
    if (directVideo) out.videoUrl = sanitizeText(directVideo, '', INDEX_TEXT_LIMITS.imageUrl);
    if (imageValue) out.imageUrl = sanitizeText(imageValue, '', INDEX_TEXT_LIMITS.imageUrl);
    if (genericMedia) {
      const clean = sanitizeText(genericMedia, '', INDEX_TEXT_LIMITS.imageUrl);
      if (isVideoLike(clean, item)) out.videoUrl = out.videoUrl || clean;
      else out.imageUrl = out.imageUrl || clean;
    }
    if (poster) out.posterUrl = sanitizeText(poster, '', INDEX_TEXT_LIMITS.imageUrl);
    if (thumbnail) out.thumbnailUrl = sanitizeText(thumbnail, '', INDEX_TEXT_LIMITS.imageUrl);
    if (!out.title && item.name) out.title = sanitizeText(item.name, '', INDEX_TEXT_LIMITS.title);
    if (!out.description && (item.caption || item.desc)) out.description = sanitizeText(item.caption || item.desc, '', INDEX_TEXT_LIMITS.description);
    if (!out.alt && (out.title || item.title || item.name)) out.alt = sanitizeText(out.title || item.title || item.name, '', INDEX_TEXT_LIMITS.alt);
    out.isVisible = normalizeVisibilityAlias(item, true);
    const order = normalizeOrderAlias(item, options.fallbackOrder ?? null);
    if (order !== null) out.sortOrder = order;
    if (options.dropLegacyAliases === true) dropLegacyMediaAliases(out, 'room');
    return out;
  }

  function normalizeFeaturedItemAliases(item, index = 0, options = {}) {
    if (!isPlainObject(item)) return null;
    const out = cloneJsonSafe(item);
    const id = sanitizeText(item.id || item.code || item.artworkId || item.artwork_id || `featured_${index + 1}`, '', INDEX_TEXT_LIMITS.id);
    if (id) out.id = id;
    const image = firstUsableValue(item, FEATURED_IMAGE_ALIAS_FIELDS);
    const poster = firstUsableValue(item, ['posterUrl', 'poster', 'poster_url']);
    const thumbnail = firstUsableValue(item, ['thumbnailUrl', 'thumbnail', 'thumbnail_url']);
    const video = firstUsableValue(item, ['videoUrl', 'video', 'video_url', 'contentUrl', 'content_url']);
    if (image) out.imageUrl = sanitizeText(image, '', INDEX_TEXT_LIMITS.imageUrl);
    if (poster) out.posterUrl = sanitizeText(poster, '', INDEX_TEXT_LIMITS.imageUrl);
    if (thumbnail) out.thumbnailUrl = sanitizeText(thumbnail, '', INDEX_TEXT_LIMITS.imageUrl);
    if (video) out.videoUrl = sanitizeText(video, '', INDEX_TEXT_LIMITS.imageUrl);
    if (!out.title && item.name) out.title = sanitizeText(item.name, '', INDEX_TEXT_LIMITS.title);
    if (!out.description && (item.caption || item.desc)) out.description = sanitizeText(item.caption || item.desc, '', INDEX_TEXT_LIMITS.description);
    out.isVisible = normalizeVisibilityAlias(item, true);
    const order = normalizeOrderAlias(item, index + 1);
    if (order !== null) out.sortOrder = order;
    if (options.dropLegacyAliases === true) dropLegacyMediaAliases(out, 'featured');
    return out;
  }

  function normalizeCmsRoomContent(roomContent, options = {}) {
    const room = isPlainObject(roomContent) ? cloneJsonSafe(roomContent) : {};
    const map = new Map();
    if (isPlainObject(room.items)) {
      Object.entries(room.items).forEach(([key, value], index) => {
        const normalized = normalizeCmsArtworkAliases(value, key, { fallbackOrder: index + 1, dropLegacyAliases: options.dropLegacyAliases === true });
        if (normalized?.id) map.set(normalized.id, normalized);
      });
    }
    if (Array.isArray(room.artworks)) {
      room.artworks.forEach((value, index) => {
        const normalized = normalizeCmsArtworkAliases(value, '', { fallbackOrder: index + 1, dropLegacyAliases: options.dropLegacyAliases === true });
        if (normalized?.id) map.set(normalized.id, normalized);
      });
    }
    room.artworks = Array.from(map.values());
    if (options.keepLegacyRoomItems !== true) delete room.items;
    return room;
  }

  function normalizeCmsContentDocument(content, options = {}) {
    const out = isPlainObject(content) ? cloneJsonSafe(content) : {};
    if (!Number.isFinite(Number(out.schemaVersion))) out.schemaVersion = CANONICAL_CMS_SCHEMA_VERSION;
    if (isPlainObject(out.rooms)) {
      Object.keys(out.rooms).forEach((roomKey) => {
        out.rooms[roomKey] = normalizeCmsRoomContent(out.rooms[roomKey], options);
      });
    }
    if (isPlainObject(out.index)) {
      if (!isPlainObject(out.index.featuredArtworks) && isPlainObject(out.index.featured)) {
        out.index.featuredArtworks = cloneJsonSafe(out.index.featured);
      }
      if (isPlainObject(out.index.featuredArtworks)) {
        const featured = out.index.featuredArtworks;
        if (typeof featured.enabled !== 'boolean') {
          const enabledAlias = [featured.isVisible, featured.is_visible, featured.visible].find((value) => typeof value === 'boolean');
          if (typeof enabledAlias === 'boolean') featured.enabled = enabledAlias;
        }
        if (Array.isArray(featured.items)) {
          featured.items = featured.items.map((item, index) => normalizeFeaturedItemAliases(item, index, { dropLegacyAliases: options.dropLegacyAliases === true })).filter(Boolean);
        }
        if (options.dropLegacyAliases === true) {
          delete featured.isVisible;
          delete featured.is_visible;
          delete featured.visible;
        }
        if (options.keepLegacyFeaturedAlias !== true) delete out.index.featured;
      }
    }
    return out;
  }

  function getHostnameFromAllowEntry(entry) {
    const text = sanitizeText(entry).toLowerCase();
    if (!text) return '';
    try {
      return new URL(text.includes('://') ? text : `https://${text}`).hostname.toLowerCase();
    } catch {
      return text.replace(/^\.+/, '').split('/')[0].toLowerCase();
    }
  }

  function isHostAllowed(hostname, allowedHosts) {
    const host = sanitizeText(hostname).toLowerCase();
    if (!host) return false;
    return normalizeAllowList(allowedHosts).some((entry) => {
      const normalized = getHostnameFromAllowEntry(entry);
      const raw = sanitizeText(entry).toLowerCase();
      if (!normalized) return false;
      if (host === normalized) return true;
      return raw.startsWith('*.') && host.endsWith(`.${normalized}`);
    });
  }

  function isOriginAllowed(origin, allowedOrigins) {
    const target = sanitizeText(origin).toLowerCase();
    if (!target) return false;
    return normalizeAllowList(allowedOrigins).some((entry) => {
      try {
        const parsed = new URL(entry.includes('://') ? entry : `https://${entry}`);
        return parsed.origin.toLowerCase() === target;
      } catch {
        return sanitizeText(entry).toLowerCase() === target;
      }
    });
  }

  function isPathAllowed(pathname, allowedPathPrefixes) {
    const prefixes = normalizeAllowList(allowedPathPrefixes);
    if (!prefixes.length) return true;
    return prefixes.some((prefix) => String(pathname || '').startsWith(prefix));
  }

  function getPathExtension(pathname) {
    const match = String(pathname || '').toLowerCase().match(/\.([a-z0-9]+)$/i);
    return match?.[1] || '';
  }

  function isExtensionAllowed(pathname, allowedMediaExtensions) {
    const extensions = normalizeAllowList(allowedMediaExtensions)
      .map((extension) => extension.toLowerCase().replace(/^\./, ''))
      .filter(Boolean);
    if (!extensions.length) return true;
    return extensions.includes(getPathExtension(pathname));
  }

  function isRelativeMediaUrl(url) {
    if (!url || url.startsWith('//') || url.includes('..') || url.includes('\\')) return false;
    return SAFE_RELATIVE_MEDIA_PREFIXES.some((prefix) => url.startsWith(prefix));
  }

  function getRelativePathname(url) {
    return String(url || '').split(/[?#]/, 1)[0];
  }

  function isSafeMediaUrl(value, options = {}) {
    const url = sanitizeText(value, '', INDEX_TEXT_LIMITS.imageUrl);
    if (!url) return false;
    const lower = url.toLowerCase();
    if ([...BLOCKED_MEDIA_PROTOCOLS].some((protocol) => lower.startsWith(protocol))) return false;

    if (isRelativeMediaUrl(url)) {
      return isExtensionAllowed(getRelativePathname(url), options.allowedMediaExtensions);
    }

    if (options.allowRemoteMedia !== true) return false;

    try {
      const parsed = new URL(url, global.location?.href || 'https://example.invalid/');
      const protocol = parsed.protocol.toLowerCase();
      if (protocol !== 'https:' && !(protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname))) return false;

      const allowedOrigins = normalizeAllowList(options.allowedMediaOrigins);
      const allowedHosts = normalizeAllowList(options.allowedMediaHosts);
      const originAllowed = allowedOrigins.length ? isOriginAllowed(parsed.origin, allowedOrigins) : false;
      const hostAllowed = allowedHosts.length ? isHostAllowed(parsed.hostname, allowedHosts) : false;
      if (!originAllowed && !hostAllowed) return false;
      if (!isPathAllowed(parsed.pathname, options.allowedMediaPathPrefixes)) return false;
      if (!isExtensionAllowed(parsed.pathname, options.allowedMediaExtensions)) return false;
      if (options.disallowSignedMediaUrls === true) {
        const hasSuspiciousQuery = Array.from(parsed.searchParams.keys()).some((key) => SIGNED_QUERY_PATTERN.test(key));
        if (hasSuspiciousQuery) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function pushTextValidation(target, path, value, maxLength) {
    if (value === undefined || value === null) return;
    if (typeof value !== 'string') {
      target.errors.push(`${path} must be a string.`);
      return;
    }
    const trimmed = value.trim();
    if (trimmed !== value) target.warnings.push(`${path} contains leading/trailing whitespace and will be trimmed.`);
    if (HTML_TAG_PATTERN.test(value)) target.warnings.push(`${path} contains HTML and will be sanitized as plain text.`);
    HTML_TAG_PATTERN.lastIndex = 0;
    if (trimmed.length > maxLength) target.warnings.push(`${path} exceeds ${maxLength} characters and will be truncated.`);
  }

  function validateObjectSection(indexContent, sectionKey, result) {
    if (indexContent[sectionKey] !== undefined && !isPlainObject(indexContent[sectionKey])) {
      result.errors.push(`index.${sectionKey} must be an object.`);
      return null;
    }
    return isPlainObject(indexContent[sectionKey]) ? indexContent[sectionKey] : null;
  }

  function validateArrayField(section, fieldName, aliasName, maxItems, result, path) {
    const canonical = section?.[fieldName];
    const alias = section?.[aliasName];
    const selected = canonical !== undefined ? canonical : alias;
    if (selected === undefined) return null;
    if (!Array.isArray(selected)) {
      result.errors.push(`${path}.${canonical !== undefined ? fieldName : aliasName} must be an array.`);
      return null;
    }
    if (selected.length > maxItems) result.warnings.push(`${path}.${canonical !== undefined ? fieldName : aliasName} exceeds ${maxItems} items and will be capped.`);
    return selected;
  }

  function validateCmsIndexContent(indexContent, options = {}) {
    const result = { valid: true, errors: [], warnings: [] };
    if (indexContent === undefined || indexContent === null) return result;
    if (!isPlainObject(indexContent)) {
      return { valid: false, errors: ['index must be an object.'], warnings: [] };
    }

    const hero = validateObjectSection(indexContent, 'hero', result);
    const experience = validateObjectSection(indexContent, 'experience', result);
    const guide = validateObjectSection(indexContent, 'guide', result);
    const contact = validateObjectSection(indexContent, 'contact', result);
    const featured = indexContent.featuredArtworks !== undefined
      ? validateObjectSection(indexContent, 'featuredArtworks', result)
      : validateObjectSection(indexContent, 'featured', result);
    if (options.requireIndexFeatured === true && !featured) {
      result.errors.push('index.featuredArtworks is required by the canonical CMS contract.');
    }

    if (hero) {
      pushTextValidation(result, 'index.hero.eyebrow', hero.eyebrow, INDEX_TEXT_LIMITS.eyebrow);
      pushTextValidation(result, 'index.hero.title', hero.title, INDEX_TEXT_LIMITS.title);
      pushTextValidation(result, 'index.hero.lead', hero.lead, INDEX_TEXT_LIMITS.lead);
      pushTextValidation(result, 'index.hero.recommendation', hero.recommendation, INDEX_TEXT_LIMITS.recommendation);
      const chips = validateArrayField(hero, 'proofChips', 'items', INDEX_LIMITS.proofChips, result, 'index.hero');
      chips?.forEach((item, index) => pushTextValidation(result, `index.hero.proofChips[${index}]`, item, INDEX_TEXT_LIMITS.label));
      if (hero.media !== undefined && !isPlainObject(hero.media)) {
        result.errors.push('index.hero.media must be an object.');
      } else if (isPlainObject(hero.media)) {
        pushTextValidation(result, 'index.hero.media.caption', hero.media.caption, INDEX_TEXT_LIMITS.caption);
        if (hero.media.videoUrl !== undefined) {
          pushTextValidation(result, 'index.hero.media.videoUrl', hero.media.videoUrl, INDEX_TEXT_LIMITS.imageUrl);
          if (typeof hero.media.videoUrl === 'string' && hero.media.videoUrl.trim() && !isSafeMediaUrl(hero.media.videoUrl, {
            ...options,
            allowedMediaExtensions: ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v']
          })) {
            result.errors.push('index.hero.media.videoUrl is not allowed by the media policy.');
          }
        }
      }
    }

    if (experience) {
      pushTextValidation(result, 'index.experience.kicker', experience.kicker ?? experience.eyebrow, INDEX_TEXT_LIMITS.kicker);
      pushTextValidation(result, 'index.experience.title', experience.title, INDEX_TEXT_LIMITS.title);
      pushTextValidation(result, 'index.experience.lead', experience.lead, INDEX_TEXT_LIMITS.lead);
      const routes = validateArrayField(experience, 'routes', 'items', INDEX_LIMITS.routes, result, 'index.experience');
      routes?.forEach((item, index) => {
        if (!isPlainObject(item)) {
          result.errors.push(`index.experience.routes[${index}] must be an object.`);
          return;
        }
        pushTextValidation(result, `index.experience.routes[${index}].room_key`, item.room_key ?? item.roomKey, INDEX_TEXT_LIMITS.room);
        pushTextValidation(result, `index.experience.routes[${index}].label`, item.label, INDEX_TEXT_LIMITS.label);
        pushTextValidation(result, `index.experience.routes[${index}].title`, item.title, INDEX_TEXT_LIMITS.title);
        pushTextValidation(result, `index.experience.routes[${index}].description`, item.description, INDEX_TEXT_LIMITS.description);
        pushTextValidation(result, `index.experience.routes[${index}].ctaLabel`, item.ctaLabel, INDEX_TEXT_LIMITS.ctaLabel);
      });
    }

    if (guide) {
      pushTextValidation(result, 'index.guide.kicker', guide.kicker ?? guide.eyebrow, INDEX_TEXT_LIMITS.kicker);
      pushTextValidation(result, 'index.guide.title', guide.title, INDEX_TEXT_LIMITS.title);
      pushTextValidation(result, 'index.guide.lead', guide.lead, INDEX_TEXT_LIMITS.lead);
      const steps = validateArrayField(guide, 'steps', 'items', INDEX_LIMITS.steps, result, 'index.guide');
      steps?.forEach((item, index) => {
        if (!isPlainObject(item)) {
          result.errors.push(`index.guide.steps[${index}] must be an object.`);
          return;
        }
        pushTextValidation(result, `index.guide.steps[${index}].number`, item.number, INDEX_TEXT_LIMITS.number);
        pushTextValidation(result, `index.guide.steps[${index}].title`, item.title, INDEX_TEXT_LIMITS.title);
        pushTextValidation(result, `index.guide.steps[${index}].description`, item.description, INDEX_TEXT_LIMITS.description);
      });
    }

    if (contact) {
      pushTextValidation(result, 'index.contact.label', contact.label, INDEX_TEXT_LIMITS.label);
      pushTextValidation(result, 'index.contact.organizationName', contact.organizationName, INDEX_TEXT_LIMITS.organizationName);
      pushTextValidation(result, 'index.contact.address', contact.address, INDEX_TEXT_LIMITS.address);
      pushTextValidation(result, 'index.contact.phoneFax', contact.phoneFax, INDEX_TEXT_LIMITS.phoneFax);
    }

    if (featured) {
      const featuredPath = indexContent.featuredArtworks !== undefined ? 'index.featuredArtworks' : 'index.featured';
      if (featured.enabled !== undefined && typeof featured.enabled !== 'boolean') result.errors.push(`${featuredPath}.enabled must be a boolean.`);
      pushTextValidation(result, `${featuredPath}.kicker`, featured.kicker ?? featured.eyebrow, INDEX_TEXT_LIMITS.kicker);
      pushTextValidation(result, `${featuredPath}.title`, featured.title, INDEX_TEXT_LIMITS.title);
      pushTextValidation(result, `${featuredPath}.exhibitionTitle`, featured.exhibitionTitle, INDEX_TEXT_LIMITS.exhibitionTitle);
      pushTextValidation(result, `${featuredPath}.lead`, featured.lead, INDEX_TEXT_LIMITS.lead);
      if (featured.autoplayMs !== undefined) {
        const autoplayMs = Number(featured.autoplayMs);
        if (!Number.isFinite(autoplayMs)) result.errors.push(`${featuredPath}.autoplayMs must be a finite number.`);
        else if (autoplayMs < INDEX_LIMITS.featuredAutoplayMin || autoplayMs > INDEX_LIMITS.featuredAutoplayMax) {
          result.warnings.push(`${featuredPath}.autoplayMs will be clamped to ${INDEX_LIMITS.featuredAutoplayMin}-${INDEX_LIMITS.featuredAutoplayMax}ms.`);
        }
      }
      if (featured.items !== undefined && !Array.isArray(featured.items)) {
        result.errors.push(`${featuredPath}.items must be an array.`);
      } else if (featured.enabled === true && !Array.isArray(featured.items)) {
        result.errors.push(`${featuredPath}.items is required when Featured is enabled.`);
      } else if (Array.isArray(featured.items)) {
        if (featured.enabled === true && featured.items.length === 0) result.errors.push(`${featuredPath}.items must contain at least one item when enabled.`);
        if (featured.items.length > INDEX_LIMITS.featuredItems) result.warnings.push(`${featuredPath}.items exceeds ${INDEX_LIMITS.featuredItems} items and will be capped.`);
        const seenIds = new Set();
        featured.items.slice(0, INDEX_LIMITS.featuredItems).forEach((item, index) => {
          if (!isPlainObject(item)) {
            result.errors.push(`${featuredPath}.items[${index}] must be an object.`);
            return;
          }
          const id = sanitizeText(item.id || item.code || item.artworkId || item.artwork_id, '', INDEX_TEXT_LIMITS.id);
          const visible = normalizeVisibilityAlias(item, true);
          if (!id) result.errors.push(`${featuredPath}.items[${index}].id is required.`);
          else if (seenIds.has(id)) result.errors.push(`${featuredPath}.items[${index}].id duplicates "${id}".`);
          else seenIds.add(id);

          pushTextValidation(result, `${featuredPath}.items[${index}].title`, item.title ?? item.name, INDEX_TEXT_LIMITS.title);
          pushTextValidation(result, `${featuredPath}.items[${index}].subtitle`, item.subtitle, INDEX_TEXT_LIMITS.subtitle);
          pushTextValidation(result, `${featuredPath}.items[${index}].description`, item.description ?? item.caption, INDEX_TEXT_LIMITS.description);
          pushTextValidation(result, `${featuredPath}.items[${index}].alt`, item.alt, INDEX_TEXT_LIMITS.alt);
          pushTextValidation(result, `${featuredPath}.items[${index}].room`, item.room, INDEX_TEXT_LIMITS.room);
          pushTextValidation(result, `${featuredPath}.items[${index}].artworkId`, item.artworkId ?? item.artwork_id, INDEX_TEXT_LIMITS.artworkId);
          pushTextValidation(result, `${featuredPath}.items[${index}].ctaLabel`, item.ctaLabel, INDEX_TEXT_LIMITS.ctaLabel);

          const title = sanitizeText(item.title || item.name, '', INDEX_TEXT_LIMITS.title);
          const imageUrl = sanitizeText(firstUsableValue(item, FEATURED_IMAGE_ALIAS_FIELDS), '', INDEX_TEXT_LIMITS.imageUrl);
          const allowItemFallback = options.allowFeaturedItemFallback === true;
          if (visible && !title) {
            (allowItemFallback ? result.warnings : result.errors).push(`${featuredPath}.items[${index}].title is required when visible.`);
          }
          if (visible && !imageUrl) {
            (allowItemFallback ? result.warnings : result.errors).push(`${featuredPath}.items[${index}].imageUrl is required when visible.`);
          }
          if (imageUrl && !isSafeMediaUrl(imageUrl, {
            ...options,
            allowedMediaExtensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']
          })) {
            (allowItemFallback ? result.warnings : result.errors).push(`${featuredPath}.items[${index}].imageUrl is not allowed by the media policy.`);
          }
          const order = firstUsableValue(item, ['sortOrder', 'sort_order', 'order']);
          if (order !== '' && !Number.isFinite(Number(order))) result.errors.push(`${featuredPath}.items[${index}].sortOrder/order must be numeric.`);
          if (visible && title && !sanitizeText(item.alt)) result.warnings.push(`${featuredPath}.items[${index}].alt is missing and will fall back to title.`);
        });
      }
    }

    result.valid = result.errors.length === 0;
    return result;
  }

  function validateCmsContent(content, options = {}) {
    const errors = [];
    const warnings = [];

    if (!isPlainObject(content)) {
      return { valid: false, errors: ['Root CMS content must be an object.'], warnings };
    }

    if (options.requireCanonicalDocument === true) {
      if (!Number.isFinite(Number(content.schemaVersion)) || Number(content.schemaVersion) <= 0) errors.push('schemaVersion must be a positive number.');
      if (!sanitizeText(content.version)) errors.push('version is required by the canonical CMS contract.');
      if (!sanitizeText(content.source)) errors.push('source is required by the canonical CMS contract.');
    } else if (!Number.isFinite(Number(content.schemaVersion)) && !sanitizeText(content.version)) {
      warnings.push('Missing schemaVersion/version; accepting only in backward-compatible runtime mode.');
    }

    if (!isPlainObject(content.rooms)) {
      errors.push('Missing rooms object.');
    } else {
      Object.entries(content.rooms).forEach(([roomKey, room]) => {
        if (!isPlainObject(room)) {
          errors.push(`rooms.${roomKey} must be an object.`);
          return;
        }

        if (options.requireCanonicalRooms === true && !Array.isArray(room.artworks)) {
          errors.push(`rooms.${roomKey}.artworks must be the canonical array.`);
        } else if (room.artworks !== undefined && !Array.isArray(room.artworks)) {
          errors.push(`rooms.${roomKey}.artworks must be an array.`);
        }
        if (options.requireCanonicalRooms === true && room.items !== undefined) {
          errors.push(`rooms.${roomKey}.items is legacy input and must be normalized to artworks[] before publish.`);
        }

        const normalizedRoom = normalizeCmsRoomContent(room, { keepLegacyRoomItems: false });
        const seenIds = new Set();
        normalizedRoom.artworks.forEach((artwork, index) => {
          if (!isPlainObject(artwork)) {
            errors.push(`rooms.${roomKey}.artworks[${index}] must be an object.`);
            return;
          }
          const id = normalizeCmsItemId(artwork);
          if (!id) errors.push(`rooms.${roomKey}.artworks[${index}] is missing artwork_code/id/code.`);
          else if (seenIds.has(id)) errors.push(`rooms.${roomKey}.artworks[${index}] duplicates "${id}".`);
          else seenIds.add(id);

          ROOM_MEDIA_ALIAS_FIELDS.forEach((fieldName) => {
            const value = artwork[fieldName];
            if (value === null || value === undefined || sanitizeText(value) === '') return;
            const mediaValid = isSafeMediaUrl(value, options);
            if (!mediaValid) {
              const target = options.strictRoomMedia === true ? errors : warnings;
              target.push(`rooms.${roomKey}.artworks[${index}].${fieldName} is not allowed by the media policy.`);
            }
          });
        });

        if (room.artworks === undefined && room.items === undefined) {
          warnings.push(`rooms.${roomKey} has no artworks[] or items{} content.`);
        }
      });
    }

    if (content.gate !== undefined && !isPlainObject(content.gate)) warnings.push('gate should be an object.');
    if (content.index !== undefined && !isPlainObject(content.index)) {
      (options.strictIndexContract === true ? errors : warnings).push('index should be an object.');
    }
    if (options.requireIndexFeatured === true && !isPlainObject(content.index)) errors.push('index object is required by the canonical CMS contract.');
    if (content.site !== undefined && !isPlainObject(content.site)) warnings.push('site should be an object.');

    if (isPlainObject(content.index)) {
      const indexValidation = validateCmsIndexContent(content.index, options);
      const strictIndex = options.strictIndexContract === true || options.requireIndexFeatured === true;
      indexValidation.errors.forEach((message) => (strictIndex ? errors : warnings).push(`Index contract: ${message}`));
      indexValidation.warnings.forEach((message) => warnings.push(`Index contract: ${message}`));
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  global.cmsSchemaValidator = {
    validateCmsContent,
    validateCmsIndexContent,
    sanitizeText,
    sanitizeTextArray,
    normalizeStringList,
    isPlainObject,
    isSafeMediaUrl,
    normalizeCmsItemId,
    normalizeCmsArtworkAliases,
    normalizeFeaturedItemAliases,
    normalizeCmsRoomContent,
    normalizeCmsContentDocument,
    CANONICAL_CMS_SCHEMA_VERSION,
    ROOM_MEDIA_ALIAS_FIELDS: [...ROOM_MEDIA_ALIAS_FIELDS],
    FEATURED_IMAGE_ALIAS_FIELDS: [...FEATURED_IMAGE_ALIAS_FIELDS],
    INDEX_LIMITS,
    INDEX_TEXT_LIMITS,
    SAFE_RELATIVE_MEDIA_PREFIXES: [...SAFE_RELATIVE_MEDIA_PREFIXES]
  };
})(typeof window !== 'undefined' ? window : globalThis);
