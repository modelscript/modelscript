// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  CpuIcon,
  CreditCardIcon,
  PlusIcon,
  ServerIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { getUserBillingSummary, topUpCredits, type UserBillingSummary } from "../../../api";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { DetailSubtitle, DetailTitle, Header } from "../settingsStyles";

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
      : props.$type === "topup"
        ? "rgba(6, 182, 212, 0.15)"
        : "rgba(218, 54, 51, 0.2)"};
  color: ${(props) => (props.$type === "initial_grant" ? "#3fb950" : props.$type === "topup" ? "#22d3ee" : "#f85149")};
`;

export interface BillingTabProps {
  onBack: () => void;
}

export const BillingTab: React.FC<BillingTabProps> = ({ onBack }) => {
  const [billingSummary, setBillingSummary] = useState<UserBillingSummary | null>(null);
  const [isTopUpLoading, setIsTopUpLoading] = useState(false);
  const [topUpSuccess, setTopUpSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getUserBillingSummary()
      .then((data) => setBillingSummary(data))
      .catch(() => {
        setError("Unable to retrieve billing summary. Please check your network connection.");
      });
  }, []);

  const handleTopUp = async (amount: number) => {
    setIsTopUpLoading(true);
    setError(null);
    setTopUpSuccess(null);
    try {
      const updatedWallet = await topUpCredits(amount);
      setBillingSummary((prev) =>
        prev
          ? {
              ...prev,
              wallet: updatedWallet,
            }
          : null,
      );
      setTopUpSuccess(`Successfully credited +${amount.toFixed(2)} compute credits to your wallet.`);
    } catch {
      setError("Top-up request failed. Please check payment method and try again.");
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
          Monitor high-performance computing quotas, credit balances, and metered usage across SLURM and local solver
          clusters.
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
              gap: "8px",
            }}
          >
            <AlertIcon size={16} />
            <Text fontSize="14px">{error}</Text>
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
              gap: "8px",
            }}
          >
            <CheckCircleIcon size={16} />
            <Text fontSize="14px">{topUpSuccess}</Text>
          </Box>
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
                Current Credit Balance
              </span>
              <div
                style={{
                  fontSize: "36px",
                  fontWeight: "800",
                  color: "var(--color-text-primary)",
                  marginTop: "4px",
                }}
              >
                {billingSummary ? `${billingSummary.wallet.balance.toFixed(2)} cr` : "..."}
              </div>
              <span
                style={{
                  fontSize: "12px",
                  color: "#3fb950",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  marginTop: "4px",
                }}
              >
                <CheckCircleIcon size={12} /> Active &amp; Pre-flight Authorized
              </span>
            </Box>

            <Box display="flex" flexDirection="column" alignItems="flex-end" gap={2}>
              <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Quick Top-Up</span>
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
              {billingSummary ? `${billingSummary.wallet.total_spent.toFixed(2)} cr` : "0.00 cr"}
            </span>
          </StatItem>

          <StatItem>
            <Box display="flex" alignItems="center" gap={2} style={{ color: "var(--color-text-muted)" }}>
              <ServerIcon size={16} />
              <span style={{ fontSize: "12px", fontWeight: "600" }}>HPC Jobs Run</span>
            </Box>
            <span style={{ fontSize: "20px", fontWeight: "700", color: "var(--color-text-primary)" }}>
              {billingSummary ? billingSummary.wallet.total_jobs_dispatched : 0}
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
                      No billing transactions recorded yet.
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
                          color: tx.amount >= 0 ? "#3fb950" : "#f85149",
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
