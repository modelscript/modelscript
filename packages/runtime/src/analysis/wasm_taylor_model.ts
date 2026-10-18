// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Validated Continuous Interval Flowpipe Reachability (Taylor Models).
 *
 * Provides high-order multivariate Taylor Models:
 *   TM(x) = P_n(x - x_0) + [r]
 * where P_n is a degree-n multivariate polynomial and [r] is an interval remainder box.
 * Enables guaranteed reachability tubes and safety verification over continuous physical dynamics.
 */

import type { VerificationVerdict } from "../formal/verdict.js";
import { MonomialBasis } from "./monomial_basis.js";
import { ivAdd, ivMul, ivPowInt, ivSub } from "./outward_rounding.js";
import { Interval } from "./wasm_interval.js";
export { MonomialBasis } from "./monomial_basis.js";
export { Interval } from "./wasm_interval.js";

// ── Basic Interval Arithmetic Helpers ──

// These helpers use the outward-rounded kernel so interval remainders stay sound under IEEE rounding.
// (Polynomial coefficient arithmetic in `TaylorModel` is still plain IEEE: rigor is "float-sound".)

export function addInterval(a: Interval, b: Interval): Interval {
  return ivAdd(a, b);
}

export function subInterval(a: Interval, b: Interval): Interval {
  return ivSub(a, b);
}

export function mulInterval(a: Interval, b: Interval): Interval {
  return ivMul(a, b);
}

export function scaleInterval(a: Interval, s: number): Interval {
  return ivMul(a, new Interval(s, s));
}

export function powInterval(a: Interval, n: number): Interval {
  if (n === 0) return new Interval(1, 1);
  if (n === 1) return new Interval(a.lo, a.hi);
  return ivPowInt(a, n);
}

class TaylorTermsMap extends Map<string, number> {
  constructor(private readonly tm: TaylorModel) {
    super();
  }

  override set(key: string, value: number): this {
    super.set(key, value);
    const exps = TaylorModel.parseKey(key);
    const idx = this.tm.basis.indexOf(exps);
    if (idx >= 0) {
      this.tm.coeffs[idx] = value;
    }
    return this;
  }

  override delete(key: string): boolean {
    const exps = TaylorModel.parseKey(key);
    const idx = this.tm.basis.indexOf(exps);
    if (idx >= 0) {
      this.tm.coeffs[idx] = 0;
    }
    return super.delete(key);
  }

  override clear(): void {
    super.clear();
    this.tm.coeffs.fill(0);
  }
}

export class TaylorModel {
  /**
   * Precomputed graded-lexicographical monomial basis.
   */
  public readonly basis: MonomialBasis;

  /**
   * Dense polynomial coefficients indexed by graded-lex monomial ID.
   * coeffs[0] is the constant term.
   */
  public readonly coeffs: Float64Array;

  /**
   * Remainder interval enclosing truncation and rounding errors: [r_lo, r_hi].
   */
  public remainder: Interval;

  private _termsCache: Map<string, number> | null = null;

  constructor(
    public readonly numVars: number,
    public readonly order: number,
    public readonly domain: Interval[],
    remainder: Interval = new Interval(0, 0),
  ) {
    this.basis = MonomialBasis.get(numVars, order);
    this.coeffs = new Float64Array(this.basis.totalMonomials);
    this.remainder = new Interval(remainder.lo, remainder.hi);
  }

  /**
   * Polynomial coefficients indexed by serialized exponent vector (e.g. "0,1,0").
   * Lazily generated and synchronized with the dense graded-lex coeffs array.
   */
  public get terms(): Map<string, number> {
    if (!this._termsCache) {
      const map = new TaylorTermsMap(this);
      const M = this.basis.totalMonomials;
      for (let i = 0; i < M; i++) {
        const c = this.coeffs[i]!;
        if (c !== 0) {
          Map.prototype.set.call(map, this.basis.serializedKeys[i]!, c);
        }
      }
      this._termsCache = map;
    }
    return this._termsCache;
  }

  static serializeKey(exponents: number[]): string {
    return exponents.join(",");
  }

  static parseKey(key: string): number[] {
    return key.split(",").map(Number);
  }

  static degreeOf(exponents: number[]): number {
    let sum = 0;
    for (let i = 0; i < exponents.length; i++) sum += exponents[i]!;
    return sum;
  }

  /**
   * Creates a constant Taylor Model: P = c, r = [0, 0].
   */
  static constant(val: number, numVars: number, domain: Interval[], order: number = 2): TaylorModel {
    const tm = new TaylorModel(numVars, order, domain);
    if (Math.abs(val) >= 1e-15) {
      tm.coeffs[0] = val;
    } else if (val !== 0) {
      tm.sweepIntoRemainderIndex(0, val);
    }
    return tm;
  }

  /**
   * Creates an independent variable Taylor Model: P = center + (v - center), r = [0, 0].
   */
  static variable(varIndex: number, domain: Interval[], order: number = 2, center = 0): TaylorModel {
    const numVars = domain.length;
    const tm = new TaylorModel(numVars, order, domain);
    if (center !== 0) {
      if (Math.abs(center) >= 1e-15) {
        tm.coeffs[0] = center;
      } else {
        tm.sweepIntoRemainderIndex(0, center);
      }
    }
    const varIdx = tm.basis.variableIndex(varIndex);
    if (varIdx < tm.basis.totalMonomials) {
      tm.coeffs[varIdx] = 1.0;
    }
    return tm;
  }

  get(exponents: number[]): number {
    const idx = this.basis.indexOf(exponents);
    return idx >= 0 ? this.coeffs[idx]! : 0;
  }

  set(exponents: number[], val: number): void {
    this._termsCache = null;
    const idx = this.basis.indexOf(exponents);
    if (idx >= 0) {
      if (Math.abs(val) < 1e-15) {
        this.coeffs[idx] = 0;
        if (val !== 0) this.sweepIntoRemainderIndex(idx, val);
      } else {
        this.coeffs[idx] = val;
      }
    } else {
      if (val !== 0) this.sweepIntoRemainderExponents(exponents, val);
    }
  }

  /**
   * Moves the term `coeff * monomial[index]` out of the polynomial and into the remainder interval.
   */
  public sweepIntoRemainderIndex(index: number, coeff: number): void {
    const range = this.evaluateMonomialRangeIndex(index);
    this.remainder = addInterval(this.remainder, scaleInterval(range, coeff));
  }

  /**
   * Moves the term `coeff * x^exponents` out of the polynomial and into the remainder interval.
   */
  public sweepIntoRemainderExponents(exponents: number[], coeff: number): void {
    const range = this.evaluateMonomialRangeExponents(exponents);
    this.remainder = addInterval(this.remainder, scaleInterval(range, coeff));
  }

  clone(): TaylorModel {
    const res = new TaylorModel(this.numVars, this.order, this.domain, this.remainder);
    res.coeffs.set(this.coeffs);
    return res;
  }

  /**
   * Returns a copy of this Taylor Model with updated domain intervals.
   */
  withDomain(domain: Interval[]): TaylorModel {
    const res = new TaylorModel(this.numVars, this.order, domain, this.remainder);
    res.coeffs.set(this.coeffs);
    return res;
  }

  addConstant(c: number): TaylorModel {
    const res = this.clone();
    const curr = res.coeffs[0]!;
    const next = curr + c;
    if (Math.abs(next) < 1e-15) {
      res.coeffs[0] = 0;
      if (next !== 0) res.sweepIntoRemainderIndex(0, next);
    } else {
      res.coeffs[0] = next;
    }
    return res;
  }

  /**
   * Addition of two Taylor Models:
   * (P_1 + P_2) + (r_1 + r_2)
   */
  add(other: TaylorModel): TaylorModel {
    const maxOrder = Math.max(this.order, other.order);
    const res = new TaylorModel(this.numVars, maxOrder, this.domain, addInterval(this.remainder, other.remainder));

    if (this.order === other.order && this.order === maxOrder) {
      const M = this.basis.totalMonomials;
      for (let i = 0; i < M; i++) {
        const sum = this.coeffs[i]! + other.coeffs[i]!;
        if (Math.abs(sum) < 1e-15) {
          if (sum !== 0) res.sweepIntoRemainderIndex(i, sum);
        } else {
          res.coeffs[i] = sum;
        }
      }
    } else {
      for (let i = 0; i < this.basis.totalMonomials; i++) {
        const c = this.coeffs[i]!;
        if (c !== 0) {
          const target = res.basis.indexOf(this.basis.exponents[i]!);
          if (target >= 0) res.coeffs[target] = res.coeffs[target]! + c;
        }
      }
      for (let j = 0; j < other.basis.totalMonomials; j++) {
        const c = other.coeffs[j]!;
        if (c !== 0) {
          const target = res.basis.indexOf(other.basis.exponents[j]!);
          if (target >= 0) res.coeffs[target] = res.coeffs[target]! + c;
        }
      }
      for (let k = 0; k < res.basis.totalMonomials; k++) {
        const c = res.coeffs[k]!;
        if (Math.abs(c) < 1e-15 && c !== 0) {
          res.coeffs[k] = 0;
          res.sweepIntoRemainderIndex(k, c);
        }
      }
    }
    return res;
  }

  /**
   * Subtraction of two Taylor Models:
   * (P_1 - P_2) + (r_1 - r_2)
   */
  sub(other: TaylorModel): TaylorModel {
    const maxOrder = Math.max(this.order, other.order);
    const res = new TaylorModel(this.numVars, maxOrder, this.domain, subInterval(this.remainder, other.remainder));

    if (this.order === other.order && this.order === maxOrder) {
      const M = this.basis.totalMonomials;
      for (let i = 0; i < M; i++) {
        const diff = this.coeffs[i]! - other.coeffs[i]!;
        if (Math.abs(diff) < 1e-15) {
          if (diff !== 0) res.sweepIntoRemainderIndex(i, diff);
        } else {
          res.coeffs[i] = diff;
        }
      }
    } else {
      for (let i = 0; i < this.basis.totalMonomials; i++) {
        const c = this.coeffs[i]!;
        if (c !== 0) {
          const target = res.basis.indexOf(this.basis.exponents[i]!);
          if (target >= 0) res.coeffs[target] = res.coeffs[target]! + c;
        }
      }
      for (let j = 0; j < other.basis.totalMonomials; j++) {
        const c = other.coeffs[j]!;
        if (c !== 0) {
          const target = res.basis.indexOf(other.basis.exponents[j]!);
          if (target >= 0) res.coeffs[target] = res.coeffs[target]! - c;
        }
      }
      for (let k = 0; k < res.basis.totalMonomials; k++) {
        const c = res.coeffs[k]!;
        if (Math.abs(c) < 1e-15 && c !== 0) {
          res.coeffs[k] = 0;
          res.sweepIntoRemainderIndex(k, c);
        }
      }
    }
    return res;
  }

  /**
   * Scalar multiplication: c * TM
   */
  scale(c: number): TaylorModel {
    const res = new TaylorModel(this.numVars, this.order, this.domain, scaleInterval(this.remainder, c));
    const M = this.basis.totalMonomials;
    for (let i = 0; i < M; i++) {
      res.coeffs[i] = this.coeffs[i]! * c;
    }
    return res;
  }

  /**
   * Evaluates the range of monomial at given basis index over the domain box.
   */
  public evaluateMonomialRangeIndex(index: number): Interval {
    return this.evaluateMonomialRangeExponents(this.basis.exponents[index]!);
  }

  /**
   * Evaluates the range of a monomial term x_0^e0 * x_1^e1 ... over the domain box.
   */
  public evaluateMonomialRangeExponents(exps: number[]): Interval {
    let res = new Interval(1, 1);
    for (let i = 0; i < exps.length; i++) {
      const e = exps[i]!;
      if (e > 0) {
        const dom = this.domain[i] ?? new Interval(0, 0);
        res = mulInterval(res, powInterval(dom, e));
      }
    }
    return res;
  }

  /**
   * Polynomial range evaluation over domain box without remainder.
   */
  evaluatePolynomialRange(): Interval {
    let acc = new Interval(0, 0);
    const M = this.basis.totalMonomials;
    for (let i = 0; i < M; i++) {
      const coeff = this.coeffs[i]!;
      if (coeff === 0) continue;
      const mRange = this.evaluateMonomialRangeIndex(i);
      acc = addInterval(acc, scaleInterval(mRange, coeff));
    }
    return acc;
  }

  /**
   * Multiplication of two Taylor Models:
   * (P_1 + r_1)(P_2 + r_2) = P_1*P_2 + P_1*r_2 + P_2*r_1 + r_1*r_2
   * Terms in P_1*P_2 exceeding max order are truncated into remainder box.
   */
  mul(other: TaylorModel): TaylorModel {
    const maxOrder = Math.max(this.order, other.order);
    const res = new TaylorModel(this.numVars, maxOrder, this.domain);
    let excessRemainder = new Interval(0, 0);

    const sameOrder = this.order === other.order && this.order === maxOrder;
    const mulTable = sameOrder ? this.basis.mulTable : null;

    if (mulTable) {
      const M = this.basis.totalMonomials;
      for (let i = 0; i < M; i++) {
        const c1 = this.coeffs[i]!;
        if (c1 === 0) continue;
        const rowOffset = i * M;
        for (let j = 0; j < M; j++) {
          const c2 = other.coeffs[j]!;
          if (c2 === 0) continue;
          const coeff = c1 * c2;
          const k = mulTable[rowOffset + j]!;
          if (k >= 0) {
            res.coeffs[k] = res.coeffs[k]! + coeff;
          } else {
            const exps1 = this.basis.exponents[i]!;
            const exps2 = this.basis.exponents[j]!;
            const sumExps = new Array(this.numVars);
            for (let v = 0; v < this.numVars; v++) sumExps[v] = exps1[v]! + exps2[v]!;
            const mRange = this.evaluateMonomialRangeExponents(sumExps);
            excessRemainder = addInterval(excessRemainder, scaleInterval(mRange, coeff));
          }
        }
      }
    } else {
      for (let i = 0; i < this.basis.totalMonomials; i++) {
        const c1 = this.coeffs[i]!;
        if (c1 === 0) continue;
        const exps1 = this.basis.exponents[i]!;
        for (let j = 0; j < other.basis.totalMonomials; j++) {
          const c2 = other.coeffs[j]!;
          if (c2 === 0) continue;
          const coeff = c1 * c2;
          const exps2 = other.basis.exponents[j]!;
          const sumExps = new Array(this.numVars);
          let sumDeg = 0;
          for (let v = 0; v < this.numVars; v++) {
            const e = exps1[v]! + exps2[v]!;
            sumExps[v] = e;
            sumDeg += e;
          }
          if (sumDeg <= maxOrder) {
            const target = res.basis.indexOf(sumExps);
            if (target >= 0) {
              res.coeffs[target] = res.coeffs[target]! + coeff;
            } else {
              const mRange = this.evaluateMonomialRangeExponents(sumExps);
              excessRemainder = addInterval(excessRemainder, scaleInterval(mRange, coeff));
            }
          } else {
            const mRange = this.evaluateMonomialRangeExponents(sumExps);
            excessRemainder = addInterval(excessRemainder, scaleInterval(mRange, coeff));
          }
        }
      }
    }

    // Sweep any tiny cancellation terms in the product
    for (let k = 0; k < res.basis.totalMonomials; k++) {
      const c = res.coeffs[k]!;
      if (Math.abs(c) < 1e-15 && c !== 0) {
        res.coeffs[k] = 0;
        res.sweepIntoRemainderIndex(k, c);
      }
    }

    // Remainder propagation: P_1*r_2 + P_2*r_1 + r_1*r_2
    const p1Range = this.evaluatePolynomialRange();
    const p2Range = other.evaluatePolynomialRange();

    const cross1 = mulInterval(p1Range, other.remainder);
    const cross2 = mulInterval(p2Range, this.remainder);
    const crossRem = mulInterval(this.remainder, other.remainder);

    let totalRemainder = addInterval(excessRemainder, cross1);
    totalRemainder = addInterval(totalRemainder, cross2);
    totalRemainder = addInterval(totalRemainder, crossRem);

    res.remainder = addInterval(res.remainder, totalRemainder);
    return res;
  }

  /**
   * Exponential function of a Taylor Model: exp(TM).
   * Uses Taylor series expansion around constant term c:
   *   exp(c + delta) = exp(c) * \sum_{k=0}^n (delta^k / k!) + [r_exp]
   */
  exp(): TaylorModel {
    const c = this.coeffs[0]!;
    const expC = Math.exp(c);

    // delta = this - c
    const delta = this.clone();
    delta.coeffs[0] = 0;
    const deltaRemainder = this.remainder;
    delta.remainder = new Interval(0, 0);

    let termK = TaylorModel.constant(1.0, this.numVars, this.domain, this.order);
    let polySum = termK.clone();

    let factorial = 1.0;
    for (let k = 1; k <= this.order; k++) {
      factorial *= k;
      termK = termK.mul(delta);
      polySum = polySum.add(termK.scale(1.0 / factorial));
    }

    // Lagrange remainder bound
    const deltaRange = delta.evaluatePolynomialRange();
    const maxDelta = Math.max(Math.abs(deltaRange.lo), Math.abs(deltaRange.hi));
    const nextFact = factorial * (this.order + 1);
    const lagrangeBound = (Math.pow(maxDelta, this.order + 1) / nextFact) * Math.exp(Math.max(0, deltaRange.hi));
    const truncRemainder = new Interval(-lagrangeBound, lagrangeBound);

    const res = polySum.scale(expC);
    const expRem = scaleInterval(truncRemainder, expC);
    // Input remainder r: exp(P + r) - exp(P) = exp(xi) * r (mean value theorem), where xi ranges over
    // c + range(delta) extended by r. Use the interval of the derivative, so negative r is handled.
    const dLo = Math.exp(c + deltaRange.lo + Math.min(0, deltaRemainder.lo));
    const dHi = Math.exp(c + deltaRange.hi + Math.max(0, deltaRemainder.hi));
    const remInput = mulInterval(deltaRemainder, new Interval(dLo, dHi));
    res.remainder = addInterval(res.remainder, addInterval(expRem, remInput));

    return res;
  }

  /**
   * Sine function of a Taylor Model: sin(TM).
   * Uses angle addition: sin(c + delta) = sin(c)cos(delta) + cos(c)sin(delta).
   */
  sin(): TaylorModel {
    const c = this.coeffs[0]!;
    const sinC = Math.sin(c);
    const cosC = Math.cos(c);

    const delta = this.clone();
    delta.coeffs[0] = 0;
    delta.remainder = new Interval(0, 0);

    // Compute powers delta^k
    const powers: TaylorModel[] = [TaylorModel.constant(1.0, this.numVars, this.domain, this.order)];
    for (let k = 1; k <= this.order; k++) {
      powers.push(powers[k - 1]!.mul(delta));
    }

    // sin(delta) = delta - delta^3/6 + delta^5/120 - ...
    let sinDelta = TaylorModel.constant(0.0, this.numVars, this.domain, this.order);
    let cosDelta = TaylorModel.constant(1.0, this.numVars, this.domain, this.order);

    let fact = 1.0;
    for (let k = 1; k <= this.order; k++) {
      fact *= k;
      if (k % 4 === 1) sinDelta = sinDelta.add(powers[k]!.scale(1.0 / fact));
      else if (k % 4 === 3) sinDelta = sinDelta.sub(powers[k]!.scale(1.0 / fact));
      else if (k % 4 === 2) cosDelta = cosDelta.sub(powers[k]!.scale(1.0 / fact));
      else if (k % 4 === 0) cosDelta = cosDelta.add(powers[k]!.scale(1.0 / fact));
    }

    // Lagrange remainder bounds: each of the two series (sin delta, cos delta) is truncated with
    // error <= maxDelta^(n+1)/(n+1)!, and they enter with weights |cos c| and |sin c| respectively.
    const deltaRange = delta.evaluatePolynomialRange();
    const maxDelta = Math.max(Math.abs(deltaRange.lo), Math.abs(deltaRange.hi));
    const nextFact = fact * (this.order + 1);
    const lagrangeBound = (Math.pow(maxDelta, this.order + 1) / nextFact) * (Math.abs(sinC) + Math.abs(cosC));
    const truncRem = new Interval(-lagrangeBound, lagrangeBound);
    // Input remainder: |sin'| <= 1, so sin(P + r) differs from sin(P) by at most max|r|.
    const inRad = Math.max(Math.abs(this.remainder.lo), Math.abs(this.remainder.hi));
    const inputRem = new Interval(-inRad, inRad);

    // sin(c)*cos(delta) + cos(c)*sin(delta)
    const part1 = cosDelta.scale(sinC);
    const part2 = sinDelta.scale(cosC);
    const res = part1.add(part2);
    res.remainder = addInterval(res.remainder, addInterval(truncRem, inputRem));
    return res;
  }

  /**
   * Cosine function of a Taylor Model: cos(TM).
   * Uses angle addition: cos(c + delta) = cos(c)cos(delta) - sin(c)sin(delta).
   */
  cos(): TaylorModel {
    const c = this.coeffs[0]!;
    const sinC = Math.sin(c);
    const cosC = Math.cos(c);

    const delta = this.clone();
    delta.coeffs[0] = 0;
    delta.remainder = new Interval(0, 0);

    const powers: TaylorModel[] = [TaylorModel.constant(1.0, this.numVars, this.domain, this.order)];
    for (let k = 1; k <= this.order; k++) {
      powers.push(powers[k - 1]!.mul(delta));
    }

    let sinDelta = TaylorModel.constant(0.0, this.numVars, this.domain, this.order);
    let cosDelta = TaylorModel.constant(1.0, this.numVars, this.domain, this.order);

    let fact = 1.0;
    for (let k = 1; k <= this.order; k++) {
      fact *= k;
      if (k % 4 === 1) sinDelta = sinDelta.add(powers[k]!.scale(1.0 / fact));
      else if (k % 4 === 3) sinDelta = sinDelta.sub(powers[k]!.scale(1.0 / fact));
      else if (k % 4 === 2) cosDelta = cosDelta.sub(powers[k]!.scale(1.0 / fact));
      else if (k % 4 === 0) cosDelta = cosDelta.add(powers[k]!.scale(1.0 / fact));
    }

    const deltaRange = delta.evaluatePolynomialRange();
    const maxDelta = Math.max(Math.abs(deltaRange.lo), Math.abs(deltaRange.hi));
    const nextFact = fact * (this.order + 1);
    const lagrangeBound = (Math.pow(maxDelta, this.order + 1) / nextFact) * (Math.abs(sinC) + Math.abs(cosC));
    const truncRem = new Interval(-lagrangeBound, lagrangeBound);
    // Input remainder: |cos'| <= 1, so cos(P + r) differs from cos(P) by at most max|r|.
    const inRad = Math.max(Math.abs(this.remainder.lo), Math.abs(this.remainder.hi));
    const inputRem = new Interval(-inRad, inRad);

    // cos(c)*cos(delta) - sin(c)*sin(delta)
    const part1 = cosDelta.scale(cosC);
    const part2 = sinDelta.scale(sinC);
    const res = part1.sub(part2);
    res.remainder = addInterval(res.remainder, addInterval(truncRem, inputRem));
    return res;
  }

  /**
   * Integrates the Taylor Model with respect to time variable (varIndex = 0)
   * over [0, delta_t]:
   * \int_0^t P(\tau) d\tau + [r] * [0, delta_t]
   */
  integrateTime(timeVarIndex = 0): TaylorModel {
    const res = new TaylorModel(this.numVars, this.order, this.domain);
    const targetMap = this.basis.integrateTarget[timeVarIndex]!;
    const divisorMap = this.basis.integrateDivisor[timeVarIndex]!;
    const M = this.basis.totalMonomials;

    for (let i = 0; i < M; i++) {
      const coeff = this.coeffs[i]!;
      if (coeff === 0) continue;
      const target = targetMap[i]!;
      const newCoeff = coeff / divisorMap[i]!;
      if (target >= 0) {
        res.coeffs[target] = newCoeff;
      } else {
        const exps = this.basis.exponents[i]!;
        const newExps = [...exps];
        newExps[timeVarIndex] = newExps[timeVarIndex]! + 1;
        const mRange = this.evaluateMonomialRangeExponents(newExps);
        res.remainder = addInterval(res.remainder, scaleInterval(mRange, newCoeff));
      }
    }

    // Remainder integration: [r] * domain[timeVarIndex]
    const timeDomain = this.domain[timeVarIndex] ?? new Interval(0, 1);
    const integratedRem = mulInterval(this.remainder, timeDomain);
    res.remainder = addInterval(res.remainder, integratedRem);

    return res;
  }

  /**
   * Differentiates the Taylor Model with respect to variable `varIndex` (default: time variable 0):
   * \frac{\partial P}{\partial x_v}
   */
  differentiateVariable(varIndex = 0): TaylorModel {
    const res = new TaylorModel(this.numVars, this.order, this.domain);
    const targetMap = this.basis.diffTarget[varIndex]!;
    const multMap = this.basis.diffMultiplier[varIndex]!;
    const M = this.basis.totalMonomials;

    for (let i = 0; i < M; i++) {
      const coeff = this.coeffs[i]!;
      if (coeff === 0) continue;
      const target = targetMap[i]!;
      if (target >= 0) {
        res.coeffs[target] = (res.coeffs[target] ?? 0) + coeff * multMap[i]!;
      }
    }

    return res;
  }

  /**
   * Fixes variable `varIndex` to `value`, merging monomials that differ only in that variable.
   * This avoids the interval dependency problem of evaluating each monomial separately (e.g. the
   * end-of-step enclosure of a flowpipe, where time is a single point). A relative rounding
   * allowance for the coefficient arithmetic is added to the remainder.
   */
  restrictVariable(varIndex: number, value: number): TaylorModel {
    const dom = this.domain.map((iv, i) => (i === varIndex ? new Interval(value, value) : iv));
    const res = new TaylorModel(this.numVars, this.order, dom, this.remainder);
    const targetMap = this.basis.restrictTarget[varIndex]!;
    const degMap = this.basis.restrictDegree[varIndex]!;
    const M = this.basis.totalMonomials;

    let absSum = 0;
    let count = 0;
    let maxDeg = 0;

    for (let i = 0; i < M; i++) {
      const c = this.coeffs[i]!;
      if (c === 0) continue;
      const e = degMap[i]!;
      const target = targetMap[i]!;
      const term = c * (e === 0 ? 1 : Math.pow(value, e));
      res.coeffs[target] = res.coeffs[target]! + term;
      absSum += Math.abs(term);
      count++;
      if (e > maxDeg) maxDeg = e;
    }

    const allowance = (count + maxDeg + 2) * 2 ** -52 * absSum;
    res.remainder = addInterval(res.remainder, new Interval(-allowance, allowance));
    return res;
  }

  /**
   * Computes the rigorous bounding interval [x_lo, x_hi] of this Taylor Model
   * over the entire domain box: P(domain) + [r].
   */
  evaluateRange(): Interval {
    const pRange = this.evaluatePolynomialRange();
    return addInterval(pRange, this.remainder);
  }

  /**
   * Point evaluation of the polynomial part at a concrete vector.
   */
  evaluateAt(point: number[]): number {
    let sum = 0;
    const M = this.basis.totalMonomials;
    for (let i = 0; i < M; i++) {
      const c = this.coeffs[i]!;
      if (c === 0) continue;
      const exps = this.basis.exponents[i]!;
      let prod = c;
      for (let v = 0; v < this.numVars; v++) {
        const e = exps[v]!;
        if (e === 1) prod *= point[v] ?? 0;
        else if (e > 1) prod *= Math.pow(point[v] ?? 0, e);
      }
      sum += prod;
    }
    return sum;
  }
}

// ── Continuous Flowpipe Reachability Solver ──

export interface FlowpipeRequirement {
  stateIndex: number;
  stateName?: string | undefined;
  operator: "<=" | ">=" | "<" | ">";
  limitValue: number;
}

export interface FlowpipeStepResult {
  stepIndex: number;
  time: number;
  tubes: Interval[]; // Guaranteed bounds [lo, hi] for each state
  nominal: number[]; // Nominal center trajectory point
}

export interface FlowpipeReachabilityResult {
  /** True only when `verdict.kind === "proven"`. */
  isCertifiedSafe: boolean;
  /** Sound verdict: proven (validated enclosure satisfies all requirements), else unknown. */
  verdict: VerificationVerdict;
  /** Time reached by validated steps (equals tSpan[1] when the whole horizon was covered). */
  reachedTime: number;
  steps: FlowpipeStepResult[];
  violations: {
    stepIndex: number;
    time: number;
    stateIndex: number;
    operator: string;
    worstCaseValue: number;
    limitValue: number;
    reason: string;
  }[];
  summary: string;
}

export interface FlowpipeProblemOptions {
  /**
   * System dynamics: dy/dt = f(t, y)
   * Must accept array of TaylorModels and return array of TaylorModels.
   */
  dynamics: (t: TaylorModel, y: TaylorModel[]) => TaylorModel[];
  /** Initial state bounds [lo, hi] for each state */
  initialEnclosure: Interval[];
  /** Nominal initial state point */
  nominalInitial: number[];
  /** Time span [t0, tEnd] */
  tSpan: [number, number];
  /** Step size dt */
  dt: number;
  /** Polynomial order for Taylor Models (e.g. 2, 3) */
  order?: number | undefined;
  /** Safety requirements to formally verify against flowpipe */
  requirements?: FlowpipeRequirement[] | undefined;
  /** Max Picard contractive iterations per step */
  maxPicardIterations?: number | undefined;
  /** Whether to dynamically adapt step size dt based on local remainder error */
  adaptive?: boolean | undefined;
  /** Local remainder error tolerance for adaptive stepping (default: 1e-4) */
  tol?: number | undefined;
  /** Minimum step size for adaptive stepping (default: 1e-6) */
  minDt?: number | undefined;
  /** Maximum step size for adaptive stepping (default: 1.0) */
  maxDt?: number | undefined;
  /**
   * Whether to carry over polynomial dependencies symbolically across time steps
   * (Makino–Berz / Flow* scheme) to mitigate the wrapping effect.
   * If true (or positive number of steps), the state Taylor models retain their polynomial
   * dependencies on the initial set across steps instead of being re-boxed at every step.
   * A numeric value specifies the maximum number of steps between coordinate refreshes.
   * Default: true (with automatic coordinate refresh on Picard failure or every 20 steps).
   */
  symbolicCarryOver?: boolean | number | undefined;
  /**
   * @deprecated Ignored. The previous "QR tightening" only widened the enclosure (union of the
   * direct and rotated boxes). Proper preconditioned Taylor models are tracked in the hardening plan.
   */
  useQrPreconditioning?: boolean | undefined;
}

/**
 * Validated continuous flowpipe reachability engine using Taylor Model Picard integration.
 */
export class TaylorModelFlowpipeSolver {
  /**
   * Solves continuous flowpipe reachability and validates requirements.
   */
  static solve(options: FlowpipeProblemOptions): FlowpipeReachabilityResult {
    const {
      dynamics,
      initialEnclosure,
      nominalInitial,
      tSpan,
      dt,
      order = 2,
      requirements = [],
      maxPicardIterations = 5,
      adaptive = false,
      tol = 1e-4,
      minDt = 1e-6,
      maxDt = 1.0,
      symbolicCarryOver = true,
    } = options;

    const carryOverLimit = typeof symbolicCarryOver === "number" ? symbolicCarryOver : symbolicCarryOver ? 20 : 0;

    const nStates = initialEnclosure.length;
    const [t0, tEnd] = tSpan;

    const steps: FlowpipeStepResult[] = [];
    const violations: FlowpipeReachabilityResult["violations"] = [];

    // Current state enclosure at step k
    let currentEnclosure = initialEnclosure.map((inv) => new Interval(inv.lo, inv.hi));
    let currentNominal = [...nominalInitial];
    let refreshEnclosure = currentEnclosure;
    let refreshNominalInitial = [...currentNominal];
    let spatialDomain = refreshEnclosure.map((iv) => new Interval(-0.5 * iv.width, 0.5 * iv.width));
    let currentSpatialTMs: TaylorModel[] | null = null;
    let stepsSinceRefresh = 0;

    // Record initial step
    steps.push({
      stepIndex: 0,
      time: t0,
      tubes: currentEnclosure.map((inv) => new Interval(inv.lo, inv.hi)),
      nominal: [...currentNominal],
    });

    // Check requirements at t0
    for (const req of requirements) {
      const tube = currentEnclosure[req.stateIndex]!;
      const check = TaylorModelFlowpipeSolver.checkRequirement(tube, req);
      if (!check.holds) {
        violations.push({
          stepIndex: 0,
          time: t0,
          stateIndex: req.stateIndex,
          operator: req.operator,
          worstCaseValue: check.worstValue,
          limitValue: req.limitValue,
          reason: `Initial state violates requirement: ${check.worstValue} ${req.operator} ${req.limitValue}`,
        });
      }
    }

    let currentTime = t0;
    let currentDt = dt;
    let step = 0;
    const maxStepsGuard = 10000;

    let abortReason: "nonconvergent" | null = null;

    while (currentTime < tEnd - 1e-12 && step < maxStepsGuard) {
      if (currentTime + currentDt > tEnd) {
        currentDt = tEnd - currentTime;
      }

      // 1. Domain and initial state Taylor models for this step
      let stepDomain: Interval[];
      let stateTMs: TaylorModel[];

      const useCarry = carryOverLimit > 0 && currentSpatialTMs !== null && stepsSinceRefresh < carryOverLimit;
      if (useCarry) {
        stepDomain = [new Interval(0, currentDt), ...spatialDomain];
        stateTMs = currentSpatialTMs!.map((tm) => tm.withDomain(stepDomain));
      } else {
        refreshEnclosure = currentEnclosure;
        refreshNominalInitial = [...currentNominal];
        spatialDomain = refreshEnclosure.map((iv) => new Interval(-0.5 * iv.width, 0.5 * iv.width));
        stepDomain = [new Interval(0, currentDt), ...spatialDomain];
        stateTMs = [];
        for (let j = 0; j < nStates; j++) {
          const center = refreshEnclosure[j]!.mid;
          stateTMs.push(TaylorModel.variable(j + 1, stepDomain, order, center));
        }
        stepsSinceRefresh = 0;
      }

      // Time TM: t = currentTime + delta_t
      const timeTM = TaylorModel.variable(0, stepDomain, order, currentTime);

      // 2. Validated Picard step (Schauder fixed-point check); null when it cannot be validated.
      const picardTMs = TaylorModelFlowpipeSolver.validatedPicardStep(
        dynamics,
        timeTM,
        stateTMs,
        Math.max(maxPicardIterations, order + 1),
      );

      if (!picardTMs) {
        // If Picard failed while using carried-over polynomial dependencies, force a refresh/re-box
        // at the current time before giving up or halving dt.
        if (useCarry) {
          currentSpatialTMs = null;
          stepsSinceRefresh = carryOverLimit;
          continue;
        }
        // Remainder could not be validated at this step size: halve and retry.
        if (currentDt > minDt * 1.01) {
          currentDt = Math.max(minDt, currentDt * 0.5);
          continue;
        }
        abortReason = "nonconvergent";
        break;
      }

      // 3. Adaptive time stepping check: test remainder width against tolerance
      const maxRemWidth = Math.max(...picardTMs.map((tm) => tm.remainder.width));

      if (adaptive && maxRemWidth > tol && currentDt > minDt * 1.01) {
        // Step rejected! Shrink dt and retry
        const shrink = Math.max(0.2, 0.8 * Math.pow(tol / Math.max(1e-15, maxRemWidth), 1 / (order + 1)));
        currentDt = Math.max(minDt, currentDt * shrink);
        continue;
      }

      // 4. Step accepted!
      step++;
      currentTime += currentDt;
      stepsSinceRefresh++;

      // Compute bounding tubes across [0, currentDt]
      const nextTubes: Interval[] = [];
      for (let j = 0; j < nStates; j++) {
        const range = picardTMs[j]!.evaluateRange();
        nextTubes.push(range);
      }

      // Advance nominal point
      const initialNominalOffset = refreshNominalInitial.map((val, j) => val - refreshEnclosure[j]!.mid);
      const nominalPoint = [currentDt, ...initialNominalOffset];
      const nextNominal: number[] = [];
      for (let j = 0; j < nStates; j++) {
        nextNominal.push(picardTMs[j]!.evaluateAt(nominalPoint));
      }

      steps.push({
        stepIndex: step,
        time: currentTime,
        tubes: nextTubes,
        nominal: nextNominal,
      });

      // Check safety requirements against guaranteed flowpipe enclosure
      for (const req of requirements) {
        const tube = nextTubes[req.stateIndex]!;
        const check = TaylorModelFlowpipeSolver.checkRequirement(tube, req);
        if (!check.holds) {
          violations.push({
            stepIndex: step,
            time: currentTime,
            stateIndex: req.stateIndex,
            operator: req.operator,
            worstCaseValue: check.worstValue,
            limitValue: req.limitValue,
            reason: `Flowpipe breach at t=${currentTime.toFixed(3)}s: state[${req.stateIndex}] worst-case ${check.worstValue.toFixed(4)} violates ${req.operator} ${req.limitValue}`,
          });
        }
      }

      // State enclosure for next step: evaluate at the single time point delta_t = currentDt,
      // merging monomials first so alternating-sign terms do not suffer the dependency problem.
      const endTMs = picardTMs.map((tm) => tm.restrictVariable(0, currentDt));
      currentEnclosure = endTMs.map((tm) => tm.evaluateRange());
      currentNominal = nextNominal;

      if (carryOverLimit > 0) {
        currentSpatialTMs = endTMs;
      } else {
        currentSpatialTMs = null;
      }

      // Adapt step size for next step
      if (adaptive) {
        const growth = Math.min(2.0, 0.9 * Math.pow(tol / Math.max(1e-15, maxRemWidth), 1 / (order + 1)));
        currentDt = Math.min(maxDt, Math.max(minDt, currentDt * growth));
      }
    }

    const coveredHorizon = currentTime >= tEnd - 1e-12;
    let verdict: VerificationVerdict;
    let summary: string;
    if (abortReason) {
      verdict = {
        kind: "unknown",
        reason: "nonconvergent",
        detail: `Picard remainder could not be validated below minDt at t=${currentTime}.`,
      };
      summary = `Flowpipe stopped at t=${currentTime}: remainder validation failed (verdict unknown).`;
    } else if (!coveredHorizon) {
      verdict = { kind: "unknown", reason: "budget", detail: `Step budget exhausted at t=${currentTime}.` };
      summary = `Flowpipe stopped at t=${currentTime}: step budget exhausted (verdict unknown).`;
    } else if (violations.length > 0) {
      // An over-approximation crossing a limit is not a counterexample.
      verdict = {
        kind: "unknown",
        reason: "inconclusive-enclosure",
        rigor: "float-sound",
        detail: `${violations.length} enclosure breach(es); no concrete witness.`,
      };
      summary = `Enclosure crosses a requirement limit in ${violations.length} step(s); not proven (no witness found).`;
    } else {
      verdict = {
        kind: "proven",
        rigor: "float-sound",
        detail: "Validated (Schauder-checked) Taylor-model flowpipe satisfies all requirements.",
      };
      summary = `Flowpipe reachability proven (validated enclosure) across ${steps.length} time steps with ${requirements.length} requirements.`;
    }

    return {
      isCertifiedSafe: verdict.kind === "proven",
      verdict,
      reachedTime: currentTime,
      steps,
      violations,
      summary,
    };
  }

  /**
   * Picard step with remainder validation (Berz–Makino / Flow*): computes the order-k Picard
   * polynomial `p`, then finds a remainder interval R with `P(p + R) - p ⊆ R`, which by Schauder's
   * theorem guarantees that the true solution lies in `p + R` on the whole step. Returns the
   * polynomial with the (tightened) validated remainder, or `null` if no R could be validated.
   */
  static validatedPicardStep(
    dynamics: (t: TaylorModel, y: TaylorModel[]) => TaylorModel[],
    timeTM: TaylorModel,
    initialTMs: TaylorModel[],
    iterations: number,
  ): TaylorModel[] | null {
    const n = initialTMs.length;
    const picard = (candidate: TaylorModel[]): TaylorModel[] => {
      const d = dynamics(timeTM, candidate);
      return initialTMs.map((s, j) => s.add(d[j]!.integrateTime(0)));
    };
    const finite = (iv: Interval): boolean => Number.isFinite(iv.lo) && Number.isFinite(iv.hi);
    const inflate = (iv: Interval): Interval => {
      const pad = Math.max(0.1 * iv.width, 1e-14 * (Math.abs(iv.lo) + Math.abs(iv.hi)), 1e-300);
      return new Interval(iv.lo - pad, iv.hi + pad);
    };

    // Polynomial part: iterate with the remainder dropped; it is re-derived by the validation below.
    let poly = initialTMs.map((tm) => tm.clone());
    for (let it = 0; it < iterations; it++) {
      poly = picard(poly);
      for (const tm of poly) tm.remainder = new Interval(0, 0);
    }

    const residual = (candidate: TaylorModel[]): Interval[] => {
      const next = picard(candidate);
      return next.map((nx, j) => nx.sub(poly[j]!).evaluateRange());
    };

    const probe = residual(poly);
    if (!probe.every(finite)) return null;
    let R = probe.map((iv) => inflate(new Interval(Math.min(iv.lo, 0), Math.max(iv.hi, 0))));

    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = poly.map((p, j) => {
        const c = p.clone();
        c.remainder = new Interval(R[j]!.lo, R[j]!.hi);
        return c;
      });
      const Rn = residual(candidate);
      if (!Rn.every(finite)) return null;
      let contained = true;
      for (let j = 0; j < n; j++) {
        if (!(Rn[j]!.lo >= R[j]!.lo && Rn[j]!.hi <= R[j]!.hi)) contained = false;
      }
      if (contained) {
        return poly.map((p, j) => {
          const c = p.clone();
          c.remainder = new Interval(Rn[j]!.lo, Rn[j]!.hi);
          return c;
        });
      }
      R = R.map((r, j) => inflate(new Interval(Math.min(r.lo, Rn[j]!.lo), Math.max(r.hi, Rn[j]!.hi))));
    }
    return null;
  }

  private static checkRequirement(tube: Interval, req: FlowpipeRequirement): { holds: boolean; worstValue: number } {
    if (req.operator === "<=" || req.operator === "<") {
      const worst = tube.hi;
      return { holds: req.operator === "<=" ? worst <= req.limitValue : worst < req.limitValue, worstValue: worst };
    }
    if (req.operator === ">=" || req.operator === ">") {
      const worst = tube.lo;
      return { holds: req.operator === ">=" ? worst >= req.limitValue : worst > req.limitValue, worstValue: worst };
    }
    return { holds: true, worstValue: tube.mid };
  }
}
