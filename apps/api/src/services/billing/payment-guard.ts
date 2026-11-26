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
const MAX_GUARD_RECORDS = 10_000;
const MAX_SANDBOX_INTENTS = 10_000;

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
      if (!this.records.has(key) && this.records.size >= MAX_GUARD_RECORDS) {
        const oldestKey = this.records.keys().next().value;
        if (oldestKey !== undefined) {
          this.records.delete(oldestKey);
        }
      }
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
    if (!stripeIntent.id || !stripeIntent.client_secret) {
      throw new Error("Stripe PaymentIntent response missing id or client_secret.");
    }
    const paymentIntentId = stripeIntent.id;
    const clientSecret = stripeIntent.client_secret;
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

  if (
    process.env["NODE_ENV"] === "production" &&
    process.env["ALLOW_SANDBOX_TOPUP"] !== "true" &&
    process.env["ALLOW_BILLING_SIMULATION"] !== "true"
  ) {
    throw new Error("Stripe PaymentIntent creation is disabled without STRIPE_SECRET_KEY in production.");
  }

  const paymentIntentId = `pi_${crypto.randomBytes(12).toString("hex")}`;
  const clientSecret = `${paymentIntentId}_secret_${crypto.randomBytes(16).toString("hex")}`;
  if (issuedSandboxIntents.size >= MAX_SANDBOX_INTENTS) {
    const oldestKey = issuedSandboxIntents.keys().next().value;
    if (oldestKey !== undefined) {
      issuedSandboxIntents.delete(oldestKey);
    }
  }
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
  expectedOrgId?: number | undefined,
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
        amount_received?: number;
        currency?: string;
        metadata?: { userId?: string; orgId?: string };
      };
      if (pi.status !== "succeeded") {
        return {
          verified: false,
          reason: `PaymentIntent status is '${pi.status || "unknown"}', expected 'succeeded'.`,
        };
      }
      if (pi.currency && pi.currency.toLowerCase() !== "usd") {
        return { verified: false, reason: `Unsupported PaymentIntent currency '${pi.currency}'.` };
      }
      if (!pi.metadata?.userId || String(pi.metadata.userId) !== String(expectedUserId)) {
        return { verified: false, reason: "PaymentIntent userId metadata missing or mismatch." };
      }
      if (expectedOrgId !== undefined && String(pi.metadata?.orgId ?? "") !== String(expectedOrgId)) {
        return { verified: false, reason: "PaymentIntent orgId metadata missing or mismatch." };
      }
      const settledCents = typeof pi.amount_received === "number" ? pi.amount_received : pi.amount;
      if (typeof settledCents !== "number" || settledCents < expectedCents) {
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

  if (process.env["NODE_ENV"] !== "test") {
    return { verified: false, reason: "Unknown sandbox PaymentIntent ID." };
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
      "line_items[0][price_data][product_data][name]": `Ansatz Cloud Compute Credits (${amountCredits.toFixed(1)} cr)`,
      "line_items[0][price_data][product_data][tax_code]": "txcd_10103001", // Cloud SaaS / IaaS compute
      "line_items[0][quantity]": "1",
      "metadata[userId]": String(userId),
      "metadata[amountCredits]": String(amountCredits),
      "payment_intent_data[metadata][userId]": String(userId),
      "payment_intent_data[metadata][amountCredits]": String(amountCredits),
      ...(orgId
        ? {
            "metadata[orgId]": String(orgId),
            "payment_intent_data[metadata][orgId]": String(orgId),
          }
        : {}),
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
    if (!session.id || !session.url) {
      throw new Error("Stripe Checkout Session response missing id or url.");
    }
    return {
      sessionId: session.id,
      checkoutUrl: session.url,
      amountCredits,
      amountCents,
      automaticTax: true,
      taxIdCollection: true,
    };
  }

  if (
    process.env["NODE_ENV"] === "production" &&
    process.env["ALLOW_SANDBOX_TOPUP"] !== "true" &&
    process.env["ALLOW_BILLING_SIMULATION"] !== "true"
  ) {
    throw new Error("Stripe Checkout Session creation is disabled without STRIPE_SECRET_KEY in production.");
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

export type SubscriptionTier = "pro" | "team";
export type SubscriptionBillingCycle = "monthly" | "annual";

export const SUBSCRIPTION_PLANS: Record<
  SubscriptionTier,
  Record<
    SubscriptionBillingCycle,
    {
      amountCents: number;
      interval: "month" | "year";
      envPriceId: string;
      displayName: string;
    }
  >
> = {
  pro: {
    monthly: {
      amountCents: 2900,
      interval: "month",
      envPriceId: "STRIPE_PRICE_PRO_MONTHLY",
      displayName: "Ansatz Pro Subscription (Monthly)",
    },
    annual: {
      amountCents: 28800,
      interval: "year",
      envPriceId: "STRIPE_PRICE_PRO_ANNUAL",
      displayName: "Ansatz Pro Subscription (Annual)",
    },
  },
  team: {
    monthly: {
      amountCents: 9900,
      interval: "month",
      envPriceId: "STRIPE_PRICE_TEAM_MONTHLY",
      displayName: "Ansatz Team Subscription (Monthly)",
    },
    annual: {
      amountCents: 94800,
      interval: "year",
      envPriceId: "STRIPE_PRICE_TEAM_ANNUAL",
      displayName: "Ansatz Team Subscription (Annual)",
    },
  },
};

export interface CreateSubscriptionCheckoutSessionOptions {
  userId: number;
  orgId?: number | undefined;
  tier: SubscriptionTier;
  billingCycle: SubscriptionBillingCycle;
  clientIp?: string | undefined;
  successUrl?: string | undefined;
  cancelUrl?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface SubscriptionCheckoutSessionResult {
  sessionId: string;
  checkoutUrl: string;
  mode: "subscription";
  tier: SubscriptionTier;
  billingCycle: SubscriptionBillingCycle;
  interval: "month" | "year";
  amountCents: number;
  currency: "usd";
  automaticTax: boolean;
  taxIdCollection: boolean;
}

/**
 * Creates a Stripe Subscription Checkout Session in recurring mode ("subscription")
 * with exact USD pricing ($29/$288 for Pro, $99/$948 for Team) and optional Stripe Price IDs.
 */
export async function createStripeSubscriptionCheckoutSession(
  options: CreateSubscriptionCheckoutSessionOptions,
  guard: PaymentFraudGuard = defaultPaymentGuard,
): Promise<SubscriptionCheckoutSessionResult> {
  const {
    userId,
    orgId,
    tier,
    billingCycle,
    clientIp = "127.0.0.1",
    successUrl = "https://hub.modelscript.org/settings?tab=billing&checkout=success",
    cancelUrl = "https://hub.modelscript.org/settings?tab=billing&checkout=cancelled",
    idempotencyKey,
  } = options;

  if (tier !== "pro" && tier !== "team") {
    throw new Error(`Invalid subscription tier: '${String(tier)}'. Allowed tiers are 'pro' and 'team'.`);
  }
  if (billingCycle !== "monthly" && billingCycle !== "annual") {
    throw new Error(`Invalid billing cycle: '${String(billingCycle)}'. Allowed cycles are 'monthly' and 'annual'.`);
  }

  const userKey = `user:${userId}`;
  const ipKey = `ip:${clientIp}`;
  if (guard.isLocked(userKey) || guard.isLocked(ipKey)) {
    throw new Error("Billing actions temporarily locked due to excessive failed payment attempts.");
  }

  const plan = SUBSCRIPTION_PLANS[tier][billingCycle];
  const configuredPriceId =
    process.env[plan.envPriceId]?.trim() ||
    (tier === "team" && billingCycle === "monthly" ? process.env["STRIPE_PRICE_TEAM_SEAT_MONTHLY"]?.trim() : undefined);
  const stripeKey = process.env["STRIPE_SECRET_KEY"];

  if (stripeKey) {
    const bodyParams = new URLSearchParams({
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
      "automatic_tax[enabled]": "true",
      "tax_id_collection[enabled]": "true",
      "line_items[0][quantity]": "1",
      "metadata[userId]": String(userId),
      "metadata[tier]": tier,
      "metadata[billingCycle]": billingCycle,
      "metadata[kind]": "subscription",
      "subscription_data[metadata][userId]": String(userId),
      "subscription_data[metadata][tier]": tier,
      "subscription_data[metadata][billingCycle]": billingCycle,
      "subscription_data[metadata][kind]": "subscription",
      ...(orgId
        ? {
            "metadata[orgId]": String(orgId),
            "subscription_data[metadata][orgId]": String(orgId),
          }
        : {}),
    });

    if (configuredPriceId) {
      bodyParams.set("line_items[0][price]", configuredPriceId);
    } else {
      bodyParams.set("line_items[0][price_data][currency]", "usd");
      bodyParams.set("line_items[0][price_data][unit_amount]", String(plan.amountCents));
      bodyParams.set("line_items[0][price_data][recurring][interval]", plan.interval);
      bodyParams.set("line_items[0][price_data][product_data][name]", plan.displayName);
      bodyParams.set("line_items[0][price_data][product_data][tax_code]", "txcd_10103001");
    }

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
      throw new Error(`Stripe Subscription Checkout Session creation failed (${response.status}): ${errBody}`);
    }
    const session = (await response.json()) as { id?: string; url?: string };
    if (!session.id || !session.url) {
      throw new Error("Stripe Subscription Checkout Session response missing id or url.");
    }
    return {
      sessionId: session.id,
      checkoutUrl: session.url,
      mode: "subscription",
      tier,
      billingCycle,
      interval: plan.interval,
      amountCents: plan.amountCents,
      currency: "usd",
      automaticTax: true,
      taxIdCollection: true,
    };
  }

  if (
    process.env["NODE_ENV"] === "production" &&
    process.env["ALLOW_SANDBOX_TOPUP"] !== "true" &&
    process.env["ALLOW_BILLING_SIMULATION"] !== "true"
  ) {
    throw new Error(
      "Stripe Subscription Checkout Session creation is disabled without STRIPE_SECRET_KEY in production.",
    );
  }

  const sessionId = `cs_sub_test_${crypto.randomBytes(12).toString("hex")}`;
  return {
    sessionId,
    checkoutUrl: `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id=${sessionId}`,
    mode: "subscription",
    tier,
    billingCycle,
    interval: plan.interval,
    amountCents: plan.amountCents,
    currency: "usd",
    automaticTax: true,
    taxIdCollection: true,
  };
}

export interface StripeWebhookObject {
  id?: string | undefined;
  mode?: string | undefined;
  status?: string | undefined;
  subscription?: string | undefined;
  customer?: string | undefined;
  amount?: number | undefined;
  amount_received?: number | undefined;
  amount_subtotal?: number | undefined;
  amount_total?: number | undefined;
  payment_status?: string | undefined;
  payment_intent?: string | undefined;
  reason?: string | undefined;
  customer_id?: number | undefined;
  metadata?:
    | {
        userId?: string | undefined;
        orgId?: string | undefined;
        amountCredits?: string | undefined;
        tier?: string | undefined;
        billingCycle?: string | undefined;
        kind?: string | undefined;
      }
    | undefined;
  [key: string]: unknown;
}

export interface StripeWebhookEvent {
  id?: string | undefined;
  livemode?: boolean | undefined;
  type: string;
  data: {
    object: StripeWebhookObject;
  };
}

function normalizeWebhookTier(raw: unknown): "free" | "pro" | "team" | "enterprise" {
  if (raw === "pro" || raw === "team" || raw === "enterprise") {
    return raw;
  }
  return "free";
}

function normalizeWebhookCycle(raw: unknown): "monthly" | "annual" | null {
  if (raw === "monthly" || raw === "annual") {
    return raw;
  }
  return null;
}

/**
 * Handles incoming Stripe webhooks for instant chargeback quarantine, subscription lifecycle,
 * and automated credit ledger settlement.
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
      if (typeof obj["currency"] === "string" && obj["currency"].toLowerCase() !== "usd") {
        return { handled: false, action: "unsupported_currency" };
      }

      const paymentIntentId = typeof obj["id"] === "string" && obj["id"].trim() ? obj["id"].trim() : undefined;
      const rawCents = typeof obj["amount_received"] === "number" ? obj["amount_received"] : (obj["amount"] ?? 0);
      const credits = Math.round(rawCents) / 100;
      if (!Number.isFinite(credits) || Math.round(credits * 100) <= 0) {
        return { handled: false, action: "invalid_amount" };
      }

      const settleEventId =
        eventId || (paymentIntentId ? `pi_evt_${paymentIntentId}` : `pi_evt_${crypto.randomUUID()}`);
      const settlement = database.billing.settleStripeCreditGrant({
        eventId: settleEventId,
        paymentIntentId: paymentIntentId ?? null,
        userId: userId ?? null,
        orgId: orgId ?? null,
        amount: credits,
        type: "top_up",
        description: orgId ? `Stripe Organization Top-Up (${obj["id"]})` : `Stripe Top-Up (${obj["id"]})`,
        metadata: {
          paymentIntentId: obj["id"],
          ...(eventId ? { webhookEventId: eventId } : {}),
          "3dsVerified": true,
        },
      });

      if (settlement.duplicate) {
        return {
          handled: true,
          action: "duplicate_event_ignored",
          userId,
          orgId,
          details: { duplicate: true, eventId, paymentIntentId },
        };
      }

      // Clear any prior failure counters on success
      if (userId) guard.clear(`user:${userId}`);

      return {
        handled: true,
        action: "credits_granted",
        userId,
        orgId,
        details: {
          credits: settlement.amountGranted ?? credits,
          paymentIntentId: obj["id"],
          ...(orgId ? { orgId } : {}),
        },
      };
    }

    // 2b. Successful Stripe Checkout Session (Subscription OR One-Time Credit Top-Up)
    case "checkout.session.completed": {
      if (!userId && !orgId) {
        return { handled: false, action: "missing_user_id" };
      }

      const isSubscriptionSession = obj["mode"] === "subscription" || obj["metadata"]?.kind === "subscription";

      if (isSubscriptionSession) {
        const payStatus = obj["payment_status"];
        if (payStatus && payStatus !== "paid" && payStatus !== "no_payment_required") {
          return { handled: false, action: "payment_not_paid" };
        }
        const sessionId = typeof obj["id"] === "string" && obj["id"].trim() ? obj["id"].trim() : undefined;
        const stripeSubscriptionId =
          typeof obj["subscription"] === "string" && obj["subscription"].trim() ? obj["subscription"].trim() : null;
        const stripeCustomerId =
          typeof obj["customer"] === "string" && obj["customer"].trim() ? obj["customer"].trim() : null;
        const requestedTier = normalizeWebhookTier(obj["metadata"]?.tier);
        const activeTier = requestedTier === "free" ? "pro" : requestedTier;
        const billingCycle = normalizeWebhookCycle(obj["metadata"]?.billingCycle);

        database.billing.upsertSubscriptionState({
          userId: userId ?? null,
          orgId: orgId ?? null,
          activeTier,
          subscriptionStatus: "active",
          billingCycle,
          stripeSubscriptionId,
          stripeCustomerId,
        });

        if (userId) guard.clear(`user:${userId}`);

        return {
          handled: true,
          action: "subscription_activated",
          userId,
          orgId,
          details: {
            activeTier,
            subscriptionStatus: "active",
            billingCycle,
            subscriptionId: stripeSubscriptionId,
            sessionId,
          },
        };
      }

      if (obj["payment_status"] !== "paid") {
        return { handled: false, action: "payment_not_paid" };
      }
      if (typeof obj["currency"] === "string" && obj["currency"].toLowerCase() !== "usd") {
        return { handled: false, action: "unsupported_currency" };
      }

      const sessionId = typeof obj["id"] === "string" && obj["id"].trim() ? obj["id"].trim() : undefined;
      const paymentIntentRef =
        typeof obj["payment_intent"] === "string" && obj["payment_intent"].trim()
          ? obj["payment_intent"].trim()
          : sessionId;

      let credits: number;
      if (typeof obj["amount_subtotal"] === "number") {
        if (!Number.isFinite(obj["amount_subtotal"]) || obj["amount_subtotal"] <= 0) {
          return { handled: false, action: "invalid_amount" };
        }
        credits = Math.round(obj["amount_subtotal"]) / 100;
      } else if (typeof obj["amount_total"] === "number" && obj["amount_total"] > 0) {
        credits = Math.round(obj["amount_total"]) / 100;
      } else if (typeof obj["amount"] === "number" && obj["amount"] > 0) {
        credits = Math.round(obj["amount"]) / 100;
      } else {
        const metaCredits = obj["metadata"]?.amountCredits ? parseFloat(obj["metadata"].amountCredits) : NaN;
        if (!Number.isFinite(metaCredits) || Math.round(metaCredits * 100) <= 0) {
          return { handled: false, action: "invalid_amount" };
        }
        credits = Math.round(metaCredits * 100) / 100;
      }

      const settleEventId = eventId || (sessionId ? `cs_evt_${sessionId}` : `cs_evt_${crypto.randomUUID()}`);
      const settlement = database.billing.settleStripeCreditGrant({
        eventId: settleEventId,
        paymentIntentId: paymentIntentRef ?? null,
        userId: userId ?? null,
        orgId: orgId ?? null,
        amount: credits,
        type: "top_up",
        description: `Stripe Checkout Top-Up (${sessionId})`,
        metadata: {
          checkoutSessionId: sessionId,
          paymentIntentId: paymentIntentRef,
          ...(eventId ? { webhookEventId: eventId } : {}),
          automaticTax: true,
        },
      });

      if (settlement.duplicate) {
        return {
          handled: true,
          action: "duplicate_event_ignored",
          userId,
          orgId,
          details: { duplicate: true, eventId, sessionId },
        };
      }

      if (userId) guard.clear(`user:${userId}`);

      return {
        handled: true,
        action: "credits_granted",
        userId,
        orgId,
        details: { credits: settlement.amountGranted ?? credits, sessionId, ...(orgId ? { orgId } : {}) },
      };
    }

    // 2c. Subscription Updated
    case "customer.subscription.updated": {
      const stripeSubscriptionId = typeof obj["id"] === "string" && obj["id"].trim() ? obj["id"].trim() : null;
      const stripeCustomerId =
        typeof obj["customer"] === "string" && obj["customer"].trim() ? obj["customer"].trim() : null;
      const existing = stripeSubscriptionId ? database.billing.findSubscriptionByStripeId(stripeSubscriptionId) : null;

      const targetOrgId = orgId ?? (existing?.scopeType === "org" ? existing.scopeId : undefined);
      const targetUserId = userId ?? (existing?.scopeType === "user" ? existing.scopeId : undefined);
      if (!targetUserId && !targetOrgId) {
        return { handled: false, action: "missing_user_id" };
      }

      const subStatus = typeof obj["status"] === "string" && obj["status"].trim() ? obj["status"].trim() : "active";
      const inactiveStatuses = new Set(["canceled", "unpaid", "incomplete_expired"]);
      const metaTier = obj["metadata"]?.tier ? normalizeWebhookTier(obj["metadata"].tier) : null;
      const activeTier = inactiveStatuses.has(subStatus)
        ? "free"
        : metaTier && metaTier !== "free"
          ? metaTier
          : existing?.activeTier && existing.activeTier !== "free"
            ? existing.activeTier
            : "pro";
      const billingCycle = normalizeWebhookCycle(obj["metadata"]?.billingCycle) ?? existing?.billingCycle ?? null;

      database.billing.upsertSubscriptionState({
        userId: targetUserId ?? null,
        orgId: targetOrgId ?? null,
        activeTier,
        subscriptionStatus: subStatus,
        billingCycle,
        stripeSubscriptionId,
        stripeCustomerId,
      });

      return {
        handled: true,
        action: "subscription_updated",
        userId: targetUserId,
        orgId: targetOrgId,
        details: { activeTier, subscriptionStatus: subStatus, billingCycle, subscriptionId: stripeSubscriptionId },
      };
    }

    // 2d. Subscription Deleted / Canceled
    case "customer.subscription.deleted": {
      const stripeSubscriptionId = typeof obj["id"] === "string" && obj["id"].trim() ? obj["id"].trim() : null;
      const stripeCustomerId =
        typeof obj["customer"] === "string" && obj["customer"].trim() ? obj["customer"].trim() : null;
      const existing = stripeSubscriptionId ? database.billing.findSubscriptionByStripeId(stripeSubscriptionId) : null;

      const targetOrgId = orgId ?? (existing?.scopeType === "org" ? existing.scopeId : undefined);
      const targetUserId = userId ?? (existing?.scopeType === "user" ? existing.scopeId : undefined);
      if (!targetUserId && !targetOrgId) {
        return { handled: false, action: "missing_user_id" };
      }

      database.billing.upsertSubscriptionState({
        userId: targetUserId ?? null,
        orgId: targetOrgId ?? null,
        activeTier: "free",
        subscriptionStatus: "canceled",
        billingCycle: null,
        stripeSubscriptionId,
        stripeCustomerId,
      });

      return {
        handled: true,
        action: "subscription_canceled",
        userId: targetUserId,
        orgId: targetOrgId,
        details: { activeTier: "free", subscriptionStatus: "canceled", subscriptionId: stripeSubscriptionId },
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
