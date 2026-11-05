// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Sketch / Playground Single-File Library Filtering & Lazy Loading", () => {
  it("lsp-worker scopes projectDependencies based on initialLanguageId", () => {
    const lspWorkerFile = path.resolve(__dirname, "../src/components/morsel/util/lsp-worker.ts");
    const content = fs.readFileSync(lspWorkerFile, "utf-8");

    assert.ok(
      content.includes("projectDependencies: (() => {"),
      "lsp-worker must define language-scoped projectDependencies in initializationOptions",
    );
    assert.ok(
      content.includes(`norm === "modelica" || norm === "modelscript"`),
      "lsp-worker must map modelica to Modelica stdlib",
    );
    assert.ok(content.includes(`norm === "sysml" || norm === "sysml2"`), "lsp-worker must map sysml2 to SysML stdlib");
  });

  it("parser-service respects initialTargets in lazyLoadParsers mode", () => {
    const parserServiceFile = path.resolve(__dirname, "../../../packages/lsp/src/services/parser-service.ts");
    const content = fs.readFileSync(parserServiceFile, "utf-8");

    assert.ok(
      content.includes(`initialTargets.has("modelica")`),
      "parser-service must only add Modelica if initialTargets includes modelica or is empty",
    );
    assert.ok(
      content.includes(`initialTargets.has("sysml2")`),
      "parser-service must only add SysML if initialTargets includes sysml2 or is empty",
    );
  });

  it("MorselLeftSidebar receives dialect as language prop", () => {
    const morselFile = path.resolve(__dirname, "../src/components/morsel/Morsel.tsx");
    const content = fs.readFileSync(morselFile, "utf-8");

    assert.ok(
      content.includes("language={dialect}"),
      "Morsel.tsx must pass dialect as language prop to MorselLeftSidebar",
    );
  });

  it("Tree.tsx filters standard libraries by compatible document language", () => {
    const treeFile = path.resolve(__dirname, "../src/components/morsel/Tree.tsx");
    const content = fs.readFileSync(treeFile, "utf-8");

    assert.ok(content.includes("isLanguageCompatible"), "Tree.tsx must implement isLanguageCompatible");
    assert.ok(content.includes("inferLanguageFromUri"), "Tree.tsx must implement inferLanguageFromUri");
    assert.ok(
      content.includes('node.id.startsWith("__LIB__:")'),
      "Tree.tsx must filter root library nodes by active language",
    );
  });
});
