#!/usr/bin/env node
/**
 * Static read-only Supabase RLS/storage policy lint for 3D Gallery.
 * It does not connect to Supabase and does not execute SQL.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootArg = process.argv.find((arg, index) => index > 1 && !arg.startsWith('--')) || process.cwd();
const ROOT = path.resolve(rootArg);
const findings = [];

function read(relative) {
  try { return fs.readFileSync(path.join(ROOT, relative), 'utf8'); } catch { return null; }
}
function add(severity, code, message, file = '') {
  findings.push({ severity, code, message, file });
}
function compact(sql) {
  return String(sql || '').replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').toLowerCase();
}
function hasDangerousAnonWrite(sqlText, file) {
  const sql = compact(sqlText);
  const writePolicyRe = /create\s+policy\s+[^;]+\s+for\s+(insert|update|delete|all)\s+[^;]+\s+to\s+(anon|public)\b[^;]*;/gi;
  let match;
  while ((match = writePolicyRe.exec(sql)) !== null) {
    add('P0', 'ANON_WRITE_POLICY', `Policy grants ${match[1].toUpperCase()} to ${match[2]} in ${file}.`, file);
  }
  const grantWriteRe = /grant\s+(insert|update|delete|all)[^;]+\s+to\s+(anon|public)\b/gi;
  while ((match = grantWriteRe.exec(sql)) !== null) {
    add('P0', 'ANON_WRITE_GRANT', `GRANT includes ${match[1].toUpperCase()} to ${match[2]} in ${file}.`, file);
  }
  if (/for\s+(insert|update|delete|all)\b[^;]+(using|with\s+check)\s*\(\s*true\s*\)/i.test(sql)) {
    add('P1', 'TRUE_WRITE_CHECK_REVIEW', `${file} contains write policy with using/check true; verify role restriction.`, file);
  }
}
function checkRls(sqlText) {
  if (!sqlText) {
    add('P1', 'RLS_FILE_MISSING', 'supabase/rls_policies.sql not found.', 'supabase/rls_policies.sql');
    return;
  }
  const sql = compact(sqlText);
  const expectedTables = ['artworks', 'cms_content', 'published_bundles', 'media_assets', 'rooms', 'site_settings'];
  for (const table of expectedTables) {
    if (!sql.includes(`alter table`) || !sql.includes(table)) {
      add('P2', 'RLS_TABLE_REVIEW', `Could not confirm explicit RLS stanza for table-like name ${table}; review manually.`, 'supabase/rls_policies.sql');
    }
  }
  if (!/enable\s+row\s+level\s+security/.test(sql)) add('P1', 'RLS_ENABLE_REVIEW', 'Could not find ENABLE ROW LEVEL SECURITY statement; review SQL manually.', 'supabase/rls_policies.sql');
  hasDangerousAnonWrite(sqlText, 'supabase/rls_policies.sql');
  if (/to\s+anon\b[^;]+for\s+select|for\s+select[^;]+to\s+anon\b/i.test(sql)) add('P3', 'ANON_SELECT_PRESENT', 'Anon SELECT policy detected; valid for public published content if scoped correctly.', 'supabase/rls_policies.sql');
}
function checkStorage(sqlText) {
  if (!sqlText) {
    add('P1', 'STORAGE_FILE_MISSING', 'supabase/storage_policies.sql not found.', 'supabase/storage_policies.sql');
    return;
  }
  const sql = compact(sqlText);
  hasDangerousAnonWrite(sqlText, 'supabase/storage_policies.sql');
  if (/bucket_id[^;]+cms[^;]+(insert|update|delete)[^;]+to\s+(anon|public)/i.test(sql)) {
    add('P0', 'ANON_STORAGE_WRITE', 'Storage policy may allow anon/public write to CMS bucket; review required.', 'supabase/storage_policies.sql');
  }
  if (/for\s+select[^;]+to\s+(anon|public)/i.test(sql)) add('P3', 'PUBLIC_STORAGE_READ_PRESENT', 'Public storage read policy detected; valid only for public media/bundle buckets.', 'supabase/storage_policies.sql');
  if (!/storage\.objects/.test(sql)) add('P2', 'STORAGE_OBJECTS_REVIEW', 'storage.objects policy statements not clearly detected; review manually.', 'supabase/storage_policies.sql');
}

checkRls(read('supabase/rls_policies.sql'));
checkStorage(read('supabase/storage_policies.sql'));

const severityRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
findings.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) || a.code.localeCompare(b.code));

const hasP0 = findings.some((finding) => finding.severity === 'P0');
if (hasP0) console.error('[RLS/STORAGE LINT] FAIL');
else console.log('[RLS/STORAGE LINT] PASS/WARN — no static P0 anon write pattern detected. Live verification is still required.');
for (const item of findings) {
  const line = `${item.severity} ${item.code} — ${item.message}`;
  if (item.severity === 'P0' || item.severity === 'P1') console.error(line);
  else console.warn(line);
}
process.exit(hasP0 ? 1 : 0);
