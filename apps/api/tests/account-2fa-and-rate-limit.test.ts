// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
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
import { generateTotpCode } from "../src/util/totp.js";

test("Account Info 2FA TOTP Support, Rate-Limiting & Notification Settings Validation", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "account-2fa-rate-limit-test-"));
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

  const password = "StrongPassword123!";
  const passwordHash = await bcrypt.hash(password, 10);
  const user = db.createUser("alice_2fa", "alice_2fa@modelscript.test", passwordHash, { emailVerified: true });
  const token = jwt.sign({ id: user.id, username: user.username, email: user.email, tokenVersion: 1 }, JWT_SECRET);

  // Enable 2FA via setup + verify
  const setupRes = await request(app).post("/api/v1/auth/2fa/setup").set("Authorization", `Bearer ${token}`).send({});
  assert.strictEqual(setupRes.status, 200);
  const totpSecret = setupRes.body.secret as string;
  assert.ok(totpSecret);

  const verifyRes = await request(app)
    .post("/api/v1/auth/2fa/verify")
    .set("Authorization", `Bearer ${token}`)
    .send({ code: generateTotpCode(totpSecret), secret: totpSecret });
  assert.strictEqual(verifyRes.status, 200);

  await t.test("2FA-enabled user can update non-identity fields (display_name) without totpCode", async () => {
    const res = await request(app).put("/api/v1/auth/account").set("Authorization", `Bearer ${token}`).send({
      password,
      display_name: "Alice Maxwell",
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.emailChanged, false);
    assert.ok(res.headers["ratelimit-limit"], "authRateLimiter should attach standard RateLimit headers");

    const updated = db.getUserById(user.id);
    assert.strictEqual(updated?.display_name, "Alice Maxwell");
  });

  await t.test("2FA-enabled user changing email gets 401 without totpCode and 200 with valid TOTP code", async () => {
    const noCodeRes = await request(app).put("/api/v1/auth/account").set("Authorization", `Bearer ${token}`).send({
      password,
      email: "alice_new@modelscript.test",
    });

    assert.strictEqual(noCodeRes.status, 401);
    assert.match(String(noCodeRes.body.error), /Two-factor authentication code is required/i);

    const withCodeRes = await request(app)
      .put("/api/v1/auth/account")
      .set("Authorization", `Bearer ${token}`)
      .send({
        password,
        email: "alice_new@modelscript.test",
        totpCode: generateTotpCode(totpSecret),
      });

    assert.strictEqual(withCodeRes.status, 200);
    assert.strictEqual(withCodeRes.body.success, true);
    assert.strictEqual(withCodeRes.body.emailChanged, true);

    const updated = db.getUserById(user.id);
    assert.strictEqual(updated?.email, "alice_new@modelscript.test");
  });

  await t.test(
    "2FA-enabled user changing username gets 401 without totpCode and 200 with valid TOTP code",
    async () => {
      const noCodeRes = await request(app).put("/api/v1/auth/account").set("Authorization", `Bearer ${token}`).send({
        password,
        username: "alice_renamed",
      });

      assert.strictEqual(noCodeRes.status, 401);
      assert.match(String(noCodeRes.body.error), /Two-factor authentication code is required/i);

      const withCodeRes = await request(app)
        .put("/api/v1/auth/account")
        .set("Authorization", `Bearer ${token}`)
        .send({
          password,
          username: "alice_renamed",
          totpCode: generateTotpCode(totpSecret),
        });

      assert.strictEqual(withCodeRes.status, 200);
      assert.strictEqual(withCodeRes.body.success, true);

      const updated = db.getUserById(user.id);
      assert.strictEqual(updated?.username, "alice_renamed");
    },
  );

  await t.test("PUT /api/v1/auth/password applies authRateLimiter", async () => {
    const res = await request(app).put("/api/v1/auth/password").set("Authorization", `Bearer ${token}`).send({
      oldPassword: password,
      newPassword: "NewStrongPassword456!",
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.headers["ratelimit-limit"], "authRateLimiter should attach standard RateLimit headers");
  });

  await t.test("PUT /api/v1/auth/notifications rejects non-object, unknown keys, and oversized payloads", async () => {
    // Re-mint token since password change incremented token_version
    const refreshedUser = db.getUserById(user.id)!;
    const freshToken = jwt.sign(
      {
        id: refreshedUser.id,
        username: refreshedUser.username,
        email: refreshedUser.email,
        tokenVersion: refreshedUser.token_version ?? 1,
      },
      JWT_SECRET,
    );

    // Array payload -> 400
    const arrayRes = await request(app)
      .put("/api/v1/auth/notifications")
      .set("Authorization", `Bearer ${freshToken}`)
      .set("Content-Type", "application/json")
      .send("[]");
    assert.strictEqual(arrayRes.status, 400);

    // String payload -> 400
    const strRes = await request(app)
      .put("/api/v1/auth/notifications")
      .set("Authorization", `Bearer ${freshToken}`)
      .set("Content-Type", "application/json")
      .send('"str"');
    assert.strictEqual(strRes.status, 400);

    // Unknown top-level key -> 400
    const unknownKeyRes = await request(app)
      .put("/api/v1/auth/notifications")
      .set("Authorization", `Bearer ${freshToken}`)
      .send({ arbitraryInjectedKey: "evil" });
    assert.strictEqual(unknownKeyRes.status, 400);

    // Oversized payload (> 16 KB) -> 400
    const oversizedRes = await request(app)
      .put("/api/v1/auth/notifications")
      .set("Authorization", `Bearer ${freshToken}`)
      .send({
        mutedKeywords: ["x".repeat(20_000)],
      });
    assert.strictEqual(oversizedRes.status, 400);

    // Valid notification preferences -> 200
    const validRes = await request(app)
      .put("/api/v1/auth/notifications")
      .set("Authorization", `Bearer ${freshToken}`)
      .send({
        qualityFilter: true,
        inAppSounds: false,
        emailDigestFrequency: "daily",
        channels: { email: true, browserPush: false, inApp: true },
        mutedKeywords: ["spam"],
      });
    assert.strictEqual(validRes.status, 200);
    assert.strictEqual(validRes.body.success, true);

    const getRes = await request(app).get("/api/v1/auth/notifications").set("Authorization", `Bearer ${freshToken}`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.qualityFilter, true);
    assert.strictEqual(getRes.body.inAppSounds, false);
    assert.deepStrictEqual(getRes.body.mutedKeywords, ["spam"]);
  });
});
