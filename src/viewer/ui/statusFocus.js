function simpleStatusFromHtml(html) {
  const raw = String(html || '');
  const plain = raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let label = 'Đang tham quan';
  let icon = '✅';

  if (/lỗi|không load|chưa load/i.test(plain)) {
    label = 'Có lỗi';
    icon = '⚠️';
  } else if (/đang tải|load phòng|load glb|khởi tạo/i.test(plain)) {
    label = 'Đang tải';
    icon = '⏳';
  } else if (/sẵn sàng|click vào màn hình/i.test(plain)) {
    label = 'Sẵn sàng tham quan';
    icon = '✅';
  } else if (/đang xem ảnh|mở ảnh|chi tiết tác phẩm/i.test(plain)) {
    label = 'Đang xem ảnh';
    icon = '🖼️';
  } else if (/đang ngồi/i.test(plain)) {
    label = 'Đang ngồi ngắm cảnh';
    icon = '✅';
  } else if (/đã đứng dậy/i.test(plain)) {
    label = 'Đã đứng dậy';
    icon = '✅';
  } else if (/chưa gần/i.test(plain)) {
    label = 'Chưa gần ghế';
    icon = '⚠️';
  } else if (/góc nhìn thứ nhất/i.test(plain)) {
    label = 'Đang tham quan';
    icon = '✅';
  } else if (/góc nhìn avatar|đang tham quan|avatar glb/i.test(plain)) {
    label = 'Đang tham quan';
    icon = '✅';
  }

  return `${icon} <strong>${label}</strong>`;
}

function setStatus(html) {
  statusEl.innerHTML = simpleStatusFromHtml(html);
}
function setLoadingProgress(percent) {
  const value = Math.max(0, Math.min(100, percent));
  loadingBar.style.width = `${value}%`;
  if (value >= 100) setTimeout(() => loadingWrap.classList.add('hidden'), 420);
}
function showError(message, details = '') {
  console.error(message, details);
  setStatus(`❌ <strong>Lỗi</strong><br>${message}${details ? `<br><span style="opacity:.75">${details}</span>` : ''}`);
  setLoadingProgress(100);

  try {
    window.dispatchEvent(new CustomEvent('viewer:fatal-error', {
      detail: { message, details, source: 'viewer-runtime' }
    }));
  } catch (_) {}
}
function findObjectByNameCaseInsensitive(root, targetName) {
  const lower = targetName.toLowerCase();
  let found = null;
  root.traverse((obj) => {
    if (found) return;
    if (obj.name && obj.name.toLowerCase() === lower) found = obj;
  });
  return found;
}
function setMaterialDoubleSide(obj) {
  if (!obj.material) return;
  const apply = (mat) => { mat.side = THREE.DoubleSide; mat.needsUpdate = true; };
  Array.isArray(obj.material) ? obj.material.forEach(apply) : apply(obj.material);
}
function setMaterialInvisible(obj) {
  if (!obj.material) return;
  const apply = (mat) => {
    mat.transparent = true;
    mat.opacity = 0;
    mat.depthWrite = false;
    mat.needsUpdate = true;
  };
  Array.isArray(obj.material) ? obj.material.forEach(apply) : apply(obj.material);
}
function readField(data, keys, fallback = '—') {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null && String(data[key]).trim() !== '') {
      return String(data[key]);
    }
  }
  return fallback;
}
function getArtworkRootFromObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.type === 'artworkRoot') return current;
    if (current.userData?.artRoot) return current.userData.artRoot;
    current = current.parent;
  }
  return null;
}
function updateFocusCard(root) {
  if (!root || modalOpen) {
    focusCard.classList.remove('active');
    return;
  }
  const data = root.userData.artData || {};
  focusTitle.textContent = data.title || data.id || 'Tác phẩm';
  const line2 = [data.author, data.year].filter(Boolean).join(' · ');
  focusSub.textContent = line2 || 'Click để xem chi tiết tác phẩm';
  focusCard.classList.add('active');
}
function hideFocusCard() { focusCard.classList.remove('active'); }
