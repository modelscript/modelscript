// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeIcon, FlameIcon, PlayIcon, WorkflowIcon } from "@primer/octicons-react";
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

export interface CfdConfigViewerProps {
  artifactId?: number | undefined;
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    configName?: string | undefined;
    machNumber?: number | undefined;
    aoaDeg?: number | undefined;
    aoa?: number | undefined;
    reynoldsNumber?: number | undefined;
    flowModel?: string | undefined;
    solver?: string | undefined;
    turbulenceModel?: string | undefined;
    markerCount?: number | undefined;
    markersEuler?: string[] | undefined;
    markersFar?: string[] | undefined;
    markersHeatflux?: string[] | undefined;
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
  background: rgba(249, 115, 22, 0.15);
  color: #fb923c;
  border: 1px solid rgba(249, 115, 22, 0.35);
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

function parseSu2Client(text: string) {
  let solver: string | undefined;
  let turbModel: string | undefined;
  let machNumber: number | undefined;
  let aoaDeg: number | undefined;
  let reynoldsNumber: number | undefined;
  const markers: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/%.*$/, "").trim();
    if (!line) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim().toUpperCase();
    const val = line.slice(eqIdx + 1).trim();
    if (key === "SOLVER" || key === "PHYSICAL_PROBLEM") solver = val;
    else if (key === "KIND_TURB_MODEL") turbModel = val;
    else if (key === "MACH_NUMBER") {
      const n = Number(val);
      if (Number.isFinite(n)) machNumber = n;
    } else if (key === "AOA") {
      const n = Number(val);
      if (Number.isFinite(n)) aoaDeg = n;
    } else if (key === "REYNOLDS_NUMBER") {
      const n = Number(val);
      if (Number.isFinite(n)) reynoldsNumber = n;
    } else if (key.startsWith("MARKER_")) {
      const inner = val
        .replace(/[()]/g, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const m of inner) {
        if (!markers.includes(m) && Number.isNaN(Number(m))) markers.push(m);
      }
    }
  }
  return { solver, turbModel, machNumber, aoaDeg, reynoldsNumber, markers };
}

function computeDeterministicHex64(input: string): string {
  const seeds = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c];
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      seeds[j] = Math.imul((seeds[j]! ^ code) + j, 0x01000193) >>> 0;
    }
  }
  return seeds.map((s) => s.toString(16).padStart(8, "0")).join("");
}

export const CfdConfigViewer: React.FC<CfdConfigViewerProps> = ({ artifactId, viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [runningSim, setRunningSim] = useState(false);
  const [simCompleted, setSimCompleted] = useState(false);
  const [completedResultConfig, setCompletedResultConfig] = useState<any>(null);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"diagram" | "code">(() =>
    typeof viewConfig?.svg === "string" && viewConfig.svg.includes("<svg") ? "diagram" : "code",
  );
  const title = viewConfig.title || viewConfig.configName || "SU2 Aerodynamic Config (.cfg)";

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
        .catch((err) => console.warn("[CfdConfigViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const parsedCfg = useMemo(() => parseSu2Client(rawText), [rawText]);

  const solver = viewConfig.flowModel ?? viewConfig.solver ?? parsedCfg.solver;
  const turbModel = viewConfig.turbulenceModel ?? parsedCfg.turbModel;
  const machNumber = viewConfig.machNumber ?? parsedCfg.machNumber;
  const aoaDeg = viewConfig.aoaDeg ?? viewConfig.aoa ?? parsedCfg.aoaDeg;
  const reynoldsNumber = viewConfig.reynoldsNumber ?? parsedCfg.reynoldsNumber;
  const allMarkers = useMemo(() => {
    const fromConfig = [
      ...(viewConfig.markersEuler || []),
      ...(viewConfig.markersFar || []),
      ...(viewConfig.markersHeatflux || []),
    ];
    return fromConfig.length > 0 ? fromConfig : parsedCfg.markers;
  }, [viewConfig.markersEuler, viewConfig.markersFar, viewConfig.markersHeatflux, parsedCfg.markers]);

  const sanitizedSvg = useMemo(() => {
    if (typeof viewConfig.svg === "string" && viewConfig.svg.includes("<svg")) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    return "";
  }, [viewConfig.svg]);

  const effectiveViewMode: "diagram" | "code" = viewMode === "diagram" && sanitizedSvg ? "diagram" : "code";

  const [simError, setSimError] = useState<string | null>(null);

  const handleRunSimulationLocally = async () => {
    setRunningSim(true);
    setSimError(null);
    try {
      const geoHash = (viewConfig.geometryHash as string) || computeDeterministicHex64(rawText || title);
      const studyConfig = {
        type: "CFD",
        workflowClass: "DroneCFDStudy",
        mach: machNumber ?? 0.5,
        aoa: aoaDeg ?? 0.0,
      };

      const result = await runPhysicsJob({ geometryHash: geoHash, config: studyConfig });
      if (result?.jobId) {
        setSimCompleted(true);
        setCompletedResultConfig({
          url: `/api/v1/physics/${result.jobId}/result`,
          resultVtuUrl: `/api/v1/physics/${result.jobId}/result`,
          title: `Solved: ${title}`,
          scalarField: "Pressure",
        });
      } else {
        throw new Error("No job ID returned from CFD solver service");
      }
    } catch (err: any) {
      console.warn("[CfdConfigViewer] Local simulation failed:", err);
      setSimError(err?.response?.data?.error || err.message || "CFD simulation failed");
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
          <FlameIcon size={16} fill="var(--color-attention-fg, currentColor)" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>SU2 CFD Config</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
          {sanitizedSvg && (
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
                  background: effectiveViewMode === "diagram" ? "rgba(249, 115, 22, 0.25)" : "transparent",
                  color:
                    effectiveViewMode === "diagram"
                      ? "var(--color-attention-fg, var(--color-fg-default))"
                      : "var(--color-fg-muted)",
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
                <WorkflowIcon size={12} /> Domain
              </button>
              <button
                type="button"
                onClick={() => setViewMode("code")}
                style={{
                  background: effectiveViewMode === "code" ? "rgba(249, 115, 22, 0.25)" : "transparent",
                  color:
                    effectiveViewMode === "code"
                      ? "var(--color-attention-fg, var(--color-fg-default))"
                      : "var(--color-fg-muted)",
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
                <CodeIcon size={12} /> Config
              </button>
            </Box>
          )}
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
                  lang: "cfd" as any,
                  code: rawText || `% ${title}\nSOLVER= EULER\n`,
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
        ) : effectiveViewMode === "diagram" && sanitizedSvg ? (
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
                    {highlightPolyglotLine(line, "cfd")}
                  </span>
                </div>
              ))
            ) : (
              <Box p={4} color="var(--color-fg-muted)" textAlign="center">
                No CFD configuration source available.
              </Box>
            )}
          </Box>
        )}

        <InspectorSidebar>
          <Text style={{ fontWeight: "bold", fontSize: "12px", color: "var(--color-fg-default)" }}>
            Aerodynamic Setup Telemetry
          </Text>
          {solver && (
            <StatItem>
              <span>Flow Solver</span>
              <strong style={{ color: "#38bdf8" }}>{solver}</strong>
            </StatItem>
          )}
          {turbModel && (
            <StatItem>
              <span>Turbulence Model</span>
              <strong>{turbModel}</strong>
            </StatItem>
          )}
          {machNumber !== undefined && (
            <StatItem>
              <span>Mach Number (M)</span>
              <strong>{machNumber}</strong>
            </StatItem>
          )}
          {aoaDeg !== undefined && (
            <StatItem>
              <span>Angle of Attack (α)</span>
              <strong>{aoaDeg}°</strong>
            </StatItem>
          )}
          {reynoldsNumber !== undefined && (
            <StatItem>
              <span>Reynolds Number (Re)</span>
              <strong>{reynoldsNumber >= 1e6 ? `${(reynoldsNumber / 1e6).toFixed(2)}M` : reynoldsNumber}</strong>
            </StatItem>
          )}
          <StatItem>
            <span>Boundary Markers</span>
            <strong>{viewConfig.markerCount ?? allMarkers.length}</strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default CfdConfigViewer;
