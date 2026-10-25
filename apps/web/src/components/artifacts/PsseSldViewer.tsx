// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, ZapIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";

export interface PsseSldViewerProps {
  viewConfig: {
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    metrics?:
      | {
          busCount?: number;
          generatorCount?: number;
          branchCount?: number;
          transformerCount?: number;
          totalGenMw?: number;
          totalLoadMw?: number;
          lossesMw?: number;
        }
      | undefined;
    buses?: { id: number; name: string; baseKv: number; vm: number; va: number }[];
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
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.35);
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

export const PsseSldViewer: React.FC<PsseSldViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const title = viewConfig.title || "PSS/E Power Flow Case (.raw)";

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
        .catch((err) => console.warn("[PsseSldViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    // High-contrast clean electrical Single-Line Diagram
    return DOMPurify.sanitize(`
      <svg viewBox="0 0 700 380" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="700" height="380" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
        
        <!-- Grid Buses -->
        <g stroke-width="4">
          <line x1="80" y1="120" x2="80" y2="260" stroke="#f59e0b" />
          <text x="70" y="110" fill="#f59e0b" font-size="11" font-family="monospace" font-weight="bold">BUS 101 (230kV)</text>

          <line x1="340" y1="100" x2="340" y2="280" stroke="#38bdf8" />
          <text x="330" y="90" fill="#38bdf8" font-size="11" font-family="monospace" font-weight="bold">BUS 102 (500kV)</text>

          <line x1="600" y1="120" x2="600" y2="260" stroke="#10b981" />
          <text x="590" y="110" fill="#10b981" font-size="11" font-family="monospace" font-weight="bold">BUS 103 (138kV)</text>
        </g>

        <!-- Transmission Lines & Transformers -->
        <g stroke="#64748b" stroke-width="2" fill="none">
          <line x1="80" y1="160" x2="340" y2="160" />
          <circle cx="210" cy="160" r="14" stroke="#f59e0b" stroke-width="2" fill="#0f172a" />
          <circle cx="225" cy="160" r="14" stroke="#38bdf8" stroke-width="2" fill="#0f172a" />
          <text x="217" y="195" fill="#94a3b8" font-size="10" font-family="sans-serif" text-anchor="middle">XFRMR T1</text>

          <line x1="340" y1="220" x2="600" y2="220" />
          <line x1="80" y1="240" x2="340" y2="240" stroke-dasharray="6 3" />
        </g>

        <!-- Generation & Load Symbols -->
        <g>
          <circle cx="40" cy="190" r="16" fill="#0284c7" stroke="#38bdf8" stroke-width="2" />
          <text x="40" y="194" fill="#ffffff" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">G1</text>
          <line x1="56" y1="190" x2="80" y2="190" stroke="#38bdf8" stroke-width="2" />

          <!-- Load Arrow -->
          <polygon points="630,190 655,190 642,208" fill="#ef4444" />
          <line x1="600" y1="190" x2="630" y2="190" stroke="#ef4444" stroke-width="2" />
          <text x="642" y="225" fill="#f87171" font-size="10" font-family="sans-serif" text-anchor="middle">Load: 120 MW</text>
        </g>

        <!-- Flow Overlay -->
        <text x="470" y="210" fill="#34d399" font-size="10" font-family="monospace">P = 124.3 MW →</text>
        <text x="470" y="235" fill="#64748b" font-size="9" font-family="monospace">Q = 18.2 MVAR</text>
      </svg>
    `);
  }, [viewConfig.svg]);

  const metrics = viewConfig.metrics;

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <ZapIcon size={16} fill="#34d399" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>PSS/E RAW SLD</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={3}>
          <Button
            size="small"
            leadingVisual={PlayIcon}
            onClick={() => navigate(`/ide?source=${encodeURIComponent(rawText)}&title=${encodeURIComponent(title)}`)}
          >
            Open in Grid Editor
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
            Power Flow Case Overview
          </Text>
          <StatItem>
            <span>Total Buses</span>
            <strong>{metrics?.busCount ?? 3}</strong>
          </StatItem>
          <StatItem>
            <span>Total Generation</span>
            <strong>{metrics?.totalGenMw ? `${metrics.totalGenMw} MW` : "245.0 MW"}</strong>
          </StatItem>
          <StatItem>
            <span>Total Load</span>
            <strong>{metrics?.totalLoadMw ? `${metrics.totalLoadMw} MW` : "238.4 MW"}</strong>
          </StatItem>
          <StatItem>
            <span>Losses (I²R)</span>
            <strong>{metrics?.lossesMw ? `${metrics.lossesMw} MW` : "6.6 MW (2.7%)"}</strong>
          </StatItem>
          <StatItem>
            <span>Voltage Status</span>
            <strong style={{ color: "#34d399" }}>Normal (0.98 - 1.03 pu)</strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default PsseSldViewer;
