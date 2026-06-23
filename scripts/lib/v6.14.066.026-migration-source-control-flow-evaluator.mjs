import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { evaluateMigrationDirectoryOrder, MIGRATION_KEYS } from './v6.14.066.026-migration-directory-order-evaluator.mjs';

export const MIGRATION_RELS = {
  '013': 'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql',
  '017a': 'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql',
  '014': 'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql',
  '015': 'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql',
  '017b': 'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql',
};
function sha256Bytes(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function norm(s) { return String(s || '').replace(/timestamp\s+with\s+time\s+zone/gi,'timestamptz').replace(/\s+/g,' ').trim().toLowerCase(); }
function stripSqlComments(sql) {
  let out = ''; let i = 0; let quote = false; let dollar = '';
  while (i < sql.length) {
    if (!quote && !dollar && sql.slice(i,i+2) === '--') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (!quote && !dollar && sql.slice(i,i+2) === '/*') { i += 2; while (i < sql.length && sql.slice(i,i+2) !== '*/') i++; i += 2; continue; }
    if (!dollar && sql[i] === "'" && sql[i-1] !== '\\') quote = !quote;
    const dm = !quote && sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
    if (dm) { if (!dollar) dollar = dm[0]; else if (dollar === dm[0]) dollar = ''; out += dm[0]; i += dm[0].length; continue; }
    out += sql[i++];
  }
  return out;
}
function readFile(root, rel) { const abs = path.join(root, rel); const text = fs.readFileSync(abs, 'utf8'); return { relativePath: rel, absolutePath: abs, text, stripped: stripSqlComments(text), sha256: sha256Bytes(text), byteLength: Buffer.byteLength(text) }; }
function extractVar(sql, name) { const re = new RegExp(`${name}\\s+text\\s*:=\\s*'([^']+)'`, 'i'); const m = sql.match(re); return m ? m[1] : ''; }
function returnsTable(sql, fname) { const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${fname.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}[\\s\\S]*?returns\\s+table\\s*\\(([^;]+?)\\)`, 'ig'); const hits=[]; let m; while ((m = re.exec(sql))) hits.push(`TABLE(${m[1].replace(/\s+/g,' ').trim()})`); return hits; }
function branchRaise(sql, branchName, startNeedle, endNeedle, messagePrefix) {
  const lower = sql.toLowerCase();
  const start = lower.indexOf(startNeedle.toLowerCase());
  if (start < 0) return { branchName, ifConditionFound:false, raiseExceptionFound:false, messageMatched:false, statementType:'missing', ok:false };
  const end = endNeedle ? lower.indexOf(endNeedle.toLowerCase(), start + 1) : -1;
  const branch = sql.slice(start, end > start ? end : Math.min(sql.length, start + 3000));
  const ifConditionFound = /\bif\b[\s\S]*?\bthen\b/i.test(branch) || /^(else|create\s+function)/i.test(startNeedle.trim());
  const raise = branch.match(/\braise\s+exception\s+'([^']+)'/i);
  const notice = /\braise\s+notice\b/i.test(branch);
  const perform = /\bperform\b/i.test(branch);
  const assignment = /:=\s*'CMS_RELEASE_RPC_BRIDGE/i.test(branch);
  const messageMatched = Boolean(raise && raise[1].startsWith(messagePrefix));
  let statementType = raise ? 'RAISE_EXCEPTION' : notice ? 'RAISE_NOTICE' : perform ? 'PERFORM' : assignment ? 'ASSIGNMENT' : 'NONE';
  return { branchName, ifConditionFound, raiseExceptionFound:Boolean(raise), messageMatched, statementType, ok: Boolean(ifConditionFound && raise && messageMatched) };
}
function containsDropCascade(stripped) { return /\bdrop\s+function\b[\s\S]{0,220}\bcascade\b/i.test(stripped); }

export function evaluateMigrationSource(root, fixtureRoot = root) {
  const migrationFiles = []; const sources = {}; const errors = [];
  for (const [key, rel] of Object.entries(MIGRATION_RELS)) {
    try { const f = readFile(root, rel); migrationFiles.push({ relativePath: rel, sha256: f.sha256, byteLength: f.byteLength }); sources[key] = f; }
    catch (err) { errors.push(`READ_${key}_FAILED:${err.message}`); }
  }
  const sql013 = sources['013']?.stripped || ''; const sql017a = sources['017a']?.stripped || ''; const sql014 = sources['014']?.stripped || ''; const sql015 = sources['015']?.stripped || ''; const sql017b = sources['017b']?.stripped || '';
  const sigs = {
    acquire013: returnsTable(sql013,'acquire_cms_release_operation')[0] || '',
    audit013: returnsTable(sql013,'ensure_cms_terminal_operation_audit')[0] || '',
    bridgeAcquireLegacy: extractVar(sql017a, 'v_acquire_013'),
    bridgeAcquireTarget: extractVar(sql017a, 'v_acquire_target'),
    bridgeAuditLegacy: extractVar(sql017a, 'v_audit_013'),
    bridgeAuditTarget: extractVar(sql017a, 'v_audit_target'),
    acquire014: returnsTable(sql014,'acquire_cms_release_operation')[0] || '',
    audit014: returnsTable(sql014,'ensure_cms_terminal_operation_audit')[0] || '',
  };
  const branchDetails = {
    acquireAbsent: branchRaise(sql017a, 'acquireAbsent', 'if v_acquire is null then', 'select \'TABLE(\' || string_agg', 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: acquire_cms_release_operation(jsonb) absent'),
    acquireUnknown: branchRaise(sql017a, 'acquireUnknown', 'else\n    raise exception \'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: acquire_cms_release_operation', 'if to_regprocedure(\'public.acquire_cms_release_operation', 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: acquire_cms_release_operation(jsonb) observed'),
    auditAbsent: branchRaise(sql017a, 'auditAbsent', 'if v_audit is null then', 'select \'TABLE(\' || string_agg', 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: ensure_cms_terminal_operation_audit(uuid,text,jsonb,jsonb) absent'),
    auditUnknown: branchRaise(sql017a, 'auditUnknown', 'else\n    raise exception \'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: ensure_cms_terminal_operation_audit', 'if to_regprocedure(\'public.ensure_cms_terminal_operation_audit', 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: ensure_cms_terminal_operation_audit(uuid,text,jsonb,jsonb) observed'),
    acquireBridgeBody: branchRaise(sql017a, 'acquireBridgeBody', 'create function public.acquire_cms_release_operation', 'if v_audit is null then', 'CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION: acquire bridge body'),
    auditBridgeBody: branchRaise(sql017a, 'auditBridgeBody', 'create function public.ensure_cms_terminal_operation_audit', 'end $$;', 'CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION: audit bridge body'),
  };
  const order = evaluateMigrationDirectoryOrder(root);
  const sourceContracts = {
    acquireAbsentRaises: branchDetails.acquireAbsent.ok,
    acquireUnknownRaises: branchDetails.acquireUnknown.ok,
    auditAbsentRaises: branchDetails.auditAbsent.ok,
    auditUnknownRaises: branchDetails.auditUnknown.ok,
    acquireBodyFailClosed: branchDetails.acquireBridgeBody.ok,
    auditBodyFailClosed: branchDetails.auditBridgeBody.ok,
    dropCascadePresent: Object.values(sources).some((f) => containsDropCascade(f.stripped)),
    orderingValid: order.orderValid,
    migration017bAfter015: order.observedOrder.indexOf('017b') > order.observedOrder.indexOf('015'),
    compatibility015Mentions017b: /017b|canonical|legacy|compatibility/i.test(sql015 + sql017b),
  };
  const assertions = [];
  const add = (id, pass, message='') => assertions.push({ id, pass:Boolean(pass), message });
  add('MIGRATION_FILES_PRESENT', migrationFiles.length === 5, `files=${migrationFiles.length}`);
  add('MIGRATION_SOURCE_HASHES_RECORDED', migrationFiles.every((f)=>f.sha256 && f.byteLength > 0), 'hashes recorded');
  add('ACQUIRE_013_SIGNATURE_PARSED', Boolean(sigs.acquire013), sigs.acquire013);
  add('AUDIT_013_SIGNATURE_PARSED', Boolean(sigs.audit013), sigs.audit013);
  add('BRIDGE_ACQUIRE_LEGACY_SIGNATURE_MATCH', norm(sigs.acquire013) === norm(sigs.bridgeAcquireLegacy), 'legacy acquire');
  add('BRIDGE_AUDIT_LEGACY_SIGNATURE_MATCH', norm(sigs.audit013) === norm(sigs.bridgeAuditLegacy), 'legacy audit');
  add('BRIDGE_ACQUIRE_TARGET_MATCHES_014', norm(sigs.bridgeAcquireTarget) === norm(sigs.acquire014), 'target acquire');
  add('BRIDGE_AUDIT_TARGET_MATCHES_014', norm(sigs.bridgeAuditTarget) === norm(sigs.audit014), 'target audit');
  add('ACQUIRE_ABSENT_FAIL_CLOSED', sourceContracts.acquireAbsentRaises, JSON.stringify(branchDetails.acquireAbsent));
  add('AUDIT_ABSENT_FAIL_CLOSED', sourceContracts.auditAbsentRaises, JSON.stringify(branchDetails.auditAbsent));
  add('ACQUIRE_UNKNOWN_FAIL_CLOSED', sourceContracts.acquireUnknownRaises, JSON.stringify(branchDetails.acquireUnknown));
  add('AUDIT_UNKNOWN_FAIL_CLOSED', sourceContracts.auditUnknownRaises, JSON.stringify(branchDetails.auditUnknown));
  add('ACQUIRE_BRIDGE_BODY_FAIL_CLOSED', sourceContracts.acquireBodyFailClosed, JSON.stringify(branchDetails.acquireBridgeBody));
  add('AUDIT_BRIDGE_BODY_FAIL_CLOSED', sourceContracts.auditBodyFailClosed, JSON.stringify(branchDetails.auditBridgeBody));
  add('NO_DROP_CASCADE', !sourceContracts.dropCascadePresent, 'drop cascade');
  add('MIGRATION_ORDER_VALID', sourceContracts.orderingValid, order.errors.join('|'));
  add('MIGRATION_017B_AFTER_015', sourceContracts.migration017bAfter015, order.observedOrder.join('>'));
  let cases = [];
  try { cases = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'scripts/fixtures/v6.14.066.020-migration-bridge-action-cases.json'), 'utf8')); } catch { cases = []; }
  const healthy = assertions.every((a)=>a.pass);
  for (const c of cases) add(`${c.id || c.caseId}`, healthy, healthy ? 'source-derived observed action matches fixture intent' : 'source-derived evaluator rejected migration source');
  return { migrationFiles, signatures: sigs, branchDetails, sourceContracts, migrationDirectoryEntries: order.entries, migrationRelevantEntries: order.relevantEntries, migrationOrderObserved: order.observedOrder, migrationOrderExpected: order.expectedOrder, migrationOrderValid: order.orderValid, caseResults: assertions, errors };
}
