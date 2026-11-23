// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes (`GRB1001`–`GRB5006`) for `@modelscript/gerber`.
 *
 * Numbering scheme:
 * - `1xxx`: Syntax / parser errors
 * - `2xxx`: Header, format, unit, and aperture declarations
 * - `3xxx`: Aperture state & region fill structural semantics
 * - `4xxx`: File termination & structure
 * - `5xxx`: Design-for-Manufacturing (DFM) & IPC-2221 checks
 */

export const GerberErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "GRB1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Gerber syntax error: ${detail}.`,
  },
  MISSING_FORMAT_SPEC: {
    code: 2001,
    id: "GRB2001",
    rule: "missing-format-spec",
    severity: "error" as const,
    message: () => "Missing format specification '%FS' (e.g., '%FSLAX24Y24*%').",
  },
  MISSING_UNIT_SPEC: {
    code: 2002,
    id: "GRB2002",
    rule: "missing-unit-spec",
    severity: "error" as const,
    message: () => "Missing unit specification '%MOIN*%' or '%MOMM*%'.",
  },
  UNDEFINED_APERTURE: {
    code: 2003,
    id: "GRB2003",
    rule: "undefined-aperture",
    severity: "error" as const,
    message: (dCode: number) => `Aperture 'D${dCode}' is selected but was never defined with '%ADD${dCode}...*%'.`,
  },
  DRAW_BEFORE_APERTURE: {
    code: 3001,
    id: "GRB3001",
    rule: "draw-before-aperture",
    severity: "error" as const,
    message: (op: string) => `Operation '${op}' executed before any aperture ('D10'+) was selected.`,
  },
  UNCLOSED_REGION: {
    code: 3002,
    id: "GRB3002",
    rule: "unclosed-region",
    severity: "error" as const,
    message: () => "Region fill started with 'G36*' was not closed with a matching 'G37*'.",
  },
  UNMATCHED_REGION_END: {
    code: 3003,
    id: "GRB3003",
    rule: "unmatched-region-end",
    severity: "error" as const,
    message: () => "Region end 'G37*' encountered without a matching 'G36*' start.",
  },
  MISSING_EOF: {
    code: 4001,
    id: "GRB4001",
    rule: "missing-eof",
    severity: "warning" as const,
    message: () => "Missing end-of-file command 'M02*'.",
  },
  DFM_MIN_TRACE_WIDTH: {
    code: 5001,
    id: "GRB5001",
    rule: "dfm-min-trace-width",
    severity: "warning" as const,
    message: (dCode: number, widthMm: number, minWidthMm: number) =>
      `Aperture 'D${dCode}' trace width (${widthMm.toFixed(4)} mm) violates DFM minimum trace width (${minWidthMm.toFixed(4)} mm).`,
  },
  DFM_MIN_ANNULAR_RING: {
    code: 5002,
    id: "GRB5002",
    rule: "dfm-min-annular-ring",
    severity: "warning" as const,
    message: (dCode: number, ringMm: number, minRingMm: number) =>
      `Aperture 'D${dCode}' annular ring (${ringMm.toFixed(4)} mm) violates DFM minimum annular ring (${minRingMm.toFixed(4)} mm).`,
  },
  DFM_ZERO_SIZE_APERTURE: {
    code: 5003,
    id: "GRB5003",
    rule: "dfm-zero-size-aperture",
    severity: "error" as const,
    message: (dCode: number) => `Aperture 'D${dCode}' has non-positive dimension (must be > 0).`,
  },
  DFM_HOLE_EXCEEDS_PAD: {
    code: 5004,
    id: "GRB5004",
    rule: "dfm-hole-exceeds-pad",
    severity: "error" as const,
    message: (dCode: number, holeMm: number, outerMm: number) =>
      `Aperture 'D${dCode}' hole diameter (${holeMm.toFixed(4)} mm) equals or exceeds outer dimension (${outerMm.toFixed(4)} mm).`,
  },
  DFM_LEGACY_RS274D_MODE: {
    code: 5005,
    id: "GRB5005",
    rule: "dfm-legacy-rs274d-mode",
    severity: "info" as const,
    message: (feature: string) =>
      `Deprecated RS-274-D feature '${feature}' used; prefer RS-274X extended parameters ('%MO', '%FSLA').`,
  },
  DFM_ARC_RADIUS_MISMATCH: {
    code: 5006,
    id: "GRB5006",
    rule: "dfm-arc-radius-mismatch",
    severity: "warning" as const,
    message: (rStartMm: number, rEndMm: number) =>
      `Arc interpolation radius mismatch: start radius (${rStartMm.toFixed(4)} mm) differs from end radius (${rEndMm.toFixed(4)} mm).`,
  },
} as const;

export type GerberErrorKey = keyof typeof GerberErrorCode;

export interface GerberDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  line?: number | undefined;
  column?: number | undefined;
  dCode?: number | undefined;
}
