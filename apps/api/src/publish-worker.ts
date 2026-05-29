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
import { exportLspBundle } from "./util/lsp-bundle-exporter.js";
import { exportSalsaIndex } from "./util/salsa-index-exporter.js";
import { processLibrary } from "./util/svg-renderer.js";

function getArtifactType(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".step" || ext === ".stp") return "cad";
  if (ext === ".sysml") return "sysml";
  if (ext === ".fmu") return "fmu";
  if (ext === ".csv") return "dataset";
  if (ext === ".tei" || ext === ".xml") return "tei-document";
  return null;
}

process.on("message", async (data: { name: string; version: string; libraryPath: string }) => {
  const { name, version, libraryPath } = data;

  const database = new LibraryDatabase();
  const storage = new LibraryStorage();

  try {
    console.log(`[publish] Processing ${name}@${version}...`);

    const existingClasses = database.getClasses(name, version);
    const processedClassNames = new Set(existingClasses.map((c) => c.class_name));

    console.log(`[publish] Checkpoint resume: ${processedClassNames.size} classes already processed.`);

    let metadataBatch: ClassMetadata[] = [];
    let classCount = processedClassNames.size;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rootMetadata: any = null;
    const iconSvgs: Record<string, string> = {};

    // Prepopulate iconSvgs from existing storage for the final lsp-bundle export
    const classesWithSvgs = storage.listClasses(name, version);
    for (const className of classesWithSvgs) {
      if (processedClassNames.has(className)) {
        const svg = storage.readSvg(name, version, className, "icon");
        if (svg) iconSvgs[className] = svg;
      }
    }

    let queryEngineRef: import("@modelscript/compiler").QueryEngine | null = null;

    await processLibrary(
      libraryPath,
      processedClassNames,
      async (_className, metadata, svgs) => {
        if (metadata.className === name) {
          rootMetadata = metadata;
        }
        storage.storeSvg(name, version, metadata.className, svgs.icon, svgs.diagram);
        if (svgs.icon) {
          iconSvgs[metadata.className] = svgs.icon;
        }

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
      },
      async (readyContext) => {
        // onReady: fires right after library indexing, before SVG pass.
        // Export salsa-index and an initial lsp-bundle immediately so the
        // LSP can hydrate the workspace even while SVGs are still rendering.
        queryEngineRef = readyContext.queryEngine;
        const indexPath = storage.getIndexPath(name, version);

        console.log(`[publish] ${name}@${version}: exporting salsa-index.db (early)...`);
        await exportSalsaIndex(queryEngineRef, indexPath);

        console.log(`[publish] ${name}@${version}: exporting lsp-bundle.zip (early, no icons)...`);
        const bundlePath = path.join(path.dirname(indexPath), "lsp-bundle.zip");
        await exportLspBundle(queryEngineRef, libraryPath, bundlePath, {});
      },
    );

    // Flush remaining metadata batch
    if (metadataBatch.length > 0) {
      database.storeClassBatch(name, version, metadataBatch);
      classCount += metadataBatch.length;
    }

    // Re-export lsp-bundle with collected icons (overwrites the early no-icons version)
    if (queryEngineRef && Object.keys(iconSvgs).length > 0) {
      console.log(
        `[publish] ${name}@${version}: re-exporting lsp-bundle.zip with ${Object.keys(iconSvgs).length} icons...`,
      );
      const indexPath = storage.getIndexPath(name, version);
      const bundlePath = path.join(path.dirname(indexPath), "lsp-bundle.zip");
      await exportLspBundle(queryEngineRef, libraryPath, bundlePath, iconSvgs);
    }

    // --- Automatic Artifact Scanning ---
    console.log(`[publish] ${name}@${version}: scanning artifacts...`);
    const { id: packageId } = database.getOrCreatePackage(name);
    const versionRow = database.getPackageVersion(packageId, version);
    let versionId: number;
    let manifestStr = "{}";
    if (versionRow) {
      versionId = versionRow.id;
      manifestStr = versionRow.manifest;
    } else {
      const manifestPath = path.join(libraryPath, "package.json");
      manifestStr = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf-8") : "{}";
      versionId = database.storePackageVersion(packageId, version, "", "", null, 0, manifestStr, null, null);
    }

    // --- Update package metadata and dependencies from annotations ---
    const rootDependencies: Record<string, string> = {};
    const packageMoPath = path.join(libraryPath, "package.mo");
    if (fs.existsSync(packageMoPath)) {
      const content = fs.readFileSync(packageMoPath, "utf-8");
      const depRegex = /([a-zA-Z0-9_]+)\s*\(\s*version\s*=\s*"([^"]+)"/g;
      let match;
      while ((match = depRegex.exec(content)) !== null) {
        if (match[1] && match[2] && match[1] !== "conversion" && match[1] !== "from") {
          rootDependencies[match[1]] = match[2];
        }
      }
    }

    if (rootMetadata) {
      database.updatePackageMeta(packageId, {
        description: rootMetadata.description,
        readme: rootMetadata.documentation,
      });

      try {
        const manifestObj = JSON.parse(manifestStr);
        if (Object.keys(rootDependencies).length > 0) {
          manifestObj.dependencies = { ...manifestObj.dependencies, ...rootDependencies };
        }
        database.updatePackageVersionManifest(versionId, JSON.stringify(manifestObj));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_e) {
        console.warn(`[publish] Failed to update manifest for ${name}@${version}`);
      }
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
