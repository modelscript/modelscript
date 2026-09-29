// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DigitalThreadExplorerViewer
 *
 * Interactive visual explorer for the multi-domain Digital Thread Hypergraph.
 * Renders cross-domain alignments across Requirements, SysML v2, Modelica,
 * CAD/SCAD, FEA, CFD, BOM, and Verification with live status indicators,
 * blast radius impact analysis, and SMT physics-simplex conflict reconciliation.
 */

import { AlertIcon, CheckCircleIcon, ClockIcon, GitBranchIcon, PlayIcon, SyncIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../../config";
import Box from "../Box";

export interface ThreadNode {
  domain: string;
  domainIndex: number;
  nodeId: number;
  name: string;
  status: "synced" | "stale" | "conflict" | "removed";
  uri?: string;
  line?: number;
  column?: number;
  properties?: Record<string, any>;
}

export interface ThreadItem {
  threadId: number | string;
  revision: number;
  status: "synced" | "stale" | "conflict" | "removed";
  nodes: ThreadNode[];
}

export interface ThreadGraphData {
  threads: ThreadItem[];
  domains: string[];
  summary: {
    totalThreads: number;
    synced: number;
    stale: number;
    conflict: number;
  };
}

export interface ConflictDiagnostic {
  conflictId: string;
  status: string;
  strategy: string;
  sourceProposal: { domain: string; value: number; unit: string };
  targetProposal: { domain: string; value: number; unit: string };
  physicsEnvelope: { min: number; max: number };
  simplexConsensus: number;
  recommendation: string;
}

interface DigitalThreadExplorerViewerProps {
  viewConfig?: any;
  isFullScreen?: boolean;
  onNodeSelected?: (node: ThreadNode) => void;
}

const DOMAIN_COLORS: Record<string, string> = {
  requirements: "#9c27b0",
  sysml2: "#2196f3",
  modelica: "#009688",
  cad: "#ff5722",
  scad: "#ff9800",
  fea: "#3f51b5",
  cfd: "#00bcd4",
  bom: "#795548",
  verification: "#4caf50",
};

export const DigitalThreadExplorerViewer: React.FC<DigitalThreadExplorerViewerProps> = ({
  isFullScreen,
  onNodeSelected,
}) => {
  const [data, setData] = useState<ThreadGraphData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [activeConflict, setActiveConflict] = useState<ConflictDiagnostic | null>(null);
  const [reconciling, setReconciling] = useState<boolean>(false);
  const [blastRadius, setBlastRadius] = useState<{ rootNode: string; impacted: Set<string> } | null>(null);
  const [customValueInput, setCustomValueInput] = useState<string>("");

  const loadGraph = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/threads/graph`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to load thread graph", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGraph();
  }, []);

  const handleDiagnoseConflict = async (conflictId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/threads/conflicts/diagnose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conflictId }),
      });
      if (res.ok) {
        const diag = await res.json();
        setActiveConflict(diag);
        setCustomValueInput(String(diag.simplexConsensus ?? 18.0));
      }
    } catch (e) {
      console.error("Failed to diagnose conflict", e);
    }
  };

  const handleReconcile = async (strategy: string, customVal?: number) => {
    if (!activeConflict) return;
    setReconciling(true);
    try {
      const res = await fetch(`${API_BASE_URL}/threads/conflicts/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conflictId: activeConflict.conflictId,
          strategy,
          customValue: customVal,
        }),
      });
      if (res.ok) {
        setActiveConflict(null);
        await loadGraph();
      }
    } catch (e) {
      console.error("Failed to reconcile conflict", e);
    } finally {
      setReconciling(false);
    }
  };

  const handleComputeBlastRadius = async (domain: string, nodeId: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/threads/blast-radius?domain=${domain}&nodeId=${nodeId}`);
      if (res.ok) {
        const result = await res.json();
        const set = new Set<string>();
        for (const item of result.impactedNodes || []) {
          set.add(`${item.domain}:${item.nodeId}`);
        }
        setBlastRadius({
          rootNode: `${domain}:${nodeId}`,
          impacted: set,
        });
      }
    } catch (e) {
      console.error("Failed to compute blast radius", e);
    }
  };

  const filteredThreads = useMemo(() => {
    if (!data) return [];
    if (selectedFilter === "all") return data.threads;
    return data.threads.filter((t) => t.status === selectedFilter);
  }, [data, selectedFilter]);

  const displayDomains = useMemo(() => {
    return ["requirements", "sysml2", "modelica", "cad", "fea", "cfd", "bom"];
  }, []);

  if (loading && !data) {
    return (
      <Box p={4} display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <Spinner size="medium" />
        <Text ml={3}>Loading Digital Thread Hypergraph...</Text>
      </Box>
    );
  }

  return (
    <Box
      p={isFullScreen ? 2 : 3}
      backgroundColor="var(--color-canvas-default)"
      color="var(--color-fg-default)"
      borderRadius={isFullScreen ? "0" : "8px"}
      border="1px solid var(--color-border-default)"
      sx={{ display: "flex", flexDirection: "column", gap: 3, overflowX: "auto" }}
    >
      {/* Header & Metric Badges */}
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
        <Box display="flex" alignItems="center" gap={2}>
          <GitBranchIcon size={20} fill="var(--color-accent-emphasis)" />
          <Text fontWeight="bold" fontSize="16px">
            Digital Thread Hypergraph
          </Text>
          <Text color="var(--color-fg-muted)" fontSize="12px">
            (16-Domain Linear Memory SoA)
          </Text>
        </Box>

        <Box display="flex" alignItems="center" gap={2}>
          <Button
            size="small"
            variant={selectedFilter === "all" ? "primary" : "invisible"}
            onClick={() => setSelectedFilter("all")}
          >
            All ({data?.summary?.totalThreads ?? 0})
          </Button>
          <Button
            size="small"
            variant={selectedFilter === "synced" ? "primary" : "invisible"}
            onClick={() => setSelectedFilter("synced")}
          >
            <CheckCircleIcon fill="#4caf50" /> Synced ({data?.summary?.synced ?? 0})
          </Button>
          <Button
            size="small"
            variant={selectedFilter === "stale" ? "primary" : "invisible"}
            onClick={() => setSelectedFilter("stale")}
          >
            <ClockIcon fill="#ff9800" /> Stale ({data?.summary?.stale ?? 0})
          </Button>
          <Button
            size="small"
            variant={selectedFilter === "conflict" ? "primary" : "invisible"}
            onClick={() => setSelectedFilter("conflict")}
          >
            <AlertIcon fill="#f44336" /> Conflicted ({data?.summary?.conflict ?? 0})
          </Button>
          <Button size="small" onClick={loadGraph}>
            <SyncIcon /> Refresh
          </Button>
        </Box>
      </Box>

      {/* Blast Radius Banner */}
      {blastRadius && (
        <Box
          p={2}
          backgroundColor="rgba(255, 152, 0, 0.12)"
          border="1px solid #ff9800"
          borderRadius="6px"
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <Text fontSize="13px" fontWeight="600" color="#ff9800">
            ⚠ Transitive Blast Radius for [{blastRadius.rootNode}]: {blastRadius.impacted.size} downstream dependencies
            impacted across the digital thread.
          </Text>
          <Button size="small" onClick={() => setBlastRadius(null)}>
            Clear Overlay
          </Button>
        </Box>
      )}

      {/* Swimlane Columns Header */}
      <Box
        display="grid"
        gridTemplateColumns={`repeat(${displayDomains.length}, minmax(180px, 1fr))`}
        gap={2}
        borderBottom="2px solid var(--color-border-default)"
        pb={2}
      >
        {displayDomains.map((dom) => (
          <Box key={dom} display="flex" alignItems="center" gap={1}>
            <span
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                backgroundColor: DOMAIN_COLORS[dom] || "#888",
                display: "inline-block",
              }}
            />
            <Text fontWeight="bold" fontSize="12px" textTransform="uppercase">
              {dom}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Thread Swimlane Rows */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minHeight: "350px" }}>
        {filteredThreads.map((thread) => {
          const isThreadConflicted = thread.status === "conflict";
          const isThreadStale = thread.status === "stale";

          return (
            <Box
              key={String(thread.threadId)}
              p={2}
              borderRadius="6px"
              backgroundColor={
                isThreadConflicted
                  ? "rgba(244, 67, 54, 0.05)"
                  : isThreadStale
                    ? "rgba(255, 152, 0, 0.04)"
                    : "var(--color-canvas-subtle)"
              }
              border={`1px solid ${
                isThreadConflicted ? "#f44336" : isThreadStale ? "#ff9800" : "var(--color-border-subtle)"
              }`}
              display="grid"
              gridTemplateColumns={`repeat(${displayDomains.length}, minmax(180px, 1fr))`}
              gap={2}
              alignItems="center"
            >
              {displayDomains.map((dom) => {
                const node = thread.nodes.find((n) => n.domain.toLowerCase() === dom);
                if (!node) {
                  return (
                    <Box
                      key={dom}
                      height="50px"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      color="var(--color-fg-subtle)"
                      fontSize="11px"
                      fontStyle="italic"
                    >
                      —
                    </Box>
                  );
                }

                const nodeKey = `${node.domain}:${node.nodeId}`;
                const isBlastImpacted = blastRadius?.impacted.has(nodeKey);
                const isBlastRoot = blastRadius?.rootNode === nodeKey;

                return (
                  <Box
                    key={dom}
                    p={2}
                    borderRadius="4px"
                    backgroundColor="var(--color-canvas-default)"
                    border={
                      isBlastRoot
                        ? "2px solid #ff9800"
                        : isBlastImpacted
                          ? "2px dashed #ff9800"
                          : "1px solid var(--color-border-default)"
                    }
                    boxShadow="0 1px 3px rgba(0,0,0,0.1)"
                    sx={{
                      cursor: "pointer",
                      transition: "transform 0.15s, border-color 0.15s",
                      "&:hover": { transform: "translateY(-1px)", borderColor: "var(--color-accent-emphasis)" },
                    }}
                    onClick={() => onNodeSelected?.(node)}
                  >
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <Text fontWeight="600" fontSize="11px" color="var(--color-fg-muted)">
                        #{node.nodeId}
                      </Text>
                      {node.status === "synced" && <CheckCircleIcon size={12} fill="#4caf50" />}
                      {node.status === "stale" && <ClockIcon size={12} fill="#ff9800" />}
                      {node.status === "conflict" && <AlertIcon size={12} fill="#f44336" />}
                    </Box>

                    <Text display="block" fontSize="12px" fontWeight="bold" mt={1} noWrap title={node.name}>
                      {node.name}
                    </Text>

                    {node.properties && (
                      <Box mt={1} fontSize="11px" color="var(--color-fg-muted)" fontFamily="monospace">
                        {Object.entries(node.properties).map(([k, v]) => (
                          <div key={k}>
                            {k}: {String(v)}
                          </div>
                        ))}
                      </Box>
                    )}

                    <Box display="flex" gap={1} mt={2}>
                      {node.status === "conflict" && (
                        <Button
                          size="small"
                          sx={{ fontSize: "10px", py: 0, px: 1, backgroundColor: "#f44336", color: "#fff" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDiagnoseConflict("conflict_bus_voltage");
                          }}
                        >
                          Resolve
                        </Button>
                      )}
                      <Button
                        size="small"
                        sx={{ fontSize: "10px", py: 0, px: 1 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleComputeBlastRadius(node.domain, node.nodeId);
                        }}
                      >
                        Blast
                      </Button>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>

      {/* Conflict Resolution Modal */}
      {activeConflict && (
        <Box
          sx={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
          onClick={() => setActiveConflict(null)}
        >
          <Box
            p={4}
            backgroundColor="var(--color-canvas-default)"
            borderRadius="8px"
            border="1px solid var(--color-border-default)"
            width="540px"
            maxWidth="90vw"
            onClick={(e) => e.stopPropagation()}
            sx={{ display: "flex", flexDirection: "column", gap: 3 }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center" gap={2}>
                <AlertIcon size={20} fill="#f44336" />
                <Text fontWeight="bold" fontSize="16px">
                  SMT Conflict Resolution: [{activeConflict.conflictId}]
                </Text>
              </Box>
              <Button size="small" variant="invisible" onClick={() => setActiveConflict(null)}>
                ✕
              </Button>
            </Box>

            <Text fontSize="13px" color="var(--color-fg-muted)">
              {activeConflict.recommendation}
            </Text>

            {/* Discrepancy Cards */}
            <Box display="grid" gridTemplateColumns="1fr 1fr" gap={2}>
              <Box p={3} backgroundColor="rgba(33, 150, 243, 0.08)" borderRadius="6px" border="1px solid #2196f3">
                <Text fontSize="11px" fontWeight="bold" color="#2196f3">
                  SOURCE ({activeConflict.sourceProposal.domain.toUpperCase()})
                </Text>
                <Text fontSize="20px" fontWeight="bold" display="block" mt={1}>
                  {activeConflict.sourceProposal.value} {activeConflict.sourceProposal.unit}
                </Text>
              </Box>

              <Box p={3} backgroundColor="rgba(0, 150, 136, 0.08)" borderRadius="6px" border="1px solid #009688">
                <Text fontSize="11px" fontWeight="bold" color="#009688">
                  TARGET ({activeConflict.targetProposal.domain.toUpperCase()})
                </Text>
                <Text fontSize="20px" fontWeight="bold" display="block" mt={1}>
                  {activeConflict.targetProposal.value} {activeConflict.targetProposal.unit}
                </Text>
              </Box>
            </Box>

            {/* SMT Physics Envelope */}
            <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="6px">
              <Text fontSize="12px" fontWeight="600" display="block" mb={1}>
                Physics Conservation Envelope: [{activeConflict.physicsEnvelope.min} -{" "}
                {activeConflict.physicsEnvelope.max} V]
              </Text>
              <Text fontSize="14px" fontWeight="bold" color="#4caf50">
                Calculated Simplex Consensus: {activeConflict.simplexConsensus} V
              </Text>
            </Box>

            {/* Reconciliation Actions */}
            <Box display="flex" flexDirection="column" gap={2}>
              <Button variant="primary" disabled={reconciling} onClick={() => handleReconcile("physics-simplex")}>
                {reconciling ? <Spinner size="small" /> : <PlayIcon />} Accept Physics Simplex (
                {activeConflict.simplexConsensus} V)
              </Button>
              <Box display="grid" gridTemplateColumns="1fr 1fr" gap={2}>
                <Button disabled={reconciling} onClick={() => handleReconcile("source-wins")}>
                  Source Wins ({activeConflict.sourceProposal.value} V)
                </Button>
                <Button disabled={reconciling} onClick={() => handleReconcile("target-wins")}>
                  Target Wins ({activeConflict.targetProposal.value} V)
                </Button>
              </Box>

              <Box display="flex" gap={2} mt={1}>
                <input
                  type="number"
                  placeholder="Custom value"
                  value={customValueInput}
                  onChange={(e) => setCustomValueInput(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    borderRadius: "4px",
                    border: "1px solid var(--color-border-default)",
                    backgroundColor: "var(--color-canvas-default)",
                    color: "var(--color-fg-default)",
                  }}
                />
                <Button
                  disabled={reconciling || !customValueInput}
                  onClick={() => handleReconcile("custom", parseFloat(customValueInput))}
                >
                  Apply Custom
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default DigitalThreadExplorerViewer;
