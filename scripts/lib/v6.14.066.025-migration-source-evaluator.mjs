import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MIGRATION_RELS = [
  'supabase/migrations/20260621234500_v6_14_066_013_cms_invalid_succeeded_operation_gate_unified_lineage_classification.sql',
  'supabase/migrations/20260621235500_v6_14_066_017a_cms_rpc_signature_bridge_pre_014.sql',
  'supabase/migrations/20260622000000_v6_14_066_014_cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status.sql',
  'supabase/migrations/20260622001500_v6_14_066_015_cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion.sql',
  'supabase/migrations/20260622003000_v6_14_066_017b_cms_release_lineage_canonical_migration_recovery.sql',
];
function sha256Bytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function normalizeType(s) { return String(s).replace(/timestamp with time zone/gi, 'timestamptz').replace(/\s+/g, ' ').trim().toLowerCase(); }
function stripComments(sql) { return String(sql).replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''); }
function read(root, rel) { const p=path.join(root, rel); const bytes=fs.readFileSync(p); return { rel, path:p, bytes, text:bytes.toString('utf8'), sha256:sha256Bytes(bytes), byteLength:bytes.length }; }
function findReturnsTable(sql, funcName) {
  const clean = stripComments(sql);
  const idx = clean.toLowerCase().indexOf(`function public.${funcName.toLowerCase()}`);
  if (idx < 0) return '';
  const after = clean.slice(idx);
  const m = after.match(/returns\s+table\s*\(([\s\S]*?)\)\s*language/i);
  if (!m) return '';
  return normalizeType('TABLE(' + m[1].split(',').map(x=>x.trim()).join(', ') + ')');
}
function findVarSignature(sql, name) {
  const m = stripComments(sql).match(new RegExp(`${name}\\s+text\\s*:=\\s*'([^']+)'`, 'i'));
  return m ? normalizeType(m[1]) : '';
}
function hasRaise(sql, needle) { return stripComments(sql).includes(needle); }
function hasDropCascade(sql) { return /drop\s+function[\s\S]{0,160}?cascade\b/i.test(stripComments(sql)); }
function timestampOf(rel) { const base=path.basename(rel); const m=base.match(/^(\d{14})_/); return m ? m[1] : ''; }
function decideAction(rpc, observed, c) {
  const legacy = rpc === 'acquire' ? c.signatures.acquire013 : c.signatures.audit013;
  const bridgeLegacy = rpc === 'acquire' ? c.signatures.bridgeAcquireLegacy : c.signatures.bridgeAuditLegacy;
  const bridgeTarget = rpc === 'acquire' ? c.signatures.bridgeAcquireTarget : c.signatures.bridgeAuditTarget;
  const actualTarget = rpc === 'acquire' ? c.signatures.acquire014 : c.signatures.audit014;
  const absent = rpc === 'acquire' ? c.sourceContracts.acquireAbsentRaises : c.sourceContracts.auditAbsentRaises;
  const unknown = rpc === 'acquire' ? c.sourceContracts.acquireUnknownRaises : c.sourceContracts.auditUnknownRaises;
  const bodyFailClosed = rpc === 'acquire' ? c.sourceContracts.acquireBodyFailClosed : c.sourceContracts.auditBodyFailClosed;
  if (observed === 'absent') return absent ? 'raise_absent' : 'unsafe_missing_absent_raise';
  if (observed === 'unknown' || observed === 'unknownColumnOrder' || observed === 'unknownOutputType') return unknown ? 'raise_unknown' : 'unsafe_missing_unknown_raise';
  if (observed === 'targetAligns014') return bridgeTarget && actualTarget && bridgeTarget === actualTarget ? 'target_signature_aligns_014' : 'source_invalid';
  if (observed === 'bridgeBody') return bodyFailClosed ? 'bridge_body_fail_closed' : 'source_invalid';
  if (observed === 'migrationOrder') return c.sourceContracts.orderingValid ? 'ordering_valid' : 'source_invalid';
  if (observed === 'dropCascade') return !c.sourceContracts.dropCascadePresent ? 'no_drop_cascade' : 'source_invalid';
  if (observed === '017bAfter015') return c.sourceContracts.migration017bAfter015 && c.sourceContracts.compat015For017b ? '017b_after_015' : 'source_invalid';
  if (!legacy || !bridgeLegacy || !bridgeTarget || !actualTarget || !bodyFailClosed || c.sourceContracts.dropCascadePresent || !c.sourceContracts.orderingValid || !c.sourceContracts.migration017bAfter015 || !c.sourceContracts.compat015For017b) return 'source_invalid';
  if (bridgeLegacy !== legacy) return 'source_invalid';
  if (bridgeTarget !== actualTarget) return 'source_invalid';
  if (observed === 'actual013') return 'recreate_target';
  if (observed === 'target014') return 'noop_target';
  return 'raise_unknown';
}
export function evaluateMigrationSource(root, fixtureCases=[]) {
  const migrationFiles=[]; const texts={}; const missing=[];
  for (const rel of MIGRATION_RELS) { try { const f=read(root, rel); migrationFiles.push({ relativePath:rel, sha256:f.sha256, byteLength:f.byteLength }); texts[rel]=f.text; } catch { missing.push(rel); texts[rel]=''; } }
  const [f013,f017a,f014,f015,f017b]=MIGRATION_RELS;
  const signatures = {
    acquire013: findReturnsTable(texts[f013], 'acquire_cms_release_operation'),
    audit013: findReturnsTable(texts[f013], 'ensure_cms_terminal_operation_audit'),
    bridgeAcquireLegacy: findVarSignature(texts[f017a], 'v_acquire_013'),
    bridgeAcquireTarget: findVarSignature(texts[f017a], 'v_acquire_target'),
    bridgeAuditLegacy: findVarSignature(texts[f017a], 'v_audit_013'),
    bridgeAuditTarget: findVarSignature(texts[f017a], 'v_audit_target'),
    acquire014: findReturnsTable(texts[f014], 'acquire_cms_release_operation'),
    audit014: findReturnsTable(texts[f014], 'ensure_cms_terminal_operation_audit'),
  };
  const timestamps = MIGRATION_RELS.map(timestampOf);
  const sourceContracts = {
    acquireAbsentRaises: hasRaise(texts[f017a], 'acquire_cms_release_operation(jsonb) absent after .013'),
    auditAbsentRaises: hasRaise(texts[f017a], 'ensure_cms_terminal_operation_audit(uuid,text,jsonb,jsonb) absent after .013'),
    acquireUnknownRaises: hasRaise(texts[f017a], 'acquire_cms_release_operation(jsonb) observed'),
    auditUnknownRaises: hasRaise(texts[f017a], 'ensure_cms_terminal_operation_audit(uuid,text,jsonb,jsonb) observed'),
    acquireBodyFailClosed: hasRaise(texts[f017a], 'acquire bridge body must not be called before .014/.017b completes'),
    auditBodyFailClosed: hasRaise(texts[f017a], 'audit bridge body must not be called before .014/.017b completes'),
    dropCascadePresent: MIGRATION_RELS.some(rel=>hasDropCascade(texts[rel])),
    orderingValid: timestamps.join('|') === [...timestamps].sort().join('|') && timestamps[0] < timestamps[1] && timestamps[1] < timestamps[2] && timestamps[2] < timestamps[3] && timestamps[3] < timestamps[4],
    migration017bAfter015: timestampOf(f017b) > timestampOf(f015),
    compat015For017b: /drop\s+function\s+if\s+exists\s+public\.acquire_cms_release_operation\(jsonb\)/i.test(stripComments(texts[f015])) && /create\s+or\s+replace\s+function\s+public\.acquire_cms_release_operation_v2\(p_operation\s+jsonb\)/i.test(stripComments(texts[f017b])),
  };
  const caseResults = fixtureCases.map((c)=>{
    const observedAction = decideAction(c.rpc, c.observed, { signatures, sourceContracts });
    return { id:c.id, rpc:c.rpc, observed:c.observed, expectedAction:c.expectedAction, observedAction, pass: observedAction === c.expectedAction };
  });
  return { migrationFiles, missing, signatures, sourceContracts, caseResults, migrationSourceFilesRead: migrationFiles.map(f=>f.relativePath), migrationSourceHashes: Object.fromEntries(migrationFiles.map(f=>[f.relativePath, f.sha256])) };
}
export function migrationAssertions(result) {
  const a=[]; const add=(id,pass,msg='')=>a.push({id,pass:Boolean(pass),message:String(msg||'')}); const s=result.signatures, c=result.sourceContracts;
  add('MIGRATION_FILES_PRESENT', result.missing.length===0, result.missing.join(','));
  add('MIGRATION_SOURCE_HASHES_RECORDED', Object.keys(result.migrationSourceHashes||{}).length===5, String(Object.keys(result.migrationSourceHashes||{}).length));
  add('ACQUIRE_013_SIGNATURE_PARSED', Boolean(s.acquire013), s.acquire013);
  add('AUDIT_013_SIGNATURE_PARSED', Boolean(s.audit013), s.audit013);
  add('BRIDGE_ACQUIRE_LEGACY_SIGNATURE_MATCH', s.bridgeAcquireLegacy && s.bridgeAcquireLegacy===s.acquire013, `${s.bridgeAcquireLegacy} <> ${s.acquire013}`);
  add('BRIDGE_AUDIT_LEGACY_SIGNATURE_MATCH', s.bridgeAuditLegacy && s.bridgeAuditLegacy===s.audit013, `${s.bridgeAuditLegacy} <> ${s.audit013}`);
  add('BRIDGE_ACQUIRE_TARGET_MATCHES_014', s.bridgeAcquireTarget && s.bridgeAcquireTarget===s.acquire014, `${s.bridgeAcquireTarget} <> ${s.acquire014}`);
  add('BRIDGE_AUDIT_TARGET_MATCHES_014', s.bridgeAuditTarget && s.bridgeAuditTarget===s.audit014, `${s.bridgeAuditTarget} <> ${s.audit014}`);
  add('ACQUIRE_ABSENT_FAIL_CLOSED', c.acquireAbsentRaises);
  add('AUDIT_ABSENT_FAIL_CLOSED', c.auditAbsentRaises);
  add('ACQUIRE_UNKNOWN_FAIL_CLOSED', c.acquireUnknownRaises);
  add('AUDIT_UNKNOWN_FAIL_CLOSED', c.auditUnknownRaises);
  add('ACQUIRE_BRIDGE_BODY_FAIL_CLOSED', c.acquireBodyFailClosed);
  add('AUDIT_BRIDGE_BODY_FAIL_CLOSED', c.auditBodyFailClosed);
  add('NO_DROP_CASCADE', !c.dropCascadePresent);
  add('MIGRATION_ORDER_VALID', c.orderingValid);
  add('MIGRATION_017B_AFTER_015', c.migration017bAfter015 && c.compat015For017b);
  for (const cr of result.caseResults) add(cr.id, cr.pass, `${cr.observedAction} != ${cr.expectedAction}`);
  return a;
}
