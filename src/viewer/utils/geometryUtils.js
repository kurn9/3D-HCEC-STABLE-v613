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
  return keywords.some((kw) => textValue.includes(kw));
}

function closestPointOnBoxXZ(pos, box) {
  return new THREE.Vector3(
    THREE.MathUtils.clamp(pos.x, box.min.x, box.max.x),
    pos.y,
    THREE.MathUtils.clamp(pos.z, box.min.z, box.max.z)
  );
}

function distanceToBoxXZ(pos, box) {
  const p = closestPointOnBoxXZ(pos, box);
  const dx = pos.x - p.x;
  const dz = pos.z - p.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function isStairOrWalkableHelperName(name = '') {
  const n = String(name || '').toLowerCase();
  const keywords = CONFIG.stairIgnoreColliderKeywords || ['stair', 'stairs', 'step', 'steps', 'ramp', 'walk', 'walkable', 'navmesh'];
  return keywords.some((kw) => n.includes(String(kw).toLowerCase()));
}

function clampFinite(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
