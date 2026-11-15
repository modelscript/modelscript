// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const amplTggRules = [
  tggRule({
    name: "AmplVarToModelicaComponent",
    sourceLang: "ampl",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["VariableDecl"]?.({ name: v("varName"), upperBound: v("ub") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("varName"), typeSpecifier: "Real", max: v("ub") }),
    where: (v) => [
      tggEq(v("varName"), v("varName")),
      tggEq(v("ub"), v("ub")),
      tggReconcilePhysics(v("ub"), v("ub"), { min: -1e9, max: 1e9 }),
      tggComplement(["lowerBound", "domain"]),
    ],
  }),
  tggRule({
    name: "AmplParamToSysmlAttribute",
    sourceLang: "ampl",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ParamDecl"]?.({ name: v("paramName"), defaultValue: v("val") }),
    target: ($, v) => $["AttributeUsage"]?.({ declaredName: v("paramName"), defaultValue: v("val") }),
    where: (v) => [
      tggEq(v("paramName"), v("paramName")),
      tggEq(v("val"), v("val")),
      tggReconcilePhysics(v("val"), v("val"), { min: -1e12, max: 1e12 }),
      tggComplement(["indexSet"]),
    ],
  }),
  tggRule({
    name: "AmplConstraintToSysmlConstraint",
    sourceLang: "ampl",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ConstraintDecl"]?.({ name: v("conName"), body: v("expr") }),
    target: ($, v) => $["ConstraintUsage"]?.({ declaredName: v("conName"), expression: v("expr") }),
    where: (v) => [tggEq(v("conName"), v("conName")), tggEq(v("expr"), v("expr")), tggComplement(["sense"])],
  }),
];

export const amplPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: amplTggRules,
};
