// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  compileFortranStep,
  lintFortran,
  lowerFortranToDae,
  type CompiledFortranComponent,
  type FortranDaeLoweringResult,
  type FortranDiagnostic,
} from "@modelscript/fortran";
import type { IDaeBuilder } from "@modelscript/runtime";

/**
 * Handles EASY5 User General (UG/UX) custom component Fortran code blocks.
 */
export function validateUserFortranCode(code: string): FortranDiagnostic[] {
  return lintFortran(code);
}

/**
 * Lowers an EASY5 User General component's Fortran source code directly
 * into the IDaeBuilder linear memory representation.
 */
export function lowerUserComponentToDae(
  builder: IDaeBuilder,
  code: string,
  componentId: string,
): FortranDaeLoweringResult {
  const lines = code.split(/\r?\n/);
  return lowerFortranToDae(builder, lines, componentId);
}

/**
 * Compiles an EASY5 User General component into an in-memory step function
 * for discrete/continuous simulation runners.
 */
export function compileUserComponentStep(
  code: string,
  params: Record<string, string | number> = {},
  portDims: Record<string, number> = {},
): CompiledFortranComponent {
  return compileFortranStep(code, params, portDims);
}
