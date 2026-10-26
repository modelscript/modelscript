// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Circuit Schematic Visualizer & SVG Renderer.
 *
 * Translates SPICE netlists into:
 * 1. Interactive AntV X6 graph models with electrical node terminals and net connections.
 * 2. Standalone, IEEE/IEC-standard vector SVG schematics with electronic glyphs (R, C, L, D, BJT, MOSFET, Sources, Ground).
 */

export interface SpiceComponentLike {
  name: string;
  kind: string; // "R" | "C" | "L" | "D" | "Q" | "M" | "V" | "I" | "X" | etc.
  nodes: string[];
  value?: number | undefined;
  model?: string | undefined;
  params?: Map<string, number | string> | Record<string, number | string> | undefined;
}

export interface SpiceCircuitLike {
  title?: string | undefined;
  components: SpiceComponentLike[];
  subcircuits?: unknown[] | Map<string, unknown> | undefined;
}

export interface SpiceDiagramCell {
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

export interface SpiceDiagramGraph {
  title: string;
  cells: SpiceDiagramCell[];
}

/**
 * Format component electrical engineering value with metric prefix.
 */
export function formatSpiceValue(val: number | undefined, kind: string): string {
  if (val === undefined || isNaN(val)) return "";
  const abs = Math.abs(val);
  const unit =
    kind === "R" ? "Ω" : kind === "C" ? "F" : kind === "L" ? "H" : kind === "V" ? "V" : kind === "I" ? "A" : "";

  if (abs >= 1e6) return `${(val / 1e6).toPrecision(3)}M${unit}`;
  if (abs >= 1e3) return `${(val / 1e3).toPrecision(3)}k${unit}`;
  if (abs >= 1) return `${val.toPrecision(3)}${unit}`;
  if (abs >= 1e-3) return `${(val * 1e3).toPrecision(3)}m${unit}`;
  if (abs >= 1e-6) return `${(val * 1e6).toPrecision(3)}µ${unit}`;
  if (abs >= 1e-9) return `${(val * 1e9).toPrecision(3)}n${unit}`;
  if (abs >= 1e-12) return `${(val * 1e12).toPrecision(3)}p${unit}`;
  return `${val}${unit}`;
}

/**
 * Returns symbol badge and electrical designation for component kind.
 */
function getComponentGlyph(kind: string): { symbol: string; badge: string; color: string } {
  switch (kind) {
    case "R":
      return { symbol: "─╱╲╱╲─", badge: "RES", color: "#38bdf8" };
    case "C":
      return { symbol: "─││─", badge: "CAP", color: "#818cf8" };
    case "L":
      return { symbol: "─ᴖᴖᴖ─", badge: "IND", color: "#34d399" };
    case "D":
      return { symbol: "─▷|─", badge: "DIODE", color: "#f43f5e" };
    case "Q":
      return { symbol: "BJT", badge: "BJT", color: "#fb923c" };
    case "M":
      return { symbol: "MOS", badge: "MOSFET", color: "#a855f7" };
    case "V":
      return { symbol: "⊝ V ⊕", badge: "VSRC", color: "#eab308" };
    case "I":
      return { symbol: "─→ I ─", badge: "ISRC", color: "#facc15" };
    case "X":
      return { symbol: "[ SUBCKT ]", badge: "SUBCKT", color: "#c084fc" };
    default:
      return { symbol: kind, badge: kind, color: "#94a3b8" };
  }
}

/**
 * Builds an interactive AntV X6 diagram graph for a SPICE circuit.
 */
export function buildSpiceDiagram(circuit: SpiceCircuitLike): SpiceDiagramGraph {
  const title = circuit.title?.trim() || "SPICE Netlist Schematic";
  const cells: SpiceDiagramCell[] = [];

  let curX = 100;
  let curY = 100;
  const compMap = new Map<string, { x: number; y: number; width: number; height: number }>();

  // Place components
  for (const comp of circuit.components) {
    const width = comp.kind === "X" ? 110 : 85;
    const height = 65;

    compMap.set(comp.name, { x: curX, y: curY, width, height });
    const { symbol, badge, color } = getComponentGlyph(comp.kind);
    const valStr = formatSpiceValue(comp.value, comp.kind) || comp.model || "";

    cells.push({
      id: `comp_${comp.name}`,
      shape: "rect",
      x: curX,
      y: curY,
      width,
      height,
      label: `${comp.name}\n${valStr}`,
      attrs: {
        body: {
          fill: "#111827",
          stroke: color,
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        label: {
          fill: "#f9fafb",
          fontSize: 10,
          fontFamily: "JetBrains Mono, Menlo, monospace",
          textAnchor: "middle",
        },
      },
      data: {
        name: comp.name,
        kind: comp.kind,
        nodes: comp.nodes,
        badge,
        symbol,
        value: comp.value,
      },
    });

    curX += width + 75;
    if (curX > 850) {
      curX = 100;
      curY += height + 90;
    }
  }

  // Connect shared electrical nets
  const netToComponents = new Map<string, { compName: string; pinIndex: number }[]>();
  for (const comp of circuit.components) {
    for (let p = 0; p < comp.nodes.length; p++) {
      const net = comp.nodes[p]!;
      if (!netToComponents.has(net)) netToComponents.set(net, []);
      netToComponents.get(net)!.push({ compName: comp.name, pinIndex: p });
    }
  }

  let wireIdx = 1;
  for (const [netName, pins] of netToComponents.entries()) {
    if (pins.length < 2) continue;

    const root = pins[0]!;
    for (let j = 1; j < pins.length; j++) {
      const target = pins[j]!;
      const isGround = netName === "0" || netName.toLowerCase() === "gnd";

      cells.push({
        id: `wire_${wireIdx++}`,
        shape: "edge",
        source: { cell: `comp_${root.compName}`, port: `pin_${root.pinIndex}` },
        target: { cell: `comp_${target.compName}`, port: `pin_${target.pinIndex}` },
        label: isGround ? "GND (0)" : `net_${netName}`,
        attrs: {
          line: {
            stroke: isGround ? "#10b981" : "#60a5fa",
            strokeWidth: 1.8,
          },
        },
        data: {
          net: netName,
          isGround,
        },
      });
    }
  }

  return { title, cells };
}

/**
 * Renders a SPICE circuit into a standalone, dark-mode SVG schematic.
 */
export function renderSpiceSvg(circuit: SpiceCircuitLike): string {
  const diag = buildSpiceDiagram(circuit);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const cell of diag.cells) {
    if (cell.x !== undefined && cell.y !== undefined) {
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x + (cell.width ?? 85));
      maxY = Math.max(maxY, cell.y + (cell.height ?? 65));
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

  const nodeMap = new Map<string, SpiceDiagramCell>();
  for (const cell of diag.cells) {
    if (cell.x !== undefined) nodeMap.set(cell.id, cell);
  }

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" style="background-color: #0b0f19; font-family: JetBrains Mono, Menlo, monospace;">\n`;
  svg += `  <defs>\n`;
  svg += `    <filter id="spice-glow" x="-20%" y="-20%" width="140%" height="140%">\n`;
  svg += `      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#60a5fa" flood-opacity="0.2" />\n`;
  svg += `    </filter>\n`;
  svg += `  </defs>\n\n`;

  // Title
  svg += `  <text x="${minX}" y="${minY - 20}" fill="#f9fafb" font-size="15" font-weight="700">${diag.title} — SPICE Circuit Schematic</text>\n\n`;

  // Draw Net Wires Layer
  svg += `  <g id="spice-wires-layer">\n`;
  for (const cell of diag.cells) {
    if (cell.shape === "edge" && cell.source && cell.target) {
      const srcId = typeof cell.source === "object" && "cell" in cell.source ? cell.source.cell : null;
      const tgtId = typeof cell.target === "object" && "cell" in cell.target ? cell.target.cell : null;
      if (!srcId || !tgtId) continue;

      const srcNode = nodeMap.get(srcId);
      const tgtNode = nodeMap.get(tgtId);
      if (!srcNode || !tgtNode) continue;

      const x1 = (srcNode.x ?? 0) + (srcNode.width ?? 85) / 2;
      const y1 = (srcNode.y ?? 0) + (srcNode.height ?? 65);
      const x2 = (tgtNode.x ?? 0) + (tgtNode.width ?? 85) / 2;
      const y2 = tgtNode.y ?? 0;

      const stroke = cell.data?.["isGround"] ? "#10b981" : "#60a5fa";
      const midY = (y1 + y2) / 2;
      const pathD = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;

      svg += `    <path id="${cell.id}" d="${pathD}" fill="none" stroke="${stroke}" stroke-width="1.8" opacity="0.85" />\n`;
      svg += `    <circle cx="${x1}" cy="${midY}" r="3" fill="${stroke}" />\n`;
      svg += `    <circle cx="${x2}" cy="${midY}" r="3" fill="${stroke}" />\n`;
    }
  }
  svg += `  </g>\n\n`;

  // Draw Components Layer
  svg += `  <g id="spice-components-layer">\n`;
  for (const cell of diag.cells) {
    if (cell.x !== undefined && cell.y !== undefined) {
      const w = cell.width ?? 85;
      const h = cell.height ?? 65;
      const cx = cell.x + w / 2;
      const cy = cell.y + h / 2;
      const name = (cell.data?.["name"] as string) || cell.label || "";
      const kind = (cell.data?.["kind"] as string) || "R";
      const badge = (cell.data?.["badge"] as string) || "";
      const symbol = (cell.data?.["symbol"] as string) || kind;
      const { color } = getComponentGlyph(kind);

      svg += `    <g id="${cell.id}" filter="url(#spice-glow)">\n`;
      svg += `      <rect x="${cell.x}" y="${cell.y}" width="${w}" height="${h}" rx="5" fill="#111827" stroke="${color}" stroke-width="1.8" />\n`;

      // Badge top left
      svg += `      <rect x="${cell.x + 5}" y="${cell.y + 5}" width="28" height="12" rx="2" fill="${color}" fill-opacity="0.2" />\n`;
      svg += `      <text x="${cell.x + 19}" y="${cell.y + 14}" fill="${color}" font-size="7.5" font-weight="700" text-anchor="middle">${badge}</text>\n`;

      // Name & Symbol
      svg += `      <text x="${cx}" y="${cy - 2}" fill="#f9fafb" font-size="11" font-weight="700" text-anchor="middle">${name}</text>\n`;
      svg += `      <text x="${cx}" y="${cy + 13}" fill="${color}" font-size="10" font-weight="600" text-anchor="middle">${symbol}</text>\n`;

      // Value below
      const valStr = formatSpiceValue(cell.data?.["value"] as number | undefined, kind);
      if (valStr) {
        svg += `      <text x="${cx}" y="${cell.y + h - 5}" fill="#9ca3af" font-size="8.5" text-anchor="middle">${valStr}</text>\n`;
      }

      // Terminal pin dots (top and bottom)
      svg += `      <circle cx="${cx}" cy="${cell.y}" r="2.5" fill="${color}" />\n`;
      svg += `      <circle cx="${cx}" cy="${cell.y + h}" r="2.5" fill="${color}" />\n`;
      svg += `    </g>\n`;
    }
  }
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
