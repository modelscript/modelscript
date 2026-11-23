// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { irig106Language } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

describe("@modelscript/irig106 WASM GLR Grammar & Language Spec", () => {
  it("defines formal declarative IRIG 106 TMATS grammar conforming to @modelscript/dsl", () => {
    assert.strictEqual(irig106Language.name, "irig106");
    assert.strictEqual(irig106Language.maturity, "beta");
    assert.deepStrictEqual(irig106Language.fileExtensions, [".tmats", ".tmt", ".tma"]);
    assert.ok(irig106Language.ui?.panels?.length === 1);
    assert.strictEqual(irig106Language.ui?.panels?.[0]?.entry, "./src/ui/Irig106Panel.tsx");
    assert.ok(irig106Language.rules["TmatsFile"]);
    assert.ok(irig106Language.rules["GeneralAttribute"]);
    assert.ok(irig106Language.rules["GroupAttribute"]);
    assert.ok(irig106Language.rules["CommentAttribute"]);
  });

  it("compiles irig106Language grammar into WebAssembly GLR parse tables via buildParser", () => {
    const result = buildParser(irig106Language as unknown as Parameters<typeof buildParser>[0]);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should generate AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0, "Should generate parser.ts");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should generate JS wrapper");
  });

  it("produces built dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgRoot, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgRoot, "src-gen", "bindings.d.ts");
    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.statSync(wasmPath).size > 0, "dist/parser.wasm should be non-empty");
    assert.ok(fs.existsSync(bindingsJs), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(bindingsDts), "src-gen/bindings.d.ts should exist");
  });
});
