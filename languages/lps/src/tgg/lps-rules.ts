// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const lpsTggRules = [
  tggRule({
    name: "LpsPipeToModelicaPipe",
    sourceLang: "lps",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["LpsPipeSegment"]?.({ name: v("pipeName"), innerDiameterM: v("diam") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("pipeName"),
        typeSpecifier: "Modelica.Fluid.Pipes.DynamicPipe",
        diameter: v("diam"),
      }),
    where: (v) => [
      tggEq(v("pipeName"), v("pipeName")),
      tggEq(v("diam"), v("diam")),
      tggReconcilePhysics(v("diam"), v("diam"), { min: 0.01, max: 5.0 }),
      tggComplement(["lengthM", "roughnessM", "wallThicknessM"]),
    ],
  }),
  tggRule({
    name: "LpsPumpStationToSysmlPart",
    sourceLang: "lps",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["PumpStation"]?.({ name: v("stnName"), ratedHeadM: v("head") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("stnName"), declaredType: "PumpStation", ratedHeadM: v("head") }),
    where: (v) => [
      tggEq(v("stnName"), v("stnName")),
      tggEq(v("head"), v("head")),
      tggReconcilePhysics(v("head"), v("head"), { min: 0.1, max: 5000.0 }),
      tggComplement(["efficiency", "speedRpm"]),
    ],
  }),
];

export const lpsPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: lpsTggRules,
};
