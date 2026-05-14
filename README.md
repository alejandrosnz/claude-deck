# claude-deck

An OpenDeck / Stream Deck plugin that shows Claude Code usage stats on your control surface and (in the future) lets you control Claude Code directly from hardware buttons.

> Compatible with **OpenDeck** (Windows, Linux, macOS) and the official **Elgato Stream Deck** software.

---

## What it does

### Current actions

| Action | Controller | Description |
|---|---|---|
| **Usage 5h** | Keypad | Shows the rolling 5-hour token usage as a percentage and time-to-reset. Button colour shifts green → amber → red as the limit approaches. |
| **Usage 7d** | Keypad | Shows the rolling 7-day token usage as a percentage and time-to-reset. Same colour logic. |

Both buttons refresh automatically every 2 minutes and on press (manual refresh).

### Planned actions (future versions)

| Action | Controller | Description |
|---|---|---|
| **Accept** | Keypad | Sends the "yes / accept" answer to Claude Code's current permission prompt. |
| **Change Mode** | Keypad | Cycles between Claude Code modes: `plan` → `build` (auto/accept edits) → default. |
| **Reject / Stop** | Keypad | Sends Ctrl+C to stop a running session. |

---

## Compatibility

| Software | Status |
|---|---|
| **OpenDeck** (Linux, Windows, macOS) | Primary target |
| **Elgato Stream Deck** software (Windows, macOS) | Supported — Node.js plugin |
| **Tacto** (OpenAction derivative) | Should work |

The plugin is written as a **Node.js plugin** using the standard Stream Deck SDK v2 (`@elgato/streamdeck`). This makes it compatible with both OpenDeck (which supports Node.js plugins natively) and the official Elgato software.

---

## Installation

### Prerequisites

- [OpenDeck](https://github.com/nekename/OpenDeck) installed, **or** the Elgato Stream Deck software (≥ 6.7)
- Node.js ≥ 20 (required by OpenDeck for Node.js plugins, or bundled by Stream Deck)
- Claude Code CLI installed and logged in (`claude login`)

### From GitHub Releases (recommended)

1. Go to the [Releases page](../../releases/latest) and download `claude-deck-<version>.streamDeckPlugin`.

2. Install the plugin:

**OpenDeck — via UI (all platforms)**

Open OpenDeck → Settings → **Plugins** tab → click **Add plugin** → select the downloaded `.streamDeckPlugin` file. Restart OpenDeck when prompted.

**OpenDeck — manual install**

The `.streamDeckPlugin` file is a ZIP archive. Unzip it directly into the OpenDeck plugins directory and restart OpenDeck.

*Linux / macOS:*
```bash
unzip claude-deck-<version>.streamDeckPlugin -d ~/.config/opendeck/plugins/
```

*Windows:*
```powershell
Expand-Archive claude-deck-<version>.streamDeckPlugin -DestinationPath "$env:APPDATA\opendeck\plugins\"
```

**Elgato Stream Deck software (Windows / macOS)**

Double-click the `.streamDeckPlugin` file. The Stream Deck software opens automatically and installs it.

3. Drag the **Usage 5h** or **Usage 7d** action from the action list onto any button slot.

### From source

```bash
git clone https://github.com/your-handle/claude-deck
cd claude-deck/com.claudedeck.sdPlugin
npm install
npm run build
```

Then install the built plugin directory into your plugins folder using the manual steps above (the `com.claudedeck.sdPlugin` directory is the bundle).

---

## How to use

1. Drag a **Usage 5h** or **Usage 7d** button onto any key slot in your profile.
2. The button will show a loading indicator briefly, then display the current usage percentage and a colour-coded gauge.
3. **Press the button** at any time to see how long until the usage window resets. The overlay stays for 10 seconds, or disappears immediately on a second press.

> **Prerequisite:** Claude Code must have been run at least once on this machine and you must be logged in (`claude login`). The plugin reads the OAuth credentials that Claude Code stores locally — if they do not exist yet, the button will stay in the loading state until they are created.

---

## How it works

### Data source — Claude Code Usage API

Usage data is fetched from the Anthropic API:

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <claude_code_oauth_token>
anthropic-beta: oauth-2025-04-20
```

Response fields used:

```jsonc
{
  "five_hour": { "utilization": 0.42, "resets_at": "2026-05-12T18:00:00Z" },
  "seven_day": { "utilization": 0.15, "resets_at": "2026-05-19T00:00:00Z" }
}
```

### Credential discovery (cross-platform)

Claude Code stores OAuth credentials differently per OS:

| Platform | Location |
|---|---|
| macOS | macOS Keychain, service `Claude Code-credentials` |
| Linux / Windows | `~/.claude/.credentials.json` (JSON file written by Claude Code) |

The plugin reads the appropriate source at startup and whenever a fetch fails with a 401.

### Poll strategy

- Credentials are read once at startup and re-read on auth failure.
- Usage is fetched every **120 seconds** (respects the Anthropic rate limit).
- On 429, the plugin backs off (45 s → 90 s → 180 s → 300 s).
- Results are cached in memory; the button updates immediately after each fetch.

---

## Development

```bash
npm run dev        # watch mode — rebuilds on file change
npm run build      # production build
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

### Pre-commit checklist

1. `npm run typecheck` — no TypeScript errors
2. `npm run lint` — no ESLint violations
3. `npm run build` — clean build
4. Manual smoke-test: drag action onto a button and confirm it shows usage data

---

## Roadmap

- [x] 5-hour usage widget
- [x] 7-day usage widget
- [ ] Accept button (send approval to current permission prompt)
- [ ] Change mode button (plan / build / default cycle)
- [ ] Reject / Stop button (Ctrl+C)
- [ ] Usage history graph (mini sparkline on button image)
- [ ] Configurable refresh interval via Property Inspector
- [ ] Token / cost display variant

---

## Project structure

```
claude-deck/
├── com.claudedeck.sdPlugin/     # Plugin bundle (OpenAction .sdPlugin directory)
│   ├── assets/
│   │   ├── manifest.json        # Plugin manifest
│   │   └── icons/               # Button icons (SVG + PNG)
│   ├── src/
│   │   ├── plugin.ts            # Entry point, registers actions
│   │   ├── actions/
│   │   │   ├── usage-5h.ts      # 5-hour usage button action
│   │   │   └── usage-7d.ts      # 7-day usage button action
│   │   ├── usage-api.ts         # Claude Code OAuth API client
│   │   ├── credentials.ts       # Cross-platform credential reader
│   │   └── renderer.ts          # Button image generator (Canvas/SVG)
│   ├── package.json
│   ├── rollup.config.mjs
│   └── tsconfig.json
├── README.md
└── AGENTS.md
```

---

## Acknowledgements

- [AgentDeck](https://github.com/puritysb/AgentDeck) — reference implementation for Claude Code integration and usage API details
- [OpenDeck](https://github.com/nekename/OpenDeck) — the OpenAction server this plugin targets
- [OpenAction API](https://openaction.amankhanna.me/) — plugin API specification
- [Elgato Stream Deck SDK v2](https://developer.elgato.com/documentation/stream-deck/sdk/overview/) — base SDK used by this plugin
