// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const gtsuiteTggRules = [
  tggRule({
    name: "GtSuiteCylinderToModelicaVolume",
    sourceLang: "gtsuite",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["EngineCylinder"]?.({ name: v("cylName"), boreMm: v("bore") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("cylName"),
        typeSpecifier: "Modelica.Fluid.Vessels.ClosedVolume",
        boreMm: v("bore"),
      }),
    where: (v) => [
      tggEq(v("cylName"), v("cylName")),
      tggEq(v("bore"), v("bore")),
      tggReconcilePhysics(v("bore"), v("bore"), { min: 10.0, max: 1000.0 }),
      tggComplement(["strokeMm", "compressionRatio"]),
    ],
  }),
  tggRule({
    name: "GtSuiteManifoldToSysmlPart",
    sourceLang: "gtsuite",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["FlowSplit"]?.({ name: v("manName"), volumeCm3: v("vol") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("manName"), declaredType: "IntakeManifold", volumeCm3: v("vol") }),
    where: (v) => [
      tggEq(v("manName"), v("manName")),
      tggEq(v("vol"), v("vol")),
      tggReconcilePhysics(v("vol"), v("vol"), { min: 1.0, max: 1e6 }),
      tggComplement(["wallTempK"]),
    ],
  }),
];

export const gtsuitePolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: gtsuiteTggRules,
};
