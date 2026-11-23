// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileAssemblyToStep, type StepCompileOptions } from "@modelscript/cad";
import { lowerDxfToCad, type DxfCadLoweringOptions } from "../cad/geometry.js";
import type { DxfDocument } from "../types.js";

export interface DxfToStepOptions extends DxfCadLoweringOptions {
  stepOptions?: StepCompileOptions | undefined;
}

/**
 * Projects a parsed {@link DxfDocument} into an ISO 10303-21 STEP file via `@modelscript/cad`.
 */
export function dxfToStep(doc: DxfDocument, options: DxfToStepOptions = {}): string {
  const lowered = lowerDxfToCad(doc, options);
  return compileAssemblyToStep(lowered.assembly, {
    preservePartNames: true,
    ...options.stepOptions,
  });
}
