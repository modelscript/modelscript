// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { RepoBotReviewer } from "../services/ai/repo-bot-reviewer.js";

export function reposRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/repos/popular
   */
  router.get("/popular", (req: Request, res: Response) => {
    const limit = Number(req.query["limit"]) || 50;
    try {
      const repos = database.getPopularRepos(limit);
      res.json({ repos });
    } catch {
      res.status(500).json({ error: "Failed to fetch popular repositories" });
    }
  });

  /**
   * GET /api/v1/repos
   */
  router.get("/", optionalAuth, (req: Request, res: Response) => {
    const queryUsername = typeof req.query["username"] === "string" ? req.query["username"].trim() : "";
    if (queryUsername) {
      const targetUser = database.getUserByUsername(queryUsername);
      if (!targetUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      try {
        const repos = database.getUserRepos(targetUser.id);
        res.json({ repos });
      } catch {
        res.status(500).json({ error: "Failed to fetch linked repositories" });
      }
      return;
    }

    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const userId = req.user.id;
    try {
      const repos = database.getLinkedRepos(userId);
      res.json({ repos });
    } catch {
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
    } catch {
      res.status(500).json({ error: "Failed to link repository" });
    }
  });

  /**
   * PUT / PATCH /api/v1/repos/:id
   * Update linked repository settings (name, visibility, default_branch, social_preview_url).
   */
  const handleUpdateRepo = (req: Request, res: Response) => {
    const userId = req.user!.id;
    const rawId = String(req.params["id"] ?? "");
    const { name, repo_full_name, visibility, default_branch, social_preview_url, description } = (req.body ?? {}) as {
      name?: string | undefined;
      repo_full_name?: string | undefined;
      visibility?: string | undefined;
      default_branch?: string | undefined;
      social_preview_url?: string | undefined;
      description?: string | undefined;
    };

    try {
      const updated = database.updateLinkedRepo(userId, rawId, {
        name,
        repo_full_name,
        visibility,
        default_branch,
        social_preview_url,
        description,
      });
      res.status(200).json({
        success: true,
        repo: updated ?? {
          id: rawId,
          name: name ?? rawId,
          repo_full_name: repo_full_name ?? (name ? `${req.user!.username || "user"}/${name}` : rawId),
          visibility: visibility || "public",
          default_branch: default_branch || "main",
          social_preview_url: social_preview_url ?? null,
        },
      });
    } catch {
      res.status(500).json({ error: "Failed to update repository settings" });
    }
  };

  router.put("/:id", requireAuth, handleUpdateRepo);
  router.patch("/:id", requireAuth, handleUpdateRepo);

  /**
   * DELETE /api/v1/repos/:id
   */
  router.delete("/:id", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const repoId = String(req.params["id"] ?? "");

    try {
      database.unlinkRepo(userId, repoId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to unlink repository" });
    }
  });

  /**
   * GET /api/v1/repos/:id/webhooks
   * List configured webhooks for a linked repository.
   */
  router.get("/:id/webhooks", requireAuth, (req: Request, res: Response) => {
    const repoId = Number(req.params["id"]);
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
    const repoId = Number(req.params["id"]);
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
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create webhook" });
    }
  });

  /**
   * DELETE /api/v1/repos/:id/webhooks/:webhookId
   * Delete a webhook.
   */
  router.delete("/:id/webhooks/:webhookId", requireAuth, (req: Request, res: Response) => {
    const repoId = Number(req.params["id"]);
    const webhookId = Number(req.params["webhookId"]);
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

  /**
   * POST /api/v1/repos/:id/reviews
   * Triggers an automated engineering model review by a bot.
   */
  router.post("/:id/reviews", requireAuth, async (req: Request, res: Response) => {
    const repoId = Number(req.params["id"]);
    const repo = database.getLinkedRepoById(repoId);
    if (!repo || (repo.user_id !== req.user!.id && req.user!.account_type !== "admin")) {
      res.status(404).json({ error: "Repository not found or access denied" });
      return;
    }

    const { bot_id, pr_number, commit_sha, title, diff_content, files } = req.body;
    let botId = Number(bot_id);
    if (!botId) {
      // Find user's first bot or default system bot
      const userBots = database.getUserBots(req.user!.id);
      if (userBots.length > 0) {
        botId = userBots[0]!.id;
      } else {
        const sysBot = database.getUserByUsername("dynamics_bot");
        if (sysBot) {
          botId = sysBot.id;
        } else {
          res.status(400).json({ error: "No bot specified and no default bot found" });
          return;
        }
      }
    }

    try {
      const reviewer = new RepoBotReviewer(database);
      const result = await reviewer.review({
        repoId,
        botId,
        prNumber: pr_number ? Number(pr_number) : undefined,
        commitSha: commit_sha,
        title,
        diffContent: diff_content,
        files,
      });

      res.status(201).json({ success: true, review: result });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to run bot review" });
    }
  });

  /**
   * GET /api/v1/repos/:id/reviews
   * List bot reviews for a repository.
   */
  router.get("/:id/reviews", requireAuth, (req: Request, res: Response) => {
    const repoId = Number(req.params["id"]);
    const repo = database.getLinkedRepoById(repoId);
    if (!repo || (repo.user_id !== req.user!.id && req.user!.account_type !== "admin")) {
      res.status(404).json({ error: "Repository not found or access denied" });
      return;
    }

    const reviews = database.getRepoBotReviews(repoId);
    res.json({ reviews });
  });

  return router;
}
