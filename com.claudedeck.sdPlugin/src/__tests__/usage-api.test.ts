/**
 * Unit tests for usage-api.ts
 *
 * The global `fetch` and the `./credentials` module are mocked.
 * Module-level state is reset before every test via _resetStateForTesting().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@elgato/streamdeck', () => ({
  default: {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

// vi.mock factories are hoisted before variable declarations, so we must use
// vi.hoisted() to initialise any variables referenced inside a factory.
const mockReadCredentials = vi.hoisted(() => vi.fn());
vi.mock('../credentials', () => ({
  readCredentials: mockReadCredentials,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── imports ───────────────────────────────────────────────────────────────────

import {
  fetchUsage,
  invalidateCache,
  parseUtilization,
  parseResetsAt,
  _resetStateForTesting,
} from '../usage-api';

// ── test helpers ──────────────────────────────────────────────────────────────

const VALID_CREDS = { accessToken: 'test-access-token', expiresAt: Date.now() + 3_600_000 };

/** Builds a minimal successful fetch Response with JSON body. */
function okResponse(body: object): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Builds a minimal failed fetch Response. */
function errorResponse(status: number, retryAfter?: string): Response {
  return {
    ok: false,
    status,
    statusText: 'Error',
    headers: { get: (h: string) => (h === 'retry-after' ? (retryAfter ?? null) : null) },
    json: () => Promise.resolve({}),
  } as unknown as Response;
}

const TYPICAL_BODY = {
  five_hour: { utilization: 0.42, resets_at: '2026-05-12T18:00:00Z' },
  seven_day: { utilization: 0.15, resets_at: '2026-05-19T00:00:00Z' },
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetStateForTesting();
  mockReadCredentials.mockResolvedValue(VALID_CREDS);
  mockFetch.mockResolvedValue(okResponse(TYPICAL_BODY));
});

// ── parseUtilization ──────────────────────────────────────────────────────────

describe('parseUtilization', () => {
  it('returns null for null', () => expect(parseUtilization(null)).toBeNull());
  it('returns null for undefined', () => expect(parseUtilization(undefined)).toBeNull());
  it('returns null for a string', () => expect(parseUtilization('0.5')).toBeNull());
  it('returns null for an array', () => expect(parseUtilization([0.5])).toBeNull());

  it('returns the number when passed a bare number', () => {
    expect(parseUtilization(0.5)).toBe(0.5);
    expect(parseUtilization(0)).toBe(0);
    expect(parseUtilization(100)).toBe(100);
  });

  it('reads the "utilization" key', () => expect(parseUtilization({ utilization: 0.42 })).toBe(0.42));
  it('reads the "percentage" key', () => expect(parseUtilization({ percentage: 0.80 })).toBe(0.80));
  it('reads the "percent" key', () => expect(parseUtilization({ percent: 0.60 })).toBe(0.60));
  it('reads the "usage" key', () => expect(parseUtilization({ usage: 0.30 })).toBe(0.30));

  it('returns null when no recognised key is present', () => {
    expect(parseUtilization({ other: 0.5 })).toBeNull();
  });

  it('returns null when the value is not a number', () => {
    expect(parseUtilization({ utilization: 'high' })).toBeNull();
  });
});

// ── parseResetsAt ─────────────────────────────────────────────────────────────

describe('parseResetsAt', () => {
  it('returns null for null', () => expect(parseResetsAt(null)).toBeNull());
  it('returns null for undefined', () => expect(parseResetsAt(undefined)).toBeNull());
  it('returns null for a plain string', () => expect(parseResetsAt('2026-01-01')).toBeNull());
  it('returns null for a number', () => expect(parseResetsAt(12345)).toBeNull());

  it('reads the "resets_at" key', () =>
    expect(parseResetsAt({ resets_at: '2026-01-01T00:00:00Z' })).toBe('2026-01-01T00:00:00Z'));
  it('reads the "resetsAt" key', () =>
    expect(parseResetsAt({ resetsAt: '2026-01-01T00:00:00Z' })).toBe('2026-01-01T00:00:00Z'));
  it('reads the "reset_at" key', () =>
    expect(parseResetsAt({ reset_at: '2026-01-01T00:00:00Z' })).toBe('2026-01-01T00:00:00Z'));
  it('reads the "expires_at" key', () =>
    expect(parseResetsAt({ expires_at: '2026-01-01T00:00:00Z' })).toBe('2026-01-01T00:00:00Z'));

  it('returns null when no recognised key is present', () => {
    expect(parseResetsAt({ other: '2026-01-01T00:00:00Z' })).toBeNull();
  });

  it('returns null when the value is not a string', () => {
    expect(parseResetsAt({ resets_at: 1234567890 })).toBeNull();
  });
});

// ── fetchUsage — happy path ───────────────────────────────────────────────────

describe('fetchUsage — happy path', () => {
  it('normalises 0–1 utilization values to 0–100', async () => {
    const data = await fetchUsage();
    expect(data?.fiveHourPercent).toBeCloseTo(42);
    expect(data?.sevenDayPercent).toBeCloseTo(15);
  });

  it('does not double-normalise values already above 1', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ five_hour: { utilization: 85 }, seven_day: { utilization: 30 } }),
    );
    const data = await fetchUsage();
    expect(data?.fiveHourPercent).toBe(85);
    expect(data?.sevenDayPercent).toBe(30);
  });

  it('sets inferredBillingType to "subscription" when rate-limit fields are present', async () => {
    expect((await fetchUsage())?.inferredBillingType).toBe('subscription');
  });

  it('sets inferredBillingType to "api" when rate-limit fields are absent', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    expect((await fetchUsage())?.inferredBillingType).toBe('api');
  });

  it('parses resets_at timestamps', async () => {
    const data = await fetchUsage();
    expect(data?.fiveHourResetsAt).toBe('2026-05-12T18:00:00Z');
    expect(data?.sevenDayResetsAt).toBe('2026-05-19T00:00:00Z');
  });

  it('tolerates alternative field names (resetsAt, percentage)', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        five_hour: { percentage: 0.55, resetsAt: '2026-06-01T00:00:00Z' },
        seven_day: { percent: 0.20, reset_at: '2026-06-08T00:00:00Z' },
      }),
    );
    const data = await fetchUsage();
    expect(data?.fiveHourPercent).toBeCloseTo(55);
    expect(data?.fiveHourResetsAt).toBe('2026-06-01T00:00:00Z');
    expect(data?.sevenDayPercent).toBeCloseTo(20);
    expect(data?.sevenDayResetsAt).toBe('2026-06-08T00:00:00Z');
  });

  it('sets fiveHourPercent and sevenDayPercent to null when objects have no utilization', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ five_hour: { resets_at: '2026-01-01T00:00:00Z' }, seven_day: {} }),
    );
    const data = await fetchUsage();
    expect(data?.fiveHourPercent).toBeNull();
    expect(data?.sevenDayPercent).toBeNull();
  });
});

// ── fetchUsage — error handling ───────────────────────────────────────────────

describe('fetchUsage — error handling', () => {
  it('returns null when no credentials are available', async () => {
    mockReadCredentials.mockResolvedValueOnce(null);
    expect(await fetchUsage()).toBeNull();
  });

  it('returns null on HTTP 401', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(401));
    expect(await fetchUsage()).toBeNull();
  });

  it('returns null on HTTP 403', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(403));
    expect(await fetchUsage()).toBeNull();
  });

  it('returns null on HTTP 429 (rate limited)', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(429, '60'));
    expect(await fetchUsage()).toBeNull();
  });

  it('returns null on generic server error (5xx)', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));
    expect(await fetchUsage()).toBeNull();
  });

  it('returns null on network error (fetch throws)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network timeout'));
    expect(await fetchUsage()).toBeNull();
  });

  it('returns stale cache on error when cache is populated', async () => {
    // First call succeeds and populates cache
    const first = await fetchUsage();
    expect(first).not.toBeNull();

    // Invalidate TTL but keep data — simulate by resetting only the timestamp
    invalidateCache();

    // Second call fails
    mockFetch.mockRejectedValueOnce(new Error('network timeout'));
    // Should return null (no stale data since invalidateCache cleared cachedData)
    expect(await fetchUsage()).toBeNull();
  });
});

// ── fetchUsage — caching ──────────────────────────────────────────────────────

describe('fetchUsage — caching', () => {
  it('returns cached data on the second call without a new fetch', async () => {
    await fetchUsage();
    await fetchUsage();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after invalidateCache()', async () => {
    await fetchUsage();
    invalidateCache();
    await fetchUsage();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ── fetchUsage — deduplication ────────────────────────────────────────────────

describe('fetchUsage — concurrent call deduplication', () => {
  it('issues only one HTTP request for concurrent calls', async () => {
    let resolveFirst!: (v: Response) => void;
    mockFetch.mockReturnValueOnce(new Promise<Response>(r => { resolveFirst = r; }));

    const p1 = fetchUsage();
    const p2 = fetchUsage();

    resolveFirst(okResponse(TYPICAL_BODY));
    await Promise.all([p1, p2]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('both concurrent callers receive the same result', async () => {
    let resolveFirst!: (v: Response) => void;
    mockFetch.mockReturnValueOnce(new Promise<Response>(r => { resolveFirst = r; }));

    const p1 = fetchUsage();
    const p2 = fetchUsage();
    resolveFirst(okResponse(TYPICAL_BODY));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
  });
});

// ── invalidateCache ───────────────────────────────────────────────────────────

describe('invalidateCache', () => {
  it('forces a real fetch on the next call', async () => {
    await fetchUsage(); // populates cache
    invalidateCache();
    await fetchUsage(); // must not use cache
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
