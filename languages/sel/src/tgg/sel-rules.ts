// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const selTggRules = [
  tggRule({
    name: "SelSettingToModelicaParam",
    sourceLang: "sel",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["RelaySetting"]?.({ name: v("setName"), value: v("setVal") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("setName"), typeSpecifier: "Real", defaultValue: v("setVal") }),
    where: (v) => [
      tggEq(v("setName"), v("setName")),
      tggEq(v("setVal"), v("setVal")),
      tggReconcilePhysics(v("setVal"), v("setVal"), { min: 0.0, max: 1e5 }),
      tggComplement(["group", "unit"]),
    ],
  }),
  tggRule({
    name: "SelEquationToSysmlConstraint",
    sourceLang: "sel",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["SELogicEquation"]?.({ name: v("eqName"), expression: v("expr") }),
    target: ($, v) => $["ConstraintUsage"]?.({ declaredName: v("eqName"), expression: v("expr") }),
    where: (v) => [tggEq(v("eqName"), v("eqName")), tggEq(v("expr"), v("expr")), tggComplement(["latch", "timer"])],
  }),
];

export const selPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: selTggRules,
};
