# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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

### Changed
- **Unit test suite** (Vitest): 96 tests across 4 test files covering `renderer.ts`, `credentials.ts`, `usage-api.ts`, and `poller.ts`
  - `renderer.test.ts`: SVG generation, colour thresholds, percent clamping, gauge bar, XML escaping, all state kinds
  - `credentials.ts`: `parseCredentialsJson` edge cases, file-based reading, macOS Keychain path and fallback
  - `usage-api.test.ts`: `parseUtilization` / `parseResetsAt` field-name resilience, fetch normalisation, caching TTL, deduplication, error handling
  - `poller.test.ts`: `computeImage` routing logic for all billing type / data availability combinations

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

[0.2.1]: https://github.com/alxbck/claude-deck/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/alxbck/claude-deck/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/alxbck/claude-deck/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/alxbck/claude-deck/releases/tag/v0.1.0
