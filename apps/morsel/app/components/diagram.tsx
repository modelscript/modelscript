// SPDX-License-Identifier: AGPL-3.0-or-later

import { DagreLayout } from "@antv/layout";
import { Cell, Graph, Keyboard, Selection, Snapline, Transform } from "@antv/x6";
import type { Theme } from "@monaco-editor/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { invertSvgColors } from "../util/x6";

export interface DiagramEditorHandle {
  showLoading: () => void;
  hideLoading: () => void;
  fitContent: () => void;
  layout: () => void;
}

interface DiagramEditorProps {
  diagramData: any | null;
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
) {
  // Simplified LSP-driven rendering logic
  if (!diagramData) return;

  g.clearCells();
  const nodes: any[] = [];
  const edges: any[] = [];

  // Create nodes from diagramData
  for (const n of diagramData.nodes || []) {
    const ports = [];
    if (n.ports && n.ports.items) {
      for (const p of n.ports.items) {
        ports.push({ id: p.id, group: p.group || "absolute", args: p.args, markup: p.markup });
      }
    }

    let fill = "transparent";
    let stroke = "#000000"; // fallback

    nodes.push({
      id: n.id,
      shape: "html",
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      angle: n.angle || n.rotation || 0,
      zIndex: n.zIndex || 10,
      html: n.markup
        ? `<div style="width:100%; height:100%;">${n.markup.children ? n.markup.children[0] : ""}</div>`
        : `<div style="width:100%; height:100%; border:1px solid ${stroke}; background:${fill};"></div>`,
      ports: {
        items: ports,
        groups: { absolute: { position: "absolute", zIndex: 100 } },
      },
    });
  }

  // Create edges from diagramData
  for (const e of diagramData.edges || []) {
    edges.push({
      id: e.id,
      source: { cell: e.source.cell, port: e.source.port },
      target: { cell: e.target.cell, port: e.target.port },
      vertices: e.vertices || [],
      zIndex: e.zIndex || 5,
      attrs: e.attrs || { line: { stroke: "#000", strokeWidth: 1 } },
    });
  }

  g.addNodes(nodes);
  g.addEdges(edges);

  lastClassRef.current = "diagram";

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
        renderDiagram(g, diagramData, theme, lastClassRef, lastZoomRef);
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
                const displaySvg = isDark ? invertSvgColors(iconSvg, true) : iconSvg;

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
                props.onDrop(className, p.x, p.y, iconSvg);
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
