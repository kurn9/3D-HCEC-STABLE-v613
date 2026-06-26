#!/usr/bin/env node
/**
 * Read-only clean release manifest generator for 3D Gallery.
 * It does not copy, zip, or mutate files. It lists files that are safe to include
 * and fails if forbidden paths would enter the release manifest.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const rootArg = args.find((arg) => !arg.startsWith('--')) || process.cwd();
const ROOT = path.resolve(rootArg);
const outputArgIndex = args.indexOf('--out');
const OUT_PATH = outputArgIndex >= 0 ? path.resolve(args[outputArgIndex + 1] || '') : null;
const jsonMode = args.includes('--json');

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.cache', '.vite', 'coverage', '__pycache__']);
const EXCLUDED_TOP_DIRS = new Set(['assets', 'reports', 'backups']);
const EXCLUDED_EXTS = new Set(['.zip', '.tar', '.gz', '.7z', '.rar', '.bak', '.backup', '.old', '.orig', '.log', '.tmp', '.temp', '.swp', '.pem', '.key', '.p12', '.pfx']);
const LARGE_MEDIA_EXTS = new Set(['.glb', '.gltf', '.bin', '.mp4', '.mov', '.webm', '.mp3', '.wav', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.hdr', '.ico']);
const findings = [];
const included = [];
const excluded = [];

function rel(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/') || '.';
}
function addFinding(severity, code, message, file = '') {
  findings.push({ severity, code, message, file });
}
function isEnvLike(relative) {
  return relative === '.env' || relative.startsWith('.env.') || relative === 'supabase/.env' || relative.startsWith('supabase/.env.');
}
function shouldExclude(filePath, entry = null) {
  const relative = rel(filePath);
  const parts = relative.split('/');
  if (parts.some((part) => EXCLUDED_DIRS.has(part))) return { exclude: true, reason: 'generated/dependency/cache directory' };
  if (EXCLUDED_TOP_DIRS.has(parts[0])) {
    const reason = parts[0] === 'assets'
      ? 'large runtime assets excluded from source-only clean release manifest; storage verification owns assets'
      : 'generated release evidence excluded from source-only clean release manifest';
    return { exclude: true, reason };
  }
  if (isEnvLike(relative)) return { exclude: true, reason: 'secret/env file' };
  if (parts.some((part) => /^.*\.backup_V/.test(part))) return { exclude: true, reason: 'backup file' };
  if (entry?.isDirectory?.()) return { exclude: false, reason: '' };
  const ext = path.extname(filePath).toLowerCase();
  if (EXCLUDED_EXTS.has(ext)) return { exclude: true, reason: `forbidden extension ${ext}` };
  if (LARGE_MEDIA_EXTS.has(ext)) return { exclude: true, reason: `large/binary media extension ${ext}` };
  if (/FULL_CHANGED_CODE\.md$/i.test(relative)) return { exclude: true, reason: 'generated full changed code report' };
  if (/changed_files_only\.zip$/i.test(relative)) return { exclude: true, reason: 'generated changed-files zip' };
  return { exclude: false, reason: '' };
}
function walk(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const relative = rel(full);
    const decision = shouldExclude(full, entry);
    if (decision.exclude) {
      excluded.push({ path: relative, reason: decision.reason });
      if (isEnvLike(relative)) addFinding('P0', 'ENV_FILE_EXCLUDED_FROM_MANIFEST', `${relative} exists but is excluded. It must not be copied into any release package.`, relative);
      if (/node_modules/.test(relative)) addFinding('P1', 'NODE_MODULES_EXCLUDED_FROM_MANIFEST', `${relative} exists but is excluded.`, relative);
      continue;
    }
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    included.push(relative);
  }
}

walk(ROOT);

const forbiddenIncluded = included.filter((item) => isEnvLike(item) || /(^|\/)node_modules\//.test(item) || /(^|\/)reports(\/|$)/.test(item) || /(^|\/)backups(\/|$)/.test(item) || /(^|\/)assets(\/|$)/.test(item) || /\.zip$/i.test(item));
for (const item of forbiddenIncluded) addFinding('P0', 'FORBIDDEN_FILE_IN_MANIFEST', `Forbidden file would be included: ${item}`, item);

included.sort();
excluded.sort((a, b) => a.path.localeCompare(b.path));
findings.sort((a, b) => a.severity.localeCompare(b.severity) || a.code.localeCompare(b.code) || String(a.file).localeCompare(String(b.file)));

const result = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  status: forbiddenIncluded.length ? 'FAIL' : 'PASS_WITH_EXCLUSIONS',
  counts: { included: included.length, excluded: excluded.length, findings: findings.length },
  gates: [
    'NO_CLEAN_PACKAGE_NO_PUBLISH',
    'NO_SECRET_ROTATION_CONFIRM_NO_PUBLISH',
    'NO_RLS_VERIFY_NO_PUBLISH',
    'NO_STORAGE_VERIFY_NO_PUBLISH',
  ],
  included,
  excluded,
  findings,
};

function toMarkdown(data) {
  const lines = [];
  lines.push('# Clean Release Manifest — 3D Gallery');
  lines.push('');
  lines.push(`- Generated at: ${data.generatedAt}`);
  lines.push(`- Root: \`${data.root}\``);
  lines.push(`- Status: \`${data.status}\``);
  lines.push(`- Included files: ${data.counts.included}`);
  lines.push(`- Excluded paths: ${data.counts.excluded}`);
  lines.push('');
  lines.push('## Source-only policy');
  lines.push('- `assets/**` is excluded from CLEAN_RELEASE and must be verified by STORAGE_VERIFICATION.');
  lines.push('- `reports/**` and `backups/**` are excluded and must never be packaged as release source.');
  lines.push('- `.env*`, `supabase/.env*`, `node_modules/**`, `.git/**`, archives, logs, temp/cache files are excluded.');
  lines.push('');
  lines.push('## Required gates');
  data.gates.forEach((gate) => lines.push(`- \`${gate}\``));
  lines.push('');
  lines.push('## Findings');
  if (!data.findings.length) lines.push('- No blocking findings.');
  data.findings.forEach((finding) => lines.push(`- ${finding.severity} ${finding.code}: ${finding.message}`));
  lines.push('');
  lines.push('## Included files');
  data.included.forEach((item) => lines.push(`- ${item}`));
  lines.push('');
  lines.push('## Excluded paths');
  data.excluded.slice(0, 500).forEach((item) => lines.push(`- ${item.path} — ${item.reason}`));
  if (data.excluded.length > 500) lines.push(`- ... ${data.excluded.length - 500} more excluded paths omitted.`);
  lines.push('');
  lines.push('No files were copied or zipped by this script.');
  return `${lines.join('\n')}\n`;
}

const outputText = jsonMode ? `${JSON.stringify(result, null, 2)}\n` : toMarkdown(result);
if (OUT_PATH) {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, outputText, 'utf8');
  console.log(`[clean-release] manifest written: ${OUT_PATH}`);
} else {
  console.log(outputText);
}

const hasP0 = findings.some((finding) => finding.severity === 'P0' && finding.code === 'FORBIDDEN_FILE_IN_MANIFEST');
process.exit(hasP0 ? 1 : 0);
