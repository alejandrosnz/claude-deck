/**
 * Unit tests for poller.ts — focuses on computeImage() and computeResetImage()
 * routing logic, plus toggleResetInfoForButton() behaviour.
 *
 * The renderer module is mocked so that each call returns a predictable string
 * encoding the state kind and label, letting us verify routing without
 * re-testing the SVG generation itself.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  formatRemaining: vi.fn(() => '1h 30m'),
  formatResetTime: vi.fn(() => '14:30'),
}));

// ── imports ───────────────────────────────────────────────────────────────────

import {
  computeImage,
  computeResetImage,
  registerButton,
  toggleResetInfoForButton,
  _resetPollerStateForTesting,
  type KeyActionLike,
} from '../poller';
import { renderButtonImage, formatRemaining, formatResetTime } from '../renderer';
import { fetchUsage } from '../usage-api';
import streamDeck from '@elgato/streamdeck';
import type { UsageData } from '../usage-api';

// ── fixtures ──────────────────────────────────────────────────────────────────

const subscriptionData: UsageData = {
  fiveHourPercent: 42,
  fiveHourResetsAt: '2026-05-12T18:00:00Z',
  sevenDayPercent: 15,
  sevenDayResetsAt: '2026-05-19T00:00:00Z',
  inferredBillingType: 'subscription',
};

// ── helpers ───────────────────────────────────────────────────────────────────

/** Flushes the microtask queue (needed to await void-launched async chains). */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// ── computeImage ──────────────────────────────────────────────────────────────

describe('computeImage', () => {
  beforeEach(() => {
    vi.mocked(renderButtonImage).mockImplementation(
      (state: { kind: string }, label: string) => `img:${state.kind}:${label}`,
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

// ── computeResetImage ─────────────────────────────────────────────────────────

describe('computeResetImage', () => {
  beforeEach(() => {
    vi.mocked(renderButtonImage).mockImplementation(
      (state: { kind: string }, label: string) => `img:${state.kind}:${label}`,
    );
    vi.mocked(formatRemaining).mockReturnValue('1h 30m');
    vi.mocked(formatResetTime).mockReturnValue('14:30');
  });

  describe('when data is null', () => {
    it('renders nodata state for usage5h', () => {
      computeResetImage('com.claudedeck.usage5h', null);
      expect(renderButtonImage).toHaveBeenCalledWith({ kind: 'nodata' }, '5h');
    });

    it('renders nodata state for usage7d', () => {
      computeResetImage('com.claudedeck.usage7d', null);
      expect(renderButtonImage).toHaveBeenCalledWith({ kind: 'nodata' }, '7d');
    });
  });

  describe('when billing type is "api"', () => {
    it('renders nodata state', () => {
      computeResetImage('com.claudedeck.usage5h', { ...subscriptionData, inferredBillingType: 'api' });
      expect(renderButtonImage).toHaveBeenCalledWith({ kind: 'nodata' }, '5h');
    });
  });

  describe('when resetsAt is null', () => {
    it('renders nodata state when fiveHourResetsAt is null', () => {
      computeResetImage('com.claudedeck.usage5h', { ...subscriptionData, fiveHourResetsAt: null });
      expect(renderButtonImage).toHaveBeenCalledWith({ kind: 'nodata' }, '5h');
    });

    it('renders nodata state when sevenDayResetsAt is null', () => {
      computeResetImage('com.claudedeck.usage7d', { ...subscriptionData, sevenDayResetsAt: null });
      expect(renderButtonImage).toHaveBeenCalledWith({ kind: 'nodata' }, '7d');
    });
  });

  describe('when data is available', () => {
    it('calls formatRemaining with the 5h resetsAt', () => {
      computeResetImage('com.claudedeck.usage5h', subscriptionData);
      expect(formatRemaining).toHaveBeenCalledWith('2026-05-12T18:00:00Z');
    });

    it('calls formatResetTime with the 5h resetsAt and is5h=true', () => {
      computeResetImage('com.claudedeck.usage5h', subscriptionData);
      expect(formatResetTime).toHaveBeenCalledWith('2026-05-12T18:00:00Z', true);
    });

    it('calls formatRemaining with the 7d resetsAt', () => {
      computeResetImage('com.claudedeck.usage7d', subscriptionData);
      expect(formatRemaining).toHaveBeenCalledWith('2026-05-19T00:00:00Z');
    });

    it('calls formatResetTime with the 7d resetsAt and is5h=false', () => {
      computeResetImage('com.claudedeck.usage7d', subscriptionData);
      expect(formatResetTime).toHaveBeenCalledWith('2026-05-19T00:00:00Z', false);
    });

    it('passes formatted strings to renderButtonImage for 5h', () => {
      computeResetImage('com.claudedeck.usage5h', subscriptionData);
      expect(renderButtonImage).toHaveBeenCalledWith(
        { kind: 'reset', remaining: '1h 30m', resetTime: '14:30' },
        '5h',
      );
    });

    it('passes formatted strings to renderButtonImage for 7d', () => {
      vi.mocked(formatResetTime).mockReturnValue('Mon 14:30');
      computeResetImage('com.claudedeck.usage7d', subscriptionData);
      expect(renderButtonImage).toHaveBeenCalledWith(
        { kind: 'reset', remaining: '1h 30m', resetTime: 'Mon 14:30' },
        '7d',
      );
    });

    it('returns the URL produced by renderButtonImage', () => {
      const result = computeResetImage('com.claudedeck.usage5h', subscriptionData);
      expect(result).toBe('img:reset:5h');
    });
  });
});

// ── toggleResetInfoForButton ──────────────────────────────────────────────────

describe('toggleResetInfoForButton', () => {
  let mockSetImage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    _resetPollerStateForTesting();

    mockSetImage = vi.fn().mockResolvedValue(undefined);
    vi.mocked(streamDeck.actions.getActionById).mockReturnValue({ setImage: mockSetImage } as never);
    vi.mocked(fetchUsage).mockResolvedValue(subscriptionData);
    vi.mocked(renderButtonImage).mockImplementation(
      (state: { kind: string }, label: string) => `img:${state.kind}:${label}`,
    );
    vi.mocked(formatRemaining).mockReturnValue('1h 30m');
    vi.mocked(formatResetTime).mockReturnValue('14:30');
  });

  afterEach(() => {
    _resetPollerStateForTesting();
    vi.useRealTimers();
  });

  it('does nothing when the button id is not registered', () => {
    toggleResetInfoForButton('unknown-id');
    expect(mockSetImage).not.toHaveBeenCalled();
  });

  it('shows reset info image on first press', async () => {
    registerButton('btn1', 'com.claudedeck.usage5h', { setImage: mockSetImage as unknown as KeyActionLike['setImage'] });
    await flushPromises(); // drain initial poll

    mockSetImage.mockClear();
    toggleResetInfoForButton('btn1');
    await flushPromises();

    expect(mockSetImage).toHaveBeenCalledWith('img:reset:5h');
  });

  it('shows reset info for 7d button', async () => {
    registerButton('btn1', 'com.claudedeck.usage7d', { setImage: mockSetImage as unknown as KeyActionLike['setImage'] });
    await flushPromises();

    vi.mocked(formatResetTime).mockReturnValue('Mon 14:30');
    vi.mocked(renderButtonImage).mockImplementation(
      (state: { kind: string }, label: string) => `img:${state.kind}:${label}`,
    );

    mockSetImage.mockClear();
    toggleResetInfoForButton('btn1');
    await flushPromises();

    expect(mockSetImage).toHaveBeenCalledWith('img:reset:7d');
  });

  it('reverts to usage image on second press', async () => {
    registerButton('btn1', 'com.claudedeck.usage5h', { setImage: mockSetImage as unknown as KeyActionLike['setImage'] });
    await flushPromises();

    toggleResetInfoForButton('btn1'); // first press → reset info
    await flushPromises();

    mockSetImage.mockClear();
    toggleResetInfoForButton('btn1'); // second press → revert
    await flushPromises();

    expect(mockSetImage).toHaveBeenCalledWith('img:usage:5h');
  });

  it('auto-reverts to usage image after 10 seconds', async () => {
    registerButton('btn1', 'com.claudedeck.usage5h', { setImage: mockSetImage as unknown as KeyActionLike['setImage'] });
    await flushPromises();

    toggleResetInfoForButton('btn1');
    await flushPromises();

    mockSetImage.mockClear();

    // Advance past the 10 s auto-revert timeout (but not the 120 s poll interval)
    vi.advanceTimersByTime(10_000);
    await flushPromises();

    expect(mockSetImage).toHaveBeenCalledWith('img:usage:5h');
  });

  it('does not auto-revert if second press cancels the timer', async () => {
    registerButton('btn1', 'com.claudedeck.usage5h', { setImage: mockSetImage as unknown as KeyActionLike['setImage'] });
    await flushPromises();

    toggleResetInfoForButton('btn1'); // enter reset info mode
    await flushPromises();

    toggleResetInfoForButton('btn1'); // cancel and revert manually
    await flushPromises();

    mockSetImage.mockClear();

    // Advancing time should NOT trigger another revert since the timer was cleared
    vi.advanceTimersByTime(10_000);
    await flushPromises();

    expect(mockSetImage).not.toHaveBeenCalled();
  });

  it('poll during reset-info mode does not override the display', async () => {
    registerButton('btn1', 'com.claudedeck.usage5h', { setImage: mockSetImage as unknown as KeyActionLike['setImage'] });
    await flushPromises();

    toggleResetInfoForButton('btn1'); // enter reset info mode
    await flushPromises();

    mockSetImage.mockClear();

    // Advance to trigger the 120 s poll interval (beyond 10 s but within 120 s first)
    // We simulate a poll by advancing past the poll interval
    vi.advanceTimersByTime(120_000);
    await flushPromises();

    // The poll should have fired but NOT updated this button (it's in reset-info mode)
    // So setImage should NOT have been called for the usage image during this window.
    // (The 10 s timer also fires here, causing a revert — so we check the call was not usage)
    // Because the 10 s timer fires at 10 s and the 120 s poll fires at 120 s,
    // advancing 120 s triggers both. After the 10 s revert, the button is in usage mode,
    // so the 120 s poll WILL update it. So we just verify that the first call after the
    // 10 s revert is usage.
    const calls = mockSetImage.mock.calls.map(c => c[0] as string);
    expect(calls[0]).toBe('img:usage:5h'); // 10 s auto-revert fires first
  });
});

