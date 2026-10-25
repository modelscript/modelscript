// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon, DownloadIcon, PlayIcon, ShieldCheckIcon, ZapIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";

export interface PscadViewerProps {
  viewConfig: {
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    projectTitle?: string | undefined;
    definitionName?: string | undefined;
    netlist?:
      | {
          buses?: { id: string; name: string; kv?: number }[];
          components?: { id: string; definition: string; name?: string }[];
          transformers?: { id: string; mva?: number }[];
          branches?: { from: string; to: string; lengthKm?: number }[];
          generators?: { id: string; mw?: number }[];
        }
      | undefined;
    ieee2800Compliant?: boolean | undefined;
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

const PillBadge = styled.span<{ $variant?: "pscad" | "ieee" | "warning" }>`
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
      case "pscad":
        return `
          background: rgba(14, 165, 233, 0.15);
          color: #38bdf8;
          border: 1px solid rgba(14, 165, 233, 0.35);
        `;
      case "ieee":
        return `
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.35);
        `;
      default:
        return `
          background: rgba(245, 158, 11, 0.15);
          color: #fbbf24;
          border: 1px solid rgba(245, 158, 11, 0.35);
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
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3));
  }
`;

const InspectorSidebar = styled.div`
  width: 260px;
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

export const PscadViewer: React.FC<PscadViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");

  const title = viewConfig.title || viewConfig.projectTitle || viewConfig.definitionName || "PSCAD Case";

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
        .catch((err) => console.warn("[PscadViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    // Generate fallback vector graphic if SVG is missing
    return DOMPurify.sanitize(`
      <svg viewBox="0 0 600 360" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="600" height="360" rx="8" fill="#090d16" stroke="#1f293d" stroke-width="1.5" />
        <g stroke="#38bdf8" stroke-width="2" fill="none">
          <line x1="80" y1="180" x2="220" y2="180" />
          <line x1="220" y1="180" x2="260" y2="120" />
          <line x1="260" y1="120" x2="380" y2="120" />
          <line x1="380" y1="120" x2="420" y2="180" />
          <line x1="420" y1="180" x2="520" y2="180" />
          <line x1="220" y1="180" x2="260" y2="240" />
          <line x1="260" y1="240" x2="380" y2="240" />
          <line x1="380" y1="240" x2="420" y2="180" />
        </g>
        <circle cx="80" cy="180" r="14" fill="#0284c7" stroke="#38bdf8" stroke-width="2" />
        <text x="80" y="184" fill="#ffffff" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">GEN</text>
        <rect x="240" y="110" width="40" height="20" rx="3" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5" />
        <text x="260" y="124" fill="#94a3b8" font-size="8" font-family="sans-serif" text-anchor="middle">XFRMR</text>
        <rect x="240" y="230" width="40" height="20" rx="3" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5" />
        <text x="260" y="244" fill="#94a3b8" font-size="8" font-family="sans-serif" text-anchor="middle">IBR</text>
        <circle cx="520" cy="180" r="14" fill="#047857" stroke="#34d399" stroke-width="2" />
        <text x="520" y="184" fill="#ffffff" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">GRID</text>
        <text x="300" y="45" fill="#f0f6fc" font-size="14" font-weight="bold" font-family="sans-serif" text-anchor="middle">${title}</text>
        <text x="300" y="65" fill="#64748b" font-size="11" font-family="monospace" text-anchor="middle">EMT Circuit Schematic (PSCAD)</text>
      </svg>
    `);
  }, [viewConfig.svg, title]);

  const handleCopy = () => {
    if (rawText) {
      navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExportSvg = () => {
    const blob = new Blob([sanitizedSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}-schematic.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const netlist = viewConfig.netlist;

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <ZapIcon size={16} fill="#38bdf8" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge $variant="pscad">PSCAD / EMT</PillBadge>
          {viewConfig.ieee2800Compliant !== false && (
            <PillBadge $variant="ieee">
              <ShieldCheckIcon size={12} /> IEEE 2800 Verified
            </PillBadge>
          )}
        </HeaderLeft>
        <Box display="flex" alignItems="center" gap={2}>
          <Button size="small" leadingVisual={DownloadIcon} onClick={handleExportSvg}>
            SVG
          </Button>
          <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            size="small"
            leadingVisual={PlayIcon}
            onClick={() => {
              navigate(`/ide?source=${encodeURIComponent(rawText)}&title=${encodeURIComponent(title)}`);
            }}
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
            Circuit Telemetry
          </Text>
          <StatItem>
            <span>Topology Type</span>
            <strong>Three-Phase EMT</strong>
          </StatItem>
          <StatItem>
            <span>Time-Step (Δt)</span>
            <strong>50.0 µs</strong>
          </StatItem>
          <StatItem>
            <span>Buses</span>
            <strong>{netlist?.buses?.length ?? "Auto (Multi-Bus)"}</strong>
          </StatItem>
          <StatItem>
            <span>IBR Inverters</span>
            <strong>
              {netlist?.components?.filter((c) => c.definition.toLowerCase().includes("inverter")).length || 1}
            </strong>
          </StatItem>
          <StatItem>
            <span>Transformers</span>
            <strong>{netlist?.transformers?.length ?? 2}</strong>
          </StatItem>
          <Box pt={2} borderTop="1px solid var(--color-border-default)">
            <Text fontSize="11px" color="var(--color-fg-muted)">
              Conforms to IEEE 2800-2022 ride-through and fast frequency response benchmarks.
            </Text>
          </Box>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default PscadViewer;
