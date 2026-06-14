const ENABLE_PREMIUM_CURSOR = true;
const TRAIL_POINT_LIMIT = 7;
const MAX_DPR = 1.25;
const MIN_CURSOR_WIDTH = 820;
const RING_FOLLOW_TAU_MS = 30;
const VIDEO_RING_FOLLOW_TAU_MS = 34;
const MAX_FRAME_DELTA_MS = 40;

let destroyActiveCursor = null;

function getCursorMode(target) {
  if (target?.closest?.('.hero-video-card')) return 'video';
  if (target?.closest?.('a, button, .room-card, .feature-card, .guide-item')) return 'active';
  return 'default';
}

function setCursorMode(mode) {
  document.body.classList.toggle('is-cursor-active', mode === 'active' || mode === 'video');
  document.body.classList.toggle('is-cursor-video', mode === 'video');
}

function clearCursorMode() {
  if (document.body.classList.contains('is-cursor-active')) {
    document.body.classList.remove('is-cursor-active');
  }
  if (document.body.classList.contains('is-cursor-video')) {
    document.body.classList.remove('is-cursor-video');
  }
}

function isVideoModalOpen() {
  return document.body.classList.contains('is-video-modal-open');
}

function createPremiumCursorElement() {
  const cursor = document.createElement('div');
  const ring = document.createElement('span');
  const dot = document.createElement('span');

  cursor.id = 'premiumCursor';
  cursor.setAttribute('aria-hidden', 'true');
  ring.className = 'cursor-ring';
  dot.className = 'cursor-dot';
  cursor.append(ring, dot);
  document.body.appendChild(cursor);
  return cursor;
}

function createTrailCanvas() {
  const canvas = document.createElement('canvas');
  canvas.id = 'premiumCursorTrail';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  return canvas;
}

function resizeCanvas(canvas, context) {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const width = Math.max(1, Math.floor(window.innerWidth * dpr));
  const height = Math.max(1, Math.floor(window.innerHeight * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function clearTrail(context) {
  if (!context) return;
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
}

function drawTrail(context, points, mode, isVisible) {
  clearTrail(context);
  if (!isVisible || points.length < 2) return;

  const modeBoost = mode === 'video' ? 1.15 : mode === 'active' ? 1.05 : 0.88;
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.globalCompositeOperation = 'lighter';

  for (let i = points.length - 1; i > 0; i -= 1) {
    const current = points[i];
    const next = points[i - 1];
    const t = 1 - i / points.length;
    const alpha = (0.035 + t * 0.115) * modeBoost;
    const width = (2.5 + t * 7.5) * modeBoost;

    const gradient = context.createLinearGradient(current.x, current.y, next.x, next.y);
    gradient.addColorStop(0, `rgba(143, 217, 255, ${alpha * 0.32})`);
    gradient.addColorStop(0.55, `rgba(255, 246, 222, ${alpha})`);
    gradient.addColorStop(1, `rgba(232, 192, 109, ${alpha * 0.64})`);

    context.strokeStyle = gradient;
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(current.x, current.y);
    const midX = (current.x + next.x) * 0.5;
    const midY = (current.y + next.y) * 0.5;
    context.quadraticCurveTo(midX, midY, next.x, next.y);
    context.stroke();
  }

  context.restore();
}

function addMediaQueryChangeListener(query, listener) {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }

  query.addListener?.(listener);
  return () => query.removeListener?.(listener);
}

export function initLiquidCursor() {
  destroyActiveCursor?.();

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointerQuery = window.matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const desktopWidthQuery = window.matchMedia(`(min-width: ${MIN_CURSOR_WIDTH}px)`);

  let cursor = null;
  let ring = null;
  let trailCanvas = null;
  let trailContext = null;
  let cursorWasCreated = false;
  let canvasWasCreated = false;

  const state = {
    targetX: 0,
    targetY: 0,
    ringX: 0,
    ringY: 0,
    mode: 'default',
    pointerReady: false,
    pointerInside: false,
    pointerType: '',
    enabled: false,
    destroyed: false,
    raf: 0,
    lastFrameTime: 0,
    points: []
  };

  const ensureElements = () => {
    cursor = document.getElementById('premiumCursor');
    if (!cursor) {
      cursor = createPremiumCursorElement();
      cursorWasCreated = true;
    }

    ring = cursor.querySelector('.cursor-ring');
    if (!ring) {
      ring = document.createElement('span');
      ring.className = 'cursor-ring';
      cursor.prepend(ring);
    }

    if (!cursor.querySelector('.cursor-dot')) {
      const dot = document.createElement('span');
      dot.className = 'cursor-dot';
      cursor.appendChild(dot);
    }

    trailCanvas = document.getElementById('premiumCursorTrail');
    if (!trailCanvas) {
      trailCanvas = createTrailCanvas();
      canvasWasCreated = true;
    }

    trailContext = trailCanvas.getContext('2d', { alpha: true });
    if (!trailContext) return false;

    resizeCanvas(trailCanvas, trailContext);
    return true;
  };

  const isMousePointer = () => state.pointerType === 'mouse' || state.pointerType === '';

  const canRun = () => ENABLE_PREMIUM_CURSOR
    && !state.destroyed
    && state.pointerReady
    && state.pointerInside
    && isMousePointer()
    && document.visibilityState === 'visible'
    && !reducedMotionQuery.matches
    && finePointerQuery.matches
    && desktopWidthQuery.matches
    && !isVideoModalOpen();

  const placeDotAtTarget = () => {
    if (!cursor) return;
    cursor.style.transform = `translate3d(${state.targetX}px, ${state.targetY}px, 0)`;
  };

  const placeRing = () => {
    if (!ring) return;
    const offsetX = state.ringX - state.targetX;
    const offsetY = state.ringY - state.targetY;
    ring.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) translate(-50%, -50%)`;
  };

  const resetRingToTarget = () => {
    state.ringX = state.targetX;
    state.ringY = state.targetY;
    placeRing();
  };

  const pushTrailPoint = () => {
    const latest = state.points[0];
    const dx = latest ? Math.abs(latest.x - state.ringX) : 999;
    const dy = latest ? Math.abs(latest.y - state.ringY) : 999;

    if (!latest || dx + dy > 1.5) {
      state.points.unshift({ x: state.ringX, y: state.ringY });
      if (state.points.length > TRAIL_POINT_LIMIT) state.points.pop();
    }
  };

  const stopLoop = () => {
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }

    state.enabled = false;
    state.lastFrameTime = 0;
    state.points.length = 0;
    clearTrail(trailContext);
    cursor?.classList.add('is-hidden');
    if (document.body.classList.contains('has-premium-cursor')) {
      document.body.classList.remove('has-premium-cursor');
    }
    clearCursorMode();
  };

  const render = (timestamp) => {
    state.raf = 0;
    if (!canRun()) {
      stopLoop();
      return;
    }

    const rawDelta = state.lastFrameTime > 0 ? timestamp - state.lastFrameTime : 16.67;
    const deltaMs = Math.min(MAX_FRAME_DELTA_MS, Math.max(0, rawDelta));
    state.lastFrameTime = timestamp;

    const tauMs = state.mode === 'video' ? VIDEO_RING_FOLLOW_TAU_MS : RING_FOLLOW_TAU_MS;
    const follow = 1 - Math.exp(-deltaMs / tauMs);
    state.ringX += (state.targetX - state.ringX) * follow;
    state.ringY += (state.targetY - state.ringY) * follow;

    placeRing();
    pushTrailPoint();
    drawTrail(trailContext, state.points, state.mode, true);
    state.raf = requestAnimationFrame(render);
  };

  const startLoop = () => {
    if (!canRun()) {
      stopLoop();
      return;
    }

    if (!ensureElements()) {
      stopLoop();
      return;
    }

    if (!state.enabled) {
      state.enabled = true;
      state.lastFrameTime = 0;
      state.points.length = 0;
      resetRingToTarget();
      placeDotAtTarget();
      setCursorMode(state.mode);
      document.body.classList.add('has-premium-cursor');
      cursor.classList.remove('is-hidden');
    }

    if (!state.raf) state.raf = requestAnimationFrame(render);
  };

  const evaluateLifecycle = () => {
    if (canRun()) startLoop();
    else stopLoop();
  };

  const move = (event) => {
    state.pointerType = event.pointerType || 'mouse';

    if (!isMousePointer()) {
      state.pointerReady = false;
      state.pointerInside = false;
      evaluateLifecycle();
      return;
    }

    state.targetX = event.clientX;
    state.targetY = event.clientY;
    state.pointerReady = Number.isFinite(state.targetX) && Number.isFinite(state.targetY);
    state.pointerInside = true;

    const nextMode = getCursorMode(event.target);
    if (nextMode !== state.mode) state.mode = nextMode;

    if (!canRun()) {
      evaluateLifecycle();
      return;
    }

    if (!ensureElements()) return;
    placeDotAtTarget();
    cursor.classList.remove('is-hidden');
    setCursorMode(state.mode);
    startLoop();
  };

  const updateMode = (event) => {
    if ((event.pointerType || state.pointerType || 'mouse') !== 'mouse') return;
    const nextMode = getCursorMode(event.target);
    if (nextMode === state.mode) return;
    state.mode = nextMode;
    if (state.enabled) setCursorMode(state.mode);
  };

  const leaveWindow = () => {
    state.pointerInside = false;
    evaluateLifecycle();
  };

  const enterWindow = () => {
    if (!state.pointerReady || !isMousePointer()) return;
    state.pointerInside = true;
    evaluateLifecycle();
  };

  const handleResize = () => {
    if (trailCanvas && trailContext) resizeCanvas(trailCanvas, trailContext);
    evaluateLifecycle();
  };

  const handleVisibilityChange = () => evaluateLifecycle();
  const handleCapabilityChange = () => evaluateLifecycle();

  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('resize', handleResize, { passive: true });
  window.addEventListener('blur', leaveWindow, { passive: true });
  document.addEventListener('pointerover', updateMode, { passive: true });
  document.addEventListener('mouseleave', leaveWindow, { passive: true });
  document.addEventListener('mouseenter', enterWindow, { passive: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);

  const removeReducedMotionListener = addMediaQueryChangeListener(reducedMotionQuery, handleCapabilityChange);
  const removeFinePointerListener = addMediaQueryChangeListener(finePointerQuery, handleCapabilityChange);
  const removeDesktopWidthListener = addMediaQueryChangeListener(desktopWidthQuery, handleCapabilityChange);

  let lastModalOpenState = isVideoModalOpen();
  const modalObserver = new MutationObserver(() => {
    const nextModalOpenState = isVideoModalOpen();
    if (nextModalOpenState === lastModalOpenState) return;
    lastModalOpenState = nextModalOpenState;
    evaluateLifecycle();
  });
  modalObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  const destroy = () => {
    if (state.destroyed) return;
    state.destroyed = true;
    stopLoop();

    window.removeEventListener('pointermove', move);
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('blur', leaveWindow);
    document.removeEventListener('pointerover', updateMode);
    document.removeEventListener('mouseleave', leaveWindow);
    document.removeEventListener('mouseenter', enterWindow);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    removeReducedMotionListener();
    removeFinePointerListener();
    removeDesktopWidthListener();
    modalObserver.disconnect();

    if (cursorWasCreated) cursor?.remove();
    if (canvasWasCreated) trailCanvas?.remove();
    cursor = null;
    ring = null;
    trailCanvas = null;
    trailContext = null;

    if (destroyActiveCursor === destroy) destroyActiveCursor = null;
  };

  destroyActiveCursor = destroy;
  return destroy;
}
