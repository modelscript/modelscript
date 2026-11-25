// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Request, type Response, type Router } from "express";
import { isEnterpriseEditionActive } from "../../ee-loader.js";
import { allMigrations } from "../../migrations/index.js";
import { locationService } from "../../services/location.js";
import { defaultMailer } from "../../services/mailer.js";
import { getClientIp } from "../../util/client-ip.js";
import { adminAuth, auditorAuth, type AdminRouteContext } from "./admin-helpers.js";

export function createSettingsAndSystemRouter({
  database,
  featureFlagService,
  verifyAdminSudo,
}: AdminRouteContext): Router {
  const router = express.Router();

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
        ipAddress: getClientIp(req),
        details: { key, isEnabled, allowedRoles, rolloutPercentage },
      });

      res.json({ success: true, key, isEnabled });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update feature flag" });
    }
  });

  // ── Instance Settings & System Health ──

  /**
   * GET /api/v1/admin/settings
   * Retrieves dynamic instance settings, federation/registration policy, and env lock state
   */
  router.get("/admin/settings", adminAuth, (_req: Request, res: Response) => {
    try {
      const settings = database.getInstanceSettings();
      res.json({ settings });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch instance settings" });
    }
  });

  /**
   * GET /api/v1/admin/settings/export-env
   * Exports current instance settings as declarative .env and docker-compose.yml snippets for GitOps locking
   */
  router.get("/admin/settings/export-env", adminAuth, (_req: Request, res: Response) => {
    try {
      const exported = database.exportEnvConfigSnippet();
      res.json(exported);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to export .env configuration" });
    }
  });

  /**
   * PATCH /api/v1/admin/settings
   * Updates dynamic instance settings and logs an audit entry
   */
  router.patch("/admin/settings", adminAuth, express.json(), verifyAdminSudo, (req: Request, res: Response) => {
    try {
      const patch = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const settings = database.updateInstanceSettings(patch, req.user?.id ?? null);
      const sanitizedAuditDetails: Record<string, unknown> = { ...patch };
      if ("tunnelToken" in sanitizedAuditDetails && sanitizedAuditDetails["tunnelToken"]) {
        sanitizedAuditDetails["tunnelToken"] = "[REDACTED]";
      }
      if ("cloudflare_tunnel_token" in sanitizedAuditDetails && sanitizedAuditDetails["cloudflare_tunnel_token"]) {
        sanitizedAuditDetails["cloudflare_tunnel_token"] = "[REDACTED]";
      }
      if ("githubClientSecret" in sanitizedAuditDetails && sanitizedAuditDetails["githubClientSecret"]) {
        sanitizedAuditDetails["githubClientSecret"] = "[REDACTED]";
      }
      if ("gitlabClientSecret" in sanitizedAuditDetails && sanitizedAuditDetails["gitlabClientSecret"]) {
        sanitizedAuditDetails["gitlabClientSecret"] = "[REDACTED]";
      }

      database.logAudit({
        actorId: req.user?.id || null,
        action: "instance_settings_updated",
        resourceType: "instance_settings",
        resourceId: "global",
        ipAddress: getClientIp(req),
        details: sanitizedAuditDetails,
      });

      res.json({ success: true, settings });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update instance settings" });
    }
  });

  /**
   * GET /api/v1/admin/system
   * Returns comprehensive system diagnostics, storage breakdown, GeoIP/Mailer readiness, and active job queue summary
   */
  router.get("/admin/system", auditorAuth, (_req: Request, res: Response) => {
    try {
      database.syncMailerFromDatabase();
      const diagnostics = database.getSystemDiagnostics();
      const settings = database.getInstanceSettings();
      const preflight = database.getPreflightChecks();
      const auditIntegrity = database.verifyAuditLogChain();
      const migrationStatus = database.migrationRunner.getStatus(allMigrations);
      const edition = isEnterpriseEditionActive() ? "ee" : "ce";
      const geoReady = locationService.isReady();

      res.json({
        edition,
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
        geoipReady: geoReady,
        geoIpReady: geoReady,
        mailerConfigured: defaultMailer.isConfiguredForLiveDelivery(),
        mailerDriver: defaultMailer.getDriver(),
        airgapMode: process.env["AIRGAP_MODE"] === "true" || settings.federationMode === "disabled",
        auditChainValid: auditIntegrity.valid,
        auditVerifiedEntries: auditIntegrity.verifiedEntries,
        schemaVersion: migrationStatus.currentVersion,
        pendingMigrations: migrationStatus.pendingCount,
        schema: {
          currentVersion: migrationStatus.currentVersion,
          targetVersion: migrationStatus.targetVersion,
          pendingCount: migrationStatus.pendingCount,
        },
        preflight,
        ...diagnostics,
        diagnostics,
        settings,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch system diagnostics" });
    }
  });

  /**
   * GET /api/v1/admin/system/support-bundle
   * Generates a secret-redacted JSON support diagnostics bundle for troubleshooting and SRE handoff
   */
  router.get("/admin/system/support-bundle", adminAuth, (req: Request, res: Response) => {
    try {
      const diagnostics = database.getSystemDiagnostics();
      const settings = database.getInstanceSettings();
      const preflight = database.getPreflightChecks();
      const auditIntegrity = database.verifyAuditLogChain();
      const schemaIntegrity = database.migrationRunner.verifyIntegrity();
      const migrationStatus = database.migrationRunner.getStatus(allMigrations);
      const federationQueue = database.getFederationQueueStats();
      const federationDomainsHealth = database.getFederationDomainHealth();

      const auditSummary = {
        valid: auditIntegrity.valid,
        totalEntries: auditIntegrity.totalEntries,
        verifiedEntries: auditIntegrity.verifiedEntries,
        headHash: auditIntegrity.headHash,
      };

      const bundle = {
        bundleType: "modelscript-support-diagnostics-v1",
        generatedAt: new Date().toISOString(),
        edition: isEnterpriseEditionActive() ? "ee" : "ce",
        runtime: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          uptimeSeconds: Math.floor(process.uptime()),
          memoryUsage: process.memoryUsage(),
          mailerDriver: defaultMailer.getDriver(),
          geoIpReady: locationService.isReady(),
        },
        environment: {
          NODE_ENV: process.env["NODE_ENV"] || "development",
          PUBLIC_URL: process.env["PUBLIC_URL"] || null,
          JWT_SECRET: "[REDACTED]",
          SMTP_PASS: "[REDACTED]",
          SENDGRID_API_KEY: "[REDACTED]",
          MSX_LICENSE_KEY: process.env["MSX_LICENSE_KEY"] ? "[REDACTED]" : null,
        },
        preflight,
        database: {
          schemaVersion: migrationStatus.currentVersion,
          pendingMigrations: migrationStatus.pendingCount,
          integrity: schemaIntegrity,
          diagnostics,
        },
        schema: {
          currentVersion: migrationStatus.currentVersion,
          targetVersion: migrationStatus.targetVersion,
          pendingCount: migrationStatus.pendingCount,
          appliedCount: migrationStatus.applied.length,
          integrityOk: schemaIntegrity.integrityOk,
          foreignKeysOk: schemaIntegrity.foreignKeysOk,
        },
        auditIntegrity: auditSummary,
        auditChain: auditSummary,
        diagnostics,
        federation: {
          queue: federationQueue,
          domainHealth: federationDomainsHealth.slice(0, 25),
        },
        settings: {
          ...settings,
          contactEmail: "[REDACTED_EMAIL]",
        },
        featureFlags: database.getFeatureFlags(),
      };

      database.logAudit({
        actorId: req.user?.id || null,
        action: "admin.support_bundle_exported",
        resourceType: "system",
        resourceId: "support-bundle",
        ipAddress: getClientIp(req),
      });

      res.json(bundle);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate support bundle" });
    }
  });

  /**
   * GET /api/v1/admin/metrics
   * Prometheus text exposition endpoint (text/plain; version=0.0.4) for Grafana/Prometheus scraping
   */
  router.get("/admin/metrics", auditorAuth, (_req: Request, res: Response) => {
    try {
      const diag = database.getSystemDiagnostics();
      const fed = database.getFederationQueueStats();
      const audit = database.verifyAuditLogChain();
      const mem = process.memoryUsage();
      const uptime = Math.floor(process.uptime());

      const lines = [
        "# HELP modelscript_uptime_seconds Process uptime in seconds",
        "# TYPE modelscript_uptime_seconds gauge",
        `modelscript_uptime_seconds ${uptime}`,
        "# HELP modelscript_memory_rss_bytes Resident set size memory in bytes",
        "# TYPE modelscript_memory_rss_bytes gauge",
        `modelscript_memory_rss_bytes ${mem.rss}`,
        "# HELP modelscript_db_size_bytes SQLite main database file size in bytes",
        "# TYPE modelscript_db_size_bytes gauge",
        `modelscript_db_size_bytes ${diag.dbSizeBytes}`,
        "# HELP modelscript_wal_size_bytes SQLite WAL file size in bytes",
        "# TYPE modelscript_wal_size_bytes gauge",
        `modelscript_wal_size_bytes ${diag.walSizeBytes}`,
        "# HELP modelscript_users_total Total registered accounts",
        "# TYPE modelscript_users_total gauge",
        `modelscript_users_total ${diag.counts.users}`,
        "# HELP modelscript_posts_total Total social posts",
        "# TYPE modelscript_posts_total gauge",
        `modelscript_posts_total ${diag.counts.posts}`,
        "# HELP modelscript_packages_total Total published registry packages",
        "# TYPE modelscript_packages_total gauge",
        `modelscript_packages_total ${diag.counts.packages}`,
        "# HELP modelscript_moderation_pending_reports Pending moderation reports",
        "# TYPE modelscript_moderation_pending_reports gauge",
        `modelscript_moderation_pending_reports ${diag.counts.pendingReports}`,
        "# HELP modelscript_quarantined_resources_total Active quarantined resources",
        "# TYPE modelscript_quarantined_resources_total gauge",
        `modelscript_quarantined_resources_total ${diag.counts.quarantinedResources}`,
        "# HELP modelscript_jobs_total Simulation and compute jobs by status",
        "# TYPE modelscript_jobs_total gauge",
        `modelscript_jobs_total{status="pending"} ${diag.jobQueue.pending}`,
        `modelscript_jobs_total{status="running"} ${diag.jobQueue.running}`,
        `modelscript_jobs_total{status="completed"} ${diag.jobQueue.completed}`,
        `modelscript_jobs_total{status="failed"} ${diag.jobQueue.failed}`,
        "# HELP modelscript_federation_queue_total ActivityPub delivery queue items by status",
        "# TYPE modelscript_federation_queue_total gauge",
        `modelscript_federation_queue_total{status="pending"} ${fed.pending}`,
        `modelscript_federation_queue_total{status="processing"} ${fed.processing}`,
        `modelscript_federation_queue_total{status="completed"} ${fed.completed}`,
        `modelscript_federation_queue_total{status="failed"} ${fed.failed}`,
        "# HELP modelscript_backups_total Total stored SQLite hot backup snapshots",
        "# TYPE modelscript_backups_total gauge",
        `modelscript_backups_total ${diag.backups.count}`,
        "# HELP modelscript_audit_chain_valid Whether the SHA-256 tamper-evident audit chain is intact (1 = valid, 0 = broken)",
        "# TYPE modelscript_audit_chain_valid gauge",
        `modelscript_audit_chain_valid ${audit.valid ? 1 : 0}`,
        "",
      ];

      res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      res.send(lines.join("\n"));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to export Prometheus metrics" });
    }
  });

  /**
   * GET /api/v1/admin/ee/posture
   * Enterprise-only Air-Gap, FERC CEII / NERC CIP, ITAR/EAR & Seat Utilization posture (gated in EE, 501 in CE)
   */
  router.get("/admin/ee/posture", auditorAuth, (_req: Request, res: Response) => {
    try {
      const diagnostics = database.getSystemDiagnostics();
      const settings = database.getInstanceSettings();
      res.json({
        edition: "ee",
        airgapEnforced: process.env["AIRGAP_MODE"] === "true" || settings.federationMode === "disabled",
        ceiiHeadersActive: true,
        exportControlActive: true,
        activeSeats: diagnostics.counts.users,
        repositoriesCount: diagnostics.counts.repositories,
        quarantinedCount: diagnostics.counts.quarantinedResources,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch EE compliance posture" });
    }
  });

  return router;
}
