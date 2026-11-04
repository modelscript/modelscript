// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — Boeing / MSC Software EASY5 Schematic & Control Architecture Diagram Builder.
 *
 * Translates EASY5 dynamic system models into:
 * 1. Interactive AntV X6 graph structures with component ports and orthogonal wiring.
 * 2. High-resolution standalone vector SVG schematics with theme adaptability (dark/light)
 *    and automatic topological layout calculation.
 */

export interface Easy5PortLike {
  name: string;
  kind?: "input" | "output" | "bidirectional" | string | undefined;
  dimension?: number | undefined;
  dataType?: string | undefined;
  description?: string | undefined;
}

export interface Easy5ComponentLike {
  id: string;
  type: string;
  title?: string | undefined;
  parameters?: Record<string, number | number[] | string> | undefined;
  initialStates?: Record<string, number> | undefined;
  ports?: Record<string, Easy5PortLike> | undefined;
  location?: { x: number; y: number } | undefined;
}

export interface Easy5ConnectionLike {
  fromComponent: string;
  fromPort: string;
  toComponent: string;
  toPort: string;
}

export interface Easy5ModelLike {
  name: string;
  title?: string | undefined;
  components: Map<string, Easy5ComponentLike> | Record<string, Easy5ComponentLike> | Easy5ComponentLike[];
  connections: Easy5ConnectionLike[];
}

export interface Easy5DiagramNode {
  id: string;
  shape: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | undefined;
  attrs?: Record<string, unknown> | undefined;
  ports?:
    | {
        groups?: Record<string, unknown> | undefined;
        items?: { id: string; group: string; attrs?: Record<string, unknown> }[] | undefined;
      }
    | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface Easy5DiagramEdge {
  id: string;
  shape?: string | undefined;
  source: { cell: string; port?: string | undefined };
  target: { cell: string; port?: string | undefined };
  router?: { name: string; args?: Record<string, unknown> } | string | undefined;
  connector?: { name: string; args?: Record<string, unknown> } | string | undefined;
  attrs?: Record<string, unknown> | undefined;
  labels?: { attrs: { text: { text: string } } }[] | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface Easy5DiagramGraph {
  title: string;
  nodes: Easy5DiagramNode[];
  edges: Easy5DiagramEdge[];
  cells?: (Easy5DiagramNode | Easy5DiagramEdge)[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface Easy5RenderOptions {
  theme?: "dark" | "light" | undefined;
  isDark?: boolean | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

function normalizeComponents(
  comps: Map<string, Easy5ComponentLike> | Record<string, Easy5ComponentLike> | Easy5ComponentLike[],
): Easy5ComponentLike[] {
  if (comps instanceof Map) {
    return Array.from(comps.values());
  }
  if (Array.isArray(comps)) {
    return comps;
  }
  return Object.values(comps);
}

/**
 * Computes topological layered coordinates for EASY5 blocks when explicit coordinates are absent.
 */
export function computeEasy5Layout(
  components: Easy5ComponentLike[],
  connections: Easy5ConnectionLike[],
): Map<string, { x: number; y: number }> {
  const coords = new Map<string, { x: number; y: number }>();
  const unplaced: Easy5ComponentLike[] = [];

  for (const c of components) {
    if (c.location && typeof c.location.x === "number" && typeof c.location.y === "number") {
      coords.set(c.id, { x: c.location.x, y: c.location.y });
    } else {
      unplaced.push(c);
    }
  }

  if (unplaced.length === 0) {
    return coords;
  }

  // Build adjacency and in-degree maps for unplaced nodes
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const c of unplaced) {
    inDegree.set(c.id, 0);
    adj.set(c.id, []);
  }

  for (const conn of connections) {
    if (inDegree.has(conn.toComponent)) {
      inDegree.set(conn.toComponent, (inDegree.get(conn.toComponent) ?? 0) + 1);
    }
    if (adj.has(conn.fromComponent)) {
      adj.get(conn.fromComponent)!.push(conn.toComponent);
    }
  }

  const layers: string[][] = [];
  let currentLayer = unplaced.filter((c) => (inDegree.get(c.id) ?? 0) === 0).map((c) => c.id);

  if (currentLayer.length === 0 && unplaced.length > 0) {
    currentLayer = [unplaced[0]!.id];
  }

  const visited = new Set<string>(currentLayer);
  layers.push(currentLayer);

  while (visited.size < unplaced.length) {
    const nextLayer: string[] = [];
    for (const id of currentLayer) {
      for (const nbr of adj.get(id) ?? []) {
        if (!visited.has(nbr) && inDegree.has(nbr)) {
          visited.add(nbr);
          nextLayer.push(nbr);
        }
      }
    }
    if (nextLayer.length === 0) {
      for (const c of unplaced) {
        if (!visited.has(c.id)) {
          visited.add(c.id);
          nextLayer.push(c.id);
          break;
        }
      }
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  const layerSpacingX = 220;
  const nodeSpacingY = 110;
  const startX = 80;
  const startY = 80;

  for (let l = 0; l < layers.length; l++) {
    const layer = layers[l]!;
    const totalH = (layer.length - 1) * nodeSpacingY;
    const yOffset = startY + Math.max(0, (260 - totalH) / 2);

    for (let i = 0; i < layer.length; i++) {
      const id = layer[i]!;
      coords.set(id, {
        x: startX + l * layerSpacingX,
        y: yOffset + i * nodeSpacingY,
      });
    }
  }

  return coords;
}

/**
 * Builds an interactive AntV X6 graph model for an EASY5 model.
 */
export function buildEasy5Diagram(model: Easy5ModelLike): Easy5DiagramGraph {
  const components = normalizeComponents(model.components);
  const coords = computeEasy5Layout(components, model.connections);
  const nodes: Easy5DiagramNode[] = [];
  const edges: Easy5DiagramEdge[] = [];

  for (const comp of components) {
    const pt = coords.get(comp.id) ?? { x: 100, y: 100 };
    const portItems: { id: string; group: string; attrs?: Record<string, unknown> }[] = [];

    if (comp.ports) {
      for (const [pName, port] of Object.entries(comp.ports)) {
        const isOut = port.kind === "output";
        portItems.push({
          id: pName,
          group: isOut ? "out" : "in",
          attrs: {
            text: { text: pName, fill: "#94a3b8", fontSize: 9 },
          },
        });
      }
    }

    nodes.push({
      id: comp.id,
      shape: "rect",
      x: pt.x,
      y: pt.y,
      width: 120,
      height: 68,
      label: `${comp.id}\n[${comp.type}]`,
      attrs: {
        body: {
          fill: "#1e293b",
          stroke: "#38bdf8",
          strokeWidth: 2,
          rx: 6,
          ry: 6,
        },
        label: {
          fill: "#f8fafc",
          fontSize: 12,
          fontWeight: "600",
        },
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: { r: 4, magnet: true, stroke: "#38bdf8", fill: "#0f172a", strokeWidth: 1.5 },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: { r: 4, magnet: true, stroke: "#38bdf8", fill: "#0f172a", strokeWidth: 1.5 },
            },
          },
        },
        items: portItems,
      },
      data: {
        id: comp.id,
        type: comp.type,
        title: comp.title,
        parameters: comp.parameters,
        initialStates: comp.initialStates,
      },
    });
  }

  let edgeIdx = 1;
  for (const conn of model.connections) {
    edges.push({
      id: `edge_${edgeIdx++}`,
      shape: "edge",
      source: { cell: conn.fromComponent, port: conn.fromPort },
      target: { cell: conn.toComponent, port: conn.toPort },
      router: { name: "orth" },
      connector: { name: "rounded", args: { radius: 8 } },
      attrs: {
        line: {
          stroke: "#38bdf8",
          strokeWidth: 1.8,
          targetMarker: {
            name: "block",
            width: 8,
            height: 6,
          },
        },
      },
      labels: [{ attrs: { text: { text: `${conn.fromPort}->${conn.toPort}` } } }],
    });
  }

  return {
    title: model.title || `${model.name} - EASY5 Control System`,
    nodes,
    edges,
    cells: [...nodes, ...edges],
    metadata: {
      readOnly: true,
      domain: "easy5",
      componentCount: components.length,
      connectionCount: model.connections.length,
    },
  };
}

/**
 * Renders an EASY5 model into an adaptable vector SVG drawing.
 */
export function renderEasy5SchematicSvg(model: Easy5ModelLike, options?: Easy5RenderOptions): string {
  const isDark = options?.isDark ?? options?.theme !== "light";
  const graph = buildEasy5Diagram(model);

  // Compute dynamic viewBox with padding
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of graph.nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  if (minX === Infinity) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 500;
  }

  const padding = 50;
  const vbX = Math.max(0, minX - padding);
  const vbY = Math.max(0, minY - padding - 40);
  const vbW = Math.max(700, maxX - minX + padding * 2);
  const vbH = Math.max(450, maxY - minY + padding * 2 + 40);

  const width = options?.width ?? vbW;
  const height = options?.height ?? vbH;

  const bg = isDark ? "#0f172a" : "#f8fafc";
  const cardBg = isDark ? "#1e293b" : "#ffffff";
  const cardBorder = isDark ? "#38bdf8" : "#0284c7";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";
  const wireColor = isDark ? "#38bdf8" : "#0284c7";

  const nodeMap = new Map<string, Easy5DiagramNode>();
  for (const n of graph.nodes) {
    nodeMap.set(n.id, n);
  }

  const svgParts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${width}" height="${height}" style="background-color: ${bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">`,
    "  <defs>",
    `    <marker id="easy5-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `      <path d="M 0 1 L 9 5 L 0 9 z" fill="${wireColor}" />`,
    "    </marker>",
    "  </defs>",
    `  <text x="${vbX + 30}" y="${vbY + 32}" fill="${textColor}" font-size="18" font-weight="bold">${model.name} - EASY5 Schematic</text>`,
    `  <text x="${vbX + 30}" y="${vbY + 52}" fill="${subTextColor}" font-size="12">${model.title || "Dynamic Simulation & Control System Architecture"}</text>`,
  ];

  // Render nodes
  for (const node of graph.nodes) {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const typeLabel = String(node.data?.["type"] || "BLOCK");

    svgParts.push(
      `  <g id="node_${node.id}">`,
      `    <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" fill="${cardBg}" stroke="${cardBorder}" stroke-width="2" />`,
      `    <text x="${cx}" y="${cy - 4}" fill="${textColor}" font-size="13" font-weight="bold" text-anchor="middle">${node.id}</text>`,
      `    <text x="${cx}" y="${cy + 15}" fill="${subTextColor}" font-size="11" text-anchor="middle">[${typeLabel}]</text>`,
      `  </g>`,
    );
  }

  // Render edges
  for (const edge of graph.edges) {
    const from = nodeMap.get(edge.source.cell);
    const to = nodeMap.get(edge.target.cell);
    if (!from || !to) continue;

    const startX = from.x + from.width;
    const startY = from.y + from.height / 2;
    const endX = to.x;
    const endY = to.y + to.height / 2;

    const midX = (startX + endX) / 2;
    const pathD = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;

    svgParts.push(
      `  <path d="${pathD}" fill="none" stroke="${wireColor}" stroke-width="1.8" marker-end="url(#easy5-arrow)" />`,
    );
  }

  svgParts.push("</svg>");
  return svgParts.join("\n");
}
