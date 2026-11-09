// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  renderCompressorMapSvg,
  renderLpsPressureProfileSvg,
  renderLpsSchematicSvg,
} from "@modelscript/diagram/lps-diagram-builder";
import { type LpsModel, type LpsSteadyResult, parseLps, SteadyNetworkSolver } from "@modelscript/lps";
import { CheckIcon, CodeIcon, CopyIcon, DownloadIcon, GraphIcon, PulseIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useTheme } from "../../theme";
import { buildEditorUrlForArtifact } from "../../util/editor-routing";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import Spinner from "../Spinner";
import {
  highlightPolyglotLine,
  InteractiveSvgStage,
  renderSourceToDiagramSvg,
  sanitizeSvgMarkup,
} from "./PolyglotArtifactViewer";

export interface PipelineLpsViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    networkName?: string | undefined;
    linePackMm3?: number | undefined;
    maopBar?: number | undefined;
    inletPressureBar?: number | undefined;
    outletPressureBar?: number | undefined;
    throughputMmsm3d?: number | undefined;
    compressorCount?: number | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

type LpsViewMode = "schematic" | "profile" | "compressor" | "code";

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "460px")};
  background: var(--color-canvas-default);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 38px;
  min-height: 38px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  z-index: 10;
  overflow: hidden;
`;

const TelemetryRibbon = styled.div`
  min-height: 28px;
  background: var(--color-canvas-inset, var(--color-canvas-subtle));
  border-bottom: 1px solid var(--color-border-muted, var(--color-border-default));
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 2px 12px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  color: var(--color-fg-muted);
  overflow-x: auto;
  white-space: nowrap;
`;

const MetricItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;

  strong {
    color: var(--color-fg-default);
    font-weight: 600;
  }
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
  flex-shrink: 0;
  background: rgba(14, 165, 233, 0.15);
  color: var(--color-accent-fg, var(--color-fg-default));
  border: 1px solid rgba(14, 165, 233, 0.35);
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

// Ensure instance `.solve()` delegates to `SteadyNetworkSolver.solve()`
if (typeof (SteadyNetworkSolver.prototype as unknown as { solve?: unknown }).solve !== "function") {
  (SteadyNetworkSolver.prototype as unknown as { solve: (m: LpsModel) => LpsSteadyResult }).solve = (model: LpsModel) =>
    SteadyNetworkSolver.solve(model);
}

export const PipelineLpsViewer: React.FC<PipelineLpsViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<LpsViewMode>("schematic");
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const title = viewConfig.title || viewConfig.networkName || "PipelineStudio Network (.lps)";

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (viewConfig.code) {
      setRawText(viewConfig.code);
      return;
    }
    if (viewConfig.url) {
      const controller = new AbortController();
      setLoading(true);
      const targetUrl =
        viewConfig.url.startsWith("http") || viewConfig.url.startsWith("/api")
          ? viewConfig.url
          : `/api${viewConfig.url}`;
      fetch(targetUrl, { signal: controller.signal })
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => {
          if (txt) setRawText(txt);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          console.warn("[PipelineLpsViewer] Failed to fetch source:", err);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
      return () => controller.abort();
    }
    return undefined;
  }, [viewConfig.code, viewConfig.url]);

  useEffect(() => {
    if (!loading && typeof window !== "undefined") {
      (window as any).__ARTIFACT_READY = true;
    }
  }, [loading, rawText]);

  const lpsAnalysis = useMemo(() => {
    let parsedModel: LpsModel | null = null;
    let steadyResult: LpsSteadyResult | null = null;

    if (rawText.trim()) {
      try {
        const candidate = parseLps(rawText);
        if (candidate.nodes.length > 0 || candidate.pipes.length > 0 || candidate.compressors.length > 0) {
          parsedModel = candidate;
          const solver = new SteadyNetworkSolver() as SteadyNetworkSolver & {
            solve: (m: LpsModel) => LpsSteadyResult;
          };
          steadyResult = solver.solve(parsedModel);
        }
      } catch (err) {
        console.warn("[PipelineLpsViewer] LPS parse/solve fallback:", err);
      }
    }

    // Derive hydraulic telemetry metrics (preferring viewConfig overrides when provided)
    let solvedInletBar: number | undefined;
    let solvedOutletBar: number | undefined;
    if (steadyResult && steadyResult.nodePressures.size > 0) {
      const pressuresBar = Array.from(steadyResult.nodePressures.values()).map((p) => (p > 2000 ? p / 1e5 : p));
      solvedInletBar = Math.max(...pressuresBar);
      solvedOutletBar = Math.min(...pressuresBar);
    } else if (parsedModel && parsedModel.nodes.length > 0) {
      const pressuresBar = parsedModel.nodes
        .filter((n) => typeof n.pressure === "number" && Number.isFinite(n.pressure))
        .map((n) => (n.pressure! > 2000 ? n.pressure! / 1e5 : n.pressure!));
      if (pressuresBar.length > 0) {
        solvedInletBar = Math.max(...pressuresBar);
        solvedOutletBar = Math.min(...pressuresBar);
      }
    }

    let solvedThroughputMmsm3d: number | undefined;
    if (steadyResult && steadyResult.pipeResults.length > 0) {
      const maxFlowKgS = Math.max(...steadyResult.pipeResults.map((r) => Math.abs(r.massFlow)));
      // Convert mass flow (kg/s) at ~0.78 kg/sm3 to MMsm3/d
      solvedThroughputMmsm3d = (maxFlowKgS * 86400) / (0.78 * 1e6);
    }

    const inletPressureBar = viewConfig.inletPressureBar ?? solvedInletBar ?? 85.0;
    const outletPressureBar = viewConfig.outletPressureBar ?? solvedOutletBar ?? 48.5;
    const maopBar = viewConfig.maopBar ?? Math.max(100, Math.round(inletPressureBar * 1.15));
    const linePackMm3 =
      viewConfig.linePackMm3 ??
      (steadyResult && steadyResult.totalLinePackKg > 0
        ? Number((steadyResult.totalLinePackKg / (0.78 * 1e6)).toFixed(2))
        : 1.42);
    const throughputMmsm3d =
      viewConfig.throughputMmsm3d ??
      (solvedThroughputMmsm3d !== undefined ? Number(solvedThroughputMmsm3d.toFixed(2)) : 18.4);
    const compressorCount = viewConfig.compressorCount ?? (parsedModel ? parsedModel.compressors.length : 1);

    return {
      parsedModel,
      steadyResult,
      telemetry: {
        inletPressureBar,
        outletPressureBar,
        maopBar,
        linePackMm3,
        throughputMmsm3d,
        compressorCount,
      },
    };
  }, [
    rawText,
    viewConfig.inletPressureBar,
    viewConfig.outletPressureBar,
    viewConfig.maopBar,
    viewConfig.linePackMm3,
    viewConfig.throughputMmsm3d,
    viewConfig.compressorCount,
  ]);

  const schematicSvg = useMemo(() => {
    if (typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen, isDark });
    }
    if (lpsAnalysis.parsedModel) {
      try {
        const rawSvg = renderLpsSchematicSvg(lpsAnalysis.parsedModel, lpsAnalysis.steadyResult ?? undefined);
        if (rawSvg) return sanitizeSvgMarkup(rawSvg, { isFullScreen, isDark });
      } catch (err) {
        console.warn("[PipelineLpsViewer] renderLpsSchematicSvg error:", err);
      }
    }
    if (rawText.trim()) {
      try {
        const fallback = renderSourceToDiagramSvg(rawText, "lps", title, isDark, isFullScreen);
        if (fallback.svg) return fallback.svg;
      } catch (err) {
        console.warn("[PipelineLpsViewer] Client-side schematic fallback failed:", err);
      }
    }
    return "";
  }, [viewConfig.svg, lpsAnalysis, rawText, title, isFullScreen, isDark]);

  const profileSvg = useMemo(() => {
    try {
      const modelForProfile = lpsAnalysis.parsedModel ?? {
        title,
        fluidType: "GAS",
        nodes: [
          { name: "INLET", type: "SUPPLY", pressure: lpsAnalysis.telemetry.inletPressureBar * 1e5 },
          { name: "DELIVERY", type: "DELIVERY", pressure: lpsAnalysis.telemetry.outletPressureBar * 1e5 },
        ],
        pipes: [
          {
            name: "MAINLINE",
            fromNode: "INLET",
            toNode: "DELIVERY",
            length: 120000,
            diameter: 0.9144,
          },
        ],
        compressors: [],
        valves: [],
      };
      const rawSvg = renderLpsPressureProfileSvg(modelForProfile, lpsAnalysis.steadyResult ?? undefined);
      return sanitizeSvgMarkup(rawSvg, { isFullScreen, isDark });
    } catch (err) {
      console.warn("[PipelineLpsViewer] renderLpsPressureProfileSvg error:", err);
      return "";
    }
  }, [lpsAnalysis, title, isFullScreen, isDark]);

  const compressorSvg = useMemo(() => {
    try {
      const firstComp = lpsAnalysis.parsedModel?.compressors[0];
      const firstCompRes = lpsAnalysis.steadyResult?.compressorResults[0];
      const compName = firstComp?.name ?? "CS-01";
      const ratedPowerKw = firstComp?.power ? firstComp.power / 1000 : 12000;
      const ratedRpm = firstComp?.speed ?? 6500;
      const opPoint = firstCompRes
        ? {
            flowM3h: Math.max(1200, (firstCompRes.powerKw / ratedPowerKw) * 8200),
            pressureRatio: firstCompRes.pressureRatio,
            powerKw: firstCompRes.powerKw,
            efficiency: firstComp?.efficiency ?? 0.82,
          }
        : undefined;
      const rawSvg = renderCompressorMapSvg(compName, ratedPowerKw, ratedRpm, opPoint);
      return sanitizeSvgMarkup(rawSvg, { isFullScreen, isDark });
    } catch (err) {
      console.warn("[PipelineLpsViewer] renderCompressorMapSvg error:", err);
      return "";
    }
  }, [lpsAnalysis, isFullScreen, isDark]);

  const activeSvg =
    viewMode === "schematic"
      ? schematicSvg
      : viewMode === "profile"
        ? profileSvg
        : viewMode === "compressor"
          ? compressorSvg
          : "";

  const effectiveViewMode: LpsViewMode = viewMode !== "code" && activeSvg ? viewMode : schematicSvg ? "code" : "code";

  const handleCopy = () => {
    if (rawText) {
      navigator.clipboard.writeText(rawText);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExportSvg = () => {
    const svgToExport = activeSvg || schematicSvg;
    if (!svgToExport) return;
    const blob = new Blob([svgToExport], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${viewMode}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenInPlayground = () => {
    navigate(
      buildEditorUrlForArtifact({
        artifactId: viewConfig.artifactId,
        viewType: "lps",
        dialect: "lps",
        viewConfig,
        code: rawText,
        title,
      }),
    );
  };

  const lines = useMemo(() => (rawText ? rawText.split(/\r?\n/) : []), [rawText]);
  const { telemetry } = lpsAnalysis;

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PulseIcon size={16} fill="var(--color-accent-fg, currentColor)" />
          <PillBadge>LPS</PillBadge>
          {!isFullScreen && <ModelTitle title={title}>{title}</ModelTitle>}
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
          <SegmentedControl>
            <SegmentBtn
              type="button"
              $active={effectiveViewMode === "schematic"}
              onClick={() => setViewMode("schematic")}
            >
              <PulseIcon size={12} /> Schematic
            </SegmentBtn>
            <SegmentBtn type="button" $active={effectiveViewMode === "profile"} onClick={() => setViewMode("profile")}>
              <GraphIcon size={12} /> P(x) Profile
            </SegmentBtn>
            <SegmentBtn
              type="button"
              $active={effectiveViewMode === "compressor"}
              onClick={() => setViewMode("compressor")}
            >
              <PulseIcon size={12} /> Compressor Map
            </SegmentBtn>
            <SegmentBtn type="button" $active={effectiveViewMode === "code"} onClick={() => setViewMode("code")}>
              <CodeIcon size={12} /> Source
            </SegmentBtn>
          </SegmentedControl>
          {activeSvg && (
            <Button size="small" leadingVisual={DownloadIcon} onClick={handleExportSvg}>
              SVG
            </Button>
          )}
          <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <Button size="small" leadingVisual={DraftingTriangleIcon} onClick={handleOpenInPlayground}>
              Open in Morsel
            </Button>
          )}
        </Box>
      </Toolbar>

      <TelemetryRibbon>
        <MetricItem>
          Inlet P: <strong>{telemetry.inletPressureBar.toFixed(1)} bar</strong>
        </MetricItem>
        <MetricItem>
          Outlet P: <strong>{telemetry.outletPressureBar.toFixed(1)} bar</strong>
        </MetricItem>
        <MetricItem>
          MAOP: <strong>{telemetry.maopBar.toFixed(0)} bar</strong>
        </MetricItem>
        <MetricItem>
          Linepack: <strong>{telemetry.linePackMm3.toFixed(2)} MMm³</strong>
        </MetricItem>
        <MetricItem>
          Throughput: <strong>{telemetry.throughputMmsm3d.toFixed(2)} MMsm³/d</strong>
        </MetricItem>
        <MetricItem>
          Compressors: <strong>{telemetry.compressorCount}</strong>
        </MetricItem>
      </TelemetryRibbon>

      <ContentArea>
        {loading ? (
          <Box flex={1} display="flex" justifyContent="center" alignItems="center">
            <Spinner size="medium" />
          </Box>
        ) : effectiveViewMode === "code" || !activeSvg ? (
          <CodePre>
            {lines.length > 0 ? (
              lines.map((line, idx) => (
                <CodeLine key={idx}>
                  <LineNo>{idx + 1}</LineNo>
                  <span>{highlightPolyglotLine(line, "lps")}</span>
                </CodeLine>
              ))
            ) : (
              <Box p={4} color="fg.muted">
                No PipelineStudio network deck loaded.
              </Box>
            )}
          </CodePre>
        ) : (
          <InteractiveSvgStage svgHtml={activeSvg} isFullScreen={isFullScreen} />
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default PipelineLpsViewer;
