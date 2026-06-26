#!/usr/bin/env node
import {
  fileExists,
  getCurrentSourceHashes,
  hasUsableEvidence,
  normalizeArtifactId,
  normalizeSourceHashes,
  parseArgs,
  readJson,
  resolveProjectPath,
  sha256File,
  sourceHashesMatch,
  validateArtifactTextValue,
  valueKind
} from './artifact_utils.mjs';

const args = parseArgs();
const currentHashes = await getCurrentSourceHashes();
const maxAgeHours = Number(args['max-age-hours'] || process.env.ARTIFACT_MAX_AGE_HOURS || 0);


const RLS_ALLOWED_PASS_MODES = new Set(['read-only-sql', 'manual-dashboard']);
const RLS_REQUIRED_SECURITY_HASH_FILES = {
  schemaSqlHash: 'supabase/schema.sql',
  rlsPoliciesHash: 'supabase/rls_policies.sql',
  storagePoliciesHash: 'supabase/storage_policies.sql',
  adminConfigHash: 'src/cms-admin/adminConfig.js',
  adminApiHash: 'src/cms-admin/adminApi.js',
  adminAuthHash: 'src/cms-admin/adminAuth.js',
  cmsLoaderHash: 'src/shared/cmsContentLoader.js',
  publishScriptHash: 'supabase/publish_cms_bundle.js',
  seedScriptHash: 'supabase/seed_from_fallback.js',
  packageJsonHash: 'package.json'
};
const RLS_REQUIRED_CHECK_IDS = [
  'RLS_ENABLED_FOR_PUBLIC_CMS_TABLES',
  'PUBLIC_READ_SCOPED_TO_PUBLISHED_CONTENT',
  'ANON_WRITE_BLOCKED',
  'AUTHENTICATED_READ_SCOPED',
  'EDITOR_WRITE_SCOPED',
  'ADMIN_DELETE_SCOPED',
  'SERVICE_ROLE_NOT_EXPOSED_TO_FRONTEND',
  'PUBLISH_SEED_WRITE_GATED',
  'NO_PRODUCTION_WRITE_PERFORMED',
  'NO_SECRET_OUTPUT_INCLUDED'
];
const RLS_REQUIRED_TABLES = [
  'profiles',
  'site_settings',
  'index_sections',
  'gate_content',
  'rooms',
  'artworks',
  'media_assets',
  'published_bundles',
  'content_versions',
  'audit_logs'
];


const STORAGE_ALLOWED_PASS_MODES = new Set(['read-only-sql', 'manual-dashboard']);
const STORAGE_REQUIRED_SECURITY_HASH_FILES = {
  schemaSqlHash: 'supabase/schema.sql',
  rlsPoliciesHash: 'supabase/rls_policies.sql',
  storagePoliciesHash: 'supabase/storage_policies.sql',
  adminConfigHash: 'src/cms-admin/adminConfig.js',
  adminApiHash: 'src/cms-admin/adminApi.js',
  adminAuthHash: 'src/cms-admin/adminAuth.js',
  cmsLoaderHash: 'src/shared/cmsContentLoader.js',
  publishScriptHash: 'supabase/publish_cms_bundle.js',
  seedScriptHash: 'supabase/seed_from_fallback.js',
  packageJsonHash: 'package.json'
};
const STORAGE_REQUIRED_STORAGE_HASH_FILES = {
  storagePoliciesHash: 'supabase/storage_policies.sql',
  adminConfigHash: 'src/cms-admin/adminConfig.js',
  adminApiHash: 'src/cms-admin/adminApi.js',
  mediaReadinessScriptHash: 'scripts/release/create_media_readiness_artifact.mjs',
  assetManifestHash: 'data/asset_manifest.json'
};
const STORAGE_REQUIRED_CHECK_IDS = [
  'STORAGE_BUCKETS_REVIEWED',
  'STORAGE_POLICIES_REVIEWED',
  'PUBLIC_READ_SCOPED',
  'ANON_UPLOAD_BLOCKED',
  'ANON_DELETE_BLOCKED',
  'EDITOR_UPLOAD_SCOPED',
  'ADMIN_DELETE_SCOPED',
  'NO_STORAGE_UPLOAD_PERFORMED',
  'NO_STORAGE_DELETE_PERFORMED',
  'NO_PRODUCTION_WRITE_PERFORMED',
  'NO_SECRET_OUTPUT_INCLUDED',
  'SERVICE_ROLE_NOT_EXPOSED_TO_FRONTEND'
];
const STORAGE_REQUIRED_BUCKETS = ['cms-media', 'cms-public'];
const STORAGE_REQUIRED_POLICY_SCOPES = [
  'CMS_MEDIA_PUBLIC_READ',
  'CMS_PUBLIC_PUBLISHED_READ',
  'ANON_UPLOAD_BLOCKED',
  'ANON_DELETE_BLOCKED',
  'EDITOR_UPLOAD_SCOPED',
  'ADMIN_DELETE_SCOPED',
  'SERVICE_ROLE_NOT_EXPOSED_TO_FRONTEND'
];

async function getCurrentRlsSecurityHashes() {
  const output = {};
  for (const [key, relPath] of Object.entries(RLS_REQUIRED_SECURITY_HASH_FILES)) {
    const resolved = resolveProjectPath(relPath, { label: `${key} source path` });
    output[key] = await fileExists(resolved) ? await sha256File(resolved) : '';
  }
  return output;
}

const currentRlsSecurityHashes = await getCurrentRlsSecurityHashes();


async function getCurrentStorageHashMap(map) {
  const output = {};
  for (const [key, relPath] of Object.entries(map)) {
    const resolved = resolveProjectPath(relPath, { label: `${key} source path` });
    output[key] = await fileExists(resolved) ? await sha256File(resolved) : '';
  }
  return output;
}

const currentStorageSecurityHashes = await getCurrentStorageHashMap(STORAGE_REQUIRED_SECURITY_HASH_FILES);
const currentStorageSourceHashes = await getCurrentStorageHashMap(STORAGE_REQUIRED_STORAGE_HASH_FILES);

const SPECS = [
  { type: 'BACKUP', idKey: 'backup-id', pathKey: 'backup-manifest', envId: 'BACKUP_ID', envPath: 'BACKUP_MANIFEST_PATH', sourceRequired: false, evidenceRequired: false },
  { type: 'ROLLBACK_DRY_RUN', idKey: 'rollback-id', pathKey: 'rollback-report', envId: 'ROLLBACK_DRY_RUN_ID', envPath: 'ROLLBACK_DRY_RUN_REPORT_PATH', sourceRequired: false, evidenceRequired: false },
  { type: 'DIFF_REVIEW', idKey: 'diff-id', pathKey: 'diff-report', envId: 'DIFF_REVIEW_ID', envPath: 'DIFF_REVIEW_REPORT_PATH', sourceRequired: true, evidenceRequired: true },
  { type: 'SMOKE_REPORT', idKey: 'smoke-id', pathKey: 'smoke-report', envId: 'SMOKE_REPORT_ID', envPath: 'SMOKE_REPORT_PATH', sourceRequired: true, evidenceRequired: true },
  { type: 'CLEAN_RELEASE', idKey: 'clean-id', pathKey: 'clean-artifact', envId: 'CLEAN_RELEASE_MANIFEST_ID', envPath: 'CLEAN_RELEASE_ARTIFACT_PATH', sourceRequired: false, evidenceRequired: false },
  { type: 'RLS_VERIFICATION', idKey: 'rls-id', pathKey: 'rls-artifact', envId: 'RLS_VERIFICATION_ID', envPath: 'RLS_VERIFICATION_ARTIFACT_PATH', sourceRequired: false, evidenceRequired: true },
  { type: 'STORAGE_VERIFICATION', idKey: 'storage-id', pathKey: 'storage-artifact', envId: 'STORAGE_VERIFICATION_ID', envPath: 'STORAGE_VERIFICATION_ARTIFACT_PATH', sourceRequired: false, evidenceRequired: true },
  { type: 'MEDIA_READINESS', idKey: 'media-id', pathKey: 'media-artifact', envId: 'MEDIA_READINESS_ID', envPath: 'MEDIA_READINESS_ARTIFACT_PATH', sourceRequired: true, evidenceRequired: false },
  { type: 'PUBLISH_SOURCE_READINESS', idKey: 'source-id', pathKey: 'source-artifact', envId: 'PUBLISH_SOURCE_READINESS_ID', envPath: 'PUBLISH_SOURCE_ARTIFACT_PATH', sourceRequired: true, evidenceRequired: false }
];

function validateEntryValue(value, label, code) {
  const validation = validateArtifactTextValue(value, { label, allowMissing: true });
  if (!validation.ok) return { ok: false, value: '', error: `${code}: expected string, got ${valueKind(value)}` };
  return { ok: true, value: validation.missing ? '' : validation.value, error: '' };
}

function loadManifestSpecMap(manifest, manifestErrors) {
  const map = new Map();
  const artifacts = manifest?.artifacts && typeof manifest.artifacts === 'object' ? manifest.artifacts : {};
  for (const spec of SPECS) {
    const entry = artifacts[spec.type] || {};
    const idResult = validateEntryValue(entry.id, `${spec.type} id`, 'INVALID_MANIFEST_ARTIFACT_ID_TYPE');
    const pathResult = validateEntryValue(entry.path, `${spec.type} path`, 'INVALID_MANIFEST_ARTIFACT_PATH_TYPE');
    if (!idResult.ok) manifestErrors.push(`${spec.type}: ${idResult.error}`);
    if (!pathResult.ok) manifestErrors.push(`${spec.type}: ${pathResult.error}`);
    map.set(spec.type, { id: idResult.ok ? idResult.value : '', path: pathResult.ok ? pathResult.value : '' });
  }
  return map;
}

async function loadManifest(manifestPath) {
  const result = { path: manifestPath, errors: [], manifest: null, map: new Map() };
  if (!manifestPath) return result;
  let resolvedManifestPath = '';
  try {
    resolvedManifestPath = resolveProjectPath(manifestPath, { label: 'manifest path' });
    result.path = resolvedManifestPath;
  } catch (error) {
    result.errors.push(error.message);
    return result;
  }
  if (!(await fileExists(resolvedManifestPath))) {
    result.errors.push('manifest file not found');
    return result;
  }
  const manifest = await readJson(resolvedManifestPath, null);
  if (!manifest) {
    result.errors.push('manifest JSON parse failed');
    return result;
  }
  result.manifest = manifest;
  if (manifest.type !== 'PUBLISH_GATE_MANIFEST') result.errors.push(`manifest type must be PUBLISH_GATE_MANIFEST, got ${manifest.type || 'missing'}`);
  if (!manifest.operator || manifest.operator === 'UNSPECIFIED') result.errors.push('manifest operator is required');
  if (manifest.status !== 'PASS') result.errors.push(`manifest status must be PASS for publish gate, got ${manifest.status || 'missing'}`);
  result.map = loadManifestSpecMap(manifest, result.errors);
  return result;
}

function selectValue(cliValue, envValue, manifestValue, label, typeCode) {
  const raw = cliValue !== undefined ? cliValue : envValue !== undefined ? envValue : manifestValue;
  const validation = validateArtifactTextValue(raw, { label, allowMissing: true });
  if (!validation.ok) return { value: '', error: `${typeCode}: ${validation.message}` };
  return { value: validation.missing ? '' : validation.value, error: '' };
}

function getPathAndId(spec, manifestMap) {
  const fromManifest = manifestMap.get(spec.type) || {};
  const id = selectValue(args[spec.idKey], process.env[spec.envId], fromManifest.id, `${spec.type} id`, 'INVALID_ARTIFACT_ID_TYPE');
  const filePath = selectValue(args[spec.pathKey], process.env[spec.envPath], fromManifest.path, `${spec.type} path`, 'INVALID_ARTIFACT_PATH_TYPE');
  return { id: id.value, filePath: filePath.value, entryErrors: [id.error, filePath.error].filter(Boolean) };
}

function checkAge(artifact, errors, warnings) {
  if (!maxAgeHours) return;
  if (!artifact.createdAt) {
    errors.push('missing createdAt for max-age check');
    return;
  }
  const created = Date.parse(artifact.createdAt);
  if (Number.isNaN(created)) {
    errors.push('createdAt is not parseable');
    return;
  }
  const ageHours = (Date.now() - created) / 36e5;
  if (ageHours > maxAgeHours) errors.push(`STALE_ARTIFACT_AGE_EXCEEDED: ${ageHours.toFixed(2)}h > ${maxAgeHours}h`);
  else if (ageHours < -0.1) warnings.push('artifact createdAt is in the future');
}


const RLS_EVIDENCE_PLACEHOLDER_PATTERN = /must be attached|not sufficient|pending|todo|unspecified|placeholder/i;

function getRlsEvidenceText(artifact = {}) {
  const evidence = artifact.evidence;
  if (Array.isArray(evidence)) return evidence.map((item) => String(item || '').trim()).filter(Boolean).join('\n');
  if (typeof evidence === 'string') return evidence.trim();
  if (evidence && typeof evidence === 'object') return JSON.stringify(evidence);
  return '';
}

function hasUsableRlsEvidence(artifact = {}) {
  const text = getRlsEvidenceText(artifact);
  return Boolean(text && !RLS_EVIDENCE_PLACEHOLDER_PATTERN.test(text));
}

const STORAGE_EVIDENCE_PLACEHOLDER_PATTERN = /must be attached|not sufficient|pending|todo|unspecified|placeholder/i;

function getStorageEvidenceText(artifact = {}) {
  const evidence = artifact.evidence;
  if (Array.isArray(evidence)) return evidence.map((item) => String(item || '').trim()).filter(Boolean).join('\n');
  if (typeof evidence === 'string') return evidence.trim();
  if (evidence && typeof evidence === 'object') return JSON.stringify(evidence);
  return '';
}

function hasUsableStorageEvidence(artifact = {}) {
  const text = getStorageEvidenceText(artifact);
  return Boolean(text && !STORAGE_EVIDENCE_PLACEHOLDER_PATTERN.test(text));
}

function checkHashMapFreshness({ artifact, fieldName, currentHashMap, errors, label }) {
  if (!artifact[fieldName] || typeof artifact[fieldName] !== 'object') {
    errors.push(`${label} ${fieldName} are required`);
    return;
  }
  for (const [key, currentValue] of Object.entries(currentHashMap)) {
    if (!currentValue) continue;
    if (!artifact[fieldName][key]) {
      errors.push(`${label} ${fieldName}.${key} is required`);
    } else if (artifact[fieldName][key] !== currentValue) {
      errors.push(`${label} ${fieldName}.${key}: STALE_SOURCE_HASH_MISMATCH`);
    }
  }
}

function checkStorageArtifact(artifact, errors) {
  if (!artifact.version || artifact.version === 'UNSPECIFIED') errors.push('STORAGE_VERIFICATION version is required');
  if (!artifact.projectRef || artifact.projectRef === 'UNSPECIFIED') errors.push('STORAGE_VERIFICATION projectRef is required');
  if (!STORAGE_ALLOWED_PASS_MODES.has(artifact.verificationMode)) errors.push('STORAGE_VERIFICATION verificationMode must be read-only-sql or manual-dashboard for PASS');
  if (artifact.verificationMode === 'static-source-review') errors.push('STORAGE_VERIFICATION static-source-review cannot be PASS');
  if (!artifact.evidenceHash) errors.push('STORAGE_VERIFICATION evidenceHash is required');
  if (!hasUsableStorageEvidence(artifact)) errors.push('STORAGE_VERIFICATION usable evidence is required');
  if (artifact.evidenceFilePath && !artifact.evidenceFileHash) errors.push('STORAGE_VERIFICATION evidenceFileHash is required when evidenceFilePath is present');
  if (artifact.secretScan?.passed !== true) errors.push('STORAGE_VERIFICATION secret scan must pass');
  if (artifact.noProductionWritePerformed !== true) errors.push('STORAGE_VERIFICATION noProductionWritePerformed must be true');
  if (artifact.noSecretsIncluded !== true) errors.push('STORAGE_VERIFICATION noSecretsIncluded must be true');
  if (artifact.noStorageWritePerformed !== true) errors.push('STORAGE_VERIFICATION noStorageWritePerformed must be true');
  if (artifact.noStorageDeletePerformed !== true) errors.push('STORAGE_VERIFICATION noStorageDeletePerformed must be true');
  if (artifact.confirmedNoProductionWrite !== true) errors.push('STORAGE_VERIFICATION confirmedNoProductionWrite must be true');
  if (artifact.confirmedNoSecretOutput !== true) errors.push('STORAGE_VERIFICATION confirmedNoSecretOutput must be true');
  if (artifact.confirmedNoStorageUpload !== true) errors.push('STORAGE_VERIFICATION confirmedNoStorageUpload must be true');
  if (artifact.confirmedNoStorageDelete !== true) errors.push('STORAGE_VERIFICATION confirmedNoStorageDelete must be true');
  if (JSON.stringify(artifact).includes('[Circular]')) errors.push('STORAGE_VERIFICATION artifact must not contain [Circular] serialization markers');

  const artifactSourceHashes = normalizeSourceHashes(artifact);
  for (const error of sourceHashesMatch(artifactSourceHashes, currentHashes)) errors.push(`STORAGE_VERIFICATION ${error}`);
  checkHashMapFreshness({ artifact, fieldName: 'securitySourceHashes', currentHashMap: currentStorageSecurityHashes, errors, label: 'STORAGE_VERIFICATION' });
  checkHashMapFreshness({ artifact, fieldName: 'storageSourceHashes', currentHashMap: currentStorageSourceHashes, errors, label: 'STORAGE_VERIFICATION' });

  if (!Array.isArray(artifact.verifiedBuckets) || artifact.verifiedBuckets.length === 0) {
    errors.push('STORAGE_VERIFICATION verifiedBuckets must be non-empty');
  } else {
    const bucketNames = new Set(artifact.verifiedBuckets.map((item) => item.bucket || item.name));
    for (const requiredBucket of STORAGE_REQUIRED_BUCKETS) {
      if (!bucketNames.has(requiredBucket)) errors.push(`STORAGE_VERIFICATION missing verified bucket: ${requiredBucket}`);
    }
    const failedBuckets = artifact.verifiedBuckets.filter((item) => item.status !== 'PASS' && item.status !== 'REVIEWED').map((item) => item.bucket || item.name || 'unknown');
    if (failedBuckets.length) errors.push(`STORAGE_VERIFICATION verifiedBuckets not PASS: ${failedBuckets.join(', ')}`);
  }

  if (!Array.isArray(artifact.verifiedPolicies) || artifact.verifiedPolicies.length === 0) {
    errors.push('STORAGE_VERIFICATION verifiedPolicies must be non-empty');
  } else {
    const policyScopes = new Set(artifact.verifiedPolicies.map((item) => item.policyScope || item.id || item.name));
    for (const requiredScope of STORAGE_REQUIRED_POLICY_SCOPES) {
      if (!policyScopes.has(requiredScope)) errors.push(`STORAGE_VERIFICATION missing verified policy scope: ${requiredScope}`);
    }
    const failedPolicies = artifact.verifiedPolicies.filter((item) => item.status !== 'PASS').map((item) => item.policyScope || item.id || 'unknown');
    if (failedPolicies.length) errors.push(`STORAGE_VERIFICATION verifiedPolicies not PASS: ${failedPolicies.join(', ')}`);
  }

  if (!Array.isArray(artifact.structuredChecks) || artifact.structuredChecks.length === 0) {
    errors.push('STORAGE_VERIFICATION structuredChecks must be non-empty');
  } else {
    const checkIds = new Set(artifact.structuredChecks.map((check) => check.id));
    for (const requiredId of STORAGE_REQUIRED_CHECK_IDS) {
      if (!checkIds.has(requiredId)) errors.push(`STORAGE_VERIFICATION missing structured check: ${requiredId}`);
    }
    const failed = artifact.structuredChecks.filter((check) => check.status !== 'PASS').map((check) => check.id || 'unknown');
    if (failed.length) errors.push(`STORAGE_VERIFICATION structuredChecks not PASS: ${failed.join(', ')}`);
  }

  if (!artifact.checkSummary || typeof artifact.checkSummary !== 'object') {
    errors.push('STORAGE_VERIFICATION checkSummary is required');
  } else {
    if (Number(artifact.checkSummary.fail || 0) !== 0) errors.push('STORAGE_VERIFICATION checkSummary.fail must equal 0');
    if (Number(artifact.checkSummary.pending || 0) !== 0) errors.push('STORAGE_VERIFICATION checkSummary.pending must equal 0');
  }
}


function checkRlsArtifact(artifact, errors) {
  if (!artifact.version || artifact.version === 'UNSPECIFIED') errors.push('RLS_VERIFICATION version is required');
  if (!artifact.projectRef || artifact.projectRef === 'UNSPECIFIED') errors.push('RLS_VERIFICATION projectRef is required');
  if (!RLS_ALLOWED_PASS_MODES.has(artifact.verificationMode)) errors.push('RLS_VERIFICATION verificationMode must be read-only-sql or manual-dashboard for PASS');
  if (artifact.verificationMode === 'static-source-review') errors.push('RLS_VERIFICATION static-source-review cannot be PASS');
  if (!artifact.evidenceHash) errors.push('RLS_VERIFICATION evidenceHash is required');
  if (!hasUsableRlsEvidence(artifact)) errors.push('RLS_VERIFICATION usable evidence is required');
  if (artifact.evidenceFilePath && !artifact.evidenceFileHash) errors.push('RLS_VERIFICATION evidenceFileHash is required when evidenceFilePath is present');
  if (artifact.secretScan && artifact.secretScan.passed !== true) errors.push('RLS_VERIFICATION secret scan must pass');
  if (artifact.noProductionWritePerformed !== true) errors.push('RLS_VERIFICATION noProductionWritePerformed must be true');
  if (artifact.noSecretsIncluded !== true) errors.push('RLS_VERIFICATION noSecretsIncluded must be true');
  if (artifact.confirmedNoProductionWrite !== true) errors.push('RLS_VERIFICATION confirmedNoProductionWrite must be true');
  if (artifact.confirmedNoSecretOutput !== true) errors.push('RLS_VERIFICATION confirmedNoSecretOutput must be true');

  const artifactSourceHashes = normalizeSourceHashes(artifact);
  for (const error of sourceHashesMatch(artifactSourceHashes, currentHashes)) errors.push(`RLS_VERIFICATION ${error}`);

  if (!artifact.securitySourceHashes || typeof artifact.securitySourceHashes !== 'object') {
    errors.push('RLS_VERIFICATION securitySourceHashes are required');
  } else {
    for (const [key, currentValue] of Object.entries(currentRlsSecurityHashes)) {
      if (!artifact.securitySourceHashes[key]) {
        errors.push(`RLS_VERIFICATION securitySourceHashes.${key} is required`);
      } else if (currentValue && artifact.securitySourceHashes[key] !== currentValue) {
        errors.push(`RLS_VERIFICATION securitySourceHashes.${key}: STALE_SECURITY_SOURCE_HASH_MISMATCH`);
      }
    }
  }

  if (!Array.isArray(artifact.structuredChecks) || artifact.structuredChecks.length === 0) {
    errors.push('RLS_VERIFICATION structuredChecks must be non-empty');
  } else {
    const checkIds = new Set(artifact.structuredChecks.map((check) => check.id));
    for (const requiredId of RLS_REQUIRED_CHECK_IDS) {
      if (!checkIds.has(requiredId)) errors.push(`RLS_VERIFICATION missing structured check: ${requiredId}`);
    }
    const failed = artifact.structuredChecks.filter((check) => check.status !== 'PASS').map((check) => check.id || 'unknown');
    if (failed.length) errors.push(`RLS_VERIFICATION structuredChecks not PASS: ${failed.join(', ')}`);
  }

  if (!artifact.checkSummary || typeof artifact.checkSummary !== 'object') {
    errors.push('RLS_VERIFICATION checkSummary is required');
  } else {
    if (Number(artifact.checkSummary.fail || 0) !== 0) errors.push('RLS_VERIFICATION checkSummary.fail must equal 0');
    if (Number(artifact.checkSummary.pending || 0) !== 0) errors.push('RLS_VERIFICATION checkSummary.pending must equal 0');
  }

  if (!Array.isArray(artifact.verifiedTables) || artifact.verifiedTables.length === 0) {
    errors.push('RLS_VERIFICATION verifiedTables must be non-empty');
  } else {
    const tableNames = new Set(artifact.verifiedTables.map((item) => item.table || item.name));
    for (const requiredTable of RLS_REQUIRED_TABLES) {
      if (!tableNames.has(requiredTable)) errors.push(`RLS_VERIFICATION missing verified table: ${requiredTable}`);
    }
  }

  if (!Array.isArray(artifact.verifiedPolicies) || artifact.verifiedPolicies.length === 0) {
    errors.push('RLS_VERIFICATION verifiedPolicies must be non-empty');
  }

}

function checkStandardArtifact(artifact, spec, expectedId, errors, warnings) {
  const artifactId = normalizeArtifactId(artifact);
  if (!artifactId) errors.push('missing artifact id');
  if (expectedId && artifactId !== expectedId) errors.push(`artifact id mismatch: expected ${expectedId}, got ${artifactId}`);
  if (artifact.type !== spec.type) errors.push(`type mismatch: expected ${spec.type}, got ${artifact.type || 'missing'}`);
  if (artifact.status !== 'PASS') errors.push(`status must be PASS, got ${artifact.status || 'missing'}`);
  if (artifact.publishGateEligible !== true) errors.push('publishGateEligible must be true');
  if (!artifact.hash) warnings.push('missing artifact hash field');
  if (!artifact.operator || artifact.operator === 'UNSPECIFIED') errors.push('operator is required');
  const usesCustomEvidenceValidation = spec.type === 'RLS_VERIFICATION' || spec.type === 'STORAGE_VERIFICATION';
  if (spec.evidenceRequired && !usesCustomEvidenceValidation && !hasUsableEvidence(artifact)) errors.push('operator evidence is required');
  if (spec.sourceRequired) {
    const artifactHashes = normalizeSourceHashes(artifact);
    const hashErrors = sourceHashesMatch(artifactHashes, currentHashes);
    for (const error of hashErrors) errors.push(error);
  }
  if (spec.type === 'DIFF_REVIEW') {
    if (artifact.decision?.reviewed !== true) errors.push('decision.reviewed must be true');
    if (artifact.decision?.approvedForPublishGate !== true) errors.push('decision.approvedForPublishGate must be true');
  }
  if (spec.type === 'SMOKE_REPORT') {
    const checks = artifact.checks || {};
    const failedChecks = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key);
    if (failedChecks.length) errors.push(`smoke checks not PASS: ${failedChecks.join(', ')}`);
    if (artifact.decision?.smokePassed !== true) errors.push('decision.smokePassed must be true');
    if (artifact.decision?.approvedForPublishGate !== true) errors.push('decision.approvedForPublishGate must be true');
  }
  if (spec.type === 'MEDIA_READINESS') {
    const p0 = Number(artifact.summary?.p0Count ?? artifact.criticalMissingCount ?? 0);
    const p1 = Number(artifact.summary?.p1Count ?? 0);
    if (p0 !== 0) errors.push('MEDIA_READINESS p0Count must equal 0');
    if (p1 !== 0 && artifact.waiverApplied !== true) errors.push('MEDIA_READINESS p1Count must equal 0 unless waiverApplied is true');
  }
  if (spec.type === 'PUBLISH_SOURCE_READINESS') {
    if (artifact.decision?.scenePlacementPlanConfirmed !== true) errors.push('scene placement publish plan must be confirmed');
    if (artifact.decision?.cmsMetadataPlanConfirmed !== true) errors.push('CMS metadata publish plan must be confirmed');
    if (artifact.decision?.mediaAssetsPlanConfirmed !== true) errors.push('media assets publish plan must be confirmed');
  }
  if (spec.type === 'RLS_VERIFICATION') {
    checkRlsArtifact(artifact, errors);
  }
  if (spec.type === 'STORAGE_VERIFICATION') {
    checkStorageArtifact(artifact, errors);
  }
  checkAge(artifact, errors, warnings);
}

function checkBackupArtifact(artifact, expectedId, errors) {
  if (!artifact.backupId) errors.push('missing backupId');
  if (expectedId && artifact.backupId !== expectedId) errors.push(`backupId mismatch: expected ${expectedId}, got ${artifact.backupId}`);
  if (!artifact.hashes || typeof artifact.hashes !== 'object' || !Object.keys(artifact.hashes).length) errors.push('backup hashes are required');
  if (artifact.noSecretsIncluded !== true) errors.push('noSecretsIncluded must be true');
  if (!Array.isArray(artifact.sourceFiles)) errors.push('sourceFiles array is required');
}

function checkRollbackArtifact(artifact, expectedId, errors) {
  if (!artifact.rollbackDryRunId) errors.push('missing rollbackDryRunId');
  if (expectedId && artifact.rollbackDryRunId !== expectedId) errors.push(`rollbackDryRunId mismatch: expected ${expectedId}, got ${artifact.rollbackDryRunId}`);
  if (artifact.status !== 'PASS') errors.push(`rollback dry-run status must be PASS, got ${artifact.status || 'missing'}`);
  if (!artifact.backupId) errors.push('rollback artifact must reference backupId');
}

async function validateOne(spec, entry) {
  const errors = [...(entry.entryErrors || [])];
  const warnings = [];
  let filePath = entry.filePath;
  const expectedId = entry.id;
  let artifact = null;
  if (!filePath) {
    errors.push('missing artifact path');
    return { spec, filePath, expectedId, artifact, errors, warnings };
  }
  try {
    filePath = resolveProjectPath(filePath, { label: `${spec.type} artifact path` });
  } catch (error) {
    errors.push(error.message);
    return { spec, filePath, expectedId, artifact, errors, warnings };
  }
  if (!(await fileExists(filePath))) {
    errors.push('artifact file not found');
    return { spec, filePath, expectedId, artifact, errors, warnings };
  }
  artifact = await readJson(filePath, null);
  if (!artifact) {
    errors.push('artifact JSON parse failed');
    return { spec, filePath, expectedId, artifact, errors, warnings };
  }
  if (spec.type === 'BACKUP') checkBackupArtifact(artifact, expectedId, errors);
  else if (spec.type === 'ROLLBACK_DRY_RUN') checkRollbackArtifact(artifact, expectedId, errors);
  else checkStandardArtifact(artifact, spec, expectedId, errors, warnings);
  return { spec, filePath, expectedId, artifact, errors, warnings };
}

const manifestPath = args.manifest || process.env.PUBLISH_GATE_MANIFEST_PATH || '';
const manifestResult = await loadManifest(manifestPath);
let failed = manifestResult.errors.length > 0;
const results = [];

for (const spec of SPECS) {
  const entry = getPathAndId(spec, manifestResult.map);
  const result = await validateOne(spec, entry);
  results.push(result);
  if (result.errors.length) failed = true;
}

console.log(failed ? '[artifact-validate] FAIL' : '[artifact-validate] PASS');
if (manifestPath) {
  console.log(`Manifest: ${manifestPath}`);
  for (const error of manifestResult.errors) console.log(`- MANIFEST: ${error}`);
}
for (const result of results) {
  const label = `${result.spec.type}: ${result.filePath || '(missing path)'}`;
  if (result.errors.length) {
    console.log(`- ${label}`);
    for (const error of result.errors) console.log(`  - ${error}`);
  } else {
    console.log(`- ${label}: PASS`);
  }
  for (const warning of result.warnings) console.log(`  - WARN: ${warning}`);
}

if (failed) process.exit(1);
