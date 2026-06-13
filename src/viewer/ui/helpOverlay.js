const helpOverlay = document.getElementById('helpOverlay');
const helpToggleBtn = document.getElementById('helpToggleBtn');
const helpCloseBtn = document.getElementById('helpCloseBtn');
const helpStartBtn = document.getElementById('helpStartBtn');
const helpHideBtn = document.getElementById('helpHideBtn');
const helpDontShowAgain = document.getElementById('helpDontShowAgain');

function getHelpStorageKey() {
  return CONFIG.helpStorageKey || 'galleryViewerHelpHiddenV32';
}

function isHelpHiddenByUser() {
  try {
    return localStorage.getItem(getHelpStorageKey()) === 'true';
  } catch (error) {
    return false;
  }
}

function saveHelpPreference() {
  if (!helpDontShowAgain) return;
  try {
    if (helpDontShowAgain.checked) {
      localStorage.setItem(getHelpStorageKey(), 'true');
    } else {
      localStorage.removeItem(getHelpStorageKey());
    }
  } catch (error) {
    console.warn('Không lưu được trạng thái hướng dẫn.', error);
  }
}

function closeViewerTransientPanels() {
  if (document.pointerLockElement) document.exitPointerLock();
  if (typeof closeModal === 'function' && modalOpen) closeModal();
  if (typeof closeImageLightbox === 'function') closeImageLightbox();
  if (typeof closeArtworkListPanel === 'function') closeArtworkListPanel();
}

function openHelpOverlay() {
  if (!helpOverlay) return;
  closeViewerTransientPanels();
  helpOverlay.classList.add('active');
  helpOverlay.setAttribute('aria-hidden', 'false');
  if (helpDontShowAgain) helpDontShowAgain.checked = isHelpHiddenByUser();
  setTimeout(() => helpStartBtn?.focus(), 40);
}

function closeHelpOverlay({ requestLock = false } = {}) {
  if (!helpOverlay) return;
  saveHelpPreference();
  helpOverlay.classList.remove('active');
  helpOverlay.setAttribute('aria-hidden', 'true');

  if (requestLock && renderer?.domElement && !modalOpen) {
    setTimeout(() => {
      try {
        renderer.domElement.requestPointerLock();
      } catch (error) {
        console.warn('Không thể khóa chuột sau khi đóng hướng dẫn.', error);
      }
    }, 30);
  }
}

function shouldShowInitialHelp() {
  if (CONFIG.showHelpOnFirstVisit === false) return false;
  return !isHelpHiddenByUser();
}

if (helpToggleBtn) {
  helpToggleBtn.addEventListener('click', (event) => {
    event.preventDefault();
    openHelpOverlay();
  });
}

if (helpCloseBtn) {
  helpCloseBtn.addEventListener('click', () => closeHelpOverlay());
}

if (helpHideBtn) {
  helpHideBtn.addEventListener('click', () => closeHelpOverlay());
}

if (helpStartBtn) {
  helpStartBtn.addEventListener('click', () => closeHelpOverlay({ requestLock: true }));
}

if (helpOverlay) {
  helpOverlay.addEventListener('click', (event) => {
    if (event.target === helpOverlay) closeHelpOverlay();
  });
}

document.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && helpOverlay?.classList.contains('active')) {
    event.preventDefault();
    event.stopPropagation();
    closeHelpOverlay();
  }
}, true);

if (shouldShowInitialHelp()) {
  if (document.readyState === 'complete') {
    setTimeout(openHelpOverlay, 260);
  } else {
    window.addEventListener('load', () => {
      setTimeout(openHelpOverlay, 260);
    }, { once: true });
  }
}

window.openHelpOverlay = openHelpOverlay;
window.closeHelpOverlay = closeHelpOverlay;
