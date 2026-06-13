const CONFIG = {
  roomUrl: 'https://pub-d00970587980484399ff842b58cd1e9e.r2.dev/room_base.glb',
  sceneJsonUrl: './data/scene.json',
  eyeHeight: 1.7,
  walkSpeed: 2.05,
  runSpeed: 4.05,
  lookSensitivity: 0.00165,
  maxLookDelta: 28,
  lookDamping: 22,
  // K_O_G_C_D — mobile/touch-only look: faster response; desktop mouse keeps lookSensitivity.
  touchLookSensitivity: 0.0039,
  maxStepUp: 0.46,
  maxStepDown: 0.82,
  wallDistance: 0.62,
  frameBorder: 0.045,
  frameDepth: 0.035,
  frameColor: 0x14110d,
  selectLift: 0.075,
  hoverScale: 0.035,
  outlineOpacity: 1.0,
  outlineSoftOpacity: 0.32,
  outlineThickness: 0.010,
  outlinePadding: 0.035,
  outlineSoftPadding: 0.065,
  outlinePulseSpeed: 0.0038,
  useFallbackFloorWhenNoWalkable: true,
  maxPixelRatio: 1.5,


  // CMS Content Layer V6.11.21-B6-F_K_O_I_B — read Supabase published JSON first, keep local/legacy fallback.
  // CMS may override content/media only; scene JSON remains the protected 3D layout source.
  cmsContent: {
    enabled: true,
    remoteEnabled: true,
    remoteUrl: 'https://ocmidhgabyrvqbvqgorw.supabase.co/storage/v1/object/public/cms-public/published/cms_public_content.json',
    fallbackUrl: './data/cms_content_fallback.json',
    timeoutMs: 1200,
    galleryTimeoutMs: 1600,
    debug: false,
    debugMerge: false,
    allowCmsMediaOverride: true,
    allowCmsTextOverride: true,
    protectSceneLayout: true,
    allowRemoteMedia: true,
    allowedMediaOrigins: [
      'https://ocmidhgabyrvqbvqgorw.supabase.co',
      'https://pub-d00970587980484399ff842b58cd1e9e.r2.dev'
    ],
    allowedMediaHosts: [
      'ocmidhgabyrvqbvqgorw.supabase.co',
      'pub-d00970587980484399ff842b58cd1e9e.r2.dev'
    ],
    allowedMediaPathPrefixes: [
      '/storage/v1/object/public/',
      '/'
    ]
  },

  // V6.12-C4 — optional published scene loader. Default OFF; static scene JSON remains source of truth.
  publishedScene: {
  enabled: true,
  baseUrl: 'https://ocmidhgabyrvqbvqgorw.supabase.co',
  bucket: 'cms-public',
  manifestPathPattern: 'published/scenes/{room}/manifest.json',
  timeoutMs: 1600,
  manifestCache: 'no-store',
  versionCache: 'default',
  debug: false
  },

  // HOTFIX V6.11.14 — room-aware lighting with optional local fills.
  // Không sửa GLB/assets; không tăng sáng global bừa bãi. Local fill chỉ bật theo room profile.
  debugLightingProfile: false,
  debugRoomModel: false,
  debugMaterialProfile: false,
  debugLightingQueryParam: 'debugLighting',
  debugRoomQueryParam: 'debugRoom',
  debugMaterialQueryParam: 'debugMaterial',

  // V6.11.16 — controlled material lift for the indoor ROOM_EXT subtree only.
  // This intentionally avoids global exposure/ambient increases and does not mutate assets/GLB.
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
  avatarHairVisibilityDebug: false,
  debugAvatarQueryParam: 'debugAvatar',
  lightingProfile: {
    rendererExposure: 1.08,
    hemisphereSkyColor: 0xffffff,
    hemisphereGroundColor: 0x40495a,
    hemisphereIntensity: 1.20,
    ambientColor: 0xffffff,
    ambientIntensity: 0.16,
    keyLightColor: 0xffffff,
    keyLightIntensity: 1.62,
    keyLightPosition: [6, 10, 5],
    fillLightColor: 0xbfd9ff,
    fillLightIntensity: 0.56,
    fillLightPosition: [-6, 6, -5],
    indoorFillColor: 0xfff2d4,
    indoorFillIntensity: 0.0,
    indoorFillPosition: [0, 4.2, 2.8],
    localFills: [],
    localFillBoundsPadding: 0.06,
    materialDebugMaxItems: 24,
    materialDebugRiskKeywords: ['wall', 'floor', 'ceiling', 'corridor', 'room', 'interior', 'panel', 'black', 'dark', 'metal', 'plaster'],
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

  // HOTFIX/FEATURE V6.11.1 — controlled scene video behavior.
  // K_O_G_B — runtime first-frame preview for scene/CMS video artwork, no manual poster file.
  videoFirstFramePreviewEnabled: true,
  videoFirstFrameSeekTime: 0.05,
  videoFirstFrameTimeoutMs: 4500,
  videoFirstFrameCanvasWidth: 1024,
  videoFirstFrameCanvasHeight: 576,
  videoFirstFramePreload: 'metadata',
  sceneVideoPreviewEnabled: true,
  sceneVideoPreviewConcurrency: 1,
  sceneVideoPreviewTimeoutMs: 4500,
  sceneVideoPreviewPreload: 'metadata',
  sceneVideoPreviewDebug: false,
  sceneVideoPreviewSeekRatio: 0.03,
  sceneVideoPreviewSeekMin: 0.08,
  sceneVideoPreviewSeekMax: 0.35,
  sceneVideoPreviewDeferOnSpike: true,

  // v6.13.011 — desktop-only Surface Preview V2.
  // Background preflight never calls the baseline surface attach path and never
  // replaces the current poster/first-frame until a decoded frame is ready.
  sceneVideoPreviewV2Enabled: true,
  sceneVideoPreviewV2DesktopOnly: true,
  sceneVideoPreviewV2DwellMs: 650,
  sceneVideoPreviewV2ExitCooldownMs: 350,
  sceneVideoPreviewV2PrepareTimeoutMs: 3500,
  sceneVideoPreviewV2Debug: false,
  sceneVideoPreviewV2MaxPreparing: 1,

  sceneVideoAutoplayAfterDelay: true,
  sceneVideoAutoplayDelayMs: 15000,
  sceneVideoAutoplayMax: 2,
  sceneVideoAutoplayMaxDistance: 18,
  sceneVideoAutoplayRequireView: true,
  sceneVideoPauseWhenFar: true,
  // K_O_F_E_B — safe video-surface readiness. Do not swap to VideoTexture before first frame.
  sceneVideoAttachAfterFirstFrame: true,
  sceneVideoRestorePlaceholderOnError: true,
  sceneVideoSurfacePreload: 'metadata',
  sceneVideoAttachTimeoutMs: 6500,
  sceneVideoSurfaceLoadingText: 'Đang chuẩn bị video',
  sceneVideoSurfaceLoadingHint: 'Nếu trình duyệt chặn, chạm lại để phát',
  sceneVideoPlaceholderText: 'Chạm để phát video',
  sceneVideoPlaceholderHint: 'Chạm đúp để xem lớn',
  sceneVideoCinemaLoadingText: 'Đang chuẩn bị video…',
  sceneVideoCinemaPolicyText: 'Nếu video chưa tự phát, hãy bấm Play trên thanh điều khiển.',
  sceneVideoCinemaErrorText: 'Video chưa phát được trên thiết bị này. Vui lòng thử lại hoặc xem trên Chrome/Edge.',
  sceneVideoCinemaFallbackTimeoutMs: 6500,

  // Viewer interaction raycast distances
  artworkCenterRaycastFar: 40,
  artworkMouseRaycastFar: 40,
  // K_O_G_C_C — tiny center multi-probe helps outdoor aim reliability near surface edges.
  artworkCenterProbeNdcRadius: 0.018,

  // Viewer UX Control Layer V3.2.2
  miniMapPadding: 18,
  miniMapPositionSmooth: 24,
  miniMapYawSmooth: 32,
  miniMapMaxDelta: 0.04,
  miniMapMinAlpha: 0.18,
  miniMapUpdateMs: 240,
  miniMapOutdoorUpdateMs: 520,
  miniMapTurningUpdateMs: 620,
  miniMapLowFpsUpdateMs: 720,
  ambientAudioUrl: 'https://pub-d00970587980484399ff842b58cd1e9e.r2.dev/ambient.mp3',
  ambientAudioVolume: 0.18,
  ambientAudioAutoStartAfterGesture: true,
  ambientAudioAutoStartOnMovement: true,
  ambientAudioDoNotRestartAfterManualMute: true,
  ambientAudioPauseDuringVideoCinema: true,
  ambientAudioMediaDuckingVolume: 0.05,

  // Viewer Wall Video Panel V5.2
  wallVideoEnabled: false,
  wallVideoUrl: 'https://pub-d00970587980484399ff842b58cd1e9e.r2.dev/intro.mp4',
  wallVideoAutoplay: true,
  wallVideoMuted: true,
  wallVideoLoop: true,
  wallVideoSize: [4.2, 2.37],
  wallVideoPosition: [10.22, 0.6, -0.04],
  wallVideoRotation: [0, 1.5708, 0],
  wallVideoWallOffset: 0.04,
  wallVideoFrameColor: 0x111111,
  wallVideoFramePadding: 0.08,
  wallVideoFrameDepth: 0.025,
  wallVideoEmissiveBoost: 0.65,
  wallVideoShowStatusOnError: false,
  wallVideoCinemaTitle: 'Video giới thiệu',
  wallVideoCinemaAutoplay: true,
  wallVideoCinemaMuted: false,
  wallVideoCinemaVolume: 0.85,
  wallVideoCinemaResetOnClose: true,
  wallVideoLoadTimeoutMs: 10000,
  wallVideoAutoplayDelayMs: 700,

  // Viewer Performance V6.11.8 — measured debug/tuning. Default off; enable with ?debugPerf=1.
  enableLazyLightboxImage: true,
  showFpsMonitor: false,
  fpsMonitorSampleMs: 1000,
  debugPerformance: false,
  debugPerformanceQueryParam: 'debugPerf',
  performanceLogToConsole: false,
  // K_O_G_C_C — mobile/outdoor should keep focus probes alive around 30fps.
  performanceLowFpsThreshold: 28,
  performanceCriticalFpsThreshold: 20,
  performanceSpikeFrameMs: 42,
  performanceRecoverMs: 420,
  performanceOverlayRenderInfo: true,
  outdoorPerformanceLog: false,

  // HOTFIX V6.11.18 — Mobile WebGL quality profiles.
  // Giảm tải GPU/CPU trên Android/iOS; desktop giữ profile hiện tại.
  mobileQualityProfiles: {
    low: {
      maxDpr: 1.0,
      antialias: false,
      shadows: false,
      minimapFps: 4,
      raycastFps: 6,
      artworkProbeFps: 4,
      videoPreview: 'lazy',
      videoAutoplayMax: 0,
      avatarModelDeferredLoadMs: 20000,
      animationBudget: 'reduced',
      artworkBatchSize: 2,
      artworkBatchDelayMs: 360
    },
    mid: {
      maxDpr: 1.0,
      antialias: false,
      shadows: false,
      minimapFps: 6,
      raycastFps: 8,
      artworkProbeFps: 6,
      videoPreview: 'lazy',
      videoAutoplayMax: 1,
      avatarModelDeferredLoadMs: 12000,
      animationBudget: 'normal',
      artworkBatchSize: 3,
      artworkBatchDelayMs: 260
    },
    high: {
      maxDpr: 1.25,
      antialias: false,
      shadows: false,
      minimapFps: 8,
      raycastFps: 10,
      artworkProbeFps: 8,
      videoPreview: 'lazy',
      videoAutoplayMax: 1,
      avatarModelDeferredLoadMs: 8000,
      animationBudget: 'normal',
      artworkBatchSize: 4,
      artworkBatchDelayMs: 220
    }
  },
  adaptiveQuality: {
    enabled: true,
    minFpsTarget: 30,
    degradeBelowFps: 28,
    recoverAboveFps: 45,
    sampleWindowMs: 4000,
    recoverWindowMs: 12000,
    minDegradeIntervalMs: 8000,
    maxAdaptiveLevel: 2,
    dprStep: 0.25,
    minDpr: 0.75
  },

  // Viewer/Intro V6.4 — mobile & tablet runtime configuration.
  mobile: {
    enabled: true,
    maxPixelRatio: 1.0,
    tabletMaxPixelRatio: 1.25,
    showRotateOverlay: true,
    touchControls: true,
    defaultMiniMapCollapsed: true,
    // K_O_G_C_D — effective touch sensitivity ≈ 0.0039 × 1.22 = 0.00476 rad/px.
    // Slightly quicker mobile look response without changing desktop mouse/WASD.
    touchLookSensitivityMultiplier: 1.22,
    touchLookImmediateSyncRatio: 0.22,
    // K_O_E_C_B — allow light mobile taps on focused artwork without stealing real camera swipes.
    touchTapMoveLimit: 15,
    touchTapTimeLimit: 500,
    // K_O_D_B — mobile joystick smoothing. Desktop keyboard/WASD is unchanged.
    joystickMaxRadius: 48,
    joystickDeadzone: 0.13,
    joystickReleaseDeadzone: 0.09,
    joystickAnalogMovement: true,
    joystickStrengthCurve: 0.82,
    mobileMoveSpeedMultiplier: 1.0,
    portraitFallback: true,
    statusAutoHideMs: 3200,

    // HOTFIX V6.5 — Mobile Gallery Fast First Load.
    // Mobile/tablet only: cho người xem vào phòng trước, tải asset nặng nền sau.
    fastFirstLoad: true,
    fastLoadInitialPixelRatio: 1.0,
    fastLoadUpgradePixelRatioAfterMs: 45000,
    fastLoadUpgradePixelRatio: 1.0,
    deferWallVideoOnMobile: true,
    wallVideoDeferredLoadMs: 30000,
    deferAvatarModelOnMobile: true,
    avatarModelDeferredLoadMs: 10000,
    progressiveArtworkLoading: true,
    artworkInitialBatchSize: 8,
    artworkBatchSize: 3,
    artworkBatchDelayMs: 220
  },




  // Avatar Optimization V5.0 — grounding / stair / seat safety
  debugAvatar: false,
  avatarFootGroundOffset: 0.0,
  avatarGroundVisualOffset: 0.025,
  avatarGroundSnapOnSpawn: true,
  avatarGroundSnapMaxDelta: 0.9,
  avatarGroundSnapEpsilon: 0.001,
  avatarGroundingApplyToModelPivot: true,
  avatarGroundingMaxPivotAdjust: 0.38,
  stairProbeMultiplier: 2.25,
  stairSideProbeScale: 0.72,
  stairIgnoreColliderKeywords: ['stair', 'stairs', 'step', 'steps', 'ramp', 'walk', 'walkable', 'navmesh'],
  avatarSeatMaxDepthInset: 0.28,
  avatarSeatMinDepthInset: 0.075,
  avatarSeatSideClampMargin: 0.12,
  seatOverrides: {},

  // Avatar / third-person camera
  avatarEnabled: true,
  avatarHeight: 1.68,
  avatarRadius: 0.22,

  // External GLB avatar
  // Đặt file tại: assets/avatar/visitor.glb
  useExternalAvatarModel: true,
  avatarModelUrl: 'https://pub-d00970587980484399ff842b58cd1e9e.r2.dev/visitor.glb',
  avatarModelHeight: 1.68,
  avatarModelYawOffset: 0,
  avatarModelYOffset: 0,
  avatarModelSitYOffset: 0.0,

  // V24: chế độ an toàn cho avatar GLB export từ Blender.
  // false = không tự scale/center model, tránh trường hợp bounding box của Armature sai làm avatar biến mất.
  avatarAutoNormalize: false,
  avatarModelManualScale: 0.90,
  avatarDebugKeepFallback: false,

  // HOTFIX V6.3.7 — runtime avatar material tuning only.
  // Không sửa GLB, không đổi texture; chỉ giảm độ phản chiếu của material avatar sau khi load.
  avatarMaterialTuning: {
    enabled: true,
    maxMetalness: 0.08,
    minRoughness: 0.72,
    maxEnvMapIntensity: 0.35
  },

  // Blender GLB safety
  // true = không tự chạy clip tên lạ như "Action" để tránh root motion làm avatar biến mất.
  avatarOnlyUseNamedAnimations: true,

  // V26: Tắt animation đi/chạy mặc định để tránh root-motion của GLB Blender làm avatar xuyên vật thể.
  // Khi có animation in-place chuẩn, đổi thành true.
  avatarUseLocomotionAnimations: true,
  avatarUseSitAnimation: true,
  avatarStripRootMotion: true,
  avatarWalkTimeScale: 0.98,
  avatarRunTimeScale: 1.12,
  avatarAnimationFadeTime: 0.38,
  // H_D_C — avatar runtime motion state machine only. Không sửa GLB/texture/material.
  avatarUseSitTransitions: true,
  avatarDisabledActions: ['jump'],
  avatarLocomotionFadeTime: 0.26,
  avatarSitTransitionFadeTime: 0.24,
  avatarSitTransitionFallbackMs: 2600,
  avatarSitTransitionTimeoutPaddingMs: 220,
  avatarWalkStartThreshold: 0.026,
  avatarWalkStopThreshold: 0.010,
  thirdPersonDistance: 2.85,
  thirdPersonHeight: 1.72,
  thirdPersonLookAtHeight: 1.42,
  thirdPersonAimDistance: 5.2,
  // Camera Optimization V5.1 — balanced gallery camera
  // Default near-center camera is better for gallery browsing than a strong over-the-shoulder view.
  cameraShoulderMode: 'center',
  cameraShoulderOffsets: {
    center: 0,
    right: 0.65,
    left: -0.65
  },
  cameraShoulderModeOrder: ['center', 'right', 'left'],
  cameraShoulderModeLabels: {
    center: 'chính giữa',
    right: 'vai phải',
    left: 'vai trái'
  },
  thirdPersonShoulderOffset: 0,
  sitCameraShoulderOffset: 0,
  cameraFollowSmooth: 8.2,
  cameraWallPadding: 0.28,

  // Collision fallback nếu Blender chưa có object tên COLLIDER
  avatarCollisionRadius: 0.31,
  collisionRayHeights: [0.25, 0.55, 1.05, 1.55],
  bodyCollisionHeight: 1.55,

  // Seat interaction
  sitDistance: 1.05,
  sitHeightOffset: 0.0,
  sitCameraDistance: 2.35,
  sitCameraHeight: 1.28,

  // Smooth movement
  avatarTurnSmooth: 9.6,
  groundFollowSmooth: 16,

  // Sitting placement
  sitFrontInset: 0.02,
  standUpDistance: 0.95,
  standUpSearchRadius: 1.15,

  // Stair / step assist
  stairAssistDistance: 0.38,
  stairAssistMaxUp: 0.54,
  stairSnapThreshold: 0.30,

  // Manual collider tuning
  colliderPadding: 0.012,
  wallColliderPadding: 0.06,

  // Movement smoothing
  moveAcceleration: 12.0,
  moveDamping: 12.5,
  runAcceleration: 12.0,
  maxFrameDelta: 0.033,

  // V25: chống xuyên vật thể bằng cách chia nhỏ bước di chuyển
  collisionSubstepDistance: 0.045,
  collisionMaxSubsteps: 3,

  // HOTFIX V6.11.3 — room GLB embedded animation pass
  roomAnimations: {
    enabled: true,
    autoplay: true,
    playAll: true,
    fullExperience: true,
    maxClips: 'all',
    timeScale: 1,
    startDelayMs: 1200
  },
  // K_O_H_D_B — full room animation experience: no clip cap and no frame-budget throttle by default.
  roomAnimationStartDelayMs: 1200,
  roomAnimationFullExperience: true,
  roomAnimationSkipOnFrameBudget: false,
  roomAnimationUpdateEveryFrame: true,
  roomAnimationUseRawDelta: true,
  roomAnimationMaxDelta: 0.05,
  roomAnimationUpdateMs: 0,
  roomAnimationOutdoorUpdateMs: 0,

  // HOTFIX V6.11.4 — frame budget smoothing for non-essential tasks
  frameSpikeDelta: 0.040,
  frameSpikeCooldownMs: 360,
  // K_O_G_C_C — 22ms suppressed focus probes too aggressively on outdoor mobile.
  lowFpsFrameBudgetMs: 36,
  cameraFastTurnThreshold: 16,
  suppressHoverWhileTurningMs: 240,
  suppressAuxiliaryOnSpike: true,
  suppressAuxiliaryWhenLowFps: true,
  // K_O_G_C_C — keep focus deterministic in outdoor without waiting seconds between probes.
  artworkProbeTurningIntervalMultiplier: 1.55,
  artworkProbeLowFpsMultiplier: 1.55,
  outdoorPerformanceBias: 1.0,
  // K_O_F_C/G_C_C — stale timeout must exceed outdoor probe cadence but remain bounded.
  artworkFocusStaleClearMs: 680,
  artworkTapFallbackMs: 180,

  // HOTFIX V6.11.3 — interaction throttling
  artworkProbeInterval: 0.14,
  artworkProbeOutdoorInterval: 0.16,

  // V25: tinh chỉnh riêng cho avatar GLB khi ngồi
  avatarSitFootDrop: 0.0,
  avatarSeatDepthOffset: -0.02,
  avatarSeatFrontInset: 0.12,
  avatarSeatHeightOffset: 0.060,
};

// FEATURE V6.6 — Multi-room Gallery Support.
// Room config chỉ override những path/cấu hình phòng an toàn; desktop/mobile behavior khác giữ nguyên.
if (typeof window !== 'undefined' && typeof window.applyRoomConfigToViewerConfig === 'function') {
  window.applyRoomConfigToViewerConfig(CONFIG);
} else if (typeof window !== 'undefined') {
  window.__currentViewerRoom = {
    id: 'indoor',
    label: 'Không gian triển lãm trong nhà',
    roomUrl: CONFIG.roomUrl,
    sceneJsonUrl: CONFIG.sceneJsonUrl,
    wallVideoUrl: CONFIG.wallVideoUrl,
    requestedRoomId: 'indoor',
    resolvedFromFallback: false
  };
}
