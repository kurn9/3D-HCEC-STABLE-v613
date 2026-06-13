// V6.11.21-B6-F_K_O_I_B — CMS schema/media safety validator with remote allowlist support.
// Dependency-free; safe to load as a classic script or ES module.
(function initCmsSchemaValidator(global) {
  if (global.cmsSchemaValidator) return;

  const SAFE_RELATIVE_MEDIA_PREFIXES = ['./assets/', 'assets/', '/assets/'];
  const UNSAFE_TEXT_PATTERN = /<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
  const HTML_TAG_PATTERN = /<[^>]+>/g;
  const BLOCKED_MEDIA_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:']);

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function sanitizeText(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    const text = String(value)
      .replace(UNSAFE_TEXT_PATTERN, '')
      .replace(HTML_TAG_PATTERN, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim();
    return text || fallback;
  }

  function sanitizeTextArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => sanitizeText(item)).filter(Boolean);
  }

  function normalizeStringList(value) {
    if (Array.isArray(value)) return sanitizeTextArray(value);
    if (typeof value === 'string' && value.trim()) {
      return value.split(',').map((item) => sanitizeText(item)).filter(Boolean);
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

  function validateCmsContent(content) {
    const errors = [];
    const warnings = [];

    if (!isPlainObject(content)) {
      return { valid: false, errors: ['Root CMS content must be an object.'], warnings };
    }

    if (!Number.isFinite(Number(content.schemaVersion)) && !sanitizeText(content.version)) {
      warnings.push('Missing schemaVersion/version; accepting for backward compatibility.');
    }

    if (!isPlainObject(content.rooms)) {
      errors.push('Missing rooms object.');
    } else {
      Object.entries(content.rooms).forEach(([roomKey, room]) => {
        if (!isPlainObject(room)) {
          errors.push(`rooms.${roomKey} must be an object.`);
          return;
        }

        if (room.artworks !== undefined && !Array.isArray(room.artworks)) {
          errors.push(`rooms.${roomKey}.artworks must be an array.`);
        }
        (room.artworks || []).forEach((artwork, index) => {
          if (!isPlainObject(artwork)) {
            errors.push(`rooms.${roomKey}.artworks[${index}] must be an object.`);
            return;
          }
          if (!normalizeCmsItemId(artwork)) {
            errors.push(`rooms.${roomKey}.artworks[${index}] is missing artwork_code/id/code.`);
          }
        });

        if (room.items !== undefined && !isPlainObject(room.items)) {
          errors.push(`rooms.${roomKey}.items must be an object keyed by artwork id.`);
        }
        if (isPlainObject(room.items)) {
          Object.entries(room.items).forEach(([itemKey, item]) => {
            if (!isPlainObject(item)) {
              errors.push(`rooms.${roomKey}.items.${itemKey} must be an object.`);
              return;
            }
            if (!normalizeCmsItemId(item, itemKey)) {
              errors.push(`rooms.${roomKey}.items.${itemKey} is missing a usable key/id.`);
            }
          });
        }

        if (room.artworks === undefined && room.items === undefined) {
          warnings.push(`rooms.${roomKey} has no artworks[] or items{} content.`);
        }
      });
    }

    if (content.gate !== undefined && !isPlainObject(content.gate)) warnings.push('gate should be an object.');
    if (content.index !== undefined && !isPlainObject(content.index)) warnings.push('index should be an object.');
    if (content.site !== undefined && !isPlainObject(content.site)) warnings.push('site should be an object.');

    return { valid: errors.length === 0, errors, warnings };
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

  function isRelativeMediaUrl(url) {
    if (!url || url.startsWith('//') || url.includes('..')) return false;
    return SAFE_RELATIVE_MEDIA_PREFIXES.some((prefix) => url.startsWith(prefix));
  }

  function isSafeMediaUrl(value, options = {}) {
    const url = sanitizeText(value);
    if (!url) return false;
    const lower = url.toLowerCase();
    if ([...BLOCKED_MEDIA_PROTOCOLS].some((protocol) => lower.startsWith(protocol))) return false;
    if (isRelativeMediaUrl(url)) return true;

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
      return isPathAllowed(parsed.pathname, options.allowedMediaPathPrefixes);
    } catch {
      return false;
    }
  }

  global.cmsSchemaValidator = {
    validateCmsContent,
    sanitizeText,
    sanitizeTextArray,
    normalizeStringList,
    isPlainObject,
    isSafeMediaUrl,
    SAFE_RELATIVE_MEDIA_PREFIXES: [...SAFE_RELATIVE_MEDIA_PREFIXES]
  };
})(typeof window !== 'undefined' ? window : globalThis);
