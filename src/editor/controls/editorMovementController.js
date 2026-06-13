// V6.11.21-B5-J_B4_C_B — Editor Use Gallery Movement Core Hotfix
// Runtime-only controller for editor.html. It ports the Gallery movement/collision/stair semantics
// without importing the Viewer/avatar/UI runtime.

export function createEditorMovementController(options = {}) {
  const THREE = options.THREE;
  const camera = options.camera;

  if (!THREE) throw new Error('createEditorMovementController: THREE is required.');
  if (!camera) throw new Error('createEditorMovementController: camera is required.');

  const config = options.config || {};
  const downVector = new THREE.Vector3(0, -1, 0);
  const groundRaycaster = new THREE.Raycaster();
  const wallRaycaster = new THREE.Raycaster();

  let walkableObjects = Array.isArray(options.walkableObjects) ? options.walkableObjects : [];
  let colliderObjects = Array.isArray(options.colliderObjects) ? options.colliderObjects : [];
  let groundProbeObjects = Array.isArray(options.groundProbeObjects) ? options.groundProbeObjects : [];

  const editorBodyPosition = new THREE.Vector3();
  const lastAcceptedBodyPosition = new THREE.Vector3();
  const editorVelocity = new THREE.Vector3();
  const blockingBoxes = [];
  const colliderBoxes = [];

  let currentGroundY = Number.isFinite(Number(options.initialGroundY)) ? Number(options.initialGroundY) : 0;
  let smoothedMoveSpeed = Number(config.walkSpeed || 2.5);
  let lastDebugAt = 0;
  let lastDebugKey = '';
  let disposed = false;

  const debugEnabled = Boolean(options.debug);
  const onDebugLog = typeof options.onDebugLog === 'function' ? options.onDebugLog : (...args) => console.debug(...args);

  const WALKABLE_KEYWORDS = [
    'floor', 'stair', 'stairs', 'step', 'steps', 'walk', 'walkable', 'walk_', 'walkmesh',
    'ramp', 'ground', 'terrain', 'path', 'road', 'navmesh', 'floor_outdoor_main'
  ];
  const DOOR_KEYWORDS = ['door', 'doors', 'doorway', 'entrance', 'entry', 'gate', 'opening', 'portal', 'cua', 'cửa'];
  const SEAT_KEYWORDS = ['bench', 'chair', 'seat', 'sofa', 'ghe', 'sit'];
  const CEILING_KEYWORDS = ['ceiling', 'roof', 'mái', 'mai'];

  const getEyeHeight = () => finiteNumber(callMaybe(options.getEyeHeight), finiteNumber(config.eyeHeight, 1.7));
  const getCurrentRoomKey = () => String(callMaybe(options.getCurrentRoomKey) || config.currentRoomId || 'unknown');
  const getFallbackFloorY = () => finiteNumber(callMaybe(options.getFallbackFloorY), finiteNumber(options.fallbackFloorY, 0));
  const getRoomBounds = () => callMaybe(options.getRoomBounds) || options.roomBounds || null;

  const bodyRadius = () => finiteNumber(config.avatarCollisionRadius, 0.31);
  const bodyHeight = () => finiteNumber(config.bodyCollisionHeight, 1.55);
  const collisionRayHeights = () => Array.isArray(config.collisionRayHeights) && config.collisionRayHeights.length
    ? config.collisionRayHeights
    : [0.25, 0.55, 1.05, 1.55];

  function callMaybe(fn) {
    return typeof fn === 'function' ? fn() : undefined;
  }

  function finiteNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function getObjectNameTrail(obj) {
    const names = [];
    let cur = obj;
    while (cur) {
      if (cur.name) names.push(cur.name);
      cur = cur.parent;
    }
    return names.join(' ').toLowerCase();
  }

  function hasAnyKeyword(textValue, keywords) {
    const text = String(textValue || '').toLowerCase();
    return keywords.some((kw) => text.includes(String(kw).toLowerCase()));
  }

  function isWalkableLikeObject(objOrName) {
    const name = typeof objOrName === 'string' ? objOrName : getObjectNameTrail(objOrName);
    return hasAnyKeyword(name, WALKABLE_KEYWORDS);
  }

  function isDoorOpeningName(name = '') {
    return hasAnyKeyword(name, DOOR_KEYWORDS);
  }

  function isSeatColliderName(name = '') {
    return hasAnyKeyword(name, SEAT_KEYWORDS);
  }

  function isCeilingLikeName(name = '') {
    return hasAnyKeyword(name, CEILING_KEYWORDS);
  }

  function getWalkableSourceFromName(name = '') {
    const n = String(name || '').toLowerCase();
    if (n.includes('floor_outdoor_main')) return 'floor_outdoor_main';
    if (n.includes('ramp')) return 'ramp';
    if (n.includes('stair') || n.includes('step')) return 'stair';
    if (n.includes('walk') || n.includes('navmesh')) return 'walkable';
    if (n.includes('floor')) return 'floor';
    if (n.includes('ground') || n.includes('terrain') || n.includes('path') || n.includes('road')) return 'floor';
    return 'fallbackProbe';
  }

  function uniqueObjects(objects) {
    return [...new Set((Array.isArray(objects) ? objects : []).filter(Boolean))];
  }

  function setWalkableObjects(objects) {
    walkableObjects = uniqueObjects(objects);
    rebuildBlockingBoxes();
  }

  function setColliderObjects(objects) {
    colliderObjects = uniqueObjects(objects);
    rebuildBlockingBoxes();
  }

  function setGroundProbeObjects(objects) {
    groundProbeObjects = uniqueObjects(objects);
  }

  function rebuildBlockingBoxes() {
    blockingBoxes.length = 0;
    colliderBoxes.length = 0;

    for (const obj of uniqueObjects(colliderObjects)) {
      if (!obj) continue;

      const name = getObjectNameTrail(obj);

      // Walkable wins over collider. This is critical for floor_outdoor_main and stair/ramp helpers.
      if (isWalkableLikeObject(name) || isDoorOpeningName(name)) continue;

      const box = new THREE.Box3().setFromObject(obj);
      if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) continue;

      const size = box.getSize(new THREE.Vector3());
      if (size.x < 0.03 && size.z < 0.03) continue;

      const isSeatCollider = isSeatColliderName(name);
      const padded = box.clone();
      const pad = isSeatCollider
        ? finiteNumber(config.colliderPadding, 0.012)
        : finiteNumber(config.wallColliderPadding, 0.06);

      padded.min.x -= pad;
      padded.max.x += pad;
      padded.min.z -= pad;
      padded.max.z += pad;

      const entry = { object: obj, box: padded, rawBox: box, name, isSeatCollider };
      colliderBoxes.push(entry);
      blockingBoxes.push(entry);
    }
  }

  function initFromCamera(cameraPosition = camera.position) {
    syncBodyFromCamera('initFromCamera', cameraPosition);
  }

  function syncBodyFromCamera(reason = 'syncBodyFromCamera', cameraPosition = camera.position) {
    const eyeHeight = getEyeHeight();
    editorBodyPosition.set(cameraPosition.x, cameraPosition.y - eyeHeight, cameraPosition.z);

    const groundInfo = sampleGroundInfoAt(editorBodyPosition, { includeFallback: true });
    if (groundInfo && Number.isFinite(groundInfo.groundY)) {
      const maxSnap = Math.max(finiteNumber(config.maxStepDown, 0.82), finiteNumber(config.stairAssistMaxUp, 0.54), 0.9) + 0.35;
      if (Math.abs(groundInfo.groundY - editorBodyPosition.y) <= maxSnap) {
        editorBodyPosition.y = groundInfo.groundY;
        currentGroundY = groundInfo.groundY;
      }
    } else if (!Number.isFinite(currentGroundY)) {
      currentGroundY = editorBodyPosition.y;
    }

    lastAcceptedBodyPosition.copy(editorBodyPosition);
    syncCameraFromBody(reason);
    debugLog('SYNC_BODY_FROM_CAMERA', { groundInfo, force: true });
  }

  function syncCameraFromBody(reason = 'syncCameraFromBody') {
    const eyeHeight = getEyeHeight();
    camera.position.set(editorBodyPosition.x, editorBodyPosition.y + eyeHeight, editorBodyPosition.z);
    debugLog('SYNC_CAMERA_FROM_BODY', { force: false, reason });
  }

  function teleportBodyTo(position, reason = 'teleportBodyTo') {
    if (!position) return false;
    const target = position.clone ? position.clone() : new THREE.Vector3(position.x, position.y, position.z);
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) return false;

    editorBodyPosition.copy(target);
    currentGroundY = target.y;
    lastAcceptedBodyPosition.copy(editorBodyPosition);
    editorVelocity.set(0, 0, 0);
    syncCameraFromBody(reason);
    debugLog('TELEPORT_BODY', { nextBodyPosition: target, force: true, usedWalkableSource: 'teleport' });
    return true;
  }

  function sampleGroundInfoAt(bodyPosition, opts = {}) {
    const includeFallback = opts.includeFallback !== false;
    const rayHeight = finiteNumber(config.editorGroundRayHeight, 2.4);
    const rayFar = finiteNumber(config.editorGroundRayFar, 10);
    const origin = new THREE.Vector3(bodyPosition.x, bodyPosition.y + rayHeight, bodyPosition.z);

    const priorityWalkables = uniqueObjects(walkableObjects).filter((obj) => !isCeilingLikeName(getObjectNameTrail(obj)));
    let hit = getGroundHitFromObjects(origin, priorityWalkables, rayFar, 'walkable');
    if (hit) return hit;

    const probeObjects = uniqueObjects(groundProbeObjects).filter((obj) => {
      const name = getObjectNameTrail(obj);
      if (isCeilingLikeName(name)) return false;
      if (isDoorOpeningName(name)) return false;
      return true;
    });

    hit = getGroundHitFromObjects(origin, probeObjects, rayFar, 'fallbackProbe');
    if (hit) return hit;

    if (includeFallback && (config.useFallbackFloorWhenNoWalkable !== false || getCurrentRoomKey() === 'outdoor')) {
      const fallbackY = Number.isFinite(currentGroundY) ? currentGroundY : getFallbackFloorY();
      if (Number.isFinite(fallbackY)) {
        return {
          groundY: fallbackY,
          object: null,
          objectName: null,
          parentName: null,
          normalY: 1,
          usedWalkableSource: 'fallbackCurrent'
        };
      }
    }

    return null;
  }

  function getGroundHitFromObjects(origin, objects, rayFar, defaultSource) {
    if (!objects.length) return null;

    groundRaycaster.set(origin, downVector);
    groundRaycaster.far = rayFar;
    const hits = groundRaycaster.intersectObjects(objects, true);

    for (const hit of hits) {
      if (!hit.face) continue;

      const name = getObjectNameTrail(hit.object);
      if (isCeilingLikeName(name)) continue;
      if (isDoorOpeningName(name)) continue;

      const normal = hit.face.normal.clone();
      normal.transformDirection(hit.object.matrixWorld).normalize();
      if (normal.y <= 0.25) continue;

      const source = isWalkableLikeObject(name) ? getWalkableSourceFromName(name) : defaultSource;
      return {
        groundY: hit.point.y,
        object: hit.object,
        objectName: hit.object?.name || '',
        parentName: hit.object?.parent?.name || '',
        normalY: normal.y,
        usedWalkableSource: source,
        distance: hit.distance
      };
    }

    return null;
  }

  function chooseReachableGroundInfo(samples, currentBodyY) {
    let best = null;
    let nearestRejected = null;
    const maxUp = finiteNumber(config.stairAssistMaxUp, finiteNumber(config.maxStepUp, 0.46));
    const maxDown = finiteNumber(config.maxStepDown, 0.82);

    for (const info of samples) {
      if (!info || !Number.isFinite(info.groundY)) continue;
      const delta = info.groundY - currentBodyY;
      const rejectedReason = delta > maxUp + 0.035
        ? 'STEP_TOO_HIGH'
        : (delta < -maxDown - 0.08 ? 'STEP_TOO_LOW' : null);

      if (rejectedReason) {
        const rejected = { ...info, rejectReason: rejectedReason, stepDelta: delta };
        if (!nearestRejected || Math.abs(delta) < Math.abs(nearestRejected.stepDelta)) nearestRejected = rejected;
        continue;
      }

      // Gallery logic: prefer the highest reachable surface so the controller can cross the last stair lip.
      if (!best || info.groundY > best.groundY) {
        best = { ...info, stepDelta: delta };
      }
    }

    return best || nearestRejected;
  }

  function getStepAssistedGroundInfo(nextBodyPosition, moveDir, currentBodyY = null) {
    const samples = [];
    const bodyY = Number.isFinite(currentBodyY) ? currentBodyY : editorBodyPosition.y;

    samples.push(sampleGroundInfoAt(nextBodyPosition, { includeFallback: false }));

    if (moveDir && moveDir.lengthSq() > 0.0001) {
      const forward = moveDir.clone();
      forward.y = 0;
      forward.normalize();

      const side = new THREE.Vector3(-forward.z, 0, forward.x).normalize();
      const assistDistance = finiteNumber(config.stairAssistDistance, 0.38);
      const farAssistDistance = assistDistance * finiteNumber(config.stairProbeMultiplier, 2.25);
      const sideProbe = bodyRadius() * finiteNumber(config.stairSideProbeScale, 0.72);

      const probeForward = nextBodyPosition.clone().addScaledVector(forward, assistDistance);
      const probeForwardFar = nextBodyPosition.clone().addScaledVector(forward, farAssistDistance);
      const probeLeft = probeForward.clone().addScaledVector(side, sideProbe);
      const probeRight = probeForward.clone().addScaledVector(side, -sideProbe);

      samples.push(sampleGroundInfoAt(probeForward, { includeFallback: false }));
      samples.push(sampleGroundInfoAt(probeForwardFar, { includeFallback: false }));
      samples.push(sampleGroundInfoAt(probeLeft, { includeFallback: false }));
      samples.push(sampleGroundInfoAt(probeRight, { includeFallback: false }));
    }

    const reachable = chooseReachableGroundInfo(samples, bodyY);
    if (reachable && reachable.rejectReason) return reachable;

    if (reachable) return reachable;

    const fallback = sampleGroundInfoAt(nextBodyPosition, { includeFallback: true });
    if (fallback) return { ...fallback, stepDelta: fallback.groundY - bodyY };

    return null;
  }

  function canStepTo(currentBodyYValue, targetGroundY, isStairAssist = false) {
    const deltaY = targetGroundY - currentBodyYValue;
    const maxUp = isStairAssist ? finiteNumber(config.stairAssistMaxUp, 0.54) : finiteNumber(config.maxStepUp, 0.46);
    if (deltaY > maxUp) return false;
    if (deltaY < -finiteNumber(config.maxStepDown, 0.82)) return false;
    return true;
  }

  function resolveEditorGround(candidatePosition, moveDir, deltaTime) {
    const groundInfo = getStepAssistedGroundInfo(candidatePosition, moveDir, editorBodyPosition.y);
    if (!groundInfo) return { ok: false, reason: 'NO_GROUND', groundInfo: null };
    if (groundInfo.rejectReason) return { ok: false, reason: groundInfo.rejectReason, groundInfo };

    const targetBodyY = groundInfo.groundY + finiteNumber(config.avatarFootGroundOffset, 0);
    const stepDelta = targetBodyY - editorBodyPosition.y;
    const isStepAssist = Math.abs(stepDelta) <= finiteNumber(config.stairAssistMaxUp, 0.54) + 0.035;

    if (!canStepTo(editorBodyPosition.y, targetBodyY, isStepAssist)) {
      return {
        ok: false,
        reason: stepDelta > 0 ? 'STEP_TOO_HIGH' : 'STEP_TOO_LOW',
        groundInfo: { ...groundInfo, stepDelta }
      };
    }

    const yDelta = Math.abs(stepDelta);
    const movingUp = targetBodyY > editorBodyPosition.y;
    const followBoost = movingUp ? 2.25 : 1.45;
    const followSpeed = yDelta > finiteNumber(config.stairSnapThreshold, 0.30)
      ? finiteNumber(config.groundFollowSmooth, 16) * followBoost
      : finiteNumber(config.groundFollowSmooth, 16) * 1.35;

    const alpha = Math.min(1, Math.max(0, deltaTime) * followSpeed);
    candidatePosition.y = THREE.MathUtils.lerp(editorBodyPosition.y, targetBodyY, alpha);

    if (Math.abs(candidatePosition.y - targetBodyY) < 0.012) {
      candidatePosition.y = targetBodyY;
    }

    return {
      ok: true,
      candidatePosition,
      targetBodyY,
      isStepAssist,
      groundInfo: { ...groundInfo, stepDelta, groundY: groundInfo.groundY }
    };
  }

  function insideExpandedXZ(pos, expandedBox) {
    return pos.x >= expandedBox.min.x && pos.x <= expandedBox.max.x &&
      pos.z >= expandedBox.min.z && pos.z <= expandedBox.max.z;
  }

  function distanceOutsideScore2D(pos, box) {
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    return dx * dx + dz * dz;
  }

  function isEditorBodyBlockedAt(bodyPosition, currentBodyPosition = null) {
    if (blockingBoxes.length === 0) return false;

    const radius = bodyRadius();
    const minY = bodyPosition.y + 0.06;
    const maxY = bodyPosition.y + bodyHeight();

    for (const entry of blockingBoxes) {
      const box = entry.box;
      if (box.max.y < minY || box.min.y > maxY) continue;

      const localRadius = entry.isSeatCollider ? radius * 0.72 : radius;
      const expanded = box.clone();
      expanded.min.x -= localRadius;
      expanded.max.x += localRadius;
      expanded.min.z -= localRadius;
      expanded.max.z += localRadius;

      if (!insideExpandedXZ(bodyPosition, expanded)) continue;

      if (currentBodyPosition) {
        const currentInside = insideExpandedXZ(currentBodyPosition, expanded);
        if (currentInside) {
          const currentScore = distanceOutsideScore2D(currentBodyPosition, expanded);
          const nextScore = distanceOutsideScore2D(bodyPosition, expanded);
          if (nextScore > currentScore + 0.0005) return false;
        }
      }

      return {
        object: entry.object,
        objectName: entry.object?.name || '',
        parentName: entry.object?.parent?.name || '',
        name: entry.name,
        reason: 'BODY_BLOCKED'
      };
    }

    return false;
  }

  function hasColliderAhead(direction, baseBodyPosition = editorBodyPosition) {
    const blockers = uniqueObjects(colliderObjects).filter((obj) => {
      const name = getObjectNameTrail(obj);
      if (isSeatColliderName(name)) return false;
      if (isWalkableLikeObject(name)) return false;
      if (isDoorOpeningName(name)) return false;
      return true;
    });

    if (!blockers.length || !direction || direction.lengthSq() < 0.0001) return false;

    const dir = direction.clone();
    dir.y = 0;
    if (dir.lengthSq() < 0.0001) return false;
    dir.normalize();

    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const sideRadius = bodyRadius() * 0.62;
    const offsets = [0, sideRadius, -sideRadius];
    const far = finiteNumber(config.wallDistance, 0.62) * 0.72 + bodyRadius() * 0.45;

    for (const h of collisionRayHeights()) {
      for (const offset of offsets) {
        const origin = new THREE.Vector3(
          baseBodyPosition.x + side.x * offset,
          baseBodyPosition.y + Number(h),
          baseBodyPosition.z + side.z * offset
        );

        wallRaycaster.set(origin, dir);
        wallRaycaster.far = far;
        const hits = wallRaycaster.intersectObjects(blockers, true);

        for (const hit of hits) {
          const name = getObjectNameTrail(hit.object);
          if (isWalkableLikeObject(name) || isDoorOpeningName(name) || isSeatColliderName(name)) continue;

          if (!hit.face) {
            return {
              object: hit.object,
              objectName: hit.object?.name || '',
              parentName: hit.object?.parent?.name || '',
              distance: hit.distance,
              rayHeight: h,
              reason: 'RAY_BLOCKED'
            };
          }

          const normal = hit.face.normal.clone();
          normal.transformDirection(hit.object.matrixWorld).normalize();
          if (Math.abs(normal.y) < 0.72) {
            return {
              object: hit.object,
              objectName: hit.object?.name || '',
              parentName: hit.object?.parent?.name || '',
              distance: hit.distance,
              rayHeight: h,
              normalY: normal.y,
              reason: 'RAY_BLOCKED'
            };
          }
        }
      }
    }

    return false;
  }

  function isInsideRoomBounds(bodyPosition) {
    const bounds = getRoomBounds();
    if (!bounds) return true;
    const eyeHeight = getEyeHeight();
    const eyeY = bodyPosition.y + eyeHeight;
    return bodyPosition.x >= bounds.min.x && bodyPosition.x <= bounds.max.x &&
      eyeY >= bounds.min.y - 0.2 && eyeY <= bounds.max.y + 2.5 &&
      bodyPosition.z >= bounds.min.z && bodyPosition.z <= bounds.max.z;
  }

  function rejectMovement(reason, payload = {}) {
    debugLog(reason, payload, true);
    return false;
  }

  function tryMoveEditorBodyTo(candidate, moveDir, deltaTime, substepIndex = 0) {
    const current = editorBodyPosition.clone();
    const resolved = resolveEditorGround(candidate, moveDir, deltaTime);

    if (!resolved.ok) {
      return rejectMovement(resolved.reason || 'NO_GROUND', {
        currentBodyPosition: current,
        nextBodyPosition: candidate,
        moveDirection: moveDir,
        substepIndex,
        groundInfo: resolved.groundInfo
      });
    }

    const nextBody = resolved.candidatePosition;

    if (!isInsideRoomBounds(nextBody)) {
      return rejectMovement('OUT_OF_BOUNDS', {
        currentBodyPosition: current,
        nextBodyPosition: nextBody,
        moveDirection: moveDir,
        substepIndex,
        groundInfo: resolved.groundInfo
      });
    }

    const blocker = isEditorBodyBlockedAt(nextBody, current);
    if (blocker) {
      return rejectMovement('BODY_BLOCKED', {
        currentBodyPosition: current,
        nextBodyPosition: nextBody,
        moveDirection: moveDir,
        substepIndex,
        groundInfo: resolved.groundInfo,
        blocker
      });
    }

    const rayBlocker = hasColliderAhead(moveDir, current);
    if (rayBlocker && !resolved.isStepAssist) {
      return rejectMovement('RAY_BLOCKED', {
        currentBodyPosition: current,
        nextBodyPosition: nextBody,
        moveDirection: moveDir,
        substepIndex,
        groundInfo: resolved.groundInfo,
        blocker: rayBlocker
      });
    }

    editorBodyPosition.copy(nextBody);
    lastAcceptedBodyPosition.copy(editorBodyPosition);
    currentGroundY = resolved.targetBodyY;
    syncCameraFromBody('movement');

    if (debugEnabled && resolved.groundInfo?.usedWalkableSource === 'floor_outdoor_main') {
      debugLog('GROUND_ACCEPTED', {
        currentBodyPosition: current,
        nextBodyPosition: nextBody,
        moveDirection: moveDir,
        substepIndex,
        groundInfo: resolved.groundInfo,
        force: false
      });
    }

    return true;
  }

  function tryMoveEditorBodyBy(deltaMove, moveDir, deltaTime, substepIndex = 0) {
    if (!deltaMove || deltaMove.lengthSq() < 0.000001) return false;

    const current = editorBodyPosition.clone();
    let candidate = current.clone().add(deltaMove);

    if (tryMoveEditorBodyTo(candidate, moveDir, deltaTime, substepIndex)) return true;

    if (Math.abs(deltaMove.x) > 0.00001) {
      const slideDirX = new THREE.Vector3(Math.sign(deltaMove.x), 0, 0);
      candidate = current.clone().add(new THREE.Vector3(deltaMove.x, 0, 0));
      if (tryMoveEditorBodyTo(candidate, slideDirX, deltaTime, substepIndex)) return true;
    }

    if (Math.abs(deltaMove.z) > 0.00001) {
      const slideDirZ = new THREE.Vector3(0, 0, Math.sign(deltaMove.z));
      candidate = current.clone().add(new THREE.Vector3(0, 0, deltaMove.z));
      if (tryMoveEditorBodyTo(candidate, slideDirZ, deltaTime, substepIndex)) return true;
    }

    return false;
  }

  function moveEditorBodyWithSubsteps(velocity, moveDir, deltaTime) {
    const totalMove = velocity.clone().multiplyScalar(deltaTime);
    totalMove.y = 0;

    const totalDistance = totalMove.length();
    if (totalDistance < 0.00001) return false;

    const maxSteps = Math.max(1, Math.floor(finiteNumber(config.collisionMaxSubsteps, 3)));
    const substepDistance = Math.max(0.025, finiteNumber(config.collisionSubstepDistance, 0.045));
    const steps = Math.min(maxSteps, Math.max(1, Math.ceil(totalDistance / substepDistance)));
    const stepMove = totalMove.clone().multiplyScalar(1 / steps);
    const stepDelta = deltaTime / steps;

    let moved = false;
    for (let i = 0; i < steps; i++) {
      const ok = tryMoveEditorBodyBy(stepMove, moveDir, stepDelta, i);
      if (!ok) {
        editorVelocity.multiplyScalar(0.28);
        break;
      }
      moved = true;
    }

    return moved;
  }

  function getInputMoveDirection() {
    const state = callMaybe(options.getInputState) || {};
    const forwardPressed = Boolean(state.forward || state.KeyW || state.ArrowUp);
    const backwardPressed = Boolean(state.backward || state.KeyS || state.ArrowDown);
    const leftPressed = Boolean(state.left || state.KeyA || state.ArrowLeft);
    const rightPressed = Boolean(state.right || state.KeyD || state.ArrowRight);
    const wantsRun = Boolean(state.run || state.ShiftLeft || state.ShiftRight);

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() === 0) return { moveDir: null, wantsRun };
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const moveDir = new THREE.Vector3();
    if (forwardPressed) moveDir.add(forward);
    if (backwardPressed) moveDir.addScaledVector(forward, -1);
    if (leftPressed) moveDir.addScaledVector(right, -1);
    if (rightPressed) moveDir.add(right);

    if (moveDir.lengthSq() === 0) return { moveDir: null, wantsRun };
    moveDir.normalize();
    return { moveDir, wantsRun };
  }

  function update(deltaTime) {
    if (disposed) return false;
    if (callMaybe(options.getIsMovementEnabled) === false) return false;
    if (callMaybe(options.getIsTypingOrEditing) === true) return false;
    if (callMaybe(options.getIsTransformingObject) === true) return false;

    const dt = Math.min(Math.max(Number(deltaTime) || 0, 0), finiteNumber(config.maxFrameDelta, 0.033));
    if (dt <= 0) return false;

    const { moveDir, wantsRun } = getInputMoveDirection();
    if (!moveDir) {
      const dampAlpha = 1 - Math.exp(-finiteNumber(config.moveDamping, 12.5) * dt);
      editorVelocity.lerp(new THREE.Vector3(0, 0, 0), dampAlpha);
      if (editorVelocity.lengthSq() < 0.00045) editorVelocity.set(0, 0, 0);
      return false;
    }

    const targetSpeed = wantsRun ? finiteNumber(config.runSpeed, 4.05) : finiteNumber(config.walkSpeed, 2.05);
    const speedAlpha = 1 - Math.exp(-finiteNumber(config.runAcceleration, finiteNumber(config.moveAcceleration, 12)) * dt);
    smoothedMoveSpeed = THREE.MathUtils.lerp(smoothedMoveSpeed || targetSpeed, targetSpeed, speedAlpha);

    const maxDistance = Math.max(0.055, finiteNumber(config.collisionSubstepDistance, 0.045) * Math.max(1, finiteNumber(config.collisionMaxSubsteps, 3)));
    const distance = Math.min(smoothedMoveSpeed * dt, maxDistance);
    const targetVelocity = moveDir.clone().multiplyScalar(distance / dt);
    const accelAlpha = 1 - Math.exp(-finiteNumber(config.moveAcceleration, 12.0) * dt);
    editorVelocity.lerp(targetVelocity, accelAlpha);

    const velocityDir = editorVelocity.clone();
    velocityDir.y = 0;
    if (velocityDir.lengthSq() === 0) return false;
    velocityDir.normalize();

    const moved = moveEditorBodyWithSubsteps(editorVelocity, velocityDir, dt);
    if (!moved) editorVelocity.multiplyScalar(0.22);
    return moved;
  }

  function getBodyPosition() {
    return editorBodyPosition.clone();
  }

  function dispose() {
    disposed = true;
    blockingBoxes.length = 0;
    colliderBoxes.length = 0;
    walkableObjects = [];
    colliderObjects = [];
    groundProbeObjects = [];
  }

  function vectorToPlain(v) {
    if (!v) return null;
    return {
      x: Number(Number(v.x).toFixed(4)),
      y: Number(Number(v.y).toFixed(4)),
      z: Number(Number(v.z).toFixed(4))
    };
  }

  function debugLog(rejectReason, payload = {}, forceArg = false) {
    if (!debugEnabled) return;

    const now = performance.now();
    const force = Boolean(forceArg || payload.force || String(rejectReason).startsWith('SYNC') || rejectReason === 'TELEPORT_BODY');
    const groundInfo = payload.groundInfo || null;
    const blocker = payload.blocker || null;
    const usedWalkableSource = payload.usedWalkableSource || groundInfo?.usedWalkableSource || null;
    const key = `${rejectReason}:${usedWalkableSource || ''}:${groundInfo?.objectName || ''}:${blocker?.objectName || ''}`;

    if (!force && key === lastDebugKey && now - lastDebugAt < 220) return;
    if (!force && now - lastDebugAt < 110) return;
    lastDebugAt = now;
    lastDebugKey = key;

    const currentBody = payload.currentBodyPosition || editorBodyPosition;
    const nextBody = payload.nextBodyPosition || null;

    onDebugLog('[EditorMovement][debugStair]', {
      roomKey: getCurrentRoomKey(),
      currentBodyPosition: vectorToPlain(currentBody),
      nextBodyPosition: vectorToPlain(nextBody),
      cameraPosition: vectorToPlain(camera.position),
      moveDirection: vectorToPlain(payload.moveDirection),
      substepIndex: Number.isFinite(payload.substepIndex) ? payload.substepIndex : null,
      groundHit: groundInfo ? {
        objectName: groundInfo.objectName || null,
        parentName: groundInfo.parentName || null,
        groundY: Number.isFinite(groundInfo.groundY) ? Number(Number(groundInfo.groundY).toFixed(4)) : null,
        normalY: Number.isFinite(groundInfo.normalY) ? Number(Number(groundInfo.normalY).toFixed(4)) : null
      } : null,
      groundY: groundInfo && Number.isFinite(groundInfo.groundY) ? Number(Number(groundInfo.groundY).toFixed(4)) : null,
      currentGroundY: Number.isFinite(currentGroundY) ? Number(Number(currentGroundY).toFixed(4)) : null,
      stepDelta: groundInfo && Number.isFinite(groundInfo.stepDelta) ? Number(Number(groundInfo.stepDelta).toFixed(4)) : null,
      blockerHit: blocker ? {
        objectName: blocker.objectName || null,
        parentName: blocker.parentName || null,
        distance: Number.isFinite(blocker.distance) ? Number(Number(blocker.distance).toFixed(4)) : null,
        rayHeight: Number.isFinite(blocker.rayHeight) ? Number(Number(blocker.rayHeight).toFixed(4)) : null
      } : null,
      rejectReason,
      usedWalkableSource,
      lastAcceptedBodyPosition: vectorToPlain(lastAcceptedBodyPosition),
      blockingBoxes: blockingBoxes.length,
      colliderBoxes: colliderBoxes.length
    });
  }

  rebuildBlockingBoxes();

  return {
    initFromCamera,
    syncBodyFromCamera,
    syncCameraFromBody,
    update,
    teleportBodyTo,
    setWalkableObjects,
    setColliderObjects,
    setGroundProbeObjects,
    rebuildBlockingBoxes,
    getBodyPosition,
    getGroundYAt(position) {
      if (!position) return null;
      const body = position.clone ? position.clone() : new THREE.Vector3(position.x, position.y, position.z);
      const info = sampleGroundInfoAt(body, { includeFallback: true });
      return info ? info.groundY : null;
    },
    dispose,

    // Exposed for debug/test only; editor.html does not depend on these internals.
    __debug: {
      getBlockingBoxes: () => blockingBoxes.slice(),
      isWalkableLikeObject,
      hasColliderAhead,
      isEditorBodyBlockedAt
    }
  };
}
