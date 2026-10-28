// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeIcon, PlayIcon, WorkflowIcon, ZapIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { runPhysicsJob } from "../../api";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine } from "./PolyglotArtifactViewer";
import SimulationResultViewer from "./SimulationResultViewer";

export interface FeaDeckViewerProps {
  artifactId?: number | undefined;
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    meshName?: string | undefined;
    nodeCount?: number | undefined;
    nodes?: number | undefined;
    elementCount?: number | undefined;
    elements?: number | undefined;
    elementType?: string | undefined;
    youngsModulusGpa?: number | undefined;
    poissonsRatio?: number | undefined;
    loadKn?: number | undefined;
    geometryHash?: string | undefined;
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
  background: rgba(14, 165, 233, 0.15);
  color: #38bdf8;
  border: 1px solid rgba(14, 165, 233, 0.35);
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

function parseCalculixDeckClient(text: string) {
  const nodes: { id: number; x: number; y: number; z: number }[] = [];
  const elements: { id: number; type: string; nodes: number[] }[] = [];
  let elementType: string | undefined;
  let youngsModulusGpa: number | undefined;
  let poissonsRatio: number | undefined;
  let totalLoadN = 0;

  if (!text.trim()) {
    return { nodes, elements, elementType, youngsModulusGpa, poissonsRatio, loadKn: undefined };
  }

  let section = "";
  let currentElemType = "C3D8";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("**")) continue;
    if (line.startsWith("*")) {
      const upper = line.toUpperCase();
      if (upper.startsWith("*NODE")) section = "NODE";
      else if (upper.startsWith("*ELEMENT")) {
        section = "ELEMENT";
        const tm = line.match(/TYPE\s*=\s*([A-Za-z0-9_]+)/i);
        if (tm?.[1]) {
          currentElemType = tm[1].toUpperCase();
          if (!elementType) elementType = currentElemType;
        }
      } else if (upper.startsWith("*ELASTIC")) section = "ELASTIC";
      else if (upper.startsWith("*CLOAD")) section = "CLOAD";
      else section = "OTHER";
      continue;
    }

    const parts = line
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (section === "NODE" && parts.length >= 3) {
      const id = Number(parts[0]);
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3] ?? 0);
      if (Number.isFinite(id) && Number.isFinite(x) && Number.isFinite(y)) {
        nodes.push({ id, x, y, z });
      }
    } else if (section === "ELEMENT" && parts.length >= 3) {
      const id = Number(parts[0]);
      const nids = parts.slice(1).map(Number).filter(Number.isFinite);
      if (Number.isFinite(id) && nids.length >= 2) {
        elements.push({ id, type: currentElemType, nodes: nids });
      }
    } else if (section === "ELASTIC" && parts.length >= 2) {
      const E = Number(parts[0]);
      const nu = Number(parts[1]);
      if (Number.isFinite(E)) youngsModulusGpa = E > 1e6 ? +(E / 1e9).toFixed(1) : +E.toFixed(1);
      if (Number.isFinite(nu)) poissonsRatio = nu;
    } else if (section === "CLOAD" && parts.length >= 3) {
      const f = Math.abs(Number(parts[2]));
      if (Number.isFinite(f)) totalLoadN += f;
    }
  }

  return {
    nodes,
    elements,
    elementType,
    youngsModulusGpa,
    poissonsRatio,
    loadKn: totalLoadN > 0 ? +(totalLoadN / 1000).toFixed(2) : undefined,
  };
}

export const FeaDeckViewer: React.FC<FeaDeckViewerProps> = ({ artifactId, viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [runningSim, setRunningSim] = useState(false);
  const [simCompleted, setSimCompleted] = useState(false);
  const [completedResultConfig, setCompletedResultConfig] = useState<any>(null);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"diagram" | "code">("diagram");
  const title = viewConfig.title || viewConfig.meshName || "FEA Simulation Deck (.inp)";

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
        .catch((err) => console.warn("[FeaDeckViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const parsedDeck = useMemo(() => parseCalculixDeckClient(rawText), [rawText]);

  const nodeCount = viewConfig.nodeCount ?? viewConfig.nodes ?? parsedDeck.nodes.length;
  const elementCount = viewConfig.elementCount ?? viewConfig.elements ?? parsedDeck.elements.length;
  const elementType = viewConfig.elementType ?? parsedDeck.elementType;
  const youngsModulusGpa = viewConfig.youngsModulusGpa ?? parsedDeck.youngsModulusGpa;
  const poissonsRatio = viewConfig.poissonsRatio ?? parsedDeck.poissonsRatio;
  const loadKn = viewConfig.loadKn ?? parsedDeck.loadKn;

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    if (parsedDeck.nodes.length === 0) {
      return "";
    }
    const width = 650;
    const height = 340;
    const pad = 44;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const n of parsedDeck.nodes) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);
    const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2 - 24) / spanY);
    const nodeMap = new Map<number, [number, number]>();
    for (const n of parsedDeck.nodes) {
      nodeMap.set(n.id, [+(pad + (n.x - minX) * scale).toFixed(1), +(height - pad - (n.y - minY) * scale).toFixed(1)]);
    }
    const polys = parsedDeck.elements.slice(0, 500).map((el) => {
      const pts = el.nodes.map((nid) => nodeMap.get(nid)).filter(Boolean) as [number, number][];
      if (pts.length >= 3) {
        return `<polygon points="${pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="rgba(56, 189, 248, 0.12)" stroke="#38bdf8" stroke-width="1"/>`;
      }
      if (pts.length === 2) {
        return `<line x1="${pts[0]![0]}" y1="${pts[0]![1]}" x2="${pts[1]![0]}" y2="${pts[1]![1]}" stroke="#38bdf8" stroke-width="1.5"/>`;
      }
      return "";
    });
    return DOMPurify.sanitize(`
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
        <text x="20" y="26" fill="var(--ms-text-1)" font-size="12" font-weight="bold" font-family="monospace">${title}</text>
        ${polys.join("\n")}
      </svg>
    `);
  }, [viewConfig.svg, parsedDeck, title]);

  const [simError, setSimError] = useState<string | null>(null);

  const handleRunSimulationLocally = async () => {
    setRunningSim(true);
    setSimError(null);
    try {
      const geoHash =
        (viewConfig.geometryHash as string) || "0000000000000000000000000000000000000000000000000000000000000000";
      const studyConfig = {
        type: "FEA",
        workflowClass: "StaticStructuralFEA",
        material: {
          E: (youngsModulusGpa ?? 210) * 1e9,
          nu: poissonsRatio ?? 0.3,
        },
        boundaryConditions: {
          loadKn: loadKn ?? 1.0,
        },
      };

      const result = await runPhysicsJob({ geometryHash: geoHash, config: studyConfig });
      if (result?.jobId) {
        setSimCompleted(true);
        setCompletedResultConfig({
          url: `/api/v1/physics/${result.jobId}/result`,
          resultVtuUrl: `/api/v1/physics/${result.jobId}/result`,
          title: `Solved: ${title}`,
          scalarField: "VonMisesStress",
        });
      } else {
        throw new Error("No job ID returned from physics solver service");
      }
    } catch (err: any) {
      console.warn("[FeaDeckViewer] Local simulation failed:", err);
      setSimError(err?.response?.data?.error || err.message || "FEA simulation failed");
    } finally {
      setRunningSim(false);
    }
  };

  if (simCompleted && completedResultConfig) {
    return (
      <SimulationResultViewer artifactId={artifactId} viewConfig={completedResultConfig} isFullScreen={isFullScreen} />
    );
  }

  const codeLines = rawText ? rawText.split(/\r?\n/) : [];

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <ZapIcon size={16} fill="#38bdf8" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>CalculiX FEA Deck</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
          <Box
            display="flex"
            bg="rgba(0,0,0,0.25)"
            borderRadius="6px"
            p="2px"
            border="1px solid var(--color-border-default)"
          >
            <button
              type="button"
              onClick={() => setViewMode("diagram")}
              style={{
                background: viewMode === "diagram" ? "rgba(14, 165, 233, 0.25)" : "transparent",
                color: viewMode === "diagram" ? "#38bdf8" : "var(--color-fg-muted)",
                border: "none",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <WorkflowIcon size={12} /> Mesh
            </button>
            <button
              type="button"
              onClick={() => setViewMode("code")}
              style={{
                background: viewMode === "code" ? "rgba(14, 165, 233, 0.25)" : "transparent",
                color: viewMode === "code" ? "#38bdf8" : "var(--color-fg-muted)",
                border: "none",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <CodeIcon size={12} /> Deck
            </button>
          </Box>
          <Button
            size="small"
            leadingVisual={runningSim ? Spinner : PlayIcon}
            disabled={runningSim}
            onClick={handleRunSimulationLocally}
          >
            {runningSim ? "Solving..." : "Run Solver"}
          </Button>

          {Boolean(viewConfig?.standalone) && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={CodeIcon}
              onClick={() => {
                const hash = compressMorselPayload({
                  v: 1,
                  lang: "fea" as any,
                  code: rawText || `*HEADING\n${title}\n`,
                  title,
                });
                const resolvedId = artifactId ?? viewConfig.artifactId;
                const fromArtifact = resolvedId ? `?fromArtifact=${resolvedId}` : "";
                navigate(`/playground${fromArtifact}#m=${hash}`);
              }}
            >
              Open in Playground
            </Button>
          )}
        </Box>
      </Toolbar>

      {simError && (
        <Box px={3} py={2} bg="rgba(248, 81, 73, 0.15)" borderBottom="1px solid var(--color-danger-border)">
          <Text style={{ fontSize: "12px", color: "var(--color-danger-fg)" }}>Simulation Error: {simError}</Text>
        </Box>
      )}

      <ContentArea>
        {loading ? (
          <Box flex={1} display="flex" justifyContent="center" alignItems="center">
            <Spinner size="medium" />
          </Box>
        ) : viewMode === "diagram" && sanitizedSvg ? (
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
                    {highlightPolyglotLine(line, "fea")}
                  </span>
                </div>
              ))
            ) : (
              <Box p={4} color="var(--color-fg-muted)" textAlign="center">
                No FEA deck source available.
              </Box>
            )}
          </Box>
        )}

        <InspectorSidebar>
          <Text style={{ fontWeight: "bold", fontSize: "12px", color: "var(--color-fg-default)" }}>
            FEA Mesh &amp; Boundary Conditions
          </Text>
          <StatItem>
            <span>Nodes</span>
            <strong>{nodeCount.toLocaleString()}</strong>
          </StatItem>
          <StatItem>
            <span>Elements</span>
            <strong>{elementCount.toLocaleString()}</strong>
          </StatItem>
          {elementType && (
            <StatItem>
              <span>Element Type</span>
              <strong style={{ color: "#38bdf8" }}>{elementType}</strong>
            </StatItem>
          )}
          {youngsModulusGpa !== undefined && (
            <StatItem>
              <span>Young's Modulus</span>
              <strong>{youngsModulusGpa} GPa</strong>
            </StatItem>
          )}
          {poissonsRatio !== undefined && (
            <StatItem>
              <span>Poisson's Ratio</span>
              <strong>{poissonsRatio}</strong>
            </StatItem>
          )}
          {loadKn !== undefined && (
            <StatItem>
              <span>Boundary Load</span>
              <strong style={{ color: "#10b981" }}>{loadKn} kN</strong>
            </StatItem>
          )}
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default FeaDeckViewer;
