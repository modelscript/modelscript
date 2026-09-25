// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AbstractDomain } from "./domain.js";

/**
 * Single numerical interval [low, high].
 * Supports ±Infinity and precise integer / floating-point bounds.
 */
export class NumericalInterval {
  constructor(
    public readonly low: number,
    public readonly high: number,
  ) {}

  static readonly TOP = new NumericalInterval(-Infinity, Infinity);
  static readonly BOTTOM = new NumericalInterval(Infinity, -Infinity);
  static readonly ZERO = new NumericalInterval(0, 0);
  static readonly ONE = new NumericalInterval(1, 1);
  static readonly NON_NEGATIVE = new NumericalInterval(0, Infinity);
  static readonly POSITIVE = new NumericalInterval(1e-15, Infinity);

  static const(val: number): NumericalInterval {
    if (isNaN(val)) return NumericalInterval.BOTTOM;
    return new NumericalInterval(val, val);
  }

  isBottom(): boolean {
    return this.low > this.high || isNaN(this.low) || isNaN(this.high);
  }

  isTop(): boolean {
    return this.low === -Infinity && this.high === Infinity;
  }

  isConstant(): boolean {
    return !this.isBottom() && this.low === this.high;
  }

  canBeZero(): boolean {
    return !this.isBottom() && this.low <= 0 && this.high >= 0;
  }

  isDefiniteZero(): boolean {
    return !this.isBottom() && this.low === 0 && this.high === 0;
  }

  isDefinitePositive(): boolean {
    return !this.isBottom() && this.low > 0;
  }

  isDefiniteNonNegative(): boolean {
    return !this.isBottom() && this.low >= 0;
  }

  contains(val: number): boolean {
    if (this.isBottom()) return false;
    return val >= this.low && val <= this.high;
  }

  equals(other: NumericalInterval): boolean {
    if (this.isBottom() && other.isBottom()) return true;
    if (this.isBottom() !== other.isBottom()) return false;
    return this.low === other.low && this.high === other.high;
  }

  isLeq(other: NumericalInterval): boolean {
    if (this.isBottom()) return true;
    if (other.isBottom()) return false;
    return this.low >= other.low && this.high <= other.high;
  }

  join(other: NumericalInterval): NumericalInterval {
    if (this.isBottom()) return other;
    if (other.isBottom()) return this;
    return new NumericalInterval(Math.min(this.low, other.low), Math.max(this.high, other.high));
  }

  meet(other: NumericalInterval): NumericalInterval {
    if (this.isBottom() || other.isBottom()) return NumericalInterval.BOTTOM;
    const l = Math.max(this.low, other.low);
    const h = Math.min(this.high, other.high);
    if (l > h) return NumericalInterval.BOTTOM;
    return new NumericalInterval(l, h);
  }

  widen(other: NumericalInterval, thresholds?: number[]): NumericalInterval {
    if (this.isBottom()) return other;
    if (other.isBottom()) return this;

    let newLow = this.low;
    let newHigh = this.high;

    if (other.low < this.low) {
      if (thresholds && thresholds.length > 0) {
        let tLow = -Infinity;
        for (let i = thresholds.length - 1; i >= 0; i--) {
          const t = thresholds[i]!;
          if (t <= other.low) {
            tLow = t;
            break;
          }
        }
        newLow = tLow;
      } else {
        newLow = -Infinity;
      }
    }

    if (other.high > this.high) {
      if (thresholds && thresholds.length > 0) {
        let tHigh = Infinity;
        for (let i = 0; i < thresholds.length; i++) {
          const t = thresholds[i]!;
          if (t >= other.high) {
            tHigh = t;
            break;
          }
        }
        newHigh = tHigh;
      } else {
        newHigh = Infinity;
      }
    }

    return new NumericalInterval(newLow, newHigh);
  }

  narrow(other: NumericalInterval): NumericalInterval {
    if (this.isBottom() || other.isBottom()) return NumericalInterval.BOTTOM;
    const newLow = this.low === -Infinity ? other.low : this.low;
    const newHigh = this.high === Infinity ? other.high : this.high;
    return new NumericalInterval(newLow, newHigh);
  }

  add(other: NumericalInterval): NumericalInterval {
    if (this.isBottom() || other.isBottom()) return NumericalInterval.BOTTOM;
    return new NumericalInterval(this.low + other.low, this.high + other.high);
  }

  sub(other: NumericalInterval): NumericalInterval {
    if (this.isBottom() || other.isBottom()) return NumericalInterval.BOTTOM;
    return new NumericalInterval(this.low - other.high, this.high - other.low);
  }

  neg(): NumericalInterval {
    if (this.isBottom()) return NumericalInterval.BOTTOM;
    return new NumericalInterval(-this.high, -this.low);
  }

  mul(other: NumericalInterval): NumericalInterval {
    if (this.isBottom() || other.isBottom()) return NumericalInterval.BOTTOM;
    const p1 = this.low * other.low;
    const p2 = this.low * other.high;
    const p3 = this.high * other.low;
    const p4 = this.high * other.high;
    return new NumericalInterval(Math.min(p1, p2, p3, p4), Math.max(p1, p2, p3, p4));
  }

  div(other: NumericalInterval): { result: NumericalInterval; divisionByZero: "never" | "possible" | "definite" } {
    if (this.isBottom() || other.isBottom()) {
      return { result: NumericalInterval.BOTTOM, divisionByZero: "never" };
    }
    if (other.isDefiniteZero()) {
      return { result: NumericalInterval.BOTTOM, divisionByZero: "definite" };
    }
    const possibleZero = other.canBeZero();

    let nonZeroOther = other;
    if (possibleZero) {
      if (other.low === 0) {
        nonZeroOther = new NumericalInterval(1e-15, other.high);
      } else if (other.high === 0) {
        nonZeroOther = new NumericalInterval(other.low, -1e-15);
      } else {
        return { result: NumericalInterval.TOP, divisionByZero: "possible" };
      }
    }

    const d1 = this.low / nonZeroOther.low;
    const d2 = this.low / nonZeroOther.high;
    const d3 = this.high / nonZeroOther.low;
    const d4 = this.high / nonZeroOther.high;
    const res = new NumericalInterval(Math.min(d1, d2, d3, d4), Math.max(d1, d2, d3, d4));
    return { result: res, divisionByZero: possibleZero ? "possible" : "never" };
  }

  sqrt(): { result: NumericalInterval; domainViolation: "never" | "possible" | "definite" } {
    if (this.isBottom()) return { result: NumericalInterval.BOTTOM, domainViolation: "never" };
    if (this.high < 0) return { result: NumericalInterval.BOTTOM, domainViolation: "definite" };
    const possibleNeg = this.low < 0;
    const safeLow = Math.max(0, this.low);
    const res = new NumericalInterval(Math.sqrt(safeLow), Math.sqrt(this.high));
    return { result: res, domainViolation: possibleNeg ? "possible" : "never" };
  }

  abs(): NumericalInterval {
    if (this.isBottom()) return NumericalInterval.BOTTOM;
    if (this.low >= 0) return this;
    if (this.high <= 0) return new NumericalInterval(-this.high, -this.low);
    return new NumericalInterval(0, Math.max(-this.low, this.high));
  }

  toString(): string {
    if (this.isBottom()) return "⊥";
    if (this.isTop()) return "[-∞, +∞]";
    return `[${this.low}, ${this.high}]`;
  }
}

/**
 * Mapping of variable names to NumericalIntervals.
 */
export class IntervalEnvironment {
  private vars: Map<string, NumericalInterval> = new Map();
  public isBottomState: boolean = false;

  constructor(entries?: Iterable<[string, NumericalInterval]>, isBottom: boolean = false) {
    if (entries) {
      for (const [k, v] of entries) {
        this.vars.set(k, v);
      }
    }
    this.isBottomState = isBottom;
  }

  static top(): IntervalEnvironment {
    return new IntervalEnvironment();
  }

  static bottom(): IntervalEnvironment {
    return new IntervalEnvironment(undefined, true);
  }

  get(name: string): NumericalInterval {
    if (this.isBottomState) return NumericalInterval.BOTTOM;
    return this.vars.get(name) ?? NumericalInterval.TOP;
  }

  set(name: string, interval: NumericalInterval): IntervalEnvironment {
    if (this.isBottomState || interval.isBottom()) {
      return IntervalEnvironment.bottom();
    }
    const next = new IntervalEnvironment(this.vars);
    next.vars.set(name, interval);
    return next;
  }

  keys(): IterableIterator<string> {
    return this.vars.keys();
  }

  entries(): IterableIterator<[string, NumericalInterval]> {
    return this.vars.entries();
  }

  clone(): IntervalEnvironment {
    return new IntervalEnvironment(this.vars, this.isBottomState);
  }
}

/**
 * Formal AbstractDomain implementation over IntervalEnvironment.
 */
export class IntervalDomain implements AbstractDomain<IntervalEnvironment> {
  readonly name = "IntervalDomain";

  top(): IntervalEnvironment {
    return IntervalEnvironment.top();
  }

  bottom(): IntervalEnvironment {
    return IntervalEnvironment.bottom();
  }

  isBottom(state: IntervalEnvironment): boolean {
    return state.isBottomState;
  }

  isTop(state: IntervalEnvironment): boolean {
    if (state.isBottomState) return false;
    for (const [_, ival] of state.entries()) {
      if (!ival.isTop()) return false;
    }
    return true;
  }

  isLeq(a: IntervalEnvironment, b: IntervalEnvironment): boolean {
    if (a.isBottomState) return true;
    if (b.isBottomState) return false;

    for (const [k, bIval] of b.entries()) {
      const aIval = a.get(k);
      if (!aIval.isLeq(bIval)) return false;
    }
    return true;
  }

  join(a: IntervalEnvironment, b: IntervalEnvironment): IntervalEnvironment {
    if (a.isBottomState) return b.clone();
    if (b.isBottomState) return a.clone();

    const res = new IntervalEnvironment();
    const allKeys = new Set<string>([...a.keys(), ...b.keys()]);
    for (const k of allKeys) {
      res.set(k, a.get(k).join(b.get(k)));
    }
    return res;
  }

  meet(a: IntervalEnvironment, b: IntervalEnvironment): IntervalEnvironment {
    if (a.isBottomState || b.isBottomState) return IntervalEnvironment.bottom();

    const res = new IntervalEnvironment();
    const allKeys = new Set<string>([...a.keys(), ...b.keys()]);
    for (const k of allKeys) {
      const m = a.get(k).meet(b.get(k));
      if (m.isBottom()) return IntervalEnvironment.bottom();
      res.set(k, m);
    }
    return res;
  }

  widen(a: IntervalEnvironment, b: IntervalEnvironment, thresholds?: number[]): IntervalEnvironment {
    if (a.isBottomState) return b.clone();
    if (b.isBottomState) return a.clone();

    const res = new IntervalEnvironment();
    const allKeys = new Set<string>([...a.keys(), ...b.keys()]);
    for (const k of allKeys) {
      res.set(k, a.get(k).widen(b.get(k), thresholds));
    }
    return res;
  }

  narrow(a: IntervalEnvironment, b: IntervalEnvironment): IntervalEnvironment {
    if (a.isBottomState || b.isBottomState) return IntervalEnvironment.bottom();

    const res = new IntervalEnvironment();
    const allKeys = new Set<string>([...a.keys(), ...b.keys()]);
    for (const k of allKeys) {
      res.set(k, a.get(k).narrow(b.get(k)));
    }
    return res;
  }

  clone(state: IntervalEnvironment): IntervalEnvironment {
    return state.clone();
  }

  equals(a: IntervalEnvironment, b: IntervalEnvironment): boolean {
    if (a.isBottomState && b.isBottomState) return true;
    if (a.isBottomState !== b.isBottomState) return false;

    const allKeys = new Set<string>([...a.keys(), ...b.keys()]);
    for (const k of allKeys) {
      if (!a.get(k).equals(b.get(k))) return false;
    }
    return true;
  }
}
