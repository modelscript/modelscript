// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner } from "@primer/react";
import Papa from "papaparse";
import { useEffect, useMemo, useState } from "react";
import { getSimulationJobResult } from "../../api";
import { useTheme } from "../../theme";
import { downloadParquetFile } from "../../util/binary-export";
import { SIMULATION_COLORS } from "./constants";
import {
  InteractiveLegend,
  MeasurementHud,
  type SimulationResultsProps,
  SimulationToolbar,
  StatisticsDrawer,
  TrajectoryChart,
  type VariableStatEntry,
} from "./simulation-results";

export type { SimulationResultsProps };

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
            const headers = Object.keys(localData[0]!);
            const timeCol = headers[0]!;
            const vars = simulationVariables ?? headers.filter((h) => h !== timeCol);

            onVariablesLoaded(vars);

            const chartData = localData.map((row) => {
              const newRow: Record<string, number | string> = { time: row[timeCol]! };
              vars.forEach((v) => {
                newRow[v] = row[v]!;
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
              const headers = Object.keys(parsedData[0]!);
              const timeCol = headers[0]!;
              const vars = headers.filter((h) => h !== timeCol);

              onVariablesLoaded(vars);

              const chartData = parsedData.map((row) => {
                const newRow: Record<string, number | string> = { time: row[timeCol]! };
                vars.forEach((v) => {
                  newRow[v] = row[v]!;
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
            const rawBVal = Number(bRow[v]);
            const mm = minMaxMap[v];
            if (isNormalized && !isNaN(rawBVal) && mm) {
              merged[`_raw_${v} [Baseline]`] = rawBVal;
              merged[`${v} [Baseline]`] = ((rawBVal - mm.min) / (mm.max - mm.min || 1)) * 100;
            } else {
              merged[`${v} [Baseline]`] = bRow[v];
            }
          }
        }
      }
      return merged;
    });
  }, [chartData, baselineData, isComparingBaseline, selectedVariables, isNormalized, minMaxMap]);

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
    const res: Record<string, VariableStatEntry> = {};

    for (const v of selectedVariables) {
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let validCount = 0;

      for (let i = 0; i < data.length; i++) {
        const val = Number(data[i]![v]);
        if (!isNaN(val)) {
          if (val < min) min = val;
          if (val > max) max = val;
          sum += val;
          validCount++;
        }
      }

      const finalVal = data.length > 0 ? Number(data[data.length - 1]![v]) : NaN;

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
      let minDiff = Math.abs(Number(data[0]!.time) - tTarget);
      for (let i = 1; i < data.length; i++) {
        const diff = Math.abs(Number(data[i]!.time) - tTarget);
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
      const y1 = Number(row1![v]);
      const y2 = Number(row2![v]);
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
      <SimulationToolbar
        xAxisVar={xAxisVar}
        onXAxisVarChange={setXAxisVar}
        allVars={allVars}
        isNormalized={isNormalized}
        onToggleNormalized={setIsNormalized}
        isLogScale={isLogScale}
        onToggleLogScale={setIsLogScale}
        isComparingBaseline={isComparingBaseline}
        onPinBaseline={handlePinBaseline}
        onClearBaseline={handleClearBaseline}
        cursorMode={cursorMode}
        onToggleCursorMode={() => {
          const nextMode = !cursorMode;
          setCursorMode(nextMode);
          if (nextMode && cursor1Time === null && data.length > 1) {
            const tStart = Number(data[0]!.time) || 0;
            const tEnd = Number(data[data.length - 1]!.time) || 1;
            setCursor1Time(tStart + (tEnd - tStart) * 0.25);
            setCursor2Time(tStart + (tEnd - tStart) * 0.75);
          }
        }}
        showStats={showStats}
        onToggleShowStats={() => setShowStats(!showStats)}
        onExportCsv={handleExportCsv}
        onExportJson={handleExportJson}
        onExportParquet={handleExportParquet}
        onCopyClipboard={handleCopyClipboard}
        copied={copied}
      />

      {/* Floating Measurement HUD Banner */}
      <MeasurementHud
        cursorMode={cursorMode}
        cursor1Time={cursor1Time}
        cursor2Time={cursor2Time}
        activeCursorPlacement={activeCursorPlacement}
        cursorMetrics={cursorMetrics}
        activeVariables={activeVariables}
        onClearCursors={handleClearCursors}
      />

      {/* Interactive Legend Bar */}
      <InteractiveLegend
        selectedVariables={selectedVariables}
        hiddenVars={hiddenVars}
        onToggleVariable={toggleVariable}
        colors={SIMULATION_COLORS}
      />

      {/* Main Plot Area */}
      <TrajectoryChart
        mergedChartData={mergedChartData}
        rawData={data}
        xAxisVar={xAxisVar}
        isNormalized={isNormalized}
        isLogScale={isLogScale}
        colorMode={colorMode}
        minMaxMap={minMaxMap}
        isComparingBaseline={isComparingBaseline}
        cursorMode={cursorMode}
        cursor1Time={cursor1Time}
        cursor2Time={cursor2Time}
        activeVariables={activeVariables}
        selectedVariables={selectedVariables}
        sweepResults={sweepResults}
        baselineData={baselineData}
        colors={SIMULATION_COLORS}
        onChartClick={handleChartClick}
      />

      {/* Collapsible Statistical Summary Drawer */}
      <StatisticsDrawer
        showStats={showStats}
        statsMap={statsMap}
        activeVariables={activeVariables}
        selectedVariables={selectedVariables}
        colors={SIMULATION_COLORS}
      />
    </div>
  );
}

export default SimulationResults;
