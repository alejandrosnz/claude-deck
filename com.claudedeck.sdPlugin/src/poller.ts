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

import { logger } from './log';
import { fetchUsage, invalidateCache, type UsageData } from './usage-api';
import { renderButtonImage, formatRemaining, formatResetTime, type ButtonRenderState } from './renderer';

const POLL_INTERVAL_MS = 120_000;
const RESET_INFO_DURATION_MS = 10_000;
/** How long to wait before retrying if the very first poll returns no data. */
const INITIAL_RETRY_MS = 15_000;

// ── registry ──────────────────────────────────────────────────────────────────

/** Minimal interface for a key action that can display an image. */
export interface KeyActionLike {
  setImage(url: string): Promise<void>;
}

interface RegisteredButton {
  id: string;
  /** 'com.claudedeck.usage5h' | 'com.claudedeck.usage7d' */
  manifestId: string;
  /** Direct reference to the SDK action object — avoids getActionById lookup. */
  keyAction: KeyActionLike;
  /** True while the reset-info overlay is being shown. */
  showingResetInfo: boolean;
  /** Handle for the auto-revert timeout; null when not in reset-info mode. */
  resetTimer: ReturnType<typeof setTimeout> | null;
}

const registry: RegisteredButton[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
/**
 * One-shot timer set after a failed initial poll to trigger a fast retry.
 * Stored so it can be cancelled if buttons are removed before it fires.
 */
let fastRetryTimer: ReturnType<typeof setTimeout> | null = null;
/** Most-recent usage data received from the API (or null if never fetched). */
let lastData: UsageData | null = null;

export function registerButton(id: string, manifestId: string, keyAction: KeyActionLike): void {
  logger.info(`[claude-deck] registerButton id=${id} manifestId=${manifestId}`);
  if (!registry.some(b => b.id === id)) {
    registry.push({ id, manifestId, keyAction, showingResetInfo: false, resetTimer: null });
    // Show loading state immediately when button appears
    void showLoadingState(id, manifestId, keyAction);
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
  logger.info('[claude-deck] startPolling — firing initial poll');
  void doInitialPoll();
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

/**
 * Runs the first poll immediately. If it returns no data (credentials missing,
 * network not ready yet, etc.) schedules one fast retry after INITIAL_RETRY_MS
 * instead of waiting the full 120 s interval.
 */
async function doInitialPoll(): Promise<void> {
  await poll();
  if (lastData === null) {
    logger.info(
      `[claude-deck] Initial poll returned no data — scheduling fast retry in ${INITIAL_RETRY_MS / 1_000}s`,
    );
    fastRetryTimer = setTimeout(() => {
      fastRetryTimer = null;
      if (pollTimer !== null) {
        logger.info('[claude-deck] Fast retry firing');
        void poll();
      }
    }, INITIAL_RETRY_MS);
  }
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (fastRetryTimer !== null) {
    clearTimeout(fastRetryTimer);
    fastRetryTimer = null;
  }
}

async function poll(): Promise<void> {
  logger.info('[claude-deck] poll start');
  const data = await fetchUsage();
  logger.info(`[claude-deck] poll done — data=${data === null ? 'null' : 'ok'}`);
  await updateAllButtons(data);
}

// ── rendering ─────────────────────────────────────────────────────────────────

async function showLoadingState(id: string, manifestId: string, keyAction: KeyActionLike): Promise<void> {
  try {
    const { label } = resolveButtonInfo(manifestId);
    const imageUrl = renderButtonImage({ kind: 'loading' }, label);
    await keyAction.setImage(imageUrl);
  } catch (err) {
    logger.error(`[claude-deck] showLoadingState failed for ${id}: ${err}`);
  }
}

async function setButtonImage(btn: RegisteredButton, imageUrl: string): Promise<void> {
  try {
    logger.info(`[claude-deck] setImage id=${btn.id} urlLen=${imageUrl.length}`);
    await btn.keyAction.setImage(imageUrl);
    logger.info(`[claude-deck] setImage done id=${btn.id}`);
  } catch (err) {
    logger.error(`[claude-deck] setImage failed for ${btn.id}: ${err}`);
  }
}

async function updateAllButtons(data: UsageData | null): Promise<void> {
  lastData = data;
  // Snapshot the registry to avoid skipped entries if unregisterButton is
  // called (via splice) while we are awaiting setButtonImage.
  for (const btn of [...registry]) {
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
  logger.info(`[claude-deck] toggleResetInfo id=${id} registrySize=${registry.length} ids=${registry.map(b => b.id).join(',')}`);
  const btn = registry.find(b => b.id === id);
  logger.info(`[claude-deck] toggleResetInfo btnFound=${!!btn}`);
  if (!btn) return;

  if (btn.showingResetInfo) {
    // Second press while info is shown → revert immediately.
    clearButtonResetTimer(btn);
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

function clearButtonResetTimer(btn: RegisteredButton): void {
  if (btn.resetTimer !== null) {
    clearTimeout(btn.resetTimer);
    btn.resetTimer = null;
  }
  btn.showingResetInfo = false;
}

// ── image computation ─────────────────────────────────────────────────────────

export function computeImage(manifestId: string, data: UsageData | null): string {
  const { is5h, label } = resolveButtonInfo(manifestId);

  if (!data) {
    return renderButtonImage({ kind: 'nodata' }, label);
  }

  if (data.inferredBillingType === 'api') {
    return renderButtonImage({ kind: 'nodata' }, label);
  }

  const percent = is5h ? data.fiveHourPercent : data.sevenDayPercent;

  if (percent === null) {
    return renderButtonImage({ kind: 'nodata' }, label);
  }

  const state: ButtonRenderState = { kind: 'usage', percent };
  return renderButtonImage(state, label);
}

/**
 * Computes the reset-info overlay image for a button.
 * Shows time remaining and the local reset time.
 */
export function computeResetImage(manifestId: string, data: UsageData | null): string {
  const { is5h, label } = resolveButtonInfo(manifestId);

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

// ── private helpers ───────────────────────────────────────────────────────────

/** Resolves the display label and 5h/7d flag from a manifest action UUID. */
function resolveButtonInfo(manifestId: string): { is5h: boolean; label: string } {
  const is5h = manifestId === 'com.claudedeck.usage5h';
  return { is5h, label: is5h ? '5h' : '7d' };
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
  if (fastRetryTimer !== null) {
    clearTimeout(fastRetryTimer);
    fastRetryTimer = null;
  }
  lastData = null;
}
