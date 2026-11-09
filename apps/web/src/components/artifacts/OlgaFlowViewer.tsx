// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type OlgaCompressorLike,
  type OlgaFlowpathLike,
  type OlgaModelLike,
  type OlgaNodeLike,
  type OlgaPumpLike,
  type OlgaValveLike,
  renderOlgaElevationProfileSvg,
  renderOlgaPvtEnvelopeSvg,
  renderOlgaSchematicSvg,
  renderOlgaSlugStatisticsSvg,
  renderOlgaWellboreIprSvg,
} from "@modelscript/diagram/olga-diagram-builder";
import { type OlgaModel, type OlgaSimulationResult, parseOlga, simulateDriftFlux } from "@modelscript/olga";
import {
  AlertIcon,
  CheckCircleIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  GraphIcon,
  PulseIcon,
} from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useTheme } from "../../theme";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import { compressMorselPayload } from "../morsel/util/permalink";
import Spinner from "../Spinner";
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

type OlgaViewMode = "schematic" | "elevation" | "pvt" | "ipr" | "slug" | "code";

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
  height: 40px;
  min-height: 40px;
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
  flex-shrink: 0;

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
  padding: 3px 8px;
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
  const pumps: OlgaPumpLike[] = [];
  const compressors: OlgaCompressorLike[] = [];

  for (const em of code.matchAll(/\b(VALVE|CHOKE|PUMP|COMPRESSOR)\b([^\n]*)/gi)) {
    const kind = (em[1] || "VALVE").toUpperCase();
    const rest = em[2] || "";
    const labelMatch = rest.match(/\bLABEL\s*=\s*["']?([A-Za-z0-9_-]+)["']?/i);
    const posMatch = rest.match(/\bPOSITION\s*=\s*([0-9.eE+-]+)/i);
    const openMatch = rest.match(/\bOPENING\s*=\s*([0-9.eE+-]+)/i);
    const dpMatch = rest.match(/\b(?:DPBOOST|DELTAP)\s*=\s*([0-9.eE+-]+)/i);
    const crMatch = rest.match(/\b(?:PRATIO|PRESSURERATIO)\s*=\s*([0-9.eE+-]+)/i);
    const posVal = posMatch?.[1]
      ? Number.parseFloat(posMatch[1])
      : 500 * (valves.length + pumps.length + compressors.length + 1);

    if (kind === "PUMP") {
      pumps.push({
        name: labelMatch?.[1] || `PMP_${pumps.length + 1}`,
        position: Number.isFinite(posVal) ? posVal : 500,
        dpBoost: dpMatch?.[1] ? Number.parseFloat(dpMatch[1]) : 50e5,
      });
    } else if (kind === "COMPRESSOR") {
      compressors.push({
        name: labelMatch?.[1] || `COMP_${compressors.length + 1}`,
        position: Number.isFinite(posVal) ? posVal : 800,
        pressureRatio: crMatch?.[1] ? Number.parseFloat(crMatch[1]) : 2.2,
      });
    } else {
      valves.push({
        name: labelMatch?.[1] || `V_${valves.length + 1}`,
        position: Number.isFinite(posVal) ? posVal : 500 * (valves.length + 1),
        diameter: diameterMeters,
        opening: openMatch?.[1] ? Number.parseFloat(openMatch[1]) : 0.85,
      });
    }
  }

  // Collect explicit PIPE definitions so branches get accurate per-pipe geometry
  const explicitPipes: { label: string; length: number; elevation: number; diameter: number; branch?: string }[] = [];
  for (const pm of code.matchAll(/\bPIPE\b([^\n]*)/gi)) {
    const rest = pm[1] || "";
    const labelMatch = rest.match(/\bLABEL\s*=\s*["']?([A-Za-z0-9_-]+)["']?/i);
    const lenMatch = rest.match(/\bLENGTH\s*=\s*([0-9.eE+-]+)(?:\s*([A-Za-z]+))?/i);
    const elevMatch = rest.match(/\bELEVATION\s*=\s*([0-9.eE+-]+)(?:\s*([A-Za-z]+))?/i);
    const diaLocalMatch = rest.match(/\bDIAMETER\s*=\s*([0-9.eE+-]+)(?:\s*([A-Za-z]+))?/i);
    const branchMatch = rest.match(/\bBRANCH\s*=\s*["']?([A-Za-z0-9_-]+)["']?/i);

    let lenM = 2000;
    if (lenMatch?.[1]) {
      const v = Number.parseFloat(lenMatch[1]);
      const u = (lenMatch[2] || "m").toLowerCase();
      if (Number.isFinite(v)) lenM = u === "km" ? v * 1000 : v;
    }
    let elevM = 0;
    if (elevMatch?.[1]) {
      const v = Number.parseFloat(elevMatch[1]);
      if (Number.isFinite(v)) elevM = v;
    }
    let diaM = diameterMeters;
    if (diaLocalMatch?.[1]) {
      const v = Number.parseFloat(diaLocalMatch[1]);
      const u = (diaLocalMatch[2] || "m").toLowerCase();
      if (Number.isFinite(v)) diaM = u.startsWith("in") ? v * 0.0254 : v;
    }

    explicitPipes.push({
      label: labelMatch?.[1] || `PIPE_${explicitPipes.length + 1}`,
      length: lenM,
      elevation: elevM,
      diameter: diaM,
      ...(branchMatch?.[1] ? { branch: branchMatch[1] } : {}),
    });
  }

  const branchMatches = Array.from(
    code.matchAll(/\bBRANCH\b[^\n]*?\bLABEL\s*=\s*["']?([A-Za-z0-9_-]+)["']?([^\n]*)/gi),
  );
  for (const [bIdx, bm] of branchMatches.entries()) {
    const label = bm[1] || `FP_${flowpaths.length + 1}`;
    const rest = bm[2] || "";
    const lenMatch = rest.match(/\bLENGTH\s*=\s*([0-9.eE+-]+)(?:\s*([A-Za-z]+))?/i);
    const elevMatch = rest.match(/\bELEVATION\s*=\s*([0-9.eE+-]+)/i);
    const diaLocalMatch = rest.match(/\bDIAMETER\s*=\s*([0-9.eE+-]+)(?:\s*([A-Za-z]+))?/i);

    const matchingPipes = explicitPipes.filter((p) => p.branch === label);
    const fallbackLen = lenMatch?.[1]
      ? Number.parseFloat(lenMatch[1]) * ((lenMatch[2] || "m").toLowerCase() === "km" ? 1000 : 1)
      : totalLengthM > 0
        ? Math.round(totalLengthM / Math.max(1, branchMatches.length))
        : 5000;
    const fallbackElev = elevMatch?.[1] ? Number.parseFloat(elevMatch[1]) : 0;
    const fallbackDia = diaLocalMatch?.[1]
      ? Number.parseFloat(diaLocalMatch[1]) * ((diaLocalMatch[2] || "m").toLowerCase().startsWith("in") ? 0.0254 : 1)
      : diameterMeters;

    const branchPipes =
      matchingPipes.length > 0
        ? matchingPipes
        : bIdx === 0 && explicitPipes.length > 0 && explicitPipes.every((p) => !p.branch)
          ? explicitPipes
          : [
              {
                label: `PIPE_${bIdx + 1}`,
                length: Number.isFinite(fallbackLen) ? fallbackLen : 5000,
                elevation: Number.isFinite(fallbackElev) ? fallbackElev : 0,
                diameter: Number.isFinite(fallbackDia) ? fallbackDia : diameterMeters,
              },
            ];

    flowpaths.push({
      name: label,
      pipes: branchPipes,
      valves: bIdx === 0 ? valves : [],
      ...(bIdx === 0 && pumps.length > 0 ? { pumps } : {}),
      ...(bIdx === 0 && compressors.length > 0 ? { compressors } : {}),
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
      pipes:
        explicitPipes.length > 0
          ? explicitPipes
          : [
              {
                label: "P1",
                length: totalLengthM > 0 ? totalLengthM : 4500,
                elevation: 150,
                diameter: diameterMeters,
              },
            ],
      valves,
      ...(pumps.length > 0 ? { pumps } : {}),
      ...(compressors.length > 0 ? { compressors } : {}),
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
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<OlgaViewMode>("schematic");
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const title = viewConfig.title || viewConfig.pipelineName || "OLGA Flow Assurance (.opi)";

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
          console.warn("[OlgaFlowViewer] Failed to fetch source:", err);
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

  const olgaAnalysis = useMemo(() => {
    let parsedModel: OlgaModel | null = null;
    let simResult: OlgaSimulationResult | null = null;
    const clientFallback = rawText ? parseOlgaClient(rawText) : undefined;

    if (rawText.trim()) {
      try {
        const candidate = parseOlga(rawText);
        if (candidate.flowpaths.length > 0) {
          parsedModel = candidate;
          simResult = simulateDriftFlux(candidate, { timeSteps: 8, gridPoints: 20 });
        }
      } catch (err) {
        console.warn("[OlgaFlowViewer] parseOlga / simulateDriftFlux fallback:", err);
      }
    }

    const effectiveModel: OlgaModelLike = parsedModel ?? {
      title,
      nodes: clientFallback?.nodes ?? [],
      flowpaths: clientFallback?.flowpaths ?? [],
    };

    // Compute telemetry summary metrics
    let calcLengthM = 0;
    let firstDiaM = 0.3048;
    for (const fp of effectiveModel.flowpaths) {
      for (const p of fp.pipes) {
        calcLengthM += p.length;
        if (p.diameter > 0) firstDiaM = p.diameter;
      }
    }

    let calcDpBar: number | undefined;
    let calcHoldupPct: number | undefined;
    if (simResult && simResult.profiles.length > 0) {
      const lastSnap = simResult.profiles[simResult.profiles.length - 1]!;
      if (lastSnap.pressure.length >= 2) {
        const pIn = lastSnap.pressure[0]!;
        const pOut = lastSnap.pressure[lastSnap.pressure.length - 1]!;
        const pInBar = pIn > 2000 ? pIn / 1e5 : pIn;
        const pOutBar = pOut > 2000 ? pOut / 1e5 : pOut;
        calcDpBar = Math.abs(pInBar - pOutBar);
      }
      if (lastSnap.holdup.length > 0) {
        const avgH = lastSnap.holdup.reduce((acc, v) => acc + v, 0) / lastSnap.holdup.length;
        calcHoldupPct = avgH <= 1.0 ? avgH * 100 : avgH;
      }
    }

    const lengthKm =
      viewConfig.lengthKm ??
      (calcLengthM > 0 ? Number((calcLengthM / 1000).toFixed(2)) : (clientFallback?.lengthKm ?? 4.5));
    const diameterInches =
      viewConfig.diameterInches ?? clientFallback?.diameterInches ?? Number((firstDiaM * 39.3701).toFixed(1));
    const pressureDropBar =
      viewConfig.pressureDropBar ?? (calcDpBar !== undefined ? Number(calcDpBar.toFixed(1)) : 68.5);
    const rawHoldup = viewConfig.liquidHoldupAvg ?? calcHoldupPct ?? 24.8;
    const liquidHoldupPct = rawHoldup <= 1.0 ? rawHoldup * 100 : rawHoldup;

    return {
      parsedModel,
      simResult,
      effectiveModel,
      telemetry: {
        lengthKm,
        diameterInches,
        pressureDropBar,
        liquidHoldupPct,
      },
    };
  }, [
    rawText,
    title,
    viewConfig.lengthKm,
    viewConfig.diameterInches,
    viewConfig.pressureDropBar,
    viewConfig.liquidHoldupAvg,
  ]);

  const schematicSvg = useMemo(() => {
    if (typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen, isDark });
    }
    if (olgaAnalysis.effectiveModel.flowpaths.length > 0) {
      try {
        const built = renderOlgaSchematicSvg({
          ...olgaAnalysis.effectiveModel,
          title,
        });
        return sanitizeSvgMarkup(built, { isFullScreen, isDark });
      } catch {
        return "";
      }
    }
    return "";
  }, [viewConfig.svg, olgaAnalysis.effectiveModel, title, isFullScreen, isDark]);

  const elevationSvg = useMemo(() => {
    try {
      const built = renderOlgaElevationProfileSvg(
        { ...olgaAnalysis.effectiveModel, title },
        olgaAnalysis.simResult ?? undefined,
      );
      return sanitizeSvgMarkup(built, { isFullScreen, isDark });
    } catch {
      return "";
    }
  }, [olgaAnalysis, title, isFullScreen, isDark]);

  const pvtSvg = useMemo(() => {
    try {
      const built = renderOlgaPvtEnvelopeSvg(
        olgaAnalysis.parsedModel?.pvtData,
        olgaAnalysis.simResult ?? undefined,
        title,
      );
      return sanitizeSvgMarkup(built, { isFullScreen, isDark });
    } catch {
      return "";
    }
  }, [olgaAnalysis, title, isFullScreen, isDark]);

  const iprSvg = useMemo(() => {
    try {
      const iprSource = olgaAnalysis.parsedModel?.sources.find((s) => s.ipr)?.ipr;
      const wellName = olgaAnalysis.effectiveModel.nodes[0]?.name || "SUBSEA WELL";
      const built = renderOlgaWellboreIprSvg(iprSource, wellName);
      return sanitizeSvgMarkup(built, { isFullScreen, isDark });
    } catch {
      return "";
    }
  }, [olgaAnalysis, isFullScreen, isDark]);

  const slugSvg = useMemo(() => {
    try {
      const built = renderOlgaSlugStatisticsSvg(olgaAnalysis.simResult ?? undefined);
      return sanitizeSvgMarkup(built, { isFullScreen, isDark });
    } catch {
      return "";
    }
  }, [olgaAnalysis, isFullScreen, isDark]);

  const activeSvg =
    viewMode === "schematic"
      ? schematicSvg
      : viewMode === "elevation"
        ? elevationSvg
        : viewMode === "pvt"
          ? pvtSvg
          : viewMode === "ipr"
            ? iprSvg
            : viewMode === "slug"
              ? slugSvg
              : "";

  const effectiveViewMode: OlgaViewMode = viewMode !== "code" && activeSvg ? viewMode : "code";

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
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}-olga-${viewMode}.svg`;
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
    navigate(`/morsel${fromParam}#m=${hash}`);
  };

  const slugRisk = viewConfig.slugRisk;
  const lines = useMemo(() => (rawText ? rawText.split(/\r?\n/) : []), [rawText]);
  const { telemetry } = olgaAnalysis;

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PulseIcon size={16} fill="var(--color-done-fg, currentColor)" />
          <PillBadge>OLGA Multiphase</PillBadge>
          {!isFullScreen && <ModelTitle title={title}>{title}</ModelTitle>}
          {slugRisk && (
            <PillBadge $variant={slugRisk === "low" ? "slug-low" : "slug-warn"}>
              {slugRisk === "low" ? <CheckCircleIcon size={12} /> : <AlertIcon size={12} />}
              Slugging Risk: {slugRisk.toUpperCase()}
            </PillBadge>
          )}
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
            <SegmentBtn
              type="button"
              $active={effectiveViewMode === "elevation"}
              onClick={() => setViewMode("elevation")}
            >
              <GraphIcon size={12} /> Elevation & Holdup
            </SegmentBtn>
            <SegmentBtn type="button" $active={effectiveViewMode === "pvt"} onClick={() => setViewMode("pvt")}>
              PVT & Hydrate
            </SegmentBtn>
            <SegmentBtn type="button" $active={effectiveViewMode === "ipr"} onClick={() => setViewMode("ipr")}>
              Wellbore IPR
            </SegmentBtn>
            <SegmentBtn type="button" $active={effectiveViewMode === "slug"} onClick={() => setViewMode("slug")}>
              Slug Catcher
            </SegmentBtn>
            <SegmentBtn type="button" $active={effectiveViewMode === "code"} onClick={() => setViewMode("code")}>
              <CodeIcon size={12} /> Input Deck
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
          Length: <strong>{telemetry.lengthKm.toFixed(2)} km</strong>
        </MetricItem>
        <MetricItem>
          Diameter: <strong>{telemetry.diameterInches.toFixed(1)} in</strong>
        </MetricItem>
        <MetricItem>
          ΔP: <strong>{telemetry.pressureDropBar.toFixed(1)} bar</strong>
        </MetricItem>
        <MetricItem>
          Liquid Holdup: <strong>{telemetry.liquidHoldupPct.toFixed(1)}%</strong>
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
          <InteractiveSvgStage svgMarkup={activeSvg} isFullScreen={isFullScreen} />
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default OlgaFlowViewer;
