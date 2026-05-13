/**
 * HTTP server that receives Claude Code PermissionRequest hooks.
 *
 * When Claude Code is about to show a permission dialog it POSTs the request
 * to this server (if configured).  The server holds the connection open until
 * the user presses the Accept or Reject button on the Stream Deck, or until a
 * 55-second safety timeout fires.
 *
 * ── Why HTTP hooks, not command hooks? ──────────────────────────────────────
 * Claude Code supports a native `type: "http"` hook that posts JSON directly
 * to a URL.  No curl, no shell, works identically on Windows / Linux / macOS.
 *
 * ── Fail-open design ─────────────────────────────────────────────────────────
 * From the Claude Code docs:
 *   "non-2xx responses, connection failures, and timeouts all produce
 *    non-blocking errors that allow execution to continue."
 * So if the plugin is not running the hook silently passes and Claude Code
 * behaves exactly as it would without the hook configured.
 *
 * ── Hook config the user must add to ~/.claude/settings.json ─────────────────
 *
 *   {
 *     "hooks": {
 *       "PermissionRequest": [
 *         {
 *           "hooks": [
 *             {
 *               "type": "http",
 *               "url": "http://localhost:27632/hook",
 *               "timeout": 65
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *   }
 *
 * ── Response format ───────────────────────────────────────────────────────────
 * Allow:
 *   { "hookSpecificOutput": { "hookEventName": "PermissionRequest",
 *                              "decision": { "behavior": "allow" } } }
 * Deny:
 *   { "hookSpecificOutput": { "hookEventName": "PermissionRequest",
 *                              "decision": { "behavior": "deny",
 *                                            "message": "Rejected via Stream Deck" } } }
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import streamDeck from '@elgato/streamdeck';

// ── Types ──────────────────────────────────────────────────────────────────────

export type HookDecision = 'allow' | 'deny';

export interface PermissionRequestPayload {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  session_id?: string;
  cwd?: string;
  permission_mode?: string;
}

export interface HookState {
  /** Whether there is a permission request waiting for a button press. */
  hasPending: boolean;
  /** Tool name, e.g. "Bash", "Write", "Edit" */
  toolName?: string;
  /** Truncated command / file path shown on the button */
  subtext?: string;
}

type StateListener = (state: HookState) => void;

// ── Module-level state ─────────────────────────────────────────────────────────

let currentState: HookState = { hasPending: false };
let pendingResolve: ((decision: HookDecision) => void) | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<StateListener>();

/**
 * The server auto-denies after this many ms if the user hasn't pressed a
 * button.  Set slightly shorter than the hook's `timeout` value so Claude Code
 * always receives an explicit response instead of a connection timeout.
 */
const SERVER_TIMEOUT_MS = 55_000;

// ── Internal helpers ──────────────────────────────────────────────────────────

function setState(state: HookState): void {
  currentState = state;
  for (const l of listeners) {
    try { l(state); } catch { /* never let a listener crash the server */ }
  }
}

function clearPending(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingResolve = null;
}

function extractSubtext(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const raw =
    (typeof input['command'] === 'string' ? input['command'] : null) ??
    (typeof input['file_path'] === 'string' ? input['file_path'] : null) ??
    (typeof input['path'] === 'string' ? input['path'] : null) ??
    (typeof input['content'] === 'string' ? input['content'] : null);
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
 * Respond to the currently pending permission request.
 * Returns `true` if there was a pending request, `false` if idle.
 */
export function respondToHook(decision: HookDecision): boolean {
  if (!pendingResolve) return false;
  const resolve = pendingResolve;
  clearPending();
  setState({ hasPending: false });
  resolve(decision);
  return true;
}

/** Reset all module-level state.  Used by tests only. */
export function _resetForTesting(): void {
  clearPending();
  currentState = { hasPending: false };
  listeners.clear();
}

// ── HTTP server ───────────────────────────────────────────────────────────────

export function startHookServer(port = 27632): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST' || req.url !== '/hook') {
      res.writeHead(404).end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      // Parse payload — treat any JSON error as empty payload
      let payload: PermissionRequestPayload = {};
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as PermissionRequestPayload;
      } catch {
        /* ignore */
      }

      // If there's already a pending hook (shouldn't normally happen) auto-deny
      // the previous one so the new one can take its place.
      if (pendingResolve) {
        const old = pendingResolve;
        clearPending();
        setState({ hasPending: false });
        old('deny');
      }

      const toolName = payload.tool_name ?? 'Tool';
      const subtext = extractSubtext(payload.tool_input);

      // Create the pending-hook promise.  The resolve callback is stored in
      // module scope so respondToHook() can call it from outside.
      const hookPromise = new Promise<HookDecision>((resolve) => {
        pendingResolve = resolve;
        pendingTimer = setTimeout(() => {
          if (pendingResolve === resolve) {
            clearPending();
            setState({ hasPending: false });
            resolve('deny');
          }
        }, SERVER_TIMEOUT_MS);
      });

      setState({ hasPending: true, toolName, subtext });

      // Hold the HTTP connection open until we have a decision.
      void hookPromise.then((decision) => {
        const body = buildResponseBody(decision);
        const bodyBuf = Buffer.from(body, 'utf-8');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': String(bodyBuf.byteLength),
        });
        res.end(bodyBuf);
      });
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

// ── Response builder ──────────────────────────────────────────────────────────

function buildResponseBody(decision: HookDecision): string {
  if (decision === 'allow') {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    });
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'deny',
        message: 'Rejected via Stream Deck',
      },
    },
  });
}
