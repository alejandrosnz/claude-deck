/**
 * Tests for hook-server.ts
 *
 * The hook server now uses the PreToolUse hook:
 *   POST /hook      — responds IMMEDIATELY with permissionDecision: "ask" and
 *                     stores the request in the pending map.
 *   POST /hook-post — receives PostToolUse, cleans up the pending entry if
 *                     the tool_use_id matches.
 *
 * respondToHook() is the in-process path used when the user presses a button
 * on the deck; it calls the PTY bridge (mocked here) to inject a keystroke.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@elgato/streamdeck', () => ({
  default: {
    logger: {
      info:  vi.fn(),
      warn:  vi.fn(),
      error: vi.fn(),
    },
  },
}));

// Mock the PTY bridge so tests don't spawn subprocesses.
// Use vi.hoisted so the variable is available inside the vi.mock factory.
const { mockSendToClaudeTerminal } = vi.hoisted(() => ({
  mockSendToClaudeTerminal: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
}));

vi.mock('../pty-bridge', () => ({
  sendToClaudeTerminal: mockSendToClaudeTerminal,
}));

import {
  getHookState,
  onHookStateChange,
  respondToHook,
  startHookServer,
  _resetForTesting,
  type HookState,
} from '../hook-server';

// Use a non-default port to avoid conflicting with a running plugin.
const TEST_PORT = 27699;
const BASE_URL  = `http://127.0.0.1:${TEST_PORT}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function postHook(payload: unknown): Promise<Response> {
  return fetch(`${BASE_URL}/hook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function postHookPost(payload: unknown): Promise<Response> {
  return fetch(`${BASE_URL}/hook-post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  _resetForTesting();
  mockSendToClaudeTerminal.mockClear();
});

afterEach(async () => {
  // Allow any fire-and-forget promises (PTY bridge) to settle.
  await new Promise((r) => setTimeout(r, 10));
});

// ── getHookState ──────────────────────────────────────────────────────────────

describe('getHookState', () => {
  it('starts idle', () => {
    expect(getHookState()).toEqual({ hasPending: false });
  });
});

// ── onHookStateChange ─────────────────────────────────────────────────────────

describe('onHookStateChange', () => {
  it('returns an unsubscribe function that prevents further notifications', () => {
    const cb = vi.fn();
    const unsub = onHookStateChange(cb);
    unsub();
    respondToHook('allow'); // no-op (nothing pending) but would fire listeners
    expect(cb).not.toHaveBeenCalled();
  });
});

// ── respondToHook ─────────────────────────────────────────────────────────────

describe('respondToHook', () => {
  it('returns false when there is no pending hook', () => {
    expect(respondToHook('allow')).toBe(false);
    expect(respondToHook('deny')).toBe(false);
  });

  it('does not call PTY bridge when there is nothing pending', () => {
    respondToHook('allow');
    expect(mockSendToClaudeTerminal).not.toHaveBeenCalled();
  });
});

// ── HTTP server integration ───────────────────────────────────────────────────

describe('HTTP server', () => {
  // Start once; the server persists across tests.
  // Subsequent startHookServer calls on the same port are silently ignored
  // (EADDRINUSE → logged as a warning, original server keeps running).
  beforeEach(() => {
    startHookServer(TEST_PORT);
  });

  // ── routing ──────────────────────────────────────────────────────────────────

  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`${BASE_URL}/other`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for GET /hook', async () => {
    const res = await fetch(`${BASE_URL}/hook`);
    expect(res.status).toBe(404);
  });

  // ── POST /hook (PreToolUse) ───────────────────────────────────────────────────

  it('responds immediately (status 200) — does not hold the connection', async () => {
    const start = Date.now();
    const res   = await postHook({ tool_name: 'Bash', tool_input: { command: 'ls' } });
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    // Should complete well under 1 second — not a 55 s long-poll.
    expect(elapsed).toBeLessThan(500);
    respondToHook('allow'); // clean up
  });

  it('responds with permissionDecision: "ask"', async () => {
    const res  = await postHook({ tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'echo hi' } });
    const body = await res.json() as {
      hookSpecificOutput: { hookEventName: string; permissionDecision: string };
    };
    expect(body.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(body.hookSpecificOutput.permissionDecision).toBe('ask');
    respondToHook('allow');
  });

  it('sets hasPending=true and populates toolName after /hook', async () => {
    await postHook({ tool_name: 'Write', tool_use_id: 'u2', tool_input: { file_path: '/src/foo.ts' } });
    expect(getHookState().hasPending).toBe(true);
    expect(getHookState().toolName).toBe('Write');
    respondToHook('deny');
  });

  it('extracts subtext from command field', async () => {
    await postHook({ tool_name: 'Bash', tool_use_id: 'u3', tool_input: { command: 'ls -la' } });
    expect(getHookState().subtext).toBe('ls -la');
    respondToHook('allow');
  });

  it('extracts subtext from file_path field', async () => {
    await postHook({ tool_name: 'Edit', tool_use_id: 'u4', tool_input: { file_path: '/src/foo.ts' } });
    expect(getHookState().subtext).toBe('/src/foo.ts');
    respondToHook('allow');
  });

  it('truncates long subtext to at most 23 characters (22 + ellipsis)', async () => {
    const longPath = '/very/long/path/that/exceeds/the/limit/foo.ts';
    await postHook({ tool_name: 'Bash', tool_use_id: 'u5', tool_input: { command: longPath } });
    const { subtext } = getHookState();
    expect(subtext).toBeDefined();
    expect(subtext!.length).toBeLessThanOrEqual(23);
    respondToHook('allow');
  });

  it('handles malformed JSON body — defaults to toolName "Tool"', async () => {
    await fetch(`${BASE_URL}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });
    expect(getHookState().hasPending).toBe(true);
    expect(getHookState().toolName).toBe('Tool');
    respondToHook('allow');
  });

  // ── respondToHook via deck button ──────────────────────────────────────────

  it('respondToHook returns true and goes idle when pending', async () => {
    const states: HookState[] = [];
    onHookStateChange((s) => states.push({ ...s }));

    await postHook({ tool_name: 'Bash', tool_use_id: 'rb1', tool_input: { command: 'echo' } });
    expect(getHookState().hasPending).toBe(true);

    const responded = respondToHook('allow');
    expect(responded).toBe(true);
    expect(getHookState().hasPending).toBe(false);

    // Listener received pending=true then pending=false
    expect(states.some((s) => s.hasPending)).toBe(true);
    expect(states[states.length - 1]?.hasPending).toBe(false);
  });

  it('respondToHook("allow") calls PTY bridge with "y\\n"', async () => {
    await postHook({ tool_use_id: 'pty1', tool_name: 'Bash', tool_input: {} });
    respondToHook('allow');
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSendToClaudeTerminal).toHaveBeenCalledWith('y\n');
  });

  it('respondToHook("deny") calls PTY bridge with "n\\n"', async () => {
    await postHook({ tool_use_id: 'pty2', tool_name: 'Bash', tool_input: {} });
    respondToHook('deny');
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSendToClaudeTerminal).toHaveBeenCalledWith('n\n');
  });

  // ── POST /hook-post (PostToolUse) ─────────────────────────────────────────

  it('POST /hook-post returns 200', async () => {
    await postHook({ tool_use_id: 'hp1', tool_name: 'Bash', tool_input: {} });
    const res = await postHookPost({ tool_use_id: 'hp1' });
    expect(res.status).toBe(200);
  });

  it('POST /hook-post clears pending state when tool_use_id matches', async () => {
    await postHook({ tool_use_id: 'hp2', tool_name: 'Write', tool_input: {} });
    expect(getHookState().hasPending).toBe(true);

    await postHookPost({ tool_use_id: 'hp2' });
    expect(getHookState().hasPending).toBe(false);
  });

  it('POST /hook-post is a no-op when tool_use_id is unknown', async () => {
    await postHook({ tool_use_id: 'hp3', tool_name: 'Bash', tool_input: {} });
    await postHookPost({ tool_use_id: 'unknown-id' });
    // Still pending because the unknown id did not match
    expect(getHookState().hasPending).toBe(true);
    respondToHook('allow');
  });

  it('POST /hook-post is a no-op when there is nothing pending', async () => {
    const res = await postHookPost({ tool_use_id: 'hp4' });
    expect(res.status).toBe(200);
    expect(getHookState().hasPending).toBe(false);
  });

  // ── Multiple pending requests ─────────────────────────────────────────────

  it('shows the most-recent pending entry as the deck state', async () => {
    await postHook({ tool_use_id: 'mp1', tool_name: 'Bash',  tool_input: { command: 'first' } });
    await postHook({ tool_use_id: 'mp2', tool_name: 'Write', tool_input: { file_path: 'second.ts' } });

    // Most recently added entry shown
    expect(getHookState().toolName).toBe('Write');

    // After resolving the most recent via PostToolUse, reverts to first
    await postHookPost({ tool_use_id: 'mp2' });
    expect(getHookState().hasPending).toBe(true);
    expect(getHookState().toolName).toBe('Bash');

    // Clean up
    await postHookPost({ tool_use_id: 'mp1' });
    expect(getHookState().hasPending).toBe(false);
  });

  it('after respondToHook, shows the next pending entry if one exists', async () => {
    await postHook({ tool_use_id: 'rn1', tool_name: 'Bash',  tool_input: {} });
    await postHook({ tool_use_id: 'rn2', tool_name: 'Write', tool_input: {} });

    respondToHook('allow'); // resolves most recent (rn2)

    expect(getHookState().hasPending).toBe(true);
    expect(getHookState().toolName).toBe('Bash');

    respondToHook('deny'); // resolves rn1
    expect(getHookState().hasPending).toBe(false);
  });
});
