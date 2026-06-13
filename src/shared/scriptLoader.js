const SCRIPT_RETRY_LIMIT = 1;
const SCRIPT_CACHE_BUST_PARAM = 'viewerRetry';

function isLocalScriptUrl(src) {
  try {
    const url = new URL(src, window.location.href);
    return url.origin === window.location.origin;
  } catch (_) {
    return !/^https?:\/\//i.test(String(src || ''));
  }
}

function buildRetryUrl(src) {
  const url = new URL(src, window.location.href);
  url.searchParams.set(SCRIPT_CACHE_BUST_PARAM, `${Date.now()}`);
  return url.href;
}

function cleanupScript(script) {
  if (!script) return;
  script.onload = null;
  script.onerror = null;
  if (script.parentNode) script.parentNode.removeChild(script);
}

function createScriptLoadError(src, attempts, cause = null) {
  const error = new Error(`Không tải được script sau ${attempts} lần thử: ${src}`);
  error.name = 'ScriptLoadError';
  error.scriptUrl = src;
  error.attempts = attempts;
  if (cause) error.cause = cause;
  return error;
}

function appendClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.defer = false;
    script.onload = () => resolve({ src, script });
    script.onerror = (event) => reject({ src, script, event });
    document.head.appendChild(script);
  });
}

export async function loadClassicScript(src, options = {}) {
  const retryLimit = Number.isFinite(Number(options.retryLimit))
    ? Math.max(0, Number(options.retryLimit))
    : SCRIPT_RETRY_LIMIT;
  const canRetry = retryLimit > 0 && isLocalScriptUrl(src);
  let lastFailure = null;

  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    const attemptUrl = attempt === 0 ? src : buildRetryUrl(src);
    try {
      await appendClassicScript(attemptUrl);
      return attemptUrl;
    } catch (failure) {
      lastFailure = failure;
      cleanupScript(failure?.script);

      if (!canRetry || attempt >= retryLimit) break;
      console.warn('[script-loader] Không tải được script, thử lại với cache-bust.', {
        src,
        attempt: attempt + 1,
        retryLimit
      });
    }
  }

  throw createScriptLoadError(src, canRetry ? retryLimit + 1 : 1, lastFailure?.event || lastFailure);
}

export async function loadClassicScriptsInOrder(urls) {
  for (const url of urls) {
    await loadClassicScript(url);
  }
}
