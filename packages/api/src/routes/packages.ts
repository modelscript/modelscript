// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import semver from "semver";

import type { LibraryStorage } from "../storage.js";
import { parsePackageMo } from "../util/package-mo.js";
import { extractPackageMoFromZip } from "../util/zip.js";

export function packagesRouter(storage: LibraryStorage): Router {
  const router = createRouter();

  /**
   * GET /api/v1/libraries
   *
   * List all published packages. Supports an optional `?q=` query parameter
   * for case-insensitive substring filtering on the package name.
   */
  router.get("/", (req: Request, res: Response): void => {
    const q = req.query["q"];
    const query = typeof q === "string" ? q : undefined;
    const packages = storage.list(query);
    res.json({ packages });
  });

  /**
   * GET /api/v1/libraries/:name
   *
   * List all versions for a given package, sorted descending by semver.
   */
  router.get("/:name", (req: Request, res: Response): void => {
    const name = req.params["name"];
    if (typeof name !== "string") {
      res.status(400).json({ error: "Package name is required" });
      return;
    }

    const versions = storage.versions(name);
    if (versions.length === 0) {
      res.status(404).json({ error: `Package "${name}" not found` });
      return;
    }

    res.json({ name, versions });
  });

  /**
   * GET /api/v1/libraries/:name/:version
   *
   * Get details for a specific package version, including metadata parsed
   * from the zip's package.mo file.
   */
  router.get("/:name/:version", async (req: Request, res: Response): Promise<void> => {
    const name = req.params["name"];
    const version = req.params["version"];

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    if (!semver.valid(version)) {
      res.status(400).json({ error: `Invalid semantic version: "${version}"` });
      return;
    }

    const file = storage.read(name, version);
    if (!file) {
      res.status(404).json({ error: `Package "${name}@${version}" not found` });
      return;
    }

    try {
      const packageMoContent = await extractPackageMoFromZip(file.buffer);
      const parsed = parsePackageMo(packageMoContent);

      res.json({
        name,
        version,
        description: parsed.description,
        modelicaVersion: parsed.version,
        size: file.size,
      });
    } catch {
      // If we cannot parse the zip, still return basic info
      res.json({
        name,
        version,
        description: null,
        modelicaVersion: null,
        size: file.size,
      });
    }
  });

  /**
   * GET /api/v1/libraries/:name/:version/download
   *
   * Download the zip file for a specific package version.
   */
  router.get("/:name/:version/download", (req: Request, res: Response): void => {
    const name = req.params["name"];
    const version = req.params["version"];

    if (typeof name !== "string" || typeof version !== "string") {
      res.status(400).json({ error: "Package name and version are required" });
      return;
    }

    if (!semver.valid(version)) {
      res.status(400).json({ error: `Invalid semantic version: "${version}"` });
      return;
    }

    const file = storage.read(name, version);
    if (!file) {
      res.status(404).json({ error: `Package "${name}@${version}" not found` });
      return;
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}-${version}.zip"`);
    res.setHeader("Content-Length", file.size);
    res.send(file.buffer);
  });

  return router;
}
