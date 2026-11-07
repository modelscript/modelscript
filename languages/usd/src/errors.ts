// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/usd — OpenUSD & UsdPhysics Diagnostic Error Codes (USD1001–USD1007).
 */

export const UsdErrorCode = {
  USD_PARSE_ERROR: {
    code: "USD1001",
    rule: "usd-parse-error",
    severity: "error" as const,
    message: (detail: string) => `OpenUSD stage parse error: ${detail}.`,
  },
  DANGLING_RELATIONSHIP_TARGET: {
    code: "USD1002",
    rule: "usd-dangling-relationship-target",
    severity: "error" as const,
    message: (relName: string, primName: string, target: string) =>
      `Relationship '${relName}' on '${primName}' targets non-existent prim '<${target}>'.`,
  },
  INVALID_UP_AXIS: {
    code: "USD1003",
    rule: "usd-invalid-up-axis",
    severity: "error" as const,
    message: (axis: string) => `Invalid stage upAxis '${axis}'. OpenUSD requires 'Y' or 'Z'.`,
  },
  NON_POSITIVE_MASS: {
    code: "USD1004",
    rule: "usd-non-positive-mass",
    severity: "error" as const,
    message: (primName: string, value: number) =>
      `Physics mass for '${primName}' must be strictly positive (found: ${value}).`,
  },
  NEGATIVE_INERTIA: {
    code: "USD1005",
    rule: "usd-negative-inertia",
    severity: "error" as const,
    message: (primName: string, value: number) =>
      `Diagonal inertia components for '${primName}' must be non-negative (found: ${value}).`,
  },
  INVERTED_JOINT_LIMITS: {
    code: "USD1006",
    rule: "usd-inverted-joint-limits",
    severity: "error" as const,
    message: (primName: string, lower: number, upper: number) =>
      `Inverted joint limits on '${primName}': lowerLimit (${lower}) > upperLimit (${upper}).`,
  },
  INVALID_JOINT_AXIS: {
    code: "USD1007",
    rule: "usd-invalid-joint-axis",
    severity: "error" as const,
    message: (axis: string, primName: string) =>
      `Invalid joint axis '${axis}' on '${primName}'. Must be 'X', 'Y', or 'Z'.`,
  },
} as const;

export type UsdErrorCodeKey = keyof typeof UsdErrorCode;
