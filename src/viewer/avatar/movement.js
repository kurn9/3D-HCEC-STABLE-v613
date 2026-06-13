function sampleGroundYAt(position) {
  if (typeof getGroundYAt !== 'function') return null;
  return getGroundYAt(position);
}

function chooseReachableGroundY(samples, currentBodyY) {
  let best = null;

  for (const groundY of samples) {
    if (groundY === null || !Number.isFinite(groundY)) continue;

    const delta = groundY - currentBodyY;
    if (delta > CONFIG.stairAssistMaxUp + 0.035) continue;
    if (delta < -CONFIG.maxStepDown - 0.08) continue;

    // Ưu tiên mặt cao nhất có thể bước tới. Cách này giúp vượt mép bậc cuối
    // khi ray ở đúng chân còn bắt mặt bậc thấp nhưng probe phía trước đã thấy sàn trên.
    if (best === null || groundY > best) best = groundY;
  }

  return best;
}

function getStepAssistedGroundY(nextPosition, moveDir, currentBodyY = null) {
  const samples = [];
  const currentY = Number.isFinite(currentBodyY)
    ? currentBodyY
    : (avatar ? avatar.position.y : nextPosition.y - CONFIG.eyeHeight);

  samples.push(sampleGroundYAt(nextPosition));

  if (moveDir && moveDir.lengthSq() > 0.0001) {
    const forward = moveDir.clone();
    forward.y = 0;
    forward.normalize();

    const side = new THREE.Vector3(-forward.z, 0, forward.x).normalize();
    const assistDistance = CONFIG.stairAssistDistance || 0.38;
    const farAssistDistance = assistDistance * (CONFIG.stairProbeMultiplier || 2.0);
    const sideProbe = (CONFIG.avatarCollisionRadius || 0.31) * (CONFIG.stairSideProbeScale || 0.65);

    const probeForward = nextPosition.clone().addScaledVector(forward, assistDistance);
    const probeForwardFar = nextPosition.clone().addScaledVector(forward, farAssistDistance);
    const probeLeft = probeForward.clone().addScaledVector(side, sideProbe);
    const probeRight = probeForward.clone().addScaledVector(side, -sideProbe);

    samples.push(sampleGroundYAt(probeForward));
    samples.push(sampleGroundYAt(probeForwardFar));
    samples.push(sampleGroundYAt(probeLeft));
    samples.push(sampleGroundYAt(probeRight));
  }

  return chooseReachableGroundY(samples, currentY);
}

function canStepTo(currentBodyY, targetGroundY, isStairAssist = false) {
  const deltaY = targetGroundY - currentBodyY;
  const maxUp = isStairAssist ? CONFIG.stairAssistMaxUp : CONFIG.maxStepUp;

  if (deltaY > maxUp) return false;
  if (deltaY < -CONFIG.maxStepDown) return false;

  return true;
}

function resolveAvatarGround(candidatePosition, moveDir, deltaTime) {
  const eyeProbe = candidatePosition.clone();
  eyeProbe.y += CONFIG.eyeHeight;

  let groundY = getStepAssistedGroundY(eyeProbe, moveDir, avatar.position.y);
  if (groundY === null) return null;

  const targetBodyY = groundY + (CONFIG.avatarFootGroundOffset || 0);
  const isStepAssist = Math.abs(targetBodyY - avatar.position.y) <= CONFIG.stairAssistMaxUp + 0.035;

  if (!canStepTo(avatar.position.y, targetBodyY, isStepAssist)) {
    return null;
  }

  const yDelta = Math.abs(targetBodyY - avatar.position.y);
  const movingUp = targetBodyY > avatar.position.y;
  const followBoost = movingUp ? 2.25 : 1.45;
  const followSpeed = yDelta > CONFIG.stairSnapThreshold
    ? CONFIG.groundFollowSmooth * followBoost
    : CONFIG.groundFollowSmooth * 1.35;

  const alpha = Math.min(1, deltaTime * followSpeed);
  candidatePosition.y = THREE.MathUtils.lerp(avatar.position.y, targetBodyY, alpha);

  // Nếu gần đúng mặt sàn rồi thì snap nhẹ để tránh chân bị cắt qua mặt bậc.
  if (Math.abs(candidatePosition.y - targetBodyY) < 0.012) {
    candidatePosition.y = targetBodyY;
  }

  return candidatePosition;
}

function tryMoveAvatarBy(deltaMove, moveDir, deltaTime) {
  if (!avatar) return false;

  const current = avatar.position.clone();
  let candidate = current.clone().add(deltaMove);

  candidate = resolveAvatarGround(candidate, moveDir, deltaTime);
  if (candidate && !isBodyBlockedAt(candidate, current)) {
    avatar.position.copy(candidate);
    return true;
  }

  // Slide X: nếu đi chéo đụng vật thể, thử trượt theo trục X.
  if (Math.abs(deltaMove.x) > 0.00001) {
    let xCandidate = current.clone().add(new THREE.Vector3(deltaMove.x, 0, 0));
    xCandidate = resolveAvatarGround(xCandidate, new THREE.Vector3(Math.sign(deltaMove.x), 0, 0), deltaTime);

    if (xCandidate && !isBodyBlockedAt(xCandidate, current)) {
      avatar.position.copy(xCandidate);
      return true;
    }
  }

  // Slide Z: thử trượt theo trục Z.
  if (Math.abs(deltaMove.z) > 0.00001) {
    let zCandidate = current.clone().add(new THREE.Vector3(0, 0, deltaMove.z));
    zCandidate = resolveAvatarGround(zCandidate, new THREE.Vector3(0, 0, Math.sign(deltaMove.z)), deltaTime);

    if (zCandidate && !isBodyBlockedAt(zCandidate, current)) {
      avatar.position.copy(zCandidate);
      return true;
    }
  }

  return false;
}

function moveAvatarWithSubsteps(velocity, moveDir, deltaTime) {
  if (!avatar) return false;

  const totalMove = velocity.clone().multiplyScalar(deltaTime);
  totalMove.y = 0;

  const totalDistance = totalMove.length();
  if (totalDistance < 0.00001) return false;

  const maxSteps = Math.max(1, Number(CONFIG.collisionMaxSubsteps || 3));
  const steps = Math.min(maxSteps, Math.max(1, Math.ceil(totalDistance / CONFIG.collisionSubstepDistance)));
  const stepMove = totalMove.clone().multiplyScalar(1 / steps);
  const stepDelta = deltaTime / steps;

  let moved = false;

  for (let i = 0; i < steps; i++) {
    const ok = tryMoveAvatarBy(stepMove, moveDir, stepDelta);

    if (!ok) {
      avatarVelocity.multiplyScalar(0.28);
      break;
    }

    moved = true;
  }

  return moved;
}


function getMobileAnalogMoveInput() {
  const mobileConfig = CONFIG.mobile || {};
  const vector = typeof window !== 'undefined' ? window.__mobileMoveVector : null;

  if (!mobileConfig.joystickAnalogMovement || !vector?.active) return null;

  const strength = Math.max(0, Math.min(1, Number(vector.strength) || 0));
  const right = Math.max(-1, Math.min(1, Number(vector.x) || 0));
  const forward = Math.max(-1, Math.min(1, -(Number(vector.y) || 0)));
  if (strength <= 0.001) return null;

  const speedMultiplier = Math.max(0.55, Math.min(1.35, Number(mobileConfig.mobileMoveSpeedMultiplier) || 1));

  return {
    forward,
    right,
    strength: Math.max(0.08, Math.min(1, strength * speedMultiplier))
  };
}

function updateMovement(deltaTime) {
  if (!isLocked || !roomLoaded || modalOpen) return;

  if (isSitting) {
    updateCameraForAvatar(deltaTime);
    return;
  }

  const wantsRun = Boolean(keys['ShiftLeft'] || keys['ShiftRight']);
  const targetSpeed = wantsRun ? CONFIG.runSpeed : CONFIG.walkSpeed;
  const speedAlpha = 1 - Math.exp(-Number(CONFIG.runAcceleration || CONFIG.moveAcceleration || 12) * deltaTime);
  smoothedMoveSpeed = THREE.MathUtils.lerp(smoothedMoveSpeed || CONFIG.walkSpeed, targetSpeed, speedAlpha);
  const speed = smoothedMoveSpeed;
  const maxDistance = Math.max(0.055, Number(CONFIG.collisionSubstepDistance || 0.045) * Math.max(1, Number(CONFIG.collisionMaxSubsteps || 3)));
  const distance = Math.min(speed * deltaTime, maxDistance);

  // FIRST-PERSON: giữ nguyên cách đi như viewer cũ, chỉ dùng ground probe mới cho cầu thang.
  if (viewMode === 'first' || !avatar) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() === 0) return;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const moveDir = new THREE.Vector3();
    const mobileAnalogInput = getMobileAnalogMoveInput();
    const movementScale = mobileAnalogInput ? mobileAnalogInput.strength : 1;

    if (mobileAnalogInput) {
      moveDir.addScaledVector(forward, mobileAnalogInput.forward);
      moveDir.addScaledVector(right, mobileAnalogInput.right);
    } else {
      if (keys['KeyW'] || keys['ArrowUp']) moveDir.add(forward);
      if (keys['KeyS'] || keys['ArrowDown']) moveDir.addScaledVector(forward, -1);
      if (keys['KeyA'] || keys['ArrowLeft']) moveDir.addScaledVector(right, -1);
      if (keys['KeyD'] || keys['ArrowRight']) moveDir.add(right);
    }

    if (moveDir.lengthSq() === 0) return;

    moveDir.normalize();
    if (hasColliderAhead(moveDir)) return;

    const nextPosition = camera.position.clone().addScaledVector(moveDir, distance * movementScale);
    const currentBodyY = camera.position.y - CONFIG.eyeHeight;
    let groundY = getStepAssistedGroundY(nextPosition, moveDir, currentBodyY);
    if (groundY === null) return;

    const isStepAssist = Math.abs(groundY - currentBodyY) <= CONFIG.stairAssistMaxUp + 0.035;

    if (!canStepTo(currentBodyY, groundY, isStepAssist)) return;

    const targetEyeY = groundY + CONFIG.eyeHeight;
    nextPosition.y = targetEyeY;

    const nextBodyPos = new THREE.Vector3(nextPosition.x, nextPosition.y - CONFIG.eyeHeight, nextPosition.z);
    const currentBodyPos = new THREE.Vector3(camera.position.x, camera.position.y - CONFIG.eyeHeight, camera.position.z);

    if (isBodyBlockedAt(nextBodyPos, currentBodyPos)) {
      return;
    }

    camera.position.copy(nextPosition);

    if (avatar) {
      avatar.position.set(camera.position.x, camera.position.y - CONFIG.eyeHeight, camera.position.z);
      if (typeof snapAvatarRootToGround === 'function') snapAvatarRootToGround(avatar, 'first_person_sync');
      avatar.rotation.y = yaw;
    }

    return;
  }

  // THIRD-PERSON AVATAR: WASD điều khiển avatar, camera đi theo phía sau.
  const forward = new THREE.Vector3(
    Math.sin(yaw),
    0,
    Math.cos(yaw)
  ).normalize();

  const right = new THREE.Vector3(
    -Math.cos(yaw),
    0,
    Math.sin(yaw)
  ).normalize();

  const inputDir = new THREE.Vector3();
  const mobileAnalogInput = getMobileAnalogMoveInput();
  const movementScale = mobileAnalogInput ? mobileAnalogInput.strength : 1;

  if (mobileAnalogInput) {
    inputDir.addScaledVector(forward, mobileAnalogInput.forward);
    inputDir.addScaledVector(right, mobileAnalogInput.right);
  } else {
    if (keys['KeyW'] || keys['ArrowUp']) inputDir.add(forward);
    if (keys['KeyS'] || keys['ArrowDown']) inputDir.addScaledVector(forward, -1);
    if (keys['KeyA'] || keys['ArrowLeft']) inputDir.addScaledVector(right, -1);
    if (keys['KeyD'] || keys['ArrowRight']) inputDir.add(right);
  }

  const hasInput = inputDir.lengthSq() > 0;

  if (hasInput) {
    inputDir.normalize();

    const targetVelocity = inputDir.clone().multiplyScalar(speed * movementScale);
    const accelAlpha = 1 - Math.exp(-CONFIG.moveAcceleration * deltaTime);
    avatarVelocity.lerp(targetVelocity, accelAlpha);
  } else {
    const dampAlpha = 1 - Math.exp(-CONFIG.moveDamping * deltaTime);
    avatarVelocity.lerp(new THREE.Vector3(0, 0, 0), dampAlpha);

    if (avatarVelocity.lengthSq() < 0.00045) {
      avatarVelocity.set(0, 0, 0);
      updateCameraForAvatar(deltaTime);
      return;
    }
  }

  const moveDir = avatarVelocity.clone();
  moveDir.y = 0;

  if (moveDir.lengthSq() === 0) {
    updateCameraForAvatar(deltaTime);
    return;
  }

  moveDir.normalize();

  if (hasColliderAhead(moveDir)) {
    avatarVelocity.multiplyScalar(0.32);
    updateCameraForAvatar(deltaTime);
    return;
  }

  const moved = moveAvatarWithSubsteps(avatarVelocity, moveDir, deltaTime);

  if (!moved) {
    avatarVelocity.multiplyScalar(0.22);
    updateCameraForAvatar(deltaTime);
    return;
  }

  // Avatar xoay theo hướng di chuyển, dùng dampAngle để tránh rung khi qua mốc ±PI.
  const desiredYaw = Math.atan2(moveDir.x, moveDir.z);
  avatar.rotation.y = dampAngle(
    avatar.rotation.y,
    desiredYaw,
    Math.min(1, deltaTime * CONFIG.avatarTurnSmooth)
  );

  updateCameraForAvatar(deltaTime);
}

function dampAngle(current, target, alpha) {
  let delta = THREE.MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI;
  return current + delta * alpha;
}
