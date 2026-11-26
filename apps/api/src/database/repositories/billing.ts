// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CreditTransactionRow, UserBillingSummary } from "../../database.js";
import { listComputeProfiles } from "../../services/hpc/compute-profiles.js";
import { BaseRepository } from "./base.js";

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

function roundCredits(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export type BillingTier = "free" | "pro" | "team" | "enterprise";

export interface BillingSubscriptionState {
  activeTier: BillingTier;
  subscriptionStatus: string;
  billingCycle: "monthly" | "annual" | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
}

function normalizeBillingTier(value: unknown): BillingTier {
  if (value === "pro" || value === "team" || value === "enterprise") {
    return value;
  }
  return "free";
}

function normalizeBillingCycle(value: unknown): "monthly" | "annual" | null {
  if (value === "monthly" || value === "annual") {
    return value;
  }
  return null;
}

export class BillingRepository extends BaseRepository {
  #subscriptionSchemaReady = false;

  private ensureSubscriptionSchema(): void {
    if (this.#subscriptionSchemaReady) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS billing_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_type TEXT NOT NULL CHECK(scope_type IN ('user', 'org')),
        scope_id INTEGER NOT NULL,
        active_tier TEXT NOT NULL DEFAULT 'free',
        subscription_status TEXT NOT NULL DEFAULT 'inactive',
        billing_cycle TEXT,
        stripe_subscription_id TEXT,
        stripe_customer_id TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(scope_type, scope_id)
      );
      CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_stripe_sub
        ON billing_subscriptions(stripe_subscription_id);
    `);
    this.#subscriptionSchemaReady = true;
  }

  getSubscriptionState(scope: {
    userId?: number | null | undefined;
    orgId?: number | null | undefined;
  }): BillingSubscriptionState {
    this.ensureSubscriptionSchema();
    const scopeType: "user" | "org" | null = scope.orgId ? "org" : scope.userId ? "user" : null;
    const scopeId = scope.orgId || scope.userId || 0;
    if (!scopeType || scopeId <= 0) {
      return {
        activeTier: "free",
        subscriptionStatus: "inactive",
        billingCycle: null,
        stripeSubscriptionId: null,
        stripeCustomerId: null,
      };
    }

    const row = this.get<{
      active_tier?: string | null;
      subscription_status?: string | null;
      billing_cycle?: string | null;
      stripe_subscription_id?: string | null;
      stripe_customer_id?: string | null;
    }>(
      `SELECT active_tier, subscription_status, billing_cycle, stripe_subscription_id, stripe_customer_id
       FROM billing_subscriptions
       WHERE scope_type = ? AND scope_id = ?`,
      scopeType,
      scopeId,
    );

    if (!row) {
      return {
        activeTier: "free",
        subscriptionStatus: "inactive",
        billingCycle: null,
        stripeSubscriptionId: null,
        stripeCustomerId: null,
      };
    }

    return {
      activeTier: normalizeBillingTier(row.active_tier),
      subscriptionStatus: row.subscription_status || "inactive",
      billingCycle: normalizeBillingCycle(row.billing_cycle),
      stripeSubscriptionId: row.stripe_subscription_id ?? null,
      stripeCustomerId: row.stripe_customer_id ?? null,
    };
  }

  findSubscriptionByStripeId(stripeSubscriptionId: string): {
    scopeType: "user" | "org";
    scopeId: number;
    activeTier: BillingTier;
    subscriptionStatus: string;
    billingCycle: "monthly" | "annual" | null;
  } | null {
    if (!stripeSubscriptionId) return null;
    this.ensureSubscriptionSchema();
    const row = this.get<{
      scope_type: "user" | "org";
      scope_id: number;
      active_tier?: string | null;
      subscription_status?: string | null;
      billing_cycle?: string | null;
    }>(
      `SELECT scope_type, scope_id, active_tier, subscription_status, billing_cycle
       FROM billing_subscriptions
       WHERE stripe_subscription_id = ?
       LIMIT 1`,
      stripeSubscriptionId,
    );
    if (!row) return null;
    return {
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      activeTier: normalizeBillingTier(row.active_tier),
      subscriptionStatus: row.subscription_status || "inactive",
      billingCycle: normalizeBillingCycle(row.billing_cycle),
    };
  }

  upsertSubscriptionState(params: {
    userId?: number | null | undefined;
    orgId?: number | null | undefined;
    activeTier: BillingTier;
    subscriptionStatus: string;
    billingCycle?: "monthly" | "annual" | null | undefined;
    stripeSubscriptionId?: string | null | undefined;
    stripeCustomerId?: string | null | undefined;
  }): {
    scopeType: "user" | "org";
    scopeId: number;
    activeTier: BillingTier;
    subscriptionStatus: string;
    billingCycle: "monthly" | "annual" | null;
  } {
    this.ensureSubscriptionSchema();
    const scopeType: "user" | "org" = params.orgId ? "org" : "user";
    const scopeId = params.orgId || params.userId || 0;
    if (scopeId <= 0) {
      throw new Error("Either userId or orgId is required to persist subscription state");
    }

    const activeTier = normalizeBillingTier(params.activeTier);
    const subscriptionStatus = params.subscriptionStatus || "inactive";
    const billingCycle = normalizeBillingCycle(params.billingCycle);

    this.run(
      `INSERT INTO billing_subscriptions (
         scope_type, scope_id, active_tier, subscription_status, billing_cycle, stripe_subscription_id, stripe_customer_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(scope_type, scope_id) DO UPDATE SET
         active_tier = excluded.active_tier,
         subscription_status = excluded.subscription_status,
         billing_cycle = excluded.billing_cycle,
         stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, billing_subscriptions.stripe_subscription_id),
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, billing_subscriptions.stripe_customer_id),
         updated_at = datetime('now')`,
      scopeType,
      scopeId,
      activeTier,
      subscriptionStatus,
      billingCycle,
      params.stripeSubscriptionId ?? null,
      params.stripeCustomerId ?? null,
    );

    return {
      scopeType,
      scopeId,
      activeTier,
      subscriptionStatus,
      billingCycle,
    };
  }

  getUserBalance(userId: number): number {
    const row = this.get<{ credit_balance?: number | undefined }>(
      `SELECT credit_balance FROM users WHERE id = ?`,
      userId,
    );
    return row?.credit_balance ?? 0;
  }

  getUserCreditBalance(userId: number): number {
    return this.getUserBalance(userId);
  }

  setUserCreditBalance(userId: number, balance: number): void {
    this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, roundCredits(balance), userId);
  }

  adjustUserCreditsForAdmin(
    userId: number,
    deltaCredits: number,
    reason: string,
  ): {
    success: boolean;
    userId: number;
    previousBalance: number;
    newBalance: number;
  } {
    const deltaCents = toCents(deltaCredits);
    if (!Number.isFinite(deltaCredits) || deltaCents === 0) {
      return { success: false, userId, previousBalance: 0, newBalance: 0 };
    }
    const roundedDelta = fromCents(deltaCents);

    return this.immediateTransaction(() => {
      const user = this.get<{ credit_balance?: number | undefined }>(
        `SELECT credit_balance FROM users WHERE id = ?`,
        userId,
      );
      if (!user) {
        return { success: false, userId, previousBalance: 0, newBalance: 0 };
      }
      const previousCents = toCents(Number(user.credit_balance ?? 0));
      const previousBalance = fromCents(previousCents);
      const rawNewCents = previousCents + deltaCents;
      const newCents = Math.max(0, rawNewCents);
      const newBalance = fromCents(newCents);
      const txType = deltaCents >= 0 ? "admin_grant" : "admin_deduction";

      this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, newBalance, userId);
      this.run(
        `INSERT INTO credit_transactions (user_id, org_id, amount, balance_after, type, description)
         VALUES (?, NULL, ?, ?, ?, ?)`,
        userId,
        roundedDelta,
        newBalance,
        txType,
        reason || "Administrator compute wallet adjustment",
      );

      if (rawNewCents < 0) {
        const clampAdjustment = fromCents(-rawNewCents);
        this.run(
          `INSERT INTO credit_transactions (user_id, org_id, amount, balance_after, type, description)
           VALUES (?, NULL, ?, 0.0, 'clamp_adjustment', ?)`,
          userId,
          clampAdjustment,
          "Balance clamp adjustment (floor at 0.00)",
        );
      }

      return {
        success: true,
        userId,
        previousBalance,
        newBalance,
      };
    });
  }

  adjustUserCredits(userId: number, delta: number, description = "Credit balance adjustment"): boolean {
    return this.adjustUserCreditsForAdmin(userId, delta, description).success;
  }

  freezeUserForDispute(userId: number, reason: string): { success: boolean; previousBalance: number } {
    const result = this.immediateTransaction(() => {
      const user = this.get<{ credit_balance?: number | undefined }>(
        `SELECT credit_balance FROM users WHERE id = ?`,
        userId,
      );
      if (!user) {
        return { success: false, previousBalance: 0 };
      }

      const previousBalance = roundCredits(user.credit_balance || 0);

      this.run(
        `UPDATE users SET credit_balance = 0.0, status = 'suspended_dispute', token_version = COALESCE(token_version, 1) + 1 WHERE id = ?`,
        userId,
      );

      this.run(
        `UPDATE credit_escrow_holds SET status = 'frozen_dispute', settled_at = datetime('now') WHERE user_id = ? AND org_id IS NULL AND status = 'held'`,
        userId,
      );

      this.run(
        `UPDATE jobs SET status = 'CANCELLED', completed_at = datetime('now') WHERE user_id = ? AND status IN ('PENDING', 'RUNNING', 'QUEUED')`,
        userId,
      );

      this.run(
        `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description)
         VALUES (?, NULL, NULL, ?, 0.0, 'dispute_freeze', ?)`,
        userId,
        -previousBalance,
        `Dispute/Chargeback quarantine: ${reason}`,
      );

      return { success: true, previousBalance };
    });

    if (result.success) {
      try {
        this.facade.logAudit({
          actorId: userId,
          action: "user_dispute_frozen",
          resourceType: "user",
          resourceId: String(userId),
          details: { reason, previousBalance: result.previousBalance },
        });
      } catch {
        // Audit log lives in a separate DB; do not fail an already-committed freeze
      }
    }

    return result;
  }

  deductUserCredits(
    userId: number,
    amount: number,
    jobId: number | null = null,
    description: string = "HPC Compute Charge",
    metadata?: Record<string, unknown>,
  ): {
    id?: number | undefined;
    success: boolean;
    user_id: number;
    job_id: number | null;
    amount: number;
    balance_after: number;
    transaction_type: string;
    type: string;
    description: string;
    metadata?: string | undefined;
    newBalance: number;
  } {
    const amountCents = toCents(amount);
    if (!Number.isFinite(amount) || amountCents <= 0) {
      const balance = this.getUserBalance(userId);
      return {
        success: false,
        user_id: userId,
        job_id: jobId,
        amount: 0,
        balance_after: balance,
        transaction_type: "job_settlement",
        type: "job_settlement",
        description,
        newBalance: balance,
      };
    }

    const roundedAmount = fromCents(amountCents);

    return this.immediateTransaction(() => {
      const user = this.get<{ credit_balance?: number | undefined }>(
        `SELECT credit_balance FROM users WHERE id = ?`,
        userId,
      );

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      const currentCents = toCents(user.credit_balance ?? 0);
      const currentBalance = fromCents(currentCents);
      if (currentCents < amountCents) {
        return {
          success: false,
          user_id: userId,
          job_id: jobId,
          amount: -roundedAmount,
          balance_after: currentBalance,
          transaction_type: "job_settlement",
          type: "job_settlement",
          description,
          newBalance: currentBalance,
        };
      }

      const newBalance = fromCents(Math.max(0, currentCents - amountCents));

      this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, newBalance, userId);

      const txResult = this.run(
        `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
         VALUES (?, NULL, ?, ?, ?, 'job_charge', ?, ?)`,
        userId,
        jobId,
        -roundedAmount,
        newBalance,
        description,
        JSON.stringify(metadata ?? {}),
      );

      const txId = txResult.lastInsertRowid as number;

      if (newBalance <= 10) {
        const existingUnread = this.get(
          `SELECT id FROM notifications WHERE user_id = ? AND type = 'credit_warning' AND read = 0`,
          userId,
        );
        if (!existingUnread) {
          this.facade.createNotification(userId, userId, "credit_warning", null, {
            balance: newBalance,
            threshold: 10,
            message: `Your compute balance is ${newBalance} credits (below threshold of 10).`,
          });
        }
      }

      return {
        id: txId,
        user_id: userId,
        job_id: jobId,
        amount: -roundedAmount,
        balance_after: newBalance,
        transaction_type: "job_charge",
        type: "job_charge",
        description,
        metadata: JSON.stringify(metadata ?? {}),
        success: true,
        newBalance,
      };
    });
  }

  grantUserCredits(
    userId: number,
    amount: number,
    type: string = "top_up",
    description: string = "Credit Grant",
    metadata?: Record<string, unknown>,
  ): number {
    const amountCents = toCents(amount);
    if (!Number.isFinite(amount) || amountCents <= 0) {
      throw new RangeError("Credit grant amount must be a positive finite number (>= 0.01 credits)");
    }
    const roundedAmount = fromCents(amountCents);

    return this.immediateTransaction(() => {
      const user = this.get<{ credit_balance?: number | undefined }>(
        `SELECT credit_balance FROM users WHERE id = ?`,
        userId,
      );

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      const currentCents = toCents(user.credit_balance ?? 0);
      const newBalance = fromCents(currentCents + amountCents);

      this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, newBalance, userId);

      this.run(
        `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
         VALUES (?, NULL, NULL, ?, ?, ?, ?, ?)`,
        userId,
        roundedAmount,
        newBalance,
        type,
        description,
        JSON.stringify(metadata ?? {}),
      );

      return newBalance;
    });
  }

  hasProcessedStripeEvent(eventId?: string | null, paymentIntentId?: string | null): boolean {
    if (eventId) {
      const row = this.get(`SELECT event_id FROM stripe_processed_events WHERE event_id = ?`, eventId);
      if (row) return true;
    }
    if (paymentIntentId) {
      const row = this.get(`SELECT event_id FROM stripe_processed_events WHERE payment_intent_id = ?`, paymentIntentId);
      if (row) return true;
    }
    return false;
  }

  recordProcessedStripeEvent(
    eventId: string,
    paymentIntentId: string | null,
    userId: number | null,
    amountCredits: number,
  ): boolean {
    try {
      this.run(
        `INSERT INTO stripe_processed_events (event_id, payment_intent_id, user_id, amount_credits)
         VALUES (?, ?, ?, ?)`,
        eventId,
        paymentIntentId,
        userId,
        roundCredits(amountCredits),
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Atomically deduplicates a Stripe event / PaymentIntent and grants credits to either an
   * organization wallet or a personal user wallet inside a single immediate transaction.
   */
  settleStripeCreditGrant(params: {
    eventId: string;
    paymentIntentId: string | null;
    userId: number | null;
    orgId?: number | null | undefined;
    amount: number;
    type?: string | undefined;
    description: string;
    metadata?: Record<string, unknown> | undefined;
  }): {
    settled: boolean;
    duplicate: boolean;
    newBalance?: number | undefined;
    amountGranted?: number | undefined;
  } {
    const amountCents = toCents(params.amount);
    if (!Number.isFinite(params.amount) || amountCents <= 0) {
      throw new RangeError("Stripe credit grant amount must be a positive finite number (>= 0.01 credits)");
    }
    const roundedAmount = fromCents(amountCents);

    return this.immediateTransaction(() => {
      if (params.eventId) {
        const existingEvent = this.get(
          `SELECT event_id FROM stripe_processed_events WHERE event_id = ?`,
          params.eventId,
        );
        if (existingEvent) {
          return { settled: false, duplicate: true };
        }
      }
      if (params.paymentIntentId) {
        const existingPi = this.get(
          `SELECT event_id FROM stripe_processed_events WHERE payment_intent_id = ?`,
          params.paymentIntentId,
        );
        if (existingPi) {
          return { settled: false, duplicate: true };
        }
      }

      try {
        this.run(
          `INSERT INTO stripe_processed_events (event_id, payment_intent_id, user_id, amount_credits)
           VALUES (?, ?, ?, ?)`,
          params.eventId,
          params.paymentIntentId,
          params.userId,
          roundedAmount,
        );
      } catch {
        return { settled: false, duplicate: true };
      }

      if (params.orgId) {
        const org = this.get<{ id: number; credit_balance?: number | undefined; created_by?: number | undefined }>(
          `SELECT id, credit_balance, created_by FROM organizations WHERE id = ?`,
          params.orgId,
        );
        if (!org) {
          throw new Error(`Organization with ID ${params.orgId} not found`);
        }
        const currentCents = toCents(org.credit_balance ?? 0);
        const newBalance = fromCents(currentCents + amountCents);
        this.run(`UPDATE organizations SET credit_balance = ? WHERE id = ?`, newBalance, params.orgId);

        const effectiveUserId = params.userId ?? org.created_by ?? 1;
        this.run(
          `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
           VALUES (?, ?, NULL, ?, ?, 'org_top_up', ?, ?)`,
          effectiveUserId,
          params.orgId,
          roundedAmount,
          newBalance,
          params.description,
          JSON.stringify({ orgId: params.orgId, ...(params.metadata ?? {}) }),
        );
        return { settled: true, duplicate: false, newBalance, amountGranted: roundedAmount };
      }

      if (params.userId) {
        const user = this.get<{ credit_balance?: number | undefined }>(
          `SELECT credit_balance FROM users WHERE id = ?`,
          params.userId,
        );
        if (!user) {
          throw new Error(`User with ID ${params.userId} not found`);
        }
        const currentCents = toCents(user.credit_balance ?? 0);
        const newBalance = fromCents(currentCents + amountCents);
        this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, newBalance, params.userId);

        this.run(
          `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
           VALUES (?, NULL, NULL, ?, ?, ?, ?, ?)`,
          params.userId,
          roundedAmount,
          newBalance,
          params.type ?? "top_up",
          params.description,
          JSON.stringify(params.metadata ?? {}),
        );
        return { settled: true, duplicate: false, newBalance, amountGranted: roundedAmount };
      }

      throw new Error("Either userId or orgId is required to settle a Stripe credit grant");
    });
  }

  holdUserCredits(
    userId: number,
    amount: number,
    jobId: number | null = null,
    description: string = "HPC Compute Escrow Hold",
    metadata?: Record<string, unknown>,
  ): {
    success: boolean;
    holdId?: number | undefined;
    heldAmount: number;
    newBalance: number;
    reason?: string | undefined;
  } {
    const amountCents = toCents(amount);
    if (!Number.isFinite(amount) || amountCents <= 0) {
      const balance = this.getUserBalance(userId);
      return {
        success: false,
        heldAmount: 0,
        newBalance: balance,
        reason: "Escrow hold amount must be at least 0.01 credits",
      };
    }

    const roundedAmount = fromCents(amountCents);

    return this.immediateTransaction(() => {
      const user = this.get<{ credit_balance?: number | undefined }>(
        `SELECT credit_balance FROM users WHERE id = ?`,
        userId,
      );

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      const currentCents = toCents(user.credit_balance ?? 0);
      const currentBalance = fromCents(currentCents);
      if (currentCents < amountCents) {
        return {
          success: false,
          heldAmount: 0,
          newBalance: currentBalance,
          reason: `Insufficient balance (${currentBalance.toFixed(1)} cr) to place required escrow hold of ${roundedAmount.toFixed(1)} cr`,
        };
      }

      const newBalance = fromCents(currentCents - amountCents);
      this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, newBalance, userId);

      const holdRes = this.run(
        `INSERT INTO credit_escrow_holds (user_id, org_id, job_id, amount, status, description, metadata)
         VALUES (?, NULL, ?, ?, 'held', ?, ?)`,
        userId,
        jobId,
        roundedAmount,
        description,
        JSON.stringify(metadata ?? {}),
      );

      const holdId = holdRes.lastInsertRowid as number;

      this.run(
        `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
         VALUES (?, NULL, ?, ?, ?, 'escrow_hold', ?, ?)`,
        userId,
        jobId,
        -roundedAmount,
        newBalance,
        description,
        JSON.stringify({ holdId, ...(metadata ?? {}) }),
      );

      return {
        success: true,
        holdId,
        heldAmount: roundedAmount,
        newBalance,
      };
    });
  }

  settleUserEscrow(
    userId: number,
    jobId: number,
    actualCost: number,
    description: string = "HPC Compute Final Settlement",
    metadata?: Record<string, unknown>,
  ): { success: boolean; settledAmount: number; refundedAmount: number; newBalance: number } {
    if (!Number.isFinite(actualCost) || actualCost < 0) {
      throw new RangeError("Escrow settlement actualCost must be a non-negative finite number");
    }
    const actualCostCents = toCents(actualCost);
    const roundedActualCost = fromCents(actualCostCents);

    return this.immediateTransaction(() => {
      const hold = this.get<{ id: number; amount: number }>(
        `SELECT * FROM credit_escrow_holds
         WHERE user_id = ? AND job_id = ? AND status = 'held'
           AND org_id IS NULL
           AND (metadata IS NULL OR NOT json_valid(metadata) OR json_extract(metadata, '$.orgId') IS NULL)
         ORDER BY id DESC LIMIT 1`,
        userId,
        jobId,
      );

      const user = this.get<{ credit_balance?: number | undefined }>(
        `SELECT credit_balance FROM users WHERE id = ?`,
        userId,
      );

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      let currentCents = toCents(user.credit_balance ?? 0);
      let currentBalance = fromCents(currentCents);
      let refundedAmount = 0;

      if (hold) {
        const heldCents = toCents(hold.amount);
        if (heldCents > actualCostCents) {
          const refundCents = heldCents - actualCostCents;
          refundedAmount = fromCents(refundCents);
          currentCents = currentCents + refundCents;
          currentBalance = fromCents(currentCents);
          this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, currentBalance, userId);

          this.run(
            `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
             VALUES (?, NULL, ?, ?, ?, 'escrow_refund', ?, ?)`,
            userId,
            jobId,
            refundedAmount,
            currentBalance,
            `Escrow refund for job ${jobId}`,
            JSON.stringify(metadata ?? {}),
          );
        } else if (actualCostCents > heldCents) {
          const overageCents = actualCostCents - heldCents;
          const overage = fromCents(overageCents);
          const rawNewCents = currentCents - overageCents;
          currentCents = Math.max(0, rawNewCents);
          currentBalance = fromCents(currentCents);
          this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, currentBalance, userId);

          this.run(
            `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
             VALUES (?, NULL, ?, ?, ?, 'escrow_overage', ?, ?)`,
            userId,
            jobId,
            -overage,
            currentBalance,
            `Escrow overage for job ${jobId}`,
            JSON.stringify(metadata ?? {}),
          );

          if (rawNewCents < 0) {
            const writeoff = fromCents(-rawNewCents);
            this.run(
              `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
               VALUES (?, NULL, ?, ?, 0.0, 'bad_debt_writeoff', ?, ?)`,
              userId,
              jobId,
              writeoff,
              `Bad debt writeoff (balance clamped to 0.00) for job ${jobId}`,
              JSON.stringify(metadata ?? {}),
            );
          }
        }

        this.run(
          `UPDATE credit_escrow_holds SET status = 'settled', settled_at = datetime('now') WHERE id = ?`,
          hold.id,
        );
      } else {
        if (actualCostCents > 0) {
          const rawNewCents = currentCents - actualCostCents;
          currentCents = Math.max(0, rawNewCents);
          currentBalance = fromCents(currentCents);
          this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, currentBalance, userId);
          this.run(
            `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
             VALUES (?, NULL, ?, ?, ?, 'job_charge', ?, ?)`,
            userId,
            jobId,
            -roundedActualCost,
            currentBalance,
            description,
            JSON.stringify(metadata ?? {}),
          );

          if (rawNewCents < 0) {
            const writeoff = fromCents(-rawNewCents);
            this.run(
              `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
               VALUES (?, NULL, ?, ?, 0.0, 'bad_debt_writeoff', ?, ?)`,
              userId,
              jobId,
              writeoff,
              `Bad debt writeoff (balance clamped to 0.00) for job ${jobId}`,
              JSON.stringify(metadata ?? {}),
            );
          }
        }
      }

      if (currentBalance <= 10) {
        const existingUnread = this.get(
          `SELECT id FROM notifications WHERE user_id = ? AND type = 'credit_warning' AND read = 0`,
          userId,
        );
        if (!existingUnread) {
          this.facade.createNotification(userId, userId, "credit_warning", null, {
            balance: currentBalance,
            threshold: 10,
            message: `Your compute balance is ${currentBalance} credits (below threshold of 10).`,
          });
        }
      }

      return {
        success: true,
        settledAmount: roundedActualCost,
        refundedAmount,
        newBalance: currentBalance,
      };
    });
  }

  releaseUserEscrow(
    userId: number,
    jobId: number,
    reason: string = "Job canceled / aborted",
  ): { success: boolean; refundedAmount: number; newBalance: number } {
    return this.immediateTransaction(() => {
      const hold = this.get<{ id: number; amount: number }>(
        `SELECT * FROM credit_escrow_holds
         WHERE user_id = ? AND job_id = ? AND status = 'held'
           AND org_id IS NULL
           AND (metadata IS NULL OR NOT json_valid(metadata) OR json_extract(metadata, '$.orgId') IS NULL)
         ORDER BY id DESC LIMIT 1`,
        userId,
        jobId,
      );

      const user = this.get<{ credit_balance?: number | undefined }>(
        `SELECT credit_balance FROM users WHERE id = ?`,
        userId,
      );

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      let currentCents = toCents(user.credit_balance ?? 0);
      let currentBalance = fromCents(currentCents);
      let refundedAmount = 0;

      if (hold) {
        const refundCents = toCents(hold.amount);
        refundedAmount = fromCents(refundCents);
        currentCents = currentCents + refundCents;
        currentBalance = fromCents(currentCents);
        this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, currentBalance, userId);

        this.run(
          `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
           VALUES (?, NULL, ?, ?, ?, 'escrow_release', ?, ?)`,
          userId,
          jobId,
          refundedAmount,
          currentBalance,
          `Escrow released: ${reason}`,
          JSON.stringify({ holdId: hold.id, reason }),
        );

        this.run(
          `UPDATE credit_escrow_holds SET status = 'released', settled_at = datetime('now') WHERE id = ?`,
          hold.id,
        );
      }

      return {
        success: true,
        refundedAmount,
        newBalance: currentBalance,
      };
    });
  }

  releaseAllHeldEscrowsOnShutdown(): number {
    try {
      const heldRows = this.all<{
        id: number;
        user_id: number;
        org_id: number | null;
        job_id: number;
        amount: number;
        metadata: string | null;
      }>(`SELECT id, user_id, org_id, job_id, amount, metadata FROM credit_escrow_holds WHERE status = 'held'`);
      let releasedCount = 0;
      for (const row of heldRows) {
        try {
          let effectiveOrgId =
            typeof row.org_id === "number" && Number.isFinite(row.org_id) && row.org_id > 0 ? row.org_id : null;
          if (effectiveOrgId === null && row.metadata) {
            try {
              const parsed = JSON.parse(row.metadata) as { orgId?: unknown };
              const parsedOrgId = Number(parsed.orgId);
              if (Number.isInteger(parsedOrgId) && parsedOrgId > 0) {
                effectiveOrgId = parsedOrgId;
              }
            } catch {
              // Ignore malformed metadata JSON
            }
          }

          if (effectiveOrgId !== null) {
            this.releaseOrgEscrow(effectiveOrgId, row.job_id, "Server shutdown recovery");
          } else {
            this.releaseUserEscrow(row.user_id, row.job_id, "Server shutdown recovery");
          }
          releasedCount++;
        } catch {
          // Continue releasing remaining stale escrows if one row was already settled
        }
      }
      this.run(
        `UPDATE jobs SET status = 'CANCELLED', completed_at = datetime('now') WHERE status IN ('RUNNING', 'QUEUED', 'PENDING')`,
      );
      return releasedCount;
    } catch {
      return 0;
    }
  }

  getUserTransactions(userId: number, limit: number = 50, offset: number = 0): CreditTransactionRow[] {
    return this.all<CreditTransactionRow>(
      `SELECT id, user_id, org_id, job_id, amount, balance_after, type, type as transaction_type, description, metadata, created_at
       FROM credit_transactions
       WHERE user_id = ? AND org_id IS NULL AND type NOT LIKE 'org_%'
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      userId,
      limit,
      offset,
    );
  }

  getUserTransactionCount(userId: number): number {
    const row = this.get<{ count?: number | undefined }>(
      `SELECT COUNT(*) as count FROM credit_transactions WHERE user_id = ? AND org_id IS NULL AND type NOT LIKE 'org_%'`,
      userId,
    );
    return row?.count ?? 0;
  }

  getCreditTransactionById(txId: number): (CreditTransactionRow & { org_id?: number | null }) | undefined {
    return this.get<CreditTransactionRow & { org_id?: number | null }>(
      `SELECT id, user_id, org_id, job_id, amount, balance_after, type, type as transaction_type, description, metadata, created_at
       FROM credit_transactions
       WHERE id = ?`,
      txId,
    );
  }

  getOrgBalance(orgId: number): number {
    const row = this.get<{ credit_balance?: number | undefined }>(
      `SELECT credit_balance FROM organizations WHERE id = ?`,
      orgId,
    );
    return row?.credit_balance ?? 0;
  }

  grantOrgCredits(
    orgId: number,
    amount: number,
    actorUserId: number | null = null,
    description: string = "Organization Shared Wallet Top-Up",
    metadata?: Record<string, unknown>,
  ): number {
    const amountCents = toCents(amount);
    if (!Number.isFinite(amount) || amountCents <= 0) {
      throw new RangeError("Credit grant amount must be a positive finite number (>= 0.01 credits)");
    }
    const roundedAmount = fromCents(amountCents);

    return this.immediateTransaction(() => {
      const org = this.get<{ id: number; credit_balance?: number | undefined; created_by?: number | undefined }>(
        `SELECT id, credit_balance, created_by FROM organizations WHERE id = ?`,
        orgId,
      );
      if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
      }

      const currentCents = toCents(org.credit_balance ?? 0);
      const newBalance = fromCents(currentCents + amountCents);

      this.run(`UPDATE organizations SET credit_balance = ? WHERE id = ?`, newBalance, orgId);

      const effectiveUserId = actorUserId ?? org.created_by ?? 1;
      this.run(
        `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
         VALUES (?, ?, NULL, ?, ?, 'org_top_up', ?, ?)`,
        effectiveUserId,
        orgId,
        roundedAmount,
        newBalance,
        description,
        JSON.stringify({ orgId, ...(metadata ?? {}) }),
      );

      return newBalance;
    });
  }

  deductOrgCredits(
    orgId: number,
    amount: number,
    actorUserId: number | null = null,
    jobId: number | null = null,
    description: string = "Organization Compute Charge",
    metadata?: Record<string, unknown>,
  ): { success: boolean; newBalance: number; amount: number } {
    const amountCents = toCents(amount);
    if (!Number.isFinite(amount) || amountCents <= 0) {
      return { success: false, newBalance: this.getOrgBalance(orgId), amount: 0 };
    }
    const roundedAmount = fromCents(amountCents);

    return this.immediateTransaction(() => {
      const org = this.get<{
        id: number;
        credit_balance?: number | undefined;
        total_spent?: number | undefined;
        created_by?: number | undefined;
      }>(`SELECT id, credit_balance, total_spent, created_by FROM organizations WHERE id = ?`, orgId);
      if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
      }
      const currentCents = toCents(org.credit_balance ?? 0);
      const currentBalance = fromCents(currentCents);
      if (currentCents < amountCents) {
        return { success: false, newBalance: currentBalance, amount: -roundedAmount };
      }
      const newBalance = fromCents(Math.max(0, currentCents - amountCents));
      const newTotalSpent = fromCents(toCents(org.total_spent ?? 0) + amountCents);

      this.run(
        `UPDATE organizations SET credit_balance = ?, total_spent = ? WHERE id = ?`,
        newBalance,
        newTotalSpent,
        orgId,
      );

      const effectiveUserId = actorUserId ?? org.created_by ?? 1;
      this.run(
        `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
         VALUES (?, ?, ?, ?, ?, 'org_job_charge', ?, ?)`,
        effectiveUserId,
        orgId,
        jobId,
        -roundedAmount,
        newBalance,
        description,
        JSON.stringify({ orgId, ...(metadata ?? {}) }),
      );

      return { success: true, newBalance, amount: -roundedAmount };
    });
  }

  holdOrgCredits(
    orgId: number,
    amount: number,
    actorUserId: number | null = null,
    jobId: number | null = null,
    description: string = "Organization HPC Escrow Hold",
    metadata?: Record<string, unknown>,
  ): {
    success: boolean;
    holdId?: number | undefined;
    heldAmount: number;
    newBalance: number;
    reason?: string | undefined;
  } {
    const amountCents = toCents(amount);
    if (!Number.isFinite(amount) || amountCents <= 0) {
      const balance = this.getOrgBalance(orgId);
      return {
        success: false,
        heldAmount: 0,
        newBalance: balance,
        reason: "Escrow hold amount must be at least 0.01 credits",
      };
    }

    const roundedAmount = fromCents(amountCents);

    return this.immediateTransaction(() => {
      const org = this.get<{ id: number; credit_balance?: number | undefined; created_by?: number | undefined }>(
        `SELECT id, credit_balance, created_by FROM organizations WHERE id = ?`,
        orgId,
      );

      if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
      }

      const currentCents = toCents(org.credit_balance ?? 0);
      const currentBalance = fromCents(currentCents);
      if (currentCents < amountCents) {
        return {
          success: false,
          heldAmount: 0,
          newBalance: currentBalance,
          reason: `Insufficient organization balance (${currentBalance.toFixed(1)} cr) to place required escrow hold of ${roundedAmount.toFixed(1)} cr`,
        };
      }

      const newBalance = fromCents(currentCents - amountCents);
      this.run(`UPDATE organizations SET credit_balance = ? WHERE id = ?`, newBalance, orgId);

      const effectiveUserId = actorUserId ?? org.created_by ?? 1;
      const combinedMeta = { orgId, ...(metadata ?? {}) };

      const holdRes = this.run(
        `INSERT INTO credit_escrow_holds (user_id, org_id, job_id, amount, status, description, metadata)
         VALUES (?, ?, ?, ?, 'held', ?, ?)`,
        effectiveUserId,
        orgId,
        jobId,
        roundedAmount,
        description,
        JSON.stringify(combinedMeta),
      );

      const holdId = holdRes.lastInsertRowid as number;

      this.run(
        `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
         VALUES (?, ?, ?, ?, ?, 'org_escrow_hold', ?, ?)`,
        effectiveUserId,
        orgId,
        jobId,
        -roundedAmount,
        newBalance,
        description,
        JSON.stringify({ holdId, ...combinedMeta }),
      );

      return {
        success: true,
        holdId,
        heldAmount: roundedAmount,
        newBalance,
      };
    });
  }

  settleOrgEscrow(
    orgId: number,
    jobId: number,
    actualCost: number,
    actorUserId: number | null = null,
    description: string = "Organization HPC Compute Final Settlement",
    metadata?: Record<string, unknown>,
  ): { success: boolean; settledAmount: number; refundedAmount: number; newBalance: number } {
    if (!Number.isFinite(actualCost) || actualCost < 0) {
      throw new RangeError("Escrow settlement actualCost must be a non-negative finite number");
    }
    const actualCostCents = toCents(actualCost);
    const roundedActualCost = fromCents(actualCostCents);

    return this.immediateTransaction(() => {
      const hold = this.get<{ id: number; amount: number; user_id: number; metadata: string }>(
        `SELECT * FROM credit_escrow_holds
         WHERE job_id = ? AND status = 'held'
           AND (org_id = ? OR (org_id IS NULL AND json_valid(metadata) AND CAST(json_extract(metadata, '$.orgId') AS INTEGER) = ?))
         ORDER BY id DESC LIMIT 1`,
        jobId,
        orgId,
        orgId,
      );

      const org = this.get<{
        id: number;
        credit_balance?: number | undefined;
        total_spent?: number | undefined;
        created_by?: number | undefined;
      }>(`SELECT id, credit_balance, total_spent, created_by FROM organizations WHERE id = ?`, orgId);

      if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
      }

      let currentCents = toCents(org.credit_balance ?? 0);
      let currentBalance = fromCents(currentCents);
      let refundedAmount = 0;
      const effectiveUserId = actorUserId ?? org.created_by ?? 1;
      const combinedMeta = { orgId, ...(metadata ?? {}) };

      if (hold) {
        const heldCents = toCents(hold.amount);
        const newTotalSpent = fromCents(toCents(org.total_spent ?? 0) + actualCostCents);
        if (heldCents > actualCostCents) {
          const refundCents = heldCents - actualCostCents;
          refundedAmount = fromCents(refundCents);
          currentCents = currentCents + refundCents;
          currentBalance = fromCents(currentCents);
          this.run(
            `UPDATE organizations SET credit_balance = ?, total_spent = ? WHERE id = ?`,
            currentBalance,
            newTotalSpent,
            orgId,
          );

          this.run(
            `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
             VALUES (?, ?, ?, ?, ?, 'org_escrow_refund', ?, ?)`,
            effectiveUserId,
            orgId,
            jobId,
            refundedAmount,
            currentBalance,
            `Escrow refund for job ${jobId}`,
            JSON.stringify(combinedMeta),
          );
        } else if (actualCostCents > heldCents) {
          const overageCents = actualCostCents - heldCents;
          const overage = fromCents(overageCents);
          const rawNewCents = currentCents - overageCents;
          currentCents = Math.max(0, rawNewCents);
          currentBalance = fromCents(currentCents);
          this.run(
            `UPDATE organizations SET credit_balance = ?, total_spent = ? WHERE id = ?`,
            currentBalance,
            newTotalSpent,
            orgId,
          );

          this.run(
            `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
             VALUES (?, ?, ?, ?, ?, 'org_escrow_overage', ?, ?)`,
            effectiveUserId,
            orgId,
            jobId,
            -overage,
            currentBalance,
            `Escrow overage charge for job ${jobId}`,
            JSON.stringify(combinedMeta),
          );

          if (rawNewCents < 0) {
            const writeoff = fromCents(-rawNewCents);
            this.run(
              `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
               VALUES (?, ?, ?, ?, 0.0, 'org_bad_debt_writeoff', ?, ?)`,
              effectiveUserId,
              orgId,
              jobId,
              writeoff,
              `Bad debt writeoff (balance clamped to 0.00) for job ${jobId}`,
              JSON.stringify(combinedMeta),
            );
          }
        } else {
          this.run(`UPDATE organizations SET total_spent = ? WHERE id = ?`, newTotalSpent, orgId);
        }

        this.run(
          `UPDATE credit_escrow_holds SET status = 'settled', settled_at = datetime('now') WHERE id = ?`,
          hold.id,
        );
      } else {
        if (actualCostCents > 0) {
          const rawNewCents = currentCents - actualCostCents;
          currentCents = Math.max(0, rawNewCents);
          currentBalance = fromCents(currentCents);
          const newTotalSpent = fromCents(toCents(org.total_spent ?? 0) + actualCostCents);
          this.run(
            `UPDATE organizations SET credit_balance = ?, total_spent = ? WHERE id = ?`,
            currentBalance,
            newTotalSpent,
            orgId,
          );

          this.run(
            `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
             VALUES (?, ?, ?, ?, ?, 'org_direct_charge', ?, ?)`,
            effectiveUserId,
            orgId,
            jobId,
            -roundedActualCost,
            currentBalance,
            description,
            JSON.stringify(combinedMeta),
          );

          if (rawNewCents < 0) {
            const writeoff = fromCents(-rawNewCents);
            this.run(
              `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
               VALUES (?, ?, ?, ?, 0.0, 'org_bad_debt_writeoff', ?, ?)`,
              effectiveUserId,
              orgId,
              jobId,
              writeoff,
              `Bad debt writeoff (balance clamped to 0.00) for job ${jobId}`,
              JSON.stringify(combinedMeta),
            );
          }
        }
      }

      return {
        success: true,
        settledAmount: roundedActualCost,
        refundedAmount,
        newBalance: currentBalance,
      };
    });
  }

  releaseOrgEscrow(
    orgId: number,
    jobId: number,
    reason: string = "Job canceled / aborted",
  ): { success: boolean; refundedAmount: number; newBalance: number } {
    return this.immediateTransaction(() => {
      const hold = this.get<{ id: number; amount: number; user_id: number; metadata: string }>(
        `SELECT * FROM credit_escrow_holds
         WHERE job_id = ? AND status = 'held'
           AND (org_id = ? OR (org_id IS NULL AND json_valid(metadata) AND CAST(json_extract(metadata, '$.orgId') AS INTEGER) = ?))
         ORDER BY id DESC LIMIT 1`,
        jobId,
        orgId,
        orgId,
      );

      const org = this.get<{ id: number; credit_balance?: number | undefined; created_by?: number | undefined }>(
        `SELECT id, credit_balance, created_by FROM organizations WHERE id = ?`,
        orgId,
      );

      if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
      }

      let currentCents = toCents(org.credit_balance ?? 0);
      let currentBalance = fromCents(currentCents);
      let refundedAmount = 0;

      if (hold) {
        const refundCents = toCents(hold.amount);
        refundedAmount = fromCents(refundCents);
        currentCents = currentCents + refundCents;
        currentBalance = fromCents(currentCents);
        this.run(`UPDATE organizations SET credit_balance = ? WHERE id = ?`, currentBalance, orgId);

        const effectiveUserId = hold.user_id || org.created_by || 1;
        this.run(
          `INSERT INTO credit_transactions (user_id, org_id, job_id, amount, balance_after, type, description, metadata)
           VALUES (?, ?, ?, ?, ?, 'org_escrow_release', ?, ?)`,
          effectiveUserId,
          orgId,
          jobId,
          refundedAmount,
          currentBalance,
          `Escrow released: ${reason}`,
          JSON.stringify({ holdId: hold.id, orgId, reason }),
        );

        this.run(
          `UPDATE credit_escrow_holds SET status = 'released', settled_at = datetime('now') WHERE id = ?`,
          hold.id,
        );
      }

      return {
        success: true,
        refundedAmount,
        newBalance: currentBalance,
      };
    });
  }

  getOrgWalletSummary(orgId: number): {
    orgId: number;
    name: string;
    slug: string;
    balance: number;
    totalSpent: number;
    transactions: CreditTransactionRow[];
    activeTier: BillingTier;
    subscriptionStatus: string;
    billingCycle: "monthly" | "annual" | null;
    profiles: ReturnType<typeof listComputeProfiles>;
  } | null {
    const org = this.get<{
      id: number;
      name: string;
      slug: string;
      credit_balance?: number | undefined;
      total_spent?: number | undefined;
    }>(`SELECT id, name, slug, credit_balance, total_spent FROM organizations WHERE id = ?`, orgId);
    if (!org) return null;

    const transactions = this.all<CreditTransactionRow>(
      `SELECT id, user_id, org_id, job_id, amount, balance_after, type, type as transaction_type, description, metadata, created_at
       FROM credit_transactions
       WHERE org_id = ?
          OR (org_id IS NULL AND json_valid(metadata) AND CAST(json_extract(metadata, '$.orgId') AS INTEGER) = ?)
       ORDER BY id DESC
       LIMIT 50`,
      orgId,
      orgId,
    );

    const sub = this.getSubscriptionState({ orgId });

    return {
      orgId: org.id,
      name: org.name,
      slug: org.slug,
      balance: org.credit_balance ?? 0,
      totalSpent: org.total_spent ?? 0,
      transactions,
      activeTier: sub.activeTier,
      subscriptionStatus: sub.subscriptionStatus,
      billingCycle: sub.billingCycle,
      profiles: listComputeProfiles(),
    };
  }

  getUserBillingSummary(userId: number): UserBillingSummary & {
    activeTier: BillingTier;
    subscriptionStatus: string;
    billingCycle: "monthly" | "annual" | null;
  } {
    const balance = this.getUserBalance(userId);
    const grouped = this.all<{
      compute_profile: string;
      jobs_count: number;
      cost_credits: number;
      cpu_seconds: number;
      gpu_seconds: number;
    }>(
      `SELECT
         COALESCE(compute_profile, 'standard') AS compute_profile,
         COUNT(*) AS jobs_count,
         COALESCE(SUM(cost_credits), 0) AS cost_credits,
         COALESCE(SUM(cpu_seconds), 0) AS cpu_seconds,
         COALESCE(SUM(gpu_seconds), 0) AS gpu_seconds
       FROM jobs
       WHERE user_id = ? AND status = 'SUCCESS'
       GROUP BY COALESCE(compute_profile, 'standard')`,
      userId,
    );

    let totalSpent = 0;
    let totalJobs = 0;
    let totalCpuSeconds = 0;
    let totalGpuSeconds = 0;
    const profileUsage: Record<string, { jobsCount: number; costCredits: number; cpuSeconds: number }> = {};

    for (const row of grouped) {
      const p = row.compute_profile || "standard";
      const jobsCount = Number(row.jobs_count || 0);
      const credits = roundCredits(Number(row.cost_credits || 0));
      const cpu = Number(row.cpu_seconds || 0);
      const gpu = Number(row.gpu_seconds || 0);

      totalJobs += jobsCount;
      totalSpent = roundCredits(totalSpent + credits);
      totalCpuSeconds += cpu;
      totalGpuSeconds += gpu;

      profileUsage[p] = {
        jobsCount,
        costCredits: credits,
        cpuSeconds: cpu,
      };
    }

    const recentTransactions = this.getUserTransactions(userId, 20, 0);
    const sub = this.getSubscriptionState({ userId });

    return {
      userId,
      creditBalance: balance,
      totalSpent,
      totalJobs,
      totalCpuSeconds,
      totalGpuSeconds,
      profileUsage,
      recentTransactions,
      wallet: {
        balance,
        total_spent: totalSpent,
        total_jobs_dispatched: totalJobs,
        total_cpu_core_hours: Number((totalCpuSeconds / 3600).toFixed(4)),
        total_gpu_hours: Number((totalGpuSeconds / 3600).toFixed(4)),
      },
      recent_transactions: recentTransactions,
      profiles: listComputeProfiles(),
      activeTier: sub.activeTier,
      subscriptionStatus: sub.subscriptionStatus,
      billingCycle: sub.billingCycle,
    };
  }
}
