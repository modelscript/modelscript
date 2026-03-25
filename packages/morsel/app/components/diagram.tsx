// SPDX-License-Identifier: AGPL-3.0-or-later

import { DagreLayout } from "@antv/layout";
import { Graph, Keyboard, Selection, Snapline, Transform, type EdgeMetadata, type NodeMetadata } from "@antv/x6";
import type { PortMetadata } from "@antv/x6/lib/model/port";
import {
  computeHeight,
  computeIconPlacement,
  computePortPlacement,
  computeWidth,
  convertPoint,
  evaluateCondition,
  LinePattern,
  ModelicaClassKind,
  ModelicaElement,
  Smooth,
  type IDiagram,
  type IIcon,
  type ILine,
  type ModelicaClassInstance,
} from "@modelscript/core";
import type { Theme } from "@monaco-editor/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { invertColorHelmlab, invertMarkupColors, invertSvgColors, renderDiagramX6, renderIconX6 } from "../util/x6";

export interface DiagramEditorHandle {
  showLoading: () => void;
  hideLoading: () => void;
  fitContent: () => void;
  layout: () => void;
}

interface DiagramEditorProps {
  classInstance: ModelicaClassInstance | null;
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
  classInstance: ModelicaClassInstance,
  theme: Theme,
  lastClassRef: React.MutableRefObject<string | null | undefined>,
  lastZoomRef: React.MutableRefObject<{ zoom: number; tx: number; ty: number } | null>,
) {
  const isDark = theme === "vs-dark";

  // Remove any placeholder node from a previous drop
  const placeholder = g.getCellById("__drop_placeholder__");
  if (placeholder) g.removeCell(placeholder);

  const nodes = new Map<string, NodeMetadata>();
  const edges: EdgeMetadata[] = [];
  for (const component of classInstance.components) {
    if (!component.name) continue;

    const condition = evaluateCondition(component);
    if (condition === false) continue;

    const componentClassInstance = component.classInstance;
    if (!componentClassInstance) continue;
    let componentTransform = computeIconPlacement(component);
    const autoLayout = !componentTransform;
    if (!componentTransform) {
      const icon = componentClassInstance.annotation("Icon") as IIcon | null;
      const naturalWidth = computeWidth(icon?.coordinateSystem?.extent) || 200;
      const naturalHeight = computeHeight(icon?.coordinateSystem?.extent) || 200;
      const scaleX = 20 / naturalWidth;
      const scaleY = 20 / naturalHeight;
      componentTransform = {
        originX: 0,
        originY: 0,
        rotate: 0,
        scaleX,
        scaleY,
        translateX: -(naturalWidth * scaleX) / 2,
        translateY: -(naturalHeight * scaleY) / 2,
        width: naturalWidth * scaleX,
        height: naturalHeight * scaleY,
      };
    }
    const absScaleX = Math.abs(componentTransform.scaleX);
    const absScaleY = Math.abs(componentTransform.scaleY);
    const absWidth = Math.abs(componentTransform.width);
    const absHeight = Math.abs(componentTransform.height);
    const flipX = componentTransform.scaleX < 0;
    const flipY = componentTransform.scaleY < 0;
    let componentMarkup = invertMarkupColors(renderIconX6(componentClassInstance, component, false), isDark);
    if (flipX || flipY) {
      const sx = flipX ? -1 : 1;
      const sy = flipY ? -1 : 1;
      const unflipText = (node: any): void => {
        if (!node?.children) return;
        for (const child of node.children) {
          if (child.tagName === "text") {
            if (!child.attrs) child.attrs = {};
            const style = (child.attrs.style as string) || "";
            const scaleMatch = style.match(/transform:\s*scale\(([^,]+),\s*([^)]+)\)/);
            if (scaleMatch) {
              const existingScaleX = parseFloat(scaleMatch[1]);
              const existingScaleY = parseFloat(scaleMatch[2]);
              child.attrs.style = style.replace(
                /transform:\s*scale\([^)]+\)/,
                `transform: scale(${sx * existingScaleX}, ${sy * existingScaleY})`,
              );
            } else {
              const textX = child.attrs.x ?? 0;
              const textY = child.attrs.y ?? 0;
              child.attrs.style = style + `; transform: scale(${sx}, ${sy}); transform-origin: ${textX}px ${textY}px;`;
            }
          }
          unflipText(child);
        }
      };
      unflipText(componentMarkup);
      const tx = flipX ? absWidth : 0;
      const ty = flipY ? absHeight : 0;
      componentMarkup = {
        tagName: "g",
        attrs: { transform: `translate(${tx}, ${ty}) scale(${sx}, ${sy})` },
        children: [componentMarkup],
      } as any;
    }
    const ports: PortMetadata[] = [];
    for (const connector of componentClassInstance.components) {
      const connectorCondition = evaluateCondition(connector);
      if (connectorCondition === false) continue;

      const connectorClassInstance = connector.classInstance;
      if (!connectorClassInstance || connectorClassInstance.classKind !== ModelicaClassKind.CONNECTOR) continue;
      const connectorTransform = computePortPlacement(connector);
      if (!connectorTransform) continue;
      let connectorMarkup = invertMarkupColors(renderIconX6(connectorClassInstance), isDark);
      if (flipX || flipY) {
        const psx = flipX ? -1 : 1;
        const psy = flipY ? -1 : 1;
        const ptx = flipX ? connectorTransform.width * absScaleX : 0;
        const pty = flipY ? connectorTransform.height * absScaleY : 0;
        connectorMarkup = {
          tagName: "g",
          attrs: { transform: `translate(${ptx}, ${pty}) scale(${psx}, ${psy})` },
          children: [connectorMarkup],
        } as any;
      }
      const a = connectorTransform.rotate * (Math.PI / 180);
      const extCenterOffX = connectorTransform.translateX - connectorTransform.originX + connectorTransform.width / 2;
      const extCenterOffY = connectorTransform.translateY - connectorTransform.originY + connectorTransform.height / 2;
      const connCenterX = connectorTransform.originX + extCenterOffX * Math.cos(a) - extCenterOffY * Math.sin(a);
      const connCenterY = connectorTransform.originY + extCenterOffX * Math.sin(a) + extCenterOffY * Math.cos(a);
      const portWidth = connectorTransform.width * absScaleX;
      const portHeight = connectorTransform.height * absScaleY;
      const desiredCenterX = absWidth / 2 + connCenterX * componentTransform.scaleX;
      const desiredCenterY = absHeight / 2 + connCenterY * componentTransform.scaleY;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const portX = desiredCenterX - (portWidth / 2) * cosA + (portHeight / 2) * sinA;
      const portY = desiredCenterY - (portWidth / 2) * sinA - (portHeight / 2) * cosA;
      ports.push({
        id: connector.name ?? "",
        group: "absolute",
        args: { x: portX, y: portY, angle: connectorTransform.rotate },
        markup: {
          tagName: "svg",
          children: [connectorMarkup],
          attrs: {
            magnet: "true",
            width: connectorTransform.width * absScaleX,
            height: connectorTransform.height * absScaleY,
            style: `overflow: visible${connectorCondition === undefined ? "; opacity: 0.5" : ""}`,
          },
        },
      });
    }
    const a = componentTransform.rotate * (Math.PI / 180);
    const relTranslateX = absWidth / 2 + componentTransform.translateX - componentTransform.originX;
    const relTranslateY = absHeight / 2 + componentTransform.translateY - componentTransform.originY;
    nodes.set(component.name, {
      id: component.name,
      autoLayout,
      zIndex: 10,
      opacity: condition === undefined ? 0.5 : 1,
      x: relTranslateX * Math.cos(a) - relTranslateY * Math.sin(a) - absWidth / 2 + componentTransform.originX,
      y: relTranslateX * Math.sin(a) + relTranslateY * Math.cos(a) - absHeight / 2 + componentTransform.originY,
      angle: componentTransform.rotate,
      width: absWidth,
      height: absHeight,
      markup: {
        tagName: "svg",
        children: [
          { tagName: "rect", attrs: { style: "fill: transparent; stroke:none", width: absWidth, height: absHeight } },
          componentMarkup,
        ],
        attrs: { preserveAspectRatio: "none", width: absWidth, height: absHeight, style: "overflow: visible" },
      },
      ports: {
        items: ports,
        groups: { absolute: { position: "absolute", zIndex: 100 } },
      },
    } as any);
  }
  for (const connectEquation of classInstance.connectEquations) {
    const c1 = connectEquation.componentReference1?.parts.map((c) => c.identifier?.text ?? "");
    const c2 = connectEquation.componentReference2?.parts.map((c) => c.identifier?.text ?? "");
    if (!c1 || !c2 || c1.length === 0 || c2.length === 0) continue;
    if (!nodes.has(c1[0]) || !nodes.has(c2[0])) continue;
    const annotations = ModelicaElement.instantiateAnnotations(classInstance, connectEquation.annotationClause);
    const line: ILine | null = classInstance.annotation("Line", annotations);
    const rawStrokeColor = `rgb(${line?.color?.[0] ?? 0}, ${line?.color?.[1] ?? 0}, ${line?.color?.[2] ?? 255})`;
    const strokeColor = theme === "vs-dark" ? invertColorHelmlab(rawStrokeColor) : rawStrokeColor;
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
    const sourceMarker = marker(line?.arrow?.[0], strokeColor, strokeWidth);
    const targetMarker = marker(line?.arrow?.[1], strokeColor, strokeWidth);
    edges.push({
      id: `${c1[0]}.${c1?.[1]}-${c2[0]}.${c2?.[1]}`,
      shape: "edge",
      zIndex: 1,
      source: { cell: c1[0], port: c1?.[1], anchor: "center", connectionPoint: { name: "anchor" } },
      target: { cell: c2[0], port: c2?.[1], anchor: "center", connectionPoint: { name: "anchor" } },
      vertices: line?.points
        ?.slice(1, -1)
        ?.map((p) => convertPoint(p))
        .map((p) => ({ x: p[0], y: p[1] })),
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
          "pointer-events": "stroke",
        },
      },
    });
  }

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
  xAxis!.setAttribute("x1", "-100000");
  xAxis!.setAttribute("y1", "0");
  xAxis!.setAttribute("x2", "100000");
  xAxis!.setAttribute("y2", "0");

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
  yAxis!.setAttribute("x1", "0");
  yAxis!.setAttribute("y1", "-100000");
  yAxis!.setAttribute("x2", "0");
  yAxis!.setAttribute("y2", "100000");

  const diagram: IDiagram | null = classInstance.annotation("Diagram");
  const ext0 = diagram?.coordinateSystem?.extent?.[0] ?? [-100, -100];
  const ext1 = diagram?.coordinateSystem?.extent?.[1] ?? [100, 100];
  const bgWidth = computeWidth(diagram?.coordinateSystem?.extent);
  const bgHeight = computeHeight(diagram?.coordinateSystem?.extent);
  const csX = Math.min(ext0[0], ext1[0]);
  const csY = -Math.max(ext0[1], ext1[1]);

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
  coordinateSystem!.setAttribute("x", String(csX));
  coordinateSystem!.setAttribute("y", String(csY));
  coordinateSystem!.setAttribute("width", String(bgWidth));
  coordinateSystem!.setAttribute("height", String(bgHeight));

  if (diagram) {
    const rawDiagramMarkup = renderDiagramX6(classInstance);
    const diagramMarkup = rawDiagramMarkup ? invertMarkupColors(rawDiagramMarkup, isDark) : null;
    if (diagramMarkup) {
      nodes.set("__diagram_background__", {
        id: "__diagram_background__",
        x: csX,
        y: csY,
        width: bgWidth,
        height: bgHeight,
        zIndex: -1,
        movable: false,
        selectable: false,
        markup: {
          tagName: "svg",
          children: [
            { tagName: "rect", attrs: { style: "fill: transparent; stroke: none", width: bgWidth, height: bgHeight } },
            diagramMarkup,
          ],
          attrs: { preserveAspectRatio: "none", width: bgWidth, height: bgHeight, style: "overflow: visible" },
        },
      } as any);
    }
  }

  const nodesToLayout: string[] = [];
  nodes.forEach((node) => {
    if ((node as any).autoLayout) nodesToLayout.push(node.id ?? "");
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

  const isNewClass = lastClassRef.current !== classInstance.name;

  if (isNewClass) {
    g.fromJSON({ nodes: [...nodes.values()] as any, edges: edges as any });
  } else {
    g.batchUpdate(() => {
      const currentCells = g.getCells();
      const newCellIds = new Set([...nodes.keys(), ...edges.map((e) => e.id!)]);
      currentCells.forEach((cell) => {
        if (!newCellIds.has(cell.id)) g.removeCell(cell);
      });

      const newNodes: NodeMetadata[] = [];
      nodes.forEach((metadata, id) => {
        const node = g.getCellById(id);
        if (node && node.isNode()) {
          // Remove stale ports before updating — .prop() deep-merges and won't
          // remove ports that disappeared (e.g. conditional ports toggled off).
          const existingPorts = (node as any).getPorts?.() ?? [];
          const newPortIds = new Set(((metadata as any).ports?.items ?? []).map((p: any) => p.id));
          for (const port of existingPorts) {
            if (port.id && !newPortIds.has(port.id)) {
              (node as any).removePort(port.id);
            }
          }
          (node as any).prop(metadata);
        } else newNodes.push(metadata as any);
      });
      if (newNodes.length > 0) g.addNodes(newNodes);

      const newEdges: EdgeMetadata[] = [];
      edges.forEach((metadata) => {
        const edge = g.getCellById(metadata.id!);
        if (edge && edge.isEdge()) (edge as any).prop(metadata);
        else newEdges.push(metadata as any);
      });
      if (newEdges.length > 0) g.addEdges(newEdges);
    });
  }

  if (lastClassRef.current === classInstance.name) {
    const targetZoom = lastZoomRef.current;
    if (targetZoom) {
      g.zoomTo(targetZoom.zoom);
      g.translate(targetZoom.tx, targetZoom.ty);
    }
  } else {
    let extent = diagram?.coordinateSystem?.extent;
    if (!extent || extent.length < 2)
      extent = [
        [-100, -100],
        [100, 100],
      ];
    const p1 = convertPoint(extent[0], [-100, -100]);
    const width = computeWidth(extent);
    const height = computeHeight(extent);
    const bgRect = { x: p1[0], y: -p1[1], width, height };
    const expandedRect = {
      x: bgRect.x - bgRect.width * 0.125,
      y: bgRect.y - bgRect.height * 0.125,
      width: bgRect.width * 1.25,
      height: bgRect.height * 1.25,
    };
    g.zoomToRect(expandedRect);
  }
  lastClassRef.current = classInstance.name;

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

    // We no longer remove these elements on every update to prevent flickering.
    // They will be updated or created below if they don't exist.

    if (!props.classInstance) {
      g.clearCells();
      setLoading(false);
      return;
    }

    // Only show the spinner when switching to a different class (e.g. from library tree).
    // Code edits re-render the same class and don't need a spinner overlay.
    const isNewClass = lastClassRef.current !== props.classInstance.name;
    if (isNewClass) {
      setLoading(true);
    }

    // Capture values needed inside the deferred callback
    const classInstance = props.classInstance;
    const theme = props.theme;

    // Double-rAF ensures the spinner is actually painted before we block.
    renderRafRef.current = requestAnimationFrame(() => {
      renderRafRef.current = requestAnimationFrame(() => {
        renderDiagram(g, classInstance, theme, lastClassRef, lastZoomRef);
        setLoading(false);
      });
    });

    return () => {
      if (renderRafRef.current != null) {
        cancelAnimationFrame(renderRafRef.current);
        renderRafRef.current = null;
      }
    };
  }, [props.classInstance, props.theme]);

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
