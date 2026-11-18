// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";
import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";

export const cymeTggRules = [
  tggRule({
    name: "CymeSectionToOpenDssLine",
    sourceLang: "cyme",
    targetLang: "opendss",
    priority: 10,
    source: ($, v) => $["CymeSection"]?.({ sectionId: v("secName"), lengthMeters: v("len") }),
    target: ($, v) => $["ElementDef"]?.({ name: v("secName"), length: v("len") }),
    where: (v) => [
      tggEq(v("secName"), v("secName")),
      tggEq(v("len"), v("len")),
      tggComplement(["phase", "deviceType"]),
    ],
  }),
];

export const cymePolyglotConfig: PolyglotConfig = {
  languages: ["opendss", "gridlabd"],
  rules: cymeTggRules,
};

export const cymeTggPlan: CompiledTGGPlan = planTGGRules(cymePolyglotConfig);

export function createCymeTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: cymeTggPlan });
}
