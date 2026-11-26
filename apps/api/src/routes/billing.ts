// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Router } from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import { registerOpenApiOperation, validateBody, type ObjectSchema } from "../middleware/validate.js";
import {
  createStripeCheckoutSession,
  createStripePaymentIntent,
  createStripeSubscriptionCheckoutSession,
  defaultPaymentGuard,
  handleStripeWebhookEvent,
  PAYMENT_LIMITS,
  verifyStripePaymentIntent,
} from "../services/billing/payment-guard.js";
import { resolveRequestUserId } from "../services/hpc/quota-guard.js";
import { getClientIp } from "../util/client-ip.js";
import { escapeHtml } from "../util/escape.js";

function isSandboxTopupAllowed(): boolean {
  const nodeEnv = process.env["NODE_ENV"];
  const allowSandbox = process.env["ALLOW_SANDBOX_TOPUP"];
  const ansatzTier = process.env["ANSATZ_TIER"];
  const stripeKey = process.env["STRIPE_SECRET_KEY"] || "";
  const isLiveStripe = stripeKey.startsWith("sk_live_");

  // Always fail closed in production or when a live Stripe key is configured
  if (nodeEnv === "production" || isLiveStripe) {
    return false;
  }

  // Flagship tier requires explicit opt-in even outside production
  if (ansatzTier === "tier3_flagship") {
    return allowSandbox === "true";
  }

  // Test and development environments allow sandbox top-ups unless explicitly disabled
  if (nodeEnv === "test" || nodeEnv === "development") {
    return allowSandbox !== "false";
  }

  // Staging or unset NODE_ENV fails closed unless explicitly opted in
  return allowSandbox === "true";
}

function safeTimingEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

const BILLING_PAYMENT_INTENT_SCHEMA: ObjectSchema = {
  type: "object",
  description: "Stripe PaymentIntent creation payload with mandatory 3DS2 and Radar fraud checks.",
  required: ["amount"],
  properties: {
    amount: {
      type: "number",
      required: true,
      min: PAYMENT_LIMITS.MIN_TOPUP_CREDITS,
      max: PAYMENT_LIMITS.MAX_TOPUP_CREDITS,
      description: `Top-up amount in compute credits (${PAYMENT_LIMITS.MIN_TOPUP_CREDITS} to ${PAYMENT_LIMITS.MAX_TOPUP_CREDITS}).`,
    },
    customerCountry: {
      type: "string",
      description: "ISO 3166-1 alpha-2 country code of the customer.",
    },
    cardCountry: {
      type: "string",
      description: "ISO 3166-1 alpha-2 country code of the payment card issuer.",
    },
    simulateRadarScore: {
      type: "number",
      min: 0,
      max: 100,
      description: "Simulated Stripe Radar risk score (0-100, non-production testing only).",
    },
    idempotencyKey: {
      type: "string",
      description: "Optional idempotency key to prevent duplicate PaymentIntent creation.",
    },
  },
};

const BILLING_TOPUP_SCHEMA: ObjectSchema = {
  type: "object",
  description: "Compute credit wallet top-up payload with anti-carding protections.",
  required: ["amount"],
  properties: {
    amount: {
      type: "number",
      required: true,
      min: PAYMENT_LIMITS.MIN_TOPUP_CREDITS,
      max: PAYMENT_LIMITS.MAX_TOPUP_CREDITS,
      description: `Top-up amount in compute credits (${PAYMENT_LIMITS.MIN_TOPUP_CREDITS} to ${PAYMENT_LIMITS.MAX_TOPUP_CREDITS}).`,
    },
    description: {
      type: "string",
      description: "Optional ledger description for the credit top-up.",
    },
    paymentMethod: {
      type: "string",
      description: "Payment method label (e.g. sandbox_card, stripe).",
    },
    paymentIntentId: {
      type: "string",
      description: "Settled Stripe PaymentIntent ID (required in production).",
    },
    simulatePaymentFailure: {
      type: "boolean",
      description: "Simulate a declined card charge for anti-carding testing (non-production only).",
    },
  },
};

registerOpenApiOperation("post", "/api/v1/billing/payment-intent", {
  summary: "Create a Stripe PaymentIntent with 3DS2 and Radar fraud checks",
  tags: ["billing"],
  security: [{ BearerAuth: [] }, { CookieAuth: [] }],
  requestBody: BILLING_PAYMENT_INTENT_SCHEMA,
  responses: {
    "201": { description: "PaymentIntent created with client secret and risk assessment." },
    "400": { description: "Invalid top-up amount or payment intent parameters." },
    "401": { description: "Unauthorized." },
    "403": { description: "Blocked by Stripe Radar fraud rules." },
    "429": { description: "Billing actions temporarily locked due to excessive failed attempts." },
  },
});

registerOpenApiOperation("post", "/api/v1/billing/topup", {
  summary: "Top up the authenticated user's compute credit wallet",
  tags: ["billing"],
  security: [{ BearerAuth: [] }, { CookieAuth: [] }],
  requestBody: BILLING_TOPUP_SCHEMA,
  responses: {
    "200": { description: "Credits added and updated wallet balance returned." },
    "400": { description: "Invalid top-up amount or outside allowed credit bounds." },
    "401": { description: "Unauthorized." },
    "402": { description: "Payment declined by card issuer." },
    "403": { description: "Direct sandbox top-up disabled in production or PaymentIntent verification failed." },
    "409": { description: "PaymentIntent has already been settled." },
    "429": { description: "Billing actions temporarily locked due to excessive failed attempts." },
  },
});

export function billingRouter(database: LibraryDatabase): Router {
  const router = express.Router();

  const billingRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env["NODE_ENV"] === "test",
    message: { error: "Too many billing requests. Please try again later." },
  });

  // ── GET /api/v1/billing/wallet ──
  // Current wallet balance, account tier, and summary stats
  router.get("/billing/wallet", (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const summary = database.billing.getUserBillingSummary(userId);
      res.json({
        userId: summary.userId,
        creditBalance: summary.creditBalance,
        totalSpent: summary.totalSpent,
        totalJobs: summary.totalJobs,
        totalCpuSeconds: summary.totalCpuSeconds,
        totalGpuSeconds: summary.totalGpuSeconds,
        balance: summary.creditBalance,
        total_spent: summary.totalSpent,
        total_jobs_dispatched: summary.totalJobs,
        total_cpu_core_hours: summary.wallet.total_cpu_core_hours,
        total_gpu_hours: summary.wallet.total_gpu_hours,
        activeTier: summary.activeTier,
        subscriptionStatus: summary.subscriptionStatus,
        billingCycle: summary.billingCycle,
        wallet: summary.wallet,
      });
    } catch (err: unknown) {
      console.error("[BillingRouter] GET /billing/wallet error:", err);
      res.status(500).json({ error: "Failed to load billing wallet" });
    }
    return;
  });

  // ── GET /api/v1/billing/transactions ──
  // Chronological ledger of all credit deductions, grants, and top-ups
  router.get("/billing/transactions", (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const limit = Math.min(100, Math.max(1, parseInt(req.query["limit"] as string, 10) || 50));
      const offset = Math.max(0, parseInt(req.query["offset"] as string, 10) || 0);

      const transactions = database.getUserTransactions(userId, limit, offset);
      const total = database.getUserTransactionCount(userId);
      res.json({
        transactions,
        total,
        limit,
        offset,
        count: transactions.length,
      });
    } catch (err: unknown) {
      console.error("[BillingRouter] GET /billing/transactions error:", err);
      res.status(500).json({ error: "Failed to load billing transactions" });
    }
    return;
  });

  // ── GET /api/v1/billing/usage ──
  // Deep breakdown of compute consumption per profile and recent history
  router.get("/billing/usage", (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const summary = database.billing.getUserBillingSummary(userId);
      res.json(summary);
    } catch (err: unknown) {
      console.error("[BillingRouter] GET /billing/usage error:", err);
      res.status(500).json({ error: "Failed to load billing usage summary" });
    }
    return;
  });

  // ── GET /api/v1/billing/summary ──
  // Full personal billing summary including persistent activeTier and subscriptionStatus
  router.get("/billing/summary", (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const summary = database.billing.getUserBillingSummary(userId);
      res.json(summary);
    } catch (err: unknown) {
      console.error("[BillingRouter] GET /billing/summary error:", err);
      res.status(500).json({ error: "Failed to load billing summary" });
    }
    return;
  });

  // ── POST /api/v1/billing/payment-intent ──
  // Creates a Stripe Payment Intent enforcing mandatory 3D Secure 2 and Radar fraud rules
  router.post(
    "/billing/payment-intent",
    billingRateLimiter,
    express.json(),
    validateBody(BILLING_PAYMENT_INTENT_SCHEMA),
    async (req, res) => {
      try {
        const userId = resolveRequestUserId(req, database);
        if (!userId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const clientIp = getClientIp(req);
        const amount = parseFloat(req.body.amount);

        const intent = await createStripePaymentIntent(
          {
            userId,
            amountCredits: amount,
            clientIp,
            customerCountry: req.body.customerCountry,
            cardCountry: req.body.cardCountry,
            simulateRadarScore: req.body.simulateRadarScore,
            idempotencyKey: (req.headers["idempotency-key"] as string) || req.body.idempotencyKey,
          },
          defaultPaymentGuard,
        );

        res.status(201).json({
          success: true,
          ...intent,
        });
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : "";
        if (errMessage.includes("Billing actions temporarily locked")) {
          return res.status(429).json({ error: errMessage });
        }
        if (errMessage.includes("Stripe Radar")) {
          return res.status(403).json({ error: errMessage });
        }
        if (
          errMessage.includes("Invalid top-up amount") ||
          errMessage.includes("exceeds maximum") ||
          errMessage.includes("disabled without STRIPE_SECRET_KEY")
        ) {
          return res.status(400).json({ error: errMessage });
        }
        console.error("[BillingRouter] POST /billing/payment-intent error:", err);
        res.status(502).json({ error: "Failed to create payment intent. Please try again later." });
      }
      return;
    },
  );

  const resolveSafeRedirectUrl = (req: express.Request, candidate: unknown, fallbackPath: string): string => {
    const configuredPublicUrl =
      process.env["PUBLIC_URL"] ||
      (process.env["NODE_ENV"] === "production"
        ? "https://hub.modelscript.org"
        : `${req.protocol || "http"}://${req.get("host") || "localhost:3001"}`);
    const allowedOrigins = new Set<string>();
    const addAllowedOrigin = (raw: string | undefined) => {
      if (!raw) return;
      try {
        allowedOrigins.add(new URL(raw.trim()).origin);
      } catch {
        // Ignore malformed configured origins
      }
    };
    addAllowedOrigin(configuredPublicUrl);
    for (const entry of (process.env["CORS_ALLOWED_ORIGINS"] || "").split(",")) {
      addAllowedOrigin(entry);
    }
    const baseOrigin = new URL(configuredPublicUrl).origin;
    const defaultUrl = `${baseOrigin}${fallbackPath}`;
    if (typeof candidate !== "string" || !candidate.trim()) return defaultUrl;
    let parsed: URL;
    try {
      parsed = new URL(candidate.trim());
    } catch {
      throw new Error("Invalid redirect URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Invalid redirect URL origin");
    }
    const isLocalDevOrigin =
      process.env["NODE_ENV"] !== "production" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    const isTrustedModelscriptSubdomain = parsed.protocol === "https:" && parsed.hostname.endsWith(".modelscript.org");
    if (!allowedOrigins.has(parsed.origin) && !isTrustedModelscriptSubdomain && !isLocalDevOrigin) {
      throw new Error("Invalid redirect URL origin");
    }
    return parsed.toString();
  };

  // ── POST /api/v1/billing/checkout-session ──
  // Creates a Stripe Checkout Session with automatic VAT/sales tax and Tax ID collection
  router.post("/billing/checkout-session", billingRateLimiter, express.json(), async (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const clientIp = getClientIp(req);
      const amount = parseFloat(req.body.amount);
      const orgId = req.body.orgId ? Number(req.body.orgId) : undefined;

      if (orgId) {
        const orgRole = database.getOrgMemberRole(orgId, userId);
        if (!orgRole || (orgRole !== "owner" && orgRole !== "maintainer" && (orgRole as string) !== "admin")) {
          return res
            .status(403)
            .json({ error: "Only organization owners or maintainers can top up organization credits." });
        }
      }

      const session = await createStripeCheckoutSession(
        {
          userId,
          orgId,
          amountCredits: amount,
          clientIp,
          successUrl: resolveSafeRedirectUrl(req, req.body.successUrl, "/settings?tab=billing&checkout=success"),
          cancelUrl: resolveSafeRedirectUrl(req, req.body.cancelUrl, "/settings?tab=billing&checkout=cancelled"),
          idempotencyKey: (req.headers["idempotency-key"] as string) || req.body.idempotencyKey,
        },
        defaultPaymentGuard,
      );

      res.status(201).json({
        success: true,
        ...session,
      });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : "";
      if (errMessage.includes("Billing actions temporarily locked")) {
        return res.status(429).json({ error: errMessage });
      }
      if (
        errMessage.includes("Invalid top-up amount") ||
        errMessage.includes("exceeds maximum") ||
        errMessage.includes("Invalid redirect URL") ||
        errMessage.includes("disabled without STRIPE_SECRET_KEY")
      ) {
        return res.status(400).json({ error: errMessage });
      }
      console.error("[BillingRouter] POST /billing/checkout-session error:", err);
      res.status(502).json({ error: "Failed to create checkout session. Please try again later." });
    }
    return;
  });

  // ── POST /api/v1/billing/subscriptions/checkout ──
  // Creates a recurring Stripe Subscription Checkout Session for Pro / Team tiers
  router.post("/billing/subscriptions/checkout", billingRateLimiter, express.json(), async (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const rawTier = req.body?.tier;
      const rawCycle = req.body?.billingCycle;
      if (rawTier !== "pro" && rawTier !== "team") {
        return res.status(400).json({ error: "Invalid subscription tier. Must be 'pro' or 'team'." });
      }
      if (rawCycle !== "monthly" && rawCycle !== "annual") {
        return res.status(400).json({ error: "Invalid billingCycle. Must be 'monthly' or 'annual'." });
      }

      let orgId: number | undefined;
      if (req.body?.orgId !== undefined && req.body?.orgId !== null && req.body?.orgId !== "") {
        const parsedOrgId = Number(req.body.orgId);
        if (!Number.isInteger(parsedOrgId) || parsedOrgId <= 0) {
          return res.status(400).json({ error: "Invalid organization ID" });
        }
        const orgRole = database.getOrgMemberRole(parsedOrgId, userId);
        const reqUser = database.getUserById(userId);
        if (
          reqUser?.account_type !== "admin" &&
          (!orgRole || (orgRole !== "owner" && orgRole !== "maintainer" && (orgRole as string) !== "admin"))
        ) {
          return res
            .status(403)
            .json({ error: "Only organization owners or maintainers can manage organization subscriptions." });
        }
        orgId = parsedOrgId;
      }

      const clientIp = getClientIp(req);
      const session = await createStripeSubscriptionCheckoutSession(
        {
          userId,
          orgId,
          tier: rawTier,
          billingCycle: rawCycle,
          clientIp,
          successUrl: resolveSafeRedirectUrl(
            req,
            req.body?.successUrl,
            "/settings?tab=billing&checkout=success&kind=subscription",
          ),
          cancelUrl: resolveSafeRedirectUrl(req, req.body?.cancelUrl, "/settings?tab=billing&checkout=cancelled"),
          idempotencyKey: (req.headers["idempotency-key"] as string) || req.body?.idempotencyKey,
        },
        defaultPaymentGuard,
      );

      res.status(201).json({
        success: true,
        ...session,
      });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : "";
      if (errMessage.includes("Billing actions temporarily locked")) {
        return res.status(429).json({ error: errMessage });
      }
      if (
        errMessage.includes("Invalid subscription tier") ||
        errMessage.includes("Invalid billing cycle") ||
        errMessage.includes("Invalid redirect URL") ||
        errMessage.includes("disabled without STRIPE_SECRET_KEY")
      ) {
        return res.status(400).json({ error: errMessage });
      }
      console.error("[BillingRouter] POST /billing/subscriptions/checkout error:", err);
      res.status(502).json({ error: "Failed to create subscription checkout session. Please try again later." });
    }
    return;
  });

  // ── GET /api/v1/billing/invoices/:txId ──
  // Generates a printable HTML tax invoice / receipt (or JSON representation) for a credit ledger transaction
  router.get("/billing/invoices/:txId", billingRateLimiter, (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const txId = parseInt(String(req.params["txId"] ?? ""), 10);
      if (!Number.isFinite(txId) || txId <= 0) {
        return res.status(400).json({ error: "Invalid transaction ID" });
      }

      const tx = database.getCreditTransactionById(txId) as
        (ReturnType<LibraryDatabase["getCreditTransactionById"]> & { org_id?: number | null }) | undefined;
      if (!tx) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      let parsedMeta: Record<string, unknown> = {};
      try {
        if (tx.metadata) parsedMeta = JSON.parse(tx.metadata) as Record<string, unknown>;
      } catch {
        // Default to empty metadata when stored JSON is malformed
      }

      const txOrgId =
        typeof tx.org_id === "number" && tx.org_id > 0
          ? tx.org_id
          : typeof parsedMeta["orgId"] === "number" || typeof parsedMeta["orgId"] === "string"
            ? Number(parsedMeta["orgId"])
            : null;

      const reqUser = database.getUserById(userId);
      const isAdmin = reqUser?.account_type === "admin";
      let isAuthorized = tx.user_id === userId || isAdmin;
      if (!isAuthorized && txOrgId && Number.isInteger(txOrgId) && txOrgId > 0) {
        const orgRole = database.getOrgMemberRole(txOrgId, userId);
        if (orgRole === "owner" || orgRole === "maintainer" || (orgRole as string) === "admin") {
          isAuthorized = true;
        }
      }
      if (!isAuthorized) {
        return res.status(403).json({ error: "Forbidden: You do not have access to this invoice" });
      }

      const txUser = database.getUserById(tx.user_id);
      const createdDate = new Date(tx.created_at || Date.now());
      const year = createdDate.getUTCFullYear();
      const invoiceNumber = `INV-${year}-${String(tx.id).padStart(6, "0")}`;
      const usdAmount = Math.abs(tx.amount);
      const isCreditGrant = tx.amount >= 0;

      const invoiceData = {
        invoiceNumber,
        transactionId: tx.id,
        issuedAt: tx.created_at,
        type: tx.type,
        description: tx.description,
        amountCredits: tx.amount,
        amountUsd: Number(usdAmount.toFixed(2)),
        currency: "USD",
        balanceAfter: tx.balance_after,
        customer: {
          userId: tx.user_id,
          username: txUser?.username || `user-${tx.user_id}`,
          email: txUser?.email || "",
        },
        metadata: parsedMeta,
      };

      if (
        req.query["format"] === "json" ||
        (req.headers.accept && req.headers.accept.includes("application/json") && req.query["format"] !== "html")
      ) {
        return res.json({ invoice: invoiceData });
      }

      const brandName = database.getInstanceSettings().instanceName || "Ansatz";

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Invoice ${escapeHtml(invoiceNumber)} — ${escapeHtml(brandName)} Cloud</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111827; max-width: 760px; margin: 40px auto; padding: 0 24px; line-height: 1.5; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; margin-bottom: 28px; }
    .brand { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #ecfdf5; color: #047857; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
    th { background: #f9fafb; font-weight: 600; color: #374151; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .total-row td { font-weight: 700; font-size: 16px; border-top: 2px solid #111827; }
    .footer { font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 40px; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${escapeHtml(brandName)} Cloud Compute</div>
      <div style="font-size: 13px; color: #6b7280;">Tax Invoice &amp; Compute Ledger Receipt</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 18px; font-weight: 700;">${escapeHtml(invoiceNumber)}</div>
      <div class="badge">${isCreditGrant ? "PAID / CREDITED" : "SETTLED"}</div>
    </div>
  </div>
  <div class="meta-grid">
    <div>
      <strong>Billed To:</strong><br/>
      @${escapeHtml(invoiceData.customer.username)}<br/>
      ${escapeHtml(invoiceData.customer.email)}
    </div>
    <div style="text-align: right;">
      <strong>Date Issued:</strong> ${escapeHtml(String(tx.created_at || ""))}<br/>
      <strong>Ledger Tx ID:</strong> #${tx.id}<br/>
      <strong>Transaction Type:</strong> ${escapeHtml(tx.type)}
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Credits</th>
        <th class="num">Amount (USD)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${escapeHtml(tx.description || `${brandName} Cloud Compute Credits`)}</td>
        <td class="num">${tx.amount > 0 ? `+${tx.amount.toFixed(2)}` : tx.amount.toFixed(2)} cr</td>
        <td class="num">$${usdAmount.toFixed(2)}</td>
      </tr>
      <tr class="total-row">
        <td>Total (${isCreditGrant ? "Paid" : "Deducted"})</td>
        <td class="num">${tx.amount > 0 ? `+${tx.amount.toFixed(2)}` : tx.amount.toFixed(2)} cr</td>
        <td class="num">$${usdAmount.toFixed(2)} USD</td>
      </tr>
    </tbody>
  </table>
  <div style="font-size: 13px; color: #374151;">
    <strong>Wallet Balance After Transaction:</strong> ${tx.balance_after.toFixed(2)} credits
  </div>
  <div class="footer">
    1.00 Compute Credit = $1.00 USD. Generated by ${escapeHtml(brandName)} Commercial Billing Ledger (powered by ModelScript).
    <span class="no-print" style="float: right;"><button onclick="window.print()">Print / Save PDF</button></span>
  </div>
</body>
</html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(html);
    } catch (err: unknown) {
      console.error("[BillingRouter] GET /billing/invoices/:txId error:", err);
      res.status(500).json({ error: "Failed to generate invoice" });
    }
    return;
  });

  // ── GET /api/v1/billing/orgs/:orgId/wallet ──
  // Organization shared compute wallet balance, subscription tier, and ledger history
  const handleOrgWalletOrSummary = (req: express.Request, res: express.Response) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const orgId = parseInt(String(req.params["orgId"] ?? ""), 10);
      if (!Number.isFinite(orgId) || orgId <= 0) {
        return res.status(400).json({ error: "Invalid organization ID" });
      }

      const memberRole = database.getOrgMemberRole(orgId, userId);
      const reqUser = database.getUserById(userId);
      if (!memberRole && reqUser?.account_type !== "admin") {
        return res.status(403).json({ error: "You must be a member of this organization to view its shared wallet" });
      }

      const wallet = database.billing.getOrgWalletSummary(orgId);
      if (!wallet) {
        return res.status(404).json({ error: "Organization not found" });
      }

      res.json(wallet);
    } catch (err: unknown) {
      console.error("[BillingRouter] GET /billing/orgs/:orgId/wallet error:", err);
      res.status(500).json({ error: "Failed to load organization wallet" });
    }
    return;
  };

  router.get("/billing/orgs/:orgId/wallet", handleOrgWalletOrSummary);
  router.get("/billing/orgs/:orgId/summary", handleOrgWalletOrSummary);

  // ── POST /api/v1/billing/orgs/:orgId/topup ──
  // Top up an organization's shared compute wallet
  router.post("/billing/orgs/:orgId/topup", billingRateLimiter, express.json(), async (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const orgId = parseInt(String(req.params["orgId"] ?? ""), 10);
      if (!Number.isFinite(orgId) || orgId <= 0) {
        return res.status(400).json({ error: "Invalid organization ID" });
      }

      const memberRole = database.getOrgMemberRole(orgId, userId);
      const reqUser = database.getUserById(userId);
      if (memberRole !== "owner" && memberRole !== "maintainer" && reqUser?.account_type !== "admin") {
        return res
          .status(403)
          .json({ error: "Only organization owners or maintainers can top up the organization wallet" });
      }

      const amount = parseFloat(req.body.amount);
      if (isNaN(amount) || amount < PAYMENT_LIMITS.MIN_TOPUP_CREDITS || amount > PAYMENT_LIMITS.MAX_TOPUP_CREDITS) {
        return res.status(400).json({
          error: `Top-up amount must be between ${PAYMENT_LIMITS.MIN_TOPUP_CREDITS} and ${PAYMENT_LIMITS.MAX_TOPUP_CREDITS} credits.`,
        });
      }

      const paymentIntentId = typeof req.body.paymentIntentId === "string" ? req.body.paymentIntentId.trim() : "";
      if (!paymentIntentId && !isSandboxTopupAllowed()) {
        return res.status(403).json({
          error: "Direct sandbox top-up is disabled in this environment. Use Stripe Checkout or PaymentIntent.",
        });
      }

      const description = (req.body.description as string) || "Organization Shared Wallet Top-Up";
      let newBalance: number;

      if (paymentIntentId) {
        if (database.hasProcessedStripeEvent(undefined, paymentIntentId)) {
          return res.status(409).json({ error: `PaymentIntent '${paymentIntentId}' has already been settled.` });
        }
        const verification = await verifyStripePaymentIntent(paymentIntentId, userId, amount, orgId);
        if (!verification.verified) {
          return res.status(403).json({ error: verification.reason || "Unable to verify PaymentIntent." });
        }
        const settlement = database.billing.settleStripeCreditGrant({
          eventId: `org_topup_${paymentIntentId}`,
          paymentIntentId,
          userId,
          orgId,
          amount,
          description,
          metadata: {
            paymentMethod: req.body.paymentMethod || "corporate_card",
            paymentIntentId,
          },
        });
        if (settlement.duplicate || settlement.newBalance === undefined) {
          return res.status(409).json({ error: `PaymentIntent '${paymentIntentId}' has already been settled.` });
        }
        newBalance = settlement.newBalance;
      } else {
        newBalance = database.grantOrgCredits(orgId, amount, userId, description, {
          paymentMethod: req.body.paymentMethod || "corporate_card",
        });
      }

      res.json({
        success: true,
        orgId,
        amountAdded: Math.round(amount * 100) / 100,
        newBalance,
        balance: newBalance,
      });
    } catch (err: unknown) {
      console.error("[BillingRouter] POST /billing/orgs/:orgId/topup error:", err);
      res.status(500).json({ error: "Failed to process organization wallet top-up" });
    }
    return;
  });

  // ── POST /api/v1/billing/webhook ──
  // Handles Stripe webhook events: instant chargeback/dispute quarantine & settlement
  router.post("/billing/webhook", (req, res) => {
    try {
      const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];
      const isProd = process.env["NODE_ENV"] === "production";
      const isTest = process.env["NODE_ENV"] === "test";
      if (!isTest || webhookSecret) {
        const sigHeader = req.headers["stripe-signature"];
        if (!webhookSecret || typeof sigHeader !== "string" || !sigHeader) {
          return res.status(400).json({ error: "Missing or unconfigured Stripe webhook signature" });
        }
        let timestamp = "";
        const v1Signatures: string[] = [];
        for (const kv of sigHeader.split(",")) {
          const idx = kv.indexOf("=");
          if (idx > 0) {
            const k = kv.slice(0, idx).trim();
            const v = kv.slice(idx + 1).trim();
            if (k === "t") timestamp = v;
            else if (k === "v1" && v) v1Signatures.push(v);
          }
        }
        if (v1Signatures.length === 0) {
          return res.status(400).json({ error: "Missing v1 signature in Stripe webhook header" });
        }
        if (!timestamp) {
          return res.status(400).json({ error: "Missing Stripe webhook timestamp (t=) in signature header" });
        }
        const tsNum = Number(timestamp);
        if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
          return res.status(400).json({ error: "Stripe webhook timestamp outside 5-minute replay window" });
        }
        const rawPayload = (req as express.Request & { rawBody?: string | Buffer | undefined }).rawBody;
        if (!rawPayload) {
          return res.status(400).json({ error: "Missing raw request body for cryptographic webhook verification" });
        }
        const payloadStr = Buffer.isBuffer(rawPayload) ? rawPayload.toString("utf-8") : String(rawPayload);
        const expectedDated = crypto
          .createHmac("sha256", webhookSecret)
          .update(`${timestamp}.${payloadStr}`)
          .digest("hex");
        const validDated = v1Signatures.some((sig) => safeTimingEqual(expectedDated, sig));
        if (!validDated) {
          return res.status(400).json({ error: "Invalid Stripe webhook signature" });
        }
      }

      const event = req.body;
      if (!event || !event.type) {
        return res.status(400).json({ error: "Invalid webhook payload structure" });
      }

      if (isProd && (process.env["STRIPE_SECRET_KEY"] || "").startsWith("sk_live_") && event.livemode !== true) {
        return res.status(400).json({ error: "Test-mode webhook events are rejected in live production mode" });
      }

      const result = handleStripeWebhookEvent(event, database, defaultPaymentGuard);
      res.json({ received: true, ...result });
    } catch (err: unknown) {
      console.error("[BillingRouter] Webhook error:", err);
      res.status(500).json({ error: "Failed to process webhook event" });
    }
    return;
  });

  // ── POST /api/v1/billing/topup ──
  // Instant wallet top-up with anti-carding protections & failure tracking
  router.post("/billing/topup", billingRateLimiter, express.json(), async (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const paymentIntentId = typeof req.body.paymentIntentId === "string" ? req.body.paymentIntentId.trim() : "";
      if (!paymentIntentId && !isSandboxTopupAllowed()) {
        return res.status(403).json({
          error:
            "Direct sandbox top-up is disabled in this environment. Use /api/v1/billing/payment-intent and Stripe webhook settlement.",
        });
      }

      const clientIp = getClientIp(req);

      // Anti-carding lockout check
      if (defaultPaymentGuard.isLocked(`user:${userId}`) || defaultPaymentGuard.isLocked(`ip:${clientIp}`)) {
        return res.status(429).json({
          error: "Billing actions temporarily locked due to excessive failed attempts. Please try again in 24 hours.",
        });
      }

      const amount = parseFloat(req.body.amount);
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Invalid top-up amount. Must be a positive number." });
      }

      // Minimum top-up threshold (prevents card testing micro-charges)
      if (amount < PAYMENT_LIMITS.MIN_TOPUP_CREDITS) {
        return res.status(400).json({
          error: `Minimum top-up threshold is ${PAYMENT_LIMITS.MIN_TOPUP_CREDITS} credits.`,
        });
      }

      if (amount > PAYMENT_LIMITS.MAX_TOPUP_CREDITS) {
        return res.status(400).json({
          error: `Maximum single top-up is ${PAYMENT_LIMITS.MAX_TOPUP_CREDITS.toLocaleString()} credits.`,
        });
      }

      // If simulated payment failure is requested for testing
      const allowSimulation =
        process.env["NODE_ENV"] !== "production" || process.env["ALLOW_BILLING_SIMULATION"] === "true";
      if (allowSimulation && req.body.simulatePaymentFailure === true) {
        const failure = defaultPaymentGuard.recordFailure(`user:${userId}`);
        defaultPaymentGuard.recordFailure(`ip:${clientIp}`);
        return res.status(402).json({
          error: "Payment declined by card issuer.",
          locked: failure.locked,
          failedAttempts: failure.count,
        });
      }

      const description = (req.body.description as string) || "Credit top-up reload";
      let newBalance: number;

      if (paymentIntentId) {
        if (database.hasProcessedStripeEvent(undefined, paymentIntentId)) {
          return res.status(409).json({
            error: `PaymentIntent '${paymentIntentId}' has already been settled.`,
          });
        }
        const verification = await verifyStripePaymentIntent(paymentIntentId, userId, amount);
        if (!verification.verified) {
          return res.status(403).json({
            error: verification.reason || "Unable to verify PaymentIntent.",
          });
        }
        const settlement = database.billing.settleStripeCreditGrant({
          eventId: `topup_${paymentIntentId}`,
          paymentIntentId,
          userId,
          amount,
          type: "top_up",
          description,
          metadata: {
            paymentMethod: req.body.paymentMethod || "sandbox_card",
            paymentIntentId,
            antiCardingVerified: true,
          },
        });
        if (settlement.duplicate || settlement.newBalance === undefined) {
          return res.status(409).json({
            error: `PaymentIntent '${paymentIntentId}' has already been settled.`,
          });
        }
        newBalance = settlement.newBalance;
      } else {
        newBalance = database.grantUserCredits(userId, amount, "top_up", description, {
          paymentMethod: req.body.paymentMethod || "sandbox_card",
          antiCardingVerified: true,
        });
      }

      // Clear failure counter on successful topup
      defaultPaymentGuard.clear(`user:${userId}`);
      defaultPaymentGuard.clear(`ip:${clientIp}`);

      const roundedAmount = Math.round(amount * 100) / 100;
      res.json({
        success: true,
        amountAdded: roundedAmount,
        newBalance,
        balance: newBalance,
        message: `Successfully added ${roundedAmount.toFixed(1)} credits to your wallet.`,
      });
    } catch (err: unknown) {
      console.error("[BillingRouter] POST /billing/topup error:", err);
      res.status(500).json({ error: "Failed to process wallet top-up" });
    }
    return;
  });

  return router;
}
