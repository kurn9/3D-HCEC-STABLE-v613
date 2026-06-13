(function initAvatarDebugModule() {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get('debugAvatar') === '1' || CONFIG.debugAvatar === true;

  window.__avatarSeatDebugEnabled = enabled;

  if (!enabled) return;

  const panel = document.createElement('div');
  panel.id = 'avatarDebugPanel';
  panel.className = 'avatar-debug-panel';
  panel.innerHTML = '<strong>AVATAR DEBUG</strong><pre>Đang chờ avatar...</pre>';
  document.body.appendChild(panel);

  const markerMaterialFoot = new THREE.MeshBasicMaterial({ color: 0x8fd9ff, depthTest: false });
  const markerMaterialGround = new THREE.MeshBasicMaterial({ color: 0x61e58b, depthTest: false });
  const markerMaterialSeat = new THREE.MeshBasicMaterial({ color: 0xf2c76e, depthTest: false });

  const footMarker = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), markerMaterialFoot);
  const groundMarker = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), markerMaterialGround);
  const seatMarker = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), markerMaterialSeat);

  footMarker.name = 'DEBUG_AVATAR_FOOT_MARKER';
  groundMarker.name = 'DEBUG_AVATAR_GROUND_MARKER';
  seatMarker.name = 'DEBUG_SEAT_TARGET_MARKER';

  footMarker.renderOrder = 999;
  groundMarker.renderOrder = 999;
  seatMarker.renderOrder = 999;

  scene.add(footMarker, groundMarker, seatMarker);

  let lastPanelUpdate = 0;

  function formatVec(v) {
    if (!v) return '—';
    return `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}`;
  }

  function getFootWorldY() {
    if (!avatar || !avatar.userData?.externalModel || typeof computeAvatarModelBox !== 'function') return null;
    const box = computeAvatarModelBox(avatar.userData.externalModel);
    return box ? box.min.y : null;
  }

  function updateMarkers() {
    const hasAvatar = !!avatar;
    footMarker.visible = hasAvatar;
    groundMarker.visible = hasAvatar;

    if (hasAvatar) {
      const footY = getFootWorldY();
      const y = Number.isFinite(footY) ? footY : avatar.position.y;
      footMarker.position.set(avatar.position.x, y + 0.04, avatar.position.z);

      const groundY = typeof getAvatarGroundingTargetY === 'function'
        ? getAvatarGroundingTargetY(avatar)
        : null;

      if (groundY !== null) {
        groundMarker.visible = true;
        groundMarker.position.set(avatar.position.x, groundY + 0.035, avatar.position.z);
      } else {
        groundMarker.visible = false;
      }
    }

    let seat = null;
    try {
      if (isSitting && activeSeat) seat = activeSeat;
      else if (typeof findNearestSeat === 'function') seat = findNearestSeat();
    } catch (err) {
      seat = null;
    }

    if (seat && seat.position) {
      seatMarker.visible = true;
      seatMarker.position.copy(seat.position).add(new THREE.Vector3(0, 0.08, 0));
    } else {
      seatMarker.visible = false;
    }
  }

  function updatePanel(now) {
    if (now - lastPanelUpdate < 120) return;
    lastPanelUpdate = now;

    const groundY = avatar && typeof getAvatarGroundingTargetY === 'function'
      ? getAvatarGroundingTargetY(avatar)
      : null;
    const footInfo = avatar?.userData?.avatarFootOffsetInfo;
    const footY = getFootWorldY();

    let nearestSeatName = '—';
    let nearestSeatPos = '—';
    try {
      const seat = typeof findNearestSeat === 'function' ? findNearestSeat() : null;
      if (seat) {
        nearestSeatName = seat.name || 'unnamed';
        nearestSeatPos = formatVec(seat.position);
      }
    } catch (err) {}

    panel.querySelector('pre').textContent = [
      `viewMode: ${viewMode}`,
      `isSitting: ${isSitting}`,
      `avatar: ${formatVec(avatar?.position)}`,
      `camera: ${formatVec(camera?.position)}`,
      `groundY: ${groundY === null ? '—' : groundY.toFixed(3)}`,
      `footBottomY: ${footY === null ? '—' : footY.toFixed(3)}`,
      `footOffsetApplied: ${(avatar?.userData?.avatarFootOffsetApplied || 0).toFixed(3)}`,
      `animation: ${currentAvatarActionName || avatarMotionState || '—'}`,
      `velocity: ${avatarVelocity ? avatarVelocity.length().toFixed(3) : '—'}`,
      `activeSeat: ${activeSeat?.name || '—'}`,
      `nearestSeat: ${nearestSeatName}`,
      `seatTarget: ${nearestSeatPos}`,
      `rampWalkable: ${rampWalkableObjects.length}`,
      `walkable: ${walkableObjects.length}`,
      `colliders: ${colliderObjects.length}`,
      `footReason: ${footInfo?.reason || '—'}`,
    ].join('\n');
  }

  function tick(now) {
    updateMarkers();
    updatePanel(now || performance.now());
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  window.__avatarDebugOverlay = {
    panel,
    footMarker,
    groundMarker,
    seatMarker,
    logSeats() {
      console.table(seatBoxes.map((item) => ({ name: item.name, sizeX: item.size.x, sizeY: item.size.y, sizeZ: item.size.z })));
      return seatBoxes;
    },
    groundNow() {
      return typeof groundAvatarNow === 'function' ? groundAvatarNow('debug_overlay') : null;
    }
  };
})();
