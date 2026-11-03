// SPDX-License-Identifier: AGPL-3.0-or-later

import { EXTENSION_TO_LANGUAGE_ID } from "@modelscript/exchange";
import type { QueryEngine } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { ZipFile } from "yazl";

export async function exportLspBundle(
  engine: QueryEngine,
  libraryPath: string,
  bundlePath: string,
  svgs: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const zipfile = new ZipFile();
    zipfile.outputStream.on("error", reject);

    // 1. Serialize the unified SymbolIndex to index.json (excluding hydrated external dependencies)
    const index = engine.index; // This is the unified SymbolIndex

    // Normalize libraryPath for mapping
    const libPrefix = libraryPath.replace(/\\/g, "/").replace(/\/?$/, "/");
    const excludedIds = new Set<number>();
    const symbolsArr: [number, unknown][] = [];

    for (const [id, entry] of index.symbols.entries()) {
      const mappedEntry = { ...entry };
      if (mappedEntry.resourceId) {
        const resPath = mappedEntry.resourceId.replace(/\\/g, "/");
        if (
          resPath.startsWith("dep-bundle:/") ||
          resPath.endsWith("modelscript-cas.mo") ||
          resPath.endsWith("modelscript-studies.mo") ||
          resPath.endsWith("modelscript-geometry.mo")
        ) {
          excludedIds.add(id);
          continue;
        }
        if (resPath.startsWith(libPrefix)) {
          mappedEntry.resourceId = "sources/" + resPath.substring(libPrefix.length);
        } else {
          const cleanPath = resPath.replace(/^[a-z0-9+-]+:\/\//i, "");
          if (cleanPath.startsWith(libPrefix)) {
            mappedEntry.resourceId = "sources/" + cleanPath.substring(libPrefix.length);
          } else if (cleanPath.startsWith("/") || /^[a-zA-Z]:\//.test(cleanPath)) {
            // Absolute path belonging to an external hydrated dependency library
            excludedIds.add(id);
            continue;
          } else {
            mappedEntry.resourceId = "sources/" + path.basename(resPath);
          }
        }
      }
      symbolsArr.push([id, mappedEntry]);
    }

    const byNameArr: [string, number[]][] = [];
    for (const [name, ids] of index.byName.entries()) {
      const filtered = ids.filter((id) => !excludedIds.has(id));
      if (filtered.length > 0) {
        byNameArr.push([name, filtered]);
      }
    }

    const childrenOfArr: [number | null, number[]][] = [];
    for (const [parentId, childIds] of index.childrenOf.entries()) {
      if (parentId !== null && excludedIds.has(parentId)) continue;
      const filtered = childIds.filter((id) => !excludedIds.has(id));
      if (filtered.length > 0) {
        childrenOfArr.push([parentId, filtered]);
      }
    }

    const indexJson = JSON.stringify({
      symbols: symbolsArr,
      byName: byNameArr,
      childrenOf: childrenOfArr,
    });
    zipfile.addBuffer(Buffer.from(indexJson, "utf-8"), "index.json");

    // 2. Serialize icons
    const iconsJson = JSON.stringify(svgs);
    zipfile.addBuffer(Buffer.from(iconsJson, "utf-8"), "icons.json");

    // 3. Add source files across all 44 languages
    function walkDir(dir: string, relPrefix = "sources/") {
      if (!fs.existsSync(dir)) {
        return;
      }
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relPrefix + entry.name;
        if (entry.isDirectory()) {
          walkDir(fullPath, relPath + "/");
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const isIncluded =
            Boolean(EXTENSION_TO_LANGUAGE_ID[ext]) ||
            ext === ".mo" ||
            ext === ".sysml" ||
            ext === ".kerml" ||
            ext === ".msim" ||
            ext === ".csv" ||
            ext === ".mat" ||
            ext === ".txt" ||
            entry.name === "package.order" ||
            entry.name === ".meta.json" ||
            entry.name === ".Index.json";
          if (isIncluded) {
            zipfile.addFile(fullPath, relPath);
          }
        }
      }
    }

    walkDir(libraryPath);

    // Write zip to disk
    const writeStream = fs.createWriteStream(bundlePath);
    zipfile.outputStream.pipe(writeStream);

    writeStream.on("close", resolve);
    zipfile.end();
  });
}
