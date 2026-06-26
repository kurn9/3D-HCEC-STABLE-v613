#!/usr/bin/env node
import path from 'node:path';
import {
  PROJECT_ROOT,
  collectMediaRefsFromItems,
  getCurrentSourceHashes,
  isNonEmptyString,
  loadSceneItems,
  localFileInfoForMedia,
  makeArtifactId,
  normalizeStatus,
  parseArgs,
  readJson,
  resolveProjectPath,
  writeArtifactPair
} from './artifact_utils.mjs';

const args = parseArgs();
const artifactId = makeArtifactId('media_readiness');
const createdAt = new Date().toISOString();
const version = String(args.version || 'V6.11.21-B6-F_H_B');
const operator = typeof args.operator === 'string' && args.operator.trim() ? args.operator.trim() : 'UNSPECIFIED';
const roomFilter = String(args.room || 'all').toLowerCase();
const evidence = isNonEmptyString(args.evidence) ? [String(args.evidence).trim()] : [];
const waiverFile = typeof args['waiver-file'] === 'string' ? args['waiver-file'] : '';

function inc(bucket, key, amount = 1) {
  const normalized = key || 'unknown';
  bucket[normalized] = (bucket[normalized] || 0) + amount;
}

function getItemType(ref) {
  return String(ref.itemType || ref.type || 'unknown').toLowerCase();
}

function getSeverity(ref, info) {
  const type = getItemType(ref);
  const field = String(ref.field || '').toLowerCase();
  const reason = [];
  if (info.invalidPath) return { severity: 'P0', reason: 'media path is invalid or escapes project root' };
  if (info.externalPath) return { severity: 'P2', reason: 'external/browser-only media path not verified locally' };
  if (type === 'text') return { severity: 'P3', reason: 'text item media field is non-critical metadata noise' };
  if (['poster', 'posterurl', 'thumbnail', 'thumbnail_url'].includes(field)) return { severity: 'P2', reason: 'poster/thumbnail missing; runtime should fallback but publish review is required' };
  if (['image', 'image_url', 'logo'].includes(field)) return { severity: 'P1', reason: 'public artwork/logo main image missing' };
  if (['videourl', 'video_url', 'video', 'src'].includes(field)) return { severity: 'P1', reason: 'public video/main media path missing' };
  if (['audiourl'].includes(field)) return { severity: 'P2', reason: 'audio media missing; feature may fallback or be optional' };
  reason.push('unclassified media field missing');
  return { severity: 'P2', reason: reason.join('; ') };
}

async function loadWaivers(filePath) {
  if (!filePath) return { paths: new Set(), refs: new Set(), source: '' };
  const resolved = resolveProjectPath(filePath, { label: 'media waiver file' });
  const json = await readJson(resolved, null);
  const paths = new Set();
  const refs = new Set();
  if (Array.isArray(json)) {
    for (const item of json) paths.add(String(item));
  } else if (json && typeof json === 'object') {
    for (const item of json.paths || json.waivedPaths || []) paths.add(String(item));
    for (const item of json.refs || json.waivedRefs || []) refs.add(String(item));
  }
  return { paths, refs, source: path.relative(PROJECT_ROOT, resolved).replace(/\\/g, '/') };
}

async function collectRefs() {
  const refs = [];
  refs.push(...collectMediaRefsFromItems(await loadSceneItems('data/scene.json'), 'scene_indoor', 'indoor'));
  refs.push(...collectMediaRefsFromItems(await loadSceneItems('data/scene_outdoor.json'), 'scene_outdoor', 'outdoor'));

  const cms = await readJson(resolveProjectPath('data/cms_content_fallback.json'), null);
  for (const room of ['indoor', 'outdoor']) {
    const artworks = cms?.rooms?.[room]?.artworks || [];
    refs.push(...collectMediaRefsFromItems(artworks, 'cms_fallback', room));
  }

  const generated = await readJson(resolveProjectPath('supabase/cms_public_content.generated.json'), null);
  if (generated?.rooms) {
    for (const room of Object.keys(generated.rooms)) {
      const artworks = generated?.rooms?.[room]?.artworks || [];
      refs.push(...collectMediaRefsFromItems(artworks, 'generated_bundle', room));
    }
  }

  return roomFilter === 'all' ? refs : refs.filter((ref) => String(ref.room || '').toLowerCase() === roomFilter);
}

const refs = await collectRefs();
const waivers = await loadWaivers(waiverFile);
const checkedReferences = [];
const missingMedia = [];
const existingMedia = [];
const uniquePaths = new Set();
const uniqueExistingPaths = new Set();
const uniqueMissingPaths = new Set();
const missingByRoom = {};
const missingByField = {};
const missingByType = {};
const missingBySource = {};
const missingBySeverity = { P0: 0, P1: 0, P2: 0, P3: 0 };

for (const ref of refs) {
  const mediaPath = String(ref.path || '').trim();
  uniquePaths.add(mediaPath);
  const info = await localFileInfoForMedia(mediaPath);
  const refKey = `${ref.source}:${ref.room}:${ref.itemId || ref.id}:${ref.field}:${mediaPath}`;
  const base = {
    room: ref.room || 'unknown',
    source: ref.source || 'unknown',
    itemId: ref.itemId || ref.id || 'unknown',
    itemType: getItemType(ref),
    field: ref.field || 'unknown',
    path: mediaPath,
    exists: info.existsLocal === true,
    existsLocal: info.existsLocal === true,
    sizeBytes: info.sizeBytes || 0,
    sha256: info.sha256 || '',
    referencedBy: ref.referencedBy || refKey,
    notes: info.notes || []
  };
  if (info.existsLocal) {
    uniqueExistingPaths.add(mediaPath);
    existingMedia.push(base);
    checkedReferences.push({ ...base, severity: 'OK', reason: 'file exists locally' });
    continue;
  }
  uniqueMissingPaths.add(mediaPath);
  const { severity, reason } = getSeverity(ref, info);
  const waived = waivers.paths.has(mediaPath) || waivers.refs.has(refKey);
  const missing = { ...base, severity, reason, waived };
  missingMedia.push(missing);
  checkedReferences.push(missing);
  inc(missingByRoom, missing.room);
  inc(missingByField, missing.field);
  inc(missingByType, missing.itemType);
  inc(missingBySource, missing.source);
  inc(missingBySeverity, severity);
}

const p0Count = missingMedia.filter((item) => item.severity === 'P0' && !item.waived).length;
const p1Count = missingMedia.filter((item) => item.severity === 'P1' && !item.waived).length;
const p2Count = missingMedia.filter((item) => item.severity === 'P2' && !item.waived).length;
const p3Count = missingMedia.filter((item) => item.severity === 'P3' && !item.waived).length;
const waiverApplied = missingMedia.some((item) => item.waived);
let status = normalizeStatus(args.status, missingMedia.length ? 'FAIL' : 'PASS');
if (status === 'PASS' && (p0Count || p1Count)) status = 'FAIL';
if (status === 'PASS' && operator === 'UNSPECIFIED') status = 'FAIL';
const publishGateEligible = status === 'PASS' && p0Count === 0 && p1Count === 0 && operator !== 'UNSPECIFIED';

const summary = {
  totalReferences: checkedReferences.length,
  existingReferences: existingMedia.length,
  missingReferences: missingMedia.length,
  uniquePaths: uniquePaths.size,
  uniqueExistingPaths: uniqueExistingPaths.size,
  uniqueMissingPaths: uniqueMissingPaths.size,
  missingByRoom,
  missingByField,
  missingByType,
  missingBySource,
  p0Count,
  p1Count,
  p2Count,
  p3Count,
  waivedCount: missingMedia.filter((item) => item.waived).length
};

const artifact = {
  artifactId,
  id: artifactId,
  type: 'MEDIA_READINESS',
  version,
  room: roomFilter,
  status,
  publishGateEligible,
  createdAt,
  operator,
  sourceHashes: await getCurrentSourceHashes(),
  summary,
  missingMedia,
  missingMediaBySeverity: {
    P0: missingMedia.filter((item) => item.severity === 'P0'),
    P1: missingMedia.filter((item) => item.severity === 'P1'),
    P2: missingMedia.filter((item) => item.severity === 'P2'),
    P3: missingMedia.filter((item) => item.severity === 'P3')
  },
  checkedReferences,
  decisions: {
    p0BlocksPublish: p0Count > 0,
    p1BlocksPublishWithoutWaiver: p1Count > 0,
    waiverSource: waivers.source || '',
    notes: p0Count || p1Count ? 'Media readiness cannot PASS while P0/P1 media is missing without an explicit waiver.' : 'No unwaived P0/P1 missing media detected.'
  },
  waiverApplied,
  noSecretsIncluded: true,
  noProductionWritePerformed: true
};

const topMissing = missingMedia.slice(0, 80).map((item) => `- [${item.severity}${item.waived ? ' waived' : ''}] ${item.room} · ${item.source} · ${item.itemId} · ${item.field} · \`${item.path}\` — ${item.reason}`).join('\n');
const markdown = `# Media Readiness Artifact\n\n- Artifact ID: \`${artifactId}\`\n- Version: \`${version}\`\n- Status: \`${status}\`\n- Operator: ${operator}\n- Room: \`${roomFilter}\`\n- Publish gate eligible: ${publishGateEligible ? 'YES' : 'NO'}\n\n## Summary\n\n| Metric | Count |\n|---|---:|\n| Total references | ${summary.totalReferences} |\n| Existing references | ${summary.existingReferences} |\n| Missing references | ${summary.missingReferences} |\n| Unique paths | ${summary.uniquePaths} |\n| Unique missing paths | ${summary.uniqueMissingPaths} |\n| P0 missing | ${summary.p0Count} |\n| P1 missing | ${summary.p1Count} |\n| P2 missing | ${summary.p2Count} |\n| P3 missing | ${summary.p3Count} |\n\n## Missing by room\n\n${Object.entries(missingByRoom).map(([key, value]) => `- ${key}: ${value}`).join('\n') || '- None'}\n\n## Missing media sample\n\n${topMissing || '- Không phát hiện missing media.'}\n\n## Gate rule\n\n- P0/P1 missing media blocks PASS unless there is an explicit waiver file.\n- This generator does not copy assets, edit scene data, publish, or write Supabase.\n`;
const result = await writeArtifactPair({ outDir: args.out || 'reports', artifact, title: 'Media Readiness Artifact', markdown });
console.log(`[artifact] created ${result.jsonPath}`);
console.log(`[artifact] created ${result.mdPath}`);
console.log(`[artifact] status ${status}; missing references=${summary.missingReferences}; P0=${p0Count}; P1=${p1Count}`);
if (status === 'FAIL') process.exitCode = 1;
