/**
 * Dual logger: writes to both process stdout (console) and streamDeck.logger.
 *
 * OpenDeck does not reliably forward streamDeck.logger (WebSocket logMessage
 * events) to the plugin log file. Using console.log / console.warn /
 * console.error ensures the messages appear in the process stdout, which
 * OpenDeck captures to its log file.
 */

import streamDeck from '@elgato/streamdeck';

function stamp(): string {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

export const logger = {
  info(msg: string): void {
    console.log(`${stamp()} [INFO] ${msg}`);
    try { streamDeck.logger.info(msg); } catch { /* swallow — logger may not be ready */ }
  },
  warn(msg: string): void {
    console.warn(`${stamp()} [WARN] ${msg}`);
    try { streamDeck.logger.warn(msg); } catch { /* swallow */ }
  },
  error(msg: string | Error): void {
    const s = msg instanceof Error ? (msg.stack ?? `${msg.name}: ${msg.message}`) : msg;
    console.error(`${stamp()} [ERROR] ${s}`);
    try { streamDeck.logger.error(s); } catch { /* swallow */ }
  },
};
