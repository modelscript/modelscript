// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  PlayIcon,
  ShieldCheckIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine, renderSourceToDiagramSvg } from "./PolyglotArtifactViewer";

export interface PscadViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    projectTitle?: string | undefined;
    definitionName?: string | undefined;
    timeStepUs?: number | undefined;
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

const SegmentedControl = styled.div`
  display: inline-flex;
  background: var(--color-canvas-inset, #010409);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
`;

const SegmentBtn = styled.button<{ $active: boolean }>`
  border: none;
  background: ${(p) => (p.$active ? "var(--color-accent-emphasis, #1f6feb)" : "transparent")};
  color: ${(p) => (p.$active ? "#ffffff" : "var(--color-fg-muted, #8b949e)")};
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
    color: ${(p) => (p.$active ? "#ffffff" : "var(--color-fg-default, #e6edf3)")};
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
  background: var(--color-canvas-inset, #010409);

  svg {
    max-width: 100%;
    max-height: 100%;
    height: auto;
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3));
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
  color: var(--color-fg-default, #e6edf3);
  background: var(--color-canvas-inset, #010409);
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
  color: var(--color-fg-subtle, #6e7681);
  user-select: none;
  text-align: right;
  padding-right: 16px;
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

function parsePscadClient(code: string) {
  const compMatches = Array.from(code.matchAll(/<User\b[^>]*name="([^"]+)"/gi));
  const busMatches = Array.from(code.matchAll(/<Bus\b|<Wire\b/gi));
  const xfrmrCount = compMatches.filter((m) => /xfmr|trans|tp3/i.test(m[1] || "")).length;
  const ibrCount = compMatches.filter((m) => /ibr|inv|vsc|pv|bess|wind/i.test(m[1] || "")).length;
  const dtMatch = code.match(/time_step\s*=\s*"?([0-9.eE+-]+)"?/i);
  const timeStepUs = dtMatch?.[1] ? Number.parseFloat(dtMatch[1]) : undefined;
  return {
    componentCount: compMatches.length,
    busCount: busMatches.length,
    transformerCount: xfrmrCount,
    ibrCount,
    timeStepUs,
  };
}

export const PscadViewer: React.FC<PscadViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"diagram" | "code">("diagram");

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
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => {
          if (txt) setRawText(txt);
        })
        .catch((err) => console.warn("[PscadViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const parsedClient = useMemo(() => (rawText ? parsePscadClient(rawText) : undefined), [rawText]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    if (rawText.trim()) {
      return renderSourceToDiagramSvg(rawText, "pscad", title, true).svg;
    }
    return "";
  }, [viewConfig.svg, rawText, title]);

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
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}-schematic.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenInPlayground = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: "pscad" as any,
      code: rawText || `<!-- ${title} -->\n`,
      title,
    });
    const fromParam = viewConfig.artifactId ? `?fromArtifact=${encodeURIComponent(viewConfig.artifactId)}` : "";
    navigate(`/playground${fromParam}#m=${hash}`);
  };

  const netlist = viewConfig.netlist;
  const busCount = netlist?.buses?.length ?? parsedClient?.busCount;
  const componentCount = netlist?.components?.length ?? parsedClient?.componentCount;
  const ibrCount =
    netlist?.components?.filter((c) => /inverter|ibr|vsc/i.test(c.definition)).length ?? parsedClient?.ibrCount;
  const transformerCount = netlist?.transformers?.length ?? parsedClient?.transformerCount;
  const timeStepUs = viewConfig.timeStepUs ?? parsedClient?.timeStepUs;
  const lines = useMemo(() => (rawText ? rawText.split(/\r?\n/) : []), [rawText]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <ZapIcon size={16} fill="#38bdf8" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge $variant="pscad">PSCAD / EMT</PillBadge>
          {viewConfig.ieee2800Compliant === true && (
            <PillBadge $variant="ieee">
              <ShieldCheckIcon size={12} /> IEEE 2800 Verified
            </PillBadge>
          )}
        </HeaderLeft>
        <Box display="flex" alignItems="center" gap={2}>
          <SegmentedControl>
            <SegmentBtn type="button" $active={viewMode === "diagram"} onClick={() => setViewMode("diagram")}>
              <ZapIcon size={12} /> Schematic
            </SegmentBtn>
            <SegmentBtn type="button" $active={viewMode === "code"} onClick={() => setViewMode("code")}>
              <CodeIcon size={12} /> Source
            </SegmentBtn>
          </SegmentedControl>
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
        ) : viewMode === "code" || !sanitizedSvg ? (
          <CodePre>
            {lines.length > 0 ? (
              lines.map((line, idx) => (
                <CodeLine key={idx}>
                  <LineNo>{idx + 1}</LineNo>
                  <span>{highlightPolyglotLine(line, "pscad")}</span>
                </CodeLine>
              ))
            ) : (
              <Box p={4} color="fg.muted">
                No PSCAD XML source loaded.
              </Box>
            )}
          </CodePre>
        ) : (
          <SvgCanvas dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />
        )}

        <InspectorSidebar>
          <Text style={{ fontWeight: "bold", fontSize: "12px", color: "var(--color-fg-default)" }}>
            Circuit Telemetry
          </Text>
          {timeStepUs !== undefined && !Number.isNaN(timeStepUs) && (
            <StatItem>
              <span>Time-Step (Δt)</span>
              <strong>{timeStepUs} µs</strong>
            </StatItem>
          )}
          <StatItem>
            <span>Components</span>
            <strong>{componentCount ?? "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Buses / Wires</span>
            <strong>{busCount ?? "—"}</strong>
          </StatItem>
          <StatItem>
            <span>IBR / Converters</span>
            <strong>{ibrCount ?? "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Transformers</span>
            <strong>{transformerCount ?? "—"}</strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default PscadViewer;
