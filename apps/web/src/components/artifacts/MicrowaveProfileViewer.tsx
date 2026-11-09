// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useMemo, useState } from "react";
import styled from "styled-components";
import Box from "../Box";

export interface ObstacleProfilePoint {
  distanceKm: number;
  groundElevationMeters: number;
  obstacleHeightMeters?: number | undefined;
  name?: string | undefined;
}

export interface MicrowaveProfileViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
    title?: string | undefined;
    frequencyGhz?: number | undefined;
    pathLengthKm?: number | undefined;
    txSiteName?: string | undefined;
    rxSiteName?: string | undefined;
    txTowerHeightMeters?: number | undefined;
    rxTowerHeightMeters?: number | undefined;
    txGroundElevationMeters?: number | undefined;
    rxGroundElevationMeters?: number | undefined;
    kFactor?: number | undefined;
    obstacles?: ObstacleProfilePoint[] | undefined;
    annualAvailabilityPercent?: number | undefined;
    fadeMarginDb?: number | undefined;
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

export const MicrowaveProfileViewer: React.FC<MicrowaveProfileViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const [activeTab, setActiveTab] = useState<"profile" | "obstacles" | "budget">("profile");
  const [copied, setCopied] = useState(false);

  const freqGhz = viewConfig.frequencyGhz ?? 11.0;
  const pathKm = viewConfig.pathLengthKm ?? 15.0;
  const txSite = viewConfig.txSiteName ?? "Site Alpha";
  const rxSite = viewConfig.rxSiteName ?? "Site Bravo";
  const txTowerH = viewConfig.txTowerHeightMeters ?? 45.0;
  const rxTowerH = viewConfig.rxTowerHeightMeters ?? 35.0;
  const txGroundElev = viewConfig.txGroundElevationMeters ?? 120.0;
  const rxGroundElev = viewConfig.rxGroundElevationMeters ?? 145.0;
  const kFactor = viewConfig.kFactor ?? 1.333; // 4/3 standard atmosphere

  const obstacles = useMemo<ObstacleProfilePoint[]>(() => {
    if (viewConfig.obstacles && viewConfig.obstacles.length > 0) {
      return viewConfig.obstacles;
    }
    // Default terrain profile with 3 obstacles
    return [
      { distanceKm: 3.5, groundElevationMeters: 130, obstacleHeightMeters: 15, name: "Ridge Line A" },
      { distanceKm: 7.5, groundElevationMeters: 140, obstacleHeightMeters: 20, name: "Hilltop / Trees" },
      { distanceKm: 11.2, groundElevationMeters: 135, obstacleHeightMeters: 12, name: "Industrial Building" },
    ];
  }, [viewConfig.obstacles]);

  // Compute profile calculations
  const profileData = useMemo(() => {
    const numSteps = 50;
    const points: Array<{
      dKm: number;
      terrainElev: number;
      earthBulge: number;
      losElev: number;
      f1Radius: number;
      f1Upper: number;
      f1Lower: number;
      f60Lower: number;
    }> = [];

    const txTotalH = txGroundElev + txTowerH;
    const rxTotalH = rxGroundElev + rxTowerH;

    for (let i = 0; i <= numSteps; i++) {
      const dKm = (i / numSteps) * pathKm;
      const d1 = dKm;
      const d2 = pathKm - d1;

      // Earth curvature bulge (meters): h_e = (d1 * d2) / (12.74 * K)
      const earthBulge = (d1 * d2) / (12.74 * kFactor);

      // Line-of-sight elevation (meters above reference)
      const losElev = txTotalH + (dKm / pathKm) * (rxTotalH - txTotalH);

      // 1st Fresnel zone radius: r1 = 17.32 * sqrt((d1 * d2) / (f * d))
      const f1Radius = 17.32 * Math.sqrt(Math.max(0, (d1 * d2) / (freqGhz * pathKm)));

      // Base terrain profile interpolation
      const baseTerrain =
        txGroundElev + (dKm / pathKm) * (rxGroundElev - txGroundElev) - 10 + 15 * Math.sin((dKm / pathKm) * Math.PI);
      const totalTerrainWithBulge = baseTerrain + earthBulge;

      points.push({
        dKm,
        terrainElev: totalTerrainWithBulge,
        earthBulge,
        losElev,
        f1Radius,
        f1Upper: losElev + f1Radius,
        f1Lower: losElev - f1Radius,
        f60Lower: losElev - 0.6 * f1Radius,
      });
    }

    // Midpoint values
    const midD = pathKm / 2;
    const midF1 = 17.32 * Math.sqrt((midD * midD) / (freqGhz * pathKm));

    // Audit obstacles against 60% F1
    const obstacleAudits = obstacles.map((obs) => {
      const d1 = obs.distanceKm;
      const d2 = pathKm - d1;
      const bulge = (d1 * d2) / (12.74 * kFactor);
      const los = txTotalH + (d1 / pathKm) * (rxTotalH - txTotalH);
      const f1 = 17.32 * Math.sqrt(Math.max(0, (d1 * d2) / (freqGhz * pathKm)));
      const topElev = obs.groundElevationMeters + (obs.obstacleHeightMeters ?? 0) + bulge;
      const clearanceMeters = los - topElev;
      const clearanceRatio = f1 > 0 ? clearanceMeters / f1 : 1.0;
      const isAdequate = clearanceRatio >= 0.6;
      return {
        ...obs,
        earthBulgeMeters: Math.round(bulge * 10) / 10,
        effectiveTopElevMeters: Math.round(topElev * 10) / 10,
        losElevMeters: Math.round(los * 10) / 10,
        f1RadiusMeters: Math.round(f1 * 10) / 10,
        clearanceMeters: Math.round(clearanceMeters * 10) / 10,
        clearanceRatioPercent: Math.round(clearanceRatio * 1000) / 10,
        isAdequate,
      };
    });

    const minRatio = obstacleAudits.length > 0 ? Math.min(...obstacleAudits.map((o) => o.clearanceRatioPercent)) : 100;

    return {
      points,
      midF1: Math.round(midF1 * 10) / 10,
      obstacleAudits,
      minClearancePercent: minRatio,
      isFullyClear: minRatio >= 60,
    };
  }, [freqGhz, pathKm, txTowerH, rxTowerH, txGroundElev, rxGroundElev, kFactor, obstacles]);

  // SVG coordinate projection
  const svgWidth = 720;
  const svgHeight = 280;
  const padLeft = 50;
  const padRight = 30;
  const padTop = 30;
  const padBottom = 40;

  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const maxElev = Math.max(
    txGroundElev + txTowerH + 20,
    rxGroundElev + rxTowerH + 20,
    ...profileData.points.map((p) => p.f1Upper),
  );
  const minElev = Math.min(txGroundElev - 20, rxGroundElev - 20, ...profileData.points.map((p) => p.terrainElev));
  const elevRange = Math.max(1, maxElev - minElev);

  const scaleX = (dKm: number) => padLeft + (dKm / pathKm) * plotW;
  const scaleY = (elevM: number) => padTop + plotH - ((elevM - minElev) / elevRange) * plotH;

  // Build SVG Paths
  const losPath = `M ${scaleX(0)} ${scaleY(txGroundElev + txTowerH)} L ${scaleX(pathKm)} ${scaleY(rxGroundElev + rxTowerH)}`;

  const f1UpperPath = profileData.points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.dKm)} ${scaleY(p.f1Upper)}`)
    .join(" ");

  const f1LowerPath = profileData.points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.dKm)} ${scaleY(p.f1Lower)}`)
    .join(" ");

  const f60LowerPath = profileData.points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.dKm)} ${scaleY(p.f60Lower)}`)
    .join(" ");

  const terrainPath =
    profileData.points.map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.dKm)} ${scaleY(p.terrainElev)}`).join(" ") +
    ` L ${scaleX(pathKm)} ${padTop + plotH} L ${scaleX(0)} ${padTop + plotH} Z`;

  const handleCopy = () => {
    const data = {
      link: { freqGhz, pathKm, txSite, rxSite, txTowerH, rxTowerH, kFactor },
      profile: profileData,
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
            {viewConfig.title ?? `Microwave Path Profile: ${txSite} ➔ ${rxSite} (${freqGhz} GHz)`}
          </span>
        </ToolbarGroup>
        <ToolbarGroup>
          <TabButton $active={activeTab === "profile"} onClick={() => setActiveTab("profile")}>
            Path Profile
          </TabButton>
          <TabButton $active={activeTab === "obstacles"} onClick={() => setActiveTab("obstacles")}>
            Obstacle Audit ({profileData.obstacleAudits.length})
          </TabButton>
          <TabButton $active={activeTab === "budget"} onClick={() => setActiveTab("budget")}>
            Link Summary
          </TabButton>
          <Button
            size="small"
            leadingVisual={copied ? CheckIcon : CopyIcon}
            onClick={handleCopy}
            aria-label="Copy profile metrics"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </ToolbarGroup>
      </Toolbar>

      <ContentArea>
        {activeTab === "profile" && (
          <Box display="flex" flexDirection="column" gap={12}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "12px",
                color: "var(--color-fg-muted)",
              }}
            >
              <span>
                Tx Tower: <strong>{txTowerH}m</strong> @ {txSite} ({txGroundElev}m ASL)
              </span>
              <span>
                Midpoint 1st Fresnel F1: <strong>{profileData.midF1}m</strong> | k-factor: <strong>{kFactor}</strong>
              </span>
              <span>
                Rx Tower: <strong>{rxTowerH}m</strong> @ {rxSite} ({rxGroundElev}m ASL)
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
              {/* Grid Lines */}
              <line
                x1={padLeft}
                y1={padTop}
                x2={padLeft}
                y2={padTop + plotH}
                stroke="var(--color-border-muted)"
                strokeWidth="1"
              />
              <line
                x1={padLeft}
                y1={padTop + plotH}
                x2={padLeft + plotW}
                y2={padTop + plotH}
                stroke="var(--color-border-muted)"
                strokeWidth="1"
              />

              {/* Axis labels */}
              <text x={padLeft} y={padTop + plotH + 20} fontSize="10" fill="var(--color-fg-muted)">
                0 km
              </text>
              <text
                x={padLeft + plotW / 2}
                y={padTop + plotH + 20}
                fontSize="10"
                textAnchor="middle"
                fill="var(--color-fg-muted)"
              >
                {(pathKm / 2).toFixed(1)} km
              </text>
              <text
                x={padLeft + plotW}
                y={padTop + plotH + 20}
                fontSize="10"
                textAnchor="end"
                fill="var(--color-fg-muted)"
              >
                {pathKm.toFixed(1)} km
              </text>

              <text x={padLeft - 8} y={padTop + 10} fontSize="10" textAnchor="end" fill="var(--color-fg-muted)">
                {Math.round(maxElev)}m
              </text>
              <text x={padLeft - 8} y={padTop + plotH} fontSize="10" textAnchor="end" fill="var(--color-fg-muted)">
                {Math.round(minElev)}m
              </text>

              {/* Terrain area */}
              <path d={terrainPath} fill="var(--color-canvas-inset, #e1e4e8)" stroke="#6e7781" strokeWidth="1.5" />

              {/* 1st Fresnel Zone Ellipse Boundary */}
              <path d={f1UpperPath} fill="none" stroke="#2da44e" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
              <path d={f1LowerPath} fill="none" stroke="#2da44e" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />

              {/* 60% Fresnel Zone Clearance Boundary */}
              <path d={f60LowerPath} fill="none" stroke="#0969da" strokeWidth="1.5" strokeDasharray="4 2" />

              {/* Direct Line of Sight (LOS) Ray */}
              <path d={losPath} fill="none" stroke="#cf222e" strokeWidth="2" />

              {/* Tx & Rx Antenna Towers */}
              <line
                x1={scaleX(0)}
                y1={scaleY(txGroundElev)}
                x2={scaleX(0)}
                y2={scaleY(txGroundElev + txTowerH)}
                stroke="#1f2328"
                strokeWidth="3"
              />
              <circle cx={scaleX(0)} cy={scaleY(txGroundElev + txTowerH)} r="4" fill="#cf222e" />

              <line
                x1={scaleX(pathKm)}
                y1={scaleY(rxGroundElev)}
                x2={scaleX(pathKm)}
                y2={scaleY(rxGroundElev + rxTowerH)}
                stroke="#1f2328"
                strokeWidth="3"
              />
              <circle cx={scaleX(pathKm)} cy={scaleY(rxGroundElev + rxTowerH)} r="4" fill="#cf222e" />

              {/* Obstacle markers */}
              {profileData.obstacleAudits.map((obs) => {
                const x = scaleX(obs.distanceKm);
                const yTop = scaleY(obs.effectiveTopElevMeters);
                return (
                  <g key={obs.distanceKm}>
                    <line
                      x1={x}
                      y1={scaleY(obs.groundElevationMeters + obs.earthBulgeMeters)}
                      x2={x}
                      y2={yTop}
                      stroke="#8c1b1b"
                      strokeWidth="3"
                    />
                    <circle cx={x} cy={yTop} r="3" fill={obs.isAdequate ? "#1a7f37" : "#cf222e"} />
                    <text
                      x={x}
                      y={yTop - 6}
                      fontSize="9"
                      textAnchor="middle"
                      fill="var(--color-fg-default)"
                      fontWeight="600"
                    >
                      {obs.clearanceRatioPercent}% F1
                    </text>
                  </g>
                );
              })}
            </svg>

            <div
              style={{
                display: "flex",
                gap: "16px",
                fontSize: "11px",
                color: "var(--color-fg-muted)",
                alignItems: "center",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 12, height: 2, background: "#cf222e", display: "inline-block" }} /> Line of Sight
                (LOS)
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 12, height: 2, background: "#0969da", display: "inline-block" }} /> 60% F1
                Clearance Limit
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 12, height: 2, background: "#2da44e", display: "inline-block" }} /> 100% F1
                Boundary
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span
                  style={{
                    width: 12,
                    height: 10,
                    background: "var(--color-canvas-inset, #e1e4e8)",
                    border: "1px solid #6e7781",
                    display: "inline-block",
                  }}
                />{" "}
                Terrain + Earth Bulge (k=4/3)
              </span>
            </div>
          </Box>
        )}

        {activeTab === "obstacles" && (
          <Box display="flex" flexDirection="column" gap={12}>
            <Table>
              <thead>
                <tr>
                  <th>Obstacle</th>
                  <th>Distance</th>
                  <th>Ground Elev</th>
                  <th>Height</th>
                  <th>Earth Bulge</th>
                  <th>LOS Elev</th>
                  <th>Clearance</th>
                  <th>Ratio (% F1)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {profileData.obstacleAudits.map((obs) => (
                  <tr key={obs.distanceKm}>
                    <td>{obs.name ?? "Obstacle"}</td>
                    <td>{obs.distanceKm.toFixed(1)} km</td>
                    <td>{obs.groundElevationMeters} m</td>
                    <td>{obs.obstacleHeightMeters ?? 0} m</td>
                    <td>+{obs.earthBulgeMeters} m</td>
                    <td>{obs.losElevMeters} m</td>
                    <td>{obs.clearanceMeters} m</td>
                    <td>
                      <span
                        style={{
                          fontWeight: 600,
                          color: obs.isAdequate
                            ? "var(--color-success-fg, #1a7f37)"
                            : "var(--color-danger-fg, #cf222e)",
                        }}
                      >
                        {obs.clearanceRatioPercent}% F1
                      </span>
                    </td>
                    <td>{obs.isAdequate ? "✓ Adequate" : "⚠ Inadequate (<60%)"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Box>
        )}

        {activeTab === "budget" && (
          <Box display="flex" flexDirection="column" gap={16}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
              <StatCard>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Carrier Frequency</span>
                <span style={{ fontSize: "20px", fontWeight: 700 }}>{freqGhz} GHz</span>
              </StatCard>
              <StatCard>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Path Length</span>
                <span style={{ fontSize: "20px", fontWeight: 700 }}>{pathKm} km</span>
              </StatCard>
              <StatCard>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Worst Clearance</span>
                <span
                  style={{
                    fontSize: "20px",
                    fontWeight: 700,
                    color: profileData.isFullyClear
                      ? "var(--color-success-fg, #1a7f37)"
                      : "var(--color-danger-fg, #cf222e)",
                  }}
                >
                  {profileData.minClearancePercent}% F1
                </span>
              </StatCard>
              <StatCard>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Annual Availability</span>
                <span style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-success-fg, #1a7f37)" }}>
                  {(viewConfig.annualAvailabilityPercent ?? 99.9992).toFixed(4)}%
                </span>
              </StatCard>
            </div>
          </Box>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default MicrowaveProfileViewer;
