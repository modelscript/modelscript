// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Webview-side script: receives diagram data via postMessage and
// renders it using AntV X6.

import { DagreLayout } from "@antv/layout";
import { Cell, Graph, Selection, Transform } from "@antv/x6";

// Add global binding for close button
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("properties-close")?.addEventListener("click", () => {
    document.getElementById("properties-panel")?.classList.remove("open");
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.() ?? {
  postMessage() {
    /* noop fallback */
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function postMessageToHost(msg: any) {
  pendingDiagramData = null;
  vscode.postMessage(msg);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pendingDiagramActions: any[] = [];
let diagramActionTimer: ReturnType<typeof setTimeout> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function enqueueDiagramAction(action: any) {
  pendingDiagramData = null;
  pendingDiagramActions.push(action);
  if (diagramActionTimer) clearTimeout(diagramActionTimer);

  const isSpatial = ["move", "resize", "rotate", "moveEdge"].includes(action.type);
  const delay = isSpatial ? 200 : 0;

  diagramActionTimer = setTimeout(() => {
    const actions = pendingDiagramActions;
    pendingDiagramActions = [];
    diagramActionTimer = null;
    if (actions.length > 0) {
      vscode.postMessage({ type: "diagramEdit", actions });
    }
  }, delay);
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

function initGraph(isDark: boolean): Graph {
  const container = document.getElementById("container");
  if (!container) return graph ?? new Graph({ container: document.body });
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

  // ── Diagram-to-code event handlers (matching morsel's diagram.tsx) ──

  // Node move: debounced
  const changedNodes = new Set<string>();
  let moveTimeout: ReturnType<typeof setTimeout> | null = null;
  let justResized = false;

  g.on("node:change:position", ({ node }) => {
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
    }, 200);
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
      vscode.postMessage({ type: "getProperties", componentName: node.id });
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
    document.getElementById("properties-panel")?.classList.remove("open");
  });

  // ── Placement mode: postMessage-based drag from VS Code TreeView ──
  // VS Code webviews run in sandboxed iframes that block HTML5 DnD events.
  // The extension host posts "startPlacement" when a tree drag starts.
  // We continuously track the mouse position so that when the async message
  // arrives, we can place the component instantly — no extra movement needed.
  let placementData: { className: string; classKind: string; iconSvg?: string } | null = null;

  // Place on first mousemove after drag ends
  window.addEventListener("mousemove", (e) => {
    // If we're in pending placement mode, place immediately
    if (placementData) {
      placeComponent(e.clientX, e.clientY);
    }
  });

  function placeComponent(clientX: number, clientY: number) {
    if (!placementData || !graph) return;
    const data = placementData;
    placementData = null;

    const p = g.clientToLocal(clientX, clientY);

    // Show animated placeholder node if icon available
    if (data.iconSvg) {
      const size = 24;
      const isDark =
        document.documentElement.classList.contains("vscode-dark") ||
        document.documentElement.classList.contains("vscode-high-contrast");
      const filterStyle = isDark ? "filter: invert(0.85) hue-rotate(180deg);" : "";
      const fittedSvg = data.iconSvg.replace(/^<svg/, `<svg width="${size}" height="${size}" style="overflow:visible"`);

      const existing = g.getCellById("__drop_placeholder__");
      if (existing) g.removeCell(existing);

      g.addNode({
        id: "__drop_placeholder__",
        x: p.x - size / 2,
        y: p.y - size / 2,
        width: size,
        height: size,
        zIndex: 10,
        markup: {
          tagName: "foreignObject",
          attrs: { width: size, height: size, style: "overflow:visible" },
          children: [
            {
              ns: "http://www.w3.org/1999/xhtml",
              tagName: "div",
              attrs: {
                style: `width:${size}px;height:${size}px;overflow:visible;${filterStyle}animation:drop-placeholder-pulse 1.2s ease-in-out infinite, drop-placeholder-appear 0.2s ease-out;`,
              },
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      });

      requestAnimationFrame(() => {
        const placeholderNode = g.getCellById("__drop_placeholder__");
        if (placeholderNode) {
          const view = g.findView(placeholderNode);
          if (view) {
            const div = view.container.querySelector("div");
            if (div) div.innerHTML = fittedSvg;
          }
        }
      });
    }

    enqueueDiagramAction({
      type: "addComponent",
      className: data.className,
      x: Math.round(p.x),
      y: Math.round(p.y),
    });
  }

  function startPlacement(data: { className: string; classKind: string; iconSvg?: string }) {
    // Just store the data — the first mousemove after the native drag ends
    // will trigger placeComponent with the correct cursor position.
    // We cannot place immediately because during a native VS Code drag,
    // mousemove events don't reach the webview iframe, so lastMouseX/Y is stale.
    placementData = data;
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && placementData) {
      placementData = null;
    }
  });

  // Expose startPlacement so the webview message handler can invoke it
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__startPlacement = startPlacement;

  graph = g;
  return g;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderDiagram(data: any, isDark: boolean) {
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
  if (data.diagramBackground && data.coordinateSystem) {
    const cs = data.coordinateSystem;
    nodes.push({
      id: "__diagram_background__",
      x: cs.x,
      y: cs.y,
      width: cs.width,
      height: cs.height,
      zIndex: -1,
      markup: {
        tagName: "svg",
        children: [
          {
            tagName: "rect",
            attrs: {
              style: "fill: transparent; stroke: none",
              width: cs.width,
              height: cs.height,
            },
          },
          data.diagramBackground,
        ],
        attrs: {
          preserveAspectRatio: "none",
          width: cs.width,
          height: cs.height,
          style: "overflow: visible",
        },
      },
    });
  }

  // Render to graph
  const cs = data.coordinateSystem;

  let xAxis = document.getElementById("x-axis") as unknown as SVGLineElement | null;
  if (!xAxis) {
    xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    xAxis.setAttribute("id", "x-axis");
    xAxis.setAttribute("stroke", "#999");
    xAxis.setAttribute("stroke-width", "1");
    xAxis.setAttribute("vector-effect", "non-scaling-stroke");
    xAxis.setAttribute("z-index", "2");
    g.view.viewport.insertBefore(xAxis, g.view.viewport.firstChild);
  }
  if (xAxis) {
    xAxis.setAttribute("x1", "-100000");
    xAxis.setAttribute("y1", "0");
    xAxis.setAttribute("x2", "100000");
    xAxis.setAttribute("y2", "0");
  }

  let yAxis = document.getElementById("y-axis") as unknown as SVGLineElement | null;
  if (!yAxis) {
    yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    yAxis.setAttribute("id", "y-axis");
    yAxis.setAttribute("stroke", "#999");
    yAxis.setAttribute("stroke-width", "1");
    yAxis.setAttribute("vector-effect", "non-scaling-stroke");
    yAxis.setAttribute("z-index", "2");
    g.view.viewport.insertBefore(yAxis, g.view.viewport.firstChild);
  }
  if (yAxis) {
    yAxis.setAttribute("x1", "0");
    yAxis.setAttribute("y1", "-100000");
    yAxis.setAttribute("x2", "0");
    yAxis.setAttribute("y2", "100000");
  }

  let coordinateSystem = document.getElementById("coordinateSystem") as unknown as SVGRectElement | null;
  if (!coordinateSystem) {
    coordinateSystem = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    coordinateSystem.setAttribute("id", "coordinateSystem");
    coordinateSystem.setAttribute("fill", "none");
    coordinateSystem.setAttribute("stroke", "#999");
    coordinateSystem.setAttribute("stroke-width", "1");
    coordinateSystem.setAttribute("vector-effect", "non-scaling-stroke");
    coordinateSystem.setAttribute("z-index", "1");
    g.view.viewport.insertBefore(coordinateSystem, g.view.viewport.firstChild);
  }
  if (cs && coordinateSystem) {
    coordinateSystem.setAttribute("x", String(cs.x));
    coordinateSystem.setAttribute("y", String(cs.y));
    coordinateSystem.setAttribute("width", String(cs.width));
    coordinateSystem.setAttribute("height", String(cs.height));
  }

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
      vscode.postMessage({ type: "getProperties", componentName: restoredNode.id });
    }
  }
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
  const panel = document.getElementById("properties-panel");
  const content = document.getElementById("properties-content");
  const title = document.getElementById("properties-title");
  if (!panel || !content || !title) return;

  const props = nodeData.properties;
  const isLoading = nodeData.isLoading === true;
  title.textContent = props?.className ? props.className.split(".").pop()?.toUpperCase() : "PROPERTIES";

  const loadingSpinner = `<div style="display: flex; align-items: center; gap: 8px; padding: 12px 0; color: var(--vscode-descriptionForeground, #888); font-size: 12px;">
    <div style="width: 14px; height: 14px; border: 2px solid var(--vscode-editorGutter-background, rgba(128,128,128,0.2)); border-top-color: var(--vscode-foreground, #ccc); border-radius: 50%; animation: diagram-spin 0.7s linear infinite;"></div>
    Loading...
  </div>`;

  const iconContent = isLoading
    ? `<div style="width: 80px; height: 80px; display: flex; align-items: center; justify-content: center;">
        <div style="width: 20px; height: 20px; border: 2px solid var(--vscode-editorGutter-background, rgba(128,128,128,0.2)); border-top-color: var(--vscode-foreground, #ccc); border-radius: 50%; animation: diagram-spin 0.7s linear infinite;"></div>
       </div>`
    : props?.iconSvg || "";

  let html = `
    <details open style="margin-bottom: 8px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); padding-bottom: 16px;">
      <summary style="cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--vscode-sideBarTitle-foreground); margin-bottom: 8px; list-style: none;">
        INFORMATION
      </summary>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; flex-direction: row; gap: 24px; align-items: stretch;">
          <div style="flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 80px;">
            ${iconContent}
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; flex: 1; justify-content: center;">
            <div style="padding: 4px 0;">
              <div class="f6 color-fg-muted" style="line-height: 1.2; font-size: 11px; color: var(--vscode-descriptionForeground, #888);">Type</div>
              <div style="word-break: break-all; line-height: 1.2; padding: 4px 0;">
                ${props?.className || ""}
              </div>
            </div>
            <div>
              <div class="f6 color-fg-muted" style="line-height: 1.2; font-size: 11px; color: var(--vscode-descriptionForeground, #888); margin-bottom: 4px;">Name</div>
              <input type="text" class="prop-input" id="prop-input-name" value="${nodeData.id}" style="width: 100%; border-radius: 4px;" />
            </div>
          </div>
        </div>
  `;

  if (props) {
    const escapedDesc = (props.description || "").replace(/"/g, "&quot;");
    if (props.description) {
      html += `
        <div style="display: flex; flex-direction: column; margin-top: 16px;">
          <label class="prop-label" style="opacity: 0.6; margin-bottom: 6px; width: 100%;">Description</label>
          <textarea class="prop-input" id="prop-input-description" style="width: 100%; border-radius: 4px; resize: vertical; padding: 6px; box-sizing: border-box;" rows="4">${escapedDesc}</textarea>
        </div>
      `;
    } else if (!isLoading) {
      html += `
        <div id="prop-desc-container" style="display: flex; justify-content: center; padding: 16px 0;">
          <button id="prop-btn-add-desc" style="width: 100%; border-radius: 8px; padding: 8px 24px; background: transparent; color: var(--vscode-descriptionForeground, #888); border: 1px solid var(--vscode-dropdown-border, #d0d7de); cursor: pointer;">Add description</button>
        </div>
      `;
    }
  }

  html += `
      </div>
    </details>
  `;

  if (isLoading) {
    // Show loading indicator for parameters and docs sections
    html += loadingSpinner;
  } else if (props) {
    if (props.parameters && props.parameters.length > 0) {
      html += `<div style="margin-top:24px; margin-bottom:12px; font-weight:600; text-transform:uppercase; font-size:11px; color:var(--vscode-sideBarTitle-foreground)">Parameters</div>`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const p of props.parameters as any[]) {
        const escapedValue = (p.value || "").replace(/"/g, "&quot;");
        const escapedDescParam = (p.description || "").replace(/"/g, "&quot;");
        html += `
          <div class="prop-group">
            <label class="prop-label" title="${escapedDescParam}">${p.name} ${p.unit ? `[${p.unit}]` : ""}</label>
            <input type="text" class="prop-input prop-input-param" data-param="${p.name}" value="${escapedValue}" />
          </div>
        `;
      }
    }

    // Add inline style for images inside docs
    html += `<style>.prop-doc-container img { max-width: 100%; height: auto; }</style>`;

    if (props.docInfo) {
      html += `
        <details open style="margin-top: 16px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); padding-bottom: 8px;">
          <summary style="cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--vscode-sideBarTitle-foreground);">Information</summary>
          <div class="prop-doc-container" style="color: var(--vscode-descriptionForeground); margin-top: 8px; line-height: 1.4; user-select: text;">
            ${props.docInfo}
          </div>
        </details>
      `;
    }

    if (props.docRevisions) {
      html += `
        <details style="margin-top: 16px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); padding-bottom: 8px;">
          <summary style="cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--vscode-sideBarTitle-foreground);">Revisions</summary>
          <div class="prop-doc-container" style="color: var(--vscode-descriptionForeground); margin-top: 8px; line-height: 1.4; user-select: text;">
            ${props.docRevisions}
          </div>
        </details>
      `;
    }
  }

  content.innerHTML = html;
  panel.classList.add("open");

  // Bind events
  const nameInput = document.getElementById("prop-input-name") as HTMLInputElement;
  if (nameInput) {
    nameInput.addEventListener("change", (e) => {
      const newName = (e.target as HTMLInputElement).value;
      if (newName && newName !== nodeData.id) {
        enqueueDiagramAction({ type: "updateName", oldName: nodeData.id, newName });
        nodeData.id = newName;
        title.textContent = newName;
      }
    });
  }

  const descInput = document.getElementById("prop-input-description") as HTMLInputElement;
  const bindDescInput = (input: HTMLInputElement) => {
    input.addEventListener("change", (e) => {
      const newDesc = (e.target as HTMLInputElement).value;
      if (props && newDesc !== props.description) {
        enqueueDiagramAction({ type: "updateDescription", name: nodeData.id, description: newDesc });
        props.description = newDesc;
      }
    });
  };

  if (descInput) {
    bindDescInput(descInput);
  }

  const addDescBtn = document.getElementById("prop-btn-add-desc");
  if (addDescBtn) {
    addDescBtn.addEventListener("click", () => {
      const container = document.getElementById("prop-desc-container");
      if (container) {
        container.innerHTML = `
          <div style="display: flex; flex-direction: column; width: 100%;">
            <label class="prop-label" style="opacity: 0.6; margin-bottom: 6px; width: 100%;">Description</label>
            <textarea class="prop-input" id="prop-input-description" style="width: 100%; border-radius: 4px; resize: vertical; padding: 6px; box-sizing: border-box;" rows="4"></textarea>
          </div>
        `;
        const newDescInput = document.getElementById("prop-input-description") as HTMLInputElement;
        if (newDescInput) {
          bindDescInput(newDescInput);
          newDescInput.focus();
        }
      }
    });
  }

  const paramInputs = document.querySelectorAll(".prop-input-param");
  paramInputs.forEach((input) => {
    input.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement;
      const paramName = target.getAttribute("data-param");
      const newValue = target.value;
      if (paramName) {
        // Send LSP edit
        enqueueDiagramAction({ type: "updateParameter", name: nodeData.id, parameter: paramName, value: newValue });
        // Optimistically update prop model
        if (props?.parameters) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = props.parameters.find((param: any) => param.name === paramName);
          if (p) p.value = newValue;
        }
      }
    });
  });
}
