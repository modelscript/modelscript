// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error definition for Touchstone S/Y/Z N-port parameter networks.
 */
export const TouchstoneErrorCode = {
  PASSIVITY_VIOLATION: {
    code: 8301,
    rule: "passivity-violation",
    severity: "error" as const,
    message: (freq: string, norm: string) =>
      `N-port scattering matrix violates passivity criterion (spectral norm ${norm} > 1.0) at frequency ${freq}.`,
  },
  CAUSALITY_VIOLATION: {
    code: 8302,
    rule: "causality-violation",
    severity: "error" as const,
    message: (detail: string) => `Kramers-Kronig causality relation violated across frequency sweep: '${detail}'.`,
  },
  FREQUENCY_GRID_NON_MONOTONIC: {
    code: 8304,
    rule: "frequency-grid-non-monotonic",
    severity: "error" as const,
    message: (prevFreq: string, currFreq: string) =>
      `Frequency grid is not monotonically increasing: step from ${prevFreq} to ${currFreq} is non-increasing.`,
  },
  MISSING_OPTION_LINE: {
    code: 8306,
    rule: "missing-option-line",
    severity: "warning" as const,
    message: () => "Missing '#' option line; defaulting to '# GHz S MA R 50'.",
  },
  INVALID_PARAMETER_FORMAT: {
    code: 8307,
    rule: "invalid-parameter-format",
    severity: "error" as const,
    message: (token: string) => `Invalid Touchstone parameter token or format '${token}'.`,
  },
  INCOMPLETE_MATRIX_DATA: {
    code: 8308,
    rule: "incomplete-matrix-data",
    severity: "error" as const,
    message: (expected: number, received: number) =>
      `Incomplete N-port matrix row: expected ${expected} values, received ${received}.`,
  },
  NEGATIVE_REFERENCE_RESISTANCE: {
    code: 8309,
    rule: "negative-reference-resistance",
    severity: "error" as const,
    message: (r: string) => `Reference resistance '${r}' must be strictly positive.`,
  },
  ASYMMETRIC_RECIPROCAL_NETWORK: {
    code: 8310,
    rule: "asymmetric-reciprocal-network",
    severity: "warning" as const,
    message: (i: number, j: number, diff: string) =>
      `Asymmetry in reciprocal S-parameter network: |S${i}${j} - S${j}${i}| = ${diff} exceeds threshold.`,
  },
  NO_FREQUENCY_POINTS: {
    code: 8311,
    rule: "no-frequency-points",
    severity: "error" as const,
    message: () => "Touchstone file contains no valid frequency parameter points.",
  },
  DUPLICATE_FREQUENCY_POINT: {
    code: 8312,
    rule: "duplicate-frequency-point",
    severity: "error" as const,
    message: (freq: string) => `Duplicate frequency sample point '${freq}' encountered in sweep.`,
  },
} as const;
