// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import { checkPrivateVisibilityEntitlement } from "../ee-loader.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { RepoBotReviewer } from "../services/ai/repo-bot-reviewer.js";

export function reposRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  function hasRepoScope(req: Request, requiredScope: string): boolean {
    if (!req.tokenScopes) return true;
    return (
      req.tokenScopes.includes("*") || req.tokenScopes.includes("admin") || req.tokenScopes.includes(requiredScope)
    );
  }

  /**
   * GET /api/v1/repos/popular
   */
  router.get("/popular", (req: Request, res: Response) => {
    const limit = Math.min(Math.max(1, Number(req.query["limit"]) || 50), 100);
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
        const allRepos = database.getUserRepos(targetUser.id);
        const canViewPrivate = req.user?.id === targetUser.id || req.user?.account_type === "admin";
        const repos = canViewPrivate
          ? allRepos
          : allRepos.filter((r) => (r as { visibility?: string | undefined }).visibility !== "private");
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
    if (!hasRepoScope(req, "repos:write")) {
      res.status(403).json({ error: "Insufficient token scope: requires 'repos:write'" });
      return;
    }
    const userId = req.user!.id;
    const { provider, external_repo_id, repo_full_name, default_branch, description, avatar_url } = req.body;

    if (!provider || !external_repo_id || !repo_full_name) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    try {
      const repo = database.linkRepo(
        userId,
        provider,
        external_repo_id,
        repo_full_name,
        default_branch || "main",
        description,
        avatar_url,
      );
      res.status(201).json({ success: true, repo });
    } catch {
      res.status(500).json({ error: "Failed to link repository" });
    }
  });

  /**
   * PUT / PATCH /api/v1/repos/:id
   * Update linked repository settings (name, visibility, default_branch, social_preview_url).
   */
  const handleUpdateRepo = (req: Request, res: Response) => {
    if (!hasRepoScope(req, "repos:write")) {
      res.status(403).json({ error: "Insufficient token scope: requires 'repos:write'" });
      return;
    }
    const userId = req.user!.id;
    const rawId = String(req.params["id"] ?? "");
    const { name, repo_full_name, visibility, default_branch, social_preview_url, socialPreviewUrl, description } =
      (req.body ?? {}) as {
        name?: string | undefined;
        repo_full_name?: string | undefined;
        visibility?: string | undefined;
        default_branch?: string | undefined;
        social_preview_url?: string | undefined;
        socialPreviewUrl?: string | undefined;
        description?: string | undefined;
      };

    if (visibility === "private" || visibility === "internal") {
      const entitlement = checkPrivateVisibilityEntitlement();
      if (!entitlement.allowed) {
        res.status(entitlement.statusCode).json({
          edition: entitlement.statusCode === 501 ? "ce" : "ee",
          licenseSpdx: entitlement.statusCode === 501 ? "AGPL-3.0-or-later" : "LicenseRef-ModelScript-Enterprise",
          code: entitlement.code,
          requiredFeature: "saml_oidc_sso",
          error: entitlement.reason,
        });
        return;
      }
    }

    const resolvedPreviewUrl = social_preview_url !== undefined ? social_preview_url : socialPreviewUrl;

    try {
      const updated = database.updateLinkedRepo(userId, rawId, {
        name,
        repo_full_name,
        visibility,
        default_branch,
        social_preview_url: resolvedPreviewUrl,
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
          social_preview_url: resolvedPreviewUrl ?? null,
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
    if (!hasRepoScope(req, "repos:write")) {
      res.status(403).json({ error: "Insufficient token scope: requires 'repos:write'" });
      return;
    }
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
    if (!hasRepoScope(req, "repos:read") && !hasRepoScope(req, "repos:write")) {
      res.status(403).json({ error: "Insufficient token scope: requires 'repos:read'" });
      return;
    }
    const rawId = String(req.params["id"] ?? "");
    const repo = database.getLinkedRepoById(rawId, req.user!.id);
    if (!repo || (repo.user_id !== req.user!.id && req.user!.account_type !== "admin")) {
      res.status(404).json({ error: "Repository not found or access denied" });
      return;
    }

    const webhooks = database.getRepoWebhooks(repo.id).map((wh) => ({
      ...wh,
      secret: wh.secret ? "***" : "",
    }));
    res.json({ webhooks });
  });

  /**
   * POST /api/v1/repos/:id/webhooks
   * Create a new webhook for automated CI/CD tag ingestion.
   */
  router.post("/:id/webhooks", requireAuth, (req: Request, res: Response) => {
    if (!hasRepoScope(req, "repos:write")) {
      res.status(403).json({ error: "Insufficient token scope: requires 'repos:write'" });
      return;
    }
    const rawId = String(req.params["id"] ?? "");
    const repo = database.getLinkedRepoById(rawId, req.user!.id);
    if (!repo || (repo.user_id !== req.user!.id && req.user!.account_type !== "admin")) {
      res.status(404).json({ error: "Repository not found or access denied" });
      return;
    }

    const provider = (req.body?.provider || repo.provider || "github") as "github" | "gitlab" | "local" | "custom";
    const secret = req.body?.secret || crypto.randomUUID();
    const events = Array.isArray(req.body?.events) ? req.body.events : ["push", "release"];
    const autoPublish = req.body?.autoPublish !== false;
    const tagPattern = req.body?.tagPattern;

    try {
      const webhook = database.createRepoWebhook({
        repoId: repo.id,
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
    if (!hasRepoScope(req, "repos:write")) {
      res.status(403).json({ error: "Insufficient token scope: requires 'repos:write'" });
      return;
    }
    const rawId = String(req.params["id"] ?? "");
    const webhookId = Number(req.params["webhookId"]);
    const repo = database.getLinkedRepoById(rawId, req.user!.id);
    if (!repo || (repo.user_id !== req.user!.id && req.user!.account_type !== "admin")) {
      res.status(404).json({ error: "Repository not found or access denied" });
      return;
    }

    const deleted = database.deleteRepoWebhook(webhookId, repo.id);
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
    if (!hasRepoScope(req, "repos:review") && !hasRepoScope(req, "repos:write")) {
      res.status(403).json({ error: "Insufficient token scope: requires 'repos:review'" });
      return;
    }
    const rawId = String(req.params["id"] ?? "");
    const repo = database.getLinkedRepoById(rawId, req.user!.id);
    if (!repo || (repo.user_id !== req.user!.id && req.user!.account_type !== "admin")) {
      res.status(404).json({ error: "Repository not found or access denied" });
      return;
    }

    const { bot_id, pr_number, commit_sha, title, diff_content, files } = req.body;
    const userBots = database.getUserBots(req.user!.id);
    const sysBot = database.getUserByUsername("dynamics_bot");
    let botId = Number(bot_id);
    if (botId) {
      const ownsBot = userBots.some((b) => b.id === botId);
      const isSystemBot = sysBot?.id === botId;
      if (!ownsBot && !isSystemBot && req.user!.account_type !== "admin") {
        res.status(403).json({ error: "Forbidden: Specified bot does not belong to you" });
        return;
      }
    } else {
      // Find user's first bot or default system bot
      if (userBots.length > 0) {
        botId = userBots[0]!.id;
      } else if (sysBot) {
        botId = sysBot.id;
      } else {
        res.status(400).json({ error: "No bot specified and no default bot found" });
        return;
      }
    }

    try {
      const reviewer = new RepoBotReviewer(database);
      const result = await reviewer.review({
        repoId: repo.id,
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
    const rawId = String(req.params["id"] ?? "");
    const repo = database.getLinkedRepoById(rawId, req.user!.id);
    if (!repo || (repo.user_id !== req.user!.id && req.user!.account_type !== "admin")) {
      res.status(404).json({ error: "Repository not found or access denied" });
      return;
    }

    const reviews = database.getRepoBotReviews(repo.id);
    res.json({ reviews });
  });

  return router;
}
