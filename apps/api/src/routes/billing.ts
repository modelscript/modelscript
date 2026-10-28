// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Router } from "express";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import {
  createStripePaymentIntent,
  defaultPaymentGuard,
  handleStripeWebhookEvent,
  PAYMENT_LIMITS,
} from "../services/billing/payment-guard.js";
import { resolveRequestUserId } from "../services/hpc/quota-guard.js";

export function billingRouter(database: LibraryDatabase): Router {
  const router = express.Router();

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
        if (isProd && timestamp) {
          const tsNum = Number(timestamp);
          if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
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
        const expectedRaw = crypto.createHmac("sha256", webhookSecret).update(payloadStr).digest("hex");
        const validDated =
          expectedDated.length === v1.length && crypto.timingSafeEqual(Buffer.from(expectedDated), Buffer.from(v1));
        const validRaw =
          expectedRaw.length === v1.length && crypto.timingSafeEqual(Buffer.from(expectedRaw), Buffer.from(v1));
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
  router.post("/billing/topup", express.json(), (req, res) => {
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
