#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.argv.find((arg) => arg.startsWith("--root="))?.slice(
  "--root=".length,
) || process.cwd();
const moduleRel = "supabase/functions/_shared/cmsCanonicalPointerRepair.ts";
const testRel = "scripts/test-036-1.ts";

const mutations = [
  {
    id: "M001_READ_FAILED_STATUS_TO_200",
    file: moduleRel,
    search: `if (pointerHealth.classification === "read_failed") {
    return {
      status: 500,
      body: {
        ok: false,
        mode: "status",
        ...buildPointerHealthStatusResponse(pointerHealth),
      },
    };
  }`,
    replacement: `if (pointerHealth.classification === "read_failed") {
    return {
      status: 200,
      body: {
        ok: true,
        mode: "status",
        ...buildPointerHealthStatusResponse(pointerHealth),
      },
    };
  }`,
  },
  {
    id: "M002_READ_FAILED_APPLY_TO_409",
    file: moduleRel,
    search: `return createRepairError(message, code, 500, {
    classification: "read_failed",
    ...details,
  });`,
    replacement: `return createRepairError(message, code, 409, {
    classification: "read_failed",
    ...details,
  });`,
  },
  {
    id: "M003_WRITE_BEFORE_POST_LOCK_GATE",
    file: moduleRel,
    search: `const postLockPlan = await createCanonicalPointerRepairPlan(adapters, {`,
    replacement: `await adapters.writeTextObject("pre_lock_illegal_probe.json", "{}", {
      upsert: false,
      cacheControl: "0",
    });
    const postLockPlan = await createCanonicalPointerRepairPlan(adapters, {`,
  },
  {
    id: "M004_REMOVE_POST_LOCK_SOURCE_REREAD",
    file: moduleRel,
    search: `const postLockPlan = await createCanonicalPointerRepairPlan(adapters, {
      sourceAuditLogId: plan.sourceAuditLogId,
      sourceVersionPath: plan.sourceVersionPath,
      expectedSourceHash: plan.sourceHash,
      expectedPublishedVersion: plan.publishedVersion,
    }, { skipLineageGate: true, allowedActiveOperationId: operation.id });`,
    replacement: `const postLockPlan = plan;`,
  },
  {
    id: "M005_REMOVE_POST_LOCK_PLAN_COMPARISON",
    file: moduleRel,
    search: `if (postLockPlan.planHash !== plan.planHash) {`,
    replacement: `if (false && postLockPlan.planHash !== plan.planHash) {`,
  },
  {
    id: "M006_REUSE_DIFFERENT_BYTES",
    file: moduleRel,
    search: `if (existing.text === text && existingHash === expectedHash) {
    return { reused: true };
  }
  throw conflict(
    \`Immutable object already exists with different bytes: \${path}\`,
    code.replace(/WRITE_FAILED$/, "IMMUTABLE_CONFLICT"),
    {
      classification: "immutable_object_conflict",
      path,
      existingHash,
      expectedHash,
    },
  );`,
    replacement: `if (existing.text === text && existingHash === expectedHash) {
    return { reused: true };
  }
  return { reused: true };`,
  },
  {
    id: "M007_IMMUTABLE_CONFLICT_TO_500",
    file: moduleRel,
    search: `throw conflict(
    \`Immutable object already exists with different bytes: \${path}\`,
    code.replace(/WRITE_FAILED$/, "IMMUTABLE_CONFLICT"),
    {
      classification: "immutable_object_conflict",
      path,
      existingHash,
      expectedHash,
    },
  );`,
    replacement: `throw createRepairError(
    \`Immutable object already exists with different bytes: \${path}\`,
    code.replace(/WRITE_FAILED$/, "IMMUTABLE_CONFLICT"),
    500,
    {
      classification: "storage_write_failed",
      path,
      existingHash,
      expectedHash,
    },
  );`,
  },
  {
    id: "M008_POINTER_VERIFY_FAILURE_SUCCESS",
    file: moduleRel,
    search: `if (!pointerVerify.valid) {`,
    replacement: `if (false && !pointerVerify.valid) {`,
  },
  {
    id: "M009_REMOVE_OPERATION_FINALIZATION",
    file: moduleRel,
    search: `if (operation?.id) {
      await adapters.finalizeOperationFailure({
        operationId: operation.id,
        pointerWriteStarted,
        contentHash: plan.contentHash,
        contentPath: plan.contentPath,
        expectedReleaseId: plan.releaseId,
        error,
      });
    }`,
    replacement: `if (false && operation?.id) {
      await adapters.finalizeOperationFailure({
        operationId: operation.id,
        pointerWriteStarted,
        contentHash: plan.contentHash,
        contentPath: plan.contentPath,
        expectedReleaseId: plan.releaseId,
        error,
      });
    }`,
  },
  {
    id: "M010_TERMINAL_AUDIT_FAILURE_OK_TRUE",
    file: moduleRel,
    search: `ok: false,
          classification: "lineage_repair_required",`,
    replacement: `ok: true,
          classification: "lineage_repair_required",`,
  },
];

function sha(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}
function copyIntoTemp(tmp) {
  for (
    const rel of [
      "supabase/functions/_shared/cmsCanonicalPointerRepair.ts",
      "supabase/functions/_shared/cmsReleaseContract.ts",
      "supabase/functions/_shared/cmsReleaseOperation.ts",
      "supabase/functions/_shared/cmsReleaseAudit.ts",
      "scripts/test-036-1.ts",
    ]
  ) {
    const source = path.join(root, rel);
    const target = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

const records = [];
for (const mutation of mutations) {
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), `mutate-036-1-${mutation.id}-`),
  );
  copyIntoTemp(tmp);
  const target = path.join(tmp, mutation.file);
  const before = fs.readFileSync(target, "utf8");
  const replacementCount = before.split(mutation.search).length - 1;
  const after = before.replace(mutation.search, mutation.replacement);
  fs.writeFileSync(target, after);
  const sourceChanged = sha(before) !== sha(after);
  const deno = spawnSync("deno", ["test", "--frozen", testRel], {
    cwd: tmp,
    encoding: "utf8",
  });
  const output = `${deno.stdout}\n${deno.stderr}`;
  const killed = replacementCount === 1 && sourceChanged && deno.status !== 0;
  records.push({
    id: mutation.id,
    target: mutation.file,
    replacementCount,
    expectedReplacementCount: 1,
    sourceHashBefore: sha(before),
    sourceHashAfter: sha(after),
    sourceChanged,
    exitCode: deno.status,
    failedAsExpected: killed,
    outputTail: output.slice(-3000),
    status: killed ? "KILLED" : "SURVIVED",
  });
  fs.rmSync(tmp, { recursive: true, force: true });
}
const killed = records.filter((record) => record.status === "KILLED").length;
const result = {
  killed,
  survived: records.length - killed,
  total: records.length,
  records,
};
console.log(JSON.stringify(result, null, 2));
if (result.survived) process.exit(1);
