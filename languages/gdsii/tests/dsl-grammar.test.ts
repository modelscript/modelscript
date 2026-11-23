// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { gdsiiLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

describe("GDSII @modelscript/dsl Grammar & WASM Parser", () => {
  it("defines declarative GDSII GDT/ASCII grammar rules", () => {
    assert.equal(gdsiiLanguage.name, "gdsii");
    assert.equal(gdsiiLanguage.maturity, "beta");
    assert.ok(gdsiiLanguage.rules["Library"]);
    assert.ok(gdsiiLanguage.rules["Structure"]);
    assert.ok(gdsiiLanguage.rules["BoundaryElement"]);
    assert.ok(gdsiiLanguage.rules["PathElement"]);
    assert.ok(gdsiiLanguage.rules["SrefElement"]);
    assert.ok(gdsiiLanguage.rules["ArefElement"]);
    assert.ok(gdsiiLanguage.rules["TextElement"]);
  });

  it("compiles gdsiiLanguage via buildParser into AssemblyScript GLR parser kernel", () => {
    const result = buildParser(gdsiiLanguage as unknown as Parameters<typeof buildParser>[0]);
    assert.ok(result);
    assert.ok(result.assemblyScriptFiles.length > 0);
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0);
    assert.ok(result.javascriptWrapper && result.javascriptWrapper.js.length > 0);
  });

  it("builds dist/parser.wasm and src-gen/bindings.{js,d.ts} artifacts", () => {
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgRoot, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgRoot, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm must exist");
    assert.ok(fs.statSync(wasmPath).size > 1000, "dist/parser.wasm must be non-empty");
    assert.ok(fs.existsSync(bindingsJs), "src-gen/bindings.js must exist");
    assert.ok(fs.existsSync(bindingsDts), "src-gen/bindings.d.ts must exist");
  });
});
