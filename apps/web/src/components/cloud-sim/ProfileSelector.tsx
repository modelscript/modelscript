// SPDX-License-Identifier: AGPL-3.0-or-later

import { CpuIcon, FlameIcon, ZapIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import type { ComputeProfileInfo, UserWalletInfo } from "../../api";
import Box from "../Box";
import { ProfileCard, ProfileGrid } from "./styles";

interface ProfileSelectorProps {
  modelName: string;
  setModelName: (val: string) => void;
  numberOfIntervals: number;
  setNumberOfIntervals: (val: number) => void;
  profiles: ComputeProfileInfo[];
  selectedProfile: string;
  setSelectedProfile: (val: string) => void;
  wallet: UserWalletInfo | null;
  currentProfile?: ComputeProfileInfo | undefined;
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
}) => {
  return (
    <>
      {/* Model and Intervals */}
      <Box display="flex" gap={3}>
        <Box flex={2}>
          <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={1} display="block">
            Target Model Name
          </Text>
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border)",
              background: "rgba(255, 255, 255, 0.04)",
              color: "var(--color-text-primary)",
              fontSize: "14px",
            }}
          />
        </Box>
        <Box flex={1}>
          <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={1} display="block">
            Intervals
          </Text>
          <input
            type="number"
            value={numberOfIntervals}
            onChange={(e) => setNumberOfIntervals(Number(e.target.value))}
            min={10}
            max={100000}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border)",
              background: "rgba(255, 255, 255, 0.04)",
              color: "var(--color-text-primary)",
              fontSize: "14px",
            }}
          />
        </Box>
      </Box>

      {/* Compute Profile Selector */}
      <Box>
        <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={2} display="block">
          Select SLURM Compute Profile
        </Text>
        <ProfileGrid>
          {profiles.map((p) => {
            const isSelected = selectedProfile === p.id;
            return (
              <ProfileCard key={p.id} $selected={isSelected} onClick={() => setSelectedProfile(p.id)}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Text fontWeight="bold" fontSize="13px">
                    {p.name}
                  </Text>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: isSelected ? "var(--color-accent-fg)" : "var(--color-fg-muted)",
                    }}
                  >
                    {p.costCreditsPerHour} credits/hr
                  </span>
                </Box>
                <Text fontSize="12px" color="var(--color-fg-muted)">
                  {p.description}
                </Text>
                <Box display="flex" gap={2} mt={1} fontSize="11px" color="var(--color-fg-muted)">
                  <span>
                    <CpuIcon size={12} /> {p.cpus} vCPUs
                  </span>
                  <span>{Math.round(p.memoryMb / 1024)} GB RAM</span>
                  {p.gpus > 0 && (
                    <span style={{ color: "var(--color-attention-fg)" }}>
                      <ZapIcon size={12} /> {p.gpus}x {p.gpuType?.toUpperCase()}
                    </span>
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
          borderRadius="8px"
          bg="rgba(255, 255, 255, 0.02)"
          border="1px solid var(--color-border)"
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box display="flex" alignItems="center" gap={2}>
            <FlameIcon size={16} fill="var(--color-accent-emphasis)" />
            <Text fontSize="13px">
              Wallet Credit Balance: <strong>{wallet.creditBalance.toFixed(2)} credits</strong>
            </Text>
          </Box>
          <Text fontSize="12px" color="var(--color-fg-muted)">
            Est. Minimum Cost: ~{((currentProfile?.costCreditsPerHour ?? 0) / 60 || 0.1).toFixed(2)} credits
          </Text>
        </Box>
      )}
    </>
  );
};
