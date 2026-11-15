// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const toughTggRules = [
  tggRule({
    name: "ToughRockToModelicaMedium",
    sourceLang: "tough",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["RockDomain"]?.({ name: v("rockName"), permeabilityM2: v("perm") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("rockName"),
        typeSpecifier: "Modelica.Media.PorousMedium",
        k: v("perm"),
      }),
    where: (v) => [
      tggEq(v("rockName"), v("rockName")),
      tggEq(v("perm"), v("perm")),
      tggReconcilePhysics(v("perm"), v("perm"), { min: 1e-22, max: 1e-8 }),
      tggComplement(["densityKgM3", "porosity", "thermalCond"]),
    ],
  }),
  tggRule({
    name: "ToughGenToSysmlPart",
    sourceLang: "tough",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["SourceSinkBlock"]?.({ name: v("genName"), rateKgS: v("rate") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("genName"), declaredType: "SubsurfaceSourceSink", massRateKgS: v("rate") }),
    where: (v) => [
      tggEq(v("genName"), v("genName")),
      tggEq(v("rate"), v("rate")),
      tggReconcilePhysics(v("rate"), v("rate"), { min: -1000.0, max: 1000.0 }),
      tggComplement(["enthalpyJKg", "elementId"]),
    ],
  }),
];

export const toughPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: toughTggRules,
};
