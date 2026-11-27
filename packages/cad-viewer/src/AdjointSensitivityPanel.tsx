// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from "react";

export type AdjointMode = "discrete-adjoint" | "nilss";

export type AdjointObjective = "minimize-drag-power" | "maximize-lift-to-drag" | "minimize-pressure-drop";

export interface AdjointRunConfig {
  mode: AdjointMode;
  objective: AdjointObjective;
  lbfgsMaxIterations: number;
  nilssSegmentsK: number;
  nilssSubspaceDimM: number;
}

export interface CadParameterSensitivity {
  paramName: string;
  cadFaceId?: string | undefined;
  currentValue?: number | undefined;
  /** Partial derivative dJ / dp_i */
  sensitivity: number;
  /** Recommended optimization step Delta p_i */
  recommendedStep: number;
  unit?: string | undefined;
}

export interface AdjointSensitivityResult {
  mode: AdjointMode;
  objective: AdjointObjective;
  objectiveDragPower: number;
  objectiveUnit?: string | undefined;
  maxGradientMagnitude: number;
  iterationsCompleted?: number | undefined;
  converged?: boolean | undefined;
  /** Shadowed sensitivity d<J>/ds in NILSS mode */
  shadowedSensitivity?: number | undefined;
  /** Leading Lyapunov exponents in NILSS mode */
  lyapunovExponents?: number[] | undefined;
  parameterSensitivities: CadParameterSensitivity[];
  solveTimeMs?: number | undefined;
}

export interface AdjointSensitivityPanelProps {
  result?: AdjointSensitivityResult | null | undefined;
  isRunning?: boolean | undefined;
  showSensitivityOverlay?: boolean | undefined;
  error?: string | null | undefined;
  initialConfig?: Partial<AdjointRunConfig> | undefined;
  onRunAdjoint: (config: AdjointRunConfig) => void;
  onApplyCadParameterStep: (paramName: string, delta: number) => void;
  onToggleSensitivityOverlay: (enabled: boolean) => void;
  onClose?: (() => void) | undefined;
}

const OBJECTIVE_LABELS: Record<AdjointObjective, string> = {
  "minimize-drag-power": "Minimize Drag Power",
  "maximize-lift-to-drag": "Maximize L/D",
  "minimize-pressure-drop": "Minimize Pressure Drop",
};

function formatSci(val: number): string {
  if (!Number.isFinite(val)) return "—";
  const abs = Math.abs(val);
  if (abs === 0) return "0.000";
  if (abs >= 1e3 || abs < 1e-2) {
    return val.toExponential(2);
  }
  return val.toFixed(3);
}

function formatSigned(val: number): string {
  if (!Number.isFinite(val)) return "—";
  const sign = val > 0 ? "+" : "";
  return `${sign}${formatSci(val)}`;
}

export const AdjointSensitivityPanel: React.FC<AdjointSensitivityPanelProps> = ({
  result,
  isRunning = false,
  showSensitivityOverlay = false,
  error,
  initialConfig,
  onRunAdjoint,
  onApplyCadParameterStep,
  onToggleSensitivityOverlay,
  onClose,
}) => {
  const [mode, setMode] = useState<AdjointMode>(initialConfig?.mode ?? "discrete-adjoint");
  const [objective, setObjective] = useState<AdjointObjective>(initialConfig?.objective ?? "minimize-drag-power");
  const [lbfgsMaxIterations, setLbfgsMaxIterations] = useState<number>(initialConfig?.lbfgsMaxIterations ?? 25);
  const [nilssSegmentsK, setNilssSegmentsK] = useState<number>(initialConfig?.nilssSegmentsK ?? 8);
  const [nilssSubspaceDimM, setNilssSubspaceDimM] = useState<number>(initialConfig?.nilssSubspaceDimM ?? 4);
  const [appliedParam, setAppliedParam] = useState<string | null>(null);

  const rankedParameters = useMemo(() => {
    if (!result?.parameterSensitivities?.length) return [];
    return [...result.parameterSensitivities].sort((a, b) => Math.abs(b.sensitivity) - Math.abs(a.sensitivity));
  }, [result]);

  const maxParamSensitivity = useMemo(() => {
    let maxVal = 0;
    for (const p of rankedParameters) {
      const a = Math.abs(p.sensitivity);
      if (a > maxVal) maxVal = a;
    }
    return maxVal > 0 ? maxVal : 1;
  }, [rankedParameters]);

  const maxAbsLyapunov = useMemo(() => {
    const exps = result?.lyapunovExponents;
    if (!exps || exps.length === 0) return 1;
    let m = 0;
    for (const v of exps) {
      const a = Math.abs(v);
      if (a > m) m = a;
    }
    return m > 0 ? m : 1;
  }, [result?.lyapunovExponents]);

  const handleRun = () => {
    onRunAdjoint({
      mode,
      objective,
      lbfgsMaxIterations: Math.max(1, Math.round(lbfgsMaxIterations)),
      nilssSegmentsK: Math.max(1, Math.round(nilssSegmentsK)),
      nilssSubspaceDimM: Math.max(1, Math.round(nilssSubspaceDimM)),
    });
  };

  const handleApplyStep = (param: CadParameterSensitivity) => {
    setAppliedParam(param.paramName);
    onApplyCadParameterStep(param.paramName, param.recommendedStep);
  };

  const isNilssActive = mode === "nilss";
  const showNilssMetrics =
    result !== null &&
    result !== undefined &&
    (result.mode === "nilss" ||
      result.shadowedSensitivity !== undefined ||
      (result.lyapunovExponents !== undefined && result.lyapunovExponents.length > 0));

  return (
    <div
      style={{
        width: "390px",
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
          <span style={{ fontSize: "15px" }}>∂</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "13px", color: "#38bdf8" }}>Differentiable CFD 2030 Adjoint</div>
            <div style={{ fontSize: "10px", color: "#94a3b8" }}>
              {isNilssActive
                ? "NILSS Chaotic Shadowing · Long-Time Turbulent Sensitivity"
                : "Discrete Adjoint LBM · Porosity & Shape Gradients"}
            </div>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Adjoint Sensitivity Panel"
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

      {/* Mode Toggle */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "4px",
          background: "rgba(0, 0, 0, 0.38)",
          padding: "3px",
          borderRadius: "8px",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          marginBottom: "10px",
        }}
      >
        <button
          type="button"
          onClick={() => setMode("discrete-adjoint")}
          style={{
            padding: "6px 8px",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
            fontSize: "10px",
            fontWeight: 600,
            lineHeight: 1.25,
            textAlign: "center",
            background:
              mode === "discrete-adjoint" ? "linear-gradient(135deg, #0284c7 0%, #2563eb 100%)" : "transparent",
            color: mode === "discrete-adjoint" ? "#ffffff" : "#94a3b8",
          }}
        >
          Discrete Adjoint LBM
          <div style={{ fontSize: "9px", fontWeight: 400, opacity: 0.85 }}>(Porosity / Shape)</div>
        </button>
        <button
          type="button"
          onClick={() => setMode("nilss")}
          style={{
            padding: "6px 8px",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
            fontSize: "10px",
            fontWeight: 600,
            lineHeight: 1.25,
            textAlign: "center",
            background: mode === "nilss" ? "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)" : "transparent",
            color: mode === "nilss" ? "#ffffff" : "#94a3b8",
          }}
        >
          NILSS Chaotic Shadowing
          <div style={{ fontSize: "9px", fontWeight: 400, opacity: 0.85 }}>(Turbulent Long-Time Avg)</div>
        </button>
      </div>

      {/* Configuration Inputs */}
      <div
        style={{
          background: "rgba(0, 0, 0, 0.3)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "8px",
          padding: "10px",
          marginBottom: "10px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <div>
          <label
            htmlFor="adjoint-objective-select"
            style={{
              display: "block",
              fontSize: "10px",
              color: "#94a3b8",
              marginBottom: "4px",
              fontWeight: 600,
            }}
          >
            Objective Functional J(u, p)
          </label>
          <select
            id="adjoint-objective-select"
            value={objective}
            onChange={(e) => setObjective(e.target.value as AdjointObjective)}
            style={{
              width: "100%",
              background: "#0f172a",
              color: "#f8fafc",
              border: "1px solid rgba(148, 163, 184, 0.3)",
              borderRadius: "6px",
              padding: "5px 8px",
              fontSize: "11px",
              outline: "none",
            }}
          >
            {(Object.keys(OBJECTIVE_LABELS) as AdjointObjective[]).map((key) => (
              <option key={key} value={key}>
                {OBJECTIVE_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isNilssActive ? "1fr 1fr 1fr" : "1fr",
            gap: "6px",
          }}
        >
          <div>
            <label
              htmlFor="adjoint-lbfgs-iters"
              style={{
                display: "block",
                fontSize: "10px",
                color: "#94a3b8",
                marginBottom: "3px",
              }}
            >
              L-BFGS-B Max Iters
            </label>
            <input
              id="adjoint-lbfgs-iters"
              type="number"
              min={1}
              max={500}
              step={1}
              value={lbfgsMaxIterations}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                setLbfgsMaxIterations(Number.isNaN(parsed) ? 1 : parsed);
              }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#0f172a",
                color: "#f8fafc",
                border: "1px solid rgba(148, 163, 184, 0.3)",
                borderRadius: "6px",
                padding: "4px 6px",
                fontSize: "11px",
                fontFamily: "monospace",
              }}
            />
          </div>

          {isNilssActive && (
            <>
              <div>
                <label
                  htmlFor="nilss-segments-k"
                  style={{
                    display: "block",
                    fontSize: "10px",
                    color: "#c4b5fd",
                    marginBottom: "3px",
                  }}
                >
                  NILSS Segments K
                </label>
                <input
                  id="nilss-segments-k"
                  type="number"
                  min={2}
                  max={128}
                  step={1}
                  value={nilssSegmentsK}
                  onChange={(e) => {
                    const parsed = Number.parseInt(e.target.value, 10);
                    setNilssSegmentsK(Number.isNaN(parsed) ? 2 : parsed);
                  }}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    background: "#0f172a",
                    color: "#f8fafc",
                    border: "1px solid rgba(167, 139, 250, 0.4)",
                    borderRadius: "6px",
                    padding: "4px 6px",
                    fontSize: "11px",
                    fontFamily: "monospace",
                  }}
                />
              </div>
              <div>
                <label
                  htmlFor="nilss-subspace-m"
                  style={{
                    display: "block",
                    fontSize: "10px",
                    color: "#c4b5fd",
                    marginBottom: "3px",
                  }}
                >
                  Tangent Dim M
                </label>
                <input
                  id="nilss-subspace-m"
                  type="number"
                  min={1}
                  max={32}
                  step={1}
                  value={nilssSubspaceDimM}
                  onChange={(e) => {
                    const parsed = Number.parseInt(e.target.value, 10);
                    setNilssSubspaceDimM(Number.isNaN(parsed) ? 1 : parsed);
                  }}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    background: "#0f172a",
                    color: "#f8fafc",
                    border: "1px solid rgba(167, 139, 250, 0.4)",
                    borderRadius: "6px",
                    padding: "4px 6px",
                    fontSize: "11px",
                    fontFamily: "monospace",
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Primary Action Row */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
        <button
          type="button"
          onClick={handleRun}
          disabled={isRunning}
          style={{
            flex: 1,
            padding: "8px 10px",
            background: isRunning
              ? "rgba(51, 65, 85, 0.9)"
              : isNilssActive
                ? "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)"
                : "linear-gradient(135deg, #0284c7 0%, #2563eb 100%)",
            border: "none",
            borderRadius: "6px",
            color: "#ffffff",
            fontSize: "11px",
            fontWeight: 700,
            cursor: isRunning ? "wait" : "pointer",
            opacity: isRunning ? 0.8 : 1,
          }}
        >
          {isRunning ? "⏳ Computing Adjoint Gradients..." : "▶ Run Adjoint Sensitivity"}
        </button>
      </div>

      {/* Overlay Sensitivity Toggle */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 9px",
          background: showSensitivityOverlay ? "rgba(14, 165, 233, 0.16)" : "rgba(0, 0, 0, 0.28)",
          border: `1px solid ${showSensitivityOverlay ? "rgba(56, 189, 248, 0.45)" : "rgba(255, 255, 255, 0.08)"}`,
          borderRadius: "6px",
          cursor: "pointer",
          marginBottom: "10px",
        }}
      >
        <span style={{ fontSize: "11px", fontWeight: 600, color: "#e2e8f0" }}>
          Overlay Sensitivity Field on 3D Mesh
        </span>
        <input
          type="checkbox"
          checked={showSensitivityOverlay}
          onChange={(e) => onToggleSensitivityOverlay(e.target.checked)}
          style={{ accentColor: "#38bdf8", cursor: "pointer" }}
        />
      </label>

      {error && (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: "6px",
            background: "rgba(127, 29, 29, 0.65)",
            border: "1px solid rgba(248, 113, 113, 0.5)",
            color: "#fecaca",
            fontSize: "10px",
            marginBottom: "10px",
          }}
        >
          {error}
        </div>
      )}

      {/* Results View */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Summary KPI Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
            <div
              style={{
                background: "rgba(0, 0, 0, 0.38)",
                border: "1px solid rgba(255, 255, 255, 0.07)",
                borderRadius: "6px",
                padding: "7px 8px",
              }}
            >
              <div style={{ fontSize: "9px", color: "#94a3b8", textTransform: "uppercase" }}>
                Objective Value (Drag Power)
              </div>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#f8fafc",
                  fontFamily: "monospace",
                  marginTop: "2px",
                }}
              >
                {formatSci(result.objectiveDragPower)}
                {result.objectiveUnit ? ` ${result.objectiveUnit}` : " W"}
              </div>
            </div>

            <div
              style={{
                background: "rgba(0, 0, 0, 0.38)",
                border: "1px solid rgba(255, 255, 255, 0.07)",
                borderRadius: "6px",
                padding: "7px 8px",
              }}
            >
              <div style={{ fontSize: "9px", color: "#94a3b8", textTransform: "uppercase" }}>Max Gradient ‖∇J‖∞</div>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#38bdf8",
                  fontFamily: "monospace",
                  marginTop: "2px",
                }}
              >
                {formatSci(result.maxGradientMagnitude)}
              </div>
            </div>
          </div>

          {/* NILSS Shadowed Sensitivity & Leading Lyapunov Exponents */}
          {showNilssMetrics && (
            <div
              style={{
                background: "rgba(76, 29, 149, 0.25)",
                border: "1px solid rgba(167, 139, 250, 0.35)",
                borderRadius: "8px",
                padding: "8px 10px",
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
                <span style={{ fontSize: "10px", fontWeight: 700, color: "#ddd6fe" }}>
                  NILSS Shadowed Sensitivity d⟨J⟩/ds
                </span>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#c4b5fd",
                    fontFamily: "monospace",
                  }}
                >
                  {result.shadowedSensitivity !== undefined ? formatSigned(result.shadowedSensitivity) : "—"}
                </span>
              </div>

              {result.lyapunovExponents && result.lyapunovExponents.length > 0 && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "9px",
                      color: "#a78bfa",
                      marginBottom: "4px",
                    }}
                  >
                    <span>Leading Lyapunov Exponents (λ₁…λₘ)</span>
                    <span>
                      Unstable modes: {result.lyapunovExponents.filter((lambda) => lambda > 0).length}/
                      {result.lyapunovExponents.length}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    {result.lyapunovExponents.map((lambda, idx) => {
                      const pct = Math.min(100, (Math.abs(lambda) / maxAbsLyapunov) * 100);
                      const isPositive = lambda > 0;
                      return (
                        <div
                          key={`lyap-${idx}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "28px 1fr 54px",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "10px",
                            fontFamily: "monospace",
                          }}
                        >
                          <span style={{ color: "#cbd5e1" }}>λ{idx + 1}</span>
                          <div
                            style={{
                              height: "6px",
                              background: "rgba(15, 23, 42, 0.7)",
                              borderRadius: "3px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: "100%",
                                background: isPositive ? "#f97316" : "#34d399",
                                borderRadius: "3px",
                              }}
                            />
                          </div>
                          <span
                            style={{
                              textAlign: "right",
                              color: isPositive ? "#fdba74" : "#6ee7b7",
                            }}
                          >
                            {formatSigned(lambda)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Ranked CAD Parameter Sensitivity Table */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "6px",
              }}
            >
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#cbd5e1" }}>
                Ranked CAD Parameter Sensitivities
              </span>
              {result.solveTimeMs !== undefined && (
                <span style={{ fontSize: "9px", color: "#94a3b8", fontFamily: "monospace" }}>
                  {result.solveTimeMs.toFixed(0)} ms
                </span>
              )}
            </div>

            {rankedParameters.length === 0 ? (
              <div
                style={{
                  padding: "10px",
                  textAlign: "center",
                  color: "#94a3b8",
                  background: "rgba(0, 0, 0, 0.25)",
                  borderRadius: "6px",
                  fontSize: "10px",
                }}
              >
                No CAD parameters projected from sensitivity field.
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                {rankedParameters.map((param, idx) => {
                  const barPct = Math.min(100, (Math.abs(param.sensitivity) / maxParamSensitivity) * 100);
                  const isNeg = param.sensitivity < 0;
                  const wasApplied = appliedParam === param.paramName;
                  return (
                    <div
                      key={param.paramName}
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
                          marginBottom: "4px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0 }}>
                          <span
                            style={{
                              fontSize: "9px",
                              fontWeight: 700,
                              color: "#38bdf8",
                              background: "rgba(56, 189, 248, 0.14)",
                              padding: "1px 4px",
                              borderRadius: "3px",
                            }}
                          >
                            #{idx + 1}
                          </span>
                          <span
                            style={{
                              fontWeight: 600,
                              color: "#f8fafc",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={param.paramName}
                          >
                            {param.paramName}
                          </span>
                          {param.cadFaceId && (
                            <span
                              style={{
                                fontSize: "9px",
                                fontFamily: "monospace",
                                color: "#94a3b8",
                                background: "rgba(255, 255, 255, 0.06)",
                                padding: "1px 4px",
                                borderRadius: "3px",
                              }}
                            >
                              {param.cadFaceId}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleApplyStep(param)}
                          style={{
                            flexShrink: 0,
                            padding: "3px 7px",
                            background: wasApplied ? "rgba(16, 185, 129, 0.25)" : "rgba(14, 165, 233, 0.22)",
                            border: `1px solid ${wasApplied ? "rgba(52, 211, 153, 0.5)" : "rgba(56, 189, 248, 0.45)"}`,
                            borderRadius: "4px",
                            color: wasApplied ? "#6ee7b7" : "#7dd3fc",
                            fontSize: "10px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {wasApplied ? "✓ Applied" : "Apply Step to CAD"}
                        </button>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "10px",
                          fontFamily: "monospace",
                          color: "#cbd5e1",
                          marginBottom: "4px",
                        }}
                      >
                        <span>
                          ∂J/∂pᵢ:{" "}
                          <strong style={{ color: isNeg ? "#34d399" : "#fbbf24" }}>
                            {formatSigned(param.sensitivity)}
                          </strong>
                        </span>
                        <span>
                          Δpᵢ:{" "}
                          <strong style={{ color: "#38bdf8" }}>
                            {formatSigned(param.recommendedStep)}
                            {param.unit ? ` ${param.unit}` : ""}
                          </strong>
                        </span>
                      </div>

                      <div
                        style={{
                          height: "4px",
                          background: "rgba(148, 163, 184, 0.16)",
                          borderRadius: "2px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${barPct}%`,
                            height: "100%",
                            background: isNeg
                              ? "linear-gradient(90deg, #10b981, #34d399)"
                              : "linear-gradient(90deg, #f59e0b, #fbbf24)",
                            borderRadius: "2px",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
