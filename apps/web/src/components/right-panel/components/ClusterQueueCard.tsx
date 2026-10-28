// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowRightIcon, PlayIcon, ServerIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ClusterStatus, UnifiedJob } from "../../../api";
import Box from "../../Box";
import { Card, CloudRunButton, SpinSyncIcon } from "../styles";

export interface ClusterQueueCardProps {
  clusterInfo: ClusterStatus | null;
  hpcJobs: UnifiedJob[];
  isHpcLoading: boolean;
  onRefresh: () => void;
  onOpenSimModal: () => void;
}

export const ClusterQueueCard: React.FC<ClusterQueueCardProps> = ({
  clusterInfo,
  hpcJobs,
  isHpcLoading,
  onRefresh,
  onOpenSimModal,
}) => {
  const navigate = useNavigate();

  return (
    <Card>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Link
          to="/jobs"
          style={{
            textDecoration: "none",
            color: "inherit",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
            <ServerIcon size={14} />
          </span>
          <Text
            style={{
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            Cloud &amp; HPC Queue
          </Text>
          <span style={{ color: "var(--color-text-muted)", display: "inline-flex" }}>
            <ArrowRightIcon size={11} />
          </span>
        </Link>
        <Box display="flex" alignItems="center" gap={2}>
          <span
            style={{
              fontSize: "10px",
              color: clusterInfo?.connected ? "var(--color-status-verified)" : "var(--color-accent-cyan)",
              fontFamily: "var(--font-mono)",
              background: clusterInfo?.connected ? "var(--status-verified-bg)" : "var(--status-solver-bg)",
              border: `1px solid ${clusterInfo?.connected ? "var(--status-verified-border)" : "var(--status-solver-border)"}`,
              padding: "1px 6px",
              borderRadius: "4px",
              fontWeight: 600,
            }}
          >
            ●{" "}
            {clusterInfo?.connected
              ? clusterInfo.backend === "slurm-rest" || clusterInfo.backend === "slurm"
                ? `${clusterInfo.nodesCount || 0} NODES`
                : "ONLINE"
              : "LOCAL WASM"}
          </span>
          <button
            onClick={onRefresh}
            disabled={isHpcLoading}
            title="Refresh queue"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <SpinSyncIcon size={12} $isSpinning={isHpcLoading} />
          </button>
        </Box>
      </Box>

      <Box display="flex" flexDirection="column" gap={3} style={{ fontSize: "12px" }}>
        {hpcJobs.length > 0 ? (
          hpcJobs.map((job) => {
            const isRunning = job.status === "running" || job.status === "processing";
            const isDone = job.status === "completed" || job.status === "SUCCESS";
            const isFailed = job.status === "failed" || job.status === "FAILED";
            const progress = Math.min(100, Math.max(0, job.progress || (isDone ? 100 : isRunning ? 55 : 0)));
            const strId = String(job.id);
            const routeId =
              strId.startsWith("cloud-") || strId.startsWith("cae-")
                ? strId
                : job.domain === "cfd" || job.domain === "fea"
                  ? `cae-${strId}`
                  : `cloud-${strId}`;
            const displayId = strId.replace(/^(cloud[-_]|cae[-_])+/, "").slice(0, 6);

            return (
              <div
                key={job.id}
                onClick={() => navigate(`/jobs/${routeId}`)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  cursor: "pointer",
                  padding: "4px",
                  borderRadius: "6px",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.03)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <span
                    style={{
                      fontWeight: 600,
                      color: "var(--color-text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "190px",
                    }}
                    title={job.name}
                  >
                    #{displayId} {job.name}
                  </span>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 600,
                      padding: "1px 5px",
                      borderRadius: "3px",
                      background: isDone
                        ? "rgba(16, 185, 129, 0.15)"
                        : isFailed
                          ? "rgba(239, 68, 68, 0.15)"
                          : isRunning
                            ? "rgba(6, 182, 212, 0.15)"
                            : "rgba(245, 158, 11, 0.15)",
                      color: isDone
                        ? "var(--color-status-verified)"
                        : isFailed
                          ? "#ef4444"
                          : isRunning
                            ? "var(--color-accent-cyan)"
                            : "#f59e0b",
                    }}
                  >
                    {job.status.toUpperCase()}
                  </span>
                </Box>

                <div
                  style={{
                    height: "4px",
                    background: "var(--color-border)",
                    borderRadius: "9999px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${progress}%`,
                      background: isFailed ? "#ef4444" : isDone ? "var(--color-status-verified)" : "var(--gradient-ai)",
                      borderRadius: "9999px",
                      boxShadow: isRunning ? "0 0 8px rgba(6, 182, 212, 0.5)" : "none",
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>

                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>
                    {job.domain.toUpperCase()} · {job.profile || "standard"}
                  </span>
                  {job.costCredits != null && (
                    <span style={{ fontSize: "10px", color: "var(--color-accent-purple)" }}>
                      {job.costCredits.toFixed(2)} cr
                    </span>
                  )}
                </Box>
              </div>
            );
          })
        ) : (
          <Box display="flex" flexDirection="column" alignItems="center" py={3} textAlign="center" gap={2}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                background: "rgba(6, 182, 212, 0.08)",
                border: "1px solid rgba(6, 182, 212, 0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-accent-cyan)",
              }}
            >
              <ServerIcon size={18} />
            </div>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>
              {clusterInfo?.connected ? "Cluster Ready & Idle" : "Local WASM Solver Ready"}
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", maxWidth: 220, lineHeight: 1.4 }}>
              {clusterInfo?.connected
                ? "No active simulations. Run batched SUNDIALS CVODE, SU2 CFD, or CalculiX FEA."
                : "Zero-latency in-browser DAE solver active. Scale to Slurm HPC for distributed sweeps."}
            </div>
            <CloudRunButton onClick={onOpenSimModal}>
              <PlayIcon size={12} />
              <span>Launch Cloud Run</span>
            </CloudRunButton>
          </Box>
        )}

        <Box
          mt={1}
          style={{ paddingTop: "8px", borderTop: "1px solid var(--color-border-subtle)" }}
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <Link
            to="/jobs"
            style={{
              color: "var(--color-accent-cyan)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              fontWeight: 600,
            }}
          >
            <span>Open Job Queue &amp; Clusters</span>
            <ArrowRightIcon size={10} />
          </Link>
          <button
            onClick={onOpenSimModal}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
            }}
          >
            + New
          </button>
        </Box>
      </Box>
    </Card>
  );
};
