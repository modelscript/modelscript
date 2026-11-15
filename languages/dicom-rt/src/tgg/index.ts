// SPDX-License-Identifier: AGPL-3.0-or-later

import { planTGGRules, type CompiledTGGPlan } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime";
import { dicomRtPolyglotConfig } from "./dicom-rt-rules.js";

export * from "./dicom-rt-rules.js";

export const dicomRtTggPlan: CompiledTGGPlan = planTGGRules(dicomRtPolyglotConfig);

export function createDicomRtTggTransformer(): PolyglotTransformer {
  return new PolyglotTransformer({ plan: dicomRtTggPlan });
}
