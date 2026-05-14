/**
 * Button image renderer for 72×72 px Stream Deck / OpenDeck keypad buttons.
 *
 * Generates SVG strings and encodes them as base64 SVG data URLs.
 * No native binary dependencies — works on any Node.js platform.
 *
 * Visual layout (72×72) — optimised for ~12 mm physical buttons:
 *   y=6–18  label "5h" / "7d"   (14 px bold, grey, letter-spaced)
 *   y=20–52 percent "42%"        (28 px bold, colour-coded) ← hero element
 *   y=56–68 gauge bar            (64×12 px, thick and wide)
 *
 * The reset-time line was removed from the usage view — 9 px text is illegible
 * on a 12 mm button. Reset time is shown only on key press (reset-info overlay).
 *
 * Reset info layout (shown on key press, 10 s):
 *   y=17    "resets in"         (13 px grey)
 *   y=46    remaining "1h 23m"  (24 px bold, white)  ← hero
 *   y=65    "14:30" / "Mon 14:30"  (15 px grey)
 */

const W = 72;
const H = 72;

// Gauge bar geometry
const BAR_X = 4;
const BAR_Y = 56;
const BAR_W = 64;
const BAR_H = 12;
const BAR_RADIUS = 6;

// Colour palette
const COLOR_GREEN = '#2ecc40';
const COLOR_AMBER = '#ff851b';
const COLOR_RED = '#ff4136';
const COLOR_GREY = '#555555';
const COLOR_BG = '#111111';
const COLOR_LABEL = '#888888';
const COLOR_TRACK = '#252525';

// ── public types ──────────────────────────────────────────────────────────────

export type ButtonRenderState =
  | { kind: 'usage'; percent: number }
  | { kind: 'reset'; remaining: string; resetTime: string }
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
      svg = renderUsage(label, state.percent);
      break;
    case 'reset':
      svg = renderResetInfo(state.remaining, state.resetTime);
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

/**
 * Wraps SVG body content in the standard 72×72 shell with a dark background
 * and the short label text ("5h" / "7d") at the top.
 */
function svgWrapper(label: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${COLOR_BG}"/>
  <text x="${W / 2}" y="16" fill="${COLOR_LABEL}" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="bold" text-anchor="middle" letter-spacing="2">${escapeXml(label)}</text>${body}</svg>`;
}

function renderUsage(label: string, percent: number): string {
  const pct = Math.min(100, Math.max(0, percent));
  const color = gaugeColor(pct);
  const fillW = Math.round((pct / 100) * BAR_W);
  // Clamp rx so the fill rect doesn't produce a degenerate pill at small widths.
  const fillRx = Math.min(BAR_RADIUS, Math.floor(fillW / 2));
  const pctText = `${Math.round(pct)}%`;
  const fillRect = fillW > 0
    ? `  <rect x="${BAR_X}" y="${BAR_Y}" width="${fillW}" height="${BAR_H}" rx="${fillRx}" fill="${color}"/>\n`
    : '';

  return svgWrapper(
    label,
    `
  <text x="${W / 2}" y="47" fill="${color}" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="bold" text-anchor="middle">${escapeXml(pctText)}</text>
  <rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" rx="${BAR_RADIUS}" fill="${COLOR_TRACK}"/>
${fillRect}`,
  );
}

function renderStatus(label: string, statusText: string, color: string): string {
  return svgWrapper(
    label,
    `
  <text x="${W / 2}" y="45" fill="${color}" font-family="Arial,Helvetica,sans-serif" font-size="18" text-anchor="middle">${escapeXml(statusText)}</text>
`,
  );
}

function renderNoData(label: string): string {
  return svgWrapper(
    label,
    `
  <text x="${W / 2}" y="45" fill="${COLOR_GREY}" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="bold" text-anchor="middle">&#8211;%</text>
`,
  );
}

function renderResetInfo(remaining: string, resetTime: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${COLOR_BG}"/>
  <text x="${W / 2}" y="17" fill="${COLOR_LABEL}" font-family="Arial,Helvetica,sans-serif" font-size="13" text-anchor="middle">resets in</text>
  <text x="${W / 2}" y="46" fill="#ffffff" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="bold" text-anchor="middle">${escapeXml(remaining)}</text>
  <text x="${W / 2}" y="65" fill="${COLOR_LABEL}" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="bold" text-anchor="middle">${escapeXml(resetTime)}</text>
</svg>`;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function gaugeColor(percent: number): string {
  if (percent > 90) return COLOR_RED;
  if (percent > 70) return COLOR_AMBER;
  return COLOR_GREEN;
}

/** Escapes XML special characters for safe embedding in SVG text nodes. */
function escapeXml(s: string): string {
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

// ── time formatting helpers (exported for testing and poller use) ─────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Returns a human-readable string for the time remaining until `resetsAt`.
 * Examples: "< 1m", "45m", "1h 30m", "2d 3h", "now"
 *
 * Note: when ≥ 1 day remains, minutes are intentionally omitted —
 * "2d 2h" is more legible than "2d 2h 47m" on a 12 mm button.
 *
 * Returns "now" for past timestamps or invalid date strings.
 */
export function formatRemaining(resetsAt: string): string {
  const diffMs = new Date(resetsAt).getTime() - Date.now();
  if (isNaN(diffMs) || diffMs <= 0) return 'now';
  const totalMin = Math.floor(diffMs / 60_000);
  if (totalMin < 1) return '< 1m';
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 1) return `${mins}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days < 1) return `${hours}h ${mins}m`;
  return `${days}d ${remHours}h`;
}

/**
 * Returns the local reset time formatted for display on the button.
 * - 5h: "HH:MM" (time only)
 * - 7d: "DDD HH:MM" (short day name + time)
 *
 * Returns "--:--" for invalid date strings.
 */
export function formatResetTime(resetsAt: string, is5h: boolean): string {
  const d = new Date(resetsAt);
  if (isNaN(d.getTime())) return '--:--';
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  if (is5h) return `${hh}:${mm}`;
  return `${DAY_NAMES[d.getDay()]} ${hh}:${mm}`;
}
