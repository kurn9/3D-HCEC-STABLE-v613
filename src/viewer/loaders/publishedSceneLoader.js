// V6.12-C4 — Published Scene Manifest Loader with mandatory static fallback boundary.
// This loader is read-only: it fetches public Storage JSON only, never writes DB/Storage and never calls Edge Functions.
(function () {
  'use strict';

  const VALID_ROOMS = new Set(['indoor', 'outdoor']);
  const VALID_ITEM_TYPES = new Set(['artwork', 'logo', 'text', 'video']);
  const MANIFEST_SCHEMA_VERSION = 'scene-publish-manifest-v1';
  const MAX_RECURSIVE_SCAN_DEPTH = 16;
  const MANIFEST_FORBIDDEN_KEYS = new Set([
    'items',
    'artworks',
    'scene',
    'data',
    'objects',
    'payload',
    'cmsdrafts',
    'publishedbundles',
    'scenejson',
    'safedelete',
    'functions',
    'storage',
    'delete',
    'upsert',
    'script',
    'onerror',
    'onclick'
  ]);
  const SENSITIVE_KEYS = new Set([
    'token',
    'access_token',
    'authorization',
    'servicerole',
    'service_role',
    'email',
    'apikey',
    'anonkey',
    'servicekey'
  ]);
  const ITEM_DANGEROUS_KEYS = new Set([
    'cmspublicpath',
    'storagepath',
    'servicerole',
    'service_role',
    'token',
    'access_token',
    'authorization',
    'delete',
    'purge',
    'bucket',
    'email',
    'apikey',
    'anonkey',
    'servicekey',
    'objects',
    'payload',
    'cmsdrafts',
    'publishedbundles',
    'scenejson',
    'safedelete',
    'functions',
    'storage',
    'upsert',
    'script',
    'onerror',
    'onclick'
  ]);
  const MEDIA_FIELDS = ['image', 'imageUrl', 'thumbnail', 'poster', 'videoUrl'];

  function getConfig() {
    return (typeof CONFIG !== 'undefined' && CONFIG?.publishedScene) ? CONFIG.publishedScene : null;
  }

  function isDebugEnabled() {
    return getConfig()?.debug === true;
  }

  function debugLog(level, message, detail) {
    if (!isDebugEnabled()) return;
    const fn = console[level] || console.debug || console.log;
    fn.call(console, '[published-scene]', message, detail || '');
  }

  function normalizeRoom(roomKey) {
    const room = String(roomKey || '').trim().toLowerCase();
    return VALID_ROOMS.has(room) ? room : '';
  }

  function makeResult(overrides = {}) {
    return {
      ok: false,
      items: null,
      source: 'fallback',
      manifest: null,
      error: null,
      reason: null,
      ...overrides
    };
  }

  function isAbsoluteUrl(value) {
    return /^[a-z][a-z0-9+.-]*:/i.test(String(value || '').trim()) || /^\/\//.test(String(value || '').trim());
  }

  function hasEncodedTraversal(value) {
    const raw = String(value || '').toLowerCase();
    if (raw.includes('%2e') || raw.includes('%2f') || raw.includes('%5c')) return true;
    try {
      const decoded = decodeURIComponent(raw);
      return decoded.includes('..') || decoded.includes('\\') || decoded.includes('//');
    } catch (_) {
      return true;
    }
  }

  function hasUnsafePathSegment(value) {
    const path = String(value || '').trim();
    return !path || path.startsWith('/') || path.includes('\\') || path.includes('..') || path.includes('//') || hasEncodedTraversal(path);
  }

  function hasUnsafeMediaTraversal(value) {
    const raw = String(value || '').toLowerCase();
    if (raw.includes('%2e') || raw.includes('%5c')) return true;
    try {
      const decoded = decodeURIComponent(raw);
      return decoded.includes('..') || decoded.includes('\\');
    } catch (_) {
      return true;
    }
  }

  function isUnsafeMediaPath(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (/^(javascript|data|vbscript|file|blob):/.test(lower)) return true;
    return trimmed.includes('\\') || trimmed.includes('..') || hasUnsafeMediaTraversal(trimmed);
  }

  function scanForbiddenKey(value, forbiddenKeys, path = '$', depth = 0, seen = new WeakSet()) {
    if (!value || typeof value !== 'object') return null;
    if (depth > MAX_RECURSIVE_SCAN_DEPTH) {
      return { path, key: '<max-depth>', reason: 'max_depth_exceeded' };
    }
    if (seen.has(value)) {
      return { path, key: '<cycle>', reason: 'cycle_detected' };
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const nested = scanForbiddenKey(value[i], forbiddenKeys, `${path}[${i}]`, depth + 1, seen);
        if (nested) return nested;
      }
      return null;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedKey = String(key || '').toLowerCase();
      const nextPath = `${path}.${key}`;
      if (forbiddenKeys.has(normalizedKey)) {
        return { path: nextPath, key, reason: 'forbidden_key' };
      }
      const nested = scanForbiddenKey(nestedValue, forbiddenKeys, nextPath, depth + 1, seen);
      if (nested) return nested;
    }
    return null;
  }

  function formatScanIssue(prefix, issue) {
    if (!issue) return prefix;
    return `${prefix}:${issue.path}`;
  }

  function validateManifest(manifest, room) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { ok: false, reason: 'manifest_not_object' };
    }
    if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
      return { ok: false, reason: 'manifest_schema_version_invalid' };
    }
    if (normalizeRoom(manifest.room) !== room) {
      return { ok: false, reason: 'manifest_room_mismatch' };
    }
    if (typeof manifest.latestVersion !== 'string' || !/^\d{8}T\d{6}Z-[a-f0-9]{12}$/i.test(manifest.latestVersion.trim())) {
      return { ok: false, reason: 'manifest_latest_version_invalid' };
    }
    if (typeof manifest.latestPath !== 'string') {
      return { ok: false, reason: 'manifest_latest_path_missing' };
    }

    const latestPath = manifest.latestPath.trim();
    const expectedPrefix = `published/scenes/${room}/versions/`;
    if (isAbsoluteUrl(latestPath) || hasUnsafePathSegment(latestPath)) {
      return { ok: false, reason: 'manifest_latest_path_unsafe' };
    }
    if (!latestPath.startsWith(expectedPrefix) || !latestPath.endsWith('.json')) {
      return { ok: false, reason: 'manifest_latest_path_outside_room' };
    }

    const manifestForbiddenIssue = scanForbiddenKey(manifest, MANIFEST_FORBIDDEN_KEYS);
    if (manifestForbiddenIssue) {
      return { ok: false, reason: formatScanIssue('manifest_forbidden_key', manifestForbiddenIssue) };
    }

    const manifestSensitiveIssue = scanForbiddenKey(manifest, SENSITIVE_KEYS);
    if (manifestSensitiveIssue) {
      return { ok: false, reason: formatScanIssue('manifest_sensitive_key', manifestSensitiveIssue) };
    }

    return { ok: true, latestPath };
  }

  function isFiniteNumberArray(value, length) {
    return Array.isArray(value) && value.length === length && value.every((entry) => Number.isFinite(Number(entry)));
  }

  function isPositiveNumberArray(value, length) {
    return isFiniteNumberArray(value, length) && value.every((entry) => Number(entry) > 0);
  }

  function validateVersionItems(items) {
    if (!Array.isArray(items)) return { ok: false, reason: 'version_root_not_array' };

    const seenIds = new Set();
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { ok: false, reason: `item_not_object:${index}` };
      }

      const dangerousIssue = scanForbiddenKey(item, ITEM_DANGEROUS_KEYS, `$[${index}]`);
      if (dangerousIssue) return { ok: false, reason: formatScanIssue('item_dangerous_key', dangerousIssue) };

      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!id) return { ok: false, reason: `item_missing_id:${index}` };
      if (seenIds.has(id)) return { ok: false, reason: `item_duplicate_id:${id}` };
      seenIds.add(id);

      const type = String(item.type || 'artwork').toLowerCase();
      if (!VALID_ITEM_TYPES.has(type)) return { ok: false, reason: `item_invalid_type:${id}` };

      if ('position' in item && !isFiniteNumberArray(item.position, 3)) return { ok: false, reason: `item_invalid_position:${id}` };
      if ('rotation' in item && !isFiniteNumberArray(item.rotation, 3)) return { ok: false, reason: `item_invalid_rotation:${id}` };
      if ('size' in item && !isPositiveNumberArray(item.size, 2)) return { ok: false, reason: `item_invalid_size:${id}` };

      for (const field of MEDIA_FIELDS) {
        if (isUnsafeMediaPath(item[field])) return { ok: false, reason: `item_unsafe_media:${id}:${field}` };
      }
    }

    return { ok: true };
  }

  function buildPublicUrl(baseUrl, bucket, path) {
    const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
    const normalizedBucket = String(bucket || '').trim();
    const normalizedPath = String(path || '').trim().replace(/^\/+/, '');
    if (!normalizedBase || !normalizedBucket || !normalizedPath) return '';
    return `${normalizedBase}/storage/v1/object/public/${encodeURIComponent(normalizedBucket)}/${normalizedPath}`;
  }

  function buildManifestPath(room, pattern) {
    const template = String(pattern || 'published/scenes/{room}/manifest.json');
    return template.replace('{room}', room);
  }

  async function fetchJsonWithTimeout(url, { timeoutMs = 1600, cache = 'default' } = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), Math.max(200, Number(timeoutMs || 1600)));
    try {
      const response = await fetch(url, { cache, signal: controller.signal });
      if (!response.ok) return { ok: false, status: response.status, data: null, error: `HTTP ${response.status}` };
      const data = await response.json();
      return { ok: true, status: response.status, data, error: null };
    } catch (error) {
      return { ok: false, status: 0, data: null, error: error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error)) };
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function loadPublishedSceneForRoom(roomKey) {
    const cfg = getConfig();
    const room = normalizeRoom(roomKey || (typeof CONFIG !== 'undefined' ? CONFIG?.currentRoomId : ''));

    if (!cfg?.enabled) return makeResult({ source: 'disabled', reason: 'published_scene_disabled' });
    if (!room) return makeResult({ source: 'fallback', reason: 'invalid_room' });
    if (!String(cfg.baseUrl || '').trim()) return makeResult({ source: 'disabled', reason: 'published_scene_base_url_missing' });

    const manifestPath = buildManifestPath(room, cfg.manifestPathPattern);
    if (hasUnsafePathSegment(manifestPath) || !manifestPath.startsWith(`published/scenes/${room}/`) || manifestPath !== `published/scenes/${room}/manifest.json`) {
      return makeResult({ source: 'fallback', reason: 'manifest_path_pattern_unsafe' });
    }

    const bucket = cfg.bucket || 'cms-public';
    const timeoutMs = Number(cfg.timeoutMs || 1600);
    const manifestUrl = buildPublicUrl(cfg.baseUrl, bucket, manifestPath);
    const manifestResponse = await fetchJsonWithTimeout(manifestUrl, {
      timeoutMs,
      cache: cfg.manifestCache || 'no-store'
    });
    if (!manifestResponse.ok) {
      debugLog('warn', 'manifest fetch failed; static fallback will be used', manifestResponse);
      return makeResult({ source: 'fallback', reason: 'manifest_fetch_failed', error: manifestResponse.error });
    }

    const manifestValidation = validateManifest(manifestResponse.data, room);
    if (!manifestValidation.ok) {
      debugLog('warn', 'manifest validation failed; static fallback will be used', manifestValidation);
      return makeResult({ source: 'fallback', manifest: manifestResponse.data, reason: manifestValidation.reason });
    }

    const versionUrl = buildPublicUrl(cfg.baseUrl, bucket, manifestValidation.latestPath);
    const versionResponse = await fetchJsonWithTimeout(versionUrl, {
      timeoutMs,
      cache: cfg.versionCache || 'default'
    });
    if (!versionResponse.ok) {
      debugLog('warn', 'version fetch failed; static fallback will be used', versionResponse);
      return makeResult({ source: 'fallback', manifest: manifestResponse.data, reason: 'version_fetch_failed', error: versionResponse.error });
    }

    const versionValidation = validateVersionItems(versionResponse.data);
    if (!versionValidation.ok) {
      debugLog('warn', 'version validation failed; static fallback will be used', versionValidation);
      return makeResult({ source: 'fallback', manifest: manifestResponse.data, reason: versionValidation.reason });
    }

    return makeResult({
      ok: true,
      items: versionResponse.data,
      source: 'published',
      manifest: manifestResponse.data,
      reason: 'published_scene_loaded'
    });
  }

  window.publishedSceneLoader = {
    loadPublishedSceneForRoom,
    validateManifest,
    validateVersionItems
  };
})();
