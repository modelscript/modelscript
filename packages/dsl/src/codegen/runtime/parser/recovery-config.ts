// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// GLR Error Recovery Configuration (DAG GSS, Error State, Pruning)
// ============================================================================

/** Maximum stack depth recorded in StackSummary upon entering error state */
export const MAX_SUMMARY_DEPTH: u32 = 16;

/** Maximum relative cost delta before pruning competing parse heads */
export const MAX_COST_DIFFERENCE: i32 = 7000;
