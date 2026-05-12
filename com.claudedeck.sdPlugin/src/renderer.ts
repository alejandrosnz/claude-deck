/**
 * Button image renderer for 72×72 px Stream Deck / OpenDeck keypad buttons.
 *
 * Generates SVG strings and encodes them as base64 SVG data URLs.
 * No native binary dependencies — works on any Node.js platform.
 *
 * Visual layout (72×72):
 *   y=14  label  "5h" / "7d"  (11 px, grey)
 *   y=36  percent  "42%"       (22 px, colour-coded)
 *   y=42  gauge bar             (60×8 px)
 *   y=62  reset time            (9 px, grey)
 */

const W = 72;
const H = 72;

// Gauge bar geometry
const BAR_X = 6;
const BAR_Y = 44;
const BAR_W = 60;
const BAR_H = 8;
const BAR_RADIUS = 4;

// Colour thresholds
const COLOR_GREEN = '#2ecc40';
const COLOR_AMBER = '#ff851b';
const COLOR_RED = '#ff4136';
const COLOR_GREY = '#555555';
const COLOR_BG = '#1a1a1a';
const COLOR_LABEL = '#aaaaaa';
const COLOR_DIM = '#888888';
const COLOR_TRACK = '#2e2e2e';

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

function renderUsage(label: string, percent: number, resetsAt: string | null): string {
  const pct = Math.min(100, Math.max(0, percent));
  const color = gaugeColor(pct);
  const fillW = Math.round((pct / 100) * BAR_W);
  const pctText = `${Math.round(pct)}%`;
  const resetText = formatResetTime(resetsAt);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${COLOR_BG}"/>
  <text x="${W / 2}" y="15" fill="${COLOR_LABEL}" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="bold" text-anchor="middle">${x(label)}</text>
  <text x="${W / 2}" y="38" fill="${color}" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="bold" text-anchor="middle">${x(pctText)}</text>
  <rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" rx="${BAR_RADIUS}" fill="${COLOR_TRACK}"/>
  ${fillW > 0 ? `<rect x="${BAR_X}" y="${BAR_Y}" width="${fillW}" height="${BAR_H}" rx="${BAR_RADIUS}" fill="${color}"/>` : ''}
  ${resetText ? `<text x="${W / 2}" y="62" fill="${COLOR_DIM}" font-family="Arial,Helvetica,sans-serif" font-size="9" text-anchor="middle">&#8635; ${x(resetText)}</text>` : ''}
</svg>`;
}

function renderStatus(label: string, statusText: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${COLOR_BG}"/>
  <text x="${W / 2}" y="15" fill="${COLOR_LABEL}" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="bold" text-anchor="middle">${x(label)}</text>
  <text x="${W / 2}" y="42" fill="${color}" font-family="Arial,Helvetica,sans-serif" font-size="13" text-anchor="middle">${x(statusText)}</text>
</svg>`;
}

function renderNoData(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${COLOR_BG}"/>
  <text x="${W / 2}" y="15" fill="${COLOR_LABEL}" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="bold" text-anchor="middle">${x(label)}</text>
  <text x="${W / 2}" y="38" fill="${COLOR_GREY}" font-family="Arial,Helvetica,sans-serif" font-size="10" text-anchor="middle">no data</text>
  <text x="${W / 2}" y="52" fill="#444444" font-family="Arial,Helvetica,sans-serif" font-size="8" text-anchor="middle">(API plan?)</text>
</svg>`;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function gaugeColor(percent: number): string {
  if (percent > 90) return COLOR_RED;
  if (percent > 70) return COLOR_AMBER;
  return COLOR_GREEN;
}

function formatResetTime(resetsAt: string | null): string {
  if (!resetsAt) return '';
  try {
    const ms = new Date(resetsAt).getTime() - Date.now();
    if (ms <= 0) return 'reset soon';
    const totalMin = Math.floor(ms / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
  } catch {
    return '';
  }
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
