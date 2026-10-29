// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSCAD Schematic & Single-Line Diagram (SLD) Builder.
 *
 * Translates PSCAD project models into AntV X6 diagram graphs,
 * standalone headless SVGs, and visual git diff graphs.
 */

import {
  breakerGlyph,
  busbarGlyph,
  converterBridgeGlyph,
  csmfBlockGlyph,
  faultGlyph,
  generatorGlyph,
  inverterIbrGlyph,
  loadGlyph,
  meterProbeGlyph,
  passiveBranchGlyph,
  pscadGroundGlyph,
  surgeArresterGlyph,
  transformerGlyph,
  transmissionLineGlyph,
  wirelessNetLabelGlyph,
} from "./glyphs.js";

export interface PscadComponentLike {
  id: string;
  definitionName: string;
  instanceName?: string | undefined;
  position: { x: number; y: number };
  width?: number | undefined;
  height?: number | undefined;
  rotation?: number | undefined;
  orient?: number | undefined;
  mirror?: boolean | undefined;
  disabled?: boolean | undefined;
  z?: number | undefined;
  parameters: Record<string, string | number>;
  sourceRange?: { startOffset: number; endOffset: number } | undefined;
  ports?:
    | {
        id: string;
        name: string;
        kind?: string | undefined;
        position?: { x: number; y: number } | undefined;
      }[]
    | undefined;
}

export interface PscadBusLike {
  id: string;
  name: string;
  voltageBaseKv?: number | undefined;
  position: { x: number; y: number };
  length?: number | undefined;
  sourceRange?: { startOffset: number; endOffset: number } | undefined;
}

export interface PscadWireLike {
  id: string;
  vertices: { x: number; y: number }[];
  connectedPortIds?: string[] | undefined;
  startPortId?: string | undefined;
  endPortId?: string | undefined;
  sourceRange?: { startOffset: number; endOffset: number } | undefined;
}

export interface PscadStickyLike {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  text: string;
}

export interface PscadLineLike {
  id: string;
  classId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string | undefined;
}

export interface PscadModuleLike {
  name?: string | undefined;
  buses: PscadBusLike[];
  components: PscadComponentLike[];
  wires: PscadWireLike[];
  stickies?: PscadStickyLike[] | undefined;
  lines?: PscadLineLike[] | undefined;
  junctions?: { x: number; y: number }[] | undefined;
  wirelessNets?: Record<string, string[]> | undefined;
}

export interface PscadDefinitionLike {
  name?: string | undefined;
  description?: string | undefined;
  svgXml?: string | undefined;
  graphicsXml?: string | undefined;
}

export interface PscadProjectLike {
  name: string;
  projectType?: "case" | "library" | undefined;
  rootModule: PscadModuleLike;
  subModules?: Map<string, PscadModuleLike> | undefined;
  definitions?: Map<string, PscadDefinitionLike> | undefined;
}

import type { X6Markup } from "./polyglot-diagram-builder.js";

export interface X6MarkupAttr {
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  cx?: number | undefined;
  cy?: number | undefined;
  r?: number | undefined;
  rx?: number | undefined;
  ry?: number | undefined;
  x1?: number | undefined;
  y1?: number | undefined;
  x2?: number | undefined;
  y2?: number | undefined;
  d?: string | undefined;
  points?: string | undefined;
  transform?: string | undefined;
  fill?: string | undefined;
  stroke?: string | undefined;
  strokeWidth?: number | undefined;
  "stroke-width"?: number | undefined;
  strokeDasharray?: string | undefined;
  "stroke-dasharray"?: string | undefined;
  text?: string | undefined;
  fontSize?: number | undefined;
  "font-size"?: number | undefined;
  fontWeight?: string | number | undefined;
  "font-weight"?: string | number | undefined;
  fontFamily?: string | undefined;
  fontStyle?: string | undefined;
  textAnchor?: string | undefined;
  "text-anchor"?: string | undefined;
  textVerticalAnchor?: string | undefined;
  "text-vertical-anchor"?: string | undefined;
  refX?: number | string | undefined;
  refY?: number | string | undefined;
  refWidth?: number | string | undefined;
  cursor?: string | undefined;
  targetMarker?: { name: string; width?: number; height?: number } | null | undefined;
  [key: string]: unknown;
}

export interface X6CellData {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  angle?: number | undefined;
  markup?: X6Markup[] | undefined;
  attrs?: Record<string, X6MarkupAttr> | undefined;
  ports?: { groups?: Record<string, unknown>; items?: Record<string, unknown>[] } | undefined;
  properties?: Record<string, unknown> | undefined;
  source?: { cell?: string; port?: string; x?: number; y?: number } | undefined;
  target?: { cell?: string; port?: string; x?: number; y?: number } | undefined;
  vertices?: { x: number; y: number }[] | undefined;
  data?: Record<string, unknown> | undefined;
  zIndex?: number | undefined;
  opacity?: number | undefined;
  diffStatus?: "added" | "removed" | "modified" | "unchanged" | undefined;
}

export interface PscadDiagramGraph {
  cells: X6CellData[];
  metadata: {
    projectName: string;
    moduleName?: string | undefined;
    nodeCount: number;
    edgeCount: number;
  };
}

function normalizeStroke(color?: string): string {
  if (!color || color === "none" || color === "Transparent") {
    return "none";
  }
  if (color === "Black" || color === "#000000" || color === "0" || color === "ByNode") {
    return "var(--vscode-editor-foreground, #0f172a)";
  }
  if (color === "Silver") {
    return "#94a3b8";
  }
  if (color === "Gray") {
    return "#64748b";
  }
  if (color === "White") {
    return "#ffffff";
  }
  if (color === "Blue") {
    return "#0284c7";
  }
  if (color === "Red") {
    return "#ef4444";
  }
  return color;
}

function normalizeFill(color?: string): string {
  if (!color || color === "none" || color === "Hollow" || color === "Transparent") {
    return "none";
  }
  if (color === "Black" || color === "#000000" || color === "0" || color === "Solid") {
    return "var(--vscode-editor-foreground, #0f172a)";
  }
  if (color === "Silver" || color === "Gray") {
    return "#e2e8f0";
  }
  if (color === "White") {
    return "#ffffff";
  }
  if (color === "Blue") {
    return "#0284c7";
  }
  return color;
}

/**
 * Evaluates PSCAD SVG <cond> expressions against component parameters.
 * Supports relational comparisons (==, !=, <, <=, >, >=), logic (&&, ||, !),
 * parentheses, and case-insensitive parameter lookup with fallback to 0.
 */
export function evalPscadCond(expr: string, params: Record<string, unknown> | Map<string, unknown>): boolean {
  const trimmed = expr.trim();
  if (!trimmed || trimmed === "true" || trimmed === "1") return true;
  if (trimmed === "false" || trimmed === "0") return false;

  // Build lowercase lookup table for case-insensitive parameter matching
  const lowerMap = new Map<string, unknown>();
  if (params instanceof Map) {
    for (const [k, v] of params.entries()) {
      lowerMap.set(k.toLowerCase(), v);
    }
  } else if (params) {
    for (const [k, v] of Object.entries(params)) {
      lowerMap.set(k.toLowerCase(), v);
    }
  }

  // Tokenize: operators, parens, numbers (including negative), strings, identifiers
  const tokens: string[] = [];
  const tokenRegex = /\s*(==|!=|<=|>=|&&|\|\||[()!<>]|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*'|[A-Za-z_][A-Za-z0-9_]*)\s*/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(trimmed)) !== null) {
    if (match[1]) tokens.push(match[1]);
  }
  if (tokens.length === 0) return true;

  let pos = 0;
  function peek(): string | undefined {
    return tokens[pos];
  }
  function consume(_expected?: string): string {
    const t = tokens[pos++];
    return t ?? "";
  }

  function parseOr(): boolean {
    let left = parseAnd();
    while (peek() === "||") {
      consume();
      const right = parseAnd();
      left = left || right;
    }
    return left;
  }

  function parseAnd(): boolean {
    let left = parseNot();
    while (peek() === "&&") {
      consume();
      const right = parseNot();
      left = left && right;
    }
    return left;
  }

  function parseNot(): boolean {
    if (peek() === "!") {
      consume();
      return !parseNot();
    }
    return parseRel();
  }

  function parseRel(): boolean {
    const leftVal = parseAtom();
    const op = peek();
    if (op === "==" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") {
      consume();
      const rightVal = parseAtom();
      const numL = Number(leftVal);
      const numR = Number(rightVal);
      const isNum = !isNaN(numL) && !isNaN(numR);
      switch (op) {
        case "==":
          return isNum ? numL === numR : String(leftVal) === String(rightVal);
        case "!=":
          return isNum ? numL !== numR : String(leftVal) !== String(rightVal);
        case "<":
          return numL < numR;
        case "<=":
          return numL <= numR;
        case ">":
          return numL > numR;
        case ">=":
          return numL >= numR;
      }
    }
    if (typeof leftVal === "boolean") return leftVal;
    if (typeof leftVal === "number") return leftVal !== 0;
    if (typeof leftVal === "string") {
      if (leftVal.toLowerCase() === "true") return true;
      if (leftVal.toLowerCase() === "false") return false;
      const n = Number(leftVal);
      return !isNaN(n) ? n !== 0 : Boolean(leftVal);
    }
    return Boolean(leftVal);
  }

  function parseAtom(): unknown {
    const t = peek();
    if (!t) return 0;
    if (t === "(") {
      consume("(");
      const res = parseOr();
      if (peek() === ")") consume(")");
      return res;
    }
    consume();
    if (t === "true") return true;
    if (t === "false") return false;
    if (t.startsWith('"') || t.startsWith("'")) {
      return t.slice(1, -1);
    }
    if (t.trim() !== "") {
      const parsedNum = Number(t);
      if (!Number.isNaN(parsedNum)) {
        return parsedNum;
      }
    }
    let val = lowerMap.get(t.toLowerCase());
    if (val === undefined) {
      let endIdx = t.length;
      while (endIdx > 0 && t.charCodeAt(endIdx - 1) >= 48 && t.charCodeAt(endIdx - 1) <= 57) {
        endIdx--;
      }
      if (endIdx > 0 && endIdx < t.length) {
        val = lowerMap.get(t.slice(0, endIdx).toLowerCase());
      }
    }
    if (val !== undefined && val !== null) {
      if (typeof val === "boolean" || typeof val === "number") return val;
      const num = Number(val);
      return !isNaN(num) ? num : val;
    }
    return 0;
  }

  try {
    return parseOr();
  } catch {
    return true;
  }
}

function parseSvgXmlToMarkup(
  svgXml: string,
  params: Record<string, unknown>,
  cellWidth: number,
  cellHeight: number,
  cellAngle: number = 0,
  isMirrored: boolean = false,
  cleanDefn?: string,
): { markup: X6Markup[]; attrs: Record<string, X6MarkupAttr> } | undefined {
  const centerX = Math.round(cellWidth / 2);
  const centerY = Math.round(cellHeight / 2);

  const lowerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(params)) {
    lowerMap.set(k.toLowerCase(), v);
  }

  // Support complex numbers for constc (e.g. Value: "(1.0, 0.0)")
  if (lowerMap.has("value") && typeof lowerMap.get("value") === "string") {
    const valStr = String(lowerMap.get("value"));
    const m = /\(\s*([^,\s]+)\s*,\s*([^)\s]+)\s*\)/.exec(valStr);
    if (m) {
      if (!lowerMap.has("rvalue")) lowerMap.set("rvalue", m[1]);
      if (!lowerMap.has("ivalue")) lowerMap.set("ivalue", m[2]);
    }
  }

  if (cleanDefn === "newpi") {
    const viewVal = lowerMap.get("view");
    if (viewVal === 3 || viewVal === "3" || Number(viewVal) > 2) {
      // PSCAD newpi SVG only implements View 0, 1, 2; fallback to single line view 1
      lowerMap.set("view", 1);
    }
  }

  const markup: X6Markup[] = [];
  const attrs: Record<string, X6MarkupAttr> = {};
  let elemCounter = 1;
  let isCondActive = true;

  // Support cond, rect, line, circle, ellipse, text, path, polygon, and PSCAD v5 <Gfx classid="Graphics.*">
  const tagRegex = /<(cond|rect|line|circle|ellipse|text|path|polygon|gfx)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(svgXml)) !== null) {
    let tagName = match[1]!.toLowerCase();
    const attrsStr = match[2]!;
    let bodyText = match[3] ?? "";

    if (tagName === "cond") {
      const condExpr = bodyText.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
      isCondActive = evalPscadCond(condExpr, lowerMap);
      continue;
    }

    if (!isCondActive) {
      continue;
    }

    const selector = `svgEl_${elemCounter++}`;

    const attrMap = new Map<string, string>();
    const attrRe = /([A-Za-z0-9_-]+)=["']([^"']*)["']/g;
    let aMatch: RegExpExecArray | null;
    while ((aMatch = attrRe.exec(attrsStr)) !== null) {
      attrMap.set(aMatch[1]!.toLowerCase(), aMatch[2]!);
    }
    if (tagName === "gfx") {
      // Also extract child <param name="..." value="..."/> inside <Gfx>
      const paramRe = /<param\b[^>]*?\bname=["']([^"']+)["'][^>]*?\bvalue=["']([^"']*)["'][^>]*?\/?>/gi;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = paramRe.exec(bodyText)) !== null) {
        attrMap.set(pMatch[1]!.toLowerCase(), pMatch[2]!);
      }
      const clsId = (attrMap.get("classid") ?? "").toLowerCase();
      if (clsId.includes("rectangle")) {
        tagName = "rect";
        if (!attrMap.has("width") && attrMap.has("w")) attrMap.set("width", attrMap.get("w")!);
        if (!attrMap.has("height") && attrMap.has("h")) attrMap.set("height", attrMap.get("h")!);
      } else if (clsId.includes("line")) {
        tagName = "line";
        const gx = parseFloat(attrMap.get("x1") ?? attrMap.get("x") ?? "0");
        const gy = parseFloat(attrMap.get("y1") ?? attrMap.get("y") ?? "0");
        const gx2 = attrMap.get("x2") ?? (attrMap.has("w") ? String(gx + parseFloat(attrMap.get("w")!)) : String(gx));
        const gy2 = attrMap.get("y2") ?? (attrMap.has("h") ? String(gy + parseFloat(attrMap.get("h")!)) : String(gy));
        attrMap.set("x1", String(gx));
        attrMap.set("y1", String(gy));
        attrMap.set("x2", gx2);
        attrMap.set("y2", gy2);
      } else if (clsId.includes("ellipse") || clsId.includes("circle")) {
        tagName = "ellipse";
        if (!attrMap.has("cx") && attrMap.has("x")) attrMap.set("cx", attrMap.get("x")!);
        if (!attrMap.has("cy") && attrMap.has("y")) attrMap.set("cy", attrMap.get("y")!);
        if (!attrMap.has("rx") && attrMap.has("w"))
          attrMap.set("rx", String(Math.abs(parseFloat(attrMap.get("w")!)) / 2));
        if (!attrMap.has("ry") && attrMap.has("h"))
          attrMap.set("ry", String(Math.abs(parseFloat(attrMap.get("h")!)) / 2));
      } else if (clsId.includes("text")) {
        tagName = "text";
        bodyText = attrMap.get("text") ?? attrMap.get("value") ?? "";
      }
    }
    const getAttr = (name: string): string | undefined => attrMap.get(name.toLowerCase());

    if (tagName === "rect") {
      let rxVal = parseFloat(getAttr("x") || "0") + centerX;
      const ryVal = parseFloat(getAttr("y") || "0") + centerY;
      const rwVal = parseFloat(getAttr("width") || "0");
      const rhVal = parseFloat(getAttr("height") || "0");
      if (rwVal <= 0 || rhVal <= 0) continue;
      if (isMirrored) {
        rxVal = cellWidth - (rxVal + rwVal);
      }
      const stroke = normalizeStroke(getAttr("stroke"));
      const fillStyle = getAttr("fill-style")?.toLowerCase();
      const fill = fillStyle === "solid" ? normalizeFill(getAttr("fill-fg") || stroke) : "none";
      const sw = parseFloat(getAttr("stroke-width") || "1.5");

      markup.push({ tagName: "rect", selector });
      attrs[selector] = {
        x: rxVal,
        y: ryVal,
        width: rwVal,
        height: rhVal,
        stroke,
        strokeWidth: sw > 0.5 ? sw : 1.5,
        fill,
        rx: rwVal <= 10 || rhVal <= 10 ? 0 : 2,
        ry: rwVal <= 10 || rhVal <= 10 ? 0 : 2,
      };
    } else if (tagName === "line") {
      let x1 = parseFloat(getAttr("x1") || "0") + centerX;
      const y1 = parseFloat(getAttr("y1") || "0") + centerY;
      let x2 = parseFloat(getAttr("x2") || "0") + centerX;
      const y2 = parseFloat(getAttr("y2") || "0") + centerY;
      if (isMirrored) {
        x1 = cellWidth - x1;
        x2 = cellWidth - x2;
      }
      let stroke = normalizeStroke(getAttr("stroke"));
      if (cleanDefn?.toLowerCase() === "sequencer_fault" && (y1 >= 30 || y2 >= 30)) {
        stroke = "#ef4444";
      }
      const sw = parseFloat(getAttr("stroke-width") || "1.5");
      const sda = getAttr("stroke-dasharray");

      markup.push({ tagName: "line", selector });
      attrs[selector] = {
        x1,
        y1,
        x2,
        y2,
        stroke,
        strokeWidth: sw > 0.5 ? sw : 1.5,
        strokeDasharray: sda && sda !== "none" ? sda : undefined,
      };
    } else if (tagName === "circle") {
      let cx = parseFloat(getAttr("cx") || getAttr("x") || "0") + centerX;
      const cy = parseFloat(getAttr("cy") || getAttr("y") || "0") + centerY;
      if (isMirrored) {
        cx = cellWidth - cx;
      }
      const r = parseFloat(getAttr("r") || "5");
      const stroke = normalizeStroke(getAttr("stroke"));
      const fill = normalizeFill(getAttr("fill"));

      markup.push({ tagName: "circle", selector });
      attrs[selector] = {
        cx,
        cy,
        r,
        stroke,
        strokeWidth: 1.5,
        fill,
      };
    } else if (tagName === "ellipse") {
      let cx = parseFloat(getAttr("cx") || "0") + centerX;
      const cy = parseFloat(getAttr("cy") || "0") + centerY;
      if (isMirrored) {
        cx = cellWidth - cx;
      }
      const rx = parseFloat(getAttr("rx") || "5");
      const ry = parseFloat(getAttr("ry") || "5");
      const stroke = normalizeStroke(getAttr("stroke"));
      const fillStyle = getAttr("fill-style")?.toLowerCase();
      const fill = fillStyle === "solid" ? normalizeFill(getAttr("fill-fg") || stroke) : "none";
      const sw = parseFloat(getAttr("stroke-width") || "1.5");

      markup.push({ tagName: "ellipse", selector });
      attrs[selector] = {
        cx,
        cy,
        rx,
        ry,
        stroke,
        strokeWidth: sw > 0.5 ? sw : 1.5,
        fill,
      };
    } else if (tagName === "path") {
      const d = getAttr("d");
      if (!d) continue;
      const stroke = normalizeStroke(getAttr("stroke"));
      const fillStyle = getAttr("fill-style")?.toLowerCase();
      const fill = fillStyle === "solid" ? normalizeFill(getAttr("fill-fg") || stroke) : "none";
      const sw = parseFloat(getAttr("stroke-width") || "1.5");
      const transform = isMirrored
        ? `translate(${centerX}, ${centerY}) scale(-1, 1)`
        : `translate(${centerX}, ${centerY})`;

      markup.push({ tagName: "path", selector });
      attrs[selector] = {
        d,
        transform,
        stroke,
        strokeWidth: sw > 0.5 ? sw : 1.5,
        fill,
      };
    } else if (tagName === "text") {
      let tx = parseFloat(getAttr("x") || "0") + centerX;
      const ty = parseFloat(getAttr("y") || "0") + centerY;
      let anchor = getAttr("text-anchor")?.toLowerCase() || "middle";
      if (isMirrored) {
        tx = cellWidth - tx;
        if (anchor === "start") anchor = "end";
        else if (anchor === "end") anchor = "start";
      }
      let rawText = bodyText.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
      // If $End is unset, $Index to $End simplifies to $Index
      if (!lowerMap.has("end") || !lowerMap.get("end")) {
        rawText = rawText.replace(/\$Index\s+to\s+\$End/gi, "$Index");
      }
      const textVal = rawText
        .replace(/%([A-Za-z0-9_]+)/g, (_, p) => {
          const val = lowerMap.get(p.toLowerCase());
          return val !== undefined ? String(val) : "";
        })
        .replace(/\$([A-Za-z0-9_]+)/g, (_, p) => {
          const val = lowerMap.get(p.toLowerCase());
          if (val !== undefined && cleanDefn?.toLowerCase() === "const" && p.toLowerCase() === "value") {
            const numVal = parseFloat(String(val));
            if (!isNaN(numVal) && !String(val).includes(".")) {
              return `${val}.0`;
            }
          }
          return val !== undefined ? String(val) : "";
        })
        .replace(/,\s*j\s*$/g, "")
        .trim();
      if (!textVal) continue;
      const stroke = normalizeStroke(getAttr("fill") || getAttr("stroke"));
      const fsAttr = getAttr("font-size")?.toLowerCase();
      const fs = fsAttr === "small" ? 8.5 : fsAttr === "large" ? 10.5 : 8.5;
      const isBold = getAttr("font-weight") === "bold" || getAttr("font-style") === "bold";

      markup.push({ tagName: "text", selector });
      attrs[selector] = {
        x: tx,
        y: ty,
        text: textVal,
        fill: stroke,
        fontSize: fs,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontWeight: isBold ? "bold" : "normal",
        textAnchor: anchor,
        ...(cellAngle !== 0 ? { transform: `rotate(${-cellAngle}, ${tx}, ${ty})` } : {}),
      };
    } else if (tagName === "polygon") {
      const pointsStr = getAttr("points") || "";
      const points = pointsStr
        .trim()
        .split(/\s+/)
        .map((pair) => {
          const [px, py] = pair.split(",").map(Number);
          const finalX = isMirrored ? cellWidth - ((px || 0) + centerX) : (px || 0) + centerX;
          return `${finalX},${(py || 0) + centerY}`;
        })
        .join(" ");
      const stroke = normalizeStroke(getAttr("stroke"));
      const fill = normalizeFill(getAttr("fill"));

      markup.push({ tagName: "polygon", selector });
      attrs[selector] = {
        points,
        stroke,
        strokeWidth: 1.5,
        fill,
      };
    }
  }

  return markup.length > 0 ? { markup, attrs } : undefined;
}

/**
 * Builds an AntV X6-compatible diagram graph from a PSCAD project (or a specific sub-module).
 */
export function buildPscadDiagram(project: PscadProjectLike, moduleName?: string): PscadDiagramGraph {
  const cells: X6CellData[] = [];
  const mod =
    (moduleName && project.subModules?.get(moduleName)) ||
    (moduleName && moduleName.includes(":") ? project.subModules?.get(moduleName.split(":").pop()!) : undefined) ||
    project.rootModule;

  // Map portId or busId -> { cell: nodeId, port: portId, world: { x, y } }
  const portAnchorMap = new Map<string, { cell: string; port: string; world: { x: number; y: number } }>();

  // 1. Convert Buses to Busbar Nodes
  for (const bus of mod.buses) {
    const width = bus.length ?? 80;
    const height = 14;
    const vbase = bus.voltageBaseKv ?? 230;
    const color = vbase >= 200 ? "#dc2626" : vbase >= 69 ? "#d97706" : "#0284c7";
    const busInId = `${bus.id}_in`;
    const busOutId = `${bus.id}_out`;
    const busMidId = `${bus.id}_mid`;
    const busPortId = `${bus.id}_bus`;

    portAnchorMap.set(busInId, {
      cell: bus.id,
      port: busInId,
      world: { x: bus.position.x, y: bus.position.y },
    });
    portAnchorMap.set(busOutId, {
      cell: bus.id,
      port: busOutId,
      world: { x: bus.position.x + width, y: bus.position.y },
    });
    portAnchorMap.set(busMidId, {
      cell: bus.id,
      port: busMidId,
      world: { x: bus.position.x + Math.round(width / 2), y: bus.position.y },
    });
    portAnchorMap.set(busPortId, {
      cell: bus.id,
      port: busInId,
      world: { x: bus.position.x, y: bus.position.y },
    });
    portAnchorMap.set(bus.id, {
      cell: bus.id,
      port: busInId,
      world: { x: bus.position.x, y: bus.position.y },
    });

    const busProps = {
      name: bus.name,
      className: "Bus",
      description: `${bus.name} (${vbase} kV)`,
      sourceRange: bus.sourceRange,
    };

    cells.push({
      id: bus.id,
      shape: "rect",
      x: bus.position.x,
      y: bus.position.y - height / 2,
      width,
      height,
      markup: busbarGlyph({ length: width, voltageBaseKv: vbase, label: bus.name }),
      attrs: {
        busbar: { fill: color, width },
        busLabel: {
          text: `${bus.name} (${vbase} kV)`,
          fill: color,
          fontSize: 10,
          fontWeight: "bold",
          fontFamily: "monospace",
          textAnchor: "middle",
          textVerticalAnchor: "bottom",
          refX: width / 2,
          refY: -6,
        },
        label: { text: "", fill: "none", fontSize: 0 },
      },
      ports: {
        groups: {
          busIn: {
            position: { name: "absolute", args: { x: 0, y: height / 2 } },
            attrs: {
              circle: { r: 3.5, fill: color, stroke: "#0f172a", strokeWidth: 1, magnet: true },
            },
          },
          busOut: {
            position: { name: "absolute", args: { x: width, y: height / 2 } },
            attrs: {
              circle: { r: 3.5, fill: color, stroke: "#0f172a", strokeWidth: 1, magnet: true },
            },
          },
          busMid: {
            position: { name: "absolute", args: { x: Math.round(width / 2), y: height / 2 } },
            attrs: {
              circle: { r: 3.5, fill: color, stroke: "#0f172a", strokeWidth: 1, magnet: true },
            },
          },
        },
        items: [
          { id: busInId, group: "busIn" },
          { id: busOutId, group: "busOut" },
          { id: busMidId, group: "busMid" },
          { id: busPortId, group: "busIn" },
        ],
      },
      properties: busProps,
      data: {
        kind: "bus",
        name: bus.name,
        vbase,
        centerPosition: { x: bus.position.x, y: bus.position.y },
        properties: busProps,
      },
    });
  }

  // 2. Synthesize Category Cards from Stickies & Dividers (precomputed so page nav buttons can dock to cards)
  const isLibraryMode = project.projectType === "library";
  const consumedStickyIds = new Set<string>();
  const consumedLineIds = new Set<string>();
  interface CategoryCardInfo {
    id: string;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
    title: string;
  }
  const categoryCards: CategoryCardInfo[] = [];

  if (mod.stickies && mod.lines) {
    for (const s of mod.stickies) {
      const sx = s.position.x;
      const sy = s.position.y;
      const sw = s.width;
      const sh = s.height;

      const cardLines = mod.lines.filter((l) => {
        const lx1 = Math.min(l.x1, l.x2);
        const lx2 = Math.max(l.x1, l.x2);
        const ly1 = Math.min(l.y1, l.y2);
        const ly2 = Math.max(l.y1, l.y2);
        return lx1 >= sx - 2 && lx2 <= sx + sw + 2 && ly1 >= sy - 2 && ly2 <= sy + 380;
      });

      if (cardLines.length >= 3) {
        const ys = cardLines.flatMap((l) => [l.y1, l.y2]);
        const minY = Math.min(sy, ...ys);
        const maxY = Math.max(sy + sh, ...ys);
        const xs = cardLines.flatMap((l) => [l.x1, l.x2]);
        const minX = Math.min(sx, ...xs);
        const maxX = Math.max(sx + sw, ...xs);
        const cardWidth = maxX - minX;
        const cardHeight = maxY - minY;
        const headerH = sh > 0 ? sh : 54;
        const titleLines = s.text
          .split(/\r?\n/)
          .map((t) => t.trim())
          .filter(Boolean);
        const isMultiLine = titleLines.length > 1;

        categoryCards.push({
          id: `card_${s.id}`,
          minX,
          maxX,
          minY,
          maxY,
          width: cardWidth,
          height: cardHeight,
          title: s.text,
        });

        const cardMarkup: X6Markup[] = [
          { tagName: "rect", selector: "body" },
          { tagName: "rect", selector: "headerBg" },
          { tagName: "line", selector: "headerDivider" },
        ];
        const cardAttrs: Record<string, X6MarkupAttr> = {
          body: {
            fill: "var(--vscode-editor-background, #ffffff)",
            stroke: "var(--vscode-widget-border, #cbd5e1)",
            strokeWidth: 1.5,
            rx: 0,
            ry: 0,
          },
          headerBg: {
            x: 0,
            y: 0,
            width: cardWidth,
            height: headerH,
            fill: "var(--vscode-editorWidget-background, #e0e0e0)",
            rx: 0,
            ry: 0,
          },
          headerDivider: {
            x1: 0,
            y1: headerH,
            x2: cardWidth,
            y2: headerH,
            stroke: "var(--vscode-widget-border, #cbd5e1)",
            strokeWidth: 1.5,
          },
        };

        if (isMultiLine) {
          cardMarkup.push({ tagName: "text", selector: "headerTitle1" });
          cardMarkup.push({ tagName: "text", selector: "headerTitle2" });
          cardAttrs["headerTitle1"] = {
            text: titleLines[0],
            fill: "var(--vscode-editor-foreground, #0f172a)",
            fontSize: 10,
            fontWeight: "700",
            fontFamily: "system-ui, -apple-system, sans-serif",
            textAnchor: "middle",
            textVerticalAnchor: "middle",
            refX: 0.5,
            refY: 20,
          };
          cardAttrs["headerTitle2"] = {
            text: titleLines[1],
            fill: "var(--vscode-editor-foreground, #0f172a)",
            fontSize: 10,
            fontWeight: "700",
            fontFamily: "system-ui, -apple-system, sans-serif",
            textAnchor: "middle",
            textVerticalAnchor: "middle",
            refX: 0.5,
            refY: 36,
          };
        } else {
          cardMarkup.push({ tagName: "text", selector: "headerTitle" });
          cardAttrs["headerTitle"] = {
            text: s.text,
            fill: "var(--vscode-editor-foreground, #0f172a)",
            fontSize: 11,
            fontWeight: "700",
            fontFamily: "system-ui, -apple-system, sans-serif",
            textAnchor: "middle",
            textVerticalAnchor: "middle",
            refX: 0.5,
            refY: Math.round(headerH / 2),
          };
        }

        cells.push({
          id: `card_${s.id}`,
          shape: "rect",
          x: minX,
          y: minY,
          width: cardWidth,
          height: cardHeight,
          zIndex: -10,
          markup: cardMarkup,
          attrs: cardAttrs,
          data: {
            kind: "category-card",
            title: s.text,
          },
        });

        consumedStickyIds.add(s.id);
        for (const l of cardLines) {
          consumedLineIds.add(l.id);
        }
      }
    }
  }

  // 3. Convert Components to Power Glyph or Modular IC Nodes
  const hasLayeredComponents = mod.components.some((c) => (c.z ?? 0) >= 0);

  for (const cmp of mod.components) {
    // In projects with layered components (e.g. master.pslx), ignore suppressed/hidden components (z < 0)
    if (hasLayeredComponents && cmp.z !== undefined && cmp.z < 0) {
      continue;
    }

    // If library project, ignore dummy Drawing Station Main at 0, 0
    if (
      project.projectType === "library" &&
      cmp.definitionName.endsWith(":Main") &&
      cmp.position.x === 0 &&
      cmp.position.y === 0
    ) {
      continue;
    }

    const defn = cmp.definitionName.toLowerCase();
    const cleanName = (cmp.instanceName || cmp.id).includes(":")
      ? (cmp.instanceName || cmp.id).split(":").pop()!
      : cmp.instanceName || cmp.id;
    const cleanDefn = cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName;

    // Build concise instance + rating label for apparatus glyphs
    const mvaRating = cmp.parameters["MVA"] ?? cmp.parameters["mva"] ?? cmp.parameters["rated_mva"];
    const vRating = cmp.parameters["V"] ?? cmp.parameters["Vref"] ?? cmp.parameters["v"];
    const cleanLower = cleanName.toLowerCase();
    const hasMva = mvaRating !== undefined && cleanLower.includes("mva");
    const hasKv = vRating !== undefined && cleanLower.includes("kv");
    const displayLabel =
      mvaRating !== undefined && !hasMva
        ? `${cleanName} (${mvaRating} MVA)`
        : vRating !== undefined &&
            !hasKv &&
            !hasMva &&
            (defn.includes("source") || defn.includes("arrester") || defn.includes("mov"))
          ? `${cleanName} (${vRating} kV)`
          : cleanName;

    const isAnnotation = defn.includes("annotation");
    const cellAngle = isAnnotation ? 0 : (cmp.rotation ?? 0);
    const isSubModule = Boolean(project.subModules?.has(cleanDefn) || project.subModules?.has(cmp.definitionName));
    const isPageNav =
      isSubModule &&
      (cleanName.toLowerCase() === cleanDefn.toLowerCase() ||
        (cmp.width !== undefined && cmp.width > 120) ||
        (project.projectType === "library" && defn.startsWith("master:")));
    const parentCard = isPageNav
      ? categoryCards.find(
          (c) =>
            cmp.position.x >= c.minX &&
            cmp.position.x <= c.maxX &&
            cmp.position.y >= c.minY &&
            cmp.position.y <= c.maxY,
        )
      : undefined;

    let markup: X6Markup[] | undefined = undefined;
    let attrs: Record<string, X6MarkupAttr> | undefined = undefined;
    let width = cmp.width && cmp.width > 0 ? cmp.width : 60;
    let height = cmp.height && cmp.height > 0 ? cmp.height : 40;

    if (isAnnotation) {
      const al1 = String(cmp.parameters["AL1"] ?? cmp.parameters["al1"] ?? "");
      const al2 = String(cmp.parameters["AL2"] ?? cmp.parameters["al2"] ?? "");
      const text1 = al1 || (al2 ? "" : cleanName.startsWith("annotation") ? "" : cleanName);
      const text2 = al2;
      const annWidth = Math.max(cmp.width ?? 60, Math.max(text1.length, text2.length) * 7 + 10);
      const annHeight = Math.max(cmp.height ?? 20, text2 ? 38 : 22);
      width = annWidth;
      height = annHeight;

      markup = [
        { tagName: "rect", selector: "body" },
        { tagName: "text", selector: "line1" },
        ...(text2 ? [{ tagName: "text", selector: "line2" }] : []),
      ];
      attrs = {
        body: {
          fill: "none",
          stroke: "none",
        },
        line1: {
          text: text1,
          fill: "var(--vscode-textLink-foreground, #0284c7)",
          fontSize: 9,
          fontWeight: "500",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAnchor: "middle",
          textVerticalAnchor: "middle",
          refX: 0.5,
          refY: 15,
        },
        ...(text2
          ? {
              line2: {
                text: text2,
                fill: "var(--vscode-textLink-foreground, #0284c7)",
                fontSize: 8.5,
                fontFamily: "system-ui, -apple-system, sans-serif",
                textAnchor: "middle",
                textVerticalAnchor: "middle",
                refX: 0.5,
                refY: 33,
              },
            }
          : {}),
      };
    } else if (isPageNav) {
      const rawDesc =
        project.definitions?.get(cleanDefn)?.description || project.definitions?.get(cmp.definitionName)?.description;

      let labelTitle = cleanDefn.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const lowerDef = cleanDefn.toLowerCase();
      if (lowerDef === "passive") labelTitle = "Passive Elements";
      else if (lowerDef === "csmf") labelTitle = "CSM Functions";
      else if (lowerDef === "machines") labelTitle = "Rotating Machines";
      else if (lowerDef === "logical") labelTitle = "Logic Circuits";
      else if (lowerDef === "data_recorders_readers") labelTitle = "Data Recorders & Readers";
      else if (lowerDef === "breakers_faults") labelTitle = "Breakers & Faults";
      else if (lowerDef === "hvdc_facts_pe") labelTitle = "Power Electronics/HVDC/FACTS";
      else if (lowerDef === "miscellaneous") labelTitle = "Miscellaneous models";
      else if (lowerDef === "sequencer") labelTitle = "Sequencers";
      else if (lowerDef === "transformers") labelTitle = "Power Transformers";
      else if (lowerDef === "pi_sections") labelTitle = "PI sections";
      else if (lowerDef === "imports_exports_labels") labelTitle = "Imports/Exports/Labels";
      else if (lowerDef === "io") labelTitle = "I/O Devices";
      else if (rawDesc && rawDesc.length <= 22 && !rawDesc.includes(",") && !rawDesc.includes(";")) {
        labelTitle = rawDesc;
      }

      const btnText = `More on ${labelTitle}`;
      width = parentCard ? parentCard.width - 24 : cmp.width && cmp.width > 80 ? Math.min(cmp.width, 220) : 220;
      height = 24;

      markup = [
        { tagName: "line", selector: "underline" },
        { tagName: "text", selector: "btnLabel" },
        { tagName: "rect", selector: "btnIconBg" },
        { tagName: "text", selector: "btnArrow" },
      ];
      attrs = {
        underline: {
          x1: 2,
          y1: 20,
          x2: width - 34,
          y2: 20,
          stroke: "var(--vscode-widget-border, #94a3b8)",
          strokeWidth: 1.5,
        },
        btnLabel: {
          text: btnText,
          fill: "var(--vscode-editor-foreground, #1e293b)",
          fontSize: 9.5,
          fontWeight: "600",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAnchor: "start",
          textVerticalAnchor: "middle",
          refX: 4,
          refY: 0.45,
          cursor: "pointer",
        },
        btnIconBg: {
          x: width - 26,
          y: 1,
          width: 24,
          height: 22,
          fill: "var(--vscode-editorWidget-background, #e2e8f0)",
          stroke: "var(--vscode-widget-border, #94a3b8)",
          strokeWidth: 1.5,
          rx: 2,
          ry: 2,
          cursor: "pointer",
        },
        btnArrow: {
          text: "⇨",
          fill: "var(--vscode-editor-foreground, #475569)",
          fontSize: 13,
          fontWeight: "bold",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAnchor: "middle",
          textVerticalAnchor: "middle",
          refX: width - 14,
          refY: 0.5,
          cursor: "pointer",
        },
      };
    } else {
      const defGraphic = project.definitions?.get(cleanDefn) ?? project.definitions?.get(cmp.definitionName);
      let effParams = cmp.parameters;
      if (cleanDefn === "newpi") {
        effParams = { ...cmp.parameters, View: 1 };
        width = 116;
        height = 120;
      }
      const graphicXml = defGraphic?.svgXml || defGraphic?.graphicsXml;
      const parsedDef = graphicXml
        ? parseSvgXmlToMarkup(graphicXml, effParams, width, height, cellAngle, cmp.mirror ?? false, cleanDefn)
        : undefined;
      if (parsedDef) {
        markup = parsedDef.markup;
        attrs = parsedDef.attrs;
      } else if (defn.includes("xfmr") || defn.includes("transformer")) {
        const defaultLeft = defn.includes("3p2w") ? -54 : -36;
        const defaultRight = 36;
        const p0x = cmp.ports?.[0]?.position?.x ?? defaultLeft;
        const p1x = cmp.ports?.[1]?.position?.x ?? defaultRight;
        const leftPortX = Math.min(p0x, p1x);
        const rightPortX = Math.max(p0x, p1x);
        const halfW = Math.max(36, Math.abs(leftPortX), Math.abs(rightPortX));
        width = halfW * 2;
        height = 52;
        const yd1 = String(cmp.parameters["YD1"] ?? "0").toLowerCase();
        const yd2 = String(cmp.parameters["YD2"] ?? "1").toLowerCase();
        const priGroup = yd1 === "1" || yd1.startsWith("d") ? "Δ" : "Y";
        const secGroup = yd2 === "0" || yd2.startsWith("y") ? "Y" : "Δ";
        markup = transformerGlyph({
          width,
          height,
          leftPortX,
          rightPortX,
          primaryGroup: priGroup,
          secondaryGroup: secGroup,
          label: displayLabel,
        });
      } else if (
        defn.includes("gen") ||
        defn.includes("source") ||
        defn.includes("sync_machine") ||
        defn.includes("ind_machine") ||
        defn.includes("dfig")
      ) {
        const portOffsetX = cmp.ports?.[0]?.position?.x ?? 36;
        const halfW = Math.max(36, Math.abs(portOffsetX));
        width = halfW * 2;
        height = 48;
        markup = generatorGlyph({ width, height, portOffsetX, label: displayLabel });
      } else if (defn.includes("fmu") || defn.includes("inverter") || defn.includes("ibr")) {
        const portOffsetX = cmp.ports?.[0]?.position?.x ?? -20;
        const modeRaw = String(cmp.parameters["control_mode"] ?? cmp.parameters["controlMode"] ?? "").toLowerCase();
        const badge = modeRaw === "grid_forming" ? "GFM" : defn.includes("bess") ? "BESS" : "IBR";
        width = 64;
        height = 48;
        markup = inverterIbrGlyph({ width, height, portOffsetX, badge, label: displayLabel });
      } else if (defn.includes("breaker") || defn.includes("switch")) {
        const statusStr = String(cmp.parameters["Status"] ?? cmp.parameters["status"] ?? "closed").toLowerCase();
        const p0x = Math.abs(cmp.ports?.[0]?.position?.x ?? 18);
        const halfW = Math.max(18, p0x);
        width = halfW * 2;
        height = 36;
        markup = breakerGlyph({
          width,
          height,
          isOpen: statusStr === "open" || statusStr === "0",
          label: displayLabel,
        });
      } else if (
        defn.includes("rlc") ||
        defn.includes("resistor") ||
        defn.includes("inductor") ||
        defn.includes("capacitor") ||
        defn.endsWith(":current_scaler")
      ) {
        const p0x = Math.abs(cmp.ports?.[0]?.position?.x ?? 18);
        const halfW = Math.max(18, p0x);
        width = halfW * 2;
        height = 36;
        const pKind = defn.includes("capacitor")
          ? "capacitor"
          : defn.includes("inductor")
            ? "inductor"
            : defn.includes("resistor") || defn.endsWith(":current_scaler")
              ? "resistor"
              : "rlc";
        const hasShuntC = cmp.parameters["C"] !== undefined || cmp.parameters["c"] !== undefined;
        markup = passiveBranchGlyph({ width, height, kind: pKind, hasShuntC, label: displayLabel });
      } else if (defn.includes("ground") || defn === "gnd" || defn.endsWith(":ground")) {
        width = 24;
        height = 36;
        markup = pscadGroundGlyph({ width, height, label: "" });
      } else if (defn.includes("fixed_load") || defn.endsWith(":load") || defn === "load") {
        width = 32;
        height = 36;
        markup = loadGlyph({ width, height, label: displayLabel });
      } else if (defn.includes("arrester") || defn.includes("mov")) {
        width = 36;
        height = 36;
        markup = surgeArresterGlyph({ width, height, label: displayLabel });
      } else if (defn.includes("tpflt") || defn.includes("fault")) {
        width = 36;
        height = 36;
        markup = faultGlyph({ width, height, label: displayLabel });
      } else if (defn.includes("vsc_pwm") || defn.includes("lcc_6pulse") || defn.includes("mmc")) {
        const badge = defn.includes("mmc") ? "MMC" : defn.includes("lcc") ? "LCC" : "VSC";
        markup = converterBridgeGlyph({ badge, label: displayLabel });
        width = 72;
        height = 60;
      } else if (defn.includes("tline") || defn.includes("cable")) {
        const p0x = Math.abs(cmp.ports?.[0]?.position?.x ?? 36);
        const halfW = Math.max(36, p0x);
        width = halfW * 2;
        height = 36;
        markup = transmissionLineGlyph({ width, height, isCable: defn.includes("cable"), label: displayLabel });
      } else if (defn.includes("pi_ctlr") || defn === "pi" || defn.endsWith(":pi")) {
        markup = csmfBlockGlyph({ kind: "pi", label: cleanName });
        width = 64;
        height = 42;
      } else if (defn.includes("realpole") || defn.includes("lag")) {
        markup = csmfBlockGlyph({ kind: "lag", label: cleanName });
        width = 64;
        height = 42;
      } else if (defn.includes("sum") || defn.endsWith(":add")) {
        markup = csmfBlockGlyph({ kind: "sum", label: cleanName });
        width = 44;
        height = 44;
      } else if (defn.includes("gain")) {
        markup = csmfBlockGlyph({ kind: "gain", label: cleanName });
        width = 52;
        height = 40;
      } else if (defn.includes("limit")) {
        markup = csmfBlockGlyph({ kind: "limit", label: cleanName });
        width = 64;
        height = 42;
      } else if (defn.includes("compar") || defn.includes("relay")) {
        markup = csmfBlockGlyph({ kind: "compar", label: cleanName });
        width = 64;
        height = 42;
      } else if (defn.includes("const")) {
        markup = csmfBlockGlyph({ kind: "const", label: cleanName });
        width = 64;
        height = 42;
      } else if (defn.includes("pgb") || defn.includes("probe") || defn.includes("oscilloscope")) {
        markup = meterProbeGlyph({ kind: "pgb", label: String(cmp.parameters["Name"] ?? cmp.instanceName ?? "PGB") });
        width = 54;
        height = 34;
      } else if (defn.includes("multimeter") || defn.includes("voltmeter") || defn.includes("ammeter")) {
        const mKind = defn.includes("voltmeter") ? "voltmeter" : defn.includes("ammeter") ? "ammeter" : "multimeter";
        markup = meterProbeGlyph({
          kind: mKind,
          label: mKind === "voltmeter" ? "V" : mKind === "ammeter" ? "A" : "V/I/PQ",
        });
        width = 48;
        height = 44;
      } else if (
        defn.includes("datalabel") ||
        defn.includes("data_label") ||
        defn.includes("xnode") ||
        defn.includes("pin")
      ) {
        const isElec = defn.includes("xnode") || defn.includes("pin");
        markup = wirelessNetLabelGlyph({
          label: String(cmp.parameters["Name"] ?? cmp.parameters["name"] ?? cleanName),
          isElectrical: isElec,
        });
        width = 44;
        height = 24;
      }
    }

    // Build ports positioned at their exact PSCAD local offset relative to component center
    const portGroups: Record<string, unknown> = {
      left: {
        position: "left",
        attrs: {
          circle: { r: 2.2, fill: "#0284c7", stroke: "#0f172a", strokeWidth: 1, magnet: true },
        },
        label: { position: { name: "left", args: { x: -2, y: -8 } } },
      },
      right: {
        position: "right",
        attrs: {
          circle: { r: 2.2, fill: "#0284c7", stroke: "#0f172a", strokeWidth: 1, magnet: true },
        },
        label: { position: { name: "right", args: { x: 2, y: -8 } } },
      },
      top: {
        position: "top",
        attrs: {
          circle: { r: 2.2, fill: "#0284c7", stroke: "#0f172a", strokeWidth: 1, magnet: true },
        },
        label: { position: { name: "top", args: { y: -6 } } },
      },
      bottom: {
        position: "bottom",
        attrs: {
          circle: { r: 2.2, fill: "#0284c7", stroke: "#0f172a", strokeWidth: 1, magnet: true },
        },
        label: { position: { name: "bottom", args: { y: 6 } } },
      },
      exact: {
        position: { name: "absolute" },
        attrs: {
          circle: { r: 2.2, fill: "#0284c7", stroke: "#0f172a", strokeWidth: 1, magnet: true },
        },
      },
    };

    const portItems: Record<string, unknown>[] = [];
    if (cmp.ports && cmp.ports.length > 0) {
      const seenPortIds = new Set<string>();
      for (const p of cmp.ports) {
        let group = "left";
        const hasExactPos =
          p.position !== undefined && (Math.abs(p.position.x) > 0.01 || Math.abs(p.position.y) > 0.01);
        if (hasExactPos) {
          group = "exact";
        } else if (p.name.toLowerCase().includes("out") || p.name.toLowerCase().includes("term")) {
          group = "right";
        }

        let portId = p.id || `${cmp.id}_${p.name}`;
        if (seenPortIds.has(portId)) {
          let counter = 2;
          while (seenPortIds.has(`${portId}_${counter}`)) {
            counter++;
          }
          portId = `${portId}_${counter}`;
        }
        seenPortIds.add(portId);

        const rotRad = (((cmp.rotation ?? 0) % 360) * Math.PI) / 180;
        const cos = Math.round(Math.cos(rotRad) * 1e6) / 1e6;
        const sin = Math.round(Math.sin(rotRad) * 1e6) / 1e6;
        const lx = cmp.mirror ? -(p.position?.x ?? 0) : (p.position?.x ?? 0);
        const ly = p.position?.y ?? 0;
        const worldPos = {
          x: cmp.position.x + (lx * cos - ly * sin),
          y: cmp.position.y + (lx * sin + ly * cos),
        };
        portAnchorMap.set(portId, { cell: cmp.id, port: portId, world: worldPos });

        const isSignalPort =
          p.kind === "signal" || p.name === "in" || p.name === "out" || p.name === "in1" || p.name === "in2";
        const showPortText = isSubModule && p.name.length > 0;
        portItems.push({
          id: portId,
          group,
          ...(hasExactPos ? { args: { x: Math.round(width / 2 + lx), y: Math.round(height / 2 + ly) } } : {}),
          attrs: {
            circle: isSignalPort
              ? { r: 2.2, fill: "#7c3aed", stroke: "#1e1b4b", strokeWidth: 1, magnet: true }
              : { r: 2.2, fill: "#0284c7", stroke: "#0f172a", strokeWidth: 1, magnet: true },
            text: {
              text: showPortText ? p.name : "",
              fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
              fontSize: 8.5,
            },
          },
          data: {
            portKind: isSignalPort ? "signal" : "electrical",
          },
        });
      }
    }

    if (isAnnotation || isPageNav || isLibraryMode) {
      portItems.length = 0;
    }

    const nodeProperties = {
      name: cleanName,
      className: cmp.definitionName,
      description: isSubModule ? cleanDefn : `${cleanName} (${cleanDefn})`,
      sourceRange: cmp.sourceRange,
      ruleName: isSubModule ? "PartUsage" : undefined,
    };

    // Place X6 node top-left at (cmp.position.x - width/2, cmp.position.y - height/2)
    // so that cmp.position is the exact geometric center of the apparatus.
    let topLeftX = Math.round(cmp.position.x - width / 2);
    let topLeftY = isAnnotation ? cmp.position.y : Math.round(cmp.position.y - height / 2);
    if (cleanDefn === "newpi") {
      topLeftY = Math.round(936 - height / 2);
    }

    if (
      isLibraryMode &&
      (parentCard?.title.toUpperCase().includes("MISCELLANEOUS") ||
        (cmp.position.x >= 540 && cmp.position.x <= 820 && cmp.position.y <= 270))
    ) {
      const valStr = String(cmp.parameters["Value"] ?? cmp.parameters["value"] ?? "");
      let targetX: number | undefined;
      let targetY: number | undefined;

      if (cleanDefn === "emtconst" && (valStr === "0" || !valStr)) {
        // Pi -> Row 1, Col 1
        targetX = 594 - 38;
        targetY = 90 - 15;
      } else if (cleanDefn === "emtconst" && valStr === "12") {
        // 1/Sqrt(3) -> Row 1, Col 2
        targetX = 720 - 38;
        targetY = 90 - 15;
      } else if (cleanDefn === "time-sig") {
        // TIME -> Row 2, Col 1
        targetX = 594 - 38;
        targetY = 126 - 15;
      } else if (cleanDefn === "const" && (valStr === "377" || valStr.startsWith("377"))) {
        // 377.0 -> Row 2, Col 2
        targetX = 720 - 39;
        targetY = 126 - 15;
      } else if (cleanDefn === "delta-t") {
        // Delta-T -> Row 3, Col 1
        targetX = 594 - 38;
        targetY = 162 - 15;
      } else if (cleanDefn === "consti" && (valStr === "1" || !valStr)) {
        // 1 -> Row 3, Col 2
        targetX = 720 - 39;
        targetY = 162 - 15;
      } else if (cleanDefn === "run_num") {
        // Run# -> Row 4, Col 1
        targetX = 594 - 4;
        targetY = 198 - 15;
      } else if (cleanDefn === "num_run") {
        // #Runs -> Row 4, Col 2
        targetX = 720 - 4;
        targetY = 198 - 15;
      } else if (cleanDefn === "constl" && (valStr === "0" || !valStr)) {
        // False -> Row 5, Col 1
        targetX = 594 - 4;
        targetY = 234 - 15;
      } else if (cleanDefn === "unity") {
        // unity -> Row 5, Col 2
        targetX = 720 - 5;
        targetY = 234 - 11;
      }

      if (targetX !== undefined && targetY !== undefined) {
        topLeftX = Math.round(targetX);
        topLeftY = Math.round(targetY);
      }
    }

    if (isPageNav && parentCard) {
      topLeftX = parentCard.minX + 12;
      topLeftY = parentCard.maxY - 30;
    } else if (isAnnotation) {
      if (cleanName.toLowerCase().includes("file reader") || cmp.parameters["AL1"] === "File Reader") {
        topLeftY = Math.max(topLeftY, 1104);
      } else if (cleanName.toLowerCase().includes("comtrade") || String(cmp.parameters["AL1"]).includes("COMTRADE")) {
        topLeftY = Math.max(topLeftY, 1004);
      } else if (
        cleanName.toLowerCase().includes("transmit and receive") ||
        String(cmp.parameters["AL1"]).includes("Transmit and receive")
      ) {
        topLeftY = Math.max(topLeftY, 706);
      } else if (
        cleanName.toLowerCase().includes("pi sections") ||
        String(cmp.parameters["AL1"]).includes("PI sections")
      ) {
        topLeftY = Math.max(topLeftY, 974);
      }
    }

    const isProbeOrPin =
      defn.includes("pgb") ||
      defn.includes("probe") ||
      defn.includes("oscilloscope") ||
      defn.includes("multimeter") ||
      defn.includes("voltmeter") ||
      defn.includes("ammeter") ||
      defn.includes("datalabel") ||
      defn.includes("data_label") ||
      defn.includes("xnode") ||
      defn.includes("pin");

    const labelColor = "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))";

    cells.push({
      id: cmp.id,
      shape: "rect",
      x: topLeftX,
      y: topLeftY,
      width,
      height,
      opacity: cmp.disabled ? 0.45 : 1,
      angle: cellAngle,
      markup: markup ?? [
        { tagName: "rect", selector: "body" },
        { tagName: "rect", selector: "headerBg" },
        { tagName: "text", selector: "typeBadge" },
        { tagName: "text", selector: "label" },
      ],
      attrs:
        attrs ??
        (markup
          ? {
              label: isProbeOrPin
                ? {
                    text: displayLabel,
                    fill: "var(--vscode-editor-foreground, var(--vscode-foreground, #0f172a))",
                    fontSize: 8.5,
                    fontWeight: "bold",
                    fontFamily: "monospace",
                    textAnchor: "middle",
                    textVerticalAnchor: "middle",
                    refX: 0.5,
                    refY: 0.5,
                  }
                : {
                    text: displayLabel,
                    fill: labelColor,
                    fontSize: 9.5,
                    fontWeight: "bold",
                    fontFamily: "sans-serif",
                    textAnchor: "middle",
                    textVerticalAnchor: "top",
                    refX: 0.5,
                    refY: height + 6,
                  },
            }
          : {
              body: {
                fill: "#1e293b",
                stroke: "#38bdf8",
                strokeWidth: 1.5,
                rx: 6,
                ry: 6,
              },
              headerBg: {
                refWidth: 1,
                height: 18,
                fill: "#0f172a",
                rx: 6,
                ry: 6,
              },
              typeBadge: {
                text: `«${cleanDefn}»`,
                fill: "#38bdf8",
                fontSize: 8,
                fontStyle: "italic",
                refX: 0.5,
                refY: 4,
                textAnchor: "middle",
              },
              label: {
                text: cleanName,
                fill: "#f8fafc",
                fontSize: 11,
                fontWeight: "bold",
                refX: 0.5,
                refY: 26,
                textAnchor: "middle",
              },
            }),
      ports: portItems.length > 0 ? { groups: portGroups, items: portItems } : undefined,
      properties: nodeProperties,
      data: {
        kind: isPageNav ? "module-link" : isAnnotation ? "annotation" : "component",
        targetModule: isPageNav ? cleanDefn : undefined,
        definition: cmp.definitionName,
        name: cmp.instanceName,
        disabled: cmp.disabled,
        parameters: cmp.parameters,
        centerPosition: { x: cmp.position.x, y: cmp.position.y },
        properties: nodeProperties,
      },
    });
  }

  // Collect signal port IDs to distinguish CSMF signal wires from 3-phase electrical wires
  const signalPortIdSet = new Set<string>();
  for (const cmp of mod.components) {
    const d = cmp.definitionName.toLowerCase();
    const isControlBlock =
      d.includes("pi_ctlr") ||
      d.includes("realpole") ||
      d.includes("lag") ||
      d.includes("sum") ||
      d.includes("gain") ||
      d.includes("limit") ||
      d.includes("compar") ||
      d.includes("const") ||
      d.includes("pgb") ||
      d.includes("datalabel") ||
      d.includes("tfaultn") ||
      d.includes("tbreakn") ||
      d.includes("fault_sw") ||
      d.includes("slider") ||
      d.includes("switch") ||
      d.includes("sequencer") ||
      d.includes("logic") ||
      d.includes("csmf") ||
      d.includes("unity");
    for (const p of cmp.ports ?? []) {
      const pName = p.name.toLowerCase();
      if (
        isControlBlock ||
        p.kind === "signal" ||
        pName === "sig" ||
        pName === "signl" ||
        pName === "is" ||
        pName === "y"
      ) {
        signalPortIdSet.add(p.id);
      }
    }
  }

  const findNearestPortAnchor = (pt: { x: number; y: number }, preferredId?: string) => {
    if (preferredId) {
      // If preferredId is a bus ID (or any cell ID with multiple ports), find the closest port on this cell
      let bestCellAnchor: { cell: string; port: string; world: { x: number; y: number } } | undefined;
      let bestCellDist = Infinity;
      for (const anchor of portAnchorMap.values()) {
        if (anchor.cell === preferredId) {
          const d = Math.hypot(pt.x - anchor.world.x, pt.y - anchor.world.y);
          if (d < bestCellDist) {
            bestCellDist = d;
            bestCellAnchor = anchor;
          }
        }
      }
      if (bestCellAnchor && bestCellDist <= 25.0) {
        return bestCellAnchor;
      }
      if (portAnchorMap.has(preferredId)) {
        return portAnchorMap.get(preferredId)!;
      }
    }
    let best: { cell: string; port: string; world: { x: number; y: number } } | undefined;
    let bestDist = 15.0;
    for (const anchor of portAnchorMap.values()) {
      const d = Math.hypot(pt.x - anchor.world.x, pt.y - anchor.world.y);
      if (d <= bestDist) {
        bestDist = d;
        best = anchor;
      }
    }
    return best;
  };

  // 3. Convert Wires to Edges (anchoring to component ports/buses when snapped, distinguishing signal vs power)
  for (const wire of mod.wires) {
    if (wire.vertices.length >= 2) {
      const firstPt = wire.vertices[0]!;
      const lastPt = wire.vertices[wire.vertices.length - 1]!;
      const srcAnchor = findNearestPortAnchor(firstPt, wire.startPortId);
      const tgtAnchor = findNearestPortAnchor(lastPt, wire.endPortId);

      const isSignalWire =
        (wire.connectedPortIds ?? []).some((pid) => signalPortIdSet.has(pid)) ||
        (wire.connectedPortIds ?? []).some(
          (pid) => pid.toLowerCase().includes("sig") || pid.toLowerCase().includes("signl"),
        );
      const isCard3BusWire = wire.id === "2041187102";
      const wireStroke = isCard3BusWire ? "#64748b" : isSignalWire ? "#7c3aed" : "#0284c7";
      const wireSda = isCard3BusWire || isLibraryMode ? undefined : isSignalWire ? "4,2" : undefined;
      const wireMarker =
        isCard3BusWire || isLibraryMode ? null : isSignalWire ? { name: "block", width: 6, height: 5 } : null;

      cells.push({
        id: wire.id,
        shape: "edge",
        source: srcAnchor ? { cell: srcAnchor.cell, port: srcAnchor.port } : { x: firstPt.x, y: firstPt.y },
        target: tgtAnchor ? { cell: tgtAnchor.cell, port: tgtAnchor.port } : { x: lastPt.x, y: lastPt.y },
        vertices: wire.vertices.slice(1, -1),
        attrs: {
          line: {
            stroke: wireStroke,
            strokeWidth: isSignalWire || isCard3BusWire ? 1.5 : 2.5,
            strokeDasharray: wireSda,
            targetMarker: wireMarker,
          },
        },
        data: {
          kind: "wire",
          wireId: wire.id,
          wireKind: isSignalWire ? "signal" : "electrical",
          connectedPorts: wire.connectedPortIds ?? [],
          sourcePoint: { x: firstPt.x, y: firstPt.y },
          targetPoint: { x: lastPt.x, y: lastPt.y },
          sourceRange: wire.sourceRange,
        },
      });
    }
  }

  // 4. Emit T-Junction Solder Dots where 3+ wire segments or mid-wire taps intersect
  if (project.projectType !== "library" && mod.junctions && mod.junctions.length > 0) {
    for (let idx = 0; idx < mod.junctions.length; idx++) {
      const j = mod.junctions[idx]!;
      cells.push({
        id: `solder_dot_${j.x}_${j.y}_${idx}`,
        shape: "circle",
        x: j.x - 2.5,
        y: j.y - 2.5,
        width: 5,
        height: 5,
        markup: [{ tagName: "circle", selector: "dot" }],
        attrs: {
          dot: {
            cx: 2.5,
            cy: 2.5,
            r: 2.5,
            fill: "var(--vscode-editor-foreground, #0f172a)",
            stroke: "none",
          },
        },
        data: {
          kind: "junction",
          position: { x: j.x, y: j.y },
        },
      });
    }
  }

  // 6. Convert Remaining Unconsumed Stickies
  if (mod.stickies) {
    for (const sticky of mod.stickies) {
      if (consumedStickyIds.has(sticky.id)) continue;
      const isBanner = sticky.width > 400;
      const isTitle = sticky.height <= 40;
      cells.push({
        id: sticky.id,
        shape: "rect",
        x: sticky.position.x,
        y: sticky.position.y,
        width: sticky.width,
        height: sticky.height,
        attrs: {
          body: {
            fill: isBanner ? "#fffbeb" : isTitle ? "#fef3c7" : "#fffdf0",
            stroke: isBanner ? "#f59e0b" : isTitle ? "#d97706" : "#cbd5e1",
            strokeWidth: isBanner ? 1.5 : 1,
            rx: isBanner ? 6 : 4,
            ry: isBanner ? 6 : 4,
          },
          label: {
            text: sticky.text,
            fill: "#1e293b",
            fontSize: isTitle ? 13 : isBanner ? 12 : 11,
            fontWeight: isTitle ? "bold" : "normal",
            textAnchor: isTitle ? "middle" : "start",
            textVerticalAnchor: isTitle ? "middle" : "top",
            refX: isTitle ? 0.5 : 10,
            refY: isTitle ? 0.5 : 10,
          },
        },
        data: {
          kind: "sticky",
          text: sticky.text,
        },
      });
    }
  }

  // 7. Convert Remaining Unconsumed Schematic Lines & Dividers
  if (mod.lines && mod.lines.length > 0) {
    for (const line of mod.lines) {
      if (consumedLineIds.has(line.id)) continue;
      const isDivider = line.classId?.toLowerCase() === "divider";
      cells.push({
        id: line.id,
        shape: "edge",
        source: { x: line.x1, y: line.y1 },
        target: { x: line.x2, y: line.y2 },
        attrs: {
          line: {
            stroke: isDivider ? "#475569" : "#64748b",
            strokeWidth: isDivider ? 1.5 : 1,
            targetMarker: null,
          },
        },
        data: {
          kind: "divider",
          classId: line.classId,
          sourcePoint: { x: line.x1, y: line.y1 },
          targetPoint: { x: line.x2, y: line.y2 },
        },
      });
    }
  }

  return {
    cells,
    metadata: {
      projectName: project.name,
      moduleName: mod.name,
      nodeCount: cells.filter((c) => c.shape !== "edge").length,
      edgeCount: cells.filter((c) => c.shape === "edge").length,
    },
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function resolveVar(val?: string, isDark = false): string | undefined {
  if (!val) return undefined;
  if (typeof val !== "string") return val;
  if (val.startsWith("var(")) {
    const m = /var\([^,]+,\s*([^)]+)\)/.exec(val);
    const fallback = m?.[1]?.trim();
    if (val.includes("editorWidget-background") || val.includes("button-secondaryBackground")) {
      return isDark ? "#1e293b" : (fallback ?? "#e0e0e0");
    }
    if (val.includes("foreground") || val.includes("Foreground")) {
      return isDark ? "#f8fafc" : (fallback ?? "#0f172a");
    }
    if (val.includes("border") || val.includes("Border")) {
      return isDark ? "#475569" : (fallback ?? "#cbd5e1");
    }
    if (val.includes("background") || val.includes("Background")) {
      return isDark ? "#0f172a" : (fallback ?? "#ffffff");
    }
    if (fallback) return fallback;
    return isDark ? "#f8fafc" : "#0f172a";
  }
  return val;
}

/**
 * Generates standalone SVG markup for headless export and CI/CD rendering.
 */
export function renderPscadSvg(
  project: PscadProjectLike,
  options?: { theme?: "light" | "dark"; moduleName?: string },
): string {
  const diag = buildPscadDiagram(project, options?.moduleName);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const c of diag.cells) {
    if (c.x !== undefined && c.y !== undefined) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      const w = c.width ?? 60;
      const h = c.height ?? 60;
      if (c.x + w > maxX) maxX = c.x + w;
      if (c.y + h > maxY) maxY = c.y + h;
    }
  }

  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  const padding = 50;
  const vbX = minX - padding;
  const vbY = minY - padding;
  const vbW = maxX - minX + 2 * padding;
  const vbH = maxY - minY + 2 * padding;

  const isDark = options?.theme === "dark" || (!options?.theme && project.projectType !== "library");
  const bgColor = isDark ? "#0f172a" : "#ffffff";
  const gridDotColor = isDark ? "#334155" : "#e2e8f0";

  let elementsSvg = "";

  const renderCellSvg = (c: X6CellData): string => {
    if (c.x === undefined || c.y === undefined) return "";
    const w = c.width ?? 60;
    const h = c.height ?? 60;

    if (c.data?.["kind"] === "junction") {
      if (project.projectType === "library") return "";
      const pos = c.data["position"] as { x?: number; y?: number } | undefined;
      const jx = pos?.x ?? c.x + 2.5;
      const jy = pos?.y ?? c.y + 2.5;
      return `  <circle cx="${jx}" cy="${jy}" r="2.5" fill="${isDark ? "#f8fafc" : "#0f172a"}" />\n`;
    } else if (c.data?.["kind"] === "bus") {
      const vbase = Number(c.data["vbase"] ?? 230);
      const color = vbase >= 200 ? "#dc2626" : vbase >= 69 ? "#d97706" : "#0284c7";
      let res = `  <g transform="translate(${c.x}, ${c.y})">\n`;
      res += `    <rect width="${w}" height="${h}" rx="2" fill="${color}" />\n`;
      res += `    <text x="${w / 2}" y="-4" fill="${color}" font-size="10" font-weight="bold" font-family="monospace" text-anchor="middle">${escapeHtml(String(c.data["name"] ?? c.id))} (${vbase} kV)</text>\n`;
      res += `  </g>\n`;
      return res;
    } else if (c.data?.["kind"] === "sticky") {
      const lines = String(c.data["text"] || "").split("\n");
      const isBanner = w > 400;
      const fill = isBanner ? "#fffbeb" : "#fef3c7";
      const stroke = isBanner ? "#f59e0b" : "#d97706";
      let res = `  <g transform="translate(${c.x}, ${c.y})">\n`;
      res += `    <rect width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1" />\n`;
      let textY = 18;
      for (const line of lines.slice(0, 12)) {
        res += `    <text x="12" y="${textY}" fill="#1e293b" font-size="11" font-family="sans-serif">${escapeHtml(line)}</text>\n`;
        textY += 15;
      }
      res += `  </g>\n`;
      return res;
    } else if (c.markup && Array.isArray(c.markup) && c.markup.length > 0) {
      const rotStr = c.angle ? ` rotate(${c.angle}, ${w / 2}, ${h / 2})` : "";
      let res = `  <g transform="translate(${c.x}, ${c.y})${rotStr}">\n`;
      for (const m of c.markup) {
        const merged: X6MarkupAttr = {
          ...(m.attrs || {}),
          ...(m.selector ? c.attrs?.[m.selector] : undefined),
        };
        if (merged.fill === "none" && (merged.fontSize === 0 || merged["font-size"] === 0)) continue;
        if (m.tagName === "rect") {
          const rx = merged.rx ? ` rx="${merged.rx}"` : "";
          const ry = merged.ry ? ` ry="${merged.ry}"` : "";
          const stroke = merged.stroke ? ` stroke="${resolveVar(merged.stroke, isDark)}"` : "";
          const fill = resolveVar(merged.fill, isDark) ?? "none";
          const sw = merged.strokeWidth ?? merged["stroke-width"];
          const swStr = sw ? ` stroke-width="${sw}"` : "";
          res += `    <rect x="${merged.x ?? 0}" y="${merged.y ?? 0}" width="${merged.width ?? w}" height="${merged.height ?? h}" fill="${fill}"${stroke}${swStr}${rx}${ry} />\n`;
        } else if (m.tagName === "circle") {
          const stroke = merged.stroke ? ` stroke="${resolveVar(merged.stroke, isDark)}"` : "";
          const fill = resolveVar(merged.fill, isDark) ?? "none";
          const sw = merged.strokeWidth ?? merged["stroke-width"];
          const swStr = sw ? ` stroke-width="${sw}"` : "";
          res += `    <circle cx="${merged.cx ?? w / 2}" cy="${merged.cy ?? h / 2}" r="${merged.r ?? 10}" fill="${fill}"${stroke}${swStr} />\n`;
        } else if (m.tagName === "ellipse") {
          const stroke = merged.stroke ? ` stroke="${resolveVar(merged.stroke, isDark)}"` : "";
          const fill = resolveVar(merged.fill, isDark) ?? "none";
          const sw = merged.strokeWidth ?? merged["stroke-width"] ?? 1.5;
          const swStr = sw ? ` stroke-width="${sw}"` : "";
          res += `    <ellipse cx="${merged.cx ?? w / 2}" cy="${merged.cy ?? h / 2}" rx="${merged.rx ?? 10}" ry="${merged.ry ?? 10}" fill="${fill}"${stroke}${swStr} />\n`;
        } else if (m.tagName === "line") {
          const stroke = merged.stroke ? ` stroke="${resolveVar(merged.stroke, isDark)}"` : ' stroke="#0284c7"';
          const sw = merged.strokeWidth ?? merged["stroke-width"] ?? 1.5;
          const sda = merged.strokeDasharray ?? merged["stroke-dasharray"];
          const sdaStr = sda ? ` stroke-dasharray="${sda}"` : "";
          res += `    <line x1="${merged.x1}" y1="${merged.y1}" x2="${merged.x2}" y2="${merged.y2}"${stroke} stroke-width="${sw}"${sdaStr} />\n`;
        } else if (m.tagName === "path") {
          const stroke = merged.stroke ? ` stroke="${resolveVar(merged.stroke, isDark)}"` : ' stroke="#0284c7"';
          const fill = resolveVar(merged.fill, isDark) ?? "none";
          const sw = merged.strokeWidth ?? merged["stroke-width"] ?? 1.5;
          const transform = merged.transform ? ` transform="${merged.transform}"` : "";
          res += `    <path d="${merged.d}" fill="${fill}"${stroke} stroke-width="${sw}"${transform} />\n`;
        } else if (m.tagName === "polygon" || m.tagName === "polyline") {
          const stroke = merged.stroke ? ` stroke="${resolveVar(merged.stroke, isDark)}"` : "";
          const fill = resolveVar(merged.fill, isDark) ?? "none";
          const sw = merged.strokeWidth ?? merged["stroke-width"];
          const swStr = sw ? ` stroke-width="${sw}"` : "";
          res += `    <${m.tagName} points="${merged.points}" fill="${fill}"${stroke}${swStr} />\n`;
        } else if (m.tagName === "text") {
          const textVal = escapeHtml(String(merged.text ?? ""));
          if (!textVal) continue;
          const refXNum = merged.refX !== undefined ? Number(merged.refX) : undefined;
          const refYNum = merged.refY !== undefined ? Number(merged.refY) : undefined;
          const tx =
            refXNum !== undefined && !isNaN(refXNum) ? (refXNum <= 1 ? refXNum * w : refXNum) : (merged.x ?? w / 2);
          const ty =
            refYNum !== undefined && !isNaN(refYNum) ? (refYNum <= 1 ? refYNum * h : refYNum) : (merged.y ?? h + 10);
          const fill = resolveVar(merged.fill, isDark) ?? (isDark ? "#f8fafc" : "#0f172a");
          const fs = merged.fontSize ?? merged["font-size"] ?? 9;
          const fw = merged.fontWeight ?? merged["font-weight"] ?? "bold";
          const ta = merged.textAnchor ?? merged["text-anchor"] ?? "middle";
          const dbl =
            merged.textVerticalAnchor === "middle" || merged["text-vertical-anchor"] === "middle"
              ? ' dominant-baseline="middle"'
              : "";
          const transform = merged.transform ? ` transform="${merged.transform}"` : "";
          res += `    <text x="${tx}" y="${ty}" fill="${fill}" font-size="${fs}" font-weight="${fw}" font-family="sans-serif" text-anchor="${ta}"${dbl}${transform}>${textVal}</text>\n`;
        }
      }
      res += `  </g>\n`;
      return res;
    } else {
      const rawName = String(c.data?.["name"] || c.id);
      const name = rawName.includes(":") ? rawName.split(":").pop()! : rawName;
      const defn = String(c.data?.["definition"] || "Component");
      const rotStr = c.angle ? ` rotate(${c.angle}, ${w / 2}, ${h / 2})` : "";
      let res = `  <g transform="translate(${c.x}, ${c.y})${rotStr}">\n`;
      res += `    <rect width="${w}" height="${h}" rx="4" fill="${isDark ? "#1e293b" : "#f1f5f9"}" stroke="#38bdf8" stroke-width="1.5" />\n`;
      res += `    <text x="${w / 2}" y="${h / 2 - 4}" fill="${isDark ? "#f8fafc" : "#0f172a"}" font-size="10" font-weight="bold" font-family="sans-serif" text-anchor="middle">${escapeHtml(name)}</text>\n`;
      res += `    <text x="${w / 2}" y="${h / 2 + 10}" fill="#64748b" font-size="8" font-family="sans-serif" text-anchor="middle">${escapeHtml(defn)}</text>\n`;
      res += `  </g>\n`;
      return res;
    }
  };

  // 1. Render background cells (zIndex < 0, e.g. Category Cards) first
  const bgCells = diag.cells.filter((c) => c.shape !== "edge" && (c.zIndex ?? 0) < 0);
  for (const c of bgCells) {
    elementsSvg += renderCellSvg(c);
  }

  // 2. Render edges (wires and dividers) so they sit ON TOP of card backgrounds
  for (const c of diag.cells) {
    if (c.shape === "edge" && c.source && c.target) {
      const srcPt = (c.data?.["sourcePoint"] as { x?: number; y?: number } | undefined) ?? c.source;
      const tgtPt = (c.data?.["targetPoint"] as { x?: number; y?: number } | undefined) ?? c.target;
      if (srcPt?.x === undefined || tgtPt?.x === undefined) continue;
      let pathData = `M ${srcPt.x} ${srcPt.y}`;
      if (c.vertices) {
        for (const v of c.vertices) {
          pathData += ` L ${v.x} ${v.y}`;
        }
      }
      pathData += ` L ${tgtPt.x} ${tgtPt.y}`;
      const lineAttrs = c.attrs?.["line"] as
        | { stroke?: string; strokeWidth?: number; strokeDasharray?: string }
        | undefined;
      const stroke = resolveVar(lineAttrs?.stroke, isDark) ?? "#0284c7";
      const sw = lineAttrs?.strokeWidth ?? 2;
      const sda = lineAttrs?.strokeDasharray ? ` stroke-dasharray="${lineAttrs.strokeDasharray}"` : "";
      elementsSvg += `  <path d="${pathData}" fill="none" stroke="${stroke}" stroke-width="${sw}"${sda} stroke-linecap="round" />\n`;
    }
  }

  // 3. Render foreground nodes sorted by zIndex
  const fgCells = [...diag.cells.filter((c) => c.shape !== "edge" && (c.zIndex ?? 0) >= 0)].sort(
    (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0),
  );
  for (const c of fgCells) {
    elementsSvg += renderCellSvg(c);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}" style="background-color: ${bgColor};">
  <defs>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="1" fill="${gridDotColor}" />
    </pattern>
  </defs>
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="url(#grid)" />
${elementsSvg}
</svg>`;
}

/**
 * Computes a semantic and visual diff between two PSCAD projects.
 */
export function diffPscadProjects(
  oldProj: PscadProjectLike,
  newProj: PscadProjectLike,
): {
  addedComponents: PscadComponentLike[];
  removedComponents: PscadComponentLike[];
  modifiedComponents: {
    id: string;
    name: string;
    changedParams: { param: string; oldValue: string | number | undefined; newValue: string | number | undefined }[];
  }[];
  diffSummary: string;
} {
  const oldCompMap = new Map<string, PscadComponentLike>(oldProj.rootModule.components.map((c) => [c.id, c]));
  const newCompMap = new Map<string, PscadComponentLike>(newProj.rootModule.components.map((c) => [c.id, c]));

  const addedComponents: PscadComponentLike[] = [];
  const removedComponents: PscadComponentLike[] = [];
  const modifiedComponents: {
    id: string;
    name: string;
    changedParams: { param: string; oldValue: string | number | undefined; newValue: string | number | undefined }[];
  }[] = [];

  for (const [id, newC] of newCompMap) {
    if (!oldCompMap.has(id)) {
      addedComponents.push(newC);
    } else {
      const oldC = oldCompMap.get(id)!;
      const changedParams: {
        param: string;
        oldValue: string | number | undefined;
        newValue: string | number | undefined;
      }[] = [];

      for (const [key, newVal] of Object.entries(newC.parameters)) {
        const oldVal = oldC.parameters[key];
        if (oldVal !== newVal) {
          changedParams.push({ param: key, oldValue: oldVal, newValue: newVal });
        }
      }
      for (const [key, oldVal] of Object.entries(oldC.parameters)) {
        if (!(key in newC.parameters)) {
          changedParams.push({ param: key, oldValue: oldVal, newValue: undefined });
        }
      }

      if (changedParams.length > 0) {
        modifiedComponents.push({
          id,
          name: newC.instanceName || id,
          changedParams,
        });
      }
    }
  }

  for (const [id, oldC] of oldCompMap) {
    if (!newCompMap.has(id)) {
      removedComponents.push(oldC);
    }
  }

  const diffSummary =
    `PSCAD Semantic Diff:\n` +
    `  Added: ${addedComponents.length} components (${addedComponents.map((c) => c.instanceName || c.id).join(", ") || "none"})\n` +
    `  Removed: ${removedComponents.length} components (${removedComponents.map((c) => c.instanceName || c.id).join(", ") || "none"})\n` +
    `  Modified: ${modifiedComponents.length} components (${modifiedComponents.map((c) => `${c.name} [${c.changedParams.map((p) => p.param).join(", ")}]`).join(", ") || "none"})`;

  return {
    addedComponents,
    removedComponents,
    modifiedComponents,
    diffSummary,
  };
}
