// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import multer from "multer";
import semver from "semver";

import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import { ConflictError, type LibraryStorage } from "../storage.js";
import { parsePackageMo } from "../util/package-mo.js";
import { processLibrary } from "../util/svg-renderer.js";
import { extractPackageMoFromZip } from "../util/zip.js";

const upload = multer({ storage: multer.memoryStorage() });

export function publishRouter(storage: LibraryStorage, jobQueue: JobQueue, database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * POST /api/v1/libraries/:name/:version
   *
   * Upload a versioned Modelica library as a zip file.
   * The library name and version are validated against the zip's root package.mo.
   */
  router.post("/:name/:version", upload.single("file"), async (req: Request, res: Response): Promise<void> => {
    const name = req.params["name"];
    const version = req.params["version"];

    // 1. Validate parameters
    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Library name and version must be strings" });
      return;
    }

    if (!semver.valid(version)) {
      res.status(400).json({
        error: `Invalid semantic version: "${version}"`,
      });
      return;
    }

    // 2. Validate file upload
    if (!req.file) {
      res.status(400).json({ error: "A zip file must be uploaded as the 'file' field" });
      return;
    }

    try {
      // 3. Extract package.mo from the zip
      const packageMoContent = await extractPackageMoFromZip(req.file.buffer);

      // 4. Parse package.mo
      const parsed = parsePackageMo(packageMoContent);

      if (!parsed.name) {
        res.status(400).json({
          error: "Could not determine the package name from package.mo",
        });
        return;
      }

      // 5. Validate package name matches
      if (parsed.name !== name) {
        res.status(400).json({
          error: `Package name mismatch: URL specifies "${name}" but package.mo declares "${parsed.name}"`,
        });
        return;
      }

      // 6. Validate version matches
      if (!parsed.version) {
        res.status(400).json({
          error: "No version annotation found in package.mo",
        });
        return;
      }

      if (parsed.version !== version) {
        res.status(400).json({
          error: `Version mismatch: URL specifies "${version}" but package.mo declares "${parsed.version}"`,
        });
        return;
      }

      // 7. Store the library
      const filePath = await storage.store(name, version, req.file.buffer);

      // 8. Enqueue background processing (extraction + SVG generation + metadata extraction)
      const jobKey = `${name}@${version}`;
      const zipBuffer = req.file.buffer;
      jobQueue.enqueue(jobKey, async () => {
        // Pre-extract the zip to disk for simulations
        await storage.extractLibrary(name, version);

        // Process SVGs and metadata
        const result = await processLibrary(zipBuffer);
        storage.storeSvgs(name, version, result.svgs);
        database.storeLibraryMetadata(name, version, result.metadata);
      });

      res.status(201).json({
        message: `Library ${name}@${version} published successfully`,
        path: filePath,
        processing: "pending",
      });
    } catch (err) {
      if (err instanceof ConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : "Internal server error";
      res.status(400).json({ error: message });
    }
  });

  return router;
}
