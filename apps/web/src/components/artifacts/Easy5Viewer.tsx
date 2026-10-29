// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, PulseIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine } from "./PolyglotArtifactViewer";

export interface Easy5ViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    modelName?: string | undefined;
    componentCount?: number | undefined;
    connectionCount?: number | undefined;
    stateCount?: number | undefined;
    inputCount?: number | undefined;
    outputCount?: number | undefined;
    gainMarginDb?: number | undefined;
    phaseMarginDeg?: number | undefined;
    bodeData?: { freq: number; magnitudeDb: number; phaseDeg: number }[] | undefined;
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
  background: rgba(245, 158, 11, 0.15);
  color: var(--color-attention-fg, var(--color-fg-default));
  border: 1px solid rgba(245, 158, 11, 0.35);
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

const ChartCanvas = styled.div`
  flex: 1;
  padding: 16px;
  background: var(--color-canvas-inset, var(--color-canvas-default));
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

export const Easy5Viewer: React.FC<Easy5ViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const initialSource = (viewConfig.code || (viewConfig.source as string | undefined) || "") as string;
  const [rawText, setRawText] = useState(initialSource);
  const [viewMode, setViewMode] = useState<"diagram" | "bode" | "code">(() =>
    viewConfig.svg ? "diagram" : Array.isArray(viewConfig.bodeData) && viewConfig.bodeData.length > 0 ? "bode" : "code",
  );
  const title = viewConfig.title || viewConfig.modelName || "EASY5 Control Model (.ez5)";

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
        .catch((err) => console.warn("[Easy5Viewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.source, viewConfig.url]);

  const parsedModel = useMemo(() => {
    let compCount = 0;
    let connCount = 0;
    let stateCount = 0;
    for (const rawLine of rawText.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (/^(COMPONENT|BLOCK|SUBMODEL)\b/i.test(line)) {
        compCount++;
        if (/\b(IN|INTEGRATOR|LAG|POLE|TF|SECOND_ORDER|ACTUATOR|VALVE)\b/i.test(line)) stateCount++;
      } else if (/^CONNECT\b/i.test(line) || line.includes("->") || line.includes("-->")) {
        connCount++;
      }
    }
    return {
      componentCount: viewConfig.componentCount ?? compCount,
      connectionCount: viewConfig.connectionCount ?? connCount,
      stateCount: viewConfig.stateCount ?? stateCount,
      inputCount: viewConfig.inputCount,
      outputCount: viewConfig.outputCount,
    };
  }, [rawText, viewConfig]);

  const sanitizedSvg = useMemo(() => {
    if (typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    return "";
  }, [viewConfig.svg]);

  const bodeData = useMemo(() => {
    if (Array.isArray(viewConfig.bodeData) && viewConfig.bodeData.length > 0) {
      return viewConfig.bodeData;
    }
    return [];
  }, [viewConfig.bodeData]);

  const effectiveViewMode: "diagram" | "bode" | "code" =
    viewMode === "diagram" && sanitizedSvg ? "diagram" : viewMode === "bode" && bodeData.length > 0 ? "bode" : "code";

  const codeLines = rawText ? rawText.split(/\r?\n/) : [];

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PulseIcon size={16} fill="var(--color-attention-fg, currentColor)" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>EASY5 Dynamic Control</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
          {(sanitizedSvg || bodeData.length > 0) && (
            <SegmentedControl size="small" aria-label="Easy5 View Selector">
              {sanitizedSvg && (
                <SegmentedControl.Button
                  selected={effectiveViewMode === "diagram"}
                  onClick={() => setViewMode("diagram")}
                >
                  Block Diagram
                </SegmentedControl.Button>
              )}
              {bodeData.length > 0 && (
                <SegmentedControl.Button selected={effectiveViewMode === "bode"} onClick={() => setViewMode("bode")}>
                  Bode Response
                </SegmentedControl.Button>
              )}
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
                  lang: "easy5" as any,
                  code: rawText || `* ${title}\n`,
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
        ) : effectiveViewMode === "diagram" && sanitizedSvg ? (
          <SvgCanvas dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />
        ) : effectiveViewMode === "bode" && bodeData.length > 0 ? (
          <ChartCanvas style={{ display: "flex", flexDirection: "column" }}>
            <Box flex={1} style={{ minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={bodeData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ms-bg-soft)" />
                  <XAxis dataKey="freq" stroke="var(--ms-text-3)" tick={{ fontSize: 11 }} scale="log" unit="Hz" />
                  <YAxis stroke="var(--ms-text-3)" tick={{ fontSize: 11 }} />
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
                    dataKey="magnitudeDb"
                    stroke="#38bdf8"
                    dot={false}
                    strokeWidth={2}
                    name="Magnitude (dB)"
                  />
                  <Line
                    type="monotone"
                    dataKey="phaseDeg"
                    stroke="#ec4899"
                    dot={false}
                    strokeWidth={2}
                    name="Phase (deg)"
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
                    {highlightPolyglotLine(line, "easy5")}
                  </span>
                </div>
              ))
            ) : (
              <Box p={4} color="var(--color-fg-muted)" textAlign="center">
                No EASY5 model source available.
              </Box>
            )}
          </Box>
        )}

        <InspectorSidebar>
          <Text style={{ fontWeight: "bold", fontSize: "12px", color: "var(--color-fg-default)" }}>
            Control System Telemetry
          </Text>
          <StatItem>
            <span>Components</span>
            <strong>{parsedModel.componentCount}</strong>
          </StatItem>
          <StatItem>
            <span>Connections</span>
            <strong>{parsedModel.connectionCount}</strong>
          </StatItem>
          <StatItem>
            <span>States (n)</span>
            <strong>{parsedModel.stateCount}</strong>
          </StatItem>
          {parsedModel.inputCount !== undefined && (
            <StatItem>
              <span>Inputs (m)</span>
              <strong>{parsedModel.inputCount}</strong>
            </StatItem>
          )}
          {parsedModel.outputCount !== undefined && (
            <StatItem>
              <span>Outputs (p)</span>
              <strong>{parsedModel.outputCount}</strong>
            </StatItem>
          )}
          {viewConfig.gainMarginDb !== undefined && (
            <StatItem>
              <span>Gain Margin</span>
              <strong style={{ color: "#34d399" }}>{viewConfig.gainMarginDb} dB</strong>
            </StatItem>
          )}
          {viewConfig.phaseMarginDeg !== undefined && (
            <StatItem>
              <span>Phase Margin</span>
              <strong style={{ color: "#34d399" }}>{viewConfig.phaseMarginDeg}°</strong>
            </StatItem>
          )}
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default Easy5Viewer;
