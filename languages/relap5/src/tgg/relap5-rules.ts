// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const relap5TggRules = [
  tggRule({
    name: "Relap5VolumeToModelicaVolume",
    sourceLang: "relap5",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["HydroComponent"]?.({ name: v("volName"), flowAreaM2: v("area") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("volName"),
        typeSpecifier: "Modelica.Fluid.Vessels.ClosedVolume",
        A: v("area"),
      }),
    where: (v) => [
      tggEq(v("volName"), v("volName")),
      tggEq(v("area"), v("area")),
      tggReconcilePhysics(v("area"), v("area"), { min: 1e-6, max: 1000.0 }),
      tggComplement(["compNumber", "lengthM", "volumeM3"]),
    ],
  }),
  tggRule({
    name: "Relap5TripToSysmlRequirement",
    sourceLang: "relap5",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["TripCard"]?.({ name: v("tripName"), setpoint: v("setVal") }),
    target: ($, v) => $["RequirementUsage"]?.({ declaredName: v("tripName"), setpoint: v("setVal") }),
    where: (v) => [
      tggEq(v("tripName"), v("tripName")),
      tggEq(v("setVal"), v("setVal")),
      tggReconcilePhysics(v("setVal"), v("setVal"), { min: -1e9, max: 1e9 }),
      tggComplement(["tripId", "latch"]),
    ],
  }),
];

export const relap5PolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: relap5TggRules,
};
