const homePositionBtn = document.getElementById('homePositionBtn');

let homeState = null;
let homeSaveTimer = null;

function cloneVectorLike(vector, fallback = null) {
  if (!vector || typeof vector.clone !== 'function') return fallback;
  return vector.clone();
}

function clearMovementInputForHome() {
  ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].forEach((code) => {
    keys[code] = false;
  });

  if (avatarVelocity) avatarVelocity.set(0, 0, 0);
  avatarMotionState = 'idle';
}

function saveHomePosition() {
  const avatarBody = avatar ? cloneVectorLike(avatar.position) : null;
  const cameraEye = cloneVectorLike(camera.position);

  if (!cameraEye && !avatarBody) return null;

  homeState = {
    avatarPosition: avatarBody,
    avatarYaw: avatar ? avatar.rotation.y : yaw,
    cameraPosition: cameraEye,
    cameraRotation: camera.rotation.clone(),
    yaw,
    pitch,
    viewMode,
    savedAt: Date.now(),
  };

  return homeState;
}

function tryAutoSaveHomePosition() {
  if (homeState) return true;
  if (!roomLoaded) return false;

  // Avatar root được tạo ngay sau khi phòng load. Model GLB có thể còn tải tiếp,
  // nhưng vị trí root đã là điểm bắt đầu an toàn.
  saveHomePosition();
  return !!homeState;
}

function startHomePositionAutoSave() {
  if (homeSaveTimer) return;

  homeSaveTimer = window.setInterval(() => {
    if (tryAutoSaveHomePosition()) {
      window.clearInterval(homeSaveTimer);
      homeSaveTimer = null;
    }
  }, 180);
}

function closePanelsBeforeGoingHome() {
  if (document.pointerLockElement) document.exitPointerLock();
  if (typeof closeModal === 'function' && modalOpen) closeModal();
  if (typeof closeImageLightbox === 'function') closeImageLightbox();
  if (typeof closeArtworkListPanel === 'function') closeArtworkListPanel();
}

function goHome() {
  if (isSitting) {
    setStatus('⚠️ <strong>Hãy đứng dậy trước khi về điểm bắt đầu</strong><br>Bấm E để đứng dậy, sau đó bấm lại nút này.');
    return false;
  }

  if (!homeState) {
    tryAutoSaveHomePosition();
  }

  if (!homeState) {
    setStatus('⚠️ <strong>Chưa lưu được điểm bắt đầu</strong><br>Đợi phòng tải xong rồi thử lại.');
    return false;
  }

  closePanelsBeforeGoingHome();
  clearMovementInputForHome();

  yaw = Number.isFinite(homeState.yaw) ? homeState.yaw : 0;
  pitch = Number.isFinite(homeState.pitch) ? homeState.pitch : 0;

  if (avatar && homeState.avatarPosition) {
    avatar.position.copy(homeState.avatarPosition);
    if (typeof snapAvatarRootToGround === 'function') {
      snapAvatarRootToGround(avatar, 'goHome');
    }
    if (typeof applyAvatarGroundOffset === 'function') {
      applyAvatarGroundOffset(avatar, 'goHome');
    }
    avatar.rotation.y = Number.isFinite(homeState.avatarYaw) ? homeState.avatarYaw : yaw;
    avatarTargetYaw = avatar.rotation.y;
  }

  if (viewMode === 'third' && avatar) {
    avatar.visible = true;
    forceAvatarCameraView();
  } else if (homeState.cameraPosition) {
    camera.position.copy(homeState.cameraPosition);
    if (homeState.cameraRotation) camera.rotation.copy(homeState.cameraRotation);

    if (avatar) {
      avatar.position.set(
        camera.position.x,
        camera.position.y - CONFIG.eyeHeight,
        camera.position.z
      );
      if (typeof snapAvatarRootToGround === 'function') {
        snapAvatarRootToGround(avatar, 'goHome_first_person_sync');
      }
      avatar.rotation.y = yaw;
      avatar.visible = viewMode === 'third';
    }
  }

  setStatus('✅ <strong>Đã về điểm bắt đầu</strong><br>Click vào không gian 3D để tiếp tục tham quan.');
  return true;
}

if (homePositionBtn) {
  homePositionBtn.addEventListener('click', (event) => {
    event.preventDefault();
    goHome();
  });
}

startHomePositionAutoSave();

window.saveHomePosition = saveHomePosition;
window.goHome = goHome;
