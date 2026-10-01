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
    const customMigration: Migration = {
      id: "0002_test_feature",
      name: "0002_test_feature",
      up(ctx) {
        ctx.execute("CREATE TABLE IF NOT EXISTS test_items (id INTEGER PRIMARY KEY, title TEXT);");
      },
    };

    const status = runner.getStatus([
      { id: "0001_baseline", name: "0001_baseline_schema", up: () => {} },
      customMigration,
    ]);

    assert.equal(status.applied.length, 1);
    assert.equal(status.pending.length, 1);
    assert.equal(status.pending[0]!.name, "0002_test_feature");
  });

  await t.test("applies pending migration within a transaction and updates ledger", async () => {
    const runner = db.migrationRunner;
    const customMigration: Migration = {
      id: "0002_test_feature",
      name: "0002_test_feature",
      up(ctx) {
        ctx.execute("CREATE TABLE IF NOT EXISTS test_items (id INTEGER PRIMARY KEY, title TEXT);");
      },
    };

    const result = await runner.runPending([customMigration], { skipBackup: true });
    assert.equal(result.appliedCount, 1);

    const applied = runner.getApplied();
    assert.equal(applied.length, 2);
    assert.equal(applied[1]!.name, "0002_test_feature");

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
      await runner.runPending([failingMigration], { skipBackup: true });
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
});
