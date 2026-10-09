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
import { defaultMailer } from "../src/services/mailer.js";
import { LibraryStorage } from "../src/storage.js";

test("Phase 1 Security & Hardening Integration Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase1-auth-test-"));
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

  await t.test("npm adduser creates unverified user with 0 initial credits and sends email", async () => {
    defaultMailer.clearSentMails();

    const res = await request(app).put("/-/user/org.couchdb.user:npm_engineer").send({
      name: "npm_engineer",
      password: "StrongNpmPassword123!",
      email: "npm.engineer@aerospace.corp",
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.verificationRequired, true);
    assert.ok(res.body.token);

    const userInDb = db.getUserByUsername("npm_engineer");
    assert.ok(userInDb);
    assert.strictEqual(userInDb.email_verified, 0, "Account created via npm must be unverified initially");
    assert.strictEqual(userInDb.credit_balance, 0.0, "Account created via npm must not be given initial credits");
    assert.strictEqual(userInDb.status, "pending_verification");

    // Small delay to allow fire-and-forget email promise to resolve
    await new Promise((r) => setTimeout(r, 50));

    // Verify verification email was dispatched
    const sent = defaultMailer.getSentMails();
    const verificationEmail = sent.find((m) => m.to === "npm.engineer@aerospace.corp");
    assert.ok(verificationEmail, "Verification email must be dispatched for npm-registered user");
    assert.ok(verificationEmail.subject.includes("Verify your ModelScript account"));
    assert.ok(verificationEmail.text.includes("/verify-email?token="));
  });

  await t.test("npm adduser rejects registration with disposable email", async () => {
    const res = await request(app).put("/-/user/org.couchdb.user:burner_bot").send({
      name: "burner_bot",
      password: "Password123!",
      email: "bot@mailinator.com",
    });

    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error.includes("Disposable and temporary email addresses are not permitted"));
  });

  await t.test("npm adduser blocks registration from sanctioned jurisdictions (OFAC/ITAR)", async () => {
    const res = await request(app)
      .put("/-/user/org.couchdb.user:sanctioned_user")
      .set("cf-ipcountry", "KP") // North Korea
      .send({
        name: "sanctioned_user",
        password: "Password123!",
        email: "user@sanctioned.kp",
      });

    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error.includes("Access denied under OFAC / EAR / ITAR"));
  });

  await t.test("OIDC rejects forged token with unsigned alg=none header", async () => {
    // Unsigned token
    const forgedToken = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsImVtYWlsIjoiYWRtaW5AY29ycC5jb20ifQ.";

    const res = await request(app).post("/api/v1/auth/oidc/token").send({ idToken: forgedToken });

    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error.includes("unsigned tokens (alg=none) are strictly rejected"));
  });

  await t.test("OAuth login prevents pre-account takeover on password-protected accounts", async () => {
    // 1. Create a legitimate user who set a password with the same email as mock gitlab
    const passwordHash = await bcrypt.hash("VictimPassword123!", 10);
    db.createUser("victim_dev", "mockuser@gitlab.com", passwordHash, {
      emailVerified: true,
      initialCredits: 50.0,
    });

    // 2. Mock OAuth callback returning gitlab user with matching email
    const res = await request(app).get("/api/v1/auth/callback/gitlab").query({ code: "mock_code_from_gitlab" });

    // Expect redirect to login with error=AccountExistsWithPassword instead of logging in
    assert.strictEqual(res.status, 302);
    assert.ok(res.header.location.includes("AccountExistsWithPassword"));
  });

  await t.test("Mailer bounded queue does not grow past 100 items", async () => {
    defaultMailer.clearSentMails();

    for (let i = 0; i < 110; i++) {
      await defaultMailer.sendMail({
        to: `user_${i}@modelscript.test`,
        subject: `Test ${i}`,
        text: `Body ${i}`,
      });
    }

    const sent = defaultMailer.getSentMails();
    assert.strictEqual(sent.length, 100, "sentMails must be capped at 100 items");
  });
});
