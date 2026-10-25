// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ContractNode, EventTraceStep } from "../contract-hierarchy-panel.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.();

export interface ContractHierarchyData {
  system?: ContractNode | undefined;
  components?: ContractNode[] | undefined;
  violations?: { component?: string; reason: string }[];
  isRefined?: boolean;
  traces?: EventTraceStep[];
}

export function ContractHierarchyApp() {
  const [data, setData] = useState<ContractHierarchyData | null>(null);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "hierarchyData" || msg.type === "loadHierarchy") {
        setData(msg.data ?? msg.hierarchy);
      }
    };

    window.addEventListener("message", handleMessage);
    vscode?.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const violations = useMemo(() => data?.violations || [], [data]);
  const isRefined = data?.isRefined ?? violations.length === 0;
  const traces = useMemo(() => (Array.isArray(data?.traces) ? data!.traces : []), [data]);

  const handleStepSelect = (idx: number) => {
    setCurrentStepIdx(idx);
    const tr = traces[idx];
    if (tr) {
      vscode?.postMessage({
        type: "goToSource",
        name: tr.sourceSymbol || tr.event || tr.actor,
      });
    }
  };

  const handleGoToContract = (symbolName?: string) => {
    if (symbolName) {
      vscode?.postMessage({ type: "goToSource", name: symbolName });
    }
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
          paddingBottom: "12px",
          borderBottom: "1px solid var(--vscode-panel-border, #3c3c3c)",
          marginBottom: "16px",
        }}
      >
        <div>
          <h2
            style={{
              margin: "0 0 4px 0",
              fontSize: "1.25rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            🛡️ Contract Hierarchy & Event Trace Explorer
          </h2>
          <div style={{ display: "flex", gap: "8px", fontSize: "0.8rem" }}>
            <span
              style={{
                padding: "2px 8px",
                borderRadius: "10px",
                fontWeight: 600,
                background: isRefined ? "rgba(76, 175, 80, 0.15)" : "rgba(244, 67, 54, 0.15)",
                color: isRefined ? "#4caf50" : "#f44336",
                border: `1px solid ${isRefined ? "#4caf50" : "#f44336"}`,
              }}
            >
              {isRefined ? "✓ Refined (A/G Sound)" : `⚠ ${violations.length} Violations`}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => vscode?.postMessage({ type: "exportNuXmv" })}
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
            📜 nuXmv Model
          </button>
          <button
            onClick={() => vscode?.postMessage({ type: "verifyContracts" })}
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
            ⚡ Check Refinement
          </button>
          <button
            onClick={() => vscode?.postMessage({ type: "openReplayer" })}
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
            ⏯ Counterexample
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

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "16px" }}>
        {/* Left: Contract Hierarchy Tree */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px solid var(--vscode-panel-border, #3c3c3c)",
            borderRadius: "8px",
            padding: "16px",
          }}
        >
          <h3
            style={{
              marginTop: 0,
              marginBottom: "12px",
              fontSize: "0.95rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--vscode-descriptionForeground, #888)",
            }}
          >
            Contract Tree (Assume/Guarantee)
          </h3>

          {data?.system && (
            <div
              style={{
                background: "var(--vscode-sideBar-background, #252526)",
                border: "1px solid var(--vscode-panel-border, #3c3c3c)",
                borderLeft: `4px solid ${isRefined ? "#4caf50" : "#f44336"}`,
                borderRadius: "6px",
                padding: "12px",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "6px",
                }}
              >
                <span
                  onClick={() => handleGoToContract(data.system?.symbolName || data.system?.name)}
                  style={{
                    fontWeight: 600,
                    fontSize: "0.95rem",
                    cursor: "pointer",
                    color: "var(--vscode-textLink-foreground, #3794ff)",
                  }}
                >
                  🏛️ System: {data.system.name}
                </span>
                <span
                  style={{
                    padding: "2px 6px",
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                    background: isRefined ? "rgba(76, 175, 80, 0.15)" : "rgba(244, 67, 54, 0.15)",
                    color: isRefined ? "#4caf50" : "#f44336",
                  }}
                >
                  {isRefined ? "Refined" : "Violations"}
                </span>
              </div>
              {data.system.doc && (
                <div style={{ fontSize: "0.8rem", opacity: 0.75, marginBottom: "6px" }}>{data.system.doc}</div>
              )}
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "2px" }}>Assumptions (A):</div>
              {(data.system.assumptions || []).map((a, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: "0.78rem",
                    background: "rgba(76, 175, 80, 0.08)",
                    borderLeft: "2px solid #4caf50",
                    padding: "3px 6px",
                    marginBottom: "3px",
                    borderRadius: "2px",
                  }}
                >
                  A: {a}
                </div>
              ))}
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginTop: "6px", marginBottom: "2px" }}>
                Guarantees (G):
              </div>
              {(data.system.guarantees || []).map((g, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: "0.78rem",
                    background: "rgba(33, 150, 243, 0.08)",
                    borderLeft: "2px solid #2196f3",
                    padding: "3px 6px",
                    marginBottom: "3px",
                    borderRadius: "2px",
                  }}
                >
                  G: {g}
                </div>
              ))}
            </div>
          )}

          {/* Subcomponents */}
          {(data?.components || []).map((comp) => {
            const cViolations = violations.filter((v) => v.component === comp.name);
            const isCompOk = cViolations.length === 0;

            return (
              <div
                key={comp.name}
                style={{
                  marginLeft: "20px",
                  background: "var(--vscode-sideBar-background, #252526)",
                  border: "1px solid var(--vscode-panel-border, #3c3c3c)",
                  borderLeft: `4px solid ${isCompOk ? "#4caf50" : "#f44336"}`,
                  borderRadius: "6px",
                  padding: "12px",
                  marginBottom: "12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "6px",
                  }}
                >
                  <span
                    onClick={() => handleGoToContract(comp.symbolName || comp.name)}
                    style={{
                      fontWeight: 600,
                      fontSize: "0.9rem",
                      cursor: "pointer",
                      color: "var(--vscode-textLink-foreground, #3794ff)",
                    }}
                  >
                    🧩 {comp.name} {comp.role && <span style={{ opacity: 0.6 }}>({comp.role})</span>}
                  </span>
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      background: isCompOk ? "rgba(76, 175, 80, 0.15)" : "rgba(244, 67, 54, 0.15)",
                      color: isCompOk ? "#4caf50" : "#f44336",
                    }}
                  >
                    {isCompOk ? "✓ Compatible" : "⚠ Incompatible"}
                  </span>
                </div>
                {comp.doc && <div style={{ fontSize: "0.8rem", opacity: 0.75, marginBottom: "6px" }}>{comp.doc}</div>}
                <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "2px" }}>Assumptions (A):</div>
                {(comp.assumptions || []).map((a, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: "0.78rem",
                      background: "rgba(76, 175, 80, 0.08)",
                      borderLeft: "2px solid #4caf50",
                      padding: "3px 6px",
                      marginBottom: "3px",
                      borderRadius: "2px",
                    }}
                  >
                    A: {a}
                  </div>
                ))}
                <div style={{ fontSize: "0.8rem", fontWeight: 600, marginTop: "6px", marginBottom: "2px" }}>
                  Guarantees (G):
                </div>
                {(comp.guarantees || []).map((g, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: "0.78rem",
                      background: "rgba(33, 150, 243, 0.08)",
                      borderLeft: "2px solid #2196f3",
                      padding: "3px 6px",
                      marginBottom: "3px",
                      borderRadius: "2px",
                    }}
                  >
                    G: {g}
                  </div>
                ))}
                {cViolations.map((v, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: "0.78rem",
                      color: "#f44336",
                      background: "rgba(244, 67, 54, 0.1)",
                      padding: "3px 6px",
                      marginTop: "4px",
                      borderRadius: "2px",
                    }}
                  >
                    ⚠ {v.reason}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* Right: Discrete Event Traces */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px solid var(--vscode-panel-border, #3c3c3c)",
            borderRadius: "8px",
            padding: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "0.95rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--vscode-descriptionForeground, #888)",
              }}
            >
              Event Trace Timeline ({traces.length})
            </h3>
            <span style={{ fontSize: "0.8rem", opacity: 0.8 }}>
              Step {traces.length > 0 ? currentStepIdx + 1 : 0} of {traces.length}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "65vh", overflowY: "auto" }}>
            {traces.map((tr, idx) => {
              const isActive = idx === currentStepIdx;
              return (
                <div
                  key={idx}
                  onClick={() => handleStepSelect(idx)}
                  style={{
                    background: isActive ? "rgba(0, 188, 212, 0.15)" : "var(--vscode-sideBar-background, #252526)",
                    border: `1px solid ${isActive ? "#00bcd4" : "var(--vscode-panel-border, #3c3c3c)"}`,
                    borderRadius: "6px",
                    padding: "10px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "12px",
                      background: isActive ? "#00bcd4" : "rgba(255, 255, 255, 0.1)",
                      color: isActive ? "#000" : "#ccc",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                    }}
                  >
                    {tr.step}
                  </div>
                  <div
                    style={{
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: "rgba(255, 255, 255, 0.08)",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                    }}
                  >
                    {tr.actor}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#00bcd4", fontWeight: 600 }}>➔ {tr.event} ➔</div>
                  <div
                    style={{ fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {tr.targetActor && <span>{tr.targetActor}: </span>}
                    <code style={{ fontSize: "0.78rem" }}>{tr.message || ""}</code>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<ContractHierarchyApp />);
}
