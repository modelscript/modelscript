// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { modelscriptLanguage } from "../src/language.js";

test("Phase 4: Declarative Polyglot TGG Synchronizer", async (t) => {
  await t.test("registers polyglot target languages and type mappings", () => {
    const polyglot = (modelscriptLanguage as any).polyglot;
    assert.ok(polyglot, "polyglot configuration must exist on language");
    assert.deepEqual(polyglot.languages, ["modelica", "sysml2"]);

    // Type maps
    assert.equal(polyglot.typeMaps.modelica.f64, "Real");
    assert.equal(polyglot.typeMaps.modelica.i32, "Integer");
    assert.equal(polyglot.typeMaps.modelica.bool, "Boolean");

    assert.equal(polyglot.typeMaps.sysml2.f64, "ISQ::Real");
    assert.equal(polyglot.typeMaps.sysml2.i32, "KerML::Integer");
  });

  await t.test("contains declarative TGG rules for bidirectional synchronization", () => {
    const polyglot = (modelscriptLanguage as any).polyglot;
    const rules = polyglot.rules;
    assert.ok(Array.isArray(rules), "rules must be an array");

    const structRule = rules.find((r: any) => r.name === "ModelScriptStructToModelicaRecord");
    assert.ok(structRule, "ModelScriptStructToModelicaRecord rule must be registered");
    assert.equal(structRule.sourceLang, "modelscript");
    assert.equal(structRule.targetLang, "modelica");

    const paramRule = rules.find((r: any) => r.name === "ModelScriptParamToModelicaMod");
    assert.ok(paramRule, "ModelScriptParamToModelicaMod rule must be registered");
    assert.equal(paramRule.sourceLang, "modelscript");
    assert.equal(paramRule.targetLang, "modelica");
  });
});
