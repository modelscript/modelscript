// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Router } from "express";
import type { LibraryDatabase } from "../database.js";
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
    } catch (err: any) {
      console.error("[BillingRouter] GET /billing/wallet error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
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
    } catch (err: any) {
      console.error("[BillingRouter] GET /billing/transactions error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
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
    } catch (err: any) {
      console.error("[BillingRouter] GET /billing/usage error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // ── POST /api/v1/billing/topup ──
  // Instant wallet top-up (simulated sandbox & local dev support)
  router.post("/billing/topup", express.json(), (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const amount = parseFloat(req.body.amount);
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Invalid top-up amount. Must be a positive number." });
      }

      if (amount > 10000) {
        return res.status(400).json({ error: "Maximum single top-up is 10,000 credits." });
      }

      const description = (req.body.description as string) || "Credit top-up reload";
      const newBalance = database.grantUserCredits(userId, amount, "top_up", description, {
        paymentMethod: req.body.paymentMethod || "sandbox_card",
      });

      res.json({
        success: true,
        amountAdded: amount,
        newBalance,
        message: `Successfully added ${amount.toFixed(1)} credits to your wallet.`,
      });
    } catch (err: any) {
      console.error("[BillingRouter] POST /billing/topup error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  return router;
}
