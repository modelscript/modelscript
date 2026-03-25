import { DagreLayout } from "@antv/layout";
import { Graph } from "@antv/x6";

interface NotebookRendererOutputItem {
  json(): unknown;
}

interface DiagramData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edges: any[];
  coordinateSystem?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  diagramBackground?: unknown;
}

export function activate() {
  return {
    renderOutputItem(outputItem: NotebookRendererOutputItem, element: HTMLElement) {
      const data = outputItem.json() as DiagramData;

      // Clear any previous render
      element.innerHTML = "";

      const wrapper = document.createElement("div");
      wrapper.style.position = "relative";
      wrapper.style.width = "100%";
      wrapper.style.height = "400px";
      wrapper.style.maxHeight = "400px";
      wrapper.style.backgroundColor = "transparent";
      wrapper.style.border = "1px solid var(--vscode-notebook-cellBorderColor, #ccc)";
      wrapper.style.borderRadius = "4px";
      wrapper.style.overflow = "hidden";

      element.style.overflow = "hidden";
      element.style.maxHeight = "402px"; // 400px + 2px border
      element.appendChild(wrapper);

      const graph = new Graph({
        container: wrapper,
        width: wrapper.clientWidth || 600,
        height: 400,
        async: false,
        autoResize: false,
        background: { color: "transparent" },
        interacting: false,
        panning: { enabled: true },
        mousewheel: { enabled: true, global: false, modifiers: "ctrl" },
      });

      const nodes = data.nodes ?? [];
      const edges = data.edges ?? [];

      // Auto-layout nodes that lack placement annotations
      const nodesToLayout: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodes.forEach((node: any) => {
        if (node.autoLayout) {
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
          nodes: nodes.filter((n: { id?: string }) => nodesToLayout.includes(n.id ?? "")),
          edges: edges
            .filter((e: { source: string | { cell: string }; target: string | { cell: string } }) => {
              const s = typeof e.source === "string" ? e.source : e.source.cell;
              const t = typeof e.target === "string" ? e.target : e.target.cell;
              return nodesToLayout.includes(s) && nodesToLayout.includes(t);
            })
            .map((e: { source: string | { cell: string }; target: string | { cell: string } }) => ({
              source: typeof e.source === "string" ? e.source : e.source.cell,
              target: typeof e.target === "string" ? e.target : e.target.cell,
            })),
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const newModel = dagreLayout.layout(model as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        newModel.nodes?.forEach((n: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const node = nodes.find((no: any) => no.id === n.id);
          if (node) {
            node.x = n.x;
            node.y = n.y;
          }
        });
      }

      graph.fromJSON({ nodes, edges });

      // Use the coordinate system to properly fit the diagram in view
      const cs = data.coordinateSystem;
      if (cs) {
        const expandedRect = {
          x: cs.x - cs.width * 0.125,
          y: cs.y - cs.height * 0.125,
          width: cs.width * 1.25,
          height: cs.height * 1.25,
        };
        graph.zoomToRect(expandedRect);
      } else {
        graph.zoomToFit({ padding: 20 });
      }
    },
  };
}
