// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, PulseIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";

export interface PipelineLpsViewerProps {
  viewConfig: {
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    networkName?: string | undefined;
    linePackMm3?: number | undefined;
    maopBar?: number | undefined;
    inletPressureBar?: number | undefined;
    outletPressureBar?: number | undefined;
    throughputMmsm3d?: number | undefined;
    compressorCount?: number | undefined;
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
  background: rgba(14, 165, 233, 0.15);
  color: #38bdf8;
  border: 1px solid rgba(14, 165, 233, 0.35);
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

export const PipelineLpsViewer: React.FC<PipelineLpsViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const title = viewConfig.title || viewConfig.networkName || "PipelineStudio Network (.lps)";

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
        .catch((err) => console.warn("[PipelineLpsViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    // High-contrast clean gas transmission network schematic
    return DOMPurify.sanitize(`
      <svg viewBox="0 0 650 340" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="650" height="340" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
        
        <!-- Supply Wellhead -->
        <circle cx="80" cy="170" r="16" fill="#0284c7" stroke="#38bdf8" stroke-width="2" />
        <text x="80" y="174" fill="#ffffff" font-size="9" font-family="sans-serif" text-anchor="middle" font-weight="bold">SUPPLY</text>

        <!-- Main Trunkline Pipes -->
        <g stroke="#38bdf8" stroke-width="3" fill="none">
          <line x1="96" y1="170" x2="220" y2="170" />
          <line x1="280" y1="170" x2="420" y2="170" />
          <line x1="420" y1="170" x2="540" y2="120" />
          <line x1="420" y1="170" x2="540" y2="220" />
        </g>

        <!-- Compressor Station 1 -->
        <polygon points="220,150 280,170 220,190" fill="#1e293b" stroke="#f59e0b" stroke-width="2" />
        <text x="240" y="174" fill="#fbbf24" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">CS-1</text>
        <text x="250" y="210" fill="#fde68a" font-size="9" font-family="monospace" text-anchor="middle">Ratio: 1.42</text>

        <!-- Flow arrows -->
        <polygon points="160,165 170,170 160,175" fill="#38bdf8" />
        <polygon points="350,165 360,170 350,175" fill="#38bdf8" />

        <!-- Offtake City Gate 1 -->
        <rect x="540" y="100" width="70" height="40" rx="4" fill="#064e3b" stroke="#10b981" stroke-width="1.5" />
        <text x="575" y="125" fill="#6ee7b7" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">City Gate A</text>

        <!-- Industrial Customer 2 -->
        <rect x="540" y="200" width="70" height="40" rx="4" fill="#312e81" stroke="#818cf8" stroke-width="1.5" />
        <text x="575" y="225" fill="#c7d2fe" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">Power Plant</text>

        <text x="325" y="40" fill="#f0f6fc" font-size="13" font-weight="bold" font-family="sans-serif" text-anchor="middle">Trunkline Hydraulic Gradient</text>
        <text x="325" y="60" fill="#64748b" font-size="10" font-family="monospace" text-anchor="middle">Steady-State Gas Network Model</text>
      </svg>
    `);
  }, [viewConfig.svg]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PulseIcon size={16} fill="#38bdf8" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>PipelineStudio (LPS)</PillBadge>
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
            Hydraulic Network Telemetry
          </Text>
          <StatItem>
            <span>Line Pack Inventory</span>
            <strong>{viewConfig.linePackMm3 ? `${viewConfig.linePackMm3} Mm³` : "14.8 Mm³"}</strong>
          </StatItem>
          <StatItem>
            <span>MAOP Limit</span>
            <strong>{viewConfig.maopBar ? `${viewConfig.maopBar} bar` : "84.0 bar"}</strong>
          </StatItem>
          <StatItem>
            <span>Inlet Pressure</span>
            <strong>{viewConfig.inletPressureBar ? `${viewConfig.inletPressureBar} bar` : "76.2 bar"}</strong>
          </StatItem>
          <StatItem>
            <span>Outlet Delivery</span>
            <strong>{viewConfig.outletPressureBar ? `${viewConfig.outletPressureBar} bar` : "48.5 bar"}</strong>
          </StatItem>
          <StatItem>
            <span>Throughput Rate</span>
            <strong>{viewConfig.throughputMmsm3d ? `${viewConfig.throughputMmsm3d} MSm³/d` : "22.4 MSm³/d"}</strong>
          </StatItem>
          <StatItem>
            <span>Compressor Units</span>
            <strong style={{ color: "#34d399" }}>{viewConfig.compressorCount ?? 2} Running</strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default PipelineLpsViewer;
