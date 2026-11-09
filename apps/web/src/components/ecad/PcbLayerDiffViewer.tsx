// SPDX-License-Identifier: AGPL-3.0-or-later

import { DiffAddedIcon, DiffIcon, DiffModifiedIcon, DiffRemovedIcon, ScreenFullIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Text } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { computePcbDiff } from "./pcb-diff-engine.js";
import type { DiffFeature, DiffStatus, PcbDesignData, PcbDiffResult } from "./types.js";

export interface PcbLayerDiffViewerProps {
  revA: PcbDesignData;
  revB: PcbDesignData;
  height?: number | string | undefined;
  onSelectFeature?: ((feature: any, status: DiffStatus) => void) | undefined;
  className?: string | undefined;
}

type DiffDisplayMode = "diff" | "side-by-side" | "swipe" | "revA" | "revB";

const Container = styled.div<{ $height?: number | string | undefined }>`
  position: relative;
  width: 100%;
  height: ${({ $height }) => (typeof $height === "number" ? `${$height}px` : $height || "640px")};
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  user-select: none;
`;

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--surface-hud, var(--color-canvas-subtle, rgba(22, 27, 34, 0.95)));
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  z-index: 10;
  gap: 12px;
`;

const ToolbarGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const StatsBar = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 16px;
  background: rgba(13, 17, 23, 0.85);
  border-bottom: 1px solid var(--color-border-muted, #21262d);
  font-size: 12px;
  color: var(--color-fg-muted, #8b949e);
  z-index: 9;
`;

const StatBadge = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  color: ${({ $color }) => $color};
`;

const CanvasViewport = styled.div`
  position: relative;
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
`;

const StyledCanvas = styled.canvas`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
`;

const TooltipOverlay = styled.div<{ $x: number; $y: number }>`
  position: absolute;
  top: ${({ $y }) => $y + 12}px;
  left: ${({ $x }) => $x + 12}px;
  background: rgba(22, 27, 34, 0.95);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--color-fg-default, #c9d1d9);
  font-size: 11px;
  line-height: 1.4;
  pointer-events: none;
  z-index: 20;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  max-width: 280px;
`;

const LegendContainer = styled.div`
  position: absolute;
  bottom: 16px;
  left: 16px;
  background: rgba(22, 27, 34, 0.85);
  backdrop-filter: blur(4px);
  border: 1px solid var(--color-border-muted, #30363d);
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  z-index: 10;
`;

const LegendRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-fg-subtle, #8b949e);
`;

const ColorDot = styled.span<{ $color: string }>`
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background-color: ${({ $color }) => $color};
`;

const SwipeHandle = styled.div<{ $left: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${({ $left }) => $left}%;
  width: 4px;
  background: #58a6ff;
  cursor: ew-resize;
  z-index: 15;
  box-shadow: 0 0 10px rgba(88, 166, 255, 0.8);

  &::after {
    content: "◀ ▶";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #58a6ff;
    color: #0d1117;
    font-size: 9px;
    font-weight: 700;
    padding: 2px 4px;
    border-radius: 4px;
    white-space: nowrap;
  }
`;

export function PcbLayerDiffViewer({
  revA,
  revB,
  height,
  onSelectFeature: _onSelectFeature,
  className,
}: PcbLayerDiffViewerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<DiffDisplayMode>("diff");
  const [selectedLayer, setSelectedLayer] = useState<string>("TopCopper");
  const [swipePosition, setSwipePosition] = useState<number>(50); // percentage 0-100
  const isDraggingSwipe = useRef<boolean>(false);

  // Pan & Zoom
  const [zoom, setZoom] = useState<number>(8); // pixels per mm
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const isPanning = useRef<boolean>(false);
  const startPan = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Hovered feature
  const [hoveredInfo, setHoveredInfo] = useState<{
    text: string;
    status: DiffStatus;
    screenX: number;
    screenY: number;
  } | null>(null);

  // Compute PCB diff
  const diffResult: PcbDiffResult = useMemo(() => {
    return computePcbDiff(revA, revB);
  }, [revA, revB]);

  // Compute board bounds
  const boardBounds = useMemo(() => {
    const pts = revB.boardOutline.length > 0 ? revB.boardOutline : revA.boardOutline;
    if (pts.length === 0) return { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    pts.forEach((p) => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });
    return { minX, maxX, minY, maxY };
  }, [revA.boardOutline, revB.boardOutline]);

  // Reset view to center board
  const handleResetView = useCallback(() => {
    if (!canvasRef.current) return;
    const { width, height } = canvasRef.current;
    const boardW = boardBounds.maxX - boardBounds.minX || 100;
    const boardH = boardBounds.maxY - boardBounds.minY || 100;
    const padding = 60;
    const zoomX = (width - padding * 2) / boardW;
    const zoomY = (height - padding * 2) / boardH;
    const fitZoom = Math.max(2, Math.min(30, Math.min(zoomX, zoomY)));

    setZoom(fitZoom);
    setPan({
      x: width / 2 - ((boardBounds.minX + boardBounds.maxX) / 2) * fitZoom,
      y: height / 2 - ((boardBounds.minY + boardBounds.maxY) / 2) * fitZoom,
    });
  }, [boardBounds]);

  useEffect(() => {
    handleResetView();
  }, [handleResetView]);

  // Available layers
  const availableLayers = useMemo(() => {
    const set = new Set<string>();
    revA.traces.forEach((t) => set.add(t.layer));
    revB.traces.forEach((t) => set.add(t.layer));
    revA.pads.forEach((p) => set.add(p.layer));
    revB.pads.forEach((p) => set.add(p.layer));
    if (set.size === 0) {
      set.add("TopCopper");
      set.add("BottomCopper");
    }
    return Array.from(set);
  }, [revA, revB]);

  // Render loop
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle high DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Dark grid background
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Board outline
    const boardOutline = revB.boardOutline.length > 0 ? revB.boardOutline : revA.boardOutline;
    if (boardOutline.length > 1) {
      ctx.beginPath();
      const p0 = boardOutline[0];
      ctx.moveTo(pan.x + p0.x * zoom, pan.y + p0.y * zoom);
      for (let i = 1; i < boardOutline.length; i++) {
        ctx.lineTo(pan.x + boardOutline[i].x * zoom, pan.y + boardOutline[i].y * zoom);
      }
      ctx.closePath();
      ctx.fillStyle = "#161b22";
      ctx.fill();
      ctx.strokeStyle = "#30363d";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Color definitions
    const COLOR_UNCHANGED = "rgba(110, 118, 129, 0.4)";
    const COLOR_ADDED = "#2ea043"; // Bright green
    const COLOR_REMOVED = "#da3633"; // Bright red
    const COLOR_MODIFIED = "#d29922"; // Amber

    const getFeatureColor = (status: DiffStatus): string => {
      switch (status) {
        case "added":
          return COLOR_ADDED;
        case "removed":
          return COLOR_REMOVED;
        case "modified":
          return COLOR_MODIFIED;
        default:
          return COLOR_UNCHANGED;
      }
    };

    const isLayerVisible = (layerName: string) => {
      return selectedLayer === "All" || layerName === selectedLayer;
    };

    // Draw traces
    const drawTrace = (feat: DiffFeature<any>) => {
      const trace = feat.feature;
      if (!isLayerVisible(trace.layer)) return;
      if (trace.points.length < 2) return;

      ctx.beginPath();
      ctx.strokeStyle = getFeatureColor(feat.status);
      ctx.lineWidth = Math.max(1, trace.width * zoom);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.moveTo(pan.x + trace.points[0].x * zoom, pan.y + trace.points[0].y * zoom);
      for (let i = 1; i < trace.points.length; i++) {
        ctx.lineTo(pan.x + trace.points[i].x * zoom, pan.y + trace.points[i].y * zoom);
      }
      ctx.stroke();
    };

    // Draw pads
    const drawPad = (feat: DiffFeature<any>) => {
      const pad = feat.feature;
      if (!isLayerVisible(pad.layer)) return;

      const px = pan.x + pad.center.x * zoom;
      const py = pan.y + pad.center.y * zoom;
      const pw = Math.max(2, pad.width * zoom);
      const ph = Math.max(2, pad.height * zoom);

      ctx.fillStyle = getFeatureColor(feat.status);

      if (pad.shape === "circle") {
        ctx.beginPath();
        ctx.arc(px, py, pw / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(px - pw / 2, py - ph / 2, pw, ph);
      }
    };

    // Draw vias
    const drawVia = (feat: DiffFeature<any>) => {
      const via = feat.feature;
      const vx = pan.x + via.center.x * zoom;
      const vy = pan.y + via.center.y * zoom;
      const r = Math.max(2, via.outerRadius * zoom);
      const drillR = Math.max(1, via.drillRadius * zoom);

      ctx.fillStyle = getFeatureColor(feat.status);
      ctx.beginPath();
      ctx.arc(vx, vy, r, 0, Math.PI * 2);
      ctx.fill();

      // Drill hole
      ctx.fillStyle = "#0d1117";
      ctx.beginPath();
      ctx.arc(vx, vy, drillR, 0, Math.PI * 2);
      ctx.fill();
    };

    if (mode === "diff") {
      // First unchanged, then modified, then added/removed on top
      diffResult.traces.filter((t) => t.status === "unchanged").forEach(drawTrace);
      diffResult.pads.filter((p) => p.status === "unchanged").forEach(drawPad);
      diffResult.vias.filter((v) => v.status === "unchanged").forEach(drawVia);

      diffResult.traces.filter((t) => t.status !== "unchanged").forEach(drawTrace);
      diffResult.pads.filter((p) => p.status !== "unchanged").forEach(drawPad);
      diffResult.vias.filter((v) => v.status !== "unchanged").forEach(drawVia);
    } else if (mode === "revA") {
      // Rev A only
      diffResult.traces.filter((t) => t.status !== "added").forEach((t) => drawTrace({ ...t, status: "unchanged" }));
      diffResult.pads.filter((p) => p.status !== "added").forEach((p) => drawPad({ ...p, status: "unchanged" }));
      diffResult.vias.filter((v) => v.status !== "added").forEach((v) => drawVia({ ...v, status: "unchanged" }));
    } else if (mode === "revB") {
      // Rev B only
      diffResult.traces.filter((t) => t.status !== "removed").forEach((t) => drawTrace({ ...t, status: "unchanged" }));
      diffResult.pads.filter((p) => p.status !== "removed").forEach((p) => drawPad({ ...p, status: "unchanged" }));
      diffResult.vias.filter((v) => v.status !== "removed").forEach((v) => drawVia({ ...v, status: "unchanged" }));
    } else if (mode === "swipe") {
      // Swipe: Rev A on left half, Rev B on right half
      const splitX = (rect.width * swipePosition) / 100;

      // Draw Rev A on left
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX, rect.height);
      ctx.clip();
      diffResult.traces.filter((t) => t.status !== "added").forEach((t) => drawTrace({ ...t, status: "removed" }));
      diffResult.pads.filter((p) => p.status !== "added").forEach((p) => drawPad({ ...p, status: "removed" }));
      diffResult.vias.filter((v) => v.status !== "added").forEach((v) => drawVia({ ...v, status: "removed" }));
      ctx.restore();

      // Draw Rev B on right
      ctx.save();
      ctx.beginPath();
      ctx.rect(splitX, 0, rect.width - splitX, rect.height);
      ctx.clip();
      diffResult.traces.filter((t) => t.status !== "removed").forEach((t) => drawTrace({ ...t, status: "added" }));
      diffResult.pads.filter((p) => p.status !== "removed").forEach((p) => drawPad({ ...p, status: "added" }));
      diffResult.vias.filter((v) => v.status !== "removed").forEach((v) => drawVia({ ...v, status: "added" }));
      ctx.restore();
    }

    ctx.restore();
  }, [pan, zoom, mode, selectedLayer, swipePosition, diffResult, revA, revB]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Pan interaction
  const handleMouseDown = (e: React.MouseEvent) => {
    isPanning.current = true;
    startPan.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDraggingSwipe.current && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const pos = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      setSwipePosition(pos);
      return;
    }

    if (isPanning.current) {
      setPan({
        x: e.clientX - startPan.current.x,
        y: e.clientY - startPan.current.y,
      });
      return;
    }

    // Hit test for tooltip
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const boardX = (mouseX - pan.x) / zoom;
      const boardY = (mouseY - pan.y) / zoom;

      // Find closest pad or trace within 2mm
      let found: { text: string; status: DiffStatus } | null = null;

      for (const p of diffResult.pads) {
        const dx = p.feature.center.x - boardX;
        const dy = p.feature.center.y - boardY;
        if (Math.hypot(dx, dy) < Math.max(p.feature.width, p.feature.height) / 2 + 0.5) {
          found = {
            text: `Pad: ${p.feature.component}.${p.feature.pinName}\nNet: ${p.feature.netId}\nStatus: ${p.status.toUpperCase()}${p.changeSummary ? `\n${p.changeSummary}` : ""}`,
            status: p.status,
          };
          break;
        }
      }

      if (!found) {
        for (const t of diffResult.traces) {
          if (t.feature.points.length >= 2) {
            const p0 = t.feature.points[0];
            const p1 = t.feature.points[1];
            const dist = Math.hypot((p0.x + p1.x) / 2 - boardX, (p0.y + p1.y) / 2 - boardY);
            if (dist < t.feature.width / 2 + 1.0) {
              found = {
                text: `Trace: Net ${t.feature.netId}\nLayer: ${t.feature.layer} (${t.feature.width}mm)\nStatus: ${t.status.toUpperCase()}${t.changeSummary ? `\n${t.changeSummary}` : ""}`,
                status: t.status,
              };
              break;
            }
          }
        }
      }

      if (found) {
        setHoveredInfo({
          ...found,
          screenX: mouseX,
          screenY: mouseY,
        });
      } else {
        setHoveredInfo(null);
      }
    }
  };

  const handleMouseUp = () => {
    isPanning.current = false;
    isDraggingSwipe.current = false;
  };

  // Zoom on wheel
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    const newZoom = Math.max(1, Math.min(80, zoom * factor));

    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setPan({
        x: mouseX - (mouseX - pan.x) * (newZoom / zoom),
        y: mouseY - (mouseY - pan.y) * (newZoom / zoom),
      });
      setZoom(newZoom);
    }
  };

  return (
    <Container ref={containerRef} $height={height} className={className}>
      <Toolbar>
        <ToolbarGroup>
          <DiffIcon size={16} />
          <Text sx={{ fontWeight: 600, fontSize: 13 }}>
            PCB Revision Diff: {revA.revision} → {revB.revision}
          </Text>
        </ToolbarGroup>

        <ToolbarGroup>
          <SegmentedControl aria-label="Diff Mode">
            <SegmentedControl.Button selected={mode === "diff"} onClick={() => setMode("diff")}>
              Overlay
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={mode === "swipe"} onClick={() => setMode("swipe")}>
              Swipe
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={mode === "revA"} onClick={() => setMode("revA")}>
              Rev A
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={mode === "revB"} onClick={() => setMode("revB")}>
              Rev B
            </SegmentedControl.Button>
          </SegmentedControl>

          <select
            value={selectedLayer}
            onChange={(e) => setSelectedLayer(e.target.value)}
            style={{
              padding: "4px 8px",
              background: "var(--color-canvas-default, #161b22)",
              color: "var(--color-fg-default, #c9d1d9)",
              border: "1px solid var(--color-border-default, #30363d)",
              borderRadius: "4px",
              fontSize: "12px",
            }}
          >
            <option value="All">All Layers</option>
            {availableLayers.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          <Button leadingVisual={ScreenFullIcon} size="small" onClick={handleResetView}>
            Reset View
          </Button>
        </ToolbarGroup>
      </Toolbar>

      <StatsBar>
        <StatBadge $color="#2ea043">
          <DiffAddedIcon size={12} /> +{diffResult.summary.addedTraces} Traces, +{diffResult.summary.addedPads} Pads, +
          {diffResult.summary.addedVias} Vias
        </StatBadge>
        <StatBadge $color="#da3633">
          <DiffRemovedIcon size={12} /> -{diffResult.summary.removedTraces} Traces, -{diffResult.summary.removedPads}{" "}
          Pads, -{diffResult.summary.removedVias} Vias
        </StatBadge>
        <StatBadge $color="#d29922">
          <DiffModifiedIcon size={12} /> {diffResult.summary.modifiedTraces} Modified
        </StatBadge>
        {diffResult.summary.netChanges.addedNets.length > 0 && (
          <span>Added Nets: {diffResult.summary.netChanges.addedNets.join(", ")}</span>
        )}
      </StatsBar>

      <CanvasViewport
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <StyledCanvas ref={canvasRef} />

        {mode === "swipe" && (
          <SwipeHandle
            $left={swipePosition}
            onMouseDown={(e) => {
              e.stopPropagation();
              isDraggingSwipe.current = true;
            }}
          />
        )}

        {hoveredInfo && (
          <TooltipOverlay $x={hoveredInfo.screenX} $y={hoveredInfo.screenY}>
            <pre style={{ margin: 0, fontFamily: "inherit", whiteSpace: "pre-wrap" }}>{hoveredInfo.text}</pre>
          </TooltipOverlay>
        )}

        <LegendContainer>
          <LegendRow>
            <ColorDot $color="#2ea043" /> Added in {revB.revision}
          </LegendRow>
          <LegendRow>
            <ColorDot $color="#da3633" /> Removed from {revA.revision}
          </LegendRow>
          <LegendRow>
            <ColorDot $color="#d29922" /> Modified geometry / net
          </LegendRow>
          <LegendRow>
            <ColorDot $color="#6e7681" /> Unchanged
          </LegendRow>
        </LegendContainer>
      </CanvasViewport>
    </Container>
  );
}
