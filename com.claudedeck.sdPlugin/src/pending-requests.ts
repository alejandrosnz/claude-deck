/**
 * In-memory store for pending PreToolUse hook requests.
 *
 * Each entry represents a Claude Code tool call that is waiting for a
 * permission decision.  Entries time out automatically after TIMEOUT_MS so
 * that stale state never accumulates when Claude Code has already moved on.
 */

export interface PendingRequest {
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  /** epoch ms — used to find the most-recently-added entry */
  timestamp: number;
}

export type ExpireCallback = (toolUseId: string) => void;

/**
 * Safety timeout.  Slightly shorter than the Claude Code hook `timeout`
 * value (65 s) so the server-side state clears before Claude Code gives up.
 */
export const TIMEOUT_MS = 55_000;

const pending = new Map<string, PendingRequest>();
const timers  = new Map<string, ReturnType<typeof setTimeout>>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register a new pending request.
 * If an entry with the same tool_use_id already exists it is replaced and its
 * old timer is cancelled.  The `onExpire` callback fires when the entry is
 * automatically removed after `TIMEOUT_MS`.
 */
export function addPendingRequest(req: PendingRequest, onExpire: ExpireCallback): void {
  const existing = timers.get(req.tool_use_id);
  if (existing !== undefined) clearTimeout(existing);

  pending.set(req.tool_use_id, req);

  const timer = setTimeout(() => {
    pending.delete(req.tool_use_id);
    timers.delete(req.tool_use_id);
    onExpire(req.tool_use_id);
  }, TIMEOUT_MS);

  timers.set(req.tool_use_id, timer);
}

/**
 * Remove a pending request by `tool_use_id` and cancel its timer.
 * Returns the removed entry, or `null` if no such entry existed.
 */
export function resolvePending(toolUseId: string): PendingRequest | null {
  const req = pending.get(toolUseId) ?? null;
  if (req) {
    pending.delete(toolUseId);
    const t = timers.get(toolUseId);
    if (t !== undefined) {
      clearTimeout(t);
      timers.delete(toolUseId);
    }
  }
  return req;
}

/**
 * Returns the most-recently-added pending request, or `null` if the map is
 * empty.  "Most recent" is determined by the `timestamp` field set at insert
 * time.
 */
export function getMostRecent(): PendingRequest | null {
  let latest: PendingRequest | null = null;
  for (const req of pending.values()) {
    // >= so that equal timestamps resolve in insertion order (last inserted wins).
    if (latest === null || req.timestamp >= latest.timestamp) latest = req;
  }
  return latest;
}

/** `true` if at least one pending request exists. */
export function hasPendingRequests(): boolean {
  return pending.size > 0;
}

/**
 * Remove all pending requests and cancel all timers.
 * Intended for tests and plugin shutdown.
 */
export function clearAllPending(): void {
  for (const t of timers.values()) clearTimeout(t);
  pending.clear();
  timers.clear();
}
