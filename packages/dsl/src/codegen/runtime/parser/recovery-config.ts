// SPDX-License-Identifier: AGPL-3.0-or-later

// ============================================================================
// GLR Error Recovery Configuration (DAG GSS, Error State, Pruning)
// ============================================================================

/** Maximum stack depth recorded in StackSummary upon entering error state */
export const MAX_SUMMARY_DEPTH: u32 = 16;

/** Maximum relative cost delta before pruning competing parse heads */
export const MAX_COST_DIFFERENCE: i32 = 7000;

/** Maximum edit operations allowed in a single bounded local A* repair sequence */
export const MAX_LOCAL_EDITS: i32 = 2;

/** Maximum search nodes expanded per bounded local A* repair call */
export const MAX_LOCAL_EXPANSIONS: i32 = 48;

/** Fixed scratch pool size for bounded local A* repair (zero-GC, isolated from GSS buffers) */
export const MAX_LOCAL_NODES: i32 = 64;

/** Number of consecutive real token shifts required to confirm a multi-edit local A* repair */
export const LOCAL_CONFIRM_SHIFTS: i32 = 3;

/** Maximum MRD-guided completion steps at TOKEN_EOF */
export const MAX_EOF_COMPLETIONS: i32 = 4;
