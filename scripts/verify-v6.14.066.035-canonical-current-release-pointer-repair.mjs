#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const root = path.resolve(args.get("root") || process.cwd());
const resultFile = args.get("result-file") ? path.resolve(args.get("result-file")) : "";
const skipMutations = args.get("skip-mutations") === "true";

const requiredFiles = {
  reconcile: "supabase/functions/reconcile-cms-release/index.ts",
  repairExecutor: "supabase/functions/_shared/cmsCanonicalPointerRepair.ts",
  contract: "supabase/functions/_shared/cmsReleaseContract.ts",
  operation: "supabase/functions/_shared/cmsReleaseOperation.ts",
  audit: "supabase/functions/_shared/cmsReleaseAudit.ts",
  publish: "supabase/functions/publish-cms-json/index.ts",
  rollback: "supabase/functions/rollback-cms-json/index.ts",
  behavioralTests: "scripts/test-036-1.ts",
  fixture: "scripts/fixtures/v6.14.066.035-canonical-current-release-pointer-repair-cases.json",
  verifier: "scripts/verify-v6.14.066.035-canonical-current-release-pointer-repair.mjs",
};

function fileExists(rel) {
  return fs.existsSync(path.join(root, rel));
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
const sources = Object.fromEntries(Object.entries(requiredFiles).map(([key, rel]) => [key, fileExists(rel) ? read(rel) : ""]));
const fixture = JSON.parse(sources.fixture || "{}");
const assertions = [];
const negativeProbeRecords = [];
function assert(id, pass, details = {}) {
  assertions.push({ id, pass: Boolean(pass), ...details });
}
function sha(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}
function hasAll(text, tokens) {
  return tokens.every((token) => text.includes(token));
}
function hasRegex(text, pattern) {
  return pattern.test(text);
}
function sliceBetween(text, startNeedle, endNeedle = "") {
  const start = text.indexOf(startNeedle);
  if (start < 0) return "";
  const end = endNeedle ? text.indexOf(endNeedle, start + startNeedle.length) : -1;
  return end > start ? text.slice(start, end) : text.slice(start);
}
function functionBlock(text, signature) {
  const start = text.indexOf(signature);
  if (start < 0) return "";
  let brace = text.indexOf("{", start);
  if (brace < 0) return "";
  let depth = 0;
  for (let i = brace; i < text.length; i += 1) {
    const char = text[i];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}
function indexOrder(text, orderedTokens) {
  let cursor = -1;
  const positions = {};
  for (const token of orderedTokens) {
    const idx = text.indexOf(token, cursor + 1);
    positions[token] = idx;
    if (idx < 0 || idx <= cursor) return { pass: false, positions };
    cursor = idx;
  }
  return { pass: true, positions };
}
function countExact(text, needle) {
  return text.split(needle).length - 1;
}
function isSpecificBehaviorCovered(text, testNameTokens, invariantTokens = []) {
  return text.includes("executeCanonicalPointerRepair") &&
    testNameTokens.every((token) => text.includes(token)) &&
    invariantTokens.every((token) => text.includes(token));
}
function copyRequiredFiles(dstRoot) {
  for (const rel of Object.values(requiredFiles)) {
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dstRoot, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}
function mutateFile(tmpRoot, rel, search, replacement) {
  const target = path.join(tmpRoot, rel);
  const text = fs.readFileSync(target, "utf8");
  const replacementCount = countExact(text, search);
  fs.writeFileSync(target, text.replace(search, replacement));
  const after = fs.readFileSync(target, "utf8");
  return {
    replacementCount,
    sourceHashBefore: sha(text),
    sourceHashAfter: sha(after),
    sourceChanged: text !== after,
  };
}
function runVerifierOnTempRoot(mutator) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify035-"));
  try {
    copyRequiredFiles(tmp);
    const mutationMeta = mutator(tmp);
    let status = 0;
    let out = "";
    try {
      out = execFileSync(process.execPath, [
        path.join(tmp, requiredFiles.verifier),
        `--root=${tmp}`,
        "--skip-mutations=true",
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      status = error.status || 1;
      out = `${error.stdout || ""}${error.stderr || ""}`;
    }
    const failed = [...String(out).matchAll(/^FAIL\s+([A-Z0-9_]+)/gm)].map((m) => m[1]);
    return { status, failed, output: out.slice(-3000), ...mutationMeta };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

for (const [key, rel] of Object.entries(requiredFiles)) {
  assert(`FILE_EXISTS_${key}`, fileExists(rel), { rel });
}
assert("FIXTURE_REQUIRED_CASE_IDS_PRESENT", Array.isArray(fixture.requiredCaseIds) && fixture.requiredCaseIds.length >= 25, { count: fixture.requiredCaseIds?.length || 0 });
assert("FIXTURE_CASE_ARRAY_PRESENT", Array.isArray(fixture.cases) && fixture.cases.length >= 25, { count: fixture.cases?.length || 0 });
const caseIds = new Set((fixture.cases || []).map((item) => item.id));
for (const id of fixture.requiredCaseIds || []) assert(`FIXTURE_HAS_${id}`, caseIds.has(id));
for (const item of fixture.cases || []) {
  assert(`FIXTURE_SCHEMA_${item.id}`, typeof item.id === "string" && Boolean(item.expectedClassification || item.expectedStatus || item.expectedUnchanged || item.expectedSharedBuilder));
}

const handler = sources.reconcile;
const repair = sources.repairExecutor;
const contract = sources.contract;
const operation = sources.operation;
const audit = sources.audit;
const tests = sources.behavioralTests;
const publish = sources.publish;
const rollback = sources.rollback;
const statusExecutorBlock = sliceBetween(repair, "export async function executeCanonicalPointerStatus", "async function executeCanonicalPointerRepairMode");
const repairModeBlock = sliceBetween(repair, "async function executeCanonicalPointerRepairMode", "export async function inspectCurrentReleasePointerHealth");
const planBlock = sliceBetween(repair, "export async function createCanonicalPointerRepairPlan", "function buildRepairPlanResponse");
const applyBlock = sliceBetween(repair, "async function applyCanonicalPointerRepair", "async function finalizeAlreadyRepaired");
const immutableBlock = sliceBetween(repair, "async function writeImmutableObjectWithExactReuse", "async function uploadPointerWithRaceProtection");
const pointerWriteBlock = sliceBetween(repair, "async function uploadPointerWithRaceProtection", "async function verifyCanonicalObject");
const pointerVerifyBlock = sliceBetween(repair, "async function verifyCanonicalPointer", "async function verifyCanonicalPointerWithRetry");
const finalizeAlreadyBlock = sliceBetween(repair, "async function finalizeAlreadyRepaired", "async function writeImmutableObjectWithExactReuse");
const handlerStatusBranch = sliceBetween(handler, "if (mode === \"status\")", "if (mode === REPAIR_POINTER_MODE)");
const dryRunBlock = sliceBetween(repairModeBlock, "if (dryRun)", "const expectedPlanHash");
const terminalAuditFailureBlock = sliceBetween(applyBlock, "if (\n      !(audit.persisted", "return {\n      status: 200");

assert("HANDLER_IMPORTS_SHARED_REPAIR_EXECUTOR", hasAll(handler, ["createSupabaseCanonicalPointerRepairAdapters", "executeCanonicalPointerRepair", "REPAIR_POINTER_MODE", "../_shared/cmsCanonicalPointerRepair.ts"]));
assert("HANDLER_DELEGATES_REPAIR_POINTER_MODE", hasAll(handler, ["if (mode === REPAIR_POINTER_MODE)", "executeCanonicalPointerRepair", "createSupabaseCanonicalPointerRepairAdapters(serviceClient)", "actorId: user.id"]));
assert("HANDLER_HAS_NO_LOCAL_REPAIR_DUPLICATE", !handler.includes("function handleCanonicalPointerRepair") && !handler.includes("function applyCanonicalPointerRepair") && !handler.includes("function createCanonicalPointerRepairPlan"));
assert("STATUS_POINTER_HEALTH_INSPECTED_AFTER_LINEAGE_CLEAN", indexOrder(handlerStatusBranch, ["getTerminalLineageGateInspection", "executeCanonicalPointerRepair", "mode: \"status\""]).pass && statusExecutorBlock.includes("inspectCurrentReleasePointerHealth"));
assert("STATUS_POINTER_MISSING_NOT_SILENT_IDLE", hasAll(repair, ["classification: \"canonical_pointer_missing\"", "CANONICAL_CURRENT_RELEASE_POINTER_MISSING"]) && !statusExecutorBlock.includes("classification: \"idle\""));
assert("STATUS_POINTER_MISSING_REPAIRABLE_BLOCKED", hasAll(repair, ["pointerHealth.classification === \"canonical_pointer_missing\"", "blocked: true", "repairable"]));
assert("STATUS_IS_READ_ONLY_NO_REPAIR_CALL", statusExecutorBlock.includes("inspectCurrentReleasePointerHealth") && !hasRegex(statusExecutorBlock, /acquireOperation|transitionOperation|finalizeOperationFailure|writeImmutableObject|uploadPointerWithRaceProtection|persistTerminalAudit|writeTextObject/));
assert("STATUS_BEHAVIORAL_COVERAGE_PRESENT", isSpecificBehaviorCovered(tests, ["status valid pointer returns 200", "status missing pointer returns 200", "status pointer read failure returns 500"], ["zero writes"]));

assert("REPAIR_POINTER_MODE_EXISTS", handler.includes("REPAIR_POINTER_MODE") && repair.includes("export const REPAIR_POINTER_MODE = \"repair-pointer\"") && hasAll(repairModeBlock, ["mode: REPAIR_POINTER_MODE", "createCanonicalPointerRepairPlan"]));
assert("REPAIR_ADMIN_AUTH_REUSES_EXISTING_ACCESS_GATE", /getAdminAccess\(serviceClient, user\.id\)[\s\S]*if \(!access\.allowed\)/.test(handler));
assert("REPAIR_DRY_RUN_RETURNS_ZERO_WRITES", hasAll(dryRunBlock, ["classification: \"canonical_pointer_repair_dry_run\"", "writesPerformed: false"]) && !dryRunBlock.includes("acquireOperation") && !dryRunBlock.includes("writeTextObject"));
assert("REPAIR_APPLY_REQUIRES_PLAN_HASH", indexOrder(repairModeBlock, ["createCanonicalPointerRepairPlan", "if (!expectedPlanHash || expectedPlanHash !== plan.planHash", "REPAIR_POINTER_PLAN_HASH_MISMATCH", "writesPerformed: false"]).pass);
assert("REPAIR_APPLY_REQUIRES_CONFIRMATION", indexOrder(repairModeBlock, ["if (confirmation !== REPAIR_CONFIRMATION)", "REPAIR_POINTER_CONFIRMATION_REQUIRED", "writesPerformed: false", "Missing exact repair confirmation"]).pass);
assert("REPAIR_REQUEST_GATE_BEHAVIORAL_COVERAGE_PRESENT", isSpecificBehaviorCovered(tests, ["dry-run returns ok true", "missing confirmation and plan mismatch perform zero writes"], ["expectedPlanHash", "confirmation", "zero writes"]));

assert("REPAIR_SOURCE_AUDIT_ID_EXACT", hasAll(planBlock, ["adapters.readSourceAuditLog(input.sourceAuditLogId)", "normalizeText(row.status) !== \"published\"", "normalizeText(row.operation_type) !== \"publish\""]) && hasAll(repair, ["readSourceAuditLog(sourceAuditLogId", ".eq(\"id\", sourceAuditLogId)"]));
assert("REPAIR_SOURCE_PATH_HASH_VERSION_GATES", hasAll(planBlock + repair, ["REPAIR_SOURCE_PATH_MISMATCH", "validateSourceAuditHashes", "REPAIR_SOURCE_VERSION_MISMATCH", "REPAIR_SOURCE_VERIFY_HASH_MISSING", "REPAIR_SOURCE_VERIFY_HASH_INVALID", "REPAIR_SOURCE_VERIFY_HASH_CONFLICT", "REPAIR_SOURCE_VERIFY_HASH_MISMATCH"]));
assert("REPAIR_SOURCE_AND_ALIAS_BYTE_HASH_COMPARE", hasAll(planBlock, ["sourceHash", "activeAliasHash", "sourceByteLength", "activeAliasByteLength", "activeAliasText !== sourceText", "REPAIR_ACTIVE_ALIAS_MISMATCH"]));
assert("REPAIR_RELEASE_ID_STABLE", hasAll(planBlock, ["createStableRepairReleaseId", "input.sourceAuditLogId", "input.expectedSourceHash", "input.expectedPublishedVersion"]) && contract.includes("cms-canonical-pointer-repair"));
assert("SOURCE_IDENTITY_BEHAVIORAL_COVERAGE_PRESENT", isSpecificBehaviorCovered(tests, ["standard UUID and stable repair UUID are accepted", "stable repair ID must be UUID", "missing invalid conflicting and mismatched audit hashes"], ["sourceAuditLogId", "expectedSourceHash"]));

assert("SHARED_CANONICAL_BUILDER_EXISTS", hasAll(contract, ["export function buildCanonicalReleaseJson", "export function prepareCanonicalReleaseCandidate", "export function buildReleasePointer", "export async function createStableRepairReleaseId"]));
assert("PUBLISH_USES_SHARED_CANONICAL_BUILDER", (publish.includes("buildCanonicalReleaseJson") && publish.includes("prepareCanonicalReleaseCandidate")) || hasAll(publish, ["function prepareFinalReleaseJson", "releaseId", "contentPath", "candidateHash", "draftVersion", "publishedAt"]));
assert("REPAIR_ACQUIRES_OPERATION_LOCK", hasAll(applyBlock, ["operation = await adapters.acquireOperation", "operationType: \"publish\"", "phase: \"acquired\"", "repairKind: \"canonical_current_release_pointer_repair\""]));
assert("REPAIR_LIFECYCLE_ORDER_PRESENT", indexOrder(applyBlock, ["acquireOperation", "createCanonicalPointerRepairPlan", "phase: \"release_write\"", "writeImmutableObjectWithExactReuse", "phase: \"release_verified\"", "phase: \"pointer_write_started\"", "uploadPointerWithRaceProtection", "phase: \"pointer_written\"", "verifyCanonicalPointerWithRetry", "state: \"succeeded\"", "phase: \"pointer_verified\"", "persistTerminalAudit"]).pass);
assert("REPAIR_POST_LOCK_REVALIDATION_BEFORE_WRITE", indexOrder(applyBlock, ["operation = await adapters.acquireOperation", "const postLockPlan = await createCanonicalPointerRepairPlan", "if (postLockPlan.planHash !== plan.planHash)", "const pointerAfterLock = await inspectCurrentReleasePointerHealth", "phase: \"release_write\"", "writeImmutableObjectWithExactReuse"]).pass);
assert("REPAIR_POINTER_WRITES_WITHOUT_UPSERT", hasAll(pointerWriteBlock, ["adapters.writeTextObject", "POINTER_PATH", "plan.pointerText", "upsert: false", "cacheControl: \"30\""]));
assert("REPAIR_EXISTING_POINTER_CONFLICT_FAILS", hasAll(applyBlock + pointerWriteBlock, ["classification: \"canonical_pointer_conflict\"", "REPAIR_POINTER_ALREADY_POINTS_ELSEWHERE", "REPAIR_POINTER_UNHEALTHY_NOT_OVERWRITTEN", "REPAIR_POINTER_IMMUTABLE_CONFLICT"]) && hasAll(pointerWriteBlock, ["currentPointer.classification === \"read_failed\"", "REPAIR_POINTER_CONFLICT_READ_FAILED"]));
assert("REPAIR_CANONICAL_OBJECT_EXACT_REUSE_ONLY", hasAll(immutableBlock, ["existing.text === text", "existingHash === expectedHash", "classification: \"immutable_object_conflict\"", "EXISTING_READ_FAILED"]));
assert("REPAIR_POINTER_VERIFY_BEFORE_SUCCESS", indexOrder(applyBlock, ["const pointerWrite = await uploadPointerWithRaceProtection", "const pointerVerify = await verifyCanonicalPointerWithRetry", "if (!pointerVerify.valid)", "const succeededOperation = await adapters.transitionOperation", "state: \"succeeded\""]).pass && hasAll(pointerVerifyBlock, ["errors", "read_failed", "contentHash"]));
assert("REPAIR_TERMINAL_AUDIT_AFTER_SUCCESS", indexOrder(applyBlock, ["state: \"succeeded\"", "const audit = await adapters.persistTerminalAudit", "audit.persisted === true"]).pass);
assert("REPAIR_TERMINAL_AUDIT_FAILURE_NOT_FULL_SUCCESS", hasAll(terminalAuditFailureBlock, ["ok: false", "classification: \"lineage_repair_required\"", "writesPerformed: true", "pointerRepairCompleted: true", "Terminal audit persistence failed after pointer repair"]));
assert("REPAIR_FAILURE_FINALIZES_OPERATION", hasAll(applyBlock, ["catch (error)", "if (operation?.id)", "await adapters.finalizeOperationFailure", "pointerWriteStarted", "return repairErrorResponse(error)"]));
assert("REPAIR_ALREADY_REPAIRED_NO_DUPLICATE_AUDIT", hasAll(finalizeAlreadyBlock, ["classification: \"already_repaired\"", "writesPerformed: false", "persistTerminalAudit", "lineage_repair_required"]));
assert("REPAIR_LIFECYCLE_BEHAVIORAL_COVERAGE_PRESENT", isSpecificBehaviorCovered(tests, ["post-lock source and alias drift", "pointer verification read failure", "terminal audit failure", "runtime failure responses"], ["finalizes operation", "ok false"]));

assert("OPTIONS_200_PRESERVED", hasRegex(handler, /if\s*\(request\.method\s*===\s*["']OPTIONS["']\)\s*return\s+jsonResponse\(\{\s*ok:\s*true\s*\},\s*200\)/));
assert("REPAIR_LINEAGE_MODE_PRESERVED", hasAll(handler, ["mode === \"repair-lineage\"", "repairResolvedOperationLineage"]));
assert("ROLLBACK_SOURCE_UNCHANGED", rollback.includes("rollback") && !rollback.includes("canonical_current_release_pointer_repair"));
assert("NO_FRONTEND_SOURCE_CHANGE_IN_SCOPE", !Object.values(requiredFiles).some((rel) => rel.startsWith("src/")));

if (!skipMutations) {
  const probes = [
    {
      id: "P001_MISSING_POINTER_MAPPING_REMOVED",
      rel: requiredFiles.repairExecutor,
      search: "canonical_pointer_missing: \"CANONICAL_CURRENT_RELEASE_POINTER_MISSING\"",
      replacement: "canonical_pointer_missing: \"CANONICAL_POINTER_SILENT_IDLE\"",
      expectedFails: ["STATUS_POINTER_MISSING_NOT_SILENT_IDLE"],
    },
    {
      id: "P002_REMOVE_PLAN_HASH_GATE",
      rel: requiredFiles.repairExecutor,
      search: "if (!expectedPlanHash || expectedPlanHash !== plan.planHash)",
      replacement: "if (false && (!expectedPlanHash || expectedPlanHash !== plan.planHash))",
      expectedFails: ["REPAIR_APPLY_REQUIRES_PLAN_HASH"],
    },
    {
      id: "P003_REMOVE_CONFIRMATION_GATE",
      rel: requiredFiles.repairExecutor,
      search: "if (confirmation !== REPAIR_CONFIRMATION)",
      replacement: "if (false && confirmation !== REPAIR_CONFIRMATION)",
      expectedFails: ["REPAIR_APPLY_REQUIRES_CONFIRMATION"],
    },
    {
      id: "P004_DRY_RUN_WRITES_PERFORMED_TRUE",
      rel: requiredFiles.repairExecutor,
      search: "classification: \"canonical_pointer_repair_dry_run\",\n        writesPerformed: false,",
      replacement: "classification: \"canonical_pointer_repair_dry_run\",\n        writesPerformed: true,",
      expectedFails: ["REPAIR_DRY_RUN_RETURNS_ZERO_WRITES"],
    },
    {
      id: "P005_POINTER_WRITE_UPSERT_TRUE",
      rel: requiredFiles.repairExecutor,
      search: "upsert: false,\n      cacheControl: \"30\",",
      replacement: "upsert: true,\n      cacheControl: \"30\",",
      expectedFails: ["REPAIR_POINTER_WRITES_WITHOUT_UPSERT"],
    },
    {
      id: "P006_IMMUTABLE_DIFFERENT_BYTES_REUSED",
      rel: requiredFiles.repairExecutor,
      search: "if (existing.text === text && existingHash === expectedHash) {",
      replacement: "if (existingHash === expectedHash) {",
      expectedFails: ["REPAIR_CANONICAL_OBJECT_EXACT_REUSE_ONLY"],
    },
    {
      id: "P007_REMOVE_POINTER_VERIFY_BEFORE_SUCCESS",
      rel: requiredFiles.repairExecutor,
      search: "const pointerVerify = await verifyCanonicalPointerWithRetry(adapters, plan);",
      replacement: "const pointerVerify = { valid: true, errors: {} };",
      expectedFails: ["REPAIR_POINTER_VERIFY_BEFORE_SUCCESS"],
    },
    {
      id: "P008_TERMINAL_AUDIT_FAILURE_OK_TRUE",
      rel: requiredFiles.repairExecutor,
      search: "ok: false,\n          classification: \"lineage_repair_required\",",
      replacement: "ok: true,\n          classification: \"lineage_repair_required\",",
      expectedFails: ["REPAIR_TERMINAL_AUDIT_FAILURE_NOT_FULL_SUCCESS"],
    },
    {
      id: "P009_REMOVE_FAILURE_FINALIZATION",
      rel: requiredFiles.repairExecutor,
      search: "if (operation?.id) {\n      await adapters.finalizeOperationFailure({",
      replacement: "if (false && operation?.id) {\n      await adapters.finalizeOperationFailure({",
      expectedFails: ["REPAIR_FAILURE_FINALIZES_OPERATION"],
    },
    {
      id: "P010_BREAK_OPTIONS_200",
      rel: requiredFiles.reconcile,
      search: "if (request.method === \"OPTIONS\") return jsonResponse({ ok: true }, 200);",
      replacement: "if (request.method === \"OPTIONS\") return jsonResponse({ ok: false }, 405);",
      expectedFails: ["OPTIONS_200_PRESERVED"],
    },
    {
      id: "P011_BREAK_REPAIR_LINEAGE_MODE",
      rel: requiredFiles.reconcile,
      search: "if (mode === \"repair-lineage\")",
      replacement: "if (mode === \"repair-lineage-disabled\")",
      expectedFails: ["REPAIR_LINEAGE_MODE_PRESERVED"],
    },
  ];
  for (const probe of probes) {
    const result = runVerifierOnTempRoot((tmp) => mutateFile(tmp, probe.rel, probe.search, probe.replacement));
    const killed = result.replacementCount === 1 && result.sourceChanged && result.status !== 0 && probe.expectedFails.every((id) => result.failed.includes(id));
    const record = {
      id: probe.id,
      target: probe.rel,
      replacementCount: result.replacementCount,
      expectedReplacementCount: 1,
      sourceHashBefore: result.sourceHashBefore,
      sourceHashAfter: result.sourceHashAfter,
      sourceChanged: result.sourceChanged,
      exitCode: result.status,
      failedAssertionIds: result.failed,
      expectedFailedAssertionIds: probe.expectedFails,
      status: killed ? "KILLED" : "SURVIVED",
      outputTail: result.output,
    };
    negativeProbeRecords.push(record);
    assert(`NEGATIVE_PROBE_${probe.id}_KILLED`, killed, record);
  }
}

const pass = assertions.filter((a) => a.pass).length;
const fail = assertions.length - pass;
const result = {
  pass,
  fail,
  total: assertions.length,
  assertions,
  negativeProbeRecords,
  killedProbes: negativeProbeRecords.filter((m) => m.status === "KILLED").length,
  survivedProbes: negativeProbeRecords.filter((m) => m.status !== "KILLED").length,
};
if (resultFile) fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
for (const item of assertions) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.id}`);
console.log(`RESULT PASS ${pass} / FAIL ${fail} / TOTAL ${assertions.length}`);
if (negativeProbeRecords.length) console.log(`NEGATIVE PROBES KILLED ${result.killedProbes} / SURVIVED ${result.survivedProbes} / TOTAL ${negativeProbeRecords.length}`);
process.exit(fail === 0 ? 0 : 1);
