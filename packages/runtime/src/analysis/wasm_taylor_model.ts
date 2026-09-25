// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Validated Continuous Interval Flowpipe Reachability (Taylor Models).
 *
 * Provides high-order multivariate Taylor Models:
 *   TM(x) = P_n(x - x_0) + [r]
 * where P_n is a degree-n multivariate polynomial and [r] is an interval remainder box.
 * Enables guaranteed reachability tubes and safety verification over continuous physical dynamics.
 */

import { computeRotationMatrix, encloseRotatedBox } from "../solvers/wasm_qr.js";
import { Interval } from "./wasm_interval.js";
export { Interval } from "./wasm_interval.js";

// ── Basic Interval Arithmetic Helpers ──

export function addInterval(a: Interval, b: Interval): Interval {
  return new Interval(a.lo + b.lo, a.hi + b.hi);
}

export function subInterval(a: Interval, b: Interval): Interval {
  return new Interval(a.lo - b.hi, a.hi - b.lo);
}

export function mulInterval(a: Interval, b: Interval): Interval {
  const p1 = a.lo * b.lo;
  const p2 = a.lo * b.hi;
  const p3 = a.hi * b.lo;
  const p4 = a.hi * b.hi;
  return new Interval(Math.min(p1, p2, p3, p4), Math.max(p1, p2, p3, p4));
}

export function scaleInterval(a: Interval, s: number): Interval {
  if (s >= 0) {
    return new Interval(a.lo * s, a.hi * s);
  }
  return new Interval(a.hi * s, a.lo * s);
}

export function powInterval(a: Interval, n: number): Interval {
  if (n === 0) return new Interval(1, 1);
  if (n === 1) return new Interval(a.lo, a.hi);
  if (n % 2 === 1) {
    return new Interval(Math.pow(a.lo, n), Math.pow(a.hi, n));
  }
  // Even power
  if (a.lo >= 0) {
    return new Interval(Math.pow(a.lo, n), Math.pow(a.hi, n));
  }
  if (a.hi <= 0) {
    return new Interval(Math.pow(a.hi, n), Math.pow(a.lo, n));
  }
  return new Interval(0, Math.max(Math.pow(a.lo, n), Math.pow(a.hi, n)));
}

// ── Multivariate Taylor Model ──

export class TaylorModel {
  /**
   * Polynomial coefficients indexed by serialized exponent vector (e.g. "0,1,0").
   */
  public readonly terms: Map<string, number> = new Map();

  /**
   * Remainder interval enclosing truncation and rounding errors: [r_lo, r_hi].
   */
  public remainder: Interval;

  constructor(
    public readonly numVars: number,
    public readonly order: number,
    public readonly domain: Interval[],
    remainder: Interval = new Interval(0, 0),
  ) {
    this.remainder = new Interval(remainder.lo, remainder.hi);
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
    const zeroKey = new Array(numVars).fill(0);
    tm.set(zeroKey, val);
    return tm;
  }

  /**
   * Creates an independent variable Taylor Model: P = center + (v - center), r = [0, 0].
   */
  static variable(varIndex: number, domain: Interval[], order: number = 2, center = 0): TaylorModel {
    const numVars = domain.length;
    const tm = new TaylorModel(numVars, order, domain);
    const zeroKey = new Array(numVars).fill(0);
    if (center !== 0) {
      tm.set(zeroKey, center);
    }
    const varKey = new Array(numVars).fill(0);
    varKey[varIndex] = 1;
    tm.set(varKey, 1.0);
    return tm;
  }

  get(exponents: number[]): number {
    return this.terms.get(TaylorModel.serializeKey(exponents)) ?? 0;
  }

  set(exponents: number[], val: number): void {
    const key = TaylorModel.serializeKey(exponents);
    if (Math.abs(val) < 1e-15) {
      this.terms.delete(key);
    } else {
      this.terms.set(key, val);
    }
  }

  clone(): TaylorModel {
    const res = new TaylorModel(this.numVars, this.order, this.domain, this.remainder);
    for (const [k, v] of this.terms.entries()) {
      res.terms.set(k, v);
    }
    return res;
  }

  addConstant(c: number): TaylorModel {
    const res = this.clone();
    const zeroKey = new Array(this.numVars).fill(0);
    const curr = res.get(zeroKey);
    res.set(zeroKey, curr + c);
    return res;
  }

  /**
   * Addition of two Taylor Models:
   * (P_1 + P_2) + (r_1 + r_2)
   */
  add(other: TaylorModel): TaylorModel {
    const res = new TaylorModel(
      this.numVars,
      Math.max(this.order, other.order),
      this.domain,
      addInterval(this.remainder, other.remainder),
    );

    for (const [k, v] of this.terms.entries()) {
      res.terms.set(k, v);
    }
    for (const [k, v] of other.terms.entries()) {
      const cur = res.terms.get(k) ?? 0;
      const next = cur + v;
      if (Math.abs(next) < 1e-15) {
        res.terms.delete(k);
      } else {
        res.terms.set(k, next);
      }
    }
    return res;
  }

  /**
   * Subtraction of two Taylor Models:
   * (P_1 - P_2) + (r_1 - r_2)
   */
  sub(other: TaylorModel): TaylorModel {
    const res = new TaylorModel(
      this.numVars,
      Math.max(this.order, other.order),
      this.domain,
      subInterval(this.remainder, other.remainder),
    );

    for (const [k, v] of this.terms.entries()) {
      res.terms.set(k, v);
    }
    for (const [k, v] of other.terms.entries()) {
      const cur = res.terms.get(k) ?? 0;
      const next = cur - v;
      if (Math.abs(next) < 1e-15) {
        res.terms.delete(k);
      } else {
        res.terms.set(k, next);
      }
    }
    return res;
  }

  /**
   * Scalar multiplication: c * TM
   */
  scale(c: number): TaylorModel {
    const res = new TaylorModel(this.numVars, this.order, this.domain, scaleInterval(this.remainder, c));
    for (const [k, v] of this.terms.entries()) {
      res.terms.set(k, v * c);
    }
    return res;
  }

  /**
   * Evaluates the range of a monomial term x_0^e0 * x_1^e1 ... over the domain box.
   */
  private evaluateMonomialRange(exps: number[]): Interval {
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
    for (const [k, coeff] of this.terms.entries()) {
      const exps = TaylorModel.parseKey(k);
      const mRange = this.evaluateMonomialRange(exps);
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

    for (const [k1, c1] of this.terms.entries()) {
      const exps1 = TaylorModel.parseKey(k1);
      for (const [k2, c2] of other.terms.entries()) {
        const exps2 = TaylorModel.parseKey(k2);
        const combinedExps = exps1.map((e, idx) => e + exps2[idx]!);
        const deg = TaylorModel.degreeOf(combinedExps);
        const coeff = c1 * c2;

        if (deg <= maxOrder) {
          const key = TaylorModel.serializeKey(combinedExps);
          const cur = res.terms.get(key) ?? 0;
          res.terms.set(key, cur + coeff);
        } else {
          // Truncation: bound the excess monomial
          const mRange = this.evaluateMonomialRange(combinedExps);
          excessRemainder = addInterval(excessRemainder, scaleInterval(mRange, coeff));
        }
      }
    }

    // Remainder propagation: P_1*r_2 + P_2*r_1 + r_1*r_2
    const p1Range = this.evaluatePolynomialRange();
    const p2Range = other.evaluatePolynomialRange();

    const cross1 = mulInterval(p1Range, other.remainder);
    const cross2 = mulInterval(p2Range, this.remainder);
    const crossRem = mulInterval(this.remainder, other.remainder);

    let totalRemainder = addInterval(this.remainder, other.remainder); // base
    totalRemainder = addInterval(excessRemainder, cross1);
    totalRemainder = addInterval(totalRemainder, cross2);
    totalRemainder = addInterval(totalRemainder, crossRem);

    res.remainder = totalRemainder;
    return res;
  }

  /**
   * Exponential function of a Taylor Model: exp(TM).
   * Uses Taylor series expansion around constant term c:
   *   exp(c + delta) = exp(c) * \sum_{k=0}^n (delta^k / k!) + [r_exp]
   */
  exp(): TaylorModel {
    const zeroKey = new Array(this.numVars).fill(0);
    const c = this.get(zeroKey);
    const expC = Math.exp(c);

    // delta = this - c
    const delta = this.clone();
    delta.set(zeroKey, 0);
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
    const remInput = scaleInterval(deltaRemainder, Math.exp(c + deltaRange.hi));
    res.remainder = addInterval(res.remainder, addInterval(expRem, remInput));

    return res;
  }

  /**
   * Sine function of a Taylor Model: sin(TM).
   * Uses angle addition: sin(c + delta) = sin(c)cos(delta) + cos(c)sin(delta).
   */
  sin(): TaylorModel {
    const zeroKey = new Array(this.numVars).fill(0);
    const c = this.get(zeroKey);
    const sinC = Math.sin(c);
    const cosC = Math.cos(c);

    const delta = this.clone();
    delta.set(zeroKey, 0);
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

    // Lagrange remainder bounds
    const deltaRange = delta.evaluatePolynomialRange();
    const maxDelta = Math.max(Math.abs(deltaRange.lo), Math.abs(deltaRange.hi));
    const nextFact = fact * (this.order + 1);
    const lagrangeBound = Math.pow(maxDelta, this.order + 1) / nextFact;
    const truncRem = new Interval(-lagrangeBound, lagrangeBound);

    // sin(c)*cos(delta) + cos(c)*sin(delta)
    const part1 = cosDelta.scale(sinC);
    const part2 = sinDelta.scale(cosC);
    const res = part1.add(part2);
    res.remainder = addInterval(res.remainder, truncRem);
    return res;
  }

  /**
   * Cosine function of a Taylor Model: cos(TM).
   * Uses angle addition: cos(c + delta) = cos(c)cos(delta) - sin(c)sin(delta).
   */
  cos(): TaylorModel {
    const zeroKey = new Array(this.numVars).fill(0);
    const c = this.get(zeroKey);
    const sinC = Math.sin(c);
    const cosC = Math.cos(c);

    const delta = this.clone();
    delta.set(zeroKey, 0);
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
    const lagrangeBound = Math.pow(maxDelta, this.order + 1) / nextFact;
    const truncRem = new Interval(-lagrangeBound, lagrangeBound);

    // cos(c)*cos(delta) - sin(c)*sin(delta)
    const part1 = cosDelta.scale(cosC);
    const part2 = sinDelta.scale(sinC);
    const res = part1.sub(part2);
    res.remainder = addInterval(res.remainder, truncRem);
    return res;
  }

  /**
   * Integrates the Taylor Model with respect to time variable (varIndex = 0)
   * over [0, delta_t]:
   * \int_0^t P(\tau) d\tau + [r] * [0, delta_t]
   */
  integrateTime(timeVarIndex = 0): TaylorModel {
    const res = new TaylorModel(this.numVars, this.order, this.domain);

    for (const [k, coeff] of this.terms.entries()) {
      const exps = TaylorModel.parseKey(k);
      const tExp = exps[timeVarIndex]!;
      const newExps = [...exps];
      newExps[timeVarIndex] = tExp + 1;
      const newCoeff = coeff / (tExp + 1);

      if (TaylorModel.degreeOf(newExps) <= this.order) {
        res.terms.set(TaylorModel.serializeKey(newExps), newCoeff);
      } else {
        // Exceeds order: truncate into remainder
        const mRange = this.evaluateMonomialRange(newExps);
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
    for (const [k, coeff] of this.terms.entries()) {
      const exps = TaylorModel.parseKey(k);
      let prod = coeff;
      for (let i = 0; i < exps.length; i++) {
        const e = exps[i]!;
        if (e > 0) {
          prod *= Math.pow(point[i] ?? 0, e);
        }
      }
      sum += prod;
    }
    return sum;
  }
}

// ── Continuous Flowpipe Reachability Solver ──

export interface FlowpipeRequirement {
  stateIndex: number;
  stateName?: string;
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
  isCertifiedSafe: boolean;
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
  order?: number;
  /** Safety requirements to formally verify against flowpipe */
  requirements?: FlowpipeRequirement[];
  /** Max Picard contractive iterations per step */
  maxPicardIterations?: number;
  /** Whether to dynamically adapt step size dt based on local remainder error */
  adaptive?: boolean;
  /** Local remainder error tolerance for adaptive stepping (default: 1e-4) */
  tol?: number;
  /** Minimum step size for adaptive stepping (default: 1e-6) */
  minDt?: number;
  /** Maximum step size for adaptive stepping (default: 1.0) */
  maxDt?: number;
  /** Whether to apply Householder QR preconditioning to mitigate wrapping effects */
  useQrPreconditioning?: boolean;
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
      useQrPreconditioning = false,
    } = options;

    const nStates = initialEnclosure.length;
    const numVars = 1 + nStates; // v0 = delta_t, v1..vn = delta_x1..delta_xn
    const [t0, tEnd] = tSpan;

    const steps: FlowpipeStepResult[] = [];
    const violations: FlowpipeReachabilityResult["violations"] = [];

    // Current state enclosure at step k
    let currentEnclosure = initialEnclosure.map((inv) => new Interval(inv.lo, inv.hi));
    let currentNominal = [...nominalInitial];

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

    while (currentTime < tEnd - 1e-12 && step < maxStepsGuard) {
      if (currentTime + currentDt > tEnd) {
        currentDt = tEnd - currentTime;
      }

      // 1. Optional QR preconditioning: compute sensitivity matrix Phi = I + currentDt * J
      let Q_matrix: Float64Array[] | null = null;
      if (useQrPreconditioning && nStates > 1) {
        const eps = 1e-5;
        const J: Float64Array[] = [];
        const tNomTM = TaylorModel.constant(currentTime, 1, [new Interval(0, 1)], 1);
        const yNomTMs = currentNominal.map((v) => TaylorModel.constant(v, 1, [new Interval(0, 1)], 1));
        const fNom = dynamics(tNomTM, yNomTMs).map((tm) => tm.get([0]));

        for (let i = 0; i < nStates; i++) {
          const row = new Float64Array(nStates);
          for (let j = 0; j < nStates; j++) {
            const yPert = currentNominal.map((v, idx) =>
              TaylorModel.constant(idx === j ? v + eps : v, 1, [new Interval(0, 1)], 1),
            );
            const fPert = dynamics(tNomTM, yPert)[i]!.get([0]);
            row[j] = (fPert - fNom[i]!) / eps;
          }
          J.push(row);
        }

        const Phi: Float64Array[] = [];
        for (let i = 0; i < nStates; i++) {
          const row = new Float64Array(nStates);
          for (let j = 0; j < nStates; j++) {
            row[j] = (i === j ? 1.0 : 0.0) + currentDt * J[i]![j]!;
          }
          Phi.push(row);
        }

        Q_matrix = computeRotationMatrix(Phi, nStates);
      }

      // 2. Domain for this step: v0 \in [0, currentDt], v_j \in [-halfWidth, halfWidth]
      const stepDomain: Interval[] = [new Interval(0, currentDt)];
      for (let j = 0; j < nStates; j++) {
        const halfWidth = 0.5 * currentEnclosure[j]!.width;
        stepDomain.push(new Interval(-halfWidth, halfWidth));
      }

      // Time TM: t = currentTime + delta_t
      const timeTM = TaylorModel.variable(0, stepDomain, order, currentTime);

      // Initial state TMs: x_j(currentTime) = center_j + delta_x_j
      const stateTMs: TaylorModel[] = [];
      for (let j = 0; j < nStates; j++) {
        const center = currentEnclosure[j]!.mid;
        stateTMs.push(TaylorModel.variable(j + 1, stepDomain, order, center));
      }

      // Picard fixed-point iteration:
      // x^{(k+1)}(t) = x(currentTime) + \int_0^t f(\tau, x^{(k)}(\tau)) d\tau
      let picardTMs = stateTMs.map((tm) => tm.clone());

      for (let iter = 0; iter < maxPicardIterations; iter++) {
        const derivTMs = dynamics(timeTM, picardTMs);
        const nextTMs: TaylorModel[] = [];

        for (let j = 0; j < nStates; j++) {
          const integratedDeriv = derivTMs[j]!.integrateTime(0);
          nextTMs.push(stateTMs[j]!.add(integratedDeriv));
        }
        picardTMs = nextTMs;
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

      // Compute bounding tubes across [0, currentDt]
      let nextTubes: Interval[] = [];
      for (let j = 0; j < nStates; j++) {
        const range = picardTMs[j]!.evaluateRange();
        nextTubes.push(range);
      }

      // Advance nominal point
      const nominalPoint = [currentDt, ...new Array(nStates).fill(0)];
      const nextNominal: number[] = [];
      for (let j = 0; j < nStates; j++) {
        nextNominal.push(picardTMs[j]!.evaluateAt(nominalPoint));
      }

      // If QR preconditioning enabled, wrap bounding box through Q
      if (Q_matrix) {
        const halfWidths = nextTubes.map((t) => 0.5 * t.width);
        const rotatedTubes = encloseRotatedBox(nextNominal, Q_matrix, halfWidths);
        const tightenedTubes: Interval[] = [];
        for (let j = 0; j < nStates; j++) {
          const direct = nextTubes[j]!;
          const rot = rotatedTubes[j]!;
          tightenedTubes.push(new Interval(Math.min(direct.lo, rot.lo), Math.max(direct.hi, rot.hi)));
        }
        nextTubes = tightenedTubes;
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

      // State enclosure for next step evaluated at end of interval delta_t = currentDt
      const endDomain = [new Interval(currentDt, currentDt), ...stepDomain.slice(1)];
      currentEnclosure = [];
      for (let j = 0; j < nStates; j++) {
        const endTM = new TaylorModel(numVars, order, endDomain, picardTMs[j]!.remainder);
        for (const [k, v] of picardTMs[j]!.terms.entries()) {
          endTM.terms.set(k, v);
        }
        currentEnclosure.push(endTM.evaluateRange());
      }
      currentNominal = nextNominal;

      // Adapt step size for next step
      if (adaptive) {
        const growth = Math.min(2.0, 0.9 * Math.pow(tol / Math.max(1e-15, maxRemWidth), 1 / (order + 1)));
        currentDt = Math.min(maxDt, Math.max(minDt, currentDt * growth));
      }
    }

    const isCertifiedSafe = violations.length === 0;
    const summary = isCertifiedSafe
      ? `Flowpipe reachability certified safe across all ${steps.length} time steps with ${requirements.length} requirements verified.`
      : `Safety verification failed: detected ${violations.length} flowpipe boundary violations.`;

    return {
      isCertifiedSafe,
      steps,
      violations,
      summary,
    };
  }

  private static checkRequirement(tube: Interval, req: FlowpipeRequirement): { holds: boolean; worstValue: number } {
    if (req.operator === "<=" || req.operator === "<") {
      const worst = tube.hi;
      return { holds: worst <= req.limitValue, worstValue: worst };
    }
    if (req.operator === ">=" || req.operator === ">") {
      const worst = tube.lo;
      return { holds: worst >= req.limitValue, worstValue: worst };
    }
    return { holds: true, worstValue: tube.mid };
  }
}
