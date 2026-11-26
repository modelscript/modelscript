// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, "../src");

function extractCssVarPx(cssBlock: string, varName: string): number {
  const match = cssBlock.match(new RegExp(`${varName}\\s*:\\s*(\\d+(?:\\.\\d+)?)px\\s*;`));
  assert.ok(match, `Expected CSS variable ${varName} with a px value in block`);
  return Number(match[1]);
}

describe("Phase 4 Workstream 3: Working Compact Density & UI Font Scale in Settings", () => {
  const indexCss = fs.readFileSync(path.join(WEB_SRC_DIR, "index.css"), "utf-8");
  const settingsStyles = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/settings/settingsStyles.ts"), "utf-8");

  describe("index.css density spacing tokens", () => {
    const rootBlocks = Array.from(indexCss.matchAll(/:root\s*\{([^}]*)\}/g)).map((m) => m[1] ?? "");
    const combinedRootVars = rootBlocks.join("\n");

    const compactMatch = indexCss.match(/html\[data-density="compact"\]\s*\{([^}]*)\}/);
    const compactBlock = compactMatch?.[1] ?? "";

    it("defines default --space-* and --settings-* spacing tokens on :root", () => {
      assert.equal(extractCssVarPx(combinedRootVars, "--space-xs"), 4);
      assert.equal(extractCssVarPx(combinedRootVars, "--space-sm"), 8);
      assert.equal(extractCssVarPx(combinedRootVars, "--space-md"), 16);
      assert.equal(extractCssVarPx(combinedRootVars, "--space-lg"), 24);
      assert.equal(extractCssVarPx(combinedRootVars, "--settings-item-py"), 16);
      assert.equal(extractCssVarPx(combinedRootVars, "--settings-item-px"), 16);
      assert.equal(extractCssVarPx(combinedRootVars, "--settings-card-p"), 16);
    });

    it('overrides all spacing tokens with strictly tighter values under html[data-density="compact"]', () => {
      assert.ok(compactMatch, 'index.css must define html[data-density="compact"] block');

      const tokens: Array<[string, number]> = [
        ["--space-xs", 2],
        ["--space-sm", 5],
        ["--space-md", 10],
        ["--space-lg", 14],
        ["--settings-item-py", 10],
        ["--settings-item-px", 12],
        ["--settings-card-p", 12],
      ];

      for (const [token, expectedCompactPx] of tokens) {
        const defaultPx = extractCssVarPx(combinedRootVars, token);
        const compactPx = extractCssVarPx(compactBlock, token);
        assert.equal(compactPx, expectedCompactPx, `Compact density ${token} should be ${expectedCompactPx}px`);
        assert.ok(
          compactPx < defaultPx,
          `Compact density ${token} (${compactPx}px) must be tighter than :root default (${defaultPx}px)`,
        );
      }
    });
  });

  describe("settingsStyles.ts density consumption & rem font scaling", () => {
    it("consumes --settings-item-py, --settings-item-px, and --space-* variables", () => {
      assert.ok(
        settingsStyles.includes("var(--settings-item-py, 16px)"),
        "settingsStyles.ts must consume var(--settings-item-py, 16px)",
      );
      assert.ok(
        settingsStyles.includes("var(--settings-item-px, 16px)"),
        "settingsStyles.ts must consume var(--settings-item-px, 16px)",
      );
      assert.ok(settingsStyles.includes("var(--space-sm, 8px)"), "settingsStyles.ts must consume var(--space-sm, 8px)");
      assert.ok(
        settingsStyles.includes("var(--space-md, 16px)"),
        "settingsStyles.ts must consume var(--space-md, 16px)",
      );
      assert.ok(settingsStyles.includes("var(--space-xs, 4px)"), "settingsStyles.ts must consume var(--space-xs, 4px)");
    });

    it("uses rem font-size units so root fontScale scales typography proportionally", () => {
      assert.ok(settingsStyles.includes("font-size: var(--text-xl, 1.25rem);"), "Header should use 1.25rem fallback");
      assert.ok(settingsStyles.includes("font-size: 0.9375rem;"), "DetailTitle and FormInput should use 0.9375rem");
      assert.ok(settingsStyles.includes("font-size: 0.875rem;"), "Buttons should use 0.875rem");
      assert.ok(settingsStyles.includes("font-size: 0.8125rem;"), "DetailSubtitle and FormLabel should use 0.8125rem");
    });

    it("does not contain any hardcoded px font-size declarations", () => {
      const hardcodedPxFontSizes = settingsStyles.match(/font-size\s*:[^;\n]*\b\d+(?:\.\d+)?px\b/g);
      assert.equal(
        hardcodedPxFontSizes,
        null,
        `settingsStyles.ts must not have hardcoded px font-size values, found: ${JSON.stringify(hardcodedPxFontSizes)}`,
      );
    });
  });
});
