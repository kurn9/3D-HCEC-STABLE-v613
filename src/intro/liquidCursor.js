const ENABLE_PREMIUM_CURSOR = true;
const TRAIL_POINT_LIMIT = 7;
const MAX_DPR = 1.25;

function shouldDisableCursor() {
  return !ENABLE_PREMIUM_CURSOR
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || window.matchMedia('(pointer: coarse)').matches
    || window.innerWidth < 820;
}

function getCursorMode(target) {
  if (target?.closest?.('.hero-video-card')) return 'video';
  if (target?.closest?.('a, button, .room-card, .feature-card, .guide-item')) return 'active';
  return 'default';
}

function setCursorMode(mode) {
  document.body.classList.toggle('is-cursor-active', mode === 'active' || mode === 'video');
  document.body.classList.toggle('is-cursor-video', mode === 'video');
}

function isVideoModalOpen() {
  return document.body.classList.contains('is-video-modal-open');
}

function createPremiumCursorElement() {
  const cursor = document.createElement('div');
  cursor.id = 'premiumCursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML = '<span class="cursor-ring"></span><span class="cursor-dot"></span>';
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

function drawTrail(context, points, mode, isVisible) {
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
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

export function initLiquidCursor() {
  if (shouldDisableCursor()) return;

  const cursor = document.getElementById('premiumCursor') || createPremiumCursorElement();
  const trailCanvas = document.getElementById('premiumCursorTrail') || createTrailCanvas();
  const trailContext = trailCanvas.getContext('2d', { alpha: true });
  if (!trailContext) return;

  const state = {
    targetX: window.innerWidth * 0.5,
    targetY: window.innerHeight * 0.5,
    currentX: window.innerWidth * 0.5,
    currentY: window.innerHeight * 0.5,
    mode: 'default',
    running: true,
    visible: true,
    raf: 0,
    points: []
  };

  resizeCanvas(trailCanvas, trailContext);
  document.body.classList.add('has-premium-cursor');
  setCursorMode(state.mode);

  const pushTrailPoint = () => {
    const latest = state.points[0];
    const dx = latest ? Math.abs(latest.x - state.currentX) : 999;
    const dy = latest ? Math.abs(latest.y - state.currentY) : 999;

    if (!latest || dx + dy > 1.5) {
      state.points.unshift({ x: state.currentX, y: state.currentY });
      if (state.points.length > TRAIL_POINT_LIMIT) state.points.pop();
    }
  };

  const move = (event) => {
    state.targetX = event.clientX;
    state.targetY = event.clientY;
    state.visible = true;
    cursor.classList.remove('is-hidden');

    const nextMode = getCursorMode(event.target);
    if (nextMode !== state.mode) {
      state.mode = nextMode;
      setCursorMode(state.mode);
    }
  };

  const updateMode = (event) => {
    state.mode = getCursorMode(event.target);
    setCursorMode(state.mode);
  };

  const leaveWindow = () => {
    state.visible = false;
    cursor.classList.add('is-hidden');
  };

  const enterWindow = () => {
    state.visible = true;
    cursor.classList.remove('is-hidden');
  };

  const render = () => {
    state.raf = requestAnimationFrame(render);
    if (!state.running) return;

    if (isVideoModalOpen()) {
      cursor.classList.add('is-hidden');
      state.points.length = 0;
      trailContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
      return;
    }

    const ease = state.mode === 'video' ? 0.19 : 0.23;
    state.currentX += (state.targetX - state.currentX) * ease;
    state.currentY += (state.targetY - state.currentY) * ease;

    if (state.visible) cursor.classList.remove('is-hidden');
    cursor.style.transform = `translate3d(${state.currentX}px, ${state.currentY}px, 0)`;
    pushTrailPoint();
    drawTrail(trailContext, state.points, state.mode, state.visible);
  };

  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('resize', () => resizeCanvas(trailCanvas, trailContext), { passive: true });
  document.addEventListener('pointerover', updateMode, { passive: true });
  document.addEventListener('mouseleave', leaveWindow, { passive: true });
  document.addEventListener('mouseenter', enterWindow, { passive: true });
  document.addEventListener('visibilitychange', () => {
    state.running = document.visibilityState === 'visible';
    if (!state.running) trailContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
  });

  state.raf = requestAnimationFrame(render);
}
