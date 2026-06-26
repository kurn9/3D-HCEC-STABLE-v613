#!/usr/bin/env node
/**
 * Read-only secret scanner for 3D Gallery release safety.
 * Does not print secret values. Exits 1 when P0/P1 findings are detected.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootArg = process.argv.find((arg) => !arg.startsWith('--') && arg !== process.argv[1] && arg !== process.argv[0]);
const ROOT = path.resolve(rootArg || process.cwd());
const findings = [];

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.cache', '.vite']);
const SKIP_EXTS = new Set(['.glb', '.gltf', '.bin', '.mp4', '.mov', '.webm', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp3', '.wav', '.hdr', '.ico', '.pdf', '.zip', '.tar', '.gz', '.7z']);
const ENV_FILE_NAMES = new Set(['.env']);
const SAFE_EXAMPLE_RE = /(^|[\/])\.env\.example$/i;
const PLACEHOLDER_RE = /^(|changeme|change_me|placeholder|your_|your-|example|xxx|xxxxx|<.*>|\$\{.*\}|TODO|REPLACE_ME)$/i;

function rel(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/') || '.';
}

function add(severity, filePath, type, message = '') {
  findings.push({ severity, file: rel(filePath), type, message });
}

function isEnvPath(filePath) {
  const base = path.basename(filePath);
  const relative = rel(filePath);
  return base === '.env' || base.startsWith('.env.') || relative.startsWith('supabase/.env');
}

function isPlaceholder(value) {
  const clean = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (PLACEHOLDER_RE.test(clean)) return true;
  if (/^(true|false|null|undefined)$/i.test(clean)) return true;
  if (/^(process\.env|import\.meta\.env)/i.test(clean)) return true;
  if (/example|placeholder|dummy|sample|your[-_]/i.test(clean)) return true;
  return false;
}

function mask(value) {
  const clean = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!clean) return '[empty]';
  if (clean.length <= 8) return '[masked]';
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

function parseAssignment(line) {
  const match = line.match(/(?:^|\b)([A-Z0-9_]*(?:SERVICE_ROLE|DATABASE_URL|POSTGRES_PASSWORD|JWT_SECRET|PRIVATE_KEY|CLOUDFLARE_API_TOKEN|R2_SECRET_ACCESS_KEY|OPENAI_API_KEY|GEMINI_API_KEY|GROK_API_KEY|API_KEY|TOKEN|SECRET)[A-Z0-9_]*)\s*[:=]\s*['"]?([^'"\s#;]+)/);
  if (!match) return null;
  return { key: match[1], value: match[2] };
}

function scanText(filePath, text) {
  const lines = text.split(/\r?\n/);
  const isExample = SAFE_EXAMPLE_RE.test(rel(filePath));
  const isEnv = isEnvPath(filePath);

  if (isEnv && !isExample) {
    add('P0', filePath, 'ENV_FILE_PRESENT', 'Environment file must not be included in source/release package.');
  }

  lines.forEach((line, index) => {
    const assignment = parseAssignment(line);
    if (assignment && !isPlaceholder(assignment.value)) {
      const key = assignment.key.toUpperCase();
      if (/^(P0_|P1_|P2_|P3_|REAL_PUBLISH_|NO_BACKUP_|NO_ROLLBACK_|NO_SMOKE_|NO_DIFF_|NO_CLEAN_|NO_SECRET_|NO_RLS_|NO_STORAGE_|PUBLISH_DISABLED_)/.test(key)) return;
      let severity = 'P1';
      if (isEnv && !isExample) severity = 'P0';
      if (/SERVICE_ROLE|DATABASE_URL|POSTGRES_PASSWORD|JWT_SECRET|PRIVATE_KEY|R2_SECRET_ACCESS_KEY|CLOUDFLARE_API_TOKEN/.test(key)) severity = 'P0';
      add(severity, filePath, `${key}_LIKE`, `line ${index + 1}; value ${mask(assignment.value)}`);
    }

    const jwtMatches = line.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [];
    for (const jwt of jwtMatches) {
      if (isPlaceholder(jwt)) continue;
      const isKnownPublicAnon = /anonKey|SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE|VITE_SUPABASE/i.test(line);
      add(isKnownPublicAnon ? 'P2' : (isEnv && !isExample ? 'P0' : 'P1'), filePath, isKnownPublicAnon ? 'PUBLIC_ANON_JWT_REVIEW' : 'JWT_LIKE_VALUE', `line ${index + 1}; value ${mask(jwt)}`);
    }
  });
}

function shouldSkip(filePath, dirent = null) {
  const parts = rel(filePath).split('/');
  if (parts.some((part) => SKIP_DIRS.has(part))) return true;
  if (parts[0] === 'assets') return true;
  const ext = path.extname(filePath).toLowerCase();
  if (SKIP_EXTS.has(ext)) return true;
  if (dirent?.isDirectory?.()) return false;
  return false;
}

function walk(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (shouldSkip(full, entry)) continue;
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.size > 1024 * 1024) continue;
    let text = '';
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    scanText(full, text);
  }
}

walk(ROOT);

const severityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
findings.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || a.file.localeCompare(b.file));

if (findings.length) {
  console.error('[SECURITY SCAN] FAIL');
  for (const finding of findings) {
    console.error(`${finding.severity} ${finding.file} ${finding.type}${finding.message ? ` — ${finding.message}` : ''}`);
  }
} else {
  console.log('[SECURITY SCAN] PASS — no P0/P1 secret patterns detected.');
}

const hasBlocking = findings.some((finding) => finding.severity === 'P0' || finding.severity === 'P1');
process.exit(hasBlocking ? 1 : 0);
