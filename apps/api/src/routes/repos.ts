// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable */
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import { requireAuth } from "../middleware/auth-middleware.js";

export function reposRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/repos/popular
   */
  router.get("/popular", (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 50;
    try {
      const repos = database.getPopularRepos(limit);
      res.json({ repos });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch popular repositories" });
    }
  });

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

  /**
   * GET /api/v1/repos/:id/webhooks
   * List configured webhooks for a linked repository.
   */
  router.get("/:id/webhooks", requireAuth, (req: Request, res: Response) => {
    const repoId = Number(req.params.id);
    const repo = database.getLinkedRepoById(repoId);
    if (!repo || (repo.user_id !== req.user!.id && req.user!.account_type !== "admin")) {
      res.status(404).json({ error: "Repository not found or access denied" });
      return;
    }

    const webhooks = database.getRepoWebhooks(repoId);
    res.json({ webhooks });
  });

  /**
   * POST /api/v1/repos/:id/webhooks
   * Create a new webhook for automated CI/CD tag ingestion.
   */
  router.post("/:id/webhooks", requireAuth, (req: Request, res: Response) => {
    const repoId = Number(req.params.id);
    const repo = database.getLinkedRepoById(repoId);
    if (!repo || (repo.user_id !== req.user!.id && req.user!.account_type !== "admin")) {
      res.status(404).json({ error: "Repository not found or access denied" });
      return;
    }

    const provider = (req.body?.provider || "github") as "github" | "gitlab" | "local" | "custom";
    const secret = req.body?.secret || crypto.randomUUID();
    const events = Array.isArray(req.body?.events) ? req.body.events : ["push", "release"];
    const autoPublish = req.body?.autoPublish !== false;
    const tagPattern = req.body?.tagPattern;

    try {
      const webhook = database.createRepoWebhook({
        repoId,
        provider,
        secret,
        events,
        autoPublish,
        tagPattern,
      });
      res.status(201).json({ webhook });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to create webhook" });
    }
  });

  /**
   * DELETE /api/v1/repos/:id/webhooks/:webhookId
   * Delete a webhook.
   */
  router.delete("/:id/webhooks/:webhookId", requireAuth, (req: Request, res: Response) => {
    const repoId = Number(req.params.id);
    const webhookId = Number(req.params.webhookId);
    const repo = database.getLinkedRepoById(repoId);
    if (!repo || (repo.user_id !== req.user!.id && req.user!.account_type !== "admin")) {
      res.status(404).json({ error: "Repository not found or access denied" });
      return;
    }

    const deleted = database.deleteRepoWebhook(webhookId, repoId);
    if (!deleted) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }

    res.json({ success: true, message: "Webhook deleted successfully" });
  });

  return router;
}
