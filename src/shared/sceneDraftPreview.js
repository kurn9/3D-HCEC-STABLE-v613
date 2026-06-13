// V6.11.21-B6-B — Local draft preview helper.
// Read-only browser helper: reads localStorage draft/manifest only when preview=local-draft.
(function initSceneDraftPreview(global) {
  if (global.sceneDraftPreview) return;

  const DEFAULT_ROOM = 'indoor';
  const DRAFT_PREFIX = 'gallery_walk_cms_draft_v2';
  const MANIFEST_PREFIX = 'gallery_walk_cms_draft_manifest_v1';
  const LEGACY_INDOOR_KEY = 'gallery_walk_cms_draft_v1';

  function normalizeRoomId(value) {
    const id = String(value || DEFAULT_ROOM).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    return id || DEFAULT_ROOM;
  }

  function getSearchParams() {
    try { return new URLSearchParams(global.location?.search || ''); } catch (_) { return new URLSearchParams(); }
  }

  function getRequestedRoomId() {
    return normalizeRoomId(getSearchParams().get('room') || global.CONFIG?.currentRoomId || DEFAULT_ROOM);
  }

  function isLocalDraftPreview() {
    return getSearchParams().get('preview') === 'local-draft';
  }

  function buildDraftStorageKeys(roomId = getRequestedRoomId()) {
    const room = normalizeRoomId(roomId);
    return {
      room,
      draftKey: `${DRAFT_PREFIX}_${room}`,
      manifestKey: `${MANIFEST_PREFIX}_${room}`,
      legacyDraftKey: room === 'indoor' ? LEGACY_INDOOR_KEY : `${LEGACY_INDOOR_KEY}_${room}`
    };
  }

  function safeJsonParse(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (error) { return { __parseError: error?.message || String(error) }; }
  }

  function readManifest(roomId) {
    try {
      const keys = buildDraftStorageKeys(roomId);
      const manifest = safeJsonParse(global.localStorage?.getItem(keys.manifestKey));
      if (!manifest || manifest.__parseError) return null;
      if (normalizeRoomId(manifest.room) !== keys.room) return null;
      return manifest;
    } catch (error) {
      console.warn('[preview] Không đọc được Draft Manifest.', error);
      return null;
    }
  }

  function loadLocalDraftScene(roomId = getRequestedRoomId()) {
    const keys = buildDraftStorageKeys(roomId);
    try {
      const raw = global.localStorage?.getItem(keys.draftKey);
      let data = safeJsonParse(raw);
      let isLegacy = false;

      if (!Array.isArray(data)) {
        const legacyRaw = global.localStorage?.getItem(keys.legacyDraftKey);
        data = safeJsonParse(legacyRaw);
        isLegacy = Array.isArray(data);
      }

      if (!Array.isArray(data)) {
        return {
          ok: false,
          room: keys.room,
          keys,
          error: data?.__parseError || 'Không tìm thấy local draft đúng room.'
        };
      }

      return {
        ok: true,
        room: keys.room,
        keys,
        items: data,
        manifest: readManifest(keys.room),
        isLegacy
      };
    } catch (error) {
      return {
        ok: false,
        room: keys.room,
        keys,
        error: error?.message || String(error)
      };
    }
  }


  const DRAFT_OVERRIDE_FIELDS = [
    'id', 'artwork_code', 'code',
    'type', 'title', 'name', 'description', 'content',
    'author', 'year', 'material', 'realSize', 'note',
    'group', 'clickable', 'transparent', 'frame',
    'image', 'src', 'thumbnail', 'poster', 'videoUrl', 'video', 'mediaUrl',
    'position', 'rotation', 'size'
  ];

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(Object(object), key);
  }

  function cloneJsonValue(value) {
    if (Array.isArray(value)) return value.map((entry) => cloneJsonValue(entry));
    if (value && typeof value === 'object') {
      const output = {};
      Object.keys(value).forEach((key) => { output[key] = cloneJsonValue(value[key]); });
      return output;
    }
    return value;
  }

  function itemMatchKeys(item) {
    const keys = [];
    ['id', 'artwork_code', 'code'].forEach((field) => {
      if (!hasOwn(item, field)) return;
      const value = String(item[field] ?? '').trim();
      if (value) keys.push(value);
    });
    return Array.from(new Set(keys));
  }

  function buildDraftOverrideMap(draftItems = []) {
    const map = new Map();
    if (!Array.isArray(draftItems)) return map;
    draftItems.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      itemMatchKeys(item).forEach((key) => {
        if (!map.has(key)) map.set(key, item);
      });
    });
    return map;
  }

  function copyDraftOverrides(mergedItem, draftItem) {
    if (!draftItem || typeof draftItem !== 'object') return mergedItem;
    const output = { ...(mergedItem || {}) };

    DRAFT_OVERRIDE_FIELDS.forEach((field) => {
      if (hasOwn(draftItem, field)) output[field] = cloneJsonValue(draftItem[field]);
    });

    // Giữ các field scene/runtime khác có trong draft nếu renderer đang dùng,
    // nhưng không xóa các field CMS bổ sung khi draft không có field đó.
    Object.keys(draftItem).forEach((field) => {
      if (field.startsWith('__')) return;
      if (!DRAFT_OVERRIDE_FIELDS.includes(field)) {
        output[field] = cloneJsonValue(draftItem[field]);
      }
    });

    return output;
  }

  function reapplyDraftItemOverrides(mergedItems = [], draftItems = [], options = {}) {
    if (!Array.isArray(mergedItems) || !Array.isArray(draftItems) || !draftItems.length) {
      return Array.isArray(mergedItems) ? mergedItems.slice() : mergedItems;
    }

    const draftByKey = buildDraftOverrideMap(draftItems);
    let appliedCount = 0;
    const output = mergedItems.map((item) => {
      const draftItem = itemMatchKeys(item).map((key) => draftByKey.get(key)).find(Boolean);
      if (!draftItem) return item;
      appliedCount += 1;
      return copyDraftOverrides(item, draftItem);
    });

    if (options.debug || getSearchParams().get('previewDebug') === '1') {
      console.info('[preview] Re-applied local draft overrides after CMS merge.', {
        room: options.room || getRequestedRoomId(),
        mergedItems: mergedItems.length,
        draftItems: draftItems.length,
        appliedCount
      });
    }

    return output;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function injectPreviewBanner(result, options = {}) {
    if (!isLocalDraftPreview()) return;
    if (global.document?.getElementById('localDraftPreviewBanner')) return;

    const banner = global.document.createElement('div');
    banner.id = 'localDraftPreviewBanner';
    banner.setAttribute('role', 'status');
    banner.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:12px',
      'transform:translateX(-50%)',
      'z-index:9999',
      'max-width:min(720px,calc(100vw - 24px))',
      'padding:10px 14px',
      'border:1px solid rgba(242,199,110,.55)',
      'border-radius:14px',
      'background:rgba(18,18,18,.92)',
      'color:#fff7df',
      'box-shadow:0 12px 36px rgba(0,0,0,.35)',
      'font:600 13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'text-align:left',
      'pointer-events:none'
    ].join(';');

    const manifest = result?.manifest || null;
    const room = result?.room || options.room || getRequestedRoomId();
    const status = result?.ok ? 'Đang xem bản nháp cục bộ' : 'Không tìm thấy local draft — đang dùng public scene fallback';
    const draftId = manifest?.draftId ? `<br>Draft: <code>${escapeHtml(manifest.draftId)}</code>` : '';
    const updatedAt = manifest?.updatedAt ? ` · Updated: ${escapeHtml(manifest.updatedAt)}` : '';
    const itemCount = Array.isArray(result?.items) ? ` · Items: ${result.items.length}` : '';
    const error = result?.ok ? '' : `<br><span style="color:#ffb4a8">${escapeHtml(result?.error || 'No draft')}</span>`;

    banner.innerHTML = `<strong>PREVIEW — Không phải bản public</strong><br>${escapeHtml(status)} · Room: <code>${escapeHtml(room)}</code>${itemCount}${updatedAt}${draftId}${error}`;
    global.document.body.appendChild(banner);
    global.document.body.classList.add('viewer-local-draft-preview');
  }

  global.sceneDraftPreview = {
    isLocalDraftPreview,
    getRequestedRoomId,
    buildDraftStorageKeys,
    loadLocalDraftScene,
    injectPreviewBanner,
    reapplyDraftItemOverrides
  };
})(window);
