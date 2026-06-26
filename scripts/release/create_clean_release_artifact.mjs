#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PROJECT_ROOT,
  fileExists,
  getCurrentSourceHashes,
  isInsideProjectRoot,
  isNonEmptyString,
  makeArtifactId,
  normalizeStatus,
  parseArgs,
  readJson,
  resolveProjectPath,
  safeRel,
  sha256File,
  sha256Text,
  stableJsonStringify,
  writeArtifactPair
} from './artifact_utils.mjs';

const args = parseArgs();
const requestedStatus = normalizeStatus(args.status);
const operator = isNonEmptyString(args.operator) ? String(args.operator).trim() : 'UNSPECIFIED';
const version = isNonEmptyString(args.version) ? String(args.version).trim() : '';
const evidenceText = isNonEmptyString(args.evidence) ? String(args.evidence).trim() : '';
const releaseTarget = args.target || args._[0] || '.';
const sourceOnly = args['source-only'] !== false;
const requireCleanBaseline = Boolean(args['require-clean-baseline']);
const id = makeArtifactId('clean_release');
const createdAt = new Date().toISOString();

const REQUIRED_FILES = [
  'index.html',
  'gallery.html',
  'editor.html',
  'cms-admin.html',
  'package.json',
  'package-lock.json',
  'data/scene.json',
  'data/scene_outdoor.json',
  'data/cms_content_fallback.json',
  'data/asset_manifest.json',
  'cms_public_content.generated.json',
  'supabase/cms_public_content.generated.json'
];

const REQUIRED_DIRS = [
  'src',
  'styles',
  'scripts/release'
];

const EXCLUDED_POLICY = {
  env: true,
  supabaseEnv: true,
  nodeModules: true,
  supabaseNodeModules: true,
  git: true,
  reports: true,
  backups: true,
  assets: true,
  distBuild: true,
  archives: true,
  logs: true,
  cache: true,
  temp: true
};

const FORBIDDEN_EXT_RE = /\.(zip|tar|tar\.gz|tgz|7z|rar|log|tmp|temp|bak|backup|old|orig|swp)$/i;
const BINARY_MEDIA_EXT_RE = /\.(glb|gltf|bin|mp4|mov|webm|mp3|wav|jpg|jpeg|png|webp|gif|hdr|ico)$/i;
const FORBIDDEN_DIRS = new Set([
  'node_modules',
  '.git',
  'reports',
  'backups',
  'dist',
  'build',
  '.cache',
  '.vite',
  'coverage',
  '__pycache__'
]);

function normalizeRel(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function isEnvLike(relative) {
  const rel = normalizeRel(relative);
  return rel === '.env' || rel.startsWith('.env.') || rel === 'supabase/.env' || rel.startsWith('supabase/.env.');
}

function isForbiddenPath(relative, entry = null) {
  const rel = normalizeRel(relative);
  if (!rel || rel === '.') return { blocked: false, code: '', reason: '' };
  const parts = rel.split('/');
  if (isEnvLike(rel)) return { blocked: true, code: 'ENV_FILE', reason: 'secret/env file' };
  if (parts.includes('node_modules')) return { blocked: true, code: 'NODE_MODULES', reason: 'dependency directory' };
  if (rel.startsWith('supabase/node_modules/') || rel === 'supabase/node_modules') return { blocked: true, code: 'SUPABASE_NODE_MODULES', reason: 'supabase dependency directory' };
  if (parts.includes('.git')) return { blocked: true, code: 'GIT_DIR', reason: 'Git metadata directory' };
  if (parts.includes('reports')) return { blocked: true, code: 'REPORTS_DIR', reason: 'generated reports are excluded from clean release' };
  if (parts.includes('backups')) return { blocked: true, code: 'BACKUPS_DIR', reason: 'backup artifacts are excluded from clean release' };
  if (sourceOnly && parts[0] === 'assets') return { blocked: true, code: 'ASSETS_DIR', reason: 'source-only clean release excludes assets; storage verification owns assets' };
  if (parts.some((part) => FORBIDDEN_DIRS.has(part))) return { blocked: true, code: 'GENERATED_OR_CACHE_DIR', reason: 'generated/cache directory' };
  if (entry?.isDirectory?.()) return { blocked: false, code: '', reason: '' };
  if (FORBIDDEN_EXT_RE.test(rel)) return { blocked: true, code: 'FORBIDDEN_EXTENSION', reason: 'archive/log/temp/backup extension' };
  if (sourceOnly && BINARY_MEDIA_EXT_RE.test(rel)) return { blocked: true, code: 'BINARY_MEDIA', reason: 'source-only clean release excludes binary media' };
  return { blocked: false, code: '', reason: '' };
}

async function statOrNull(filePath) {
  try { return await fs.stat(filePath); } catch (_) { return null; }
}

async function walkFiles(rootDir, dir = rootDir, output = [], forbiddenFindings = []) {
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (_) { return { output, forbiddenFindings }; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const relative = normalizeRel(path.relative(rootDir, full));
    const decision = isForbiddenPath(relative, entry);
    if (decision.blocked) {
      forbiddenFindings.push({ path: relative, code: decision.code, reason: decision.reason });
      continue;
    }
    if (entry.isDirectory()) {
      await walkFiles(rootDir, full, output, forbiddenFindings);
      continue;
    }
    output.push(relative);
  }
  return { output, forbiddenFindings };
}

async function hashExistingProjectFile(relative) {
  const absolute = path.resolve(PROJECT_ROOT, relative);
  return await fileExists(absolute) ? await sha256File(absolute) : '';
}

async function collectRequiredFileFindings(targetPath) {
  const missingRequiredFiles = [];
  const requiredFileHashes = {};
  for (const relative of REQUIRED_FILES) {
    const absolute = path.join(targetPath, relative);
    if (!(await fileExists(absolute))) {
      missingRequiredFiles.push(relative);
      continue;
    }
    requiredFileHashes[relative] = await sha256File(absolute);
  }
  const missingRequiredDirs = [];
  const emptyRequiredDirs = [];
  for (const relative of REQUIRED_DIRS) {
    const absolute = path.join(targetPath, relative);
    const stat = await statOrNull(absolute);
    if (!stat || !stat.isDirectory()) {
      missingRequiredDirs.push(relative);
      continue;
    }
    const entries = await fs.readdir(absolute).catch(() => []);
    if (!entries.length) emptyRequiredDirs.push(relative);
  }
  return { missingRequiredFiles, missingRequiredDirs, emptyRequiredDirs, requiredFileHashes };
}

async function getCleanBaselineCounts() {
  const sceneIndoor = await readJson(path.resolve(PROJECT_ROOT, 'data/scene.json'), []);
  const sceneOutdoor = await readJson(path.resolve(PROJECT_ROOT, 'data/scene_outdoor.json'), []);
  const cms = await readJson(path.resolve(PROJECT_ROOT, 'data/cms_content_fallback.json'), {});
  const rootGenerated = await readJson(path.resolve(PROJECT_ROOT, 'cms_public_content.generated.json'), {});
  const supabaseGenerated = await readJson(path.resolve(PROJECT_ROOT, 'supabase/cms_public_content.generated.json'), {});
  return {
    sceneIndoorItems: Array.isArray(sceneIndoor) ? sceneIndoor.length : -1,
    sceneOutdoorItems: Array.isArray(sceneOutdoor) ? sceneOutdoor.length : -1,
    cmsFallbackIndoorItems: Array.isArray(cms?.rooms?.indoor?.artworks) ? cms.rooms.indoor.artworks.length : 0,
    cmsFallbackOutdoorItems: Array.isArray(cms?.rooms?.outdoor?.artworks) ? cms.rooms.outdoor.artworks.length : 0,
    rootGeneratedIndoorItems: Array.isArray(rootGenerated?.rooms?.indoor?.artworks) ? rootGenerated.rooms.indoor.artworks.length : 0,
    rootGeneratedOutdoorItems: Array.isArray(rootGenerated?.rooms?.outdoor?.artworks) ? rootGenerated.rooms.outdoor.artworks.length : 0,
    supabaseGeneratedIndoorItems: Array.isArray(supabaseGenerated?.rooms?.indoor?.artworks) ? supabaseGenerated.rooms.indoor.artworks.length : 0,
    supabaseGeneratedOutdoorItems: Array.isArray(supabaseGenerated?.rooms?.outdoor?.artworks) ? supabaseGenerated.rooms.outdoor.artworks.length : 0
  };
}

function cleanBaselineHasDynamicItems(counts) {
  return Object.values(counts).some((value) => Number(value) !== 0);
}

let targetPath = '';
const errors = [];
const warnings = [];

try {
  targetPath = resolveProjectPath(releaseTarget, { label: 'clean release target' });
} catch (error) {
  errors.push(error.message);
}

if (!targetPath || !isInsideProjectRoot(targetPath, PROJECT_ROOT)) errors.push('clean release target must be inside project root');

const targetStat = targetPath ? await statOrNull(targetPath) : null;
if (!targetStat) errors.push(`clean release target not found: ${releaseTarget}`);
else if (!targetStat.isDirectory()) errors.push(`clean release target must be a directory: ${releaseTarget}`);

if (requestedStatus === 'PASS') {
  if (operator === 'UNSPECIFIED') errors.push('operator is required when --status PASS');
  if (!version) errors.push('version is required when --status PASS');
  if (!evidenceText) errors.push('evidence is required when --status PASS');
}

let includedFiles = [];
let forbiddenFindings = [];
let requiredCheck = { missingRequiredFiles: [], missingRequiredDirs: [], emptyRequiredDirs: [], requiredFileHashes: {} };
if (targetStat?.isDirectory()) {
  const walked = await walkFiles(targetPath);
  includedFiles = [...new Set(walked.output.map(normalizeRel))].sort((a, b) => a.localeCompare(b));
  forbiddenFindings = walked.forbiddenFindings.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
  requiredCheck = await collectRequiredFileFindings(targetPath);
}

if (forbiddenFindings.length) errors.push(`forbidden paths found in clean release target: ${forbiddenFindings.length}`);
if (requiredCheck.missingRequiredFiles.length) errors.push(`missing required files: ${requiredCheck.missingRequiredFiles.join(', ')}`);
if (requiredCheck.missingRequiredDirs.length) errors.push(`missing required directories: ${requiredCheck.missingRequiredDirs.join(', ')}`);
if (requiredCheck.emptyRequiredDirs.length) warnings.push(`required directories are empty: ${requiredCheck.emptyRequiredDirs.join(', ')}`);

const cleanBaselineCounts = await getCleanBaselineCounts();
if (requireCleanBaseline && cleanBaselineHasDynamicItems(cleanBaselineCounts)) {
  errors.push('clean baseline is required but scene/CMS/generated dynamic counts are not zero');
}

if (requestedStatus === 'PASS' && errors.length) {
  console.error('[artifact:clean-release] FAIL');
  for (const error of errors) console.error(`- ${error}`);
  for (const warning of warnings) console.warn(`- WARN: ${warning}`);
  process.exit(1);
}

const sourceHashes = await getCurrentSourceHashes();
const extendedSourceHashes = {
  ...sourceHashes,
  rootGeneratedBundleHash: await hashExistingProjectFile('cms_public_content.generated.json'),
  assetManifestHash: await hashExistingProjectFile('data/asset_manifest.json'),
  packageJsonHash: await hashExistingProjectFile('package.json'),
  packageLockHash: await hashExistingProjectFile('package-lock.json')
};

const includedFileContentEntries = [];
for (const relative of includedFiles) {
  const absolute = path.join(targetPath || PROJECT_ROOT, relative);
  if (await fileExists(absolute)) includedFileContentEntries.push({ path: relative, sha256: await sha256File(absolute) });
}

const cleanReleaseHashes = {
  fileListHash: sha256Text(stableJsonStringify(includedFiles)),
  requiredFilesHash: sha256Text(stableJsonStringify(requiredCheck.requiredFileHashes)),
  targetContentHash: sha256Text(stableJsonStringify(includedFileContentEntries))
};

const hasForbiddenCode = (code) => forbiddenFindings.some((item) => item.code === code || item.path.split('/').includes(code));
const hasForbiddenPathPrefix = (prefix) => forbiddenFindings.some((item) => item.path === prefix || item.path.startsWith(`${prefix}/`));
const finalStatus = requestedStatus === 'PASS' && !errors.length ? 'PASS' : requestedStatus === 'FAIL' || errors.length ? 'FAIL' : requestedStatus;

const artifact = {
  artifactId: id,
  id,
  type: 'CLEAN_RELEASE',
  status: finalStatus,
  operator,
  version: version || 'UNSPECIFIED',
  evidence: evidenceText ? [evidenceText] : [],
  createdAt,
  releaseTarget: targetPath ? safeRel(targetPath, PROJECT_ROOT) || '.' : String(releaseTarget || ''),
  sourceOnly,
  requireCleanBaseline,
  publishGateEligible: finalStatus === 'PASS' && errors.length === 0,
  noProductionWritePerformed: true,
  noSecretsIncluded: !forbiddenFindings.some((item) => item.code === 'ENV_FILE'),
  noNodeModulesIncluded: !forbiddenFindings.some((item) => item.code === 'NODE_MODULES' || item.code === 'SUPABASE_NODE_MODULES'),
  noGitIncluded: !forbiddenFindings.some((item) => item.code === 'GIT_DIR'),
  noReportsIncluded: !hasForbiddenPathPrefix('reports'),
  noBackupsIncluded: !hasForbiddenPathPrefix('backups'),
  noAssetsIncluded: !hasForbiddenPathPrefix('assets'),
  sourceHashes,
  extendedSourceHashes,
  cleanReleaseHashes,
  requiredFiles: REQUIRED_FILES,
  requiredDirs: REQUIRED_DIRS,
  includedFiles,
  includedFilesCount: includedFiles.length,
  requiredFileHashes: requiredCheck.requiredFileHashes,
  forbiddenPathFindings: forbiddenFindings,
  excludedPolicy: EXCLUDED_POLICY,
  cleanBaselineCounts,
  missingRequiredFiles: requiredCheck.missingRequiredFiles,
  missingRequiredDirs: requiredCheck.missingRequiredDirs,
  emptyRequiredDirs: requiredCheck.emptyRequiredDirs,
  errors,
  warnings,
  decision: {
    approvedForPublishGate: finalStatus === 'PASS' && errors.length === 0,
    sourceOnlyConfirmed: sourceOnly === true,
    storageVerificationOwnsAssets: sourceOnly === true,
    noCleanReleasePackageCreated: true,
    noProductionWritePerformed: true
  }
};

const markdown = `# Clean Release Verification Artifact\n\n- Artifact ID: \`${artifact.artifactId}\`\n- Type: \`${artifact.type}\`\n- Status: \`${artifact.status}\`\n- Version: \`${artifact.version}\`\n- Operator: \`${artifact.operator}\`\n- Release target: \`${artifact.releaseTarget}\`\n- Source-only: ${artifact.sourceOnly ? 'YES' : 'NO'}\n- Included files: ${artifact.includedFilesCount}\n- Publish gate eligible: ${artifact.publishGateEligible ? 'YES' : 'NO'}\n\n## Source-only policy\n\n- CLEAN_RELEASE is source-only.\n- \`assets/**\` is excluded here and must be covered by STORAGE_VERIFICATION.\n- \`reports/**\`, \`backups/**\`, \`.env*\`, \`node_modules/**\`, \`.git/**\`, archives, logs, temp/cache files are forbidden.\n\n## Errors\n${errors.length ? errors.map((item) => `- ${item}`).join('\n') : '- None.'}\n\n## Warnings\n${warnings.length ? warnings.map((item) => `- ${item}`).join('\n') : '- None.'}\n\n## Forbidden findings\n${forbiddenFindings.length ? forbiddenFindings.map((item) => `- \`${item.path}\` — ${item.code}: ${item.reason}`).join('\n') : '- No forbidden paths found.'}\n\n## Required files\n${REQUIRED_FILES.map((item) => `- \`${item}\`${requiredCheck.missingRequiredFiles.includes(item) ? ' — MISSING' : ' — OK'}`).join('\n')}\n\n## Hashes\n\n- fileListHash: \`${cleanReleaseHashes.fileListHash}\`\n- requiredFilesHash: \`${cleanReleaseHashes.requiredFilesHash}\`\n- targetContentHash: \`${cleanReleaseHashes.targetContentHash}\`\n\n## Evidence\n${artifact.evidence.length ? artifact.evidence.map((item) => `- ${item}`).join('\n') : '- No evidence supplied.'}\n\n## Safety\n\n- No clean release package was created by this script.\n- No production write was performed.\n- Do not use this artifact for publish unless status is PASS and publishGateEligible is true.\n`;

const result = await writeArtifactPair({ outDir: args.out || 'reports', artifact, title: 'Clean Release Verification Artifact', markdown });
console.log(`[artifact] created ${result.jsonPath}`);
console.log(`[artifact] created ${result.mdPath}`);
if (artifact.status === 'FAIL') process.exitCode = 1;
