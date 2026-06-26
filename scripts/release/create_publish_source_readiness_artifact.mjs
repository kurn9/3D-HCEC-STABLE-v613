#!/usr/bin/env node
import {
  fileExists,
  getCurrentSourceHashes,
  isNonEmptyString,
  loadSceneItems,
  makeArtifactId,
  normalizeStatus,
  parseArgs,
  readJson,
  resolveProjectPath,
  writeArtifactPair
} from './artifact_utils.mjs';

const args = parseArgs();
const artifactId = makeArtifactId('publish_source_readiness');
const createdAt = new Date().toISOString();
const version = String(args.version || 'V6.11.21-B6-F_H_B');
const operator = typeof args.operator === 'string' && args.operator.trim() ? args.operator.trim() : 'UNSPECIFIED';
const room = String(args.room || 'all').toLowerCase();
const evidence = isNonEmptyString(args.evidence) ? [String(args.evidence).trim()] : [];

function getId(item) {
  return item?.id || item?.artwork_code || item?.code || '';
}
function mapById(items) {
  const map = new Map();
  const duplicates = [];
  for (const item of items || []) {
    const id = getId(item);
    if (!id) continue;
    if (map.has(id)) duplicates.push(id);
    else map.set(id, item);
  }
  return { map, duplicates };
}
function getCmsItemsByRoom(cms, targetRoom) {
  return Array.isArray(cms?.rooms?.[targetRoom]?.artworks) ? cms.rooms[targetRoom].artworks : [];
}
function getGeneratedItemsByRoom(generated, targetRoom) {
  return Array.isArray(generated?.rooms?.[targetRoom]?.artworks) ? generated.rooms[targetRoom].artworks : [];
}
function hasPlacement(item) {
  return Array.isArray(item?.position) || Array.isArray(item?.rotation) || Array.isArray(item?.size) || item?.placement || item?.transform;
}
function listMissingMetadata(sceneItems, metaMap) {
  const out = [];
  for (const item of sceneItems) {
    const id = getId(item);
    if (!id || metaMap.has(id)) continue;
    out.push({ id, type: item?.type || 'artwork', title: item?.title || '', group: item?.group || '' });
  }
  return out;
}

const indoorScene = await loadSceneItems('data/scene.json');
const outdoorScene = await loadSceneItems('data/scene_outdoor.json');
const cms = await readJson(resolveProjectPath('data/cms_content_fallback.json'), {});
const generatedExists = await fileExists(resolveProjectPath('supabase/cms_public_content.generated.json'));
const generated = generatedExists ? await readJson(resolveProjectPath('supabase/cms_public_content.generated.json'), {}) : {};
const cmsIndoor = getCmsItemsByRoom(cms, 'indoor');
const cmsOutdoor = getCmsItemsByRoom(cms, 'outdoor');
const generatedIndoor = getGeneratedItemsByRoom(generated, 'indoor');
const generatedOutdoor = getGeneratedItemsByRoom(generated, 'outdoor');

const sceneItems = room === 'indoor' ? indoorScene : room === 'outdoor' ? outdoorScene : [...indoorScene, ...outdoorScene];
const cmsItems = room === 'indoor' ? cmsIndoor : room === 'outdoor' ? cmsOutdoor : [...cmsIndoor, ...cmsOutdoor];
const generatedItems = room === 'indoor' ? generatedIndoor : room === 'outdoor' ? generatedOutdoor : [...generatedIndoor, ...generatedOutdoor];
const scene = mapById(sceneItems);
const cmsMap = mapById(cmsItems);
const generatedMap = mapById(generatedItems);

const sceneIds = new Set(scene.map.keys());
const cmsIds = new Set(cmsMap.map.keys());
const generatedIds = new Set(generatedMap.map.keys());
const sceneOnly = [...sceneIds].filter((id) => !cmsIds.has(id) && !generatedIds.has(id)).sort();
const cmsOnly = [...cmsIds].filter((id) => !sceneIds.has(id)).sort();
const generatedOnly = [...generatedIds].filter((id) => !sceneIds.has(id)).sort();
const missingMetadata = listMissingMetadata(sceneItems, new Map([...cmsMap.map, ...generatedMap.map]));
const duplicateIds = [...new Set([...scene.duplicates, ...cmsMap.duplicates, ...generatedMap.duplicates])].sort();
const generatedHasPlacement = generatedItems.some(hasPlacement);
const scenePlacementRequired = true;
const placementSource = typeof args['placement-source'] === 'string' ? args['placement-source'].trim().toLowerCase() : '';
const cmsRole = typeof args['cms-role'] === 'string' ? args['cms-role'].trim().toLowerCase() : '';
const allowGeneratedWithoutPlacement = args['allow-generated-without-placement'] === true;
const cleanBaselineOk = args['clean-baseline-ok'] === true;
const confirmScenePlacementPlan = args['confirm-scene-placement-plan'] === true;
const confirmCmsMetadataPlan = args['confirm-cms-metadata-plan'] === true;
const confirmMediaAssetsPlan = args['confirm-media-assets-plan'] === true;
const planProvided = isNonEmptyString(args.plan);
const architectureMode = placementSource === 'scene-json' && cmsRole === 'metadata-layer';
const generatedPlacementRequired = !(architectureMode && allowGeneratedWithoutPlacement);
const cleanBaselineDetected = indoorScene.length === 0
  && outdoorScene.length === 0
  && cmsIndoor.length === 0
  && cmsOutdoor.length === 0
  && generatedIndoor.length === 0
  && generatedOutdoor.length === 0
  && sceneOnly.length === 0
  && cmsOnly.length === 0
  && generatedOnly.length === 0
  && missingMetadata.length === 0
  && duplicateIds.length === 0;
const cleanBaselineAccepted = cleanBaselineDetected && cleanBaselineOk && architectureMode;
const generatedWithoutPlacementAccepted = !generatedHasPlacement
  && architectureMode
  && allowGeneratedWithoutPlacement
  && confirmScenePlacementPlan
  && confirmCmsMetadataPlan
  && confirmMediaAssetsPlan
  && planProvided
  && evidence.length > 0;
const publishPlanRequired = generatedPlacementRequired && !generatedHasPlacement
  || sceneOnly.length > 0
  || cmsOnly.length > 0
  || generatedOnly.length > 0
  || missingMetadata.length > 0;
const sourceHashes = await getCurrentSourceHashes();
const requiredHashKeys = ['sceneIndoorHash', 'sceneOutdoorHash', 'cmsFallbackHash', 'generatedBundleHash'];
const sourceHashesComplete = requiredHashKeys.every((key) => isNonEmptyString(sourceHashes?.[key]));

const decision = {
  scenePlacementPlanConfirmed: confirmScenePlacementPlan,
  cmsMetadataPlanConfirmed: confirmCmsMetadataPlan,
  mediaAssetsPlanConfirmed: confirmMediaAssetsPlan,
  sourceReviewed: args.status === 'PASS',
  approvedForPublishGate: false,
  placementSource,
  cmsRole,
  generatedPlacementRequired,
  generatedWithoutPlacementAccepted,
  cleanBaselineAccepted,
  notes: planProvided ? String(args.plan).trim() : 'PENDING: operator must confirm Scene JSON placement, CMS metadata, generated bundle, and media asset publish plan.'
};

const requestedStatus = normalizeStatus(args.status, 'PENDING');
const gateErrors = [];
const warnings = [];
if (operator === 'UNSPECIFIED') gateErrors.push('operator is required');
if (!evidence.length) gateErrors.push('evidence is required');
if (!confirmScenePlacementPlan) gateErrors.push('missing --confirm-scene-placement-plan');
if (!confirmCmsMetadataPlan) gateErrors.push('missing --confirm-cms-metadata-plan');
if (!confirmMediaAssetsPlan) gateErrors.push('missing --confirm-media-assets-plan');
if (architectureMode) {
  if (placementSource !== 'scene-json') gateErrors.push('missing --placement-source scene-json');
  if (cmsRole !== 'metadata-layer') gateErrors.push('missing --cms-role metadata-layer');
  if (!allowGeneratedWithoutPlacement) gateErrors.push('missing --allow-generated-without-placement');
  if (!planProvided) gateErrors.push('architecture mode requires explicit --plan text');
  if (cleanBaselineDetected && !cleanBaselineOk) gateErrors.push('clean baseline requires --clean-baseline-ok');
  if (sceneOnly.length) gateErrors.push(`architecture mode requires sceneOnlyCount=0, got ${sceneOnly.length}`);
  if (cmsOnly.length) gateErrors.push(`architecture mode requires cmsOnlyCount=0, got ${cmsOnly.length}`);
  if (generatedOnly.length) gateErrors.push(`architecture mode requires generatedOnlyCount=0, got ${generatedOnly.length}`);
  if (duplicateIds.length) gateErrors.push(`architecture mode requires duplicateIds=0, got ${duplicateIds.length}`);
  if (missingMetadata.length) gateErrors.push(`architecture mode requires missingMetadataCount=0, got ${missingMetadata.length}`);
  if (!sourceHashesComplete) gateErrors.push('sourceHashes must include sceneIndoorHash, sceneOutdoorHash, cmsFallbackHash, generatedBundleHash');
}
if (!generatedHasPlacement) {
  if (generatedWithoutPlacementAccepted) {
    warnings.push('Generated bundle does not contain placement; accepted because placementSource=scene-json and cmsRole=metadata-layer.');
  } else {
    gateErrors.push('generated bundle does not contain placement; Scene JSON publish plan is mandatory');
  }
}
if ((sceneOnly.length || cmsOnly.length || generatedOnly.length || missingMetadata.length) && !planProvided) gateErrors.push('scene/CMS/generated differences require explicit --plan text');
let status = requestedStatus;
if (requestedStatus === 'PASS' && gateErrors.length) status = 'FAIL';
if (requestedStatus !== 'PASS' && gateErrors.length) status = requestedStatus;
decision.approvedForPublishGate = status === 'PASS' && gateErrors.length === 0;

const summary = {
  indoorSceneCount: indoorScene.length,
  outdoorSceneCount: outdoorScene.length,
  indoorCmsCount: cmsIndoor.length,
  outdoorCmsCount: cmsOutdoor.length,
  indoorGeneratedCount: generatedIndoor.length,
  outdoorGeneratedCount: generatedOutdoor.length,
  sceneOnlyCount: sceneOnly.length,
  cmsOnlyCount: cmsOnly.length,
  generatedOnlyCount: generatedOnly.length,
  duplicateIdCount: duplicateIds.length,
  missingMetadataCount: missingMetadata.length,
  generatedHasPlacement,
  scenePlacementRequired,
  publishPlanRequired,
  placementSource,
  cmsRole,
  generatedPlacementRequired,
  generatedWithoutPlacementAccepted,
  cleanBaselineDetected,
  cleanBaselineAccepted,
  sourceHashesComplete
};

const artifact = {
  artifactId,
  id: artifactId,
  type: 'PUBLISH_SOURCE_READINESS',
  version,
  room,
  status,
  publishGateEligible: status === 'PASS' && decision.approvedForPublishGate,
  createdAt,
  operator,
  evidence,
  sourceHashes,
  summary,
  sceneOnly,
  cmsOnly,
  generatedOnly,
  duplicateIds,
  missingMetadata,
  architecture: {
    placementSource: placementSource || 'UNSPECIFIED',
    cmsRole: cmsRole || 'UNSPECIFIED',
    generatedPlacementRequired,
    generatedWithoutPlacementAccepted,
    cleanBaselineAccepted
  },
  sourceOfTruthDecision: 'Gallery placement source-of-truth is Scene JSON. CMS/generated bundle is metadata and does not create 3D placement by itself.',
  publishPlan: decision.notes,
  decision,
  warnings,
  gateErrors,
  noSecretsIncluded: true,
  noProductionWritePerformed: true
};

const markdown = `# Publish Source-of-Truth Readiness Artifact

- Artifact ID: \`${artifactId}\`
- Version: \`${version}\`
- Status: \`${status}\`
- Operator: ${operator}
- Publish gate eligible: ${artifact.publishGateEligible ? 'YES' : 'NO'}

## Summary

| Metric | Count / State |
|---|---:|
| Indoor scene items | ${summary.indoorSceneCount} |
| Outdoor scene items | ${summary.outdoorSceneCount} |
| Indoor CMS items | ${summary.indoorCmsCount} |
| Outdoor CMS items | ${summary.outdoorCmsCount} |
| Indoor generated items | ${summary.indoorGeneratedCount} |
| Outdoor generated items | ${summary.outdoorGeneratedCount} |
| Scene-only | ${summary.sceneOnlyCount} |
| CMS-only | ${summary.cmsOnlyCount} |
| Generated-only | ${summary.generatedOnlyCount} |
| Duplicate IDs | ${summary.duplicateIdCount} |
| Missing metadata | ${summary.missingMetadataCount} |
| Generated has placement | ${summary.generatedHasPlacement ? 'YES' : 'NO'} |
| Placement source | ${summary.placementSource || 'UNSPECIFIED'} |
| CMS role | ${summary.cmsRole || 'UNSPECIFIED'} |
| Generated placement required | ${summary.generatedPlacementRequired ? 'YES' : 'NO'} |
| Generated without placement accepted | ${summary.generatedWithoutPlacementAccepted ? 'YES' : 'NO'} |
| Clean baseline accepted | ${summary.cleanBaselineAccepted ? 'YES' : 'NO'} |
| Source hashes complete | ${summary.sourceHashesComplete ? 'YES' : 'NO'} |

## Architecture decision

- Placement source: \`${artifact.architecture.placementSource}\`
- CMS role: \`${artifact.architecture.cmsRole}\`
- Generated placement required: ${artifact.architecture.generatedPlacementRequired ? 'YES' : 'NO'}
- Generated without placement accepted: ${artifact.architecture.generatedWithoutPlacementAccepted ? 'YES' : 'NO'}
- Clean baseline accepted: ${artifact.architecture.cleanBaselineAccepted ? 'YES' : 'NO'}

## Warnings

${warnings.length ? warnings.map((item) => `- ${item}`).join('\n') : '- None'}

## Gate errors

${gateErrors.length ? gateErrors.map((item) => `- ${item}`).join('\n') : '- None'}

## Source-of-truth decision

${artifact.sourceOfTruthDecision}

## Publish plan

${artifact.publishPlan}

## Scene-only sample

${sceneOnly.slice(0, 80).map((id) => `- \`${id}\``).join('\n') || '- None'}

## CMS-only sample

${cmsOnly.slice(0, 80).map((id) => `- \`${id}\``).join('\n') || '- None'}
`;
const result = await writeArtifactPair({ outDir: args.out || 'reports', artifact, title: 'Publish Source Readiness Artifact', markdown });
console.log(`[artifact] created ${result.jsonPath}`);
console.log(`[artifact] created ${result.mdPath}`);
console.log(`[artifact] status ${status}; generatedHasPlacement=${generatedHasPlacement}; sceneOnly=${sceneOnly.length}; cmsOnly=${cmsOnly.length}`);
if (status === 'FAIL') process.exitCode = 1;
