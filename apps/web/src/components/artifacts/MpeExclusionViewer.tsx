// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useMemo, useState } from "react";
import styled from "styled-components";
import Box from "../Box";

export interface MpeEmitterViewData {
  id: string;
  name?: string | undefined;
  x: number;
  y: number;
  z: number;
  azimuthDeg: number;
  tiltDeg: number;
  frequencyMhz: number;
  powerWatts: number;
  gainDbi: number;
  exclusionGenPopMeters: number;
  exclusionOccMeters: number;
}

export interface MpeExclusionViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
    title?: string | undefined;
    siteName?: string | undefined;
    siteType?: "rooftop" | "tower" | "monopole" | "water-tank" | undefined;
    groundReflectionFactor?: number | undefined;
    emitters?: MpeEmitterViewData[] | undefined;
    maxTerGeneralPop?: number | undefined;
    maxTerOccupational?: number | undefined;
    requiredSignage?: "None" | "Notice (Blue)" | "Caution (Yellow)" | "Warning (Orange)" | "Danger (Red)" | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "520px")};
  background: var(--color-canvas-default);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 42px;
  min-height: 42px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  z-index: 10;
`;

const ToolbarGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const TabButton = styled.button<{ $active: boolean }>`
  padding: 4px 10px;
  font-size: 12px;
  font-weight: ${(props) => (props.$active ? "600" : "400")};
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  background: ${(props) => (props.$active ? "var(--color-canvas-default)" : "transparent")};
  border: 1px solid ${(props) => (props.$active ? "var(--color-border-default)" : "transparent")};
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-fg-default);
    background: var(--color-canvas-default);
  }
`;

const ContentArea = styled.div`
  flex: 1;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const StatCard = styled.div`
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th,
  td {
    padding: 8px 10px;
    border: 1px solid var(--color-border-muted);
    text-align: left;
  }

  th {
    background: var(--color-canvas-subtle);
    font-weight: 600;
    color: var(--color-fg-muted);
  }

  tr:hover td {
    background: var(--color-canvas-subtle);
  }
`;

const SignageBadge = styled.span<{ $type: string }>`
  display: inline-block;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  background: ${(props) => {
    if (props.$type.includes("Danger")) return "#ffebe9";
    if (props.$type.includes("Warning")) return "#fff1e5";
    if (props.$type.includes("Caution")) return "#fff8c5";
    if (props.$type.includes("Notice")) return "#ddf4ff";
    return "#dafbe1";
  }};
  color: ${(props) => {
    if (props.$type.includes("Danger")) return "#cf222e";
    if (props.$type.includes("Warning")) return "#bc4c00";
    if (props.$type.includes("Caution")) return "#9a6700";
    if (props.$type.includes("Notice")) return "#0969da";
    return "#1a7f37";
  }};
  border: 1px solid rgba(0, 0, 0, 0.15);
`;

export const MpeExclusionViewer: React.FC<MpeExclusionViewerProps> = ({
  viewConfig,
  isFullScreen = false,
}) => {
  const [activeTab, setActiveTab] = useState<"planar" | "emitters" | "compliance">("planar");
  const [copied, setCopied] = useState(false);

  const siteName = viewConfig.siteName ?? "Rooftop Cell Site 104";
  const siteType = viewConfig.siteType ?? "rooftop";

  const emitters = useMemo<MpeEmitterViewData[]>(() => {
    if (viewConfig.emitters && viewConfig.emitters.length > 0) {
      return viewConfig.emitters;
    }
    // Default 3-sector cellular site
    return [
      {
        id: "SEC-ALPHA",
        name: "Alpha Sector (0°)",
        x: 0,
        y: 8,
        z: 3,
        azimuthDeg: 0,
        tiltDeg: 4,
        frequencyMhz: 1900,
        powerWatts: 40,
        gainDbi: 17.5,
        exclusionGenPopMeters: 8.5,
        exclusionOccMeters: 3.8,
      },
      {
        id: "SEC-BETA",
        name: "Beta Sector (120°)",
        x: 7,
        y: -4,
        z: 3,
        azimuthDeg: 120,
        tiltDeg: 4,
        frequencyMhz: 1900,
        powerWatts: 40,
        gainDbi: 17.5,
        exclusionGenPopMeters: 8.5,
        exclusionOccMeters: 3.8,
      },
      {
        id: "SEC-GAMMA",
        name: "Gamma Sector (240°)",
        x: -7,
        y: -4,
        z: 3,
        azimuthDeg: 240,
        tiltDeg: 4,
        frequencyMhz: 1900,
        powerWatts: 40,
        gainDbi: 17.5,
        exclusionGenPopMeters: 8.5,
        exclusionOccMeters: 3.8,
      },
    ];
  }, [viewConfig.emitters]);

  const maxTerGenPop = viewConfig.maxTerGeneralPop ?? 2.45;
  const maxTerOcc = viewConfig.maxTerOccupational ?? 0.85;
  const signage = viewConfig.requiredSignage ?? (maxTerGenPop > 5.0 ? "Danger (Red)" : maxTerGenPop > 1.0 ? "Caution (Yellow)" : "Notice (Blue)");

  // 2D SVG canvas bounds (-25m to +25m)
  const svgWidth = 600;
  const svgHeight = 360;
  const cx = svgWidth / 2;
  const cy = svgHeight / 2;
  const scale = 7.0; // 7 pixels per meter

  const handleCopy = () => {
    const data = {
      siteName,
      siteType,
      maxTerGenPop,
      maxTerOcc,
      signage,
      emitters,
    };
    void navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <ToolbarGroup>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-fg-default)" }}>
            {viewConfig.title ?? `FCC OET-65 MPE Safety: ${siteName}`}
          </span>
          <SignageBadge $type={signage}>{signage}</SignageBadge>
        </ToolbarGroup>
        <ToolbarGroup>
          <TabButton $active={activeTab === "planar"} onClick={() => setActiveTab("planar")}>
            Planar Exclusion (2D)
          </TabButton>
          <TabButton $active={activeTab === "emitters"} onClick={() => setActiveTab("emitters")}>
            Emitters ({emitters.length})
          </TabButton>
          <TabButton $active={activeTab === "compliance"} onClick={() => setActiveTab("compliance")}>
            Compliance Audit
          </TabButton>
          <Button
            size="small"
            leadingVisual={copied ? CheckIcon : CopyIcon}
            onClick={handleCopy}
            aria-label="Copy MPE report"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </ToolbarGroup>
      </Toolbar>

      <ContentArea>
        {activeTab === "planar" && (
          <Box display="flex" flexDirection="column" gap={12}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--color-fg-muted)" }}>
              <span>
                Site Geometry: <strong>{siteType.toUpperCase()}</strong> | Elevation Plane: <strong>z = 2.0m (Walking Height)</strong>
              </span>
              <span>
                Max TER (General Population): <strong style={{ color: maxTerGenPop > 1.0 ? "#cf222e" : "#1a7f37" }}>{maxTerGenPop.toFixed(2)}</strong> (Limit: 1.0)
              </span>
            </div>

            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              style={{
                width: "100%",
                height: "auto",
                background: "var(--color-canvas-subtle)",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
              }}
            >
              {/* Distance grid circles: 5m, 10m, 15m, 20m */}
              {[5, 10, 15, 20].map((r) => (
                <g key={r}>
                  <circle cx={cx} cy={cy} r={r * scale} fill="none" stroke="var(--color-border-muted)" strokeWidth="1" strokeDasharray="3 3" />
                  <text x={cx + r * scale + 2} y={cy - 2} fontSize="9" fill="var(--color-fg-muted)">{r}m</text>
                </g>
              ))}

              {/* Axes */}
              <line x1={cx} y1={10} x2={cx} y2={svgHeight - 10} stroke="var(--color-border-muted)" strokeWidth="1" />
              <line x1={10} y1={cy} x2={svgWidth - 10} y2={cy} stroke="var(--color-border-muted)" strokeWidth="1" />
              <text x={cx + 4} y={20} fontSize="10" fill="var(--color-fg-muted)" fontWeight="600">N (0°)</text>

              {/* Emitter sectors and exclusion zones */}
              {emitters.map((e) => {
                const px = cx + e.x * scale;
                const py = cy - e.y * scale; // Inverted Y in SVG
                const rad = ((90 - e.azimuthDeg) * Math.PI) / 180;
                const rGenPop = e.exclusionGenPopMeters * scale;
                const rOcc = e.exclusionOccMeters * scale;

                // Sector arc wedge path (+/- 32.5 deg 3dB beamwidth)
                const beamHalfAngle = (32.5 * Math.PI) / 180;
                const a1 = rad - beamHalfAngle;
                const a2 = rad + beamHalfAngle;

                const xGenPop1 = px + rGenPop * Math.cos(a1);
                const yGenPop1 = py - rGenPop * Math.sin(a1);
                const xGenPop2 = px + rGenPop * Math.cos(a2);
                const yGenPop2 = py - rGenPop * Math.sin(a2);

                const xOcc1 = px + rOcc * Math.cos(a1);
                const yOcc1 = py - rOcc * Math.sin(a1);
                const xOcc2 = px + rOcc * Math.cos(a2);
                const yOcc2 = py - rOcc * Math.sin(a2);

                return (
                  <g key={e.id}>
                    {/* General Population Exclusion Zone (Yellow/Orange Arc) */}
                    <path
                      d={`M ${px} ${py} L ${xGenPop1} ${yGenPop1} A ${rGenPop} ${rGenPop} 0 0 0 ${xGenPop2} ${yGenPop2} Z`}
                      fill="rgba(240, 180, 0, 0.22)"
                      stroke="#d97706"
                      strokeWidth="1.5"
                    />

                    {/* Occupational Exclusion Zone (Red/Danger Arc) */}
                    <path
                      d={`M ${px} ${py} L ${xOcc1} ${yOcc1} A ${rOcc} ${rOcc} 0 0 0 ${xOcc2} ${yOcc2} Z`}
                      fill="rgba(207, 34, 46, 0.35)"
                      stroke="#cf222e"
                      strokeWidth="1.5"
                    />

                    {/* Antenna Position Marker & Boresight Arrow */}
                    <circle cx={px} cy={py} r="4" fill="#0969da" stroke="#fff" strokeWidth="1.5" />
                    <line
                      x1={px}
                      y1={py}
                      x2={px + 20 * Math.cos(rad)}
                      y2={py - 20 * Math.sin(rad)}
                      stroke="#0969da"
                      strokeWidth="2"
                    />
                    <text x={px + 8} y={py - 6} fontSize="10" fill="var(--color-fg-default)" fontWeight="700">
                      {e.name ?? e.id}
                    </text>
                  </g>
                );
              })}
            </svg>

            <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: "var(--color-fg-muted)", alignItems: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 12, height: 12, background: "rgba(207, 34, 46, 0.5)", border: "1px solid #cf222e", display: "inline-block" }} />
                Occupational Boundary (&gt; 100% Occ MPE)
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 12, height: 12, background: "rgba(240, 180, 0, 0.35)", border: "1px solid #d97706", display: "inline-block" }} />
                General Population Boundary (&gt; 100% Gen Pop MPE)
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#0969da", display: "inline-block" }} />
                Antenna Emitter Location & Boresight
              </span>
            </div>
          </Box>
        )}

        {activeTab === "emitters" && (
          <Box display="flex" flexDirection="column" gap={12}>
            <Table>
              <thead>
                <tr>
                  <th>Emitter</th>
                  <th>Freq (MHz)</th>
                  <th>Power (W)</th>
                  <th>Gain (dBi)</th>
                  <th>Azimuth</th>
                  <th>Tilt</th>
                  <th>Gen Pop Exclusion</th>
                  <th>Occupational Exclusion</th>
                </tr>
              </thead>
              <tbody>
                {emitters.map((e) => (
                  <tr key={e.id}>
                    <td><strong>{e.name ?? e.id}</strong></td>
                    <td>{e.frequencyMhz} MHz</td>
                    <td>{e.powerWatts} W</td>
                    <td>{e.gainDbi} dBi</td>
                    <td>{e.azimuthDeg}°</td>
                    <td>{e.tiltDeg}°</td>
                    <td><strong style={{ color: "#d97706" }}>{e.exclusionGenPopMeters.toFixed(1)} m</strong></td>
                    <td><strong style={{ color: "#cf222e" }}>{e.exclusionOccMeters.toFixed(1)} m</strong></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Box>
        )}

        {activeTab === "compliance" && (
          <Box display="flex" flexDirection="column" gap={16}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
              <StatCard>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Max TER (Gen Pop)</span>
                <span style={{ fontSize: "20px", fontWeight: 700, color: maxTerGenPop <= 1.0 ? "#1a7f37" : "#cf222e" }}>
                  {maxTerGenPop.toFixed(2)}
                </span>
                <span style={{ fontSize: "10px", color: "var(--color-fg-muted)" }}>Threshold: &le; 1.00</span>
              </StatCard>
              <StatCard>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Max TER (Occupational)</span>
                <span style={{ fontSize: "20px", fontWeight: 700, color: maxTerOcc <= 1.0 ? "#1a7f37" : "#cf222e" }}>
                  {maxTerOcc.toFixed(2)}
                </span>
                <span style={{ fontSize: "10px", color: "var(--color-fg-muted)" }}>Threshold: &le; 1.00</span>
              </StatCard>
              <StatCard>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Required Site Signage</span>
                <span style={{ fontSize: "16px", fontWeight: 700 }}>{signage}</span>
                <span style={{ fontSize: "10px", color: "var(--color-fg-muted)" }}>OSHA 1910.97 Compliant</span>
              </StatCard>
              <StatCard>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Unmitigated Compliance</span>
                <span style={{ fontSize: "18px", fontWeight: 700, color: maxTerGenPop <= 1.0 ? "#1a7f37" : "#d97706" }}>
                  {maxTerGenPop <= 1.0 ? "✓ Full Access" : "⚠ Barriers Required"}
                </span>
                <span style={{ fontSize: "10px", color: "var(--color-fg-muted)" }}>Rooftop access door lockout</span>
              </StatCard>
            </div>
          </Box>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default MpeExclusionViewer;
