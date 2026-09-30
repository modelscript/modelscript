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
import { RegistrationRateLimiter } from "../src/middleware/registration-limiter.js";
import { LibraryStorage } from "../src/storage.js";
import { isDisposableEmail } from "../src/util/email-filter.js";
import { signEmailVerificationToken, verifyEmailVerificationToken } from "../src/util/email-verification.js";

test("Phase 2: Identity, Auth & Anti-Sybil Defense", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-sybil-test-"));
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

  await t.test("isDisposableEmail correctly identifies burner domains", () => {
    assert.strictEqual(isDisposableEmail("bot123@tempmail.com"), true);
    assert.strictEqual(isDisposableEmail("attacker@mailinator.com"), true);
    assert.strictEqual(isDisposableEmail("sybil@guerrillamail.com"), true);
    assert.strictEqual(isDisposableEmail("fake@sub.mailinator.com"), true);
    assert.strictEqual(isDisposableEmail("miner@10minutemail.com"), true);
    assert.strictEqual(isDisposableEmail("user@sharklasers.com"), true);

    // Legitimate domains
    assert.strictEqual(isDisposableEmail("engineer@tum.de"), false);
    assert.strictEqual(isDisposableEmail("alice@company.com"), false);
    assert.strictEqual(isDisposableEmail("researcher@mit.edu"), false);
    assert.strictEqual(isDisposableEmail("developer@gmail.com"), false);
  });

  await t.test("signEmailVerificationToken generates tamper-proof verifiable HMAC tokens", () => {
    const token = signEmailVerificationToken(101, "alice@company.com");
    const result = verifyEmailVerificationToken(token);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.userId, 101);
    assert.strictEqual(result.email, "alice@company.com");

    // Tampered token payload
    const tampered = token.replace(/^[A-Za-z0-9_-]+/, "eyB1c2VySWQiOiAxMDJ9");
    const tamperedResult = verifyEmailVerificationToken(tampered);
    assert.strictEqual(tamperedResult.valid, false);
    assert.strictEqual(tamperedResult.error, "Invalid cryptographic signature");

    // Expired token
    const expiredToken = signEmailVerificationToken(101, "alice@company.com", undefined, -1000);
    const expiredResult = verifyEmailVerificationToken(expiredToken);
    assert.strictEqual(expiredResult.valid, false);
    assert.strictEqual(expiredResult.error, "Verification token has expired");
  });

  await t.test("rejects registration without Terms of Service agreement", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      username: "alice_no_terms",
      email: "alice.noterms@company.com",
      password: "SuperSecretPassword123!",
      acceptTerms: false,
      captchaToken: "mock-token",
    });

    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes("You must accept the Terms of Service"));
  });

  await t.test("rejects registration with disposable / burner email domains", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      username: "sybil_bot_1",
      email: "bot@mailinator.com",
      password: "Password1234!",
      acceptTerms: true,
      captchaToken: "mock-token",
    });

    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error.includes("Disposable and temporary email addresses are not permitted"));
  });

  await t.test("rejects registration when captcha verification fails", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      username: "failing_captcha_user",
      email: "bot.fail@company.com",
      password: "Password1234!",
      acceptTerms: true,
      captchaToken: "fail-captcha",
    });

    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes("Invalid captcha challenge token"));
  });

  let savedVerificationToken = "";

  await t.test("successfully registers user with withheld free credits until verified", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      username: "legit_engineer",
      email: "engineer@aerospace.corp",
      password: "ComplexPassword99!",
      acceptTerms: true,
      captchaToken: "valid-pass-token",
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.token, "Should issue JWT");
    assert.strictEqual(res.body.user.username, "legit_engineer");
    assert.strictEqual(res.body.user.email_verified, 0);
    assert.strictEqual(res.body.user.status, "pending_verification");
    assert.strictEqual(res.body.verificationRequired, true);
    assert.ok(res.body.verificationToken, "Should generate verification token");

    savedVerificationToken = res.body.verificationToken;

    // Verify database record has 0 credit balance initially
    const userInDb = db.getUserByUsername("legit_engineer");
    assert.strictEqual(userInDb?.credit_balance, 0.0);
  });

  await t.test("verifies email with signed token and unlocks free tier compute credits", async () => {
    assert.ok(savedVerificationToken, "Token from previous registration must exist");

    const res = await request(app).post("/api/v1/auth/verify-email").send({ token: savedVerificationToken });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.creditsGranted, 50.0);
    assert.strictEqual(res.body.user.email_verified, 1);
    assert.strictEqual(res.body.user.status, "active");
    assert.strictEqual(res.body.user.credit_balance, 50.0);

    // Verify in database
    const userInDb = db.getUserByUsername("legit_engineer");
    assert.strictEqual(userInDb?.email_verified, 1);
    assert.strictEqual(userInDb?.status, "active");
    assert.strictEqual(userInDb?.credit_balance, 50.0);

    // Idempotent: verifying again does not grant additional credits
    const secondRes = await request(app).post("/api/v1/auth/verify-email").send({ token: savedVerificationToken });

    assert.strictEqual(secondRes.status, 200);
    assert.strictEqual(secondRes.body.creditsGranted, 0.0);
    assert.strictEqual(secondRes.body.user.credit_balance, 50.0);
  });

  await t.test("RegistrationRateLimiter throttles rapid requests from same IP", () => {
    const limiter = new RegistrationRateLimiter(2, 60000);
    const ip = "198.51.100.42";

    assert.strictEqual(limiter.check(ip).allowed, true);
    limiter.record(ip);

    assert.strictEqual(limiter.check(ip).allowed, true);
    limiter.record(ip);

    // 3rd attempt exceeds limit of 2
    assert.strictEqual(limiter.check(ip).allowed, false);
    assert.strictEqual(limiter.check(ip).remaining, 0);

    // Different IP still allowed
    assert.strictEqual(limiter.check("198.51.100.99").allowed, true);
  });
});
