#!/usr/bin/env node
/*
 * V6.11.21-B6-F_K_O_I_F
 * Static Remote CMS Publish / Backup / Rollback helper.
 *
 * Purpose:
 * - Upload the scene-derived static CMS JSON target to Supabase Storage.
 * - Never reads from, seeds, prunes, or mutates Supabase DB tables.
 * - Never uploads media.
 * - Requires an existing remote backup before real publish.
 *
 * Usage:
 *   node scripts/publish_static_cms_json_once.js --dry-run
 *   node scripts/publish_static_cms_json_once.js --yes --backup backups/cms_public_content.remote_backup_YYYYMMDD-HHMMSS.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = 'V6.11.21-B6-F_K_O_I_F';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TARGET_JSON_PATH = path.join(PROJECT_ROOT, 'supabase', 'cms_public_content.generated.json');
const DEFAULT_BACKUP_DIR = path.join(PROJECT_ROOT, 'backups');
const TARGET_OBJECT_PATH = 'published/cms_public_content.json';
const DEFAULT_BUCKET = 'cms-public';
const VERIFY_CACHE_BUST = 'I_F_VERIFY';

const EXPECTED = {
  indoor: ['LOGO_001', 'LOGO_002', 'VIDEO_001', 'ART_001'],
  outdoor: ['LOGO_001', 'VIDEO_001', 'ART_001'],
};

const OLD_ID_PATTERNS = [
  /^TEXT_/i,
  /^NEON_TEXT_HCEC_001$/i,
  /^ART_0*(?:[2-9]|[1-9][0-9]+)$/i,
  /^VIDEO_0*(?:[2-9]|[1-9][0-9]+)$/i,
  /^LOGO_0*(?:3|[4-9]|[1-9][0-9]+)$/i,
];

const LAYOUT_FIELDS = new Set([
  'position',
  'rotation',
  'size',
  'scale',
  'group',
  'frame',
  'clickable',
  'transparent',
  'collider',
  'physics',
  'mesh',
  'object3D',
  'geometry',
]);

function parseArgs(argv) {
  const args = {
    dryRun: false,
    yes: false,
    backup: '',
    rollbackOnly: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--yes') args.yes = true;
    else if (arg === '--rollback-only') args.rollbackOnly = true;
    else if (arg === '--backup') {
      args.backup = argv[i + 1] || '';
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.dryRun && !args.yes && !args.rollbackOnly) {
    throw new Error('Refusing to run without --dry-run, --yes, or --rollback-only.');
  }
  if ((args.yes || args.rollbackOnly) && !args.backup) {
    const latest = findLatestBackup(DEFAULT_BACKUP_DIR);
    if (latest) args.backup = latest;
  }
  return args;
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  const text = readText(filePath);
  return { text, data: JSON.parse(text) };
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function getRoomItems(data, room) {
  const roomData = data && data.rooms && data.rooms[room];
  if (!roomData) return [];
  if (Array.isArray(roomData.artworks)) return roomData.artworks;
  if (roomData.items && typeof roomData.items === 'object') {
    return Object.entries(roomData.items).map(([key, value]) => ({ artwork_code: key, ...(value || {}) }));
  }
  return [];
}

function getCode(item) {
  return String(item.artwork_code || item.id || item.code || '').trim().toUpperCase();
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function assertSameSet(label, actual, expected) {
  const a = sorted(actual);
  const e = sorted(expected);
  if (a.length !== e.length || a.some((value, index) => value !== e[index])) {
    throw new Error(`${label} mismatch. Expected ${e.join(', ')}, got ${a.join(', ')}`);
  }
}

function collectAllArtworkItems(data) {
  return Object.keys(EXPECTED).flatMap((room) => getRoomItems(data, room).map((item) => ({ room, item })));
}

function assertNoLayoutFields(data) {
  for (const { room, item } of collectAllArtworkItems(data)) {
    for (const key of Object.keys(item)) {
      if (LAYOUT_FIELDS.has(key)) {
        throw new Error(`Layout field '${key}' found in CMS item ${room}/${getCode(item) || '(unknown)'}.`);
      }
    }
  }
}

function assertNoOldIds(data) {
  for (const { room, item } of collectAllArtworkItems(data)) {
    const code = getCode(item);
    if (OLD_ID_PATTERNS.some((pattern) => pattern.test(code))) {
      throw new Error(`Old/stale CMS ID found in target: ${room}/${code}`);
    }
  }
}

function validateCmsTarget(data, rawText) {
  if (!data || typeof data !== 'object') throw new Error('Target JSON root must be an object.');
  if (data.version !== 'V6.11.21-B6-F_K_O_I_D') {
    throw new Error(`Unexpected target version: ${data.version}. Expected V6.11.21-B6-F_K_O_I_D.`);
  }

  for (const room of Object.keys(EXPECTED)) {
    const items = getRoomItems(data, room);
    const codes = items.map(getCode).filter(Boolean);
    assertSameSet(`${room} IDs`, codes, EXPECTED[room]);
  }

  assertNoOldIds(data);
  assertNoLayoutFields(data);

  if (rawText.includes('intro_h264_test.mp4')) {
    throw new Error('Stale media path intro_h264_test.mp4 found in target JSON.');
  }
  if (/data:(image|video)\//i.test(rawText)) {
    throw new Error('Base64 media data URI found in target JSON.');
  }

  return {
    version: data.version,
    indoorCount: getRoomItems(data, 'indoor').length,
    outdoorCount: getRoomItems(data, 'outdoor').length,
    indoorIds: getRoomItems(data, 'indoor').map(getCode),
    outdoorIds: getRoomItems(data, 'outdoor').map(getCode),
  };
}

function findLatestBackup(backupDir) {
  if (!fs.existsSync(backupDir)) return '';
  const candidates = fs
    .readdirSync(backupDir)
    .filter((name) => /^cms_public_content\.remote_backup_.*\.json$/i.test(name))
    .map((name) => path.join(backupDir, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || '';
}

function validateBackup(backupPath) {
  if (!backupPath) throw new Error('Remote backup file is required before publish.');
  const fullPath = path.isAbsolute(backupPath) ? backupPath : path.join(PROJECT_ROOT, backupPath);
  if (!fs.existsSync(fullPath)) throw new Error(`Backup file not found: ${fullPath}`);
  const { text, data } = readJson(fullPath);
  return {
    path: fullPath,
    hash: sha256(text),
    version: data.version || '',
    publishedAt: data.publishedAt || '',
    indoorCount: getRoomItems(data, 'indoor').length,
    outdoorCount: getRoomItems(data, 'outdoor').length,
    text,
    data,
  };
}

function readEnvFiles() {
  const envFiles = [path.join(PROJECT_ROOT, '.env'), path.join(PROJECT_ROOT, 'supabase', '.env')];
  for (const envFile of envFiles) {
    if (!fs.existsSync(envFile)) continue;
    const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function loadSupabaseModule() {
  const candidates = [
    '@supabase/supabase-js',
    path.join(PROJECT_ROOT, 'supabase', 'node_modules', '@supabase', 'supabase-js'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) {
      // Try next candidate.
    }
  }
  throw new Error('Cannot load @supabase/supabase-js. Run npm install in ./supabase or install the dependency at project root.');
}

function createClientForPublish() {
  readEnvFiles();
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL.');
  if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.');
  const { createClient } = loadSupabaseModule();
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    client,
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    bucket: process.env.CMS_PUBLIC_BUCKET || DEFAULT_BUCKET,
  };
}

async function uploadJson(client, bucket, objectPath, bodyText, label) {
  const { error } = await client.storage.from(bucket).upload(objectPath, bodyText, {
    contentType: 'application/json',
    cacheControl: '60',
    upsert: true,
  });
  if (error) throw new Error(`${label} upload failed: ${error.message}`);
}

async function fetchRemoteJson(publicUrl) {
  const response = await fetch(`${publicUrl}?v=${VERIFY_CACHE_BUST}_${Date.now()}`, {
    method: 'GET',
    cache: 'no-store',
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Remote verify failed: HTTP ${response.status}. ${text.slice(0, 200)}`);
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    text,
    data: JSON.parse(text),
    hash: sha256(text),
  };
}

async function verifyTargetRemote(publicUrl) {
  const remote = await fetchRemoteJson(publicUrl);
  const summary = validateCmsTarget(remote.data, remote.text);
  return { ...remote, summary };
}

async function verifyRollbackRemote(publicUrl, backup) {
  const remote = await fetchRemoteJson(publicUrl);
  const indoorCount = getRoomItems(remote.data, 'indoor').length;
  const outdoorCount = getRoomItems(remote.data, 'outdoor').length;
  if (indoorCount !== backup.indoorCount || outdoorCount !== backup.outdoorCount) {
    throw new Error(`Rollback count mismatch. Expected ${backup.indoorCount}/${backup.outdoorCount}, got ${indoorCount}/${outdoorCount}.`);
  }
  return { ...remote, indoorCount, outdoorCount };
}

async function main() {
  const args = parseArgs(process.argv);
  const target = readJson(TARGET_JSON_PATH);
  const targetSummary = validateCmsTarget(target.data, target.text);
  const backup = validateBackup(args.backup);

  console.log(`[${VERSION}] Static CMS publish helper`);
  console.log('Source target:', path.relative(PROJECT_ROOT, TARGET_JSON_PATH));
  console.log('Target version:', targetSummary.version);
  console.log('Target indoor/outdoor:', `${targetSummary.indoorCount}/${targetSummary.outdoorCount}`);
  console.log('Target indoor IDs:', targetSummary.indoorIds.join(', '));
  console.log('Target outdoor IDs:', targetSummary.outdoorIds.join(', '));
  console.log('Backup path:', path.relative(PROJECT_ROOT, backup.path));
  console.log('Backup SHA256:', backup.hash);
  console.log('Backup version:', backup.version || '(none)');
  console.log('Backup indoor/outdoor:', `${backup.indoorCount}/${backup.outdoorCount}`);

  if (args.dryRun) {
    console.log('DRY RUN OK — no remote write performed.');
    return;
  }

  const { client, supabaseUrl, bucket } = createClientForPublish();
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${TARGET_OBJECT_PATH}`;

  if (args.rollbackOnly) {
    console.log('ROLLBACK ONLY: uploading backup JSON back to latest object path.');
    await uploadJson(client, bucket, TARGET_OBJECT_PATH, backup.text, 'Rollback');
    const rollbackVerify = await verifyRollbackRemote(publicUrl, backup);
    console.log('ROLLBACK VERIFY OK:', JSON.stringify({
      status: rollbackVerify.status,
      contentType: rollbackVerify.contentType,
      indoorCount: rollbackVerify.indoorCount,
      outdoorCount: rollbackVerify.outdoorCount,
      hash: rollbackVerify.hash,
    }, null, 2));
    return;
  }

  console.log('Publishing static CMS JSON to:', `${bucket}/${TARGET_OBJECT_PATH}`);
  try {
    await uploadJson(client, bucket, TARGET_OBJECT_PATH, target.text, 'Publish');
    const verify = await verifyTargetRemote(publicUrl);
    console.log('PUBLISH VERIFY OK:', JSON.stringify({
      status: verify.status,
      contentType: verify.contentType,
      version: verify.summary.version,
      indoorCount: verify.summary.indoorCount,
      outdoorCount: verify.summary.outdoorCount,
      indoorIds: verify.summary.indoorIds,
      outdoorIds: verify.summary.outdoorIds,
      hash: verify.hash,
    }, null, 2));
  } catch (publishOrVerifyError) {
    console.error('PUBLISH/VERIFY FAILED:', publishOrVerifyError.message);
    console.error('Attempting rollback with backup JSON...');
    await uploadJson(client, bucket, TARGET_OBJECT_PATH, backup.text, 'Rollback');
    const rollbackVerify = await verifyRollbackRemote(publicUrl, backup);
    console.log('ROLLBACK VERIFY OK:', JSON.stringify({
      status: rollbackVerify.status,
      contentType: rollbackVerify.contentType,
      indoorCount: rollbackVerify.indoorCount,
      outdoorCount: rollbackVerify.outdoorCount,
      hash: rollbackVerify.hash,
    }, null, 2));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[${VERSION}] ERROR:`, error.message);
  process.exit(1);
});
