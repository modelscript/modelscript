// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Preprocessor for PSCAD Fortran script segments (<segment name="Fortran"> / <segment name="Dsdyn">).
 * Delegated to first-class DSL package @modelscript/fortran.
 */

export { preprocessFortran, preprocessFortranSegment, type PreprocessedFortran } from "@modelscript/fortran";
