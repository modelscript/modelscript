// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lttbDecimate } from "../../utils/lttb.js";

export interface DataSeries {
  id: string;
  name: string;
  color: string;
  points: { x: number; y: number }[];
  unit?: string | undefined;
  yAxis?: "left" | "right" | undefined;
}

export interface MeasurementCursor {
  x: number;
  label?: string | undefined;
}

export interface TimeSeriesViewerProps {
  series: DataSeries[];
  title?: string | undefined;
  xAxisLabel?: string | undefined;
  yAxisLabel?: string | undefined;
  yAxisRightLabel?: string | undefined;
  dark?: boolean | undefined;
  showCursors?: boolean | undefined;
  normalized?: boolean | undefined;
  decimationThreshold?: number | undefined;
  onExportCsv?: (() => void) | undefined;
  onPinRun?: (() => void) | undefined;
  style?: React.CSSProperties | undefined;
  className?: string | undefined;
}

export interface DualCursorMetrics {
  x1: number;
  x2: number;
  dx: number;
  frequency: number;
  dyPerSeries: Record<string, number>;
  slopePerSeries: Record<string, number>;
}

export function computeCursorMetrics(c1X: number, c2X: number, seriesList: DataSeries[]): DualCursorMetrics {
  const dx = Math.abs(c2X - c1X);
  const freq = dx > 1e-9 ? 1.0 / dx : 0;
  const dyPerSeries: Record<string, number> = {};
  const slopePerSeries: Record<string, number> = {};

  for (const s of seriesList) {
    if (!s.points || s.points.length === 0) continue;
    // Interpolate y at c1X and c2X
    const interpolateY = (targetX: number): number => {
      if (targetX <= s.points[0]!.x) return s.points[0]!.y;
      if (targetX >= s.points[s.points.length - 1]!.x) return s.points[s.points.length - 1]!.y;
      for (let i = 0; i < s.points.length - 1; i++) {
        const p1 = s.points[i]!;
        const p2 = s.points[i + 1]!;
        if (targetX >= p1.x && targetX <= p2.x) {
          const t = (targetX - p1.x) / (p2.x - p1.x || 1);
          return p1.y + t * (p2.y - p1.y);
        }
      }
      return s.points[0]!.y;
    };

    const y1 = interpolateY(Math.min(c1X, c2X));
    const y2 = interpolateY(Math.max(c1X, c2X));
    const dy = y2 - y1;
    dyPerSeries[s.id] = dy;
    slopePerSeries[s.id] = dx > 1e-9 ? dy / dx : 0;
  }

  return {
    x1: Math.min(c1X, c2X),
    x2: Math.max(c1X, c2X),
    dx,
    frequency: freq,
    dyPerSeries,
    slopePerSeries,
  };
}

export function formatSeriesToCsv(timeArray: number[], seriesList: { name: string; values: number[] }[]): string {
  const header = ["Time (s)", ...seriesList.map((s) => s.name)].join(",");
  const rows = timeArray.map((t, idx) => {
    const vals = seriesList.map((s) => (s.values[idx] !== undefined ? s.values[idx] : ""));
    return [t, ...vals].join(",");
  });
  return [header, ...rows].join("\n");
}

export interface PscadPsoutTraceLike {
  id: number;
  name: string;
  unit?: string | undefined;
  group?: string | undefined;
  values: Float64Array | number[];
}

export const DEFAULT_SERIES_PALETTE = [
  "#58a6ff",
  "#3fb950",
  "#d29922",
  "#f85149",
  "#a371f7",
  "#2ea043",
  "#db6d28",
  "#79c0ff",
  "#56d364",
  "#e3b341",
];

/**
 * Converts PSCAD *.psout traces and time vector into DataSeries for TimeSeriesViewer.
 */
export function psoutTracesToDataSeries(
  traces: PscadPsoutTraceLike[],
  time: Float64Array | number[],
  palette: string[] = DEFAULT_SERIES_PALETTE,
): DataSeries[] {
  const timeLen = time.length;
  return traces.map((trace, idx) => {
    const points: { x: number; y: number }[] = [];
    const vals = trace.values;
    const len = Math.min(timeLen, vals.length);
    for (let i = 0; i < len; i++) {
      points.push({ x: time[i]!, y: vals[i]! });
    }
    return {
      id: `trace_${trace.id}`,
      name: trace.name || `Channel ${trace.id}`,
      color: palette[idx % palette.length]!,
      points,
      unit: trace.unit,
      yAxis: "left" as const,
    };
  });
}

export interface OlgaTplDatasetLike {
  times: number[];
  variables: { id: string; name: string; unit: string; variable?: string }[];
  data: number[][]; // [varIndex][timeIndex]
}

/**
 * Converts an OLGA *.tpl trend dataset into DataSeries for TimeSeriesViewer.
 */
export function olgaTplDatasetToDataSeries(
  dataset: OlgaTplDatasetLike,
  selectedVarIndices?: number[],
  palette: string[] = DEFAULT_SERIES_PALETTE,
): DataSeries[] {
  const times = dataset.times;
  const indices = selectedVarIndices ?? dataset.variables.map((_, i) => i).slice(0, 10);
  return indices.map((varIdx, i) => {
    const v = dataset.variables[varIdx];
    const vals = dataset.data[varIdx] ?? [];
    const points: { x: number; y: number }[] = [];
    const len = Math.min(times.length, vals.length);
    for (let t = 0; t < len; t++) {
      points.push({ x: times[t]!, y: vals[t]! });
    }
    const unitUpper = (v?.unit || "").toUpperCase();
    const isPressure = v?.variable === "PT" || unitUpper === "BAR" || unitUpper === "PA";
    return {
      id: v?.id ?? `var_${varIdx}`,
      name: v?.name ?? `Variable ${varIdx + 1}`,
      unit: v?.unit,
      color: palette[i % palette.length]!,
      points,
      yAxis: isPressure ? ("left" as const) : ("right" as const),
    };
  });
}

export interface OlgaPplSnapshotLike {
  time: number;
  x: number[];
  variables: Record<string, number[]>;
}

/**
 * Converts an OLGA *.ppl spatial profile snapshot into DataSeries for TimeSeriesViewer.
 */
export function olgaPplSnapshotToDataSeries(
  snapshot: OlgaPplSnapshotLike,
  selectedVarNames?: string[],
  palette: string[] = DEFAULT_SERIES_PALETTE,
): DataSeries[] {
  const x = snapshot.x;
  const names = selectedVarNames ?? Object.keys(snapshot.variables).slice(0, 6);
  return names.map((name, i) => {
    const vals = snapshot.variables[name] ?? [];
    const points: { x: number; y: number }[] = [];
    const len = Math.min(x.length, vals.length);
    for (let k = 0; k < len; k++) {
      points.push({ x: x[k]!, y: vals[k]! });
    }
    return {
      id: `profile_${name}`,
      name,
      color: palette[i % palette.length]!,
      points,
      yAxis: "left" as const,
    };
  });
}

/**
 * TimeSeriesViewer — Unified, high-performance canvas waveform and telemetry viewer.
 *
 * Implements:
 * 1. Automatic LTTB decimation when points exceed `decimationThreshold` (default 2000).
 * 2. Multi-cursor interactive measurements with HUD (dt, frequency, dy, dy/dt slope).
 * 3. Normalized (0-100%) and Dual-Y axis coordinate transformations.
 * 4. High-DPI canvas rendering with smooth zooming and panning.
 */
export const TimeSeriesViewer: React.FC<TimeSeriesViewerProps> = ({
  series,
  title,
  xAxisLabel = "Time (s)",
  yAxisLabel = "Value",
  yAxisRightLabel,
  dark = true,
  showCursors = false,
  normalized = false,
  decimationThreshold = 2000,
  onExportCsv,
  onPinRun,
  style,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cursor1, setCursor1] = useState<number | null>(null);
  const [cursor2, setCursor2] = useState<number | null>(null);

  // Decimate each series using LTTB if points exceed threshold
  const processedSeries = useMemo(() => {
    return series.map((s) => {
      let pts = s.points;
      if (pts.length > decimationThreshold) {
        pts = lttbDecimate(pts, decimationThreshold);
      }
      if (normalized && pts.length > 0) {
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of pts) {
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        const span = maxY - minY || 1;
        pts = pts.map((p) => ({ x: p.x, y: ((p.y - minY) / span) * 100 }));
      }
      return { ...s, points: pts };
    });
  }, [series, decimationThreshold, normalized]);

  // Check if any series is assigned to right axis
  const hasRightAxis = useMemo(() => {
    return !normalized && processedSeries.some((s) => s.yAxis === "right");
  }, [processedSeries, normalized]);

  const padRight = hasRightAxis ? (yAxisRightLabel ? 65 : 55) : 20;

  // Compute domain and dual-axis ranges
  const { minX, maxX, minYLeft, maxYLeft, minYRight, maxYRight } = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minYLeft = Infinity;
    let maxYLeft = -Infinity;
    let minYRight = Infinity;
    let maxYRight = -Infinity;

    for (const s of processedSeries) {
      const isRight = !normalized && s.yAxis === "right";
      for (const p of s.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (isRight) {
          if (p.y < minYRight) minYRight = p.y;
          if (p.y > maxYRight) maxYRight = p.y;
        } else {
          if (p.y < minYLeft) minYLeft = p.y;
          if (p.y > maxYLeft) maxYLeft = p.y;
        }
      }
    }
    if (minX === Infinity) {
      minX = 0;
      maxX = 10;
    }
    if (minYLeft === Infinity) {
      minYLeft = 0;
      maxYLeft = 10;
    }
    if (minYLeft === maxYLeft) {
      minYLeft -= 1;
      maxYLeft += 1;
    }
    if (minYRight === Infinity) {
      minYRight = 0;
      maxYRight = 10;
    }
    if (minYRight === maxYRight) {
      minYRight -= 1;
      maxYRight += 1;
    }
    return { minX, maxX, minYLeft, maxYLeft, minYRight, maxYRight };
  }, [processedSeries, normalized]);

  // Render waveform to Canvas
  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const padLeft = 55;
    const padTop = 30;
    const padBottom = 40;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Clear
    ctx.fillStyle = dark ? "#18181b" : "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = dark ? "#27272a" : "#f4f4f5";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const xSteps = 5;
    for (let i = 0; i <= xSteps; i++) {
      const x = padLeft + (i / xSteps) * plotW;
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
    }
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const y = padTop + (i / ySteps) * plotH;
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
    }
    ctx.stroke();

    // Map functions
    const toScreenX = (valX: number) => padLeft + ((valX - minX) / (maxX - minX || 1)) * plotW;
    const toScreenYLeft = (valY: number) => padTop + plotH - ((valY - minYLeft) / (maxYLeft - minYLeft || 1)) * plotH;
    const toScreenYRight = (valY: number) =>
      padTop + plotH - ((valY - minYRight) / (maxYRight - minYRight || 1)) * plotH;

    // Draw Series Lines
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    for (const s of processedSeries) {
      if (s.points.length === 0) continue;
      const isRight = !normalized && s.yAxis === "right";
      const toScreenY = isRight ? toScreenYRight : toScreenYLeft;

      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      let first = true;
      for (const p of s.points) {
        const sx = toScreenX(p.x);
        const sy = toScreenY(p.y);
        if (first) {
          ctx.moveTo(sx, sy);
          first = false;
        } else {
          ctx.lineTo(sx, sy);
        }
      }
      ctx.stroke();
    }

    // Axes labels
    ctx.fillStyle = dark ? "#a1a1aa" : "#71717a";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (let i = 0; i <= xSteps; i++) {
      const val = minX + (i / xSteps) * (maxX - minX);
      const x = padLeft + (i / xSteps) * plotW;
      ctx.fillText(val.toFixed(2), x, height - 20);
    }
    ctx.fillText(xAxisLabel, padLeft + plotW / 2, height - 6);

    // Left Y-Axis Ticks & Label
    ctx.textAlign = "right";
    for (let i = 0; i <= ySteps; i++) {
      const val = minYLeft + ((ySteps - i) / ySteps) * (maxYLeft - minYLeft);
      const y = padTop + (i / ySteps) * plotH + 4;
      ctx.fillText(normalized ? `${val.toFixed(0)}%` : val.toFixed(2), padLeft - 8, y);
    }

    ctx.save();
    ctx.textAlign = "center";
    ctx.translate(14, padTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(normalized ? "Normalized (%)" : yAxisLabel, 0, 0);
    ctx.restore();

    // Right Y-Axis Ticks & Label
    if (hasRightAxis) {
      ctx.textAlign = "left";
      for (let i = 0; i <= ySteps; i++) {
        const val = minYRight + ((ySteps - i) / ySteps) * (maxYRight - minYRight);
        const y = padTop + (i / ySteps) * plotH + 4;
        ctx.fillText(val.toFixed(2), padLeft + plotW + 8, y);
      }

      if (yAxisRightLabel) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.translate(width - 14, padTop + plotH / 2);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(yAxisRightLabel, 0, 0);
        ctx.restore();
      }
    }

    // Measurement Cursors
    if (showCursors && cursor1 !== null) {
      const c1X = toScreenX(cursor1);
      ctx.strokeStyle = "#38bdf8";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(c1X, padTop);
      ctx.lineTo(c1X, padTop + plotH);
      ctx.stroke();

      if (cursor2 !== null) {
        const c2X = toScreenX(cursor2);
        ctx.strokeStyle = "#f43f5e";
        ctx.beginPath();
        ctx.moveTo(c2X, padTop);
        ctx.lineTo(c2X, padTop + plotH);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }, [
    processedSeries,
    minX,
    maxX,
    minYLeft,
    maxYLeft,
    minYRight,
    maxYRight,
    dark,
    showCursors,
    cursor1,
    cursor2,
    normalized,
    xAxisLabel,
    yAxisLabel,
    yAxisRightLabel,
    hasRightAxis,
    padRight,
  ]);

  useEffect(() => {
    drawChart();
  }, [drawChart]);

  const cursorMetrics = useMemo(() => {
    if (cursor1 === null || cursor2 === null) return null;
    return computeCursorMetrics(cursor1, cursor2, series);
  }, [cursor1, cursor2, series]);

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: dark ? "#18181b" : "#ffffff",
        color: dark ? "#f4f4f5" : "#18181b",
        fontFamily: "system-ui, -apple-system, sans-serif",
        ...style,
      }}
    >
      {/* Top Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          borderBottom: `1px solid ${dark ? "#27272a" : "#e4e4e7"}`,
          fontSize: "12px",
        }}
      >
        <div style={{ fontWeight: 600 }}>{title ?? "Waveform Telemetry"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onPinRun && (
            <button
              onClick={onPinRun}
              style={{
                padding: "3px 8px",
                borderRadius: 4,
                border: `1px solid ${dark ? "#3f3f46" : "#d4d4d8"}`,
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              📌 Pin Run
            </button>
          )}
          {onExportCsv && (
            <button
              onClick={onExportCsv}
              style={{
                padding: "3px 8px",
                borderRadius: 4,
                border: `1px solid ${dark ? "#3f3f46" : "#d4d4d8"}`,
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              ⬇ Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
          onClick={(e) => {
            if (!showCursors) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const padLeft = 55;
            const plotW = rect.width - padLeft - padRight;
            const valX = minX + ((clickX - padLeft) / (plotW || 1)) * (maxX - minX);

            if (cursor1 === null) {
              setCursor1(valX);
            } else if (cursor2 === null) {
              setCursor2(valX);
            } else {
              setCursor1(valX);
              setCursor2(null);
            }
          }}
        />

        {/* Dual Cursor HUD */}
        {showCursors && cursorMetrics && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: hasRightAxis ? 75 : 16,
              background: dark ? "rgba(24, 24, 27, 0.92)" : "rgba(255, 255, 255, 0.92)",
              border: `1px solid ${dark ? "#3f3f46" : "#e4e4e7"}`,
              borderRadius: 6,
              padding: "6px 12px",
              fontSize: "11px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              backdropFilter: "blur(4px)",
              maxHeight: "180px",
              overflowY: "auto",
            }}
          >
            <div>
              <strong>Δt:</strong> {cursorMetrics.dx.toFixed(4)} s | <strong>Freq:</strong>{" "}
              {cursorMetrics.frequency.toFixed(2)} Hz
            </div>
            {Object.keys(cursorMetrics.dyPerSeries).length > 0 && (
              <div style={{ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${dark ? "#3f3f46" : "#e4e4e7"}` }}>
                {series.map((s) => {
                  const dy = cursorMetrics.dyPerSeries[s.id];
                  if (dy === undefined) return null;
                  return (
                    <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span style={{ color: s.color }}>{s.name}:</span>
                      <span>
                        Δy={dy.toFixed(2)} {s.unit ?? ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Series Legend Pills */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          padding: "6px 16px",
          borderTop: `1px solid ${dark ? "#27272a" : "#e4e4e7"}`,
          fontSize: "11px",
          background: dark ? "#111827" : "#f8fafc",
        }}
      >
        {series.map((s) => (
          <div key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: s.color,
                display: "inline-block",
              }}
            />
            <span style={{ fontWeight: 500 }}>{s.name}</span>
            {s.unit && <span style={{ color: dark ? "#9ca3af" : "#64748b" }}>[{s.unit}]</span>}
            {hasRightAxis && (
              <span
                style={{
                  fontSize: "9px",
                  padding: "1px 4px",
                  borderRadius: 3,
                  background: s.yAxis === "right" ? "rgba(244, 63, 94, 0.2)" : "rgba(56, 189, 248, 0.2)",
                  color: s.yAxis === "right" ? "#fb7185" : "#38bdf8",
                  fontWeight: 600,
                }}
              >
                {s.yAxis === "right" ? "R-Axis" : "L-Axis"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
