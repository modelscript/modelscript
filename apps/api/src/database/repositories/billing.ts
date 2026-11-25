// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CreditTransactionRow, UserBillingSummary } from "../../database.js";
import { listComputeProfiles } from "../../services/hpc/compute-profiles.js";
import { BaseRepository } from "./base.js";

export class BillingRepository extends BaseRepository {
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
    this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, balance, userId);
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
    return this.immediateTransaction(() => {
      const user = this.get<{ credit_balance?: number | undefined }>(
        `SELECT credit_balance FROM users WHERE id = ?`,
        userId,
      );
      if (!user) {
        return { success: false, userId, previousBalance: 0, newBalance: 0 };
      }
      const previousBalance = Number(user.credit_balance ?? 0);
      const newBalance = Math.max(0, Number((previousBalance + deltaCredits).toFixed(4)));
      const txType = deltaCredits >= 0 ? "admin_grant" : "admin_deduction";

      this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, newBalance, userId);
      this.run(
        `INSERT INTO credit_transactions (user_id, amount, balance_after, type, description)
         VALUES (?, ?, ?, ?, ?)`,
        userId,
        deltaCredits,
        newBalance,
        txType,
        reason || "Administrator compute wallet adjustment",
      );

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
    const user = this.get<{ credit_balance?: number | undefined }>(
      `SELECT credit_balance FROM users WHERE id = ?`,
      userId,
    );
    if (!user) {
      return { success: false, previousBalance: 0 };
    }

    const previousBalance = Math.round((user.credit_balance || 0) * 100) / 100;

    this.run(
      `UPDATE users SET credit_balance = 0.0, status = 'suspended_dispute', token_version = COALESCE(token_version, 1) + 1 WHERE id = ?`,
      userId,
    );

    try {
      this.run(
        `UPDATE credit_escrow_holds SET status = 'frozen_dispute', settled_at = datetime('now') WHERE user_id = ? AND status = 'held'`,
        userId,
      );
    } catch {
      // ignore
    }

    try {
      this.run(
        `UPDATE jobs SET status = 'CANCELLED', completed_at = datetime('now') WHERE user_id = ? AND status IN ('PENDING', 'RUNNING', 'QUEUED')`,
        userId,
      );
    } catch {
      // ignore
    }

    try {
      this.run(
        `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description)
         VALUES (?, NULL, ?, 0.0, 'dispute_freeze', ?)`,
        userId,
        -previousBalance,
        `Dispute/Chargeback quarantine: ${reason}`,
      );
    } catch {
      // ignore
    }

    try {
      this.facade.logAudit({
        actorId: userId,
        action: "user_dispute_frozen",
        resourceType: "user",
        resourceId: String(userId),
        details: { reason, previousBalance },
      });
    } catch {
      // ignore
    }

    return { success: true, previousBalance };
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
    if (amount <= 0) {
      const balance = this.getUserBalance(userId);
      return {
        success: true,
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

    return this.immediateTransaction(() => {
      const user = this.get<{ credit_balance?: number | undefined }>(
        `SELECT credit_balance FROM users WHERE id = ?`,
        userId,
      );

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      const currentBalance = user.credit_balance ?? 0;
      if (currentBalance < amount) {
        return {
          success: false,
          user_id: userId,
          job_id: jobId,
          amount: -amount,
          balance_after: currentBalance,
          transaction_type: "job_settlement",
          type: "job_settlement",
          description,
          newBalance: currentBalance,
        };
      }

      const roundedAmount = Math.round(amount * 100) / 100;
      const newBalance = Math.round(Math.max(0, currentBalance - roundedAmount) * 100) / 100;

      this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, newBalance, userId);

      const txResult = this.run(
        `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
         VALUES (?, ?, ?, ?, 'job_charge', ?, ?)`,
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
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new RangeError("Credit grant amount must be a positive finite number");
    }
    return this.immediateTransaction(() => {
      const user = this.get<{ credit_balance?: number | undefined }>(
        `SELECT credit_balance FROM users WHERE id = ?`,
        userId,
      );

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      const currentBalance = user.credit_balance ?? 0;
      const roundedAmount = Math.round(amount * 100) / 100;
      const newBalance = Math.round((currentBalance + roundedAmount) * 100) / 100;

      this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, newBalance, userId);

      this.run(
        `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
         VALUES (?, NULL, ?, ?, ?, ?, ?)`,
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
        Math.round(amountCredits * 100) / 100,
      );
      return true;
    } catch {
      return false;
    }
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
    if (amount <= 0) {
      const balance = this.getUserBalance(userId);
      return { success: true, heldAmount: 0, newBalance: balance };
    }

    return this.immediateTransaction(() => {
      const user = this.get<{ credit_balance?: number | undefined }>(
        `SELECT credit_balance FROM users WHERE id = ?`,
        userId,
      );

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      const currentBalance = user.credit_balance ?? 0;
      if (currentBalance < amount) {
        return {
          success: false,
          heldAmount: 0,
          newBalance: currentBalance,
          reason: `Insufficient balance (${currentBalance.toFixed(1)} cr) to place required escrow hold of ${amount.toFixed(1)} cr`,
        };
      }

      const newBalance = Math.round((currentBalance - amount) * 100) / 100;
      this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, newBalance, userId);

      const holdRes = this.run(
        `INSERT INTO credit_escrow_holds (user_id, job_id, amount, status, description, metadata)
         VALUES (?, ?, ?, 'held', ?, ?)`,
        userId,
        jobId,
        amount,
        description,
        JSON.stringify(metadata ?? {}),
      );

      const holdId = holdRes.lastInsertRowid as number;

      this.run(
        `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
         VALUES (?, ?, ?, ?, 'escrow_hold', ?, ?)`,
        userId,
        jobId,
        -amount,
        newBalance,
        description,
        JSON.stringify({ holdId, ...(metadata ?? {}) }),
      );

      return {
        success: true,
        holdId,
        heldAmount: amount,
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
    return this.immediateTransaction(() => {
      const hold = this.get<{ id: number; amount: number }>(
        `SELECT * FROM credit_escrow_holds WHERE user_id = ? AND job_id = ? AND status = 'held' ORDER BY id DESC LIMIT 1`,
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

      let currentBalance = user.credit_balance ?? 0;
      let refundedAmount = 0;
      const finalCost = actualCost;

      if (hold) {
        const heldAmount = hold.amount;
        if (heldAmount > actualCost) {
          refundedAmount = Math.round((heldAmount - actualCost) * 100) / 100;
          currentBalance = Math.round((currentBalance + refundedAmount) * 100) / 100;
          this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, currentBalance, userId);

          this.run(
            `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
             VALUES (?, ?, ?, ?, 'escrow_refund', ?, ?)`,
            userId,
            jobId,
            refundedAmount,
            currentBalance,
            `Escrow refund for job ${jobId}`,
            JSON.stringify(metadata ?? {}),
          );
        } else if (actualCost > heldAmount) {
          const overage = Math.round((actualCost - heldAmount) * 100) / 100;
          currentBalance = Math.round(Math.max(0, currentBalance - overage) * 100) / 100;
          this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, currentBalance, userId);

          this.run(
            `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
             VALUES (?, ?, ?, ?, 'escrow_overage', ?, ?)`,
            userId,
            jobId,
            -overage,
            currentBalance,
            `Escrow overage for job ${jobId}`,
            JSON.stringify(metadata ?? {}),
          );
        }

        this.run(
          `UPDATE credit_escrow_holds SET status = 'settled', settled_at = datetime('now') WHERE id = ?`,
          hold.id,
        );
      } else {
        if (actualCost > 0) {
          currentBalance = Math.round(Math.max(0, currentBalance - actualCost) * 100) / 100;
          this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, currentBalance, userId);
          this.run(
            `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
             VALUES (?, ?, ?, ?, 'job_charge', ?, ?)`,
            userId,
            jobId,
            -actualCost,
            currentBalance,
            description,
            JSON.stringify(metadata ?? {}),
          );
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
        settledAmount: finalCost,
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
        `SELECT * FROM credit_escrow_holds WHERE user_id = ? AND job_id = ? AND status = 'held' ORDER BY id DESC LIMIT 1`,
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

      let currentBalance = user.credit_balance ?? 0;
      let refundedAmount = 0;

      if (hold) {
        refundedAmount = hold.amount;
        currentBalance = Math.round((currentBalance + refundedAmount) * 100) / 100;
        this.run(`UPDATE users SET credit_balance = ? WHERE id = ?`, currentBalance, userId);

        this.run(
          `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
           VALUES (?, ?, ?, ?, 'escrow_release', ?, ?)`,
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
      const heldRows = this.all<{ id: number; user_id: number; job_id: number; amount: number }>(
        `SELECT id, user_id, job_id, amount FROM credit_escrow_holds WHERE status = 'held'`,
      );
      let releasedCount = 0;
      for (const row of heldRows) {
        try {
          this.releaseUserEscrow(row.user_id, row.job_id, "Server shutdown recovery");
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
      `SELECT id, user_id, job_id, amount, balance_after, type, type as transaction_type, description, metadata, created_at
       FROM credit_transactions
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      userId,
      limit,
      offset,
    );
  }

  getUserTransactionCount(userId: number): number {
    const row = this.get<{ count?: number | undefined }>(
      `SELECT COUNT(*) as count FROM credit_transactions WHERE user_id = ?`,
      userId,
    );
    return row?.count ?? 0;
  }

  getCreditTransactionById(txId: number): CreditTransactionRow | undefined {
    return this.get<CreditTransactionRow>(
      `SELECT id, user_id, job_id, amount, balance_after, type, type as transaction_type, description, metadata, created_at
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
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new RangeError("Credit grant amount must be a positive finite number");
    }
    return this.immediateTransaction(() => {
      const org = this.get<{ id: number; credit_balance?: number | undefined; created_by?: number | undefined }>(
        `SELECT id, credit_balance, created_by FROM organizations WHERE id = ?`,
        orgId,
      );
      if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
      }

      const currentBalance = org.credit_balance ?? 0;
      const roundedAmount = Math.round(amount * 100) / 100;
      const newBalance = Math.round((currentBalance + roundedAmount) * 100) / 100;

      this.run(`UPDATE organizations SET credit_balance = ? WHERE id = ?`, newBalance, orgId);

      const effectiveUserId = actorUserId ?? org.created_by ?? 1;
      this.run(
        `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
         VALUES (?, NULL, ?, ?, 'org_top_up', ?, ?)`,
        effectiveUserId,
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
    if (amount <= 0) {
      return { success: true, newBalance: this.getOrgBalance(orgId), amount: 0 };
    }
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
      const currentBalance = org.credit_balance ?? 0;
      const roundedAmount = Math.round(amount * 100) / 100;
      if (currentBalance < roundedAmount) {
        return { success: false, newBalance: currentBalance, amount: -roundedAmount };
      }
      const newBalance = Math.round(Math.max(0, currentBalance - roundedAmount) * 100) / 100;
      const newTotalSpent = Math.round(((org.total_spent ?? 0) + roundedAmount) * 100) / 100;

      this.run(
        `UPDATE organizations SET credit_balance = ?, total_spent = ? WHERE id = ?`,
        newBalance,
        newTotalSpent,
        orgId,
      );

      const effectiveUserId = actorUserId ?? org.created_by ?? 1;
      this.run(
        `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
         VALUES (?, ?, ?, ?, 'org_job_charge', ?, ?)`,
        effectiveUserId,
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
    if (amount <= 0) {
      const balance = this.getOrgBalance(orgId);
      return { success: true, heldAmount: 0, newBalance: balance };
    }

    return this.immediateTransaction(() => {
      const org = this.get<{ id: number; credit_balance?: number | undefined; created_by?: number | undefined }>(
        `SELECT id, credit_balance, created_by FROM organizations WHERE id = ?`,
        orgId,
      );

      if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
      }

      const currentBalance = org.credit_balance ?? 0;
      if (currentBalance < amount) {
        return {
          success: false,
          heldAmount: 0,
          newBalance: currentBalance,
          reason: `Insufficient organization balance (${currentBalance.toFixed(1)} cr) to place required escrow hold of ${amount.toFixed(1)} cr`,
        };
      }

      const newBalance = Math.round((currentBalance - amount) * 100) / 100;
      this.run(`UPDATE organizations SET credit_balance = ? WHERE id = ?`, newBalance, orgId);

      const effectiveUserId = actorUserId ?? org.created_by ?? 1;
      const combinedMeta = { orgId, ...(metadata ?? {}) };

      const holdRes = this.run(
        `INSERT INTO credit_escrow_holds (user_id, job_id, amount, status, description, metadata)
         VALUES (?, ?, ?, 'held', ?, ?)`,
        effectiveUserId,
        jobId,
        amount,
        description,
        JSON.stringify(combinedMeta),
      );

      const holdId = holdRes.lastInsertRowid as number;

      this.run(
        `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
         VALUES (?, ?, ?, ?, 'org_escrow_hold', ?, ?)`,
        effectiveUserId,
        jobId,
        -amount,
        newBalance,
        description,
        JSON.stringify({ holdId, ...combinedMeta }),
      );

      return {
        success: true,
        holdId,
        heldAmount: amount,
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
    return this.immediateTransaction(() => {
      const allHolds = this.all<{ id: number; amount: number; user_id: number; metadata: string }>(
        `SELECT * FROM credit_escrow_holds WHERE job_id = ? AND status = 'held' ORDER BY id DESC`,
        jobId,
      );

      const hold =
        allHolds.find((h) => {
          try {
            const parsed = JSON.parse(h.metadata || "{}");
            return Number(parsed.orgId) === orgId;
          } catch {
            return false;
          }
        }) || allHolds[0];

      const org = this.get<{
        id: number;
        credit_balance?: number | undefined;
        total_spent?: number | undefined;
        created_by?: number | undefined;
      }>(`SELECT id, credit_balance, total_spent, created_by FROM organizations WHERE id = ?`, orgId);

      if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
      }

      let currentBalance = org.credit_balance ?? 0;
      let refundedAmount = 0;
      const effectiveUserId = actorUserId ?? org.created_by ?? 1;
      const combinedMeta = { orgId, ...(metadata ?? {}) };

      if (hold) {
        const heldAmount = hold.amount;
        if (heldAmount > actualCost) {
          refundedAmount = Math.round((heldAmount - actualCost) * 100) / 100;
          currentBalance = Math.round((currentBalance + refundedAmount) * 100) / 100;
          const newTotalSpent = Math.round(((org.total_spent ?? 0) + actualCost) * 100) / 100;
          this.run(
            `UPDATE organizations SET credit_balance = ?, total_spent = ? WHERE id = ?`,
            currentBalance,
            newTotalSpent,
            orgId,
          );

          this.run(
            `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
             VALUES (?, ?, ?, ?, 'org_escrow_refund', ?, ?)`,
            effectiveUserId,
            jobId,
            refundedAmount,
            currentBalance,
            `Escrow refund for job ${jobId}`,
            JSON.stringify(combinedMeta),
          );
        } else if (actualCost > heldAmount) {
          const overage = Math.round((actualCost - heldAmount) * 100) / 100;
          currentBalance = Math.round(Math.max(0, currentBalance - overage) * 100) / 100;
          const newTotalSpent = Math.round(((org.total_spent ?? 0) + actualCost) * 100) / 100;
          this.run(
            `UPDATE organizations SET credit_balance = ?, total_spent = ? WHERE id = ?`,
            currentBalance,
            newTotalSpent,
            orgId,
          );

          this.run(
            `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
             VALUES (?, ?, ?, ?, 'org_escrow_overage', ?, ?)`,
            effectiveUserId,
            jobId,
            -overage,
            currentBalance,
            `Escrow overage charge for job ${jobId}`,
            JSON.stringify(combinedMeta),
          );
        } else {
          const newTotalSpent = Math.round(((org.total_spent ?? 0) + actualCost) * 100) / 100;
          this.run(`UPDATE organizations SET total_spent = ? WHERE id = ?`, newTotalSpent, orgId);
        }

        this.run(
          `UPDATE credit_escrow_holds SET status = 'settled', settled_at = datetime('now') WHERE id = ?`,
          hold.id,
        );
      } else {
        if (actualCost > 0) {
          currentBalance = Math.round(Math.max(0, currentBalance - actualCost) * 100) / 100;
          const newTotalSpent = Math.round(((org.total_spent ?? 0) + actualCost) * 100) / 100;
          this.run(
            `UPDATE organizations SET credit_balance = ?, total_spent = ? WHERE id = ?`,
            currentBalance,
            newTotalSpent,
            orgId,
          );

          this.run(
            `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
             VALUES (?, ?, ?, ?, 'org_direct_charge', ?, ?)`,
            effectiveUserId,
            jobId,
            -actualCost,
            currentBalance,
            description,
            JSON.stringify(combinedMeta),
          );
        }
      }

      return {
        success: true,
        settledAmount: actualCost,
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
      const allHolds = this.all<{ id: number; amount: number; user_id: number; metadata: string }>(
        `SELECT * FROM credit_escrow_holds WHERE job_id = ? AND status = 'held' ORDER BY id DESC`,
        jobId,
      );

      const hold =
        allHolds.find((h) => {
          try {
            const parsed = JSON.parse(h.metadata || "{}");
            return Number(parsed.orgId) === orgId;
          } catch {
            return false;
          }
        }) || allHolds[0];

      const org = this.get<{ id: number; credit_balance?: number | undefined; created_by?: number | undefined }>(
        `SELECT id, credit_balance, created_by FROM organizations WHERE id = ?`,
        orgId,
      );

      if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
      }

      let currentBalance = org.credit_balance ?? 0;
      let refundedAmount = 0;

      if (hold) {
        refundedAmount = hold.amount;
        currentBalance = Math.round((currentBalance + refundedAmount) * 100) / 100;
        this.run(`UPDATE organizations SET credit_balance = ? WHERE id = ?`, currentBalance, orgId);

        const effectiveUserId = hold.user_id || org.created_by || 1;
        this.run(
          `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
           VALUES (?, ?, ?, ?, 'org_escrow_release', ?, ?)`,
          effectiveUserId,
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
      `SELECT id, user_id, job_id, amount, balance_after, type, type as transaction_type, description, metadata, created_at
       FROM credit_transactions
       WHERE json_valid(metadata) AND CAST(json_extract(metadata, '$.orgId') AS INTEGER) = ?
       ORDER BY id DESC
       LIMIT 50`,
      orgId,
    );

    return {
      orgId: org.id,
      name: org.name,
      slug: org.slug,
      balance: org.credit_balance ?? 0,
      totalSpent: org.total_spent ?? 0,
      transactions,
    };
  }

  getUserBillingSummary(userId: number): UserBillingSummary {
    const balance = this.getUserBalance(userId);
    const jobs = this.all<{
      compute_profile: string | null;
      cpu_seconds: number | null;
      gpu_seconds: number | null;
      cost_credits: number | null;
    }>(
      `SELECT compute_profile, cpu_seconds, gpu_seconds, cost_credits
       FROM jobs
       WHERE user_id = ? AND status = 'SUCCESS'`,
      userId,
    );

    let totalSpent = 0;
    let totalCpuSeconds = 0;
    let totalGpuSeconds = 0;
    const profileUsage: Record<string, { jobsCount: number; costCredits: number; cpuSeconds: number }> = {};

    for (const j of jobs) {
      const p = j.compute_profile || "standard";
      const credits = j.cost_credits || 0;
      const cpu = j.cpu_seconds || 0;
      const gpu = j.gpu_seconds || 0;

      totalSpent += credits;
      totalCpuSeconds += cpu;
      totalGpuSeconds += gpu;

      if (!profileUsage[p]) {
        profileUsage[p] = { jobsCount: 0, costCredits: 0, cpuSeconds: 0 };
      }
      profileUsage[p].jobsCount += 1;
      profileUsage[p].costCredits += credits;
      profileUsage[p].cpuSeconds += cpu;
    }

    const recentTransactions = this.getUserTransactions(userId, 20, 0);

    return {
      userId,
      creditBalance: balance,
      totalSpent,
      totalJobs: jobs.length,
      totalCpuSeconds,
      totalGpuSeconds,
      profileUsage,
      recentTransactions,
      wallet: {
        balance,
        total_spent: totalSpent,
        total_jobs_dispatched: jobs.length,
        total_cpu_core_hours: Number((totalCpuSeconds / 3600).toFixed(4)),
        total_gpu_hours: Number((totalGpuSeconds / 3600).toFixed(4)),
      },
      recent_transactions: recentTransactions,
      profiles: listComputeProfiles(),
    };
  }
}
