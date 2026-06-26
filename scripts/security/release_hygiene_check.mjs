#!/usr/bin/env node
/**
 * Read-only release hygiene checker for 3D Gallery.
 * Verifies ignore rules and blocks release folders/zips that include .env,
 * secrets, node_modules, nested archives, or generated reports with secret-like values.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const targetArg = args.find((arg) => !arg.startsWith('--')) || process.cwd();
const ROOT = path.resolve(process.cwd());
const TARGET = path.resolve(targetArg);
const findings = [];

const SKIP_DIRS_FOR_TEXT_SCAN = new Set(['.git', 'node_modules', 'dist', 'build', '.cache', '.vite', 'assets', 'reports', 'backups']);
const SKIP_EXTS_FOR_TEXT_SCAN = new Set(['.glb', '.gltf', '.bin', '.mp4', '.mov', '.webm', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp3', '.wav', '.hdr', '.ico', '.pdf', '.zip', '.tar', '.gz', '.7z']);
const FORBIDDEN_PATH_PATTERNS = [
  { code: 'ENV_FILE', re: /(^|\/)\.env(\.|$|\/)/ },
  { code: 'SUPABASE_ENV_FILE', re: /(^|\/)supabase\/\.env(\.|$|\/)/ },
  { code: 'NODE_MODULES', re: /(^|\/)node_modules(\/|$)/ },
  { code: 'SUPABASE_NODE_MODULES', re: /(^|\/)supabase\/node_modules(\/|$)/ },
  { code: 'GIT_DIR', re: /(^|\/)\.git(\/|$)/ },
  { code: 'REPORTS_DIR', re: /(^|\/)reports(\/|$)/ },
  { code: 'BACKUPS_DIR', re: /(^|\/)backups(\/|$)/ },
  { code: 'ASSETS_DIR', re: /(^|\/)assets(\/|$)/ },
  { code: 'NESTED_ARCHIVE', re: /\.(zip|tar|tar\.gz|tgz|7z|rar)$/i },
];

function add(severity, type, message) {
  findings.push({ severity, type, message });
}
function relFrom(base, filePath) {
  return path.relative(base, filePath).split(path.sep).join('/') || '.';
}
function readTextAt(base, relative) {
  try { return fs.readFileSync(path.join(base, relative), 'utf8'); } catch { return null; }
}
function requireFile(base, relative) {
  if (!fs.existsSync(path.join(base, relative))) add('P0', 'MISSING_FILE', `${relative} is required for release hygiene.`);
}
function requireRule(base, file, pattern, description) {
  const text = readTextAt(base, file);
  if (text == null) return;
  if (!pattern.test(text)) add('P0', 'MISSING_IGNORE_RULE', `${file} must ignore ${description}.`);
}
function pathExists(base, relative) {
  return fs.existsSync(path.join(base, relative));
}
function isForbiddenPath(relative) {
  return FORBIDDEN_PATH_PATTERNS.find((item) => item.re.test(relative));
}
function scanPathList(paths, sourceLabel) {
  for (const relative of paths) {
    const normalized = relative.split(path.sep).join('/').replace(/^\.\//, '');
    const forbidden = isForbiddenPath(normalized);
    if (forbidden) add('P0', `FORBIDDEN_${forbidden.code}`, `${sourceLabel} contains forbidden path: ${normalized}`);
  }
}
function walkFiles(base, dir = base, output = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const relative = relFrom(base, full);
    if (entry.isDirectory()) {
      output.push(`${relative}/`);
      if (isForbiddenPath(`${relative}/`)) continue;
      walkFiles(base, full, output);
    } else {
      output.push(relative);
    }
  }
  return output;
}
function shouldTextScan(filePath, base) {
  const relative = relFrom(base, filePath);
  const parts = relative.split('/');
  if (parts.some((part) => SKIP_DIRS_FOR_TEXT_SCAN.has(part))) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (SKIP_EXTS_FOR_TEXT_SCAN.has(ext)) return false;
  let stat;
  try { stat = fs.statSync(filePath); } catch { return false; }
  return stat.size <= 1024 * 1024;
}
function isPlaceholderValue(value) {
  const clean = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  return !clean || /^(changeme|change_me|placeholder|your_|your-|example|xxx|xxxxx|<.*>|\$\{.*}|todo|replace_me)$/i.test(clean) || /placeholder|example|dummy|sample|your[-_]/i.test(clean);
}
function hasSensitiveAssignment(text) {
  const assignmentRe = /(?:^|\n)\s*([A-Z0-9_]*(?:SERVICE_ROLE|DATABASE_URL|POSTGRES_PASSWORD|JWT_SECRET|PRIVATE_KEY|R2_SECRET_ACCESS_KEY|CLOUDFLARE_API_TOKEN)[A-Z0-9_]*)\s*[:=]\s*['"]?([^'"\s#;]+)/gi;
  let match;
  while ((match = assignmentRe.exec(text)) !== null) {
    if (!isPlaceholderValue(match[2])) return true;
  }
  return false;
}
function scanSecretPatternsInFolder(base) {
  const all = walkFiles(base).filter((item) => !item.endsWith('/'));
  for (const relative of all) {
    const full = path.join(base, relative);
    if (!shouldTextScan(full, base)) continue;
    let text = '';
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const jwtLike = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(text);
    const serviceLike = hasSensitiveAssignment(text);
    if (serviceLike) add('P0', 'SECRET_PATTERN_IN_RELEASE_TEXT', `${relative} contains service/database/private-token-like assignment [masked].`);
    if (jwtLike && !/\.env\.example$/i.test(relative)) add('P1', 'JWT_PATTERN_IN_RELEASE_TEXT', `${relative} contains JWT-like value [masked].`);
  }
}

// Always validate root ignore controls, even when checking a release target.
requireFile(ROOT, '.gitignore');
requireFile(ROOT, '.dockerignore');
requireFile(ROOT, '.npmignore');
requireRule(ROOT, '.gitignore', /^\.env$/m, '.env');
requireRule(ROOT, '.gitignore', /^\.env\.\*$/m, '.env.*');
requireRule(ROOT, '.gitignore', /^supabase\/\.env$/m, 'supabase/.env');
requireRule(ROOT, '.dockerignore', /^\.env$/m, '.env');
requireRule(ROOT, '.dockerignore', /^supabase\/\.env$/m, 'supabase/.env');
requireRule(ROOT, '.npmignore', /^\.env$/m, '.env');
requireRule(ROOT, '.npmignore', /^supabase\/\.env$/m, 'supabase/.env');

// Worktree warning/fail: current dirty local source still blocks publish until clean package is used.
for (const envPath of ['.env', '.env.local', '.env.production', 'supabase/.env']) {
  if (pathExists(ROOT, envPath)) add('P0', 'ENV_FILE_IN_WORKTREE', `${envPath} exists in the working tree. Use clean release manifest/package and rotate if it was shared.`);
}
for (const modulesPath of ['node_modules', 'supabase/node_modules']) {
  if (pathExists(ROOT, modulesPath)) add('P1', 'NODE_MODULES_IN_WORKTREE', `${modulesPath} exists; clean release package must exclude it.`);
}

if (fs.existsSync(TARGET) && fs.statSync(TARGET).isDirectory()) {
  const paths = walkFiles(TARGET);
  scanPathList(paths, `release folder ${TARGET}`);
  scanSecretPatternsInFolder(TARGET);
} else if (fs.existsSync(TARGET) && /\.zip$/i.test(TARGET)) {
  try {
    const output = execFileSync('unzip', ['-l', TARGET], { encoding: 'utf8' });
    const paths = output.split(/\r?\n/).map((line) => line.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/)?.[1]).filter(Boolean);
    scanPathList(paths, `zip ${TARGET}`);
    add('P2', 'ZIP_TEXT_SECRET_SCAN_LIMITED', 'Zip path listing checked. To scan file contents, unzip to a temp folder and run release:hygiene on that folder.');
  } catch (error) {
    add('P2', 'ZIP_INSPECTION_UNAVAILABLE', `Could not inspect zip ${TARGET}; unzip manually then run release:hygiene on extracted folder.`);
  }
} else if (TARGET !== ROOT) {
  add('P1', 'TARGET_NOT_FOUND', `Release target not found: ${TARGET}`);
} else {
  add('P2', 'RELEASE_TARGET_NOT_PROVIDED', 'No release folder/zip supplied; checked worktree controls only. Use npm run release:hygiene -- ./_unzipped_release for final package gate.');
}

const severityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
findings.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || a.type.localeCompare(b.type));
const blocking = findings.some((item) => item.severity === 'P0' || item.severity === 'P1');
if (blocking) console.error('[RELEASE HYGIENE] FAIL');
else console.log('[RELEASE HYGIENE] PASS');
for (const item of findings) {
  const line = `${item.severity} ${item.type} — ${item.message}`;
  if (item.severity === 'P0' || item.severity === 'P1') console.error(line);
  else console.warn(line);
}
process.exit(blocking ? 1 : 0);
