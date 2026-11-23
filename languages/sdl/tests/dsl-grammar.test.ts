// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { sdlLanguage } from "../src/language.js";

describe("SDL-88 @modelscript/dsl Grammar & WASM Parser", () => {
  it("defines declarative SDL-88 grammar conforming to @modelscript/dsl language spec", () => {
    assert.strictEqual(sdlLanguage.name, "sdl");
    assert.strictEqual(sdlLanguage.maturity, "beta");
    assert.ok(sdlLanguage.fileExtensions.includes(".sdl"));
    assert.ok(sdlLanguage.fileExtensions.includes(".pr"));
    assert.ok(sdlLanguage.rules["Specification"]);
    assert.ok(sdlLanguage.rules["SystemDef"]);
    assert.ok(sdlLanguage.rules["BlockDef"]);
    assert.ok(sdlLanguage.rules["ProcessDef"]);
    assert.ok(sdlLanguage.rules["ChannelDef"]);
    assert.ok(sdlLanguage.rules["SignalRouteDef"]);
    assert.ok(sdlLanguage.rules["ConnectDef"]);
    assert.ok(sdlLanguage.rules["StateDef"]);
    assert.ok(sdlLanguage.rules["DecisionAction"]);
  });

  it("compiles SDL-88 grammar via buildParser into AssemblyScript GLR kernel and JS bindings", () => {
    const result = buildParser(sdlLanguage as never);
    assert.ok(result);
    assert.ok(result.assemblyScriptFiles.length > 0);
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile);
    assert.ok(parserFile.content.length > 0);
    assert.ok(result.javascriptWrapper);
    assert.ok(result.javascriptWrapper.js.length > 0);
  });

  it("emits dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const pkgRoot = path.resolve(new URL("..", import.meta.url).pathname);
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgRoot, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgRoot, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist after build");
    assert.ok(fs.statSync(wasmPath).size > 1000, "dist/parser.wasm should be non-empty");
    assert.ok(fs.existsSync(bindingsJs), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(bindingsDts), "src-gen/bindings.d.ts should exist");
  });
});
