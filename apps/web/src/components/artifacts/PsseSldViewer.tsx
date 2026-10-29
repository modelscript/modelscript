// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CodeIcon, CopyIcon, DownloadIcon, PlayIcon, ZapIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine } from "./PolyglotArtifactViewer";

export interface PsseSldViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    metrics?:
      | {
          busCount?: number;
          generatorCount?: number;
          branchCount?: number;
          transformerCount?: number;
          totalGenMw?: number;
          totalLoadMw?: number;
          lossesMw?: number;
        }
      | undefined;
    buses?: { id: number; name: string; baseKv: number; vm: number; va: number }[];
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
  background: rgba(16, 185, 129, 0.15);
  color: var(--color-success-fg, var(--color-fg-default));
  border: 1px solid rgba(16, 185, 129, 0.35);
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

function parsePsseRawClient(code: string) {
  const lines = code.split(/\r?\n/);
  let section = 0; // 0 = header/bus, 1 = load, 2 = fixed shunt, 3 = generator, 4 = branch, 5 = transformer
  let busCount = 0;
  let loadMw = 0;
  let genMw = 0;
  let branchCount = 0;
  let minVm = Number.POSITIVE_INFINITY;
  let maxVm = Number.NEGATIVE_INFINITY;

  for (let i = 3; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line || line.startsWith("@!") || line.startsWith("/")) continue;
    if (/^0\s*\/|^\s*Q\b/i.test(line)) {
      section++;
      continue;
    }
    const parts = line.split(",").map((p) => p.trim());
    if (section === 0 && parts.length >= 8) {
      busCount++;
      const vm = Number.parseFloat(parts[7] || "");
      if (!Number.isNaN(vm) && vm > 0) {
        if (vm < minVm) minVm = vm;
        if (vm > maxVm) maxVm = vm;
      }
    } else if (section === 1 && parts.length >= 6) {
      const pl = Number.parseFloat(parts[5] || "");
      if (!Number.isNaN(pl)) loadMw += pl;
    } else if (section === 3 && parts.length >= 3) {
      const pg = Number.parseFloat(parts[2] || "");
      if (!Number.isNaN(pg)) genMw += pg;
    } else if (section === 4 && parts.length >= 3) {
      branchCount++;
    }
  }
  return {
    busCount: busCount > 0 ? busCount : undefined,
    totalLoadMw: loadMw > 0 ? Number(loadMw.toFixed(1)) : undefined,
    totalGenMw: genMw > 0 ? Number(genMw.toFixed(1)) : undefined,
    branchCount: branchCount > 0 ? branchCount : undefined,
    minVm: Number.isFinite(minVm) ? minVm : undefined,
    maxVm: Number.isFinite(maxVm) ? maxVm : undefined,
  };
}

export const PsseSldViewer: React.FC<PsseSldViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"diagram" | "code">(() => (viewConfig.svg ? "diagram" : "code"));
  const title = viewConfig.title || "PSS/E Power Flow Case (.raw)";

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
        .catch((err) => console.warn("[PsseSldViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const parsedClient = useMemo(() => (rawText ? parsePsseRawClient(rawText) : undefined), [rawText]);

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
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}-sld.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenInPlayground = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: "psse" as any,
      code: rawText,
      title,
    });
    const fromParam = viewConfig.artifactId ? `?fromArtifact=${encodeURIComponent(viewConfig.artifactId)}` : "";
    navigate(`/playground${fromParam}#m=${hash}`);
  };

  const metrics = viewConfig.metrics;
  const busCount = metrics?.busCount ?? viewConfig.buses?.length ?? parsedClient?.busCount;
  const totalGenMw = metrics?.totalGenMw ?? parsedClient?.totalGenMw;
  const totalLoadMw = metrics?.totalLoadMw ?? parsedClient?.totalLoadMw;
  const lossesMw =
    metrics?.lossesMw ??
    (totalGenMw !== undefined && totalLoadMw !== undefined && totalGenMw >= totalLoadMw
      ? Number((totalGenMw - totalLoadMw).toFixed(2))
      : undefined);
  const lines = useMemo(() => (rawText ? rawText.split(/\r?\n/) : []), [rawText]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <ZapIcon size={16} fill="var(--color-success-fg, currentColor)" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>PSS/E RAW SLD</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
          {sanitizedSvg && (
            <SegmentedControl>
              <SegmentBtn
                type="button"
                $active={effectiveViewMode === "diagram"}
                onClick={() => setViewMode("diagram")}
              >
                <ZapIcon size={12} /> SLD
              </SegmentBtn>
              <SegmentBtn type="button" $active={effectiveViewMode === "code"} onClick={() => setViewMode("code")}>
                <CodeIcon size={12} /> Raw Data
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
                  <span>{highlightPolyglotLine(line, "psse")}</span>
                </CodeLine>
              ))
            ) : (
              <Box p={4} color="fg.muted">
                No PSS/E RAW source loaded.
              </Box>
            )}
          </CodePre>
        ) : (
          <SvgCanvas dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />
        )}

        <InspectorSidebar>
          <Text style={{ fontWeight: "bold", fontSize: "12px", color: "var(--color-fg-default)" }}>
            Power Flow Case Overview
          </Text>
          <StatItem>
            <span>Total Buses</span>
            <strong>{busCount ?? "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Total Generation</span>
            <strong>{totalGenMw !== undefined ? `${totalGenMw} MW` : "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Total Load</span>
            <strong>{totalLoadMw !== undefined ? `${totalLoadMw} MW` : "—"}</strong>
          </StatItem>
          <StatItem>
            <span>Losses (I²R)</span>
            <strong>{lossesMw !== undefined ? `${lossesMw} MW` : "—"}</strong>
          </StatItem>
          {parsedClient?.minVm !== undefined && parsedClient?.maxVm !== undefined && (
            <StatItem>
              <span>Voltage Profile</span>
              <strong style={{ color: "#34d399" }}>
                {parsedClient.minVm.toFixed(3)} – {parsedClient.maxVm.toFixed(3)} pu
              </strong>
            </StatItem>
          )}
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default PsseSldViewer;
