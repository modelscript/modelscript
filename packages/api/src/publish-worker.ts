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

import type { ClassMetadata } from "./database.js";
import { LibraryDatabase } from "./database.js";
import { LibraryStorage } from "./storage.js";
import { processLibrary } from "./util/svg-renderer.js";

process.on("message", async (data: { name: string; version: string; libraryPath: string }) => {
  const { name, version, libraryPath } = data;

  const database = new LibraryDatabase();
  const storage = new LibraryStorage();

  try {
    console.log(`[publish] Processing ${name}@${version}...`);

    database.clearLibraryMetadata(name, version);

    let metadataBatch: ClassMetadata[] = [];
    let classCount = 0;

    await processLibrary(libraryPath, async (_className, metadata, svgs) => {
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
