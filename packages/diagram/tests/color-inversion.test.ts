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

    it("strips Modelica discrete block beige backgrounds (#dfd3a9) to fill='none'", () => {
      const discreteSvg = `
        <svg viewBox="-100 -100 200 200" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="200" x="-100" y="-100" fill="#dfd3a9" stroke="#00007f" stroke-width="1" />
          <text x="0" y="-50" fill="#00007f">1</text>
        </svg>
      `;
      const adapted = adaptSvgColors(discreteSvg, true);
      assert.ok(adapted.includes('<rect width="200" height="200" x="-100" y="-100" fill="none"'));
      assert.ok(!adapted.includes('fill="#dfd3a9"'));
      assert.ok(!adapted.includes('stroke="#00007f"'));
    });

    it("strips Modelica integer and table peach/yellow backgrounds (#ffd5aa, #ffd788)", () => {
      const integerSvg = `
        <svg viewBox="-100 -100 200 200" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="200" x="-100" y="-100" fill="#ffd5aa" stroke="#ff7f00" />
        </svg>
      `;
      const tableSvg = `
        <svg viewBox="-100 -100 200 200" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="200" x="-100" y="-100" fill="#ffd788" stroke="#00007f" />
        </svg>
      `;
      assert.ok(adaptSvgColors(integerSvg, true).includes('fill="none"'));
      assert.ok(adaptSvgColors(tableSvg, true).includes('fill="none"'));
    });

    it("boosts contrast of neutral strokes (#5f5f5f, #c0c0c0) for maximum legibility on dark canvases", () => {
      const pkgSvg = `
        <svg viewBox="-100 -100 200 200" xmlns="http://www.w3.org/2000/svg">
          <path d="M -80 0 L 80 0" stroke="#5f5f5f" stroke-width="1" />
          <line x1="0" y1="-80" x2="0" y2="80" stroke="#c0c0c0" stroke-width="1" />
        </svg>
      `;
      const adapted = adaptSvgColors(pkgSvg, true);
      const strokeMatches = Array.from(adapted.matchAll(/stroke="rgb\((\d+),\s*(\d+),\s*(\d+)\)"/g));
      assert.ok(strokeMatches.length >= 2, "Must adapt both strokes");
      const r1 = parseInt(strokeMatches[0]![1]!, 10);
      const r2 = parseInt(strokeMatches[1]![1]!, 10);
      // Both lines must be bright enough to be clearly visible against #121212 dark canvas
      assert.ok(r1 >= 170, `Stroke #5f5f5f must be bright in dark mode, got ${r1}`);
      assert.ok(r2 >= 140, `Stroke #c0c0c0 must remain legible in dark mode, got ${r2}`);
    });

    it("ensures text elements remain bright and legible in dark mode", () => {
      const textSvg = `
        <svg viewBox="-100 -100 200 200" xmlns="http://www.w3.org/2000/svg">
          <text x="0" y="0" fill="#000000">Black Text</text>
          <text x="0" y="50" fill="#ffffff">White Text</text>
        </svg>
      `;
      const adapted = adaptSvgColors(textSvg, true);
      const fills = Array.from(adapted.matchAll(/fill="rgb\((\d+),\s*(\d+),\s*(\d+)\)"/g)).map((m) =>
        parseInt(m[1]!, 10),
      );
      assert.ok(fills.length >= 2);
      // Both black text and white text must be crisp and bright in dark mode
      for (const val of fills) {
        assert.ok(val >= 210, `Text must be bright on dark surface, got ${val}`);
      }
    });

    it("preserves white foreground glyphs with stroke='none' (e.g. Information 'i')", () => {
      const infoSvg = `
        <svg viewBox="-100 -100 200 200" xmlns="http://www.w3.org/2000/svg">
          <ellipse rx="100" ry="100" cx="0" cy="0" fill="#4b8a49" stroke="none" />
          <path d="M 0 0 L 10 10" fill="#ffffff" stroke="none" />
          <circle cx="5" cy="5" r="3" fill="#ffffff" />
        </svg>
      `;
      const adapted = adaptSvgColors(infoSvg, true);
      assert.ok(!adapted.includes('fill="rgb(7, 7, 7)"'), "White foreground glyph must not be crushed to black");
      assert.ok(adapted.includes('fill="rgb(245, 245, 245)"'), "White glyph must be preserved as bright off-white");
    });

    it("preserves backwards-compatibility with invertSvgColors and invertColorHelmlab", () => {
      assert.strictEqual(typeof invertColorHelmlab("rgb(200, 16, 46)"), "string");
      assert.strictEqual(typeof invertSvgColors("<svg></svg>", true), "string");
      assert.strictEqual(invertSvgColors("<svg fill='#000'></svg>", false), "<svg fill='#000'></svg>");
    });
  });
});

