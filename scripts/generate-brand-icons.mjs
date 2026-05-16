/**
 * יוצר favicon / apple-touch מקבצי SVG המותג.
 * הרצה: node scripts/generate-brand-icons.mjs
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const svgPath = join(root, "public", "brand", "wego-w-icon.svg");
const outDir = join(root, "public", "icons");
const svg = readFileSync(svgPath);

mkdirSync(outDir, { recursive: true });

const sizes = [
  { name: "favicon-16x16.png", size: 16 },
  { name: "favicon-32x32.png", size: 32 },
  { name: "favicon-64x64.png", size: 64 },
  { name: "apple-touch-icon.png", size: 180 },
];

for (const { name, size } of sizes) {
  await sharp(svg).resize(size, size).png().toFile(join(outDir, name));
  console.log("wrote", name);
}

const png32 = await sharp(svg).resize(32, 32).png().toBuffer();
writeFileSync(join(root, "public", "favicon.ico"), png32);
writeFileSync(join(outDir, "favicon-32x32.png"), png32);
writeFileSync(join(root, "public", "icon.png"), png32);
writeFileSync(join(root, "src", "app", "icon.png"), png32);
writeFileSync(join(root, "src", "app", "favicon.ico"), png32);
const png180 = await sharp(svg).resize(180, 180).png().toBuffer();
writeFileSync(join(root, "public", "apple-touch-icon.png"), png180);
writeFileSync(join(root, "src", "app", "apple-icon.png"), png180);
console.log("wrote favicon.ico, icon.png, apple-touch-icon (public + src/app)");
