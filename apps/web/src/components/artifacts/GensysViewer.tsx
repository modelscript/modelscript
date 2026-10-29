// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, PlayIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import MultibodyViewport3D, { type MultibodyLink3D, type MultibodyNode3D } from "./MultibodyViewport3D";
import { highlightPolyglotLine } from "./PolyglotArtifactViewer";

export interface GensysViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    modelName?: string | undefined;
    bodies?: { name: string; mass?: number; cg?: [number, number, number] }[] | undefined;
    couplings?: { name: string; type?: string; from?: string; to?: string; stiffness?: number }[] | undefined;
    wheelsetCount?: number | undefined;
    carbodyMassKg?: number | undefined;
    bogieCount?: number | undefined;
    secondaryKz?: number | undefined;
    derailmentQuotientYQ?: number | undefined;
    prudhommeLimitKn?: number | undefined;
    prudhommeActualKn?: number | undefined;
    en14363Compliant?: boolean | undefined;
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

const Title = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-fg-default, #e6edf3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Badge = styled.span<{ $variant?: "success" | "warning" | "info" }>`
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 12px;
  background: ${(p) =>
    p.$variant === "success"
      ? "rgba(46, 160, 67, 0.15)"
      : p.$variant === "warning"
        ? "rgba(210, 153, 34, 0.15)"
        : "rgba(56, 139, 253, 0.15)"};
  color: ${(p) =>
    p.$variant === "success"
      ? "var(--color-success-fg, #3fb950)"
      : p.$variant === "warning"
        ? "var(--color-attention-fg, #d29922)"
        : "var(--color-accent-fg, #58a6ff)"};
  border: 1px solid
    ${(p) =>
      p.$variant === "success"
        ? "rgba(46, 160, 67, 0.3)"
        : p.$variant === "warning"
          ? "rgba(210, 153, 34, 0.3)"
          : "rgba(56, 139, 253, 0.3)"};
`;

const ContentArea = styled.div`
  flex: 1;
  position: relative;
  overflow: auto;
  padding: 16px;
  background: var(--color-canvas-subtle, #161b22);
`;

const MetricGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
`;

const MetricCard = styled.div`
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const MetricLabel = styled.span`
  font-size: 11px;
  color: var(--color-fg-muted, #8b949e);
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const MetricValue = styled.span`
  font-size: 18px;
  font-weight: 600;
  color: var(--color-fg-default, #e6edf3);
`;

const SvgContainer = styled.div`
  width: 100%;
  min-height: 240px;
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 12px;

  svg {
    max-width: 100%;
    height: auto;
  }
`;

function parseGensysDeckClient(deck: string) {
  const bodies: { name: string; mass: number; cg?: [number, number, number] }[] = [];
  const couplings: { name: string; type: string; from: string; to: string; stiffness?: number }[] = [];
  let wheelsetCount = 0;

  for (const rawLine of deck.split(/\r?\n/)) {
    const line = rawLine.replace(/[#%!].*$/, "").trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    const cmd = tokens[0]?.toLowerCase();
    if ((cmd === "mass" || cmd === "body") && tokens.length >= 2) {
      const bType = tokens[1]?.toLowerCase() || "";
      const hasSubtype = bType.startsWith("m_") || bType === "rigid" || bType === "whe_set_m";
      const name = (hasSubtype ? tokens[2] : tokens[1]) || `body_${bodies.length + 1}`;
      const numStart = hasSubtype ? 3 : 2;
      const rawX = Number(tokens[numStart]);
      const rawY = Number(tokens[numStart + 1]);
      const rawZ = Number(tokens[numStart + 2]);
      const hasCoords =
        tokens.length >= numStart + 3 && Number.isFinite(rawX) && Number.isFinite(rawY) && Number.isFinite(rawZ);
      const m = Number(tokens[numStart + 3] ?? tokens[numStart]) || 0;
      bodies.push({
        name,
        mass: Number.isFinite(m) ? m : 0,
        ...(hasCoords ? { cg: [rawX, rawY, rawZ] } : {}),
      });
      if (bType.includes("whe") || /axl|wheel|ws/i.test(name)) wheelsetCount++;
    } else if (cmd === "coupl" && tokens.length >= 5) {
      const cType = tokens[1]!;
      const name = tokens[2]!;
      const from = tokens[3]!;
      const to = tokens[4]!;
      const k = Number(tokens[8] ?? tokens[5]);
      couplings.push({
        name,
        type: cType,
        from,
        to,
        ...(Number.isFinite(k) ? { stiffness: k } : {}),
      });
    } else if (cmd === "wheelset" || cmd === "kpf") {
      wheelsetCount++;
    }
  }
  return { bodies, couplings, wheelsetCount };
}

const GensysViewer: React.FC<GensysViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState<number>(() => (viewConfig.svg ? 0 : 2));
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!viewConfig.code && viewConfig.url) {
      setIsLoading(true);
      const targetUrl =
        viewConfig.url.startsWith("http") || viewConfig.url.startsWith("/api")
          ? viewConfig.url
          : `/api${viewConfig.url}`;
      fetch(targetUrl)
        .then((res) => (res.ok ? res.text() : ""))
        .then((text) => setFetchedCode(text))
        .catch(() => setFetchedCode(null))
        .finally(() => setIsLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const rawDeck = viewConfig.code || fetchedCode || "";
  const modelName = viewConfig.modelName || viewConfig.title || "GENSYS Vehicle Model";

  const parsed = useMemo(() => parseGensysDeckClient(rawDeck), [rawDeck]);
  const bodies = viewConfig.bodies?.length ? viewConfig.bodies : parsed.bodies;
  const couplings = viewConfig.couplings?.length ? viewConfig.couplings : parsed.couplings;
  const wheelsetCount = viewConfig.wheelsetCount ?? parsed.wheelsetCount;

  const totalMassKg = useMemo(() => {
    if (viewConfig.carbodyMassKg !== undefined) return viewConfig.carbodyMassKg;
    return bodies.reduce((acc, b) => acc + (b.mass || 0), 0);
  }, [viewConfig.carbodyMassKg, bodies]);

  const svgMarkup = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    return "";
  }, [viewConfig.svg]);

  const { nodes3D, links3D } = useMemo(() => {
    const nodes: MultibodyNode3D[] = [];
    const links: MultibodyLink3D[] = [];
    const posMap = new Map<string, [number, number, number]>();

    bodies.forEach((b) => {
      if (!Array.isArray(b.cg) || b.cg.length !== 3) return;
      const isWheel = /axl|wheel|ws/i.test(b.name);
      const pos: [number, number, number] = b.cg;
      posMap.set(b.name, pos);
      nodes.push({
        id: b.name,
        name: b.name,
        type: isWheel ? "wheelset" : "body",
        position: pos,
        color: isWheel ? "#94a3b8" : "#58a6ff",
      });
    });

    couplings.forEach((c) => {
      const p1 = posMap.get(c.from || "");
      const p2 = posMap.get(c.to || "");
      if (p1 && p2) {
        links.push({
          id: c.name,
          name: c.name,
          type: "spring_damper",
          from: p1,
          to: p2,
        });
      }
    });

    return { nodes3D: nodes, links3D: links };
  }, [bodies, couplings]);

  const handleOpenPlayground = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: "gensys" as any,
      code: rawDeck || `## ${modelName}\n`,
      title: modelName,
    });
    const fromArtifact = viewConfig.artifactId ? `?fromArtifact=${viewConfig.artifactId}` : "";
    navigate(`/playground${fromArtifact}#m=${hash}`);
  };

  const codeLines = rawDeck ? rawDeck.split(/\r?\n/) : [];

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <Title>{modelName}</Title>
          <Badge $variant="info">GENSYS RAILWAY</Badge>
          {viewConfig.en14363Compliant !== undefined && (
            <Badge $variant={viewConfig.en14363Compliant ? "success" : "warning"}>
              {viewConfig.en14363Compliant && (
                <span style={{ verticalAlign: "middle", marginRight: 4, display: "inline-flex" }}>
                  <CheckCircleIcon size={12} />
                </span>
              )}
              {viewConfig.en14363Compliant ? "EN 14363 PASS" : "EN 14363 CHECK"}
            </Badge>
          )}
        </HeaderLeft>
        <Box display="flex" alignItems="center" gap={2}>
          <SegmentedControl size="small" aria-label="GENSYS Views">
            <SegmentedControl.Button selected={tabIndex === 0} onClick={() => setTabIndex(0)}>
              Topology
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={tabIndex === 1} onClick={() => setTabIndex(1)}>
              3D View
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={tabIndex === 2} onClick={() => setTabIndex(2)}>
              Deck Source
            </SegmentedControl.Button>
          </SegmentedControl>
          {Boolean(viewConfig?.standalone) && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={PlayIcon}
              onClick={handleOpenPlayground}
              title="Open in Playground"
            >
              Open in Playground
            </Button>
          )}
        </Box>
      </Toolbar>

      <ContentArea>
        {isLoading ? (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <Spinner size="large" />
          </Box>
        ) : tabIndex === 0 ? (
          <div>
            <MetricGrid>
              <MetricCard>
                <MetricLabel>Bodies / Masses</MetricLabel>
                <MetricValue>{bodies.length}</MetricValue>
              </MetricCard>
              <MetricCard>
                <MetricLabel>Couplings (coupl)</MetricLabel>
                <MetricValue>{couplings.length}</MetricValue>
              </MetricCard>
              <MetricCard>
                <MetricLabel>Wheelsets</MetricLabel>
                <MetricValue>{wheelsetCount}</MetricValue>
              </MetricCard>
              {totalMassKg > 0 && (
                <MetricCard>
                  <MetricLabel>Total Mass</MetricLabel>
                  <MetricValue>{totalMassKg.toLocaleString()} kg</MetricValue>
                </MetricCard>
              )}
              {viewConfig.derailmentQuotientYQ !== undefined && (
                <MetricCard>
                  <MetricLabel>Derailment Quotient (Y/Q)</MetricLabel>
                  <MetricValue>{viewConfig.derailmentQuotientYQ.toFixed(3)}</MetricValue>
                </MetricCard>
              )}
            </MetricGrid>

            {svgMarkup ? (
              <SvgContainer dangerouslySetInnerHTML={{ __html: svgMarkup }} />
            ) : (
              <SvgContainer>
                <Text style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                  No GENSYS topology diagram elements found. Switch to Deck Source to inspect the file.
                </Text>
              </SvgContainer>
            )}
          </div>
        ) : tabIndex === 1 ? (
          <div>
            <Box mb={2} display="flex" justifyContent="space-between" alignItems="center">
              <Text style={{ fontSize: "12px", fontWeight: "bold" }}>3D Railway Vehicle Dynamics Viewport</Text>
              <Text style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                {nodes3D.length} bodies • {links3D.length} couplings
              </Text>
            </Box>
            <MultibodyViewport3D
              nodes={nodes3D}
              links={links3D}
              height={isFullScreen ? "calc(100vh - 140px)" : "320px"}
            />
          </div>
        ) : (
          <Box
            py={2}
            bg="var(--color-canvas-default, #0d1117)"
            border="1px solid var(--color-border-default, #30363d)"
            borderRadius="6px"
            overflow="auto"
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
                    {highlightPolyglotLine(line, "gensys")}
                  </span>
                </div>
              ))
            ) : (
              <Box p={3} color="var(--color-fg-muted)">
                # No GENSYS deck content loaded.
              </Box>
            )}
          </Box>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default GensysViewer;
