import {
  REPAIR_CONFIRMATION,
  executeCanonicalPointerRepair,
  createCanonicalPointerRepairPlan,
  type CanonicalPointerRepairAdapters,
  type JsonObject,
} from '../supabase/functions/_shared/cmsCanonicalPointerRepair.ts';
import {
  LEGACY_LATEST_PATH,
  POINTER_PATH,
  buildReleasePointer,
  canonicalJsonStringify,
  createStableRepairReleaseId,
  getLegacyVersionPath,
  getReleaseContentPath,
  isUuid,
  sha256Text,
  validateReleasePointer,
} from '../supabase/functions/_shared/cmsReleaseContract.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}
function assertIncludes(values: string[], expected: string, message: string) {
  if (!values.includes(expected)) throw new Error(`${message}: missing ${expected}; got ${values.join(', ')}`);
}

type EnvOptions = {
  pointer?: 'missing' | 'valid' | 'different' | 'invalid';
  readFailedPaths?: string[];
  missingPaths?: string[];
  writeConflictPaths?: string[];
  writeFailedPaths?: string[];
  auditReadFailed?: boolean;
  auditMissing?: boolean;
  auditPatch?: JsonObject;
  acquireFails?: boolean;
  transitionFailsAt?: string;
  terminalAuditFails?: boolean;
  afterAcquire?: (env: any) => void | Promise<void>;
};

async function createEnv(options: EnvOptions = {}) {
  const sourcePath = 'published/versions/source.json';
  const sourceObject = { source: 'cms-admin-draft', title: 'Canonical pointer repair source', items: [{ id: 'a', title: 'A' }] };
  const sourceText = canonicalJsonStringify(sourceObject);
  const sourceHash = await sha256Text(sourceText);
  const sourceAuditLogId = 'f7ac2561-305b-4381-b778-511b622d42fd';
  const publishedVersion = 'V6.11.21-B6-F_K_O_I_H_DRAFT';
  const auditRow: JsonObject = {
    id: sourceAuditLogId,
    status: 'published',
    operation_type: 'publish',
    draft_id: 'draft-1',
    version_path: sourcePath,
    hash_after: sourceHash,
    published_version: publishedVersion,
    created_at: '2026-06-21T19:40:52.000Z',
    verify_json: { hash: sourceHash, contentHash: sourceHash, hashAfter: sourceHash, releaseVerify: { hash: sourceHash }, draftUpdatedAt: '2026-06-21T19:39:00.000Z', draftVersion: '7' },
    ...(options.auditPatch || {}),
  };
  const storage = new Map<string, string>([
    [sourcePath, sourceText],
    [LEGACY_LATEST_PATH, sourceText],
  ]);
  const calls: string[] = [];
  const writes: string[] = [];
  let operationCounter = 0;
  const transitions: string[] = [];
  const finalized: string[] = [];
  const terminalAudits: string[] = [];
  const env = { sourcePath, sourceText, sourceHash, sourceAuditLogId, publishedVersion, auditRow, storage, calls, writes, transitions, finalized, terminalAudits, plan: null as null | Awaited<ReturnType<typeof createCanonicalPointerRepairPlan>> };
  const readFailedPaths = new Set(options.readFailedPaths || []);
  const missingPaths = new Set(options.missingPaths || []);
  const writeConflictPaths = new Set(options.writeConflictPaths || []);
  const writeFailedPaths = new Set(options.writeFailedPaths || []);

  const adapters: CanonicalPointerRepairAdapters = {
    async inspectLineageGate() { calls.push('inspectLineageGate'); return { classification: 'clean', repairable: false }; },
    async getActiveOperation() { calls.push('getActiveOperation'); return { operation: null }; },
    async readSourceAuditLog(id: string) {
      calls.push('readSourceAuditLog');
      if (options.auditReadFailed) return { kind: 'read_failed', error: 'database outage' };
      if (options.auditMissing || id !== sourceAuditLogId) return { kind: 'missing', error: 'not found' };
      return { kind: 'found', row: auditRow };
    },
    async readTextObject(path: string) {
      calls.push(`read:${path}`);
      if (readFailedPaths.has(path)) return { kind: 'read_failed', error: `read failed ${path}` };
      if (missingPaths.has(path) || !storage.has(path)) return { kind: 'missing', error: `missing ${path}` };
      return { kind: 'found', text: storage.get(path) || '' };
    },
    async writeTextObject(path: string, text: string) {
      calls.push(`write:${path}`);
      writes.push(path);
      if (writeFailedPaths.has(path)) return { kind: 'write_failed', error: `write failed ${path}` };
      if (writeConflictPaths.has(path) || storage.has(path)) return { kind: 'conflict', error: `conflict ${path}` };
      storage.set(path, text);
      return { kind: 'written' };
    },
    async acquireOperation(input: JsonObject) {
      calls.push('acquireOperation');
      if (options.acquireFails) throw new Error('rpc acquire failed');
      operationCounter += 1;
      await options.afterAcquire?.(env);
      return {
        id: `op-${operationCounter}`,
        lockKey: 'cms-public-current-release',
        operationType: String(input.operationType || 'publish'),
        state: 'in_progress',
        phase: 'acquired',
        actorId: String(input.actorId || ''),
        draftId: String(input.draftId || ''),
        expectedReleaseId: String(input.expectedReleaseId || ''),
        targetReleaseId: '',
        candidateHash: String(input.candidateHash || ''),
        contentHash: String(input.contentHash || ''),
        contentPath: String(input.contentPath || ''),
        pointerPath: POINTER_PATH,
        contextJson: input.contextJson || {},
        errorJson: null,
        createdAt: '2026-06-21T19:40:52.000Z',
        updatedAt: '2026-06-21T19:40:52.000Z',
        resolvedAt: '',
      };
    },
    async transitionOperation(input) {
      calls.push(`transition:${String(input.patch.phase || input.patch.state || '')}`);
      transitions.push(String(input.patch.phase || input.patch.state || ''));
      if (options.transitionFailsAt && String(input.patch.phase || input.patch.state || '') === options.transitionFailsAt) throw new Error('transition runtime failure');
      return {
        id: input.operationId,
        lockKey: 'cms-public-current-release',
        operationType: 'publish',
        state: String(input.patch.state || 'in_progress'),
        phase: String(input.patch.phase || 'acquired'),
        actorId: 'admin-1',
        draftId: 'draft-1',
        expectedReleaseId: String(input.patch.expectedReleaseId || ''),
        targetReleaseId: '',
        candidateHash: '',
        contentHash: String(input.patch.contentHash || ''),
        contentPath: String(input.patch.contentPath || ''),
        pointerPath: POINTER_PATH,
        contextJson: input.patch.contextJson || {},
        errorJson: input.patch.errorJson || null,
        createdAt: '2026-06-21T19:40:52.000Z',
        updatedAt: '2026-06-21T19:40:52.000Z',
        resolvedAt: String(input.patch.resolvedAt || ''),
      };
    },
    async finalizeOperationFailure(input) { calls.push('finalizeOperationFailure'); finalized.push(input.operationId); return { operation: null, finalState: 'failed_before_pointer' }; },
    async persistTerminalAudit() { calls.push('persistTerminalAudit'); terminalAudits.push('terminal'); return options.terminalAuditFails ? { persisted: false, auditLogState: 'missing_or_unknown', warning: 'audit failed' } : { persisted: true, auditLogState: 'present', id: 'audit-1' }; },
    async persistOperationContextPatch() { calls.push('persistOperationContextPatch'); return {}; },
    nowIso: () => '2026-06-21T19:40:52.000Z',
    sleep: async () => {},
  };
  env.plan = await createCanonicalPointerRepairPlan(adapters, { sourceAuditLogId, sourceVersionPath: sourcePath, expectedSourceHash: sourceHash, expectedPublishedVersion: publishedVersion });
  if (options.pointer === 'valid' && env.plan) {
    storage.set(env.plan.contentPath, env.plan.canonicalReleaseText);
    storage.set(POINTER_PATH, env.plan.pointerText);
  } else if (options.pointer === 'different') {
    const otherReleaseId = await createStableRepairReleaseId('other-audit', sourceHash, publishedVersion);
    const otherPath = getReleaseContentPath(otherReleaseId);
    const otherPointer = buildReleasePointer({ releaseId: otherReleaseId, contentPath: otherPath, contentHash: sourceHash, candidateHash: sourceHash, draftId: 'draft-1', draftUpdatedAt: 'x', draftVersion: '1', publishedAt: 'x' });
    storage.set(POINTER_PATH, canonicalJsonStringify(otherPointer));
    storage.set(otherPath, sourceText);
  } else if (options.pointer === 'invalid') {
    storage.set(POINTER_PATH, '{"schemaVersion":1,"releaseId":"bad"}');
  }
  return { ...env, adapters };
}

async function dryRun(env: Awaited<ReturnType<typeof createEnv>>) {
  return await executeCanonicalPointerRepair({ mode: 'repair-pointer', dryRun: true, sourceAuditLogId: env.sourceAuditLogId, sourceVersionPath: env.sourcePath, expectedSourceHash: env.sourceHash, expectedPublishedVersion: env.publishedVersion, actorId: 'admin-1' }, env.adapters);
}
async function apply(env: Awaited<ReturnType<typeof createEnv>>, planHash = env.plan?.planHash || '') {
  return await executeCanonicalPointerRepair({ mode: 'repair-pointer', dryRun: false, sourceAuditLogId: env.sourceAuditLogId, sourceVersionPath: env.sourcePath, expectedSourceHash: env.sourceHash, expectedPublishedVersion: env.publishedVersion, expectedPlanHash: planHash, confirmation: REPAIR_CONFIRMATION, actorId: 'admin-1' }, env.adapters);
}

Deno.test('standard UUID and stable repair UUID are accepted and produce non-empty paths', async () => {
  assert(isUuid('123e4567-e89b-12d3-a456-426614174000'), 'standard UUID must pass validator');
  const hash = await sha256Text('abc');
  const id = await createStableRepairReleaseId('audit-id', hash, 'v1');
  assert(isUuid(id), 'stable repair ID must be UUID');
  assert(getReleaseContentPath(id).length > 0, 'content path must be non-empty');
  assert(getLegacyVersionPath(id).length > 0, 'legacy path must be non-empty');
  const pointer = buildReleasePointer({ releaseId: id, contentPath: getReleaseContentPath(id), contentHash: hash, candidateHash: hash, draftId: 'draft', draftUpdatedAt: 'now', draftVersion: '1', publishedAt: 'now', legacyVersionPath: getLegacyVersionPath(id) });
  assert(validateReleasePointer(pointer).valid, 'pointer must validate');
});

Deno.test('status valid pointer returns 200 ok true and zero writes', async () => {
  const env = await createEnv({ pointer: 'valid' });
  const result = await executeCanonicalPointerRepair({ mode: 'status' }, env.adapters);
  assertEquals(result.status, 200, 'status');
  assertEquals(result.body.ok, true, 'ok');
  assertEquals(env.writes.length, 0, 'zero writes');
});

Deno.test('status missing pointer returns 200 blocked repairable and zero writes', async () => {
  const env = await createEnv();
  const result = await executeCanonicalPointerRepair({ mode: 'status' }, env.adapters);
  assertEquals(result.status, 200, 'status');
  assertEquals(result.body.classification, 'canonical_pointer_missing', 'classification');
  assertEquals(result.body.repairable, true, 'repairable');
  assertEquals(env.writes.length, 0, 'zero writes');
});

Deno.test('status pointer read failure returns 500 ok false', async () => {
  const env = await createEnv({ readFailedPaths: [POINTER_PATH] });
  const result = await executeCanonicalPointerRepair({ mode: 'status' }, env.adapters);
  assertEquals(result.status, 500, 'status');
  assertEquals(result.body.ok, false, 'ok false');
  assertEquals(env.writes.length, 0, 'zero writes');
});

Deno.test('dry-run returns ok true and performs zero writes', async () => {
  const env = await createEnv();
  const result = await dryRun(env);
  assertEquals(result.status, 200, 'dry-run status');
  assertEquals(result.body.ok, true, 'dry-run ok');
  assertEquals(result.body.writesPerformed, false, 'no writes flag');
  assertEquals(env.writes.length, 0, 'zero writes');
});

Deno.test('missing confirmation and plan mismatch perform zero writes', async () => {
  const env = await createEnv();
  const noConfirm = await executeCanonicalPointerRepair({ mode: 'repair-pointer', dryRun: false, sourceAuditLogId: env.sourceAuditLogId, sourceVersionPath: env.sourcePath, expectedSourceHash: env.sourceHash, expectedPublishedVersion: env.publishedVersion, expectedPlanHash: env.plan?.planHash, actorId: 'admin-1' }, env.adapters);
  assertEquals(noConfirm.status, 400, 'confirmation status');
  const mismatch = await apply(env, '0'.repeat(64));
  assertEquals(mismatch.status, 409, 'plan mismatch status');
  assertEquals(env.writes.length, 0, 'zero writes');
});

Deno.test('read failures map to HTTP 500 across pre-apply inputs', async () => {
  for (const [name, options] of [
    ['audit', { auditReadFailed: true }],
    ['source', { readFailedPaths: ['published/versions/source.json'] }],
    ['alias', { readFailedPaths: [LEGACY_LATEST_PATH] }],
  ] as Array<[string, EnvOptions]>) {
    const env = await createEnv(options);
    const result = await executeCanonicalPointerRepair({ mode: 'repair-pointer', dryRun: true, sourceAuditLogId: env.sourceAuditLogId, sourceVersionPath: env.sourcePath, expectedSourceHash: env.sourceHash, expectedPublishedVersion: env.publishedVersion, actorId: 'admin-1' }, env.adapters);
    assertEquals(result.status, 500, `${name} status`);
    assertEquals(result.body.ok, false, `${name} ok`);
  }
});

Deno.test('missing source object returns 404 and source identity conflicts return 409', async () => {
  const missing = await createEnv({ missingPaths: ['published/versions/source.json'] });
  const missingResult = await dryRun(missing);
  assertEquals(missingResult.status, 404, 'missing source status');
  const conflictEnv = await createEnv({ auditPatch: { version_path: 'different-path' } });
  const conflictResult = await dryRun(conflictEnv);
  assertEquals(conflictResult.status, 409, 'identity conflict');
});

Deno.test('missing invalid conflicting and mismatched audit hashes fail closed with 409', async () => {
  const cases: Array<[string, JsonObject]> = [
    ['missing', { hash_after: 'a'.repeat(64), verify_json: {} }],
    ['invalid', { verify_json: { hash: 'not-a-hash' } }],
    ['conflict', { verify_json: { hash: 'a'.repeat(64), contentHash: 'b'.repeat(64) } }],
    ['mismatch', { verify_json: { hash: 'a'.repeat(64) } }],
  ];
  for (const [name, patch] of cases) {
    const env = await createEnv({ auditPatch: patch });
    const result = await dryRun(env);
    assertEquals(result.status, 409, `${name} status`);
    assertEquals(result.body.ok, false, `${name} ok`);
  }
});

Deno.test('acquire runtime failure returns 500 and zero writes', async () => {
  const env = await createEnv({ acquireFails: true });
  const result = await apply(env);
  assertEquals(result.status, 500, 'status');
  assertEquals(env.writes.length, 0, 'zero writes');
});

Deno.test('post-lock source and alias drift return 409 with zero storage writes and finalize operation', async () => {
  for (const [name, hook] of [
    ['source', async (env: any) => env.storage.set(env.sourcePath, canonicalJsonStringify({ changed: true }))],
    ['alias', async (env: any) => env.storage.set(LEGACY_LATEST_PATH, canonicalJsonStringify({ changed: true }))],
    ['audit', async (env: any) => { env.auditRow.hash_after = 'a'.repeat(64); }],
  ] as const) {
    const env = await createEnv({ afterAcquire: hook });
    const result = await apply(env);
    assertEquals(result.status, 409, `${name} status`);
    assertEquals(env.writes.length, 0, `${name} zero writes`);
    assert(env.finalized.length > 0, `${name} finalized`);
  }
});

Deno.test('post-lock pointer read failure returns 500 and finalizes operation', async () => {
  const env = await createEnv();
  const originalRead = env.adapters.readTextObject;
  env.adapters.readTextObject = async (path: string) => {
    if (path === POINTER_PATH && env.calls.includes('acquireOperation')) return { kind: 'read_failed', error: 'post-lock pointer read failed' };
    return await originalRead(path);
  };
  const result = await apply(env);
  assertEquals(result.status, 500, 'status');
  assert(env.finalized.length > 0, 'finalized');
});

Deno.test('immutable exact reuse passes and different bytes return 409', async () => {
  const reuse = await createEnv();
  reuse.storage.set(reuse.plan!.contentPath, reuse.plan!.canonicalReleaseText);
  const reuseResult = await apply(reuse);
  assertEquals(reuseResult.status, 200, 'reuse status');
  const conflict = await createEnv();
  conflict.storage.set(conflict.plan!.contentPath, 'different');
  const conflictResult = await apply(conflict);
  assertEquals(conflictResult.status, 409, 'conflict status');
  assertEquals(conflictResult.body.ok, false, 'conflict ok false');
});

Deno.test('immutable existing read failures return 500 for canonical and legacy objects', async () => {
  const canonical = await createEnv({ readFailedPaths: [] });
  canonical.storage.set(canonical.plan!.contentPath, 'different');
  (canonical.adapters as unknown as { readTextObject: (path: string) => Promise<unknown> }).readTextObject = async (path: string) => {
    canonical.calls.push(`read:${path}`);
    if (path === canonical.plan!.contentPath) return { kind: 'read_failed', error: 'read existing failed' };
    if (!canonical.storage.has(path)) return { kind: 'missing', error: 'missing' };
    return { kind: 'found', text: canonical.storage.get(path) || '' };
  };
  assertEquals((await apply(canonical)).status, 500, 'canonical read failure');

  const legacy = await createEnv();
  legacy.storage.set(legacy.plan!.legacyVersionPath, 'different');
  (legacy.adapters as unknown as { readTextObject: (path: string) => Promise<unknown> }).readTextObject = async (path: string) => {
    legacy.calls.push(`read:${path}`);
    if (path === legacy.plan!.legacyVersionPath) return { kind: 'read_failed', error: 'read legacy failed' };
    if (!legacy.storage.has(path)) return { kind: 'missing', error: 'missing' };
    return { kind: 'found', text: legacy.storage.get(path) || '' };
  };
  assertEquals((await apply(legacy)).status, 500, 'legacy read failure');
});

Deno.test('pointer race and pointer write recovery classify conflicts and read failures correctly', async () => {
  const same = await createEnv({ afterAcquire: (e) => { e.storage.set(e.plan!.contentPath, e.plan!.canonicalReleaseText); e.storage.set(POINTER_PATH, e.plan!.pointerText); } });
  assertEquals((await apply(same)).status, 200, 'same pointer already repaired');

  const different = await createEnv({ pointer: 'different' });
  const differentResult = await apply(different);
  assertEquals(differentResult.status, 409, 'different pointer conflict');

  const recoveryFail = await createEnv({ writeConflictPaths: [POINTER_PATH] });
  const recoveryOriginalRead = recoveryFail.adapters.readTextObject;
  recoveryFail.adapters.readTextObject = async (path: string) => {
    if (path === POINTER_PATH && recoveryFail.writes.includes(POINTER_PATH)) return { kind: 'read_failed', error: 'pointer recovery read failed' };
    return await recoveryOriginalRead(path);
  };
  const recoveryResult = await apply(recoveryFail);
  assertEquals(recoveryResult.status, 500, 'recovery read failure maps 500');
});

Deno.test('pointer verification read failure and mismatch do not transition to success', async () => {
  const readFail = await createEnv({ readFailedPaths: [] });
  let pointerReads = 0;
  const originalRead = readFail.adapters.readTextObject;
  readFail.adapters.readTextObject = async (path: string) => {
    const result = await originalRead(path);
    if (path === POINTER_PATH && readFail.writes.includes(POINTER_PATH)) {
      pointerReads += 1;
      if (pointerReads >= 1) return { kind: 'read_failed', error: 'pointer verify read failed' };
    }
    return result;
  };
  const result = await apply(readFail);
  assertEquals(result.status, 500, 'pointer verify read failure');
  assert(!readFail.transitions.includes('pointer_verified'), 'must not transition pointer_verified');

  const mismatch = await createEnv();
  const originalWrite = mismatch.adapters.writeTextObject;
  mismatch.adapters.writeTextObject = async (path, text, options) => {
    const r = await originalWrite(path, text, options);
    if (path === POINTER_PATH) mismatch.storage.set(POINTER_PATH, canonicalJsonStringify({ schemaVersion: 1, releaseId: '123e4567-e89b-12d3-a456-426614174000', contentPath: getReleaseContentPath('123e4567-e89b-12d3-a456-426614174000'), contentHash: 'a'.repeat(64) }));
    return r;
  };
  assertEquals((await apply(mismatch)).status, 409, 'pointer verify mismatch');
});

Deno.test('operation transition runtime failure returns 500', async () => {
  const env = await createEnv({ transitionFailsAt: 'release_write' });
  const result = await apply(env);
  assertEquals(result.status, 500, 'transition failure status');
});

Deno.test('terminal audit failure returns 409 ok false lineage repair required', async () => {
  const env = await createEnv({ terminalAuditFails: true });
  const result = await apply(env);
  assertEquals(result.status, 409, 'status');
  assertEquals(result.body.ok, false, 'ok false');
  assertEquals(result.body.classification, 'lineage_repair_required', 'classification');
});

Deno.test('happy path writes after post-lock barrier and succeeds', async () => {
  const env = await createEnv();
  const result = await apply(env);
  assertEquals(result.status, 200, 'status');
  assertEquals(result.body.ok, true, 'ok');
  assertIncludes(env.calls, 'acquireOperation', 'acquire called');
  const acquireIndex = env.calls.indexOf('acquireOperation');
  const firstWrite = env.calls.findIndex((call) => call.startsWith('write:'));
  assert(firstWrite > acquireIndex, 'write must happen after acquire/post-lock phase');
  assertIncludes(env.transitions, 'pointer_verified', 'pointer success transition');
  assertEquals(env.terminalAudits.length, 1, 'terminal audit once');
});

Deno.test('retry already repaired does not duplicate writes or terminal audit', async () => {
  const env = await createEnv({ pointer: 'valid' });
  const result = await apply(env);
  assertEquals(result.status, 200, 'status');
  assertEquals(env.writes.length, 0, 'no writes');
});

Deno.test('runtime failure responses never contain ok true', async () => {
  for (const options of [
    { readFailedPaths: [POINTER_PATH] },
    { auditReadFailed: true },
    { acquireFails: true },
  ] as EnvOptions[]) {
    const env = await createEnv(options);
    const result = await (options.readFailedPaths ? executeCanonicalPointerRepair({ mode: 'status' }, env.adapters) : apply(env));
    assertEquals(result.status, 500, 'runtime status');
    assertEquals(result.body.ok, false, 'runtime ok false');
  }
});
