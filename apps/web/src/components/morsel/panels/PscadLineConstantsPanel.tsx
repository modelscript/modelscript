// SPDX-License-Identifier: AGPL-3.0-or-later

import { applySplices, extractEmtNetlist, LineConstantsSolver, parsePscx, planPscadEdits } from "@modelscript/pscad";
import React, { useEffect, useMemo, useState } from "react";

export interface PscadLineConstantsPanelProps {
  colorMode: "light" | "dark";
  code?: string | undefined;
  onCodeChange?: ((newCode: string) => void) | undefined;
}

export const PscadLineConstantsPanel: React.FC<PscadLineConstantsPanelProps> = ({ colorMode, code, onCodeChange }) => {
  const isDark = colorMode === "dark";
  const borderColor = isDark ? "#30363d" : "#d0d7de";
  const bg = isDark ? "#121214" : "#f6f8fa";
  const cardBg = isDark ? "#1b1d22" : "#ffffff";
  const muted = isDark ? "#8b949e" : "#57606a";

  const parsedLines = useMemo(() => {
    if (!code) return [];
    try {
      const proj = parsePscx(code);
      return extractEmtNetlist(proj).transmissionLines;
    } catch {
      return [];
    }
  }, [code]);

  const [selectedLineId, setSelectedLineId] = useState("");
  const activeLine = parsedLines.find((l) => l.id === selectedLineId) ?? parsedLines[0];

  const [mode, setMode] = useState<"tower" | "cable">("tower");
  const [heightM, setHeightM] = useState(25);
  const [spacingM, setSpacingM] = useState(7);
  const [sagM, setSagM] = useState(8);
  const [bundleN, setBundleN] = useState(2);
  const [rhoOhmM, setRhoOhmM] = useState(100);
  const [lengthKm, setLengthKm] = useState(100);

  // Coaxial cable geometry (radii stored in mm for ergonomic editing)
  const [burialDepthM, setBurialDepthM] = useState(1.2);
  const [coreRadiusMm, setCoreRadiusMm] = useState(18);
  const [coreRdc, setCoreRdc] = useState(0.035);
  const [insulRadiusMm, setInsulRadiusMm] = useState(34);
  const [insulEpsR, setInsulEpsR] = useState(2.3);
  const [sheathRadiusMm, setSheathRadiusMm] = useState(38);
  const sheathRdc = 0.35;
  const [jacketRadiusMm, setJacketRadiusMm] = useState(42);
  const jacketEpsR = 2.5;

  useEffect(() => {
    if (!activeLine) return;
    if (activeLine.towerHeightM !== undefined) setHeightM(activeLine.towerHeightM);
    if (activeLine.phaseSpacingM !== undefined) setSpacingM(activeLine.phaseSpacingM);
    if (activeLine.bundleCount !== undefined) setBundleN(activeLine.bundleCount);
    if (activeLine.soilResistivityOhmM !== undefined) setRhoOhmM(activeLine.soilResistivityOhmM);
    if (activeLine.lengthKm !== undefined) setLengthKm(activeLine.lengthKm);
  }, [
    activeLine?.id,
    activeLine?.towerHeightM,
    activeLine?.phaseSpacingM,
    activeLine?.bundleCount,
    activeLine?.soilResistivityOhmM,
    activeLine?.lengthKm,
  ]);

  const handleApplyToPscx = () => {
    if (!code || !onCodeChange || !activeLine) return;
    try {
      const ops =
        mode === "tower"
          ? [
              { type: "setParameter" as const, componentId: activeLine.id, paramName: "tower_height", value: heightM },
              {
                type: "setParameter" as const,
                componentId: activeLine.id,
                paramName: "phase_spacing",
                value: spacingM,
              },
              { type: "setParameter" as const, componentId: activeLine.id, paramName: "bundle_count", value: bundleN },
              {
                type: "setParameter" as const,
                componentId: activeLine.id,
                paramName: "soil_resistivity",
                value: rhoOhmM,
              },
              { type: "setParameter" as const, componentId: activeLine.id, paramName: "length", value: lengthKm },
            ]
          : [
              {
                type: "setParameter" as const,
                componentId: activeLine.id,
                paramName: "soil_resistivity",
                value: rhoOhmM,
              },
              { type: "setParameter" as const, componentId: activeLine.id, paramName: "length", value: lengthKm },
              {
                type: "setParameter" as const,
                componentId: activeLine.id,
                paramName: "R",
                value: result.r1OhmPerKm.toFixed(4),
              },
              {
                type: "setParameter" as const,
                componentId: activeLine.id,
                paramName: "X",
                value: result.x1OhmPerKm.toFixed(4),
              },
            ];
      const plan = planPscadEdits(code, ops);
      if (plan.splices.length > 0) {
        onCodeChange(applySplices(code, plan.splices));
      }
    } catch {
      // ignore if component id cannot be patched directly
    }
  };

  const handleInsertTLine = () => {
    if (!code || !onCodeChange) return;
    try {
      const plan = planPscadEdits(code, [
        {
          type: "addComponent",
          defn: mode === "cable" ? "master:cable" : "master:tline",
          x: 240,
          y: 160,
          params: {
            Name: mode === "cable" ? "Cable1" : "TLine1",
            length: String(lengthKm),
            soil_resistivity: String(rhoOhmM),
            ...(mode === "tower"
              ? {
                  tower_height: String(heightM),
                  phase_spacing: String(spacingM),
                  bundle_count: String(bundleN),
                }
              : {
                  R: result.r1OhmPerKm.toFixed(4),
                  X: result.x1OhmPerKm.toFixed(4),
                }),
          },
        },
      ]);
      if (plan.splices.length > 0) {
        onCodeChange(applySplices(code, plan.splices));
      }
    } catch {
      // ignore if project lacks Main schematic
    }
  };

  const conductors = useMemo(
    () => [
      {
        id: "A",
        phase: "A",
        xMeters: -spacingM,
        yMeters: heightM,
        sagMeters: sagM,
        radiusMeters: activeLine?.conductorRadiusM ?? 0.01407,
        rDcOhmPerKm: 0.059,
        subConductorCount: bundleN,
        bundleSpacingMeters: activeLine?.bundleSpacingM ?? 0.457,
      },
      {
        id: "B",
        phase: "B",
        xMeters: 0,
        yMeters: heightM,
        sagMeters: sagM,
        radiusMeters: activeLine?.conductorRadiusM ?? 0.01407,
        rDcOhmPerKm: 0.059,
        subConductorCount: bundleN,
        bundleSpacingMeters: activeLine?.bundleSpacingM ?? 0.457,
      },
      {
        id: "C",
        phase: "C",
        xMeters: spacingM,
        yMeters: heightM,
        sagMeters: sagM,
        radiusMeters: activeLine?.conductorRadiusM ?? 0.01407,
        rDcOhmPerKm: 0.059,
        subConductorCount: bundleN,
        bundleSpacingMeters: activeLine?.bundleSpacingM ?? 0.457,
      },
      {
        id: "GW1",
        isGroundWire: true,
        xMeters: -spacingM * 0.65,
        yMeters: heightM + 6,
        sagMeters: sagM * 0.7,
        radiusMeters: 0.005,
        rDcOhmPerKm: 1.5,
      },
      {
        id: "GW2",
        isGroundWire: true,
        xMeters: spacingM * 0.65,
        yMeters: heightM + 6,
        sagMeters: sagM * 0.7,
        radiusMeters: 0.005,
        rDcOhmPerKm: 1.5,
      },
    ],
    [heightM, spacingM, sagM, bundleN, activeLine?.conductorRadiusM, activeLine?.bundleSpacingM],
  );

  const safeCoreM = Math.max(0.002, coreRadiusMm / 1000);
  const safeInsulM = Math.max(safeCoreM + 0.002, insulRadiusMm / 1000);
  const safeSheathM = Math.max(safeInsulM + 0.001, sheathRadiusMm / 1000);
  const safeJacketM = Math.max(safeSheathM + 0.001, jacketRadiusMm / 1000);

  const lineName = activeLine?.id || (mode === "tower" ? "Tower_500kV" : "XLPE_Cable");

  const result =
    mode === "tower"
      ? LineConstantsSolver.solveTower(
          {
            name: lineName,
            earthResistivityOhmMeter: rhoOhmM,
            conductors,
          },
          { lengthKm },
        )
      : LineConstantsSolver.solveCable(
          {
            name: lineName,
            earthResistivityOhmMeter: rhoOhmM,
            burialDepthMeters: Math.max(0.2, burialDepthM),
            coreRadiusMeters: safeCoreM,
            coreRdcOhmPerKm: Math.max(0.001, coreRdc),
            insulationRadiusMeters: safeInsulM,
            insulationRelativePermittivity: Math.max(1.0, insulEpsR),
            sheathRadiusMeters: safeSheathM,
            sheathRdcOhmPerKm: Math.max(0.01, sheathRdc),
            jacketRadiusMeters: safeJacketM,
            jacketRelativePermittivity: Math.max(1.0, jacketEpsR),
          },
          { lengthKm },
        );

  const maxX = Math.max(12, spacingM + 4);
  const maxY = Math.max(36, heightM + 10);

  return (
    <div
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        background: bg,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 12.5 }}>Line &amp; Cable Constants (LCP / EMTP Z₀/Z₁)</strong>
          <div
            style={{ display: "inline-flex", border: `1px solid ${borderColor}`, borderRadius: 5, overflow: "hidden" }}
          >
            <button
              type="button"
              onClick={() => setMode("tower")}
              style={{
                padding: "2px 8px",
                fontSize: 11,
                fontWeight: mode === "tower" ? 600 : 400,
                border: "none",
                background: mode === "tower" ? "var(--ms-brand, #2f81f7)" : cardBg,
                color: mode === "tower" ? "#ffffff" : "inherit",
                cursor: "pointer",
              }}
            >
              Overhead Tower
            </button>
            <button
              type="button"
              onClick={() => setMode("cable")}
              style={{
                padding: "2px 8px",
                fontSize: 11,
                fontWeight: mode === "cable" ? 600 : 400,
                border: "none",
                background: mode === "cable" ? "var(--ms-brand, #2f81f7)" : cardBg,
                color: mode === "cable" ? "#ffffff" : "inherit",
                cursor: "pointer",
              }}
            >
              Coaxial Cable
            </button>
          </div>
          {parsedLines.length > 0 && (
            <select
              value={activeLine?.id ?? ""}
              onChange={(e) => setSelectedLineId(e.target.value)}
              aria-label="Transmission line"
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 5,
                border: `1px solid ${borderColor}`,
                background: cardBg,
                color: "inherit",
              }}
            >
              {parsedLines.map((ln) => (
                <option key={ln.id} value={ln.id}>
                  {ln.id} ({ln.fromBus}→{ln.toBus})
                </option>
              ))}
            </select>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: muted, fontFamily: "monospace" }}>
            Zc₁ = {result.surgeImpedanceOhm.toFixed(1)} Ω · τ₁ = {(result.travelTimeSec * 1e3).toFixed(3)} ms
          </span>
          {onCodeChange && code && (
            <button
              type="button"
              onClick={handleInsertTLine}
              style={{
                padding: "3px 8px",
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 600,
                border: `1px solid ${borderColor}`,
                background: cardBg,
                color: "inherit",
                cursor: "pointer",
              }}
            >
              + Insert {mode === "cable" ? "Cable" : "TLine"}
            </button>
          )}
          {onCodeChange && activeLine && (
            <button
              type="button"
              onClick={handleApplyToPscx}
              style={{
                padding: "3px 8px",
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 600,
                border: "none",
                background: "var(--ms-brand, #2f81f7)",
                color: "#ffffff",
                cursor: "pointer",
              }}
            >
              Apply to .pscx
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, alignItems: "center" }}>
        {mode === "tower" ? (
          <svg
            width={150}
            height={130}
            viewBox={`${-maxX} ${-maxY} ${2 * maxX} ${maxY + 4}`}
            style={{ border: `1px solid ${borderColor}`, borderRadius: 6, background: cardBg }}
            aria-label="Tower cross-section"
          >
            <line x1={-maxX} y1={0} x2={maxX} y2={0} stroke="#6e7681" strokeWidth={0.5} />
            <line x1={0} y1={0} x2={0} y2={-(heightM + 6)} stroke="#6e7681" strokeWidth={0.6} />
            <line x1={-spacingM} y1={-heightM} x2={spacingM} y2={-heightM} stroke="#6e7681" strokeWidth={0.5} />
            {conductors.map((c) => (
              <g key={c.id}>
                <circle
                  cx={c.xMeters}
                  cy={-c.yMeters}
                  r={c.isGroundWire ? 0.65 : 1.05}
                  fill={c.isGroundWire ? "#8b949e" : "#38bdf8"}
                />
                {!c.isGroundWire && (
                  <text
                    x={c.xMeters}
                    y={-c.yMeters - 1.6}
                    textAnchor="middle"
                    fontSize={2.4}
                    fill={isDark ? "#e6edf3" : "#1f2328"}
                  >
                    {c.id}
                  </text>
                )}
              </g>
            ))}
          </svg>
        ) : (
          <svg
            width={150}
            height={130}
            viewBox="-55 -55 110 110"
            style={{ border: `1px solid ${borderColor}`, borderRadius: 6, background: cardBg }}
            aria-label="Coaxial cable cross-section"
          >
            <line x1={-55} y1={-46} x2={55} y2={-46} stroke="#8b949e" strokeWidth={1} strokeDasharray="3 2" />
            <text x={0} y={-49} textAnchor="middle" fontSize={7} fill={muted}>
              Depth {burialDepthM.toFixed(1)} m
            </text>
            <circle
              cx={0}
              cy={4}
              r={Math.min(44, Math.max(20, safeJacketM * 1000 * 0.9))}
              fill="#334155"
              stroke="#64748b"
              strokeWidth={1}
            />
            <circle cx={0} cy={4} r={Math.min(39, Math.max(16, safeSheathM * 1000 * 0.9))} fill="#94a3b8" />
            <circle
              cx={0}
              cy={4}
              r={Math.min(34, Math.max(12, safeInsulM * 1000 * 0.9))}
              fill="#38bdf8"
              fillOpacity={0.35}
              stroke="#38bdf8"
              strokeWidth={0.8}
            />
            <circle cx={0} cy={4} r={Math.min(24, Math.max(6, safeCoreM * 1000 * 0.9))} fill="#f59e0b" />
          </svg>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {mode === "tower" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(80px, 1fr))", gap: 6, fontSize: 11 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>Height (m)</span>
                <input
                  type="number"
                  value={heightM}
                  min={8}
                  max={60}
                  onChange={(e) => setHeightM(Math.max(8, Number(e.target.value) || 25))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>Spacing (m)</span>
                <input
                  type="number"
                  value={spacingM}
                  min={2}
                  max={25}
                  onChange={(e) => setSpacingM(Math.max(2, Number(e.target.value) || 7))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>Length (km)</span>
                <input
                  type="number"
                  value={lengthKm}
                  min={1}
                  max={1000}
                  onChange={(e) => setLengthKm(Math.max(1, Number(e.target.value) || 100))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>Sag (m)</span>
                <input
                  type="number"
                  value={sagM}
                  min={0}
                  max={25}
                  onChange={(e) => setSagM(Math.max(0, Number(e.target.value) || 0))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>Bundle N</span>
                <input
                  type="number"
                  value={bundleN}
                  min={1}
                  max={8}
                  onChange={(e) => setBundleN(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>ρ Earth (Ω·m)</span>
                <input
                  type="number"
                  value={rhoOhmM}
                  min={1}
                  max={5000}
                  onChange={(e) => setRhoOhmM(Math.max(1, Number(e.target.value) || 100))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(80px, 1fr))", gap: 6, fontSize: 11 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>Core Radius (mm)</span>
                <input
                  type="number"
                  value={coreRadiusMm}
                  min={2}
                  max={80}
                  onChange={(e) => setCoreRadiusMm(Math.max(2, Number(e.target.value) || 18))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>XLPE Radius (mm)</span>
                <input
                  type="number"
                  value={insulRadiusMm}
                  min={4}
                  max={120}
                  onChange={(e) => setInsulRadiusMm(Math.max(4, Number(e.target.value) || 34))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>Sheath Radius (mm)</span>
                <input
                  type="number"
                  value={sheathRadiusMm}
                  min={5}
                  max={130}
                  onChange={(e) => setSheathRadiusMm(Math.max(5, Number(e.target.value) || 38))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>Jacket Radius (mm)</span>
                <input
                  type="number"
                  value={jacketRadiusMm}
                  min={6}
                  max={140}
                  onChange={(e) => setJacketRadiusMm(Math.max(6, Number(e.target.value) || 42))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>Burial Depth (m)</span>
                <input
                  type="number"
                  step={0.1}
                  value={burialDepthM}
                  min={0.3}
                  max={10}
                  onChange={(e) => setBurialDepthM(Math.max(0.3, Number(e.target.value) || 1.2))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>XLPE εr</span>
                <input
                  type="number"
                  step={0.1}
                  value={insulEpsR}
                  min={1}
                  max={12}
                  onChange={(e) => setInsulEpsR(Math.max(1, Number(e.target.value) || 2.3))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>Core Rdc (Ω/km)</span>
                <input
                  type="number"
                  step={0.005}
                  value={coreRdc}
                  min={0.001}
                  max={5}
                  onChange={(e) => setCoreRdc(Math.max(0.001, Number(e.target.value) || 0.035))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>Length (km)</span>
                <input
                  type="number"
                  value={lengthKm}
                  min={1}
                  max={1000}
                  onChange={(e) => setLengthKm(Math.max(1, Number(e.target.value) || 100))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: muted }}>ρ Earth (Ω·m)</span>
                <input
                  type="number"
                  value={rhoOhmM}
                  min={1}
                  max={5000}
                  onChange={(e) => setRhoOhmM(Math.max(1, Number(e.target.value) || 100))}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              fontSize: 11,
              fontFamily: "monospace",
              padding: "6px 8px",
              borderRadius: 6,
              border: `1px solid ${borderColor}`,
              background: cardBg,
            }}
          >
            <div>
              R₁={result.r1OhmPerKm.toFixed(4)} Ω/km · X₁={result.x1OhmPerKm.toFixed(4)} Ω/km · B₁=
              {result.b1MicroSiemensPerKm.toFixed(2)} µS/km
            </div>
            <div>
              R₀={result.r0OhmPerKm.toFixed(4)} Ω/km · X₀={result.x0OhmPerKm.toFixed(4)} Ω/km · B₀=
              {result.b0MicroSiemensPerKm.toFixed(2)} µS/km
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
