// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Request, type Response, type Router } from "express";
import fs from "node:fs";
import { allMigrations } from "../../migrations/index.js";
import { getClientIp } from "../../util/client-ip.js";
import { adminAuth, type AdminRouteContext } from "./admin-helpers.js";

export function createDatabaseAndBackupsRouter({ database, verifyAdminSudo }: AdminRouteContext): Router {
  const router = express.Router();

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
   * POST /api/v1/admin/db/rollback
   */
  router.post("/admin/db/rollback", adminAuth, express.json(), verifyAdminSudo, async (req: Request, res: Response) => {
    try {
      const skipBackup = Boolean(req.body?.skipBackup);
      const runner = database.migrationRunner;
      const result = await runner.rollbackLast(allMigrations, { skipBackup });
      database.logAudit({
        actorId: req.user?.id || null,
        action: "database_migration_rollback",
        resourceType: "database",
        resourceId: result.rolledBack || "none",
        ipAddress: getClientIp(req),
        details: result,
      });
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to rollback database migration" });
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

  // ── Hot SQLite WAL Snapshot Backups, Restore & Retention ──

  /**
   * POST /api/v1/admin/backup
   * Performs an online consistent SQLite WAL snapshot backup via VACUUM INTO
   */
  router.post(["/admin/backup", "/admin/backups"], adminAuth, express.json(), (req: Request, res: Response) => {
    try {
      const label = typeof req.body?.label === "string" ? req.body.label : undefined;
      const backup = database.createHotBackup(label);

      database.logAudit({
        actorId: req.user?.id || null,
        action: "database_hot_backup_created",
        resourceType: "database",
        resourceId: backup.fileName,
        ipAddress: getClientIp(req),
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

  /**
   * GET /api/v1/admin/backups/:fileName/download
   * Streams a hot SQLite snapshot file with SHA-256 verification header
   */
  router.get("/admin/backups/:fileName/download", adminAuth, (req: Request, res: Response) => {
    try {
      const fileName = req.params["fileName"] as string;
      const backup = database.getBackupByFileName(fileName);
      if (!backup) {
        res.status(404).json({ error: "Backup snapshot not found" });
        return;
      }

      database.logAudit({
        actorId: req.user?.id || null,
        action: "database_backup_downloaded",
        resourceType: "database",
        resourceId: backup.fileName,
        ipAddress: getClientIp(req),
        details: { fileName: backup.fileName, sizeBytes: backup.sizeBytes, sha256: backup.sha256 },
      });

      res.setHeader("Content-Type", "application/vnd.sqlite3");
      res.setHeader("Content-Length", String(backup.sizeBytes));
      res.setHeader("Content-Disposition", `attachment; filename="${backup.fileName}"`);
      res.setHeader("X-Backup-SHA256", backup.sha256);
      const stream = fs.createReadStream(backup.backupPath);
      stream.pipe(res);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to download backup snapshot" });
    }
  });

  /**
   * DELETE /api/v1/admin/backups/:fileName
   * Deletes a specific SQLite backup snapshot
   */
  router.delete("/admin/backups/:fileName", adminAuth, (req: Request, res: Response) => {
    try {
      const fileName = req.params["fileName"] as string;
      const deleted = database.deleteBackup(fileName);
      if (!deleted) {
        res.status(404).json({ error: "Backup snapshot not found" });
        return;
      }

      database.logAudit({
        actorId: req.user?.id || null,
        action: "database_backup_deleted",
        resourceType: "database",
        resourceId: fileName,
        ipAddress: getClientIp(req),
      });

      res.json({ success: true, fileName });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete backup snapshot" });
    }
  });

  /**
   * POST /api/v1/admin/backups/prune
   * Prunes older SQLite backup snapshots, retaining the most recent keepCount snapshots
   */
  router.post("/admin/backups/prune", adminAuth, express.json(), (req: Request, res: Response) => {
    try {
      const settings = database.getInstanceSettings();
      const rawKeep =
        req.body?.keepCount ?? req.body?.keepLatest ?? req.query["keepCount"] ?? settings.backupRetentionCount;
      const keepCount = Math.max(1, parseInt(String(rawKeep), 10) || 7);
      const result = database.pruneBackups(keepCount);

      database.logAudit({
        actorId: req.user?.id || null,
        action: "database_backups_pruned",
        resourceType: "database",
        resourceId: `keep:${keepCount}`,
        ipAddress: getClientIp(req),
        details: { keepCount, ...result },
      });

      res.json({ success: true, keepCount, ...result });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to prune backup snapshots" });
    }
  });

  /**
   * POST /api/v1/admin/backups/:fileName/restore
   * Verifies snapshot integrity, takes an automatic pre-restore backup, and performs an online point-in-time restore
   */
  router.post(
    "/admin/backups/:fileName/restore",
    adminAuth,
    express.json(),
    verifyAdminSudo,
    (req: Request, res: Response) => {
      try {
        const fileName = req.params["fileName"] as string;
        const result = database.restoreFromBackup(fileName);

        database.logAudit({
          actorId: req.user?.id || null,
          action: "database_backup_restored",
          resourceType: "database",
          resourceId: result.restoredFrom,
          ipAddress: getClientIp(req),
          details: result,
        });

        res.json({
          ...result,
          restoredTables: result.tablesRestored,
          preRestoreSnapshot: {
            fileName: result.preRestoreBackup,
            filePath: result.preRestoreBackup,
            sizeBytes: 0,
            createdAt: new Date().toISOString(),
          },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to restore database from backup";
        res.status(msg.includes("not found") ? 404 : 400).json({ error: msg });
      }
    },
  );

  /**
   * POST /api/v1/admin/backups/upload
   * Uploads an external SQLite .db snapshot (base64), verifies PRAGMA integrity_check, stores it in the backup catalog, and optionally restores immediately
   */
  router.post(
    "/admin/backups/upload",
    adminAuth,
    express.json({ limit: "50mb" }),
    verifyAdminSudo,
    (req: Request, res: Response) => {
      try {
        const rawBase64 = typeof req.body?.fileBase64 === "string" ? req.body.fileBase64.trim() : "";
        if (!rawBase64) {
          res.status(400).json({ error: "fileBase64 is required" });
          return;
        }
        const cleanBase64 = rawBase64.includes(",") ? rawBase64.split(",").pop()! : rawBase64;
        const buffer = Buffer.from(cleanBase64, "base64");
        const label = typeof req.body?.label === "string" ? req.body.label : undefined;
        const restoreImmediately = Boolean(req.body?.restoreImmediately);

        const result = database.saveUploadedBackup(buffer, label, restoreImmediately);

        database.logAudit({
          actorId: req.user?.id || null,
          action: restoreImmediately ? "database_backup_uploaded_and_restored" : "database_backup_uploaded",
          resourceType: "database",
          resourceId: result.backup.fileName,
          ipAddress: getClientIp(req),
          details: {
            fileName: result.backup.fileName,
            sizeBytes: result.backup.sizeBytes,
            sha256: result.backup.sha256,
            restoreImmediately,
            tablesRestored: result.restoreResult?.tablesRestored,
          },
        });

        res.status(201).json({
          success: true,
          backup: result.backup,
          restored: Boolean(result.restoreResult),
          restoreResult: result.restoreResult,
        });
      } catch (err: unknown) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Failed to upload and verify SQLite backup snapshot",
        });
      }
    },
  );

  // ── Portable Instance Migration Bundles ──

  /**
   * GET /api/v1/admin/bundle/export
   * Creates an online SQLite snapshot and exports a portable instance migration bundle with SHA-256 manifest
   */
  router.get("/admin/bundle/export", adminAuth, (req: Request, res: Response) => {
    try {
      const bundle = database.exportInstanceBundle();
      database.logAudit({
        actorId: req.user?.id || null,
        action: "instance_bundle_exported",
        resourceType: "database",
        resourceId: bundle.snapshot.fileName,
        ipAddress: getClientIp(req),
        details: {
          snapshotFile: bundle.snapshot.fileName,
          bundleSha256: bundle.bundleSha256,
          federationDomains: bundle.federationDomains.length,
          featureFlags: bundle.featureFlags.length,
        },
      });
      res.json(bundle);
    } catch (err: unknown) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "Failed to export instance migration bundle" });
    }
  });

  /**
   * POST /api/v1/admin/bundle/import
   * Imports an instance migration bundle (settings, federation domain rules, feature flags, quarantined resources)
   */
  router.post("/admin/bundle/import", adminAuth, express.json({ limit: "10mb" }), (req: Request, res: Response) => {
    try {
      const result = database.importInstanceBundle(req.body || {}, req.user?.id || null);
      database.logAudit({
        actorId: req.user?.id || null,
        action: "instance_bundle_imported",
        resourceType: "database",
        resourceId: "bundle",
        ipAddress: getClientIp(req),
        details: result,
      });
      res.json(result);
    } catch (err: unknown) {
      res
        .status(400)
        .json({ error: err instanceof Error ? err.message : "Failed to import instance migration bundle" });
    }
  });

  return router;
}
