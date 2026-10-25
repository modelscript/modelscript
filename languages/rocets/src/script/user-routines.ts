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
 * Validates embedded or external Fortran user routines (e.g. custom fluid or component models)
 * in NASA ROCETS decks using @modelscript/fortran diagnostics.
 */
export function validateRocetsFortranRoutine(code: string): FortranDiagnostic[] {
  return lintFortran(code);
}

/**
 * Lowers a ROCETS Fortran user subroutine directly into the linear memory IDaeBuilder arena.
 */
export function lowerRocetsRoutineToDae(
  builder: IDaeBuilder,
  code: string,
  routineId: string,
): FortranDaeLoweringResult {
  const lines = code.split(/\r?\n/);
  return lowerFortranToDae(builder, lines, routineId);
}

/**
 * Compiles a ROCETS user routine into an executable step function for rapid simulation
 * or balance iteration.
 */
export function compileRocetsRoutineStep(
  code: string,
  params: Record<string, string | number> = {},
  portDims: Record<string, number> = {},
): CompiledFortranComponent {
  return compileFortranStep(code, params, portDims);
}
