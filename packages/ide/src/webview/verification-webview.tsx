// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { EngineeringDataGrid, type DataGridColumn } from "./shared/index.js";

const vscode = (
  window as unknown as {
    acquireVsCodeApi?: () => {
      postMessage(message: unknown): void;
      getState<T = unknown>(): T | undefined;
      setState<T = unknown>(state: T): T;
    };
  }
).acquireVsCodeApi?.();

export interface VerificationRequirement {
  id: string;
  name: string;
  uri?: string;
  startOffset?: number;
  endOffset?: number;
  lhsName?: string;
  constraintIds?: string[];
  peakValue?: number;
  limitValue?: number;
  status: "Passed" | "Failed" | "Pending";
  violationTime?: number;
}

export interface VerificationStage {
  name?: string;
  passed: boolean;
  summary?: string;
  durationMs?: number;
}

export interface PolyglotDigitalThreadReport {
  mode?: "generic" | "scenario";
  scenarioId: string;
  scenarioTitle: string;
  status: string;
  isSat: boolean;
  fileCount?: number;
  domains?: string[];
  summaryText: string;
  artifacts?: Array<{
    index: number;
    fileName: string;
    uri?: string;
    lang: string;
    domain: string;
    diagnostics?: Array<{
      startLine?: number;
      startCol?: number;
      severity?: string;
      code?: string;
      message: string;
    }>;
  }>;
  hypergraphNodes: Array<{
    fileName: string;
    uri?: string;
    formatLabel: string;
    domainName: string;
    oracleName: string;
    status: string;
  }>;
  variableLinks: Array<{
    canonicalFqn: string;
    bindingMechanism: string;
    valueFormatted: string;
    boundsFormatted: string;
    status: string;
    marginText: string;
  }>;
  portBindings: Array<{
    portName: string;
    cadFileName: string;
    caeFileName: string;
    caePatchSpec: string;
    isBound: boolean;
  }>;
  suggestedEdits?: Array<{
    fileIndex: number;
    uri?: string;
    fileName: string;
    line: number;
    startOffset?: number;
    endOffset?: number;
    newText: string;
    description: string;
  }>;
  conflicts: Array<{ explanation?: string; theoryName?: string }>;
}

export interface UnifiedVerificationReport {
  summary?: {
    totalStages?: number;
    passedStages?: number;
    failedStages?: number;
  };
  stages?: Record<string, VerificationStage>;
  polyglotDigitalThread?: PolyglotDigitalThreadReport;
}

export interface B2BResult {
  success?: boolean;
  stage?: { passed: boolean };
  complianceLevel?: string;
  maxDifference?: number;
  tolerance?: number;
  worstDivergingVariable?: string;
  c99SourceSha?: string;
}

export function VerificationApp() {
  const [requirements, setRequirements] = useState<VerificationRequirement[]>([]);
  const [unifiedReport, setUnifiedReport] = useState<UnifiedVerificationReport | null>(null);
  const [b2bResult, setB2bResult] = useState<B2BResult | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg) return;

      switch (msg.type) {
        case "verificationStarted":
          setIsRunning(true);
          setError(null);
          break;

        case "verificationComplete":
          setIsRunning(false);
          if (Array.isArray(msg.requirements)) {
            setRequirements(msg.requirements);
          }
          if (msg.unifiedReport) {
            setUnifiedReport(msg.unifiedReport);
          }
          break;

        case "b2bComplete":
          setIsRunning(false);
          if (msg.b2bResult) {
            setB2bResult(msg.b2bResult);
          }
          break;

        case "verificationError":
          setIsRunning(false);
          setError(msg.message || "Verification failed");
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    vscode?.postMessage({ type: "ready" });

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleGoToSource = (req: VerificationRequirement) => {
    if (req.uri) {
      vscode?.postMessage({
        type: "goToSource",
        uri: req.uri,
        startOffset: req.startOffset ?? 0,
        endOffset: req.endOffset ?? req.startOffset ?? 0,
      });
    }
  };

  const { totalCount, passedCount, failedCount, pendingCount } = useMemo(() => {
    let passed = 0;
    let failed = 0;
    let pending = 0;

    for (const r of requirements) {
      if (r.status === "Passed") passed++;
      else if (r.status === "Failed") failed++;
      else pending++;
    }

    if (unifiedReport?.summary) {
      passed += unifiedReport.summary.passedStages || 0;
      failed += unifiedReport.summary.failedStages || 0;
    }

    if (b2bResult) {
      if (b2bResult.success || b2bResult.stage?.passed) passed++;
      else failed++;
    }

    const total = requirements.length + (unifiedReport?.summary?.totalStages || 0) + (b2bResult ? 1 : 0);

    return { totalCount: total, passedCount: passed, failedCount: failed, pendingCount: pending };
  }, [requirements, unifiedReport, b2bResult]);

  const columns = useMemo<DataGridColumn<VerificationRequirement>[]>(() => {
    return [
      {
        key: "name",
        header: "Requirement",
        sortable: true,
        render: (item) => (
          <span
            onClick={() => handleGoToSource(item)}
            style={{
              color: "var(--vscode-textLink-foreground, #3794ff)",
              cursor: "pointer",
              fontWeight: 600,
              textDecoration: "underline",
            }}
          >
            {item.name}
          </span>
        ),
      },
      {
        key: "variable",
        header: "Variable",
        sortable: true,
        render: (item) => {
          const variable =
            item.lhsName || (item.constraintIds?.length ? `${item.constraintIds.length} constraint(s)` : "—");
          return <span style={{ fontFamily: "monospace", fontSize: "12px" }}>{variable}</span>;
        },
      },
      {
        key: "peakValue",
        header: "Peak",
        sortable: true,
        render: (item) => (
          <span style={{ fontFamily: "monospace", textAlign: "right" }}>
            {item.peakValue !== undefined ? item.peakValue.toFixed(1) : "—"}
          </span>
        ),
      },
      {
        key: "limitValue",
        header: "Limit",
        sortable: true,
        render: (item) => (
          <span style={{ fontFamily: "monospace", textAlign: "right" }}>
            {item.limitValue !== undefined ? item.limitValue.toFixed(1) : "—"}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        sortable: true,
        render: (item) => {
          const color = item.status === "Passed" ? "#4ec9b0" : item.status === "Failed" ? "#f14c4c" : "#888";
          const icon = item.status === "Passed" ? "✓" : item.status === "Failed" ? "✗" : "◌";
          return (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 8px",
                borderRadius: "10px",
                fontWeight: 600,
                fontSize: "11px",
                color,
                background: `${color}22`,
                border: `1px solid ${color}`,
              }}
            >
              {icon} {item.status}
            </span>
          );
        },
      },
      {
        key: "violationTime",
        header: "Violation",
        sortable: true,
        render: (item) => (
          <span style={{ fontSize: "11px", opacity: 0.7 }}>
            {item.status === "Failed" && item.violationTime !== undefined ? `t=${item.violationTime.toFixed(2)}s` : "—"}
          </span>
        ),
      },
      {
        key: "actions",
        header: "3D Witness",
        render: (item) =>
          item.status === "Failed" && item.violationTime !== undefined ? (
            <button
              onClick={() =>
                vscode?.postMessage({
                  type: "focusViolationIn3D",
                  contractId: item.id,
                  time: item.violationTime,
                  lhsName: item.lhsName,
                })
              }
              style={{
                background: "rgba(239, 68, 68, 0.18)",
                color: "#f87171",
                border: "1px solid #ef4444",
                borderRadius: "3px",
                padding: "2px 6px",
                fontSize: "10px",
                cursor: "pointer",
                fontWeight: 600,
              }}
              title="Focus counterexample witness in 3D viewport"
            >
              🎯 Focus in 3D
            </button>
          ) : (
            <span style={{ opacity: 0.4 }}>—</span>
          ),
      },
    ];
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "var(--vscode-editor-background, #1e1e1e)",
        color: "var(--vscode-editor-foreground, #cccccc)",
        fontFamily: "var(--vscode-font-family, sans-serif)",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          borderBottom: "1px solid var(--vscode-panel-border, #333)",
          backgroundColor: "var(--vscode-editorGroupHeader-tabsBackground, #252526)",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 600, margin: 0 }}>V&V Dashboard</h2>
          {isRunning && <span style={{ fontSize: "12px", color: "#3794ff" }}>⚙️ Verifying…</span>}
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => vscode?.postMessage({ type: "runVerification" })}
            disabled={isRunning}
            style={{
              padding: "6px 12px",
              background: "var(--vscode-button-background, #0e639c)",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: isRunning ? "not-allowed" : "pointer",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            ▶ Run Verification
          </button>
          <button
            onClick={() => vscode?.postMessage({ type: "runB2B" })}
            disabled={isRunning}
            style={{
              padding: "6px 12px",
              background: "var(--vscode-button-secondaryBackground, #3a3d41)",
              color: "var(--vscode-button-secondaryForeground, #fff)",
              border: "1px solid var(--vscode-panel-border, #333)",
              borderRadius: "4px",
              cursor: isRunning ? "not-allowed" : "pointer",
              fontSize: "12px",
            }}
          >
            🛡️ B2B Equiv (ASIL D)
          </button>
          <button
            onClick={() => vscode?.postMessage({ type: "exportDhf" })}
            style={{
              padding: "6px 12px",
              background: "var(--vscode-button-secondaryBackground, #3a3d41)",
              color: "var(--vscode-button-secondaryForeground, #fff)",
              border: "1px solid var(--vscode-panel-border, #333)",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            📄 Export DHF
          </button>
          <button
            onClick={() => vscode?.postMessage({ type: "openSimulation" })}
            style={{
              padding: "6px 12px",
              background: "transparent",
              color: "var(--vscode-editor-foreground, #ccc)",
              border: "1px solid var(--vscode-panel-border, #333)",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            📈 Open Sim
          </button>
        </div>
      </div>

      {/* Summary Strip */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--vscode-panel-border, #333)",
        }}
      >
        <div
          style={{
            flex: 1,
            padding: "10px 16px",
            textAlign: "center",
            borderRight: "1px solid var(--vscode-panel-border, #333)",
          }}
        >
          <div style={{ fontSize: "22px", fontWeight: 700 }}>{totalCount}</div>
          <div style={{ fontSize: "10px", textTransform: "uppercase", opacity: 0.6 }}>Total Checks</div>
        </div>
        <div
          style={{
            flex: 1,
            padding: "10px 16px",
            textAlign: "center",
            borderRight: "1px solid var(--vscode-panel-border, #333)",
          }}
        >
          <div style={{ fontSize: "22px", fontWeight: 700, color: "#4ec9b0" }}>{passedCount}</div>
          <div style={{ fontSize: "10px", textTransform: "uppercase", opacity: 0.6 }}>Passed</div>
        </div>
        <div
          style={{
            flex: 1,
            padding: "10px 16px",
            textAlign: "center",
            borderRight: "1px solid var(--vscode-panel-border, #333)",
          }}
        >
          <div style={{ fontSize: "22px", fontWeight: 700, color: "#f14c4c" }}>{failedCount}</div>
          <div style={{ fontSize: "10px", textTransform: "uppercase", opacity: 0.6 }}>Failed</div>
        </div>
        <div style={{ flex: 1, padding: "10px 16px", textAlign: "center" }}>
          <div style={{ fontSize: "22px", fontWeight: 700, color: "#888" }}>{pendingCount}</div>
          <div style={{ fontSize: "10px", textTransform: "uppercase", opacity: 0.6 }}>Pending</div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: "8px 16px",
            background: "rgba(241,76,76,0.15)",
            color: "#f14c4c",
            borderBottom: "1px solid #f14c4c",
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* B2B Equivalence Banner */}
      {b2bResult && (
        <div
          style={{
            margin: "12px 16px",
            padding: "12px 16px",
            borderRadius: "6px",
            border: "1px solid var(--vscode-panel-border, #333)",
            background: "var(--vscode-editorWidget-background, #202020)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: "13px" }}>Back-to-Back Equivalence (Model vs C99 Target)</span>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "10px",
                color: b2bResult.success || b2bResult.stage?.passed ? "#4ec9b0" : "#f14c4c",
                background:
                  b2bResult.success || b2bResult.stage?.passed ? "rgba(78,201,176,0.15)" : "rgba(241,76,76,0.15)",
                border: `1px solid ${b2bResult.success || b2bResult.stage?.passed ? "#4ec9b0" : "#f14c4c"}`,
              }}
            >
              {b2bResult.success || b2bResult.stage?.passed ? "✓ EQUIVALENT" : "✗ DIVERGENT"}
            </span>
          </div>
          <div style={{ display: "flex", gap: "16px", fontSize: "12px", opacity: 0.8 }}>
            <span>Target: {b2bResult.complianceLevel || "ASIL D"}</span>
            <span>
              Max Diff: {b2bResult.maxDifference !== undefined ? b2bResult.maxDifference.toExponential(2) : "0.00e+0"}
            </span>
            <span>
              Tolerance: {b2bResult.tolerance !== undefined ? b2bResult.tolerance.toExponential(2) : "1.00e-6"}
            </span>
            <span>Worst Var: {b2bResult.worstDivergingVariable || "none"}</span>
          </div>
        </div>
      )}

      {/* Unified Formal Verification Stages */}
      {unifiedReport?.stages && Object.keys(unifiedReport.stages).length > 0 && (
        <div style={{ padding: "0 16px 12px 16px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, opacity: 0.8, marginBottom: "8px" }}>
            Unified Formal Verification Stages
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "8px" }}>
            {Object.entries(unifiedReport.stages).map(([k, s]) => (
              <div
                key={k}
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--vscode-panel-border, #333)",
                  borderRadius: "6px",
                  padding: "8px 12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: "12px" }}>{s.name || k}</span>
                  <span style={{ fontSize: "11px", color: s.passed ? "#4ec9b0" : "#f14c4c", fontWeight: 600 }}>
                    {s.passed ? "✓ Pass" : "✗ Fail"}
                  </span>
                </div>
                <div style={{ fontSize: "11px", opacity: 0.7, marginTop: "4px" }}>
                  {s.summary} {s.durationMs !== undefined ? `(${s.durationMs}ms)` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Polyglot Digital Thread Coordinator */}
      {unifiedReport?.polyglotDigitalThread && (
        <div style={{ padding: "0 16px 12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, opacity: 0.9 }}>
              Polyglot Digital Thread — {unifiedReport.polyglotDigitalThread.scenarioTitle}
            </div>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: "999px",
                background: unifiedReport.polyglotDigitalThread.isSat
                  ? "rgba(78, 201, 176, 0.16)"
                  : "rgba(241, 76, 76, 0.16)",
                color: unifiedReport.polyglotDigitalThread.isSat ? "#4ec9b0" : "#f14c4c",
              }}
            >
              {unifiedReport.polyglotDigitalThread.status}
            </span>
          </div>
          <div style={{ fontSize: "11px", opacity: 0.78, marginBottom: "8px" }}>
            {unifiedReport.polyglotDigitalThread.summaryText}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: "6px",
              marginBottom: "8px",
            }}
          >
            {unifiedReport.polyglotDigitalThread.hypergraphNodes.map((node, i) => (
              <div
                key={`${node.fileName}-${i}`}
                onClick={() => node.uri && postMessageToExtension({ type: "openLocation", uri: node.uri, line: 1 })}
                style={{
                  cursor: node.uri ? "pointer" : "default",
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--vscode-panel-border, #333)",
                  borderRadius: "6px",
                  padding: "6px 10px",
                  fontSize: "11px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                  <span>{node.fileName}</span>
                  <span style={{ color: node.status === "SYNCED" ? "#4ec9b0" : "#f14c4c" }}>{node.status}</span>
                </div>
                <div style={{ opacity: 0.7, marginTop: "2px" }}>
                  {node.formatLabel} · {node.oracleName}
                </div>
              </div>
            ))}
          </div>
          {unifiedReport.polyglotDigitalThread.variableLinks.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
              {unifiedReport.polyglotDigitalThread.variableLinks.map((vl, idx) => (
                <div
                  key={`${vl.canonicalFqn}-${idx}`}
                  style={{
                    fontSize: "11px",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    border: "1px solid var(--vscode-panel-border, #333)",
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <strong style={{ color: vl.status === "SAT" ? "#4ec9b0" : "#f14c4c" }}>[{vl.status}]</strong>{" "}
                  <code>{vl.canonicalFqn}</code> = {vl.valueFormatted} ({vl.boundsFormatted}) · {vl.marginText}
                </div>
              ))}
            </div>
          )}
          {unifiedReport.polyglotDigitalThread.artifacts?.some((a) => (a.diagnostics?.length ?? 0) > 0) && (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {unifiedReport.polyglotDigitalThread.artifacts.flatMap((art) =>
                (art.diagnostics ?? []).map((diag, dIdx) => (
                  <button
                    key={`${art.fileName}-${dIdx}`}
                    type="button"
                    onClick={() =>
                      art.uri &&
                      postMessageToExtension({
                        type: "openLocation",
                        uri: art.uri,
                        line: diag.startLine ?? 1,
                        column: diag.startCol ?? 1,
                      })
                    }
                    style={{
                      textAlign: "left",
                      cursor: art.uri ? "pointer" : "default",
                      background: "rgba(241, 76, 76, 0.08)",
                      border: "1px solid rgba(241, 76, 76, 0.35)",
                      borderRadius: "4px",
                      padding: "5px 8px",
                      color: "inherit",
                      fontSize: "11px",
                    }}
                  >
                    <strong>
                      {art.fileName}:{diag.startLine ?? 1}
                    </strong>{" "}
                    [{diag.code ?? "THREAD"}] {diag.message}
                  </button>
                )),
              )}
            </div>
          )}
          {(unifiedReport.polyglotDigitalThread.suggestedEdits?.length ?? 0) > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                marginTop: "6px",
              }}
            >
              <span style={{ fontSize: "11px", opacity: 0.85 }}>
                {unifiedReport.polyglotDigitalThread.suggestedEdits!.length} surgical sync edit
                {unifiedReport.polyglotDigitalThread.suggestedEdits!.length === 1 ? "" : "s"} available across linked
                files
              </span>
              <button
                type="button"
                onClick={() =>
                  postMessageToExtension({
                    type: "applyDigitalThreadSync",
                    suggestedEdits: unifiedReport.polyglotDigitalThread!.suggestedEdits,
                  })
                }
                style={{
                  cursor: "pointer",
                  background: "var(--vscode-button-background, #0e639c)",
                  color: "var(--vscode-button-foreground, #ffffff)",
                  border: "none",
                  borderRadius: "4px",
                  padding: "4px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                Sync Digital Thread ({unifiedReport.polyglotDigitalThread.suggestedEdits!.length})
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Requirements Table Dogfooding EngineeringDataGrid */}
      <div style={{ flex: 1, padding: "0 16px 16px 16px", overflow: "hidden" }}>
        {requirements.length === 0 && !unifiedReport && !b2bResult ? (
          <div style={{ padding: "48px 16px", textAlign: "center", opacity: 0.7 }}>
            <h3>No verification results loaded</h3>
            <p style={{ marginTop: "8px", fontSize: "12px" }}>
              Open a model file and click &quot;Run Verification&quot; or &quot;B2B Equiv (ASIL D)&quot;.
            </p>
          </div>
        ) : (
          <EngineeringDataGrid
            columns={columns}
            data={requirements}
            keyExtractor={(item, idx) => item.id || item.name || idx}
            searchPlaceholder="Filter requirements…"
            emptyMessage="No matching requirements found."
            pageSize={50}
          />
        )}
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<VerificationApp />);
}
