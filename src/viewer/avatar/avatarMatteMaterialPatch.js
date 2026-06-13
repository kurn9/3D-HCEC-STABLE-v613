// HOTFIX Viewer V6.3.8 — Avatar Matte Material Patch
// Tách từ script inline trong gallery.html.
// Chỉ can thiệp runtime material của avatar/skinned mesh; không sửa GLB, scene, tranh, UI hoặc điều khiển.

import * as THREE from "three";

const AVATAR_MATTE_CONFIG = {
  default: {
    metalness: 0.0,
    roughness: 0.86,
    envMapIntensity: 0.06,
    specularIntensity: 0.18
  },
  skin: {
    metalness: 0.0,
    roughness: 0.74,
    envMapIntensity: 0.035,
    specularIntensity: 0.16
  },
  hair: {
    metalness: 0.0,
    roughness: 0.74,
    envMapIntensity: 0.16,
    specularIntensity: 0.28,
    alphaTest: 0.22,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    renderOrder: 2
  },
  cloth: {
    metalness: 0.0,
    roughness: 0.88,
    envMapIntensity: 0.045,
    specularIntensity: 0.14
  },
  shoe: {
    metalness: 0.0,
    roughness: 0.80,
    envMapIntensity: 0.07,
    specularIntensity: 0.18
  },
  glass: {
    metalness: 0.0,
    roughness: 0.42,
    envMapIntensity: 0.16,
    specularIntensity: 0.35
  }
};

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[_\-.]+/g, " ");
}

function getMaterialGroup(name) {
  const n = normalizeName(name);

  if (/\b(glass|glasses|sunglass|sunglasses|lens|lenses|eye|eyes|eyewear)\b/.test(n)) {
    return AVATAR_MATTE_CONFIG.glass;
  }

  if (/\b(skin|face|head|body|hand|hands|arm|arms|neck|ear|ears)\b/.test(n)) {
    return AVATAR_MATTE_CONFIG.skin;
  }

  if (/\b(hair|beard|mustache|moustache|brow|eyebrow|eyebrows)\b/.test(n)) {
    return AVATAR_MATTE_CONFIG.hair;
  }

  if (/\b(shoe|shoes|boot|boots|sneaker|sneakers|foot|feet)\b/.test(n)) {
    return AVATAR_MATTE_CONFIG.shoe;
  }

  if (/\b(shirt|jacket|coat|pants|trouser|trousers|jean|jeans|cloth|clothes|clothing|suit|cap|hat|belt)\b/.test(n)) {
    return AVATAR_MATTE_CONFIG.cloth;
  }

  return AVATAR_MATTE_CONFIG.default;
}

const loggedAvatarHairMaterials = new WeakSet();

function isAvatarHairDebugEnabled() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return params.get("debugAvatar") === "1" || params.get("debugMaterial") === "1" || window.CONFIG?.avatarHairVisibilityDebug === true;
  } catch {
    return window.CONFIG?.avatarHairVisibilityDebug === true;
  }
}

function colorToHex(color) {
  return color && typeof color.getHexString === "function" ? `#${color.getHexString()}` : null;
}

function logAvatarHairMaterial(obj, mat) {
  if (!isAvatarHairDebugEnabled() || !mat || loggedAvatarHairMaterials.has(mat)) return;
  const name = normalizeName(`${obj?.name || ""} ${mat?.name || ""}`);
  if (!/\b(hair|ch23 hair|head)\b/.test(name) && mat.name !== "Ch23_hair") return;
  loggedAvatarHairMaterials.add(mat);
  console.info("[avatar-hair-debug]", {
    mesh: obj?.name || "(unnamed mesh)",
    material: mat.name || mat.type || "(unnamed material)",
    transparent: Boolean(mat.transparent),
    alphaTest: Number.isFinite(mat.alphaTest) ? mat.alphaTest : null,
    depthWrite: mat.depthWrite,
    depthTest: mat.depthTest,
    side: mat.side,
    opacity: Number.isFinite(mat.opacity) ? Number(mat.opacity.toFixed(3)) : null,
    renderOrder: obj?.renderOrder ?? null,
    roughness: Number.isFinite(mat.roughness) ? Number(mat.roughness.toFixed(3)) : null,
    metalness: Number.isFinite(mat.metalness) ? Number(mat.metalness.toFixed(3)) : null,
    envMapIntensity: Number.isFinite(mat.envMapIntensity) ? Number(mat.envMapIntensity.toFixed(3)) : null,
    specularIntensity: Number.isFinite(mat.specularIntensity) ? Number(mat.specularIntensity.toFixed(3)) : null,
    emissive: colorToHex(mat.emissive),
    hasMap: Boolean(mat.map)
  });
}

function isAvatarLikeNode(obj, mat) {
  const name = normalizeName(`${obj?.name || ""} ${mat?.name || ""} ${obj?.parent?.name || ""}`);

  return Boolean(
    obj?.isSkinnedMesh ||
    obj?.isBone ||
    /\b(avatar|visitor|character|mixamo|armature|hips|spine|head|neck|wolf3d|ch\d|body|skin|hair|shirt|jacket|pants|trouser|shoe|boot)\b/.test(name)
  );
}

function softenTextureReflection(mat) {
  // Không xóa texture. Chỉ bảo đảm texture màu hiển thị đúng hệ màu trong Three.js mới.
  if (mat.map && "colorSpace" in mat.map) {
    mat.map.colorSpace = THREE.SRGBColorSpace;
    mat.map.needsUpdate = true;
  }

  // Các map này đôi khi làm avatar từ Blender/Mixamo bị bóng quá mạnh trong viewer.
  // Giữ lại normal/ao/base color, nhưng giảm ảnh hưởng phản xạ.
  if ("metalnessMap" in mat && mat.metalnessMap) {
    mat.metalnessMap = null;
  }

  if ("roughnessMap" in mat && mat.roughnessMap) {
    // Vẫn có thể giữ roughnessMap, nhưng trong nhiều file Mixamo map này làm áo đen bị loáng.
    // Tắt để roughness bằng số cố định ổn định hơn.
    mat.roughnessMap = null;
  }

  if ("envMapIntensity" in mat) {
    mat.envMapIntensity = Math.min(mat.envMapIntensity ?? 1, 0.08);
  }
}

function tuneOneMaterial(mat, obj) {
  if (!mat || mat.__galleryAvatarMatteTuned) return;
  if (!isAvatarLikeNode(obj, mat)) return;

  const group = getMaterialGroup(`${obj?.name || ""} ${mat?.name || ""}`);

  if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
    if ("metalness" in mat) mat.metalness = group.metalness;
    if ("roughness" in mat) mat.roughness = group.roughness;
    if ("envMapIntensity" in mat) mat.envMapIntensity = group.envMapIntensity;

    if ("clearcoat" in mat) mat.clearcoat = 0.0;
    if ("clearcoatRoughness" in mat) mat.clearcoatRoughness = 1.0;
    if ("sheen" in mat) mat.sheen = 0.0;
    if ("sheenRoughness" in mat) mat.sheenRoughness = 1.0;
    if ("iridescence" in mat) mat.iridescence = 0.0;
    if ("transmission" in mat) mat.transmission = 0.0;
    if ("specularIntensity" in mat) mat.specularIntensity = group.specularIntensity;

    softenTextureReflection(mat);

    // V6.11.17 hair-only patch: keep Ch23_hair readable against ROOM_EXT
    // without touching skin, cloth, shoes or the whole avatar.
    if (group === AVATAR_MATTE_CONFIG.hair) {
      if ("envMapIntensity" in mat) mat.envMapIntensity = group.envMapIntensity;
      if ("specularIntensity" in mat) mat.specularIntensity = group.specularIntensity;
      if ("metalness" in mat) mat.metalness = group.metalness;
      if ("roughness" in mat) mat.roughness = group.roughness;
      if ("alphaTest" in mat) mat.alphaTest = group.alphaTest;
      if ("transparent" in mat) mat.transparent = group.transparent;
      if ("depthWrite" in mat) mat.depthWrite = group.depthWrite;
      if ("depthTest" in mat) mat.depthTest = group.depthTest;
      if ("side" in mat) mat.side = THREE.DoubleSide;
      if ("opacity" in mat) mat.opacity = 1;
      if (obj && Number.isFinite(group.renderOrder)) obj.renderOrder = group.renderOrder;
    }
  } else if (mat.isMeshPhongMaterial) {
    mat.shininess = 4;
    if (mat.specular && mat.specular.isColor) {
      mat.specular.setRGB(0.035, 0.035, 0.035);
    }
  } else if (mat.isMeshLambertMaterial || mat.isMeshBasicMaterial) {
    // Các material này vốn không bóng, chỉ cần giữ nguyên.
  }

  mat.__galleryAvatarMatteTuned = true;
  mat.needsUpdate = true;
}

function tuneAvatarMaterials(root) {
  if (!root) return;

  root.traverse((obj) => {
    if (!obj || !obj.isMesh || !obj.material) return;

    obj.castShadow = true;
    obj.receiveShadow = false;

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((mat) => {
      logAvatarHairMaterial(obj, mat);
      tuneOneMaterial(mat, obj);
      logAvatarHairMaterial(obj, mat);
    });
  });
}

// Patch ở cấp Three.js để bắt đúng lúc avatar GLB được add vào scene trong ./src/viewer/main.js.
// Không cần sửa main.js.
const originalAdd = THREE.Object3D.prototype.add;

if (!THREE.Object3D.prototype.__galleryAvatarMattePatchInstalled) {
  THREE.Object3D.prototype.add = function patchedGalleryAdd(...objects) {
    const result = originalAdd.apply(this, objects);

    objects.forEach((obj) => {
      requestAnimationFrame(() => tuneAvatarMaterials(obj));
      setTimeout(() => tuneAvatarMaterials(obj), 250);
      setTimeout(() => tuneAvatarMaterials(obj), 1000);
    });

    return result;
  };

  THREE.Object3D.prototype.__galleryAvatarMattePatchInstalled = true;
}

window.__tuneGalleryAvatarMaterials = tuneAvatarMaterials;
window.__galleryAvatarMatteConfig = AVATAR_MATTE_CONFIG;
