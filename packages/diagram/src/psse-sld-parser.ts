// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSS/E Single-Line Diagram (.sld) & Drawing (.drw) Parser and Renderer.
 *
 * Ingests legacy Siemens PTI PSS/E graphical schematic files (.sld, .drw)
 * in both text/comma-delimited record format and XML format. Maps substation busbar
 * positions, branch polyline routing vertices, generator/load/transformer glyphs,
 * and text annotations into ModelScript diagram models and standalone SVGs.
 */

import {
  type PsseCaseLike,
  type PsseDiagramCell,
  type PsseDiagramGraph,
  type PssePowerFlowOverlay,
  getVoltageColor,
  renderPsseSvg,
} from "./psse-diagram-builder.js";

export interface PsseSldBusItem {
  busNumber: number;
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
  orientation?: number | undefined; // 0 = horizontal, 90 = vertical
  label?: string | undefined;
  baseKv?: number | undefined;
}

export interface PsseSldBranchItem {
  fromBus: number;
  toBus: number;
  ckt: string;
  vertices: Array<{ x: number; y: number }>;
}

export interface PsseSldComponentItem {
  kind: "generator" | "load" | "shunt" | "transformer";
  busNumber: number;
  id: string;
  toBus?: number | undefined; // For transformers
  x: number;
  y: number;
  orientation?: number | undefined;
}

export interface PsseSldAnnotationItem {
  x: number;
  y: number;
  text: string;
  fontSize?: number | undefined;
  color?: string | undefined;
}

export interface PsseSldDrawing {
  title: string;
  version?: string | undefined;
  width: number;
  height: number;
  buses: Map<number, PsseSldBusItem>;
  branches: PsseSldBranchItem[];
  components: PsseSldComponentItem[];
  annotations: PsseSldAnnotationItem[];
}

/**
 * Strips comments and splits line into clean tokens.
 */
function tokenizeSldLine(line: string): string[] {
  let cleaned = line.trim();
  // Strip trailing slashes and comments
  const slashIdx = cleaned.indexOf("/");
  if (slashIdx >= 0) {
    cleaned = cleaned.slice(0, slashIdx).trim();
  }
  if (!cleaned || cleaned.startsWith("@!") || cleaned.startsWith("//") || cleaned.startsWith("#")) {
    return [];
  }

  // Parse comma- or space-separated tokens with support for quotes
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if ((ch === '"' || ch === "'") && (!inQuotes || ch === quoteChar)) {
      inQuotes = !inQuotes;
      quoteChar = inQuotes ? ch : "";
    } else if ((ch === "," || ch === "\t") && !inQuotes) {
      tokens.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) {
    tokens.push(current.trim());
  }

  return tokens.map((t) => t.replace(/^["']|["']$/g, "").trim());
}

/**
 * Parses XML-based PSS/E .sld files.
 */
function parseXmlSld(content: string): PsseSldDrawing {
  const drawing: PsseSldDrawing = {
    title: "PSS/E Drawing",
    version: "33",
    width: 2000,
    height: 1500,
    buses: new Map(),
    branches: [],
    components: [],
    annotations: [],
  };

  const titleMatch = /<Drawing[^>]*title=["']([^"']+)["']/i.exec(content);
  if (titleMatch?.[1]) drawing.title = titleMatch[1];

  const wMatch = /<Drawing[^>]*width=["']([^"']+)["']/i.exec(content);
  if (wMatch?.[1]) drawing.width = parseFloat(wMatch[1]) || 2000;

  const hMatch = /<Drawing[^>]*height=["']([^"']+)["']/i.exec(content);
  if (hMatch?.[1]) drawing.height = parseFloat(hMatch[1]) || 1500;

  // Extract Buses
  const busRegex = /<Bus\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = busRegex.exec(content)) !== null) {
    const attrs = match[1] || "";
    const num = parseInt(extractAttr(attrs, "number") || extractAttr(attrs, "id") || "0", 10);
    const x = parseFloat(extractAttr(attrs, "x") || "0");
    const y = parseFloat(extractAttr(attrs, "y") || "0");
    const w = parseFloat(extractAttr(attrs, "width") || "100");
    const h = parseFloat(extractAttr(attrs, "height") || "10");
    const label = (extractAttr(attrs, "name") || extractAttr(attrs, "label")) ?? undefined;
    const baseKv = parseFloat(extractAttr(attrs, "basekv") || "0") || undefined;
    if (num > 0) {
      drawing.buses.set(num, { busNumber: num, x, y, width: w, height: h, label, baseKv });
    }
  }

  // Extract Branches & Polyline Vertices
  const branchBlockRegex = /<Branch\b([^>]*)>([\s\S]*?)<\/Branch>/gi;
  while ((match = branchBlockRegex.exec(content)) !== null) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    const fromBus = parseInt(extractAttr(attrs, "from") || extractAttr(attrs, "i") || "0", 10);
    const toBus = parseInt(extractAttr(attrs, "to") || extractAttr(attrs, "j") || "0", 10);
    const ckt = extractAttr(attrs, "ckt") || "1";
    const vertices: Array<{ x: number; y: number }> = [];

    const ptRegex = /<Point\b([^>]*)\/?>/gi;
    let ptMatch: RegExpExecArray | null;
    while ((ptMatch = ptRegex.exec(body)) !== null) {
      const pAttrs = ptMatch[1] || "";
      const px = parseFloat(extractAttr(pAttrs, "x") || "0");
      const py = parseFloat(extractAttr(pAttrs, "y") || "0");
      vertices.push({ x: px, y: py });
    }

    if (fromBus > 0 && toBus > 0) {
      drawing.branches.push({ fromBus, toBus, ckt, vertices });
    }
  }

  // Extract Generators
  const genRegex = /<Generator\b([^>]*)\/?>/gi;
  while ((match = genRegex.exec(content)) !== null) {
    const attrs = match[1] || "";
    const bus = parseInt(extractAttr(attrs, "bus") || extractAttr(attrs, "i") || "0", 10);
    const id = extractAttr(attrs, "id") || "1";
    const x = parseFloat(extractAttr(attrs, "x") || "0");
    const y = parseFloat(extractAttr(attrs, "y") || "0");
    if (bus > 0) {
      drawing.components.push({ kind: "generator", busNumber: bus, id, x, y });
    }
  }

  // Extract Loads
  const loadRegex = /<Load\b([^>]*)\/?>/gi;
  while ((match = loadRegex.exec(content)) !== null) {
    const attrs = match[1] || "";
    const bus = parseInt(extractAttr(attrs, "bus") || extractAttr(attrs, "i") || "0", 10);
    const id = extractAttr(attrs, "id") || "1";
    const x = parseFloat(extractAttr(attrs, "x") || "0");
    const y = parseFloat(extractAttr(attrs, "y") || "0");
    if (bus > 0) {
      drawing.components.push({ kind: "load", busNumber: bus, id, x, y });
    }
  }

  // Extract Annotations
  const textRegex = /<Text\b([^>]*)>([^<]*)<\/Text>/gi;
  while ((match = textRegex.exec(content)) !== null) {
    const attrs = match[1] || "";
    const text = match[2] || "";
    const x = parseFloat(extractAttr(attrs, "x") || "0");
    const y = parseFloat(extractAttr(attrs, "y") || "0");
    const fontSize = parseFloat(extractAttr(attrs, "size") || "12");
    drawing.annotations.push({ x, y, text: text.trim(), fontSize });
  }

  return drawing;
}

function extractAttr(tagAttrs: string, name: string): string | null {
  const r = new RegExp(`${name}=["']([^"']+)["']`, "i");
  const m = r.exec(tagAttrs);
  return m ? m[1]! : null;
}

/**
 * Ingests a PSS/E .sld or .drw text/binary buffer and constructs a structured `PsseSldDrawing`.
 */
export function parsePsseSld(input: string | Uint8Array): PsseSldDrawing {
  const text = typeof input === "string" ? input : new TextDecoder().decode(input);

  if (text.includes("<Drawing") || text.includes("<Bus")) {
    return parseXmlSld(text);
  }

  const drawing: PsseSldDrawing = {
    title: "PSS/E Drawing",
    version: "33",
    width: 2400,
    height: 1800,
    buses: new Map(),
    branches: [],
    components: [],
    annotations: [],
  };

  const lines = text.split(/\r?\n/);
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const tokens = tokenizeSldLine(rawLine);
    if (tokens.length === 0) continue;

    const cmd = tokens[0]!.toUpperCase();

    switch (cmd) {
      case "TITLE":
      case "DRAWING":
      case "SHEET": {
        // e.g. SHEET, 2000, 1500, "Substation Layout", 33
        if (tokens.length >= 3 && !isNaN(parseFloat(tokens[1]!))) {
          drawing.width = parseFloat(tokens[1]!) || 2400;
          drawing.height = parseFloat(tokens[2]!) || 1800;
          if (tokens[3]) drawing.title = tokens[3];
          if (tokens[4]) drawing.version = tokens[4];
        } else if (tokens[1]) {
          drawing.title = tokens[1];
        }
        break;
      }

      case "BUS": {
        // Format: BUS, <busNumber>, <x>, <y>, [width], [height], [orientation], [label], [baseKv]
        if (tokens.length >= 4) {
          const busNumber = parseInt(tokens[1]!, 10);
          const x = parseFloat(tokens[2]!);
          const y = parseFloat(tokens[3]!);
          const width = tokens.length > 4 ? parseFloat(tokens[4]!) : 100;
          const height = tokens.length > 5 ? parseFloat(tokens[5]!) : 10;
          const orientation = tokens.length > 6 ? parseFloat(tokens[6]!) : 0;
          const label = tokens.length > 7 && tokens[7] !== "" ? tokens[7] : undefined;
          const baseKv = tokens.length > 8 ? parseFloat(tokens[8]!) : undefined;

          if (!isNaN(busNumber) && !isNaN(x) && !isNaN(y)) {
            drawing.buses.set(busNumber, {
              busNumber,
              x,
              y,
              width: width > 0 ? width : 100,
              height: height > 0 ? height : 10,
              orientation,
              label,
              baseKv,
            });
          }
        }
        break;
      }

      case "BRANCH":
      case "LINE": {
        // Format: BRANCH, <fromBus>, <toBus>, <ckt>, [numPts], [x1], [y1], [x2], [y2]...
        if (tokens.length >= 4) {
          const fromBus = parseInt(tokens[1]!, 10);
          const toBus = parseInt(tokens[2]!, 10);
          const ckt = tokens[3] || "1";
          const vertices: Array<{ x: number; y: number }> = [];

          if (tokens.length > 5) {
            const hasExplicitCount = !isNaN(parseInt(tokens[4]!, 10)) && tokens.length % 2 === 1;
            const startIdx = hasExplicitCount ? 5 : 4;
            for (let i = startIdx; i < tokens.length - 1; i += 2) {
              const vx = parseFloat(tokens[i]!);
              const vy = parseFloat(tokens[i + 1]!);
              if (!isNaN(vx) && !isNaN(vy)) {
                vertices.push({ x: vx, y: vy });
              }
            }
          }

          drawing.branches.push({ fromBus, toBus, ckt, vertices });
        }
        break;
      }

      case "XFR":
      case "TRANSFORMER": {
        // Format: TRANSFORMER, <fromBus>, <toBus>, <ckt>, <x>, <y>, [orientation]
        if (tokens.length >= 6) {
          const fromBus = parseInt(tokens[1]!, 10);
          const toBus = parseInt(tokens[2]!, 10);
          const ckt = tokens[3] || "1";
          const x = parseFloat(tokens[4]!);
          const y = parseFloat(tokens[5]!);
          const orientation = tokens.length > 6 ? parseFloat(tokens[6]!) : 0;
          drawing.components.push({
            kind: "transformer",
            busNumber: fromBus,
            toBus,
            id: ckt,
            x,
            y,
            orientation,
          });
        }
        break;
      }

      case "GEN":
      case "GENERATOR": {
        // Format: GEN, <busNumber>, <id>, <x>, <y>, [orientation]
        if (tokens.length >= 5) {
          const busNumber = parseInt(tokens[1]!, 10);
          const id = tokens[2] || "1";
          const x = parseFloat(tokens[3]!);
          const y = parseFloat(tokens[4]!);
          const orientation = tokens.length > 5 ? parseFloat(tokens[5]!) : 0;
          drawing.components.push({
            kind: "generator",
            busNumber,
            id,
            x,
            y,
            orientation,
          });
        }
        break;
      }

      case "LOAD": {
        // Format: LOAD, <busNumber>, <id>, <x>, <y>, [orientation]
        if (tokens.length >= 5) {
          const busNumber = parseInt(tokens[1]!, 10);
          const id = tokens[2] || "1";
          const x = parseFloat(tokens[3]!);
          const y = parseFloat(tokens[4]!);
          const orientation = tokens.length > 5 ? parseFloat(tokens[5]!) : 0;
          drawing.components.push({
            kind: "load",
            busNumber,
            id,
            x,
            y,
            orientation,
          });
        }
        break;
      }

      case "SHUNT": {
        // Format: SHUNT, <busNumber>, <id>, <x>, <y>, [orientation]
        if (tokens.length >= 5) {
          const busNumber = parseInt(tokens[1]!, 10);
          const id = tokens[2] || "1";
          const x = parseFloat(tokens[3]!);
          const y = parseFloat(tokens[4]!);
          const orientation = tokens.length > 5 ? parseFloat(tokens[5]!) : 0;
          drawing.components.push({
            kind: "shunt",
            busNumber,
            id,
            x,
            y,
            orientation,
          });
        }
        break;
      }

      case "TEXT":
      case "ANNOT":
      case "ANNOTATION": {
        // Format: TEXT, <x>, <y>, <fontSize>, <textString>, [color]
        if (tokens.length >= 5) {
          const x = parseFloat(tokens[1]!);
          const y = parseFloat(tokens[2]!);
          const fontSize = parseFloat(tokens[3]!) || 12;
          const text = tokens[4]!;
          const color = tokens.length > 5 ? tokens[5] : undefined;
          drawing.annotations.push({ x, y, fontSize, text, color });
        }
        break;
      }

      default: {
        // Check if line begins with a numeric bus ID directly (legacy shorthand)
        const busNum = parseInt(cmd, 10);
        if (!isNaN(busNum) && tokens.length >= 3) {
          const x = parseFloat(tokens[1]!);
          const y = parseFloat(tokens[2]!);
          if (!isNaN(x) && !isNaN(y)) {
            drawing.buses.set(busNum, {
              busNumber: busNum,
              x,
              y,
              width: 100,
              height: 10,
            });
          }
        }
        break;
      }
    }
  }

  return drawing;
}

/**
 * Serializes a `PsseSldDrawing` back to standard PSS/E .sld text format.
 */
export function serializePsseSld(drawing: PsseSldDrawing): string {
  const lines: string[] = [];
  lines.push("// PSS/E Single Line Diagram Drawing");
  lines.push(`SHEET, ${drawing.width}, ${drawing.height}, "${drawing.title}", ${drawing.version || 33} /`);
  lines.push("");

  lines.push("// Buses: BUS, <num>, <x>, <y>, <w>, <h>, <orient>, <name>, <baseKv>");
  for (const b of drawing.buses.values()) {
    const lbl = b.label ? `"${b.label}"` : '""';
    lines.push(
      `BUS, ${b.busNumber}, ${b.x.toFixed(1)}, ${b.y.toFixed(1)}, ${(b.width ?? 100).toFixed(1)}, ${(b.height ?? 10).toFixed(1)}, ${b.orientation ?? 0}, ${lbl}, ${b.baseKv ?? 0} /`,
    );
  }
  lines.push("");

  lines.push("// Branches: BRANCH, <from>, <to>, <ckt>, <numPts>, <x1>, <y1>...");
  for (const br of drawing.branches) {
    const pts = br.vertices.map((v) => `${v.x.toFixed(1)}, ${v.y.toFixed(1)}`).join(", ");
    const ptStr = br.vertices.length > 0 ? `, ${br.vertices.length}, ${pts}` : "";
    lines.push(`BRANCH, ${br.fromBus}, ${br.toBus}, "${br.ckt}"${ptStr} /`);
  }
  lines.push("");

  lines.push("// Equipment Glyphs: GEN/LOAD/SHUNT/TRANSFORMER");
  for (const c of drawing.components) {
    if (c.kind === "generator") {
      lines.push(`GEN, ${c.busNumber}, "${c.id}", ${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.orientation ?? 0} /`);
    } else if (c.kind === "load") {
      lines.push(`LOAD, ${c.busNumber}, "${c.id}", ${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.orientation ?? 0} /`);
    } else if (c.kind === "shunt") {
      lines.push(`SHUNT, ${c.busNumber}, "${c.id}", ${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.orientation ?? 0} /`);
    } else if (c.kind === "transformer") {
      lines.push(
        `TRANSFORMER, ${c.busNumber}, ${c.toBus ?? 0}, "${c.id}", ${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.orientation ?? 0} /`,
      );
    }
  }
  lines.push("");

  lines.push("// Annotations: TEXT, <x>, <y>, <fontSize>, <text>");
  for (const a of drawing.annotations) {
    lines.push(`TEXT, ${a.x.toFixed(1)}, ${a.y.toFixed(1)}, ${a.fontSize ?? 12}, "${a.text}" /`);
  }

  return lines.join("\n");
}

/**
 * Merges explicit coordinates from a `.sld` drawing into a `PsseCaseLike` instance.
 */
export function applySldLayoutToCase(c: PsseCaseLike, drawing: PsseSldDrawing): PsseCaseLike {
  const busList = Array.isArray(c.buses) ? c.buses : Array.from(c.buses.values());
  for (const b of busList) {
    const sldBus = drawing.buses.get(b.i);
    if (sldBus) {
      b.position = { x: sldBus.x, y: sldBus.y };
    }
  }
  return c;
}

/**
 * Converts a `PsseSldDrawing` into an AntV X6 compatible `PsseDiagramGraph`.
 */
export function sldToDiagramGraph(
  drawing: PsseSldDrawing,
  c?: PsseCaseLike,
  powerflow?: PssePowerFlowOverlay,
): PsseDiagramGraph {
  if (c) {
    applySldLayoutToCase(c, drawing);
    // Use the native diagram builder with explicit coordinates populated
    return {
      title: drawing.title,
      cells: generateSldCells(drawing, c, powerflow),
    };
  }

  const cells: PsseDiagramCell[] = [];

  // 1. Busbar Nodes
  for (const b of drawing.buses.values()) {
    const baseKv = b.baseKv ?? 138;
    const vColor = getVoltageColor(baseKv);
    cells.push({
      id: `bus_${b.busNumber}`,
      shape: "rect",
      x: b.x,
      y: b.y,
      width: b.width ?? 100,
      height: b.height ?? 12,
      label: b.label ? `${b.busNumber}\n${b.label}` : `Bus ${b.busNumber}`,
      attrs: {
        body: {
          fill: "#1e293b",
          stroke: vColor,
          strokeWidth: 2,
        },
      },
      data: {
        busNumber: b.busNumber,
        baseKv,
        voltageColor: vColor,
      },
    });
  }

  // 2. Branch Edges with explicit polyline routing
  for (const br of drawing.branches) {
    const edgeId = `edge_${br.fromBus}_${br.toBus}_${br.ckt}`;
    const fromBus = drawing.buses.get(br.fromBus);
    const color = fromBus?.baseKv ? getVoltageColor(fromBus.baseKv) : "#38bdf8";

    cells.push({
      id: edgeId,
      shape: "edge",
      source: { cell: `bus_${br.fromBus}` },
      target: { cell: `bus_${br.toBus}` },
      vertices: br.vertices.length > 0 ? br.vertices : undefined,
      labels: [{ attrs: { text: { text: `Ckt ${br.ckt}`, fill: "#94a3b8" } } }],
      attrs: {
        line: {
          stroke: color,
          strokeWidth: 2,
        },
      },
    });
  }

  // 3. Components
  for (const comp of drawing.components) {
    const id = `${comp.kind}_${comp.busNumber}_${comp.id}`;
    cells.push({
      id,
      shape: comp.kind === "generator" ? "circle" : "rect",
      x: comp.x,
      y: comp.y,
      width: 24,
      height: 24,
      label: comp.id,
      data: {
        kind: comp.kind,
        busNumber: comp.busNumber,
      },
    });
  }

  // 4. Annotations
  for (let i = 0; i < drawing.annotations.length; i++) {
    const a = drawing.annotations[i]!;
    cells.push({
      id: `annot_${i}`,
      shape: "text-block",
      x: a.x,
      y: a.y,
      label: a.text,
      attrs: {
        text: {
          fill: a.color ?? "#f8fafc",
          fontSize: a.fontSize ?? 12,
        },
      },
    });
  }

  return {
    title: drawing.title,
    cells,
  };
}

/**
 * Generates diagram cells preserving .sld explicit coordinates and branch polylines.
 */
function generateSldCells(
  drawing: PsseSldDrawing,
  c: PsseCaseLike,
  _powerflow?: PssePowerFlowOverlay,
): PsseDiagramCell[] {
  const cells: PsseDiagramCell[] = [];
  const busMap = new Map<number, PsseSldBusItem>();
  for (const b of drawing.buses.values()) {
    busMap.set(b.busNumber, b);
  }

  // Map case buses
  const caseBuses = Array.isArray(c.buses) ? c.buses : Array.from(c.buses.values());
  for (const b of caseBuses) {
    const sld = busMap.get(b.i);
    const x = sld ? sld.x : (b.position?.x ?? 200);
    const y = sld ? sld.y : (b.position?.y ?? 200);
    const w = sld?.width ?? 120;
    const h = sld?.height ?? 14;
    const vColor = getVoltageColor(b.baseKv);

    cells.push({
      id: `bus_${b.i}`,
      shape: "rect",
      x,
      y,
      width: w,
      height: h,
      label: `${b.i} ${b.name}\n${b.baseKv} kV`,
      attrs: {
        body: {
          fill: "#0f172a",
          stroke: vColor,
          strokeWidth: 2.5,
        },
      },
      data: {
        busNumber: b.i,
        baseKv: b.baseKv,
        voltageColor: vColor,
      },
    });
  }

  // Map branches
  const sldBranchMap = new Map<string, PsseSldBranchItem>();
  for (const br of drawing.branches) {
    sldBranchMap.set(`${br.fromBus}_${br.toBus}_${br.ckt.trim()}`, br);
    sldBranchMap.set(`${br.toBus}_${br.fromBus}_${br.ckt.trim()}`, br);
  }

  for (const br of c.branches) {
    const ckt = br.ckt.trim() || "1";
    const sldBr = sldBranchMap.get(`${br.i}_${br.j}_${ckt}`);
    const busI = caseBuses.find((b) => b.i === br.i);
    const color = busI ? getVoltageColor(busI.baseKv) : "#38bdf8";

    cells.push({
      id: `branch_${br.i}_${br.j}_${ckt}`,
      shape: "edge",
      source: { cell: `bus_${br.i}` },
      target: { cell: `bus_${br.j}` },
      vertices: sldBr?.vertices && sldBr.vertices.length > 0 ? sldBr.vertices : undefined,
      attrs: {
        line: {
          stroke: color,
          strokeWidth: 2,
        },
      },
    });
  }

  // Map generators
  if (c.generators) {
    for (const g of c.generators) {
      const sldComp = drawing.components.find((x) => x.kind === "generator" && x.busNumber === g.i && x.id === g.id);
      const busPos = drawing.buses.get(g.i);
      const gx = sldComp ? sldComp.x : (busPos?.x ?? 200) - 40;
      const gy = sldComp ? sldComp.y : (busPos?.y ?? 200) - 20;

      cells.push({
        id: `gen_${g.i}_${g.id}`,
        shape: "circle",
        x: gx,
        y: gy,
        width: 32,
        height: 32,
        label: `G${g.id}\n${g.pg.toFixed(1)}MW`,
        attrs: {
          body: {
            fill: "#1e293b",
            stroke: "#38bdf8",
            strokeWidth: 2,
          },
        },
      });
    }
  }

  // Map loads
  if (c.loads) {
    for (const l of c.loads) {
      const sldComp = drawing.components.find((x) => x.kind === "load" && x.busNumber === l.i && x.id === l.id);
      const busPos = drawing.buses.get(l.i);
      const lx = sldComp ? sldComp.x : (busPos?.x ?? 200) + 60;
      const ly = sldComp ? sldComp.y : (busPos?.y ?? 200) + 30;

      cells.push({
        id: `load_${l.i}_${l.id}`,
        shape: "polygon",
        x: lx,
        y: ly,
        width: 28,
        height: 28,
        label: `L${l.id}\n${l.pl.toFixed(1)}MW`,
        attrs: {
          body: {
            fill: "#1e293b",
            stroke: "#f59e0b",
            strokeWidth: 2,
          },
        },
      });
    }
  }

  return cells;
}

/**
 * Headless SVG renderer for `.sld` drawings.
 */
export function renderSldSvg(drawing: PsseSldDrawing, c?: PsseCaseLike, powerflow?: PssePowerFlowOverlay): string {
  if (c) {
    applySldLayoutToCase(c, drawing);
    return renderPsseSvg(c, powerflow);
  }

  // Standalone SVG rendering when RAW base case is not provided
  const width = Math.max(800, drawing.width);
  const height = Math.max(600, drawing.height);

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a; font-family: ui-sans-serif, system-ui, sans-serif;">\n`;
  svg += `  <style>\n`;
  svg += `    .bus-bar { stroke-linecap: round; }\n`;
  svg += `    .bus-lbl { fill: #f8fafc; font-size: 11px; font-weight: 600; }\n`;
  svg += `    .bus-sub { fill: #94a3b8; font-size: 9px; }\n`;
  svg += `    .line-wire { fill: none; stroke-linecap: round; stroke-linejoin: round; }\n`;
  svg += `    .gen-node { fill: #0f172a; stroke: #38bdf8; stroke-width: 2; }\n`;
  svg += `    .load-node { fill: #0f172a; stroke: #f59e0b; stroke-width: 2; }\n`;
  svg += `    .annot-text { fill: #cbd5e1; font-size: 11px; }\n`;
  svg += `  </style>\n`;

  // Title
  svg += `  <text x="30" y="40" fill="#e2e8f0" font-size="20" font-weight="700">${drawing.title}</text>\n`;

  // Draw Branches
  for (const br of drawing.branches) {
    const fromBus = drawing.buses.get(br.fromBus);
    const toBus = drawing.buses.get(br.toBus);
    if (!fromBus || !toBus) continue;

    const color = fromBus.baseKv ? getVoltageColor(fromBus.baseKv) : "#38bdf8";
    const x1 = fromBus.x + (fromBus.width ?? 100) / 2;
    const y1 = fromBus.y + (fromBus.height ?? 12) / 2;
    const x2 = toBus.x + (toBus.width ?? 100) / 2;
    const y2 = toBus.y + (toBus.height ?? 12) / 2;

    let pathD = `M ${x1} ${y1}`;
    if (br.vertices.length > 0) {
      for (const v of br.vertices) {
        pathD += ` L ${v.x} ${v.y}`;
      }
    }
    pathD += ` L ${x2} ${y2}`;

    svg += `  <path d="${pathD}" stroke="${color}" stroke-width="2.5" class="line-wire" />\n`;
  }

  // Draw Buses
  for (const b of drawing.buses.values()) {
    const vColor = getVoltageColor(b.baseKv ?? 138);
    const w = b.width ?? 100;
    const h = b.height ?? 12;

    svg += `  <g transform="translate(${b.x}, ${b.y})">\n`;
    svg += `    <rect x="0" y="0" width="${w}" height="${h}" rx="3" fill="#1e293b" stroke="${vColor}" stroke-width="2" />\n`;
    svg += `    <line x1="2" y1="2" x2="${w - 2}" y2="2" stroke="${vColor}" stroke-width="3" stroke-linecap="round" />\n`;
    const label = b.label || `Bus ${b.busNumber}`;
    svg += `    <text x="${w / 2}" y="${h + 14}" text-anchor="middle" class="bus-lbl">${label}</text>\n`;
    if (b.baseKv) {
      svg += `    <text x="${w / 2}" y="${h + 25}" text-anchor="middle" class="bus-sub">${b.baseKv} kV</text>\n`;
    }
    svg += `  </g>\n`;
  }

  // Draw Equipment Glyphs
  for (const c of drawing.components) {
    if (c.kind === "generator") {
      svg += `  <g transform="translate(${c.x}, ${c.y})">\n`;
      svg += `    <circle cx="12" cy="12" r="12" class="gen-node" />\n`;
      svg += `    <text x="12" y="16" text-anchor="middle" fill="#38bdf8" font-size="10" font-weight="bold">G</text>\n`;
      svg += `  </g>\n`;
    } else if (c.kind === "load") {
      svg += `  <g transform="translate(${c.x}, ${c.y})">\n`;
      svg += `    <polygon points="0,0 24,0 12,24" class="load-node" />\n`;
      svg += `    <text x="12" y="10" text-anchor="middle" fill="#f59e0b" font-size="9" font-weight="bold">L</text>\n`;
      svg += `  </g>\n`;
    }
  }

  // Draw Annotations
  for (const a of drawing.annotations) {
    svg += `  <text x="${a.x}" y="${a.y}" class="annot-text" font-size="${a.fontSize ?? 11}">${a.text}</text>\n`;
  }

  svg += `</svg>\n`;
  return svg;
}
