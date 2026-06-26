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
const denoArgs = ["test", "--frozen", "--node-modules-dir=auto", testRel];
const runTimeoutMs = Number(
  process.argv.find((arg) => arg.startsWith("--timeout-ms="))?.slice(
    "--timeout-ms=".length,
  ) || 120000,
);

const requiredTempFiles = [
  "package.json",
  "package-lock.json",
  "deno.lock",
  "supabase/functions/_shared/cmsCanonicalPointerRepair.ts",
  "supabase/functions/_shared/cmsReleaseContract.ts",
  "supabase/functions/_shared/cmsReleaseOperation.ts",
  "supabase/functions/_shared/cmsReleaseAudit.ts",
  "scripts/test-036-1.ts",
];
const rootHashFiles = [...requiredTempFiles, "scripts/mutate-036-1.mjs"];

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

function shaFile(rel) {
  return sha(fs.readFileSync(path.join(root, rel)));
}

function snapshotRootHashes() {
  return Object.fromEntries(
    rootHashFiles.map((rel) => [rel, fs.existsSync(path.join(root, rel)) ? shaFile(rel) : null]),
  );
}

function copyFileIntoTemp(tmp, rel) {
  const source = path.join(root, rel);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing required file for mutation temp workspace: ${rel}`);
  }
  const target = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyIntoTemp(tmp) {
  for (const rel of requiredTempFiles) copyFileIntoTemp(tmp, rel);
}

function runDenoTest(cwd) {
  const deno = spawnSync("deno", denoArgs, {
    cwd,
    encoding: "utf8",
    timeout: runTimeoutMs,
  });
  const output = `${deno.stdout || ""}\n${deno.stderr || ""}`;
  return {
    status: deno.status,
    signal: deno.signal,
    error: deno.error ? String(deno.error.message || deno.error) : null,
    stdout: deno.stdout || "",
    stderr: deno.stderr || "",
    output,
    outputTail: output.slice(-5000),
  };
}

function hasInfraSignature(run) {
  const text = `${run.error || ""}\n${run.output || ""}`.toLowerCase();
  return Boolean(
    run.error ||
      run.status === null ||
      run.signal === "SIGTERM" ||
      text.includes("lockfile is out of date") ||
      text.includes("could not find a matching package") ||
      text.includes("node_modules directory") ||
      text.includes("module not found") ||
      text.includes("cannot resolve") ||
      text.includes("failed to resolve") ||
      text.includes("no such file") ||
      text.includes("deno executable not found") ||
      text.includes("enoent") ||
      text.includes("permission denied") ||
      text.includes("timed out") ||
      text.includes("timeout"),
  );
}

function hasBaselinePassOutput(run) {
  return /21\s+passed/i.test(run.output) && /0\s+failed/i.test(run.output);
}

function createTemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTemp(tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function runControl() {
  const tmp = createTemp("mutate-036-1-control-");
  try {
    copyIntoTemp(tmp);
    const run = runDenoTest(tmp);
    const infraError = hasInfraSignature(run);
    const pass = !infraError && run.status === 0 && hasBaselinePassOutput(run);
    return {
      classification: pass ? "BASELINE_VALID" : "BASELINE_INVALID",
      pass,
      exitCode: run.status,
      signal: run.signal,
      error: run.error,
      outputTail: run.outputTail,
      command: ["deno", ...denoArgs].join(" "),
      infraError,
      expectedOutput: "21 passed / 0 failed",
    };
  } catch (error) {
    return {
      classification: "BASELINE_INVALID",
      pass: false,
      exitCode: null,
      signal: null,
      error: error instanceof Error ? error.message : String(error),
      outputTail: "",
      command: ["deno", ...denoArgs].join(" "),
      infraError: true,
      expectedOutput: "21 passed / 0 failed",
    };
  } finally {
    cleanupTemp(tmp);
  }
}

const rootHashesBefore = snapshotRootHashes();
const control = runControl();

if (!control.pass) {
  const rootHashesAfter = snapshotRootHashes();
  const result = {
    control,
    controlPass: false,
    controlExitCode: control.exitCode,
    controlOutputTail: control.outputTail,
    classification: "BASELINE_INVALID",
    killed: 0,
    survived: 0,
    invalid: 0,
    infraErrors: control.infraError ? 1 : 0,
    total: 0,
    records: [],
    rootHashesBefore,
    rootHashesAfter,
    rootHashesStable: JSON.stringify(rootHashesBefore) === JSON.stringify(rootHashesAfter),
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}

const records = [];
for (const mutation of mutations) {
  const tmp = createTemp(`mutate-036-1-${mutation.id}-`);
  try {
    copyIntoTemp(tmp);
    const target = path.join(tmp, mutation.file);
    if (!fs.existsSync(target)) {
      records.push({
        id: mutation.id,
        target: mutation.file,
        replacementCount: 0,
        expectedReplacementCount: 1,
        sourceHashBefore: null,
        sourceHashAfter: null,
        sourceChanged: false,
        exitCode: null,
        classification: "INVALID_MUTATION",
        failedAsExpected: false,
        outputTail: "Target file missing in temp workspace.",
        status: "INVALID_MUTATION",
      });
      continue;
    }
    const before = fs.readFileSync(target, "utf8");
    const replacementCount = before.split(mutation.search).length - 1;
    const after = before.replace(mutation.search, mutation.replacement);
    const sourceHashBefore = sha(before);
    const sourceHashAfter = sha(after);
    const sourceChanged = sourceHashBefore !== sourceHashAfter;
    if (replacementCount !== 1 || !sourceChanged) {
      records.push({
        id: mutation.id,
        target: mutation.file,
        replacementCount,
        expectedReplacementCount: 1,
        sourceHashBefore,
        sourceHashAfter,
        sourceChanged,
        exitCode: null,
        classification: "INVALID_MUTATION",
        failedAsExpected: false,
        outputTail: replacementCount !== 1
          ? `Expected exactly one replacement, found ${replacementCount}.`
          : "Mutation did not change source bytes.",
        status: "INVALID_MUTATION",
      });
      continue;
    }
    fs.writeFileSync(target, after);
    const deno = runDenoTest(tmp);
    const infraError = hasInfraSignature(deno);
    const classification = infraError
      ? "INFRA_ERROR"
      : deno.status === 0
      ? "SURVIVED"
      : "KILLED";
    records.push({
      id: mutation.id,
      target: mutation.file,
      replacementCount,
      expectedReplacementCount: 1,
      sourceHashBefore,
      sourceHashAfter,
      sourceChanged,
      exitCode: deno.status,
      signal: deno.signal,
      classification,
      failedAsExpected: classification === "KILLED",
      outputTail: deno.outputTail,
      status: classification,
    });
  } catch (error) {
    records.push({
      id: mutation.id,
      target: mutation.file,
      replacementCount: null,
      expectedReplacementCount: 1,
      sourceHashBefore: null,
      sourceHashAfter: null,
      sourceChanged: false,
      exitCode: null,
      classification: "INFRA_ERROR",
      failedAsExpected: false,
      outputTail: error instanceof Error ? error.message : String(error),
      status: "INFRA_ERROR",
    });
  } finally {
    cleanupTemp(tmp);
  }
}

const rootHashesAfter = snapshotRootHashes();
const rootHashesStable = JSON.stringify(rootHashesBefore) === JSON.stringify(rootHashesAfter);
const killed = records.filter((record) => record.classification === "KILLED").length;
const survived = records.filter((record) => record.classification === "SURVIVED").length;
const invalid = records.filter((record) => record.classification === "INVALID_MUTATION").length;
const infraErrors = records.filter((record) => record.classification === "INFRA_ERROR").length;
const result = {
  control,
  controlPass: true,
  controlExitCode: control.exitCode,
  controlOutputTail: control.outputTail,
  killed,
  survived,
  invalid,
  infraErrors,
  total: records.length,
  records,
  rootHashesBefore,
  rootHashesAfter,
  rootHashesStable,
};
console.log(JSON.stringify(result, null, 2));
const success = rootHashesStable && killed === 10 && survived === 0 &&
  invalid === 0 && infraErrors === 0 && records.length === 10;
if (!success) process.exit(1);
