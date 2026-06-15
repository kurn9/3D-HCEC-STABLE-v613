const ENABLE_WEBGL_LIQUID_CURSOR = true;
const MIN_CURSOR_WIDTH = 820;
const DPR_CAP = 1.25;
const MAX_CANVAS_PIXELS = 3_200_000;
const TRAIL_RESOLUTION_SCALE = 0.5;
const RESIZE_DEBOUNCE_MS = 120;
const IDLE_RENDER_MS = 1300;
const CLICK_PULSE_MS = 420;
const MAX_FRAME_DELTA_MS = 50;
const DEFAULT_MAX_FPS = 60;
const ULTRAWIDE_MAX_FPS = 45;
const ULTRAWIDE_MIN_WIDTH = 2560;
const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  '[role="button"]',
  'input',
  'select',
  'textarea',
  '[data-cursor="interactive"]',
  '[data-featured-interactive]',
  '[data-featured-dot]',
  '[data-close-intro-video]'
].join(', ');

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = position * 0.5;
  gl_Position = vec4(position - 1.0, 0.0, 1.0);
}`;

const TRAIL_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTrailTexture;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform vec2 uPrevMouse;
uniform vec2 uVelocity;
uniform float uTime;
uniform float uDelta;
uniform float uIntensity;
uniform float uRadius;
uniform float uHover;
uniform float uClick;
out vec4 outColor;

float segmentDistance(vec2 point, vec2 startPoint, vec2 endPoint) {
  vec2 segment = endPoint - startPoint;
  float segmentLength = max(dot(segment, segment), 0.000001);
  float projection = clamp(dot(point - startPoint, segment) / segmentLength, 0.0, 1.0);
  return length(point - (startPoint + segment * projection));
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 aspectScale = vec2(aspect, 1.0);
  vec2 flowOffset = clamp(uVelocity, vec2(-0.025), vec2(0.025)) * (0.34 + uHover * 0.08);
  vec4 previous = texture(uTrailTexture, clamp(vUv - flowOffset, 0.0, 1.0));

  float decay = exp(-uDelta * mix(2.45, 1.85, uHover));
  float density = previous.r * decay;
  vec2 previousFlow = previous.gb * 2.0 - 1.0;

  vec2 point = vUv * aspectScale;
  vec2 mouse = uMouse * aspectScale;
  vec2 previousMouse = uPrevMouse * aspectScale;
  float radius = uRadius;
  float distanceToStroke = segmentDistance(point, previousMouse, mouse);
  float speed = clamp(length(uVelocity) * uResolution.y * 0.11, 0.0, 1.0);
  float splat = 1.0 - smoothstep(radius * 0.16, radius, distanceToStroke);
  float liquidBody = splat * uIntensity * (0.64 + speed * 0.58 + uHover * 0.16);

  float clickProgress = 1.0 - uClick;
  float rippleRadius = radius * mix(0.8, 3.2, clickProgress);
  float rippleWidth = radius * 0.34;
  float cursorDistance = length(point - mouse);
  float ripple = (1.0 - smoothstep(0.0, rippleWidth, abs(cursorDistance - rippleRadius))) * uClick * 0.72;

  density = clamp(max(density, liquidBody) + ripple, 0.0, 1.0);

  vec2 movementDirection = length(uVelocity) > 0.00001 ? normalize(uVelocity) : vec2(0.0);
  float flowMix = clamp(splat * (0.16 + speed * 0.44), 0.0, 0.64);
  vec2 flow = mix(previousFlow * decay, movementDirection, flowMix);

  outColor = vec4(density, flow * 0.5 + 0.5, max(previous.a * decay, ripple));
}`;

const DISPLAY_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTrailTexture;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform vec2 uVelocity;
uniform float uTime;
uniform float uIntensity;
uniform float uRadius;
uniform float uHover;
uniform float uClick;
out vec4 outColor;

void main() {
  vec2 texel = 1.0 / max(uResolution, vec2(1.0));
  vec4 center = texture(uTrailTexture, vUv);
  float left = texture(uTrailTexture, vUv - vec2(texel.x, 0.0)).r;
  float right = texture(uTrailTexture, vUv + vec2(texel.x, 0.0)).r;
  float down = texture(uTrailTexture, vUv - vec2(0.0, texel.y)).r;
  float up = texture(uTrailTexture, vUv + vec2(0.0, texel.y)).r;

  vec2 gradient = vec2(right - left, up - down);
  float edge = clamp(length(gradient) * 7.5, 0.0, 1.0);
  float density = smoothstep(0.025, 0.82, center.r);
  vec2 flow = center.gb * 2.0 - 1.0;

  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 point = vUv * vec2(aspect, 1.0);
  vec2 mouse = uMouse * vec2(aspect, 1.0);
  float coreDistance = length(point - mouse);
  float coreRadius = uRadius * (0.72 + uHover * 0.18);
  float core = 1.0 - smoothstep(coreRadius * 0.12, coreRadius, coreDistance);
  float halo = (1.0 - smoothstep(coreRadius * 0.45, coreRadius * 2.3, coreDistance)) * 0.22;

  float shimmer = 0.5 + 0.5 * sin(uTime * 1.35 + dot(flow, vec2(5.1, 3.7)));
  vec3 ivory = vec3(0.969, 0.949, 0.875);
  vec3 bronze = vec3(0.910, 0.706, 0.337);
  vec3 cool = vec3(0.560, 0.790, 0.890);
  vec3 liquidColor = mix(ivory, bronze, clamp(density * 0.68 + uHover * 0.16, 0.0, 0.82));
  liquidColor = mix(liquidColor, cool, clamp(abs(flow.y) * 0.10 + shimmer * 0.035, 0.0, 0.12));
  liquidColor += edge * vec3(0.14, 0.12, 0.08);

  float pulse = center.a * (0.14 + uClick * 0.10);
  float alpha = clamp(density * 0.24 + edge * 0.15 + core * 0.72 + halo + pulse, 0.0, 0.78);
  alpha *= mix(0.86, 1.0, uIntensity);

  outColor = vec4(liquidColor, alpha);
}`;

let destroyActiveWebglCursor = null;

function addMediaQueryChangeListener(query, listener) {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }
  query.addListener?.(listener);
  return () => query.removeListener?.(listener);
}

function hasKillSwitch() {
  try {
    return new URLSearchParams(window.location.search).get('noLiquidCursor') === '1';
  } catch {
    return false;
  }
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Không thể tạo WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Shader compile thất bại.';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('Không thể tạo WebGL program.');

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'WebGL program link thất bại.';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function getUniformLocations(gl, program, names) {
  return names.reduce((locations, name) => {
    locations[name] = gl.getUniformLocation(program, name);
    return locations;
  }, {});
}

function createTrailTarget(gl, width, height) {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) throw new Error('Không thể tạo trail framebuffer.');

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    throw new Error('Trail framebuffer không hoàn chỉnh.');
  }

  gl.clearColor(0, 0.5, 0.5, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { texture, framebuffer, width, height };
}

function deleteTrailTarget(gl, target) {
  if (!target) return;
  try {
    if (target.framebuffer) gl.deleteFramebuffer(target.framebuffer);
    if (target.texture) gl.deleteTexture(target.texture);
  } catch {
    // Context loss can make deletion unavailable. Removing the canvas remains the safe fallback.
  }
}

function createCursorCanvas() {
  const canvas = document.createElement('canvas');
  canvas.id = 'webglLiquidCursor';
  canvas.className = 'webgl-liquid-cursor';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'presentation');
  document.body.appendChild(canvas);
  return canvas;
}

function getInteractiveStrength(target) {
  if (!(target instanceof Element)) return 0;
  if (target.closest('.hero-video-card, [data-intro-video-open]')) return 1;
  return target.closest(INTERACTIVE_SELECTOR) ? 0.72 : 0;
}

function isVideoModalOpen() {
  return document.body.classList.contains('is-video-modal-open');
}

export function initWebglLiquidCursor({ onFallback } = {}) {
  destroyActiveWebglCursor?.();

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
  const desktopWidthQuery = window.matchMedia(`(min-width: ${MIN_CURSOR_WIDTH}px)`);

  if (!ENABLE_WEBGL_LIQUID_CURSOR || hasKillSwitch() || reducedMotionQuery.matches || !finePointerQuery.matches || !desktopWidthQuery.matches) {
    return null;
  }

  const canvas = createCursorCanvas();
  let gl = null;
  let trailProgram = null;
  let displayProgram = null;
  let trailUniforms = null;
  let displayUniforms = null;
  let vertexArray = null;
  let trailTargets = [];
  let readTargetIndex = 0;
  let resizeTimer = 0;
  let modalObserver = null;
  let fallbackTriggered = false;
  let resourcesDisposed = false;
  let publicController = null;
  let removeReducedMotionListener = () => {};
  let removeFinePointerListener = () => {};
  let removeDesktopWidthListener = () => {};

  const state = {
    destroyed: false,
    contextLost: false,
    pointerReady: false,
    pointerInside: false,
    pointerType: '',
    mouseX: 0.5,
    mouseY: 0.5,
    previousMouseX: 0.5,
    previousMouseY: 0.5,
    velocityX: 0,
    velocityY: 0,
    hover: 0,
    targetHover: 0,
    click: 0,
    clickStartedAt: 0,
    lastPointerAt: 0,
    lastFrameAt: 0,
    rafId: 0,
    canvasWidth: 1,
    canvasHeight: 1,
    trailWidth: 1,
    trailHeight: 1,
    effectiveDpr: 1,
    firstFrameRendered: false,
    pausedByModal: false
  };

  const canUseCursor = () => !state.destroyed
    && !state.contextLost
    && document.visibilityState === 'visible'
    && !reducedMotionQuery.matches
    && finePointerQuery.matches
    && desktopWidthQuery.matches
    && !state.pausedByModal
    && state.pointerReady
    && state.pointerInside
    && (state.pointerType === 'mouse' || state.pointerType === 'pen' || state.pointerType === '');

  const removeReadyState = () => {
    document.body.classList.remove('has-webgl-liquid-cursor');
    canvas.classList.remove('is-ready');
  };

  const clearDefaultFramebuffer = () => {
    if (!gl || state.contextLost) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, state.canvasWidth, state.canvasHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const stopLoop = ({ hide = false } = {}) => {
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    state.lastFrameAt = 0;
    if (hide) {
      removeReadyState();
      clearDefaultFramebuffer();
    }
  };

  const disposeResources = () => {
    if (resourcesDisposed) return;
    resourcesDisposed = true;
    try {
      trailTargets.forEach((target) => deleteTrailTarget(gl, target));
      trailTargets = [];
      if (trailProgram) gl?.deleteProgram(trailProgram);
      if (displayProgram) gl?.deleteProgram(displayProgram);
      if (vertexArray) gl?.deleteVertexArray(vertexArray);
    } catch {
      // Context loss is already handled by removing the canvas and restoring the native cursor.
    }
    trailProgram = null;
    displayProgram = null;
    vertexArray = null;
  };

  const detachListeners = () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerdown', handlePointerDown);
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('blur', handleWindowBlur);
    document.removeEventListener('pointerover', handlePointerOver);
    document.removeEventListener('mouseleave', handlePointerLeave);
    document.removeEventListener('mouseenter', handlePointerEnter);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    canvas.removeEventListener('webglcontextlost', handleContextLost);
    removeReducedMotionListener?.();
    removeFinePointerListener?.();
    removeDesktopWidthListener?.();
    modalObserver?.disconnect();
    modalObserver = null;
    if (resizeTimer) {
      window.clearTimeout(resizeTimer);
      resizeTimer = 0;
    }
  };

  const destroy = ({ fallback = false } = {}) => {
    if (state.destroyed) return;
    state.destroyed = true;
    stopLoop({ hide: true });
    detachListeners();
    disposeResources();
    canvas.remove();
    if (publicController && destroyActiveWebglCursor === publicController.destroy) destroyActiveWebglCursor = null;

    if (fallback && !fallbackTriggered) {
      fallbackTriggered = true;
      queueMicrotask(() => {
        try {
          onFallback?.();
        } catch {
          // A fallback failure must never block the index page.
        }
      });
    }
  };

  const failToLegacy = (reason) => {
    if (!state.destroyed && reason) console.warn(`[Index cursor] WebGL disabled: ${reason}`);
    destroy({ fallback: true });
  };

  const getEffectiveDpr = () => {
    const viewportPixels = Math.max(1, window.innerWidth * window.innerHeight);
    const requestedDpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const budgetDpr = Math.sqrt(MAX_CANVAS_PIXELS / viewportPixels);
    return Math.max(0.72, Math.min(requestedDpr, budgetDpr));
  };

  const recreateTrailTargets = () => {
    const nextTargets = [];
    try {
      nextTargets.push(createTrailTarget(gl, state.trailWidth, state.trailHeight));
      nextTargets.push(createTrailTarget(gl, state.trailWidth, state.trailHeight));
    } catch (error) {
      nextTargets.forEach((target) => deleteTrailTarget(gl, target));
      throw error;
    }

    trailTargets.forEach((target) => deleteTrailTarget(gl, target));
    trailTargets = nextTargets;
    readTargetIndex = 0;
  };

  const resizeRenderer = () => {
    if (!gl || state.destroyed || state.contextLost) return;
    state.effectiveDpr = getEffectiveDpr();
    state.canvasWidth = Math.max(1, Math.round(window.innerWidth * state.effectiveDpr));
    state.canvasHeight = Math.max(1, Math.round(window.innerHeight * state.effectiveDpr));
    state.trailWidth = Math.max(128, Math.round(state.canvasWidth * TRAIL_RESOLUTION_SCALE));
    state.trailHeight = Math.max(128, Math.round(state.canvasHeight * TRAIL_RESOLUTION_SCALE));

    canvas.width = state.canvasWidth;
    canvas.height = state.canvasHeight;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    recreateTrailTargets();
    clearDefaultFramebuffer();
  };

  const setCommonTrailUniforms = (deltaSeconds, elapsedSeconds) => {
    gl.uniform2f(trailUniforms.uResolution, state.trailWidth, state.trailHeight);
    gl.uniform2f(trailUniforms.uMouse, state.mouseX, state.mouseY);
    gl.uniform2f(trailUniforms.uPrevMouse, state.previousMouseX, state.previousMouseY);
    gl.uniform2f(trailUniforms.uVelocity, state.velocityX, state.velocityY);
    gl.uniform1f(trailUniforms.uTime, elapsedSeconds);
    gl.uniform1f(trailUniforms.uDelta, deltaSeconds);
    gl.uniform1f(trailUniforms.uIntensity, 0.78 + state.hover * 0.16);
    gl.uniform1f(trailUniforms.uRadius, (19 + state.hover * 10 + state.click * 3) / Math.max(1, window.innerHeight));
    gl.uniform1f(trailUniforms.uHover, state.hover);
    gl.uniform1f(trailUniforms.uClick, state.click);
  };

  const updateTrail = (deltaSeconds, elapsedSeconds) => {
    const readTarget = trailTargets[readTargetIndex];
    const writeTarget = trailTargets[1 - readTargetIndex];
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget.framebuffer);
    gl.viewport(0, 0, state.trailWidth, state.trailHeight);
    gl.useProgram(trailProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTarget.texture);
    gl.uniform1i(trailUniforms.uTrailTexture, 0);
    setCommonTrailUniforms(deltaSeconds, elapsedSeconds);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    readTargetIndex = 1 - readTargetIndex;
  };

  const displayTrail = (elapsedSeconds) => {
    const readTarget = trailTargets[readTargetIndex];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, state.canvasWidth, state.canvasHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(displayProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTarget.texture);
    gl.uniform1i(displayUniforms.uTrailTexture, 0);
    gl.uniform2f(displayUniforms.uResolution, state.canvasWidth, state.canvasHeight);
    gl.uniform2f(displayUniforms.uMouse, state.mouseX, state.mouseY);
    gl.uniform2f(displayUniforms.uVelocity, state.velocityX, state.velocityY);
    gl.uniform1f(displayUniforms.uTime, elapsedSeconds);
    gl.uniform1f(displayUniforms.uIntensity, 0.82 + state.hover * 0.14);
    gl.uniform1f(displayUniforms.uRadius, (19 + state.hover * 10 + state.click * 3) / Math.max(1, window.innerHeight));
    gl.uniform1f(displayUniforms.uHover, state.hover);
    gl.uniform1f(displayUniforms.uClick, state.click);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const revealRenderedFrame = () => {
    if (!state.firstFrameRendered) {
      if (gl.getError() !== gl.NO_ERROR) {
        failToLegacy('first-frame-error');
        return false;
      }
      state.firstFrameRendered = true;
    }
    canvas.classList.add('is-ready');
    document.body.classList.add('has-webgl-liquid-cursor');
    return true;
  };

  const render = (timestamp) => {
    state.rafId = 0;
    if (!canUseCursor()) {
      stopLoop({ hide: true });
      return;
    }

    const rawDelta = state.lastFrameAt ? timestamp - state.lastFrameAt : 16.67;
    const maxFps = window.innerWidth >= ULTRAWIDE_MIN_WIDTH ? ULTRAWIDE_MAX_FPS : DEFAULT_MAX_FPS;
    const minimumFrameInterval = 1000 / maxFps;
    if (state.lastFrameAt && rawDelta < minimumFrameInterval - 0.5) {
      state.rafId = window.requestAnimationFrame(render);
      return;
    }

    const deltaMs = Math.min(MAX_FRAME_DELTA_MS, Math.max(1, rawDelta));
    state.lastFrameAt = timestamp;
    const deltaSeconds = deltaMs / 1000;
    const elapsedSeconds = timestamp / 1000;

    const hoverFollow = 1 - Math.exp(-deltaMs / 70);
    state.hover += (state.targetHover - state.hover) * hoverFollow;
    state.click = state.clickStartedAt
      ? Math.max(0, 1 - (timestamp - state.clickStartedAt) / CLICK_PULSE_MS)
      : 0;

    try {
      updateTrail(deltaSeconds, elapsedSeconds);
      displayTrail(elapsedSeconds);
      if (!revealRenderedFrame()) return;
    } catch {
      failToLegacy('render-error');
      return;
    }

    state.previousMouseX = state.mouseX;
    state.previousMouseY = state.mouseY;
    state.velocityX *= Math.exp(-deltaMs / 54);
    state.velocityY *= Math.exp(-deltaMs / 54);

    const shouldKeepAnimating = timestamp - state.lastPointerAt < IDLE_RENDER_MS || state.click > 0.001 || Math.abs(state.hover - state.targetHover) > 0.01;
    if (shouldKeepAnimating) state.rafId = window.requestAnimationFrame(render);
  };

  const startLoop = () => {
    if (!canUseCursor() || state.rafId) return;
    state.lastFrameAt = 0;
    state.rafId = window.requestAnimationFrame(render);
  };

  function handlePointerMove(event) {
    state.pointerType = event.pointerType || 'mouse';
    if (state.pointerType === 'touch') {
      state.pointerInside = false;
      stopLoop({ hide: true });
      return;
    }

    const nextX = Math.min(1, Math.max(0, event.clientX / Math.max(1, window.innerWidth)));
    const nextY = Math.min(1, Math.max(0, 1 - event.clientY / Math.max(1, window.innerHeight)));
    if (!state.pointerReady || Math.hypot(nextX - state.mouseX, nextY - state.mouseY) > 0.28) {
      state.previousMouseX = nextX;
      state.previousMouseY = nextY;
    }

    state.velocityX = nextX - state.mouseX;
    state.velocityY = nextY - state.mouseY;
    state.mouseX = nextX;
    state.mouseY = nextY;
    state.pointerReady = true;
    state.pointerInside = true;
    state.targetHover = getInteractiveStrength(event.target);
    state.lastPointerAt = performance.now();
    startLoop();
  }

  function handlePointerOver(event) {
    if ((event.pointerType || state.pointerType || 'mouse') === 'touch') return;
    state.targetHover = getInteractiveStrength(event.target);
    state.lastPointerAt = performance.now();
    startLoop();
  }

  function handlePointerDown(event) {
    if (event.pointerType === 'touch' || !canUseCursor()) return;
    state.clickStartedAt = performance.now();
    state.click = 1;
    state.lastPointerAt = state.clickStartedAt;
    startLoop();
  }

  function handlePointerLeave() {
    state.pointerInside = false;
    stopLoop({ hide: true });
  }

  function handlePointerEnter() {
    if (!state.pointerReady || state.pointerType === 'touch') return;
    state.pointerInside = true;
    state.lastPointerAt = performance.now();
    startLoop();
  }

  function handleWindowBlur() {
    stopLoop({ hide: true });
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') {
      stopLoop({ hide: true });
      return;
    }
    state.lastPointerAt = performance.now();
    startLoop();
  }

  function handleResize() {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = 0;
      try {
        resizeRenderer();
        state.previousMouseX = state.mouseX;
        state.previousMouseY = state.mouseY;
        state.lastPointerAt = performance.now();
        startLoop();
      } catch {
        failToLegacy('resize-error');
      }
    }, RESIZE_DEBOUNCE_MS);
  }

  function handleCapabilityChange() {
    if (reducedMotionQuery.matches || !finePointerQuery.matches || !desktopWidthQuery.matches) {
      failToLegacy('capability-change');
      return;
    }
    startLoop();
  }

  function handleContextLost(event) {
    event.preventDefault();
    state.contextLost = true;
    failToLegacy('context-lost');
  }

  try {
    gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      desynchronized: true
    });
    if (!gl) throw new Error('WebGL2 unavailable.');

    trailProgram = createProgram(gl, VERTEX_SHADER_SOURCE, TRAIL_FRAGMENT_SHADER_SOURCE);
    displayProgram = createProgram(gl, VERTEX_SHADER_SOURCE, DISPLAY_FRAGMENT_SHADER_SOURCE);
    vertexArray = gl.createVertexArray();
    if (!vertexArray) throw new Error('Không thể tạo WebGL vertex array.');
    gl.bindVertexArray(vertexArray);

    trailUniforms = getUniformLocations(gl, trailProgram, [
      'uTrailTexture', 'uResolution', 'uMouse', 'uPrevMouse', 'uVelocity',
      'uTime', 'uDelta', 'uIntensity', 'uRadius', 'uHover', 'uClick'
    ]);
    displayUniforms = getUniformLocations(gl, displayProgram, [
      'uTrailTexture', 'uResolution', 'uMouse', 'uVelocity',
      'uTime', 'uIntensity', 'uRadius', 'uHover', 'uClick'
    ]);
    resizeRenderer();
  } catch {
    state.destroyed = true;
    disposeResources();
    canvas.remove();
    return null;
  }

  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  window.addEventListener('pointerdown', handlePointerDown, { passive: true });
  window.addEventListener('resize', handleResize, { passive: true });
  window.addEventListener('blur', handleWindowBlur, { passive: true });
  document.addEventListener('pointerover', handlePointerOver, { passive: true });
  document.addEventListener('mouseleave', handlePointerLeave, { passive: true });
  document.addEventListener('mouseenter', handlePointerEnter, { passive: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  canvas.addEventListener('webglcontextlost', handleContextLost, false);

  removeReducedMotionListener = addMediaQueryChangeListener(reducedMotionQuery, handleCapabilityChange);
  removeFinePointerListener = addMediaQueryChangeListener(finePointerQuery, handleCapabilityChange);
  removeDesktopWidthListener = addMediaQueryChangeListener(desktopWidthQuery, handleCapabilityChange);

  let previousModalState = isVideoModalOpen();
  modalObserver = new MutationObserver(() => {
    const modalOpen = isVideoModalOpen();
    if (modalOpen === previousModalState) return;
    previousModalState = modalOpen;
    state.pausedByModal = modalOpen;
    if (modalOpen) {
      stopLoop({ hide: true });
    } else {
      state.previousMouseX = state.mouseX;
      state.previousMouseY = state.mouseY;
      state.lastPointerAt = performance.now();
      startLoop();
    }
  });
  modalObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  publicController = {
    supported: true,
    get isActive() {
      return state.firstFrameRendered && document.body.classList.contains('has-webgl-liquid-cursor');
    },
    pause() {
      state.pausedByModal = true;
      stopLoop({ hide: true });
    },
    resume() {
      state.pausedByModal = false;
      state.previousMouseX = state.mouseX;
      state.previousMouseY = state.mouseY;
      state.lastPointerAt = performance.now();
      startLoop();
    },
    destroy() {
      destroy({ fallback: false });
    }
  };

  destroyActiveWebglCursor = publicController.destroy;
  return publicController;
}
