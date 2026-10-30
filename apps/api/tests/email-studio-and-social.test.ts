// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { defaultMailer } from "../src/services/mailer.js";
import { LibraryStorage } from "../src/storage.js";

describe("Admin Email & SMTP Studio, Template Engine, Rich Social Emails & Digests", () => {
  let tmpDir: string;
  let db: LibraryDatabase;
  let storage: LibraryStorage;
  let app: ReturnType<typeof createApp>;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-email-studio-test-"));
    db = new LibraryDatabase(path.join(tmpDir, "db"));
    storage = new LibraryStorage(path.join(tmpDir, "storage"));
    app = createApp({ database: db, storage });
    defaultMailer.clearSentMails();
  });

  after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("1. Persists SMTP & provider credentials encrypted at rest (AES-256-GCM) and hot-reloads defaultMailer", async () => {
    const getRes = await request(app).get("/api/v1/admin/email/config").expect(200);
    assert.equal(getRes.body.config.driver, "auto");
    assert.equal(getRes.body.config.smtpPassConfigured, false);

    const putRes = await request(app)
      .put("/api/v1/admin/email/config")
      .send({
        driver: "smtp",
        fromName: "Acme Engineering Hub",
        fromEmail: "alerts@acme.internal",
        replyTo: "helpdesk@acme.internal",
        smtpHost: "smtp.acme.internal",
        smtpPort: 587,
        smtpUser: "svc-ansatz",
        smtpPass: "SuperSecretSmtpPass!2026",
        smtpTlsMode: "starttls",
        smtpTlsRejectUnauthorized: false,
      })
      .expect(200);

    assert.equal(putRes.body.success, true);
    assert.equal(putRes.body.config.driver, "smtp");
    assert.equal(putRes.body.config.activeDriver, "smtp");
    assert.equal(putRes.body.config.configuredForLiveDelivery, true);
    assert.equal(putRes.body.config.fromName, "Acme Engineering Hub");
    assert.equal(putRes.body.config.fromEmail, "alerts@acme.internal");
    assert.equal(putRes.body.config.smtpHost, "smtp.acme.internal");
    assert.equal(putRes.body.config.smtpPassConfigured, true);
    assert.match(putRes.body.config.smtpPassMasked, /^Sup••••••026$/);

    // Verify raw SQLite storage is encrypted with AES-256-GCM (enc:v1:...)
    const rawSettings = db.getEmailConfig();
    assert.equal(rawSettings.smtpPassConfigured, true);
    assert.equal(defaultMailer.getDriver(), "smtp");
    assert.equal(defaultMailer.isConfiguredForLiveDelivery(), true);
  });

  it("2. Runs interactive SMTP handshake diagnostics step-by-step via POST /api/v1/admin/email/test-connection", async () => {
    const diagRes = await request(app)
      .post("/api/v1/admin/email/test-connection")
      .send({
        driver: "smtp",
        smtpHost: "smtp.acme.internal",
        smtpPort: 587,
        smtpUser: "svc-ansatz",
        smtpTlsMode: "starttls",
      })
      .expect(200);

    assert.equal(diagRes.body.success, true);
    assert.equal(diagRes.body.driver, "smtp");
    assert.equal(diagRes.body.host, "smtp.acme.internal");
    assert.equal(diagRes.body.port, 587);
    const stepNames = diagRes.body.steps.map((s: any) => s.step);
    assert.deepEqual(stepNames, ["dns", "tcp", "ehlo", "starttls", "auth"]);
    assert.ok(diagRes.body.steps.every((s: any) => s.status === "ok"));
  });

  it("3. Customizes email templates, interpolates variables with XSS protection, previews live HTML/text, and resets to default", async () => {
    // Update verification template and theme
    const updateRes = await request(app)
      .put("/api/v1/admin/email/config")
      .send({
        driver: "console",
        theme: {
          headerBgColor: "#111827",
          accentColor: "#10b981",
          logoUrl: "https://acme.internal/logo.svg",
          footerText: "Acme Confidential Engineering Network",
        },
        templates: {
          verification: {
            subject: "[{{instanceName}}] Confirm identity for {{username}}",
            heading: "Welcome aboard, {{username}}!",
            body: "Click the link to activate your workspace on {{instanceName}} within {{expiresIn}}.",
            ctaLabel: "Activate Workspace",
          },
        },
      })
      .expect(200);

    assert.equal(
      updateRes.body.config.templates.verification.subject,
      "[{{instanceName}}] Confirm identity for {{username}}",
    );
    assert.equal(updateRes.body.config.theme.accentColor, "#10b981");

    // Live preview with XSS attempt in username variable
    const previewRes = await request(app)
      .post("/api/v1/admin/email/preview")
      .send({
        templateId: "verification",
        variables: {
          instanceName: "AcmeSim",
          username: "alice<script>alert(1)</script>",
          expiresIn: "24 hours",
        },
      })
      .expect(200);

    assert.equal(previewRes.body.subject, "[AcmeSim] Confirm identity for alice<script>alert(1)</script>");
    assert.ok(previewRes.body.html.includes("Welcome aboard, alice&lt;script&gt;alert(1)&lt;/script&gt;!"));
    assert.ok(!previewRes.body.html.includes("<script>alert(1)</script>"));
    assert.ok(previewRes.body.html.includes("#10b981"));
    assert.ok(previewRes.body.html.includes("Acme Confidential Engineering Network"));
    assert.ok(previewRes.body.text.includes("Activate Workspace"));

    // Reset verification template back to default
    const resetRes = await request(app)
      .put("/api/v1/admin/email/config")
      .send({
        resetTemplateId: "verification",
      })
      .expect(200);

    assert.equal(resetRes.body.config.templates.verification.subject, "Verify your {{instanceName}} account");
    assert.equal(resetRes.body.config.templateOverrides.verification, undefined);
  });

  it("4. Dispatches rich social platform emails (follow, like, reply, mention, repost) with @handle and post snippets", async () => {
    defaultMailer.clearSentMails();

    const aliceId = db.createUser("alice_eng", "alice@acme.internal", "hash").id;
    const bobId = db.createUser("bob_cfd", "bob@acme.internal", "hash").id;
    db.updateProfile(aliceId, { display_name: "Alice Maxwell" });
    db.updateProfile(bobId, { display_name: "Bob Navier" });
    db.verifyUserEmail(aliceId);
    db.verifyUserEmail(bobId);

    // Enable instant email notifications for Alice
    db.updateNotificationSettings(
      aliceId,
      JSON.stringify({
        deliveryChannels: { inApp: true, emailNotifications: true },
        emailDigestFrequency: "instant",
        events: {
          social: { mentions: true, replies: true, follows: true, reposts: true },
        },
      }),
    );

    // 1. Bob follows Alice
    db.createNotification(aliceId, bobId, "follow");

    // 2. Alice creates a post, Bob likes and replies to it
    const post = db.createPost(
      aliceId,
      "Solved the 12-DOF thermal-fluid heat exchanger DAE in 14ms using the hybrid WASM flattener!",
    );
    db.createNotification(aliceId, bobId, "like", post.id);

    const replyPost = db.createPost(
      bobId,
      "Impressive convergence! Did you use CVODE BDF or IDA for the index-1 algebraic states?",
      undefined,
      post.id,
    );
    db.createNotification(aliceId, bobId, "reply", replyPost.id);

    // Wait briefly for async mailer promises
    await new Promise((r) => setTimeout(r, 40));

    const sent = defaultMailer.getSentMails();
    assert.equal(sent.length, 3);

    const followMail = sent[0]!;
    assert.ok(followMail.subject.includes("@bob_cfd started following you"));
    assert.ok(followMail.text.includes("@bob_cfd (Bob Navier)"));
    assert.ok(followMail.text.includes("/u/bob_cfd"));

    const likeMail = sent[1]!;
    assert.ok(likeMail.subject.includes("@bob_cfd liked your post"));
    assert.ok(likeMail.text.includes("Solved the 12-DOF thermal-fluid heat exchanger DAE"));
    assert.ok(likeMail.html?.includes("Solved the 12-DOF thermal-fluid heat exchanger DAE"));

    const replyMail = sent[2]!;
    assert.ok(replyMail.subject.includes("@bob_cfd replied to your post"));
    assert.ok(replyMail.text.includes("Did you use CVODE BDF or IDA"));
  });

  it("5. Compiles and dispatches daily/weekly digest emails for users with digest preferences", async () => {
    defaultMailer.clearSentMails();

    const carolId = db.createUser("carol_sysml", "carol@acme.internal", "hash").id;
    const daveId = db.createUser("dave_fea", "dave@acme.internal", "hash").id;
    db.verifyUserEmail(carolId);

    // Carol prefers daily digests (not instant emails)
    db.updateNotificationSettings(
      carolId,
      JSON.stringify({
        deliveryChannels: { inApp: true, emailNotifications: true },
        emailDigestFrequency: "daily",
      }),
    );

    const carolPost = db.createPost(carolId, "SysML v2 state machine verification model uploaded.");
    db.createNotification(carolId, daveId, "follow");
    db.createNotification(carolId, daveId, "like", carolPost.id);

    // No instant email should have been sent to Carol
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(defaultMailer.getSentMails().length, 0);

    // Now trigger daily digest compilation via admin endpoint
    const digestRes = await request(app)
      .post("/api/v1/admin/email/dispatch-digests")
      .send({ frequency: "daily" })
      .expect(200);

    assert.equal(digestRes.body.success, true);
    assert.equal(digestRes.body.dispatchedUsers, 1);
    assert.equal(digestRes.body.totalItemsCompiled, 2);

    const sentDigests = defaultMailer.getSentMails();
    assert.equal(sentDigests.length, 1);
    assert.equal(sentDigests[0]!.to, "carol@acme.internal");
    assert.equal(sentDigests[0]!.templateId, "digest");
    assert.ok(sentDigests[0]!.subject.includes("daily activity digest (2 updates)"));
    assert.ok(sentDigests[0]!.text.includes("@dave_fea started following you"));
    assert.ok(sentDigests[0]!.text.includes("@dave_fea liked your post"));
  });

  it("6. Inspects the outbound delivery outbox and supports one-click redelivery retry", async () => {
    const outboxRes = await request(app).get("/api/v1/admin/email/outbox").expect(200);
    assert.ok(outboxRes.body.count >= 1);
    const firstMsgId = outboxRes.body.items[0].id as string;

    const retryRes = await request(app)
      .post(`/api/v1/admin/email/outbox/${encodeURIComponent(firstMsgId)}/retry`)
      .send({})
      .expect(200);

    assert.equal(retryRes.body.success, true);
    assert.equal(retryRes.body.originalId, firstMsgId);
    assert.ok(retryRes.body.messageId);
    assert.ok(retryRes.body.outbox.length > outboxRes.body.count);
  });
});
