// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Easy5Model } from "../types.js";

export interface AntvNode {
  id: string;
  shape: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | undefined;
  data?: Record<string, any> | undefined;
}

export interface AntvEdge {
  id: string;
  source: { cell: string; port?: string | undefined };
  target: { cell: string; port?: string | undefined };
  labels?: { attrs: { text: { text: string } } }[] | undefined;
}

export interface AntvGraphData {
  nodes: AntvNode[];
  edges: AntvEdge[];
}

/**
 * Builds AntV X6 diagram JSON representation for an EASY5 model.
 */
export function buildEasy5DiagramData(model: Easy5Model): AntvGraphData {
  const nodes: AntvNode[] = [];
  const edges: AntvEdge[] = [];

  let autoX = 100;
  let autoY = 100;

  for (const [compId, comp] of model.components) {
    const x = comp.location && comp.location.x > 0 ? comp.location.x : autoX;
    const y = comp.location && comp.location.y > 0 ? comp.location.y : autoY;

    if (!comp.location || comp.location.x === 0) {
      autoX += 160;
      if (autoX > 800) {
        autoX = 100;
        autoY += 120;
      }
    }

    nodes.push({
      id: compId,
      shape: "rect",
      x,
      y,
      width: 100,
      height: 60,
      label: `${compId}\n[${comp.type}]`,
      data: {
        id: compId,
        type: comp.type,
        title: comp.title,
        parameters: comp.parameters,
      },
    });
  }

  let edgeIdx = 1;
  for (const conn of model.connections) {
    edges.push({
      id: `edge_${edgeIdx++}`,
      source: { cell: conn.fromComponent, port: conn.fromPort },
      target: { cell: conn.toComponent, port: conn.toPort },
      labels: [{ attrs: { text: { text: `${conn.fromPort}->${conn.toPort}` } } }],
    });
  }

  return { nodes, edges };
}

/**
 * Renders an EASY5 model into an SVG schematic drawing.
 */
export function renderEasy5SchematicSvg(model: Easy5Model): string {
  const data = buildEasy5DiagramData(model);
  const width = 1000;
  const height = 700;

  const svgParts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: #1e1e2e; font-family: sans-serif;">`,
    "  <defs>",
    '    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">',
    '      <path d="M 0 1 L 9 5 L 0 9 z" fill="#89b4fa" />',
    "    </marker>",
    "  </defs>",
    `  <text x="30" y="40" fill="#cdd6f4" font-size="18" font-weight="bold">${model.name} - EASY5 Schematic</text>`,
  ];

  // Map node positions
  const posMap = new Map<string, { cx: number; cy: number; width: number; height: number }>();

  for (const node of data.nodes) {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    posMap.set(node.id, { cx, cy, width: node.width, height: node.height });

    svgParts.push(
      `  <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" fill="#313244" stroke="#89b4fa" stroke-width="2" />`,
      `  <text x="${cx}" y="${cy - 5}" fill="#cdd6f4" font-size="13" font-weight="bold" text-anchor="middle">${node.id}</text>`,
      `  <text x="${cx}" y="${cy + 15}" fill="#a6adc8" font-size="11" text-anchor="middle">[${node.data?.["type"] || "BLOCK"}]</text>`,
    );
  }

  for (const edge of data.edges) {
    const from = posMap.get(edge.source.cell);
    const to = posMap.get(edge.target.cell);
    if (!from || !to) continue;

    const startX = from.cx + from.width / 2;
    const startY = from.cy;
    const endX = to.cx - to.width / 2;
    const endY = to.cy;

    const midX = (startX + endX) / 2;
    const pathD = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;

    svgParts.push(`  <path d="${pathD}" fill="none" stroke="#89b4fa" stroke-width="1.8" marker-end="url(#arrow)" />`);
  }

  svgParts.push("</svg>");
  return svgParts.join("\n");
}
