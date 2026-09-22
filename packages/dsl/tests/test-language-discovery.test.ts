// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
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

    // Verify WASM assets
    assert.ok(result.wasmAssets.length > 0, "Should discover WASM assets");
    const wasmDests = result.wasmAssets.map((a) => a.dest);
    assert.ok(wasmDests.includes("server/dist/modelica.wasm"), "Should include modelica.wasm asset");
    assert.ok(
      wasmDests.includes("server/dist/tree-sitter-modelica.wasm"),
      "Should include backward-compatible tree-sitter-modelica.wasm",
    );

    // Verify manifest
    const manifestModelica = result.manifest.find((m) => m.id === "modelica");
    assert.ok(manifestModelica);
    assert.strictEqual(manifestModelica.wasm, "modelica.wasm");
  });

  it("should handle empty or nonexistent directory gracefully", async () => {
    const result = await discoverWorkspaceLanguages("/nonexistent/languages/path");
    assert.strictEqual(result.languages.length, 0);
    assert.strictEqual(result.wasmAssets.length, 0);
    assert.strictEqual(result.manifest.length, 0);
  });
});
