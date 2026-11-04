// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — NASA ROCETS Liquid Rocket Propulsion P&ID Schematic & Flow Diagram Builder.
 *
 * Translates NASA ROCETS engine decks into:
 * 1. AntV X6 graph structures with propulsion module shapes, propellant color codes, and orthogonal flow paths.
 * 2. High-resolution standalone vector SVG schematics with propellant-specific color coding (LOX, LH2, RP-1, Hot Gas)
 *    and theme adaptability (dark/light).
 */

export type RocetsPropellantKind =
  | "LOX"
  | "LH2"
  | "LCH4"
  | "RP1"
  | "GH2"
  | "GOX"
  | "COMBUSTION_GAS"
  | "HOT_GAS"
  | "HELIUM"
  | "NITROGEN"
  | string;

export interface RocetsPortLike {
  name: string;
  direction?: "in" | "out" | "bidirectional" | string | undefined;
  fluid?: RocetsPropellantKind | undefined;
  pressurePa?: number | undefined;
  temperatureK?: number | undefined;
  massFlowKgS?: number | undefined;
}

export interface RocetsComponentLike {
  id: string;
  type: string;
  title?: string | undefined;
  parameters?: Record<string, number | string | number[]> | undefined;
  initialStates?: Record<string, number> | undefined;
  ports?: Record<string, RocetsPortLike> | undefined;
  location?: { x: number; y: number } | undefined;
}

export interface RocetsConnectionLike {
  fromComponent: string;
  fromPort: string;
  toComponent: string;
  toPort: string;
  fluid?: RocetsPropellantKind | undefined;
}

export interface RocetsEngineModelLike {
  name: string;
  title?: string | undefined;
  components: Map<string, RocetsComponentLike> | Record<string, RocetsComponentLike> | RocetsComponentLike[];
  connections: RocetsConnectionLike[];
}

export interface RocetsDiagramNode {
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

export interface RocetsDiagramEdge {
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

export interface RocetsDiagramGraph {
  title: string;
  nodes: RocetsDiagramNode[];
  edges: RocetsDiagramEdge[];
  cells?: (RocetsDiagramNode | RocetsDiagramEdge)[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface RocetsRenderOptions {
  theme?: "dark" | "light" | undefined;
  isDark?: boolean | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

function normalizeComponents(
  comps: Map<string, RocetsComponentLike> | Record<string, RocetsComponentLike> | RocetsComponentLike[],
): RocetsComponentLike[] {
  if (comps instanceof Map) {
    return Array.from(comps.values());
  }
  if (Array.isArray(comps)) {
    return comps;
  }
  return Object.values(comps);
}

export function getRocetsFluidColor(fluid?: string, isGas?: boolean): { stroke: string; marker: string } {
  const norm = (fluid || "").toUpperCase();
  if (norm.includes("LOX") || norm === "GOX") {
    return { stroke: "#38bdf8", marker: "arrow-lox" };
  }
  if (norm.includes("LH2") || norm === "GH2") {
    return { stroke: "#7dd3fc", marker: "arrow-lh2" };
  }
  if (norm.includes("RP1") || norm.includes("RP-1") || norm.includes("KEROSENE")) {
    return { stroke: "#fbbf24", marker: "arrow-rp1" };
  }
  if (norm.includes("CH4") || norm.includes("METHANE")) {
    return { stroke: "#34d399", marker: "arrow-ch4" };
  }
  if (isGas || norm.includes("GAS") || norm.includes("COMBUSTION")) {
    return { stroke: "#f43f5e", marker: "arrow-gas" };
  }
  return { stroke: "#2dd4bf", marker: "arrow-fluid" };
}

export function getRocetsModuleStyle(type: string, isDark: boolean): { stroke: string; fill: string } {
  const t = type.toUpperCase();
  if (t === "CHAMBER" || t === "TC" || t === "COMBUSTOR" || t === "NOZZLE") {
    return {
      stroke: "#f43f5e",
      fill: isDark ? "#2e1018" : "#ffe4e6",
    };
  }
  if (t === "TURBINE") {
    return {
      stroke: "#f97316",
      fill: isDark ? "#2b1408" : "#ffedd5",
    };
  }
  if (t === "PUMP") {
    return {
      stroke: "#10b981",
      fill: isDark ? "#092419" : "#d1fae5",
    };
  }
  if (t === "VALVE") {
    return {
      stroke: "#a855f7",
      fill: isDark ? "#210f36" : "#f3e8ff",
    };
  }
  if (t === "GAS_GENERATOR" || t === "PREBURNER") {
    return {
      stroke: "#fb7185",
      fill: isDark ? "#33121d" : "#ffe4e6",
    };
  }
  if (t === "SHAFT") {
    return {
      stroke: "#94a3b8",
      fill: isDark ? "#1e293b" : "#f1f5f9",
    };
  }
  return {
    stroke: "#38bdf8",
    fill: isDark ? "#0f172a" : "#e0f2fe",
  };
}

/**
 * Computes topological flow layout for ROCETS propulsion components when explicit coordinates are absent.
 */
export function computeRocetsLayout(
  components: RocetsComponentLike[],
  connections: RocetsConnectionLike[],
): Map<string, { x: number; y: number }> {
  const coords = new Map<string, { x: number; y: number }>();
  const unplaced: RocetsComponentLike[] = [];

  for (const c of components) {
    if (c.location && typeof c.location.x === "number" && typeof c.location.y === "number") {
      coords.set(c.id, { x: c.location.x, y: c.location.y });
    } else {
      unplaced.push(c);
    }
  }

  if (unplaced.length === 0) return coords;

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

  const layerSpacingX = 230;
  const nodeSpacingY = 125;
  const startX = 80;
  const startY = 80;

  for (let l = 0; l < layers.length; l++) {
    const layer = layers[l]!;
    const totalH = (layer.length - 1) * nodeSpacingY;
    const yOffset = startY + Math.max(0, (280 - totalH) / 2);

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
 * Builds an interactive AntV X6 graph model for a NASA ROCETS engine model.
 */
export function buildRocetsDiagram(model: RocetsEngineModelLike): RocetsDiagramGraph {
  const components = normalizeComponents(model.components);
  const coords = computeRocetsLayout(components, model.connections);
  const nodes: RocetsDiagramNode[] = [];
  const edges: RocetsDiagramEdge[] = [];

  for (const comp of components) {
    const pt = coords.get(comp.id) ?? { x: 100, y: 100 };
    const style = getRocetsModuleStyle(comp.type, true);
    const portItems: { id: string; group: string; attrs?: Record<string, unknown> }[] = [];

    if (comp.ports) {
      for (const [pName, port] of Object.entries(comp.ports)) {
        const isOut = port.direction === "out";
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
      width: 124,
      height: 70,
      label: `${comp.id}\n[${comp.type}]`,
      attrs: {
        body: {
          fill: style.fill,
          stroke: style.stroke,
          strokeWidth: 2,
          rx: 8,
          ry: 8,
        },
        label: {
          fill: "#f8fafc",
          fontSize: 12,
          fontWeight: "bold",
        },
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: { r: 4, magnet: true, stroke: style.stroke, fill: "#0f172a", strokeWidth: 1.5 },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: { r: 4, magnet: true, stroke: style.stroke, fill: "#0f172a", strokeWidth: 1.5 },
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
  const compMap = new Map<string, RocetsComponentLike>();
  for (const c of components) compMap.set(c.id, c);

  for (const conn of model.connections) {
    const fromComp = compMap.get(conn.fromComponent);
    const isGas =
      conn.fluid?.toUpperCase().includes("GAS") ||
      fromComp?.type.toUpperCase() === "TURBINE" ||
      fromComp?.type.toUpperCase() === "CHAMBER" ||
      fromComp?.type.toUpperCase() === "GAS_GENERATOR";
    const fluidStyle = getRocetsFluidColor(conn.fluid, isGas);

    edges.push({
      id: `edge_${edgeIdx++}`,
      shape: "edge",
      source: { cell: conn.fromComponent, port: conn.fromPort },
      target: { cell: conn.toComponent, port: conn.toPort },
      router: { name: "orth" },
      connector: { name: "rounded", args: { radius: 8 } },
      attrs: {
        line: {
          stroke: fluidStyle.stroke,
          strokeWidth: 2,
          targetMarker: {
            name: "block",
            width: 8,
            height: 6,
          },
        },
      },
      labels: [{ attrs: { text: { text: `${conn.fromPort}->${conn.toPort}` } } }],
      data: {
        fluid: conn.fluid,
        fromComponent: conn.fromComponent,
        toComponent: conn.toComponent,
      },
    });
  }

  return {
    title: model.title || `${model.name} - Liquid Rocket Propulsion P&ID`,
    nodes,
    edges,
    cells: [...nodes, ...edges],
    metadata: {
      readOnly: true,
      domain: "rocets",
      componentCount: components.length,
      connectionCount: model.connections.length,
    },
  };
}

/**
 * Generates standalone SVG vector graphics for a NASA ROCETS engine model.
 */
export function renderRocetsPidSvg(model: RocetsEngineModelLike, options?: RocetsRenderOptions): string {
  const isDark = options?.isDark ?? options?.theme !== "light";
  const graph = buildRocetsDiagram(model);

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
  const vbW = Math.max(800, maxX - minX + padding * 2);
  const vbH = Math.max(500, maxY - minY + padding * 2 + 40);

  const width = options?.width ?? vbW;
  const height = options?.height ?? vbH;

  const bg = isDark ? "#0f172a" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  const svgParts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${width}" height="${height}" style="background-color: ${bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">`,
    "  <defs>",
    '    <marker id="arrow-lox" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">',
    '      <path d="M 0 1 L 9 5 L 0 9 z" fill="#38bdf8" />',
    "    </marker>",
    '    <marker id="arrow-lh2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">',
    '      <path d="M 0 1 L 9 5 L 0 9 z" fill="#7dd3fc" />',
    "    </marker>",
    '    <marker id="arrow-rp1" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">',
    '      <path d="M 0 1 L 9 5 L 0 9 z" fill="#fbbf24" />',
    "    </marker>",
    '    <marker id="arrow-ch4" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">',
    '      <path d="M 0 1 L 9 5 L 0 9 z" fill="#34d399" />',
    "    </marker>",
    '    <marker id="arrow-gas" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">',
    '      <path d="M 0 1 L 9 5 L 0 9 z" fill="#f43f5e" />',
    "    </marker>",
    '    <marker id="arrow-fluid" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">',
    '      <path d="M 0 1 L 9 5 L 0 9 z" fill="#2dd4bf" />',
    "    </marker>",
    "  </defs>",
    `  <text x="${vbX + 30}" y="${vbY + 34}" fill="${textColor}" font-size="18" font-weight="bold">${model.name} - Liquid Propulsion P&amp;ID Schematic</text>`,
    `  <text x="${vbX + 30}" y="${vbY + 54}" fill="${subTextColor}" font-size="12">${model.title || "NASA ROCETS Propellant Feed &amp; Engine Cycle Architecture"}</text>`,
  ];

  const nodeMap = new Map<string, RocetsDiagramNode>();
  for (const n of graph.nodes) {
    nodeMap.set(n.id, n);
    const cx = n.x + n.width / 2;
    const cy = n.y + n.height / 2;
    const typeUpper = String(n.data?.["type"] || "MODULE").toUpperCase();
    const style = getRocetsModuleStyle(typeUpper, isDark);

    svgParts.push(
      `  <g id="node_${n.id}">`,
      `    <rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8" fill="${style.fill}" stroke="${style.stroke}" stroke-width="2" />`,
      `    <text x="${cx}" y="${cy - 4}" fill="${textColor}" font-size="13" font-weight="bold" text-anchor="middle">${n.id}</text>`,
      `    <text x="${cx}" y="${cy + 16}" fill="${subTextColor}" font-size="11" text-anchor="middle">[${typeUpper}]</text>`,
      `  </g>`,
    );
  }

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

    const fromType = String(from.data?.["type"] || "").toUpperCase();
    const isGas = fromType === "TURBINE" || fromType === "CHAMBER" || fromType === "GAS_GENERATOR";
    const fluid = String(edge.data?.["fluid"] || "");
    const fluidStyle = getRocetsFluidColor(fluid, isGas);

    svgParts.push(
      `  <path d="${pathD}" fill="none" stroke="${fluidStyle.stroke}" stroke-width="2" marker-end="url(#${fluidStyle.marker})" />`,
    );
  }

  svgParts.push("</svg>");
  return svgParts.join("\n");
}
