import './cmsSchemaValidator.js';
import './cmsContentLoader.js';
// FEATURE V6.9 — Pre-entry Room Gate
// HOTFIX V6.11.9-B — Entrance/lobby gate redesign. No assets, no images, no GLB/scene loading here.

const CANONICAL_ROOMS = {
  indoor: {
    id: 'indoor',
    aliases: ['main', 'default'],
    label: 'Trong nhà',
    viewerAction: 'Tham quan →',
    editorAction: 'Chỉnh phòng trong nhà',
    roomUrl: './assets/room_base.glb',
    sceneJsonUrl: './data/scene.json',
    exportFileName: 'scene.json'
  },
  outdoor: {
    id: 'outdoor',
    aliases: ['outside', 'ngoai-troi', 'outdoor-gallery'],
    label: 'Ngoài trời',
    viewerAction: 'Tham quan →',
    editorAction: 'Chỉnh phòng ngoài trời',
    roomUrl: './assets/room_outdoor.glb',
    sceneJsonUrl: './data/scene_outdoor.json',
    exportFileName: 'scene_outdoor.json'
  }
};

function normalizeRoomId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
}

function resolveCanonicalRoomId(value) {
  const normalized = normalizeRoomId(value);
  if (!normalized) return '';
  if (CANONICAL_ROOMS[normalized]) return normalized;

  return Object.values(CANONICAL_ROOMS).find((room) => {
    const aliases = Array.isArray(room.aliases) ? room.aliases : [];
    return aliases.some((alias) => normalizeRoomId(alias) === normalized);
  })?.id || '';
}

export function getRoomGateState(search = window.location.search) {
  let params;
  try {
    params = new URLSearchParams(search || '');
  } catch (error) {
    console.warn('[RoomGate] Không đọc được query URL.', error);
    return {
      hasRoomParam: false,
      requestedRoomId: '',
      canonicalRoomId: '',
      hasValidRoom: false,
      reason: 'invalid-query'
    };
  }

  const hasRoomParam = params.has('room');
  const requestedRoomId = normalizeRoomId(params.get('room') || '');
  const canonicalRoomId = resolveCanonicalRoomId(requestedRoomId);

  return {
    hasRoomParam,
    requestedRoomId,
    canonicalRoomId,
    hasValidRoom: hasRoomParam && Boolean(canonicalRoomId),
    reason: !hasRoomParam ? 'missing-room' : (canonicalRoomId ? 'valid-room' : 'invalid-room')
  };
}

export function hasValidRoomQuery(search = window.location.search) {
  return getRoomGateState(search).hasValidRoom;
}

export function getRequestedRoomId(search = window.location.search) {
  return getRoomGateState(search).requestedRoomId;
}

function ensureRoomGateStyle() {
  const hasViewerCss = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .some((link) => /styles\/viewer\.css(?:$|[?#])/.test(link.getAttribute('href') || ''));

  if (hasViewerCss || document.getElementById('roomGateViewerStyle')) return;

  const link = document.createElement('link');
  link.id = 'roomGateViewerStyle';
  link.rel = 'stylesheet';
  link.href = './styles/viewer.css';
  link.dataset.roomGateCss = 'true';
  document.head.appendChild(link);
}



function setRoomGateText(target, value) {
  if (!target || value === null || value === undefined) return false;
  const text = window.cmsContentLoader?.sanitizeText?.(value) ?? String(value).trim();
  if (!text) return false;
  target.textContent = text;
  return true;
}

function getCmsRoomGateCopy(content, mode) {
  const gate = window.cmsContentLoader?.getCmsGateContent?.(content) || content?.gate || null;
  if (!gate) return null;
  if (mode === 'editor' && gate.editor) {
    return {
      ...gate,
      title: gate.editor.title || gate.title,
      description: gate.editor.description || gate.description,
      ctaLabel: gate.editor.ctaLabel || gate.ctaLabel || 'Chỉnh sửa'
    };
  }
  return gate;
}

async function hydrateRoomGateFromCms(gateElement, mode) {
  const cms = window.cmsContentLoader;
  if (!gateElement || !cms?.loadCmsContent) return;
  try {
    const content = await cms.loadCmsContent({ context: 'gate', timeoutMs: 900 });
    const gateCopy = getCmsRoomGateCopy(content, mode);
    if (!gateCopy) return;
    let changed = 0;
    changed += setRoomGateText(gateElement.querySelector('.room-gate__eyebrow'), gateCopy.eyebrow) ? 1 : 0;
    changed += setRoomGateText(gateElement.querySelector('.room-gate__title'), gateCopy.title) ? 1 : 0;
    changed += setRoomGateText(gateElement.querySelector('.room-gate__desc'), gateCopy.description) ? 1 : 0;
    changed += setRoomGateText(gateElement.querySelector('.room-gate__home'), gateCopy.backLabel) ? 1 : 0;

    ['outdoor', 'indoor'].forEach((roomId) => {
      const roomCopy = gateCopy.rooms?.[roomId];
      const option = gateElement.querySelector(`.room-gate__entrance[data-room="${roomId}"]`);
      if (!roomCopy || !option) return;
      changed += setRoomGateText(option.querySelector('.room-gate__entrance-copy small'), roomCopy.label) ? 1 : 0;
      changed += setRoomGateText(option.querySelector('.room-gate__entrance-copy strong'), roomCopy.title) ? 1 : 0;
      changed += setRoomGateText(option.querySelector('.room-gate__entrance-copy span'), roomCopy.description) ? 1 : 0;
      changed += setRoomGateText(option.querySelector('.room-gate__cta span'), mode === 'editor' ? (gateCopy.ctaLabel || roomCopy.editorCtaLabel || 'Chỉnh sửa') : roomCopy.ctaLabel) ? 1 : 0;
    });

    if (cms.isDebugCms?.()) console.debug('[cms] gate hydrated', { changed, source: cms.getCmsSource?.(), mode });
  } catch (error) {
    if (window.cmsContentLoader?.isDebugCms?.()) console.warn('[cms] gate hydration skipped', error);
  }
}

function buildTargetUrl(targetPage, roomId) {
  const url = new URL(targetPage, window.location.href);
  const params = new URLSearchParams(window.location.search || '');
  params.set('room', roomId);
  url.search = params.toString();
  return `${url.pathname.split('/').pop()}${url.search}`;
}

function createOption(room, mode, targetPage) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `room-gate__entrance room-gate__entrance--${room.id}`;
  button.dataset.room = room.id;
  button.dataset.roomNumber = room.id === 'outdoor' ? '01' : '02';

  const title = room.id === 'outdoor' ? 'Không gian ngoài trời' : 'Không gian trong nhà';
  const kicker = mode === 'editor'
    ? (room.id === 'outdoor' ? 'Khu vực ngoài trời' : 'Khu vực trong nhà')
    : (room.id === 'outdoor' ? 'Ngoài trời' : 'Trong nhà');
  const description = mode === 'editor'
    ? (room.id === 'outdoor'
      ? 'Cập nhật pano, cụm trưng bày và nội dung của khu vực ngoài trời.'
      : 'Cập nhật tác phẩm, tư liệu và thuyết minh của phòng trưng bày.')
    : (room.id === 'outdoor'
      ? 'Pano, cụm trưng bày và các điểm nội dung trong không gian mở.'
      : 'Tác phẩm, tư liệu và thuyết minh trong phòng trưng bày.');
  const cta = mode === 'editor' ? 'Chỉnh sửa →' : 'Tham quan →';
  const ctaText = cta.replace(/→/g, '').trim();

  button.innerHTML = `
    <span class="room-gate__entrance-index" aria-hidden="true">${button.dataset.roomNumber}</span>
    <span class="room-gate__entrance-copy">
      <small>${kicker}</small>
      <strong>${title}</strong>
      <span>${description}</span>
    </span>
    <span class="room-gate__cta"><span>${ctaText}</span><em aria-hidden="true">→</em></span>
  `;

  button.addEventListener('click', () => {
    window.location.href = buildTargetUrl(targetPage, room.id);
  });

  return button;
}

export function initPreEntryRoomGate(options = {}) {
  const mode = options.mode === 'editor' ? 'editor' : 'viewer';
  const targetPage = options.targetPage || (mode === 'editor' ? 'editor.html' : 'gallery.html');
  const state = getRoomGateState(window.location.search);

  ensureRoomGateStyle();
  document.body.classList.add('room-gate-active');

  const previous = document.getElementById('roomGate');
  if (previous) previous.remove();

  const gate = document.createElement('section');
  gate.id = 'roomGate';
  gate.className = 'room-gate';
  gate.setAttribute('aria-label', mode === 'editor' ? 'Chọn phòng cần chỉnh' : 'Chọn không gian tham quan');

  const title = mode === 'editor' ? 'Chọn phòng cần chỉnh' : 'Chọn không gian tham quan';
  const desc = mode === 'editor'
    ? 'Chọn đúng khu vực trước khi mở trình chỉnh sửa để tránh cập nhật nhầm nội dung giữa các phòng.'
    : 'Chọn một lối vào để bắt đầu hành trình trong không gian triển lãm 3D.';

  const warning = state.reason === 'invalid-room'
    ? `<div class="room-gate__warning">Phòng <b>${state.requestedRoomId}</b> không hợp lệ. Vui lòng chọn lại phòng cần ${mode === 'editor' ? 'chỉnh' : 'tham quan'}.</div>`
    : '';

  const shell = document.createElement('div');
  shell.className = `room-gate__stage room-gate__stage--${mode}`;
  shell.innerHTML = `
    <div class="room-gate__architecture" aria-hidden="true">
      <span></span><span></span><span></span><span></span>
    </div>
    <header class="room-gate__intro">
      <p class="room-gate__eyebrow">${mode === 'editor' ? 'Trình chỉnh nội dung' : 'Sảnh triển lãm số'}</p>
      <h1 class="room-gate__title">${title}</h1>
      <p class="room-gate__desc">${desc}</p>
      ${warning}
    </header>
    <div class="room-gate__options" id="roomGateOptions" aria-label="${mode === 'editor' ? 'Chọn phòng cần chỉnh' : 'Chọn không gian tham quan'}"></div>
    <footer class="room-gate__footer">
      <span>${mode === 'editor' ? 'Mỗi phòng dùng dữ liệu trưng bày riêng.' : 'Có thể quay lại sảnh này bất cứ lúc nào để đổi không gian.'}</span>
      <a class="room-gate__home" href="./index.html" aria-label="Quay về trang chủ">← Trang chủ</a>
    </footer>
  `;

  gate.appendChild(shell);
  document.body.appendChild(gate);

  const optionsWrap = shell.querySelector('#roomGateOptions');
  if (mode === 'editor') {
    optionsWrap.appendChild(createOption(CANONICAL_ROOMS.indoor, mode, targetPage));
    optionsWrap.appendChild(createOption(CANONICAL_ROOMS.outdoor, mode, targetPage));
  } else {
    optionsWrap.appendChild(createOption(CANONICAL_ROOMS.outdoor, mode, targetPage));
    optionsWrap.appendChild(createOption(CANONICAL_ROOMS.indoor, mode, targetPage));
  }

  hydrateRoomGateFromCms(gate, mode);
}
