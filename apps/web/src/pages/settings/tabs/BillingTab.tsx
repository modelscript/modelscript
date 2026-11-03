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
import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import {
  createCheckoutSession,
  createPaymentIntent,
  getInvoiceDownloadUrl,
  getOrgWallet,
  getUserBillingSummary,
  topUpCredits,
  topUpOrgCredits,
  type UserBillingSummary,
} from "../../../api";
import { getMyOrganizations, type Organization } from "../../../api/organizations";
import { useAuth } from "../../../AuthContext";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { useFeatureFlags } from "../../../FeatureFlagContext";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
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
    opacity: 0.5;
    cursor: not-allowed;
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

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--color-border-muted);
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
    props.$type === "refund"
      ? "rgba(35, 134, 54, 0.2)"
      : props.$type === "topup" || props.$type === "top_up"
        ? "rgba(6, 182, 212, 0.15)"
        : "rgba(218, 54, 51, 0.2)"};
  color: ${(props) =>
    props.$type === "initial_grant" ||
    props.$type === "escrow_refund" ||
    props.$type === "escrow_release" ||
    props.$type === "refund"
      ? "var(--ms-success)"
      : props.$type === "topup" || props.$type === "top_up"
        ? "#22d3ee"
        : "var(--ms-danger)"};
`;

export interface BillingTabProps {
  onBack: () => void;
}

type BillingSummaryView = UserBillingSummary & {
  wallet: {
    balance: number;
    total_spent: number;
    total_jobs_dispatched: number;
    total_cpu_core_hours: number;
    total_gpu_hours: number;
  };
  recent_transactions: {
    id: string | number;
    created_at: string;
    transaction_type: string;
    description: string;
    job_id?: string | null;
    amount: number;
    balance_after: number;
  }[];
};

const DEFAULT_COMMUNITY_VIEW: BillingSummaryView = {
  userId: 0,
  creditBalance: 0,
  totalSpent: 0,
  totalJobs: 0,
  totalCpuSeconds: 0,
  totalGpuSeconds: 0,
  profileUsage: {},
  recentTransactions: [],
  wallet: {
    balance: 0,
    total_spent: 0,
    total_jobs_dispatched: 0,
    total_cpu_core_hours: 0,
    total_gpu_hours: 0,
  },
  recent_transactions: [],
};

function normalizeBillingSummary(raw: unknown): BillingSummaryView {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_COMMUNITY_VIEW;
  }
  const rawObj = raw as Record<string, unknown>;
  const wallet = rawObj["wallet"] as Record<string, unknown> | undefined;
  const balance = Number(wallet?.["balance"] ?? rawObj["creditBalance"] ?? rawObj["credit_balance"] ?? 0);
  const totalSpent = Number(wallet?.["total_spent"] ?? rawObj["totalSpent"] ?? rawObj["total_spent"] ?? 0);
  const totalJobs = Number(wallet?.["total_jobs_dispatched"] ?? rawObj["totalJobs"] ?? rawObj["total_jobs"] ?? 0);
  const totalCpuSeconds = Number(rawObj["totalCpuSeconds"] ?? rawObj["total_cpu_seconds"] ?? 0);
  const totalGpuSeconds = Number(rawObj["totalGpuSeconds"] ?? rawObj["total_gpu_seconds"] ?? 0);
  const totalCpuCoreHours = Number(wallet?.["total_cpu_core_hours"] ?? (totalCpuSeconds ? totalCpuSeconds / 3600 : 0));
  const totalGpuHours = Number(wallet?.["total_gpu_hours"] ?? (totalGpuSeconds ? totalGpuSeconds / 3600 : 0));

  const rawTxs: Record<string, unknown>[] = Array.isArray(rawObj["recent_transactions"])
    ? (rawObj["recent_transactions"] as Record<string, unknown>[])
    : Array.isArray(rawObj["recentTransactions"])
      ? (rawObj["recentTransactions"] as Record<string, unknown>[])
      : Array.isArray(rawObj["transactions"])
        ? (rawObj["transactions"] as Record<string, unknown>[])
        : [];

  const normalizedTxs = rawTxs.map((tx: Record<string, unknown>, idx: number) => ({
    id: (tx["id"] as number | string | undefined) ?? idx,
    created_at: String(tx["created_at"] ?? tx["createdAt"] ?? new Date().toISOString()),
    transaction_type: String(tx["transaction_type"] ?? tx["type"] ?? "job_charge"),
    description: String(tx["description"] ?? ""),
    job_id: tx["job_id"] !== undefined ? String(tx["job_id"] ?? "") || null : tx["jobId"] ? String(tx["jobId"]) : null,
    amount: Number(tx["amount"] ?? 0),
    balance_after: Number(tx["balance_after"] ?? tx["balanceAfter"] ?? balance),
  }));

  return {
    userId: Number(rawObj["userId"] ?? rawObj["user_id"] ?? 0),
    creditBalance: balance,
    totalSpent,
    totalJobs,
    totalCpuSeconds,
    totalGpuSeconds,
    profileUsage: (rawObj["profileUsage"] as BillingSummaryView["profileUsage"]) ?? {},
    recentTransactions: (rawObj["recentTransactions"] as BillingSummaryView["recentTransactions"]) ?? [],
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
  const { user } = useAuth();
  const { isEnabled, setFlagOverride } = useFeatureFlags();
  const isStripeFeatureEnabled = isEnabled("billing_stripe_live");
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
  const [billingStatus, setBillingStatus] = useState<{
    stripeConfigured: boolean;
    activeTier: "free" | "pro" | "team";
  }>({
    stripeConfigured: Boolean(isStripeFeatureEnabled),
    activeTier: "free",
  });
  const [sandboxToggle, setSandboxToggle] = useState<boolean>(() => !isStripeFeatureEnabled);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">("monthly");
  const [isTopUpLoading, setIsTopUpLoading] = useState(false);
  const [topUpSuccess, setTopUpSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBillingStatus((prev) => ({ ...prev, stripeConfigured: Boolean(isStripeFeatureEnabled) }));
    if (!isStripeFeatureEnabled) {
      setSandboxToggle(true);
    }
  }, [isStripeFeatureEnabled]);

  useEffect(() => {
    let cancelled = false;
    const storedOrgId = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("ms_billing_org_id") : null;
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
  const isStripeLiveMode = Boolean(billingStatus?.stripeConfigured) && !sandboxToggle;
  const isLocalSimulationMode = !isStripeLiveMode;
  const isLiveActive = isStripeLiveMode || isLocalSimulationMode;

  const fetchSummary = useCallback(async () => {
    try {
      const data = selectedOrgId !== null ? await getOrgWallet(selectedOrgId) : await getUserBillingSummary();
      setBillingSummary(normalizeBillingSummary(data));
      setError(null);
    } catch {
      setBillingSummary(DEFAULT_COMMUNITY_VIEW);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  const toggleSandboxBilling = () => {
    if (billingStatus?.stripeConfigured) {
      setSandboxToggle((prev) => !prev);
    } else {
      const nextStripe = !isStripeFeatureEnabled;
      setFlagOverride("billing_stripe_live", nextStripe);
      setBillingStatus((prev) => ({ ...prev, stripeConfigured: nextStripe }));
      setSandboxToggle(!nextStripe);
    }
    setTopUpSuccess(null);
    setError(null);
  };

  const handleTopUp = async (amount: number, overrideOrgId?: number) => {
    const targetOrgId = overrideOrgId !== undefined ? overrideOrgId : (selectedOrgId ?? undefined);
    setIsTopUpLoading(true);
    setError(null);
    setTopUpSuccess(null);
    try {
      let paymentIntentId: string | undefined;
      if (isStripeLiveMode) {
        const pi = await createPaymentIntent(amount);
        paymentIntentId = pi.id;
      }
      const updatedWallet =
        targetOrgId !== undefined
          ? await topUpOrgCredits(targetOrgId, amount, paymentIntentId)
          : await topUpCredits(amount, isStripeLiveMode ? "credit_card" : "sandbox_card", paymentIntentId);
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
      window.dispatchEvent(new CustomEvent("modelscript:wallet-update"));
      const targetOrg =
        targetOrgId !== undefined ? (organizations.find((o) => o.id === targetOrgId) ?? selectedOrg) : null;
      const targetLabel = targetOrg ? `@${targetOrg.slug} organization wallet` : "your personal wallet";
      setTopUpSuccess(
        `Successfully credited +${amount.toFixed(2)} compute credits to ${targetLabel} (${
          isStripeLiveMode ? "Stripe Live Mode" : "Local Simulation Billing Mode"
        }).`,
      );
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
          err?.message ||
          "Top-up request failed. Please verify your permissions or billing configuration.",
      );
    } finally {
      setIsTopUpLoading(false);
    }
  };

  const createCreditCheckout = async (packId: string, orgId?: number) => {
    const packAmounts: Record<string, number> = {
      pack_50: 50,
      pack_200: 200,
      pack_500: 500,
    };
    const amount = packAmounts[packId] ?? (Number(packId) || 200);
    if (isStripeLiveMode) {
      setIsTopUpLoading(true);
      setError(null);
      try {
        const session = await createCheckoutSession(amount, orgId);
        if (session.checkoutUrl) {
          window.open(session.checkoutUrl, "_blank", "noopener,noreferrer");
          return;
        }
      } catch {
        // Fall back to direct credit top-up
      } finally {
        setIsTopUpLoading(false);
      }
    }
    await handleTopUp(amount, orgId);
  };

  const createSubscriptionCheckout = async (
    tierId: "free" | "pro" | "team",
    interval: "monthly" | "annual",
    orgId?: number,
  ) => {
    setError(null);
    setTopUpSuccess(null);
    const targetOrg = orgId !== undefined ? (organizations.find((o) => o.id === orgId) ?? selectedOrg) : null;
    const scopeLabel = targetOrg ? `@${targetOrg.slug}` : `@${user?.username || "personal"}`;

    if (tierId === "free") {
      setBillingStatus((prev) => ({ ...prev, activeTier: "free" }));
      setTopUpSuccess(`Activated Community Free tier for ${scopeLabel}.`);
      return;
    }

    const monthlyCredits = tierId === "pro" ? 200 : 600;
    const grantCredits = interval === "annual" ? monthlyCredits * 12 : monthlyCredits;

    if (isStripeLiveMode) {
      setIsTopUpLoading(true);
      try {
        const session = await createCheckoutSession(grantCredits, orgId);
        if (session.checkoutUrl) {
          window.open(session.checkoutUrl, "_blank", "noopener,noreferrer");
          setBillingStatus((prev) => ({ ...prev, activeTier: tierId }));
          return;
        }
      } catch {
        // Fall through to local simulation activation
      } finally {
        setIsTopUpLoading(false);
      }
    }

    setBillingStatus((prev) => ({ ...prev, activeTier: tierId }));
    await handleTopUp(grantCredits, orgId);
    setTopUpSuccess(
      `Upgraded ${scopeLabel} to ${tierId === "pro" ? "Pro" : "Team"} (${interval}) and credited +${grantCredits.toFixed(
        2,
      )} compute credits (${isStripeLiveMode ? "Stripe Live Mode" : "Local Simulation Billing Mode"}).`,
    );
  };

  return (
    <>
      <Header>
        <CircleIconButton onClick={onBack} style={{ marginRight: "8px" }}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        Billing &amp; Compute Quotas
      </Header>
      <Box px={4} pb={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
          Manage your subscription tier, high-performance computing quotas, and metered compute credit ledgers across
          SLURM and local solver clusters.
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
                  ? `Managing shared subscription and compute credit ledger for ${selectedOrg.display_name || selectedOrg.name} (@${selectedOrg.slug}).`
                  : `Managing personal compute credit balance and subscription for Personal Account (@${user?.username || "me"}).`}
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

        {error && (
          <Box
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
                {billingStatus.activeTier === "team"
                  ? `${brandName} Team HPC`
                  : billingStatus.activeTier === "pro"
                    ? `${brandName} Pro Cloud`
                    : `${brandName} Community Edition`}
              </Text>
              <PlanBadge $variant={isStripeLiveMode ? "pro" : "community"}>
                <ShieldCheckIcon size={12} />
                {isStripeLiveMode ? "Stripe Live Mode" : "Local Simulation Billing Mode"}
              </PlanBadge>
            </Box>
            <Text style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.4 }}>
              {isStripeLiveMode
                ? "Connected to Stripe Live billing for cloud Slurm cluster job dispatch, batched SUNDIALS sweeps, and GPU surrogate training."
                : `Local Simulation Billing Mode active on ${brandName} — test subscription upgrades, organization credit top-ups, and ledger auditing without live card charges.`}
            </Text>
          </Box>

          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <SecondaryButton type="button" onClick={toggleSandboxBilling}>
              <SyncIcon size={13} />
              {sandboxToggle ? "Sandbox Mode Active" : "Simulate Sandbox Mode"}
            </SecondaryButton>
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
              <DetailTitle style={{ fontWeight: 700, display: "block" }}>{brandName} Subscription Tiers</DetailTitle>
              <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                Select a plan for{" "}
                {selectedOrg
                  ? `${selectedOrg.display_name || selectedOrg.name} (@${selectedOrg.slug})`
                  : `Personal Account (@${user?.username || "me"})`}
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
            <TierCard $highlighted={billingStatus.activeTier === "free"}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                  Community Free
                </div>
                <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-text-primary)", margin: "6px 0" }}>
                  $0{" "}
                  <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-muted)" }}>/ forever</span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                  Unlimited in-browser WebAssembly ODE/DAE simulation, public repositories, and open-source package
                  publishing.
                </div>
              </div>
              <TierActionButton
                type="button"
                disabled={isTopUpLoading}
                onClick={() => void createSubscriptionCheckout("free", billingInterval, selectedOrgId || undefined)}
              >
                Activate Free
              </TierActionButton>
            </TierCard>

            <TierCard $highlighted={billingStatus.activeTier === "pro"}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                  {brandName} Pro
                </div>
                <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-text-primary)", margin: "6px 0" }}>
                  {billingInterval === "annual" ? "$24" : "$29"}{" "}
                  <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-muted)" }}>/ month</span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                  Includes 200 monthly cloud HPC credits, priority Slurm queue dispatch, and GPU surrogate model
                  training.
                </div>
              </div>
              <TierActionButton
                type="button"
                $primary
                disabled={isTopUpLoading}
                onClick={() => void createSubscriptionCheckout("pro", billingInterval, selectedOrgId || undefined)}
              >
                Upgrade to Pro
              </TierActionButton>
            </TierCard>

            <TierCard $highlighted={billingStatus.activeTier === "team"}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                  {brandName} Team
                </div>
                <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-text-primary)", margin: "6px 0" }}>
                  {billingInterval === "annual" ? "$79" : "$99"}{" "}
                  <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-muted)" }}>/ month</span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                  Includes 600 shared organization HPC credits, scoped private registries, RBAC governance, and MPI
                  cluster access.
                </div>
              </div>
              <TierActionButton
                type="button"
                $primary
                disabled={isTopUpLoading}
                onClick={() => void createSubscriptionCheckout("team", billingInterval, selectedOrgId || undefined)}
              >
                Upgrade to Team
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
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                Commercial SDK ($12k/yr)
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.4 }}>
                Dual-license exemption from AGPL §13 network copyleft for proprietary SaaS or closed desktop software,
                with private Slack support and guaranteed SLA.
              </div>
            </CommercialPillar>

            <CommercialPillar>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                Enterprise Appliance ($18k/yr)
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
                {isLiveActive ? `${billingSummary?.wallet.balance.toFixed(2) ?? "0.00"} cr` : "Unlimited Local"}
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
                  ? "Pre-Flight Authorized for Cloud Slurm Offload"
                  : "Active in Local Simulation Billing Mode & In-Browser WebAssembly"}
              </span>
            </Box>

            <Box display="flex" flexDirection="column" alignItems="flex-end" gap={2}>
              <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                {isStripeLiveMode ? "Quick Top-Up (Credits)" : "Local Simulation Credit Top-Up"}
              </span>
              <Box display="flex" gap={2} flexWrap="wrap">
                <TopUpPillButton
                  disabled={isTopUpLoading}
                  onClick={() => void createCreditCheckout("pack_50", selectedOrgId || undefined)}
                >
                  <PlusIcon size={14} /> +50 cr
                </TopUpPillButton>
                <TopUpPillButton
                  disabled={isTopUpLoading}
                  onClick={() => void createCreditCheckout("pack_200", selectedOrgId || undefined)}
                >
                  <PlusIcon size={14} /> +200 cr
                </TopUpPillButton>
                <TopUpPillButton
                  disabled={isTopUpLoading}
                  onClick={() => void createCreditCheckout("pack_500", selectedOrgId || undefined)}
                >
                  <ZapIcon size={14} /> +500 cr
                </TopUpPillButton>
                <TopUpPillButton
                  disabled={isTopUpLoading}
                  onClick={async () => {
                    try {
                      setIsTopUpLoading(true);
                      const session = await createCheckoutSession(200, selectedOrgId || undefined);
                      if (session.checkoutUrl) {
                        window.open(session.checkoutUrl, "_blank", "noopener,noreferrer");
                      }
                    } catch {
                      setError("Could not start Stripe Checkout session.");
                    } finally {
                      setIsTopUpLoading(false);
                    }
                  }}
                >
                  <CreditCardIcon size={14} /> Stripe Tax Checkout
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
              {isLiveActive ? `${billingSummary?.wallet.total_spent.toFixed(2) ?? "0.00"} cr` : "0.00 cr (Local)"}
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
              overflow: "hidden",
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
                <tr>
                  <td style={{ fontWeight: "600" }}>Standard</td>
                  <td>4 Cores</td>
                  <td>16 GB</td>
                  <td>None</td>
                  <td>10.00 cr / hr</td>
                  <td>0.50 cr (3 min)</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: "600" }}>High Memory</td>
                  <td>16 Cores</td>
                  <td>256 GB</td>
                  <td>None</td>
                  <td>35.00 cr / hr</td>
                  <td>1.75 cr (3 min)</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: "600" }}>GPU A100</td>
                  <td>8 Cores</td>
                  <td>64 GB</td>
                  <td>1x NVIDIA A100</td>
                  <td>80.00 cr / hr</td>
                  <td>4.00 cr (3 min)</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: "600" }}>MPI Supercluster</td>
                  <td>64 Cores</td>
                  <td>128 GB</td>
                  <td>InfiniBand</td>
                  <td>150.00 cr / hr</td>
                  <td>7.50 cr (3 min)</td>
                </tr>
              </tbody>
            </LedgerTable>
          </Box>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "8px", fontStyle: "italic" }}>
            * Note: Local in-browser WebAssembly simulations (ODE/DAE arena, SUNDIALS CVODE/IDA) run completely
            client-side without consuming credits. Quotas apply only to distributed Slurm cluster jobs.
          </div>
        </Box>

        {/* Immutable Transaction Ledger */}
        <Box mb={4}>
          <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
            Immutable Audit Ledger ({billingSummary?.recent_transactions.length || 0} Transactions)
          </DetailTitle>
          <Box
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "8px",
              overflow: "hidden",
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
                {!billingSummary || billingSummary.recent_transactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "24px" }}>
                      No cloud billing transactions recorded. Local simulations run entirely within your local/browser
                      environment without credit consumption.
                    </td>
                  </tr>
                ) : (
                  billingSummary.recent_transactions.map((tx) => (
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
                        <a
                          href={getInvoiceDownloadUrl(tx.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: "12px", fontWeight: 600 }}
                        >
                          Invoice <LinkExternalIcon size={11} />
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </LedgerTable>
          </Box>
        </Box>
      </Box>
    </>
  );
};
