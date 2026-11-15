// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const ranTggRules = [
  tggRule({
    name: "RanGnbToSysmlPart",
    sourceLang: "ran",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["GNodeB"]?.({ name: v("gnbName"), carrierFreqGhz: v("freqGhz") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("gnbName"), declaredType: "GNodeB", carrierFreqGhz: v("freqGhz") }),
    where: (v) => [
      tggEq(v("gnbName"), v("gnbName")),
      tggEq(v("freqGhz"), v("freqGhz")),
      tggReconcilePhysics(v("freqGhz"), v("freqGhz"), { min: 0.4, max: 100.0 }),
      tggComplement(["bandwidthMhz", "txPowerDbm"]),
    ],
  }),
  tggRule({
    name: "RanChannelToModelicaBlock",
    sourceLang: "ran",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["RadioChannel"]?.({ name: v("chName"), pathLossDb: v("loss") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("chName"),
        typeSpecifier: "Modelica.Blocks.Math.Gain",
        k: v("loss"),
      }),
    where: (v) => [
      tggEq(v("chName"), v("chName")),
      tggEq(v("loss"), v("loss")),
      tggReconcilePhysics(v("loss"), v("loss"), { min: 0.0, max: 250.0 }),
      tggComplement(["shadowingStdDb", "fadingModel"]),
    ],
  }),
];

export const ranPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: ranTggRules,
};
