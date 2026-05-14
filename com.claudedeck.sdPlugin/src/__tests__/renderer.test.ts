/**
 * Unit tests for renderer.ts
 *
 * No external dependencies to mock — renderer.ts is a pure module that only
 * uses Node.js built-in Buffer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderButtonImage, svgToDataUrl, formatRemaining, formatResetTime, type ButtonRenderState } from '../renderer';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Decodes a base64 SVG data URL back to the raw SVG string. */
function decodeSvg(dataUrl: string): string {
  const b64 = dataUrl.replace('data:image/svg+xml;base64,', '');
  return Buffer.from(b64, 'base64').toString('utf-8');
}

// ── svgToDataUrl ──────────────────────────────────────────────────────────────

describe('svgToDataUrl', () => {
  it('returns a data URL with the correct MIME type prefix', () => {
    expect(svgToDataUrl('<svg></svg>')).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('round-trips the SVG string correctly', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>hello</text></svg>';
    const url = svgToDataUrl(svg);
    const decoded = Buffer.from(url.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf-8');
    expect(decoded).toBe(svg);
  });

  it('handles empty string', () => {
    const url = svgToDataUrl('');
    expect(url).toBe('data:image/svg+xml;base64,');
  });
});

// ── renderButtonImage — output format ─────────────────────────────────────────

describe('renderButtonImage — output format', () => {
  const allStates: ButtonRenderState[] = [
    { kind: 'loading' },
    { kind: 'error' },
    { kind: 'nodata' },
    { kind: 'usage', percent: 42, resetsAt: null },
    { kind: 'usage', percent: 42, resetsAt: '2026-05-12T18:00:00Z' },
    { kind: 'reset', remaining: '1h 30m', resetTime: '14:30' },
  ];

  it('always returns a data URL', () => {
    for (const state of allStates) {
      expect(renderButtonImage(state, '5h')).toMatch(/^data:image\/svg\+xml;base64,/);
    }
  });

  it('output decodes to a valid SVG element', () => {
    for (const state of allStates) {
      const svg = decodeSvg(renderButtonImage(state, '5h'));
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    }
  });
});

// ── renderButtonImage — usage state ──────────────────────────────────────────

describe('renderButtonImage — usage state', () => {
  it('includes the percentage text', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'usage', percent: 42, resetsAt: null }, '5h'));
    expect(svg).toContain('42%');
  });

  it('rounds fractional percent values', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'usage', percent: 42.7, resetsAt: null }, '5h'));
    expect(svg).toContain('43%');
  });

  describe('colour thresholds', () => {
    it('uses green for percent = 0', () => {
      expect(decodeSvg(renderButtonImage({ kind: 'usage', percent: 0, resetsAt: null }, '5h'))).toContain('#2ecc40');
    });

    it('uses green for percent = 70 (boundary)', () => {
      expect(decodeSvg(renderButtonImage({ kind: 'usage', percent: 70, resetsAt: null }, '5h'))).toContain('#2ecc40');
    });

    it('uses amber for percent = 71 (just above green threshold)', () => {
      expect(decodeSvg(renderButtonImage({ kind: 'usage', percent: 71, resetsAt: null }, '5h'))).toContain('#ff851b');
    });

    it('uses amber for percent = 90 (boundary)', () => {
      expect(decodeSvg(renderButtonImage({ kind: 'usage', percent: 90, resetsAt: null }, '5h'))).toContain('#ff851b');
    });

    it('uses red for percent = 91 (just above amber threshold)', () => {
      expect(decodeSvg(renderButtonImage({ kind: 'usage', percent: 91, resetsAt: null }, '5h'))).toContain('#ff4136');
    });

    it('uses red for percent = 100', () => {
      expect(decodeSvg(renderButtonImage({ kind: 'usage', percent: 100, resetsAt: null }, '5h'))).toContain('#ff4136');
    });
  });

  describe('percent clamping', () => {
    it('clamps percent above 100 to 100', () => {
      const svg = decodeSvg(renderButtonImage({ kind: 'usage', percent: 200, resetsAt: null }, '5h'));
      expect(svg).toContain('100%');
    });

    it('clamps percent below 0 to 0', () => {
      const svg = decodeSvg(renderButtonImage({ kind: 'usage', percent: -5, resetsAt: null }, '5h'));
      expect(svg).toContain('0%');
    });
  });

  describe('gauge bar', () => {
    it('renders only background + track rect (no fill) when percent = 0', () => {
      const svg = decodeSvg(renderButtonImage({ kind: 'usage', percent: 0, resetsAt: null }, '5h'));
      expect(svg.match(/<rect/g)?.length).toBe(2); // bg + track
    });

    it('renders background + track + fill rect when percent > 0', () => {
      const svg = decodeSvg(renderButtonImage({ kind: 'usage', percent: 50, resetsAt: null }, '5h'));
      expect(svg.match(/<rect/g)?.length).toBe(3); // bg + track + fill
    });
  });
});

// ── renderButtonImage — loading state ────────────────────────────────────────

describe('renderButtonImage — loading state', () => {
  it('renders the loading dots indicator', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'loading' }, '5h'));
    expect(svg).toContain('···');
  });

  it('uses grey colour for the status text', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'loading' }, '5h'));
    expect(svg).toContain('#555555');
  });
});

// ── renderButtonImage — error state ──────────────────────────────────────────

describe('renderButtonImage — error state', () => {
  it('renders "err" text', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'error' }, '5h'));
    expect(svg).toContain('err');
  });

  it('uses red colour', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'error' }, '5h'));
    expect(svg).toContain('#ff4136');
  });
});

// ── renderButtonImage — nodata state ─────────────────────────────────────────

describe('renderButtonImage — nodata state', () => {
  it('renders em-dash percent placeholder', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'nodata' }, '5h'));
    expect(svg).toContain('&#8211;%');
  });

  it('uses grey colour', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'nodata' }, '5h'));
    expect(svg).toContain('#555555');
  });
});

// ── renderButtonImage — label ─────────────────────────────────────────────────

describe('renderButtonImage — label', () => {
  it('includes the label in usage state', () => {
    expect(decodeSvg(renderButtonImage({ kind: 'usage', percent: 50, resetsAt: null }, '5h'))).toContain('5h');
    expect(decodeSvg(renderButtonImage({ kind: 'usage', percent: 50, resetsAt: null }, '7d'))).toContain('7d');
  });

  it('includes the label in loading state', () => {
    expect(decodeSvg(renderButtonImage({ kind: 'loading' }, '5h'))).toContain('5h');
  });

  it('includes the label in nodata state', () => {
    expect(decodeSvg(renderButtonImage({ kind: 'nodata' }, '7d'))).toContain('7d');
  });
});

// ── renderButtonImage — XML escaping ─────────────────────────────────────────

describe('renderButtonImage — XML escaping in label', () => {
  it('escapes & character', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'nodata' }, 'a&b'));
    expect(svg).toContain('a&amp;b');
    expect(svg).not.toContain('a&b');
  });

  it('escapes < and > characters', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'nodata' }, '<tag>'));
    expect(svg).toContain('&lt;tag&gt;');
  });

  it('escapes double quotes', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'nodata' }, '"hi"'));
    expect(svg).toContain('&quot;hi&quot;');
  });

  it("escapes single quotes", () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'nodata' }, "it's"));
    expect(svg).toContain('it&#39;s');
  });
});

// ── renderButtonImage — reset state ──────────────────────────────────────────

describe('renderButtonImage — reset state', () => {
  it('renders the remaining time text', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'reset', remaining: '1h 30m', resetTime: '14:30' }, '5h'));
    expect(svg).toContain('1h 30m');
  });

  it('renders the reset time text', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'reset', remaining: '45m', resetTime: 'Mon 14:30' }, '7d'));
    expect(svg).toContain('Mon 14:30');
  });

  it('renders the "resets in" label', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'reset', remaining: '2h 5m', resetTime: '09:00' }, '5h'));
    expect(svg).toContain('resets in');
  });

  it('uses white colour for remaining time', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'reset', remaining: '1h 0m', resetTime: '18:00' }, '5h'));
    expect(svg).toContain('#ffffff');
  });

  it('XML-escapes remaining and resetTime strings', () => {
    const svg = decodeSvg(renderButtonImage({ kind: 'reset', remaining: '< 1m', resetTime: 'a&b' }, '5h'));
    expect(svg).toContain('&lt; 1m');
    expect(svg).toContain('a&amp;b');
  });
});

// ── formatRemaining ───────────────────────────────────────────────────────────

describe('formatRemaining', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fix "now" to 2026-05-12T10:00:00Z
    vi.setSystemTime(new Date('2026-05-12T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "now" when resetsAt is in the past', () => {
    expect(formatRemaining('2026-05-12T09:00:00Z')).toBe('now');
  });

  it('returns "now" when resetsAt equals current time', () => {
    expect(formatRemaining('2026-05-12T10:00:00Z')).toBe('now');
  });

  it('returns "< 1m" when less than 1 minute remains', () => {
    expect(formatRemaining('2026-05-12T10:00:30Z')).toBe('< 1m');
  });

  it('returns minutes only when less than 1 hour remains', () => {
    expect(formatRemaining('2026-05-12T10:45:00Z')).toBe('45m');
  });

  it('returns hours and minutes when less than 1 day remains', () => {
    expect(formatRemaining('2026-05-12T11:30:00Z')).toBe('1h 30m');
  });

  it('returns hours and 0 minutes correctly', () => {
    expect(formatRemaining('2026-05-12T12:00:00Z')).toBe('2h 0m');
  });

  it('returns days and hours when 1+ days remain', () => {
    // 2d 2h from 10:00 on 12th = 12:00 on 14th
    expect(formatRemaining('2026-05-14T12:00:00Z')).toBe('2d 2h');
  });

  it('returns "1m" for exactly 1 minute remaining', () => {
    expect(formatRemaining('2026-05-12T10:01:00Z')).toBe('1m');
  });
});

// ── formatResetTime ───────────────────────────────────────────────────────────

describe('formatResetTime', () => {
  it('returns HH:MM format for 5h (is5h = true)', () => {
    expect(formatResetTime('2026-05-12T14:30:00Z', true)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns DDD HH:MM format for 7d (is5h = false)', () => {
    expect(formatResetTime('2026-05-12T14:30:00Z', false)).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}$/);
  });

  it('uses a recognised day abbreviation for 7d', () => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const result = formatResetTime('2026-05-18T00:00:00Z', false);
    const dayPart = result.split(' ')[0];
    expect(days).toContain(dayPart);
  });

  it('pads single-digit hours with a leading zero for 5h', () => {
    // Pick a UTC time that in any timezone west of UTC+10 still has hour < 10 locally.
    // We just check the pattern — exact values are timezone-dependent.
    expect(formatResetTime('2026-05-12T03:05:00Z', true)).toMatch(/^\d{2}:\d{2}$/);
  });
});
