// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";

export function solutionsRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/solutions
   * Returns list of featured/recent public solutions
   */
  router.get("/", optionalAuth, (_req: Request, res: Response) => {
    try {
      const solutions = database.getAllPublicSolutions();
      res.json({ solutions });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * GET /api/v1/solutions/:author/:slug
   * Returns full solution details, author profile, and latest release metadata
   */
  router.get("/:author/:slug", optionalAuth, (req: Request, res: Response) => {
    const author = req.params["author"] as string;
    const slug = req.params["slug"] as string;
    try {
      const result = database.getSolution(author, slug);
      if (!result) {
        res.status(404).json({ error: `Solution '${author}/${slug}' not found` });
        return;
      }
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * GET /api/v1/solutions/:author/:slug/releases
   * Returns list of all releases for a solution
   */
  router.get("/:author/:slug/releases", optionalAuth, (req: Request, res: Response) => {
    const author = req.params["author"] as string;
    const slug = req.params["slug"] as string;
    try {
      const releases = database.getSolutionReleases(author, slug);
      res.json({ releases });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * POST /api/v1/solutions/publish
   * Publishes or updates a solution and registers a new release
   */
  router.post("/publish", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const {
      slug,
      name,
      description,
      category,
      icon,
      supported_formats,
      repo_id,
      version,
      changelog,
      bundle_url,
      tauri_windows_url,
      tauri_linux_url,
      tauri_darwin_url,
      manifest,
    } = req.body;

    if (!slug || !name || !version || !bundle_url) {
      res.status(400).json({ error: "Missing required fields: slug, name, version, bundle_url" });
      return;
    }

    try {
      const solutionId = database.createOrUpdateSolution(userId, {
        slug,
        name,
        description,
        category,
        icon,
        supported_formats: Array.isArray(supported_formats) ? supported_formats : [],
        repo_id: repo_id ? Number(repo_id) : undefined,
      });

      const releaseId = database.createSolutionRelease(solutionId, {
        version,
        changelog,
        bundle_url,
        tauri_windows_url,
        tauri_linux_url,
        tauri_darwin_url,
        manifest_json: manifest ? JSON.stringify(manifest) : undefined,
      });

      res.status(201).json({
        success: true,
        solutionId,
        releaseId,
        url: `/solutions/${req.user!.username}/${slug}`,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
