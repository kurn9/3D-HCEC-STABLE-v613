import {
  buildReleasePointer,
  createStableRepairReleaseId,
  getLegacyVersionPath,
  getReleaseContentPath,
  isUuid,
  validateReleasePointer,
} from '../supabase/functions/_shared/cmsReleaseContract.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('v6.14.066.036 UUID and canonical path runtime contract', async () => {
  const standardUuid = '123e4567-e89b-12d3-a456-426614174000';
  assert(isUuid(standardUuid), 'standard 8-4-4-4-12 UUID must be accepted');
  const releaseId = await createStableRepairReleaseId(
    'f7ac2561-305b-4381-b778-511b622d42fd',
    'b8ec5d8f05c91b12283168675fc26b88c8377cce1be7e1f1525e9c5dbab805c3',
    'V6.11.21-B6-F_K_O_I_P',
  );
  assert(isUuid(releaseId), 'stable repair release ID must be valid UUID');
  const contentPath = getReleaseContentPath(releaseId);
  const legacyVersionPath = getLegacyVersionPath(releaseId);
  assert(contentPath.length > 0, 'canonical content path must not be empty');
  assert(legacyVersionPath.length > 0, 'legacy version path must not be empty');
  const pointer = buildReleasePointer({
    releaseId,
    contentPath,
    legacyVersionPath,
    contentHash: 'b8ec5d8f05c91b12283168675fc26b88c8377cce1be7e1f1525e9c5dbab805c3',
    candidateHash: 'b8ec5d8f05c91b12283168675fc26b88c8377cce1be7e1f1525e9c5dbab805c3',
    draftId: 'draft-uat',
    draftUpdatedAt: '2026-06-25T00:00:00.000Z',
    draftVersion: 'V6.11.21-B6-F_K_O_I_P',
    publishedAt: '2026-06-25T00:00:00.000Z',
  });
  assert(validateReleasePointer(pointer).valid, 'valid canonical pointer must be accepted');
});
