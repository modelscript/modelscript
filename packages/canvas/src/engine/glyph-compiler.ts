// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unified Markup / Glyph Compiler.
 *
 * Compiles DOM-free SVG markup trees (`DiagramMarkup` / `X6Markup`) emitted by
 * all 40+ ModelScript polyglot diagram builders into cached draw lists with O(1)
 * selector-based attribute patching (`body/fill`, `indicator/fill`, `label/text`).
 *
 * Supports dual targets from one compiled representation:
 *  1. Live SVG DOM materialization & incremental selector patching (Desktop schematic mode)
 *  2. Direct Canvas2D painting (50,000+ node mode, LOD thumbnails, WebXR VR CanvasTexture)
 */

export interface DiagramMarkupNode {
  tagName: string;
  selector?: string | undefined;
  groupSelector?: string | undefined;
  attrs?: Record<string, string | number> | undefined;
  style?: Record<string, string | number> | undefined;
  className?: string | undefined;
  children?: DiagramMarkupNode[] | undefined;
  textContent?: string | undefined;
}

export interface CompiledPrimitive {
  tagName: string;
  selector?: string | undefined;
  groupSelector?: string | undefined;
  attrs: Record<string, string | number>;
  style: Record<string, string | number>;
  className?: string | undefined;
  textContent?: string | undefined;
  children: CompiledPrimitive[];
}

export interface CompiledGlyph {
  roots: CompiledPrimitive[];
  /** O(1) lookup by selector name (e.g. "body", "label", "indicator", "button"). */
  selectors: Map<string, CompiledPrimitive[]>;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const CAMEL_TO_KEBAB_EXCEPTIONS = new Set([
  "viewBox",
  "preserveAspectRatio",
  "gradientUnits",
  "gradientTransform",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  "clipPathUnits",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "refX",
  "refY",
  "stdDeviation",
  "baseFrequency",
  "numOctaves",
  "tableValues",
  "spreadMethod",
]);

/** Converts X6-style camelCase SVG attribute names (`strokeWidth`) to standard SVG kebab-case (`stroke-width`). */
export function normalizeSvgAttrName(name: string): string {
  if (CAMEL_TO_KEBAB_EXCEPTIONS.has(name) || name.includes("-") || name.includes(":")) {
    return name;
  }
  return name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function clonePrimitive(raw: DiagramMarkupNode, selectors: Map<string, CompiledPrimitive[]>): CompiledPrimitive {
  const prim: CompiledPrimitive = {
    tagName: raw.tagName || "g",
    selector: raw.selector,
    groupSelector: raw.groupSelector,
    attrs: raw.attrs ? { ...raw.attrs } : {},
    style: raw.style ? { ...raw.style } : {},
    className: raw.className,
    textContent: raw.textContent,
    children: [],
  };

  if (prim.selector) {
    let list = selectors.get(prim.selector);
    if (!list) {
      list = [];
      selectors.set(prim.selector, list);
    }
    list.push(prim);
  }
  if (prim.groupSelector) {
    let list = selectors.get(prim.groupSelector);
    if (!list) {
      list = [];
      selectors.set(prim.groupSelector, list);
    }
    list.push(prim);
  }

  if (typeof raw.children === "string") {
    if (prim.textContent === undefined) prim.textContent = raw.children;
  } else if (Array.isArray(raw.children)) {
    for (const child of raw.children) {
      if (child && typeof child === "object") {
        prim.children.push(clonePrimitive(child, selectors));
      }
    }
  }
  return prim;
}

/** Compiles `DiagramMarkupNode | DiagramMarkupNode[]` (or default rect/label fallback) into a `CompiledGlyph`. */
export function compileGlyphMarkup(
  markup: DiagramMarkupNode | DiagramMarkupNode[] | undefined | null,
  attrs?: Record<string, Record<string, unknown> | undefined> | undefined,
  defaultWidth = 80,
  defaultHeight = 40,
): CompiledGlyph {
  const selectors = new Map<string, CompiledPrimitive[]>();
  const rawList: DiagramMarkupNode[] = Array.isArray(markup)
    ? markup
    : markup
      ? [markup]
      : [
          {
            tagName: "rect",
            selector: "body",
            attrs: {
              width: defaultWidth,
              height: defaultHeight,
              rx: 4,
              ry: 4,
              fill: "#1e293b",
              stroke: "#64748b",
              "stroke-width": 1.5,
            },
          },
          {
            tagName: "text",
            selector: "label",
            attrs: {
              x: defaultWidth / 2,
              y: defaultHeight / 2,
              "text-anchor": "middle",
              "dominant-baseline": "central",
              fill: "#e2e8f0",
              "font-size": 12,
            },
          },
        ];

  const roots: CompiledPrimitive[] = [];
  for (const item of rawList) {
    if (item && typeof item === "object") {
      roots.push(clonePrimitive(item, selectors));
    }
  }

  const glyph: CompiledGlyph = { roots, selectors };
  if (attrs) {
    applyAttrsToGlyph(glyph, attrs);
  }
  return glyph;
}

/** Applies a structured attrs dictionary (`{ body: { fill: '#f00' }, label: { text: 'R1' } }`) in O(1) per selector. */
export function applyAttrsToGlyph(
  glyph: CompiledGlyph,
  attrs: Record<string, Record<string, unknown> | undefined>,
): void {
  for (const [selector, spec] of Object.entries(attrs)) {
    if (!spec || typeof spec !== "object") continue;
    const targets = glyph.selectors.get(selector);
    if (!targets) continue;
    for (const prim of targets) {
      for (const [k, v] of Object.entries(spec)) {
        if (v === undefined) continue;
        if (k === "text" || k === "textContent") {
          prim.textContent = v === null ? "" : String(v);
        } else if (k === "style" && typeof v === "object" && v !== null) {
          for (const [sk, sv] of Object.entries(v as Record<string, string | number>)) {
            prim.style[sk] = sv;
          }
        } else if (k === "refWidth" || k === "refHeight" || k === "refX" || k === "refY") {
          prim.attrs[k] = typeof v === "number" || typeof v === "string" ? v : String(v);
        } else if (v === null) {
          Reflect.deleteProperty(prim.attrs, k);
          Reflect.deleteProperty(prim.attrs, normalizeSvgAttrName(k));
        } else if (typeof v === "string" || typeof v === "number") {
          prim.attrs[normalizeSvgAttrName(k)] = v;
        }
      }
    }
  }
}

const REF_ATTR_NAMES = new Set(["refWidth", "refHeight", "refX", "refY", "textVerticalAnchor"]);

/** Applies a single slash-delimited selector path (`"indicator/fill"`, `"label/text"`). */
export function patchGlyphAttrPath(glyph: CompiledGlyph, path: string, value: unknown): boolean {
  const slashIdx = path.indexOf("/");
  if (slashIdx <= 0) return false;
  const selector = path.slice(0, slashIdx);
  const prop = path.slice(slashIdx + 1);
  const targets = glyph.selectors.get(selector);
  if (!targets || targets.length === 0) return false;

  const targetKey = REF_ATTR_NAMES.has(prop) ? prop : normalizeSvgAttrName(prop);
  for (const prim of targets) {
    if (prop === "text" || prop === "textContent") {
      prim.textContent = value === null || value === undefined ? "" : String(value);
    } else if (value === null || value === undefined) {
      Reflect.deleteProperty(prim.attrs, prop);
      Reflect.deleteProperty(prim.attrs, targetKey);
    } else if (typeof value === "string" || typeof value === "number") {
      prim.attrs[targetKey] = value;
    }
  }
  return true;
}

/** Reads an attribute from a slash-delimited path (`"body/fill"`, `"label/text"`). */
export function readGlyphAttrPath(glyph: CompiledGlyph, path: string): unknown {
  const slashIdx = path.indexOf("/");
  if (slashIdx <= 0) return undefined;
  const selector = path.slice(0, slashIdx);
  const prop = path.slice(slashIdx + 1);
  const prim = glyph.selectors.get(selector)?.[0];
  if (!prim) return undefined;
  if (prop === "text" || prop === "textContent") return prim.textContent;
  return prim.attrs[prop] ?? prim.attrs[normalizeSvgAttrName(prop)];
}

function resolveRefNumeric(
  raw: string | number | undefined,
  refSize: number,
  allowFraction = true,
): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return undefined;
    return allowFraction && raw > 0 && raw <= 1 ? raw * refSize : raw;
  }
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    const pct = parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(pct) ? (pct / 100) * refSize : undefined;
  }
  const n = parseFloat(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return allowFraction && n > 0 && n <= 1 ? n * refSize : n;
}

/**
 * Sets SVG `<text>` content, splitting multi-line strings on `\n` into `<tspan>` elements
 * aligned according to the element's `dominant-baseline` (`hanging` -> top-aligned,
 * `alphabetic` -> bottom-aligned, otherwise vertically centered).
 */
export function setSvgTextContent(el: Element, text: string, doc: Document): void {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.includes("\n")) {
    el.textContent = normalized;
    return;
  }
  const lines = normalized.split("\n");
  const xAttr = el.getAttribute("x") ?? "0";
  const lineHeightEm = 1.25;
  const baseline = (el.getAttribute("dominant-baseline") ?? "").toLowerCase();
  const firstDy =
    baseline === "hanging" || baseline === "text-before-edge"
      ? "0"
      : baseline === "alphabetic" || baseline === "text-after-edge"
        ? `${-(lines.length - 1) * lineHeightEm}em`
        : `${-((lines.length - 1) * lineHeightEm) / 2}em`;
  el.textContent = "";
  for (let i = 0; i < lines.length; i++) {
    const tspan = doc.createElementNS(SVG_NS, "tspan");
    tspan.setAttribute("x", xAttr);
    tspan.setAttribute("dy", i === 0 ? firstDy : `${lineHeightEm}em`);
    tspan.textContent = lines[i]!.length > 0 ? lines[i]! : "\u00A0";
    el.appendChild(tspan);
  }
}

const SAFE_SVG_TAGS = new Set([
  "svg",
  "g",
  "defs",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
  "tspan",
  "image",
  "title",
  "desc",
  "clippath",
  "mask",
  "lineargradient",
  "radialgradient",
  "stop",
  "pattern",
  "marker",
  "symbol",
  "use",
  "filter",
  "fegaussianblur",
  "feoffset",
  "feblend",
  "fedropshadow",
  "fecolormatrix",
]);

function isUnsafeUrl(val: string): boolean {
  let cleaned = "";
  for (let i = 0; i < val.length; i++) {
    if (val.charCodeAt(i) > 0x20) {
      cleaned += val[i];
    }
  }
  cleaned = cleaned.toLowerCase();
  return (
    cleaned.startsWith("javascript:") ||
    cleaned.startsWith("vbscript:") ||
    cleaned.startsWith("data:text/html") ||
    cleaned.startsWith("data:image/svg+xml")
  );
}

/**
 * Materializes a `CompiledGlyph` into live SVG DOM nodes with safe TextNode handling
 * and strict tag/attribute sanitization.
 */
export function materializeGlyphToSvg(
  glyph: CompiledGlyph,
  doc: Document,
  width: number,
  height: number,
  selectorElements?: Map<string, Element[]>,
): SVGGElement {
  const rootG = doc.createElementNS(SVG_NS, "g");

  const buildEl = (prim: CompiledPrimitive): Element | null => {
    const tagLower = prim.tagName.toLowerCase();
    if (!SAFE_SVG_TAGS.has(tagLower)) {
      return null;
    }
    const el = doc.createElementNS(SVG_NS, prim.tagName);
    if (prim.selector) {
      if (prim.selector === "portBody") {
        el.setAttribute("magnet", "true");
      }
      el.setAttribute("data-selector", prim.selector);
      if (selectorElements) {
        let list = selectorElements.get(prim.selector);
        if (!list) {
          list = [];
          selectorElements.set(prim.selector, list);
        }
        list.push(el);
      }
    }
    if (prim.className) {
      el.setAttribute("class", prim.className);
    }

    let deferredTextAttr: string | undefined;
    for (const [k, v] of Object.entries(prim.attrs)) {
      const kLower = k.toLowerCase();
      if (kLower.startsWith("on")) continue; // Block inline event handlers
      if (k === "refWidth") {
        const val = resolveRefNumeric(v, width, true);
        if (val !== undefined) el.setAttribute("width", String(val));
      } else if (k === "refHeight") {
        const val = resolveRefNumeric(v, height, true);
        if (val !== undefined) el.setAttribute("height", String(val));
      } else if (k === "refX") {
        const val = resolveRefNumeric(v, width, true);
        if (val !== undefined) el.setAttribute("x", String(val));
      } else if (k === "refY") {
        const val = resolveRefNumeric(v, height, true);
        if (val !== undefined) el.setAttribute("y", String(val));
      } else if (k === "textVerticalAnchor" || k === "text-vertical-anchor") {
        const sv = String(v);
        const baseline = sv === "top" ? "hanging" : sv === "middle" ? "central" : "alphabetic";
        el.setAttribute("dominant-baseline", baseline);
      } else if (k === "text" && prim.tagName === "text") {
        if (prim.textContent === undefined) {
          deferredTextAttr = String(v);
        }
      } else if (k === "xlink:href" || k === "href") {
        const sv = String(v);
        if (isUnsafeUrl(sv)) continue;
        if (k === "xlink:href") {
          el.setAttributeNS(XLINK_NS, "xlink:href", sv);
        } else {
          el.setAttribute("href", sv);
        }
      } else {
        const normName = normalizeSvgAttrName(k);
        if (normName.toLowerCase().startsWith("on")) continue;
        el.setAttribute(normName, String(v));
      }
    }
    if (deferredTextAttr !== undefined) {
      setSvgTextContent(el, deferredTextAttr, doc);
    }

    if (prim.tagName === "rect") {
      if (prim.attrs["width"] === undefined && prim.attrs["refWidth"] === undefined) {
        el.setAttribute("width", String(width));
      }
      if (prim.attrs["height"] === undefined && prim.attrs["refHeight"] === undefined) {
        el.setAttribute("height", String(height));
      }
    } else if (prim.tagName === "circle") {
      if (prim.attrs["cx"] === undefined) el.setAttribute("cx", String(width / 2));
      if (prim.attrs["cy"] === undefined) el.setAttribute("cy", String(height / 2));
      if (prim.attrs["r"] === undefined) el.setAttribute("r", String(Math.min(width, height) / 2));
    }

    if (prim.style && Object.keys(prim.style).length > 0) {
      const css = Object.entries(prim.style)
        .filter(([, sv]) => !isUnsafeUrl(String(sv)))
        .map(([sk, sv]) => `${normalizeSvgAttrName(sk)}:${sv}`)
        .join(";");
      if (css) el.setAttribute("style", css);
    }

    if (prim.textContent !== undefined) {
      if (prim.tagName === "text") {
        setSvgTextContent(el, prim.textContent, doc);
      } else {
        el.textContent = prim.textContent;
      }
    }

    for (const child of prim.children) {
      const childEl = buildEl(child);
      if (childEl) el.appendChild(childEl);
    }
    return el;
  };

  for (const root of glyph.roots) {
    const rootEl = buildEl(root);
    if (rootEl) rootG.appendChild(rootEl);
  }
  return rootG;
}

/** Minimal 2D canvas drawing context interface (works with browser CanvasRenderingContext2D & OffscreenCanvas). */
export interface Canvas2DContextLike {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angleRad: number): void;
  scale(x: number, y: number): void;
  transform?(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  roundRect?(x: number, y: number, w: number, h: number, r: number | number[]): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, start: number, end: number): void;
  fill(path?: unknown): void;
  stroke(path?: unknown): void;
  fillText(text: string, x: number, y: number): void;
  setLineDash?(segments: number[]): void;
  fillStyle: string | unknown;
  strokeStyle: string | unknown;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: string;
  textBaseline: string;
}

const path2DCache = new WeakMap<CompiledPrimitive, { d: string; path: Path2D }>();

function safeNum(raw: unknown, fallback = 0): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : fallback;
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function parseTransformAttr(ctx: Canvas2DContextLike, transform: string): void {
  const re = /(translate|scale|rotate|matrix)\s*\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(transform)) !== null) {
    const fn = match[1];
    const nums = match[2]!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    if (fn === "translate") {
      ctx.translate(nums[0] ?? 0, nums[1] ?? 0);
    } else if (fn === "scale") {
      const sx = nums[0] ?? 1;
      const sy = nums[1] ?? sx;
      ctx.scale(sx, sy);
    } else if (fn === "rotate") {
      const deg = nums[0] ?? 0;
      const cx = nums[1] ?? 0;
      const cy = nums[2] ?? 0;
      if (cx !== 0 || cy !== 0) ctx.translate(cx, cy);
      ctx.rotate((deg * Math.PI) / 180);
      if (cx !== 0 || cy !== 0) ctx.translate(-cx, -cy);
    } else if (fn === "matrix" && nums.length >= 6 && typeof ctx.transform === "function") {
      ctx.transform(nums[0]!, nums[1]!, nums[2]!, nums[3]!, nums[4]!, nums[5]!);
    }
  }
}

/**
 * Paints a `CompiledGlyph` directly onto any Canvas2D context (browser, OffscreenCanvas,
 * or WebXR VR `THREE.CanvasTexture` backing canvas).
 */
export function paintGlyphToCanvas2D(
  ctx: Canvas2DContextLike,
  glyph: CompiledGlyph,
  width: number,
  height: number,
  options: { lodMinimal?: boolean | undefined; scale?: number | undefined } = {},
): void {
  const resolveDim = (
    plain: string | number | undefined,
    ref: string | number | undefined,
    refSize: number,
  ): number | undefined => {
    if (plain !== undefined) return resolveRefNumeric(plain, refSize, false);
    if (ref !== undefined) return resolveRefNumeric(ref, refSize, true);
    return undefined;
  };

  const drawPrimitive = (
    prim: CompiledPrimitive,
    refW: number,
    refH: number,
    inheritedFill?: string,
    inheritedStroke?: string,
  ): void => {
    const tag = prim.tagName.toLowerCase();
    if (tag === "defs" || tag === "title" || tag === "desc" || tag === "metadata") return;
    if (options.lodMinimal && (tag === "text" || tag === "tspan")) return;

    ctx.save();
    const attrs = prim.attrs;

    const opacity = attrs["opacity"] !== undefined ? safeNum(attrs["opacity"], 1) : 1;
    if (opacity < 1) {
      ctx.globalAlpha *= Math.max(0, opacity);
    }

    if (typeof attrs["transform"] === "string" && attrs["transform"].length > 0) {
      parseTransformAttr(ctx, attrs["transform"]);
    }

    const ownFill = attrs["fill"] !== undefined ? String(attrs["fill"]) : undefined;
    const ownStroke = attrs["stroke"] !== undefined ? String(attrs["stroke"]) : undefined;
    const effFill = ownFill ?? inheritedFill;
    const effStroke = ownStroke ?? inheritedStroke;

    // Handle nested <svg viewBox="..."> coordinate mapping (Modelica icons!)
    let childW = refW;
    let childH = refH;
    if (tag === "svg") {
      const sx = resolveDim(attrs["x"], attrs["refX"], refW) ?? 0;
      const sy = resolveDim(attrs["y"], attrs["refY"], refH) ?? 0;
      const sw = resolveDim(attrs["width"], attrs["refWidth"], refW) ?? refW;
      const sh = resolveDim(attrs["height"], attrs["refHeight"], refH) ?? refH;
      if (sx !== 0 || sy !== 0) ctx.translate(sx, sy);
      if (typeof attrs["viewBox"] === "string") {
        const vb = attrs["viewBox"]
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        if (vb.length === 4 && Number.isFinite(vb[2]) && Number.isFinite(vb[3]) && vb[2]! > 0 && vb[3]! > 0) {
          ctx.scale(sw / vb[2]!, sh / vb[3]!);
          ctx.translate(-vb[0]!, -vb[1]!);
          childW = vb[2]!;
          childH = vb[3]!;
        }
      }
      for (const child of prim.children) drawPrimitive(child, childW, childH, effFill, effStroke);
      ctx.restore();
      return;
    }

    if (tag === "g") {
      for (const child of prim.children) drawPrimitive(child, childW, childH, effFill, effStroke);
      ctx.restore();
      return;
    }

    const fill = effFill;
    const stroke = effStroke;
    const strokeWidth = safeNum(attrs["stroke-width"] ?? attrs["strokeWidth"], 1);
    const hasFill = fill !== undefined && fill !== "none" && fill !== "transparent" && !fill.startsWith("url(");
    const hasStroke =
      stroke !== undefined &&
      stroke !== "none" &&
      stroke !== "transparent" &&
      !stroke.startsWith("url(") &&
      strokeWidth > 0;

    if (hasFill) ctx.fillStyle = fill;
    if (hasStroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth =
        attrs["vector-effect"] === "non-scaling-stroke" && options.scale && options.scale > 0
          ? strokeWidth / options.scale
          : strokeWidth;
      if (typeof attrs["stroke-dasharray"] === "string" && ctx.setLineDash) {
        const segs = attrs["stroke-dasharray"]
          .split(/[\s,]+/)
          .map(Number)
          .filter((n) => Number.isFinite(n) && n >= 0);
        if (segs.length > 0) ctx.setLineDash(segs);
      }
    }

    if (tag === "rect") {
      const rx = resolveDim(attrs["x"], attrs["refX"], refW) ?? 0;
      const ry = resolveDim(attrs["y"], attrs["refY"], refH) ?? 0;
      const rw = resolveDim(attrs["width"], attrs["refWidth"], refW) ?? refW;
      const rh = resolveDim(attrs["height"], attrs["refHeight"], refH) ?? refH;
      const corner = safeNum(attrs["rx"] ?? attrs["ry"], 0);
      ctx.beginPath();
      if (corner > 0 && typeof ctx.roundRect === "function") {
        ctx.roundRect(rx, ry, rw, rh, corner);
      } else {
        ctx.rect(rx, ry, rw, rh);
      }
      if (hasFill) ctx.fill();
      if (hasStroke) ctx.stroke();
    } else if (tag === "circle") {
      const cx = safeNum(attrs["cx"], 0);
      const cy = safeNum(attrs["cy"], 0);
      const r = safeNum(attrs["r"], 0);
      if (r > 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        if (hasFill) ctx.fill();
        if (hasStroke) ctx.stroke();
      }
    } else if (tag === "ellipse") {
      const cx = safeNum(attrs["cx"], 0);
      const cy = safeNum(attrs["cy"], 0);
      const rx = safeNum(attrs["rx"], 0);
      const ry = safeNum(attrs["ry"], 0);
      if (rx > 0 && ry > 0) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (hasFill) ctx.fill();
        if (hasStroke) ctx.stroke();
      }
    } else if (tag === "line") {
      const x1 = safeNum(attrs["x1"], 0);
      const y1 = safeNum(attrs["y1"], 0);
      const x2 = safeNum(attrs["x2"], 0);
      const y2 = safeNum(attrs["y2"], 0);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      if (hasStroke) ctx.stroke();
    } else if (tag === "polyline" || tag === "polygon") {
      const rawPts = String(attrs["points"] ?? "").trim();
      if (rawPts.length > 0) {
        const nums = rawPts
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number);
        if (nums.length >= 4 && !nums.some((n) => !Number.isFinite(n))) {
          ctx.beginPath();
          ctx.moveTo(nums[0]!, nums[1]!);
          for (let i = 2; i + 1 < nums.length; i += 2) {
            ctx.lineTo(nums[i]!, nums[i + 1]!);
          }
          if (tag === "polygon") ctx.closePath();
          if (hasFill && tag === "polygon") ctx.fill();
          if (hasStroke) ctx.stroke();
        }
      }
    } else if (tag === "path") {
      const d = typeof attrs["d"] === "string" ? attrs["d"] : "";
      if (d.length > 0 && typeof Path2D !== "undefined") {
        let cached = path2DCache.get(prim);
        if (!cached || cached.d !== d) {
          cached = { d, path: new Path2D(d) };
          path2DCache.set(prim, cached);
        }
        if (hasFill) ctx.fill(cached.path);
        if (hasStroke) ctx.stroke(cached.path);
      }
    } else if (tag === "text") {
      const text = (prim.textContent ?? prim.children.map((c) => c.textContent ?? "").join("")).replace(/\r\n?/g, "\n");
      if (text.length > 0) {
        const tx = resolveDim(attrs["x"], attrs["refX"], refW) ?? 0;
        const ty = resolveDim(attrs["y"], attrs["refY"], refH) ?? 0;
        const fontSize = safeNum(attrs["font-size"], 12);
        const fontWeight = String(attrs["font-weight"] ?? "normal");
        const fontFamily = String(attrs["font-family"] ?? "sans-serif");
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        const anchor = String(attrs["text-anchor"] ?? "start");
        ctx.textAlign = anchor === "middle" ? "center" : anchor === "end" ? "right" : "left";
        const vAnchor = String(
          attrs["textVerticalAnchor"] ?? attrs["text-vertical-anchor"] ?? attrs["dominant-baseline"] ?? "middle",
        ).toLowerCase();
        ctx.textBaseline =
          vAnchor === "top" || vAnchor === "hanging" || vAnchor === "text-before-edge"
            ? "top"
            : vAnchor === "bottom" || vAnchor === "alphabetic" || vAnchor === "text-after-edge"
              ? "bottom"
              : "middle";
        ctx.fillStyle = hasFill ? fill! : "#e2e8f0";
        if (!text.includes("\n")) {
          ctx.fillText(text, tx, ty);
        } else {
          const lines = text.split("\n");
          const lineHeight = fontSize * 1.25;
          const startY =
            ctx.textBaseline === "top"
              ? ty
              : ctx.textBaseline === "bottom"
                ? ty - (lines.length - 1) * lineHeight
                : ty - ((lines.length - 1) * lineHeight) / 2;
          for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i]!, tx, startY + i * lineHeight);
          }
        }
      }
    }

    ctx.restore();
  };

  for (const root of glyph.roots) {
    drawPrimitive(root, width, height);
  }
}
