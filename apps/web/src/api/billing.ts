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

export const topUpCredits = async (
  amount: number,
  paymentMethod = "sandbox_card",
): Promise<{ success: boolean; amountAdded: number; newBalance: number }> => {
  const { data } = await api.post("/billing/topup", { amount, paymentMethod });
  return data;
};
