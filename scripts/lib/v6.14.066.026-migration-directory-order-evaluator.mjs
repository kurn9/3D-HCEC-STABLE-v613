import fs from 'node:fs';
import path from 'node:path';

export const MIGRATION_KEYS = [
  ['013','cms_invalid_succeeded_operation_gate_unified_lineage_classification'],
  ['017a','cms_rpc_signature_bridge_pre_014'],
  ['014','cms_full_history_lineage_scan_nonrepairable_gate_and_resolved_error_status'],
  ['015','cms_rpc_signature_compatibility_legacy_audit_lineage_and_resolved_error_completion'],
  ['017b','cms_release_lineage_canonical_migration_recovery'],
];

export function migrationDir(root) { return path.join(root, 'supabase', 'migrations'); }
export function parseTimestamp(name) { const m = String(name).match(/^(\d{14})_/); return m ? m[1] : ''; }
export function keyForName(name) { const hit = MIGRATION_KEYS.find(([,slug]) => String(name).includes(slug)); return hit ? hit[0] : ''; }

export function evaluateMigrationDirectoryOrder(root) {
  const dir = migrationDir(root);
  const errors = [];
  let entries = [];
  try { entries = fs.readdirSync(dir).filter((n) => n.endsWith('.sql')); }
  catch (err) { return { directory: dir, entries: [], relevantEntries: [], observedOrder: [], expectedOrder: MIGRATION_KEYS.map(([k])=>k), orderValid: false, errors: [`MIGRATION_DIR_READ_FAILED:${err.message}`] }; }
  const relevantEntries = entries.map((name) => ({ name, key: keyForName(name), timestamp: parseTimestamp(name) })).filter((e) => e.key);
  for (const [key] of MIGRATION_KEYS) {
    const matches = relevantEntries.filter((e) => e.key === key);
    if (matches.length !== 1) errors.push(`RELEVANT_MIGRATION_${key}_COUNT_${matches.length}`);
  }
  const timestamps = new Map();
  for (const e of relevantEntries) {
    if (!e.timestamp) errors.push(`TIMESTAMP_PARSE_FAILED:${e.name}`);
    if (timestamps.has(e.timestamp)) errors.push(`DUPLICATE_TIMESTAMP:${e.timestamp}`);
    timestamps.set(e.timestamp, e.name);
  }
  const observedOrder = [...relevantEntries].sort((a,b) => a.timestamp.localeCompare(b.timestamp)).map((e) => e.key);
  const expectedOrder = MIGRATION_KEYS.map(([k]) => k);
  const orderValid = errors.length === 0 && observedOrder.join('|') === expectedOrder.join('|');
  if (!orderValid && observedOrder.length) errors.push(`ORDER_OBSERVED_${observedOrder.join('_')}`);
  return { directory: dir, entries, relevantEntries, observedOrder, expectedOrder, orderValid, errors };
}
