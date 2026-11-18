// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";
import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";

export const c37118TggRules = [
  tggRule({
    name: "C37118PhasorToComtradeChannel",
    sourceLang: "c37118",
    targetLang: "comtrade",
    priority: 10,
    source: ($, v) => $["PhasorChannel"]?.({ name: v("chName"), type: v("chType") }),
    target: ($, v) => $["AnalogChannel"]?.({ name: v("chName"), units: v("chType") }),
    where: (v) => [
      tggEq(v("chName"), v("chName")),
      tggEq(v("chType"), v("chType")),
      tggComplement(["scaleFactor", "format"]),
    ],
  }),
];

export const c37118PolyglotConfig: PolyglotConfig = {
  languages: ["comtrade", "psse"],
  rules: c37118TggRules,
};

export const c37118TggPlan: CompiledTGGPlan = planTGGRules(c37118PolyglotConfig);

export function createC37118TggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: c37118TggPlan });
}
