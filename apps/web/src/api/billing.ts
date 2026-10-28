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
  type: "initial_grant" | "job_charge" | "top_up" | "refund";
  description: string;
  metadata?: any;
  created_at: string;
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
}

export const getUserWallet = async (): Promise<UserWalletInfo> => {
  const { data } = await api.get<UserWalletInfo>("/billing/wallet");
  return data;
};

export const getUserTransactions = async (
  limit = 50,
  offset = 0,
): Promise<{ transactions: CreditTransaction[]; count: number }> => {
  const { data } = await api.get<{ transactions: CreditTransaction[]; count: number }>("/billing/transactions", {
    params: { limit, offset },
  });
  return data;
};

export const getUserBillingSummary = async (): Promise<UserBillingSummary> => {
  const { data } = await api.get<UserBillingSummary>("/billing/usage");
  return data;
};

export const createPaymentIntent = async (
  amount: number,
): Promise<{ id: string; clientSecret: string; amount: number; currency: string; status: string }> => {
  const { data } = await api.post("/billing/payment-intent", { amount });
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
): Promise<{
  success: boolean;
  sessionId: string;
  checkoutUrl: string;
  amountCredits: number;
  amountCents: number;
  automaticTax: boolean;
}> => {
  const { data } = await api.post("/billing/checkout-session", {
    amount,
    ...(orgId ? { orgId } : {}),
  });
  return data;
};

export const getInvoiceDownloadUrl = (txId: number | string): string => {
  return `/api/v1/billing/invoices/${encodeURIComponent(String(txId))}`;
};

export const getOrgWallet = async (
  orgId: number,
): Promise<{
  orgId: number;
  name: string;
  slug: string;
  balance: number;
  totalSpent: number;
  transactions: CreditTransaction[];
}> => {
  const { data } = await api.get(`/billing/orgs/${orgId}/wallet`);
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
