#!/usr/bin/env node
import { fileExists, getCurrentSourceHashes, isNonEmptyString, makeArtifactId, parseArgs, resolveProjectPath, validateArtifactTextValue, valueKind, writeArtifactPair } from './artifact_utils.mjs';

const args = parseArgs();
const id = makeArtifactId('publish_gate_manifest');
const version = String(args.version || 'V6.11.21-B6-F_H_B');
const operator = typeof args.operator === 'string' && args.operator.trim() ? args.operator.trim() : 'UNSPECIFIED';
const createdAt = new Date().toISOString();

const SPECS = [
  ['BACKUP', 'backup-id', 'backup-manifest'],
  ['ROLLBACK_DRY_RUN', 'rollback-id', 'rollback-report'],
  ['DIFF_REVIEW', 'diff-id', 'diff-artifact'],
  ['SMOKE_REPORT', 'smoke-id', 'smoke-artifact'],
  ['CLEAN_RELEASE', 'clean-release-id', 'clean-release-artifact'],
  ['RLS_VERIFICATION', 'rls-id', 'rls-artifact'],
  ['STORAGE_VERIFICATION', 'storage-id', 'storage-artifact'],
  ['MEDIA_READINESS', 'media-id', 'media-artifact'],
  ['PUBLISH_SOURCE_READINESS', 'source-id', 'source-artifact']
];

function makeInvalid(type, field, raw, validation) {
  const kind = valueKind(raw);
  const code = field === 'id' ? 'INVALID_ARTIFACT_ID' : 'INVALID_ARTIFACT_PATH';
  return {
    type,
    field,
    code,
    rawType: kind,
    message: validation?.message || `${type} ${field} must be a non-empty string, got ${kind}.`
  };
}

const artifacts = {};
const missingArtifacts = [];
const invalidArtifacts = [];
const pathFindings = [];

for (const [type, idKey, pathKey] of SPECS) {
  const rawId = args[idKey];
  const rawPath = args[pathKey];
  const idValidation = validateArtifactTextValue(rawId, { label: `${type} id`, allowMissing: true });
  const pathValidation = validateArtifactTextValue(rawPath, { label: `${type} path`, allowMissing: true });
  if (!idValidation.ok) invalidArtifacts.push(makeInvalid(type, 'id', rawId, idValidation));
  if (!pathValidation.ok) invalidArtifacts.push(makeInvalid(type, 'path', rawPath, pathValidation));
  const entry = {
    id: idValidation.ok && !idValidation.missing ? idValidation.value : '',
    path: pathValidation.ok && !pathValidation.missing ? pathValidation.value : ''
  };
  if (!entry.id || !entry.path) missingArtifacts.push(type);
  if (entry.path) {
    try {
      const resolved = resolveProjectPath(entry.path, { label: `${type} artifact path` });
      const exists = await fileExists(resolved);
      pathFindings.push({ type, path: entry.path, exists, status: exists ? 'PATH_EXISTS' : 'PATH_MISSING' });
    } catch (error) {
      invalidArtifacts.push({ type, field: 'path', code: 'INVALID_ARTIFACT_PATH', rawType: typeof entry.path, message: error.message });
    }
  }
  artifacts[type] = entry;
}

if (invalidArtifacts.length) {
  console.error('[manifest] FAIL');
  for (const item of invalidArtifacts) {
    console.error(`[manifest] ${item.code}: ${item.message}`);
  }
  process.exit(1);
}

const hasMissingFile = pathFindings.some((item) => item.status === 'PATH_MISSING');
const status = missingArtifacts.length || hasMissingFile || operator === 'UNSPECIFIED' ? 'PENDING' : 'PASS';
const evidence = isNonEmptyString(args.evidence) ? [String(args.evidence).trim()] : [];
const artifact = {
  artifactId: id,
  id,
  type: 'PUBLISH_GATE_MANIFEST',
  version,
  status,
  publishGateEligible: false,
  createdAt,
  operator,
  sourceHashes: await getCurrentSourceHashes(),
  requiredArtifacts: SPECS.map(([type]) => type),
  artifacts,
  missingArtifacts,
  invalidArtifacts,
  pathFindings,
  evidence,
  notes: [
    'This manifest only groups artifact IDs and paths.',
    'It does not grant publish permission.',
    'Validator must still check every artifact file, status, hash, evidence, freshness, and source hash.'
  ],
  noSecretsIncluded: true,
  noProductionWritePerformed: true
};

const markdown = `# Publish Gate Manifest\n\n- Manifest ID: \`${id}\`\n- Version: \`${version}\`\n- Operator: ${operator}\n- Status: \`${status}\`\n- Publish gate eligible: NO\n- Missing artifacts: ${missingArtifacts.length ? missingArtifacts.join(', ') : 'none'}\n- Artifact path findings: ${pathFindings.filter((item) => item.status === 'PATH_MISSING').length} missing file(s)\n\n## Artifact paths\n${Object.entries(artifacts).map(([type, entry]) => `- ${type}: id=\`${entry.id || 'MISSING'}\`, path=\`${entry.path || 'MISSING'}\``).join('\n')}\n\n## Path findings\n${pathFindings.length ? pathFindings.map((item) => `- ${item.type}: ${item.status} · \`${item.path}\``).join('\n') : '- No artifact path was supplied.'}\n\n## Safety\n- Boolean/number/object artifact IDs and paths are rejected before manifest creation.\n- Missing artifact files keep this manifest at PENDING.\n- The manifest does not replace \`artifact:validate\`.\n`;
const result = await writeArtifactPair({ outDir: args.out || 'reports', artifact, title: 'Publish Gate Manifest', markdown });
console.log(`[manifest] created ${result.jsonPath}`);
console.log(`[manifest] created ${result.mdPath}`);
if (missingArtifacts.length) console.log(`[manifest] PENDING: missing artifacts: ${missingArtifacts.join(', ')}`);
if (hasMissingFile) console.log('[manifest] PENDING: one or more artifact paths do not exist.');
