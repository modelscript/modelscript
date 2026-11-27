// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from "react";

export type DigitalThreadTab = "thread" | "bridge" | "vv";

export type HyperedgeSyncStatus = "Synced" | "Stale" | "Modified";

export interface DigitalThreadHyperedge {
  id: string;
  cadFaceId: string;
  cfdPatchId?: string | undefined;
  feaSetId?: string | undefined;
  modelicaPortId?: string | undefined;
  status: HyperedgeSyncStatus;
  impactedStudies?: string[] | undefined;
  lastSyncedAt?: string | undefined;
}

export interface ModelicaPeakLoadChannel {
  id: string;
  channelName: string;
  kind: "thrust" | "force" | "torque" | "pressure" | "thermal";
  peakValue: number;
  unit: string;
  peakTimeSec?: number | undefined;
  targetFaceId?: string | undefined;
}

export interface PodRomBridgeSummary {
  modelName: string;
  modeCount: number;
  /** Evaluation latency in microseconds (e.g. <50 us/eval) */
  evalLatencyUs: number;
  capturedEnergyPercent?: number | undefined;
  stateCount?: number | undefined;
  compiledAt?: string | undefined;
}

export type VvCaseStatus = "Pass" | "Fail" | "Pending";

export interface NasaVvCaseResult {
  id:
    | "VV-01-Poiseuille3D"
    | "VV-02-Cylinder3D-WMLES"
    | "VV-03-SpaldingWallLaw"
    | "VV-04-DistributedHalo2x2"
    | "VV-05-DiscreteAdjointFD"
    | (string & {});
  title: string;
  status: VvCaseStatus;
  relativeErrorNorm?: number | undefined;
  tolerance?: number | undefined;
  metricLabel?: string | undefined;
}

export const DEFAULT_NASA_CFD_2030_VV_CASES: readonly NasaVvCaseResult[] = [
  {
    id: "VV-01-Poiseuille3D",
    title: "3D Poiseuille Analytical Hagen-Poiseuille Profile",
    status: "Pending",
    tolerance: 1e-2,
    metricLabel: "L₂ velocity error",
  },
  {
    id: "VV-02-Cylinder3D-WMLES",
    title: "3D Circular Cylinder WMLES Strouhal & Cd",
    status: "Pending",
    tolerance: 5e-2,
    metricLabel: "St / Cd error",
  },
  {
    id: "VV-03-SpaldingWallLaw",
    title: "Spalding Smooth-Wall u⁺(y⁺) Equilibrium Law",
    status: "Pending",
    tolerance: 1e-2,
    metricLabel: "u⁺ residual",
  },
  {
    id: "VV-04-DistributedHalo2x2",
    title: "2×2 Distributed Subdomain Halo Conservation",
    status: "Pending",
    tolerance: 1e-6,
    metricLabel: "halo Δρ/ρ",
  },
  {
    id: "VV-05-DiscreteAdjointFD",
    title: "Discrete Adjoint vs Central Finite-Difference",
    status: "Pending",
    tolerance: 1e-4,
    metricLabel: "rel. grad err",
  },
];

export interface DigitalThreadCaePanelProps {
  hyperedges: DigitalThreadHyperedge[];
  blastRadiusCount: number;
  impactedStudyNames?: string[] | undefined;
  modelicaLoadChannels?: ModelicaPeakLoadChannel[] | undefined;
  podRomSummary?: PodRomBridgeSummary | null | undefined;
  vvCases?: NasaVvCaseResult[] | undefined;
  isReconciling?: boolean | undefined;
  isImportingLoads?: boolean | undefined;
  isExportingPod?: boolean | undefined;
  isRunningVv?: boolean | undefined;
  isExportingCgns?: boolean | undefined;
  initialTab?: DigitalThreadTab | undefined;
  onReconcileThread: () => void;
  onImportModelicaLoads: () => void;
  onExportPodToModelica: () => void;
  onRunVvScorecard: () => void;
  onExportCgns: () => void;
  onSelectHyperedge?: ((edge: DigitalThreadHyperedge) => void) | undefined;
  onClose?: (() => void) | undefined;
}

function getStatusPillStyle(status: HyperedgeSyncStatus): {
  bg: string;
  border: string;
  color: string;
} {
  switch (status) {
    case "Synced":
      return {
        bg: "rgba(16, 185, 129, 0.18)",
        border: "rgba(52, 211, 153, 0.45)",
        color: "#6ee7b7",
      };
    case "Stale":
      return {
        bg: "rgba(245, 158, 11, 0.18)",
        border: "rgba(251, 191, 36, 0.45)",
        color: "#fcd34d",
      };
    case "Modified":
      return {
        bg: "rgba(239, 68, 68, 0.2)",
        border: "rgba(248, 113, 113, 0.5)",
        color: "#fca5a5",
      };
  }
}

function formatErrorNorm(val: number | undefined): string {
  if (val === undefined || !Number.isFinite(val)) return "—";
  if (val === 0) return "0.00e+0";
  return val < 1e-2 || val >= 1e3 ? val.toExponential(2) : val.toFixed(4);
}

export const DigitalThreadCaePanel: React.FC<DigitalThreadCaePanelProps> = ({
  hyperedges,
  blastRadiusCount,
  impactedStudyNames,
  modelicaLoadChannels,
  podRomSummary,
  vvCases,
  isReconciling = false,
  isImportingLoads = false,
  isExportingPod = false,
  isRunningVv = false,
  isExportingCgns = false,
  initialTab = "thread",
  onReconcileThread,
  onImportModelicaLoads,
  onExportPodToModelica,
  onRunVvScorecard,
  onExportCgns,
  onSelectHyperedge,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<DigitalThreadTab>(initialTab);

  const resolvedVvCases = useMemo<readonly NasaVvCaseResult[]>(() => {
    if (vvCases && vvCases.length > 0) return vvCases;
    return DEFAULT_NASA_CFD_2030_VV_CASES;
  }, [vvCases]);

  const vvSummary = useMemo(() => {
    const total = resolvedVvCases.length;
    const passed = resolvedVvCases.filter((c) => c.status === "Pass").length;
    const failed = resolvedVvCases.filter((c) => c.status === "Fail").length;
    const pending = total - passed - failed;
    const allPassed = total > 0 && passed === total;
    return { total, passed, failed, pending, allPassed };
  }, [resolvedVvCases]);

  const staleOrModifiedCount = useMemo(() => hyperedges.filter((e) => e.status !== "Synced").length, [hyperedges]);

  const latencyLabel = useMemo(() => {
    if (!podRomSummary) return "<50 µs/eval";
    return podRomSummary.evalLatencyUs < 50
      ? `${podRomSummary.evalLatencyUs.toFixed(1)} µs/eval (<50 µs)`
      : `${podRomSummary.evalLatencyUs.toFixed(1)} µs/eval`;
  }, [podRomSummary]);

  return (
    <div
      style={{
        width: "410px",
        maxHeight: "calc(100vh - 96px)",
        overflowY: "auto",
        background: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(56, 189, 248, 0.35)",
        borderRadius: "12px",
        padding: "14px",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxShadow: "0 20px 40px rgba(0, 0, 0, 0.6)",
        fontSize: "11px",
        pointerEvents: "auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "15px" }}>🧬</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "13px", color: "#38bdf8" }}>
              Digital Thread &amp; CFD 2030 V&amp;V
            </div>
            <div style={{ fontSize: "10px", color: "#94a3b8" }}>Hypergraph Sync · 1D↔3D Bridge · NASA Credibility</div>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Digital Thread CAE Panel"
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: "14px",
              lineHeight: 1,
              padding: "2px 4px",
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* 3 Subtabs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "4px",
          background: "rgba(0, 0, 0, 0.38)",
          padding: "3px",
          borderRadius: "8px",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          marginBottom: "12px",
        }}
      >
        {(
          [
            {
              id: "thread",
              label: "1. Thread Sync",
              badge: blastRadiusCount > 0 ? String(blastRadiusCount) : undefined,
            },
            { id: "bridge", label: "2. 1D↔3D Bridge" },
            {
              id: "vv",
              label: "3. V&V / CGNS",
              badge: vvSummary.pending < vvSummary.total ? `${vvSummary.passed}/${vvSummary.total}` : undefined,
            },
          ] as const
        ).map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "6px 6px",
                borderRadius: "6px",
                border: "none",
                cursor: "pointer",
                fontSize: "10px",
                fontWeight: 600,
                background: isActive ? "linear-gradient(135deg, #0284c7 0%, #2563eb 100%)" : "transparent",
                color: isActive ? "#ffffff" : "#94a3b8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "4px",
              }}
            >
              <span>{tab.label}</span>
              {"badge" in tab && tab.badge && (
                <span
                  style={{
                    fontSize: "9px",
                    padding: "0 4px",
                    borderRadius: "8px",
                    background: isActive ? "rgba(255,255,255,0.22)" : "rgba(56,189,248,0.2)",
                    color: isActive ? "#fff" : "#7dd3fc",
                    fontFamily: "monospace",
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* SECTION 1: Digital Thread Sync & Blast Radius */}
      {activeTab === "thread" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Blast Radius Banner */}
          <div
            style={{
              background: blastRadiusCount > 0 ? "rgba(180, 83, 9, 0.25)" : "rgba(6, 78, 59, 0.28)",
              border: `1px solid ${blastRadiusCount > 0 ? "rgba(251, 191, 36, 0.45)" : "rgba(52, 211, 153, 0.4)"}`,
              borderRadius: "8px",
              padding: "8px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: impactedStudyNames && impactedStudyNames.length > 0 ? "5px" : "0px",
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  fontSize: "11px",
                  color: blastRadiusCount > 0 ? "#fcd34d" : "#6ee7b7",
                }}
              >
                {blastRadiusCount > 0
                  ? `⚠ Blast Radius: ${blastRadiusCount} Downstream ${blastRadiusCount === 1 ? "Study" : "Studies"} Impacted`
                  : "✓ Digital Thread Synchronized"}
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontFamily: "monospace",
                  color: "#cbd5e1",
                }}
              >
                {staleOrModifiedCount}/{hyperedges.length} stale
              </span>
            </div>

            {impactedStudyNames && impactedStudyNames.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {impactedStudyNames.map((study) => (
                  <span
                    key={study}
                    style={{
                      fontSize: "9px",
                      background: "rgba(0, 0, 0, 0.35)",
                      border: "1px solid rgba(251, 191, 36, 0.3)",
                      color: "#fde68a",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    {study}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Linked Hyperedges List */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {hyperedges.length === 0 ? (
              <div
                style={{
                  padding: "12px",
                  textAlign: "center",
                  color: "#94a3b8",
                  background: "rgba(0, 0, 0, 0.25)",
                  borderRadius: "6px",
                  fontSize: "10px",
                }}
              >
                No digital thread hyperedges linked yet.
              </div>
            ) : (
              hyperedges.map((edge) => {
                const pill = getStatusPillStyle(edge.status);
                const continuumTarget = edge.cfdPatchId
                  ? `CFD:${edge.cfdPatchId}`
                  : edge.feaSetId
                    ? `FEA:${edge.feaSetId}`
                    : "Unbound";
                return (
                  <div
                    key={edge.id}
                    onClick={() => onSelectHyperedge?.(edge)}
                    style={{
                      background: "rgba(0, 0, 0, 0.36)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: "6px",
                      padding: "7px 9px",
                      cursor: onSelectHyperedge ? "pointer" : "default",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "4px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontWeight: 700,
                          fontSize: "10px",
                          color: "#38bdf8",
                        }}
                      >
                        {edge.cadFaceId}
                      </span>
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: "999px",
                          background: pill.bg,
                          border: `1px solid ${pill.border}`,
                          color: pill.color,
                        }}
                      >
                        {edge.status}
                      </span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "4px",
                        fontSize: "10px",
                        fontFamily: "monospace",
                        color: "#cbd5e1",
                      }}
                    >
                      <span style={{ color: "#94a3b8" }}>↔</span>
                      <span
                        style={{
                          background: "rgba(56, 189, 248, 0.12)",
                          padding: "1px 5px",
                          borderRadius: "3px",
                          color: "#bae6fd",
                        }}
                      >
                        {continuumTarget}
                      </span>
                      {edge.cfdPatchId && edge.feaSetId && (
                        <span
                          style={{
                            background: "rgba(168, 85, 247, 0.14)",
                            padding: "1px 5px",
                            borderRadius: "3px",
                            color: "#e9d5ff",
                          }}
                        >
                          FEA:{edge.feaSetId}
                        </span>
                      )}
                      {edge.modelicaPortId && (
                        <>
                          <span style={{ color: "#94a3b8" }}>↔</span>
                          <span
                            style={{
                              background: "rgba(16, 185, 129, 0.14)",
                              padding: "1px 5px",
                              borderRadius: "3px",
                              color: "#a7f3d0",
                            }}
                          >
                            {edge.modelicaPortId}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Reconcile Button */}
          <button
            type="button"
            onClick={onReconcileThread}
            disabled={isReconciling}
            style={{
              width: "100%",
              padding: "8px 10px",
              background: isReconciling ? "rgba(51, 65, 85, 0.9)" : "linear-gradient(135deg, #d97706 0%, #ea580c 100%)",
              border: "none",
              borderRadius: "6px",
              color: "#ffffff",
              fontSize: "11px",
              fontWeight: 700,
              cursor: isReconciling ? "wait" : "pointer",
              opacity: isReconciling ? 0.8 : 1,
            }}
          >
            {isReconciling ? "⏳ Reconciling & Re-Running Stale Studies..." : "↻ Reconcile / Re-Run Stale Studies"}
          </button>
        </div>
      )}

      {/* SECTION 2: 1D Modelica <-> 3D Continuum Bridge */}
      {activeTab === "bridge" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* 1D -> 3D Peak Loads Import */}
          <div
            style={{
              background: "rgba(0, 0, 0, 0.34)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "8px",
              padding: "10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
              }}
            >
              <span style={{ fontWeight: 700, color: "#e2e8f0" }}>1D Modelica → 3D Continuum Loads</span>
              <span style={{ fontSize: "9px", color: "#94a3b8" }}>Peak Envelope</span>
            </div>

            <button
              type="button"
              onClick={onImportModelicaLoads}
              disabled={isImportingLoads}
              style={{
                width: "100%",
                padding: "7px 10px",
                background: isImportingLoads
                  ? "rgba(51, 65, 85, 0.9)"
                  : "linear-gradient(135deg, #0284c7 0%, #2563eb 100%)",
                border: "none",
                borderRadius: "6px",
                color: "#ffffff",
                fontSize: "11px",
                fontWeight: 600,
                cursor: isImportingLoads ? "wait" : "pointer",
                marginBottom: "8px",
              }}
            >
              {isImportingLoads ? "⏳ Extracting Peak Channels..." : "⬇ Import Peak 1D Loads from Modelica"}
            </button>

            {modelicaLoadChannels && modelicaLoadChannels.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                {modelicaLoadChannels.map((ch) => (
                  <div
                    key={ch.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: "rgba(15, 23, 42, 0.7)",
                      border: "1px solid rgba(255, 255, 255, 0.06)",
                      borderRadius: "5px",
                      padding: "5px 8px",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          color: "#f8fafc",
                          fontSize: "10px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {ch.channelName}
                      </div>
                      <div style={{ fontSize: "9px", color: "#94a3b8", fontFamily: "monospace" }}>
                        {ch.kind.toUpperCase()}
                        {ch.peakTimeSec !== undefined ? ` @ t=${ch.peakTimeSec.toFixed(2)}s` : ""}
                        {ch.targetFaceId ? ` → ${ch.targetFaceId}` : ""}
                      </div>
                    </div>
                    <div
                      style={{
                        fontFamily: "monospace",
                        fontWeight: 700,
                        fontSize: "11px",
                        color: "#38bdf8",
                        flexShrink: 0,
                      }}
                    >
                      {ch.peakValue.toFixed(2)} {ch.unit}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: "10px", color: "#94a3b8", textAlign: "center" }}>
                Import a Modelica trajectory to extract peak thrust, force &amp; torque channels.
              </div>
            )}
          </div>

          {/* 3D -> 1D POD-ROM Compilation */}
          <div
            style={{
              background: "rgba(0, 0, 0, 0.34)",
              border: "1px solid rgba(52, 211, 153, 0.22)",
              borderRadius: "8px",
              padding: "10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
              }}
            >
              <span style={{ fontWeight: 700, color: "#e2e8f0" }}>3D POD-ROM → 1D Modelica Block</span>
              <span
                style={{
                  fontSize: "9px",
                  fontFamily: "monospace",
                  color: "#34d399",
                  background: "rgba(16, 185, 129, 0.16)",
                  padding: "1px 5px",
                  borderRadius: "4px",
                }}
              >
                {latencyLabel}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "6px",
                marginBottom: "8px",
              }}
            >
              <div
                style={{
                  background: "rgba(15, 23, 42, 0.7)",
                  padding: "6px 8px",
                  borderRadius: "5px",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                }}
              >
                <div style={{ fontSize: "9px", color: "#94a3b8" }}>POD Mode Count</div>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#f8fafc",
                    fontFamily: "monospace",
                  }}
                >
                  {podRomSummary ? `${podRomSummary.modeCount} modes` : "—"}
                </div>
              </div>
              <div
                style={{
                  background: "rgba(15, 23, 42, 0.7)",
                  padding: "6px 8px",
                  borderRadius: "5px",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                }}
              >
                <div style={{ fontSize: "9px", color: "#94a3b8" }}>Eval Latency</div>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#34d399",
                    fontFamily: "monospace",
                  }}
                >
                  {podRomSummary ? `${podRomSummary.evalLatencyUs.toFixed(1)} µs` : "<50 µs/eval"}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onExportPodToModelica}
              disabled={isExportingPod}
              style={{
                width: "100%",
                padding: "7px 10px",
                background: isExportingPod
                  ? "rgba(51, 65, 85, 0.9)"
                  : "linear-gradient(135deg, #059669 0%, #0284c7 100%)",
                border: "none",
                borderRadius: "6px",
                color: "#ffffff",
                fontSize: "11px",
                fontWeight: 600,
                cursor: isExportingPod ? "wait" : "pointer",
              }}
            >
              {isExportingPod ? "⏳ Compiling Modelica DAE Block..." : "⚡ Compile POD-ROM → Modelica DAE Block"}
            </button>
          </div>
        </div>
      )}

      {/* SECTION 3: NASA CFD Vision 2030 V&V Scorecard & CGNS Export */}
      {activeTab === "vv" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Overall Credibility Badge */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 10px",
              borderRadius: "8px",
              background: vvSummary.allPassed
                ? "rgba(6, 78, 59, 0.45)"
                : vvSummary.failed > 0
                  ? "rgba(127, 29, 29, 0.45)"
                  : "rgba(30, 41, 59, 0.7)",
              border: `1px solid ${
                vvSummary.allPassed
                  ? "rgba(52, 211, 153, 0.5)"
                  : vvSummary.failed > 0
                    ? "rgba(248, 113, 113, 0.5)"
                    : "rgba(148, 163, 184, 0.3)"
              }`,
            }}
          >
            <div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "11px",
                  color: vvSummary.allPassed ? "#6ee7b7" : vvSummary.failed > 0 ? "#fca5a5" : "#cbd5e1",
                }}
              >
                {vvSummary.allPassed
                  ? "✓ NASA CFD 2030 Credibility Verified"
                  : vvSummary.failed > 0
                    ? "✕ V&V Credibility Action Required"
                    : "○ NASA CFD 2030 V&V Pending"}
              </div>
              <div style={{ fontSize: "9px", color: "#94a3b8" }}>Verification &amp; Validation Benchmark Scorecard</div>
            </div>
            <span
              style={{
                fontFamily: "monospace",
                fontWeight: 700,
                fontSize: "12px",
                color: vvSummary.allPassed ? "#34d399" : "#f8fafc",
              }}
            >
              {vvSummary.passed}/{vvSummary.total}
            </span>
          </div>

          {/* 5 NASA CFD 2030 Verification Cases */}
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            {resolvedVvCases.map((vv) => {
              const isPass = vv.status === "Pass";
              const isFail = vv.status === "Fail";
              return (
                <div
                  key={vv.id}
                  style={{
                    background: "rgba(0, 0, 0, 0.36)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "6px",
                    padding: "7px 8px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "6px",
                      marginBottom: "2px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontWeight: 700,
                        fontSize: "10px",
                        color: "#e2e8f0",
                      }}
                    >
                      {vv.id}
                    </span>
                    <span
                      style={{
                        fontSize: "9px",
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: "999px",
                        background: isPass
                          ? "rgba(16, 185, 129, 0.2)"
                          : isFail
                            ? "rgba(239, 68, 68, 0.2)"
                            : "rgba(148, 163, 184, 0.16)",
                        border: `1px solid ${
                          isPass
                            ? "rgba(52, 211, 153, 0.5)"
                            : isFail
                              ? "rgba(248, 113, 113, 0.5)"
                              : "rgba(148, 163, 184, 0.3)"
                        }`,
                        color: isPass ? "#6ee7b7" : isFail ? "#fca5a5" : "#cbd5e1",
                      }}
                    >
                      {vv.status}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "10px",
                      color: "#94a3b8",
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "230px",
                      }}
                      title={vv.title}
                    >
                      {vv.title}
                    </span>
                    <span style={{ fontFamily: "monospace", color: "#cbd5e1", flexShrink: 0 }}>
                      err: {formatErrorNorm(vv.relativeErrorNorm)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions: Run V&V Suite + Export CGNS */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <button
              type="button"
              onClick={onRunVvScorecard}
              disabled={isRunningVv}
              style={{
                width: "100%",
                padding: "8px 10px",
                background: isRunningVv ? "rgba(51, 65, 85, 0.9)" : "linear-gradient(135deg, #0284c7 0%, #2563eb 100%)",
                border: "none",
                borderRadius: "6px",
                color: "#ffffff",
                fontSize: "11px",
                fontWeight: 700,
                cursor: isRunningVv ? "wait" : "pointer",
              }}
            >
              {isRunningVv ? "⏳ Running NASA CFD 2030 V&V Suite..." : "▶ Run V&V Suite"}
            </button>

            <button
              type="button"
              onClick={onExportCgns}
              disabled={isExportingCgns}
              style={{
                width: "100%",
                padding: "7px 10px",
                background: "#1e293b",
                border: "1px solid rgba(255, 255, 255, 0.16)",
                borderRadius: "6px",
                color: "#e2e8f0",
                fontSize: "11px",
                fontWeight: 600,
                cursor: isExportingCgns ? "wait" : "pointer",
              }}
            >
              {isExportingCgns ? "⏳ Exporting CGNS SIDS Provenance..." : "📦 Export CGNS SIDS Provenance (.cgns.json)"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
