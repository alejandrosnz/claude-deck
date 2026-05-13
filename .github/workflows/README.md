# GitHub Actions Workflows

This directory contains three workflows that cover the full development lifecycle of the plugin.

---

## `pr.yml` — Pull Request

**Trigger:** any pull request targeting any branch.

**Steps:**
1. Typecheck (`tsc --noEmit`)
2. Lint (ESLint)
3. Test (Vitest)
4. Patch the root `package.json` version to `X.Y.Z-beta<PR number>`
5. Package the plugin bundle (`npm run package`) — produces a `.streamDeckPlugin` zip
6. Upload the zip as a workflow artifact (retained for 14 days)

The beta artifact lets reviewers install and test the exact build from the PR directly on hardware, without having to clone and build locally.

---

## `push.yml` — Push to master

**Trigger:** every push to the `master` branch.

**Steps:**
1. Typecheck
2. Lint
3. Test
4. Build (`npm run build`) — compiles `plugin.ts` → `bin/plugin.js` via Rollup

No artifact is produced. This workflow acts as a sanity check that `master` always compiles cleanly after a merge.

---

## `release.yml` — Release

**Triggers:**
- Push of a version tag matching `v*.*.*` (e.g. `v1.2.3`)
- Manual dispatch via the GitHub Actions UI (input: the version tag to release)

**Steps:**
1. Resolve the version tag (from the git ref or the manual input)
2. Patch `manifest.json` → `Version` field with the resolved version (strips the leading `v`)
3. Typecheck
4. Build
5. Package the distributable bundle — includes only runtime files, excludes `src/`, `node_modules/`, config and lock files
6. Create a GitHub Release with auto-generated release notes and attach the `.streamDeckPlugin` bundle as a release asset

This is the only workflow that publishes a production artifact. The release requires `contents: write` permission to create the GitHub Release.

---

## Summary

| Workflow | Trigger | Artifact |
|---|---|---|
| `pr.yml` | Pull request | Beta `.streamDeckPlugin` (14-day artifact) |
| `push.yml` | Push to `master` | None |
| `release.yml` | Version tag / manual dispatch | Release `.streamDeckPlugin` (GitHub Release asset) |
