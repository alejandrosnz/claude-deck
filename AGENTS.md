# AGENTS.md — claude-deck

Agent and developer guide for the `claude-deck` project.

---

## Project overview

`claude-deck` is an **OpenDeck / Stream Deck plugin** that displays Claude Code usage statistics on physical control-surface buttons and (future) lets users control Claude Code from hardware.

Key points for any agent working on this codebase:

- **Plugin type**: Node.js plugin using the `@elgato/streamdeck` SDK v2 (TypeScript, compiled with Rollup)
- **Primary host**: OpenDeck (cross-platform: Windows, Linux, macOS)
- **Secondary host**: Official Elgato Stream Deck software (Windows, macOS)
- **Data source**: Anthropic usage API (`https://api.anthropic.com/api/oauth/usage`) using Claude Code's stored OAuth token
- **Cross-platform requirement**: ALL credential reading and file I/O must work on Windows **and** Linux without conditional build flags

---

## Repository layout

```
claude-deck/
├── com.claudedeck.sdPlugin/     # Plugin bundle — the deliverable
│   ├── assets/
│   │   ├── manifest.json        # OpenAction / Stream Deck manifest
│   │   └── icons/               # Button icons
│   ├── src/
│   │   ├── plugin.ts            # Entry: registers actions, starts polling
│   │   ├── actions/
│   │   │   ├── usage-5h.ts      # Usage5hAction — rolling 5h window
│   │   │   └── usage-7d.ts      # Usage7dAction — rolling 7d window
│   │   ├── usage-api.ts         # Anthropic OAuth usage API client
│   │   ├── credentials.ts       # Cross-platform Claude Code credential reader
│   │   └── renderer.ts          # Button image generation (SVG → base64 PNG)
│   ├── package.json
│   ├── rollup.config.mjs
│   └── tsconfig.json
├── README.md
├── AGENTS.md                    # This file
└── references/                  # Reference material — delete before release
```

---

## Architecture

### Plugin lifecycle

```
OpenDeck / Stream Deck
        │  spawns
        ▼
   Node.js process (plugin.ts)
        │  registers
        ├── Usage5hAction
        └── Usage7dAction
                │  on willAppear
                ▼
         startPolling()          ← fetches usage every 120 s
                │
                ▼
         fetchUsage()            ← credentials.ts + usage-api.ts
                │
                ▼
         renderButton()          ← renderer.ts → base64 PNG
                │
                ▼
         instance.setImage(...)  ← OpenAction / Stream Deck SDK
```

### SDK used

`@elgato/streamdeck` v2 (the official Elgato SDK, also supported by OpenDeck). Do **not** use raw WebSocket communication — use the SDK classes.

Key SDK constructs:

```typescript
import streamDeck, { action, SingletonAction, KeyDownEvent, WillAppearEvent } from '@elgato/streamdeck';

@action({ UUID: 'com.claudedeck.usage5h' })
export class Usage5hAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> { ... }
  override async onKeyDown(ev: KeyDownEvent): Promise<void> { ... }
}

streamDeck.actions.registerAction(new Usage5hAction());
streamDeck.connect();
```

`SingletonAction` is preferred when the action manages shared state (like a single poller for all instances).

---

## Manifest

Location: `com.claudedeck.sdPlugin/assets/manifest.json`

Critical fields:

```jsonc
{
  "Name": "Claude Deck",
  "UUID": "com.claudedeck",
  "Author": "your-name",
  "Version": "0.1.0",
  "CodePath": "bin/plugin.js",          // compiled output
  "Nodejs": { "Version": "20" },        // enables Node.js mode in OpenDeck
  "OS": [
    { "Platform": "windows", "MinimumVersion": "10" },
    { "Platform": "linux" },
    { "Platform": "mac", "MinimumVersion": "12.0" }
  ],
  "Actions": [
    {
      "UUID": "com.claudedeck.usage5h",
      "Name": "Usage 5h",
      "Controllers": ["Keypad"],
      "States": [{ "Image": "icons/usage5h", "ShowTitle": false }]
    },
    {
      "UUID": "com.claudedeck.usage7d",
      "Name": "Usage 7d",
      "Controllers": ["Keypad"],
      "States": [{ "Image": "icons/usage7d", "ShowTitle": false }]
    }
  ]
}
```

**Note on `Nodejs`:** This field enables Node.js plugin support in OpenDeck. Without it, OpenDeck treats the executable as a compiled binary. The Elgato Stream Deck software also recognises this field.

---

## Claude Code usage API

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
    "utilization": 0.42,      // 0.0 – 1.0, or may be a raw number
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

**Field resilience:** The API has changed field names in the past. Parsers must tolerate:
- `utilization`, `percentage`, `percent`, `usage` as alternative keys for the same value
- `resets_at`, `resetsAt`, `reset_at`, `expires_at` as alternatives for the reset timestamp
- `null` for any numeric field (API key users may have no rate-limit data)

When `five_hour` and `seven_day` are both `null`, the user is likely on an API-key billing plan, not a subscription. Render a "no limit data" state rather than showing 0%.

### Rate limits & caching

- Cache results in memory for **120 seconds** minimum.
- On HTTP 429: read `Retry-After` header; if absent, apply exponential backoff (45 s, 90 s, 180 s, 300 s).
- On HTTP 401/403: mark the token as expired and re-read credentials from disk before the next retry.
- Never fire more than one in-flight request at a time (use a mutex or a pending-promise pattern).

---

## Cross-platform credential reading

Claude Code stores the OAuth token differently per OS.

### macOS

```bash
security find-generic-password -s "Claude Code-credentials" -w
```

Returns a JSON string:
```json
{ "claudeAiOauth": { "accessToken": "...", "expiresAt": 1234567890000 } }
```

Use `execSync` wrapped in try/catch; treat any error as "no credentials".

### Linux and Windows

Claude Code writes credentials to a JSON file. The likely path (verify against actual Claude Code behaviour):

```
~/.claude/.credentials.json
```

Same JSON shape as the macOS Keychain value. On Windows `~` resolves to `%USERPROFILE%` (`C:\Users\<name>`).

**Implementation note:** Read this file with `fs.readFileSync` — no shell commands needed, so it works in any environment (including Flatpak/Snap on Linux).

### credentials.ts contract

```typescript
export interface OAuthCredentials {
  accessToken: string;
  expiresAt?: number; // epoch ms, may be absent
}

/** Returns null if no credentials found or parsing fails. */
export async function readCredentials(): Promise<OAuthCredentials | null>
```

This function must:
1. Try the platform-appropriate source first.
2. Fall back gracefully (return `null`, no thrown errors).
3. Be callable from multiple action instances without side effects.

---

## Button image rendering

Each button is a 72×72 px image (Stream Deck standard). The plugin generates a base64-encoded PNG and calls `instance.setImage(dataUrl)`.

Recommended approach: generate an SVG string, then convert to a PNG data URL using `canvas` or a lightweight SVG renderer.

### Visual design for usage buttons

Suggested layout for a 72×72 button:

```
┌─────────────────┐
│   5h  (label)   │  ← small text, 10 px
│                 │
│   [████░░░░░]   │  ← gauge bar
│     42 %        │  ← large text, 24 px
│   resets 1h23m  │  ← small text, 9 px
└─────────────────┘
```

Colour coding (background or gauge fill):
- < 70%: green `#2ecc40`
- 70–90%: amber `#ff851b`
- > 90%: red `#ff4136`
- Disconnected / no data: grey `#555555`

---

## Adding new actions (future roadmap)

When adding **Accept**, **Change Mode**, or **Stop** actions:

1. Claude Code does not expose a public control API over HTTP or WebSocket. The only mechanism currently available to send input is through the Claude Code hooks system or by writing to a named pipe / PTY that the Claude Code process is attached to.

2. For a cross-platform approach, consider:
   - **Claude Code hooks** (`~/.claude/settings.local.json` or `settings.json`): Claude Code fires hooks as HTTP POSTs to a local server. The plugin can run a lightweight HTTP server on a configurable port and register as a hook receiver. This gives read-side state (current prompt options, mode, etc.).
   - **Sending input**: There is no official API. Possible approaches (research required): writing to a shared memory file, using the Claude Code SDK if one becomes available, or a companion CLI helper.

3. Do **not** assume `iTerm2`, `tmux`, or any macOS-specific terminal infrastructure exists. The solution must be OS-agnostic.

---

## Build commands

```bash
npm install          # install dependencies
npm run build        # compile TypeScript → dist/plugin.js via Rollup
npm run dev          # watch mode
npm run typecheck    # tsc --noEmit (no output, just type check)
npm run lint         # ESLint
```

Output: `com.claudedeck.sdPlugin/bin/plugin.js`

---

## Testing

There is no automated test suite yet. Until one is added, the smoke-test procedure is:

1. `npm run build` — must exit 0.
2. `npm run typecheck` — must exit 0.
3. Install the plugin into OpenDeck and drag a **Usage 5h** button onto a profile.
4. Verify the button shows a percentage within 3 seconds of appearing.
5. Press the button — it should refresh (brief grey flash then updated number).
6. Disconnect from the internet — button should show a "no data" indicator, not crash.

---

## Key conventions

- **No macOS-only code in the main plugin path.** Any OS-specific behaviour must be isolated in `credentials.ts` behind an `os.platform()` check.
- **All errors are silent + logged.** Actions must never throw unhandled exceptions; log with `streamDeck.logger` and degrade gracefully.
- **Button state is always re-renderable.** Store enough state so that `refreshButton()` can be called at any time and produce a correct image from cached data.
- **Single polling loop.** Even if multiple instances of the same action exist on the profile, there should be only one outbound HTTP request per 120-second window. Use a module-level singleton for the poller.
- **`references/` is read-only.** Never modify files under `references/`. They exist only to understand the ecosystem and will be deleted before the first release.
- **Changelog must be updated with every change.** Any PR or commit that modifies functionality, fixes a bug, or adds a feature must include a corresponding entry in `CHANGELOG.md` under the `[Unreleased]` section (or the next release section if one exists).

---

## Reference material

| Resource | What it contains |
|---|---|
| [OpenDeck](https://github.com/nekename/OpenDeck) | OpenDeck source — Tauri/Rust backend + SvelteKit frontend. Read `src-tauri/src/plugins/` to understand how plugins are spawned and how WebSocket messages are routed. |
| [AgentDeck](http://github.com/puritysb/AgentDeck) | The closest existing project to what we are building. Read `bridge/src/usage-api.ts` for the usage API implementation, and `plugin/src/actions/iterm-dial.ts` for how usage data drives button rendering. Note: AgentDeck is macOS-only; ignore its Keychain and `security` CLI code when targeting Linux/Windows. |
| `.agents/doc/openaction-api.md` | Complete OpenAction API specification in Markdown format. Read this for detailed information about: plugin structure, actions/instances/contexts, manifest format, registration process, clientbound/serverbound WebSocket events, settings management, and state handling. |

---

## Decisions log

| Decision | Rationale |
|---|---|
| **Node.js plugin, not Rust** | Node.js plugins work on both OpenDeck and the official Stream Deck software without recompilation. Rust would require separate binaries per platform/arch and is not supported natively by the Elgato SDK. |
| **`@elgato/streamdeck` SDK v2** | Standard SDK, supported by OpenDeck (`Nodejs` manifest key) and by Stream Deck software. Provides typed abstractions for actions, events, and `setImage`. |
| **120 s poll interval** | Matches the file-cache TTL used by AgentDeck; avoids 429 responses from the usage API when multiple instances are running. |
| **SVG → PNG rendering** | SVGs are easy to generate as template strings, are resolution-independent, and can be serialised to base64 PNG without a native canvas dependency. |
| **No dependency on AgentDeck bridge** | This plugin is standalone — it does not require AgentDeck, its daemon, or its hooks to be installed. |
