// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plot3d — Standard Diagnostic Error Codes (P3D1001–P3D5006).
 */

export const Plot3dErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    stdCode: "P3D1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `PLOT3D syntax or unexpected EOF error: ${detail}.`,
  },
  BINARY_RECORD_MARKER_MISMATCH: {
    code: 1002,
    stdCode: "P3D1002",
    rule: "binary-record-marker-mismatch",
    severity: "error" as const,
    message: (recordIndex: number, headerBytes: number, trailerBytes: number) =>
      `Fortran unformatted binary record '${recordIndex}' header byte count (${headerBytes}) does not match trailer (${trailerBytes}).`,
  },
  NON_POSITIVE_BLOCK_DIMENSION: {
    code: 2001,
    stdCode: "P3D2001",
    rule: "non-positive-block-dimension",
    severity: "error" as const,
    message: (blockIndex: number, ni: number, nj: number, nk: number) =>
      `Block '${blockIndex}' has non-positive structured grid dimensions (NI=${ni}, NJ=${nj}, NK=${nk}).`,
  },
  COORDINATE_COUNT_MISMATCH: {
    code: 2002,
    stdCode: "P3D2002",
    rule: "coordinate-count-mismatch",
    severity: "error" as const,
    message: (blockIndex: number, field: string, actual: number, expected: number) =>
      `Block '${blockIndex}' field '${field}' has ${actual} values, expected NI*NJ*NK = ${expected}.`,
  },
  BLOCK_COUNT_MISMATCH: {
    code: 2003,
    stdCode: "P3D2003",
    rule: "block-count-mismatch",
    severity: "error" as const,
    message: (detail: string) => `Grid (.xyz) and solution (.q) block structure mismatch: ${detail}.`,
  },
  NEGATIVE_JACOBIAN: {
    code: 3001,
    stdCode: "P3D3001",
    rule: "negative-jacobian",
    severity: "error" as const,
    message: (blockIndex: number, i: number, j: number, k: number, volume: number) =>
      `Block '${blockIndex}' cell (${i},${j},${k}) has non-positive Jacobian / inverted cell volume (${volume}).`,
  },
  NON_POSITIVE_DENSITY: {
    code: 3002,
    stdCode: "P3D3002",
    rule: "non-positive-density",
    severity: "error" as const,
    message: (blockIndex: number, nodeIndex: number, rho: number) =>
      `Block '${blockIndex}' node '${nodeIndex}' has non-positive density rho = '${rho}' <= 0.`,
  },
  NON_POSITIVE_PRESSURE: {
    code: 3003,
    stdCode: "P3D3003",
    rule: "non-positive-pressure",
    severity: "error" as const,
    message: (blockIndex: number, nodeIndex: number, pressure: number) =>
      `Block '${blockIndex}' node '${nodeIndex}' has non-positive static pressure p = '${pressure}' <= 0.`,
  },
  INVALID_MACH_NUMBER: {
    code: 4001,
    stdCode: "P3D4001",
    rule: "invalid-mach-number",
    severity: "error" as const,
    message: (blockIndex: number, mach: number) =>
      `Block '${blockIndex}' freestream Mach number FSMACH = '${mach}' is invalid or outside [0, 30].`,
  },
  INVALID_REYNOLDS_NUMBER: {
    code: 4002,
    stdCode: "P3D4002",
    rule: "invalid-reynolds-number",
    severity: "error" as const,
    message: (blockIndex: number, re: number) =>
      `Block '${blockIndex}' Reynolds number RE = '${re}' must be finite and non-negative.`,
  },
  INVALID_ALPHA_ANGLE: {
    code: 4003,
    stdCode: "P3D4003",
    rule: "invalid-alpha-angle",
    severity: "warning" as const,
    message: (blockIndex: number, alpha: number) =>
      `Block '${blockIndex}' angle of attack ALPHA = '${alpha}' degrees is outside [-180, 180].`,
  },
  EMPTY_GRID: {
    code: 5001,
    stdCode: "P3D5001",
    rule: "empty-grid",
    severity: "error" as const,
    message: () => `PLOT3D grid contains zero structured blocks.`,
  },
  NAN_OR_INF_VALUE: {
    code: 5002,
    stdCode: "P3D5002",
    rule: "nan-or-inf-value",
    severity: "error" as const,
    message: (blockIndex: number, field: string, index: number) =>
      `Block '${blockIndex}' field '${field}' contains non-finite (NaN/Infinity) value at index '${index}'.`,
  },
  SOLUTION_FUNCTION_MISMATCH: {
    code: 5006,
    stdCode: "P3D5006",
    rule: "solution-function-mismatch",
    severity: "warning" as const,
    message: (blockIndex: number, nVars: number, namCount: number) =>
      `Block '${blockIndex}' function variable count (${nVars}) does not match .nam metadata count (${namCount}).`,
  },
} as const;

export type Plot3dErrorCodeKey = keyof typeof Plot3dErrorCode;
