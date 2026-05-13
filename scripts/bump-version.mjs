#!/usr/bin/env node
/**
 * Bumps the version in all three version files simultaneously:
 *   - package.json (root)
 *   - com.claudedeck.sdPlugin/package.json
 *   - com.claudedeck.sdPlugin/manifest.json
 *
 * Usage: node scripts/bump-version.mjs <new-version>
 * Example: node scripts/bump-version.mjs 0.2.0
 *
 * Or via npm: npm run version:bump -- 0.2.0
 */

import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const PLUGIN_DIR = "com.claudedeck.sdPlugin";

const newVersion = process.argv[2];

if (!newVersion || !/^\d+\.\d+\.\d+(-\S+)?$/.test(newVersion)) {
  console.error("Usage: node scripts/bump-version.mjs <version>  (e.g. 0.2.0)");
  process.exit(1);
}

function bumpJson(filePath, updater) {
  const content = readFileSync(filePath, "utf8");
  const obj = JSON.parse(content);
  updater(obj);
  writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n");
  console.log(`  ${filePath.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
}

console.log(`Bumping to ${newVersion}:`);

bumpJson(join(ROOT, "package.json"), (o) => { o.version = newVersion; });
bumpJson(join(ROOT, PLUGIN_DIR, "package.json"), (o) => { o.version = newVersion; });
bumpJson(join(ROOT, PLUGIN_DIR, "manifest.json"), (o) => { o.Version = newVersion; });

console.log(`
Next steps:
  git add -A
  git commit -m "chore: bump version to ${newVersion}"
  git tag v${newVersion}
  git push && git push --tags`);
