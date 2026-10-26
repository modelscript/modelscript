// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, ClockIcon, CpuIcon, PlayIcon, ServerIcon, ZapIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import { MetricCard, pulseAnimation, SpinningIcon } from "../styles";
import type { ClusterStatus } from "../types";

export interface ScriptsHeaderHudProps {
  autoRefresh: boolean;
  setAutoRefresh: React.Dispatch<React.SetStateAction<boolean>>;
  isRefreshing: boolean;
  onRefresh: () => void;
  onLaunchClick: () => void;
  onTopUpClick: () => void;
  runningJobsCount: number;
  queuedJobsCount: number;
  completedJobsCount: number;
  clusterInfo: ClusterStatus | null;
  creditBalance: number;
}

export const ScriptsHeaderHud: React.FC<ScriptsHeaderHudProps> = ({
  autoRefresh,
  setAutoRefresh,
  isRefreshing,
  onRefresh,
  onLaunchClick,
  onTopUpClick,
  runningJobsCount,
  queuedJobsCount,
  completedJobsCount,
  clusterInfo,
  creditBalance,
}) => {
  return (
    <Box
      p={4}
      borderBottom="1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))"
      style={{
        background: "linear-gradient(180deg, rgba(6, 182, 212, 0.04) 0%, transparent 100%)",
      }}
    >
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={3}>
        <div>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "1px",
              textTransform: "uppercase",
              color: "var(--color-accent-cyan, #06b6d4)",
              fontFamily: "var(--font-mono, monospace)",
              marginBottom: "4px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <ServerIcon size={12} />
            <span>Cloud Compute &amp; HPC Orchestration</span>
          </div>
          <Heading
            as="h1"
            style={{ fontSize: "24px", fontWeight: 800, margin: 0, color: "var(--color-text-primary, #ffffff)" }}
          >
            Cloud Jobs &amp; HPC Queue
          </Heading>
          <Text
            style={{
              fontSize: "13px",
              color: "var(--color-text-muted, #8b949e)",
              marginTop: "4px",
              display: "block",
              maxWidth: "680px",
              lineHeight: 1.5,
            }}
          >
            Monitor real-time SUNDIALS CVODE trajectories, distributed SU2 CFD meshes, CalculiX structural FEA, and
            SLURM cluster pipelines.
          </Text>
        </div>

        {/* Action Toolbar */}
        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          {/* Auto-Refresh Toggle */}
          <button
            type="button"
            onClick={() => setAutoRefresh((prev) => !prev)}
            style={{
              background: autoRefresh ? "rgba(16, 185, 129, 0.12)" : "rgba(255, 255, 255, 0.04)",
              border: `1px solid ${autoRefresh ? "rgba(16, 185, 129, 0.3)" : "var(--color-border-glass, rgba(255, 255, 255, 0.1))"}`,
              color: autoRefresh ? "#34d399" : "var(--color-text-muted, #8b949e)",
              borderRadius: "8px",
              padding: "6px 12px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontFamily: "var(--font-mono, monospace)",
              transition: "all 0.15s ease",
            }}
            title={autoRefresh ? "Auto-refresh active (every 6s)" : "Auto-refresh paused"}
          >
            <div
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                backgroundColor: autoRefresh ? "#10b981" : "#6b7280",
                boxShadow: autoRefresh ? "0 0 8px #10b981" : "none",
              }}
            />
            <span>{autoRefresh ? "Live 6s" : "Paused"}</span>
          </button>

          {/* Manual Refresh */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            style={{
              background: "var(--color-bg-card, rgba(255, 255, 255, 0.05))",
              border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12))",
              color: "var(--color-text-primary, #ffffff)",
              borderRadius: "8px",
              padding: "6px 12px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              transition: "all 0.15s ease",
            }}
            title="Refresh queue status"
          >
            <SpinningIcon size={13} $isSpinning={isRefreshing} />
            <span>Refresh</span>
          </button>

          {/* Launch Job CTA */}
          <button
            type="button"
            onClick={onLaunchClick}
            style={{
              background:
                "linear-gradient(135deg, var(--color-accent-cyan, #06b6d4) 0%, var(--color-accent-purple, #6f42c1) 100%)",
              border: "none",
              color: "#ffffff",
              borderRadius: "8px",
              padding: "7px 16px",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              boxShadow: "0 2px 10px rgba(6, 182, 212, 0.3)",
              transition: "all 0.15s ease",
            }}
          >
            <PlayIcon size={14} />
            <span>Launch Simulation</span>
          </button>
        </Box>
      </Box>

      {/* ── Top Metric HUD Cards ──────────────────────────────────── */}
      <Box
        mt={4}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: "12px",
        }}
      >
        {/* Active Running */}
        <MetricCard>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
                letterSpacing: "0.5px",
              }}
            >
              Active Simulations
            </span>
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: runningJobsCount > 0 ? "var(--color-accent-cyan)" : "var(--color-text-muted)",
                boxShadow: runningJobsCount > 0 ? "0 0 10px var(--color-accent-cyan)" : "none",
                animation: runningJobsCount > 0 ? `${pulseAnimation} 1.5s infinite` : "none",
              }}
            />
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: runningJobsCount > 0 ? "var(--color-accent-cyan)" : "var(--color-text-primary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {runningJobsCount}
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
            {runningJobsCount === 1 ? "1 job computing on cluster" : `${runningJobsCount} jobs computing on cluster`}
          </div>
        </MetricCard>

        {/* Queued / Pending */}
        <MetricCard>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
                letterSpacing: "0.5px",
              }}
            >
              Pending / Queued
            </span>
            <ClockIcon size={14} style={{ color: "#f59e0b" }} />
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: queuedJobsCount > 0 ? "#f59e0b" : "var(--color-text-primary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {queuedJobsCount}
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Awaiting node partition allocation</div>
        </MetricCard>

        {/* Completed */}
        <MetricCard>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
                letterSpacing: "0.5px",
              }}
            >
              Completed Runs
            </span>
            <CheckCircleFillIcon size={14} style={{ color: "var(--color-status-verified, #10b981)" }} />
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "var(--color-status-verified, #10b981)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {completedJobsCount}
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Total successful verification runs</div>
        </MetricCard>

        {/* Cluster Status */}
        <MetricCard>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
                letterSpacing: "0.5px",
              }}
            >
              Cluster Health
            </span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: "4px",
                background: clusterInfo?.connected ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                color: clusterInfo?.connected ? "#34d399" : "#f87171",
                border: `1px solid ${clusterInfo?.connected ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
              }}
            >
              {clusterInfo?.connected ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
          <div
            style={{
              fontSize: "16px",
              fontWeight: 700,
              color: "var(--color-text-primary)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginTop: "4px",
            }}
          >
            <CpuIcon size={16} style={{ color: "var(--color-accent-purple, #a855f7)" }} />
            <span>
              {clusterInfo?.backend === "slurm-rest" || clusterInfo?.backend === "slurm"
                ? `${clusterInfo.nodesCount || 1} Slurm Nodes`
                : "Local WASM Solver"}
            </span>
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
            Backend: {clusterInfo?.backend || "local-process"} · {clusterInfo?.latencyMs || 8}ms ping
          </div>
        </MetricCard>

        {/* Compute Wallet & Quota */}
        <MetricCard>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
                letterSpacing: "0.5px",
              }}
            >
              Compute Wallet
            </span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: "4px",
                background: creditBalance > 5 ? "rgba(168, 85, 247, 0.15)" : "rgba(239, 68, 68, 0.15)",
                color: creditBalance > 5 ? "#c084fc" : "#f87171",
                border: `1px solid ${creditBalance > 5 ? "rgba(168, 85, 247, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
              }}
            >
              {creditBalance > 5 ? "ACTIVE" : "LOW CREDITS"}
            </span>
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "var(--color-accent-purple, #c084fc)",
              fontFamily: "var(--font-mono)",
              display: "flex",
              alignItems: "baseline",
              gap: "4px",
            }}
          >
            <span>{typeof creditBalance === "number" ? creditBalance.toFixed(1) : "0.0"}</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-muted)" }}>cr</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "2px" }}>
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              {runningJobsCount > 0
                ? `Est. burn: ~${(runningJobsCount * 0.5).toFixed(1)} cr/hr`
                : "Metered per core-hour"}
            </span>
            <button
              type="button"
              onClick={onTopUpClick}
              style={{
                background: "rgba(168, 85, 247, 0.15)",
                border: "1px solid rgba(168, 85, 247, 0.35)",
                color: "#d8b4fe",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
              }}
              title="Manage credits & billing ledger"
            >
              <ZapIcon size={10} />
              <span>Top Up</span>
            </button>
          </div>
        </MetricCard>
      </Box>
    </Box>
  );
};
