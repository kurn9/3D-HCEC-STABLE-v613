// FEATURE V6.8 — Room Selector UI
// Shared UI-only room switcher for gallery.html and editor.html.
// It does not load GLB/JSON and does not mutate viewer/editor room loading logic.
(function initSharedRoomSwitcher(global) {
  const DEFAULT_ROOM_ID = 'indoor';

  const FALLBACK_ROOMS = {
    indoor: {
      id: 'indoor',
      aliases: ['main', 'default'],
      label: 'Không gian triển lãm trong nhà',
      sceneJsonUrl: './data/scene.json',
      exportFileName: 'scene.json'
    },
    outdoor: {
      id: 'outdoor',
      aliases: ['outside', 'ngoai-troi', 'outdoor-gallery'],
      label: 'Không gian triển lãm ngoài trời',
      sceneJsonUrl: './data/scene_outdoor.json',
      exportFileName: 'scene_outdoor.json',
      optional: true
    }
  };

  function normalizeRoomId(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-');
  }

  function getFileNameFromPath(path, fallback) {
    const value = String(path || '').split('?')[0].split('#')[0];
    const last = value.split('/').filter(Boolean).pop();
    return last || fallback;
  }

  function getRegistry() {
    const registry = global.__viewerRoomRegistry || global.VIEWER_ROOM_REGISTRY || global.ROOM_REGISTRY || FALLBACK_ROOMS;
    return registry && typeof registry === 'object' ? registry : FALLBACK_ROOMS;
  }

  function toRoomList(registry) {
    const seen = new Set();
    const rooms = Object.values(registry || {})
      .filter((room) => room && room.id)
      .map((room) => {
        const id = normalizeRoomId(room.id);
        const isOutdoor = id === 'outdoor';
        return {
          ...room,
          id,
          label: room.label || (isOutdoor ? FALLBACK_ROOMS.outdoor.label : FALLBACK_ROOMS.indoor.label),
          sceneJsonUrl: room.sceneJsonUrl || room.sceneUrl || (isOutdoor ? './data/scene_outdoor.json' : './data/scene.json'),
          exportFileName: room.exportFileName || getFileNameFromPath(room.sceneJsonUrl || room.sceneUrl, isOutdoor ? 'scene_outdoor.json' : 'scene.json'),
          aliases: Array.isArray(room.aliases) ? room.aliases : []
        };
      })
      .filter((room) => {
        if (seen.has(room.id)) return false;
        seen.add(room.id);
        return true;
      });

    if (!rooms.some((room) => room.id === 'indoor')) rooms.unshift(FALLBACK_ROOMS.indoor);
    if (!rooms.some((room) => room.id === 'outdoor')) rooms.push(FALLBACK_ROOMS.outdoor);

    return rooms.filter((room) => room.id === 'indoor' || room.id === 'outdoor' || room.showInRoomSwitcher === true);
  }

  function findRoom(rooms, requestedId) {
    const normalized = normalizeRoomId(requestedId) || DEFAULT_ROOM_ID;
    return rooms.find((room) => room.id === normalized)
      || rooms.find((room) => (room.aliases || []).some((alias) => normalizeRoomId(alias) === normalized))
      || rooms.find((room) => room.id === DEFAULT_ROOM_ID)
      || rooms[0];
  }

  function getRequestedRoomId() {
    try {
      const params = new URLSearchParams(global.location?.search || '');
      return normalizeRoomId(params.get('room') || DEFAULT_ROOM_ID) || DEFAULT_ROOM_ID;
    } catch (error) {
      console.warn('[RoomSwitcher] Không đọc được query room, dùng indoor.', error);
      return DEFAULT_ROOM_ID;
    }
  }

  function buildRoomUrl(targetPage, roomId) {
    const params = new URLSearchParams(global.location?.search || '');
    params.set('room', roomId);
    const query = params.toString();
    return `./${targetPage || 'gallery.html'}${query ? `?${query}` : ''}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function shortRoomLabel(room) {
    if (!room) return 'Trong nhà';
    if (room.id === 'outdoor') return 'Ngoài trời';
    if (room.id === 'indoor') return 'Trong nhà';
    return room.label || room.id;
  }

  function closeAllExcept(root) {
    document.querySelectorAll('.room-switcher.is-open').forEach((node) => {
      if (node !== root) {
        node.classList.remove('is-open');
        const button = node.querySelector('.room-switcher__button');
        if (button) button.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function renderRoomSwitcher(options) {
    const mount = typeof options.mount === 'string'
      ? document.querySelector(options.mount)
      : options.mount;

    if (!mount || mount.dataset.roomSwitcherReady === 'true') return null;

    const mode = options.mode === 'editor' ? 'editor' : 'viewer';
    const targetPage = options.targetPage || (mode === 'editor' ? 'editor.html' : 'gallery.html');
    const rooms = toRoomList(getRegistry());
    const requestedId = options.currentRoomId || getRequestedRoomId();
    const currentRoom = findRoom(rooms, requestedId) || rooms[0];
    const currentRoomId = currentRoom?.id || DEFAULT_ROOM_ID;
    const currentLabel = options.currentRoomLabel || currentRoom?.label || currentRoomId;
    const currentSceneJsonUrl = options.currentSceneJsonUrl || currentRoom?.sceneJsonUrl || '';
    const currentExportFileName = options.currentExportFileName || currentRoom?.exportFileName || getFileNameFromPath(currentSceneJsonUrl, currentRoomId === 'outdoor' ? 'scene_outdoor.json' : 'scene.json');
    const instanceId = `roomSwitcher_${mode}_${Math.random().toString(36).slice(2, 9)}`;

    const root = document.createElement('div');
    root.className = `room-switcher room-switcher--${mode}`;
    root.dataset.currentRoom = currentRoomId;

    const buttonLabel = mode === 'editor'
      ? `Phòng đang chỉnh: ${currentLabel}`
      : `Phòng: ${shortRoomLabel(currentRoom)}`;

    root.innerHTML = `
      <button class="room-switcher__button" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="${instanceId}_menu">
        <span class="room-switcher__eyebrow">${mode === 'editor' ? 'Phòng đang chỉnh' : 'Phòng tham quan'}</span>
        <span class="room-switcher__current">${escapeHtml(buttonLabel)}</span>
        <span class="room-switcher__chevron" aria-hidden="true">▾</span>
      </button>
      <div id="${instanceId}_menu" class="room-switcher__menu" role="menu" aria-label="Chọn phòng">
        ${rooms.map((room) => {
          const active = room.id === currentRoomId;
          const scene = room.sceneJsonUrl || '';
          const exportName = room.exportFileName || getFileNameFromPath(scene, room.id === 'outdoor' ? 'scene_outdoor.json' : 'scene.json');
          return `
            <button class="room-switcher__item${active ? ' is-active' : ''}" type="button" role="menuitemradio" aria-checked="${active ? 'true' : 'false'}" data-room-id="${escapeHtml(room.id)}">
              <span class="room-switcher__check" aria-hidden="true">${active ? '✓' : ''}</span>
              <span class="room-switcher__item-body">
                <strong>${escapeHtml(room.label || room.id)}</strong>
                ${mode === 'editor'
                  ? `<small>Dữ liệu: ${escapeHtml(scene || '—')} · Xuất: ${escapeHtml(exportName || '—')}</small>`
                  : `<small>${room.id === 'outdoor' ? 'Không gian ngoài trời' : 'Không gian trong nhà'}</small>`}
              </span>
            </button>`;
        }).join('')}
      </div>
      ${mode === 'editor' ? `
        <div class="room-switcher__meta" aria-live="polite">
          <span>Dữ liệu: <code>${escapeHtml(currentSceneJsonUrl || currentRoom?.sceneJsonUrl || '—')}</code></span>
          <span>Xuất: <code>${escapeHtml(currentExportFileName || '—')}</code></span>
        </div>` : ''}
    `;

    mount.replaceChildren(root);
    mount.dataset.roomSwitcherReady = 'true';

    const button = root.querySelector('.room-switcher__button');
    const menu = root.querySelector('.room-switcher__menu');

    button.addEventListener('click', (event) => {
      event.preventDefault();
      const willOpen = !root.classList.contains('is-open');
      closeAllExcept(root);
      root.classList.toggle('is-open', willOpen);
      button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    menu.addEventListener('click', (event) => {
      const item = event.target.closest('[data-room-id]');
      if (!item) return;
      const nextRoomId = item.dataset.roomId;
      if (!nextRoomId || nextRoomId === currentRoomId) {
        root.classList.remove('is-open');
        button.setAttribute('aria-expanded', 'false');
        return;
      }

      if (mode === 'editor') {
        const accepted = global.confirm('Bạn đang chuyển sang phòng khác. Nếu chưa xuất JSON, thay đổi hiện tại có thể chưa được lưu. Tiếp tục?');
        if (!accepted) return;
      }

      global.location.href = buildRoomUrl(targetPage, nextRoomId);
    });

    document.addEventListener('click', (event) => {
      if (!root.contains(event.target)) {
        root.classList.remove('is-open');
        button.setAttribute('aria-expanded', 'false');
      }
    }, { capture: true });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && root.classList.contains('is-open')) {
        root.classList.remove('is-open');
        button.setAttribute('aria-expanded', 'false');
        button.focus();
      }
    });

    return root;
  }

  function initRoomSwitcher(options = {}) {
    return renderRoomSwitcher(options);
  }

  function autoInitRoomSwitchers() {
    const viewerMount = document.getElementById('viewerRoomSwitcherMount');
    if (viewerMount) {
      const room = global.__currentViewerRoom || null;
      initRoomSwitcher({
        mode: 'viewer',
        mount: viewerMount,
        currentRoomId: global.CONFIG?.currentRoomId || room?.id || getRequestedRoomId(),
        currentRoomLabel: global.CONFIG?.currentRoomLabel || room?.label || '',
        currentSceneJsonUrl: global.CONFIG?.sceneJsonUrl || room?.sceneJsonUrl || '',
        targetPage: 'gallery.html'
      });
    }

    const editorMount = document.getElementById('editorRoomSwitcherMount');
    if (editorMount && !editorMount.dataset.roomSwitcherReady) {
      const room = global.__currentEditorRoom || null;
      initRoomSwitcher({
        mode: 'editor',
        mount: editorMount,
        currentRoomId: global.currentEditorRoomId || room?.id || getRequestedRoomId(),
        currentRoomLabel: global.currentEditorRoomLabel || room?.label || '',
        currentSceneJsonUrl: global.currentSceneJsonUrl || room?.sceneJsonUrl || '',
        currentExportFileName: global.currentExportFileName || room?.exportFileName || '',
        targetPage: 'editor.html'
      });
    }
  }

  global.initRoomSwitcher = initRoomSwitcher;
  global.__roomSwitcherHelpers = {
    buildRoomUrl,
    normalizeRoomId,
    getRegistry,
    toRoomList
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInitRoomSwitchers, { once: true });
  } else {
    autoInitRoomSwitchers();
  }
})(window);

export const initRoomSwitcher = window.initRoomSwitcher;
