// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, SyncIcon, ZapIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useState } from "react";
import Box from "../../../components/Box";
import { exportWasmModelica, exportWasmParquet } from "../simulation";
import {
  ActionDockBtn,
  ConvergencePlotBox,
  DockTitle,
  ParamSliderRow,
  SimulationDockPane,
  TelemetryCard,
  TelemetryGrid,
} from "../styles";
import type { SimulationPoint, SimulationResult } from "../types";

export interface OscillatorSandboxDockPaneProps {
  simResult: SimulationResult;
  dampingVal: string;
  setDampingVal: (v: string) => void;
  stiffnessVal: string;
  setStiffnessVal: (v: string) => void;
  tolVal: string;
  setTolVal: (v: string) => void;
  isSimulating: boolean;
  onReSimulate: () => void;
}

export const OscillatorSandboxDockPane: React.FC<OscillatorSandboxDockPaneProps> = ({
  simResult,
  dampingVal,
  setDampingVal,
  stiffnessVal,
  setStiffnessVal,
  tolVal,
  setTolVal,
  isSimulating,
  onReSimulate,
}) => {
  const [hoveredPoint, setHoveredPoint] = useState<SimulationPoint | null>(null);

  return (
    <SimulationDockPane style={{ position: "static" }}>
      <DockTitle>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <ZapIcon size={14} style={{ color: "var(--color-accent-cyan)" }} />
          <span>LIVE WASM SIMULATION SANDBOX</span>
        </div>
        <span
          style={{
            fontSize: "11px",
            color: isSimulating ? "var(--color-accent-amber)" : "var(--color-status-verified)",
            background: isSimulating ? "var(--status-warning-bg)" : "var(--status-verified-bg)",
            border: isSimulating ? "1px solid var(--status-warning-border)" : "1px solid var(--status-verified-border)",
            padding: "2px 8px",
            borderRadius: "12px",
            fontWeight: 600,
            transition: "all 0.2s ease",
          }}
        >
          {isSimulating ? "COMPUTING..." : "JIT READY"}
        </span>
      </DockTitle>
      <Text style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "-8px" }}>
        Second-Order Continuous Mass-Spring-Damper ODE Solver (CVODE WASM)
      </Text>

      <ParamSliderRow>
        <div className="label-val">
          <span>Damping (damping_c):</span>
          <span style={{ color: "var(--color-accent-cyan)", fontFamily: "var(--font-mono)" }}>{dampingVal} N·s/m</span>
        </div>
        <input
          type="range"
          min="0.02"
          max="0.80"
          step="0.01"
          value={dampingVal}
          onChange={(e) => setDampingVal(e.target.value)}
        />
      </ParamSliderRow>

      <ParamSliderRow>
        <div className="label-val">
          <span>Spring Stiffness (k):</span>
          <span style={{ color: "var(--color-accent-purple)", fontFamily: "var(--font-mono)" }}>
            {stiffnessVal} N/m
          </span>
        </div>
        <input
          type="range"
          min="16"
          max="144"
          step="4"
          value={stiffnessVal}
          onChange={(e) => setStiffnessVal(e.target.value)}
        />
      </ParamSliderRow>

      <ParamSliderRow>
        <div className="label-val">
          <span>Solver RelTol:</span>
          <span style={{ color: "var(--color-status-verified)", fontFamily: "var(--font-mono)" }}>1e-{tolVal}</span>
        </div>
        <input type="range" min="3" max="9" value={tolVal} onChange={(e) => setTolVal(e.target.value)} />
      </ParamSliderRow>

      <TelemetryGrid>
        <TelemetryCard>
          <span className="label">RATIO (ζ)</span>
          <span className="val">{simResult.stats.zeta.toFixed(3)}</span>
          <span className="sub">{simResult.stats.regime}</span>
        </TelemetryCard>
        <TelemetryCard>
          <span className="label">NATURAL FREQ</span>
          <span className="val">
            {simResult.stats.wn.toFixed(1)} <small>rad/s</small>
          </span>
          <span className="sub">fd = {(simResult.stats.wd / (2 * Math.PI)).toFixed(2)} Hz</span>
        </TelemetryCard>
        <TelemetryCard>
          <span className="label">PEAK OVERSHOOT</span>
          <span className="val">{simResult.stats.overshootPct.toFixed(1)}%</span>
          <span className="sub">Mp max peak</span>
        </TelemetryCard>
        <TelemetryCard>
          <span className="label">SETTLING TIME</span>
          <span className="val">{simResult.stats.settlingTimeSec.toFixed(2)}s</span>
          <span className="sub">±2% envelope</span>
        </TelemetryCard>
      </TelemetryGrid>

      <ConvergencePlotBox
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const mouseX = e.clientX - rect.left - 16;
          const width = rect.width - 32;
          if (width <= 0) return;
          const ratio = Math.max(0, Math.min(1, mouseX / width));
          const t = ratio * 2.4;
          const closest = simResult.points.reduce((prev, curr) =>
            Math.abs(curr.t - t) < Math.abs(prev.t - t) ? curr : prev,
          );
          setHoveredPoint(closest);
        }}
        onPointerLeave={() => setHoveredPoint(null)}
      >
        {/* Tooltip HUD banner */}
        <div
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: hoveredPoint ? "var(--color-accent-cyan)" : "rgba(255, 255, 255, 0.45)",
            marginBottom: "4px",
            background: "rgba(255, 255, 255, 0.05)",
            padding: "4px 8px",
            borderRadius: "6px",
            minHeight: "24px",
            boxSizing: "border-box",
          }}
        >
          {hoveredPoint ? (
            <>
              <span>t: {hoveredPoint.t.toFixed(2)}s</span>
              <span>
                x: {hoveredPoint.x >= 0 ? "+" : ""}
                {hoveredPoint.x.toFixed(3)}m
              </span>
              <span>
                v: {hoveredPoint.v >= 0 ? "+" : ""}
                {hoveredPoint.v.toFixed(2)}m/s
              </span>
              <span>E: {hoveredPoint.energy.toFixed(1)}J</span>
            </>
          ) : (
            <span>Move cursor over plot to scrub state trajectory (x, v, E)</span>
          )}
        </div>

        <svg width="100%" height="140" viewBox="0 0 280 140" style={{ maxWidth: "340px", overflow: "visible" }}>
          {/* Horizontal reference lines */}
          <line x1="15" y1="18" x2="265" y2="18" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />
          <line x1="15" y1="70" x2="265" y2="70" stroke="rgba(255,255,255,0.22)" strokeDasharray="3 3" />
          <line x1="15" y1="122" x2="265" y2="122" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />

          {/* Y-axis labels */}
          <text x="3" y="21" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="var(--font-mono)">
            +1m
          </text>
          <text x="3" y="73" fill="rgba(255,255,255,0.5)" fontSize="8" fontFamily="var(--font-mono)">
            0
          </text>
          <text x="3" y="125" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="var(--font-mono)">
            -1m
          </text>

          {/* Time tick labels */}
          <text x="15" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
            0.0s
          </text>
          <text x="75" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
            0.6s
          </text>
          <text x="135" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
            1.2s
          </text>
          <text x="195" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
            1.8s
          </text>
          <text x="250" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
            2.4s
          </text>

          {/* Trajectory waveform */}
          <path
            d={simResult.svgPath}
            stroke={isSimulating ? "#f59e0b" : "#10b981"}
            strokeWidth="2.5"
            fill="none"
            style={{
              filter: "drop-shadow(0 0 8px rgba(16, 185, 129, 0.6))",
              transition: "stroke 0.2s, stroke-width 0.2s",
            }}
          />

          {/* Interactive cursor line and indicator */}
          {hoveredPoint && (
            <>
              <line
                x1={15 + (hoveredPoint.t / 2.4) * 250}
                y1="10"
                x2={15 + (hoveredPoint.t / 2.4) * 250}
                y2="130"
                stroke="var(--color-accent-cyan)"
                strokeWidth="1.2"
                strokeDasharray="3 2"
              />
              <circle
                cx={15 + (hoveredPoint.t / 2.4) * 250}
                cy={70 - Math.max(-1.1, Math.min(1.1, hoveredPoint.x)) * 52}
                r="4"
                fill="var(--color-accent-cyan)"
                stroke="#ffffff"
                strokeWidth="1.5"
                style={{ filter: "drop-shadow(0 0 6px var(--color-accent-cyan))" }}
              />
            </>
          )}
        </svg>

        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: isSimulating ? "var(--color-accent-amber)" : "var(--color-status-verified)",
            marginTop: "8px",
          }}
        >
          {isSimulating
            ? "⏳ Computing state trajectory in WASM arena..."
            : `● CONVERGED in ${simResult.stats.timeMs}ms (${simResult.stats.iterations} iters, ${simResult.stats.singularities} singularities)`}
        </span>
      </ConvergencePlotBox>

      <Box display="flex" gap={2}>
        <ActionDockBtn $primary style={{ flex: 1.2 }} onClick={onReSimulate} disabled={isSimulating}>
          <SyncIcon className={isSimulating ? "anim-rotate" : ""} />
          Re-simulate
        </ActionDockBtn>
        <ActionDockBtn
          style={{ flex: 1 }}
          onClick={() => exportWasmParquet(simResult, dampingVal, stiffnessVal)}
          title="Download trajectory as Apache Parquet dataset"
        >
          <DownloadIcon />
          Parquet
        </ActionDockBtn>
        <ActionDockBtn
          style={{ flex: 1 }}
          onClick={() => exportWasmModelica(dampingVal, stiffnessVal)}
          title="Download Modelica physical model source"
        >
          <DownloadIcon />
          Modelica
        </ActionDockBtn>
      </Box>
    </SimulationDockPane>
  );
};

export default OscillatorSandboxDockPane;
