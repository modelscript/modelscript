// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, PulseIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import styled from "styled-components";
import Box from "../Box";

export interface Easy5ViewerProps {
  viewConfig: {
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    modelName?: string | undefined;
    stateCount?: number | undefined;
    inputCount?: number | undefined;
    outputCount?: number | undefined;
    gainMarginDb?: number | undefined;
    phaseMarginDeg?: number | undefined;
    bodeData?: { freq: number; magnitudeDb: number; phaseDeg: number }[] | undefined;
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
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.35);
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

export const Easy5Viewer: React.FC<Easy5ViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"diagram" | "bode">("diagram");
  const title = viewConfig.title || viewConfig.modelName || "EASY5 Control Model (.ez5)";

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
        .catch((err) => console.warn("[Easy5Viewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    // High-contrast clean control block diagram schematic
    return DOMPurify.sanitize(`
      <svg viewBox="0 0 650 340" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="650" height="340" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
        
        <!-- Summing Junction -->
        <circle cx="100" cy="170" r="16" fill="#1e293b" stroke="#f59e0b" stroke-width="2" />
        <text x="100" y="174" fill="#fbbf24" font-size="14" font-family="sans-serif" text-anchor="middle" font-weight="bold">∑</text>

        <!-- Controller Block (PID) -->
        <rect x="180" y="140" width="90" height="60" rx="6" fill="#172554" stroke="#3b82f6" stroke-width="2" />
        <text x="225" y="168" fill="#93c5fd" font-size="12" font-family="sans-serif" text-anchor="middle" font-weight="bold">PID (K_p)</text>
        <text x="225" y="185" fill="#60a5fa" font-size="10" font-family="monospace" text-anchor="middle">Controller</text>

        <!-- Plant Dynamic System Block -->
        <rect x="340" y="140" width="110" height="60" rx="6" fill="#064e3b" stroke="#10b981" stroke-width="2" />
        <text x="395" y="168" fill="#6ee7b7" font-size="12" font-family="sans-serif" text-anchor="middle" font-weight="bold">G(s) Plant</text>
        <text x="395" y="185" fill="#34d399" font-size="10" font-family="monospace" text-anchor="middle">2nd-Order Sys</text>

        <!-- Feedback Loop & Arrows -->
        <g stroke="#94a3b8" stroke-width="2" fill="none">
          <line x1="40" y1="170" x2="84" y2="170" marker-end="url(#arrow)" />
          <line x1="116" y1="170" x2="180" y2="170" />
          <line x1="270" y1="170" x2="340" y2="170" />
          <line x1="450" y1="170" x2="560" y2="170" />
          <!-- Feedback branch -->
          <line x1="500" y1="170" x2="500" y2="250" />
          <line x1="500" y1="250" x2="100" y2="250" />
          <line x1="100" y1="250" x2="100" y2="186" />
        </g>

        <!-- Sensor Block in feedback -->
        <rect x="250" y="230" width="80" height="40" rx="4" fill="#312e81" stroke="#818cf8" stroke-width="1.5" />
        <text x="290" y="255" fill="#c7d2fe" font-size="10" font-family="sans-serif" text-anchor="middle">H(s) Sensor</text>

        <text x="40" y="155" fill="#cbd5e1" font-size="11" font-family="sans-serif">r(t)</text>
        <text x="540" y="155" fill="#cbd5e1" font-size="11" font-family="sans-serif">y(t)</text>
      </svg>
    `);
  }, [viewConfig.svg]);

  const defaultBodeData = useMemo(() => {
    if (viewConfig.bodeData && Array.isArray(viewConfig.bodeData)) {
      return viewConfig.bodeData;
    }
    const points = [];
    for (let f = 0.1; f <= 100; f *= 1.25) {
      // 2nd order lowpass filter response
      const wn = 5.0; // rad/s
      const zeta = 0.4;
      const w = 2 * Math.PI * f;
      const mag = 1.0 / Math.sqrt(Math.pow(1 - Math.pow(w / wn, 2), 2) + Math.pow(2 * zeta * (w / wn), 2));
      const magDb = 20 * Math.log10(mag);
      const phase = (-Math.atan2(2 * zeta * (w / wn), 1 - Math.pow(w / wn, 2)) * 180) / Math.PI;

      points.push({
        freq: Number(f.toFixed(2)),
        magnitudeDb: Number(magDb.toFixed(1)),
        phaseDeg: Number((phase < -180 ? phase + 360 : phase).toFixed(1)),
      });
    }
    return points;
  }, [viewConfig.bodeData]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PulseIcon size={16} fill="#fbbf24" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>EASY5 Dynamic Control</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={3}>
          <SegmentedControl size="small" aria-label="Easy5 View Selector">
            <SegmentedControl.Button selected={viewMode === "diagram"} onClick={() => setViewMode("diagram")}>
              Block Diagram
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={viewMode === "bode"} onClick={() => setViewMode("bode")}>
              Bode Response
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
        ) : viewMode === "diagram" ? (
          <SvgCanvas dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />
        ) : (
          <ChartCanvas>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={defaultBodeData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                <XAxis dataKey="freq" stroke="#8b949e" tick={{ fontSize: 11 }} scale="log" unit="Hz" />
                <YAxis stroke="#8b949e" tick={{ fontSize: 11 }} />
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
                  dataKey="magnitudeDb"
                  stroke="#38bdf8"
                  dot={false}
                  strokeWidth={2}
                  name="Magnitude (dB)"
                />
                <Line
                  type="monotone"
                  dataKey="phaseDeg"
                  stroke="#ec4899"
                  dot={false}
                  strokeWidth={2}
                  name="Phase (deg)"
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCanvas>
        )}

        <InspectorSidebar>
          <Text fontWeight="bold" fontSize="12px" color="var(--color-fg-default)">
            Linear System Metrics
          </Text>
          <StatItem>
            <span>States (n)</span>
            <strong>{viewConfig.stateCount ?? 4}</strong>
          </StatItem>
          <StatItem>
            <span>Inputs (m)</span>
            <strong>{viewConfig.inputCount ?? 1}</strong>
          </StatItem>
          <StatItem>
            <span>Outputs (p)</span>
            <strong>{viewConfig.outputCount ?? 1}</strong>
          </StatItem>
          <StatItem>
            <span>Gain Margin</span>
            <strong style={{ color: "#34d399" }}>
              {viewConfig.gainMarginDb ? `${viewConfig.gainMarginDb} dB` : "14.2 dB"}
            </strong>
          </StatItem>
          <StatItem>
            <span>Phase Margin</span>
            <strong style={{ color: "#34d399" }}>
              {viewConfig.phaseMarginDeg ? `${viewConfig.phaseMarginDeg}°` : "52.4°"}
            </strong>
          </StatItem>
          <StatItem>
            <span>Stability</span>
            <strong style={{ color: "#34d399" }}>Asymptotically Stable</strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default Easy5Viewer;
