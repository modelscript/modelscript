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

function maskModelicaCommentsAndStringsLocal(src: string): string {
  const chars = src.split("");
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const next = chars[i + 1] ?? "";
    if (inLineComment) {
      if (ch !== "\n" && ch !== "\r") chars[i] = " ";
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        chars[i] = " ";
        chars[i + 1] = " ";
        inBlockComment = false;
        i++;
      } else if (ch !== "\n" && ch !== "\r") {
        chars[i] = " ";
      }
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        chars[i] = " ";
        if (i + 1 < chars.length && chars[i + 1] !== "\n" && chars[i + 1] !== "\r") {
          chars[i + 1] = " ";
          i++;
        }
      } else if (ch === '"') {
        chars[i] = " ";
        inString = false;
      } else if (ch !== "\n" && ch !== "\r") {
        chars[i] = " ";
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      chars[i] = " ";
      chars[i + 1] = " ";
      inLineComment = true;
      i++;
    } else if (ch === "/" && next === "*") {
      chars[i] = " ";
      chars[i + 1] = " ";
      inBlockComment = true;
      i++;
    } else if (ch === '"') {
      chars[i] = " ";
      inString = true;
    }
  }
  return chars.join("");
}

const rawParametricArgsMap = new WeakMap<IconPrimitiveSpec, Record<string, string>>();

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
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
  const rawExtras = rawParametricArgsMap.get(spec);
  const args: string[] = [];
  if (spec.visible === false) args.push("visible=false");
  if (spec.origin && spec.origin.every(Number.isFinite)) {
    args.push(`origin={${fmtNum(spec.origin[0])},${fmtNum(spec.origin[1])}}`);
  } else if (rawExtras?.["origin"]) {
    args.push(`origin=${rawExtras["origin"]}`);
  }
  if (typeof spec.rotation === "number" && Number.isFinite(spec.rotation) && spec.rotation !== 0) {
    args.push(`rotation=${fmtNum(spec.rotation)}`);
  } else if (rawExtras?.["rotation"]) {
    args.push(`rotation=${rawExtras["rotation"]}`);
  }
  if (
    spec.extent &&
    spec.extent.length >= 2 &&
    Number.isFinite(spec.extent[0][0]) &&
    Number.isFinite(spec.extent[0][1]) &&
    Number.isFinite(spec.extent[1][0]) &&
    Number.isFinite(spec.extent[1][1])
  ) {
    args.push(`extent=${fmtExtent(spec.extent)}`);
  } else if (rawExtras?.["extent"]) {
    args.push(`extent=${rawExtras["extent"]}`);
  }
  if (
    spec.points &&
    spec.points.length > 0 &&
    spec.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  ) {
    args.push(`points=${fmtPoints(spec.points)}`);
  } else if (rawExtras?.["points"]) {
    args.push(`points=${rawExtras["points"]}`);
  }
  if (spec.lineColor && spec.lineColor.every(Number.isFinite)) args.push(`lineColor=${fmtRgb(spec.lineColor)}`);
  else if (rawExtras?.["lineColor"]) args.push(`lineColor=${rawExtras["lineColor"]}`);
  if (spec.color && spec.color.every(Number.isFinite)) args.push(`color=${fmtRgb(spec.color)}`);
  else if (rawExtras?.["color"]) args.push(`color=${rawExtras["color"]}`);
  if (spec.fillColor && spec.fillColor.every(Number.isFinite)) args.push(`fillColor=${fmtRgb(spec.fillColor)}`);
  else if (rawExtras?.["fillColor"]) args.push(`fillColor=${rawExtras["fillColor"]}`);
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
  if (typeof spec.lineThickness === "number" && Number.isFinite(spec.lineThickness) && spec.lineThickness !== 0.25) {
    args.push(`lineThickness=${fmtNum(spec.lineThickness)}`);
  } else if (rawExtras?.["lineThickness"]) {
    args.push(`lineThickness=${rawExtras["lineThickness"]}`);
  }
  if (typeof spec.thickness === "number" && Number.isFinite(spec.thickness) && spec.thickness !== 0.25) {
    args.push(`thickness=${fmtNum(spec.thickness)}`);
  } else if (rawExtras?.["thickness"]) {
    args.push(`thickness=${rawExtras["thickness"]}`);
  }
  if (typeof spec.radius === "number" && Number.isFinite(spec.radius) && spec.radius > 0) {
    args.push(`radius=${fmtNum(spec.radius)}`);
  } else if (rawExtras?.["radius"]) {
    args.push(`radius=${rawExtras["radius"]}`);
  }
  if (typeof spec.startAngle === "number" && Number.isFinite(spec.startAngle) && spec.startAngle !== 0) {
    args.push(`startAngle=${fmtNum(spec.startAngle)}`);
  } else if (rawExtras?.["startAngle"]) {
    args.push(`startAngle=${rawExtras["startAngle"]}`);
  }
  if (typeof spec.endAngle === "number" && Number.isFinite(spec.endAngle) && spec.endAngle !== 360) {
    args.push(`endAngle=${fmtNum(spec.endAngle)}`);
  } else if (rawExtras?.["endAngle"]) {
    args.push(`endAngle=${rawExtras["endAngle"]}`);
  }
  if (spec.smooth) {
    const val = spec.smooth.startsWith("Smooth.") ? spec.smooth : `Smooth.${spec.smooth}`;
    args.push(`smooth=${val}`);
  }
  if (spec.textString !== undefined) args.push(`textString="${escapeMoString(spec.textString)}"`);
  if (typeof spec.fontSize === "number" && Number.isFinite(spec.fontSize) && spec.fontSize > 0) {
    args.push(`fontSize=${fmtNum(spec.fontSize)}`);
  } else if (rawExtras?.["fontSize"]) {
    args.push(`fontSize=${rawExtras["fontSize"]}`);
  }
  if (spec.fontName) args.push(`fontName="${escapeMoString(spec.fontName)}"`);
  if (spec.textColor && spec.textColor.every(Number.isFinite)) args.push(`textColor=${fmtRgb(spec.textColor)}`);
  else if (rawExtras?.["textColor"]) args.push(`textColor=${rawExtras["textColor"]}`);
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
  const rawExtras: Record<string, string> = {};

  for (const arg of splitTopLevelCommaList(inner)) {
    const eqIdx = arg.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = arg.slice(0, eqIdx).trim();
    const val = arg.slice(eqIdx + 1).trim();

    if (key === "extent") {
      const m = val.match(/\{\s*\{\s*([^,]+)\s*,\s*([^}]+)\s*\}\s*,\s*\{\s*([^,]+)\s*,\s*([^}]+)\s*\}\s*\}/);
      if (m) {
        const nums = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
        if (nums.every(Number.isFinite)) {
          spec.extent = [
            [nums[0]!, nums[1]!],
            [nums[2]!, nums[3]!],
          ];
        } else {
          rawExtras[key] = val;
        }
      } else {
        rawExtras[key] = val;
      }
    } else if (key === "points" && val.startsWith("{") && val.endsWith("}")) {
      const pts: Array<[number, number]> = [];
      let allFinite = true;
      for (const p of splitTopLevelCommaList(val.slice(1, -1))) {
        const pm = p.match(/\{\s*([^,]+)\s*,\s*([^}]+)\s*\}/);
        if (pm) {
          const x = Number(pm[1]);
          const y = Number(pm[2]);
          if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
          else allFinite = false;
        } else {
          allFinite = false;
        }
      }
      if (allFinite && pts.length > 0) spec.points = pts;
      else rawExtras[key] = val;
    } else if (key === "origin") {
      const om = val.match(/\{\s*([^,]+)\s*,\s*([^}]+)\s*\}/);
      if (om) {
        const x = Number(om[1]);
        const y = Number(om[2]);
        if (Number.isFinite(x) && Number.isFinite(y)) spec.origin = [x, y];
        else rawExtras[key] = val;
      } else {
        rawExtras[key] = val;
      }
    } else if (key === "lineColor" || key === "fillColor" || key === "color" || key === "textColor") {
      const cm = val.match(/\{\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^}]+)\s*\}/);
      if (cm) {
        const rgb = [Number(cm[1]), Number(cm[2]), Number(cm[3])];
        if (rgb.every(Number.isFinite)) spec[key] = [rgb[0]!, rgb[1]!, rgb[2]!];
        else rawExtras[key] = val;
      } else {
        rawExtras[key] = val;
      }
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
      else if (val.length > 0) rawExtras[key] = val;
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
  if (Object.keys(rawExtras).length > 0) {
    rawParametricArgsMap.set(spec, rawExtras);
  }
  return spec;
}

interface IconGraphicsSpan {
  /** Start/end of the `{ ... }` after `graphics=` if found */
  graphicsBraceStart: number;
  graphicsBraceEnd: number;
  /** Start/end of `graphics={...}` argument including assignment, if found */
  graphicsArgStart: number;
  /** Start/end of `Icon(...)` if found */
  iconOpenParen: number;
  iconCloseParen: number;
  /** Start/end of `annotation(...)` containing Icon if found */
  annStart: number;
  annEnd: number;
  items: string[];
}

function findClassBoundsInMasked(
  masked: string,
  className: string,
): { start: number; end: number; endMatchIdx: number } | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startRe = new RegExp(
    `\\b(?:model|block|connector|class|record|type|function|package|operator)\\s+${escaped}\\b`,
    "g",
  );
  const endRe = new RegExp(`\\bend\\s+${escaped}\\s*;`, "g");
  const endMatch = endRe.exec(masked);
  if (!endMatch) {
    const startMatch = startRe.exec(masked);
    if (!startMatch) return { start: 0, end: masked.length, endMatchIdx: -1 };
    return { start: startMatch.index, end: masked.length, endMatchIdx: -1 };
  }
  let classStart = 0;
  let sm: RegExpExecArray | null;
  while ((sm = startRe.exec(masked)) !== null) {
    if (sm.index < endMatch.index) classStart = sm.index;
    else break;
  }
  return { start: classStart, end: endMatch.index, endMatchIdx: endMatch.index };
}

function findIconGraphicsSpan(text: string, className: string): IconGraphicsSpan | null {
  const masked = maskModelicaCommentsAndStringsLocal(text);
  const bounds = findClassBoundsInMasked(masked, className);
  const classStartIdx = bounds ? bounds.start : 0;
  const classEndIdx = bounds ? bounds.end : text.length;

  // Search within masked target class bounds for `Icon(` (ignores strings/comments and other classes)
  const head = masked.slice(classStartIdx, classEndIdx);
  const iconRe = /\bIcon\s*\(/g;
  let lastIconOffset = -1;
  let lastIconOpenParen = -1;
  let m: RegExpExecArray | null;
  while ((m = iconRe.exec(head)) !== null) {
    lastIconOffset = classStartIdx + m.index;
    lastIconOpenParen = classStartIdx + m.index + m[0].length - 1;
  }
  if (lastIconOffset < 0 || lastIconOpenParen < 0) return null;

  const iconOpenParen = lastIconOpenParen;
  const iconCloseParen = findMatchingDelimiter(text, iconOpenParen, "(", ")");
  if (iconCloseParen < 0) return null;

  const maskedIconInner = masked.slice(iconOpenParen + 1, iconCloseParen);
  const gfxMatch = /\bgraphics\s*=\s*\{/.exec(maskedIconInner);
  if (!gfxMatch) {
    return {
      graphicsBraceStart: -1,
      graphicsBraceEnd: -1,
      graphicsArgStart: -1,
      iconOpenParen,
      iconCloseParen,
      annStart: lastIconOffset,
      annEnd: iconCloseParen + 1,
      items: [],
    };
  }

  const graphicsArgStart = iconOpenParen + 1 + gfxMatch.index;
  const graphicsBraceStart = graphicsArgStart + gfxMatch[0].length - 1;
  const graphicsBraceEnd = findMatchingDelimiter(text, graphicsBraceStart, "{", "}");
  if (graphicsBraceEnd < 0) return null;

  const items = splitTopLevelCommaList(text.slice(graphicsBraceStart + 1, graphicsBraceEnd));
  return {
    graphicsBraceStart,
    graphicsBraceEnd,
    graphicsArgStart,
    iconOpenParen,
    iconCloseParen,
    annStart: lastIconOffset,
    annEnd: iconCloseParen + 1,
    items,
  };
}

function removeGraphicsAssignmentInIcon(text: string, span: IconGraphicsSpan): string {
  const innerStart = span.iconOpenParen + 1;
  const innerEnd = span.iconCloseParen;
  const beforeArg = text.slice(innerStart, span.graphicsArgStart);
  const afterArg = text.slice(span.graphicsBraceEnd + 1, innerEnd);
  if (beforeArg.trimEnd().endsWith(",")) {
    const trimmedBefore = beforeArg.trimEnd().slice(0, -1).trimEnd();
    return text.slice(0, innerStart) + trimmedBefore + afterArg + text.slice(innerEnd);
  }
  if (afterArg.trimStart().startsWith(",")) {
    const trimmedAfter = afterArg.trimStart().slice(1).trimStart();
    return text.slice(0, innerStart) + beforeArg + trimmedAfter + text.slice(innerEnd);
  }
  return text.slice(0, innerStart) + text.slice(innerEnd);
}

function replaceGraphicsItems(text: string, className: string, items: string[]): string {
  const span = findIconGraphicsSpan(text, className);
  const serializedList = items.join(",\n        ");
  if (span && span.graphicsBraceStart >= 0 && span.graphicsBraceEnd >= 0) {
    if (items.length === 0) {
      // Modelica forbids empty `{}` constructors ([M1003]); remove `graphics=...` instead
      return removeGraphicsAssignmentInIcon(text, span);
    }
    const replacement = `{\n        ${serializedList}\n      }`;
    return text.slice(0, span.graphicsBraceStart) + replacement + text.slice(span.graphicsBraceEnd + 1);
  }
  if (span && span.iconOpenParen >= 0 && span.iconCloseParen >= 0) {
    if (items.length === 0) return text;
    const existingInner = text.slice(span.iconOpenParen + 1, span.iconCloseParen).trim();
    const gfxClause = `graphics={\n        ${serializedList}\n      }`;
    const nextInner = existingInner ? `${existingInner}, ${gfxClause}` : gfxClause;
    return text.slice(0, span.iconOpenParen + 1) + nextInner + text.slice(span.iconCloseParen);
  }

  if (items.length === 0) return text;

  // No Icon(...) annotation exists yet — insert before `end <className>;`
  const masked = maskModelicaCommentsAndStringsLocal(text);
  const bounds = findClassBoundsInMasked(masked, className);
  const gfxBlock = `  annotation(\n    Icon(\n      coordinateSystem(extent={{-100,-100},{100,100}}),\n      graphics={\n        ${serializedList}\n      }\n    )\n  );\n`;

  if (bounds && bounds.endMatchIdx >= 0) {
    // Back up to start of line containing `end <className>;`
    let lineStart = bounds.endMatchIdx;
    while (lineStart > 0 && (text[lineStart - 1] === " " || text[lineStart - 1] === "\t")) {
      lineStart--;
    }
    return text.slice(0, lineStart) + gfxBlock + text.slice(lineStart);
  }
  return text + "\n" + gfxBlock;
}

function transformPointsForNewExtent(
  oldPoints: Array<[number, number]>,
  newExtent: [[number, number], [number, number]],
): Array<[number, number]> {
  let oldMinX = Infinity;
  let oldMinY = Infinity;
  let oldMaxX = -Infinity;
  let oldMaxY = -Infinity;
  for (const [px, py] of oldPoints) {
    if (px < oldMinX) oldMinX = px;
    if (py < oldMinY) oldMinY = py;
    if (px > oldMaxX) oldMaxX = px;
    if (py > oldMaxY) oldMaxY = py;
  }
  const newMinX = Math.min(newExtent[0][0], newExtent[1][0]);
  const newMaxX = Math.max(newExtent[0][0], newExtent[1][0]);
  const newMinY = Math.min(newExtent[0][1], newExtent[1][1]);
  const newMaxY = Math.max(newExtent[0][1], newExtent[1][1]);
  const oldW = oldMaxX - oldMinX;
  const oldH = oldMaxY - oldMinY;
  const newW = newMaxX - newMinX;
  const newH = newMaxY - newMinY;

  return oldPoints.map(([px, py]) => {
    const nx = oldW > 1e-6 ? newMinX + ((px - oldMinX) / oldW) * newW : px + (newMinX - oldMinX);
    const ny = oldH > 1e-6 ? newMinY + ((py - oldMinY) / oldH) * newH : py + (newMinY - oldMinY);
    return [nx, ny];
  });
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
          const prevExtras = rawParametricArgsMap.get(parsed);
          const merged: IconPrimitiveSpec = { ...parsed, ...act.patch };
          // For Line/Polygon point primitives moved or resized via an extent patch,
          // translate/scale `points` cleanly and never emit illegal `extent=...`.
          if (
            (merged["@type"] === "Line" || merged["@type"] === "Polygon") &&
            parsed.points &&
            parsed.points.length > 0 &&
            act.patch.extent &&
            !act.patch.points
          ) {
            merged.points = transformPointsForNewExtent(parsed.points, act.patch.extent);
            delete merged.extent;
          }
          if (prevExtras) {
            rawParametricArgsMap.set(merged, prevExtras);
          }
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
