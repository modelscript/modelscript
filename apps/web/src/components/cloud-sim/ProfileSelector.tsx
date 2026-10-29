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
import React, { useState } from "react";
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
  currentProfile,
  recommendedProfileId,
  sbatchPreview,
  hideModelHeader = false,
}) => {
  const [showSbatch, setShowSbatch] = useState(false);
  const [copiedSbatch, setCopiedSbatch] = useState(false);

  const handleCopySbatch = () => {
    if (!sbatchPreview) return;
    void navigator.clipboard.writeText(sbatchPreview);
    setCopiedSbatch(true);
    setTimeout(() => setCopiedSbatch(false), 2000);
  };

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

        <ProfileGrid>
          {profiles.map((p) => {
            const isSelected = selectedProfile === p.id;
            const isRecommended = recommendedProfileId === p.id;
            return (
              <ProfileCard key={p.id} $selected={isSelected} onClick={() => setSelectedProfile(p.id)}>
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

      {/* Wallet Summary */}
      {wallet && (
        <Box
          p={3}
          borderRadius="10px"
          bg="var(--color-canvas-subtle, #161b22)"
          border="1px solid var(--color-border-default, #30363d)"
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          gap={2}
        >
          <Box display="flex" alignItems="center" gap={2}>
            <FlameIcon size={16} fill="var(--color-accent-emphasis, #06b6d4)" />
            <Text fontSize="13px" color="var(--color-fg-default)">
              Wallet Credit Balance: <strong>{wallet.creditBalance.toFixed(2)} credits</strong>
            </Text>
          </Box>
          <Box display="flex" alignItems="center" gap={3}>
            <Text fontSize="12px" color="var(--color-fg-muted)">
              Est. Minimum Cost:{" "}
              <strong style={{ color: "var(--color-fg-default)" }}>
                ~{((currentProfile?.costCreditsPerHour ?? 0) / 60 || 0.1).toFixed(2)} credits
              </strong>
            </Text>
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
      )}

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
            <button
              type="button"
              onClick={handleCopySbatch}
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
