// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowRightIcon, PlusIcon, ZapIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import Box from "../../Box";
import { WalletCard as StyledWalletCard, TopUpButton } from "../styles";

export interface WalletCardProps {
  creditBalance: number;
}

export const WalletCard: React.FC<WalletCardProps> = ({ creditBalance }) => {
  return (
    <StyledWalletCard>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Box display="flex" alignItems="center" gap={2}>
          <ZapIcon size={14} fill="var(--color-accent-purple)" />
          <Text
            style={{
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--color-text-muted)",
            }}
          >
            Compute Wallet
          </Text>
        </Box>
        <span
          style={{
            fontSize: "10px",
            color: "var(--color-accent-purple)",
            fontFamily: "var(--font-mono)",
            background: "var(--color-accent-purple-bg)",
            border: "1px solid var(--color-accent-purple-border)",
            padding: "2px 6px",
            borderRadius: "4px",
            fontWeight: 700,
            letterSpacing: "0.02em",
          }}
        >
          RESEARCH TIER
        </span>
      </Box>

      <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={2}>
        <div>
          <span
            style={{
              fontSize: "26px",
              fontWeight: 800,
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-heading)",
              letterSpacing: "-0.5px",
            }}
          >
            {creditBalance.toFixed(2)}
          </span>
          <span
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color: "var(--color-accent-purple)",
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
        <span style={{ color: "var(--color-text-muted)" }}>Auto-Allocation: Active</span>
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
