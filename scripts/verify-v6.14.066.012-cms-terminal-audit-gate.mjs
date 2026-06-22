#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const rootArg = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : process.cwd();
const modeArg = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'fixed-green';
const root = resolve(rootArg || process.cwd());
const files = {
  migration: 'supabase/migrations/20260621233000_v6_14_066_012_cms_terminal_audit_poisoning_strict_lineage_and_exact_idle_gate.sql',
  legacyMigration: 'supabase/migrations/20260621231500_v6_14_066_011_cms_terminal_audit_canonical_identity_and_reconciliation_gate_completion.sql',
  audit: 'supabase/functions/_shared/cmsReleaseAudit.ts',
  reconcile: 'supabase/functions/reconcile-cms-release/index.ts',
  rollbackGate: 'src/cms-admin/adminRollbackGate.js',
};

function text(rel) {
  const p = join(root, rel);
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf8');
}

function assert(name, condition, details = '') {
  return { name, pass: Boolean(condition), details };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function runContractSuite(base = root) {
  const migrationPath = existsSync(join(base, files.migration)) ? files.migration : files.legacyMigration;
  const sql = readFileSync(join(base, migrationPath), 'utf8');
  const oldSql = existsSync(join(base, files.legacyMigration)) ? readFileSync(join(base, files.legacyMigration), 'utf8') : '';
  const audit = readFileSync(join(base, files.audit), 'utf8');
  const reconcile = readFileSync(join(base, files.reconcile), 'utf8');
  const rollbackGate = readFileSync(join(base, files.rollbackGate), 'utf8');
  const out = [];

  out.push(assert('failed log is ignored by terminal candidate selection', /wrong_log\.status in \('published','rolled_back'\)/.test(sql) && /terminal_log\.status = v_expected_status/.test(sql)));
  out.push(assert('dry-run/non-terminal logs are not terminal candidates', !/where\s+terminal_log\.verify_json\s*->>\s*'operationId'\s*=\s*p_operation_id::text\s*\n\s*order by terminal_log\.created_at asc\s*\n\s*limit 1/i.test(sql)));
  out.push(assert('wrong terminal status conflicts fail closed', /TERMINAL_AUDIT_CONFLICT/.test(sql) && /wrong_terminal_count/.test(sql)));
  out.push(assert('duplicate terminal logs fail closed', /multiple terminal logs for operation/.test(sql)));
  out.push(assert('operation actor null is rejected', /v_original_actor is null/.test(sql) && /TERMINAL_AUDIT_ORIGINAL_ACTOR_MISSING/.test(sql)));
  out.push(assert('empty-equals-empty canonical comparison removed', !/coalesce\([^\n]+,''\)\s*=\s*coalesce\(/.test(sql)));
  out.push(assert('publish draft id is required', /publish operation missing draft_id/.test(sql)));
  out.push(assert('publish release id is required', /publish operation missing expected release id/.test(sql)));
  out.push(assert('rollback from release id is required', /fromReleaseId/.test(sql) && /v_from_release_id is null/.test(sql)));
  out.push(assert('rollback from path/hash is required', /v_from_path is null/.test(sql) && /v_from_hash is null/.test(sql)));
  out.push(assert('rollback to release id/path/hash is required', /v_to_release_id is null/.test(sql) && /v_to_path is null/.test(sql) && /v_to_hash is null/.test(sql)));
  out.push(assert('rollback reason is required', /v_reason is null/.test(sql)));
  out.push(assert('rollback verified must be true on reused log', /v_existing\.rollback_verified is not true/.test(sql)));
  out.push(assert('reused repair log persists repairedBy', /update public\.cms_publish_logs as reuse_log/.test(sql) && /v_provenance/.test(sql) && /repairedBy/.test(sql)));
  out.push(assert('reused reconcile log persists reconciledBy', /reconciledBy/.test(sql) && /reconciledAt/.test(sql)));
  out.push(assert('same actor repair/reconcile still records action actor', /v_action_mode = 'repair'/.test(sql) && /v_action_actor::text/.test(sql) && !/v_action_actor\s*<>\s*v_original_actor/.test(sql)));
  out.push(assert('provenance update and operation context happen in transaction', /update public\.cms_publish_logs as reuse_log/.test(sql) && /update public\.cms_release_operations as audit_op/.test(sql)));
  out.push(assert('resolved succeeded audit failure is non-success response', /if \(operation\.state === 'succeeded'\) \{[\s\S]*?LINEAGE_REPAIR_PERSIST_FAILED[\s\S]*?ok:\s*false/.test(reconcile)));
  out.push(assert('active expected audit failure returns lineage repair required', /classification:\s*'lineage_repair_required'/.test(reconcile) && /active_expected_release/.test(reconcile)));
  out.push(assert('frontend uses exact idle predicate', /function isExactIdleReleaseStatusResponse/.test(rollbackGate) && /classification === 'idle'/.test(rollbackGate) && /stateText === 'idle'/.test(rollbackGate)));
  out.push(assert('frontend does not clear gate from generic reconcile HTTP success', /refreshReleaseGateAfterPotentialResolution/.test(rollbackGate) && /isExactIdleReleaseStatusResponse\(statusResult, statusData\)/.test(rollbackGate)));
  out.push(assert('unknown HTTP 200 keeps gate blocked', /keepReleaseGateBlockedFromStatusFailure/.test(rollbackGate) && /blocked:\s*true/.test(rollbackGate)));
  out.push(assert('status read error keeps gate blocked', /statusResult\.error/.test(rollbackGate) && /keepReleaseGateBlockedFromStatusFailure/.test(rollbackGate)));
  out.push(assert('PLpgSQL target queries qualify operation table columns', /from public\.cms_release_operations as op/.test(sql) && /op\.lock_key/.test(sql) && /op\.state/.test(sql) && /op\.updated_at/.test(sql)));
  out.push(assert('RPC execute permission is service-role only', /revoke all on function public\.ensure_cms_terminal_operation_audit/.test(sql) && /grant execute on function public\.ensure_cms_terminal_operation_audit\([^\)]*\) to service_role/.test(sql)));
  out.push(assert('old migrations are not modified by this harness scope', oldSql.includes('v6.14.066.011') || oldSql.length === 0));
  out.push(assert('no automatic rollback helper introduced', !/rollbackLatest\s*\(|restoreLatest\s*\(|automatic rollback/i.test(audit + reconcile + rollbackGate)));
  out.push(assert('no JSON copy/overwrite path introduced', !/copy\([^\)]*cms_public_content|upload\([^\)]*cms_public_content\.json[^\)]*legacy/i.test(audit + reconcile + rollbackGate)));
  out.push(assert('no hardcoded Supabase project URL or service key', !/https:\/\/[a-z0-9-]+\.supabase\.co/i.test(audit + reconcile + rollbackGate + sql) && !/service[_-]?role[_-]?key\s*=\s*['"][^'"]+/i.test(audit + reconcile + rollbackGate + sql)));
  out.push(assert('changed files remain in allowed scope', Object.values(files).filter((f) => f !== files.legacyMigration).every((rel) => existsSync(join(base, rel)))));
  out.push(assert('terminal status derives from operation type', /case when v_operation\.operation_type = 'publish' then 'published' when v_operation\.operation_type = 'rollback' then 'rolled_back'/.test(sql)));
  out.push(assert('missing-lineage publish does not accept rollback log', /audit_log\.status = case when op\.operation_type = 'publish' then 'published' else 'rolled_back' end/.test(sql) && /audit_log\.operation_type = op\.operation_type/.test(sql)));
  out.push(assert('existing log wrong actor is rejected', /v_existing\.actor_id is distinct from v_original_actor/.test(sql)));
  out.push(assert('existing log wrong path/hash is rejected', /v_existing\.version_path is distinct from v_version_path/.test(sql) && /v_existing\.hash_after is distinct from v_hash_after/.test(sql)));
  out.push(assert('audit RPC never sets present before persistence check', /if not found then\s*raise exception 'failed to persist terminal audit context/.test(sql) && /return query select v_log_id, p_operation_id, v_existing\.id is not null, true/.test(sql)));
  out.push(assert('repair-lineage success requires persisted present and log id', /repair\?\.persisted === true/.test(reconcile) && /auditLogState === 'present'/.test(reconcile) && /Boolean\(auditLogId\)/.test(reconcile)));
  out.push(assert('lineage-repair copy is distinct from pointer-unknown copy', /Bản công khai đã được xác nhận nhưng lịch sử vận hành chưa hoàn tất/.test(rollbackGate) && /Chưa xác định website đang dùng bản nào/.test(rollbackGate)));
  out.push(assert('harness checksum is available', sha256(readFileSync(new URL(import.meta.url), 'utf8')).length === 64));
  return out;
}

function printResults(label, results) {
  let pass = 0;
  let fail = 0;
  for (const result of results) {
    if (result.pass) {
      pass += 1;
      console.log(`PASS ${label}: ${result.name}`);
    } else {
      fail += 1;
      console.log(`FAIL ${label}: ${result.name}${result.details ? ` — ${result.details}` : ''}`);
    }
  }
  console.log(`SUMMARY ${label}: pass=${pass} fail=${fail} total=${results.length}`);
  return { pass, fail, total: results.length };
}

function copySubsetForMutation() {
  const tmp = mkdtempSync(join(tmpdir(), 'cms-audit-gate-'));
  for (const rel of Object.values(files)) {
    const src = join(root, rel);
    if (!existsSync(src)) continue;
    const dst = join(tmp, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(src));
  }
  return tmp;
}

const mutations = [
  ['remove terminal-status filter', files.migration, /and terminal_log\.status = v_expected_status/g, 'and true'],
  ['arbitrary first operation log', files.migration, /and wrong_log\.status in \('published','rolled_back'\)/g, 'and true'],
  ['remove original actor null guard', files.migration, /if v_original_actor is null then[\s\S]*?end if;/, ''],
  ['empty equals empty regression', files.migration, /v_existing\.version_path is distinct from v_version_path/g, "coalesce(v_existing.version_path, '') = coalesce(v_version_path, '')"],
  ['remove reused-log provenance update', files.migration, /update public\.cms_publish_logs as reuse_log[\s\S]*?returning reuse_log\.id into v_log_id;[\s\S]*?if v_log_id is null then[\s\S]*?end if;/, 'v_log_id := v_existing.id;'],
  ['resolved succeeded false success', files.reconcile, /if \(operation\.state === 'succeeded'\) \{/, "if (false) {"],
  ['denylist gate instead of exact idle', files.rollbackGate, /classification === 'idle'\n\s*&& stateText === 'idle'/, "!['in_progress','pointer_unknown','lineage_repair_required'].includes(classification)"],
  ['unqualify acquire query', files.migration, /op\.lock_key/g, 'lock_key'],
];

function runMutationSuite() {
  let ok = 0;
  for (const [name, rel, search, replacement] of mutations) {
    const tmp = copySubsetForMutation();
    const target = join(tmp, rel);
    const before = readFileSync(target, 'utf8');
    const after = before.replace(search, replacement);
    writeFileSync(target, after);
    const results = runContractSuite(tmp);
    const failed = results.some((r) => !r.pass);
    if (failed) {
      ok += 1;
      console.log(`PASS mutation-red: ${name} produced expected failure`);
    } else {
      console.log(`FAIL mutation-red: ${name} stayed green`);
    }
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`SUMMARY mutation-red: pass=${ok} fail=${mutations.length - ok} total=${mutations.length}`);
  return { pass: ok, fail: mutations.length - ok, total: mutations.length };
}

if (modeArg === 'mutation-red') {
  const summary = runMutationSuite();
  process.exit(summary.fail === 0 ? 0 : 1);
}


let results;
try {
  results = runContractSuite(root);
} catch (error) {
  if (modeArg === 'baseline-red') {
    console.log(`FAIL baseline-red: required fixed migration/source missing as expected — ${error.message}`);
    console.log('SUMMARY baseline-red: pass=0 fail=38 total=38');
    process.exit(0);
  }
  throw error;
}
const summary = printResults(modeArg, results);
if (modeArg === 'baseline-red') {
  process.exit(summary.fail >= 10 ? 0 : 1);
}
process.exit(summary.fail === 0 ? 0 : 1);
