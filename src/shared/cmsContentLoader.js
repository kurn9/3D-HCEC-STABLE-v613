// V6.11.21-B6-F_K_O_I_B — Safe CMS content loader with media/text override and schema compatibility.
// No upload/admin integration here; this is a frontend content layer with local/legacy fallback.
(function initCmsContentLoader(global) {
  if (global.cmsContentLoader) return;

  const DEFAULT_CONFIG = {
    enabled: true,
    remoteEnabled: false,
    remoteUrl: '',
    fallbackUrl: './data/cms_content_fallback.json',
    timeoutMs: 1200,
    galleryTimeoutMs: 1600,
    debug: false,
    debugMerge: false,
    allowRemoteMedia: false,
    allowedMediaOrigins: [],
    allowedMediaHosts: [],
    allowedMediaPathPrefixes: [],
    allowCmsMediaOverride: true,
    allowCmsTextOverride: true,
    protectSceneLayout: true
  };

  const TECHNICAL_FORBIDDEN_FIELDS = new Set([
    'id', 'type', 'position', 'rotation', 'size', 'scale', 'group', 'frame', 'transparent',
    'clickable', 'collider', 'physics', 'room', 'mesh', 'object3D', 'geometry',
    'materialConfig', 'materialRuntime', 'renderConfig', 'fitMode', 'autoplay', 'muted',
    'loop', 'controls', 'roomUrl', 'sceneJsonUrl', 'lighting', 'avatar', 'collision', 'camera'
  ]);

  const FIELD_MAP = {
    title: 'title',
    name: 'title',
    subtitle: 'subtitle',
    artist: 'author',
    author: 'author',
    year: 'year',
    material: 'material',
    medium: 'material',
    real_size: 'realSize',
    realSize: 'realSize',
    description: 'description',
    desc: 'description',
    content: 'content',
    note: 'note',
    text: 'text',

    image_url: 'image',
    imageUrl: 'image',
    image: 'image',
    thumbnail_url: 'thumbnail',
    thumbnailUrl: 'thumbnail',
    thumbnail: 'thumbnail',
    poster_url: 'poster',
    posterUrl: 'poster',
    poster: 'poster',
    video_url: 'videoUrl',
    videoUrl: 'videoUrl',
    video: 'videoUrl',
    media_url: 'mediaUrl',
    mediaUrl: 'mediaUrl',
    content_url: 'videoUrl',
    contentUrl: 'videoUrl',
    audio_url: 'audioUrl',
    audioUrl: 'audioUrl',

    category: 'category',
    tags: 'tags',
    is_visible: 'cmsVisible',
    visible: 'cmsVisible',
    is_featured: 'isFeatured',
    featured: 'isFeatured',
    sort_order: 'cmsSortOrder',
    sortOrder: 'cmsSortOrder'
  };

  const MEDIA_FIELDS = new Set(['image', 'thumbnail', 'videoUrl', 'poster', 'audioUrl']);
  const TEXT_FIELDS = new Set([
    'title', 'subtitle', 'author', 'year', 'material', 'realSize',
    'description', 'content', 'note', 'text', 'category'
  ]);
  const VIDEO_EXTENSION_PATTERN = /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i;

  let cachedContent = null;
  let cachedSource = 'none';
  let cachedValidation = null;
  let loadPromise = null;
  let contentSourcesCache = null;
  let contentSourcesPromise = null;

  function getValidator() {
    return global.cmsSchemaValidator || {};
  }

  function sanitizeText(value, fallback = '') {
    return getValidator().sanitizeText ? getValidator().sanitizeText(value, fallback) : String(value ?? fallback).trim();
  }

  function normalizeTags(value) {
    return getValidator().normalizeStringList ? getValidator().normalizeStringList(value) : (Array.isArray(value) ? value.map(String).filter(Boolean) : []);
  }

  function isPlainObject(value) {
    return getValidator().isPlainObject ? getValidator().isPlainObject(value) : Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function isSafeMediaUrl(value, options = {}) {
    return getValidator().isSafeMediaUrl ? getValidator().isSafeMediaUrl(value, options) : Boolean(value);
  }

  function getSearchParams() {
    try { return new URLSearchParams(global.location?.search || ''); } catch { return new URLSearchParams(); }
  }

  function getCmsConfig(options = {}) {
    const runtimeConfig = (typeof CONFIG !== 'undefined' && CONFIG) ? CONFIG : (global.CONFIG || {});
    const fromConfig = runtimeConfig?.cmsContent || {};
    return { ...DEFAULT_CONFIG, ...fromConfig, ...options };
  }

  function getCmsMediaValidationOptions(configOrOptions = {}) {
    const config = getCmsConfig(configOrOptions);
    return {
      allowRemoteMedia: config.allowRemoteMedia === true,
      allowedMediaOrigins: config.allowedMediaOrigins || [],
      allowedMediaHosts: config.allowedMediaHosts || [],
      allowedMediaPathPrefixes: config.allowedMediaPathPrefixes || [],
      disallowSignedMediaUrls: true
    };
  }

  function isDebugCms(config = getCmsConfig()) {
    if (config.debug === true || config.debugMerge === true) return true;
    return getSearchParams().get('debugCMS') === '1';
  }

  function logCms(event, data = {}, level = 'debug', config = getCmsConfig()) {
    if (!isDebugCms(config)) return;
    const fn = console[level] || console.debug || console.log;
    fn.call(console, `[cms] ${event}`, data);
  }

  async function fetchJsonWithTimeout(url, timeoutMs, config, label = 'remote') {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? global.setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs || 1200))) : 0;
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller?.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      logCms(`${label} load failed`, { url, error: error?.message || String(error) }, 'warn', config);
      throw error;
    } finally {
      if (timer) global.clearTimeout(timer);
    }
  }

  function getContentValidation(content, config) {
    const validator = getValidator();
    return validator.validateCmsContent
      ? validator.validateCmsContent(content, getCmsMediaValidationOptions(config))
      : { valid: true, errors: [], warnings: [] };
  }

  function logContentValidation(result, config, source) {
    if (result.warnings?.length) logCms('schema warning', { source, warnings: result.warnings }, 'warn', config);
    if (result.errors?.length) logCms('schema error', { source, errors: result.errors }, 'warn', config);
  }

  function validateContent(content, config, source) {
    const result = getContentValidation(content, config);
    cachedValidation = result;
    logContentValidation(result, config, source);
    return result.valid === true;
  }

  async function loadCmsContent(options = {}) {
    const config = getCmsConfig(options);
    if (config.enabled === false) {
      cachedContent = null;
      cachedSource = 'legacy';
      cachedValidation = { valid: true, errors: [], warnings: ['CMS disabled.'] };
      logCms('disabled; using legacy', {}, 'debug', config);
      return null;
    }

    if (cachedContent && options.forceReload !== true) return cachedContent;
    if (loadPromise && options.forceReload !== true) return loadPromise;

    loadPromise = (async () => {
      const timeoutMs = Number(options.timeoutMs || config.timeoutMs || DEFAULT_CONFIG.timeoutMs);
      const galleryTimeoutMs = Number(options.galleryTimeoutMs || config.galleryTimeoutMs || timeoutMs);
      const timeout = options.context === 'gallery' ? galleryTimeoutMs : timeoutMs;

      if (config.remoteEnabled === true && sanitizeText(config.remoteUrl)) {
        try {
          logCms('loading remote', { url: config.remoteUrl }, 'debug', config);
          const remote = await fetchJsonWithTimeout(config.remoteUrl, timeout, config, 'remote');
          if (validateContent(remote, config, 'remote')) {
            cachedContent = remote;
            cachedSource = 'remote';
            logCms('loaded remote', { version: remote.version || '', schemaVersion: remote.schemaVersion }, 'debug', config);
            return cachedContent;
          }
          logCms('remote schema invalid; trying fallback', {}, 'warn', config);
        } catch (_) {
          // fallback below
        }
      } else {
        logCms('remote disabled', {}, 'debug', config);
      }

      if (sanitizeText(config.fallbackUrl)) {
        try {
          logCms('fallback local', { url: config.fallbackUrl }, 'debug', config);
          const fallback = await fetchJsonWithTimeout(config.fallbackUrl, timeout, config, 'fallback');
          if (validateContent(fallback, config, 'fallback')) {
            cachedContent = fallback;
            cachedSource = 'fallback';
            logCms('loaded fallback', { version: fallback.version || '', schemaVersion: fallback.schemaVersion }, 'debug', config);
            return cachedContent;
          }
          logCms('fallback schema invalid; using legacy', {}, 'warn', config);
        } catch (_) {
          // legacy below
        }
      }

      cachedContent = null;
      cachedSource = 'legacy';
      cachedValidation = { valid: true, errors: [], warnings: ['Using legacy content.'] };
      logCms('fallback legacy', {}, 'warn', config);
      return null;
    })();

    try {
      return await loadPromise;
    } finally {
      loadPromise = null;
    }
  }

  async function loadCmsContentSources(options = {}) {
    const config = getCmsConfig(options);
    if (config.enabled === false) {
      const disabled = {
        remoteContent: null,
        fallbackContent: null,
        selectedContent: null,
        source: 'legacy',
        remoteStatus: 'disabled',
        fallbackStatus: 'disabled',
        remoteValidation: null,
        fallbackValidation: null,
        config
      };
      cachedContent = null;
      cachedSource = 'legacy';
      cachedValidation = { valid: true, errors: [], warnings: ['CMS disabled.'] };
      contentSourcesCache = disabled;
      return disabled;
    }

    if (contentSourcesCache && options.forceReload !== true) return contentSourcesCache;
    if (contentSourcesPromise && options.forceReload !== true) return contentSourcesPromise;

    contentSourcesPromise = (async () => {
      const timeoutMs = Number(options.timeoutMs || config.timeoutMs || DEFAULT_CONFIG.timeoutMs);
      const galleryTimeoutMs = Number(options.galleryTimeoutMs || config.galleryTimeoutMs || timeoutMs);
      const timeout = options.context === 'gallery' ? galleryTimeoutMs : timeoutMs;

      async function loadSource(label, enabled, url) {
        const cleanUrl = sanitizeText(url);
        if (!enabled || !cleanUrl) {
          return { content: null, status: enabled ? 'missing-url' : 'disabled', validation: null };
        }
        try {
          logCms(`loading ${label}`, { url: cleanUrl }, 'debug', config);
          const content = await fetchJsonWithTimeout(cleanUrl, timeout, config, label);
          const validation = getContentValidation(content, config);
          logContentValidation(validation, config, label);
          if (validation.valid !== true) return { content: null, status: 'invalid', validation };
          return { content, status: 'loaded', validation };
        } catch (_) {
          return { content: null, status: 'failed', validation: null };
        }
      }

      const [fallbackResult, remoteResult] = await Promise.all([
        loadSource('fallback', Boolean(sanitizeText(config.fallbackUrl)), config.fallbackUrl),
        loadSource('remote', config.remoteEnabled === true, config.remoteUrl)
      ]);

      const selectedContent = remoteResult.content || fallbackResult.content || null;
      const source = remoteResult.content ? 'remote' : (fallbackResult.content ? 'fallback' : 'legacy');
      cachedContent = selectedContent;
      cachedSource = source;
      cachedValidation = remoteResult.content
        ? remoteResult.validation
        : (fallbackResult.content ? fallbackResult.validation : { valid: true, errors: [], warnings: ['Using legacy content.'] });

      const result = {
        remoteContent: remoteResult.content,
        fallbackContent: fallbackResult.content,
        selectedContent,
        source,
        remoteStatus: remoteResult.status,
        fallbackStatus: fallbackResult.status,
        remoteValidation: remoteResult.validation,
        fallbackValidation: fallbackResult.validation,
        config
      };
      contentSourcesCache = result;
      logCms('content sources resolved', {
        source,
        remoteStatus: result.remoteStatus,
        fallbackStatus: result.fallbackStatus
      }, source === 'legacy' ? 'warn' : 'debug', config);
      return result;
    })();

    try {
      return await contentSourcesPromise;
    } finally {
      contentSourcesPromise = null;
    }
  }

  function getCmsContent() { return cachedContent; }
  function getCmsSource() { return cachedSource; }
  function getCmsValidation() { return cachedValidation; }
  function clearCmsContentCache() {
    cachedContent = null;
    cachedSource = 'none';
    cachedValidation = null;
    loadPromise = null;
    contentSourcesCache = null;
    contentSourcesPromise = null;
  }

  function getCmsIndexContent(content = cachedContent) { return content?.index || null; }
  function getCmsGateContent(content = cachedContent) { return content?.gate || null; }
  function getCmsRoomContent(roomKey, content = cachedContent) {
    const key = sanitizeText(roomKey).toLowerCase();
    const rooms = content?.rooms;
    if (!isPlainObject(rooms)) return null;
    if (rooms[key]) return rooms[key];
    const matchedKey = Object.keys(rooms).find((candidate) => sanitizeText(candidate).toLowerCase() === key);
    return matchedKey ? rooms[matchedKey] : null;
  }

  function normalizeCmsId(value) {
    return sanitizeText(value).toUpperCase();
  }

  function getCmsArtworkId(artwork, fallbackKey = '') {
    if (!isPlainObject(artwork)) return normalizeCmsId(fallbackKey);
    return normalizeCmsId(
      artwork.artwork_code ||
      artwork.artworkCode ||
      artwork.artwork_id ||
      artwork.artworkId ||
      artwork.id ||
      artwork.code ||
      fallbackKey
    );
  }

  function normalizeCmsArtworkMap(roomContent) {
    const map = new Map();
    const stats = {
      schemaMode: 'none',
      itemCount: 0,
      legacyCount: 0,
      duplicateIds: 0
    };

    const items = isPlainObject(roomContent?.items) ? roomContent.items : null;
    if (items) {
      stats.schemaMode = 'items';
      Object.entries(items).forEach(([itemKey, artwork]) => {
        const code = getCmsArtworkId(artwork, itemKey);
        if (!code || !isPlainObject(artwork)) return;
        map.set(code, { ...artwork, __cmsId: code, __cmsSchemaSource: 'items' });
        stats.itemCount += 1;
      });
    }

    const artworks = Array.isArray(roomContent?.artworks) ? roomContent.artworks : [];
    if (artworks.length) {
      stats.schemaMode = stats.schemaMode === 'items' ? 'mixed' : 'artworks';
      artworks.forEach((artwork) => {
        const code = getCmsArtworkId(artwork);
        if (!code || !isPlainObject(artwork)) return;
        if (map.has(code)) stats.duplicateIds += 1;
        // Backward-compatible priority: legacy artworks[] wins on duplicate ids.
        map.set(code, { ...artwork, __cmsId: code, __cmsSchemaSource: 'artworks' });
        stats.legacyCount += 1;
      });
    }

    return { map, stats };
  }

  function isEmptyOverride(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  }

  function isScalarValue(value) {
    return value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value);
  }

  function isVideoMedia(value, legacy = {}, cms = {}) {
    const url = sanitizeText(value);
    const mediaType = sanitizeText(cms.mediaType || cms.kind || cms.type || legacy.mediaType || legacy.kind || legacy.type).toLowerCase();
    return mediaType === 'video' || VIDEO_EXTENSION_PATTERN.test(url);
  }

  function getMediaValidationOptions(config) {
    return {
      allowRemoteMedia: config.allowRemoteMedia === true,
      allowedMediaOrigins: config.allowedMediaOrigins || [],
      allowedMediaHosts: config.allowedMediaHosts || [],
      allowedMediaPathPrefixes: config.allowedMediaPathPrefixes || []
    };
  }

  function applyMediaField(target, targetField, value, legacy, config, stats, cms) {
    if (config.allowCmsMediaOverride === false) {
      stats.cmsMediaOverrideDisabled += 1;
      return;
    }
    if (!isScalarValue(value) || isEmptyOverride(value)) return;

    const clean = sanitizeText(value);
    if (!isSafeMediaUrl(clean, getMediaValidationOptions(config))) {
      stats.cmsFieldsSkippedUnsafe += 1;
      return;
    }

    let resolvedField = targetField;
    if (targetField === 'mediaUrl') resolvedField = isVideoMedia(clean, legacy, cms) ? 'videoUrl' : 'image';
    target[resolvedField] = clean;
    stats.cmsFieldsApplied += 1;
  }

  function applyTextField(target, targetField, value, legacy, config, stats) {
    if (config.allowCmsTextOverride === false) {
      stats.cmsTextOverrideDisabled += 1;
      return;
    }
    if (targetField === 'tags') {
      const tags = normalizeTags(value);
      if (tags.length) {
        target.tags = tags;
        stats.cmsFieldsApplied += 1;
      }
      return;
    }
    if (!isScalarValue(value) || isEmptyOverride(value)) return;
    const clean = sanitizeText(value, legacy?.[targetField] || '');
    if (!clean) return;
    target[targetField] = clean;
    stats.cmsFieldsApplied += 1;
  }

  function applyCmsField(target, key, value, legacy, config, stats, cms) {
    if (key.startsWith('__')) return;
    if (config.protectSceneLayout !== false && TECHNICAL_FORBIDDEN_FIELDS.has(key)) {
      stats.cmsLayoutFieldsIgnored += 1;
      return;
    }

    const targetField = FIELD_MAP[key];
    if (!targetField || isEmptyOverride(value)) return;

    if (MEDIA_FIELDS.has(targetField) || targetField === 'mediaUrl') {
      applyMediaField(target, targetField, value, legacy, config, stats, cms);
      return;
    }

    if (TEXT_FIELDS.has(targetField) || targetField === 'tags') {
      applyTextField(target, targetField, value, legacy, config, stats);
      return;
    }

    if (targetField === 'cmsVisible') {
      if (typeof value === 'boolean') {
        target.cmsVisible = value;
        stats.cmsFieldsApplied += 1;
      }
      return;
    }

    if (targetField === 'isFeatured') {
      target.isFeatured = value === true;
      stats.cmsFieldsApplied += 1;
      return;
    }

    if (targetField === 'cmsSortOrder') {
      const order = Number(value);
      if (Number.isFinite(order)) {
        target.cmsSortOrder = order;
        stats.cmsFieldsApplied += 1;
      }
    }
  }

  function getArtworkMediaSrc(data = {}) {
    return sanitizeText(
      data?.image ||
      data?.imageUrl ||
      data?.image_url ||
      data?.thumbnail ||
      data?.thumbnailUrl ||
      data?.thumbnail_url ||
      data?.mediaUrl ||
      data?.media_url ||
      data?.src ||
      data?.poster ||
      data?.posterUrl ||
      data?.poster_url ||
      ''
    );
  }

  function getArtworkVideoSrc(data = {}) {
    const direct = data?.videoUrl || data?.video_url || data?.video || data?.contentUrl || data?.content_url;
    if (direct) return sanitizeText(direct);
    const media = data?.mediaUrl || data?.media_url;
    if (media && isVideoMedia(media, data, data)) return sanitizeText(media);
    if (sanitizeText(data?.type || data?.kind || data?.mediaType).toLowerCase() === 'video') {
      return sanitizeText(data?.src || data?.url || '');
    }
    return '';
  }

  function getArtworkPosterSrc(data = {}) {
    return sanitizeText(data?.poster || data?.posterUrl || data?.poster_url || data?.thumbnail || data?.thumbnailUrl || data?.thumbnail_url || data?.image || '');
  }

  function mergeCmsArtworkMetadata(legacyItems, roomKey, content = cachedContent, options = {}) {
    if (!Array.isArray(legacyItems)) return legacyItems;
    const config = getCmsConfig(options);
    const roomContent = getCmsRoomContent(roomKey, content);
    const { map: cmsMap, stats: schemaStats } = normalizeCmsArtworkMap(roomContent);
    if (!cmsMap.size) {
      logCms('merged legacy scene items', {
        roomKey,
        cmsSchemaMode: schemaStats.schemaMode,
        cmsItemsMatched: 0,
        total: legacyItems.length,
        source: cachedSource
      }, 'debug', config);
      return legacyItems.slice();
    }

    const stats = {
      roomKey,
      source: cachedSource,
      cmsSchemaMode: schemaStats.schemaMode,
      cmsMapItems: cmsMap.size,
      cmsItemsMatched: 0,
      cmsItemsUnmatched: 0,
      cmsOnly: 0,
      cmsFieldsApplied: 0,
      cmsFieldsSkippedUnsafe: 0,
      cmsLayoutFieldsIgnored: 0,
      cmsMediaOverrideDisabled: 0,
      cmsTextOverrideDisabled: 0,
      duplicateIds: schemaStats.duplicateIds
    };

    const used = new Set();
    const merged = legacyItems.map((legacy) => {
      const id = normalizeCmsId(legacy?.id);
      const cms = cmsMap.get(id);
      const next = { ...legacy };
      if (!cms) {
        stats.cmsItemsUnmatched += 1;
        return next;
      }
      used.add(id);
      stats.cmsItemsMatched += 1;
      Object.entries(cms).forEach(([key, value]) => {
        if (key === 'artwork_code' || key === 'artworkCode' || key === 'artwork_id' || key === 'artworkId' || key === 'code' || key === 'legacy_scene_props' || key === 'cms_warning') return;
        applyCmsField(next, key, value, legacy, config, stats, cms);
      });
      if (cms.cms_warning) next.cmsWarning = sanitizeText(cms.cms_warning);
      return next;
    });

    cmsMap.forEach((_, code) => { if (!used.has(code)) stats.cmsOnly += 1; });
    const shouldWarn = stats.cmsFieldsSkippedUnsafe || stats.cmsLayoutFieldsIgnored;
    logCms('merged legacy scene items', stats, shouldWarn ? 'warn' : 'debug', config);
    return merged;
  }

  global.cmsContentLoader = {
    loadCmsContent,
    loadCmsContentSources,
    getCmsContent,
    getCmsSource,
    getCmsValidation,
    getCmsIndexContent,
    getCmsGateContent,
    getCmsRoomContent,
    mergeCmsArtworkMetadata,
    clearCmsContentCache,
    isDebugCms,
    getCmsConfig,
    getCmsMediaValidationOptions,
    sanitizeText,
    isSafeMediaUrl,
    getArtworkMediaSrc,
    getArtworkVideoSrc,
    getArtworkPosterSrc
  };
})(typeof window !== 'undefined' ? window : globalThis);
