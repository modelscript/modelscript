// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileTGGRules } from "@modelscript/dsl";
import assert from "node:assert";
import { scadLanguage } from "../src/language.js";

console.log("Testing OpenSCAD Polyglot TGG Rules Compilation...");

assert.ok(scadLanguage.polyglot, "OpenSCAD should define polyglot configuration");
const compiled = compileTGGRules(scadLanguage.polyglot);

assert.strictEqual(compiled.ruleCount, 7, "OpenSCAD should have 7 TGG transformation rules");
assert.ok(compiled.ruleNames.includes("ScadProjectedAreaToModelicaParam"));
assert.ok(compiled.ruleNames.includes("ScadProjectedAreaToSysmlAttribute"));
assert.ok(compiled.ruleNames.includes("ScadModuleToSysmlPart"));
assert.ok(compiled.ruleNames.includes("ScadTagPortToSysmlPort"));
assert.ok(compiled.ruleNames.includes("ScadVariableToSysmlAttribute"));
assert.ok(compiled.ruleNames.includes("ScadSolidToStepProduct"));
assert.ok(compiled.ruleNames.includes("ScadCylinderToStepProduct"));

assert.ok(compiled.sourceCode.includes("export function tgg_forward_ScadModuleToSysmlPart"));
assert.ok(compiled.sourceCode.includes("export function tgg_backward_ScadModuleToSysmlPart"));
assert.ok(compiled.sourceCode.includes("export function tgg_forward_dispatch"));
assert.ok(compiled.sourceCode.includes("export function tgg_backward_dispatch"));

console.log("✔ OpenSCAD Polyglot TGG Rules compiled cleanly!");
