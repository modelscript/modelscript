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

test("Admin RBAC & Privilege Separation Enforcement", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-rbac-test-"));
  const db = new LibraryDatabase(path.join(tmpDir, "db"));
  const storage = new LibraryStorage(path.join(tmpDir, "storage"));
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // Create standard user
  const regularUser = db.createUser("standard_user", "standard@modelscript.test", "hash123", {
    accountType: "user",
    emailVerified: true,
  });
  const regularToken = jwt.sign(
    { id: regularUser.id, username: regularUser.username, email: regularUser.email, accountType: "user" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  // Create admin user
  const adminUser = db.createUser("super_admin", "admin@modelscript.test", "hash456", {
    accountType: "admin",
    emailVerified: true,
  });
  const adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, email: adminUser.email, accountType: "admin" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  await t.test("rejects standard authenticated users with 403 Forbidden on admin moderation queue", async () => {
    const res = await request(app)
      .get("/api/v1/admin/moderation/queue")
      .set("Authorization", `Bearer ${regularToken}`)
      .expect(403);

    assert.ok(res.body.error.includes("Administrator privileges required"));
  });

  await t.test("rejects standard authenticated users with 403 Forbidden on audit logs", async () => {
    const res = await request(app)
      .get("/api/v1/admin/audit-logs")
      .set("Authorization", `Bearer ${regularToken}`)
      .expect(403);

    assert.ok(res.body.error.includes("Administrator privileges required"));
  });

  await t.test("rejects standard authenticated users with 403 Forbidden on domain block actions", async () => {
    const res = await request(app)
      .post("/api/v1/admin/federation/domains")
      .set("Authorization", `Bearer ${regularToken}`)
      .send({ domain: "malicious.org", tier: "suspended" })
      .expect(403);

    assert.ok(res.body.error.includes("Administrator privileges required"));
  });

  await t.test("permits admin token on admin moderation queue", async () => {
    const res = await request(app)
      .get("/api/v1/admin/moderation/queue")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(Array.isArray(res.body.reports));
  });

  await t.test("permits admin token on audit logs query", async () => {
    const res = await request(app)
      .get("/api/v1/admin/audit-logs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(Array.isArray(res.body.logs));
  });

  await t.test("promoted user dynamically acquires admin privileges", async () => {
    // Before promotion, regularUser is 403
    await request(app).get("/api/v1/admin/moderation/queue").set("Authorization", `Bearer ${regularToken}`).expect(403);

    // Promote in database
    db.setUserAccountType(regularUser.id, "admin");

    // Fresh token or token re-evaluated against database
    const res = await request(app)
      .get("/api/v1/admin/moderation/queue")
      .set("Authorization", `Bearer ${regularToken}`)
      .expect(200);

    assert.ok(Array.isArray(res.body.reports));
  });
});
