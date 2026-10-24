// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSS/E Single-Line Diagram (SLD) Builder.
 *
 * Translates PSS/E base cases into AntV X6 diagram graphs and standalone SVGs
 * with voltage-level color coding and standard electrical power symbols.
 */

export interface PsseBusLike {
  i: number;
  name: string;
  baseKv: number;
  ide: number;
  vm?: number | undefined;
  va?: number | undefined;
  position?: { x: number; y: number } | undefined;
}

export interface PsseBranchLike {
  i: number;
  j: number;
  ckt: string;
  r: number;
  x: number;
  b: number;
  rateA?: number | undefined;
  st: number;
}

export interface PsseTransformerLike {
  i: number;
  j: number;
  k?: number | undefined;
  ckt: string;
  windv1?: number | undefined;
  stat: number;
}

export interface PsseGeneratorLike {
  i: number;
  id: string;
  pg: number;
  qg: number;
  stat: number;
}

export interface PsseLoadLike {
  i: number;
  id: string;
  pl: number;
  ql: number;
  status: number;
}

export interface PsseCaseLike {
  title1?: string | undefined;
  buses: Map<number, PsseBusLike> | PsseBusLike[];
  branches: PsseBranchLike[];
  transformers?: PsseTransformerLike[] | undefined;
  generators?: PsseGeneratorLike[] | undefined;
  loads?: PsseLoadLike[] | undefined;
}

export interface PsseDiagramCell {
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

export interface PsseDiagramGraph {
  title: string;
  cells: PsseDiagramCell[];
}

/**
 * Maps a nominal voltage to a standard transmission color.
 */
export function getVoltageColor(baseKv: number): string {
  if (baseKv >= 500) return "#E53935"; // 500 kV Red
  if (baseKv >= 230) return "#FB8C00"; // 230 kV Orange
  if (baseKv >= 115) return "#1E88E5"; // 138/115 kV Blue
  if (baseKv >= 60) return "#43A047"; // 69 kV Green
  return "#8E24AA"; // Distribution / Sub-transmission Purple
}

/**
 * Builds an interactive AntV X6 graph model for a PSS/E base case.
 */
export function buildPsseDiagram(c: PsseCaseLike): PsseDiagramGraph {
  const cells: PsseDiagramCell[] = [];
  const busList: PsseBusLike[] = Array.isArray(c.buses) ? c.buses : Array.from(c.buses.values());
  const busMap = new Map<number, PsseBusLike>();
  for (const b of busList) {
    busMap.set(b.i, b);
  }

  const n = busList.length;
  const radius = Math.max(300, n * 45);
  const centerX = radius + 100;
  const centerY = radius + 100;

  // 1. Position and create bus nodes in a circle or use specified coordinates
  const busCoords = new Map<number, { x: number; y: number }>();
  for (let idx = 0; idx < n; idx++) {
    const b = busList[idx]!;
    const angle = (2 * Math.PI * idx) / Math.max(1, n) - Math.PI / 2;
    const x = b.position?.x ?? centerX + radius * Math.cos(angle);
    const y = b.position?.y ?? centerY + radius * Math.sin(angle);
    busCoords.set(b.i, { x, y });

    const color = getVoltageColor(b.baseKv);
    const typeLabel = b.ide === 3 ? "Swing" : b.ide === 2 ? "PV" : "PQ";

    cells.push({
      id: `bus_${b.i}`,
      shape: "rect",
      x: x - 40,
      y: y - 10,
      width: 80,
      height: 20,
      label: `${b.i}: ${b.name.trim()}\n(${b.baseKv} kV, ${typeLabel})`,
      attrs: {
        body: {
          fill: "#1e293b",
          stroke: color,
          strokeWidth: 3,
          rx: 4,
          ry: 4,
        },
        label: {
          fill: "#f8fafc",
          fontSize: 10,
          fontFamily: "Inter, sans-serif",
          textAnchor: "middle",
        },
      },
      data: {
        busNumber: b.i,
        baseKv: b.baseKv,
        busType: b.ide,
      },
    });
  }

  // 2. Add Generators attached to buses
  if (c.generators) {
    for (const g of c.generators) {
      if (g.stat !== 1) continue;
      const bPos = busCoords.get(g.i);
      if (!bPos) continue;

      const genNodeId = `gen_${g.i}_${g.id}`;
      const gx = bPos.x - 70;
      const gy = bPos.y - 50;

      cells.push({
        id: genNodeId,
        shape: "circle",
        x: gx - 16,
        y: gy - 16,
        width: 32,
        height: 32,
        label: `~\n${g.pg.toFixed(1)} MW`,
        attrs: {
          body: {
            fill: "#0f172a",
            stroke: "#22c55e",
            strokeWidth: 2,
          },
          label: {
            fill: "#22c55e",
            fontSize: 9,
            fontWeight: "bold",
          },
        },
      });

      // Connecting lead from generator to bus
      cells.push({
        id: `wire_${genNodeId}_to_bus_${g.i}`,
        shape: "edge",
        source: { cell: genNodeId },
        target: { cell: `bus_${g.i}` },
        attrs: {
          line: {
            stroke: "#22c55e",
            strokeWidth: 1.5,
          },
        },
      });
    }
  }

  // 3. Add Loads attached to buses
  if (c.loads) {
    for (const l of c.loads) {
      if (l.status !== 1) continue;
      const bPos = busCoords.get(l.i);
      if (!bPos) continue;

      const loadNodeId = `load_${l.i}_${l.id}`;
      const lx = bPos.x + 70;
      const ly = bPos.y + 50;

      cells.push({
        id: loadNodeId,
        shape: "rect",
        x: lx - 18,
        y: ly - 14,
        width: 36,
        height: 28,
        label: `L\n${l.pl.toFixed(1)}M`,
        attrs: {
          body: {
            fill: "#0f172a",
            stroke: "#f59e0b",
            strokeWidth: 1.5,
            rx: 2,
            ry: 2,
          },
          label: {
            fill: "#f59e0b",
            fontSize: 9,
          },
        },
      });

      // Connecting lead from bus to load
      cells.push({
        id: `wire_bus_${l.i}_to_${loadNodeId}`,
        shape: "edge",
        source: { cell: `bus_${l.i}` },
        target: { cell: loadNodeId },
        attrs: {
          line: {
            stroke: "#f59e0b",
            strokeWidth: 1.5,
          },
        },
      });
    }
  }

  // 4. Add Transmission Lines
  for (const br of c.branches) {
    if (br.st !== 1) continue;
    const fromBus = busMap.get(br.i);
    if (!fromBus || !busCoords.has(br.i) || !busCoords.has(br.j)) continue;

    const color = getVoltageColor(fromBus.baseKv);

    cells.push({
      id: `branch_${br.i}_${br.j}_${br.ckt}`,
      shape: "edge",
      source: { cell: `bus_${br.i}` },
      target: { cell: `bus_${br.j}` },
      label: `ckt ${br.ckt} (X=${br.x})`,
      attrs: {
        line: {
          stroke: color,
          strokeWidth: 2,
        },
      },
    });
  }

  // 5. Add Transformers
  if (c.transformers) {
    for (const t of c.transformers) {
      if (t.stat !== 1) continue;
      if (!busCoords.has(t.i) || !busCoords.has(t.j)) continue;

      cells.push({
        id: `xfmr_${t.i}_${t.j}_${t.ckt}`,
        shape: "edge",
        source: { cell: `bus_${t.i}` },
        target: { cell: `bus_${t.j}` },
        label: `XFMR ${t.ckt}`,
        attrs: {
          line: {
            stroke: "#ec4899",
            strokeWidth: 2.5,
            strokeDasharray: "4 2",
          },
        },
      });
    }
  }

  return {
    title: c.title1 || "PSS/E Single-Line Diagram",
    cells,
  };
}

/**
 * Renders standalone SVG markup for a PSS/E base case.
 */
export function renderPsseSvg(c: PsseCaseLike): string {
  const diag = buildPsseDiagram(c);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const cell of diag.cells) {
    if (cell.x !== undefined && cell.y !== undefined) {
      if (cell.x < minX) minX = cell.x;
      if (cell.y < minY) minY = cell.y;
      const w = cell.width ?? 80;
      const h = cell.height ?? 30;
      if (cell.x + w > maxX) maxX = cell.x + w;
      if (cell.y + h > maxY) maxY = cell.y + h;
    }
  }

  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  const pad = 60;
  const vbX = Math.round(minX - pad);
  const vbY = Math.round(minY - pad);
  const vbW = Math.round(maxX - minX + 2 * pad);
  const vbH = Math.round(maxY - minY + 2 * pad);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="100%" height="100%" style="background:#0b0f19;">\n`;
  svg += `  <style>\n`;
  svg += `    .bus-text { font-family: Inter, system-ui, sans-serif; fill: #f8fafc; font-size: 10px; font-weight: 500; }\n`;
  svg += `    .gen-text { font-family: Inter, system-ui, sans-serif; fill: #22c55e; font-size: 9px; font-weight: bold; }\n`;
  svg += `    .load-text { font-family: Inter, system-ui, sans-serif; fill: #f59e0b; font-size: 9px; }\n`;
  svg += `  </style>\n`;

  // Draw node boxes & shapes
  for (const cell of diag.cells) {
    if (cell.x !== undefined && cell.y !== undefined) {
      const w = cell.width ?? 80;
      const h = cell.height ?? 20;

      if (cell.shape === "circle") {
        const cx = cell.x + w / 2;
        const cy = cell.y + h / 2;
        const r = w / 2;
        svg += `  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#0f172a" stroke="#22c55e" stroke-width="2" />\n`;
        svg += `  <text x="${cx}" y="${cy + 3}" text-anchor="middle" class="gen-text">~</text>\n`;
      } else {
        const stroke = (cell.attrs?.["body"] as any)?.stroke ?? "#38bdf8";
        svg += `  <rect x="${cell.x}" y="${cell.y}" width="${w}" height="${h}" rx="4" fill="#1e293b" stroke="${stroke}" stroke-width="2.5" />\n`;
        if (cell.label) {
          const lines = cell.label.split("\n");
          let lineY = cell.y + 12;
          for (const l of lines) {
            svg += `  <text x="${cell.x + w / 2}" y="${lineY}" text-anchor="middle" class="bus-text">${l}</text>\n`;
            lineY += 12;
          }
        }
      }
    }
  }

  svg += `</svg>\n`;
  return svg;
}
