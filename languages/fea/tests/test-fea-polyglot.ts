import { compileTGGRules } from "@modelscript/dsl";
import assert from "node:assert";
import { feaLanguage } from "../src/language.js";

console.log("Testing FEA Polyglot TGG Rules Compilation...");

assert.ok(feaLanguage.polyglot, "FEA should define polyglot configuration");
const compiled = compileTGGRules(feaLanguage.polyglot);

assert.strictEqual(compiled.ruleCount, 4, "FEA should have 4 TGG transformation rules");
assert.ok(compiled.ruleNames.includes("FeaMaterialToSysmlAttribute"));
assert.ok(compiled.ruleNames.includes("FeaBoundaryFixToModelicaFixed"));
assert.ok(compiled.ruleNames.includes("FeaSpringToModelicaSpring"));
assert.ok(compiled.ruleNames.includes("FeaLoadCaseToSysmlRequirement"));

assert.ok(compiled.sourceCode.includes("export function tgg_forward_FeaMaterialToSysmlAttribute"));
assert.ok(compiled.sourceCode.includes("export function tgg_backward_FeaMaterialToSysmlAttribute"));
assert.ok(compiled.sourceCode.includes("export function tgg_forward_dispatch"));
assert.ok(compiled.sourceCode.includes("export function tgg_backward_dispatch"));

console.log("✔ FEA Polyglot TGG Rules compiled cleanly!");
