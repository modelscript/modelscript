// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { nec2Language } from "../src/language.js";

describe("@modelscript/nec2 DSL Grammar & WASM Parser", () => {
  it("defines declarative nec2Language conforming to @modelscript/dsl spec", () => {
    assert.strictEqual(nec2Language.name, "nec2");
    assert.strictEqual(nec2Language.maturity, "beta");
    assert.ok(nec2Language.fileExtensions.includes(".nec"));
    assert.ok(nec2Language.rules);
    assert.ok(nec2Language.rules["Deck"]);
    assert.ok(nec2Language.rules["CommentCard"]);
    assert.ok(nec2Language.rules["CommentEndCard"]);
    assert.ok(nec2Language.rules["SymbolicCard"]);
    assert.ok(nec2Language.rules["WireCard"]);
    assert.ok(nec2Language.rules["ArcCard"]);
    assert.ok(nec2Language.rules["HelixCard"]);
    assert.ok(nec2Language.rules["GeometryEndCard"]);
    assert.ok(nec2Language.rules["FrequencyCard"]);
    assert.ok(nec2Language.rules["ExcitationCard"]);
    assert.ok(nec2Language.rules["LoadCard"]);
    assert.ok(nec2Language.rules["GroundCard"]);
    assert.ok(nec2Language.rules["RadiationPatternCard"]);
    assert.ok(nec2Language.rules["ExecuteCard"]);
    assert.ok(nec2Language.rules["EndCard"]);
  });

  it("compiles nec2Language into WebAssembly GLR parser tables via buildParser", () => {
    const result = buildParser(nec2Language);
    assert.ok(result, "buildParser should succeed for nec2Language");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript parser kernel");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should emit JS tree bindings");
  });

  it("materializes dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const pkgRoot = path.resolve(new URL("..", import.meta.url).pathname);
    assert.ok(fs.existsSync(path.join(pkgRoot, "dist", "parser.wasm")), "dist/parser.wasm should exist");
    assert.ok(fs.existsSync(path.join(pkgRoot, "src-gen", "bindings.js")), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(path.join(pkgRoot, "src-gen", "bindings.d.ts")), "src-gen/bindings.d.ts should exist");
  });
});
