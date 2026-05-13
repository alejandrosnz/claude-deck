/**
 * Unit tests for poller.ts — focuses on computeImage() routing logic.
 *
 * The renderer module is mocked so that each call returns a predictable string
 * encoding the state kind and label, letting us verify routing without
 * re-testing the SVG generation itself.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@elgato/streamdeck', () => ({
  default: {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    actions: { getActionById: vi.fn() },
  },
}));

vi.mock('../usage-api', () => ({
  fetchUsage: vi.fn(),
  invalidateCache: vi.fn(),
}));

// Render mock returns a stable string that encodes what was passed in so tests
// can assert on routing without decoding base64 SVG.
vi.mock('../renderer', () => ({
  renderButtonImage: vi.fn((state: { kind: string }, label: string) => `img:${state.kind}:${label}`),
}));

// ── imports ───────────────────────────────────────────────────────────────────

import { computeImage } from '../poller';
import { renderButtonImage } from '../renderer';
import type { UsageData } from '../usage-api';

// ── fixtures ──────────────────────────────────────────────────────────────────

const subscriptionData: UsageData = {
  fiveHourPercent: 42,
  fiveHourResetsAt: '2026-05-12T18:00:00Z',
  sevenDayPercent: 15,
  sevenDayResetsAt: '2026-05-19T00:00:00Z',
  inferredBillingType: 'subscription',
};

// ── computeImage ──────────────────────────────────────────────────────────────

describe('computeImage', () => {
  beforeEach(() => {
    vi.mocked(renderButtonImage).mockImplementation(
      (state: { kind: string }, label?: string) => `img:${state.kind}:${label ?? ''}`,
    );
  });

  describe('when data is null', () => {
    it('renders error state for usage5h', () => {
      computeImage('com.claudedeck.usage5h', null);
      expect(renderButtonImage).toHaveBeenCalledWith({ kind: 'error' }, '5h');
    });

    it('renders error state for usage7d', () => {
      computeImage('com.claudedeck.usage7d', null);
      expect(renderButtonImage).toHaveBeenCalledWith({ kind: 'error' }, '7d');
    });
  });

  describe('when billing type is "api"', () => {
    const apiData: UsageData = { ...subscriptionData, inferredBillingType: 'api' };

    it('renders nodata state for usage5h', () => {
      computeImage('com.claudedeck.usage5h', apiData);
      expect(renderButtonImage).toHaveBeenCalledWith({ kind: 'nodata' }, '5h');
    });

    it('renders nodata state for usage7d', () => {
      computeImage('com.claudedeck.usage7d', apiData);
      expect(renderButtonImage).toHaveBeenCalledWith({ kind: 'nodata' }, '7d');
    });
  });

  describe('when percent is null (subscription plan but no data)', () => {
    it('renders nodata state for usage5h when fiveHourPercent is null', () => {
      computeImage('com.claudedeck.usage5h', { ...subscriptionData, fiveHourPercent: null });
      expect(renderButtonImage).toHaveBeenCalledWith({ kind: 'nodata' }, '5h');
    });

    it('renders nodata state for usage7d when sevenDayPercent is null', () => {
      computeImage('com.claudedeck.usage7d', { ...subscriptionData, sevenDayPercent: null });
      expect(renderButtonImage).toHaveBeenCalledWith({ kind: 'nodata' }, '7d');
    });
  });

  describe('when data is available (subscription plan with percent)', () => {
    it('passes the 5h percent and resetsAt to renderButtonImage', () => {
      computeImage('com.claudedeck.usage5h', subscriptionData);
      expect(renderButtonImage).toHaveBeenCalledWith(
        { kind: 'usage', percent: 42, resetsAt: '2026-05-12T18:00:00Z' },
        '5h',
      );
    });

    it('passes the 7d percent and resetsAt to renderButtonImage', () => {
      computeImage('com.claudedeck.usage7d', subscriptionData);
      expect(renderButtonImage).toHaveBeenCalledWith(
        { kind: 'usage', percent: 15, resetsAt: '2026-05-19T00:00:00Z' },
        '7d',
      );
    });

    it('returns the URL produced by renderButtonImage', () => {
      const result = computeImage('com.claudedeck.usage5h', subscriptionData);
      expect(result).toBe('img:usage:5h');
    });
  });

  describe('label derivation', () => {
    it('uses label "5h" for the usage5h manifest UUID', () => {
      computeImage('com.claudedeck.usage5h', null);
      expect(renderButtonImage).toHaveBeenCalledWith(expect.anything(), '5h');
    });

    it('uses label "7d" for the usage7d manifest UUID', () => {
      computeImage('com.claudedeck.usage7d', null);
      expect(renderButtonImage).toHaveBeenCalledWith(expect.anything(), '7d');
    });
  });
});
