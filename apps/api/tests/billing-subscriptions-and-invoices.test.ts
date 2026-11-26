// SPDX-License-Identifier: AGPL-3.0-or-later

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
import { defaultPaymentGuard } from "../src/services/billing/payment-guard.js";

function signUserToken(user: { id: number; username: string; email: string; account_type?: string }): string {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      accountType: user.account_type || "user",
    },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

test("Stripe Subscriptions Checkout, Webhook Persistence & Invoice Org RBAC", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "billing-subs-invoices-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  const owner = db.createUser("org_owner_bill", "owner@billing.test", "hash1", {
    accountType: "user",
    emailVerified: true,
  });
  const maintainer = db.createUser("org_maint_bill", "maint@billing.test", "hash2", {
    accountType: "user",
    emailVerified: true,
  });
  const contributor = db.createUser("org_contrib_bill", "contrib@billing.test", "hash3", {
    accountType: "user",
    emailVerified: true,
  });
  const outsider = db.createUser("outsider_bill", "outsider@billing.test", "hash4", {
    accountType: "user",
    emailVerified: true,
  });

  const ownerToken = signUserToken(owner);
  const maintainerToken = signUserToken(maintainer);
  const contributorToken = signUserToken(contributor);
  const outsiderToken = signUserToken(outsider);

  const org = db.createOrganization({
    name: "Billing Test Org",
    slug: "billing-test-org",
    createdBy: owner.id,
  });
  db.addOrganizationMember(org.id, maintainer.id, "maintainer");
  db.addOrganizationMember(org.id, contributor.id, "contributor");

  t.after(() => {
    defaultPaymentGuard.resetAll();
    delete process.env["STRIPE_SECRET_KEY"];
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  await t.test(
    "POST /api/v1/billing/subscriptions/checkout rejects invalid tiers and billing cycles (400)",
    async () => {
      for (const badBody of [
        { tier: "free", billingCycle: "monthly" },
        { tier: "enterprise", billingCycle: "annual" },
        { tier: "invalid", billingCycle: "monthly" },
        { tier: "pro", billingCycle: "weekly" },
        { tier: "team", billingCycle: "one_time" },
        {},
      ]) {
        const res = await request(app)
          .post("/api/v1/billing/subscriptions/checkout")
          .set("Authorization", `Bearer ${ownerToken}`)
          .send(badBody);
        assert.strictEqual(res.status, 400, `Expected 400 for body ${JSON.stringify(badBody)}, got ${res.status}`);
      }
    },
  );

  await t.test(
    "POST /api/v1/billing/subscriptions/checkout builds exact recurring USD amounts in subscription mode",
    async () => {
      const cases: Array<{
        tier: "pro" | "team";
        billingCycle: "monthly" | "annual";
        expectedCents: number;
        expectedInterval: "month" | "year";
      }> = [
        { tier: "pro", billingCycle: "monthly", expectedCents: 2900, expectedInterval: "month" },
        { tier: "pro", billingCycle: "annual", expectedCents: 28800, expectedInterval: "year" },
        { tier: "team", billingCycle: "monthly", expectedCents: 9900, expectedInterval: "month" },
        { tier: "team", billingCycle: "annual", expectedCents: 94800, expectedInterval: "year" },
      ];

      const originalFetch = globalThis.fetch;
      const prevStripeKey = process.env["STRIPE_SECRET_KEY"];
      process.env["STRIPE_SECRET_KEY"] = "sk_test_mock_subscriptions";

      try {
        for (const c of cases) {
          let capturedUrl = "";
          let capturedParams: URLSearchParams | null = null;
          globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            capturedUrl = String(input);
            capturedParams = new URLSearchParams(String(init?.body ?? ""));
            return new Response(
              JSON.stringify({
                id: `cs_sub_${c.tier}_${c.billingCycle}`,
                url: `https://checkout.stripe.com/c/pay/cs_sub_${c.tier}_${c.billingCycle}`,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }) as typeof fetch;

          const res = await request(app)
            .post("/api/v1/billing/subscriptions/checkout")
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ tier: c.tier, billingCycle: c.billingCycle });

          assert.strictEqual(res.status, 201, `Expected 201 for ${c.tier}/${c.billingCycle}`);
          assert.strictEqual(res.body.mode, "subscription");
          assert.strictEqual(res.body.tier, c.tier);
          assert.strictEqual(res.body.billingCycle, c.billingCycle);
          assert.strictEqual(res.body.amountCents, c.expectedCents);
          assert.strictEqual(res.body.interval, c.expectedInterval);
          assert.strictEqual(res.body.currency, "usd");

          // Verify the exact Stripe API form payload
          assert.strictEqual(capturedUrl, "https://api.stripe.com/v1/checkout/sessions");
          assert.ok(capturedParams, "Expected Stripe checkout POST body");
          const params = capturedParams as URLSearchParams;
          assert.strictEqual(params.get("mode"), "subscription");
          assert.strictEqual(params.get("line_items[0][price_data][currency]"), "usd");
          assert.strictEqual(params.get("line_items[0][price_data][unit_amount]"), String(c.expectedCents));
          assert.strictEqual(params.get("line_items[0][price_data][recurring][interval]"), c.expectedInterval);
          assert.strictEqual(params.get("metadata[kind]"), "subscription");
          assert.strictEqual(params.get("metadata[tier]"), c.tier);
          assert.strictEqual(params.get("metadata[billingCycle]"), c.billingCycle);
          assert.strictEqual(params.get("metadata[userId]"), String(owner.id));
          // Guard against legacy one-time credit pack amounts
          assert.notStrictEqual(c.expectedCents, 20000);
          assert.notStrictEqual(c.expectedCents, 240000);
          assert.notStrictEqual(c.expectedCents, 720000);
        }
      } finally {
        globalThis.fetch = originalFetch;
        if (prevStripeKey === undefined) {
          delete process.env["STRIPE_SECRET_KEY"];
        } else {
          process.env["STRIPE_SECRET_KEY"] = prevStripeKey;
        }
      }
    },
  );

  await t.test("Webhooks persist activeTier across checkout.session.completed, updated, and deleted", async () => {
    // Initially free
    const initialSummary = await request(app)
      .get("/api/v1/billing/summary")
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.strictEqual(initialSummary.status, 200);
    assert.strictEqual(initialSummary.body.activeTier, "free");

    // 1. checkout.session.completed (subscription mode) activates Pro
    const completedRes = await request(app)
      .post("/api/v1/billing/webhook")
      .send({
        id: "evt_sub_completed_1",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_sub_1",
            mode: "subscription",
            payment_status: "paid",
            subscription: "sub_test_owner_001",
            customer: "cus_test_owner_001",
            metadata: {
              userId: String(owner.id),
              tier: "pro",
              billingCycle: "annual",
              kind: "subscription",
            },
          },
        },
      });
    assert.strictEqual(completedRes.status, 200);
    assert.strictEqual(completedRes.body.handled, true);
    assert.strictEqual(completedRes.body.action, "subscription_activated");

    const proSummary = await request(app).get("/api/v1/billing/summary").set("Authorization", `Bearer ${ownerToken}`);
    assert.strictEqual(proSummary.status, 200);
    assert.strictEqual(proSummary.body.activeTier, "pro");
    assert.strictEqual(proSummary.body.subscriptionStatus, "active");

    // 2. customer.subscription.updated upgrades to Team
    const updatedRes = await request(app)
      .post("/api/v1/billing/webhook")
      .send({
        id: "evt_sub_updated_1",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_test_owner_001",
            status: "active",
            metadata: {
              tier: "team",
              billingCycle: "monthly",
            },
          },
        },
      });
    assert.strictEqual(updatedRes.status, 200);
    assert.strictEqual(updatedRes.body.action, "subscription_updated");

    const teamSummary = await request(app).get("/api/v1/billing/summary").set("Authorization", `Bearer ${ownerToken}`);
    assert.strictEqual(teamSummary.status, 200);
    assert.strictEqual(teamSummary.body.activeTier, "team");

    // 3. customer.subscription.deleted reverts to Free (resolved by stripeSubscriptionId)
    const deletedRes = await request(app)
      .post("/api/v1/billing/webhook")
      .send({
        id: "evt_sub_deleted_1",
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_test_owner_001",
            status: "canceled",
          },
        },
      });
    assert.strictEqual(deletedRes.status, 200);
    assert.strictEqual(deletedRes.body.action, "subscription_canceled");

    const freeSummary = await request(app).get("/api/v1/billing/summary").set("Authorization", `Bearer ${ownerToken}`);
    assert.strictEqual(freeSummary.status, 200);
    assert.strictEqual(freeSummary.body.activeTier, "free");
    assert.strictEqual(freeSummary.body.subscriptionStatus, "canceled");

    // 4. Org subscription webhook persists on GET /api/v1/billing/orgs/:orgId/summary
    const orgSubRes = await request(app)
      .post("/api/v1/billing/webhook")
      .send({
        id: "evt_org_sub_1",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_org_sub_1",
            mode: "subscription",
            payment_status: "paid",
            subscription: "sub_test_org_001",
            metadata: {
              userId: String(owner.id),
              orgId: String(org.id),
              tier: "team",
              billingCycle: "annual",
              kind: "subscription",
            },
          },
        },
      });
    assert.strictEqual(orgSubRes.status, 200);
    const orgSummary = await request(app)
      .get(`/api/v1/billing/orgs/${org.id}/summary`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.strictEqual(orgSummary.status, 200);
    assert.strictEqual(orgSummary.body.activeTier, "team");
    assert.strictEqual(orgSummary.body.subscriptionStatus, "active");
  });

  await t.test(
    "GET /api/v1/billing/invoices/:txId allows org owner/maintainer and rejects non-members with 403",
    async () => {
      // Maintainer tops up the org wallet -> transaction belongs to maintainer user_id with org_id = org.id
      db.grantOrgCredits(org.id, 150, maintainer.id, "Org Shared Top-Up by Maintainer");
      const orgWallet = db.billing.getOrgWalletSummary(org.id);
      assert.ok(orgWallet && orgWallet.transactions.length > 0);
      const orgTx = orgWallet.transactions[0]!;
      assert.strictEqual(orgTx.user_id, maintainer.id);

      // Org owner (different user than tx.user_id) can download invoice HTML
      const ownerRes = await request(app)
        .get(`/api/v1/billing/invoices/${orgTx.id}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .set("Accept", "text/html");
      assert.strictEqual(ownerRes.status, 200);
      assert.ok(ownerRes.text.includes("Org Shared Top-Up by Maintainer"));

      // Org owner can also fetch JSON representation
      const ownerJsonRes = await request(app)
        .get(`/api/v1/billing/invoices/${orgTx.id}?format=json`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.strictEqual(ownerJsonRes.status, 200);
      assert.strictEqual(ownerJsonRes.body.invoice.transactionId, orgTx.id);

      // Maintainer (tx creator & maintainer) can download invoice
      const maintRes = await request(app)
        .get(`/api/v1/billing/invoices/${orgTx.id}`)
        .set("Authorization", `Bearer ${maintainerToken}`)
        .set("Accept", "text/html");
      assert.strictEqual(maintRes.status, 200);

      // Org contributor (not owner/maintainer) is rejected with 403
      const contribRes = await request(app)
        .get(`/api/v1/billing/invoices/${orgTx.id}`)
        .set("Authorization", `Bearer ${contributorToken}`);
      assert.strictEqual(contribRes.status, 403);

      // Non-member outsider is rejected with 403
      const outsiderRes = await request(app)
        .get(`/api/v1/billing/invoices/${orgTx.id}`)
        .set("Authorization", `Bearer ${outsiderToken}`);
      assert.strictEqual(outsiderRes.status, 403);
    },
  );
});
