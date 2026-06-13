import { createElement, appendChildren, renderBadge } from './adminUtils.js';
import { validateStaticCmsMediaUrl } from './adminValidation.js';

export function renderStaticCmsMediaPreview({ item = {}, fieldName = '', config = {} } = {}) {
  const wrap = createElement('div', { className: 'cms-admin-static-preview' });
  const media = getPreviewMedia(item, fieldName);

  const header = createElement('div', { className: 'cms-admin-static-preview-header' });
  const copy = createElement('div');
  copy.appendChild(createElement('strong', { text: media.value ? getPreviewTitle(media) : 'Chưa có media để preview' }));
  copy.appendChild(createElement('p', {
    className: 'cms-admin-help-text',
    text: media.field ? `Đang preview field: ${media.field}` : 'Chọn item hoặc nhập URL media để xem trước.',
  }));
  header.appendChild(copy);
  header.appendChild(renderBadge(media.kind === 'video' ? 'VIDEO' : 'IMAGE', media.kind === 'video' ? 'warning' : 'success'));
  wrap.appendChild(header);

  if (!media.value) {
    wrap.appendChild(createElement('div', { className: 'cms-admin-static-preview-empty', text: 'Field media đang trống. Nếu item không dùng media này thì có thể để trống.' }));
    return wrap;
  }

  const validation = validateStaticCmsMediaUrl(media.value, config);
  if (!validation.valid) {
    wrap.appendChild(createElement('div', {
      className: 'cms-admin-alert cms-admin-alert-error',
      text: `URL không an toàn hoặc không hợp lệ: ${validation.reason}`,
    }));
    return wrap;
  }

  const frame = createElement('div', { className: 'cms-admin-static-preview-frame' });
  const status = createElement('p', { className: 'cms-admin-help-text cms-admin-static-preview-status', text: media.kind === 'video' ? 'Video chỉ preload metadata, không autoplay.' : 'Đang tải preview ảnh/poster...' });

  if (media.kind === 'video') {
    const video = createElement('video', {
      className: 'cms-admin-static-video-preview',
      attrs: { controls: 'true', preload: 'metadata', playsinline: 'true' },
    });
    video.src = media.value;
    video.addEventListener('error', () => {
      status.textContent = 'Không tải được metadata video. Hãy kiểm tra URL trước khi publish.';
      status.className = 'cms-admin-help-text cms-admin-danger-text cms-admin-static-preview-status';
    });
    video.addEventListener('loadedmetadata', () => {
      status.textContent = `Video metadata OK — ${Math.round(video.duration || 0)} giây.`;
      status.className = 'cms-admin-help-text cms-admin-static-preview-status';
    });
    appendChildren(frame, [video]);
    appendChildren(wrap, [frame, status]);
    return wrap;
  }

  const img = createElement('img', {
    className: 'cms-admin-static-image-preview',
    attrs: { alt: 'Preview media CMS draft', loading: 'lazy' },
  });
  img.src = media.value;
  img.addEventListener('load', () => {
    status.textContent = `Preview OK — ${img.naturalWidth}×${img.naturalHeight}px.`;
    status.className = 'cms-admin-help-text cms-admin-static-preview-status';
  });
  img.addEventListener('error', () => {
    status.textContent = 'Không tải được preview. Hãy kiểm tra path/URL trước khi publish.';
    status.className = 'cms-admin-help-text cms-admin-danger-text cms-admin-static-preview-status';
  });
  appendChildren(frame, [img]);
  appendChildren(wrap, [frame, status]);
  return wrap;
}

export function getPreviewMedia(item = {}, preferredFieldName = '') {
  const field = String(preferredFieldName || '').trim();
  if (field && item[field]) {
    return { field, value: String(item[field]).trim(), kind: isVideoField(field) ? 'video' : 'image' };
  }
  for (const candidate of ['imageUrl', 'image_url', 'image', 'thumbnailUrl', 'thumbnail_url', 'thumbnail', 'posterUrl', 'poster_url', 'poster']) {
    if (item[candidate]) return { field: candidate, value: String(item[candidate]).trim(), kind: 'image' };
  }
  for (const candidate of ['videoUrl', 'video_url']) {
    if (item[candidate]) return { field: candidate, value: String(item[candidate]).trim(), kind: 'video' };
  }
  return { field: '', value: '', kind: 'image' };
}

function getPreviewTitle(media = {}) {
  if (media.kind === 'video') return 'Preview video';
  if (String(media.field || '').toLowerCase().includes('poster')) return 'Preview poster';
  if (String(media.field || '').toLowerCase().includes('thumb')) return 'Preview thumbnail';
  return 'Preview ảnh/logo';
}

function isVideoField(fieldName) {
  return ['videoUrl', 'video_url'].includes(fieldName);
}
