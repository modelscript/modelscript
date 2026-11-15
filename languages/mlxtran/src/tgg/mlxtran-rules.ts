// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const mlxtranTggRules = [
  tggRule({
    name: "MlxtranParamToModelicaParam",
    sourceLang: "mlxtran",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["MlxtranParameter"]?.({ name: v("pName"), typicalValue: v("val") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("pName"), typeSpecifier: "Real", defaultValue: v("val") }),
    where: (v) => [
      tggEq(v("pName"), v("pName")),
      tggEq(v("val"), v("val")),
      tggReconcilePhysics(v("val"), v("val"), { min: 1e-6, max: 1e6 }),
      tggComplement(["distribution", "omega"]),
    ],
  }),
  tggRule({
    name: "MlxtranOdeToSysmlConstraint",
    sourceLang: "mlxtran",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["MlxtranEquation"]?.({ name: v("eqName"), rhsExpr: v("rhs") }),
    target: ($, v) => $["ConstraintUsage"]?.({ declaredName: v("eqName"), expression: v("rhs") }),
    where: (v) => [tggEq(v("eqName"), v("eqName")), tggEq(v("rhs"), v("rhs"))],
  }),
];

export const mlxtranPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: mlxtranTggRules,
};
