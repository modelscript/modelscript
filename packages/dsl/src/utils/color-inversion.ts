// SPDX-License-Identifier: AGPL-3.0-or-later

import { Helmlab } from "helmlab";

const hl = new Helmlab();

/** Multiplicative brightness boost applied in sRGB after L-inversion. */
const BRIGHTNESS_BOOST = 2.25;

/** Clamp and round to 0-255. */
function clamp255(v: number): number {
  return Math.round(Math.max(0, Math.min(255, v)));
}

/**
 * Invert a CSS color using Helmlab lightness inversion.
 * Handles rgb(), #rrggbb, and #rgb formats.
 * L is flipped (1 - L) in Helmlab space, then brightness is
 * boosted in sRGB to avoid hue shifts from Lab-space manipulation.
 * Helmlab accounts for the Helmholtz-Kohlrausch effect and
 * has better dark-region perceptual uniformity than CIELAB.
 */
const helmlabCache = new Map<string, string>();

export function invertColorHelmlab(color: string): string {
  const cached = helmlabCache.get(color);
  if (cached !== undefined) return cached;

  let result = color;

  // Try rgb() format
  const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgbMatch) {
    const rs = rgbMatch[1] ?? "0";
    const gs = rgbMatch[2] ?? "0";
    const bs = rgbMatch[3] ?? "0";
    const [L, a, b] = hl.fromSrgb([+rs / 255, +gs / 255, +bs / 255]);
    const [r2, g2, b2] = hl.toSrgb([1 - L, a, b]);
    result = `rgb(${clamp255(r2 * 255 * BRIGHTNESS_BOOST)}, ${clamp255(g2 * 255 * BRIGHTNESS_BOOST)}, ${clamp255(b2 * 255 * BRIGHTNESS_BOOST)})`;
    helmlabCache.set(color, result);
    return result;
  }
  // Try #rrggbb or #rgb hex format
  const hexMatch = color.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hexMatch) {
    let hex = hexMatch[1] ?? "";
    if (hex.length === 3) {
      hex = (hex[0] ?? "") + (hex[0] ?? "") + (hex[1] ?? "") + (hex[1] ?? "") + (hex[2] ?? "") + (hex[2] ?? "");
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const bv = parseInt(hex.slice(4, 6), 16) / 255;
      const [L, a, b] = hl.fromSrgb([r, g, bv]);
      const [r2, g2, b2] = hl.toSrgb([1 - L, a, b]);
      result = `rgb(${clamp255(r2 * 255 * BRIGHTNESS_BOOST)}, ${clamp255(g2 * 255 * BRIGHTNESS_BOOST)}, ${clamp255(b2 * 255 * BRIGHTNESS_BOOST)})`;
    }
  }

  helmlabCache.set(color, result);
  return result;
}

/** Regex that matches rgb() or hex color values. */
const COLOR_VALUE_RE = /rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|#[0-9a-fA-F]{3,8}\b/g;

/** Invert all color values (rgb() and hex) in a string using Helmlab. */
export function invertSvgColors(str: string, isDark: boolean): string {
  if (!isDark) return str;
  return str.replace(COLOR_VALUE_RE, (match) => invertColorHelmlab(match));
}
