/**
 * Module-level singleton poller shared by Usage5hAction and Usage7dAction.
 *
 * A single setInterval fires every 120 s. Both action classes register /
 * unregister their button instances here. The poller calls fetchUsage() once
 * per cycle (the in-memory cache + mutex in usage-api.ts guarantees a single
 * outbound HTTP request regardless of how many callers exist).
 */

import streamDeck from '@elgato/streamdeck';
import { fetchUsage, type UsageData } from './usage-api';
import { renderButtonImage, type ButtonRenderState } from './renderer';

const POLL_INTERVAL_MS = 120_000;

// ── registry ──────────────────────────────────────────────────────────────────

interface RegisteredButton {
  id: string;
  /** 'com.claudedeck.usage5h' | 'com.claudedeck.usage7d' */
  manifestId: string;
}

const registry: RegisteredButton[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function registerButton(id: string, manifestId: string): void {
  if (!registry.some(b => b.id === id)) {
    registry.push({ id, manifestId });
  }
  if (pollTimer === null) {
    startPolling();
  }
}

export function unregisterButton(id: string): void {
  const idx = registry.findIndex(b => b.id === id);
  if (idx !== -1) registry.splice(idx, 1);
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

/** Called on manual refresh (key press). */
export async function manualRefresh(): Promise<void> {
  await poll();
}

async function poll(): Promise<void> {
  const data = await fetchUsage();
  await updateAllButtons(data);
}

// ── rendering ─────────────────────────────────────────────────────────────────

async function updateAllButtons(data: UsageData | null): Promise<void> {
  for (const btn of registry) {
    const imageUrl = computeImage(btn.manifestId, data);
    try {
      const action = streamDeck.actions.getActionById(btn.id);
      if (action) {
        // KeyAction.setImage — cast needed because the SDK union type also
        // includes EncoderAction which uses setFeedback instead.
        await (action as unknown as { setImage(url: string): Promise<void> }).setImage(imageUrl);
      }
    } catch (err) {
      streamDeck.logger.error(`[claude-deck] setImage failed for ${btn.id}: ${err}`);
    }
  }
}

function computeImage(manifestId: string, data: UsageData | null): string {
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
