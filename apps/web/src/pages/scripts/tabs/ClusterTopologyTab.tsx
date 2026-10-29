// SPDX-License-Identifier: AGPL-3.0-or-later

import { ServerIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import type { ClusterStatus } from "../types";

export interface ClusterTopologyTabProps {
  clusterInfo: ClusterStatus | null;
}

export const ClusterTopologyTab: React.FC<ClusterTopologyTabProps> = ({ clusterInfo }) => {
  return (
    <Box display="flex" flexDirection="column" gap={4}>
      {/* Cluster Architecture Card */}
      <Box
        p={4}
        borderRadius="12px"
        style={{
          background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
          border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={3} mb={3}>
          <Box display="flex" alignItems="center" gap={3}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "10px",
                backgroundColor: "rgba(6, 182, 212, 0.12)",
                border: "1px solid rgba(6, 182, 212, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-accent-cyan)",
              }}
            >
              <ServerIcon size={22} />
            </div>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                HPC Simulation Cluster Orchestrator
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                Backend: {clusterInfo?.connected ? clusterInfo.backend || "Offline" : "Offline"} · Version:{" "}
                {clusterInfo?.connected ? clusterInfo.version || "N/A" : "N/A"}
              </div>
            </div>
          </Box>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 12px",
              borderRadius: "9999px",
              background: clusterInfo?.connected ? "rgba(16, 185, 129, 0.15)" : "rgba(6, 182, 212, 0.15)",
              color: clusterInfo?.connected ? "var(--color-success-fg)" : "var(--color-accent-cyan)",
              border: `1px solid ${clusterInfo?.connected ? "rgba(16, 185, 129, 0.4)" : "rgba(6, 182, 212, 0.4)"}`,
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              fontWeight: 700,
            }}
          >
            <div
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                backgroundColor: clusterInfo?.connected ? "var(--color-success-fg)" : "var(--color-accent-cyan)",
              }}
            />
            <span>
              {clusterInfo?.connected ? "Cluster Connected & Serving" : "Local WebAssembly Engine (Standalone Mode)"}
            </span>
          </div>
        </Box>

        <Text fontSize="13px" color="var(--color-text-muted)" style={{ lineHeight: 1.6 }}>
          ModelScript polyglot models can run directly in the browser via WebAssembly (DAE arena, SUNDIALS CVODE), or
          scale outward to high-performance compute clusters managed by Slurm. Multi-fidelity continuum simulations
          (Tet10 FEA, D3Q19 LBM, and compressible SU2) are automatically routed to allocated partitions based on memory
          and GPU availability.
        </Text>
      </Box>

      {/* Partitions & Topology Grid */}
      <div>
        <Heading
          as="h3"
          style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px", color: "var(--color-text-primary)" }}
        >
          Compute Partitions
        </Heading>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "14px",
          }}
        >
          {/* Partition 1: compute-standard */}
          <Box
            p={3}
            borderRadius="10px"
            style={{
              background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
              border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text-primary)" }}>
                compute-standard
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  color: clusterInfo?.connected ? "var(--color-success-fg)" : "var(--color-text-muted)",
                  background: clusterInfo?.connected ? "rgba(16, 185, 129, 0.15)" : "rgba(148, 163, 184, 0.15)",
                  padding: "1px 6px",
                  borderRadius: "4px",
                }}
              >
                {clusterInfo?.connected ? "UP" : "OFFLINE (Standalone Mode)"}
              </span>
            </Box>
            <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              General multi-core CPU solver pool for SUNDIALS, RK4, and Modelica DAE simulations.
            </div>
            <div
              style={{
                marginTop: "12px",
                display: "flex",
                gap: "16px",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-muted)",
              }}
            >
              <span>
                Nodes: <strong>{clusterInfo?.connected ? (clusterInfo.nodesCount ?? "N/A") : 0}</strong>
              </span>
              <span>
                Max Time: <strong>{clusterInfo?.connected ? ((clusterInfo as any).maxTime ?? "N/A") : "N/A"}</strong>
              </span>
              <span>
                State:{" "}
                <strong
                  style={{ color: clusterInfo?.connected ? "var(--color-success-fg)" : "var(--color-text-muted)" }}
                >
                  {clusterInfo?.connected ? "Idle / Ready" : "Offline"}
                </strong>
              </span>
            </div>
          </Box>

          {/* Partition 2: gpu-accelerated */}
          <Box
            p={3}
            borderRadius="10px"
            style={{
              background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
              border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text-primary)" }}>
                gpu-accelerated
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  color: clusterInfo?.connected ? "var(--color-success-fg)" : "var(--color-text-muted)",
                  background: clusterInfo?.connected ? "rgba(16, 185, 129, 0.15)" : "rgba(148, 163, 184, 0.15)",
                  padding: "1px 6px",
                  borderRadius: "4px",
                }}
              >
                {clusterInfo?.connected ? "UP" : "OFFLINE (Standalone Mode)"}
              </span>
            </Box>
            <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              Dedicated GPU / WebGPU batched nodes for SU2 CFD and large-scale Tet10 FEA inversions.
            </div>
            <div
              style={{
                marginTop: "12px",
                display: "flex",
                gap: "16px",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-muted)",
              }}
            >
              <span>
                GPUs: <strong>{clusterInfo?.connected ? ((clusterInfo as any).gpus ?? "N/A") : "N/A"}</strong>
              </span>
              <span>
                VRAM: <strong>{clusterInfo?.connected ? ((clusterInfo as any).vramPerNode ?? "N/A") : "N/A"}</strong>
              </span>
              <span>
                State:{" "}
                <strong
                  style={{ color: clusterInfo?.connected ? "var(--color-success-fg)" : "var(--color-text-muted)" }}
                >
                  {clusterInfo?.connected ? "Ready" : "Offline"}
                </strong>
              </span>
            </div>
          </Box>

          {/* Partition 3: wasm-edge */}
          <Box
            p={3}
            borderRadius="10px"
            style={{
              background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
              border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text-primary)" }}>
                wasm-edge (Zero-Latency)
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  color: "var(--color-accent-cyan)",
                  background: "rgba(6, 182, 212, 0.15)",
                  padding: "1px 6px",
                  borderRadius: "4px",
                }}
              >
                ACTIVE
              </span>
            </Box>
            <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              In-browser client-side WebAssembly kernel execution with direct linear CST lowering. Zero network latency.
            </div>
            <div
              style={{
                marginTop: "12px",
                display: "flex",
                gap: "16px",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-muted)",
              }}
            >
              <span>
                Threads: <strong>WebWorkers</strong>
              </span>
              <span>
                Latency: <strong>&lt;1 ms</strong>
              </span>
              <span>
                Tier: <strong style={{ color: "var(--color-accent-cyan)" }}>Free / Infinite</strong>
              </span>
            </div>
          </Box>
        </div>
      </div>
    </Box>
  );
};
