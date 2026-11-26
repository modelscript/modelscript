// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from "./client";

export interface UserWalletInfo {
  userId: number;
  creditBalance: number;
  totalSpent: number;
  totalJobs: number;
  totalCpuSeconds: number;
  totalGpuSeconds: number;
}

export interface CreditTransaction {
  id: number;
  user_id: number;
  job_id: number | null;
  amount: number;
  balance_after: number;
  type:
    | "initial_grant"
    | "job_charge"
    | "top_up"
    | "refund"
    | "escrow_hold"
    | "escrow_refund"
    | "escrow_overage"
    | "escrow_release"
    | "dispute_freeze"
    | "org_top_up"
    | "org_job_charge"
    | "org_escrow_hold"
    | "org_escrow_refund"
    | "org_escrow_overage"
    | "org_escrow_release";
  description: string;
  metadata?: Record<string, unknown> | string | null | undefined;
  created_at: string;
}

export type BillingTier = "free" | "pro" | "team" | "enterprise";
export type SubscriptionTier = "pro" | "team";
export type BillingCycle = "monthly" | "annual";

export interface ComputeProfileInfo {
  id: string;
  name: string;
  description?: string | undefined;
  partition?: string | undefined;
  cpus: number;
  memoryMb: number;
  gpus?: number | undefined;
  gpuType?: string | undefined;
  tasksPerNode?: number | undefined;
  nodes?: number | undefined;
  costCreditsPerHour: number;
  maxWallClockMinutes?: number | undefined;
}

export interface PaymentIntentResult {
  success: boolean;
  clientSecret: string;
  paymentIntentId: string;
  amountCents: number;
  currency?: string | undefined;
  sandbox?: boolean | undefined;
  id?: string | undefined;
  requires3DS?: boolean | undefined;
  status?: string | undefined;
  riskScore?: number | null | undefined;
  radarAction?: string | null | undefined;
}

export interface CreateCheckoutSessionOptions {
  idempotencyKey?: string | undefined;
  successUrl?: string | undefined;
  cancelUrl?: string | undefined;
}

export interface SubscriptionCheckoutSessionResponse {
  success: boolean;
  sessionId: string;
  checkoutUrl: string;
  mode: "subscription";
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
  interval: "month" | "year";
  amountCents: number;
  currency: "usd";
  automaticTax: boolean;
  taxIdCollection?: boolean | undefined;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ms-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface UserBillingSummary {
  userId: number;
  creditBalance: number;
  totalSpent: number;
  totalJobs: number;
  totalCpuSeconds: number;
  totalGpuSeconds: number;
  profileUsage: Record<string, { jobsCount: number; costCredits: number; cpuSeconds: number }>;
  recentTransactions: CreditTransaction[];
  activeTier?: BillingTier | undefined;
  subscriptionStatus?: string | undefined;
  billingCycle?: BillingCycle | null | undefined;
  profiles?: ComputeProfileInfo[] | undefined;
}

export const getUserWallet = async (): Promise<UserWalletInfo> => {
  const { data } = await api.get<UserWalletInfo>("/billing/wallet");
  return data;
};

export const getUserTransactions = async (
  limit = 50,
  offset = 0,
  signal?: AbortSignal,
): Promise<{ transactions: CreditTransaction[]; count: number; total: number; limit: number; offset: number }> => {
  const { data } = await api.get<{
    transactions: CreditTransaction[];
    count: number;
    total: number;
    limit: number;
    offset: number;
  }>("/billing/transactions", {
    params: { limit, offset },
    ...(signal ? { signal } : {}),
  });
  return data;
};

export const getUserBillingSummary = async (signal?: AbortSignal): Promise<UserBillingSummary> => {
  const { data } = await api.get<UserBillingSummary>("/billing/summary", {
    ...(signal ? { signal } : {}),
  });
  return data;
};

export const createPaymentIntent = async (amount: number, idempotencyKey?: string): Promise<PaymentIntentResult> => {
  const key = idempotencyKey || generateIdempotencyKey();
  const { data } = await api.post<PaymentIntentResult>(
    "/billing/payment-intent",
    { amount },
    { headers: { "Idempotency-Key": key } },
  );
  return data;
};

export const topUpCredits = async (
  amount: number,
  paymentMethod = "sandbox_card",
  paymentIntentId?: string,
): Promise<{ success: boolean; amountAdded: number; newBalance: number }> => {
  const { data } = await api.post("/billing/topup", {
    amount,
    paymentMethod,
    ...(paymentIntentId ? { paymentIntentId } : {}),
  });
  return data;
};

export const createCheckoutSession = async (
  amount: number,
  orgId?: number,
  options?: CreateCheckoutSessionOptions,
): Promise<{
  success: boolean;
  sessionId: string;
  checkoutUrl: string;
  amountCredits: number;
  amountCents: number;
  automaticTax: boolean;
}> => {
  const key = options?.idempotencyKey || generateIdempotencyKey();
  const { data } = await api.post(
    "/billing/checkout-session",
    {
      amount,
      ...(orgId ? { orgId } : {}),
      ...(options?.successUrl ? { successUrl: options.successUrl } : {}),
      ...(options?.cancelUrl ? { cancelUrl: options.cancelUrl } : {}),
    },
    { headers: { "Idempotency-Key": key } },
  );
  return data;
};

export const createSubscriptionCheckoutSession = async (
  tier: SubscriptionTier,
  billingCycle: BillingCycle,
  orgId?: number,
  options?: CreateCheckoutSessionOptions,
): Promise<SubscriptionCheckoutSessionResponse> => {
  const key = options?.idempotencyKey || generateIdempotencyKey();
  const { data } = await api.post<SubscriptionCheckoutSessionResponse>(
    "/billing/subscriptions/checkout",
    {
      tier,
      billingCycle,
      ...(orgId ? { orgId } : {}),
      ...(options?.successUrl ? { successUrl: options.successUrl } : {}),
      ...(options?.cancelUrl ? { cancelUrl: options.cancelUrl } : {}),
    },
    { headers: { "Idempotency-Key": key } },
  );
  return data;
};

export const getInvoiceDownloadUrl = (txId: number | string): string => {
  return `/api/v1/billing/invoices/${encodeURIComponent(String(txId))}`;
};

export const fetchInvoiceHtml = async (txId: number | string): Promise<string> => {
  const { data } = await api.get<string>(`/billing/invoices/${encodeURIComponent(String(txId))}`, {
    responseType: "text",
    headers: { Accept: "text/html,application/xhtml+xml,*/*" },
  });
  return typeof data === "string" ? data : String(data);
};

export const downloadBillingInvoice = async (txId: number | string): Promise<Blob> => {
  const { data } = await api.get<Blob>(`/billing/invoices/${encodeURIComponent(String(txId))}`, {
    responseType: "blob",
    headers: { Accept: "text/html,application/xhtml+xml,*/*" },
  });
  return data instanceof Blob ? data : new Blob([data], { type: "text/html;charset=utf-8" });
};

export const getOrgWallet = async (
  orgId: number,
  signal?: AbortSignal,
): Promise<{
  orgId: number;
  name: string;
  slug: string;
  balance: number;
  totalSpent: number;
  transactions: CreditTransaction[];
  activeTier?: BillingTier | undefined;
  subscriptionStatus?: string | undefined;
  billingCycle?: BillingCycle | null | undefined;
  profiles?: ComputeProfileInfo[] | undefined;
}> => {
  const { data } = await api.get(`/billing/orgs/${orgId}/summary`, {
    ...(signal ? { signal } : {}),
  });
  return data;
};

export const topUpOrgCredits = async (
  orgId: number,
  amount: number,
  paymentIntentId?: string,
): Promise<{ success: boolean; orgId: number; amountAdded: number; newBalance: number }> => {
  const { data } = await api.post(`/billing/orgs/${orgId}/topup`, {
    amount,
    ...(paymentIntentId ? { paymentIntentId } : {}),
  });
  return data;
};
