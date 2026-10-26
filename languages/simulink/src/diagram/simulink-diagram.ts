// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulink — Visual Block Diagram Generator & SVG Renderer.
 *
 * Translates Simulink models and subsystems into:
 * 1. Interactive AntV X6 graph models (nodes, ports, hierarchical subsystems, signal lines).
 * 2. Standalone, responsive SVG schematic renderings with domain glyphs (Integrator 1/s, Sum, Gain, TransferFcn).
 */

export interface SimulinkPortLike {
  id: string | number;
  portNumber: number;
  type: "in" | "out" | "trigger" | "enable";
  name?: string | undefined;
}

export interface SimulinkBranchLike {
  dstBlock: string;
  dstPort: number;
  points?: [number, number][] | undefined;
}

export interface SimulinkLineLike {
  id: string;
  srcBlock: string;
  srcPort: number;
  dstBlock?: string | undefined;
  dstPort?: number | undefined;
  branches?: SimulinkBranchLike[] | undefined;
  name?: string | undefined;
}

export interface SimulinkBlockLike {
  name: string;
  type: string;
  id?: string | undefined;
  parameters?: Map<string, string | number> | Record<string, string | number> | undefined;
  ports?: SimulinkPortLike[] | undefined;
  subsystem?: SimulinkSystemLike | undefined;
  position?: { x: number; y: number; width?: number; height?: number } | undefined;
}

export interface SimulinkSystemLike {
  name: string;
  blocks: Map<string, SimulinkBlockLike> | Record<string, SimulinkBlockLike> | SimulinkBlockLike[];
  lines?: SimulinkLineLike[] | undefined;
}

export interface SimulinkModelLike {
  name: string;
  rootSystem: SimulinkSystemLike;
  version?: string | undefined;
  solver?: string | undefined;
}

export interface SimulinkDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string; port?: string } | { x: number; y: number } | undefined;
  target?: { cell: string; port?: string } | { x: number; y: number } | undefined;
  vertices?: { x: number; y: number }[] | undefined;
  attrs?: Record<string, unknown> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface SimulinkDiagramGraph {
  title: string;
  cells: SimulinkDiagramCell[];
}

/**
 * Returns formatted symbol text or glyph icon indicator for standard Simulink blocks.
 */
function getBlockGlyph(
  type: string,
  params: Map<string, string | number> | Record<string, string | number> | undefined,
): { symbol: string; badge?: string } {
  const getParam = (key: string): string => {
    if (!params) return "";
    if (params instanceof Map) return String(params.get(key) ?? "");
    return String((params as Record<string, string | number>)[key] ?? "");
  };

  switch (type) {
    case "Integrator":
      return { symbol: "1/s", badge: "∫" };
    case "UnitDelay":
      return { symbol: "1/z", badge: "z⁻¹" };
    case "Gain": {
      const g = getParam("Gain") || "K";
      return { symbol: g, badge: "▶" };
    }
    case "Sum": {
      const signs = getParam("Inputs") || "++";
      return { symbol: signs, badge: "∑" };
    }
    case "Product": {
      const ops = getParam("Inputs") || "**";
      return { symbol: ops, badge: "∏" };
    }
    case "TransferFcn": {
      const num = getParam("Numerator") || "1";
      const den = getParam("Denominator") || "s+1";
      return { symbol: `${num}\n───\n${den}`, badge: "TF" };
    }
    case "StateSpace":
      return { symbol: "ẋ = Ax + Bu\ny = Cx + Du", badge: "SS" };
    case "Constant": {
      const val = getParam("Value") || "1";
      return { symbol: val, badge: "C" };
    }
    case "Scope":
      return { symbol: "∿", badge: "SCOPE" };
    case "Inport":
      return { symbol: "IN ▶", badge: "IN" };
    case "Outport":
      return { symbol: "▶ OUT", badge: "OUT" };
    case "SubSystem":
      return { symbol: "[ SubSystem ]", badge: "SYS" };
    default:
      return { symbol: type, badge: type.slice(0, 3).toUpperCase() };
  }
}

/**
 * Builds an interactive AntV X6 diagram graph for a Simulink model or subsystem.
 */
export function buildSimulinkDiagram(modelOrSystem: SimulinkModelLike | SimulinkSystemLike): SimulinkDiagramGraph {
  const sys: SimulinkSystemLike = "rootSystem" in modelOrSystem ? modelOrSystem.rootSystem : modelOrSystem;
  const title = "name" in modelOrSystem ? modelOrSystem.name : sys.name;
  const cells: SimulinkDiagramCell[] = [];

  // Extract blocks
  const blocks: SimulinkBlockLike[] = [];
  if (Array.isArray(sys.blocks)) {
    blocks.push(...sys.blocks);
  } else if (sys.blocks instanceof Map) {
    for (const b of sys.blocks.values()) blocks.push(b);
  } else if (typeof sys.blocks === "object") {
    for (const b of Object.values(sys.blocks)) blocks.push(b);
  }

  // Auto-layout in grid if positions are not set
  let autoX = 80;
  let autoY = 80;
  const blockCenters = new Map<string, { x: number; y: number; width: number; height: number }>();

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const blockId = block.name || block.id || `block_${i}`;
    const width = block.position?.width || (block.type === "Sum" ? 50 : block.type === "TransferFcn" ? 110 : 80);
    const height = block.position?.height || (block.type === "Sum" ? 50 : 60);

    let x = block.position?.x;
    let y = block.position?.y;

    if (x === undefined || y === undefined || (x === 0 && y === 0)) {
      x = autoX;
      y = autoY;
      autoX += width + 70;
      if (autoX > 900) {
        autoX = 80;
        autoY += height + 80;
      }
    }

    blockCenters.set(blockId, { x, y, width, height });
    const { symbol, badge } = getBlockGlyph(block.type, block.parameters);

    const isRound = block.type === "Sum" || block.type === "Product";
    const cellShape = isRound ? "circle" : "rect";

    cells.push({
      id: `block_${blockId}`,
      shape: cellShape,
      x,
      y,
      width,
      height,
      label: `${symbol}\n${block.name}`,
      attrs: {
        body: {
          fill: isRound ? "#1e293b" : "#0f172a",
          stroke: block.type === "SubSystem" ? "#a855f7" : block.type === "Scope" ? "#eab308" : "#38bdf8",
          strokeWidth: 2,
          rx: isRound ? undefined : 6,
          ry: isRound ? undefined : 6,
        },
        label: {
          fill: "#f8fafc",
          fontSize: 11,
          fontFamily: "Inter, system-ui, sans-serif",
          textAnchor: "middle",
        },
      },
      data: {
        blockName: block.name,
        blockType: block.type,
        badge,
        parameters: block.parameters instanceof Map ? Object.fromEntries(block.parameters) : block.parameters,
      },
    });
  }

  // Extract and draw lines/connections
  const lines = sys.lines || [];
  let lineIdx = 1;

  for (const line of lines) {
    const srcId = `block_${line.srcBlock}`;

    // Direct destination
    if (line.dstBlock) {
      const dstId = `block_${line.dstBlock}`;
      cells.push({
        id: line.id || `line_${lineIdx++}`,
        shape: "edge",
        source: { cell: srcId, port: `out_${line.srcPort}` },
        target: { cell: dstId, port: `in_${line.dstPort ?? 1}` },
        label: line.name,
        attrs: {
          line: {
            stroke: "#38bdf8",
            strokeWidth: 2,
            targetMarker: {
              name: "block",
              width: 8,
              height: 6,
            },
          },
        },
        data: {
          srcBlock: line.srcBlock,
          srcPort: line.srcPort,
          dstBlock: line.dstBlock,
          dstPort: line.dstPort,
        },
      });
    }

    // Branch destinations (signal fan-out)
    if (line.branches && line.branches.length > 0) {
      for (const branch of line.branches) {
        const dstId = `block_${branch.dstBlock}`;
        cells.push({
          id: `branch_${lineIdx++}`,
          shape: "edge",
          source: { cell: srcId, port: `out_${line.srcPort}` },
          target: { cell: dstId, port: `in_${branch.dstPort}` },
          attrs: {
            line: {
              stroke: "#38bdf8",
              strokeWidth: 2,
              strokeDasharray: "4 2",
              targetMarker: {
                name: "block",
                width: 8,
                height: 6,
              },
            },
          },
          data: {
            srcBlock: line.srcBlock,
            srcPort: line.srcPort,
            dstBlock: branch.dstBlock,
            dstPort: branch.dstPort,
          },
        });
      }
    }
  }

  return { title, cells };
}

/**
 * Renders a Simulink model or subsystem into a standalone, dark-mode SVG drawing.
 */
export function renderSimulinkSvg(modelOrSystem: SimulinkModelLike | SimulinkSystemLike): string {
  const diag = buildSimulinkDiagram(modelOrSystem);

  // Compute bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const cell of diag.cells) {
    if (cell.x !== undefined && cell.y !== undefined) {
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x + (cell.width ?? 80));
      maxY = Math.max(maxY, cell.y + (cell.height ?? 60));
    }
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  const padding = 60;
  const width = Math.max(800, maxX - minX + padding * 2);
  const height = Math.max(600, maxY - minY + padding * 2);
  const viewBox = `${minX - padding} ${minY - padding} ${width} ${height}`;

  const nodeMap = new Map<string, SimulinkDiagramCell>();
  for (const cell of diag.cells) {
    if (cell.x !== undefined) nodeMap.set(cell.id, cell);
  }

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" style="background-color: #0b0f19; font-family: Inter, system-ui, -apple-system, sans-serif;">\n`;
  svg += `  <defs>\n`;
  svg += `    <marker id="simulink-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 9 5 L 0 9 z" fill="#38bdf8" />\n`;
  svg += `    </marker>\n`;
  svg += `    <filter id="simulink-glow" x="-20%" y="-20%" width="140%" height="140%">\n`;
  svg += `      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#38bdf8" flood-opacity="0.25" />\n`;
  svg += `    </filter>\n`;
  svg += `  </defs>\n\n`;

  // Title header
  svg += `  <text x="${minX}" y="${minY - 20}" fill="#f8fafc" font-size="16" font-weight="700">${diag.title} — Simulink Block Diagram</text>\n\n`;

  // Draw Edges Layer
  svg += `  <g id="simulink-lines-layer">\n`;
  for (const cell of diag.cells) {
    if (cell.shape === "edge" && cell.source && cell.target) {
      const srcId = typeof cell.source === "object" && "cell" in cell.source ? cell.source.cell : null;
      const tgtId = typeof cell.target === "object" && "cell" in cell.target ? cell.target.cell : null;
      if (!srcId || !tgtId) continue;

      const srcNode = nodeMap.get(srcId);
      const tgtNode = nodeMap.get(tgtId);
      if (!srcNode || !tgtNode) continue;

      const x1 = (srcNode.x ?? 0) + (srcNode.width ?? 80);
      const y1 = (srcNode.y ?? 0) + (srcNode.height ?? 60) / 2;
      const x2 = tgtNode.x ?? 0;
      const y2 = (tgtNode.y ?? 0) + (tgtNode.height ?? 60) / 2;

      const midX = (x1 + x2) / 2;
      const pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
      const isBranch = cell.id.startsWith("branch_");
      const strokeDash = isBranch ? `stroke-dasharray="4 2"` : "";

      svg += `    <path id="${cell.id}" d="${pathD}" fill="none" stroke="#38bdf8" stroke-width="2" marker-end="url(#simulink-arrow)" ${strokeDash} opacity="0.85" />\n`;
      if (cell.label) {
        svg += `    <text x="${midX}" y="${(y1 + y2) / 2 - 6}" fill="#94a3b8" font-size="10" text-anchor="middle">${cell.label}</text>\n`;
      }
    }
  }
  svg += `  </g>\n\n`;

  // Draw Nodes Layer
  svg += `  <g id="simulink-blocks-layer">\n`;
  for (const cell of diag.cells) {
    if (cell.x !== undefined && cell.y !== undefined) {
      const w = cell.width ?? 80;
      const h = cell.height ?? 60;
      const cx = cell.x + w / 2;
      const cy = cell.y + h / 2;
      const bType = (cell.data?.["blockType"] as string) || "Block";
      const bName = (cell.data?.["blockName"] as string) || cell.label || "";
      const badge = (cell.data?.["badge"] as string) || "";

      svg += `    <g id="${cell.id}" filter="url(#simulink-glow)">\n`;

      if (cell.shape === "circle") {
        svg += `      <circle cx="${cx}" cy="${cy}" r="${w / 2}" fill="#1e293b" stroke="#38bdf8" stroke-width="2" />\n`;
        svg += `      <text x="${cx}" y="${cy + 4}" fill="#f8fafc" font-size="14" font-weight="700" text-anchor="middle">${badge}</text>\n`;
        svg += `      <text x="${cx}" y="${cy + w / 2 + 14}" fill="#94a3b8" font-size="10" text-anchor="middle">${bName}</text>\n`;
      } else {
        const strokeColor = bType === "SubSystem" ? "#a855f7" : bType === "Scope" ? "#eab308" : "#38bdf8";
        svg += `      <rect x="${cell.x}" y="${cell.y}" width="${w}" height="${h}" rx="6" fill="#1e293b" stroke="${strokeColor}" stroke-width="2" />\n`;

        // Badge pill
        svg += `      <rect x="${cell.x + 6}" y="${cell.y + 6}" width="28" height="14" rx="3" fill="${strokeColor}" fill-opacity="0.2" />\n`;
        svg += `      <text x="${cell.x + 20}" y="${cell.y + 17}" fill="${strokeColor}" font-size="8" font-weight="700" text-anchor="middle">${badge}</text>\n`;

        // Central math symbol or block body
        const lines = (cell.label ?? "").split("\n");
        const bodyText = lines[0] ?? bType;
        svg += `      <text x="${cx}" y="${cy + 3}" fill="#f8fafc" font-size="12" font-weight="600" text-anchor="middle">${bodyText}</text>\n`;

        // Label below or at bottom
        svg += `      <text x="${cx}" y="${cell.y + h - 6}" fill="#94a3b8" font-size="9" text-anchor="middle">${bName}</text>\n`;
      }

      // Small port pin markers
      svg += `      <circle cx="${cell.x}" cy="${cy}" r="3" fill="#38bdf8" />\n`;
      svg += `      <circle cx="${cell.x + w}" cy="${cy}" r="3" fill="#38bdf8" />\n`;
      svg += `    </g>\n`;
    }
  }
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
