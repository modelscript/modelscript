// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const vscode = (window as any).acquireVsCodeApi?.();

export interface ThreadNode {
  nodeId: string;
  name: string;
  domain: string;
  status: "synced" | "stale" | "conflict" | "unverified";
  uri?: string;
  line?: number;
  column?: number;
  properties?: Record<string, unknown>;
  diagnostic?: string;
}

export interface ThreadSlotItem {
  slot?: number;
  status: "synced" | "stale" | "conflict" | "unverified";
  nodes: ThreadNode[];
}

export interface ThreadGraphData {
  syncedCount?: number;
  staleCount?: number;
  conflictCount?: number;
  threadItems?: ThreadSlotItem[];
}

export interface BlastRadiusResult {
  rootNodeId?: string;
  impactedNodeIds?: string[];
  description?: string;
}

const DOMAIN_COLUMNS = [
  { id: "requirements", label: "Requirements" },
  { id: "sysml2", label: "Architecture (SysML)" },
  { id: "modelica", label: "Physics (Modelica)" },
  { id: "cad", label: "Geometry (CAD)" },
  { id: "fea", label: "Structural (FEA)" },
  { id: "cfd", label: "Fluids (CFD)" },
] as const;

export function ThreadExplorerApp() {
  const [graphData, setGraphData] = useState<ThreadGraphData>({
    syncedCount: 0,
    staleCount: 0,
    conflictCount: 0,
    threadItems: [],
  });
  const [blastRadius, setBlastRadius] = useState<BlastRadiusResult | null>(null);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg) return;
      switch (msg.type) {
        case "graphData":
          if (msg.data) setGraphData(msg.data);
          break;
        case "blastRadiusData":
          if (msg.radius) setBlastRadius(msg.radius);
          break;
        case "threadStatusChanged":
          vscode?.postMessage({ type: "refresh" });
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    vscode?.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const impactedSet = useMemo(() => {
    if (!blastRadius?.impactedNodeIds) return new Set<string>();
    return new Set(blastRadius.impactedNodeIds);
  }, [blastRadius]);

  const nodesByDomain = useMemo(() => {
    const map = new Map<string, ThreadNode[]>();
    for (const col of DOMAIN_COLUMNS) {
      map.set(col.id, []);
    }

    const items = graphData.threadItems || [];
    for (const item of items) {
      for (const node of item.nodes || []) {
        const domain = (node.domain || "requirements").toLowerCase();
        const list = map.get(domain) ?? map.get("requirements")!;
        list.push(node);
      }
    }

    return map;
  }, [graphData]);

  const handleGoToSource = (node: ThreadNode) => {
    vscode?.postMessage({
      type: "goToSource",
      uri: node.uri,
      line: node.line,
      column: node.column,
      name: node.name,
    });
  };

  const handleBlastRadius = (node: ThreadNode) => {
    vscode?.postMessage({
      type: "getBlastRadius",
      domain: node.domain,
      nodeId: node.nodeId,
    });
  };

  return (
    <div
      style={{
        padding: "16px",
        fontFamily: "var(--vscode-font-family, -apple-system, sans-serif)",
        color: "var(--vscode-editor-foreground, #ccc)",
        background: "var(--vscode-editor-background, #1e1e1e)",
        minHeight: "100vh",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--vscode-panel-border, #3c3c3c)",
          marginBottom: "20px",
        }}
      >
        <div>
          <h2
            style={{
              margin: "0 0 6px 0",
              fontSize: "1.25rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            🕸 Digital Thread Hypergraph Explorer
          </h2>
          <div style={{ display: "flex", gap: "12px", fontSize: "0.85rem" }}>
            <span
              style={{
                padding: "3px 8px",
                borderRadius: "12px",
                fontWeight: 600,
                background: "rgba(76, 175, 80, 0.15)",
                color: "#4caf50",
                border: "1px solid #4caf50",
              }}
            >
              ● {graphData.syncedCount ?? 0} Synced
            </span>
            <span
              style={{
                padding: "3px 8px",
                borderRadius: "12px",
                fontWeight: 600,
                background: "rgba(255, 152, 0, 0.15)",
                color: "#ff9800",
                border: "1px solid #ff9800",
              }}
            >
              ● {graphData.staleCount ?? 0} Stale
            </span>
            <span
              style={{
                padding: "3px 8px",
                borderRadius: "12px",
                fontWeight: 600,
                background: "rgba(244, 67, 54, 0.15)",
                color: "#f44336",
                border: "1px solid #f44336",
              }}
            >
              ● {graphData.conflictCount ?? 0} Divergences
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => vscode?.postMessage({ type: "exportProv" })}
            style={{
              background: "var(--vscode-button-secondaryBackground, #3a3d41)",
              color: "var(--vscode-button-secondaryForeground, #fff)",
              border: "none",
              borderRadius: "4px",
              padding: "6px 12px",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            📜 PROV-O Audit
          </button>
          <button
            onClick={() => vscode?.postMessage({ type: "runVerif" })}
            style={{
              background: "var(--vscode-button-secondaryBackground, #3a3d41)",
              color: "var(--vscode-button-secondaryForeground, #fff)",
              border: "none",
              borderRadius: "4px",
              padding: "6px 12px",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            ⚡ V-Cycle Verify
          </button>
          <button
            onClick={() => vscode?.postMessage({ type: "refresh" })}
            style={{
              background: "var(--vscode-button-background, #0e639c)",
              color: "var(--vscode-button-foreground, #fff)",
              border: "none",
              borderRadius: "4px",
              padding: "6px 12px",
              fontSize: "0.85rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            🔄 Refresh
          </button>
        </div>
      </header>

      {blastRadius && (
        <div
          style={{
            background: "rgba(255, 152, 0, 0.12)",
            border: "1px solid #ff9800",
            padding: "10px 14px",
            borderRadius: "6px",
            marginBottom: "16px",
            fontSize: "0.9rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <strong>🔥 Blast Radius Analysis Active:</strong>{" "}
            <span>{blastRadius.description || "Inspecting impact across domains."}</span>
          </div>
          <button
            onClick={() => setBlastRadius(null)}
            style={{
              fontSize: "0.75rem",
              padding: "3px 8px",
              borderRadius: "4px",
              background: "rgba(255, 255, 255, 0.1)",
              color: "var(--vscode-editor-foreground, #ccc)",
              border: "none",
              cursor: "pointer",
            }}
          >
            ✕ Clear Filter
          </button>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(220px, 1fr))",
          gap: "16px",
          overflowX: "auto",
        }}
      >
        {DOMAIN_COLUMNS.map((col) => {
          const nodes = nodesByDomain.get(col.id) || [];
          return (
            <div
              key={col.id}
              style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid var(--vscode-panel-border, #3c3c3c)",
                borderRadius: "8px",
                padding: "12px",
                minHeight: "480px",
              }}
            >
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  paddingBottom: "8px",
                  borderBottom: "2px solid var(--vscode-panel-border, #3c3c3c)",
                  marginBottom: "12px",
                  color: "var(--vscode-descriptionForeground, #888)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>{col.label}</span>
                <span>({nodes.length})</span>
              </div>

              <div>
                {nodes.map((node) => {
                  const isRoot = blastRadius?.rootNodeId === node.nodeId;
                  const isImpacted = impactedSet.has(node.nodeId);
                  const isDimmed = blastRadius !== null && !isRoot && !isImpacted;

                  const statusColor =
                    node.status === "synced"
                      ? "#4caf50"
                      : node.status === "stale"
                        ? "#ff9800"
                        : node.status === "conflict"
                          ? "#f44336"
                          : "#9c27b0";

                  return (
                    <div
                      key={node.nodeId}
                      style={{
                        background: "var(--vscode-sideBar-background, #252526)",
                        border: "1px solid var(--vscode-panel-border, #3c3c3c)",
                        borderLeft: `4px solid ${statusColor}`,
                        borderRadius: "6px",
                        padding: "10px",
                        marginBottom: "12px",
                        opacity: isDimmed ? 0.25 : 1,
                        outline: isRoot ? "2px solid #2196f3" : isImpacted ? "2px solid #ff9800" : "none",
                        boxShadow: isRoot
                          ? "0 0 16px rgba(33, 150, 243, 0.5)"
                          : isImpacted
                            ? "0 0 12px rgba(255, 152, 0, 0.4)"
                            : "none",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.85rem",
                          fontWeight: 600,
                          marginBottom: "4px",
                          wordBreak: "break-word",
                        }}
                      >
                        {node.name}
                      </div>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--vscode-descriptionForeground, #888)",
                          marginBottom: "6px",
                        }}
                      >
                        ID: {node.nodeId}
                      </div>
                      {node.diagnostic && (
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#f44336",
                            background: "rgba(244, 67, 54, 0.1)",
                            padding: "4px 6px",
                            borderRadius: "4px",
                            marginBottom: "6px",
                          }}
                        >
                          {node.diagnostic}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                        <button
                          onClick={() => handleGoToSource(node)}
                          style={{
                            fontSize: "0.72rem",
                            padding: "3px 6px",
                            borderRadius: "3px",
                            background: "rgba(255, 255, 255, 0.08)",
                            color: "var(--vscode-editor-foreground, #ccc)",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          Source
                        </button>
                        <button
                          onClick={() => handleBlastRadius(node)}
                          style={{
                            fontSize: "0.72rem",
                            padding: "3px 6px",
                            borderRadius: "3px",
                            background: "rgba(255, 255, 255, 0.08)",
                            color: "var(--vscode-editor-foreground, #ccc)",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          Blast Radius
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<ThreadExplorerApp />);
}
