import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadClassicScriptsInOrder } from '../shared/scriptLoader.js';

window.THREE = THREE;
window.GLTFLoader = GLTFLoader;

const moduleUrls = [
  './src/editor/config/editorConfig.js',
  './src/editor/core/domThreeState.js',
  './src/editor/validation/sceneValidator.js',
  './src/editor/storage/backupManager.js',
  './src/editor/ui/previewPopup.js',
  './src/editor/core/initLoaders.js',
  './src/editor/controls/pointerWalk.js',
  './src/editor/interactions/itemBuilder.js',
  './src/editor/ui/listForm.js',
  './src/editor/interactions/editorActions.js',
  './src/editor/controls/actionBindings.js',
  './src/editor/core/loopResize.js'
];

await loadClassicScriptsInOrder(moduleUrls);

if (typeof window.init !== 'function') {
  throw new Error('Editor bootstrap lỗi: init chưa sẵn sàng.');
}
if (typeof window.animate !== 'function') {
  throw new Error('Editor bootstrap lỗi: animate chưa sẵn sàng.');
}

window.animate();
window.init();
