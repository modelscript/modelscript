// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CodeIcon, CopyIcon, DownloadIcon, FlameIcon, PlayIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine, renderSourceToDiagramSvg } from "./PolyglotArtifactViewer";

export interface RocetsViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    engineName?: string | undefined;
    cycleType?: string | undefined;
    chamberPressureBar?: number | undefined;
    thrustKn?: number | undefined;
    ispSec?: number | undefined;
    massFlowKgSec?: number | undefined;
    turbopumpRpm?: number | undefined;
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
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.35);
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

function parseRocetsClient(code: string) {
  const pcMatch = code.match(/(?:PC|CHAMBER_PRESSURE|P_CHAMBER)\s*=\s*([0-9.eE+-]+)/i);
  const thrustMatch = code.match(/(?:THRUST|F_VAC|F_SL)\s*=\s*([0-9.eE+-]+)/i);
  const ispMatch = code.match(/(?:ISP|I_SP)\s*=\s*([0-9.eE+-]+)/i);
  const mdotMatch = code.match(/(?:MDOT|MASS_FLOW|W_TOTAL)\s*=\s*([0-9.eE+-]+)/i);
  const rpmMatch = code.match(/(?:RPM|N_PUMP|SPEED_RPM)\s*=\s*([0-9.eE+-]+)/i);
  const cycleMatch = code.match(/CYCLE\s*=\s*['"]?([A-Za-z0-9 _-]+)['"]?/i);
  return {
    chamberPressureBar: pcMatch?.[1] ? Number.parseFloat(pcMatch[1]) : undefined,
    thrustKn: thrustMatch?.[1] ? Number.parseFloat(thrustMatch[1]) : undefined,
    ispSec: ispMatch?.[1] ? Number.parseFloat(ispMatch[1]) : undefined,
    massFlowKgSec: mdotMatch?.[1] ? Number.parseFloat(mdotMatch[1]) : undefined,
    turbopumpRpm: rpmMatch?.[1] ? Number.parseFloat(rpmMatch[1]) : undefined,
    cycleType: cycleMatch?.[1]?.trim(),
  };
}

export const RocetsViewer: React.FC<RocetsViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"diagram" | "code">("diagram");
  const title = viewConfig.title || viewConfig.engineName || "ROCETS Liquid Propulsion (.roc)";

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
        .catch((err) => console.warn("[RocetsViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const parsedClient = useMemo(() => (rawText ? parseRocetsClient(rawText) : undefined), [rawText]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    if (rawText.trim()) {
      return renderSourceToDiagramSvg(rawText, "rocets", title, true).svg;
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
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}-rocets.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenInPlayground = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: "rocets" as any,
      code: rawText,
      title,
    });
    const fromParam = viewConfig.artifactId ? `?fromArtifact=${encodeURIComponent(viewConfig.artifactId)}` : "";
    navigate(`/playground${fromParam}#m=${hash}`);
  };

  const cycleType = viewConfig.cycleType ?? parsedClient?.cycleType;
  const thrustKn = viewConfig.thrustKn ?? parsedClient?.thrustKn;
  const chamberPressureBar = viewConfig.chamberPressureBar ?? parsedClient?.chamberPressureBar;
  const ispSec = viewConfig.ispSec ?? parsedClient?.ispSec;
  const massFlowKgSec = viewConfig.massFlowKgSec ?? parsedClient?.massFlowKgSec;
  const turbopumpRpm = viewConfig.turbopumpRpm ?? parsedClient?.turbopumpRpm;
  const lines = useMemo(() => (rawText ? rawText.split(/\r?\n/) : []), [rawText]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <FlameIcon size={16} fill="#f87171" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>ROCETS Propulsion</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
          <SegmentedControl>
            <SegmentBtn type="button" $active={viewMode === "diagram"} onClick={() => setViewMode("diagram")}>
              <FlameIcon size={12} /> Schematic
            </SegmentBtn>
            <SegmentBtn type="button" $active={viewMode === "code"} onClick={() => setViewMode("code")}>
              <CodeIcon size={12} /> Deck Source
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
                  <span>{highlightPolyglotLine(line, "rocets")}</span>
                </CodeLine>
              ))
            ) : (
              <Box p={4} color="fg.muted">
                No ROCETS propulsion deck loaded.
              </Box>
            )}
          </CodePre>
        ) : (
          <SvgCanvas dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />
        )}

        <InspectorSidebar>
          <Text style={{ fontWeight: "bold", fontSize: "12px", color: "var(--color-fg-default)" }}>
            Propulsion Power Balance
          </Text>
          <StatItem>
            <span>Engine Cycle</span>
            <strong style={{ color: "#38bdf8" }}>{cycleType || "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Thrust</span>
            <strong>{thrustKn !== undefined ? `${thrustKn} kN` : "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Chamber Pressure</span>
            <strong>{chamberPressureBar !== undefined ? `${chamberPressureBar} bar` : "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Specific Impulse</span>
            <strong>{ispSec !== undefined ? `${ispSec} s` : "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Propellant Flow</span>
            <strong>{massFlowKgSec !== undefined ? `${massFlowKgSec} kg/s` : "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Turbopump RPM</span>
            <strong>{turbopumpRpm !== undefined ? `${turbopumpRpm.toLocaleString()} RPM` : "—"}</strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default RocetsViewer;
