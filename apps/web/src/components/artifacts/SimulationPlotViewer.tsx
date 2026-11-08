// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, GraphIcon, SearchIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import Papa from "papaparse";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styled from "styled-components";
import { useTheme } from "../../theme";
import Box from "../Box";
import Spinner from "../Spinner";
import VegaViewer from "./VegaViewer";

const SIM_COLORS = ["#06b6d4", "#a855f7", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#8b5cf6"];

interface SimulationPlotViewerProps {
  viewConfig: any;
  isFullScreen?: boolean | undefined;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean | undefined }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "380px")};
  background: var(--color-canvas-default, #0d1117);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
`;

const Toolbar = styled.div`
  height: 42px;
  min-height: 42px;
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  gap: 8px;
  overflow-x: auto;
`;

const OverridePill = styled.span`
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--color-canvas-default, rgba(127, 127, 127, 0.08));
  color: var(--color-text-secondary, #8b949e);
  border: 1px solid var(--color-border-default, #30363d);
`;

const MAX_RENDER_POINTS = 1500;
const DOWNSAMPLE_THRESHOLD = 2000;

function downsampleMinMax(
  rows: Record<string, number>[],
  primaryVar: string | undefined,
  targetPoints = MAX_RENDER_POINTS,
): Record<string, number>[] {
  if (rows.length <= DOWNSAMPLE_THRESHOLD) return rows;
  if (!primaryVar) {
    const step = Math.max(1, Math.floor(rows.length / targetPoints));
    const sampled: Record<string, number>[] = [];
    for (let i = 0; i < rows.length; i += step) {
      sampled.push(rows[i]!);
    }
    if (sampled[sampled.length - 1] !== rows[rows.length - 1]) {
      sampled.push(rows[rows.length - 1]!);
    }
    return sampled;
  }

  const bucketCount = Math.max(1, Math.floor((targetPoints - 2) / 2));
  const bucketSize = (rows.length - 2) / bucketCount;
  const result: Record<string, number>[] = [rows[0]!];

  for (let b = 0; b < bucketCount; b++) {
    const start = 1 + Math.floor(b * bucketSize);
    const end = Math.min(rows.length - 1, 1 + Math.floor((b + 1) * bucketSize));
    if (start >= end) {
      if (rows[start]) result.push(rows[start]!);
      continue;
    }
    let minIdx = start;
    let maxIdx = start;
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = start; i < end; i++) {
      const v = rows[i]?.[primaryVar];
      if (typeof v === "number" && Number.isFinite(v)) {
        if (v < minVal) {
          minVal = v;
          minIdx = i;
        }
        if (v > maxVal) {
          maxVal = v;
          maxIdx = i;
        }
      }
    }
    if (minIdx === maxIdx) {
      result.push(rows[minIdx]!);
    } else if (minIdx < maxIdx) {
      result.push(rows[minIdx]!, rows[maxIdx]!);
    } else {
      result.push(rows[maxIdx]!, rows[minIdx]!);
    }
  }

  result.push(rows[rows.length - 1]!);
  return result;
}

const SimulationPlotViewer: React.FC<SimulationPlotViewerProps> = ({ viewConfig, isFullScreen }) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [data, setData] = useState<Record<string, number>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hiddenVars, setHiddenVars] = useState<Set<string>>(new Set());
  const [refAreaLeft, setRefAreaLeft] = useState<number | string>("");
  const [refAreaRight, setRefAreaRight] = useState<number | string>("");
  const [left, setLeft] = useState<number | string>("dataMin");
  const [right, setRight] = useState<number | string>("dataMax");
  const [isLogScale, setIsLogScale] = useState(false);
  const [isNormalized, setIsNormalized] = useState(false);
  const [cursorMode, setCursorMode] = useState(false);
  const [cursor1Time, setCursor1Time] = useState<number | null>(null);
  const [cursor2Time, setCursor2Time] = useState<number | null>(null);
  const [nextCursorTarget, setNextCursorTarget] = useState<1 | 2>(1);
  const [showStatsDrawer, setShowStatsDrawer] = useState(false);

  const zoom = useCallback(() => {
    if (refAreaLeft === refAreaRight || refAreaRight === "") {
      setRefAreaLeft("");
      setRefAreaRight("");
      return;
    }
    let [l, r] = [Number(refAreaLeft), Number(refAreaRight)];
    if (l > r) [l, r] = [r, l];
    setLeft(l);
    setRight(r);
    setRefAreaLeft("");
    setRefAreaRight("");
  }, [refAreaLeft, refAreaRight]);

  const zoomOut = () => {
    setLeft("dataMin");
    setRight("dataMax");
    setRefAreaLeft("");
    setRefAreaRight("");
  };

  useEffect(() => {
    if (refAreaLeft === "") return;
    const handleWindowMouseUp = () => {
      zoom();
    };
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [refAreaLeft, zoom]);

  const exportCsv = () => {
    if (!data || data.length === 0) return;
    const csvString = Papa.unparse(data);
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `${(viewConfig?.model || viewConfig?.title || "simulation_results").replace(/\s+/g, "_")}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportJson = () => {
    if (!data || data.length === 0) return;
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `${(viewConfig?.model || viewConfig?.title || "simulation_results").replace(/\s+/g, "_")}.json`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    let active = true;
    const abortController = new AbortController();

    setError(null);
    setLeft("dataMin");
    setRight("dataMax");
    setRefAreaLeft("");
    setRefAreaRight("");
    setCursor1Time(null);
    setCursor2Time(null);
    setNextCursorTarget(1);

    async function loadData() {
      // 1. Direct data array supplied
      if (Array.isArray(viewConfig?.data) && viewConfig.data.length > 0) {
        setLoading(false);
        setData(viewConfig.data);
        return;
      }

      // 2. CSV URL supplied (supporting query strings like .csv?token=...)
      const csvUrl = viewConfig?.csvUrl || viewConfig?.url;
      const isCsvUrl = (() => {
        if (!csvUrl || typeof csvUrl !== "string") return false;
        try {
          return new URL(csvUrl, "http://localhost").pathname.toLowerCase().endsWith(".csv");
        } catch {
          return csvUrl.toLowerCase().split("?")[0]!.endsWith(".csv");
        }
      })();

      if (csvUrl && typeof csvUrl === "string" && (isCsvUrl || viewConfig?.format === "csv")) {
        setLoading(true);
        try {
          const res = await fetch(csvUrl, { signal: abortController.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status} fetching simulation CSV`);
          const text = await res.text();
          if (!active || abortController.signal.aborted) return;
          const parsed = Papa.parse<Record<string, string>>(text, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
          });

          if (active && parsed.data && parsed.data.length > 0) {
            setData(parsed.data as any[]);
          } else if (active) {
            setData([]);
          }
        } catch (err: any) {
          if (!active || abortController.signal.aborted || err?.name === "AbortError") return;
          setError(err.message || "Failed to load simulation CSV");
        } finally {
          if (active && !abortController.signal.aborted) setLoading(false);
        }
        return;
      }

      if (active) {
        setLoading(false);
        setData([]);
      }
    }

    loadData();

    return () => {
      active = false;
      abortController.abort();
    };
  }, [viewConfig]);

  // Auto-detect time column key ('time' or 't')
  const timeKey = useMemo(
    () =>
      data.some((r) => typeof r?.time === "number")
        ? "time"
        : data.some((r) => typeof r?.t === "number")
          ? "t"
          : "time",
    [data],
  );

  // Extract plottable variables across rows (keys other than 'time' or 't')
  const variables = useMemo(() => {
    if (!data || data.length === 0) return [];
    const keySet = new Set<string>();
    const sampleCount = Math.min(data.length, 50);
    for (let i = 0; i < sampleCount; i++) {
      for (const k of Object.keys(data[i] || {})) {
        keySet.add(k);
      }
    }
    return Array.from(keySet).filter(
      (k) => k !== "time" && k !== "t" && data.some((row) => typeof row?.[k] === "number" && Number.isFinite(row[k])),
    );
  }, [data]);

  const variableStats = useMemo(() => {
    if (!data || data.length === 0 || variables.length === 0) return [];
    const minT = typeof left === "number" ? left : -Infinity;
    const maxT = typeof right === "number" ? right : Infinity;
    const windowed = data.filter((row) => {
      const t = Number(row[timeKey] ?? row.time ?? row.t ?? 0);
      return t >= minT && t <= maxT;
    });
    const rows = windowed.length > 0 ? windowed : data;
    return variables.map((v) => {
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let sqSum = 0;
      let count = 0;
      let finalVal = 0;
      let prevT: number | null = null;
      let prevVal: number | null = null;
      let totalDt = 0;
      let trapSum = 0;
      let trapSqSum = 0;

      for (const r of rows) {
        const val = r[v];
        const t = Number(r[timeKey] ?? r.time ?? r.t ?? 0);
        if (typeof val === "number" && Number.isFinite(val)) {
          if (val < min) min = val;
          if (val > max) max = val;
          sum += val;
          sqSum += val * val;
          count++;
          finalVal = val;

          if (Number.isFinite(t)) {
            if (prevT !== null && prevVal !== null) {
              const dt = t - prevT;
              if (dt > 0) {
                totalDt += dt;
                trapSum += 0.5 * (prevVal + val) * dt;
                trapSqSum += 0.5 * (prevVal * prevVal + val * val) * dt;
              }
            }
            prevT = t;
            prevVal = val;
          }
        }
      }
      const mean = totalDt > 0 ? trapSum / totalDt : count > 0 ? sum / count : 0;
      const rms = totalDt > 0 ? Math.sqrt(trapSqSum / totalDt) : count > 0 ? Math.sqrt(sqSum / count) : 0;
      return {
        name: v,
        min: count > 0 ? min : 0,
        max: count > 0 ? max : 0,
        mean,
        rms,
        final: finalVal,
      };
    });
  }, [data, variables, left, right, timeKey]);

  const chartData = useMemo(() => {
    if (data.length === 0 || variables.length === 0) return data;

    // Filter to zoomed window if active before downsampling so zooming into 100k-row data reveals fine detail
    let workingRows = data;
    if (typeof left === "number" || typeof right === "number") {
      const minT = typeof left === "number" ? left : -Infinity;
      const maxT = typeof right === "number" ? right : Infinity;
      const windowed = data.filter((row) => {
        const t = Number(row[timeKey] ?? row.time ?? row.t ?? 0);
        return t >= minT && t <= maxT;
      });
      if (windowed.length > 0) {
        workingRows = windowed;
      }
    }

    const primaryVisibleVar = variables.find((v) => !hiddenVars.has(v)) ?? variables[0];
    const sampled = downsampleMinMax(workingRows, primaryVisibleVar, MAX_RENDER_POINTS);

    if (!isNormalized && !isLogScale) return sampled;

    const bounds: Record<string, { min: number; span: number }> = {};
    if (isNormalized) {
      for (const st of variableStats) {
        const span = st.max - st.min;
        bounds[st.name] = { min: st.min, span: span > 1e-12 ? span : 1 };
      }
    }

    return sampled.map((row) => {
      const next: Record<string, number> = { ...row };
      for (const v of variables) {
        const raw = row[v];
        if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
        let transformed = raw;
        if (isNormalized) {
          const b = bounds[v];
          if (b) {
            transformed = (raw - b.min) / b.span;
          }
        }
        if (isLogScale) {
          if (isNormalized) {
            next[v] = Math.max(1e-6, transformed);
          } else {
            next[v] = transformed <= 0 ? (null as unknown as number) : transformed;
          }
        } else {
          next[v] = transformed;
        }
      }
      return next;
    });
  }, [data, isNormalized, isLogScale, variables, variableStats, hiddenVars, left, right, timeKey]);

  const cursorReadout = useMemo(() => {
    if (cursor1Time === null && cursor2Time === null) return null;
    const findNearestRow = (targetT: number | null) => {
      if (targetT === null || data.length === 0) return null;
      let best = data[0]!;
      let bestDist = Math.abs(Number(best[timeKey] ?? best.time ?? best.t ?? 0) - targetT);
      for (const row of data) {
        const d = Math.abs(Number(row[timeKey] ?? row.time ?? row.t ?? 0) - targetT);
        if (d < bestDist) {
          best = row;
          bestDist = d;
        }
      }
      return best;
    };
    const row1 = findNearestRow(cursor1Time);
    const row2 = findNearestRow(cursor2Time);
    const t1 = row1 ? Number(row1[timeKey] ?? row1.time ?? row1.t ?? 0) : null;
    const t2 = row2 ? Number(row2[timeKey] ?? row2.time ?? row2.t ?? 0) : null;
    const dt = t1 !== null && t2 !== null ? t2 - t1 : null;
    const freqHz = dt !== null && Math.abs(dt) > 1e-12 ? 1 / Math.abs(dt) : null;
    const visibleVars = variables.filter((v) => !hiddenVars.has(v));
    const deltas = visibleVars.slice(0, 4).map((v) => {
      const y1 = row1?.[v];
      const y2 = row2?.[v];
      const dy = typeof y1 === "number" && typeof y2 === "number" ? y2 - y1 : null;
      const slope = dy !== null && dt !== null && Math.abs(dt) > 1e-12 ? dy / dt : null;
      return { name: v, y1, y2, dy, slope };
    });
    return { t1, t2, dt, freqHz, deltas };
  }, [cursor1Time, cursor2Time, data, variables, hiddenVars, timeKey]);

  const toggleVariable = (varName: string) => {
    setHiddenVars((prev) => {
      const next = new Set(prev);
      if (next.has(varName)) {
        next.delete(varName);
      } else {
        next.add(varName);
      }
      return next;
    });
  };

  const modelName = viewConfig?.model || viewConfig?.title || "Modelica Parametric Simulation";

  // If a Vega specification is provided, delegate directly to VegaViewer
  if (viewConfig?.spec) {
    return <VegaViewer viewConfig={viewConfig} isFullScreen={isFullScreen} />;
  }

  return (
    <Wrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2}>
          <GraphIcon size={16} fill="var(--color-accent-emphasis, #06b6d4)" />
          <Text fontWeight="bold" fontSize="13px" color="var(--color-text-primary)">
            {modelName}
          </Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2}>
          {(left !== "dataMin" || right !== "dataMax") && (
            <Button
              size="small"
              onClick={zoomOut}
              style={{ color: "#38bdf8", display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <SearchIcon size={12} /> Reset Zoom
            </Button>
          )}
          <Button
            size="small"
            onClick={() => {
              const next = !cursorMode;
              setCursorMode(next);
              if (next && cursor1Time === null && data.length > 0) {
                const i1 = Math.floor(data.length * 0.25);
                const i2 = Math.floor(data.length * 0.75);
                setCursor1Time(Number(data[i1]?.[timeKey] ?? data[i1]?.time ?? data[i1]?.t ?? 0));
                setCursor2Time(Number(data[i2]?.[timeKey] ?? data[i2]?.time ?? data[i2]?.t ?? 0));
              }
            }}
            title="Toggle Dual Measurement Cursors (C1 / C2, Δt, Hz, dy/dt)"
            style={{
              background: cursorMode ? "rgba(6, 182, 212, 0.15)" : undefined,
              borderColor: cursorMode ? "rgba(6, 182, 212, 0.4)" : undefined,
              color: cursorMode ? "#06b6d4" : undefined,
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
            }}
          >
            Measure
          </Button>
          <Button
            size="small"
            onClick={() => setIsNormalized(!isNormalized)}
            title="Normalize all variables to [0, 1] range"
            style={{
              background: isNormalized ? "rgba(168, 85, 247, 0.15)" : undefined,
              borderColor: isNormalized ? "rgba(168, 85, 247, 0.4)" : undefined,
              color: isNormalized ? "#c084fc" : undefined,
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
            }}
          >
            Norm [0,1]
          </Button>
          <Button
            size="small"
            onClick={() => setIsLogScale(!isLogScale)}
            title="Toggle Logarithmic Y-axis scale"
            style={{
              background: isLogScale ? "rgba(6, 182, 212, 0.15)" : undefined,
              borderColor: isLogScale ? "rgba(6, 182, 212, 0.4)" : undefined,
              color: isLogScale ? "#06b6d4" : undefined,
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
            }}
          >
            {isLogScale ? "Log Y" : "Linear Y"}
          </Button>
          <Button
            size="small"
            onClick={() => setShowStatsDrawer(!showStatsDrawer)}
            title="Toggle Variable Statistics Summary (Min, Max, Mean, RMS)"
            style={{
              background: showStatsDrawer ? "rgba(16, 185, 129, 0.15)" : undefined,
              borderColor: showStatsDrawer ? "rgba(16, 185, 129, 0.4)" : undefined,
              color: showStatsDrawer ? "#34d399" : undefined,
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
            }}
          >
            Stats
          </Button>
          <Button size="small" leadingVisual={DownloadIcon} onClick={exportCsv} title="Download trajectory as CSV">
            CSV
          </Button>
          {isFullScreen && (
            <Button size="small" leadingVisual={DownloadIcon} onClick={exportJson} title="Download trajectory as JSON">
              JSON
            </Button>
          )}
        </Box>
      </Toolbar>

      {/* Overrides Bar */}
      {viewConfig?.overrides && Object.keys(viewConfig.overrides).length > 0 && (
        <Box
          px={3}
          py={2}
          bg="var(--color-canvas-subtle)"
          borderBottom="1px solid var(--color-border-subtle)"
          display="flex"
          alignItems="center"
          gap={2}
          flexWrap="wrap"
        >
          <Text fontSize="11px" color="var(--color-text-muted)">
            Overrides:
          </Text>
          {Object.entries(viewConfig.overrides).map(([k, v]) => (
            <OverridePill key={k}>
              {k} = {String(v)}
            </OverridePill>
          ))}
        </Box>
      )}

      {/* Dual Cursor Measurement Readout Bar */}
      {cursorMode && cursorReadout && (
        <Box
          px={3}
          py={1}
          bg="rgba(6, 182, 212, 0.06)"
          borderBottom="1px solid rgba(6, 182, 212, 0.25)"
          display="flex"
          alignItems="center"
          gap={3}
          flexWrap="wrap"
          style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px" }}
        >
          <span style={{ color: "#06b6d4", fontWeight: 600 }}>
            C1: {cursorReadout.t1 !== null ? `${cursorReadout.t1.toFixed(4)}s` : "—"}
          </span>
          <span style={{ color: "#f59e0b", fontWeight: 600 }}>
            C2: {cursorReadout.t2 !== null ? `${cursorReadout.t2.toFixed(4)}s` : "—"}
          </span>
          {cursorReadout.dt !== null && (
            <span style={{ color: "var(--color-fg-default)" }}>
              Δt = <strong>{cursorReadout.dt.toFixed(4)}s</strong>
              {cursorReadout.freqHz !== null ? ` (${cursorReadout.freqHz.toFixed(2)} Hz)` : ""}
            </span>
          )}
          {cursorReadout.deltas.map((d) =>
            d.dy !== null ? (
              <OverridePill key={d.name}>
                Δ{d.name} = {d.dy.toExponential(3)}
                {d.slope !== null ? ` (dy/dt: ${d.slope.toExponential(2)})` : ""}
              </OverridePill>
            ) : null,
          )}
          <span style={{ marginLeft: "auto", color: "var(--color-fg-muted)", fontSize: "10px" }}>
            Click chart to place C{nextCursorTarget}
          </span>
        </Box>
      )}

      {/* Main Chart Area */}
      <Box flex={1} p={2} position="relative" minHeight="200px">
        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <Spinner size="small" />
          </Box>
        ) : error ? (
          <Box p={4} textAlign="center" color="var(--color-danger-fg)">
            <Text>{error}</Text>
          </Box>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 10, right: 25, left: 0, bottom: 5 }}
              onClick={(e) => {
                if (!cursorMode || !e || e.activeLabel === undefined) return;
                const tVal = Number(e.activeLabel);
                if (!Number.isFinite(tVal)) return;
                if (nextCursorTarget === 1) {
                  setCursor1Time(tVal);
                  setNextCursorTarget(2);
                } else {
                  setCursor2Time(tVal);
                  setNextCursorTarget(1);
                }
              }}
              onMouseDown={(e) => {
                if (cursorMode) return;
                if (e && e.activeLabel !== undefined) setRefAreaLeft(e.activeLabel);
              }}
              onMouseMove={(e) => {
                if (cursorMode) return;
                if (refAreaLeft !== "" && e && e.activeLabel !== undefined) setRefAreaRight(e.activeLabel);
              }}
              onMouseUp={() => {
                if (!cursorMode) zoom();
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.1)"} />
              <XAxis
                dataKey={timeKey}
                domain={[left, right]}
                type="number"
                allowDataOverflow
                stroke="var(--color-text-muted, #8b949e)"
                fontSize={11}
                tickFormatter={(val) => `${Number(val).toFixed(2)}s`}
              />
              <YAxis
                stroke="var(--color-text-muted, #8b949e)"
                fontSize={11}
                allowDataOverflow
                scale={isLogScale ? "log" : "auto"}
                domain={isLogScale ? (isNormalized ? [1e-4, 1] : ["auto", "auto"]) : isNormalized ? [0, 1] : undefined}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: isDark ? "rgba(14, 20, 36, 0.95)" : "rgba(255, 255, 255, 0.96)",
                  border: isDark ? "1px solid rgba(255, 255, 255, 0.15)" : "1px solid rgba(15, 23, 42, 0.15)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: isDark ? "#fff" : "#0f172a",
                }}
                labelFormatter={(label) => `Time: ${Number(label).toFixed(3)}s`}
              />
              <Legend
                wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                onClick={(e) => {
                  if (e.dataKey) toggleVariable(String(e.dataKey));
                }}
              />
              {variables.map((v, idx) => (
                <Line
                  key={v}
                  type="monotone"
                  dataKey={v}
                  stroke={SIM_COLORS[idx % SIM_COLORS.length]}
                  dot={false}
                  connectNulls
                  strokeWidth={2}
                  isAnimationActive={false}
                  hide={hiddenVars.has(v)}
                />
              ))}
              {cursorMode && cursorReadout?.t1 !== null && cursorReadout?.t1 !== undefined && (
                <ReferenceLine x={cursorReadout.t1} stroke="#06b6d4" strokeWidth={1.5} strokeDasharray="4 2" />
              )}
              {cursorMode && cursorReadout?.t2 !== null && cursorReadout?.t2 !== undefined && (
                <ReferenceLine x={cursorReadout.t2} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2" />
              )}
              {refAreaLeft !== "" && refAreaRight !== "" ? (
                <ReferenceArea
                  x1={Number(refAreaLeft)}
                  x2={Number(refAreaRight)}
                  strokeOpacity={0.3}
                  fill="#06b6d4"
                  fillOpacity={0.25}
                />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <Text color="var(--color-text-muted)">No simulation trajectory data available.</Text>
          </Box>
        )}
      </Box>

      {/* Variable Statistics Summary Drawer */}
      {showStatsDrawer && variableStats.length > 0 && (
        <Box
          px={3}
          py={2}
          bg="var(--color-canvas-subtle, #161b22)"
          borderTop="1px solid var(--color-border-default, #30363d)"
          style={{ maxHeight: "140px", overflowY: "auto", fontFamily: "var(--font-mono, monospace)", fontSize: "11px" }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr
                style={{
                  color: "var(--color-fg-muted)",
                  borderBottom: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(15,23,42,0.12)",
                }}
              >
                <th style={{ padding: "3px 6px" }}>Variable</th>
                <th style={{ padding: "3px 6px" }}>Min</th>
                <th style={{ padding: "3px 6px" }}>Max</th>
                <th style={{ padding: "3px 6px" }}>Mean</th>
                <th style={{ padding: "3px 6px" }}>RMS</th>
                <th style={{ padding: "3px 6px" }}>Final</th>
              </tr>
            </thead>
            <tbody>
              {variableStats.map((st, idx) => (
                <tr
                  key={st.name}
                  style={{
                    borderBottom: isDark ? "1px solid rgba(255,255,255,0.04)" : "1px solid rgba(15,23,42,0.06)",
                  }}
                >
                  <td style={{ padding: "3px 6px", color: SIM_COLORS[idx % SIM_COLORS.length], fontWeight: 600 }}>
                    {st.name}
                  </td>
                  <td style={{ padding: "3px 6px" }}>{st.min.toPrecision(4)}</td>
                  <td style={{ padding: "3px 6px" }}>{st.max.toPrecision(4)}</td>
                  <td style={{ padding: "3px 6px" }}>{st.mean.toPrecision(4)}</td>
                  <td style={{ padding: "3px 6px" }}>{st.rms.toPrecision(4)}</td>
                  <td style={{ padding: "3px 6px" }}>{st.final.toPrecision(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </Wrapper>
  );
};

export default SimulationPlotViewer;
