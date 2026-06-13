function getArtworkRootById(id) {
  const targetId = String(id || '').trim();
  if (!targetId) return null;

  return artworkRoots.find((root) => {
    const data = root.userData?.artData || {};
    return root.name === targetId || data.id === targetId;
  }) || null;
}

function getArtworkVisibleNormal(root, artworkPosition) {
  const normal = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()))
    .normalize();

  const toCamera = camera.position.clone().sub(artworkPosition);
  toCamera.y = 0;

  if (toCamera.lengthSq() > 0.0001 && normal.dot(toCamera.normalize()) < 0) {
    normal.multiplyScalar(-1);
  }

  return normal;
}

function getArtworkFocusDistance(root) {
  const data = root.userData?.artData || {};
  const size = data.size || root.userData?.size || [];
  const width = Number(size[0]) || 1.2;
  const height = Number(size[1]) || 0.75;
  return Math.max(1.55, Math.min(4.2, Math.max(width, height) * 1.35));
}

function aimCameraAtArtwork(eyePosition, artworkPosition) {
  camera.position.copy(eyePosition);
  camera.lookAt(artworkPosition);
  yaw = camera.rotation.y;
  pitch = camera.rotation.x;
}

function focusArtworkById(id, options = {}) {
  const root = getArtworkRootById(id);
  if (!root) {
    setStatus('⚠️ <strong>Không tìm thấy tác phẩm</strong>');
    return null;
  }

  const data = root.userData?.artData || {};
  if (data.clickable === false) return null;

  const artworkPosition = new THREE.Vector3();
  root.getWorldPosition(artworkPosition);

  const normal = getArtworkVisibleNormal(root, artworkPosition);
  const distance = getArtworkFocusDistance(root);
  const standBodyPosition = artworkPosition.clone().addScaledVector(normal, distance);
  standBodyPosition.y = artworkPosition.y - 0.02;

  const groundY = typeof getGroundYAt === 'function'
    ? getGroundYAt(new THREE.Vector3(standBodyPosition.x, artworkPosition.y + CONFIG.eyeHeight, standBodyPosition.z))
    : null;

  if (groundY !== null && Number.isFinite(groundY)) {
    standBodyPosition.y = groundY;
  } else if (avatar) {
    standBodyPosition.y = avatar.position.y;
  } else {
    standBodyPosition.y = camera.position.y - CONFIG.eyeHeight;
  }

  const directionToArtwork = artworkPosition.clone().sub(standBodyPosition);
  directionToArtwork.y = 0;
  if (directionToArtwork.lengthSq() > 0.0001) {
    directionToArtwork.normalize();
    yaw = Math.atan2(directionToArtwork.x, directionToArtwork.z);
    pitch = 0;
  }

  if (avatar && viewMode === 'third' && !isSitting) {
    avatar.position.copy(standBodyPosition);
    avatar.rotation.y = yaw;
    avatarTargetYaw = yaw;
    avatarVelocity.set(0, 0, 0);
    forceAvatarCameraView();
  } else {
    const eyePosition = standBodyPosition.clone();
    eyePosition.y += CONFIG.eyeHeight;
    aimCameraAtArtwork(eyePosition, artworkPosition);
  }

  currentFocusedRoot = root;
  updateFocusCard(root);
  setStatus(`✅ <strong>Đã định vị tác phẩm</strong>`);

  if (options.openModalAfterFocus !== false) {
    setTimeout(() => openModal(root), options.modalDelay || 220);
  }

  return root;
}
