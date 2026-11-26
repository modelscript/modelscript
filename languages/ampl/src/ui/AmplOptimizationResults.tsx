// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { Suspense, useEffect, useState } from "react";

export interface AmplGeomVar {
  id: number;
  name: string;
  type: string;
  lb: number | null;
  ub: number | null;
}

export interface AmplGeomObjective {
  name: string;
  direction: "minimize" | "maximize";
  constant: number;
  linearCoeffs: Record<string, number>;
  isLinear: boolean;
}

export interface AmplGeomConstraint {
  name: string;
  lb: number | null;
  ub: number | null;
  constant: number;
  linearCoeffs: Record<string, number>;
  isLinear: boolean;
}

export interface AmplGeomInfo {
  problemName: string;
  problemClass: string;
  variables: AmplGeomVar[];
  objectives: AmplGeomObjective[];
  constraints: AmplGeomConstraint[];
  parameters: Array<{ name: string; value: number }>;
}

type AmplResultTab = "summary" | "constraints2d" | "constraints3d" | "landscape" | "pareto";

export interface AmplSolveResultData {
  status?: string;
  problemName?: string;
  problemClass?: string;
  objectiveName?: string;
  objectiveDirection?: string;
  objectiveValue?: number | null;
  solverUsed?: string;
  solveTimeMs?: number;
  iterations?: number;
  message?: string;
  variables?: Record<string, number>;
  reducedCosts?: Record<string, number>;
  variableSuffixes?: Record<string, Record<string, unknown>>;
  constraintSuffixes?: Record<string, Record<string, unknown>>;
}

export interface AmplOptimizationResultsProps {
  result: AmplSolveResultData | null;
  status?: { status?: string; error?: string | null } | null;
  documentUri?: string | undefined;
  documentText?: string | undefined;
  projectFiles?: Record<string, string> | undefined;
  activeFileName?: string | undefined;
  onSolve: () => void;
  onBackToInspector?: (() => void) | undefined;
  inspectGeometry?:
    | ((params: {
        documentUri: string;
        documentText: string;
        dataText?: string;
        projectFiles?: Record<string, string>;
      }) => Promise<AmplGeomInfo | null>)
    | undefined;
  Constraints2DComponent?:
    | React.ComponentType<{
        geometry: AmplGeomInfo;
        solution: Record<string, number>;
        constraintSuffixes: Record<string, Record<string, unknown>>;
      }>
    | undefined;
  Constraints3DComponent?:
    | React.ComponentType<{
        geometry: AmplGeomInfo;
        solution: Record<string, number>;
      }>
    | undefined;
  FitnessLandscapeComponent?:
    | React.ComponentType<{
        geometry: AmplGeomInfo;
        documentUri: string;
        documentText: string;
      }>
    | undefined;
  ParetoFrontComponent?:
    | React.ComponentType<{
        geometry: AmplGeomInfo;
        documentUri: string;
        documentText: string;
      }>
    | undefined;
}

function formatNum(val: unknown): string {
  if (val === null || val === undefined) return "—";
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  if (Math.abs(n) < 1e-12) return "0";
  if (Number.isInteger(n)) return String(n);
  return Number(n.toPrecision(6)).toString();
}

export const AmplOptimizationResults: React.FC<AmplOptimizationResultsProps> = ({
  result,
  status,
  documentUri = "file:///document.ampl",
  documentText = "",
  projectFiles,
  activeFileName,
  onSolve,
  onBackToInspector,
  inspectGeometry,
  Constraints2DComponent,
  Constraints3DComponent,
  FitnessLandscapeComponent,
  ParetoFrontComponent,
}) => {
  const [activeTab, setActiveTab] = useState<AmplResultTab>("summary");
  const [geometry, setGeometry] = useState<AmplGeomInfo | null>(null);

  useEffect(() => {
    if (!result || !documentText || !inspectGeometry) {
      setGeometry(null);
      return;
    }
    const effectiveFiles: Record<string, string> = {
      ...(projectFiles ?? {}),
      ...(activeFileName ? { [activeFileName]: documentText } : {}),
    };
    const dataText = Object.entries(effectiveFiles)
      .filter(([name]) => name.toLowerCase().endsWith(".dat"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, txt]) => txt.trim())
      .filter(Boolean)
      .join("\n\n");
    let cancelled = false;
    const timer = setTimeout(() => {
      inspectGeometry({
        documentUri,
        documentText,
        ...(dataText ? { dataText } : {}),
        ...(Object.keys(effectiveFiles).length > 0 ? { projectFiles: effectiveFiles } : {}),
      })
        .then((geo) => {
          if (!cancelled && geo) setGeometry(geo);
        })
        .catch(() => {
          if (!cancelled) setGeometry(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [result, documentUri, documentText, projectFiles, activeFileName, inspectGeometry]);
  const borderCol = "var(--color-border-default, var(--ms-border, rgba(148, 163, 184, 0.18)))";
  const cardBg = "var(--bgColor-muted, var(--ms-bg-elv))";
  const textPrimary = "var(--ms-text-1, var(--color-fg-default))";
  const textMuted = "var(--ms-text-2, var(--color-fg-muted))";

  if (status?.status === "pending" || status?.status === "processing") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          gap: 10,
          color: textMuted,
          fontSize: 13,
        }}
      >
        <div style={{ fontWeight: 600, color: textPrimary }}>Solving AMPL optimization problem…</div>
        <div>Running LP / MILP / NLP solver in background runtime</div>
      </div>
    );
  }

  if ((status?.status === "error" || status?.status === "failed") && status?.error) {
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14, width: "100%", overflowY: "auto" }}>
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 8,
            border: "1px solid rgba(239, 68, 68, 0.45)",
            backgroundColor: "rgba(239, 68, 68, 0.08)",
            color: textPrimary,
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, color: "#f87171" }}>Optimization Failed</div>
          <div style={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{status.error}</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={onSolve}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              backgroundColor: cardBg,
              color: textPrimary,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Retry Solve
          </button>
          {onBackToInspector && (
            <button
              type="button"
              onClick={onBackToInspector}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: `1px solid ${borderCol}`,
                backgroundColor: "transparent",
                color: textMuted,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Back to Problem Inspector
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          gap: 12,
          padding: 24,
          color: textMuted,
          fontSize: 13,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 15, color: textPrimary }}>No Optimization Results Yet</div>
        <div>Click Run (F5) or the button below to solve the AMPL model.</div>
        <button
          type="button"
          onClick={onSolve}
          style={{
            padding: "7px 16px",
            borderRadius: 6,
            border: "none",
            backgroundColor: "#0d9488",
            color: "#ffffff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Solve Optimization Problem
        </button>
      </div>
    );
  }

  const solverStatus = String(result.status ?? "UNKNOWN").toUpperCase();
  const isOptimal = solverStatus === "OPTIMAL" || solverStatus === "FEASIBLE";
  const statusColor = isOptimal ? "#22c55e" : "#ef4444";

  const varEntries = Object.entries((result.variables ?? {}) as Record<string, number>);
  const maxAbsVar = varEntries.reduce((m, [, v]) => Math.max(m, Math.abs(Number(v) || 0)), 0) || 1;
  const varSuffixes = (result.variableSuffixes ?? {}) as Record<string, Record<string, unknown>>;
  const constraintSuffixes = (result.constraintSuffixes ?? {}) as Record<string, Record<string, unknown>>;
  const constraintNames = Object.keys(constraintSuffixes);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        overflowY: "auto",
        padding: "16px 20px 28px 20px",
        gap: 18,
        backgroundColor: "var(--color-bg-primary)",
        color: textPrimary,
        fontSize: 13,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          paddingBottom: 12,
          borderBottom: `1px solid ${borderCol}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            Optimization Results{result.problemName ? `: ${result.problemName}` : ""}
          </div>
          {result.problemClass && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 999,
                backgroundColor: "rgba(163, 113, 247, 0.14)",
                color: "#a371f7",
                border: "1px solid rgba(163, 113, 247, 0.3)",
              }}
            >
              {result.problemClass}
            </span>
          )}
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              backgroundColor: isOptimal ? "rgba(34, 197, 94, 0.14)" : "rgba(239, 68, 68, 0.14)",
              color: statusColor,
              border: `1px solid ${isOptimal ? "rgba(34, 197, 94, 0.35)" : "rgba(239, 68, 68, 0.35)"}`,
            }}
          >
            {solverStatus}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onBackToInspector && (
            <button
              type="button"
              onClick={onBackToInspector}
              style={{
                padding: "5px 10px",
                borderRadius: 6,
                border: `1px solid ${borderCol}`,
                backgroundColor: cardBg,
                color: textPrimary,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Problem Structure
            </button>
          )}
          <button
            type="button"
            onClick={onSolve}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              border: "none",
              backgroundColor: "#0d9488",
              color: "#ffffff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Re-Solve
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 6, borderBottom: `1px solid ${borderCol}`, paddingBottom: 10 }}
      >
        {(
          [
            { id: "summary", label: "Summary & Solution" },
            { id: "constraints2d", label: "2D Constraints" },
            { id: "constraints3d", label: "3D Surface / Polytope" },
            { id: "landscape", label: "Fitness Landscape" },
            { id: "pareto", label: "Pareto Front" },
          ] as Array<{ id: AmplResultTab; label: string }>
        ).map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: `1px solid ${active ? "#0d9488" : borderCol}`,
                backgroundColor: active ? "rgba(13, 148, 136, 0.16)" : cardBg,
                color: active ? "#2dd4bf" : textPrimary,
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "constraints2d" &&
        (Constraints2DComponent ? (
          geometry ? (
            <Constraints2DComponent
              geometry={geometry}
              solution={result.variables ?? {}}
              constraintSuffixes={constraintSuffixes}
            />
          ) : (
            <div style={{ padding: 24, color: textMuted }}>Loading constraint geometry…</div>
          )
        ) : (
          <div style={{ padding: 24, color: textMuted }}>
            2D constraint visualization unavailable in standalone mode.
          </div>
        ))}

      {activeTab === "constraints3d" &&
        (Constraints3DComponent ? (
          geometry ? (
            <Suspense fallback={<div style={{ padding: 24, color: textMuted }}>Loading 3D renderer…</div>}>
              <Constraints3DComponent geometry={geometry} solution={result.variables ?? {}} />
            </Suspense>
          ) : (
            <div style={{ padding: 24, color: textMuted }}>Loading 3D geometry…</div>
          )
        ) : (
          <div style={{ padding: 24, color: textMuted }}>
            3D constraint visualization unavailable in standalone mode.
          </div>
        ))}

      {activeTab === "landscape" &&
        (FitnessLandscapeComponent ? (
          geometry ? (
            <FitnessLandscapeComponent geometry={geometry} documentUri={documentUri} documentText={documentText} />
          ) : (
            <div style={{ padding: 24, color: textMuted }}>Loading sweep targets…</div>
          )
        ) : (
          <div style={{ padding: 24, color: textMuted }}>
            Fitness landscape visualization unavailable in standalone mode.
          </div>
        ))}

      {activeTab === "pareto" &&
        (ParetoFrontComponent ? (
          geometry ? (
            <ParetoFrontComponent geometry={geometry} documentUri={documentUri} documentText={documentText} />
          ) : (
            <div style={{ padding: 24, color: textMuted }}>Loading Pareto configuration…</div>
          )
        ) : (
          <div style={{ padding: 24, color: textMuted }}>
            Pareto front visualization unavailable in standalone mode.
          </div>
        ))}

      {activeTab === "summary" && (
        <>
          {/* KPI Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 8,
                border: `1px solid ${borderCol}`,
                borderLeft: `3px solid ${statusColor}`,
                backgroundColor: cardBg,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: textMuted, textTransform: "uppercase" }}>
                Objective Value
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2, fontFamily: "monospace" }}>
                {result.objectiveValue !== undefined && result.objectiveValue !== null
                  ? formatNum(result.objectiveValue)
                  : "—"}
              </div>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>{result.message ?? solverStatus}</div>
            </div>

            <div
              style={{
                padding: "12px 14px",
                borderRadius: 8,
                border: `1px solid ${borderCol}`,
                borderLeft: "3px solid var(--fgColor-accent, var(--ms-brand))",
                backgroundColor: cardBg,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: textMuted, textTransform: "uppercase" }}>
                Decision Variables
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{varEntries.length}</div>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>Primal solution values</div>
            </div>

            <div
              style={{
                padding: "12px 14px",
                borderRadius: 8,
                border: `1px solid ${borderCol}`,
                borderLeft: "3px solid #3fb950",
                backgroundColor: cardBg,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: textMuted, textTransform: "uppercase" }}>
                Constraints
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{constraintNames.length}</div>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>
                {result.iterations !== undefined ? `${result.iterations} solver iterations` : "Activity & duals"}
              </div>
            </div>

            <div
              style={{
                padding: "12px 14px",
                borderRadius: 8,
                border: `1px solid ${borderCol}`,
                borderLeft: "3px solid #a371f7",
                backgroundColor: cardBg,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: textMuted, textTransform: "uppercase" }}>
                Solve Time
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>
                {result.solveTimeMs !== undefined ? `${result.solveTimeMs} ms` : "—"}
              </div>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>In-browser WASM/TS solver</div>
            </div>
          </div>

          {/* Decision Variables Table */}
          <div style={{ border: `1px solid ${borderCol}`, borderRadius: 8, overflow: "hidden" }}>
            <div
              style={{
                padding: "9px 14px",
                backgroundColor: cardBg,
                borderBottom: `1px solid ${borderCol}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontWeight: 700,
              }}
            >
              <span>Optimal Decision Variables</span>
              <span style={{ fontSize: 11, color: textMuted, fontWeight: 500 }}>{varEntries.length} variables</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${borderCol}`, textAlign: "left", color: textMuted }}>
                    <th style={{ padding: "8px 14px" }}>Variable</th>
                    <th style={{ padding: "8px 14px" }}>Optimal Value</th>
                    <th style={{ padding: "8px 14px", minWidth: 120 }}>Magnitude</th>
                    <th style={{ padding: "8px 14px" }}>Reduced Cost</th>
                    <th style={{ padding: "8px 14px" }}>Bounds</th>
                    <th style={{ padding: "8px 14px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {varEntries.map(([name, val]) => {
                    const sfx = varSuffixes[name];
                    const rc = sfx?.["rc"] ?? result.reducedCosts?.[name];
                    const lbVal = sfx?.["lb"];
                    const ubVal = sfx?.["ub"];
                    const statusVal = sfx?.["status"];
                    const lb = lbVal !== null && lbVal !== undefined ? formatNum(lbVal) : "-∞";
                    const ub = ubVal !== null && ubVal !== undefined ? formatNum(ubVal) : "+∞";
                    const pct = Math.min(100, Math.round((Math.abs(Number(val) || 0) / maxAbsVar) * 100));
                    return (
                      <tr key={name} style={{ borderBottom: `1px solid ${borderCol}` }}>
                        <td style={{ padding: "8px 14px", fontFamily: "monospace", fontWeight: 600 }}>{name}</td>
                        <td style={{ padding: "8px 14px", fontFamily: "monospace", fontWeight: 700, color: "#22c55e" }}>
                          {formatNum(val)}
                        </td>
                        <td style={{ padding: "8px 14px" }}>
                          <div
                            style={{
                              width: "100%",
                              height: 7,
                              borderRadius: 4,
                              backgroundColor: "rgba(148, 163, 184, 0.16)",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: "100%",
                                backgroundColor: "#0d9488",
                                borderRadius: 4,
                              }}
                            />
                          </div>
                        </td>
                        <td style={{ padding: "8px 14px", fontFamily: "monospace" }}>{formatNum(rc)}</td>
                        <td style={{ padding: "8px 14px", fontFamily: "monospace", color: textMuted }}>
                          [{lb}, {ub}]
                        </td>
                        <td style={{ padding: "8px 14px" }}>
                          <span
                            style={{
                              fontSize: 11,
                              padding: "1px 6px",
                              borderRadius: 4,
                              border: `1px solid ${borderCol}`,
                              backgroundColor: cardBg,
                            }}
                          >
                            {statusVal !== undefined && statusVal !== null ? String(statusVal) : "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Constraints & Sensitivity Table */}
          {constraintNames.length > 0 && (
            <div style={{ border: `1px solid ${borderCol}`, borderRadius: 8, overflow: "hidden" }}>
              <div
                style={{
                  padding: "9px 14px",
                  backgroundColor: cardBg,
                  borderBottom: `1px solid ${borderCol}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontWeight: 700,
                }}
              >
                <span>Constraints, Slacks &amp; Dual Prices</span>
                <span style={{ fontSize: 11, color: textMuted, fontWeight: 500 }}>
                  {constraintNames.length} constraints
                </span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${borderCol}`, textAlign: "left", color: textMuted }}>
                      <th style={{ padding: "8px 14px" }}>Constraint</th>
                      <th style={{ padding: "8px 14px" }}>Activity</th>
                      <th style={{ padding: "8px 14px" }}>Slack</th>
                      <th style={{ padding: "8px 14px" }}>Dual (Shadow Price)</th>
                      <th style={{ padding: "8px 14px" }}>Bounds</th>
                      <th style={{ padding: "8px 14px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {constraintNames.map((name) => {
                      const c = constraintSuffixes[name]!;
                      const cLb = c["lb"];
                      const cUb = c["ub"];
                      const cSlack = c["slack"];
                      const cStatus = c["status"];
                      const lb = cLb !== null && cLb !== undefined ? formatNum(cLb) : "-∞";
                      const ub = cUb !== null && cUb !== undefined ? formatNum(cUb) : "+∞";
                      const isBinding = Math.abs(Number(cSlack ?? 0)) < 1e-9;
                      return (
                        <tr key={name} style={{ borderBottom: `1px solid ${borderCol}` }}>
                          <td style={{ padding: "8px 14px", fontFamily: "monospace", fontWeight: 600 }}>{name}</td>
                          <td style={{ padding: "8px 14px", fontFamily: "monospace" }}>{formatNum(c["body"])}</td>
                          <td
                            style={{
                              padding: "8px 14px",
                              fontFamily: "monospace",
                              color: isBinding ? "#d29922" : textPrimary,
                              fontWeight: isBinding ? 600 : 400,
                            }}
                          >
                            {formatNum(cSlack)}
                          </td>
                          <td style={{ padding: "8px 14px", fontFamily: "monospace", fontWeight: 600 }}>
                            {formatNum(c["dual"])}
                          </td>
                          <td style={{ padding: "8px 14px", fontFamily: "monospace", color: textMuted }}>
                            [{lb}, {ub}]
                          </td>
                          <td style={{ padding: "8px 14px" }}>
                            <span
                              style={{
                                fontSize: 11,
                                padding: "1px 6px",
                                borderRadius: 4,
                                border: `1px solid ${borderCol}`,
                                backgroundColor: isBinding ? "rgba(210, 153, 34, 0.14)" : cardBg,
                                color: isBinding ? "#d29922" : textPrimary,
                              }}
                            >
                              {isBinding
                                ? "binding"
                                : cStatus !== undefined && cStatus !== null
                                  ? String(cStatus)
                                  : "slack"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
