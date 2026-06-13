// FEATURE V6.7 — Editor Multi-room Support
// Dùng lại room registry của viewer V6.6 nếu có, sau đó chuẩn hóa config riêng cho editor.
import '../viewer/config/roomRegistry.js';

const DEFAULT_ROOM_ID = 'indoor';

const FALLBACK_EDITOR_ROOM_REGISTRY = {
  indoor: {
    id: 'indoor',
    aliases: ['main', 'default'],
    label: 'Không gian triển lãm trong nhà',
    roomUrl: './assets/room_base.glb',
    sceneJsonUrl: './data/scene.json'
  },
  outdoor: {
    id: 'outdoor',
    aliases: ['outside', 'ngoai-troi', 'outdoor-gallery'],
    label: 'Không gian triển lãm ngoài trời',
    roomUrl: './assets/room_outdoor.glb',
    sceneJsonUrl: './data/scene_outdoor.json',
    optional: true
  }
};

function normalizeRoomId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
}

function getRequestedRoomId(globalObject) {
  try {
    const params = new URLSearchParams(globalObject.location?.search || '');
    return normalizeRoomId(params.get('room') || DEFAULT_ROOM_ID) || DEFAULT_ROOM_ID;
  } catch (error) {
    console.warn('[EditorRoom] Không đọc được query room, dùng indoor.', error);
    return DEFAULT_ROOM_ID;
  }
}

function getFileNameFromPath(path, fallback) {
  const value = String(path || '').split('?')[0].split('#')[0];
  const last = value.split('/').filter(Boolean).pop();
  return last || fallback;
}

function findRoomByIdOrAlias(registry, requestedId) {
  const normalized = normalizeRoomId(requestedId) || DEFAULT_ROOM_ID;
  if (registry[normalized]) return registry[normalized];

  return Object.values(registry).find((room) => {
    const aliases = Array.isArray(room.aliases) ? room.aliases : [];
    return aliases.some((alias) => normalizeRoomId(alias) === normalized);
  }) || null;
}

function resolveFromRegistry(globalObject, requestedRoomId) {
  if (typeof globalObject.resolveViewerRoomConfig === 'function') {
    const viewerRoom = globalObject.resolveViewerRoomConfig();
    if (viewerRoom && viewerRoom.id) return viewerRoom;
  }

  const registry = globalObject.VIEWER_ROOM_REGISTRY || FALLBACK_EDITOR_ROOM_REGISTRY;
  const room = findRoomByIdOrAlias(registry, requestedRoomId);

  if (room) {
    return {
      ...room,
      requestedRoomId,
      resolvedFromFallback: false
    };
  }

  console.warn(`[EditorRoom] Không tìm thấy room="${requestedRoomId}". Fallback về indoor.`);
  return {
    ...registry[DEFAULT_ROOM_ID],
    requestedRoomId,
    resolvedFromFallback: true,
    fallbackReason: 'unknown-room'
  };
}

export function resolveEditorRoomConfig(globalObject = window) {
  const requestedRoomId = getRequestedRoomId(globalObject);
  const resolved = resolveFromRegistry(globalObject, requestedRoomId);
  const sceneJsonUrl = resolved.sceneJsonUrl || resolved.sceneUrl || './data/scene.json';
  const isOutdoor = resolved.id === 'outdoor';

  const editorRoom = {
    id: resolved.id || DEFAULT_ROOM_ID,
    requestedRoomId: resolved.requestedRoomId || requestedRoomId,
    resolvedFromFallback: resolved.resolvedFromFallback === true,
    fallbackReason: resolved.fallbackReason || '',
    label: resolved.label || resolved.id || DEFAULT_ROOM_ID,
    roomUrl: resolved.roomUrl || './assets/room_base.glb',
    sceneJsonUrl,
    exportFileName: resolved.exportFileName || getFileNameFromPath(sceneJsonUrl, isOutdoor ? 'scene_outdoor.json' : 'scene.json'),
    allowMissingSceneJson: resolved.allowMissingSceneJson === true || isOutdoor || resolved.optional === true
  };

  globalObject.__currentEditorRoom = editorRoom;
  globalObject.currentEditorRoomId = editorRoom.id;
  globalObject.currentEditorRoomLabel = editorRoom.label;
  globalObject.currentSceneJsonUrl = editorRoom.sceneJsonUrl;
  globalObject.currentExportFileName = editorRoom.exportFileName;

  if (editorRoom.resolvedFromFallback) {
    console.warn(`[EditorRoom] Đang dùng phòng mặc định: ${editorRoom.label}. Query gốc: ${editorRoom.requestedRoomId}`);
  } else {
    console.info(`[EditorRoom] Đang chỉnh phòng: ${editorRoom.label} (${editorRoom.id}).`);
  }

  return editorRoom;
}
