// SPDX-License-Identifier: AGPL-3.0-or-later

import { FlameIcon, PlayIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";

export interface RocetsViewerProps {
  viewConfig: {
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    engineName?: string | undefined;
    cycleType?: string | undefined;
    chamberPressureBar?: number | undefined;
    thrustKn?: number | undefined;
    ispSec?: number | undefined;
    massFlowKgSec?: number | undefined;
    turbopumpRpm?: number | undefined;
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
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.35);
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

export const RocetsViewer: React.FC<RocetsViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const title = viewConfig.title || viewConfig.engineName || "ROCETS Liquid Propulsion (.roc)";

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
        .catch((err) => console.warn("[RocetsViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    // High-contrast clean liquid rocket engine P&ID schematic
    return DOMPurify.sanitize(`
      <svg viewBox="0 0 650 360" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="650" height="360" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
        
        <!-- LOX Tank -->
        <rect x="80" y="30" width="80" height="60" rx="8" fill="#1e3a8a" stroke="#60a5fa" stroke-width="1.5" />
        <text x="120" y="65" fill="#93c5fd" font-size="11" font-family="sans-serif" text-anchor="middle" font-weight="bold">LOX Tank</text>

        <!-- LH2/CH4 Tank -->
        <rect x="220" y="30" width="80" height="60" rx="8" fill="#701a75" stroke="#e879f9" stroke-width="1.5" />
        <text x="260" y="65" fill="#f5d0fe" font-size="11" font-family="sans-serif" text-anchor="middle" font-weight="bold">Fuel Tank</text>

        <!-- Turbopump Assembly -->
        <circle cx="120" cy="150" r="18" fill="#1e293b" stroke="#38bdf8" stroke-width="2" />
        <text x="120" y="154" fill="#38bdf8" font-size="10" font-family="monospace" text-anchor="middle">LOX-P</text>

        <circle cx="260" cy="150" r="18" fill="#1e293b" stroke="#f472b6" stroke-width="2" />
        <text x="260" y="154" fill="#f472b6" font-size="10" font-family="monospace" text-anchor="middle">Fuel-P</text>

        <rect x="160" y="140" width="60" height="20" fill="#334155" stroke="#94a3b8" />
        <text x="190" y="154" fill="#ffffff" font-size="9" font-family="sans-serif" text-anchor="middle">Turbine</text>

        <!-- Propellant lines -->
        <g stroke="#94a3b8" stroke-width="2" fill="none">
          <line x1="120" y1="90" x2="120" y2="132" />
          <line x1="260" y1="90" x2="260" y2="132" />
          <!-- Regenerative cooling feed -->
          <line x1="260" y1="168" x2="260" y2="220" />
          <line x1="260" y1="220" x2="420" y2="220" />
          <line x1="120" y1="168" x2="120" y2="240" />
          <line x1="120" y1="240" x2="380" y2="240" />
        </g>

        <!-- Combustion Chamber & De Laval Nozzle -->
        <path d="M 400 150 L 460 150 L 480 180 L 475 190 L 530 270 L 370 270 L 425 190 L 420 180 Z"
              fill="#18181b" stroke="#ef4444" stroke-width="2.5" />
        
        <text x="450" y="170" fill="#fca5a5" font-size="11" font-family="sans-serif" text-anchor="middle" font-weight="bold">Main Chamber</text>
        <text x="450" y="240" fill="#f87171" font-size="10" font-family="monospace" text-anchor="middle">Nozzle (ε = 60)</text>

        <!-- Exhaust plume -->
        <polygon points="450,270 410,340 490,340" fill="url(#exhaustGrad)" opacity="0.75" />

        <defs>
          <linearGradient id="exhaustGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ef4444" />
            <stop offset="50%" stop-color="#f59e0b" />
            <stop offset="100%" stop-color="#0284c7" stop-opacity="0" />
          </linearGradient>
        </defs>
      </svg>
    `);
  }, [viewConfig.svg]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <FlameIcon size={16} fill="#f87171" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>ROCETS Propulsion</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={3}>
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
        ) : (
          <SvgCanvas dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />
        )}

        <InspectorSidebar>
          <Text fontWeight="bold" fontSize="12px" color="var(--color-fg-default)">
            Propulsion Power Balance
          </Text>
          <StatItem>
            <span>Engine Cycle</span>
            <strong style={{ color: "#38bdf8" }}>{viewConfig.cycleType || "Gas Generator (GG)"}</strong>
          </StatItem>
          <StatItem>
            <span>Sea-Level Thrust</span>
            <strong>{viewConfig.thrustKn ? `${viewConfig.thrustKn} kN` : "845 kN"}</strong>
          </StatItem>
          <StatItem>
            <span>Chamber Pressure</span>
            <strong>{viewConfig.chamberPressureBar ? `${viewConfig.chamberPressureBar} bar` : "105.0 bar"}</strong>
          </StatItem>
          <StatItem>
            <span>Specific Impulse</span>
            <strong>{viewConfig.ispSec ? `${viewConfig.ispSec} s` : "312 s (vac)"}</strong>
          </StatItem>
          <StatItem>
            <span>Propellant Flow</span>
            <strong>{viewConfig.massFlowKgSec ? `${viewConfig.massFlowKgSec} kg/s` : "274 kg/s"}</strong>
          </StatItem>
          <StatItem>
            <span>Turbopump RPM</span>
            <strong>
              {viewConfig.turbopumpRpm ? `${viewConfig.turbopumpRpm.toLocaleString()} RPM` : "36,000 RPM"}
            </strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default RocetsViewer;
