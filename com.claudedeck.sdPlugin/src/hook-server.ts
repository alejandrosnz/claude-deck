/**
 * HTTP server that receives Claude Code PreToolUse and PostToolUse hooks.
 *
 * ── Flow ──────────────────────────────────────────────────────────────────────
 *
 * 1. Claude Code is about to execute a tool → POST /hook  (PreToolUse)
 * 2. Server responds IMMEDIATELY with permissionDecision: "ask"
 *    → Claude Code shows its own y/n permission prompt in the terminal
 *    → Server stores the request in the pending map and lights up deck buttons
 *
 * 3a. User responds in the terminal:
 *     → Claude Code fires PostToolUse → POST /hook-post
 *     → Server removes the pending entry and turns off deck buttons
 *
 * 3b. User presses Accept/Reject on the Stream Deck:
 *     → accept.ts / reject.ts call respondToHook('allow' | 'deny')
 *     → Server removes the pending entry and turns off deck buttons
 *     → PTY bridge sends "y\n" or "n\n" to the claude terminal
 *
 * ── Hook config (add to ~/.claude/settings.json) ──────────────────────────────
 *
 *   {
 *     "hooks": {
 *       "PreToolUse": [{
 *         "hooks": [{ "type": "http", "url": "http://localhost:27632/hook", "timeout": 65 }]
 *       }],
 *       "PostToolUse": [{
 *         "hooks": [{ "type": "http", "url": "http://localhost:27632/hook-post", "timeout": 5, "async": true }]
 *       }]
 *     }
 *   }
 *
 * ── Response format (PreToolUse "ask") ────────────────────────────────────────
 *
 *   {
 *     "hookSpecificOutput": {
 *       "hookEventName": "PreToolUse",
 *       "permissionDecision": "ask",
 *       "permissionDecisionReason": "Pending Stream Deck approval"
 *     }
 *   }
 *
 * ── Fail-open design ──────────────────────────────────────────────────────────
 * If the plugin is not running, the HTTP connection fails and Claude Code
 * treats it as a non-blocking error — the permission prompt still appears in
 * the terminal as normal (no functionality is lost).
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import streamDeck from '@elgato/streamdeck';
import {
  addPendingRequest,
  resolvePending,
  getMostRecent,
  clearAllPending,
  type PendingRequest,
} from './pending-requests';
import { sendToClaudeTerminal } from './pty-bridge';

// ── Types ─────────────────────────────────────────────────────────────────────

export type HookDecision = 'allow' | 'deny';

export interface PreToolUsePayload {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  session_id?: string;
  tool_use_id?: string;
}

export interface HookState {
  /** Whether at least one PreToolUse is waiting for a decision. */
  hasPending: boolean;
  /** Tool name of the most recent pending request, e.g. "Bash", "Write". */
  toolName?: string;
  /** Truncated command / file path shown on the button (≤ 22 chars + ellipsis). */
  subtext?: string;
}

type StateListener = (state: HookState) => void;

// ── Module-level state ────────────────────────────────────────────────────────

let currentState: HookState = { hasPending: false };
const listeners = new Set<StateListener>();
/** Counter used when the PreToolUse payload omits tool_use_id. */
let autoIdCounter = 0;

// ── Internal helpers ──────────────────────────────────────────────────────────

function setState(state: HookState): void {
  currentState = state;
  for (const l of listeners) {
    try { l(state); } catch { /* never let a listener crash the server */ }
  }
}

/**
 * Derive the displayed HookState from whatever is currently in the pending
 * map.  If the map is empty the state goes idle; otherwise it shows the most
 * recently added entry.
 */
function updateStateFromPending(): void {
  const latest = getMostRecent();
  if (latest) {
    setState({
      hasPending: true,
      toolName: latest.tool_name,
      subtext: extractSubtext(latest.tool_input),
    });
  } else {
    setState({ hasPending: false });
  }
}

function extractSubtext(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const raw =
    (typeof input['command']   === 'string' ? input['command']   : null) ??
    (typeof input['file_path'] === 'string' ? input['file_path'] : null) ??
    (typeof input['path']      === 'string' ? input['path']      : null) ??
    (typeof input['content']   === 'string' ? input['content']   : null);
  if (!raw) return undefined;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  return trimmed.length > 22 ? `${trimmed.slice(0, 22)}…` : trimmed;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns the current hook state (pending / idle). */
export function getHookState(): HookState {
  return currentState;
}

/**
 * Subscribe to hook state changes.
 * Returns an unsubscribe function.
 */
export function onHookStateChange(listener: StateListener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Called when the user presses Accept or Reject on the Stream Deck.
 *
 * Finds the most recent pending request, removes it from the map, updates the
 * button state, then fires-and-forgets the PTY bridge to inject the
 * corresponding keystroke into the claude terminal.
 *
 * @returns `true` if there was a pending request; `false` when idle.
 */
export function respondToHook(decision: HookDecision): boolean {
  const pending = getMostRecent();
  if (!pending) return false;

  resolvePending(pending.tool_use_id);
  updateStateFromPending();

  const input: 'y\n' | 'n\n' = decision === 'allow' ? 'y\n' : 'n\n';
  void sendToClaudeTerminal(input).catch((err: unknown) => {
    streamDeck.logger.error(`[claude-deck] PTY injection error: ${err}`);
  });

  return true;
}

/** Reset all module-level state.  Used by tests only. */
export function _resetForTesting(): void {
  currentState = { hasPending: false };
  listeners.clear();
  clearAllPending();
  autoIdCounter = 0;
}

// ── HTTP server ───────────────────────────────────────────────────────────────

export function startHookServer(port = 27632): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      } catch { /* treat unparseable body as empty object */ }

      if (req.url === '/hook') {
        handlePreToolUse(body, res);
      } else if (req.url === '/hook-post') {
        handlePostToolUse(body, res);
      } else {
        res.writeHead(404).end();
      }
    });
  });

  server.listen(port, '127.0.0.1', () => {
    streamDeck.logger.info(`[claude-deck] Hook server listening on http://127.0.0.1:${port}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      streamDeck.logger.warn(
        `[claude-deck] Hook server port ${port} is already in use — ` +
          'Accept/Reject buttons will not function.',
      );
    } else {
      streamDeck.logger.error(`[claude-deck] Hook server error: ${err.message}`);
    }
  });
}

// ── Route handlers ────────────────────────────────────────────────────────────

function handlePreToolUse(body: Record<string, unknown>, res: ServerResponse): void {
  const toolName  = typeof body['tool_name']   === 'string' ? body['tool_name']   : 'Tool';
  const toolUseId = typeof body['tool_use_id'] === 'string' ? body['tool_use_id'] : `auto-${++autoIdCounter}`;
  const toolInput =
    body['tool_input'] !== null && typeof body['tool_input'] === 'object'
      ? (body['tool_input'] as Record<string, unknown>)
      : {};

  const req: PendingRequest = {
    tool_use_id: toolUseId,
    tool_name:   toolName,
    tool_input:  toolInput,
    timestamp:   Date.now(),
  };

  addPendingRequest(req, (_expiredId) => {
    // Timeout fired — update state to next pending entry or idle.
    updateStateFromPending();
  });

  // Immediately update button state (don't wait for the next pending update).
  setState({ hasPending: true, toolName, subtext: extractSubtext(toolInput) });

  // Respond immediately with "ask" — Claude Code shows its native y/n prompt.
  const responseBody = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: 'Pending Stream Deck approval',
    },
  });
  const buf = Buffer.from(responseBody, 'utf-8');
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': String(buf.byteLength),
  });
  res.end(buf);
}

function handlePostToolUse(body: Record<string, unknown>, res: ServerResponse): void {
  const toolUseId = typeof body['tool_use_id'] === 'string' ? body['tool_use_id'] : '';

  if (toolUseId) {
    const resolved = resolvePending(toolUseId);
    if (resolved) {
      streamDeck.logger.info(
        `[claude-deck] PostToolUse: resolved pending ${toolUseId} (user responded in terminal)`,
      );
      updateStateFromPending();
    }
  }

  // PostToolUse hooks should get a quick empty-200 response.
  res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
}
