// SPDX-License-Identifier: AGPL-3.0-or-later

process.env["NODE_ENV"] = "test";

import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { isIpTrustedProxy } from "../src/middleware/auth-middleware.js";
import { verifySignedEmbedToken } from "../src/routes/oembed.js";
import { handleStripeWebhookEvent } from "../src/services/billing/payment-guard.js";
import { LibraryStorage } from "../src/storage.js";
import { verifyCaptchaToken } from "../src/util/captcha.js";
import { seedInitialAdmin } from "../src/util/seed-admin.js";
import { assertSafePublicUrl, resolveAndValidatePublicHost } from "../src/util/ssrf.js";

const JWT_SECRET = process.env["JWT_SECRET"] || "modelscript-dev-secret";

describe("Commercial Production Hardening (Pillars 1, 2, & 3)", () => {
  let tmpDir: string;
  let db: LibraryDatabase;
  let storage: LibraryStorage;
  let server: Server;
  let baseUrl: string;
  let userToken: string;
  let userId: number;

  before(async () => {
    process.env["AIRGAP_ENFORCED"] = "true";
    process.env["ENTERPRISE_APPLIANCE"] = "true";

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-commercial-hardening-"));
    db = new LibraryDatabase(tmpDir);
    storage = new LibraryStorage(path.join(tmpDir, "libraries"));

    const userRes = db.createUser("customer_one", "customer1@corp.internal", "hashed_pw");
    userId = Number(userRes.id);
    userToken = jwt.sign(
      { id: userId, username: "customer_one", email: "customer1@corp.internal", tokenVersion: 1 },
      JWT_SECRET,
      { expiresIn: "1h" },
    );

    const app = createApp({ database: db, storage });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    delete process.env["AIRGAP_ENFORCED"];
    delete process.env["ENTERPRISE_APPLIANCE"];
    delete process.env["TRUSTED_PROXY_IPS"];
    delete process.env["ALLOWED_INTRANET_HOSTS"];
    delete process.env["ALLOWED_INTRANET_CIDRS"];
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (db && db.isOpen()) {
      db.close();
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("Pillar 1: deduplicates Stripe webhook events and payment_intent IDs so credits are never double-granted", () => {
    const initialBalance = db.getUserBalance(userId);

    const eventPayload = {
      id: "evt_live_test_101",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_live_test_101",
          amount: 12550, // 125.50 credits
          metadata: {
            userId: String(userId),
          },
        },
      },
    };

    // First delivery credits +125.50
    const res1 = handleStripeWebhookEvent(eventPayload, db);
    assert.equal(res1.handled, true);
    assert.equal(res1.action, "credits_granted");
    assert.equal(db.getUserBalance(userId), Math.round((initialBalance + 125.5) * 100) / 100);

    // Replay with same event ID -> ignored as duplicate
    const res2 = handleStripeWebhookEvent(eventPayload, db);
    assert.equal(res2.handled, true);
    assert.equal(res2.action, "duplicate_event_ignored");
    assert.equal(db.getUserBalance(userId), Math.round((initialBalance + 125.5) * 100) / 100);

    // Replay with different event ID but same payment_intent ID -> ignored as duplicate
    const res3 = handleStripeWebhookEvent(
      {
        ...eventPayload,
        id: "evt_live_test_102_retry",
      },
      db,
    );
    assert.equal(res3.handled, true);
    assert.equal(res3.action, "duplicate_event_ignored");
    assert.equal(db.getUserBalance(userId), Math.round((initialBalance + 125.5) * 100) / 100);
  });

  it("Pillar 1: enforces paymentIntentId idempotency on POST /api/v1/billing/topup and revokes tokens + escrows on dispute freeze", async () => {
    // 1. Sandbox top-up with paymentIntentId succeeds once, then returns 409 on replay
    const topupRes1 = await fetch(`${baseUrl}/api/v1/billing/topup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        amount: 50,
        paymentMethod: "sandbox_card",
        paymentIntentId: "pi_sandbox_unique_900",
      }),
    });
    assert.equal(topupRes1.status, 200);

    const topupRes2 = await fetch(`${baseUrl}/api/v1/billing/topup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        amount: 50,
        paymentMethod: "sandbox_card",
        paymentIntentId: "pi_sandbox_unique_900",
      }),
    });
    assert.equal(topupRes2.status, 409);

    // 2. Verify dispute freeze revokes token_version, freezes active escrow holds, and writes audit log
    const disputeUser = db.createUser("dispute_user", "dispute@corp.internal", "pw");
    const disputeUserId = Number(disputeUser.id);
    const jobId = db.createJob("Dispute Escrow Job", "RUNNING", "ADHOC", "ide", null, {}, disputeUserId);
    const holdRes = db.holdUserCredits(disputeUserId, 25, jobId, "Pre-flight hold");
    assert.equal(holdRes.success, true);

    const tokenVerBefore = db.getUserById(disputeUserId)?.token_version ?? 0;
    db.freezeUserForDispute(disputeUserId, "dp_chargeback_001", "fraudulent");
    const userAfter = db.getUserById(disputeUserId);
    assert.equal(userAfter?.status, "suspended_dispute");
    assert.equal(userAfter?.token_version, tokenVerBefore + 1);
    assert.equal(db.getUserBalance(disputeUserId), 0);
  });

  it("Pillar 2: stores and retrieves content-addressable morsel snippets and resolves oEmbed & signed embed tokens", async () => {
    const modelCode = "model GridInverter\n  parameter Real Vnom = 400.0;\nequation\nend GridInverter;";
    const createRes = await fetch(`${baseUrl}/api/v1/morsels`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        dialect: "modelica",
        code: modelCode,
        title: "Grid Inverter Control",
        view: "diagram",
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { id: string; embedUrl: string };
    assert.ok(created.id.length >= 12);
    assert.equal(created.embedUrl, `/embed/playground?morsel=${created.id}`);

    // Deduplication: saving identical dialect+code+view returns the same content-addressed ID
    const createResDup = await fetch(`${baseUrl}/api/v1/morsels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dialect: "modelica",
        code: modelCode,
        title: "Grid Inverter Control",
        view: "diagram",
      }),
    });
    assert.equal(createResDup.status, 201);
    const createdDup = (await createResDup.json()) as { id: string };
    assert.equal(createdDup.id, created.id);

    // Fetch morsel by ID
    const getRes = await fetch(`${baseUrl}/api/v1/morsels/${created.id}`);
    assert.equal(getRes.status, 200);
    const fetched = (await getRes.json()) as { code: string; title: string; dialect: string };
    assert.equal(fetched.code, modelCode);
    assert.equal(fetched.title, "Grid Inverter Control");

    // oEmbed resolution for ?morsel=<id>
    const oembedRes = await fetch(
      `${baseUrl}/api/v1/oembed?url=${encodeURIComponent(`https://intranet.corp/embed/playground?morsel=${created.id}`)}`,
    );
    assert.equal(oembedRes.status, 200);
    const oembedData = (await oembedRes.json()) as { title: string; html: string };
    assert.equal(oembedData.title, "Grid Inverter Control");
    assert.ok(oembedData.html.includes(`/embed/playground?morsel=${created.id}`));

    // Signed intranet embed token generation & origin validation
    const tokenRes = await fetch(`${baseUrl}/api/v1/artifacts/42/embed-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        allowedOrigins: ["https://confluence.corp.internal"],
        ttlSeconds: 3600,
      }),
    });
    assert.equal(tokenRes.status, 201);
    const tokenBody = (await tokenRes.json()) as { embedToken: string };
    assert.ok(tokenBody.embedToken.includes("."));

    const validCheck = verifySignedEmbedToken(tokenBody.embedToken, "42", "https://confluence.corp.internal");
    assert.equal(validCheck.valid, true);

    const wrongOriginCheck = verifySignedEmbedToken(tokenBody.embedToken, "42", "https://evil.example.com");
    assert.equal(wrongOriginCheck.valid, false);
  });

  it("Pillar 2 & 3: relaxes X-Frame-Options and frame-ancestors on embed routes while keeping strict SAMEORIGIN on non-embed routes", async () => {
    // Non-embed route (/health) must enforce X-Frame-Options: SAMEORIGIN and frame-ancestors 'self'
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.ok(healthRes.headers.get("content-security-policy")?.includes("frame-ancestors 'self'"));

    // Embed route (/api/v1/oembed) must omit X-Frame-Options and allow frame-ancestors
    const embedRes = await fetch(
      `${baseUrl}/api/v1/oembed?url=${encodeURIComponent("https://intranet.corp/embed/playground")}`,
    );
    assert.equal(embedRes.headers.get("x-frame-options"), null);
    assert.ok(embedRes.headers.get("content-security-policy")?.includes("frame-ancestors *"));
  });

  it("Pillar 3: supports CIDR subnet blocks in TRUSTED_PROXY_IPS, intranet SSRF allowlists, and airgapped readiness probes", async () => {
    const prevNodeEnv = process.env["NODE_ENV"];
    const prevLicenseEnforce = process.env["MSX_LICENSE_ENFORCE"];
    try {
      process.env["NODE_ENV"] = "production";
      process.env["MSX_LICENSE_ENFORCE"] = "false";
      process.env["TRUSTED_PROXY_IPS"] = "127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16";

      assert.equal(isIpTrustedProxy("10.24.19.8"), true);
      assert.equal(isIpTrustedProxy("::ffff:172.20.0.5"), true);
      assert.equal(isIpTrustedProxy("192.168.100.42"), true);
      assert.equal(isIpTrustedProxy("8.8.8.8"), false);

      // Intranet SSRF allowlist
      process.env["ALLOWED_INTRANET_HOSTS"] = ".corp.internal,vllm.grid.lan";
      process.env["ALLOWED_INTRANET_CIDRS"] = "10.50.0.0/16";

      const allowedHostUrl = assertSafePublicUrl("http://ollama.corp.internal:11434/v1/chat/completions");
      assert.equal(allowedHostUrl.hostname, "ollama.corp.internal");

      const allowedIpUrl = assertSafePublicUrl("http://10.50.12.9:8000/v1/models");
      assert.equal(allowedIpUrl.hostname, "10.50.12.9");

      const resolvedIps = await resolveAndValidatePublicHost("ollama.corp.internal", async () => [
        { address: "10.50.12.9", family: 4 },
      ]);
      assert.deepEqual(resolvedIps, ["10.50.12.9"]);

      // Unallowlisted cloud metadata IP is still strictly blocked
      assert.throws(() => assertSafePublicUrl("http://169.254.169.254/latest/meta-data/"), /Forbidden private IPv4/);

      // Captcha verification succeeds in airgap mode without TURNSTILE_SECRET_KEY
      const captchaOk = await verifyCaptchaToken("airgap-client-token", "10.0.0.5", "");
      assert.equal(captchaOk.success, true);

      // Readiness probe returns 200 in production airgapped appliance when JWT_SECRET and admin exist
      const prevJwtSecret = process.env["JWT_SECRET"];
      process.env["JWT_SECRET"] = crypto.randomBytes(32).toString("hex");
      process.env["ADMIN_INIT_USERNAME"] = "grid_admin";
      process.env["ADMIN_INIT_PASSWORD"] = "StrongUtilityPass!2026";
      await seedInitialAdmin(db);

      const readyRes = await fetch(`${baseUrl}/api/v1/compliance/readiness`);
      assert.equal(readyRes.status, 200);
      const readyBody = (await readyRes.json()) as { status: string };
      assert.equal(readyBody.status, "ready");
      if (prevJwtSecret === undefined) {
        delete process.env["JWT_SECRET"];
      } else {
        process.env["JWT_SECRET"] = prevJwtSecret;
      }
    } finally {
      process.env["NODE_ENV"] = prevNodeEnv;
      if (prevLicenseEnforce === undefined) {
        delete process.env["MSX_LICENSE_ENFORCE"];
      } else {
        process.env["MSX_LICENSE_ENFORCE"] = prevLicenseEnforce;
      }
    }
  });

  it("Pillar 1 (Round 2): supports Stripe Checkout Sessions with automatic tax, tax invoices/receipts, and Organization Shared Wallets", async () => {
    // 1. Create Stripe Checkout Session with automaticTax
    const csRes = await fetch(`${baseUrl}/api/v1/billing/checkout-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ amount: 250 }),
    });
    assert.equal(csRes.status, 201);
    const csBody = (await csRes.json()) as {
      sessionId: string;
      checkoutUrl: string;
      automaticTax: boolean;
      taxIdCollection: boolean;
      amountCredits: number;
    };
    assert.ok(csBody.sessionId.startsWith("cs_"));
    assert.equal(csBody.automaticTax, true);
    assert.equal(csBody.taxIdCollection, true);
    assert.equal(csBody.amountCredits, 250);

    // 2. Process checkout.session.completed webhook idempotently
    const balanceBefore = db.getUserBalance(userId);
    const csPayload = JSON.stringify({
      id: "evt_cs_commercial_001",
      type: "checkout.session.completed",
      data: {
        object: {
          id: csBody.sessionId,
          payment_intent: "pi_from_cs_001",
          amount_subtotal: 25000,
          amount_total: 27000,
          metadata: { userId: String(userId), amountCredits: "250" },
        },
      },
    });
    const webhookSecret = "whsec_commercial_round2";
    process.env["STRIPE_WEBHOOK_SECRET"] = webhookSecret;
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", webhookSecret).update(`${ts}.${csPayload}`).digest("hex");

    const whRes = await fetch(`${baseUrl}/api/v1/billing/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": `t=${ts},v1=${sig}`,
      },
      body: csPayload,
    });
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    assert.equal(whRes.status, 200);
    assert.equal(db.getUserBalance(userId), balanceBefore + 250);

    // 3. Fetch printable HTML tax invoice & JSON invoice for latest transaction
    const txs = db.getUserTransactions(userId, 5, 0);
    assert.ok(txs.length > 0);
    const latestTxId = txs[0]!.id;

    const invJsonRes = await fetch(`${baseUrl}/api/v1/billing/invoices/${latestTxId}?format=json`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(invJsonRes.status, 200);
    const invJson = (await invJsonRes.json()) as {
      invoice: { invoiceNumber: string; amountCredits: number; currency: string };
    };
    assert.ok(invJson.invoice.invoiceNumber.startsWith("INV-"));
    assert.equal(invJson.invoice.currency, "USD");

    const invHtmlRes = await fetch(`${baseUrl}/api/v1/billing/invoices/${latestTxId}?format=html`, {
      headers: { Authorization: `Bearer ${userToken}`, Accept: "text/html" },
    });
    assert.equal(invHtmlRes.status, 200);
    const invHtml = await invHtmlRes.text();
    assert.ok(invHtml.includes(invJson.invoice.invoiceNumber));
    assert.ok(invHtml.includes("Tax Invoice &amp; Compute Ledger Receipt"));

    // 4. Create an organization and test Organization Shared Wallet top-up and balance
    const org = db.createOrganization({
      slug: "acme-grid",
      name: "Acme Grid Corp",
      description: "Enterprise Power Systems",
      createdBy: userId,
    });
    const orgId = org.id;
    const orgTopupRes = await fetch(`${baseUrl}/api/v1/billing/orgs/${orgId}/topup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ amount: 500, description: "Annual Utility Compute Pool" }),
    });
    assert.equal(orgTopupRes.status, 200);
    const orgTopupBody = (await orgTopupRes.json()) as { newBalance: number };
    assert.equal(orgTopupBody.newBalance, 500);

    const orgWalletRes = await fetch(`${baseUrl}/api/v1/billing/orgs/${orgId}/wallet`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(orgWalletRes.status, 200);
    const orgWallet = (await orgWalletRes.json()) as {
      balance: number;
      transactions: { description: string }[];
    };
    assert.equal(orgWallet.balance, 500);
    assert.ok(orgWallet.transactions.some((t) => t.description === "Annual Utility Compute Pool"));
  });

  it("Pillar 2 & 3 (Round 2): serves standalone /static/embed.js bundle, enforces ?embed_token= on private artifacts, and creates hot SQLite backups", async () => {
    // 1. Standalone /static/embed.js bundle
    const bundleRes = await fetch(`${baseUrl}/static/embed.js`);
    assert.equal(bundleRes.status, 200);
    assert.ok(bundleRes.headers.get("content-type")?.includes("application/javascript"));
    const bundleText = await bundleRes.text();
    assert.ok(bundleText.includes("modelscript-morsel"));
    assert.ok(bundleText.includes("modelscript-viewer"));
    assert.ok(bundleText.includes("rehydrateEmbeds"));

    // 2. Private artifact enforcement with ?embed_token=
    const otherUser = db.createUser("private_author", "author@corp.internal", "pw");
    const privArtId = db.createArtifactView(
      Number(otherUser.id),
      "modelica-code",
      "upload",
      JSON.stringify({ code: "model SecretGrid end SecretGrid;", private: true }),
      "Classified Substation Model",
    );

    // Unauthenticated request without embed_token is rejected with 403
    const unauthArtRes = await fetch(`${baseUrl}/api/v1/social/artifact-views/${privArtId}`);
    assert.equal(unauthArtRes.status, 403);

    // Issue a signed embed token restricted to https://intranet.corp.internal
    const tokenRes = await fetch(`${baseUrl}/api/v1/artifacts/${privArtId}/embed-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        allowedOrigins: ["https://intranet.corp.internal"],
        ttlSeconds: 3600,
      }),
    });
    assert.equal(tokenRes.status, 201);
    const { embedToken } = (await tokenRes.json()) as { embedToken: string };

    // Request with valid embed_token and matching Origin succeeds
    const validArtRes = await fetch(
      `${baseUrl}/api/v1/social/artifact-views/${privArtId}?embed_token=${encodeURIComponent(embedToken)}`,
      { headers: { Origin: "https://intranet.corp.internal" } },
    );
    assert.equal(validArtRes.status, 200);

    // Request with valid embed_token but unauthorized Origin is rejected with 403
    const badOriginArtRes = await fetch(
      `${baseUrl}/api/v1/social/artifact-views/${privArtId}?embed_token=${encodeURIComponent(embedToken)}`,
      { headers: { Origin: "https://untrusted.external.site" } },
    );
    assert.equal(badOriginArtRes.status, 403);

    // 3. Hot SQLite WAL Backup via POST /api/v1/admin/backup
    const adminUser = db.getUserByUsername("grid_admin")!;
    assert.ok(adminUser);
    const adminToken = jwt.sign(
      {
        id: Number(adminUser.id),
        username: adminUser.username,
        email: adminUser.email || "grid_admin@corp.internal",
        role: "admin",
        tokenVersion: 1,
      },
      JWT_SECRET,
      { expiresIn: "1h" },
    );

    const backupRes = await fetch(`${baseUrl}/api/v1/admin/backup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ label: "pre-upgrade" }),
    });
    assert.equal(backupRes.status, 201);
    const backupBody = (await backupRes.json()) as {
      success: boolean;
      backup: { fileName: string; backupPath: string; sizeBytes: number };
    };
    assert.equal(backupBody.success, true);
    assert.ok(backupBody.backup.fileName.includes("pre-upgrade"));
    assert.ok(backupBody.backup.sizeBytes > 0);
    assert.equal(fs.existsSync(backupBody.backup.backupPath), true);

    const listBackupsRes = await fetch(`${baseUrl}/api/v1/admin/backups`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(listBackupsRes.status, 200);
    const listBackupsBody = (await listBackupsRes.json()) as { count: number; backups: { fileName: string }[] };
    assert.ok(listBackupsBody.count >= 1);
    assert.ok(listBackupsBody.backups.some((b) => b.fileName === backupBody.backup.fileName));
  });
});
