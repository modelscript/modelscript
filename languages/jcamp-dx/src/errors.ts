// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes (`JDX1001`–`JDX5006`) for `@modelscript/jcamp-dx`.
 */

export interface JcampDxErrorDef {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: (...args: string[]) => string;
}

export const JcampDxErrorCode = {
  SYNTAX_ERROR: {
    code: "JDX1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `JCAMP-DX syntax error: ${detail}.`,
  },
  MISSING_TITLE: {
    code: "JDX2001",
    rule: "missing-title",
    severity: "error" as const,
    message: () => "Missing mandatory Labeled Data Record '##TITLE='.",
  },
  MISSING_JCAMP_DX: {
    code: "JDX2002",
    rule: "missing-jcamp-dx",
    severity: "error" as const,
    message: () => "Missing mandatory Labeled Data Record '##JCAMP-DX='.",
  },
  MISSING_DATA_TYPE: {
    code: "JDX2003",
    rule: "missing-data-type",
    severity: "error" as const,
    message: () => "Missing mandatory Labeled Data Record '##DATA TYPE='.",
  },
  MISSING_END: {
    code: "JDX2004",
    rule: "missing-end",
    severity: "error" as const,
    message: () => "Missing mandatory Labeled Data Record '##END='.",
  },
  NPOINTS_MISMATCH: {
    code: "JDX3001",
    rule: "npoints-mismatch",
    severity: "error" as const,
    message: (declared: string, actual: string) =>
      `Declared '##NPOINTS=${declared}' does not match decoded point count '${actual}'.`,
  },
  DIFDUP_CHECKPOINT_ERROR: {
    code: "JDX3002",
    rule: "difdup-checkpoint-error",
    severity: "error" as const,
    message: (expected: string, actual: string, xVal: string) =>
      `DIFDUP checkpoint discontinuity at X=${xVal}: expected ordinate '${expected}', found '${actual}'.`,
  },
  NON_POSITIVE_XFACTOR: {
    code: "JDX4001",
    rule: "non-positive-xfactor",
    severity: "error" as const,
    message: (val: string) => `'##XFACTOR=${val}' must be strictly positive.`,
  },
  NON_POSITIVE_YFACTOR: {
    code: "JDX4002",
    rule: "non-positive-yfactor",
    severity: "error" as const,
    message: (val: string) => `'##YFACTOR=${val}' must be strictly positive.`,
  },
  FIRSTX_MISMATCH: {
    code: "JDX5001",
    rule: "firstx-mismatch",
    severity: "warning" as const,
    message: (declared: string, actual: string) =>
      `Declared '##FIRSTX=${declared}' does not match first decoded X value '${actual}'.`,
  },
  LASTX_MISMATCH: {
    code: "JDX5002",
    rule: "lastx-mismatch",
    severity: "warning" as const,
    message: (declared: string, actual: string) =>
      `Declared '##LASTX=${declared}' does not match last decoded X value '${actual}'.`,
  },
  INVALID_TRANSMITTANCE_LOW: {
    code: "JDX5003",
    rule: "invalid-transmittance-low",
    severity: "warning" as const,
    message: (val: string, xVal: string) => `Invalid transmittance value '${val}' (< 0) at X=${xVal}.`,
  },
  INVALID_TRANSMITTANCE_HIGH: {
    code: "JDX5004",
    rule: "invalid-transmittance-high",
    severity: "warning" as const,
    message: (val: string, xVal: string) => `Invalid transmittance value '${val}' (> 1.2) at X=${xVal}.`,
  },
  EMPTY_SPECTRUM_DATA: {
    code: "JDX5005",
    rule: "empty-spectrum-data",
    severity: "warning" as const,
    message: (title: string) => `Spectrum block '${title}' contains no XYDATA or PEAK TABLE points.`,
  },
  UNSUPPORTED_JCAMP_VERSION: {
    code: "JDX5006",
    rule: "unsupported-jcamp-version",
    severity: "info" as const,
    message: (version: string) => `JCAMP-DX version '${version}' is outside standard IUPAC 4.24–6.00 range.`,
  },
} as const;
