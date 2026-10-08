// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner } from "@primer/react";
import Papa from "papaparse";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getSimulationJobResult } from "../../api";

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
  colorMode = "light",
}: SimulationResultsProps) {
  const [data, setData] = useState<Record<string, number | string>[]>(localData || []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(externalError || null);
  const [isNormalized, setIsNormalized] = useState(false);
  const [xAxisVar, setXAxisVar] = useState<string>("time");
  const [hiddenVars, setHiddenVars] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

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

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={handleExportCsv}
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "4px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-btn-bg, #f6f8fa)",
                color: "inherit",
                cursor: "pointer",
              }}
              title="Download simulated data as CSV"
            >
              📥 CSV
            </button>
            <button
              onClick={handleCopyClipboard}
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "4px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-btn-bg, #f6f8fa)",
                color: "inherit",
                cursor: "pointer",
              }}
              title="Copy tab-delimited simulation data to clipboard"
            >
              {copied ? "✓ Copied!" : "📋 Copy"}
            </button>
          </div>
        </div>
      </div>

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
              data={chartData}
              margin={{
                top: 10,
                right: 30,
                left: 20,
                bottom: 35,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey={xAxisVar}
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(val) => (typeof val === "number" ? val.toFixed(2) : String(val))}
                label={{
                  value: xAxisVar === "time" ? "time (s)" : xAxisVar,
                  position: "insideBottom",
                  offset: -20,
                }}
              />
              <YAxis
                domain={isNormalized ? [0, 100] : ["auto", "auto"]}
                tickFormatter={(val) => (isNormalized ? `${val}%` : Number(val).toFixed(2))}
                label={
                  isNormalized
                    ? { value: "Normalized (0–100%)", angle: -90, position: "insideLeft", offset: -5 }
                    : undefined
                }
              />
              <Tooltip
                formatter={(val, name) => {
                  const varName = String(name);
                  if (isNormalized) {
                    const rawVal = minMaxMap[varName]
                      ? (
                          (Number(val) / 100) * (minMaxMap[varName].max - minMaxMap[varName].min) +
                          minMaxMap[varName].min
                        ).toFixed(4)
                      : val;
                    return [`${rawVal} (${Number(val).toFixed(1)}%)`, varName];
                  }
                  return [typeof val === "number" ? val.toFixed(4) : val, varName];
                }}
                labelFormatter={(val) => {
                  const num = typeof val === "number" ? val : Number(val);
                  return `${xAxisVar}: ${isNaN(num) ? val : num.toFixed(4)}${xAxisVar === "time" ? "s" : ""}`;
                }}
              />
              {activeVariables.flatMap((v, i) => {
                if (sweepResults && sweepResults.length > 0) {
                  return sweepResults.map((sweep, j) => {
                    const key = `${v} (${sweep.value})`;
                    const colorIdx = (i * sweepResults.length + j) % SIMULATION_COLORS.length;
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
                return (
                  <Line
                    key={v}
                    type="linear"
                    dataKey={v}
                    stroke={SIMULATION_COLORS[selectedVariables.indexOf(v) % SIMULATION_COLORS.length]}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
