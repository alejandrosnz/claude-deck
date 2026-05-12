/**
 * Cross-platform credential reader for Claude Code OAuth tokens.
 *
 * - macOS: reads from Keychain via `security` CLI, falls back to file
 * - Linux / Windows: reads from ~/.claude/.credentials.json
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { execSync } from 'child_process';

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
const CREDENTIALS_FILE = join(homedir(), '.claude', '.credentials.json');

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
  try {
    const raw = readFileSync(CREDENTIALS_FILE, 'utf-8');
    return parseCredentialsJson(raw);
  } catch {
    return null;
  }
}

function parseCredentialsJson(raw: string): OAuthCredentials | null {
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
