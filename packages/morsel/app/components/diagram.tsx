// SPDX-License-Identifier: AGPL-3.0-or-later

import { Graph, type EdgeMetadata, type NodeMetadata } from "@antv/x6";
import { useEffect, useRef, useState } from "react";
import {
  type ModelicaClassInstance,
  ModelicaClassKind,
  renderIcon,
  computeIconPlacement,
} from "@modelscript/modelscript";
import { DagreLayout } from "@antv/layout";
import type { Theme } from "@monaco-editor/react";
import type { PortMetadata } from "@antv/x6/lib/model/port";

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
              x: (componentTransform?.width ?? 200) / 2 + (connectorTransform?.translateX ?? 0),
              y: (componentTransform?.height ?? 200) / 2 + (connectorTransform?.translateY ?? 0),
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
                width: connectorTransform?.width,
                height: connectorTransform?.height,
                magnet: true,
              },
            },
          });
        }
      }
      nodes.set(component.name, {
        id: component.name,
        shape: "image",
        x: (componentTransform?.width ?? 200) / 2,
        y: (componentTransform?.height ?? 200) / 2,
        width: componentTransform?.width ?? 200,
        height: componentTransform?.height ?? 200,
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
      const c1 = connectEquation.componentReference1?.components.map((c) => c.identifier?.value ?? "").join(".");
      const c2 = connectEquation.componentReference2?.components.map((c) => c.identifier?.value ?? "").join(".");
      if (!c1 || !c2) continue;
      if (!nodes.has(c1) || !nodes.has(c2)) continue;
      edges.push({
        source: c1,
        target: c2,
        tools: {
          name: "vertices",
        },
      });
    }
    const dagreLayout = new DagreLayout();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.fromJSON(dagreLayout.layout({ nodes: [...nodes.values()] as any, edges: edges as any }));
    g.zoomToFit({ useCellGeometry: true });
  }, [props.classInstance, props.theme]);
  return <div ref={refContainer} />;
}
