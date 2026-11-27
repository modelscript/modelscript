// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  CpuIcon,
  FlameIcon,
  ServerIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import type { ComputeProfileInfo, UserWalletInfo } from "../../api";
import Box from "../Box";
import { ProfileCard, ProfileGrid, StyledInput } from "./styles";

export interface ProfileSelectorProps {
  modelName: string;
  setModelName: (val: string) => void;
  numberOfIntervals: number;
  setNumberOfIntervals: (val: number) => void;
  profiles: ComputeProfileInfo[];
  selectedProfile: string;
  setSelectedProfile: (val: string) => void;
  wallet: UserWalletInfo | null;
  walletLoading?: boolean | undefined;
  currentProfile?: ComputeProfileInfo | undefined;
  recommendedProfileId?: string | undefined;
  sbatchPreview?: string | undefined;
  hideModelHeader?: boolean | undefined;
}

export const ProfileSelector: React.FC<ProfileSelectorProps> = ({
  modelName,
  setModelName,
  numberOfIntervals,
  setNumberOfIntervals,
  profiles,
  selectedProfile,
  setSelectedProfile,
  wallet,
  walletLoading = false,
  currentProfile,
  recommendedProfileId,
  sbatchPreview,
  hideModelHeader = false,
}) => {
  const [showSbatch, setShowSbatch] = useState(false);
  const [copiedSbatch, setCopiedSbatch] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopySbatch = async () => {
    if (!sbatchPreview) return;
    setCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(sbatchPreview);
      setCopiedSbatch(true);
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => {
        setCopiedSbatch(false);
        copyTimerRef.current = null;
      }, 2000);
    } catch {
      setCopiedSbatch(false);
      setCopyError("Copy failed — select text manually");
    }
  };

  // Minimum escrow matches backend quota-guard.ts: 3 minutes = 0.05 hours
  const minEscrow = (currentProfile?.costCreditsPerHour ?? 0) * 0.05;
  const isInsufficientBalance = wallet !== null && wallet.creditBalance < minEscrow;

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      {!hideModelHeader && (
        <Box display="flex" gap={3} flexWrap="wrap">
          <Box flex={2} style={{ minWidth: 200 }}>
            <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={1} display="block">
              Target Model Name
            </Text>
            <StyledInput
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="e.g. ElectroHydrostaticActuator"
            />
          </Box>
          <Box flex={1} style={{ minWidth: 120 }}>
            <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={1} display="block">
              Intervals
            </Text>
            <StyledInput
              type="number"
              value={numberOfIntervals}
              onChange={(e) => setNumberOfIntervals(Number(e.target.value))}
              min={10}
              max={100000}
            />
          </Box>
        </Box>
      )}

      {/* Compute Profile Selector */}
      <Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)">
            Select SLURM Compute Profile
          </Text>
          <span
            style={{
              fontSize: "11px",
              color: "var(--color-fg-muted)",
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            Auto-provisioned via Slurm REST / Wasm Worker Pool
          </span>
        </Box>

        <ProfileGrid role="radiogroup" aria-label="SLURM Compute Profiles">
          {profiles.map((p) => {
            const isSelected = selectedProfile === p.id;
            const isRecommended = recommendedProfileId === p.id;
            return (
              <ProfileCard
                key={p.id}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                $selected={isSelected}
                onClick={() => setSelectedProfile(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedProfile(p.id);
                  }
                }}
              >
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2}>
                  <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                    <Text fontWeight="bold" fontSize="13px" color="var(--color-fg-default)">
                      {p.name}
                    </Text>
                    {isRecommended && (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: "999px",
                          background: "rgba(16, 185, 129, 0.16)",
                          color: "#10b981",
                          border: "1px solid rgba(16, 185, 129, 0.35)",
                        }}
                      >
                        ★ Recommended
                      </span>
                    )}
                  </Box>
                  <Box display="flex" alignItems="center" gap={1}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        fontFamily: "var(--font-mono, monospace)",
                        color: isSelected ? "var(--color-accent-purple, #8b5cf6)" : "var(--color-fg-muted)",
                      }}
                    >
                      {p.costCreditsPerHour} cr/hr
                    </span>
                    {isSelected && <CheckCircleFillIcon size={14} fill="var(--color-accent-purple, #8b5cf6)" />}
                  </Box>
                </Box>

                <Text fontSize="12px" color="var(--color-fg-muted)" style={{ lineHeight: 1.45 }}>
                  {p.description}
                </Text>

                <Box
                  display="flex"
                  gap={2}
                  mt={1}
                  pt={2}
                  borderTop="1px solid var(--color-border-muted, rgba(128, 128, 128, 0.15))"
                  fontSize="11px"
                  color="var(--color-fg-muted)"
                  flexWrap="wrap"
                  alignItems="center"
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <CpuIcon size={12} /> {p.cpus} vCPUs
                  </span>
                  <span>·</span>
                  <span>{Math.round(p.memoryMb / 1024)} GB RAM</span>
                  <span>·</span>
                  <span style={{ fontFamily: "var(--font-mono, monospace)" }}>--partition={p.partition}</span>
                  {p.gpus > 0 && (
                    <>
                      <span>·</span>
                      <span style={{ color: "#f59e0b", fontWeight: 600 }}>
                        <ZapIcon size={12} /> {p.gpus}x {p.gpuType?.toUpperCase()}
                      </span>
                    </>
                  )}
                </Box>
              </ProfileCard>
            );
          })}
        </ProfileGrid>
      </Box>

      {/* Wallet Summary (always rendered with loading/sign-in state when wallet is null) */}
      <Box
        p={3}
        borderRadius="10px"
        bg={isInsufficientBalance ? "rgba(248, 81, 73, 0.08)" : "var(--color-canvas-subtle, #161b22)"}
        border={`1px solid ${
          isInsufficientBalance ? "var(--color-danger-fg, #f85149)" : "var(--color-border-default, #30363d)"
        }`}
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap={2}
      >
        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          <FlameIcon
            size={16}
            fill={isInsufficientBalance ? "var(--ms-danger, #f85149)" : "var(--color-accent-emphasis, #06b6d4)"}
          />
          {wallet ? (
            <Text fontSize="13px" color="var(--color-fg-default)">
              Wallet Credit Balance: <strong>{wallet.creditBalance.toFixed(2)} credits</strong>
              {isInsufficientBalance && (
                <span style={{ color: "var(--color-danger-fg, #f85149)", marginLeft: "8px", fontWeight: 600 }}>
                  (Below min escrow — top up required)
                </span>
              )}
            </Text>
          ) : walletLoading ? (
            <Text fontSize="13px" color="var(--color-fg-muted)">
              Loading wallet credit balance...
            </Text>
          ) : (
            <Text fontSize="13px" color="var(--color-fg-muted)">
              Sign in to view wallet balance and launch cloud HPC jobs.
            </Text>
          )}
        </Box>
        <Box display="flex" alignItems="center" gap={3} flexWrap="wrap">
          <Text fontSize="12px" color="var(--color-fg-muted)">
            Min Escrow (3 min):{" "}
            <strong
              style={{ color: isInsufficientBalance ? "var(--color-danger-fg, #f85149)" : "var(--color-fg-default)" }}
            >
              ~{minEscrow.toFixed(2)} credits
            </strong>
          </Text>
          {isInsufficientBalance && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-topup"))}
              style={{
                background: "rgba(139, 92, 246, 0.16)",
                border: "1px solid rgba(139, 92, 246, 0.45)",
                borderRadius: "6px",
                padding: "4px 10px",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                color: "var(--color-accent-purple, #a855f7)",
              }}
            >
              Top Up Credits
            </button>
          )}
          {sbatchPreview && (
            <button
              type="button"
              onClick={() => setShowSbatch((v) => !v)}
              style={{
                background: "transparent",
                border: "1px solid var(--color-border-default)",
                borderRadius: "6px",
                padding: "4px 9px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                color: "var(--color-fg-default)",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              <CodeIcon size={12} />
              <span>{showSbatch ? "Hide #SBATCH Script" : "Preview #SBATCH Script"}</span>
            </button>
          )}
        </Box>
      </Box>

      {/* Expandable sbatch Preview */}
      {showSbatch && sbatchPreview && (
        <Box
          borderRadius="10px"
          border="1px solid var(--color-border-default, #30363d)"
          bg="var(--color-canvas-subtle, #161b22)"
          overflow="hidden"
        >
          <Box
            px={3}
            py={2}
            borderBottom="1px solid var(--color-border-default, #30363d)"
            display="flex"
            justifyContent="space-between"
            alignItems="center"
          >
            <Box display="flex" alignItems="center" gap={2}>
              <ServerIcon size={13} />
              <Text fontSize="11px" fontWeight="bold" style={{ fontFamily: "var(--font-mono, monospace)" }}>
                Generated Slurm Batch Manifest (job.sbatch)
              </Text>
            </Box>
            <Box display="flex" alignItems="center" gap={2}>
              {copyError && (
                <Text fontSize="11px" color="var(--color-danger-fg, #f85149)">
                  {copyError}
                </Text>
              )}
              <button
                type="button"
                onClick={() => void handleCopySbatch()}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border-default)",
                  borderRadius: "6px",
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "var(--color-fg-default)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                {copiedSbatch ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                <span>{copiedSbatch ? "Copied" : "Copy sbatch"}</span>
              </button>
            </Box>
          </Box>
          <pre
            style={{
              margin: 0,
              padding: "12px 14px",
              fontSize: "11.5px",
              lineHeight: 1.5,
              fontFamily: "var(--font-mono, monospace)",
              color: "var(--color-fg-default)",
              overflowX: "auto",
            }}
          >
            {sbatchPreview}
          </pre>
        </Box>
      )}
    </Box>
  );
};
