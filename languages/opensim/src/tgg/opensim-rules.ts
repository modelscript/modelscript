// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const opensimTggRules = [
  tggRule({
    name: "OpenSimBodyToModelicaBody",
    sourceLang: "opensim",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["OsimBody"]?.({ name: v("bodyName"), massKg: v("mass") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("bodyName"),
        typeSpecifier: "Modelica.Mechanics.MultiBody.Parts.Body",
        m: v("mass"),
      }),
    where: (v) => [
      tggEq(v("bodyName"), v("bodyName")),
      tggEq(v("mass"), v("mass")),
      tggReconcilePhysics(v("mass"), v("mass"), { min: 0.001, max: 500.0 }),
      tggComplement(["massCenter", "inertia"]),
    ],
  }),
  tggRule({
    name: "OpenSimMuscleToSysmlPart",
    sourceLang: "opensim",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["Thelen2003Muscle"]?.({ name: v("muscName"), maxIsometricForceN: v("fMax") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("muscName"), declaredType: "MuscleActuator", maxForceN: v("fMax") }),
    where: (v) => [
      tggEq(v("muscName"), v("muscName")),
      tggEq(v("fMax"), v("fMax")),
      tggReconcilePhysics(v("fMax"), v("fMax"), { min: 1.0, max: 50000.0 }),
      tggComplement(["optimalFiberLengthM", "tendonSlackLengthM"]),
    ],
  }),
];

export const opensimPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: opensimTggRules,
};
