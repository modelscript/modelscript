// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { lsdynaLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(__dirname, "..");

describe("@modelscript/lsdyna — Declarative @modelscript/dsl WASM Grammar", () => {
  it("defines lsdynaLanguage conforming to @modelscript/dsl Beta-tier spec", () => {
    assert.equal(lsdynaLanguage.name, "lsdyna");
    assert.equal(lsdynaLanguage.maturity, "beta");
    assert.ok(lsdynaLanguage.fileExtensions.includes(".k"));
    assert.ok(lsdynaLanguage.rules["Deck"]);
    assert.ok(lsdynaLanguage.rules["KeywordSection"]);
    assert.ok(lsdynaLanguage.rules["TitleSection"]);
    assert.ok(lsdynaLanguage.rules["NodeSection"]);
    assert.ok(lsdynaLanguage.rules["ElementSolidSection"]);
    assert.ok(lsdynaLanguage.rules["ElementShellSection"]);
    assert.ok(lsdynaLanguage.rules["ElementBeamSection"]);
    assert.ok(lsdynaLanguage.rules["PartSection"]);
    assert.ok(lsdynaLanguage.rules["SectionSolidCard"]);
    assert.ok(lsdynaLanguage.rules["SectionShellCard"]);
    assert.ok(lsdynaLanguage.rules["SectionBeamCard"]);
    assert.ok(lsdynaLanguage.rules["MatElasticCard"]);
    assert.ok(lsdynaLanguage.rules["MatPlasticKinematicCard"]);
    assert.ok(lsdynaLanguage.rules["MatRigidCard"]);
    assert.ok(lsdynaLanguage.rules["BoundarySpcNodeCard"]);
    assert.ok(lsdynaLanguage.rules["BoundarySpcSetCard"]);
    assert.ok(lsdynaLanguage.rules["InitialVelocityCard"]);
    assert.ok(lsdynaLanguage.rules["LoadNodePointCard"]);
    assert.ok(lsdynaLanguage.rules["DefineCurveCard"]);
    assert.ok(lsdynaLanguage.rules["SetNodeListCard"]);
    assert.ok(lsdynaLanguage.rules["ControlTerminationCard"]);
    assert.ok(lsdynaLanguage.rules["ControlTimestepCard"]);
    assert.ok(lsdynaLanguage.rules["DatabaseGlstatCard"]);
    assert.ok(lsdynaLanguage.rules["EndSection"]);
    assert.ok(lsdynaLanguage.rules["Comment"]);
  });

  it("compiles lsdynaLanguage into GLR parse tables & AssemblyScript kernel via buildParser", () => {
    const result = buildParser(lsdynaLanguage as never);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript files");
    assert.ok(result.javascriptWrapper.js.length > 0, "Should emit JS bindings");
  });

  it("has compiled dist/parser.wasm and src-gen/bindings.{js,d.ts} artifacts", () => {
    const wasmPath = path.join(PKG_DIR, "dist", "parser.wasm");
    const bindingsJs = path.join(PKG_DIR, "src-gen", "bindings.js");
    const bindingsDts = path.join(PKG_DIR, "src-gen", "bindings.d.ts");

    assert.ok(fs.existsSync(wasmPath), "Expected dist/parser.wasm");
    assert.ok(fs.statSync(wasmPath).size > 1024, "Expected non-empty parser.wasm");
    assert.ok(fs.existsSync(bindingsJs), "Expected src-gen/bindings.js");
    assert.ok(fs.existsSync(bindingsDts), "Expected src-gen/bindings.d.ts");
  });
});
