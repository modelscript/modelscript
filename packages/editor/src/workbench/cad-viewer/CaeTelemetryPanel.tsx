// SPDX-License-Identifier: AGPL-3.0-or-later

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface AerodynamicMonitorSnapshot {
  fx?: number | undefined;
  fy?: number | undefined;
  fz?: number | undefined;
  cd?: number | undefined;
  cl?: number | undefined;
  pressureDropPa?: number | undefined;
}

export interface TelemetryDataPoint {
  iteration: number;
  time?: number | undefined;
  residual?: number | undefined;
  /** Optional multi-equation residual channels (e.g. continuity, ux, uy, uz, k, omega, energy). */
  residuals?: Record<string, number> | undefined;
  metrics?: Record<string, number> | undefined;
  forces?: AerodynamicMonitorSnapshot | undefined;
  rawLog?: string | undefined;
}

export interface CaeTelemetryPanelProps {
  isOpen: boolean;
  solverName?: string | undefined;
  onClose: () => void;
  onCancel?: (() => void) | undefined;
  telemetryPoints: TelemetryDataPoint[];
  currentPhase?: string | undefined;
  maxIterations?: number | undefined;
  progressPercent?: number | undefined;
  targetResidual?: number | undefined;
  aerodynamicMonitor?: AerodynamicMonitorSnapshot | undefined;
  isRunning?: boolean | undefined;
}

const SERIES_PALETTE = ["#38bdf8", "#34d399", "#f472b6", "#fbbf24", "#a78bfa", "#fb923c"];

function formatForce(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1e3) return `${(val / 1e3).toFixed(2)} kN`;
  return `${val.toFixed(2)} N`;
}

function formatPressureDrop(pa: number): string {
  const abs = Math.abs(pa);
  if (abs >= 1e3) return `${(pa / 1e3).toFixed(2)} kPa`;
  return `${pa.toFixed(1)} Pa`;
}

/**
 * Floating HUD convergence & live solver telemetry panel.
 * Renders a multi-channel SVG log10 residual plot, aerodynamic force/drag monitor,
 * iteration progress bar, and scrollable solver stdout tail.
 */
export const CaeTelemetryPanel: React.FC<CaeTelemetryPanelProps> = ({
  isOpen,
  solverName = "CAE Solver",
  onClose,
  onCancel,
  telemetryPoints,
  currentPhase = "Running...",
  maxIterations,
  progressPercent,
  targetResidual,
  aerodynamicMonitor,
  isRunning = true,
}) => {
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  const latest = telemetryPoints[telemetryPoints.length - 1];

  // Auto-scroll stdout log tail
  useEffect(() => {
    if (autoScrollLogs && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [telemetryPoints.length, autoScrollLogs]);

  // Build log10 residual chart paths (supports multi-channel or single residual)
  const chartData = useMemo(() => {
    const width = 300;
    const height = 92;
    const padY = 6;

    // Collect channel names
    const channelSet = new Set<string>();
    for (const pt of telemetryPoints) {
      if (pt.residuals) {
        for (const key of Object.keys(pt.residuals)) {
          channelSet.add(key);
        }
      }
    }

    const seriesList: Array<{ name: string; color: string; values: Array<{ idx: number; logVal: number }> }> = [];

    if (channelSet.size > 0) {
      const names = Array.from(channelSet).slice(0, SERIES_PALETTE.length);
      names.forEach((name, sIdx) => {
        const vals: Array<{ idx: number; logVal: number }> = [];
        telemetryPoints.forEach((pt, idx) => {
          const raw = pt.residuals?.[name];
          if (raw !== undefined && Number.isFinite(raw) && raw > 0) {
            vals.push({ idx, logVal: Math.log10(raw) });
          }
        });
        if (vals.length > 0) {
          seriesList.push({
            name,
            color: SERIES_PALETTE[sIdx % SERIES_PALETTE.length] ?? "#38bdf8",
            values: vals,
          });
        }
      });
    } else {
      const vals: Array<{ idx: number; logVal: number }> = [];
      telemetryPoints.forEach((pt, idx) => {
        const raw = pt.residual ?? (pt.metrics ? Object.values(pt.metrics)[0] : undefined);
        if (raw !== undefined && Number.isFinite(raw) && raw > 0) {
          vals.push({ idx, logVal: Math.log10(raw) });
        }
      });
      if (vals.length > 0) {
        seriesList.push({ name: "Residual", color: "#38bdf8", values: vals });
      }
    }

    const allLogs: number[] = [];
    for (const s of seriesList) {
      for (const v of s.values) {
        allLogs.push(v.logVal);
      }
    }
    if (targetResidual !== undefined && targetResidual > 0) {
      allLogs.push(Math.log10(targetResidual));
    }

    if (allLogs.length === 0) {
      return { width, height, minLog: -6, maxLog: 0, paths: [], targetY: null as number | null };
    }

    const minLog = Math.floor(Math.min(...allLogs));
    const maxLog = Math.ceil(Math.max(...allLogs));
    const range = maxLog - minLog || 1;
    const denom = Math.max(1, telemetryPoints.length - 1);

    const toY = (logVal: number) => height - ((logVal - minLog) / range) * (height - padY * 2) - padY;

    const paths = seriesList.map((s) => {
      const coords = s.values.map((v) => {
        const x = (v.idx / denom) * width;
        const y = toY(v.logVal);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      return {
        name: s.name,
        color: s.color,
        d: coords.length >= 2 ? `M ${coords.join(" L ")}` : "",
        latestVal: s.values[s.values.length - 1]?.logVal,
      };
    });

    const targetY = targetResidual !== undefined && targetResidual > 0 ? toY(Math.log10(targetResidual)) : null;

    return { width, height, minLog, maxLog, paths, targetY };
  }, [telemetryPoints, targetResidual]);

  // Resolve aerodynamic force monitor snapshot from prop or latest telemetry point
  const aeroMonitor = useMemo<AerodynamicMonitorSnapshot | null>(() => {
    const src: AerodynamicMonitorSnapshot = {
      fx: aerodynamicMonitor?.fx ?? latest?.forces?.fx ?? latest?.metrics?.["Fx"],
      fy: aerodynamicMonitor?.fy ?? latest?.forces?.fy ?? latest?.metrics?.["Fy"],
      fz: aerodynamicMonitor?.fz ?? latest?.forces?.fz ?? latest?.metrics?.["Fz"],
      cd: aerodynamicMonitor?.cd ?? latest?.forces?.cd ?? latest?.metrics?.["Cd"] ?? latest?.metrics?.["cd"],
      cl: aerodynamicMonitor?.cl ?? latest?.forces?.cl ?? latest?.metrics?.["Cl"] ?? latest?.metrics?.["cl"],
      pressureDropPa:
        aerodynamicMonitor?.pressureDropPa ??
        latest?.forces?.pressureDropPa ??
        latest?.metrics?.["pressureDropPa"] ??
        latest?.metrics?.["deltaP"],
    };
    const hasAny =
      src.fx !== undefined ||
      src.fy !== undefined ||
      src.fz !== undefined ||
      src.cd !== undefined ||
      src.cl !== undefined ||
      src.pressureDropPa !== undefined;
    return hasAny ? src : null;
  }, [aerodynamicMonitor, latest]);

  if (!isOpen) return null;

  const computedProgress =
    progressPercent !== undefined
      ? Math.max(0, Math.min(100, progressPercent))
      : maxIterations && maxIterations > 0 && latest
        ? Math.max(0, Math.min(100, (latest.iteration / maxIterations) * 100))
        : null;

  const converged = targetResidual !== undefined && latest?.residual !== undefined && latest.residual <= targetResidual;

  return (
    <div
      style={{
        position: "absolute",
        bottom: "20px",
        right: "20px",
        width: "356px",
        background: "rgba(15, 23, 42, 0.94)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(56, 189, 248, 0.35)",
        borderRadius: "12px",
        padding: "14px 16px",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxShadow: "0 20px 44px rgba(0,0,0,0.65)",
        fontSize: "12px",
        zIndex: 55,
        pointerEvents: "auto",
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
              background: converged ? "#34d399" : isRunning ? "#38bdf8" : "#94a3b8",
              boxShadow: converged ? "0 0 8px #34d399" : isRunning ? "0 0 8px #38bdf8" : "none",
              display: "inline-block",
            }}
          />
          <span style={{ fontWeight: 700, fontSize: "13px", color: "#60a5fa" }}>{solverName}</span>
          {converged && (
            <span
              style={{
                fontSize: "9px",
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: "10px",
                background: "rgba(16, 185, 129, 0.2)",
                color: "#34d399",
                border: "1px solid rgba(16, 185, 129, 0.4)",
              }}
            >
              CONVERGED
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {isRunning && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                background: "rgba(239, 68, 68, 0.18)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                borderRadius: "5px",
                color: "#f87171",
                cursor: "pointer",
                fontSize: "10px",
                fontWeight: 600,
                padding: "2px 7px",
              }}
            >
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close telemetry panel"
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: "15px",
              padding: "0 4px",
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Phase, Iteration & Progress Bar */}
      <div style={{ marginBottom: "10px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "11px",
            color: "#cbd5e1",
            marginBottom: "5px",
          }}
        >
          <span>
            Phase: <strong style={{ color: "#38bdf8" }}>{currentPhase}</strong>
          </span>
          <span style={{ fontFamily: "monospace" }}>
            Iter:{" "}
            <strong style={{ color: "#facc15" }}>
              {latest?.iteration ?? 0}
              {maxIterations ? ` / ${maxIterations}` : ""}
            </strong>
          </span>
        </div>

        {computedProgress !== null && (
          <div
            style={{
              width: "100%",
              height: "5px",
              background: "rgba(51, 65, 85, 0.8)",
              borderRadius: "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${computedProgress}%`,
                height: "100%",
                background: converged
                  ? "linear-gradient(90deg, #10b981 0%, #34d399 100%)"
                  : "linear-gradient(90deg, #38bdf8 0%, #818cf8 100%)",
                transition: "width 0.25s ease",
              }}
            />
          </div>
        )}
      </div>

      {/* SVG log10 Convergence Chart */}
      <div
        style={{
          marginBottom: "10px",
          background: "rgba(0, 0, 0, 0.42)",
          border: "1px solid rgba(255, 255, 255, 0.06)",
          borderRadius: "8px",
          padding: "8px 10px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "10px",
            color: "#94a3b8",
            marginBottom: "4px",
          }}
        >
          <span>log₁₀(Residual)</span>
          <span style={{ fontFamily: "monospace", color: "#e2e8f0" }}>
            {latest?.residual !== undefined ? latest.residual.toExponential(3) : "—"}
          </span>
        </div>

        <svg
          width="100%"
          height={chartData.height}
          viewBox={`0 0 ${chartData.width} ${chartData.height}`}
          preserveAspectRatio="none"
          style={{ overflow: "visible", display: "block" }}
        >
          {/* Horizontal grid lines */}
          {[0.2, 0.5, 0.8].map((frac) => (
            <line
              key={frac}
              x1={0}
              y1={chartData.height * frac}
              x2={chartData.width}
              y2={chartData.height * frac}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="2,3"
            />
          ))}

          {/* Target convergence threshold line */}
          {chartData.targetY !== null && (
            <line
              x1={0}
              y1={chartData.targetY}
              x2={chartData.width}
              y2={chartData.targetY}
              stroke="rgba(52, 211, 153, 0.45)"
              strokeDasharray="4,3"
              strokeWidth={1}
            />
          )}

          {/* Residual curves */}
          {chartData.paths.map(
            (p) =>
              p.d && (
                <path
                  key={p.name}
                  d={p.d}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ),
          )}
        </svg>

        {/* Axis bounds + multi-channel legend */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "4px",
            fontSize: "9px",
            color: "#64748b",
            fontFamily: "monospace",
          }}
        >
          <span>
            range: 10^{chartData.minLog} .. 10^{chartData.maxLog}
          </span>
          {chartData.paths.length > 1 && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {chartData.paths.map((p) => (
                <span
                  key={p.name}
                  style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "#cbd5e1" }}
                >
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: p.color }} />
                  {p.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Aerodynamic Force / Drag Monitor */}
      {aeroMonitor && (
        <div
          style={{
            marginBottom: "10px",
            background: "rgba(15, 23, 42, 0.7)",
            border: "1px solid rgba(56, 189, 248, 0.18)",
            borderRadius: "8px",
            padding: "8px 10px",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              fontWeight: 700,
              color: "#38bdf8",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              marginBottom: "6px",
            }}
          >
            Aerodynamic Force &amp; Drag Monitor
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
            {aeroMonitor.cd !== undefined && (
              <div style={{ background: "rgba(0,0,0,0.35)", borderRadius: "5px", padding: "4px 6px" }}>
                <div style={{ fontSize: "9px", color: "#94a3b8" }}>Cd</div>
                <div style={{ fontSize: "12px", fontWeight: 700, fontFamily: "monospace", color: "#f87171" }}>
                  {aeroMonitor.cd.toFixed(4)}
                </div>
              </div>
            )}
            {aeroMonitor.cl !== undefined && (
              <div style={{ background: "rgba(0,0,0,0.35)", borderRadius: "5px", padding: "4px 6px" }}>
                <div style={{ fontSize: "9px", color: "#94a3b8" }}>Cl</div>
                <div style={{ fontSize: "12px", fontWeight: 700, fontFamily: "monospace", color: "#34d399" }}>
                  {aeroMonitor.cl.toFixed(4)}
                </div>
              </div>
            )}
            {aeroMonitor.pressureDropPa !== undefined && (
              <div style={{ background: "rgba(0,0,0,0.35)", borderRadius: "5px", padding: "4px 6px" }}>
                <div style={{ fontSize: "9px", color: "#94a3b8" }}>ΔP</div>
                <div style={{ fontSize: "12px", fontWeight: 700, fontFamily: "monospace", color: "#a78bfa" }}>
                  {formatPressureDrop(aeroMonitor.pressureDropPa)}
                </div>
              </div>
            )}
            {aeroMonitor.fx !== undefined && (
              <div style={{ background: "rgba(0,0,0,0.35)", borderRadius: "5px", padding: "4px 6px" }}>
                <div style={{ fontSize: "9px", color: "#94a3b8" }}>Fx</div>
                <div style={{ fontSize: "11px", fontWeight: 600, fontFamily: "monospace", color: "#e2e8f0" }}>
                  {formatForce(aeroMonitor.fx)}
                </div>
              </div>
            )}
            {aeroMonitor.fy !== undefined && (
              <div style={{ background: "rgba(0,0,0,0.35)", borderRadius: "5px", padding: "4px 6px" }}>
                <div style={{ fontSize: "9px", color: "#94a3b8" }}>Fy</div>
                <div style={{ fontSize: "11px", fontWeight: 600, fontFamily: "monospace", color: "#e2e8f0" }}>
                  {formatForce(aeroMonitor.fy)}
                </div>
              </div>
            )}
            {aeroMonitor.fz !== undefined && (
              <div style={{ background: "rgba(0,0,0,0.35)", borderRadius: "5px", padding: "4px 6px" }}>
                <div style={{ fontSize: "9px", color: "#94a3b8" }}>Fz</div>
                <div style={{ fontSize: "11px", fontWeight: 600, fontFamily: "monospace", color: "#e2e8f0" }}>
                  {formatForce(aeroMonitor.fz)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Scrollable Live Solver Stdout Tail */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "10px",
            color: "#64748b",
            marginBottom: "4px",
          }}
        >
          <span>Solver Stdout ({telemetryPoints.length} frames)</span>
          <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", color: "#94a3b8" }}>
            <input
              type="checkbox"
              checked={autoScrollLogs}
              onChange={(e) => setAutoScrollLogs(e.target.checked)}
              style={{ margin: 0 }}
            />
            <span>Auto-scroll</span>
          </label>
        </div>
        <div
          ref={logContainerRef}
          style={{
            maxHeight: "96px",
            overflowY: "auto",
            background: "#070b14",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "6px",
            padding: "6px 8px",
            fontFamily: "monospace",
            fontSize: "10px",
            color: "#94a3b8",
            lineHeight: "1.45",
          }}
        >
          {telemetryPoints.length === 0 ? (
            <div style={{ color: "#475569" }}>Waiting for solver stream...</div>
          ) : (
            telemetryPoints.slice(-60).map((pt, idx) => (
              <div
                key={`${pt.iteration}-${idx}`}
                style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {pt.rawLog || `Iter ${pt.iteration}: res = ${pt.residual?.toExponential(2) ?? "—"}`}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
