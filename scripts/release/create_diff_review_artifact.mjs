#!/usr/bin/env node
import {
  collectMediaRefsFromItems,
  getCurrentSourceCounts,
  getCurrentSourceHashes,
  loadSceneItems,
  makeArtifactId,
  normalizeStatus,
  parseArgs,
  readJson,
  writeArtifactPair
} from './artifact_utils.mjs';

const args = parseArgs();
const status = normalizeStatus(args.status, 'PENDING');
const operator = String(args.operator || '').trim();
const evidenceArg = String(args.evidence || '').trim();
const room = String(args.room || 'all').toLowerCase();
const version = String(args.version || 'V6.11.21-B6-F_F_B');
const id = makeArtifactId('diff_review');
const createdAt = new Date().toISOString();

if (status === 'PASS' && (!operator || !evidenceArg)) {
  console.error('[diff-artifact] PASS requires --operator and --evidence.');
  process.exit(1);
}

const indoorItems = await loadSceneItems('data/scene.json');
const outdoorItems = await loadSceneItems('data/scene_outdoor.json');
const cms = await readJson('data/cms_content_fallback.json', {});
const cmsIndoor = Array.isArray(cms?.rooms?.indoor?.artworks) ? cms.rooms.indoor.artworks : [];
const cmsOutdoor = Array.isArray(cms?.rooms?.outdoor?.artworks) ? cms.rooms.outdoor.artworks : [];

function getId(item) {
  return item?.id || item?.artwork_code || item?.code || '';
}
function mapById(items) {
  const map = new Map();
  for (const item of items || []) {
    const idValue = getId(item);
    if (idValue) map.set(idValue, item);
  }
  return map;
}
const sceneMap = mapById([...indoorItems, ...outdoorItems]);
const cmsMap = mapById([...cmsIndoor, ...cmsOutdoor]);
const sceneOnly = [...sceneMap.keys()].filter((idValue) => !cmsMap.has(idValue));
const cmsOnly = [...cmsMap.keys()].filter((idValue) => !sceneMap.has(idValue));
const updated = [...sceneMap.keys()].filter((idValue) => {
  if (!cmsMap.has(idValue)) return false;
  const scene = sceneMap.get(idValue) || {};
  const meta = cmsMap.get(idValue) || {};
  return ['title', 'image', 'videoUrl', 'poster', 'group'].some((key) => scene[key] && meta[key] && String(scene[key]) !== String(meta[key]));
});
const refs = [
  ...collectMediaRefsFromItems(indoorItems, 'data/scene.json', 'indoor'),
  ...collectMediaRefsFromItems(outdoorItems, 'data/scene_outdoor.json', 'outdoor'),
  ...collectMediaRefsFromItems(cmsIndoor, 'data/cms_content_fallback.json', 'indoor'),
  ...collectMediaRefsFromItems(cmsOutdoor, 'data/cms_content_fallback.json', 'outdoor')
];
const missingMedia = refs.filter((ref) => ref.path && /^\.\/assets\//.test(ref.path) === false && /^assets\//.test(ref.path) === false).length;
const sourceHashes = await getCurrentSourceHashes();
const sourceCounts = await getCurrentSourceCounts();
const decision = {
  reviewed: status === 'PASS',
  approvedForPublishGate: status === 'PASS',
  notes: evidenceArg || 'PENDING: operator has not attached review evidence.'
};
const artifact = {
  artifactId: id,
  id,
  type: 'DIFF_REVIEW',
  version,
  room,
  status,
  publishGateEligible: status === 'PASS' && decision.reviewed && decision.approvedForPublishGate && Boolean(operator) && Boolean(evidenceArg),
  createdAt,
  operator: operator || 'UNSPECIFIED',
  sourceHashes,
  sourceCounts,
  diffSummary: {
    added: sceneOnly.length,
    removed: cmsOnly.length,
    updated: updated.length,
    sceneOnly: sceneOnly.length,
    cmsOnly: cmsOnly.length,
    missingMedia
  },
  decision,
  evidence: evidenceArg ? [evidenceArg] : [],
  noSecretsIncluded: true,
  noProductionWritePerformed: true
};

const markdown = `# Diff Review Artifact\n\n- Artifact ID: \`${id}\`\n- Status: \`${status}\`\n- Version: \`${version}\`\n- Room: \`${room}\`\n- Operator: ${artifact.operator}\n- Publish gate eligible: ${artifact.publishGateEligible ? 'YES' : 'NO'}\n\n## Diff summary\n- Scene-only: ${sceneOnly.length}\n- CMS-only: ${cmsOnly.length}\n- Potential metadata updates: ${updated.length}\n- Missing-media path format warnings: ${missingMedia}\n\n## Decision\n- Reviewed: ${decision.reviewed ? 'YES' : 'NO'}\n- Approved for publish gate: ${decision.approvedForPublishGate ? 'YES' : 'NO'}\n- Notes: ${decision.notes}\n\n## Safety\n- This artifact generator is read-only.\n- No publish, seed, Supabase write, or Storage operation was performed.\n`;
const result = await writeArtifactPair({ outDir: args.out || 'reports', artifact, title: 'Diff Review Artifact', markdown });
console.log(`[artifact] created ${result.jsonPath}`);
console.log(`[artifact] created ${result.mdPath}`);
