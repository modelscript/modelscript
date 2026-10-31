// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  renderOlgaSchematicSvg,
  type OlgaFlowpathLike,
  type OlgaNodeLike,
  type OlgaValveLike,
} from "@modelscript/diagram";
import {
  AlertIcon,
  CheckCircleIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  PlayIcon,
  PulseIcon,
} from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine, InteractiveSvgStage, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

export interface OlgaFlowViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    pipelineName?: string | undefined;
    lengthKm?: number | undefined;
    diameterInches?: number | undefined;
    pressureDropBar?: number | undefined;
    liquidHoldupAvg?: number | undefined;
    slugRisk?: "low" | "medium" | "high" | undefined;
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
  height: 40px;
  min-height: 40px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const ModelTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-heading, var(--color-fg-default));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PillBadge = styled.span<{ $variant?: "olga" | "slug-low" | "slug-warn" }>`
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
      case "slug-low":
        return `
          background: rgba(16, 185, 129, 0.15);
          color: var(--color-success-fg, var(--color-fg-default));
          border: 1px solid rgba(16, 185, 129, 0.35);
        `;
      case "slug-warn":
        return `
          background: rgba(245, 158, 11, 0.15);
          color: var(--color-attention-fg, var(--color-fg-default));
          border: 1px solid rgba(245, 158, 11, 0.35);
        `;
      default:
        return `
          background: rgba(236, 72, 153, 0.15);
          color: var(--color-done-fg, var(--color-fg-default));
          border: 1px solid rgba(236, 72, 153, 0.35);
        `;
    }
  }}
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
  width: 240px;
  border-left: 1px solid var(--color-border-default);
  background: var(--color-canvas-subtle);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 14px;
  gap: 12px;

  @media (max-width: 768px) {
    display: none;
  }
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

function parseOlgaClient(code: string) {
  let totalLengthM = 0;
  for (const m of code.matchAll(/LENGTH\s*=\s*([0-9.eE+-]+)(?:\s*([A-Za-z]+))?/gi)) {
    const val = Number.parseFloat(m[1] || "0");
    const unit = (m[2] || "m").toLowerCase();
    if (!Number.isNaN(val)) {
      totalLengthM += unit === "km" ? val * 1000 : val;
    }
  }
  const diaMatch = code.match(/DIAMETER\s*=\s*([0-9.eE+-]+)(?:\s*([A-Za-z]+))?/i);
  let diameterInches: number | undefined;
  let diameterMeters = 0.3048;
  if (diaMatch?.[1]) {
    const d = Number.parseFloat(diaMatch[1]);
    const u = (diaMatch[2] || "m").toLowerCase();
    if (!Number.isNaN(d)) {
      diameterInches = u.startsWith("in") ? d : Number((d * 39.3701).toFixed(1));
      diameterMeters = u.startsWith("in") ? d * 0.0254 : d;
    }
  }

  const nodes: OlgaNodeLike[] = [];
  const flowpaths: OlgaFlowpathLike[] = [];
  const valves: OlgaValveLike[] = [];

  for (const em of code.matchAll(
    /\b(VALVE|CHOKE|PUMP|COMPRESSOR|SEPARATOR|HEATER)\b[^\n]*?\bLABEL\s*=\s*["']?([A-Za-z0-9_-]+)["']?/gi,
  )) {
    valves.push({
      name: em[2] || `V_${valves.length + 1}`,
      position: 500 * (valves.length + 1),
      diameter: diameterMeters,
      opening: 0.85,
    });
  }

  for (const bm of code.matchAll(/\bBRANCH\b[^\n]*?\bLABEL\s*=\s*["']?([A-Za-z0-9_-]+)["']?([^\n]*)/gi)) {
    const label = bm[1] || `FP_${flowpaths.length + 1}`;
    flowpaths.push({
      name: label,
      pipes: [
        {
          label: `PIPE_${flowpaths.length + 1}`,
          length: totalLengthM > 0 ? totalLengthM : 5000,
          elevation: 0,
          diameter: diameterMeters,
        },
      ],
      valves: flowpaths.length === 0 ? valves : [],
    });
  }

  const defaultFp = flowpaths[0]?.name || "FLOWLINE";

  for (const nm of code.matchAll(/\bNODE\b[^\n]*?\bLABEL\s*=\s*["']?([A-Za-z0-9_-]+)["']?([^\n]*)/gi)) {
    const label = nm[1] || `N_${nodes.length + 1}`;
    const rest = nm[2] || "";
    const typeMatch = rest.match(/\bTYPE\s*=\s*([A-Za-z]+)/i);
    const pMatch = rest.match(/\bPRESSURE\s*=\s*([0-9.eE+-]+)/i);
    const tMatch = rest.match(/\bTEMPERATURE\s*=\s*([0-9.eE+-]+)/i);
    nodes.push({
      name: label,
      type: typeMatch?.[1] || (nodes.length === 0 ? "CLOSED" : "PRESSURE"),
      flowpath: defaultFp,
      boundaryPosition: nodes.length === 0 ? 0 : totalLengthM > 0 ? totalLengthM : 5000,
      ...(pMatch?.[1] ? { pressure: Number.parseFloat(pMatch[1]) } : {}),
      ...(tMatch?.[1] ? { temperature: Number.parseFloat(tMatch[1]) } : {}),
    });
  }

  if (flowpaths.length === 0 && (totalLengthM > 0 || code.trim().length > 0)) {
    if (nodes.length < 2) {
      nodes.push({
        name: "INLET",
        type: "MASS",
        flowpath: "FLOWLINE",
        boundaryPosition: 0,
        pressure: 120,
        temperature: 65,
      });
      nodes.push({
        name: "OUTLET",
        type: "PRESSURE",
        flowpath: "FLOWLINE",
        boundaryPosition: totalLengthM > 0 ? totalLengthM : 4500,
        pressure: 45,
        temperature: 25,
      });
    }
    flowpaths.push({
      name: "FLOWLINE",
      pipes: [
        {
          label: "P1",
          length: totalLengthM > 0 ? totalLengthM : 4500,
          elevation: 150,
          diameter: diameterMeters,
        },
      ],
      valves,
    });
  }

  const pipeCount = Array.from(code.matchAll(/\bPIPE\b|\bBRANCH\b/gi)).length;
  return {
    nodes,
    flowpaths,
    lengthKm: totalLengthM > 0 ? Number((totalLengthM / 1000).toFixed(2)) : undefined,
    diameterInches,
    pipeCount: pipeCount > 0 ? pipeCount : undefined,
  };
}

export const OlgaFlowViewer: React.FC<OlgaFlowViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"diagram" | "code">("diagram");
  const [showInspector, setShowInspector] = useState(false);
  const title = viewConfig.title || viewConfig.pipelineName || "OLGA Flow Assurance (.opi)";

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
        .catch((err) => console.warn("[OlgaFlowViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const parsedClient = useMemo(() => (rawText ? parseOlgaClient(rawText) : undefined), [rawText]);

  const sanitizedSvg = useMemo(() => {
    if (typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen });
    }
    if (parsedClient && parsedClient.flowpaths.length > 0) {
      try {
        const built = renderOlgaSchematicSvg({
          title,
          nodes: parsedClient.nodes,
          flowpaths: parsedClient.flowpaths,
        });
        return sanitizeSvgMarkup(built, { isFullScreen });
      } catch {
        return "";
      }
    }
    return "";
  }, [viewConfig.svg, parsedClient, title, isFullScreen]);

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
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}-olga.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenInPlayground = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: "olga" as any,
      code: rawText,
      title,
    });
    const fromParam = viewConfig.artifactId ? `?fromArtifact=${encodeURIComponent(viewConfig.artifactId)}` : "";
    navigate(`/playground${fromParam}#m=${hash}`);
  };

  const slugRisk = viewConfig.slugRisk;
  const lengthKm = viewConfig.lengthKm ?? parsedClient?.lengthKm;
  const diameterInches = viewConfig.diameterInches ?? parsedClient?.diameterInches;
  const lines = useMemo(() => (rawText ? rawText.split(/\r?\n/) : []), [rawText]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PulseIcon size={16} fill="var(--color-done-fg, currentColor)" />
          {!isFullScreen && <ModelTitle title={title}>{title}</ModelTitle>}
          <PillBadge>OLGA Multiphase</PillBadge>
          {slugRisk && (
            <PillBadge $variant={slugRisk === "low" ? "slug-low" : "slug-warn"}>
              {slugRisk === "low" ? <CheckCircleIcon size={12} /> : <AlertIcon size={12} />}
              Slugging Risk: {slugRisk.toUpperCase()}
            </PillBadge>
          )}
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
          {sanitizedSvg && (
            <SegmentedControl>
              <SegmentBtn
                type="button"
                $active={effectiveViewMode === "diagram"}
                onClick={() => setViewMode("diagram")}
              >
                <PulseIcon size={12} /> Profile
              </SegmentBtn>
              <SegmentBtn type="button" $active={effectiveViewMode === "code"} onClick={() => setViewMode("code")}>
                <CodeIcon size={12} /> Input Deck
              </SegmentBtn>
            </SegmentedControl>
          )}
          {!isFullScreen && (
            <Button size="small" onClick={() => setShowInspector((s) => !s)}>
              {showInspector ? "Hide Telemetry" : "Telemetry"}
            </Button>
          )}
          {sanitizedSvg && (
            <Button size="small" leadingVisual={DownloadIcon} onClick={handleExportSvg}>
              SVG
            </Button>
          )}
          <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          {Boolean(viewConfig?.standalone) && !isFullScreen && (
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
                  <span>{highlightPolyglotLine(line, "olga")}</span>
                </CodeLine>
              ))
            ) : (
              <Box p={4} color="fg.muted">
                No OLGA input deck loaded.
              </Box>
            )}
          </CodePre>
        ) : (
          <InteractiveSvgStage svgMarkup={sanitizedSvg} isFullScreen={isFullScreen} />
        )}

        {!isFullScreen && showInspector && (
          <InspectorSidebar>
            <Text style={{ fontWeight: "bold", fontSize: "12px", color: "var(--color-fg-default)" }}>
              Flow Assurance Telemetry
            </Text>
            <StatItem>
              <span>Total Length</span>
              <strong>{lengthKm !== undefined ? `${lengthKm} km` : "—"}</strong>
            </StatItem>
            <StatItem>
              <span>Nominal Diameter</span>
              <strong>{diameterInches !== undefined ? `${diameterInches}"` : "—"}</strong>
            </StatItem>
            {parsedClient?.pipeCount !== undefined && (
              <StatItem>
                <span>Pipes / Branches</span>
                <strong>{parsedClient.pipeCount}</strong>
              </StatItem>
            )}
            <StatItem>
              <span>Pressure Drop (ΔP)</span>
              <strong>{viewConfig.pressureDropBar !== undefined ? `${viewConfig.pressureDropBar} bar` : "—"}</strong>
            </StatItem>
            <StatItem>
              <span>Avg Liquid Holdup</span>
              <strong>
                {viewConfig.liquidHoldupAvg !== undefined ? `${(viewConfig.liquidHoldupAvg * 100).toFixed(1)}%` : "—"}
              </strong>
            </StatItem>
          </InspectorSidebar>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default OlgaFlowViewer;
