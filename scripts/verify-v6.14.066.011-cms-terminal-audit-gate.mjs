#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] || process.cwd();
const read = (rel) => existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : '';
const audit = read('supabase/functions/_shared/cmsReleaseAudit.ts');
const reconcile = read('supabase/functions/reconcile-cms-release/index.ts');
const rollbackGate = read('src/cms-admin/adminRollbackGate.js');
const migrationsDir = join(root, 'supabase/migrations');
const migrations = existsSync(migrationsDir) ? readdirSync(migrationsDir).sort() : [];
const mig011Name = migrations.find((name) => /066_011_cms_terminal_audit_canonical_identity/.test(name)) || '';
const mig011 = mig011Name ? read(`supabase/migrations/${mig011Name}`) : '';
const oldMigrationNames = migrations.filter((name) => /066_00(6|8|9|10)_/.test(name));

const tests = [];
function test(name, fn) {
  let pass = false;
  let detail = '';
  try {
    const result = fn();
    pass = result === true || (result && result.pass === true);
    detail = typeof result === 'object' && result.detail ? result.detail : '';
  } catch (error) {
    detail = error?.message || String(error);
  }
  tests.push({ name, pass, detail });
}
const has = (text, pattern) => pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
const count = (text, pattern) => (text.match(pattern) || []).length;

// Action provenance and terminal status contract.
test('01 same actor repair still writes repairedBy', () => has(audit, /actionMode\s*===\s*['"]repair['"][\s\S]{0,240}verifyJson\.repairedBy\s*=\s*actionActorId/));
test('02 same actor reconcile still writes reconciledBy', () => has(audit, /actionMode\s*===\s*['"]reconcile['"][\s\S]{0,260}verifyJson\.reconciledBy\s*=\s*actionActorId/));
test('03 normal action does not synthesize repairedBy or reconciledBy', () => has(audit, /normalizeAuditActionMode\(options\.actionMode \|\| ['"]normal['"]\)/) && !has(audit, /requestedActorId\s*&&\s*requestedActorId\s*!==\s*originalActorId/));
test('04 repair and reconcile are explicit action modes', () => has(audit, /TerminalAuditActionMode\s*=\s*['"]normal['"]\s*\|\s*['"]repair['"]\s*\|\s*['"]reconcile['"]/));
test('05 original actor derives from operation row in helper', () => has(audit, /const originalActorId\s*=\s*normalizeText\(operation\.actorId\)/));
test('06 canonical terminal status derives from operation type', () => has(audit, /getCanonicalTerminalStatus\(operationType\)/) && has(audit, /operationType\s*===\s*['"]publish['"][\s\S]{0,80}return ['"]published['"]/) && has(audit, /operationType\s*===\s*['"]rollback['"][\s\S]{0,80}return ['"]rolled_back['"]/));
test('07 requested terminal status mismatch fails before RPC', () => has(audit, /requestedStatus[\s\S]{0,120}requestedStatus !== canonicalTerminalStatus[\s\S]{0,180}persisted: false/));
test('08 repair or reconcile without action actor fails closed', () => has(audit, /\(actionMode === ['"]repair['"] \|\| actionMode === ['"]reconcile['"]\) && !actionActorId[\s\S]{0,160}persisted: false/));

// Migration/RPC authority and missing lineage.
test('09 additive .066.011 migration exists', () => Boolean(mig011Name));
test('10 acquire RPC checks missing lineage in same transaction', () => has(mig011, /create or replace function public\.acquire_cms_release_operation/) && has(mig011, /pg_advisory_xact_lock/) && has(mig011, /find_cms_terminal_lineage_repair_operation\(1\)/));
test('11 missing-lineage publish only accepts published log', () => has(mig011, /case when op\.operation_type = 'publish' then 'published' else 'rolled_back' end/));
test('12 missing-lineage also checks log operation_type', () => has(mig011, /log\.operation_type = op\.operation_type/));
test('13 terminal audit RPC derives expected status from operation', () => has(mig011, /v_expected_status := case when v_operation\.operation_type = 'publish' then 'published'/));
test('14 terminal audit RPC rejects requested status mismatch', () => has(mig011, /p_terminal_status <> v_expected_status[\s\S]{0,120}raise exception/));
test('15 terminal audit RPC derives original actor from operation row', () => has(mig011, /v_original_actor := v_operation\.actor_id/));
test('16 terminal audit RPC writes repair actor separately', () => has(mig011, /'repairedBy', v_action_actor::text/) && has(mig011, /v_action_mode = 'repair'/));
test('17 terminal audit RPC writes reconcile actor separately', () => has(mig011, /'reconciledBy', v_action_actor::text/) && has(mig011, /v_action_mode = 'reconcile'/));
test('18 terminal audit RPC does not trust payload latest_path', () => has(mig011, /v_latest_path := coalesce\(nullif\(v_operation\.pointer_path/));
test('19 publish canonical identity is required', () => has(mig011, /publish operation missing expected release id/) && has(mig011, /publish operation missing content path\/hash/) && has(mig011, /v_operation\.draft_id is null/));
test('20 rollback from release id required', () => has(mig011, /v_from_release_id/) && has(mig011, /rollback operation missing canonical from\/to lineage/));
test('21 rollback from path and hash required', () => has(mig011, /v_from_path/) && has(mig011, /v_from_hash/));
test('22 rollback to release path and hash required', () => has(mig011, /v_to_release_id/) && has(mig011, /v_to_path/) && has(mig011, /v_to_hash/));
test('23 rollback operation content matches to lineage', () => has(mig011, /content path\/hash does not match to-lineage/));
test('24 existing terminal log is validated before reuse', () => has(mig011, /existing terminal audit log for operation has mismatched canonical identity/) && has(mig011, /existing publish audit log identity does not match operation/) && has(mig011, /existing rollback audit log identity does not match operation/));
test('25 RPC execute permission only service_role', () => has(mig011, /revoke all on function public\.ensure_cms_terminal_operation_audit\(uuid, text, jsonb, jsonb\) from authenticated/) && has(mig011, /grant execute on function public\.ensure_cms_terminal_operation_audit\(uuid, text, jsonb, jsonb\) to service_role/));
test('26 old migrations were not edited into .066.011', () => oldMigrationNames.length >= 3 && oldMigrationNames.every((name) => !/066_011/.test(read(`supabase/migrations/${name}`))));

// Reconciliation and repair gate semantics.
test('27 reconcile success requires audit persisted', () => has(reconcile, /auditPersisted/) && has(reconcile, /LINEAGE_REPAIR_PERSIST_FAILED/) && has(reconcile, /classification:\s*['"]lineage_repair_required['"]/));
test('28 active_expected audit failure cannot return success', () => has(reconcile, /if \(!auditPersisted\)[\s\S]{0,700}ok:\s*false/) && !has(reconcile, /classification:\s*['"]active_expected_release['"][\s\S]{0,200}auditPersisted\s*\?\s*true/));
test('29 repair-lineage only returns success after persisted present log id', () => has(reconcile, /repair\?\.persisted === true/) && has(reconcile, /repair\?\.auditLogState === ['"]present['"]/) && has(reconcile, /auditLogId/));
test('30 explicit reconcile uses reconcile action mode', () => has(reconcile, /ensureOperationAuditLogForReconciliation\(serviceClient, succeededOperation, reconciliation, user\.id, ['"]reconcile['"]\)/));
test('31 repair resolved operation uses repair action mode', () => has(reconcile, /ensureOperationAuditLogForReconciliation\(serviceClient, operation, reconciliation, actorId, ['"]repair['"]\)/));
test('32 rollback reconciliation passes action mode to audit helper', () => has(reconcile, /operation_type:\s*['"]rollback['"]/ ) && has(reconcile, /\}, \{ actionMode, actionActorId: actorId \}\);/));
test('33 publish reconciliation passes action mode to audit helper', () => has(reconcile, /operation_type:\s*['"]publish['"][\s\S]{0,180}\}, \{ actionMode, actionActorId: actorId \}\)/));

// Frontend gate integrity.
test('34 frontend has status refresh after reconcile resolution', () => has(rollbackGate, /refreshReleaseGateAfterPotentialResolution/) && count(rollbackGate, /mode:\s*['"]status['"]/g) >= 2);
test('35 frontend does not clear gate directly on active_expected_release', () => !has(rollbackGate, /classification === ['"]active_expected_release['"][\s\S]{0,220}setReleaseOperationGateState\(\{ blocked:\s*false/));
test('36 frontend only clears after status confirms idle helper path', () => has(rollbackGate, /if \(statusData\.operationId \|\| statusData\.lineageRepairRequired === true/) && has(rollbackGate, /state:\s*['"]idle['"]/));
test('37 lineage repair required keeps gate blocked', () => has(rollbackGate, /lineageRepairRequired:\s*true/) && has(rollbackGate, /repairRequired:\s*true/));
test('38 status error keeps blocked after repair', () => has(rollbackGate, /statusResult\.error[\s\S]{0,220}blocked:\s*true/));
test('39 pointer unknown and lineage repair copy are distinct', () => has(rollbackGate, /Chưa xác định website đang dùng bản nào/) && has(rollbackGate, /lịch sử vận hành chưa hoàn tất/));

// Safety invariants.
test('40 no automatic rollback helper in changed source', () => !has(audit + reconcile + rollbackGate, /rollbackLatest\(|restoreLatest\(|automatic rollback/i));
test('41 no JSON copy path in changed source', () => !has(audit + reconcile + rollbackGate, /copy\s*\(|copyObject|copy JSON/i));
test('42 no hardcoded Supabase project ref', () => !has(audit + reconcile + rollbackGate + mig011, /https:\/\/[a-z0-9-]+\.supabase\.co/i));
test('43 changed scope files are allowed', () => Boolean(mig011Name) && has(audit, 'ensureTerminalOperationAuditLog') && has(reconcile, 'repair-lineage') && has(rollbackGate, 'refreshReleaseGateAfterPotentialResolution'));
test('44 harness source is present in scripts', () => existsSync(join(root, 'scripts/verify-v6.14.066.011-cms-terminal-audit-gate.mjs')) || root !== process.cwd());

let pass = 0;
for (const item of tests) {
  if (item.pass) pass += 1;
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
}
const fail = tests.length - pass;
console.log(`SUMMARY pass=${pass} fail=${fail} total=${tests.length}`);
process.exitCode = fail === 0 ? 0 : 1;
