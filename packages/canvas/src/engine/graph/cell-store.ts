// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Embedded3DPortalSpec, Scissor3DPortalManager } from "../../renderers/scissor-3d-manager.js";
import type { CanvasPointerFSM } from "../pointer-fsm.js";
import { SceneNodeFlags, type SoaEdgeRecord, type SoaSceneGraph } from "../soa-scene.js";
import { UnifiedCell } from "./cell.js";
import { escapeSelectorAttr } from "./geometry.js";
import type { UnifiedCanvasWidgetSpec, UnifiedCellHost, UnifiedCellViewBase } from "./types.js";

export interface CellStoreHost<TGraph extends UnifiedCellHost<UnifiedCell>> {
  readonly graph: TGraph;
  readonly scene: SoaSceneGraph;
  readonly fsm: CanvasPointerFSM;
  readonly portal3DManager: Scissor3DPortalManager;
  readonly cells: Map<string, UnifiedCell>;
  readonly selectedIds: Set<string>;
  readonly widgets: Map<string, UnifiedCanvasWidgetSpec>;
  getEdgeToolsG: () => SVGGElement | null;
  getGuidesG: () => SVGGElement | null;
  getHoveredCellId: () => string | null;
  setHoveredCellId: (id: string | null) => void;
  getActiveRenderModeInternal: () => "svg" | "canvas2d";
  evaluateRenderMode: () => void;
  rebuildCellDom: (cell: UnifiedCell) => void;
  scheduleCanvas2DRender: () => void;
  syncSelectionBoxesDom: (panOnly?: boolean) => void;
  registerEmbeddedPortal: (spec: Embedded3DPortalSpec) => void;
  registerCanvasWidget: (widget: UnifiedCanvasWidgetSpec) => void;
  emit: (event: string, args?: unknown) => void;
}

export function syncEdgeToScene(scene: SoaSceneGraph, edge: UnifiedCell): void {
  const src = edge.getSource();
  const tgt = edge.getTarget();
  const rec: SoaEdgeRecord = {
    id: edge.id,
    sourceNodeId: src.cell ?? "",
    sourcePortId: src.port,
    sourcePoint: typeof src.x === "number" && typeof src.y === "number" ? { x: src.x, y: src.y } : undefined,
    targetNodeId: tgt.cell ?? "",
    targetPortId: tgt.port,
    targetPoint: typeof tgt.x === "number" && typeof tgt.y === "number" ? { x: tgt.x, y: tgt.y } : undefined,
    vertices: edge.getVertices(),
    routePoints: edge.view?.routePoints ?? [],
    zIndex: edge.zIndex,
    flags: SceneNodeFlags.VISIBLE,
  };
  scene.upsertEdge(rec);
}

export function addNodeToGraph<TGraph extends UnifiedCellHost<UnifiedCell>>(
  host: CellStoreHost<TGraph>,
  metadata: Record<string, unknown> | UnifiedCell,
): UnifiedCell {
  const node = metadata instanceof UnifiedCell ? metadata : new UnifiedCell("node", metadata, host.graph);
  const existing = host.cells.get(node.id);
  if (existing && existing !== node && existing.view?.container && existing.view.container.parentNode) {
    existing.view.container.parentNode.removeChild(existing.view.container);
    existing.selectorElements.clear();
    existing.view = null;
    existing.attachGraph(null);
  }
  node.attachGraph(host.graph);
  host.cells.set(node.id, node);

  const data = node.getData();
  let flags: number = node.visible ? SceneNodeFlags.VISIBLE : SceneNodeFlags.NONE;
  if (data["readOnly"] || data["isInherited"]) flags |= SceneNodeFlags.READONLY;
  if (data["locked"]) flags |= SceneNodeFlags.LOCKED;
  if (data["portal"]) flags |= SceneNodeFlags.PORTAL;
  if (data["widget"]) flags |= SceneNodeFlags.WIDGET;
  if (node.id.startsWith("solder_dot_") || node.id.startsWith("__") || node.id === "diagram_background") {
    flags |= SceneNodeFlags.EPHEMERAL;
  }

  host.scene.upsertNode({
    id: node.id,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    angleDeg: node.angle,
    flipX: Boolean(data["flipX"]),
    flipY: Boolean(data["flipY"]),
    opacity: node.opacity,
    zIndex: node.zIndex,
    flags,
  });

  const ports = node.getPorts();
  if (ports.length > 0) {
    host.scene.setNodePorts(
      node.id,
      ports.map((p) => ({
        id: p.id,
        group: p.group,
        x: p.args?.x ?? 0,
        y: p.args?.y ?? 0,
        angle: p.args?.angle ?? 0,
        direction: p.direction,
      })),
    );
  }

  // Automatically register embedded 3D CAD/FEA/CFD portal or canvas widget if attached in metadata
  if (data["portal"] && typeof data["portal"] === "object") {
    const pSpec = data["portal"] as Partial<Embedded3DPortalSpec>;
    if (pSpec.kind && pSpec.artifactUri) {
      host.registerEmbeddedPortal({
        id: node.id,
        kind: pSpec.kind,
        artifactUri: pSpec.artifactUri,
        bounds: node.getBBox(),
        featurePins: pSpec.featurePins,
        isAnimating: pSpec.isAnimating,
        snapshotDataUrl: pSpec.snapshotDataUrl,
      });
    }
  }
  if (data["widget"] && typeof data["widget"] === "object") {
    const wSpec = data["widget"] as Partial<UnifiedCanvasWidgetSpec>;
    if (wSpec.kind) {
      host.registerCanvasWidget({
        id: node.id,
        kind: wSpec.kind,
        bounds: node.getBBox(),
        plot: wSpec.plot,
        table: wSpec.table,
        sticky: wSpec.sticky,
      });
    }
  }

  host.evaluateRenderMode();
  if (host.getActiveRenderModeInternal() === "svg") {
    host.rebuildCellDom(node);
  } else {
    host.scheduleCanvas2DRender();
  }
  host.emit("cell:added", { cell: node });
  host.emit("node:added", { node, cell: node });
  return node;
}

export function addEdgeToGraph<TGraph extends UnifiedCellHost<UnifiedCell>>(
  host: CellStoreHost<TGraph>,
  metadata: Record<string, unknown> | UnifiedCell,
): UnifiedCell {
  const edge = metadata instanceof UnifiedCell ? metadata : new UnifiedCell("edge", metadata, host.graph);
  const existing = host.cells.get(edge.id);
  if (existing && existing !== edge && existing.view?.container && existing.view.container.parentNode) {
    existing.view.container.parentNode.removeChild(existing.view.container);
    existing.selectorElements.clear();
    existing.view = null;
    existing.attachGraph(null);
  }
  edge.attachGraph(host.graph);
  host.cells.set(edge.id, edge);
  syncEdgeToScene(host.scene, edge);
  if (host.getActiveRenderModeInternal() === "svg") {
    host.rebuildCellDom(edge);
  } else {
    host.scheduleCanvas2DRender();
  }
  host.emit("cell:added", { cell: edge });
  host.emit("edge:added", { edge, cell: edge });
  return edge;
}

export function syncFsmSelection<TGraph extends UnifiedCellHost<UnifiedCell>>(host: CellStoreHost<TGraph>): void {
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  for (const id of host.selectedIds) {
    const c = host.cells.get(id);
    if (!c) continue;
    if (c.isNode()) nodeIds.push(id);
    else edgeIds.push(id);
  }
  host.fsm.syncSelection(nodeIds, edgeIds);
}

export function getSelectedCellsFromStore(
  cells: ReadonlyMap<string, UnifiedCell>,
  selectedIds: ReadonlySet<string>,
): UnifiedCell[] {
  const out: UnifiedCell[] = [];
  for (const id of selectedIds) {
    const c = cells.get(id);
    if (c) out.push(c);
  }
  return out;
}

export function removeCellFromGraph<TGraph extends UnifiedCellHost<UnifiedCell>>(
  host: CellStoreHost<TGraph>,
  cellOrId: unknown,
): UnifiedCell | null {
  const id =
    typeof cellOrId === "string"
      ? cellOrId
      : cellOrId && typeof cellOrId === "object" && "id" in cellOrId
        ? String((cellOrId as { id: string }).id)
        : "";
  const cell = host.cells.get(id);
  if (!cell) return null;

  // Cascade removal to connected edges when removing a node so wires don't dangle to (0,0)
  if (cell.isNode()) {
    const connectedEdges = host.graph.getConnectedEdges(id);
    for (const edge of connectedEdges) {
      if (host.cells.has(edge.id)) {
        removeCellFromGraph(host, edge);
      }
    }
  }

  const wasSelected = host.selectedIds.delete(id);
  host.cells.delete(id);
  host.widgets.delete(id);
  host.portal3DManager.unregisterPortal(id);
  if (host.getHoveredCellId() === id) host.setHoveredCellId(null);

  if (cell.isNode()) {
    host.scene.removeNode(id);
  } else {
    host.scene.removeEdge(id);
  }

  if (cell.view?.container && cell.view.container.parentNode) {
    cell.view.container.parentNode.removeChild(cell.view.container);
  }
  const edgeToolsG = host.getEdgeToolsG();
  if (cell.isEdge() && edgeToolsG) {
    const toolGroup = edgeToolsG.querySelector(`[data-edge-tools-id="${escapeSelectorAttr(id)}"]`);
    if (toolGroup && toolGroup.parentNode) toolGroup.parentNode.removeChild(toolGroup);
  }
  cell.selectorElements.clear();
  cell.view = null;
  cell.attachGraph(null);

  if (wasSelected) {
    syncFsmSelection(host);
    host.emit("selection:changed", {
      added: [],
      removed: [cell],
      selected: getSelectedCellsFromStore(host.cells, host.selectedIds),
    });
  }

  host.emit("cell:removed", { cell });
  host.emit(cell.isNode() ? "node:removed" : "edge:removed", {
    cell,
    node: cell.isNode() ? cell : undefined,
    edge: cell.isEdge() ? cell : undefined,
  });
  host.syncSelectionBoxesDom();
  return cell;
}

export function clearCellsFromGraph<TGraph extends UnifiedCellHost<UnifiedCell>>(host: CellStoreHost<TGraph>): void {
  const all = Array.from(host.cells.values());
  const prevSelected = getSelectedCellsFromStore(host.cells, host.selectedIds);
  for (const c of all) {
    host.portal3DManager.unregisterPortal(c.id);
    if (c.view?.container && c.view.container.parentNode) {
      c.view.container.parentNode.removeChild(c.view.container);
    }
    c.selectorElements.clear();
    c.view = null;
    c.attachGraph(null);
  }
  const edgeToolsG = host.getEdgeToolsG();
  if (edgeToolsG) edgeToolsG.innerHTML = "";
  const guidesG = host.getGuidesG();
  if (guidesG) guidesG.innerHTML = "";
  host.setHoveredCellId(null);
  host.cells.clear();
  host.selectedIds.clear();
  host.widgets.clear();
  host.scene.clear();
  syncFsmSelection(host);
  host.syncSelectionBoxesDom();
  if (prevSelected.length > 0) {
    host.emit("selection:changed", { added: [], removed: prevSelected, selected: [] });
  }
}

export function findOrCreateCellView<TGraph extends UnifiedCellHost<UnifiedCell>>(
  graph: TGraph,
  cells: ReadonlyMap<string, UnifiedCell>,
  cell: UnifiedCell | string,
): UnifiedCellViewBase<UnifiedCell, TGraph> | null {
  const c = typeof cell === "string" ? cells.get(cell) : cell;
  if (!c) return null;
  if (!c.view) {
    const view: UnifiedCellViewBase<UnifiedCell, TGraph> = {
      cell: c,
      graph,
      container: null,
      routePoints: c.isEdge() ? c.getVertices() : [],
      getVertexIndex: (x: number, y: number) => {
        const verts = c.getVertices();
        if (verts.length === 0) return 0;
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < verts.length; i++) {
          const d = Math.hypot(verts[i]!.x - x, verts[i]!.y - y);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        return bestIdx;
      },
    };
    c.view = view;
  }
  return c.view as UnifiedCellViewBase<UnifiedCell, TGraph>;
}

export function selectCellsInStore<TGraph extends UnifiedCellHost<UnifiedCell>>(
  host: CellStoreHost<TGraph>,
  cellOrCells: UnifiedCell | UnifiedCell[],
): void {
  const list = Array.isArray(cellOrCells) ? cellOrCells : [cellOrCells];
  const added: UnifiedCell[] = [];
  for (const c of list) {
    if (!host.selectedIds.has(c.id)) {
      host.selectedIds.add(c.id);
      host.scene.setNodeFlag(c.id, SceneNodeFlags.SELECTED, true);
      added.push(c);
      if (c.isEdge()) host.emit("edge:selected", { edge: c, cell: c });
    }
  }
  if (added.length > 0) {
    syncFsmSelection(host);
    host.syncSelectionBoxesDom();
    host.emit("selection:changed", {
      added,
      removed: [],
      selected: getSelectedCellsFromStore(host.cells, host.selectedIds),
    });
  }
}

export function unselectCellsInStore<TGraph extends UnifiedCellHost<UnifiedCell>>(
  host: CellStoreHost<TGraph>,
  cellOrCells: UnifiedCell | UnifiedCell[],
): void {
  const list = Array.isArray(cellOrCells) ? cellOrCells : [cellOrCells];
  const removed: UnifiedCell[] = [];
  for (const c of list) {
    if (host.selectedIds.delete(c.id)) {
      host.scene.setNodeFlag(c.id, SceneNodeFlags.SELECTED, false);
      removed.push(c);
    }
  }
  if (removed.length > 0) {
    syncFsmSelection(host);
    host.syncSelectionBoxesDom();
    host.emit("selection:changed", {
      added: [],
      removed,
      selected: getSelectedCellsFromStore(host.cells, host.selectedIds),
    });
  }
}

export function cleanSelectionInStore<TGraph extends UnifiedCellHost<UnifiedCell>>(host: CellStoreHost<TGraph>): void {
  if (host.selectedIds.size === 0) return;
  const removed = getSelectedCellsFromStore(host.cells, host.selectedIds);
  for (const c of removed) {
    host.scene.setNodeFlag(c.id, SceneNodeFlags.SELECTED, false);
  }
  host.selectedIds.clear();
  syncFsmSelection(host);
  host.syncSelectionBoxesDom();
  host.emit("selection:changed", { added: [], removed, selected: [] });
}

export function syncSelectionFromFsmInStore<TGraph extends UnifiedCellHost<UnifiedCell>>(
  host: CellStoreHost<TGraph>,
  nodeIds: string[],
  edgeIds: string[],
): void {
  const next = new Set([...nodeIds, ...edgeIds]);
  const added: UnifiedCell[] = [];
  const removed: UnifiedCell[] = [];
  for (const id of next) {
    if (!host.selectedIds.has(id)) {
      const c = host.cells.get(id);
      if (c) added.push(c);
    }
  }
  for (const id of host.selectedIds) {
    if (!next.has(id)) {
      const c = host.cells.get(id);
      if (c) removed.push(c);
    }
  }
  host.selectedIds.clear();
  for (const id of next) host.selectedIds.add(id);
  host.syncSelectionBoxesDom();
  if (added.length > 0 || removed.length > 0) {
    for (const c of added) {
      if (c.isEdge()) host.emit("edge:selected", { edge: c, cell: c });
    }
    host.emit("selection:changed", {
      added,
      removed,
      selected: getSelectedCellsFromStore(host.cells, host.selectedIds),
    });
  }
}

export function disposeCellsAndCollections(
  cells: Map<string, UnifiedCell>,
  selectedIds: Set<string>,
  widgets: Map<string, UnifiedCanvasWidgetSpec>,
  plugins: Map<string, unknown>,
  markerCache: Map<string, string>,
  listeners: Map<string, Set<(args: unknown) => void>>,
  scene: SoaSceneGraph,
): void {
  markerCache.clear();
  plugins.clear();
  widgets.clear();
  for (const c of cells.values()) {
    c.selectorElements.clear();
    c.view = null;
    c.attachGraph(null);
  }
  cells.clear();
  selectedIds.clear();
  scene.clear();
  listeners.clear();
}
