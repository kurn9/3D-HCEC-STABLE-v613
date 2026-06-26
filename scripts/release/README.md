# Release Backup / Rollback Foundation

These scripts are local, file-level safety tools for the 3D Gallery release process. They do **not** publish, seed, restore Supabase, upload Storage, or copy secrets.

## Commands

```bash
npm run backup:create:dry-run
npm run backup:create -- --dry-run --room indoor
npm run backup:create -- --write --room all --version V6.11.21-B6-E_B
npm run rollback:dry-run -- --backup backups/<backupId> --out reports/rollback_dry_run_<backupId>.md
npm run restore:local -- --backup backups/<backupId> --room indoor
npm run restore:local -- --backup backups/<backupId> --room indoor --write --confirm-restore-local
```

## Scope

Backed up by `backup:create --write` when files exist:

- `data/scene.json`
- `data/scene_outdoor.json`
- `data/cms_content_fallback.json`
- `cms_public_content.generated.json`
- `supabase/cms_public_content.generated.json`
- `data/asset_manifest.json`

Generated artifacts:

- `backup_manifest.json`
- `backup_manifest.md`
- `media_manifest.json`
- `media_manifest.md`

Not backed up:

- `.env` / `.env.*`
- `supabase/.env` / `supabase/.env.*`
- `node_modules/**`
- `.git/**`
- `assets/**` binary media/GLB/MP4/audio/image files
- `reports/**`
- `backups/**`
- Supabase production tables
- Supabase Storage / R2 binary objects

## Gates

Real publish remains blocked until these artifact IDs exist and are reviewed:

- `BACKUP_ID`
- `ROLLBACK_DRY_RUN_ID`
- `DIFF_REVIEW_ID`
- `SMOKE_REPORT_ID`
- `CLEAN_RELEASE_MANIFEST_ID`
- `RLS_VERIFICATION_ID`
- `STORAGE_VERIFICATION_ID`

## Safety

`rollback_dry_run.mjs` and `restore_local_only.mjs` only accept `--backup` / `--manifest` paths that resolve inside `backups/**`; path escape such as `../outside`, `reports/**`, `assets/**`, or absolute paths outside the project backup folder is rejected.

For publish-gate evidence, rollback dry-run must use `--out` so the JSON/MD report can be referenced by the manifest:

```bash
npm run rollback:dry-run -- \
  --backup backups/<BACKUP_ID> \
  --out reports/rollback_dry_run_<BACKUP_ID>.md
```

`restore_local_only.mjs` restores local files only and requires `--write --confirm-restore-local`. It never restores Supabase production data or Storage. Do not run restore in K_J_B.

## B6-F_B — Verification Artifacts / Clean Publish Gate

B6-F_B vẫn không publish thật, không ghi Supabase và không upload/delete Storage. Các script dưới đây chỉ tạo artifact/report hoặc validate artifact.

### Tạo artifact template

```bash
npm run artifact:rls -- --status PENDING --operator local-test
npm run artifact:storage -- --status PENDING --operator local-test
npm run artifact:clean-release -- --status PENDING --operator local-test
npm run artifact:media -- --status PENDING --operator local-test
npm run artifact:source -- --status PENDING --operator local-test
```

`PENDING` và `FAIL` không pass publish gate. Chỉ dùng `PASS` sau khi operator đã có bằng chứng kiểm tra thật, không chứa secret.

### Validate artifact gate

```bash
npm run artifact:validate -- \
  --backup-id <id> --backup-manifest <path.json> \
  --rollback-id <id> --rollback-report <path.json> \
  --diff-id <id> --diff-report <path.json> \
  --smoke-id <id> --smoke-report <path.json> \
  --clean-id <id> --clean-artifact <path.json> \
  --rls-id <id> --rls-artifact <path.json> \
  --storage-id <id> --storage-artifact <path.json> \
  --media-artifact <path.json> \
  --source-artifact <path.json>
```

### Safety rules

- Không paste service role key vào artifact/report.
- Không dùng artifact PENDING/FAIL để publish thật.
- Không chạy real publish khi thiếu artifact PASS.
- Không test upload/delete trên media production thật.

## V6.11.21-B6-F_F_B — Diff / Smoke / Manifest gate

This release adds three read-only artifact helpers:

```bash
npm run artifact:diff -- --status PENDING --operator local-test --room all --version V6.11.21-B6-F_F_B
npm run artifact:smoke -- --status PENDING --operator local-test --room all --version V6.11.21-B6-F_F_B
npm run artifact:manifest -- --version V6.11.21-B6-F_F_B --operator local-test --diff-artifact reports/<diff>.json --diff-id <diff-id> ...
npm run artifact:validate -- --manifest reports/<manifest>.json
```

Gate rules:
- `PENDING` and `FAIL` artifacts never pass the publish gate.
- `DIFF_REVIEW`, `SMOKE_REPORT`, `MEDIA_READINESS`, and `PUBLISH_SOURCE_READINESS` artifacts must bind to current source hashes.
- If scene/CMS/generated bundle hashes change after artifact creation, validation fails with `STALE_ARTIFACT_SOURCE_HASH_MISMATCH`.
- A publish gate manifest only aggregates artifact paths and IDs. It does not grant publish permission by itself.
- Public item publication still requires Scene JSON placement, CMS metadata, media assets, clean release, backup, rollback dry-run, RLS/Storage verification, diff review, and smoke PASS artifacts.
- Never place `.env` or service role keys in reports, artifacts, backups, or release packages.

## B6-F_H_B — Final media/source readiness gate hardening

This release keeps publish disabled unless every required artifact is a real `PASS` artifact.

Recommended order:

1. Create a real local backup.
2. Run rollback dry-run.
3. Create clean release artifact.
4. Create RLS verification artifact.
5. Create Storage verification artifact.
6. Create media readiness artifact.
7. Create source-of-truth readiness artifact.
8. Create diff review artifact.
9. Create smoke report artifact.
10. Create publish gate manifest.
11. Validate manifest.
12. Only consider real publish after validation passes and secret/rollback/smoke/RLS/storage gates are all complete.

### Invalid manifest values are blocked

Do not pass placeholder booleans such as `--diff-id true` or `--smoke-id true`.
The manifest generator rejects boolean-like IDs and paths because they are not real artifacts.

```bash
npm run artifact:manifest -- --version V6.11.21-B6-F_H_B --operator local-test --diff-id true --smoke-id true
# Expected: FAIL controlled, no fake PASS manifest.
```

### Media readiness

```bash
npm run artifact:media -- --status PENDING --operator local-test --room all --version V6.11.21-B6-F_H_B
```

The artifact reports unique missing paths and missing references by room, source, field, type, and severity.
`P0` and `P1` findings block `PASS` unless an explicit waiver file is supplied and reviewed.

### Source-of-truth readiness

```bash
npm run artifact:source -- --status PENDING --operator local-test --room all --version V6.11.21-B6-F_H_B
```

To mark source readiness as `PASS`, the operator must provide evidence and explicitly confirm the Scene JSON placement plan, CMS metadata plan, and media assets plan.

```bash
npm run artifact:source -- --status PASS --operator <name> --evidence "reviewed" \
  --confirm-scene-placement-plan \
  --confirm-cms-metadata-plan \
  --confirm-media-assets-plan \
  --plan "Scene JSON, CMS metadata, generated bundle, and media assets are deployed together."
```

Real publish remains `NO-GO` until manifest validation passes with current source hashes and every artifact is `PASS`.

### V6.11.21-B6-F_K_I_B — Source readiness architecture mode

Clean Baseline can use this explicit architecture mode when Scene JSON is the placement source and the CMS fallback/generated bundle is only a metadata layer. In this mode, a generated bundle without placement is accepted only with operator evidence, plan text, all confirmation flags, zero source mismatches, and current source hashes.

```bash
npm run artifact:source -- \
  --status PASS \
  --version V6.11.21-B6-F_K_I_B \
  --operator local-clean-baseline \
  --room all \
  --placement-source scene-json \
  --cms-role metadata-layer \
  --allow-generated-without-placement \
  --clean-baseline-ok \
  --confirm-scene-placement-plan \
  --confirm-cms-metadata-plan \
  --confirm-media-assets-plan \
  --evidence "Clean Baseline reviewed: scene/CMS/generated counts are 0; Scene JSON is placement source; CMS/generated is metadata layer; generated bundle is not expected to contain placement." \
  --plan "Scene JSON files are deployed as static placement sources; CMS/generated bundle supplies metadata only; generated bundle is not expected to contain placement."
```

Rules:

- `Scene JSON` remains the placement source.
- `CMS fallback/generated bundle` is a metadata layer.
- Generated bundle must not be padded with fake placement fields.
- Without `--placement-source scene-json`, `--cms-role metadata-layer`, and `--allow-generated-without-placement`, `generatedHasPlacement=false` remains a blocker.
- CMS bundle publication does not publish Scene JSON placement.


## V6.11.21-B6-F_K_J_A_B — Backup scope / rollback path safety

Backup source scope now covers the clean-baseline release metadata set:

- `data/scene.json`
- `data/scene_outdoor.json`
- `data/cms_content_fallback.json`
- `cms_public_content.generated.json`
- `supabase/cms_public_content.generated.json`
- `data/asset_manifest.json`

Backup still excludes secrets, generated reports, previous backups, package dependencies, Git metadata, and binary media assets:

- `.env*`
- `supabase/.env*`
- `node_modules/**`
- `.git/**`
- `assets/**`
- `reports/**`
- `backups/**`

Rollback dry-run for publish-gate evidence must write a report:

```bash
npm run rollback:dry-run -- \
  --backup backups/<BACKUP_ID> \
  --out reports/rollback_dry_run_<BACKUP_ID>.md
```

Rollback/restore backup inputs must stay inside `backups/**`. Do not pass `../outside`, `reports/**`, `assets/**`, `node_modules/**`, absolute paths outside the project backup folder, or any `.env` path. Local restore remains dry-run by default and real local restore requires both `--write` and `--confirm-restore-local`.

## V6.11.21-B6-F_K_K_A_B — Clean release source-only artifact policy

`CLEAN_RELEASE` is a source-only release gate. It does not package or verify `assets/**`; media and object-storage readiness remain the responsibility of `STORAGE_VERIFICATION`.

Required clean-release artifact metadata:

- `operator`
- `version`
- `evidence`
- `sourceHashes`
- `cleanReleaseHashes.fileListHash`
- `requiredFiles`
- `includedFiles` and `includedFilesCount`
- `excludedPolicy`
- `noReportsIncluded=true`
- `noBackupsIncluded=true`
- `noAssetsIncluded=true`
- `noProductionWritePerformed=true`

Source-only required files/directories:

- `index.html`
- `gallery.html`
- `editor.html`
- `cms-admin.html`
- `package.json`
- `package-lock.json`
- `data/scene.json`
- `data/scene_outdoor.json`
- `data/cms_content_fallback.json`
- `data/asset_manifest.json`
- `cms_public_content.generated.json`
- `supabase/cms_public_content.generated.json`
- `src/`
- `styles/`
- `scripts/release/`

Forbidden in source-only clean release target:

- `.env*`
- `supabase/.env*`
- `node_modules/**`
- `supabase/node_modules/**`
- `.git/**`
- `reports/**`
- `backups/**`
- `assets/**`
- `dist/**`, `build/**`, `.cache/**`, `.vite/**`, `coverage/**`
- archives, logs, temp/cache/backup files

Example K_K_B command, only after a clean source-only target has been prepared and reviewed:

```bash
npm run artifact:clean-release -- \
  --status PASS \
  --version V6.11.21-B6-F_K_K_B \
  --operator local-clean-baseline \
  --target <clean-source-only-target> \
  --source-only \
  --require-clean-baseline \
  --evidence "Clean source-only release target reviewed; forbidden paths excluded; source hashes and file list hash bound."
```

If `--status PASS` is requested without `--operator`, `--version`, or `--evidence`, the command fails before creating a publish-gate-eligible artifact. If the target contains forbidden paths or misses required files, PASS is blocked. After CLEAN_RELEASE PASS, publish remains NO-GO until RLS and Storage verification also PASS and the publish gate manifest validates.

## K_M_A_B — Storage verification artifact hardening

`STORAGE_VERIFICATION` is now a read-only/manual evidence gate. The generator does not connect to Supabase and never uploads, deletes, creates, or moves Storage objects.

A publish-gate-eligible Storage artifact requires:

- `--version`, `--operator`, `--project-ref`, and `--verification-mode`.
- `--verification-mode read-only-sql` or `--verification-mode manual-dashboard` for `PASS`.
- `static-source-review` may only create `PENDING` / `FAIL`, never `PASS`.
- Usable `--evidence` or `--evidence-file` with an evidence hash and no secret-like content.
- Confirm flags for no production write, no secret output, no Storage upload, no Storage delete, buckets reviewed, policies reviewed, anon upload/delete blocked, public read scoped, editor upload scoped, admin delete scoped, and service role not exposed.
- `verifiedBuckets` covering at least `cms-media` and `cms-public`.
- `verifiedPolicies` covering public read, anon upload/delete blocked, editor upload scoped, admin delete scoped, and service role not exposed.
- `structuredChecks` all `PASS`, with `checkSummary.fail=0` and `checkSummary.pending=0`.
- `sourceHashes`, `securitySourceHashes`, and `storageSourceHashes` bound to current local sources.

Do not paste service-role keys, bearer tokens, JWT secrets, passwords, private keys, or raw secrets into Storage evidence. After Storage PASS, real publish is still allowed only if the full publish gate manifest validates.
