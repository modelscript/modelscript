// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An execution block natively representing a sorted step in the ArenaDAEBuilder evaluation order.
 */
export type ArenaExecutionBlock =
  | { type: "single"; varIdx: number; exprId: number }
  | { type: "system"; eqIdxs: number[]; vars: number[] }
  | { type: "algorithm"; stmtIdxs: number[] };
