#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_MAX_MEDIA_HASH_BYTES = 50 * 1024 * 1024;

export const FORBIDDEN_PATH_PATTERNS = [
  /(^|[\\/])\.env(\.|$|[\\/])?/i,
  /(^|[\\/])node_modules([\\/]|$)/i,
  /(^|[\\/])\.git([\\/]|$)/i,
  /(^|[\\/])assets([\\/]|$)/i,
  /(^|[\\/])reports([\\/]|$)/i,
  /(^|[\\/])backups([\\/]|$)/i,
];

export const BACKUP_SOURCE_FILES = {
  indoor: [
    'data/scene.json',
    'data/cms_content_fallback.json',
    'cms_public_content.generated.json',
    'supabase/cms_public_content.generated.json',
    'data/asset_manifest.json',
  ],
  outdoor: [
    'data/scene_outdoor.json',
    'data/cms_content_fallback.json',
    'cms_public_content.generated.json',
    'supabase/cms_public_content.generated.json',
    'data/asset_manifest.json',
  ],
  all: [
    'data/scene.json',
    'data/scene_outdoor.json',
    'data/cms_content_fallback.json',
    'cms_public_content.generated.json',
    'supabase/cms_public_content.generated.json',
    'data/asset_manifest.json',
  ],
};

export function normalizeRelPath(input) {
  return String(input || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .trim();
}


export function resolveProjectPath(projectRoot, inputPath) {
  const normalized = String(inputPath || '').replace(/\\/g, '/').trim();
  if (!normalized) throw new Error('Backup path is required.');
  return path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(projectRoot, normalized);
}

export function isPathInsideBackups(inputPath, projectRoot = process.cwd()) {
  try {
    const resolvedPath = typeof inputPath === 'string' ? resolveProjectPath(projectRoot, inputPath) : path.resolve(String(inputPath || ''));
    const backupsRoot = path.resolve(projectRoot, 'backups');
    const relative = path.relative(backupsRoot, resolvedPath);
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

export function assertPathInsideBackups(resolvedPath, projectRoot = process.cwd()) {
  const candidate = path.resolve(String(resolvedPath || ''));
  const backupsRoot = path.resolve(projectRoot, 'backups');
  const relative = path.relative(backupsRoot, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Backup path must be inside backups/**.');
  }
  return candidate;
}

export function resolveBackupPathInsideBackups(inputPath, projectRoot = process.cwd()) {
  const resolvedPath = resolveProjectPath(projectRoot, inputPath);
  return assertPathInsideBackups(resolvedPath, projectRoot);
}

export function assertSafeProjectRelativePath(relPath) {
  const normalized = normalizeRelPath(relPath);
  if (!normalized || normalized.includes('..')) {
    throw new Error(`Unsafe path: ${relPath}`);
  }
  for (const pattern of FORBIDDEN_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      throw new Error(`Forbidden path excluded from backup/release workflow: ${normalized}`);
    }
  }
  return normalized;
}

export function formatTimestamp(date = new Date()) {
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

export function sanitizeId(value, fallback = 'manual') {
  const text = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || fallback;
}

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function statIfExists(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    for await (const chunk of handle.createReadStream()) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export async function safeReadJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return { ok: true, value: JSON.parse(raw), raw };
  } catch (error) {
    return { ok: false, error: error.message, value: null, raw: '' };
  }
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

export function countSceneItems(value) {
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value?.items)) return value.items.length;
  if (Array.isArray(value?.artworks)) return value.artworks.length;
  return 0;
}

export function countCmsItems(value) {
  const rooms = value?.rooms && typeof value.rooms === 'object' ? value.rooms : {};
  const output = {};
  for (const room of ['indoor', 'outdoor']) {
    const artworks = rooms?.[room]?.artworks;
    output[room] = Array.isArray(artworks) ? artworks.length : 0;
  }
  output.total = Object.values(output).reduce((sum, item) => sum + Number(item || 0), 0);
  return output;
}

function pushMediaRef(refs, source, room, item, key, value) {
  if (value == null || String(value).trim() === '') return;
  refs.push({
    id: item?.id || item?.artwork_code || item?.code || '',
    room,
    source,
    itemType: item?.type || item?.mediaType || '',
    field: key,
    path: String(value).trim(),
    referencedBy: item?.id || item?.artwork_code || item?.code || item?.title || '',
  });
}

export function collectMediaRefsFromScene(value, source, room) {
  const list = Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : []);
  const refs = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    for (const key of ['image', 'src', 'thumbnail', 'poster', 'videoUrl', 'video', 'mediaUrl', 'audioUrl']) {
      pushMediaRef(refs, source, room, item, key, item[key]);
    }
  }
  return refs;
}

export function collectMediaRefsFromCms(value, source) {
  const refs = [];
  const rooms = value?.rooms && typeof value.rooms === 'object' ? value.rooms : {};
  for (const room of Object.keys(rooms)) {
    const artworks = Array.isArray(rooms[room]?.artworks) ? rooms[room].artworks : [];
    for (const item of artworks) {
      for (const key of ['image', 'image_url', 'thumbnail', 'thumbnail_url', 'poster', 'poster_url', 'videoUrl', 'video_url', 'audio_url']) {
        pushMediaRef(refs, source, room, item, key, item?.[key]);
      }
    }
  }
  return refs;
}

export function isRemoteUrl(mediaPath) {
  return /^https?:\/\//i.test(String(mediaPath || '')) || /^data:/i.test(String(mediaPath || ''));
}

export function mediaPathToLocalPath(projectRoot, mediaPath) {
  const clean = String(mediaPath || '').split(/[?#]/)[0].replace(/^\.\//, '').replace(/^\//, '');
  if (!clean || isRemoteUrl(clean) || clean.includes('..')) return null;
  return path.join(projectRoot, clean);
}

export async function makeMediaManifest(projectRoot, sceneDataByRoom = {}, cmsData = null, options = {}) {
  const maxHashBytes = Number(options.maxHashBytes || DEFAULT_MAX_MEDIA_HASH_BYTES);
  const refs = [];
  for (const [room, value] of Object.entries(sceneDataByRoom)) {
    refs.push(...collectMediaRefsFromScene(value, `scene:${room}`, room));
  }
  if (cmsData) refs.push(...collectMediaRefsFromCms(cmsData, 'cms:fallback'));

  const seen = new Map();
  const entries = [];
  for (const ref of refs) {
    const key = `${ref.room}|${ref.path}`;
    const existing = seen.get(key);
    if (existing) {
      existing.referencedByList.push(ref.referencedBy);
      continue;
    }
    const localPath = mediaPathToLocalPath(projectRoot, ref.path);
    const stat = localPath ? await statIfExists(localPath) : null;
    let sha256 = null;
    let hashSkipped = false;
    if (stat?.isFile() && stat.size <= maxHashBytes) {
      sha256 = await sha256File(localPath);
    } else if (stat?.isFile() && stat.size > maxHashBytes) {
      hashSkipped = true;
    }
    const entry = {
      id: ref.id,
      room: ref.room,
      source: ref.source,
      itemType: ref.itemType,
      field: ref.field,
      path: ref.path,
      existsLocal: Boolean(stat?.isFile()),
      isRemote: isRemoteUrl(ref.path),
      sizeBytes: stat?.isFile() ? stat.size : null,
      sha256,
      hashSkipped,
      referencedByList: [ref.referencedBy].filter(Boolean),
      notes: localPath ? [] : ['remote-or-non-local-path'],
    };
    seen.set(key, entry);
    entries.push(entry);
  }

  const missingMedia = entries.filter((entry) => !entry.existsLocal && !entry.isRemote).map((entry) => entry.path);
  const remoteMedia = entries.filter((entry) => entry.isRemote).map((entry) => entry.path);
  return {
    schemaVersion: 'backup-media-manifest.v1',
    generatedAt: new Date().toISOString(),
    maxHashBytes,
    totalRefs: refs.length,
    uniqueMediaCount: entries.length,
    missingMediaCount: missingMedia.length,
    remoteMediaCount: remoteMedia.length,
    missingMedia,
    remoteMedia,
    entries,
  };
}

export function backupManifestToMarkdown(manifest) {
  const lines = [];
  lines.push(`# Backup Manifest ${manifest.backupId}`);
  lines.push('');
  lines.push(`- Version: ${manifest.versionId}`);
  lines.push(`- Room: ${manifest.room}`);
  lines.push(`- Created: ${manifest.createdAt}`);
  lines.push(`- Mode: ${manifest.mode}`);
  lines.push(`- Publish status: ${manifest.publishStatus}`);
  lines.push(`- No secrets included: ${manifest.noSecretsIncluded ? 'YES' : 'NO'}`);
  lines.push('');
  lines.push('## Source files');
  for (const item of manifest.sourceFiles) {
    lines.push(`- ${item.path}: ${item.exists ? 'FOUND' : 'MISSING'}${item.sha256 ? ` · sha256 ${item.sha256}` : ''}`);
  }
  lines.push('');
  lines.push('## Copied files');
  if (!manifest.copiedFiles.length) lines.push('- None; dry-run or no files copied.');
  for (const item of manifest.copiedFiles) lines.push(`- ${item.sourcePath} -> ${item.backupPath}`);
  lines.push('');
  lines.push('## Counts');
  lines.push('```json');
  lines.push(JSON.stringify(manifest.itemCounts, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Security notes');
  for (const note of manifest.securityNotes || []) lines.push(`- ${note}`);
  return `${lines.join('\n')}\n`;
}

export function mediaManifestToMarkdown(mediaManifest) {
  const lines = [];
  lines.push('# Media Manifest');
  lines.push('');
  lines.push(`- Generated: ${mediaManifest.generatedAt}`);
  lines.push(`- Unique media: ${mediaManifest.uniqueMediaCount}`);
  lines.push(`- Missing media: ${mediaManifest.missingMediaCount}`);
  lines.push(`- Remote media: ${mediaManifest.remoteMediaCount}`);
  lines.push('');
  lines.push('## Missing media');
  if (!mediaManifest.missingMedia.length) lines.push('- None detected.');
  for (const item of mediaManifest.missingMedia) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Entries');
  for (const entry of mediaManifest.entries) {
    lines.push(`- [${entry.existsLocal ? 'OK' : (entry.isRemote ? 'REMOTE' : 'MISSING')}] ${entry.room} · ${entry.path}`);
  }
  return `${lines.join('\n')}\n`;
}

export function restorePlanToMarkdown(plan) {
  const lines = [];
  lines.push(`# Rollback Dry-run ${plan.rollbackDryRunId}`);
  lines.push('');
  lines.push(`- Backup ID: ${plan.backupId}`);
  lines.push(`- Room: ${plan.room}`);
  lines.push(`- Created: ${plan.createdAt}`);
  lines.push(`- Status: ${plan.status}`);
  lines.push(`- Publish status: ${plan.publishStatus}`);
  lines.push('');
  lines.push('## Restore plan');
  if (!plan.restorePlan.length) lines.push('- No restorable files found.');
  for (const item of plan.restorePlan) {
    lines.push(`- ${item.sourcePath}: current=${item.currentSha256 || 'missing'} backup=${item.backupSha256 || 'missing'} changed=${item.changed}`);
  }
  lines.push('');
  lines.push('## Risks');
  if (!plan.riskSummary.length) lines.push('- None detected in dry-run.');
  for (const item of plan.riskSummary) lines.push(`- ${item}`);
  return `${lines.join('\n')}\n`;
}
