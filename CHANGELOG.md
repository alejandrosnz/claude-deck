# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.2.2] - 2026-05-14

### Added
- **Reset-time overlay on key press**: pressing a Usage 5h or Usage 7d button now toggles a 10-second overlay showing:
  - "resets in X" — remaining time (e.g. "1h 23m", "45m")
  - Local reset time — time only for 5h (e.g. "14:30"), day + time for 7d (e.g. "Mon 14:30")
  - Pressing the button a second time reverts immediately; overlay also auto-reverts after 10 s
- `formatRemaining(resetsAt)` and `formatResetTime(resetsAt, is5h)` exported from `renderer.ts` for time formatting and testability
- `computeResetImage()` and `toggleResetInfoForButton()` exported from `poller.ts`
- `_resetPollerStateForTesting()` internal helper in `poller.ts` for unit test isolation
- New `'reset'` state kind added to `ButtonRenderState` discriminated union
- Extended test suite: new tests for reset state rendering, `formatRemaining`, `formatResetTime`, `computeResetImage`, and `toggleResetInfoForButton` (including timer-based auto-revert)
- **CI bundle-format gate** (all three workflows: `push.yml`, `pr.yml`, `release.yml`): after each build, a "Verify bundle format" step checks that `bin/plugin.js` starts with an ESM `import` statement. If a future change reverts the Rollup format to CJS, CI will fail before any artifact is packaged or released.

### Fixed
- **Slow startup (usage % not showing for ~2 minutes)**: if the initial poll on plugin start returned no data (credentials not yet available, network not ready), the next attempt was not scheduled until the regular 120 s interval. The plugin now schedules a fast 15 s retry when the first poll returns no data, so usage appears within ~15 s of the credentials/network becoming available.
- **Beta bundle incorrectly included `package.json`**: `scripts/package.mjs` generated zip `--exclude` patterns with a trailing `/*` for every entry (e.g. `--exclude "plugin/package.json/*"`). The `/*` suffix only matches contents of a directory; it does not match a plain file. As a result, `package.json` (with `"type": "module"`) was silently included in every beta `.streamDeckPlugin` zip on Linux/macOS, triggering a plugin crash on startup. Fixed by checking whether each exclude entry is a file or a directory and applying the correct pattern (`dir/*` vs `file`). The `release.yml` workflow used hard-coded correct patterns and was not affected.

### Changed
- **Button label size**: increased "5h" / "7d" label font size from 12 px to 14 px in the main usage, loading, and no-data button states for improved legibility on small physical buttons
- **Rollup output format**: changed from CommonJS (`format: 'cjs'`) to ES modules (`format: 'esm'`) to align with `package.json`'s `"type": "module"` declaration. This prevents latent crashes if the distributable bundle inadvertently includes `package.json`.
- **Unit test suite** (Vitest): 133 tests across 4 test files covering `renderer.ts`, `credentials.ts`, `usage-api.ts`, and `poller.ts`
  - `renderer.test.ts`: SVG generation, colour thresholds, percent clamping, gauge bar, XML escaping, all state kinds
  - `credentials.test.ts`: `parseCredentialsJson` edge cases, file-based reading, macOS Keychain path and fallback
  - `usage-api.test.ts`: `parseUtilization` / `parseResetsAt` field-name resilience, fetch normalisation, caching TTL, deduplication, error handling
  - `poller.test.ts`: `computeImage` routing logic for all billing type / data availability combinations
- **CI: beta artifact on PRs** — the `CI` workflow now builds and uploads an installable `.streamDeckPlugin` bundle for every pull request. The bundle is versioned as `X.Y.Z-betaNNN` (where `NNN` is the PR number), patch is applied to `manifest.json` before building, and the artifact is retained for 14 days. It appears in the PR "Checks" tab and can be downloaded and installed directly for manual testing.
- **Debug logging added throughout fetch and key-press chain**: `onKeyDown`, `toggleResetInfoForButton`, `setButtonImage`, `registerButton`, `startPolling`, `poll`, `fetchUsage` (cache hits, backoff, dedup), and `doFetch` (credential read, HTTP request start/response) all emit `[claude-deck]` log entries to aid diagnostics.

---

## [0.2.1] - 2026-05-13

### Added
- **Version bump script**: `scripts/bump-version.mjs` updates `package.json` (root), `com.claudedeck.sdPlugin/package.json`, and `manifest.json` simultaneously (`npm run version:bump -- <version>`)
- **CI auto-patch manifest**: `release.yml` now resolves the git tag and patches `manifest.json`'s `Version` field before building, ensuring the distributed plugin always shows the correct release version
- **Local packaging sync**: `scripts/package.mjs` syncs `manifest.json` version from root `package.json` before building

### Changed
- `release.yml`: moved version resolution before build step to enable manifest patching
- `AGENTS.md`: added changelog convention for all contributors

---

## [0.2.0] - 2026-05-13

### Changed
- **Icon readability**: Redesigned button icons (`usage5h.svg`, `usage7d.svg` and PNG renders) — the icons were too small on the physical Stream Deck display; enlarged and centred the icon elements for better visibility
- Adjusted manifest paths to match updated icon assets

### Fixed
- CI workflow now triggers on pushes to `master` branch (was incorrectly set to `main`)

---

## [0.1.1] - 2026-05-13

### Changed
- **Credentials**: Improved credential reading logic with better error handling and fallback behaviour (`credentials.ts`)
- **Usage API**: Hardened API response parsing to tolerate alternative field names (`utilization`, `percentage`, `resets_at`, `resetsAt`, etc.) and `null` values (`usage-api.ts`)
- **Manifest**: Minor manifest adjustments for compatibility

---

## [0.1.0] - 2026-05-13

### Added
- Initial plugin implementation with full TypeScript source:
  - `plugin.ts` — entry point, registers actions and connects to Stream Deck / OpenDeck
  - `actions/usage-5h.ts` — action displaying rolling 5-hour usage window
  - `actions/usage-7d.ts` — action displaying rolling 7-day usage window
  - `credentials.ts` — cross-platform Claude Code OAuth token reader (macOS Keychain + `~/.claude/.credentials.json` for Linux/Windows)
  - `usage-api.ts` — Anthropic OAuth usage API client with caching, retry logic and 429 back-off
  - `poller.ts` — singleton polling loop (120 s interval, shared across all action instances)
  - `renderer.ts` — SVG-based button image generator producing base64 PNG; colour-coded by utilisation level (green / amber / red)
- Button icons (`usage5h.svg`, `usage7d.svg`) and rasterised variants (`@1x`, `@2x` PNG)
- Rollup build pipeline compiling TypeScript to `bin/plugin.js`
- ESLint configuration
- GitHub Actions CI workflow (typecheck, lint, build on Ubuntu)
- Plugin packaging script (`scripts/package.mjs`)
- `AGENTS.md` developer guide with architecture decisions and reference material

### Fixed
- Manifest field corrections required for OpenDeck compatibility

---

[0.2.2]: https://github.com/alxbck/claude-deck/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/alxbck/claude-deck/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/alxbck/claude-deck/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/alxbck/claude-deck/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/alxbck/claude-deck/releases/tag/v0.1.0
