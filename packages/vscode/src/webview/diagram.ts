// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Webview-side script: receives diagram data via postMessage and
// renders it using AntV X6.

import { Cell, Graph, Selection, Transform } from "@antv/x6";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.() ?? {
  postMessage() {
    /* noop fallback */
  },
};

let graph: Graph | null = null;

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
    interacting: (cellView) => {
      if (cellView.cell.id === "__diagram_background__") return false;
      return true;
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
          zIndex: -1,
          router: { name: "normal" },
          attrs: {
            "z-index": "-10",
            line: {
              stroke: "#0000ff",
              strokeWidth: 1,
              "vector-effect": "non-scaling-stroke",
              targetMarker: null,
              "pointer-events": "stroke",
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
      if (items.length > 0) {
        vscode.postMessage({ type: "move", items });
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
    vscode.postMessage({
      type: "move",
      items: [{ name: node.id, x: p.x, y: p.y, width: s.width, height: s.height, rotation: r, edges }],
    });
  });

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
    vscode.postMessage({
      type: "resize",
      name: node.id,
      x: p.x,
      y: p.y,
      width: s.width,
      height: s.height,
      rotation: r,
      edges,
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
      vscode.postMessage({
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
        vscode.postMessage({
          type: "edgeMove",
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
          vscode.postMessage({ type: "deleteEdge", ...edge });
        }
      }
      if (componentNames.length > 0) {
        vscode.postMessage({ type: "deleteComponents", names: componentNames });
      }
      g.removeCells(cells);
    }
  });

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
    nodes.push({
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
    });
  }

  for (const edge of data.edges) {
    edges.push({
      id: edge.id,
      shape: "edge",
      zIndex: edge.zIndex,
      source: edge.source,
      target: edge.target,
      vertices: edge.vertices,
      connector: edge.connector,
      router: { name: "normal" },
      attrs: {
        "z-index": "-10",
        line: edge.attrs.line,
      },
    });
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
  g.fromJSON({ nodes, edges });

  // Fit view to the coordinate system extent
  if (cs) {
    const expandedRect = {
      x: cs.x - cs.width * 0.125,
      y: cs.y - cs.height * 0.125,
      width: cs.width * 1.25,
      height: cs.height * 1.25,
    };
    g.zoomToRect(expandedRect);
  }
}

// Listen for messages from the extension host
window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data;
  switch (message.type) {
    case "diagramData":
      renderDiagram(message.data, message.isDark ?? true);
      break;
    case "empty": {
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
    case "error": {
      const placeholder2 = document.getElementById("placeholder");
      if (placeholder2) {
        placeholder2.style.display = "flex";
        placeholder2.textContent = `Error: ${message.message}`;
      }
      break;
    }
  }
});
