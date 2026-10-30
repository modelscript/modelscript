// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { generatePackageJson } from "../src/codegen/ide/extension-generator.js";
import { discoverWorkspaceLanguages } from "../src/codegen/ide/language-discovery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const languagesDir = path.resolve(__dirname, "../../../languages");

describe("Workspace Language Discovery & Extension Generator", () => {
  it("should discover all workspace languages from the languages/ directory", async () => {
    const result = await discoverWorkspaceLanguages(languagesDir);
    assert.ok(result.languages.length >= 6, `Expected at least 6 languages, found ${result.languages.length}`);

    const ids = result.languages.map((l) => l.id);
    assert.ok(ids.includes("modelica"), "Should discover modelica");
    assert.ok(ids.includes("sysml2"), "Should discover sysml2");
    assert.ok(ids.includes("step"), "Should discover step");
    assert.ok(ids.includes("owl2"), "Should discover owl2");
    assert.ok(ids.includes("csv"), "Should discover csv");
    assert.ok(ids.includes("scad"), "Should discover scad");

    // Verify modelica extensions
    const modelica = result.languages.find((l) => l.id === "modelica")!;
    assert.ok(modelica.fileExtensions.includes(".mo"));

    // Verify sysml2 extensions
    const sysml2 = result.languages.find((l) => l.id === "sysml2")!;
    assert.ok(sysml2.fileExtensions.includes(".sysml") || sysml2.fileExtensions.includes(".sysml2"));

    // Verify WASM assets (if pre-compiled parser binary exists)
    const hasModelicaWasm = [
      path.join(languagesDir, "modelica", "dist", "parser.wasm"),
      path.join(languagesDir, "modelica", "parser.wasm"),
      path.join(languagesDir, "modelica", ".cache", "parser.wasm"),
      path.join(languagesDir, "modelica", "build", "parser.wasm"),
    ].some((p) => fs.existsSync(p));

    if (hasModelicaWasm) {
      assert.ok(result.wasmAssets.length > 0, "Should discover WASM assets");
      const wasmDests = result.wasmAssets.map((a) => a.dest);
      assert.ok(wasmDests.includes("server/dist/modelica.wasm"), "Should include modelica.wasm asset");

      // Verify manifest
      const manifestModelica = result.manifest.find((m) => m.id === "modelica");
      assert.ok(manifestModelica);
      assert.strictEqual(manifestModelica.wasm, "modelica.wasm");
    }

    // Verify generated VS Code extension manifest
    const pkg = generatePackageJson(result.languages, {
      name: "modelscript-ide",
      displayName: "ModelScript",
      version: "0.1.0",
      publisher: "modelscript",
    });

    // 1. Never hijack .ts (TypeScript)
    for (const lang of pkg.contributes.languages) {
      assert.ok(!lang.extensions.includes(".ts"), `Language '${lang.id}' must not claim TypeScript extension '.ts'`);
    }

    // 2. Submenu for overflow editor title actions exists
    assert.ok(
      pkg.contributes.submenus?.some((s: any) => s.id === "modelscript.editorTitle.moreActions"),
      "Should contribute modelscript.editorTitle.moreActions submenu",
    );

    // 3. Diagram editors only contributed for supported languages + custom editors for lps/sima/gtsuite
    const customEditorTypes = new Set(pkg.contributes.customEditors.map((ce: any) => ce.viewType));
    assert.ok(customEditorTypes.has("modelica.diagramEditor"));
    assert.ok(customEditorTypes.has("sysml2.diagramEditor"));
    assert.ok(customEditorTypes.has("modelscript.lpsEditor"));
    assert.ok(customEditorTypes.has("modelscript.simaEditor"));
    assert.ok(customEditorTypes.has("modelscript.gtsuiteEditor"));
    assert.ok(customEditorTypes.has("touchstone.diagramEditor"));
    assert.ok(!customEditorTypes.has("smv.diagramEditor"));

    // 4. Categorized configuration with per-language maturity labels and toggles
    const configSections = pkg.contributes.configuration as any[];
    assert.ok(Array.isArray(configSections) && configSections.length >= 7);
    const langSection = configSections.find((s: any) => s.title?.includes("Languages")) ?? configSections[0];
    const langProps = langSection.properties;
    assert.ok(langProps["modelscript.languages.maturityTier"]);
    assert.ok(langProps["modelscript.languages.modelica.enabled"]);
    assert.ok(
      langProps["modelscript.languages.modelica.enabled"].markdownDescription.includes("🟢 Stable"),
      "Modelica should be labeled 🟢 Stable",
    );
    assert.ok(
      langProps["modelscript.languages.fea.enabled"].markdownDescription.includes("🟡 Beta"),
      "FEA should be labeled 🟡 Beta",
    );
    assert.ok(
      langProps["modelscript.languages.touchstone.enabled"].markdownDescription.includes("🧪 Experimental"),
      "Touchstone should be labeled 🧪 Experimental",
    );
  });

  it("should handle empty or nonexistent directory gracefully", async () => {
    const result = await discoverWorkspaceLanguages("/nonexistent/languages/path");
    assert.strictEqual(result.languages.length, 0);
    assert.strictEqual(result.wasmAssets.length, 0);
    assert.strictEqual(result.manifest.length, 0);
  });
});
