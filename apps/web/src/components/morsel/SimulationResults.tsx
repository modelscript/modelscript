// SPDX-License-Identifier: AGPL-3.0-or-later

import { ZapIcon } from "@primer/octicons-react";
import { Spinner } from "@primer/react";
import Papa from "papaparse";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getSimulationJobResult } from "../../api";
import { useTheme } from "../../theme";
import { downloadParquetFile } from "../../util/binary-export";

export const SIMULATION_COLORS = [
  "#0969da",
  "#2da44e",
  "#bf3989",
  "#db6d28",
  "#8250df",
  "#1168e3",
  "#218bff",
  "#a371f7",
  "#3fb950",
  "#e34c26",
  "#56d364",
  "#79c0ff",
  "#d2a8ff",
  "#ffa657",
];

interface CustomInspectionTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: any;
  xAxisVar: string;
  minMaxMap: Record<string, { min: number; max: number }>;
  isNormalized: boolean;
  isComparingBaseline: boolean;
  colorMode: "light" | "dark";
}

function CustomInspectionTooltip({
  active,
  payload,
  label,
  xAxisVar,
  minMaxMap,
  isNormalized,
  isComparingBaseline,
}: CustomInspectionTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  const numLabel = typeof label === "number" ? label : Number(label);
  const formattedLabel = `${xAxisVar}: ${isNaN(numLabel) ? label : numLabel.toFixed(4)}${xAxisVar === "time" ? "s" : ""}`;

  // Group items by base variable name to pair current value with baseline
  const grouped = new Map<string, { current?: any; baseline?: any; color: string }>();

  for (const item of payload) {
    const rawName = String(item.name || item.dataKey || "");
    const isBaseline = rawName.endsWith(" [Baseline]");
    const baseName = isBaseline ? rawName.replace(" [Baseline]", "") : rawName;

    if (!grouped.has(baseName)) {
      grouped.set(baseName, { color: item.color || item.stroke || "#58a6ff" });
    }
    const entry = grouped.get(baseName)!;
    if (isBaseline) {
      entry.baseline = item.value;
    } else {
      entry.current = item.value;
      if (item.color || item.stroke) entry.color = item.color || item.stroke;
    }
  }

  return (
    <div
      style={{
        backgroundColor: "var(--color-canvas-subtle, #161b22)",
        border: "1px solid var(--color-border-default, #30363d)",
        borderRadius: "8px",
        padding: "8px 12px",
        boxShadow: "0 6px 18px rgba(0, 0, 0, 0.4)",
        fontSize: "12px",
        color: "var(--color-fg-default, #e6edf3)",
        minWidth: "190px",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--color-border-muted, #21262d)",
          paddingBottom: "4px",
          marginBottom: "6px",
          fontWeight: 600,
          fontFamily: "var(--font-mono, monospace)",
          color: "var(--color-accent-fg, #58a6ff)",
        }}
      >
        <span>{formattedLabel}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {Array.from(grouped.entries()).map(([name, entry]) => {
          const curVal = entry.current !== undefined ? Number(entry.current) : null;
          const baseVal = entry.baseline !== undefined ? Number(entry.baseline) : null;

          let displayVal = curVal !== null ? (isNormalized ? `${curVal.toFixed(1)}%` : curVal.toFixed(4)) : "—";
          if (isNormalized && curVal !== null && minMaxMap[name]) {
            const raw = (curVal / 100) * (minMaxMap[name].max - minMaxMap[name].min) + minMaxMap[name].min;
            displayVal = `${raw.toFixed(4)} (${curVal.toFixed(1)}%)`;
          }

          let deltaStr: string | null = null;
          let deltaPercentStr: string | null = null;
          let isPositiveDelta = false;

          if (curVal !== null && baseVal !== null) {
            const delta = curVal - baseVal;
            isPositiveDelta = delta >= 0;
            deltaStr = `${isPositiveDelta ? "+" : ""}${delta.toFixed(4)}`;
            if (Math.abs(baseVal) > 1e-6) {
              const pct = (delta / Math.abs(baseVal)) * 100;
              deltaPercentStr = `${isPositiveDelta ? "+" : ""}${pct.toFixed(1)}%`;
            }
          }

          return (
            <div
              key={name}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "2px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: entry.color,
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 500 }}>{name}</span>
                </div>
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>{displayVal}</span>
              </div>

              {isComparingBaseline && baseVal !== null && deltaStr && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    paddingLeft: "14px",
                    fontSize: "11px",
                    color: "var(--color-fg-muted, #8b949e)",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  <span>Base: {baseVal.toFixed(4)}</span>
                  <span
                    style={{
                      color: isPositiveDelta ? "var(--color-accent-fg, #58a6ff)" : "var(--color-success-fg, #3fb950)",
                      fontWeight: 600,
                    }}
                  >
                    Δ {deltaStr} {deltaPercentStr ? `(${deltaPercentStr})` : ""}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface SimulationResultsProps {
  jobId?: string | null;
  localData?: Record<string, number | string>[] | null;
  sweepResults?: { value: number; y: number[][] }[] | null;
  simulationVariables?: string[];
  error?: string | null;
  selectedVariables: string[];
  onVariablesLoaded: (variables: string[]) => void;
  colorMode?: "light" | "dark";
}

export function SimulationResults({
  jobId,
  localData,
  sweepResults,
  simulationVariables,
  error: externalError,
  selectedVariables,
  onVariablesLoaded,
  colorMode: propColorMode,
}: SimulationResultsProps) {
  const { theme } = useTheme();
  const colorMode = propColorMode || (theme === "dark" ? "dark" : "light");
  const [data, setData] = useState<Record<string, number | string>[]>(localData || []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(externalError || null);
  const [isNormalized, setIsNormalized] = useState(false);
  const [isLogScale, setIsLogScale] = useState(false);
  const [xAxisVar, setXAxisVar] = useState<string>("time");
  const [hiddenVars, setHiddenVars] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  // Baseline comparison state (Run A vs Run B)
  const [baselineData, setBaselineData] = useState<Record<string, number | string>[] | null>(() => {
    try {
      const stored = sessionStorage.getItem("modelscript:simulation-baseline");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [isComparingBaseline, setIsComparingBaseline] = useState<boolean>(() => {
    return !!sessionStorage.getItem("modelscript:simulation-baseline");
  });

  // Dual-cursor measurement state (C1, C2, dt, frequency, slope)
  const [cursorMode, setCursorMode] = useState<boolean>(false);
  const [cursor1Time, setCursor1Time] = useState<number | null>(null);
  const [cursor2Time, setCursor2Time] = useState<number | null>(null);
  const [activeCursorPlacement, setActiveCursorPlacement] = useState<1 | 2>(1);
  const [showStats, setShowStats] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchResults() {
      try {
        setLoading(true);
        setError(null);

        if (externalError) {
          setError(externalError);
          setLoading(false);
          return;
        }

        if (localData) {
          if (localData.length > 0) {
            const headers = Object.keys(localData[0]);
            const timeCol = headers[0]; // Assuming first column is time
            const vars = simulationVariables ?? headers.filter((h) => h !== timeCol);

            onVariablesLoaded(vars);

            const chartData = localData.map((row) => {
              const newRow: Record<string, number | string> = { time: row[timeCol] };
              vars.forEach((v) => {
                newRow[v] = row[v];
              });
              return newRow;
            });
            setData(chartData);
          }
          setLoading(false);
          return;
        }

        if (!jobId) {
          setError("No simulation job ID or local data provided.");
          setLoading(false);
          return;
        }

        const csvText = await getSimulationJobResult(jobId);

        Papa.parse(csvText, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => {
            if (!isMounted) return;

            if (results.errors.length > 0) {
              console.error("CSV Parsing errors:", results.errors);
              setError("Failed to parse simulation results.");
              setLoading(false);
              return;
            }

            const parsedData = results.data as Record<string, number | string>[];
            if (parsedData.length > 0) {
              const headers = Object.keys(parsedData[0]);
              const timeCol = headers[0];
              const vars = headers.filter((h) => h !== timeCol);

              onVariablesLoaded(vars);

              const chartData = parsedData.map((row) => {
                const newRow: Record<string, number | string> = { time: row[timeCol] };
                vars.forEach((v) => {
                  newRow[v] = row[v];
                });
                return newRow;
              });

              setData(chartData);
            }
            setLoading(false);
          },
          error: (err: Error) => {
            if (!isMounted) return;
            setError(`Error parsing CSV: ${err.message}`);
            setLoading(false);
          },
        });
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "An unknown error occurred");
        setLoading(false);
      }
    }

    fetchResults();

    return () => {
      isMounted = false;
    };
  }, [jobId, localData, onVariablesLoaded, externalError]);

  const activeVariables = useMemo(() => {
    return selectedVariables.filter((v) => !hiddenVars.has(v));
  }, [selectedVariables, hiddenVars]);

  // Compute normalized data when in normalized mode
  const { chartData, minMaxMap } = useMemo(() => {
    if (!data.length) return { chartData: [], minMaxMap: {} };

    const minMax: Record<string, { min: number; max: number }> = {};
    if (isNormalized) {
      for (const v of selectedVariables) {
        let min = Infinity;
        let max = -Infinity;
        for (const row of data) {
          const val = Number(row[v]);
          if (!isNaN(val)) {
            if (val < min) min = val;
            if (val > max) max = val;
          }
        }
        if (!isFinite(min) || !isFinite(max)) {
          min = 0;
          max = 1;
        }
        if (min === max) {
          min -= 1;
          max += 1;
        }
        minMax[v] = { min, max };
      }

      const normalized = data.map((row) => {
        const newRow: Record<string, number | string> = { ...row };
        for (const v of selectedVariables) {
          const val = Number(row[v]);
          const mm = minMax[v];
          if (!isNaN(val) && mm) {
            newRow[`_raw_${v}`] = val;
            newRow[v] = ((val - mm.min) / (mm.max - mm.min || 1)) * 100;
          }
        }
        return newRow;
      });
      return { chartData: normalized, minMaxMap: minMax };
    }

    return { chartData: data, minMaxMap: minMax };
  }, [data, isNormalized, selectedVariables]);

  // Merge baseline trajectory into chartData if comparison is active
  const mergedChartData = useMemo(() => {
    if (!baselineData || !isComparingBaseline || !chartData.length) {
      return chartData;
    }
    const baselineMap = new Map<string, Record<string, number | string>>();
    for (const bRow of baselineData) {
      const t = Number(bRow.time);
      if (!isNaN(t)) {
        baselineMap.set(t.toFixed(4), bRow);
      }
    }

    return chartData.map((row, idx) => {
      const t = Number(row.time);
      const bRow = !isNaN(t) ? baselineMap.get(t.toFixed(4)) : baselineData[idx];
      const merged: Record<string, number | string> = { ...row };
      if (bRow) {
        for (const v of selectedVariables) {
          if (bRow[v] !== undefined) {
            merged[`${v} [Baseline]`] = bRow[v];
          }
        }
      }
      return merged;
    });
  }, [chartData, baselineData, isComparingBaseline, selectedVariables]);

  const handlePinBaseline = () => {
    if (!data.length) return;
    try {
      sessionStorage.setItem("modelscript:simulation-baseline", JSON.stringify(data));
    } catch {}
    setBaselineData([...data]);
    setIsComparingBaseline(true);
  };

  const handleClearBaseline = () => {
    try {
      sessionStorage.removeItem("modelscript:simulation-baseline");
    } catch {}
    setBaselineData(null);
    setIsComparingBaseline(false);
  };

  // Statistical metrics per selected variable
  const statsMap = useMemo(() => {
    if (!data.length || !selectedVariables.length) return {};
    const res: Record<string, { min: number; max: number; peakToPeak: number; mean: number; finalVal: number }> = {};

    for (const v of selectedVariables) {
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let validCount = 0;

      for (let i = 0; i < data.length; i++) {
        const val = Number(data[i][v]);
        if (!isNaN(val)) {
          if (val < min) min = val;
          if (val > max) max = val;
          sum += val;
          validCount++;
        }
      }

      const finalVal = data.length > 0 ? Number(data[data.length - 1][v]) : NaN;

      if (validCount > 0) {
        res[v] = {
          min,
          max,
          peakToPeak: max - min,
          mean: sum / validCount,
          finalVal: isNaN(finalVal) ? 0 : finalVal,
        };
      }
    }
    return res;
  }, [data, selectedVariables]);

  // Dual-cursor measurement metrics (dt, frequency, dy, slope)
  const cursorMetrics = useMemo(() => {
    if (cursor1Time === null || cursor2Time === null || !data.length) return null;
    const t1 = Math.min(cursor1Time, cursor2Time);
    const t2 = Math.max(cursor1Time, cursor2Time);
    const dt = t2 - t1;
    const freq = dt > 1e-6 ? 1 / dt : 0;

    const findNearest = (tTarget: number) => {
      let closest = data[0];
      let minDiff = Math.abs(Number(data[0].time) - tTarget);
      for (let i = 1; i < data.length; i++) {
        const diff = Math.abs(Number(data[i].time) - tTarget);
        if (diff < minDiff) {
          minDiff = diff;
          closest = data[i];
        }
      }
      return closest;
    };

    const row1 = findNearest(t1);
    const row2 = findNearest(t2);

    const deltas: Record<string, { y1: number; y2: number; dy: number; slope: number }> = {};
    for (const v of selectedVariables) {
      const y1 = Number(row1[v]);
      const y2 = Number(row2[v]);
      if (!isNaN(y1) && !isNaN(y2)) {
        const dy = y2 - y1;
        const slope = dt > 1e-6 ? dy / dt : 0;
        deltas[v] = { y1, y2, dy, slope };
      }
    }

    return { t1, t2, dt, freq, deltas };
  }, [cursor1Time, cursor2Time, data, selectedVariables]);

  const handleChartClick = (e: any) => {
    if (!cursorMode || !e || e.activeLabel === undefined) return;
    const t = Number(e.activeLabel);
    if (isNaN(t)) return;

    if (activeCursorPlacement === 1 || cursor1Time === null) {
      setCursor1Time(t);
      setActiveCursorPlacement(2);
    } else {
      setCursor2Time(t);
      setActiveCursorPlacement(1);
    }
  };

  const handleClearCursors = () => {
    setCursor1Time(null);
    setCursor2Time(null);
    setActiveCursorPlacement(1);
  };

  const handleExportCsv = () => {
    if (!data.length) return;
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `simulation_data_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    if (!data.length) return;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `simulation_data_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportParquet = () => {
    if (!data.length) return;
    downloadParquetFile(data, `simulation_data_${Date.now()}.parquet`);
  };

  const handleCopyClipboard = async () => {
    if (!data.length) return;
    const headers = Object.keys(data[0] || {});
    const tsv = [headers.join("\t"), ...data.map((row) => headers.map((h) => row[h]).join("\t"))].join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const toggleVariable = (v: string) => {
    setHiddenVars((prev) => {
      const next = new Set(prev);
      if (next.has(v)) {
        next.delete(v);
      } else {
        next.add(v);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <Spinner size="large" />
        <div style={{ marginTop: "16px" }}>Loading simulation results...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          height: "100%",
        }}
      >
        <div style={{ color: "var(--color-danger-fg)", fontWeight: "bold", marginBottom: 8, fontSize: 16 }}>
          Simulation Failed
        </div>
        <div style={{ color: colorMode === "dark" ? "#8b949e" : "#57606a", fontSize: 14, textAlign: "center" }}>
          {error}
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return <div style={{ padding: "32px", color: "var(--color-fg-muted)" }}>No data available to plot.</div>;
  }

  const allVars = simulationVariables || Object.keys(data[0] || {}).filter((k) => k !== "time");

  return (
    <div style={{ padding: "20px 24px", height: "100%", display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Top Header & Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
          borderBottom: "1px solid var(--color-border-muted)",
          paddingBottom: "12px",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "bold" }}>Simulation Results</h2>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", fontSize: "12px" }}>
          {/* X-Axis Selector for Phase Portrait */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontWeight: 500, color: "var(--color-fg-muted)" }}>X-Axis:</span>
            <select
              value={xAxisVar}
              onChange={(e) => setXAxisVar(e.target.value)}
              style={{
                fontSize: "12px",
                padding: "3px 8px",
                borderRadius: "4px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-default)",
                color: "inherit",
              }}
              title="Select X-Axis variable for time-series or state-space phase portrait"
            >
              <option value="time">Time (s)</option>
              {allVars.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          {/* Normalize Mode Checkbox */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
              userSelect: "none",
            }}
            title="Normalize all variable curves to 0-100% to compare different units and magnitudes"
          >
            <input
              type="checkbox"
              checked={isNormalized}
              onChange={(e) => setIsNormalized(e.target.checked)}
              style={{ accentColor: "var(--color-accent-fg, #0969da)" }}
            />
            <span>Normalize (0-100%)</span>
          </label>

          {/* Logarithmic Scale Checkbox */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={isLogScale}
              onChange={(e) => setIsLogScale(e.target.checked)}
              style={{ accentColor: "var(--color-accent-fg, #0969da)" }}
            />
            <span>Log Scale</span>
          </label>

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            {/* Baseline Comparison (Run A vs Run B) */}
            {!isComparingBaseline ? (
              <button
                onClick={handlePinBaseline}
                style={{
                  fontSize: "11px",
                  padding: "3px 8px",
                  borderRadius: "4px",
                  border: "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
                  background: "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
                  color: "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontWeight: 500,
                  transition: "all 0.15s ease",
                }}
                title="Pin current simulation trajectory as Run A baseline"
              >
                📌 Pin Baseline
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span
                  style={{
                    fontSize: "11px",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    background: "rgba(6, 182, 212, 0.15)",
                    border: "1px solid var(--color-accent-cyan, #06b6d4)",
                    color: "var(--color-accent-cyan, #06b6d4)",
                    fontWeight: 600,
                  }}
                  title="Comparing against pinned baseline (dashed lines)"
                >
                  Comparing Run A
                </span>
                <button
                  onClick={handleClearBaseline}
                  style={{
                    fontSize: "11px",
                    padding: "2px 5px",
                    borderRadius: "4px",
                    border: "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
                    background: "transparent",
                    color: "var(--color-fg-muted)",
                    cursor: "pointer",
                  }}
                  title="Clear pinned baseline comparison"
                >
                  ✕
                </button>
              </div>
            )}
            <button
              onClick={() => {
                const nextMode = !cursorMode;
                setCursorMode(nextMode);
                if (nextMode && cursor1Time === null && data.length > 1) {
                  const tStart = Number(data[0].time) || 0;
                  const tEnd = Number(data[data.length - 1].time) || 1;
                  setCursor1Time(tStart + (tEnd - tStart) * 0.25);
                  setCursor2Time(tStart + (tEnd - tStart) * 0.75);
                }
              }}
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "4px",
                border: cursorMode
                  ? "1px solid var(--color-accent-cyan, #06b6d4)"
                  : "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
                background: cursorMode
                  ? "rgba(6, 182, 212, 0.15)"
                  : "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
                color: cursorMode
                  ? "var(--color-accent-cyan, #06b6d4)"
                  : "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
                cursor: "pointer",
                fontWeight: cursorMode ? 600 : 500,
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                transition: "all 0.15s ease",
              }}
              title="Toggle interactive dual-cursor measurement (click plot to place C1 / C2)"
            >
              📏 Cursors
            </button>
            <button
              onClick={() => setShowStats(!showStats)}
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "4px",
                border: showStats
                  ? "1px solid var(--color-accent-emphasis, #0969da)"
                  : "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
                background: showStats
                  ? "rgba(9, 105, 218, 0.15)"
                  : "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
                color: showStats
                  ? "var(--color-accent-fg, #0969da)"
                  : "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
                cursor: "pointer",
                fontWeight: showStats ? 600 : 500,
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                transition: "all 0.15s ease",
              }}
              title="Toggle numerical statistical summary (Min, Max, Pk-Pk, Mean, Final)"
            >
              📊 Stats
            </button>
            <button
              onClick={handleExportCsv}
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "4px",
                border: "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
                background: "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
                color: "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontWeight: 500,
                transition: "all 0.15s ease",
              }}
              title="Download simulated data as CSV"
            >
              📥 CSV
            </button>
            <button
              onClick={handleExportJson}
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "4px",
                border: "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
                background: "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
                color: "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontWeight: 500,
                transition: "all 0.15s ease",
              }}
              title="Download simulated data as JSON"
            >
              📥 JSON
            </button>
            <button
              onClick={handleExportParquet}
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "4px",
                border: "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
                background: "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
                color: "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontWeight: 500,
                transition: "all 0.15s ease",
              }}
              title="Download simulated data as Apache Parquet (binary columnar format)"
            >
              <ZapIcon size={12} /> Parquet
            </button>
            <button
              onClick={handleCopyClipboard}
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "4px",
                border: "1px solid var(--color-btn-secondary-border, var(--color-border-default))",
                background: "var(--color-btn-secondary-bg, var(--color-canvas-subtle, #f6f8fa))",
                color: "var(--color-btn-secondary-text, var(--color-fg-default, #24292f))",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontWeight: 500,
                transition: "all 0.15s ease",
              }}
              title="Copy tab-delimited simulation data to clipboard"
            >
              {copied ? "✓ Copied!" : "📋 Copy"}
            </button>
          </div>
        </div>
      </div>

      {/* Floating Measurement HUD Banner */}
      {cursorMode && (cursor1Time !== null || cursor2Time !== null) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "8px",
            padding: "6px 12px",
            background: "var(--color-canvas-subtle, #161b22)",
            border: "1px solid var(--color-accent-cyan, #06b6d4)",
            borderRadius: "6px",
            fontSize: "11px",
            fontFamily: "var(--font-mono, monospace)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, color: "var(--color-accent-cyan, #06b6d4)" }}>
              📏 Measurement (Click plot to place C{activeCursorPlacement}):
            </span>
            {cursor1Time !== null && (
              <span style={{ color: "#06b6d4" }}>
                C1: <strong>{cursor1Time.toFixed(4)}s</strong>
              </span>
            )}
            {cursor2Time !== null && (
              <span style={{ color: "#ec4899" }}>
                C2: <strong>{cursor2Time.toFixed(4)}s</strong>
              </span>
            )}
            {cursorMetrics && (
              <>
                <span>
                  Δt: <strong>{cursorMetrics.dt.toFixed(4)}s</strong>
                </span>
                <span>
                  f: <strong>{cursorMetrics.freq.toFixed(2)} Hz</strong>
                </span>
                {activeVariables.slice(0, 3).map((v) => {
                  const d = cursorMetrics.deltas[v];
                  if (!d) return null;
                  return (
                    <span key={v} style={{ color: "var(--color-fg-muted)" }}>
                      Δ{v}: <strong style={{ color: "var(--color-fg-default)" }}>{d.dy.toFixed(3)}</strong> (m:{" "}
                      {d.slope.toFixed(2)})
                    </span>
                  );
                })}
              </>
            )}
          </div>
          <button
            onClick={handleClearCursors}
            style={{
              padding: "2px 6px",
              fontSize: "11px",
              borderRadius: "4px",
              border: "1px solid var(--color-border-default)",
              background: "transparent",
              color: "var(--color-fg-muted)",
              cursor: "pointer",
            }}
          >
            Clear Cursors
          </button>
        </div>
      )}

      {/* Interactive Legend Bar */}
      {selectedVariables.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            alignItems: "center",
            padding: "4px 0",
          }}
        >
          {selectedVariables.map((v, i) => {
            const isHidden = hiddenVars.has(v);
            const color = SIMULATION_COLORS[i % SIMULATION_COLORS.length];
            return (
              <button
                key={v}
                onClick={() => toggleVariable(v)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontFamily: "monospace",
                  cursor: "pointer",
                  border: `1px solid ${isHidden ? "var(--color-border-muted)" : color}`,
                  background: isHidden ? "transparent" : `${color}15`,
                  color: isHidden ? "var(--color-fg-muted)" : "inherit",
                  opacity: isHidden ? 0.6 : 1,
                  textDecoration: isHidden ? "line-through" : "none",
                }}
                title={`Click to ${isHidden ? "show" : "hide"} ${v}`}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: isHidden ? "var(--color-fg-muted)" : color,
                  }}
                />
                {v}
              </button>
            );
          })}
        </div>
      )}

      {/* Main Plot Area */}
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative" }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={mergedChartData}
              onClick={handleChartClick}
              margin={{
                top: 10,
                right: 30,
                left: 20,
                bottom: 35,
              }}
            >
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
                domain={["dataMin", "dataMax"]}
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
                domain={isNormalized ? [0, 100] : isLogScale ? ["auto", "auto"] : ["auto", "auto"]}
                stroke="var(--color-fg-muted, #8b949e)"
                tick={{ fill: "var(--color-fg-muted, #8b949e)", fontSize: 11 }}
                tickFormatter={(val) => (isNormalized ? `${val}%` : Number(val).toFixed(2))}
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
                  stroke: "var(--color-accent-fg, #58a6ff)",
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
                  />
                }
              />

              {/* Interactive Dual Cursors */}
              {cursorMode && cursor1Time !== null && (
                <ReferenceLine
                  x={cursor1Time}
                  stroke="#06b6d4"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  label={{ value: "C1", fill: "#06b6d4", fontSize: 11, position: "top", fontWeight: 700 }}
                />
              )}
              {cursorMode && cursor2Time !== null && (
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
                    const colorIdx =
                      (selectedVariables.indexOf(v) * sweepResults.length + j) % SIMULATION_COLORS.length;
                    return (
                      <Line
                        key={key}
                        type="linear"
                        dataKey={key}
                        name={key}
                        stroke={SIMULATION_COLORS[colorIdx]}
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
                    stroke={SIMULATION_COLORS[selectedVariables.indexOf(v) % SIMULATION_COLORS.length]}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />,
                ];
                if (baselineData && isComparingBaseline) {
                  const bKey = `${v} [Baseline]`;
                  lines.push(
                    <Line
                      key={bKey}
                      type="linear"
                      dataKey={bKey}
                      name={bKey}
                      stroke={SIMULATION_COLORS[selectedVariables.indexOf(v) % SIMULATION_COLORS.length]}
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      strokeOpacity={0.55}
                      dot={false}
                      activeDot={{ r: 3 }}
                      isAnimationActive={false}
                    />,
                  );
                }
                return lines;
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Collapsible Statistical Summary Drawer */}
      {showStats && Object.keys(statsMap).length > 0 && (
        <div
          style={{
            maxHeight: "140px",
            overflowY: "auto",
            border: "1px solid var(--color-border-muted, #21262d)",
            borderRadius: "6px",
            padding: "8px 12px",
            background: "var(--color-canvas-subtle, #161b22)",
            fontSize: "11px",
            fontFamily: "var(--font-mono, monospace)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.5fr repeat(5, 1fr)",
              gap: "8px",
              fontWeight: 600,
              borderBottom: "1px solid var(--color-border-muted, #21262d)",
              paddingBottom: "4px",
              marginBottom: "4px",
              color: "var(--color-fg-muted, #8b949e)",
            }}
          >
            <span>Variable</span>
            <span>Min</span>
            <span>Max</span>
            <span>Pk-Pk</span>
            <span>Mean</span>
            <span>Final</span>
          </div>
          {activeVariables.map((v) => {
            const s = statsMap[v];
            if (!s) return null;
            const color = SIMULATION_COLORS[selectedVariables.indexOf(v) % SIMULATION_COLORS.length];
            return (
              <div
                key={v}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.5fr repeat(5, 1fr)",
                  gap: "8px",
                  padding: "2px 0",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{v}</span>
                </div>
                <span>{s.min.toFixed(4)}</span>
                <span>{s.max.toFixed(4)}</span>
                <span>{s.peakToPeak.toFixed(4)}</span>
                <span>{s.mean.toFixed(4)}</span>
                <span>{s.finalVal.toFixed(4)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
