// SPDX-License-Identifier: AGPL-3.0-or-later

import { Float64OctagonDBM, OCTAGON_INF, OCTAGON_INF_F64, OctagonDBM } from "../../analysis/octagon_dbm.js";
import { ArraySegmentState } from "./array_segment_domain.js";
import type { AbstractDomain } from "./domain.js";
import { NumericalInterval as Interval, IntervalDomain, IntervalEnvironment } from "./interval_domain.js";
import { TvpiDomain, TvpiState } from "./tvpi_domain.js";

/**
 * State of the Reduced Product Domain combining:
 *   1. Machine-precision Numerical Intervals
 *   2. Relational Octagon Difference Bound Matrix (±x_i ± x_j ≤ c)
 *   3. Symbolic Array Segment Partitions
 *   4. Relational Two-Variables-Per-Inequality (TVPI) Planar Network (a*x + b*y ≤ c)
 */
export class ReducedProductState {
  constructor(
    public readonly intervals: IntervalEnvironment,
    public readonly octagon: OctagonDBM | Float64OctagonDBM,
    public readonly varIndices: Map<string, number>,
    public readonly arraySegments: Map<string, ArraySegmentState> = new Map(),
    public readonly isBottomState: boolean = false,
    public readonly tvpi: TvpiState = TvpiState.top(),
  ) {}

  static top(maxVars: number = 32): ReducedProductState {
    return new ReducedProductState(
      IntervalEnvironment.top(),
      new OctagonDBM(maxVars),
      new Map(),
      new Map(),
      false,
      TvpiState.top(),
    );
  }

  static topContinuous(maxVars: number = 32): ReducedProductState {
    return new ReducedProductState(
      IntervalEnvironment.top(),
      new Float64OctagonDBM(maxVars),
      new Map(),
      new Map(),
      false,
      TvpiState.top(),
    );
  }

  static bottom(maxVars: number = 32): ReducedProductState {
    const s = new ReducedProductState(
      IntervalEnvironment.bottom(),
      new OctagonDBM(maxVars),
      new Map(),
      new Map(),
      true,
      TvpiState.bottom(),
    );
    return s;
  }

  isBottom(): boolean {
    return (
      this.isBottomState || this.intervals.isBottomState || this.octagon.hasNegativeCycle() || this.tvpi.isBottomState
    );
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
      this.tvpi.clone(),
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
    const isF64 = this.octagon instanceof Float64OctagonDBM;
    const infBound = isF64 ? OCTAGON_INF_F64 / 2 : OCTAGON_INF / 2;

    for (const [name, ival] of this.intervals.entries()) {
      if (ival.isBottom()) return ReducedProductState.bottom(this.octagon.numVars);
      const idx = this.getVarIndex(name);
      if (idx < this.octagon.numVars) {
        let low: number;
        let high: number;
        if (isF64) {
          low = ival.low !== -Infinity && !isNaN(ival.low) ? ival.low : -infBound;
          high = ival.high !== Infinity && !isNaN(ival.high) ? ival.high : infBound;
        } else {
          low = ival.low !== -Infinity && !isNaN(ival.low) ? Math.floor(ival.low) : -infBound;
          high = ival.high !== Infinity && !isNaN(ival.high) ? Math.ceil(ival.high) : infBound;
        }
        this.octagon.setInterval(idx, low, high);
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
        dbmLow <= -infBound || dbmLow === -Infinity ? -Infinity : dbmLow,
        dbmHigh >= infBound || dbmHigh === Infinity ? Infinity : dbmHigh,
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

    // 4. Bidirectional Intervals <-> TVPI reduction
    if (this.tvpi.pairs.size > 0) {
      for (const [pairKey, poly] of this.tvpi.pairs.entries()) {
        const [u, v] = pairKey.split("|");
        if (!u || !v) continue;
        const uIval = tightenedEnv.get(u);
        const vIval = tightenedEnv.get(v);
        if (uIval.isBottom() || vIval.isBottom()) {
          return ReducedProductState.bottom(this.octagon.numVars);
        }
        if (Number.isFinite(uIval.high)) {
          if (!poly.addConstraint(1, 0, uIval.high)) return ReducedProductState.bottom(this.octagon.numVars);
        }
        if (Number.isFinite(uIval.low)) {
          if (!poly.addConstraint(-1, 0, -uIval.low)) return ReducedProductState.bottom(this.octagon.numVars);
        }
        if (Number.isFinite(vIval.high)) {
          if (!poly.addConstraint(0, 1, vIval.high)) return ReducedProductState.bottom(this.octagon.numVars);
        }
        if (Number.isFinite(vIval.low)) {
          if (!poly.addConstraint(0, -1, -vIval.low)) return ReducedProductState.bottom(this.octagon.numVars);
        }
      }

      if (!this.tvpi.close()) {
        return ReducedProductState.bottom(this.octagon.numVars);
      }

      for (const [pairKey, poly] of this.tvpi.pairs.entries()) {
        const [u, v] = pairKey.split("|");
        if (!u || !v) continue;
        const uHigh = poly.support(1, 0);
        const uLow = -poly.support(-1, 0);
        if (uLow > uHigh + 1e-7) {
          return ReducedProductState.bottom(this.octagon.numVars);
        }
        if (Number.isFinite(uLow) || Number.isFinite(uHigh)) {
          const currU = tightenedEnv.get(u);
          const meetU = currU.meet(new Interval(uLow, uHigh));
          if (meetU.isBottom()) return ReducedProductState.bottom(this.octagon.numVars);
          if (!meetU.equals(currU)) tightenedEnv = tightenedEnv.set(u, meetU);
        }

        const vHigh = poly.support(0, 1);
        const vLow = -poly.support(0, -1);
        if (vLow > vHigh + 1e-7) {
          return ReducedProductState.bottom(this.octagon.numVars);
        }
        if (Number.isFinite(vLow) || Number.isFinite(vHigh)) {
          const currV = tightenedEnv.get(v);
          const meetV = currV.meet(new Interval(vLow, vHigh));
          if (meetV.isBottom()) return ReducedProductState.bottom(this.octagon.numVars);
          if (!meetV.equals(currV)) tightenedEnv = tightenedEnv.set(v, meetV);
        }
      }
    }

    return new ReducedProductState(tightenedEnv, this.octagon, this.varIndices, this.arraySegments, false, this.tvpi);
  }
}

/**
 * Formal AbstractDomain instance for ReducedProductState.
 */
export class ReducedProductDomain implements AbstractDomain<ReducedProductState> {
  readonly name = "ReducedProductDomain";
  private intervalDomain = new IntervalDomain();
  private tvpiDomain = new TvpiDomain();

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
    if (state.isBottom()) return false;
    return this.intervalDomain.isTop(state.intervals) && this.tvpiDomain.isTop(state.tvpi);
  }

  /**
   * Aligns two ReducedProductState octagons into a single shared variable-index space
   * so that matrix-level join/meet/widen/narrow/isLeq never merge unrelated variables
   * when branches allocate variables in different orders.
   */
  private alignOctagons(
    a: ReducedProductState,
    b: ReducedProductState,
  ):
    | { isF64: true; octA: Float64OctagonDBM; octB: Float64OctagonDBM; mergedIndices: Map<string, number> }
    | { isF64: false; octA: OctagonDBM; octB: OctagonDBM; mergedIndices: Map<string, number> } {
    const mergedIndices = new Map<string, number>();
    let nextIdx = 0;
    for (const k of a.varIndices.keys()) {
      mergedIndices.set(k, nextIdx++);
    }
    for (const k of b.varIndices.keys()) {
      if (!mergedIndices.has(k)) mergedIndices.set(k, nextIdx++);
    }

    const useF64 = a.octagon instanceof Float64OctagonDBM || b.octagon instanceof Float64OctagonDBM;
    const totalVars = Math.max(this.maxVars, nextIdx);

    const copyBounds = <T extends OctagonDBM | Float64OctagonDBM>(src: ReducedProductState, dst: T): T => {
      const srcInf = src.octagon instanceof Float64OctagonDBM ? OCTAGON_INF_F64 : OCTAGON_INF;
      const entries = Array.from(src.varIndices.entries());
      for (const [varI, oldI] of entries) {
        const newI = mergedIndices.get(varI)!;
        for (const [varJ, oldJ] of entries) {
          const newJ = mergedIndices.get(varJ)!;
          for (let si = 0; si < 2; si++) {
            for (let sj = 0; sj < 2; sj++) {
              const val = src.octagon.getBound(oldI * 2 + si, oldJ * 2 + sj);
              if (val < srcInf) {
                dst.setBound(newI * 2 + si, newJ * 2 + sj, val);
              }
            }
          }
        }
      }
      return dst;
    };

    if (useF64) {
      return {
        isF64: true,
        octA: copyBounds(a, new Float64OctagonDBM(totalVars)),
        octB: copyBounds(b, new Float64OctagonDBM(totalVars)),
        mergedIndices,
      };
    }
    return {
      isF64: false,
      octA: copyBounds(a, new OctagonDBM(totalVars)),
      octB: copyBounds(b, new OctagonDBM(totalVars)),
      mergedIndices,
    };
  }

  isLeq(a: ReducedProductState, b: ReducedProductState): boolean {
    if (a.isBottom()) return true;
    if (b.isBottom()) return false;
    const aligned = this.alignOctagons(a, b);
    const octLeq = aligned.isF64 ? aligned.octA.isLeq(aligned.octB) : aligned.octA.isLeq(aligned.octB);
    return this.intervalDomain.isLeq(a.intervals, b.intervals) && octLeq && this.tvpiDomain.isLeq(a.tvpi, b.tvpi);
  }

  join(a: ReducedProductState, b: ReducedProductState): ReducedProductState {
    if (a.isBottom()) return b.clone();
    if (b.isBottom()) return a.clone();

    const joinedIntervals = this.intervalDomain.join(a.intervals, b.intervals);
    const aligned = this.alignOctagons(a, b);
    const joinedOctagon = aligned.isF64 ? aligned.octA.join(aligned.octB) : aligned.octA.join(aligned.octB);
    const joinedTvpi = this.tvpiDomain.join(a.tvpi, b.tvpi);

    // Merge array segment states
    const joinedArrays = new Map<string, ArraySegmentState>();
    const allArrayKeys = new Set([...a.arraySegments.keys(), ...b.arraySegments.keys()]);
    for (const k of allArrayKeys) {
      const aArr = a.arraySegments.get(k) ?? ArraySegmentState.top();
      const bArr = b.arraySegments.get(k) ?? ArraySegmentState.top();
      joinedArrays.set(k, aArr.join(bArr));
    }

    const res = new ReducedProductState(
      joinedIntervals,
      joinedOctagon,
      aligned.mergedIndices,
      joinedArrays,
      false,
      joinedTvpi,
    );
    return res.reduce();
  }

  meet(a: ReducedProductState, b: ReducedProductState): ReducedProductState {
    if (a.isBottom() || b.isBottom()) return this.bottom();

    const meetIntervals = this.intervalDomain.meet(a.intervals, b.intervals);
    if (this.intervalDomain.isBottom(meetIntervals)) return this.bottom();

    const aligned = this.alignOctagons(a, b);
    const meetOctagon = aligned.isF64 ? aligned.octA.meet(aligned.octB) : aligned.octA.meet(aligned.octB);
    if (meetOctagon.hasNegativeCycle()) return this.bottom();

    const meetTvpi = this.tvpiDomain.meet(a.tvpi, b.tvpi);
    if (this.tvpiDomain.isBottom(meetTvpi)) return this.bottom();

    const meetArrays = new Map<string, ArraySegmentState>();
    const allArrayKeys = new Set([...a.arraySegments.keys(), ...b.arraySegments.keys()]);
    for (const k of allArrayKeys) {
      const aArr = a.arraySegments.get(k) ?? ArraySegmentState.top();
      const bArr = b.arraySegments.get(k) ?? ArraySegmentState.top();
      const m = aArr.meet(bArr);
      if (m.isBottom()) return this.bottom();
      meetArrays.set(k, m);
    }

    const res = new ReducedProductState(meetIntervals, meetOctagon, aligned.mergedIndices, meetArrays, false, meetTvpi);
    return res.reduce();
  }

  widen(a: ReducedProductState, b: ReducedProductState, thresholds?: number[]): ReducedProductState {
    if (a.isBottom()) return b.clone();
    if (b.isBottom()) return a.clone();

    const widenedIntervals = this.intervalDomain.widen(a.intervals, b.intervals, thresholds);
    const aligned = this.alignOctagons(a, b);
    const widenedOctagon = aligned.isF64
      ? aligned.octA.widenWithThresholds(aligned.octB, thresholds)
      : aligned.octA.widenWithThresholds(aligned.octB, thresholds);
    const widenedTvpi = this.tvpiDomain.widen(a.tvpi, b.tvpi, thresholds);

    const widenedArrays = new Map<string, ArraySegmentState>();
    const allArrayKeys = new Set([...a.arraySegments.keys(), ...b.arraySegments.keys()]);
    for (const k of allArrayKeys) {
      const aArr = a.arraySegments.get(k) ?? ArraySegmentState.top();
      const bArr = b.arraySegments.get(k) ?? ArraySegmentState.top();
      widenedArrays.set(k, aArr.widen(bArr, thresholds));
    }

    return new ReducedProductState(
      widenedIntervals,
      widenedOctagon,
      aligned.mergedIndices,
      widenedArrays,
      false,
      widenedTvpi,
    );
  }

  narrow(a: ReducedProductState, b: ReducedProductState): ReducedProductState {
    if (a.isBottom() || b.isBottom()) return this.bottom();

    const narrowedIntervals = this.intervalDomain.narrow(a.intervals, b.intervals);
    const aligned = this.alignOctagons(a, b);
    const narrowedOctagon = aligned.isF64 ? aligned.octA.narrow(aligned.octB) : aligned.octA.narrow(aligned.octB);
    const narrowedTvpi = this.tvpiDomain.narrow(a.tvpi, b.tvpi);

    return new ReducedProductState(
      narrowedIntervals,
      narrowedOctagon,
      aligned.mergedIndices,
      new Map(a.arraySegments),
      false,
      narrowedTvpi,
    ).reduce();
  }

  clone(state: ReducedProductState): ReducedProductState {
    return state.clone();
  }

  equals(a: ReducedProductState, b: ReducedProductState): boolean {
    if (a.isBottom() && b.isBottom()) return true;
    if (a.isBottom() !== b.isBottom()) return false;
    if (!this.intervalDomain.equals(a.intervals, b.intervals)) return false;
    if (!this.tvpiDomain.equals(a.tvpi, b.tvpi)) return false;
    const aligned = this.alignOctagons(a, b);
    const octEq = aligned.isF64
      ? aligned.octA.isLeq(aligned.octB) && aligned.octB.isLeq(aligned.octA)
      : aligned.octA.isLeq(aligned.octB) && aligned.octB.isLeq(aligned.octA);
    if (!octEq) return false;
    return true;
  }
}
