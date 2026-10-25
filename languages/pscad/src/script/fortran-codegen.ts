// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fortran Code Generator & Direct Execution Engine for PSCAD Custom Components.
 * Delegated to first-class DSL package @modelscript/fortran.
 */

export {
  buildStepFunction,
  compileFortranSegment,
  compileFortranStep,
  type CompiledFortranComponent,
  type FortranExecutionContext,
  type FortranStepFunction,
} from "@modelscript/fortran";
