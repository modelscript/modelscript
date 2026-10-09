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
import { defaultLoginLimiter } from "../src/middleware/login-limiter.js";
import { defaultMailer } from "../src/services/mailer.js";
import { LibraryStorage } from "../src/storage.js";

test("Phase 2 Security & Hardening Integration Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase2-auth-test-"));
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

  await t.test("Task 2.1: Self-Service Password Reset Flow", async () => {
    defaultMailer.clearSentMails();

    // Create a verified active user
    const initialHash = await bcrypt.hash("InitialPass123!", 10);
    const user = db.createUser("alice_reset", "alice.reset@example.com", initialHash, {
      emailVerified: true,
      status: "active",
    });

    // 1. Request password reset via forgot-password
    const forgotRes = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: "alice.reset@example.com" });

    assert.strictEqual(forgotRes.status, 200);
    assert.strictEqual(forgotRes.body.success, true);
    assert.ok(forgotRes.body.resetToken, "Test environment provides resetToken in payload");

    const resetToken = forgotRes.body.resetToken;

    // Small delay to ensure email service processed
    await new Promise((r) => setTimeout(r, 50));
    const sentMails = defaultMailer.getSentMails();
    assert.ok(sentMails.length > 0);
    assert.ok(
      sentMails.some(
        (m) => m.to === "alice.reset@example.com" && m.subject.includes("Reset your ModelScript password"),
      ),
    );

    // 2. Reject short password
    const shortRes = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: resetToken, newPassword: "short" });
    assert.strictEqual(shortRes.status, 400);

    // 3. Successfully reset password
    const resetRes = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: resetToken, newPassword: "BrandNewSecurePassword123!" });

    assert.strictEqual(resetRes.status, 200);
    assert.strictEqual(resetRes.body.success, true);

    // 4. Token cannot be reused (instant revocation / single-use check)
    const reuseRes = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: resetToken, newPassword: "AnotherNewPassword123!" });
    assert.strictEqual(reuseRes.status, 400);

    // 5. Can login with new password
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "alice.reset@example.com", password: "BrandNewSecurePassword123!" });
    assert.strictEqual(loginRes.status, 200);
    assert.ok(loginRes.body.token);

    // Old password fails
    const oldLoginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "alice.reset@example.com", password: "InitialPass123!" });
    assert.strictEqual(oldLoginRes.status, 401);
  });

  await t.test("Task 2.2: Login Brute-Force Rate Limiting & User Enumeration Defense", async () => {
    const testIp = "192.168.10.55";
    const testEmail = "victim@example.com";
    defaultLoginLimiter.reset(testIp, testEmail);

    // Make 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", testIp)
        .send({ email: testEmail, password: `WrongPassword${i}` });
      assert.strictEqual(res.status, 401);
    }

    // 6th attempt should be blocked by rate limiter with 429
    const blockedRes = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", testIp)
      .send({ email: testEmail, password: "AnyPassword" });

    assert.strictEqual(blockedRes.status, 429);
    assert.ok(blockedRes.body.error.includes("Too many failed login attempts"));
    assert.ok(blockedRes.body.retryAfterSeconds > 0);

    // Test bypass header works
    const bypassedRes = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", testIp)
      .set("X-Test-Bypass-Rate-Limit", "true")
      .send({ email: testEmail, password: "WrongPassword" });
    assert.strictEqual(bypassedRes.status, 401);

    // Clean up rate limiter
    defaultLoginLimiter.reset();
  });

  await t.test("Task 2.2: OAuth account without password hash handles login attempt safely", async () => {
    // Create an OAuth user with NULL password hash
    const oauthUser = db.createOAuthUser("oauth_bob", "oauth.bob@example.com", "github", "gh_99999");
    assert.ok(oauthUser);

    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Test-Bypass-Rate-Limit", "true")
      .send({ email: "oauth.bob@example.com", password: "SomeRandomPassword!" });

    // Must return standard 401 without throwing error or crashing
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "Invalid email or password");
  });

  await t.test("Task 2.3: Session Invalidation on Password Change and Revocation", async () => {
    const passwordHash = await bcrypt.hash("OldPassSecret123!", 10);
    const user = db.createUser("session_user", "session.user@example.com", passwordHash, {
      emailVerified: true,
      status: "active",
    });

    // Login and obtain initial JWT session
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Test-Bypass-Rate-Limit", "true")
      .send({ email: "session.user@example.com", password: "OldPassSecret123!" });
    assert.strictEqual(loginRes.status, 200);
    const originalToken = loginRes.body.token;

    // Verify original token works on authenticated route
    const meRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${originalToken}`);
    assert.strictEqual(meRes.status, 200);

    // Change password via PUT /api/v1/auth/password
    const changePassRes = await request(app)
      .put("/api/v1/auth/password")
      .set("Authorization", `Bearer ${originalToken}`)
      .send({ oldPassword: "OldPassSecret123!", newPassword: "UpdatedPassSecret456!" });
    assert.strictEqual(changePassRes.status, 200);
    assert.ok(changePassRes.body.token, "Returns refreshed session token");
    const newToken = changePassRes.body.token;

    // Original token should now be rejected as revoked (token_version mismatch)
    const revokedCheckRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${originalToken}`);
    assert.strictEqual(revokedCheckRes.status, 401);
    assert.ok(revokedCheckRes.body.error.includes("Session has expired or was revoked"));

    // New token works
    const newMeRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${newToken}`);
    assert.strictEqual(newMeRes.status, 200);

    // Explicit revoke-sessions endpoint test
    const revokeRes = await request(app)
      .post("/api/v1/auth/revoke-sessions")
      .set("Authorization", `Bearer ${newToken}`);
    assert.strictEqual(revokeRes.status, 200);
    assert.ok(revokeRes.body.token);

    // newToken is now revoked
    const afterRevokeCheck = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${newToken}`);
    assert.strictEqual(afterRevokeCheck.status, 401);
  });

  await t.test("Task 2.3: Suspended / Frozen accounts are rejected with 403", async () => {
    const passwordHash = await bcrypt.hash("ActivePass123!", 10);
    const user = db.createUser("suspended_user", "suspended@example.com", passwordHash, {
      emailVerified: true,
      status: "active",
    });

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Test-Bypass-Rate-Limit", "true")
      .send({ email: "suspended@example.com", password: "ActivePass123!" });
    assert.strictEqual(loginRes.status, 200);
    const token = loginRes.body.token;

    // Suspend user in DB
    db.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(user.id);

    // Request with valid token should now be blocked with 403
    const blockedRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    assert.strictEqual(blockedRes.status, 403);
    assert.ok(blockedRes.body.error.includes("suspended"));

    // Login attempt should also be blocked with 403
    const loginBlocked = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Test-Bypass-Rate-Limit", "true")
      .send({ email: "suspended@example.com", password: "ActivePass123!" });
    assert.strictEqual(loginBlocked.status, 403);
  });

  await t.test(
    "Task 2.4: OAuth user profile updates and initial password setting without current password",
    async () => {
      // Create an OAuth user (password_hash is NULL)
      const oauthUser = db.createOAuthUser("oauth_carol", "carol.oauth@example.com", "github", "gh_carol_42");
      const fullUser = db.getUserById(oauthUser.id)!;

      // Generate JWT for this specific OAuth user
      const token = jwt.sign(
        {
          id: fullUser.id,
          username: fullUser.username,
          email: fullUser.email,
          tokenVersion: fullUser.token_version ?? 1,
        },
        JWT_SECRET,
        { expiresIn: "7d" },
      );

      // 1. Fetch /me: has_password should be false for OAuth user without password
      const meRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meRes.body.user.has_password, false);

      // 2. Update profile without password
      const updateRes = await request(app).put("/api/v1/auth/account").set("Authorization", `Bearer ${token}`).send({
        display_name: "Carol The Modeler",
        bio: "Physical systems enthusiast",
        avatar_url: "https://example.com/carol.png",
      });
      assert.strictEqual(updateRes.status, 200);
      assert.strictEqual(updateRes.body.success, true);

      const updatedUser = db.getUserById(fullUser.id)!;
      assert.strictEqual(updatedUser.display_name, "Carol The Modeler");
      assert.strictEqual(updatedUser.avatar_url, "https://example.com/carol.png");

      // 3. Set password for the first time without oldPassword
      const setPassRes = await request(app)
        .put("/api/v1/auth/password")
        .set("Authorization", `Bearer ${token}`)
        .send({ newPassword: "CarolBrandNewPassword123!" });
      assert.strictEqual(setPassRes.status, 200);
      assert.strictEqual(setPassRes.body.success, true);
      assert.ok(setPassRes.body.token);

      // Now has_password should be true
      const meAfterPass = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${setPassRes.body.token}`);
      assert.strictEqual(meAfterPass.status, 200);
      assert.strictEqual(meAfterPass.body.user.has_password, true);

      // Subsequent password change now DOES require old password
      const failChangeWithoutOld = await request(app)
        .put("/api/v1/auth/password")
        .set("Authorization", `Bearer ${setPassRes.body.token}`)
        .send({ newPassword: "YetAnotherPassword123!" });
      assert.strictEqual(failChangeWithoutOld.status, 400);
    },
  );
});
