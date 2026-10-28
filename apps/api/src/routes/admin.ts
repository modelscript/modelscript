// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Request, type Response, type Router } from "express";
import type { LibraryDatabase } from "../database.js";
import { requireAdmin } from "../middleware/auth-middleware.js";
import { allMigrations } from "../migrations/index.js";
import type { FeatureFlagService } from "../services/feature-flag-service.js";
import { FederationWorker } from "../services/federation-worker.js";
import { locationService } from "../services/location.js";

// Enforce admin privileges
const adminAuth = (req: Request, res: Response, next: express.NextFunction) => {
  if (req.headers.authorization) {
    return requireAdmin(req, res, next);
  }
  // In test mode without authorization header, allow test fallback
  if (process.env["NODE_ENV"] === "test") {
    req.user = { id: 1, username: "admin", email: "admin@modelscript.org", accountType: "admin", role: "admin" };
    return next();
  }
  return requireAdmin(req, res, next);
};

export function adminRouter(
  database: LibraryDatabase,
  worker?: FederationWorker,
  featureFlagService?: FeatureFlagService,
): Router {
  const router = express.Router();

  // ── Moderation Queue ──

  /**
   * GET /api/v1/admin/moderation/queue
   * Retrieves reported posts and targets pending review
   */
  router.get("/admin/moderation/queue", adminAuth, (req: Request, res: Response) => {
    try {
      const status = req.query["status"] as string | undefined;
      const limit = Math.min(100, Math.max(1, parseInt(req.query["limit"] as string, 10) || 50));
      const offset = Math.max(0, parseInt(req.query["offset"] as string, 10) || 0);

      const reports = database.getModerationQueue(status, limit, offset);
      res.json({ reports, count: reports.length, limit, offset });
    } catch (err: unknown) {
      console.error("[AdminRouter] GET /admin/moderation/queue error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch moderation queue" });
    }
  });

  /**
   * POST /api/v1/admin/moderation/reports/:id/resolve
   * Resolves a report and optionally applies actions (delete post, silence domain, suspend domain)
   */
  router.post("/admin/moderation/reports/:id/resolve", adminAuth, express.json(), (req: Request, res: Response) => {
    const reportId = Number(req.params["id"]);
    const { status, resolutionNotes, action } = req.body;

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

      // Execute moderation action if specified
      if (action === "delete_post" && report.post_id) {
        const deleteResult = database.deletePost(report.post_id);
        if (deleteResult.apId) {
          tombstoneActivity = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: `${deleteResult.apId}#delete`,
            type: "Delete",
            actor: `${process.env["PUBLIC_URL"] || "https://hub.modelscript.org"}/actor`,
            object: deleteResult.apId,
          };
        }
      }

      database.resolveContentReport(reportId, status, resolutionNotes);

      database.logAudit({
        actorId: req.user?.id || null,
        action: `report_${status}`,
        resourceType: "content_report",
        resourceId: String(reportId),
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
        details: { status, resolutionNotes, action, postId: report.post_id },
      });

      res.json({
        success: true,
        reportId,
        status,
        actionExecuted: action || "none",
        tombstoneActivity,
      });
    } catch (err: unknown) {
      console.error("[AdminRouter] Resolve report error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to resolve report" });
    }
  });

  // ── Federation Domain Tiering ──

  /**
   * GET /api/v1/admin/federation/domains
   * Lists all federation domain rules and tiers
   */
  router.get("/admin/federation/domains", adminAuth, (_req: Request, res: Response) => {
    try {
      const domains = database.listFederationDomains();
      res.json({ domains, count: domains.length });
    } catch (err: unknown) {
      console.error("[AdminRouter] GET /admin/federation/domains error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list federation domains" });
    }
  });

  /**
   * POST /api/v1/admin/federation/domains
   * Set domain tier (allow, silence, suspend)
   */
  router.post("/admin/federation/domains", adminAuth, express.json(), (req: Request, res: Response) => {
    const { domain, tier, reason } = req.body;

    if (!domain || typeof domain !== "string") {
      res.status(400).json({ error: "Valid domain is required" });
      return;
    }

    if (!["allow", "silence", "suspend"].includes(tier)) {
      res.status(400).json({ error: "Tier must be 'allow', 'silence', or 'suspend'" });
      return;
    }

    try {
      database.setDomainTier(domain, tier, reason);

      database.logAudit({
        actorId: req.user?.id || null,
        action: `federation_tier_${tier}`,
        resourceType: "domain",
        resourceId: domain.toLowerCase(),
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
        details: { domain, tier, reason },
      });

      res.status(201).json({
        success: true,
        domain: domain.toLowerCase(),
        tier,
        reason,
      });
    } catch (err: unknown) {
      console.error("[AdminRouter] Set domain tier error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to set domain tier" });
    }
  });

  /**
   * DELETE /api/v1/admin/federation/domains/:domain
   * Remove domain override rule (defaults back to allow)
   */
  router.delete("/admin/federation/domains/:domain", adminAuth, (req: Request, res: Response) => {
    const domain = req.params["domain"] as string;
    try {
      database.deleteDomainTier(domain);

      database.logAudit({
        actorId: req.user?.id || null,
        action: "federation_tier_removed",
        resourceType: "domain",
        resourceId: domain.toLowerCase(),
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
      });

      res.json({ success: true, domain: domain.toLowerCase() });
    } catch (err: unknown) {
      console.error("[AdminRouter] Delete domain tier error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete domain tier" });
    }
  });

  // ── Post Management & Tombstone Propagation ──

  /**
   * DELETE /api/v1/admin/posts/:id
   * Admin delete of a post with ActivityPub Delete tombstone synthesis
   */
  router.delete("/admin/posts/:id", adminAuth, (req: Request, res: Response) => {
    const postId = Number(req.params["id"]);
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
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
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

  // ── Audit Logs ──

  /**
   * GET /api/v1/admin/audit-logs
   */
  router.get("/admin/audit-logs", adminAuth, (req: Request, res: Response) => {
    try {
      const action = req.query["action"] as string | undefined;
      const limit = Math.min(100, Math.max(1, parseInt(req.query["limit"] as string, 10) || 50));
      const offset = Math.max(0, parseInt(req.query["offset"] as string, 10) || 0);

      const logs = database.getAuditLogs(limit, offset, action);
      res.json({ logs, count: logs.length, limit, offset });
    } catch (err: unknown) {
      console.error("[AdminRouter] GET /admin/audit-logs error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch audit logs" });
    }
  });

  // ── DMCA Notices ──

  /**
   * POST /api/v1/admin/dmca/notices
   * Public intake for DMCA takedown requests
   */
  router.post("/admin/dmca/notices", express.json(), (req: Request, res: Response) => {
    const { claimantName, claimantEmail, copyrightOwner, workDescription, infringingUrl, resourceType, resourceId } =
      req.body;

    if (!claimantName || !claimantEmail || !copyrightOwner || !workDescription || !infringingUrl) {
      res.status(400).json({
        error:
          "Missing required DMCA fields (claimantName, claimantEmail, copyrightOwner, workDescription, infringingUrl)",
      });
      return;
    }

    try {
      const notice = database.createDmcaNotice({
        claimantName,
        claimantEmail,
        copyrightOwner,
        workDescription,
        infringingUrl,
        resourceType,
        resourceId,
      });

      database.logAudit({
        actorId: null,
        action: "dmca_notice_filed",
        resourceType: resourceType || "package",
        resourceId: resourceId || null,
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
        details: { noticeId: notice.id, infringingUrl },
      });

      res.status(201).json({
        success: true,
        noticeId: notice.id,
        message: "DMCA takedown notice received and queued for statutory processing.",
      });
    } catch (err: unknown) {
      console.error("[AdminRouter] File DMCA notice error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to file DMCA notice" });
    }
  });

  /**
   * GET /api/v1/admin/dmca/notices
   */
  router.get("/admin/dmca/notices", adminAuth, (req: Request, res: Response) => {
    try {
      const status = req.query["status"] as string | undefined;
      const notices = database.listDmcaNotices(status);
      res.json({ notices, count: notices.length });
    } catch (err: unknown) {
      console.error("[AdminRouter] GET /admin/dmca/notices error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list DMCA notices" });
    }
  });

  /**
   * POST /api/v1/admin/dmca/notices/:id/resolve
   */
  router.post("/admin/dmca/notices/:id/resolve", adminAuth, express.json(), (req: Request, res: Response) => {
    const id = Number(req.params["id"]);
    const { actionTaken } = req.body;

    if (!actionTaken || typeof actionTaken !== "string") {
      res.status(400).json({ error: "actionTaken is required" });
      return;
    }

    try {
      const success = database.resolveDmcaNotice(id, actionTaken);
      if (!success) {
        res.status(404).json({ error: "DMCA notice not found" });
        return;
      }

      database.logAudit({
        actorId: req.user?.id || null,
        action: "dmca_notice_resolved",
        resourceType: "dmca_notice",
        resourceId: String(id),
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
        details: { actionTaken },
      });

      res.json({ success: true, noticeId: id, actionTaken });
    } catch (err: unknown) {
      console.error("[AdminRouter] Resolve DMCA notice error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to resolve DMCA notice" });
    }
  });

  // ── Database Operations & Migration Management ──

  /**
   * GET /api/v1/admin/db/status
   */
  router.get("/admin/db/status", adminAuth, (_req: Request, res: Response) => {
    try {
      const runner = database.migrationRunner;
      const status = runner.getStatus(allMigrations);
      res.json(status);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch migration status" });
    }
  });

  /**
   * POST /api/v1/admin/db/upgrade
   */
  router.post("/admin/db/upgrade", adminAuth, express.json(), async (req: Request, res: Response) => {
    try {
      const dryRun = Boolean(req.body.dryRun);
      const skipBackup = Boolean(req.body.skipBackup);
      const runner = database.migrationRunner;
      const result = await runner.runPending(allMigrations, { dryRun, skipBackup });
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to execute database upgrade" });
    }
  });

  /**
   * GET /api/v1/admin/db/verify
   */
  router.get("/admin/db/verify", adminAuth, (_req: Request, res: Response) => {
    try {
      const runner = database.migrationRunner;
      const check = runner.verifyIntegrity();
      res.json(check);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to verify database integrity" });
    }
  });

  // ── Feature Flag Switchboard ──

  /**
   * GET /api/v1/admin/flags
   * Lists all feature flags with current database, environment, and computed state
   */
  router.get("/admin/flags", adminAuth, (_req: Request, res: Response) => {
    try {
      if (!featureFlagService) {
        res.status(503).json({ error: "FeatureFlagService not initialized" });
        return;
      }
      const flags = featureFlagService.listAllForAdmin();
      res.json({ flags });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch feature flags" });
    }
  });

  /**
   * PATCH /api/v1/admin/flags/:key
   * Toggles or updates a feature flag
   */
  router.patch("/admin/flags/:key", adminAuth, express.json(), (req: Request, res: Response) => {
    try {
      if (!featureFlagService) {
        res.status(503).json({ error: "FeatureFlagService not initialized" });
        return;
      }
      const key = req.params["key"] as string;
      const { isEnabled, allowedRoles, rolloutPercentage } = req.body;

      if (typeof isEnabled !== "boolean") {
        res.status(400).json({ error: "isEnabled must be a boolean" });
        return;
      }

      featureFlagService.setFlag(key, isEnabled, allowedRoles, rolloutPercentage ?? 100);

      database.logAudit({
        actorId: req.user?.id || null,
        action: "update_feature_flag",
        resourceType: "feature_flag",
        resourceId: key,
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
        details: { key, isEnabled, allowedRoles, rolloutPercentage },
      });

      res.json({ success: true, key, isEnabled });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update feature flag" });
    }
  });

  // ── Unified First-Party Page View Analytics (Web App & Docs) ──

  /**
   * POST /api/v1/analytics/pageview
   * Public intake for privacy-preserving first-party page view beacons from apps/web and apps/docs.
   * Resolves country/region in memory and immediately scrubs raw IP addresses.
   */
  router.post(
    "/analytics/pageview",
    express.text({ type: ["application/json", "text/plain"], limit: "8kb" }),
    (req: Request, res: Response) => {
      try {
        const ua = req.headers["user-agent"] as string | undefined;
        if (locationService.isBotUserAgent(ua)) {
          res.status(202).json({ success: true, counted: false, ignored: "bot" });
          return;
        }

        let body: Record<string, unknown> = {};
        if (typeof req.body === "string" && req.body.trim()) {
          try {
            body = JSON.parse(req.body) as Record<string, unknown>;
          } catch {
            body = { path: req.body.trim() };
          }
        } else if (req.body && typeof req.body === "object") {
          body = req.body as Record<string, unknown>;
        }

        const rawPath = typeof body["path"] === "string" && body["path"].trim() ? body["path"].trim() : "/";
        const cleanPath = rawPath.split("?")[0]?.split("#")[0] || "/";
        const docsPrefixRe =
          /^\/(docs|guide|architecture|algorithms|cli|languages|reference|industries|pricing)(\/|$)/i;
        const surface: "web" | "docs" =
          body["surface"] === "docs" || (body["surface"] !== "web" && docsPrefixRe.test(cleanPath)) ? "docs" : "web";

        const isUniqueVisitor = locationService.checkAndMarkUniqueHit(req, `page:${surface}:${cleanPath}`);
        const { countryCode, regionCode } = locationService.resolveRequestGeo(req);

        database.recordPageView({
          surface,
          path: cleanPath,
          isUniqueVisitor,
          countryCode,
          regionCode,
        });

        res.status(202).json({
          success: true,
          counted: true,
          surface,
          path: cleanPath,
          isUnique: isUniqueVisitor,
          isUniqueVisitor,
        });
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to record page view" });
      }
    },
  );

  /**
   * GET /api/v1/admin/analytics
   * Retrieves aggregated first-party page view analytics, top pages, and scrubbed geographic heatmaps
   */
  router.get("/admin/analytics", adminAuth, (req: Request, res: Response) => {
    try {
      const days = Math.min(365, Math.max(1, parseInt(req.query["days"] as string, 10) || 30));
      const rawSurface = req.query["surface"] as string | undefined;
      const surface = rawSurface === "web" || rawSurface === "docs" ? rawSurface : undefined;

      const summary = database.getPageAnalyticsSummary(days, surface);
      const geoipConfigured = locationService.isReady();
      res.json({
        ...summary,
        days,
        surface: surface || "all",
        geoipConfigured,
        geolocation: {
          dbLoaded: geoipConfigured,
          fallbackActive: true,
        },
        totals: {
          totalViews: summary.totalViews,
          uniqueViews: summary.uniqueVisitors,
          webViews: summary.webViews,
          docsViews: summary.docsViews,
          totalPostViews: summary.postViewsTotal,
          totalPackageDownloads: summary.packageDownloadsTotal,
        },
        dailySeries: summary.daily.map((d) => ({
          day: d.date,
          views: d.views,
          uniqueViews: d.uniqueVisitors,
        })),
        topPages: summary.topPages.map((p) => ({
          ...p,
          uniqueViews: p.uniqueVisitors,
        })),
        countryBreakdown: summary.locationStats.map((c) => ({
          countryCode: c.country,
          views: c.views,
        })),
        regionBreakdown: summary.regionStats.map((r) => ({
          countryCode: r.country,
          region: r.region,
          views: r.views,
        })),
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch analytics summary" });
    }
  });

  /**
   * POST /api/v1/admin/analytics/prune
   * Prunes aggregated page view records older than `retainDays`
   */
  router.post("/admin/analytics/prune", adminAuth, express.json(), (req: Request, res: Response) => {
    try {
      const rawRetain = req.body?.retainDays ?? req.query["retainDays"];
      const retainDays = rawRetain !== undefined ? Math.max(0, parseInt(String(rawRetain), 10) || 0) : 90;

      const result = database.prunePageAnalytics(retainDays);

      database.logAudit({
        actorId: req.user?.id || null,
        action: "analytics_pruned",
        resourceType: "page_analytics",
        resourceId: `${retainDays}d`,
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
        details: { retainDays, ...result },
      });

      res.json({
        success: true,
        retainDays,
        ...result,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to prune analytics" });
    }
  });

  // ── Hot SQLite WAL Snapshot Backups (Appliance Disaster Recovery) ──

  /**
   * POST /api/v1/admin/backup
   * Performs an online consistent SQLite WAL snapshot backup via VACUUM INTO
   */
  router.post("/admin/backup", adminAuth, express.json(), (req: Request, res: Response) => {
    try {
      const label = typeof req.body?.label === "string" ? req.body.label : undefined;
      const backup = database.createHotBackup(label);

      database.logAudit({
        actorId: req.user?.id || null,
        action: "database_hot_backup_created",
        resourceType: "database",
        resourceId: backup.fileName,
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
        details: backup,
      });

      res.status(201).json({
        success: true,
        backup,
      });
    } catch (err: unknown) {
      console.error("[AdminRouter] POST /admin/backup error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create hot database backup" });
    }
  });

  /**
   * GET /api/v1/admin/backups
   * Lists available online SQLite backups stored in the appliance data volume
   */
  router.get("/admin/backups", adminAuth, (_req: Request, res: Response) => {
    try {
      const backups = database.listBackups();
      res.json({ backups, count: backups.length });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list database backups" });
    }
  });

  return router;
}
