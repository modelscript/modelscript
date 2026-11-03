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

    // 6. Verify grouped likes and reposts on the same post count as 1 unread notification (Twitter-style)
    const bob = db.createUser("bob", "bob@example.com", "hash123", "Bob");
    const carol = db.createUser("carol", "carol@example.com", "hash123", "Carol");
    const dave = db.createUser("dave", "dave@example.com", "hash123", "Dave");
    const post1 = db.createPost(user.id, "First post");
    const post2 = db.createPost(user.id, "Second post");

    // 3 likes on post1 -> should count as 1 unread notification
    db.createNotification(user.id, bob.id, "like", post1.id);
    db.createNotification(user.id, carol.id, "like", post1.id);
    db.createNotification(user.id, dave.id, "like", post1.id);
    assert.strictEqual(db.getUnreadNotificationCount(user.id), 1);

    // 2 reposts on post1 -> should add 1 more unread group (total 2)
    db.createNotification(user.id, bob.id, "repost", post1.id);
    db.createNotification(user.id, carol.id, "repost", post1.id);
    assert.strictEqual(db.getUnreadNotificationCount(user.id), 2);

    // 2 likes on post2 -> should add 1 more unread group (total 3)
    db.createNotification(user.id, bob.id, "like", post2.id);
    db.createNotification(user.id, carol.id, "like", post2.id);
    assert.strictEqual(db.getUnreadNotificationCount(user.id), 3);

    // 2 replies on post1 -> replies are not grouped, so each counts individually (total 5)
    db.createNotification(user.id, bob.id, "reply", post1.id);
    db.createNotification(user.id, carol.id, "reply", post1.id);
    assert.strictEqual(db.getUnreadNotificationCount(user.id), 5);

    // Marking a single notification ID from the post1 like group marks all likes on post1 as read (total 4)
    const post1LikeNotif = db.getNotifications(user.id, 50).find((n) => n.type === "like" && n.post_id === post1.id);
    assert.ok(post1LikeNotif);
    assert.strictEqual((post1LikeNotif as any).post_author, "alice");
    db.markNotificationsRead(user.id, undefined, [post1LikeNotif.id]);
    assert.strictEqual(db.getUnreadNotificationCount(user.id), 4);

    // 7. Verify unliking removes the actor's like notification and updates unread count
    db.markNotificationsRead(user.id);
    assert.strictEqual(db.getUnreadNotificationCount(user.id), 0);
    const post3 = db.createPost(user.id, "Third post");
    db.toggleLike(bob.id, post3.id);
    assert.strictEqual(db.getUnreadNotificationCount(user.id), 1);
    db.toggleLike(bob.id, post3.id); // unlike
    assert.strictEqual(db.getUnreadNotificationCount(user.id), 0);

    // 8. Verify follow_request and follow_accepted are included in social/mentions category
    db.createNotification(user.id, dave.id, "follow_request");
    db.createNotification(user.id, carol.id, "follow_accepted");
    const socialNotifs = db.getNotifications(user.id, 50, "mentions");
    assert.ok(socialNotifs.some((n) => n.type === "follow_request"));
    assert.ok(socialNotifs.some((n) => n.type === "follow_accepted"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
