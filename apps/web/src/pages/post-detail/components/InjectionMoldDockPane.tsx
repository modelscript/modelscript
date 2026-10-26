// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, SyncIcon, ZapIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useState } from "react";
import Box from "../../../components/Box";
import { exportMoldModelica, exportMoldParquet } from "../simulation";
import {
  ActionDockBtn,
  ConvergencePlotBox,
  DockTitle,
  ParamSliderRow,
  SimulationDockPane,
  TelemetryCard,
  TelemetryGrid,
} from "../styles";
import type { MoldSimulationPoint, MoldSimulationResult } from "../types";

export interface InjectionMoldDockPaneProps {
  moldSimResult: MoldSimulationResult;
  meltTempVal: string;
  setMeltTempVal: (v: string) => void;
  injPressureVal: string;
  setInjPressureVal: (v: string) => void;
  gateVelVal: string;
  setGateVelVal: (v: string) => void;
  isSimulating: boolean;
  onReSimulate: () => void;
}

export const InjectionMoldDockPane: React.FC<InjectionMoldDockPaneProps> = ({
  moldSimResult,
  meltTempVal,
  setMeltTempVal,
  injPressureVal,
  setInjPressureVal,
  gateVelVal,
  setGateVelVal,
  isSimulating,
  onReSimulate,
}) => {
  const [hoveredMoldPoint, setHoveredMoldPoint] = useState<MoldSimulationPoint | null>(null);

  return (
    <SimulationDockPane style={{ position: "static" }}>
      <DockTitle>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <ZapIcon size={14} style={{ color: "var(--color-accent-cyan)" }} />
          <span>LIVE INJECTION MOLDING CO-SIMULATION</span>
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
        ABS Polymer Cavity Fill &amp; Solidification Dynamics (OpenFOAM / WASM DAE)
      </Text>

      <ParamSliderRow>
        <div className="label-val">
          <span>Melt Temp (T_melt):</span>
          <span style={{ color: "var(--color-accent-cyan)", fontFamily: "var(--font-mono)" }}>{meltTempVal} °C</span>
        </div>
        <input
          type="range"
          min="200"
          max="270"
          step="1"
          value={meltTempVal}
          onChange={(e) => setMeltTempVal(e.target.value)}
        />
      </ParamSliderRow>

      <ParamSliderRow>
        <div className="label-val">
          <span>Injection Pressure (P_inj):</span>
          <span style={{ color: "var(--color-accent-purple)", fontFamily: "var(--font-mono)" }}>
            {injPressureVal} MPa
          </span>
        </div>
        <input
          type="range"
          min="40"
          max="140"
          step="2"
          value={injPressureVal}
          onChange={(e) => setInjPressureVal(e.target.value)}
        />
      </ParamSliderRow>

      <ParamSliderRow>
        <div className="label-val">
          <span>Gate Inlet Speed (v_inlet):</span>
          <span style={{ color: "var(--color-status-verified)", fontFamily: "var(--font-mono)" }}>
            {gateVelVal} m/s
          </span>
        </div>
        <input
          type="range"
          min="0.20"
          max="1.50"
          step="0.05"
          value={gateVelVal}
          onChange={(e) => setGateVelVal(e.target.value)}
        />
      </ParamSliderRow>

      <TelemetryGrid>
        <TelemetryCard>
          <span className="label">CAVITY FILL TIME</span>
          <span className="val">
            {moldSimResult.stats.fillTimeMs} <small>ms</small>
          </span>
          <span className="sub">Target &lt; 250ms (Cavity 100%)</span>
        </TelemetryCard>
        <TelemetryCard>
          <span className="label">MELT VISCOSITY (η)</span>
          <span className="val">
            {moldSimResult.stats.apparentViscosity} <small>Pa·s</small>
          </span>
          <span className="sub">Cross-WLF Non-Newtonian</span>
        </TelemetryCard>
        <TelemetryCard>
          <span className="label">PEAK CLAMP FORCE</span>
          <span className="val">
            {moldSimResult.stats.clampForceKn} <small>kN</small>
          </span>
          <span className="sub">150×100mm cavity area</span>
        </TelemetryCard>
        <TelemetryCard>
          <span className="label">COOLING RATE</span>
          <span className="val">
            {moldSimResult.stats.coolingRate} <small>°C/s</small>
          </span>
          <span className="sub">Melt front heat flux</span>
        </TelemetryCard>
      </TelemetryGrid>

      <ConvergencePlotBox
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const mouseX = e.clientX - rect.left - 16;
          const width = rect.width - 32;
          if (width <= 0) return;
          const ratio = Math.max(0, Math.min(1, mouseX / width));
          const t = ratio * 0.6;
          const closest = moldSimResult.points.reduce((prev, curr) =>
            Math.abs(curr.t - t) < Math.abs(prev.t - t) ? curr : prev,
          );
          setHoveredMoldPoint(closest);
        }}
        onPointerLeave={() => setHoveredMoldPoint(null)}
      >
        <div
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: hoveredMoldPoint ? "var(--color-accent-cyan)" : "rgba(255, 255, 255, 0.45)",
            marginBottom: "4px",
            background: "rgba(255, 255, 255, 0.05)",
            padding: "4px 8px",
            borderRadius: "6px",
            minHeight: "24px",
            boxSizing: "border-box",
          }}
        >
          {hoveredMoldPoint ? (
            <>
              <span>t: {(hoveredMoldPoint.t * 1000).toFixed(0)}ms</span>
              <span style={{ color: "#10b981" }}>Fill α: {(hoveredMoldPoint.alpha * 100).toFixed(1)}%</span>
              <span style={{ color: "var(--color-accent-cyan)" }}>P: {hoveredMoldPoint.pressure.toFixed(1)} MPa</span>
              <span>x: {hoveredMoldPoint.frontX.toFixed(1)}mm</span>
              <span>T: {hoveredMoldPoint.temp.toFixed(1)}°C</span>
            </>
          ) : (
            <span>Move cursor over plot to scrub melt front (α, Pressure, Front x, Temp)</span>
          )}
        </div>

        <svg width="100%" height="140" viewBox="0 0 280 140" style={{ maxWidth: "340px", overflow: "visible" }}>
          <line x1="15" y1="22" x2="265" y2="22" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />
          <line x1="15" y1="71" x2="265" y2="71" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />
          <line x1="15" y1="120" x2="265" y2="120" stroke="rgba(255,255,255,0.22)" strokeDasharray="3 3" />

          <text x="3" y="25" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="var(--font-mono)">
            100%
          </text>
          <text x="3" y="74" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="var(--font-mono)">
            50%
          </text>
          <text x="3" y="123" fill="rgba(255,255,255,0.5)" fontSize="8" fontFamily="var(--font-mono)">
            0%
          </text>

          <text x="268" y="25" fill="#06b6d4" fontSize="8" fontFamily="var(--font-mono)">
            {injPressureVal}M
          </text>
          <text x="268" y="74" fill="rgba(6,182,212,0.6)" fontSize="8" fontFamily="var(--font-mono)">
            {(parseFloat(injPressureVal) / 2).toFixed(0)}M
          </text>

          <text x="15" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
            0ms
          </text>
          <text x="75" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
            150ms
          </text>
          <text x="135" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
            300ms
          </text>
          <text x="195" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
            450ms
          </text>
          <text x="245" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
            600ms
          </text>

          {moldSimResult.fillTimeSec <= 0.6 && (
            <>
              <line
                x1={15 + (moldSimResult.fillTimeSec / 0.6) * 250}
                y1="16"
                x2={15 + (moldSimResult.fillTimeSec / 0.6) * 250}
                y2="120"
                stroke="#10b981"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.8"
              />
              <text
                x={Math.min(185, 15 + (moldSimResult.fillTimeSec / 0.6) * 250 + 4)}
                y="32"
                fill="#10b981"
                fontSize="8"
                fontFamily="var(--font-mono)"
                fontWeight="bold"
              >
                t_fill: {moldSimResult.stats.fillTimeMs}ms
              </text>
            </>
          )}

          <path
            d={moldSimResult.svgPathPressure}
            stroke="#06b6d4"
            strokeWidth="1.8"
            strokeDasharray="4 2"
            fill="none"
            opacity="0.85"
          />

          <path
            d={moldSimResult.svgPathAlpha}
            stroke={isSimulating ? "#f59e0b" : "#10b981"}
            strokeWidth="2.5"
            fill="none"
            style={{
              filter: "drop-shadow(0 0 6px rgba(16, 185, 129, 0.7))",
              transition: "stroke 0.2s, stroke-width 0.2s",
            }}
          />

          <g transform="translate(14, 8)">
            <line x1="0" y1="3" x2="12" y2="3" stroke="#10b981" strokeWidth="2" />
            <text x="16" y="6" fill="#10b981" fontSize="8" fontFamily="var(--font-mono)">
              Fill α(t)
            </text>
            <line x1="68" y1="3" x2="80" y2="3" stroke="#06b6d4" strokeWidth="1.5" strokeDasharray="3 2" />
            <text x="84" y="6" fill="#06b6d4" fontSize="8" fontFamily="var(--font-mono)">
              Pressure P(t)
            </text>
          </g>

          {hoveredMoldPoint && (
            <>
              <line
                x1={15 + (hoveredMoldPoint.t / 0.6) * 250}
                y1="15"
                x2={15 + (hoveredMoldPoint.t / 0.6) * 250}
                y2="120"
                stroke="var(--color-accent-cyan)"
                strokeWidth="1.2"
                strokeDasharray="3 2"
              />
              <circle
                cx={15 + (hoveredMoldPoint.t / 0.6) * 250}
                cy={120 - hoveredMoldPoint.alpha * 98}
                r="4"
                fill="#10b981"
                stroke="#ffffff"
                strokeWidth="1.5"
                style={{ filter: "drop-shadow(0 0 6px #10b981)" }}
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
            ? "⏳ Computing cavity melt front in WASM arena..."
            : `● CONVERGED in ${moldSimResult.stats.timeMs}ms (OpenFOAM VOF / WASM DAE, 0 singularities, 120 steps)`}
        </span>
      </ConvergencePlotBox>

      <Box display="flex" gap={2}>
        <ActionDockBtn $primary style={{ flex: 1.2 }} onClick={onReSimulate} disabled={isSimulating}>
          <SyncIcon className={isSimulating ? "anim-rotate" : ""} />
          Re-simulate
        </ActionDockBtn>
        <ActionDockBtn
          style={{ flex: 1 }}
          onClick={() => exportMoldParquet(moldSimResult, meltTempVal, injPressureVal)}
          title="Download trajectory as Apache Parquet dataset"
        >
          <DownloadIcon />
          Parquet
        </ActionDockBtn>
        <ActionDockBtn
          style={{ flex: 1 }}
          onClick={() => exportMoldModelica(meltTempVal, injPressureVal, gateVelVal)}
          title="Download Modelica physical model source"
        >
          <DownloadIcon />
          Modelica
        </ActionDockBtn>
      </Box>
    </SimulationDockPane>
  );
};

export default InjectionMoldDockPane;
