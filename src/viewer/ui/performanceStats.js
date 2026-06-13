(function initPerformanceStats() {
  const urlParams = new URLSearchParams(window.location.search);
  const queryParam = CONFIG.debugPerformanceQueryParam || 'debugPerf';
  const enabledByUrl = urlParams.get(queryParam) === '1'
    || urlParams.get('fps') === '1'
    || urlParams.get('debugFps') === '1';
  const enabledByStorage = localStorage.getItem('viewer_show_fps') === '1'
    || localStorage.getItem('viewer_debug_perf') === '1';
  const shouldShow = Boolean(CONFIG.showFpsMonitor || CONFIG.debugPerformance || enabledByUrl || enabledByStorage);

  if (!shouldShow) {
    window.performanceStats = {
      isEnabled: false,
      setVisible() {},
      destroy() {},
      getSnapshot() { return window.__viewerFrameBudget || null; }
    };
    return;
  }

  const sampleMs = Math.max(250, Number(CONFIG.fpsMonitorSampleMs || 1000));
  const panel = document.createElement('div');
  panel.id = 'fpsMonitor';
  panel.className = 'fps-monitor fps-monitor--detailed';
  panel.innerHTML = `
    <strong>PERF</strong>
    <span id="fpsMonitorValue">-- FPS</span>
    <small id="fpsMonitorFrame">-- ms</small>
    <dl>
      <div><dt>Max</dt><dd id="fpsMonitorMax">-- ms</dd></div>
      <div><dt>State</dt><dd id="fpsMonitorState">warmup</dd></div>
      <div><dt>Room</dt><dd id="fpsMonitorRoom">--</dd></div>
      <div><dt>Device</dt><dd id="fpsMonitorDevice">--</dd></div>
      <div><dt>Quality</dt><dd id="fpsMonitorQuality">--</dd></div>
      <div><dt>DPR</dt><dd id="fpsMonitorDpr">--</dd></div>
      <div><dt>Video</dt><dd id="fpsMonitorVideoMode">--</dd></div>
      <div><dt>Calls</dt><dd id="fpsMonitorCalls">--</dd></div>
      <div><dt>Tris</dt><dd id="fpsMonitorTriangles">--</dd></div>
      <div><dt>Tex</dt><dd id="fpsMonitorTextures">--</dd></div>
      <div><dt>Move</dt><dd id="fpsMonitorMovement">--</dd></div>
      <div><dt>Cam</dt><dd id="fpsMonitorCamera">--</dd></div>
      <div><dt>Art</dt><dd id="fpsMonitorArtwork">--</dd></div>
      <div><dt>Map</dt><dd id="fpsMonitorMiniMap">--</dd></div>
      <div><dt>Render</dt><dd id="fpsMonitorRender">--</dd></div>
      <div><dt>Long</dt><dd id="fpsMonitorLongFrames">--</dd></div>
    </dl>
  `;
  document.body.appendChild(panel);

  const fpsValue = panel.querySelector('#fpsMonitorValue');
  const frameValue = panel.querySelector('#fpsMonitorFrame');
  const maxValue = panel.querySelector('#fpsMonitorMax');
  const stateValue = panel.querySelector('#fpsMonitorState');
  const roomValue = panel.querySelector('#fpsMonitorRoom');
  const deviceValue = panel.querySelector('#fpsMonitorDevice');
  const qualityValue = panel.querySelector('#fpsMonitorQuality');
  const dprValue = panel.querySelector('#fpsMonitorDpr');
  const videoModeValue = panel.querySelector('#fpsMonitorVideoMode');
  const callsValue = panel.querySelector('#fpsMonitorCalls');
  const trianglesValue = panel.querySelector('#fpsMonitorTriangles');
  const texturesValue = panel.querySelector('#fpsMonitorTextures');
  const movementValue = panel.querySelector('#fpsMonitorMovement');
  const cameraValue = panel.querySelector('#fpsMonitorCamera');
  const artworkValue = panel.querySelector('#fpsMonitorArtwork');
  const miniMapValue = panel.querySelector('#fpsMonitorMiniMap');
  const renderValue = panel.querySelector('#fpsMonitorRender');
  const longFramesValue = panel.querySelector('#fpsMonitorLongFrames');

  let visible = true;
  let running = true;
  let lastUpdateAt = 0;
  let lastLoggedAt = 0;

  function formatNumber(value) {
    if (!Number.isFinite(value)) return '--';
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return `${Math.round(value)}`;
  }

  function formatMs(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return '--';
    return `${parsed.toFixed(parsed >= 10 ? 1 : 2)} ms`;
  }

  function readState(budget) {
    if (!budget) return 'warmup';
    if (budget.isCriticalFps) return 'critical';
    if (budget.isLowFps || budget.isLowBudgetFrame) return 'low';
    if (budget.isFastTurning) return 'turning';
    if (budget.wasRecentlySpike) return 'recover';
    return 'ok';
  }

  function updatePanel(now) {
    const budget = window.__viewerFrameBudget || {};
    const fps = Number(budget.fps || 0);
    const frameMs = Number(budget.avgFrameMs || budget.frameMs || 0);
    const maxMs = Number(budget.maxFrameMs || budget.frameMs || 0);
    const state = readState(budget);

    fpsValue.textContent = fps > 0 ? `${Math.round(fps)} FPS` : '-- FPS';
    frameValue.textContent = frameMs > 0 ? `${frameMs.toFixed(1)} ms avg` : '-- ms';
    maxValue.textContent = maxMs > 0 ? `${maxMs.toFixed(1)} ms` : '-- ms';
    stateValue.textContent = state;
    roomValue.textContent = budget.roomId || window.__currentViewerRoom?.id || '--';
    deviceValue.textContent = budget.deviceKind || '--';
    qualityValue.textContent = budget.qualityProfile ? `${budget.qualityProfile}${Number(budget.adaptiveLevel || 0) ? `-${budget.adaptiveLevel}` : ''}` : '--';
    dprValue.textContent = Number.isFinite(budget.dpr) ? budget.dpr.toFixed(2) : '--';
    videoModeValue.textContent = budget.videoPreviewMode || '--';
    callsValue.textContent = formatNumber(budget.renderCalls);
    trianglesValue.textContent = formatNumber(budget.triangles);
    texturesValue.textContent = formatNumber(budget.textures);
    movementValue.textContent = formatMs(budget.movementMs);
    cameraValue.textContent = formatMs(budget.cameraMs);
    artworkValue.textContent = formatMs((Number(budget.artworkProbeMs) || 0) + (Number(budget.artworkStateMs) || 0));
    miniMapValue.textContent = formatMs(budget.minimapMs);
    renderValue.textContent = formatMs(budget.renderMs);
    longFramesValue.textContent = formatNumber(budget.longFrameCount);

    panel.dataset.state = state;

    if (CONFIG.performanceLogToConsole && now - lastLoggedAt > sampleMs) {
      lastLoggedAt = now;
      console.debug('[viewer-perf]', {
        fps: Math.round(fps),
        frameMs: Number(frameMs.toFixed(1)),
        maxFrameMs: Number(maxMs.toFixed(1)),
        state,
        room: budget.roomId,
        dpr: budget.dpr,
        device: budget.deviceKind,
        qualityProfile: budget.qualityProfile,
        adaptiveLevel: budget.adaptiveLevel,
        videoPreviewMode: budget.videoPreviewMode,
        renderCalls: budget.renderCalls,
        triangles: budget.triangles,
        textures: budget.textures,
        movementMs: Number(Number(budget.movementMs || 0).toFixed(2)),
        cameraMs: Number(Number(budget.cameraMs || 0).toFixed(2)),
        artworkMs: Number((Number(budget.artworkProbeMs || 0) + Number(budget.artworkStateMs || 0)).toFixed(2)),
        minimapMs: Number(Number(budget.minimapMs || 0).toFixed(2)),
        renderMs: Number(Number(budget.renderMs || 0).toFixed(2)),
        longFrames: budget.longFrameCount || 0
      });
    }
  }

  function tick(now) {
    if (!running) return;
    if (now - lastUpdateAt >= sampleMs) {
      lastUpdateAt = now;
      updatePanel(now);
    }
    requestAnimationFrame(tick);
  }

  function setVisible(nextVisible) {
    visible = Boolean(nextVisible);
    panel.classList.toggle('hidden', !visible);
  }

  function destroy() {
    running = false;
    panel.remove();
  }

  window.performanceStats = {
    isEnabled: true,
    setVisible,
    destroy,
    getSnapshot() { return window.__viewerFrameBudget || null; }
  };

  requestAnimationFrame(tick);
})();
