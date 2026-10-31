// SPDX-License-Identifier: AGPL-3.0-or-later

import { renderSimulinkSvg, type SimulinkBlockLike, type SimulinkLineLike } from "@modelscript/diagram";
import { FlameIcon, PlayIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Spinner, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import {
  highlightPolyglotLine,
  InteractiveSvgStage,
  renderSourceToDiagramSvg,
  sanitizeSvgMarkup,
} from "./PolyglotArtifactViewer";

export interface GtSuiteViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    engineModel?: string | undefined;
    componentCount?: number | undefined;
    displacementLiters?: number | undefined;
    cylinderCount?: number | undefined;
    peakPressureBar?: number | undefined;
    imepBar?: number | undefined;
    thermalEfficiencyPct?: number | undefined;
    pvData?: { volumeCc: number; pressureBar: number }[] | undefined;
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
  background: rgba(249, 115, 22, 0.15);
  color: var(--color-attention-fg, var(--color-fg-default));
  border: 1px solid rgba(249, 115, 22, 0.35);
`;

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
`;

const ChartCanvas = styled.div`
  flex: 1;
  padding: 16px;
  background: var(--color-canvas-inset, var(--color-canvas-default));
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

export const GtSuiteViewer: React.FC<GtSuiteViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const initialSource = (viewConfig.code || (viewConfig.source as string | undefined) || "") as string;
  const [rawText, setRawText] = useState(initialSource);
  const [viewMode, setViewMode] = useState<"schematic" | "pv" | "code">("schematic");
  const title = viewConfig.title || viewConfig.engineModel || "GT-SUITE Powertrain (.gtm)";

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
        .catch((err) => console.warn("[GtSuiteViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.source, viewConfig.url]);

  const parsedEngine = useMemo(() => {
    const cylMatches = rawText ? Array.from(rawText.matchAll(/\b(EngCylinder|Cylinder)\b/gi)) : [];
    const compMatches = rawText
      ? Array.from(
          rawText.matchAll(
            /\b(EngCylinder|Cylinder|PipeRound|OrificeConn|FlowSplit|EnvAmbient|Turbine|Compressor)\b(?:\s+([A-Za-z0-9_.-]+))?/gi,
          ),
        )
      : [];
    const blocks: SimulinkBlockLike[] = compMatches.slice(0, 16).map((m, idx) => {
      const bType = m[1]!;
      const bName = m[2] && !/^(bore|stroke|length|diameter)$/i.test(m[2]) ? m[2] : `${bType}_${idx + 1}`;
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      const x = 60 + col * 190;
      const y = 60 + row * 100;
      return {
        name: bName,
        type: bType,
        position: { x, y, width: 130, height: 54 },
      };
    });
    const lines: SimulinkLineLike[] = [];
    for (let i = 0; i < blocks.length - 1; i++) {
      lines.push({
        id: `line_${i + 1}`,
        srcBlock: blocks[i]!.name,
        srcPort: 1,
        dstBlock: blocks[i + 1]!.name,
        dstPort: 1,
      });
    }
    const boreMatch = rawText.match(/\bbore\s*[=:]\s*([0-9.]+)/i);
    const strokeMatch = rawText.match(/\bstroke\s*[=:]\s*([0-9.]+)/i);
    const cylCount = viewConfig.cylinderCount ?? cylMatches.length;
    const boreMm = boreMatch ? Number(boreMatch[1]) : undefined;
    const strokeMm = strokeMatch ? Number(strokeMatch[1]) : undefined;
    let dispL = viewConfig.displacementLiters;
    if (dispL === undefined && boreMm && strokeMm && Math.max(1, cylCount) > 0) {
      const bMm = boreMm < 1 ? boreMm * 1000 : boreMm;
      const sMm = strokeMm < 1 ? strokeMm * 1000 : strokeMm;
      dispL = +((Math.max(1, cylCount) * Math.PI * Math.pow(bMm / 20, 2) * (sMm / 10)) / 1000).toFixed(2);
    }
    return {
      blocks,
      lines,
      cylinderCount: cylCount,
      componentCount: viewConfig.componentCount ?? compMatches.length,
      displacementLiters: dispL,
      boreMm,
      strokeMm,
    };
  }, [rawText, viewConfig]);

  const sanitizedSvg = useMemo(() => {
    if (typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen });
    }
    if (parsedEngine.blocks.length > 0) {
      try {
        const built = renderSimulinkSvg({
          name: title,
          blocks: parsedEngine.blocks,
          lines: parsedEngine.lines,
        });
        return sanitizeSvgMarkup(built, { isFullScreen });
      } catch {
        // fall through
      }
    }
    if (rawText.trim()) {
      const fallback = renderSourceToDiagramSvg(rawText, "gtsuite", title, true, isFullScreen);
      if (fallback.svg) return fallback.svg;
    }
    return "";
  }, [viewConfig.svg, parsedEngine, rawText, title, isFullScreen]);

  const pvData = useMemo(() => {
    if (Array.isArray(viewConfig.pvData) && viewConfig.pvData.length > 0) {
      return viewConfig.pvData;
    }
    return [];
  }, [viewConfig.pvData]);

  const effectiveViewMode: "schematic" | "pv" | "code" =
    viewMode === "schematic" && sanitizedSvg
      ? "schematic"
      : viewMode === "pv" && pvData.length > 0
        ? "pv"
        : sanitizedSvg && viewMode !== "code"
          ? "schematic"
          : pvData.length > 0 && viewMode !== "code"
            ? "pv"
            : "code";

  const codeLines = rawText ? rawText.split(/\r?\n/) : [];

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <FlameIcon size={16} fill="var(--color-attention-fg, currentColor)" />
          {!isFullScreen && <ModelTitle title={title}>{title}</ModelTitle>}
          <PillBadge>GT-SUITE Powertrain</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
          {(sanitizedSvg || pvData.length > 0) && (
            <SegmentedControl size="small" aria-label="GT-SUITE View Selector">
              {sanitizedSvg && (
                <SegmentedControl.Button
                  selected={effectiveViewMode === "schematic"}
                  onClick={() => setViewMode("schematic")}
                >
                  Schematic
                </SegmentedControl.Button>
              )}
              {pvData.length > 0 && (
                <SegmentedControl.Button selected={effectiveViewMode === "pv"} onClick={() => setViewMode("pv")}>
                  P-V Diagram
                </SegmentedControl.Button>
              )}
              <SegmentedControl.Button selected={effectiveViewMode === "code"} onClick={() => setViewMode("code")}>
                Source
              </SegmentedControl.Button>
            </SegmentedControl>
          )}

          {!isFullScreen && (
            <Button size="small" onClick={() => setShowInspector((s) => !s)}>
              {showInspector ? "Hide Telemetry" : "Telemetry"}
            </Button>
          )}

          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={PlayIcon}
              onClick={() => {
                const hash = compressMorselPayload({
                  v: 1,
                  lang: "gtsuite" as any,
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
        ) : effectiveViewMode === "schematic" && sanitizedSvg ? (
          <InteractiveSvgStage svgMarkup={sanitizedSvg} isFullScreen={isFullScreen} />
        ) : effectiveViewMode === "pv" && pvData.length > 0 ? (
          <ChartCanvas style={{ display: "flex", flexDirection: "column" }}>
            <Box flex={1} style={{ minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pvData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ms-bg-soft)" />
                  <XAxis
                    dataKey="volumeCc"
                    stroke="var(--ms-text-3)"
                    tick={{ fontSize: 11 }}
                    unit="cc"
                    name="Cylinder Volume"
                  />
                  <YAxis stroke="var(--ms-text-3)" tick={{ fontSize: 11 }} unit="bar" name="Pressure" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--ms-bg-alt)",
                      borderColor: "var(--ms-border)",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Line
                    type="monotone"
                    dataKey="pressureBar"
                    stroke="#fb923c"
                    dot={false}
                    strokeWidth={2.2}
                    name="In-Cylinder Pressure (bar)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </ChartCanvas>
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
                    {highlightPolyglotLine(line, "gtsuite")}
                  </span>
                </div>
              ))
            ) : (
              <Box p={4} color="var(--color-fg-muted)" textAlign="center">
                No GT-SUITE model source available.
              </Box>
            )}
          </Box>
        )}

        {!isFullScreen && showInspector && (
          <InspectorSidebar>
            <Text style={{ fontWeight: "bold", fontSize: "12px", color: "var(--color-fg-default)" }}>
              Engine Calibration Telemetry
            </Text>
            <StatItem>
              <span>Components</span>
              <strong>{parsedEngine.componentCount}</strong>
            </StatItem>
            <StatItem>
              <span>Cylinder Count</span>
              <strong>{parsedEngine.cylinderCount}</strong>
            </StatItem>
            {parsedEngine.displacementLiters !== undefined && (
              <StatItem>
                <span>Displacement</span>
                <strong>{parsedEngine.displacementLiters} L</strong>
              </StatItem>
            )}
            {viewConfig.peakPressureBar !== undefined && (
              <StatItem>
                <span>Peak Pressure (P_max)</span>
                <strong style={{ color: "#f87171" }}>{viewConfig.peakPressureBar} bar</strong>
              </StatItem>
            )}
            {viewConfig.imepBar !== undefined && (
              <StatItem>
                <span>IMEP</span>
                <strong>{viewConfig.imepBar} bar</strong>
              </StatItem>
            )}
            {viewConfig.thermalEfficiencyPct !== undefined && (
              <StatItem>
                <span>Brake Thermal Eff</span>
                <strong style={{ color: "#34d399" }}>{viewConfig.thermalEfficiencyPct}%</strong>
              </StatItem>
            )}
          </InspectorSidebar>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default GtSuiteViewer;
