// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Child process script for processing a published library.
 *
 * Runs SVG rendering + metadata extraction in a separate process
 * so the main API event loop stays completely unblocked.
 *
 * Receives job data via IPC message: { name, version, libraryPath }
 * Sends IPC messages: { type: 'progress', classesProcessed } and { type: 'complete', classesProcessed }
 */

import fs from "node:fs";
import path from "node:path";
import type { ClassMetadata } from "./database.js";
import { LibraryDatabase } from "./database.js";
import { LibraryStorage } from "./storage.js";
import { exportSalsaIndex } from "./util/salsa-index-exporter.js";
import { processLibrary } from "./util/svg-renderer.js";

function getArtifactType(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".step" || ext === ".stp") return "cad";
  if (ext === ".sysml") return "sysml";
  if (ext === ".fmu") return "fmu";
  if (ext === ".csv") return "dataset";
  return null;
}

process.on("message", async (data: { name: string; version: string; libraryPath: string }) => {
  const { name, version, libraryPath } = data;

  const database = new LibraryDatabase();
  const storage = new LibraryStorage();

  try {
    console.log(`[publish] Processing ${name}@${version}...`);

    database.clearLibraryMetadata(name, version);

    let metadataBatch: ClassMetadata[] = [];
    let classCount = 0;

    const context = await processLibrary(libraryPath, async (_className, metadata, svgs) => {
      storage.storeSvg(name, version, metadata.className, svgs.icon, svgs.diagram);

      metadataBatch.push(metadata);
      if (metadataBatch.length >= 50) {
        database.storeClassBatch(name, version, metadataBatch);
        classCount += metadataBatch.length;
        metadataBatch = [];

        process.send?.({ type: "progress", classesProcessed: classCount });

        if (classCount % 100 === 0) {
          console.log(`[publish] ${name}@${version}: processed ${classCount} classes...`);
        }
      }
    });

    if (metadataBatch.length > 0) {
      database.storeClassBatch(name, version, metadataBatch);
      classCount += metadataBatch.length;
    }

    // Export the Salsa index to a SQLite database artifact
    console.log(`[publish] ${name}@${version}: exporting salsa-index.db...`);
    const indexPath = storage.getIndexPath(name, version);
    await exportSalsaIndex(context.queryEngine, indexPath);

    // --- Automatic Artifact Scanning ---
    console.log(`[publish] ${name}@${version}: scanning artifacts...`);
    const { id: packageId } = database.getOrCreatePackage(name);
    const versionRow = database.getPackageVersion(packageId, version);
    let versionId: number;
    if (versionRow) {
      versionId = versionRow.id;
    } else {
      const manifestPath = path.join(libraryPath, "package.json");
      const manifestStr = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf-8") : "{}";
      versionId = database.storePackageVersion(packageId, version, "", "", null, 0, manifestStr, null, null);
    }

    const ignorePath = path.join(libraryPath, ".modelscriptignore");
    const ignorePatterns = ["node_modules", "dist", ".git"];
    if (fs.existsSync(ignorePath)) {
      const lines = fs.readFileSync(ignorePath, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          ignorePatterns.push(trimmed.replace(/\/$/, ""));
        }
      }
    }

    const scanArtifacts = (currentDir: string, relPrefix = "") => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

        const shouldIgnore = ignorePatterns.some(
          (p) => relPath === p || relPath.startsWith(p + "/") || entry.name === p || entry.name.startsWith(p + "/"),
        );
        if (shouldIgnore) continue;

        if (entry.isDirectory()) {
          scanArtifacts(fullPath, relPath);
        } else if (entry.isFile()) {
          const type = getArtifactType(entry.name);
          if (type) {
            database.storeArtifact(versionId, type, relPath, JSON.stringify({}));
          }
        }
      }
    };
    scanArtifacts(libraryPath);
    // -----------------------------------

    console.log(`[publish] ${name}@${version}: completed — ${classCount} classes processed.`);
    process.send?.({ type: "complete", classesProcessed: classCount });
  } catch (err) {
    console.error(`[publish] Fatal error:`, err);
    process.exit(1);
  } finally {
    database.close();
    process.exit(0);
  }
});
