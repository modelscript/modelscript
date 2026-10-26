// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeIcon, FlameIcon, PlayIcon } from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { runPhysicsJob } from "../../api";
import Box from "../Box";
import SimulationResultViewer from "./SimulationResultViewer";

export interface CfdConfigViewerProps {
  artifactId?: number | undefined;
  viewConfig: {
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    configName?: string | undefined;
    machNumber?: number | undefined;
    aoaDeg?: number | undefined;
    reynoldsNumber?: number | undefined;
    flowModel?: string | undefined;
    markerCount?: number | undefined;
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

export const CfdConfigViewer: React.FC<CfdConfigViewerProps> = ({ artifactId, viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [runningSim, setRunningSim] = useState(false);
  const [simCompleted, setSimCompleted] = useState(false);
  const [completedResultConfig, setCompletedResultConfig] = useState<any>(null);
  const [rawText, setRawText] = useState(viewConfig.code || "");
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
        .then((r) => r.text())
        .then((txt) => setRawText(txt))
        .catch((err) => console.warn("[CfdConfigViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const sanitizedSvg = useMemo(() => {
    if (viewConfig.svg) {
      return DOMPurify.sanitize(viewConfig.svg);
    }
    // High-contrast clean transonic airfoil / streamline vector diagram
    return DOMPurify.sanitize(`
      <svg viewBox="0 0 650 340" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="650" height="340" rx="8" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
        
        <!-- Streamlines -->
        <g stroke="#38bdf8" stroke-width="1.5" fill="none" opacity="0.6">
          <path d="M 60 90 Q 250 50 600 80" />
          <path d="M 60 130 Q 250 80 600 130" stroke="#f59e0b" />
          <path d="M 60 170 Q 220 120 340 160 Q 460 200 600 180" stroke="#f43f5e" stroke-width="2" />
          <path d="M 60 210 Q 280 260 600 230" />
          <path d="M 60 250 Q 280 290 600 270" />
        </g>

        <!-- Airfoil Wing Profile (NACA 0012 Transonic) -->
        <path d="M 180 170 Q 240 130 380 160 Q 480 178 500 180 Q 440 188 320 186 Q 220 184 180 170 Z"
              fill="#1e293b" stroke="#fb923c" stroke-width="2.5" />

        <!-- Angle of Attack Vector & Chord Line -->
        <line x1="150" y1="170" x2="520" y2="180" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4 4" />
        <line x1="130" y1="185" x2="210" y2="155" stroke="#10b981" stroke-width="2" />
        <polygon points="210,155 198,157 203,165" fill="#10b981" />
        <text x="130" y="205" fill="#6ee7b7" font-size="11" font-family="monospace">V_∞ (AoA = 2.5°)</text>

        <text x="325" y="40" fill="#f0f6fc" font-size="13" font-weight="bold" font-family="sans-serif" text-anchor="middle">SU2 Computational Fluid Dynamics Study</text>
        <text x="325" y="60" fill="#64748b" font-size="10" font-family="monospace" text-anchor="middle">Transonic Euler / RANS Aerodynamic Flowfield</text>
      </svg>
    `);
  }, [viewConfig.svg]);

  const [simError, setSimError] = useState<string | null>(null);

  const handleRunSimulationLocally = async () => {
    setRunningSim(true);
    setSimError(null);
    try {
      const geoHash =
        (viewConfig.geometryHash as string) || "0000000000000000000000000000000000000000000000000000000000000000";
      const studyConfig = {
        type: "CFD",
        workflowClass: "DroneCFDStudy",
        mach: viewConfig.machNumber ?? 0.8,
        aoa: viewConfig.aoaDeg ?? 2.5,
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

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <FlameIcon size={16} fill="#fb923c" />
          <ModelTitle>{title}</ModelTitle>
          <PillBadge>SU2 CFD Config</PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={3}>
          <Button
            size="small"
            variant="primary"
            leadingVisual={runningSim ? Spinner : PlayIcon}
            disabled={runningSim}
            onClick={handleRunSimulationLocally}
          >
            {runningSim ? "Running Locally..." : "Run Simulation"}
          </Button>

          <Button
            size="small"
            leadingVisual={CodeIcon}
            onClick={() => navigate(`/ide?source=${encodeURIComponent(rawText)}&title=${encodeURIComponent(title)}`)}
          >
            Open in IDE
          </Button>
        </Box>
      </Toolbar>

      {simError && (
        <Box px={3} py={2} bg="rgba(248, 81, 73, 0.15)" borderBottom="1px solid var(--color-danger-border)">
          <Text fontSize="12px" color="var(--color-danger-fg)">
            Simulation Error: {simError}
          </Text>
        </Box>
      )}

      <ContentArea>
        {loading ? (
          <Box flex={1} display="flex" justifyContent="center" alignItems="center">
            <Spinner size="medium" />
          </Box>
        ) : (
          <SvgCanvas dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />
        )}

        <InspectorSidebar>
          <Text fontWeight="bold" fontSize="12px" color="var(--color-fg-default)">
            Aerodynamic Setup Telemetry
          </Text>
          <StatItem>
            <span>Flow Solver</span>
            <strong style={{ color: "#38bdf8" }}>{viewConfig.flowModel || "RANS (Spalart-Allmaras)"}</strong>
          </StatItem>
          <StatItem>
            <span>Mach Number (M)</span>
            <strong>{viewConfig.machNumber ?? 0.8}</strong>
          </StatItem>
          <StatItem>
            <span>Angle of Attack (α)</span>
            <strong>{viewConfig.aoaDeg ? `${viewConfig.aoaDeg}°` : "2.5°"}</strong>
          </StatItem>
          <StatItem>
            <span>Reynolds Number (Re)</span>
            <strong>{viewConfig.reynoldsNumber ? `${(viewConfig.reynoldsNumber / 1e6).toFixed(1)}M` : "6.5M"}</strong>
          </StatItem>
          <StatItem>
            <span>Boundary Markers</span>
            <strong>{viewConfig.markerCount ?? 3} (Airfoil, Farfield, Sym)</strong>
          </StatItem>
        </InspectorSidebar>
      </ContentArea>
    </CardWrapper>
  );
};

export default CfdConfigViewer;
