// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileTGGRules } from "@modelscript/dsl";
import assert from "node:assert";
import owl2Config from "../../owl2/src/language.js";
import sspConfig from "../../ssp/src/language.js";
import stepConfig from "../../step/src/language.js";
import sysml2Config from "../../sysml2/src/language.js";
import modelicaConfig from "../src/language.js";

console.log("Testing Cross-Language TGG Polyglot Rules across 8 engineering domains...");

// 1. Verify Modelica -> SysML2 TGG compilation
{
  assert.ok(modelicaConfig.polyglot, "Modelica should define polyglot configuration");
  const compiled = compileTGGRules(modelicaConfig.polyglot);
  assert.ok(compiled.ruleCount > 0, "Modelica should have TGG transformation rules");
  assert.ok(compiled.ruleNames.includes("ModelicaModelToSysmlBlock"));
  assert.ok(compiled.ruleNames.includes("ModelicaComponentToSysmlPart"));
  assert.ok(compiled.ruleNames.includes("ModelicaConnectToSysmlConnection"));
  assert.ok(compiled.ruleNames.includes("ModelicaEquationToSysmlConstraint"));
  assert.ok(compiled.ruleNames.includes("ModelicaSimpleEquationToSysmlConstraint"));
  assert.ok(compiled.ruleNames.includes("ModelicaDerEquationToSysmlRateConstraint"));
  assert.ok(compiled.ruleNames.includes("ModelicaAssertToSysmlRequirement"));
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
  assert.ok(compiled.ruleNames.includes("RequirementUsageToModelicaAssert"));
  assert.ok(compiled.ruleNames.includes("SysmlConstraintUsageToModelicaSimpleEquation"));
  assert.ok(compiled.ruleNames.includes("SysmlCalcDefToModelicaFunction"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_PartDefToModelicaModel"));
  assert.ok(compiled.sourceCode.includes("export function tgg_backward_PartDefToModelicaModel"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_dispatch"));
  console.log("  ✔ SysML v2 TGG rules compilation passed");
}

// 3. Verify SSP -> Modelica & SysML2 TGG compilation
{
  assert.ok(sspConfig.polyglot, "SSP should define polyglot configuration");
  const compiled = compileTGGRules(sspConfig.polyglot);
  assert.strictEqual(compiled.ruleCount, 8, "SSP should have 8 TGG transformation rules");
  assert.ok(compiled.ruleNames.includes("SspSystemToModelicaModel"));
  assert.ok(compiled.ruleNames.includes("SspComponentToModelicaComponent"));
  assert.ok(compiled.ruleNames.includes("SspConnectorToModelicaConnector"));
  assert.ok(compiled.ruleNames.includes("SspConnectionToModelicaConnect"));
  assert.ok(compiled.ruleNames.includes("SspSystemToSysmlPackage"));
  assert.ok(compiled.ruleNames.includes("SspComponentToSysmlPart"));
  assert.ok(compiled.ruleNames.includes("SspConnectorToSysmlPort"));
  assert.ok(compiled.ruleNames.includes("SspConnectionToSysmlConnection"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_SspSystemToModelicaModel"));
  assert.ok(compiled.sourceCode.includes("export function tgg_backward_SspSystemToModelicaModel"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_dispatch"));
  console.log("  ✔ SSP TGG rules compilation passed (8 rules: Modelica + SysML v2)");
}

// 4. Verify STEP -> SysML2 & Modelica TGG compilation
{
  assert.ok(stepConfig.polyglot, "STEP should define polyglot configuration");
  const compiled = compileTGGRules(stepConfig.polyglot);
  assert.strictEqual(compiled.ruleCount, 5, "STEP should have 5 TGG transformation rules");
  assert.ok(compiled.ruleNames.includes("StepProductToSysML2Part"));
  assert.ok(compiled.ruleNames.includes("StepPropertyToSysML2Attribute"));
  assert.ok(compiled.ruleNames.includes("StepPlacementToSysML2Port"));
  assert.ok(compiled.ruleNames.includes("StepRevoluteJointToModelicaRevolute"));
  assert.ok(compiled.ruleNames.includes("StepPrismaticJointToModelicaPrismatic"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_StepProductToSysML2Part"));
  assert.ok(compiled.sourceCode.includes("export function tgg_backward_StepProductToSysML2Part"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_dispatch"));
  console.log("  ✔ STEP TGG rules compilation passed (5 rules: SysML v2 + Modelica MultiBody)");
}

// 5. Verify OWL 2 -> SysML2 & Modelica TGG compilation
{
  assert.ok(owl2Config.polyglot, "OWL 2 should define polyglot configuration");
  const compiled = compileTGGRules(owl2Config.polyglot);
  assert.strictEqual(compiled.ruleCount, 5, "OWL 2 should have 5 TGG transformation rules");
  assert.ok(compiled.ruleNames.includes("OWL2ClassToSysML2Part"));
  assert.ok(compiled.ruleNames.includes("OWL2SubClassToSysML2Specialization"));
  assert.ok(compiled.ruleNames.includes("OWL2ObjectPropertyToSysML2Port"));
  assert.ok(compiled.ruleNames.includes("OWL2DataPropertyToSysML2Attribute"));
  assert.ok(compiled.ruleNames.includes("OWL2ClassToModelicaModel"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_OWL2ClassToSysML2Part"));
  assert.ok(compiled.sourceCode.includes("export function tgg_backward_OWL2ClassToSysML2Part"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_dispatch"));
  console.log("  ✔ OWL 2 TGG rules compilation passed (5 rules: SysML v2 + Modelica)");
}

// 6. Verify OpenSCAD -> SysML2, STEP, & Modelica TGG compilation
{
  const { scadLanguage } = await import("../../scad/src/language.js");
  assert.ok(scadLanguage.polyglot, "OpenSCAD should define polyglot configuration");
  const compiled = compileTGGRules(scadLanguage.polyglot);
  assert.strictEqual(compiled.ruleCount, 11, "OpenSCAD should have 11 TGG transformation rules");
  assert.ok(compiled.ruleNames.includes("ScadModuleToSysmlPart"));
  assert.ok(compiled.ruleNames.includes("ScadTagPortToSysmlPort"));
  assert.ok(compiled.ruleNames.includes("ScadVariableToSysmlAttribute"));
  assert.ok(compiled.ruleNames.includes("ScadSolidToStepProduct"));
  assert.ok(compiled.ruleNames.includes("ScadCylinderToStepProduct"));
  assert.ok(compiled.ruleNames.includes("ScadSphereToStepProduct"));
  assert.ok(compiled.ruleNames.includes("ScadBooleanOpToStepComposite"));
  assert.ok(compiled.ruleNames.includes("ScadTagPortToModelicaFrame"));
  assert.ok(compiled.ruleNames.includes("ScadCubeToMultiBodyShape"));
  assert.ok(compiled.ruleNames.includes("ScadCylinderToMultiBodyShape"));
  assert.ok(compiled.ruleNames.includes("ScadSphereToMultiBodyShape"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_ScadModuleToSysmlPart"));
  assert.ok(compiled.sourceCode.includes("export function tgg_backward_ScadModuleToSysmlPart"));
  assert.ok(compiled.sourceCode.includes("export function tgg_forward_dispatch"));
  console.log("  ✔ OpenSCAD TGG rules compilation passed (11 rules: SysML v2 + STEP + Modelica)");
}

// 7. Verify CFD -> Modelica & SysML2 TGG compilation
{
  const { cfdLanguage } = await import("../../cfd/src/language.js");
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
  console.log("  ✔ CFD TGG rules compilation passed (4 rules: Modelica + SysML v2)");
}

// 8. Verify FEA -> SysML2 & Modelica TGG compilation
{
  const { feaLanguage } = await import("../../fea/src/language.js");
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
  console.log("  ✔ FEA TGG rules compilation passed (4 rules: SysML v2 + Modelica)");
}

console.log("=== All Cross-Language TGG Polyglot Tests (8 Domains) Passed Cleanly ===");
