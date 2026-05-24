/* eslint-disable */
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { requireAuth } from "../middleware/auth-middleware.js";

export function reposRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/repos
   */
  router.get("/", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    try {
      const repos = database.getLinkedRepos(userId);
      res.json({ repos });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch linked repositories" });
    }
  });

  /**
   * POST /api/v1/repos
   */
  router.post("/", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { provider, external_repo_id, repo_full_name, default_branch } = req.body;

    if (!provider || !external_repo_id || !repo_full_name) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    try {
      database.linkRepo(userId, provider, external_repo_id, repo_full_name, default_branch || "main");
      res.status(201).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to link repository" });
    }
  });

  /**
   * DELETE /api/v1/repos/:id
   */
  router.delete("/:id", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const repoId = Number(req.params.id);

    try {
      database.unlinkRepo(userId, repoId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to unlink repository" });
    }
  });

  return router;
}
