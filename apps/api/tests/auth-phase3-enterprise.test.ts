// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { LibraryStorage } from "../src/storage.js";
import { generateTotpCode } from "../src/util/totp.js";

test("Phase 3 Enterprise & Compliance Maturity Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase3-auth-test-"));
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

  // Helper to create verified test user
  const passwordHash = bcrypt.hashSync("SecurePassword123!", 10);
  const user = db.createUser("totp_user", "totp@modelscript.org", passwordHash, {
    emailVerified: true,
    initialCredits: 100,
    status: "active",
  });

  let userToken: string;
  let totpSecret: string;
  let backupCodes: string[] = [];

  // 1. Initial Login before 2FA is enabled
  await t.test("Initial login succeeds and sets HttpOnly cookie", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "totp@modelscript.org", password: "SecurePassword123!" });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.requires2FA, undefined);
    assert.ok(res.body.token);
    assert.strictEqual(res.body.user.totp_enabled, false);
    userToken = res.body.token;

    // Verify Set-Cookie header contains modelscript_token
    const cookies = res.headers["set-cookie"];
    assert.ok(cookies);
    const cookieStr = Array.isArray(cookies) ? cookies.join("; ") : cookies;
    assert.ok(cookieStr.includes("modelscript_token="));
    assert.ok(cookieStr.includes("HttpOnly"));
  });

  // 2. 2FA Setup
  await t.test("POST /api/v1/auth/2fa/setup returns secret and otpauth URI", async () => {
    const res = await request(app).post("/api/v1/auth/2fa/setup").set("Authorization", `Bearer ${userToken}`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.secret);
    assert.ok(res.body.otpAuthUri);
    assert.ok(res.body.otpAuthUri.startsWith("otpauth://totp/ModelScript:totp%40modelscript.org?"));
    totpSecret = res.body.secret;
  });

  // 3. 2FA Verify with invalid code fails
  await t.test("POST /api/v1/auth/2fa/verify fails with invalid code", async () => {
    const res = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ secret: totpSecret, code: "000000" });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Invalid 6-digit code/);
  });

  // 4. 2FA Verify with valid code activates 2FA and returns 10 backup codes
  await t.test("POST /api/v1/auth/2fa/verify activates 2FA with valid code", async () => {
    const validCode = generateTotpCode(totpSecret);
    const res = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ secret: totpSecret, code: validCode });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.backupCodes));
    assert.strictEqual(res.body.backupCodes.length, 10);
    backupCodes = res.body.backupCodes;

    // Verify /me endpoint now reports totp_enabled: true
    const meRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body.user.totp_enabled, true);
  });

  // 5. Subsequent Login requires 2FA challenge step
  let tempChallengeToken: string;
  await t.test("Login on 2FA-enabled account returns requires2FA and tempToken", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "totp@modelscript.org", password: "SecurePassword123!" });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.requires2FA, true);
    assert.ok(res.body.tempToken);
    tempChallengeToken = res.body.tempToken;

    // Ensure tempToken CANNOT access authenticated endpoints
    const unauthRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${tempChallengeToken}`);
    assert.strictEqual(unauthRes.status, 401);
    assert.match(unauthRes.body.error, /Two-factor authentication required/);
  });

  // 6. Submitting invalid 2FA code fails
  await t.test("POST /api/v1/auth/2fa/challenge rejects invalid code", async () => {
    const res = await request(app)
      .post("/api/v1/auth/2fa/challenge")
      .send({ tempToken: tempChallengeToken, code: "999999" });

    assert.strictEqual(res.status, 401);
    assert.match(res.body.error, /Invalid authentication code/);
  });

  // 7. Submitting valid TOTP code completes login and returns full session token
  let sessionToken: string;
  await t.test("POST /api/v1/auth/2fa/challenge completes login with valid TOTP code", async () => {
    const validCode = generateTotpCode(totpSecret);
    const res = await request(app)
      .post("/api/v1/auth/2fa/challenge")
      .send({ tempToken: tempChallengeToken, code: validCode });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.token);
    assert.strictEqual(res.body.user.totp_enabled, true);
    assert.strictEqual(res.body.usedBackupCode, false);
    sessionToken = res.body.token;

    // Verify the returned session token can access /me
    const meRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${sessionToken}`);
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body.user.username, "totp_user");
  });

  // 8. Login using single-use backup recovery code
  await t.test("POST /api/v1/auth/2fa/challenge accepts single-use backup code", async () => {
    // Initiate login to get a fresh tempToken
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "totp@modelscript.org", password: "SecurePassword123!" });
    assert.strictEqual(loginRes.status, 200);
    const tempTok = loginRes.body.tempToken;

    // Use first backup code
    const codeToConsume = backupCodes[0]!;
    const challengeRes = await request(app)
      .post("/api/v1/auth/2fa/challenge")
      .send({ tempToken: tempTok, code: codeToConsume });

    assert.strictEqual(challengeRes.status, 200);
    assert.ok(challengeRes.body.token);
    assert.strictEqual(challengeRes.body.usedBackupCode, true);

    // Verify backup code is single-use: attempting to use the same code again must fail
    const loginRes2 = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "totp@modelscript.org", password: "SecurePassword123!" });
    const tempTok2 = loginRes2.body.tempToken;

    const reusedRes = await request(app)
      .post("/api/v1/auth/2fa/challenge")
      .send({ tempToken: tempTok2, code: codeToConsume });
    assert.strictEqual(reusedRes.status, 401);
  });

  // 9. HttpOnly Cookie authentication works
  await t.test("Authenticated endpoints accept cookie token without Bearer header", async () => {
    const res = await request(app).get("/api/v1/auth/me").set("Cookie", `modelscript_token=${sessionToken}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.username, "totp_user");
  });

  // 10. Logout clears cookie
  await t.test("POST /api/v1/auth/logout clears session cookie", async () => {
    const res = await request(app).post("/api/v1/auth/logout").set("Cookie", `modelscript_token=${sessionToken}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const setCookie = res.headers["set-cookie"];
    assert.ok(setCookie);
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
    assert.ok(
      cookieStr.includes("modelscript_token=;") || cookieStr.includes("Max-Age=0") || cookieStr.includes("Expires="),
    );
  });

  // 11. Disable 2FA
  await t.test("POST /api/v1/auth/2fa/disable requires password and code", async () => {
    // Wrong password fails
    const failRes = await request(app)
      .post("/api/v1/auth/2fa/disable")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({ password: "WrongPassword!", code: generateTotpCode(totpSecret) });
    assert.strictEqual(failRes.status, 401);

    // Correct password and TOTP code succeeds
    const okRes = await request(app)
      .post("/api/v1/auth/2fa/disable")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({ password: "SecurePassword123!", code: generateTotpCode(totpSecret) });
    assert.strictEqual(okRes.status, 200);
    assert.strictEqual(okRes.body.success, true);

    // Verify next login does NOT require 2FA
    const normalLoginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "totp@modelscript.org", password: "SecurePassword123!" });
    assert.strictEqual(normalLoginRes.status, 200);
    assert.strictEqual(normalLoginRes.body.requires2FA, undefined);
    assert.ok(normalLoginRes.body.token);
    assert.strictEqual(normalLoginRes.body.user.totp_enabled, false);
  });

  // 12. Security Audit Trail Verification
  await t.test("Audit log trail captures all security events with IP and actorId", async () => {
    const logs = db.getAuditLogs(100);
    const actions = logs.map((l: any) => l.action);

    assert.ok(actions.includes("auth_login_success"));
    assert.ok(actions.includes("auth_login_failure"));
    assert.ok(actions.includes("auth_2fa_enabled"));
    assert.ok(actions.includes("auth_2fa_disabled"));
    assert.ok(actions.includes("auth_logout"));

    // Verify actorId and ip_address are populated
    const enabledLog = logs.find((l: any) => l.action === "auth_2fa_enabled");
    assert.strictEqual(enabledLog.actor_id, user.id);
    assert.ok(enabledLog.ip_address);
  });
});
