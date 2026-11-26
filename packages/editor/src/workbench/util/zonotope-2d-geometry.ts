// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure TypeScript 2D Diagram Zonotope geometry & conservation-law topology builder.
 *
 * Computes layout-invariance spatial envelopes (`±ε_2d * stressScale`), deterministic
 * perturbed ghost silhouettes driven by `xiByGroupId`, 90° rotation halos, fault-mode
 * markers, and `FLOW_CONSERVATION` (`relTypeId === 4`) edge flow sign overlays.
 *
 * Intentionally free of React, DOM, `monaco-editor`, and `@modelscript/runtime` imports
 * so it can execute cleanly in both browser bundles and Node unit tests.
 */

import type {
  FaultGeneratorSpec,
  ZonotopePendingOverride,
  ZonotopeWorkbenchState,
} from "./zonotope-workbench-state.js";

// ---------------------------------------------------------------------------
// Output geometry types
// ---------------------------------------------------------------------------

export interface DiagramZonotopeNodeGhost {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Expanded layout-invariance envelope bounds [x - jitter, y - jitter, w + 2*jitter, h + 2*jitter] */
  envelopeX: number;
  envelopeY: number;
  envelopeWidth: number;
  envelopeHeight: number;
  /** Live perturbed ghost offset driven by stressScale & xi_k */
  perturbedX: number;
  perturbedY: number;
  perturbedRotationDeg: number;
  rotationHaloRadius: number;
  groupId: number;
  hasFaultGenerator: boolean;
  faultMode?: string | undefined;
}

export interface DiagramZonotopeEdgeFlow {
  id: string;
  source: string;
  target: string;
  groupId: number;
  relTypeId: number;
  sourceSign: 1 | -1;
  targetSign: 1 | -1;
  points: Array<{ x: number; y: number }>;
  midpoint: { x: number; y: number };
  isLocked: boolean;
}

export interface DiagramZonotopeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DiagramZonotopeOverlayGeometry {
  nodes: DiagramZonotopeNodeGhost[];
  edges: DiagramZonotopeEdgeFlow[];
  bounds: DiagramZonotopeBounds;
}

// ---------------------------------------------------------------------------
// Lightweight structural input types compatible with @modelscript/diagram/protocol
// ---------------------------------------------------------------------------

export interface DiagramZonotopeHypergraphSpan {
  groupId: number;
  relTypeId: number;
  relSign: number;
  symbolName?: string | undefined;
  text: string;
}

export interface DiagramZonotopeHypergraphInput {
  spans: DiagramZonotopeHypergraphSpan[];
}

export interface DiagramPointLike {
  x: number;
  y: number;
}

export interface DiagramPortLike {
  id: string;
  args?: { x?: number | undefined; y?: number | undefined; angle?: number | undefined } | undefined;
}

export interface DiagramNodeLike {
  id?: string | undefined;
  name?: string | undefined;
  shape?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  angle?: number | undefined;
  rotation?: number | undefined;
  position?: { x?: number | undefined; y?: number | undefined } | undefined;
  size?: { width?: number | undefined; height?: number | undefined } | undefined;
  properties?: { name?: string | undefined; className?: string | undefined } | undefined;
  attrs?:
    | {
        label?: { text?: string | undefined } | undefined;
        text?: { text?: string | undefined } | undefined;
      }
    | undefined;
  data?: Record<string, unknown> | undefined;
  ports?: { items?: DiagramPortLike[] | undefined } | DiagramPortLike[] | undefined;
}

export interface DiagramEdgeEndpointLike {
  cell?: string | undefined;
  port?: string | undefined;
}

export interface DiagramEdgeLike {
  id?: string | undefined;
  source?: string | DiagramEdgeEndpointLike | undefined;
  target?: string | DiagramEdgeEndpointLike | undefined;
  from?: string | DiagramEdgeEndpointLike | undefined;
  to?: string | DiagramEdgeEndpointLike | undefined;
  vertices?: DiagramPointLike[] | undefined;
  points?: DiagramPointLike[] | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface DiagramCoordinateSystemLike {
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

export interface DiagramDataLike {
  nodes?: DiagramNodeLike[] | undefined;
  components?: DiagramNodeLike[] | undefined;
  edges?: DiagramEdgeLike[] | undefined;
  connections?: DiagramEdgeLike[] | undefined;
  coordinateSystem?: DiagramCoordinateSystemLike | null | undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const GOLDEN_ANGLE_RAD = 2.399963229728653; // ~137.507764°
const FLOW_CONSERVATION_REL_TYPE = 4;
const DEFAULT_NODE_WIDTH = 60;
const DEFAULT_NODE_HEIGHT = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isSyntheticBackgroundNode(id: string, shape: string | undefined): boolean {
  if (shape === "diagram-background" || shape === "coordinate-frame" || shape === "placement-ghost") {
    return true;
  }
  return (
    id.startsWith("__diagram_") ||
    id.startsWith("__coord_") ||
    id.startsWith("__placement_") ||
    id.startsWith("__ephemeral_")
  );
}

interface ParsedNode {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  ports: Map<string, { x: number; y: number }>;
}

function extractNodePorts(raw: Record<string, unknown>): Map<string, { x: number; y: number }> {
  const portMap = new Map<string, { x: number; y: number }>();
  const rawPorts = raw["ports"];
  const items: unknown[] = Array.isArray(rawPorts)
    ? rawPorts
    : isRecord(rawPorts) && Array.isArray(rawPorts["items"])
      ? (rawPorts["items"] as unknown[])
      : [];

  for (const item of items) {
    if (!isRecord(item)) continue;
    const portId = asNonEmptyString(item["id"]);
    if (!portId) continue;
    const args = isRecord(item["args"]) ? item["args"] : undefined;
    const px = args ? args["x"] : item["x"];
    const py = args ? args["y"] : item["y"];
    if (typeof px === "number" && Number.isFinite(px) && typeof py === "number" && Number.isFinite(py)) {
      portMap.set(portId, { x: px, y: py });
    }
  }
  return portMap;
}

function parseRawNodes(data: Record<string, unknown>): ParsedNode[] {
  const rawList = Array.isArray(data["nodes"])
    ? (data["nodes"] as unknown[])
    : Array.isArray(data["components"])
      ? (data["components"] as unknown[])
      : [];

  const parsed: ParsedNode[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!isRecord(item)) continue;

    const propsObj = isRecord(item["properties"]) ? item["properties"] : undefined;
    const dataObj = isRecord(item["data"]) ? item["data"] : undefined;
    const attrsObj = isRecord(item["attrs"]) ? item["attrs"] : undefined;
    const labelObj = attrsObj && isRecord(attrsObj["label"]) ? attrsObj["label"] : undefined;
    const textObj = attrsObj && isRecord(attrsObj["text"]) ? attrsObj["text"] : undefined;
    const posObj = isRecord(item["position"]) ? item["position"] : undefined;
    const sizeObj = isRecord(item["size"]) ? item["size"] : undefined;

    const shape = asNonEmptyString(item["shape"]);
    const id =
      asNonEmptyString(item["id"]) ??
      asNonEmptyString(propsObj?.["name"]) ??
      asNonEmptyString(item["name"]) ??
      `node_${i}`;

    if (isSyntheticBackgroundNode(id, shape)) continue;

    const name =
      asNonEmptyString(propsObj?.["name"]) ??
      asNonEmptyString(dataObj?.["name"]) ??
      asNonEmptyString(item["name"]) ??
      asNonEmptyString(labelObj?.["text"]) ??
      asNonEmptyString(textObj?.["text"]) ??
      id;

    const x = asFiniteNumber(item["x"], asFiniteNumber(posObj?.["x"], 0));
    const y = asFiniteNumber(item["y"], asFiniteNumber(posObj?.["y"], 0));
    const rawW = asFiniteNumber(item["width"], asFiniteNumber(sizeObj?.["width"], DEFAULT_NODE_WIDTH));
    const rawH = asFiniteNumber(item["height"], asFiniteNumber(sizeObj?.["height"], DEFAULT_NODE_HEIGHT));
    const width = rawW > 0 ? rawW : DEFAULT_NODE_WIDTH;
    const height = rawH > 0 ? rawH : DEFAULT_NODE_HEIGHT;
    const angle = asFiniteNumber(item["angle"], asFiniteNumber(item["rotation"], 0));

    parsed.push({
      id,
      name,
      x,
      y,
      width,
      height,
      angle,
      ports: extractNodePorts(item),
    });
  }

  return parsed;
}

interface ParsedEndpoint {
  cell: string;
  port?: string | undefined;
}

function parseEndpoint(rawEndpoint: unknown): ParsedEndpoint | null {
  if (typeof rawEndpoint === "string") {
    const trimmed = rawEndpoint.trim();
    if (!trimmed) return null;
    const dotIdx = trimmed.indexOf(".");
    if (dotIdx > 0 && dotIdx < trimmed.length - 1) {
      return {
        cell: trimmed.slice(0, dotIdx),
        port: trimmed.slice(dotIdx + 1),
      };
    }
    return { cell: trimmed };
  }
  if (isRecord(rawEndpoint)) {
    const cell =
      asNonEmptyString(rawEndpoint["cell"]) ??
      asNonEmptyString(rawEndpoint["node"]) ??
      asNonEmptyString(rawEndpoint["id"]);
    if (!cell) return null;
    const port = asNonEmptyString(rawEndpoint["port"]);
    return port !== undefined ? { cell, port } : { cell };
  }
  return null;
}

function clonePoints(rawPoints: unknown): Array<{ x: number; y: number }> {
  if (!Array.isArray(rawPoints)) return [];
  const pts: Array<{ x: number; y: number }> = [];
  for (const pt of rawPoints) {
    if (!isRecord(pt)) continue;
    const x = pt["x"];
    const y = pt["y"];
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
      pts.push({ x, y });
    }
  }
  return pts;
}

function resolveEndpointPoint(
  ep: ParsedEndpoint | null,
  nodeByIdOrName: Map<string, ParsedNode>,
): { x: number; y: number } | null {
  if (!ep) return null;
  const node = nodeByIdOrName.get(ep.cell);
  if (!node) return null;
  if (ep.port) {
    const portOffset = node.ports.get(ep.port);
    if (portOffset) {
      return { x: node.x + portOffset.x, y: node.y + portOffset.y };
    }
  }
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function computePolylineMidpoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { x: points[0]!.x, y: points[0]!.y };

  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segLens.push(len);
    totalLen += len;
  }

  if (totalLen <= 1e-9) {
    return { x: points[0]!.x, y: points[0]!.y };
  }

  const half = totalLen * 0.5;
  let accum = 0;
  for (let i = 0; i < segLens.length; i++) {
    const len = segLens[i]!;
    if (accum + len >= half && len > 1e-9) {
      const t = (half - accum) / len;
      const a = points[i]!;
      const b = points[i + 1]!;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      };
    }
    accum += len;
  }

  const last = points[points.length - 1]!;
  return { x: last.x, y: last.y };
}

function matchesSymbolOrPrefix(candidate: string | undefined, target: string): boolean {
  if (!candidate) return false;
  const c = candidate.trim();
  if (!c) return false;
  return c === target || c.startsWith(`${target}.`);
}

function findNodeGroupId(
  node: ParsedNode,
  spans: DiagramZonotopeHypergraphSpan[],
  overrides: ZonotopePendingOverride[],
): number {
  // Pending overrides take precedence (latest matching override wins)
  for (let i = overrides.length - 1; i >= 0; i--) {
    const o = overrides[i]!;
    if (
      o.symbolName === node.name ||
      o.symbolName === node.id ||
      o.textSnippet === node.name ||
      o.textSnippet === node.id
    ) {
      return Math.max(0, Math.trunc(o.groupId));
    }
  }

  // Exact hypergraph span match first (prefer non-zero groupId)
  let prefixGroupId = 0;
  for (const span of spans) {
    const sym = span.symbolName?.trim();
    const txt = span.text.trim();
    const exactMatch = sym === node.name || sym === node.id || txt === node.name || txt === node.id;
    if (exactMatch && span.groupId > 0) {
      return Math.trunc(span.groupId);
    }
    if (
      prefixGroupId === 0 &&
      span.groupId > 0 &&
      (matchesSymbolOrPrefix(sym, node.name) ||
        matchesSymbolOrPrefix(sym, node.id) ||
        matchesSymbolOrPrefix(txt, node.name))
    ) {
      prefixGroupId = Math.trunc(span.groupId);
    }
  }

  return prefixGroupId;
}

function findActiveFaultForNode(
  node: ParsedNode,
  faultGenerators: FaultGeneratorSpec[],
): FaultGeneratorSpec | undefined {
  const nameLower = node.name.toLowerCase();
  const idLower = node.id.toLowerCase();
  let ciFallback: FaultGeneratorSpec | undefined;

  for (const fg of faultGenerators) {
    if (!fg.enabled) continue;
    const comp = fg.componentName.trim();
    if (!comp) continue;
    if (comp === node.name || comp === node.id) {
      return fg;
    }
    const compLower = comp.toLowerCase();
    if (!ciFallback && (compLower === nameLower || compLower === idLower)) {
      ciFallback = fg;
    }
  }
  return ciFallback;
}

function findEdgeOverride(
  edgeId: string,
  source: string,
  target: string,
  sourceName: string,
  targetName: string,
  overrides: ZonotopePendingOverride[],
): ZonotopePendingOverride | undefined {
  const candidates = new Set<string>([
    edgeId,
    `${source}->${target}`,
    `${sourceName}->${targetName}`,
    `${source}-${target}`,
    `${sourceName}-${targetName}`,
    `connect(${source},${target})`,
    `connect(${sourceName},${targetName})`,
  ]);

  for (let i = overrides.length - 1; i >= 0; i--) {
    const o = overrides[i]!;
    if (o.symbolName && candidates.has(o.symbolName.trim())) {
      return o;
    }
    if (o.textSnippet && candidates.has(o.textSnippet.trim())) {
      return o;
    }
  }
  return undefined;
}

function spanMatchesEndpoint(
  span: DiagramZonotopeHypergraphSpan,
  cell: string,
  name: string,
  port: string | undefined,
): boolean {
  const sym = span.symbolName?.trim();
  const txt = span.text.trim();
  const fullCellPort = port ? `${cell}.${port}` : undefined;
  const fullNamePort = port ? `${name}.${port}` : undefined;

  if (fullCellPort && (sym === fullCellPort || txt === fullCellPort)) return true;
  if (fullNamePort && (sym === fullNamePort || txt === fullNamePort)) return true;
  if (
    matchesSymbolOrPrefix(sym, name) ||
    matchesSymbolOrPrefix(sym, cell) ||
    matchesSymbolOrPrefix(txt, name) ||
    matchesSymbolOrPrefix(txt, cell)
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public geometry builder
// ---------------------------------------------------------------------------

/**
 * Pure deterministic builder for 2D Diagram Zonotope overlay geometry:
 * - Node `±ε_2d * stressScale` layout-invariance envelopes
 * - Live perturbed ghost silhouettes driven by `xiByGroupId` and `stressScale`
 * - Optional `90°` rotation halos when `diagramAllowRotation` is enabled
 * - Fault-mode generator annotations
 * - `FLOW_CONSERVATION` (`relTypeId === 4`) wire overlays with `+1` / `-1` port signs
 *
 * Never mutates `diagramData`, `hypergraphRecord`, or `state`.
 */
export function buildDiagramZonotopeOverlayGeometry(
  diagramData: unknown,
  hypergraphRecord: DiagramZonotopeHypergraphInput | null,
  state: ZonotopeWorkbenchState,
): DiagramZonotopeOverlayGeometry {
  const spans = hypergraphRecord?.spans ?? [];
  const overrides = state.pendingOverrides ?? [];
  const faultGenerators = state.faultGenerators ?? [];

  const stressScale =
    typeof state.stressScale === "number" && Number.isFinite(state.stressScale) && state.stressScale >= 0
      ? state.stressScale
      : 0;
  const baseJitterPx =
    typeof state.budgets.diagramLayoutJitterPx === "number" &&
    Number.isFinite(state.budgets.diagramLayoutJitterPx) &&
    state.budgets.diagramLayoutJitterPx >= 0
      ? state.budgets.diagramLayoutJitterPx
      : 0;
  const jitter = baseJitterPx * stressScale;
  const allowRotation = Boolean(state.budgets.diagramAllowRotation);

  if (!isRecord(diagramData)) {
    return {
      nodes: [],
      edges: [],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    };
  }

  const parsedNodes = parseRawNodes(diagramData);
  const nodeByIdOrName = new Map<string, ParsedNode>();
  const ghostByIdOrName = new Map<string, DiagramZonotopeNodeGhost>();

  for (const n of parsedNodes) {
    nodeByIdOrName.set(n.id, n);
    if (!nodeByIdOrName.has(n.name)) {
      nodeByIdOrName.set(n.name, n);
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const includePoint = (px: number, py: number): void => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  };

  const nodes: DiagramZonotopeNodeGhost[] = [];

  for (let i = 0; i < parsedNodes.length; i++) {
    const n = parsedNodes[i]!;
    const groupId = findNodeGroupId(n, spans, overrides);

    const envelopeX = n.x - jitter;
    const envelopeY = n.y - jitter;
    const envelopeWidth = n.width + 2 * jitter;
    const envelopeHeight = n.height + 2 * jitter;

    const phase = (i + 1) * GOLDEN_ANGLE_RAD;
    const dirX = Math.cos(phase);
    const dirY = Math.sin(phase);

    const hasExplicitXi =
      Object.prototype.hasOwnProperty.call(state.xiByGroupId, groupId) &&
      typeof state.xiByGroupId[groupId] === "number" &&
      Number.isFinite(state.xiByGroupId[groupId]);

    const xiDrive = hasExplicitXi ? Math.max(-2, Math.min(2, state.xiByGroupId[groupId]!)) : stressScale > 0 ? 0.45 : 0;

    const perturbedX = n.x + dirX * jitter * xiDrive;
    const perturbedY = n.y + dirY * jitter * xiDrive;

    const rotationHaloRadius = allowRotation ? Math.hypot(n.width, n.height) * 0.5 + Math.max(6, jitter * 0.35) : 0;

    const perturbedRotationDeg = allowRotation
      ? n.angle + (hasExplicitXi ? xiDrive * 90 : stressScale > 0 ? (i % 2 === 0 ? 90 : -90) : 0)
      : n.angle;

    const activeFault = findActiveFaultForNode(n, faultGenerators);

    const ghost: DiagramZonotopeNodeGhost = {
      id: n.id,
      name: n.name,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      envelopeX,
      envelopeY,
      envelopeWidth,
      envelopeHeight,
      perturbedX,
      perturbedY,
      perturbedRotationDeg,
      rotationHaloRadius,
      groupId,
      hasFaultGenerator: activeFault !== undefined,
    };
    if (activeFault !== undefined) {
      ghost.faultMode = activeFault.faultMode;
    }

    nodes.push(ghost);
    ghostByIdOrName.set(n.id, ghost);
    if (!ghostByIdOrName.has(n.name)) {
      ghostByIdOrName.set(n.name, ghost);
    }

    includePoint(envelopeX, envelopeY);
    includePoint(envelopeX + envelopeWidth, envelopeY + envelopeHeight);
    includePoint(perturbedX, perturbedY);
    includePoint(perturbedX + n.width, perturbedY + n.height);
    if (rotationHaloRadius > 0) {
      const cx = n.x + n.width * 0.5;
      const cy = n.y + n.height * 0.5;
      includePoint(cx - rotationHaloRadius, cy - rotationHaloRadius);
      includePoint(cx + rotationHaloRadius, cy + rotationHaloRadius);
    }
  }

  // Parse edges (`edges` or fallback `connections`)
  const rawEdges = Array.isArray(diagramData["edges"])
    ? (diagramData["edges"] as unknown[])
    : Array.isArray(diagramData["connections"])
      ? (diagramData["connections"] as unknown[])
      : [];

  const edges: DiagramZonotopeEdgeFlow[] = [];

  for (let i = 0; i < rawEdges.length; i++) {
    const raw = rawEdges[i];
    if (!isRecord(raw)) continue;

    const srcEp = parseEndpoint(raw["source"] ?? raw["from"]);
    const tgtEp = parseEndpoint(raw["target"] ?? raw["to"]);
    if (!srcEp || !tgtEp) continue;

    const srcNode = nodeByIdOrName.get(srcEp.cell);
    const tgtNode = nodeByIdOrName.get(tgtEp.cell);
    const sourceName = srcNode?.name ?? srcEp.cell;
    const targetName = tgtNode?.name ?? tgtEp.cell;

    const edgeId = asNonEmptyString(raw["id"]) ?? `${srcEp.cell}->${tgtEp.cell}#${i}`;

    // Build polyline points (never sharing references with input arrays)
    const explicitPoints = clonePoints(raw["points"]);
    let points: Array<{ x: number; y: number }>;
    if (explicitPoints.length >= 2) {
      points = explicitPoints;
    } else {
      const pts: Array<{ x: number; y: number }> = [];
      const startPt = resolveEndpointPoint(srcEp, nodeByIdOrName);
      if (startPt) pts.push(startPt);
      const vertices = clonePoints(raw["vertices"]);
      for (const v of vertices) pts.push(v);
      const endPt = resolveEndpointPoint(tgtEp, nodeByIdOrName);
      if (endPt) pts.push(endPt);
      points = pts.length > 0 ? pts : explicitPoints;
    }

    for (const pt of points) {
      includePoint(pt.x, pt.y);
    }
    const midpoint = computePolylineMidpoint(points);

    // Resolve groupId, relTypeId, signs, and lock status
    const directOverride = findEdgeOverride(edgeId, srcEp.cell, tgtEp.cell, sourceName, targetName, overrides);

    let groupId = 0;
    let relTypeId = FLOW_CONSERVATION_REL_TYPE;
    let sourceSign: 1 | -1 = 1;
    let targetSign: 1 | -1 = -1;
    let isLocked = false;

    if (directOverride) {
      groupId = Math.max(0, Math.trunc(directOverride.groupId));
      relTypeId = Math.trunc(directOverride.relTypeId);
      isLocked = groupId === 0;
      if (directOverride.relSign < 0) {
        sourceSign = -1;
        targetSign = 1;
      } else {
        sourceSign = 1;
        targetSign = -1;
      }
    } else {
      // Match FLOW_CONSERVATION (relTypeId === 4) spans in hypergraphRecord
      const flowSpans = spans.filter((s) => s.relTypeId === FLOW_CONSERVATION_REL_TYPE);
      const srcFlowSpan = flowSpans.find((s) => spanMatchesEndpoint(s, srcEp.cell, sourceName, srcEp.port));
      const tgtFlowSpan = flowSpans.find((s) => spanMatchesEndpoint(s, tgtEp.cell, targetName, tgtEp.port));

      if (srcFlowSpan || tgtFlowSpan) {
        const chosen = srcFlowSpan ?? tgtFlowSpan!;
        groupId = Math.max(0, Math.trunc(chosen.groupId));
        relTypeId = FLOW_CONSERVATION_REL_TYPE;
        if (srcFlowSpan && srcFlowSpan.relSign < 0) {
          sourceSign = -1;
          targetSign = 1;
        } else if (!srcFlowSpan && tgtFlowSpan && tgtFlowSpan.relSign > 0) {
          sourceSign = -1;
          targetSign = 1;
        } else {
          sourceSign = 1;
          targetSign = -1;
        }
        isLocked = groupId === 0;
      } else {
        // Fallback to endpoint node generator group
        const srcGhost = ghostByIdOrName.get(srcEp.cell) ?? ghostByIdOrName.get(sourceName);
        const tgtGhost = ghostByIdOrName.get(tgtEp.cell) ?? ghostByIdOrName.get(targetName);
        const srcGroup = srcGhost?.groupId ?? 0;
        const tgtGroup = tgtGhost?.groupId ?? 0;
        groupId = srcGroup > 0 ? srcGroup : tgtGroup;
        relTypeId = FLOW_CONSERVATION_REL_TYPE;
        isLocked = groupId === 0;
      }
    }

    edges.push({
      id: edgeId,
      source: srcEp.cell,
      target: tgtEp.cell,
      groupId,
      relTypeId,
      sourceSign,
      targetSign,
      points,
      midpoint,
      isLocked,
    });
  }

  let bounds: DiagramZonotopeBounds;
  if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
    bounds = { minX, minY, maxX, maxY };
  } else {
    const cs = isRecord(diagramData["coordinateSystem"]) ? diagramData["coordinateSystem"] : undefined;
    const csX = asFiniteNumber(cs?.["x"], 0);
    const csY = asFiniteNumber(cs?.["y"], 0);
    const csW = asFiniteNumber(cs?.["width"], 100);
    const csH = asFiniteNumber(cs?.["height"], 100);
    bounds = {
      minX: csX,
      minY: csY,
      maxX: csX + (csW > 0 ? csW : 100),
      maxY: csY + (csH > 0 ? csH : 100),
    };
  }

  return { nodes, edges, bounds };
}
