// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, PulseIcon, StopIcon, XIcon } from "@primer/octicons-react";
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
  dark?: boolean | undefined;
  /** Render as a docked bottom console strip instead of a floating corner card */
  docked?: boolean | undefined;
}

const SERIES_PALETTE = [
  "var(--hue-cyan, #0891b2)",
  "var(--hue-emerald, #059669)",
  "var(--hue-indigo, #4f46e5)",
  "var(--hue-amber, #d97706)",
  "var(--hue-violet, #7c3aed)",
  "var(--hue-rose, #e11d48)",
];

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
 * Live solver telemetry & convergence console.
 * Uses ModelScript design tokens for full light/dark parity and supports a docked
 * bottom console strip layout (matching AnsatzDiagnosticsPanel) to avoid 3D HUD collisions.
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
  docked = false,
}) => {
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  const latest = telemetryPoints[telemetryPoints.length - 1];

  useEffect(() => {
    if (autoScrollLogs && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [telemetryPoints.length, autoScrollLogs]);

  const chartData = useMemo(() => {
    const width = 300;
    const height = docked ? 84 : 92;
    const padY = 6;

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
            color: SERIES_PALETTE[sIdx % SERIES_PALETTE.length] ?? "var(--ms-brand, #0e7490)",
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
        seriesList.push({ name: "Residual", color: "var(--ms-brand, #0e7490)", values: vals });
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
  }, [telemetryPoints, targetResidual, docked]);

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

  const containerStyle: React.CSSProperties = docked
    ? {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        background: "var(--ms-surface-glass, var(--ms-bg))",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderTop: "1px solid var(--ms-border, var(--color-border-default))",
        padding: "10px 16px 12px",
        color: "var(--ms-text-1, var(--color-fg-default))",
        fontFamily: "var(--ms-font-sans, system-ui, sans-serif)",
        boxShadow: "0 -8px 28px rgba(15, 23, 42, 0.14)",
        fontSize: "var(--text-xs, 12px)",
        zIndex: 45,
        pointerEvents: "auto",
      }
    : {
        position: "absolute",
        bottom: "16px",
        right: "16px",
        width: "372px",
        background: "var(--ms-surface-glass, var(--ms-bg))",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--ms-border, var(--color-border-default))",
        borderRadius: "var(--ms-radius-lg, 12px)",
        padding: "12px 14px",
        color: "var(--ms-text-1, var(--color-fg-default))",
        fontFamily: "var(--ms-font-sans, system-ui, sans-serif)",
        boxShadow: "var(--ms-shadow-pop, 0 16px 40px -12px rgba(15, 23, 42, 0.25))",
        fontSize: "var(--text-xs, 12px)",
        zIndex: 45,
        pointerEvents: "auto",
      };

  const cardStyle: React.CSSProperties = {
    background: "var(--ms-bg-alt, var(--color-canvas-subtle))",
    border: "1px solid var(--ms-divider, var(--color-border-muted))",
    borderRadius: "var(--ms-radius-sm, 6px)",
    padding: "8px 10px",
  };

  return (
    <div style={containerStyle} data-testid="cae-telemetry-panel">
      {/* Header Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          marginBottom: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          {converged ? (
            <span style={{ color: "var(--ms-status-pass-fg, var(--ms-success))", display: "inline-flex" }}>
              <CheckCircleFillIcon size={14} />
            </span>
          ) : (
            <span
              style={{
                color: isRunning ? "var(--ms-brand, #0e7490)" : "var(--ms-text-3, #64748b)",
                display: "inline-flex",
              }}
            >
              <PulseIcon size={14} />
            </span>
          )}
          <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--ms-text-1)" }}>{solverName}</span>
          <span
            style={{
              fontSize: "var(--text-2xs, 11px)",
              color: "var(--ms-text-2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {currentPhase}
          </span>
          {converged && (
            <span
              style={{
                fontSize: "var(--text-2xs, 11px)",
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: "var(--ms-radius-pill, 999px)",
                background: "var(--ms-status-pass-bg)",
                color: "var(--ms-status-pass-fg)",
                border: "1px solid var(--ms-status-pass-border)",
              }}
            >
              Converged
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          <span
            style={{
              fontFamily: "var(--ms-font-mono, monospace)",
              fontVariantNumeric: "tabular-nums",
              fontSize: "var(--text-2xs, 11px)",
              color: "var(--ms-text-2)",
            }}
          >
            Iter <strong style={{ color: "var(--ms-text-1)" }}>{latest?.iteration ?? 0}</strong>
            {maxIterations ? ` / ${maxIterations}` : ""}
          </span>

          {computedProgress !== null && (
            <div
              style={{
                width: "84px",
                height: "6px",
                background: "var(--ms-bg-soft, rgba(148,163,184,0.2))",
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${computedProgress}%`,
                  height: "100%",
                  background: converged ? "var(--ms-success, #059669)" : "var(--ms-brand, #0e7490)",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          )}

          {isRunning && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                background: "var(--ms-status-fail-bg)",
                border: "1px solid var(--ms-status-fail-border)",
                borderRadius: "var(--ms-radius-sm, 6px)",
                color: "var(--ms-status-fail-fg)",
                cursor: "pointer",
                fontSize: "var(--text-2xs, 11px)",
                fontWeight: 600,
                padding: "3px 8px",
              }}
            >
              <StopIcon size={12} />
              Stop
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close telemetry panel"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "24px",
              height: "24px",
              background: "transparent",
              border: "none",
              borderRadius: "var(--ms-radius-sm, 6px)",
              color: "var(--ms-text-2)",
              cursor: "pointer",
            }}
          >
            <XIcon size={14} />
          </button>
        </div>
      </div>

      {/* Main Content: 2- or 3-column strip when docked, stacked when floating */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: docked ? (aeroMonitor ? "1.15fr 0.85fr 1.25fr" : "1fr 1.3fr") : "1fr",
          gap: "10px",
          alignItems: "stretch",
        }}
      >
        {/* SVG log10 Convergence Chart */}
        <div style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "var(--text-2xs, 11px)",
              color: "var(--ms-text-2)",
              marginBottom: "4px",
            }}
          >
            <span style={{ fontWeight: 600 }}>log₁₀(Residual)</span>
            <span
              style={{
                fontFamily: "var(--ms-font-mono, monospace)",
                fontVariantNumeric: "tabular-nums",
                color: "var(--ms-text-1)",
              }}
            >
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
            {[0.2, 0.5, 0.8].map((frac) => (
              <line
                key={frac}
                x1={0}
                y1={chartData.height * frac}
                x2={chartData.width}
                y2={chartData.height * frac}
                stroke="var(--ms-divider, rgba(148,163,184,0.2))"
                strokeDasharray="2,3"
              />
            ))}

            {chartData.targetY !== null && (
              <line
                x1={0}
                y1={chartData.targetY}
                x2={chartData.width}
                y2={chartData.targetY}
                stroke="var(--ms-success, #059669)"
                strokeDasharray="4,3"
                strokeWidth={1}
              />
            )}

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

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "4px",
              fontSize: "var(--text-2xs, 11px)",
              color: "var(--ms-text-3)",
              fontFamily: "var(--ms-font-mono, monospace)",
            }}
          >
            <span>
              10^{chartData.minLog} .. 10^{chartData.maxLog}
            </span>
            {chartData.paths.length > 1 && (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                {chartData.paths.map((p) => (
                  <span
                    key={p.name}
                    style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--ms-text-2)" }}
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
          <div style={cardStyle}>
            <div
              style={{
                fontSize: "var(--text-2xs, 11px)",
                fontWeight: 600,
                color: "var(--ms-text-2)",
                marginBottom: "6px",
              }}
            >
              Force &amp; Drag Monitor
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
              {aeroMonitor.cd !== undefined && (
                <div
                  style={{
                    background: "var(--ms-bg)",
                    border: "1px solid var(--ms-divider)",
                    borderRadius: "4px",
                    padding: "4px 6px",
                  }}
                >
                  <div style={{ fontSize: "var(--text-2xs, 11px)", color: "var(--ms-text-3)" }}>Cd</div>
                  <div
                    style={{
                      fontSize: "var(--text-xs, 12px)",
                      fontWeight: 600,
                      fontFamily: "var(--ms-font-mono, monospace)",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--ms-text-1)",
                    }}
                  >
                    {aeroMonitor.cd.toFixed(4)}
                  </div>
                </div>
              )}
              {aeroMonitor.cl !== undefined && (
                <div
                  style={{
                    background: "var(--ms-bg)",
                    border: "1px solid var(--ms-divider)",
                    borderRadius: "4px",
                    padding: "4px 6px",
                  }}
                >
                  <div style={{ fontSize: "var(--text-2xs, 11px)", color: "var(--ms-text-3)" }}>Cl</div>
                  <div
                    style={{
                      fontSize: "var(--text-xs, 12px)",
                      fontWeight: 600,
                      fontFamily: "var(--ms-font-mono, monospace)",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--ms-text-1)",
                    }}
                  >
                    {aeroMonitor.cl.toFixed(4)}
                  </div>
                </div>
              )}
              {aeroMonitor.pressureDropPa !== undefined && (
                <div
                  style={{
                    background: "var(--ms-bg)",
                    border: "1px solid var(--ms-divider)",
                    borderRadius: "4px",
                    padding: "4px 6px",
                  }}
                >
                  <div style={{ fontSize: "var(--text-2xs, 11px)", color: "var(--ms-text-3)" }}>ΔP</div>
                  <div
                    style={{
                      fontSize: "var(--text-xs, 12px)",
                      fontWeight: 600,
                      fontFamily: "var(--ms-font-mono, monospace)",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--ms-text-1)",
                    }}
                  >
                    {formatPressureDrop(aeroMonitor.pressureDropPa)}
                  </div>
                </div>
              )}
              {aeroMonitor.fx !== undefined && (
                <div
                  style={{
                    background: "var(--ms-bg)",
                    border: "1px solid var(--ms-divider)",
                    borderRadius: "4px",
                    padding: "4px 6px",
                  }}
                >
                  <div style={{ fontSize: "var(--text-2xs, 11px)", color: "var(--ms-text-3)" }}>Fx</div>
                  <div
                    style={{
                      fontSize: "var(--text-xs, 12px)",
                      fontWeight: 600,
                      fontFamily: "var(--ms-font-mono, monospace)",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--ms-text-1)",
                    }}
                  >
                    {formatForce(aeroMonitor.fx)}
                  </div>
                </div>
              )}
              {aeroMonitor.fy !== undefined && (
                <div
                  style={{
                    background: "var(--ms-bg)",
                    border: "1px solid var(--ms-divider)",
                    borderRadius: "4px",
                    padding: "4px 6px",
                  }}
                >
                  <div style={{ fontSize: "var(--text-2xs, 11px)", color: "var(--ms-text-3)" }}>Fy</div>
                  <div
                    style={{
                      fontSize: "var(--text-xs, 12px)",
                      fontWeight: 600,
                      fontFamily: "var(--ms-font-mono, monospace)",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--ms-text-1)",
                    }}
                  >
                    {formatForce(aeroMonitor.fy)}
                  </div>
                </div>
              )}
              {aeroMonitor.fz !== undefined && (
                <div
                  style={{
                    background: "var(--ms-bg)",
                    border: "1px solid var(--ms-divider)",
                    borderRadius: "4px",
                    padding: "4px 6px",
                  }}
                >
                  <div style={{ fontSize: "var(--text-2xs, 11px)", color: "var(--ms-text-3)" }}>Fz</div>
                  <div
                    style={{
                      fontSize: "var(--text-xs, 12px)",
                      fontWeight: 600,
                      fontFamily: "var(--ms-font-mono, monospace)",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--ms-text-1)",
                    }}
                  >
                    {formatForce(aeroMonitor.fz)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scrollable Live Solver Stdout Tail */}
        <div style={{ ...cardStyle, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "var(--text-2xs, 11px)",
              color: "var(--ms-text-2)",
              marginBottom: "4px",
            }}
          >
            <span style={{ fontWeight: 600 }}>Solver Output ({telemetryPoints.length})</span>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
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
              flex: 1,
              maxHeight: docked ? "96px" : "104px",
              overflowY: "auto",
              background: "var(--ms-bg-inset, var(--ms-bg))",
              border: "1px solid var(--ms-divider)",
              borderRadius: "4px",
              padding: "6px 8px",
              fontFamily: "var(--ms-font-mono, monospace)",
              fontSize: "var(--text-2xs, 11px)",
              color: "var(--ms-text-2)",
              lineHeight: 1.45,
            }}
          >
            {telemetryPoints.length === 0 ? (
              <div style={{ color: "var(--ms-text-3)" }}>Waiting for solver output...</div>
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
    </div>
  );
};
