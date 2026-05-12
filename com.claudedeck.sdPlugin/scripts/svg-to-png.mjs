/**
 * Convert SVG icons to PNG (72×72 and 144×144 for @2x).
 * Requires sharp: npm install sharp
 */
import fs from 'fs';
import path from 'path';

const sharp = await import('sharp');

const iconDir = './assets/icons';
const icons = ['usage5h', 'usage7d'];

for (const icon of icons) {
  const svgPath = path.join(iconDir, `${icon}.svg`);
  const pngPath = path.join(iconDir, `${icon}.png`);
  const png2xPath = path.join(iconDir, `${icon}@2x.png`);

  const svgBuffer = fs.readFileSync(svgPath);

  // 72×72
  await sharp.default(svgBuffer).png().resize(72, 72).toFile(pngPath);
  console.log(`✓ ${pngPath}`);

  // 144×144 (@2x)
  await sharp.default(svgBuffer).png().resize(144, 144).toFile(png2xPath);
  console.log(`✓ ${png2xPath}`);
}

console.log('Done!');
