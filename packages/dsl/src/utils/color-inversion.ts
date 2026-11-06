// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Configuration options for dark-mode perceptual color adaptation.
 */
export interface DarkModeColorOptions {
  /**
   * Whether dark mode adaptation is active.
   * If false, colors and SVGs are returned unchanged.
   * @default true
   */
  isDark?: boolean | undefined;

  /**
   * Target container or canvas surface background color in CSS hex or rgb format
   * (e.g. "#1e1e1e", "#131622", "#0f172a").
   * Used to guarantee APCA / WCAG minimum contrast ratios against the specific surface.
   * @default "#121212"
   */
  targetBg?: string | undefined;

  /**
   * Chroma threshold in Oklch space below which colors are treated as neutral/achromatic
   * (black, white, greys) and subjected to lightness inversion.
   * Colors with chroma above this threshold preserve their semantic hue and saturation.
   * @default 0.04
   */
  chromaThreshold?: number | undefined;

  /**
   * Minimum perceived lightness floor (in Oklch [0, 1]) for chromatic colors on dark surfaces.
   * Dark saturated colors like crimson red (#c8102e) or navy blue (#000080) are boosted
   * so they remain vivid and legible against dark themes without inverting their hue.
   * @default 0.65
   */
  minChromaticLightness?: number | undefined;

  /**
   * Whether full-bleed white background bounding-box rectangles (e.g., width="200" height="200"
   * or width="100%" height="100%") should be made transparent (fill="none") so icons blend
   * seamlessly into dark mode parent cards.
   * @default true
   */
  stripBackgroundRects?: boolean | undefined;
}

/** Clamp and round to 0-255. */
function clamp255(v: number): number {
  return Math.round(Math.max(0, Math.min(255, v)));
}

/** Convert sRGB gamma-compressed channel [0, 1] to linear luminance. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Convert linear luminance [0, 1] to sRGB gamma-compressed channel. */
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;
}

/** Convert sRGB [0, 1] to Oklab [L, a, b]. */
function srgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bVal = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return [L, a, bVal];
}

/** Convert Oklab [L, a, b] to linear sRGB [r, g, b]. */
function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = +4.0767439362 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return [lr, lg, lb];
}

/** Convert sRGB [0, 1] to Oklch [L, C, h] (L in [0, 1], C >= 0, h in [0, 360)). */
function srgbToOklch(r: number, g: number, b: number): [number, number, number] {
  const [L, a, bVal] = srgbToOklab(r, g, b);
  const C = Math.sqrt(a * a + bVal * bVal);
  let h = (Math.atan2(bVal, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, C, h];
}

/** Convert Oklch [L, C, h] back to sRGB [0-255] with gamut mapping preserving hue. */
function oklchToSrgb(L: number, C: number, h: number): [number, number, number] {
  const hRad = (h * Math.PI) / 180;
  let curC = C;
  let a = curC * Math.cos(hRad);
  let b = curC * Math.sin(hRad);
  let [lr, lg, lb] = oklabToLinearSrgb(L, a, b);

  // Gamut mapping: if color falls outside sRGB gamut, binary-search reduction of C
  // while strictly preserving Lightness (L) and Hue (h).
  const EPSILON = 1e-4;
  if (lr < -EPSILON || lr > 1 + EPSILON || lg < -EPSILON || lg > 1 + EPSILON || lb < -EPSILON || lb > 1 + EPSILON) {
    let low = 0;
    let high = curC;
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2;
      a = mid * Math.cos(hRad);
      b = mid * Math.sin(hRad);
      [lr, lg, lb] = oklabToLinearSrgb(L, a, b);
      if (lr >= 0 && lr <= 1 && lg >= 0 && lg <= 1 && lb >= 0 && lb <= 1) {
        low = mid;
      } else {
        high = mid;
      }
    }
    curC = low;
    a = curC * Math.cos(hRad);
    b = curC * Math.sin(hRad);
    [lr, lg, lb] = oklabToLinearSrgb(L, a, b);
  }

  return [clamp255(linearToSrgb(lr) * 255), clamp255(linearToSrgb(lg) * 255), clamp255(linearToSrgb(lb) * 255)];
}

/** Parse CSS color string (hex or rgb/rgba) to [r, g, b, alpha]. */
function parseCssColor(color: string): { r: number; g: number; b: number; alpha?: number | undefined } | null {
  const rgbMatch = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1] ?? "0", 10);
    const g = parseInt(rgbMatch[2] ?? "0", 10);
    const b = parseInt(rgbMatch[3] ?? "0", 10);
    const alpha = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : undefined;
    return { r, g, b, alpha };
  }

  const hexMatch = color.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hexMatch) {
    let hex = hexMatch[1] ?? "";
    let alpha: number | undefined;

    if (hex.length === 3) {
      hex = hex[0]! + hex[0]! + hex[1] + hex[1] + hex[2] + hex[2];
    } else if (hex.length === 4) {
      alpha = parseInt(hex[3]! + hex[3]!, 16) / 255;
      hex = hex[0]! + hex[0]! + hex[1] + hex[1] + hex[2] + hex[2];
    } else if (hex.length === 8) {
      alpha = parseInt(hex.slice(6, 8), 16) / 255;
      hex = hex.slice(0, 6);
    }

    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b, alpha };
    }
  }

  return null;
}

const colorCache = new Map<string, string>();
const MAX_CACHE_SIZE = 2000;

/**
 * Adapt a single CSS color for dark mode using split-path Oklch perceptual adaptation.
 * - Achromatic neutrals (black, white, greys) undergo smooth lightness inversion (black -> off-white, white -> dark).
 * - Pastels and light canvas backgrounds (cream, beige, peach) invert to dark tinted tones.
 * - Chromatic colors (red, blue, green, yellow, etc.) strictly preserve their hue and chroma,
 *   with an adaptive lightness floor ensuring vibrant contrast against dark surfaces.
 */
export function adaptColorForDarkMode(
  color: string,
  options?: DarkModeColorOptions,
  role?: "stroke" | "text" | "fill" | "general",
): string {
  if (options?.isDark === false) return color;

  const roleKey = role ?? "general";
  const cacheKey = `${color}::${options?.targetBg ?? ""}::${options?.minChromaticLightness ?? ""}::${roleKey}`;
  const cached = colorCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const parsed = parseCssColor(color);
  if (!parsed) {
    colorCache.set(cacheKey, color);
    return color;
  }

  const { r, g, b, alpha } = parsed;
  const [L, C, h] = srgbToOklch(r / 255, g / 255, b / 255);

  const chromaThreshold = options?.chromaThreshold ?? 0.04;
  const isNeutral = C < chromaThreshold;
  const isPastel = C < 0.12 && L >= 0.65;

  let targetBgL = 0.12;
  if (options?.targetBg) {
    const parsedBg = parseCssColor(options.targetBg);
    if (parsedBg) {
      const [bgL] = srgbToOklch(parsedBg.r / 255, parsedBg.g / 255, parsedBg.b / 255);
      targetBgL = bgL;
    }
  }

  let outR: number;
  let outG: number;
  let outB: number;

  if (role === "text") {
    // Text in dark mode must ALWAYS be clearly legible against dark surfaces
    if (isNeutral || isPastel) {
      // Both black text (L=0) and white text (L=1) map to crisp off-white in dark mode
      const textL = 0.93;
      [outR, outG, outB] = oklchToSrgb(textL, 0, 0);
    } else {
      // Chromatic text: ensure minimum lightness 0.75
      const textL = Math.max(0.75, L);
      [outR, outG, outB] = oklchToSrgb(textL, Math.min(C, 0.28), h);
    }
  } else if (role === "stroke") {
    // Strokes/lines/wires/axes must NEVER be crushed to invisible dark grey in dark mode
    if (isNeutral) {
      // S-curve inversion preserving high contrast for foreground lines
      // Dark grey lines like #5f5f5f (L=0.48) map to L >= 0.78, #c0c0c0 (L=0.81) maps to L >= 0.68
      const t = Math.max(0, Math.min(1, L));
      const strokeL = Math.max(0.68, Math.min(0.93, 0.93 - 0.25 * Math.pow(t, 1.2) - 0.45 * Math.pow(t, 3.5)));
      [outR, outG, outB] = oklchToSrgb(strokeL, 0, 0);
    } else {
      // Chromatic stroke: ensure minimum lightness 0.65
      const strokeL = Math.max(0.65, L);
      [outR, outG, outB] = oklchToSrgb(strokeL, Math.min(C, 0.28), h);
    }
  } else if (isNeutral) {
    // Non-linear inversion: black (L=0) maps to 0.93 (#ececec), white (L=1) maps to 0.13 (#1a1a1a).
    const invertedL = Math.max(0.12, Math.min(0.93, 0.93 - L * 0.8));
    [outR, outG, outB] = oklchToSrgb(invertedL, 0, 0);
  } else if (isPastel) {
    // Pastel fills (like beige #dfd3a9, peach #ffd5aa, or cream #ffd788):
    // Invert lightness to dark tinted surface tone (0.15 - 0.28) while preserving warm hue and muted chroma!
    const invertedL = Math.max(0.15, Math.min(0.28, 0.93 - L * 0.75));
    [outR, outG, outB] = oklchToSrgb(invertedL, C * 0.7, h);
  } else {
    // Chromatic: PRESERVE HUE AND CHROMA.
    // Ensure sufficient lightness floor relative to dark container background.
    const minL = Math.max(options?.minChromaticLightness ?? 0.65, targetBgL + 0.45);
    let adaptedL = L;
    if (adaptedL < minL) {
      adaptedL = minL + L * 0.12;
    }
    // Damp extreme chroma slightly to prevent ocular glare on OLED dark canvases
    const adaptedC = Math.min(C, 0.28);
    [outR, outG, outB] = oklchToSrgb(adaptedL, adaptedC, h);
  }

  let result: string;
  if (alpha !== undefined) {
    result = `rgba(${outR}, ${outG}, ${outB}, ${Number(alpha.toFixed(3))})`;
  } else {
    result = `rgb(${outR}, ${outG}, ${outB})`;
  }

  if (colorCache.size >= MAX_CACHE_SIZE) colorCache.clear();
  colorCache.set(cacheKey, result);
  return result;
}

/**
 * Backwards-compatible alias for `adaptColorForDarkMode`.
 */
export function invertColorHelmlab(
  color: string,
  options?: DarkModeColorOptions,
  role?: "stroke" | "text" | "fill" | "general",
): string {
  return adaptColorForDarkMode(color, options, role);
}

/**
 * Determines whether a color is a light paper or canvas background tone
 * (white, off-white, beige, cream, pastel yellow/peach, or light grey with L >= 0.68).
 */
export function isLightPaperColor(color: string): boolean {
  const parsed = parseCssColor(color);
  if (!parsed) {
    const c = color.trim().toLowerCase();
    return c === "white" || c === "#fff" || c === "#ffffff" || c === "rgb(255,255,255)" || c === "rgb(255, 255, 255)";
  }
  const [L] = srgbToOklch(parsed.r / 255, parsed.g / 255, parsed.b / 255);
  return L >= 0.68;
}

/** Regex matching CSS color values (hex, rgb, rgba). */
const COLOR_VALUE_RE = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)|#[0-9a-fA-F]{3,8}\b/g;

/**
 * Adapt all color values in an SVG string for dark mode.
 * - Inverts neutrals (black strokes become crisp off-white).
 * - Preserves semantic chromatic colors (Modelica red dot, pins, fluid lines).
 * - Makes full-bleed white or light paper background bounding-box rectangles transparent (fill="none").
 * - Boosts contrast on strokes and text so waveforms, axes, and labels remain crisp and readable.
 * - Preserves white foreground glyphs without strokes (e.g. Information 'i').
 */
export function adaptSvgColors(str: string, options?: boolean | DarkModeColorOptions): string {
  const opts: DarkModeColorOptions = typeof options === "boolean" ? { isDark: options } : (options ?? { isDark: true });

  if (opts.isDark === false) return str;

  let out = str;

  // 1. Strip or make transparent full-canvas bounding-box rectangles if requested
  // Matches rects with width/height >= 180, 100%, or 200 spanning canvas
  if (opts.stripBackgroundRects !== false) {
    const RECT_TAG_RE = /<rect\b([^>]*?)>/gi;
    out = out.replace(RECT_TAG_RE, (match, attrs: string) => {
      const wM = attrs.match(/\bwidth=["']([^"']+)["']/i);
      const hM = attrs.match(/\bheight=["']([^"']+)["']/i);
      const wStr = wM ? wM[1] : undefined;
      const hStr = hM ? hM[1] : undefined;
      const w = wStr ? (wStr.endsWith("%") ? 200 : parseFloat(wStr)) : 0;
      const h = hStr ? (hStr.endsWith("%") ? 200 : parseFloat(hStr)) : 0;

      const isFullCanvas =
        (w >= 180 || attrs.includes('width="100%"')) &&
        (h >= 180 || attrs.includes('height="100%"'));

      if (isFullCanvas) {
        const fillM = attrs.match(/\bfill=["']([^"']+)["']/i);
        const fillVal = fillM ? fillM[1] : undefined;
        if (fillVal && !fillVal.startsWith("url(")) {
          if (isLightPaperColor(fillVal)) {
            return match.replace(/\bfill=["'][^"']+["']/i, 'fill="none"');
          }
        }
        const styleFillM = attrs.match(/\bstyle=["'][^"']*\bfill:\s*([^;]+)[^"']*["']/i);
        const styleFillVal = styleFillM ? styleFillM[1] : undefined;
        if (styleFillVal && !styleFillVal.startsWith("url(")) {
          if (isLightPaperColor(styleFillVal.trim())) {
            return match.replace(/(\bstyle=["'][^"']*\bfill:\s*)[^;]+(;?[^"']*["'])/i, '$1none$2');
          }
        }
      }
      return match;
    });
  }

  // 2. Preserve white on foreground icon glyphs with no stroke (e.g. 'i' in Information)
  out = out.replace(/<(path|polygon|circle|ellipse)\b([^>]*?)>/gi, (match, tag, attrs: string) => {
    const strokeM = attrs.match(/\bstroke=["']([^"']+)["']/i);
    const hasStroke = strokeM && strokeM[1] !== "none";
    if (!hasStroke) {
      const fillM = attrs.match(/\bfill=["']([^"']+)["']/i);
      const fillVal = fillM ? fillM[1]?.toLowerCase() : undefined;
      if (fillVal && (fillVal === "#ffffff" || fillVal === "#fff" || fillVal === "white")) {
        return `<${tag}${attrs.replace(/\bfill=["'][^"']+["']/i, 'fill="rgb(245, 245, 245)"')}>`;
      }
    }
    return match;
  });

  // 3. Process tags by category:
  // (a) <text ...> elements
  out = out.replace(/<text\b([^>]*?)>/gi, (_match, attrs: string) => {
    const adaptedAttrs = attrs.replace(/\bfill=["']([^"']+)["']/gi, (fMatch, val: string) => {
      if (val === "none" || val.startsWith("url(")) return fMatch;
      return `fill="${adaptColorForDarkMode(val, opts, "text")}"`;
    });
    return `<text${adaptedAttrs}>`;
  });

  // (b) Non-text element tags
  out = out.replace(/<(?!(?:text|\/text)\b)([a-zA-Z0-9_-]+)\b([^>]*?)>/gi, (_match, tag: string, attrs: string) => {
    const adaptedAttrs = attrs.replace(/\bfill=["']([^"']+)["']/gi, (fMatch, val: string) => {
      if (val === "none" || val.startsWith("url(") || val.startsWith("rgb(245, 245, 245)")) return fMatch;
      return `fill="${adaptColorForDarkMode(val, opts, "fill")}"`;
    });
    return `<${tag}${adaptedAttrs}>`;
  });

  // 4. Adapt stroke attributes across all elements with high contrast floor
  out = out.replace(/\bstroke=["']([^"']+)["']/gi, (match, val: string) => {
    if (val === "none" || val.startsWith("url(")) return match;
    return `stroke="${adaptColorForDarkMode(val, opts, "stroke")}"`;
  });

  // 5. Adapt stop-colors in gradients
  out = out.replace(/\bstop-color=["']([^"']+)["']/gi, (_match, val: string) => {
    return `stop-color="${adaptColorForDarkMode(val, opts, "general")}"`;
  });

  // 6. Adapt style attributes
  out = out.replace(/\bstyle=["']([^"']+)["']/gi, (_match, styleBody: string) => {
    const adaptedStyle = styleBody.replace(COLOR_VALUE_RE, (c) => adaptColorForDarkMode(c, opts, "general"));
    return `style="${adaptedStyle}"`;
  });

  return out;
}

/**
 * Backwards-compatible alias for `adaptSvgColors`.
 */
export function invertSvgColors(str: string, isDarkOrOptions?: boolean | DarkModeColorOptions): string {
  return adaptSvgColors(str, isDarkOrOptions);
}
