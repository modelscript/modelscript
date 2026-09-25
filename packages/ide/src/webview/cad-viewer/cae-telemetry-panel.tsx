// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from "react";

export interface TelemetryDataPoint {
  iteration: number;
  time?: number;
  residual?: number;
  metrics?: Record<string, number>;
  rawLog?: string;
}

export interface CaeTelemetryPanelProps {
  isOpen: boolean;
  solverName?: string;
  onClose: () => void;
  telemetryPoints: TelemetryDataPoint[];
  currentPhase?: string;
}

/**
 * Floating HUD telemetry & convergence panel.
 * Displays real-time iteration residual convergence curves and stdout logs from cloud solvers.
 */
export function CaeTelemetryPanel({
  isOpen,
  solverName = "Cloud Solver",
  onClose,
  telemetryPoints,
  currentPhase = "Running...",
}: CaeTelemetryPanelProps) {
  if (!isOpen) return null;

  const latest = telemetryPoints[telemetryPoints.length - 1];

  // SVG Convergence Chart coordinates
  const svgPath = useMemo(() => {
    if (telemetryPoints.length < 2) return "";
    const width = 280;
    const height = 80;

    const resVals = telemetryPoints
      .map((p) => p.residual ?? (p.metrics ? Object.values(p.metrics)[0] : undefined))
      .filter((v): v is number => v !== undefined && !Number.isNaN(v) && v > 0);

    if (resVals.length < 2) return "";

    const logVals = resVals.map((v) => Math.log10(v));
    const minLog = Math.min(...logVals);
    const maxLog = Math.max(...logVals);
    const range = maxLog - minLog || 1;

    const points = logVals.map((val, idx) => {
      const x = (idx / (logVals.length - 1)) * width;
      const y = height - ((val - minLog) / range) * (height - 10) - 5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return `M ${points.join(" L ")}`;
  }, [telemetryPoints]);

  return (
    <div
      style={{
        position: "absolute",
        bottom: "20px",
        right: "20px",
        width: "320px",
        background: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(59, 130, 246, 0.3)",
        borderRadius: "12px",
        padding: "16px",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
        fontSize: "12px",
        zIndex: 50,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#10b981",
              boxShadow: "0 0 8px #10b981",
              display: "inline-block",
            }}
          />
          <span style={{ fontWeight: 700, fontSize: "13px", color: "#60a5fa" }}>🚀 {solverName}</span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "16px",
            padding: "0 4px",
          }}
        >
          ✕
        </button>
      </div>

      {/* Phase & Iteration Info */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", color: "#cbd5e1" }}>
        <span>
          Status: <strong style={{ color: "#38bdf8" }}>{currentPhase}</strong>
        </span>
        <span>
          Iter: <strong style={{ color: "#facc15" }}>{latest?.iteration ?? 0}</strong>
        </span>
      </div>

      {/* Convergence Curve (Residuals vs Iterations) */}
      <div style={{ marginBottom: "10px", background: "rgba(0,0,0,0.4)", borderRadius: "6px", padding: "8px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "10px",
            color: "#64748b",
            marginBottom: "4px",
          }}
        >
          <span>log10(Residual)</span>
          <span>{latest?.residual !== undefined ? latest.residual.toExponential(3) : "—"}</span>
        </div>
        <svg width="280" height="80" style={{ overflow: "visible" }}>
          {/* Grid lines */}
          <line x1="0" y1="20" x2="280" y2="20" stroke="rgba(255,255,255,0.06)" strokeDasharray="2,2" />
          <line x1="0" y1="40" x2="280" y2="40" stroke="rgba(255,255,255,0.06)" strokeDasharray="2,2" />
          <line x1="0" y1="60" x2="280" y2="60" stroke="rgba(255,255,255,0.06)" strokeDasharray="2,2" />
          {/* Curve */}
          {svgPath && (
            <path
              d={svgPath}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      </div>

      {/* Terminal log stream */}
      <div
        style={{
          maxHeight: "80px",
          overflowY: "auto",
          background: "#090d16",
          borderRadius: "6px",
          padding: "6px 8px",
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#94a3b8",
          lineHeight: "1.4",
        }}
      >
        {telemetryPoints.slice(-5).map((pt, idx) => (
          <div key={idx} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {pt.rawLog || `Iter ${pt.iteration}: res = ${pt.residual?.toExponential(2) ?? "—"}`}
          </div>
        ))}
      </div>
    </div>
  );
}
