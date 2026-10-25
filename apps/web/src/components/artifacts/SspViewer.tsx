// SPDX-License-Identifier: AGPL-3.0-or-later

import { PackageIcon, PlayIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";

export interface SspViewerProps {
  viewConfig: {
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    systemName?: string | undefined;
    fmuComponents?: { name: string; source: string; inputs?: string[]; outputs?: string[] }[];
    connections?: { startElement: string; startConnector: string; endElement: string; endConnector: string }[];
    parameterSets?: { name: string; parameters: Record<string, string | number> }[];
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
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
  border: 1px solid rgba(139, 92, 246, 0.35);
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

export const SspViewer: React.FC<SspViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const title = viewConfig.title || viewConfig.systemName || "System Structure Package (.ssp)";

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
        .catch((err) => console.warn("[SspViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    // High-contrast clean multi-FMU interconnection diagram
    return DOMPurify.sanitize(`
      <svg viewBox="0 0 650 340" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="650" height="340" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
        
        <!-- FMU Component 1: Controller -->
        <rect x="70" y="110" width="130" height="120" rx="6" fill="#1e1b4b" stroke="#8b5cf6" stroke-width="2" />
        <text x="135" y="135" fill="#c4b5fd" font-size="11" font-family="sans-serif" text-anchor="middle" font-weight="bold">ECU_Controller</text>
        <text x="135" y="152" fill="#a78bfa" font-size="9" font-family="monospace" text-anchor="middle">Controller.fmu</text>
        <circle cx="200" cy="170" r="5" fill="#10b981" />
        <text x="185" y="174" fill="#6ee7b7" font-size="8" font-family="monospace" text-anchor="end">u_demand</text>

        <!-- FMU Component 2: Powertrain Plant -->
        <rect x="270" y="110" width="140" height="120" rx="6" fill="#0f291e" stroke="#10b981" stroke-width="2" />
        <text x="340" y="135" fill="#6ee7b7" font-size="11" font-family="sans-serif" text-anchor="middle" font-weight="bold">Plant_Powertrain</text>
        <text x="340" y="152" fill="#34d399" font-size="9" font-family="monospace" text-anchor="middle">Powertrain.fmu</text>
        <circle cx="270" cy="170" r="5" fill="#10b981" />
        <circle cx="410" cy="170" r="5" fill="#38bdf8" />
        <text x="395" y="174" fill="#7dd3fc" font-size="8" font-family="monospace" text-anchor="end">w_out</text>

        <!-- FMU Component 3: Chassis Dynamics -->
        <rect x="470" y="110" width="120" height="120" rx="6" fill="#0c4a6e" stroke="#38bdf8" stroke-width="2" />
        <text x="530" y="135" fill="#7dd3fc" font-size="11" font-family="sans-serif" text-anchor="middle" font-weight="bold">Vehicle_Chassis</text>
        <text x="530" y="152" fill="#38bdf8" font-size="9" font-family="monospace" text-anchor="middle">Chassis.fmu</text>
        <circle cx="470" cy="170" r="5" fill="#38bdf8" />

        <!-- Signal Interconnection Wires -->
        <g stroke="#38bdf8" stroke-width="2" fill="none">
          <line x1="200" y1="170" x2="270" y2="170" stroke="#10b981" />
          <line x1="410" y1="170" x2="470" y2="170" />
          <!-- Feedback signal -->
          <line x1="530" y1="230" x2="530" y2="280" />
          <line x1="530" y1="280" x2="135" y2="280" />
          <line x1="135" y1="280" x2="135" y2="230" />
        </g>

        <text x="325" y="40" fill="#f0f6fc" font-size="13" font-weight="bold" font-family="sans-serif" text-anchor="middle">System Structure &amp; Parameterization (SSP)</text>
        <text x="325" y="60" fill="#64748b" font-size="10" font-family="monospace" text-anchor="middle">Co-Simulation FMU Interconnection Topology</text>
      </svg>
    `);
  }, [viewConfig.svg]);

  const fmuCount = viewConfig.fmuComponents?.length ?? 3;
  const connectionCount = viewConfig.connections?.length ?? 3;

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PackageIcon size={16} fill="#a78bfa" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>SSP Archive</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={3}>
          <Button
            size="small"
            leadingVisual={PlayIcon}
            onClick={() =>
              navigate(
                rawText
                  ? `/ide?source=${encodeURIComponent(rawText)}&title=${encodeURIComponent(title)}`
                  : `/ide?title=${encodeURIComponent(title)}`,
              )
            }
          >
            Co-Sim Studio
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
            Co-Simulation Package
          </Text>
          <StatItem>
            <span>Standard</span>
            <strong>SSP 1.0 (OSF / Modelica)</strong>
          </StatItem>
          <StatItem>
            <span>FMU Instances</span>
            <strong>{fmuCount} FMUs</strong>
          </StatItem>
          <StatItem>
            <span>Connections</span>
            <strong>{connectionCount} Signal Mappings</strong>
          </StatItem>
          <StatItem>
            <span>Parameter Sets</span>
            <strong>{viewConfig.parameterSets?.length ?? 2} (Base / Nominal)</strong>
          </StatItem>
          <StatItem>
            <span>Master Algorithm</span>
            <strong style={{ color: "#34d399" }}>Gauss-Seidel Co-Sim</strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default SspViewer;
