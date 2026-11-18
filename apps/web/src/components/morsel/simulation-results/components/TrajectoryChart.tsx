// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CursorState, IndexedDataset, ViewportRange } from "@modelscript/simulate/charts";
import React, { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { IndexedCanvasPlot } from "../../../artifacts/IndexedCanvasPlot";
import { CustomInspectionTooltip } from "./CustomInspectionTooltip";

export interface TrajectoryChartProps {
  mergedChartData: Record<string, number | string>[];
  rawData?: Record<string, number | string>[] | undefined;
  xAxisVar: string;
  isNormalized: boolean;
  isLogScale: boolean;
  colorMode: "light" | "dark";
  minMaxMap: Record<string, { min: number; max: number }>;
  isComparingBaseline: boolean;
  cursorMode: boolean;
  cursor1Time: number | null;
  cursor2Time: number | null;
  activeVariables: string[];
  selectedVariables: string[];
  sweepResults?: { value: number; y: number[][] }[] | null | undefined;
  baselineData: Record<string, number | string>[] | null;
  pinnedRunLabels?: string[] | undefined;
  colors: string[];
  yDomainOverride?: [number | "auto", number | "auto"] | undefined;
  renderEngine?: "auto" | "canvas" | "svg" | undefined;
  rightAxisVariables?: string[] | undefined;
  viewport?: ViewportRange | undefined;
  onViewportChange?: ((vp: ViewportRange) => void) | undefined;
  onCursorUpdate?: ((cursors: CursorState) => void) | undefined;
  onChartClick: (e: { activeLabel?: string | number | undefined } | null) => void;
}

const CHART_MARGIN = {
  top: 10,
  right: 30,
  left: 20,
  bottom: 35,
};
const X_DOMAIN: ["dataMin", "dataMax"] = ["dataMin", "dataMax"];
const Y_AUTO_DOMAIN: ["auto", "auto"] = ["auto", "auto"];
const Y_NORM_DOMAIN: [number, number] = [0, 100];
const Y_LOG_NORM_DOMAIN: [number, number] = [0.1, 100];
const INITIAL_CHART_DIMENSION = { width: 600, height: 360 };

export const TrajectoryChart: React.FC<TrajectoryChartProps> = ({
  mergedChartData,
  rawData,
  xAxisVar,
  isNormalized,
  isLogScale,
  yDomainOverride,
  renderEngine = "auto",
  rightAxisVariables,
  viewport,
  onViewportChange,
  onCursorUpdate,
  colorMode,
  minMaxMap,
  isComparingBaseline,
  cursorMode,
  cursor1Time,
  cursor2Time,
  activeVariables,
  selectedVariables,
  sweepResults,
  baselineData,
  pinnedRunLabels,
  colors,
  onChartClick,
}) => {
  const useCanvas =
    renderEngine === "canvas" ||
    (renderEngine !== "svg" &&
      (mergedChartData.length > 1500 ||
        (rightAxisVariables?.length ?? 0) > 0 ||
        (xAxisVar !== "time" && !sweepResults?.length)));

  const canvasDataKeys = useMemo(() => {
    const keys: string[] = [];
    const seriesColors: Record<string, string> = {};
    for (const v of activeVariables) {
      const baseColor = colors[Math.max(0, selectedVariables.indexOf(v)) % colors.length] ?? "#38bdf8";
      if (sweepResults && sweepResults.length > 0) {
        sweepResults.forEach((sweep, j) => {
          const key = `${v} (${sweep.value})`;
          keys.push(key);
          const varIdx = Math.max(0, selectedVariables.indexOf(v));
          seriesColors[key] = colors[(varIdx * sweepResults.length + j) % colors.length] ?? baseColor;
        });
      } else {
        keys.push(v);
        seriesColors[v] = baseColor;
        if (isComparingBaseline && (pinnedRunLabels?.length || baselineData)) {
          const labels = pinnedRunLabels?.length ? pinnedRunLabels : ["Baseline"];
          for (const lbl of labels) {
            const bKey = `${v} [${lbl}]`;
            keys.push(bKey);
            seriesColors[bKey] = baseColor;
          }
        }
      }
    }
    return { keys, seriesColors };
  }, [activeVariables, selectedVariables, colors, sweepResults, isComparingBaseline, pinnedRunLabels, baselineData]);

  const canvasDataset = useMemo<IndexedDataset | null>(() => {
    if (!useCanvas || mergedChartData.length === 0) return null;
    const xVals = new Array<number>(mergedChartData.length);
    const seriesValues = canvasDataKeys.keys.map(() => new Array<number>(mergedChartData.length));
    const includeXVarSeries = xAxisVar !== "time" && !canvasDataKeys.keys.includes(xAxisVar);
    const xSeriesVals = includeXVarSeries ? new Array<number>(mergedChartData.length) : null;

    for (let i = 0; i < mergedChartData.length; i++) {
      const row = mergedChartData[i]!;
      const tx = Number(row["time"] ?? row[xAxisVar] ?? i);
      xVals[i] = Number.isFinite(tx) ? tx : i;
      if (xSeriesVals) {
        const xv = Number(row[xAxisVar]);
        xSeriesVals[i] = Number.isFinite(xv) ? xv : NaN;
      }
      for (let k = 0; k < canvasDataKeys.keys.length; k++) {
        const val = Number(row[canvasDataKeys.keys[k]!]);
        seriesValues[k]![i] = Number.isFinite(val) ? val : NaN;
      }
    }

    const series = canvasDataKeys.keys.map((name, idx) => ({
      name,
      values: seriesValues[idx]!,
    }));
    if (xSeriesVals) {
      series.push({ name: xAxisVar, values: xSeriesVals });
    }
    return {
      sourceFormat: "simulation",
      indexAxis: { key: "time", label: "time", unit: "s", inverted: false },
      indexValues: xVals,
      series,
    };
  }, [useCanvas, mergedChartData, canvasDataKeys.keys, xAxisVar]);

  const explicitYRange = useMemo<[number, number] | undefined>(() => {
    if (yDomainOverride && typeof yDomainOverride[0] === "number" && typeof yDomainOverride[1] === "number") {
      return [yDomainOverride[0], yDomainOverride[1]];
    }
    return undefined;
  }, [yDomainOverride]);

  const displayData = React.useMemo(() => {
    if (useCanvas) return [];
    const MAX_POINTS = 1500;
    let src = mergedChartData;
    if (src.length > MAX_POINTS) {
      if (xAxisVar !== "time") {
        const stride = Math.ceil(src.length / MAX_POINTS);
        src = src.filter((_, i) => i === 0 || i === src.length - 1 || i % stride === 0);
      } else {
        const varsToTrack = activeVariables.length > 0 ? activeVariables : [];
        const buckets = Math.floor(MAX_POINTS / 2);
        const bucketSize = src.length / buckets;
        const out: Record<string, number | string>[] = [src[0]!];
        for (let b = 0; b < buckets; b++) {
          const s = Math.floor(b * bucketSize);
          const e = Math.min(src.length, Math.floor((b + 1) * bucketSize));
          if (s >= e) continue;
          let minIdx = s;
          let maxIdx = s;
          if (varsToTrack.length > 0) {
            let maxAbsScore = -Infinity;
            let minSigned = Infinity;
            for (let i = s; i < e; i++) {
              let rowMin = Infinity;
              let rowMax = -Infinity;
              for (let vi = 0; vi < varsToTrack.length; vi++) {
                const v = Number(src[i]?.[varsToTrack[vi]!]);
                if (Number.isFinite(v)) {
                  if (v < rowMin) rowMin = v;
                  if (v > rowMax) rowMax = v;
                }
              }
              if (rowMin < minSigned) {
                minSigned = rowMin;
                minIdx = i;
              }
              if (rowMax > maxAbsScore) {
                maxAbsScore = rowMax;
                maxIdx = i;
              }
            }
          }
          const firstIdx = Math.min(minIdx, maxIdx);
          const secondIdx = Math.max(minIdx, maxIdx);
          if (out[out.length - 1] !== src[firstIdx]) out.push(src[firstIdx]!);
          if (secondIdx !== firstIdx && out[out.length - 1] !== src[secondIdx]) out.push(src[secondIdx]!);
        }
        const last = src[src.length - 1]!;
        if (out[out.length - 1] !== last) out.push(last);
        src = out;
      }
    }
    // Replace NaN/±Infinity (e.g. diverged runs) with null: non-finite values break recharts' axis domains
    // and can trigger an infinite update loop.
    return src.map((row) => {
      let clean: Record<string, number | string | null> | null = null;
      for (const k in row) {
        const v = row[k];
        if (typeof v === "number" && !Number.isFinite(v)) {
          clean ??= { ...row };
          clean[k] = null;
        }
      }
      return (clean ?? row) as typeof row;
    });
  }, [useCanvas, mergedChartData, activeVariables, xAxisVar]);

  if (useCanvas && canvasDataset) {
    const isCrossplot = xAxisVar !== "time" && !sweepResults?.length && canvasDataKeys.keys.length > 0;
    return (
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative" }} data-engine="canvas">
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}>
          <IndexedCanvasPlot
            dataset={canvasDataset}
            mode={isCrossplot ? "crossplot" : "overlay"}
            isDark={colorMode === "dark"}
            cursorMode={cursorMode}
            viewport={viewport}
            cursors={cursorMode ? { c1: cursor1Time, c2: cursor2Time } : undefined}
            onViewportChange={onViewportChange}
            onCursorUpdate={onCursorUpdate}
            overlay={{
              visibleSeries: canvasDataKeys.keys,
              normalize: isNormalized,
              logScale: isLogScale,
              rightAxisSeries: rightAxisVariables,
              yRange: explicitYRange,
              seriesColors: canvasDataKeys.seriesColors,
              yTitle: isNormalized ? "Normalized (0-100%)" : undefined,
              rightYTitle: rightAxisVariables?.length ? rightAxisVariables.slice(0, 2).join(", ") : undefined,
            }}
            crossplot={
              isCrossplot
                ? { xSeries: xAxisVar, ySeries: canvasDataKeys.keys[0]!, pointRadius: 2.0, showRegression: false }
                : undefined
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative" }} data-engine="svg">
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={INITIAL_CHART_DIMENSION}>
          <LineChart data={displayData} onClick={onChartClick} margin={CHART_MARGIN}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={
                colorMode === "dark" ? "var(--color-border-muted, #30363d)" : "var(--color-border-default, #e1e4e8)"
              }
              opacity={0.6}
            />
            <XAxis
              dataKey={xAxisVar}
              type="number"
              domain={X_DOMAIN}
              stroke="var(--color-fg-muted, #8b949e)"
              tick={{ fill: "var(--color-fg-muted, #8b949e)", fontSize: 11 }}
              tickFormatter={(val) => (typeof val === "number" ? val.toFixed(2) : String(val))}
              label={{
                value: xAxisVar === "time" ? "time (s)" : xAxisVar,
                position: "insideBottom",
                offset: -20,
                fill: "var(--color-fg-muted, #8b949e)",
              }}
            />
            <YAxis
              scale={isLogScale ? "log" : "auto"}
              domain={
                isLogScale
                  ? isNormalized
                    ? Y_LOG_NORM_DOMAIN
                    : Y_AUTO_DOMAIN
                  : isNormalized
                    ? Y_NORM_DOMAIN
                    : (yDomainOverride ?? Y_AUTO_DOMAIN)
              }
              allowDataOverflow={isLogScale || Boolean(yDomainOverride) ? true : undefined}
              stroke="var(--color-fg-muted, #8b949e)"
              tick={{ fill: "var(--color-fg-muted, #8b949e)", fontSize: 11 }}
              tickFormatter={(val) => {
                if (isNormalized) return `${val}%`;
                const num = Number(val);
                if (!Number.isFinite(num)) return String(val);
                if (num === 0) return "0";
                const abs = Math.abs(num);
                if (abs < 0.01 || abs >= 10000) return num.toExponential(1);
                return num.toFixed(2);
              }}
              label={
                isNormalized
                  ? {
                      value: "Normalized (0–100%)",
                      angle: -90,
                      position: "insideLeft",
                      offset: -5,
                      fill: "var(--color-fg-muted, #8b949e)",
                    }
                  : isLogScale
                    ? {
                        value: "Logarithmic Scale",
                        angle: -90,
                        position: "insideLeft",
                        offset: -5,
                        fill: "var(--color-fg-muted, #8b949e)",
                      }
                    : undefined
              }
            />
            <Tooltip
              cursor={{
                stroke: "var(--fgColor-accent, var(--ms-brand))",
                strokeWidth: 1.5,
                strokeDasharray: "3 3",
              }}
              content={
                <CustomInspectionTooltip
                  xAxisVar={xAxisVar}
                  minMaxMap={minMaxMap}
                  isNormalized={isNormalized}
                  isComparingBaseline={isComparingBaseline}
                  colorMode={colorMode}
                  rawData={rawData}
                />
              }
            />

            {/* Interactive Dual Cursors */}
            {cursorMode && xAxisVar === "time" && cursor1Time !== null && (
              <ReferenceLine
                x={cursor1Time}
                stroke="#06b6d4"
                strokeWidth={2}
                strokeDasharray="4 4"
                label={{ value: "C1", fill: "#06b6d4", fontSize: 11, position: "top", fontWeight: 700 }}
              />
            )}
            {cursorMode && xAxisVar === "time" && cursor2Time !== null && (
              <ReferenceLine
                x={cursor2Time}
                stroke="#ec4899"
                strokeWidth={2}
                strokeDasharray="4 4"
                label={{ value: "C2", fill: "#ec4899", fontSize: 11, position: "top", fontWeight: 700 }}
              />
            )}

            {activeVariables.flatMap((v) => {
              if (sweepResults && sweepResults.length > 0) {
                return sweepResults.map((sweep, j) => {
                  const key = `${v} (${sweep.value})`;
                  const varIdx = Math.max(0, selectedVariables.indexOf(v));
                  const colorIdx = (varIdx * sweepResults.length + j) % colors.length;
                  return (
                    <Line
                      key={key}
                      type="linear"
                      dataKey={key}
                      name={key}
                      stroke={colors[colorIdx]}
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  );
                });
              }
              const lines = [
                <Line
                  key={v}
                  type="linear"
                  dataKey={v}
                  name={v}
                  stroke={colors[selectedVariables.indexOf(v) % colors.length]}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />,
              ];
              if (isComparingBaseline && (pinnedRunLabels?.length || baselineData)) {
                const labels = pinnedRunLabels?.length ? pinnedRunLabels : ["Baseline"];
                const dashPatterns = ["4 4", "2 2", "6 2", "8 3 2 3"];
                labels.forEach((lbl, rIdx) => {
                  const bKey = `${v} [${lbl}]`;
                  lines.push(
                    <Line
                      key={bKey}
                      type="linear"
                      dataKey={bKey}
                      name={bKey}
                      stroke={colors[selectedVariables.indexOf(v) % colors.length]}
                      strokeWidth={1.5}
                      strokeDasharray={dashPatterns[rIdx % dashPatterns.length]}
                      strokeOpacity={Math.max(0.3, 0.6 - rIdx * 0.1)}
                      dot={false}
                      activeDot={{ r: 3 }}
                      isAnimationActive={false}
                    />,
                  );
                });
              }
              return lines;
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
