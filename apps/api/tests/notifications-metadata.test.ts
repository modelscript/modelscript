// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LibraryDatabase } from "../src/database.js";

test("Notifications & Metadata - Schema, Category Filtering, and Hydration", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-notifs-test-"));
  try {
    const db = new LibraryDatabase(tmpDir);

    // Create test user
    const user = db.createUser("alice", "alice@example.com", "hash123", "Alice Engineer");
    assert.ok(user.id);

    // 1. Create engineering notification with rich metadata
    db.createNotification(user.id, user.id, "simulation_completed", null, {
      jobId: "job-101",
      name: "Modelica.Electrical.Analog.Examples.ChuaCircuit",
      domain: "modelica",
      engine: "modelscript",
      duration: "0.84",
      profile: "hpc-cpu-4x",
      status: "completed",
    });

    // 2. Create simulation failure notification with error trace
    db.createNotification(user.id, user.id, "simulation_failed", null, {
      jobId: "job-102",
      name: "Modelica.Fluid.Examples.DrumBoiler",
      domain: "modelica",
      error: "Nonlinear solver failed to converge at t = 12.4s",
      status: "failed",
    });

    // 3. Create package published notification
    db.createNotification(user.id, user.id, "package_published", null, {
      packageName: "@modelica/fluids",
      packageVersion: "2.1.0",
      distTag: "latest",
      totalFiles: 42,
    });

    // 4. Create security advisory notification
    db.createNotification(user.id, user.id, "security_alert", null, {
      packageName: "legacy-pump-calc",
      packageVersion: "0.9.1",
      reason: "High severity CVE-2026-4412 vulnerability detected",
      severity: "critical",
    });

    // 5. Create credit warning notification
    db.createNotification(user.id, user.id, "credit_warning", null, {
      balance: 8.5,
      threshold: 10,
      message: "Compute balance is below 10 credits",
    });

    // Verify all notifications returned by default
    const allNotifs = db.getNotifications(user.id, 20);
    assert.strictEqual(allNotifs.length, 5);

    // Verify metadata hydration
    const simSuccess = allNotifs.find((n) => n.type === "simulation_completed");
    assert.ok(simSuccess);
    assert.strictEqual(typeof simSuccess.metadata, "object");
    assert.strictEqual(simSuccess.metadata.name, "Modelica.Electrical.Analog.Examples.ChuaCircuit");
    assert.strictEqual(simSuccess.metadata.duration, "0.84");

    const simFailed = allNotifs.find((n) => n.type === "simulation_failed");
    assert.ok(simFailed);
    assert.strictEqual(simFailed.metadata.error, "Nonlinear solver failed to converge at t = 12.4s");

    // Verify category filtering
    const engNotifs = db.getNotifications(user.id, 20, "engineering");
    assert.strictEqual(engNotifs.length, 2);
    assert.ok(engNotifs.every((n) => n.type.startsWith("simulation")));

    const pkgNotifs = db.getNotifications(user.id, 20, "packages");
    assert.strictEqual(pkgNotifs.length, 1);
    assert.strictEqual(pkgNotifs[0].type, "package_published");
    assert.strictEqual(pkgNotifs[0].metadata.packageName, "@modelica/fluids");

    const sysNotifs = db.getNotifications(user.id, 20, "system");
    assert.strictEqual(sysNotifs.length, 2);
    assert.ok(sysNotifs.some((n) => n.type === "security_alert"));
    assert.ok(sysNotifs.some((n) => n.type === "credit_warning"));

    // Verify markNotificationsRead with category
    assert.strictEqual(db.getUnreadNotificationCount(user.id), 5);
    db.markNotificationsRead(user.id, "engineering");
    assert.strictEqual(db.getUnreadNotificationCount(user.id), 3);

    // Verify markNotificationsRead globally
    db.markNotificationsRead(user.id);
    assert.strictEqual(db.getUnreadNotificationCount(user.id), 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
