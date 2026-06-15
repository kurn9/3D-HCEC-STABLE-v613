const ENABLE_WEBGL_LIQUID_CURSOR = true;
const MIN_CURSOR_WIDTH = 820;
const DPR_CAP = 1.25;
const MAX_CANVAS_PIXELS = 3_200_000;
const TRAIL_RESOLUTION_SCALE = 0.5;
const RESIZE_DEBOUNCE_MS = 120;
const IDLE_RENDER_MS = 1600;
const CLICK_PULSE_MS = 420;
const MAX_FRAME_DELTA_MS = 50;
const DEFAULT_MAX_FPS = 60;
const ULTRAWIDE_MAX_FPS = 45;
const ULTRAWIDE_MIN_WIDTH = 2560;
const DEBUG_UPDATE_INTERVAL_MS = 200;
const NORMAL_SAFETY_PROBE_INTERVAL_MS = 1000;
const READY_BG_ALPHA_WARNING = 0.03;
const READY_BG_ALPHA_FAIL = 0.08;
const READY_CURSOR_ALPHA_MIN = 0.06;
const READY_SAFE_SAMPLE_COUNT = 2;
const READY_MAX_PROBE_ATTEMPTS = 8;

// v6.14.031 — Balanced C+ visual tune. Performance budgets remain unchanged.
const BASE_RADIUS_PX = 22;
const HOVER_RADIUS_BOOST_PX = 13;
const CLICK_RADIUS_BOOST_PX = 3;
const TRAIL_BASE_INTENSITY = 0.88;
const TRAIL_HOVER_INTENSITY = 0.18;
const DISPLAY_BASE_INTENSITY = 0.92;
const DISPLAY_HOVER_INTENSITY = 0.12;
const VELOCITY_DAMPING_TAU_MS = 72;
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

const float PI = 3.141592653589793;

float segmentDistance(vec2 point, vec2 startPoint, vec2 endPoint) {
  vec2 segment = endPoint - startPoint;
  float segmentLength = max(dot(segment, segment), 0.000001);
  float projection = clamp(dot(point - startPoint, segment) / segmentLength, 0.0, 1.0);
  return length(point - (startPoint + segment * projection));
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 aspectScale = vec2(aspect, 1.0);
  vec2 velocityAspect = uVelocity * aspectScale;
  float velocityLength = length(velocityAspect);
  float speed = clamp(velocityLength * uResolution.y * 0.09, 0.0, 1.0);
  vec2 movementDirection = velocityLength > 0.000001
    ? normalize(velocityAspect)
    : vec2(cos(uTime * 0.37), sin(uTime * 0.31));
  vec2 movementNormal = vec2(-movementDirection.y, movementDirection.x);

  vec4 seed = texture(uTrailTexture, vUv);
  vec2 seedFlow = seed.gb * 2.0 - 1.0;
  vec2 flowUv = seedFlow * vec2(1.0 / max(aspect, 0.0001), 1.0);
  vec2 velocityOffset = clamp(uVelocity, vec2(-0.035), vec2(0.035)) * (0.44 + uHover * 0.10);
  vec2 internalOffset = flowUv * (0.0024 + speed * 0.0018);
  vec4 previous = texture(uTrailTexture, clamp(vUv - velocityOffset - internalOffset, 0.0, 1.0));

  float decay = exp(-uDelta * mix(1.55, 1.25, uHover));
  float density = previous.r * decay;
  vec2 previousFlow = previous.gb * 2.0 - 1.0;

  vec2 point = vUv * aspectScale;
  vec2 mouse = uMouse * aspectScale;
  vec2 previousMouse = uPrevMouse * aspectScale;
  float radius = uRadius;

  float temporalWobble = sin(uTime * 3.1 + dot(point, vec2(13.0, 9.0)))
    * radius * (0.045 + uHover * 0.035);
  vec2 liquidMouse = mouse + movementNormal * temporalWobble;
  float distanceToStroke = segmentDistance(point, previousMouse, liquidMouse);
  float stroke = 1.0 - smoothstep(
    radius * 0.12,
    radius * (1.04 + speed * 0.48),
    distanceToStroke
  );

  vec2 local = point - mouse;
  float along = dot(local, movementDirection);
  float across = dot(local, movementNormal);
  float bodyDistance = length(vec2(
    along / (1.0 + speed * 0.95 + uHover * 0.10),
    across / (0.78 + uHover * 0.10)
  ));
  float angle = atan(local.y, local.x);
  float edgeWarp = 1.0
    + sin(angle * 3.0 + uTime * 1.85) * 0.075
    + sin(angle * 2.0 - uTime * 1.17) * uHover * 0.055;
  float body = 1.0 - smoothstep(radius * 0.16, radius * edgeWarp, bodyDistance);

  float lobeOffset = radius * (0.20 + uHover * 0.24);
  vec2 lobeCenterA = mouse + movementNormal * lobeOffset;
  vec2 lobeCenterB = mouse - movementNormal * lobeOffset * 0.72;
  float lobeA = 1.0 - smoothstep(radius * 0.12, radius * 0.82, length(point - lobeCenterA));
  float lobeB = 1.0 - smoothstep(radius * 0.12, radius * 0.74, length(point - lobeCenterB));
  float hoverLobes = max(lobeA, lobeB) * uHover;

  float splat = max(stroke, max(body * 0.92, hoverLobes * 0.84));
  float liquidBody = splat * uIntensity * (0.78 + speed * 0.64 + uHover * 0.20);
  float accumulation = liquidBody * max(0.40, 0.82 - density * 0.42);
  density = clamp(density + accumulation, 0.0, 1.0);

  float clickAge = clamp(1.0 - uClick, 0.0, 1.0);
  float rippleRadius = radius * mix(0.90, 3.45, clickAge);
  float rippleWidth = radius * mix(0.30, 0.14, clickAge);
  float cursorDistance = length(point - mouse);
  float rippleEnvelope = sin(clickAge * PI);
  float ripple = (1.0 - smoothstep(0.0, rippleWidth, abs(cursorDistance - rippleRadius)))
    * rippleEnvelope * 0.56;
  density = clamp(density + ripple * max(0.42, 0.66 - density * 0.26), 0.0, 1.0);

  vec2 injectedFlow = movementDirection
    + movementNormal * sin(uTime * 2.2 + angle * 2.0) * (0.07 + uHover * 0.09);
  injectedFlow = length(injectedFlow) > 0.000001 ? normalize(injectedFlow) : movementDirection;
  float flowMix = clamp(splat * (0.28 + speed * 0.52 + uHover * 0.10), 0.0, 0.82);
  vec2 flow = mix(previousFlow * decay, injectedFlow, flowMix);

  float rippleMemory = previous.a * exp(-uDelta * 3.8);
  outColor = vec4(density, flow * 0.5 + 0.5, max(rippleMemory, ripple * 0.55));
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

const float PI = 3.141592653589793;

float liquidBlob(vec2 local, vec2 axis, float radius, float hoverAmount, float time) {
  vec2 normal = vec2(-axis.y, axis.x);
  float along = dot(local, axis);
  float across = dot(local, normal);
  float angle = atan(local.y, local.x);
  float edgeWarp = 1.0
    + sin(angle * 3.0 + time * 1.72) * 0.10
    + sin(angle * 2.0 - time * 1.08) * hoverAmount * 0.075;
  float shapedDistance = length(vec2(
    along / (1.04 + hoverAmount * 0.20),
    across / (0.90 - hoverAmount * 0.06)
  ));
  return 1.0 - smoothstep(radius * 0.18, radius * edgeWarp, shapedDistance);
}

void main() {
  vec2 texel = 1.0 / max(uResolution, vec2(1.0));
  vec4 center = texture(uTrailTexture, vUv);
  float left = texture(uTrailTexture, vUv - vec2(texel.x, 0.0)).r;
  float right = texture(uTrailTexture, vUv + vec2(texel.x, 0.0)).r;
  float down = texture(uTrailTexture, vUv - vec2(0.0, texel.y)).r;
  float up = texture(uTrailTexture, vUv + vec2(0.0, texel.y)).r;

  vec2 gradient = vec2(right - left, up - down);
  float laplacian = abs(left + right + up + down - center.r * 4.0);
  float edge = clamp(length(gradient) * 8.2 + laplacian * 2.2, 0.0, 1.0);
  float density = smoothstep(0.018, 0.72, center.r);
  vec2 flow = center.gb * 2.0 - 1.0;

  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 aspectScale = vec2(aspect, 1.0);
  vec2 point = vUv * aspectScale;
  vec2 mouse = uMouse * aspectScale;
  vec2 local = point - mouse;
  vec2 velocityAspect = uVelocity * aspectScale;
  float velocityLength = length(velocityAspect);
  vec2 axis = velocityLength > 0.000001
    ? normalize(velocityAspect)
    : vec2(cos(uTime * 0.42), sin(uTime * 0.34));
  vec2 normal = vec2(-axis.y, axis.x);

  float coreRadius = uRadius * (0.84 + uHover * 0.30);
  float core = liquidBlob(local, axis, coreRadius, uHover, uTime);
  float lobeOffset = coreRadius * 0.27 * uHover;
  float lobeA = liquidBlob(local - normal * lobeOffset, axis, coreRadius * 0.79, uHover, uTime + 0.7);
  float lobeB = liquidBlob(local + normal * lobeOffset * 0.72, axis, coreRadius * 0.72, uHover, uTime - 0.5);
  core = max(core * (1.0 - uHover * 0.14), max(lobeA, lobeB) * uHover * 0.92);

  float coreDistance = length(local);
  float halo = (1.0 - smoothstep(coreRadius * 0.58, coreRadius * 2.05, coreDistance)) * 0.08;
  float clickAge = clamp(1.0 - uClick, 0.0, 1.0);
  float clickEnvelope = sin(clickAge * PI);
  float ringRadius = coreRadius * mix(0.92, 3.25, clickAge);
  float ringWidth = coreRadius * mix(0.25, 0.11, clickAge);
  float clickRing = (1.0 - smoothstep(0.0, ringWidth, abs(coreDistance - ringRadius)))
    * clickEnvelope;

  float shimmer = 0.5 + 0.5 * sin(uTime * 1.22 + dot(flow, vec2(5.4, 3.9)));
  vec3 ivory = vec3(0.969, 0.949, 0.875);
  vec3 bronze = vec3(0.910, 0.706, 0.337);
  vec3 cool = vec3(0.500, 0.735, 0.820);
  vec3 liquidColor = mix(ivory, bronze, clamp(density * 0.58 + uHover * 0.15, 0.0, 0.78));
  liquidColor = mix(liquidColor, cool, clamp(length(flow) * 0.075 + shimmer * 0.028, 0.0, 0.10));
  liquidColor += edge * vec3(0.085, 0.074, 0.052);
  vec3 ringColor = mix(ivory, bronze, 0.48);
  liquidColor = mix(liquidColor, ringColor, clickRing * 0.16);

  float storedRipple = center.a * (0.08 + uClick * 0.04);
  float trailAlpha = density * 0.33 + edge * 0.16;
  float coreAlpha = core * 0.40 + halo;
  float rippleAlpha = clickRing * 0.20 + storedRipple;
  float alpha = clamp(trailAlpha + coreAlpha + rippleAlpha, 0.0, 0.62);
  alpha *= mix(0.90, 1.02, clamp(uIntensity, 0.0, 1.2));

  // The default framebuffer is composited as premultiplied alpha.
  // Writing premultiplied RGB keeps every zero-alpha pixel truly transparent.
  outColor = vec4(liquidColor * alpha, alpha);
}`;

let destroyActiveWebglCursor = null;
let destroyActiveDebugOverlay = null;

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

function hasDebugSwitch() {
  try {
    return new URLSearchParams(window.location.search).get('debugLiquidCursor') === '1';
  } catch {
    return false;
  }
}

function createDebugOverlay() {
  if (!hasDebugSwitch()) return null;
  destroyActiveDebugOverlay?.();

  const element = document.createElement('pre');
  element.className = 'liquid-cursor-debug-overlay';
  element.setAttribute('aria-hidden', 'true');
  element.dataset.liquidCursorDebug = '1';
  document.body.appendChild(element);

  let destroyed = false;
  const metrics = {
    webgl: 'OFF',
    reason: 'initializing',
    mode: 'disabled',
    ready: 'no',
    firstFrame: 'no',
    cursorHidden: 'no',
    contextLost: 'no',
    dpr: '-',
    canvas: '-',
    fbo: '-',
    fps: '0',
    alphaBg: '-',
    alphaCursor: '-',
    cssOpacity: '-',
    premultiplied: '-',
    blend: '-',
    mouseIn: 'no',
    hover: '0.00',
    click: '0.00',
    fallback: 'no',
    shaders: 'pending'
  };

  const render = () => {
    if (destroyed) return;
    element.textContent = [
      `WEBGL: ${metrics.webgl}`,
      `REASON: ${metrics.reason}`,
      `MODE: ${metrics.mode}`,
      `READY: ${metrics.ready}`,
      `FIRST_FRAME: ${metrics.firstFrame}`,
      `CURSOR_HIDDEN: ${metrics.cursorHidden}`,
      `CONTEXT_LOST: ${metrics.contextLost}`,
      `SHADERS: ${metrics.shaders}`,
      `DPR: ${metrics.dpr}`,
      `CANVAS: ${metrics.canvas}`,
      `FBO: ${metrics.fbo}`,
      `FPS: ${metrics.fps}`,
      `ALPHA_BG: ${metrics.alphaBg}`,
      `ALPHA_CURSOR: ${metrics.alphaCursor}`,
      `CSS_OPACITY: ${metrics.cssOpacity}`,
      `PREMULTIPLIED: ${metrics.premultiplied}`,
      `BLEND: ${metrics.blend}`,
      `MOUSE_IN: ${metrics.mouseIn}`,
      `HOVER: ${metrics.hover}`,
      `CLICK: ${metrics.click}`,
      `FALLBACK: ${metrics.fallback}`
    ].join('\n');
  };

  const update = (patch = {}) => {
    if (destroyed) return;
    Object.assign(metrics, patch);
    render();
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener('pagehide', destroy);
    element.remove();
    if (destroyActiveDebugOverlay === destroy) destroyActiveDebugOverlay = null;
  };

  window.addEventListener('pagehide', destroy, { once: true });
  destroyActiveDebugOverlay = destroy;
  render();
  return { update, destroy };
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
  destroyActiveDebugOverlay?.();

  const debugOverlay = createDebugOverlay();
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
  const desktopWidthQuery = window.matchMedia(`(min-width: ${MIN_CURSOR_WIDTH}px)`);

  const disabledReason = !ENABLE_WEBGL_LIQUID_CURSOR
    ? 'disabled-by-config'
    : hasKillSwitch()
      ? 'disabled-by-query'
      : reducedMotionQuery.matches
        ? 'disabled-by-reduced-motion'
        : !finePointerQuery.matches
          ? 'disabled-by-pointer'
          : !desktopWidthQuery.matches
            ? 'disabled-by-viewport'
            : '';

  if (disabledReason) {
    debugOverlay?.update({
      webgl: 'OFF',
      reason: disabledReason,
      mode: disabledReason === 'disabled-by-query' ? 'legacy' : 'disabled',
      ready: 'no',
      firstFrame: 'no',
      cursorHidden: 'no',
      fallback: disabledReason === 'disabled-by-query' ? 'yes' : 'no',
      shaders: 'not-started'
    });
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
  let debugTimer = 0;
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
    compositionVerified: false,
    readyProbeAttempts: 0,
    readySafeSamples: 0,
    alphaBg: null,
    alphaCursor: null,
    lastProbeAt: 0,
    pausedByModal: false,
    statusReason: 'initializing',
    mode: 'webgl',
    fallback: false,
    shadersReady: false,
    contextAttributes: null,
    fps: 0,
    fpsFrames: 0,
    fpsWindowStartedAt: 0
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

  const getCssOpacity = () => {
    const value = Number.parseFloat(window.getComputedStyle(canvas).opacity);
    return Number.isFinite(value) ? value : 1;
  };

  const refreshDebugOverlay = () => {
    if (!debugOverlay) return;
    debugOverlay.update({
      webgl: gl && !state.destroyed ? 'ON' : 'OFF',
      reason: state.statusReason,
      mode: state.mode,
      ready: state.compositionVerified ? 'yes' : 'no',
      firstFrame: state.firstFrameRendered ? 'yes' : 'no',
      cursorHidden: document.body.classList.contains('has-webgl-liquid-cursor') ? 'yes' : 'no',
      contextLost: state.contextLost ? 'yes' : 'no',
      shaders: state.shadersReady ? 'ready' : 'pending',
      dpr: state.effectiveDpr.toFixed(2),
      canvas: `${state.canvasWidth}x${state.canvasHeight}`,
      fbo: `${state.trailWidth}x${state.trailHeight}`,
      fps: state.fps.toFixed(1),
      alphaBg: state.alphaBg == null ? '-' : state.alphaBg.toFixed(3),
      alphaCursor: state.alphaCursor == null ? '-' : state.alphaCursor.toFixed(3),
      cssOpacity: getCssOpacity().toFixed(2),
      premultiplied: state.contextAttributes?.premultipliedAlpha ? 'yes' : 'no',
      blend: 'OFF/direct-premultiplied',
      mouseIn: state.pointerInside ? 'yes' : 'no',
      hover: state.hover.toFixed(2),
      click: state.click.toFixed(2),
      fallback: state.fallback ? 'yes' : 'no'
    });
  };

  const updateFallbackDebug = (reason) => {
    debugOverlay?.update({
      webgl: 'OFF',
      reason,
      mode: 'legacy',
      ready: 'no',
      firstFrame: state.firstFrameRendered ? 'yes' : 'no',
      cursorHidden: 'no',
      contextLost: state.contextLost ? 'yes' : 'no',
      shaders: state.shadersReady ? 'ready' : 'fail',
      dpr: state.effectiveDpr.toFixed(2),
      canvas: `${state.canvasWidth}x${state.canvasHeight}`,
      fbo: `${state.trailWidth}x${state.trailHeight}`,
      fps: state.fps.toFixed(1),
      alphaBg: state.alphaBg == null ? '-' : state.alphaBg.toFixed(3),
      alphaCursor: state.alphaCursor == null ? '-' : state.alphaCursor.toFixed(3),
      cssOpacity: '1.00',
      premultiplied: state.contextAttributes?.premultipliedAlpha ? 'yes' : 'no',
      blend: 'OFF/direct-premultiplied',
      mouseIn: state.pointerInside ? 'yes' : 'no',
      hover: state.hover.toFixed(2),
      click: state.click.toFixed(2),
      fallback: 'yes'
    });
  };

  const removeReadyState = () => {
    document.body.classList.remove('has-webgl-liquid-cursor');
    canvas.classList.remove('is-ready');
  };

  const clearDefaultFramebuffer = () => {
    if (!gl || state.contextLost) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, state.canvasWidth, state.canvasHeight);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const stopLoop = ({ hide = false, reason = '' } = {}) => {
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    state.lastFrameAt = 0;
    if (reason) state.statusReason = reason;
    if (hide) {
      removeReadyState();
      clearDefaultFramebuffer();
    }
    refreshDebugOverlay();
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
      // Context loss can make deletion unavailable. Removing the canvas remains the safe fallback.
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
    if (debugTimer) {
      window.clearInterval(debugTimer);
      debugTimer = 0;
    }
  };

  const destroy = ({ fallback = false, reason = 'destroyed' } = {}) => {
    if (state.destroyed) return;
    state.destroyed = true;
    state.fallback = fallback;
    state.mode = fallback ? 'legacy' : 'disabled';
    state.statusReason = reason;
    stopLoop({ hide: true });
    detachListeners();
    disposeResources();
    canvas.remove();
    if (publicController && destroyActiveWebglCursor === publicController.destroy) destroyActiveWebglCursor = null;

    if (fallback) {
      updateFallbackDebug(reason);
    } else {
      debugOverlay?.destroy();
    }

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
    destroy({ fallback: true, reason });
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

  const resetCompositionVerification = () => {
    state.firstFrameRendered = false;
    state.compositionVerified = false;
    state.readyProbeAttempts = 0;
    state.readySafeSamples = 0;
    state.alphaBg = null;
    state.alphaCursor = null;
    removeReadyState();
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
    resetCompositionVerification();
    clearDefaultFramebuffer();
    refreshDebugOverlay();
  };

  const setCommonTrailUniforms = (deltaSeconds, elapsedSeconds) => {
    gl.uniform2f(trailUniforms.uResolution, state.trailWidth, state.trailHeight);
    gl.uniform2f(trailUniforms.uMouse, state.mouseX, state.mouseY);
    gl.uniform2f(trailUniforms.uPrevMouse, state.previousMouseX, state.previousMouseY);
    gl.uniform2f(trailUniforms.uVelocity, state.velocityX, state.velocityY);
    gl.uniform1f(trailUniforms.uTime, elapsedSeconds);
    gl.uniform1f(trailUniforms.uDelta, deltaSeconds);
    gl.uniform1f(trailUniforms.uIntensity, TRAIL_BASE_INTENSITY + state.hover * TRAIL_HOVER_INTENSITY);
    gl.uniform1f(
      trailUniforms.uRadius,
      (BASE_RADIUS_PX + state.hover * HOVER_RADIUS_BOOST_PX + state.click * CLICK_RADIUS_BOOST_PX)
        / Math.max(1, window.innerHeight)
    );
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
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(displayProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTarget.texture);
    gl.uniform1i(displayUniforms.uTrailTexture, 0);
    gl.uniform2f(displayUniforms.uResolution, state.canvasWidth, state.canvasHeight);
    gl.uniform2f(displayUniforms.uMouse, state.mouseX, state.mouseY);
    gl.uniform2f(displayUniforms.uVelocity, state.velocityX, state.velocityY);
    gl.uniform1f(displayUniforms.uTime, elapsedSeconds);
    gl.uniform1f(displayUniforms.uIntensity, DISPLAY_BASE_INTENSITY + state.hover * DISPLAY_HOVER_INTENSITY);
    gl.uniform1f(
      displayUniforms.uRadius,
      (BASE_RADIUS_PX + state.hover * HOVER_RADIUS_BOOST_PX + state.click * CLICK_RADIUS_BOOST_PX)
        / Math.max(1, window.innerHeight)
    );
    gl.uniform1f(displayUniforms.uHover, state.hover);
    gl.uniform1f(displayUniforms.uClick, state.click);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const readAlphaPixel = (x, y) => {
    const pixel = new Uint8Array(4);
    const pixelX = Math.max(0, Math.min(state.canvasWidth - 1, Math.round(x)));
    const pixelY = Math.max(0, Math.min(state.canvasHeight - 1, Math.round(y)));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel[3] / 255;
  };

  const readCursorAlpha = () => {
    const centerX = Math.max(1, Math.min(state.canvasWidth - 2, Math.round(state.mouseX * (state.canvasWidth - 1))));
    const centerY = Math.max(1, Math.min(state.canvasHeight - 2, Math.round(state.mouseY * (state.canvasHeight - 1))));
    const pixels = new Uint8Array(3 * 3 * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(centerX - 1, centerY - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let maxAlpha = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      maxAlpha = Math.max(maxAlpha, pixels[index] / 255);
    }
    return maxAlpha;
  };

  const probeComposition = () => {
    // readPixels is used only during the ready gate/debug cadence. finish() avoids
    // false zero-alpha samples on desynchronized/SwiftShader presentation paths.
    gl.finish();
    const corners = [
      [0.03, 0.03],
      [0.97, 0.03],
      [0.03, 0.97],
      [0.97, 0.97]
    ];
    const backgroundPoint = corners.reduce((farthest, point) => {
      const distance = Math.hypot(point[0] - state.mouseX, point[1] - state.mouseY);
      return distance > farthest.distance ? { point, distance } : farthest;
    }, { point: corners[0], distance: -1 }).point;

    state.alphaBg = readAlphaPixel(
      backgroundPoint[0] * (state.canvasWidth - 1),
      backgroundPoint[1] * (state.canvasHeight - 1)
    );
    state.alphaCursor = readCursorAlpha();
    state.lastProbeAt = performance.now();
    return { alphaBg: state.alphaBg, alphaCursor: state.alphaCursor };
  };

  const verifyComposition = () => {
    const cssOpacity = getCssOpacity();
    const { alphaBg, alphaCursor } = probeComposition();
    state.readyProbeAttempts += 1;

    if (cssOpacity < 0.99) {
      failToLegacy('canvas-opacity-invalid');
      return 'failed';
    }
    if (alphaBg > READY_BG_ALPHA_FAIL) {
      failToLegacy('dark-overlay-risk');
      return 'failed';
    }

    if (alphaBg <= READY_BG_ALPHA_WARNING && alphaCursor >= READY_CURSOR_ALPHA_MIN) {
      state.readySafeSamples += 1;
    } else {
      state.readySafeSamples = 0;
    }

    if (state.readySafeSamples >= READY_SAFE_SAMPLE_COUNT) {
      state.compositionVerified = true;
      state.statusReason = 'ready';
      canvas.classList.add('is-ready');
      document.body.classList.add('has-webgl-liquid-cursor');
      refreshDebugOverlay();
      return 'ready';
    }

    if (state.readyProbeAttempts >= READY_MAX_PROBE_ATTEMPTS) {
      failToLegacy(alphaCursor < READY_CURSOR_ALPHA_MIN ? 'cursor-not-visible' : 'background-alpha-warning');
      return 'failed';
    }

    state.statusReason = 'verifying-composition';
    refreshDebugOverlay();
    return 'pending';
  };

  const revealRenderedFrame = (timestamp) => {
    if (gl.isContextLost?.()) {
      state.contextLost = true;
      failToLegacy('context-lost');
      return 'failed';
    }
    if (gl.getError() !== gl.NO_ERROR) {
      failToLegacy('first-frame-error');
      return 'failed';
    }

    state.firstFrameRendered = true;
    if (!state.compositionVerified) return verifyComposition();

    const probeInterval = debugOverlay ? DEBUG_UPDATE_INTERVAL_MS : NORMAL_SAFETY_PROBE_INTERVAL_MS;
    if (timestamp - state.lastProbeAt >= probeInterval) {
      try {
        const { alphaBg } = probeComposition();
        if (alphaBg > READY_BG_ALPHA_FAIL) {
          failToLegacy('dark-overlay-risk');
          return 'failed';
        }
      } catch {
        failToLegacy('alpha-probe-error');
        return 'failed';
      }
    }

    canvas.classList.add('is-ready');
    document.body.classList.add('has-webgl-liquid-cursor');
    return 'ready';
  };

  const updateFps = (timestamp) => {
    if (!state.fpsWindowStartedAt) state.fpsWindowStartedAt = timestamp;
    state.fpsFrames += 1;
    const elapsed = timestamp - state.fpsWindowStartedAt;
    if (elapsed >= 500) {
      state.fps = state.fpsFrames * 1000 / elapsed;
      state.fpsFrames = 0;
      state.fpsWindowStartedAt = timestamp;
    }
  };

  const render = (timestamp) => {
    state.rafId = 0;
    if (!canUseCursor()) {
      stopLoop({ hide: true, reason: state.pausedByModal ? 'modal-open' : 'cursor-inactive' });
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

    const hoverFollow = 1 - Math.exp(-deltaMs / 58);
    state.hover += (state.targetHover - state.hover) * hoverFollow;
    state.click = state.clickStartedAt
      ? Math.max(0, 1 - (timestamp - state.clickStartedAt) / CLICK_PULSE_MS)
      : 0;

    try {
      updateTrail(deltaSeconds, elapsedSeconds);
      displayTrail(elapsedSeconds);
      updateFps(timestamp);
      if (revealRenderedFrame(timestamp) === 'failed') return;
    } catch {
      failToLegacy('render-error');
      return;
    }

    state.previousMouseX = state.mouseX;
    state.previousMouseY = state.mouseY;
    state.velocityX *= Math.exp(-deltaMs / VELOCITY_DAMPING_TAU_MS);
    state.velocityY *= Math.exp(-deltaMs / VELOCITY_DAMPING_TAU_MS);

    const shouldKeepAnimating = !state.compositionVerified
      || timestamp - state.lastPointerAt < IDLE_RENDER_MS
      || state.click > 0.001
      || Math.abs(state.hover - state.targetHover) > 0.01;
    if (shouldKeepAnimating) state.rafId = window.requestAnimationFrame(render);
  };

  const startLoop = () => {
    if (!canUseCursor() || state.rafId) return;
    state.lastFrameAt = 0;
    state.statusReason = state.compositionVerified ? 'running' : 'verifying-composition';
    state.rafId = window.requestAnimationFrame(render);
  };

  function handlePointerMove(event) {
    state.pointerType = event.pointerType || 'mouse';
    if (state.pointerType === 'touch') {
      state.pointerInside = false;
      stopLoop({ hide: true, reason: 'touch-pointer' });
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
    stopLoop({ hide: true, reason: 'pointer-outside' });
  }

  function handlePointerEnter() {
    if (!state.pointerReady || state.pointerType === 'touch') return;
    state.pointerInside = true;
    state.lastPointerAt = performance.now();
    startLoop();
  }

  function handleWindowBlur() {
    stopLoop({ hide: true, reason: 'window-blur' });
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') {
      stopLoop({ hide: true, reason: 'tab-hidden' });
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
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      desynchronized: false
    });
    if (!gl) throw new Error('WebGL2 unavailable.');
    state.contextAttributes = gl.getContextAttributes();

    trailProgram = createProgram(gl, VERTEX_SHADER_SOURCE, TRAIL_FRAGMENT_SHADER_SOURCE);
    displayProgram = createProgram(gl, VERTEX_SHADER_SOURCE, DISPLAY_FRAGMENT_SHADER_SOURCE);
    state.shadersReady = true;
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
    state.statusReason = !gl
      ? 'webgl2-unavailable'
      : state.shadersReady
        ? 'webgl-init-failed'
        : 'shader-init-failed';
    state.mode = 'legacy';
    state.fallback = true;
    state.destroyed = true;
    removeReadyState();
    disposeResources();
    canvas.remove();
    updateFallbackDebug(state.statusReason);
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

  if (debugOverlay) {
    debugTimer = window.setInterval(refreshDebugOverlay, DEBUG_UPDATE_INTERVAL_MS);
    refreshDebugOverlay();
  }

  let previousModalState = isVideoModalOpen();
  modalObserver = new MutationObserver(() => {
    const modalOpen = isVideoModalOpen();
    if (modalOpen === previousModalState) return;
    previousModalState = modalOpen;
    state.pausedByModal = modalOpen;
    if (modalOpen) {
      stopLoop({ hide: true, reason: 'modal-open' });
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
      return state.compositionVerified && document.body.classList.contains('has-webgl-liquid-cursor');
    },
    pause() {
      state.pausedByModal = true;
      stopLoop({ hide: true, reason: 'paused' });
    },
    resume() {
      state.pausedByModal = false;
      state.previousMouseX = state.mouseX;
      state.previousMouseY = state.mouseY;
      state.lastPointerAt = performance.now();
      startLoop();
    },
    destroy() {
      destroy({ fallback: false, reason: 'destroyed' });
    }
  };

  destroyActiveWebglCursor = publicController.destroy;
  return publicController;
}
