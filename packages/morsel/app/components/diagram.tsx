// SPDX-License-Identifier: AGPL-3.0-or-later

import { DagreLayout } from "@antv/layout";
import { Graph, Keyboard, Selection, Transform, type EdgeMetadata, type NodeMetadata } from "@antv/x6";
import type { PortMetadata } from "@antv/x6/lib/model/port";
import {
  applyCoordinateSystem,
  Arrow,
  computeHeight,
  computeIconPlacement,
  computePortPlacement,
  computeWidth,
  convertPoint,
  LinePattern,
  ModelicaClassKind,
  ModelicaElement,
  renderDiagram,
  renderGraphicItem,
  Smooth,
  toEnum,
  type IDiagram,
  type ILine,
  type ModelicaClassInstance,
} from "@modelscript/modelscript";
import type { Theme } from "@monaco-editor/react";
import { Svg } from "@svgdotjs/svg.js";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { renderIconX6 } from "../util/x6";

export interface DiagramEditorHandle {
  fitContent: () => void;
}

interface DiagramEditorProps {
  classInstance: ModelicaClassInstance | null;
  onSelect?: (componentName: string | null) => void;
  onDrop?: (className: string, x: number, y: number) => void;
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
  theme: Theme;
}

const DiagramEditor = forwardRef<DiagramEditorHandle, DiagramEditorProps>((props, ref) => {
  const refContainer = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const onSelectRef = useRef(props.onSelect);
  const onConnectRef = useRef(props.onConnect);
  const onMoveRef = useRef(props.onMove);
  const onResizeRef = useRef(props.onResize);
  const onEdgeMoveRef = useRef(props.onEdgeMove);
  const onEdgeDeleteRef = useRef(props.onEdgeDelete);
  const onComponentDeleteRef = useRef(props.onComponentDelete);
  const moveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const justResizedRef = useRef(false);
  const changedNodesRef = useRef<Set<string>>(new Set());

  useImperativeHandle(ref, () => ({
    fitContent: () => {
      if (graph) {
        graph.zoomToFit({ padding: 20 });
        graph.centerContent();
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
  }, [
    props.onSelect,
    props.onConnect,
    props.onMove,
    props.onResize,
    props.onEdgeMove,
    props.onEdgeDelete,
    props.onComponentDelete,
  ]);

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
        interacting: true,
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

      g.bindKey(["backspace", "delete"], () => {
        const cells = g?.getSelectedCells();
        if (cells && cells.length > 0) {
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
              if (onComponentDeleteRef.current) {
                onComponentDeleteRef.current(cell.id);
              }
            }
          });
          g?.removeCells(cells);
        }
      });
      g.on("cell:click", ({ cell }) => {
        if (cell.isNode()) {
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
          if (onSelectRef.current) {
            onSelectRef.current(currentSelected[0].id);
          }
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

    document.getElementById("x-axis")?.remove();
    document.getElementById("y-axis")?.remove();
    document.getElementById("coordinateSystem")?.remove();
    document.getElementById("background")?.remove();

    if (!props.classInstance) {
      g.clearCells();
      return;
    }

    const nodes = new Map<string, NodeMetadata>();
    const edges: EdgeMetadata[] = [];
    for (const component of props.classInstance.components) {
      if (!component.name) continue;
      const componentClassInstance = component.classInstance;
      if (!componentClassInstance) continue;
      let componentTransform = computeIconPlacement(component);
      const autoLayout = !componentTransform;
      if (!componentTransform) {
        componentTransform = {
          originX: 0,
          originY: 0,
          rotate: 0,
          scaleX: 1,
          scaleY: 1,
          translateX: -10,
          translateY: -10,
          width: 20,
          height: 20,
        };
      }
      const componentMarkup = renderIconX6(componentClassInstance, component, false);
      const ports: PortMetadata[] = [];
      for (const connector of componentClassInstance.components) {
        const connectorClassInstance = connector.classInstance;
        if (!connectorClassInstance || connectorClassInstance.classKind !== ModelicaClassKind.CONNECTOR) continue;
        const connectorTransform = computePortPlacement(connector);
        if (!connectorTransform) continue;
        const connectorMarkup = renderIconX6(connectorClassInstance);
        const a = connectorTransform.rotate * (Math.PI / 180);
        const relTranslateX = (connectorTransform.translateX - connectorTransform.originX) * componentTransform.scaleX;
        const relTranslateY = (connectorTransform.translateY - connectorTransform.originY) * componentTransform.scaleY;
        ports.push({
          id: connector.name ?? "",
          group: "absolute",
          args: {
            x:
              componentTransform.width / 2 +
              relTranslateX * Math.cos(a) -
              relTranslateY * Math.sin(a) +
              connectorTransform.originX * componentTransform.scaleX,
            y:
              componentTransform.height / 2 +
              relTranslateX * Math.sin(a) +
              relTranslateY * Math.cos(a) +
              connectorTransform.originY * componentTransform.scaleY,
            angle: connectorTransform.rotate,
          },
          markup: {
            tagName: "svg",
            children: [connectorMarkup],
            attrs: {
              magnet: "true",
              width: connectorTransform.width * componentTransform.scaleX,
              height: connectorTransform.height * componentTransform.scaleY,
              style: "overflow: visible",
            },
          },
        });
      }
      const a = componentTransform.rotate * (Math.PI / 180);
      const relTranslateX = componentTransform.width / 2 + componentTransform.translateX - componentTransform.originX;
      const relTranslateY = componentTransform.height / 2 + componentTransform.translateY - componentTransform.originY;
      nodes.set(component.name, {
        id: component.name,
        autoLayout,
        x:
          relTranslateX * Math.cos(a) -
          relTranslateY * Math.sin(a) -
          componentTransform.width / 2 +
          componentTransform.originX,
        y:
          relTranslateX * Math.sin(a) +
          relTranslateY * Math.cos(a) -
          componentTransform.height / 2 +
          componentTransform.originY,
        angle: componentTransform.rotate,
        width: componentTransform.width,
        height: componentTransform.height,
        markup: {
          tagName: "svg",
          children: [
            {
              tagName: "rect",
              attrs: {
                style: "fill: transparent; stroke:none",
                width: componentTransform.width,
                height: componentTransform.height,
              },
            },
            componentMarkup,
          ],
          attrs: {
            preserveAspectRatio: "none",
            width: componentTransform.width,
            height: componentTransform.height,
            style: "overflow: visible",
          },
        },
        ports: {
          items: ports,
          groups: {
            absolute: {
              position: "absolute",
            },
          },
        },
      });
    }
    for (const connectEquation of props.classInstance.connectEquations) {
      const c1 = connectEquation.componentReference1?.parts.map((c) => c.identifier?.text ?? "");
      const c2 = connectEquation.componentReference2?.parts.map((c) => c.identifier?.text ?? "");
      if (!c1 || !c2 || c1.length === 0 || c2.length === 0) continue;
      if (!nodes.has(c1[0]) || !nodes.has(c2[0])) continue;
      const annotations = ModelicaElement.instantiateAnnotations(props.classInstance, connectEquation.annotationClause);
      const line: ILine | null = props.classInstance.annotation("Line", annotations);
      const strokeColor = `rgb(${line?.color?.[0] ?? 0}, ${line?.color?.[1] ?? 0}, ${line?.color?.[2] ?? 255})`;
      const strokeWidth = (line?.thickness ?? 0.25) * 2;
      const stroke = line?.visible === false || line?.pattern === LinePattern.NONE ? "none" : strokeColor;
      let strokeDasharray = undefined;
      switch (line?.pattern) {
        case LinePattern.DASH:
          strokeDasharray = "4, 2";
          break;
        case LinePattern.DASH_DOT:
          strokeDasharray = "4, 2, 1, 2";
          break;
        case LinePattern.DASH_DOT_DOT:
          strokeDasharray = "4, 2, 1, 2, 1, 2";
          break;
        case LinePattern.DOT:
          strokeDasharray = "1, 2";
          break;
      }
      const sourceMarker = marker(toEnum(Arrow, line?.arrow?.[0]), strokeColor, strokeWidth);
      const targetMarker = marker(toEnum(Arrow, line?.arrow?.[1]), strokeColor, strokeWidth);
      edges.push({
        id: `${c1[0]}.${c1?.[1]}-${c2[0]}.${c2?.[1]}`,
        shape: "edge",
        source: {
          cell: c1[0],
          port: c1?.[1],
        },
        target: {
          cell: c2[0],
          port: c2?.[1],
        },
        vertices: line?.points
          ?.map((p) => convertPoint(p))
          .map((p) => {
            return { x: p[0], y: p[1] };
          }),
        connector: line?.smooth === Smooth.BEZIER ? "smooth" : undefined,
        router: { name: "normal" },
        attrs: {
          "z-index": "-10",
          line: {
            stroke,
            strokeWidth,
            strokeDasharray,
            sourceMarker,
            targetMarker,
            "vector-effect": "non-scaling-stroke",
          },
        },
      });
    }

    const xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    xAxis.setAttribute("id", "x-axis");
    xAxis.setAttribute("x1", "-100000");
    xAxis.setAttribute("y1", "0");
    xAxis.setAttribute("x2", "100000");
    xAxis.setAttribute("y2", "0");
    xAxis.setAttribute("stroke", "#999");
    xAxis.setAttribute("stroke-width", "1");
    xAxis.setAttribute("vector-effect", "non-scaling-stroke");
    xAxis.setAttribute("z-index", "2");
    g.view.viewport.insertBefore(xAxis, g.view.viewport.firstChild);

    const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    yAxis.setAttribute("id", "y-axis");
    yAxis.setAttribute("x1", "0");
    yAxis.setAttribute("y1", "-100000");
    yAxis.setAttribute("x2", "0");
    yAxis.setAttribute("y2", "100000");
    yAxis.setAttribute("stroke", "#999");
    yAxis.setAttribute("stroke-width", "1");
    yAxis.setAttribute("vector-effect", "non-scaling-stroke");
    yAxis.setAttribute("z-index", "2");
    g.view.viewport.insertBefore(yAxis, g.view.viewport.firstChild);

    const coordinateSystem = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    coordinateSystem.setAttribute("id", "coordinateSystem");
    coordinateSystem.setAttribute("x", "-100");
    coordinateSystem.setAttribute("y", "-100");
    coordinateSystem.setAttribute("width", "200");
    coordinateSystem.setAttribute("height", "200");
    coordinateSystem.setAttribute("fill", "none");
    coordinateSystem.setAttribute("stroke", "#999");
    coordinateSystem.setAttribute("stroke-width", "1");
    coordinateSystem.setAttribute("vector-effect", "non-scaling-stroke");
    coordinateSystem.setAttribute("z-index", "1");
    g.view.viewport.insertBefore(coordinateSystem, g.view.viewport.firstChild);

    const diagram: IDiagram | null = props.classInstance.annotation("Diagram");
    if (diagram) {
      const background = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      background.setAttribute("id", "background");
      g.view.viewport.insertBefore(background, g.view.viewport.firstChild);
      const svg = new Svg(background);
      applyCoordinateSystem(svg, diagram.coordinateSystem);
      const p1 = convertPoint(diagram.coordinateSystem?.extent?.[0], [-100, -100]);
      background.setAttribute("x", String(p1[0]));
      background.setAttribute("y", String(-p1[1]));
      background.setAttribute("width", String(computeWidth(diagram.coordinateSystem?.extent)));
      background.setAttribute("height", String(computeHeight(diagram.coordinateSystem?.extent)));
      background.setAttribute("z-index", "1");
      for (const extendsClassInstance of props.classInstance.extendsClassInstances) {
        if (extendsClassInstance.classInstance) renderDiagram(extendsClassInstance.classInstance, svg);
      }
      const group = svg.group();
      for (const graphicItem of diagram?.graphics ?? []) renderGraphicItem(group, graphicItem, props.classInstance);
    }
    const nodesToLayout: string[] = [];
    nodes.forEach((node) => {
      if ((node as any).autoLayout) {
        nodesToLayout.push(node.id ?? "");
      }
    });
    if (nodesToLayout.length > 0) {
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
        nodes: [...nodes.values()].filter((n) => nodesToLayout.includes(n.id ?? "")) as any,
        edges: edges.filter(
          (e) =>
            nodesToLayout.includes(typeof e.source === "string" ? e.source : (e.source.cell as string)) &&
            nodesToLayout.includes(typeof e.target === "string" ? e.target : (e.target.cell as string)),
        ) as any,
      };
      const newModel = dagreLayout.layout(model);
      newModel.nodes?.forEach((n: any) => {
        const node = nodes.get(n.id);
        if (node) {
          node.x = n.x;
          node.y = n.y;
        }
      });
    }

    g.fromJSON({ nodes: [...nodes.values()], edges: edges });
    g.cleanSelection();

    if (lastClassRef.current === props.classInstance.name) {
      const targetZoom = lastZoomRef.current;
      if (targetZoom) {
        g.zoomTo(targetZoom.zoom);
        g.translate(targetZoom.tx, targetZoom.ty);
      }
    } else {
      let extent = diagram?.coordinateSystem?.extent;
      if (!extent || extent.length < 2) {
        extent = [
          [-100, -100],
          [100, 100],
        ];
      }

      const p1 = convertPoint(extent[0], [-100, -100]);
      const width = computeWidth(extent);
      const height = computeHeight(extent);
      const bgRect = {
        x: p1[0],
        y: -p1[1],
        width,
        height,
      };

      const expandedRect = {
        x: bgRect.x - bgRect.width * 0.125,
        y: bgRect.y - bgRect.height * 0.125,
        width: bgRect.width * 1.25,
        height: bgRect.height * 1.25,
      };
      g.zoomToRect(expandedRect);
    }
    lastClassRef.current = props.classInstance.name;

    g.on("scale", () => {
      lastZoomRef.current = { zoom: g.zoom(), tx: g.translate().tx, ty: g.translate().ty };
    });
    g.on("translate", () => {
      lastZoomRef.current = { zoom: g.zoom(), tx: g.translate().tx, ty: g.translate().ty };
    });
  }, [props.classInstance, props.theme]);

  const lastClassRef = useRef<string | null | undefined>(undefined);
  const lastZoomRef = useRef<{ zoom: number; tx: number; ty: number } | null>(null);

  return (
    <div
      ref={refContainer}
      className="height-full width-full"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const data = e.dataTransfer.getData("application/json");
        if (data && graph) {
          try {
            const { className } = JSON.parse(data);
            const p = graph.clientToLocal(e.clientX, e.clientY);
            if (props.onDrop) {
              props.onDrop(className, p.x, p.y);
            }
          } catch (e) {
            console.error(e);
          }
        }
      }}
    />
  );
});

export default DiagramEditor;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function marker(arrow: Arrow | null | undefined, strokeColor: string, strokeWidth: number): any {
  switch (arrow) {
    case Arrow.FILLED:
      return {
        tagName: "path",
        d: "M 0 0 L 10 5 L 10 -5 Z",
        strokeWidth,
        fill: strokeColor,
        stroke: strokeColor,
      };
    case Arrow.HALF:
      return {
        tagName: "path",
        d: "M 0 0 L 10 5",
        strokeWidth,
        fill: strokeColor,
        stroke: strokeColor,
      };
    case Arrow.OPEN:
      return {
        tagName: "path",
        d: "M 0 0 L 10 5 L 0 0 L 10 -5",
        strokeWidth,
        fill: "none",
        stroke: strokeColor,
      };
    default:
      return {};
  }
}
