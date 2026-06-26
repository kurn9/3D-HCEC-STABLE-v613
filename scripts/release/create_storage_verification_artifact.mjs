#!/usr/bin/env node
import path from 'node:path';
import {
  PROJECT_ROOT,
  fileExists,
  getCurrentSourceHashes,
  isInsideProjectRoot,
  makeArtifactId,
  normalizeStatus,
  parseArgs,
  readText,
  resolveProjectPath,
  safeRel,
  sha256File,
  sha256Text,
  summarizeChecks,
  writeArtifactPair
} from './artifact_utils.mjs';

const args = parseArgs();
const requestedStatus = normalizeStatus(args.status);
const id = makeArtifactId('storage_verification');
const createdAt = new Date().toISOString();

const ALLOWED_PASS_MODES = new Set(['read-only-sql', 'manual-dashboard']);
const ALLOWED_MODES = new Set([...ALLOWED_PASS_MODES, 'static-source-review']);
const REQUIRED_BUCKETS = ['cms-media', 'cms-public'];
const REQUIRED_POLICY_SCOPES = [
  'CMS_MEDIA_PUBLIC_READ',
  'CMS_PUBLIC_PUBLISHED_READ',
  'ANON_UPLOAD_BLOCKED',
  'ANON_DELETE_BLOCKED',
  'EDITOR_UPLOAD_SCOPED',
  'ADMIN_DELETE_SCOPED',
  'SERVICE_ROLE_NOT_EXPOSED_TO_FRONTEND'
];
const REQUIRED_CONFIRM_FLAGS = [
  'confirm-no-production-write',
  'confirm-no-secret-output',
  'confirm-no-storage-upload',
  'confirm-no-storage-delete',
  'confirm-buckets-reviewed',
  'confirm-storage-policies-reviewed',
  'confirm-anon-upload-blocked',
  'confirm-anon-delete-blocked',
  'confirm-public-read-scoped',
  'confirm-editor-upload-scoped',
  'confirm-admin-delete-scoped',
  'confirm-service-role-not-exposed'
];
const REQUIRED_CHECKS = [
  ['STORAGE_BUCKETS_REVIEWED', 'Storage buckets reviewed', 'confirm-buckets-reviewed'],
  ['STORAGE_POLICIES_REVIEWED', 'Storage policies reviewed', 'confirm-storage-policies-reviewed'],
  ['PUBLIC_READ_SCOPED', 'Public read is scoped to approved buckets/objects', 'confirm-public-read-scoped'],
  ['ANON_UPLOAD_BLOCKED', 'Anonymous upload is blocked', 'confirm-anon-upload-blocked'],
  ['ANON_DELETE_BLOCKED', 'Anonymous delete is blocked', 'confirm-anon-delete-blocked'],
  ['EDITOR_UPLOAD_SCOPED', 'Editor upload is scoped', 'confirm-editor-upload-scoped'],
  ['ADMIN_DELETE_SCOPED', 'Admin delete is scoped', 'confirm-admin-delete-scoped'],
  ['NO_STORAGE_UPLOAD_PERFORMED', 'No Storage upload was performed', 'confirm-no-storage-upload'],
  ['NO_STORAGE_DELETE_PERFORMED', 'No Storage delete was performed', 'confirm-no-storage-delete'],
  ['NO_PRODUCTION_WRITE_PERFORMED', 'No production write was performed', 'confirm-no-production-write'],
  ['NO_SECRET_OUTPUT_INCLUDED', 'No secret output is included', 'confirm-no-secret-output'],
  ['SERVICE_ROLE_NOT_EXPOSED_TO_FRONTEND', 'Service role is not exposed to frontend', 'confirm-service-role-not-exposed']
];
const SECURITY_HASH_FILES = {
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
const STORAGE_HASH_FILES = {
  storagePoliciesHash: 'supabase/storage_policies.sql',
  adminConfigHash: 'src/cms-admin/adminConfig.js',
  adminApiHash: 'src/cms-admin/adminApi.js',
  mediaReadinessScriptHash: 'scripts/release/create_media_readiness_artifact.mjs',
  assetManifestHash: 'data/asset_manifest.json'
};
const SECRET_PATTERNS = [
  { id: 'service_role_reference', pattern: /service[_-]?role/i },
  { id: 'supabase_service_role_key', pattern: /SUPABASE_SERVICE_ROLE_KEY/i },
  { id: 'jwt_like_token', pattern: /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/ },
  { id: 'sb_secret_token', pattern: /sb_secret/i },
  { id: 'private_key_reference', pattern: /private\s+key/i },
  { id: 'pem_private_key', pattern: /BEGIN\s+(RSA\s+)?PRIVATE\s+KEY/i },
  { id: 'jwt_secret_reference', pattern: /jwt\s*secret/i },
  { id: 'password_assignment', pattern: /password\s*=/i },
  { id: 'api_key_assignment', pattern: /apikey\s*=/i },
  { id: 'authorization_bearer', pattern: /authorization\s*:\s*bearer/i }
];

function argText(key) {
  return typeof args[key] === 'string' ? args[key].trim() : '';
}

function hasFlag(key) {
  return args[key] === true || args[key] === 'true' || args[key] === 'YES';
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function requestedBuckets() {
  const fromArgs = String(args.buckets || REQUIRED_BUCKETS.join(',')).split(',');
  return uniqueNonEmpty([...fromArgs, ...REQUIRED_BUCKETS]);
}

function secretFindingsForText(text) {
  const findings = [];
  for (const item of SECRET_PATTERNS) {
    if (item.pattern.test(String(text || ''))) findings.push({ id: item.id, status: 'BLOCKED', message: 'Secret-like evidence detected and blocked.' });
  }
  return findings;
}

function failControlled(errors) {
  console.error('[artifact:storage] FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

async function hashIfExists(relPath) {
  const absolute = path.resolve(PROJECT_ROOT, relPath);
  if (!(await fileExists(absolute))) return '';
  return await sha256File(absolute);
}

async function hashFileMap(map) {
  const output = {};
  for (const [key, relPath] of Object.entries(map)) output[key] = await hashIfExists(relPath);
  return output;
}

function assertEvidencePathAllowed(inputPath) {
  const resolved = resolveProjectPath(inputPath, { label: 'storage evidence file' });
  const rel = safeRel(resolved);
  const normalized = rel.toLowerCase();
  const ext = path.extname(normalized);
  if (!isInsideProjectRoot(resolved)) throw new Error('storage evidence file resolves outside project root');
  if (!['.json', '.md', '.txt'].includes(ext)) throw new Error('storage evidence file must be .json, .md, or .txt');
  if (/(^|\/)\.env(\.|$)|(^|\/)supabase\/\.env(\.|$)/i.test(normalized)) throw new Error('storage evidence file must not be .env or supabase/.env');
  if (/(^|\.)env(\.|$)/i.test(path.basename(normalized))) throw new Error('storage evidence file must not be env-like');
  return { resolved, rel };
}

async function loadEvidence() {
  const evidenceItems = [];
  const evidenceFile = argText('evidence-file');
  const inlineEvidence = argText('evidence');
  let evidenceFileHash = '';
  let evidenceFilePath = '';
  if (inlineEvidence) evidenceItems.push(inlineEvidence);
  if (evidenceFile) {
    const allowed = assertEvidencePathAllowed(evidenceFile);
    evidenceFilePath = allowed.rel;
    const content = await readText(allowed.resolved, '');
    if (!content.trim()) throw new Error('storage evidence file is empty');
    evidenceFileHash = sha256Text(content);
    evidenceItems.push(`Storage evidence file reviewed: ${allowed.rel}`);
    evidenceItems.push(content.slice(0, 2000));
  }
  return { evidenceItems, evidenceFileHash, evidenceFilePath };
}

function buildStructuredChecks() {
  return REQUIRED_CHECKS.map(([id, label, flag]) => ({
    id,
    label,
    status: hasFlag(flag) ? 'PASS' : 'PENDING',
    evidence: hasFlag(flag) ? `Confirmed by --${flag}` : `Missing --${flag}`
  }));
}

function buildVerifiedBuckets(checks, buckets) {
  const pass = checks.every((check) => check.status === 'PASS');
  return buckets.map((bucket) => ({
    bucket,
    expectedPublic: true,
    bucketReviewed: hasFlag('confirm-buckets-reviewed'),
    publicReadVerified: hasFlag('confirm-public-read-scoped'),
    uploadPolicyVerified: hasFlag('confirm-editor-upload-scoped') && hasFlag('confirm-anon-upload-blocked'),
    deletePolicyVerified: hasFlag('confirm-admin-delete-scoped') && hasFlag('confirm-anon-delete-blocked'),
    status: pass && REQUIRED_BUCKETS.includes(bucket) ? 'PASS' : pass ? 'REVIEWED' : 'PENDING'
  }));
}

function buildVerifiedPolicies() {
  const mode = argText('verification-mode') || 'UNSPECIFIED';
  const flagByScope = {
    CMS_MEDIA_PUBLIC_READ: 'confirm-public-read-scoped',
    CMS_PUBLIC_PUBLISHED_READ: 'confirm-public-read-scoped',
    ANON_UPLOAD_BLOCKED: 'confirm-anon-upload-blocked',
    ANON_DELETE_BLOCKED: 'confirm-anon-delete-blocked',
    EDITOR_UPLOAD_SCOPED: 'confirm-editor-upload-scoped',
    ADMIN_DELETE_SCOPED: 'confirm-admin-delete-scoped',
    SERVICE_ROLE_NOT_EXPOSED_TO_FRONTEND: 'confirm-service-role-not-exposed'
  };
  return REQUIRED_POLICY_SCOPES.map((policyScope) => ({
    policyScope,
    status: hasFlag(flagByScope[policyScope]) ? 'PASS' : 'PENDING',
    verificationMode: mode
  }));
}

function validatePassRequest({ version, operator, projectRef, verificationMode, evidenceItems, secretFindings, checks, checkSummary, buckets, verifiedPolicies }) {
  const errors = [];
  if (!version) errors.push('missing version');
  if (!operator) errors.push('missing operator');
  if (!projectRef) errors.push('missing projectRef');
  if (!verificationMode) errors.push('missing verificationMode');
  if (verificationMode && !ALLOWED_MODES.has(verificationMode)) errors.push(`invalid verificationMode: ${verificationMode}`);
  if (verificationMode === 'static-source-review') errors.push('static-source-review cannot produce PASS; use read-only-sql or manual-dashboard evidence');
  if (verificationMode && !ALLOWED_PASS_MODES.has(verificationMode)) errors.push('verificationMode must be read-only-sql or manual-dashboard for PASS');
  if (!evidenceItems.length) errors.push('missing evidence or evidence-file');
  if (evidenceItems.join('\n').trim().length < 25) errors.push('evidence is too short for PASS');
  for (const flag of REQUIRED_CONFIRM_FLAGS) {
    if (!hasFlag(flag)) errors.push(`missing --${flag}`);
  }
  for (const bucket of REQUIRED_BUCKETS) {
    if (!buckets.includes(bucket)) errors.push(`missing required bucket evidence: ${bucket}`);
  }
  for (const policyScope of REQUIRED_POLICY_SCOPES) {
    if (!verifiedPolicies.some((policy) => policy.policyScope === policyScope && policy.status === 'PASS')) errors.push(`missing required storage policy scope: ${policyScope}`);
  }
  if (secretFindings.length) errors.push('Secret-like storage evidence detected and blocked.');
  if (checkSummary.fail > 0 || checkSummary.pending > 0) errors.push('all structuredChecks must be PASS');
  if (checks.some((check) => check.status !== 'PASS')) errors.push('structuredChecks contain non-PASS status');
  return errors;
}

let evidenceItems = [];
let evidenceFileHash = '';
let evidenceFilePath = '';
try {
  const loaded = await loadEvidence();
  evidenceItems = loaded.evidenceItems;
  evidenceFileHash = loaded.evidenceFileHash;
  evidenceFilePath = loaded.evidenceFilePath;
} catch (error) {
  if (requestedStatus === 'PASS') failControlled([error.message]);
  evidenceItems = [];
}

const version = argText('version');
const operator = argText('operator') || 'UNSPECIFIED';
const projectRef = argText('project-ref') || 'UNSPECIFIED';
const verificationMode = argText('verification-mode') || 'UNSPECIFIED';
const buckets = requestedBuckets();
const structuredChecks = buildStructuredChecks();
const checkSummary = summarizeChecks(structuredChecks);
const verifiedBuckets = buildVerifiedBuckets(structuredChecks, buckets);
const verifiedPolicies = buildVerifiedPolicies();
const evidenceText = evidenceItems.join('\n');
const evidenceHash = evidenceText ? sha256Text(evidenceText) : '';
const secretFindings = secretFindingsForText(evidenceText);
const sourceHashes = await getCurrentSourceHashes();
const securitySourceHashes = await hashFileMap(SECURITY_HASH_FILES);
const storageSourceHashes = await hashFileMap(STORAGE_HASH_FILES);
const passErrors = requestedStatus === 'PASS'
  ? validatePassRequest({
      version,
      operator: operator === 'UNSPECIFIED' ? '' : operator,
      projectRef: projectRef === 'UNSPECIFIED' ? '' : projectRef,
      verificationMode,
      evidenceItems,
      secretFindings,
      checks: structuredChecks,
      checkSummary,
      buckets,
      verifiedPolicies
    })
  : [];

if (passErrors.length) failControlled(passErrors);

const status = requestedStatus === 'PASS' ? 'PASS' : requestedStatus;
const publishGateEligible = status === 'PASS' && checkSummary.fail === 0 && checkSummary.pending === 0 && secretFindings.length === 0;
const checksAlias = structuredChecks.map((check) => JSON.parse(JSON.stringify(check)));
const artifact = {
  artifactId: id,
  id,
  type: 'STORAGE_VERIFICATION',
  status,
  version: version || 'UNSPECIFIED',
  createdAt,
  operator,
  projectRef,
  verificationMode,
  evidence: evidenceItems.length ? evidenceItems : ['Storage evidence not sufficient for PASS.'],
  evidenceHash,
  evidenceFileHash,
  evidenceFilePath,
  publishGateEligible,
  noProductionWritePerformed: hasFlag('confirm-no-production-write'),
  noSecretsIncluded: secretFindings.length === 0 && hasFlag('confirm-no-secret-output'),
  noStorageWritePerformed: hasFlag('confirm-no-storage-upload'),
  noStorageDeletePerformed: hasFlag('confirm-no-storage-delete'),
  confirmedNoProductionWrite: hasFlag('confirm-no-production-write'),
  confirmedNoSecretOutput: hasFlag('confirm-no-secret-output'),
  confirmedNoStorageUpload: hasFlag('confirm-no-storage-upload'),
  confirmedNoStorageDelete: hasFlag('confirm-no-storage-delete'),
  sourceHashes,
  securitySourceHashes,
  storageSourceHashes,
  verifiedBuckets,
  verifiedPolicies,
  structuredChecks,
  checks: checksAlias,
  checkSummary,
  secretScan: {
    passed: secretFindings.length === 0,
    findings: secretFindings.map((finding) => ({ id: finding.id, status: finding.status, message: finding.message }))
  },
  notes: [
    'This generator does not connect to Supabase Storage and performs no upload/delete.',
    'STORAGE_VERIFICATION PASS requires read-only SQL or manual dashboard evidence, projectRef, confirm flags, and secret-safe evidence.',
    'static-source-review is allowed only for PENDING/FAIL evidence collection, never PASS.'
  ]
};

if (!Array.isArray(artifact.structuredChecks)) failControlled(['structuredChecks must be an array in the Storage artifact schema']);
if (artifact.status === 'PASS' && artifact.structuredChecks.length === 0) failControlled(['structuredChecks must be non-empty when Storage status is PASS']);
if (!Array.isArray(artifact.checks) || artifact.checks.length !== artifact.structuredChecks.length) failControlled(['checks alias must match structuredChecks for Storage artifact compatibility']);

const markdown = `# Storage Verification Artifact\n\n- Artifact ID: \`${artifact.artifactId}\`\n- Version: \`${artifact.version}\`\n- Status: \`${artifact.status}\`\n- Project ref: \`${artifact.projectRef}\`\n- Verification mode: \`${artifact.verificationMode}\`\n- Operator: ${artifact.operator}\n- Created at: ${artifact.createdAt}\n- Publish gate eligible: ${artifact.publishGateEligible ? 'YES' : 'NO'}\n- Evidence hash: \`${artifact.evidenceHash || 'MISSING'}\`\n- No production write performed: ${artifact.noProductionWritePerformed ? 'YES' : 'NO'}\n- No Storage upload performed: ${artifact.noStorageWritePerformed ? 'YES' : 'NO'}\n- No Storage delete performed: ${artifact.noStorageDeletePerformed ? 'YES' : 'NO'}\n- No secrets included: ${artifact.noSecretsIncluded ? 'YES' : 'NO'}\n\n## Structured checks\n${artifact.structuredChecks.map((check) => `- [${check.status === 'PASS' ? 'x' : ' '}] ${check.id} — ${check.status}`).join('\n')}\n\n## Verified buckets\n${artifact.verifiedBuckets.map((item) => `- ${item.bucket}: ${item.status}`).join('\n')}\n\n## Verified policies\n${artifact.verifiedPolicies.map((item) => `- ${item.policyScope}: ${item.status}`).join('\n')}\n\n## Evidence\n${artifact.evidence.map((item) => `- ${String(item).replace(/\n/g, ' ').slice(0, 500)}`).join('\n')}\n\n## Safety\n- No Supabase migration, SQL write, publish, seed, Storage upload, or Storage delete is performed by this generator.\n- Service role keys, JWT secrets, private keys, and bearer tokens are blocked from evidence.\n- RLS verification remains a separate gate.\n`;

const result = await writeArtifactPair({ outDir: args.out || 'reports', artifact, title: 'Storage Verification Artifact', markdown });
console.log(`[artifact] created ${result.jsonPath}`);
console.log(`[artifact] created ${result.mdPath}`);
if (!publishGateEligible) console.log('[artifact] PENDING/NOT_ELIGIBLE: Storage artifact is not publish-gate eligible.');
