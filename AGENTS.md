# AGENTS.md — claude-deck

Agent and developer guide for the `claude-deck` project.
This document also serves as a **reusable template** for building any OpenDeck / Stream Deck plugin with Node.js and the `@elgato/streamdeck` SDK v2.

---

## Table of contents

1. [Project overview](#1-project-overview)
2. [Repository layout](#2-repository-layout)
3. [OpenDeck / Stream Deck plugin fundamentals](#3-opendeck--stream-deck-plugin-fundamentals)
4. [Architecture of this plugin](#4-architecture-of-this-plugin)
5. [Module reference](#5-module-reference)
6. [Button image rendering](#6-button-image-rendering)
7. [Cross-platform credential reading](#7-cross-platform-credential-reading)
8. [Claude Code usage API](#8-claude-code-usage-api)
9. [Build system](#9-build-system)
10. [Testing](#10-testing)
11. [CI / release pipeline](#11-ci--release-pipeline)
12. [Key conventions and anti-patterns](#12-key-conventions-and-anti-patterns)
13. [Adding new actions](#13-adding-new-actions)
14. [Decisions log](#14-decisions-log)
15. [Reference material](#15-reference-material)

---

## 1. Project overview

`claude-deck` is an **OpenDeck / Stream Deck plugin** that displays Claude Code usage statistics on physical control-surface buttons. Users can see their 5-hour and 7-day rolling usage at a glance. Pressing a button toggles a 10-second reset-time overlay showing when the limit resets.

Key facts for any agent working on this codebase:

| Property | Value |
|---|---|
| Plugin type | Node.js + TypeScript, compiled to ESM with Rollup |
| SDK | `@elgato/streamdeck` v2 (official Elgato SDK) |
| Primary host | OpenDeck (cross-platform: Windows, Linux, macOS) |
| Secondary host | Official Elgato Stream Deck software (Windows, macOS) |
| Data source | Anthropic OAuth usage API via Claude Code's stored token |
| Platform requirement | All credential reads and file I/O must work on **Windows**, **Linux**, and **macOS** |
| Current version | 0.3.0 |

---

## 2. Repository layout

```
claude-deck/                              # Workspace root
├── .agents/
│   └── doc/
│       └── openaction-api.md             # Full OpenAction API reference (971 lines) — READ THIS
├── .github/
│   └── workflows/
│       ├── push.yml                      # typecheck + lint + test + build on every push
│       ├── pr.yml                        # same + beta artifact upload on PRs
│       └── release.yml                   # build + package + GitHub Release on version tags
├── scripts/
│   ├── bump-version.mjs                  # Updates version in all 3 package.json / manifest files
│   ├── package.mjs                       # Produces .streamDeckPlugin zip artifact
│   └── svg-to-png.mjs                    # Rasterises SVG icons to 72px + 144px PNG (uses sharp)
├── com.claudedeck.sdPlugin/              # Plugin bundle — the only deliverable
│   ├── manifest.json                     # ← Plugin manifest (NOT under assets/)
│   ├── package.json
│   ├── package-lock.json
│   ├── rollup.config.mjs
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── eslint.config.js
│   ├── assets/
│   │   └── icons/                        # Button icons (SVG source + PNG 1x/2x)
│   │       ├── usage5h.svg / .png / @2x.png
│   │       └── usage7d.svg / .png / @2x.png
│   ├── bin/
│   │   └── plugin.js                     # Compiled output (ESM) — gitignored
│   └── src/
│       ├── plugin.ts                     # Entry point: registers actions, calls streamDeck.connect()
│       ├── log.ts                        # Dual logger: stdout + streamDeck.logger
│       ├── credentials.ts                # Cross-platform OAuth credential reader
│       ├── usage-api.ts                  # Anthropic API client (cache, backoff, dedup)
│       ├── renderer.ts                   # SVG button image generator + time formatters
│       ├── poller.ts                     # Singleton poller + reset-info toggle logic
│       ├── actions/
│       │   ├── usage-5h.ts               # Usage5hAction (5-hour window)
│       │   └── usage-7d.ts               # Usage7dAction (7-day window)
│       └── __tests__/
│           ├── renderer.test.ts
│           ├── credentials.test.ts
│           ├── usage-api.test.ts
│           └── poller.test.ts
├── package.json                          # Root: proxies build/test, adds package + version:bump
├── AGENTS.md                             # This file
├── CHANGELOG.md                          # Keep-a-Changelog format
└── README.md
```

**Critical:** `manifest.json` is at `com.claudedeck.sdPlugin/manifest.json` — **not** inside `assets/`.

---

## 3. OpenDeck / Stream Deck plugin fundamentals

> This section is general reference for building *any* OpenDeck / Stream Deck Node.js plugin. Skip ahead to §4 for claude-deck specifics.

### 3.1 What a plugin is

A plugin is a **process** (Node.js script, binary, or HTML5 page) spawned by the Stream Deck host. The host and the plugin communicate over a **WebSocket** using the OpenAction protocol. The `@elgato/streamdeck` SDK wraps all WebSocket mechanics; you never write raw WebSocket code.

```
Stream Deck host
     │  spawns
     ▼
Node.js process  ←→  WebSocket  ←→  Host
```

The host passes connection parameters (port, UUID, registerEvent, info JSON) as CLI arguments on startup. The SDK reads them automatically when you call `streamDeck.connect()`.

### 3.2 Manifest (`manifest.json`)

Located at the root of the plugin bundle (e.g. `com.yourplugin.sdPlugin/manifest.json`).

```jsonc
{
  "Name": "My Plugin",
  "UUID": "com.yourname.myplugin",   // Reverse-DNS, must be unique
  "Author": "Your Name",
  "Version": "1.0.0",
  "SDKVersion": 2,                   // Always 2
  "Description": "What the plugin does.",
  "Icon": "assets/icons/default",    // Path without extension
  "Category": "My Plugin",
  "CodePath": "bin/plugin.js",       // Relative to bundle root
  "Nodejs": { "Version": "20" },     // REQUIRED for Node.js plugins in OpenDeck
  "OS": [
    { "Platform": "windows", "MinimumVersion": "10" },
    { "Platform": "linux" },
    { "Platform": "mac", "MinimumVersion": "12.0" }
  ],
  "Actions": [
    {
      "UUID": "com.yourname.myplugin.myaction",  // Must start with plugin UUID
      "Name": "My Action",
      "Icon": "assets/icons/myaction",
      "Controllers": ["Keypad"],                  // "Keypad" and/or "Encoder"
      "States": [
        {
          "Image": "assets/icons/myaction",       // Default image (path without extension)
          "ShowTitle": false                       // Set false when your code drives setImage()
        }
      ]
    }
  ]
}
```

**Important notes:**
- The `"Nodejs"` field is required in OpenDeck to enable Node.js plugin mode. Without it, OpenDeck treats `CodePath` as a compiled binary.
- Image paths in `States[].Image` and `Icon` are relative to the bundle root and **without extension** — the host appends `.png` or `@2x.png` automatically.
- `SDKVersion: 2` is mandatory for the v2 SDK.

### 3.3 SDK patterns

Install: `npm install @elgato/streamdeck`

#### Registering an action

```typescript
import streamDeck, {
  action,
  SingletonAction,
  KeyDownEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from '@elgato/streamdeck';

@action({ UUID: 'com.yourname.myplugin.myaction' })
export class MyAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    await ev.action.setImage('data:image/svg+xml;base64,...');
    await ev.action.setTitle('Hello');
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    // cleanup per-instance state
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await ev.action.showOk();  // Brief checkmark overlay
  }
}

streamDeck.actions.registerAction(new MyAction());
streamDeck.connect();  // MUST be last — opens the WebSocket
```

#### `SingletonAction` vs `Action`

- **`SingletonAction`**: all instances of the action share one class instance. Preferred when managing shared state (a single poller, a single HTTP cache).
- **`Action`**: a new class instance per deck action. Use when each instance needs fully independent state.

#### `ev.action` vs instance lookup

Within event handlers, use `ev.action` to interact with the specific instance that fired the event. To interact with an arbitrary instance from outside an event handler (e.g. from a poller), use:

```typescript
const action = streamDeck.actions.getActionById(id);
if (action) await action.setImage(url);
```

#### Sending images to buttons

Always use `setImage(dataUrl)` with a data URL:

```typescript
await ev.action.setImage('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
// or PNG:
await ev.action.setImage('data:image/png;base64,' + pngBase64);
```

Button size is **72×72 px** (1x) and **144×144 px** (2x Retina). If you set a single image via `setImage`, the host uses it at both sizes. To supply separate resolutions, use static manifest `States[].Image` paths where the host will pick `icon.png` or `icon@2x.png` automatically.

#### Logging

```typescript
import streamDeck from '@elgato/streamdeck';
streamDeck.logger.info('message');
streamDeck.logger.warn('warning');
streamDeck.logger.error('error');
```

Logs go to a rotating file that the host captures. Also log to `process.stdout` for local development (they appear in the host's process monitor and in the terminal when running `node plugin.js` manually).

#### Settings persistence

```typescript
// Per-instance settings (saved per-button in the profile)
const settings = await ev.action.getSettings<MySettings>();
await ev.action.setSettings({ key: 'value' });

// Global settings (shared across all instances)
const global = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
await streamDeck.settings.setGlobalSettings({ key: 'value' });
```

### 3.4 Build pipeline

The standard build chain for Node.js plugins:

```
TypeScript (src/) → Rollup → bin/plugin.js (ESM)
```

Use **ESM output** (`format: 'esm'`). OpenDeck and the Elgato software both launch the plugin with Node.js which supports ESM natively.

```js
// rollup.config.mjs
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/plugin.ts',
  output: { file: 'bin/plugin.js', format: 'esm', sourcemap: false },
  plugins: [
    nodeResolve({ preferBuiltins: true, exportConditions: ['node'] }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json' }),
  ],
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') return; // @elgato/streamdeck has internal circulars
    warn(warning);
  },
};
```

`tsconfig.json` minimum:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

TypeScript decorators (`@action(...)`) work without any special `experimentalDecorators` flag because the `@elgato/streamdeck` package uses TC39 stage-3 decorators and ships its own declarations.

### 3.5 Plugin bundle packaging

A `.streamDeckPlugin` file is a ZIP archive containing the bundle directory. The directory name must match the plugin `UUID` + `.sdPlugin` (e.g. `com.yourname.myplugin.sdPlugin`).

```
com.yourname.myplugin.sdPlugin/
├── manifest.json
├── bin/
│   └── plugin.js
└── assets/
    └── icons/
        ├── myaction.png
        └── myaction@2x.png
```

To install locally for testing:
- **OpenDeck**: drop the `.sdPlugin` directory into the plugins directory (or double-click the `.streamDeckPlugin` file).
- **Stream Deck software**: double-click the `.streamDeckPlugin` file.

### 3.6 Testing Node.js plugins with Vitest

Since the plugin uses pure TypeScript modules, unit tests can import and test each module independently. The SDK itself is mocked.

Minimal mock for `@elgato/streamdeck`:

```typescript
vi.mock('@elgato/streamdeck', () => ({
  default: {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    actions: { getActionById: vi.fn() },
  },
  action: () => (cls: unknown) => cls,
  SingletonAction: class {},
}));
```

Use `vi.useFakeTimers()` to control polling intervals and timeouts in tests.

---

## 4. Architecture of this plugin

### Plugin lifecycle

```
OpenDeck / Stream Deck
        │  spawns  node bin/plugin.js
        ▼
   plugin.ts
        │  registers actions
        ├── Usage5hAction
        └── Usage7dAction
                │  onWillAppear → poller.registerButton(id, manifestId, ev.action)
                │  onWillDisappear → poller.unregisterButton(id)
                │  onKeyDown → poller.toggleResetInfoForButton(id)
                ▼
           poller.ts (module-level singleton)
                │  setInterval 120 s
                ▼
           fetchUsage()          ← usage-api.ts
                │  ← credentials.ts
                ▼
           computeImage()        ← renderer.ts
                │
                ▼
           action.setImage(...)  ← @elgato/streamdeck SDK
```

### Button UX

| State | Trigger | Display |
|---|---|---|
| **Loading** | Immediately on `willAppear` | `···` spinner |
| **Usage** | After first successful poll | Percent + colour gauge |
| **Reset info** | Key press (first press) | Time until reset + clock |
| **Usage** (revert) | 10 s after key press, or second key press | Back to usage view |
| **No data** | API returns null / api-key billing | `–%` placeholder |
| **Error** | Unrecoverable fetch failure | `err` |

### Singleton poller design

Only **one** `setInterval` runs regardless of how many buttons are on the profile. All button instances share the same last-fetched `UsageData`. This avoids hammering the API when the user has both a 5h and a 7d button visible simultaneously.

The poller keeps a **registry** (`Map<id, ButtonEntry>`) of all live button instances. On each tick it fetches usage once, then calls `setImage` on every registered instance.

---

## 5. Module reference

### `src/plugin.ts`

Entry point. Registers actions and calls `streamDeck.connect()`. Keep this file minimal — no logic here.

```typescript
import streamDeck from '@elgato/streamdeck';
import { Usage5hAction } from './actions/usage-5h.js';
import { Usage7dAction } from './actions/usage-7d.js';
import { logger } from './log.js';

logger.info('plugin starting');
streamDeck.actions.registerAction(new Usage5hAction());
streamDeck.actions.registerAction(new Usage7dAction());
streamDeck.connect();
```

### `src/log.ts`

Dual logger: writes to `process.stdout` (timestamped) **and** to `streamDeck.logger`. The `streamDeck.logger` call is wrapped in `try/catch` because it may not be ready at startup. Use this logger everywhere in the plugin instead of `console.log`.

```typescript
import { logger } from './log.js';
logger.info('message');
logger.warn('warning');
logger.error('error string or Error object');
```

### `src/actions/usage-5h.ts` and `usage-7d.ts`

Thin action wrappers. All logic lives in `poller.ts`. The actions only:
1. Call `registerButton` on `willAppear`
2. Call `unregisterButton` on `willDisappear`
3. Call `toggleResetInfoForButton` on `keyDown`

### `src/poller.ts`

Module-level singleton. Key exports:

| Export | Signature | Description |
|---|---|---|
| `registerButton` | `(id, manifestId, keyAction)` | Adds to registry, starts polling if idle |
| `unregisterButton` | `(id)` | Removes from registry, stops polling if registry is empty |
| `manualRefresh` | `()` | `invalidateCache()` + immediate poll |
| `toggleResetInfoForButton` | `(id)` | First press: shows reset overlay + 10 s auto-revert. Second press: cancels timer + reverts immediately |
| `computeImage` | `(manifestId, data)` | Returns a `setImage`-ready URL for the usage view |
| `computeResetImage` | `(manifestId, data)` | Returns a `setImage`-ready URL for the reset-info view |
| `_resetPollerStateForTesting` | `()` | Resets all module state — **tests only** |

Constants: `POLL_INTERVAL_MS = 120_000`, `RESET_INFO_DURATION_MS = 10_000`, `INITIAL_RETRY_MS = 15_000`.

**Initial-retry logic:** If `lastData` is still `null` after the first poll (no credentials or no network), the next poll fires after 15 s instead of 120 s, giving the plugin a fast recovery path.

### `src/usage-api.ts`

Anthropic OAuth usage API client. Key exports:

| Export | Description |
|---|---|
| `fetchUsage()` | Main entry point; returns `UsageData \| null`; cached 120 s; deduplicates concurrent calls |
| `invalidateCache()` | Forces the next `fetchUsage()` call to bypass the cache |
| `parseUtilization(obj)` | Tolerates key aliases: `utilization`, `percentage`, `percent`, `usage`; normalises 0–1 → 0–100 |
| `parseResetsAt(obj)` | Tolerates key aliases: `resets_at`, `resetsAt`, `reset_at`, `expires_at` |
| `_resetStateForTesting()` | Resets module state — **tests only** |

`UsageData` shape:

```typescript
interface UsageData {
  fiveHourPercent: number | null;
  fiveHourResetsAt: string | null;
  sevenDayPercent: number | null;
  sevenDayResetsAt: string | null;
  inferredBillingType: 'subscription' | 'api';
}
```

HTTP error handling:
- **401/403**: re-reads credentials on next attempt
- **429**: reads `Retry-After` header; returns stale cache if available
- **5xx / network error**: returns stale cache or `null`
- **No credentials**: returns `null`

### `src/credentials.ts`

Cross-platform OAuth credential reader. See §7 for full details.

### `src/renderer.ts`

Pure SVG button image generator. See §6 for full details.

---

## 6. Button image rendering

### Output format

`renderButtonImage` returns a `data:image/svg+xml;base64,...` URL. No native binary dependencies — pure string manipulation + `Buffer.from().toString('base64')`.

### `ButtonRenderState` type

```typescript
type ButtonRenderState =
  | { kind: 'usage';   percent: number; resetsAt: string | null }
  | { kind: 'reset';   remaining: string; resetTime: string }
  | { kind: 'loading' }
  | { kind: 'nodata' }
  | { kind: 'error' };
```

### Main API

```typescript
renderButtonImage(state: ButtonRenderState, label: string): string
svgToDataUrl(svg: string): string
formatRemaining(resetsAt: string): string   // e.g. "1h 30m", "< 1m", "now"
formatResetTime(resetsAt: string, is5h: boolean): string  // "14:30" or "Wed 14:30"
```

### Visual layout (72×72 px, background `#111111`)

**Usage view:**

```
┌────────────────────────┐
│  5h            y=16    │  ← 14px bold grey
│                        │
│        42 %    y=47    │  ← 28px bold, colour-coded
│  [████████░░]  y=56    │  ← 64×12px gauge bar
└────────────────────────┘
```

**Reset-info view (on key press):**

```
┌────────────────────────┐
│  resets in     y=17    │  ← 13px grey
│                        │
│    1h 30m      y=46    │  ← 24px bold white
│      14:30     y=65    │  ← 15px bold grey (HH:MM or DDD HH:MM)
└────────────────────────┘
```

### Colour thresholds

| Percent | Colour | Hex |
|---|---|---|
| ≤ 70% | Green | `#2ecc40` |
| 71–90% | Amber | `#ff851b` |
| > 90% | Red | `#ff4136` |
| No data / loading / disconnected | Grey | `#555555` |

### Adding new visual states

1. Add a new variant to `ButtonRenderState` in `renderer.ts`.
2. Add a rendering branch in `renderButtonImage`.
3. Add tests in `renderer.test.ts` (every state kind must have coverage).
4. Update `computeImage` / `computeResetImage` in `poller.ts` to produce the new state when appropriate.

---

## 7. Cross-platform credential reading

### Storage location per OS

| OS | Storage | Path / command |
|---|---|---|
| macOS | Keychain | `security find-generic-password -s "Claude Code-credentials" -w` |
| Linux | File | `~/.claude/.credentials.json` (and 3 fallback paths) |
| Windows | File | `%USERPROFILE%\.claude\.credentials.json` (and 3 fallback paths) |

The JSON credential format is the same on all platforms:

```json
{ "claudeAiOauth": { "accessToken": "sk-ant-...", "expiresAt": 1234567890000 } }
```

### File fallback chain (Linux + Windows, and macOS fallback)

The implementation tries four paths in order, returning the first that parses successfully:

1. `~/.claude/.credentials.json`
2. `~/.claude/credentials.json`
3. `~/.config/claude/credentials.json`
4. `~/.config/claude/.credentials.json`

On Windows, `~` resolves to `%USERPROFILE%` (`os.homedir()` in Node.js).

### `credentials.ts` contract

```typescript
export interface OAuthCredentials {
  accessToken: string;
  expiresAt?: number;   // epoch ms; may be absent
}

/** Never throws. Returns null if no credentials found or parsing fails. */
export async function readCredentials(): Promise<OAuthCredentials | null>

/** Exported for unit testing. Parses the JSON blob directly. */
export function parseCredentialsJson(raw: string): OAuthCredentials | null
```

**Rules:**
- Never throw from `readCredentials`. Wrap all I/O in `try/catch`.
- Use `fs.readFileSync` for file reads (no shell exec needed on Linux/Windows).
- Use `execSync` only for the macOS Keychain call, wrapped in `try/catch`.

---

## 8. Claude Code usage API

### Endpoint

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <access_token>
anthropic-beta: oauth-2025-04-20
Accept: application/json
```

### Response shape (as of May 2026)

```jsonc
{
  "five_hour": {
    "utilization": 0.42,          // 0.0–1.0; may also be >1 (rare)
    "resets_at": "2026-05-12T18:00:00Z"
  },
  "seven_day": {
    "utilization": 0.15,
    "resets_at": "2026-05-19T00:00:00Z"
  },
  "extra_usage": {
    "is_enabled": false,
    "monthly_limit": null,
    "used_credits": null
  }
}
```

### Field resilience

The API has changed field names in the past. The parser must tolerate:

| Value type | Accepted keys |
|---|---|
| Utilisation | `utilization`, `percentage`, `percent`, `usage` |
| Reset timestamp | `resets_at`, `resetsAt`, `reset_at`, `expires_at` |

When `five_hour` and `seven_day` are both `null`, the user is on API-key billing (no rate-limit data). Set `inferredBillingType: 'api'` and render the no-data state — do **not** show 0%.

---

## 9. Build system

### Commands

All commands run inside `com.claudedeck.sdPlugin/` unless noted as (root).

```bash
# Inside com.claudedeck.sdPlugin/
npm install          # install dependencies
npm run build        # TypeScript → bin/plugin.js (ESM) via Rollup
npm run dev          # watch mode (Rollup --watch)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm test             # vitest run (single pass)
npm run test:watch   # vitest watch mode

# At repository root
npm run build        # proxies to plugin dir
npm run typecheck    # proxies to plugin dir
npm run lint         # proxies to plugin dir
npm test             # proxies to plugin dir
npm run package      # produces com.claudedeck.streamDeckPlugin zip
npm run version:bump # updates version in all 3 package.json + manifest.json files
```

### Output

`com.claudedeck.sdPlugin/bin/plugin.js` — single ESM bundle. The first line should be `import ...`; CI fails the build if it is not.

### Versioning

Version is stored in three files that must always be in sync:

1. `package.json` (root) — `"version"`
2. `com.claudedeck.sdPlugin/package.json` — `"version"`
3. `com.claudedeck.sdPlugin/manifest.json` — `"Version"`

Always use `npm run version:bump` (runs `scripts/bump-version.mjs`) to update all three at once. Never edit version numbers manually.

### Icon pipeline

SVG source icons live in `com.claudedeck.sdPlugin/assets/icons/*.svg`. To regenerate PNG assets:

```bash
# At repository root
node scripts/svg-to-png.mjs
```

This produces `icon.png` (72×72) and `icon@2x.png` (144×144) for each SVG. The script uses `sharp` (dev dependency at root).

---

## 10. Testing

### Framework and location

**Vitest** (v4+). Tests live in `com.claudedeck.sdPlugin/src/__tests__/`.

```bash
npm test           # inside com.claudedeck.sdPlugin/
```

Current coverage: **133 tests** across 4 test files.

### Test file overview

| File | What it tests |
|---|---|
| `renderer.test.ts` | All 6 `ButtonRenderState` kinds; colour thresholds at exact boundaries; percent clamping; gauge bar rect count; XML escaping of `& < > " '`; `formatRemaining` edge cases; `formatResetTime` formatting |
| `credentials.test.ts` | `parseCredentialsJson` valid/invalid JSON and missing fields; `readCredentials` file fallback chain on Linux; macOS Keychain path; Keychain failure falling back to file |
| `usage-api.test.ts` | `parseUtilization` and `parseResetsAt` field-name aliases; 0–1 normalisation; `inferredBillingType` detection; HTTP 401/403/429/5xx; network errors; stale-cache behaviour; 120 s cache TTL; in-flight deduplication |
| `poller.test.ts` | `computeImage` routing (null/api/null-percent/valid); `computeResetImage` routing; `toggleResetInfoForButton` toggle, 10 s auto-revert, second-press cancellation, poll-during-reset-info skipping |

### Mock patterns

**Mock `@elgato/streamdeck` in every test file that imports plugin code:**

```typescript
vi.mock('@elgato/streamdeck', () => ({
  default: {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    actions: { getActionById: vi.fn() },
  },
  action: () => (cls: unknown) => cls,
  SingletonAction: class {},
}));
```

**Use `vi.hoisted` for mocks that must be set before module evaluation:**

```typescript
const mockReadCredentials = vi.hoisted(() => vi.fn());
vi.mock('../credentials', () => ({ readCredentials: mockReadCredentials }));
```

**Always call `_resetXxxForTesting()` in `beforeEach`/`afterEach`** for modules with module-level singletons (`usage-api.ts` and `poller.ts`).

**Use fake timers for polling tests:**

```typescript
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
```

### Writing new tests

- Every new exported function needs unit tests.
- Every new `ButtonRenderState` variant needs renderer tests.
- Every new HTTP response shape or error code needs `usage-api.test.ts` coverage.
- Run `npm test` before committing. All 133+ tests must pass.

---

## 11. CI / release pipeline

### Workflow files

| File | Trigger | Steps |
|---|---|---|
| `push.yml` | Push to `master` | typecheck → lint → test → build → verify ESM output |
| `pr.yml` | Pull request | same + upload `com.claudedeck.streamDeckPlugin` as PR artifact |
| `release.yml` | Push of `v*` tag | build → package → create GitHub Release with `.streamDeckPlugin` attachment |

### Release procedure

1. Update `CHANGELOG.md` — move `[Unreleased]` items to a new version section with today's date.
2. Run `npm run version:bump` at the repo root and enter the new version.
3. Commit: `git commit -am "chore: release vX.Y.Z"`.
4. Tag: `git tag vX.Y.Z`.
5. Push: `git push && git push --tags`.
6. CI creates the GitHub Release automatically.

---

## 12. Key conventions and anti-patterns

### Conventions

- **All errors are silent + logged.** Actions must never throw unhandled exceptions. Catch everything, log with `logger`, and degrade gracefully (show `error` or `nodata` state).
- **Single polling loop.** One `setInterval` for all button instances. Never create a poller per action instance.
- **Button state is always re-renderable.** Store the last `UsageData` at module level so any call to the render path produces a correct image without a new HTTP request.
- **No macOS-only code outside `credentials.ts`.** Any OS-specific behaviour must be isolated behind `os.platform()`.
- **`references/` is read-only.** Never modify files under `references/`. They will be deleted before release.
- **Changelog must be updated with every functional change.** Add entries under `[Unreleased]` in `CHANGELOG.md`.
- **ESM output only.** The compiled `bin/plugin.js` must start with `import`. Never switch Rollup output to CJS.

### Anti-patterns to avoid

| Anti-pattern | Why | Instead |
|---|---|---|
| Raw WebSocket communication | Fragile, breaks on SDK updates | Use `@elgato/streamdeck` SDK |
| `streamDeck.connect()` before all `registerAction` calls | Actions registered after connect are silently ignored | Always register all actions first |
| Creating pollers inside action constructors | Multiple deck instances → multiple HTTP loops | Use a module-level singleton |
| `throw` inside `onWillAppear` / `onKeyDown` | Crashes the process | `try/catch` + graceful degradation |
| Hardcoding `%USERPROFILE%` or `/home/user` paths | Breaks cross-platform | Use `os.homedir()` |
| `execSync` for file reads on Linux/Windows | Unnecessary shell dependency | Use `fs.readFileSync` |
| Reading `manifest.json` at runtime | Manifest is a host concern | Hardcode UUIDs as constants |
| `console.log` directly | Bypasses log routing | Use `logger` from `log.ts` |
| Editing version numbers in individual files | Version drift | Use `npm run version:bump` |

---

## 13. Adding new actions

### Steps for a new action type

1. Create `src/actions/my-action.ts`:

```typescript
import { action, SingletonAction, WillAppearEvent, WillDisappearEvent, KeyDownEvent } from '@elgato/streamdeck';
import { registerButton, unregisterButton, toggleResetInfoForButton } from '../poller.js';

@action({ UUID: 'com.claudedeck.myaction' })
export class MyAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    registerButton(ev.action.id, 'com.claudedeck.myaction', ev.action);
  }
  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    unregisterButton(ev.action.id);
  }
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    toggleResetInfoForButton(ev.action.id);
  }
}
```

2. Add an `Actions` entry to `manifest.json`.
3. Register the action in `plugin.ts`.
4. If the action needs a different label/data: extend `computeImage` in `poller.ts` to handle the new `manifestId`.
5. Add icons: create SVG in `assets/icons/`, run `node scripts/svg-to-png.mjs`.
6. Write tests.

### Control actions (future roadmap)

When adding **Accept**, **Change Mode**, or **Stop** actions:

- Claude Code does not expose a public control HTTP/WebSocket API. Input must be sent through the Claude Code hooks system or by writing to the process's PTY/stdin.
- For cross-platform input: investigate the Claude Code hooks system (`~/.claude/settings.json`) — hooks fire as HTTP POSTs to a local server. The plugin can run a lightweight express/fastify server on a configurable port.
- Do **not** assume macOS-specific terminal infrastructure (`iTerm2`, `tmux`). The solution must be OS-agnostic.

---

## 14. Decisions log

| Decision | Rationale |
|---|---|
| **Node.js plugin, not compiled binary** | Works on OpenDeck + Stream Deck software without recompilation per platform/arch. Elgato SDK is Node.js-first. |
| **`@elgato/streamdeck` SDK v2** | Official SDK with typed abstractions. OpenDeck supports it via the `Nodejs` manifest field. |
| **`SingletonAction` for both actions** | Both actions share a single polling loop; there is no per-instance state to separate. |
| **Module-level singleton poller** | Prevents multiple HTTP loops when several instances of the same action exist on the profile. |
| **120 s poll interval** | Balances freshness against 429 rate-limit risk when both buttons are on the profile simultaneously. |
| **SVG → base64 data URL (no PNG conversion)** | SVGs generate as template strings, require no native binary (`canvas`, `sharp`), and are resolution-independent. The host renders them correctly. |
| **ESM bundle output** | Node.js 20+ supports ESM natively; the `@elgato/streamdeck` package is ESM-first; CJS interop adds unnecessary complexity. |
| **`references/` directory** | Holds ecosystem reference material during development; will be deleted before the first public release. |
| **Dual logger (`log.ts`)** | `streamDeck.logger` writes to the host log file (good for production debugging); `process.stdout` is visible in local terminal sessions and CI. |
| **No dependency on AgentDeck bridge** | This plugin is fully standalone — no AgentDeck daemon, hooks, or bridge process required. |

---

## 15. Reference material

| Resource | What it contains |
|---|---|
| `.agents/doc/openaction-api.md` | Complete OpenAction API specification (971 lines). Read this for: plugin structure, actions/instances/contexts, manifest schema, registration process, all clientbound/serverbound WebSocket events, settings management, and state handling. |
| [OpenDeck](https://github.com/nekename/OpenDeck) | OpenDeck source (Tauri/Rust + SvelteKit). Read `src-tauri/src/plugins/` to understand how plugins are spawned and how WebSocket messages are routed. |
| [AgentDeck](https://github.com/puritysb/AgentDeck) | Closest existing project to this one. Read `bridge/src/usage-api.ts` for usage API implementation, and `plugin/src/actions/iterm-dial.ts` for button rendering patterns. **Note:** AgentDeck is macOS-only — ignore its Keychain and `security` CLI code when targeting Linux/Windows. |
| [Elgato Stream Deck SDK docs](https://docs.elgato.com/sdk) | Official SDK documentation for the `@elgato/streamdeck` v2 package. |
