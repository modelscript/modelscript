// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorldPoint } from "../../schema/canvas-document.js";
import type { WiringPreview } from "../pointer-fsm.js";
import type { SoaSceneGraph } from "../soa-scene.js";
import type { UnifiedCell, UnifiedGraphOptions } from "./cell.js";
import { defaultPolylinePath, nextAutoCellId } from "./geometry.js";
import {
  SVG_NS,
  type EdgeRenderPathResult,
  type UnifiedCellHost,
  type UnifiedCellViewBase,
  type UnifiedConnectorFnBase,
  type UnifiedRouterFnBase,
} from "./types.js";

export type RouterRegistry<TGraph> = ReadonlyMap<string, UnifiedRouterFnBase<UnifiedCell, TGraph>>;
export type ConnectorRegistry<TGraph> = ReadonlyMap<string, UnifiedConnectorFnBase<UnifiedCell, TGraph>>;

export function ensureEdgeMarker(
  defsEl: SVGDefsElement | null,
  markerCache: Map<string, string>,
  markerSpec: unknown,
  strokeColor: string,
): string | null {
  if (!markerSpec || !defsEl || typeof document === "undefined") return null;
  const name =
    typeof markerSpec === "string"
      ? markerSpec
      : typeof markerSpec === "object"
        ? ((markerSpec as { name?: string | undefined }).name ?? "block")
        : "";
  if (!name || name === "none") return null;

  const sizeW =
    typeof markerSpec === "object" && typeof (markerSpec as { width?: number }).width === "number"
      ? (markerSpec as { width: number }).width
      : 10;
  const sizeH =
    typeof markerSpec === "object" && typeof (markerSpec as { height?: number }).height === "number"
      ? (markerSpec as { height: number }).height
      : 8;
  const fill =
    typeof markerSpec === "object" && typeof (markerSpec as { fill?: string }).fill === "string"
      ? (markerSpec as { fill: string }).fill
      : strokeColor;

  const key = `${name}|${fill}|${strokeColor}|${sizeW}x${sizeH}`;
  const cached = markerCache.get(key);
  if (cached) return cached;

  const id = nextAutoCellId("ms-marker-");
  const marker = document.createElementNS(SVG_NS, "marker");
  marker.setAttribute("id", id);
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "9");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", String(sizeW));
  marker.setAttribute("markerHeight", String(sizeH));
  marker.setAttribute("orient", "auto-start-reverse");

  const shape = document.createElementNS(SVG_NS, name === "circle" ? "circle" : "path");
  if (name === "circle") {
    shape.setAttribute("cx", "5");
    shape.setAttribute("cy", "5");
    shape.setAttribute("r", "3.5");
    shape.setAttribute("fill", fill);
    shape.setAttribute("stroke", strokeColor);
  } else if (name === "diamond") {
    shape.setAttribute("d", "M 0 5 L 5 1 L 10 5 L 5 9 Z");
    shape.setAttribute("fill", fill);
    shape.setAttribute("stroke", strokeColor);
  } else if (name === "classic" || name === "async") {
    shape.setAttribute("d", "M 0 1 L 10 5 L 0 9 L 2.5 5 Z");
    shape.setAttribute("fill", fill);
  } else {
    // Standard block / triangle arrowhead
    shape.setAttribute("d", "M 0 1 L 10 5 L 0 9 Z");
    shape.setAttribute("fill", fill);
  }
  marker.appendChild(shape);
  defsEl.appendChild(marker);
  markerCache.set(key, id);
  return id;
}

export function computeEdgeRenderPath<TGraph extends UnifiedCellHost<UnifiedCell>>(
  edge: UnifiedCell,
  scene: SoaSceneGraph,
  findViewByCell: (cell: UnifiedCell | string) => UnifiedCellViewBase<UnifiedCell, TGraph> | null,
  routerRegistry: RouterRegistry<TGraph>,
  connectorRegistry: ConnectorRegistry<TGraph>,
): EdgeRenderPathResult {
  const view = findViewByCell(edge)!;
  const sourcePt = edge.getSourcePoint();
  const targetPt = edge.getTargetPoint();
  view.sourcePoint = sourcePt;
  view.targetPoint = targetPt;

  let routePoints = edge.getVertices();
  const routerSpec = edge.getRouter();
  const routerName =
    typeof routerSpec === "string"
      ? routerSpec
      : routerSpec && typeof routerSpec === "object"
        ? (routerSpec as { name?: string | undefined }).name
        : undefined;
  const routerArgs =
    routerSpec && typeof routerSpec === "object"
      ? ((routerSpec as { args?: Record<string, unknown> | undefined }).args ?? {})
      : {};
  if (routerName) {
    const fn = routerRegistry.get(routerName);
    if (fn) {
      try {
        const routed = fn(routePoints, routerArgs, view);
        if (Array.isArray(routed)) routePoints = routed;
      } catch (err) {
        void err;
      }
    }
  }
  view.routePoints = routePoints;
  const edgeRec = scene.getEdge(edge.id);
  if (edgeRec) edgeRec.routePoints = routePoints;

  const connSpec = edge.getConnector();
  const connName =
    typeof connSpec === "string"
      ? connSpec
      : connSpec && typeof connSpec === "object"
        ? ((connSpec as { name?: string | undefined }).name ?? "rounded")
        : "rounded";
  const connArgs =
    connSpec && typeof connSpec === "object"
      ? ((connSpec as { args?: Record<string, unknown> | undefined }).args ?? {})
      : {};

  let d = "";
  const connFn = connectorRegistry.get(connName);
  if (connFn) {
    try {
      d = connFn(sourcePt, targetPt, routePoints, connArgs, view);
    } catch {
      d = defaultPolylinePath(sourcePt, targetPt, routePoints, connName);
    }
  } else {
    d = defaultPolylinePath(
      sourcePt,
      targetPt,
      routePoints,
      connName,
      typeof connArgs["radius"] === "number" ? connArgs["radius"] : 8,
    );
  }

  const lineAttrs = edge.getAttrs()["line"] ?? {};
  const stroke = typeof lineAttrs["stroke"] === "string" ? lineAttrs["stroke"] : "#38bdf8";
  const strokeWidth =
    typeof lineAttrs["strokeWidth"] === "number"
      ? lineAttrs["strokeWidth"]
      : typeof lineAttrs["stroke-width"] === "number"
        ? lineAttrs["stroke-width"]
        : 1.5;
  const strokeDasharray =
    typeof lineAttrs["strokeDasharray"] === "string"
      ? lineAttrs["strokeDasharray"]
      : typeof lineAttrs["stroke-dasharray"] === "string"
        ? lineAttrs["stroke-dasharray"]
        : undefined;

  return {
    d,
    sourcePt,
    targetPt,
    routePoints,
    stroke,
    strokeWidth,
    strokeDasharray,
    sourceMarker: lineAttrs["sourceMarker"],
    targetMarker: lineAttrs["targetMarker"],
  };
}

export function computeWiringPreviewPath<TGraph extends UnifiedCellHost<UnifiedCell>>(
  preview: WiringPreview,
  graph: TGraph,
  cells: ReadonlyMap<string, UnifiedCell>,
  scene: SoaSceneGraph,
  options: UnifiedGraphOptions,
  routerRegistry: RouterRegistry<TGraph>,
  connectorRegistry: ConnectorRegistry<TGraph>,
): string {
  const srcPt = preview.sourcePoint;
  const tgtPt = preview.snappedTarget
    ? { x: preview.snappedTarget.x, y: preview.snappedTarget.y }
    : preview.currentPoint;
  let routePts: WorldPoint[] = [];

  const srcCell = cells.get(preview.sourceNodeId);
  const tgtCell = preview.snappedTarget ? cells.get(preview.snappedTarget.nodeId) : undefined;
  const mockEdge = {
    id: "__wiring_preview__",
    getSource: () => ({ cell: preview.sourceNodeId, port: preview.sourcePortId }),
    getTarget: () =>
      preview.snappedTarget
        ? { cell: preview.snappedTarget.nodeId, port: preview.snappedTarget.portId }
        : { x: tgtPt.x, y: tgtPt.y },
    getSourceCell: () => srcCell ?? null,
    getTargetCell: () => tgtCell ?? null,
    getSourcePortId: () => preview.sourcePortId,
    getTargetPortId: () => preview.snappedTarget?.portId,
    getSourcePoint: () => srcPt,
    getTargetPoint: () => tgtPt,
    getVertices: () => [],
  };
  const mockView: UnifiedCellViewBase<UnifiedCell, TGraph> = {
    cell: mockEdge as unknown as UnifiedCell,
    graph,
    container: null,
    sourcePoint: srcPt,
    targetPoint: tgtPt,
    routePoints: [],
    getVertexIndex: () => -1,
  };

  const routerSpec = options.connecting?.router;
  const routerName =
    typeof routerSpec === "string"
      ? routerSpec
      : routerSpec && typeof routerSpec === "object"
        ? (routerSpec as { name?: string | undefined }).name
        : undefined;
  const routerFn = routerName ? routerRegistry.get(routerName) : undefined;
  if (routerFn) {
    try {
      const routerArgs =
        routerSpec && typeof routerSpec === "object"
          ? ((routerSpec as { args?: Record<string, unknown> | undefined }).args ?? {})
          : {};
      const routed = routerFn([], routerArgs, mockView);
      if (Array.isArray(routed)) {
        routePts = routed;
      }
    } catch {
      routePts = [];
    }
  }

  if (routePts.length === 0 && Math.abs(tgtPt.x - srcPt.x) > 1 && Math.abs(tgtPt.y - srcPt.y) > 1) {
    const portWorld = scene.getPortWorldPosition(preview.sourceNodeId, preview.sourcePortId);
    const horiz = portWorld ? Math.abs(portWorld.nx) >= Math.abs(portWorld.ny) : true;
    routePts = horiz ? [{ x: tgtPt.x, y: srcPt.y }] : [{ x: srcPt.x, y: tgtPt.y }];
  }
  mockView.routePoints = routePts;

  const connSpec = options.connecting?.connector;
  const connName =
    typeof connSpec === "string"
      ? connSpec
      : connSpec && typeof connSpec === "object"
        ? ((connSpec as { name?: string | undefined }).name ?? "rounded")
        : "rounded";
  const connArgs =
    connSpec && typeof connSpec === "object"
      ? ((connSpec as { args?: Record<string, unknown> | undefined }).args ?? {})
      : {};
  const connFn = connectorRegistry.get(connName);
  if (connFn) {
    try {
      return connFn(srcPt, tgtPt, routePts, connArgs, mockView);
    } catch {
      return defaultPolylinePath(srcPt, tgtPt, routePts, connName);
    }
  }
  return defaultPolylinePath(srcPt, tgtPt, routePts, connName);
}
