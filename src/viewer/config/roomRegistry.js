// FEATURE V6.6 — Multi-room Gallery Support
// Cơ chế registry phòng bằng query URL, không đổi path phòng hiện tại.
(function initViewerRoomRegistry(global) {
  const DEFAULT_ROOM_ID = 'indoor';

  const ROOM_REGISTRY = {
    indoor: {
      id: 'indoor',
      aliases: ['main', 'default'],
      label: 'Không gian triển lãm trong nhà',
      roomUrl: 'https://pub-d00970587980484399ff842b58cd1e9e.r2.dev/room_base.glb',
      sceneJsonUrl: './data/scene.json',
      wallVideoUrl: 'https://pub-d00970587980484399ff842b58cd1e9e.r2.dev/intro.mp4',
      wallVideoEnabled: false,
      maxPixelRatio: 1.5,
      sceneVideoPreviewConcurrency: 1,
      sceneVideoAutoplayMax: 2,
      roomAnimations: { enabled: true, autoplay: true, playAll: true, fullExperience: true, maxClips: 'all', timeScale: 1, startDelayMs: 1200 },
      roomAnimationFullExperience: true,
      roomAnimationSkipOnFrameBudget: false,
      roomAnimationUpdateEveryFrame: true,
      roomAnimationUseRawDelta: true,
      roomAnimationMaxDelta: 0.05,
      roomAnimationUpdateMs: 0,

      indoorMaterialLift: {
        enabled: true,
        roomIds: ['indoor'],
        targetObjectName: 'ROOM_EXT',
        cloneMaterial: true,
        colorLift: 0.16,
        maxMetalness: 0.18,
        roughnessMin: 0.48,
        roughnessMax: 0.78,
        envMapIntensity: 0.58,
        emissiveColor: 0x111111,
        emissiveIntensity: 0.045,
        excludeNamePattern: '(neon|emissive|glow|hologram|light|screen|video|poster|art|logo|avatar|glass)',
        debugMaxItems: 18
      },
      lightingProfile: {
        rendererExposure: 1.18,
        hemisphereSkyColor: 0xffffff,
        hemisphereGroundColor: 0x596474,
        hemisphereIntensity: 1.36,
        ambientColor: 0xffffff,
        ambientIntensity: 0.18,
        keyLightColor: 0xffffff,
        keyLightIntensity: 1.50,
        keyLightPosition: [5.5, 9.0, 4.5],
        fillLightColor: 0xd7e8ff,
        fillLightIntensity: 0.46,
        fillLightPosition: [-5.5, 5.8, -4.2],
        indoorFillColor: 0xffefd0,
        indoorFillIntensity: 0.18,
        indoorFillPosition: [0, 4.0, 2.6],
        localFills: [
          {
            type: 'point',
            name: 'indoor-bounds-interior-fill-main',
            mode: 'boundsRelative',
            color: 0xfff1d8,
            intensity: 1.15,
            distance: 22,
            decay: 1.45,
            positionRatio: [0.50, 0.58, 0.34],
            fallbackPosition: [0, 3.2, -7.5]
          },
          {
            type: 'spot',
            name: 'indoor-bounds-corridor-soft-fill',
            mode: 'boundsRelative',
            color: 0xe9f4ff,
            intensity: 1.05,
            distance: 26,
            decay: 1.35,
            angle: 0.72,
            penumbra: 0.72,
            positionRatio: [0.50, 0.72, 0.18],
            targetRatio: [0.50, 0.34, 0.48],
            fallbackPosition: [0, 4.6, -5.5],
            fallbackTarget: [0, 1.8, -11.0]
          }
        ],
        localFillBoundsPadding: 0.08,
        materialDebugMaxItems: 26,
        materialDebugRiskKeywords: ['wall', 'floor', 'ceiling', 'corridor', 'room', 'interior', 'panel', 'black', 'dark', 'metal', 'plaster', 'tunnel'],
        materialLift: {
          enabled: false,
          roomIds: ['indoor'],
          meshKeywords: [],
          materialKeywords: [],
          maxMetalness: 0.35,
          minRoughness: 0.62,
          minEnvMapIntensity: 0.18
        },
        debugLightProfile: false,
        debugMaterialProfile: false
      },
      artworkProbeInterval: 0.105
    },

    // Khai báo sẵn để test bằng gallery.html?room=outdoor.
    // Không tạo asset mới; khi có file thật chỉ cần đặt đúng path bên dưới.
    outdoor: {
      id: 'outdoor',
      aliases: ['outside', 'ngoai-troi', 'outdoor-gallery'],
      label: 'Không gian triển lãm ngoài trời',
      roomUrl: 'https://pub-d00970587980484399ff842b58cd1e9e.r2.dev/room_outdoor.glb',
      sceneJsonUrl: './data/scene_outdoor.json',
      wallVideoUrl: 'https://pub-d00970587980484399ff842b58cd1e9e.r2.dev/intro.mp4',
      wallVideoEnabled: false,
      maxPixelRatio: 1.0,
      maxFrameDelta: 0.033,
      roomAnimations: { enabled: true, autoplay: true, playAll: true, fullExperience: true, maxClips: 'all', timeScale: 1, startDelayMs: 1800 },
      roomAnimationFullExperience: true,
      roomAnimationSkipOnFrameBudget: false,
      roomAnimationUpdateEveryFrame: true,
      roomAnimationUseRawDelta: true,
      roomAnimationMaxDelta: 0.05,
      roomAnimationOutdoorUpdateMs: 0,
      artworkProbeOutdoorInterval: 0.16,
      sceneVideoPreviewConcurrency: 1,
      sceneVideoAutoplayMax: 1,
      sceneVideoAutoplayMaxDistance: 14,
      sceneVideoAutoplayRequireView: true,
      indoorMaterialLift: { enabled: false, roomIds: ['indoor'], targetObjectName: 'ROOM_EXT' },
      lightingProfile: {
        rendererExposure: 1.03,
        hemisphereSkyColor: 0xffffff,
        hemisphereGroundColor: 0x536070,
        hemisphereIntensity: 1.12,
        ambientColor: 0xffffff,
        ambientIntensity: 0.10,
        keyLightColor: 0xffffff,
        keyLightIntensity: 1.45,
        keyLightPosition: [7, 10, 4.5],
        fillLightColor: 0xc9e4ff,
        fillLightIntensity: 0.34,
        fillLightPosition: [-7, 5.4, -5.5],
        indoorFillColor: 0xffffff,
        indoorFillIntensity: 0.0,
        indoorFillPosition: [0, 4.0, 2.5],
        localFills: [],
        debugLightProfile: false
      },
      optional: true
    }
  };

  const SAFE_ROOM_CONFIG_KEYS = [
    'roomUrl',
    'sceneJsonUrl',
    'wallVideoUrl',
    'wallVideoEnabled',
    'wallVideoPosition',
    'wallVideoRotation',
    'wallVideoSize',
    'maxPixelRatio',
    'videoFirstFramePreviewEnabled',
    'videoFirstFrameSeekTime',
    'videoFirstFrameTimeoutMs',
    'videoFirstFrameCanvasWidth',
    'videoFirstFrameCanvasHeight',
    'videoFirstFramePreload',
    'sceneVideoPreviewEnabled',
    'sceneVideoPreviewConcurrency',
    'sceneVideoPreviewTimeoutMs',
    'sceneVideoPreviewSeekRatio',
    'sceneVideoPreviewSeekMin',
    'sceneVideoPreviewSeekMax',
    'sceneVideoAutoplayMax',
    'sceneVideoAutoplayMaxDistance',
    'sceneVideoAutoplayRequireView',
    'maxFrameDelta',
    'frameSpikeDelta',
    'frameSpikeCooldownMs',
    'roomAnimations',
    'lightingProfile',
    'indoorMaterialLift',
    'roomAnimationStartDelayMs',
    'roomAnimationFullExperience',
    'roomAnimationSkipOnFrameBudget',
    'roomAnimationUpdateEveryFrame',
    'roomAnimationUseRawDelta',
    'roomAnimationMaxDelta',
    'roomAnimationUpdateMs',
    'roomAnimationOutdoorUpdateMs',
    'artworkProbeInterval',
    'artworkProbeOutdoorInterval'
  ];

  function normalizeRoomId(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-');
  }

  function getRequestedRoomId() {
    try {
      const params = new URLSearchParams(global.location?.search || '');
      return normalizeRoomId(params.get('room') || DEFAULT_ROOM_ID) || DEFAULT_ROOM_ID;
    } catch (error) {
      console.warn('[RoomRegistry] Không đọc được query room, dùng phòng mặc định.', error);
      return DEFAULT_ROOM_ID;
    }
  }

  function findRoomByIdOrAlias(requestedId) {
    const normalized = normalizeRoomId(requestedId) || DEFAULT_ROOM_ID;
    if (ROOM_REGISTRY[normalized]) return ROOM_REGISTRY[normalized];

    const rooms = Object.values(ROOM_REGISTRY);
    return rooms.find((room) => {
      const aliases = Array.isArray(room.aliases) ? room.aliases : [];
      return aliases.some((alias) => normalizeRoomId(alias) === normalized);
    }) || null;
  }

  function resolveCurrentRoom() {
    const requestedRoomId = getRequestedRoomId();
    const room = findRoomByIdOrAlias(requestedRoomId);

    if (room) {
      return {
        ...room,
        requestedRoomId,
        resolvedFromFallback: false
      };
    }

    const fallback = ROOM_REGISTRY[DEFAULT_ROOM_ID];
    console.warn(`[RoomRegistry] Không tìm thấy room="${requestedRoomId}". Fallback về "${DEFAULT_ROOM_ID}".`);
    return {
      ...fallback,
      requestedRoomId,
      resolvedFromFallback: true,
      fallbackReason: 'unknown-room'
    };
  }

  function applyRoomConfigToViewerConfig(config) {
    if (!config || typeof config !== 'object') return config;

    const room = resolveCurrentRoom();
    SAFE_ROOM_CONFIG_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(room, key)) {
        config[key] = room[key];
      }
    });

    config.currentRoomId = room.id;
    config.currentRoomLabel = room.label || room.id;
    config.requestedRoomId = room.requestedRoomId;
    config.roomResolvedFromFallback = room.resolvedFromFallback === true;
    config.roomRegistry = ROOM_REGISTRY;

    global.__currentViewerRoom = room;
    global.__viewerRoomRegistry = ROOM_REGISTRY;

    const label = config.currentRoomLabel || config.currentRoomId;
    if (room.resolvedFromFallback) {
      console.warn(`[RoomRegistry] Đang dùng phòng mặc định: ${label}. Query gốc: ${room.requestedRoomId}`);
    } else {
      console.info(`[RoomRegistry] Đang tải phòng: ${label} (${room.id}).`);
    }

    return config;
  }

  global.VIEWER_ROOM_REGISTRY = ROOM_REGISTRY;
  global.resolveViewerRoomConfig = resolveCurrentRoom;
  global.applyRoomConfigToViewerConfig = applyRoomConfigToViewerConfig;
})(window);
