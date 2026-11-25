// SPDX-License-Identifier: AGPL-3.0-or-later

import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { allMigrations } from "../../migrations/index.js";
import { S3StorageDriver } from "../../storage/s3-driver.js";
import { BaseRepository } from "./base.js";

/**
 * Repository encapsulating online SQLite hot backups, SHA-256 verification,
 * S3 backup replication, pruning, uploaded snapshot intake, and atomic table restore.
 */
export class BackupRepository extends BaseRepository {
  #pendingBackupReplications = new Set<Promise<void>>();

  #readOrComputeBackupSha256(backupPath: string): string {
    const sidecarPath = `${backupPath}.sha256`;
    try {
      if (fs.existsSync(sidecarPath)) {
        const cached = fs.readFileSync(sidecarPath, "utf8").trim().split(/\s+/)[0] || "";
        if (/^[a-f0-9]{64}$/i.test(cached)) {
          return cached.toLowerCase();
        }
      }
      const computed = crypto.createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
      try {
        fs.writeFileSync(sidecarPath, computed, "utf8");
      } catch {
        // Ignore if directory is read-only
      }
      return computed;
    } catch {
      return "";
    }
  }

  async waitForPendingBackupReplications(): Promise<void> {
    await Promise.allSettled([...this.#pendingBackupReplications]);
  }

  async #replicateBackupToS3(backupPath: string, shaPath: string): Promise<void> {
    const bucket = process.env["S3_BUCKET"]?.trim();
    if (!bucket) return;
    try {
      const driver = new S3StorageDriver({
        bucket,
        region: process.env["S3_REGION"] || process.env["AWS_REGION"] || "us-east-1",
        endpoint: process.env["S3_ENDPOINT"] || undefined,
        accessKeyId: process.env["S3_ACCESS_KEY_ID"] || process.env["AWS_ACCESS_KEY_ID"] || undefined,
        secretAccessKey: process.env["S3_SECRET_ACCESS_KEY"] || process.env["AWS_SECRET_ACCESS_KEY"] || undefined,
        forcePathStyle: process.env["S3_FORCE_PATH_STYLE"] !== "false",
      });
      const fileName = path.basename(backupPath);
      const dbBuffer = await fs.promises.readFile(backupPath);
      await driver.write(`backups/${fileName}`, dbBuffer, { contentType: "application/x-sqlite3" });
      if (fs.existsSync(shaPath)) {
        const shaBuffer = await fs.promises.readFile(shaPath);
        await driver.write(`backups/${path.basename(shaPath)}`, shaBuffer, { contentType: "text/plain" });
      }
    } catch (err) {
      console.warn(
        "[HotBackup] S3 backup replication failed for %s:",
        path.basename(backupPath),
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  createHotBackup(customLabel?: string): {
    fileName: string;
    backupPath: string;
    sizeBytes: number;
    createdAt: string;
    sha256: string;
  } {
    const backupDir = path.resolve(this.facade.dbDir, "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const safeLabel = customLabel ? `-${customLabel.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32)}` : "";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `modelscript-backup-${timestamp}${safeLabel}.db`;
    const backupPath = path.resolve(backupDir, fileName);
    const rel = path.relative(backupDir, backupPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Invalid backup path");
    }

    // Checkpoint WAL and perform online consistent snapshot using parameterized VACUUM INTO
    const hadTempViews = this.facade.isMultiDb;
    if (hadTempViews) {
      this.facade.dropMultiDbAttachedViews();
    }
    try {
      this.db.prepare("VACUUM INTO ?").run(backupPath);
    } finally {
      if (hadTempViews) {
        try {
          this.facade.setupMultiDbAttached();
        } catch {
          // Best-effort reattach after backup
        }
      }
    }

    const secondaryBackups: Array<{ backupPath: string; shaPath: string }> = [];

    if (this.facade.auditDb) {
      try {
        const auditFileName = path.basename(fileName.replace("modelscript-backup-", "audit-backup-"));
        const auditBackupPath = path.resolve(backupDir, auditFileName);
        const auditRel = path.relative(backupDir, auditBackupPath);
        if (
          auditRel &&
          !auditRel.startsWith("..") &&
          !path.isAbsolute(auditRel) &&
          auditBackupPath.startsWith(backupDir + path.sep)
        ) {
          this.facade.auditDb.prepare("VACUUM INTO ?").run(auditBackupPath);
          const auditSha = crypto.createHash("sha256").update(fs.readFileSync(auditBackupPath)).digest("hex");
          const auditShaPath = `${auditBackupPath}.sha256`;
          if (auditShaPath.startsWith(backupDir + path.sep)) {
            fs.writeFileSync(auditShaPath, auditSha, "utf8");
          }
          secondaryBackups.push({ backupPath: auditBackupPath, shaPath: auditShaPath });
        }
      } catch {
        // Secondary audit DB backup is best-effort
      }
    }

    if (this.facade.analyticsDb) {
      try {
        const analyticsFileName = path.basename(fileName.replace("modelscript-backup-", "analytics-backup-"));
        const analyticsBackupPath = path.resolve(backupDir, analyticsFileName);
        const analyticsRel = path.relative(backupDir, analyticsBackupPath);
        if (
          analyticsRel &&
          !analyticsRel.startsWith("..") &&
          !path.isAbsolute(analyticsRel) &&
          analyticsBackupPath.startsWith(backupDir + path.sep)
        ) {
          this.facade.analyticsDb.prepare("VACUUM INTO ?").run(analyticsBackupPath);
          const analyticsSha = crypto.createHash("sha256").update(fs.readFileSync(analyticsBackupPath)).digest("hex");
          const analyticsShaPath = `${analyticsBackupPath}.sha256`;
          if (analyticsShaPath.startsWith(backupDir + path.sep)) {
            fs.writeFileSync(analyticsShaPath, analyticsSha, "utf8");
          }
          secondaryBackups.push({ backupPath: analyticsBackupPath, shaPath: analyticsShaPath });
        }
      } catch {
        // Secondary analytics DB backup is best-effort
      }
    }

    const stats = fs.statSync(backupPath);
    const sha256 = crypto.createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
    const shaPath = `${backupPath}.sha256`;
    try {
      fs.writeFileSync(shaPath, sha256, "utf8");
    } catch {
      // Ignore sidecar write error
    }

    if (process.env["STORAGE_BACKEND"] === "s3" && process.env["S3_BUCKET"]?.trim()) {
      for (const entry of [{ backupPath, shaPath }, ...secondaryBackups]) {
        const p = this.#replicateBackupToS3(entry.backupPath, entry.shaPath).finally(() => {
          this.#pendingBackupReplications.delete(p);
        });
        this.#pendingBackupReplications.add(p);
      }
    }

    return {
      fileName,
      backupPath,
      sizeBytes: stats.size,
      createdAt: stats.mtime.toISOString(),
      sha256,
    };
  }

  listBackups(): {
    fileName: string;
    backupPath: string;
    sizeBytes: number;
    createdAt: string;
    sha256: string;
  }[] {
    const backupDir = path.join(this.facade.dbDir, "backups");
    if (!fs.existsSync(backupDir)) {
      return [];
    }
    return fs
      .readdirSync(backupDir)
      .filter((name) => name.endsWith(".db"))
      .map((fileName) => {
        const backupPath = path.join(backupDir, fileName);
        const stats = fs.statSync(backupPath);
        const sha256 = this.#readOrComputeBackupSha256(backupPath);
        return {
          fileName,
          backupPath,
          sizeBytes: stats.size,
          createdAt: stats.mtime.toISOString(),
          sha256,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getBackupByFileName(fileName: string): {
    fileName: string;
    backupPath: string;
    sizeBytes: number;
    createdAt: string;
    sha256: string;
  } | null {
    const cleanName = path.basename(fileName.trim());
    if (!cleanName || cleanName !== fileName.trim() || !cleanName.endsWith(".db")) {
      return null;
    }
    const backupDir = path.resolve(this.facade.dbDir, "backups");
    const backupPath = path.resolve(backupDir, cleanName);
    const rel = path.relative(backupDir, backupPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(backupPath)) {
      return null;
    }
    const stats = fs.statSync(backupPath);
    const sha256 = this.#readOrComputeBackupSha256(backupPath);
    return {
      fileName: cleanName,
      backupPath,
      sizeBytes: stats.size,
      createdAt: stats.mtime.toISOString(),
      sha256,
    };
  }

  deleteBackup(fileName: string): boolean {
    const backup = this.getBackupByFileName(fileName);
    if (!backup) return false;
    try {
      fs.unlinkSync(backup.backupPath);
      const sidecarPath = `${backup.backupPath}.sha256`;
      if (fs.existsSync(sidecarPath)) {
        try {
          fs.unlinkSync(sidecarPath);
        } catch {
          // Ignore sidecar unlink error
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  pruneBackups(keepCount: number = 7): { deletedCount: number; deletedFiles: string[] } {
    const safeKeep = Math.max(1, Math.min(100, Math.floor(keepCount)));
    const all = this.listBackups();
    const byPrefix = new Map<string, typeof all>();
    for (const item of all) {
      const prefix = item.fileName.startsWith("audit-")
        ? "audit"
        : item.fileName.startsWith("analytics-")
          ? "analytics"
          : "modelscript";
      const list = byPrefix.get(prefix) ?? [];
      list.push(item);
      byPrefix.set(prefix, list);
    }

    const deletedFiles: string[] = [];
    for (const group of byPrefix.values()) {
      if (group.length <= safeKeep) continue;
      for (const item of group.slice(safeKeep)) {
        if (this.deleteBackup(item.fileName)) {
          deletedFiles.push(item.fileName);
        }
      }
    }
    return { deletedCount: deletedFiles.length, deletedFiles };
  }

  restoreFromBackup(fileName: string): {
    success: boolean;
    restoredFrom: string;
    preRestoreBackup: string;
    tablesRestored: number;
  } {
    const target = this.getBackupByFileName(fileName);
    if (!target) {
      throw new Error(`Backup snapshot '${fileName}' not found.`);
    }

    const siblingRestores: Array<{ db: Database.Database; backup: { fileName: string; backupPath: string } }> = [];
    if (this.facade.isMultiDb && target.fileName.startsWith("modelscript-")) {
      if (this.facade.auditDb && this.facade.auditDb.open) {
        const auditSibling = this.getBackupByFileName(target.fileName.replace(/^modelscript-/, "audit-"));
        if (auditSibling) {
          siblingRestores.push({ db: this.facade.auditDb, backup: auditSibling });
        }
      }
      if (this.facade.analyticsDb && this.facade.analyticsDb.open) {
        const analyticsSibling = this.getBackupByFileName(target.fileName.replace(/^modelscript-/, "analytics-"));
        if (analyticsSibling) {
          siblingRestores.push({ db: this.facade.analyticsDb, backup: analyticsSibling });
        }
      }
    }

    // 1. Verify integrity of the target backup snapshot (and any matching sibling snapshots) before touching live DBs
    const verifySnapshotIntegrity = (snapshotPath: string, snapshotName: string): void => {
      const verifyDb = new Database(snapshotPath, { readonly: true });
      try {
        const check = verifyDb.pragma("integrity_check") as { integrity_check: string }[];
        const isOk = check.length === 1 && check[0]?.integrity_check === "ok";
        if (!isOk) {
          throw new Error(`Backup snapshot '${snapshotName}' failed SQLite integrity_check.`);
        }
      } finally {
        verifyDb.close();
      }
    };
    verifySnapshotIntegrity(target.backupPath, fileName);
    for (const sibling of siblingRestores) {
      verifySnapshotIntegrity(sibling.backup.backupPath, sibling.backup.fileName);
    }

    // 2. Create an automatic pre-restore safety snapshot
    const preRestore = this.createHotBackup("pre-restore");

    // Clear in-memory analytics buffer and cached audit log state before replacing tables
    this.facade.analyticsBuffer?.clear();
    this.facade.instanceAdmin.clearAuditChainCache();

    // 3. Perform online atomic table restoration from the attached backup snapshot(s)
    const restoreDbTables = (db: Database.Database, snapshotPath: string): number => {
      db.pragma("foreign_keys = OFF");
      db.prepare(`ATTACH DATABASE ? AS restore_src`).run(snapshotPath);
      let restoredCount = 0;
      try {
        const mainTables = (
          db.prepare(`SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as {
            name: string;
          }[]
        ).map((r) => r.name);

        const srcTables = new Set(
          (
            db
              .prepare(`SELECT name FROM restore_src.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
              .all() as { name: string }[]
          ).map((r) => r.name),
        );

        const restoreTx = db.transaction(() => {
          for (const table of mainTables) {
            if (!/^[a-zA-Z0-9_]+$/.test(table)) continue;
            // Always clear main table even if it didn't exist in the older backup snapshot
            db.prepare(`DELETE FROM main."${table}"`).run();
            if (!srcTables.has(table)) continue;

            const mainCols = (db.prepare(`PRAGMA main.table_info("${table}")`).all() as { name: string }[]).map(
              (c) => c.name,
            );
            const srcCols = new Set(
              (db.prepare(`PRAGMA restore_src.table_info("${table}")`).all() as { name: string }[]).map((c) => c.name),
            );
            const sharedCols = mainCols.filter((c) => srcCols.has(c) && /^[a-zA-Z0-9_]+$/.test(c));
            if (sharedCols.length === 0) continue;

            const colList = sharedCols.map((c) => `"${c}"`).join(", ");
            db.prepare(`INSERT INTO main."${table}" (${colList}) SELECT ${colList} FROM restore_src."${table}"`).run();
            restoredCount++;
          }
        });
        restoreTx.immediate();
      } finally {
        try {
          db.prepare(`DETACH DATABASE restore_src`).run();
        } catch {
          // Ignore if already detached
        }
        db.pragma("foreign_keys = ON");
      }
      return restoredCount;
    };

    let tablesRestored = restoreDbTables(this.db, target.backupPath);
    for (const sibling of siblingRestores) {
      tablesRestored += restoreDbTables(sibling.db, sibling.backup.backupPath);
    }

    // Re-run any migrations that were not yet applied in the restored snapshot
    this.facade.migrationRunner.runPendingSync(allMigrations, { silent: true, skipBackup: true });
    this.facade.instanceAdmin.clearAuditChainCache();
    this.facade.instanceAdmin.clearInstanceSettingsCache();
    this.facade.invalidateLibraryDiscoveryCache();
    this.facade.clearUserTopicsCache();

    return {
      success: true,
      restoredFrom: target.fileName,
      preRestoreBackup: preRestore.fileName,
      tablesRestored,
    };
  }

  saveUploadedBackup(
    fileBuffer: Buffer,
    customLabel?: string,
    restoreImmediately?: boolean,
  ): {
    backup: {
      fileName: string;
      backupPath: string;
      sizeBytes: number;
      createdAt: string;
      sha256: string;
    };
    restoreResult?: ReturnType<BackupRepository["restoreFromBackup"]> | undefined;
  } {
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length < 100) {
      throw new Error("Uploaded file is empty or too small to be a valid SQLite database.");
    }
    const headerStr = fileBuffer.subarray(0, 16).toString("utf8");
    if (headerStr !== "SQLite format 3\0") {
      throw new Error("Uploaded file does not have a valid SQLite 3 binary header ('SQLite format 3').");
    }

    const backupDir = path.resolve(this.facade.dbDir, "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const cleanLabel = customLabel ? `-${customLabel.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 28)}` : "-uploaded";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `modelscript-backup-${timestamp}${cleanLabel}.db`;
    const backupPath = path.resolve(backupDir, fileName);
    const rel = path.relative(backupDir, backupPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Invalid backup destination path.");
    }

    fs.writeFileSync(backupPath, fileBuffer);

    try {
      const verifyDb = new Database(backupPath, { readonly: true });
      try {
        const check = verifyDb.pragma("integrity_check") as { integrity_check: string }[];
        const isOk = check.length === 1 && check[0]?.integrity_check === "ok";
        if (!isOk) {
          throw new Error("Uploaded SQLite file failed PRAGMA integrity_check.");
        }
      } finally {
        verifyDb.close();
      }
    } catch (err) {
      try {
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      } catch {
        // ignore unlink error
      }
      throw err instanceof Error ? err : new Error("Uploaded SQLite snapshot failed integrity verification.");
    }

    const stats = fs.statSync(backupPath);
    const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    try {
      fs.writeFileSync(`${backupPath}.sha256`, sha256, "utf8");
    } catch {
      // Ignore sidecar write error
    }
    const backup = {
      fileName,
      backupPath,
      sizeBytes: stats.size,
      createdAt: stats.mtime.toISOString(),
      sha256,
    };

    const restoreResult = restoreImmediately ? this.restoreFromBackup(fileName) : undefined;
    return {
      backup,
      restoreResult,
    };
  }
}
