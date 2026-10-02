// SPDX-License-Identifier: AGPL-3.0-or-later

import { NumericalInterval as Interval } from "./interval_domain.js";

/**
 * Parametric symbolic segment partition of an array:
 *   - length: Interval bound on array size [dimLow, dimHigh]
 *   - universalSummary: Interval guaranteed to contain ALL elements
 *   - currentElement: Interval for current element at loop index i
 *   - prefixSummary: Elements before index i
 *   - suffixSummary: Elements after index i
 *
 * Implements the array segmentation abstract domain for verifying array loops
 * and index-dependent invariants.
 *
 * Academic Citations:
 *   - Cousot, P., Gopan, D., & Reps, T. (2005). "A framework for numeric analysis of array operations."
 *     In Proceedings of the 32nd ACM SIGPLAN-SIGACT Symposium on Principles of Programming
 *     Languages (POPL '05), pp. 338–350. DOI: 10.1145/1040305.1040333.
 *   - Dillig, I., Dillig, T., & Aiken, A. (2010). "Fluid updates: Beyond strong and weak updates."
 *     In Programming Languages and Systems (ESOP 2010), LNCS 6012, pp. 246–266. Springer.
 *     DOI: 10.1007/978-3-642-11957-6_14.
 *
 * ModelScript Architectural Rationale:
 *   Modelica algorithm sections and discrete controllers perform vectorized operations over
 *   discretization meshes, state vectors, and lookup tables. Standard abstract interpretation
 *   "smashes" all array elements into a single scalar interval, losing all index-specific properties.
 *   Array segmentation partitions an array dynamically into symbolic slices relative to loop counters,
 *   enabling strong updates for the active index and proving absence of array out-of-bounds errors.
 *
 * Modifications:
 *   - 5-part parametric symbolic partition adapted for Modelica 1-indexed for-loops.
 *   - Direct lattice join/meet operations over `NumericalInterval` bounds.
 *   - Integrated into the `FixpointSolver` verification waterfall.
 */
export class ArraySegmentState {
  public readonly dimensions?: Interval[];

  constructor(
    public readonly length: Interval,
    public readonly universalSummary: Interval = Interval.TOP,
    public readonly currentElement: Interval = Interval.TOP,
    public readonly prefixSummary: Interval = Interval.TOP,
    public readonly suffixSummary: Interval = Interval.TOP,
    dimensions?: Interval[],
  ) {
    this.dimensions = dimensions ?? (length ? [length] : undefined);
  }

  static bottom(): ArraySegmentState {
    return new ArraySegmentState(Interval.BOTTOM, Interval.BOTTOM, Interval.BOTTOM, Interval.BOTTOM, Interval.BOTTOM);
  }

  static top(): ArraySegmentState {
    return new ArraySegmentState(new Interval(0, Infinity), Interval.TOP, Interval.TOP, Interval.TOP, Interval.TOP);
  }

  isBottom(): boolean {
    return this.length.isBottom();
  }

  clone(): ArraySegmentState {
    return new ArraySegmentState(
      this.length,
      this.universalSummary,
      this.currentElement,
      this.prefixSummary,
      this.suffixSummary,
      this.dimensions ? [...this.dimensions] : undefined,
    );
  }

  join(other: ArraySegmentState): ArraySegmentState {
    if (this.isBottom()) return other.clone();
    if (other.isBottom()) return this.clone();

    let joinedDims: Interval[] | undefined;
    if (this.dimensions && other.dimensions) {
      joinedDims = this.dimensions.map((d, i) => (other.dimensions![i] ? d.join(other.dimensions![i]!) : d));
    } else if (this.dimensions) {
      joinedDims = [...this.dimensions];
    } else if (other.dimensions) {
      joinedDims = [...other.dimensions];
    }

    return new ArraySegmentState(
      this.length.join(other.length),
      this.universalSummary.join(other.universalSummary),
      this.currentElement.join(other.currentElement),
      this.prefixSummary.join(other.prefixSummary),
      this.suffixSummary.join(other.suffixSummary),
      joinedDims,
    );
  }

  meet(other: ArraySegmentState): ArraySegmentState {
    if (this.isBottom() || other.isBottom()) return ArraySegmentState.bottom();

    const len = this.length.meet(other.length);
    if (len.isBottom()) return ArraySegmentState.bottom();

    let metDims: Interval[] | undefined;
    if (this.dimensions && other.dimensions) {
      metDims = [];
      const maxLen = Math.max(this.dimensions.length, other.dimensions.length);
      for (let i = 0; i < maxLen; i++) {
        const d1 = this.dimensions[i];
        const d2 = other.dimensions[i];
        if (d1 && d2) {
          const m = d1.meet(d2);
          if (m.isBottom()) return ArraySegmentState.bottom();
          metDims.push(m);
        } else if (d1) {
          metDims.push(d1);
        } else if (d2) {
          metDims.push(d2);
        }
      }
    }

    return new ArraySegmentState(
      len,
      this.universalSummary.meet(other.universalSummary),
      this.currentElement.meet(other.currentElement),
      this.prefixSummary.meet(other.prefixSummary),
      this.suffixSummary.meet(other.suffixSummary),
      metDims,
    );
  }

  widen(other: ArraySegmentState, thresholds?: number[]): ArraySegmentState {
    if (this.isBottom()) return other.clone();
    if (other.isBottom()) return this.clone();

    let widenedDims: Interval[] | undefined;
    if (this.dimensions && other.dimensions) {
      widenedDims = this.dimensions.map((d, i) =>
        other.dimensions![i] ? d.widen(other.dimensions![i]!, thresholds) : d,
      );
    }

    return new ArraySegmentState(
      this.length.widen(other.length, thresholds),
      this.universalSummary.widen(other.universalSummary, thresholds),
      this.currentElement.widen(other.currentElement, thresholds),
      this.prefixSummary.widen(other.prefixSummary, thresholds),
      this.suffixSummary.widen(other.suffixSummary, thresholds),
      widenedDims,
    );
  }

  /**
   * Asserts index access i in 1-based indexing [1, length] (or [1, dimensions[dimIdx]]).
   * Returns verification verdict.
   */
  checkInBounds(
    index: Interval,
    dimIdx: number = 0,
  ): {
    inBounds: "safe" | "out_of_bounds" | "potential_out_of_bounds";
    validRange: Interval;
  } {
    if (this.isBottom() || index.isBottom()) {
      return { inBounds: "safe", validRange: Interval.BOTTOM };
    }

    const targetDim = this.dimensions && this.dimensions[dimIdx] ? this.dimensions[dimIdx]! : this.length;
    const minLegal = 1;
    const maxLegal = targetDim.high;

    // Definite out of bounds: index.high < 1 or index.low > maxLegal
    if (index.high < minLegal || (maxLegal !== Infinity && index.low > maxLegal)) {
      return { inBounds: "out_of_bounds", validRange: new Interval(minLegal, maxLegal) };
    }

    // Definite in bounds: index.low >= 1 and index.high <= targetDim.low
    if (index.low >= minLegal && index.high <= targetDim.low) {
      return { inBounds: "safe", validRange: new Interval(minLegal, targetDim.low) };
    }

    return { inBounds: "potential_out_of_bounds", validRange: new Interval(minLegal, maxLegal) };
  }

  updateElement(value: Interval): ArraySegmentState {
    return new ArraySegmentState(
      this.length,
      this.universalSummary.join(value),
      value,
      this.prefixSummary.join(this.currentElement),
      this.suffixSummary,
      this.dimensions ? [...this.dimensions] : undefined,
    );
  }
}
