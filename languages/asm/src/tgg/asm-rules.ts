// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const asmTggRules = [
  tggRule({
    name: "AsmReactorToModelicaTank",
    sourceLang: "asm",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["BioreactorUnit"]?.({ name: v("tankName"), volumeM3: v("vol") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("tankName"),
        typeSpecifier: "Modelica.Fluid.Vessels.OpenTank",
        V: v("vol"),
      }),
    where: (v) => [
      tggEq(v("tankName"), v("tankName")),
      tggEq(v("vol"), v("vol")),
      tggReconcilePhysics(v("vol"), v("vol"), { min: 0.1, max: 1e6 }),
      tggComplement(["doSetpoint", "hrtHours"]),
    ],
  }),
  tggRule({
    name: "AsmProcessToSysmlConstraint",
    sourceLang: "asm",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["BiokineticProcess"]?.({ name: v("procName"), rateExpr: v("rate") }),
    target: ($, v) => $["ConstraintUsage"]?.({ declaredName: v("procName"), expression: v("rate") }),
    where: (v) => [tggEq(v("procName"), v("procName")), tggEq(v("rate"), v("rate")), tggComplement(["stoichiometry"])],
  }),
];

export const asmPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: asmTggRules,
};
