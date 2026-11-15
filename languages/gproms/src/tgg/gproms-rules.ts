// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const gpromsTggRules = [
  tggRule({
    name: "GpromsModelToModelicaModel",
    sourceLang: "gproms",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["GpromsModel"]?.({ name: v("modName") }),
    target: ($, v) => $["ClassDefinition"]?.({ name: v("modName"), classKind: "model" }),
    where: (v) => [tggEq(v("modName"), v("modName")), tggComplement(["ports"])],
  }),
  tggRule({
    name: "GpromsParamToModelicaParam",
    sourceLang: "gproms",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["GpromsParameter"]?.({ name: v("pName"), value: v("pVal") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("pName"), typeSpecifier: "Real", defaultValue: v("pVal") }),
    where: (v) => [
      tggEq(v("pName"), v("pName")),
      tggEq(v("pVal"), v("pVal")),
      tggReconcilePhysics(v("pVal"), v("pVal"), { min: -1e12, max: 1e12 }),
      tggComplement(["unit"]),
    ],
  }),
  tggRule({
    name: "GpromsEquationToSysmlConstraint",
    sourceLang: "gproms",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["GpromsEquation"]?.({ name: v("eqName"), expr: v("eqExpr") }),
    target: ($, v) => $["ConstraintUsage"]?.({ declaredName: v("eqName"), expression: v("eqExpr") }),
    where: (v) => [tggEq(v("eqName"), v("eqName")), tggEq(v("eqExpr"), v("eqExpr"))],
  }),
];

export const gpromsPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: gpromsTggRules,
};
