import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadClassicScriptsInOrder } from '../shared/scriptLoader.js';

window.THREE = THREE;
window.GLTFLoader = GLTFLoader;

const moduleUrls = [
  './src/shared/cmsSchemaValidator.js',
  './src/shared/cmsContentLoader.js',
  './src/viewer/config/roomRegistry.js',
  './src/shared/sceneDraftPreview.js',
  './src/viewer/config/viewerConfig.js',
  './src/viewer/mobile/mobileDevice.js',
  './src/viewer/core/domThreeState.js',
  './src/viewer/ui/statusFocus.js',
  './src/viewer/avatar/avatarLoaderAnimationCamera.js',
  './src/viewer/utils/geometryUtils.js',
  './src/viewer/loaders/publishedSceneLoader.js',
  './src/viewer/loaders/roomArtworkLoader.js',
  './src/viewer/interactions/seatInteraction.js',
  './src/viewer/media/sceneVideoCinema.js',
  './src/viewer/interactions/artworkModalInteraction.js',
  './src/viewer/avatar/avatarGrounding.js',
  './src/viewer/ui/imageLightbox.js',
  './src/viewer/navigation/artworkFocus.js',
  './src/viewer/ui/artworkList.js',
  './src/viewer/navigation/homePosition.js',
  './src/viewer/ui/minimap.js',
  './src/viewer/ui/audioControl.js',
  './src/viewer/media/wallVideoPanel.js',
  './src/viewer/media/wallVideoCinema.js',
  './src/viewer/ui/performanceStats.js',
  './src/viewer/debug/avatarDebug.js',
  './src/viewer/avatar/movement.js',
  './src/viewer/core/loopAndResize.js',
  './src/viewer/mobile/mobileViewport.js',
  './src/viewer/mobile/orientationOverlay.js',
  './src/viewer/mobile/touchControls.js',
  './src/viewer/controls/eventHandlers.js'
];

try {
  await loadClassicScriptsInOrder(moduleUrls);
} catch (error) {
  try {
    window.dispatchEvent(new CustomEvent('viewer:fatal-error', {
      detail: {
        message: 'Không tải được script viewer.',
        details: error?.scriptUrl || error?.message || String(error),
        source: 'viewer-script-loader',
        error
      }
    }));
  } catch (_) {}
  throw error;
}


function hideViewerEntryLoading() {
  const overlay = document.getElementById('viewerEntryLoading');
  if (!overlay || overlay.classList.contains('is-hidden')) return;
  overlay.classList.add('is-hidden');
  document.body.classList.add('viewer-entry-ready');
}

function initViewerEntryLoading() {
  const loadingWrap = document.getElementById('loadingWrap');
  if (loadingWrap && 'MutationObserver' in window) {
    const observer = new MutationObserver(() => {
      if (loadingWrap.classList.contains('hidden')) {
        hideViewerEntryLoading();
        observer.disconnect();
      }
    });
    observer.observe(loadingWrap, { attributes: true, attributeFilter: ['class'] });
  }

  window.setTimeout(hideViewerEntryLoading, 4200);
}

initViewerEntryLoading();


if (typeof window.loadRoom !== 'function') {
  throw new Error('Viewer bootstrap lỗi: loadRoom chưa sẵn sàng.');
}
if (typeof window.animate !== 'function') {
  throw new Error('Viewer bootstrap lỗi: animate chưa sẵn sàng.');
}

if (typeof window.initWallVideoPanel === 'function') {
  window.initWallVideoPanel();
}

if (typeof window.initWallVideoCinema === 'function') {
  window.initWallVideoCinema();
}

window.loadRoom();
window.animate();
