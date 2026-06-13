const imageLightbox = document.getElementById('imageLightbox');
const imageLightboxImg = document.getElementById('imageLightboxImg');
const imageLightboxClose = document.getElementById('imageLightboxClose');

function getModalImageSrc() {
  const direct = modalImage?.dataset?.fullImage || modalImage?.getAttribute('src') || modalImage?.src || '';
  return String(direct || '').trim();
}

function prepareLightboxImage(src, alt) {
  if (!imageLightboxImg) return;
  imageLightboxImg.removeAttribute('src');
  imageLightboxImg.alt = alt || 'Ảnh tác phẩm';
  imageLightboxImg.loading = 'lazy';
  imageLightboxImg.decoding = 'async';

  // Lazy load thật sự: chỉ gán src khi người dùng bấm xem ảnh lớn.
  // Nếu sau này scene.json có imageLarge, dataset.image sẽ ưu tiên ảnh lớn đó.
  requestAnimationFrame(() => {
    imageLightboxImg.src = src;
  });
}

function openImageLightbox(src, alt = 'Ảnh tác phẩm') {
  if (!imageLightbox || !imageLightboxImg || !src) return;
  prepareLightboxImage(src, alt);
  imageLightbox.classList.add('active');
  imageLightbox.setAttribute('aria-hidden', 'false');
}

function closeImageLightbox() {
  if (!imageLightbox || !imageLightboxImg) return;
  imageLightbox.classList.remove('active');
  imageLightbox.setAttribute('aria-hidden', 'true');
  imageLightboxImg.removeAttribute('src');
}

if (imageLightboxImg) {
  imageLightboxImg.addEventListener('error', () => {
    if (typeof setStatus === 'function') {
      setStatus('⚠️ <strong>Không tải được ảnh lớn</strong>');
    }
  });
}

if (openImageBtn) {
  openImageBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const src = openImageBtn.dataset.image || getModalImageSrc();
    if (src) openImageLightbox(src, modalTitle?.textContent || 'Ảnh tác phẩm');
  });
}

if (modalImage) {
  modalImage.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const src = getModalImageSrc();
    if (src) openImageLightbox(src, modalTitle?.textContent || 'Ảnh tác phẩm');
  });
}

if (imageLightboxClose) {
  imageLightboxClose.addEventListener('click', closeImageLightbox);
}

if (imageLightbox) {
  imageLightbox.addEventListener('click', (event) => {
    if (event.target === imageLightbox) closeImageLightbox();
  });
}

document.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && imageLightbox?.classList.contains('active')) {
    event.stopPropagation();
    closeImageLightbox();
  }
}, true);
