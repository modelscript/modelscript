// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CodeIcon, CopyIcon, DownloadIcon, PlayIcon, PulseIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { buildEditorUrlForArtifact } from "../../util/editor-routing";
import Box from "../Box";
import { highlightPolyglotLine } from "./PolyglotArtifactViewer";

export interface PipelineLpsViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
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
  color: var(--color-accent-fg, var(--color-fg-default));
  border: 1px solid rgba(14, 165, 233, 0.35);
`;

const SegmentedControl = styled.div`
  display: inline-flex;
  background: var(--color-canvas-inset, var(--color-canvas-default));
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
`;

const SegmentBtn = styled.button<{ $active: boolean }>`
  border: none;
  background: ${(p) => (p.$active ? "var(--color-accent-emphasis)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-fg-on-emphasis, var(--color-fg-default))" : "var(--color-fg-muted)")};
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.12s ease;

  &:hover {
    color: ${(p) => (p.$active ? "var(--color-fg-on-emphasis, var(--color-fg-default))" : "var(--color-fg-default)")};
  }
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

const CodePre = styled.pre`
  flex: 1;
  margin: 0;
  padding: 14px 0;
  overflow: auto;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--color-fg-default);
  background: var(--color-canvas-inset, var(--color-canvas-default));
`;

const CodeLine = styled.div`
  display: flex;
  padding: 0 16px;
  &:hover {
    background: rgba(110, 118, 129, 0.08);
  }
`;

const LineNo = styled.span`
  width: 44px;
  flex-shrink: 0;
  color: var(--color-fg-subtle);
  user-select: none;
  text-align: right;
  padding-right: 16px;
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

function parsePipelineLpsClient(code: string) {
  const maopMatch = code.match(/MAOP\s*=\s*([0-9.eE+-]+)/i);
  const pInMatch = code.match(/(?:P_IN|INLET_PRESSURE)\s*=\s*([0-9.eE+-]+)/i);
  const pOutMatch = code.match(/(?:P_OUT|OUTLET_PRESSURE)\s*=\s*([0-9.eE+-]+)/i);
  const flowMatch = code.match(/(?:FLOW|THROUGHPUT)\s*=\s*([0-9.eE+-]+)/i);
  const compCount = Array.from(code.matchAll(/\bCOMPRESSOR\b|\bCS[_-]\d+/gi)).length;
  return {
    maopBar: maopMatch?.[1] ? Number.parseFloat(maopMatch[1]) : undefined,
    inletPressureBar: pInMatch?.[1] ? Number.parseFloat(pInMatch[1]) : undefined,
    outletPressureBar: pOutMatch?.[1] ? Number.parseFloat(pOutMatch[1]) : undefined,
    throughputMmsm3d: flowMatch?.[1] ? Number.parseFloat(flowMatch[1]) : undefined,
    compressorCount: compCount > 0 ? compCount : undefined,
  };
}

export const PipelineLpsViewer: React.FC<PipelineLpsViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"diagram" | "code">(() => (viewConfig.svg ? "diagram" : "code"));
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
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => {
          if (txt) setRawText(txt);
        })
        .catch((err) => console.warn("[PipelineLpsViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const parsedClient = useMemo(() => (rawText ? parsePipelineLpsClient(rawText) : undefined), [rawText]);

  const sanitizedSvg = useMemo(() => {
    if (typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    return "";
  }, [viewConfig.svg]);

  const effectiveViewMode: "diagram" | "code" = viewMode === "diagram" && sanitizedSvg ? "diagram" : "code";

  const handleCopy = () => {
    if (rawText) {
      navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExportSvg = () => {
    if (!sanitizedSvg) return;
    const blob = new Blob([sanitizedSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}-network.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenInPlayground = () => {
    navigate(
      buildEditorUrlForArtifact({
        artifactId: viewConfig.artifactId,
        viewType: "lps",
        dialect: "lps",
        viewConfig,
        code: rawText,
        title,
      }),
    );
  };

  const maopBar = viewConfig.maopBar ?? parsedClient?.maopBar;
  const inletPressureBar = viewConfig.inletPressureBar ?? parsedClient?.inletPressureBar;
  const outletPressureBar = viewConfig.outletPressureBar ?? parsedClient?.outletPressureBar;
  const throughputMmsm3d = viewConfig.throughputMmsm3d ?? parsedClient?.throughputMmsm3d;
  const compressorCount = viewConfig.compressorCount ?? parsedClient?.compressorCount;
  const lines = useMemo(() => (rawText ? rawText.split(/\r?\n/) : []), [rawText]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PulseIcon size={16} fill="var(--color-accent-fg, currentColor)" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>PipelineStudio (LPS)</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
          {sanitizedSvg && (
            <SegmentedControl>
              <SegmentBtn
                type="button"
                $active={effectiveViewMode === "diagram"}
                onClick={() => setViewMode("diagram")}
              >
                <PulseIcon size={12} /> Network
              </SegmentBtn>
              <SegmentBtn type="button" $active={effectiveViewMode === "code"} onClick={() => setViewMode("code")}>
                <CodeIcon size={12} /> Source
              </SegmentBtn>
            </SegmentedControl>
          )}
          {sanitizedSvg && (
            <Button size="small" leadingVisual={DownloadIcon} onClick={handleExportSvg}>
              SVG
            </Button>
          )}
          <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          {Boolean(viewConfig?.standalone) && (
            <Button size="small" leadingVisual={PlayIcon} onClick={handleOpenInPlayground}>
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
        ) : effectiveViewMode === "code" || !sanitizedSvg ? (
          <CodePre>
            {lines.length > 0 ? (
              lines.map((line, idx) => (
                <CodeLine key={idx}>
                  <LineNo>{idx + 1}</LineNo>
                  <span>{highlightPolyglotLine(line, "lps")}</span>
                </CodeLine>
              ))
            ) : (
              <Box p={4} color="fg.muted">
                No PipelineStudio network deck loaded.
              </Box>
            )}
          </CodePre>
        ) : (
          <SvgCanvas dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />
        )}

        <InspectorSidebar>
          <Text style={{ fontWeight: "bold", fontSize: "12px", color: "var(--color-fg-default)" }}>
            Hydraulic Network Telemetry
          </Text>
          <StatItem>
            <span>Line Pack Inventory</span>
            <strong>{viewConfig.linePackMm3 !== undefined ? `${viewConfig.linePackMm3} Mm³` : "—"}</strong>
          </StatItem>
          <StatItem>
            <span>MAOP Limit</span>
            <strong>{maopBar !== undefined ? `${maopBar} bar` : "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Inlet Pressure</span>
            <strong>{inletPressureBar !== undefined ? `${inletPressureBar} bar` : "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Outlet Delivery</span>
            <strong>{outletPressureBar !== undefined ? `${outletPressureBar} bar` : "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Throughput Rate</span>
            <strong>{throughputMmsm3d !== undefined ? `${throughputMmsm3d} MSm³/d` : "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Compressor Units</span>
            <strong style={{ color: "#34d399" }}>{compressorCount !== undefined ? compressorCount : "—"}</strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default PipelineLpsViewer;
