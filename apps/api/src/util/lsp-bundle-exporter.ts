import type { QueryEngine } from "@modelscript/compiler";
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

    // 1. Serialize the unified SymbolIndex to index.json
    const index = engine.index; // This is the unified SymbolIndex

    // Normalize libraryPath for mapping
    const libPrefix = libraryPath.replace(/\\/g, "/").replace(/\/?$/, "/");

    const symbolsArr = Array.from(index.symbols.entries()).map(([id, entry]) => {
      const mappedEntry = { ...entry };
      if (mappedEntry.resourceId) {
        let resPath = mappedEntry.resourceId;
        // In Context.ts, resourceId might be prefixed with a scheme like "modelica:/" or "sysml2:/",
        // but addLibrary registers the absolute filesystem path as the URI!
        resPath = resPath.replace(/\\/g, "/");
        if (resPath.startsWith(libPrefix)) {
          mappedEntry.resourceId = "sources/" + resPath.substring(libPrefix.length);
        } else {
          // If it has a scheme prefix (like file://), try stripping it
          const cleanPath = resPath.replace(/^[a-z0-9+-]+:\/\//i, "");
          if (cleanPath.startsWith(libPrefix)) {
            mappedEntry.resourceId = "sources/" + cleanPath.substring(libPrefix.length);
          } else {
            mappedEntry.resourceId = "sources/" + path.basename(resPath);
          }
        }
      }
      return [id, mappedEntry];
    });

    const byNameArr = Array.from(index.byName.entries());
    const childrenOfArr = Array.from(index.childrenOf.entries());

    const indexJson = JSON.stringify({
      symbols: symbolsArr,
      byName: byNameArr,
      childrenOf: childrenOfArr,
    });
    zipfile.addBuffer(Buffer.from(indexJson, "utf-8"), "index.json");

    // 2. Serialize icons
    const iconsJson = JSON.stringify(svgs);
    zipfile.addBuffer(Buffer.from(iconsJson, "utf-8"), "icons.json");

    // 3. Add source files
    function walkDir(dir: string, relPrefix = "sources/") {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relPrefix + entry.name;
        if (entry.isDirectory()) {
          walkDir(fullPath, relPath + "/");
        } else if (entry.isFile() && entry.name.endsWith(".mo")) {
          zipfile.addFile(fullPath, relPath);
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
