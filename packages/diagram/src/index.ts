// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Webview-side script: receives diagram data via postMessage and
// renders it using AntV X6.

import { DagreLayout } from "@antv/layout";
import { Cell, Graph, Selection, Transform } from "@antv/x6";

export interface DiagramRendererOptions {
  container: HTMLElement;
  isDark?: boolean;
  onAction?: (action: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any) => void;
  onSelect?: (id: string | null) => void;
  onShowProperties?: (
    nodeId: string,
    cachedProps?: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any,
    isLoading?: boolean,
  ) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

let currentOptions: DiagramRendererOptions | null = null;

export function setDiagramOptions(options: DiagramRendererOptions) {
  currentOptions = options;
}

function enqueueDiagramAction(action: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any) {
  if (currentOptions?.onAction) currentOptions.onAction(action);
}

function postMessageToHost(msg: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any) {
  if (msg.type === "undo" && currentOptions?.onUndo) currentOptions.onUndo();
  if (msg.type === "redo" && currentOptions?.onRedo) currentOptions.onRedo();
  if (msg.type === "getProperties" && currentOptions?.onShowProperties)
    currentOptions.onShowProperties(msg.componentName, undefined, true);
}

let graph: Graph | null = null;
let selectedNodeId: string | null = null;

/** Cache for on-demand component properties (cleared on diagram re-render) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const propertyCache = new Map<string, any>();

/** Get connected edge metadata for a node (for move/resize updates) */
function getConnectedEdges(
  g: Graph,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
): { source: string; target: string; points: { x: number; y: number }[] }[] {
  return g.getConnectedEdges(node).map((edge) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const source = edge.getSource() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = edge.getTarget() as any;
    const vertices = edge.getVertices();
    const sourcePoint = edge.getSourcePoint();
    const targetPoint = edge.getTargetPoint();
    const points = [sourcePoint, ...vertices, targetPoint].map((p) => ({
      x: Math.round(p.x),
      y: Math.round(-p.y),
    }));
    return {
      source: `${source.cell}.${source.port}`,
      target: `${target.cell}.${target.port}`,
      points,
    };
  });
}

export function initGraph(isDark: boolean): Graph {
  const container = currentOptions?.container;
  if (!container) throw new Error("DiagramRendererOptions.container must be provided");
  const placeholder = document.getElementById("placeholder");
  if (placeholder) placeholder.style.display = "none";

  const bgColor = isDark ? "#1e1e1e" : "#ffffff";
  const gridColor = isDark ? "#2f2f2f" : "#ccc";

  if (graph) {
    graph.drawBackground({ color: bgColor });
    graph.drawGrid({
      type: "doubleMesh",
      args: [
        { color: "transparent", thickness: 0 },
        { color: gridColor, thickness: 1, factor: 10 },
      ],
    });
    return graph;
  }

  const g: Graph = new Graph({
    container,
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
    interacting: (cellView) => {
      if (cellView.cell.id === "__diagram_background__") return false;
      return { nodeMovable: true, edgeMovable: true, edgeLabelMovable: true };
    },
    connecting: {
      allowBlank: false,
      allowMulti: () => true,
      allowLoop: false,
      allowNode: false,
      allowEdge: false,
      allowPort: true,
      highlight: true,
      validateMagnet: () => true,
      validateConnection: () => true,
      validateEdge: () => true,
      createEdge: (): ReturnType<Graph["createEdge"]> => {
        return g.createEdge({
          zIndex: 1000,
          router: { name: "normal" },
          attrs: {
            line: {
              stroke: "#0000ff",
              strokeWidth: 1,
              "vector-effect": "non-scaling-stroke",
              targetMarker: null,
              "pointer-events": "none",
            },
          },
        });
      },
    },
  });

  g.use(
    new Selection({
      enabled: true,
      showNodeSelectionBox: true,
      showEdgeSelectionBox: true,
      rubberband: true,
      multiple: true,
      modifiers: ["ctrl", "meta", "shift"],
      multipleSelectionModifiers: ["ctrl", "meta", "shift"],
      pointerEvents: "none",
      filter: (cell) => cell.id !== "__diagram_background__",
    }),
  );

  g.use(new Transform({ resizing: true, rotating: true }));

  // ── Selection change events — add/remove edge tools ──
  g.on("selection:changed", ({ added, removed }: { added: Cell[]; removed: Cell[] }) => {
    added.forEach((cell: Cell) => {
      if (cell.isEdge()) {
        cell.addTools([
          {
            name: "vertices",
            args: {
              attrs: {
                fill: "#666",
                stroke: "transparent",
                strokeWidth: 6,
                r: 4,
              },
              stopPropagation: false,
            },
          },
          {
            name: "segments",
            args: {
              attrs: {
                fill: "#666",
                stroke: "transparent",
                strokeWidth: 1,
                width: 10,
                height: 2,
                rx: 1,
                ry: 1,
                x: -5,
                y: -1,
              },
              stopPropagation: false,
            },
          },
        ]);
      }
    });
    removed.forEach((cell: Cell) => {
      if (cell.isEdge()) {
        cell.removeTools();
      }
    });
  });

  // ── Placement Mode (Drag and Drop in VS Code) ──
  let placementData: { className: string; classKind: string; iconSvg?: string } | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let placementGhost: any = null;

  const startPlacement = (data: { className: string; classKind: string; iconSvg?: string }) => {
    placementData = data;
    const center = g.pageToLocal(window.innerWidth / 2, window.innerHeight / 2);
    const strokeColor = isDark ? "#cccccc" : "#333333";
    const fillColor = isDark ? "rgba(204, 204, 204, 0.1)" : "rgba(51, 51, 51, 0.1)";

    if (data.iconSvg) {
      placementGhost = g.addNode({
        id: "placement-ghost",
        shape: "image",
        x: center.x - 10,
        y: center.y - 10,
        width: 20,
        height: 20,
        imageUrl: `data:image/svg+xml;utf8,${encodeURIComponent(data.iconSvg)}`,
        attrs: {
          image: {
            preserveAspectRatio: "xMidYMid meet",
            style: "pointer-events: none;",
          },
        },
      });
    } else {
      placementGhost = g.addNode({
        id: "placement-ghost",
        shape: "rect",
        x: center.x - 10,
        y: center.y - 10,
        width: 20,
        height: 20,
        attrs: {
          body: {
            fill: fillColor,
            stroke: strokeColor,
            strokeDasharray: "5 5",
            strokeWidth: 2,
            opacity: 0.5,
            pointerEvents: "none",
          },
          text: {
            text: data.className.split(".").pop(),
            fill: strokeColor,
            pointerEvents: "none",
          },
        },
      });
    }
  };

  const handlePointerMove = (x: number, y: number) => {
    if (placementGhost) {
      placementGhost.position(x - 10, y - 10);
    }
  };
  g.on("blank:pointermove", ({ x, y }: { x: number; y: number }) => handlePointerMove(x, y));
  g.on("cell:pointermove", ({ x, y }: { x: number; y: number }) => handlePointerMove(x, y));

  const handlePlacementClick = (x: number, y: number) => {
    console.log("[diagram-core] handlePlacementClick", { x, y, placementData });
    if (placementData) {
      console.log("[diagram-core] enqueuing diagram action from handlePlacementClick");
      enqueueDiagramAction({ type: "addComponent", className: placementData.className, x, y });
      if (placementGhost) {
        placementGhost.attr("image/style", "opacity: 0.5; pointer-events: none;");
        if (placementGhost.shape === "rect") {
          placementGhost.attr("body/strokeDasharray", null);
          placementGhost.attr("body/opacity", 0.5);
        }
        placementGhost = null; // Detach from mouse movement
      }
      placementData = null;
    }
  };
  g.on("blank:click", ({ x, y }: { x: number; y: number }) => handlePlacementClick(x, y));
  g.on("cell:click", ({ x, y }: { x: number; y: number }) => handlePlacementClick(x, y));

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && placementData) {
      if (placementGhost) {
        placementGhost.remove();
        placementGhost = null;
      }
      placementData = null;
    }
  });

  // Expose for webview to invoke
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__startPlacement = startPlacement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__movePlacementGhost = handlePointerMove;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__handlePlacementClick = handlePlacementClick;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__getPlacementData = () => placementData;

  // ── Diagram-to-code event handlers (matching morsel's diagram.tsx) ──

  // Node move: debounced
  const changedNodes = new Set<string>();
  let moveTimeout: ReturnType<typeof setTimeout> | null = null;
  let justResized = false;

  g.on("node:moved", ({ node }) => {
    if (node.id === "__diagram_background__") return;

    // Deselect edges when moving a node to avoid stale rubberbands
    const selected = g.getSelectedCells();
    if (selected) {
      selected.forEach((cell) => {
        if (cell.isEdge()) g.unselect(cell);
      });
    }

    changedNodes.add(node.id);

    if (moveTimeout) clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => {
      if (justResized) {
        justResized = false;
        moveTimeout = null;
        changedNodes.clear();
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = [];
      changedNodes.forEach((id) => {
        const n = g.getCellById(id);
        if (n && n.isNode()) {
          const p = n.getPosition();
          const s = n.getSize();
          const r = n.getAngle();
          const edges = getConnectedEdges(g, n);
          items.push({ name: n.id, x: p.x, y: p.y, width: s.width, height: s.height, rotation: r, edges });
        }
      });

      // Also collect positions for connected nodes that weren't moved,
      // so that missing Placement annotations can be added for them.
      const movedNames = new Set(changedNodes);
      const connectedNames = new Set<string>();
      for (const item of items) {
        if (item.edges) {
          for (const edge of item.edges) {
            const srcComp = edge.source.split(".")[0];
            const tgtComp = edge.target.split(".")[0];
            if (!movedNames.has(srcComp)) connectedNames.add(srcComp);
            if (!movedNames.has(tgtComp)) connectedNames.add(tgtComp);
          }
        }
      }
      connectedNames.forEach((id) => {
        const n = g.getCellById(id);
        if (n && n.isNode()) {
          const p = n.getPosition();
          const s = n.getSize();
          const r = n.getAngle();
          items.push({
            name: n.id,
            x: p.x,
            y: p.y,
            width: s.width,
            height: s.height,
            rotation: r,
            connectedOnly: true,
          });
        }
      });

      if (items.length > 0) {
        enqueueDiagramAction({ type: "move", items });
      }
      changedNodes.clear();
      moveTimeout = null;
    }, 5);
  });

  // Node rotated
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  g.on("node:rotated", ({ node }: any) => {
    const p = node.getPosition();
    const s = node.getSize();
    const r = node.getAngle();
    const edges = getConnectedEdges(g, node);
    enqueueDiagramAction({
      type: "move",
      items: [{ name: node.id, x: p.x, y: p.y, width: s.width, height: s.height, rotation: r, edges }],
    });
  });

  // We don't shrink/fit parents during drag to preserve Dagre layout spacings.

  // Node resized
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  g.on("node:resized", ({ node }: any) => {
    if (moveTimeout) {
      clearTimeout(moveTimeout);
      moveTimeout = null;
    }
    justResized = true;
    setTimeout(() => {
      justResized = false;
    }, 200);

    const p = node.getPosition();
    const s = node.getSize();
    const r = node.getAngle();
    const edges = getConnectedEdges(g, node);
    enqueueDiagramAction({
      type: "resize",
      item: {
        name: node.id,
        x: p.x,
        y: p.y,
        width: s.width,
        height: s.height,
        rotation: r,
        edges,
      },
    });
  });

  // Edge connected (new edge created)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  g.on("edge:connected", ({ isNew, edge }: any) => {
    if (!isNew) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const source = edge.getSource() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = edge.getTarget() as any;
    if (source.cell && source.port && target.cell && target.port) {
      const vertices = edge.getVertices();
      const sourcePoint = edge.getSourcePoint();
      const targetPoint = edge.getTargetPoint();
      const points = [sourcePoint, ...vertices, targetPoint].map((p: { x: number; y: number }) => ({
        x: Math.round(p.x),
        y: Math.round(-p.y),
      }));
      enqueueDiagramAction({
        type: "connect",
        source: `${source.cell}.${source.port}`,
        target: `${target.cell}.${target.port}`,
        points,
      });
    }
  });

  // Edge vertices changed: debounced
  let edgeUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
  g.on("edge:change:vertices", ({ edge }) => {
    if (edgeUpdateTimeout) clearTimeout(edgeUpdateTimeout);
    edgeUpdateTimeout = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const source = edge.getSource() as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const target = edge.getTarget() as any;
      if (source.cell && source.port && target.cell && target.port) {
        const vertices = edge.getVertices();
        const sourcePoint = edge.getSourcePoint();
        const targetPoint = edge.getTargetPoint();
        const points = [sourcePoint, ...vertices, targetPoint].map((p) => ({
          x: Math.round(p.x),
          y: Math.round(-p.y),
        }));
        enqueueDiagramAction({
          type: "moveEdge",
          edges: [
            {
              source: `${source.cell}.${source.port}`,
              target: `${target.cell}.${target.port}`,
              points,
            },
          ],
        });
      }
      edgeUpdateTimeout = null;
    }, 500);
  });

  // Delete key: delete selected edges/components
  document.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      // Do not trigger deletion if the user is typing in an input or textarea
      const activeTag = document.activeElement?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") {
        return;
      }

      const cells = g.getSelectedCells();
      if (cells.length === 0) return;

      // Separate edges and nodes
      const edgesToDelete: { source: string; target: string }[] = [];
      const componentNames: string[] = [];

      cells.forEach((cell) => {
        if (cell.isEdge()) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const source = cell.getSource() as any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const target = cell.getTarget() as any;
          if (source.cell && source.port && target.cell && target.port) {
            edgesToDelete.push({
              source: `${source.cell}.${source.port}`,
              target: `${target.cell}.${target.port}`,
            });
          }
        } else if (cell.isNode() && cell.id !== "__diagram_background__") {
          componentNames.push(cell.id);
        }
      });

      if (edgesToDelete.length > 0) {
        for (const edge of edgesToDelete) {
          enqueueDiagramAction({ type: "disconnect", ...edge });
        }
      }
      if (componentNames.length > 0) {
        enqueueDiagramAction({ type: "deleteComponents", names: componentNames });
      }
      g.removeCells(cells);
    } else {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const spinner = document.getElementById("spinner");
        if (spinner) spinner.style.display = "block";
        if (e.shiftKey) {
          postMessageToHost({ type: "redo" });
        } else {
          postMessageToHost({ type: "undo" });
        }
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        const spinner = document.getElementById("spinner");
        if (spinner) spinner.style.display = "block";
        postMessageToHost({ type: "redo" });
      }
    }
  });

  g.on("node:click", ({ node }) => {
    if (!graph) return;
    selectedNodeId = node.id;
    const data = node.getData();

    // Show properties panel immediately with lightweight data, then request full properties
    const cachedProps = propertyCache.get(node.id);
    if (cachedProps) {
      showProperties({ id: node.id, properties: cachedProps });
    } else {
      // Show panel with lightweight data (className, name, description) + loading indicator
      showProperties({ id: node.id, properties: data?.properties, isLoading: true });
      // Request full properties from host on-demand
      postMessageToHost({ type: "getProperties", componentName: node.id });
    }

    // Smoothly pan to center the node horizontally in the visible portion
    const bbox = node.getBBox();
    const scale = g.scale().sx;
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;

    // Panel width is roughly 300px, so we offset by 300
    const paddingRight = 300;
    const containerRect = g.container.getBoundingClientRect();
    const visibleWidth = containerRect.width - paddingRight;

    // Calculate target translation
    const targetTx = visibleWidth / 2 - cx * scale;
    const targetTy = containerRect.height / 2 - cy * scale;

    const { tx: ctx, ty: cty } = g.translate();
    const duration = 250;
    const startTime = performance.now();

    const animate = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3); // cubic ease-out
      g.translate(ctx + (targetTx - ctx) * ease, cty + (targetTy - cty) * ease);
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  });

  g.on("blank:click", () => {
    selectedNodeId = null;
    if (currentOptions?.onSelect) currentOptions.onSelect(null);
  });

  // Placement logic removed from core renderer

  graph = g;
  return g;
}

export function renderDiagram(data: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any, isDark: boolean) {
  const g = initGraph(isDark);

  // Build nodes from diagram data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edges: any[] = [];

  for (const node of data.nodes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeData: any = {
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      angle: node.angle,
      zIndex: node.zIndex,
      opacity: node.opacity,
      markup: node.markup,
      ports: node.ports,
      data: { properties: node.properties },
      autoLayout: node.autoLayout,
    };
    // Forward polyglot X6 attrs and shape (selector-based rendering)
    if (node.attrs) nodeData.attrs = node.attrs;
    if (node.shape) nodeData.shape = node.shape;
    if (node.parent) nodeData.parent = node.parent;
    nodes.push(nodeData);
  }

  for (const edge of data.edges) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edgeData: any = {
      id: edge.id,
      shape: edge.shape ?? "edge",
      zIndex: edge.zIndex,
      source: edge.source,
      target: edge.target,
      vertices: edge.vertices,
      connector: edge.connector,
      router: edge.router ?? { name: "normal" },
    };
    // Polyglot edges pass attrs as a full selector-keyed object;
    // Modelica edges have attrs.line specifically
    if (edge.attrs?.line) {
      edgeData.attrs = { "z-index": "-10", line: edge.attrs.line };
    } else if (edge.attrs) {
      edgeData.attrs = edge.attrs;
    }
    // Forward labels (polyglot edge stereotypes like «connect», «satisfy»)
    if (edge.labels) edgeData.labels = edge.labels;
    edges.push(edgeData);
  }

  // Add diagram background if present
  if (data.coordinateSystem) {
    const cs = data.coordinateSystem;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children: any[] = [
      {
        tagName: "rect",
        attrs: {
          style: "fill: transparent; stroke: #999; stroke-width: 1px; vector-effect: non-scaling-stroke;",
          width: cs.width,
          height: cs.height,
        },
      },
    ];
    if (data.diagramBackground) {
      children.push(data.diagramBackground);
    }
    nodes.push({
      id: "__diagram_background__",
      x: cs.x,
      y: cs.y,
      width: cs.width,
      height: cs.height,
      zIndex: -1,
      markup: {
        tagName: "svg",
        children,
        attrs: {
          preserveAspectRatio: "none",
          width: cs.width,
          height: cs.height,
          style: "overflow: visible",
        },
      },
    });
  }

  // Add axes node
  if (data.coordinateSystem) {
    nodes.push({
      id: "__diagram_axes__",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      zIndex: -2,
      markup: {
        tagName: "g",
        children: [
          {
            tagName: "line",
            attrs: {
              x1: "-100000",
              y1: "0",
              x2: "100000",
              y2: "0",
              stroke: "#999",
              "stroke-width": "1",
              "vector-effect": "non-scaling-stroke",
            },
          },
          {
            tagName: "line",
            attrs: {
              x1: "0",
              y1: "-100000",
              x2: "0",
              y2: "100000",
              stroke: "#999",
              "stroke-width": "1",
              "vector-effect": "non-scaling-stroke",
            },
          },
        ],
      },
    });
  }

  const cs = data.coordinateSystem;
  const isFirstRender = g.getCells().length === 0;

  // Clear property cache on re-render (model state may have changed)
  propertyCache.clear();

  // ── Layout Strategy ──
  // The layout runs in 3 phases:
  //   Phase 1: Sub-Dagre for each container to compute actual child bounding boxes
  //   Phase 2: Top-level Dagre with expanded container sizes
  //   Phase 3: Reposition children relative to final parent positions

  const PAD = { top: 60, left: 40, right: 40, bottom: 40 };

  // Build parent → children map from the node data
  const parentChildMap = new Map<string, typeof nodes>();
  for (const node of nodes) {
    if (node.parent) {
      const list = parentChildMap.get(node.parent) ?? [];
      list.push(node);
      parentChildMap.set(node.parent, list);
    }
  }

  // ── Phase 1: Sub-Dagre layout for children inside each group container ──
  // This computes the bounding box for each container and expands the parent
  // node dimensions BEFORE the top-level layout runs.
  // We store relative offsets so we can reposition after Phase 2.
  const childRelativePositions = new Map<string, { dx: number; dy: number }>();

  for (const [parentId, childNodes] of parentChildMap) {
    const parentNode = nodes.find((n) => n.id === parentId);
    if (!parentNode) continue;

    const childIds = new Set(childNodes.map((c) => c.id));

    const subDagre = new DagreLayout({
      type: "dagre",
      rankdir: "TB",
      align: "UL",
      ranksep: 40,
      nodesep: 40,
      begin: [0, 0],
      controlPoints: true,
    });

    const subEdges = edges
      .filter((e) => {
        const s = typeof e.source === "string" ? e.source : (e.source.cell as string);
        const t = typeof e.target === "string" ? e.target : (e.target.cell as string);
        return childIds.has(s) && childIds.has(t);
      })
      .map((e) => ({
        source: typeof e.source === "string" ? e.source : (e.source.cell as string),
        target: typeof e.target === "string" ? e.target : (e.target.cell as string),
      }));

    // Inject fake edges to wrap isolated nodes into 2 rows for a compact layout
    const connectedSub = new Set<string>();
    subEdges.forEach((e) => {
      connectedSub.add(e.source);
      connectedSub.add(e.target);
    });
    const isolatedSub = childNodes.filter((n) => !connectedSub.has(n.id)).map((n) => n.id);
    if (isolatedSub.length > 2) {
      const cols = Math.ceil(Math.sqrt(isolatedSub.length));
      for (let i = 0; i < isolatedSub.length - cols; i++) {
        subEdges.push({ source: isolatedSub[i], target: isolatedSub[i + cols] });
      }
    }

    const subModel = {
      nodes: childNodes.map((c) => ({
        id: c.id,
        width: c.width,
        height: c.height,
        size: [c.width || 220, c.height || 50],
      })),
      edges: subEdges,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subResult = subDagre.layout(subModel as any);

    let minX = Infinity;
    let minY = Infinity;
    const layoutCoords = new Map<string, { leftX: number; topY: number }>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subResult.nodes?.forEach((laid: any) => {
      const childNode = childNodes.find((c) => c.id === laid.id);
      if (childNode) {
        // Dagre returns coordinates of the center of the node. Convert to top-left for X6.
        const leftX = laid.x - childNode.width / 2;
        const topY = laid.y - childNode.height / 2;
        minX = Math.min(minX, leftX);
        minY = Math.min(minY, topY);
        layoutCoords.set(childNode.id, { leftX, topY });
      }
    });

    let maxRight = 0;
    let maxBottom = 0;

    for (const childNode of childNodes) {
      const coords = layoutCoords.get(childNode.id);
      if (coords) {
        // Normalize against minX/minY so children start exactly inside PAD, handling negative Dagre bounds
        const dx = PAD.left + (coords.leftX - minX);
        const dy = PAD.top + (coords.topY - minY);
        childRelativePositions.set(childNode.id, { dx, dy });
        maxRight = Math.max(maxRight, dx + childNode.width + PAD.right);
        maxBottom = Math.max(maxBottom, dy + childNode.height + PAD.bottom);
      }
    }

    // Expand parent to fit children
    parentNode.width = Math.max(maxRight, 220);
    parentNode.height = Math.max(maxBottom, 80);
  }

  // ── Phase 2: Top-level Dagre layout with expanded container sizes ──
  const nodesToLayout: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes.forEach((node: any) => {
    if (node.autoLayout && !node.parent) {
      nodesToLayout.push(node.id ?? "");
    }
  });

  if (nodesToLayout.length > 0) {
    const dagreLayout = new DagreLayout({
      type: "dagre",
      rankdir: "TB",
      align: "UL",
      ranksep: 60,
      nodesep: 60,
      begin: [20, 20],
      controlPoints: true,
    });

    const modelEdges = edges
      .filter((e) => {
        const s = typeof e.source === "string" ? e.source : (e.source.cell as string);
        const t = typeof e.target === "string" ? e.target : (e.target.cell as string);
        return nodesToLayout.includes(s) && nodesToLayout.includes(t);
      })
      .map((e) => ({
        source: typeof e.source === "string" ? e.source : (e.source.cell as string),
        target: typeof e.target === "string" ? e.target : (e.target.cell as string),
      }));

    // Inject fake edges to wrap isolated top-level packages into 2 rows
    const connectedTop = new Set<string>();
    modelEdges.forEach((e) => {
      connectedTop.add(e.source);
      connectedTop.add(e.target);
    });
    const isolatedTop = nodes
      .filter((n) => nodesToLayout.includes(n.id ?? ""))
      .filter((n) => !connectedTop.has(n.id ?? ""))
      .map((n) => n.id ?? "");
    if (isolatedTop.length > 2) {
      const cols = Math.ceil(Math.sqrt(isolatedTop.length));
      for (let i = 0; i < isolatedTop.length - cols; i++) {
        modelEdges.push({ source: isolatedTop[i], target: isolatedTop[i + cols] });
      }
    }

    const model = {
      nodes: nodes
        .filter((n) => nodesToLayout.includes(n.id ?? ""))
        .map((n) => ({
          ...n,
          size: [n.width || 220, n.height || 100],
        })),
      edges: modelEdges,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newModel = dagreLayout.layout(model as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    newModel.nodes?.forEach((n: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const node = nodes.find((no: any) => no.id === n.id);
      if (node) {
        node.x = n.x - (node.width ?? 0) / 2;
        node.y = n.y - (node.height ?? 0) / 2;
      }
    });
  }

  // ── Phase 3: Reposition children relative to final parent positions ──
  for (const [parentId, childNodes] of parentChildMap) {
    const parentNode = nodes.find((n) => n.id === parentId);
    if (!parentNode) continue;

    for (const child of childNodes) {
      const rel = childRelativePositions.get(child.id);
      if (rel) {
        child.x = parentNode.x + rel.dx;
        child.y = parentNode.y + rel.dy;
      }
    }
  }

  // X6's fromJSON has a bug where it only partially wires up parent/child
  // relationships when fed raw JSON (it sets the parent pointer on the child,
  // but fails to populate the children array on the parent).
  // This breaks dragging and embedding completely.

  // 1. Stash the relationships and clean the JSON
  const relations = new Map<string, string>(); // child id -> parent id
  for (const n of nodes) {
    if (n.parent) {
      relations.set(n.id, n.parent);
      delete n.parent;
    }
    if (n.children) {
      delete n.children;
    }
  }

  // 2. Load the flat graph
  g.fromJSON({ nodes, edges });

  // 3. Programmatically establish all embedding relationships via standard API
  for (const [childId, parentId] of relations) {
    const parentCell = g.getCellById(parentId);
    const childCell = g.getCellById(childId);
    if (parentCell && childCell && parentCell.isNode() && childCell.isNode()) {
      parentCell.addChild(childCell);
    }
  }

  // Only fit view on first render — preserve zoom/pan on subsequent updates
  if (cs && isFirstRender) {
    const expandedRect = {
      x: cs.x - cs.width * 0.125,
      y: cs.y - cs.height * 0.125,
      width: cs.width * 1.25,
      height: cs.height * 1.25,
    };
    g.zoomToRect(expandedRect);
  }

  // Restore property panel for previously selected node after re-render
  if (selectedNodeId) {
    const restoredNode = g.getCellById(selectedNodeId);
    if (restoredNode && restoredNode.isNode()) {
      const data = restoredNode.getData();
      // Show panel with lightweight data and re-request full properties
      showProperties({ id: restoredNode.id, properties: data?.properties, isLoading: true });
      postMessageToHost({ type: "getProperties", componentName: restoredNode.id });
    }
  }

  updateSolderDots(g);
}

// Handle deferred diagram updates to avoid interrupting active interactions
let isMouseDown = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pendingDiagramData: any = null;

document.addEventListener(
  "mousedown",
  () => {
    isMouseDown = true;
  },
  true,
);

document.addEventListener(
  "mouseup",
  () => {
    isMouseDown = false;
    setTimeout(() => {
      if (!isMouseDown && pendingDiagramData) {
        const pd = pendingDiagramData;
        pendingDiagramData = null;
        const spinner = document.getElementById("spinner");
        if (pd.data?.isLoading && spinner) {
          spinner.style.display = "block";
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            renderDiagram(pd.data, pd.isDark);
            if (!pd.data?.isLoading && spinner) {
              spinner.style.display = "none";
            }
          });
        });
      }
    }, 0);
  },
  true,
);

// Initialize Diagram Type Select
const diagramSelect = document.getElementById("diagramTypeSelect") as HTMLSelectElement;
if (diagramSelect) {
  diagramSelect.addEventListener("change", (e) => {
    const spinner = document.getElementById("spinner");
    if (spinner) spinner.style.display = "block";
    postMessageToHost({ type: "changeDiagramType", diagramType: (e.target as HTMLSelectElement).value });
  });
}

// Listen for messages from the extension host
window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data;
  switch (message.type) {
    case "loading": {
      const spinner = document.getElementById("spinner");
      if (spinner) spinner.style.display = "block";
      break;
    }
    case "stopLoading": {
      const spinner = document.getElementById("spinner");
      if (spinner) spinner.style.display = "none";
      break;
    }
    case "diagramData": {
      if (isMouseDown) {
        pendingDiagramData = { data: message.data, isDark: message.isDark ?? true };
      } else {
        const spinner = document.getElementById("spinner");
        if (message.data?.isLoading && spinner) {
          spinner.style.display = "block";
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            renderDiagram(message.data, message.isDark ?? true);
            if (!message.data?.isLoading && spinner) {
              spinner.style.display = "none";
            }
          });
        });
      }
      break;
    }
    case "startPlacement": {
      if (!graph) return;
      const { className, classKind, iconSvg } = message;
      if (!className) break;
      // Calls the startPlacement function defined inside initGraph
      // which creates the ghost cursor and enters placement mode
      (
        window as { __startPlacement?: (d: { className: string; classKind: string; iconSvg?: string }) => void }
      ).__startPlacement?.({ className, classKind, iconSvg });
      break;
    }
    case "empty": {
      const spinner = document.getElementById("spinner");
      if (spinner) spinner.style.display = "none";
      const placeholder = document.getElementById("placeholder");
      if (placeholder) {
        placeholder.style.display = "flex";
        placeholder.textContent = "No diagram data available for this model";
      }
      if (graph) {
        graph.clearCells();
      }
      break;
    }

    case "autoLayout": {
      if (!graph) return;
      const nodes = graph.getNodes();
      const edges = graph.getEdges();

      const dagreLayout = new DagreLayout({
        type: "dagre",
        rankdir: "LR",
        align: "UL",
        ranksep: 100,
        nodesep: 100,
        begin: [-10, -10],
        controlPoints: true,
      });

      const model = {
        nodes: nodes.map((n) => ({
          id: n.id,
          width: n.getSize().width,
          height: n.getSize().height,
        })),
        edges: edges.map((e) => ({
          source: e.getSourceCellId(),
          target: e.getTargetCellId(),
        })),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newModel = dagreLayout.layout(model as any);
      const g = graph;

      g.batchUpdate("layout", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        newModel.nodes?.forEach((n: any) => {
          const node = g.getCellById(n.id);
          if (node && node.isNode()) {
            node.setPosition(n.x, n.y);
          }
        });
      });

      // Let X6 handle bounds rescaling securely over position callbacks
      setTimeout(() => {
        if (graph) {
          graph.zoomToFit({ padding: 20 });
          graph.centerContent();
        }
      }, 100);
      break;
    }

    case "error": {
      const spinner = document.getElementById("spinner");
      if (spinner) spinner.style.display = "none";
      const placeholder2 = document.getElementById("placeholder");
      if (placeholder2) {
        placeholder2.style.display = "flex";
        placeholder2.textContent = `Error: ${message.message}`;
      }
      break;
    }

    case "componentProperties": {
      // On-demand property response: update the properties panel with full data
      const { componentName, properties: fullProps } = message;
      if (fullProps) {
        propertyCache.set(componentName, fullProps);
        // Only update if this component is still selected
        if (selectedNodeId === componentName) {
          showProperties({ id: componentName, properties: fullProps });
        }
      }
      break;
    }
  }
});

// ── Property Panel Rendering ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function showProperties(nodeData: any) {
  if (currentOptions?.onShowProperties) {
    currentOptions.onShowProperties(nodeData.id, nodeData.properties, nodeData.isLoading);
  }
}

export function updateSolderDots(g: Graph) {
  const edges = g.getEdges();
  const allPaths: { id: string; points: { x: number; y: number }[]; color: string }[] = [];
  const candidateVertices = new Map<string, { x: number; y: number; pathId: string; color: string }>();

  for (const edge of edges) {
    const source = edge.getSourcePoint();
    const target = edge.getTargetPoint();
    if (!source || !target) continue;

    const vertices = edge.getVertices() || [];
    const points = [source, ...vertices, target];

    const stroke = edge.attr("line/stroke") as string | undefined;
    const color = stroke && stroke !== "none" ? stroke : "blue";
    allPaths.push({ id: edge.id, points, color });

    for (const v of points) {
      const key = `${v.x.toFixed(1)},${v.y.toFixed(1)}`;
      candidateVertices.set(key, { x: v.x, y: v.y, pathId: edge.id, color });
    }
  }

  const solderDots: { x: number; y: number; color: string; path1: string; path2: string }[] = [];

  for (const candidate of candidateVertices.values()) {
    let isJunction = false;
    let intersectingPathId = "";
    for (const path of allPaths) {
      if (path.id === candidate.pathId) continue;
      for (let k = 0; k < path.points.length - 1; k++) {
        const p1 = path.points[k];
        const p2 = path.points[k + 1];
        if (distToSegmentSquared(candidate.x, candidate.y, p1.x, p1.y, p2.x, p2.y) < 1.0) {
          isJunction = true;
          intersectingPathId = path.id;
          break;
        }
      }
      if (isJunction) break;
    }
    if (isJunction) {
      solderDots.push({ ...candidate, path1: candidate.pathId, path2: intersectingPathId });
    }
  }

  const existingDots = g.getNodes().filter((n) => n.id.startsWith("solder_dot_"));
  const existingIds = new Set(existingDots.map((n) => n.id));

  const newIds = new Set<string>();
  for (const dot of solderDots) {
    const ids = [dot.path1, dot.path2].sort();
    const id = `solder_dot_${ids[0]}_${ids[1]}`;
    newIds.add(id);

    const existing = g.getCellById(id);
    if (existing && existing.isNode()) {
      if (existing.getPosition().x !== dot.x - 0.75 || existing.getPosition().y !== dot.y - 0.75) {
        existing.setPosition(dot.x - 0.75, dot.y - 0.75);
      }
    } else {
      g.addNode({
        id,
        shape: "circle",
        x: dot.x - 0.75,
        y: dot.y - 0.75,
        width: 1.5,
        height: 1.5,
        zIndex: 20,
        attrs: {
          body: {
            fill: dot.color,
            stroke: "none",
          },
        },
      });
    }
  }

  for (const oldId of existingIds) {
    if (!newIds.has(oldId)) {
      const cell = g.getCellById(oldId);
      if (cell) g.removeCell(cell);
    }
  }

  if (typeof window !== "undefined") {
    (window as /* eslint-disable-line @typescript-eslint/no-explicit-any */ any).debugSolderDotsInfo =
      `Edges: ${edges.length}, Paths: ${allPaths.length}, Candidates: ${candidateVertices.size}, Dots: ${solderDots.length}`;
  }
}

function distToSegmentSquared(px: number, py: number, vx: number, vy: number, wx: number, wy: number) {
  const l2 = (wx - vx) * (wx - vx) + (wy - vy) * (wy - vy);
  if (l2 === 0) return (px - vx) * (px - vx) + (py - vy) * (py - vy);
  let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = vx + t * (wx - vx);
  const projY = vy + t * (wy - vy);
  return (px - projX) * (px - projX) + (py - projY) * (py - projY);
}

export function disposeDiagram() {
  if (graph) {
    graph.dispose();
    graph = null;
  }
  currentOptions = null;
}

export function dropComponentGhost(
  g: Graph,
  x: number,
  y: number,
  className: string,
  iconSvg?: string | null,
  isDark?: boolean,
) {
  const strokeColor = isDark ? "#cccccc" : "#333333";
  const fillColor = isDark ? "rgba(204, 204, 204, 0.1)" : "rgba(51, 51, 51, 0.1)";

  // Remove any previous placeholder
  const existing = g.getCellById("__drop_placeholder__");
  if (existing) g.removeCell(existing);

  if (iconSvg) {
    g.addNode({
      id: "__drop_placeholder__",
      shape: "image",
      x: x - 10,
      y: y - 10,
      width: 20,
      height: 20,
      imageUrl: `data:image/svg+xml;utf8,${encodeURIComponent(iconSvg)}`,
      attrs: {
        image: {
          preserveAspectRatio: "xMidYMid meet",
          style:
            "pointer-events: none; animation: drop-placeholder-pulse 1.2s ease-in-out infinite, drop-placeholder-appear 0.2s ease-out;",
        },
      },
    });
  } else {
    g.addNode({
      id: "__drop_placeholder__",
      shape: "rect",
      x: x - 10,
      y: y - 10,
      width: 20,
      height: 20,
      attrs: {
        body: {
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: 2,
          pointerEvents: "none",
          style: "animation: drop-placeholder-pulse 1.2s ease-in-out infinite, drop-placeholder-appear 0.2s ease-out;",
        },
        text: {
          text: className.split(".").pop(),
          fill: strokeColor,
          pointerEvents: "none",
        },
      },
    });
  }
}
