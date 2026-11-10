// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  renderEpanetHglProfileSvg,
  renderEpanetPlanSvg,
  type EpanetJunctionLike,
  type EpanetModelLike,
  type EpanetPipeLike,
} from "@modelscript/diagram";
import { parseInp, serializeInp, solveHydraulics } from "@modelscript/epanet";
import { CheckIcon, CopyIcon, DownloadIcon, PencilIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { useTheme } from "../../theme";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import Spinner from "../Spinner";
import { InteractiveSvgStage, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

export interface EpanetViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    mode?: "plan" | "hgl" | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

export type EpanetViewMode = "plan" | "hgl";
export type EpanetPropertyMode = "pressure" | "velocity" | "fireflow";

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
  min-height: 30px;
  background: var(--color-canvas-inset, var(--color-canvas-subtle));
  border-bottom: 1px solid var(--color-border-muted, var(--color-border-default));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 12px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  color: var(--color-fg-muted);
  overflow-x: auto;
  white-space: nowrap;
`;

const TelemetryMetricsGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
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

const SegmentedControls = styled.div`
  display: flex;
  align-items: center;
  background: var(--color-canvas-default);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
`;

const SegmentButton = styled.button<{ $active: boolean }>`
  background: ${(props) => (props.$active ? "var(--color-accent-emphasis)" : "transparent")};
  color: ${(props) => (props.$active ? "#ffffff" : "var(--color-fg-default)")};
  border: none;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: ${(props) => (props.$active ? "var(--color-accent-emphasis)" : "var(--color-canvas-subtle)")};
  }
`;

const EditRibbon = styled.div`
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  padding: 6px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
`;

export const EpanetViewer: React.FC<EpanetViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const { colorMode } = useTheme();
  const isDark = colorMode === "dark";

  const [localCode, setLocalCode] = useState<string>(viewConfig.code || "");
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [newJuncDemand, setNewJuncDemand] = useState<number>(25.0);
  const [newPipeDiameter, setNewPipeDiameter] = useState<number>(200.0);

  const [viewMode, setViewMode] = useState<EpanetViewMode>(viewConfig.mode ?? "plan");
  const [propertyMode, setPropertyMode] = useState<EpanetPropertyMode>("pressure");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (viewConfig.code) {
      setLocalCode(viewConfig.code);
    }
  }, [viewConfig.code]);

  // Handle adding a new junction and connecting it to the preceding node
  const handleAddJunctionAndPipe = () => {
    try {
      const parsed = parseInp(localCode || viewConfig.code || "");
      const newId = `J${parsed.junctions.length + 1}`;
      const lastNodeId =
        parsed.junctions.length > 0
          ? parsed.junctions[parsed.junctions.length - 1]!.id
          : (parsed.reservoirs[0]?.id ?? "R1");
      const newPipeId = `P${parsed.pipes.length + 1}`;

      parsed.junctions.push({
        id: newId,
        elevation: 15.0,
        demand: newJuncDemand,
      });

      parsed.pipes.push({
        id: newPipeId,
        node1: lastNodeId,
        node2: newId,
        length: 400.0,
        diameter: newPipeDiameter,
        roughness: 110.0,
      });

      const updatedDeck = serializeInp(parsed);
      setLocalCode(updatedDeck);
    } catch {
      // Fallback
    }
  };

  const handleUndoLast = () => {
    try {
      const parsed = parseInp(localCode || viewConfig.code || "");
      if (parsed.pipes.length > 1) {
        parsed.pipes.pop();
      }
      if (parsed.junctions.length > 1) {
        parsed.junctions.pop();
      }
      const updatedDeck = serializeInp(parsed);
      setLocalCode(updatedDeck);
    } catch {
      // Fallback
    }
  };

  // Parse EPANET model and solve hydraulics
  const { net, modelLike, minPressure, maxVelocity, totalDemandLps } = useMemo(() => {
    const rawCode = localCode || viewConfig.code || "";
    if (!rawCode.trim()) {
      return {
        net: null,
        modelLike: null,
        minPressure: 0,
        maxVelocity: 0,
        totalDemandLps: 0,
      };
    }

    try {
      const parsed = parseInp(rawCode);
      const hyd = solveHydraulics(parsed);

      let minP = Number.POSITIVE_INFINITY;
      let maxV = 0.0;
      let totDem = 0.0;

      const juncLikes: EpanetJunctionLike[] = parsed.junctions.map((j) => {
        const p = hyd.nodePressures.get(j.id) ?? 0.0;
        const h = hyd.nodeHeads.get(j.id) ?? j.elevation + p;
        if (p < minP) minP = p;
        totDem += j.demand;
        return {
          id: j.id,
          elevation: j.elevation,
          demand: j.demand,
          pressure: p,
          head: h,
        };
      });

      const pipeLikes: EpanetPipeLike[] = parsed.pipes.map((p) => {
        const v = hyd.linkVelocities.get(p.id) ?? 0.0;
        const q = hyd.linkFlows.get(p.id) ?? 0.0;
        const hl = hyd.linkHeadLosses.get(p.id) ?? 0.0;
        if (Math.abs(v) > maxV) maxV = Math.abs(v);
        return {
          id: p.id,
          node1: p.node1,
          node2: p.node2,
          length: p.length,
          diameter: p.diameter,
          roughness: p.roughness,
          velocity: v,
          flow: q,
          headLoss: hl,
        };
      });

      const mLike: EpanetModelLike = {
        title: parsed.title,
        junctions: juncLikes,
        reservoirs: parsed.reservoirs.map((r) => ({ id: r.id, totalHead: r.totalHead })),
        tanks: parsed.tanks.map((t) => ({ id: t.id, elevation: t.elevation, initLevel: t.initLevel })),
        pipes: pipeLikes,
        pumps: parsed.pumps.map((p) => ({ id: p.id, node1: p.node1, node2: p.node2, power: p.power })),
        valves: parsed.valves.map((v) => ({
          id: v.id,
          node1: v.node1,
          node2: v.node2,
          type: v.type,
          setting: v.setting,
        })),
      };

      return {
        net: parsed,
        modelLike: mLike,
        minPressure: Number.isFinite(minP) ? minP : 0.0,
        maxVelocity: maxV,
        totalDemandLps: totDem,
      };
    } catch {
      return {
        net: null,
        modelLike: null,
        minPressure: 0,
        maxVelocity: 0,
        totalDemandLps: 0,
      };
    }
  }, [viewConfig.code]);

  // Generate SVG markup
  const svgMarkup = useMemo(() => {
    if (viewConfig.svg) return viewConfig.svg;
    if (!modelLike) return "";

    if (viewMode === "hgl") {
      const junctionsArr = Array.isArray(modelLike.junctions)
        ? modelLike.junctions
        : Array.from(modelLike.junctions.values());
      const pipesArr = Array.isArray(modelLike.pipes) ? modelLike.pipes : Array.from(modelLike.pipes.values());
      return renderEpanetHglProfileSvg(junctionsArr, pipesArr, {
        theme: isDark ? "dark" : "light",
        title: `${modelLike.title || "Network"} - HGL Profile`,
      });
    }

    return renderEpanetPlanSvg(modelLike, {
      theme: isDark ? "dark" : "light",
      propertyMode,
    });
  }, [viewConfig.svg, modelLike, viewMode, propertyMode, isDark]);

  const sanitizedSvg = useMemo(() => sanitizeSvgMarkup(svgMarkup), [svgMarkup]);

  const handleCopyCode = () => {
    if (viewConfig.code) {
      navigator.clipboard.writeText(viewConfig.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadSvg = () => {
    if (!sanitizedSvg) return;
    const blob = new Blob([sanitizedSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${viewConfig.title || "epanet-network"}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      {/* Top Controls Toolbar */}
      <Toolbar>
        <HeaderLeft>
          <DraftingTriangleIcon size={16} />
          <ModelTitle>{viewConfig.title || net?.title || "EPANET Water Distribution Studio"}</ModelTitle>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gridGap={2}>
          <SegmentedControls>
            <SegmentButton $active={viewMode === "plan"} onClick={() => setViewMode("plan")}>
              Plan View
            </SegmentButton>
            <SegmentButton $active={viewMode === "hgl"} onClick={() => setViewMode("hgl")}>
              HGL Profile
            </SegmentButton>
          </SegmentedControls>

          {viewMode === "plan" && (
            <SegmentedControls>
              <SegmentButton $active={propertyMode === "pressure"} onClick={() => setPropertyMode("pressure")}>
                Pressure
              </SegmentButton>
              <SegmentButton $active={propertyMode === "velocity"} onClick={() => setPropertyMode("velocity")}>
                Velocity
              </SegmentButton>
              <SegmentButton $active={propertyMode === "fireflow"} onClick={() => setPropertyMode("fireflow")}>
                Fire Flow (NFPA)
              </SegmentButton>
            </SegmentedControls>
          )}

          <Button
            size="small"
            variant="invisible"
            leadingVisual={copied ? CheckIcon : CopyIcon}
            onClick={handleCopyCode}
            aria-label="Copy INP Deck"
          />

          <Button
            size="small"
            variant="invisible"
            leadingVisual={DownloadIcon}
            onClick={handleDownloadSvg}
            aria-label="Download SVG"
          />

          <Button
            size="small"
            variant={isEditing ? "primary" : "invisible"}
            leadingVisual={PencilIcon}
            onClick={() => setIsEditing(!isEditing)}
            aria-label="Toggle Interactive Editor"
          >
            {isEditing ? "Editing" : "Edit Studio"}
          </Button>
        </Box>
      </Toolbar>

      {/* Interactive Editing Studio Ribbon */}
      {isEditing && (
        <EditRibbon>
          <Box display="flex" alignItems="center" gridGap={2}>
            <span style={{ fontWeight: 700, color: "var(--color-accent-fg, #1f6feb)" }}>INTERACTIVE STUDIO:</span>
            <Button size="small" onClick={handleAddJunctionAndPipe}>
              + Add Node &amp; Pipe
            </Button>
            <Box display="flex" alignItems="center" gridGap={1}>
              <span>Demand (L/s):</span>
              <input
                type="number"
                value={newJuncDemand}
                onChange={(e) => setNewJuncDemand(parseFloat(e.target.value) || 0)}
                style={{
                  width: "50px",
                  fontSize: "11px",
                  padding: "2px 4px",
                  borderRadius: "4px",
                  border: "1px solid var(--color-border-default)",
                }}
              />
            </Box>
            <Box display="flex" alignItems="center" gridGap={1}>
              <span>Diameter (mm):</span>
              <input
                type="number"
                value={newPipeDiameter}
                onChange={(e) => setNewPipeDiameter(parseFloat(e.target.value) || 100)}
                style={{
                  width: "50px",
                  fontSize: "11px",
                  padding: "2px 4px",
                  borderRadius: "4px",
                  border: "1px solid var(--color-border-default)",
                }}
              />
            </Box>
            <Button size="small" variant="danger" onClick={handleUndoLast}>
              Undo Last
            </Button>
          </Box>
        </EditRibbon>
      )}

      {/* Telemetry Metrics Ribbon */}
      <TelemetryRibbon>
        <TelemetryMetricsGroup>
          <MetricItem>
            Junctions: <strong>{net?.junctions.length ?? 0}</strong>
          </MetricItem>
          <MetricItem>
            Pipes: <strong>{net?.pipes.length ?? 0}</strong>
          </MetricItem>
          <MetricItem>
            Tanks: <strong>{net?.tanks.length ?? 0}</strong>
          </MetricItem>
          <MetricItem>
            Min Pressure: <strong>{minPressure.toFixed(1)} m</strong>
          </MetricItem>
          <MetricItem>
            Max Velocity: <strong>{maxVelocity.toFixed(2)} m/s</strong>
          </MetricItem>
          <MetricItem>
            Total Demand: <strong>{totalDemandLps.toFixed(1)} L/s</strong>
          </MetricItem>
        </TelemetryMetricsGroup>
      </TelemetryRibbon>

      {/* Main SVG Interactive Stage */}
      <Box flex={1} position="relative" overflow="hidden" display="flex">
        {sanitizedSvg ? (
          <InteractiveSvgStage
            svgMarkup={sanitizedSvg}
            isFullScreen={isFullScreen}
            showMinimapHud={false}
            hasActiveFilter={false}
          />
        ) : (
          <Box flex={1} display="flex" alignItems="center" justifyContent="center">
            <Spinner />
          </Box>
        )}
      </Box>
    </CardWrapper>
  );
};

export default React.memo(EpanetViewer);
