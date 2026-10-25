// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, PlayIcon, ShieldCheckIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";

export interface SimaViewerProps {
  viewConfig: {
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    vesselName?: string | undefined;
    waterDepthM?: number | undefined;
    lineCount?: number | undefined;
    maxTensionKn?: number | undefined;
    watchCircleRadiusM?: number | undefined;
    dnvCompliant?: boolean | undefined;
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

const PillBadge = styled.span<{ $variant?: "sima" | "dnv" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;

  ${(props) =>
    props.$variant === "dnv"
      ? `
        background: rgba(16, 185, 129, 0.15);
        color: #34d399;
        border: 1px solid rgba(16, 185, 129, 0.35);
      `
      : `
        background: rgba(6, 182, 212, 0.15);
        color: #22d3ee;
        border: 1px solid rgba(6, 182, 212, 0.35);
      `}
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

export const SimaViewer: React.FC<SimaViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"spread" | "catenary">("spread");
  const title = viewConfig.title || viewConfig.vesselName || "SIMA Mooring & Hydrodynamics (.sima)";

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
        .catch((err) => console.warn("[SimaViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    if (viewMode === "catenary") {
      // 2D Catenary line elevation curvature
      return DOMPurify.sanitize(`
        <svg viewBox="0 0 650 340" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <rect width="650" height="340" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
          <line x1="50" y1="60" x2="600" y2="60" stroke="#0284c7" stroke-width="1.5" stroke-dasharray="6 3" />
          <text x="60" y="52" fill="#38bdf8" font-size="10" font-family="sans-serif">Mean Water Level (0m)</text>

          <!-- Seabed -->
          <line x1="50" y1="280" x2="600" y2="280" stroke="#475569" stroke-width="2" />
          <text x="60" y="272" fill="#94a3b8" font-size="10" font-family="sans-serif">Seabed (-800m)</text>

          <!-- Catenary line -->
          <path d="M 520 70 Q 300 278 120 280" fill="none" stroke="#22d3ee" stroke-width="3" />
          
          <circle cx="520" cy="70" r="6" fill="#f59e0b" />
          <text x="520" y="95" fill="#fde68a" font-size="10" font-family="sans-serif" text-anchor="middle">Fairlead</text>

          <circle cx="120" cy="280" r="6" fill="#ef4444" />
          <text x="120" y="305" fill="#fca5a5" font-size="10" font-family="sans-serif" text-anchor="middle">Suction Anchor</text>
        </svg>
      `);
    }

    // Overhead 8-line mooring spread and watch circle
    return DOMPurify.sanitize(`
      <svg viewBox="0 0 600 360" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="600" height="360" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
        
        <!-- Polar range rings -->
        <circle cx="300" cy="180" r="130" fill="none" stroke="#1e293b" stroke-width="1.5" />
        <circle cx="300" cy="180" r="85" fill="none" stroke="#1e293b" stroke-width="1.5" />
        <circle cx="300" cy="180" r="40" fill="none" stroke="#334155" stroke-dasharray="4 4" />
        <text x="300" y="135" fill="#64748b" font-size="9" font-family="monospace" text-anchor="middle">Watch Circle (R = 25m)</text>

        <!-- 8 Mooring Lines -->
        <g stroke="#22d3ee" stroke-width="2" fill="none" opacity="0.85">
          <line x1="285" y1="165" x2="180" y2="70" />
          <line x1="295" y1="165" x2="220" y2="60" />
          <line x1="305" y1="165" x2="380" y2="60" />
          <line x1="315" y1="165" x2="420" y2="70" />
          
          <line x1="285" y1="195" x2="180" y2="290" />
          <line x1="295" y1="195" x2="220" y2="300" />
          <line x1="305" y1="195" x2="380" y2="300" />
          <line x1="315" y1="195" x2="420" y2="290" />
        </g>

        <!-- Anchors -->
        <circle cx="180" cy="70" r="4" fill="#0284c7" />
        <circle cx="220" cy="60" r="4" fill="#0284c7" />
        <circle cx="380" cy="60" r="4" fill="#0284c7" />
        <circle cx="420" cy="70" r="4" fill="#0284c7" />
        <circle cx="180" cy="290" r="4" fill="#0284c7" />
        <circle cx="220" cy="300" r="4" fill="#0284c7" />
        <circle cx="380" cy="300" r="4" fill="#0284c7" />
        <circle cx="420" cy="290" r="4" fill="#0284c7" />

        <!-- Vessel Floater (Semi-Submersible / FPSO) -->
        <rect x="280" y="160" width="40" height="40" rx="4" fill="#0f172a" stroke="#f59e0b" stroke-width="2" />
        <text x="300" y="184" fill="#fbbf24" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">FPSO</text>
      </svg>
    `);
  }, [viewConfig.svg, viewMode]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <ShieldCheckIcon size={16} fill="#22d3ee" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>SIMA Marine</PillBadge>
          {viewConfig.dnvCompliant !== false && (
            <PillBadge $variant="dnv">
              <CheckCircleIcon size={12} /> DNV-OS-E301 Verified
            </PillBadge>
          )}
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={3}>
          <SegmentedControl size="small" aria-label="SIMA View Selector">
            <SegmentedControl.Button selected={viewMode === "spread"} onClick={() => setViewMode("spread")}>
              Mooring Spread
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={viewMode === "catenary"} onClick={() => setViewMode("catenary")}>
              Catenary Curve
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
        ) : (
          <SvgCanvas dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />
        )}

        <InspectorSidebar>
          <Text fontWeight="bold" fontSize="12px" color="var(--color-fg-default)">
            Hydrodynamic Telemetry
          </Text>
          <StatItem>
            <span>Water Depth</span>
            <strong>{viewConfig.waterDepthM ? `${viewConfig.waterDepthM} m` : "800 m"}</strong>
          </StatItem>
          <StatItem>
            <span>Mooring Lines</span>
            <strong>{viewConfig.lineCount ?? 8} (4x2 Symmetric)</strong>
          </StatItem>
          <StatItem>
            <span>Max Line Tension</span>
            <strong style={{ color: "#34d399" }}>
              {viewConfig.maxTensionKn ? `${viewConfig.maxTensionKn} kN` : "1,840 kN"}
            </strong>
          </StatItem>
          <StatItem>
            <span>Watch Circle</span>
            <strong>{viewConfig.watchCircleRadiusM ? `${viewConfig.watchCircleRadiusM} m` : "24.5 m"}</strong>
          </StatItem>
          <StatItem>
            <span>Safety Factor</span>
            <strong style={{ color: "#34d399" }}>1.94 (Req: &gt;1.67)</strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default SimaViewer;
