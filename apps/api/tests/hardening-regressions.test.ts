// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";

test("Launch Hardening Regression Test Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardening-regressions-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const testUser = db.createUser("hardening_user", "huser@modelscript.test", null, {
    emailVerified: true,
    accountType: "user",
    status: "active",
  });

  function makeUserToken(tokenVersion = 1): string {
    return jwt.sign(
      {
        id: testUser.id,
        username: testUser.username,
        email: testUser.email,
        accountType: "user",
        role: "user",
        tokenVersion,
      },
      JWT_SECRET,
      { expiresIn: "1h" },
    );
  }

  await t.test("1. Pre-buffering auth payload cap rejects oversized auth bodies with 413", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .set("Content-Length", String(300 * 1024))
      .send({ email: "test@example.com", password: "password123" });

    assert.strictEqual(res.status, 413);
    assert.match(res.body.error, /Payload too large/i);
  });

  await t.test("2. Avatar & banner URL scheme validation blocks javascript: and malformed URIs", async () => {
    const token = makeUserToken(testUser.token_version ?? 1);

    const badRes = await request(app).put("/api/v1/auth/account").set("Authorization", `Bearer ${token}`).send({
      avatar_url: "javascript:alert(document.cookie)",
    });

    assert.strictEqual(badRes.status, 400);
    assert.match(badRes.body.error, /Profile URLs must use/i);

    const goodRes = await request(app).put("/api/v1/auth/account").set("Authorization", `Bearer ${token}`).send({
      avatar_url: "https://cdn.example.com/avatar.png",
    });

    assert.strictEqual(goodRes.status, 200);
    assert.strictEqual(goodRes.body.success, true);
  });

  await t.test("3. Session invalidation upon logout increments token_version and invalidates JWT", async () => {
    const currentVersion = db.getUserById(testUser.id)?.token_version ?? 1;
    const initialToken = makeUserToken(currentVersion);

    // Call logout endpoint with current token
    const logoutRes = await request(app).post("/api/v1/auth/logout").set("Authorization", `Bearer ${initialToken}`);

    assert.strictEqual(logoutRes.status, 200);

    // Verify token_version in database was incremented
    const updatedUser = db.getUserById(testUser.id);
    assert.strictEqual(updatedUser?.token_version, currentVersion + 1);

    // Verify calling authenticated route with original token now fails with 401
    const probeRes = await request(app)
      .get("/api/v1/social/notifications")
      .set("Authorization", `Bearer ${initialToken}`);

    assert.strictEqual(probeRes.status, 401);
    assert.match(probeRes.body.error, /Session has expired or was revoked/i);
  });

  await t.test("4. Notification batch size check blocks excessive arrays (>500)", async () => {
    const freshVersion = db.getUserById(testUser.id)?.token_version ?? 1;
    const freshToken = makeUserToken(freshVersion);

    const hugeIds = Array.from({ length: 501 }, (_, i) => i + 1);
    const badRes = await request(app)
      .post("/api/v1/social/notifications/read")
      .set("Authorization", `Bearer ${freshToken}`)
      .send({ ids: hugeIds });

    assert.strictEqual(badRes.status, 400);
    assert.match(badRes.body.error, /Batch size exceeds maximum limit/i);

    const okIds = [1, 2, 3];
    const okRes = await request(app)
      .post("/api/v1/social/notifications/read")
      .set("Authorization", `Bearer ${freshToken}`)
      .send({ ids: okIds });

    assert.strictEqual(okRes.status, 200);
    assert.strictEqual(okRes.body.success, true);
  });

  await t.test("5. Artifact viewer numeric snowflake ID enforcement", async () => {
    const invalidRes = await request(app).get("/api/v1/artifacts/view/slug-name-invalid");
    assert.strictEqual(invalidRes.status, 400);
    assert.strictEqual(invalidRes.body.error, "Invalid artifact ID");

    const nonExistentNumericRes = await request(app).get("/api/v1/artifacts/view/99999999999999999");
    assert.strictEqual(nonExistentNumericRes.status, 404);
  });

  await t.test("6. Wildcard and subdomain domain suspension", async () => {
    db.setDomainTier("spammer-network.test", "suspend", "Spam network");

    assert.strictEqual(db.isDomainSuspended("spammer-network.test"), true);
    assert.strictEqual(db.isDomainSuspended("node1.spammer-network.test"), true);
    assert.strictEqual(db.isDomainSuspended("deep.sub.node1.spammer-network.test"), true);
    assert.strictEqual(db.isDomainAllowedForFederation("sub.spammer-network.test"), false);

    assert.strictEqual(db.isDomainSuspended("legit-instance.test"), false);
    assert.strictEqual(db.isDomainAllowedForFederation("legit-instance.test"), true);
  });

  await t.test("7. Storage upload blocks disguised executables via binary magic-byte inspection", async () => {
    const freshVersion = db.getUserById(testUser.id)?.token_version ?? 1;
    const freshToken = makeUserToken(freshVersion);

    // Create a mock executable buffer starting with Windows MZ header
    const mzBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const mzRes = await request(app)
      .post("/api/v1/storage/upload")
      .set("Authorization", `Bearer ${freshToken}`)
      .attach("file", mzBuffer, { filename: "innocent.png", contentType: "image/png" });

    assert.strictEqual(mzRes.status, 400);
    assert.match(mzRes.body.error, /Executable binaries/i);

    // Create a mock ELF executable buffer (\x7fELF)
    const elfBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    const elfRes = await request(app)
      .post("/api/v1/storage/upload")
      .set("Authorization", `Bearer ${freshToken}`)
      .attach("file", elfBuffer, { filename: "document.pdf", contentType: "application/pdf" });

    assert.strictEqual(elfRes.status, 400);
    assert.match(elfRes.body.error, /Executable binaries/i);
  });
});
