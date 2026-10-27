// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WasmFmuRunner } from "@modelscript/exchange";
import { useState } from "react";
import type { BlackboxVariable } from "./BlackboxInspector.js";

export interface TrajectoryPoint {
  time: number;
  values: Record<string, number>;
}

export interface StepResponseTestbenchProps {
  modelName: string;
  inputs: BlackboxVariable[];
  outputs: BlackboxVariable[];
  wasmRunner?: WasmFmuRunner | undefined;
  onStep?: (currentTime: number, stepSize: number, inputs: Record<string, number>) => Promise<Record<string, number>>;
  className?: string;
}

export function StepResponseTestbench({
  modelName,
  inputs,
  outputs,
  wasmRunner,
  onStep,
  className,
}: StepResponseTestbenchProps) {
  const [currentTime, setCurrentTime] = useState(0.0);
  const [stepSize, setStepSize] = useState(0.01);
  const [isRunning, setIsRunning] = useState(false);

  // Input states
  const [inputValues, setInputValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const inp of inputs) {
      init[inp.name] = typeof inp.start === "number" ? inp.start : 0.0;
    }
    return init;
  });

  // Recorded trajectory history
  const [trajectory, setTrajectory] = useState<TrajectoryPoint[]>([
    {
      time: 0.0,
      values: outputs.reduce(
        (acc, out) => {
          acc[out.name] = typeof out.start === "number" ? out.start : 0.0;
          return acc;
        },
        {} as Record<string, number>,
      ),
    },
  ]);

  const handleInputChange = (name: string, val: number) => {
    setInputValues((prev) => ({ ...prev, [name]: val }));
  };

  const executeSingleStep = async (dt = stepSize) => {
    const nextTime = currentTime + dt;
    let nextOutputs: Record<string, number> = {};

    if (onStep) {
      try {
        nextOutputs = await onStep(currentTime, dt, inputValues);
      } catch (err) {
        console.error("Step execution failed:", err);
      }
    } else if (wasmRunner) {
      try {
        nextOutputs = wasmRunner.step(currentTime, dt, inputValues);
      } catch (err) {
        console.error("WASM Runner step execution failed:", err);
      }
    } else {
      // Analytical mock response for visual testbench
      for (const out of outputs) {
        const lastVal = trajectory[trajectory.length - 1]?.values[out.name] ?? 0.0;
        const drive = Object.values(inputValues)[0] ?? 1.0;
        const alpha = Math.min(1.0, dt / 0.1);
        nextOutputs[out.name] = lastVal + alpha * (drive - lastVal);
      }
    }

    setCurrentTime(nextTime);
    setTrajectory((prev) => [...prev.slice(-300), { time: nextTime, values: nextOutputs }]);
  };

  const handleRun1Sec = async () => {
    setIsRunning(true);
    let t = currentTime;
    const dt = stepSize;
    const target = t + 1.0;

    while (t < target) {
      await executeSingleStep(dt);
      t += dt;
      // Allow render frame
      await new Promise((r) => setTimeout(r, 10));
    }
    setIsRunning(false);
  };

  const handleReset = () => {
    setCurrentTime(0.0);
    setTrajectory([
      {
        time: 0.0,
        values: outputs.reduce(
          (acc, out) => {
            acc[out.name] = typeof out.start === "number" ? out.start : 0.0;
            return acc;
          },
          {} as Record<string, number>,
        ),
      },
    ]);
  };

  // Trajectory SVG Dimensions
  const svgWidth = 600;
  const svgHeight = 220;
  const padL = 45;
  const padR = 20;
  const padT = 20;
  const padB = 30;

  const tMin = trajectory[0]?.time ?? 0.0;
  const tMax = Math.max(tMin + 0.1, trajectory[trajectory.length - 1]?.time ?? 1.0);

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const pt of trajectory) {
    for (const v of Object.values(pt.values)) {
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = -1.0;
    yMax = 1.0;
  }
  if (Math.abs(yMax - yMin) < 1e-4) {
    yMax += 1.0;
    yMin -= 1.0;
  }

  const mapX = (t: number) => padL + ((t - tMin) / (tMax - tMin)) * (svgWidth - padL - padR);
  const mapY = (y: number) => padT + (1 - (y - yMin) / (yMax - yMin)) * (svgHeight - padT - padB);

  const colors = ["#38bdf8", "#34d399", "#f472b6", "#fbbf24", "#a78bfa"];

  return (
    <div
      className={className}
      style={{
        borderRadius: "10px",
        border: "1px solid var(--color-border-default, #334155)",
        backgroundColor: "var(--color-canvas-default, #0f172a)",
        color: "var(--color-fg-default, #f8fafc)",
        overflow: "hidden",
        padding: "20px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Title & Control Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div>
          <div style={{ fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
            <span>⚡ Step Response Testbench</span>
            <span style={{ fontSize: "12px", color: "#94a3b8", fontWeight: 400 }}>({modelName})</span>
          </div>
          <div style={{ fontSize: "12px", color: "#64748b" }}>
            Simulate isolated black-box behavior with real-time stimulus stepping.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ fontSize: "12px", fontFamily: "monospace", color: "#38bdf8" }}>
            t = {currentTime.toFixed(4)} s
          </div>
          <button
            onClick={() => executeSingleStep()}
            disabled={isRunning}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid #3b82f6",
              backgroundColor: "rgba(59, 130, 246, 0.2)",
              color: "#93c5fd",
              fontWeight: 600,
              fontSize: "12px",
              cursor: isRunning ? "not-allowed" : "pointer",
            }}
          >
            Step ({stepSize}s)
          </button>
          <button
            onClick={handleRun1Sec}
            disabled={isRunning}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              border: "none",
              backgroundColor: "#2563eb",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: "12px",
              cursor: isRunning ? "not-allowed" : "pointer",
            }}
          >
            {isRunning ? "Running..." : "Run 1.0s"}
          </button>
          <button
            onClick={handleReset}
            disabled={isRunning}
            style={{
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid #475569",
              backgroundColor: "transparent",
              color: "#94a3b8",
              fontSize: "12px",
              cursor: isRunning ? "not-allowed" : "pointer",
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "20px", alignItems: "start" }}>
        {/* Waveform Chart */}
        <div
          style={{
            backgroundColor: "#070d1e",
            borderRadius: "8px",
            border: "1px solid #1e293b",
            padding: "12px",
          }}
        >
          <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: "100%", height: "auto", display: "block" }}>
            {/* Grid Lines */}
            <line x1={padL} y1={padT} x2={padL} y2={svgHeight - padB} stroke="#1e293b" strokeWidth="1" />
            <line
              x1={padL}
              y1={svgHeight - padB}
              x2={svgWidth - padR}
              y2={svgHeight - padB}
              stroke="#1e293b"
              strokeWidth="1"
            />

            {/* Y axis ticks */}
            <text x={padL - 6} y={padT + 8} fill="#64748b" fontSize="9" textAnchor="end">
              {yMax.toFixed(2)}
            </text>
            <text x={padL - 6} y={svgHeight - padB} fill="#64748b" fontSize="9" textAnchor="end">
              {yMin.toFixed(2)}
            </text>

            {/* X axis ticks */}
            <text x={padL} y={svgHeight - padB + 14} fill="#64748b" fontSize="9" textAnchor="start">
              {tMin.toFixed(2)}s
            </text>
            <text x={svgWidth - padR} y={svgHeight - padB + 14} fill="#64748b" fontSize="9" textAnchor="end">
              {tMax.toFixed(2)}s
            </text>

            {/* Output curves */}
            {outputs.slice(0, 5).map((out, idx) => {
              const color = colors[idx % colors.length] ?? "#8b5cf6";
              const pts = trajectory
                .map((p) => {
                  const val = p.values[out.name] ?? 0.0;
                  return `${mapX(p.time).toFixed(1)},${mapY(val).toFixed(1)}`;
                })
                .join(" ");

              return (
                <polyline
                  key={out.name}
                  points={pts}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              );
            })}
          </svg>

          {/* Trace Legend */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "8px", fontSize: "11px" }}>
            {outputs.slice(0, 5).map((out, idx) => (
              <div key={out.name} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "2px",
                    backgroundColor: colors[idx % colors.length],
                  }}
                />
                <span style={{ color: "#cbd5e1" }}>{out.name}</span>
                <span style={{ color: "#64748b", fontFamily: "monospace" }}>
                  ({(trajectory[trajectory.length - 1]?.values[out.name] ?? 0).toFixed(3)})
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Input Stimulus Sliders */}
        <div
          style={{
            backgroundColor: "#0b132b",
            borderRadius: "8px",
            border: "1px solid #1e293b",
            padding: "16px",
          }}
        >
          <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "12px", color: "#e2e8f0" }}>
            Input Stimuli ({inputs.length})
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px", maxHeight: "240px", overflowY: "auto" }}>
            {inputs.length > 0 ? (
              inputs.map((inp) => {
                const currentVal = inputValues[inp.name] ?? 0.0;
                return (
                  <div key={inp.name}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "11px",
                        marginBottom: "4px",
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "#93c5fd" }}>{inp.name}</span>
                      <span style={{ fontFamily: "monospace", color: "#38bdf8" }}>{currentVal.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={-10.0}
                      max={10.0}
                      step={0.1}
                      value={currentVal}
                      onChange={(e) => handleInputChange(inp.name, parseFloat(e.target.value))}
                      style={{ width: "100%", accentColor: "#3b82f6", cursor: "pointer" }}
                    />
                  </div>
                );
              })
            ) : (
              <div style={{ fontSize: "12px", color: "#64748b", fontStyle: "italic" }}>
                Autonomous model (no scalar inputs).
              </div>
            )}
          </div>

          <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #1e293b" }}>
            <label style={{ fontSize: "11px", color: "#94a3b8", display: "block", marginBottom: "4px" }}>
              Communication Step Size ($\Delta t$):
            </label>
            <input
              type="number"
              value={stepSize}
              step={0.001}
              min={0.0001}
              onChange={(e) => setStepSize(Math.max(0.0001, parseFloat(e.target.value) || 0.01))}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: "4px",
                border: "1px solid #334155",
                backgroundColor: "#070d1e",
                color: "#f8fafc",
                fontSize: "12px",
                fontFamily: "monospace",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
