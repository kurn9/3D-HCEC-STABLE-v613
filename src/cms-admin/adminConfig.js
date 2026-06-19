export const SUPABASE_CONFIG = Object.freeze({
  url: 'https://ocmidhgabyrvqbvqgorw.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jbWlkaGdhYnlydnFidnFnb3J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MDEwMTIsImV4cCI6MjA5NTQ3NzAxMn0.NHLRMgXiogQHkh6L4V7HMfzuxTR4FGrtYiNzPM5eMGU',
});

export const ADMIN_TABLES = Object.freeze({
  profiles: 'profiles',
  siteSettings: 'site_settings',
  indexSections: 'index_sections',
  gateContent: 'gate_content',
  rooms: 'rooms',
  artworks: 'artworks',
  mediaAssets: 'media_assets',
  cmsMediaUploads: 'cms_media_uploads',
  publishedBundles: 'published_bundles',
  cmsDrafts: 'cms_drafts',
  cmsPublishLogs: 'cms_publish_logs',
  cmsCleanupRuns: 'cms_cleanup_runs',
  cmsCleanupItems: 'cms_cleanup_items',
});

export const ADMIN_ROLES = Object.freeze({
  admin: 'admin',
  editor: 'editor',
});

export const ADMIN_UI = Object.freeze({
  appTitle: 'Admin CMS',
  appSubtitle: 'Quản trị nội dung website triển lãm 3D',
  organizationFallback: 'Không gian Triển lãm 3D',
  readOnlyNotice: 'Bước hiện tại chỉ đọc dữ liệu. Chưa có lưu nháp, upload, publish hoặc rollback.',
  nextPhaseNotice: 'Chức năng này sẽ triển khai ở V6.11.21-C/D.',
  defaultTab: 'dashboard',
  artworkPageSizeOptions: [25, 50, 100],
  defaultArtworkPageSize: 50,
});

export const ADMIN_FEATURE_FLAGS = Object.freeze({
  readOnlyMode: true,
  allowWrites: false,
  allowSiteSettingsEdit: true,
  allowGateContentEdit: true,
  allowHomeHeroEdit: true,
  allowHomeGuideEdit: true,
  allowHomeExperienceEdit: true,
  allowMediaUpload: false,
  allowPublish: false,
  allowRollback: false,
  // V6.11.21-B6-F_K_O_I_H — static CMS JSON draft/export only.
  // This workflow edits an in-browser draft and exports JSON; it does not write DB/storage.
  allowStaticCmsDraftEdit: true,
  allowStaticCmsExport: true,
  allowStaticCmsPublish: false,
  allowStaticCmsUpload: false,
  allowStaticCmsRollback: false,
  // V6.11.21-B6-F_K_O_I_K — server-side draft persistence only.
  // Uses anon key + authenticated session + RLS; no publish/storage write.
  allowStaticCmsDraftPersistence: true,
  allowStaticCmsDraftDiscard: true,
  // V6.11.21-B6-F_K_O_I_L_APPLY — server-side media upload gate.
  // Upload is limited to static CMS draft workflow; it does not publish website or write latest CMS JSON.
  allowStaticCmsMediaUpload: true,
  // V6.11.21-B6-F_K_O_I_M_APPLY — server-side publish gate.
  // Admin-only; publishes saved cms_drafts through Edge Function with backup/verify/rollback.
  allowStaticCmsPublishGate: true,
  // V6.11.21-B6-F_K_O_I_N_APPLY — server-side rollback/version history gate.
  // Admin-only; rollback goes through Edge Function rollback-cms-json and never accepts free JSON from the browser.
  allowStaticCmsRollbackGate: true,
  // V6.12-A1_APPLY — storage cleanup scan/dry-run foundation.
  // Scan/dry-run only; delete/purge remain disabled both UI-side and server-side.
  allowCmsStorageCleanupScan: true,
  // V6.12-A2_APPLY — guarded server-side safe delete for cms-media/unreferenced only.
  // Default false: operator must explicitly enable for staging after reviewing dry-run evidence.
  allowCmsStorageCleanupSafeDelete: false,
  allowCmsStorageCleanupDelete: false,
  allowCmsStorageCleanupPurge: false,
});

export const STATIC_CMS_DRAFT_CONFIG = Object.freeze({
  enabled: true,
  remoteUrl: 'https://ocmidhgabyrvqbvqgorw.supabase.co/storage/v1/object/public/cms-public/published/cms_public_content.json',
  fallbackUrl: './data/cms_content_fallback.json',
  localGeneratedUrl: './cms_public_content.generated.json',
  exportVersion: 'V6.11.21-B6-F_K_O_I_H_DRAFT',
  exportSource: 'cms-admin-static-draft-export',
  expectedIds: Object.freeze({
    indoor: Object.freeze(['LOGO_001', 'LOGO_002', 'VIDEO_001', 'ART_001']),
    outdoor: Object.freeze(['LOGO_001', 'VIDEO_001', 'ART_001']),
  }),
  allowedMediaOrigins: Object.freeze([
    'https://ocmidhgabyrvqbvqgorw.supabase.co',
    'https://pub-d00970587980484399ff842b58cd1e9e.r2.dev',
  ]),
  allowedMediaHosts: Object.freeze([
    'ocmidhgabyrvqbvqgorw.supabase.co',
    'pub-d00970587980484399ff842b58cd1e9e.r2.dev',
  ]),
  allowedMediaPathPrefixes: Object.freeze([
    './assets/',
    'assets/',
    '/assets/',
  ]),
});

export const CMS_MEDIA_UPLOAD_CONFIG = Object.freeze({
  enabled: true,
  edgeFunctionName: 'upload-cms-media',
  endpoint: `${SUPABASE_CONFIG.url}/functions/v1/upload-cms-media`,
  bucket: 'cms-media',
  allowedTargetTypes: Object.freeze(['room_artwork', 'index_featured']),
  featuredSectionKey: 'index.featuredArtworks',
  featuredFieldNames: Object.freeze(['image', 'imageUrl', 'image_url']),
  allowedRoomKeys: Object.freeze(['indoor', 'outdoor']),
  allowedMediaKinds: Object.freeze(['image', 'poster', 'video']),
  allowedFieldNames: Object.freeze([
    'image',
    'imageUrl',
    'image_url',
    'poster',
    'posterUrl',
    'poster_url',
    'videoUrl',
    'video_url',
  ]),
  acceptByKind: Object.freeze({
    image: 'image/jpeg,image/png,image/webp',
    poster: 'image/jpeg,image/png,image/webp',
    video: 'video/mp4',
  }),
  maxBytesByKind: Object.freeze({
    image: 5 * 1024 * 1024,
    poster: 3 * 1024 * 1024,
    video: 50 * 1024 * 1024,
  }),
});

export const CMS_MEDIA_DELETE_CONFIG = Object.freeze({
  enabled: true,
  edgeFunctionName: 'delete-cms-media',
  endpoint: `${SUPABASE_CONFIG.url}/functions/v1/delete-cms-media`,
  bucket: 'cms-media',
  prepareOnly: true,
  confirmDeleteEnabled: false,
  allowedTargetTypes: Object.freeze(['room_artwork', 'index_featured']),
});



export const CMS_PUBLISH_GATE_CONFIG = Object.freeze({
  enabled: true,
  edgeFunctionName: 'publish-cms-json',
  endpoint: `${SUPABASE_CONFIG.url}/functions/v1/publish-cms-json`,
  latestBucket: 'cms-public',
  latestPath: 'published/cms_public_content.json',
  adminOnly: true,
});



export const CMS_ROLLBACK_GATE_CONFIG = Object.freeze({
  enabled: true,
  edgeFunctionName: 'rollback-cms-json',
  endpoint: `${SUPABASE_CONFIG.url}/functions/v1/rollback-cms-json`,
  latestBucket: 'cms-public',
  latestPath: 'published/cms_public_content.json',
  versionPrefix: 'published/versions/',
  publicStorageBaseUrl: `${SUPABASE_CONFIG.url}/storage/v1/object/public/cms-public`,
  adminOnly: true,
});

export const CMS_STORAGE_CLEANUP_CONFIG = Object.freeze({
  enabled: true,
  edgeFunctionName: 'cleanup-cms-storage',
  endpoint: `${SUPABASE_CONFIG.url}/functions/v1/cleanup-cms-storage`,
  defaultScope: 'all',
  defaultRetentionDays: 30,
  minRetentionDays: 7,
  defaultKeepLastVersions: 20,
  minKeepLastVersions: 5,
  adminOnly: true,
  safeDeleteEnabled: false,
  deleteEnabled: false,
  purgeEnabled: false,
});

export function getSupabaseConfigStatus() {
  const url = String(SUPABASE_CONFIG.url || '').trim();
  const anonKey = String(SUPABASE_CONFIG.anonKey || '').trim();
  const missing = [];

  if (!url || url === 'YOUR_SUPABASE_URL') {
    missing.push('SUPABASE_URL');
  }

  if (!anonKey || anonKey === 'YOUR_SUPABASE_ANON_KEY') {
    missing.push('SUPABASE_ANON_KEY');
  }

  return {
    ready: missing.length === 0,
    missing,
    url,
    hasAnonKey: Boolean(anonKey && anonKey !== 'YOUR_SUPABASE_ANON_KEY'),
  };
}
