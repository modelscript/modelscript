// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  renderSwmmProfileSvg,
  renderSwmmSvg,
  type SwmmConduitLike,
  type SwmmJunctionLike,
  type SwmmModelLike,
  type SwmmOutfallLike,
} from "@modelscript/diagram";
import { parseSwmm, routeNetworkFlow, serializeSwmm, type SwmmDeck } from "@modelscript/swmm";
import { CheckIcon, CodeIcon, CopyIcon, DownloadIcon, PencilIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { useTheme } from "../../theme";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import Spinner from "../Spinner";
import { InteractiveSvgStage, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

export interface SwmmViewerProps {
  viewConfig: {
    artifactId?: string | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    mode?: "plan" | "profile" | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

export type SwmmViewMode = "plan" | "profile";

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
`;

const ModeButton = styled.button<{ $active: boolean }>`
  background: ${(props) => (props.$active ? "var(--color-accent-subtle, rgba(56, 139, 253, 0.15))" : "transparent")};
  color: ${(props) => (props.$active ? "var(--color-accent-fg, #58a6ff)" : "var(--color-fg-muted, #8b949e)")};
  border: 1px solid ${(props) => (props.$active ? "var(--color-accent-muted, rgba(56, 139, 253, 0.4))" : "transparent")};
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-fg-default, #c9d1d9);
    background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.05));
  }
`;

const TelemetryBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-family: monospace;
  color: var(--color-fg-muted);
  background: var(--color-canvas-default);
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid var(--color-border-subtle, #30363d);
`;

const CodeOverlay = styled.div`
  position: absolute;
  top: 40px;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-canvas-default);
  z-index: 20;
  overflow: auto;
  padding: 16px;
  font-family: monospace;
  font-size: 12px;
  white-space: pre;
  color: var(--color-fg-default);
`;

const StatusPill = styled.span<{ $danger?: boolean }>`
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 999px;
  text-transform: uppercase;
  background: ${(p) => (p.$danger ? "rgba(218, 54, 51, 0.2)" : "rgba(35, 134, 54, 0.2)")};
  color: ${(p) => (p.$danger ? "#f85149" : "#3fb950")};
  border: 1px solid ${(p) => (p.$danger ? "rgba(218, 54, 51, 0.4)" : "rgba(35, 134, 54, 0.4)")};
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

const SAMPLE_SWMM_INP = `[TITLE]
Municipal Combined Sewer & Stormwater Collection Network

[JUNCTIONS]
;Name   Elevation  MaxDepth  InitDepth  SurDepth  Aponded
 J1     100.0      10.0      0.0        0.0       0.0
 J2     96.0       10.0      0.0        0.0       0.0
 J3     92.0       10.0      0.0        0.0       0.0
 J4     88.0       12.0      0.0        0.0       0.0

[OUTFALLS]
;Name   Elevation  Type      StageData  Gated
 OUT1   84.0       FREE                 NO

[CONDUITS]
;Name   FromNode  ToNode  Length  Roughness  InOffset  OutOffset  InitFlow  MaxFlow
 C1     J1        J2      400.0   0.013      0.0       0.0        0.0       0.0
 C2     J2        J3      350.0   0.013      0.0       0.0        0.0       0.0
 C3     J3        J4      300.0   0.013      0.0       0.0        0.0       0.0
 C4     J4        OUT1    250.0   0.013      0.0       0.0        0.0       0.0

[XSECTIONS]
;Link   Shape         Geom1  Geom2  Geom3  Geom4  Barrels
 C1     CIRCULAR      1.2    0.0    0.0    0.0    1
 C2     CIRCULAR      1.5    0.0    0.0    0.0    1
 C3     CIRCULAR      1.8    0.0    0.0    0.0    1
 C4     CIRCULAR      2.0    0.0    0.0    0.0    1

[COORDINATES]
;Node   X-Coord   Y-Coord
 J1     100.0     400.0
 J2     300.0     350.0
 J3     550.0     300.0
 J4     750.0     220.0
 OUT1   950.0     150.0
`;

export const SwmmViewer: React.FC<SwmmViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const { colorMode } = useTheme();
  const isDark = colorMode === "dark";

  const [localCode, setLocalCode] = useState<string>(viewConfig.code || SAMPLE_SWMM_INP);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [newMaxDepth, setNewMaxDepth] = useState<number>(3.0);
  const [newDiameter, setNewDiameter] = useState<number>(1.5);

  const [viewMode, setViewMode] = useState<SwmmViewMode>(viewConfig.mode ?? "plan");
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (viewConfig.code) {
      setLocalCode(viewConfig.code);
    }
  }, [viewConfig.code]);

  const handleAddJunctionAndConduit = () => {
    try {
      const parsed = parseSwmm(localCode || SAMPLE_SWMM_INP);
      const juncCount = parsed.junctions.size;
      const newJuncId = `J${juncCount + 1}`;
      const lastJuncId = `J${juncCount}`;
      const conduitCount = parsed.conduits.size;
      const newConduitId = `C${conduitCount + 1}`;

      parsed.junctions.set(newJuncId, {
        id: newJuncId,
        elevation: Math.max(70.0, 90.0 - juncCount * 2.0),
        maxDepth: newMaxDepth,
        initDepth: 0.0,
        surDepth: 0.0,
        apond: 0.0,
      });

      parsed.conduits.set(newConduitId, {
        id: newConduitId,
        fromNode: lastJuncId,
        toNode: newJuncId,
        length: 300.0,
        roughness: 0.013,
        inOffset: 0.0,
        outOffset: 0.0,
        initFlow: 0.0,
        maxFlow: 0.0,
      });

      parsed.crossSections.set(newConduitId, {
        linkId: newConduitId,
        shape: "CIRCULAR",
        geom1: newDiameter,
        geom2: 0,
        geom3: 0,
        geom4: 0,
        barrels: 1,
      });

      const updated = serializeSwmm(parsed);
      setLocalCode(updated);
    } catch {
      // Fallback
    }
  };

  const handleUndoLastConduit = () => {
    try {
      const parsed = parseSwmm(localCode || SAMPLE_SWMM_INP);
      if (parsed.conduits.size > 1) {
        const lastConduitKey = Array.from(parsed.conduits.keys()).pop();
        if (lastConduitKey) {
          parsed.conduits.delete(lastConduitKey);
          parsed.crossSections.delete(lastConduitKey);
        }
      }
      if (parsed.junctions.size > 1) {
        const lastJuncKey = Array.from(parsed.junctions.keys()).pop();
        if (lastJuncKey) {
          parsed.junctions.delete(lastJuncKey);
        }
      }
      const updated = serializeSwmm(parsed);
      setLocalCode(updated);
    } catch {
      // Fallback
    }
  };

  const rawCode = localCode || viewConfig.code || SAMPLE_SWMM_INP;

  // 1. Parse SWMM input deck
  const deck = useMemo<SwmmDeck>(() => {
    try {
      return parseSwmm(rawCode);
    } catch {
      return parseSwmm(SAMPLE_SWMM_INP);
    }
  }, [rawCode]);

  // 2. Solve hydraulic routing
  const routing = useMemo(() => {
    try {
      return routeNetworkFlow(deck);
    } catch {
      return null;
    }
  }, [deck]);

  // 3. Build diagram model
  const diagramModel = useMemo<SwmmModelLike>(() => {
    const junctions: SwmmJunctionLike[] = Array.from(deck.junctions.values()).map((j, i) => {
      const coord = deck.coordinates?.get(j.id);
      return {
        id: j.id,
        elevation: j.elevation,
        maxDepth: j.maxDepth,
        initDepth: j.initDepth,
        surchargeDepth: j.surchargeDepth,
        x: coord?.x ?? 80 + i * 140,
        y: coord?.y ?? 100 + ((i * 37) % 150),
      };
    });

    const outfalls: SwmmOutfallLike[] = Array.from(deck.outfalls.values()).map((o, i) => {
      const coord = deck.coordinates?.get(o.id);
      return {
        id: o.id,
        elevation: o.elevation,
        type: o.type,
        stage: o.stage,
        x: coord?.x ?? 120 + (junctions.length + i) * 140,
        y: coord?.y ?? 150,
      };
    });

    const conduits: SwmmConduitLike[] = Array.from(deck.conduits.values()).map((c) => {
      const res = routing?.conduits.get(c.id);
      return {
        id: c.id,
        fromNode: c.fromNode,
        toNode: c.toNode,
        inletNode: c.fromNode,
        outletNode: c.toNode,
        length: c.length,
        roughness: c.roughness,
        inletOffset: c.inletOffset,
        outletOffset: c.outletOffset,
        capacityFraction: res ? res.flowRate / Math.max(0.1, res.capacity) : 0.4,
      };
    });

    return {
      title: deck.title || "Stormwater Conveyance Network",
      flowUnits: deck.flowUnits,
      junctions,
      outfalls,
      conduits,
    };
  }, [deck, routing]);

  // 4. Generate SVG markup
  const svgMarkup = useMemo(() => {
    if (viewConfig.svg && !viewConfig.code) {
      return viewConfig.svg;
    }
    if (viewMode === "profile") {
      return renderSwmmProfileSvg(diagramModel, {
        width: 900,
        height: 400,
        theme: isDark ? "dark" : "light",
        title: `${diagramModel.title} — Longitudinal HGL Profile`,
      });
    }
    return renderSwmmSvg(diagramModel, {
      width: 900,
      height: 460,
      theme: isDark ? "dark" : "light",
      showLegend: true,
      title: diagramModel.title,
    });
  }, [viewConfig.svg, viewConfig.code, viewMode, diagramModel, isDark]);

  const sanitizedSvg = useMemo(() => sanitizeSvgMarkup(svgMarkup), [svgMarkup]);

  const handleCopy = () => {
    navigator.clipboard.writeText(rawCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const blob = new Blob([rawCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(deck.title || "swmm-network").replace(/\s+/g, "_").toLowerCase()}.inp`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <CardWrapper $isFullScreen={isFullScreen} data-testid="swmm-viewer">
      <Toolbar>
        {/* Left: Mode toggles */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <DraftingTriangleIcon />
          <ModeButton
            type="button"
            $active={viewMode === "plan"}
            onClick={() => {
              setViewMode("plan");
              setShowCode(false);
            }}
          >
            Plan View
          </ModeButton>
          <ModeButton
            type="button"
            $active={viewMode === "profile"}
            onClick={() => {
              setViewMode("profile");
              setShowCode(false);
            }}
          >
            HGL Profile
          </ModeButton>
        </div>

        {/* Center: Live Telemetry */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TelemetryBadge>
            Junctions: <strong style={{ color: "var(--color-fg-default)" }}>{deck.junctions.size}</strong>
          </TelemetryBadge>
          <TelemetryBadge>
            Conduits: <strong style={{ color: "var(--color-fg-default)" }}>{deck.conduits.size}</strong>
          </TelemetryBadge>
          <TelemetryBadge>
            Inflow: <strong style={{ color: "#38bdf8" }}>{routing ? routing.totalInflow.toFixed(1) : "0.0"}</strong>{" "}
            {deck.flowUnits}
          </TelemetryBadge>
          <StatusPill $danger={routing?.isFlooding}>
            {routing?.isFlooding ? "Surcharge Active" : "Gravity Flow OK"}
          </StatusPill>
        </div>

        {/* Right: Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Button size="small" variant="invisible" onClick={() => setShowCode(!showCode)} title="View SWMM Deck">
            <CodeIcon />
          </Button>
          <Button size="small" variant="invisible" onClick={handleCopy} title="Copy SWMM Deck">
            {copied ? <CheckIcon fill="#3fb950" /> : <CopyIcon />}
          </Button>
          <Button size="small" variant="invisible" onClick={handleDownload} title="Export .inp">
            <DownloadIcon />
          </Button>
          <Button
            size="small"
            variant={isEditing ? "primary" : "invisible"}
            leadingVisual={PencilIcon}
            onClick={() => setIsEditing(!isEditing)}
            title="Toggle Interactive Editor"
          >
            {isEditing ? "Editing" : "Edit Studio"}
          </Button>
        </div>
      </Toolbar>

      {/* Interactive Editing Studio Ribbon */}
      {isEditing && (
        <EditRibbon>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 700, color: "var(--color-accent-fg, #1f6feb)" }}>SWMM STUDIO:</span>
            <Button size="small" onClick={handleAddJunctionAndConduit}>
              + Add Manhole &amp; Conduit
            </Button>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span>Max Depth (m):</span>
              <input
                type="number"
                value={newMaxDepth}
                onChange={(e) => setNewMaxDepth(parseFloat(e.target.value) || 1)}
                style={{
                  width: "50px",
                  fontSize: "11px",
                  padding: "2px 4px",
                  borderRadius: "4px",
                  border: "1px solid var(--color-border-default)",
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span>Diameter (m):</span>
              <input
                type="number"
                value={newDiameter}
                onChange={(e) => setNewDiameter(parseFloat(e.target.value) || 0.5)}
                style={{
                  width: "50px",
                  fontSize: "11px",
                  padding: "2px 4px",
                  borderRadius: "4px",
                  border: "1px solid var(--color-border-default)",
                }}
              />
            </div>
            <Button size="small" variant="danger" onClick={handleUndoLastConduit}>
              Undo Last
            </Button>
          </div>
        </EditRibbon>
      )}

      {showCode && <CodeOverlay>{rawCode}</CodeOverlay>}

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

export default React.memo(SwmmViewer);
