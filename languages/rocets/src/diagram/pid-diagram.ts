// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Piping and Instrumentation Diagram (P&ID) Vector Schematic Generator for NASA ROCETS.
 *
 * Generates:
 * 1. AntV X6 graph model with propulsion component shapes and port connection routes
 * 2. Standalone SVG P&ID flow schematic with fluid-specific color coding (LOX, LH2, RP-1, Hot Gas)
 */

import type { RocetsEngineModel } from "../types.js";

export interface AntvNode {
  id: string;
  shape: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | undefined;
  data?: Record<string, unknown> | undefined;
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

export function buildRocetsDiagramData(model: RocetsEngineModel): AntvGraphData {
  const nodes: AntvNode[] = [];
  const edges: AntvEdge[] = [];

  let autoX = 80;
  let autoY = 80;

  for (const [compId, comp] of model.components) {
    const x = comp.location && comp.location.x > 0 ? comp.location.x : autoX;
    const y = comp.location && comp.location.y > 0 ? comp.location.y : autoY;

    if (!comp.location || comp.location.x === 0) {
      autoX += 160;
      if (autoX > 800) {
        autoX = 80;
        autoY += 140;
      }
    }

    nodes.push({
      id: compId,
      shape: "rect",
      x,
      y,
      width: 110,
      height: 65,
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

export function renderRocetsPidSvg(model: RocetsEngineModel): string {
  const data = buildRocetsDiagramData(model);
  const width = 1100;
  const height = 750;

  const svgParts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: #11111b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">`,
    "  <defs>",
    '    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">',
    '      <path d="M 0 1 L 9 5 L 0 9 z" fill="#89dceb" />',
    "    </marker>",
    '    <marker id="arrow-gas" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">',
    '      <path d="M 0 1 L 9 5 L 0 9 z" fill="#f38ba8" />',
    "    </marker>",
    "  </defs>",
    `  <text x="35" y="45" fill="#cdd6f4" font-size="20" font-weight="bold">${model.name} - Liquid Propulsion P&amp;ID Schematic</text>`,
    `  <text x="35" y="70" fill="#a6adc8" font-size="13">${model.title || "NASA ROCETS Propellant Feed &amp; Engine Cycle Architecture"}</text>`,
  ];

  const posMap = new Map<string, { cx: number; cy: number; width: number; height: number; type: string }>();

  for (const node of data.nodes) {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const typeUpper = String(node.data?.["type"] || "").toUpperCase();
    posMap.set(node.id, { cx, cy, width: node.width, height: node.height, type: typeUpper });

    // Distinct styling per propulsion module type
    let strokeColor = "#89dceb";
    let fillColor = "#181825";

    if (typeUpper === "CHAMBER" || typeUpper === "TC" || typeUpper === "COMBUSTOR") {
      strokeColor = "#f38ba8";
      fillColor = "#311825";
    } else if (typeUpper === "TURBINE") {
      strokeColor = "#fab387";
      fillColor = "#2a1e1e";
    } else if (typeUpper === "PUMP") {
      strokeColor = "#a6e3a1";
      fillColor = "#1a2720";
    } else if (typeUpper === "VALVE") {
      strokeColor = "#cba6f7";
      fillColor = "#231e2e";
    }

    svgParts.push(
      `  <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" />`,
      `  <text x="${cx}" y="${cy - 4}" fill="#cdd6f4" font-size="13" font-weight="bold" text-anchor="middle">${node.id}</text>`,
      `  <text x="${cx}" y="${cy + 16}" fill="#a6adc8" font-size="11" text-anchor="middle">[${typeUpper || "MODULE"}]</text>`,
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

    const isGas = from.type === "TURBINE" || from.type === "CHAMBER" || from.type === "GAS_GENERATOR";
    const strokeColor = isGas ? "#f38ba8" : "#89dceb";
    const marker = isGas ? "url(#arrow-gas)" : "url(#arrow)";

    svgParts.push(
      `  <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2" marker-end="${marker}" />`,
    );
  }

  svgParts.push("</svg>");
  return svgParts.join("\n");
}
