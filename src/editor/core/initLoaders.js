/* =========================
   INIT
========================= */

async function init() {
  try {
    setStatus("Đang tải phòng 3D...");
    await loadRoom();

    setStatus("Đang tải data/scene.json...");
    await loadSceneJson();

    const draft = localStorage.getItem("gallery_walk_cms_draft_v1");
    if (draft && confirm("Có bản lưu tạm trong trình duyệt. Dùng bản lưu tạm không?")) {
      data = JSON.parse(draft).map(normalizeItem);
      markDirty("load_draft");
    }

    buildAllItems();
    renderGroupFilter();
    renderList();
    renderBackupList();
    showValidationReport(validateSceneData(data));

    if (data.length > 0) {
      selectItem(data[0].id);
    }

    setStatus(`
      ✅ <strong>Editor sẵn sàng</strong><br>
      Tổng mục: ${data.length}<br>
      Walkable: ${walkableObjects.length} · Collider: ${colliderObjects.length}<br>
      Click màn hình 3D để đi trong phòng.
    `);
  } catch (error) {
    console.error(error);
    setStatus(`❌ <strong>Lỗi khởi tạo</strong><br>${escapeHtml(error.message || error)}`);
  }
}

function loadRoom() {
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      CONFIG.roomUrl,
      (gltf) => {
        const model = gltf.scene;

        model.traverse((obj) => {
          if (!obj.isMesh) return;

          roomMeshes.push(obj);

          const name = obj.name.toLowerCase();

          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((mat) => {
              mat.side = THREE.DoubleSide;
              mat.needsUpdate = true;
            });
          }

          if (
            name.includes("floor") ||
            name.includes("stair") ||
            name.includes("stairs") ||
            name.includes("walk") ||
            name.includes("ramp")
          ) {
            walkableObjects.push(obj);
          }

          if (name.includes("collider")) {
            colliderObjects.push(obj);
          }

          if (
            name.includes("walk_") ||
            name.includes("navmesh") ||
            name.includes("walkmesh")
          ) {
            makeInvisible(obj);
          }
        });

        scene.add(model);
        model.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(model);
        fallbackFloorY = Number.isFinite(box.min.y) ? box.min.y : 0;

        const startPoint =
          findObjectByNameCaseInsensitive(model, "START_POINT") ||
          findObjectByNameCaseInsensitive(model, "Empty");

        if (startPoint) {
          const pos = new THREE.Vector3();
          startPoint.getWorldPosition(pos);
          camera.position.set(pos.x, pos.y, pos.z);
        } else {
          const center = box.getCenter(new THREE.Vector3());
          camera.position.set(center.x, fallbackFloorY + CONFIG.eyeHeight, center.z);
        }

        yaw = 0;
        pitch = 0;
        camera.rotation.set(pitch, yaw, 0);

        roomReady = true;
        resolve();
      },
      undefined,
      () => reject(new Error(`Không load được ${CONFIG.roomUrl}`))
    );
  });
}

async function loadSceneJson() {
  const res = await fetch(CONFIG.sceneUrl, { cache: "no-store" });

  if (!res.ok) throw new Error(`Không load được ${CONFIG.sceneUrl} - HTTP ${res.status}`);

  const json = await res.json();

  if (!Array.isArray(json)) throw new Error("scene.json phải là một mảng JSON.");

  data = json.map(normalizeItem);
}

