#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  BACKUP_SOURCE_FILES,
  assertSafeProjectRelativePath,
  backupManifestToMarkdown,
  countCmsItems,
  countSceneItems,
  formatTimestamp,
  makeMediaManifest,
  mediaManifestToMarkdown,
  pathExists,
  safeReadJson,
  sanitizeId,
  sha256File,
  writeJson,
  writeText,
} from './backup_utils.mjs';

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function getOption(name, fallback = '') {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function printHelp() {
  console.log(`Usage:
  node scripts/release/create_backup.mjs --dry-run --room all
  node scripts/release/create_backup.mjs --write --room indoor --version V6.11.21-B6-E_B

Modes:
  --dry-run   Plan backup only; creates no backup folder. Default.
  --write     Create local file-level backup folder.

Rooms:
  --room indoor|outdoor|all
`);
}

if (hasFlag('--help') || hasFlag('-h')) {
  printHelp();
  process.exit(0);
}

const projectRoot = process.cwd();
const room = String(getOption('--room', 'all')).toLowerCase();
if (!['indoor', 'outdoor', 'all'].includes(room)) {
  console.error(`[backup] Invalid --room: ${room}`);
  process.exit(1);
}

const writeMode = hasFlag('--write') && !hasFlag('--dry-run');
const mode = writeMode ? 'write' : 'dry-run';
const versionId = sanitizeId(getOption('--version', 'manual'));
const timestamp = formatTimestamp();
const backupId = `${timestamp}_${room}_${versionId}`;
const backupRoot = path.join(projectRoot, 'backups', backupId);
const sourceFiles = [...new Set(BACKUP_SOURCE_FILES[room])];
const copiedFiles = [];
const missingFiles = [];
const sourceFileEntries = [];
const itemCounts = {};
const sceneDataByRoom = {};
let cmsFallback = null;

for (const relPath of sourceFiles) {
  const safeRelPath = assertSafeProjectRelativePath(relPath);
  const absPath = path.join(projectRoot, safeRelPath);
  const exists = await pathExists(absPath);
  const entry = { path: safeRelPath, exists, sha256: null, bytes: null, itemCount: null };
  if (!exists) {
    missingFiles.push(safeRelPath);
    sourceFileEntries.push(entry);
    continue;
  }

  const stat = await fs.stat(absPath);
  entry.bytes = stat.size;
  entry.sha256 = await sha256File(absPath);
  const parsed = await safeReadJson(absPath);
  if (parsed.ok) {
    if (safeRelPath === 'data/scene.json') {
      entry.itemCount = countSceneItems(parsed.value);
      itemCounts.sceneIndoor = entry.itemCount;
      sceneDataByRoom.indoor = parsed.value;
    } else if (safeRelPath === 'data/scene_outdoor.json') {
      entry.itemCount = countSceneItems(parsed.value);
      itemCounts.sceneOutdoor = entry.itemCount;
      sceneDataByRoom.outdoor = parsed.value;
    } else if (safeRelPath === 'data/cms_content_fallback.json') {
      itemCounts.cmsFallback = countCmsItems(parsed.value);
      cmsFallback = parsed.value;
    } else if (safeRelPath === 'supabase/cms_public_content.generated.json') {
      itemCounts.cmsGenerated = countCmsItems(parsed.value);
    }
  }

  if (writeMode) {
    const dest = path.join(backupRoot, 'files', safeRelPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(absPath, dest);
    copiedFiles.push({ sourcePath: safeRelPath, backupPath: path.relative(backupRoot, dest).replace(/\\/g, '/') });
  }
  sourceFileEntries.push(entry);
}

const mediaManifest = await makeMediaManifest(projectRoot, sceneDataByRoom, cmsFallback);
const manifest = {
  schemaVersion: 'local-file-backup.v1',
  backupId,
  versionId,
  room,
  createdAt: new Date().toISOString(),
  mode,
  backupFolder: writeMode ? path.relative(projectRoot, backupRoot).replace(/\\/g, '/') : null,
  sourceFiles: sourceFileEntries,
  copiedFiles,
  missingFiles,
  excludedPaths: ['.env', '.env.*', 'supabase/.env', 'supabase/.env.*', 'node_modules', 'supabase/node_modules', 'assets/**', 'backups/**'],
  hashes: Object.fromEntries(sourceFileEntries.filter((entry) => entry.sha256).map((entry) => [entry.path, entry.sha256])),
  itemCounts,
  mediaSummary: {
    uniqueMediaCount: mediaManifest.uniqueMediaCount,
    missingMediaCount: mediaManifest.missingMediaCount,
    remoteMediaCount: mediaManifest.remoteMediaCount,
  },
  securityNotes: [
    'No .env or secret file is copied by this backup workflow.',
    'Binary media/assets are not copied in B6-E_B; only media manifest is generated.',
    'This is local file-level backup only. It does not backup or restore Supabase production data.',
  ],
  publishStatus: 'BACKUP_ONLY_NO_PUBLISH',
  noSecretsIncluded: true,
};

if (writeMode) {
  await writeJson(path.join(backupRoot, 'backup_manifest.json'), manifest);
  await writeText(path.join(backupRoot, 'backup_manifest.md'), backupManifestToMarkdown(manifest));
  await writeJson(path.join(backupRoot, 'media_manifest.json'), mediaManifest);
  await writeText(path.join(backupRoot, 'media_manifest.md'), mediaManifestToMarkdown(mediaManifest));
}

console.log(`[backup] ${mode.toUpperCase()} complete`);
console.log(`[backup] backupId=${backupId}`);
console.log(`[backup] room=${room}`);
console.log(`[backup] sourceFiles=${sourceFiles.length} missing=${missingFiles.length}`);
console.log(`[backup] media unique=${mediaManifest.uniqueMediaCount} missing=${mediaManifest.missingMediaCount}`);
if (writeMode) console.log(`[backup] folder=${path.relative(projectRoot, backupRoot)}`);
else console.log('[backup] No files written. Re-run with --write to create local backup folder.');
if (missingFiles.length) {
  console.log(`[backup] Missing files:\n- ${missingFiles.join('\n- ')}`);
}
