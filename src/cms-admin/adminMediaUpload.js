import { CMS_MEDIA_UPLOAD_CONFIG } from './adminConfig.js';

export const CMS_MEDIA_TARGET_TYPES = Object.freeze({
  roomArtwork: 'room_artwork',
  indexFeatured: 'index_featured',
});

export const INDEX_FEATURED_MEDIA_UPLOAD_TARGET = Object.freeze({
  targetType: CMS_MEDIA_TARGET_TYPES.indexFeatured,
  sectionKey: CMS_MEDIA_UPLOAD_CONFIG.featuredSectionKey,
  fieldName: 'imageUrl',
  mediaKind: 'image',
});

export const STATIC_CMS_MEDIA_UPLOAD_TARGETS = Object.freeze([
  {
    key: 'image',
    label: 'Upload ảnh/logo',
    help: 'Dùng cho artwork/logo. Sau upload sẽ đồng bộ image / imageUrl / image_url trong bản nháp.',
    fieldName: 'imageUrl',
    mediaKind: 'image',
  },
  {
    key: 'poster',
    label: 'Upload poster',
    help: 'Dùng làm ảnh đại diện cho video. Sau upload sẽ đồng bộ poster / posterUrl / poster_url trong bản nháp.',
    fieldName: 'posterUrl',
    mediaKind: 'poster',
  },
  {
    key: 'video',
    label: 'Upload video MP4',
    help: 'Dùng cho item video. Sau upload sẽ đồng bộ videoUrl / video_url trong bản nháp.',
    fieldName: 'videoUrl',
    mediaKind: 'video',
  },
]);

export function getUploadAccept(mediaKind) {
  return CMS_MEDIA_UPLOAD_CONFIG.acceptByKind?.[mediaKind] || '';
}

export function getUploadSizeLimit(mediaKind) {
  return Number(CMS_MEDIA_UPLOAD_CONFIG.maxBytesByKind?.[mediaKind] || 0);
}

export function formatUploadSizeLimit(mediaKind) {
  const bytes = getUploadSizeLimit(mediaKind);
  if (!bytes) return 'không rõ giới hạn';
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

export function validateClientMediaFile(file, mediaKind) {
  if (!file) return { valid: false, reason: 'Chưa chọn file.' };
  const kind = String(mediaKind || '').trim();
  if (!CMS_MEDIA_UPLOAD_CONFIG.allowedMediaKinds.includes(kind)) {
    return { valid: false, reason: 'Loại media không nằm trong phạm vi upload an toàn.' };
  }

  const mime = String(file.type || '').trim().toLowerCase();
  const allowedMime = kind === 'video'
    ? ['video/mp4']
    : ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedMime.includes(mime)) {
    return { valid: false, reason: `MIME không được phép: ${mime || 'không rõ'}.` };
  }

  const limit = getUploadSizeLimit(kind);
  if (limit && Number(file.size || 0) > limit) {
    return { valid: false, reason: `File vượt giới hạn ${formatUploadSizeLimit(kind)}.` };
  }

  return { valid: true, reason: 'OK' };
}

export function getMediaUploadStatusKey(roomKey, itemCode, fieldName) {
  return [roomKey || 'room', itemCode || 'item', fieldName || 'field']
    .map((part) => String(part).replace(/[^a-zA-Z0-9_-]/g, '_'))
    .join('__');
}

export function getFeaturedMediaUploadStatusKey(itemId, fieldName = 'imageUrl') {
  return ['index_featured', itemId || 'item', fieldName || 'field']
    .map((part) => String(part).replace(/[^a-zA-Z0-9_-]/g, '_'))
    .join('__');
}

export function validateFeaturedImageFile(file) {
  return validateClientMediaFile(file, INDEX_FEATURED_MEDIA_UPLOAD_TARGET.mediaKind);
}

export function getUploadedUrl(result = {}) {
  return String(result.publicUrl || result.public_url || result.url || '').trim();
}

export function getUploadTargetForKey(key) {
  return STATIC_CMS_MEDIA_UPLOAD_TARGETS.find((target) => target.key === key) || null;
}
