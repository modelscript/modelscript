// SPDX-License-Identifier: AGPL-3.0-or-later

import { NumericalInterval as Interval } from "./interval_domain.js";

/**
 * Parametric symbolic segment partition of an array:
 *   - length: Interval bound on array size [dimLow, dimHigh]
 *   - universalSummary: Interval guaranteed to contain ALL elements
 *   - currentElement: Interval for current element at loop index i
 *   - prefixSummary: Elements before index i
 *   - suffixSummary: Elements after index i
 */
export class ArraySegmentState {
  constructor(
    public readonly length: Interval,
    public readonly universalSummary: Interval = Interval.TOP,
    public readonly currentElement: Interval = Interval.TOP,
    public readonly prefixSummary: Interval = Interval.TOP,
    public readonly suffixSummary: Interval = Interval.TOP,
  ) {}

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
    );
  }

  join(other: ArraySegmentState): ArraySegmentState {
    if (this.isBottom()) return other.clone();
    if (other.isBottom()) return this.clone();

    return new ArraySegmentState(
      this.length.join(other.length),
      this.universalSummary.join(other.universalSummary),
      this.currentElement.join(other.currentElement),
      this.prefixSummary.join(other.prefixSummary),
      this.suffixSummary.join(other.suffixSummary),
    );
  }

  meet(other: ArraySegmentState): ArraySegmentState {
    if (this.isBottom() || other.isBottom()) return ArraySegmentState.bottom();

    const len = this.length.meet(other.length);
    if (len.isBottom()) return ArraySegmentState.bottom();

    return new ArraySegmentState(
      len,
      this.universalSummary.meet(other.universalSummary),
      this.currentElement.meet(other.currentElement),
      this.prefixSummary.meet(other.prefixSummary),
      this.suffixSummary.meet(other.suffixSummary),
    );
  }

  widen(other: ArraySegmentState, thresholds?: number[]): ArraySegmentState {
    if (this.isBottom()) return other.clone();
    if (other.isBottom()) return this.clone();

    return new ArraySegmentState(
      this.length.widen(other.length, thresholds),
      this.universalSummary.widen(other.universalSummary, thresholds),
      this.currentElement.widen(other.currentElement, thresholds),
      this.prefixSummary.widen(other.prefixSummary, thresholds),
      this.suffixSummary.widen(other.suffixSummary, thresholds),
    );
  }

  /**
   * Asserts index access i in 1-based indexing [1, length].
   * Returns verification verdict.
   */
  checkInBounds(index: Interval): {
    inBounds: "safe" | "out_of_bounds" | "potential_out_of_bounds";
    validRange: Interval;
  } {
    if (this.isBottom() || index.isBottom()) {
      return { inBounds: "safe", validRange: Interval.BOTTOM };
    }

    const minLegal = 1;
    const maxLegal = this.length.high;

    // Definite out of bounds: index.high < 1 or index.low > maxLegal
    if (index.high < minLegal || (maxLegal !== Infinity && index.low > maxLegal)) {
      return { inBounds: "out_of_bounds", validRange: new Interval(minLegal, maxLegal) };
    }

    // Definite in bounds: index.low >= 1 and index.high <= this.length.low
    if (index.low >= minLegal && index.high <= this.length.low) {
      return { inBounds: "safe", validRange: new Interval(minLegal, this.length.low) };
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
    );
  }
}
