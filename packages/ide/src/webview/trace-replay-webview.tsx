// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ReplayTraceData } from "../trace-replay-panel.js";
import { TimeSeriesViewer, type DataSeries } from "./shared/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.();

export function TraceReplayApp() {
  const [trace, setTrace] = useState<ReplayTraceData | null>(null);
  const [isSampleTrace, setIsSampleTrace] = useState<boolean>(false);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [normalized, setNormalized] = useState<boolean>(false);
  const [activeSignal, setActiveSignal] = useState<string | null>(null);

  const playTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Handle messages from the extension host
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg) return;

      switch (msg.type) {
        case "loadTrace":
          setTrace(msg.trace);
          setIsSampleTrace(Boolean(msg.isSampleTrace));
          setCurrentIndex(0);
          setIsPlaying(false);
          break;

        case "diffData":
          setTrace((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              divergenceTime: msg.divergenceTime ?? prev.divergenceTime,
              divergingVariable: msg.divergingVariable ?? prev.divergingVariable,
              nominalSignals: msg.nominalSignals ?? prev.nominalSignals,
            };
          });
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    vscode?.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
      }
    };
  }, []);

  const times = useMemo(() => trace?.times ?? [], [trace]);
  const maxIndex = Math.max(0, times.length - 1);
  const currentTime = times[currentIndex] ?? 0;
  const maxTime = times[times.length - 1] ?? 0;

  // Post token step updates on position change
  const notifyStep = useCallback((idx: number, tr: ReplayTraceData | null) => {
    if (!tr || !tr.times[idx]) return;
    vscode?.postMessage({
      type: "tokenStep",
      time: tr.times[idx],
      values: tr.continuousSignals,
    });
  }, []);

  // Playback timer loop
  useEffect(() => {
    if (isPlaying) {
      playTimerRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev < maxIndex) {
            const next = prev + 1;
            notifyStep(next, trace);
            return next;
          } else {
            setIsPlaying(false);
            return prev;
          }
        });
      }, 60);
    } else {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    }

    return () => {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [isPlaying, maxIndex, trace, notifyStep]);

  const handleSeek = (newIndex: number) => {
    const clamped = Math.max(0, Math.min(newIndex, maxIndex));
    setCurrentIndex(clamped);
    notifyStep(clamped, trace);
  };

  const handleJumpToViolation = () => {
    if (trace && trace.violatingTimeIndex !== undefined) {
      handleSeek(trace.violatingTimeIndex);
    }
  };

  const handleJumpToDivergence = () => {
    if (trace && trace.divergenceTime !== undefined) {
      const idx = times.findIndex((t) => t >= trace.divergenceTime! - 1e-3);
      if (idx >= 0) {
        handleSeek(idx);
      }
    }
  };

  // Convert signals into DataSeries for TimeSeriesViewer
  const seriesList = useMemo<DataSeries[]>(() => {
    if (!trace) return [];
    const list: DataSeries[] = [];
    const contSignals = trace.continuousSignals;
    const nomSignals = trace.nominalSignals;

    const palette = ["#f44336", "#e91e63", "#9c27b0", "#ff5722", "#ff9800"];
    let colorIdx = 0;

    for (const [key, vals] of Object.entries(contSignals)) {
      if (activeSignal && activeSignal !== key) continue;

      const pts = times.map((t, i) => ({ x: t, y: vals[i] ?? 0 }));
      list.push({
        id: `cex_${key}`,
        name: `${key} (cex)`,
        color: palette[colorIdx % palette.length]!,
        points: pts,
      });

      if (nomSignals && nomSignals[key]) {
        const nomPts = times.map((t, i) => ({ x: t, y: nomSignals[key]![i] ?? 0 }));
        list.push({
          id: `nom_${key}`,
          name: `${key} (nom)`,
          color: "#00bcd4",
          points: nomPts,
        });
      }

      colorIdx++;
    }

    return list;
  }, [trace, times, activeSignal]);

  if (!trace) {
    return (
      <div style={{ padding: "32px", textAlign: "center", color: "var(--vscode-editor-foreground, #ccc)" }}>
        <h3>Loading Counterexample Trace Replayer…</h3>
      </div>
    );
  }

  const statusColor =
    trace.status === "FALSIFIED" ? "#f44336" : trace.status === "CERTIFIED_SAFE" ? "#4caf50" : "#ff9800";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        padding: "16px",
        fontFamily: "var(--vscode-font-family, sans-serif)",
        color: "var(--vscode-editor-foreground, #ccc)",
        backgroundColor: "var(--vscode-editor-background, #1e1e1e)",
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingBottom: "12px",
          borderBottom: "1px solid var(--vscode-panel-border, #3c3c3c)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <span style={{ fontSize: "1.25rem", fontWeight: 700 }}>⏱️ Formal Trace & Counterexample Replayer</span>
            <span
              style={{
                fontSize: "0.75rem",
                padding: "2px 8px",
                borderRadius: "10px",
                fontWeight: 600,
                border: `1px solid ${statusColor}`,
                color: statusColor,
                backgroundColor: `${statusColor}22`,
              }}
            >
              {trace.status}
            </span>
            <span
              style={{
                fontSize: "0.75rem",
                padding: "2px 8px",
                borderRadius: "10px",
                backgroundColor: "rgba(255, 255, 255, 0.08)",
                border: "1px solid var(--vscode-panel-border, #3c3c3c)",
              }}
            >
              source: {trace.source}
            </span>
            {isSampleTrace && (
              <span
                style={{
                  fontSize: "0.7rem",
                  padding: "2px 8px",
                  borderRadius: "10px",
                  backgroundColor: "rgba(255, 152, 0, 0.2)",
                  color: "#ff9800",
                  border: "1px solid #ff9800",
                  fontWeight: 600,
                }}
              >
                [DEMO / SYNTHETIC TRACE]
              </span>
            )}
          </div>
          {trace.violatingProperty && (
            <div style={{ fontSize: "0.85rem", color: "#f44336", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>💥 Violating Property:</span>
              <code style={{ background: "rgba(244, 67, 54, 0.15)", padding: "2px 6px", borderRadius: "4px" }}>
                {trace.violatingProperty}
              </code>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => vscode?.postMessage({ type: "openTraceFile" })}
            style={{
              background: "var(--vscode-button-secondaryBackground, #3a3d41)",
              color: "var(--vscode-button-secondaryForeground, #fff)",
              border: "1px solid var(--vscode-panel-border, #3c3c3c)",
              borderRadius: "4px",
              padding: "6px 12px",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            📂 Load Trace
          </button>
          <button
            onClick={() => vscode?.postMessage({ type: "requestDiff" })}
            style={{
              background: "var(--vscode-button-secondaryBackground, #3a3d41)",
              color: "var(--vscode-button-secondaryForeground, #fff)",
              border: "1px solid var(--vscode-panel-border, #3c3c3c)",
              borderRadius: "4px",
              padding: "6px 12px",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            🔍 Diff Nominal
          </button>
          <button
            onClick={() => vscode?.postMessage({ type: "exportVcd" })}
            style={{
              background: "var(--vscode-button-secondaryBackground, #3a3d41)",
              color: "var(--vscode-button-secondaryForeground, #fff)",
              border: "1px solid var(--vscode-panel-border, #3c3c3c)",
              borderRadius: "4px",
              padding: "6px 12px",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            💾 Export VCD
          </button>
          <button
            onClick={() => vscode?.postMessage({ type: "exportCsv" })}
            style={{
              background: "var(--vscode-button-background, #0e639c)",
              color: "var(--vscode-button-foreground, #fff)",
              border: "none",
              borderRadius: "4px",
              padding: "6px 12px",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            📊 Export CSV
          </button>
        </div>
      </header>

      {/* Divergence Alert Banner */}
      {trace.divergenceTime !== undefined && (
        <div
          style={{
            background: "rgba(255, 152, 0, 0.12)",
            border: "1px solid #ff9800",
            borderRadius: "6px",
            padding: "10px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <strong>⚠️ Divergence Detected:</strong> Signal{" "}
            <code style={{ background: "rgba(255, 152, 0, 0.2)", padding: "2px 6px", borderRadius: "4px" }}>
              {trace.divergingVariable || "state"}
            </code>{" "}
            diverged from nominal trajectory at{" "}
            <strong style={{ color: "#ff9800" }}>t = {trace.divergenceTime.toFixed(2)}s</strong>.
          </div>
          <button
            onClick={handleJumpToDivergence}
            style={{
              background: "var(--vscode-button-secondaryBackground, #3a3d41)",
              color: "var(--vscode-button-secondaryForeground, #fff)",
              border: "1px solid #ff9800",
              borderRadius: "4px",
              padding: "4px 10px",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            🎯 Jump to Divergence
          </button>
        </div>
      )}

      {/* Scrubber Controls Bar */}
      <div
        style={{
          background: "var(--vscode-sideBar-background, #252526)",
          border: "1px solid var(--vscode-panel-border, #3c3c3c)",
          borderRadius: "8px",
          padding: "14px 18px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              style={{
                background: isPlaying ? "#f44336" : "var(--vscode-button-background, #0e639c)",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                padding: "6px 14px",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {isPlaying ? "⏸ Pause" : "▶ Play"}
            </button>
            <button
              onClick={() => handleSeek(currentIndex - 1)}
              disabled={currentIndex <= 0}
              style={{
                background: "var(--vscode-button-secondaryBackground, #3a3d41)",
                color: "var(--vscode-button-secondaryForeground, #fff)",
                border: "1px solid var(--vscode-panel-border, #3c3c3c)",
                borderRadius: "4px",
                padding: "6px 10px",
                fontSize: "0.85rem",
                cursor: currentIndex <= 0 ? "not-allowed" : "pointer",
                opacity: currentIndex <= 0 ? 0.5 : 1,
              }}
            >
              ⏪ Step Back
            </button>
            <button
              onClick={() => handleSeek(currentIndex + 1)}
              disabled={currentIndex >= maxIndex}
              style={{
                background: "var(--vscode-button-secondaryBackground, #3a3d41)",
                color: "var(--vscode-button-secondaryForeground, #fff)",
                border: "1px solid var(--vscode-panel-border, #3c3c3c)",
                borderRadius: "4px",
                padding: "6px 10px",
                fontSize: "0.85rem",
                cursor: currentIndex >= maxIndex ? "not-allowed" : "pointer",
                opacity: currentIndex >= maxIndex ? 0.5 : 1,
              }}
            >
              ⏩ Step Forward
            </button>
            <button
              onClick={() => handleSeek(0)}
              style={{
                background: "var(--vscode-button-secondaryBackground, #3a3d41)",
                color: "var(--vscode-button-secondaryForeground, #fff)",
                border: "1px solid var(--vscode-panel-border, #3c3c3c)",
                borderRadius: "4px",
                padding: "6px 10px",
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              ⏹ Reset
            </button>
            {trace.violatingTimeIndex !== undefined && (
              <button
                onClick={handleJumpToViolation}
                style={{
                  background: "rgba(244, 67, 54, 0.15)",
                  color: "#f44336",
                  border: "1px solid #f44336",
                  borderRadius: "4px",
                  padding: "6px 12px",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                💥 Jump to Violation
              </button>
            )}
          </div>

          <div style={{ fontSize: "1.1rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            t = <span style={{ color: "#00bcd4" }}>{currentTime.toFixed(2)}s</span> / {maxTime.toFixed(2)}s{" "}
            <span style={{ fontSize: "0.85rem", opacity: 0.7, marginLeft: "8px" }}>
              (Step {currentIndex + 1} of {times.length})
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%" }}>
          <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>0.00s</span>
          <input
            type="range"
            min={0}
            max={maxIndex}
            value={currentIndex}
            onChange={(e) => handleSeek(parseInt(e.target.value, 10))}
            style={{
              flex: 1,
              height: "6px",
              cursor: "pointer",
              accentColor: "var(--vscode-button-background, #0e639c)",
            }}
          />
          <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>{maxTime.toFixed(2)}s</span>
        </div>
      </div>

      {/* Trajectory Plot Container Dogfooding TimeSeriesViewer */}
      <div
        style={{
          background: "var(--vscode-sideBar-background, #252526)",
          border: "1px solid var(--vscode-panel-border, #3c3c3c)",
          borderRadius: "8px",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontWeight: 600 }}>📈 State Trajectories (Nominal vs Counterexample)</span>
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                onClick={() => setActiveSignal(null)}
                style={{
                  fontSize: "0.75rem",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  border: "none",
                  cursor: "pointer",
                  background:
                    activeSignal === null ? "var(--vscode-button-background, #0e639c)" : "rgba(255,255,255,0.08)",
                  color: "#fff",
                }}
              >
                All Signals
              </button>
              {Object.keys(trace.continuousSignals).map((sig) => (
                <button
                  key={sig}
                  onClick={() => setActiveSignal(activeSignal === sig ? null : sig)}
                  style={{
                    fontSize: "0.75rem",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    border: "none",
                    cursor: "pointer",
                    background:
                      activeSignal === sig ? "var(--vscode-button-background, #0e639c)" : "rgba(255,255,255,0.08)",
                    color: "#fff",
                  }}
                >
                  {sig}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <label style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
              <input type="checkbox" checked={normalized} onChange={(e) => setNormalized(e.target.checked)} />
              Normalize Scales (0-100%)
            </label>
          </div>
        </div>

        {/* TimeSeriesViewer dogfood component */}
        <div style={{ width: "100%", height: "420px" }}>
          <TimeSeriesViewer
            series={seriesList}
            dark={true}
            showCursors={true}
            normalized={normalized}
            xAxisLabel="Time (s)"
            yAxisLabel={activeSignal ?? "Signal Amplitude"}
            style={{ width: "100%", height: "100%" }}
            onExportCsv={() => vscode?.postMessage({ type: "exportCsv" })}
          />
        </div>
      </div>

      {/* Live Readouts at Current Time Index */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>
          📊 Live Signal Values (at t = {currentTime.toFixed(2)}s)
        </span>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "12px",
          }}
        >
          {/* Continuous Signals */}
          {Object.entries(trace.continuousSignals).map(([sigKey, vals]) => {
            const curVal = vals[currentIndex] ?? 0;
            const nomVal = trace.nominalSignals?.[sigKey]?.[currentIndex];
            const hasDiverged = nomVal !== undefined && Math.abs(curVal - nomVal) > 0.5;

            return (
              <div
                key={sigKey}
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: `1px solid ${hasDiverged ? "#f44336" : "var(--vscode-panel-border, #3c3c3c)"}`,
                  borderRadius: "6px",
                  padding: "10px 14px",
                }}
              >
                <div style={{ fontSize: "0.8rem", opacity: 0.7, textTransform: "uppercase" }}>{sigKey}</div>
                <div
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    marginTop: "4px",
                    color: hasDiverged ? "#f44336" : "inherit",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {curVal.toFixed(2)}
                  {nomVal !== undefined && (
                    <span style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "6px", color: "#00bcd4" }}>
                      (nom: {nomVal.toFixed(2)})
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Discrete Mode Signals */}
          {trace.discreteSignals &&
            Object.entries(trace.discreteSignals).map(([discKey, discVals]) => {
              const curMode = discVals[currentIndex];
              return (
                <div
                  key={discKey}
                  style={{
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid var(--vscode-panel-border, #3c3c3c)",
                    borderRadius: "6px",
                    padding: "10px 14px",
                  }}
                >
                  <div style={{ fontSize: "0.8rem", opacity: 0.7, textTransform: "uppercase" }}>
                    {discKey} [discrete state]
                  </div>
                  <div
                    style={{
                      fontSize: "1.1rem",
                      fontWeight: 700,
                      marginTop: "4px",
                      color: "#00bcd4",
                    }}
                  >
                    {String(curMode)}
                  </div>
                </div>
              );
            })}

          {/* Static Parameters */}
          {trace.parameters &&
            Object.entries(trace.parameters).map(([pName, pVal]) => (
              <div
                key={pName}
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--vscode-panel-border, #3c3c3c)",
                  borderRadius: "6px",
                  padding: "10px 14px",
                }}
              >
                <div style={{ fontSize: "0.8rem", opacity: 0.7, textTransform: "uppercase" }}>Param: {pName}</div>
                <div style={{ fontSize: "1.1rem", fontWeight: 600, marginTop: "4px", color: "#ff9800" }}>{pVal}</div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<TraceReplayApp />);
}
