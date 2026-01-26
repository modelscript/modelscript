// SPDX-License-Identifier: AGPL-3.0-or-later

import { Graph, type EdgeMetadata, type NodeMetadata } from "@antv/x6";
import type { PortMetadata } from "@antv/x6/lib/model/port";
import {
  Arrow,
  computeIconPlacement,
  convertPoint,
  LinePattern,
  ModelicaClassKind,
  ModelicaElement,
  renderIcon,
  Smooth,
  toEnum,
  type ILine,
  type ModelicaClassInstance,
} from "@modelscript/modelscript";
import type { Theme } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";

interface DiagramEditorProps {
  classInstance: ModelicaClassInstance | null;
  theme: Theme;
}

export default function DiagramEditor(props: DiagramEditorProps) {
  const refContainer = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
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
          type: "doubleMesh",
          size: 20,
          visible: true,
          args: [
            { color: props.theme === "vs-dark" ? "#2f2f2f" : "#efefef" },
            { color: props.theme === "vs-dark" ? "#2c2c2c" : "#ececec" },
          ],
        },
        connecting: {
          router: "orth",
        },
        mousewheel: {
          enabled: true,
          global: true,
          modifiers: "ctrl",
        },
        interacting: false,
      });
      setGraph(g);
    } else {
      g = graph;
      g.drawBackground({ color: props.theme === "vs-dark" ? "#1e1e1e" : "#ffffff" });
      g.drawGrid({
        type: "doubleMesh",
        args: [
          { color: props.theme === "vs-dark" ? "#2f2f2f" : "#efefef" },
          { color: props.theme === "vs-dark" ? "#2c2c2c" : "#ececec" },
        ],
      });
    }
    if (!props.classInstance) return;
    const nodes = new Map<string, NodeMetadata>();
    const edges: EdgeMetadata[] = [];
    for (const component of props.classInstance.components) {
      if (!component.name) continue;
      const componentClassInstance = component.classInstance;
      if (!componentClassInstance) continue;
      const componentSvg = renderIcon(componentClassInstance, component, false);
      if (!componentSvg) continue;
      const ports: PortMetadata[] = [];
      const componentTransform = computeIconPlacement(component);
      for (const connector of component.classInstance?.components ?? []) {
        const connectorClassInstance = connector.classInstance;
        if (!connectorClassInstance || connectorClassInstance.classKind !== ModelicaClassKind.CONNECTOR) continue;
        const connectorSvg = renderIcon(connectorClassInstance);
        if (connectorSvg) {
          const connectorTransform = computeIconPlacement(connector);
          ports.push({
            id: connector.name ?? undefined,
            group: "g",
            args: {
              x:
                (componentTransform?.width ?? 200) / 2 +
                (connectorTransform?.translateX ?? 0) * (componentTransform?.scaleX ?? 0.1),
              y:
                (componentTransform?.height ?? 200) / 2 +
                (connectorTransform?.translateY ?? 0) * (componentTransform?.scaleY ?? 0.1),
            },
            markup: [
              {
                tagName: "image",
                selector: "path",
              },
            ],
            attrs: {
              path: {
                href: `data:image/svg+xml,${encodeURIComponent(connectorSvg.svg())}`,
                width: (connectorTransform?.width ?? 200) * (componentTransform?.scaleX ?? 0.1),
                height: (connectorTransform?.height ?? 200) * (componentTransform?.scaleY ?? 0.1),
                magnet: true,
              },
            },
          });
        }
      }
      console.log(componentSvg.svg());
      nodes.set(component.name, {
        id: component.name,
        shape: "image",
        x: componentTransform?.translateX ?? 0,
        y: componentTransform?.translateY ?? 0,
        width: componentTransform?.width ?? 200,
        height: componentTransform?.height ?? 200,
        angle: componentTransform?.rotate ?? 0,
        imageUrl: `data:image/svg+xml,${encodeURIComponent(componentSvg.svg())}`,
        ports: {
          groups: {
            g: {
              position: {
                name: "absolute",
              },
            },
          },
          items: ports,
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
      const strokeColor = `rgb(${line?.color?.[0] ?? 0}, ${line?.color?.[1] ?? 0}, ${line?.color?.[2] ?? 0})`;
      const strokeWidth = (line?.thickness ?? 0.25) * 4;
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
        connector: { name: line?.smooth === Smooth.BEZIER ? "smooth" : undefined },
        router: line?.points && line.points.length > 0 ? "normal" : undefined,
        attrs: {
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
    g.fromJSON({ nodes: [...nodes.values()], edges: edges });
    g.zoomToFit({ useCellGeometry: true });
  }, [props.classInstance, props.theme]);
  return <div ref={refContainer} />;
}

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
