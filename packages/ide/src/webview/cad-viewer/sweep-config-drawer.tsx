// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from "react";

export interface ParametricVariableConfig {
  name: string;
  min: number;
  max: number;
  nominal?: number;
  distribution?: "uniform" | "normal" | "log-uniform";
}

export interface SweepRunInfo {
  runIndex: number;
  status: string;
  parameters: Record<string, number>;
  scalars?: Record<string, any>;
  durationMs?: number;
}

export interface ActiveSweepState {
  sweepId: string;
  status: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  progressPercent: number;
  runs?: SweepRunInfo[];
}

export interface SweepConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  solver: "calculix" | "su2";
  deckTemplateText?: string;
  detectedParameters?: string[];
  onLaunchSweep: (config: {
    title: string;
    strategy: "lhs" | "sobol" | "grid" | "random";
    sampleCount: number;
    concurrency: number;
    parameters: ParametricVariableConfig[];
  }) => void;
  onTrainSurrogate?: (sweepId: string) => void;
  activeSweepState?: ActiveSweepState | null;
}

export const SweepConfigDrawer: React.FC<SweepConfigDrawerProps> = ({
  isOpen,
  onClose,
  solver,
  deckTemplateText,
  detectedParameters = [],
  onLaunchSweep,
  onTrainSurrogate,
  activeSweepState,
}) => {
  const [title, setTitle] = useState(
    solver === "su2" ? "Aerodynamic Angle of Attack Sweep" : "Structural Load & Thickness Sweep",
  );
  const [strategy, setStrategy] = useState<"lhs" | "sobol" | "grid" | "random">("lhs");
  const [sampleCount, setSampleCount] = useState<number>(10);
  const [concurrency, setConcurrency] = useState<number>(4);

  // Initialize parameters from detected parameters or defaults
  const initialParams: ParametricVariableConfig[] = useMemo(() => {
    if (detectedParameters.length > 0) {
      return detectedParameters.map((name) => ({
        name,
        min: 10.0,
        max: 100.0,
        nominal: 50.0,
        distribution: "uniform",
      }));
    }
    return solver === "su2"
      ? [
          { name: "aoa", min: 0.0, max: 12.0, nominal: 4.0, distribution: "uniform" },
          { name: "v_inlet", min: 15.0, max: 45.0, nominal: 25.0, distribution: "uniform" },
        ]
      : [
          { name: "thrustForce", min: 100.0, max: 500.0, nominal: 250.0, distribution: "uniform" },
          { name: "youngsModulus", min: 50e9, max: 90e9, nominal: 70e9, distribution: "uniform" },
        ];
  }, [detectedParameters, solver]);

  const [parameters, setParameters] = useState<ParametricVariableConfig[]>(initialParams);

  if (!isOpen) return null;

  const handleAutoDetect = () => {
    if (!deckTemplateText) return;
    const exprRegex = /\{\{\s*([^}]+?)\s*\}\}/g;
    const found = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = exprRegex.exec(deckTemplateText)) !== null) {
      const body = match[1];
      if (!body) continue;
      const idents = body.match(/[A-Za-z_][A-Za-z0-9_.]*/g);
      if (idents) {
        for (const id of idents) {
          if (
            isNaN(Number(id)) &&
            !["sin", "cos", "tan", "sqrt", "exp", "log", "min", "max"].includes(id.toLowerCase())
          ) {
            found.add(id);
          }
        }
      }
    }
    if (found.size > 0) {
      const newVars: ParametricVariableConfig[] = Array.from(found).map((name) => {
        const existing = parameters.find((p) => p.name === name);
        return existing || { name, min: 10.0, max: 100.0, nominal: 50.0, distribution: "uniform" };
      });
      setParameters(newVars);
    }
  };

  const updateParam = (idx: number, patch: Partial<ParametricVariableConfig>) => {
    setParameters((prev) => {
      const copy = [...prev];
      if (copy[idx]) {
        copy[idx] = { ...copy[idx]!, ...patch };
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

  const isSweepRunning = activeSweepState && activeSweepState.status === "running";
  const isSweepCompleted =
    activeSweepState && (activeSweepState.status === "completed" || activeSweepState.status === "partial_success");

  return (
    <div
      style={{
        position: "absolute",
        top: "60px",
        right: "16px",
        width: "440px",
        maxHeight: "85vh",
        background: "rgba(15, 23, 42, 0.95)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(56, 189, 248, 0.35)",
        borderRadius: "14px",
        padding: "20px",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxShadow: "0 25px 50px rgba(0,0,0,0.65)",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        overflowY: "auto",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "20px" }}>📊</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "15px", color: "#38bdf8" }}>Parametric DoE Sweep</div>
            <div style={{ fontSize: "11px", color: "#94a3b8" }}>
              Cloud Batch Solver Orchestrator ({solver.toUpperCase()})
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "18px",
            padding: "4px",
          }}
        >
          ✕
        </button>
      </div>

      {/* Active Sweep Progress Dashboard (if active) */}
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
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0" }}>
              Sweep: {activeSweepState.sweepId.slice(0, 14)}...
            </span>
            <span
              style={{
                fontSize: "11px",
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
              height: "8px",
              background: "#334155",
              borderRadius: "4px",
              overflow: "hidden",
              marginBottom: "8px",
            }}
          >
            <div
              style={{
                width: `${activeSweepState.progressPercent}%`,
                height: "100%",
                background: "linear-gradient(90deg, #38bdf8 0%, #818cf8 100%)",
                transition: "width 0.3s ease",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94a3b8" }}>
            <span>
              Completed: {activeSweepState.completedRuns} / {activeSweepState.totalRuns} runs
            </span>
            <span>{activeSweepState.progressPercent}%</span>
          </div>

          {/* Run status mini-chips */}
          {activeSweepState.runs && activeSweepState.runs.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "10px" }}>
              {activeSweepState.runs.map((r) => (
                <div
                  key={r.runIndex}
                  title={`Run #${r.runIndex}: ${r.status}`}
                  style={{
                    width: "18px",
                    height: "18px",
                    borderRadius: "4px",
                    fontSize: "9px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 600,
                    background:
                      r.status === "completed"
                        ? "#15803d"
                        : r.status === "running"
                          ? "#0284c7"
                          : r.status === "failed"
                            ? "#b91c1c"
                            : "#475569",
                    color: "#fff",
                  }}
                >
                  {r.runIndex + 1}
                </div>
              ))}
            </div>
          )}

          {/* 1-Click Surrogate Training Action */}
          {isSweepCompleted && onTrainSurrogate && (
            <button
              onClick={() => onTrainSurrogate(activeSweepState.sweepId)}
              style={{
                marginTop: "12px",
                width: "100%",
                padding: "8px",
                background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
                border: "none",
                borderRadius: "6px",
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
              <span>⚡</span> Train Surrogate ROM from Sweep
            </button>
          )}
        </div>
      )}

      {/* Title & Parameter Space */}
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

      {/* Parameter Space Definition */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "#38bdf8" }}>Parameter Space Bounds</span>
          <button
            onClick={handleAutoDetect}
            style={{
              background: "#334155",
              border: "none",
              borderRadius: "4px",
              color: "#38bdf8",
              fontSize: "11px",
              padding: "3px 8px",
              cursor: "pointer",
            }}
          >
            🔍 Auto-Detect
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "180px", overflowY: "auto" }}>
          {parameters.map((p, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
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
                style={{
                  width: "100px",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: "4px",
                  color: "#e2e8f0",
                  padding: "4px",
                  fontSize: "11px",
                }}
              />
              <input
                type="number"
                value={p.min}
                onChange={(e) => updateParam(idx, { min: parseFloat(e.target.value) || 0 })}
                placeholder="min"
                style={{
                  width: "60px",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: "4px",
                  color: "#e2e8f0",
                  padding: "4px",
                  fontSize: "11px",
                }}
              />
              <span style={{ color: "#64748b" }}>–</span>
              <input
                type="number"
                value={p.max}
                onChange={(e) => updateParam(idx, { max: parseFloat(e.target.value) || 0 })}
                placeholder="max"
                style={{
                  width: "60px",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: "4px",
                  color: "#e2e8f0",
                  padding: "4px",
                  fontSize: "11px",
                }}
              />
              <button
                onClick={() => removeParam(idx)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#f87171",
                  cursor: "pointer",
                  marginLeft: "auto",
                  padding: "2px 6px",
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addParam}
          style={{
            marginTop: "6px",
            background: "transparent",
            border: "1px dashed #475569",
            borderRadius: "6px",
            color: "#94a3b8",
            width: "100%",
            padding: "4px",
            fontSize: "11px",
            cursor: "pointer",
          }}
        >
          + Add Parameter
        </button>
      </div>

      {/* Sampling Strategy & Concurrency */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <div>
          <label style={{ fontSize: "11px", color: "#94a3b8", display: "block", marginBottom: "4px" }}>
            Sampling Strategy
          </label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as any)}
            style={{
              width: "100%",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              padding: "6px",
              color: "#f8fafc",
              fontSize: "11px",
            }}
          >
            <option value="lhs">Latin Hypercube (LHS)</option>
            <option value="sobol">Sobol Quasi-Random</option>
            <option value="grid">Cartesian Grid</option>
            <option value="random">Uniform Monte Carlo</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: "11px", color: "#94a3b8", display: "block", marginBottom: "4px" }}>
            Sample Count (N)
          </label>
          <input
            type="number"
            min={2}
            max={100}
            value={sampleCount}
            onChange={(e) => setSampleCount(parseInt(e.target.value, 10) || 10)}
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

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
          <span style={{ color: "#94a3b8" }}>Parallel Workers (Concurrency)</span>
          <span style={{ color: "#38bdf8", fontWeight: 600 }}>{concurrency} cores</span>
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

      {/* Shared Mesh CAS notice */}
      <div
        style={{
          background: "rgba(56, 189, 248, 0.08)",
          border: "1px solid rgba(56, 189, 248, 0.2)",
          borderRadius: "6px",
          padding: "8px 10px",
          fontSize: "11px",
          color: "#94a3b8",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span>🔒</span>
        <span>
          <strong>Shared-Mesh CAS:</strong> Base geometry is referenced once across all {sampleCount} runs (&gt;95% disk
          savings).
        </span>
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
        <button
          onClick={handleLaunch}
          disabled={isSweepRunning || parameters.length === 0}
          style={{
            flex: 1,
            padding: "10px",
            background: isSweepRunning ? "#475569" : "linear-gradient(135deg, #0284c7 0%, #6366f1 100%)",
            border: "none",
            borderRadius: "8px",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: "13px",
            cursor: isSweepRunning ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
          }}
        >
          <span>🚀</span>
          {isSweepRunning ? "Sweep Running..." : "Launch DoE Sweep"}
        </button>
      </div>
    </div>
  );
};
