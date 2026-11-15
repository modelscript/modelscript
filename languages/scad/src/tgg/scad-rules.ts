// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const scadTggRules = [
  tggRule({
    name: "ScadModuleToSysmlPart",
    sourceLang: "scad",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ModuleDeclaration"]?.({ name: v("modName") }),
    target: ($, v) => $["PartDefinition"]?.({ declaredName: v("modName") }),
    where: (v) => [tggEq(v("modName"), v("modName")), tggComplement(["parameters", "body"])],
  }),
  tggRule({
    name: "ScadProjectedAreaToModelicaParam",
    sourceLang: "scad",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["AssignStatement"]?.({ name: "projected_area", value: v("areaVal") }),
    target: ($, v) => $["ComponentClause"]?.({ name: "A", defaultValue: v("areaVal") }),
    where: (v) => [
      tggEq(v("areaVal"), v("areaVal")),
      tggReconcilePhysics(v("areaVal"), v("areaVal"), { min: 1e-6, max: 1e4 }),
      tggComplement(["unit"]),
    ],
  }),
  tggRule({
    name: "ScadProjectedAreaToSysmlAttribute",
    sourceLang: "scad",
    targetLang: "sysml2",
    priority: 15,
    source: ($, v) => $["AssignStatement"]?.({ name: "projected_area", value: v("areaVal") }),
    target: ($, v) => $["AttributeUsage"]?.({ declaredName: "projectedArea", defaultValue: v("areaVal") }),
    where: (v) => [
      tggEq(v("areaVal"), v("areaVal")),
      tggReconcilePhysics(v("areaVal"), v("areaVal"), { min: 1e-6, max: 1e4 }),
      tggComplement(["unit"]),
    ],
  }),
  tggRule({
    name: "ScadTagPortToSysmlPort",
    sourceLang: "scad",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["FunctionCall"]?.({ name: "tag_port", arguments: v("portArgs") }),
    target: ($, v) => $["PortUsage"]?.({ declaredName: "cadPort", declaredType: v("portArgs") }),
    where: (v) => [tggEq(v("portArgs"), v("portArgs")), tggComplement(["transform"])],
  }),
  tggRule({
    name: "ScadVariableToSysmlAttribute",
    sourceLang: "scad",
    targetLang: "sysml2",
    priority: 5,
    source: ($, v) => $["AssignStatement"]?.({ name: v("varName"), value: v("varVal") }),
    target: ($, v) => $["AttributeUsage"]?.({ declaredName: v("varName"), defaultValue: v("varVal") }),
    where: (v) => [tggEq(v("varName"), v("varName")), tggEq(v("varVal"), v("varVal"))],
  }),
  tggRule({
    name: "ScadSolidToStepProduct",
    sourceLang: "scad",
    targetLang: "step",
    priority: 5,
    source: ($, v) => $["FunctionCall"]?.({ name: "cube", arguments: v("dims") }),
    target: ($, v) => $["StepEntity"]?.({ entityType: "PRODUCT", name: "ScadSolid", attributes: v("dims") }),
    where: (v) => [tggEq(v("dims"), v("dims")), tggComplement(["center"])],
  }),
  tggRule({
    name: "ScadCylinderToStepProduct",
    sourceLang: "scad",
    targetLang: "step",
    priority: 4,
    source: ($, v) => $["FunctionCall"]?.({ name: "cylinder", arguments: v("dims") }),
    target: ($, v) => $["StepEntity"]?.({ entityType: "PRODUCT", name: "ScadCylinder", attributes: v("dims") }),
    where: (v) => [tggEq(v("dims"), v("dims")), tggComplement(["center", "$fn"])],
  }),
];

export const scadPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica", "step"],
  rules: scadTggRules,
};
