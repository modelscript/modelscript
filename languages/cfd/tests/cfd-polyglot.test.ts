// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileTGGRules } from "@modelscript/dsl";
import assert from "node:assert";
import { cfdLanguage } from "../src/language.js";

console.log("Testing CFD Polyglot TGG Rules Compilation...");

assert.ok(cfdLanguage.polyglot, "CFD should define polyglot configuration");
const compiled = compileTGGRules(cfdLanguage.polyglot);

assert.strictEqual(compiled.ruleCount, 4, "CFD should have 4 TGG transformation rules");
assert.ok(compiled.ruleNames.includes("CfdInletToModelicaFluidPort"));
assert.ok(compiled.ruleNames.includes("CfdHeatFluxToModelicaHeatPort"));
assert.ok(compiled.ruleNames.includes("CfdMarkerToSysmlPort"));
assert.ok(compiled.ruleNames.includes("CfdDirectiveToSysmlConstraint"));

assert.ok(compiled.sourceCode.includes("export function tgg_forward_CfdInletToModelicaFluidPort"));
assert.ok(compiled.sourceCode.includes("export function tgg_backward_CfdInletToModelicaFluidPort"));
assert.ok(compiled.sourceCode.includes("export function tgg_forward_dispatch"));
assert.ok(compiled.sourceCode.includes("export function tgg_backward_dispatch"));

console.log("✔ CFD Polyglot TGG Rules compiled cleanly!");
