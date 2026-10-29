// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Router } from "express";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import { defaultApiLimiter } from "../middleware/rate-limiter.js";
import {
  createStripeCheckoutSession,
  createStripePaymentIntent,
  defaultPaymentGuard,
  handleStripeWebhookEvent,
  PAYMENT_LIMITS,
  verifyStripePaymentIntent,
} from "../services/billing/payment-guard.js";
import { resolveRequestUserId } from "../services/hpc/quota-guard.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function billingRouter(database: LibraryDatabase): Router {
  const router = express.Router();
  router.use(defaultApiLimiter);

  // ── GET /api/v1/billing/wallet ──
  // Current wallet balance, account tier, and summary stats
  router.get("/billing/wallet", (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const summary = database.getUserBillingSummary(userId);
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
        wallet: summary.wallet,
      });
    } catch (err: unknown) {
      console.error("[BillingRouter] GET /billing/wallet error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
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
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
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

      const summary = database.getUserBillingSummary(userId);
      res.json(summary);
    } catch (err: unknown) {
      console.error("[BillingRouter] GET /billing/usage error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return;
  });

  // ── POST /api/v1/billing/payment-intent ──
  // Creates a Stripe Payment Intent enforcing mandatory 3D Secure 2 and Radar fraud rules
  router.post("/billing/payment-intent", express.json(), async (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const clientIp = (req.headers["x-forwarded-for"] as string) || req.ip || req.socket.remoteAddress || "127.0.0.1";
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
      const isLocked = errMessage.includes("Billing actions temporarily locked");
      const isRadar = errMessage.includes("Stripe Radar");
      const statusCode = isLocked ? 429 : isRadar ? 403 : 400;
      res.status(statusCode).json({ error: errMessage || "Failed to create payment intent" });
    }
    return;
  });

  // ── POST /api/v1/billing/checkout-session ──
  // Creates a Stripe Checkout Session with automatic VAT/sales tax and Tax ID collection
  router.post("/billing/checkout-session", express.json(), async (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const clientIp = (req.headers["x-forwarded-for"] as string) || req.ip || req.socket.remoteAddress || "127.0.0.1";
      const amount = parseFloat(req.body.amount);
      const orgId = req.body.orgId ? Number(req.body.orgId) : undefined;

      if (orgId) {
        const orgRole = database.getOrgMemberRole(orgId, userId);
        if (!orgRole || (orgRole !== "owner" && orgRole !== "maintainer")) {
          return res
            .status(403)
            .json({ error: "Only organization owners or maintainers can top up organization credits." });
        }
      }

      const origin = req.headers.origin || process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
      const session = await createStripeCheckoutSession(
        {
          userId,
          orgId,
          amountCredits: amount,
          clientIp,
          successUrl: req.body.successUrl || `${origin}/settings?tab=billing&checkout=success`,
          cancelUrl: req.body.cancelUrl || `${origin}/settings?tab=billing&checkout=cancelled`,
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
      const statusCode = errMessage.includes("Billing actions temporarily locked") ? 429 : 400;
      res.status(statusCode).json({ error: errMessage || "Failed to create checkout session" });
    }
    return;
  });

  // ── GET /api/v1/billing/invoices/:txId ──
  // Generates a printable HTML tax invoice / receipt (or JSON representation) for a credit ledger transaction
  router.get("/billing/invoices/:txId", (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const txId = parseInt(req.params["txId"] ?? "", 10);
      if (!Number.isFinite(txId) || txId <= 0) {
        return res.status(400).json({ error: "Invalid transaction ID" });
      }

      const tx = database.getCreditTransactionById(txId);
      if (!tx) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      const reqUser = database.getUserById(userId);
      const isAdmin = reqUser?.account_type === "admin";
      if (tx.user_id !== userId && !isAdmin) {
        return res.status(403).json({ error: "Forbidden: You do not have access to this invoice" });
      }

      const txUser = database.getUserById(tx.user_id);
      const createdDate = new Date(tx.created_at || Date.now());
      const year = createdDate.getUTCFullYear();
      const invoiceNumber = `INV-${year}-${String(tx.id).padStart(6, "0")}`;
      const usdAmount = Math.abs(tx.amount);
      const isCreditGrant = tx.amount >= 0;

      let parsedMeta: Record<string, unknown> = {};
      try {
        if (tx.metadata) parsedMeta = JSON.parse(tx.metadata) as Record<string, unknown>;
      } catch {}

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

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Invoice ${escapeHtml(invoiceNumber)} — ModelScript Cloud</title>
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
      <div class="brand">ModelScript Cloud Compute</div>
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
        <td>${escapeHtml(tx.description || "ModelScript Cloud Compute Credits")}</td>
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
    1.00 Compute Credit = $1.00 USD. Generated by ModelScript Commercial Billing Ledger.
    <span class="no-print" style="float: right;"><button onclick="window.print()">Print / Save PDF</button></span>
  </div>
</body>
</html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(html);
    } catch (err: unknown) {
      console.error("[BillingRouter] GET /billing/invoices/:txId error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return;
  });

  // ── GET /api/v1/billing/orgs/:orgId/wallet ──
  // Organization shared compute wallet balance and ledger history
  router.get("/billing/orgs/:orgId/wallet", (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const orgId = parseInt(req.params["orgId"] ?? "", 10);
      if (!Number.isFinite(orgId) || orgId <= 0) {
        return res.status(400).json({ error: "Invalid organization ID" });
      }

      const memberRole = database.getOrgMemberRole(orgId, userId);
      const reqUser = database.getUserById(userId);
      if (!memberRole && reqUser?.account_type !== "admin") {
        return res.status(403).json({ error: "You must be a member of this organization to view its shared wallet" });
      }

      const wallet = database.getOrgWalletSummary(orgId);
      if (!wallet) {
        return res.status(404).json({ error: "Organization not found" });
      }

      res.json(wallet);
    } catch (err: unknown) {
      console.error("[BillingRouter] GET /billing/orgs/:orgId/wallet error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return;
  });

  // ── POST /api/v1/billing/orgs/:orgId/topup ──
  // Top up an organization's shared compute wallet
  router.post("/billing/orgs/:orgId/topup", express.json(), async (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const orgId = parseInt(req.params["orgId"] ?? "", 10);
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

      const isProd = process.env["NODE_ENV"] === "production";
      const paymentIntentId = typeof req.body.paymentIntentId === "string" ? req.body.paymentIntentId.trim() : "";
      if (isProd && process.env["ALLOW_SANDBOX_TOPUP"] !== "true" && !paymentIntentId) {
        return res.status(403).json({
          error: "Direct sandbox top-up is disabled in production. Use Stripe Checkout or PaymentIntent.",
        });
      }

      if (paymentIntentId) {
        if (database.hasProcessedStripeEvent(undefined, paymentIntentId)) {
          return res.status(409).json({ error: `PaymentIntent '${paymentIntentId}' has already been settled.` });
        }
        const verification = await verifyStripePaymentIntent(paymentIntentId, userId, amount);
        if (!verification.verified) {
          return res.status(403).json({ error: verification.reason || "Unable to verify PaymentIntent." });
        }
        database.recordProcessedStripeEvent(`org_topup_${paymentIntentId}`, paymentIntentId, userId, amount);
      }

      const newBalance = database.grantOrgCredits(
        orgId,
        amount,
        userId,
        (req.body.description as string) || "Organization Shared Wallet Top-Up",
        {
          paymentMethod: req.body.paymentMethod || "corporate_card",
          ...(paymentIntentId ? { paymentIntentId } : {}),
        },
      );

      res.json({
        success: true,
        orgId,
        amountAdded: amount,
        newBalance,
        balance: newBalance,
      });
    } catch (err: unknown) {
      console.error("[BillingRouter] POST /billing/orgs/:orgId/topup error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return;
  });

  // ── POST /api/v1/billing/webhook ──
  // Handles Stripe webhook events: instant chargeback/dispute quarantine & settlement
  router.post("/billing/webhook", express.json(), (req, res) => {
    try {
      const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];
      const isProd = process.env["NODE_ENV"] === "production";
      if (isProd || webhookSecret) {
        const sigHeader = req.headers["stripe-signature"];
        if (!webhookSecret || typeof sigHeader !== "string" || !sigHeader) {
          return res.status(400).json({ error: "Missing or unconfigured Stripe webhook signature" });
        }
        const parts = Object.fromEntries(
          sigHeader.split(",").map((kv) => {
            const idx = kv.indexOf("=");
            return idx > 0 ? [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()] : [kv.trim(), ""];
          }),
        );
        const timestamp = parts["t"] || "";
        if (isProd && !timestamp) {
          return res.status(400).json({ error: "Missing Stripe webhook timestamp (t=) in signature header" });
        }
        if (timestamp) {
          const tsNum = Number(timestamp);
          if (!Number.isFinite(tsNum) || (isProd && Math.abs(Date.now() / 1000 - tsNum) > 300)) {
            return res.status(400).json({ error: "Stripe webhook timestamp outside 5-minute replay window" });
          }
        }
        const v1 = parts["v1"] || sigHeader;
        const rawPayload =
          (req as express.Request & { rawBody?: string | Buffer | undefined }).rawBody ?? JSON.stringify(req.body);
        const payloadStr = Buffer.isBuffer(rawPayload) ? rawPayload.toString("utf-8") : String(rawPayload);
        const expectedDated = timestamp
          ? crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${payloadStr}`).digest("hex")
          : "";
        const validDated =
          expectedDated.length > 0 &&
          expectedDated.length === v1.length &&
          crypto.timingSafeEqual(Buffer.from(expectedDated), Buffer.from(v1));
        const expectedRaw =
          !isProd && !timestamp ? crypto.createHmac("sha256", webhookSecret).update(payloadStr).digest("hex") : "";
        const validRaw =
          expectedRaw.length > 0 &&
          expectedRaw.length === v1.length &&
          crypto.timingSafeEqual(Buffer.from(expectedRaw), Buffer.from(v1));
        if (!validDated && !validRaw) {
          return res.status(400).json({ error: "Invalid Stripe webhook signature" });
        }
      }

      const event = req.body;
      if (!event || !event.type) {
        return res.status(400).json({ error: "Invalid webhook payload structure" });
      }

      const result = handleStripeWebhookEvent(event, database, defaultPaymentGuard);
      res.json({ received: true, ...result });
    } catch (err: unknown) {
      console.error("[BillingRouter] Webhook error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return;
  });

  // ── POST /api/v1/billing/topup ──
  // Instant wallet top-up with anti-carding protections & failure tracking
  router.post("/billing/topup", express.json(), async (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const isProd = process.env["NODE_ENV"] === "production";
      const paymentIntentId = typeof req.body.paymentIntentId === "string" ? req.body.paymentIntentId.trim() : "";
      if (isProd && process.env["ALLOW_SANDBOX_TOPUP"] !== "true" && !paymentIntentId) {
        return res.status(403).json({
          error:
            "Direct sandbox top-up is disabled in production. Use /api/v1/billing/payment-intent and Stripe webhook settlement.",
        });
      }

      const clientIp = (req.headers["x-forwarded-for"] as string) || req.ip || req.socket.remoteAddress || "127.0.0.1";

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
      if (req.body.simulatePaymentFailure === true) {
        const failure = defaultPaymentGuard.recordFailure(`user:${userId}`);
        defaultPaymentGuard.recordFailure(`ip:${clientIp}`);
        return res.status(402).json({
          error: "Payment declined by card issuer.",
          locked: failure.locked,
          failedAttempts: failure.count,
        });
      }

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
        const recorded = database.recordProcessedStripeEvent(
          `topup_${paymentIntentId}`,
          paymentIntentId,
          userId,
          amount,
        );
        if (!recorded) {
          return res.status(409).json({
            error: `PaymentIntent '${paymentIntentId}' has already been settled.`,
          });
        }
      }

      const description = (req.body.description as string) || "Credit top-up reload";
      const newBalance = database.grantUserCredits(userId, amount, "top_up", description, {
        paymentMethod: req.body.paymentMethod || "sandbox_card",
        ...(paymentIntentId ? { paymentIntentId } : {}),
        antiCardingVerified: true,
      });

      // Clear failure counter on successful topup
      defaultPaymentGuard.clear(`user:${userId}`);
      defaultPaymentGuard.clear(`ip:${clientIp}`);

      res.json({
        success: true,
        amountAdded: amount,
        newBalance,
        balance: newBalance,
        message: `Successfully added ${amount.toFixed(1)} credits to your wallet.`,
      });
    } catch (err: unknown) {
      console.error("[BillingRouter] POST /billing/topup error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return;
  });

  return router;
}
