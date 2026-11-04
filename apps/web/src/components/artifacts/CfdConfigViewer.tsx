// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeIcon, FlameIcon, WorkflowIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useTheme } from "../../theme";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import Spinner from "../Spinner";
import { createDefaultCadStudyParameters, solveCadStudySync } from "./cad-study-solver";
import {
  highlightPolyglotLine,
  InteractiveSvgStage,
  renderSourceToDiagramSvg,
  sanitizeSvgMarkup,
} from "./PolyglotArtifactViewer";
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
  background: var(--color-canvas-default);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div<{ $isFullScreen?: boolean | undefined }>`
  height: 38px;
  min-height: 38px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${(props) => (props.$isFullScreen ? "0 12px" : "0 114px 0 12px")};
  gap: 8px;
  z-index: 10;
  overflow: hidden;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
`;

const ModelTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: var(--color-fg-default);
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
  flex-shrink: 0;
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

export const CfdConfigViewer: React.FC<CfdConfigViewerProps> = ({ artifactId, viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"3d" | "diagram" | "code">("3d");
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

  const machNumber = viewConfig.machNumber ?? parsedCfg.machNumber;
  const aoaDeg = viewConfig.aoaDeg ?? viewConfig.aoa ?? parsedCfg.aoaDeg;
  const solverLabel = viewConfig.solver || parsedCfg.solver || "RANS";
  const turbLabel = viewConfig.turbulenceModel || parsedCfg.turbModel || "SA";

  const default3dResultConfig = useMemo(() => {
    const effectiveMach = machNumber ?? 0.82;
    const effectiveAoa = aoaDeg ?? 2.75;
    if (viewConfig.vtuInline) {
      return {
        ...viewConfig,
        title: `${title} (M=${effectiveMach}, α=${effectiveAoa}°)`,
        scalarField: (viewConfig.scalarField as string) || "PressureCoefficient",
        height: "100%",
      };
    }
    const params = createDefaultCadStudyParameters(title);
    params.freestreamVelocityMs = Math.max(5, +(effectiveMach * 340.3).toFixed(1));
    params.angleOfAttackDeg = effectiveAoa;
    const solved = solveCadStudySync([], "steady-state-cfd", params, title);
    return {
      vtuInline: solved.vtuInline,
      title: `${title} (M=${effectiveMach}, α=${effectiveAoa}°)`,
      scalarField: "PressureCoefficient",
      fieldUnits: solved.fieldUnits,
      solverInfo: {
        name: `SU2 ${solverLabel} (${turbLabel}) · M=${effectiveMach} · α=${effectiveAoa}°`,
      },
      height: "100%",
    };
  }, [viewConfig, title, machNumber, aoaDeg, solverLabel, turbLabel]);

  const sanitizedSvg = useMemo(() => {
    if (typeof viewConfig.svg === "string" && viewConfig.svg.includes("<svg")) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen, isDark });
    }
    if (rawText.trim()) {
      try {
        const fallback = renderSourceToDiagramSvg(rawText, "cfd", title, isDark, isFullScreen);
        if (fallback.svg) {
          return fallback.svg;
        }
      } catch (err) {
        console.warn("[CfdConfigViewer] Client-side schematic synthesis failed:", err);
      }
    }
    return "";
  }, [viewConfig.svg, rawText, title, isFullScreen, isDark]);

  const effectiveViewMode: "3d" | "diagram" | "code" =
    viewMode === "3d" ? "3d" : viewMode === "diagram" && sanitizedSvg ? "diagram" : "code";

  const codeLines = rawText ? rawText.split(/\r?\n/) : [];
  const active3dConfig = default3dResultConfig;

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar $isFullScreen={isFullScreen}>
        <HeaderLeft>
          <FlameIcon size={15} fill="var(--color-attention-fg, currentColor)" />
          <PillBadge>SU2 CFD</PillBadge>
          {!isFullScreen && <ModelTitle title={title}>{title}</ModelTitle>}
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
          <Box
            display="flex"
            bg="var(--color-canvas-default)"
            borderRadius="6px"
            p="2px"
            border="1px solid var(--color-border-default)"
          >
            <button
              type="button"
              onClick={() => setViewMode("3d")}
              style={{
                background: effectiveViewMode === "3d" ? "rgba(249, 115, 22, 0.18)" : "transparent",
                color:
                  effectiveViewMode === "3d"
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
              <FlameIcon size={12} /> 3D Flow
            </button>
            {sanitizedSvg && (
              <button
                type="button"
                onClick={() => setViewMode("diagram")}
                style={{
                  background: effectiveViewMode === "diagram" ? "rgba(249, 115, 22, 0.18)" : "transparent",
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
            )}
            <button
              type="button"
              onClick={() => setViewMode("code")}
              style={{
                background: effectiveViewMode === "code" ? "rgba(249, 115, 22, 0.18)" : "transparent",
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
          {Boolean(viewConfig?.standalone) && !isFullScreen && (
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

      <ContentArea>
        {effectiveViewMode === "3d" && active3dConfig ? (
          <Box flex={1} width="100%" height="100%" position="relative" overflow="hidden">
            <SimulationResultViewer artifactId={artifactId} viewConfig={active3dConfig} isFullScreen={isFullScreen} />
          </Box>
        ) : loading ? (
          <Box flex={1} display="flex" justifyContent="center" alignItems="center">
            <Spinner size="medium" />
          </Box>
        ) : effectiveViewMode === "diagram" && sanitizedSvg ? (
          <InteractiveSvgStage svgHtml={sanitizedSvg} />
        ) : (
          <Box
            flex={1}
            py={2}
            overflow="auto"
            bg="var(--color-canvas-default)"
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
      </ContentArea>
    </CardWrapper>
  );
};

export default CfdConfigViewer;
