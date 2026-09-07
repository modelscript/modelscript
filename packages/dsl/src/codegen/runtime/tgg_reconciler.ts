/* eslint-disable */
// @ts-nocheck
/**
 * @fileoverview WASM TGG Multi-Master Conflict Reconciler
 *
 * Provides linear-memory conflict detection and constraint-based reconciliation
 * for concurrent multi-domain edits across the Digital Thread.
 */

import { CorrespondenceIndex, CORR_FLAG_CONFLICT, CORR_FLAG_SYNCED } from "./correspondence";

export const RECONCILE_STRATEGY_SMT: u32 = 0;
export const RECONCILE_STRATEGY_SOURCE_WINS: u32 = 1;
export const RECONCILE_STRATEGY_TARGET_WINS: u32 = 2;
export const RECONCILE_STRATEGY_NARROWER_RANGE: u32 = 3;

/**
 * Reconciles concurrent numeric parameter updates by computing continuous interval intersection.
 * If intervals overlap, resolves to the optimal consensus value and clears the conflict flag.
 * If disjoint, flags an irreconcilable conflict in the correspondence index.
 */
export function tgg_reconcile_interval(
  slot: u32,
  srcMin: f64,
  srcMax: f64,
  tgtMin: f64,
  tgtMax: f64,
  corr: CorrespondenceIndex
): f64 {
  let overlapMin: f64 = srcMin > tgtMin ? srcMin : tgtMin;
  let overlapMax: f64 = srcMax < tgtMax ? srcMax : tgtMax;

  if (overlapMin <= overlapMax) {
    // Solvable constraint: pick midpoint of overlapping region
    let consensusVal: f64 = (overlapMin + overlapMax) * 0.5;
    corr.clearConflict(slot);
    return consensusVal;
  }

  // Disjoint / irreconcilable: flag conflict
  corr.markConflict(slot);
  return f64.NaN;
}

/**
 * Reconciles scalar values based on designated resolution strategy.
 */
export function tgg_reconcile_scalar(
  slot: u32,
  srcVal: f64,
  tgtVal: f64,
  strategy: u32,
  corr: CorrespondenceIndex
): f64 {
  if (srcVal == tgtVal) {
    corr.clearConflict(slot);
    return srcVal;
  }

  if (strategy == RECONCILE_STRATEGY_SOURCE_WINS) {
    corr.clearConflict(slot);
    return srcVal;
  } else if (strategy == RECONCILE_STRATEGY_TARGET_WINS) {
    corr.clearConflict(slot);
    return tgtVal;
  } else if (strategy == RECONCILE_STRATEGY_NARROWER_RANGE) {
    // Prefer smaller absolute value or narrower deviation
    let chosen = Math.abs(srcVal) < Math.abs(tgtVal) ? srcVal : tgtVal;
    corr.clearConflict(slot);
    return chosen;
  }

  // Default SMT/strict: differing values without solver resolution constitute a conflict
  corr.markConflict(slot);
  return srcVal;
}
