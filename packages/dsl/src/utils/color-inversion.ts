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
 * - Chromatic colors (red, blue, green, yellow, etc.) strictly preserve their hue and chroma,
 *   with an adaptive lightness floor ensuring vibrant contrast against dark surfaces.
 */
export function adaptColorForDarkMode(color: string, options?: DarkModeColorOptions): string {
  if (options?.isDark === false) return color;

  const cacheKey = `${color}::${options?.targetBg ?? ""}::${options?.minChromaticLightness ?? ""}`;
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

  if (isNeutral) {
    // Non-linear inversion: black (L=0) maps to 0.93 (#ececec), white (L=1) maps to 0.13 (#1a1a1a).
    const invertedL = Math.max(0.12, Math.min(0.93, 0.93 - L * 0.8));
    [outR, outG, outB] = oklchToSrgb(invertedL, 0, 0);
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
export function invertColorHelmlab(color: string, options?: DarkModeColorOptions): string {
  return adaptColorForDarkMode(color, options);
}

/** Regex matching CSS color values (hex, rgb, rgba). */
const COLOR_VALUE_RE = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)|#[0-9a-fA-F]{3,8}\b/g;

/** Regex matching standard Modelica or diagram full-canvas background rects. */
const FULL_CANVAS_RECT_RE =
  /<rect\b([^>]*\b(?:width=["'](?:200(?:\.0+)?|100%)["']\s+height=["'](?:200(?:\.0+)?|100%)["']|height=["'](?:200(?:\.0+)?|100%)["']\s+width=["'](?:200(?:\.0+)?|100%)["'])[^>]*)>/gi;

/**
 * Adapt all color values in an SVG string for dark mode.
 * - Inverts neutrals (black strokes become crisp off-white).
 * - Preserves semantic chromatic colors (Modelica red dot, pins, fluid lines).
 * - Optionally makes full-bleed white background bounding-box rectangles transparent.
 */
export function adaptSvgColors(str: string, options?: boolean | DarkModeColorOptions): string {
  const opts: DarkModeColorOptions = typeof options === "boolean" ? { isDark: options } : (options ?? { isDark: true });

  if (opts.isDark === false) return str;

  let out = str;

  // 1. Strip or make transparent full-canvas white bounding-box rectangles if requested
  if (opts.stripBackgroundRects !== false) {
    out = out.replace(FULL_CANVAS_RECT_RE, (match, attrs: string) => {
      // Check if fill is white or near-white
      const fillMatch = attrs.match(/\bfill=["']([^"']+)["']/i);
      if (fillMatch && fillMatch[1]) {
        const fillVal = fillMatch[1].trim().toLowerCase();
        const isWhite =
          fillVal === "#fff" ||
          fillVal === "#ffffff" ||
          fillVal === "white" ||
          fillVal === "rgb(255,255,255)" ||
          fillVal === "rgb(255, 255, 255)";
        if (isWhite) {
          return match.replace(/\bfill=["'][^"']+["']/i, 'fill="none"');
        }
      }
      return match;
    });
  }

  // 2. Adapt all embedded color values
  return out.replace(COLOR_VALUE_RE, (match) => adaptColorForDarkMode(match, opts));
}

/**
 * Backwards-compatible alias for `adaptSvgColors`.
 */
export function invertSvgColors(str: string, isDarkOrOptions?: boolean | DarkModeColorOptions): string {
  return adaptSvgColors(str, isDarkOrOptions);
}
