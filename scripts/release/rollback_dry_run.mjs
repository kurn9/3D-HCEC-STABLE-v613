#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import {
  assertSafeProjectRelativePath,
  resolveBackupPathInsideBackups,
  formatTimestamp,
  pathExists,
  restorePlanToMarkdown,
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
  node scripts/release/rollback_dry_run.mjs --backup backups/<backupId> --out reports/rollback.md
  node scripts/release/rollback_dry_run.mjs --manifest backups/<backupId>/backup_manifest.json --out reports/rollback.md

Notes:
  --backup and --manifest must resolve inside backups/**.
  Use --out to create the JSON/MD rollback dry-run report required by the publish gate.
`);
}
if (hasFlag('--help') || hasFlag('-h')) { printHelp(); process.exit(0); }

const projectRoot = process.cwd();
const backupArg = getOption('--backup', '');
const manifestArg = getOption('--manifest', '');
const outArg = getOption('--out', '');
let manifestPath = '';
try {
  if (manifestArg) {
    manifestPath = resolveBackupPathInsideBackups(manifestArg, projectRoot);
  } else if (backupArg) {
    const backupDir = resolveBackupPathInsideBackups(backupArg, projectRoot);
    manifestPath = path.join(backupDir, 'backup_manifest.json');
  }
} catch (error) {
  console.error(`[rollback-dry-run] ${error.message}`);
  process.exit(1);
}

if (!manifestPath) {
  console.error('[rollback-dry-run] Missing --backup or --manifest.');
  process.exit(1);
}

const manifestRead = await safeReadJson(manifestPath);
if (!manifestRead.ok) {
  console.error(`[rollback-dry-run] Cannot read manifest: ${manifestRead.error}`);
  process.exit(1);
}
const manifest = manifestRead.value;
const backupDir = path.dirname(manifestPath);
const restorePlan = [];
const riskSummary = [];

for (const copied of manifest.copiedFiles || []) {
  const sourcePath = assertSafeProjectRelativePath(copied.sourcePath);
  const backupFile = path.resolve(backupDir, String(copied.backupPath || '').replace(/\\/g, '/'));
  const backupRelative = path.relative(backupDir, backupFile);
  const backupPath = path.relative(projectRoot, backupFile).replace(/\\/g, '/');
  if (!backupRelative || backupRelative.startsWith('..') || path.isAbsolute(backupRelative)) {
    riskSummary.push(`Backup file path escapes backup folder: ${copied.backupPath || ''}`);
    restorePlan.push({
      sourcePath,
      backupPath,
      currentExists: await pathExists(path.resolve(projectRoot, sourcePath)),
      backupExists: false,
      currentSha256: null,
      backupSha256: null,
      changed: true,
    });
    continue;
  }
  const currentFile = path.resolve(projectRoot, sourcePath);
  const backupExists = await pathExists(backupFile);
  const currentExists = await pathExists(currentFile);
  const backupSha256 = backupExists ? await sha256File(backupFile) : null;
  const currentSha256 = currentExists ? await sha256File(currentFile) : null;
  if (!backupExists) riskSummary.push(`Backup file missing: ${backupPath}`);
  if (!currentExists) riskSummary.push(`Current file missing: ${sourcePath}`);
  restorePlan.push({
    sourcePath,
    backupPath: path.relative(projectRoot, backupFile).replace(/\\/g, '/'),
    currentExists,
    backupExists,
    currentSha256,
    backupSha256,
    changed: currentSha256 !== backupSha256,
  });
}

if (!restorePlan.length) riskSummary.push('No copied files in backup manifest. Dry-run cannot produce a restore plan.');

const rollbackDryRunId = `rollback-dry-run_${formatTimestamp()}_${sanitizeId(manifest.backupId || 'backup')}`;
const plan = {
  schemaVersion: 'rollback-dry-run.v1',
  rollbackDryRunId,
  backupId: manifest.backupId || '',
  room: manifest.room || 'unknown',
  createdAt: new Date().toISOString(),
  currentHashes: Object.fromEntries(restorePlan.map((item) => [item.sourcePath, item.currentSha256])),
  backupHashes: Object.fromEntries(restorePlan.map((item) => [item.sourcePath, item.backupSha256])),
  restorePlan,
  riskSummary,
  status: riskSummary.length ? 'WARN' : 'PASS',
  publishStatus: 'ROLLBACK_DRY_RUN_ONLY_NO_RESTORE',
};

const markdown = restorePlanToMarkdown(plan);
if (outArg) {
  const outPath = path.resolve(projectRoot, outArg);
  await writeText(outPath, markdown);
  const jsonOut = outPath.replace(/\.md$/i, '.json');
  if (jsonOut !== outPath) await writeJson(jsonOut, plan);
  console.log(`[rollback-dry-run] report=${path.relative(projectRoot, outPath)}`);
} else {
  console.log(markdown);
}

if (plan.status === 'PASS') console.log(`[rollback-dry-run] PASS ${rollbackDryRunId}`);
else console.log(`[rollback-dry-run] WARN ${rollbackDryRunId}`);
