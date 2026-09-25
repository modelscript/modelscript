// SPDX-License-Identifier: AGPL-3.0-or-later

import { OCTAGON_INF, OctagonDBM } from "../../analysis/octagon_dbm.js";
import { ArraySegmentState } from "./array_segment_domain.js";
import type { AbstractDomain } from "./domain.js";
import { NumericalInterval as Interval, IntervalDomain, IntervalEnvironment } from "./interval_domain.js";

/**
 * State of the Reduced Product Domain combining:
 *   1. Machine-precision Numerical Intervals
 *   2. Relational Octagon Difference Bound Matrix (±x_i ± x_j ≤ c)
 *   3. Symbolic Array Segment Partitions
 */
export class ReducedProductState {
  constructor(
    public readonly intervals: IntervalEnvironment,
    public readonly octagon: OctagonDBM,
    public readonly varIndices: Map<string, number>,
    public readonly arraySegments: Map<string, ArraySegmentState> = new Map(),
    public readonly isBottomState: boolean = false,
  ) {}

  static top(maxVars: number = 32): ReducedProductState {
    return new ReducedProductState(IntervalEnvironment.top(), new OctagonDBM(maxVars), new Map(), new Map(), false);
  }

  static bottom(maxVars: number = 32): ReducedProductState {
    const s = new ReducedProductState(
      IntervalEnvironment.bottom(),
      new OctagonDBM(maxVars),
      new Map(),
      new Map(),
      true,
    );
    return s;
  }

  isBottom(): boolean {
    return this.isBottomState || this.intervals.isBottomState || this.octagon.hasNegativeCycle();
  }

  clone(): ReducedProductState {
    const newIndices = new Map(this.varIndices);
    const newArrays = new Map<string, ArraySegmentState>();
    for (const [k, v] of this.arraySegments) {
      newArrays.set(k, v.clone());
    }
    return new ReducedProductState(
      this.intervals.clone(),
      this.octagon.clone(),
      newIndices,
      newArrays,
      this.isBottomState,
    );
  }

  getVarIndex(name: string): number {
    let idx = this.varIndices.get(name);
    if (idx === undefined) {
      idx = this.varIndices.size;
      if (idx < this.octagon.numVars) {
        this.varIndices.set(name, idx);
      }
    }
    return idx;
  }

  /**
   * Bidirectional reduction between Intervals and Octagon DBM.
   * Tightens intervals using relational DBM closure and vice-versa.
   */
  reduce(): ReducedProductState {
    if (this.isBottom()) {
      return ReducedProductState.bottom(this.octagon.numVars);
    }

    // 1. Intervals -> Octagon
    for (const [name, ival] of this.intervals.entries()) {
      if (ival.isBottom()) return ReducedProductState.bottom(this.octagon.numVars);
      const idx = this.getVarIndex(name);
      if (idx < this.octagon.numVars) {
        if (ival.high !== Infinity && !isNaN(ival.high)) {
          this.octagon.setInterval(idx, -OCTAGON_INF / 2, Math.floor(ival.high));
        }
        if (ival.low !== -Infinity && !isNaN(ival.low)) {
          this.octagon.setInterval(idx, Math.ceil(ival.low), OCTAGON_INF / 2);
        }
      }
    }

    // 2. Transitive closure in Octagon DBM
    this.octagon.close();

    if (this.octagon.hasNegativeCycle()) {
      return ReducedProductState.bottom(this.octagon.numVars);
    }

    // 3. Octagon -> Intervals tightening
    let tightenedEnv = this.intervals;
    for (const [name, idx] of this.varIndices.entries()) {
      const dbmLow = this.octagon.getLowerBound(idx);
      const dbmHigh = this.octagon.getUpperBound(idx);

      const dbmIval = new Interval(
        dbmLow === -OCTAGON_INF ? -Infinity : dbmLow,
        dbmHigh === OCTAGON_INF ? Infinity : dbmHigh,
      );

      const curr = tightenedEnv.get(name);
      const meetIval = curr.meet(dbmIval);
      if (meetIval.isBottom()) {
        return ReducedProductState.bottom(this.octagon.numVars);
      }
      if (!meetIval.equals(curr)) {
        tightenedEnv = tightenedEnv.set(name, meetIval);
      }
    }

    return new ReducedProductState(tightenedEnv, this.octagon, this.varIndices, this.arraySegments, false);
  }
}

/**
 * Formal AbstractDomain instance for ReducedProductState.
 */
export class ReducedProductDomain implements AbstractDomain<ReducedProductState> {
  readonly name = "ReducedProductDomain";
  private intervalDomain = new IntervalDomain();

  constructor(private maxVars: number = 64) {}

  top(): ReducedProductState {
    return ReducedProductState.top(this.maxVars);
  }

  bottom(): ReducedProductState {
    return ReducedProductState.bottom(this.maxVars);
  }

  isBottom(state: ReducedProductState): boolean {
    return state.isBottom();
  }

  isTop(state: ReducedProductState): boolean {
    return this.intervalDomain.isTop(state.intervals);
  }

  isLeq(a: ReducedProductState, b: ReducedProductState): boolean {
    if (a.isBottom()) return true;
    if (b.isBottom()) return false;
    return this.intervalDomain.isLeq(a.intervals, b.intervals) && a.octagon.isLeq(b.octagon);
  }

  join(a: ReducedProductState, b: ReducedProductState): ReducedProductState {
    if (a.isBottom()) return b.clone();
    if (b.isBottom()) return a.clone();

    const joinedIntervals = this.intervalDomain.join(a.intervals, b.intervals);
    const joinedOctagon = a.octagon.join(b.octagon);

    // Merge array segment states
    const joinedArrays = new Map<string, ArraySegmentState>();
    const allArrayKeys = new Set([...a.arraySegments.keys(), ...b.arraySegments.keys()]);
    for (const k of allArrayKeys) {
      const aArr = a.arraySegments.get(k) ?? ArraySegmentState.top();
      const bArr = b.arraySegments.get(k) ?? ArraySegmentState.top();
      joinedArrays.set(k, aArr.join(bArr));
    }

    const mergedIndices = new Map(a.varIndices);
    for (const [k, v] of b.varIndices) {
      if (!mergedIndices.has(k)) mergedIndices.set(k, v);
    }

    const res = new ReducedProductState(joinedIntervals, joinedOctagon, mergedIndices, joinedArrays, false);
    return res.reduce();
  }

  meet(a: ReducedProductState, b: ReducedProductState): ReducedProductState {
    if (a.isBottom() || b.isBottom()) return this.bottom();

    const meetIntervals = this.intervalDomain.meet(a.intervals, b.intervals);
    if (this.intervalDomain.isBottom(meetIntervals)) return this.bottom();

    const meetOctagon = a.octagon.meet(b.octagon);
    if (meetOctagon.hasNegativeCycle()) return this.bottom();

    const meetArrays = new Map<string, ArraySegmentState>();
    const allArrayKeys = new Set([...a.arraySegments.keys(), ...b.arraySegments.keys()]);
    for (const k of allArrayKeys) {
      const aArr = a.arraySegments.get(k) ?? ArraySegmentState.top();
      const bArr = b.arraySegments.get(k) ?? ArraySegmentState.top();
      const m = aArr.meet(bArr);
      if (m.isBottom()) return this.bottom();
      meetArrays.set(k, m);
    }

    const mergedIndices = new Map(a.varIndices);
    for (const [k, v] of b.varIndices) {
      if (!mergedIndices.has(k)) mergedIndices.set(k, v);
    }

    const res = new ReducedProductState(meetIntervals, meetOctagon, mergedIndices, meetArrays, false);
    return res.reduce();
  }

  widen(a: ReducedProductState, b: ReducedProductState, thresholds?: number[]): ReducedProductState {
    if (a.isBottom()) return b.clone();
    if (b.isBottom()) return a.clone();

    const widenedIntervals = this.intervalDomain.widen(a.intervals, b.intervals, thresholds);
    const widenedOctagon = a.octagon.widenWithThresholds(b.octagon, thresholds);

    const widenedArrays = new Map<string, ArraySegmentState>();
    const allArrayKeys = new Set([...a.arraySegments.keys(), ...b.arraySegments.keys()]);
    for (const k of allArrayKeys) {
      const aArr = a.arraySegments.get(k) ?? ArraySegmentState.top();
      const bArr = b.arraySegments.get(k) ?? ArraySegmentState.top();
      widenedArrays.set(k, aArr.widen(bArr, thresholds));
    }

    const mergedIndices = new Map(a.varIndices);
    for (const [k, v] of b.varIndices) {
      if (!mergedIndices.has(k)) mergedIndices.set(k, v);
    }

    return new ReducedProductState(widenedIntervals, widenedOctagon, mergedIndices, widenedArrays, false);
  }

  narrow(a: ReducedProductState, b: ReducedProductState): ReducedProductState {
    if (a.isBottom() || b.isBottom()) return this.bottom();

    const narrowedIntervals = this.intervalDomain.narrow(a.intervals, b.intervals);
    const narrowedOctagon = a.octagon.narrow(b.octagon);

    return new ReducedProductState(narrowedIntervals, narrowedOctagon, a.varIndices, a.arraySegments, false).reduce();
  }

  clone(state: ReducedProductState): ReducedProductState {
    return state.clone();
  }

  equals(a: ReducedProductState, b: ReducedProductState): boolean {
    if (a.isBottom() && b.isBottom()) return true;
    if (a.isBottom() !== b.isBottom()) return false;
    return this.intervalDomain.equals(a.intervals, b.intervals);
  }
}
