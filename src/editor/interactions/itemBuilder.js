function buildAllItems() {
  for (const group of itemGroups.values()) {
    scene.remove(group);
    disposeObject(group);
  }

  itemGroups.clear();
  selectableMeshes.length = 0;

  for (const item of data) {
    const group = createItemGroup(item);
    scene.add(group);
    itemGroups.set(item.id, group);
  }
}

function rebuildItem(id) {
  const item = getItem(id);
  if (!item) return;

  const old = itemGroups.get(id);

  if (old) {
    scene.remove(old);
    disposeObject(old);
    itemGroups.delete(id);
  }

  for (let i = selectableMeshes.length - 1; i >= 0; i--) {
    if (selectableMeshes[i].userData.id === id) {
      selectableMeshes.splice(i, 1);
    }
  }

  const group = createItemGroup(item);
  scene.add(group);
  itemGroups.set(id, group);
}

function createItemGroup(item) {
  const group = new THREE.Group();
  group.name = item.id;

  group.position.set(item.position[0], item.position[1], item.position[2]);
  group.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2]);

  group.userData = { type: "galleryItem", id: item.id };

  const imageMesh = createImageMesh(item, item.size[0], item.size[1]);
  group.add(imageMesh);

  if (item.frame !== false) {
    group.add(createFrame(item.size[0], item.size[1]));
  }

  return group;
}

function createImageMesh(item, w, h) {
  const geo = new THREE.PlaneGeometry(w, h);

  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: Boolean(item.transparent),
    alphaTest: item.transparent ? 0.05 : 0
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `${item.id}_IMAGE`;
  mesh.position.z = CONFIG.frameDepth / 2 + 0.004;
  mesh.userData = { type: "galleryImage", id: item.id };

  selectableMeshes.push(mesh);
  loadTexture(mesh, item);

  return mesh;
}

function loadTexture(mesh, item) {
  textureLoader.load(
    item.image,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;

      mesh.material.map = tex;
      mesh.material.transparent = Boolean(item.transparent);
      mesh.material.alphaTest = item.transparent ? 0.05 : 0;
      mesh.material.needsUpdate = true;
    },
    undefined,
    () => {
      mesh.material.map = makePlaceholderTexture(item.id);
      mesh.material.needsUpdate = true;
      console.warn("Không load được ảnh:", item.image);
    }
  );
}

function makePlaceholderTexture(label) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#292929";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#f2c76e";
  ctx.lineWidth = 8;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 38px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createFrame(w, h) {
  const border = CONFIG.frameBorder;
  const depth = CONFIG.frameDepth;

  const group = new THREE.Group();
  group.name = "FRAME";

  const mat = new THREE.MeshStandardMaterial({
    color: 0x17130d,
    roughness: 0.62,
    metalness: 0.12
  });

  const tbGeo = new THREE.BoxGeometry(w + border * 2, border, depth);
  const sideGeo = new THREE.BoxGeometry(border, h, depth);

  const top = new THREE.Mesh(tbGeo, mat);
  top.position.set(0, h / 2 + border / 2, 0);

  const bottom = new THREE.Mesh(tbGeo, mat);
  bottom.position.set(0, -h / 2 - border / 2, 0);

  const left = new THREE.Mesh(sideGeo, mat);
  left.position.set(-w / 2 - border / 2, 0, 0);

  const right = new THREE.Mesh(sideGeo, mat);
  right.position.set(w / 2 + border / 2, 0, 0);

  group.add(top, bottom, left, right);
  return group;
}

/* =========================
   SELECT / ADD / PLACE
========================= */

function selectItemAtCenter() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = 20;

  const hits = raycaster.intersectObjects(selectableMeshes, true);

  if (hits.length === 0) {
    setStatus(`
      ⚠️ <strong>Chưa chọn được tranh</strong><br>
      Đưa tâm màn hình vào tranh rồi click lại.
    `);
    return;
  }

  selectItem(hits[0].object.userData.id);
}

function checkCenterTarget() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = 20;

  const hits = raycaster.intersectObjects(selectableMeshes, true);

  if (hits.length > 0) {
    dom.crosshair.classList.add("target");
  } else {
    dom.crosshair.classList.remove("target");
  }
}

function addItemAtWall() {
  const wallData = getWallPlacementFromCenter();

  if (!wallData) {
    setStatus(`
      ⚠️ <strong>Không thêm được tranh</strong><br>
      Nhìn thẳng vào mặt tường rồi bấm lại.
    `);
    return;
  }

  const id = nextArtId();
  const number = id.replace("ART_", "");

  const item = normalizeItem({
    id,
    title: `Tác phẩm ${number}`,
    description: `Mô tả ${id}`,
    image: `./assets/artworks/art_${number}.jpg`,
    author: "",
    year: "",
    material: "",
    realSize: "",
    content: "",
    note: "",
    position: wallData.position,
    rotation: wallData.rotation,
    size: CONFIG.defaultSize,
    frame: true,
    transparent: false,
    clickable: true,
    group: "MOI_THEM"
  });

  data.push(item);

  const group = createItemGroup(item);
  scene.add(group);
  itemGroups.set(item.id, group);

  renderGroupFilter();
  renderList();
  selectItem(item.id);
  markDirty("add_item");
  showValidationReport(validateSceneData(data));

  setStatus(`
    ✅ <strong>Đã thêm tranh mới</strong><br>
    ${escapeHtml(item.id)} đã được đặt vào tường trước mặt.<br>
    ESC để nhập ảnh và nội dung tranh.
  `);
}

function placeSelectedOnWall() {
  const item = getItem(selectedId);
  const group = itemGroups.get(selectedId);

  if (!item || !group) {
    alert("Hãy chọn một mục trước.");
    return;
  }

  const wallData = getWallPlacementFromCenter();

  if (!wallData) {
    setStatus(`
      ⚠️ <strong>Không bắt được mặt tường</strong><br>
      Nhìn thẳng vào mặt tường rồi bấm P hoặc nút Đặt lại vào tường.
    `);
    return;
  }

  item.position = wallData.position;
  item.rotation = wallData.rotation;

  group.position.set(item.position[0], item.position[1], item.position[2]);
  group.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2]);

  syncForm();
  markDirty("place_on_wall");

  setStatus(`
    ✅ <strong>Đã đặt lại vào tường</strong><br>
    ${escapeHtml(item.id)}<br>
    X: ${item.position[0]} · Y: ${item.position[1]} · Z: ${item.position[2]}
  `);
}

function getWallPlacementFromCenter() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = 100;

  const hits = raycaster.intersectObjects(roomMeshes, true);

  if (hits.length === 0) return null;

  const hit = hits[0];
  if (!hit.face) return null;

  const normal = hit.face.normal.clone();
  normal.transformDirection(hit.object.matrixWorld);
  normal.normalize();

  const towardCamera = camera.position.clone().sub(hit.point).normalize();
  if (normal.dot(towardCamera) < 0) normal.negate();

  const pos = hit.point.clone().addScaledVector(normal, CONFIG.wallOffset);
  pos.y = getItem(selectedId)?.position?.[1] ?? CONFIG.defaultY;

  const q = new THREE.Quaternion();
  q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

  const euler = new THREE.Euler().setFromQuaternion(q, "XYZ");

  return {
    position: [r3(pos.x), r3(pos.y), r3(pos.z)],
    rotation: [r4(euler.x), r4(euler.y), r4(euler.z)]
  };
}

/* =========================
   FORM / LIST
========================= */
