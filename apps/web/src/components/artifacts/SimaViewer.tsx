// SPDX-License-Identifier: AGPL-3.0-or-later

import { renderSimaCatenaryProfileSvg, renderSimaMooringSpreadSvg } from "@modelscript/diagram/sima-diagram-builder";
import {
  evaluateOffsetLimits,
  parseSimaFile,
  solveCatenary,
  verifyDnvMooringCompliance,
  type DnvVerificationReport,
  type MooringLine,
  type OffsetLimitReport,
  type SimaModel,
} from "@modelscript/sima";
import { AlertIcon, CheckCircleIcon, CheckIcon, CopyIcon, PlayIcon, ShieldCheckIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Spinner } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine, InteractiveSvgStage, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

export interface SimaViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    vesselName?: string | undefined;
    waterDepthM?: number | undefined;
    waterDepthMeters?: number | undefined;
    lineCount?: number | undefined;
    mooringLinesCount?: number | undefined;
    maxTensionKn?: number | undefined;
    watchCircleRadiusM?: number | undefined;
    watchCircleRadiusMeters?: number | undefined;
    dnvCompliant?: boolean | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

type SimaViewMode = "spread" | "catenary" | "dnv" | "code";

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: var(--color-canvas-default, #090d16);
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
  background: var(--surface-hud, rgba(14, 20, 36, 0.78));
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
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

const PillBadge = styled.span<{ $variant?: "sima" | "dnv" | "warn" | "meta" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;

  ${(props) => {
    switch (props.$variant) {
      case "dnv":
        return `
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.35);
        `;
      case "warn":
        return `
          background: rgba(245, 158, 11, 0.15);
          color: #fbbf24;
          border: 1px solid rgba(245, 158, 11, 0.35);
        `;
      case "meta":
        return `
          background: rgba(148, 163, 184, 0.12);
          color: var(--color-fg-muted);
          border: 1px solid rgba(148, 163, 184, 0.25);
        `;
      default:
        return `
          background: rgba(6, 182, 212, 0.15);
          color: #38bdf8;
          border: 1px solid rgba(6, 182, 212, 0.35);
        `;
    }
  }}
`;

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  background: #070b14;
`;

const FloatingControlBar = styled.div`
  position: absolute;
  top: 10px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 5;
  background: rgba(15, 23, 42, 0.88);
  border: 1px solid rgba(51, 65, 85, 0.85);
  border-radius: 6px;
  padding: 4px 8px;
  backdrop-filter: blur(8px);
`;

const FloatingInspectorChip = styled.div`
  position: absolute;
  bottom: 10px;
  right: 12px;
  max-width: 340px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 6px;
  padding: 8px 11px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 4px;
  backdrop-filter: blur(8px);
  font-size: 11px;
  color: #e2e8f0;
`;

const SelectDropdown = styled.select`
  background: #0f172a;
  color: #f8fafc;
  border: 1px solid #334155;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  cursor: pointer;
  outline: none;

  &:focus {
    border-color: #38bdf8;
  }
`;

const AlsToggleButton = styled.button<{ $active: boolean }>`
  background: ${(p) => (p.$active ? "rgba(239, 68, 68, 0.22)" : "rgba(30, 41, 59, 0.8)")};
  color: ${(p) => (p.$active ? "#fca5a5" : "#94a3b8")};
  border: 1px solid ${(p) => (p.$active ? "rgba(239, 68, 68, 0.55)" : "#334155")};
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s ease;

  &:hover {
    color: ${(p) => (p.$active ? "#fecaca" : "#f8fafc")};
    border-color: ${(p) => (p.$active ? "#ef4444" : "#475569")};
  }
`;

const MatrixWrapper = styled.div`
  flex: 1;
  overflow: auto;
  padding: 12px 14px;
  background: #070b14;
  color: #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SummaryStrip = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
`;

const SummaryMetric = styled.div`
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;

  span.label {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #94a3b8;
    font-weight: 600;
  }

  span.val {
    font-size: 14px;
    font-weight: 700;
    font-family: var(--font-mono, monospace);
    color: #f8fafc;
  }
`;

const DnvTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;

  th,
  td {
    padding: 6px 8px;
    text-align: left;
    border-bottom: 1px solid #1e293b;
    white-space: nowrap;
  }

  th {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #94a3b8;
    background: #0f172a;
    position: sticky;
    top: 0;
    z-index: 2;
  }

  tr.clickable-row {
    cursor: pointer;
    transition: background 0.12s ease;
  }

  tr.clickable-row:hover {
    background: rgba(56, 189, 248, 0.08);
  }

  tr.selected-row {
    background: rgba(250, 204, 21, 0.12);
  }
`;

const UtilBarTrack = styled.div`
  width: 58px;
  height: 6px;
  background: #1e293b;
  border-radius: 999px;
  overflow: hidden;
  display: inline-block;
  vertical-align: middle;
  margin-right: 6px;
`;

const UtilBarFill = styled.div<{ $pct: number; $ok: boolean }>`
  width: ${(p) => Math.min(100, Math.max(4, p.$pct))}%;
  height: 100%;
  background: ${(p) => (p.$ok ? "#22c55e" : "#ef4444")};
  border-radius: 999px;
`;

export const SimaViewer: React.FC<SimaViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const initialSource = (viewConfig.code || (viewConfig.source as string | undefined) || "") as string;
  const [rawText, setRawText] = useState(initialSource);
  const [viewMode, setViewMode] = useState<SimaViewMode>("spread");
  const [selectedLineIdx, setSelectedLineIdx] = useState<number>(0);
  const [alsBrokenMode, setAlsBrokenMode] = useState<boolean>(false);

  const title = viewConfig.title || viewConfig.vesselName || "SIMA Mooring & Hydrodynamics (.sima)";

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
        .then((txt) => {
          if (txt) setRawText(txt);
        })
        .catch((err) => console.warn("[SimaViewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.source, viewConfig.url]);

  // Parse the SIMA model & run live catenary / DNV-OS-E301 / offset verification directly from source
  const analysis = useMemo<{
    model: SimaModel | null;
    dnvReport: DnvVerificationReport | null;
    offsetReport: OffsetLimitReport | null;
  }>(() => {
    if (!rawText || !rawText.trim()) {
      return { model: null, dnvReport: null, offsetReport: null };
    }
    try {
      const model = parseSimaFile(rawText);
      if (!model.lines || model.lines.length === 0) {
        return { model, dnvReport: null, offsetReport: null };
      }
      const dnvReport = verifyDnvMooringCompliance(model);
      const offsetReport = evaluateOffsetLimits(model, {
        maxOffsetPercentWaterDepth: alsBrokenMode ? 10.5 : 8.0,
      });
      return { model, dnvReport, offsetReport };
    } catch (err) {
      console.warn("[SimaViewer] Live SIMA parse error:", err);
      return { model: null, dnvReport: null, offsetReport: null };
    }
  }, [rawText, alsBrokenMode]);

  const activeLines: MooringLine[] = analysis.model?.lines ?? [];
  const clampedLineIdx = activeLines.length > 0 ? Math.min(selectedLineIdx, activeLines.length - 1) : 0;
  const selectedLine: MooringLine | undefined = activeLines[clampedLineIdx];
  const selectedDnvLine = analysis.dnvReport?.lines[clampedLineIdx];

  // Dynamically generate the Overhead Polar Mooring Spread SVG from parsed AST
  const liveSpreadSvg = useMemo(() => {
    const { model, dnvReport, offsetReport } = analysis;
    if (!model || model.lines.length === 0) {
      if (typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
        return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen });
      }
      return "";
    }

    const vessel = model.vessels[0];
    const baseOffset = offsetReport?.meanOffsetMeters ?? { x: 0, y: 0 };
    // Under ALS single-line failure, floater drifts further away from the severed line
    let offX = baseOffset.x;
    let offY = baseOffset.y;
    if (alsBrokenMode && selectedLine) {
      const brokenAz = Math.atan2(selectedLine.anchorPosition[1], selectedLine.anchorPosition[0]);
      offX -= Math.cos(brokenAz) * 5.2;
      offY -= Math.sin(brokenAz) * 5.2;
    }

    const rawSvg = renderSimaMooringSpreadSvg({
      title: vessel?.name ? `${vessel.name} Mooring Spread` : `${title} Mooring Spread`,
      waterDepth: model.environment.waterDepth,
      vesselName: vessel?.name ?? title,
      watchCircleRadius: offsetReport?.watchCircleRadiusMeters ?? model.environment.waterDepth * 0.08,
      vesselOffset: { x: offX, y: offY },
      fairleads: vessel?.fairleads,
      selectedLineId: selectedLine?.id,
      brokenLineId: alsBrokenMode ? selectedLine?.id : undefined,
      environment: {
        waveDir: model.environment.wave.direction,
        waveHs: model.environment.wave.hs,
        waveTp: model.environment.wave.tp,
        windDir: model.environment.wind.direction,
        windSpeed: model.environment.wind.speed,
        currentDir: model.environment.current.direction,
        currentSpeed: model.environment.current.surfaceSpeed,
      },
      lines: model.lines.map((l, idx) => {
        const dnv = dnvReport?.lines[idx];
        const isBroken = alsBrokenMode && idx === clampedLineIdx;
        const tension = isBroken ? 0 : alsBrokenMode ? dnv?.tensionDamaged : dnv?.tensionIntact;
        const sf = isBroken ? 0 : alsBrokenMode ? dnv?.safetyFactorDamaged : dnv?.safetyFactorIntact;
        return {
          id: l.id,
          name: l.name,
          fairleadId: l.fairleadId,
          fairleadPos: l.fairleadPosition,
          anchorPos: l.anchorPosition,
          tension,
          mbl: dnv?.mbl ?? l.segments[0]?.mbl,
          safetyFactor: sf,
          broken: isBroken,
          selected: idx === clampedLineIdx,
          segmentCount: l.segments.length,
          totalLength: l.totalLength,
        };
      }),
    });

    return sanitizeSvgMarkup(rawSvg, { isFullScreen });
  }, [analysis, viewConfig.svg, title, selectedLine, alsBrokenMode, clampedLineIdx, isFullScreen]);

  // Dynamically generate the 2D Catenary Sag Profile SVG for the currently selected mooring line
  const liveCatenarySvg = useMemo(() => {
    const { model, dnvReport } = analysis;
    if (!model || !selectedLine) return "";

    const h = model.environment.waterDepth;
    const flPos = selectedLine.fairleadPosition ?? [0, 0, -18];
    const ancPos = selectedLine.anchorPosition;
    const span = Math.hypot((flPos[0] ?? 0) - (ancPos[0] ?? 0), (flPos[1] ?? 0) - (ancPos[1] ?? 0));
    const avgWeight =
      selectedLine.segments.reduce((acc, s) => acc + s.submergedWeightPerMeter * s.length, 0) /
      Math.max(1, selectedLine.totalLength);
    const avgEa =
      selectedLine.segments.reduce((acc, s) => acc + s.axialStiffnessEA * s.length, 0) /
      Math.max(1, selectedLine.totalLength);

    let catResult: ReturnType<typeof solveCatenary> | null = null;
    try {
      catResult = solveCatenary({
        waterDepth: h,
        horizontalSpan: span,
        lineLength: selectedLine.totalLength,
        submergedWeight: avgWeight || 2500,
        axialStiffnessEA: avgEa || 1e9,
      });
    } catch {
      catResult = null;
    }

    const dnvLine = dnvReport?.lines[clampedLineIdx];
    const activeTension = alsBrokenMode
      ? (dnvLine?.tensionDamaged ?? catResult?.fairleadTotalTension)
      : (dnvLine?.tensionIntact ?? catResult?.fairleadTotalTension);
    const activeSf = alsBrokenMode ? dnvLine?.safetyFactorDamaged : dnvLine?.safetyFactorIntact;

    const rawSvg = renderSimaCatenaryProfileSvg({
      title: `2D Catenary Sag Profile — ${selectedLine.name}`,
      waterDepth: h,
      horizontalSpan: span,
      lineLength: selectedLine.totalLength,
      submergedWeight: avgWeight,
      suspendedLength: catResult?.suspendedLength,
      groundedLength: catResult?.groundedLength,
      touchdownDistance: catResult?.touchdownDistance,
      fairleadAngleDeg: catResult?.fairleadAngleDeg,
      anchorAngleDeg: catResult?.anchorAngleDeg,
      fairleadTotalTension: activeTension,
      horizontalTension: catResult?.horizontalTension,
      fairleadVerticalTension: catResult?.fairleadVerticalTension,
      mbl: dnvLine?.mbl,
      safetyFactor: activeSf,
      vesselName: model.vessels[0]?.name,
      profile: catResult?.profile,
      segments: selectedLine.segments.map((s) => ({
        id: s.id,
        name: s.name,
        length: s.length,
        diameter: s.diameter,
        submergedWeight: s.submergedWeightPerMeter,
        mbl: s.mbl,
        material: s.material,
      })),
    });

    return sanitizeSvgMarkup(rawSvg, { isFullScreen });
  }, [analysis, selectedLine, clampedLineIdx, alsBrokenMode, isFullScreen]);

  // Handle interactive clicking on mooring lines in the Polar Spread SVG
  const handleSpreadSvgClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as Element | null;
      const lineGroup = target?.closest?.(".mooring-line");
      if (!lineGroup) return;
      const idxAttr = lineGroup.getAttribute("data-line-index");
      if (idxAttr !== null) {
        const idx = Number.parseInt(idxAttr, 10);
        if (!Number.isNaN(idx) && idx >= 0 && idx < activeLines.length) {
          setSelectedLineIdx(idx);
        }
      }
    },
    [activeLines.length],
  );

  const handleCopyCode = useCallback(() => {
    if (!rawText) return;
    navigator.clipboard.writeText(rawText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [rawText]);

  const waterDepth =
    analysis.model?.environment.waterDepth ?? viewConfig.waterDepthM ?? viewConfig.waterDepthMeters ?? 320;
  const lineCount = activeLines.length || viewConfig.lineCount || viewConfig.mooringLinesCount || 0;
  const dnvAllPassed = analysis.dnvReport ? analysis.dnvReport.summary.allPassed : (viewConfig.dnvCompliant ?? true);
  const minSf = analysis.dnvReport?.summary.minSafetyFactor;

  const codeLines = rawText ? rawText.split(/\r?\n/) : [];

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <ShieldCheckIcon size={15} fill="var(--color-accent-fg, #38bdf8)" />
          {!isFullScreen && <ModelTitle title={title}>{title}</ModelTitle>}
          <PillBadge>SIMA Marine</PillBadge>
          <PillBadge $variant="meta">
            {lineCount} Lines · {waterDepth}m
          </PillBadge>
          {dnvAllPassed ? (
            <PillBadge $variant="dnv">
              <CheckCircleIcon size={11} /> DNV-OS-E301 {minSf ? `(SF ${minSf.toFixed(2)})` : "Verified"}
            </PillBadge>
          ) : (
            <PillBadge $variant="warn">
              <AlertIcon size={11} /> DNV Check
            </PillBadge>
          )}
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
          <SegmentedControl size="small" aria-label="SIMA View Selector">
            <SegmentedControl.Button selected={viewMode === "spread"} onClick={() => setViewMode("spread")}>
              Mooring Spread
            </SegmentedControl.Button>
            {activeLines.length > 0 && (
              <SegmentedControl.Button selected={viewMode === "catenary"} onClick={() => setViewMode("catenary")}>
                Catenary Sag
              </SegmentedControl.Button>
            )}
            {analysis.dnvReport && (
              <SegmentedControl.Button selected={viewMode === "dnv"} onClick={() => setViewMode("dnv")}>
                DNV-OS-E301
              </SegmentedControl.Button>
            )}
            <SegmentedControl.Button selected={viewMode === "code"} onClick={() => setViewMode("code")}>
              Source
            </SegmentedControl.Button>
          </SegmentedControl>

          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={PlayIcon}
              onClick={() => {
                const hash = compressMorselPayload({
                  v: 1,
                  lang: "sima" as any,
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
        ) : viewMode === "spread" && liveSpreadSvg ? (
          <>
            {activeLines.length > 0 && (
              <FloatingControlBar>
                <span style={{ fontSize: "10.5px", color: "#94a3b8", fontWeight: 600 }}>Inspect:</span>
                <SelectDropdown
                  aria-label="Select Mooring Line"
                  value={clampedLineIdx}
                  onChange={(e) => setSelectedLineIdx(Number(e.target.value))}
                >
                  {activeLines.map((l, idx) => (
                    <option key={l.id} value={idx}>
                      {l.name} ({l.fairleadId})
                    </option>
                  ))}
                </SelectDropdown>
                <AlsToggleButton
                  type="button"
                  $active={alsBrokenMode}
                  onClick={() => setAlsBrokenMode((v) => !v)}
                  title="Simulate DNV-OS-E301 Accidental Limit State (ALS) single-line failure"
                >
                  {alsBrokenMode ? "⚡ ALS Line Severed" : "ALS Line-Break Test"}
                </AlsToggleButton>
              </FloatingControlBar>
            )}

            <div onClick={handleSpreadSvgClick} style={{ display: "flex", flex: 1, minHeight: 0, width: "100%" }}>
              <InteractiveSvgStage svgHtml={liveSpreadSvg} />
            </div>

            {selectedLine && selectedDnvLine && (
              <FloatingInspectorChip>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                  <strong style={{ color: "#facc15", fontSize: "11.5px" }}>{selectedLine.name}</strong>
                  <span
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: "10px",
                      color: alsBrokenMode ? "#f87171" : "#34d399",
                      fontWeight: 600,
                    }}
                  >
                    {alsBrokenMode
                      ? "ALS SEVERED"
                      : `SF ${selectedDnvLine.safetyFactorIntact.toFixed(2)} (Intact) · ${selectedDnvLine.safetyFactorDamaged.toFixed(2)} (ALS)`}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    fontSize: "10.5px",
                    color: "#cbd5e1",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  <span>L: {selectedLine.totalLength.toFixed(0)}m</span>
                  <span>T: {(selectedDnvLine.tensionIntact / 1000).toFixed(0)} kN</span>
                  <span>MBL: {(selectedDnvLine.mbl / 1000).toFixed(0)} kN</span>
                  <button
                    type="button"
                    onClick={() => setViewMode("catenary")}
                    style={{
                      marginLeft: "auto",
                      background: "transparent",
                      border: "none",
                      color: "#38bdf8",
                      cursor: "pointer",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      padding: 0,
                    }}
                  >
                    View Catenary →
                  </button>
                </div>
              </FloatingInspectorChip>
            )}
          </>
        ) : viewMode === "catenary" && liveCatenarySvg ? (
          <>
            {activeLines.length > 0 && (
              <FloatingControlBar>
                <span style={{ fontSize: "10.5px", color: "#94a3b8", fontWeight: 600 }}>Line:</span>
                <SelectDropdown
                  aria-label="Select Line for Catenary Sag Profile"
                  value={clampedLineIdx}
                  onChange={(e) => setSelectedLineIdx(Number(e.target.value))}
                >
                  {activeLines.map((l, idx) => (
                    <option key={l.id} value={idx}>
                      {l.name} ({l.segments.length} seg · {l.totalLength}m)
                    </option>
                  ))}
                </SelectDropdown>
                <AlsToggleButton type="button" $active={alsBrokenMode} onClick={() => setAlsBrokenMode((v) => !v)}>
                  {alsBrokenMode ? "ALS Damaged Load" : "ULS Intact Load"}
                </AlsToggleButton>
              </FloatingControlBar>
            )}
            <InteractiveSvgStage svgHtml={liveCatenarySvg} />
          </>
        ) : viewMode === "dnv" && analysis.dnvReport ? (
          <MatrixWrapper>
            <SummaryStrip>
              <SummaryMetric>
                <span className="label">Standard</span>
                <span className="val" style={{ color: "#38bdf8" }}>
                  {analysis.dnvReport.standard}
                </span>
              </SummaryMetric>
              <SummaryMetric>
                <span className="label">Water Depth &amp; Wave</span>
                <span className="val">
                  {waterDepth}m · Hs {analysis.model?.environment.wave.hs ?? 14.2}m
                </span>
              </SummaryMetric>
              <SummaryMetric>
                <span className="label">Min Intact SF (≥1.67)</span>
                <span
                  className="val"
                  style={{ color: analysis.dnvReport.summary.minSafetyFactor >= 1.67 ? "#34d399" : "#f87171" }}
                >
                  {analysis.dnvReport.summary.minSafetyFactor.toFixed(2)}
                </span>
              </SummaryMetric>
              <SummaryMetric>
                <span className="label">Mean Excursion / Watch</span>
                <span className="val">
                  {analysis.offsetReport?.meanOffsetMeters.total.toFixed(1) ?? "4.2"}m /{" "}
                  {analysis.offsetReport?.watchCircleRadiusMeters.toFixed(1) ?? "25.6"}m
                </span>
              </SummaryMetric>
            </SummaryStrip>

            <DnvTable>
              <thead>
                <tr>
                  <th>Mooring Line</th>
                  <th>Fairlead</th>
                  <th>Segments</th>
                  <th>MBL (kN)</th>
                  <th>ULS Tension (kN)</th>
                  <th>ULS SF (≥1.67)</th>
                  <th>ALS Tension (kN)</th>
                  <th>ALS SF (≥1.25)</th>
                  <th>Utilization</th>
                </tr>
              </thead>
              <tbody>
                {analysis.dnvReport.lines.map((r, idx) => {
                  const lineObj = activeLines[idx];
                  const isSel = idx === clampedLineIdx;
                  const utilPct = Math.round(r.utilizationIntact * 100);
                  return (
                    <tr
                      key={r.lineId}
                      className={`clickable-row ${isSel ? "selected-row" : ""}`}
                      onClick={() => {
                        setSelectedLineIdx(idx);
                        setViewMode("catenary");
                      }}
                      title="Click to inspect 2D Catenary Sag Profile for this line"
                    >
                      <td style={{ fontWeight: 600, color: isSel ? "#facc15" : "#f8fafc" }}>{r.lineName}</td>
                      <td style={{ fontFamily: "var(--font-mono, monospace)", color: "#94a3b8" }}>
                        {lineObj?.fairleadId ?? "—"}
                      </td>
                      <td>{lineObj ? `${lineObj.segments.length} (${lineObj.totalLength}m)` : "—"}</td>
                      <td style={{ fontFamily: "var(--font-mono, monospace)" }}>{(r.mbl / 1000).toFixed(0)}</td>
                      <td style={{ fontFamily: "var(--font-mono, monospace)", color: "#38bdf8" }}>
                        {(r.tensionIntact / 1000).toFixed(0)}
                      </td>
                      <td
                        style={{
                          fontFamily: "var(--font-mono, monospace)",
                          fontWeight: 700,
                          color: r.passedIntact ? "#34d399" : "#f87171",
                        }}
                      >
                        {r.safetyFactorIntact.toFixed(2)}
                      </td>
                      <td style={{ fontFamily: "var(--font-mono, monospace)", color: "#cbd5e1" }}>
                        {(r.tensionDamaged / 1000).toFixed(0)}
                      </td>
                      <td
                        style={{
                          fontFamily: "var(--font-mono, monospace)",
                          fontWeight: 700,
                          color: r.passedDamaged ? "#34d399" : "#f87171",
                        }}
                      >
                        {r.safetyFactorDamaged.toFixed(2)}
                      </td>
                      <td style={{ fontFamily: "var(--font-mono, monospace)" }}>
                        <UtilBarTrack>
                          <UtilBarFill $pct={utilPct} $ok={r.passedIntact && r.passedDamaged} />
                        </UtilBarTrack>
                        <span>{utilPct}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DnvTable>
          </MatrixWrapper>
        ) : (
          <Box
            flex={1}
            py={2}
            overflow="auto"
            bg="var(--color-canvas-inset, #010409)"
            style={{
              position: "relative",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "12px",
              lineHeight: 1.55,
            }}
          >
            {rawText && (
              <Button
                size="small"
                leadingVisual={copied ? CheckIcon : CopyIcon}
                onClick={handleCopyCode}
                style={{ position: "absolute", top: 8, right: 14, zIndex: 4 }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
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
                    {highlightPolyglotLine(line, "sima")}
                  </span>
                </div>
              ))
            ) : (
              <Box p={4} color="var(--color-fg-muted)" textAlign="center">
                No SIMA mooring source available.
              </Box>
            )}
          </Box>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default SimaViewer;
