// SPDX-License-Identifier: AGPL-3.0-or-later

export interface IconPrimitiveSpec {
  "@type": "Rectangle" | "Ellipse" | "Line" | "Polygon" | "Text" | string;
  extent?: [[number, number], [number, number]] | undefined;
  points?: Array<[number, number]> | undefined;
  origin?: [number, number] | undefined;
  rotation?: number | undefined;
  lineColor?: [number, number, number] | undefined;
  fillColor?: [number, number, number] | undefined;
  color?: [number, number, number] | undefined;
  fillPattern?: string | undefined;
  pattern?: string | undefined;
  borderPattern?: string | undefined;
  lineThickness?: number | undefined;
  thickness?: number | undefined;
  radius?: number | undefined;
  startAngle?: number | undefined;
  endAngle?: number | undefined;
  smooth?: string | undefined;
  textString?: string | undefined;
  fontSize?: number | undefined;
  fontName?: string | undefined;
  textColor?: [number, number, number] | undefined;
  horizontalAlignment?: string | undefined;
  visible?: boolean | undefined;
}

/**
 * Finds the matching closing delimiter (`)`, `}`, `]`, `"`) starting at `openIdx`.
 */
function findMatchingDelimiter(text: string, openIdx: number, openChar: string, closeChar: string): number {
  let depth = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1] ?? "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Splits a comma-separated list at top-level (ignoring commas inside (), {}, [], "").
 */
export function splitTopLevelCommaList(inner: string): string[] {
  const items: string[] = [];
  let start = 0;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let inString = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "(") {
      paren++;
    } else if (ch === ")") {
      paren = Math.max(0, paren - 1);
    } else if (ch === "{") {
      brace++;
    } else if (ch === "}") {
      brace = Math.max(0, brace - 1);
    } else if (ch === "[") {
      bracket++;
    } else if (ch === "]") {
      bracket = Math.max(0, bracket - 1);
    } else if (ch === "," && paren === 0 && brace === 0 && bracket === 0) {
      const part = inner.slice(start, i).trim();
      if (part) items.push(part);
      start = i + 1;
    }
  }
  const tail = inner.slice(start).trim();
  if (tail) items.push(tail);
  return items;
}

function fmtNum(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function fmtRgb(rgb: [number, number, number]): string {
  return `{${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])}}`;
}

function fmtExtent(ext: [[number, number], [number, number]]): string {
  return `{{${fmtNum(ext[0][0])},${fmtNum(ext[0][1])}},{${fmtNum(ext[1][0])},${fmtNum(ext[1][1])}}}`;
}

function fmtPoints(pts: Array<[number, number]>): string {
  return `{${pts.map(([x, y]) => `{${fmtNum(x)},${fmtNum(y)}}`).join(",")}}`;
}

function escapeMoString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function serializeIconPrimitive(spec: IconPrimitiveSpec): string {
  const type = spec["@type"] || "Rectangle";
  const args: string[] = [];
  if (spec.visible === false) args.push("visible=false");
  if (spec.origin) args.push(`origin={${fmtNum(spec.origin[0])},${fmtNum(spec.origin[1])}}`);
  if (typeof spec.rotation === "number" && spec.rotation !== 0) args.push(`rotation=${fmtNum(spec.rotation)}`);
  if (spec.extent) args.push(`extent=${fmtExtent(spec.extent)}`);
  if (spec.points && spec.points.length > 0) args.push(`points=${fmtPoints(spec.points)}`);
  if (spec.lineColor) args.push(`lineColor=${fmtRgb(spec.lineColor)}`);
  if (spec.color) args.push(`color=${fmtRgb(spec.color)}`);
  if (spec.fillColor) args.push(`fillColor=${fmtRgb(spec.fillColor)}`);
  if (spec.fillPattern) {
    const val = spec.fillPattern.startsWith("FillPattern.") ? spec.fillPattern : `FillPattern.${spec.fillPattern}`;
    args.push(`fillPattern=${val}`);
  }
  if (spec.pattern) {
    const val = spec.pattern.startsWith("LinePattern.") ? spec.pattern : `LinePattern.${spec.pattern}`;
    args.push(`pattern=${val}`);
  }
  if (spec.borderPattern) {
    const val = spec.borderPattern.startsWith("BorderPattern.")
      ? spec.borderPattern
      : `BorderPattern.${spec.borderPattern}`;
    args.push(`borderPattern=${val}`);
  }
  if (typeof spec.lineThickness === "number" && spec.lineThickness !== 0.25) {
    args.push(`lineThickness=${fmtNum(spec.lineThickness)}`);
  }
  if (typeof spec.thickness === "number" && spec.thickness !== 0.25) {
    args.push(`thickness=${fmtNum(spec.thickness)}`);
  }
  if (typeof spec.radius === "number" && spec.radius > 0) args.push(`radius=${fmtNum(spec.radius)}`);
  if (typeof spec.startAngle === "number" && spec.startAngle !== 0) args.push(`startAngle=${fmtNum(spec.startAngle)}`);
  if (typeof spec.endAngle === "number" && spec.endAngle !== 360) args.push(`endAngle=${fmtNum(spec.endAngle)}`);
  if (spec.smooth) {
    const val = spec.smooth.startsWith("Smooth.") ? spec.smooth : `Smooth.${spec.smooth}`;
    args.push(`smooth=${val}`);
  }
  if (spec.textString !== undefined) args.push(`textString="${escapeMoString(spec.textString)}"`);
  if (typeof spec.fontSize === "number" && spec.fontSize > 0) args.push(`fontSize=${fmtNum(spec.fontSize)}`);
  if (spec.fontName) args.push(`fontName="${escapeMoString(spec.fontName)}"`);
  if (spec.textColor) args.push(`textColor=${fmtRgb(spec.textColor)}`);
  if (spec.horizontalAlignment) {
    const val = spec.horizontalAlignment.startsWith("TextAlignment.")
      ? spec.horizontalAlignment
      : `TextAlignment.${spec.horizontalAlignment}`;
    args.push(`horizontalAlignment=${val}`);
  }
  return `${type}(${args.join(", ")})`;
}

/**
 * Parses top-level arguments of a Modelica graphic primitive like `Rectangle(extent={{-80,-50},{80,50}}, ...)`.
 */
export function parseIconPrimitive(raw: string): IconPrimitiveSpec | null {
  const trimmed = raw.trim();
  const parenIdx = trimmed.indexOf("(");
  if (parenIdx <= 0 || !trimmed.endsWith(")")) return null;
  const typeName = trimmed.slice(0, parenIdx).trim();
  const inner = trimmed.slice(parenIdx + 1, -1).trim();
  const spec: IconPrimitiveSpec = { "@type": typeName };

  for (const arg of splitTopLevelCommaList(inner)) {
    const eqIdx = arg.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = arg.slice(0, eqIdx).trim();
    const val = arg.slice(eqIdx + 1).trim();

    if (key === "extent") {
      const m = val.match(/\{\s*\{\s*([^,]+)\s*,\s*([^}]+)\s*\}\s*,\s*\{\s*([^,]+)\s*,\s*([^}]+)\s*\}\s*\}/);
      if (m) {
        spec.extent = [
          [Number(m[1]), Number(m[2])],
          [Number(m[3]), Number(m[4])],
        ];
      }
    } else if (key === "points" && val.startsWith("{") && val.endsWith("}")) {
      const pts: Array<[number, number]> = [];
      for (const p of splitTopLevelCommaList(val.slice(1, -1))) {
        const pm = p.match(/\{\s*([^,]+)\s*,\s*([^}]+)\s*\}/);
        if (pm) pts.push([Number(pm[1]), Number(pm[2])]);
      }
      spec.points = pts;
    } else if (key === "origin") {
      const om = val.match(/\{\s*([^,]+)\s*,\s*([^}]+)\s*\}/);
      if (om) spec.origin = [Number(om[1]), Number(om[2])];
    } else if (key === "lineColor" || key === "fillColor" || key === "color" || key === "textColor") {
      const cm = val.match(/\{\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^}]+)\s*\}/);
      if (cm) spec[key] = [Number(cm[1]), Number(cm[2]), Number(cm[3])];
    } else if (
      key === "rotation" ||
      key === "lineThickness" ||
      key === "thickness" ||
      key === "radius" ||
      key === "startAngle" ||
      key === "endAngle" ||
      key === "fontSize"
    ) {
      const num = Number(val);
      if (Number.isFinite(num)) spec[key] = num;
    } else if (key === "visible") {
      spec.visible = val !== "false";
    } else if (key === "textString" || key === "fontName") {
      if (val.startsWith('"') && val.endsWith('"')) {
        spec[key] = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    } else if (
      key === "fillPattern" ||
      key === "pattern" ||
      key === "borderPattern" ||
      key === "smooth" ||
      key === "horizontalAlignment"
    ) {
      spec[key] = val;
    }
  }
  return spec;
}

interface IconGraphicsSpan {
  /** Start/end of the `{ ... }` after `graphics=` if found */
  graphicsBraceStart: number;
  graphicsBraceEnd: number;
  /** Start/end of `Icon(...)` if found */
  iconOpenParen: number;
  iconCloseParen: number;
  /** Start/end of `annotation(...)` containing Icon if found */
  annStart: number;
  annEnd: number;
  items: string[];
}

function findIconGraphicsSpan(text: string, className: string): IconGraphicsSpan | null {
  // Locate the class body (`end <className>;`) to bound our search
  const endRe = new RegExp(`\\bend\\s+${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*;`, "m");
  const endMatch = endRe.exec(text);
  const classEndIdx = endMatch ? endMatch.index : text.length;

  // Search backwards from classEndIdx for `Icon(` inside an `annotation(`
  const head = text.slice(0, classEndIdx);
  const iconRe = /\bIcon\s*\(/g;
  let lastIconMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = iconRe.exec(head)) !== null) {
    lastIconMatch = m;
  }
  if (!lastIconMatch) return null;

  const iconOpenParen = lastIconMatch.index + lastIconMatch[0].length - 1;
  const iconCloseParen = findMatchingDelimiter(text, iconOpenParen, "(", ")");
  if (iconCloseParen < 0) return null;

  const iconInner = text.slice(iconOpenParen + 1, iconCloseParen);
  const gfxMatch = /\bgraphics\s*=\s*\{/.exec(iconInner);
  if (!gfxMatch) {
    return {
      graphicsBraceStart: -1,
      graphicsBraceEnd: -1,
      iconOpenParen,
      iconCloseParen,
      annStart: lastIconMatch.index,
      annEnd: iconCloseParen + 1,
      items: [],
    };
  }

  const graphicsBraceStart = iconOpenParen + 1 + gfxMatch.index + gfxMatch[0].length - 1;
  const graphicsBraceEnd = findMatchingDelimiter(text, graphicsBraceStart, "{", "}");
  if (graphicsBraceEnd < 0) return null;

  const items = splitTopLevelCommaList(text.slice(graphicsBraceStart + 1, graphicsBraceEnd));
  return {
    graphicsBraceStart,
    graphicsBraceEnd,
    iconOpenParen,
    iconCloseParen,
    annStart: lastIconMatch.index,
    annEnd: iconCloseParen + 1,
    items,
  };
}

function replaceGraphicsItems(text: string, className: string, items: string[]): string {
  const span = findIconGraphicsSpan(text, className);
  const serializedList = items.join(",\n        ");
  if (span && span.graphicsBraceStart >= 0 && span.graphicsBraceEnd >= 0) {
    const replacement = items.length > 0 ? `{\n        ${serializedList}\n      }` : `{}`;
    return text.slice(0, span.graphicsBraceStart) + replacement + text.slice(span.graphicsBraceEnd + 1);
  }
  if (span && span.iconOpenParen >= 0 && span.iconCloseParen >= 0) {
    const existingInner = text.slice(span.iconOpenParen + 1, span.iconCloseParen).trim();
    const gfxClause = items.length > 0 ? `graphics={\n        ${serializedList}\n      }` : `graphics={}`;
    const nextInner = existingInner ? `${existingInner}, ${gfxClause}` : gfxClause;
    return text.slice(0, span.iconOpenParen + 1) + nextInner + text.slice(span.iconCloseParen);
  }

  // No Icon(...) annotation exists yet — insert before `end <className>;`
  const endRe = new RegExp(`([ \\t]*)\\bend\\s+${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*;`, "m");
  const endMatch = endRe.exec(text);
  const gfxBlock =
    items.length > 0
      ? `  annotation(\n    Icon(\n      coordinateSystem(extent={{-100,-100},{100,100}}),\n      graphics={\n        ${serializedList}\n      }\n    )\n  );\n`
      : `  annotation(\n    Icon(\n      coordinateSystem(extent={{-100,-100},{100,100}}),\n      graphics={}\n    )\n  );\n`;

  if (endMatch) {
    return text.slice(0, endMatch.index) + gfxBlock + text.slice(endMatch.index);
  }
  return text + "\n" + gfxBlock;
}

export type IconEditAction =
  | { type: "addIconPrimitive"; primitive: IconPrimitiveSpec }
  | { type: "updateIconPrimitive"; index: number; patch: Partial<IconPrimitiveSpec> }
  | { type: "deleteIconPrimitive"; index: number }
  | { type: "reorderIconPrimitive"; fromIndex: number; toIndex: number };

export function applyIconEditActions(sourceText: string, className: string, actions: IconEditAction[]): string {
  let text = sourceText;
  for (const act of actions) {
    const span = findIconGraphicsSpan(text, className);
    const items = span ? [...span.items] : [];

    if (act.type === "addIconPrimitive") {
      items.push(serializeIconPrimitive(act.primitive));
      text = replaceGraphicsItems(text, className, items);
    } else if (act.type === "updateIconPrimitive") {
      if (act.index >= 0 && act.index < items.length) {
        const parsed = parseIconPrimitive(items[act.index]!);
        if (parsed) {
          const merged: IconPrimitiveSpec = { ...parsed, ...act.patch };
          items[act.index] = serializeIconPrimitive(merged);
          text = replaceGraphicsItems(text, className, items);
        }
      }
    } else if (act.type === "deleteIconPrimitive") {
      if (act.index >= 0 && act.index < items.length) {
        items.splice(act.index, 1);
        text = replaceGraphicsItems(text, className, items);
      }
    } else if (act.type === "reorderIconPrimitive") {
      const { fromIndex, toIndex } = act;
      if (
        fromIndex >= 0 &&
        fromIndex < items.length &&
        toIndex >= 0 &&
        toIndex < items.length &&
        fromIndex !== toIndex
      ) {
        const [moved] = items.splice(fromIndex, 1);
        items.splice(toIndex, 0, moved!);
        text = replaceGraphicsItems(text, className, items);
      }
    }
  }
  return text;
}
