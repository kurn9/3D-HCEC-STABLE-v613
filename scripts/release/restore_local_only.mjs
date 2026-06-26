#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  assertSafeProjectRelativePath,
  resolveBackupPathInsideBackups,
  formatTimestamp,
  pathExists,
  safeReadJson,
  sanitizeId,
  sha256File,
  writeJson,
  writeText,
} from './backup_utils.mjs';

const args = process.argv.slice(2);
function hasFlag(name) { return args.includes(name); }
function getOption(name, fallback = '') {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
function printHelp() {
  console.log(`Usage:
  node scripts/release/restore_local_only.mjs --backup backups/<backupId> --room indoor
  node scripts/release/restore_local_only.mjs --manifest backups/<backupId>/backup_manifest.json --room all
  node scripts/release/restore_local_only.mjs --backup backups/<backupId> --room all --write --confirm-restore-local

Default is dry-run. --backup and --manifest must resolve inside backups/**.
This script restores local data files only. It never restores Supabase or Storage.
`);
}
if (hasFlag('--help') || hasFlag('-h')) { printHelp(); process.exit(0); }

const projectRoot = process.cwd();
const backupArg = getOption('--backup', '');
const manifestArg = getOption('--manifest', '');
const room = String(getOption('--room', 'all')).toLowerCase();
const writeMode = hasFlag('--write');
const confirmed = hasFlag('--confirm-restore-local');
if (!backupArg && !manifestArg) {
  console.error('[restore-local] Missing --backup or --manifest.');
  process.exit(1);
}
if (!['indoor', 'outdoor', 'all'].includes(room)) {
  console.error(`[restore-local] Invalid --room: ${room}`);
  process.exit(1);
}
if (writeMode && !confirmed) {
  console.error('[restore-local] Real local restore requires --confirm-restore-local. No files changed.');
  process.exit(1);
}

let backupDir = '';
let manifestPath = '';
try {
  if (manifestArg) {
    manifestPath = resolveBackupPathInsideBackups(manifestArg, projectRoot);
    backupDir = path.dirname(manifestPath);
  } else {
    backupDir = resolveBackupPathInsideBackups(backupArg, projectRoot);
    manifestPath = path.join(backupDir, 'backup_manifest.json');
  }
} catch (error) {
  console.error(`[restore-local] ${error.message}`);
  process.exit(1);
}

const manifestRead = await safeReadJson(manifestPath);
if (!manifestRead.ok) {
  console.error(`[restore-local] Cannot read backup manifest: ${manifestRead.error}`);
  process.exit(1);
}
const manifest = manifestRead.value;

function sourceAllowedForRoom(sourcePath) {
  if (room === 'all') return true;
  if (sourcePath === 'data/cms_content_fallback.json') return true;
  if (sourcePath === 'cms_public_content.generated.json') return true;
  if (sourcePath === 'supabase/cms_public_content.generated.json') return true;
  if (sourcePath === 'data/asset_manifest.json') return true;
  if (room === 'indoor') return sourcePath === 'data/scene.json';
  if (room === 'outdoor') return sourcePath === 'data/scene_outdoor.json';
  return false;
}

const restoreId = `restore-local_${formatTimestamp()}_${sanitizeId(manifest.backupId || 'backup')}`;
const safetyRoot = path.join(projectRoot, 'backups', '_restore_safety', restoreId);
const restored = [];
const skipped = [];
const risks = [];

for (const copied of manifest.copiedFiles || []) {
  const sourcePath = assertSafeProjectRelativePath(copied.sourcePath);
  if (!sourceAllowedForRoom(sourcePath)) {
    skipped.push({ sourcePath, reason: `not in requested room scope ${room}` });
    continue;
  }
  const backupFile = path.resolve(backupDir, String(copied.backupPath || '').replace(/\\/g, '/'));
  const backupRelative = path.relative(backupDir, backupFile);
  const targetFile = path.resolve(projectRoot, sourcePath);
  if (!backupRelative || backupRelative.startsWith('..') || path.isAbsolute(backupRelative)) {
    risks.push(`Backup file path escapes backup folder: ${copied.backupPath || ''}`);
    continue;
  }
  const backupExists = await pathExists(backupFile);
  if (!backupExists) {
    risks.push(`Backup file missing: ${copied.backupPath}`);
    continue;
  }
  const backupSha256 = await sha256File(backupFile);
  const currentSha256 = await pathExists(targetFile) ? await sha256File(targetFile) : null;

  if (writeMode) {
    const safetyFile = path.join(safetyRoot, sourcePath);
    await fs.mkdir(path.dirname(safetyFile), { recursive: true });
    if (await pathExists(targetFile)) await fs.copyFile(targetFile, safetyFile);
    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    await fs.copyFile(backupFile, targetFile);
    const restoredSha256 = await sha256File(targetFile);
    if (restoredSha256 !== backupSha256) risks.push(`Post-restore hash mismatch: ${sourcePath}`);
  }

  restored.push({ sourcePath, backupPath: copied.backupPath, currentSha256, backupSha256, writeMode });
}

const report = {
  schemaVersion: 'restore-local-only.v1',
  restoreId,
  backupId: manifest.backupId || '',
  room,
  createdAt: new Date().toISOString(),
  mode: writeMode ? 'write' : 'dry-run',
  publishStatus: 'LOCAL_RESTORE_ONLY_NO_SUPABASE_NO_STORAGE',
  safetyCopyFolder: writeMode ? path.relative(projectRoot, safetyRoot).replace(/\\/g, '/') : null,
  restored,
  skipped,
  risks,
};

const lines = [];
lines.push(`# Local Restore Report ${restoreId}`);
lines.push('');
lines.push(`- Backup ID: ${report.backupId}`);
lines.push(`- Room: ${room}`);
lines.push(`- Mode: ${report.mode}`);
lines.push(`- Status: ${risks.length ? 'WARN' : 'PASS'}`);
lines.push(`- Publish status: ${report.publishStatus}`);
lines.push('');
lines.push('## Files');
if (!restored.length) lines.push('- No files restored/planned.');
for (const item of restored) lines.push(`- ${item.sourcePath}: ${writeMode ? 'restored' : 'planned'}`);
lines.push('');
lines.push('## Risks');
if (!risks.length) lines.push('- None detected.');
for (const item of risks) lines.push(`- ${item}`);
lines.push('');
lines.push('This script never restores Supabase production data, Storage, .env, or binary media assets.');

if (writeMode) {
  await writeJson(path.join(safetyRoot, 'restore_local_report.json'), report);
  await writeText(path.join(safetyRoot, 'restore_local_report.md'), `${lines.join('\n')}\n`);
  console.log(`[restore-local] RESTORED local files only. safetyCopy=${path.relative(projectRoot, safetyRoot)}`);
} else {
  console.log(`${lines.join('\n')}\n`);
  console.log('[restore-local] Dry-run only. Re-run with --write --confirm-restore-local to restore local files.');
}
