// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AlignmentGuideLine } from "../../core/alignment-guides.js";
import type { CameraController } from "../../core/camera.js";
import type { WorldBounds } from "../../schema/canvas-document.js";
import type { PointerFsmCallbacks, WiringPreview } from "../pointer-fsm.js";
import type { SoaSceneGraph } from "../soa-scene.js";
import { UnifiedSelection, type UnifiedCell, type UnifiedGraphOptions } from "./cell.js";
import { computeWiringPreviewPath, type ConnectorRegistry, type RouterRegistry } from "./edge-routing.js";
import { escapeSelectorAttr } from "./geometry.js";
import type { UnifiedCellHost } from "./types.js";

export interface FsmBridgeHost<TGraph extends UnifiedCellHost<UnifiedCell>> {
  readonly graph: TGraph;
  readonly options: UnifiedGraphOptions;
  readonly scene: SoaSceneGraph;
  readonly camera: CameraController;
  readonly cells: ReadonlyMap<string, UnifiedCell>;
  readonly routerRegistry: RouterRegistry<TGraph>;
  readonly connectorRegistry: ConnectorRegistry<TGraph>;
  getWirePreviewPathEl: () => SVGPathElement | null;
  getEdges: () => UnifiedCell[];
  createEdge: (metadata: Record<string, unknown>) => UnifiedCell;
  addEdge: (metadata: Record<string, unknown> | UnifiedCell) => UnifiedCell;
  getPlugin: (name: string) => unknown;
  syncSelectionFromFsm: (nodeIds: string[], edgeIds: string[]) => void;
  syncCellDom: (cell: UnifiedCell) => void;
  resizeCellVisualDom: (cell: UnifiedCell, prevWidth: number, prevHeight: number) => void;
  refreshConnectedEdges: (node: UnifiedCell) => void;
  syncSelectionBoxesDom: (panOnly?: boolean) => void;
  syncEdgeToolsDom: (edge: UnifiedCell) => void;
  syncAlignmentGuidesDom: (guides: AlignmentGuideLine[]) => void;
  syncMarqueeDom: (rect: WorldBounds | null) => void;
  syncMagnetHighlightsDom: (preview: WiringPreview | null) => void;
  applyViewportTransformDom: (panOnly?: boolean) => void;
  scheduleCanvas2DRender: () => void;
  emit: (event: string, args?: unknown) => void;
}

export function createGraphFsmCallbacks<TGraph extends UnifiedCellHost<UnifiedCell>>(
  host: FsmBridgeHost<TGraph>,
): PointerFsmCallbacks {
  return {
    onSelectionChange: (nodeIds, edgeIds) => {
      host.syncSelectionFromFsm(nodeIds, edgeIds);
    },
    onNodesMoved: (moves, committed) => {
      for (const [id, pt] of Object.entries(moves)) {
        const cell = host.cells.get(id);
        if (!cell) continue;
        const prev = { x: cell.x, y: cell.y };
        cell.x = pt.x;
        cell.y = pt.y;
        host.syncCellDom(cell);
        host.refreshConnectedEdges(cell);
        host.emit("node:change:position", { cell, node: cell, current: pt, previous: prev });
        if (committed) {
          host.emit("node:moved", { cell, node: cell });
        }
      }
      host.syncSelectionBoxesDom();
      host.scheduleCanvas2DRender();
    },
    onNodeResized: (nodeId, bounds, committed) => {
      const cell = host.cells.get(nodeId);
      if (!cell) return;
      const prev = { width: cell.width, height: cell.height };
      cell.x = bounds.x;
      cell.y = bounds.y;
      cell.width = bounds.width;
      cell.height = bounds.height;
      host.resizeCellVisualDom(cell, prev.width, prev.height);
      host.syncCellDom(cell);
      host.refreshConnectedEdges(cell);
      host.emit("node:change:size", {
        cell,
        node: cell,
        current: { width: bounds.width, height: bounds.height },
        previous: prev,
      });
      host.emit(committed ? "node:resized" : "node:resizing", { cell, node: cell });
      host.syncSelectionBoxesDom();
      host.scheduleCanvas2DRender();
    },
    onNodeRotated: (nodeId, angleDeg, committed) => {
      const cell = host.cells.get(nodeId);
      if (!cell) return;
      cell.angle = angleDeg;
      host.syncCellDom(cell);
      host.refreshConnectedEdges(cell);
      host.emit("node:change:angle", { cell, node: cell, current: angleDeg });
      host.emit(committed ? "node:rotated" : "node:rotating", { cell, node: cell });
      host.syncSelectionBoxesDom();
      host.scheduleCanvas2DRender();
    },
    onWireConnected: ({ sourceNodeId, sourcePortId, targetNodeId, targetPortId }) => {
      const connOpts = host.options.connecting;
      const allowLoop = typeof connOpts?.allowLoop === "function" ? connOpts.allowLoop() : connOpts?.allowLoop;
      if (allowLoop === false && sourceNodeId === targetNodeId) {
        return;
      }
      const allowMulti = typeof connOpts?.allowMulti === "function" ? connOpts.allowMulti() : connOpts?.allowMulti;
      if (allowMulti === false) {
        for (const existing of host.getEdges()) {
          const s = existing.getSource();
          const t = existing.getTarget();
          if (
            (s.cell === sourceNodeId &&
              s.port === sourcePortId &&
              t.cell === targetNodeId &&
              t.port === targetPortId) ||
            (s.cell === targetNodeId && s.port === targetPortId && t.cell === sourceNodeId && t.port === sourcePortId)
          ) {
            return;
          }
        }
      }
      const edge = connOpts?.createEdge ? connOpts.createEdge() : host.createEdge({});
      edge.setSource({ cell: sourceNodeId, port: sourcePortId });
      edge.setTarget({ cell: targetNodeId, port: targetPortId });
      if (!edge.getRouter() && connOpts?.router) {
        edge.setRouter(connOpts.router);
      }
      if (!edge.getConnector() && connOpts?.connector) {
        edge.setConnector(connOpts.connector);
      }
      if (connOpts?.validateEdge && !connOpts.validateEdge({ edge })) {
        return;
      }
      host.addEdge(edge);
      host.emit("edge:connected", { isNew: true, edge, cell: edge });
    },
    onEdgeVerticesChanged: (edgeId, vertices, committed) => {
      const edge = host.cells.get(edgeId);
      if (!edge) return;
      edge.setVertices(vertices, { ui: !committed });
      host.syncEdgeToolsDom(edge);
      if (committed) {
        host.emit("edge:mouseup", { edge, cell: edge });
      }
    },
    onPanDelta: (dx, dy) => {
      const next = host.camera.panByScreenDelta(dx, dy);
      host.applyViewportTransformDom(true);
      host.emit("translate", { tx: next.tx, ty: next.ty });
    },
    onAlignmentGuides: (guides) => {
      host.syncAlignmentGuidesDom(guides);
    },
    onMarqueeChange: (rect) => {
      host.syncMarqueeDom(rect);
    },
    onWiringPreview: (preview) => {
      host.syncMagnetHighlightsDom(preview);
      const previewEl = host.getWirePreviewPathEl();
      if (!previewEl) return;
      if (!preview) {
        previewEl.setAttribute("d", "");
        return;
      }
      const d = computeWiringPreviewPath(
        preview,
        host.graph,
        host.cells,
        host.scene,
        host.options,
        host.routerRegistry,
        host.connectorRegistry,
      );
      previewEl.setAttribute("d", d);
    },
    onNodeInteractiveClick: (nodeId, phase, u, v) => {
      const node = host.cells.get(nodeId);
      if (!node) return;
      if (phase === "down") host.emit("node:mousedown", { node, cell: node, x: u, y: v });
      else if (phase === "up") host.emit("node:mouseup", { node, cell: node, x: u, y: v });
      else if (phase === "click") {
        host.emit("node:click", { node, cell: node, x: u, y: v });
        host.emit("cell:click", { cell: node, node, x: u, y: v });
      }
    },
    validateConnection: (sId, sPort, tId, tPort) => {
      const connOpts = host.options.connecting;
      const allowLoop = typeof connOpts?.allowLoop === "function" ? connOpts.allowLoop() : connOpts?.allowLoop;
      if (allowLoop === false && sId === tId) return false;
      const validator = connOpts?.validateConnection;
      if (!validator) return true;
      return validator({
        sourceCell: host.cells.get(sId) ?? null,
        targetCell: host.cells.get(tId) ?? null,
        sourcePort: sPort,
        targetPort: tPort,
      });
    },
    validateMagnet: (nodeId, portId) => {
      const vm = host.options.connecting?.validateMagnet;
      if (!vm) return true;
      const cell = host.cells.get(nodeId) ?? null;
      const view = cell ? host.graph.findViewByCell(cell) : null;
      const escPort = escapeSelectorAttr(portId);
      const magnet =
        view?.container?.querySelector?.(`.ms-port[port="${escPort}"], .ms-port[port-id="${escPort}"]`) ?? null;
      return vm({ cell, magnet });
    },
    canInteract: (cellId) => {
      const inter = host.options.interacting;
      if (inter === undefined || inter === true) return true;
      if (inter === false) return false;
      const cell = host.cells.get(cellId);
      if (!cell) return true;
      return inter({ cell });
    },
    selectionFilter: (cellId) => {
      const selPlugin = host.getPlugin("selection");
      const filter = selPlugin instanceof UnifiedSelection ? selPlugin.options.filter : undefined;
      if (!filter) return true;
      const cell = host.cells.get(cellId);
      if (!cell) return true;
      if (typeof filter === "function") return filter(cell);
      return true;
    },
  };
}
