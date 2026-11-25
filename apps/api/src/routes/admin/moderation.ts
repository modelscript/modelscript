// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Request, type Response, type Router } from "express";
import { FederationWorker } from "../../services/federation-worker.js";
import { getClientIp } from "../../util/client-ip.js";
import { isFederationDisabled } from "../../util/tier-presets.js";
import { moderatorAuth, staffAuth, type AdminRouteContext } from "./admin-helpers.js";

export function createModerationRouter({ database, worker }: AdminRouteContext): Router {
  const router = express.Router();

  // ── Moderation Queue ──

  /**
   * GET /api/v1/admin/moderation/queue
   * Retrieves reported posts and targets pending review
   */
  router.get("/admin/moderation/queue", moderatorAuth, (req: Request, res: Response) => {
    try {
      const status = req.query["status"] as string | undefined;
      const targetType = req.query["targetType"] as string | undefined;
      const search = (req.query["q"] as string | undefined) || (req.query["search"] as string | undefined);
      const limit = Math.min(100, Math.max(1, parseInt(req.query["limit"] as string, 10) || 50));
      const offset = Math.max(0, parseInt(req.query["offset"] as string, 10) || 0);

      const reports = database.getModerationQueue(status, limit, offset, targetType, search);
      const total = database.getModerationQueueCount(status, targetType, search);
      const counts = database.getAdminPendingCounts();
      res.json({
        reports,
        count: reports.length,
        total,
        limit,
        offset,
        pendingCount: counts.pendingReports,
      });
    } catch (err: unknown) {
      console.error("[AdminRouter] GET /admin/moderation/queue error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch moderation queue" });
    }
  });

  /**
   * POST /api/v1/admin/moderation/reports/:id/resolve
   * Resolves a report and optionally applies actions (delete post, silence post, mark sensitive, quarantine resource, silence/suspend domain, freeze/suspend/restore user, forward ActivityPub Flag)
   */
  router.post("/admin/moderation/reports/:id/resolve", moderatorAuth, express.json(), (req: Request, res: Response) => {
    const reportId = Number(req.params["id"]);
    const {
      status,
      resolutionNotes,
      action,
      domain: explicitDomain,
      resolveAllForTarget,
      contentWarning,
      forwardFederatedFlag,
    } = req.body;

    if (!["resolved", "dismissed"].includes(status)) {
      res.status(400).json({ error: "Status must be 'resolved' or 'dismissed'" });
      return;
    }

    try {
      const report = database.getContentReport(reportId);
      if (!report) {
        res.status(404).json({ error: "Report not found" });
        return;
      }

      let tombstoneActivity: Record<string, unknown> | null = null;
      let flagActivity: Record<string, unknown> | null = null;
      let federatedFlagQueued = false;
      const targetUserId = report.post_author_id ?? report.target_user_id ?? null;
      const preDeletePost = report.post_id ? database.getPost(report.post_id) : null;

      // Execute moderation action if specified
      if (action === "delete_post" && report.post_id) {
        const deleteResult = database.deletePost(report.post_id);
        if (deleteResult.apId) {
          tombstoneActivity = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: `${deleteResult.apId}#delete`,
            type: "Delete",
            actor: `${process.env["PUBLIC_URL"] || "https://hub.modelscript.org"}/actor`,
            to: ["https://www.w3.org/ns/activitystreams#Public"],
            object: deleteResult.apId,
          };
          if (deleteResult.authorId) {
            const fedWorker = worker || new FederationWorker(database);
            fedWorker.enqueueActivityBroadcast(tombstoneActivity, deleteResult.authorId);
          }
        }
      } else if (action === "quarantine_resource") {
        const resType = report.target_type || (report.post_id ? "post" : "package");
        const resId = report.target_resource_id || (report.post_id ? String(report.post_id) : `report-${reportId}`);
        database.quarantineResource({
          resourceType: resType,
          resourceId: resId,
          reason: resolutionNotes || report.reason,
          quarantinedBy: req.user?.id ?? null,
        });
      } else if (action === "silence_post" && report.post_id) {
        database.silencePost(report.post_id, true);
      } else if (action === "mark_sensitive" && report.post_id) {
        database.markPostSensitive(
          report.post_id,
          true,
          (typeof contentWarning === "string" && contentWarning.trim()) || resolutionNotes || report.reason,
        );
      } else if (action === "silence_domain" || action === "suspend_domain") {
        const targetTier = action === "suspend_domain" ? "suspend" : "silence";
        const inferredDomain =
          (typeof explicitDomain === "string" && explicitDomain.trim()) ||
          report.author_domain ||
          (report.author_username && report.author_username.includes("@")
            ? report.author_username.split("@").pop()
            : undefined);
        if (inferredDomain) {
          database.setDomainTier(
            inferredDomain,
            targetTier,
            resolutionNotes || `Report #${reportId}: ${report.reason}`,
          );
          database.logAudit({
            actorId: req.user?.id || null,
            action: `federation_tier_${targetTier}`,
            resourceType: "domain",
            resourceId: inferredDomain.toLowerCase(),
            ipAddress: getClientIp(req),
            details: { domain: inferredDomain, tier: targetTier, reportId, reason: resolutionNotes },
          });
        }
      } else if ((action === "freeze_user" || action === "suspend_user") && targetUserId) {
        const targetUser = database.getUserById(targetUserId);
        const callerIsAdmin = req.user?.accountType === "admin" || req.user?.role === "admin";
        if (
          targetUser &&
          (targetUser.account_type === "admin" || targetUser.account_type === "moderator") &&
          !callerIsAdmin
        ) {
          res.status(403).json({
            error: "Moderators cannot freeze or suspend administrator or moderator accounts.",
          });
          return;
        }
        const newStatus = action === "suspend_user" ? "suspended" : "frozen";
        database.moderateUserAccount(targetUserId, {
          status: newStatus,
          revokeSessions: true,
        });
        database.logAudit({
          actorId: req.user?.id || null,
          action: `user_${newStatus}`,
          resourceType: "user",
          resourceId: String(targetUserId),
          ipAddress: getClientIp(req),
          details: { userId: targetUserId, status: newStatus, reportId, reason: resolutionNotes },
        });
      } else if (action === "restore_user" && targetUserId) {
        database.moderateUserAccount(targetUserId, {
          status: "active",
          revokeSessions: false,
        });
        database.logAudit({
          actorId: req.user?.id || null,
          action: "user_restored_appeal",
          resourceType: "user",
          resourceId: String(targetUserId),
          ipAddress: getClientIp(req),
          details: { userId: targetUserId, status: "active", reportId, reason: resolutionNotes },
        });
      }

      // Send automated security_alert notification to affected user when enforcement or restoration occurs
      if (
        targetUserId &&
        action &&
        ["delete_post", "silence_post", "mark_sensitive", "freeze_user", "suspend_user", "restore_user"].includes(
          action,
        )
      ) {
        database.createNotification(
          targetUserId,
          req.user?.id || targetUserId,
          "security_alert",
          action === "delete_post" ? null : (report.post_id ?? null),
          {
            moderationAction: action,
            reportId,
            reason: resolutionNotes || report.reason,
            canAppeal: action !== "restore_user",
          },
        );
      }

      // Outbound ActivityPub Flag forwarding to remote server inbox
      if (forwardFederatedFlag && !isFederationDisabled(database.getInstanceSettings())) {
        const fedInfo = targetUserId ? database.getUserFederationInfo(targetUserId) : undefined;
        const remoteDomain =
          (typeof explicitDomain === "string" && explicitDomain.trim()) ||
          fedInfo?.remote_domain ||
          report.author_domain ||
          (report.author_username && report.author_username.includes("@")
            ? report.author_username.split("@").pop()
            : undefined);

        if (remoteDomain) {
          const baseUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
          const flagId = `${baseUrl}/flags/${reportId}-${Date.now()}`;
          const targetInbox = fedInfo?.inbox_url || `https://${remoteDomain}/inbox`;
          const targetObjects: string[] = [];

          if (fedInfo?.actor_url) {
            targetObjects.push(fedInfo.actor_url);
          } else if (report.author_username) {
            const handle = report.author_username.split("@")[0] || "actor";
            targetObjects.push(`https://${remoteDomain}/users/${handle}`);
          } else {
            targetObjects.push(`https://${remoteDomain}/actor`);
          }

          if (preDeletePost?.ap_id) {
            targetObjects.push(preDeletePost.ap_id);
          }

          flagActivity = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: flagId,
            type: "Flag",
            actor: `${baseUrl}/actor`,
            object: targetObjects.length === 1 ? targetObjects[0] : targetObjects,
            content: resolutionNotes || `${report.reason}${report.details ? `: ${report.details}` : ""}`,
          };

          database.enqueueFederationDelivery("Flag", flagId, flagActivity, targetInbox, remoteDomain);
          federatedFlagQueued = true;

          database.logAudit({
            actorId: req.user?.id || null,
            action: "federated_flag_forwarded",
            resourceType: "domain",
            resourceId: remoteDomain.toLowerCase(),
            ipAddress: getClientIp(req),
            details: { reportId, remoteDomain, targetInbox, flagId },
          });
        }
      }

      database.resolveContentReport(reportId, status, resolutionNotes, action || "none", Boolean(resolveAllForTarget));

      database.logAudit({
        actorId: req.user?.id || null,
        action: `report_${status}`,
        resourceType: "content_report",
        resourceId: String(reportId),
        ipAddress: getClientIp(req),
        details: {
          status,
          resolutionNotes,
          action,
          postId: report.post_id,
          targetUserId,
          federatedFlagQueued,
        },
      });

      res.json({
        success: true,
        reportId,
        status,
        actionExecuted: action || "none",
        tombstoneActivity,
        federatedFlagQueued,
        flagActivity,
      });
    } catch (err: unknown) {
      console.error("[AdminRouter] Resolve report error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to resolve report" });
    }
  });

  /**
   * POST /api/v1/admin/moderation/bulk-resolve
   * Batch resolves or dismisses multiple report IDs
   */
  router.post("/admin/moderation/bulk-resolve", moderatorAuth, express.json(), (req: Request, res: Response) => {
    const { reportIds, status, resolutionNotes, action, contentWarning } = req.body;
    if (!Array.isArray(reportIds) || reportIds.length === 0) {
      res.status(400).json({ error: "reportIds must be a non-empty array" });
      return;
    }
    if (!["resolved", "dismissed"].includes(status)) {
      res.status(400).json({ error: "Status must be 'resolved' or 'dismissed'" });
      return;
    }

    try {
      let resolvedCount = 0;
      for (const rawId of reportIds) {
        const id = Number(rawId);
        if (!Number.isFinite(id)) continue;
        const report = database.getContentReport(id);
        if (!report) continue;

        const targetUserId = report.post_author_id ?? report.target_user_id ?? null;

        if (action === "delete_post" && report.post_id) {
          database.deletePost(report.post_id);
        } else if (action === "silence_post" && report.post_id) {
          database.silencePost(report.post_id, true);
        } else if (action === "mark_sensitive" && report.post_id) {
          database.markPostSensitive(
            report.post_id,
            true,
            (typeof contentWarning === "string" && contentWarning.trim()) || resolutionNotes || report.reason,
          );
        } else if ((action === "freeze_user" || action === "suspend_user") && targetUserId) {
          const targetUser = database.getUserById(targetUserId);
          const callerIsAdmin = req.user?.accountType === "admin" || req.user?.role === "admin";
          if (
            targetUser &&
            (targetUser.account_type === "admin" || targetUser.account_type === "moderator") &&
            !callerIsAdmin
          ) {
            res.status(403).json({
              error: "Moderators cannot freeze or suspend administrator or moderator accounts.",
            });
            return;
          }
          database.moderateUserAccount(targetUserId, {
            status: action === "suspend_user" ? "suspended" : "frozen",
            revokeSessions: true,
          });
        } else if (action === "restore_user" && targetUserId) {
          const targetUser = database.getUserById(targetUserId);
          const callerIsAdmin = req.user?.accountType === "admin" || req.user?.role === "admin";
          if (
            targetUser &&
            (targetUser.account_type === "admin" || targetUser.account_type === "moderator") &&
            !callerIsAdmin
          ) {
            res.status(403).json({
              error: "Moderators cannot restore administrator or moderator accounts.",
            });
            return;
          }
          database.moderateUserAccount(targetUserId, {
            status: "active",
            revokeSessions: false,
          });
        } else if ((action === "silence_domain" || action === "suspend_domain") && report.author_domain) {
          database.setDomainTier(
            report.author_domain,
            action === "suspend_domain" ? "suspend" : "silence",
            resolutionNotes || `Bulk report #${id}`,
          );
        }

        if (
          targetUserId &&
          action &&
          ["delete_post", "silence_post", "mark_sensitive", "freeze_user", "suspend_user", "restore_user"].includes(
            action,
          )
        ) {
          database.createNotification(
            targetUserId,
            req.user?.id || targetUserId,
            "security_alert",
            action === "delete_post" ? null : (report.post_id ?? null),
            {
              moderationAction: action,
              reportId: id,
              reason: resolutionNotes || report.reason,
              canAppeal: action !== "restore_user",
            },
          );
        }

        if (database.resolveContentReport(id, status, resolutionNotes, action || "none")) {
          resolvedCount++;
        }
      }

      database.logAudit({
        actorId: req.user?.id || null,
        action: `report_bulk_${status}`,
        resourceType: "content_report",
        resourceId: `batch(${resolvedCount})`,
        ipAddress: getClientIp(req),
        details: { reportIds, status, action, resolutionNotes, resolvedCount },
      });

      res.json({ success: true, resolvedCount, status });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to bulk resolve reports" });
    }
  });

  // ── Post Management & Tombstone Propagation ──

  /**
   * DELETE /api/v1/admin/posts/:id
   * Admin delete of a post with ActivityPub Delete tombstone synthesis
   */
  router.delete("/admin/posts/:id", moderatorAuth, (req: Request, res: Response) => {
    const postId = String(req.params["id"] || "");
    try {
      const deleteResult = database.deletePost(postId);
      if (!deleteResult.success) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      let tombstoneActivity: Record<string, unknown> | null = null;
      if (deleteResult.apId) {
        tombstoneActivity = {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: `${deleteResult.apId}#delete`,
          type: "Delete",
          actor: `${process.env["PUBLIC_URL"] || "https://hub.modelscript.org"}/actor`,
          to: ["https://www.w3.org/ns/activitystreams#Public"],
          object: deleteResult.apId,
        };

        if (deleteResult.authorId) {
          const fedWorker = worker || new FederationWorker(database);
          fedWorker.enqueueActivityBroadcast(tombstoneActivity, deleteResult.authorId);
        }
      }

      database.logAudit({
        actorId: req.user?.id || null,
        action: "post_deleted_admin",
        resourceType: "post",
        resourceId: String(postId),
        ipAddress: getClientIp(req),
        details: { postId, apId: deleteResult.apId },
      });

      res.json({
        success: true,
        postId,
        tombstonePropagated: Boolean(deleteResult.apId),
        tombstoneActivity,
      });
    } catch (err: unknown) {
      console.error("[AdminRouter] Delete post error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete post" });
    }
  });

  // ── Internal Staff Notes ──

  router.get("/admin/notes", staffAuth, (req: Request, res: Response) => {
    const targetType = String(req.query["targetType"] || req.query["target_type"] || "user") as
      "user" | "domain" | "report";
    const targetId = String(req.query["targetId"] || req.query["target_id"] || "");
    if (!targetId) {
      res.status(400).json({ error: "targetId query parameter is required" });
      return;
    }
    res.json({ notes: database.listStaffNotes(targetType, targetId) });
  });

  router.post("/admin/notes", moderatorAuth, express.json(), (req: Request, res: Response) => {
    const targetType = (req.body?.targetType || req.body?.target_type || "user") as "user" | "domain" | "report";
    const targetId = String(req.body?.targetId ?? req.body?.target_id ?? "").trim();
    const content = String(req.body?.content || "").trim();
    if (!targetId || !content) {
      res.status(400).json({ error: "targetId and content are required" });
      return;
    }
    const note = database.createStaffNote(targetType, targetId, req.user?.id ?? 1, content);
    res.status(201).json({ note });
  });

  router.delete("/admin/notes/:id", moderatorAuth, (req: Request, res: Response) => {
    const deleted = database.deleteStaffNote(Number(req.params["id"]));
    if (!deleted) {
      res.status(404).json({ error: "Staff note not found" });
      return;
    }
    res.json({ success: true });
  });

  // ── Server-Wide Content Filters ──

  router.get("/admin/filters", moderatorAuth, (_req: Request, res: Response) => {
    res.json({ filters: database.listContentFilters(null) });
  });

  router.post("/admin/filters", moderatorAuth, express.json(), (req: Request, res: Response) => {
    const { title, context, filter_action, filterAction, keywords, expires_at, expiresAt } = req.body || {};
    if (!title || typeof title !== "string") {
      res.status(400).json({ error: "Filter title is required" });
      return;
    }
    const rawKeywords = Array.isArray(keywords) ? keywords : [];
    const filter = database.createContentFilter({
      userId: null,
      title: title.trim(),
      context: Array.isArray(context) ? context.map(String) : ["home", "public", "notifications", "thread", "account"],
      filterAction: filter_action || filterAction || "warn",
      keywords: rawKeywords.map((k: { keyword?: string; whole_word?: boolean } | string) =>
        typeof k === "string"
          ? { keyword: k, whole_word: true }
          : { keyword: String(k.keyword || ""), whole_word: k.whole_word !== false },
      ),
      expiresAt: expires_at ?? expiresAt ?? null,
    });
    res.status(201).json({ filter });
  });

  router.delete("/admin/filters/:id", moderatorAuth, (req: Request, res: Response) => {
    const deleted = database.deleteContentFilter(Number(req.params["id"]), null);
    if (!deleted) {
      res.status(404).json({ error: "Server filter not found" });
      return;
    }
    res.json({ success: true });
  });

  // ── Trending Content Review Gate ──

  router.get("/admin/trending", moderatorAuth, (req: Request, res: Response) => {
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
    const limit = Math.min(100, Math.max(1, parseInt(req.query["limit"] as string, 10) || 50));
    res.json({ topics: database.listTrendingTopicsForAdmin(status, limit) });
  });

  router.patch("/admin/trending/:id", moderatorAuth, express.json(), (req: Request, res: Response) => {
    const topicId = Number(req.params["id"]);
    const status = req.body?.status || req.body?.review_status;
    if (!["approved", "rejected", "pending"].includes(status)) {
      res.status(400).json({ error: "status must be 'approved', 'rejected', or 'pending'" });
      return;
    }
    const updated = database.reviewTrendingTopic(topicId, status, req.user?.id ?? null);
    if (!updated) {
      res.status(404).json({ error: "Trending topic not found" });
      return;
    }
    res.json({ success: true, topicId, status });
  });

  return router;
}
