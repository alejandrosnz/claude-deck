/**
 * Convert SVG icons to PNG (72×72 and 144×144 for @2x).
 * Requires sharp (installed in com.claudedeck.sdPlugin): npm install sharp
 *
 * Run from repo root: node scripts/svg-to-png.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// sharp lives in the plugin's node_modules
const sharp = require(path.join(__dirname, '../com.claudedeck.sdPlugin/node_modules/sharp'));

const iconDir = path.join(__dirname, '../com.claudedeck.sdPlugin/assets/icons');
const icons = ['usage5h', 'usage7d'];

for (const icon of icons) {
  const svgPath = path.join(iconDir, `${icon}.svg`);
  const pngPath = path.join(iconDir, `${icon}.png`);
  const png2xPath = path.join(iconDir, `${icon}@2x.png`);

  const svgBuffer = fs.readFileSync(svgPath);

  // 72×72
  await sharp(svgBuffer).png().resize(72, 72).toFile(pngPath);
  console.log(`✓ ${pngPath}`);

  // 144×144 (@2x)
  await sharp(svgBuffer).png().resize(144, 144).toFile(png2xPath);
  console.log(`✓ ${png2xPath}`);
}

console.log('Done!');
