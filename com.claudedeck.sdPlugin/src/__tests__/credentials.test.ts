/**
 * Unit tests for credentials.ts
 *
 * Node.js built-ins (fs, os, child_process) are mocked so no real filesystem
 * or keychain access occurs during tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks (hoisted before imports by Vitest) ──────────────────────────────────

vi.mock('@elgato/streamdeck', () => ({
  default: {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
  platform: vi.fn(() => 'linux'),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// ── imports (after mocks are registered) ─────────────────────────────────────

import { existsSync, readFileSync } from 'fs';
import { platform } from 'os';
import { execSync } from 'child_process';
import { parseCredentialsJson, readCredentials } from '../credentials';

// ── parseCredentialsJson ──────────────────────────────────────────────────────

describe('parseCredentialsJson', () => {
  it('parses valid JSON and returns credentials', () => {
    const json = JSON.stringify({
      claudeAiOauth: { accessToken: 'tok123', expiresAt: 9_999_999 },
    });
    expect(parseCredentialsJson(json)).toEqual({
      accessToken: 'tok123',
      expiresAt: 9_999_999,
    });
  });

  it('returns null for invalid JSON', () => {
    expect(parseCredentialsJson('not json { at all')).toBeNull();
  });

  it('returns null when claudeAiOauth key is absent', () => {
    expect(parseCredentialsJson(JSON.stringify({}))).toBeNull();
  });

  it('returns null when accessToken is missing', () => {
    expect(parseCredentialsJson(JSON.stringify({ claudeAiOauth: {} }))).toBeNull();
  });

  it('returns credentials when accessToken is any truthy value (runtime type is not enforced)', () => {
    // The JSON.parse output is untyped at runtime; the function only checks
    // truthiness of accessToken, not that it is a string.
    expect(
      parseCredentialsJson(JSON.stringify({ claudeAiOauth: { accessToken: 123 } })),
    ).not.toBeNull();
  });

  it('omits expiresAt when it is not a number', () => {
    const json = JSON.stringify({
      claudeAiOauth: { accessToken: 'tok', expiresAt: 'bad-value' },
    });
    const result = parseCredentialsJson(json);
    expect(result?.accessToken).toBe('tok');
    expect(result?.expiresAt).toBeUndefined();
  });

  it('includes expiresAt when it is a valid number', () => {
    const json = JSON.stringify({
      claudeAiOauth: { accessToken: 'tok', expiresAt: 1234567890 },
    });
    expect(parseCredentialsJson(json)?.expiresAt).toBe(1234567890);
  });
});

// ── readCredentials — file-based (Linux / Windows) ────────────────────────────

describe('readCredentials — file-based', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platform).mockReturnValue('linux');
  });

  it('returns null when no candidate file exists', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(await readCredentials()).toBeNull();
  });

  it('returns credentials from the first existing valid file', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: 'file-token', expiresAt: 111 } }),
    );
    const result = await readCredentials();
    expect(result?.accessToken).toBe('file-token');
    // Only the first file should be read
    expect(vi.mocked(readFileSync)).toHaveBeenCalledTimes(1);
  });

  it('skips files whose JSON does not contain valid credentials and tries the next', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync)
      .mockReturnValueOnce('invalid json') // first file: parse error → null creds
      .mockReturnValueOnce(
        JSON.stringify({ claudeAiOauth: { accessToken: 'second-file-token' } }),
      );
    const result = await readCredentials();
    expect(result?.accessToken).toBe('second-file-token');
  });

  it('returns null when all files contain invalid credentials', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ noCreds: true }));
    expect(await readCredentials()).toBeNull();
  });

  it('skips files that throw on readFileSync and tries the next', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync)
      .mockImplementationOnce(() => { throw new Error('EACCES: permission denied'); })
      .mockReturnValueOnce(
        JSON.stringify({ claudeAiOauth: { accessToken: 'fallback-token' } }),
      );
    const result = await readCredentials();
    expect(result?.accessToken).toBe('fallback-token');
  });
});

// ── readCredentials — macOS keychain ─────────────────────────────────────────

describe('readCredentials — macOS keychain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platform).mockReturnValue('darwin');
  });

  it('returns credentials from the keychain on macOS', async () => {
    vi.mocked(execSync).mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: 'keychain-token', expiresAt: 999 } }),
    );
    const result = await readCredentials();
    expect(result?.accessToken).toBe('keychain-token');
    // Should not fall through to file system
    expect(vi.mocked(existsSync)).not.toHaveBeenCalled();
  });

  it('falls back to file when keychain throws', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('security: keychain unavailable');
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: 'file-fallback' } }),
    );
    const result = await readCredentials();
    expect(result?.accessToken).toBe('file-fallback');
  });

  it('falls back to file when keychain returns invalid JSON', async () => {
    vi.mocked(execSync).mockReturnValue('garbage output');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: 'file-after-bad-keychain' } }),
    );
    const result = await readCredentials();
    expect(result?.accessToken).toBe('file-after-bad-keychain');
  });
});
