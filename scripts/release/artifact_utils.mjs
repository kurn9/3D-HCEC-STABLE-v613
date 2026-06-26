#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../..');

export const SOURCE_HASH_FILES = {
  sceneIndoorHash: 'data/scene.json',
  sceneOutdoorHash: 'data/scene_outdoor.json',
  cmsFallbackHash: 'data/cms_content_fallback.json',
  generatedBundleHash: 'supabase/cms_public_content.generated.json'
};

export const MEDIA_FIELDS = [
  'image',
  'image_url',
  'thumbnail',
  'thumbnail_url',
  'poster',
  'posterUrl',
  'videoUrl',
  'video_url',
  'audioUrl',
  'logo',
  'src'
];

export function isInsideProjectRoot(filePath, root = PROJECT_ROOT) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(filePath);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

export function resolveProjectPath(inputPath, { root = PROJECT_ROOT, label = 'path', allowOutside = false } = {}) {
  if (!isNonEmptyString(inputPath)) return '';
  const text = String(inputPath).trim();
  const resolved = path.isAbsolute(text) ? path.resolve(text) : path.resolve(root, text);
  if (!allowOutside && !isInsideProjectRoot(resolved, root)) {
    throw new Error(`${label} resolves outside project root: ${resolved}`);
  }
  return resolved;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function valueKind(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isBooleanLikeString(value) {
  return typeof value === 'string' && /^(true|false)$/i.test(value.trim());
}

export function validateArtifactTextValue(value, { label, allowMissing = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (allowMissing) return { ok: true, missing: true, value: '' };
    return { ok: false, code: 'MISSING_REQUIRED_VALUE', message: `${label} is required` };
  }
  if (typeof value !== 'string') {
    return { ok: false, code: 'INVALID_ARTIFACT_VALUE_TYPE', message: `${label} must be a non-empty string, got ${valueKind(value)}.` };
  }
  const text = value.trim();
  if (!text) {
    if (allowMissing) return { ok: true, missing: true, value: '' };
    return { ok: false, code: 'MISSING_REQUIRED_VALUE', message: `${label} is required` };
  }
  if (isBooleanLikeString(text)) {
    return { ok: false, code: 'INVALID_ARTIFACT_VALUE_TYPE', message: `${label} must be a real artifact string, got boolean-like value ${JSON.stringify(text)}.` };
  }
  return { ok: true, missing: false, value: text };
}

export function utcStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

export function makeArtifactId(prefix) {
  const random = crypto.randomBytes(3).toString('hex');
  return `${prefix}_${utcStamp()}_${random}`;
}

export function normalizeStatus(value, fallback = 'PENDING') {
  const status = String(value || fallback).trim().toUpperCase();
  return ['PASS', 'FAIL', 'PENDING', 'WARN'].includes(status) ? status : fallback;
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readText(filePath, fallback = '') {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (_) {
    return fallback;
  }
}

export async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

export async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch (_) {
    return false;
  }
}

export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fsSync.createReadStream(filePath);
  return await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

export function stableJsonStringify(value) {
  const seen = new WeakSet();
  const sortValue = (input) => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) return '[Circular]';
    seen.add(input);
    if (Array.isArray(input)) return input.map(sortValue);
    const output = {};
    for (const key of Object.keys(input).sort()) output[key] = sortValue(input[key]);
    return output;
  };
  return JSON.stringify(sortValue(value), null, 2);
}

export function shortHash(value, length = 8) {
  return sha256Text(String(value || '')).slice(0, length);
}

export function safeRel(filePath, root = PROJECT_ROOT) {
  return path.relative(root, path.resolve(filePath)).replace(/\\/g, '/');
}

export function maskPathForReport(value) {
  return String(value || '').replace(/\\/g, '/');
}

export function maskSensitiveString(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 10) return '[masked]';
  return `${text.slice(0, 4)}...[masked]...${text.slice(-4)}`;
}

export async function writeArtifactPair({ outDir = 'reports', artifact, title, markdown }) {
  const resolvedOutDir = resolveProjectPath(outDir, { label: 'artifact output directory', allowOutside: false });
  await ensureDir(resolvedOutDir);
  const artifactWithoutHash = { ...artifact };
  delete artifactWithoutHash.hash;
  delete artifactWithoutHash.hashAlgorithm;
  const jsonText = `${stableJsonStringify(artifactWithoutHash)}\n`;
  const hash = sha256Text(jsonText);
  const finalArtifact = {
    ...artifact,
    hash,
    hashAlgorithm: 'SHA-256(stable JSON without hash field)'
  };
  const jsonPath = path.join(resolvedOutDir, `${finalArtifact.artifactId}.json`);
  const mdPath = path.join(resolvedOutDir, `${finalArtifact.artifactId}.md`);
  await fs.writeFile(jsonPath, `${stableJsonStringify(finalArtifact)}\n`, 'utf8');
  const md = markdown || defaultArtifactMarkdown(finalArtifact, title);
  await fs.writeFile(mdPath, md, 'utf8');
  return { jsonPath, mdPath, artifact: finalArtifact };
}

export function defaultArtifactMarkdown(artifact, title = artifact.type) {
  const checks = Array.isArray(artifact.checks) ? artifact.checks : [];
  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`- Artifact ID: \`${artifact.artifactId}\``);
  lines.push(`- Type: \`${artifact.type}\``);
  lines.push(`- Status: \`${artifact.status}\``);
  lines.push(`- Created at: ${artifact.createdAt}`);
  lines.push(`- Publish gate eligible: ${artifact.publishGateEligible ? 'YES' : 'NO'}`);
  lines.push(`- No secrets included: ${artifact.noSecretsIncluded === false ? 'NO' : 'YES'}`);
  lines.push('');
  if (checks.length) {
    lines.push('## Checks');
    for (const check of checks) {
      lines.push(`- [${check.status === 'PASS' ? 'x' : ' '}] ${check.label || check.id || 'check'} — ${check.status || 'PENDING'}`);
    }
    lines.push('');
  }
  if (artifact.evidence) {
    lines.push('## Evidence');
    lines.push(Array.isArray(artifact.evidence) ? artifact.evidence.map((item) => `- ${item}`).join('\n') : String(artifact.evidence));
    lines.push('');
  }
  lines.push('## Safety');
  lines.push('- No production write was performed by this artifact generator.');
  lines.push('- Do not paste service role keys or secrets into this artifact.');
  return `${lines.join('\n')}\n`;
}

export async function validateArtifactFile(filePath, expected = {}) {
  const result = {
    filePath,
    exists: false,
    validJson: false,
    statusPass: false,
    typeMatches: true,
    idMatches: true,
    hashPresent: false,
    artifact: null,
    errors: []
  };
  if (!filePath) {
    result.errors.push('missing artifact path');
    return result;
  }
  if (!(await fileExists(filePath))) {
    result.errors.push('artifact file not found');
    return result;
  }
  result.exists = true;
  let artifact;
  try {
    artifact = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    result.errors.push(`artifact JSON parse failed: ${error.message}`);
    return result;
  }
  result.validJson = true;
  result.artifact = artifact;
  for (const field of ['artifactId', 'type', 'status', 'createdAt']) {
    if (!artifact[field]) result.errors.push(`missing ${field}`);
  }
  if (expected.type && artifact.type !== expected.type) {
    result.typeMatches = false;
    result.errors.push(`type mismatch: expected ${expected.type}, got ${artifact.type}`);
  }
  if (expected.artifactId && artifact.artifactId !== expected.artifactId) {
    result.idMatches = false;
    result.errors.push(`artifactId mismatch: expected ${expected.artifactId}, got ${artifact.artifactId}`);
  }
  result.hashPresent = Boolean(artifact.hash);
  if (!artifact.hash) result.errors.push('missing hash');
  result.statusPass = artifact.status === 'PASS' && artifact.publishGateEligible === true;
  if (!result.statusPass) result.errors.push(`artifact not PASS/gate eligible: status=${artifact.status}, eligible=${artifact.publishGateEligible}`);
  return result;
}

export function summarizeChecks(checks) {
  const summary = { total: 0, pass: 0, fail: 0, pending: 0, warn: 0 };
  for (const check of checks || []) {
    summary.total += 1;
    const status = String(check.status || 'PENDING').toLowerCase();
    if (status === 'pass') summary.pass += 1;
    else if (status === 'fail') summary.fail += 1;
    else if (status === 'warn') summary.warn += 1;
    else summary.pending += 1;
  }
  return summary;
}

export async function loadSceneItems(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const json = await readJson(resolved, []);
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.artworks)) return json.artworks;
  return [];
}

export function collectMediaRefsFromItems(items = [], source = 'scene', room = '') {
  const refs = [];
  for (const item of items || []) {
    const id = item?.id || item?.artwork_code || item?.code || 'unknown';
    const type = item?.type || item?.mediaType || 'artwork';
    for (const field of MEDIA_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(item || {}, field) && item[field] !== undefined && item[field] !== null && String(item[field]).trim()) {
        refs.push({ id, itemId: id, room, source, type, itemType: type, field, path: String(item[field]).trim() });
      }
    }
  }
  return refs;
}

export async function localFileInfoForMedia(mediaPath, { root = PROJECT_ROOT, maxHashBytes = 50 * 1024 * 1024 } = {}) {
  const raw = String(mediaPath || '').trim();
  if (!raw) return { existsLocal: false, sizeBytes: 0, sha256: '', notes: ['empty media path'], invalidPath: true };
  if (/^(https?:|data:|blob:)/i.test(raw)) {
    return { existsLocal: false, sizeBytes: 0, sha256: '', notes: ['external or browser-only path not checked locally'], externalPath: true };
  }
  const normalized = raw.replace(/^\.\//, '');
  const absolute = path.resolve(root, normalized);
  if (!isInsideProjectRoot(absolute, root)) {
    return { existsLocal: false, sizeBytes: 0, sha256: '', notes: ['path escapes project root'], invalidPath: true };
  }
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) return { existsLocal: false, sizeBytes: 0, sha256: '', notes: ['not a file'] };
    const canHash = stat.size <= maxHashBytes;
    return {
      existsLocal: true,
      sizeBytes: stat.size,
      sha256: canHash ? await sha256File(absolute) : '',
      notes: canHash ? [] : [`skipped hash: file larger than ${maxHashBytes} bytes`]
    };
  } catch (_) {
    return { existsLocal: false, sizeBytes: 0, sha256: '', notes: ['missing local file'] };
  }
}

export function normalizeArtifactId(artifact = {}) {
  return artifact.artifactId || artifact.id || artifact.backupId || artifact.rollbackDryRunId || artifact.diffReportId || artifact.smokeReportId || '';
}

export function normalizeSourceHashes(value = {}) {
  const source = value.sourceHashes && typeof value.sourceHashes === 'object' ? value.sourceHashes : value;
  return {
    sceneIndoorHash: source.sceneIndoorHash || source.sceneHashIndoor || source.indoorSceneHash || '',
    sceneOutdoorHash: source.sceneOutdoorHash || source.sceneHashOutdoor || source.outdoorSceneHash || '',
    cmsFallbackHash: source.cmsFallbackHash || source.cmsHash || source.cmsContentFallbackHash || '',
    generatedBundleHash: source.generatedBundleHash || source.cmsGeneratedHash || source.publicBundleHash || ''
  };
}

export async function getCurrentSourceHashes({ root = PROJECT_ROOT } = {}) {
  const output = {};
  for (const [key, relPath] of Object.entries(SOURCE_HASH_FILES)) {
    const absolute = path.resolve(root, relPath);
    output[key] = await fileExists(absolute) ? await sha256File(absolute) : '';
  }
  return output;
}

export async function getCurrentSourceCounts() {
  const indoorItems = await loadSceneItems('data/scene.json');
  const outdoorItems = await loadSceneItems('data/scene_outdoor.json');
  const cms = await readJson(path.resolve(PROJECT_ROOT, 'data/cms_content_fallback.json'), {});
  return {
    sceneIndoorItems: indoorItems.length,
    sceneOutdoorItems: outdoorItems.length,
    cmsFallbackIndoorItems: Array.isArray(cms?.rooms?.indoor?.artworks) ? cms.rooms.indoor.artworks.length : 0,
    cmsFallbackOutdoorItems: Array.isArray(cms?.rooms?.outdoor?.artworks) ? cms.rooms.outdoor.artworks.length : 0
  };
}

export function hasUsableEvidence(artifact = {}) {
  const evidence = artifact.evidence;
  if (Array.isArray(evidence)) return evidence.length > 0 && evidence.some((item) => String(item || '').trim());
  if (typeof evidence === 'string') return evidence.trim().length > 0 && !/must be attached|UNSPECIFIED/i.test(evidence);
  if (evidence && typeof evidence === 'object') return Object.keys(evidence).length > 0;
  const decision = artifact.decision || {};
  return Boolean(decision.notes || decision.reviewed || decision.smokePassed || decision.approvedForPublishGate || decision.approvedForPublish);
}

export function sourceHashesMatch(artifactHashes = {}, currentHashes = {}) {
  const errors = [];
  for (const key of Object.keys(SOURCE_HASH_FILES)) {
    const artifactValue = artifactHashes[key] || '';
    const currentValue = currentHashes[key] || '';
    if (!artifactValue) {
      errors.push(`${key}: missing artifact source hash`);
      continue;
    }
    if (currentValue && artifactValue !== currentValue) {
      errors.push(`${key}: STALE_ARTIFACT_SOURCE_HASH_MISMATCH`);
    }
  }
  return errors;
}

export function classifyResultStatus(errors = [], warnings = []) {
  if (errors.length) return 'FAIL';
  if (warnings.length) return 'WARN';
  return 'PASS';
}

export function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}
