// Stage approved OVLANE icon exports into the existing public PWA routes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sizes = [180, 192, 512];
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const staged = sizes.map(size => {
  const png = readFileSync(new URL(`../assets/brand/icons/icon-${size}.png`, import.meta.url));
  if (png.length < 33 || !png.subarray(0, 8).equals(signature) ||
      png.toString('ascii', 12, 16) !== 'IHDR' ||
      png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) {
    throw new Error(`Invalid OVLANE icon export: ${size}`);
  }
  return { size, png };
});

const destination = new URL('../public/icons/', import.meta.url);
mkdirSync(destination, { recursive: true });
for (const { size, png } of staged) {
  writeFileSync(new URL(`icon-${size}.png`, destination), png);
}
// Existing web push payloads reference this legacy URL.
writeFileSync(new URL('../public/pwa-192.png', import.meta.url), staged.find(icon => icon.size === 192).png);
console.log('Staged OVLANE app icons: 180, 192, 512');
