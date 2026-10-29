// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, PlayIcon, ShieldCheckIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine } from "./PolyglotArtifactViewer";

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
  background: var(--color-canvas-default);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 44px;
  min-height: 44px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default);
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
  color: var(--color-text-heading, var(--color-fg-default));
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
        color: var(--color-success-fg, var(--color-fg-default));
        border: 1px solid rgba(16, 185, 129, 0.35);
      `
      : `
        background: rgba(6, 182, 212, 0.15);
        color: var(--color-accent-fg, var(--color-fg-default));
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
  background: var(--color-canvas-inset, var(--color-canvas-default));

  svg {
    max-width: 100%;
    max-height: 100%;
    height: auto;
  }
`;

const InspectorSidebar = styled.div`
  width: 250px;
  border-left: 1px solid var(--color-border-default);
  background: var(--color-canvas-subtle);
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
  color: var(--color-fg-muted);

  strong {
    color: var(--color-fg-default);
  }
`;

export const SimaViewer: React.FC<SimaViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const initialSource = (viewConfig.code || (viewConfig.source as string | undefined) || "") as string;
  const [rawText, setRawText] = useState(initialSource);
  const [viewMode, setViewMode] = useState<"spread" | "code">(() => (viewConfig.svg ? "spread" : "code"));
  const title = viewConfig.title || viewConfig.vesselName || "SIMA Mooring & Hydrodynamics (.sima)";

  useEffect(() => {
    const inlineCode = (viewConfig.code || (viewConfig.source as string | undefined)) as string | undefined;
    if (inlineCode) {
      setRawText(inlineCode);
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
  }, [viewConfig.code, viewConfig.source, viewConfig.url]);

  const parsedSima = useMemo(() => {
    const depthMatch = rawText.match(/\b(?:water_depth|waterDepth|depth)\s*[=:]?\s*([0-9.]+)/i);
    const lengthMatch = rawText.match(/\b(?:line_length|lineLength|mooring_length|length)\s*[=:]?\s*([0-9.]+)/i);
    const lineMatches = rawText ? Array.from(rawText.matchAll(/\b(?:MOORING_LINE|LINE|mooringLine)\b/gi)) : [];
    const tensionMatch = rawText.match(/\b(?:pretension|max_tension|tension)\s*[=:]?\s*([0-9.]+)/i);
    const depthM =
      viewConfig.waterDepthM ?? viewConfig.waterDepthMeters ?? (depthMatch ? Number(depthMatch[1]) : undefined);
    const lineLengthM =
      (viewConfig.lineLengthM as number | undefined) ?? (lengthMatch ? Number(lengthMatch[1]) : undefined);
    return {
      waterDepthM: depthM,
      lineLengthM,
      lineCount: viewConfig.lineCount ?? viewConfig.mooringLinesCount ?? lineMatches.length,
      maxTensionKn: viewConfig.maxTensionKn ?? (tensionMatch ? Number(tensionMatch[1]) : undefined),
      watchCircleRadiusM: viewConfig.watchCircleRadiusM ?? viewConfig.watchCircleRadiusMeters,
    };
  }, [rawText, viewConfig]);

  const sanitizedSvg = useMemo(() => {
    if (typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    return "";
  }, [viewConfig.svg]);

  const effectiveViewMode: "spread" | "code" = viewMode === "spread" && sanitizedSvg ? "spread" : "code";

  const codeLines = rawText ? rawText.split(/\r?\n/) : [];

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <ShieldCheckIcon size={16} fill="var(--color-accent-fg, currentColor)" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>SIMA Marine</PillBadge>
          {viewConfig.dnvCompliant === true && (
            <PillBadge $variant="dnv">
              <CheckCircleIcon size={12} /> DNV-OS-E301 Verified
            </PillBadge>
          )}
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
          {sanitizedSvg && (
            <SegmentedControl size="small" aria-label="SIMA View Selector">
              <SegmentedControl.Button selected={effectiveViewMode === "spread"} onClick={() => setViewMode("spread")}>
                Mooring Spread
              </SegmentedControl.Button>
              <SegmentedControl.Button selected={effectiveViewMode === "code"} onClick={() => setViewMode("code")}>
                Source
              </SegmentedControl.Button>
            </SegmentedControl>
          )}

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
        ) : effectiveViewMode !== "code" && sanitizedSvg ? (
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
