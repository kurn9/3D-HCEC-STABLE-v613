const ROOM_KEYS = Object.freeze(['indoor', 'outdoor']);
const MEDIA_FIELD_NAMES = Object.freeze([
  'imageUrl',
  'image',
  'image_url',
  'thumbnailUrl',
  'thumbnail',
  'thumbnail_url',
  'videoUrl',
  'video',
  'video_url',
  'posterUrl',
  'poster',
  'poster_url',
]);

const VISIBLE_FALSE_VALUES = new Set([false, 'false', '0', 0, 'hidden', 'inactive']);

export function buildCanonicalDashboardSummary(cmsJson, context = {}) {
  const warnings = [];
  const errors = [];
  const root = isPlainObject(cmsJson) ? cmsJson : null;

  if (!root) {
    errors.push('CMS public JSON không phải object hợp lệ.');
  }

  const rooms = isPlainObject(root?.rooms) ? root.rooms : null;
  if (!rooms) {
    errors.push('CMS public JSON thiếu cấu trúc rooms.');
  }

  const indoorItems = getRoomArtworks(rooms, 'indoor');
  const outdoorItems = getRoomArtworks(rooms, 'outdoor');
  const roomItems = [...indoorItems, ...outdoorItems];
  const featuredItems = getFeaturedItems(root);
  const visibleFeaturedItems = featuredItems.filter(isVisibleItem);

  const mediaStats = roomItems.reduce(
    (acc, item, index) => {
      const visible = isVisibleItem(item);
      const hasMedia = hasAnyMedia(item);
      if (hasMedia) {
        acc.present += 1;
      } else if (visible) {
        acc.missing += 1;
        warnings.push(formatMissingMediaWarning(item, index));
      }
      if (visible && !getItemTitle(item)) {
        warnings.push(formatMissingTitleWarning(item, index));
      }
      return acc;
    },
    { present: 0, missing: 0 }
  );

  const valid = errors.length === 0;
  return {
    source: context.source || 'canonical-public',
    sourceLabel: context.sourceLabel || 'CMS public JSON',
    sourceUrl: context.sourceUrl || '',
    version: getFirstString(root, ['version', 'exportVersion', 'cmsVersion']),
    schemaVersion: getFirstString(root, ['schemaVersion', 'schema_version']),
    valid,
    roomCount: countKnownRooms(rooms),
    indoorCount: indoorItems.length,
    outdoorCount: outdoorItems.length,
    totalRoomItems: roomItems.length,
    featuredCount: featuredItems.length,
    featuredVisibleCount: visibleFeaturedItems.length,
    mediaPresentCount: mediaStats.present,
    mediaMissingCount: mediaStats.missing,
    warningCount: warnings.length,
    errorCount: errors.length,
    warnings,
    errors,
    fallbackUsed: Boolean(context.fallbackUsed),
  };
}

export function buildDbFallbackDashboardSummary(data = {}, context = {}) {
  const rooms = Array.isArray(data.rooms) ? data.rooms : [];
  const artworks = Array.isArray(data.artworks) ? data.artworks : [];
  const artworkStats = isPlainObject(data.artworkStats) ? data.artworkStats : {};
  const mediaAssets = Array.isArray(data.mediaAssets) ? data.mediaAssets : [];
  const warningCount = toFiniteNumber(artworkStats.warning, 0);

  return {
    source: 'db-fallback',
    sourceLabel: context.sourceLabel || 'DB catalog fallback',
    sourceUrl: '',
    version: '',
    schemaVersion: '',
    valid: true,
    roomCount: rooms.length,
    indoorCount: toFiniteNumber(artworkStats.indoor, 0),
    outdoorCount: toFiniteNumber(artworkStats.outdoor, 0),
    totalRoomItems: toFiniteNumber(artworkStats.total, artworks.length),
    featuredCount: 0,
    featuredVisibleCount: 0,
    mediaPresentCount: mediaAssets.length,
    mediaMissingCount: 0,
    warningCount,
    errorCount: 0,
    warnings: [],
    errors: [],
    fallbackUsed: true,
  };
}

function getRoomArtworks(rooms, roomKey) {
  const artworks = rooms?.[roomKey]?.artworks;
  return Array.isArray(artworks) ? artworks : [];
}

function getFeaturedItems(root) {
  const featured = root?.index?.featuredArtworks || root?.index?.featured_artworks || root?.featuredArtworks;
  if (Array.isArray(featured)) return featured;
  if (Array.isArray(featured?.items)) return featured.items;
  if (Array.isArray(featured?.artworks)) return featured.artworks;
  return [];
}

function isVisibleItem(item) {
  if (!isPlainObject(item)) return false;
  const value = item.isVisible ?? item.is_visible ?? item.visible ?? item.status;
  return !VISIBLE_FALSE_VALUES.has(value);
}

function hasAnyMedia(item) {
  if (!isPlainObject(item)) return false;
  return MEDIA_FIELD_NAMES.some((fieldName) => isNonEmptyString(item[fieldName]));
}

function getItemTitle(item) {
  return getFirstString(item, ['title', 'name', 'label']);
}

function formatMissingMediaWarning(item, index) {
  const code = getFirstString(item, ['id', 'code', 'artworkCode', 'artwork_code']) || `item-${index + 1}`;
  const title = getItemTitle(item) || 'Chưa có tên';
  return `${code} · ${title}: thiếu media chính.`;
}

function formatMissingTitleWarning(item, index) {
  const code = getFirstString(item, ['id', 'code', 'artworkCode', 'artwork_code']) || `item-${index + 1}`;
  return `${code}: thiếu tiêu đề hiển thị.`;
}

function countKnownRooms(rooms) {
  if (!isPlainObject(rooms)) return 0;
  return ROOM_KEYS.reduce((count, roomKey) => (isPlainObject(rooms[roomKey]) ? count + 1 : count), 0);
}

function getFirstString(source, keys = []) {
  if (!isPlainObject(source)) return '';
  for (const key of keys) {
    const value = source[key];
    if (isNonEmptyString(value)) return String(value).trim();
  }
  return '';
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
