// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Abstract Domain Interface.
 *
 * Formal lattice operations required for Cousot-style abstract interpretation:
 *   - Lattice structure: (Top, Bottom, partial order ⊑, join ⊔, meet ⊓)
 *   - Fixpoint acceleration: Widening (∇) and Narrowing (Δ)
 *   - Semantic transformers: assign, assume
 */

export interface AbstractDomain<State> {
  readonly name: string;

  /** The unconstrained / unknown state (⊤). */
  top(): State;

  /** The unreachable / contradictory state (⊥). */
  bottom(): State;

  /** Tests whether a state is contradictory / unreachable (⊥). */
  isBottom(state: State): boolean;

  /** Tests whether a state is unconstrained (⊤). */
  isTop(state: State): boolean;

  /** Partial order test: a ⊑ b (true if state 'a' is at least as precise/specific as 'b'). */
  isLeq(a: State, b: State): boolean;

  /** Computes the least upper bound (join / ⊔) representing control-flow merge. */
  join(a: State, b: State): State;

  /** Computes the greatest lower bound (meet / ⊓) representing branch restriction. */
  meet(a: State, b: State): State;

  /**
   * Widening operator (∇) to ensure termination across infinite ascending chains.
   * Optionally guided by a sorted array of literal thresholds.
   */
  widen(a: State, b: State, thresholds?: number[]): State;

  /** Narrowing operator (Δ) to recover precision following fixpoint convergence. */
  narrow(a: State, b: State): State;

  /** Deep-clones the abstract state. */
  clone(state: State): State;

  /** Equality test between two abstract states. */
  equals(a: State, b: State): boolean;
}
