// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { edifLanguage } from "../src/language.js";

const pkgRoot = path.resolve(new URL("..", import.meta.url).pathname);

describe("@modelscript/edif DSL Grammar & WASM Parser Suite", () => {
  it("defines declarative EDIF 2.0.0 grammar conforming to @modelscript/dsl spec", () => {
    assert.strictEqual(edifLanguage.name, "edif");
    assert.strictEqual(edifLanguage.maturity, "beta");
    assert.deepStrictEqual(edifLanguage.fileExtensions, [".edf", ".edif", ".edn"]);

    const requiredRules = [
      "EdifFile",
      "EdifVersion",
      "EdifLevel",
      "KeywordMap",
      "Status",
      "External",
      "Library",
      "Technology",
      "Cell",
      "CellType",
      "View",
      "ViewType",
      "Interface",
      "Port",
      "Direction",
      "Contents",
      "Instance",
      "ViewRef",
      "CellRef",
      "LibraryRef",
      "Net",
      "Joined",
      "PortRef",
      "InstanceRef",
      "Property",
      "Design",
      "Rename",
    ];
    for (const r of requiredRules) {
      assert.ok(edifLanguage.rules[r], `Expected rule '${r}' in edifLanguage`);
    }
  });

  it("compiles edifLanguage into WebAssembly GLR parse tables & JS wrappers via buildParser", () => {
    const result = buildParser(edifLanguage);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0, "Should emit parser.ts");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should emit JS wrapper");
  });

  it("produces dist/parser.wasm and src-gen/bindings.{js,d.ts} artifacts", () => {
    assert.ok(fs.existsSync(path.join(pkgRoot, "dist", "parser.wasm")), "dist/parser.wasm must exist");
    assert.ok(fs.existsSync(path.join(pkgRoot, "src-gen", "bindings.js")), "src-gen/bindings.js must exist");
    assert.ok(fs.existsSync(path.join(pkgRoot, "src-gen", "bindings.d.ts")), "src-gen/bindings.d.ts must exist");
  });
});
