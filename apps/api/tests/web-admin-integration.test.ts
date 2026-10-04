// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";

test("Web Admin UI Integration & Client API Verification", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-admin-test-"));
  const db = new LibraryDatabase(path.join(tmpDir, "db"));
  const storage = new LibraryStorage(path.join(tmpDir, "storage"));
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      if (app.locals.decayWorkerInterval) clearInterval(app.locals.decayWorkerInterval);
      if (app.locals.rssWorkerInterval) clearInterval(app.locals.rssWorkerInterval);
      if (app.locals.logPurgeInterval) clearInterval(app.locals.logPurgeInterval);
      if (app.locals.federationWorker) app.locals.federationWorker.stop();
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // 1. Create standard user and admin user
  const regularUser = db.createUser("standard_user", "standard@modelscript.test", "hash123", {
    accountType: "user",
    emailVerified: true,
  });
  const regularToken = jwt.sign(
    { id: regularUser.id, username: regularUser.username, email: regularUser.email, accountType: "user" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  const adminUser = db.createUser("super_admin", "admin@modelscript.test", "hash456", {
    accountType: "admin",
    emailVerified: true,
  });
  const adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, email: adminUser.email, accountType: "admin" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  await t.test("Auth Profile (/api/v1/auth/me) returns account_type for client RBAC", async () => {
    // Regular user
    const resReg = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${regularToken}`).expect(200);
    assert.strictEqual(resReg.body.user.account_type, "user");

    // Admin user
    const resAdmin = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${adminToken}`).expect(200);
    assert.strictEqual(resAdmin.body.user.account_type, "admin");
  });

  await t.test("Moderation workflow: queue retrieval and report resolution with AP tombstone", async () => {
    // Create an offensive post
    const post = db.createPost(
      regularUser.id,
      "Offensive spam post needing moderation",
      undefined,
      undefined,
      undefined,
      undefined,
      "https://hub.modelscript.org/posts/1001",
    );

    // Report the post
    const report = db.createContentReport(regularUser.id, {
      postId: post.id,
      reason: "Spam and abuse",
    });

    // Fetch moderation queue
    const queueRes = await request(app)
      .get("/api/v1/admin/moderation/queue?status=pending")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(queueRes.body.reports.some((r: any) => r.id === report.id));

    // Resolve report with action delete_post
    const resolveRes = await request(app)
      .post(`/api/v1/admin/moderation/reports/${report.id}/resolve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "resolved",
        action: "delete_post",
        resolutionNotes: "Takedown confirmed and executed via admin console",
      })
      .expect(200);

    assert.strictEqual(resolveRes.body.success, true);
    assert.strictEqual(resolveRes.body.actionExecuted, "delete_post");
    assert.ok(resolveRes.body.tombstoneActivity);
    assert.strictEqual(resolveRes.body.tombstoneActivity.type, "Delete");

    // Verify post is now deleted
    const deletedPost = db.getPost(post.id);
    assert.strictEqual(deletedPost, null);
  });

  await t.test("Federation Domain Management workflow", async () => {
    // Set domain tier to silence
    const setRes = await request(app)
      .post("/api/v1/admin/federation/domains")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        domain: "spammer-node.social",
        tier: "silence",
        reason: "Excessive unsolicited notifications",
      })
      .expect(201);

    assert.strictEqual(setRes.body.domain, "spammer-node.social");
    assert.strictEqual(setRes.body.tier, "silence");

    // List domains
    const listRes = await request(app)
      .get("/api/v1/admin/federation/domains")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(listRes.body.domains.some((d: any) => d.domain === "spammer-node.social" && d.tier === "silence"));

    // Reset domain rule
    const delRes = await request(app)
      .delete("/api/v1/admin/federation/domains/spammer-node.social")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.strictEqual(delRes.body.success, true);
  });

  await t.test("DMCA Notice intake and resolution workflow", async () => {
    // Ingest DMCA notice
    const noticeRes = await request(app)
      .post("/api/v1/admin/dmca/notices")
      .send({
        claimantName: "Jane Copyright",
        claimantEmail: "legal@example.com",
        copyrightOwner: "Acme Corp",
        workDescription: "Proprietary Modelica thermal library",
        infringingUrl: "https://hub.modelscript.org/packages/acme-thermal",
      })
      .expect(201);

    const noticeId = noticeRes.body.noticeId;
    assert.ok(noticeId);

    // List notices
    const listRes = await request(app)
      .get("/api/v1/admin/dmca/notices?status=pending")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(listRes.body.notices.some((n: any) => n.id === noticeId));

    // Resolve notice
    const resolveRes = await request(app)
      .post(`/api/v1/admin/dmca/notices/${noticeId}/resolve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ actionTaken: "Package removed per statutory takedown notice." })
      .expect(200);

    assert.strictEqual(resolveRes.body.success, true);
  });

  await t.test("Database Maintenance API workflow", async () => {
    // Get DB Status
    const statusRes = await request(app)
      .get("/api/v1/admin/db/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(statusRes.body.currentVersion !== undefined);
    assert.ok(Array.isArray(statusRes.body.applied));

    // Verify DB schema integrity
    const verifyRes = await request(app)
      .get("/api/v1/admin/db/verify")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(verifyRes.body.valid === true || (verifyRes.body.foreignKeysOk && verifyRes.body.integrityOk));

    // Dry-run DB upgrade
    const upgradeRes = await request(app)
      .post("/api/v1/admin/db/upgrade")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ dryRun: true })
      .expect(200);

    assert.strictEqual(upgradeRes.body.success, true);
  });

  await t.test("Audit Log records all administrative actions", async () => {
    const logsRes = await request(app)
      .get("/api/v1/admin/audit-logs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(Array.isArray(logsRes.body.logs));
    assert.ok(logsRes.body.logs.length > 0);

    const actions = logsRes.body.logs.map((l: any) => l.action);
    assert.ok(actions.includes("report_resolved"));
    assert.ok(actions.includes("federation_tier_silence"));
    assert.ok(actions.includes("dmca_notice_resolved"));
  });
});
