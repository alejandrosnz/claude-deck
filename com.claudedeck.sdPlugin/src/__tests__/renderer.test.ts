/**
 * Unit tests for renderer.ts
 *
 * No external dependencies to mock — renderer.ts is a pure module that only
 * uses Node.js built-in Buffer.
 */

import { describe, it, expect } from 'vitest';
import { renderButtonImage, svgToDataUrl, type ButtonRenderState } from '../renderer';

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
