// SPDX-License-Identifier: AGPL-3.0-or-later

import { XIcon } from "@primer/octicons-react";
import type React from "react";

export interface ProbeData {
  screenX: number;
  screenY: number;
  worldPos: [number, number, number];
  nodeIndex?: number | undefined;
  elementIndex?: number | undefined;
  faceIndex?: number | undefined;
  // FEA fields
  vonMisesMpa?: number | undefined;
  dispMagnitudeMm?: number | undefined;
  displacementVector?: [number, number, number] | undefined;
  safetyFactor?: number | undefined;
  principalStressMpa?: number | undefined;
  // CFD 2030 fields
  velocityMs?: number | undefined;
  velocityVector?: [number, number, number] | undefined;
  pressurePa?: number | undefined;
  temperatureK?: number | undefined;
  qCriterion?: number | undefined;
  vorticity?: number | undefined;
  yPlus?: number | undefined;
  machNumber?: number | undefined;
}

export interface ProbeTooltipProps {
  probe: ProbeData | null;
  pinned?: boolean | undefined;
  dark?: boolean | undefined;
  onClose?: (() => void) | undefined;
}

function formatPressure(pressurePa: number): string {
  const abs = Math.abs(pressurePa);
  if (abs >= 1e6) return `${(pressurePa / 1e6).toFixed(3)} MPa`;
  if (abs >= 1e3) return `${(pressurePa / 1e3).toFixed(2)} kPa`;
  return `${pressurePa.toFixed(1)} Pa`;
}

function formatSciOrFixed(val: number, digits = 2): string {
  const abs = Math.abs(val);
  if (abs > 0 && (abs < 1e-2 || abs >= 1e5)) {
    return val.toExponential(digits);
  }
  return val.toFixed(digits);
}

function getYPlusColor(yPlus: number): string {
  if (yPlus <= 5) return "#34d399"; // viscous sublayer (wall-resolved)
  if (yPlus <= 30) return "#fbbf24"; // buffer layer
  if (yPlus <= 300) return "#38bdf8"; // log-law wall-function region
  return "#f87171"; // coarse near-wall mesh
}

function getYPlusRegime(yPlus: number): string {
  if (yPlus <= 5) return "viscous";
  if (yPlus <= 30) return "buffer";
  if (yPlus <= 300) return "log-law";
  return "coarse";
}

export const ProbeTooltip: React.FC<ProbeTooltipProps> = ({ probe, pinned = false, onClose }) => {
  if (!probe) return null;

  const hasFea =
    probe.vonMisesMpa !== undefined ||
    probe.dispMagnitudeMm !== undefined ||
    probe.safetyFactor !== undefined ||
    probe.principalStressMpa !== undefined;

  const hasCfd =
    probe.velocityMs !== undefined ||
    probe.pressurePa !== undefined ||
    probe.temperatureK !== undefined ||
    probe.qCriterion !== undefined ||
    probe.vorticity !== undefined ||
    probe.yPlus !== undefined ||
    probe.machNumber !== undefined;

  const headerTitle =
    probe.nodeIndex !== undefined
      ? `Node #${probe.nodeIndex + 1}`
      : probe.elementIndex !== undefined
        ? `Element #${probe.elementIndex + 1}`
        : `Face #${probe.faceIndex !== undefined ? probe.faceIndex + 1 : "Surface"}`;

  const rowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    marginBottom: "3px",
  };

  return (
    <div
      style={{
        position: "absolute",
        left: `${probe.screenX + 16}px`,
        top: `${probe.screenY + 16}px`,
        pointerEvents: pinned ? "auto" : "none",
        background: "var(--ms-surface-glass, var(--ms-bg))",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        border: pinned
          ? "1px solid var(--ms-brand, #0e7490)"
          : "1px solid var(--ms-border, var(--color-border-default))",
        borderRadius: "var(--ms-radius-md, 10px)",
        padding: "10px 12px",
        color: "var(--ms-text-1, var(--color-fg-default))",
        fontFamily: "var(--ms-font-sans, system-ui, sans-serif)",
        fontSize: "var(--text-xs, 12px)",
        boxShadow: "var(--ms-shadow-pop, 0 12px 28px rgba(15, 23, 42, 0.25))",
        zIndex: 1000,
        minWidth: "220px",
        maxWidth: "290px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "8px",
          marginBottom: "6px",
          borderBottom: "1px solid var(--ms-divider)",
          paddingBottom: "5px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontWeight: 600, color: "var(--ms-brand, #0e7490)" }}>{headerTitle}</span>
          {probe.elementIndex !== undefined && probe.nodeIndex !== undefined && (
            <span
              style={{
                fontSize: "var(--text-2xs, 11px)",
                color: "var(--ms-text-2)",
                background: "var(--ms-bg-alt)",
                padding: "1px 5px",
                borderRadius: "4px",
                fontFamily: "var(--ms-font-mono, monospace)",
              }}
            >
              E{probe.elementIndex + 1}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span
            style={{
              color: "var(--ms-text-2)",
              fontSize: "var(--text-2xs, 11px)",
              fontFamily: "var(--ms-font-mono, monospace)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            ({probe.worldPos[0].toFixed(3)}, {probe.worldPos[1].toFixed(3)}, {probe.worldPos[2].toFixed(3)})
          </span>
          {pinned && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close probe tooltip"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                color: "var(--ms-text-2)",
                cursor: "pointer",
                padding: "2px",
                lineHeight: 1,
              }}
            >
              <XIcon size={12} />
            </button>
          )}
        </div>
      </div>

      {/* FEA Structural Section */}
      {hasFea && (
        <div style={{ marginBottom: hasCfd ? "6px" : "0" }}>
          {hasCfd && (
            <div
              style={{
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#64748b",
                marginBottom: "3px",
              }}
            >
              Structural (FEA)
            </div>
          )}

          {probe.vonMisesMpa !== undefined && (
            <div style={rowStyle}>
              <span style={{ color: "#94a3b8" }}>Von Mises:</span>
              <span style={{ fontWeight: 600, color: "#f87171", fontFamily: "monospace" }}>
                {probe.vonMisesMpa.toFixed(2)} MPa
              </span>
            </div>
          )}

          {probe.principalStressMpa !== undefined && (
            <div style={rowStyle}>
              <span style={{ color: "#94a3b8" }}>Max Principal:</span>
              <span style={{ fontWeight: 600, color: "#fb923c", fontFamily: "monospace" }}>
                {probe.principalStressMpa.toFixed(2)} MPa
              </span>
            </div>
          )}

          {probe.dispMagnitudeMm !== undefined && (
            <div style={rowStyle}>
              <span style={{ color: "#94a3b8" }}>Displacement:</span>
              <span style={{ fontWeight: 600, color: "#34d399", fontFamily: "monospace" }}>
                {probe.dispMagnitudeMm.toFixed(3)} mm
              </span>
            </div>
          )}

          {probe.displacementVector !== undefined && (
            <div style={{ ...rowStyle, fontSize: "10px", color: "#64748b" }}>
              <span>u (mm):</span>
              <span style={{ fontFamily: "monospace", color: "#94a3b8" }}>
                [{(probe.displacementVector[0] * 1000).toFixed(2)}, {(probe.displacementVector[1] * 1000).toFixed(2)},{" "}
                {(probe.displacementVector[2] * 1000).toFixed(2)}]
              </span>
            </div>
          )}

          {probe.safetyFactor !== undefined && (
            <div style={rowStyle}>
              <span style={{ color: "#94a3b8" }}>Safety Factor:</span>
              <span
                style={{
                  fontWeight: 700,
                  fontFamily: "monospace",
                  color: probe.safetyFactor < 1.25 ? "#ef4444" : probe.safetyFactor < 1.5 ? "#fbbf24" : "#10b981",
                }}
              >
                {probe.safetyFactor.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* CFD 2030 Fluid / Thermal / Turbulence Section */}
      {hasCfd && (
        <div
          style={{
            borderTop: hasFea ? "1px solid rgba(255,255,255,0.08)" : "none",
            paddingTop: hasFea ? "6px" : "0",
          }}
        >
          {hasFea && (
            <div
              style={{
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#64748b",
                marginBottom: "3px",
              }}
            >
              Flow Field (CFD)
            </div>
          )}

          {probe.velocityMs !== undefined && (
            <div style={rowStyle}>
              <span style={{ color: "#94a3b8" }}>Velocity |U|:</span>
              <span style={{ fontWeight: 600, color: "#38bdf8", fontFamily: "monospace" }}>
                {probe.velocityMs.toFixed(2)} m/s
              </span>
            </div>
          )}

          {probe.velocityVector !== undefined && (
            <div style={{ ...rowStyle, fontSize: "10px", color: "#64748b" }}>
              <span>U (m/s):</span>
              <span style={{ fontFamily: "monospace", color: "#94a3b8" }}>
                [{probe.velocityVector[0].toFixed(2)}, {probe.velocityVector[1].toFixed(2)},{" "}
                {probe.velocityVector[2].toFixed(2)}]
              </span>
            </div>
          )}

          {probe.machNumber !== undefined && (
            <div style={rowStyle}>
              <span style={{ color: "#94a3b8" }}>Mach:</span>
              <span style={{ fontWeight: 600, color: "#60a5fa", fontFamily: "monospace" }}>
                {probe.machNumber.toFixed(3)}
              </span>
            </div>
          )}

          {probe.pressurePa !== undefined && (
            <div style={rowStyle}>
              <span style={{ color: "#94a3b8" }}>Pressure:</span>
              <span style={{ fontWeight: 600, color: "#a78bfa", fontFamily: "monospace" }}>
                {formatPressure(probe.pressurePa)}
              </span>
            </div>
          )}

          {probe.temperatureK !== undefined && (
            <div style={rowStyle}>
              <span style={{ color: "#94a3b8" }}>Temperature:</span>
              <span style={{ fontWeight: 600, color: "#fb923c", fontFamily: "monospace" }}>
                {probe.temperatureK.toFixed(2)} K
              </span>
            </div>
          )}

          {probe.qCriterion !== undefined && (
            <div style={rowStyle}>
              <span style={{ color: "#94a3b8" }}>Q-Criterion:</span>
              <span style={{ fontWeight: 600, color: "#2dd4bf", fontFamily: "monospace" }}>
                {formatSciOrFixed(probe.qCriterion)} s⁻²
              </span>
            </div>
          )}

          {probe.vorticity !== undefined && (
            <div style={rowStyle}>
              <span style={{ color: "#94a3b8" }}>Vorticity |ω|:</span>
              <span style={{ fontWeight: 600, color: "#c084fc", fontFamily: "monospace" }}>
                {formatSciOrFixed(probe.vorticity)} s⁻¹
              </span>
            </div>
          )}

          {probe.yPlus !== undefined && (
            <div style={{ ...rowStyle, marginBottom: 0 }}>
              <span style={{ color: "#94a3b8" }}>Wall y⁺:</span>
              <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <span style={{ fontWeight: 700, color: getYPlusColor(probe.yPlus), fontFamily: "monospace" }}>
                  {probe.yPlus.toFixed(2)}
                </span>
                <span
                  style={{
                    fontSize: "9px",
                    padding: "1px 4px",
                    borderRadius: "4px",
                    background: "rgba(255,255,255,0.07)",
                    color: getYPlusColor(probe.yPlus),
                  }}
                >
                  {getYPlusRegime(probe.yPlus)}
                </span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
