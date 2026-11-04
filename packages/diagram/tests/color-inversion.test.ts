// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { adaptColorForDarkMode, adaptSvgColors, invertColorHelmlab, invertSvgColors } from "../src/color-inversion.js";

describe("Dark Mode Perceptual Color Adaptation Engine", () => {
  describe("Modelica Brand & Semantic Accent Colors (Hue & Chroma Preservation)", () => {
    it("preserves Modelica brand red dot (rgb(200, 16, 46)) with high contrast on dark backgrounds", () => {
      const input = "rgb(200, 16, 46)";
      const adapted = adaptColorForDarkMode(input);
      const m = adapted.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      assert.ok(m, `Expected rgb output, got ${adapted}`);

      const [r, g, b] = [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
      // Red must be dominant and high luminance (not crushed into black/maroon rgb(30, 0, 5))
      assert.ok(r >= 220, `Red channel should be bright, got ${r}`);
      assert.ok(r > g * 2, `Red channel should dominate green, got r=${r}, g=${g}`);
      assert.ok(r > b * 2, `Red channel should dominate blue, got r=${r}, b=${b}`);
      assert.ok(g < 140, `Green channel should remain low, got ${g}`);
    });

    it("preserves electrical domain blue pins (rgb(0, 0, 255)) as luminous cerulean", () => {
      const input = "rgb(0, 0, 255)";
      const adapted = adaptColorForDarkMode(input);
      const m = adapted.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      assert.ok(m, `Expected rgb output, got ${adapted}`);

      const [r, g, b] = [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
      assert.ok(b >= 220, `Blue channel should be bright, got ${b}`);
      assert.ok(b > r, `Blue channel should dominate red, got b=${b}, r=${r}`);
      assert.ok(g > 100, `Green channel should be lifted to maintain cerulean hue contrast, got ${g}`);
    });

    it("preserves warning yellow (rgb(255, 255, 0)) without turning to black", () => {
      const input = "rgb(255, 255, 0)";
      const adapted = adaptColorForDarkMode(input);
      assert.strictEqual(adapted, "rgb(255, 255, 0)");
    });

    it("preserves fluid cyan (rgb(0, 255, 255)) without turning to black", () => {
      const input = "rgb(0, 255, 255)";
      const adapted = adaptColorForDarkMode(input);
      assert.strictEqual(adapted, "rgb(0, 255, 255)");
    });

    it("preserves mechanical/ground green (rgb(0, 128, 0)) as vibrant emerald", () => {
      const input = "rgb(0, 128, 0)";
      const adapted = adaptColorForDarkMode(input);
      const m = adapted.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      assert.ok(m, `Expected rgb output, got ${adapted}`);

      const [r, g, b] = [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
      assert.ok(g >= 180, `Green channel should be bright, got ${g}`);
      assert.ok(g > r * 1.5, `Green should dominate red, got g=${g}, r=${r}`);
      assert.ok(g > b * 1.5, `Green should dominate blue, got g=${g}, b=${b}`);
    });
  });

  describe("Achromatic Neutral Inversion (Black, White, Greys)", () => {
    it("inverts pure black to clean off-white", () => {
      const input = "rgb(0, 0, 0)";
      const adapted = adaptColorForDarkMode(input);
      const m = adapted.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      assert.ok(m);
      const [r, g, b] = [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
      assert.ok(r >= 220 && r <= 245, `Expected off-white around 228-235, got ${r}`);
      assert.strictEqual(r, g);
      assert.strictEqual(g, b);
    });

    it("inverts pure white to dark surface tone", () => {
      const input = "rgb(255, 255, 255)";
      const adapted = adaptColorForDarkMode(input);
      const m = adapted.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      assert.ok(m);
      const [r, g, b] = [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
      assert.ok(r <= 25, `Expected dark charcoal <= 25, got ${r}`);
      assert.strictEqual(r, g);
      assert.strictEqual(g, b);
    });

    it("smoothly inverts mid-grey without crushing to near-black", () => {
      const input = "rgb(128, 128, 128)";
      const adapted = adaptColorForDarkMode(input);
      const m = adapted.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      assert.ok(m);
      const [r, g, b] = [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
      // Previous Helmlab crashed 128 down to 29!
      assert.ok(r >= 80 && r <= 140, `Mid-grey should remain well-balanced, got ${r}`);
      assert.strictEqual(r, g);
      assert.strictEqual(g, b);
    });

    it("supports hex formats (#000, #ffffff, #888888)", () => {
      const black = adaptColorForDarkMode("#000000");
      assert.ok(black.startsWith("rgb("));
      const m = black.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      assert.ok(m && parseInt(m[1]!, 10) >= 220);
    });
  });

  describe("Alpha & Transparency Handling", () => {
    it("preserves alpha channel in rgba() format", () => {
      const input = "rgba(200, 16, 46, 0.65)";
      const adapted = adaptColorForDarkMode(input);
      assert.ok(adapted.startsWith("rgba("), `Expected rgba, got ${adapted}`);
      assert.ok(adapted.endsWith(", 0.65)"), `Expected alpha 0.65 preserved, got ${adapted}`);
    });

    it("preserves alpha channel in 8-digit hex format", () => {
      const input = "#c8102e80";
      const adapted = adaptColorForDarkMode(input);
      assert.ok(adapted.startsWith("rgba("), `Expected rgba, got ${adapted}`);
      const m = adapted.match(/,\s*([\d.]+)\)$/);
      assert.ok(m);
      const alpha = parseFloat(m[1]!);
      assert.ok(Math.abs(alpha - 0.5) < 0.05, `Expected alpha approx 0.5, got ${alpha}`);
    });
  });

  describe("Target Surface Awareness & Options", () => {
    it("returns color unchanged when isDark is false", () => {
      const red = "rgb(200, 16, 46)";
      assert.strictEqual(adaptColorForDarkMode(red, { isDark: false }), red);
      const black = "#000000";
      assert.strictEqual(adaptColorForDarkMode(black, { isDark: false }), black);
    });

    it("adapts contrast based on targetBg", () => {
      const red = "rgb(200, 16, 46)";
      const onBlack = adaptColorForDarkMode(red, { targetBg: "#000000" });
      const onSlate = adaptColorForDarkMode(red, { targetBg: "#1e293b" });
      assert.ok(onBlack.startsWith("rgb("));
      assert.ok(onSlate.startsWith("rgb("));
    });
  });

  describe("SVG Document & Full-Canvas Background Rect Adaptation", () => {
    it("converts Modelica root icon SVG accurately", () => {
      const modelicaSvg = `
        <svg viewBox="-100 -100 200 200" xmlns="http://www.w3.org/2000/svg">
          <polygon fill="rgb(0, 0, 0)" points="-93,10 -73,24 62,-33" />
          <ellipse fill="rgb(200, 16, 46)" cx="40" cy="-37" rx="17" ry="17" />
        </svg>
      `;

      const adaptedSvg = adaptSvgColors(modelicaSvg, true);

      // Polygon black fill should be converted to off-white
      assert.ok(!adaptedSvg.includes('fill="rgb(0, 0, 0)"'));
      assert.ok(adaptedSvg.includes('fill="rgb(232, 232, 232)"') || adaptedSvg.includes('fill="rgb(228, 228, 228)"'));

      // Ellipse red fill should NOT be turned to pitch-black rgb(30, 0, 5)
      assert.ok(!adaptedSvg.includes("rgb(30, 0, 5)"));
      assert.ok(!adaptedSvg.includes("rgb(7, 0, 0)"));
      const redMatch = adaptedSvg.match(/<ellipse\b[^>]*fill="([^"]+)"/);
      assert.ok(redMatch, "Ellipse fill must be present");
      const redVals = redMatch[1]!.match(/\d+/g)?.map(Number);
      assert.ok(redVals && redVals[0]! >= 220, `Red channel should be bright, got ${redMatch[1]}`);
    });

    it("strips full-bleed white background rects to fill='none'", () => {
      const svgWithWhiteBg = `
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="200" fill="#ffffff" stroke="#000000" />
          <path d="M 10 10 L 50 50" stroke="#000000" />
        </svg>
      `;

      const adapted = adaptSvgColors(svgWithWhiteBg, true);
      // Background rect fill should be "none" to seamlessly blend with dark parent card
      assert.ok(adapted.includes('<rect width="200" height="200" fill="none"'));
      // Stroke should be adapted to off-white
      assert.ok(!adapted.includes('stroke="#000000"'));
    });

    it("preserves backwards-compatibility with invertSvgColors and invertColorHelmlab", () => {
      assert.strictEqual(typeof invertColorHelmlab("rgb(200, 16, 46)"), "string");
      assert.strictEqual(typeof invertSvgColors("<svg></svg>", true), "string");
      assert.strictEqual(invertSvgColors("<svg fill='#000'></svg>", false), "<svg fill='#000'></svg>");
    });
  });
});
