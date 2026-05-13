/**
 * PTY bridge — sends simulated keyboard input to the active Claude Code
 * terminal process.
 *
 * When the deck Accept/Reject button is pressed after the "ask" hook response,
 * Claude Code is showing its native y/n prompt in the user's terminal.  This
 * module locates the running `claude` process, resolves its controlling
 * terminal (PTY slave device), and injects a single character + newline to
 * answer the prompt.
 *
 * ── Platform support ──────────────────────────────────────────────────────────
 *
 * Linux  – uses TIOCSTI ioctl via a Python 3 one-liner, which injects bytes
 *          directly into the terminal's input queue.  Works on kernels < 6.2
 *          without elevated privileges; on 6.2+ requires CAP_SYS_TTY_CONFIG
 *          (root).  Falls back to a direct write to the slave device as a
 *          best-effort secondary attempt.
 *
 * macOS  – uses AppleScript (`osascript`) to send a keystroke to the
 *          frontmost application.  Requires Accessibility permissions for the
 *          terminal app in System Settings → Privacy & Security.
 *
 * Windows – not supported; logs a warning and returns false.  The user must
 *           respond to the Claude Code prompt in the terminal as usual.
 *
 * ── Fail-safe ─────────────────────────────────────────────────────────────────
 * All errors are caught internally.  A `false` return means the PTY injection
 * did not succeed — the user can always answer in the terminal, which remains
 * fully functional regardless.
 */

import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import streamDeck from '@elgato/streamdeck';

const PLATFORM = os.platform() as string;

// ── Process discovery ─────────────────────────────────────────────────────────

/**
 * Find the PID of the running `claude` CLI process.
 *
 * Tries an exact-name match first (`pgrep -x claude`) then falls back to
 * searching for the Claude Code install path in the argv string.
 *
 * Returns `null` on Windows or when no matching process is found.
 */
export function findClaudePid(): number | null {
  if (PLATFORM === 'win32') return null;
  try {
    // The shell one-liner is intentionally POSIX-compatible (/bin/sh).
    const raw = execSync(
      'pgrep -x claude 2>/dev/null || pgrep -f "/.claude/" 2>/dev/null | head -1',
      { encoding: 'utf8', timeout: 2000, shell: '/bin/sh' },
    );
    return (
      raw
        .trim()
        .split('\n')
        .map(Number)
        .filter((n) => !isNaN(n) && n > 0 && n !== process.pid)[0] ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Resolve the TTY slave device path for a process's stdin file descriptor.
 *
 * Linux  – reads the symlink at `/proc/<pid>/fd/0`.
 * macOS  – uses `lsof` to inspect open file descriptors.
 *
 * Returns a path such as `/dev/pts/3` or `/dev/ttys001`, or `null` on failure.
 */
export function getProcessTty(pid: number): string | null {
  try {
    if (PLATFORM === 'linux') {
      const link = fs.readlinkSync(`/proc/${pid}/fd/0`);
      return /^\/dev\//.test(link) ? link : null;
    }
    if (PLATFORM === 'darwin') {
      const out = execSync(`lsof -p ${pid} -a -d 0 -F n 2>/dev/null`, {
        encoding: 'utf8',
        timeout: 2000,
      });
      const m = out.match(/n(\/dev\/[^\n]+)/);
      return m?.[1]?.trim() ?? null;
    }
  } catch {
    // Ignore — caller receives null
  }
  return null;
}

// ── Input injection ───────────────────────────────────────────────────────────

/**
 * Inject characters into a TTY input queue using the TIOCSTI ioctl via a
 * Python 3 subprocess.
 *
 * TIOCSTI pushes bytes directly into the kernel's terminal input queue,
 * making them appear as if the user had typed them.  Available on Linux
 * kernels < 6.2 without privileges; on newer kernels requires root.
 */
function injectViaTiocsti(ttyPath: string, input: string): boolean {
  const script = [
    'import fcntl, termios',
    `f = open(${JSON.stringify(ttyPath)}, "w")`,
    `[fcntl.ioctl(f.fileno(), termios.TIOCSTI, c.encode()) for c in ${JSON.stringify(input)}]`,
    'f.close()',
  ].join('\n');
  try {
    execFileSync('python3', ['-c', script], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Write bytes directly to the TTY slave device.
 *
 * On a PTY, writes to the slave appear as terminal *output* rather than
 * terminal *input*, so this does NOT reliably answer a readline prompt.  It
 * is kept as a last-resort fallback for environments where TIOCSTI is
 * unavailable and the process happens to read from the same device.
 */
function injectByDirectWrite(ttyPath: string, input: string): boolean {
  try {
    fs.writeFileSync(ttyPath, input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a keystroke to the frontmost terminal application on macOS using
 * AppleScript.  Works irrespective of which process is in the foreground and
 * does not require knowing the PTY master.
 *
 * Requires Accessibility permissions for the calling terminal application.
 */
function injectViaAppleScript(key: string): boolean {
  // key code 36 = Return key
  const script = `tell application "System Events"\nkeystroke "${key}"\nkey code 36\nend tell`;
  try {
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send `"y\n"` (accept) or `"n\n"` (reject) to the active claude terminal.
 *
 * @returns `true` if the input was successfully injected; `false` if not.
 *   A `false` result is non-fatal — the Claude Code prompt remains visible in
 *   the terminal and the user can still answer there.
 */
export async function sendToClaudeTerminal(input: 'y\n' | 'n\n'): Promise<boolean> {
  if (PLATFORM === 'win32') {
    streamDeck.logger.warn(
      '[claude-deck] PTY input injection is not supported on Windows. ' +
        'Please respond to the Claude Code permission prompt in the terminal.',
    );
    return false;
  }

  if (PLATFORM === 'darwin') {
    const key = input === 'y\n' ? 'y' : 'n';
    const ok = injectViaAppleScript(key);
    if (!ok) {
      streamDeck.logger.warn(
        '[claude-deck] AppleScript keystroke injection failed. ' +
          'Ensure Accessibility access is granted for your terminal app.',
      );
    }
    return ok;
  }

  // Linux path
  const pid = findClaudePid();
  if (pid === null) {
    streamDeck.logger.warn('[claude-deck] PTY injection: could not find claude process PID.');
    return false;
  }

  const tty = getProcessTty(pid);
  if (tty === null) {
    streamDeck.logger.warn(`[claude-deck] PTY injection: could not resolve TTY for PID ${pid}.`);
    return false;
  }

  streamDeck.logger.info(
    `[claude-deck] PTY injection: sending "${input.trim()}" → ${tty} (PID ${pid})`,
  );

  // TIOCSTI is the reliable path; direct write is best-effort fallback.
  return injectViaTiocsti(tty, input) || injectByDirectWrite(tty, input);
}
