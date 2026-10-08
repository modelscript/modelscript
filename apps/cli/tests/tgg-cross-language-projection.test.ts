// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileTGGRules } from "@modelscript/dsl";
import assert from "node:assert";
import { test } from "node:test";
import { cfdLanguage } from "../../../languages/cfd/src/language.js";
import { feaLanguage } from "../../../languages/fea/src/language.js";
import modelicaConfig from "../../../languages/modelica/src/language.js";
import owl2Config from "../../../languages/owl2/src/language.js";
import { scadLanguage } from "../../../languages/scad/src/language.js";
import sspConfig from "../../../languages/ssp/src/language.js";
import stepConfig from "../../../languages/step/src/language.js";
import sysml2Config from "../../../languages/sysml2/src/language.js";

test("Cross-Language TGG Polyglot Rules across 8 engineering domains", () => {
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
  }

  // 6. Verify OpenSCAD -> SysML2, STEP, & Modelica TGG compilation
  {
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
  }

  // 7. Verify CFD -> Modelica & SysML2 TGG compilation
  {
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
  }

  // 8. Verify FEA -> SysML2 & Modelica TGG compilation
  {
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
  }
});
