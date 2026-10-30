// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import { defaultArchiveExportLimiter } from "../middleware/archive-limiter.js";
import { JWT_SECRET, extractTokenFromRequest, optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { ArchiveQueue, defaultArchiveQueue } from "../services/archive-queue.js";
import type { FederationWorker } from "../services/federation-worker.js";
import { gatherUserDataBundle, generateUserArchiveZip } from "../services/user-archive.js";
import { assertSafePublicUrl } from "../util/ssrf.js";
import { normalizeSolutionBundleUrl } from "./solutions.js";

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
    const limit = Math.min(Math.max(1, Number(req.query["limit"]) || 3), 50);
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
   * GET /api/v1/users/me/onboarding
   * Returns current user's onboarding completion status and chosen discipline persona
   */
  const handleGetOnboarding = (req: Request, res: Response) => {
    try {
      const status = database.getUserOnboardingStatus(req.user!.id);
      res.json(status);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch onboarding status" });
    }
  };
  router.get("/me/onboarding", requireAuth, handleGetOnboarding);
  router.get("/onboarding", requireAuth, handleGetOnboarding);

  /**
   * POST /api/v1/users/me/onboarding/complete
   * Records completed onboarding and selected engineering persona
   */
  const handleCompleteOnboarding = (req: Request, res: Response) => {
    try {
      const persona = typeof req.body?.persona === "string" ? req.body.persona.trim() : null;
      database.completeUserOnboarding(req.user!.id, persona);
      const updated = database.getUserOnboardingStatus(req.user!.id);
      res.json({ success: true, status: updated });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to complete onboarding" });
    }
  };
  router.post("/me/onboarding/complete", requireAuth, handleCompleteOnboarding);
  router.post("/onboarding/complete", requireAuth, handleCompleteOnboarding);

  /**
   * GET /api/v1/users/me/invites
   * Returns current user's golden tickets, quota remaining, and referral bonuses
   */
  const handleGetInvites = (req: Request, res: Response) => {
    try {
      const settings = database.getInstanceSettings();
      const status = database.getUserOnboardingStatus(req.user!.id);
      const invites = database.getUserInvites(req.user!.id);
      const referrals = database.getUserReferrals(req.user!.id);
      res.json({
        invitesEnabled: settings.userInvitesEnabled,
        invitesRemaining: status.invitesRemaining,
        invites,
        referrals,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch user invites" });
    }
  };
  router.get("/me/invites", requireAuth, handleGetInvites);
  router.get("/invites", requireAuth, handleGetInvites);

  /**
   * POST /api/v1/users/me/invites/generate
   * Generates a new Golden Ticket / single-use invite code decremented from user quota
   */
  const handleGenerateInvite = (req: Request, res: Response) => {
    try {
      const settings = database.getInstanceSettings();
      if (!settings.userInvitesEnabled) {
        res.status(403).json({ error: "User invitation generation is disabled on this instance" });
        return;
      }

      const note = typeof req.body?.note === "string" ? req.body.note.trim() : undefined;
      const initialCredits =
        typeof req.body?.initialCredits === "number" && req.body.initialCredits > 0
          ? Math.min(500, req.body.initialCredits)
          : 100;

      const invite = database.generateUserGoldenTicket(req.user!.id, note, initialCredits);
      const status = database.getUserOnboardingStatus(req.user!.id);

      res.status(201).json({
        success: true,
        invite,
        invitesRemaining: status.invitesRemaining,
      });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to generate invite" });
    }
  };
  router.post("/me/invites/generate", requireAuth, handleGenerateInvite);
  router.post("/invites/generate", requireAuth, handleGenerateInvite);

  /**
   * GET /api/v1/users/:username
   */
  router.get("/:username", optionalAuth, async (req: Request, res: Response) => {
    const username = req.params["username"] as string;
    let profile = database.getFullProfileByUsername(username);

    if (!profile && username.includes("@")) {
      try {
        const { resolveActorHandle } = await import("./federation.js");
        const resolved = await resolveActorHandle(username, database);
        if (resolved && resolved.user) {
          profile = database.getFullProfileByUsername(resolved.user.username);
        }
      } catch {
        // Ignore resolution errors and fallback to 404
      }
    }

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
    const targetUser = database.getUserByUsername(req.params["username"] as string);
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
    const targetUser = database.getUserByUsername(req.params["username"] as string);
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

    const isSafeProfileUrl = (u: unknown): boolean => {
      if (u === undefined || u === null || u === "") return true;
      if (typeof u !== "string" || u.length > 2048) return false;
      const trimmed = u.trim();
      if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
      try {
        const parsed = new URL(trimmed);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    };

    if (!isSafeProfileUrl(website) || !isSafeProfileUrl(avatar_url) || !isSafeProfileUrl(banner_url)) {
      res.status(400).json({ error: "Profile URLs must use http://, https://, or a relative path" });
      return;
    }

    database.updateProfile(userId, {
      display_name: typeof display_name === "string" ? display_name.slice(0, 100) : display_name,
      bio: typeof bio === "string" ? bio.slice(0, 1000) : bio,
      location: typeof location === "string" ? location.slice(0, 100) : location,
      website,
      avatar_url,
      banner_url,
    });
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
          if (f.actor_url && f.remote_domain && f.inbox_url) {
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
              f.inbox_url,
              f.remote_domain,
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

    const format = (req.body?.format || req.query["format"] || "zip") === "json" ? "json" : "zip";
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
    const jobId = req.query["jobId"] as string | undefined;
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
    const jobId = req.query["jobId"] as string | undefined;
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
    const format = (req.query["format"] as string)?.toLowerCase();
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
   * POST /api/v1/users/me/appeals
   * Allows a user (including frozen or suspended accounts holding a signed JWT) to appeal a moderation decision.
   */
  router.post("/me/appeals", (req: Request, res: Response) => {
    let appealingUserId: number | null = req.user?.id ?? null;

    if (!appealingUserId) {
      const token = extractTokenFromRequest(req);
      if (token) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET) as { id?: number | undefined };
          if (typeof decoded.id === "number" && Number.isFinite(decoded.id)) {
            appealingUserId = decoded.id;
          }
        } catch {
          // Invalid token
        }
      }
    }

    if (!appealingUserId) {
      res.status(401).json({ error: "Authentication required to submit a moderation appeal" });
      return;
    }

    const user = database.getUserById(appealingUserId);
    if (!user || user.status === "deleted") {
      res.status(404).json({ error: "User account not found" });
      return;
    }

    const { reason, details, postId } = req.body || {};
    const appealReason =
      typeof reason === "string" && reason.trim()
        ? reason.trim()
        : `Appeal for ${user.status || "account"} moderation action`;

    if (!details && !reason) {
      res.status(400).json({ error: "Appeal reason or details are required" });
      return;
    }

    const report = database.createContentReport(user.id, {
      postId: typeof postId === "number" ? postId : undefined,
      targetUserId: user.id,
      targetType: "appeal",
      targetResourceId: postId ? `post:${postId}` : `user:${user.id}`,
      reason: appealReason,
      details: typeof details === "string" ? details : undefined,
    });

    database.logAudit({
      actorId: user.id,
      action: "moderation_appeal_submitted",
      resourceType: "user",
      resourceId: String(user.id),
      ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
      details: {
        appealId: report.id,
        userStatus: user.status,
        reason: appealReason,
        details,
        postId,
      },
    });

    res.status(201).json({
      success: true,
      appealId: report.id,
      reportId: report.id,
      status: report.status,
      message: "Your moderation appeal has been submitted for administrative review.",
    });
  });

  /**
   * POST /api/v1/users/:username/follow
   */
  router.post("/:username/follow", requireAuth, (req: Request, res: Response) => {
    const followerId = req.user!.id;
    const username = req.params["username"] as string;

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
    database.createNotification(targetUser.id, followerId, "follow");

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
    const username = req.params["username"] as string;

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
    const targetUser = database.getUserByUsername(req.params["username"] as string);
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
    const targetUser = database.getUserByUsername(req.params["username"] as string);
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
    const targetUser = database.getUserByUsername(req.params["username"] as string);
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
   * DELETE /api/v1/users/:username/mute
   */
  router.delete("/:username/mute", requireAuth, (req: Request, res: Response) => {
    const muterId = req.user!.id;
    const targetUser = database.getUserByUsername(req.params["username"] as string);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    database.unmuteUser(muterId, targetUser.id);
    res.json({ success: true, muted: false });
  });

  /**
   * POST /api/v1/users/:username/report
   */
  router.post("/:username/report", requireAuth, (req: Request, res: Response) => {
    const reporterId = req.user!.id;
    const targetUser = database.getUserByUsername(req.params["username"] as string);
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
    database.logAudit({
      actorId: reporterId,
      action: "user_reported",
      resourceType: "user",
      resourceId: String(targetUser.id),
      ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
      details: { reason, details, targetUsername: targetUser.username, reportId: report.id },
    });
    res.status(201).json({ success: true, reportId: report.id });
  });

  /**
   * GET /api/v1/users/me/bots
   */
  router.get("/me/bots", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const bots = database.getUserBots(userId).map((b) => ({
      ...b,
      has_bot_api_key: Boolean(b.bot_api_key),
      bot_api_key: b.bot_api_key ? "••••••••" : null,
    }));
    res.json({ bots });
  });

  const ALLOWED_BOT_SCOPES = new Set(["social:read", "social:write", "repos:read", "repos:review", "packages:read"]);

  function sanitizeBotScopes(rawScopes: unknown): { valid: boolean; normalized: string; invalidScope?: string } {
    if (rawScopes === undefined || rawScopes === null || rawScopes === "") {
      return { valid: true, normalized: "social:read,social:write" };
    }
    const list = Array.isArray(rawScopes)
      ? rawScopes.map((s) => String(s).trim()).filter(Boolean)
      : typeof rawScopes === "string"
        ? rawScopes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    if (list.length === 0) {
      return { valid: true, normalized: "social:read,social:write" };
    }
    for (const scope of list) {
      if (!ALLOWED_BOT_SCOPES.has(scope)) {
        return { valid: false, normalized: "", invalidScope: scope };
      }
    }
    return { valid: true, normalized: list.join(",") };
  }

  /**
   * POST /api/v1/users/me/bots
   */
  router.post("/me/bots", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { username, display_name, bio, avatar_url, scopes, system_prompt, model, api_key, endpoint_url } = req.body;

    if (!username || !display_name) {
      res.status(400).json({ error: "Missing username or display_name" });
      return;
    }

    const scopeCheck = sanitizeBotScopes(scopes);
    if (!scopeCheck.valid) {
      res.status(400).json({
        error: `Invalid or forbidden bot scope '${scopeCheck.invalidScope}'. Allowed bot scopes: ${Array.from(ALLOWED_BOT_SCOPES).join(", ")}`,
      });
      return;
    }

    if (database.getUserByUsername(username)) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }

    if (endpoint_url && typeof endpoint_url === "string" && endpoint_url.trim().length > 0) {
      try {
        if (process.env["NODE_ENV"] === "production") {
          assertSafePublicUrl(endpoint_url.trim());
        } else {
          new URL(endpoint_url.trim());
        }
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Invalid bot endpoint URL" });
        return;
      }
    }

    // Generate a secure API token for the bot
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenPrefix = "ms_bot_";
    const fullToken = `${tokenPrefix}${rawToken}`;

    // Hash the token before storing
    const tokenHash = crypto.createHash("sha256").update(fullToken).digest("hex");

    const bot = database.createBot(
      userId,
      username,
      display_name,
      bio || "",
      avatar_url || "",
      tokenHash,
      scopeCheck.normalized,
      system_prompt || "",
      model || "gemini-1.5-flash",
      api_key || "",
      endpoint_url || "",
    );

    res.json({ success: true, bot, token: fullToken });
  });

  /**
   * PATCH /api/v1/users/me/bots/:botId
   */
  router.patch("/me/bots/:botId", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const botId = parseInt(req.params["botId"] as string, 10);

    if (isNaN(botId)) {
      res.status(400).json({ error: "Invalid bot ID" });
      return;
    }

    const bot = database.getBotById(botId);
    if (!bot || bot.owner_id !== userId) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }

    const { display_name, bio, avatar_url, scopes, system_prompt, model, api_key, endpoint_url } = req.body;
    let validatedScopes: string | undefined;
    if (scopes !== undefined) {
      const scopeCheck = sanitizeBotScopes(scopes);
      if (!scopeCheck.valid) {
        res.status(400).json({
          error: `Invalid or forbidden bot scope '${scopeCheck.invalidScope}'. Allowed bot scopes: ${Array.from(ALLOWED_BOT_SCOPES).join(", ")}`,
        });
        return;
      }
      validatedScopes = scopeCheck.normalized;
    }
    if (endpoint_url && typeof endpoint_url === "string" && endpoint_url.trim().length > 0) {
      try {
        if (process.env["NODE_ENV"] === "production") {
          assertSafePublicUrl(endpoint_url.trim());
        } else {
          new URL(endpoint_url.trim());
        }
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Invalid bot endpoint URL" });
        return;
      }
    }
    database.updateBotSettings(userId, botId, {
      displayName: display_name,
      bio,
      avatarUrl: avatar_url,
      scopes: validatedScopes,
      systemPrompt: system_prompt,
      model,
      apiKey: api_key,
      endpointUrl: endpoint_url,
    });

    const updatedBot = database.getBotById(botId);
    res.json({
      success: true,
      bot: updatedBot
        ? {
            ...updatedBot,
            has_bot_api_key: Boolean(updatedBot.bot_api_key),
            bot_api_key: updatedBot.bot_api_key ? "••••••••" : null,
          }
        : null,
    });
  });

  /**
   * DELETE /api/v1/users/me/bots/:botId
   */
  router.delete("/me/bots/:botId", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const botId = parseInt(req.params["botId"] as string, 10);

    if (isNaN(botId)) {
      res.status(400).json({ error: "Invalid bot ID" });
      return;
    }

    database.deleteBot(userId, botId);
    res.json({ success: true });
  });

  /**
   * GET /api/v1/users/:username/repos
   */
  router.get("/:username/repos", optionalAuth, (req: Request, res: Response) => {
    const targetUser = database.getUserByUsername(req.params["username"] as string);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    try {
      const repos = database.getUserRepos(targetUser.id);
      res.json({ repos });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch user repositories" });
    }
  });

  /**
   * GET /api/v1/users/:username/solutions
   */
  router.get("/:username/solutions", optionalAuth, (req: Request, res: Response) => {
    const username = req.params["username"] as string;
    try {
      const solutions = database.getUserSolutions(username).map((s) => ({
        ...s,
        bundle_url: normalizeSolutionBundleUrl(s.bundle_url, s.slug),
      }));
      res.json({ solutions });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch user solutions" });
    }
  });

  return router;
}
