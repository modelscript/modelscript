// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";
import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";

export const pypsaTggRules = [
  tggRule({
    name: "PypsaBusToMatpowerBus",
    sourceLang: "pypsa",
    targetLang: "matpower",
    priority: 10,
    source: ($, v) => $["PypsaBus"]?.({ name: v("bName"), v_nom: v("kv") }),
    target: ($, v) => $["MatpowerBus"]?.({ name: v("bName"), baseKV: v("kv") }),
    where: (v) => [tggEq(v("bName"), v("bName")), tggEq(v("kv"), v("kv")), tggComplement(["carrier"])],
  }),
];

export const pypsaPolyglotConfig: PolyglotConfig = {
  languages: ["ampl", "matpower"],
  rules: pypsaTggRules,
};

export const pypsaTggPlan: CompiledTGGPlan = planTGGRules(pypsaPolyglotConfig);

export function createPypsaTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: pypsaTggPlan });
}
