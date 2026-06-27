import { ADMIN_TABLES, ADMIN_UI, CMS_MEDIA_DELETE_CONFIG, CMS_MEDIA_UPLOAD_CONFIG, CMS_PUBLISH_GATE_CONFIG, CMS_RELEASE_RECONCILE_CONFIG, CMS_ROLLBACK_GATE_CONFIG, CMS_STORAGE_CLEANUP_CONFIG, STATIC_CMS_DRAFT_CONFIG } from './adminConfig.js';
import { safeArray } from './adminUtils.js';
import { buildCanonicalDashboardSummary } from './adminDashboardSummary.js';

const ARTWORK_COLUMNS = 'id,room_key,artwork_code,type,title,subtitle,artist,year,material,real_size,description,content,note,image_url,thumbnail_url,video_url,poster_url,audio_url,category,tags,is_visible,is_featured,sort_order,cms_warning,updated_at,updated_by';
const ARTWORK_PAGE_SIZE_OPTIONS = Array.isArray(ADMIN_UI.artworkPageSizeOptions) ? ADMIN_UI.artworkPageSizeOptions : [25, 50, 100];
const DEFAULT_ARTWORK_PAGE_SIZE = ADMIN_UI.defaultArtworkPageSize || 50;

export async function fetchDashboardData(client) {
  if (!client) {
    return {
      data: createEmptyDashboardData(),
      errors: { root: new Error('Supabase client chưa sẵn sàng.') },
    };
  }

  const defaultArtworkParams = { page: 1, pageSize: DEFAULT_ARTWORK_PAGE_SIZE, search: '', roomFilter: 'all', warningFilter: 'all' };
  const [
    siteSettings,
    indexSections,
    gateContent,
    rooms,
    artworksPage,
    artworkStats,
    publishedBundles,
    mediaAssets,
    cmsMediaUploads,
    canonicalCms,
  ] = await Promise.all([
    fetchSiteSettings(client),
    fetchIndexSections(client),
    fetchGateContent(client),
    fetchRooms(client),
    fetchArtworksPage(client, defaultArtworkParams),
    fetchArtworkStats(client),
    fetchPublishedBundles(client),
    fetchMediaAssets(client),
    fetchCmsMediaUploads(client),
    fetchDashboardCanonicalCmsContent(),
  ]);

  const errors = collectErrors({
    siteSettings,
    indexSections,
    gateContent,
    rooms,
    artworksPage,
    artworkStats,
    publishedBundles,
    mediaAssets,
    cmsMediaUploads,
  });

  return {
    data: {
      siteSettings: siteSettings.data || null,
      indexSections: safeArray(indexSections.data),
      gateContent: gateContent.data || null,
      rooms: safeArray(rooms.data),
      artworks: safeArray(artworksPage.data?.items),
      artworkStats: artworkStats.data || createEmptyArtworkStats(),
      publishedBundles: safeArray(publishedBundles.data),
      mediaAssets: safeArray(mediaAssets.data),
      cmsMediaUploads: safeArray(cmsMediaUploads.data),
      canonicalCms: canonicalCms.data || null,
      canonicalSummary: canonicalCms.data?.summary || null,
      canonicalError: canonicalCms.error || null,
      errors,
    },
    errors,
  };
}

export async function fetchSiteSettings(client) {
  return runReadQuery('siteSettings', async () => {
    const { data, error } = await client
      .from(ADMIN_TABLES.siteSettings)
      .select('id,site_title,organization_name,address,phone,fax,email,logo_url,default_language,site_status,updated_at,updated_by')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1);
    return { data: data?.[0] || null, error };
  });
}

export async function fetchIndexSections(client) {
  return runReadQuery('indexSections', async () => {
    const { data, error } = await client
      .from(ADMIN_TABLES.indexSections)
      .select('id,section_key,eyebrow,title,subtitle,lead,body,items_json,media_json,cta_json,sort_order,is_visible,updated_at,updated_by')
      .order('sort_order', { ascending: true })
      .order('section_key', { ascending: true });
    return { data: safeArray(data), error };
  });
}

export async function fetchGateContent(client) {
  return runReadQuery('gateContent', async () => {
    const { data, error } = await client
      .from(ADMIN_TABLES.gateContent)
      .select('id,eyebrow,title,description,back_label,rooms_json,editor_json,is_active,updated_at,updated_by')
      .eq('is_active', true)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1);
    return { data: data?.[0] || null, error };
  });
}

export async function fetchRooms(client) {
  return runReadQuery('rooms', async () => {
    const { data, error } = await client
      .from(ADMIN_TABLES.rooms)
      .select('id,room_key,name,description,room_type,is_active,sort_order,updated_at,updated_by')
      .order('sort_order', { ascending: true })
      .order('room_key', { ascending: true });
    return { data: safeArray(data), error };
  });
}

export async function fetchArtworksPage(client, params = {}) {
  if (!client) {
    return { name: 'artworksPage', data: createEmptyArtworksPage(params), error: new Error('Supabase client chưa sẵn sàng.') };
  }

  return runReadQuery('artworksPage', async () => {
    const normalized = normalizeArtworkPageParams(params);
    const from = (normalized.page - 1) * normalized.pageSize;
    const to = from + normalized.pageSize - 1;

    let query = client
      .from(ADMIN_TABLES.artworks)
      .select(ARTWORK_COLUMNS, { count: 'exact' });

    query = applyArtworkListFilters(query, normalized);

    const { data, error, count } = await query
      .order('room_key', { ascending: true })
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('artwork_code', { ascending: true })
      .range(from, to);

    const items = safeArray(data);
    const totalCount = Number.isFinite(count) ? count : 0;
    const start = totalCount > 0 && items.length ? from + 1 : 0;
    const end = totalCount > 0 && items.length ? Math.min(from + items.length, totalCount) : 0;

    return {
      data: {
        items,
        totalCount,
        page: normalized.page,
        pageSize: normalized.pageSize,
        search: normalized.search,
        roomFilter: normalized.roomFilter,
        warningFilter: normalized.warningFilter,
        from: start,
        to: end,
      },
      error,
    };
  });
}

export async function fetchArtworkStats(client) {
  if (!client) {
    return { name: 'artworkStats', data: createEmptyArtworkStats(), error: new Error('Supabase client chưa sẵn sàng.') };
  }

  return runReadQuery('artworkStats', async () => {
    const [total, indoor, outdoor, warning] = await Promise.all([
      countArtworks(client),
      countArtworks(client, { roomKey: 'indoor' }),
      countArtworks(client, { roomKey: 'outdoor' }),
      countArtworks(client, { warningOnly: true }),
    ]);

    const error = total.error || indoor.error || outdoor.error || warning.error || null;
    return {
      data: {
        total: total.count || 0,
        indoor: indoor.count || 0,
        outdoor: outdoor.count || 0,
        warning: warning.count || 0,
      },
      error,
    };
  });
}

async function countArtworks(client, options = {}) {
  let query = client
    .from(ADMIN_TABLES.artworks)
    .select('id', { count: 'exact', head: true });

  if (options.roomKey) query = query.eq('room_key', options.roomKey);
  if (options.warningOnly) query = query.not('cms_warning', 'is', null).neq('cms_warning', '');

  const { count, error } = await query;
  return { count: Number.isFinite(count) ? count : 0, error };
}

function applyArtworkListFilters(query, params = {}) {
  let next = query;

  if (params.roomFilter && params.roomFilter !== 'all') {
    next = next.eq('room_key', params.roomFilter);
  }

  if (params.warningFilter === 'warning') {
    next = next.not('cms_warning', 'is', null).neq('cms_warning', '');
  }

  if (params.warningFilter === 'clear') {
    next = next.or('cms_warning.is.null,cms_warning.eq.');
  }

  if (params.search) {
    const escaped = escapePostgrestSearchValue(params.search);
    if (escaped) {
      const pattern = `*${escaped}*`;
      next = next.or([
        `title.ilike.${pattern}`,
        `artwork_code.ilike.${pattern}`,
        `artist.ilike.${pattern}`,
      ].join(','));
    }
  }

  return next;
}

function normalizeArtworkPageParams(params = {}) {
  const fallbackPageSize = normalizePageSize(DEFAULT_ARTWORK_PAGE_SIZE);
  return {
    page: Math.max(1, Number.parseInt(params.page, 10) || 1),
    pageSize: normalizePageSize(params.pageSize || fallbackPageSize),
    search: String(params.search || '').trim(),
    roomFilter: ['all', 'indoor', 'outdoor'].includes(params.roomFilter) ? params.roomFilter : 'all',
    warningFilter: ['all', 'warning', 'clear'].includes(params.warningFilter) ? params.warningFilter : 'all',
  };
}

function normalizePageSize(value) {
  const number = Number.parseInt(value, 10);
  return ARTWORK_PAGE_SIZE_OPTIONS.includes(number) ? number : 50;
}

function escapePostgrestSearchValue(value = '') {
  return String(value || '')
    .trim()
    .replace(/[\*,()%]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function createEmptyArtworksPage(params = {}) {
  const normalized = normalizeArtworkPageParams(params);
  return {
    items: [],
    totalCount: 0,
    page: normalized.page,
    pageSize: normalized.pageSize,
    search: normalized.search,
    roomFilter: normalized.roomFilter,
    warningFilter: normalized.warningFilter,
    from: 0,
    to: 0,
  };
}

function createEmptyArtworkStats() {
  return { total: 0, indoor: 0, outdoor: 0, warning: 0 };
}

export async function fetchPublishedBundles(client) {
  return runReadQuery('publishedBundles', async () => {
    const { data, error } = await client
      .from(ADMIN_TABLES.publishedBundles)
      .select('id,version,schema_version,status,published_at,published_by,created_at,created_by,note')
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(20);
    return { data: safeArray(data), error };
  });
}

export async function fetchMediaAssets(client) {
  return runReadQuery('mediaAssets', async () => {
    const { data, error } = await client
      .from(ADMIN_TABLES.mediaAssets)
      .select('id,asset_type,file_name,storage_path,public_url,mime_type,size_bytes,width,height,duration_seconds,alt_text,caption,created_at,created_by,is_published')
      .order('created_at', { ascending: false })
      .limit(500);
    return { data: safeArray(data), error };
  });
}

export async function fetchCmsMediaUploads(client) {
  return runReadQuery('cmsMediaUploads', async () => {
    const { data, error } = await client
      .from(ADMIN_TABLES.cmsMediaUploads)
      .select('id,storage_bucket,storage_path,public_url,media_kind,mime_type,size_bytes,sha256,target_type,room_key,section_key,item_id,artwork_code,field_name,draft_id,status,created_by,updated_by,created_at,updated_at,note')
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(500);
    return { data: safeArray(data), error };
  });
}

export async function fetchDashboardCanonicalCmsContent() {
  const loader = await getCanonicalCmsContentLoader();
  if (!loader?.loadCmsContentSources) {
    return { name: 'canonicalCms', data: null, error: new Error('Canonical release loader chưa sẵn sàng.') };
  }

  try {
    const sources = await loader.loadCmsContentSources({
      forceReload: true,
      remoteEnabled: true,
      pointerUrl: STATIC_CMS_DRAFT_CONFIG.pointerUrl,
      legacyLatestUrl: STATIC_CMS_DRAFT_CONFIG.legacyLatestUrl,
      remoteUrl: STATIC_CMS_DRAFT_CONFIG.legacyLatestUrl,
      releasePublicBaseUrl: STATIC_CMS_DRAFT_CONFIG.releasePublicBaseUrl,
      fallbackUrl: STATIC_CMS_DRAFT_CONFIG.fallbackUrl,
    });
    const json = sources.selectedContent;
    if (!json) {
      throw new Error(sources.remoteStatus === 'pointer-missing'
        ? 'Chưa có release pointer và không tải được legacy fallback.'
        : `Không đọc được canonical release (${sources.remoteStatus || sources.source}).`);
    }
    const sourceType = sources.sourceType || sources.source || 'release-pointer';
    const summary = buildCanonicalDashboardSummary(json, {
      source: sourceType === 'legacy-fallback' ? 'legacy-fallback' : 'release-pointer',
      sourceLabel: sourceType === 'legacy-fallback' ? 'Nguồn legacy dự phòng' : 'Release hiện tại',
      sourceUrl: sources.contentPath || STATIC_CMS_DRAFT_CONFIG.pointerUrl,
      releaseId: sources.releaseId || '',
      contentPath: sources.contentPath || '',
      contentHash: sources.contentHash || '',
    });
    if (!summary.valid) {
      throw new Error(`CMS release chưa đạt summary contract: ${summary.errors.join(' | ')}`);
    }
    return {
      name: 'canonicalCms',
      data: {
        json,
        summary,
        sourceUrl: sources.contentPath || STATIC_CMS_DRAFT_CONFIG.pointerUrl,
        sourceType,
        releaseId: sources.releaseId || '',
        contentPath: sources.contentPath || '',
        contentHash: sources.contentHash || '',
        releaseHash: sources.releaseHash || '',
        legacyFallbackUsed: Boolean(sources.legacyFallbackUsed),
        pointer: sources.pointer || null,
      },
      error: null,
    };
  } catch (error) {
    return { name: 'canonicalCms', data: null, error };
  }
}



async function getCanonicalCmsContentLoader() {
  if (!globalThis.cmsContentLoader?.loadCmsContentSources) {
    await import('../shared/cmsContentLoader.js');
  }
  return globalThis.cmsContentLoader || null;
}

export async function updateSiteSettingsDraft(client, siteSettingsId, values = {}, userId = null) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const id = String(siteSettingsId || '').trim();
  if (!id) {
    return { data: null, error: new Error('Không tìm thấy ID bản ghi thông tin website.') };
  }

  const payload = buildSiteSettingsUpdatePayload(values, userId);
  const { data, error } = await client
    .from(ADMIN_TABLES.siteSettings)
    .update(payload)
    .eq('id', id)
    .select('id,site_title,organization_name,address,phone,fax,email,logo_url,default_language,site_status,updated_at,updated_by')
    .maybeSingle();

  return { data: data || null, error };
}

function buildSiteSettingsUpdatePayload(values = {}, userId = null) {
  const allowedKeys = [
    'site_title',
    'organization_name',
    'address',
    'phone',
    'fax',
    'email',
    'logo_url',
    'default_language',
  ];
  const payload = {};

  allowedKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return;
    const value = values[key];
    payload[key] = typeof value === 'string' ? value.trim() : value;
  });

  if (userId) {
    payload.updated_by = userId;
  }

  return payload;
}


export async function updateGateContentDraft(client, gateId, values = {}, userId = null) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const id = String(gateId || '').trim();
  if (!id) {
    return { data: null, error: new Error('Không tìm thấy ID bản ghi Cổng vào triển lãm.') };
  }

  const payload = buildGateContentUpdatePayload(values, userId);
  const { data, error } = await client
    .from(ADMIN_TABLES.gateContent)
    .update(payload)
    .eq('id', id)
    .select('id,eyebrow,title,description,back_label,rooms_json,editor_json,is_active,updated_at,updated_by')
    .maybeSingle();

  return { data: data || null, error };
}

function buildGateContentUpdatePayload(values = {}, userId = null) {
  const allowedKeys = [
    'eyebrow',
    'title',
    'description',
    'back_label',
    'rooms_json',
  ];
  const payload = {};

  allowedKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return;
    const value = values[key];
    payload[key] = typeof value === 'string' ? value.trim() : value;
  });

  if (userId) {
    payload.updated_by = userId;
  }

  return payload;
}



export async function updateIndexSectionDraft(client, sectionId, values = {}, userId = null) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const id = String(sectionId || '').trim();
  if (!id) {
    return { data: null, error: new Error('Không tìm thấy ID section Trang chủ.') };
  }

  const payload = buildIndexSectionUpdatePayload(values, userId);
  const { data, error } = await client
    .from(ADMIN_TABLES.indexSections)
    .update(payload)
    .eq('id', id)
    .eq('section_key', 'hero')
    .select('id,section_key,eyebrow,title,subtitle,lead,body,items_json,media_json,cta_json,sort_order,is_visible,updated_at,updated_by')
    .maybeSingle();

  return { data: data || null, error };
}

function buildIndexSectionUpdatePayload(values = {}, userId = null) {
  const allowedKeys = [
    'eyebrow',
    'title',
    'subtitle',
    'lead',
    'body',
    'media_json',
    'items_json',
    'cta_json',
  ];
  const payload = {};

  allowedKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return;
    const value = values[key];
    payload[key] = typeof value === 'string' ? value.trim() : value;
  });

  if (userId) {
    payload.updated_by = userId;
  }

  return payload;
}


export async function updateGuideIndexSectionDraft(client, sectionId, values = {}, userId = null) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const id = String(sectionId || '').trim();
  if (!id) {
    return { data: null, error: new Error('Không tìm thấy ID section Hướng dẫn tham quan.') };
  }

  const payload = buildGuideIndexSectionUpdatePayload(values, userId);
  const { data, error } = await client
    .from(ADMIN_TABLES.indexSections)
    .update(payload)
    .eq('id', id)
    .eq('section_key', 'guide')
    .select('id,section_key,eyebrow,title,subtitle,lead,body,items_json,media_json,cta_json,sort_order,is_visible,updated_at,updated_by')
    .maybeSingle();

  return { data: data || null, error };
}

function buildGuideIndexSectionUpdatePayload(values = {}, userId = null) {
  const allowedKeys = [
    'eyebrow',
    'title',
    'subtitle',
    'lead',
    'body',
    'items_json',
  ];
  const payload = {};

  allowedKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return;
    const value = values[key];
    payload[key] = typeof value === 'string' ? value.trim() : value;
  });

  if (userId) {
    payload.updated_by = userId;
  }

  return payload;
}

export async function updateExperienceIndexSectionDraft(client, sectionId, values = {}, userId = null) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const id = String(sectionId || '').trim();
  if (!id) {
    return { data: null, error: new Error('Không tìm thấy ID section Khu vực trải nghiệm.') };
  }

  const payload = buildExperienceIndexSectionUpdatePayload(values, userId);
  const { data, error } = await client
    .from(ADMIN_TABLES.indexSections)
    .update(payload)
    .eq('id', id)
    .eq('section_key', 'experience')
    .select('id,section_key,eyebrow,title,subtitle,lead,body,items_json,media_json,cta_json,sort_order,is_visible,updated_at,updated_by')
    .maybeSingle();

  return { data: data || null, error };
}

function buildExperienceIndexSectionUpdatePayload(values = {}, userId = null) {
  const allowedKeys = [
    'eyebrow',
    'title',
    'subtitle',
    'lead',
    'body',
    'items_json',
  ];
  const payload = {};

  allowedKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return;
    const value = values[key];
    payload[key] = typeof value === 'string' ? value.trim() : value;
  });

  if (userId) {
    payload.updated_by = userId;
  }

  return payload;
}



// V6.11.21-B6-F_K_O_I_L_APPLY — server-side media upload gate.
// This function calls the Supabase Edge Function with the authenticated user's JWT.
// It does not upload directly to Storage and never uses a service-role key in the frontend.
export async function uploadCmsMedia(client, payload = {}) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) return { data: null, error: sessionError };
  const token = sessionData?.session?.access_token;
  if (!token) {
    return { data: null, error: new Error('Cần đăng nhập để upload media.') };
  }

  const file = payload.file;
  if (!(file instanceof File)) {
    return { data: null, error: new Error('Payload upload thiếu file hợp lệ.') };
  }

  const targetType = String(payload.targetType || 'room_artwork').trim() || 'room_artwork';
  const formData = new FormData();
  formData.append('file', file);
  if (payload.targetType) formData.append('targetType', targetType);
  formData.append('itemId', String(payload.itemId || payload.artworkCode || ''));
  formData.append('fieldName', String(payload.fieldName || ''));
  formData.append('mediaKind', String(payload.mediaKind || ''));
  if (targetType === 'index_featured') {
    formData.append('sectionKey', String(payload.sectionKey || ''));
  } else {
    formData.append('roomKey', String(payload.roomKey || ''));
    formData.append('artworkCode', String(payload.artworkCode || payload.itemId || ''));
  }
  if (payload.draftId) formData.append('draftId', String(payload.draftId));

  try {
    const response = await fetch(CMS_MEDIA_UPLOAD_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      return { data: null, error: new Error(body?.error || body?.message || `Upload thất bại HTTP ${response.status}.`) };
    }
    return { data: body, error: null };
  } catch (error) {
    return { data: null, error };
  }
}



// v6.14.050.014 — server-side single-media delete gate.
// These helpers call delete-cms-media with the authenticated user's JWT.
// The browser never deletes Storage objects directly and never receives service-role credentials.
export async function prepareDeleteCmsMedia(client, mediaUploadId) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const id = normalizeUuidLike(mediaUploadId);
  if (!id) {
    return { data: null, error: new Error('Thiếu mediaUploadId UUID hợp lệ để kiểm tra điều kiện xóa.') };
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) return { data: null, error: sessionError };
  const token = sessionData?.session?.access_token;
  if (!token) {
    return { data: null, error: new Error('Cần đăng nhập để kiểm tra điều kiện xóa media.') };
  }

  try {
    const response = await fetch(CMS_MEDIA_DELETE_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'prepareDelete', mediaUploadId: id }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      return { data: body || null, error: new Error(body?.message || body?.error || `Kiểm tra điều kiện xóa thất bại HTTP ${response.status}.`) };
    }
    return { data: body, error: null };
  } catch (error) {
    return { data: null, error };
  }
}


export async function confirmDeleteCmsMedia(client, payload = {}) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const id = normalizeUuidLike(payload.mediaUploadId);
  const planHash = String(payload.planHash || '').trim();
  const confirmPhrase = String(payload.confirmPhrase || payload.confirmText || '').trim();
  if (!id) {
    return { data: null, error: new Error('Thiếu mediaUploadId UUID hợp lệ để xác nhận xóa.') };
  }
  if (!planHash || !confirmPhrase) {
    return { data: null, error: new Error('Thiếu planHash hoặc confirm phrase để xác nhận xóa.') };
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) return { data: null, error: sessionError };
  const token = sessionData?.session?.access_token;
  if (!token) {
    return { data: null, error: new Error('Cần đăng nhập để xác nhận xóa media.') };
  }

  try {
    const response = await fetch(CMS_MEDIA_DELETE_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'confirmDelete',
        mediaUploadId: id,
        planHash,
        confirmPhrase,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      return { data: body || null, error: new Error(body?.message || body?.error || `Xác nhận xóa media thất bại HTTP ${response.status}.`) };
    }
    return { data: body, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

// V6.11.21-B6-F_K_O_I_M_APPLY — server-side static CMS publish gate.
// This function calls the Supabase Edge Function with the authenticated user's JWT.
// It publishes only a saved cms_drafts row by draftId; no JSON is sent from the browser for publishing.
export async function publishCmsJson(client, payload = {}) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) return { data: null, error: sessionError };
  const token = sessionData?.session?.access_token;
  if (!token) {
    return { data: null, error: new Error('Cần đăng nhập để công khai CMS JSON.') };
  }

  const draftId = normalizeUuidLike(payload.draftId);
  if (!draftId) {
    return { data: null, error: new Error('Cần lưu bản nháp server-side trước khi công khai.') };
  }

  const expectedDraftUpdatedAt = normalizeDraftRevisionToken(payload.expectedDraftUpdatedAt);
  const expectedDraftVersion = normalizeOptionalText(payload.expectedDraftVersion);
  if (!expectedDraftUpdatedAt || !expectedDraftVersion) {
    return { data: null, error: new Error('Thiếu revision của bản chuẩn bị đã xác minh. Hãy lưu và kiểm tra lại trước khi công khai.') };
  }

  const bodyPayload = {
    draftId,
    dryRun: payload.dryRun === true,
    expectedDraftUpdatedAt,
    expectedDraftVersion,
  };
  const expectedCandidateHash = normalizeOptionalText(payload.expectedCandidateHash);
  if (expectedCandidateHash) bodyPayload.expectedCandidateHash = expectedCandidateHash.toLowerCase();
  const confirmVersion = normalizeOptionalText(payload.confirmVersion);
  if (confirmVersion) {
    bodyPayload.confirmVersion = confirmVersion;
  }

  try {
    const response = await fetch(CMS_PUBLISH_GATE_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyPayload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      const error = new Error(body?.error || body?.message || `Publish gate thất bại HTTP ${response.status}.`);
      error.status = response.status;
      error.code = body?.code || body?.errorCode || '';
      return { data: body || null, error };
    }
    return { data: body, error: null };
  } catch (error) {
    return { data: null, error };
  }
}



// V6.11.21-B6-F_K_O_I_N_APPLY — publish history / rollback gate.
// These functions never use a service-role key and never write Storage directly from the browser.
export async function listCmsPublishLogs(client, options = {}) {
  if (!client) {
    return { data: [], error: new Error('Supabase client chưa sẵn sàng.') };
  }

  return runReadQuery('cmsPublishLogs', async () => {
    const limit = normalizePublishLogLimit(options.limit);
    const { data, error } = await client
      .from(ADMIN_TABLES.cmsPublishLogs)
      .select('id,draft_id,actor_id,status,published_version,latest_path,version_path,backup_path,hash_before,hash_after,verify_json,error_message,operation_type,rollback_from_path,rollback_to_path,rollback_reason,rollback_verified,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    return { data: safeArray(data), error };
  });
}

export async function previewCmsPublishedVersion(sourcePath) {
  const safePath = normalizePublishedVersionPath(sourcePath);
  if (!safePath) {
    return { data: null, error: new Error('Đường dẫn version/backup không hợp lệ.') };
  }

  const url = `${CMS_ROLLBACK_GATE_CONFIG.publicStorageBaseUrl}/${safePath}`;
  try {
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
    const text = await response.text();
    if (!response.ok) {
      return { data: null, error: new Error(`Không đọc được version object HTTP ${response.status}.`) };
    }
    const json = JSON.parse(text);
    const hash = await sha256BrowserText(text);
    return {
      data: {
        sourcePath: safePath,
        url,
        json,
        hash,
        version: json?.version || '',
        schemaVersion: json?.schemaVersion || '',
        indoorCount: Array.isArray(json?.rooms?.indoor?.artworks) ? json.rooms.indoor.artworks.length : 0,
        outdoorCount: Array.isArray(json?.rooms?.outdoor?.artworks) ? json.rooms.outdoor.artworks.length : 0,
        sizeBytes: new TextEncoder().encode(text).length,
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error };
  }
}

export async function rollbackCmsJson(client, payload = {}) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) return { data: null, error: sessionError };
  const token = sessionData?.session?.access_token;
  if (!token) {
    return { data: null, error: new Error('Cần đăng nhập để rollback CMS JSON.') };
  }

  const sourcePath = normalizePublishedVersionPath(payload.sourcePath);
  const targetReleaseId = normalizeReleaseId(payload.targetReleaseId) || extractReleaseIdFromPublishedPath(sourcePath);
  if (!sourcePath && !targetReleaseId) {
    return { data: null, error: new Error('sourcePath/targetReleaseId rollback không hợp lệ.') };
  }

  const bodyPayload = {
    ...(sourcePath ? { sourcePath } : {}),
    ...(targetReleaseId ? { targetReleaseId } : {}),
    dryRun: payload.dryRun === true,
  };
  const confirmHash = normalizeOptionalText(payload.confirmHash || payload.targetContentHash).toLowerCase();
  if (confirmHash) {
    bodyPayload.confirmHash = confirmHash;
    bodyPayload.targetContentHash = confirmHash;
  }
  const expectedCurrentReleaseId = normalizeReleaseId(payload.expectedCurrentReleaseId);
  const expectedCurrentContentHash = normalizeOptionalText(payload.expectedCurrentContentHash).toLowerCase();
  if (expectedCurrentReleaseId) bodyPayload.expectedCurrentReleaseId = expectedCurrentReleaseId;
  if (expectedCurrentContentHash) bodyPayload.expectedCurrentContentHash = expectedCurrentContentHash;
  const reason = normalizeOptionalText(payload.reason);
  if (reason) bodyPayload.reason = reason;

  try {
    const response = await fetch(CMS_ROLLBACK_GATE_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyPayload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      const error = new Error(body?.error || body?.message || `Rollback gate thất bại HTTP ${response.status}.`);
      error.status = response.status;
      error.code = body?.code || body?.errorCode || '';
      return { data: body || null, error };
    }
    return { data: body, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

function normalizePublishLogLimit(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return 50;
  return Math.max(1, Math.min(100, number));
}

function normalizePublishedVersionPath(value) {
  const text = String(value || '').trim();
  if (!text || text.includes('..') || text.includes('\\') || text.includes('//')) return '';
  if (/^published\/releases\/[0-9a-f-]{36}\/cms_public_content\.json$/i.test(text)) return text;
  if (!text.startsWith(`${CMS_ROLLBACK_GATE_CONFIG.versionPrefix}`)) return '';
  if (!/^published\/versions\/cms_public_content_[A-Za-z0-9._-]+\.json$/.test(text)) return '';
  return text;
}

function normalizeReleaseId(value) {
  const text = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : '';
}

function extractReleaseIdFromPublishedPath(path = '') {
  const text = String(path || '').trim();
  const releaseMatch = text.match(/^published\/releases\/([0-9a-f-]{36})\/cms_public_content\.json$/i);
  const aliasMatch = text.match(/^published\/versions\/cms_public_content_([0-9a-f-]{36})\.json$/i);
  return normalizeReleaseId(releaseMatch?.[1] || aliasMatch?.[1] || '');
}

async function sha256BrowserText(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return '';
}


export async function reconcileCmsReleasePointer(clientOrExpected = {}, maybeExpected = {}) {
  const hasClient = Boolean(clientOrExpected?.auth?.getSession);
  const client = hasClient ? clientOrExpected : getCachedSupabaseClient();
  const expected = hasClient ? maybeExpected : clientOrExpected;
  if (!client) return { data: null, error: new Error('Supabase client chưa sẵn sàng để kiểm tra trạng thái release.') };
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) return { data: null, error: sessionError };
  const token = sessionData?.session?.access_token;
  if (!token) return { data: null, error: new Error('Cần đăng nhập để kiểm tra trạng thái release.') };
  const payload = buildReleaseReconcilePayload(expected);
  try {
    const response = await fetch(CMS_RELEASE_RECONCILE_CONFIG.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      const error = new Error(body?.error || body?.message || `Reconciliation gate thất bại HTTP ${response.status}.`);
      error.status = response.status;
      error.code = body?.code || body?.classification || '';
      return { data: body || null, error };
    }
    return { data: body, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

function getCachedSupabaseClient() {
  return globalThis.__cmsAdminSupabaseClient || null;
}

export function setCachedSupabaseClientForApi(client) {
  globalThis.__cmsAdminSupabaseClient = client || null;
}

function buildReleaseReconcilePayload(expected = {}) {
  const mode = normalizeOptionalText(expected.mode) || 'reconcile';
  const payload = { mode };
  const operationId = normalizeOptionalText(expected.operationId || expected.id);
  if (operationId) payload.operationId = operationId;

  if (mode !== 'repair-pointer') return payload;

  if (expected.dryRun === true) payload.dryRun = true;
  if (expected.dryRun === false) payload.dryRun = false;

  [
    'sourceAuditLogId',
    'sourceVersionPath',
    'expectedSourceHash',
    'expectedPublishedVersion',
    'expectedPlanHash',
    'confirmation',
  ].forEach((key) => {
    const text = normalizeOptionalText(expected[key]);
    if (text) payload[key] = text;
  });

  return payload;
}


function isSha256Text(value = '') {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim());
}

function normalizeErrorLike(error) {
  if (error instanceof Error) return error.message;
  return String(error || 'Không rõ lỗi.');
}


// V6.12-A2_APPLY — CMS storage cleanup scan/dry-run + guarded safeDelete gate.
// These functions call cleanup-cms-storage with the authenticated user's JWT.
// They never use a service-role key in the frontend and never delete Storage objects directly.
export async function scanCmsStorageCleanup(client, options = {}) {
  return runCmsStorageCleanupAction(client, 'scan', options);
}

export async function dryRunCmsStorageCleanup(client, options = {}) {
  return runCmsStorageCleanupAction(client, 'dryRun', options);
}

export async function safeDeleteCmsStorageCleanup(client, options = {}) {
  return runCmsStorageCleanupAction(client, 'safeDelete', options);
}

export async function safeDeleteSelectedCmsStorageCleanup(client, options = {}) {
  return runCmsStorageCleanupAction(client, 'safeDeleteSelected', options);
}

export async function safeDeleteSelectedPublicVersionCleanup(client, options = {}) {
  return runCmsStorageCleanupAction(client, 'safeDeleteSelectedPublicVersion', options);
}

async function runCmsStorageCleanupAction(client, action, options = {}) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) return { data: null, error: sessionError };
  const token = sessionData?.session?.access_token;
  if (!token) {
    return { data: null, error: new Error('Cần đăng nhập để quét, kiểm tra và xóa tệp có kiểm soát.') };
  }

  const payload = buildCmsStorageCleanupPayload(action, options);
  if (!payload) {
    return { data: null, error: new Error('Thao tác quét/dọn tệp không hợp lệ.') };
  }

  try {
    const response = await fetch(CMS_STORAGE_CLEANUP_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      return { data: body || null, error: new Error(body?.error || body?.message || `Cleanup gate thất bại HTTP ${response.status}.`) };
    }
    return { data: body, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

function buildCmsStorageCleanupPayload(action, options = {}) {
  if (!['scan', 'dryRun', 'safeDelete', 'safeDeleteSelected', 'safeDeleteSelectedPublicVersion'].includes(action)) return null;
  const retentionDays = normalizeCleanupInteger(options.retentionDays, CMS_STORAGE_CLEANUP_CONFIG.defaultRetentionDays || 30, CMS_STORAGE_CLEANUP_CONFIG.minRetentionDays || 7, 3650);
  const keepLastVersions = normalizeCleanupInteger(options.keepLastVersions, CMS_STORAGE_CLEANUP_CONFIG.defaultKeepLastVersions || 10, CMS_STORAGE_CLEANUP_CONFIG.minKeepLastVersions || 1, 500);

  if (action === 'safeDeleteSelected' || action === 'safeDeleteSelectedPublicVersion') {
    const runId = String(options.runId || '').trim();
    const planHash = String(options.planHash || '').trim();
    const selectedItemKey = String(options.selectedItemKey || '').trim();
    if (!runId || !planHash || !selectedItemKey) return null;
    return {
      action,
      runId,
      planHash,
      selectedItemKey,
      scope: action === 'safeDeleteSelectedPublicVersion' ? 'versions' : 'media',
      retentionDays,
      keepLastVersions,
    };
  }

  if (action === 'safeDelete') {
    const runId = String(options.runId || '').trim();
    const planHash = String(options.planHash || '').trim();
    const confirmPhrase = String(options.confirmPhrase || '').trim();
    const selectedItemKey = String(options.selectedItemKey || '').trim();
    if (!runId || !planHash || !confirmPhrase || !selectedItemKey) return null;
    return {
      action,
      runId,
      planHash,
      confirmPhrase,
      selectedItemKey,
      scope: 'media',
      retentionDays,
      keepLastVersions,
    };
  }

  const scope = ['media', 'versions', 'drafts', 'all'].includes(options.scope) ? options.scope : (CMS_STORAGE_CLEANUP_CONFIG.defaultScope || 'all');
  return {
    action,
    scope,
    retentionDays,
    keepLastVersions,
    includeVersions: options.includeVersions !== false,
    includeDrafts: options.includeDrafts !== false,
    includeLogs: options.includeLogs !== false,
    confirmPreviewOnly: action === 'dryRun',
  };
}

function normalizeCleanupInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

// V6.11.21-B6-F_K_O_I_K — static CMS draft persistence.
// These functions only write to cms_drafts via Supabase Auth/RLS.
// They do not publish, upload media, write Storage, or touch DB-first CMS tables.
const CMS_DRAFT_COLUMNS = 'id,title,status,content_json,validation_json,source_version,source_url,source_type,created_by,updated_by,created_at,updated_at,note';
const CMS_DRAFT_LIST_COLUMNS = 'id,title,status,validation_json,source_version,source_url,source_type,created_by,updated_by,created_at,updated_at,note';
const CMS_DRAFT_ALLOWED_STATUS = new Set(['draft', 'validated', 'submitted', 'published', 'discarded']);

export async function listCmsDrafts(client, options = {}) {
  if (!client) {
    return { data: [], error: new Error('Supabase client chưa sẵn sàng.') };
  }

  return runReadQuery('cmsDrafts', async () => {
    const includeDiscarded = options.includeDiscarded === true;
    let query = client
      .from(ADMIN_TABLES.cmsDrafts)
      .select(CMS_DRAFT_LIST_COLUMNS)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(normalizeDraftLimit(options.limit));

    if (!includeDiscarded) {
      query = query.neq('status', 'discarded');
    }

    const { data, error } = await query;
    return { data: safeArray(data), error };
  });
}

export async function getCmsDraft(client, draftId) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const id = normalizeUuidLike(draftId);
  if (!id) {
    return { data: null, error: new Error('Không tìm thấy ID bản nháp CMS.') };
  }

  return runReadQuery('cmsDraft', async () => {
    const { data, error } = await client
      .from(ADMIN_TABLES.cmsDrafts)
      .select(CMS_DRAFT_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    return { data: data || null, error };
  });
}

export async function createCmsDraft(client, payload = {}, userId = null) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const normalized = buildCmsDraftPayload(payload, userId, { inserting: true });
  const blocker = validateCmsDraftPayloadForWrite(normalized);
  if (blocker) return { data: null, error: blocker };

  const { data, error } = await client
    .from(ADMIN_TABLES.cmsDrafts)
    .insert(normalized)
    .select(CMS_DRAFT_COLUMNS)
    .maybeSingle();

  return { data: data || null, error };
}

export async function updateCmsDraft(client, draftId, payload = {}, userId = null, options = {}) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const id = normalizeUuidLike(draftId);
  if (!id) {
    return { data: null, error: new Error('Không tìm thấy ID bản nháp CMS cần cập nhật.') };
  }

  const expectedUpdatedAt = normalizeDraftRevisionToken(options.expectedUpdatedAt || payload.expectedUpdatedAt);
  if (!expectedUpdatedAt) {
    const error = new Error('Thiếu revision của bản chuẩn bị hiện tại. Hãy tải lại bản nháp rồi lưu lại.');
    error.code = 'DRAFT_SAVE_MISSING_REVISION';
    return { data: null, error };
  }

  const normalized = buildCmsDraftPayload(payload, userId, { inserting: false });
  const blocker = validateCmsDraftPayloadForWrite(normalized);
  if (blocker) return { data: null, error: blocker };

  const { data, error } = await client
    .from(ADMIN_TABLES.cmsDrafts)
    .update(normalized)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select(CMS_DRAFT_COLUMNS)
    .maybeSingle();

  if (error) return { data: null, error };
  if (!data) {
    const { data: currentRow, error: readError } = await client
      .from(ADMIN_TABLES.cmsDrafts)
      .select('id,updated_at')
      .eq('id', id)
      .maybeSingle();
    if (readError) return { data: null, error: readError };
    const currentUpdatedAt = normalizeDraftRevisionToken(currentRow?.updated_at);
    if (currentUpdatedAt && isSameMillisecondDifferentRevisionToken(currentUpdatedAt, expectedUpdatedAt)) {
      const mismatch = new Error('Không xác minh được phiên bản đã lưu của bản chuẩn bị. Website chưa thay đổi. Hãy tải lại bản chuẩn bị rồi thử lại.');
      mismatch.code = 'DRAFT_SAVE_REVISION_CONTRACT_MISMATCH';
      return { data: null, error: mismatch, conflict: false, revisionContractMismatch: true, currentUpdatedAt, expectedUpdatedAt };
    }
    const conflict = new Error('Bản chuẩn bị đã được thay đổi ở phiên khác. Nội dung của bạn chưa bị ghi đè. Hãy tải lại bản mới nhất trước khi lưu lại.');
    conflict.code = 'DRAFT_SAVE_CONFLICT';
    return { data: null, error: conflict, conflict: true, currentUpdatedAt: currentUpdatedAt || null, expectedUpdatedAt };
  }

  return { data, error: null };
}

export async function discardCmsDraft(client, draftId, userId = null) {
  if (!client) {
    return { data: null, error: new Error('Supabase client chưa sẵn sàng.') };
  }

  const id = normalizeUuidLike(draftId);
  if (!id) {
    return { data: null, error: new Error('Không tìm thấy ID bản nháp CMS cần hủy.') };
  }

  const payload = {
    status: 'discarded',
    updated_by: userId || null,
  };

  const { data, error } = await client
    .from(ADMIN_TABLES.cmsDrafts)
    .update(payload)
    .eq('id', id)
    .select(CMS_DRAFT_COLUMNS)
    .maybeSingle();

  return { data: data || null, error };
}

function buildCmsDraftPayload(payload = {}, userId = null, options = {}) {
  const status = normalizeDraftStatus(payload.status);
  const out = {
    title: normalizeDraftTitle(payload.title),
    status,
    content_json: cloneJsonValue(payload.content_json || payload.contentJson || {}),
    validation_json: cloneJsonValue(payload.validation_json || payload.validationJson || {}),
    source_version: normalizeOptionalText(payload.source_version || payload.sourceVersion),
    source_url: normalizeOptionalText(payload.source_url || payload.sourceUrl),
    source_type: normalizeOptionalText(payload.source_type || payload.sourceType),
    note: normalizeOptionalText(payload.note),
    updated_by: userId || null,
  };

  if (options.inserting) {
    out.created_by = userId || null;
  }

  return out;
}

function validateCmsDraftPayloadForWrite(payload = {}) {
  if (!payload.content_json || typeof payload.content_json !== 'object' || Array.isArray(payload.content_json)) {
    return new Error('Bản nháp CMS phải có content_json dạng object.');
  }
  if (!payload.title) {
    return new Error('Bản nháp CMS cần có tiêu đề.');
  }
  if (!CMS_DRAFT_ALLOWED_STATUS.has(payload.status)) {
    return new Error('Trạng thái bản nháp CMS không hợp lệ.');
  }
  return null;
}

function normalizeDraftLimit(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return 30;
  return Math.max(1, Math.min(100, number));
}

function normalizeUuidLike(value) {
  return String(value || '').trim().slice(0, 80);
}

function normalizeDraftTitle(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return (text || 'Bản nháp CMS').slice(0, 160);
}

function normalizeOptionalText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 1000) : null;
}

function normalizeDraftRevisionToken(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return Number.isFinite(Date.parse(text)) ? text : '';
}

function toComparableTimestampMs(value) {
  const time = Date.parse(String(value || '').trim());
  return Number.isFinite(time) ? time : null;
}

function isSameMillisecondDifferentRevisionToken(left, right) {
  const leftToken = normalizeDraftRevisionToken(left);
  const rightToken = normalizeDraftRevisionToken(right);
  if (!leftToken || !rightToken || leftToken === rightToken) return false;
  const leftMs = toComparableTimestampMs(leftToken);
  const rightMs = toComparableTimestampMs(rightToken);
  return leftMs !== null && rightMs !== null && leftMs === rightMs;
}

function normalizeDraftStatus(value) {
  const status = String(value || 'draft').trim().toLowerCase();
  return CMS_DRAFT_ALLOWED_STATUS.has(status) ? status : 'draft';
}

function cloneJsonValue(value) {
  try {
    return JSON.parse(JSON.stringify(value || {}));
  } catch {
    return {};
  }
}

async function runReadQuery(name, queryFn) {
  try {
    const result = await queryFn();
    return {
      name,
      data: result.data,
      error: result.error || null,
    };
  } catch (error) {
    return { name, data: null, error };
  }
}

function collectErrors(results) {
  return Object.entries(results).reduce((acc, [key, result]) => {
    if (result?.error) {
      acc[key] = result.error;
    }
    return acc;
  }, {});
}

function createEmptyDashboardData() {
  return {
    siteSettings: null,
    indexSections: [],
    gateContent: null,
    rooms: [],
    artworks: [],
    artworkStats: createEmptyArtworkStats(),
    publishedBundles: [],
    mediaAssets: [],
    cmsMediaUploads: [],
    canonicalCms: null,
    canonicalSummary: null,
    canonicalError: null,
    errors: {},
  };
}
