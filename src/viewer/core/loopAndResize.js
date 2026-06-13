function isViewerDetailedPerfEnabled() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const queryParam = CONFIG?.debugPerformanceQueryParam || 'debugPerf';
    return CONFIG?.debugPerformance === true
      || CONFIG?.showFpsMonitor === true
      || params.get(queryParam) === '1'
      || params.get('debugPerf') === '1'
      || params.get('fps') === '1'
      || params.get('debugFps') === '1';
  } catch {
    return Boolean(CONFIG?.debugPerformance || CONFIG?.showFpsMonitor);
  }
}

function resetViewerPerfSegments(budget, now) {
  if (!budget || !isViewerDetailedPerfEnabled()) return false;
  budget.debugPerfEnabled = true;
  budget.frameStartedAt = now;
  budget.updateMs = 0;
  budget.lookMs = 0;
  budget.movementMs = 0;
  budget.cameraMs = 0;
  budget.artworkProbeMs = 0;
  budget.artworkStateMs = 0;
  budget.avatarMixerMs = 0;
  budget.roomAnimationMs = 0;
  budget.renderMs = 0;
  budget.artworkProbeCount = 0;
  budget.raycastCount = window.__viewerRaycastCount || 0;
  budget.touchRaycastCount = window.__viewerTouchRaycastCount || 0;
  window.__viewerRaycastCount = 0;
  window.__viewerTouchRaycastCount = 0;
  const quality = getActiveViewerQualityForLoop();
  if (quality) {
    budget.deviceKind = quality.device || (quality.isMobile ? 'mobile' : 'desktop');
    budget.qualityProfile = quality.profileName || 'desktop';
    budget.adaptiveLevel = Number(quality.adaptiveLevel || 0);
    budget.qualityDprMax = Number(quality.maxDpr || 0);
    budget.videoPreviewMode = quality.videoPreviewMode || quality.profile?.videoPreview || 'default';
    budget.minimapFps = quality.minimapFps || quality.profile?.minimapFps || null;
    budget.artworkProbeFps = quality.artworkProbeFps || quality.profile?.artworkProbeFps || null;
    budget.raycastFps = quality.raycastFps || quality.profile?.raycastFps || null;
  }
  return true;
}

function measureViewerPerfSegment(budget, key, callback) {
  if (!budget?.debugPerfEnabled || typeof performance === 'undefined') {
    return callback();
  }
  const start = performance.now();
  try {
    return callback();
  } finally {
    const elapsed = performance.now() - start;
    budget[key] = (Number(budget[key]) || 0) + elapsed;
    budget.updateMs = (Number(budget.updateMs) || 0) + elapsed;
  }
}

function getActiveViewerQualityForLoop() {
  return typeof window.getViewerQualityState === 'function' ? window.getViewerQualityState() : null;
}

function getMobileProfileIntervalSeconds(profile, fpsValue, fallbackSeconds) {
  const fps = Number(fpsValue);
  if (Number.isFinite(fps) && fps > 0) return 1 / fps;
  return fallbackSeconds;
}

function updateAdaptiveViewerQuality(budget, now) {
  const quality = getActiveViewerQualityForLoop();
  const adaptive = CONFIG?.adaptiveQuality || {};
  if (!quality?.isMobile || adaptive.enabled === false || !Number.isFinite(budget?.fps) || budget.fps <= 0) return;

  const state = window.__viewerAdaptiveRuntime || (window.__viewerAdaptiveRuntime = {
    lowSince: 0,
    highSince: 0,
    lastChangeAt: 0
  });
  const degradeBelow = Math.max(12, Number(adaptive.degradeBelowFps || 28));
  const recoverAbove = Math.max(degradeBelow + 2, Number(adaptive.recoverAboveFps || 45));
  const sampleWindow = Math.max(1500, Number(adaptive.sampleWindowMs || 4000));
  const recoverWindow = Math.max(4000, Number(adaptive.recoverWindowMs || 12000));
  const minInterval = Math.max(3000, Number(adaptive.minDegradeIntervalMs || 8000));
  const maxLevel = Math.max(0, Number(adaptive.maxAdaptiveLevel || 2));
  const currentLevel = Math.max(0, Number(quality.adaptiveLevel || 0));

  if (budget.fps < degradeBelow || budget.isCriticalFps || budget.longFrameCount > 0 && budget.maxFrameMs > 48) {
    state.lowSince = state.lowSince || now;
    state.highSince = 0;
    if (now - state.lowSince >= sampleWindow && now - state.lastChangeAt >= minInterval && currentLevel < maxLevel) {
      state.lastChangeAt = now;
      state.lowSince = 0;
      const next = window.setViewerAdaptiveQualityLevel?.(currentLevel + 1, 'low-fps');
      budget.adaptiveEvent = `degrade-${next?.adaptiveLevel ?? currentLevel + 1}`;
    }
    return;
  }

  if (budget.fps > recoverAbove && currentLevel > 0 && !budget.wasRecentlySpike) {
    state.highSince = state.highSince || now;
    state.lowSince = 0;
    if (now - state.highSince >= recoverWindow && now - state.lastChangeAt >= minInterval) {
      state.lastChangeAt = now;
      state.highSince = 0;
      const next = window.setViewerAdaptiveQualityLevel?.(currentLevel - 1, 'recovered');
      budget.adaptiveEvent = `recover-${next?.adaptiveLevel ?? currentLevel - 1}`;
    }
    return;
  }

  state.lowSince = 0;
  state.highSince = 0;
}

function animateArtworkStates(deltaTime) {
  const aimRoot = isLocked && !modalOpen ? currentFocusedRoot : null;

  artworkRoots.forEach((root) => {
    const display = root.userData.display;
    if (!display) return;

    const shouldEmphasize = root === openedRoot ? 1 : (root === hoveredRoot || root === aimRoot ? 1 : 0);
    root.userData.emphasis = THREE.MathUtils.lerp(root.userData.emphasis || 0, shouldEmphasize, Math.min(1, deltaTime * 10));
    const e = root.userData.emphasis;

    // Nhô ra an toàn theo phía camera đang đứng.
    // Nếu local +Z của tranh quay về camera thì đẩy +Z; nếu ngược lại thì đẩy -Z.
    // Cách này tránh lỗi tranh bị chui vào tường rồi biến mất.
    const rootWorldPos = new THREE.Vector3();
    root.getWorldPosition(rootWorldPos);

    const rootNormal = new THREE.Vector3(0, 0, 1);
    rootNormal.applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).normalize();

    const toCamera = camera.position.clone().sub(rootWorldPos).normalize();
    const liftSign = rootNormal.dot(toCamera) >= 0 ? 1 : -1;

    display.position.z = liftSign * e * CONFIG.selectLift;

    const s = 1 + e * CONFIG.hoverScale;
    display.scale.set(s, s, s);

    const outline = root.userData.glowOutline;
    if (outline) {
      outline.visible = e > 0.025;

      const pulse = 0.72 + 0.28 * Math.sin(performance.now() * CONFIG.outlinePulseSpeed);

      outline.traverse((child) => {
        if (!child.isMesh || !child.material) return;

        const role = child.userData.glowRole;
        let opacity = CONFIG.outlineOpacity;

        if (role === 'soft') opacity = CONFIG.outlineSoftOpacity;
        if (role === 'corner') opacity = 0.70;
        if (role === 'scan') opacity = 0.55;

        const pulseBoost = role === 'soft' ? (0.88 + pulse * 0.25) : (0.92 + pulse * 0.12);

        child.material.opacity = e * opacity * pulseBoost;
        child.material.needsUpdate = true;
      });
    }

    display.traverse((child) => {
      if (!child.isMesh || !child.material) return;

      const isImage = child.name && child.name.includes('_IMAGE');
      const isOutline = child.userData && child.userData.isGlowOutline;
      const mats = Array.isArray(child.material) ? child.material : [child.material];

      mats.forEach((mat) => {
        if (isOutline) return;

        if ('emissive' in mat) {
          if (isImage || mat.map) {
            mat.emissive.setHex(root === openedRoot ? 0x173a42 : 0x102d34);
            mat.emissiveIntensity = e * (root === openedRoot ? 0.72 : 0.38);
          } else {
            // Frame glow theo tông cyan/white, bỏ vàng để hiện đại hơn.
            mat.emissive.setHex(root === openedRoot ? 0x9ffbff : 0x48e6ff);
            mat.emissiveIntensity = e * (root === openedRoot ? 1.20 : 0.82);
          }
          mat.needsUpdate = true;
        }
      });
    });
  });
}


function updateSmoothLook(deltaTime) {
  if (!isLocked || modalOpen) { targetYaw = yaw; targetPitch = pitch; }
  if (!Number.isFinite(targetYaw)) targetYaw = yaw;
  if (!Number.isFinite(targetPitch)) targetPitch = pitch;
  const damp = Math.max(1, Number(CONFIG.lookDamping || 20));
  const alpha = 1 - Math.exp(-damp * deltaTime);
  yaw = dampAngle(yaw, targetYaw, alpha);
  pitch = THREE.MathUtils.lerp(pitch, targetPitch, alpha);
  const limit = Math.PI / 2 - 0.08;
  pitch = THREE.MathUtils.clamp(pitch, -limit, limit);
  if (viewMode === 'first') {
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }
}

function isRoomAnimationFullExperienceMode() {
  const cfg = CONFIG?.roomAnimations || {};
  const maxClips = String(cfg.maxClips ?? '').toLowerCase();
  return Boolean(
    CONFIG?.roomAnimationFullExperience === true
    || cfg.fullExperience === true
    || cfg.playAll === true
    || maxClips === 'all'
  );
}

function updateRoomAnimation(deltaTime, now = performance.now(), frameBudget = window.__viewerFrameBudget) {
  if (!roomAnimationMixer) return;

  if (typeof document !== 'undefined' && document.hidden) {
    updateRoomAnimation.lastAt = now;
    return;
  }

  const fullExperience = isRoomAnimationFullExperienceMode();
  const skipOnBudget = CONFIG?.roomAnimationSkipOnFrameBudget !== false && !fullExperience;
  if (skipOnBudget && (frameBudget?.isSpikeFrame || frameBudget?.wasRecentlySpike || frameBudget?.isLowBudgetFrame)) return;

  const isOutdoor = String(CONFIG.currentRoomId || '').toLowerCase() === 'outdoor';
  const configuredUpdateMs = isOutdoor ? Number(CONFIG.roomAnimationOutdoorUpdateMs) : Number(CONFIG.roomAnimationUpdateMs);
  const updateEveryFrame = fullExperience || CONFIG?.roomAnimationUpdateEveryFrame === true;
  const updateMs = updateEveryFrame ? 0 : Math.max(0, Number.isFinite(configuredUpdateMs) ? configuredUpdateMs : (isOutdoor ? 50 : 33));
  if (updateMs > 0 && updateRoomAnimation.lastAt && now - updateRoomAnimation.lastAt < updateMs) return;
  updateRoomAnimation.lastAt = now;

  const fallbackMaxDelta = fullExperience ? 0.05 : 0.022;
  const configuredMaxDelta = Number(CONFIG.roomAnimationMaxDelta);
  const maxDelta = Math.max(0.016, Math.min(0.10, Number.isFinite(configuredMaxDelta) ? configuredMaxDelta : fallbackMaxDelta));
  const safeDelta = Math.max(0, Math.min(deltaTime || 0, maxDelta));
  if (safeDelta <= 0) return;
  roomAnimationMixer.update(safeDelta);
}

function updateMeasuredFrameBudget(rawDelta, deltaTime, now) {
  const maxFrameDelta = Math.max(0.016, Number(CONFIG.maxFrameDelta || 0.033));
  const spikeDelta = Math.max(maxFrameDelta * 1.18, Number(CONFIG.frameSpikeDelta || 0.040));
  const spikeCooldownMs = Math.max(120, Number(CONFIG.frameSpikeCooldownMs || 360));
  const lowFpsBudgetMs = Math.max(16, Number(CONFIG.lowFpsFrameBudgetMs || 22));
  const sampleMs = Math.max(400, Number(CONFIG.fpsMonitorSampleMs || 1000));
  const lowFpsThreshold = Math.max(15, Number(CONFIG.performanceLowFpsThreshold || 45));
  const criticalFpsThreshold = Math.max(12, Number(CONFIG.performanceCriticalFpsThreshold || 32));

  const budget = window.__viewerFrameBudget || (window.__viewerFrameBudget = {});
  const frameMs = rawDelta * 1000;
  const isSpikeFrame = rawDelta > spikeDelta || frameMs > Number(CONFIG.performanceSpikeFrameMs || 42);
  const isLowBudgetFrame = frameMs > lowFpsBudgetMs;

  if (!budget.sampleStartAt) {
    budget.sampleStartAt = now;
    budget.sampleFrames = 0;
    budget.sampleFrameMs = 0;
    budget.sampleMaxFrameMs = 0;
    budget.fps = 0;
    budget.avgFrameMs = frameMs;
    budget.maxFrameMs = frameMs;
  }

  budget.sampleFrames += 1;
  budget.sampleFrameMs += frameMs;
  budget.sampleMaxFrameMs = Math.max(budget.sampleMaxFrameMs || 0, frameMs);

  if (now - budget.sampleStartAt >= sampleMs) {
    const elapsed = Math.max(1, now - budget.sampleStartAt);
    budget.fps = budget.sampleFrames * 1000 / elapsed;
    budget.avgFrameMs = budget.sampleFrameMs / Math.max(1, budget.sampleFrames);
    budget.maxFrameMs = budget.sampleMaxFrameMs;
    budget.sampleStartAt = now;
    budget.sampleFrames = 0;
    budget.sampleFrameMs = 0;
    budget.sampleMaxFrameMs = 0;
  }

  if (isSpikeFrame || isLowBudgetFrame || budget.fps > 0 && budget.fps < lowFpsThreshold) {
    budget.lastSpikeAt = now;
  }
  if (isSpikeFrame) {
    budget.longFrameCount = (Number(budget.longFrameCount) || 0) + 1;
  }

  const fastTurnWindowMs = Math.max(80, Number(CONFIG.suppressHoverWhileTurningMs || 240));
  budget.rawDelta = rawDelta;
  budget.deltaTime = deltaTime;
  budget.frameMs = frameMs;
  budget.isSpikeFrame = isSpikeFrame;
  budget.isLowBudgetFrame = isLowBudgetFrame;
  budget.isLowFps = Boolean(budget.fps > 0 && budget.fps < lowFpsThreshold);
  budget.isCriticalFps = Boolean(budget.fps > 0 && budget.fps < criticalFpsThreshold);
  budget.wasRecentlySpike = Boolean(budget.lastSpikeAt && now - budget.lastSpikeAt < spikeCooldownMs);
  budget.isFastTurning = Boolean(budget.lastFastTurnAt && now - budget.lastFastTurnAt < fastTurnWindowMs);
  budget.roomId = String(CONFIG.currentRoomId || window.__currentViewerRoom?.id || 'indoor');
  budget.dpr = typeof renderer?.getPixelRatio === 'function' ? renderer.getPixelRatio() : (window.devicePixelRatio || 1);

  const info = renderer?.info;
  if (info) {
    budget.renderCalls = info.render?.calls ?? 0;
    budget.triangles = info.render?.triangles ?? 0;
    budget.points = info.render?.points ?? 0;
    budget.lines = info.render?.lines ?? 0;
    budget.textures = info.memory?.textures ?? 0;
    budget.geometries = info.memory?.geometries ?? 0;
  }

  const quality = getActiveViewerQualityForLoop();
  if (quality) {
    budget.deviceKind = quality.device || (quality.isMobile ? 'mobile' : 'desktop');
    budget.qualityProfile = quality.profileName || 'desktop';
    budget.adaptiveLevel = Number(quality.adaptiveLevel || 0);
    budget.qualityDprMax = Number(quality.maxDpr || 0);
    budget.videoPreviewMode = quality.videoPreviewMode || quality.profile?.videoPreview || 'default';
    budget.minimapFps = quality.minimapFps || quality.profile?.minimapFps || null;
    budget.artworkProbeFps = quality.artworkProbeFps || quality.profile?.artworkProbeFps || null;
    budget.raycastFps = quality.raycastFps || quality.profile?.raycastFps || null;
  }

  updateAdaptiveViewerQuality(budget, now);

  return budget;
}

function animate() {
  requestAnimationFrame(animate);
  const rawDelta = clock.getDelta();
  const maxFrameDelta = Math.max(0.016, Number(CONFIG.maxFrameDelta || 0.033));
  const deltaTime = Math.min(rawDelta, maxFrameDelta);
  const now = performance.now();
  const budget = updateMeasuredFrameBudget(rawDelta, deltaTime, now);
  resetViewerPerfSegments(budget, now);

  measureViewerPerfSegment(budget, 'lookMs', () => updateSmoothLook(deltaTime));
  measureViewerPerfSegment(budget, 'movementMs', () => updateMovement(deltaTime));

  // Khi chưa click khóa chuột, updateMovement không chạy.
  // Vẫn cần cập nhật camera third-person để avatar hiện ngay trên màn hình sẵn sàng.
  if (!isLocked && viewMode === 'third' && avatar && !modalOpen) {
    measureViewerPerfSegment(budget, 'cameraMs', () => updateCameraForAvatar(deltaTime));
  }

  const skipAuxiliaryWork = Boolean(
    CONFIG.suppressAuxiliaryOnSpike !== false
    && (budget.isSpikeFrame || budget.wasRecentlySpike || budget.isLowBudgetFrame || (CONFIG.suppressAuxiliaryWhenLowFps !== false && budget.isLowFps))
  );
  const isOutdoorRoom = String(CONFIG.currentRoomId || '').toLowerCase() === 'outdoor';

  artworkProbeTimer += deltaTime;
  const quality = getActiveViewerQualityForLoop();
  const configuredProbeBase = isOutdoorRoom ? Number(CONFIG.artworkProbeOutdoorInterval || 0.21) : Number(CONFIG.artworkProbeInterval || 0.12);
  const probeIntervalBase = quality?.isMobile
    ? Math.max(configuredProbeBase, getMobileProfileIntervalSeconds(quality.profile, quality.profile?.artworkProbeFps || quality.artworkProbeFps, configuredProbeBase))
    : configuredProbeBase;
  const adaptiveProbeMultiplier = quality?.isMobile ? 1 + Number(quality.adaptiveLevel || 0) * 0.35 : 1;
  const turnMultiplier = budget.isFastTurning ? Number(CONFIG.artworkProbeTurningIntervalMultiplier || 3.0) : 1;
  const lowFpsMultiplier = budget.isLowFps ? Number(CONFIG.artworkProbeLowFpsMultiplier || 2.6) : 1;
  const roomBias = isOutdoorRoom ? Number(CONFIG.outdoorPerformanceBias || 1.45) : 1;
  const probeInterval = probeIntervalBase * adaptiveProbeMultiplier * turnMultiplier * lowFpsMultiplier * roomBias;
  if (!skipAuxiliaryWork && artworkProbeTimer >= probeInterval) {
    artworkProbeTimer = 0;
    measureViewerPerfSegment(budget, 'artworkProbeMs', () => {
      if (isLocked && !modalOpen) {
        budget.artworkProbeCount = (Number(budget.artworkProbeCount) || 0) + 1;
        checkArtworkAtCenter(true);
      }
      if (!isLocked && !modalOpen) {
        budget.artworkProbeCount = (Number(budget.artworkProbeCount) || 0) + 1;
        checkArtworkAtMouse(true);
      }
      if (!isLocked && !hoveredRoot && !modalOpen) hideFocusCard();
      if (!isLocked && hoveredRoot && !modalOpen) updateFocusCard(hoveredRoot);
    });
  }

  if (!skipAuxiliaryWork && !budget.isFastTurning && !budget.isCriticalFps) {
    measureViewerPerfSegment(budget, 'artworkStateMs', () => animateArtworkStates(deltaTime));
  }
  measureViewerPerfSegment(budget, 'avatarMixerMs', () => updateAvatarAnimation(Math.min(deltaTime, 0.033)));
  const roomAnimationDelta = CONFIG?.roomAnimationUseRawDelta === false ? deltaTime : rawDelta;
  measureViewerPerfSegment(budget, 'roomAnimationMs', () => updateRoomAnimation(roomAnimationDelta, now, budget));
  measureViewerPerfSegment(budget, 'renderMs', () => renderer.render(scene, camera));
}

let resizeRafId = 0;
window.addEventListener('resize', () => {
  if (resizeRafId) return;
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = 0;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(typeof window.getViewerPixelRatio === 'function' ? window.getViewerPixelRatio() : Math.min(window.devicePixelRatio, 2));
  });
});
