// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LibraryDatabase } from "../src/database.js";

test("Multi-DB SQLite Partitioning (analytics.db & audit.db)", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "multi-db-suite-"));
  const dbDir = path.join(tmpDir, "db");
  const db = new LibraryDatabase(dbDir);

  t.after(() => {
    try {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  await t.test("1. Initializes audit.db and analytics.db alongside main modelscript.db", () => {
    assert.strictEqual(db.isMultiDb, true);
    assert.ok(db.auditDb, "Expected auditDb instance to be defined");
    assert.ok(db.analyticsDb, "Expected analyticsDb instance to be defined");

    const mainDbFile = path.join(dbDir, "modelscript.db");
    const auditDbFile = path.join(dbDir, "audit.db");
    const analyticsDbFile = path.join(dbDir, "analytics.db");

    assert.ok(fs.existsSync(mainDbFile), `Main database should exist at ${mainDbFile}`);
    assert.ok(fs.existsSync(auditDbFile), `Audit database should exist at ${auditDbFile}`);
    assert.ok(fs.existsSync(analyticsDbFile), `Analytics database should exist at ${analyticsDbFile}`);

    // Verify WAL mode is configured across all partitions
    const mainJournal = db.db.pragma("journal_mode") as { journal_mode: string }[];
    const auditJournal = db.auditDb!.pragma("journal_mode") as { journal_mode: string }[];
    const analyticsJournal = db.analyticsDb!.pragma("journal_mode") as { journal_mode: string }[];

    assert.strictEqual(mainJournal[0]?.journal_mode, "wal");
    assert.strictEqual(auditJournal[0]?.journal_mode, "wal");
    assert.strictEqual(analyticsJournal[0]?.journal_mode, "wal");
  });

  await t.test("2. Appending audit log writes to audit.db with cryptographic hash chain", () => {
    const user = db.createUser("alice_audit", "alice@example.com", "hash123", { emailVerified: true });

    db.logAudit({
      actorId: user.id,
      action: "user.login",
      resourceType: "user",
      resourceId: String(user.id),
      ipAddress: "203.0.113.10",
      details: { client: "web-ui" },
    });

    db.logAudit({
      actorId: user.id,
      action: "package.publish",
      resourceType: "package",
      resourceId: "Modelica.Test",
      ipAddress: "203.0.113.10",
      details: { version: "1.0.0" },
    });

    // Check direct rows in auditDb
    const auditRows = db.auditDb!.prepare(`SELECT * FROM audit_logs ORDER BY id ASC`).all() as {
      id: number;
      action: string;
      prev_hash: string;
      entry_hash: string;
    }[];

    assert.strictEqual(auditRows.length, 2);
    assert.strictEqual(auditRows[0]!.action, "user.login");
    assert.strictEqual(auditRows[0]!.prev_hash, "GENESIS");
    assert.strictEqual(auditRows[1]!.action, "package.publish");
    assert.strictEqual(auditRows[1]!.prev_hash, auditRows[0]!.entry_hash);

    // Verify chain integrity check
    const chain = db.verifyAuditLogChain();
    assert.strictEqual(chain.valid, true);
    assert.strictEqual(chain.verifiedEntries, 2);
  });

  await t.test("3. Cross-database queries join audit_logs with main users table seamlessly", () => {
    const logs = db.getAuditLogs(10, 0);
    assert.ok(logs.length >= 2);
    const loginLog = logs.find((l) => l.action === "user.login");
    assert.ok(loginLog);
    assert.strictEqual(loginLog.actor_username, "alice_audit");
  });

  await t.test("4. GDPR IP address redaction updates audit.db without locking main db", () => {
    const beforeCount = db.getAuditLogsCount("user.login");
    assert.strictEqual(beforeCount, 1);

    const result = db.purgeExpiredLogs(0); // prune immediately
    assert.ok(result.redactedCount >= 2);

    const row = db.auditDb!.prepare(`SELECT ip_address FROM audit_logs WHERE action = 'user.login'`).get() as {
      ip_address: string;
    };
    assert.ok(row.ip_address.startsWith("REDACTED:"));

    // Hash chain verification still passes after IP tokenization
    const chain = db.verifyAuditLogChain();
    assert.strictEqual(chain.valid, true);
  });

  await t.test("5. AnalyticsBuffer flushes pageviews, downloads, and locations to analytics.db", () => {
    db.analyticsBuffer.recordPageView({
      surface: "web",
      path: "/explore/trending",
      isUniqueVisitor: true,
      countryCode: "US",
      regionCode: "CA",
    });

    db.analyticsBuffer.recordPageView({
      surface: "docs",
      path: "/docs/modelica-glr",
      isUniqueVisitor: true,
      countryCode: "DE",
      regionCode: "BY",
    });

    db.analyticsBuffer.recordPackageDownload("Modelica.Mechanics", "1.0.0");
    db.analyticsBuffer.recordPackageDownload("Modelica.Mechanics", "1.0.0");

    const author = db.createUser("bob_analytics", "bob@example.com", "hash456", { emailVerified: true });
    const post = db.createPost(author.id, "Testing post analytics multi-db");
    db.analyticsBuffer.incrementPostView(post.id, "FR", "IDF");

    // Flush to analytics.db
    db.analyticsBuffer.flushSync();

    // Verify analyticsDb has the records
    const pvRows = db.analyticsDb!.prepare(`SELECT * FROM page_views_daily`).all() as {
      path: string;
      views_count: number;
      unique_visitors: number;
    }[];
    assert.strictEqual(pvRows.length, 2);

    const locRows = db.analyticsDb!.prepare(`SELECT * FROM page_location_stats_daily`).all();
    assert.strictEqual(locRows.length, 2);

    const dlRows = db.analyticsDb!.prepare(`SELECT * FROM package_downloads_daily`).all() as {
      library_name: string;
      downloads_count: number;
    }[];
    assert.strictEqual(dlRows.length, 1);
    assert.strictEqual(dlRows[0]!.downloads_count, 2);

    const postLocRows = db.analyticsDb!.prepare(`SELECT * FROM post_location_stats`).all() as {
      post_id: number | string;
      country_code: string;
      view_count: number;
    }[];
    assert.strictEqual(postLocRows.length, 1);
    assert.strictEqual(String(postLocRows[0]!.post_id), String(post.id));
    assert.strictEqual(postLocRows[0]!.country_code, "FR");

    // Verify main db post view count was incremented
    const updatedPost = db.getPost(post.id);
    assert.strictEqual(updatedPost?.view_count, 1);
  });

  await t.test("6. getPageAnalyticsSummary aggregates data cleanly from analytics.db", () => {
    const summary = db.getPageAnalyticsSummary(30);
    assert.strictEqual(summary.totalViews, 2);
    assert.strictEqual(summary.webViews, 1);
    assert.strictEqual(summary.docsViews, 1);
    assert.strictEqual(summary.uniqueVisitors, 2);
    assert.strictEqual(summary.packageDownloadsTotal, 2);
    assert.strictEqual(summary.postViewsTotal, 1);

    const pkgStats = db.getPackageStats("Modelica.Mechanics", 30);
    assert.strictEqual(pkgStats.totalDownloads, 2);
    assert.strictEqual(pkgStats.versionBreakdown["1.0.0"], 2);

    const postLocs = db.getPostLocationStats(1); // placeholder or actual
    assert.ok(Array.isArray(postLocs));
  });

  await t.test("7. prunePageAnalytics purges expired records in analytics.db", () => {
    const pruned = db.prunePageAnalytics(0); // prune all
    assert.strictEqual(pruned.deletedDailyRows, 2);
    assert.strictEqual(pruned.deletedLocationRows, 2);

    const count = db.analyticsDb!.prepare(`SELECT COUNT(*) as c FROM page_views_daily`).get() as { c: number };
    assert.strictEqual(count.c, 0);
  });

  await t.test("8. Hot backup snapshots main, audit, and analytics databases", () => {
    const backup = db.createHotBackup("partition-test");
    assert.ok(backup.fileName.startsWith("modelscript-backup-"));
    assert.ok(fs.existsSync(backup.backupPath));

    const backupDir = path.join(dbDir, "backups");
    const auditBackupName = backup.fileName.replace("modelscript-backup-", "audit-backup-");
    const analyticsBackupName = backup.fileName.replace("modelscript-backup-", "analytics-backup-");

    const auditBackupPath = path.join(backupDir, auditBackupName);
    const analyticsBackupPath = path.join(backupDir, analyticsBackupName);

    assert.ok(fs.existsSync(auditBackupPath), "Expected audit backup snapshot file to exist");
    assert.ok(fs.existsSync(analyticsBackupPath), "Expected analytics backup snapshot file to exist");
    assert.ok(fs.existsSync(`${auditBackupPath}.sha256`), "Expected audit backup sha256 sidecar");
    assert.ok(fs.existsSync(`${analyticsBackupPath}.sha256`), "Expected analytics backup sha256 sidecar");
  });

  await t.test("9. Monolithic fallback mode when MSX_MULTI_DB=false", () => {
    const monoDir = fs.mkdtempSync(path.join(os.tmpdir(), "mono-db-test-"));
    const prevEnv = process.env["MSX_MULTI_DB"];
    process.env["MSX_MULTI_DB"] = "false";

    try {
      const monoDb = new LibraryDatabase(monoDir);
      assert.strictEqual(monoDb.isMultiDb, false);
      assert.strictEqual(monoDb.auditDb, null);
      assert.strictEqual(monoDb.analyticsDb, null);

      // Writes and reads function normally in single monolithic db
      const u = monoDb.createUser("mono_user", "mono@example.com", "hash", { emailVerified: true });
      monoDb.logAudit({
        actorId: u.id,
        action: "mono.test",
        resourceType: "system",
      });

      const logs = monoDb.getAuditLogs(5, 0);
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0]!.action, "mono.test");

      monoDb.close();
    } finally {
      if (prevEnv === undefined) {
        delete process.env["MSX_MULTI_DB"];
      } else {
        process.env["MSX_MULTI_DB"] = prevEnv;
      }
      fs.rmSync(monoDir, { recursive: true, force: true });
    }
  });
});
