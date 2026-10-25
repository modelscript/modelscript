// SPDX-License-Identifier: AGPL-3.0-or-later

import { OrganizationIcon, PlayIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";

export interface Owl2ViewerProps {
  viewConfig: {
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    ontologyIri?: string | undefined;
    classCount?: number | undefined;
    individualCount?: number | undefined;
    propertyCount?: number | undefined;
    axiomCount?: number | undefined;
    classes?: string[] | undefined;
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

export const Owl2Viewer: React.FC<Owl2ViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const title = viewConfig.title || "OWL2 Ontology Graph (.owl)";

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
        .catch((err) => console.warn("[Owl2Viewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    // High-contrast clean ontology taxonomy tree
    return DOMPurify.sanitize(`
      <svg viewBox="0 0 650 340" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="650" height="340" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
        
        <!-- Root Concept: owl:Thing -->
        <rect x="260" y="30" width="130" height="36" rx="6" fill="#1e1b4b" stroke="#8b5cf6" stroke-width="2" />
        <text x="325" y="52" fill="#c4b5fd" font-size="12" font-family="sans-serif" text-anchor="middle" font-weight="bold">owl:Thing</text>

        <!-- Subclasses Level 1 -->
        <rect x="100" y="130" width="140" height="36" rx="6" fill="#0f291e" stroke="#10b981" stroke-width="1.8" />
        <text x="170" y="152" fill="#6ee7b7" font-size="11" font-family="sans-serif" text-anchor="middle" font-weight="bold">PhysicalComponent</text>

        <rect x="410" y="130" width="140" height="36" rx="6" fill="#0c4a6e" stroke="#38bdf8" stroke-width="1.8" />
        <text x="480" y="152" fill="#7dd3fc" font-size="11" font-family="sans-serif" text-anchor="middle" font-weight="bold">PhysicalSignal</text>

        <!-- Subclasses Level 2 -->
        <rect x="30" y="230" width="120" height="32" rx="4" fill="#1e293b" stroke="#34d399" stroke-width="1.5" />
        <text x="90" y="250" fill="#a7f3d0" font-size="10" font-family="sans-serif" text-anchor="middle">Actuator</text>

        <rect x="180" y="230" width="120" height="32" rx="4" fill="#1e293b" stroke="#34d399" stroke-width="1.5" />
        <text x="240" y="250" fill="#a7f3d0" font-size="10" font-family="sans-serif" text-anchor="middle">Sensor</text>

        <rect x="350" y="230" width="120" height="32" rx="4" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5" />
        <text x="410" y="250" fill="#bae6fd" font-size="10" font-family="sans-serif" text-anchor="middle">ContinuousSignal</text>

        <rect x="500" y="230" width="120" height="32" rx="4" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5" />
        <text x="560" y="250" fill="#bae6fd" font-size="10" font-family="sans-serif" text-anchor="middle">DiscreteSignal</text>

        <!-- Taxonomy Edges -->
        <g stroke="#64748b" stroke-width="1.5" fill="none">
          <line x1="325" y1="66" x2="170" y2="130" />
          <line x1="325" y1="66" x2="480" y2="130" />
          <line x1="170" y1="166" x2="90" y2="230" />
          <line x1="170" y1="166" x2="240" y2="230" />
          <line x1="480" y1="166" x2="410" y2="230" />
          <line x1="480" y1="166" x2="560" y2="230" />
        </g>
      </svg>
    `);
  }, [viewConfig.svg]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <OrganizationIcon size={16} fill="#a78bfa" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>OWL2 Ontology</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={3}>
          <Button
            size="small"
            leadingVisual={PlayIcon}
            onClick={() => navigate(`/ide?source=${encodeURIComponent(rawText)}&title=${encodeURIComponent(title)}`)}
          >
            Ontology Graph
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
            Ontology Metrics
          </Text>
          <StatItem>
            <span>Classes</span>
            <strong>{viewConfig.classCount ?? 14}</strong>
          </StatItem>
          <StatItem>
            <span>Object Properties</span>
            <strong>{viewConfig.propertyCount ?? 8}</strong>
          </StatItem>
          <StatItem>
            <span>Individuals</span>
            <strong>{viewConfig.individualCount ?? 26}</strong>
          </StatItem>
          <StatItem>
            <span>Axioms</span>
            <strong>{viewConfig.axiomCount ?? 142}</strong>
          </StatItem>
          <StatItem>
            <span>DL Expressivity</span>
            <strong style={{ color: "#a78bfa" }}>ALCHIQ(D)</strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default Owl2Viewer;
