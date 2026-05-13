/**
 * Cross-platform credential reader for Claude Code OAuth tokens.
 *
 * - macOS: reads from Keychain via `security` CLI, falls back to file
 * - Linux / Windows: reads from candidate file paths (first match wins)
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { execSync } from 'child_process';
import streamDeck from '@elgato/streamdeck';

export interface OAuthCredentials {
  accessToken: string;
  /** Epoch milliseconds. May be absent for older credential formats. */
  expiresAt?: number;
}

interface RawCredentialsFile {
  claudeAiOauth?: {
    accessToken?: string;
    expiresAt?: number;
  };
}

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

/**
 * Candidate paths checked in order on Linux / Windows.
 * Claude Code has used different locations across versions.
 */
function candidatePaths(): string[] {
  const home = homedir();
  return [
    join(home, '.claude', '.credentials.json'),       // most common
    join(home, '.claude', 'credentials.json'),         // without leading dot
    join(home, '.config', 'claude', 'credentials.json'), // XDG config dir
    join(home, '.config', 'claude', '.credentials.json'),
  ];
}

/**
 * Returns OAuth credentials for Claude Code, or null if unavailable.
 * Never throws — all errors are swallowed and return null.
 */
export async function readCredentials(): Promise<OAuthCredentials | null> {
  if (platform() === 'darwin') {
    const fromKeychain = readFromKeychain();
    if (fromKeychain) return fromKeychain;
    // Fall through to file in case keychain read fails (CI, headless, etc.)
  }
  return readFromFile();
}

function readFromKeychain(): OAuthCredentials | null {
  try {
    const raw = execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -w`,
      { encoding: 'utf-8', timeout: 5_000 },
    ).trim();
    return parseCredentialsJson(raw);
  } catch {
    return null;
  }
}

function readFromFile(): OAuthCredentials | null {
  for (const filePath of candidatePaths()) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const creds = parseCredentialsJson(raw);
      if (creds) {
        streamDeck.logger.info(`[claude-deck] Credentials loaded from ${filePath}`);
        return creds;
      }
    } catch (err) {
      streamDeck.logger.warn(`[claude-deck] Failed to read ${filePath}: ${err}`);
    }
  }
  streamDeck.logger.warn(
    `[claude-deck] No credentials file found. Tried: ${candidatePaths().join(', ')}`,
  );
  return null;
}

export function parseCredentialsJson(raw: string): OAuthCredentials | null {
  try {
    const parsed = JSON.parse(raw) as RawCredentialsFile;
    const oauth = parsed?.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : undefined,
    };
  } catch {
    return null;
  }
}
