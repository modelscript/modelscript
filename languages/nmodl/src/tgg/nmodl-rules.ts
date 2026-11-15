// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const nmodlTggRules = [
  tggRule({
    name: "NmodlChannelToModelicaComponent",
    sourceLang: "nmodl",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["NmodlMechanism"]?.({ name: v("mechName"), conductanceS: v("gVal") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("mechName"),
        typeSpecifier: "Modelica.Electrical.Analog.Basic.VariableConductor",
        G: v("gVal"),
      }),
    where: (v) => [
      tggEq(v("mechName"), v("mechName")),
      tggEq(v("gVal"), v("gVal")),
      tggReconcilePhysics(v("gVal"), v("gVal"), { min: 0.0, max: 100.0 }),
      tggComplement(["ionType", "reversalPotentialMv"]),
    ],
  }),
  tggRule({
    name: "NmodlStateToSysmlAttribute",
    sourceLang: "nmodl",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["NmodlState"]?.({ name: v("stateName"), initialVal: v("init") }),
    target: ($, v) => $["AttributeUsage"]?.({ declaredName: v("stateName"), defaultValue: v("init") }),
    where: (v) => [
      tggEq(v("stateName"), v("stateName")),
      tggEq(v("init"), v("init")),
      tggReconcilePhysics(v("init"), v("init"), { min: -200.0, max: 200.0 }),
      tggComplement(["unit"]),
    ],
  }),
];

export const nmodlPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: nmodlTggRules,
};
