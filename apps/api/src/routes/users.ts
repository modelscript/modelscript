// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable */
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { defaultArchiveExportLimiter } from "../middleware/archive-limiter.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { ArchiveQueue, defaultArchiveQueue } from "../services/archive-queue.js";
import type { FederationWorker } from "../services/federation-worker.js";
import { gatherUserDataBundle, generateUserArchiveZip } from "../services/user-archive.js";

export function usersRouter(
  database: LibraryDatabase,
  worker?: FederationWorker,
  archiveQueue: ArchiveQueue = defaultArchiveQueue,
): Router {
  const router = createRouter();

  /**
   * GET /api/v1/users/suggestions
   */
  router.get("/suggestions", optionalAuth, (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 3;
    const currentUserId = req.user?.id;
    const suggestions = database.getUserSuggestions(currentUserId, limit);
    res.json({ suggestions });
  });

  /**
   * GET /api/v1/users/me/topics
   */
  router.get("/me/topics", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const topics = database.getUserTopics(userId);
    res.json({ topics });
  });

  /**
   * PUT /api/v1/users/me/topics
   */
  router.put("/me/topics", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { concept, is_active } = req.body;
    if (!concept || is_active === undefined) {
      res.status(400).json({ error: "Missing concept or is_active" });
      return;
    }
    database.updateUserTopic(userId, concept, is_active);
    res.json({ success: true });
  });

  /**
   * GET /api/v1/users/:username
   */
  router.get("/:username", optionalAuth, (req: Request, res: Response) => {
    const username = req.params.username as string;
    const profile = database.getFullProfileByUsername(username);

    if (!profile) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Check if the current user follows, blocks, or mutes this profile (if authenticated)
    let isFollowing = false;
    let isBlocked = false;
    let isMuted = false;
    const currentUserId = req.user?.id;
    if (currentUserId && currentUserId !== profile.id) {
      isFollowing = database.isFollowing(currentUserId, profile.id);
      isBlocked = database.isUserBlocked(currentUserId, profile.id);
      isMuted = database.isUserMuted(currentUserId, profile.id);
    }

    const linkedAccounts = database.getPublicOAuthAccounts(profile.id);

    res.json({ profile, isFollowing, isBlocked, isMuted, linkedAccounts });
  });

  /**
   * GET /api/v1/users/:username/following
   */
  router.get("/:username/following", optionalAuth, (req: Request, res: Response) => {
    const targetUser = database.getUserByUsername(req.params.username as string);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const currentUserId = req.user?.id;
    const following = database.getUserFollowing(targetUser.id, currentUserId);
    res.json({ following });
  });

  /**
   * GET /api/v1/users/:username/followers
   */
  router.get("/:username/followers", optionalAuth, (req: Request, res: Response) => {
    const targetUser = database.getUserByUsername(req.params.username as string);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const currentUserId = req.user?.id;
    const followers = database.getUserFollowers(targetUser.id, currentUserId);
    res.json({ followers });
  });

  /**
   * PUT /api/v1/users/me
   */
  router.put("/me", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { display_name, bio, location, website, avatar_url, banner_url } = req.body;

    database.updateProfile(userId, { display_name, bio, location, website, avatar_url, banner_url });
    res.json({ success: true });
  });

  /**
   * DELETE /api/v1/users/me
   * GDPR Article 17: Right to Erasure / Account Deletion.
   * Redacts personal data, deletes tokens & relationships, logs compliance audit,
   * and enqueues ActivityPub Delete tombstone if federated.
   */
  router.delete("/me", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { success, actorUrl } = database.anonymizeUser(userId);
    if (!success) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (actorUrl && worker && process.env["NODE_ENV"] !== "test") {
      try {
        const followers = database.getUserFollowers(userId);
        for (const f of followers) {
          if ((f as any).actor_url && (f as any).remote_domain && (f as any).inbox_url) {
            const deleteActivity = {
              "@context": "https://www.w3.org/ns/activitystreams",
              id: `${actorUrl}#delete-${Date.now()}`,
              type: "Delete",
              actor: actorUrl,
              object: actorUrl,
            };
            database.enqueueFederationDelivery(
              "Delete",
              deleteActivity.id,
              deleteActivity,
              (f as any).inbox_url,
              (f as any).remote_domain,
            );
          }
        }
        void worker.processQueue();
      } catch {}
    }

    res.json({ success: true, message: "Account successfully deleted pursuant to GDPR Article 17 Right to Erasure." });
  });

  /**
   * POST /api/v1/users/me/export
   * Asynchronous queue trigger for GDPR Art. 20 / CCPA data archives.
   */
  router.post("/me/export", requireAuth, defaultArchiveExportLimiter.middleware(), (req: Request, res: Response) => {
    const userId = req.user!.id;
    const user = database.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const format = (req.body?.format || req.query.format || "zip") === "json" ? "json" : "zip";
    const job = archiveQueue.enqueue(database, userId, user.username, format);

    database.logAudit({
      actorId: userId,
      action: "gdpr_data_archive_job_enqueued",
      resourceType: "user",
      resourceId: String(userId),
      details: { jobId: job.id, format, queuePosition: job.queuePosition },
    });

    res.status(202).json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        queuePosition: job.queuePosition,
        format: job.format,
        createdAt: job.createdAt,
        concurrency: archiveQueue.getConcurrency(),
      },
      concurrency: archiveQueue.getConcurrency(),
    });
  });

  /**
   * GET /api/v1/users/me/export/status
   * Polls the status of the user's latest asynchronous archive job.
   */
  router.get("/me/export/status", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const jobId = req.query.jobId as string | undefined;
    const job = jobId ? archiveQueue.getJob(jobId) : archiveQueue.getLatestUserJob(userId);

    if (!job || job.userId !== userId) {
      res.json({ job: null });
      return;
    }

    res.json({
      job: {
        id: job.id,
        status: job.status,
        format: job.format,
        queuePosition: job.queuePosition,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        expiresAt: job.expiresAt,
        fileSizeBytes: job.fileSizeBytes,
        error: job.error,
        downloadUrl: job.status === "completed" ? `/api/v1/users/me/export/download?jobId=${job.id}` : undefined,
        concurrency: archiveQueue.getConcurrency(),
      },
      concurrency: archiveQueue.getConcurrency(),
    });
  });

  /**
   * GET /api/v1/users/me/export/download
   * Streams a completed asynchronous archive from staging storage.
   */
  router.get("/me/export/download", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const jobId = req.query.jobId as string | undefined;
    const job = jobId ? archiveQueue.getJob(jobId) : archiveQueue.getLatestUserJob(userId);

    if (!job || job.userId !== userId || job.status !== "completed" || !job.filePath) {
      res.status(404).json({ error: "No completed archive found or archive has expired." });
      return;
    }

    const filename = `modelscript-archive-${job.username}.${job.format}`;
    res.setHeader("Content-Type", job.format === "zip" ? "application/zip" : "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.sendFile(job.filePath);
  });

  /**
   * GET /api/v1/users/me/export
   * GDPR Article 20: Right to Data Portability (synchronous download route).
   * Exports an interactive Twitter-style ZIP archive with offline HTML viewer or raw JSON.
   */
  router.get("/me/export", requireAuth, defaultArchiveExportLimiter.middleware(), (req: Request, res: Response) => {
    const userId = req.user!.id;
    const format = (req.query.format as string)?.toLowerCase();
    const isZip = format === "zip" || (!format && req.headers.accept === "application/zip");

    database.logAudit({
      actorId: userId,
      action: "gdpr_data_archive_exported",
      resourceType: "user",
      resourceId: String(userId),
      details: { format: isZip ? "zip" : "json" },
    });

    if (isZip) {
      const zipBuffer = generateUserArchiveZip(database, userId);
      if (!zipBuffer) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const user = database.getUserById(userId);
      const username = user?.username || `user-${userId}`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="modelscript-archive-${username}.zip"`);
      res.send(zipBuffer);
      return;
    }

    const exportBundle = gatherUserDataBundle(database, userId);
    if (!exportBundle) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.setHeader("Content-Disposition", `attachment; filename="modelscript-user-export-${userId}.json"`);
    res.json(exportBundle);
  });

  /**
   * POST /api/v1/users/:username/follow
   */
  router.post("/:username/follow", requireAuth, (req: Request, res: Response) => {
    const followerId = req.user!.id;
    const username = req.params.username as string;

    const targetUser = database.getUserByUsername(username);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (followerId === targetUser.id) {
      res.status(400).json({ error: "Cannot follow yourself" });
      return;
    }

    const fullTarget = database.getUserFederationInfo(targetUser.id);
    const isRemote = Boolean(fullTarget?.remote_domain);

    database.followUser(followerId, targetUser.id, isRemote ? "pending" : "accepted");

    if (isRemote && fullTarget?.actor_url) {
      const fullFollower = database.getUserFederationInfo(followerId);
      if (fullFollower?.actor_url) {
        const followActivity = {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: `${fullFollower.actor_url}#follow-${Date.now()}`,
          type: "Follow",
          actor: fullFollower.actor_url,
          object: fullTarget.actor_url,
        };

        const targetInbox = fullTarget.inbox_url || `${fullTarget.actor_url}/inbox`;
        database.enqueueFederationDelivery(
          "Follow",
          followActivity.id,
          followActivity,
          targetInbox,
          fullTarget.remote_domain!,
        );
        if (worker && process.env["NODE_ENV"] !== "test") {
          void worker.processQueue();
        }
      }
    }

    res.json({ success: true, state: isRemote ? "pending" : "accepted" });
  });

  /**
   * DELETE /api/v1/users/:username/follow
   */
  router.delete("/:username/follow", requireAuth, (req: Request, res: Response) => {
    const followerId = req.user!.id;
    const username = req.params.username as string;

    const targetUser = database.getUserByUsername(username);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const fullTarget = database.getUserFederationInfo(targetUser.id);
    const isRemote = Boolean(fullTarget?.remote_domain);

    database.unfollowUser(followerId, targetUser.id);

    if (isRemote && fullTarget?.actor_url) {
      const fullFollower = database.getUserFederationInfo(followerId);
      if (fullFollower?.actor_url) {
        const undoActivity = {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: `${fullFollower.actor_url}#undo-follow-${Date.now()}`,
          type: "Undo",
          actor: fullFollower.actor_url,
          object: {
            id: `${fullFollower.actor_url}#follow-${targetUser.id}`,
            type: "Follow",
            actor: fullFollower.actor_url,
            object: fullTarget.actor_url,
          },
        };

        const targetInbox = fullTarget.inbox_url || `${fullTarget.actor_url}/inbox`;
        database.enqueueFederationDelivery(
          "Undo",
          undoActivity.id,
          undoActivity,
          targetInbox,
          fullTarget.remote_domain!,
        );
        if (worker && process.env["NODE_ENV"] !== "test") {
          void worker.processQueue();
        }
      }
    }

    res.json({ success: true });
  });

  /**
   * POST /api/v1/users/:username/block
   */
  router.post("/:username/block", requireAuth, (req: Request, res: Response) => {
    const blockerId = req.user!.id;
    const targetUser = database.getUserByUsername(req.params.username as string);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (blockerId === targetUser.id) {
      res.status(400).json({ error: "Cannot block yourself" });
      return;
    }
    database.blockUser(blockerId, targetUser.id);
    res.json({ success: true, blocked: true });
  });

  /**
   * DELETE /api/v1/users/:username/block
   */
  router.delete("/:username/block", requireAuth, (req: Request, res: Response) => {
    const blockerId = req.user!.id;
    const targetUser = database.getUserByUsername(req.params.username as string);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    database.unblockUser(blockerId, targetUser.id);
    res.json({ success: true, blocked: false });
  });

  /**
   * POST /api/v1/users/:username/mute
   */
  router.post("/:username/mute", requireAuth, (req: Request, res: Response) => {
    const muterId = req.user!.id;
    const targetUser = database.getUserByUsername(req.params.username as string);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (muterId === targetUser.id) {
      res.status(400).json({ error: "Cannot mute yourself" });
      return;
    }
    const isMuted = database.isUserMuted(muterId, targetUser.id);
    if (isMuted) {
      database.unmuteUser(muterId, targetUser.id);
      res.json({ success: true, muted: false });
    } else {
      database.muteUser(muterId, targetUser.id);
      res.json({ success: true, muted: true });
    }
  });

  /**
   * POST /api/v1/users/:username/report
   */
  router.post("/:username/report", requireAuth, (req: Request, res: Response) => {
    const reporterId = req.user!.id;
    const targetUser = database.getUserByUsername(req.params.username as string);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const { reason, details } = req.body;
    if (!reason || typeof reason !== "string") {
      res.status(400).json({ error: "Report reason is required" });
      return;
    }
    const report = database.createContentReport(reporterId, {
      targetUserId: targetUser.id,
      reason,
      details,
    });
    res.status(201).json({ success: true, reportId: report.id });
  });

  /**
   * GET /api/v1/users/me/bots
   */
  router.get("/me/bots", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const bots = database.getUserBots(userId);
    res.json({ bots });
  });

  /**
   * POST /api/v1/users/me/bots
   */
  router.post("/me/bots", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { username, display_name, bio, avatar_url } = req.body;

    if (!username || !display_name) {
      res.status(400).json({ error: "Missing username or display_name" });
      return;
    }

    if (database.getUserByUsername(username)) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }

    // Generate a secure API token for the bot
    const crypto = require("crypto");
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenPrefix = "ms_bot_";
    const fullToken = `${tokenPrefix}${rawToken}`;

    // Hash the token before storing
    const tokenHash = crypto.createHash("sha256").update(fullToken).digest("hex");

    const bot = database.createBot(userId, username, display_name, bio || "", avatar_url || "", tokenHash);

    res.json({ success: true, bot, token: fullToken });
  });

  /**
   * DELETE /api/v1/users/me/bots/:botId
   */
  router.delete("/me/bots/:botId", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const botId = parseInt(req.params.botId as string, 10);

    if (isNaN(botId)) {
      res.status(400).json({ error: "Invalid bot ID" });
      return;
    }

    database.deleteBot(userId, botId);
    res.json({ success: true });
  });

  return router;
}
