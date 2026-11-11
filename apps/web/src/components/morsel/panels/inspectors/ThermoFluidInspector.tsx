// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable react-refresh/only-export-components */

import React, { useMemo, useState } from "react";

export interface ThermoFluidInspectorProps {
  code: string;
  lines: string[];
  colorMode: "dark" | "light";
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

export interface FluidNode {
  id: string;
  kind: "junction" | "reservoir" | "tank" | "outfall" | "well";
  elevationM: number;
  demandLps: number;
  headM: number;
  line: number;
}

export interface FluidConduit {
  id: string;
  from: string;
  to: string;
  lengthM: number;
  diameterM: number;
  roughness: number;
  velocityMs: number;
  reynolds: number;
  regime: "Laminar" | "Transitional" | "Turbulent";
  headLossM: number;
  hglStartM: number;
  hglEndM: number;
  line: number;
}

export interface ThermoFluidSummary {
  nodes: FluidNode[];
  conduits: FluidConduit[];
  totalLengthM: number;
  totalHeadLossM: number;
  netMassDemandLps: number;
}

export function analyzeThermoFluidNetwork(code: string, lines: string[]): ThermoFluidSummary {
  const nodeMap = new Map<string, FluidNode>();
  const conduits: FluidConduit[] = [];

  let section = "";
  const kinematicViscosity = 1.004e-6; // water m²/s at 20°C
  const g = 9.80665;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("//") || trimmed.startsWith("!")) continue;

    const secM = /^\[([A-Za-z_]+)\]/.exec(trimmed);
    if (secM) {
      section = secM[1]!.toUpperCase();
      continue;
    }

    // EPANET / SWMM tabular sections
    if (section === "JUNCTIONS") {
      const cols = trimmed.split(/\s+/);
      if (cols.length >= 2) {
        const id = cols[0]!;
        const elev = Number(cols[1]) || 0;
        const demand = Number(cols[2]) || 0;
        nodeMap.set(id, { id, kind: "junction", elevationM: elev, demandLps: demand, headM: elev + 35, line: i + 1 });
      }
      continue;
    }
    if (section === "RESERVOIRS" || section === "TANKS" || section === "OUTFALLS") {
      const cols = trimmed.split(/\s+/);
      if (cols.length >= 2) {
        const id = cols[0]!;
        const head = Number(cols[1]) || 50;
        const initLvl = section === "TANKS" ? Number(cols[2]) || 0 : 0;
        nodeMap.set(id, {
          id,
          kind: section === "RESERVOIRS" ? "reservoir" : section === "TANKS" ? "tank" : "outfall",
          elevationM: head,
          demandLps: 0,
          headM: head + initLvl,
          line: i + 1,
        });
      }
      continue;
    }
    if (section === "PIPES" || section === "CONDUITS") {
      const cols = trimmed.split(/\s+/);
      if (cols.length >= 5) {
        const id = cols[0]!;
        const from = cols[1]!;
        const to = cols[2]!;
        const lengthM = Math.max(1, Number(cols[3]) || 100);
        // EPANET pipe diameter is in mm when > 5, SWMM conduit geom1 is in m
        const rawDiam = Number(cols[4]) || 200;
        const diameterM = section === "PIPES" && rawDiam > 5 ? rawDiam / 1000 : Math.max(0.02, rawDiam);
        const roughness = Number(cols[5]) || (section === "PIPES" ? 120 : 0.013);
        conduits.push({
          id,
          from,
          to,
          lengthM,
          diameterM,
          roughness,
          velocityMs: 0,
          reynolds: 0,
          regime: "Turbulent",
          headLossM: 0,
          hglStartM: 0,
          hglEndM: 0,
          line: i + 1,
        });
      }
      continue;
    }

    // OLGA / LPS / GT-SUITE keyword-value lines: PIPE / BRANCH LABEL=..., DIAMETER=..., LENGTH=...
    if (/^(?:PIPE|BRANCH|FLOWPATH)\b/i.test(trimmed)) {
      const id =
        /\b(?:LABEL|NAME|ID)\s*=\s*["']?([^"',\s]+)/i.exec(trimmed)?.[1] ??
        trimmed.split(/[\s,]+/)[1] ??
        `Pipe_${conduits.length + 1}`;
      const lengthM = Number(/\bLENGTH\s*=\s*([0-9.eE+-]+)\s*(?:KM)?/i.exec(trimmed)?.[1] ?? 500);
      const isKm = /\bLENGTH\s*=\s*[0-9.eE+-]+\s*KM\b/i.test(trimmed);
      const diamRaw = Number(/\bDIAMETER\s*=\s*([0-9.eE+-]+)/i.exec(trimmed)?.[1] ?? 0.25);
      const rough = Number(/\bROUGHNESS\s*=\s*([0-9.eE+-]+)/i.exec(trimmed)?.[1] ?? 4.5e-5);
      const elev = Number(/\bELEVATION\s*=\s*([0-9.eE+-]+)/i.exec(trimmed)?.[1] ?? 0);
      const from = /\bFROM\s*=\s*["']?([^"',\s]+)/i.exec(trimmed)?.[1] ?? `Inlet_${conduits.length + 1}`;
      const to = /\bTO\s*=\s*["']?([^"',\s]+)/i.exec(trimmed)?.[1] ?? `Outlet_${conduits.length + 1}`;
      if (!nodeMap.has(from)) {
        nodeMap.set(from, {
          id: from,
          kind: "junction",
          elevationM: elev,
          demandLps: 0,
          headM: elev + 80,
          line: i + 1,
        });
      }
      if (!nodeMap.has(to)) {
        nodeMap.set(to, { id: to, kind: "junction", elevationM: elev, demandLps: 0, headM: elev + 70, line: i + 1 });
      }
      conduits.push({
        id,
        from,
        to,
        lengthM: isKm ? lengthM * 1000 : lengthM,
        diameterM: diamRaw > 5 ? diamRaw / 1000 : Math.max(0.02, diamRaw),
        roughness: rough,
        velocityMs: 0,
        reynolds: 0,
        regime: "Turbulent",
        headLossM: 0,
        hglStartM: 0,
        hglEndM: 0,
        line: i + 1,
      });
    }
  }

  // Estimate flow velocity, Reynolds number, Darcy-Weisbach friction loss, and HGL along conduits
  const totalDemandM3s = Array.from(nodeMap.values()).reduce((acc, n) => acc + Math.max(0, n.demandLps), 0) / 1000;
  let runningHead =
    Array.from(nodeMap.values()).find((n) => n.kind === "reservoir" || n.kind === "tank")?.headM ??
    Array.from(nodeMap.values())[0]?.headM ??
    60;

  for (const c of conduits) {
    const nFrom = nodeMap.get(c.from);
    const nTo = nodeMap.get(c.to);
    const area = (Math.PI * c.diameterM * c.diameterM) / 4;
    const estFlowM3s = totalDemandM3s > 0 ? totalDemandM3s / Math.max(1, Math.sqrt(conduits.length)) : area * 1.35;
    const v = Math.max(0.15, Math.min(6.0, estFlowM3s / Math.max(area, 1e-6)));
    const re = (v * c.diameterM) / kinematicViscosity;
    const epsM = c.roughness > 1 ? 0.00015 * (130 / c.roughness) : c.roughness;
    // Swamee-Jain explicit Darcy friction factor
    const f =
      re < 2300
        ? 64 / Math.max(re, 1)
        : 0.25 / Math.pow(Math.log10(epsM / (3.7 * c.diameterM) + 5.74 / Math.pow(re, 0.9)), 2);
    const hf = f * (c.lengthM / c.diameterM) * ((v * v) / (2 * g));
    const hStart = nFrom ? nFrom.headM : runningHead;
    const hEnd = hStart - hf;
    if (nTo && nTo.kind === "junction") {
      nTo.headM = hEnd;
    }
    runningHead = hEnd;

    c.velocityMs = Number(v.toFixed(2));
    c.reynolds = Math.round(re);
    c.regime = re < 2300 ? "Laminar" : re < 4000 ? "Transitional" : "Turbulent";
    c.headLossM = Number(hf.toFixed(2));
    c.hglStartM = Number(hStart.toFixed(2));
    c.hglEndM = Number(hEnd.toFixed(2));
  }

  return {
    nodes: Array.from(nodeMap.values()),
    conduits,
    totalLengthM: Number(conduits.reduce((a, c) => a + c.lengthM, 0).toFixed(1)),
    totalHeadLossM: Number(conduits.reduce((a, c) => a + c.headLossM, 0).toFixed(2)),
    netMassDemandLps: Number(
      Array.from(nodeMap.values())
        .reduce((a, n) => a + n.demandLps, 0)
        .toFixed(2),
    ),
  };
}

export const ThermoFluidInspector: React.FC<ThermoFluidInspectorProps> = ({ code, lines, colorMode, onRevealLine }) => {
  const isDark = colorMode === "dark";
  const [subView, setSubView] = useState<"hgl" | "reynolds" | "nodes">("hgl");

  const borderCol = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  const cardBg = isDark ? "rgba(22, 27, 34, 0.7)" : "rgba(255, 255, 255, 0.9)";
  const textPrimary = isDark ? "#e6edf3" : "#1f2328";
  const textMuted = isDark ? "#8b949e" : "#59636e";

  const { nodes, conduits, totalLengthM, totalHeadLossM, netMassDemandLps } = useMemo(
    () => analyzeThermoFluidNetwork(code, lines),
    [code, lines],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          { id: "hgl", label: `🌊 Hydraulic Grade Line (${conduits.length} conduits)` },
          { id: "reynolds", label: `💨 Darcy-Weisbach & Reynolds Regime` },
          { id: "nodes", label: `⚖️ Nodal Continuity & Heads (${nodes.length} nodes)` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubView(t.id as typeof subView)}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              cursor: "pointer",
              backgroundColor: subView === t.id ? "#1f6feb" : cardBg,
              color: subView === t.id ? "#ffffff" : textPrimary,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subView === "hgl" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Hydraulic Grade Line (HGL) & Friction Head Loss (∑ L = {totalLengthM} m, ∑ h_f = {totalHeadLossM} m)
          </div>
          {conduits.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No pipes, conduits, or wellbore flowpaths found in the active document.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Conduit</th>
                  <th style={{ padding: "6px 8px" }}>From → To</th>
                  <th style={{ padding: "6px 8px" }}>L (m)</th>
                  <th style={{ padding: "6px 8px" }}>D (m)</th>
                  <th style={{ padding: "6px 8px" }}>HGL In → Out (m)</th>
                  <th style={{ padding: "6px 8px" }}>Head Loss Δh_f</th>
                </tr>
              </thead>
              <tbody>
                {conduits.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => onRevealLine?.(c.line, c.id)}
                    style={{ borderBottom: `1px solid ${borderCol}`, cursor: "pointer" }}
                  >
                    <td style={{ padding: "6px 8px", fontWeight: 700, color: "#58a6ff" }}>{c.id}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {c.from} → {c.to}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{c.lengthM}</td>
                    <td style={{ padding: "6px 8px" }}>{c.diameterM.toFixed(3)}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {c.hglStartM} → {c.hglEndM}
                    </td>
                    <td style={{ padding: "6px 8px", color: "#3fb950", fontWeight: 600 }}>−{c.headLossM} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {subView === "reynolds" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Velocity, Reynolds Number (Re = v·D/ν) & Erosion Velocity Audit
          </div>
          {conduits.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>No conduits available for Reynolds regime calculation.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {conduits.map((c) => (
                <div
                  key={c.id}
                  onClick={() => onRevealLine?.(c.line, c.id)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                >
                  <span style={{ fontWeight: 700, color: textPrimary }}>{c.id}</span>
                  <span>v = {c.velocityMs} m/s</span>
                  <span>Re = {c.reynolds.toLocaleString()}</span>
                  <span style={{ color: c.velocityMs > 4.0 ? "#f85149" : "#3fb950", fontWeight: 700 }}>
                    {c.regime} {c.velocityMs > 4.0 ? "⚠ High Velocity" : "✓"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subView === "nodes" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Nodal Elevation, Piezometric Head & Net Demand (∑ Q_demand = {netMassDemandLps} L/s)
          </div>
          {nodes.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>No hydraulic junctions, tanks, or reservoirs parsed.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Node</th>
                  <th style={{ padding: "6px 8px" }}>Type</th>
                  <th style={{ padding: "6px 8px" }}>Elevation z (m)</th>
                  <th style={{ padding: "6px 8px" }}>Head H (m)</th>
                  <th style={{ padding: "6px 8px" }}>Demand (L/s)</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr
                    key={n.id}
                    onClick={() => onRevealLine?.(n.line, n.id)}
                    style={{ borderBottom: `1px solid ${borderCol}`, cursor: "pointer" }}
                  >
                    <td style={{ padding: "6px 8px", fontWeight: 700, color: "#58a6ff" }}>{n.id}</td>
                    <td style={{ padding: "6px 8px" }}>{n.kind}</td>
                    <td style={{ padding: "6px 8px" }}>{n.elevationM}</td>
                    <td style={{ padding: "6px 8px", color: "#3fb950" }}>{n.headM.toFixed(2)}</td>
                    <td style={{ padding: "6px 8px" }}>{n.demandLps}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};
