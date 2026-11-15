// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const hecRasTggRules = [
  tggRule({
    name: "HecRasReachToModelicaChannel",
    sourceLang: "hec-ras",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["RiverReach"]?.({ name: v("reachName"), manningN: v("nVal") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("reachName"),
        typeSpecifier: "Modelica.Fluid.Pipes.DynamicPipe",
        n_manning: v("nVal"),
      }),
    where: (v) => [
      tggEq(v("reachName"), v("reachName")),
      tggEq(v("nVal"), v("nVal")),
      tggReconcilePhysics(v("nVal"), v("nVal"), { min: 0.005, max: 0.5 }),
      tggComplement(["riverName", "crossSections"]),
    ],
  }),
  tggRule({
    name: "HecRasBridgeToSysmlPart",
    sourceLang: "hec-ras",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["InlineStructure"]?.({ name: v("strName"), crestElevM: v("elev") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("strName"), declaredType: "HydraulicStructure", crestElevM: v("elev") }),
    where: (v) => [
      tggEq(v("strName"), v("strName")),
      tggEq(v("elev"), v("elev")),
      tggReconcilePhysics(v("elev"), v("elev"), { min: -500.0, max: 6000.0 }),
      tggComplement(["weirCoeff"]),
    ],
  }),
];

export const hecRasPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: hecRasTggRules,
};
