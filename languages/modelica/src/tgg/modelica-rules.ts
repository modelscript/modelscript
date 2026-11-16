// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  tggComplement,
  tggDefaultVal,
  tggEq,
  tggFieldAlias,
  tggForEach,
  tggPhysicalPort,
  tggRule,
  tggTypeMap,
  type PolyglotConfig,
} from "@modelscript/dsl";

export const modelicaTggRules = [
  tggRule({
    name: "ModelicaModelToSysmlBlock",
    sourceLang: "modelica",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ClassDefinition"]?.({ name: v("className") }),
    target: ($, v) => $["PartDefinition"]?.({ declaredName: v("className") }),
    where: (v) => [
      tggEq(v("className"), v("className")),
      tggFieldAlias("m", "mass"),
      tggDefaultVal(v("isAbstract"), false),
      tggComplement(["isPartial", "encapsulated", "annotations"]),
    ],
  }),
  tggRule({
    name: "ModelicaComponentToSysmlPart",
    sourceLang: "modelica",
    targetLang: "sysml2",
    priority: 10,
    context: ($, v) => ({
      source: $["ClassDefinition"]?.({ name: v("ownerName") }),
      target: $["PartDefinition"]?.({ declaredName: v("ownerName") }),
    }),
    source: ($, v) =>
      $["ComponentClause"]?.({
        name: v("compName"),
        typeSpecifier: v("typeName"),
        modifications: v("mods"),
        dimensions: v("dims"),
      }),
    target: ($, v) =>
      $["PartUsage"]?.({
        declaredName: v("compName"),
        declaredType: v("typeName"),
        redefinedAttributes: v("mods"),
        multiplicity: v("dims"),
      }),
    where: (v) => [
      tggEq(v("compName"), v("compName")),
      tggTypeMap(v("typeName"), v("typeName"), "sysml2"),
      tggEq(v("dims"), v("dims")),
      tggForEach(v("mods"), v("mod"), [tggEq(v("mod"), v("mod"))]),
      tggComplement(["variability", "causality", "binding"]),
    ],
  }),
  tggRule({
    name: "ModelicaPinToSysmlElectricalPort",
    sourceLang: "modelica",
    targetLang: "sysml2",
    priority: 15,
    context: ($, v) => ({
      source: $["ClassDefinition"]?.({ name: v("ownerName") }),
      target: $["PartDefinition"]?.({ declaredName: v("ownerName") }),
    }),
    source: ($, v) => $["ComponentClause"]?.({ name: v("portName"), typeSpecifier: "Pin" }),
    target: ($, v) => $["PortUsage"]?.({ declaredName: v("portName"), declaredType: "ElectricalPort" }),
    where: (v) => [tggEq(v("portName"), v("portName")), tggPhysicalPort(v("v"), v("i"), "electrical")],
  }),
  tggRule({
    name: "ModelicaAssertToSysmlRequirement",
    sourceLang: "modelica",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["AssertStatement"]?.({ condition: v("condExpr"), message: v("reqName") }),
    target: ($, v) => $["RequirementUsage"]?.({ declaredName: v("reqName"), condition: v("condExpr") }),
    where: (v) => [tggEq(v("reqName"), v("reqName")), tggEq(v("condExpr"), v("condExpr"))],
  }),
  tggRule({
    name: "ModelicaConnectToSysmlConnection",
    sourceLang: "modelica",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ConnectClause"]?.({ name: v("connName") }),
    target: ($, v) => $["ConnectionUsage"]?.({ declaredName: v("connName") }),
    where: (v) => [tggEq(v("connName"), v("connName"))],
  }),
  tggRule({
    name: "ModelicaEquationToSysmlConstraint",
    sourceLang: "modelica",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["EquationClause"]?.({ name: v("eqName") }),
    target: ($, v) => $["ConstraintUsage"]?.({ declaredName: v("eqName") }),
    where: (v) => [tggEq(v("eqName"), v("eqName"))],
  }),
];

export const modelicaPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "scad", "step", "reqif", "qif", "pscad", "psse", "owl2", "csv"],
  typeMaps: {
    sysml2: {
      Real: "ISQ::Real",
      Integer: "KerML::Integer",
      Boolean: "KerML::Boolean",
      String: "KerML::String",
    },
    owl2: {
      Real: "xsd:double",
      Integer: "xsd:integer",
      Boolean: "xsd:boolean",
      String: "xsd:string",
    },
    csv: {
      Real: "number",
      Integer: "number",
      Boolean: "boolean",
      String: "string",
    },
  },
  rules: modelicaTggRules,
};
