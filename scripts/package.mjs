#!/usr/bin/env node
/**
 * Cross-platform packaging script.
 * Builds the plugin and produces claude-deck-v<version>.streamDeckPlugin.
 *
 * On Linux / macOS : uses `zip` (same as the GitHub Actions release workflow).
 * On Windows       : uses PowerShell Compress-Archive.
 *
 * Usage: npm run package
 */

import { execSync } from "child_process";
import { existsSync, rmSync, mkdirSync, cpSync, renameSync, writeFileSync } from "fs";
import { join, resolve, extname } from "path";
import { platform } from "os";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── Config ──────────────────────────────────────────────────────────────────
const PLUGIN_DIR = "com.claudedeck.sdPlugin";
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const BUNDLE = `claude-deck-v${version}.streamDeckPlugin`;
const BUNDLE_PATH = join(ROOT, BUNDLE);

// Files / directories to exclude from the bundle (relative to PLUGIN_DIR).
const EXCLUDES = [
  "src",
  "scripts",
  "node_modules",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "rollup.config.mjs",
  "eslint.config.js",
];

// ── 1. Sync manifest.json version ────────────────────────────────────────────
const manifestPath = join(ROOT, PLUGIN_DIR, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.Version !== version) {
  manifest.Version = version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Updated manifest.json Version to ${version}`);
} else {
  console.log(`manifest.json Version already at ${version}`);
}

// ── 2. Build ─────────────────────────────────────────────────────────────────
console.log("Building plugin…");
execSync("npm run build", { cwd: join(ROOT, PLUGIN_DIR), stdio: "inherit" });

// ── 3. Remove old bundle ─────────────────────────────────────────────────────
if (existsSync(BUNDLE_PATH)) {
  rmSync(BUNDLE_PATH);
  console.log(`Removed old ${BUNDLE}`);
}

// ── 4. Package ───────────────────────────────────────────────────────────────
console.log(`Packaging → ${BUNDLE}`);

if (platform() === "win32") {
  // On Windows: stage the files we want in a temp dir, then Compress-Archive.
  const TMP = join(ROOT, ".package-tmp");
  const STAGE = join(TMP, PLUGIN_DIR);

  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(STAGE, { recursive: true });

  // Copy everything except excluded entries.
  const pluginSrc = join(ROOT, PLUGIN_DIR);
  cpSync(pluginSrc, STAGE, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(pluginSrc.length).replace(/^[\\/]/, "");
      const topLevel = rel.split(/[\\/]/)[0];
      return !EXCLUDES.includes(topLevel);
    },
  });

  // Compress-Archive writes a .zip; rename to .streamDeckPlugin.
  const ZIP_TMP = join(ROOT, BUNDLE + ".zip");
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${STAGE}' -DestinationPath '${ZIP_TMP}' -Force"`,
    { stdio: "inherit" }
  );
  renameSync(ZIP_TMP, BUNDLE_PATH);

  rmSync(TMP, { recursive: true });
} else {
  // On Linux / macOS: mirror the GitHub Actions step exactly.
  // For directories use "dir/*" (excludes contents); for files use "file" (exact match).
  const excludeArgs = EXCLUDES.map((e) =>
    extname(e) === "" ? `--exclude "${PLUGIN_DIR}/${e}/*"` : `--exclude "${PLUGIN_DIR}/${e}"`
  ).join(" ");

  execSync(
    `zip -r "${BUNDLE}" "${PLUGIN_DIR}" ${excludeArgs}`,
    { cwd: ROOT, stdio: "inherit", shell: true }
  );
}

console.log(`\nDone: ${BUNDLE}`);
