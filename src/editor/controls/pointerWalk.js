/* =========================
   POINTER LOCK / WALK
========================= */

dom.btnLock.addEventListener("click", () => {
  renderer.domElement.requestPointerLock();
});

renderer.domElement.addEventListener("click", () => {
  if (!isLocked) {
    renderer.domElement.requestPointerLock();
    return;
  }

  selectItemAtCenter();
});

document.addEventListener("pointerlockchange", () => {
  isLocked = document.pointerLockElement === renderer.domElement;

  if (isLocked) {
    setStatus(`
      ✅ <strong>Đang đi trong phòng</strong><br>
      WASD: di chuyển · Chuột: nhìn xung quanh<br>
      Click vào tranh ở tâm màn hình: chọn tranh<br>
      Shift: đi nhanh · ESC: hiện con trỏ
    `);
  } else {
    setStatus(`
      ✅ <strong>Đã hiện con trỏ</strong><br>
      Bạn có thể sửa ảnh, nội dung, vị trí ở panel trái.<br>
      Click vào phòng 3D để tiếp tục đi.
    `);
  }
});

document.addEventListener("mousemove", (event) => {
  if (!isLocked) return;

  yaw -= event.movementX * CONFIG.lookSensitivity;
  pitch -= event.movementY * CONFIG.lookSensitivity;

  const limit = Math.PI / 2 - 0.05;
  pitch = Math.max(-limit, Math.min(limit, pitch));

  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
});

window.addEventListener("keydown", (event) => {
  keys[event.code] = true;

  if (event.target && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;

  if (event.code === "KeyP") placeSelectedOnWall();
  if (event.code === "KeyN") addItemAtWall();
  if (event.code === "Delete") deleteSelected();
});

window.addEventListener("keyup", (event) => {
  keys[event.code] = false;
});

function updateMovement(deltaTime) {
  if (!isLocked || !roomReady) return;

  const speed = keys["ShiftLeft"] || keys["ShiftRight"] ? CONFIG.runSpeed : CONFIG.walkSpeed;
  const distance = speed * deltaTime;

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  const right = new THREE.Vector3();
  right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  const moveDir = new THREE.Vector3();

  if (keys["KeyW"] || keys["ArrowUp"]) moveDir.add(forward);
  if (keys["KeyS"] || keys["ArrowDown"]) moveDir.addScaledVector(forward, -1);
  if (keys["KeyA"] || keys["ArrowLeft"]) moveDir.addScaledVector(right, -1);
  if (keys["KeyD"] || keys["ArrowRight"]) moveDir.add(right);

  if (moveDir.lengthSq() === 0) return;

  moveDir.normalize();

  if (hasColliderAhead(moveDir)) return;

  const nextPosition = camera.position.clone().addScaledVector(moveDir, distance);
  const groundY = getGroundYAt(nextPosition);

  if (groundY === null) return;

  const targetEyeY = groundY + CONFIG.eyeHeight;
  const deltaY = targetEyeY - camera.position.y;

  if (deltaY > CONFIG.maxStepUp) return;
  if (deltaY < -CONFIG.maxStepDown) return;

  nextPosition.y = targetEyeY;
  camera.position.copy(nextPosition);
}

function getGroundYAt(position) {
  if (walkableObjects.length === 0) {
    return CONFIG.useFallbackFloorWhenNoWalkable ? fallbackFloorY : null;
  }

  const origin = new THREE.Vector3(position.x, position.y + 2.0, position.z);

  groundRaycaster.set(origin, downVector);
  groundRaycaster.far = 6;

  const hits = groundRaycaster.intersectObjects(walkableObjects, true);

  for (const hit of hits) {
    if (!hit.face) continue;

    const normal = hit.face.normal.clone();
    normal.transformDirection(hit.object.matrixWorld);

    if (normal.y > 0.25) {
      return hit.point.y;
    }
  }

  return null;
}

function hasColliderAhead(direction) {
  if (colliderObjects.length === 0) return false;

  const origin = camera.position.clone();
  origin.y = camera.position.y - 0.25;

  wallRaycaster.set(origin, direction);
  wallRaycaster.far = CONFIG.wallDistance;

  const hits = wallRaycaster.intersectObjects(colliderObjects, true);
  return hits.length > 0;
}

/* =========================
   BUILD ITEMS
========================= */
