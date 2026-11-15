// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const comtradeTggRules = [
  tggRule({
    name: "ComtradeChannelToModelicaSignal",
    sourceLang: "comtrade",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["AnalogChannel"]?.({ name: v("chName"), unit: v("unitStr") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("chName"),
        typeSpecifier: "Modelica.Blocks.Sources.CombiTimeTable",
        unit: v("unitStr"),
      }),
    where: (v) => [
      tggEq(v("chName"), v("chName")),
      tggEq(v("unitStr"), v("unitStr")),
      tggComplement(["multiplier", "offset", "min", "max"]),
    ],
  }),
  tggRule({
    name: "ComtradeConfigToSysmlAttribute",
    sourceLang: "comtrade",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ComtradeConfig"]?.({ name: v("recName"), sampleRateHz: v("fs") }),
    target: ($, v) => $["AttributeUsage"]?.({ declaredName: v("recName"), sampleRateHz: v("fs") }),
    where: (v) => [
      tggEq(v("recName"), v("recName")),
      tggEq(v("fs"), v("fs")),
      tggReconcilePhysics(v("fs"), v("fs"), { min: 1.0, max: 1e7 }),
      tggComplement(["revision", "stationName"]),
    ],
  }),
];

export const comtradePolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: comtradeTggRules,
};
