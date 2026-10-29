// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  ChevronUpIcon,
  DatabaseIcon,
  MoonIcon,
  PlusIcon,
  ShieldLockIcon,
  SunIcon,
  SyncIcon,
  XIcon,
  ZapIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useState } from "react";
import styled, { css, keyframes } from "styled-components";
import { getClusterStatus, topUpCredits, type ClusterStatus } from "../api";
import { useAuth } from "../AuthContext";
import { useFeatureFlags } from "../FeatureFlagContext";
import { useTheme } from "../theme";

export interface DevModeBarProps {
  isExpanded: boolean;
  onToggleExpanded: (expanded: boolean) => void;
  onOpenFlagsModal: () => void;
  onOpenResetDbDialog: () => void;
  onOpenTopUpModal: () => void;
  clusterStatus: ClusterStatus | null;
  onClusterStatusChange: (status: ClusterStatus) => void;
}

interface DevPersona {
  username: string;
  email: string;
  initial: string;
  roleLabel?: string | undefined;
}

const DEV_PERSONAS: DevPersona[] = [
  { username: "omar", email: "omar@modelscript.org", initial: "O", roleLabel: "ADMIN" },
  { username: "elena_vance", email: "elena.vance@aether-propulsion.aero", initial: "E", roleLabel: "AERO" },
  { username: "marcus_chen", email: "m.chen@pacific-grid.energy", initial: "M", roleLabel: "GRID" },
  { username: "claire_dubois", email: "claire.dubois@velox-autonomy.eu", initial: "C", roleLabel: "MBSE" },
  { username: "dev", email: "dev@modelscript.org", initial: "D", roleLabel: "DEV" },
];

const pulseGlow = keyframes`
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.55;
    transform: scale(0.92);
  }
`;

const spinAnim = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

const TopBarRoot = styled.header`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  z-index: 1000;
  background: linear-gradient(
    90deg,
    rgba(76, 29, 149, 0.94) 0%,
    rgba(109, 40, 217, 0.94) 50%,
    rgba(88, 28, 135, 0.94) 100%
  );
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(192, 132, 252, 0.32);
  box-shadow:
    0 4px 20px rgba(15, 23, 42, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.14);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  box-sizing: border-box;
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  user-select: none;
`;

const TopBarInner = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 1380px;
  gap: 12px;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const SectionGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const BrandBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 9999px;
  background: rgba(15, 23, 42, 0.35);
  border: 1px solid rgba(216, 180, 254, 0.35);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #f3e8ff;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
`;

const StatusDot = styled.span<{ $color: string; $pulse?: boolean | undefined }>`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: ${(p) => p.$color};
  box-shadow: 0 0 8px ${(p) => p.$color};
  display: inline-block;
  flex-shrink: 0;
  ${(p) =>
    p.$pulse &&
    css`
      animation: ${pulseGlow} 2.2s ease-in-out infinite;
    `}
`;

const ControlPill = styled.button<{ $highlight?: "amber" | "emerald" | "none" | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;

  ${(p) =>
    p.$highlight === "amber"
      ? css`
          background: rgba(245, 158, 11, 0.28);
          color: #fef08a;
          border: 1px solid rgba(251, 191, 36, 0.65);
          &:hover {
            background: rgba(245, 158, 11, 0.38);
          }
        `
      : p.$highlight === "emerald"
        ? css`
            background: rgba(16, 185, 129, 0.28);
            color: #a7f3d0;
            border: 1px solid rgba(52, 211, 153, 0.65);
            &:hover {
              background: rgba(16, 185, 129, 0.38);
            }
          `
        : css`
            background: rgba(255, 255, 255, 0.13);
            color: #f8fafc;
            border: 1px solid rgba(255, 255, 255, 0.18);
            &:hover {
              background: rgba(255, 255, 255, 0.22);
              border-color: rgba(255, 255, 255, 0.32);
            }
          `}

  &:active {
    transform: translateY(0.5px);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const SpinIconWrapper = styled.span<{ $spinning?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  ${(p) =>
    p.$spinning &&
    css`
      animation: ${spinAnim} 0.8s linear infinite;
    `}
`;

const Divider = styled.span`
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.2);
  display: inline-block;
  flex-shrink: 0;
`;

const SegmentedGroup = styled.div`
  display: inline-flex;
  align-items: center;
  background: rgba(15, 23, 42, 0.32);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 7px;
  padding: 2px;
  gap: 2px;
`;

const PersonaButton = styled.button<{ $active?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 5px;
  border: none;
  font-size: 11.5px;
  font-weight: ${(p) => (p.$active ? 700 : 500)};
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
  color: ${(p) => (p.$active ? "#3b0764" : "rgba(255, 255, 255, 0.85)")};
  background: ${(p) => (p.$active ? "#ffffff" : "transparent")};
  box-shadow: ${(p) => (p.$active ? "0 1px 4px rgba(0, 0, 0, 0.25)" : "none")};

  &:hover {
    color: ${(p) => (p.$active ? "#3b0764" : "#ffffff")};
    background: ${(p) => (p.$active ? "#ffffff" : "rgba(255, 255, 255, 0.14)")};
  }

  &:disabled {
    opacity: 0.6;
    cursor: wait;
  }
`;

const PersonaInitial = styled.span<{ $active?: boolean | undefined }>`
  width: 15px;
  height: 15px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9.5px;
  font-weight: 800;
  background: ${(p) => (p.$active ? "#7c3aed" : "rgba(255, 255, 255, 0.22)")};
  color: #ffffff;
`;

const RoleMicroBadge = styled.span<{ $active?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 1px 4px;
  border-radius: 3px;
  background: ${(p) => (p.$active ? "rgba(124, 58, 237, 0.16)" : "rgba(255, 255, 255, 0.16)")};
  color: ${(p) => (p.$active ? "#6d28d9" : "#e9d5ff")};
`;

const CounterBadge = styled.span`
  background: #f59e0b;
  color: #0f172a;
  border-radius: 9999px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 800;
  line-height: 15px;
  display: inline-flex;
  align-items: center;
`;

const InlineClearBtn = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  margin-left: 2px;
  background: rgba(0, 0, 0, 0.25);
  color: #fef08a;
  transition: background 0.15s ease;

  &:hover {
    background: rgba(239, 68, 68, 0.8);
    color: #ffffff;
  }
`;

const IconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.13);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #ffffff;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.24);
    border-color: rgba(255, 255, 255, 0.35);
  }
`;

const FloatingPill = styled.div`
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 1000;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border-radius: 9999px;
  background: linear-gradient(135deg, rgba(88, 28, 135, 0.94) 0%, rgba(109, 40, 217, 0.94) 100%);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(192, 132, 252, 0.45);
  box-shadow:
    0 8px 24px rgba(15, 23, 42, 0.5),
    0 0 16px rgba(139, 92, 246, 0.35);
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;

  &:hover {
    transform: translateY(-1px);
    box-shadow:
      0 10px 28px rgba(15, 23, 42, 0.6),
      0 0 22px rgba(139, 92, 246, 0.55);
  }

  @media (max-width: 500px) {
    bottom: 72px;
    right: 12px;
  }
`;

export const DevModeBar: React.FC<DevModeBarProps> = ({
  isExpanded,
  onToggleExpanded,
  onOpenFlagsModal,
  onOpenResetDbDialog,
  onOpenTopUpModal,
  clusterStatus,
  onClusterStatusChange,
}) => {
  const { user, isAdmin, login, logout, creditBalance, refreshWallet } = useAuth();
  const { overrides, resetAllOverrides } = useFeatureFlags();
  const { theme, toggleTheme } = useTheme();

  const [switchingEmail, setSwitchingEmail] = useState<string | null>(null);
  const [isRefreshingCluster, setIsRefreshingCluster] = useState(false);
  const [isBoostingCredits, setIsBoostingCredits] = useState(false);
  const [creditBoostFeedback, setCreditBoostFeedback] = useState(false);

  const activeOverrideCount = Object.keys(overrides).length;

  const fetchCluster = useCallback(async () => {
    setIsRefreshingCluster(true);
    try {
      const data = await getClusterStatus();
      onClusterStatusChange(data);
    } catch {
      // Handled inside getClusterStatus
    } finally {
      setIsRefreshingCluster(false);
    }
  }, [onClusterStatusChange]);

  useEffect(() => {
    if (!clusterStatus) {
      void fetchCluster();
    }
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchCluster();
      }
    }, 20000);
    return () => clearInterval(interval);
  }, [clusterStatus, fetchCluster]);

  const handlePersonaSwitch = async (persona: DevPersona) => {
    if (user?.email === persona.email || switchingEmail) return;
    setSwitchingEmail(persona.email);
    try {
      await login(persona.email, "password");
    } catch {
      // Fallback if seed account isn't created yet
    } finally {
      setSwitchingEmail(null);
    }
  };

  const handleQuickTopUp = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user || isBoostingCredits) return;
    setIsBoostingCredits(true);
    try {
      await topUpCredits(100);
      await refreshWallet();
      setCreditBoostFeedback(true);
      setTimeout(() => setCreditBoostFeedback(false), 1600);
    } catch {
      onOpenTopUpModal();
    } finally {
      setIsBoostingCredits(false);
    }
  };

  const clusterColor = !clusterStatus ? "#f59e0b" : clusterStatus.connected ? "#10b981" : "#ef4444";

  const clusterLabel = !clusterStatus
    ? "API..."
    : clusterStatus.connected
      ? clusterStatus.backend === "slurm-rest" || clusterStatus.backend === "slurm"
        ? `SLURM${clusterStatus.nodesCount > 0 ? ` (${clusterStatus.nodesCount})` : ""}`
        : "API READY"
      : "API OFFLINE";

  const isPresetUser = Boolean(user && DEV_PERSONAS.some((p) => p.email === user.email));

  if (!isExpanded) {
    return (
      <FloatingPill
        onClick={() => onToggleExpanded(true)}
        title="Expand Dev Mode Toolbar (Ctrl+Shift+D)"
        role="button"
        aria-label="Expand Dev Mode Toolbar"
      >
        <StatusDot $color={clusterColor} $pulse={Boolean(clusterStatus?.connected)} />
        <span style={{ letterSpacing: "0.05em" }}>DEV</span>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            background: "rgba(15, 23, 42, 0.35)",
            padding: "2px 7px",
            borderRadius: "9999px",
            color: "#e9d5ff",
          }}
        >
          {user ? `@${user.username}` : "Guest"}
        </span>
        {activeOverrideCount > 0 && (
          <CounterBadge title={`${activeOverrideCount} active feature flag overrides`}>
            🚩 {activeOverrideCount}
          </CounterBadge>
        )}
      </FloatingPill>
    );
  }

  return (
    <TopBarRoot role="region" aria-label="Developer Mode Toolbar">
      <TopBarInner>
        {/* Left: Dev Brand + Live Cluster/API Health + DB Reload */}
        <SectionGroup>
          <BrandBadge title="ModelScript Development Mode">
            <StatusDot $color="#c084fc" $pulse />
            <span>DEV MODE</span>
          </BrandBadge>

          <ControlPill
            onClick={() => void fetchCluster()}
            title={
              clusterStatus
                ? `Backend: ${clusterStatus.backend} | Connected: ${clusterStatus.connected} | Latency: ${clusterStatus.latencyMs}ms (Click to refresh)`
                : "Checking API & compute cluster health..."
            }
          >
            <StatusDot $color={clusterColor} $pulse={Boolean(clusterStatus?.connected)} />
            <span>{clusterLabel}</span>
            {clusterStatus?.connected && clusterStatus.latencyMs > 0 && (
              <span style={{ opacity: 0.75, fontSize: "10.5px", fontFamily: "var(--font-mono, monospace)" }}>
                {clusterStatus.latencyMs}ms
              </span>
            )}
            <SpinIconWrapper $spinning={isRefreshingCluster} style={{ opacity: 0.75 }}>
              <SyncIcon size={11} />
            </SpinIconWrapper>
          </ControlPill>

          <ControlPill onClick={onOpenResetDbDialog} title="Reset and re-seed development database">
            <DatabaseIcon size={12} />
            <span>Reload DB</span>
          </ControlPill>

          {/* Feature Flags with inline quick-clear */}
          <ControlPill
            $highlight={activeOverrideCount > 0 ? "amber" : "none"}
            onClick={onOpenFlagsModal}
            title="Configure Developer Feature Flags & Toggles"
          >
            <span>🚩 Flags</span>
            {activeOverrideCount > 0 && (
              <>
                <CounterBadge>{activeOverrideCount}</CounterBadge>
                <InlineClearBtn
                  role="button"
                  tabIndex={0}
                  title="Reset all feature flag overrides"
                  onClick={(e) => {
                    e.stopPropagation();
                    resetAllOverrides();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      resetAllOverrides();
                    }
                  }}
                >
                  <XIcon size={10} />
                </InlineClearBtn>
              </>
            )}
          </ControlPill>

          {/* Instant Credit Wallet & Sandbox Boost */}
          {user && (
            <SegmentedGroup>
              <PersonaButton
                onClick={onOpenTopUpModal}
                title="Compute Wallet Balance (Click to open Top-Up modal)"
                style={{ color: "#f3e8ff" }}
              >
                <ZapIcon size={12} />
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}>
                  {creditBalance.toFixed(1)} cr
                </span>
              </PersonaButton>
              <PersonaButton
                onClick={(e) => void handleQuickTopUp(e)}
                disabled={isBoostingCredits}
                title="Instant +100 credits sandbox top-up"
                style={{
                  background: creditBoostFeedback ? "rgba(16, 185, 129, 0.35)" : "rgba(255, 255, 255, 0.14)",
                  color: creditBoostFeedback ? "#a7f3d0" : "#ffffff",
                  fontWeight: 700,
                }}
              >
                {creditBoostFeedback ? (
                  <>
                    <CheckIcon size={11} />
                    <span>+100</span>
                  </>
                ) : (
                  <>
                    <PlusIcon size={11} />
                    <span>100</span>
                  </>
                )}
              </PersonaButton>
            </SegmentedGroup>
          )}
        </SectionGroup>

        {/* Right: Persona Switcher + Theme + Collapse */}
        <SectionGroup>
          <span style={{ fontSize: "11px", opacity: 0.8, fontWeight: 500 }}>{user ? "Persona:" : "Login as:"}</span>

          <SegmentedGroup>
            {DEV_PERSONAS.map((persona) => {
              const isActive = user?.email === persona.email;
              const isSwitching = switchingEmail === persona.email;
              return (
                <PersonaButton
                  key={persona.email}
                  $active={isActive}
                  disabled={isSwitching}
                  onClick={() => void handlePersonaSwitch(persona)}
                  title={
                    isActive
                      ? `Logged in as @${persona.username} (${persona.email})`
                      : `Switch immediately to @${persona.username} (${persona.email})`
                  }
                >
                  <PersonaInitial $active={isActive}>{persona.initial}</PersonaInitial>
                  <span>@{persona.username}</span>
                  {persona.roleLabel && (
                    <RoleMicroBadge $active={isActive}>
                      <ShieldLockIcon size={9} />
                      {persona.roleLabel}
                    </RoleMicroBadge>
                  )}
                </PersonaButton>
              );
            })}

            {user && !isPresetUser && (
              <PersonaButton $active title={`Logged in as ${user.email}`}>
                <PersonaInitial $active>{(user.username[0] || "U").toUpperCase()}</PersonaInitial>
                <span>@{user.username}</span>
                {isAdmin && (
                  <RoleMicroBadge $active>
                    <ShieldLockIcon size={9} />
                    ADMIN
                  </RoleMicroBadge>
                )}
              </PersonaButton>
            )}
          </SegmentedGroup>

          {user && (
            <ControlPill onClick={() => logout()} title={`Sign out (@${user.username})`}>
              <span>Logout</span>
            </ControlPill>
          )}

          <Divider />

          <IconBtn
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Theme`}
            aria-label="Toggle Theme"
          >
            {theme === "dark" ? <SunIcon size={14} /> : <MoonIcon size={14} />}
          </IconBtn>

          <IconBtn
            onClick={() => onToggleExpanded(false)}
            title="Minimize Dev Bar to corner pill (Ctrl+Shift+D)"
            aria-label="Minimize Dev Mode Header"
          >
            <ChevronUpIcon size={15} />
          </IconBtn>
        </SectionGroup>
      </TopBarInner>
    </TopBarRoot>
  );
};

export default DevModeBar;
