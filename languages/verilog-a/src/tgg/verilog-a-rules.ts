// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const verilogATggRules = [
  tggRule({
    name: "VerilogAModuleToModelicaModel",
    sourceLang: "verilog-a",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["ModuleDeclaration"]?.({ name: v("modName") }),
    target: ($, v) => $["ClassDefinition"]?.({ name: v("modName"), classKind: "model" }),
    where: (v) => [tggEq(v("modName"), v("modName")), tggComplement(["ports", "discipline"])],
  }),
  tggRule({
    name: "VerilogAParameterToModelicaParam",
    sourceLang: "verilog-a",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["ParameterDeclaration"]?.({ name: v("paramName"), defaultValue: v("val") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("paramName"), typeSpecifier: "Real", defaultValue: v("val") }),
    where: (v) => [
      tggEq(v("paramName"), v("paramName")),
      tggEq(v("val"), v("val")),
      tggReconcilePhysics(v("val"), v("val"), { min: -1e12, max: 1e12 }),
      tggComplement(["range"]),
    ],
  }),
  tggRule({
    name: "VerilogAContributionToSysmlConstraint",
    sourceLang: "verilog-a",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ContributionStatement"]?.({ branch: v("brName"), expr: v("rhs") }),
    target: ($, v) => $["ConstraintUsage"]?.({ declaredName: v("brName"), expression: v("rhs") }),
    where: (v) => [tggEq(v("brName"), v("brName")), tggEq(v("rhs"), v("rhs"))],
  }),
];

export const verilogAPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: verilogATggRules,
};
