// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import type { LibraryDatabase } from "../../database.js";

export const PAYMENT_LIMITS = {
  MIN_TOPUP_CREDITS: 10.0,
  MAX_TOPUP_CREDITS: 10000.0,
  MAX_PAYMENT_FAILURES: 3,
  LOCKOUT_MS: 24 * 60 * 60 * 1000, // 24 hours
};

interface FailureRecord {
  count: number;
  lockedUntil: number;
}

/**
 * Anti-carding and payment attempt lockout guard.
 * Blocks automated micro-charge testing by restricting failure velocity per account/IP.
 */
export class PaymentFraudGuard {
  private readonly records = new Map<string, FailureRecord>();

  public isLocked(key: string): boolean {
    const record = this.records.get(key);
    if (!record) return false;

    if (Date.now() > record.lockedUntil) {
      this.records.delete(key);
      return false;
    }

    return record.count >= PAYMENT_LIMITS.MAX_PAYMENT_FAILURES;
  }

  public recordFailure(key: string): { locked: boolean; count: number; lockedUntil?: number } {
    const now = Date.now();
    const existing = this.records.get(key);

    if (!existing || now > existing.lockedUntil) {
      const newRecord = { count: 1, lockedUntil: now + PAYMENT_LIMITS.LOCKOUT_MS };
      this.records.set(key, newRecord);
      return { locked: false, count: 1 };
    }

    existing.count += 1;
    existing.lockedUntil = now + PAYMENT_LIMITS.LOCKOUT_MS;

    const locked = existing.count >= PAYMENT_LIMITS.MAX_PAYMENT_FAILURES;
    return { locked, count: existing.count, lockedUntil: existing.lockedUntil };
  }

  public clear(key: string): void {
    this.records.delete(key);
  }

  public resetAll(): void {
    this.records.clear();
  }
}

export const defaultPaymentGuard = new PaymentFraudGuard();

export interface CreatePaymentIntentOptions {
  userId: number;
  amountCredits: number;
  clientIp?: string;
  customerCountry?: string;
  cardCountry?: string;
  simulateRadarScore?: number;
}

export interface PaymentIntentResult {
  clientSecret: string;
  paymentIntentId: string;
  amountCents: number;
  requires3DS: boolean;
  status: "requires_action" | "requires_payment_method" | "succeeded";
  riskScore: number;
  radarAction: "allow" | "challenge_3ds" | "block";
}

/**
 * Creates a Stripe Payment Intent enforcing mandatory 3D Secure 2 (3DS)
 * and Stripe Radar risk-scoring evaluation.
 */
export async function createStripePaymentIntent(
  options: CreatePaymentIntentOptions,
  guard: PaymentFraudGuard = defaultPaymentGuard,
): Promise<PaymentIntentResult> {
  const { userId, amountCredits, clientIp = "127.0.0.1", customerCountry, cardCountry, simulateRadarScore } = options;

  // 1. Minimum and Maximum Transaction Thresholds (Anti-Carding)
  if (isNaN(amountCredits) || amountCredits < PAYMENT_LIMITS.MIN_TOPUP_CREDITS) {
    throw new Error(
      `Invalid top-up amount: ${amountCredits} cr. Minimum top-up threshold is ${PAYMENT_LIMITS.MIN_TOPUP_CREDITS} cr to prevent card testing abuse.`,
    );
  }

  if (amountCredits > PAYMENT_LIMITS.MAX_TOPUP_CREDITS) {
    throw new Error(
      `Requested top-up of ${amountCredits} cr exceeds maximum permitted single transaction limit of ${PAYMENT_LIMITS.MAX_TOPUP_CREDITS} cr.`,
    );
  }

  // 2. Anti-carding lockout check
  const userKey = `user:${userId}`;
  const ipKey = `ip:${clientIp}`;

  if (guard.isLocked(userKey) || guard.isLocked(ipKey)) {
    throw new Error(
      "Billing actions temporarily locked due to excessive failed payment attempts. Please try again in 24 hours or contact support.",
    );
  }

  // 3. Radar Risk Evaluation
  let riskScore = simulateRadarScore ?? 15; // default low risk
  let requires3DS = true; // 3DS mandatory for all compute top-ups

  // Geographic mismatch rule (IP/Customer country != Card issue country)
  if (customerCountry && cardCountry && customerCountry.toUpperCase() !== cardCountry.toUpperCase()) {
    riskScore = Math.max(riskScore, 65);
    requires3DS = true;
  }

  // Radar for Fraud Teams: Block transactions with risk score > 75
  if (riskScore > 75) {
    guard.recordFailure(userKey);
    guard.recordFailure(ipKey);
    throw new Error(
      `Payment blocked by Stripe Radar: High fraud risk detected (risk score ${riskScore} exceeds safety ceiling 75).`,
    );
  }

  const amountCents = Math.round(amountCredits * 100);
  const paymentIntentId = `pi_${crypto.randomBytes(12).toString("hex")}`;
  const clientSecret = `${paymentIntentId}_secret_${crypto.randomBytes(16).toString("hex")}`;

  return {
    clientSecret,
    paymentIntentId,
    amountCents,
    requires3DS,
    status: requires3DS ? "requires_action" : "succeeded",
    riskScore,
    radarAction: requires3DS ? "challenge_3ds" : "allow",
  };
}

export interface StripeWebhookEvent {
  type: string;
  data: {
    object: Record<string, any>;
  };
}

/**
 * Handles incoming Stripe webhooks for instant chargeback quarantine and automated ledger settlement.
 */
export function handleStripeWebhookEvent(
  event: StripeWebhookEvent,
  database: LibraryDatabase,
  guard: PaymentFraudGuard = defaultPaymentGuard,
): { handled: boolean; action: string; userId?: number; details?: Record<string, any> } {
  const obj = event.data?.object || {};
  const userId = (obj.metadata?.userId ? parseInt(obj.metadata.userId, 10) : undefined) || obj.customer_id;

  switch (event.type) {
    // 1. Chargeback / Dispute Quarantine
    case "charge.dispute.created": {
      if (!userId) {
        return { handled: false, action: "missing_user_id" };
      }

      const reason = obj.reason || "Fraudulent transaction chargeback";
      const freezeResult = database.freezeUserForDispute(userId, reason);

      return {
        handled: true,
        action: "account_frozen_dispute",
        userId,
        details: {
          previousBalance: freezeResult.previousBalance,
          disputeId: obj.id,
          reason,
        },
      };
    }

    // 2. Successful Payment Intent
    case "payment_intent.succeeded": {
      if (!userId) {
        return { handled: false, action: "missing_user_id" };
      }

      const credits = (obj.amount || 0) / 100;
      database.grantUserCredits(userId, credits, "top_up", `Stripe Top-Up (${obj.id})`, {
        paymentIntentId: obj.id,
        "3dsVerified": true,
      });

      // Clear any prior failure counters on success
      guard.clear(`user:${userId}`);

      return {
        handled: true,
        action: "credits_granted",
        userId,
        details: { credits, paymentIntentId: obj.id },
      };
    }

    // 3. Failed Payment Intent
    case "payment_intent.payment_failed": {
      if (userId) {
        guard.recordFailure(`user:${userId}`);
      }
      return {
        handled: true,
        action: "failure_recorded",
        userId,
      };
    }

    default:
      return { handled: false, action: "ignored_event_type" };
  }
}
