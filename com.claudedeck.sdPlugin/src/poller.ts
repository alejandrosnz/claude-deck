/**
 * Module-level singleton poller shared by Usage5hAction and Usage7dAction.
 *
 * A single setInterval fires every 120 s. Both action classes register /
 * unregister their button instances here. The poller calls fetchUsage() once
 * per cycle (the in-memory cache + mutex in usage-api.ts guarantees a single
 * outbound HTTP request regardless of how many callers exist).
 *
 * Key-press behaviour:
 *   - First press  → shows reset-time info for RESET_INFO_DURATION_MS (10 s).
 *   - Second press → reverts immediately to the usage view.
 *   - After 10 s  → auto-reverts to the usage view.
 */

import streamDeck from '@elgato/streamdeck';
import { fetchUsage, invalidateCache, type UsageData } from './usage-api';
import { renderButtonImage, formatRemaining, formatResetTime, type ButtonRenderState } from './renderer';

const POLL_INTERVAL_MS = 120_000;
const RESET_INFO_DURATION_MS = 10_000;

// ── registry ──────────────────────────────────────────────────────────────────

interface RegisteredButton {
  id: string;
  /** 'com.claudedeck.usage5h' | 'com.claudedeck.usage7d' */
  manifestId: string;
  /** True while the reset-info overlay is being shown. */
  showingResetInfo: boolean;
  /** Handle for the auto-revert timeout; null when not in reset-info mode. */
  resetTimer: ReturnType<typeof setTimeout> | null;
}

const registry: RegisteredButton[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** Most-recent usage data received from the API (or null if never fetched). */
let lastData: UsageData | null = null;

export function registerButton(id: string, manifestId: string): void {
  if (!registry.some(b => b.id === id)) {
    registry.push({ id, manifestId, showingResetInfo: false, resetTimer: null });
    // Show loading state immediately when button appears
    showLoadingState(id, manifestId);
  }
  if (pollTimer === null) {
    startPolling();
  }
}

export function unregisterButton(id: string): void {
  const idx = registry.findIndex(b => b.id === id);
  if (idx !== -1) {
    const btn = registry[idx];
    if (btn.resetTimer !== null) clearTimeout(btn.resetTimer);
    registry.splice(idx, 1);
  }
  if (registry.length === 0) {
    stopPolling();
  }
}

// ── polling ───────────────────────────────────────────────────────────────────

function startPolling(): void {
  // Immediate first fetch.
  void poll();
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Invalidates the cache and triggers an immediate poll (for external use). */
export async function manualRefresh(): Promise<void> {
  invalidateCache();
  await poll();
}

async function poll(): Promise<void> {
  const data = await fetchUsage();
  await updateAllButtons(data);
}

// ── rendering ─────────────────────────────────────────────────────────────────

/** Type guard: check if action has setImage method (KeyAction). */
function isKeyAction(action: unknown): action is { setImage(url: string): Promise<void> } {
  return action != null && typeof (action as Record<string, unknown>).setImage === 'function';
}

function showLoadingState(id: string, manifestId: string): void {
  try {
    const action = streamDeck.actions.getActionById(id);
    if (isKeyAction(action)) {
      const is5h = manifestId === 'com.claudedeck.usage5h';
      const label = is5h ? '5h' : '7d';
      const imageUrl = renderButtonImage({ kind: 'loading' }, label);
      void action.setImage(imageUrl);
    }
  } catch (err) {
    streamDeck.logger.error(`[claude-deck] showLoadingState failed for ${id}: ${err}`);
  }
}

async function setButtonImage(btn: RegisteredButton, imageUrl: string): Promise<void> {
  try {
    const action = streamDeck.actions.getActionById(btn.id);
    if (isKeyAction(action)) {
      await action.setImage(imageUrl);
    }
  } catch (err) {
    streamDeck.logger.error(`[claude-deck] setImage failed for ${btn.id}: ${err}`);
  }
}

async function updateAllButtons(data: UsageData | null): Promise<void> {
  lastData = data;
  for (const btn of registry) {
    // Don't override the reset-info display while it's visible.
    if (btn.showingResetInfo) continue;
    const imageUrl = computeImage(btn.manifestId, data);
    await setButtonImage(btn, imageUrl);
  }
}

// ── reset-info toggle ─────────────────────────────────────────────────────────

/**
 * Called on key-press. Toggles between the reset-info overlay and the normal
 * usage view for the specific button instance that was pressed.
 */
export function toggleResetInfoForButton(id: string): void {
  const btn = registry.find(b => b.id === id);
  if (!btn) return;

  if (btn.showingResetInfo) {
    // Second press while info is shown → revert immediately.
    clearBtnResetTimer(btn);
    void setButtonImage(btn, computeImage(btn.manifestId, lastData));
  } else {
    // First press → show reset info and start auto-revert timer.
    btn.showingResetInfo = true;
    void setButtonImage(btn, computeResetImage(btn.manifestId, lastData));
    btn.resetTimer = setTimeout(() => {
      btn.showingResetInfo = false;
      btn.resetTimer = null;
      void setButtonImage(btn, computeImage(btn.manifestId, lastData));
    }, RESET_INFO_DURATION_MS);
  }
}

function clearBtnResetTimer(btn: RegisteredButton): void {
  if (btn.resetTimer !== null) {
    clearTimeout(btn.resetTimer);
    btn.resetTimer = null;
  }
  btn.showingResetInfo = false;
}

// ── image computation ─────────────────────────────────────────────────────────

export function computeImage(manifestId: string, data: UsageData | null): string {
  const is5h = manifestId === 'com.claudedeck.usage5h';
  const label = is5h ? '5h' : '7d';

  if (!data) {
    return renderButtonImage({ kind: 'error' }, label);
  }

  if (data.inferredBillingType === 'api') {
    return renderButtonImage({ kind: 'nodata' }, label);
  }

  const percent = is5h ? data.fiveHourPercent : data.sevenDayPercent;
  const resetsAt = is5h ? data.fiveHourResetsAt : data.sevenDayResetsAt;

  if (percent === null) {
    return renderButtonImage({ kind: 'nodata' }, label);
  }

  const state: ButtonRenderState = { kind: 'usage', percent, resetsAt };
  return renderButtonImage(state, label);
}

/**
 * Computes the reset-info overlay image for a button.
 * Shows time remaining and the local reset time.
 */
export function computeResetImage(manifestId: string, data: UsageData | null): string {
  const is5h = manifestId === 'com.claudedeck.usage5h';
  const label = is5h ? '5h' : '7d';

  if (!data || data.inferredBillingType === 'api') {
    return renderButtonImage({ kind: 'nodata' }, label);
  }

  const resetsAt = is5h ? data.fiveHourResetsAt : data.sevenDayResetsAt;

  if (!resetsAt) {
    return renderButtonImage({ kind: 'nodata' }, label);
  }

  const remaining = formatRemaining(resetsAt);
  const resetTime = formatResetTime(resetsAt, is5h);

  return renderButtonImage({ kind: 'reset', remaining, resetTime }, label);
}

// ── test helpers ──────────────────────────────────────────────────────────────

/** Resets all module-level state. Call only from unit tests. */
export function _resetPollerStateForTesting(): void {
  for (const btn of registry) {
    if (btn.resetTimer !== null) clearTimeout(btn.resetTimer);
  }
  registry.length = 0;
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  lastData = null;
}
