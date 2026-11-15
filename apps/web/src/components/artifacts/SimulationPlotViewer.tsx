// SPDX-License-Identifier: AGPL-3.0-or-later

import { datasetToLas, lasToDataset, parseLas } from "@modelscript/las/las-parser";
import {
  computeRowsVariableStats,
  datasetToRows,
  DEFAULT_DOWNSAMPLE_THRESHOLD,
  DEFAULT_TARGET_POINTS,
  detectIndexAxis,
  downsampleMinMaxRows,
  rowsToDataset,
  transformSeriesValue,
  type ChartViewMode,
  type IndexedDataset,
} from "@modelscript/simulate/charts";
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
import IndexedCanvasPlot from "./IndexedCanvasPlot";
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

const MAX_RENDER_POINTS = DEFAULT_TARGET_POINTS;
const DOWNSAMPLE_THRESHOLD = DEFAULT_DOWNSAMPLE_THRESHOLD;

const SimulationPlotViewer: React.FC<SimulationPlotViewerProps> = ({ viewConfig, isFullScreen }) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [data, setData] = useState<Record<string, number>[]>([]);
  const [lasDataset, setLasDataset] = useState<IndexedDataset | null>(null);
  const [viewMode, setViewMode] = useState<ChartViewMode>("overlay");
  const [crossplotX, setCrossplotX] = useState<string>("");
  const [crossplotY, setCrossplotY] = useState<string>("");
  const [crossplotColor, setCrossplotColor] = useState<string>("");
  const [histVar, setHistVar] = useState<string>("");
  const [canvasResetSignal, setCanvasResetSignal] = useState(0);
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
    setCanvasResetSignal((n) => n + 1);
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
    setLasDataset(null);
    setLeft("dataMin");
    setRight("dataMax");
    setRefAreaLeft("");
    setRefAreaRight("");
    setCursor1Time(null);
    setCursor2Time(null);
    setNextCursorTarget(1);

    async function loadData() {
      // 0. Direct LAS text supplied
      if (typeof viewConfig?.lasText === "string" && viewConfig.lasText.trim().length > 0) {
        const ds = lasToDataset(parseLas(viewConfig.lasText), { title: viewConfig?.title });
        setLasDataset(ds);
        setData(datasetToRows(ds));
        setViewMode(viewConfig?.viewMode ?? "multitrack");
        setLoading(false);
        return;
      }

      // 1. Direct data array supplied
      if (Array.isArray(viewConfig?.data) && viewConfig.data.length > 0) {
        setLoading(false);
        setData(viewConfig.data);
        if (viewConfig?.viewMode) setViewMode(viewConfig.viewMode);
        return;
      }

      // 2. LAS or CSV URL supplied (supporting query strings like .las?token=... / .csv?token=...)
      const dataUrl = viewConfig?.lasUrl || viewConfig?.csvUrl || viewConfig?.url;
      const pathname = (() => {
        if (!dataUrl || typeof dataUrl !== "string") return "";
        try {
          return new URL(dataUrl, "http://localhost").pathname.toLowerCase();
        } catch {
          return dataUrl.toLowerCase().split("?")[0] ?? "";
        }
      })();
      const isLasUrl = pathname.endsWith(".las") || viewConfig?.format === "las" || Boolean(viewConfig?.lasUrl);
      const isCsvUrl = pathname.endsWith(".csv") || viewConfig?.format === "csv";

      if (dataUrl && typeof dataUrl === "string" && (isLasUrl || isCsvUrl)) {
        setLoading(true);
        try {
          const res = await fetch(dataUrl, { signal: abortController.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status} fetching plot data`);
          const text = await res.text();
          if (!active || abortController.signal.aborted) return;

          if (isLasUrl) {
            const ds = lasToDataset(parseLas(text), { title: viewConfig?.title });
            setLasDataset(ds);
            setData(datasetToRows(ds));
            setViewMode(viewConfig?.viewMode ?? "multitrack");
          } else {
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
            if (viewConfig?.viewMode) setViewMode(viewConfig.viewMode);
          }
        } catch (err: any) {
          if (!active || abortController.signal.aborted || err?.name === "AbortError") return;
          setError(err.message || "Failed to load plot data");
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

  useEffect(() => {
    if (!loading && typeof window !== "undefined") {
      (window as any).__ARTIFACT_READY = true;
    }
  }, [loading, data]);

  // Auto-detect independent axis ('time', 't', 'depth', etc.) or honor viewConfig overrides
  const indexAxis = useMemo(
    () =>
      lasDataset?.indexAxis ??
      detectIndexAxis(data, {
        key: viewConfig?.indexKey,
        label: viewConfig?.indexLabel,
        unit: viewConfig?.indexUnit,
        inverted: viewConfig?.inverted,
        nullValue: viewConfig?.nullValue,
      }),
    [lasDataset, data, viewConfig],
  );
  const timeKey = indexAxis.key;

  // Extract plottable variables across rows (keys other than the independent axis)
  const variables = useMemo(() => {
    if (lasDataset) return lasDataset.series.map((s) => s.name);
    if (!data || data.length === 0) return [];
    const keySet = new Set<string>();
    const sampleCount = Math.min(data.length, 50);
    for (let i = 0; i < sampleCount; i++) {
      for (const k of Object.keys(data[i] || {})) {
        keySet.add(k);
      }
    }
    return Array.from(keySet).filter(
      (k) =>
        k !== timeKey &&
        k !== "time" &&
        k !== "t" &&
        data.some((row) => typeof row?.[k] === "number" && Number.isFinite(row[k])),
    );
  }, [lasDataset, data, timeKey]);

  const canonicalDataset = useMemo<IndexedDataset | null>(() => {
    if (lasDataset) return lasDataset;
    if (!data || data.length === 0) return null;
    return rowsToDataset(data, {
      indexKey: indexAxis.key,
      indexLabel: indexAxis.label,
      indexUnit: indexAxis.unit,
      inverted: indexAxis.inverted,
      nullValue: indexAxis.nullValue,
      title: viewConfig?.model || viewConfig?.title,
      sourceFormat: viewConfig?.format ?? "simulation",
    });
  }, [lasDataset, data, indexAxis, viewConfig]);

  const exportLas = () => {
    if (!canonicalDataset) return;
    const lasText = datasetToLas(canonicalDataset, { version: "2.0" });
    const blob = new Blob([lasText], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${(viewConfig?.model || viewConfig?.title || "dataset").replace(/\s+/g, "_")}.las`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const variableStats = useMemo(
    () =>
      computeRowsVariableStats(data, variables, {
        indexKey: timeKey,
        minIndex: typeof left === "number" ? left : undefined,
        maxIndex: typeof right === "number" ? right : undefined,
        nullValue: indexAxis.nullValue,
      }),
    [data, variables, left, right, timeKey, indexAxis.nullValue],
  );

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
    const sampled = downsampleMinMaxRows(workingRows, primaryVisibleVar, MAX_RENDER_POINTS, DOWNSAMPLE_THRESHOLD);

    if (!isNormalized && !isLogScale && indexAxis.nullValue === undefined) return sampled;

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
        const transformed = transformSeriesValue(row[v], {
          normalize: isNormalized ? bounds[v] : undefined,
          logScale: isLogScale,
          nullValue: indexAxis.nullValue,
        });
        if (transformed === null) {
          if (isLogScale || indexAxis.nullValue !== undefined) {
            next[v] = null as unknown as number;
          }
        } else {
          next[v] = transformed;
        }
      }
      return next;
    });
  }, [data, isNormalized, isLogScale, variables, variableStats, hiddenVars, left, right, timeKey, indexAxis.nullValue]);

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
          <select
            aria-label="Plot View Mode"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as ChartViewMode)}
            style={{
              background: "var(--color-canvas-default, #0d1117)",
              color: "var(--color-fg-default, #e6edf3)",
              border: "1px solid var(--color-border-default, #30363d)",
              borderRadius: "6px",
              padding: "3px 6px",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
            }}
          >
            <option value="overlay">Overlay</option>
            <option value="multitrack">Multi-Track</option>
            <option value="crossplot">Crossplot</option>
            <option value="histogram">Histogram</option>
          </select>
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
          {(isFullScreen || lasDataset !== null) && (
            <Button size="small" leadingVisual={DownloadIcon} onClick={exportLas} title="Download as CWLS LAS 2.0">
              LAS
            </Button>
          )}
          {isFullScreen && (
            <Button size="small" leadingVisual={DownloadIcon} onClick={exportJson} title="Download trajectory as JSON">
              JSON
            </Button>
          )}
        </Box>
      </Toolbar>

      {/* Crossplot / Histogram Secondary Controls */}
      {(viewMode === "crossplot" || viewMode === "histogram") && variables.length > 0 && (
        <Box
          px={3}
          py={1}
          bg="var(--color-canvas-subtle, #161b22)"
          borderBottom="1px solid var(--color-border-default, #30363d)"
          display="flex"
          alignItems="center"
          gap={2}
          flexWrap="wrap"
          style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px" }}
        >
          {viewMode === "crossplot" ? (
            <>
              <span>X:</span>
              <select
                value={crossplotX || variables[0] || timeKey}
                onChange={(e) => setCrossplotX(e.target.value)}
                style={{ fontSize: "11px", padding: "2px 6px" }}
              >
                <option value={timeKey}>{timeKey}</option>
                {variables.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <span>Y:</span>
              <select
                value={crossplotY || variables[1] || variables[0] || timeKey}
                onChange={(e) => setCrossplotY(e.target.value)}
                style={{ fontSize: "11px", padding: "2px 6px" }}
              >
                {variables.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <span>Color:</span>
              <select
                value={crossplotColor}
                onChange={(e) => setCrossplotColor(e.target.value)}
                style={{ fontSize: "11px", padding: "2px 6px" }}
              >
                <option value="">None</option>
                {variables.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <span>Variable:</span>
              <select
                value={histVar || variables[0] || ""}
                onChange={(e) => setHistVar(e.target.value)}
                style={{ fontSize: "11px", padding: "2px 6px" }}
              >
                {variables.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </>
          )}
        </Box>
      )}

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
        ) : viewMode !== "overlay" && canonicalDataset ? (
          <IndexedCanvasPlot
            dataset={canonicalDataset}
            mode={viewMode}
            isDark={isDark}
            cursorMode={cursorMode}
            resetSignal={canvasResetSignal}
            crossplot={{
              xSeries: crossplotX || variables[0] || timeKey,
              ySeries: crossplotY || variables[1] || variables[0] || timeKey,
              colorSeries: crossplotColor || undefined,
              showRegression: true,
            }}
            histogram={{
              seriesName: histVar || variables[0] || "",
            }}
            onCursorUpdate={(c) => {
              if (c.c1 !== undefined) setCursor1Time(c.c1 ?? null);
              if (c.c2 !== undefined) setCursor2Time(c.c2 ?? null);
            }}
          />
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
                tickFormatter={(val) => `${Number(val).toFixed(2)}${indexAxis.unit ? indexAxis.unit : ""}`}
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
                labelFormatter={(label) =>
                  `${indexAxis.label}: ${Number(label).toFixed(3)}${indexAxis.unit ? indexAxis.unit : ""}`
                }
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
