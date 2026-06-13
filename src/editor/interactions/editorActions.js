function highlightSelected() {
  for (const [id, group] of itemGroups.entries()) {
    group.traverse((obj) => {
      if (!obj.isMesh || !obj.material || obj.name.includes("_IMAGE")) return;

      const selected = id === selectedId;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];

      mats.forEach((mat) => {
        if (mat.color) mat.color.set(selected ? 0xf2c76e : 0x17130d);
      });
    });
  }
}


function duplicateSelected() {
  const item = getItem(selectedId);
  if (!item) return;

  const id = nextArtId();
  const clone = normalizeItem(JSON.parse(JSON.stringify(item)));
  const right = getWallRightVector(item);
  const offsetDistance = getSafeDuplicateOffset(item);
  const sourcePosition = getItemPositionVector(item);
  const nextPosition = sourcePosition.addScaledVector(right, offsetDistance);

  clone.id = id;
  clone.title = `${item.title || item.id} - copy`;
  clone.position = vectorToPositionArray(nextPosition);
  clone.rotation = getRotationArray(item);
  clone.size = getSizeArray(item);

  data.push(clone);

  const group = createItemGroup(clone);
  scene.add(group);
  itemGroups.set(clone.id, group);

  renderGroupFilter();
  renderList();
  selectItem(clone.id);
  markDirty("duplicate_wall_aligned");
  showValidationReport(validateSceneData(data));

  setStatus(`
    ✅ <strong>Đã nhân bản cùng mặt tường</strong><br>
    ${escapeHtml(item.id)} → ${escapeHtml(clone.id)}<br>
    Bản copy giữ nguyên rotation/size và được dịch theo trục ngang của mặt tường.
  `);
}

function deleteSelected() {
  const item = getItem(selectedId);
  if (!item) return;

  if (!confirm(`Xóa ${item.id} - ${item.title || ""}?`)) return;

  const group = itemGroups.get(item.id);

  if (group) {
    scene.remove(group);
    disposeObject(group);
    itemGroups.delete(item.id);
  }

  for (let i = selectableMeshes.length - 1; i >= 0; i--) {
    if (selectableMeshes[i].userData.id === item.id) selectableMeshes.splice(i, 1);
  }

  data = data.filter((x) => x.id !== item.id);
  selectedId = data[0]?.id || null;

  renderGroupFilter();
  renderList();

  if (selectedId) selectItem(selectedId);
  markDirty("delete");
  showValidationReport(validateSceneData(data));
}

function nudgeSelected(direction) {
  const item = getItem(selectedId);
  const group = itemGroups.get(selectedId);

  if (!item || !group) return;

  const step = CONFIG.moveStep;
  const normal = getWallNormalVector(item);
  const right = getScreenAwareWallRightVector(item);
  const up = new THREE.Vector3(0, 1, 0);
  const delta = new THREE.Vector3();

  if (direction === "left") delta.addScaledVector(right, -step);
  if (direction === "right") delta.addScaledVector(right, step);
  if (direction === "up") delta.addScaledVector(up, step);
  if (direction === "down") delta.addScaledVector(up, -step);
  if (direction === "forward") delta.addScaledVector(normal, step);
  if (direction === "back") delta.addScaledVector(normal, -step);

  group.position.add(delta);
  item.position = vectorToPositionArray(group.position);

  syncForm();
  markDirty("nudge_screen_aware_wall_axis");
}

function rotateSelected90(sign) {
  const item = getItem(selectedId);
  if (!item) return;

  const oldWidth = Number(item.size?.[0] || CONFIG.defaultSize[0]);
  const oldHeight = Number(item.size?.[1] || CONFIG.defaultSize[1]);

  item.size = [
    Math.max(0.05, r3(oldHeight)),
    Math.max(0.05, r3(oldWidth))
  ];

  rebuildItem(item.id);
  syncForm();
  selectItem(item.id);
  markDirty("swap_orientation");

  setStatus(`
    ✅ <strong>Đã đổi ngang/dọc</strong><br>
    ${escapeHtml(item.id)} · Size: ${item.size[0]} × ${item.size[1]}<br>
    Không đổi rotation, không xoay texture, không làm tranh bị lật.
  `);
}

function resizeSelected(sign) {
  const item = getItem(selectedId);
  if (!item) return;

  item.size = [
    Math.max(0.05, r3(item.size[0] + CONFIG.sizeStep * sign)),
    Math.max(0.05, r3(item.size[1] + CONFIG.sizeStep * sign))
  ];

  rebuildItem(item.id);
  syncForm();
  selectItem(item.id);
  markDirty("resize");
}

function focusSelectedApprox() {
  const item = getItem(selectedId);
  if (!item) return;

  const pos = new THREE.Vector3(item.position[0], item.position[1], item.position[2]);
  const normal = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(item.rotation[0], item.rotation[1], item.rotation[2]));
  camera.position.copy(pos.clone().addScaledVector(normal, 2.2));
  camera.position.y = Math.max(camera.position.y, CONFIG.eyeHeight);
  camera.lookAt(pos);

  const e = camera.rotation;
  yaw = e.y;
  pitch = e.x;
}

/* =========================
   IMPORT / EXPORT / DRAFT
========================= */

function saveDraft() {
  localStorage.setItem("gallery_walk_cms_draft_v1", JSON.stringify(cleanData(), null, 2));

  setStatus(`
    ✅ <strong>Đã lưu tạm</strong><br>
    Dữ liệu nằm trong trình duyệt này. Để dùng cho viewer, vẫn cần xuất scene.json.
  `);
}

function exportJson() {
  const report = validateSceneData(data);
  showValidationReport(report);

  if (!report.valid) {
    setStatus(`
      ❌ <strong>Không xuất scene.json</strong><br>
      Dữ liệu còn ${report.errors.length} lỗi cấu trúc. Hãy sửa lỗi đỏ trong panel validate trước.
    `);
    return;
  }

  createEditorBackup("before_export", data);

  const json = JSON.stringify(cleanData(), null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "scene.json";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
  clearDirty();
  renderBackupList();

  setStatus(`
    ✅ <strong>Đã xuất scene.json an toàn</strong><br>
    Đã giữ đủ field chuẩn hóa và tạo backup trước export.<br>
    Thay file vừa tải vào: <b>data/scene.json</b>, sau đó reload viewer bằng Ctrl + F5.
  `);
}

function requestImportJson() {
  dom.importFile.value = "";
  dom.importFile.click();
}

function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || ""));
      const report = validateSceneData(parsed);
      showValidationReport(report);

      if (!report.valid) {
        setStatus(`
          ❌ <strong>Import bị chặn</strong><br>
          File JSON có ${report.errors.length} lỗi. Dữ liệu hiện tại chưa bị thay đổi.
        `);
        return;
      }

      if (!confirm(`Import file ${file.name}? Dữ liệu đang mở sẽ được thay bằng file này.`)) return;

      createEditorBackup("before_import", data);
      data = parsed.map(normalizeItem);
      selectedId = data[0]?.id || null;

      buildAllItems();
      renderGroupFilter();
      renderList();
      if (selectedId) selectItem(selectedId);
      markDirty("import_json");
      showValidationReport(validateSceneData(data));

      setStatus(`
        ✅ <strong>Đã import JSON</strong><br>
        Object: ${data.length}. Hãy kiểm tra scene rồi export scene.json nếu muốn dùng chính thức.
      `);
    } catch (error) {
      console.error(error);
      setStatus(`❌ <strong>Import lỗi</strong><br>${escapeHtml(error.message || error)}`);
    }
  };

  reader.onerror = () => {
    setStatus("❌ <strong>Import lỗi</strong><br>Không đọc được file JSON đã chọn.");
  };

  reader.readAsText(file, "utf-8");
}

function cleanData() {
  return data.map((item) => {
    return {
      id: String(item.id || ""),
      title: item.title || "",
      author: item.author || "",
      year: item.year || "",
      material: item.material || "",
      realSize: item.realSize || "",
      description: item.description || "",
      content: item.content || "",
      note: item.note || "",
      image: item.image || "",
      position: [
        r3(item.position?.[0] || 0),
        r3(item.position?.[1] || 0),
        r3(item.position?.[2] || 0)
      ],
      rotation: [
        r4(item.rotation?.[0] || 0),
        r4(item.rotation?.[1] || 0),
        r4(item.rotation?.[2] || 0)
      ],
      size: [
        r3(item.size?.[0] || CONFIG.defaultSize[0]),
        r3(item.size?.[1] || CONFIG.defaultSize[1])
      ],
      group: item.group || "",
      frame: item.frame !== false,
      transparent: item.transparent === true,
      clickable: item.clickable !== false
    };
  });
}

/* =========================
   HELPERS
========================= */

function normalizeItem(raw) {
  const item = { ...raw };

  item.id = String(item.id || nextArtId());
  item.title = item.title || item.id;
  item.description = item.description || "";
  item.image = item.image || "./assets/artworks/art_001.jpg";
  item.group = item.group || "CHUA_PHAN_NHOM";

  item.author = item.author || "";
  item.year = item.year || "";
  item.material = item.material || "";
  item.realSize = item.realSize || "";
  item.content = item.content || "";
  item.note = item.note || "";

  item.position = Array.isArray(item.position) ? item.position.map(Number) : [0, CONFIG.defaultY, 0];
  item.rotation = Array.isArray(item.rotation) ? item.rotation.map(Number) : [0, 0, 0];
  item.size = Array.isArray(item.size) ? item.size.map(Number) : CONFIG.defaultSize.slice();

  if (item.frame === undefined) item.frame = true;
  if (item.transparent === undefined) item.transparent = false;
  if (item.clickable === undefined) item.clickable = true;

  return item;
}

/* =========================
   HOTFIX V2.1 — WALL AXIS HELPERS
========================= */

function getItemEuler(item) {
  const rotation = Array.isArray(item?.rotation) ? item.rotation : [0, 0, 0];

  // V2.1: rotation.z từng được dùng như roll để xoay ngang/dọc.
  // Không dùng rotation.z để suy luận mặt tường, tránh nudge/duplicate bị đảo sau khi ảnh đã từng xoay 90°.
  return new THREE.Euler(
    Number(rotation[0]) || 0,
    Number(rotation[1]) || 0,
    0,
    "XYZ"
  );
}

function getWallNormalVector(item) {
  const normal = new THREE.Vector3(0, 0, 1).applyEuler(getItemEuler(item));

  if (normal.lengthSq() < 0.000001) return new THREE.Vector3(0, 0, 1);
  return normal.normalize();
}

function getWallRightVector(item) {
  const normal = getWallNormalVector(item);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, normal);

  if (right.lengthSq() < 0.000001) {
    return new THREE.Vector3(1, 0, 0);
  }

  return right.normalize();
}

/* =========================
   HOTFIX V2.2 — SCREEN-AWARE RIGHT AXIS
   Trái/phải trong editor phải khớp cảm giác thị giác trên màn hình.
   Nếu +wallRight chiếu lên màn hình lại nằm bên trái tâm tranh, đảo vector lại.
========================= */

function getScreenAwareWallRightVector(item) {
  const fallbackRight = getWallRightVector(item);

  try {
    if (typeof camera === "undefined" || !camera || !camera.isCamera) {
      return fallbackRight;
    }

    if (typeof camera.updateMatrixWorld === "function") {
      camera.updateMatrixWorld(true);
    }

    const centerWorld = getItemPositionVector(item);
    const rightWorld = centerWorld.clone().add(fallbackRight);

    const centerNdc = centerWorld.clone().project(camera);
    const rightNdc = rightWorld.clone().project(camera);

    const values = [centerNdc.x, centerNdc.y, centerNdc.z, rightNdc.x, rightNdc.y, rightNdc.z];
    if (!values.every(Number.isFinite)) {
      return fallbackRight;
    }

    if (rightNdc.x < centerNdc.x) {
      return fallbackRight.clone().multiplyScalar(-1);
    }

    return fallbackRight;
  } catch (error) {
    console.warn("getScreenAwareWallRightVector fallback:", error);
    return fallbackRight;
  }
}

function getItemPositionVector(item) {
  const position = Array.isArray(item?.position) ? item.position : [0, CONFIG.defaultY, 0];

  return new THREE.Vector3(
    Number(position[0]) || 0,
    Number(position[1]) || 0,
    Number(position[2]) || 0
  );
}

function getRotationArray(item) {
  const rotation = Array.isArray(item?.rotation) ? item.rotation : [0, 0, 0];
  return [r4(rotation[0] || 0), r4(rotation[1] || 0), r4(rotation[2] || 0)];
}

function getSizeArray(item) {
  const size = Array.isArray(item?.size) ? item.size : CONFIG.defaultSize;

  return [
    Math.max(0.05, r3(size[0] || CONFIG.defaultSize[0])),
    Math.max(0.05, r3(size[1] || CONFIG.defaultSize[1]))
  ];
}

function getSafeDuplicateOffset(item) {
  const [width] = getSizeArray(item);
  const framePadding = item.frame === false ? 0 : CONFIG.frameBorder * 2;
  const gap = 0.18;

  return Math.max(0.35, r3(width + framePadding + gap));
}

function vectorToPositionArray(vector) {
  return [r3(vector.x), r3(vector.y), r3(vector.z)];
}

function getItem(id) {
  return data.find((item) => item.id === id);
}

function nextArtId() {
  let max = 0;

  data.forEach((item) => {
    const m = String(item.id || "").match(/^ART_(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });

  return `ART_${String(max + 1).padStart(3, "0")}`;
}

function findObjectByNameCaseInsensitive(root, targetName) {
  const target = targetName.toLowerCase();
  let found = null;

  root.traverse((obj) => {
    if (found) return;
    if (obj.name && obj.name.toLowerCase() === target) found = obj;
  });

  return found;
}

function makeInvisible(obj) {
  if (!obj.material) return;

  const mats = Array.isArray(obj.material) ? obj.material : [obj.material];

  mats.forEach((mat) => {
    mat.transparent = true;
    mat.opacity = 0;
    mat.depthWrite = false;
    mat.needsUpdate = true;
  });
}

function disposeObject(object) {
  object.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();

    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];

      mats.forEach((mat) => {
        for (const key in mat) {
          const value = mat[key];
          if (value && typeof value === "object" && typeof value.dispose === "function") {
            value.dispose();
          }
        }

        mat.dispose();
      });
    }
  });
}

function normalizeAngle90(value) {
  const twoPi = Math.PI * 2;
  let v = value;

  while (v > Math.PI) v -= twoPi;
  while (v <= -Math.PI) v += twoPi;

  // Làm tròn về các mốc 90° để tránh số lẻ kéo dài sau nhiều lần bấm.
  return Math.round(v / (Math.PI / 2)) * (Math.PI / 2);
}

function num(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function r3(value) {
  return Number(Number(value).toFixed(3));
}

function r4(value) {
  return Number(Number(value).toFixed(4));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
   LOOP / RESIZE
========================= */

let probeTimer = 0;
