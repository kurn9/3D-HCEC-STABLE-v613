const audioToggleBtn = document.getElementById('audioToggleBtn');
const ambientAudio = document.getElementById('ambientAudio');
const AUDIO_STORAGE_KEY = 'galleryViewerAmbientAudioPreferenceV322';
const MOVEMENT_AUDIO_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

let audioAvailable = true;
let audioFailureNotified = false;
let autoStartAttempted = false;
let userManuallyStopped = getAudioPreference() === 'off';
let mediaDuckState = null;

function getAudioPreference() {
  try {
    return localStorage.getItem(AUDIO_STORAGE_KEY);
  } catch (error) {
    return null;
  }
}

function setAudioPreference(value) {
  try {
    if (!value) localStorage.removeItem(AUDIO_STORAGE_KEY);
    else localStorage.setItem(AUDIO_STORAGE_KEY, value);
  } catch (error) {
    console.warn('Không lưu được trạng thái âm thanh.', error);
  }
}

function setButtonIcon(icon) {
  if (!audioToggleBtn) return;
  const iconEl = audioToggleBtn.querySelector('.audio-icon');
  if (iconEl) iconEl.textContent = icon;
  else audioToggleBtn.textContent = icon;
}

function updateAudioButton(isPlaying = false) {
  if (!audioToggleBtn) return;

  audioToggleBtn.classList.toggle('active', isPlaying);
  audioToggleBtn.classList.toggle('unavailable', !audioAvailable);
  audioToggleBtn.setAttribute('aria-pressed', String(isPlaying));
  audioToggleBtn.setAttribute('aria-label', isPlaying ? 'Tắt âm thanh nền' : 'Bật âm thanh nền');
  audioToggleBtn.title = isPlaying ? 'Tắt âm thanh nền' : 'Bật âm thanh nền';
  setButtonIcon(isPlaying ? '🔊' : '🔇');
}

function showAudioNotice(message) {
  if (typeof statusEl !== 'undefined' && statusEl) statusEl.innerHTML = message;
  else if (typeof setStatus === 'function') setStatus(message);
}

function notifyMissingAudio() {
  if (audioFailureNotified) return;
  audioFailureNotified = true;
  showAudioNotice('⚠️ <strong>Chưa tìm thấy file âm thanh nền</strong><br>Hãy đặt file tại <b>assets/audio/ambient.mp3</b>.');
}

function notifyAudioBlocked() {
  showAudioNotice('⚠️ <strong>Trình duyệt chưa cho phép phát âm thanh</strong><br>Hãy bấm biểu tượng loa trong mini map để bật lại.');
}

function configureAmbientAudio() {
  if (!ambientAudio) {
    audioAvailable = false;
    updateAudioButton(false);
    return;
  }

  if (CONFIG.ambientAudioUrl && ambientAudio.getAttribute('src') !== CONFIG.ambientAudioUrl) {
    ambientAudio.src = CONFIG.ambientAudioUrl;
  }

  ambientAudio.volume = Math.max(0, Math.min(1, Number(CONFIG.ambientAudioVolume) || 0.18));

  if (getAudioPreference() === 'off') {
    audioToggleBtn?.classList.add('preferred-off');
  }
}

function stopAmbientAudio(options = {}) {
  if (!ambientAudio) return;
  ambientAudio.pause();
  updateAudioButton(false);

  if (options.manual !== false) {
    userManuallyStopped = true;
    setAudioPreference('off');
  }
}

async function startAmbientAudio(options = {}) {
  if (!ambientAudio || !audioAvailable) {
    notifyMissingAudio();
    updateAudioButton(false);
    return false;
  }

  if (CONFIG.ambientAudioDoNotRestartAfterManualMute !== false && userManuallyStopped && options.manual !== true && options.force !== true) {
    updateAudioButton(false);
    return false;
  }

  try {
    if (!options.keepCurrentVolume) {
      ambientAudio.volume = Math.max(0, Math.min(1, Number(CONFIG.ambientAudioVolume) || 0.18));
    }
    await ambientAudio.play();
    audioAvailable = true;
    audioFailureNotified = false;
    if (options.preserveManualState !== true) userManuallyStopped = false;
    updateAudioButton(true);

    if (options.manual === true) {
      setAudioPreference('on');
    }

    return true;
  } catch (error) {
    const isPolicyBlock = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');

    if (isPolicyBlock) {
      notifyAudioBlocked();
    } else {
      console.warn('Không phát được âm thanh nền. Kiểm tra ./assets/audio/ambient.mp3.', error);
      audioAvailable = false;
      notifyMissingAudio();
    }

    updateAudioButton(false);
    return false;
  }
}

function toggleAmbientAudio() {
  if (!ambientAudio || ambientAudio.paused) {
    userManuallyStopped = false;
    startAmbientAudio({ manual: true });
  } else {
    stopAmbientAudio({ manual: true });
  }
}

function isAmbientAudioPlaying() {
  return Boolean(ambientAudio && !ambientAudio.paused && !ambientAudio.ended);
}

function pauseAmbientAudioForMedia(options = {}) {
  if (!ambientAudio) return null;
  if (mediaDuckState) return mediaDuckState;

  const wasPlaying = isAmbientAudioPlaying();
  mediaDuckState = {
    reason: options.reason || 'media',
    wasPlaying,
    previousVolume: ambientAudio.volume,
    pausedByMedia: false,
    duckedByMedia: false,
  };

  if (!wasPlaying) return mediaDuckState;

  if (CONFIG.ambientAudioPauseDuringVideoCinema !== false) {
    ambientAudio.pause();
    mediaDuckState.pausedByMedia = true;
    updateAudioButton(false);
  } else {
    const duckVolume = Math.max(0, Math.min(1, Number(CONFIG.ambientAudioMediaDuckingVolume) || 0.05));
    ambientAudio.volume = duckVolume;
    mediaDuckState.duckedByMedia = true;
  }

  return mediaDuckState;
}

async function restoreAmbientAudioAfterMedia() {
  if (!ambientAudio || !mediaDuckState) return false;

  const state = mediaDuckState;
  mediaDuckState = null;
  ambientAudio.volume = Math.max(0, Math.min(1, state.previousVolume ?? Number(CONFIG.ambientAudioVolume) ?? 0.18));

  if (!state.wasPlaying || userManuallyStopped) {
    updateAudioButton(isAmbientAudioPlaying());
    return false;
  }

  if (state.pausedByMedia) {
    return startAmbientAudio({ force: true, preserveManualState: true, keepCurrentVolume: true });
  }

  updateAudioButton(isAmbientAudioPlaying());
  return isAmbientAudioPlaying();
}

function isMovementKeyEvent(event) {
  const tagName = String(event?.target?.tagName || '').toLowerCase();
  const isTypingField = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
  if (isTypingField) return false;
  return MOVEMENT_AUDIO_KEYS.has(event?.code);
}

function shouldSkipAutoStart(event) {
  if (!CONFIG.ambientAudioAutoStartAfterGesture && !CONFIG.ambientAudioAutoStartOnMovement) return true;
  if (autoStartAttempted) return true;
  if (CONFIG.ambientAudioDoNotRestartAfterManualMute !== false && userManuallyStopped) return true;
  if (!ambientAudio || !ambientAudio.paused) return true;
  if (event?.target?.closest && event.target.closest('#audioToggleBtn')) return true;

  if (CONFIG.ambientAudioAutoStartOnMovement !== false) {
    return !isMovementKeyEvent(event);
  }

  return false;
}

function tryAutoStartAfterGesture(event) {
  if (shouldSkipAutoStart(event)) return;
  autoStartAttempted = true;
  startAmbientAudio({ manual: false, auto: true });
}

function registerAudioAutoStart() {
  if (CONFIG.ambientAudioAutoStartOnMovement !== false) {
    document.addEventListener('keydown', tryAutoStartAfterGesture, {
      passive: true,
      capture: true,
    });
    return;
  }

  const autoEvents = ['pointerdown', 'keydown', 'touchstart'];
  autoEvents.forEach((eventName) => {
    document.addEventListener(eventName, tryAutoStartAfterGesture, {
      passive: true,
      capture: true,
    });
  });
}

if (ambientAudio) {
  ambientAudio.addEventListener('error', () => {
    audioAvailable = false;
    updateAudioButton(false);
    notifyMissingAudio();
  });

  ambientAudio.addEventListener('ended', () => updateAudioButton(false));
  ambientAudio.addEventListener('pause', () => {
    if (!ambientAudio.ended && !mediaDuckState?.pausedByMedia) updateAudioButton(false);
  });
  ambientAudio.addEventListener('play', () => updateAudioButton(true));
}

if (audioToggleBtn) {
  audioToggleBtn.addEventListener('click', (event) => {
    event.preventDefault();
    toggleAmbientAudio();
  });
}

configureAmbientAudio();
updateAudioButton(false);
registerAudioAutoStart();

window.toggleAmbientAudio = toggleAmbientAudio;
window.startAmbientAudio = startAmbientAudio;
window.stopAmbientAudio = stopAmbientAudio;
window.isAmbientAudioPlaying = isAmbientAudioPlaying;
window.pauseAmbientAudioForMedia = pauseAmbientAudioForMedia;
window.restoreAmbientAudioAfterMedia = restoreAmbientAudioAfterMedia;
