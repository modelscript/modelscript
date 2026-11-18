// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const gridlabdTggRules = [
  tggRule({
    name: "GridlabdLineToModelicaLine",
    sourceLang: "gridlabd",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["ObjectBlock"]?.({ className: "overhead_line", name: v("lineName"), length: v("len") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("lineName"),
        typeSpecifier: "Modelica.Electrical.PowerConverters.Examples.DistributionLine",
        length: v("len"),
      }),
    where: (v) => [
      tggEq(v("lineName"), v("lineName")),
      tggEq(v("len"), v("len")),
      tggReconcilePhysics(v("len"), v("len"), { min: 0.001, max: 1000.0 }),
      tggComplement(["from", "to", "phases", "configuration"]),
    ],
  }),
  tggRule({
    name: "GridlabdLoadToModelicaLoad",
    sourceLang: "gridlabd",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["ObjectBlock"]?.({ className: "load", name: v("loadName"), nominal_voltage: v("vNom") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("loadName"),
        typeSpecifier: "OpenIPSL.Electrical.Loads.PSSE.Load",
        V_n: v("vNom"),
      }),
    where: (v) => [
      tggEq(v("loadName"), v("loadName")),
      tggEq(v("vNom"), v("vNom")),
      tggReconcilePhysics(v("vNom"), v("vNom"), { min: 100.0, max: 500000.0 }),
      tggComplement(["phases", "constant_power_A", "constant_power_B", "constant_power_C"]),
    ],
  }),
];

export const gridlabdPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "opendss"],
  rules: gridlabdTggRules,
};
