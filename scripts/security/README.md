# Security / Release Safety Scripts

These scripts are read-only guardrails. They do not publish, seed, upload, rotate keys, or modify data.

## Commands

```bash
npm run security:scan
npm run release:hygiene
npm run release:manifest
npm run security:rls-lint
npm run security:prepublish-gate
npm run release:check
```

## Expected behavior while local `.env` exists

If `supabase/.env` still exists in the worktree, `npm run security:scan` and `npm run release:hygiene` may fail. That is expected and correct until the package is cleaned and any exposed key has been rotated when required. Output is masked and must not print the full secret.

## Clean release verification

1. Generate a manifest:

```bash
npm run release:manifest -- --out ./clean_release_manifest.md
```

2. Create a changed-files-only or manifest-based package.
3. Extract the package into `_release_check`.
4. Check the extracted folder:

```bash
npm run release:hygiene -- ./_release_check
```

If direct zip inspection is not available in the environment, unzip first and check the extracted folder.

## RLS / Storage static lint

```bash
npm run security:rls-lint
```

This is static lint only. It does not replace live Supabase verification. Real publish remains blocked until `RLS_STORAGE_VERIFICATION_CHECKLIST.md` is completed.

## Active gates

- `PUBLISH_DISABLED_UNTIL_SECURITY_PASS`
- `REAL_PUBLISH_BLOCKED_BY_SECRET_AND_ROLLBACK_GATE`
- `NO_CLEAN_PACKAGE_NO_PUBLISH`
- `NO_SECRET_ROTATION_CONFIRM_NO_PUBLISH`
- `NO_RLS_VERIFY_NO_PUBLISH`
- `NO_STORAGE_VERIFY_NO_PUBLISH`
- `NO_BACKUP_NO_PUBLISH`
- `NO_ROLLBACK_NO_PUBLISH`
- `NO_SMOKE_PASS_NO_PUBLISH`
- `NO_DIFF_REVIEW_NO_PUBLISH`
