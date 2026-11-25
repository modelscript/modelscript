// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedGraph, UnifiedSelection, UnifiedTransform } from "@modelscript/canvas/engine";

import { autoLayoutDiagramAsync as coreAutoLayoutDiagramAsync } from "./auto-layout.js";
import { updateSolderDots } from "./canvas-edge-routing.js";
import { attachDiagramMutationHandlers } from "./canvas-mutation-handlers.js";
import { createNodeEditingController } from "./canvas-node-editing.js";
import { attachPlacementAndWireTools } from "./canvas-placement-wire.js";
import {
  containerInstances,
  enqueueDiagramAction,
  getActiveDefaultConnector,
  getActiveFlipSelectedNodes,
  getActiveGraph,
  getActiveRotateSelectedNodes,
  getActiveSyncAlignmentToolbar,
  getCurrentOptions,
  getDefaultConnectorForGraph,
  getOptionsForGraph,
  getReadOnlyForGraph,
  setActiveFlipSelectedNodes,
  setActiveGraph,
  setActiveRotateSelectedNodes,
  setActiveSyncAlignmentToolbar,
  setCurrentOptions,
} from "./canvas-state.js";
import type {
  CanvasInteractionFlags,
  Cell,
  Edge,
  Graph,
  GraphConstructor,
  Node,
  PluginConstructor,
} from "./canvas-types.js";
import { attachCanvasUiHandlers } from "./canvas-ui-handlers.js";
import { registerDefaultDiagramConnectorsAndRouters } from "./connectors.js";
import { ensureDiagramStyles, isEphemeralDiagramNode } from "./drop-placeholder.js";
import { isGraphLayoutEditable } from "./graph-state.js";
import { groupSelectedNodesOnGraph, ungroupSelectedNodesOnGraph, type GroupableGraphLike } from "./group-actions.js";
import { destroyMinimapHud, ensureMinimapHud, updateMinimapHud } from "./minimap.js";
import { evaluateModelScriptPortCompatibility } from "./port-compatibility.js";
import {
  alignNodeSelectionBox,
  getEdgeToolConfig,
  resolveEdgeSelectionStyle,
  syncAllNodeSelectionBoxes,
  updateNodeVisualOnResize,
  type ResolvedEdgeSelectionStyle,
} from "./selection-handles.js";
import { scheduleViewportCulling } from "./viewport-culling.js";
import { hydrateDiagramWasm } from "./wasm-hydration.js";

const GraphCtor: GraphConstructor = UnifiedGraph as unknown as GraphConstructor;
const SelectionCtor: PluginConstructor = UnifiedSelection as unknown as PluginConstructor;
const TransformCtor: PluginConstructor = UnifiedTransform as unknown as PluginConstructor;

registerDefaultDiagramConnectorsAndRouters(
  GraphCtor as unknown as Parameters<typeof registerDefaultDiagramConnectorsAndRouters>[0],
);

/**
 * Initializes (or reconfigures) the AntV X6 graph canvas, plugins, interaction handlers,
 * orthogonal edge routers, and keyboard shortcuts.
 */
export function initGraph(isDark: boolean, targetContainer?: HTMLElement): Graph | null {
  ensureDiagramStyles();
  void hydrateDiagramWasm();
  let currentOptions = getCurrentOptions();
  let container = targetContainer ?? currentOptions?.container;
  if (!container && typeof document !== "undefined") {
    const el = document.getElementById("container");
    if (el) {
      container = el;
      if (!currentOptions) {
        currentOptions = { container: el, isDark };
        setCurrentOptions(currentOptions);
      } else {
        currentOptions.container = el;
      }
    }
  }
  const activeGraph = getActiveGraph();
  if (!container) {
    if (activeGraph) return activeGraph;
    return null;
  }
  const placeholder = document.getElementById("placeholder");
  if (placeholder) placeholder.style.display = "none";

  const bgColor = isDark ? "#121214" : "#f8fafc";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.12)";

  const existingInst = containerInstances.get(container);
  if (existingInst && !existingInst.graph.disposed) {
    if (currentOptions && currentOptions.container === container) {
      existingInst.options = currentOptions;
    }
    const reused = existingInst.graph;
    setActiveGraph(reused);
    reused.drawBackground({ color: bgColor });
    reused.drawGrid({
      type: "doubleMesh",
      args: [
        { color: "transparent", thickness: 0 },
        { color: gridColor, thickness: 1, factor: 10 },
      ],
    });
    return reused;
  }

  if (activeGraph && !activeGraph.disposed && activeGraph.container === container) {
    activeGraph.drawBackground({ color: bgColor });
    activeGraph.drawGrid({
      type: "doubleMesh",
      args: [
        { color: "transparent", thickness: 0 },
        { color: gridColor, thickness: 1, factor: 10 },
      ],
    });
    return activeGraph;
  }

  const parent = container.parentElement;
  const parentW = parent?.clientWidth ?? 0;
  const parentH = parent?.clientHeight ?? 0;
  const clientW = container.clientWidth > 0 ? container.clientWidth : 0;
  const clientH = container.clientHeight > 0 ? container.clientHeight : 0;
  const containerW = parentW > 0 ? parentW : clientW > 0 ? clientW : 800;
  const containerH = parentH > 0 ? parentH : clientH > 0 ? clientH : 600;

  const initialEdgeStyle = resolveEdgeSelectionStyle(currentOptions?.language, currentOptions?.edgeSelectionStyle);
  container.setAttribute("data-edge-selection", initialEdgeStyle);
  if (!container.hasAttribute("tabindex")) {
    container.tabIndex = 0;
  }
  if (!container.getAttribute("role")) {
    container.setAttribute("role", "application");
  }
  if (!container.getAttribute("aria-label")) {
    container.setAttribute("aria-label", "Interactive engineering diagram canvas");
  }

  const g: Graph = new GraphCtor({
    container,
    width: containerW,
    height: containerH,
    preferWebGpu: currentOptions?.preferWebGpu ?? true,
    async: false,
    autoResize: true,
    background: { color: bgColor },
    grid: {
      size: 2,
      visible: true,
      type: "doubleMesh",
      args: [
        { color: "transparent", thickness: 0 },
        { color: gridColor, thickness: 1, factor: 10 },
      ],
    },
    panning: { enabled: true },
    mousewheel: { enabled: true, global: true, modifiers: "ctrl" },
    // We don't want runtime drag-to-reparent behavior.
    // Parent-child relationships are strictly defined by semantic children via addChild().
    embedding: { enabled: false },
    interacting: (cellView: { cell: { id: string; getData?: () => Record<string, unknown> | undefined } }) => {
      if (isEphemeralDiagramNode(cellView.cell.id)) {
        return false;
      }
      if (getReadOnlyForGraph(g)) {
        if (isGraphLayoutEditable(g)) {
          const cellData = cellView.cell.getData?.();
          if (cellData?.["readOnly"] || cellData?.["isInherited"]) {
            return false;
          }
          return { nodeMovable: true, edgeMovable: false, edgeLabelMovable: true };
        }
        return false;
      }
      const cellData = cellView.cell.getData?.();
      if (cellData?.["readOnly"] || cellData?.["isInherited"]) {
        return false;
      }
      return { nodeMovable: true, edgeMovable: true, edgeLabelMovable: true };
    },
    connecting: {
      router: { name: "port-orthogonal-astar" },
      connector: getActiveDefaultConnector() ??
        currentOptions?.defaultConnector ?? { name: "rounded", args: { radius: 8 } },
      snap: { radius: 24 },
      allowBlank: false,
      allowMulti: () => !getReadOnlyForGraph(g),
      allowLoop: () => !getReadOnlyForGraph(g),
      allowNode: () => !getReadOnlyForGraph(g) && (getOptionsForGraph(g)?.allowNodeConnection ?? true),
      allowEdge: () => !getReadOnlyForGraph(g) && (getOptionsForGraph(g)?.allowEdgeConnection ?? true),
      allowPort: () => !getReadOnlyForGraph(g),
      highlight: true,
      highlighting: {
        magnetAvailable: {
          name: "stroke",
          args: {
            attrs: {
              fill: "#fff",
              stroke: "#0891b2",
              strokeWidth: 3.5,
            },
          },
        },
        magnetAdsorbed: {
          name: "stroke",
          args: {
            attrs: {
              fill: "#0891b2",
              stroke: "#22d3ee",
              strokeWidth: 5,
            },
          },
        },
      },
      validateMagnet: ({ cell }: { cell?: { id: string } | null | undefined } = {}) => {
        if (getReadOnlyForGraph(g)) return false;
        if (cell && isEphemeralDiagramNode(cell.id)) return false;
        return true;
      },
      validateConnection: (
        args: {
          sourceCell?:
            | {
                id: string;
                getData?: () => Record<string, unknown> | undefined;
                getPort?: (portId: string) => Record<string, unknown> | undefined;
              }
            | null
            | undefined;
          targetCell?:
            | {
                id: string;
                getData?: () => Record<string, unknown> | undefined;
                getPort?: (portId: string) => Record<string, unknown> | undefined;
              }
            | null
            | undefined;
          sourceMagnet?: Element | null | undefined;
          targetMagnet?: Element | null | undefined;
          sourcePort?: string | null | undefined;
          targetPort?: string | null | undefined;
        } = {},
      ) => {
        const { sourceCell, targetCell, sourceMagnet, targetMagnet, sourcePort, targetPort } = args;
        if (!sourceCell || !targetCell) return false;
        const sPort = sourcePort ?? sourceMagnet?.getAttribute("port") ?? sourceMagnet?.getAttribute("port-id") ?? "";
        const tPort = targetPort ?? targetMagnet?.getAttribute("port") ?? targetMagnet?.getAttribute("port-id") ?? "";
        if (sourceCell.id === targetCell.id && (!sPort || !tPort || sPort === tPort)) {
          return false;
        }
        if (isEphemeralDiagramNode(sourceCell.id) || isEphemeralDiagramNode(targetCell.id)) return false;

        const srcData = sourceCell.getData?.() ?? {};
        const tgtData = targetCell.getData?.() ?? {};
        const srcPortMeta = sPort ? sourceCell.getPort?.(sPort) : undefined;
        const tgtPortMeta = tPort ? targetCell.getPort?.(tPort) : undefined;

        const compat = evaluateModelScriptPortCompatibility(
          {
            nodeId: sourceCell.id,
            portId: sPort || "out",
            connectorType:
              typeof srcPortMeta?.["connectorType"] === "string" ? srcPortMeta["connectorType"] : undefined,
            domain: typeof srcPortMeta?.["domain"] === "string" ? srcPortMeta["domain"] : undefined,
            direction:
              typeof srcPortMeta?.["direction"] === "string"
                ? srcPortMeta["direction"]
                : typeof srcPortMeta?.["group"] === "string"
                  ? srcPortMeta["group"]
                  : undefined,
            isConjugated: typeof srcPortMeta?.["isConjugated"] === "boolean" ? srcPortMeta["isConjugated"] : undefined,
            nodeClassName:
              typeof (srcData["properties"] as Record<string, unknown> | undefined)?.["className"] === "string"
                ? String((srcData["properties"] as Record<string, unknown>)["className"])
                : typeof srcData["className"] === "string"
                  ? srcData["className"]
                  : undefined,
            nodeLabel: typeof srcData["label"] === "string" ? srcData["label"] : undefined,
          },
          {
            nodeId: targetCell.id,
            portId: tPort || "in",
            connectorType:
              typeof tgtPortMeta?.["connectorType"] === "string" ? tgtPortMeta["connectorType"] : undefined,
            domain: typeof tgtPortMeta?.["domain"] === "string" ? tgtPortMeta["domain"] : undefined,
            direction:
              typeof tgtPortMeta?.["direction"] === "string"
                ? tgtPortMeta["direction"]
                : typeof tgtPortMeta?.["group"] === "string"
                  ? tgtPortMeta["group"]
                  : undefined,
            isConjugated: typeof tgtPortMeta?.["isConjugated"] === "boolean" ? tgtPortMeta["isConjugated"] : undefined,
            nodeClassName:
              typeof (tgtData["properties"] as Record<string, unknown> | undefined)?.["className"] === "string"
                ? String((tgtData["properties"] as Record<string, unknown>)["className"])
                : typeof tgtData["className"] === "string"
                  ? tgtData["className"]
                  : undefined,
            nodeLabel: typeof tgtData["label"] === "string" ? tgtData["label"] : undefined,
          },
          { allowSameNode: true },
        );
        return compat.compatible;
      },
      validateEdge: () => true,
      createEdge: (): ReturnType<Graph["createEdge"]> => {
        return g.createEdge({
          zIndex: 1000,
          router: { name: "port-orthogonal-astar" },
          connector: getDefaultConnectorForGraph(g) ?? { name: "rounded", args: { radius: 8 } },
          attrs: {
            line: {
              stroke: isDark ? "#569cd6" : "#005fb8",
              strokeWidth: 1.5,
              "vector-effect": "non-scaling-stroke",
              targetMarker: null,
              "pointer-events": "none",
            },
          },
        });
      },
    },
  });

  const selectionPlugin = new SelectionCtor({
    enabled: true,
    showNodeSelectionBox: true,
    showEdgeSelectionBox: false,
    rubberband: true,
    multiple: true,
    modifiers: ["ctrl", "meta", "shift"],
    multipleSelectionModifiers: ["ctrl", "meta", "shift"],
    pointerEvents: "none",
    filter: (cell: Cell) => !isEphemeralDiagramNode(cell.id),
  });
  g.use(selectionPlugin);

  // Hook into SelectionImpl to align and rotate node selection boxes
  const selectionImpl = (selectionPlugin as unknown as { selectionImpl?: Record<string, unknown> }).selectionImpl as
    | {
        container?: HTMLElement | undefined;
        createSelectionBox?: ((cell: Cell) => void) | undefined;
        repositionSelectionBoxesInPlace?: (() => void) | undefined;
      }
    | undefined;

  if (selectionImpl) {
    const origCreateSelectionBox = selectionImpl.createSelectionBox?.bind(selectionImpl);
    if (origCreateSelectionBox) {
      selectionImpl.createSelectionBox = (cell: Cell) => {
        origCreateSelectionBox(cell);
        if (cell && typeof cell.isNode === "function" && cell.isNode()) {
          const box = selectionImpl.container?.querySelector(`[data-cell-id="${cell.id}"]`) as HTMLElement | null;
          if (box) {
            alignNodeSelectionBox(box, cell as Node, g);
          }
        }
      };
    }

    const origReposition = selectionImpl.repositionSelectionBoxesInPlace?.bind(selectionImpl);
    if (origReposition) {
      selectionImpl.repositionSelectionBoxesInPlace = () => {
        origReposition();
        syncAllNodeSelectionBoxes(g, selectionImpl.container);
      };
    }
  }

  const getSelectionContainer = () => selectionImpl?.container;

  const flags: CanvasInteractionFlags = {
    isSnappingPortAlignment: false,
    isAltPressed: false,
  };

  const editing = createNodeEditingController({
    graph: g,
    container,
    isDark,
    getSelectionContainer,
    flags,
  });

  setActiveRotateSelectedNodes(editing.rotateSelectedNodes);
  setActiveFlipSelectedNodes(editing.flipSelectedNodes);

  const updateNodeBox = ({ node, cell }: { node?: Node; cell?: Cell } = {}) => {
    const n = (node || cell) as Node | undefined;
    if (!n || typeof n.isNode !== "function" || !n.isNode()) return;
    const selCont = selectionImpl?.container || g.container?.querySelector(".ms-widget-selection");
    const escId =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(n.id)
        : n.id.replace(/["\\]/g, "\\$&");
    const box = selCont?.querySelector(`[data-cell-id="${escId}"]`) as HTMLElement | null;
    if (box) {
      alignNodeSelectionBox(box, n, g);
    }
  };

  g.on("node:change:angle", updateNodeBox);
  g.on("node:rotating", () => {
    updateNodeBox();
    editing.syncAlignmentToolbar();
  });
  g.on("node:rotated", updateNodeBox);
  g.on("node:change:position", updateNodeBox);
  g.on(
    "node:change:size",
    (args: {
      node?: Node;
      cell?: Cell;
      current?: { width: number; height: number };
      previous?: { width: number; height: number };
    }) => {
      const n = (args?.node || args?.cell) as Node | undefined;
      if (n && typeof n.isNode === "function" && n.isNode() && !isEphemeralDiagramNode(n.id)) {
        const cur = args?.current ?? n.getSize();
        updateNodeVisualOnResize(n, g, cur.width, cur.height, args?.previous?.width, args?.previous?.height);
      }
      updateNodeBox(args);
    },
  );
  g.on("node:resizing", ({ node }: { node: Node }) => {
    if (node && typeof node.isNode === "function" && node.isNode() && !isEphemeralDiagramNode(node.id)) {
      updateNodeBox({ node });
    }
  });

  g.use(
    new TransformCtor({
      resizing: { enabled: (node: Node) => !isEphemeralDiagramNode(node.id) },
      rotating: { enabled: (node: Node) => !isEphemeralDiagramNode(node.id) },
    }),
  );

  const refreshSelectedEdgeTools = () => {
    const selectedEdges = (typeof g.getSelectedCells === "function" ? g.getSelectedCells() : []).filter(
      (c: Cell) => typeof c.isEdge === "function" && c.isEdge(),
    );
    const activeStyle = (container?.getAttribute("data-edge-selection") as ResolvedEdgeSelectionStyle) ?? "halo";
    selectedEdges.forEach((edge: Cell) => {
      edge.removeTools();
      edge.addTools(getEdgeToolConfig(edge, g, isDark, activeStyle));
    });
  };

  // ── Minimap HUD ──
  const minimapHud = ensureMinimapHud(
    container,
    (worldX, worldY) => {
      const graphWithCenter = g as unknown as { centerPoint?: (x: number, y: number) => void };
      if (typeof graphWithCenter.centerPoint === "function") {
        graphWithCenter.centerPoint(worldX, worldY);
      }
    },
    container?.getAttribute("data-show-minimap") === "true",
  );

  let minimapRafId: number | null = null;
  const scheduleMinimapUpdate = () => {
    if (!minimapHud || minimapHud.style.display === "none" || g.disposed) return;
    if (minimapRafId !== null) return;
    if (typeof requestAnimationFrame === "function") {
      minimapRafId = requestAnimationFrame(() => {
        minimapRafId = null;
        if (!g.disposed) updateMinimapHud(minimapHud, g);
      });
    } else {
      updateMinimapHud(minimapHud, g);
    }
  };

  // Helper to toggle connected port highlights on edge selection
  const setEdgePortHighlight = (cell: Cell, active: boolean) => {
    if (typeof (cell as Edge).getSource !== "function") return;
    const edge = cell as Edge;
    const src = edge.getSource?.();
    const tgt = edge.getTarget?.();
    const escapeAttr = (v: string) =>
      typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&");
    [src, tgt].forEach((terminal) => {
      if (!terminal?.cell || !terminal?.port) return;
      const node = g.getCellById?.(terminal.cell);
      if (!node) return;
      const view = g.findViewByCell?.(node);
      if (!view?.container) return;
      const portEl = view.container.querySelector(`[data-port="${escapeAttr(terminal.port)}"]`);
      if (portEl) {
        if (active) {
          portEl.classList.add("ms-port-edge-selected");
        } else {
          portEl.classList.remove("ms-port-edge-selected");
        }
      }
    });
  };

  // ── Selection change events — add/remove edge tools & align node selection boxes ──
  g.on("selection:changed", ({ added, removed }: { added: Cell[]; removed: Cell[] }) => {
    const activeStyle = (container?.getAttribute("data-edge-selection") as ResolvedEdgeSelectionStyle) ?? "halo";
    const escapeAttr = (v: string) =>
      typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&");
    added.forEach((cell: Cell) => {
      if (typeof cell.isEdge === "function" && cell.isEdge()) {
        cell.removeTools();
        if (!getReadOnlyForGraph(g)) {
          cell.addTools(getEdgeToolConfig(cell, g, isDark, activeStyle));
        }
        setEdgePortHighlight(cell, true);
      } else if (typeof cell.isNode === "function" && cell.isNode()) {
        const selContainer = selectionImpl?.container || g.container?.querySelector(".ms-widget-selection");
        const box = selContainer?.querySelector(`[data-cell-id="${escapeAttr(cell.id)}"]`) as HTMLElement | null;
        if (box) {
          alignNodeSelectionBox(box, cell as Node, g);
        }
      }
    });
    removed.forEach((cell: Cell) => {
      if (typeof cell.isEdge === "function" && cell.isEdge()) {
        cell.removeTools();
        setEdgePortHighlight(cell, false);
      }
    });
    editing.syncAlignmentToolbar();
  });

  // ── Viewport Level-of-Detail (LOD) & Scale/Translate Sync ──
  g.on("scale", ({ sx }: { sx: number }) => {
    syncAllNodeSelectionBoxes(g, selectionImpl?.container);
    refreshSelectedEdgeTools();
    scheduleViewportCulling(g);
    editing.syncAlignmentToolbar();
    scheduleMinimapUpdate();
    if (!container) return;
    if (sx < 0.25) {
      container.classList.add("ms-lod-minimal");
      container.classList.add("ms-lod-low");
    } else if (sx < 0.5) {
      container.classList.remove("ms-lod-minimal");
      container.classList.add("ms-lod-low");
    } else {
      container.classList.remove("ms-lod-minimal");
      container.classList.remove("ms-lod-low");
    }
  });

  g.on("translate", () => {
    syncAllNodeSelectionBoxes(g, selectionImpl?.container);
    scheduleViewportCulling(g);
    editing.syncAlignmentToolbar();
    scheduleMinimapUpdate();
  });

  g.on("node:change:position", () => {
    editing.syncAlignmentToolbar();
    scheduleMinimapUpdate();
  });

  g.on("node:change:size", () => {
    scheduleMinimapUpdate();
  });

  g.on("edge:change:vertices", () => {
    scheduleMinimapUpdate();
  });

  g.on("edge:change:source", () => {
    scheduleMinimapUpdate();
  });

  g.on("edge:change:target", () => {
    updateMinimapHud(minimapHud, g);
  });

  g.on("cell:added", () => {
    updateMinimapHud(minimapHud, g);
  });

  g.on("cell:removed", () => {
    updateMinimapHud(minimapHud, g);
  });

  // ── Modular Interaction Subsystems ──
  const placementAndWire = attachPlacementAndWireTools({
    graph: g,
    isDark,
    startInlineNodeEdit: editing.startInlineNodeEdit,
  });

  const disposeMutations = attachDiagramMutationHandlers({
    graph: g,
    container,
    flags,
    syncAlignmentToolbar: editing.syncAlignmentToolbar,
  });

  const disposeUi = attachCanvasUiHandlers({
    graph: g,
    container,
    minimapHud,
    editing,
    placementAndWire,
    flags,
    getSelectionContainer,
    onAutoLayoutFallback: (targetGraph) =>
      coreAutoLayoutDiagramAsync(targetGraph as unknown as Parameters<typeof coreAutoLayoutDiagramAsync>[0], {
        onAction: (act) => enqueueDiagramAction(act, targetGraph),
        updateSolderDots: (target) => updateSolderDots(target as unknown as Graph),
      }),
    onGroupSelected: (targetGraph) =>
      groupSelectedNodesOnGraph(targetGraph as unknown as GroupableGraphLike, {
        readOnly: getReadOnlyForGraph(targetGraph),
      }) !== null,
    onUngroupSelected: (targetGraph) =>
      ungroupSelectedNodesOnGraph(targetGraph as unknown as GroupableGraphLike, {
        readOnly: getReadOnlyForGraph(targetGraph),
      }).length > 0,
  });

  setActiveSyncAlignmentToolbar(editing.syncAlignmentToolbar);

  // Register container-scoped instance with listener cleanup
  containerInstances.set(container, {
    graph: g,
    options: currentOptions && currentOptions.container === container ? currentOptions : { container, isDark },
    selectedNodeId: null,
    rotateSelectedNodes: editing.rotateSelectedNodes,
    flipSelectedNodes: editing.flipSelectedNodes,
    syncAlignmentToolbar: editing.syncAlignmentToolbar,
    cleanupListeners: () => {
      disposeMutations();
      disposeUi();
      placementAndWire.dispose();
      editing.dispose();
      if (minimapRafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(minimapRafId);
        minimapRafId = null;
      }
      destroyMinimapHud(container);
      if (getActiveRotateSelectedNodes() === editing.rotateSelectedNodes) setActiveRotateSelectedNodes(null);
      if (getActiveFlipSelectedNodes() === editing.flipSelectedNodes) setActiveFlipSelectedNodes(null);
      if (getActiveSyncAlignmentToolbar() === editing.syncAlignmentToolbar) setActiveSyncAlignmentToolbar(null);
    },
  });

  setActiveGraph(g);
  return g;
}
