const miniMapPanel = document.getElementById('miniMapPanel');
const miniMapCanvas = document.getElementById('miniMapCanvas');
const miniMapToggle = document.getElementById('miniMapToggle');
const mobileMapHomeBtn = document.getElementById('mobileMapHomeBtn');
const miniMapCtx = miniMapCanvas ? miniMapCanvas.getContext('2d') : null;

let miniMapCollapsed = false;
let miniMapRafId = null;
let lastMiniMapFrameTime = 0;
let smoothViewerPoint = null;
let smoothViewerYaw = null;

function normalizeAngle(angle) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function lerpAngle(current, target, alpha) {
  if (!Number.isFinite(current)) return target;
  const delta = normalizeAngle(target - current);
  return normalizeAngle(current + delta * alpha);
}

function getMiniMapViewerPosition() {
  if (avatar) return avatar.position;
  return camera.position;
}

function getMiniMapFacingYaw() {
  if (avatar && avatar.rotation && Number.isFinite(avatar.rotation.y)) {
    return avatar.rotation.y;
  }
  if (Number.isFinite(yaw)) return yaw;
  return 0;
}

function getMiniMapArtworkPoints() {
  return artworkRoots
    .filter((root) => root.userData?.artData?.clickable !== false)
    .map((root) => {
      const pos = new THREE.Vector3();
      root.getWorldPosition(pos);
      return {
        x: pos.x,
        z: pos.z,
        id: root.userData?.artData?.id || root.name,
      };
    });
}

function getMiniMapBounds(points, viewerPoint) {
  const all = [...points, viewerPoint].filter(Boolean);

  if (all.length === 0) {
    return { minX: -8, maxX: 8, minZ: -8, maxZ: 8 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  all.forEach((p) => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  });

  const pad = 2.5;
  minX -= pad;
  maxX += pad;
  minZ -= pad;
  maxZ += pad;

  if (Math.abs(maxX - minX) < 1) {
    minX -= 4;
    maxX += 4;
  }
  if (Math.abs(maxZ - minZ) < 1) {
    minZ -= 4;
    maxZ += 4;
  }

  return { minX, maxX, minZ, maxZ };
}

function prepareMiniMapCanvas() {
  if (!miniMapCanvas || !miniMapCtx) return null;

  const cssWidth = miniMapCanvas.clientWidth || miniMapCanvas.width || 220;
  const cssHeight = miniMapCanvas.clientHeight || miniMapCanvas.height || 160;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const pixelWidth = Math.floor(cssWidth * dpr);
  const pixelHeight = Math.floor(cssHeight * dpr);

  if (miniMapCanvas.width !== pixelWidth || miniMapCanvas.height !== pixelHeight) {
    miniMapCanvas.width = pixelWidth;
    miniMapCanvas.height = pixelHeight;
  }

  miniMapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: cssWidth, height: cssHeight };
}

function createMiniMapProjector(bounds, width, height) {
  const pad = CONFIG.miniMapPadding || 18;
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxZ - bounds.minZ;
  const scale = Math.min((width - pad * 2) / worldW, (height - pad * 2) / worldH);

  const mapW = worldW * scale;
  const mapH = worldH * scale;
  const offsetX = (width - mapW) / 2;
  const offsetY = (height - mapH) / 2;

  // HOTFIX V3.2.2:
  // X đi sang phải, +Z đi xuống canvas. Công thức này giữ hướng di chuyển trên minimap
  // đồng bộ với hướng di chuyển thực tế trong phòng, không đảo trước/sau.
  return (x, z) => ({
    x: offsetX + (x - bounds.minX) * scale,
    y: offsetY + (z - bounds.minZ) * scale,
  });
}

function drawMiniMapBackground(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let x = 20; x < width; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 20; y < height; y += 20) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawMiniMapArtwork(ctx, project, point) {
  const p = project(point.x, point.z);
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.1, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(232, 192, 109, 0.92)';
  ctx.fill();
}

function drawMiniMapViewer(ctx, project, viewerPoint, viewerYaw) {
  const p = project(viewerPoint.x, viewerPoint.z);

  ctx.save();
  ctx.translate(p.x, p.y);

  // Mũi tên gốc trỏ lên. Với canvas +Y đi xuống và world +Z cũng đi xuống,
  // yaw=0 của avatar tương ứng hướng +Z nên cần quay PI để mũi tên trỏ xuống.
  // Dùng avatar.rotation.y, không dùng camera.rotation, để camera orbit không làm mũi tên xoay sai.
  ctx.rotate(Math.PI - viewerYaw);

  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(6.5, 7.5);
  ctx.lineTo(0, 4.2);
  ctx.lineTo(-6.5, 7.5);
  ctx.closePath();
  ctx.fillStyle = 'rgba(143, 217, 255, 0.98)';
  ctx.fill();

  ctx.lineWidth = 1.15;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();
  ctx.restore();
}

function getSmoothAlpha(smoothValue, deltaSeconds) {
  const rawAlpha = 1 - Math.exp(-smoothValue * deltaSeconds);
  const minAlpha = Number(CONFIG.miniMapMinAlpha) || 0.12;
  return Math.max(minAlpha, Math.min(1, rawAlpha));
}

function getSmoothedViewerPoint(deltaSeconds) {
  const viewerPos = getMiniMapViewerPosition();
  const targetPoint = { x: viewerPos.x, z: viewerPos.z };
  const targetYaw = getMiniMapFacingYaw();
  const positionSmooth = Number(CONFIG.miniMapPositionSmooth) || 24;
  const yawSmooth = Number(CONFIG.miniMapYawSmooth) || 32;
  const posAlpha = getSmoothAlpha(positionSmooth, deltaSeconds);
  const yawAlpha = getSmoothAlpha(yawSmooth, deltaSeconds);

  if (!smoothViewerPoint) {
    smoothViewerPoint = { ...targetPoint };
  } else {
    smoothViewerPoint.x += (targetPoint.x - smoothViewerPoint.x) * posAlpha;
    smoothViewerPoint.z += (targetPoint.z - smoothViewerPoint.z) * posAlpha;
  }

  smoothViewerYaw = smoothViewerYaw === null
    ? targetYaw
    : lerpAngle(smoothViewerYaw, targetYaw, yawAlpha);

  return {
    point: smoothViewerPoint,
    yaw: smoothViewerYaw,
  };
}

function resetMiniMapSmoothing() {
  const viewerPos = getMiniMapViewerPosition();
  smoothViewerPoint = viewerPos ? { x: viewerPos.x, z: viewerPos.z } : null;
  smoothViewerYaw = getMiniMapFacingYaw();
}

function updateMiniMap(deltaSeconds = 1 / 60) {
  if (!miniMapPanel || !miniMapCanvas || !miniMapCtx || miniMapCollapsed) return;

  const viewport = prepareMiniMapCanvas();
  if (!viewport) return;

  const { point: viewerPoint, yaw: viewerYaw } = getSmoothedViewerPoint(deltaSeconds);
  const artPoints = getMiniMapArtworkPoints();
  const bounds = getMiniMapBounds(artPoints, viewerPoint);
  const project = createMiniMapProjector(bounds, viewport.width, viewport.height);

  drawMiniMapBackground(miniMapCtx, viewport.width, viewport.height);
  artPoints.forEach((point) => drawMiniMapArtwork(miniMapCtx, project, point));
  drawMiniMapViewer(miniMapCtx, project, viewerPoint, viewerYaw);
}

function getMiniMapMobileDesiredMs(baseMs, budget) {
  const quality = typeof window.getViewerQualityState === 'function' ? window.getViewerQualityState() : null;
  if (!quality?.isMobile) return baseMs;
  const fps = Number(quality.profile?.minimapFps || quality.minimapFps || 0);
  const profileMs = fps > 0 ? 1000 / fps : baseMs;
  const adaptiveLevel = Math.max(0, Number(quality.adaptiveLevel || 0));
  const collapsedBias = miniMapCollapsed ? 3000 : 0;
  const adaptiveBias = adaptiveLevel > 0 ? profileMs * adaptiveLevel * 0.35 : 0;
  return Math.max(baseMs, profileMs + adaptiveBias, collapsedBias);
}

function miniMapFrame(timestamp) {
  if (!lastMiniMapFrameTime) lastMiniMapFrameTime = timestamp;
  const maxDelta = Number(CONFIG.miniMapMaxDelta) || 0.04;
  const deltaSeconds = Math.min(maxDelta, Math.max(0.001, (timestamp - lastMiniMapFrameTime) / 1000));
  lastMiniMapFrameTime = timestamp;

  const budget = window.__viewerFrameBudget;
  const isOutdoor = String(CONFIG.currentRoomId || '').toLowerCase() === 'outdoor';
  const configuredBaseMs = isOutdoor ? Number(CONFIG.miniMapOutdoorUpdateMs || 440) : Number(CONFIG.miniMapUpdateMs || 220);
  const baseMs = getMiniMapMobileDesiredMs(configuredBaseMs, budget);
  const turningMs = Number(CONFIG.miniMapTurningUpdateMs || 620);
  const lowFpsMs = Number(CONFIG.miniMapLowFpsUpdateMs || 720);
  const desiredMs = budget?.isFastTurning
    ? Math.max(baseMs, turningMs)
    : (budget?.isLowFps || budget?.wasRecentlySpike || budget?.isLowBudgetFrame ? Math.max(lowFpsMs, baseMs * 2.1) : baseMs);
  if (!budget?.isSpikeFrame && !budget?.isCriticalFps && (!miniMapFrame.lastDrawAt || timestamp - miniMapFrame.lastDrawAt >= desiredMs)) {
    miniMapFrame.lastDrawAt = timestamp;
    if (!miniMapCollapsed) {
      if (budget?.debugPerfEnabled) {
        const start = performance.now();
        updateMiniMap(deltaSeconds);
        budget.minimapMs = performance.now() - start;
      } else {
        updateMiniMap(deltaSeconds);
      }
    }
  }
  miniMapRafId = window.requestAnimationFrame(miniMapFrame);
}

function setMiniMapCollapsed(nextCollapsed) {
  miniMapCollapsed = Boolean(nextCollapsed);
  miniMapPanel?.classList.toggle('collapsed', miniMapCollapsed);

  if (miniMapToggle) {
    miniMapToggle.textContent = miniMapCollapsed ? '+' : '−';
    miniMapToggle.title = miniMapCollapsed ? 'Mở rộng minimap' : 'Thu gọn minimap';
    miniMapToggle.setAttribute('aria-label', miniMapCollapsed ? 'Mở rộng minimap' : 'Thu gọn minimap');
    miniMapToggle.setAttribute('aria-expanded', String(!miniMapCollapsed));
  }

  if (!miniMapCollapsed) {
    resetMiniMapSmoothing();
    updateMiniMap(1 / 60);
  }
}

function initMiniMap() {
  if (!miniMapPanel || !miniMapCanvas || !miniMapCtx) return;

  miniMapToggle?.addEventListener('click', () => setMiniMapCollapsed(!miniMapCollapsed));
  mobileMapHomeBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.location.href = './index.html';
  });
  resetMiniMapSmoothing();

  const shouldCollapseOnMobile = Boolean(
    CONFIG.mobile?.defaultMiniMapCollapsed
    && window.viewerMobileDevice?.isMobileViewer?.()
  );

  if (shouldCollapseOnMobile) setMiniMapCollapsed(true);
  else updateMiniMap(1 / 60);

  if (!miniMapRafId) {
    miniMapRafId = window.requestAnimationFrame(miniMapFrame);
  }
}

initMiniMap();

window.initMiniMap = initMiniMap;
window.updateMiniMap = updateMiniMap;
window.setMiniMapCollapsed = setMiniMapCollapsed;
window.getMiniMapFacingYaw = getMiniMapFacingYaw;
