/**
 * Anthropic OAuth usage API client.
 *
 * Features:
 * - In-memory cache with 120 s TTL
 * - Pending-promise mutex (no concurrent in-flight requests)
 * - Exponential backoff on repeated failures (45 s / 90 s / 180 s / 300 s)
 * - Re-reads credentials on 401/403
 * - Resilient field parsing (handles renamed API fields)
 */

import streamDeck from '@elgato/streamdeck';
import { readCredentials } from './credentials';

const USAGE_API_URL = 'https://api.anthropic.com/api/oauth/usage';
const CACHE_TTL_MS = 120_000;
const TOKEN_EXPIRY_MARGIN_MS = 10 * 60 * 1_000; // 10 minutes
const BACKOFF_INTERVALS_MS = [45_000, 90_000, 180_000, 300_000];

export interface UsageData {
  fiveHourPercent: number | null;
  fiveHourResetsAt: string | null;
  sevenDayPercent: number | null;
  sevenDayResetsAt: string | null;
  /** 'subscription' when rate-limit fields are present; 'api' otherwise. */
  inferredBillingType: 'subscription' | 'api';
}

// ── module-level state ────────────────────────────────────────────────────────

let cachedData: UsageData | null = null;
let cacheTimestamp = 0;
let consecutiveFailures = 0;
/** Pending fetch promise — prevents concurrent requests. */
let pendingFetch: Promise<UsageData | null> | null = null;

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Returns usage data, using the in-memory cache when fresh.
 * Never throws — returns null (or stale cache) on any error.
 */
export async function fetchUsage(): Promise<UsageData | null> {
  // Return from cache if still fresh.
  const age = Date.now() - cacheTimestamp;
  if (cachedData && age < CACHE_TTL_MS) {
    return cachedData;
  }

  // Apply backoff if we have stale cache and are in a failure streak.
  const backoff = getBackoffMs();
  if (backoff > 0 && cachedData && age < backoff) {
    return cachedData;
  }

  // Deduplicate concurrent callers.
  if (pendingFetch) return pendingFetch;
  pendingFetch = doFetch();
  try {
    return await pendingFetch;
  } finally {
    pendingFetch = null;
  }
}

/** Clears the in-memory cache, forcing a real fetch on the next call. */
export function invalidateCache(): void {
  cachedData = null;
  cacheTimestamp = 0;
}

/** @internal Resets all module-level state. Only for use in tests. */
export function _resetStateForTesting(): void {
  cachedData = null;
  cacheTimestamp = 0;
  consecutiveFailures = 0;
  pendingFetch = null;
}

// ── private helpers ───────────────────────────────────────────────────────────

function getBackoffMs(): number {
  if (consecutiveFailures <= 0) return 0;
  return BACKOFF_INTERVALS_MS[Math.min(consecutiveFailures - 1, BACKOFF_INTERVALS_MS.length - 1)];
}

async function doFetch(): Promise<UsageData | null> {
  const creds = await readCredentials();
  if (!creds) {
    streamDeck.logger.warn('[claude-deck] No OAuth credentials found');
    return cachedData;
  }

  // Log token expiry as a warning but proceed with the fetch regardless.
  // The server will return 401/403 if the token is truly invalid; the plugin
  // has no ability to refresh tokens itself, so bailing out early here only
  // results in a permanent error state with no data shown.
  if (creds.expiresAt) {
    const ttl = creds.expiresAt - Date.now();
    if (ttl <= 0) {
      streamDeck.logger.warn('[claude-deck] OAuth token appears expired — attempting fetch anyway');
    } else if (ttl < TOKEN_EXPIRY_MARGIN_MS) {
      streamDeck.logger.warn(`[claude-deck] OAuth token expires in ${Math.round(ttl / 60_000)}m — attempting fetch anyway`);
    }
  }

  try {
    const res = await fetch(USAGE_API_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 429) {
      consecutiveFailures++;
      const retryAfter = res.headers.get('retry-after');
      streamDeck.logger.warn(
        `[claude-deck] Rate limited (429). Retry-After: ${retryAfter ?? 'none'}. Backoff: ${getBackoffMs() / 1_000}s`,
      );
      return cachedData;
    }

    if (res.status === 401 || res.status === 403) {
      consecutiveFailures++;
      streamDeck.logger.warn(`[claude-deck] Auth error ${res.status} — will re-read credentials next attempt`);
      return cachedData;
    }

    if (!res.ok) {
      consecutiveFailures++;
      streamDeck.logger.warn(`[claude-deck] API error ${res.status} ${res.statusText}`);
      return cachedData;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as Record<string, any>;

    const hasRateLimitData = body.five_hour != null || body.seven_day != null;
    let fiveHourPercent = parseUtilization(body.five_hour);
    let sevenDayPercent = parseUtilization(body.seven_day);

    // API returns 0.0–1.0; normalise to 0–100.
    if (fiveHourPercent !== null && fiveHourPercent <= 1.0) fiveHourPercent *= 100;
    if (sevenDayPercent !== null && sevenDayPercent <= 1.0) sevenDayPercent *= 100;

    const result: UsageData = {
      fiveHourPercent,
      fiveHourResetsAt: parseResetsAt(body.five_hour),
      sevenDayPercent,
      sevenDayResetsAt: parseResetsAt(body.seven_day),
      inferredBillingType: hasRateLimitData ? 'subscription' : 'api',
    };

    streamDeck.logger.info(
      `[claude-deck] 5h=${result.fiveHourPercent?.toFixed(1) ?? 'null'}%  7d=${result.sevenDayPercent?.toFixed(1) ?? 'null'}%`,
    );

    cachedData = result;
    cacheTimestamp = Date.now();
    consecutiveFailures = 0;
    return result;
  } catch (err) {
    consecutiveFailures++;
    streamDeck.logger.error(`[claude-deck] Fetch failed: ${err}`);
    return cachedData;
  }
}

/**
 * Extracts utilization from a rate-limit object.
 * Tolerates: { utilization }, { percentage }, { percent }, { usage }, or bare number.
 */
export function parseUtilization(obj: unknown): number | null {
  if (obj == null) return null;
  if (typeof obj === 'number') return obj;
  if (typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    for (const key of ['utilization', 'percentage', 'percent', 'usage'] as const) {
      if (typeof o[key] === 'number') return o[key] as number;
    }
  }
  return null;
}

/**
 * Extracts the reset timestamp from a rate-limit object.
 * Tolerates: resets_at, resetsAt, reset_at, expires_at.
 */
export function parseResetsAt(obj: unknown): string | null {
  if (obj == null || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const key of ['resets_at', 'resetsAt', 'reset_at', 'expires_at'] as const) {
    if (typeof o[key] === 'string') return o[key] as string;
  }
  return null;
}
