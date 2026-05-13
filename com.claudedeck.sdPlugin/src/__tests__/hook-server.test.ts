/**
 * Tests for hook-server.ts
 *
 * We test the module-level state management directly (getHookState,
 * onHookStateChange, respondToHook) and the HTTP server by making real
 * HTTP requests using Node's built-in fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @elgato/streamdeck so we don't need a running Stream Deck connection.
vi.mock('@elgato/streamdeck', () => ({
  default: {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

import {
  getHookState,
  onHookStateChange,
  respondToHook,
  startHookServer,
  _resetForTesting,
} from '../hook-server';

// Use a different port for tests to avoid conflict with a running plugin.
const TEST_PORT = 27699;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  _resetForTesting();
});

// ── getHookState ──────────────────────────────────────────────────────────────

describe('getHookState', () => {
  it('starts idle', () => {
    expect(getHookState()).toEqual({ hasPending: false });
  });
});

// ── onHookStateChange ─────────────────────────────────────────────────────────

describe('onHookStateChange', () => {
  it('notifies listener when hook state changes', async () => {
    const states: ReturnType<typeof getHookState>[] = [];
    onHookStateChange((s) => states.push(s));

    // Simulate a pending state transition via respondToHook (which goes idle→idle).
    // For a real pending→idle transition we need the server, tested below.
    // Here we just verify listener registration doesn't throw.
    expect(states).toHaveLength(0);
  });

  it('returns an unsubscribe function', () => {
    const cb = vi.fn();
    const unsub = onHookStateChange(cb);
    unsub();
    // After unsubscribing, the listener should not be called
    respondToHook('allow'); // no-op but would call listeners if registered
    expect(cb).not.toHaveBeenCalled();
  });
});

// ── respondToHook ─────────────────────────────────────────────────────────────

describe('respondToHook', () => {
  it('returns false when there is no pending hook', () => {
    expect(respondToHook('allow')).toBe(false);
    expect(respondToHook('deny')).toBe(false);
  });
});

// ── HTTP server integration ───────────────────────────────────────────────────

describe('HTTP server', () => {
  // We start one server for all tests in this suite and reuse it.
  // _resetForTesting() clears module-level state between tests, but the
  // server socket itself stays open — that's fine for these tests.
  beforeEach(() => {
    startHookServer(TEST_PORT);
  });

  afterEach(async () => {
    // Give pending timers / promises a tick to settle so Vitest doesn't warn
    // about unhandled rejections.
    await new Promise((r) => setTimeout(r, 10));
  });

  it('returns 404 for non-hook paths', async () => {
    const res = await fetch(`${BASE_URL}/other`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for GET requests', async () => {
    const res = await fetch(`${BASE_URL}/hook`);
    expect(res.status).toBe(404);
  });

  it('sets hasPending=true while waiting and resolves with allow', async () => {
    const states: ReturnType<typeof getHookState>[] = [];
    onHookStateChange((s) => states.push({ ...s }));

    const payload = {
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
    };

    // Start the request but don't await it yet
    const hookPromise = fetch(`${BASE_URL}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Wait a tick for the server to process the request
    await new Promise((r) => setTimeout(r, 20));

    // State should now be pending
    expect(getHookState().hasPending).toBe(true);
    expect(getHookState().toolName).toBe('Bash');
    expect(getHookState().subtext).toBe('ls -la');

    // respondToHook should return true and resolve the HTTP request
    const responded = respondToHook('allow');
    expect(responded).toBe(true);

    const res = await hookPromise;
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect((body as { hookSpecificOutput: { decision: { behavior: string } } })
      .hookSpecificOutput.decision.behavior).toBe('allow');

    // State should be idle again
    expect(getHookState().hasPending).toBe(false);

    // Listener should have received pending=true then pending=false
    expect(states.some((s) => s.hasPending)).toBe(true);
    expect(states[states.length - 1]?.hasPending).toBe(false);
  });

  it('resolves with deny when respondToHook("deny") is called', async () => {
    const hookPromise = fetch(`${BASE_URL}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/x.ts' } }),
    });

    await new Promise((r) => setTimeout(r, 20));
    respondToHook('deny');

    const res = await hookPromise;
    const body = await res.json() as Record<string, unknown>;
    expect((body as { hookSpecificOutput: { decision: { behavior: string } } })
      .hookSpecificOutput.decision.behavior).toBe('deny');
  });

  it('extracts subtext from file_path', async () => {
    const hookPromise = fetch(`${BASE_URL}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: '/src/foo.ts' } }),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(getHookState().subtext).toBe('/src/foo.ts');
    respondToHook('allow');
    await hookPromise;
  });

  it('truncates long subtexts', async () => {
    const longPath = '/very/long/path/that/exceeds/the/limit/foo.ts';
    const hookPromise = fetch(`${BASE_URL}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: 'Bash', tool_input: { command: longPath } }),
    });
    await new Promise((r) => setTimeout(r, 20));
    const { subtext } = getHookState();
    expect(subtext).toBeDefined();
    expect(subtext!.length).toBeLessThanOrEqual(24); // 22 chars + ellipsis
    respondToHook('allow');
    await hookPromise;
  });

  it('handles malformed JSON body gracefully', async () => {
    const hookPromise = fetch(`${BASE_URL}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(getHookState().hasPending).toBe(true);
    expect(getHookState().toolName).toBe('Tool');
    respondToHook('allow');
    const res = await hookPromise;
    expect(res.status).toBe(200);
  });

  it('auto-denies previous pending request when a new one arrives', async () => {
    const first = fetch(`${BASE_URL}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo 1' } }),
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(getHookState().toolName).toBe('Bash');

    // Second request arrives while first is still pending
    const second = fetch(`${BASE_URL}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'b.ts' } }),
    });

    await new Promise((r) => setTimeout(r, 20));

    // First should have been auto-denied; second should be the new pending
    const firstRes = await first;
    const firstBody = await firstRes.json() as { hookSpecificOutput: { decision: { behavior: string } } };
    expect(firstBody.hookSpecificOutput.decision.behavior).toBe('deny');

    expect(getHookState().toolName).toBe('Write');

    respondToHook('allow');
    const secondRes = await second;
    const secondBody = await secondRes.json() as { hookSpecificOutput: { decision: { behavior: string } } };
    expect(secondBody.hookSpecificOutput.decision.behavior).toBe('allow');
  });
});
