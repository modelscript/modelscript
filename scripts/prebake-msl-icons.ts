// SPDX-License-Identifier: AGPL-3.0-or-later

import { gzipSync, strFromU8, unzipSync } from "fflate";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

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
  const parsed = JSON.parse(jsonStr);
  const iconCount = Object.keys(parsed).length;
  console.log(`Found ${iconCount} pre-rendered icons in icons.json.`);

  // Compress using gzip (level 9 for maximum compression)
  const gzipped = gzipSync(iconsData, { level: 9 });
  console.log(
    `Original size: ${(iconsData.byteLength / 1024).toFixed(1)} KB, Compressed: ${(gzipped.byteLength / 1024).toFixed(1)} KB`,
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
