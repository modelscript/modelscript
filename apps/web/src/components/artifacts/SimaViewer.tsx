// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, PlayIcon, ShieldCheckIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine, renderSourceToDiagramSvg } from "./PolyglotArtifactViewer";

export interface SimaViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    vesselName?: string | undefined;
    waterDepthM?: number | undefined;
    waterDepthMeters?: number | undefined;
    lineCount?: number | undefined;
    mooringLinesCount?: number | undefined;
    maxTensionKn?: number | undefined;
    watchCircleRadiusM?: number | undefined;
    watchCircleRadiusMeters?: number | undefined;
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
  const [viewMode, setViewMode] = useState<"spread" | "catenary" | "code">("spread");
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
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => setRawText(txt))
        .catch((err) => console.warn("[SimaViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const parsedSima = useMemo(() => {
    const depthMatch = rawText.match(/\b(?:water_depth|waterDepth|depth)\s*[=:]?\s*([0-9.]+)/i);
    const lineMatches = rawText ? Array.from(rawText.matchAll(/\b(?:MOORING_LINE|LINE|mooringLine)\b/gi)) : [];
    const tensionMatch = rawText.match(/\b(?:pretension|max_tension|tension)\s*[=:]?\s*([0-9.]+)/i);
    return {
      waterDepthM:
        viewConfig.waterDepthM ?? viewConfig.waterDepthMeters ?? (depthMatch ? Number(depthMatch[1]) : undefined),
      lineCount: viewConfig.lineCount ?? viewConfig.mooringLinesCount ?? lineMatches.length,
      maxTensionKn: viewConfig.maxTensionKn ?? (tensionMatch ? Number(tensionMatch[1]) : undefined),
      watchCircleRadiusM: viewConfig.watchCircleRadiusM ?? viewConfig.watchCircleRadiusMeters,
    };
  }, [rawText, viewConfig]);

  const sanitizedSvg = useMemo(() => {
    if (viewMode === "catenary") {
      const depthLabel = parsedSima.waterDepthM !== undefined ? `-${parsedSima.waterDepthM}m` : "Seabed";
      const tensionLabel = parsedSima.maxTensionKn !== undefined ? ` (${parsedSima.maxTensionKn} kN)` : "";
      return DOMPurify.sanitize(`
        <svg viewBox="0 0 650 340" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <rect width="650" height="340" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
          <line x1="50" y1="60" x2="600" y2="60" stroke="#0284c7" stroke-width="1.5" stroke-dasharray="6 3" />
          <text x="60" y="52" fill="#38bdf8" font-size="10" font-family="sans-serif">Mean Water Level (0m)</text>
          <line x1="50" y1="280" x2="600" y2="280" stroke="#475569" stroke-width="2" />
          <text x="60" y="272" fill="#94a3b8" font-size="10" font-family="sans-serif">Seabed (${depthLabel})</text>
          <path d="M 520 70 Q 300 278 120 280" fill="none" stroke="#22d3ee" stroke-width="3" />
          <circle cx="520" cy="70" r="6" fill="#f59e0b" />
          <text x="520" y="95" fill="#fde68a" font-size="10" font-family="sans-serif" text-anchor="middle">Fairlead${tensionLabel}</text>
          <circle cx="120" cy="280" r="6" fill="#ef4444" />
          <text x="120" y="305" fill="#fca5a5" font-size="10" font-family="sans-serif" text-anchor="middle">Anchor</text>
        </svg>
      `);
    }

    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }

    if (rawText.trim()) {
      return renderSourceToDiagramSvg(rawText, "sima", title, true).svg;
    }
    return "";
  }, [viewConfig.svg, viewMode, rawText, parsedSima, title]);

  const codeLines = rawText ? rawText.split(/\r?\n/) : [];

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <ShieldCheckIcon size={16} fill="#22d3ee" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>SIMA Marine</PillBadge>
          {viewConfig.dnvCompliant === true && (
            <PillBadge $variant="dnv">
              <CheckCircleIcon size={12} /> DNV-OS-E301 Verified
            </PillBadge>
          )}
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
          <SegmentedControl size="small" aria-label="SIMA View Selector">
            <SegmentedControl.Button selected={viewMode === "spread"} onClick={() => setViewMode("spread")}>
              Mooring Spread
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={viewMode === "catenary"} onClick={() => setViewMode("catenary")}>
              Catenary Curve
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={viewMode === "code"} onClick={() => setViewMode("code")}>
              Source
            </SegmentedControl.Button>
          </SegmentedControl>

          {Boolean(viewConfig?.standalone) && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={PlayIcon}
              onClick={() => {
                const hash = compressMorselPayload({
                  v: 1,
                  lang: "sima" as any,
                  code: rawText || `# ${title}\n`,
                  title,
                });
                const fromArtifact = viewConfig.artifactId ? `?fromArtifact=${viewConfig.artifactId}` : "";
                navigate(`/playground${fromArtifact}#m=${hash}`);
              }}
            >
              Open in Playground
            </Button>
          )}
        </Box>
      </Toolbar>

      <ContentArea>
        {loading ? (
          <Box flex={1} display="flex" justifyContent="center" alignItems="center">
            <Spinner size="medium" />
          </Box>
        ) : viewMode !== "code" && sanitizedSvg ? (
          <SvgCanvas dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />
        ) : (
          <Box
            flex={1}
            py={2}
            overflow="auto"
            bg="var(--color-canvas-inset, #010409)"
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "12px", lineHeight: 1.55 }}
          >
            {codeLines.length > 0 ? (
              codeLines.map((line, idx) => (
                <div key={idx} style={{ display: "flex", padding: "0 14px" }}>
                  <span
                    style={{
                      userSelect: "none",
                      width: "36px",
                      minWidth: "36px",
                      textAlign: "right",
                      paddingRight: "12px",
                      color: "var(--color-fg-subtle)",
                      fontSize: "11px",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <span style={{ whiteSpace: "pre", color: "var(--color-fg-default)" }}>
                    {highlightPolyglotLine(line, "sima")}
                  </span>
                </div>
              ))
            ) : (
              <Box p={4} color="var(--color-fg-muted)" textAlign="center">
                No SIMA mooring source available.
              </Box>
            )}
          </Box>
        )}

        <InspectorSidebar>
          <Text style={{ fontWeight: "bold", fontSize: "12px", color: "var(--color-fg-default)" }}>
            Hydrodynamic Telemetry
          </Text>
          <StatItem>
            <span>Mooring Lines</span>
            <strong>{parsedSima.lineCount}</strong>
          </StatItem>
          {parsedSima.waterDepthM !== undefined && (
            <StatItem>
              <span>Water Depth</span>
              <strong>{parsedSima.waterDepthM} m</strong>
            </StatItem>
          )}
          {parsedSima.maxTensionKn !== undefined && (
            <StatItem>
              <span>Max Line Tension</span>
              <strong style={{ color: "#34d399" }}>{parsedSima.maxTensionKn} kN</strong>
            </StatItem>
          )}
          {parsedSima.watchCircleRadiusM !== undefined && (
            <StatItem>
              <span>Watch Circle</span>
              <strong>{parsedSima.watchCircleRadiusM} m</strong>
            </StatItem>
          )}
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default SimaViewer;
