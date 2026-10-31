// SPDX-License-Identifier: AGPL-3.0-or-later

import { ServerIcon } from "@primer/octicons-react";
import { Heading, Label, Text } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import type { ClusterStatus } from "../types";

export interface ClusterTopologyTabProps {
  clusterInfo: ClusterStatus | null;
}

export const ClusterTopologyTab: React.FC<ClusterTopologyTabProps> = ({ clusterInfo }) => {
  const partitions = clusterInfo?.partitions || [];
  const nodes = clusterInfo?.nodes || [];

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
                HPC Simulation Cluster & Local WASM Orchestrator
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                Backend: {clusterInfo?.connected ? clusterInfo.backend || "Slurm" : "Local WASM Engine"} · Version:{" "}
                {clusterInfo?.connected ? clusterInfo.version || "Slurm 23.11" : "WASM Linear Arena"} · Total Nodes:{" "}
                {clusterInfo?.connected ? (clusterInfo.nodesCount ?? nodes.length) : 0}
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
          Studies against Models are portable across execution targets: run fast interactive pre-flight sweeps locally
          in WebAssembly (DAE arena, SUNDIALS CVODE/IDA, WebGPU ensemble kernel), or dispatch large-scale Monte Carlo,
          CalculiX Tet10 FEA, OpenFOAM, and SU2 RANS studies to Slurm compute partitions.
        </Text>
      </Box>

      {/* Partitions & Topology Grid */}
      <div>
        <Heading
          as="h3"
          style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px", color: "var(--color-text-primary)" }}
        >
          Compute Partitions & Execution Engines
        </Heading>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
            gap: "14px",
          }}
        >
          {partitions.length > 0 ? (
            partitions.map((part) => (
              <Box
                key={part.name}
                p={3}
                borderRadius="10px"
                style={{
                  background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
                  border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
                }}
              >
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text-primary)" }}>
                    {part.name}
                  </span>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      color: part.state === "UP" ? "var(--color-success-fg)" : "var(--color-text-muted)",
                      background: part.state === "UP" ? "rgba(16, 185, 129, 0.15)" : "rgba(148, 163, 184, 0.15)",
                      padding: "1px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    {part.state}
                  </span>
                </Box>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                  {part.label} — Solvers: {(part.solvers || []).join(", ")}
                </div>
                <div
                  style={{
                    marginTop: "12px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "12px",
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  <span>
                    Nodes:{" "}
                    <strong>
                      {part.nodesIdle}/{part.nodesTotal} Idle
                    </strong>
                  </span>
                  <span>
                    CPUs/Node: <strong>{part.cpusPerNode}</strong>
                  </span>
                  <span>
                    RAM: <strong>{part.memoryGb} GB</strong>
                  </span>
                  {part.gpus && (
                    <span>
                      GPUs: <strong>{part.gpus}</strong>
                    </span>
                  )}
                  <span>
                    Max Time: <strong>{part.maxTime}</strong>
                  </span>
                </div>
              </Box>
            ))
          ) : (
            <>
              {/* Fallback partition cards if backend returned legacy status */}
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
                    {clusterInfo?.connected ? "UP" : "STANDBY"}
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
                    Nodes: <strong>{clusterInfo?.connected ? (clusterInfo.nodesCount ?? 2) : 0}</strong>
                  </span>
                  <span>
                    Max Time: <strong>{clusterInfo?.maxTime ?? "04:00:00"}</strong>
                  </span>
                  <span>
                    State:{" "}
                    <strong
                      style={{ color: clusterInfo?.connected ? "var(--color-success-fg)" : "var(--color-text-muted)" }}
                    >
                      {clusterInfo?.connected ? "Idle / Ready" : "Standby"}
                    </strong>
                  </span>
                </div>
              </Box>

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
                    {clusterInfo?.connected ? "UP" : "STANDBY"}
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
                    GPUs: <strong>{clusterInfo?.gpus ?? "4x NVIDIA A100"}</strong>
                  </span>
                  <span>
                    VRAM: <strong>{clusterInfo?.vramPerNode ?? "320 GB"}</strong>
                  </span>
                  <span>
                    State:{" "}
                    <strong
                      style={{ color: clusterInfo?.connected ? "var(--color-success-fg)" : "var(--color-text-muted)" }}
                    >
                      {clusterInfo?.connected ? "Ready" : "Standby"}
                    </strong>
                  </span>
                </div>
              </Box>
            </>
          )}

          {/* Partition: wasm-edge (Always Active) */}
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
                wasm-edge (Zero-Latency Local)
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
              In-browser & local WebAssembly DAE kernel execution with direct linear CST lowering. Zero network latency.
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
                Threads: <strong>WebWorkers + SIMD</strong>
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

      {/* Compute Nodes Telemetry Table */}
      {nodes.length > 0 && (
        <div>
          <Heading
            as="h3"
            style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px", color: "var(--color-text-primary)" }}
          >
            Worker Nodes Telemetry ({nodes.length})
          </Heading>
          <Box
            borderRadius="10px"
            style={{
              background: "var(--color-bg-card, rgba(255, 255, 255, 0.03))",
              border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08))",
              overflowX: "auto",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--color-border-subtle)",
                    textAlign: "left",
                    color: "var(--color-text-muted)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <th style={{ padding: "10px 14px" }}>Node</th>
                  <th style={{ padding: "10px 14px" }}>Partition</th>
                  <th style={{ padding: "10px 14px" }}>State</th>
                  <th style={{ padding: "10px 14px" }}>CPU Allocation</th>
                  <th style={{ padding: "10px 14px" }}>Memory</th>
                  <th style={{ padding: "10px 14px" }}>Load Avg</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((node) => (
                  <tr
                    key={node.name}
                    style={{
                      borderBottom: "1px solid var(--color-border-subtle)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    <td style={{ padding: "10px 14px", fontWeight: 700 }}>{node.name}</td>
                    <td style={{ padding: "10px 14px" }}>{node.partition}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <Label variant={node.state === "IDLE" ? "success" : "attention"}>{node.state}</Label>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {node.cpusAlloc ?? (node.state === "IDLE" ? 0 : Math.ceil((node.cpus ?? 16) / 2))} /{" "}
                      {node.cpusTotal ?? node.cpus ?? 16} cores
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {node.memoryUsedGb ?? Math.round((node.memoryGb ?? 64) * (node.load ?? 0.2))} /{" "}
                      {node.memoryTotalGb ?? node.memoryGb ?? 64} GB
                    </td>
                    <td style={{ padding: "10px 14px" }}>{node.loadAvg ?? node.load ?? "0.10"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        </div>
      )}
    </Box>
  );
};
