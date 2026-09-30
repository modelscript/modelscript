// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { locationService } from "../src/services/location.js";
import { defaultMailer } from "../src/services/mailer.js";
import { LibraryStorage } from "../src/storage.js";
import { verifyCaptchaToken } from "../src/util/captcha.js";
import { seedInitialAdmin } from "../src/util/seed-admin.js";

test("Phase 1 & Pre-Deployment Readiness: Mailer, Token Decoupling & Guardrails", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mailer-verify-test-"));
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

  t.beforeEach(() => {
    defaultMailer.clearSentMails();
  });

  await t.test("registration in test mode includes verificationToken and dispatches verification email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({
        username: "dev_engineer_1",
        email: "dev.eng1@tum.de",
        password: "Password123!",
        acceptTerms: true,
        captchaToken: "valid-mock-token",
      })
      .expect(201);

    assert.ok(res.body.verificationToken, "verificationToken should be present in test mode");
    assert.strictEqual(res.body.verificationRequired, true);

    const sentMails = defaultMailer.getSentMails();
    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, "dev.eng1@tum.de");
    assert.ok(sentMails[0].subject.includes("Verify your ModelScript account"));
    assert.ok(sentMails[0].text.includes("/verify-email?token="));
  });

  await t.test("registration in production mode omits verificationToken from HTTP JSON response", async () => {
    const originalEnv = process.env["NODE_ENV"];
    const originalKey = process.env["TURNSTILE_SECRET_KEY"];
    try {
      process.env["NODE_ENV"] = "production";
      process.env["TURNSTILE_SECRET_KEY"] = "mock-secret-key";

      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({
          username: "prod_engineer_2",
          email: "prod.eng2@mit.edu",
          password: "Password123!",
          acceptTerms: true,
          captchaToken: "mock-token",
        })
        .expect(201);

      // In production, verificationToken MUST be omitted from response to prevent automated sybil bypass
      assert.strictEqual(res.body.verificationToken, undefined);
      assert.strictEqual(res.body.verificationRequired, true);

      // Email must still have been dispatched
      const sentMails = defaultMailer.getSentMails();
      const lastMail = sentMails[sentMails.length - 1];
      assert.strictEqual(lastMail.to, "prod.eng2@mit.edu");
      assert.ok(lastMail.text.includes("/verify-email?token="));
    } finally {
      process.env["NODE_ENV"] = originalEnv;
      if (originalKey !== undefined) {
        process.env["TURNSTILE_SECRET_KEY"] = originalKey;
      } else {
        delete process.env["TURNSTILE_SECRET_KEY"];
      }
    }
  });

  await t.test("POST /api/v1/auth/resend-verification dispatches fresh token to unverified account", async () => {
    const res = await request(app)
      .post("/api/v1/auth/resend-verification")
      .send({ email: "dev.eng1@tum.de" })
      .expect(200);

    assert.ok(res.body.message.includes("verification link has been sent"));
    assert.ok(res.body.verificationToken);

    const sentMails = defaultMailer.getSentMails();
    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, "dev.eng1@tum.de");
  });

  await t.test("POST /api/v1/auth/resend-verification rejects already verified accounts", async () => {
    // Verify the account
    const user = db.getUserByEmail("dev.eng1@tum.de")!;
    db.verifyUserEmail(user.id);

    const res = await request(app)
      .post("/api/v1/auth/resend-verification")
      .send({ email: "dev.eng1@tum.de" })
      .expect(400);

    assert.ok(res.body.error.includes("already verified"));
  });

  await t.test("POST /api/v1/auth/resend-verification returns 200 generic message for unknown email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/resend-verification")
      .send({ email: "nonexistent@example.com" })
      .expect(200);

    assert.ok(res.body.message.includes("verification link has been sent"));
  });

  await t.test("verifyCaptchaToken fails closed in production when TURNSTILE_SECRET_KEY is missing", async () => {
    const originalEnv = process.env["NODE_ENV"];
    const originalKey = process.env["TURNSTILE_SECRET_KEY"];
    try {
      process.env["NODE_ENV"] = "production";
      delete process.env["TURNSTILE_SECRET_KEY"];

      const result = await verifyCaptchaToken("any-token", "1.2.3.4", "");
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("TURNSTILE_SECRET_KEY missing"));
    } finally {
      process.env["NODE_ENV"] = originalEnv;
      if (originalKey) {
        process.env["TURNSTILE_SECRET_KEY"] = originalKey;
      }
    }
  });

  await t.test("offline IP prefix fallback in LocationService identifies sanctioned allocations", () => {
    // North Korea subnet
    assert.strictEqual(locationService.lookupIp("175.45.176.42")?.countryCode, "KP");
    // Russia / Moscow
    assert.strictEqual(locationService.lookupIp("5.1.0.99")?.countryCode, "RU");
    // Crimea subnet
    const crimeaLoc = locationService.lookupIp("31.135.20.5");
    assert.strictEqual(crimeaLoc?.countryCode, "UA");
    assert.strictEqual(crimeaLoc?.regionCode, "43");
    // Syria
    assert.strictEqual(locationService.lookupIp("82.137.10.1")?.countryCode, "SY");
    // Iran
    assert.strictEqual(locationService.lookupIp("5.200.50.2")?.countryCode, "IR");
  });

  await t.test("seedInitialAdmin provisions instance administrator and is idempotent", async () => {
    assert.strictEqual(db.hasAdminUser(), false);

    const seedRes = await seedInitialAdmin(db, {
      username: "master_admin",
      email: "master@modelscript.test",
      password: "MasterPassword123!",
    });

    assert.strictEqual(seedRes.created, true);
    assert.strictEqual(seedRes.username, "master_admin");
    assert.strictEqual(db.hasAdminUser(), true);

    const adminInDb = db.getUserByUsername("master_admin");
    assert.strictEqual(adminInDb?.account_type, "admin");

    // Second call is idempotent and does not create duplicate
    const secondCall = await seedInitialAdmin(db);
    assert.strictEqual(secondCall.created, false);
  });

  await t.test("GET /api/v1/compliance/readiness reports full regulatory posture", async () => {
    const res = await request(app).get("/api/v1/compliance/readiness").expect(200);

    assert.strictEqual(res.body.checks.exportControls.sanctionedCountriesCount, 24);
    assert.strictEqual(res.body.checks.exportControls.sanctionedRegionsCount, 5);
    assert.strictEqual(res.body.checks.exportControls.status, "enforced");
    assert.strictEqual(res.body.checks.regulations.ofacEarItar, "active");
    assert.strictEqual(res.body.checks.regulations.gdprArticle17Erasure, "active");
    assert.strictEqual(res.body.checks.regulations.gdprArticle20Portability, "active");
    assert.strictEqual(res.body.checks.regulations.rfc9116SecurityTxt, "active");
    assert.strictEqual(res.body.checks.regulations.agplv3Section13, "active");
  });
});
