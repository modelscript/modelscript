// SPDX-License-Identifier: AGPL-3.0-or-later

import { FlameIcon, PlayIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import styled from "styled-components";
import Box from "../Box";

export interface GtSuiteViewerProps {
  viewConfig: {
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    engineModel?: string | undefined;
    displacementLiters?: number | undefined;
    cylinderCount?: number | undefined;
    peakPressureBar?: number | undefined;
    imepBar?: number | undefined;
    thermalEfficiencyPct?: number | undefined;
    pvData?: { volumeCc: number; pressureBar: number }[] | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: var(--color-canvas-default, #0d1117);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 44px;
  min-height: 44px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const ModelTitle = styled.div`
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-heading, #f0f6fc);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PillBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;
  background: rgba(249, 115, 22, 0.15);
  color: #fb923c;
  border: 1px solid rgba(249, 115, 22, 0.35);
`;

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
`;

const SvgCanvas = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 16px;
  background: var(--color-canvas-inset, #010409);

  svg {
    max-width: 100%;
    max-height: 100%;
    height: auto;
  }
`;

const ChartCanvas = styled.div`
  flex: 1;
  padding: 16px;
  background: var(--color-canvas-inset, #010409);
`;

const InspectorSidebar = styled.div`
  width: 250px;
  border-left: 1px solid var(--color-border-default, #30363d);
  background: var(--color-canvas-subtle, #161b22);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 14px;
  gap: 12px;
`;

const StatItem = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--color-fg-muted, #8b949e);

  strong {
    color: var(--color-fg-default, #c9d1d9);
  }
`;

export const GtSuiteViewer: React.FC<GtSuiteViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"schematic" | "pv">("schematic");
  const title = viewConfig.title || viewConfig.engineModel || "GT-SUITE Powertrain (.gtm)";

  useEffect(() => {
    if (viewConfig.code) {
      setRawText(viewConfig.code);
      return;
    }
    if (viewConfig.url) {
      setLoading(true);
      const targetUrl =
        viewConfig.url.startsWith("http") || viewConfig.url.startsWith("/api")
          ? viewConfig.url
          : `/api${viewConfig.url}`;
      fetch(targetUrl)
        .then((r) => r.text())
        .then((txt) => setRawText(txt))
        .catch((err) => console.warn("[GtSuiteViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    // High-contrast clean internal combustion engine schematic
    return DOMPurify.sanitize(`
      <svg viewBox="0 0 650 340" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="650" height="340" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
        
        <!-- Intake Runner -->
        <path d="M 60 120 L 200 120 L 240 160" stroke="#38bdf8" stroke-width="3" fill="none" />
        <rect x="100" y="105" width="50" height="30" rx="4" fill="#0c4a6e" stroke="#38bdf8" stroke-width="1.5" />
        <text x="125" y="124" fill="#bae6fd" font-size="9" font-family="sans-serif" text-anchor="middle">Airbox</text>

        <!-- Engine Cylinder -->
        <rect x="220" y="140" width="120" height="150" rx="6" fill="#1e293b" stroke="#f97316" stroke-width="2" />
        <text x="280" y="165" fill="#fdba74" font-size="11" font-family="sans-serif" text-anchor="middle" font-weight="bold">Cylinder #1</text>

        <!-- Piston -->
        <rect x="235" y="210" width="90" height="40" rx="3" fill="#334155" stroke="#94a3b8" />
        <line x1="280" y1="250" x2="280" y2="300" stroke="#64748b" stroke-width="3" />

        <!-- Spark/Combustion Flame symbol -->
        <circle cx="280" cy="185" r="8" fill="#ef4444" />
        <circle cx="280" cy="185" r="4" fill="#fbbf24" />

        <!-- Exhaust Runner -->
        <path d="M 320 160 L 360 120 L 520 120" stroke="#f43f5e" stroke-width="3" fill="none" />
        
        <!-- Turbocharger -->
        <circle cx="440" cy="120" r="16" fill="#1e293b" stroke="#f59e0b" stroke-width="2" />
        <text x="440" y="124" fill="#fbbf24" font-size="9" font-family="sans-serif" text-anchor="middle">TURBO</text>

        <text x="325" y="40" fill="#f0f6fc" font-size="13" font-weight="bold" font-family="sans-serif" text-anchor="middle">GT-POWER 1D Gas Dynamics Engine</text>
        <text x="325" y="60" fill="#64748b" font-size="10" font-family="monospace" text-anchor="middle">Crank-Angle Resolved Intake/Exhaust Network</text>
      </svg>
    `);
  }, [viewConfig.svg]);

  const defaultPvData = useMemo(() => {
    if (viewConfig.pvData && Array.isArray(viewConfig.pvData)) {
      return viewConfig.pvData;
    }
    // High-fidelity closed Otto/Diesel 4-stroke P-V indicator diagram
    const points = [];
    const vClearance = 50; // cc
    const vSwept = 450; // cc
    const gamma = 1.35;

    // Compression stroke
    for (let v = vClearance + vSwept; v >= vClearance; v -= 25) {
      const p = 1.0 * Math.pow((vClearance + vSwept) / v, gamma);
      points.push({ volumeCc: v, pressureBar: Number(p.toFixed(1)) });
    }
    // Combustion pressure spike at TDC
    points.push({ volumeCc: vClearance, pressureBar: viewConfig.peakPressureBar ?? 142.0 });

    // Expansion / power stroke
    for (let v = vClearance; v <= vClearance + vSwept; v += 25) {
      const p = (viewConfig.peakPressureBar ?? 142.0) * Math.pow(vClearance / v, gamma);
      points.push({ volumeCc: v, pressureBar: Number(p.toFixed(1)) });
    }
    return points;
  }, [viewConfig.pvData, viewConfig.peakPressureBar]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <FlameIcon size={16} fill="#fb923c" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>GT-SUITE Powertrain</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={3}>
          <SegmentedControl size="small" aria-label="GT-SUITE View Selector">
            <SegmentedControl.Button selected={viewMode === "schematic"} onClick={() => setViewMode("schematic")}>
              Schematic
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={viewMode === "pv"} onClick={() => setViewMode("pv")}>
              P-V Diagram
            </SegmentedControl.Button>
          </SegmentedControl>

          <Button
            size="small"
            leadingVisual={PlayIcon}
            onClick={() => navigate(`/ide?source=${encodeURIComponent(rawText)}&title=${encodeURIComponent(title)}`)}
          >
            Open in Studio
          </Button>
        </Box>
      </Toolbar>

      <ContentArea>
        {loading ? (
          <Box flex={1} display="flex" justifyContent="center" alignItems="center">
            <Spinner size="medium" />
          </Box>
        ) : viewMode === "schematic" ? (
          <SvgCanvas dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />
        ) : (
          <ChartCanvas>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={defaultPvData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                <XAxis dataKey="volumeCc" stroke="#8b949e" tick={{ fontSize: 11 }} unit="cc" name="Cylinder Volume" />
                <YAxis stroke="#8b949e" tick={{ fontSize: 11 }} unit="bar" name="Pressure" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#161b22",
                    borderColor: "#30363d",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Line
                  type="monotone"
                  dataKey="pressureBar"
                  stroke="#fb923c"
                  dot={false}
                  strokeWidth={2.2}
                  name="In-Cylinder Pressure (bar)"
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCanvas>
        )}

        <InspectorSidebar>
          <Text fontWeight="bold" fontSize="12px" color="var(--color-fg-default)">
            Engine Calibration Telemetry
          </Text>
          <StatItem>
            <span>Displacement</span>
            <strong>{viewConfig.displacementLiters ? `${viewConfig.displacementLiters} L` : "2.0 L Turbo"}</strong>
          </StatItem>
          <StatItem>
            <span>Cylinder Count</span>
            <strong>{viewConfig.cylinderCount ?? 4} (Inline-4)</strong>
          </StatItem>
          <StatItem>
            <span>Peak Pressure (P_max)</span>
            <strong style={{ color: "#f87171" }}>
              {viewConfig.peakPressureBar ? `${viewConfig.peakPressureBar} bar` : "142.0 bar"}
            </strong>
          </StatItem>
          <StatItem>
            <span>IMEP</span>
            <strong>{viewConfig.imepBar ? `${viewConfig.imepBar} bar` : "18.6 bar"}</strong>
          </StatItem>
          <StatItem>
            <span>Brake Thermal Eff</span>
            <strong style={{ color: "#34d399" }}>
              {viewConfig.thermalEfficiencyPct ? `${viewConfig.thermalEfficiencyPct}%` : "39.4%"}
            </strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default GtSuiteViewer;
