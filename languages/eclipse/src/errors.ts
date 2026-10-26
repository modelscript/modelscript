// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/eclipse — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M8701 - M8710).
 */

import type { EclipseRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: EclipseRange | undefined;
}

export const EclipseErrorCode = {
  MISSING_RESERVOIR_PHASES: {
    code: 8701,
    rule: "missing-reservoir-phases",
    severity: "error" as DiagnosticSeverity,
    message: () => `RUNSPEC section does not specify any active fluid phases ('OIL', 'WATER', or 'GAS').`,
  },
  INVALID_GRID_DIMENSIONS: {
    code: 8702,
    rule: "invalid-grid-dimensions",
    severity: "error" as DiagnosticSeverity,
    message: (nx: number, ny: number, nz: number) =>
      `Reservoir grid dimensions must be strictly positive integers (got ${nx} x ${ny} x ${nz}).`,
  },
  POROSITY_OUT_OF_RANGE: {
    code: 8703,
    rule: "porosity-out-of-range",
    severity: "error" as DiagnosticSeverity,
    message: (val: number) => `Reservoir porosity (${val}) must be strictly positive and less than 1.0.`,
  },
  NEGATIVE_PERMEABILITY: {
    code: 8704,
    rule: "negative-permeability",
    severity: "error" as DiagnosticSeverity,
    message: (prop: string, val: number) => `Reservoir permeability '${prop}' (${val} mD) must be strictly positive.`,
  },
  NON_MONOTONIC_PVT_TABLE: {
    code: 8705,
    rule: "non-monotonic-pvt-table",
    severity: "error" as DiagnosticSeverity,
    message: (table: string, prevP: number, curP: number) =>
      `PVT table '${table}' has non-monotonic pressure progression (${prevP} -> ${curP}).`,
  },
  DANGLING_WELL_COMPLETION: {
    code: 8706,
    rule: "dangling-well-completion",
    severity: "error" as DiagnosticSeverity,
    message: (wellName: string, i: number, j: number, k: number, nx: number, ny: number, nz: number) =>
      `Well completion for '${wellName}' at (${i},${j},${k}) exceeds grid boundary (${nx},${ny},${nz}).`,
  },
  NON_MONOTONIC_SATURATION_TABLE: {
    code: 8707,
    rule: "non-monotonic-saturation-table",
    severity: "error" as DiagnosticSeverity,
    message: (table: string, prevSat: number, curSat: number) =>
      `Relative permeability table '${table}' has non-monotonic saturation progression (${prevSat} -> ${curSat}).`,
  },
  UNDEFINED_WELL_REFERENCE: {
    code: 8708,
    rule: "undefined-well-reference",
    severity: "error" as DiagnosticSeverity,
    message: (wellName: string, contextKeyword: string) =>
      `Keyword '${contextKeyword}' references well '${wellName}' not defined in WELSPECS.`,
  },
  INVALID_WELL_CONTROL_TARGET: {
    code: 8709,
    rule: "invalid-well-control-target",
    severity: "error" as DiagnosticSeverity,
    message: (wellName: string, mode: string, val: number) =>
      `Well '${wellName}' specifies invalid control target for '${mode}' (${val}).`,
  },
  NEGATIVE_FORMATION_VOLUME_FACTOR: {
    code: 8710,
    rule: "negative-formation-volume-factor",
    severity: "error" as DiagnosticSeverity,
    message: (phase: string, fvf: number) =>
      `PVT property specifies non-positive formation volume factor B_${phase} (${fvf}).`,
  },
} as const;
