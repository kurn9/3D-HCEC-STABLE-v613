// FEATURE V6.11 — Index-only video config
// Cấu hình riêng cho video trên trang index. Không dùng wallVideoUrl/gallery config/scene JSON.

export const INDEX_VIDEO_CONFIG = {
  src: 'https://pub-d00970587980484399ff842b58cd1e9e.r2.dev/intro.mp4',
  poster: '',
  title: 'Video giới thiệu triển lãm',
  heroPreload: 'auto',
  mobileHeroPreload: 'metadata',
  modalPreload: 'metadata',
  desktopHeroAutoplay: true,
  // Mobile tries muted inline autoplay; browser policy failures fall back to click-to-play.
  mobileHeroAutoplay: true,
  loadingFallbackTimeoutMs: 5500,
  modalFallbackTimeoutMs: 6200,
  loadingText: 'Video giới thiệu đang tải',
  fallbackText: 'Chạm để xem video giới thiệu',
  modalLoadingText: 'Đang mở video giới thiệu…',
  modalPlayFallbackText: 'Video chưa tự phát. Vui lòng bấm nút Play trên khung video.',
  autoplayFallbackText: 'Chạm để xem video giới thiệu',
  unsupportedText: 'Trình duyệt/thiết bị hiện không hỗ trợ định dạng video này. Vui lòng xem trên Chrome/Edge máy tính hoặc dùng bản video tương thích sau.',
  // Probe chỉ là tín hiệu tham khảo; không dùng để chặn phát video tuyệt đối.
  mimeType: 'video/mp4',
  compatibilityProbe: true
};
