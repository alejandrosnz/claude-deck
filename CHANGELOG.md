# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Accept button** (`com.claudedeck.accept`): new keypad action that approves the pending Claude Code permission request when pressed. Shows a dim checkmark when idle and a bright green checkmark when a request is waiting.
- **Reject button** (`com.claudedeck.reject`): new keypad action that denies the pending Claude Code permission request. Shows a dim × when idle and a bright red × when a request is waiting.
- **Hook server** (`src/hook-server.ts`): lightweight HTTP server (default port 27632) that receives Claude Code `PermissionRequest` hooks, holds the connection open until a button is pressed (or a 55-second safety timeout fires), then sends the allow/deny response back to Claude Code.
  - Uses Claude Code's native `type: "http"` hook — no shell commands or curl required; works identically on Windows, Linux, and macOS.
  - Fail-open: if the plugin is not running the HTTP connection fails and Claude Code continues as normal (non-blocking error per the Claude Code hook spec).
  - Auto-deny on 55-second timeout (safer default when the user is away from the device).
- **Renderer** (`src/renderer.ts`): added `accept` and `reject` `ButtonRenderState` kinds with active/idle visual states.
- **Icons**: `accept.svg`, `reject.svg` (and rasterised `@1x`/`@2x` PNG variants).
- **Test coverage**: `hook-server.test.ts` — 12 new tests covering state transitions, HTTP long-polling, response body format, subtext extraction/truncation, malformed JSON, and concurrent-request handling. Total test count: 108.

### Changed
- `renderer.ts`: `renderButtonImage` `label` parameter is now optional (default `''`); existing call-sites are unaffected.
- `plugin.ts`: registers `AcceptAction` and `RejectAction`; starts the hook server on startup.
- `manifest.json`: added `com.claudedeck.accept` and `com.claudedeck.reject` action entries.
- `scripts/svg-to-png.mjs`: added `accept` and `reject` to the icon list.


  - `renderer.test.ts`: SVG generation, colour thresholds, percent clamping, gauge bar, XML escaping, all state kinds
  - `credentials.ts`: `parseCredentialsJson` edge cases, file-based reading, macOS Keychain path and fallback
  - `usage-api.test.ts`: `parseUtilization` / `parseResetsAt` field-name resilience, fetch normalisation, caching TTL, deduplication, error handling
  - `poller.test.ts`: `computeImage` routing logic for all billing type / data availability combinations
- `npm test` script (`vitest run`) and `npm run test:watch` added to `com.claudedeck.sdPlugin/package.json`
- `vitest.config.ts` added to `com.claudedeck.sdPlugin/`

### Changed
- `credentials.ts`: `parseCredentialsJson` is now exported (no behaviour change; exposed for direct unit testing)
- `usage-api.ts`: `parseUtilization` and `parseResetsAt` are now exported; added `_resetStateForTesting()` internal helper
- `poller.ts`: `computeImage` is now exported (no behaviour change; exposed for direct unit testing)

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
