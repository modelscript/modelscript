// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Request, type Response, type Router } from "express";
import { locationService } from "../../services/location.js";
import { getClientIp } from "../../util/client-ip.js";
import { adminAuth, auditorAuth, type AdminRouteContext } from "./admin-helpers.js";

export function createAnalyticsAndAuditRouter({ database }: AdminRouteContext): Router {
  const router = express.Router();

  // ── Audit Logs ──

  /**
   * GET /api/v1/admin/audit-logs
   */
  router.get("/admin/audit-logs", auditorAuth, (req: Request, res: Response) => {
    try {
      const action = req.query["action"] as string | undefined;
      const resourceType = req.query["resourceType"] as string | undefined;
      const limit = Math.min(200, Math.max(1, parseInt(req.query["limit"] as string, 10) || 50));
      const offset = Math.max(0, parseInt(req.query["offset"] as string, 10) || 0);

      const logs = database.getAuditLogs(limit, offset, action, resourceType);
      const total = database.getAuditLogsCount(action, resourceType);
      res.json({ logs, count: logs.length, total, limit, offset });
    } catch (err: unknown) {
      console.error("[AdminRouter] GET /admin/audit-logs error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch audit logs" });
    }
  });

  /**
   * GET /api/v1/admin/audit-logs/verify
   * Verifies the cryptographic SHA-256 hash chain across audit_logs
   */
  router.get("/admin/audit-logs/verify", auditorAuth, (_req: Request, res: Response) => {
    try {
      const result = database.verifyAuditLogChain();
      res.json(result);
    } catch (err: unknown) {
      console.error("[AdminRouter] GET /admin/audit-logs/verify error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to verify audit log hash chain" });
    }
  });

  /**
   * POST /api/v1/admin/audit-logs/redact-expired
   * Redacts raw IP addresses on audit log entries older than retentionDays while preserving the SHA-256 hash chain
   */
  router.post("/admin/audit-logs/redact-expired", adminAuth, express.json(), (req: Request, res: Response) => {
    try {
      const rawDays = req.body?.retentionDays ?? req.query["retentionDays"];
      const retentionDays = rawDays !== undefined ? Math.max(0, parseInt(String(rawDays), 10) || 0) : 30;
      const result = database.purgeExpiredLogs(retentionDays);
      const verification = database.verifyAuditLogChain();
      res.json({
        success: true,
        retentionDays,
        ...result,
        redactedAuditIps: result.redactedCount,
        chainValid: verification.valid,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to redact expired audit log IPs" });
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
        const cleanPath = (rawPath.split("?")[0]?.split("#")[0] || "/").slice(0, 512);
        const scannerProbeRe =
          /(?:^|\/)\.(?!well-known(?:\/|$))[^/]*|\.(?:php|asp|aspx|jsp|cgi|env|swp|swo|bak|sql|ini|sh)(?:\/|$)|^\/(?:maintenance\.html|wp-admin|wp-login(?:\.php)?|wp-content|wp-includes|xmlrpc\.php|phpmyadmin|pma|adminer)(?:\/|$)/i;
        if (scannerProbeRe.test(cleanPath)) {
          res.status(202).json({ success: true, counted: false, ignored: "scanner_probe" });
          return;
        }
        const docsPrefixRe =
          /^\/(docs|guide|architecture|algorithms|cli|languages|reference|industries|ansatz|pricing)(\/|$)/i;
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
   * POST /api/v1/analytics/client-error
   * Lightweight, privacy-preserving intake for ErrorBoundary / WASM crash beacons from apps/web.
   * Logs bounded structured diagnostics without storing IP addresses or user PII.
   */
  router.post(
    "/analytics/client-error",
    express.text({ type: ["application/json", "text/plain"], limit: "8kb" }),
    (req: Request, res: Response) => {
      try {
        let body: Record<string, unknown> = {};
        if (typeof req.body === "string" && req.body.trim()) {
          body = JSON.parse(req.body) as Record<string, unknown>;
        } else if (req.body && typeof req.body === "object") {
          body = req.body as Record<string, unknown>;
        }

        const report = {
          name: typeof body["name"] === "string" ? body["name"].slice(0, 128) : "Error",
          message: typeof body["message"] === "string" ? body["message"].slice(0, 500) : "Unknown client error",
          path: typeof body["path"] === "string" ? body["path"].slice(0, 256) : "/",
          stack: typeof body["stack"] === "string" ? body["stack"].slice(0, 1500) : undefined,
          componentStack:
            typeof body["componentStack"] === "string" ? body["componentStack"].slice(0, 1000) : undefined,
          ua: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 200) : undefined,
        };
        if (process.env["NODE_ENV"] !== "test") {
          console.error("[ClientError]", JSON.stringify(report));
        }
        res.status(202).json({ success: true, recorded: true });
      } catch {
        res.status(400).json({ error: "Malformed client error report" });
      }
    },
  );

  /**
   * GET /api/v1/admin/analytics
   * Retrieves aggregated first-party page view analytics, top pages, and scrubbed geographic heatmaps
   */
  router.get("/admin/analytics", auditorAuth, (req: Request, res: Response) => {
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
        ipAddress: getClientIp(req),
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

  return router;
}
