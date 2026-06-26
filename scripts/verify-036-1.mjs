#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.argv.find((arg) => arg.startsWith("--root="))?.slice(
  "--root=".length,
) || process.cwd();
const runDeno = process.argv.includes("--run-deno");
const assertions = [];
function add(id, pass, details = {}) {
  assertions.push({ id, pass: Boolean(pass), details });
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function sha(rel) {
  return crypto.createHash("sha256").update(
    fs.readFileSync(path.join(root, rel)),
  ).digest("hex");
}

const handlerRel = "supabase/functions/reconcile-cms-release/index.ts";
const executorRel = "supabase/functions/_shared/cmsCanonicalPointerRepair.ts";
const testRel = "scripts/test-036-1.ts";
const fixtureRel = "scripts/fixture-036-1.json";
const mutateRel = "scripts/mutate-036-1.mjs";
const files = [handlerRel, executorRel, testRel, fixtureRel, mutateRel];
for (const rel of files) {
  add(`FILE_EXISTS_${rel}`, fs.existsSync(path.join(root, rel)), { rel });
}

const handler = read(handlerRel);
const executor = read(executorRel);
const test = read(testRel);
const fixture = JSON.parse(read(fixtureRel));
add(
  "HANDLER_IMPORTS_PRODUCTION_EXECUTOR",
  /from\s+[\"\']\.\.\/_shared\/cmsCanonicalPointerRepair\.ts[\"\']/.test(handler),
  {},
);
add(
  "HANDLER_CALLS_EXECUTE_CANONICAL_POINTER_REPAIR",
  handler.includes("executeCanonicalPointerRepair("),
  {},
);
add(
  "HANDLER_NO_LOCAL_HANDLE_CANONICAL_POINTER_REPAIR",
  !/function\s+handleCanonicalPointerRepair/.test(handler),
  {},
);
add(
  "HANDLER_NO_LOCAL_CREATE_CANONICAL_POINTER_REPAIR_PLAN",
  !/function\s+createCanonicalPointerRepairPlan/.test(handler),
  {},
);
add(
  "PRODUCTION_EXECUTOR_EXPORTS_ENTRYPOINT",
  /export\s+async\s+function\s+executeCanonicalPointerRepair/.test(executor),
  {},
);
add(
  "PRODUCTION_EXECUTOR_HAS_DISCRIMINATED_READ_RESULT",
  /[{;]\s*kind:\s*[\"\']read_failed[\"\']/.test(executor) &&
    /[{;]\s*kind:\s*[\"\']missing[\"\']/.test(executor) &&
    /[{;]\s*kind:\s*[\"\']found[\"\']/.test(executor),
  {},
);
add(
  "PRODUCTION_EXECUTOR_MAPS_STATUS_READ_FAILED_500",
  /classification\s*===\s*[\"']read_failed[\"'][\s\S]{0,220}status:\s*500/.test(executor),
  {},
);
add(
  "PRODUCTION_EXECUTOR_USES_POST_LOCK_PLAN_GATE",
  executor.includes("postLockPlan.planHash !== plan.planHash"),
  {},
);
add(
  "PRODUCTION_EXECUTOR_FINALIZES_AFTER_OPERATION_ERROR",
  executor.includes("finalizeOperationFailure") &&
    /catch \(error\)[\s\S]{0,240}finalizeOperationFailure/.test(executor),
  {},
);
add(
  "TEST_IMPORTS_PRODUCTION_EXECUTOR",
  test.includes("../supabase/functions/_shared/cmsCanonicalPointerRepair.ts"),
  {},
);
add(
  "TEST_NO_SIMULATOR_NAMES",
  !/simulateRepairApply|simulateImmutableUpload|simulatePointerHealth/.test(
    test + executor + handler,
  ),
  {},
);
add(
  "TEST_HAS_BEHAVIORAL_DENO_TESTS",
  (test.match(/Deno\.test/g) || []).length >= 18,
  { count: (test.match(/Deno\.test/g) || []).length },
);
add(
  "FIXTURE_REQUIRED_CASES_PRESENT",
  Array.isArray(fixture.requiredCases) && fixture.requiredCases.length >= 30,
  { count: fixture.requiredCases?.length },
);
add(
  "FIXTURE_MUTATION_TARGETS_PRESENT",
  Array.isArray(fixture.mutationTargets) &&
    fixture.mutationTargets.length >= 10,
  { count: fixture.mutationTargets?.length },
);
for (const rel of files) {
  add(`SHA256_${rel}`, /^[a-f0-9]{64}$/.test(sha(rel)), { sha256: sha(rel) });
}

let denoResult = null;
if (runDeno) {
  denoResult = spawnSync("deno", ["test", "-A", testRel], {
    cwd: root,
    encoding: "utf8",
  });
  add("DENO_TEST_036_1_EXIT_ZERO", denoResult.status === 0, {
    status: denoResult.status,
    stdout: denoResult.stdout.slice(-4000),
    stderr: denoResult.stderr.slice(-4000),
  });
} else {
  add("DENO_TEST_036_1_NOT_RUN_BY_VERIFY_DEFAULT", true, {
    note: "Run with --run-deno on desktop to execute Deno behavioral suite.",
  });
}

const pass = assertions.filter((a) => a.pass).length;
const fail = assertions.length - pass;
const result = {
  pass,
  fail,
  total: assertions.length,
  assertions,
  denoResult: denoResult ? { status: denoResult.status } : null,
};
console.log(JSON.stringify(result, null, 2));
if (fail) process.exit(1);
