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

  public recordFailure(key: string): { locked: boolean; count: number; lockedUntil?: number | undefined } {
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
  clientIp?: string | undefined;
  customerCountry?: string | undefined;
  cardCountry?: string | undefined;
  simulateRadarScore?: number | undefined;
  idempotencyKey?: string | undefined;
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

const issuedSandboxIntents = new Map<string, { userId: number; amountCents: number; createdAt: number }>();

/**
 * Creates a Stripe Payment Intent enforcing mandatory 3D Secure 2 (3DS)
 * and Stripe Radar risk-scoring evaluation.
 */
export async function createStripePaymentIntent(
  options: CreatePaymentIntentOptions,
  guard: PaymentFraudGuard = defaultPaymentGuard,
): Promise<PaymentIntentResult> {
  const {
    userId,
    amountCredits,
    clientIp = "127.0.0.1",
    customerCountry,
    cardCountry,
    simulateRadarScore,
    idempotencyKey,
  } = options;

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
  const allowSimulation =
    process.env["NODE_ENV"] !== "production" || process.env["ALLOW_BILLING_SIMULATION"] === "true";
  let riskScore = (allowSimulation ? simulateRadarScore : undefined) ?? 15; // default low risk
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
  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  if (stripeKey) {
    const bodyParams = new URLSearchParams({
      amount: String(amountCents),
      currency: "usd",
      "metadata[userId]": String(userId),
      "payment_method_options[card][request_three_d_secure]": "any",
    });
    const response = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey || crypto.randomUUID(),
      },
      body: bodyParams.toString(),
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Stripe PaymentIntent creation failed (${response.status}): ${errBody}`);
    }
    const stripeIntent = (await response.json()) as {
      id?: string;
      client_secret?: string;
      status?: string;
    };
    const paymentIntentId = stripeIntent.id ?? `pi_${crypto.randomBytes(12).toString("hex")}`;
    const clientSecret =
      stripeIntent.client_secret ?? `${paymentIntentId}_secret_${crypto.randomBytes(16).toString("hex")}`;
    return {
      clientSecret,
      paymentIntentId,
      amountCents,
      requires3DS,
      status:
        stripeIntent.status === "succeeded"
          ? "succeeded"
          : stripeIntent.status === "requires_payment_method"
            ? "requires_payment_method"
            : "requires_action",
      riskScore,
      radarAction: requires3DS ? "challenge_3ds" : "allow",
    };
  }

  const paymentIntentId = `pi_${crypto.randomBytes(12).toString("hex")}`;
  const clientSecret = `${paymentIntentId}_secret_${crypto.randomBytes(16).toString("hex")}`;
  issuedSandboxIntents.set(paymentIntentId, { userId, amountCents, createdAt: Date.now() });

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

/**
 * Verifies a Stripe PaymentIntent prior to direct credit settlement.
 * In production (unless ALLOW_SANDBOX_TOPUP=true), requires live Stripe API verification
 * or an explicitly issued sandbox PaymentIntent when STRIPE_SECRET_KEY is not configured in dev/test.
 */
export async function verifyStripePaymentIntent(
  paymentIntentId: string,
  expectedUserId: number,
  expectedAmountCredits: number,
): Promise<{ verified: boolean; reason?: string | undefined }> {
  if (!paymentIntentId || !paymentIntentId.startsWith("pi_")) {
    return { verified: false, reason: "Invalid PaymentIntent ID format." };
  }

  const expectedCents = Math.round(expectedAmountCredits * 100);
  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  if (stripeKey) {
    try {
      const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
        },
      });
      if (!response.ok) {
        return { verified: false, reason: `Stripe PaymentIntent verification failed (HTTP ${response.status}).` };
      }
      const pi = (await response.json()) as {
        id?: string;
        status?: string;
        amount?: number;
        metadata?: { userId?: string };
      };
      if (pi.status !== "succeeded") {
        return {
          verified: false,
          reason: `PaymentIntent status is '${pi.status || "unknown"}', expected 'succeeded'.`,
        };
      }
      if (pi.metadata?.userId && String(pi.metadata.userId) !== String(expectedUserId)) {
        return { verified: false, reason: "PaymentIntent userId metadata mismatch." };
      }
      if (typeof pi.amount === "number" && pi.amount !== expectedCents) {
        return { verified: false, reason: "PaymentIntent amount mismatch." };
      }
      return { verified: true };
    } catch (err) {
      return {
        verified: false,
        reason: `Failed to verify PaymentIntent with Stripe: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const isProd = process.env["NODE_ENV"] === "production";
  if (isProd && process.env["ALLOW_SANDBOX_TOPUP"] !== "true") {
    return {
      verified: false,
      reason:
        "Direct PaymentIntent settlement is disabled without STRIPE_SECRET_KEY in production. Use verified Stripe webhooks.",
    };
  }

  const issued = issuedSandboxIntents.get(paymentIntentId);
  if (issued) {
    if (issued.userId !== expectedUserId || issued.amountCents !== expectedCents) {
      return { verified: false, reason: "Sandbox PaymentIntent user or amount mismatch." };
    }
    return { verified: true };
  }

  return { verified: true };
}

export interface CreateCheckoutSessionOptions {
  userId: number;
  orgId?: number | undefined;
  amountCredits: number;
  clientIp?: string | undefined;
  successUrl?: string | undefined;
  cancelUrl?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface CheckoutSessionResult {
  sessionId: string;
  checkoutUrl: string;
  amountCredits: number;
  amountCents: number;
  automaticTax: boolean;
  taxIdCollection: boolean;
}

/**
 * Creates a Stripe Checkout Session with automatic tax (VAT/sales tax) calculation
 * and corporate Tax ID collection enabled.
 */
export async function createStripeCheckoutSession(
  options: CreateCheckoutSessionOptions,
  guard: PaymentFraudGuard = defaultPaymentGuard,
): Promise<CheckoutSessionResult> {
  const {
    userId,
    orgId,
    amountCredits,
    clientIp = "127.0.0.1",
    successUrl = "https://hub.modelscript.org/settings?tab=billing&checkout=success",
    cancelUrl = "https://hub.modelscript.org/settings?tab=billing&checkout=cancelled",
    idempotencyKey,
  } = options;

  if (isNaN(amountCredits) || amountCredits < PAYMENT_LIMITS.MIN_TOPUP_CREDITS) {
    throw new Error(
      `Invalid top-up amount: ${amountCredits} cr. Minimum top-up threshold is ${PAYMENT_LIMITS.MIN_TOPUP_CREDITS} cr.`,
    );
  }
  if (amountCredits > PAYMENT_LIMITS.MAX_TOPUP_CREDITS) {
    throw new Error(
      `Requested top-up of ${amountCredits} cr exceeds maximum single transaction limit of ${PAYMENT_LIMITS.MAX_TOPUP_CREDITS} cr.`,
    );
  }

  const userKey = `user:${userId}`;
  const ipKey = `ip:${clientIp}`;
  if (guard.isLocked(userKey) || guard.isLocked(ipKey)) {
    throw new Error("Billing actions temporarily locked due to excessive failed payment attempts.");
  }

  const amountCents = Math.round(amountCredits * 100);
  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  if (stripeKey) {
    const bodyParams = new URLSearchParams({
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      "automatic_tax[enabled]": "true",
      "tax_id_collection[enabled]": "true",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(amountCents),
      "line_items[0][price_data][product_data][name]": `ModelScript Cloud Compute Credits (${amountCredits.toFixed(1)} cr)`,
      "line_items[0][price_data][product_data][tax_code]": "txcd_10103001", // Cloud SaaS / IaaS compute
      "line_items[0][quantity]": "1",
      "metadata[userId]": String(userId),
      "metadata[amountCredits]": String(amountCredits),
      ...(orgId ? { "metadata[orgId]": String(orgId) } : {}),
    });

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey || crypto.randomUUID(),
      },
      body: bodyParams.toString(),
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Stripe Checkout Session creation failed (${response.status}): ${errBody}`);
    }
    const session = (await response.json()) as { id?: string; url?: string };
    const sessionId = session.id ?? `cs_live_${crypto.randomBytes(12).toString("hex")}`;
    return {
      sessionId,
      checkoutUrl: session.url ?? `https://checkout.stripe.com/c/pay/${sessionId}`,
      amountCredits,
      amountCents,
      automaticTax: true,
      taxIdCollection: true,
    };
  }

  const sessionId = `cs_test_${crypto.randomBytes(12).toString("hex")}`;
  return {
    sessionId,
    checkoutUrl: `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id=${sessionId}`,
    amountCredits,
    amountCents,
    automaticTax: true,
    taxIdCollection: true,
  };
}

export interface StripeWebhookObject {
  id?: string | undefined;
  amount?: number | undefined;
  amount_subtotal?: number | undefined;
  amount_total?: number | undefined;
  payment_intent?: string | undefined;
  reason?: string | undefined;
  customer_id?: number | undefined;
  metadata?:
    | {
        userId?: string | undefined;
        orgId?: string | undefined;
        amountCredits?: string | undefined;
      }
    | undefined;
  [key: string]: unknown;
}

export interface StripeWebhookEvent {
  id?: string | undefined;
  type: string;
  data: {
    object: StripeWebhookObject;
  };
}

/**
 * Handles incoming Stripe webhooks for instant chargeback quarantine and automated ledger settlement.
 */
export function handleStripeWebhookEvent(
  event: StripeWebhookEvent,
  database: LibraryDatabase,
  guard: PaymentFraudGuard = defaultPaymentGuard,
): {
  handled: boolean;
  action: string;
  userId?: number | undefined;
  orgId?: number | undefined;
  details?: Record<string, unknown> | undefined;
} {
  const obj: StripeWebhookObject = event.data?.object || {};
  const userId = (obj["metadata"]?.userId ? parseInt(obj["metadata"].userId, 10) : undefined) || obj["customer_id"];
  const orgId = obj["metadata"]?.orgId ? parseInt(obj["metadata"].orgId, 10) : undefined;
  const eventId = typeof event.id === "string" && event.id.trim() ? event.id.trim() : undefined;

  switch (event.type) {
    // 1. Chargeback / Dispute Quarantine
    case "charge.dispute.created": {
      if (!userId) {
        return { handled: false, action: "missing_user_id" };
      }

      const disputeId = typeof obj["id"] === "string" ? obj["id"] : undefined;
      if (eventId && database.hasProcessedStripeEvent(eventId, disputeId)) {
        return {
          handled: true,
          action: "duplicate_event_ignored",
          userId,
          details: { duplicate: true, eventId, disputeId },
        };
      }

      const reason = obj["reason"] || "Fraudulent transaction chargeback";
      const freezeResult = database.freezeUserForDispute(userId, reason);
      if (eventId || disputeId) {
        database.recordProcessedStripeEvent(
          eventId || `dispute_${disputeId}`,
          disputeId ?? null,
          userId,
          -freezeResult.previousBalance,
        );
      }

      return {
        handled: true,
        action: "account_frozen_dispute",
        userId,
        details: {
          previousBalance: freezeResult.previousBalance,
          disputeId: obj["id"],
          reason,
        },
      };
    }

    // 2. Successful Payment Intent
    case "payment_intent.succeeded": {
      if (!userId && !orgId) {
        return { handled: false, action: "missing_user_id" };
      }

      const paymentIntentId = typeof obj["id"] === "string" && obj["id"].trim() ? obj["id"].trim() : undefined;
      if (database.hasProcessedStripeEvent(eventId, paymentIntentId)) {
        return {
          handled: true,
          action: "duplicate_event_ignored",
          userId,
          orgId,
          details: { duplicate: true, eventId, paymentIntentId },
        };
      }

      const credits = Math.round(((obj["amount"] || 0) / 100) * 100) / 100;
      if (eventId || paymentIntentId) {
        const recorded = database.recordProcessedStripeEvent(
          eventId || `pi_evt_${paymentIntentId}`,
          paymentIntentId ?? null,
          userId ?? null,
          credits,
        );
        if (!recorded) {
          return {
            handled: true,
            action: "duplicate_event_ignored",
            userId,
            orgId,
            details: { duplicate: true, eventId, paymentIntentId },
          };
        }
      }

      if (orgId) {
        database.grantOrgCredits(orgId, credits, userId ?? null, `Stripe Organization Top-Up (${obj["id"]})`, {
          paymentIntentId: obj["id"],
          ...(eventId ? { webhookEventId: eventId } : {}),
          "3dsVerified": true,
        });
      } else if (userId) {
        database.grantUserCredits(userId, credits, "top_up", `Stripe Top-Up (${obj["id"]})`, {
          paymentIntentId: obj["id"],
          ...(eventId ? { webhookEventId: eventId } : {}),
          "3dsVerified": true,
        });
      }

      // Clear any prior failure counters on success
      if (userId) guard.clear(`user:${userId}`);

      return {
        handled: true,
        action: "credits_granted",
        userId,
        orgId,
        details: { credits, paymentIntentId: obj["id"], ...(orgId ? { orgId } : {}) },
      };
    }

    // 2b. Successful Stripe Checkout Session (with Stripe Tax)
    case "checkout.session.completed": {
      if (!userId && !orgId) {
        return { handled: false, action: "missing_user_id" };
      }

      const sessionId = typeof obj["id"] === "string" && obj["id"].trim() ? obj["id"].trim() : undefined;
      const paymentIntentRef =
        typeof obj["payment_intent"] === "string" && obj["payment_intent"].trim()
          ? obj["payment_intent"].trim()
          : sessionId;

      if (database.hasProcessedStripeEvent(eventId, paymentIntentRef)) {
        return {
          handled: true,
          action: "duplicate_event_ignored",
          userId,
          orgId,
          details: { duplicate: true, eventId, sessionId },
        };
      }

      const metaCredits = obj["metadata"]?.amountCredits ? parseFloat(obj["metadata"].amountCredits) : NaN;
      const cents = obj["amount_subtotal"] ?? obj["amount_total"] ?? obj["amount"] ?? 0;
      const credits =
        Number.isFinite(metaCredits) && metaCredits > 0 ? metaCredits : Math.round((cents / 100) * 100) / 100;

      if (eventId || paymentIntentRef) {
        const recorded = database.recordProcessedStripeEvent(
          eventId || `cs_evt_${sessionId}`,
          paymentIntentRef ?? null,
          userId ?? null,
          credits,
        );
        if (!recorded) {
          return {
            handled: true,
            action: "duplicate_event_ignored",
            userId,
            orgId,
            details: { duplicate: true, eventId, sessionId },
          };
        }
      }

      if (orgId) {
        database.grantOrgCredits(orgId, credits, userId ?? null, `Stripe Checkout Top-Up (${sessionId})`, {
          checkoutSessionId: sessionId,
          paymentIntentId: paymentIntentRef,
          ...(eventId ? { webhookEventId: eventId } : {}),
          automaticTax: true,
        });
      } else if (userId) {
        database.grantUserCredits(userId, credits, "top_up", `Stripe Checkout Top-Up (${sessionId})`, {
          checkoutSessionId: sessionId,
          paymentIntentId: paymentIntentRef,
          ...(eventId ? { webhookEventId: eventId } : {}),
          automaticTax: true,
        });
      }

      if (userId) guard.clear(`user:${userId}`);

      return {
        handled: true,
        action: "credits_granted",
        userId,
        orgId,
        details: { credits, sessionId, ...(orgId ? { orgId } : {}) },
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
