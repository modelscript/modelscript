// SPDX-License-Identifier: AGPL-3.0-or-later

import type React from "react";
import { useEffect, useMemo, useState } from "react";

export type SweepSamplingStrategy = "lhs" | "sobol" | "grid" | "random";

export type SweepSolverKind = "calculix" | "su2" | "openfoam" | "local-fea" | "local-cfd";

export interface ParametricVariableConfig {
  name: string;
  min: number;
  max: number;
  nominal?: number | undefined;
  distribution?: "uniform" | "normal" | "log-uniform" | undefined;
}

export interface SweepRunInfo {
  runIndex: number;
  status: "queued" | "running" | "completed" | "failed" | string;
  parameters: Record<string, number>;
  scalars?: Record<string, unknown> | undefined;
  durationMs?: number | undefined;
}

export interface ActiveSweepState {
  sweepId: string;
  status: "queued" | "running" | "completed" | "partial_success" | "failed" | string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  progressPercent: number;
  runs?: SweepRunInfo[] | undefined;
}

export interface SweepLaunchConfig {
  title: string;
  strategy: SweepSamplingStrategy;
  sampleCount: number;
  concurrency: number;
  parameters: ParametricVariableConfig[];
}

export interface SweepConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  solver: SweepSolverKind;
  deckTemplateText?: string | undefined;
  detectedParameters?: string[] | undefined;
  onLaunchSweep: (config: SweepLaunchConfig) => void;
  onTrainSurrogate?: ((sweepId: string) => void) | undefined;
  activeSweepState?: ActiveSweepState | null | undefined;
}

const IGNORED_TEMPLATE_IDENTS = new Set([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "sqrt",
  "abs",
  "exp",
  "log",
  "log10",
  "pow",
  "min",
  "max",
  "pi",
  "e",
]);

/** Extract unique `{{param}}` variable names from `.inp` / `.cfg` deck source text. */
export function extractTemplateParameters(sourceText: string): string[] {
  const exprRegex = /\{\{\s*([^}]+?)\s*\}\}/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = exprRegex.exec(sourceText)) !== null) {
    const body = match[1];
    if (!body) continue;
    const idents = body.match(/[A-Za-z_][A-Za-z0-9_.]*/g);
    if (!idents) continue;
    for (const id of idents) {
      if (Number.isNaN(Number(id)) && !IGNORED_TEMPLATE_IDENTS.has(id.toLowerCase())) {
        found.add(id);
      }
    }
  }
  return Array.from(found);
}

function isCfdSolver(solver: SweepSolverKind): boolean {
  return solver === "su2" || solver === "openfoam" || solver === "local-cfd";
}

function formatScalarPreview(scalars: Record<string, unknown> | undefined): string {
  if (!scalars) return "—";
  const entries = Object.entries(scalars).filter(([, v]) => typeof v === "number" && Number.isFinite(v));
  if (entries.length === 0) return "—";
  return entries
    .slice(0, 2)
    .map(([k, v]) => `${k}=${(v as number).toPrecision(3)}`)
    .join(", ");
}

export const SweepConfigDrawer: React.FC<SweepConfigDrawerProps> = ({
  isOpen,
  onClose,
  solver,
  deckTemplateText,
  detectedParameters,
  onLaunchSweep,
  onTrainSurrogate,
  activeSweepState,
}) => {
  const cfdMode = isCfdSolver(solver);

  const [title, setTitle] = useState(cfdMode ? "Aerodynamic & Flow DoE Sweep" : "Structural Load & Material DoE Sweep");
  const [strategy, setStrategy] = useState<SweepSamplingStrategy>("lhs");
  const [sampleCount, setSampleCount] = useState<number>(12);
  const [concurrency, setConcurrency] = useState<number>(4);

  const autoDetectedFromSource = useMemo(
    () => (deckTemplateText ? extractTemplateParameters(deckTemplateText) : []),
    [deckTemplateText],
  );

  const initialParams: ParametricVariableConfig[] = useMemo(() => {
    const names = detectedParameters && detectedParameters.length > 0 ? detectedParameters : autoDetectedFromSource;

    if (names.length > 0) {
      return names.map((name) => ({
        name,
        min: 10.0,
        max: 100.0,
        nominal: 50.0,
        distribution: "uniform",
      }));
    }

    return cfdMode
      ? [
          { name: "aoa", min: 0.0, max: 12.0, nominal: 4.0, distribution: "uniform" },
          { name: "v_inlet", min: 15.0, max: 45.0, nominal: 25.0, distribution: "uniform" },
        ]
      : [
          { name: "thrustForce", min: 100.0, max: 500.0, nominal: 250.0, distribution: "uniform" },
          { name: "youngsModulus", min: 50e9, max: 90e9, nominal: 70e9, distribution: "uniform" },
        ];
  }, [detectedParameters, autoDetectedFromSource, cfdMode]);

  const [parameters, setParameters] = useState<ParametricVariableConfig[]>(initialParams);

  // Sync newly detected parameters when deckTemplateText changes and user has not customized
  useEffect(() => {
    if (autoDetectedFromSource.length > 0) {
      setParameters((prev) => {
        const existingMap = new Map(prev.map((p) => [p.name, p]));
        return autoDetectedFromSource.map(
          (name) =>
            existingMap.get(name) ?? {
              name,
              min: 10.0,
              max: 100.0,
              nominal: 50.0,
              distribution: "uniform",
            },
        );
      });
    }
  }, [autoDetectedFromSource]);

  if (!isOpen) return null;

  const handleAutoDetect = () => {
    if (!deckTemplateText) return;
    const found = extractTemplateParameters(deckTemplateText);
    if (found.length > 0) {
      setParameters((prev) =>
        found.map((name) => {
          const existing = prev.find((p) => p.name === name);
          return existing ?? { name, min: 10.0, max: 100.0, nominal: 50.0, distribution: "uniform" };
        }),
      );
    }
  };

  const updateParam = (idx: number, patch: Partial<ParametricVariableConfig>) => {
    setParameters((prev) => {
      const copy = [...prev];
      const current = copy[idx];
      if (current) {
        copy[idx] = { ...current, ...patch };
      }
      return copy;
    });
  };

  const removeParam = (idx: number) => {
    setParameters((prev) => prev.filter((_, i) => i !== idx));
  };

  const addParam = () => {
    setParameters((prev) => [
      ...prev,
      { name: `param_${prev.length + 1}`, min: 0.0, max: 100.0, nominal: 50.0, distribution: "uniform" },
    ]);
  };

  const handleLaunch = () => {
    onLaunchSweep({
      title,
      strategy,
      sampleCount,
      concurrency,
      parameters,
    });
  };

  const isSweepRunning = Boolean(activeSweepState && activeSweepState.status === "running");
  const canTrainSurrogate = Boolean(
    activeSweepState &&
    onTrainSurrogate &&
    (activeSweepState.status === "completed" ||
      activeSweepState.status === "partial_success" ||
      activeSweepState.completedRuns >= 2),
  );

  const inputStyle: React.CSSProperties = {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "4px",
    color: "#e2e8f0",
    padding: "4px 6px",
    fontSize: "11px",
  };

  return (
    <div
      style={{
        position: "absolute",
        top: "60px",
        right: "16px",
        width: "460px",
        maxHeight: "86vh",
        background: "rgba(15, 23, 42, 0.95)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(56, 189, 248, 0.35)",
        borderRadius: "14px",
        padding: "18px 20px",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxShadow: "0 25px 50px rgba(0,0,0,0.65)",
        zIndex: 55,
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        overflowY: "auto",
        pointerEvents: "auto",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "18px" }}>📊</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", color: "#38bdf8" }}>Parametric DoE Sweep</div>
            <div style={{ fontSize: "11px", color: "#94a3b8" }}>
              Multi-Parameter Design of Experiments ({solver.toUpperCase()})
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sweep drawer"
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "17px",
            padding: "4px",
          }}
        >
          ✕
        </button>
      </div>

      {/* Active Sweep Progress & Live Run Status Table */}
      {activeSweepState && (
        <div
          style={{
            background: "rgba(30, 41, 59, 0.8)",
            border: "1px solid rgba(56, 189, 248, 0.25)",
            borderRadius: "10px",
            padding: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", fontFamily: "monospace" }}>
              Sweep: {activeSweepState.sweepId.slice(0, 16)}
            </span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                textTransform: "uppercase",
                padding: "2px 8px",
                borderRadius: "12px",
                background:
                  activeSweepState.status === "completed"
                    ? "rgba(34, 197, 94, 0.2)"
                    : activeSweepState.status === "failed"
                      ? "rgba(239, 68, 68, 0.2)"
                      : "rgba(56, 189, 248, 0.2)",
                color:
                  activeSweepState.status === "completed"
                    ? "#4ade80"
                    : activeSweepState.status === "failed"
                      ? "#f87171"
                      : "#38bdf8",
              }}
            >
              {activeSweepState.status}
            </span>
          </div>

          {/* Progress Bar */}
          <div
            style={{
              width: "100%",
              height: "7px",
              background: "#334155",
              borderRadius: "4px",
              overflow: "hidden",
              marginBottom: "6px",
            }}
          >
            <div
              style={{
                width: `${Math.max(0, Math.min(100, activeSweepState.progressPercent))}%`,
                height: "100%",
                background: "linear-gradient(90deg, #38bdf8 0%, #818cf8 100%)",
                transition: "width 0.3s ease",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94a3b8" }}>
            <span>
              Completed: {activeSweepState.completedRuns} / {activeSweepState.totalRuns}
              {activeSweepState.failedRuns > 0 ? ` (${activeSweepState.failedRuns} failed)` : ""}
            </span>
            <span style={{ fontFamily: "monospace" }}>{activeSweepState.progressPercent.toFixed(0)}%</span>
          </div>

          {/* Live Run Status Table */}
          {activeSweepState.runs && activeSweepState.runs.length > 0 && (
            <div
              style={{
                marginTop: "10px",
                maxHeight: "145px",
                overflowY: "auto",
                background: "#090f1d",
                borderRadius: "6px",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "10px",
                  fontFamily: "monospace",
                }}
              >
                <thead>
                  <tr style={{ background: "rgba(30, 41, 59, 0.9)", color: "#94a3b8", textAlign: "left" }}>
                    <th style={{ padding: "4px 6px" }}>#</th>
                    <th style={{ padding: "4px 6px" }}>Status</th>
                    <th style={{ padding: "4px 6px" }}>Params</th>
                    <th style={{ padding: "4px 6px" }}>Scalars</th>
                    <th style={{ padding: "4px 6px", textAlign: "right" }}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSweepState.runs.map((r) => {
                    const paramSummary = Object.entries(r.parameters)
                      .slice(0, 2)
                      .map(([k, v]) => `${k}=${v.toPrecision(3)}`)
                      .join(", ");
                    const statusColor =
                      r.status === "completed"
                        ? "#4ade80"
                        : r.status === "running"
                          ? "#38bdf8"
                          : r.status === "failed"
                            ? "#f87171"
                            : "#94a3b8";
                    return (
                      <tr key={r.runIndex} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                        <td style={{ padding: "4px 6px", color: "#cbd5e1" }}>{r.runIndex + 1}</td>
                        <td style={{ padding: "4px 6px", color: statusColor, fontWeight: 700 }}>{r.status}</td>
                        <td
                          style={{
                            padding: "4px 6px",
                            color: "#94a3b8",
                            maxWidth: "130px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={paramSummary}
                        >
                          {paramSummary || "—"}
                        </td>
                        <td
                          style={{
                            padding: "4px 6px",
                            color: "#cbd5e1",
                            maxWidth: "110px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatScalarPreview(r.scalars)}
                        </td>
                        <td style={{ padding: "4px 6px", textAlign: "right", color: "#64748b" }}>
                          {r.durationMs !== undefined ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Train POD Surrogate Callback Button */}
          {canTrainSurrogate && onTrainSurrogate && (
            <button
              type="button"
              onClick={() => onTrainSurrogate(activeSweepState.sweepId)}
              style={{
                marginTop: "10px",
                width: "100%",
                padding: "8px",
                background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
                border: "none",
                borderRadius: "7px",
                color: "#fff",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
              }}
            >
              <span>⚡</span> Train POD Surrogate
            </button>
          )}
        </div>
      )}

      {/* Study Title */}
      <div>
        <label style={{ fontSize: "11px", color: "#94a3b8", display: "block", marginBottom: "4px" }}>Study Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: "6px",
            padding: "6px 10px",
            color: "#f8fafc",
            fontSize: "12px",
          }}
        />
      </div>

      {/* Parameter Space Bounds */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "#38bdf8" }}>
            Parameter Space ({parameters.length})
          </span>
          <button
            type="button"
            onClick={handleAutoDetect}
            disabled={!deckTemplateText}
            title="Scan .inp / .cfg source for {{param}} template variables"
            style={{
              background: deckTemplateText ? "#334155" : "#1e293b",
              border: "none",
              borderRadius: "4px",
              color: deckTemplateText ? "#38bdf8" : "#64748b",
              fontSize: "11px",
              padding: "3px 8px",
              cursor: deckTemplateText ? "pointer" : "not-allowed",
            }}
          >
            🔍 Auto-Detect {"{{param}}"}
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "175px", overflowY: "auto" }}>
          {parameters.map((p, idx) => (
            <div
              key={`${p.name}-${idx}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1.3fr 0.75fr auto 0.75fr 0.9fr auto",
                alignItems: "center",
                gap: "5px",
                background: "#1e293b",
                padding: "6px",
                borderRadius: "6px",
                fontSize: "11px",
              }}
            >
              <input
                type="text"
                value={p.name}
                onChange={(e) => updateParam(idx, { name: e.target.value })}
                placeholder="name"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              />
              <input
                type="number"
                value={p.min}
                onChange={(e) => updateParam(idx, { min: parseFloat(e.target.value) || 0 })}
                placeholder="min"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              />
              <span style={{ color: "#64748b", textAlign: "center" }}>–</span>
              <input
                type="number"
                value={p.max}
                onChange={(e) => updateParam(idx, { max: parseFloat(e.target.value) || 0 })}
                placeholder="max"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              />
              <select
                value={p.distribution ?? "uniform"}
                onChange={(e) =>
                  updateParam(idx, {
                    distribution: e.target.value as "uniform" | "normal" | "log-uniform",
                  })
                }
                style={{ ...inputStyle, width: "100%", cursor: "pointer" }}
              >
                <option value="uniform">Uniform</option>
                <option value="normal">Normal</option>
                <option value="log-uniform">Log</option>
              </select>
              <button
                type="button"
                onClick={() => removeParam(idx)}
                aria-label={`Remove parameter ${p.name}`}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#f87171",
                  cursor: "pointer",
                  padding: "2px 4px",
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addParam}
          style={{
            marginTop: "6px",
            background: "transparent",
            border: "1px dashed #475569",
            borderRadius: "6px",
            color: "#94a3b8",
            width: "100%",
            padding: "5px",
            fontSize: "11px",
            cursor: "pointer",
          }}
        >
          + Add Parameter
        </button>
      </div>

      {/* Sampling Strategy & Sample Count */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <div>
          <label style={{ fontSize: "11px", color: "#94a3b8", display: "block", marginBottom: "4px" }}>
            Sampling Strategy
          </label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as SweepSamplingStrategy)}
            style={{
              width: "100%",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              padding: "6px",
              color: "#f8fafc",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            <option value="lhs">Latin Hypercube (LHS)</option>
            <option value="sobol">Sobol Quasi-Random</option>
            <option value="grid">Cartesian Grid</option>
            <option value="random">Uniform Random</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: "11px", color: "#94a3b8", display: "block", marginBottom: "4px" }}>
            Sample Count (N)
          </label>
          <input
            type="number"
            min={2}
            max={256}
            value={sampleCount}
            onChange={(e) => setSampleCount(Math.max(2, parseInt(e.target.value, 10) || 10))}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              padding: "6px",
              color: "#f8fafc",
              fontSize: "11px",
            }}
          />
        </div>
      </div>

      {/* Parallel Concurrency */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
          <span style={{ color: "#94a3b8" }}>Parallel Workers (Concurrency)</span>
          <span style={{ color: "#38bdf8", fontWeight: 600 }}>{concurrency} workers</span>
        </div>
        <input
          type="range"
          min={1}
          max={16}
          value={concurrency}
          onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
          style={{ width: "100%" }}
        />
      </div>

      {/* Launch Action */}
      <button
        type="button"
        onClick={handleLaunch}
        disabled={isSweepRunning || parameters.length === 0}
        style={{
          width: "100%",
          padding: "10px",
          background:
            isSweepRunning || parameters.length === 0 ? "#475569" : "linear-gradient(135deg, #0284c7 0%, #6366f1 100%)",
          border: "none",
          borderRadius: "8px",
          color: "#ffffff",
          fontWeight: 700,
          fontSize: "13px",
          cursor: isSweepRunning || parameters.length === 0 ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
        }}
      >
        <span>🚀</span>
        {isSweepRunning ? "Sweep Running..." : `Launch ${strategy.toUpperCase()} Sweep (${sampleCount} runs)`}
      </button>
    </div>
  );
};
