// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const phreeqcTggRules = [
  tggRule({
    name: "PhreeqcSolutionToModelicaMedium",
    sourceLang: "phreeqc",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["AqueousSolution"]?.({ name: v("solName"), ph: v("phVal") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("solName"),
        typeSpecifier: "Modelica.Media.Water.StandardWater",
        pH: v("phVal"),
      }),
    where: (v) => [
      tggEq(v("solName"), v("solName")),
      tggEq(v("phVal"), v("phVal")),
      tggReconcilePhysics(v("phVal"), v("phVal"), { min: 0.0, max: 14.0 }),
      tggComplement(["pe", "tempC", "alkalinity"]),
    ],
  }),
  tggRule({
    name: "PhreeqcPhaseToSysmlAttribute",
    sourceLang: "phreeqc",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["EquilibriumPhase"]?.({ name: v("minName"), targetSi: v("si") }),
    target: ($, v) => $["AttributeUsage"]?.({ declaredName: v("minName"), saturationIndex: v("si") }),
    where: (v) => [
      tggEq(v("minName"), v("minName")),
      tggEq(v("si"), v("si")),
      tggReconcilePhysics(v("si"), v("si"), { min: -20.0, max: 20.0 }),
      tggComplement(["moles"]),
    ],
  }),
];

export const phreeqcPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: phreeqcTggRules,
};
