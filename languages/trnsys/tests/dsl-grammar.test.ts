// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { trnsysLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

describe("@modelscript/trnsys — DSL WASM GLR Grammar", () => {
  it("defines trnsysLanguage with all TRNSYS .dck control card rules", () => {
    assert.equal(trnsysLanguage.name, "trnsys");
    assert.ok(trnsysLanguage.rules["Deck"]);
    assert.ok(trnsysLanguage.rules["VersionCard"]);
    assert.ok(trnsysLanguage.rules["SimulationCard"]);
    assert.ok(trnsysLanguage.rules["TolerancesCard"]);
    assert.ok(trnsysLanguage.rules["LimitsCard"]);
    assert.ok(trnsysLanguage.rules["DfqCard"]);
    assert.ok(trnsysLanguage.rules["WidthCard"]);
    assert.ok(trnsysLanguage.rules["ListCard"]);
    assert.ok(trnsysLanguage.rules["MapCard"]);
    assert.ok(trnsysLanguage.rules["ConstantsCard"]);
    assert.ok(trnsysLanguage.rules["EquationsCard"]);
    assert.ok(trnsysLanguage.rules["UnitCard"]);
    assert.ok(trnsysLanguage.rules["ParametersCard"]);
    assert.ok(trnsysLanguage.rules["InputsCard"]);
    assert.ok(trnsysLanguage.rules["InputConnection"]);
    assert.ok(trnsysLanguage.rules["DerivativesCard"]);
    assert.ok(trnsysLanguage.rules["AssignCard"]);
    assert.ok(trnsysLanguage.rules["EndCard"]);
    assert.ok(trnsysLanguage.rules["Comment"]);
  });

  it("compiles trnsysLanguage via buildParser and produces dist/parser.wasm + src-gen/bindings", () => {
    const built = buildParser(trnsysLanguage);
    assert.ok(built.assemblyScriptFiles.length > 0);
    assert.ok(built.javascriptWrapper.js.length > 0);

    const wasmPath = path.join(PKG_ROOT, "dist", "parser.wasm");
    const bindingsJs = path.join(PKG_ROOT, "src-gen", "bindings.js");
    const bindingsDts = path.join(PKG_ROOT, "src-gen", "bindings.d.ts");
    assert.ok(fs.existsSync(wasmPath), "Expected dist/parser.wasm to be built");
    assert.ok(fs.existsSync(bindingsJs), "Expected src-gen/bindings.js to be built");
    assert.ok(fs.existsSync(bindingsDts), "Expected src-gen/bindings.d.ts to be built");
    assert.ok(fs.statSync(wasmPath).size > 0);
  });
});
