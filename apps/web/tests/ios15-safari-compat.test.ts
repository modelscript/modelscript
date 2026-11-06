// SPDX-License-Identifier: AGPL-3.0-or-later

import * as acorn from "acorn";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("iOS 15 / Safari 15 & Legacy Mobile WebKit Compatibility (iPhone 7)", () => {
  const webDir = path.resolve(import.meta.dirname, "..");
  const distDir = path.resolve(webDir, "dist");
  const assetsDir = path.resolve(distDir, "assets");

  it("configures build target in vite.config.ts to support Safari 15 / iOS 15", () => {
    const viteConfigPath = path.resolve(webDir, "vite.config.ts");
    const content = fs.readFileSync(viteConfigPath, "utf-8");
    assert.match(
      content,
      /target:\s*\[.*"safari15".*\]/,
      "vite.config.ts must explicitly include safari15 in build.target so esbuild/rolldown downlevels ES2022+ features (such as class static initialization blocks)",
    );
  });

  it("configures build target in docs config.ts to support Safari 15 / iOS 15", () => {
    const docsConfigPath = path.resolve(webDir, "../docs/docs/.vitepress/config.ts");
    const content = fs.readFileSync(docsConfigPath, "utf-8");
    assert.match(
      content,
      /target:\s*\[.*"safari15".*\]/,
      "docs/.vitepress/config.ts must explicitly include safari15 in build.target so esbuild downlevels ES2022+ features (such as class static initialization blocks)",
    );
  });

  it("ensures index.html preserves min-height: 100vh fallback for browsers without 100dvh support", () => {
    const indexHtmlPath = path.resolve(distDir, "index.html");
    if (!fs.existsSync(indexHtmlPath)) return;
    const content = fs.readFileSync(indexHtmlPath, "utf-8");
    assert.ok(
      content.includes("min-height:100vh") || content.includes("min-height: 100vh"),
      "dist/index.html must maintain min-height: 100vh fallback for Safari < 15.4 (iOS 15.0-15.3)",
    );
  });

  it("ensures no production JavaScript bundle in dist/assets contains regex lookbehind assertions", () => {
    if (!fs.existsSync(assetsDir)) return;
    const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith(".js") && !f.includes("worker"));

    for (const file of files) {
      const code = fs.readFileSync(path.join(assetsDir, file), "utf-8");
      try {
        const ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module" });
        const lookbehindLiterals: string[] = [];

        function walk(node: any) {
          if (!node || typeof node !== "object") return;
          if (node.type === "Literal" && node.regex) {
            const pattern = node.regex.pattern;
            if (pattern.includes("(?<=") || pattern.includes("(?<!")) {
              lookbehindLiterals.push(`/${pattern}/`);
            }
          }
          for (const key of Object.keys(node)) {
            if (key !== "loc") {
              const val = node[key];
              if (Array.isArray(val)) {
                val.forEach(walk);
              } else if (val && typeof val === "object") {
                walk(val);
              }
            }
          }
        }

        walk(ast);

        assert.strictEqual(
          lookbehindLiterals.length,
          0,
          `File ${file} contains regex literal with lookbehind assertion: ${lookbehindLiterals.join(", ")}`,
        );
      } catch (err: any) {
        assert.fail(`Failed to parse ${file} with acorn: ${err.message}`);
      }
    }
  });

  it("ensures no production JavaScript bundle in dist/assets contains class static initialization blocks", () => {
    if (!fs.existsSync(assetsDir)) return;
    const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith(".js") && !f.includes("worker"));

    for (const file of files) {
      const code = fs.readFileSync(path.join(assetsDir, file), "utf-8");
      // Check for `static {` which causes parse-time SyntaxError in Safari < 16.4
      const staticBlockMatch = code.match(/\bclass\b[^{]*\{[^{}]*\bstatic\s*\{/g);
      assert.strictEqual(
        staticBlockMatch,
        null,
        `File ${file} contains class static initialization block 'static { ... }' unsupported on Safari < 16.4 / iOS 15 (iPhone 7): ${staticBlockMatch?.join(", ")}`,
      );
    }
  });

  it("ensures no production JavaScript bundle in docs dist contains class static initialization blocks", () => {
    const docsDistDir = path.resolve(webDir, "../docs/docs/.vitepress/dist/assets");
    if (!fs.existsSync(docsDistDir)) return;
    const getJsFiles = (dir: string): string[] => {
      const results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...getJsFiles(full));
        else if (entry.name.endsWith(".js")) results.push(full);
      }
      return results;
    };
    const files = getJsFiles(docsDistDir);
    for (const file of files) {
      const code = fs.readFileSync(file, "utf-8");
      const staticBlockMatch = code.match(/\bclass\b[^{]*\{[^{}]*\bstatic\s*\{/g);
      assert.strictEqual(
        staticBlockMatch,
        null,
        `Docs bundle ${path.basename(file)} contains class static initialization block 'static { ... }' unsupported on Safari < 16.4 / iOS 15 (iPhone 7): ${staticBlockMatch?.join(", ")}`,
      );
    }
  });
});
