// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const antimonyTggRules = [
  tggRule({
    name: "AntimonyModelToModelicaModel",
    sourceLang: "antimony",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["AntimonyModel"]?.({ name: v("modName") }),
    target: ($, v) => $["ClassDefinition"]?.({ name: v("modName"), classKind: "model" }),
    where: (v) => [tggEq(v("modName"), v("modName")), tggComplement(["isMain"])],
  }),
  tggRule({
    name: "AntimonyRateParamToModelicaParam",
    sourceLang: "antimony",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["RateParameter"]?.({ name: v("pName"), value: v("kVal") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("pName"), typeSpecifier: "Real", defaultValue: v("kVal") }),
    where: (v) => [
      tggEq(v("pName"), v("pName")),
      tggEq(v("kVal"), v("kVal")),
      tggReconcilePhysics(v("kVal"), v("kVal"), { min: 0.0, max: 1e9 }),
      tggComplement(["unit"]),
    ],
  }),
  tggRule({
    name: "AntimonyReactionToSysmlConstraint",
    sourceLang: "antimony",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ReactionRule"]?.({ name: v("rxnName"), rateExpr: v("expr") }),
    target: ($, v) => $["ConstraintUsage"]?.({ declaredName: v("rxnName"), expression: v("expr") }),
    where: (v) => [tggEq(v("rxnName"), v("rxnName")), tggEq(v("expr"), v("expr"))],
  }),
];

export const antimonyPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: antimonyTggRules,
};
