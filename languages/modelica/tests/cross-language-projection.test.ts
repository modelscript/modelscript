import { compileTGGRules } from "@modelscript/language";
import assert from "node:assert";
import sysml2Config from "../../sysml2/src/language.js";
import modelicaConfig from "../language.js";

console.log("Testing Cross-Language TGG Polyglot Rules: Modelica <-> SysML v2...");

// 1. Verify Modelica -> SysML2 TGG compilation
{
  assert.ok(modelicaConfig.polyglot, "Modelica should define polyglot configuration");
  const compiled = compileTGGRules(modelicaConfig.polyglot);
  assert.ok(compiled.ruleCount > 0, "Modelica should have TGG transformation rules");
  assert.ok(compiled.ruleNames.includes("ModelicaModelToSysmlBlock"));
  assert.ok(compiled.ruleNames.includes("ModelicaComponentToSysmlPart"));
  assert.ok(compiled.ruleNames.includes("ModelicaConnectToSysmlConnection"));
  assert.ok(compiled.ruleNames.includes("ModelicaEquationToSysmlConstraint"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_ModelicaModelToSysmlBlock"));
  assert.ok(compiled.sourceCode.includes("export function tgg_backward_ModelicaModelToSysmlBlock"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_dispatch"));
  console.log("  ✔ Modelica TGG rules compilation passed");
}

// 2. Verify SysML2 -> Modelica TGG compilation
{
  assert.ok(sysml2Config.polyglot, "SysML2 should define polyglot configuration");
  const compiled = compileTGGRules(sysml2Config.polyglot);
  assert.ok(compiled.ruleCount > 0, "SysML2 should have TGG transformation rules");
  assert.ok(compiled.ruleNames.includes("PartDefToModelicaModel"));
  assert.ok(compiled.ruleNames.includes("AttributeDefToModelicaRecord"));
  assert.ok(compiled.ruleNames.includes("PortDefToModelicaConnector"));
  assert.ok(compiled.ruleNames.includes("AttributeUsageToModelicaParameter"));
  assert.ok(compiled.ruleNames.includes("PartUsageToModelicaComponent"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_PartDefToModelicaModel"));
  assert.ok(compiled.sourceCode.includes("export function tgg_backward_PartDefToModelicaModel"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_dispatch"));
  console.log("  ✔ SysML v2 TGG rules compilation passed");
}

console.log("=== All Cross-Language TGG Polyglot Tests Passed Cleanly ===");
