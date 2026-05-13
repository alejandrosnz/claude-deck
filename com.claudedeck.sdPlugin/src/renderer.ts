/**
 * Button image renderer for 72×72 px Stream Deck / OpenDeck keypad buttons.
 *
 * Generates SVG strings and encodes them as base64 SVG data URLs.
 * No native binary dependencies — works on any Node.js platform.
 *
 * Visual layout (72×72) — optimised for ~12 mm physical buttons:
 *   y=6–17  label "5h" / "7d"   (12 px bold, grey, letter-spaced)
 *   y=20–52 percent "42%"        (28 px bold, colour-coded) ← hero element
 *   y=56–68 gauge bar            (64×12 px, thick and wide)
 *
 * The reset-time line was removed — 9 px text is illegible on a 12 mm button.
 */

const W = 72;
const H = 72;

// Gauge bar geometry — thicker and wider than before
const BAR_X = 4;
const BAR_Y = 56;
const BAR_W = 64;
const BAR_H = 12;
const BAR_RADIUS = 6;

// Colour thresholds
const COLOR_GREEN = '#2ecc40';
const COLOR_AMBER = '#ff851b';
const COLOR_RED = '#ff4136';
const COLOR_GREY = '#555555';
const COLOR_BG = '#111111';      // darker → more contrast
const COLOR_LABEL = '#888888';
const COLOR_TRACK = '#252525';

// ── public types ──────────────────────────────────────────────────────────────

export type ButtonRenderState =
  | { kind: 'usage'; percent: number; resetsAt: string | null }
  | { kind: 'loading' }
  | { kind: 'nodata' }
  | { kind: 'error' };

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Renders a button image and returns a data URL suitable for `action.setImage()`.
 *
 * @param state  What to display
 * @param label  Short label shown at the top ("5h" or "7d")
 */
export function renderButtonImage(state: ButtonRenderState, label: string): string {
  let svg: string;
  switch (state.kind) {
    case 'usage':
      svg = renderUsage(label, state.percent, state.resetsAt);
      break;
    case 'loading':
      svg = renderStatus(label, '···', COLOR_GREY);
      break;
    case 'nodata':
      svg = renderNoData(label);
      break;
    case 'error':
      svg = renderStatus(label, 'err', COLOR_RED);
      break;
  }
  return svgToDataUrl(svg);
}

// ── SVG generators ────────────────────────────────────────────────────────────

function renderUsage(label: string, percent: number, _resetsAt: string | null): string {
  const pct = Math.min(100, Math.max(0, percent));
  const color = gaugeColor(pct);
  const fillW = Math.round((pct / 100) * BAR_W);
  const pctText = `${Math.round(pct)}%`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${COLOR_BG}"/>
  <text x="${W / 2}" y="15" fill="${COLOR_LABEL}" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="bold" text-anchor="middle" letter-spacing="2">${x(label)}</text>
  <text x="${W / 2}" y="47" fill="${color}" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="bold" text-anchor="middle">${x(pctText)}</text>
  <rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" rx="${BAR_RADIUS}" fill="${COLOR_TRACK}"/>
  ${fillW > 0 ? `<rect x="${BAR_X}" y="${BAR_Y}" width="${fillW}" height="${BAR_H}" rx="${BAR_RADIUS}" fill="${color}"/>` : ''}
</svg>`;
}

function renderStatus(label: string, statusText: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${COLOR_BG}"/>
  <text x="${W / 2}" y="15" fill="${COLOR_LABEL}" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="bold" text-anchor="middle" letter-spacing="2">${x(label)}</text>
  <text x="${W / 2}" y="45" fill="${color}" font-family="Arial,Helvetica,sans-serif" font-size="18" text-anchor="middle">${x(statusText)}</text>
</svg>`;
}

function renderNoData(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${COLOR_BG}"/>
  <text x="${W / 2}" y="15" fill="${COLOR_LABEL}" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="bold" text-anchor="middle" letter-spacing="2">${x(label)}</text>
  <text x="${W / 2}" y="45" fill="${COLOR_GREY}" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="bold" text-anchor="middle">&#8211;%</text>
</svg>`;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function gaugeColor(percent: number): string {
  if (percent > 90) return COLOR_RED;
  if (percent > 70) return COLOR_AMBER;
  return COLOR_GREEN;
}

/** Escapes XML special characters. */
function x(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Encodes an SVG string as a base64 data URL. */
export function svgToDataUrl(svg: string): string {
  const b64 = Buffer.from(svg, 'utf-8').toString('base64');
  return `data:image/svg+xml;base64,${b64}`;
}
