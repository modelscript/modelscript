// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  bundleExtension,
  generateLanguageConfiguration,
  generatePackageJson,
  normalizeLanguages,
} from "../src/codegen/ide/extension-generator.js";
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
  assert.strictEqual(pkg.contributes.customEditors.length, 6);
  assert.strictEqual(pkg.contributes.customEditors[0].viewType, "calc.diagramEditor");
  assert.strictEqual(pkg.contributes.customEditors[1].viewType, "minijson.diagramEditor");
  assert.strictEqual(pkg.contributes.customEditors[2].viewType, "modelscript.diagram");
  assert.strictEqual(pkg.contributes.customEditors[3].viewType, "modelscript.fmuViewer");
  assert.strictEqual(pkg.contributes.customEditors[4].viewType, "modelscript.sspViewer");
  assert.strictEqual(pkg.contributes.customEditors[5].viewType, "modelscript.gcodeViewer");
  assert.ok(pkg.contributes.notebooks);
  assert.ok(pkg.contributes.menus["editor/title"]);
  const openDiagMenu = pkg.contributes.menus["editor/title"].find((m: any) => m.command === "modelscript.openDiagram");
  assert.ok(openDiagMenu, "Expected modelscript.openDiagram in editor/title menus");
  assert.strictEqual(
    openDiagMenu.when,
    "editorLangId == calc || resourceLangId == calc || editorLangId == minijson || resourceLangId == minijson",
  );

  const openSourceMenu = pkg.contributes.menus["editor/title"].find(
    (m: any) => m.command === "modelscript.openDiagramSource",
  );
  assert.ok(openSourceMenu, "Expected modelscript.openDiagramSource in editor/title menus");
  assert.ok(!pkg.activationEvents.includes("*"), "Expected '*' to be excluded from activationEvents");
  assert.ok(pkg.activationEvents.includes("onUri"), "Expected 'onUri' in activationEvents");
  assert.strictEqual(pkg.engines.vscode, "^1.90.0");
  assert.strictEqual(pkg.capabilities?.virtualWorkspaces, true);
  assert.strictEqual(pkg.capabilities?.untrustedWorkspaces?.supported, "limited");
  assert.ok(
    pkg.capabilities?.untrustedWorkspaces?.restrictedConfigurations?.includes("modelscript.registry.url"),
    "Expected restrictedConfigurations to include modelscript.registry.url",
  );
  const allConfigProps: Record<string, any> = Object.assign(
    {},
    ...(Array.isArray(pkg.contributes.configuration)
      ? pkg.contributes.configuration.map((c: any) => c.properties || {})
      : [pkg.contributes.configuration?.properties || {}]),
  );
  assert.strictEqual(allConfigProps["modelscript.llm.apiKey"]?.scope, "application");
  assert.strictEqual(allConfigProps["modelscript.cloud.apiKey"]?.scope, "application");
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
    icon: "images/icon.png",
    features: {
      diagramEditor: true,
    },
  });

  const filePaths = files.map((f) => f.path);
  assert.ok(filePaths.includes("package.json"));
  assert.ok(filePaths.includes(".vscodeignore"), "Expected .vscodeignore to be generated");
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
  assert.strictEqual(parsedPkg.icon, "images/icon.png");
  console.log("  ✓ In-memory bundling passed");

  // Test 5: Method 2 - Custom Language Diagram Action Override
  console.log("Test 5: Method 2 - Custom language diagram action override...");
  const customDiagGrammar = language({
    name: "customSysml",
    rules: {
      Model: () => "model",
    },
    actions: [
      {
        id: "open_diagram",
        title: "Custom Diagram View",
        category: "query",
        ui: {
          editorTitle: {
            icon: "$(type-hierarchy)",
            group: "navigation@1",
          },
        },
      },
    ],
  });
  const customNormalized = normalizeLanguages([customDiagGrammar, calcGrammar]);
  const customPkg = generatePackageJson(customNormalized, {
    features: { diagramEditor: true },
  });
  const customEditorTitle = customPkg.contributes.menus["editor/title"];
  // customSysml defined custom action 'open_diagram', so modelscript.openDiagram should only match 'calc'
  const customOpenDiag = customEditorTitle.find((m: any) => m.command === "modelscript.openDiagram");
  assert.ok(customOpenDiag);
  assert.strictEqual(customOpenDiag.when, "editorLangId == calc || resourceLangId == calc");
  // And customSysml's custom action was registered as modelscript.customsysml.open_diagram
  const customActionMenu = customEditorTitle.find((m: any) => m.command === "modelscript.customsysml.open_diagram");
  assert.ok(customActionMenu);
  assert.strictEqual(customActionMenu.group, "navigation@1");
  console.log("  ✓ Custom language diagram action override passed");

  console.log("\nAll Unified Extension Generator tests passed successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
