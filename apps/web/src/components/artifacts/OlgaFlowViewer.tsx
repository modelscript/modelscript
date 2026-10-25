// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, CheckCircleIcon, PlayIcon, PulseIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";

export interface OlgaFlowViewerProps {
  viewConfig: {
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    pipelineName?: string | undefined;
    lengthKm?: number | undefined;
    diameterInches?: number | undefined;
    pressureDropBar?: number | undefined;
    liquidHoldupAvg?: number | undefined;
    slugRisk?: "low" | "medium" | "high" | undefined;
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

const PillBadge = styled.span<{ $variant?: "olga" | "slug-low" | "slug-warn" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;

  ${(props) => {
    switch (props.$variant) {
      case "slug-low":
        return `
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.35);
        `;
      case "slug-warn":
        return `
          background: rgba(245, 158, 11, 0.15);
          color: #fbbf24;
          border: 1px solid rgba(245, 158, 11, 0.35);
        `;
      default:
        return `
          background: rgba(236, 72, 153, 0.15);
          color: #f472b6;
          border: 1px solid rgba(236, 72, 153, 0.35);
        `;
    }
  }}
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

export const OlgaFlowViewer: React.FC<OlgaFlowViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const title = viewConfig.title || viewConfig.pipelineName || "OLGA Flow Assurance (.opi)";

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
        .catch((err) => console.warn("[OlgaFlowViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    // High-contrast clean seabed elevation profile with sea water line and slugging risk
    return DOMPurify.sanitize(`
      <svg viewBox="0 0 700 360" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="700" height="360" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
        
        <!-- Water Line -->
        <line x1="50" y1="80" x2="650" y2="80" stroke="#0284c7" stroke-width="1.5" stroke-dasharray="8 4" opacity="0.6" />
        <text x="60" y="74" fill="#38bdf8" font-size="10" font-family="sans-serif">Sea Level (0m)</text>

        <!-- Pipeline Terrain / Seabed Profile -->
        <path d="M 60 110 L 140 180 L 260 250 L 380 220 L 500 280 L 580 160 L 640 120"
              fill="none" stroke="#f472b6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />

        <!-- Liquid Holdup Gradient fill under pipeline -->
        <path d="M 60 110 L 140 180 L 260 250 L 380 220 L 500 280 L 580 160 L 640 120 L 640 320 L 60 320 Z"
              fill="url(#seabedGrad)" opacity="0.15" />

        <defs>
          <linearGradient id="seabedGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f472b6" />
            <stop offset="100%" stop-color="#0284c7" />
          </linearGradient>
        </defs>

        <!-- Elevation Markers -->
        <circle cx="60" cy="110" r="6" fill="#38bdf8" />
        <text x="60" y="135" fill="#94a3b8" font-size="10" font-family="sans-serif" text-anchor="middle">Platform (-40m)</text>

        <circle cx="260" cy="250" r="6" fill="#f43f5e" />
        <text x="260" y="275" fill="#fda4af" font-size="10" font-family="sans-serif" text-anchor="middle">Low Point (-320m)</text>
        <text x="260" y="290" fill="#f43f5e" font-size="9" font-family="sans-serif" text-anchor="middle">Liquid Holdup: 72%</text>

        <circle cx="500" cy="280" r="6" fill="#fbbf24" />
        <text x="500" y="305" fill="#fde68a" font-size="10" font-family="sans-serif" text-anchor="middle">Riser Base (-360m)</text>

        <circle cx="640" cy="120" r="6" fill="#34d399" />
        <text x="640" y="145" fill="#a7f3d0" font-size="10" font-family="sans-serif" text-anchor="middle">FPSO Riser</text>

        <!-- Axis Labels -->
        <line x1="50" y1="320" x2="650" y2="320" stroke="#334155" stroke-width="1.5" />
        <text x="350" y="345" fill="#64748b" font-size="11" font-family="monospace" text-anchor="middle">Pipeline Chainage (0 - 42.5 km)</text>
      </svg>
    `);
  }, [viewConfig.svg]);

  const slugRisk = viewConfig.slugRisk || "low";

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PulseIcon size={16} fill="#f472b6" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>OLGA Multiphase</PillBadge>
          <PillBadge $variant={slugRisk === "low" ? "slug-low" : "slug-warn"}>
            {slugRisk === "low" ? <CheckCircleIcon size={12} /> : <AlertIcon size={12} />}
            Slugging Risk: {slugRisk.toUpperCase()}
          </PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={3}>
          <Button
            size="small"
            leadingVisual={PlayIcon}
            onClick={() => navigate(`/ide?source=${encodeURIComponent(rawText)}&title=${encodeURIComponent(title)}`)}
          >
            Open in Flow Editor
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
            Flow Assurance Telemetry
          </Text>
          <StatItem>
            <span>Total Length</span>
            <strong>{viewConfig.lengthKm ? `${viewConfig.lengthKm} km` : "42.5 km"}</strong>
          </StatItem>
          <StatItem>
            <span>Nominal Diameter</span>
            <strong>{viewConfig.diameterInches ? `${viewConfig.diameterInches}"` : '16"'}</strong>
          </StatItem>
          <StatItem>
            <span>Pressure Drop (ΔP)</span>
            <strong>{viewConfig.pressureDropBar ? `${viewConfig.pressureDropBar} bar` : "18.4 bar"}</strong>
          </StatItem>
          <StatItem>
            <span>Avg Liquid Holdup</span>
            <strong>
              {viewConfig.liquidHoldupAvg ? `${(viewConfig.liquidHoldupAvg * 100).toFixed(1)}%` : "34.2%"}
            </strong>
          </StatItem>
          <StatItem>
            <span>Flow Regime</span>
            <strong style={{ color: "#38bdf8" }}>Stratified Wavy</strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default OlgaFlowViewer;
