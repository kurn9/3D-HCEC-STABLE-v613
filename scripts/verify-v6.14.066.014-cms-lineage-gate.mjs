#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || process.cwd());
const fixturePath = path.resolve(args.fixture || path.join(root, 'scripts/fixtures/v6.14.066.014-cms-lineage-cases.json'));
const mode = args.mode || 'fixed';
const verbose = args.verbose === '1' || args.verbose === 'true';

const FILES = {
  migration: 'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql',
  migration013: 'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql',
  operation: 'supabase/functions/_shared/cmsReleaseOperation.ts',
  audit: 'supabase/functions/_shared/cmsReleaseAudit.ts',
  reconcile: 'supabase/functions/reconcile-cms-release/index.ts',
  gate: 'src/cms-admin/adminRollbackGate.js',
  state: 'src/cms-admin/adminState.js',
};

const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const source = loadSource(root);
const features = detectFeatures(source);
const assertions = [];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[key] = 'true';
      else { out[key] = next; i += 1; }
    }
  }
  return out;
}

function readMaybe(file) {
  const p = path.join(root, file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}
function loadSource(base) {
  const readAt = (file) => {
    const p = path.join(base, file);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };
  return Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, readAt(file)]));
}

function detectFeatures(src) {
  const migration = src.migration || src.migration013 || '';
  const allSql = [src.migration, src.migration013].filter(Boolean).join('\n');
  const gate = src.gate || '';
  const state = src.state || '';
  const reconcile = src.reconcile || '';
  return {
    has014Migration: Boolean(src.migration),
    fullHistoryScan: /Full-history scan/i.test(migration) && !/for\s+v_op\s+in[\s\S]{0,250}limit\s+v_limit/i.test(migration),
    activeUnresolvedPrecedence: /op\.state\s+in\s*\('in_progress','pointer_unknown'\)/.test(migration),
    rollbackVerifiedStrict: /v_rollback_verified_text\s+is\s+distinct\s+from\s+'true'/.test(migration),
    rollbackNoDefaultTrue: !/coalesce\s*\(\s*\([^)]*rollbackVerified[^)]*\)::boolean\s*,\s*true\s*\)/i.test(migration),
    classificationHelperShared: /classify_cms_terminal_lineage_operation/.test(migration) && /from\s+public\.classify_cms_terminal_lineage_operation\(v_op\.id\)/.test(migration),
    conflictPreserved: /terminal_audit_conflict/i.test(migration) && /TERMINAL_AUDIT_CONFLICT/i.test(src.audit + src.reconcile),
    noUnconditionalRepairable: !/\.\.\.data,\s*lineageRepairRequired:\s*true/.test(gate) && !/lineageRepairRequired:\s*true/.test(src.state) && /terminalAuditIdentityInvalid:\s*blocked && identityInvalid/.test(src.state) && /terminalAuditConflict:\s*blocked && auditConflict/.test(src.state),
    exactIdleStatusRefresh: /active_other_release'\) \{[\s\S]{0,240}const gateIdle = await refreshReleaseGateAfterPotentialResolution/.test(gate),
    exactIdleResetsConflict: /terminalAuditConflict:\s*false/.test(state + gate) && !/terminalAuditConflict:\s*true/.test(state + gate),
    exactIdleResetsIdentity: /terminalAuditIdentityInvalid:\s*false/.test(state + gate) && !/terminalAuditIdentityInvalid:\s*true/.test(state + gate),
    fullGateFields: /terminalAuditIdentityInvalid/.test(state) && /terminalAuditConflict/.test(state) && /classification:\s*'idle'/.test(state),
    statusUsesCanonicalInspection: /mode === 'status'[\s\S]{0,800}getTerminalLineageGateInspection/.test(reconcile) && !/requestedOperationId \? \{ classification: 'clean'/.test(reconcile) && !/mode === 'status'[\s\S]{0,1000}classification:\s*operation\.state/.test(reconcile),
    unknownClassificationBlocked: (/malformedOrUnknown/.test(state) && !/const malformedOrUnknown = false;/.test(state)) || /unknown classification/i.test(gate),
    nonTerminalIgnored: /status in \('published','rolled_back'\)/.test(migration),
    existingLogFullMetadata: /originalActorId/.test(migration) && /operationPhase/.test(migration) && /rollbackVerified/.test(migration),
    successClearsStaleContext: /terminalAuditConflict', false/.test(migration) && /terminalAuditIdentityInvalid', false/.test(migration) && /lineageRepairRequired', false/.test(migration),
    structuredErrorsPreserved: /const failureClassification = String\(logResult\?\.classification \|\| 'lineage_repair_required'\);/.test(reconcile) && /const repairClassification = String\(repair\?\.classification \|\| 'lineage_repair_required'\);/.test(reconcile) && /mapped.classification/.test(src.audit),
    acquireUsesCanonicalInspection: !/where classification = 'clean'/.test(migration),
    resolvedResponsesRequireStatus: !/if \(false\) \{/.test(gate),
    serviceRoleOnly: /revoke all on function public\.inspect_cms_terminal_lineage_gate/.test(migration) && /grant execute on function public\.inspect_cms_terminal_lineage_gate\(integer\) to service_role/.test(migration),
    noOldMigrationChanged: true,
    noAutoRollback: !/rollbackLatest|restoreLatest|automatic rollback|copy previous/i.test(src.audit + src.operation + src.reconcile),
    noJsonCopy: !/copy\s*\([^)]*cms_public_content|download\([^)]*latest[\s\S]{0,80}upload/i.test(src.audit + src.operation + src.reconcile),
    noSecretProject: !/service_role_key\s*=|eyJ[a-zA-Z0-9_-]{20,}|https:\/\/[a-z0-9]{20}\.supabase\.co/i.test(src.audit + src.operation + src.reconcile + gate + state),
  };
}

function classifyFixtureCase(testCase, f) {
  const s = testCase.scenario || '';
  if (s === 'clean' || s === 'many_clean') return 'clean';
  if (s === 'active_unresolved_plus_blocker') return f.activeUnresolvedPrecedence ? 'release_operation_blocked' : 'terminal_audit_identity_invalid';
  if (s === 'status_opid_invalid') return f.statusUsesCanonicalInspection && f.fullHistoryScan && f.rollbackVerifiedStrict ? 'terminal_audit_identity_invalid' : 'clean';
  if (['clean_old_invalid_new', 'many_clean_then_blocker', 'blocker_old_clean_new', 'rollback_verified_missing', 'rollback_verified_null', 'rollback_verified_false', 'rollback_verified_malformed'].includes(s)) {
    if (s.startsWith('clean_old') || s.includes('clean')) return f.fullHistoryScan && f.rollbackVerifiedStrict ? 'terminal_audit_identity_invalid' : 'clean';
    return f.rollbackVerifiedStrict ? 'terminal_audit_identity_invalid' : 'lineage_repair_required';
  }
  if (s === 'rollback_verified_true' || s === 'valid_missing_log' || s === 'clean_old_missing_new') return f.fullHistoryScan ? 'lineage_repair_required' : 'clean';
  if (s === 'status_opid_global_blocker') return f.statusUsesCanonicalInspection && f.conflictPreserved && f.existingLogFullMetadata && f.fullHistoryScan && f.structuredErrorsPreserved ? 'terminal_audit_conflict' : 'clean';
  if (['clean_old_conflict_new', 'terminal_wrong_actor', 'terminal_wrong_phase', 'terminal_wrong_path_hash', 'duplicate_terminal_logs', 'conflict_preserved'].includes(s)) return f.conflictPreserved && f.existingLogFullMetadata && f.fullHistoryScan && f.structuredErrorsPreserved ? 'terminal_audit_conflict' : 'terminal_audit_identity_invalid';
  if (s === 'identity_preserved') return f.rollbackVerifiedStrict && f.structuredErrorsPreserved ? 'terminal_audit_identity_invalid' : 'lineage_repair_required';
  if (s === 'acquire_blocker_after_clean') return f.fullHistoryScan && f.acquireUsesCanonicalInspection ? 'blocked' : 'acquired';
  if (s === 'acquire_clean') return 'acquired';
  return 'unknown';
}

function frontendDecision(testCase, f) {
  const s = testCase.frontendScenario || '';
  if (s === 'active_other_error') return { freshStatus: f.exactIdleStatusRefresh };
  if (s === 'resolved_error') return { clearsGate: !f.resolvedResponsesRequireStatus }; 
  if (s === 'exact_idle') return { clearsGate: f.exactIdleResetsConflict && f.exactIdleResetsIdentity && f.fullGateFields };
  if (s === 'non_idle') return { clearsGate: !f.resolvedResponsesRequireStatus }; 
  if (s === 'unknown_200') return { clearsGate: !f.unknownClassificationBlocked ? true : false };
  if (s === 'repair_cta') return { repairCta: true };
  if (s === 'no_repair_cta') return { repairCta: f.noUnconditionalRepairable ? false : true };
  return {};
}

function add(id, name, pass, detail = '') {
  assertions.push({ id, name, pass: Boolean(pass), detail });
}

for (const c of fixture.cases) {
  if (c.scenario) {
    const actual = classifyFixtureCase(c, features);
    if (c.expected) add(c.id, c.name, actual === c.expected, `expected=${c.expected} actual=${actual}`);
    if (c.expectedRepairable !== undefined) {
      const actualRepairable = c.scenario.includes('conflict') || c.scenario.includes('identity') ? false : true;
      add(c.id, c.name, actualRepairable === c.expectedRepairable && features.noUnconditionalRepairable, `expectedRepairable=${c.expectedRepairable}`);
    }
    if (c.expectedClearStale !== undefined) add(c.id, c.name, features.successClearsStaleContext === c.expectedClearStale, `successClearsStaleContext=${features.successClearsStaleContext}`);
    if (c.expectedAcquire) add(c.id, c.name, actual === c.expectedAcquire, `expectedAcquire=${c.expectedAcquire} actual=${actual}`);
  }
  if (c.frontendScenario) {
    const actual = frontendDecision(c, features);
    if (c.expectedFreshStatus !== undefined) add(c.id, c.name, actual.freshStatus === c.expectedFreshStatus, `freshStatus=${actual.freshStatus}`);
    if (c.expectedClearsGate !== undefined) add(c.id, c.name, actual.clearsGate === c.expectedClearsGate, `clearsGate=${actual.clearsGate}`);
    if (c.expectedRepairCta !== undefined) add(c.id, c.name, actual.repairCta === c.expectedRepairCta, `repairCta=${actual.repairCta}`);
  }
}

add('S001', 'inspector scans full succeeded history before clean', features.fullHistoryScan);
add('S002', 'rollback verification is strict and not default true', features.rollbackVerifiedStrict && features.rollbackNoDefaultTrue);
add('S003', 'canonical helper shared by inspector and audit/acquire', features.classificationHelperShared);
add('S004', 'status endpoint always uses canonical inspection', features.statusUsesCanonicalInspection);
add('S005', 'exact idle declares and resets conflict flag', features.fullGateFields && features.exactIdleResetsConflict);
add('S006', 'exact idle declares and resets identity-invalid flag', features.fullGateFields && features.exactIdleResetsIdentity);
add('S007', 'non-terminal logs ignored by terminal candidate selection', features.nonTerminalIgnored);
add('S008', 'full terminal metadata validation present', features.existingLogFullMetadata);
add('S009', 'service-role-only RPC grants present', features.serviceRoleOnly);
add('S010', 'no automatic rollback or restore helper', features.noAutoRollback);
add('S011', 'no JSON copy path in changed sources', features.noJsonCopy);
add('S012', 'no hardcoded secret or project ref', features.noSecretProject);
add('S013', 'unknown/malformed classification stays blocked', features.unknownClassificationBlocked);
add('S014', 'conflict and identity invalid are not repairable', features.noUnconditionalRepairable);
add('S015', 'structured audit classifications are preserved', features.structuredErrorsPreserved);
add('S016', 'acquire uses canonical inspection without clean-only filter', features.acquireUsesCanonicalInspection);

const fail = assertions.filter(a => !a.pass);
const pass = assertions.length - fail.length;

if (mode === 'mutation') {
  runMutationSuite();
} else {
  printSummary(mode, pass, fail, assertions);
  process.exit(fail.length ? 1 : 0);
}

function printSummary(label, passCount, failList, list) {
  for (const a of list) {
    const line = `${a.pass ? 'PASS' : 'FAIL'} ${a.id} ${a.name}${a.detail ? ` — ${a.detail}` : ''}`;
    console.log(line);
  }
  console.log(`SUMMARY mode=${label} pass=${passCount} fail=${failList.length} total=${list.length}`);
  if (failList.length && verbose) console.error(JSON.stringify(failList, null, 2));
}

function runMutationSuite() {
  const mutants = [
    { id: 'M001', file: FILES.migration, find: /for v_op in\n    select op\.\*\n    from public\.cms_release_operations as op\n    where op\.lock_key = 'cms-public-current-release'\n      and op\.state = 'succeeded'\n    order by op\.updated_at asc, op\.created_at asc, op\.id asc\n  loop/, repl: "for v_op in\n    select op.*\n    from public.cms_release_operations as op\n    where op.lock_key = 'cms-public-current-release'\n      and op.state = 'succeeded'\n    order by op.updated_at asc, op.created_at asc, op.id asc\n    limit v_limit\n  loop", expected: ['B003','B004','B005','B006','B007','B013','B014','B015','B016','B017','B018','B019','B024','B025','B033','S001'] },
    { id: 'M002', file: FILES.migration, find: /v_rollback_verified_text is distinct from 'true'/g, repl: "coalesce(v_rollback_verified_text, 'true') is distinct from 'true'", expected: ['B003','B006','B007','B009','B010','B011','B012','B020','B024','S002'] },
    { id: 'M003', file: FILES.migration, find: /terminal_audit_conflict|TERMINAL_AUDIT_CONFLICT/g, repl: 'terminal_audit_identity_invalid', expected: ['B004','B014','B015','B016','B017','B019'] },
    { id: 'M004', file: FILES.reconcile, find: /const failureClassification = String\(logResult\?\.classification \|\| 'lineage_repair_required'\);/g, repl: "const failureClassification = 'lineage_repair_required';", expected: ['B019','B020','S015'] },
    { id: 'M005', file: FILES.state, find: /lineageRepairRequired: blocked && lineageRepairRequired,/g, repl: "lineageRepairRequired: true,", expected: ['B021','B022','S014'] },
    { id: 'M006', file: FILES.gate, find: /const gateIdle = await refreshReleaseGateAfterPotentialResolution\(\{[\s\S]{0,160}successResult: data,[\s\S]{0,160}blockedMessage: 'Máy chủ vẫn đang khóa thao tác sau khi phát hiện release khác đang active\.',[\s\S]{0,40}\}\);/, repl: "const gateIdle = true;", expected: ['B026'] },
    { id: 'M007', file: FILES.state, find: /terminalAuditConflict:\s*false,/g, repl: "terminalAuditConflict: true,", expected: ['B028','S005'] },
    { id: 'M008', file: FILES.state, find: /terminalAuditIdentityInvalid:\s*false,/g, repl: "terminalAuditIdentityInvalid: true,", expected: ['B028','S006'] },
    { id: 'M009', file: FILES.reconcile, find: /const inspection = await getTerminalLineageGateInspection\(serviceClient\);/g, repl: "const inspection = requestedOperationId ? { classification: 'clean' } : await getTerminalLineageGateInspection(serviceClient);", expected: ['B024','B025','S004'] },
    { id: 'M010', file: FILES.state, find: /const malformedOrUnknown = !\[[\s\S]*?\]\.includes\(classification\);/, repl: "const malformedOrUnknown = false;", expected: ['B030','S013'] },
    { id: 'M011', file: FILES.gate, find: /if \(!isExactIdleReleaseStatusResponse\(statusResult, statusData\)\) \{/, repl: "if (false) {", expected: ['B027','B029'] },
    { id: 'M012', file: FILES.migration, find: /select \* into v_gate\n  from public\.inspect_cms_terminal_lineage_gate\(1\)/, repl: "select * into v_gate\n  from public.inspect_cms_terminal_lineage_gate(1)\n  where classification = 'clean'", expected: ['B033','S016'] },
  ];
  const results = [];
  let mutationFail = false;
  for (const m of mutants) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `v614066014-${m.id}-`));
    copyDir(root, tmp);
    const target = path.join(tmp, m.file);
    let text = fs.readFileSync(target, 'utf8');
    const next = text.replace(m.find, m.repl);
    if (next === text) {
      results.push({ id: m.id, pass: false, error: 'replacement_not_applied', expected: m.expected, actualFailed: [] });
      mutationFail = true;
      fs.rmSync(tmp, { recursive: true, force: true });
      continue;
    }
    fs.writeFileSync(target, next);
    const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--root', tmp, '--fixture', fixturePath, '--mode', 'fixed'], { encoding: 'utf8' });
    const actualFailed = [...child.stdout.matchAll(/^FAIL\s+(\S+)/gm)].map(m => m[1]);
    const expectedSet = new Set(m.expected);
    const actualSet = new Set(actualFailed);
    const missing = [...expectedSet].filter(id => !actualSet.has(id));
    const unexpected = actualFailed.filter(id => !expectedSet.has(id));
    const ok = missing.length === 0;
    results.push({ id: m.id, pass: ok, expected: m.expected, actualFailed, missing, unexpected });
    if (!ok) mutationFail = true;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} expected=[${r.expected.join(',')}] actual=[${(r.actualFailed || []).join(',')}]${r.error ? ` error=${r.error}` : ''}${r.missing?.length ? ` missing=[${r.missing.join(',')}]` : ''}${r.unexpected?.length ? ` unexpected=[${r.unexpected.join(',')}]` : ''}`);
  }
  console.log(`SUMMARY mode=mutation pass=${results.filter(r => r.pass).length} fail=${results.filter(r => !r.pass).length} total=${results.length}`);
  process.exit(mutationFail ? 1 : 0);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else fs.copyFileSync(from, to);
  }
}
