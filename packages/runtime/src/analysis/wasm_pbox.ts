// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Rigorous Probability Boxes (P-Boxes) & Dempster–Shafer
 * Probability Bounds Analysis (PBA).
 *
 * Represents uncertain quantities as a finite Dempster–Shafer structure of focal
 * intervals { ([lo_k, hi_k], mass_k) } with sum(mass_k) = 1. Every focal interval
 * is outward-rounded using {@link nextDown}/{@link nextUp} so that:
 *
 *   - Belief (lower probability):      P_min(E) = sum_{focal subset of E} mass_k
 *   - Plausibility (upper probability): P_max(E) = sum_{focal intersects E} mass_k
 *
 * Guarantees true probability P(E) in [P_min(E), P_max(E)] for any distribution
 * enclosed by the P-box, enabling mathematically sound {@link ProbabilisticVerdict}
 * certification (`rigor: "rigorous"`).
 */

import { getDefaultWasmExports } from "../dae/wasm_loader.js";
import { probabilisticVerdictFromBounds, type ProbabilisticVerdict, type VerdictRigor } from "../formal/verdict.js";
import { ivAdd, ivDiv, ivMul, ivSub, nextDown, nextUp } from "./outward_rounding.js";
import { Interval } from "./wasm_interval.js";

interface PBoxWasmExports {
  memory: WebAssembly.Memory;
  alloc?: (size: number) => number;
  free?: (ptr: number) => void;
  pbox_meanBounds?: (loPtr: number, hiPtr: number, mPtr: number, n: number, outPtr: number) => void;
  pbox_probBound?: (
    loPtr: number,
    hiPtr: number,
    mPtr: number,
    n: number,
    opCode: number,
    threshold: number,
    outPtr: number,
  ) => void;
  pbox_combineIndependent?: (
    aLoPtr: number,
    aHiPtr: number,
    aMPtr: number,
    nA: number,
    bLoPtr: number,
    bHiPtr: number,
    bMPtr: number,
    nB: number,
    opCode: number,
    oLoPtr: number,
    oHiPtr: number,
    oMPtr: number,
  ) => number;
}

// ─────────────────────────────────────────────────────────────────────
// Normal Quantile (Acklam's rational approximation, |err| < 1.15e-9)
// ─────────────────────────────────────────────────────────────────────

const NORMAL_QUANTILE_SLACK = 1e-8;

function normalQuantileApprox(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  );
}

// ─────────────────────────────────────────────────────────────────────
// Focal Element & PBox Core Class
// ─────────────────────────────────────────────────────────────────────

export interface FocalElement {
  lo: number;
  hi: number;
  mass: number;
}

export type PBoxDependence = "independent" | "frechet";
export type PBoxComparisonOp = ">" | ">=" | "<" | "<=";

/**
 * Rigorous Probability Box (P-Box) backed by a Dempster–Shafer focal-element structure.
 */
export class PBox {
  public readonly focals: readonly FocalElement[];

  constructor(focals: FocalElement[]) {
    if (focals.length === 0) {
      throw new Error("PBox requires at least one focal element");
    }
    let totalMass = 0;
    for (const f of focals) {
      if (f.lo > f.hi) {
        throw new Error(`Invalid focal interval [${f.lo}, ${f.hi}]`);
      }
      if (f.mass < 0) {
        throw new Error(`Focal element mass must be non-negative, got ${f.mass}`);
      }
      totalMass += f.mass;
    }
    if (totalMass <= 0) {
      throw new Error("PBox total probability mass must be positive");
    }
    // Normalize mass to sum exactly to 1
    this.focals = focals.map((f) => ({
      lo: f.lo,
      hi: f.hi,
      mass: f.mass / totalMass,
    }));
  }

  /** Pure epistemic interval [lo, hi] with no distributional assumption (mass = 1). */
  public static fromInterval(lo: number, hi: number): PBox {
    return new PBox([{ lo, hi, mass: 1.0 }]);
  }

  /** Point mass at exact scalar value x. */
  public static fromPoint(x: number): PBox {
    return new PBox([{ lo: x, hi: x, mass: 1.0 }]);
  }

  /**
   * Sound outer P-box discretization of Uniform(lo, hi) into `numBins` equal-mass
   * focal intervals with outward rounding.
   */
  public static fromUniform(lo: number, hi: number, numBins = 32): PBox {
    if (lo > hi) throw new Error(`Invalid Uniform bounds [${lo}, ${hi}]`);
    if (lo === hi) return PBox.fromPoint(lo);
    const M = Math.max(1, numBins);
    const mass = 1 / M;
    const span = hi - lo;
    const focals: FocalElement[] = [];
    for (let k = 0; k < M; k++) {
      const a = k === 0 ? lo : nextDown(lo + (k / M) * span);
      const b = k === M - 1 ? hi : nextUp(lo + ((k + 1) / M) * span);
      focals.push({ lo: Math.max(lo, a), hi: Math.min(hi, b), mass });
    }
    return new PBox(focals);
  }

  /**
   * Sound outer P-box discretization of Normal(mean, stdDev) into `numBins` focal intervals.
   *
   * The leftmost and rightmost focal elements extend to -Infinity / +Infinity carrying
   * exact tail mass `tailEpsilon / 2` each, guaranteeing 100% sound CDF containment
   * over the entire real line.
   */
  public static fromNormal(mean: number, stdDev: number, numBins = 32, tailEpsilon = 1e-6): PBox {
    if (stdDev < 0) throw new Error(`Normal stdDev must be >= 0, got ${stdDev}`);
    if (stdDev === 0) return PBox.fromPoint(mean);
    return PBox.fromNormalRange(mean, mean, stdDev, stdDev, numBins, tailEpsilon);
  }

  /**
   * Sound imprecise Normal P-box for epistemic parameter uncertainty:
   *   mean in [meanLo, meanHi], stdDev in [stdLo, stdHi].
   */
  public static fromNormalRange(
    meanLo: number,
    meanHi: number,
    stdLo: number,
    stdHi: number,
    numBins = 32,
    tailEpsilon = 1e-6,
  ): PBox {
    if (meanLo > meanHi || stdLo < 0 || stdLo > stdHi) {
      throw new Error("Invalid NormalRange parameters");
    }
    const M = Math.max(3, numBins);
    const epsHalf = Math.min(0.1, Math.max(1e-12, tailEpsilon / 2));
    const innerMass = 1 - 2 * epsHalf;
    const innerBins = M - 2;
    const binMass = innerMass / innerBins;

    const quantileRange = (p: number): [number, number] => {
      const z = normalQuantileApprox(p);
      const zLo = z - NORMAL_QUANTILE_SLACK;
      const zHi = z + NORMAL_QUANTILE_SLACK;
      // Evaluate all 4 corners of [meanLo, meanHi] + [stdLo, stdHi] * [zLo, zHi]
      const c1 = nextDown(meanLo + stdLo * zLo);
      const c2 = nextDown(meanLo + stdHi * zLo);
      const c3 = nextUp(meanHi + stdLo * zHi);
      const c4 = nextUp(meanHi + stdHi * zHi);
      return [Math.min(c1, c2), Math.max(c3, c4)];
    };

    const focals: FocalElement[] = [];

    // Left unbounded tail: (-Infinity, q_hi(epsHalf)] with mass epsHalf
    const [, qFirstHi] = quantileRange(epsHalf);
    focals.push({ lo: -Infinity, hi: qFirstHi, mass: epsHalf });

    // Interior bins
    for (let k = 0; k < innerBins; k++) {
      const p0 = epsHalf + k * binMass;
      const p1 = epsHalf + (k + 1) * binMass;
      const [lo] = quantileRange(p0);
      const [, hi] = quantileRange(p1);
      focals.push({ lo, hi, mass: binMass });
    }

    // Right unbounded tail: [q_lo(1 - epsHalf), +Infinity) with mass epsHalf
    const [qLastLo] = quantileRange(1 - epsHalf);
    focals.push({ lo: qLastLo, hi: Infinity, mass: epsHalf });

    return new PBox(focals);
  }

  /**
   * Distribution-free Chebyshev/Cantelli P-box knowing ONLY mean and stdDev
   * (no Gaussian or symmetry assumption).
   */
  public static fromChebyshev(mean: number, stdDev: number, numBins = 32): PBox {
    if (stdDev < 0) throw new Error(`stdDev must be >= 0, got ${stdDev}`);
    if (stdDev === 0) return PBox.fromPoint(mean);
    const M = Math.max(3, numBins);
    const mass = 1 / M;
    const focals: FocalElement[] = [];

    // Cantelli inequality:
    //   For p in (0, 1): x_lo(p) = mu - sigma * sqrt((1 - p) / p)
    //                    x_hi(p) = mu + sigma * sqrt(p / (1 - p))
    for (let k = 0; k < M; k++) {
      const pLo = k / M;
      const pHi = (k + 1) / M;
      const lo = pLo <= 0 ? -Infinity : nextDown(mean - stdDev * Math.sqrt((1 - pLo) / pLo));
      const hi = pHi >= 1 ? Infinity : nextUp(mean + stdDev * Math.sqrt(pHi / (1 - pHi)));
      focals.push({ lo, hi, mass });
    }

    return new PBox(focals);
  }

  /** Sound outer support [min_k lo_k, max_k hi_k]. */
  public support(): [number, number] {
    let minLo = Infinity;
    let maxHi = -Infinity;
    for (const f of this.focals) {
      if (f.lo < minLo) minLo = f.lo;
      if (f.hi > maxHi) maxHi = f.hi;
    }
    return [minLo, maxHi];
  }

  /** Sound bounds [meanLo, meanHi] on the expectation E[X]. */
  public meanBounds(): [number, number] {
    const n = this.focals.length;
    const w = getDefaultWasmExports() as PBoxWasmExports | null;
    if (
      w &&
      typeof w.pbox_meanBounds === "function" &&
      typeof w.alloc === "function" &&
      typeof w.free === "function" &&
      n > 0
    ) {
      const loPtr = w.alloc(n * 8);
      const hiPtr = w.alloc(n * 8);
      const mPtr = w.alloc(n * 8);
      const outPtr = w.alloc(16);
      try {
        const loV = new Float64Array(w.memory.buffer, loPtr, n);
        const hiV = new Float64Array(w.memory.buffer, hiPtr, n);
        const mV = new Float64Array(w.memory.buffer, mPtr, n);
        for (let i = 0; i < n; i++) {
          const f = this.focals[i]!;
          loV[i] = f.lo;
          hiV[i] = f.hi;
          mV[i] = f.mass;
        }
        w.pbox_meanBounds(loPtr, hiPtr, mPtr, n, outPtr);
        const out = new Float64Array(w.memory.buffer, outPtr, 2);
        return [out[0]!, out[1]!];
      } finally {
        w.free(loPtr);
        w.free(hiPtr);
        w.free(mPtr);
        w.free(outPtr);
      }
    }

    let lo = 0;
    let hi = 0;
    for (const f of this.focals) {
      lo += f.mass * f.lo;
      hi += f.mass * f.hi;
    }
    return [Number.isFinite(lo) ? nextDown(lo) : lo, Number.isFinite(hi) ? nextUp(hi) : hi];
  }

  /** Sound lower and upper CDF bounds [F_lower(x), F_upper(x)] for P(X <= x). */
  public cdfBounds(x: number): [number, number] {
    let fLower = 0; // Guaranteed X <= x (entire focal <= x)
    let fUpper = 0; // Possible X <= x (focal lower endpoint <= x)
    for (const f of this.focals) {
      if (f.hi <= x) fLower += f.mass;
      if (f.lo <= x) fUpper += f.mass;
    }
    return [Math.max(0, Math.min(1, fLower)), Math.max(0, Math.min(1, fUpper))];
  }

  /** Sound probability bounds [pMin, pMax] for P(X op threshold). */
  public probBound(op: PBoxComparisonOp, threshold: number): [number, number] {
    const n = this.focals.length;
    const w = getDefaultWasmExports() as PBoxWasmExports | null;
    if (
      w &&
      typeof w.pbox_probBound === "function" &&
      typeof w.alloc === "function" &&
      typeof w.free === "function" &&
      n > 0
    ) {
      const opCode = op === ">" ? 0 : op === ">=" ? 1 : op === "<" ? 2 : 3;
      const loPtr = w.alloc(n * 8);
      const hiPtr = w.alloc(n * 8);
      const mPtr = w.alloc(n * 8);
      const outPtr = w.alloc(16);
      try {
        const loV = new Float64Array(w.memory.buffer, loPtr, n);
        const hiV = new Float64Array(w.memory.buffer, hiPtr, n);
        const mV = new Float64Array(w.memory.buffer, mPtr, n);
        for (let i = 0; i < n; i++) {
          const f = this.focals[i]!;
          loV[i] = f.lo;
          hiV[i] = f.hi;
          mV[i] = f.mass;
        }
        w.pbox_probBound(loPtr, hiPtr, mPtr, n, opCode, threshold, outPtr);
        const out = new Float64Array(w.memory.buffer, outPtr, 2);
        return [out[0]!, out[1]!];
      } finally {
        w.free(loPtr);
        w.free(hiPtr);
        w.free(mPtr);
        w.free(outPtr);
      }
    }

    let pMin = 0;
    let pMax = 0;
    for (const f of this.focals) {
      let alwaysTrue = false;
      let possiblyTrue = false;
      switch (op) {
        case ">":
          alwaysTrue = f.lo > threshold;
          possiblyTrue = f.hi > threshold;
          break;
        case ">=":
          alwaysTrue = f.lo >= threshold;
          possiblyTrue = f.hi >= threshold;
          break;
        case "<":
          alwaysTrue = f.hi < threshold;
          possiblyTrue = f.lo < threshold;
          break;
        case "<=":
          alwaysTrue = f.hi <= threshold;
          possiblyTrue = f.lo <= threshold;
          break;
      }
      if (alwaysTrue) pMin += f.mass;
      if (possiblyTrue) pMax += f.mass;
    }
    return [Math.max(0, Math.min(1, pMin)), Math.max(0, Math.min(1, pMax))];
  }

  /** Sound probability bounds [pMin, pMax] for P(lo <= X <= hi). */
  public probInRange(lo: number, hi: number): [number, number] {
    let pMin = 0;
    let pMax = 0;
    for (const f of this.focals) {
      if (f.lo >= lo && f.hi <= hi) pMin += f.mass;
      if (f.hi >= lo && f.lo <= hi) pMax += f.mass;
    }
    return [Math.max(0, Math.min(1, pMin)), Math.max(0, Math.min(1, pMax))];
  }

  /**
   * Verify a probabilistic requirement P(X op threshold) <= maxAllowedProbability,
   * returning a soundness-preserving {@link ProbabilisticVerdict}.
   */
  public verifyRequirement(
    op: PBoxComparisonOp,
    threshold: number,
    maxAllowedProbability: number,
    rigor: VerdictRigor = "rigorous",
  ): ProbabilisticVerdict {
    const bounds = this.probBound(op, threshold);
    const detail = `P(X ${op} ${threshold}) in [${bounds[0].toFixed(6)}, ${bounds[1].toFixed(6)}] vs limit <= ${maxAllowedProbability}`;
    return probabilisticVerdictFromBounds(bounds, maxAllowedProbability, rigor, detail);
  }

  /**
   * Soundly condense a P-box with many focal elements down to at most `maxBins`
   * focal elements while strictly preserving outer CDF containment.
   */
  public condense(maxBins: number): PBox {
    const target = Math.max(2, maxBins);
    if (this.focals.length <= target) return this;

    // Build quantile-ordered upper & lower CDF envelopes:
    // Sort lower endpoints for F_upper, and upper endpoints for F_lower
    const byLo = [...this.focals].sort((a, b) => a.lo - b.lo);
    const byHi = [...this.focals].sort((a, b) => a.hi - b.hi);

    const sampleInverse = (sorted: FocalElement[], field: "lo" | "hi", p: number): number => {
      let cum = 0;
      for (let i = 0; i < sorted.length; i++) {
        cum += sorted[i]!.mass;
        if (cum >= p - 1e-15) return sorted[i]![field];
      }
      return sorted[sorted.length - 1]![field];
    };

    const mass = 1 / target;
    const condensed: FocalElement[] = [];
    for (let k = 0; k < target; k++) {
      const p0 = k / target;
      const p1 = (k + 1) / target;
      // Outer enclosure of [p0, p1] quantile slice:
      // lowest possible value at p0 from byLo, highest possible value at p1 from byHi
      const lo = sampleInverse(byLo, "lo", Math.max(1e-15, p0));
      const hi = sampleInverse(byHi, "hi", Math.min(1, p1));
      condensed.push({ lo, hi: Math.max(lo, hi), mass });
    }
    return new PBox(condensed);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Sound P-Box Binary Arithmetic (Independent & Fréchet)
// ─────────────────────────────────────────────────────────────────────

type BinaryIntervalOp = (a: Interval, b: Interval) => Interval;

function combinePBoxes(
  a: PBox,
  b: PBox,
  op: BinaryIntervalOp,
  opCode: 0 | 1 | 2 | 3,
  dependence: PBoxDependence = "independent",
  maxBins = 64,
): PBox {
  if (dependence === "independent") {
    const nA = a.focals.length;
    const nB = b.focals.length;
    const w = getDefaultWasmExports() as PBoxWasmExports | null;
    if (
      w &&
      typeof w.pbox_combineIndependent === "function" &&
      typeof w.alloc === "function" &&
      typeof w.free === "function" &&
      nA > 0 &&
      nB > 0
    ) {
      const nOut = nA * nB;
      const aLoPtr = w.alloc(nA * 8);
      const aHiPtr = w.alloc(nA * 8);
      const aMPtr = w.alloc(nA * 8);
      const bLoPtr = w.alloc(nB * 8);
      const bHiPtr = w.alloc(nB * 8);
      const bMPtr = w.alloc(nB * 8);
      const oLoPtr = w.alloc(nOut * 8);
      const oHiPtr = w.alloc(nOut * 8);
      const oMPtr = w.alloc(nOut * 8);
      try {
        const aLoV = new Float64Array(w.memory.buffer, aLoPtr, nA);
        const aHiV = new Float64Array(w.memory.buffer, aHiPtr, nA);
        const aMV = new Float64Array(w.memory.buffer, aMPtr, nA);
        for (let i = 0; i < nA; i++) {
          const f = a.focals[i]!;
          aLoV[i] = f.lo;
          aHiV[i] = f.hi;
          aMV[i] = f.mass;
        }
        const bLoV = new Float64Array(w.memory.buffer, bLoPtr, nB);
        const bHiV = new Float64Array(w.memory.buffer, bHiPtr, nB);
        const bMV = new Float64Array(w.memory.buffer, bMPtr, nB);
        for (let j = 0; j < nB; j++) {
          const f = b.focals[j]!;
          bLoV[j] = f.lo;
          bHiV[j] = f.hi;
          bMV[j] = f.mass;
        }

        const count: number = w.pbox_combineIndependent(
          aLoPtr,
          aHiPtr,
          aMPtr,
          nA,
          bLoPtr,
          bHiPtr,
          bMPtr,
          nB,
          opCode,
          oLoPtr,
          oHiPtr,
          oMPtr,
        );

        const oLoV = new Float64Array(w.memory.buffer, oLoPtr, count);
        const oHiV = new Float64Array(w.memory.buffer, oHiPtr, count);
        const oMV = new Float64Array(w.memory.buffer, oMPtr, count);
        const raw: FocalElement[] = new Array(count);
        for (let k = 0; k < count; k++) {
          raw[k] = { lo: oLoV[k]!, hi: oHiV[k]!, mass: oMV[k]! };
        }
        return new PBox(raw).condense(maxBins);
      } finally {
        w.free(aLoPtr);
        w.free(aHiPtr);
        w.free(aMPtr);
        w.free(bLoPtr);
        w.free(bHiPtr);
        w.free(bMPtr);
        w.free(oLoPtr);
        w.free(oHiPtr);
        w.free(oMPtr);
      }
    }

    const raw: FocalElement[] = [];
    for (const fa of a.focals) {
      const ia = new Interval(fa.lo, fa.hi);
      for (const fb of b.focals) {
        const res = op(ia, new Interval(fb.lo, fb.hi));
        raw.push({ lo: res.lo, hi: res.hi, mass: fa.mass * fb.mass });
      }
    }
    return new PBox(raw).condense(maxBins);
  }

  // Fréchet bounds (Williamson & Downs, 1990) — sound for ANY unknown copula/dependence.
  // Discretize both operands onto a uniform M-bin grid first.
  const M = Math.min(maxBins, Math.max(a.focals.length, b.focals.length, 16));
  const aGrid = a.condense(M);
  const bGrid = b.condense(M);

  const aLo = [...aGrid.focals].map((f) => f.lo).sort((x, y) => x - y);
  const aHi = [...aGrid.focals].map((f) => f.hi).sort((x, y) => x - y);
  const bLo = [...bGrid.focals].map((f) => f.lo).sort((x, y) => x - y);
  const bHi = [...bGrid.focals].map((f) => f.hi).sort((x, y) => x - y);

  // For each quantile k in 0..M-1:
  //   Frechet lower quantile z_lo[k] = min_{i + j = k}     op_lo(aLo[i], bLo[j])
  //   Frechet upper quantile z_hi[k] = max_{i + j = k+M-1} op_hi(aHi[i], bHi[j])
  const focals: FocalElement[] = [];
  const mass = 1 / M;
  for (let k = 0; k < M; k++) {
    let minVal = Infinity;
    for (let i = 0; i <= k; i++) {
      const j = k - i;
      const r = op(new Interval(aLo[i]!, aHi[i]!), new Interval(bLo[j]!, bHi[j]!));
      if (r.lo < minVal) minVal = r.lo;
    }
    let maxVal = -Infinity;
    for (let i = k; i < M; i++) {
      const j = k + M - 1 - i;
      const r = op(new Interval(aLo[i]!, aHi[i]!), new Interval(bLo[j]!, bHi[j]!));
      if (r.hi > maxVal) maxVal = r.hi;
    }
    focals.push({ lo: minVal, hi: Math.max(minVal, maxVal), mass });
  }
  return new PBox(focals);
}

export function pboxAdd(a: PBox, b: PBox, dependence: PBoxDependence = "independent", maxBins = 64): PBox {
  return combinePBoxes(a, b, ivAdd, 0, dependence, maxBins);
}

export function pboxSub(a: PBox, b: PBox, dependence: PBoxDependence = "independent", maxBins = 64): PBox {
  return combinePBoxes(a, b, ivSub, 1, dependence, maxBins);
}

export function pboxMul(a: PBox, b: PBox, dependence: PBoxDependence = "independent", maxBins = 64): PBox {
  return combinePBoxes(a, b, ivMul, 2, dependence, maxBins);
}

export function pboxDiv(a: PBox, b: PBox, dependence: PBoxDependence = "independent", maxBins = 64): PBox {
  return combinePBoxes(a, b, ivDiv, 3, dependence, maxBins);
}

// ─────────────────────────────────────────────────────────────────────
// Rigorous Propagation Through Arbitrary Interval Extensions
// ─────────────────────────────────────────────────────────────────────

export interface PBoxPropagationOptions {
  /** Maximum focal elements to retain after condensation (default: 64). */
  maxBins?: number | undefined;
  /** Rigor level of the supplied interval extension `fnInterval` (default: "rigorous"). */
  rigor?: VerdictRigor | undefined;
}

export interface PBoxPropagationResult {
  outputs: PBox[];
  numFocalEvaluations: number;
  rigor: VerdictRigor;
}

/**
 * Soundly propagates independent input P-boxes through an interval extension
 * `fnInterval(boxes) -> Interval[]` by evaluating the Cartesian product of focal boxes.
 *
 * When `fnInterval` is outward-rounded (e.g. built from `outward_rounding.ts` or
 * validated Taylor-model / DAE flowpipe enclosures), the resulting output P-boxes
 * are mathematically guaranteed to enclose the true output distributions.
 */
export function propagatePBox(
  fnInterval: (boxes: Interval[]) => Interval[],
  inputs: PBox[],
  options?: PBoxPropagationOptions,
): PBoxPropagationResult {
  const maxBins = options?.maxBins ?? 64;
  const rigor: VerdictRigor = options?.rigor ?? "rigorous";
  const d = inputs.length;

  if (d === 0) {
    const out = fnInterval([]);
    return {
      outputs: out.map((iv) => PBox.fromInterval(iv.lo, iv.hi)),
      numFocalEvaluations: 1,
      rigor,
    };
  }

  const focalLists = inputs.map((pb) => pb.focals);
  const rawOutputs: FocalElement[][] = [];
  let numFocalEvaluations = 0;

  const currentBoxes: Interval[] = new Array(d);

  const recurse = (axis: number, massAcc: number): void => {
    if (axis === d) {
      const outIntervals = fnInterval(currentBoxes);
      numFocalEvaluations++;
      if (rawOutputs.length === 0) {
        for (let m = 0; m < outIntervals.length; m++) rawOutputs.push([]);
      }
      for (let m = 0; m < outIntervals.length; m++) {
        const iv = outIntervals[m]!;
        rawOutputs[m]!.push({ lo: iv.lo, hi: iv.hi, mass: massAcc });
      }
      return;
    }
    const focals = focalLists[axis]!;
    for (let k = 0; k < focals.length; k++) {
      const f = focals[k]!;
      currentBoxes[axis] = new Interval(f.lo, f.hi);
      recurse(axis + 1, massAcc * f.mass);
    }
  };

  recurse(0, 1.0);

  return {
    outputs: rawOutputs.map((list) => new PBox(list).condense(maxBins)),
    numFocalEvaluations,
    rigor,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Validated P-Box ODE Flowpipe Propagation (All-Time Probabilistic Safety)
// ─────────────────────────────────────────────────────────────────────

export interface PBoxFlowpipeRequirement {
  stateIndex: number;
  operator: PBoxComparisonOp;
  threshold: number;
  maxAllowedProbability: number;
}

export interface PBoxFlowpipeOptions {
  /** Outward-rounded interval vector field f([t], [x]) -> Interval[]. */
  fInterval: (t: Interval, x: Interval[]) => Interval[];
  /** Uncertain initial state P-boxes (one per state dimension). */
  initialPBoxes: PBox[];
  /** Time horizon [t0, tEnd]. */
  tSpan: [number, number];
  /** Integration step size dt. */
  dt: number;
  /** Optional all-time probabilistic safety requirements over [t0, tEnd]. */
  requirements?: PBoxFlowpipeRequirement[] | undefined;
  /** Maximum focal elements retained per state P-box (default: 64). */
  maxBins?: number | undefined;
  /** Maximum Picard enclosure inflation iterations per step (default: 12). */
  maxPicardIter?: number | undefined;
}

export interface PBoxFlowpipeResult {
  times: number[];
  /** Time-varying state P-boxes: statePBoxes[timeIdx][stateIdx]. */
  statePBoxes: PBox[][];
  /** Per-requirement all-time probabilistic safety verdicts over [t0, tEnd]. */
  verdicts: ProbabilisticVerdict[];
  numFocalTrajectories: number;
  /** True only if every focal trajectory achieved validated Picard enclosure at every step. */
  allPicardValidated: boolean;
  rigor: VerdictRigor;
}

/**
 * Validated single-step Picard–Lindelöf interval enclosure for dx/dt = f(t, x):
 * Finds an a-priori enclosure B such that X0 + [0, dt] * f([t, t+dt], B) subseteq B,
 * then computes the tightened next-step box X1 = X0 + dt * f([t, t+dt], B).
 */
function validatedPicardStep(
  fInterval: (t: Interval, x: Interval[]) => Interval[],
  t0: number,
  dt: number,
  x0: Interval[],
  maxPicardIter: number,
): { validated: boolean; enclosure: Interval[]; nextBox: Interval[] } {
  const n = x0.length;
  const tIv = new Interval(t0, nextUp(t0 + dt));
  const dtIv = new Interval(0, nextUp(dt));
  const dtExactIv = new Interval(nextDown(dt), nextUp(dt));

  // Initial guess from Euler step widened by 20%
  const f0 = fInterval(tIv, x0);
  let B: Interval[] = x0.map((xi, i) => {
    const step = ivMul(dtIv, f0[i]!);
    const raw = ivAdd(xi, step);
    const w = Math.max(1e-9, raw.hi - raw.lo);
    return new Interval(nextDown(raw.lo - 0.2 * w), nextUp(raw.hi + 0.2 * w));
  });

  for (let iter = 0; iter < maxPicardIter; iter++) {
    const fB = fInterval(tIv, B);
    const picard = x0.map((xi, i) => ivAdd(xi, ivMul(dtIv, fB[i]!)));

    let contained = true;
    for (let i = 0; i < n; i++) {
      if (picard[i]!.lo < B[i]!.lo || picard[i]!.hi > B[i]!.hi) {
        contained = false;
        break;
      }
    }

    if (contained) {
      // Tighten next-step enclosure: x(t0 + dt) in x0 + dt * f([t0, t0+dt], B)
      const nextBox = x0.map((xi, i) => {
        const candidate = ivAdd(xi, ivMul(dtExactIv, fB[i]!));
        // Intersect with Picard enclosure B for maximum tightness
        return new Interval(Math.max(B[i]!.lo, candidate.lo), Math.min(B[i]!.hi, candidate.hi));
      });
      return { validated: true, enclosure: B, nextBox };
    }

    // Inflate B around the hull of B and picard
    B = B.map((bi, i) => {
      const lo = Math.min(bi.lo, picard[i]!.lo);
      const hi = Math.max(bi.hi, picard[i]!.hi);
      const w = Math.max(1e-9, hi - lo);
      return new Interval(nextDown(lo - 0.25 * w), nextUp(hi + 0.25 * w));
    });
  }

  return { validated: false, enclosure: B, nextBox: B };
}

/**
 * Propagates uncertain initial-state P-boxes through a validated Picard–Lindelöf
 * interval flowpipe over [t0, tEnd].
 *
 * Each Cartesian-product focal box is propagated with outward-rounded Picard enclosures,
 * yielding both time-varying state P-boxes and sound all-time probabilistic safety verdicts
 * for P(exists t in [t0, tEnd] : x_i(t) op threshold) <= maxAllowedProbability.
 */
export function propagatePBoxFlowpipe(options: PBoxFlowpipeOptions): PBoxFlowpipeResult {
  const { fInterval, initialPBoxes, tSpan, dt } = options;
  const maxBins = options.maxBins ?? 64;
  const maxPicardIter = options.maxPicardIter ?? 12;
  const requirements = options.requirements ?? [];
  const d = initialPBoxes.length;
  const numSteps = Math.max(1, Math.ceil((tSpan[1] - tSpan[0]) / dt));
  const stepDt = (tSpan[1] - tSpan[0]) / numSteps;

  const times: number[] = Array.from({ length: numSteps + 1 }, (_, k) => tSpan[0] + k * stepDt);

  // Per-time, per-state focal lists
  const stepFocals: FocalElement[][][] = Array.from({ length: numSteps + 1 }, () =>
    Array.from({ length: d }, () => []),
  );

  // Per-requirement all-time violation mass bounds [pMin, pMax]
  const reqPMin = new Array<number>(requirements.length).fill(0);
  const reqPMax = new Array<number>(requirements.length).fill(0);

  let numFocalTrajectories = 0;
  let allPicardValidated = true;
  const currentInit: Interval[] = new Array(d);

  const checkIntervalEvent = (
    iv: Interval,
    op: PBoxComparisonOp,
    threshold: number,
  ): { always: boolean; possible: boolean } => {
    switch (op) {
      case ">":
        return { always: iv.lo > threshold, possible: iv.hi > threshold };
      case ">=":
        return { always: iv.lo >= threshold, possible: iv.hi >= threshold };
      case "<":
        return { always: iv.hi < threshold, possible: iv.lo < threshold };
      case "<=":
        return { always: iv.hi <= threshold, possible: iv.lo <= threshold };
    }
  };

  const runFocalTrajectory = (mass: number): void => {
    numFocalTrajectories++;
    let box = currentInit.slice();

    // Track whether this focal trajectory definitely or possibly breaches each requirement at ANY t in [t0, tEnd]
    const trajAlwaysBreach = new Array<boolean>(requirements.length).fill(false);
    const trajPossibleBreach = new Array<boolean>(requirements.length).fill(false);

    for (let s = 0; s < d; s++) {
      stepFocals[0]![s]!.push({ lo: box[s]!.lo, hi: box[s]!.hi, mass });
    }
    for (let r = 0; r < requirements.length; r++) {
      const req = requirements[r]!;
      const chk = checkIntervalEvent(box[req.stateIndex]!, req.operator, req.threshold);
      if (chk.always) trajAlwaysBreach[r] = true;
      if (chk.possible) trajPossibleBreach[r] = true;
    }

    for (let step = 0; step < numSteps; step++) {
      const res = validatedPicardStep(fInterval, times[step]!, stepDt, box, maxPicardIter);
      if (!res.validated) {
        allPicardValidated = false;
      }
      // Check requirements against the full continuous-time enclosure B over [t_k, t_{k+1}]
      for (let r = 0; r < requirements.length; r++) {
        const req = requirements[r]!;
        const chkEnc = checkIntervalEvent(res.enclosure[req.stateIndex]!, req.operator, req.threshold);
        if (chkEnc.possible) trajPossibleBreach[r] = true;
        // Guaranteed breach if the tightened state box at t_{k+1} lies wholly in the unsafe region
        const chkEnd = checkIntervalEvent(res.nextBox[req.stateIndex]!, req.operator, req.threshold);
        if (chkEnd.always) trajAlwaysBreach[r] = true;
      }

      box = res.nextBox;
      for (let s = 0; s < d; s++) {
        stepFocals[step + 1]![s]!.push({ lo: box[s]!.lo, hi: box[s]!.hi, mass });
      }
    }

    for (let r = 0; r < requirements.length; r++) {
      if (trajAlwaysBreach[r]) reqPMin[r]! += mass;
      if (trajPossibleBreach[r]) reqPMax[r]! += mass;
    }
  };

  const recurse = (axis: number, massAcc: number): void => {
    if (axis === d) {
      runFocalTrajectory(massAcc);
      return;
    }
    for (const f of initialPBoxes[axis]!.focals) {
      currentInit[axis] = new Interval(f.lo, f.hi);
      recurse(axis + 1, massAcc * f.mass);
    }
  };

  recurse(0, 1.0);

  const rigor: VerdictRigor = allPicardValidated ? "rigorous" : "heuristic";
  const statePBoxes: PBox[][] = stepFocals.map((perState) =>
    perState.map((focals) => new PBox(focals).condense(maxBins)),
  );

  const verdicts: ProbabilisticVerdict[] = requirements.map((req, r) => {
    const bounds: [number, number] = [Math.max(0, Math.min(1, reqPMin[r]!)), Math.max(0, Math.min(1, reqPMax[r]!))];
    return probabilisticVerdictFromBounds(
      bounds,
      req.maxAllowedProbability,
      rigor,
      `All-time P(exists t in [${tSpan[0]}, ${tSpan[1]}]: x[${req.stateIndex}] ${req.operator} ${req.threshold}) in [${bounds[0].toFixed(6)}, ${bounds[1].toFixed(6)}]`,
    );
  });

  return {
    times,
    statePBoxes,
    verdicts,
    numFocalTrajectories,
    allPicardValidated,
    rigor,
  };
}
