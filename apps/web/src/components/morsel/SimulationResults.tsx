// SPDX-License-Identifier: AGPL-3.0-or-later

import Papa from "papaparse";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSimulationJobResult } from "../../api";
import { useTheme } from "../../theme";
import { downloadParquetFile } from "../../util/binary-export";
import Spinner from "../Spinner";
import { SIMULATION_COLORS } from "./constants";
import { Ieee2800VerificationCard } from "./simulation-results/components/Ieee2800VerificationCard";
import { InteractiveLegend } from "./simulation-results/components/InteractiveLegend";
import { MeasurementHud } from "./simulation-results/components/MeasurementHud";
import { SimulationToolbar } from "./simulation-results/components/SimulationToolbar";
import { StatisticsDrawer } from "./simulation-results/components/StatisticsDrawer";
import { TrajectoryChart } from "./simulation-results/components/TrajectoryChart";
import type { SimulationResultsProps, VariableStatEntry } from "./simulation-results/types";

export type { SimulationResultsProps };

const BASELINE_GLOBAL_KEY = "modelscript:simulation-baseline";

export function SimulationResults({
  jobId,
  localData,
  sweepResults,
  simulationVariables,
  error: externalError,
  selectedVariables: propSelectedVariables,
  onVariablesLoaded,
  colorMode: propColorMode,
  modelName,
  onRetry,
}: SimulationResultsProps & { modelName?: string | null | undefined; onRetry?: (() => void) | undefined }) {
  const { theme } = useTheme();
  const colorMode = propColorMode || (theme === "dark" ? "dark" : "light");
  const [data, setData] = useState<Record<string, number | string>[]>(localData || []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(externalError || null);
  const [isNormalized, setIsNormalized] = useState(false);
  const [isLogScale, setIsLogScale] = useState(false);
  const [xAxisVar, setXAxisVar] = useState<string>("time");
  const [hiddenVars, setHiddenVars] = useState<Set<string>>(new Set());
  const [internalSelectedVars, setInternalSelectedVars] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [showIeee2800, setShowIeee2800] = useState(false);

  const allVars = useMemo(() => {
    if (simulationVariables && simulationVariables.length > 0) {
      return simulationVariables;
    }
    if (data.length > 0) {
      const headers = Object.keys(data[0]!);
      const timeCol = headers.find((h) => h.toLowerCase() === "time") || headers[0]!;
      return headers.filter((h) => h !== timeCol);
    }
    return [];
  }, [simulationVariables, data]);

  const selectedVariables = useMemo(() => {
    if (propSelectedVariables !== undefined && propSelectedVariables !== null) {
      return propSelectedVariables;
    }
    if (internalSelectedVars.length > 0) {
      return internalSelectedVars;
    }
    return allVars;
  }, [propSelectedVariables, internalSelectedVars, allVars]);

  const autoHiddenRef = useRef(false);
  useEffect(() => {
    autoHiddenRef.current = false;
  }, [modelName, jobId]);

  useEffect(() => {
    if (propSelectedVariables === undefined && allVars.length > 6 && !autoHiddenRef.current) {
      autoHiddenRef.current = true;
      setHiddenVars(new Set(allVars.slice(6)));
    }
  }, [propSelectedVariables, allVars]);

  const hasIeee2800Channels = useMemo(() => {
    if (!data || data.length === 0) return false;
    const sample = data[0]!;
    const keys = Object.keys(sample).map((k) => k.toLowerCase());
    return keys.some(
      (k) =>
        k.includes("vpoi") ||
        k.includes("iibr") ||
        k.includes("v_a") ||
        k.includes("v_b") ||
        k.includes("ia") ||
        k.includes("ib") ||
        k === "v1" ||
        k === "v2" ||
        k === "i1q" ||
        k === "i2q" ||
        (modelName &&
          (modelName.toLowerCase().includes("grid") ||
            modelName.toLowerCase().includes("ibr") ||
            modelName.toLowerCase().includes("inverter") ||
            modelName.toLowerCase().includes("solar") ||
            modelName.toLowerCase().includes("wind"))),
    );
  }, [data, modelName]);

  const baselineScopeKey = modelName || jobId ? `${BASELINE_GLOBAL_KEY}:${modelName || jobId}` : null;

  // Baseline comparison state (Run A vs Run B)
  const [baselineData, setBaselineData] = useState<Record<string, number | string>[] | null>(() => {
    try {
      const stored =
        (baselineScopeKey ? sessionStorage.getItem(baselineScopeKey) : null) ??
        sessionStorage.getItem(BASELINE_GLOBAL_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [isComparingBaseline, setIsComparingBaseline] = useState<boolean>(() => {
    try {
      return Boolean(
        (baselineScopeKey ? sessionStorage.getItem(baselineScopeKey) : null) ??
        sessionStorage.getItem(BASELINE_GLOBAL_KEY),
      );
    } catch {
      return false;
    }
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
            const timeCol = headers.find((h) => h.toLowerCase() === "time") || headers[0]!;
            const vars = simulationVariables ?? headers.filter((h) => h !== timeCol);

            onVariablesLoaded?.(vars);
            if (!propSelectedVariables) {
              setInternalSelectedVars(vars);
            }

            const chartData = localData.map((row) => {
              const newRow: Record<string, number | string> = {
                ...row,
                time: row[timeCol] !== undefined ? row[timeCol]! : (row.time ?? 0),
              };
              vars.forEach((v) => {
                if (newRow[v] === undefined) {
                  const sweepKey = Object.keys(row).find((k) => k.startsWith(`${v} (`));
                  if (sweepKey !== undefined && row[sweepKey] !== undefined) {
                    newRow[v] = row[sweepKey]!;
                  }
                }
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

              onVariablesLoaded?.(vars);
              if (!propSelectedVariables) {
                setInternalSelectedVars(vars);
              }

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
  }, [jobId, localData, onVariablesLoaded, externalError, simulationVariables, sweepResults, propSelectedVariables]);

  const activeVariables = useMemo(() => {
    return (selectedVariables || []).filter((v) => !hiddenVars.has(v));
  }, [selectedVariables, hiddenVars]);

  // Compute normalized data when in normalized mode
  const { chartData, minMaxMap } = useMemo(() => {
    if (!data.length) return { chartData: [], minMaxMap: {} };

    const minMax: Record<string, { min: number; max: number }> = {};
    if (isNormalized) {
      for (const v of selectedVariables || []) {
        const sweepKeys = sweepResults && sweepResults.length > 0 ? sweepResults.map((s) => `${v} (${s.value})`) : [v];

        let min = Infinity;
        let max = -Infinity;
        for (const row of data) {
          for (const k of sweepKeys) {
            const val = Number(row[k]);
            if (!isNaN(val)) {
              if (val < min) min = val;
              if (val > max) max = val;
            }
          }
          if (row[v] !== undefined) {
            const val = Number(row[v]);
            if (!isNaN(val)) {
              if (val < min) min = val;
              if (val > max) max = val;
            }
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
        for (const v of selectedVariables || []) {
          const mm = minMax[v];
          if (!mm) continue;
          const sweepKeys =
            sweepResults && sweepResults.length > 0 ? sweepResults.map((s) => `${v} (${s.value})`) : [v];
          for (const k of sweepKeys) {
            const val = Number(row[k]);
            if (!isNaN(val)) {
              newRow[`_raw_${k}`] = val;
              newRow[k] = ((val - mm.min) / (mm.max - mm.min || 1)) * 100;
            }
          }
          if (row[v] !== undefined) {
            const val = Number(row[v]);
            if (!isNaN(val)) {
              newRow[`_raw_${v}`] = val;
              newRow[v] = ((val - mm.min) / (mm.max - mm.min || 1)) * 100;
            }
          }
        }
        return newRow;
      });
      return { chartData: normalized, minMaxMap: minMax };
    }

    return { chartData: data, minMaxMap: minMax };
  }, [data, isNormalized, selectedVariables, sweepResults]);

  // Merge baseline trajectory into chartData if comparison is active (with linear interpolation for mismatched solver timestamps)
  const mergedChartData = useMemo(() => {
    if (!baselineData || !isComparingBaseline || !chartData.length) {
      return chartData;
    }
    const baselineMap = new Map<string, Record<string, number | string>>();
    const sortedBaseline: { t: number; row: Record<string, number | string> }[] = [];
    for (const bRow of baselineData) {
      const t = Number(bRow.time);
      if (!isNaN(t)) {
        baselineMap.set(t.toFixed(4), bRow);
        sortedBaseline.push({ t, row: bRow });
      }
    }
    sortedBaseline.sort((a, b) => a.t - b.t);

    const interpolateBaselineValue = (tTarget: number, varName: string): number | string | undefined => {
      const exactRow = baselineMap.get(tTarget.toFixed(4));
      if (exactRow && exactRow[varName] !== undefined) {
        return exactRow[varName];
      }
      if (sortedBaseline.length === 0) return undefined;
      const tMin = sortedBaseline[0]!.t;
      const tMax = sortedBaseline[sortedBaseline.length - 1]!.t;
      if (tTarget < tMin || tTarget > tMax) return undefined;
      if (sortedBaseline.length === 1) {
        return sortedBaseline[0]!.row[varName];
      }

      let lo = 0;
      let hi = sortedBaseline.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedBaseline[mid]!.t <= tTarget) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      const p0 = sortedBaseline[lo]!;
      const p1 = sortedBaseline[hi]!;
      const v0 = Number(p0.row[varName]);
      const v1 = Number(p1.row[varName]);
      if (!Number.isFinite(v0) || !Number.isFinite(v1)) {
        return p0.row[varName] ?? p1.row[varName];
      }
      const span = p1.t - p0.t;
      if (Math.abs(span) < 1e-12) return v0;
      const alpha = (tTarget - p0.t) / span;
      return v0 + alpha * (v1 - v0);
    };

    return chartData.map((row, idx) => {
      const t = Number(row.time);
      const merged: Record<string, number | string> = { ...row };
      for (const v of selectedVariables || []) {
        const bVal = !isNaN(t) ? interpolateBaselineValue(t, v) : baselineData[idx]?.[v];
        if (bVal !== undefined) {
          const rawBVal = Number(bVal);
          const mm = minMaxMap[v];
          if (isNormalized && !isNaN(rawBVal) && mm) {
            merged[`_raw_${v} [Baseline]`] = rawBVal;
            merged[`${v} [Baseline]`] = ((rawBVal - mm.min) / (mm.max - mm.min || 1)) * 100;
          } else {
            merged[`${v} [Baseline]`] = bVal;
          }
        }
      }
      return merged;
    });
  }, [chartData, baselineData, isComparingBaseline, selectedVariables, isNormalized, minMaxMap]);

  const handlePinBaseline = () => {
    if (!data.length) return;
    try {
      const serialized = JSON.stringify(data);
      if (baselineScopeKey) {
        sessionStorage.setItem(baselineScopeKey, serialized);
      }
      sessionStorage.setItem(BASELINE_GLOBAL_KEY, serialized);
    } catch {}
    setBaselineData([...data]);
    setIsComparingBaseline(true);
  };

  const handleClearBaseline = () => {
    try {
      if (baselineScopeKey) {
        sessionStorage.removeItem(baselineScopeKey);
      }
      sessionStorage.removeItem(BASELINE_GLOBAL_KEY);
    } catch {}
    setBaselineData(null);
    setIsComparingBaseline(false);
  };

  // Statistical metrics per selected variable
  const statsMap = useMemo(() => {
    if (!data.length || !(selectedVariables && selectedVariables.length)) return {};
    const res: Record<string, VariableStatEntry> = {};

    for (const v of selectedVariables || []) {
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
    if (
      cursor1Time === null ||
      cursor2Time === null ||
      !data.length ||
      !(selectedVariables && selectedVariables.length)
    )
      return null;
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
    for (const v of selectedVariables || []) {
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

  const getValuesAtTime = (tTarget: number): Record<string, number> => {
    const values: Record<string, number> = {};
    if (!data.length) return values;
    let closest = data[0]!;
    let minDiff = Math.abs(Number(closest.time) - tTarget);
    for (let i = 1; i < data.length; i++) {
      const diff = Math.abs(Number(data[i]!.time) - tTarget);
      if (diff < minDiff) {
        minDiff = diff;
        closest = data[i]!;
      }
    }
    const varsToExtract = activeVariables.length > 0 ? activeVariables : selectedVariables || [];
    for (const v of varsToExtract) {
      const numVal = Number(closest[v]);
      if (Number.isFinite(numVal)) {
        values[v] = numVal;
      }
    }
    for (const [k, rawVal] of Object.entries(closest)) {
      if (k !== "time" && !(k in values)) {
        const numVal = Number(rawVal);
        if (Number.isFinite(numVal)) {
          values[k] = numVal;
        }
      }
    }
    return values;
  };

  const dispatchTimeScrub = (t: number | null) => {
    if (typeof window === "undefined") return;
    if (t === null || !Number.isFinite(t)) {
      window.dispatchEvent(new CustomEvent("morsel:time-scrub", { detail: { time: null, values: null } }));
      return;
    }
    window.dispatchEvent(new CustomEvent("morsel:time-scrub", { detail: { time: t, values: getValuesAtTime(t) } }));
  };

  const handlePlotMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!data.length) return;
    const tStart = Number(data[0]!.time);
    const tEnd = Number(data[data.length - 1]!.time);
    if (!Number.isFinite(tStart) || !Number.isFinite(tEnd)) return;

    const gridEl =
      e.currentTarget.querySelector(".recharts-cartesian-grid") ??
      e.currentTarget.querySelector(".recharts-surface") ??
      e.currentTarget;
    const rect = gridEl.getBoundingClientRect();
    if (rect.width <= 0) return;

    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const rawT = tStart + ratio * (tEnd - tStart);
    let nearestT = rawT;
    let minDiff = Infinity;
    for (let i = 0; i < data.length; i++) {
      const rowT = Number(data[i]!.time);
      const diff = Math.abs(rowT - rawT);
      if (diff < minDiff) {
        minDiff = diff;
        nearestT = rowT;
      }
    }
    dispatchTimeScrub(nearestT);
  };

  const handlePlotMouseLeave = () => {
    dispatchTimeScrub(null);
  };

  const handleChartClick = (e: any) => {
    if (!e || e.activeLabel === undefined) return;
    const t = Number(e.activeLabel);
    if (isNaN(t)) return;

    dispatchTimeScrub(t);
    if (!cursorMode) return;

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
    dispatchTimeScrub(null);
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
          gap: 12,
        }}
      >
        <div style={{ color: "var(--color-danger-fg)", fontWeight: 700, fontSize: 15 }}>Simulation Failed</div>
        <div
          style={{
            color: "var(--ms-text-2, var(--color-fg-muted))",
            fontSize: 13,
            textAlign: "center",
            maxWidth: 480,
            fontFamily: "var(--font-mono, monospace)",
          }}
        >
          {error}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              marginTop: 4,
              background: "var(--ms-brand, #0e7490)",
              color: "#ffffff",
              border: "1px solid var(--ms-brand, #0e7490)",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ↻ Retry Simulation
          </button>
        )}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div
        style={{
          padding: "32px",
          color: "var(--color-fg-muted)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: 12,
        }}
      >
        <div>No data available to plot.</div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              background: "var(--ms-brand, #0e7490)",
              color: "#ffffff",
              border: "1px solid var(--ms-brand, #0e7490)",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ▶ Run Simulation
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
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

      {/* IEEE 2800-2022 Grid Code Verification Toggle & Card */}
      {hasIeee2800Channels && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            data-testid="toggle-ieee2800-btn"
            onClick={() => setShowIeee2800(!showIeee2800)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              background: showIeee2800
                ? "var(--color-accent-emphasis, #1f6feb)"
                : "var(--color-canvas-subtle, #161b22)",
              color: "#ffffff",
              border: "1px solid var(--color-border-default, #30363d)",
              cursor: "pointer",
            }}
          >
            🛡️ IEEE 2800 Verification {showIeee2800 ? "▲" : "▼"}
          </button>
        </div>
      )}

      {hasIeee2800Channels && showIeee2800 && (
        <Ieee2800VerificationCard data={data} colorMode={colorMode} onClose={() => setShowIeee2800(false)} />
      )}

      {/* Interactive Legend Bar */}
      <InteractiveLegend
        selectedVariables={selectedVariables || []}
        hiddenVars={hiddenVars}
        onToggleVariable={toggleVariable}
        colors={SIMULATION_COLORS}
        sweepResults={sweepResults}
      />

      {/* Main Plot Area */}
      <div
        style={{
          height: "clamp(360px, 58vh, 680px)",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
        onMouseMove={handlePlotMouseMove}
        onMouseLeave={handlePlotMouseLeave}
      >
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
          selectedVariables={selectedVariables || []}
          sweepResults={sweepResults}
          baselineData={baselineData}
          colors={SIMULATION_COLORS}
          onChartClick={handleChartClick}
        />
      </div>

      {/* Collapsible Statistical Summary Drawer */}
      <StatisticsDrawer
        showStats={showStats}
        statsMap={statsMap}
        activeVariables={activeVariables}
        selectedVariables={selectedVariables || []}
        colors={SIMULATION_COLORS}
      />
    </div>
  );
}

export default SimulationResults;
