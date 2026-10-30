// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LibraryDatabase } from "../src/database.js";
import type { Migration } from "../src/migrations/types.js";

test("Database Migration Runner Lifecycle & Safety", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-migration-test-"));
  const db = new LibraryDatabase(tmpDir);

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test("records baseline migration in _modelscript_migrations ledger", () => {
    const runner = db.migrationRunner;
    const applied = runner.getApplied();
    assert.ok(applied.length >= 1, "Expected at least 1 applied migration");
    assert.equal(applied[0]!.name, "0001_baseline_schema");
    assert.ok(applied[0]!.execution_ms >= 0);
  });

  await t.test("getStatus identifies applied and pending migrations", () => {
    const runner = db.migrationRunner;
    const initialApplied = runner.getApplied();
    const customMigration: Migration = {
      id: "9999_test_feature",
      name: "9999_test_feature",
      up(ctx) {
        ctx.execute("CREATE TABLE IF NOT EXISTS test_items (id INTEGER PRIMARY KEY, title TEXT);");
      },
    };

    const status = runner.getStatus([
      { id: "0001_baseline", name: "0001_baseline_schema", up: () => {} },
      customMigration,
    ]);

    assert.equal(status.applied.length, initialApplied.length);
    assert.equal(status.pending.length, 1);
    assert.equal(status.pending[0]!.name, "9999_test_feature");
  });

  await t.test("applies pending migration within a transaction and updates ledger", async () => {
    const runner = db.migrationRunner;
    const initialApplied = runner.getApplied();
    const customMigration: Migration = {
      id: "9999_test_feature",
      name: "9999_test_feature",
      up(ctx) {
        ctx.execute("CREATE TABLE IF NOT EXISTS test_items (id INTEGER PRIMARY KEY, title TEXT);");
      },
    };

    const result = await runner.runPending([customMigration], { skipBackup: true });
    assert.equal(result.appliedCount, 1);

    const applied = runner.getApplied();
    assert.equal(applied.length, initialApplied.length + 1);
    assert.equal(applied[applied.length - 1]!.name, "9999_test_feature");

    // Verify table exists
    const row = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_items'").get();
    assert.ok(row, "Table test_items should exist");
  });

  await t.test("creates pre-flight backup snapshot on migration", async () => {
    const runner = db.migrationRunner;
    const backupPath = await runner.createBackup();
    assert.ok(backupPath, "Expected backup path to be returned");
    assert.ok(fs.existsSync(backupPath), "Backup file must physically exist");

    // Clean up test backup
    fs.unlinkSync(backupPath);
  });

  await t.test("rolls back transaction on migration failure without recording in ledger", async () => {
    const runner = db.migrationRunner;
    const failingMigration: Migration = {
      id: "0003_failing_migration",
      name: "0003_failing_migration",
      up(ctx) {
        ctx.execute("CREATE TABLE partial_table (id INTEGER);");
        // Syntax error to trigger failure
        ctx.execute("INVALID SQL STATEMENT THAT FAILS;");
      },
    };

    await assert.rejects(async () => {
      await runner.runPending([failingMigration], { skipBackup: true, silent: true });
    }, /syntax error/i);

    // Ensure partial_table was rolled back
    const row = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='partial_table'").get();
    assert.equal(row, undefined, "Table created in failing transaction should be rolled back");

    // Ensure not recorded in ledger
    const applied = runner.getApplied();
    const recorded = applied.find((m) => m.name === "0003_failing_migration");
    assert.equal(recorded, undefined, "Failing migration must not be recorded in ledger");
  });

  await t.test("verifyIntegrity confirms foreign keys and structural validity", () => {
    const runner = db.migrationRunner;
    const check = runner.verifyIntegrity();
    assert.equal(check.foreignKeysOk, true);
    assert.equal(check.integrityOk, true);
  });

  await t.test("recreateTable safely migrates table data to new schema with column mapping", async () => {
    const runner = db.migrationRunner;
    const recreateMigration: Migration = {
      id: "9998_recreate_test",
      name: "9998_recreate_test",
      up(ctx) {
        ctx.execute("CREATE TABLE legacy_devices (id INTEGER PRIMARY KEY, serial TEXT, legacy_notes TEXT);");
        ctx.execute("INSERT INTO legacy_devices (id, serial, legacy_notes) VALUES (1, 'SN-001', 'Initial batch');");
        ctx.recreateTable({
          table: "legacy_devices",
          newSchemaSql: `CREATE TABLE legacy_devices (
            id INTEGER PRIMARY KEY,
            serial_number TEXT NOT NULL,
            description TEXT DEFAULT 'Migrated',
            status TEXT DEFAULT 'active'
          );`,
          columnMapping: {
            serial: "serial_number",
            legacy_notes: "description",
          },
        });
      },
      down(ctx) {
        ctx.execute("DROP TABLE IF EXISTS legacy_devices;");
      },
    };

    const res = await runner.runPending([recreateMigration], { skipBackup: true });
    assert.equal(res.appliedCount, 1);

    const migrated = db.db.prepare("SELECT * FROM legacy_devices WHERE id = 1").get() as {
      id: number;
      serial_number: string;
      description: string;
      status: string;
    };
    assert.ok(migrated, "Row should exist in recreated table");
    assert.equal(migrated.serial_number, "SN-001");
    assert.equal(migrated.description, "Initial batch");
    assert.equal(migrated.status, "active");
  });

  await t.test("archiveTable snapshots data to archive table and drops original", async () => {
    const runner = db.migrationRunner;
    const archiveMigration: Migration = {
      id: "9997_archive_test",
      name: "9997_archive_test",
      up(ctx) {
        ctx.execute("CREATE TABLE obsolete_logs (id INTEGER PRIMARY KEY, message TEXT);");
        ctx.execute("INSERT INTO obsolete_logs (message) VALUES ('log entry 1'), ('log entry 2');");
        const archiveRes = ctx.archiveTable({
          table: "obsolete_logs",
          archiveName: "_archived_test_obsolete_logs",
        });
        assert.equal(archiveRes.rowCount, 2);
        assert.equal(archiveRes.archiveTable, "_archived_test_obsolete_logs");
      },
      down(ctx) {
        ctx.execute("DROP TABLE IF EXISTS _archived_test_obsolete_logs;");
      },
    };

    await runner.runPending([archiveMigration], { skipBackup: true });

    // Original table should be dropped
    const orig = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='obsolete_logs'").get();
    assert.equal(orig, undefined, "Original table should be dropped");

    // Archive table should exist with rows preserved
    const archivedRows = db.db.prepare("SELECT * FROM _archived_test_obsolete_logs ORDER BY id ASC").all();
    assert.equal(archivedRows.length, 2);
  });

  await t.test("rollbackLast and migrateDown roll back applied migrations and update ledger", async () => {
    const runner = db.migrationRunner;
    const testMig1: Migration = {
      id: "9996_roll_one",
      name: "9996_roll_one",
      up(ctx) {
        ctx.execute("CREATE TABLE roll_one (id INTEGER PRIMARY KEY);");
      },
      down(ctx) {
        ctx.execute("DROP TABLE IF EXISTS roll_one;");
      },
    };
    const testMig2: Migration = {
      id: "9995_roll_two",
      name: "9995_roll_two",
      up(ctx) {
        ctx.execute("CREATE TABLE roll_two (id INTEGER PRIMARY KEY);");
      },
      down(ctx) {
        ctx.execute("DROP TABLE IF EXISTS roll_two;");
      },
    };

    await runner.runPending([testMig1, testMig2], { skipBackup: true });
    assert.ok(db.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='roll_two'").get());

    // Rollback last
    const rollResult = await runner.rollbackLast([testMig1, testMig2], { skipBackup: true });
    assert.equal(rollResult.rolledBack, "9995_roll_two");
    assert.equal(db.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='roll_two'").get(), undefined);

    // Rollback remaining
    const rollResult2 = await runner.rollbackLast([testMig1, testMig2], { skipBackup: true });
    assert.equal(rollResult2.rolledBack, "9996_roll_one");
    assert.equal(db.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='roll_one'").get(), undefined);
  });

  await t.test("bidirectional migration matrix: migrate down to baseline and back up without drift", async () => {
    const { allMigrations } = await import("../src/migrations/index.js");
    const freshTmp = fs.mkdtempSync(path.join(os.tmpdir(), "ms-bidirectional-test-"));
    const freshDb = new LibraryDatabase(freshTmp);

    try {
      const runner = freshDb.migrationRunner;

      // Rollback all migrations down to baseline (0001_baseline_schema)
      let downResult;
      try {
        downResult = runner.migrateDownSync("0001_baseline_schema", allMigrations, { silent: true });
      } catch (err) {
        console.error("MIGRATE DOWN ERROR:", err);
        throw err;
      }
      assert.ok(downResult.rolledBackCount >= 19, "Expected to rollback all subsequent migrations down to baseline");

      const statusAfterDown = runner.getStatus(allMigrations);
      assert.equal(statusAfterDown.currentVersion, "0001_baseline_schema");
      assert.equal(statusAfterDown.applied.length, 1);

      // Re-apply all pending migrations up to HEAD
      let upResult;
      try {
        upResult = await runner.runPending(allMigrations, { skipBackup: true, silent: true });
      } catch (err) {
        console.error("MIGRATE UP ERROR:", err);
        throw err;
      }
      assert.equal(upResult.appliedCount, downResult.rolledBackCount);

      const statusAfterUp = runner.getStatus(allMigrations);
      assert.equal(statusAfterUp.pendingCount, 0);
      assert.equal(statusAfterUp.currentVersion, allMigrations[allMigrations.length - 1]!.name);

      // Physical & relational integrity check
      const check = runner.verifyIntegrity();
      assert.equal(check.foreignKeysOk, true);
      assert.equal(check.integrityOk, true);
    } finally {
      try {
        freshDb.db.close();
        fs.rmSync(freshTmp, { recursive: true, force: true });
      } catch {}
    }
  });
});
