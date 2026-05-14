# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed
- **429 Retry-After honoured** (`usage-api.ts`): the plugin now parses the `Retry-After` header (integer seconds or HTTP-date) and skips outbound requests until the server-specified time has passed, preventing a hammering loop after rate-limiting.
- **Utilisation normalisation threshold** (`usage-api.ts`): the threshold for converting fractional (0–1) values to percent was raised from `≤ 1.0` to `< 2.0`, so values like `1.05` (105%) are no longer incorrectly multiplied a second time.
- **Token expiry warning** (`usage-api.ts`): moved inside the `try/catch` block so a clock skew or missing `expiresAt` field cannot throw an unhandled exception.
- **Poller fast-retry timer leak** (`poller.ts`): the initial-retry `setTimeout` handle is now stored in `fastRetryTimer` and cancelled by `stopPolling()` and `_resetPollerStateForTesting()`, preventing ghost polls after all buttons are removed.
- **Registry mutation during async iteration** (`poller.ts`): `updateAllButtons` now snapshots `[...registry]` before iterating, preventing skipped entries when `unregisterButton` splices the array mid-await.
- **Invalid-date guards in renderer** (`renderer.ts`): `formatRemaining` and `formatResetTime` now return `'now'` and `'--:--'` respectively when passed a non-parseable date string, instead of displaying `NaN`.
- **Gauge fill corner-radius clamp** (`renderer.ts`): `rx` on the fill rect is now clamped to `Math.min(BAR_RADIUS, Math.floor(fillWidth / 2))`, preventing the fill from becoming wider than tall at very low percentages and rendering as an oval.

### Changed
- **`logger.error()` accepts `Error` objects** (`log.ts`): signature widened from `string` to `string | Error`; when passed an `Error`, the full `.stack` trace is logged.
- **`credentials.ts` path deduplication**: `candidatePaths()` is called once and its result stored; removed a redundant `existsSync` pre-check (the subsequent `readFileSync` try/catch is sufficient).
- **`ButtonRenderState.usage` no longer carries `resetsAt`** (`renderer.ts`): the field was silently ignored by the renderer. Removed from the public type to eliminate dead data in callers.
- **`escapeXml` naming** (`renderer.ts`): internal SVG-escape helper renamed from `x()` to `escapeXml()` for clarity.
- **`svgWrapper` extracted** (`renderer.ts`): common SVG scaffold (background rect + label text) extracted into a `svgWrapper(label, body)` helper, removing duplication across render functions.
- **`resolveButtonInfo` extracted** (`poller.ts`): `is5h` / `label` derivation from a manifest UUID is now a single `resolveButtonInfo(manifestId)` helper used by `computeImage`, `computeResetImage`, and indirectly `showLoadingState`.
- **`clearButtonResetTimer` renamed** (`poller.ts`): was `clearBtnResetTimer`; full name improves readability.
- **`manualRefresh` unexported** (`poller.ts`): was exported but had no callers outside the module; removed `export` to avoid an unused public API.
- **Rollup `CIRCULAR_DEPENDENCY` filter tightened** (`rollup.config.mjs`): suppression now only applies to cycles where every file involved lives under `node_modules`; cycles in `src/` will surface as warnings.
- **Root `package.json` `test` script added**: `npm test` from the repository root now proxies to the plugin package, matching `build`, `typecheck`, and `lint`.
- **Plugin `icons` script path corrected** (`com.claudedeck.sdPlugin/package.json`): was `node scripts/svg-to-png.mjs`; corrected to `node ../scripts/svg-to-png.mjs`.

---

## [0.3.0] - 2026-05-14

### Added
- **Reset-time overlay on key press**: pressing a Usage 5h or Usage 7d button toggles a 10-second overlay showing time remaining until reset and the local reset time (time-only for 5h, day + time for 7d). Pressing again reverts immediately; auto-reverts after 10s.
- **CI bundle-format gate**: all workflows now verify that `bin/plugin.js` starts with an ESM import after every build, preventing accidental regressions to CJS.

### Fixed
- **Slow startup**: if the initial poll returns no data, the plugin now retries after 15s instead of waiting the full 120s interval, so usage appears within ~15s of credentials or network becoming available.
- **Beta bundle corrupted by `package.json`**: `scripts/package.mjs` now correctly excludes plain files from the zip artifact — previously `package.json` (with `"type": "module"`) was silently included in every beta build, crashing the plugin on startup.

### Changed
- **Improved logging**: introduced `src/log.ts` — a dual logger that writes to both `process.stdout` (captured by OpenDeck log file) and `streamDeck.logger` (for official Stream Deck software). All modules now emit `[claude-deck]` log entries with timestamps.
- **Button label size**: increased "5h" / "7d" labels from 12px to 14px for better legibility on small physical buttons.
- **Rollup output format**: switched from CommonJS to ES modules to align with `package.json`'s `"type": "module"`.
- **CI: beta artifacts on PRs**: every pull request now builds and attaches an installable `.streamDeckPlugin` bundle (versioned `X.Y.Z-beta<PR#>`) for manual testing.
- **No-data state on HTTP 429**: buttons now show `–%` (neutral) instead of `err` (red) when the API returns rate-limited before `claude` has been launched.
- **Extended test suite**: 133 tests across 4 files covering renderer, credentials, usage-api, and poller modules.

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

[0.3.0]: https://github.com/alxbck/claude-deck/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/alxbck/claude-deck/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/alxbck/claude-deck/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/alxbck/claude-deck/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/alxbck/claude-deck/releases/tag/v0.1.0
