// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  CpuIcon,
  CreditCardIcon,
  LinkExternalIcon,
  PlusIcon,
  RocketIcon,
  ServerIcon,
  ShieldCheckIcon,
  SyncIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { getUserBillingSummary, topUpCredits, type UserBillingSummary } from "../../../api";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { useFeatureFlags } from "../../../FeatureFlagContext";
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
    props.$type === "initial_grant"
      ? "rgba(35, 134, 54, 0.2)"
      : props.$type === "topup" || props.$type === "top_up"
        ? "rgba(6, 182, 212, 0.15)"
        : "rgba(218, 54, 51, 0.2)"};
  color: ${(props) =>
    props.$type === "initial_grant"
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

export const BillingTab: React.FC<BillingTabProps> = ({ onBack }) => {
  const { isEnabled, setFlagOverride } = useFeatureFlags();
  const isStripeFeatureEnabled = isEnabled("billing_stripe_live");

  const [billingSummary, setBillingSummary] = useState<BillingSummaryView | null>(null);
  const [isLiveActive, setIsLiveActive] = useState<boolean>(false);
  const [isTopUpLoading, setIsTopUpLoading] = useState(false);
  const [topUpSuccess, setTopUpSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = async () => {
    try {
      const data = await getUserBillingSummary();
      setBillingSummary(data as BillingSummaryView);
      setIsLiveActive(true);
      setError(null);
    } catch {
      // If billing service is unconfigured or gated, gracefully fall back to Community mode
      setBillingSummary(DEFAULT_COMMUNITY_VIEW);
      setIsLiveActive(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, [isStripeFeatureEnabled]);

  const toggleSandboxBilling = () => {
    const nextState = !isStripeFeatureEnabled;
    setFlagOverride("billing_stripe_live", nextState);
    if (!nextState) {
      setIsLiveActive(false);
      setBillingSummary(DEFAULT_COMMUNITY_VIEW);
      setTopUpSuccess(null);
      setError(null);
    }
  };

  const handleTopUp = async (amount: number) => {
    setIsTopUpLoading(true);
    setError(null);
    setTopUpSuccess(null);
    try {
      const updatedWallet = await topUpCredits(amount, isLiveActive ? "credit_card" : "sandbox_card");
      setBillingSummary((prev) =>
        prev
          ? {
              ...prev,
              wallet: {
                ...prev.wallet,
                balance:
                  typeof (updatedWallet as any).newBalance === "number"
                    ? (updatedWallet as any).newBalance
                    : ((updatedWallet as any).balance ?? prev.wallet.balance + amount),
              },
            }
          : null,
      );
      fetchSummary();
      window.dispatchEvent(new CustomEvent("modelscript:wallet-update"));
      setTopUpSuccess(
        `Successfully credited +${amount.toFixed(2)} compute credits to your wallet (${
          isLiveActive ? "Live Top-Up" : "Developer Sandbox"
        }).`,
      );
    } catch {
      setError(
        "Top-up request failed. In standalone Community mode, enable Developer Sandbox or connect a live Stripe account.",
      );
    } finally {
      setIsTopUpLoading(false);
    }
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
            <Box display="flex" alignItems="center" gap={2}>
              <Text style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                {isLiveActive ? "ModelScript Pro Cloud" : "ModelScript Community Edition"}
              </Text>
              <PlanBadge $variant={isLiveActive ? "pro" : "community"}>
                <ShieldCheckIcon size={12} />
                {isLiveActive ? "Active · Cloud HPC" : "Active · AGPL-3.0"}
              </PlanBadge>
            </Box>
            <Text style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.4 }}>
              {isLiveActive
                ? "High-performance Slurm cluster job dispatch, batched SUNDIALS sweeps, and A100 GPU surrogate training active."
                : "Unlimited zero-latency local WebAssembly ODE/DAE execution, compiler passes, and all 44 engineering formats included free and open source."}
            </Text>
          </Box>

          <Box display="flex" alignItems="center" gap={2}>
            <SecondaryButton onClick={toggleSandboxBilling}>
              <SyncIcon size={13} />
              {isStripeFeatureEnabled ? "Disable Sandbox Mode" : "Enable Developer Sandbox"}
            </SecondaryButton>
            <ActionLinkButton href="https://modelscript.org/pricing" target="_blank" rel="noopener noreferrer">
              <span>View Plans &amp; Pricing</span>
              <LinkExternalIcon size={12} />
            </ActionLinkButton>
          </Box>
        </PlanHeaderCard>

        {/* Commercial & Enterprise Info Banner (shown in Community mode) */}
        {!isLiveActive && (
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
                  Need to embed ModelScript without AGPL copyleft obligations, or deploy a hardened, air-gapped NERC CIP
                  appliance inside your utility firewall?
                </div>
              </Box>
              <ActionLinkButton
                href="mailto:licensing@modelscript.org?subject=ModelScript%20Commercial%20License%20%2F%20Enterprise%20Inquiry&body=Hi%20ModelScript%20Team%2C%0A%0AWe%20are%20interested%20in%20evaluating%20the%20ModelScript%20Commercial%20SDK%20%2F%20Enterprise%20Appliance%20for%20our%20engineering%20team.%0A%0ACompany%2FOrganization%3A%20%0ATeam%20Size%3A%20%0APrimary%20Engineering%20Formats%20(e.g.%20Modelica%2C%20SysML%2C%20STEP)%3A%20%0A%0ABest%20regards%2C"
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
        )}

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
                {isLiveActive ? "Current Credit Balance" : "Local Compute Engine"}
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
                {isLiveActive
                  ? "Pre-Flight Authorized for Cloud Slurm Offload"
                  : "Active & Pre-flight Authorized for In-Browser WebAssembly"}
              </span>
            </Box>

            <Box display="flex" flexDirection="column" alignItems="flex-end" gap={2}>
              <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                {isLiveActive ? "Quick Top-Up (Credits)" : "Developer Sandbox Reload"}
              </span>
              <Box display="flex" gap={2} flexWrap="wrap">
                <TopUpPillButton disabled={isTopUpLoading} onClick={() => handleTopUp(50)}>
                  <PlusIcon size={14} /> +50 cr
                </TopUpPillButton>
                <TopUpPillButton disabled={isTopUpLoading} onClick={() => handleTopUp(200)}>
                  <PlusIcon size={14} /> +200 cr
                </TopUpPillButton>
                <TopUpPillButton disabled={isTopUpLoading} onClick={() => handleTopUp(500)}>
                  <ZapIcon size={14} /> +500 cr
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
                  <td>1.00 cr / hr</td>
                  <td>0.05 cr (3 min)</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: "600" }}>High Memory</td>
                  <td>16 Cores</td>
                  <td>128 GB</td>
                  <td>None</td>
                  <td>4.50 cr / hr</td>
                  <td>0.22 cr (3 min)</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: "600" }}>GPU A100</td>
                  <td>16 Cores</td>
                  <td>80 GB</td>
                  <td>1x NVIDIA A100</td>
                  <td>12.00 cr / hr</td>
                  <td>0.60 cr (3 min)</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: "600" }}>MPI Supercluster</td>
                  <td>64 Cores</td>
                  <td>256 GB</td>
                  <td>InfiniBand</td>
                  <td>18.00 cr / hr</td>
                  <td>0.90 cr (3 min)</td>
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
                </tr>
              </thead>
              <tbody>
                {!billingSummary || billingSummary.recent_transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "24px" }}>
                      No cloud billing transactions recorded. Local simulations run entirely within your local/browser
                      environment without credit consumption.
                    </td>
                  </tr>
                ) : (
                  billingSummary.recent_transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td style={{ color: "var(--color-text-muted)" }}>{new Date(tx.created_at).toLocaleString()}</td>
                      <td>
                        <TxBadge $type={tx.transaction_type}>{tx.transaction_type.replace("_", " ")}</TxBadge>
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
