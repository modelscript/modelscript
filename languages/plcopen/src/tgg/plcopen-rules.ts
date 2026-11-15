// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const plcopenTggRules = [
  tggRule({
    name: "PlcopenPouToModelicaBlock",
    sourceLang: "plcopen",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["PlcPou"]?.({ name: v("pouName"), cycleTimeMs: v("dtMs") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("pouName"),
        typeSpecifier: "Modelica.Blocks.Discrete.TriggeredSampler",
        samplePeriodMs: v("dtMs"),
      }),
    where: (v) => [
      tggEq(v("pouName"), v("pouName")),
      tggEq(v("dtMs"), v("dtMs")),
      tggReconcilePhysics(v("dtMs"), v("dtMs"), { min: 0.1, max: 60000.0 }),
      tggComplement(["pouType", "language"]),
    ],
  }),
  tggRule({
    name: "PlcopenVarToSysmlAttribute",
    sourceLang: "plcopen",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["PlcVariable"]?.({ name: v("varName"), dataType: v("dtype") }),
    target: ($, v) => $["AttributeUsage"]?.({ declaredName: v("varName"), declaredType: v("dtype") }),
    where: (v) => [
      tggEq(v("varName"), v("varName")),
      tggEq(v("dtype"), v("dtype")),
      tggComplement(["address", "initialValue"]),
    ],
  }),
];

export const plcopenPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: plcopenTggRules,
};
