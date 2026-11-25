// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CursorState, ViewportRange } from "@modelscript/simulate/charts";
import Papa from "papaparse";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorHost, useEditorTheme as useTheme } from "../host";
import { downloadParquetFile } from "../internal/binary-export";
import Spinner from "../internal/Spinner";
import { SIMULATION_COLORS } from "./constants";
import { Ieee2800VerificationCard } from "./simulation-results/components/Ieee2800VerificationCard";
import { InteractiveLegend } from "./simulation-results/components/InteractiveLegend";
import { MeasurementHud } from "./simulation-results/components/MeasurementHud";
import { PscadInstrumentsPanel } from "./simulation-results/components/PscadInstrumentsPanel";
import { SimulationToolbar } from "./simulation-results/components/SimulationToolbar";
import { StatisticsDrawer } from "./simulation-results/components/StatisticsDrawer";
import { TrajectoryChart } from "./simulation-results/components/TrajectoryChart";
import type { SimulationResultsProps, VariableStatEntry } from "./simulation-results/types";
import { DslSimulationCardsStrip } from "./util/LanguagePanelHost";

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
  complianceReport,
  pscadExports,
}: SimulationResultsProps & { modelName?: string | null | undefined; onRetry?: (() => void) | undefined }) {
  const editorHost = useEditorHost();
  const { theme } = useTheme();
  const colorMode = propColorMode || (theme === "dark" ? "dark" : "light");
  const [data, setData] = useState<Record<string, number | string>[]>(localData || []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(externalError || null);
  const [isNormalized, setIsNormalized] = useState(false);
  const [isLogScale, setIsLogScale] = useState(false);
  const [isMultiTrack, setIsMultiTrack] = useState(false);
  const [isDualY, setIsDualY] = useState(false);
  const [preferCanvas, setPreferCanvas] = useState(false);
  const [sharedViewport, setSharedViewport] = useState<ViewportRange>({});
  const [rtpPlaying, setRtpPlaying] = useState(false);
  const [rtpIndex, setRtpIndex] = useState(0);
  const [xAxisVar, setXAxisVar] = useState<string>("time");
  const [hiddenVars, setHiddenVars] = useState<Set<string>>(new Set());
  const [internalSelectedVars, setInternalSelectedVars] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [showIeee2800, setShowIeee2800] = useState(false);
  const [showInstruments, setShowInstruments] = useState(false);

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
    setSharedViewport({});
  }, [modelName, jobId]);

  useEffect(() => {
    const frames = pscadExports?.graphFrames;
    if (frames && frames.length > 0 && (frames.length > 1 || frames.some((f) => f.kind === "poly"))) {
      setIsMultiTrack(true);
    }
  }, [pscadExports?.graphFrames]);

  useEffect(() => {
    if (propSelectedVariables === undefined && allVars.length > 6 && !autoHiddenRef.current) {
      autoHiddenRef.current = true;
      setHiddenVars(new Set(allVars.slice(6)));
    }
  }, [propSelectedVariables, allVars]);

  const hasIeee2800Channels = Boolean(complianceReport);

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
  const [pinnedRuns, setPinnedRuns] = useState<{ label: string; data: Record<string, number | string>[] }[]>(() =>
    baselineData ? [{ label: "Baseline", data: baselineData }] : [],
  );

  // Dual-cursor measurement state (C1, C2, dt, frequency, slope)
  const [cursorMode, setCursorMode] = useState<boolean>(false);
  const [cursor1Time, setCursor1Time] = useState<number | null>(null);
  const [cursor2Time, setCursor2Time] = useState<number | null>(null);
  const [activeCursorPlacement, setActiveCursorPlacement] = useState<1 | 2>(1);
  const [showStats, setShowStats] = useState<boolean>(false);

  const onVariablesLoadedRef = useRef(onVariablesLoaded);
  onVariablesLoadedRef.current = onVariablesLoaded;
  const propSelectedVariablesRef = useRef(propSelectedVariables);
  propSelectedVariablesRef.current = propSelectedVariables;
  const lastLoadedVarsKeyRef = useRef<string | null>(null);

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
            const vars =
              simulationVariables && simulationVariables.length > 0
                ? simulationVariables
                : headers.filter((h) => h !== timeCol);

            const varsKey = vars.join("\0");
            if (lastLoadedVarsKeyRef.current !== varsKey) {
              lastLoadedVarsKeyRef.current = varsKey;
              onVariablesLoadedRef.current?.(vars);
            }
            if (!propSelectedVariablesRef.current) {
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
          } else {
            setData([]);
          }
          setLoading(false);
          return;
        }

        if (!jobId) {
          setError("No simulation job ID or local data provided.");
          setLoading(false);
          return;
        }

        if (!editorHost.getSimulationJobResult) {
          setError("Cloud simulation job fetching is not configured in this host.");
          setLoading(false);
          return;
        }
        const csvText = await editorHost.getSimulationJobResult(jobId);

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

              const varsKey = vars.join("\0");
              if (lastLoadedVarsKeyRef.current !== varsKey) {
                lastLoadedVarsKeyRef.current = varsKey;
                onVariablesLoadedRef.current?.(vars);
              }
              if (!propSelectedVariablesRef.current) {
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
  }, [jobId, localData, externalError, simulationVariables, sweepResults]);

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

  // Merge up to 4 pinned runs into chartData if comparison is active (with linear interpolation for mismatched solver timestamps)
  const mergedChartData = useMemo(() => {
    const runsToMerge =
      pinnedRuns.length > 0 ? pinnedRuns : baselineData ? [{ label: "Baseline", data: baselineData }] : [];
    if (!runsToMerge.length || !isComparingBaseline || !chartData.length) {
      return chartData;
    }

    const preparedRuns = runsToMerge.map((run) => {
      const map = new Map<string, Record<string, number | string>>();
      const sorted: { t: number; row: Record<string, number | string> }[] = [];
      for (const bRow of run.data) {
        const t = Number(bRow.time);
        if (!isNaN(t)) {
          map.set(t.toFixed(6), bRow);
          sorted.push({ t, row: bRow });
        }
      }
      sorted.sort((a, b) => a.t - b.t);
      return { label: run.label, raw: run.data, map, sorted };
    });

    const interpolateRunValue = (
      run: (typeof preparedRuns)[number],
      tTarget: number,
      varName: string,
    ): number | string | undefined => {
      const exactRow = run.map.get(tTarget.toFixed(6));
      if (exactRow && exactRow[varName] !== undefined) {
        return exactRow[varName];
      }
      if (run.sorted.length === 0) return undefined;
      const tMin = run.sorted[0]!.t;
      const tMax = run.sorted[run.sorted.length - 1]!.t;
      if (tTarget < tMin || tTarget > tMax) return undefined;
      if (run.sorted.length === 1) {
        return run.sorted[0]!.row[varName];
      }
      let lo = 0;
      let hi = run.sorted.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (run.sorted[mid]!.t <= tTarget) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      const p0 = run.sorted[lo]!;
      const p1 = run.sorted[hi]!;
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
      for (const run of preparedRuns) {
        for (const v of selectedVariables || []) {
          const bVal = !isNaN(t) ? interpolateRunValue(run, t, v) : run.raw[idx]?.[v];
          if (bVal !== undefined) {
            const rawBVal = Number(bVal);
            const mm = minMaxMap[v];
            if (isNormalized && !isNaN(rawBVal) && mm) {
              merged[`_raw_${v} [${run.label}]`] = rawBVal;
              merged[`${v} [${run.label}]`] = ((rawBVal - mm.min) / (mm.max - mm.min || 1)) * 100;
            } else {
              merged[`${v} [${run.label}]`] = bVal;
            }
          }
        }
      }
      return merged;
    });
  }, [chartData, pinnedRuns, baselineData, isComparingBaseline, selectedVariables, isNormalized, minMaxMap]);

  const handlePinBaseline = () => {
    if (!data.length) return;
    const copy = [...data];
    setPinnedRuns((prev) => {
      const nextIdx = prev.length + 1;
      const label = prev.length === 0 ? "Baseline" : `Run #${nextIdx}`;
      const next =
        prev.length >= 4
          ? [...prev.slice(1), { label: `Run #${Date.now() % 100}`, data: copy }]
          : [...prev, { label, data: copy }];
      return next;
    });
    if (!baselineData) {
      try {
        const serialized = JSON.stringify(copy);
        if (baselineScopeKey) {
          sessionStorage.setItem(baselineScopeKey, serialized);
        }
        sessionStorage.setItem(BASELINE_GLOBAL_KEY, serialized);
      } catch {}
      setBaselineData(copy);
    }
    setIsComparingBaseline(true);
  };

  const handleRemovePinnedRun = (index: number) => {
    setPinnedRuns((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        try {
          if (baselineScopeKey) sessionStorage.removeItem(baselineScopeKey);
          sessionStorage.removeItem(BASELINE_GLOBAL_KEY);
        } catch {}
        setBaselineData(null);
        setIsComparingBaseline(false);
      } else {
        setBaselineData(next[0]!.data);
      }
      return next;
    });
  };

  const handleClearBaseline = () => {
    try {
      if (baselineScopeKey) {
        sessionStorage.removeItem(baselineScopeKey);
      }
      sessionStorage.removeItem(BASELINE_GLOBAL_KEY);
    } catch {}
    setPinnedRuns([]);
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
      window.dispatchEvent(new CustomEvent("ansatz:time-scrub", { detail: { time: null, values: null } }));
      return;
    }
    window.dispatchEvent(new CustomEvent("ansatz:time-scrub", { detail: { time: t, values: getValuesAtTime(t) } }));
  };

  // Publish full Float64Array simulation trajectories so Diagram.tsx & UnifiedGraph can drive
  // 60 FPS lockstep playback across 2D schematics, pinned Canvas2D plots, and embedded 3D CAD rotors.
  useEffect(() => {
    if (typeof window === "undefined" || data.length < 2) return;
    const n = data.length;
    const firstRow = data[0];
    if (!firstRow) return;
    const headers = Object.keys(firstRow);
    const timeKey = headers.find((h) => h.toLowerCase() === "time") ?? headers[0];
    if (!timeKey) return;

    const time = new Float64Array(n);
    const signalKeys = headers.filter((h) => h !== timeKey);
    const signals: Record<string, Float64Array> = {};
    for (const key of signalKeys) {
      signals[key] = new Float64Array(n);
    }

    let validTimeCount = 0;
    for (let i = 0; i < n; i++) {
      const row = data[i];
      if (!row) continue;
      const tv = Number(row[timeKey]);
      if (Number.isFinite(tv)) {
        time[i] = tv;
        validTimeCount++;
      } else {
        time[i] = i;
      }
      for (const key of signalKeys) {
        const arr = signals[key];
        if (!arr) continue;
        const v = Number(row[key]);
        arr[i] = Number.isFinite(v) ? v : 0;
      }
    }
    if (validTimeCount < 2) return;

    window.dispatchEvent(
      new CustomEvent("ansatz:simulation-result", {
        detail: { time, signals },
      }),
    );
  }, [data]);

  useEffect(() => {
    if (!rtpPlaying || data.length < 2) return;
    const stride = Math.max(1, Math.floor(data.length / 120));
    const timer = window.setInterval(() => {
      setRtpIndex((prev) => (prev + stride >= data.length ? 0 : prev + stride));
    }, 50);
    return () => window.clearInterval(timer);
  }, [rtpPlaying, data.length]);

  useEffect(() => {
    if (!rtpPlaying && rtpIndex === 0) return;
    const rowT = Number(data[rtpIndex]?.time);
    if (Number.isFinite(rowT)) {
      setCursorMode(true);
      setCursor1Time(rowT);
      dispatchTimeScrub(rowT);
    }
  }, [rtpIndex, rtpPlaying, data]);

  const handlePlotMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!data.length || rtpPlaying) return;
    const tStart = Number(data[0]!.time);
    const tEnd = Number(data[data.length - 1]!.time);
    if (!Number.isFinite(tStart) || !Number.isFinite(tEnd)) return;

    const gridEl =
      e.currentTarget.querySelector(".recharts-cartesian-grid") ??
      e.currentTarget.querySelector(".recharts-surface") ??
      e.currentTarget.querySelector("canvas") ??
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
    if (!rtpPlaying) dispatchTimeScrub(null);
  };

  const handleChartClick = (e: { activeLabel?: string | number | undefined } | null) => {
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

  const handleExportPsout = () => {
    if (!pscadExports?.psoutBase64) return;
    const bin = atob(pscadExports.psoutBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pscadExports.projectName || "pscad_simulation"}.psout`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportComtrade = () => {
    if (!pscadExports?.comtrade) return;
    const base = pscadExports.projectName || "pscad_simulation";
    for (const [ext, content] of [
      ["cfg", pscadExports.comtrade.cfg],
      ["dat", pscadExports.comtrade.dat],
    ] as const) {
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleExportSnapshot = () => {
    if (!pscadExports?.snapshot) return;
    const blob = new Blob([pscadExports.snapshot], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pscadExports.projectName || "pscad_simulation"}.snp`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportPscadOut = () => {
    if (!pscadExports?.pscadOut) return;
    const base = pscadExports.projectName || "pscad_simulation";
    const files: Array<{ name: string; content: string }> = [
      { name: `${base}.inf`, content: pscadExports.pscadOut.inf },
      ...pscadExports.pscadOut.files.map((f) => ({
        name: f.name.includes(".") ? f.name : `${base}${f.name}`,
        content: f.content,
      })),
    ];
    for (const file of files) {
      const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
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
          <button
            type="button"
            onClick={() => {
              const inp = document.createElement("input");
              inp.type = "file";
              inp.accept = ".snp,.json";
              inp.onchange = async () => {
                const file = inp.files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  (window as unknown as { __ansatzInitialSnapshot?: unknown }).__ansatzInitialSnapshot =
                    JSON.parse(text);
                } catch {
                  (window as unknown as { __ansatzInitialSnapshot?: unknown }).__ansatzInitialSnapshot = undefined;
                }
              };
              inp.click();
            }}
            style={{
              background: "var(--bgColor-muted, var(--ms-bg-elv))",
              color: "var(--fgColor-default, var(--ms-text))",
              border: "1px solid var(--borderColor-default, var(--ms-border))",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Start from Snapshot (.snp)…
          </button>
        </div>
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
        isMultiTrack={isMultiTrack}
        onToggleMultiTrack={setIsMultiTrack}
        isDualY={isDualY}
        onToggleDualY={() => setIsDualY((prev) => !prev)}
        useCanvas={preferCanvas}
        onToggleCanvas={() => setPreferCanvas((prev) => !prev)}
        isComparingBaseline={isComparingBaseline}
        pinnedRunLabels={pinnedRuns.map((r) => r.label)}
        onPinBaseline={handlePinBaseline}
        onRemovePinnedRun={handleRemovePinnedRun}
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
        onExportPsout={pscadExports?.psoutBase64 ? handleExportPsout : undefined}
        onExportPscadOut={pscadExports?.pscadOut ? handleExportPscadOut : undefined}
        onExportComtrade={pscadExports?.comtrade ? handleExportComtrade : undefined}
        onExportSnapshot={pscadExports?.snapshot ? handleExportSnapshot : undefined}
        onCopyClipboard={handleCopyClipboard}
        copied={copied}
      />

      {/* Real-Time Playback (RTP) Waveform Scrubber */}
      {data.length > 2 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "4px 10px",
            borderRadius: "6px",
            border: "1px solid var(--borderColor-muted, var(--ms-border))",
            background: "var(--bgColor-muted, rgba(110,118,129,0.08))",
            fontSize: "11px",
          }}
        >
          <button
            type="button"
            onClick={() => setRtpPlaying((p) => !p)}
            style={{
              padding: "2px 8px",
              borderRadius: "4px",
              border: "1px solid var(--borderColor-default, var(--ms-border))",
              background: rtpPlaying ? "var(--ms-brand-soft)" : "transparent",
              color: rtpPlaying ? "var(--fgColor-accent, var(--ms-brand))" : "inherit",
              fontWeight: 600,
              cursor: "pointer",
            }}
            title="Play or Pause Real-Time Waveform Playback across plots and schematic meters"
          >
            {rtpPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => {
              setRtpPlaying(false);
              const step = Math.max(1, Math.floor(data.length / 60));
              setRtpIndex((prev) => (prev + step >= data.length ? 0 : prev + step));
            }}
            style={{
              padding: "2px 7px",
              borderRadius: "4px",
              border: "1px solid var(--borderColor-default, var(--ms-border))",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
            title="Single-Step forward along trajectory"
          >
            Step
          </button>
          <input
            type="range"
            min={0}
            max={data.length - 1}
            value={Math.min(data.length - 1, rtpIndex)}
            onChange={(e) => {
              setRtpPlaying(false);
              setRtpIndex(Number(e.target.value));
            }}
            aria-label="Real-time playback scrubber"
            style={{ flex: 1, minWidth: "100px" }}
          />
          <span style={{ fontFamily: "monospace", opacity: 0.85, minWidth: "74px", textAlign: "right" }}>
            t = {Number(data[Math.min(data.length - 1, rtpIndex)]?.time ?? 0).toFixed(4)}s
          </span>
        </div>
      )}

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

      {/* IEEE 2800 & PSCAD Instruments Toggles */}
      {(complianceReport || hasIeee2800Channels || allVars.length > 0) && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" }}>
          {allVars.length > 0 && data.length >= 4 && (
            <button
              type="button"
              data-testid="toggle-pscad-instruments-btn"
              onClick={() => setShowInstruments(!showInstruments)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                background: showInstruments ? "var(--ms-brand)" : "var(--bgColor-muted, var(--ms-bg-elv))",
                color: showInstruments ? "#ffffff" : "var(--fgColor-default, var(--ms-text))",
                border: "1px solid var(--borderColor-default, var(--ms-border))",
                cursor: "pointer",
              }}
            >
              📊 Phasor & FFT {showInstruments ? "▲" : "▼"}
            </button>
          )}
          {Boolean(complianceReport) && (
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
                background: showIeee2800 ? "var(--ms-brand)" : "var(--bgColor-muted, var(--ms-bg-elv))",
                color: showIeee2800 ? "#ffffff" : "var(--fgColor-default, var(--ms-text))",
                border: "1px solid var(--borderColor-default, var(--ms-border))",
                cursor: "pointer",
              }}
            >
              🛡️ IEEE 2800 Verification {showIeee2800 ? "▲" : "▼"}
            </button>
          )}
        </div>
      )}

      {showInstruments && data.length >= 4 && (
        <PscadInstrumentsPanel
          data={data}
          variables={allVars}
          colorMode={colorMode}
          nominalFreqHz={pscadExports?.nominalFreqHz}
          onClose={() => setShowInstruments(false)}
        />
      )}

      {complianceReport && showIeee2800 && (
        <Ieee2800VerificationCard
          report={complianceReport}
          data={data}
          colorMode={colorMode}
          onClose={() => setShowIeee2800(false)}
        />
      )}

      {complianceReport && !showIeee2800 && (
        <DslSimulationCardsStrip colorMode={colorMode} result={{ complianceReport, data, variables: allVars }} />
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
      {(() => {
        const handleCanvasCursorUpdate = (cursors: CursorState) => {
          if (cursors.c1 !== undefined) setCursor1Time(cursors.c1);
          if (cursors.c2 !== undefined) setCursor2Time(cursors.c2);
          dispatchTimeScrub(cursors.c2 ?? cursors.c1 ?? null);
        };
        const renderEngineMode = preferCanvas ? "canvas" : "auto";
        const frames = pscadExports?.graphFrames ?? [];
        const matchedFrames = isMultiTrack
          ? frames
              .map((gf) => ({
                gf,
                curves: gf.curves.filter((c) => activeVariables.includes(c)),
              }))
              .filter((entry) => entry.curves.length > 0)
          : [];

        const rightAxisVars =
          !isMultiTrack && isDualY && activeVariables.length > 1
            ? (() => {
                const secondary = activeVariables.filter((v) => /^I_|(_i|_pu|freq|deg|mw|mvar|tap|Pe)$/i.test(v));
                if (secondary.length > 0 && secondary.length < activeVariables.length) return secondary;
                return activeVariables.slice(Math.ceil(activeVariables.length / 2));
              })()
            : undefined;

        const showStacked = isMultiTrack && (matchedFrames.length > 0 || activeVariables.length > 1);

        return (
          <div
            style={{
              height: showStacked ? "auto" : "clamp(360px, 58vh, 680px)",
              maxHeight: showStacked ? "68vh" : undefined,
              overflowY: showStacked ? "auto" : undefined,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: showStacked ? "8px" : undefined,
            }}
            onMouseMove={handlePlotMouseMove}
            onMouseLeave={handlePlotMouseLeave}
          >
            {showStacked ? (
              matchedFrames.length > 0 ? (
                matchedFrames.map(({ gf, curves }, fIdx) => {
                  const frameDomain: [number | "auto", number | "auto"] | undefined =
                    gf.min !== undefined || gf.max !== undefined ? [gf.min ?? "auto", gf.max ?? "auto"] : undefined;
                  const accent = SIMULATION_COLORS[fIdx % SIMULATION_COLORS.length]!;
                  return (
                    <div
                      key={gf.id}
                      data-graphframe-id={gf.id}
                      style={{
                        height: "210px",
                        minHeight: "180px",
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 600, paddingLeft: 8, color: accent }}>
                        {gf.title || gf.id} ({curves.join(", ")})
                      </div>
                      <div style={{ flex: 1, minHeight: 0 }}>
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
                          activeVariables={curves}
                          selectedVariables={selectedVariables || curves}
                          sweepResults={sweepResults}
                          baselineData={baselineData}
                          pinnedRunLabels={pinnedRuns.map((r) => r.label)}
                          colors={SIMULATION_COLORS}
                          yDomainOverride={frameDomain}
                          renderEngine={renderEngineMode}
                          viewport={sharedViewport}
                          onViewportChange={setSharedViewport}
                          onCursorUpdate={handleCanvasCursorUpdate}
                          onChartClick={handleChartClick}
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                activeVariables.slice(0, 12).map((v) => {
                  const colorIdx = (selectedVariables || []).indexOf(v);
                  const trackColor = SIMULATION_COLORS[(colorIdx >= 0 ? colorIdx : 0) % SIMULATION_COLORS.length]!;
                  const matchingFrame = pscadExports?.graphFrames?.find((gf) => gf.curves.includes(v));
                  const trackDomain: [number | "auto", number | "auto"] | undefined =
                    matchingFrame && (matchingFrame.min !== undefined || matchingFrame.max !== undefined)
                      ? [matchingFrame.min ?? "auto", matchingFrame.max ?? "auto"]
                      : undefined;
                  return (
                    <div
                      key={v}
                      style={{
                        height: "200px",
                        minHeight: "170px",
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 600, paddingLeft: 8, color: trackColor }}>{v}</div>
                      <div style={{ flex: 1, minHeight: 0 }}>
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
                          activeVariables={[v]}
                          selectedVariables={[v]}
                          sweepResults={sweepResults}
                          baselineData={baselineData}
                          pinnedRunLabels={pinnedRuns.map((r) => r.label)}
                          colors={[trackColor]}
                          yDomainOverride={trackDomain}
                          renderEngine={renderEngineMode}
                          viewport={sharedViewport}
                          onViewportChange={setSharedViewport}
                          onCursorUpdate={handleCanvasCursorUpdate}
                          onChartClick={handleChartClick}
                        />
                      </div>
                    </div>
                  );
                })
              )
            ) : (
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
                pinnedRunLabels={pinnedRuns.map((r) => r.label)}
                colors={SIMULATION_COLORS}
                yDomainOverride={(() => {
                  const firstFrame = pscadExports?.graphFrames?.[0];
                  return firstFrame && (firstFrame.min !== undefined || firstFrame.max !== undefined)
                    ? [firstFrame.min ?? "auto", firstFrame.max ?? "auto"]
                    : undefined;
                })()}
                renderEngine={renderEngineMode}
                rightAxisVariables={rightAxisVars}
                viewport={sharedViewport}
                onViewportChange={setSharedViewport}
                onCursorUpdate={handleCanvasCursorUpdate}
                onChartClick={handleChartClick}
              />
            )}
          </div>
        );
      })()}

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
