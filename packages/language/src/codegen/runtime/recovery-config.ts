// ============================================================================
// GLR Error Recovery Configuration & Heuristic Cost Parameters
// ============================================================================
//
// This file centralizes all cost constants, penalty weights, and threshold cutoffs
// used by the AssemblyScript GLR error recovery runtime (`recovery.ts`, `parser-loop.ts`).
//
// Theoretical Cost Hierarchy & Ranges:
// ------------------------------------
// 1. Tier 1 (0 - 15)     : Micro-repairs (Keyword substitution, direct terminal shift).
//                           Must be cheaper than deletion so typos (e.g., `err` -> `model`)
//                           are repaired in-place rather than silently discarded.
// 2. Tier 2 (20 - 100)   : Single Token Deletions & Small Unwinds.
//                           2x - 5x more expensive than micro-repairs.
// 3. Tier 3 (1,000 - 4k) : Structural / Line-Crossing Penalties.
//                           Penalizes discarding tokens or merging lines across newlines.
// 4. Tier 4 (10k - 20k)  : Structural Integrity Guards & Panic Mode Cutoff.
//                           Prevents phantom scope-closing braces and marks catastrophic failure.
// ============================================================================

// ----------------------------------------------------------------------------
// Tier 1: Micro-Repairs (Branch S & Branch T)
// ----------------------------------------------------------------------------

/**
 * Base cost added to `head.errorCost` when fixing a single-token keyword typo in Branch S
 * (e.g. `err` or `error` -> `model`). Kept at 10 to ensure keyword substitution strictly
 * beats token deletion (cost 20+).
 */
export const COST_SUBSTITUTION_KEYWORD: i32 = 10;

/**
 * Base cost added to `head.errorCost` when substituting a standard (non-keyword) terminal in Branch S.
 */
export const COST_SUBSTITUTION_STANDARD: i32 = 25;

/**
 * Base cost added to `head.errorCost` when forcing a shift on an expected terminal in Branch T.
 */
export const COST_SHIFT_TRANSITION: i32 = 15;

/**
 * Base cost penalty when reopening a parent head during Branch T shift recovery.
 */
export const COST_SHIFT_REOPEN_BASE: i32 = 20;

/**
 * Additional penalty per unwind depth level when reopening a parent head in Branch T.
 */
export const COST_SHIFT_REOPEN_PER_UNWIND: i32 = 10;


// ----------------------------------------------------------------------------
// Tier 2: Token Deletion & Unwind Penalties (Branch A)
// ----------------------------------------------------------------------------

/**
 * Multiplier applied to grammar-defined `token_delete_costs[tok]` table entries.
 */
export const COST_DELETE_BASE_MULTIPLIER: i32 = 25;

/**
 * Penalty added when discarding a single dangling token at the end of a line (before `\n`).
 */
export const PENALTY_DELETE_LINE_END_DANGLING: i32 = 100;

/**
 * Penalty added when deleting tokens across line boundaries (`\n`).
 */
export const PENALTY_DELETE_NEWLINE_CROSS: i32 = 1000;

/**
 * Heavy penalty added when discarding deeper subtrees across line boundaries during Branch A deletion,
 * preventing accidental multi-line structural destruction.
 */
export const PENALTY_DELETE_DEEP_UNWIND_LINE_MERGE: i32 = 4000;

/**
 * Penalty per duplicate token dropped (e.g. redundant semicolons `;;`).
 */
export const COST_DELETE_DUPLICATE_TOKEN: i32 = 5;

/**
 * Maximum cumulative deletion cost threshold before halting forward token deletion scanning in Branch A1.
 */
export const THRESHOLD_DELETE_SCAN_LIMIT: i32 = 4000;


// ----------------------------------------------------------------------------
// Tier 3 & 4: Structural Guards & Line Crossing Penalties (Branch B & S)
// ----------------------------------------------------------------------------

/**
 * Fallback cost when inserting a token whose grammar-defined insert cost is 0.
 */
export const COST_INSERT_BASE_DEFAULT: i32 = 10;

/**
 * Penalty added when inserting structural closing braces (`}`, `]`, `)`), preventing phantom scope closing
 * unless parsing has reached EOF.
 */
export const PENALTY_INSERT_STRUCTURAL_BRACE: i32 = 10000;

/**
 * Heavy penalty added when substituting tokens across line boundaries (`\n`), preventing multi-line operator pollution.
 */
export const PENALTY_SUBSTITUTION_CROSS_LINE: i32 = 20000;

/**
 * Penalty for fabricating inserted tokens across line boundaries in Branch B.
 */
export const PENALTY_INSERT_CROSS_LINE: i32 = 10000;

/**
 * Heavy penalty for multi-token sequence insertions across lines in Branch B.
 */
export const PENALTY_INSERT_MULTI_TOKEN_CROSS_LINE: i32 = 15000;

/**
 * Maximum allowed cost bound for Branch B retrograde insertion candidates.
 */
export const THRESHOLD_INSERT_MAX_COST: i32 = 10000;


// ----------------------------------------------------------------------------
// Global Thresholds, Island Mode & Pruning Cutoffs
// ----------------------------------------------------------------------------

/**
 * Cost threshold above which competing GLR heads are discarded in favor of catastrophic panic / island recovery mode.
 */
export const THRESHOLD_PANIC_MODE_CUTOFF: i32 = 20000;

/**
 * Maximum cost delta allowed between competing parse heads before higher-cost heads are pruned.
 */
export const THRESHOLD_HEAD_PRUNING_DISTANCE: i32 = 2000;

/**
 * Initial base penalty for initializing an island mode panic recovery head.
 */
export const COST_ISLAND_INITIAL_SYNC: i32 = 5;

/**
 * Cost penalty per AST node unwound during recovery.
 */
export let configPenaltyUnwindNode: i32 = 500;

/**
 * Cost penalty per token symbol synchronized.
 */
export let configPenaltySyncToken: i32 = 50;

/**
 * Base penalty for island mode recovery.
 */
export let configIslandBasePenalty: i32 = 2000;

/**
 * Multiplier for bytes consumed during island mode synchronization.
 */
export let configIslandSyncMultiplier: i32 = 10;

/**
 * Multiplier for nodes popped during island mode unwinding.
 */
export let configIslandPoppedMultiplier: i32 = 50;
