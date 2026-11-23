// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { hec1Language } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

describe("@modelscript/hec1 — DSL Grammar & Native WASM Parser", () => {
  it("defines declarative HEC-1 grammar supporting all 2-char card codes and comment cards", () => {
    assert.equal(hec1Language.name, "hec1");
    assert.equal(hec1Language.maturity, "beta");
    const requiredRules = [
      "Deck",
      "IdCard",
      "ItCard",
      "InCard",
      "IoCard",
      "KkCard",
      "KmCard",
      "KoCard",
      "BaCard",
      "PbCard",
      "PiCard",
      "PcCard",
      "LuCard",
      "LsCard",
      "LeCard",
      "UcCard",
      "UdCard",
      "UsCard",
      "BfCard",
      "RmCard",
      "RsCard",
      "RdCard",
      "HcCard",
      "ZwCard",
      "ZzCard",
      "CommentCard",
    ];
    for (const rule of requiredRules) {
      assert.ok(hec1Language.rules[rule], `Missing grammar rule '${rule}'`);
    }
  });

  it("compiles hec1Language into AssemblyScript GLR parser & JS bindings via buildParser", () => {
    const result = buildParser(hec1Language);
    assert.ok(result, "buildParser should return compilation artifacts");
    assert.ok(result.assemblyScriptFiles.length > 0, "Expected generated AssemblyScript files");
    assert.ok(result.javascriptWrapper.js.length > 0, "Expected generated JS wrapper");
  });

  it("builds dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsJs = path.join(pkgRoot, "src-gen", "bindings.js");
    const bindingsDts = path.join(pkgRoot, "src-gen", "bindings.d.ts");
    assert.ok(fs.existsSync(wasmPath), `Expected built parser.wasm at ${wasmPath}`);
    assert.ok(fs.statSync(wasmPath).size > 0, "Expected non-empty parser.wasm");
    assert.ok(fs.existsSync(bindingsJs), `Expected generated bindings.js at ${bindingsJs}`);
    assert.ok(fs.existsSync(bindingsDts), `Expected generated bindings.d.ts at ${bindingsDts}`);
  });
});
