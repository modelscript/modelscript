// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";
import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";

export const iec104TggRules = [
  tggRule({
    name: "Iec104PointToDnp3Point",
    sourceLang: "iec104",
    targetLang: "dnp3",
    priority: 10,
    source: ($, v) => $["Iec104Point"]?.({ name: v("ptName"), ioa: v("idx") }),
    target: ($, v) => $["Dnp3Point"]?.({ name: v("ptName"), index: v("idx") }),
    where: (v) => [tggEq(v("ptName"), v("ptName")), tggEq(v("idx"), v("idx")), tggComplement(["typeId", "units"])],
  }),
];

export const iec104PolyglotConfig: PolyglotConfig = {
  languages: ["dnp3", "scl"],
  rules: iec104TggRules,
};

export const iec104TggPlan: CompiledTGGPlan = planTGGRules(iec104PolyglotConfig);

export function createIec104TggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: iec104TggPlan });
}
