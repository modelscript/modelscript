/* eslint-disable @typescript-eslint/no-explicit-any */
import { Graph, type EdgeMetadata, type NodeMetadata } from "@antv/x6";
import { useEffect, useRef, useState } from "react";
import {
  type ModelicaClassInstance,
  ModelicaClassKind,
  renderIcon,
  computeIconPlacement,
  computeWidth,
} from "@modelscript/modelscript";
import { DagreLayout } from "@antv/layout";

export default function Diagram({ classInstance }: { classInstance: ModelicaClassInstance | null }) {
  const refContainer = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  useEffect(() => {
    if (!refContainer.current) return;
    if (!graph) {
      refContainer.current.innerHTML = "";
      setGraph(
        new Graph({
          container: refContainer.current,
          autoResize: true,
          grid: {
            type: "doubleMesh",
            size: 20,
            visible: true,
          },
          connecting: {
            router: "orth",
          },
        }),
      );
    }
    if (!classInstance) return;
    const nodes = new Map<string, NodeMetadata>();
    const edges: EdgeMetadata[] = [];
    for (const component of classInstance.components) {
      if (!component.name) continue;
      const componentClassInstance = component.classInstance;
      if (!componentClassInstance) continue;
      const componentSvg = renderIcon(componentClassInstance, component, false);
      if (!componentSvg) continue;
      const ports: any[] = [];
      const componentTransform = computeIconPlacement(component);
      for (const connector of component.classInstance?.components ?? []) {
        const connectorClassInstance = connector.classInstance;
        if (!connectorClassInstance || connectorClassInstance.classKind !== ModelicaClassKind.CONNECTOR) continue;
        const connectorSvg = renderIcon(connectorClassInstance);
        if (connectorSvg) {
          const connectorTransform = computeIconPlacement(connector);
          ports.push({
            id: connector.name,
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
    for (const connectEquation of classInstance.connectEquations) {
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
    graph?.fromJSON(dagreLayout.layout({ nodes: [...nodes.values()] as any, edges: edges as any }));
  }, [classInstance]);
  return <div ref={refContainer} />;
}
