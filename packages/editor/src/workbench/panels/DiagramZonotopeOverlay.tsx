// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 2D Diagram Zonotope Overlay (`DiagramZonotopeOverlay`).
 *
 * Non-invasive SVG + HTML popover layer synchronized with `Diagram.tsx` that renders:
 *   1. Translucent dashed `±ε_2d` layout-invariance envelopes around movable schematic blocks
 *      with `group_id = 0` topological connectivity invariant badges.
 *   2. Live perturbed translucent ghost silhouettes driven by `stressScale` & `xiByGroupId`,
 *      plus optional `↻ 90°` dashed rotation halos when `diagramAllowRotation` is enabled.
 *   3. Color-coded `FLOW_CONSERVATION` (`relTypeId === 4`) edge highlights with clickable
 *      `+1.0` / `-1.0` sign pills that flip conservation coupling signs or lock `group_id = 0`.
 *   4. Corner zonotope/gear pills & crimson fault badges opening the Block Parameter &
 *      Fault-Injection Popover (quick linear constraints + 5 fault-mode generators).
 *   5. Compact bottom-left HUD legend chip.
 */

import { useCallback, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import type { DiagramDataProp } from "../Diagram";
import type { AnsatzRelationalHypergraphRecord } from "../util/lsp-bridge";
import {
  buildDiagramZonotopeOverlayGeometry,
  type DiagramZonotopeEdgeFlow,
  type DiagramZonotopeNodeGhost,
} from "../util/zonotope-2d-geometry";
import {
  getGeneratorColor,
  parseLinearConstraintExpression,
  REL_TYPE_SHORT_LABELS,
  type FaultGeneratorSpec,
  type LinearConstraintSpec,
  type ZonotopePendingOverride,
  type ZonotopeWorkbenchState,
} from "../util/zonotope-workbench-state";

export interface DiagramZonotopeOverlayProps {
  diagramData: DiagramDataProp;
  hypergraphRecord?: AnsatzRelationalHypergraphRecord | null | undefined;
  workbenchState: ZonotopeWorkbenchState;
  colorMode?: "light" | "dark" | undefined;
  viewportTransform?: { x: number; y: number; scale: number } | undefined;
  onSelectGroup?: ((groupId: number | null) => void) | undefined;
  onAddOverride?: ((override: ZonotopePendingOverride) => void) | undefined;
  onAddConstraint?: ((constraint: LinearConstraintSpec) => void) | undefined;
  onToggleFaultGenerator?: ((spec: FaultGeneratorSpec) => void) | undefined;
}

const FAULT_MODE_OPTIONS: ReadonlyArray<{
  mode: FaultGeneratorSpec["faultMode"];
  label: string;
  short: string;
}> = [
  { mode: "open_circuit", label: "Open Circuit", short: "OPEN" },
  { mode: "short_circuit", label: "Short Circuit", short: "SHORT" },
  { mode: "stuck_valve", label: "Stuck Valve", short: "VALVE" },
  { mode: "sensor_bias", label: "Sensor Bias", short: "BIAS" },
  { mode: "actuator_saturation", label: "Actuator Saturation", short: "SAT" },
];

function lerpPoint(a: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function getEdgePortBadgePositions(points: Array<{ x: number; y: number }>): {
  sourcePos: { x: number; y: number } | null;
  targetPos: { x: number; y: number } | null;
  showPortPills: boolean;
} {
  if (points.length < 2) {
    return { sourcePos: null, targetPos: null, showPortPills: false };
  }
  const p0 = points[0]!;
  const p1 = points[1]!;
  const pLast = points[points.length - 1]!;
  const pPrev = points[points.length - 2]!;

  const totalSpan = Math.hypot(pLast.x - p0.x, pLast.y - p0.y);
  if (totalSpan < 44) {
    return { sourcePos: null, targetPos: null, showPortPills: false };
  }

  const firstLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const lastLen = Math.hypot(pLast.x - pPrev.x, pLast.y - pPrev.y);

  const srcT = firstLen > 1e-3 ? Math.min(0.32, Math.max(0.12, 18 / firstLen)) : 0.2;
  const tgtT = lastLen > 1e-3 ? Math.min(0.32, Math.max(0.12, 18 / lastLen)) : 0.2;

  return {
    sourcePos: lerpPoint(p0, p1, srcT),
    targetPos: lerpPoint(pLast, pPrev, tgtT),
    showPortPills: true,
  };
}

function formatSign(sign: 1 | -1): string {
  return sign > 0 ? "+1.0" : "-1.0";
}

export function DiagramZonotopeOverlay({
  diagramData,
  hypergraphRecord,
  workbenchState,
  colorMode = "dark",
  viewportTransform,
  onSelectGroup,
  onAddOverride,
  onAddConstraint,
  onToggleFaultGenerator,
}: DiagramZonotopeOverlayProps) {
  const isDark = colorMode === "dark";
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [constraintDraft, setConstraintDraft] = useState<string>("");
  const [constraintError, setConstraintError] = useState<string | null>(null);
  const [constraintAddedMsg, setConstraintAddedMsg] = useState<string | null>(null);

  const geometry = useMemo(
    () => buildDiagramZonotopeOverlayGeometry(diagramData, hypergraphRecord ?? null, workbenchState),
    [diagramData, hypergraphRecord, workbenchState],
  );

  const hasNonZeroXi = useMemo(
    () =>
      Object.values(workbenchState.xiByGroupId).some(
        (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) > 1e-6,
      ),
    [workbenchState.xiByGroupId],
  );

  const showGhosts = workbenchState.stressScale > 0 || hasNonZeroXi;
  const effectiveJitterPx = Math.max(
    0,
    Math.round(workbenchState.budgets.diagramLayoutJitterPx * workbenchState.stressScale * 10) / 10,
  );
  const activeFaultCount = useMemo(() => geometry.nodes.filter((n) => n.hasFaultGenerator).length, [geometry.nodes]);

  const selectedNode: DiagramZonotopeNodeGhost | null = useMemo(() => {
    if (!selectedNodeId) return null;
    return geometry.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [geometry.nodes, selectedNodeId]);

  const handleOpenNodePopover = useCallback(
    (node: DiagramZonotopeNodeGhost, e: MouseEvent) => {
      e.stopPropagation();
      setSelectedNodeId((prev) => {
        const next = prev === node.id ? null : node.id;
        if (next) {
          setConstraintDraft(`${node.name}.R >= 10`);
          setConstraintError(null);
          setConstraintAddedMsg(null);
        }
        return next;
      });
      onSelectGroup?.(node.groupId > 0 ? node.groupId : null);
    },
    [onSelectGroup],
  );

  const handleEdgePillClick = useCallback(
    (edge: DiagramZonotopeEdgeFlow, e: MouseEvent) => {
      e.stopPropagation();
      const brush = workbenchState.activeBrush;
      const overrideId = `wire:${edge.id}:${Date.now()}`;

      if (brush === "lock-zero") {
        onAddOverride?.({
          id: overrideId,
          symbolName: edge.id,
          textSnippet: `${edge.source}->${edge.target}`,
          groupId: 0,
          relTypeId: 0,
          relSign: 0,
          modality: "2d",
          note: `Locked wire ${edge.source}→${edge.target} to group_id = 0`,
        });
        onSelectGroup?.(0);
        return;
      }

      const targetGroup =
        edge.groupId > 0
          ? edge.groupId
          : workbenchState.activeGroupId && workbenchState.activeGroupId > 0
            ? workbenchState.activeGroupId
            : 1;

      let nextSign: 1 | -1;
      let note: string;
      if (brush === "couple-pos") {
        nextSign = 1;
        note = `Set FLOW_CONSERVATION (+1.0/-1.0) on ${edge.source}→${edge.target}`;
      } else if (brush === "couple-neg") {
        nextSign = -1;
        note = `Set inverse FLOW_CONSERVATION (-1.0/+1.0) on ${edge.source}→${edge.target}`;
      } else {
        nextSign = edge.sourceSign > 0 ? -1 : 1;
        note = `Flipped FLOW_CONSERVATION sign (${formatSign(nextSign)} / ${formatSign(nextSign > 0 ? -1 : 1)}) on ${edge.source}→${edge.target}`;
      }

      onAddOverride?.({
        id: overrideId,
        symbolName: edge.id,
        textSnippet: `${edge.source}->${edge.target}`,
        groupId: targetGroup,
        relTypeId: 4,
        relSign: nextSign,
        modality: "2d",
        note,
      });
      onSelectGroup?.(targetGroup);
    },
    [onAddOverride, onSelectGroup, workbenchState.activeBrush, workbenchState.activeGroupId],
  );

  const handleSubmitConstraint = useCallback(() => {
    if (!selectedNode) return;
    const parsed = parseLinearConstraintExpression(constraintDraft, "2d");
    if (!parsed) {
      setConstraintError("Enter a linear inequality like R1.R >= 10");
      setConstraintAddedMsg(null);
      return;
    }
    onAddConstraint?.(parsed);
    setConstraintError(null);
    setConstraintAddedMsg(`Added: ${parsed.expression}`);
  }, [constraintDraft, onAddConstraint, selectedNode]);

  const handleToggleFault = useCallback(
    (node: DiagramZonotopeNodeGhost, mode: FaultGeneratorSpec["faultMode"]) => {
      const existing = workbenchState.faultGenerators.find(
        (fg) => fg.faultMode === mode && (fg.componentName === node.name || fg.componentName === node.id),
      );
      const nextEnabled = !(existing?.enabled ?? false);
      onToggleFaultGenerator?.({
        id: existing?.id ?? `fault:${node.name}:${mode}`,
        componentName: node.name,
        faultMode: mode,
        severity: existing?.severity ?? 1.0,
        enabled: nextEnabled,
      });
    },
    [onToggleFaultGenerator, workbenchState.faultGenerators],
  );

  // Coordinate transform setup: live pan/zoom matrix when available, otherwise fit viewBox
  const scale = viewportTransform?.scale ?? 1;
  const invScale = 1 / Math.max(0.4, Math.min(2.2, scale));
  const fallbackPadding = 32;
  const vbWidth = Math.max(100, geometry.bounds.maxX - geometry.bounds.minX + fallbackPadding * 2);
  const vbHeight = Math.max(100, geometry.bounds.maxY - geometry.bounds.minY + fallbackPadding * 2);
  const fallbackViewBox = `${geometry.bounds.minX - fallbackPadding} ${geometry.bounds.minY - fallbackPadding} ${vbWidth} ${vbHeight}`;

  const surfaceBg = isDark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.94)";
  const surfaceBorder = isDark ? "rgba(148, 163, 184, 0.28)" : "rgba(15, 23, 42, 0.16)";
  const primaryText = isDark ? "#e2e8f0" : "#0f172a";
  const mutedText = isDark ? "#94a3b8" : "#475569";

  const rootStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    zIndex: 18,
    pointerEvents: "none",
    overflow: "hidden",
  };

  return (
    <div data-testid="diagram-zonotope-overlay" style={rootStyle}>
      <svg
        width="100%"
        height="100%"
        viewBox={viewportTransform ? undefined : fallbackViewBox}
        preserveAspectRatio={viewportTransform ? undefined : "xMidYMid meet"}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        <g
          transform={
            viewportTransform
              ? `translate(${viewportTransform.x}, ${viewportTransform.y}) scale(${viewportTransform.scale})`
              : undefined
          }
        >
          {/* 1. FLOW_CONSERVATION edge highlights & clickable +1.0 / -1.0 pills */}
          {geometry.edges.map((edge) => {
            if (edge.points.length < 2) return null;
            const swatch = getGeneratorColor(edge.groupId);
            const isActive =
              workbenchState.activeGroupId != null &&
              workbenchState.activeGroupId > 0 &&
              workbenchState.activeGroupId === edge.groupId;
            const pointsAttr = edge.points.map((p) => `${p.x},${p.y}`).join(" ");
            const strokeColor = edge.isLocked
              ? isDark
                ? "rgba(148, 163, 184, 0.65)"
                : "rgba(100, 116, 139, 0.7)"
              : swatch.solid;
            const { sourcePos, targetPos, showPortPills } = getEdgePortBadgePositions(edge.points);
            const relShort = REL_TYPE_SHORT_LABELS[edge.relTypeId] ?? "FLOW ±1";

            return (
              <g key={edge.id} data-testid={`zonotope-edge-${edge.id}`}>
                <polyline
                  points={pointsAttr}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={isActive ? 4.5 : 3}
                  strokeOpacity={edge.isLocked ? 0.55 : isActive ? 0.9 : 0.65}
                  strokeDasharray={edge.isLocked ? "4 3" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />

                {/* Source port sign pill (+1.0 / -1.0) */}
                {showPortPills && sourcePos && (
                  <g
                    transform={`translate(${sourcePos.x}, ${sourcePos.y}) scale(${invScale})`}
                    style={{ pointerEvents: "auto", cursor: "pointer" }}
                    onClick={(e) => handleEdgePillClick(edge, e)}
                  >
                    <title>
                      {`FLOW_CONSERVATION (${edge.source} → ${edge.target}) · Click to flip coupling sign or apply active brush`}
                    </title>
                    <rect
                      x={-16}
                      y={-8}
                      width={32}
                      height={16}
                      rx={8}
                      fill={
                        edge.isLocked
                          ? isDark
                            ? "rgba(30, 41, 59, 0.92)"
                            : "rgba(241, 245, 249, 0.95)"
                          : edge.sourceSign > 0
                            ? "rgba(16, 185, 129, 0.9)"
                            : "rgba(244, 63, 94, 0.9)"
                      }
                      stroke={strokeColor}
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={700}
                      fontFamily="'SF Mono', 'Cascadia Code', monospace"
                      fill={edge.isLocked ? mutedText : "#ffffff"}
                    >
                      {formatSign(edge.sourceSign)}
                    </text>
                  </g>
                )}

                {/* Target port sign pill (-1.0 / +1.0) */}
                {showPortPills && targetPos && (
                  <g
                    transform={`translate(${targetPos.x}, ${targetPos.y}) scale(${invScale})`}
                    style={{ pointerEvents: "auto", cursor: "pointer" }}
                    onClick={(e) => handleEdgePillClick(edge, e)}
                  >
                    <title>
                      {`FLOW_CONSERVATION (${edge.source} → ${edge.target}) · Click to flip coupling sign or apply active brush`}
                    </title>
                    <rect
                      x={-16}
                      y={-8}
                      width={32}
                      height={16}
                      rx={8}
                      fill={
                        edge.isLocked
                          ? isDark
                            ? "rgba(30, 41, 59, 0.92)"
                            : "rgba(241, 245, 249, 0.95)"
                          : edge.targetSign > 0
                            ? "rgba(16, 185, 129, 0.9)"
                            : "rgba(244, 63, 94, 0.9)"
                      }
                      stroke={strokeColor}
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={700}
                      fontFamily="'SF Mono', 'Cascadia Code', monospace"
                      fill={edge.isLocked ? mutedText : "#ffffff"}
                    >
                      {formatSign(edge.targetSign)}
                    </text>
                  </g>
                )}

                {/* Midpoint conservation pill */}
                <g
                  data-testid={`zonotope-edge-pill-${edge.id}`}
                  transform={`translate(${edge.midpoint.x}, ${edge.midpoint.y}) scale(${invScale})`}
                  style={{ pointerEvents: "auto", cursor: "pointer" }}
                  onClick={(e) => handleEdgePillClick(edge, e)}
                >
                  <title>
                    {edge.isLocked
                      ? `Locked wire (${edge.source} → ${edge.target}, group_id = 0). Click to flip or paint.`
                      : `${relShort} ε_${edge.groupId} (${formatSign(edge.sourceSign)} / ${formatSign(edge.targetSign)}). Click to flip sign.`}
                  </title>
                  <rect
                    x={-28}
                    y={-9}
                    width={56}
                    height={18}
                    rx={9}
                    fill={isDark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.95)"}
                    stroke={strokeColor}
                    strokeWidth={isActive ? 1.8 : 1.1}
                  />
                  <text
                    x={0}
                    y={3.5}
                    textAnchor="middle"
                    fontSize={8.5}
                    fontWeight={700}
                    fontFamily="'SF Mono', 'Cascadia Code', monospace"
                    fill={edge.isLocked ? mutedText : swatch.solid}
                  >
                    {edge.isLocked
                      ? "LOCK g0"
                      : `${edge.sourceSign > 0 ? "+1" : "-1"}/${edge.targetSign > 0 ? "+1" : "-1"}`}
                  </text>
                </g>
              </g>
            );
          })}

          {/* 2. Node ±ε_2d layout-invariance envelopes, rotation halos, ghosts & corner handles */}
          {geometry.nodes.map((node) => {
            const swatch = getGeneratorColor(node.groupId);
            const isActiveGroup =
              workbenchState.activeGroupId != null &&
              workbenchState.activeGroupId > 0 &&
              workbenchState.activeGroupId === node.groupId;
            const isSelected = selectedNodeId === node.id;
            const centerX = node.x + node.width * 0.5;
            const centerY = node.y + node.height * 0.5;
            const ghostCenterX = node.perturbedX + node.width * 0.5;
            const ghostCenterY = node.perturbedY + node.height * 0.5;
            const envelopeStroke = node.hasFaultGenerator ? "#f43f5e" : node.groupId > 0 ? swatch.solid : "#38bdf8";
            const envelopeFill = node.hasFaultGenerator
              ? "rgba(244, 63, 94, 0.1)"
              : node.groupId > 0
                ? swatch.bg
                : "rgba(56, 189, 248, 0.08)";

            return (
              <g key={node.id} data-testid={`zonotope-node-${node.id}`}>
                {/* Layout-invariance dashed bounding envelope (±ε_2d) */}
                <rect
                  x={node.envelopeX}
                  y={node.envelopeY}
                  width={node.envelopeWidth}
                  height={node.envelopeHeight}
                  rx={6}
                  fill={envelopeFill}
                  stroke={envelopeStroke}
                  strokeWidth={isActiveGroup || isSelected ? 2 : 1.25}
                  strokeDasharray="5 3"
                  vectorEffect="non-scaling-stroke"
                />

                {/* 90° rotation halo when diagramAllowRotation is enabled */}
                {workbenchState.budgets.diagramAllowRotation && node.rotationHaloRadius > 0 && (
                  <g>
                    <circle
                      cx={centerX}
                      cy={centerY}
                      r={node.rotationHaloRadius}
                      fill="none"
                      stroke={envelopeStroke}
                      strokeOpacity={0.55}
                      strokeWidth={1.1}
                      strokeDasharray="3 4"
                      vectorEffect="non-scaling-stroke"
                    />
                    <g transform={`translate(${centerX}, ${centerY - node.rotationHaloRadius - 6}) scale(${invScale})`}>
                      <rect
                        x={-17}
                        y={-7}
                        width={34}
                        height={14}
                        rx={7}
                        fill={isDark ? "rgba(15, 23, 42, 0.88)" : "rgba(255, 255, 255, 0.92)"}
                        stroke={envelopeStroke}
                        strokeWidth={0.9}
                      />
                      <text
                        x={0}
                        y={3}
                        textAnchor="middle"
                        fontSize={8.5}
                        fontWeight={700}
                        fontFamily="'SF Mono', 'Cascadia Code', monospace"
                        fill={envelopeStroke}
                      >
                        ↻ 90°
                      </text>
                    </g>
                  </g>
                )}

                {/* Live perturbed translucent ghost silhouette */}
                {showGhosts && (
                  <g>
                    <line
                      x1={centerX}
                      y1={centerY}
                      x2={ghostCenterX}
                      y2={ghostCenterY}
                      stroke={envelopeStroke}
                      strokeOpacity={0.55}
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      vectorEffect="non-scaling-stroke"
                    />
                    <g
                      transform={
                        node.perturbedRotationDeg !== 0
                          ? `translate(${node.perturbedX}, ${node.perturbedY}) rotate(${node.perturbedRotationDeg}, ${node.width * 0.5}, ${node.height * 0.5})`
                          : `translate(${node.perturbedX}, ${node.perturbedY})`
                      }
                    >
                      <rect
                        x={0}
                        y={0}
                        width={node.width}
                        height={node.height}
                        rx={4}
                        fill={envelopeStroke}
                        fillOpacity={0.14}
                        stroke={envelopeStroke}
                        strokeOpacity={0.72}
                        strokeWidth={1.25}
                        strokeDasharray="3 2"
                        vectorEffect="non-scaling-stroke"
                      />
                      <line
                        x1={node.width * 0.5 - 4}
                        y1={node.height * 0.5}
                        x2={node.width * 0.5 + 4}
                        y2={node.height * 0.5}
                        stroke={envelopeStroke}
                        strokeOpacity={0.6}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                      <line
                        x1={node.width * 0.5}
                        y1={node.height * 0.5 - 4}
                        x2={node.width * 0.5}
                        y2={node.height * 0.5 + 4}
                        stroke={envelopeStroke}
                        strokeOpacity={0.6}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  </g>
                )}

                {/* Top-left topological invariant / generator group badge */}
                <g
                  transform={`translate(${node.envelopeX + 2}, ${node.envelopeY - 2}) scale(${invScale})`}
                  style={{ pointerEvents: "auto", cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectGroup?.(node.groupId > 0 ? node.groupId : 0);
                  }}
                >
                  <title>
                    {node.groupId === 0
                      ? `${node.name}: group_id = 0 topological connectivity invariant (±${effectiveJitterPx}px layout envelope)`
                      : `${node.name}: Generator ε_${node.groupId} (±${effectiveJitterPx}px layout envelope)`}
                  </title>
                  <rect
                    x={0}
                    y={-12}
                    width={node.groupId === 0 ? 46 : 30}
                    height={14}
                    rx={4}
                    fill={isDark ? "rgba(15, 23, 42, 0.9)" : "rgba(255, 255, 255, 0.94)"}
                    stroke={envelopeStroke}
                    strokeWidth={0.9}
                  />
                  <text
                    x={node.groupId === 0 ? 23 : 15}
                    y={-2.5}
                    textAnchor="middle"
                    fontSize={8.5}
                    fontWeight={700}
                    fontFamily="'SF Mono', 'Cascadia Code', monospace"
                    fill={envelopeStroke}
                  >
                    {node.groupId === 0 ? "g0 INV" : `ε_${node.groupId}`}
                  </text>
                </g>

                {/* Top-right interactive gear/zonotope pill + crimson fault badge */}
                <g
                  data-testid={`zonotope-node-handle-${node.id}`}
                  transform={`translate(${node.envelopeX + node.envelopeWidth - 2}, ${node.envelopeY - 2}) scale(${invScale})`}
                  style={{ pointerEvents: "auto", cursor: "pointer" }}
                  onClick={(e) => handleOpenNodePopover(node, e)}
                >
                  <title>{`Configure ${node.name} parameter constraints & fault-mode generators`}</title>
                  <rect
                    x={node.hasFaultGenerator ? -38 : -20}
                    y={-13}
                    width={node.hasFaultGenerator ? 38 : 20}
                    height={16}
                    rx={8}
                    fill={
                      node.hasFaultGenerator
                        ? "rgba(225, 29, 72, 0.94)"
                        : isSelected
                          ? envelopeStroke
                          : isDark
                            ? "rgba(15, 23, 42, 0.92)"
                            : "rgba(255, 255, 255, 0.95)"
                    }
                    stroke={node.hasFaultGenerator ? "#fda4af" : envelopeStroke}
                    strokeWidth={1.1}
                  />
                  <text
                    x={node.hasFaultGenerator ? -19 : -10}
                    y={-2}
                    textAnchor="middle"
                    fontSize={9.5}
                    fontWeight={700}
                    fontFamily="'SF Mono', 'Cascadia Code', monospace"
                    fill={node.hasFaultGenerator || isSelected ? "#ffffff" : isDark ? "#e2e8f0" : "#0f172a"}
                  >
                    {node.hasFaultGenerator ? "⚡ ⚙" : "⚙"}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Block Parameter & Fault-Injection Popover */}
      {selectedNode && (
        <div
          data-testid="diagram-zonotope-node-popover"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 288,
            maxWidth: "calc(100% - 28px)",
            zIndex: 30,
            pointerEvents: "auto",
            borderRadius: 10,
            padding: "10px 12px",
            backgroundColor: surfaceBg,
            color: primaryText,
            border: `1px solid ${selectedNode.hasFaultGenerator ? "rgba(244, 63, 94, 0.7)" : surfaceBorder}`,
            boxShadow: "0 12px 30px rgba(0, 0, 0, 0.34)",
            backdropFilter: "blur(10px)",
            fontSize: 11,
            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          }}
        >
          {/* Popover Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 12,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {selectedNode.name}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: "'SF Mono', 'Cascadia Code', monospace",
                  padding: "1px 6px",
                  borderRadius: 999,
                  backgroundColor: getGeneratorColor(selectedNode.groupId).bg,
                  border: `1px solid ${getGeneratorColor(selectedNode.groupId).border}`,
                  color: getGeneratorColor(selectedNode.groupId).solid,
                }}
              >
                {selectedNode.groupId === 0 ? "g0 · INV" : `ε_${selectedNode.groupId}`}
              </span>
            </div>
            <button
              type="button"
              aria-label="Close block zonotope popover"
              onClick={() => setSelectedNodeId(null)}
              style={{
                cursor: "pointer",
                border: "none",
                background: "transparent",
                color: mutedText,
                fontSize: 15,
                lineHeight: 1,
                padding: "0 4px",
              }}
            >
              ×
            </button>
          </div>

          {/* Tolerance Budget Preview */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              marginBottom: 10,
              padding: "6px 8px",
              borderRadius: 6,
              backgroundColor: isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(241, 245, 249, 0.9)",
              fontFamily: "'SF Mono', 'Cascadia Code', monospace",
              fontSize: 10,
            }}
          >
            <div>
              <div style={{ color: mutedText, fontSize: 9 }}>Physics ±ε_phys</div>
              <div style={{ fontWeight: 700, color: "#38bdf8" }}>
                ±{(workbenchState.budgets.physicsParamFraction * 100 * workbenchState.stressScale).toFixed(1)}%
              </div>
            </div>
            <div>
              <div style={{ color: mutedText, fontSize: 9 }}>Layout ±ε_2d</div>
              <div style={{ fontWeight: 700, color: "#34d399" }}>
                ±{effectiveJitterPx}px{workbenchState.budgets.diagramAllowRotation ? " · ↻90°" : ""}
              </div>
            </div>
          </div>

          {/* Quick Linear Constraint Input */}
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: mutedText,
                marginBottom: 4,
              }}
            >
              Quick Linear Constraint
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <input
                type="text"
                data-testid="diagram-zonotope-constraint-input"
                value={constraintDraft}
                onChange={(e) => {
                  setConstraintDraft(e.target.value);
                  setConstraintError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmitConstraint();
                  }
                }}
                placeholder={`${selectedNode.name}.R >= 10`}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "4px 7px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: "'SF Mono', 'Cascadia Code', monospace",
                  backgroundColor: isDark ? "rgba(15, 23, 42, 0.85)" : "#ffffff",
                  color: primaryText,
                  border: `1px solid ${constraintError ? "#f43f5e" : surfaceBorder}`,
                  outline: "none",
                }}
              />
              <button
                type="button"
                data-testid="diagram-zonotope-constraint-add"
                onClick={handleSubmitConstraint}
                style={{
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  border: "1px solid rgba(56, 189, 248, 0.55)",
                  backgroundColor: "rgba(56, 189, 248, 0.16)",
                  color: "#38bdf8",
                  whiteSpace: "nowrap",
                }}
              >
                + Add
              </button>
            </div>
            {constraintError && <div style={{ color: "#fb7185", fontSize: 10, marginTop: 3 }}>{constraintError}</div>}
            {constraintAddedMsg && (
              <div style={{ color: "#34d399", fontSize: 10, marginTop: 3 }}>{constraintAddedMsg}</div>
            )}
          </div>

          {/* Fault-Mode Generators */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 10,
                fontWeight: 600,
                color: mutedText,
                marginBottom: 5,
              }}
            >
              <span>Fault-Mode Generators</span>
              {selectedNode.hasFaultGenerator && <span style={{ color: "#fb7185", fontWeight: 700 }}>⚡ Active</span>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {FAULT_MODE_OPTIONS.map((opt) => {
                const isEnabled = workbenchState.faultGenerators.some(
                  (fg) =>
                    fg.enabled &&
                    fg.faultMode === opt.mode &&
                    (fg.componentName === selectedNode.name || fg.componentName === selectedNode.id),
                );
                return (
                  <button
                    key={opt.mode}
                    type="button"
                    data-testid={`diagram-zonotope-fault-${opt.mode}`}
                    onClick={() => handleToggleFault(selectedNode, opt.mode)}
                    style={{
                      cursor: "pointer",
                      padding: "3px 7px",
                      borderRadius: 6,
                      fontSize: 10,
                      fontWeight: 600,
                      border: isEnabled ? "1px solid rgba(244, 63, 94, 0.85)" : `1px solid ${surfaceBorder}`,
                      backgroundColor: isEnabled
                        ? "rgba(225, 29, 72, 0.24)"
                        : isDark
                          ? "rgba(30, 41, 59, 0.65)"
                          : "rgba(241, 245, 249, 0.9)",
                      color: isEnabled ? "#fda4af" : primaryText,
                    }}
                  >
                    {isEnabled ? `⚡ ${opt.label}` : opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Compact Bottom-Left HUD Legend Chip */}
      <div
        data-testid="diagram-zonotope-hud"
        style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          zIndex: 20,
          pointerEvents: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 10px",
          borderRadius: 999,
          fontSize: 10.5,
          fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
          backgroundColor: surfaceBg,
          color: primaryText,
          border: `1px solid ${surfaceBorder}`,
          boxShadow: "0 4px 14px rgba(0, 0, 0, 0.22)",
          backdropFilter: "blur(8px)",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            backgroundColor: activeFaultCount > 0 ? "#f43f5e" : "#38bdf8",
            flexShrink: 0,
          }}
        />
        <span>
          2D Zonotope: ±{effectiveJitterPx}px · {geometry.nodes.length} ghosts · {geometry.edges.length} flow wires
          {workbenchState.budgets.diagramAllowRotation ? " · ↻90°" : ""}
          {activeFaultCount > 0 ? ` · ⚡${activeFaultCount}` : ""}
        </span>
      </div>
    </div>
  );
}

export default DiagramZonotopeOverlay;
