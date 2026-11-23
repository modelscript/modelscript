// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { esterelLanguage } from "../src/language.js";

const pkgRoot = path.resolve(new URL("..", import.meta.url).pathname);

describe("Esterel @modelscript/dsl WASM GLR Grammar", () => {
  it("defines formal declarative Esterel grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(esterelLanguage.name, "esterel");
    assert.strictEqual(esterelLanguage.maturity, "beta");
    assert.ok(esterelLanguage.fileExtensions.includes(".strl"));
    assert.ok(esterelLanguage.rules["Program"]);
    assert.ok(esterelLanguage.rules["ModuleDecl"]);
    assert.ok(esterelLanguage.rules["SignalInterfaceDecl"]);
    assert.ok(esterelLanguage.rules["RelationDecl"]);
    assert.ok(esterelLanguage.rules["ParallelStmt"]);
    assert.ok(esterelLanguage.rules["SequenceStmt"]);
    assert.ok(esterelLanguage.rules["PresentStmt"]);
    assert.ok(esterelLanguage.rules["AwaitStmt"]);
    assert.ok(esterelLanguage.rules["AbortStmt"]);
    assert.ok(esterelLanguage.rules["SuspendStmt"]);
    assert.ok(esterelLanguage.rules["TrapStmt"]);
    assert.ok(esterelLanguage.rules["LocalSignalStmt"]);
    assert.ok(esterelLanguage.rules["RunStmt"]);
  });

  it("compiles esterelLanguage into WebAssembly GLR parse tables & AssemblyScript kernel using buildParser", () => {
    const result = buildParser(esterelLanguage as never);
    assert.ok(result);
    assert.ok(result.assemblyScriptFiles.length > 0);
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0);
    assert.ok(result.javascriptWrapper && result.javascriptWrapper.js.length > 0);
  });

  it("materializes dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    assert.ok(fs.existsSync(path.join(pkgRoot, "dist", "parser.wasm")), "dist/parser.wasm should exist");
    assert.ok(fs.existsSync(path.join(pkgRoot, "src-gen", "bindings.js")), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(path.join(pkgRoot, "src-gen", "bindings.d.ts")), "src-gen/bindings.d.ts should exist");
  });
});
