// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Backfills relocatable binary `index.msidx` files for any package versions in
 * `data/libraries/` that were published before `publish-worker.ts` began emitting
 * `index.msidx` alongside `salsa-index.db` and `lsp-bundle.zip`.
 *
 * Uses the existing `index.json` inside `lsp-bundle.zip` (no re-parsing needed)
 * and encodes it with `@modelscript/runtime`'s `encodePackageIndex`.
 */

import {
  encodePackageIndex,
  extractPackageSummaries,
  type SymbolEntry,
  type SymbolId,
  type SymbolIndex,
} from "@modelscript/runtime";
import { strFromU8, unzipSync } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const librariesDir = path.join(repoRoot, "data", "libraries");

interface SerializedIndexJson {
  symbols: [number, SymbolEntry][];
  byName: [string, number[]][];
  childrenOf: [number | null, number[]][];
}

function hydrateSymbolIndexFromJson(data: SerializedIndexJson): SymbolIndex {
  const symbols = new Map<SymbolId, SymbolEntry>();
  const byName = new Map<string, SymbolId[]>();
  const childrenOf = new Map<SymbolId | null, SymbolId[]>();
  const symbolsByResource = new Map<string, SymbolId[]>();

  for (const [id, entry] of data.symbols) {
    // Strip leading "sources/" prefix from lsp-bundle index.json resourceIds so paths
    // match the extracted package root (e.g. "Blocks/Examples.mo" instead of "sources/Blocks/Examples.mo").
    const normalizedResourceId =
      typeof entry.resourceId === "string" && entry.resourceId.startsWith("sources/")
        ? entry.resourceId.slice("sources/".length)
        : entry.resourceId;
    const normalizedEntry: SymbolEntry = { ...entry, resourceId: normalizedResourceId };
    symbols.set(id, normalizedEntry);
    if (normalizedResourceId) {
      let list = symbolsByResource.get(normalizedResourceId);
      if (!list) {
        list = [];
        symbolsByResource.set(normalizedResourceId, list);
      }
      list.push(id);
    }
  }
  for (const [name, ids] of data.byName) {
    byName.set(name, ids);
  }
  for (const [parentId, ids] of data.childrenOf) {
    childrenOf.set(parentId, ids);
  }
  return { symbols, byName, childrenOf, symbolsByResource };
}

function main() {
  if (!fs.existsSync(librariesDir)) {
    console.error(`Libraries directory not found: ${librariesDir}`);
    process.exit(1);
  }

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const pkgEntry of fs.readdirSync(librariesDir, { withFileTypes: true })) {
    if (!pkgEntry.isDirectory() || pkgEntry.name.startsWith(".")) continue;
    const pkgDir = path.join(librariesDir, pkgEntry.name);
    for (const verEntry of fs.readdirSync(pkgDir, { withFileTypes: true })) {
      if (!verEntry.isDirectory()) continue;
      const verDir = path.join(pkgDir, verEntry.name);
      const msidxPath = path.join(verDir, "index.msidx");
      const bundlePath = path.join(verDir, "lsp-bundle.zip");

      if (fs.existsSync(msidxPath)) {
        skipped++;
        continue;
      }
      if (!fs.existsSync(bundlePath)) {
        continue;
      }

      const label = `${pkgEntry.name}@${verEntry.name}`;
      const t0 = performance.now();
      try {
        const zipBytes = fs.readFileSync(bundlePath);
        const files = unzipSync(new Uint8Array(zipBytes));
        const indexJsonBytes = files["index.json"];
        if (!indexJsonBytes) {
          console.warn(`[backfill-msidx] ${label}: lsp-bundle.zip has no index.json, skipping`);
          continue;
        }
        const rawJson = JSON.parse(strFromU8(indexJsonBytes)) as SerializedIndexJson;
        const symbolIndex = hydrateSymbolIndexFromJson(rawJson);
        const summaries = extractPackageSummaries(symbolIndex);
        const msidxBytes = encodePackageIndex(symbolIndex, { summaries });
        const tmpPath = `${msidxPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmpPath, msidxBytes);
        fs.renameSync(tmpPath, msidxPath);
        const ms = (performance.now() - t0).toFixed(0);
        const kb = (msidxBytes.byteLength / 1024).toFixed(0);
        console.log(
          `[backfill-msidx] ${label}: wrote index.msidx (${kb} KB, ${symbolIndex.symbols.size} symbols) in ${ms}ms`,
        );
        generated++;
      } catch (err) {
        console.error(`[backfill-msidx] ${label}: FAILED:`, err);
        failed++;
      }
    }
  }

  console.log(`[backfill-msidx] Done: generated=${generated}, skipped=${skipped}, failed=${failed}`);
}

main();
