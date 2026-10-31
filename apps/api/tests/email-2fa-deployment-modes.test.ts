// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { defaultMailer, MailerService } from "../src/services/mailer.js";
import { LibraryStorage } from "../src/storage.js";
import { decryptTotpSecret, encryptTotpSecret, generateTotpCode } from "../src/util/totp.js";

test("Email, 2FA, Registration & Admin Governance Across Deployment Modes", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-deploy-modes-test-"));
  const db = new LibraryDatabase(path.join(tmpDir, "db"));
  const storage = new LibraryStorage(path.join(tmpDir, "storage"));
  const app = createApp({ database: db, storage });
  app.set("trust proxy", 1);

  t.after(() => {
    delete process.env["AIRGAP_ENFORCED"];
    delete process.env["SMTP_LIVE_TEST"];
    delete process.env["SMTP_HOST"];
    delete process.env["SMTP_PORT"];
    delete process.env["SMTP_USER"];
    delete process.env["SMTP_PASS"];
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  await t.test(
    "Phase 1.1: MailerService performs SMTP EHLO -> STARTTLS state machine handshake before AUTH PLAIN on port 587",
    async () => {
      const receivedLines: string[] = [];
      let sawStartTls = false;

      const server = net.createServer((socket) => {
        socket.write("220 smtp.intranet.local ESMTP Ready\r\n");
        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          const lines = buffer.split("\r\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line) continue;
            receivedLines.push(line);
            if (line.startsWith("EHLO")) {
              socket.write("250-smtp.intranet.local\r\n250 STARTTLS\r\n");
            } else if (line === "STARTTLS") {
              sawStartTls = true;
              socket.write("454 TLS not available in plain mock\r\n");
              socket.end();
            }
          }
        });
      });

      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const addr = server.address() as net.AddressInfo;

      process.env["SMTP_LIVE_TEST"] = "true";
      process.env["SMTP_HOST"] = "127.0.0.1";
      process.env["SMTP_PORT"] = String(addr.port);
      process.env["SMTP_USER"] = "relay-user";
      process.env["SMTP_PASS"] = "relay-pass";

      const smtpMailer = new MailerService({
        driver: "smtp",
        defaultFrom: "Ansatz <noreply@corp.internal>",
        publicUrl: "https://hub.corp.internal",
      });

      try {
        await smtpMailer.sendMail({
          to: "engineer@corp.internal",
          subject: "STARTTLS Handshake Test",
          text: "Testing STARTTLS upgrade before AUTH PLAIN",
          html: "<p>Testing</p>",
        });
      } finally {
        delete process.env["SMTP_LIVE_TEST"];
        delete process.env["SMTP_HOST"];
        delete process.env["SMTP_PORT"];
        delete process.env["SMTP_USER"];
        delete process.env["SMTP_PASS"];
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }

      assert.strictEqual(sawStartTls, true);
      assert.strictEqual(receivedLines[0], "EHLO hub.corp.internal");
      assert.strictEqual(receivedLines[1], "STARTTLS");
      assert.strictEqual(
        receivedLines.some((l) => l.startsWith("AUTH PLAIN")),
        false,
      );
    },
  );

  await t.test(
    "Phase 1.2: White-label instanceName in verification, password reset, security alert, and invite emails",
    async () => {
      defaultMailer.clearSentMails();

      await defaultMailer.sendVerificationEmail("physicist@cern.ch", "scientist", "verify-tok-1", {
        instanceName: "CERN Accelerator Hub",
      });
      await defaultMailer.sendSecurityAlertEmail("physicist@cern.ch", {
        username: "scientist",
        eventTitle: "Two-Factor Authentication Enabled",
        description: "TOTP 2FA was activated on your account.",
        ipAddress: "10.0.0.42",
        instanceName: "CERN Accelerator Hub",
      });
      await defaultMailer.sendInviteEmail("colleague@cern.ch", "msx-inv-cern", {
        instanceName: "CERN Accelerator Hub",
        invitedBy: "admin_brand",
      });

      const outbox = defaultMailer.getSentMails();
      assert.strictEqual(outbox.length, 3);
      assert.strictEqual(outbox[0]!.subject, "Verify your CERN Accelerator Hub account");
      assert.ok(outbox[1]!.subject.includes("[CERN Accelerator Hub Security Alert] Two-Factor Authentication Enabled"));
      assert.ok(outbox[1]!.text.includes("10.0.0.42"));
      assert.ok(outbox[2]!.subject.includes("You've been invited to join CERN Accelerator Hub"));
      assert.ok(outbox[2]!.text.includes("msx-inv-cern"));
    },
  );

  let adminToken = "";
  let adminSecret = "";
  let sudoToken = "";

  await t.test(
    "Phase 2.1: Encrypts totp_secret and pending_totp_secret with AES-256-GCM at rest in SQLite",
    async () => {
      // First registered user becomes instance admin
      const regRes = await request(app).post("/api/v1/auth/register").send({
        username: "chief_admin",
        email: "chief@corp.internal",
        password: "AdminPassword123!",
        acceptTerms: true,
        captchaToken: "mock-token",
      });
      assert.strictEqual(regRes.status, 201);
      adminToken = regRes.body.token as string;
      const userId = regRes.body.user.id as number;
      db.setUserAccountType(userId, "admin");

      // 1. Setup 2FA -> pending_totp_secrets.secret must be encrypted at rest
      const setupRes = await request(app).post("/api/v1/auth/2fa/setup").set("Authorization", `Bearer ${adminToken}`);
      assert.strictEqual(setupRes.status, 200);
      adminSecret = setupRes.body.secret as string;

      const rawPendingRow = db.db.prepare("SELECT secret FROM pending_totp_secrets WHERE user_id = ?").get(userId) as {
        secret: string;
      };
      assert.match(rawPendingRow.secret, /^enc:v1:/);
      assert.strictEqual(rawPendingRow.secret.includes(adminSecret), false);
      assert.strictEqual(decryptTotpSecret(rawPendingRow.secret), adminSecret);

      // 2. Verify 2FA -> totp_secret must be encrypted at rest and pending_totp_secrets row deleted
      const totpCode = generateTotpCode(adminSecret);
      const verifyRes = await request(app)
        .post("/api/v1/auth/2fa/verify")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ code: totpCode });
      assert.strictEqual(verifyRes.status, 200);
      assert.strictEqual(verifyRes.body.backupCodes.length, 10);

      const rawActiveRow = db.db.prepare("SELECT totp_secret FROM users WHERE id = ?").get(userId) as {
        totp_secret: string;
      };
      assert.match(rawActiveRow.totp_secret, /^enc:v1:/);
      assert.strictEqual(rawActiveRow.totp_secret.includes(adminSecret), false);

      const deletedPendingRow = db.db.prepare("SELECT secret FROM pending_totp_secrets WHERE user_id = ?").get(userId);
      assert.strictEqual(deletedPendingRow, undefined);

      // 3. Backward compatibility: legacy unencrypted Base32 strings still decrypt cleanly
      assert.strictEqual(decryptTotpSecret(adminSecret), adminSecret);
      const encrypted = encryptTotpSecret(adminSecret);
      assert.strictEqual(decryptTotpSecret(encrypted), adminSecret);
    },
  );

  await t.test(
    "Phase 2.2: Supports regenerating 2FA backup codes, NPM CLI backup code recovery, and backup_codes_remaining in /auth/me",
    async () => {
      const regRes = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.10.0.2").send({
        username: "regen_user",
        email: "regen_user@example.com",
        password: "Password123!",
        acceptTerms: true,
        captchaToken: "mock-token",
      });
      assert.strictEqual(regRes.status, 201);
      const token = regRes.body.token as string;

      const setupRes = await request(app).post("/api/v1/auth/2fa/setup").set("Authorization", `Bearer ${token}`);
      const secret = setupRes.body.secret as string;
      const verifyRes = await request(app)
        .post("/api/v1/auth/2fa/verify")
        .set("Authorization", `Bearer ${token}`)
        .send({ code: generateTotpCode(secret) });
      const originalBackupCodes = verifyRes.body.backupCodes as string[];
      assert.strictEqual(originalBackupCodes.length, 10);

      // Consume 1 backup code via NPM login
      const npmLoginRes = await request(app)
        .put("/-/user/org.couchdb.user:regen_user")
        .set("npm-otp", originalBackupCodes[0]!)
        .send({ name: "regen_user", password: "Password123!" });
      assert.strictEqual(npmLoginRes.status, 201);
      assert.strictEqual(npmLoginRes.body.ok, true);

      // Check /auth/me -> backup_codes_remaining should be 9
      const meRes1 = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
      assert.strictEqual(meRes1.status, 200);
      assert.strictEqual(meRes1.body.user.backup_codes_remaining, 9);

      // Regenerate backup codes using password + TOTP code
      const regenRes = await request(app)
        .post("/api/v1/auth/2fa/backup-codes/regenerate")
        .set("Authorization", `Bearer ${token}`)
        .send({
          password: "Password123!",
          code: generateTotpCode(secret),
        });
      assert.strictEqual(regenRes.status, 200);
      assert.strictEqual(regenRes.body.backupCodes.length, 10);
      assert.notStrictEqual(regenRes.body.backupCodes[0], originalBackupCodes[1]);

      // Old unused backup code should no longer work
      const oldCodeNpmRes = await request(app)
        .put("/-/user/org.couchdb.user:regen_user")
        .set("npm-otp", originalBackupCodes[1]!)
        .send({ name: "regen_user", password: "Password123!" });
      assert.strictEqual(oldCodeNpmRes.status, 401);

      // New backup code works on NPM CLI login
      const newCodeNpmRes = await request(app)
        .put("/-/user/org.couchdb.user:regen_user")
        .set("npm-otp", regenRes.body.backupCodes[0])
        .send({ name: "regen_user", password: "Password123!" });
      assert.strictEqual(newCodeNpmRes.status, 201);
    },
  );

  await t.test(
    "Phase 3.1: Exposes /api/v1/auth/config and auto-verifies accounts in AIRGAP_ENFORCED mode when no live mailer is configured",
    async () => {
      process.env["AIRGAP_ENFORCED"] = "true";
      try {
        const configRes = await request(app).get("/api/v1/auth/config");
        assert.strictEqual(configRes.status, 200);
        assert.strictEqual(configRes.body.airgapEnforced, true);
        assert.strictEqual(configRes.body.turnstileEnabled, false);
        assert.deepStrictEqual(configRes.body.oauthProviders, []);

        // Register in air-gapped mode without live SMTP -> should auto-verify and grant initial credits
        const regRes = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.10.0.3").send({
          username: "airgap_scientist",
          email: "scientist@enclave.local",
          password: "Password123!",
          acceptTerms: true,
        });
        assert.strictEqual(regRes.status, 201);
        assert.strictEqual(regRes.body.verificationRequired, false);
        assert.strictEqual(regRes.body.user.email_verified, 1);
      } finally {
        delete process.env["AIRGAP_ENFORCED"];
      }
    },
  );

  await t.test("Phase 3.2: Blocks npm adduser when registrationMode is closed or domain_allowlist", async () => {
    // 1. Set registrationMode = 'closed'
    db.updateInstanceSettings({ registrationMode: "closed" }, 1);

    const closedNpmRes = await request(app).put("/-/user/org.couchdb.user:intruder").send({
      name: "intruder",
      password: "Password123!",
      email: "intruder@external.com",
    });
    assert.strictEqual(closedNpmRes.status, 403);
    assert.ok(closedNpmRes.body.error.includes("closed"));

    // 2. Set registrationMode = 'domain_allowlist' with 'corp.internal'
    db.updateInstanceSettings(
      {
        registrationMode: "domain_allowlist",
        allowedEmailDomains: "corp.internal, lab.edu",
      },
      1,
    );

    const disallowedDomainNpmRes = await request(app).put("/-/user/org.couchdb.user:external_dev").send({
      name: "external_dev",
      password: "Password123!",
      email: "dev@gmail.com",
    });
    assert.strictEqual(disallowedDomainNpmRes.status, 403);
    assert.ok(disallowedDomainNpmRes.body.error.includes("restricted to approved email domains"));

    const allowedDomainNpmRes = await request(app).put("/-/user/org.couchdb.user:internal_dev").send({
      name: "internal_dev",
      password: "Password123!",
      email: "dev@corp.internal",
    });
    assert.strictEqual(allowedDomainNpmRes.status, 201);
    assert.strictEqual(allowedDomainNpmRes.body.ok, true);
  });

  await t.test(
    "Phase 3.3: Enforces domain_allowlist when changing email via PUT /api/v1/auth/account and notifies old email",
    async () => {
      try {
        const userRes = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.10.0.4").send({
          username: "alice_corp",
          email: "alice@corp.internal",
          password: "Password123!",
          acceptTerms: true,
          captchaToken: "mock-token",
        });
        assert.strictEqual(userRes.status, 201);
        const aliceToken = userRes.body.token as string;
        defaultMailer.clearSentMails();

        // Attempt to change email to external domain -> blocked with 403
        const blockedChange = await request(app)
          .put("/api/v1/auth/account")
          .set("Authorization", `Bearer ${aliceToken}`)
          .send({
            email: "alice@outside.org",
            password: "Password123!",
          });
        assert.strictEqual(blockedChange.status, 403);

        // Change email to another valid internal address -> succeeds and sends security alert to old address + verification to new address
        const validChange = await request(app)
          .put("/api/v1/auth/account")
          .set("Authorization", `Bearer ${aliceToken}`)
          .send({
            email: "alice.smith@corp.internal",
            password: "Password123!",
          });
        assert.strictEqual(validChange.status, 200);

        const outbox = defaultMailer.getSentMails();
        assert.strictEqual(
          outbox.some((m) => m.to === "alice@corp.internal" && m.subject.includes("Email Address Changed")),
          true,
        );
        assert.strictEqual(
          outbox.some((m) => m.to === "alice.smith@corp.internal" && m.subject.includes("Verify")),
          true,
        );
      } finally {
        // Restore open registration for subsequent tests
        db.updateInstanceSettings({ registrationMode: "open", allowedEmailDomains: "" }, 1);
      }
    },
  );

  await t.test(
    "Phase 4: Supports TOTP-based admin sudo, enforces verifyAdminSudo, and allows manual email verification & 2FA reset",
    async () => {
      // 1. Verify sudo using TOTP code alone on chief_admin
      const sudoRes = await request(app)
        .post("/api/v1/admin/sudo/verify")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ totpCode: generateTotpCode(adminSecret) });
      assert.strictEqual(sudoRes.status, 200);
      assert.ok(sudoRes.body.sudoToken);
      sudoToken = sudoRes.body.sudoToken as string;

      // 2. Presenting an invalid x-admin-sudo-token to PATCH /api/v1/admin/settings is rejected with 403
      const badSudoRes = await request(app)
        .patch("/api/v1/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("x-admin-sudo-token", "invalid-token")
        .send({ requireAdmin2FA: true });
      assert.strictEqual(badSudoRes.status, 403);

      // Presenting the valid sudoToken succeeds
      const goodSudoRes = await request(app)
        .patch("/api/v1/admin/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("x-admin-sudo-token", sudoToken)
        .send({ requireAdmin2FA: true });
      assert.strictEqual(goodSudoRes.status, 200);
      assert.strictEqual(goodSudoRes.body.settings.requireAdmin2FA, true);

      // 3. Register a regular user, enable 2FA on them, then have admin manually verify their email and reset their 2FA
      const memberReg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.10.0.5").send({
        username: "locked_member",
        email: "locked@example.com",
        password: "MemberPassword123!",
        acceptTerms: true,
        captchaToken: "mock-token",
      });
      const memberToken = memberReg.body.token as string;
      const memberId = memberReg.body.user.id as number;

      const member2faSetup = await request(app)
        .post("/api/v1/auth/2fa/setup")
        .set("Authorization", `Bearer ${memberToken}`);
      await request(app)
        .post("/api/v1/auth/2fa/verify")
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ code: generateTotpCode(member2faSetup.body.secret) });

      assert.strictEqual(db.getUser2FAState(memberId)?.totp_enabled, 1);
      assert.strictEqual(db.getUserById(memberId)?.email_verified, 0);

      // Admin manually verifies email and resets 2FA
      const govRes = await request(app)
        .patch(`/api/v1/admin/users/${memberId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("x-admin-sudo-token", sudoToken)
        .send({
          emailVerified: true,
          reset2FA: true,
          reason: "Verified employee badge and hardware token replacement",
        });
      assert.strictEqual(govRes.status, 200);
      assert.strictEqual(govRes.body.emailVerified, true);
      assert.strictEqual(govRes.body.reset2FA, true);

      assert.strictEqual(db.getUserById(memberId)?.email_verified, 1);
      assert.strictEqual(db.getUser2FAState(memberId)?.totp_enabled, 0);
    },
  );

  await t.test(
    "Phase 5: Respects nested NotificationFiltersTab preferences, keeps security_alert non-mutable, and dispatches instant emails",
    async () => {
      const regRes = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.10.0.6").send({
        username: "notif_engineer",
        email: "notif_engineer@example.com",
        password: "Password123!",
        acceptTerms: true,
        captchaToken: "mock-token",
      });
      assert.strictEqual(regRes.status, 201);
      const userId = regRes.body.user.id as number;
      const token = regRes.body.token as string;

      // Save nested NotificationFiltersTab schema with mentions=false, jobFailed=true, emailDigestFrequency='instant'
      const putPrefsRes = await request(app)
        .put("/api/v1/auth/notifications")
        .set("Authorization", `Bearer ${token}`)
        .send({
          emailDigestFrequency: "instant",
          deliveryChannels: {
            emailNotifications: true,
            inAppToast: true,
            webPush: false,
          },
          events: {
            social: {
              mentions: false,
              replies: true,
              follows: false,
              repostsAndLikes: false,
            },
            engineering: {
              packageReleases: true,
              repositoryActivity: true,
              reviewRequests: true,
            },
            computeHpc: {
              jobCompleted: true,
              jobFailed: true,
              creditLowWarning: true,
            },
          },
        });
      assert.strictEqual(putPrefsRes.status, 200);

      defaultMailer.clearSentMails();

      // 1. Mention notification should be suppressed because social.mentions === false
      db.createNotification(userId, 1, "mention", null, {
        title: "Someone mentioned you",
      });
      assert.strictEqual(db.getNotifications(userId).filter((n) => n.type === "mention").length, 0);
      assert.strictEqual(defaultMailer.getSentMails().length, 0);

      // 2. security_alert notification MUST NEVER be suppressed even if user muted categories
      db.createNotification(userId, userId, "security_alert", null, {
        title: "New Personal Access Token Created",
        description: "New Personal Access Token created on your account.",
      });
      assert.strictEqual(db.getNotifications(userId).filter((n) => n.type === "security_alert").length, 1);

      await new Promise((r) => setTimeout(r, 25));
      const outbox = defaultMailer.getSentMails();
      assert.ok(outbox.length >= 1);
      assert.strictEqual(outbox[0]!.to, "notif_engineer@example.com");
      assert.ok(outbox[0]!.text.includes("New Personal Access Token created on your account."));
    },
  );
});
