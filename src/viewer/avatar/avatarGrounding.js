function getAvatarGroundingTargetY(root = avatar) {
  if (!root) return null;

  if (typeof getGroundYAt === 'function') {
    const probe = new THREE.Vector3(root.position.x, root.position.y + CONFIG.eyeHeight, root.position.z);
    const groundY = getGroundYAt(probe);
    if (groundY !== null && Number.isFinite(groundY)) {
      return groundY + (CONFIG.avatarFootGroundOffset || 0);
    }
  }

  if (Number.isFinite(fallbackFloorY)) return fallbackFloorY + (CONFIG.avatarFootGroundOffset || 0);
  return null;
}

function snapAvatarRootToGround(root = avatar, reason = 'ground_snap') {
  if (!root || !CONFIG.avatarGroundSnapOnSpawn) return null;

  const targetY = getAvatarGroundingTargetY(root);
  if (targetY === null) return null;

  const delta = targetY - root.position.y;
  const maxDelta = CONFIG.avatarGroundSnapMaxDelta ?? 0.9;

  if (Math.abs(delta) <= maxDelta) {
    root.position.y = targetY;
  }

  root.userData.avatarGroundY = targetY;
  root.userData.avatarGroundSnapReason = reason;
  root.userData.avatarGroundSnapDelta = delta;

  return targetY;
}

function calculateAvatarFootOffset(root = avatar) {
  if (!root || !root.userData) return null;

  const model = root.userData.externalModel;
  const pivot = root.userData.modelPivot;

  if (!model || !pivot || typeof computeAvatarModelBox !== 'function') {
    return null;
  }

  model.updateWorldMatrix(true, true);
  pivot.updateWorldMatrix(true, true);
  root.updateWorldMatrix(true, true);

  const box = computeAvatarModelBox(model);
  if (!box) return null;

  const desiredFootY = root.position.y + (CONFIG.avatarGroundVisualOffset || 0);
  const rawOffset = desiredFootY - box.min.y;
  const maxAdjust = CONFIG.avatarGroundingMaxPivotAdjust ?? 0.38;
  const offset = clampFinite(rawOffset, -maxAdjust, maxAdjust, 0);

  return {
    offset,
    rawOffset,
    footBottomWorldY: box.min.y,
    desiredFootY,
    box,
    pivotY: pivot.position.y,
  };
}

function applyAvatarGroundOffset(root = avatar, reason = 'avatar_ground_offset') {
  if (!root || !CONFIG.avatarGroundingApplyToModelPivot) return null;

  const result = calculateAvatarFootOffset(root);
  if (!result) return null;

  const epsilon = CONFIG.avatarGroundSnapEpsilon ?? 0.001;

  if (Math.abs(result.offset) > epsilon && root.userData.modelPivot) {
    root.userData.modelPivot.position.y += result.offset;
    root.userData.avatarFootOffsetApplied = (root.userData.avatarFootOffsetApplied || 0) + result.offset;
  }

  root.userData.avatarFootOffsetInfo = {
    ...result,
    appliedAt: Date.now(),
    reason,
  };

  return result;
}

function groundAvatarNow(reason = 'ground_avatar_now') {
  if (!avatar) return null;

  const groundY = snapAvatarRootToGround(avatar, reason);
  const foot = applyAvatarGroundOffset(avatar, reason);

  return { groundY, foot };
}

window.snapAvatarRootToGround = snapAvatarRootToGround;
window.calculateAvatarFootOffset = calculateAvatarFootOffset;
window.applyAvatarGroundOffset = applyAvatarGroundOffset;
window.groundAvatarNow = groundAvatarNow;
