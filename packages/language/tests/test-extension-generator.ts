// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  bundleExtension,
  generateLanguageConfiguration,
  generatePackageJson,
  normalizeLanguages,
} from "../src/codegen/extension-generator.js";
import { choice, language, seq } from "../src/dsl/index.js";

async function main() {
  console.log("=== Testing Unified VS Code Extension Generator ===");

  const calcGrammar = language({
    name: "calc",
    rules: {
      Expression: ($: any) => choice($.Number, $.BinaryExpr),
      Number: () => /\d+/,
      BinaryExpr: ($: any) => seq($.Expression, "+", $.Expression),
    },
    primitives: {
      lineComment: "#",
      nestedComment: { open: "/*", close: "*/" },
    },
    lsp: {
      fileExtension: ".calc",
    },
  });

  const jsonGrammar = language({
    name: "miniJson",
    rules: {
      Value: ($: any) => choice($.String, $.Number),
      String: () => /"[^"]*"/,
      Number: () => /\d+/,
    },
    lsp: {
      fileExtensions: [".mjson", ".minijson"],
    },
  });

  // Test 1: Normalize Languages
  console.log("Test 1: Normalize language descriptors...");
  const normalized = normalizeLanguages([calcGrammar, jsonGrammar]);
  assert.strictEqual(normalized.length, 2);
  const lang0 = normalized[0];
  const lang1 = normalized[1];
  assert.ok(lang0);
  assert.ok(lang1);
  assert.strictEqual(lang0.id, "calc");
  assert.deepStrictEqual(lang0.fileExtensions, [".calc"]);
  assert.strictEqual(lang0.lineComment, "#");
  assert.strictEqual(lang1.id, "minijson");
  assert.deepStrictEqual(lang1.fileExtensions, [".mjson", ".minijson"]);
  console.log("  ✓ Normalization passed");

  // Test 2: Package JSON Generation
  console.log("Test 2: Manifest (package.json) generation...");
  const pkg = generatePackageJson(normalized, {
    name: "custom-polyglot-suite",
    displayName: "Custom Polyglot Suite",
    version: "2.0.0",
    features: {
      diagramEditor: true,
      notebooks: true,
    },
  });

  assert.strictEqual(pkg.name, "custom-polyglot-suite");
  assert.strictEqual(pkg.displayName, "Custom Polyglot Suite");
  assert.strictEqual(pkg.version, "2.0.0");
  assert.strictEqual(pkg.browser, "./dist/extension.js");
  assert.strictEqual(pkg.contributes.languages.length, 2);
  assert.strictEqual(pkg.contributes.languages[0].id, "calc");
  assert.strictEqual(pkg.contributes.languages[1].id, "minijson");
  assert.strictEqual(pkg.contributes.customEditors.length, 2);
  assert.strictEqual(pkg.contributes.customEditors[0].viewType, "calc.diagramEditor");
  assert.strictEqual(pkg.contributes.customEditors[1].viewType, "minijson.diagramEditor");
  assert.ok(pkg.contributes.notebooks);
  console.log("  ✓ Manifest generation passed");

  // Test 3: Language Configuration
  console.log("Test 3: Language configuration JSON generation...");
  const configStr = generateLanguageConfiguration(lang0);
  const config = JSON.parse(configStr);
  assert.strictEqual(config.comments.lineComment, "#");
  assert.deepStrictEqual(config.comments.blockComment, ["/*", "*/"]);
  assert.strictEqual(config.brackets.length, 3);
  console.log("  ✓ Language configuration passed");

  // Test 4: Full In-Memory Extension Bundling
  console.log("Test 4: In-memory virtual extension bundling...");
  const files = bundleExtension([calcGrammar, jsonGrammar], {
    name: "test-suite",
    features: {
      diagramEditor: true,
    },
  });

  const filePaths = files.map((f) => f.path);
  assert.ok(filePaths.includes("package.json"));
  assert.ok(filePaths.includes("tsconfig.json"));
  assert.ok(filePaths.includes("src/extension.ts"));
  assert.ok(filePaths.includes("language-configuration-calc.json"));
  assert.ok(filePaths.includes("language-configuration-minijson.json"));
  assert.ok(filePaths.includes("syntaxes/calc.tmLanguage.json"));
  assert.ok(filePaths.includes("syntaxes/minijson.tmLanguage.json"));

  const packageJsonFile = files.find((f) => f.path === "package.json");
  assert.ok(packageJsonFile);
  const parsedPkg = JSON.parse(
    typeof packageJsonFile.content === "string"
      ? packageJsonFile.content
      : new TextDecoder().decode(packageJsonFile.content),
  );
  assert.strictEqual(parsedPkg.name, "test-suite");
  console.log("  ✓ In-memory bundling passed");

  console.log("\nAll Unified Extension Generator tests passed successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
