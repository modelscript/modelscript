// SPDX-License-Identifier: AGPL-3.0-or-later

import { DagreLayout } from "@antv/layout";
import { Cell, Graph, Keyboard, Selection, Snapline, Transform } from "@antv/x6";
import type { Theme } from "@monaco-editor/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface DiagramEditorHandle {
  showLoading: () => void;
  hideLoading: () => void;
  fitContent: () => void;
  layout: () => void;
}

interface DiagramEditorProps {
  diagramData: any | null;
  diagramClassName?: string | null;
  onSelect?: (componentName: string | null) => void;
  onDrop?: (className: string, x: number, y: number, iconSvg?: string | null) => void;
  onConnect?: (source: string, target: string, points?: { x: number; y: number }[]) => void;
  onMove?: (
    items: {
      name: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      edges?: { source: string; target: string; points: { x: number; y: number }[] }[];
      connectedOnly?: boolean;
    }[],
  ) => void;
  onResize?: (
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
    edges?: { source: string; target: string; points: { x: number; y: number }[] }[],
  ) => void;
  onEdgeMove?: (edges: { source: string; target: string; points: { x: number; y: number }[] }[]) => void;
  onEdgeDelete?: (source: string, target: string) => void;
  onComponentDelete?: (name: string) => void;
  onComponentsDelete?: (names: string[]) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  selectedName?: string | null;
  theme: Theme;
}

function renderDiagram(
  g: Graph,
  diagramData: any,
  theme: Theme,
  lastClassRef: React.MutableRefObject<string | null | undefined>,
  lastZoomRef: React.MutableRefObject<{ zoom: number; tx: number; ty: number } | null>,
  diagramClassName?: string | null,
) {
  // Simplified LSP-driven rendering logic
  if (!diagramData) return;

  // We do not call g.clearCells() here because g.fromJSON() will replace the content.
  // This allows isFirstRender to accurately detect the initial load.

  if (diagramData.coordinateSystem) {
    const cs = diagramData.coordinateSystem;

    // Explicit DOM elements for axes and coordinate system to prevent X6 from including them in bounding box calculations
    let xAxis = g.view.viewport.querySelector("#x-axis") as SVGLineElement | null;
    if (!xAxis) {
      xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
      xAxis.setAttribute("id", "x-axis");
      xAxis.setAttribute("stroke", "#999");
      xAxis.setAttribute("stroke-width", "1");
      xAxis.setAttribute("vector-effect", "non-scaling-stroke");
      xAxis.setAttribute("z-index", "2");
      g.view.viewport.insertBefore(xAxis, g.view.viewport.firstChild);
    }
    xAxis!.setAttribute("x1", "-100000");
    xAxis!.setAttribute("y1", "0");
    xAxis!.setAttribute("x2", "100000");
    xAxis!.setAttribute("y2", "0");

    let yAxis = g.view.viewport.querySelector("#y-axis") as SVGLineElement | null;
    if (!yAxis) {
      yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
      yAxis.setAttribute("id", "y-axis");
      yAxis.setAttribute("stroke", "#999");
      yAxis.setAttribute("stroke-width", "1");
      yAxis.setAttribute("vector-effect", "non-scaling-stroke");
      yAxis.setAttribute("z-index", "2");
      g.view.viewport.insertBefore(yAxis, g.view.viewport.firstChild);
    }
    yAxis!.setAttribute("x1", "0");
    yAxis!.setAttribute("y1", "-100000");
    yAxis!.setAttribute("x2", "0");
    yAxis!.setAttribute("y2", "100000");

    let coordinateSystem = g.view.viewport.querySelector("#coordinateSystem") as SVGRectElement | null;
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
    coordinateSystem!.setAttribute("x", String(cs.x));
    coordinateSystem!.setAttribute("y", String(cs.y));
    coordinateSystem!.setAttribute("width", String(cs.width));
    coordinateSystem!.setAttribute("height", String(cs.height));
  }

  const nodes: any[] = [];
  const edges: any[] = [];

  if (diagramData.diagramBackground && diagramData.coordinateSystem) {
    const cs = diagramData.coordinateSystem;
    nodes.push({
      id: "__diagram_background__",
      x: cs.x,
      y: cs.y,
      width: cs.width,
      height: cs.height,
      zIndex: -1,
      movable: false,
      selectable: false,
      markup: {
        tagName: "svg",
        children: [
          { tagName: "rect", attrs: { style: "fill: transparent; stroke: none", width: cs.width, height: cs.height } },
          diagramData.diagramBackground,
        ],
        attrs: { preserveAspectRatio: "none", width: cs.width, height: cs.height, style: "overflow: visible" },
      },
    });
  }

  // Create nodes from diagramData
  for (const n of diagramData.nodes || []) {
    const nodeData: any = {
      id: n.id,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      angle: n.angle || n.rotation || 0,
      zIndex: n.zIndex || 10,
      opacity: n.opacity,
      markup: n.markup,
      ports: n.ports,
      data: { properties: n.properties },
      autoLayout: n.autoLayout,
    };

    if (n.attrs) nodeData.attrs = n.attrs;
    if (n.shape) nodeData.shape = n.shape;
    if (n.parent) nodeData.parent = n.parent;

    nodes.push(nodeData);
  }

  // Create edges from diagramData
  for (const e of diagramData.edges || []) {
    edges.push({
      id: e.id,
      shape: "edge",
      source: { cell: e.source.cell, port: e.source.port },
      target: { cell: e.target.cell, port: e.target.port },
      vertices: e.vertices || [],
      zIndex: e.zIndex || 5,
      attrs: e.attrs || { line: { stroke: "#000", strokeWidth: 1 } },
    });
  }

  const isFirstRender = g.getCells().length === 0;

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

    const subResult = subDagre.layout(subModel as any);

    let minX = Infinity;
    let minY = Infinity;
    const layoutCoords = new Map<string, { leftX: number; topY: number }>();

    subResult.nodes?.forEach((laid: any) => {
      const childNode = childNodes.find((c) => c.id === laid.id);
      if (childNode) {
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
        const dx = PAD.left + (coords.leftX - minX);
        const dy = PAD.top + (coords.topY - minY);
        childRelativePositions.set(childNode.id, { dx, dy });
        maxRight = Math.max(maxRight, dx + childNode.width + PAD.right);
        maxBottom = Math.max(maxBottom, dy + childNode.height + PAD.bottom);
      }
    }

    parentNode.width = Math.max(maxRight, 220);
    parentNode.height = Math.max(maxBottom, 80);
  }

  // ── Phase 2: Top-level Dagre layout with expanded container sizes ──
  const nodesToLayout: string[] = [];
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

    const newModel = dagreLayout.layout(model as any);
    newModel.nodes?.forEach((n: any) => {
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
  // relationships when fed raw JSON. Stash relationships first.
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

  g.fromJSON({ nodes, edges });

  // Programmatically establish all embedding relationships via standard API
  for (const [childId, parentId] of relations) {
    const parentCell = g.getCellById(parentId);
    const childCell = g.getCellById(childId);
    if (parentCell && childCell && parentCell.isNode() && childCell.isNode()) {
      parentCell.addChild(childCell);
    }
  }

  const isClassChanged = lastClassRef.current !== diagramClassName;

  // Only auto-zoom if it's the very first render or the user opened a new class.
  // This prevents it from zooming out aggressively when the diagram dynamically updates.
  if (diagramData.coordinateSystem && (isFirstRender || isClassChanged)) {
    const cs = diagramData.coordinateSystem;
    const expandedRect = {
      x: cs.x - cs.width * 0.125,
      y: cs.y - cs.height * 0.125,
      width: cs.width * 1.25,
      height: cs.height * 1.25,
    };
    g.zoomToRect(expandedRect, {});
    g.centerContent();
  }

  lastClassRef.current = diagramClassName || "diagram";

  g.on("scale", () => {
    lastZoomRef.current = { zoom: g.zoom(), tx: g.translate().tx, ty: g.translate().ty };
  });
  g.on("translate", () => {
    lastZoomRef.current = { zoom: g.zoom(), tx: g.translate().tx, ty: g.translate().ty };
  });
}

const DiagramEditor = forwardRef<DiagramEditorHandle, DiagramEditorProps>((props, ref) => {
  const refContainer = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(false);
  const renderRafRef = useRef<number | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const onSelectRef = useRef(props.onSelect);
  const onConnectRef = useRef(props.onConnect);
  const onMoveRef = useRef(props.onMove);
  const onResizeRef = useRef(props.onResize);
  const onEdgeMoveRef = useRef(props.onEdgeMove);
  const onEdgeDeleteRef = useRef(props.onEdgeDelete);
  const onComponentDeleteRef = useRef(props.onComponentDelete);
  const onComponentsDeleteRef = useRef(props.onComponentsDelete);
  const onUndoRef = useRef(props.onUndo);
  const onRedoRef = useRef(props.onRedo);
  const moveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const justResizedRef = useRef(false);
  const changedNodesRef = useRef<Set<string>>(new Set());

  useImperativeHandle(ref, () => ({
    showLoading: () => setLoading(true),
    hideLoading: () => setLoading(false),
    fitContent: () => {
      if (graph) {
        graph.zoomToFit({ padding: 20 });
        graph.centerContent();
      }
    },
    layout: () => {
      const g = graphRef.current;
      if (!g) return;

      const nodes = g.getNodes();
      const edges = g.getEdges();

      const dagreLayout = new DagreLayout({
        type: "dagre",
        rankdir: "LR",
        align: "UL",
        ranksep: 0.5,
        nodesep: 0.5,
        begin: [-10, -10],
        controlPoints: true,
      });

      const model = {
        nodes: nodes.map((node) => ({
          id: node.id,
          width: node.getSize().width,
          height: node.getSize().height,
        })) as any,
        edges: edges.map((edge) => ({
          source: edge.getSourceCellId(),
          target: edge.getTargetCellId(),
        })) as any,
      };

      const newModel = dagreLayout.layout(model);
      const items: any[] = [];

      g.batchUpdate("layout", () => {
        newModel.nodes?.forEach((n: any) => {
          const node = g.getCellById(n.id);
          if (node && node.isNode()) {
            node.setPosition(n.x, n.y);
            const p = node.getPosition();
            const s = node.getSize();
            const r = node.getAngle();
            const connectedEdges = getConnectedEdges(node);
            items.push({
              name: node.id,
              x: p.x,
              y: p.y,
              width: s.width,
              height: s.height,
              rotation: r,
              edges: connectedEdges,
            });
          }
        });
      });

      if (items.length > 0 && onMoveRef.current) {
        onMoveRef.current(items);
      }
    },
  }));

  useEffect(() => {
    onSelectRef.current = props.onSelect;
    onConnectRef.current = props.onConnect;
    onMoveRef.current = props.onMove;
    onResizeRef.current = props.onResize;
    onEdgeMoveRef.current = props.onEdgeMove;
    onEdgeDeleteRef.current = props.onEdgeDelete;
    onComponentDeleteRef.current = props.onComponentDelete;
    onComponentsDeleteRef.current = props.onComponentsDelete;
    onUndoRef.current = props.onUndo;
    onRedoRef.current = props.onRedo;
  }, [
    props.onSelect,
    props.onConnect,
    props.onMove,
    props.onResize,
    props.onEdgeMove,
    props.onEdgeDelete,
    props.onComponentDelete,
    props.onComponentsDelete,
    props.onUndo,
    props.onRedo,
  ]);

  // Keyboard arrow movement for selected nodes
  useEffect(() => {
    const container = refContainer.current;
    if (!container) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const g = graphRef.current;
      if (!g) return;

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          onRedoRef.current?.();
        } else {
          onUndoRef.current?.();
        }
        return;
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        onRedoRef.current?.();
        return;
      }

      const arrowKeys: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const dir = arrowKeys[e.key];
      if (!dir) return;
      const selected = g.getSelectedCells().filter((c) => c.isNode());
      if (selected.length === 0) return;
      e.preventDefault();
      const step = e.shiftKey ? 1 : 10;
      const [dx, dy] = [dir[0] * step, dir[1] * step];
      g.batchUpdate("keyboard-move", () => {
        selected.forEach((node) => {
          const pos = node.getPosition();
          node.setPosition(pos.x + dx, pos.y + dy);
        });
      });
      // Trigger onMove callback
      if (onMoveRef.current) {
        const items = selected.map((node) => {
          const p = node.getPosition();
          const s = node.getSize();
          const r = node.getAngle();
          const edges = getConnectedEdges(node);
          return { name: node.id, x: p.x, y: p.y, width: s.width, height: s.height, rotation: r, edges };
        });
        onMoveRef.current(items);
      }
    };
    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [graph]);

  const getConnectedEdges = (node: any) => {
    const g = graphRef.current;
    if (!g) return [];
    const edges = g.getConnectedEdges(node);
    return edges?.map((edge) => {
      const source = edge.getSource() as any;
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
  };

  useEffect(() => {
    if (!refContainer.current) return;
    let g: Graph | null = null;
    if (!graph) {
      g = new Graph({
        container: refContainer.current,
        async: false,
        autoResize: true,
        background: {
          color: props.theme === "vs-dark" ? "#1e1e1e" : "#ffffff",
        },
        grid: {
          size: 2,
          visible: true,
          type: "doubleMesh",
          args: [
            {
              color: "transparent",
              thickness: 0,
            },
            {
              color: props.theme === "vs-dark" ? "#2f2f2f" : "#ccc",
              thickness: 1,
              factor: 10,
            },
          ],
        },
        panning: {
          enabled: true,
        },
        mousewheel: {
          enabled: true,
          global: true,
          modifiers: "ctrl",
        },
        embedding: {
          enabled: true,
          findParent: "bbox",
        },
        translating: {
          restrict(view) {
            if (!view) return null;
            const cell = view.cell;
            if (cell.isNode()) {
              const parent = cell.getParent();
              if (parent) {
                const bbox = parent.getBBox();
                bbox.x += 16;
                bbox.y += 40;
                bbox.width -= 32;
                bbox.height -= 56;
                return bbox;
              }
            }
            return null;
          },
        },
        interacting: (cellView) => {
          if (cellView.cell.id === "__diagram_background__") return false;
          return true;
        },
        connecting: {
          allowBlank: false,
          allowMulti: (args) => {
            return true;
          },
          allowLoop: false,
          allowNode: false,
          allowEdge: false,
          allowPort: true,
          highlight: true,
          validateMagnet: (args) => {
            return true;
          },
          validateConnection: (args) => {
            return true;
          },
          validateEdge: (args) => {
            return true;
          },
          createEdge: () => {
            return g?.createEdge({
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
      g.use(new Transform({ resizing: true, rotating: true }));
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
      g.use(new Keyboard({ enabled: true }));
      g.use(new Snapline({ enabled: true, clean: false }));

      const tryFitEmbeds = (node: Cell) => {
        const parent = node.getParent();
        if (parent && parent.isNode()) {
          (parent as any).fitEmbeds({ padding: { top: 40, left: 16, right: 16, bottom: 16 } });
        }
      };

      g.on("node:change:position", ({ node, options }) => {
        if (!options.skipParentHandler) tryFitEmbeds(node);
      });
      g.on("node:change:size", ({ node, options }) => {
        if (!options.skipParentHandler) tryFitEmbeds(node);
      });

      g.bindKey(["backspace", "delete"], () => {
        const cells = g?.getSelectedCells();
        if (cells && cells.length > 0) {
          const componentNames: string[] = [];
          cells.forEach((cell) => {
            if (cell.isEdge()) {
              const source = cell.getSource() as any;
              const target = cell.getTarget() as any;
              if (source.cell && source.port && target.cell && target.port) {
                if (onEdgeDeleteRef.current) {
                  onEdgeDeleteRef.current(`${source.cell}.${source.port}`, `${target.cell}.${target.port}`);
                }
              }
            } else if (cell.isNode()) {
              componentNames.push(cell.id);
            }
          });
          if (componentNames.length > 0) {
            if (onComponentsDeleteRef.current) {
              onComponentsDeleteRef.current(componentNames);
            } else {
              componentNames.forEach((name) => onComponentDeleteRef.current?.(name));
            }
          }
          g?.removeCells(cells);
        }
      });
      g.on("cell:click", ({ cell }) => {
        if (cell.isNode() && cell.id !== "__diagram_background__") {
          if (onSelectRef.current) {
            onSelectRef.current(cell.id);
          }
        } else {
          if (onSelectRef.current) {
            onSelectRef.current(null);
          }
        }
      });
      g.on("blank:click", () => {
        g?.cleanSelection();
        if (onSelectRef.current) {
          onSelectRef.current(null);
        }
      });
      g.on("edge:connected", ({ isNew, edge }) => {
        if (isNew && onConnectRef.current) {
          const source = edge.getSource() as any;
          const target = edge.getTarget() as any;
          if (source.cell && source.port && target.cell && target.port) {
            const vertices = edge.getVertices();
            const sourcePoint = edge.getSourcePoint();
            const targetPoint = edge.getTargetPoint();
            const points = [sourcePoint, ...vertices, targetPoint].map((p) => ({
              x: Math.round(p.x),
              y: Math.round(-p.y),
            }));

            onConnectRef.current(`${source.cell}.${source.port}`, `${target.cell}.${target.port}`, points);
          }
        }
      });
      g.on("selection:changed", ({ added, removed, selected }: { added: any[]; removed: any[]; selected: any[] }) => {
        // Visual updates
        added.forEach((cell) => {
          if (cell.isEdge()) {
            cell.addTools([
              {
                name: "vertices",
                args: {
                  attrs: { fill: "#666", stroke: "transparent", strokeWidth: 1, r: 2 },
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
        removed.forEach((cell) => {
          if (cell.isEdge()) {
            cell.removeTools();
          }
        });

        // Property panel updates
        const currentSelected = selected || g?.getSelectedCells();
        if (currentSelected && currentSelected.length === 1 && currentSelected[0].isNode()) {
          const nodeId = currentSelected[0].id;
          if (onSelectRef.current) {
            onSelectRef.current(nodeId);
          }

          // Smoothly pan to center the node within the active viewport
          setTimeout(() => {
            if (!g || g.disposed) return;
            const node = g.getCellById(nodeId);
            if (!node || !node.isNode()) return;

            const bbox = node.getBBox();
            const scale = g.scale().sx;
            const cx = bbox.x + bbox.width / 2;
            const cy = bbox.y + bbox.height / 2;

            const containerRect = g.container.getBoundingClientRect();
            // In Morsel, the diagram container is a flex item that inherently shrinks when the property panel expands,
            // so containerRect.width directly represents the safe "unobscured" workspace space.
            const visibleWidth = containerRect.width;

            const targetTx = visibleWidth / 2 - cx * scale;
            const targetTy = containerRect.height / 2 - cy * scale;

            const { tx: ctx, ty: cty } = g.translate();
            const duration = 250;
            const startTime = performance.now();

            const animate = (time: number) => {
              if (!g || g.disposed) return;
              const elapsed = time - startTime;
              const progress = Math.min(elapsed / duration, 1);
              const ease = 1 - Math.pow(1 - progress, 3); // cubic ease-out
              g.translate(ctx + (targetTx - ctx) * ease, cty + (targetTy - cty) * ease);
              if (progress < 1) {
                requestAnimationFrame(animate);
              }
            };
            requestAnimationFrame(animate);
          }, 50); // Allow React layout re-render & ResizeObserver ticks to shrink the canvas
        } else {
          if (onSelectRef.current) {
            onSelectRef.current(null);
          }
        }
      });
      let edgeUpdateTimeout: NodeJS.Timeout | null = null;
      g.on("edge:change:vertices", ({ edge }) => {
        if (edgeUpdateTimeout) {
          clearTimeout(edgeUpdateTimeout);
        }
        edgeUpdateTimeout = setTimeout(() => {
          if (onEdgeMoveRef.current) {
            const source = edge.getSource() as any;
            const target = edge.getTarget() as any;
            if (source.cell && source.port && target.cell && target.port) {
              const vertices = edge.getVertices();
              const sourcePoint = edge.getSourcePoint();
              const targetPoint = edge.getTargetPoint();
              const points = [sourcePoint, ...vertices, targetPoint].map((p) => ({
                x: Math.round(p.x),
                y: Math.round(-p.y),
              }));
              onEdgeMoveRef.current([
                {
                  source: `${source.cell}.${source.port}`,
                  target: `${target.cell}.${target.port}`,
                  points,
                },
              ]);
            }
          }
          edgeUpdateTimeout = null;
        }, 500);
      });
      g.on("node:change:position", ({ node }) => {
        // Deselect edges when moving a node to avoid stale rubberbands
        const selected = g?.getSelectedCells();
        if (selected) {
          selected.forEach((cell) => {
            if (cell.isEdge()) {
              g?.unselect(cell);
            }
          });
        }

        changedNodesRef.current.add(node.id);

        if (moveTimeoutRef.current) {
          clearTimeout(moveTimeoutRef.current);
        }
        moveTimeoutRef.current = setTimeout(() => {
          if (justResizedRef.current) {
            justResizedRef.current = false;
            moveTimeoutRef.current = null;
            changedNodesRef.current.clear();
            return;
          }
          if (onMoveRef.current) {
            const items: any[] = [];
            changedNodesRef.current.forEach((id) => {
              const n = g?.getCellById(id);
              if (n && n.isNode()) {
                const p = n.getPosition();
                const s = n.getSize();
                const r = n.getAngle();
                const edges = getConnectedEdges(n);
                items.push({
                  name: n.id,
                  x: p.x,
                  y: p.y,
                  width: s.width,
                  height: s.height,
                  rotation: r,
                  edges,
                });
              }
            });

            // Also collect positions for connected nodes that weren't moved,
            // so that missing Placement annotations can be added for them.
            const movedNames = new Set(changedNodesRef.current);
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
              const n = g?.getCellById(id);
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
              onMoveRef.current(items);
            }
          }
          changedNodesRef.current.clear();
          moveTimeoutRef.current = null;
        }, 200);
      });
      g.on("node:rotated", ({ node }: any) => {
        if (onMoveRef.current) {
          const p = node.getPosition();
          const s = node.getSize();
          const r = node.getAngle();
          const edges = getConnectedEdges(node);
          onMoveRef.current!([
            {
              name: node.id,
              x: p.x,
              y: p.y,
              width: s.width,
              height: s.height,
              rotation: r,
              edges,
            },
          ]);
        }
      });
      g.on("node:resized", ({ node }: any) => {
        if (moveTimeoutRef.current) {
          clearTimeout(moveTimeoutRef.current);
          moveTimeoutRef.current = null;
        }
        justResizedRef.current = true;
        setTimeout(() => {
          justResizedRef.current = false;
        }, 200);
        if (onResizeRef.current) {
          const p = node.getPosition();
          const s = node.getSize();
          const r = node.getAngle();
          const edges = getConnectedEdges(node);
          onResizeRef.current(node.id, p.x, p.y, s.width, s.height, r, edges);
        }
      });
      graphRef.current = g;
      setGraph(g);
    } else {
      g = graph;
      g.use(new Transform({ resizing: true, rotating: true }));
      g.drawBackground({ color: props.theme === "vs-dark" ? "#1e1e1e" : "#ffffff" });
      g.drawGrid({
        type: "doubleMesh",
        args: [
          {
            color: "transparent",
            thickness: 0,
          },
          {
            color: props.theme === "vs-dark" ? "#2f2f2f" : "#ccc",
            thickness: 1,
            factor: 10,
          },
        ],
      });
    }

    // We no longer remove these elements on every update to prevent flickering.
    // They will be updated or created below if they don't exist.

    if (!props.diagramData) {
      g.clearCells();
      setLoading(false);
      return;
    }

    // Only show the spinner when switching to a different class (e.g. from library tree).
    // Code edits re-render the same class and don't need a spinner overlay.
    // In LSP-driven setup, identity might simply come from a diagram prop if we need logic.
    // For now we assume false unless we have a specific trigger.
    const isNewClass = false;
    if (isNewClass) {
      setLoading(true);
    }

    // Capture values needed inside the deferred callback
    const diagramData = props.diagramData;
    const theme = props.theme;

    // Double-rAF ensures the spinner is actually painted before we block.
    renderRafRef.current = requestAnimationFrame(() => {
      renderRafRef.current = requestAnimationFrame(() => {
        renderDiagram(g, diagramData, theme, lastClassRef, lastZoomRef, props.diagramClassName);
        setLoading(false);
      });
    });

    return () => {
      if (renderRafRef.current != null) {
        cancelAnimationFrame(renderRafRef.current);
        renderRafRef.current = null;
      }
    };
  }, [props.diagramData, props.theme]);

  useEffect(() => {
    if (graph) {
      const selectedCells = graph.getSelectedCells();
      const currentSelectedId = selectedCells.length === 1 ? selectedCells[0].id : null;
      if (props.selectedName !== currentSelectedId) {
        graph.cleanSelection();
        if (props.selectedName) {
          const node = graph.getCellById(props.selectedName);
          if (node && node.isNode()) {
            graph.resetSelection(node);
          }
        } else {
          graph.cleanSelection();
        }
      }
    }
  }, [graph, props.selectedName]);

  useEffect(() => {
    if (!graph) return;
    graph.drawBackground({ color: props.theme === "vs-dark" ? "#1e1e1e" : "#ffffff" });
    graph.drawGrid({
      type: "doubleMesh",
      args: [
        {
          color: "transparent",
          thickness: 0,
        },
        {
          color: props.theme === "vs-dark" ? "#2f2f2f" : "#ccc",
          thickness: 1,
          factor: 10,
        },
      ],
    });
  }, [graph, props.theme]);

  const lastClassRef = useRef<string | null | undefined>(undefined);
  const lastZoomRef = useRef<{ zoom: number; tx: number; ty: number } | null>(null);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={refContainer}
        className="height-full width-full"
        tabIndex={0}
        style={{ outline: "none" }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          const data = e.dataTransfer.getData("application/json");
          if (data && graph) {
            try {
              const { className, classKind, iconSvg } = JSON.parse(data);
              // Only allow models, blocks, and connectors to be dropped
              if (classKind && classKind !== "model" && classKind !== "block" && classKind !== "connector") {
                return;
              }
              const p = graph.clientToLocal(e.clientX, e.clientY);

              // Immediately add a placeholder node with the tree icon SVG
              if (iconSvg) {
                const size = 20;
                // Remove any previous placeholder
                const existing = graph.getCellById("__drop_placeholder__");
                if (existing) graph.removeCell(existing);

                const isDark = props.theme === "vs-dark";
                const displaySvg = iconSvg || "";

                // Patch the SVG to have explicit width/height so it scales to the placeholder container
                const fittedSvg = displaySvg.replace(
                  /^<svg/,
                  `<svg width="${size}" height="${size}" style="overflow:visible"`,
                );

                graph.addNode({
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
                          style: `width:${size}px;height:${size}px;overflow:visible;animation:drop-placeholder-pulse 1.2s ease-in-out infinite, drop-placeholder-appear 0.2s ease-out;`,
                        },
                      },
                    ],
                  } as any,
                } as any);

                // Inject SVG HTML into the placeholder after X6 renders it
                requestAnimationFrame(() => {
                  const placeholderNode = graph.getCellById("__drop_placeholder__");
                  if (placeholderNode) {
                    const view = graph.findView(placeholderNode);
                    if (view) {
                      const innerDiv = view.container.querySelector("div");
                      if (innerDiv) {
                        innerDiv.innerHTML = fittedSvg;
                      }
                    }
                  }
                });
              }

              if (props.onDrop) {
                setTimeout(() => {
                  props.onDrop!(className, p.x, p.y, iconSvg);
                }, 300);
              }
            } catch (e) {
              console.error(e);
            }
          }
        }}
      />
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: props.theme === "vs-dark" ? "rgba(30,30,30,0.6)" : "rgba(255,255,255,0.6)",
            zIndex: 1000,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              border: `3px solid ${props.theme === "vs-dark" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"}`,
              borderTopColor: props.theme === "vs-dark" ? "#ccc" : "#333",
              borderRadius: "50%",
              animation: "diagram-spin 0.7s linear infinite",
            }}
          />
        </div>
      )}
      <style>{`
        @keyframes diagram-spin { to { transform: rotate(360deg); } }
        @keyframes drop-placeholder-pulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.04); }
        }
        @keyframes drop-placeholder-appear {
          0% { opacity: 0; transform: scale(0.3); }
          50% { opacity: 1; transform: scale(1.15); }
          70% { transform: scale(0.92); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
});

export default DiagramEditor;

function marker(arrow: string | null | undefined, strokeColor: string, strokeWidth: number): any {
  if (!arrow) return null;
  const normalized = arrow.toLowerCase();
  switch (normalized) {
    case "filled":
      return {
        tagName: "path",
        d: "M 0 0 L 10 5 L 0 10 Z",
        "stroke-width": strokeWidth,
        fill: strokeColor,
        stroke: strokeColor,
        refX: 10,
        refY: 5,
        markerUnits: "userSpaceOnUse",
      };
    case "half":
      return {
        tagName: "path",
        d: "M 0 0 L 10 5",
        "stroke-width": strokeWidth,
        fill: "none",
        stroke: strokeColor,
        refX: 10,
        refY: 5,
        markerUnits: "userSpaceOnUse",
      };
    case "open":
      return {
        tagName: "path",
        d: "M 0 0 L 10 5 L 0 10",
        "stroke-width": strokeWidth,
        fill: "none",
        stroke: strokeColor,
        refX: 10,
        refY: 5,
        markerUnits: "userSpaceOnUse",
      };
    default:
      return null;
  }
}
