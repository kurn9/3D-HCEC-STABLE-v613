function isSeatColliderName(name = '') {
  const n = String(name).toLowerCase();
  return (
    n.includes('bench') ||
    n.includes('chair') ||
    n.includes('seat') ||
    n.includes('sofa') ||
    n.includes('ghe') ||
    n.includes('sit')
  );
}

function buildBlockingBoxes() {
  blockingBoxes.length = 0;
  colliderBoxes.length = 0;

  for (const obj of colliderObjects) {
    const box = new THREE.Box3().setFromObject(obj);
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) continue;

    const name = getObjectNameTrail(obj);
    const size = box.getSize(new THREE.Vector3());

    if (size.x < 0.03 && size.z < 0.03) continue;

    const padded = box.clone();

    const isSeatCollider = isSeatColliderName(name);
    const isStepAssistCollider = isStairOrWalkableHelperName(name);

    const pad = isSeatCollider ? CONFIG.colliderPadding : CONFIG.wallColliderPadding;

    // Padding nhỏ để avatar có thể đi sát ghế trong đường hẹp.
    // Muốn chặn xa hơn thì tăng collider trong Blender thay vì tăng padding ở code.
    padded.min.x -= pad;
    padded.max.x += pad;
    padded.min.z -= pad;
    padded.max.z += pad;

    const entry = { object: obj, box: padded, rawBox: box, name, isSeatCollider, isStepAssistCollider };

    colliderBoxes.push(entry);
    blockingBoxes.push(entry);
  }
}

function buildSeatPoints() {
  seatPoints.length = 0;
  seatBoxes.length = 0;

  const seatKeywords = ['bench', 'chair', 'seat', 'sofa', 'ghe', 'sit'];

  for (const obj of seatObjects) {
    const name = getObjectNameTrail(obj);
    if (!hasAnyKeyword(name, seatKeywords)) continue;

    const box = new THREE.Box3().setFromObject(obj);
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) continue;

    const size = box.getSize(new THREE.Vector3());
    const longSide = Math.max(size.x, size.z);

    if (size.x < 0.18 || size.z < 0.08) continue;

    const expandedBox = box.clone();
    expandedBox.min.x -= CONFIG.sitDistance * 0.75;
    expandedBox.max.x += CONFIG.sitDistance * 0.75;
    expandedBox.min.z -= CONFIG.sitDistance * 0.75;
    expandedBox.max.z += CONFIG.sitDistance * 0.75;

    seatBoxes.push({ object: obj, box, expandedBox, size, name });

    const center = box.getCenter(new THREE.Vector3());
    const longAxis = size.x >= size.z ? 'x' : 'z';
    const count = Math.max(1, Math.min(8, Math.floor(longSide / 0.75)));

    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : (i + 0.5) / count;
      const pos = new THREE.Vector3(center.x, box.max.y + CONFIG.sitHeightOffset, center.z);

      if (longAxis === 'x') {
        pos.x = THREE.MathUtils.lerp(box.min.x + 0.20, box.max.x - 0.20, t);
      } else {
        pos.z = THREE.MathUtils.lerp(box.min.z + (CONFIG.avatarSeatSideClampMargin || 0.12), box.max.z - (CONFIG.avatarSeatSideClampMargin || 0.12), t);
      }

      seatPoints.push({
        object: obj,
        position: pos,
        box,
        size,
        name
      });
    }
  }
}

function distanceOutsideScore2D(pos, box) {
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const dx = pos.x - cx;
  const dz = pos.z - cz;
  return dx * dx + dz * dz;
}

function isBodyBlockedAt(bodyPosition, currentBodyPosition = null) {
  if (blockingBoxes.length === 0) return false;

  const radius = CONFIG.avatarCollisionRadius;
  const minY = bodyPosition.y + 0.06;
  const maxY = bodyPosition.y + CONFIG.bodyCollisionHeight;

  const insideExpanded = (pos, expandedBox) => (
    pos.x >= expandedBox.min.x &&
    pos.x <= expandedBox.max.x &&
    pos.z >= expandedBox.min.z &&
    pos.z <= expandedBox.max.z
  );

  for (const entry of blockingBoxes) {
    if (entry.isStepAssistCollider) continue;

    const box = entry.box;

    if (box.max.y < minY || box.min.y > maxY) continue;

    // GLB avatar có hình thể thật, không thể dùng vùng chặn quá nhỏ như avatar tĩnh.
    // Ghế/bục dùng radius lớn hơn để thân/đùi không phạm vào ghế khi đi ngang.
    const localRadius = entry.isSeatCollider ? radius * 0.72 : radius;

    const expanded = box.clone();
    expanded.min.x -= localRadius;
    expanded.max.x += localRadius;
    expanded.min.z -= localRadius;
    expanded.max.z += localRadius;

    const nextInside = insideExpanded(bodyPosition, expanded);
    if (!nextInside) continue;

    if (currentBodyPosition) {
      const currentInside = insideExpanded(currentBodyPosition, expanded);

      if (currentInside) {
        const currentScore = distanceOutsideScore2D(currentBodyPosition, expanded);
        const nextScore = distanceOutsideScore2D(bodyPosition, expanded);

        // Nếu đang ở trong collider, cho phép đi ra xa tâm collider.
        if (nextScore > currentScore + 0.0005) return false;
      }
    }

    return true;
  }

  return false;
}


function parseSeatFacingFromName(name) {
  const n = (name || '').toLowerCase();

  // Có thể đổi tên collider trong Blender để ép hướng ngồi:
  // COLLIDER_BENCH_001_FACE_ZP / FACE_ZN / FACE_XP / FACE_XN
  if (n.includes('face_zp') || n.includes('face_front') || n.includes('face_south')) return new THREE.Vector3(0, 0, 1);
  if (n.includes('face_zn') || n.includes('face_back') || n.includes('face_north')) return new THREE.Vector3(0, 0, -1);
  if (n.includes('face_xp') || n.includes('face_right') || n.includes('face_east')) return new THREE.Vector3(1, 0, 0);
  if (n.includes('face_xn') || n.includes('face_left') || n.includes('face_west')) return new THREE.Vector3(-1, 0, 0);

  return null;
}


function getSeatOverride(name = '') {
  const overrides = CONFIG.seatOverrides || {};
  const lowerName = String(name || '').toLowerCase();

  for (const [key, value] of Object.entries(overrides)) {
    const lowerKey = String(key || '').toLowerCase();
    if (!lowerKey) continue;
    if (lowerName === lowerKey || lowerName.includes(lowerKey)) return value || null;
  }

  return null;
}

function applySeatOverrideToPlacement(result, seat, forward, longAxis) {
  const override = getSeatOverride(seat.name);
  if (!override) return result;

  const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
  const offset = Array.isArray(override.positionOffset) ? override.positionOffset : [0, 0, 0];

  result.sitPos.x += Number(offset[0]) || 0;
  result.sitPos.y += Number(offset[1]) || 0;
  result.sitPos.z += Number(offset[2]) || 0;

  if (Number.isFinite(Number(override.depthOffset))) {
    result.sitPos.addScaledVector(forward, Number(override.depthOffset));
  }

  if (Number.isFinite(Number(override.sideOffset))) {
    result.sitPos.addScaledVector(right, Number(override.sideOffset));
  }

  if (Number.isFinite(Number(override.heightOffset))) {
    result.sitPos.y += Number(override.heightOffset);
  }

  if (Number.isFinite(Number(override.yawOffset))) {
    result.yaw += Number(override.yawOffset);
  }

  result.overrideApplied = true;
  result.override = override;
  result.longAxis = longAxis;

  return result;
}

function getSeatPlacement(seat, avatarPos) {
  const box = seat.box;
  const size = seat.size || box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const longAxis = size.x >= size.z ? 'x' : 'z';

  let forward = parseSeatFacingFromName(seat.name);

  // Nếu không đặt hướng bằng tên, tự lấy mặt ghế gần avatar nhất.
  // Cách này ổn định hơn lấy yaw hiện tại, nên không bị xoay mỗi lần một kiểu.
  if (!forward) {
    if (longAxis === 'x') {
      const side = avatarPos.z >= center.z ? 1 : -1;
      forward = new THREE.Vector3(0, 0, side);
    } else {
      const side = avatarPos.x >= center.x ? 1 : -1;
      forward = new THREE.Vector3(side, 0, 0);
    }
  }

  forward.y = 0;
  if (forward.lengthSq() < 0.0001) forward.set(0, 0, 1);
  forward.normalize();

  let sitY = box.max.y + CONFIG.sitHeightOffset;

  // Với avatar GLB có animation ngồi, root của nhân vật nên neo ở sàn,
  // không neo ở mặt ghế. Animation ngồi đã tự co chân/hạ hông.
  // Nếu neo vào mặt ghế rồi lại hạ pivot, nhân vật sẽ tụt xuống dưới ghế.
  const usingGlbSeatAnimation =
    avatar &&
    avatar.userData &&
    avatar.userData.externalModel &&
    CONFIG.avatarUseSitAnimation;

  if (usingGlbSeatAnimation) {
    const groundProbe = center.clone();
    groundProbe.y = box.max.y + CONFIG.eyeHeight;
    const groundY = getGroundYAt(groundProbe);

    sitY = (groundY !== null ? groundY : fallbackFloorY) + CONFIG.avatarSeatHeightOffset;
  }

  const sitPos = new THREE.Vector3(center.x, sitY, center.z);

  // V29: logic ngồi mới.
  // Không đặt root theo giữa ghế nữa vì sẽ làm avatar ngồi lệch.
  // Thay vào đó đặt theo "mép ngồi" gần avatar, rồi lùi nhẹ vào trong ghế.
  const seatDepth = longAxis === 'x' ? size.z : size.x;
  const safeFrontInset = Math.max(0.04, Math.min(seatDepth * 0.42, CONFIG.avatarSeatFrontInset));
  const frontEdgeDepth = Math.max(0, seatDepth * 0.5 - safeFrontInset);

  const fallbackInset = Math.max(0, Math.min(seatDepth * 0.36, CONFIG.sitFrontInset));
  let depthInset = usingGlbSeatAnimation
    ? (frontEdgeDepth + CONFIG.avatarSeatDepthOffset)
    : fallbackInset;

  const minDepthInset = CONFIG.avatarSeatMinDepthInset ?? 0.075;
  const maxDepthInset = CONFIG.avatarSeatMaxDepthInset ?? 0.28;
  depthInset = THREE.MathUtils.clamp(depthInset, minDepthInset, maxDepthInset);

  if (longAxis === 'x') {
    sitPos.x = THREE.MathUtils.clamp(avatarPos.x, box.min.x + (CONFIG.avatarSeatSideClampMargin || 0.12), box.max.x - (CONFIG.avatarSeatSideClampMargin || 0.12));
    sitPos.z = center.z + forward.z * depthInset;
  } else {
    sitPos.z = THREE.MathUtils.clamp(avatarPos.z, box.min.z + (CONFIG.avatarSeatSideClampMargin || 0.12), box.max.z - (CONFIG.avatarSeatSideClampMargin || 0.12));
    sitPos.x = center.x + forward.x * depthInset;
  }

  const yawValue = Math.atan2(forward.x, forward.z);

  const standPos = sitPos.clone().addScaledVector(forward, CONFIG.standUpDistance);
  standPos.y = fallbackFloorY;

  const result = {
    sitPos,
    standPos,
    yaw: yawValue,
    forward,
    longAxis,
    depthInset,
    seatDepth,
  };

  return applySeatOverrideToPlacement(result, seat, forward, longAxis);
}

function getSafeStandPosition(seat) {
  if (!seat || !avatar) return null;

  const baseCandidates = [];

  if (seat.standPosition) baseCandidates.push(seat.standPosition.clone());
  if (lastStandingPosition) baseCandidates.push(lastStandingPosition.clone());

  const box = seat.box;
  const center = box.getCenter(new THREE.Vector3());

  // Tạo thêm nhiều điểm đứng quanh ghế, tránh kẹt trong collider khi đứng dậy.
  const dirs = [
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(1, 0, 1).normalize(),
    new THREE.Vector3(-1, 0, 1).normalize(),
    new THREE.Vector3(1, 0, -1).normalize(),
    new THREE.Vector3(-1, 0, -1).normalize(),
  ];

  for (const dir of dirs) {
    baseCandidates.push(center.clone().addScaledVector(dir, CONFIG.standUpSearchRadius));
  }

  for (const candidate of baseCandidates) {
    const probe = candidate.clone();
    probe.y = avatar.position.y + CONFIG.eyeHeight;

    const groundY = getGroundYAt(probe);
    if (groundY === null) continue;

    candidate.y = groundY;

    // Không dùng vị trí nằm trong collider ghế/bục.
    if (!isBodyBlockedAt(candidate, avatar.position)) {
      return candidate;
    }
  }

  return null;
}


function findNearestSeat() {
  if (!avatar) return null;

  const avatarPos = avatar.position;
  let best = null;
  let bestDistance = Infinity;

  for (const seat of seatBoxes) {
    const dist = distanceToBoxXZ(avatarPos, seat.expandedBox);

    if (dist <= CONFIG.sitDistance && dist < bestDistance) {
      const placement = getSeatPlacement(seat, avatarPos);

      best = {
        object: seat.object,
        position: placement.sitPos,
        standPosition: placement.standPos,
        yaw: placement.yaw,
        forward: placement.forward,
        box: seat.box,
        size: seat.size,
        name: seat.name,
        longAxis: placement.longAxis,
      };

      bestDistance = dist;
    }
  }

  for (const seat of seatPoints) {
    const dx = seat.position.x - avatarPos.x;
    const dz = seat.position.z - avatarPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < bestDistance && dist <= CONFIG.sitDistance) {
      const placement = getSeatPlacement(seat, avatarPos);

      best = {
        ...seat,
        position: placement.sitPos,
        standPosition: placement.standPos,
        yaw: placement.yaw,
        forward: placement.forward,
        longAxis: placement.longAxis,
      };

      bestDistance = dist;
    }
  }

  return best;
}

function setAvatarSitPose(enable, options = {}) {
  if (!avatar) return;

  const pivot = avatar.userData.modelPivot;

  // Nếu đã dùng avatar GLB: ưu tiên animation nếu có.
  // Nếu file GLB không có animation ngồi, ta chỉ hạ pivot rất nhẹ.
  if (pivot && avatar.userData.externalModel) {
    if (enable) {
      // GLB sitting: không hạ pivot nữa. Root đã neo theo sàn trong getSeatPlacement().
      // Nếu vẫn thấp/cao, chỉnh avatarSeatHeightOffset, không chỉnh pivot.
      pivot.position.y = CONFIG.avatarModelYOffset + (avatar.userData.avatarFootOffsetApplied || 0) + CONFIG.avatarModelSitYOffset + CONFIG.avatarSitFootDrop;
      pivot.rotation.x = 0;
      if (options.playAction !== false && CONFIG.avatarUseSitAnimation) playAvatarAction('sit');
    } else {
      pivot.position.y = CONFIG.avatarModelYOffset + (avatar.userData.avatarFootOffsetApplied || 0);
      pivot.rotation.x = 0;
      if (options.playAction !== false) playAvatarAction('idle');
    }
    return;
  }

  if (!avatar.userData.parts) return;

  const p = avatar.userData.parts;

  if (enable) {
    p.torso.position.set(0, 0.58, -0.035);
    p.torso.rotation.x = -0.04;

    p.head.position.set(0, 1.08, -0.035);
    p.head.rotation.x = 0.02;

    p.chest.position.set(0, 0.82, 0.13);
    p.chest.rotation.x = -0.03;

    p.nose.position.set(0, 1.06, 0.14);
    p.nose.rotation.x = Math.PI / 2;

    p.legL.scale.set(1, 0.55, 1);
    p.legR.scale.set(1, 0.55, 1);

    p.legL.rotation.x = -0.22;
    p.legR.rotation.x = -0.22;
    p.legL.position.set(-0.082, 0.20, 0.20);
    p.legR.position.set(0.082, 0.20, 0.20);

    if (p.shadow) {
      p.shadow.scale.set(0.85, 0.62, 1);
      p.shadow.position.y = 0.01;
    }
  } else {
    p.torso.position.set(0, 1.05, 0);
    p.torso.rotation.x = 0;

    p.head.position.set(0, 1.55, 0);
    p.head.rotation.x = 0;

    p.chest.position.set(0, 1.25, 0.15);
    p.chest.rotation.x = 0;

    p.nose.position.set(0, 1.52, 0.17);
    p.nose.rotation.x = Math.PI / 2;

    p.legL.scale.set(1, 1, 1);
    p.legR.scale.set(1, 1, 1);

    p.legL.rotation.x = 0;
    p.legR.rotation.x = 0;
    p.legL.position.set(-0.075, 0.39, 0);
    p.legR.position.set(0.075, 0.39, 0);

    if (p.shadow) {
      p.shadow.scale.set(1, 1, 1);
      p.shadow.position.y = 0.012;
    }
  }
}

function sitOnNearestSeat() {
  if (typeof window.isAvatarSeatTransitionActive === 'function' && window.isAvatarSeatTransitionActive()) {
    setStatus(`⏳ <strong>Avatar đang chuyển tư thế</strong><br>Vui lòng chờ một chút rồi thử lại.`);
    return;
  }

  const seat = findNearestSeat();

  if (!seat) {
    setStatus(`⚠️ <strong>Chưa gần COLLIDER_BENCH để ngồi</strong><br>Hãy đứng sát ghế, nhìn về phía ghế rồi bấm E. Có thể đổi tên collider thêm _FACE_ZP / _FACE_ZN / _FACE_XP / _FACE_XN để cố định hướng ngồi.`);
    return;
  }

  if (typeof window !== 'undefined' && window.__avatarSeatDebugEnabled) {
    console.log('[Seat Debug] selected seat', {
      name: seat.name,
      position: seat.position,
      standPosition: seat.standPosition,
      yaw: seat.yaw,
      longAxis: seat.longAxis,
      size: seat.size,
      box: seat.box,
    });
  }

  isSitting = true;
  activeSeat = seat;
  lastStandingPosition.copy(avatar.position);

  avatar.position.copy(seat.position);
  avatar.rotation.y = seat.yaw;
  yaw = seat.yaw;
  pitch = THREE.MathUtils.clamp(pitch, -0.25, 0.25);

  // H_D_C: pivot/seat pose is applied separately from the animation action.
  // GLB avatar should play sitdown -> sit when those clips are available.
  setAvatarSitPose(true, { playAction: false });
  updateCameraForAvatar(1 / 60);

  const finalizeSit = () => {
    setStatus(`✅ <strong>Đang ngồi ngắm cảnh</strong><br>Chuột: nhìn xung quanh<br>E: đứng dậy<br>Collider: ${seat.name || 'COLLIDER_BENCH'}`);
  };

  const started = CONFIG.avatarUseSitAnimation && CONFIG.avatarUseSitTransitions !== false &&
    typeof window.startAvatarSitDownTransition === 'function' &&
    window.startAvatarSitDownTransition(finalizeSit);

  if (!started) {
    if (CONFIG.avatarUseSitAnimation) playAvatarAction('sit');
    finalizeSit();
  } else {
    setStatus(`⏳ <strong>Đang ngồi xuống</strong><br>Avatar đang chuyển tư thế...`);
  }
}

function finalizeStandUpFromSeat(seat, safePos) {
  isSitting = false;
  activeSeat = null;
  setAvatarSitPose(false, { playAction: false });

  if (safePos) {
    avatar.position.copy(safePos);
  } else if (lastStandingPosition) {
    const fallback = lastStandingPosition.clone();
    const groundY = getGroundYAt(fallback.clone().add(new THREE.Vector3(0, CONFIG.eyeHeight, 0)));
    if (groundY !== null) fallback.y = groundY;
    avatar.position.copy(fallback);
  }

  avatar.rotation.y = yaw;

  // Xóa trạng thái phím đang giữ để tránh vừa đứng dậy đã lập tức đâm lại vào collider.
  keys['KeyW'] = false;
  keys['KeyA'] = false;
  keys['KeyS'] = false;
  keys['KeyD'] = false;
  avatarVelocity.set(0, 0, 0);
  avatarMotionState = 'idle';

  updateCameraForAvatar(1 / 60);

  setStatus(`✅ <strong>Đã đứng dậy</strong><br>WASD: tiếp tục di chuyển avatar<br>E: ngồi khi đứng gần ghế`);
}

function standUpFromSeat() {
  if (!avatar) return;

  if (typeof window.isAvatarSeatTransitionActive === 'function' && window.isAvatarSeatTransitionActive()) {
    setStatus(`⏳ <strong>Avatar đang chuyển tư thế</strong><br>Vui lòng chờ một chút rồi thử lại.`);
    return;
  }

  const seat = activeSeat;
  const safePos = getSafeStandPosition(seat);

  const finish = () => finalizeStandUpFromSeat(seat, safePos);

  const started = CONFIG.avatarUseSitAnimation && CONFIG.avatarUseSitTransitions !== false &&
    typeof window.startAvatarSitUpTransition === 'function' &&
    window.startAvatarSitUpTransition(finish);

  if (started) {
    setStatus(`⏳ <strong>Đang đứng dậy</strong><br>Avatar đang chuyển tư thế...`);
    return;
  }

  finish();
}
