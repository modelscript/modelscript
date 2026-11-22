// SPDX-License-Identifier: AGPL-3.0-or-later

import { gzipSync, strFromU8, unzipSync } from "fflate";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

function padIconViewBox(svg: string): string {
  if (!svg || !svg.includes("<svg") || svg.includes('data-viewbox-padded="true"')) return svg;
  const vbMatch = svg.match(/viewBox\s*=\s*(["'])([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\1/);
  if (!vbMatch) return svg;

  const quote = vbMatch[1];
  const vx = parseFloat(vbMatch[2]!);
  const vy = parseFloat(vbMatch[3]!);
  const vw = parseFloat(vbMatch[4]!);
  const vh = parseFloat(vbMatch[5]!);

  if (isNaN(vx) || isNaN(vy) || isNaN(vw) || isNaN(vh) || vw <= 0 || vh <= 0) return svg;
  if (vx >= 0 && vy >= 0) return svg;

  const padX = vw * 0.025;
  const padY = vh * 0.025;
  const newVx = +(vx - padX).toFixed(2);
  const newVy = +(vy - padY).toFixed(2);
  const newVw = +(vw + padX * 2).toFixed(2);
  const newVh = +(vh + padY * 2).toFixed(2);

  return svg.replace(
    vbMatch[0],
    `data-viewbox-padded="true" viewBox=${quote}${newVx} ${newVy} ${newVw} ${newVh}${quote}`,
  );
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

async function main() {
  const zipPath = resolve(repoRoot, "data/libraries/Modelica/4.1.0/lsp-bundle.zip");
  const assetsDir = resolve(repoRoot, "packages/lsp/assets");
  const targetGzPath = resolve(assetsDir, "msl-icons.json.gz");

  if (!existsSync(zipPath)) {
    console.error(`Error: ${zipPath} not found.`);
    process.exit(1);
  }

  console.log(`Reading MSL bundle from ${zipPath}...`);
  const buf = readFileSync(zipPath);
  const unzipped = unzipSync(new Uint8Array(buf));

  const iconsData = unzipped["icons.json"];
  if (!iconsData) {
    console.error("Error: icons.json not found in lsp-bundle.zip");
    process.exit(1);
  }

  const jsonStr = strFromU8(iconsData);
  const parsed = JSON.parse(jsonStr) as Record<string, string>;
  const iconCount = Object.keys(parsed).length;
  console.log(`Found ${iconCount} pre-rendered icons in icons.json.`);

  for (const [key, svg] of Object.entries(parsed)) {
    if (svg) {
      parsed[key] = padIconViewBox(svg);
    }
  }

  const processedData = new TextEncoder().encode(JSON.stringify(parsed));

  // Compress using gzip (level 9 for maximum compression)
  const gzipped = gzipSync(processedData, { level: 9 });
  console.log(
    `Original size: ${(processedData.byteLength / 1024).toFixed(1)} KB, Compressed: ${(gzipped.byteLength / 1024).toFixed(1)} KB`,
  );

  if (!existsSync(assetsDir)) {
    mkdirSync(assetsDir, { recursive: true });
  }

  writeFileSync(targetGzPath, Buffer.from(gzipped));
  console.log(`Wrote pre-baked MSL icon bundle to ${targetGzPath}`);

  // Also copy to dist if dist exists
  const distDir = resolve(repoRoot, "packages/lsp/dist");
  if (existsSync(distDir)) {
    const distGzPath = resolve(distDir, "msl-icons.json.gz");
    writeFileSync(distGzPath, Buffer.from(gzipped));
    console.log(`Copied to ${distGzPath}`);
  }
}

main().catch((err) => {
  console.error("Failed to prebake MSL icons:", err);
  process.exit(1);
});
