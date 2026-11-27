// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildIdeExtension, type ExtensionOptions } from "@modelscript/ide-packager";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function getFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const targetFlag = getFlag("target") as ExtensionOptions["platformTarget"] | undefined;
const outDirFlag = getFlag("outdir");
const nativeAddonFlag = getFlag("native-addon");

const outDir = outDirFlag
  ? path.resolve(process.cwd(), outDirFlag)
  : targetFlag
    ? path.resolve(__dirname, "..", "dist", `extension-${targetFlag}`)
    : path.resolve(__dirname, "..", "dist", "extension");

console.log(`Building IDE extension (target=${targetFlag ?? "web"}) into ${outDir}...`);
await buildIdeExtension(outDir, {
  platformTarget: targetFlag ?? "web",
  nativeAddonPath: nativeAddonFlag ? path.resolve(process.cwd(), nativeAddonFlag) : undefined,
});
console.log("IDE extension built successfully!");
