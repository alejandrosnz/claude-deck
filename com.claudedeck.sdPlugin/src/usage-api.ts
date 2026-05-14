/**
 * Anthropic OAuth usage API client.
 *
 * Features:
 * - In-memory cache with 120 s TTL
 * - Pending-promise mutex (no concurrent in-flight requests)
 * - Exponential backoff on repeated failures (45 s / 90 s / 180 s / 300 s)
 * - Re-reads credentials on 401/403
 * - Resilient field parsing (handles renamed API fields)
 *
 * ── 429 / Retry-After — INTENTIONALLY NOT HONOURED ─────────────────────────
 * The API returns 429 at every poll until the user opens Claude Code for the
 * first time after a PC restart (the OAuth token is not "warm" yet). If we
 * respected the Retry-After header (typically ~1 h), the plugin would show
 * stale / blank data for a full hour even though usage data becomes available
 * the moment the user launches Claude Code.
 *
 * Instead we treat 429 like any other transient error: increment the failure
 * counter (triggering the normal 45 s → 90 s → … backoff), log a warning, and
 * return stale cache. Once the API starts returning 200 the backoff resets and
 * the display updates within one normal poll cycle.
 *
 * DO NOT add Retry-After enforcement here. The cold-start 429 storm is the
 * expected steady state on a freshly booted machine.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { logger } from './log';
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
    logger.info(`[claude-deck] fetchUsage — cache hit (age=${Math.round(age / 1_000)}s)`);
    return cachedData;
  }

  // Apply backoff if we have stale cache and are in a failure streak.
  const backoff = getBackoffMs();
  if (backoff > 0 && cachedData && age < backoff) {
    logger.info(`[claude-deck] fetchUsage — backoff (failures=${consecutiveFailures} wait=${backoff / 1_000}s)`);
    return cachedData;
  }

  // Deduplicate concurrent callers.
  if (pendingFetch) {
    logger.info('[claude-deck] fetchUsage — joining pending fetch');
    return pendingFetch;
  }
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
  logger.info('[claude-deck] doFetch — reading credentials');
  const creds = await readCredentials();
  if (!creds) {
    // Credential absence is not a network failure — do not increment
    // consecutiveFailures. The 120 s poll interval is already an appropriate
    // retry cadence, and we don't want backoff to delay recovery once
    // credentials reappear.
    logger.warn('[claude-deck] No OAuth credentials found');
    return cachedData;
  }
  logger.info('[claude-deck] doFetch — credentials ok, firing HTTP request');

  try {
    // Log token expiry as a warning but proceed regardless. The server will
    // return 401/403 if the token is truly invalid; the plugin cannot refresh
    // tokens itself, so failing early only produces a permanent error state.
    if (creds.expiresAt) {
      const ttl = creds.expiresAt - Date.now();
      if (ttl <= 0) {
        logger.warn('[claude-deck] OAuth token appears expired — attempting fetch anyway');
      } else if (ttl < TOKEN_EXPIRY_MARGIN_MS) {
        logger.warn(`[claude-deck] OAuth token expires in ${Math.round(ttl / 60_000)}m — attempting fetch anyway`);
      }
    }

    logger.info('[claude-deck] fetch start');
    const res = await fetch(USAGE_API_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    logger.info(`[claude-deck] fetch response status=${res.status}`);

    if (res.status === 429) {
      consecutiveFailures++;
      // Retry-After is intentionally ignored — see module-level comment at the top of this file.
      logger.warn(`[claude-deck] Rate limited (429). Backoff: ${getBackoffMs() / 1_000}s`);
      return cachedData;
    }

    if (res.status === 401 || res.status === 403) {
      consecutiveFailures++;
      logger.warn(`[claude-deck] Auth error ${res.status} — will re-read credentials next attempt`);
      return cachedData;
    }

    if (!res.ok) {
      consecutiveFailures++;
      logger.warn(`[claude-deck] API error ${res.status} ${res.statusText}`);
      return cachedData;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as Record<string, any>;

    const hasRateLimitData = body.five_hour != null || body.seven_day != null;
    let fiveHourPercent = parseUtilization(body.five_hour);
    let sevenDayPercent = parseUtilization(body.seven_day);

    // API returns 0.0–1.0 fractions; normalise to 0–100.
    // Values ≥ 2.0 are assumed to already be in percentage form (e.g. 85 → 85%).
    // Values < 2.0 are treated as fractions, including slightly-over-limit values
    // like 1.05 (→ 105%), which the renderer clamps to 100 for display.
    if (fiveHourPercent !== null && fiveHourPercent < 2.0) fiveHourPercent *= 100;
    if (sevenDayPercent !== null && sevenDayPercent < 2.0) sevenDayPercent *= 100;

    const result: UsageData = {
      fiveHourPercent,
      fiveHourResetsAt: parseResetsAt(body.five_hour),
      sevenDayPercent,
      sevenDayResetsAt: parseResetsAt(body.seven_day),
      inferredBillingType: hasRateLimitData ? 'subscription' : 'api',
    };

    logger.info(
      `[claude-deck] 5h=${result.fiveHourPercent?.toFixed(1) ?? 'null'}%  7d=${result.sevenDayPercent?.toFixed(1) ?? 'null'}%`,
    );

    cachedData = result;
    cacheTimestamp = Date.now();
    consecutiveFailures = 0;
    return result;
  } catch (err) {
    consecutiveFailures++;
    logger.error(`[claude-deck] Fetch failed: ${err}`);
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
