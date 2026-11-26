// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  CpuIcon,
  CreditCardIcon,
  LinkExternalIcon,
  OrganizationIcon,
  PlusIcon,
  RocketIcon,
  ServerIcon,
  ShieldCheckIcon,
  SyncIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import styled from "styled-components";
import {
  createCheckoutSession,
  createSubscriptionCheckoutSession,
  downloadBillingInvoice,
  getOrgWallet,
  getUserBillingSummary,
  getUserTransactions,
  topUpCredits,
  topUpOrgCredits,
  type BillingTier,
  type ComputeProfileInfo,
  type SubscriptionTier,
  type UserBillingSummary,
} from "../../../api";
import { getMyOrganizations, type Organization } from "../../../api/organizations";
import { useAuth } from "../../../AuthContext";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { useFeatureFlags } from "../../../FeatureFlagContext";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import { getApiErrorMessage } from "../../../util/error";
import { DetailSubtitle, DetailTitle, Header } from "../settingsStyles";

const PlanHeaderCard = styled.div`
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(6, 182, 212, 0.08) 100%);
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: 12px;
  padding: 20px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 24px;
`;

const PlanBadge = styled.span<{ $variant?: "community" | "pro" }>`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 10px;
  border-radius: 12px;
  background: ${(props) =>
    props.$variant === "pro"
      ? "linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(6, 182, 212, 0.25))"
      : "rgba(16, 185, 129, 0.15)"};
  color: ${(props) => (props.$variant === "pro" ? "#c084fc" : "#34d399")};
  border: 1px solid ${(props) => (props.$variant === "pro" ? "rgba(168, 85, 247, 0.35)" : "rgba(16, 185, 129, 0.3)")};
  display: inline-flex;
  align-items: center;
  gap: 5px;
`;

const CommercialPromoCard = styled.div`
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(6, 182, 212, 0.08) 100%);
  border: 1px solid rgba(139, 92, 246, 0.25);
  border-radius: 12px;
  padding: 22px 24px;
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const CommercialPillarsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
  margin-top: 4px;
`;

const CommercialPillar = styled.div`
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.02));
  border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const TiersGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
`;

const TierCard = styled.div<{ $highlighted?: boolean }>`
  background: ${(props) =>
    props.$highlighted
      ? "linear-gradient(135deg, rgba(139, 92, 246, 0.12) 0%, rgba(6, 182, 212, 0.08) 100%)"
      : "var(--color-canvas-subtle)"};
  border: 1px solid ${(props) => (props.$highlighted ? "rgba(139, 92, 246, 0.4)" : "var(--color-border-default)")};
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 16px;
`;

const TierActionButton = styled.button<{ $primary?: boolean }>`
  width: 100%;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border: ${(props) => (props.$primary ? "none" : "1px solid var(--color-border-default)")};
  background: ${(props) =>
    props.$primary
      ? "var(--gradient-cta, linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%))"
      : "var(--color-canvas-default)"};
  color: ${(props) => (props.$primary ? "#ffffff" : "var(--color-text-primary)")};
  transition: all 0.15s ease-in-out;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.25);
  }

  &:disabled {
    opacity: 0.65;
    cursor: default;
  }
`;

const BillingWalletCard = styled.div`
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(6, 182, 212, 0.1) 100%);
  border: 1px solid rgba(139, 92, 246, 0.25);
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  margin-bottom: 24px;
`;

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
`;

const StatItem = styled.div`
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const TopUpPillButton = styled.button`
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 20px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease-in-out;

  &:hover:not(:disabled) {
    background: var(--gradient-cta);
    color: #ffffff;
    border-color: transparent;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(139, 92, 246, 0.3);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ActionLinkButton = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--gradient-cta, linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%));
  color: #ffffff !important;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 8px;
  text-decoration: none;
  transition: all 0.15s ease-in-out;
  box-shadow: 0 2px 10px rgba(139, 92, 246, 0.25);

  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 15px rgba(139, 92, 246, 0.4);
    text-decoration: none;
  }
`;

const SecondaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease-in-out;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--color-border-muted);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const InvoiceButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  padding: 0;
  color: var(--color-accent-cyan, #06b6d4);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    text-decoration: underline;
  }

  &:disabled {
    opacity: 0.55;
    cursor: wait;
  }
`;

const LedgerTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th {
    text-align: left;
    padding: 10px 12px;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border-default);
    font-weight: 600;
  }

  td {
    padding: 12px;
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-text-primary);
  }

  tr:hover td {
    background-color: var(--color-canvas-subtle);
  }
`;

const TxBadge = styled.span<{ $type: string }>`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 12px;
  background: ${(props) =>
    props.$type === "initial_grant" ||
    props.$type === "escrow_refund" ||
    props.$type === "escrow_release" ||
    props.$type === "org_escrow_refund" ||
    props.$type === "org_escrow_release" ||
    props.$type === "refund"
      ? "rgba(35, 134, 54, 0.2)"
      : props.$type === "topup" || props.$type === "top_up" || props.$type === "org_top_up"
        ? "rgba(6, 182, 212, 0.15)"
        : "rgba(218, 54, 51, 0.2)"};
  color: ${(props) =>
    props.$type === "initial_grant" ||
    props.$type === "escrow_refund" ||
    props.$type === "escrow_release" ||
    props.$type === "org_escrow_refund" ||
    props.$type === "org_escrow_release" ||
    props.$type === "refund"
      ? "var(--ms-success)"
      : props.$type === "topup" || props.$type === "top_up" || props.$type === "org_top_up"
        ? "#22d3ee"
        : "var(--ms-danger)"};
`;

export interface BillingTabProps {
  onBack: () => void;
}

type NormalizedTransaction = {
  id: string | number;
  created_at: string;
  transaction_type: string;
  description: string;
  job_id?: string | null;
  amount: number;
  balance_after: number;
};

type BillingSummaryView = UserBillingSummary & {
  activeTier: BillingTier;
  subscriptionStatus: string;
  profiles: ComputeProfileInfo[];
  wallet: {
    balance: number;
    total_spent: number;
    total_jobs_dispatched: number;
    total_cpu_core_hours: number;
    total_gpu_hours: number;
  };
  recent_transactions: NormalizedTransaction[];
};

const FALLBACK_COMPUTE_PROFILES: ComputeProfileInfo[] = [
  {
    id: "standard",
    name: "Standard Compute",
    cpus: 4,
    memoryMb: 16384,
    tasksPerNode: 1,
    nodes: 1,
    costCreditsPerHour: 10,
  },
  {
    id: "high-memory",
    name: "High Memory",
    cpus: 16,
    memoryMb: 262144,
    tasksPerNode: 1,
    nodes: 1,
    costCreditsPerHour: 35,
  },
  {
    id: "gpu-a100",
    name: "GPU Accelerated (A100)",
    cpus: 8,
    memoryMb: 65536,
    gpus: 1,
    gpuType: "a100",
    tasksPerNode: 1,
    nodes: 1,
    costCreditsPerHour: 80,
  },
  {
    id: "hpc-mpi-64",
    name: "Distributed Cluster (64 MPI Ranks)",
    cpus: 1,
    tasksPerNode: 32,
    nodes: 2,
    memoryMb: 131072,
    costCreditsPerHour: 150,
  },
  {
    id: "emt-distributed-cluster",
    name: "Distributed EMT Multi-Island Cluster",
    cpus: 1,
    tasksPerNode: 16,
    nodes: 4,
    gpus: 1,
    gpuType: "a100",
    memoryMb: 131072,
    costCreditsPerHour: 180,
  },
];

const DEFAULT_COMMUNITY_VIEW: BillingSummaryView = {
  userId: 0,
  creditBalance: 0,
  totalSpent: 0,
  totalJobs: 0,
  totalCpuSeconds: 0,
  totalGpuSeconds: 0,
  profileUsage: {},
  recentTransactions: [],
  activeTier: "free",
  subscriptionStatus: "inactive",
  profiles: [],
  wallet: {
    balance: 0,
    total_spent: 0,
    total_jobs_dispatched: 0,
    total_cpu_core_hours: 0,
    total_gpu_hours: 0,
  },
  recent_transactions: [],
};

const TX_PAGE_SIZE = 20;

function normalizeBillingTier(raw: unknown): BillingTier {
  if (raw === "pro" || raw === "team" || raw === "enterprise") {
    return raw;
  }
  return "free";
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: string };
  return e.name === "AbortError" || e.name === "CanceledError" || e.code === "ERR_CANCELED";
}

function formatProfileCores(profile: ComputeProfileInfo): string {
  const nodes = profile.nodes ?? 1;
  const tasksPerNode = profile.tasksPerNode ?? 1;
  const totalCores = Math.max(1, profile.cpus * tasksPerNode * nodes);
  if (nodes > 1 || tasksPerNode > 1) {
    return `${totalCores} Cores (${nodes}x${tasksPerNode} MPI)`;
  }
  return `${totalCores} Cores`;
}

function formatProfileMemory(memoryMb: number): string {
  const gb = memoryMb / 1024;
  return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
}

function formatProfileGpu(profile: ComputeProfileInfo): string {
  if (profile.gpus && profile.gpus > 0) {
    const label = profile.gpuType ? profile.gpuType.toUpperCase() : "GPU";
    const perNode = (profile.nodes ?? 1) > 1 ? " / node" : "";
    return `${profile.gpus}x NVIDIA ${label}${perNode}`;
  }
  if ((profile.nodes ?? 1) > 1 || profile.partition === "mpi") {
    return "InfiniBand";
  }
  return "None";
}

function normalizeTransactions(rawTxs: unknown[], fallbackBalance = 0): NormalizedTransaction[] {
  return rawTxs
    .filter((tx): tx is Record<string, unknown> => Boolean(tx && typeof tx === "object"))
    .map((tx, idx) => ({
      id: (tx["id"] as number | string | undefined) ?? idx,
      created_at: String(tx["created_at"] ?? tx["createdAt"] ?? new Date().toISOString()),
      transaction_type: String(tx["transaction_type"] ?? tx["type"] ?? "job_charge"),
      description: String(tx["description"] ?? ""),
      job_id:
        tx["job_id"] !== undefined ? String(tx["job_id"] ?? "") || null : tx["jobId"] ? String(tx["jobId"]) : null,
      amount: Number(tx["amount"] ?? 0),
      balance_after: Number(tx["balance_after"] ?? tx["balanceAfter"] ?? fallbackBalance),
    }));
}

function normalizeBillingSummary(raw: unknown): BillingSummaryView {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_COMMUNITY_VIEW;
  }
  const rawObj = raw as Record<string, unknown>;
  const wallet = rawObj["wallet"] as Record<string, unknown> | undefined;
  const balance = Number(
    wallet?.["balance"] ?? rawObj["balance"] ?? rawObj["creditBalance"] ?? rawObj["credit_balance"] ?? 0,
  );
  const totalSpent = Number(wallet?.["total_spent"] ?? rawObj["totalSpent"] ?? rawObj["total_spent"] ?? 0);
  const totalJobs = Number(wallet?.["total_jobs_dispatched"] ?? rawObj["totalJobs"] ?? rawObj["total_jobs"] ?? 0);
  const totalCpuSeconds = Number(rawObj["totalCpuSeconds"] ?? rawObj["total_cpu_seconds"] ?? 0);
  const totalGpuSeconds = Number(rawObj["totalGpuSeconds"] ?? rawObj["total_gpu_seconds"] ?? 0);
  const totalCpuCoreHours = Number(wallet?.["total_cpu_core_hours"] ?? (totalCpuSeconds ? totalCpuSeconds / 3600 : 0));
  const totalGpuHours = Number(wallet?.["total_gpu_hours"] ?? (totalGpuSeconds ? totalGpuSeconds / 3600 : 0));

  const rawTxs: unknown[] = Array.isArray(rawObj["recent_transactions"])
    ? (rawObj["recent_transactions"] as unknown[])
    : Array.isArray(rawObj["recentTransactions"])
      ? (rawObj["recentTransactions"] as unknown[])
      : Array.isArray(rawObj["transactions"])
        ? (rawObj["transactions"] as unknown[])
        : [];

  const normalizedTxs = normalizeTransactions(rawTxs, balance);
  const profiles = Array.isArray(rawObj["profiles"]) ? (rawObj["profiles"] as ComputeProfileInfo[]) : [];

  return {
    userId: Number(rawObj["userId"] ?? rawObj["user_id"] ?? 0),
    creditBalance: balance,
    totalSpent,
    totalJobs,
    totalCpuSeconds,
    totalGpuSeconds,
    profileUsage: (rawObj["profileUsage"] as BillingSummaryView["profileUsage"]) ?? {},
    recentTransactions: (rawObj["recentTransactions"] as BillingSummaryView["recentTransactions"]) ?? [],
    activeTier: normalizeBillingTier(rawObj["activeTier"] ?? rawObj["active_tier"]),
    subscriptionStatus: String(rawObj["subscriptionStatus"] ?? rawObj["subscription_status"] ?? "inactive"),
    profiles,
    wallet: {
      balance,
      total_spent: totalSpent,
      total_jobs_dispatched: totalJobs,
      total_cpu_core_hours: totalCpuCoreHours,
      total_gpu_hours: totalGpuHours,
    },
    recent_transactions: normalizedTxs,
  };
}

export const BillingTab: React.FC<BillingTabProps> = ({ onBack }) => {
  const { user, isAdmin, refreshWallet } = useAuth();
  const { isEnabled, setFlagOverride } = useFeatureFlags();
  const isStripeFeatureEnabled = isEnabled("billing_stripe_live");
  const isDev = import.meta.env.DEV;
  const canUseSandboxToggle = Boolean(isAdmin) || isDev;
  const [searchParams, setSearchParams] = useSearchParams();
  const { instanceName, brandName: brandingBrandName } = useInstanceBranding() as {
    instanceName: string;
    brandName?: string;
  };
  const brandName = brandingBrandName || instanceName || "Ansatz";

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(() => {
    if (typeof sessionStorage !== "undefined") {
      try {
        const stored = sessionStorage.getItem("ms_billing_org_id");
        if (stored) {
          const parsed = Number(stored);
          if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
      } catch {
        // ignore storage errors
      }
    }
    return null;
  });
  const [billingSummary, setBillingSummary] = useState<BillingSummaryView | null>(null);
  const [ledgerTransactions, setLedgerTransactions] = useState<NormalizedTransaction[]>([]);
  const [txTotal, setTxTotal] = useState<number>(0);
  const [isLoadingMoreTxs, setIsLoadingMoreTxs] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [sandboxToggle, setSandboxToggle] = useState<boolean>(() => (isDev ? !isStripeFeatureEnabled : false));
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">("monthly");
  const [isTopUpLoading, setIsTopUpLoading] = useState(false);
  const [isSubscriptionLoading, setIsSubscriptionLoading] = useState(false);
  const [topUpSuccess, setTopUpSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invoiceLoadingId, setInvoiceLoadingId] = useState<string | number | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<{
    variant: "confirming" | "success" | "cancelled";
    message: string;
  } | null>(null);

  const fetchSeqRef = useRef(0);
  const topUpInFlightRef = useRef(false);
  const latestSummaryRef = useRef<BillingSummaryView | null>(null);
  const latestTxCountRef = useRef<number>(0);

  useEffect(() => {
    latestSummaryRef.current = billingSummary;
  }, [billingSummary]);

  useEffect(() => {
    latestTxCountRef.current = ledgerTransactions.length;
  }, [ledgerTransactions]);

  useEffect(() => {
    if (isDev && !isStripeFeatureEnabled) {
      setSandboxToggle(true);
    }
  }, [isDev, isStripeFeatureEnabled]);

  useEffect(() => {
    let cancelled = false;
    let storedOrgId: string | null = null;
    if (typeof sessionStorage !== "undefined") {
      try {
        storedOrgId = sessionStorage.getItem("ms_billing_org_id");
      } catch {
        storedOrgId = null;
      }
    }
    if (storedOrgId) {
      const parsed = Number(storedOrgId);
      if (Number.isFinite(parsed) && parsed > 0) {
        setSelectedOrgId(parsed);
      }
    }
    getMyOrganizations()
      .then((orgs) => {
        if (!cancelled && Array.isArray(orgs)) {
          setOrganizations(orgs);
          if (storedOrgId) {
            const parsed = Number(storedOrgId);
            if (orgs.some((o) => o.id === parsed)) {
              setSelectedOrgId(parsed);
            }
          }
        }
      })
      .catch(() => {
        // Fallback when unauthenticated or no orgs
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedOrg = organizations.find((o) => o.id === selectedOrgId) ?? null;
  const isStripeLiveMode = !canUseSandboxToggle
    ? true
    : isDev
      ? Boolean(isStripeFeatureEnabled) && !sandboxToggle
      : !sandboxToggle;
  const isLocalSimulationMode = canUseSandboxToggle && !isStripeLiveMode;
  const activeTier: BillingTier = billingSummary?.activeTier || "free";
  const computeProfiles =
    billingSummary?.profiles && billingSummary.profiles.length > 0
      ? billingSummary.profiles
      : FALLBACK_COMPUTE_PROFILES;

  const fetchSummary = useCallback(
    async (
      signal?: AbortSignal,
    ): Promise<{
      summary: BillingSummaryView;
      txCount: number;
    } | null> => {
      const seq = ++fetchSeqRef.current;
      try {
        if (selectedOrgId !== null) {
          const data = await getOrgWallet(selectedOrgId, signal);
          if (signal?.aborted || seq !== fetchSeqRef.current) return null;
          const normalized = normalizeBillingSummary(data);
          setBillingSummary(normalized);
          setLedgerTransactions(normalized.recent_transactions);
          setTxTotal(normalized.recent_transactions.length);
          setSummaryError(null);
          return { summary: normalized, txCount: normalized.recent_transactions.length };
        }

        const [summaryData, txPage] = await Promise.all([
          getUserBillingSummary(signal),
          getUserTransactions(TX_PAGE_SIZE, 0, signal).catch(() => null),
        ]);
        if (signal?.aborted || seq !== fetchSeqRef.current) return null;
        const normalized = normalizeBillingSummary(summaryData);
        setBillingSummary(normalized);
        if (txPage && Array.isArray(txPage.transactions)) {
          const normalizedPage = normalizeTransactions(txPage.transactions, normalized.wallet.balance);
          setLedgerTransactions(normalizedPage);
          setTxTotal(typeof txPage.total === "number" ? txPage.total : normalizedPage.length);
          setSummaryError(null);
          return { summary: normalized, txCount: normalizedPage.length };
        }
        setLedgerTransactions(normalized.recent_transactions);
        setTxTotal(normalized.recent_transactions.length);
        setSummaryError(null);
        return { summary: normalized, txCount: normalized.recent_transactions.length };
      } catch (err: unknown) {
        if (signal?.aborted || isAbortError(err) || seq !== fetchSeqRef.current) return null;
        setSummaryError(getApiErrorMessage(err, "Failed to load billing summary. Please try again."));
        return null;
      }
    },
    [selectedOrgId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchSummary(controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchSummary]);

  // Keep BillingTab synchronized when top-ups happen from AppShell or elsewhere
  useEffect(() => {
    const handleWalletUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ source?: string } | undefined>)?.detail;
      if (detail?.source === "billing-tab") return;
      void fetchSummary();
    };
    window.addEventListener("modelscript:wallet-update", handleWalletUpdate);
    return () => {
      window.removeEventListener("modelscript:wallet-update", handleWalletUpdate);
    };
  }, [fetchSummary]);

  // Handle ?checkout=success and ?checkout=cancelled return from Stripe Checkout
  useEffect(() => {
    const checkoutParam = searchParams.get("checkout");
    if (checkoutParam !== "success" && checkoutParam !== "cancelled") {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("checkout");
    nextParams.delete("kind");
    setSearchParams(nextParams, { replace: true });

    if (checkoutParam === "cancelled") {
      setCheckoutNotice({
        variant: "cancelled",
        message: "Stripe Checkout was cancelled. No charges were made.",
      });
      return;
    }

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const baselineBalance = latestSummaryRef.current?.wallet.balance ?? null;
    const baselineTier = latestSummaryRef.current?.activeTier ?? null;
    const baselineTxCount = latestTxCountRef.current;

    setCheckoutNotice({
      variant: "confirming",
      message: "Confirming payment with Stripe...",
    });

    const poll = async (attempt: number) => {
      if (cancelled) return;
      const result = await fetchSummary();
      if (cancelled) return;

      const balanceChanged =
        result !== null && baselineBalance !== null && result.summary.wallet.balance !== baselineBalance;
      const tierChanged = result !== null && baselineTier !== null && result.summary.activeTier !== baselineTier;
      const txCountChanged = result !== null && result.txCount > baselineTxCount;

      if (balanceChanged || tierChanged || txCountChanged || attempt >= 5) {
        window.dispatchEvent(new CustomEvent("modelscript:wallet-update", { detail: { source: "billing-tab" } }));
        void refreshWallet();
        setCheckoutNotice({
          variant: "success",
          message: tierChanged
            ? `Subscription confirmed! Your active plan is now ${result.summary.activeTier.toUpperCase()}.`
            : balanceChanged || txCountChanged
              ? "Payment confirmed! Your compute credit balance has been updated."
              : "Payment received! If your account has not updated yet, please refresh in a few moments.",
        });
        return;
      }

      timerId = setTimeout(() => {
        void poll(attempt + 1);
      }, 2000);
    };

    timerId = setTimeout(() => {
      void poll(1);
    }, 2000);

    return () => {
      cancelled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, [searchParams, setSearchParams, fetchSummary, refreshWallet]);

  const toggleSandboxBilling = () => {
    if (!canUseSandboxToggle) return;
    if (isDev && !isStripeFeatureEnabled) {
      const nextStripe = !isStripeFeatureEnabled;
      setFlagOverride("billing_stripe_live", nextStripe);
      setSandboxToggle(!nextStripe);
    } else {
      setSandboxToggle((prev) => !prev);
    }
    setTopUpSuccess(null);
    setError(null);
  };

  const startStripeCheckout = async (amount: number, overrideOrgId?: number): Promise<boolean> => {
    if (topUpInFlightRef.current) return false;
    const targetOrgId = overrideOrgId !== undefined ? overrideOrgId : (selectedOrgId ?? undefined);
    topUpInFlightRef.current = true;
    setIsTopUpLoading(true);
    setError(null);
    setTopUpSuccess(null);
    try {
      const session = await createCheckoutSession(amount, targetOrgId);
      if (!session.checkoutUrl) {
        throw new Error("Stripe Checkout URL was not returned by the server.");
      }
      window.location.assign(session.checkoutUrl);
      return true;
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, "Could not start Stripe Checkout session."));
      return false;
    } finally {
      topUpInFlightRef.current = false;
      setIsTopUpLoading(false);
    }
  };

  const startSubscriptionCheckout = async (tier: SubscriptionTier): Promise<boolean> => {
    if (isSubscriptionLoading) return false;
    setIsSubscriptionLoading(true);
    setError(null);
    setTopUpSuccess(null);
    try {
      const session = await createSubscriptionCheckoutSession(tier, billingInterval, selectedOrgId ?? undefined);
      if (!session.checkoutUrl) {
        throw new Error("Stripe Subscription Checkout URL was not returned by the server.");
      }
      window.location.assign(session.checkoutUrl);
      return true;
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, "Could not start Stripe Subscription Checkout session."));
      return false;
    } finally {
      setIsSubscriptionLoading(false);
    }
  };

  const handleSandboxTopUp = async (amount: number, overrideOrgId?: number): Promise<boolean> => {
    if (!canUseSandboxToggle || !isLocalSimulationMode) return false;
    if (topUpInFlightRef.current) return false;
    const targetOrgId = overrideOrgId !== undefined ? overrideOrgId : (selectedOrgId ?? undefined);
    topUpInFlightRef.current = true;
    setIsTopUpLoading(true);
    setError(null);
    setTopUpSuccess(null);
    try {
      const updatedWallet =
        targetOrgId !== undefined
          ? await topUpOrgCredits(targetOrgId, amount)
          : await topUpCredits(amount, "sandbox_card");
      setBillingSummary((prev) => {
        if (!prev) return null;
        const uw = updatedWallet as { newBalance?: number; balance?: number } | null | undefined;
        const nextBalance =
          typeof uw?.newBalance === "number" ? uw.newBalance : (uw?.balance ?? prev.wallet.balance + amount);
        return {
          ...prev,
          creditBalance: nextBalance,
          wallet: {
            ...prev.wallet,
            balance: nextBalance,
          },
        };
      });
      await fetchSummary();
      window.dispatchEvent(new CustomEvent("modelscript:wallet-update", { detail: { source: "billing-tab" } }));
      void refreshWallet();
      const targetOrg =
        targetOrgId !== undefined ? (organizations.find((o) => o.id === targetOrgId) ?? selectedOrg) : null;
      const targetLabel = targetOrg ? `@${targetOrg.slug} organization wallet` : "your personal wallet";
      setTopUpSuccess(
        `Successfully credited +${amount.toFixed(2)} compute credits ($${amount.toFixed(2)} USD) to ${targetLabel} (Local Simulation Billing Mode).`,
      );
      return true;
    } catch (err: unknown) {
      setError(
        getApiErrorMessage(err, "Top-up request failed. Please verify your permissions or billing configuration."),
      );
      return false;
    } finally {
      topUpInFlightRef.current = false;
      setIsTopUpLoading(false);
    }
  };

  const createCreditCheckout = async (packId: string, orgId?: number): Promise<boolean> => {
    const packAmounts: Record<string, number> = {
      pack_50: 50,
      pack_200: 200,
      pack_500: 500,
    };
    const amount = packAmounts[packId] ?? (Number(packId) || 200);
    if (isStripeLiveMode) {
      return startStripeCheckout(amount, orgId);
    }
    return handleSandboxTopUp(amount, orgId);
  };

  const handleOpenInvoice = async (txId: number | string) => {
    setInvoiceLoadingId(txId);
    setError(null);
    try {
      const blob = await downloadBillingInvoice(txId);
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, "_blank", "noopener,noreferrer");
      if (!win) {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `invoice-${txId}.html`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, `Failed to load invoice #${txId}.`));
    } finally {
      setInvoiceLoadingId(null);
    }
  };

  const handleLoadMoreTransactions = async () => {
    if (selectedOrgId !== null || isLoadingMoreTxs) return;
    setIsLoadingMoreTxs(true);
    setError(null);
    try {
      const page = await getUserTransactions(TX_PAGE_SIZE, ledgerTransactions.length);
      const fallbackBal = billingSummary?.wallet.balance ?? 0;
      const nextRows = normalizeTransactions(page.transactions ?? [], fallbackBal);
      setLedgerTransactions((prev) => {
        const seen = new Set(prev.map((tx) => String(tx.id)));
        const merged = [...prev];
        for (const row of nextRows) {
          if (!seen.has(String(row.id))) {
            seen.add(String(row.id));
            merged.push(row);
          }
        }
        return merged;
      });
      if (typeof page.total === "number") {
        setTxTotal(page.total);
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, "Failed to load more transactions."));
    } finally {
      setIsLoadingMoreTxs(false);
    }
  };

  const hasMoreTransactions = selectedOrgId === null && ledgerTransactions.length < txTotal;

  return (
    <>
      <Header>
        <CircleIconButton onClick={onBack} aria-label="Back" style={{ marginRight: "8px" }}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        Billing &amp; Compute Quotas
      </Header>
      <Box px={4} pb={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
          Manage your high-performance computing quotas, pay-as-you-go compute credits ($1.00 USD = 1.00 Compute
          Credit), and metered credit ledgers across SLURM and local solver clusters.
        </DetailSubtitle>

        {/* Billing Scope Selector */}
        <Box
          mb={3}
          p={3}
          style={{
            background: "var(--color-canvas-subtle)",
            border: "1px solid var(--color-border-default)",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <Box display="flex" alignItems="center" gap={2}>
            <OrganizationIcon size={16} style={{ color: "var(--color-accent-cyan, #06b6d4)" }} />
            <div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                Billing Scope Selector
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {selectedOrg
                  ? `Managing shared compute credit ledger for ${selectedOrg.display_name || selectedOrg.name} (@${selectedOrg.slug}).`
                  : `Managing personal compute credit balance for Personal Account (@${user?.username || "me"}).`}
              </div>
            </div>
          </Box>
          <select
            aria-label="Billing Scope"
            value={selectedOrgId === null ? "personal" : String(selectedOrgId)}
            onChange={(e) => {
              const val = e.target.value;
              const nextOrgId = val === "personal" ? null : Number(val);
              setSelectedOrgId(nextOrgId);
              if (typeof sessionStorage !== "undefined") {
                try {
                  if (nextOrgId === null) {
                    sessionStorage.removeItem("ms_billing_org_id");
                  } else {
                    sessionStorage.setItem("ms_billing_org_id", String(nextOrgId));
                  }
                } catch {
                  // ignore storage errors
                }
              }
              setTopUpSuccess(null);
              setError(null);
              setSummaryError(null);
            }}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-default)",
              color: "var(--color-text-primary)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <option value="personal">Personal Account (@{user?.username || "me"})</option>
            {organizations.map((org) => (
              <option key={org.id} value={String(org.id)}>
                {org.display_name || org.name} (@{org.slug})
              </option>
            ))}
          </select>
        </Box>

        {checkoutNotice && (
          <Box
            role={checkoutNotice.variant === "cancelled" ? "alert" : "status"}
            mb={3}
            p={3}
            style={{
              background:
                checkoutNotice.variant === "success"
                  ? "var(--color-success-subtle)"
                  : checkoutNotice.variant === "cancelled"
                    ? "rgba(210, 153, 34, 0.15)"
                    : "rgba(6, 182, 212, 0.14)",
              color:
                checkoutNotice.variant === "success"
                  ? "var(--color-success-fg)"
                  : checkoutNotice.variant === "cancelled"
                    ? "#d29922"
                    : "var(--color-accent-cyan, #06b6d4)",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <Box display="flex" alignItems="center" gap={2}>
              {checkoutNotice.variant === "success" ? (
                <CheckCircleIcon size={16} />
              ) : checkoutNotice.variant === "cancelled" ? (
                <AlertIcon size={16} />
              ) : (
                <SyncIcon size={16} />
              )}
              <Text fontSize="14px">{checkoutNotice.message}</Text>
            </Box>
            {checkoutNotice.variant !== "confirming" && (
              <SecondaryButton
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={() => setCheckoutNotice(null)}
              >
                Dismiss
              </SecondaryButton>
            )}
          </Box>
        )}

        {summaryError && (
          <Box
            role="alert"
            mb={3}
            p={3}
            style={{
              background: "var(--color-danger-subtle)",
              color: "var(--color-danger-fg)",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <Box display="flex" alignItems="center" gap={2}>
              <AlertIcon size={16} />
              <Text fontSize="14px">{summaryError}</Text>
            </Box>
            <SecondaryButton style={{ padding: "4px 10px", fontSize: "12px" }} onClick={() => void fetchSummary()}>
              <SyncIcon size={12} />
              Retry
            </SecondaryButton>
          </Box>
        )}

        {error && (
          <Box
            role="alert"
            mb={3}
            p={3}
            style={{
              background: "var(--color-danger-subtle)",
              color: "var(--color-danger-fg)",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <Box display="flex" alignItems="center" gap={2}>
              <AlertIcon size={16} />
              <Text fontSize="14px">{error}</Text>
            </Box>
            <SecondaryButton style={{ padding: "4px 10px", fontSize: "12px" }} onClick={() => setError(null)}>
              Dismiss
            </SecondaryButton>
          </Box>
        )}

        {topUpSuccess && (
          <Box
            role="status"
            mb={3}
            p={3}
            style={{
              background: "var(--color-success-subtle)",
              color: "var(--color-success-fg)",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <Box display="flex" alignItems="center" gap={2}>
              <CheckCircleIcon size={16} />
              <Text fontSize="14px">{topUpSuccess}</Text>
            </Box>
            <SecondaryButton style={{ padding: "4px 10px", fontSize: "12px" }} onClick={() => setTopUpSuccess(null)}>
              Dismiss
            </SecondaryButton>
          </Box>
        )}

        {/* Plan Header Card */}
        <PlanHeaderCard>
          <Box display="flex" flexDirection="column" gap={1}>
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <Text style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                {brandName} {activeTier === "free" ? "Pay-As-You-Go Compute" : `${activeTier.toUpperCase()} Plan`}
              </Text>
              <PlanBadge $variant={isStripeLiveMode ? "pro" : "community"}>
                <ShieldCheckIcon size={12} />
                {isStripeLiveMode ? "Stripe Live Mode" : "Local Simulation Billing Mode"}
              </PlanBadge>
              {activeTier !== "free" && (
                <PlanBadge $variant="pro">
                  <RocketIcon size={12} />
                  {activeTier.toUpperCase()} Tier ({billingSummary?.subscriptionStatus || "active"})
                </PlanBadge>
              )}
            </Box>
            <Text style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.4 }}>
              {isStripeLiveMode
                ? "Connected to Stripe Checkout ($1.00 USD = 1.00 Compute Credit) for cloud Slurm cluster job dispatch, batched SUNDIALS sweeps, and GPU surrogate training."
                : `Local Simulation Billing Mode active on ${brandName} — test organization credit top-ups and ledger auditing without live card charges.`}
            </Text>
          </Box>

          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            {canUseSandboxToggle && (
              <SecondaryButton type="button" onClick={toggleSandboxBilling}>
                <SyncIcon size={13} />
                {isLocalSimulationMode ? "Sandbox Mode Active" : "Simulate Sandbox Mode"}
              </SecondaryButton>
            )}
            <SecondaryButton
              type="button"
              onClick={() => {
                document.getElementById("subscription-tiers")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <span>View Plans &amp; Pricing</span>
            </SecondaryButton>
          </Box>
        </PlanHeaderCard>

        {/* Subscription Tiers Section (#subscription-tiers) */}
        <Box id="subscription-tiers" mb={4}>
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={3}>
            <div>
              <DetailTitle style={{ fontWeight: 700, display: "block" }}>
                {brandName} Plans &amp; Subscriptions
              </DetailTitle>
              <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                Pay-as-you-go compute credits are billed at $1.00 USD = 1.00 Compute Credit. Subscribe to Pro or Team
                via Stripe Checkout for recurring priority compute access.
              </Text>
            </div>
            <Box
              display="inline-flex"
              gap={1}
              style={{
                background: "var(--color-canvas-subtle)",
                padding: 4,
                borderRadius: 8,
                border: "1px solid var(--color-border-default)",
              }}
            >
              <SecondaryButton
                type="button"
                onClick={() => setBillingInterval("monthly")}
                style={{
                  padding: "4px 12px",
                  fontSize: "12px",
                  border: "none",
                  background: billingInterval === "monthly" ? "var(--color-canvas-default)" : "transparent",
                }}
              >
                Monthly
              </SecondaryButton>
              <SecondaryButton
                type="button"
                onClick={() => setBillingInterval("annual")}
                style={{
                  padding: "4px 12px",
                  fontSize: "12px",
                  border: "none",
                  background: billingInterval === "annual" ? "var(--color-canvas-default)" : "transparent",
                }}
              >
                Annual (2 Months Free)
              </SecondaryButton>
            </Box>
          </Box>

          <TiersGrid>
            <TierCard $highlighted={activeTier === "free"}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                  Community Free + Pay-As-You-Go
                </div>
                <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-text-primary)", margin: "6px 0" }}>
                  $0{" "}
                  <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-muted)" }}>
                    / forever + $1.00/cr
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                  Unlimited in-browser WebAssembly ODE/DAE simulation, public repositories, open-source package
                  publishing, and on-demand cloud HPC credits at $1.00 USD per credit.
                </div>
              </div>
              <TierActionButton type="button" disabled>
                {activeTier === "free" ? "Active Plan" : "Included"}
              </TierActionButton>
            </TierCard>

            <TierCard $highlighted={activeTier === "pro"}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                  {brandName} Pro
                </div>
                <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-text-primary)", margin: "6px 0" }}>
                  {billingInterval === "annual" ? "$24" : "$29"}{" "}
                  <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-muted)" }}>
                    / month {billingInterval === "annual" ? "($288/yr)" : ""}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                  Priority Slurm queue dispatch, GPU surrogate model training, private repositories, and dedicated
                  engineering support.
                </div>
              </div>
              <TierActionButton
                type="button"
                $primary={activeTier !== "pro"}
                disabled={activeTier === "pro" || isSubscriptionLoading}
                onClick={() => void startSubscriptionCheckout("pro")}
              >
                {activeTier === "pro"
                  ? "Active Plan"
                  : isSubscriptionLoading
                    ? "Redirecting to Stripe..."
                    : `Subscribe to Pro (${billingInterval === "annual" ? "$288/yr" : "$29/mo"})`}
              </TierActionButton>
            </TierCard>

            <TierCard $highlighted={activeTier === "team"}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                  {brandName} Team
                </div>
                <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-text-primary)", margin: "6px 0" }}>
                  {billingInterval === "annual" ? "$79" : "$99"}{" "}
                  <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-muted)" }}>
                    / month {billingInterval === "annual" ? "($948/yr)" : ""}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                  Shared organization HPC pools, scoped private registries, RBAC governance, and MPI cluster access.
                </div>
              </div>
              <TierActionButton
                type="button"
                $primary={activeTier !== "team"}
                disabled={activeTier === "team" || isSubscriptionLoading}
                onClick={() => void startSubscriptionCheckout("team")}
              >
                {activeTier === "team"
                  ? "Active Plan"
                  : isSubscriptionLoading
                    ? "Redirecting to Stripe..."
                    : `Subscribe to Team (${billingInterval === "annual" ? "$948/yr" : "$99/mo"})`}
              </TierActionButton>
            </TierCard>
          </TiersGrid>
        </Box>

        {/* Commercial & Enterprise Info Banner */}
        <CommercialPromoCard>
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2}>
            <Box>
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "var(--color-text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <RocketIcon size={15} style={{ color: "var(--color-accent-purple, #a855f7)" }} />
                Commercial Licensing &amp; Enterprise Utility Appliances
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                Need to embed {brandName} / ModelScript without AGPL copyleft obligations, or deploy a hardened,
                air-gapped NERC CIP appliance inside your utility firewall?
              </div>
            </Box>
            <ActionLinkButton
              href="mailto:licensing@ansatz.social?subject=Ansatz%20Commercial%20License%20%2F%20Enterprise%20Inquiry&body=Hi%20Ansatz%20Team%2C%0A%0AWe%20are%20interested%20in%20evaluating%20the%20Ansatz%20%2F%20ModelScript%20Commercial%20SDK%20%2F%20Enterprise%20Appliance%20for%20our%20engineering%20team.%0A%0ACompany%2FOrganization%3A%20%0ATeam%20Size%3A%20%0APrimary%20Engineering%20Formats%20(e.g.%20Modelica%2C%20SysML%2C%20STEP)%3A%20%0A%0ABest%20regards%2C"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>Inquire About Enterprise</span>
              <LinkExternalIcon size={12} />
            </ActionLinkButton>
          </Box>

          <CommercialPillarsGrid>
            <CommercialPillar>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "var(--color-text-primary)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "6px",
                }}
              >
                <span>Commercial SDK</span>
                <a
                  href="mailto:sales@modelscript.org?subject=Commercial%20SDK%20Inquiry"
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--color-accent-purple, #a855f7)",
                    textDecoration: "underline",
                    textUnderlineOffset: "2px",
                  }}
                >
                  Contact us at sales@modelscript.org
                </a>
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.4 }}>
                Dual-license exemption from AGPL §13 network copyleft for proprietary SaaS or closed desktop software,
                with private Slack support and guaranteed SLA.
              </div>
            </CommercialPillar>

            <CommercialPillar>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "var(--color-text-primary)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "6px",
                }}
              >
                <span>Enterprise Appliance</span>
                <a
                  href="mailto:sales@modelscript.org?subject=Enterprise%20Appliance%20Inquiry"
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--color-accent-purple, #a855f7)",
                    textDecoration: "underline",
                    textUnderlineOffset: "2px",
                  }}
                >
                  Contact us at sales@modelscript.org
                </a>
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.4 }}>
                Pre-hardened, zero-internet on-premise container deployment meeting FERC CEII and NERC CIP-005/007/010
                standards with enterprise SAML SSO.
              </div>
            </CommercialPillar>
          </CommercialPillarsGrid>
        </CommercialPromoCard>

        {/* Wallet Card */}
        <BillingWalletCard>
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={3}>
            <Box>
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: "600",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: "var(--color-text-muted)",
                }}
              >
                {selectedOrg ? `@${selectedOrg.slug} Shared Credit Balance` : "Current Credit Balance"}
              </span>
              <div
                style={{
                  fontSize: "36px",
                  fontWeight: "800",
                  color: "var(--color-text-primary)",
                  marginTop: "4px",
                }}
              >
                {`${billingSummary?.wallet.balance.toFixed(2) ?? "0.00"} cr`}
              </div>
              <span
                style={{
                  fontSize: "12px",
                  color: "var(--ms-success)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  marginTop: "4px",
                }}
              >
                <CheckCircleIcon size={12} />
                {isStripeLiveMode
                  ? "Pre-Flight Authorized for Cloud Slurm Offload ($1.00 / credit)"
                  : "Active in Local Simulation Billing Mode & In-Browser WebAssembly"}
              </span>
            </Box>

            <Box display="flex" flexDirection="column" alignItems="flex-end" gap={2}>
              <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                {isStripeLiveMode
                  ? "Quick Top-Up ($1.00 USD = 1.00 Compute Credit)"
                  : "Local Simulation Credit Top-Up ($1.00 / cr)"}
              </span>
              <Box display="flex" gap={2} flexWrap="wrap">
                <TopUpPillButton
                  disabled={isTopUpLoading}
                  onClick={() => void createCreditCheckout("pack_50", selectedOrgId || undefined)}
                >
                  <PlusIcon size={14} /> +50 cr — $50.00
                </TopUpPillButton>
                <TopUpPillButton
                  disabled={isTopUpLoading}
                  onClick={() => void createCreditCheckout("pack_200", selectedOrgId || undefined)}
                >
                  <PlusIcon size={14} /> +200 cr — $200.00
                </TopUpPillButton>
                <TopUpPillButton
                  disabled={isTopUpLoading}
                  onClick={() => void createCreditCheckout("pack_500", selectedOrgId || undefined)}
                >
                  <ZapIcon size={14} /> +500 cr — $500.00
                </TopUpPillButton>
                <TopUpPillButton
                  disabled={isTopUpLoading}
                  onClick={() => void startStripeCheckout(200, selectedOrgId || undefined)}
                >
                  <CreditCardIcon size={14} /> Stripe Tax Checkout (200 cr — $200.00)
                </TopUpPillButton>
              </Box>
            </Box>
          </Box>
        </BillingWalletCard>

        {/* Metric Strip */}
        <StatGrid>
          <StatItem>
            <Box display="flex" alignItems="center" gap={2} style={{ color: "var(--color-text-muted)" }}>
              <CreditCardIcon size={16} />
              <span style={{ fontSize: "12px", fontWeight: "600" }}>Total Spent</span>
            </Box>
            <span style={{ fontSize: "20px", fontWeight: "700", color: "var(--color-text-primary)" }}>
              {`${billingSummary?.wallet.total_spent.toFixed(2) ?? "0.00"} cr`}
            </span>
          </StatItem>

          <StatItem>
            <Box display="flex" alignItems="center" gap={2} style={{ color: "var(--color-text-muted)" }}>
              <ServerIcon size={16} />
              <span style={{ fontSize: "12px", fontWeight: "600" }}>HPC Jobs Run</span>
            </Box>
            <span style={{ fontSize: "20px", fontWeight: "700", color: "var(--color-text-primary)" }}>
              {billingSummary?.wallet.total_jobs_dispatched ?? 0}
            </span>
          </StatItem>

          <StatItem>
            <Box display="flex" alignItems="center" gap={2} style={{ color: "var(--color-text-muted)" }}>
              <CpuIcon size={16} />
              <span style={{ fontSize: "12px", fontWeight: "600" }}>CPU Core-Hours</span>
            </Box>
            <span style={{ fontSize: "20px", fontWeight: "700", color: "var(--color-text-primary)" }}>
              {billingSummary ? `${billingSummary.wallet.total_cpu_core_hours.toFixed(3)} hrs` : "0.000 hrs"}
            </span>
          </StatItem>

          <StatItem>
            <Box display="flex" alignItems="center" gap={2} style={{ color: "var(--color-text-muted)" }}>
              <ZapIcon size={16} />
              <span style={{ fontSize: "12px", fontWeight: "600" }}>GPU Hours</span>
            </Box>
            <span style={{ fontSize: "20px", fontWeight: "700", color: "var(--color-text-primary)" }}>
              {billingSummary ? `${billingSummary.wallet.total_gpu_hours.toFixed(3)} hrs` : "0.000 hrs"}
            </span>
          </StatItem>
        </StatGrid>

        {/* Compute Profiles Reference */}
        <Box mb={4}>
          <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
            Compute Profiles &amp; Quota Rates
          </DetailTitle>
          <Box
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "8px",
              overflowX: "auto",
              backgroundColor: "var(--color-canvas-default)",
            }}
          >
            <LedgerTable>
              <thead>
                <tr>
                  <th>Profile</th>
                  <th>Cores</th>
                  <th>Memory</th>
                  <th>GPU</th>
                  <th>Hourly Rate</th>
                  <th>Min Pre-Flight Reserve</th>
                </tr>
              </thead>
              <tbody>
                {computeProfiles.map((profile) => {
                  const minReserve = profile.costCreditsPerHour * 0.05;
                  return (
                    <tr key={profile.id}>
                      <td style={{ fontWeight: "600" }}>
                        {profile.name}{" "}
                        <span style={{ fontSize: "11px", fontWeight: 400, color: "var(--color-text-muted)" }}>
                          ({profile.id})
                        </span>
                      </td>
                      <td>{formatProfileCores(profile)}</td>
                      <td>{formatProfileMemory(profile.memoryMb)}</td>
                      <td>{formatProfileGpu(profile)}</td>
                      <td>{profile.costCreditsPerHour.toFixed(2)} cr / hr</td>
                      <td>{minReserve.toFixed(2)} cr (3 min)</td>
                    </tr>
                  );
                })}
              </tbody>
            </LedgerTable>
          </Box>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "8px", fontStyle: "italic" }}>
            * Note: Local in-browser WebAssembly simulations (ODE/DAE arena, SUNDIALS CVODE/IDA) run completely
            client-side without consuming credits. Quotas apply only to distributed Slurm cluster jobs ($1.00 USD = 1.00
            Compute Credit).
          </div>
        </Box>

        {/* Immutable Transaction Ledger */}
        <Box mb={4}>
          <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
            Immutable Audit Ledger ({txTotal || ledgerTransactions.length} Transactions)
          </DetailTitle>
          <Box
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "8px",
              overflowX: "auto",
              backgroundColor: "var(--color-canvas-default)",
            }}
          >
            <LedgerTable>
              <thead>
                <tr>
                  <th>Date &amp; Time</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Job ID</th>
                  <th>Amount</th>
                  <th>Balance After</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {ledgerTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "24px" }}>
                      No cloud billing transactions recorded. Local simulations run entirely within your local/browser
                      environment without credit consumption.
                    </td>
                  </tr>
                ) : (
                  ledgerTransactions.map((tx) => (
                    <tr key={tx.id}>
                      <td style={{ color: "var(--color-text-muted)" }}>{new Date(tx.created_at).toLocaleString()}</td>
                      <td>
                        <TxBadge $type={tx.transaction_type}>{tx.transaction_type.replace(/_/g, " ")}</TxBadge>
                      </td>
                      <td>{tx.description}</td>
                      <td style={{ fontFamily: "monospace" }}>{tx.job_id || "—"}</td>
                      <td
                        style={{
                          fontWeight: "700",
                          color: tx.amount >= 0 ? "var(--ms-success)" : "var(--ms-danger)",
                        }}
                      >
                        {tx.amount >= 0 ? `+${tx.amount.toFixed(2)}` : tx.amount.toFixed(2)} cr
                      </td>
                      <td style={{ fontWeight: "600" }}>{tx.balance_after.toFixed(2)} cr</td>
                      <td>
                        <InvoiceButton
                          type="button"
                          disabled={invoiceLoadingId === tx.id}
                          onClick={() => void handleOpenInvoice(tx.id)}
                        >
                          {invoiceLoadingId === tx.id ? "Loading..." : "Invoice"} <LinkExternalIcon size={11} />
                        </InvoiceButton>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </LedgerTable>
          </Box>
          {hasMoreTransactions && (
            <Box display="flex" justifyContent="center" mt={3}>
              <SecondaryButton
                type="button"
                disabled={isLoadingMoreTxs}
                onClick={() => void handleLoadMoreTransactions()}
              >
                {isLoadingMoreTxs ? "Loading..." : `Load More (${ledgerTransactions.length} of ${txTotal})`}
              </SecondaryButton>
            </Box>
          )}
        </Box>
      </Box>
    </>
  );
};
