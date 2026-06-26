#!/usr/bin/env node
import {
  getCurrentSourceHashes,
  makeArtifactId,
  normalizeStatus,
  parseArgs,
  writeArtifactPair
} from './artifact_utils.mjs';

const args = parseArgs();
const status = normalizeStatus(args.status, 'PENDING');
const operator = String(args.operator || '').trim();
const evidenceArg = String(args.evidence || '').trim();
const room = String(args.room || 'all').toLowerCase();
const version = String(args.version || 'V6.11.21-B6-F_F_B');
const id = makeArtifactId('smoke_report');
const createdAt = new Date().toISOString();

if (status === 'PASS' && (!operator || !evidenceArg)) {
  console.error('[smoke-artifact] PASS requires --operator and --evidence.');
  process.exit(1);
}
const checks = {
  publicIndoorLoads: status === 'PASS',
  publicOutdoorLoads: status === 'PASS',
  previewIndoorLoads: status === 'PASS',
  previewOutdoorLoads: status === 'PASS',
  noPreviewBannerInPublic: status === 'PASS',
  popupArtworkWorks: status === 'PASS',
  videoDoesNotCrash: status === 'PASS',
  mediaSamplesLoad: status === 'PASS',
  consoleNoP0: status === 'PASS',
  mobileBasicNoCrash: status === 'PASS'
};
const allChecksPass = Object.values(checks).every(Boolean);
const decision = {
  smokePassed: status === 'PASS' && allChecksPass,
  approvedForPublishGate: status === 'PASS' && allChecksPass,
  notes: evidenceArg || 'PENDING: operator has not attached smoke evidence.'
};
const artifact = {
  artifactId: id,
  id,
  type: 'SMOKE_REPORT',
  version,
  room,
  status,
  publishGateEligible: status === 'PASS' && allChecksPass && Boolean(operator) && Boolean(evidenceArg),
  createdAt,
  operator: operator || 'UNSPECIFIED',
  sourceHashes: await getCurrentSourceHashes(),
  checks,
  decision,
  evidence: evidenceArg ? [evidenceArg] : [],
  noSecretsIncluded: true,
  noProductionWritePerformed: true
};
const markdown = `# Smoke Report Artifact\n\n- Artifact ID: \`${id}\`\n- Status: \`${status}\`\n- Version: \`${version}\`\n- Room: \`${room}\`\n- Operator: ${artifact.operator}\n- Publish gate eligible: ${artifact.publishGateEligible ? 'YES' : 'NO'}\n\n## Checks\n${Object.entries(checks).map(([key, value]) => `- [${value ? 'x' : ' '}] ${key}`).join('\n')}\n\n## Decision\n- Smoke passed: ${decision.smokePassed ? 'YES' : 'NO'}\n- Approved for publish gate: ${decision.approvedForPublishGate ? 'YES' : 'NO'}\n- Notes: ${decision.notes}\n\n## Safety\n- Manual smoke evidence only; this generator does not open a browser or publish.\n- No Supabase or Storage write was performed.\n`;
const result = await writeArtifactPair({ outDir: args.out || 'reports', artifact, title: 'Smoke Report Artifact', markdown });
console.log(`[artifact] created ${result.jsonPath}`);
console.log(`[artifact] created ${result.mdPath}`);
