// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileGlyphMarkup, type CompiledPrimitive, type DiagramMarkupNode } from "@modelscript/canvas";
import * as THREE from "three";

/**
 * Universal 2D SVG & `DiagramMarkup` → 3D Extruded Geometry Synthesizer.
 *
 * Converts both raw engineering SVG strings (`GalleryComponentItem.schematicSvg`,
 * `iconSvg`, `data:image/svg+xml,...`) and compiled `@modelscript/canvas` `DiagramMarkupNode`
 * trees into stereo-safe, merged, vertex-colored 3D PBR geometries for the WebXR
 * Spatial Diagram Editor.
 *
 * Key properties:
 *  - 100% pure TypeScript / zero DOMParser dependency (runs identically in WebXR, browser, SSR & Node tests).
 *  - Dual-pass extrusion: closed filled shapes become beveled 3D reliefs; open/closed stroked paths
 *    (`<line>`, `<polyline>`, `<path fill="none" stroke="...">`) expand into raised 3D metallic ribs.
 *  - Monotonic Z-layer offset guarantees zero stereo depth Z-fighting across overlapping primitives.
 *  - Collapses arbitrary 20–50 primitive SVG icons down to 2–3 merged draw calls + ref-counted LRU GPU cache.
 */

export type ExtrudedWaferStyle = "tactile-tile" | "pure-relief";

export interface ExtrudeIconOptions {
  /** Longest physical edge span of the resulting 3D component in meters (default: 0.148m). */
  targetSpanMeters?: number | undefined;
  /** Physical wafer style: frosted chamfered ceramic tile backing vs pure floating relief. */
  waferStyle?: ExtrudedWaferStyle | undefined;
  /** Default color substituted for `currentColor` strokes/fills. */
  currentColor?: string | undefined;
  /** Theme accent tint for the chassis perimeter rim & fallback stroke. */
  accentColor?: string | undefined;
  /** Dark surface mode adjusts default contrast ink and wafer tint. */
  dark?: boolean | undefined;
  /** Relief extrusion depth for filled SVG paths in meters (default: 0.0038m). */
  fillDepthMeters?: number | undefined;
  /** Proud relief extrusion depth for stroked SVG paths in meters (default: 0.0054m). */
  strokeDepthMeters?: number | undefined;
  /** Wafer backing thickness in meters (default: 0.009m). */
  waferDepthMeters?: number | undefined;
  /** Curve tessellation quality (default: 10 segments per curve; tuned for 72–90 FPS stereo XR). */
  curveSegments?: number | undefined;
}

export interface ParsedRgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
  readonly isNone: boolean;
}

export interface ExtractedSvgText {
  readonly text: string;
  /** Normalized position in component local meters (origin at center, Y-up). */
  readonly x: number;
  readonly y: number;
  readonly fontSizeMeters: number;
  readonly color: string;
}

export interface SvgMatrix2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export interface ParsedSvgPrimitive {
  readonly tag: "rect" | "circle" | "ellipse" | "line" | "polyline" | "polygon" | "path" | "text";
  readonly attrs: Record<string, string>;
  readonly fill: ParsedRgbaColor;
  readonly stroke: ParsedRgbaColor;
  readonly strokeWidth: number;
  readonly opacity: number;
  readonly transform: SvgMatrix2D;
  readonly textContent?: string | undefined;
  readonly order: number;
}

export interface ParsedSvgDocument {
  readonly viewBoxX: number;
  readonly viewBoxY: number;
  readonly viewBoxWidth: number;
  readonly viewBoxHeight: number;
  readonly primitives: readonly ParsedSvgPrimitive[];
}

export interface ExtrudedIconBundle {
  readonly cacheKey: string;
  /** Merged vertex-colored geometry containing all opaque SVG fills and raised 3D stroke ribs. */
  readonly opaqueGeometry: THREE.BufferGeometry | null;
  /** Merged vertex-colored geometry containing translucent tinted SVG fills (e.g. `rgba(...)`). */
  readonly translucentGeometry: THREE.BufferGeometry | null;
  /** Chamfered rounded ceramic/glass backing wafer (null in `"pure-relief"` mode). */
  readonly waferGeometry: THREE.BufferGeometry | null;
  /** Thin perimeter accent bevel rim around the wafer (null in `"pure-relief"` mode). */
  readonly rimGeometry: THREE.BufferGeometry | null;
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly depthMeters: number;
  readonly extractedTexts: readonly ExtractedSvgText[];
  readonly primitiveCount: number;
  readonly filledShapeCount: number;
  readonly strokeRibbonCount: number;
  dispose(): void;
}

export type ExtrudeIconInput =
  | { kind: "svg"; svg: string; width?: number | undefined; height?: number | undefined }
  | {
      kind: "markup";
      markup: DiagramMarkupNode | DiagramMarkupNode[] | null | undefined;
      attrs?: Record<string, Record<string, unknown> | undefined> | undefined;
      width?: number | undefined;
      height?: number | undefined;
    };

const IDENTITY_MATRIX: SvgMatrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const NAMED_COLORS: Record<string, [number, number, number, number]> = {
  white: [1, 1, 1, 1],
  black: [0, 0, 0, 1],
  red: [0.937, 0.267, 0.267, 1],
  green: [0.133, 0.773, 0.369, 1],
  blue: [0.231, 0.51, 0.965, 1],
  cyan: [0.024, 0.714, 0.831, 1],
  yellow: [0.918, 0.702, 0.031, 1],
  orange: [0.976, 0.451, 0.086, 1],
  purple: [0.545, 0.361, 0.965, 1],
  magenta: [0.855, 0.275, 0.937, 1],
  gray: [0.392, 0.455, 0.545, 1],
  grey: [0.392, 0.455, 0.545, 1],
  silver: [0.796, 0.835, 0.882, 1],
  navy: [0.094, 0.196, 0.42, 1],
  teal: [0.051, 0.58, 0.533, 1],
  transparent: [0, 0, 0, 0],
};

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function parseFiniteNum(raw: string | number | undefined, fallback = 0): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : fallback;
  if (typeof raw !== "string") return fallback;
  const n = Number.parseFloat(raw.trim());
  return Number.isFinite(n) ? n : fallback;
}

function multiplyMatrix(m1: SvgMatrix2D, m2: SvgMatrix2D): SvgMatrix2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

function applyMatrix(m: SvgMatrix2D, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

function matrixApproxScale(m: SvgMatrix2D): number {
  const sx = Math.hypot(m.a, m.b);
  const sy = Math.hypot(m.c, m.d);
  const avg = (sx + sy) * 0.5;
  return Number.isFinite(avg) && avg > 1e-6 ? avg : 1;
}

/** Parses SVG `transform="..."` attribute (`translate`, `scale`, `rotate`, `matrix`). */
export function parseSvgTransform(raw: string | undefined): SvgMatrix2D {
  if (!raw || !raw.trim()) return IDENTITY_MATRIX;
  let result = IDENTITY_MATRIX;
  const fnRe = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = fnRe.exec(raw)) !== null) {
    const fn = match[1]?.toLowerCase();
    const nums = (match[2] ?? "")
      .trim()
      .split(/[\s,]+/)
      .map((s) => Number.parseFloat(s))
      .filter((n) => Number.isFinite(n));

    let next: SvgMatrix2D | null = null;
    if (fn === "translate" && nums.length >= 1) {
      next = { a: 1, b: 0, c: 0, d: 1, e: nums[0] ?? 0, f: nums[1] ?? 0 };
    } else if (fn === "scale" && nums.length >= 1) {
      const sx = nums[0] ?? 1;
      const sy = nums[1] ?? sx;
      next = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
    } else if (fn === "rotate" && nums.length >= 1) {
      const rad = ((nums[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      if (nums.length >= 3) {
        const cx = nums[1] ?? 0;
        const cy = nums[2] ?? 0;
        next = multiplyMatrix(
          multiplyMatrix({ a: 1, b: 0, c: 0, d: 1, e: cx, f: cy }, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }),
          { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy },
        );
      } else {
        next = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      }
    } else if (fn === "matrix" && nums.length >= 6) {
      next = {
        a: nums[0]!,
        b: nums[1]!,
        c: nums[2]!,
        d: nums[3]!,
        e: nums[4]!,
        f: nums[5]!,
      };
    }

    if (next) {
      result = multiplyMatrix(result, next);
    }
  }
  return result;
}

/** Parses CSS/SVG colors (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `currentColor`, named, `none`). */
export function parseSvgColor(raw: string | undefined | null, currentColor = "#1e293b"): ParsedRgbaColor {
  if (!raw) {
    return { r: 0, g: 0, b: 0, a: 0, isNone: true };
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === "none" || trimmed === "transparent" || trimmed.startsWith("url(")) {
    return { r: 0, g: 0, b: 0, a: 0, isNone: true };
  }
  if (trimmed === "currentcolor") {
    return parseSvgColor(currentColor, "#1e293b");
  }

  const named = NAMED_COLORS[trimmed];
  if (named) {
    return { r: named[0], g: named[1], b: named[2], a: named[3], isNone: named[3] <= 0 };
  }

  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = Number.parseInt(hex[0]! + hex[0]!, 16) / 255;
      const g = Number.parseInt(hex[1]! + hex[1]!, 16) / 255;
      const b = Number.parseInt(hex[2]! + hex[2]!, 16) / 255;
      const a = hex.length === 4 ? Number.parseInt(hex[3]! + hex[3]!, 16) / 255 : 1;
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && Number.isFinite(a)) {
        return { r, g, b, a, isNone: a <= 0 };
      }
    } else if (hex.length === 6 || hex.length === 8) {
      const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
      const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
      const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
      const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && Number.isFinite(a)) {
        return { r, g, b, a, isNone: a <= 0 };
      }
    }
  }

  const rgbMatch = /^rgba?\(\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/.exec(
    trimmed,
  );
  if (rgbMatch) {
    const r = clamp01(Number.parseFloat(rgbMatch[1]!) / 255);
    const g = clamp01(Number.parseFloat(rgbMatch[2]!) / 255);
    const b = clamp01(Number.parseFloat(rgbMatch[3]!) / 255);
    let a = 1;
    if (rgbMatch[4] !== undefined) {
      a = rgbMatch[4].endsWith("%")
        ? clamp01(Number.parseFloat(rgbMatch[4]) / 100)
        : clamp01(Number.parseFloat(rgbMatch[4]));
    }
    return { r, g, b, a, isNone: a <= 0 };
  }

  // Fallback to THREE.Color parser for hsl() or extended CSS colors
  try {
    const tmp = new THREE.Color(trimmed);
    return { r: tmp.r, g: tmp.g, b: tmp.b, a: 1, isNone: false };
  } catch {
    return { r: 0.12, g: 0.16, b: 0.24, a: 1, isNone: false };
  }
}

function rgbaToCssHex(c: ParsedRgbaColor): string {
  const r = Math.round(clamp01(c.r) * 255)
    .toString(16)
    .padStart(2, "0");
  const g = Math.round(clamp01(c.g) * 255)
    .toString(16)
    .padStart(2, "0");
  const b = Math.round(clamp01(c.b) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${r}${g}${b}`;
}

function parseInlineStyle(styleRaw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!styleRaw) return out;
  for (const part of styleRaw.split(";")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const val = part.slice(idx + 1).trim();
    if (key && val) out[key] = val;
  }
  return out;
}

function decodeSvgEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseXmlAttributes(attrChunk: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(attrChunk)) !== null) {
    const name = m[1]!;
    const value = decodeSvgEntities(m[2] ?? m[3] ?? "");
    attrs[name] = value;
  }
  return attrs;
}

interface InheritedSvgStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  transform: SvgMatrix2D;
}

const SUPPORTED_PRIMITIVE_TAGS = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text"]);

function extractSvgDataUri(href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed.toLowerCase().startsWith("data:image/svg+xml")) return null;
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx < 0) return null;
  const meta = trimmed.slice(0, commaIdx).toLowerCase();
  const payload = trimmed.slice(commaIdx + 1);
  try {
    if (meta.includes(";base64")) {
      if (typeof atob === "function") {
        return atob(payload);
      }
      if (typeof Buffer !== "undefined") {
        return Buffer.from(payload, "base64").toString("utf8");
      }
      return null;
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/**
 * Pure, DOM-free SVG string parser producing normalized primitives with resolved
 * inheritance, CSS colors, opacity, and accumulated 2D transforms.
 */
export function parseSvgPrimitives(
  svgString: string,
  currentColor = "#1e293b",
  fallbackWidth = 80,
  fallbackHeight = 56,
): ParsedSvgDocument {
  let viewBoxX = 0;
  let viewBoxY = 0;
  let viewBoxWidth = fallbackWidth;
  let viewBoxHeight = fallbackHeight;
  let hasExplicitViewBox = false;

  const primitives: ParsedSvgPrimitive[] = [];
  const stack: InheritedSvgStyle[] = [
    {
      fill: currentColor,
      stroke: "none",
      strokeWidth: 1.5,
      opacity: 1,
      fillOpacity: 1,
      strokeOpacity: 1,
      transform: IDENTITY_MATRIX,
    },
  ];

  // Strip XML declarations, comments, <defs>...</defs>, <style>...</style>, <title>...</title>
  const cleaned = svgString
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(defs|style|title|desc|clipPath|linearGradient|radialGradient)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

  const tokenRe = /<(\/?)([a-zA-Z][a-zA-Z0-9_:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  let activeTextPrimIndex = -1;
  let order = 0;

  while ((match = tokenRe.exec(cleaned)) !== null) {
    const textChunk = match[5];
    if (textChunk !== undefined) {
      if (activeTextPrimIndex >= 0) {
        const existing = primitives[activeTextPrimIndex];
        if (existing) {
          const decoded = decodeSvgEntities(textChunk).trim();
          if (decoded) {
            primitives[activeTextPrimIndex] = {
              ...existing,
              textContent: existing.textContent ? `${existing.textContent} ${decoded}` : decoded,
            };
          }
        }
      }
      continue;
    }

    const isClose = match[1] === "/";
    const rawTag = (match[2] ?? "").toLowerCase();
    const attrChunk = match[3] ?? "";
    const isSelfClose = match[4] === "/";

    if (isClose) {
      if (rawTag === "text") {
        activeTextPrimIndex = -1;
      }
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }

    const attrs = parseXmlAttributes(attrChunk);
    const inlineStyle = parseInlineStyle(attrs["style"]);
    const getAttr = (k: string): string | undefined => inlineStyle[k] ?? attrs[k];

    const parent = stack[stack.length - 1]!;
    const localTransform = parseSvgTransform(getAttr("transform"));
    const inherited: InheritedSvgStyle = {
      fill: getAttr("fill") ?? parent.fill,
      stroke: getAttr("stroke") ?? parent.stroke,
      strokeWidth:
        getAttr("stroke-width") !== undefined
          ? parseFiniteNum(getAttr("stroke-width"), parent.strokeWidth)
          : parent.strokeWidth,
      opacity: parent.opacity * clamp01(parseFiniteNum(getAttr("opacity"), 1)),
      fillOpacity: parent.fillOpacity * clamp01(parseFiniteNum(getAttr("fill-opacity"), 1)),
      strokeOpacity: parent.strokeOpacity * clamp01(parseFiniteNum(getAttr("stroke-opacity"), 1)),
      transform: multiplyMatrix(parent.transform, localTransform),
    };

    if (rawTag === "svg") {
      const vb = attrs["viewBox"] ?? attrs["viewbox"];
      if (vb) {
        const parts = vb
          .trim()
          .split(/[\s,]+/)
          .map((s) => Number.parseFloat(s));
        if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2]! > 0 && parts[3]! > 0) {
          viewBoxX = parts[0]!;
          viewBoxY = parts[1]!;
          viewBoxWidth = parts[2]!;
          viewBoxHeight = parts[3]!;
          hasExplicitViewBox = true;
        }
      }
      if (!hasExplicitViewBox) {
        const w = parseFiniteNum(attrs["width"], fallbackWidth);
        const h = parseFiniteNum(attrs["height"], fallbackHeight);
        if (w > 0) viewBoxWidth = w;
        if (h > 0) viewBoxHeight = h;
      }
      if (!isSelfClose) {
        stack.push(inherited);
      }
      continue;
    }

    if (rawTag === "image") {
      const embeddedSvg = extractSvgDataUri(attrs["href"] ?? attrs["xlink:href"]);
      if (embeddedSvg) {
        const ix = parseFiniteNum(attrs["x"], 0);
        const iy = parseFiniteNum(attrs["y"], 0);
        const iw = parseFiniteNum(attrs["width"], viewBoxWidth);
        const ih = parseFiniteNum(attrs["height"], viewBoxHeight);
        const subDoc = parseSvgPrimitives(embeddedSvg, currentColor, iw, ih);
        const sx = subDoc.viewBoxWidth > 0 ? iw / subDoc.viewBoxWidth : 1;
        const sy = subDoc.viewBoxHeight > 0 ? ih / subDoc.viewBoxHeight : 1;
        const mapMat = multiplyMatrix(inherited.transform, {
          a: sx,
          b: 0,
          c: 0,
          d: sy,
          e: ix - subDoc.viewBoxX * sx,
          f: iy - subDoc.viewBoxY * sy,
        });
        for (const sub of subDoc.primitives) {
          primitives.push({
            ...sub,
            transform: multiplyMatrix(mapMat, sub.transform),
            order: order++,
          });
        }
      }
      if (!isSelfClose) stack.push(inherited);
      continue;
    }

    if (SUPPORTED_PRIMITIVE_TAGS.has(rawTag)) {
      const parsedFill = parseSvgColor(inherited.fill, currentColor);
      const parsedStroke = parseSvgColor(inherited.stroke, currentColor);
      const effFill: ParsedRgbaColor = {
        ...parsedFill,
        a: parsedFill.a * inherited.fillOpacity * inherited.opacity,
        isNone: parsedFill.isNone || parsedFill.a * inherited.fillOpacity * inherited.opacity <= 0.005,
      };
      const effStroke: ParsedRgbaColor = {
        ...parsedStroke,
        a: parsedStroke.a * inherited.strokeOpacity * inherited.opacity,
        isNone: parsedStroke.isNone || parsedStroke.a * inherited.strokeOpacity * inherited.opacity <= 0.005,
      };

      const idx = primitives.length;
      primitives.push({
        tag: rawTag as ParsedSvgPrimitive["tag"],
        attrs,
        fill: effFill,
        stroke: effStroke,
        strokeWidth: Math.max(0.25, inherited.strokeWidth),
        opacity: inherited.opacity,
        transform: inherited.transform,
        order: order++,
      });

      if (rawTag === "text" && !isSelfClose) {
        activeTextPrimIndex = idx;
      }
    }

    if (!isSelfClose) {
      stack.push(inherited);
    }
  }

  return {
    viewBoxX,
    viewBoxY,
    viewBoxWidth: viewBoxWidth > 0 ? viewBoxWidth : fallbackWidth,
    viewBoxHeight: viewBoxHeight > 0 ? viewBoxHeight : fallbackHeight,
    primitives,
  };
}

/**
 * Compiles `@modelscript/canvas` `DiagramMarkupNode` trees (used by all 40+ ModelScript
 * polyglot diagram builders) directly into normalized `ParsedSvgDocument` primitives.
 */
export function markupToSvgPrimitives(
  markup: DiagramMarkupNode | DiagramMarkupNode[] | null | undefined,
  attrs?: Record<string, Record<string, unknown> | undefined> | undefined,
  width = 80,
  height = 56,
  currentColor = "#1e293b",
): ParsedSvgDocument {
  const compiled = compileGlyphMarkup(markup, attrs, width, height);
  const primitives: ParsedSvgPrimitive[] = [];
  let order = 0;

  const walk = (prim: CompiledPrimitive, parent: InheritedSvgStyle): void => {
    const rawTag = (prim.tagName || "g").toLowerCase();
    const attrStrings: Record<string, string> = {};
    for (const [k, v] of Object.entries(prim.attrs)) {
      if (v !== undefined && v !== null) {
        attrStrings[k] = String(v);
      }
    }
    const styleStrings: Record<string, string> = {};
    for (const [k, v] of Object.entries(prim.style)) {
      if (v !== undefined && v !== null) {
        styleStrings[k.toLowerCase()] = String(v);
      }
    }
    const getAttr = (k: string): string | undefined => styleStrings[k] ?? attrStrings[k];

    const localTransform = parseSvgTransform(getAttr("transform"));
    const inherited: InheritedSvgStyle = {
      fill: getAttr("fill") ?? parent.fill,
      stroke: getAttr("stroke") ?? parent.stroke,
      strokeWidth:
        getAttr("stroke-width") !== undefined
          ? parseFiniteNum(getAttr("stroke-width"), parent.strokeWidth)
          : parent.strokeWidth,
      opacity: parent.opacity * clamp01(parseFiniteNum(getAttr("opacity"), 1)),
      fillOpacity: parent.fillOpacity * clamp01(parseFiniteNum(getAttr("fill-opacity"), 1)),
      strokeOpacity: parent.strokeOpacity * clamp01(parseFiniteNum(getAttr("stroke-opacity"), 1)),
      transform: multiplyMatrix(parent.transform, localTransform),
    };

    if (rawTag === "image") {
      const embeddedSvg = extractSvgDataUri(attrStrings["href"] ?? attrStrings["xlink:href"]);
      if (embeddedSvg) {
        const ix = parseFiniteNum(attrStrings["x"], 0);
        const iy = parseFiniteNum(attrStrings["y"], 0);
        const iw = parseFiniteNum(attrStrings["width"], width);
        const ih = parseFiniteNum(attrStrings["height"], height);
        const subDoc = parseSvgPrimitives(embeddedSvg, currentColor, iw, ih);
        const sx = subDoc.viewBoxWidth > 0 ? iw / subDoc.viewBoxWidth : 1;
        const sy = subDoc.viewBoxHeight > 0 ? ih / subDoc.viewBoxHeight : 1;
        const mapMat = multiplyMatrix(inherited.transform, {
          a: sx,
          b: 0,
          c: 0,
          d: sy,
          e: ix - subDoc.viewBoxX * sx,
          f: iy - subDoc.viewBoxY * sy,
        });
        for (const sub of subDoc.primitives) {
          primitives.push({
            ...sub,
            transform: multiplyMatrix(mapMat, sub.transform),
            order: order++,
          });
        }
      }
    } else if (SUPPORTED_PRIMITIVE_TAGS.has(rawTag)) {
      // Skip explicit 2D port circle overlays when selector marks them as ports (we render tactile 3D sockets!)
      const isPortDot = Boolean(prim.selector && /^port_\d+$/.test(prim.selector));
      if (!isPortDot) {
        const parsedFill = parseSvgColor(inherited.fill, currentColor);
        const parsedStroke = parseSvgColor(inherited.stroke, currentColor);
        const effFill: ParsedRgbaColor = {
          ...parsedFill,
          a: parsedFill.a * inherited.fillOpacity * inherited.opacity,
          isNone: parsedFill.isNone || parsedFill.a * inherited.fillOpacity * inherited.opacity <= 0.005,
        };
        const effStroke: ParsedRgbaColor = {
          ...parsedStroke,
          a: parsedStroke.a * inherited.strokeOpacity * inherited.opacity,
          isNone: parsedStroke.isNone || parsedStroke.a * inherited.strokeOpacity * inherited.opacity <= 0.005,
        };
        primitives.push({
          tag: rawTag as ParsedSvgPrimitive["tag"],
          attrs: attrStrings,
          fill: effFill,
          stroke: effStroke,
          strokeWidth: Math.max(0.25, inherited.strokeWidth),
          opacity: inherited.opacity,
          transform: inherited.transform,
          textContent: prim.textContent,
          order: order++,
        });
      }
    }

    for (const child of prim.children) {
      walk(child, inherited);
    }
  };

  const rootStyle: InheritedSvgStyle = {
    fill: "none",
    stroke: "none",
    strokeWidth: 1.5,
    opacity: 1,
    fillOpacity: 1,
    strokeOpacity: 1,
    transform: IDENTITY_MATRIX,
  };
  for (const root of compiled.roots) {
    walk(root, rootStyle);
  }

  return {
    viewBoxX: 0,
    viewBoxY: 0,
    viewBoxWidth: width > 0 ? width : 80,
    viewBoxHeight: height > 0 ? height : 56,
    primitives,
  };
}

/* -------------------------------------------------------------------------- */
/*  SVG Path & Geometry Sampler (Full M/L/H/V/C/S/Q/T/A/Z Spec Support)       */
/* -------------------------------------------------------------------------- */

interface SampledSubPath {
  points: THREE.Vector2[];
  closed: boolean;
}

/** W3C SVG 1.1 F.6.5 endpoint-to-center elliptical arc sampler. */
function sampleEllipticalArc(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  angleDeg: number,
  largeArcFlag: number,
  sweepFlag: number,
  x2: number,
  y2: number,
  segments: number,
): THREE.Vector2[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < 1e-6 || ry < 1e-6 || (Math.abs(x1 - x2) < 1e-6 && Math.abs(y1 - y2) < 1e-6)) {
    return [new THREE.Vector2(x2, y2)];
  }

  const phi = (angleDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x1 - x2) * 0.5;
  const dy2 = (y1 - y2) * 0.5;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  const lambda = x1pSq / rxSq + y1pSq / rySq;
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = Math.max(0, rx2 * ry2 - rx2 * y1pSq - ry2 * x1pSq);
  const den = Math.max(1e-9, rx2 * y1pSq + ry2 * x1pSq);
  const sign = largeArcFlag === sweepFlag ? -1 : 1;
  const coef = sign * Math.sqrt(num / den);
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) * 0.5;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) * 0.5;

  const vecAngle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.max(1e-9, Math.hypot(ux, uy) * Math.hypot(vx, vy));
    const ang = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    return ux * vy - uy * vx < 0 ? -ang : ang;
  };

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;

  const theta1 = vecAngle(1, 0, ux, uy);
  let dTheta = vecAngle(ux, uy, vx, vy);
  if (!sweepFlag && dTheta > 0) dTheta -= Math.PI * 2;
  if (sweepFlag && dTheta < 0) dTheta += Math.PI * 2;

  const steps = Math.max(4, Math.ceil((Math.abs(dTheta) / (Math.PI * 0.5)) * Math.max(4, segments * 0.6)));
  const out: THREE.Vector2[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = theta1 + (dTheta * i) / steps;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    const px = cosPhi * rx * cosT - sinPhi * ry * sinT + cx;
    const py = sinPhi * rx * cosT + cosPhi * ry * sinT + cy;
    out.push(new THREE.Vector2(px, py));
  }
  return out;
}

function sampleSvgPathD(d: string, curveSegments: number): SampledSubPath[] {
  const tokens: string[] = [];
  const tokenRe = /([a-zA-Z])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(d)) !== null) {
    tokens.push(m[0]);
  }

  const subPaths: SampledSubPath[] = [];
  let current: SampledSubPath | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrlX = 0;
  let lastCtrlY = 0;
  let prevCmd = "";

  let i = 0;
  const isCmd = (tok: string | undefined): boolean => Boolean(tok && /^[a-zA-Z]$/.test(tok));
  const nextNum = (): number => {
    const val = Number.parseFloat(tokens[i++] ?? "0");
    return Number.isFinite(val) ? val : 0;
  };

  let cmd = "";
  while (i < tokens.length) {
    if (isCmd(tokens[i])) {
      cmd = tokens[i++]!;
    } else if (!cmd) {
      i++;
      continue;
    }

    const isRel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();

    if (upper === "M") {
      const nx = nextNum() + (isRel ? cx : 0);
      const ny = nextNum() + (isRel ? cy : 0);
      current = { points: [new THREE.Vector2(nx, ny)], closed: false };
      subPaths.push(current);
      cx = sx = nx;
      cy = sy = ny;
      lastCtrlX = cx;
      lastCtrlY = cy;
      prevCmd = cmd;
      // Subsequent coordinate pairs after M/m are implicit L/l
      cmd = isRel ? "l" : "L";
    } else if (upper === "L") {
      if (!current) {
        current = { points: [new THREE.Vector2(cx, cy)], closed: false };
        subPaths.push(current);
      }
      const nx = nextNum() + (isRel ? cx : 0);
      const ny = nextNum() + (isRel ? cy : 0);
      current.points.push(new THREE.Vector2(nx, ny));
      cx = nx;
      cy = ny;
      lastCtrlX = cx;
      lastCtrlY = cy;
      prevCmd = cmd;
    } else if (upper === "H") {
      if (!current) {
        current = { points: [new THREE.Vector2(cx, cy)], closed: false };
        subPaths.push(current);
      }
      const nx = nextNum() + (isRel ? cx : 0);
      current.points.push(new THREE.Vector2(nx, cy));
      cx = nx;
      lastCtrlX = cx;
      lastCtrlY = cy;
      prevCmd = cmd;
    } else if (upper === "V") {
      if (!current) {
        current = { points: [new THREE.Vector2(cx, cy)], closed: false };
        subPaths.push(current);
      }
      const ny = nextNum() + (isRel ? cy : 0);
      current.points.push(new THREE.Vector2(cx, ny));
      cy = ny;
      lastCtrlX = cx;
      lastCtrlY = cy;
      prevCmd = cmd;
    } else if (upper === "C") {
      if (!current) {
        current = { points: [new THREE.Vector2(cx, cy)], closed: false };
        subPaths.push(current);
      }
      const x1 = nextNum() + (isRel ? cx : 0);
      const y1 = nextNum() + (isRel ? cy : 0);
      const x2 = nextNum() + (isRel ? cx : 0);
      const y2 = nextNum() + (isRel ? cy : 0);
      const x = nextNum() + (isRel ? cx : 0);
      const y = nextNum() + (isRel ? cy : 0);
      const curve = new THREE.CubicBezierCurve(
        new THREE.Vector2(cx, cy),
        new THREE.Vector2(x1, y1),
        new THREE.Vector2(x2, y2),
        new THREE.Vector2(x, y),
      );
      const pts = curve.getPoints(curveSegments);
      for (let k = 1; k < pts.length; k++) current.points.push(pts[k]!);
      lastCtrlX = x2;
      lastCtrlY = y2;
      cx = x;
      cy = y;
      prevCmd = cmd;
    } else if (upper === "S") {
      if (!current) {
        current = { points: [new THREE.Vector2(cx, cy)], closed: false };
        subPaths.push(current);
      }
      const prevUp = prevCmd.toUpperCase();
      const x1 = prevUp === "C" || prevUp === "S" ? 2 * cx - lastCtrlX : cx;
      const y1 = prevUp === "C" || prevUp === "S" ? 2 * cy - lastCtrlY : cy;
      const x2 = nextNum() + (isRel ? cx : 0);
      const y2 = nextNum() + (isRel ? cy : 0);
      const x = nextNum() + (isRel ? cx : 0);
      const y = nextNum() + (isRel ? cy : 0);
      const curve = new THREE.CubicBezierCurve(
        new THREE.Vector2(cx, cy),
        new THREE.Vector2(x1, y1),
        new THREE.Vector2(x2, y2),
        new THREE.Vector2(x, y),
      );
      const pts = curve.getPoints(curveSegments);
      for (let k = 1; k < pts.length; k++) current.points.push(pts[k]!);
      lastCtrlX = x2;
      lastCtrlY = y2;
      cx = x;
      cy = y;
      prevCmd = cmd;
    } else if (upper === "Q") {
      if (!current) {
        current = { points: [new THREE.Vector2(cx, cy)], closed: false };
        subPaths.push(current);
      }
      const x1 = nextNum() + (isRel ? cx : 0);
      const y1 = nextNum() + (isRel ? cy : 0);
      const x = nextNum() + (isRel ? cx : 0);
      const y = nextNum() + (isRel ? cy : 0);
      const curve = new THREE.QuadraticBezierCurve(
        new THREE.Vector2(cx, cy),
        new THREE.Vector2(x1, y1),
        new THREE.Vector2(x, y),
      );
      const pts = curve.getPoints(curveSegments);
      for (let k = 1; k < pts.length; k++) current.points.push(pts[k]!);
      lastCtrlX = x1;
      lastCtrlY = y1;
      cx = x;
      cy = y;
      prevCmd = cmd;
    } else if (upper === "T") {
      if (!current) {
        current = { points: [new THREE.Vector2(cx, cy)], closed: false };
        subPaths.push(current);
      }
      const prevUp = prevCmd.toUpperCase();
      const x1 = prevUp === "Q" || prevUp === "T" ? 2 * cx - lastCtrlX : cx;
      const y1 = prevUp === "Q" || prevUp === "T" ? 2 * cy - lastCtrlY : cy;
      const x = nextNum() + (isRel ? cx : 0);
      const y = nextNum() + (isRel ? cy : 0);
      const curve = new THREE.QuadraticBezierCurve(
        new THREE.Vector2(cx, cy),
        new THREE.Vector2(x1, y1),
        new THREE.Vector2(x, y),
      );
      const pts = curve.getPoints(curveSegments);
      for (let k = 1; k < pts.length; k++) current.points.push(pts[k]!);
      lastCtrlX = x1;
      lastCtrlY = y1;
      cx = x;
      cy = y;
      prevCmd = cmd;
    } else if (upper === "A") {
      if (!current) {
        current = { points: [new THREE.Vector2(cx, cy)], closed: false };
        subPaths.push(current);
      }
      const rx = nextNum();
      const ry = nextNum();
      const rot = nextNum();
      const largeArc = nextNum() ? 1 : 0;
      const sweep = nextNum() ? 1 : 0;
      const x = nextNum() + (isRel ? cx : 0);
      const y = nextNum() + (isRel ? cy : 0);
      const pts = sampleEllipticalArc(cx, cy, rx, ry, rot, largeArc, sweep, x, y, curveSegments);
      for (const p of pts) current.points.push(p);
      cx = x;
      cy = y;
      lastCtrlX = cx;
      lastCtrlY = cy;
      prevCmd = cmd;
    } else if (upper === "Z") {
      if (current) {
        current.closed = true;
      }
      cx = sx;
      cy = sy;
      lastCtrlX = cx;
      lastCtrlY = cy;
      prevCmd = cmd;
      cmd = "";
    } else {
      cmd = "";
    }
  }

  return subPaths;
}

function samplePrimitiveToSubPaths(prim: ParsedSvgPrimitive, curveSegments: number): SampledSubPath[] {
  const a = prim.attrs;
  switch (prim.tag) {
    case "rect": {
      const x = parseFiniteNum(a["x"], 0);
      const y = parseFiniteNum(a["y"], 0);
      const w = parseFiniteNum(a["width"], 0);
      const h = parseFiniteNum(a["height"], 0);
      if (w <= 1e-6 || h <= 1e-6) return [];
      const rx = Math.min(w * 0.5, Math.max(0, parseFiniteNum(a["rx"], parseFiniteNum(a["ry"], 0))));
      const ry = Math.min(h * 0.5, Math.max(0, parseFiniteNum(a["ry"], rx)));
      if (rx <= 1e-4 && ry <= 1e-4) {
        return [
          {
            closed: true,
            points: [
              new THREE.Vector2(x, y),
              new THREE.Vector2(x + w, y),
              new THREE.Vector2(x + w, y + h),
              new THREE.Vector2(x, y + h),
            ],
          },
        ];
      }
      const shape = new THREE.Shape();
      shape.moveTo(x + rx, y);
      shape.lineTo(x + w - rx, y);
      shape.quadraticCurveTo(x + w, y, x + w, y + ry);
      shape.lineTo(x + w, y + h - ry);
      shape.quadraticCurveTo(x + w, y + h, x + w - rx, y + h);
      shape.lineTo(x + rx, y + h);
      shape.quadraticCurveTo(x, y + h, x, y + h - ry);
      shape.lineTo(x, y + ry);
      shape.quadraticCurveTo(x, y, x + rx, y);
      return [{ closed: true, points: shape.getPoints(Math.max(4, Math.round(curveSegments * 0.5))) }];
    }
    case "circle": {
      const cx = parseFiniteNum(a["cx"], 0);
      const cy = parseFiniteNum(a["cy"], 0);
      const r = parseFiniteNum(a["r"], 0);
      if (r <= 1e-6) return [];
      const segs = Math.max(16, curveSegments * 2);
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < segs; i++) {
        const t = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector2(cx + Math.cos(t) * r, cy + Math.sin(t) * r));
      }
      return [{ closed: true, points: pts }];
    }
    case "ellipse": {
      const cx = parseFiniteNum(a["cx"], 0);
      const cy = parseFiniteNum(a["cy"], 0);
      const rx = parseFiniteNum(a["rx"], 0);
      const ry = parseFiniteNum(a["ry"], 0);
      if (rx <= 1e-6 || ry <= 1e-6) return [];
      const segs = Math.max(16, curveSegments * 2);
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < segs; i++) {
        const t = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector2(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry));
      }
      return [{ closed: true, points: pts }];
    }
    case "line": {
      const x1 = parseFiniteNum(a["x1"], 0);
      const y1 = parseFiniteNum(a["y1"], 0);
      const x2 = parseFiniteNum(a["x2"], 0);
      const y2 = parseFiniteNum(a["y2"], 0);
      return [{ closed: false, points: [new THREE.Vector2(x1, y1), new THREE.Vector2(x2, y2)] }];
    }
    case "polyline":
    case "polygon": {
      const raw = (a["points"] ?? "").trim();
      if (!raw) return [];
      const nums = raw
        .split(/[\s,]+/)
        .map((s) => Number.parseFloat(s))
        .filter((n) => Number.isFinite(n));
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        pts.push(new THREE.Vector2(nums[i]!, nums[i + 1]!));
      }
      if (pts.length < 2) return [];
      return [{ closed: prim.tag === "polygon", points: pts }];
    }
    case "path": {
      const d = a["d"];
      if (!d) return [];
      return sampleSvgPathD(d, curveSegments);
    }
    default:
      return [];
  }
}

/* -------------------------------------------------------------------------- */
/*  3D Extrusion Helpers: Stroke-to-Solid Ribbon + Vertex-Color Merging       */
/* -------------------------------------------------------------------------- */

function dedupePolyline(pts: THREE.Vector2[], closed: boolean, eps = 1e-5): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const prev = out[out.length - 1];
    if (!prev || prev.distanceTo(p) > eps) {
      out.push(p);
    }
  }
  if (closed && out.length > 2 && out[0]!.distanceTo(out[out.length - 1]!) <= eps) {
    out.pop();
  }
  return out;
}

/**
 * Converts an open or closed 2D polyline into a solid, manifold, vertex-colored
 * extruded 3D stroke ribbon (`z ∈ [zBase, zBase + depth]`).
 *
 * Uses per-segment rectangular prisms + circular corner joint cylinders so acute
 * schematic zig-zags (resistors, inductors, ground symbols, arrowheads) never produce
 * self-intersecting earcut artifacts or spike miters.
 */
function buildExtrudedStrokeRibbonGeometry(
  rawPoints: THREE.Vector2[],
  closed: boolean,
  halfWidth: number,
  zBase: number,
  depth: number,
  color: ParsedRgbaColor,
): THREE.BufferGeometry | null {
  const pts = dedupePolyline(rawPoints, closed);
  if (pts.length < 2) return null;

  const hw = Math.max(0.00045, halfWidth);
  const segCount = closed ? pts.length : pts.length - 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  const pushTri = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    nx: number,
    ny: number,
    nz: number,
  ) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
  };

  const z0 = zBase;
  const z1 = zBase + depth;

  for (let i = 0; i < segCount; i++) {
    const p0 = pts[i]!;
    const p1 = pts[(i + 1) % pts.length]!;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;

    // Right-hand outward normal in XY plane
    const nx = dy / len;
    const ny = -dx / len;
    const ox = nx * hw;
    const oy = ny * hw;

    // 4 corners in XY (CCW order from +Z)
    const a0x = p0.x + ox;
    const a0y = p0.y + oy;
    const b0x = p1.x + ox;
    const b0y = p1.y + oy;
    const b1x = p1.x - ox;
    const b1y = p1.y - oy;
    const a1x = p0.x - ox;
    const a1y = p0.y - oy;

    // Front (+Z) cap
    pushTri(a0x, a0y, z1, b0x, b0y, z1, b1x, b1y, z1, 0, 0, 1);
    pushTri(a0x, a0y, z1, b1x, b1y, z1, a1x, a1y, z1, 0, 0, 1);
    // Back (-Z) cap
    pushTri(a0x, a0y, z0, b1x, b1y, z0, b0x, b0y, z0, 0, 0, -1);
    pushTri(a0x, a0y, z0, a1x, a1y, z0, b1x, b1y, z0, 0, 0, -1);
    // Side +normal
    pushTri(a0x, a0y, z0, b0x, b0y, z0, b0x, b0y, z1, nx, ny, 0);
    pushTri(a0x, a0y, z0, b0x, b0y, z1, a0x, a0y, z1, nx, ny, 0);
    // Side -normal
    pushTri(b1x, b1y, z0, a1x, a1y, z0, a1x, a1y, z1, -nx, -ny, 0);
    pushTri(b1x, b1y, z0, a1x, a1y, z1, b1x, b1y, z1, -nx, -ny, 0);
  }

  // Round caps & miter joints at every vertex for seamless studio specular highlights
  const capSides = 8;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    for (let s = 0; s < capSides; s++) {
      const a0 = (s / capSides) * Math.PI * 2;
      const a1 = ((s + 1) / capSides) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const x0 = p.x + c0 * hw;
      const y0 = p.y + s0 * hw;
      const x1 = p.x + c1 * hw;
      const y1 = p.y + s1 * hw;
      const mx = Math.cos((a0 + a1) * 0.5);
      const my = Math.sin((a0 + a1) * 0.5);

      // Top fan (+Z)
      pushTri(p.x, p.y, z1, x0, y0, z1, x1, y1, z1, 0, 0, 1);
      // Bottom fan (-Z)
      pushTri(p.x, p.y, z0, x1, y1, z0, x0, y0, z0, 0, 0, -1);
      // Cylinder wall
      pushTri(x0, y0, z0, x1, y1, z0, x1, y1, z1, mx, my, 0);
      pushTri(x0, y0, z0, x1, y1, z1, x0, y0, z1, mx, my, 0);
    }
  }

  if (positions.length === 0) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geom;
}

/** Converts an arbitrary `BufferGeometry` into a clean non-indexed vertex-colored geometry. */
function stampVertexColor(geom: THREE.BufferGeometry, color: ParsedRgbaColor): THREE.BufferGeometry {
  const nonIndexed = geom.index ? geom.toNonIndexed() : geom;
  if (nonIndexed !== geom) {
    geom.dispose();
  }
  if (!nonIndexed.getAttribute("normal")) {
    nonIndexed.computeVertexNormals();
  }
  const posAttr = nonIndexed.getAttribute("position");
  const count = posAttr.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  nonIndexed.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // Strip UV so all merged geometries share identical attribute schema (position, normal, color)
  if (nonIndexed.getAttribute("uv")) {
    nonIndexed.deleteAttribute("uv");
  }
  return nonIndexed;
}

/** Merges multiple non-indexed vertex-colored `BufferGeometry` instances into one single GPU buffer. */
function mergeVertexColoredGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geometries.length === 0) return null;
  if (geometries.length === 1) return geometries[0]!;

  let totalVerts = 0;
  for (const g of geometries) {
    const pos = g.getAttribute("position");
    if (pos) totalVerts += pos.count;
  }
  if (totalVerts === 0) {
    for (const g of geometries) g.dispose();
    return null;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);

  let offset = 0;
  for (const g of geometries) {
    const pos = g.getAttribute("position");
    const norm = g.getAttribute("normal");
    const col = g.getAttribute("color");
    if (!pos) {
      g.dispose();
      continue;
    }
    const count = pos.count;
    for (let i = 0; i < count; i++) {
      const dst = (offset + i) * 3;
      positions[dst] = pos.getX(i);
      positions[dst + 1] = pos.getY(i);
      positions[dst + 2] = pos.getZ(i);
      if (norm) {
        normals[dst] = norm.getX(i);
        normals[dst + 1] = norm.getY(i);
        normals[dst + 2] = norm.getZ(i);
      } else {
        normals[dst + 2] = 1;
      }
      if (col) {
        colors[dst] = col.getX(i);
        colors[dst + 1] = col.getY(i);
        colors[dst + 2] = col.getZ(i);
      } else {
        colors[dst] = 0.7;
        colors[dst + 1] = 0.75;
        colors[dst + 2] = 0.82;
      }
    }
    offset += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Creates a precision CNC-chamfered rounded ceramic/acrylic wafer backing geometry. */
export function createChamferedWaferGeometry(
  width: number,
  height: number,
  depth: number,
  cornerRadius = 0.011,
): THREE.BufferGeometry {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const r = Math.min(cornerRadius, hw * 0.35, hh * 0.35);

  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

  const bevelSize = Math.min(0.0018, hw * 0.06, hh * 0.06);
  const bevelThickness = Math.min(0.0016, depth * 0.22);
  const coreDepth = Math.max(0.002, depth - bevelThickness * 2);

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: coreDepth,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geom.translate(0, 0, -coreDepth * 0.5);
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

/** Creates a hollow perimeter accent lip framing the chamfered wafer. */
function createWaferPerimeterRimGeometry(
  width: number,
  height: number,
  zOffset: number,
  rimThickness = 0.0022,
  cornerRadius = 0.011,
): THREE.BufferGeometry {
  const hw = width * 0.5 + 0.0012;
  const hh = height * 0.5 + 0.0012;
  const r = Math.min(cornerRadius, hw * 0.35, hh * 0.35);

  const outer = new THREE.Shape();
  outer.moveTo(-hw + r, -hh);
  outer.lineTo(hw - r, -hh);
  outer.quadraticCurveTo(hw, -hh, hw, -hh + r);
  outer.lineTo(hw, hh - r);
  outer.quadraticCurveTo(hw, hh, hw - r, hh);
  outer.lineTo(-hw + r, hh);
  outer.quadraticCurveTo(-hw, hh, -hw, hh - r);
  outer.lineTo(-hw, -hh + r);
  outer.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

  const ihw = Math.max(0.004, hw - rimThickness);
  const ihh = Math.max(0.004, hh - rimThickness);
  const ir = Math.max(0.001, r - rimThickness * 0.7);
  const hole = new THREE.Path();
  hole.moveTo(-ihw + ir, -ihh);
  hole.lineTo(ihw - ir, -ihh);
  hole.quadraticCurveTo(ihw, -ihh, ihw, -ihh + ir);
  hole.lineTo(ihw, ihh - ir);
  hole.quadraticCurveTo(ihw, ihh, ihw - ir, ihh);
  hole.lineTo(-ihw + ir, ihh);
  hole.quadraticCurveTo(-ihw, ihh, -ihw, ihh - ir);
  hole.lineTo(-ihw, -ihh + ir);
  hole.quadraticCurveTo(-ihw, -ihh, -ihw + ir, -ihh);
  outer.holes.push(hole);

  const geom = new THREE.ExtrudeGeometry(outer, {
    depth: 0.0028,
    bevelEnabled: false,
    curveSegments: 6,
  });
  geom.translate(0, 0, zOffset);
  geom.computeVertexNormals();
  return geom;
}

/** Deterministic fast FNV-1a 32-bit hash for geometry cache keys. */
export function hashStringFnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Synthesizes an `ExtrudedIconBundle` directly from an SVG string or `@modelscript/canvas`
 * `DiagramMarkupNode` tree with automatic filled reliefs, raised 3D stroke ribs,
 * chamfered wafer chassis, and merged stereo-safe GPU buffers.
 */
export function buildExtrudedIconBundle(input: ExtrudeIconInput, options: ExtrudeIconOptions = {}): ExtrudedIconBundle {
  const dark = Boolean(options.dark);
  const currentColor = options.currentColor ?? (dark ? "#e2e8f0" : "#0f172a");
  const waferStyle: ExtrudedWaferStyle = options.waferStyle ?? "tactile-tile";
  const targetSpanMeters = options.targetSpanMeters ?? 0.148;
  const fillDepth = options.fillDepthMeters ?? 0.0038;
  const strokeDepth = options.strokeDepthMeters ?? 0.0054;
  const waferDepth = options.waferDepthMeters ?? 0.009;
  const curveSegments = options.curveSegments ?? 10;

  const doc: ParsedSvgDocument =
    input.kind === "svg"
      ? parseSvgPrimitives(input.svg, currentColor, input.width ?? 80, input.height ?? 56)
      : markupToSvgPrimitives(input.markup, input.attrs, input.width ?? 80, input.height ?? 56, currentColor);

  const vbW = Math.max(1, doc.viewBoxWidth);
  const vbH = Math.max(1, doc.viewBoxHeight);
  const maxDim = Math.max(vbW, vbH);
  const scale = targetSpanMeters / maxDim;

  const widthMeters = Math.max(0.056, vbW * scale);
  const heightMeters = Math.max(0.044, vbH * scale);
  const cx = doc.viewBoxX + vbW * 0.5;
  const cy = doc.viewBoxY + vbH * 0.5;

  const mapPoint = (m: SvgMatrix2D, x: number, y: number): THREE.Vector2 => {
    const [tx, ty] = applyMatrix(m, x, y);
    return new THREE.Vector2((tx - cx) * scale, -(ty - cy) * scale);
  };

  const waferHalfZ = waferStyle === "tactile-tile" ? waferDepth * 0.5 : 0;
  const opaqueParts: THREE.BufferGeometry[] = [];
  const translucentParts: THREE.BufferGeometry[] = [];
  const extractedTexts: ExtractedSvgText[] = [];

  let filledShapeCount = 0;
  let strokeRibbonCount = 0;
  let fillLayerIndex = 0;
  let strokeLayerIndex = 0;

  for (const prim of doc.primitives) {
    if (prim.tag === "text") {
      const content = (prim.textContent ?? "").trim();
      if (content) {
        const tx = parseFiniteNum(prim.attrs["x"], cx);
        const ty = parseFiniteNum(prim.attrs["y"], cy);
        const mapped = mapPoint(prim.transform, tx, ty);
        const rawFs = parseFiniteNum(prim.attrs["font-size"], 11);
        extractedTexts.push({
          text: content,
          x: mapped.x,
          y: mapped.y,
          fontSizeMeters: Math.max(0.006, rawFs * scale * matrixApproxScale(prim.transform)),
          color: prim.fill.isNone ? currentColor : rgbaToCssHex(prim.fill),
        });
      }
      continue;
    }

    const subPaths = samplePrimitiveToSubPaths(prim, curveSegments);
    if (subPaths.length === 0) continue;

    // Transform sampled points into centered, Y-up physical meters
    const transformedSubPaths = subPaths.map((sp) => ({
      closed: sp.closed,
      points: sp.points.map((p) => mapPoint(prim.transform, p.x, p.y)),
    }));

    // Pass A: Extrude closed filled shapes with monotonic Z-layer offset (zero Z-fighting!)
    if (!prim.fill.isNone) {
      const closedPolys = transformedSubPaths
        .map((sp) => dedupePolyline(sp.points, true))
        .filter((pts) => pts.length >= 3);

      for (const poly of closedPolys) {
        // Compute signed area to avoid degenerate zero-area shapes
        let area2 = 0;
        for (let k = 0; k < poly.length; k++) {
          const p0 = poly[k]!;
          const p1 = poly[(k + 1) % poly.length]!;
          area2 += p0.x * p1.y - p1.x * p0.y;
        }
        if (Math.abs(area2) < 1e-8) continue;

        const shape = new THREE.Shape(poly);
        const bevel = Math.min(0.0007, fillDepth * 0.22);
        const geom = new THREE.ExtrudeGeometry(shape, {
          depth: fillDepth,
          bevelEnabled: true,
          bevelThickness: bevel,
          bevelSize: bevel * 0.85,
          bevelSegments: 1,
          curveSegments: 4,
        });
        const zLayer = waferHalfZ + 0.0005 + fillLayerIndex * 0.00035;
        geom.translate(0, 0, zLayer);
        const colored = stampVertexColor(geom, prim.fill);
        if (prim.fill.a < 0.85) {
          translucentParts.push(colored);
        } else {
          opaqueParts.push(colored);
        }
        filledShapeCount++;
        fillLayerIndex++;
      }
    }

    // Pass B: Extrude stroked open & closed paths into proud solid 3D metallic traces/ribs
    if (!prim.stroke.isNone) {
      const strokeHalfW = Math.max(0.0009, prim.strokeWidth * scale * matrixApproxScale(prim.transform) * 0.55);
      const zStroke = waferHalfZ + fillDepth * 0.55 + strokeLayerIndex * 0.00028;

      for (const sp of transformedSubPaths) {
        const ribbon = buildExtrudedStrokeRibbonGeometry(
          sp.points,
          sp.closed,
          strokeHalfW,
          zStroke,
          strokeDepth,
          prim.stroke,
        );
        if (ribbon) {
          opaqueParts.push(ribbon);
          strokeRibbonCount++;
          strokeLayerIndex++;
        }
      }
    }
  }

  // Ensure even an empty/text-only schematic block produces a clean raised frame so it's always visible
  if (opaqueParts.length === 0 && translucentParts.length === 0) {
    const fallbackStroke = parseSvgColor(options.accentColor ?? "#38bdf8", currentColor);
    const hw = widthMeters * 0.42;
    const hh = heightMeters * 0.36;
    const frame = buildExtrudedStrokeRibbonGeometry(
      [new THREE.Vector2(-hw, -hh), new THREE.Vector2(hw, -hh), new THREE.Vector2(hw, hh), new THREE.Vector2(-hw, hh)],
      true,
      0.0022,
      waferHalfZ + 0.001,
      strokeDepth,
      fallbackStroke,
    );
    if (frame) {
      opaqueParts.push(frame);
      strokeRibbonCount++;
    }
  }

  const opaqueGeometry = mergeVertexColoredGeometries(opaqueParts);
  const translucentGeometry = mergeVertexColoredGeometries(translucentParts);
  const waferGeometry =
    waferStyle === "tactile-tile"
      ? createChamferedWaferGeometry(widthMeters + 0.016, heightMeters + 0.014, waferDepth)
      : null;
  const rimGeometry =
    waferStyle === "tactile-tile"
      ? createWaferPerimeterRimGeometry(widthMeters + 0.016, heightMeters + 0.014, waferHalfZ - 0.0014)
      : null;

  const totalDepth =
    waferStyle === "tactile-tile" ? waferDepth + strokeDepth + 0.004 : Math.max(fillDepth, strokeDepth) + 0.004;

  const keyBasis = JSON.stringify({
    kind: input.kind,
    src: input.kind === "svg" ? input.svg : doc.primitives.length,
    w: widthMeters.toFixed(4),
    h: heightMeters.toFixed(4),
    waferStyle,
    dark,
    currentColor,
  });

  let disposed = false;
  return {
    cacheKey: `ext_${hashStringFnv1a(keyBasis)}`,
    opaqueGeometry,
    translucentGeometry,
    waferGeometry,
    rimGeometry,
    widthMeters: waferStyle === "tactile-tile" ? widthMeters + 0.016 : widthMeters,
    heightMeters: waferStyle === "tactile-tile" ? heightMeters + 0.014 : heightMeters,
    depthMeters: totalDepth,
    extractedTexts,
    primitiveCount: doc.primitives.length,
    filledShapeCount,
    strokeRibbonCount,
    dispose() {
      if (disposed) return;
      disposed = true;
      opaqueGeometry?.dispose();
      translucentGeometry?.dispose();
      waferGeometry?.dispose();
      rimGeometry?.dispose();
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Reference-Counted LRU GPU Geometry Cache                                  */
/* -------------------------------------------------------------------------- */

interface CacheRecord {
  key: string;
  bundle: ExtrudedIconBundle;
  refs: number;
  lastUsedTick: number;
}

export class ExtrudedIconCache {
  private readonly entries = new Map<string, CacheRecord>();
  private tick = 0;

  constructor(private readonly maxEntries = 128) {}

  get size(): number {
    return this.entries.size;
  }

  acquire(cacheKey: string, factory: () => ExtrudedIconBundle): ExtrudedIconBundle {
    const existing = this.entries.get(cacheKey);
    if (existing) {
      existing.refs++;
      existing.lastUsedTick = ++this.tick;
      return existing.bundle;
    }

    this.evictIfNeeded();
    const bundle = factory();
    this.entries.set(cacheKey, {
      key: cacheKey,
      bundle,
      refs: 1,
      lastUsedTick: ++this.tick,
    });
    return bundle;
  }

  release(cacheKey: string): void {
    const rec = this.entries.get(cacheKey);
    if (!rec) return;
    rec.refs = Math.max(0, rec.refs - 1);
    rec.lastUsedTick = ++this.tick;
    if (this.entries.size > this.maxEntries) {
      this.evictIfNeeded();
    }
  }

  private evictIfNeeded(): void {
    if (this.entries.size < this.maxEntries) return;
    let oldestUnused: CacheRecord | null = null;
    for (const rec of this.entries.values()) {
      if (rec.refs === 0 && (!oldestUnused || rec.lastUsedTick < oldestUnused.lastUsedTick)) {
        oldestUnused = rec;
      }
    }
    if (oldestUnused) {
      this.entries.delete(oldestUnused.key);
      oldestUnused.bundle.dispose();
    }
  }

  clear(): void {
    for (const rec of this.entries.values()) {
      rec.bundle.dispose();
    }
    this.entries.clear();
  }
}

let sharedExtrudedIconCache: ExtrudedIconCache | null = null;

export function getSharedExtrudedIconCache(): ExtrudedIconCache {
  if (!sharedExtrudedIconCache) {
    sharedExtrudedIconCache = new ExtrudedIconCache(128);
  }
  return sharedExtrudedIconCache;
}
