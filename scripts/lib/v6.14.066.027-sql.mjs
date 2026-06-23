import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const RELEVANT = {
  m013: /066_013.*\.sql$/,
  m017a: /066_017a.*\.sql$/,
  m014: /066_014.*\.sql$/,
  m015: /066_015.*\.sql$/,
  m017b: /066_017b.*\.sql$/,
};
const EXPECTED_ORDER = ['m013','m017a','m014','m015','m017b'];

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function stripSqlComments(sql = '') {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < sql.length) {
    const ch = sql[i], next = sql[i + 1];
    if (!quote && ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (!quote && ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    if (ch === "'" && quote !== '$') {
      out += ch;
      if (quote === "'") {
        if (next === "'") { out += next; i += 2; continue; }
        quote = null;
      } else if (!quote) quote = "'";
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function normalizeType(text = '') {
  return String(text).toLowerCase()
    .replace(/timestamp\s+with\s+time\s+zone/g, 'timestamptz')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/table\(\s*/g, 'table(')
    .replace(/\s*\)$/g, ')')
    .trim();
}

function extractVar(sql, name) {
  const re = new RegExp(`${name}\\s+text\\s*:=\\s*'([^']+)'`, 'i');
  const m = sql.match(re);
  if (!m) return '';
  return normalizeType(m[1]);
}

function extractReturnsTable(sql, functionName) {
  const lower = sql.toLowerCase();
  const idx = lower.indexOf(`function public.${functionName.toLowerCase()}`);
  if (idx < 0) return '';
  const rt = lower.indexOf('returns table', idx);
  if (rt < 0) return '';
  const open = sql.indexOf('(', rt);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) return normalizeType(`TABLE(${sql.slice(open + 1, i)})`);
    }
  }
  return '';
}

function enumerateMigrationFiles(root) {
  const dir = path.join(root, 'supabase/migrations');
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort() : [];
  const relevant = [];
  for (const name of entries) {
    const key = Object.entries(RELEVANT).find(([, re]) => re.test(name))?.[0];
    if (key) relevant.push({ key, name, rel: `supabase/migrations/${name}`, ts: Number((name.match(/^(\d+)/) || [null, NaN])[1]) });
  }
  return { dir, entries, relevant };
}

function branch(sql, conditionNeedle, messageNeedle) {
  const clean = stripSqlComments(sql);
  const lower = clean.toLowerCase();
  const cond = conditionNeedle.toLowerCase();
  const msg = messageNeedle.toLowerCase();
  const details = [];
  let pos = 0;
  while ((pos = lower.indexOf(cond, pos)) >= 0) {
    const end = lower.indexOf('end if;', pos);
    const body = end >= 0 ? clean.slice(pos, end) : clean.slice(pos, pos + 900);
    const bodyLower = body.toLowerCase();
    const raiseException = bodyLower.includes('raise exception') && bodyLower.includes(msg);
    const inertMessage = (bodyLower.includes('perform') || bodyLower.includes('raise notice') || bodyLower.includes(':=') || bodyLower.includes('=')) && bodyLower.includes(msg) && !raiseException;
    details.push({ ifConditionFound: true, raiseExceptionFound: raiseException, messageMatched: bodyLower.includes(msg), inertMessage });
    pos += cond.length;
  }
  return {
    ifConditionFound: details.length === 1,
    raiseExceptionFound: details.length === 1 && details[0].raiseExceptionFound,
    messageMatched: details.length === 1 && details[0].messageMatched,
    uniqueBranch: details.length === 1,
    inertMessage: details.some((d) => d.inertMessage),
    branchCount: details.length,
  };
}


function splitTopLevelDoBlocks(sql = '') {
  const clean = stripSqlComments(sql);
  const blocks = [];
  const re = /\bdo\s+\$\$[\s\S]*?end\s+\$\$/gi;
  let match;
  while ((match = re.exec(clean))) blocks.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  return blocks;
}

function countMatchingRaises(text, messageNeedle) {
  const lower = text.toLowerCase();
  const msg = messageNeedle.toLowerCase();
  const raiseRe = new RegExp(`raise\\s+exception\\s+'${msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
  return (lower.match(raiseRe) || []).length;
}

function extractIfChainBlock(text, ifNeedle) {
  const lower = text.toLowerCase();
  const start = lower.indexOf(ifNeedle.toLowerCase());
  if (start < 0) return '';
  const end = lower.indexOf('end if;', start);
  return end >= 0 ? text.slice(start, end + 'end if;'.length) : '';
}

function extractElseBlock(ifBlock) {
  const lower = ifBlock.toLowerCase();
  const elsePos = lower.lastIndexOf('else');
  const endPos = lower.lastIndexOf('end if;');
  if (elsePos < 0 || endPos < 0 || elsePos > endPos) return '';
  return ifBlock.slice(elsePos, endPos);
}

function operationalUnknownBranch(sql, ifNeedle, messageNeedle) {
  const clean = stripSqlComments(sql);
  const blocks = splitTopLevelDoBlocks(sql);
  const operationalBlocks = blocks.filter((block) => block.text.toLowerCase().includes(ifNeedle.toLowerCase()));
  const operational = operationalBlocks[0]?.text || clean;
  const ifBlock = extractIfChainBlock(operational, ifNeedle);
  const elseBlock = extractElseBlock(ifBlock);
  const globalMatchingRaiseCount = countMatchingRaises(clean, messageNeedle);
  const operationalRaiseCount = countMatchingRaises(elseBlock, messageNeedle);
  const lowerElse = elseBlock.toLowerCase();
  const msg = messageNeedle.toLowerCase();
  const messageCountInElse = lowerElse.split(msg).length - 1;
  const inertMessage = messageCountInElse > operationalRaiseCount || ((lowerElse.includes('perform') || lowerElse.includes('raise notice') || lowerElse.includes(':=')) && lowerElse.includes(msg) && operationalRaiseCount === 0);
  const result = {
    doBlockCount: operationalBlocks.length,
    decisionChainFound: Boolean(ifBlock),
    unknownElseFound: Boolean(elseBlock),
    operationalRaiseCount,
    globalMatchingRaiseCount,
    unrelatedMatchingRaiseCount: Math.max(0, globalMatchingRaiseCount - operationalRaiseCount),
    ifConditionFound: Boolean(ifBlock),
    raiseExceptionFound: operationalRaiseCount === 1,
    messageMatched: messageCountInElse >= 1,
    uniqueBranch: operationalBlocks.length === 1 && Boolean(ifBlock) && Boolean(elseBlock) && operationalRaiseCount === 1 && globalMatchingRaiseCount === 1,
    inertMessage,
    branchCount: globalMatchingRaiseCount,
  };
  result.pass = result.uniqueBranch && result.raiseExceptionFound;
  return result;
}

function bridgeBody(sql, functionNeedle, messageNeedle) {
  const clean = stripSqlComments(sql);
  const lower = clean.toLowerCase();
  const fn = functionNeedle.toLowerCase();
  const msg = messageNeedle.toLowerCase();
  let count = 0;
  let operational = 0;
  let inert = 0;
  let pos = 0;
  while ((pos = lower.indexOf(fn, pos)) >= 0) {
    const body = lower.slice(pos, lower.indexOf('$fn$;', pos) > 0 ? lower.indexOf('$fn$;', pos) : pos + 1600);
    if (body.includes(msg)) {
      count += 1;
      if (body.includes('raise exception') && body.includes(msg)) operational += 1;
      if ((body.includes('perform') || body.includes('raise notice') || body.includes(':=')) && body.includes(msg) && !body.includes('raise exception')) inert += 1;
    }
    pos += fn.length;
  }
  return { ifConditionFound: true, raiseExceptionFound: operational === 1, messageMatched: count >= 1, uniqueBranch: operational === 1 && count === 1, inertMessage: inert > 0, branchCount: count };
}

function actionForCase(testCase, contracts) {
  const { rpc, observed } = testCase;
  if (observed === 'actual013') return contracts[`${rpc}LegacyMatches`] ? 'recreate_target' : 'signature_mismatch';
  if (observed === 'target014') return contracts[`${rpc}TargetMatches`] ? 'noop_target' : 'signature_mismatch';
  if (observed === 'absent') return contracts.branches[`${rpc}Absent`]?.raiseExceptionFound ? 'raise_absent' : 'missing_raise';
  if (observed === 'unknown' || observed === 'unknownColumnOrder' || observed === 'unknownOutputType') return contracts.branches[`${rpc}Unknown`]?.raiseExceptionFound ? 'raise_unknown' : 'missing_raise';
  if (observed === 'targetAligns014') return contracts[`${rpc}TargetMatches014`] ? 'target_signature_aligns_014' : 'target_signature_mismatch_014';
  if (observed === 'bridgeBody') return contracts.branches[`${rpc}Bridge`]?.raiseExceptionFound ? 'bridge_body_fail_closed' : 'bridge_body_open';
  if (observed === 'migrationOrder') return contracts.orderingValid ? 'ordering_valid' : 'ordering_invalid';
  if (observed === 'dropCascade') return contracts.dropCascadePresent ? 'drop_cascade_present' : 'no_drop_cascade';
  if (observed === '017bAfter015') return contracts.migration017bAfter015 ? '017b_after_015' : '017b_order_invalid';
  return 'unknown_case';
}

export function evaluateMigrationSource(root, fixtureCases = []) {
  const enumeration = enumerateMigrationFiles(root);
  const errors = [];
  const byKey = {};
  for (const key of EXPECTED_ORDER) {
    const matches = enumeration.relevant.filter((item) => item.key === key);
    if (matches.length !== 1) errors.push(`${key}_COUNT_${matches.length}`);
    else byKey[key] = matches[0];
  }
  const files = {};
  for (const [key, item] of Object.entries(byKey)) {
    const abs = path.join(root, item.rel);
    files[key] = { ...item, abs, text: fs.readFileSync(abs, 'utf8'), sha256: sha256File(abs), byteLength: fs.statSync(abs).size };
  }
  const orderKeys = enumeration.relevant.slice().sort((a,b) => a.ts - b.ts || a.name.localeCompare(b.name)).map((item) => item.key);
  const timestampDupes = new Set();
  const seenTs = new Set();
  for (const item of enumeration.relevant) { if (seenTs.has(item.ts)) timestampDupes.add(item.ts); seenTs.add(item.ts); }
  const orderingValid = EXPECTED_ORDER.every((key, idx) => orderKeys[idx] === key) && enumeration.relevant.length === EXPECTED_ORDER.length && timestampDupes.size === 0;
  const migration017bAfter015 = Boolean(byKey.m017b && byKey.m015 && byKey.m017b.ts > byKey.m015.ts);
  const combinedClean = Object.values(files).map((f) => stripSqlComments(f.text)).join('\n');
  const dropCascadePresent = /drop\s+function[\s\S]{0,140}\bcascade\b/i.test(combinedClean);
  const bridgeSql = files.m017a?.text || '';
  const sql014 = files.m014?.text || '';
  const signatures = {
    acquire013: extractVar(bridgeSql, 'v_acquire_013'),
    audit013: extractVar(bridgeSql, 'v_audit_013'),
    bridgeAcquireTarget: extractVar(bridgeSql, 'v_acquire_target'),
    bridgeAuditTarget: extractVar(bridgeSql, 'v_audit_target'),
    acquire014: extractReturnsTable(sql014, 'acquire_cms_release_operation'),
    audit014: extractReturnsTable(sql014, 'ensure_cms_terminal_operation_audit'),
  };
  const branches = {
    acquireAbsent: branch(bridgeSql, 'if v_acquire is null then', 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: acquire_cms_release_operation(jsonb) absent'),
    acquireUnknown: operationalUnknownBranch(bridgeSql, 'if v_acquire_result = v_acquire_013 then', 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: acquire_cms_release_operation(jsonb) observed'),
    auditAbsent: branch(bridgeSql, 'if v_audit is null then', 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: ensure_cms_terminal_operation_audit(uuid,text,jsonb,jsonb) absent'),
    auditUnknown: operationalUnknownBranch(bridgeSql, 'if v_audit_result = v_audit_013 then', 'CMS_RELEASE_RPC_BRIDGE_UNKNOWN_STATE: ensure_cms_terminal_operation_audit(uuid,text,jsonb,jsonb) observed'),
    acquireBridge: bridgeBody(bridgeSql, 'create function public.acquire_cms_release_operation', 'CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION: acquire bridge body'),
    auditBridge: bridgeBody(bridgeSql, 'create function public.ensure_cms_terminal_operation_audit', 'CMS_RELEASE_RPC_BRIDGE_PENDING_CANONICAL_MIGRATION: audit bridge body'),
  };
  const contracts = {
    acquireLegacyMatches: Boolean(signatures.acquire013 && /classification text/.test(signatures.acquire013)),
    auditLegacyMatches: Boolean(signatures.audit013 && /operation_id uuid/.test(signatures.audit013)),
    acquireTargetMatches: Boolean(signatures.bridgeAcquireTarget && signatures.bridgeAcquireTarget.includes('code text') && signatures.bridgeAcquireTarget.includes('repairable boolean')),
    auditTargetMatches: Boolean(signatures.bridgeAuditTarget && signatures.bridgeAuditTarget.includes('audit_log_state text')),
    acquireTargetMatches014: Boolean(signatures.bridgeAcquireTarget && signatures.acquire014 && signatures.bridgeAcquireTarget === signatures.acquire014),
    auditTargetMatches014: Boolean(signatures.bridgeAuditTarget && signatures.audit014 && signatures.bridgeAuditTarget === signatures.audit014),
    branches,
    orderingValid,
    migration017bAfter015,
    dropCascadePresent,
  };
  for (const [name, state] of Object.entries(branches)) {
    if (!state.uniqueBranch) errors.push(`${name}_BRANCH_NOT_UNIQUE`);
    if (!state.raiseExceptionFound) errors.push(`${name}_RAISE_EXCEPTION_MISSING`);
    if (state.inertMessage) errors.push(`${name}_INERT_MESSAGE`);
  }
  if (!orderingValid) errors.push('MIGRATION_ORDER_INVALID');
  if (!migration017bAfter015) errors.push('MIGRATION_017B_AFTER_015_INVALID');
  if (dropCascadePresent) errors.push('DROP_CASCADE_PRESENT');
  const caseResults = fixtureCases.map((item) => {
    const observedAction = actionForCase(item, contracts);
    return { id: item.id, rpc: item.rpc, observed: item.observed, expectedAction: item.expectedAction, observedAction, pass: observedAction === item.expectedAction };
  });
  return {
    migrationDirectoryEntries: enumeration.entries,
    migrationRelevantEntries: enumeration.relevant.map(({ key, name, ts }) => ({ key, name, ts })),
    migrationOrderObserved: orderKeys,
    migrationOrderExpected: EXPECTED_ORDER,
    migrationOrderValid: orderingValid,
    migrationFiles: Object.values(files).map((f) => ({ relativePath: f.rel, sha256: f.sha256, byteLength: f.byteLength })),
    signatures,
    sourceContracts: { ...contracts, branches: undefined },
    branches,
    errors,
    caseResults,
  };
}
