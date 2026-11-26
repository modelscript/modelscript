// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowRightIcon, PlusIcon, ZapIcon } from "@primer/octicons-react";
import React from "react";
import { Link } from "react-router-dom";
import Box from "../../Box";
import { CardHeader, CardTitle, WalletCard as StyledWalletCard, TopUpButton } from "../styles";

export interface WalletCardProps {
  creditBalance: number;
}

export const WalletCard: React.FC<WalletCardProps> = ({ creditBalance }) => {
  const isLowBalance = creditBalance <= 0;

  return (
    <StyledWalletCard>
      <CardHeader>
        <Box display="flex" alignItems="center" gap="6px">
          <ZapIcon size={14} fill={isLowBalance ? "var(--color-danger-fg, #ef4444)" : "var(--color-accent-purple)"} />
          <CardTitle>Compute Wallet</CardTitle>
        </Box>
        <span
          style={{
            fontSize: "10px",
            color: isLowBalance ? "var(--color-danger-fg, #ef4444)" : "var(--color-accent-purple)",
            fontFamily: "var(--font-mono)",
            background: isLowBalance ? "rgba(239, 68, 68, 0.14)" : "var(--color-accent-purple-bg)",
            border: isLowBalance ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid var(--color-accent-purple-border)",
            padding: "2px 6px",
            borderRadius: "4px",
            fontWeight: 700,
            letterSpacing: "0.02em",
          }}
        >
          {isLowBalance ? "LOW BALANCE" : "PAY-AS-YOU-GO"}
        </span>
      </CardHeader>

      <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={2}>
        <div>
          <span
            style={{
              fontSize: "26px",
              fontWeight: 800,
              fontFamily: "var(--font-mono)",
              color: isLowBalance ? "var(--color-danger-fg, #ef4444)" : "var(--color-text-heading)",
              letterSpacing: "-0.5px",
            }}
          >
            {creditBalance.toFixed(2)}
          </span>
          <span
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color: isLowBalance ? "var(--color-danger-fg, #ef4444)" : "var(--color-accent-purple)",
              marginLeft: "4px",
              fontFamily: "var(--font-mono)",
            }}
          >
            cr
          </span>
        </div>
        <TopUpButton onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-topup"))}>
          <PlusIcon size={12} />
          <span>Top Up</span>
        </TopUpButton>
      </Box>

      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        style={{
          paddingTop: "8px",
          borderTop: "1px solid var(--color-border-default)",
          fontSize: "11px",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span style={{ color: isLowBalance ? "var(--color-danger-fg, #ef4444)" : "var(--color-text-muted)" }}>
          {isLowBalance ? "Low balance — Top up for cloud jobs" : "$1.00 / credit · Cloud HPC"}
        </span>
        <Link
          to="/settings/billing"
          style={{
            color: "var(--color-accent-cyan)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "3px",
            fontSize: "11px",
            fontWeight: 600,
          }}
        >
          <span>Usage Log</span>
          <ArrowRightIcon size={10} />
        </Link>
      </Box>
    </StyledWalletCard>
  );
};
