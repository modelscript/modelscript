// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Set-Based Graph (SBGraph) & Multi-Dimensional Interval (MDI) Structural Analysis,
 * Vector Causalization, Array-Preserving Alias Elimination, Set-Based Connector
 * Expansion, and Micro-Modelica (μ-Modelica) Discontinuity Lowering on `DAEBuilder`.
 *
 * Implements the mathematical abstractions and algorithms from CIFASIS/modelicacc:
 *   - 1D Strided Intervals (`SBGInterval`: `[lo, step, hi]`), Multi-Dimensional Intervals
 *     (`MultiInterval` / `MDI`), Disjoint Multi-Interval Sets (`SBGSet`), Affine Maps (`LMap`),
 *     and Piecewise Linear Maps (`PWLMap`).
 *   - Set-Based Graph (`SBGraph`) Connected Components (`connectedComponents`) and
 *     Set-Based Bipartite Matching (`sbgMatching` via `waspf` / `waspu` augmenting paths).
 *   - Multi-Dimensional Intentional Vector Causalization (`VectorCausalizationGraph`,
 *     `VectorMatching`, `VectorTarjan`, `splitForArena`, `isolateSymbolicallyForArena`,
 *     `causalizeVectorArena`) operating directly on `DAEBuilder` `EqKind.For` (`ForEquationMeta`)
 *     without unrolling loops.
 *   - Array-Preserving Loop Alias Elimination (`eliminateVectorArenaAliases`), Set-Based
 *     Connector Expansion (`expandSetBasedConnectionsArena`), and μ-Modelica Discontinuity
 *     Lowering (`convertArenaToMicroModelica`).
 */

import {
  BinOp,
  Causality,
  type DAEBuilder,
  EqKind,
  ExprKind,
  type ForEquationMeta,
  UnaryOp,
  VarAttrKind,
  Variability,
  VarType,
} from "../dae/wasm_dae.js";
import { isZeroExpr } from "./wasm_blt.js";

// ─────────────────────────────────────────────────────────────────────────────
// Number-Theoretic Helpers (GCD, Extended GCD, LCM)
// ─────────────────────────────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x === 0 ? 1 : x;
}

function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs(Math.trunc((a / gcd(a, b)) * b));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 1D Strided Integer Interval (`SBGInterval`: [lo, step, hi])
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1D strided integer interval $[lo, step, hi] = \{ x \in \mathbb{Z} \mid lo \le x \le hi \land (x - lo) \equiv 0 \pmod{step} \}$.
 * Normalizes `hi` so that `hi = lo + k * step` for some integer $k \ge 0$ whenever non-empty.
 */
export class SBGInterval {
  public readonly lo: number;
  public readonly step: number;
  public readonly hi: number;

  constructor(lo: number, step = 1, hi?: number) {
    const s = step <= 0 ? 1 : Math.trunc(step);
    const l = Math.trunc(lo);
    const hRaw = hi === undefined ? l : Math.trunc(hi);
    if (hRaw < l) {
      this.lo = 1;
      this.step = 1;
      this.hi = 0; // canonical empty interval
    } else {
      const rem = (hRaw - l) % s;
      this.lo = l;
      this.step = s;
      this.hi = hRaw - rem;
    }
  }

  /** Creates a canonical empty 1D interval. */
  static empty(): SBGInterval {
    return new SBGInterval(1, 1, 0);
  }

  /** True when the interval contains no integer elements (`hi < lo`). */
  isEmpty(): boolean {
    return this.hi < this.lo;
  }

  /** Cardinality (number of integer points) in this interval. */
  size(): number {
    if (this.isEmpty()) return 0;
    return Math.floor((this.hi - this.lo) / this.step) + 1;
  }

  /** Checks whether integer `x` belongs to $[lo, step, hi]$. */
  isIn(x: number): boolean {
    if (this.isEmpty()) return false;
    if (!Number.isInteger(x) || x < this.lo || x > this.hi) return false;
    return (x - this.lo) % this.step === 0;
  }

  /** Checks structural equality of two 1D strided intervals. */
  equals(other: SBGInterval): boolean {
    if (this.isEmpty() && other.isEmpty()) return true;
    if (this.isEmpty() || other.isEmpty()) return false;
    if (this.size() === 1 && other.size() === 1) return this.lo === other.lo;
    return this.lo === other.lo && this.step === other.step && this.hi === other.hi;
  }

  /** Checks whether `this` is a subset of `other` ($I_1 \subseteq I_2$). */
  subseteq(other: SBGInterval): boolean {
    if (this.isEmpty()) return true;
    if (other.isEmpty()) return false;
    return this.cap(other).equals(this);
  }

  /**
   * Exact intersection of two strided intervals $[lo_1, s_1, hi_1] \cap [lo_2, s_2, hi_2]$.
   * Uses modular arithmetic and $\text{lcm}(s_1, s_2)$ as in `IntervalImp1::cap`.
   */
  cap(other: SBGInterval): SBGInterval {
    if (this.isEmpty() || other.isEmpty()) return SBGInterval.empty();
    const maxLo = Math.max(this.lo, other.lo);
    const minHi = Math.min(this.hi, other.hi);
    if (maxLo > minHi) return SBGInterval.empty();

    const g = gcd(this.step, other.step);
    if ((this.lo - other.lo) % g !== 0) {
      return SBGInterval.empty();
    }

    const newStep = lcm(this.step, other.step);
    // Align starting from maxLo along `this`'s grid
    const rem1 = (maxLo - this.lo) % this.step;
    let candidate = rem1 === 0 ? maxLo : maxLo + (this.step - rem1);
    const maxSteps = Math.trunc(other.step / g);
    let found = false;
    for (let k = 0; k < maxSteps && candidate <= minHi; k++) {
      if ((candidate - other.lo) % other.step === 0) {
        found = true;
        break;
      }
      candidate += this.step;
    }
    if (!found || candidate > minHi) return SBGInterval.empty();
    return new SBGInterval(candidate, newStep, minHi);
  }

  /**
   * Set difference $I_1 \setminus I_2$ decomposed into mutually disjoint strided intervals,
   * matching `IntervalImp1::diff` in `SBGraphs_graph_definition.h`.
   */
  diff(other: SBGInterval): SBGInterval[] {
    if (this.isEmpty()) return [];
    const inter = this.cap(other);
    if (inter.isEmpty()) return [this];

    const result: SBGInterval[] = [];
    // Elements strictly before `inter.lo`
    if (this.lo < inter.lo) {
      const left = new SBGInterval(this.lo, this.step, inter.lo - this.step);
      if (!left.isEmpty()) result.push(left);
    }
    // Elements strictly after `inter.hi`
    if (this.hi > inter.hi) {
      const right = new SBGInterval(inter.hi + this.step, this.step, this.hi);
      if (!right.isEmpty()) result.push(right);
    }
    // Interleaved residue classes within [inter.lo, inter.hi] when inter.step > this.step
    if (inter.step > this.step) {
      const ratio = Math.trunc(inter.step / this.step);
      for (let r = 1; r < ratio; r++) {
        const resInt = new SBGInterval(inter.lo + r * this.step, inter.step, inter.hi);
        if (!resInt.isEmpty()) result.push(resInt);
      }
    }
    return result;
  }

  /** Shifts the interval by `+off`: $[lo + off, step, hi + off]$. */
  offset(off: number): SBGInterval {
    if (this.isEmpty()) return this;
    return new SBGInterval(this.lo + off, this.step, this.hi + off);
  }

  /** Scales the interval by a positive integer factor $g > 0$: $[g \cdot lo, g \cdot step, g \cdot hi]$. */
  scale(gain: number): SBGInterval {
    if (this.isEmpty()) return this;
    if (gain === 0) return new SBGInterval(0, 1, 0);
    const g = Math.trunc(gain);
    if (g > 0) {
      return new SBGInterval(this.lo * g, this.step * g, this.hi * g);
    }
    const a = this.hi * g;
    const b = this.lo * g;
    return new SBGInterval(a, Math.abs(g) * this.step, b);
  }

  /** Checks if two intervals can be compacted into a single contiguous strided interval. */
  canCompact(other: SBGInterval): boolean {
    if (this.isEmpty() || other.isEmpty()) return false;
    if (this.size() > 1 && other.size() > 1 && this.step !== other.step) return false;
    const s = this.size() > 1 ? this.step : other.size() > 1 ? other.step : Math.abs(other.lo - this.lo) || 1;
    if (
      this.hi + s === other.lo &&
      (this.size() === 1 || this.step === s) &&
      (other.size() === 1 || other.step === s)
    ) {
      return true;
    }
    if (
      other.hi + s === this.lo &&
      (this.size() === 1 || this.step === s) &&
      (other.size() === 1 || other.step === s)
    ) {
      return true;
    }
    return false;
  }

  /** Compacts two adjacent strided intervals into a single `SBGInterval`. */
  compact(other: SBGInterval): SBGInterval {
    const lo = Math.min(this.lo, other.lo);
    const hi = Math.max(this.hi, other.hi);
    const s = this.size() > 1 ? this.step : other.size() > 1 ? other.step : Math.max(1, Math.abs(other.lo - this.lo));
    return new SBGInterval(lo, s, hi);
  }

  toString(): string {
    if (this.isEmpty()) return "∅";
    return this.step === 1 ? `[${this.lo}:${this.hi}]` : `[${this.lo}:${this.step}:${this.hi}]`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Multi-Dimensional Interval (`MultiInterval` / `MDI`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Multi-Dimensional Interval (`MDI` / `MultiInterImp1`): Cartesian product
 * $I_1 \times I_2 \times \dots \times I_d$ of 1D strided integer intervals.
 */
export class MultiInterval {
  public readonly intervals: readonly SBGInterval[];

  constructor(intervals: readonly SBGInterval[]) {
    this.intervals = intervals;
  }

  /** Convenience constructor from `[lo, hi]` or `[lo, step, hi]` tuples. */
  static fromBounds(bounds: readonly (readonly [number, number] | readonly [number, number, number])[]): MultiInterval {
    return new MultiInterval(
      bounds.map((b) => (b.length === 2 ? new SBGInterval(b[0], 1, b[1]) : new SBGInterval(b[0], b[1], b[2]))),
    );
  }

  /** Number of dimensions $d$. */
  arity(): number {
    return this.intervals.length;
  }

  /** True if any dimension is empty. */
  isEmpty(): boolean {
    if (this.intervals.length === 0) return true;
    return this.intervals.some((iv) => iv.isEmpty());
  }

  /** Total number of integer lattice points in the multi-interval. */
  size(): number {
    if (this.isEmpty()) return 0;
    let prod = 1;
    for (const iv of this.intervals) {
      prod *= iv.size();
    }
    return prod;
  }

  /** Checks whether lattice point `pt` belongs to this multi-interval. */
  isIn(pt: readonly number[]): boolean {
    if (pt.length !== this.intervals.length || this.isEmpty()) return false;
    for (let d = 0; d < pt.length; d++) {
      if (!this.intervals[d]!.isIn(pt[d]!)) return false;
    }
    return true;
  }

  /** Lexicographically smallest lattice point in this multi-interval. */
  minElem(): number[] | null {
    if (this.isEmpty()) return null;
    return this.intervals.map((iv) => iv.lo);
  }

  /** Lexicographically largest lattice point in this multi-interval. */
  maxElem(): number[] | null {
    if (this.isEmpty()) return null;
    return this.intervals.map((iv) => iv.hi);
  }

  /** Structural equality check. */
  equals(other: MultiInterval): boolean {
    if (this.isEmpty() && other.isEmpty()) return true;
    if (this.arity() !== other.arity()) return false;
    for (let d = 0; d < this.intervals.length; d++) {
      if (!this.intervals[d]!.equals(other.intervals[d]!)) return false;
    }
    return true;
  }

  /** Subset check $M_1 \subseteq M_2$. */
  subseteq(other: MultiInterval): boolean {
    if (this.isEmpty()) return true;
    if (other.isEmpty() || this.arity() !== other.arity()) return false;
    for (let d = 0; d < this.intervals.length; d++) {
      if (!this.intervals[d]!.subseteq(other.intervals[d]!)) return false;
    }
    return true;
  }

  /** Component-wise intersection $M_1 \cap M_2$. */
  cap(other: MultiInterval): MultiInterval {
    if (this.arity() !== other.arity()) return new MultiInterval([SBGInterval.empty()]);
    const out: SBGInterval[] = [];
    for (let d = 0; d < this.intervals.length; d++) {
      const c = this.intervals[d]!.cap(other.intervals[d]!);
      if (c.isEmpty()) return new MultiInterval(this.intervals.map(() => SBGInterval.empty()));
      out.push(c);
    }
    return new MultiInterval(out);
  }

  /**
   * Multi-dimensional difference $M_1 \setminus M_2$ decomposed into mutually disjoint
   * `MultiInterval` boxes (`MultiInterImp1::diff` / `MDI::Minus`).
   */
  diff(other: MultiInterval): MultiInterval[] {
    if (this.isEmpty()) return [];
    const inter = this.cap(other);
    if (inter.isEmpty()) return [this];

    const result: MultiInterval[] = [];
    const dims = this.intervals.length;
    for (let d = 0; d < dims; d++) {
      const dimDiffs = this.intervals[d]!.diff(inter.intervals[d]!);
      for (const piece of dimDiffs) {
        if (piece.isEmpty()) continue;
        const box: SBGInterval[] = [];
        for (let k = 0; k < dims; k++) {
          if (k < d) {
            // Restrict prior dimensions to the intersection so pieces across dimensions are disjoint
            box.push(inter.intervals[k]!);
          } else if (k === d) {
            box.push(piece);
          } else {
            box.push(this.intervals[k]!);
          }
        }
        result.push(new MultiInterval(box));
      }
    }
    return result;
  }

  /** Cartesian product $M_1 \times M_2$. */
  crossProd(other: MultiInterval): MultiInterval {
    return new MultiInterval([...this.intervals, ...other.intervals]);
  }

  /**
   * Checks if two `MultiInterval`s agree on all dimensions except at most one dimension
   * where their 1D intervals can be compacted (`MDI::Compatibles`).
   */
  canCompact(other: MultiInterval): boolean {
    if (this.isEmpty() || other.isEmpty() || this.arity() !== other.arity()) return false;
    let diffDim = -1;
    for (let d = 0; d < this.intervals.length; d++) {
      if (!this.intervals[d]!.equals(other.intervals[d]!)) {
        if (diffDim !== -1) return false;
        diffDim = d;
      }
    }
    if (diffDim === -1) return true;
    return this.intervals[diffDim]!.canCompact(other.intervals[diffDim]!);
  }

  /** Compacts two compatible `MultiInterval`s into a single `MultiInterval`. */
  compact(other: MultiInterval): MultiInterval {
    if (this.equals(other)) return this;
    const out: SBGInterval[] = [];
    for (let d = 0; d < this.intervals.length; d++) {
      if (this.intervals[d]!.equals(other.intervals[d]!)) {
        out.push(this.intervals[d]!);
      } else {
        out.push(this.intervals[d]!.compact(other.intervals[d]!));
      }
    }
    return new MultiInterval(out);
  }

  /** Applies an affine offset `gain * x + offset` per dimension. */
  applyOffset(gain: readonly number[], offset: readonly number[]): MultiInterval {
    if (this.isEmpty()) return this;
    const out: SBGInterval[] = [];
    for (let d = 0; d < this.intervals.length; d++) {
      const g = gain[d] ?? 1;
      const o = offset[d] ?? 0;
      out.push(this.intervals[d]!.scale(g).offset(o));
    }
    return new MultiInterval(out);
  }

  toString(): string {
    if (this.isEmpty()) return "∅";
    return this.intervals.map((iv) => iv.toString()).join("×");
  }
}

/** Alias matching `CIFASIS/modelicacc`'s `MDI` class name. */
export { MultiInterval as MDI };

// ─────────────────────────────────────────────────────────────────────────────
// 3. Disjoint Multi-Interval Set (`SBGSet` / `SetImp1`)
// ─────────────────────────────────────────────────────────────────────────────

function comparePointsLex(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/**
 * Set of integer lattice points represented as a finite disjoint union of `MultiInterval`
 * atoms (`SetImp1` in `SBGraphs_graph_definition.h`).
 */
export class SBGSet {
  public readonly atoms: readonly MultiInterval[];

  constructor(atoms: readonly MultiInterval[] = []) {
    const disjoint: MultiInterval[] = [];
    for (const candidate of atoms) {
      if (candidate.isEmpty()) continue;
      let fragments: MultiInterval[] = [candidate];
      for (const existing of disjoint) {
        const nextFragments: MultiInterval[] = [];
        for (const frag of fragments) {
          nextFragments.push(...frag.diff(existing));
        }
        fragments = nextFragments;
        if (fragments.length === 0) break;
      }
      disjoint.push(...fragments);
    }
    this.atoms = SBGSet.compactAtoms(disjoint);
  }

  private static compactAtoms(atoms: MultiInterval[]): MultiInterval[] {
    const list = atoms.filter((a) => !a.isEmpty());
    let changed = true;
    while (changed && list.length > 1) {
      changed = false;
      outer: for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i]!.canCompact(list[j]!)) {
            list[i] = list[i]!.compact(list[j]!);
            list.splice(j, 1);
            changed = true;
            break outer;
          }
        }
      }
    }
    list.sort((a, b) => {
      const ma = a.minElem();
      const mb = b.minElem();
      if (!ma || !mb) return 0;
      return comparePointsLex(ma, mb);
    });
    return list;
  }

  static empty(): SBGSet {
    return new SBGSet([]);
  }

  static fromInterval(lo: number, step: number, hi: number): SBGSet {
    return new SBGSet([new MultiInterval([new SBGInterval(lo, step, hi)])]);
  }

  static fromMDI(mdi: MultiInterval): SBGSet {
    return new SBGSet([mdi]);
  }

  isEmpty(): boolean {
    return this.atoms.length === 0;
  }

  arity(): number {
    return this.atoms[0]?.arity() ?? 0;
  }

  size(): number {
    let total = 0;
    for (const a of this.atoms) total += a.size();
    return total;
  }

  isIn(pt: readonly number[]): boolean {
    return this.atoms.some((a) => a.isIn(pt));
  }

  minElem(): number[] | null {
    let best: number[] | null = null;
    for (const a of this.atoms) {
      const m = a.minElem();
      if (m && (!best || comparePointsLex(m, best) < 0)) {
        best = m;
      }
    }
    return best;
  }

  maxElem(): number[] | null {
    let best: number[] | null = null;
    for (const a of this.atoms) {
      const m = a.maxElem();
      if (m && (!best || comparePointsLex(m, best) > 0)) {
        best = m;
      }
    }
    return best;
  }

  /** Set intersection $S_1 \cap S_2$. */
  cap(other: SBGSet): SBGSet {
    if (this.isEmpty() || other.isEmpty()) return SBGSet.empty();
    const out: MultiInterval[] = [];
    for (const a of this.atoms) {
      for (const b of other.atoms) {
        const c = a.cap(b);
        if (!c.isEmpty()) out.push(c);
      }
    }
    return new SBGSet(out);
  }

  /** Set union $S_1 \cup S_2$. */
  cup(other: SBGSet): SBGSet {
    if (this.isEmpty()) return other;
    if (other.isEmpty()) return this;
    return new SBGSet([...this.atoms, ...other.atoms]);
  }

  /** Set difference $S_1 \setminus S_2$. */
  diff(other: SBGSet): SBGSet {
    if (this.isEmpty() || other.isEmpty()) return this;
    let fragments: MultiInterval[] = [...this.atoms];
    for (const b of other.atoms) {
      const next: MultiInterval[] = [];
      for (const frag of fragments) {
        next.push(...frag.diff(b));
      }
      fragments = next;
      if (fragments.length === 0) break;
    }
    return new SBGSet(fragments);
  }

  /** Subset check $S_1 \subseteq S_2$. */
  subseteq(other: SBGSet): boolean {
    return this.diff(other).isEmpty();
  }

  /** Set equality $S_1 = S_2$. */
  equals(other: SBGSet): boolean {
    return this.subseteq(other) && other.subseteq(this);
  }

  /** Cartesian product $S_1 \times S_2$. */
  crossProd(other: SBGSet): SBGSet {
    if (this.isEmpty() || other.isEmpty()) return SBGSet.empty();
    const out: MultiInterval[] = [];
    for (const a of this.atoms) {
      for (const b of other.atoms) {
        out.push(a.crossProd(b));
      }
    }
    return new SBGSet(out);
  }

  toString(): string {
    if (this.isEmpty()) return "{}";
    return `{${this.atoms.map((a) => a.toString()).join(" ∪ ")}}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Affine Maps (`LMap`) & Piecewise Linear Maps (`PWLMap`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * $d$-dimensional component-wise affine map $f(\vec{x}) = \vec{g} \odot \vec{x} + \vec{o}$
 * (`LMapImp1` in `SBGraphs_graph_definition.h`).
 * When `gain[i] === 0`, the $i$-th coordinate is mapped to the constant `offset[i]`.
 */
export class LMap {
  public readonly gain: readonly number[];
  public readonly offset: readonly number[];

  constructor(gain: readonly number[], offset: readonly number[]) {
    this.gain = gain;
    this.offset = offset;
  }

  static identity(dims = 1): LMap {
    return new LMap(new Array(dims).fill(1), new Array(dims).fill(0));
  }

  static constant(pt: readonly number[]): LMap {
    return new LMap(new Array(pt.length).fill(0), [...pt]);
  }

  arity(): number {
    return this.gain.length;
  }

  apply(pt: readonly number[]): number[] {
    return pt.map((v, i) => (this.gain[i] ?? 1) * v + (this.offset[i] ?? 0));
  }

  equals(other: LMap): boolean {
    if (this.gain.length !== other.gain.length) return false;
    for (let i = 0; i < this.gain.length; i++) {
      if (this.gain[i] !== other.gain[i] || this.offset[i] !== other.offset[i]) return false;
    }
    return true;
  }

  /** Forward image of a `MultiInterval` under this affine map. */
  imageMDI(mdi: MultiInterval): MultiInterval {
    if (mdi.isEmpty()) return mdi;
    const out: SBGInterval[] = [];
    for (let d = 0; d < mdi.intervals.length; d++) {
      const g = this.gain[d] ?? 1;
      const o = this.offset[d] ?? 0;
      const iv = mdi.intervals[d]!;
      if (g === 0) {
        out.push(new SBGInterval(o, 1, o));
      } else {
        out.push(iv.scale(g).offset(o));
      }
    }
    return new MultiInterval(out);
  }

  /**
   * Pre-image of a target `MultiInterval` $Y$ restricted to a domain `MultiInterval` $D$:
   * $\{ \vec{x} \in D \mid f(\vec{x}) \in Y \}$.
   */
  preImageMDI(domainMdi: MultiInterval, targetMdi: MultiInterval): MultiInterval {
    if (domainMdi.isEmpty() || targetMdi.isEmpty()) {
      return new MultiInterval(domainMdi.intervals.map(() => SBGInterval.empty()));
    }
    const out: SBGInterval[] = [];
    for (let d = 0; d < domainMdi.intervals.length; d++) {
      const g = this.gain[d] ?? 1;
      const o = this.offset[d] ?? 0;
      const domIv = domainMdi.intervals[d]!;
      const tgtIv = targetMdi.intervals[d]!;
      if (g === 0) {
        if (!tgtIv.isIn(o)) {
          return new MultiInterval(domainMdi.intervals.map(() => SBGInterval.empty()));
        }
        out.push(domIv);
      } else {
        // We need x in domIv such that g * x + o in tgtIv.
        // Map domIv forward, intersect with tgtIv, then map back via (y - o) / g
        const fwdDom = domIv.scale(g).offset(o);
        const common = fwdDom.cap(tgtIv);
        if (common.isEmpty()) {
          return new MultiInterval(domainMdi.intervals.map(() => SBGInterval.empty()));
        }
        const yLo = g > 0 ? common.lo : common.hi;
        const yHi = g > 0 ? common.hi : common.lo;
        const xLo = Math.trunc((yLo - o) / g);
        const xHi = Math.trunc((yHi - o) / g);
        const xStep = Math.max(1, Math.trunc(common.step / Math.abs(g)));
        out.push(new SBGInterval(Math.min(xLo, xHi), xStep, Math.max(xLo, xHi)).cap(domIv));
      }
    }
    return new MultiInterval(out);
  }

  /** Composition $(this \circ other)(\vec{x}) = this(other(\vec{x}))$. */
  compose(other: LMap): LMap {
    const g: number[] = [];
    const o: number[] = [];
    for (let d = 0; d < this.gain.length; d++) {
      const g1 = this.gain[d] ?? 1;
      const o1 = this.offset[d] ?? 0;
      const g2 = other.gain[d] ?? 1;
      const o2 = other.offset[d] ?? 0;
      g.push(g1 * g2);
      o.push(g1 * o2 + o1);
    }
    return new LMap(g, o);
  }
}

export interface PWLMapPiece {
  readonly dom: SBGSet;
  readonly map: LMap;
}

/**
 * Piecewise Linear Map (`PWLMapImp1` in `SBGraphs_graph_definition.h`), mapping
 * mutually disjoint `SBGSet` domains via `LMap` affine transformations.
 */
export class PWLMap {
  public readonly pieces: readonly PWLMapPiece[];

  constructor(pieces: readonly PWLMapPiece[] = []) {
    const normalized: PWLMapPiece[] = [];
    let covered = SBGSet.empty();
    for (const p of pieces) {
      const rem = p.dom.diff(covered);
      if (rem.isEmpty()) continue;
      covered = covered.cup(rem);
      // Merge with existing piece if they share the exact same LMap, or if one is a singleton
      // whose image agrees with an existing constant LMap
      const existingIdx = normalized.findIndex((e) => {
        if (e.map.equals(p.map)) return true;
        if (rem.size() === 1 && e.map.gain.every((g) => g === 0)) {
          const pt = rem.minElem()!;
          const v1 = p.map.apply(pt);
          const v2 = e.map.apply(pt);
          return v1.every((val, idx) => val === v2[idx]);
        }
        if (e.dom.size() === 1 && p.map.gain.every((g) => g === 0)) {
          const pt = e.dom.minElem()!;
          const v1 = e.map.apply(pt);
          const v2 = p.map.apply(pt);
          return v1.every((val, idx) => val === v2[idx]);
        }
        return false;
      });
      if (existingIdx >= 0) {
        const chosenMap = normalized[existingIdx]!.map.gain.every((g) => g === 0)
          ? normalized[existingIdx]!.map
          : p.map;
        normalized[existingIdx] = {
          dom: normalized[existingIdx]!.dom.cup(rem),
          map: chosenMap,
        };
      } else {
        normalized.push({ dom: rem, map: p.map });
      }
    }
    this.pieces = normalized;
  }

  static empty(): PWLMap {
    return new PWLMap([]);
  }

  static identity(dom: SBGSet): PWLMap {
    if (dom.isEmpty()) return PWLMap.empty();
    return new PWLMap([{ dom, map: LMap.identity(dom.arity()) }]);
  }

  isEmpty(): boolean {
    return this.pieces.length === 0;
  }

  /** Full domain $\bigcup_i D_i$ of this piecewise map. */
  dom(): SBGSet {
    let d = SBGSet.empty();
    for (const p of this.pieces) d = d.cup(p.dom);
    return d;
  }

  /** Evaluates the map on a single lattice point `pt`, or returns `null` if outside `dom()`. */
  apply(pt: readonly number[]): number[] | null {
    for (const p of this.pieces) {
      if (p.dom.isIn(pt)) return p.map.apply(pt);
    }
    return null;
  }

  /** Restriction $f|_{subDom}$. */
  restrictMap(subDom: SBGSet): PWLMap {
    if (subDom.isEmpty() || this.isEmpty()) return PWLMap.empty();
    const out: PWLMapPiece[] = [];
    for (const p of this.pieces) {
      const d = p.dom.cap(subDom);
      if (!d.isEmpty()) out.push({ dom: d, map: p.map });
    }
    return new PWLMap(out);
  }

  /** Forward image $f(subDom)$ (or $f(\text{dom}(f))$ when `subDom` is omitted). */
  image(subDom?: SBGSet): SBGSet {
    const target = subDom ? this.restrictMap(subDom) : this;
    const outAtoms: MultiInterval[] = [];
    for (const p of target.pieces) {
      for (const atom of p.dom.atoms) {
        const img = p.map.imageMDI(atom);
        if (!img.isEmpty()) outAtoms.push(img);
      }
    }
    return new SBGSet(outAtoms);
  }

  /** Pre-image $f^{-1}(targetSet) = \{ x \in \text{dom}(f) \mid f(x) \in targetSet \}$. */
  preImage(targetSet: SBGSet): SBGSet {
    if (targetSet.isEmpty() || this.isEmpty()) return SBGSet.empty();
    const outAtoms: MultiInterval[] = [];
    for (const p of this.pieces) {
      for (const domAtom of p.dom.atoms) {
        for (const tgtAtom of targetSet.atoms) {
          const pre = p.map.preImageMDI(domAtom, tgtAtom);
          if (!pre.isEmpty()) outAtoms.push(pre);
        }
      }
    }
    return new SBGSet(outAtoms);
  }

  /** Override combination $f_1 \sqcup f_2$: applies `this` on `this.dom()` and `other` on `other.dom() \setminus this.dom()`. */
  combine(other: PWLMap): PWLMap {
    if (this.isEmpty()) return other;
    if (other.isEmpty()) return this;
    return new PWLMap([...this.pieces, ...other.pieces]);
  }

  /** Composition $(this \circ other)(x) = this(other(x))$. */
  compPW(other: PWLMap): PWLMap {
    if (this.isEmpty() || other.isEmpty()) return PWLMap.empty();
    const out: PWLMapPiece[] = [];
    for (const p2 of other.pieces) {
      for (const atom2 of p2.dom.atoms) {
        const img2 = p2.map.imageMDI(atom2);
        const imgSet = new SBGSet([img2]);
        for (const p1 of this.pieces) {
          const overlap = p1.dom.cap(imgSet);
          if (overlap.isEmpty()) continue;
          for (const ovAtom of overlap.atoms) {
            const subDom = p2.map.preImageMDI(atom2, ovAtom);
            if (!subDom.isEmpty()) {
              out.push({
                dom: new SBGSet([subDom]),
                map: p1.map.compose(p2.map),
              });
            }
          }
        }
      }
    }
    return new PWLMap(out);
  }

  /**
   * Pseudo-inverse `minInv(subDom)`: for each atom in `image(subDom)`, maps its image points
   * back to their minimum pre-image elements (`PWLMapImp1::minInv`).
   */
  minInv(subDom?: SBGSet): PWLMap {
    const restricted = subDom ? this.restrictMap(subDom) : this;
    const out: PWLMapPiece[] = [];
    let coveredImg = SBGSet.empty();

    for (const p of restricted.pieces) {
      for (const domAtom of p.dom.atoms) {
        const imgAtom = p.map.imageMDI(domAtom);
        const newImg = new SBGSet([imgAtom]).diff(coveredImg);
        if (newImg.isEmpty()) continue;
        coveredImg = coveredImg.cup(newImg);

        // Check if map is invertible on all coordinates (gain[d] === ±1)
        const isBijective = p.map.gain.every((g) => Math.abs(g) === 1);
        if (isBijective) {
          // Exact inverse: x = g * (y - o) = g*y - g*o since g = ±1
          const invGain = p.map.gain.map((g) => g);
          const invOffset = p.map.gain.map((g, idx) => -g * (p.map.offset[idx] ?? 0));
          out.push({ dom: newImg, map: new LMap(invGain, invOffset) });
        } else {
          const minPt = domAtom.minElem();
          if (minPt) {
            out.push({ dom: newImg, map: LMap.constant(minPt) });
          }
        }
      }
    }
    return new PWLMap(out);
  }

  /** Subset of domain where `this(x) === other(x)` (`PWLMapImp1::equalImage`). */
  equalImage(other: PWLMap): SBGSet {
    const commonDom = this.dom().cap(other.dom());
    if (commonDom.isEmpty()) return SBGSet.empty();
    const outAtoms: MultiInterval[] = [];
    for (const p1 of this.pieces) {
      for (const p2 of other.pieces) {
        const shared = p1.dom.cap(p2.dom);
        if (shared.isEmpty()) continue;
        if (p1.map.equals(p2.map)) {
          outAtoms.push(...shared.atoms);
        } else {
          // Check point-by-point on small atoms or solve g1*x + o1 = g2*x + o2
          for (const atom of shared.atoms) {
            const fixedIntervals: SBGInterval[] = [];
            let empty = false;
            for (let d = 0; d < atom.intervals.length; d++) {
              const g1 = p1.map.gain[d] ?? 1;
              const o1 = p1.map.offset[d] ?? 0;
              const g2 = p2.map.gain[d] ?? 1;
              const o2 = p2.map.offset[d] ?? 0;
              const iv = atom.intervals[d]!;
              if (g1 === g2) {
                if (o1 !== o2) {
                  empty = true;
                  break;
                }
                fixedIntervals.push(iv);
              } else {
                const dg = g1 - g2;
                const doff = o2 - o1;
                if (doff % dg !== 0) {
                  empty = true;
                  break;
                }
                const xSol = Math.trunc(doff / dg);
                if (!iv.isIn(xSol)) {
                  empty = true;
                  break;
                }
                fixedIntervals.push(new SBGInterval(xSol, 1, xSol));
              }
            }
            if (!empty) {
              outAtoms.push(new MultiInterval(fixedIntervals));
            }
          }
        }
      }
    }
    return new SBGSet(outAtoms);
  }

  /**
   * Maps every atom in `this.dom()` to the constant minimum representative of its image
   * under `other` (`PWLMapImp1::offsetDom`).
   */
  offsetDom(other: PWLMap): PWLMap {
    const out: PWLMapPiece[] = [];
    for (const p of this.pieces) {
      for (const atom of p.dom.atoms) {
        const atomSet = new SBGSet([atom]);
        const img = other.image(atomSet);
        const minPt = img.minElem();
        if (minPt) {
          out.push({ dom: atomSet, map: LMap.constant(minPt) });
        }
      }
    }
    return new PWLMap(out);
  }

  /**
   * Computes the transitive closure fixed point $\lim_{k \to \infty} f^k$ (`PWLMapImp1::mapInf`).
   * For step maps $x \mapsto x \pm s$ within a finite domain, projects directly to the terminal
   * boundary element of each atom in $O(1)$ iterations, and iterates composition up to `maxIters`.
   */
  mapInf(maxIters = 32): PWLMap {
    let curr = new PWLMap(
      this.pieces.flatMap((p) => {
        // Accelerate translation pieces (gain === 1, offset !== 0) that stay inside the same atom
        const isTranslation = p.map.gain.every((g) => g === 1) && p.map.offset.some((o) => o !== 0);
        if (!isTranslation) return [p];
        const accelerated: PWLMapPiece[] = [];
        for (const atom of p.dom.atoms) {
          // If 1D translation x -> x - s on [lo, s, hi] where lo-s is mapped to itself or outside
          if (atom.arity() === 1) {
            const iv = atom.intervals[0]!;
            const off = p.map.offset[0] ?? 0;
            if (off < 0 && Math.abs(off) === iv.step) {
              const target = iv.lo + off;
              const finalVal = this.dom().isIn([target]) ? target : iv.lo;
              accelerated.push({
                dom: new SBGSet([atom]),
                map: LMap.constant([finalVal]),
              });
              continue;
            }
          }
          accelerated.push({ dom: new SBGSet([atom]), map: p.map });
        }
        return accelerated;
      }),
    );

    for (let iter = 0; iter < maxIters; iter++) {
      const next = curr.compPW(curr).combine(curr);
      if (next.equalImage(curr).equals(curr.dom())) {
        return next;
      }
      curr = next;
    }
    return curr;
  }

  equals(other: PWLMap): boolean {
    return this.dom().equals(other.dom()) && this.equalImage(other).equals(this.dom());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Set-Based Graph (`SBGraph`), `connectedComponents`, and `sbgMatching`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Undirected or Bipartite Set-Based Graph (`SBGraph` from `SBGraphs_graph_definition.h`).
 *
 * - `V`: Disjoint union of vertex multi-intervals.
 * - `E`: Disjoint union of edge multi-intervals.
 * - `map1`, `map2`: Piecewise affine maps $E \to V$ giving the two endpoints of each edge
 *   (in bipartite graphs, `map1` = `mapU` maps edges to unknowns $U$, and `map2` = `mapF`
 *   maps edges to equations $F$).
 */
export class SBGraph {
  public readonly V: SBGSet;
  public readonly E: SBGSet;
  public readonly map1: PWLMap;
  public readonly map2: PWLMap;

  constructor(V: SBGSet, E: SBGSet, map1: PWLMap, map2: PWLMap) {
    this.V = V;
    this.E = E;
    this.map1 = map1;
    this.map2 = map2;
  }
}

/**
 * Computes the connected components of a Set-Based Graph (`SBGraph`) without unrolling intervals,
 * returning a `PWLMap` that maps every scalar vertex in `G.V` to the minimum representative
 * of its connected component (faithful to `connectedComponents(SBGraph)` in
 * `SBGraphs_graph_algorithms.cpp`).
 */
export function connectedComponents(G: SBGraph): PWLMap {
  if (G.V.isEmpty()) return PWLMap.empty();
  let rmap = PWLMap.identity(G.V);
  if (G.E.isEmpty()) return rmap;

  for (let iter = 0; iter < 32; iter++) {
    const map1Comp = rmap.compPW(G.map1);
    const map2Comp = rmap.compPW(G.map2);

    const ediff1 = G.E.diff(map1Comp.equalImage(map2Comp));
    const rmap1 = map2Comp.compPW(map1Comp.minInv(ediff1)).combine(rmap);

    const map1Comp2 = rmap1.compPW(G.map1);
    const map2Comp2 = rmap1.compPW(G.map2);
    const ediff2 = G.E.diff(map2Comp2.equalImage(map1Comp2));
    const rmap2 = map1Comp2.compPW(map2Comp2.minInv(ediff2)).combine(rmap1);

    // Promote every component mapping so each vertex maps to the minimum element reachable
    const nextPieces: PWLMapPiece[] = [];
    for (const p of rmap2.pieces) {
      for (const atom of p.dom.atoms) {
        const atomSet = new SBGSet([atom]);
        const imgAtom = p.map.imageMDI(atom);
        // If p.map maps x -> x + o with o > 0, invert direction so larger indices map to smaller ones
        const hasPositiveShift = p.map.gain.every((g) => g === 1) && p.map.offset.some((o) => o > 0);
        if (hasPositiveShift) {
          nextPieces.push({ dom: atomSet, map: LMap.identity(atom.arity()) });
        } else {
          nextPieces.push({ dom: atomSet, map: p.map });
        }
        void imgAtom;
      }
    }

    // Symmetrize: ensure that if u -- v via an edge, the higher index maps to the lower index
    const symPieces: PWLMapPiece[] = [];
    for (const eAtom of G.E.atoms) {
      const eSet = new SBGSet([eAtom]);
      const uSet = G.map1.image(eSet);
      const vSet = G.map2.image(eSet);
      const uMin = uSet.minElem();
      const vMin = vSet.minElem();
      if (!uMin || !vMin) continue;
      if (comparePointsLex(uMin, vMin) < 0) {
        // Map v -> u via map1(minInv(map2))
        const vToU = G.map1.restrictMap(eSet).compPW(G.map2.restrictMap(eSet).minInv(eSet));
        symPieces.push(...vToU.pieces);
      } else if (comparePointsLex(vMin, uMin) < 0) {
        const uToV = G.map2.restrictMap(eSet).compPW(G.map1.restrictMap(eSet).minInv(eSet));
        symPieces.push(...uToV.pieces);
      }
    }

    const combined = new PWLMap([...symPieces, ...nextPieces, ...rmap2.pieces]);
    const nextRmap = combined.mapInf();
    if (nextRmap.equals(rmap)) {
      return nextRmap;
    }
    rmap = nextRmap;
  }

  return rmap;
}

/**
 * Set-Based Bipartite Matching (`MatchingStruct::SBGMatching` from `SBGraphs_graph_algorithms.cpp`).
 * Given a bipartite `SBGraph` where `map1 = mapU` (unknowns $U$) and `map2 = mapF` (equations $F$),
 * computes a maximum set-based matching $M \subseteq E$ without unrolling array intervals.
 */
export class SBGMatchingEngine {
  private readonly G: SBGraph;
  private readonly mapU: PWLMap;
  private readonly mapF: PWLMap;

  constructor(G: SBGraph) {
    this.G = G;
    this.mapU = G.map1;
    this.mapF = G.map2;
  }

  /**
   * Computes the set-based maximum matching `M` as an `SBGSet` subset of `G.E`,
   * along with the matched unknown set and matched equation set.
   */
  solve(): {
    matchedEdges: SBGSet;
    matchedUnknowns: SBGSet;
    matchedEquations: SBGSet;
    isFullEquationMatch: boolean;
  } {
    let M = SBGSet.empty();
    const E = this.G.E;
    if (E.isEmpty()) {
      return {
        matchedEdges: M,
        matchedUnknowns: SBGSet.empty(),
        matchedEquations: SBGSet.empty(),
        isFullEquationMatch: true,
      };
    }

    // Greedy initial set-based assignment: assign disjoint image pieces of F and U
    for (const eAtom of E.atoms) {
      const eSet = new SBGSet([eAtom]);
      const matchedU = this.mapU.image(M);
      const matchedF = this.mapF.image(M);
      const freeByU = eSet.diff(this.mapU.preImage(matchedU));
      const freeBoth = freeByU.diff(this.mapF.preImage(matchedF));
      if (!freeBoth.isEmpty()) {
        // Ensure internal injectivity via minInv roundtrip on mapF and mapU
        const fRestrict = this.mapF.restrictMap(freeBoth);
        const uniqueByF = fRestrict.minInv().image();
        const uRestrict = this.mapU.restrictMap(uniqueByF);
        const uniqueBoth = uRestrict.minInv().image();
        M = M.cup(uniqueBoth);
      }
    }

    // Augmenting path loop (`SBGMatching` with `waspf` / `waspu`)
    const allF = this.mapF.image(E);
    for (let iter = 0; iter < 64; iter++) {
      const matchedF = this.mapF.image(M);
      const unmatchedF = allF.diff(matchedF);
      if (unmatchedF.isEmpty()) break;

      let augmented = false;
      for (const fAtom of unmatchedF.atoms) {
        const fStart = new SBGSet([fAtom]);
        const augResult = this.findAugmentingSetPath(M, fStart);
        if (augResult) {
          M = M.diff(augResult.removeEdges).cup(augResult.addEdges);
          augmented = true;
          break;
        }
      }
      if (!augmented) break;
    }

    const finalMatchedU = this.mapU.image(M);
    const finalMatchedF = this.mapF.image(M);
    return {
      matchedEdges: M,
      matchedUnknowns: finalMatchedU,
      matchedEquations: finalMatchedF,
      isFullEquationMatch: allF.diff(finalMatchedF).isEmpty(),
    };
  }

  /**
   * Set-based alternating BFS/DFS (`waspf` / `waspu`) finding a family of vertex-disjoint
   * augmenting paths from `fStart` to unmatched unknowns $U \setminus \text{mapU}(M)$.
   */
  private findAugmentingSetPath(M: SBGSet, fStart: SBGSet): { addEdges: SBGSet; removeEdges: SBGSet } | null {
    const E = this.G.E;
    const unmatchedEdges = E.diff(M);
    const matchedU = this.mapU.image(M);

    // Step 1: Direct unmatched edges from fStart to free U
    const candEdges1 = this.mapF.restrictMap(unmatchedEdges).preImage(fStart);
    const freeCandEdges1 = candEdges1.diff(this.mapU.preImage(matchedU));
    if (!freeCandEdges1.isEmpty()) {
      const injectiveF = this.mapF.restrictMap(freeCandEdges1).minInv().image();
      const injectiveBoth = this.mapU.restrictMap(injectiveF).minInv().image();
      if (!injectiveBoth.isEmpty()) {
        return { addEdges: injectiveBoth, removeEdges: SBGSet.empty() };
      }
    }

    // Step 1.5: O(1) Set-Interval Shift Augmentation (for stencil/shifted edge sets)
    // When an unmatched edge atom `eAtom` covers `fStart` plus `mapF(mSub)` for some `mSub \subseteq M`,
    // and `mapU(eAtom)` uses only `mapU(mSub)` plus free unknowns, swap `mSub` for `eAtom` in O(1)!
    for (const uAtom of unmatchedEdges.atoms) {
      const uEdgeSet = new SBGSet([uAtom]);
      const uF = this.mapF.image(uEdgeSet);
      if (uF.cap(fStart).isEmpty()) continue;
      const displacedF = uF.diff(fStart);
      const mSub = this.mapF.restrictMap(M).preImage(displacedF);
      if (this.mapF.image(mSub).equals(displacedF)) {
        const freedU = this.mapU.image(mSub);
        const stillOccupiedU = matchedU.diff(freedU);
        const targetU = this.mapU.image(uEdgeSet);
        if (targetU.cap(stillOccupiedU).isEmpty() && targetU.size() === uEdgeSet.size()) {
          return { addEdges: uEdgeSet, removeEdges: mSub };
        }
      }
    }

    // Step 2: Multi-hop alternating paths: F_free --(E\M)--> U_matched --(M)--> F_next --(E\M)--> U_free
    let visitedF = fStart;
    let visitedU = SBGSet.empty();
    interface Layer {
      eUnmatched: SBGSet; // edges in E \ M
      eMatched: SBGSet; // edges in M
    }
    const layers: Layer[] = [];
    let frontierF = fStart;

    for (let depth = 0; depth < 128; depth++) {
      const eOut = this.mapF.restrictMap(unmatchedEdges).preImage(frontierF).diff(this.mapU.preImage(visitedU));
      if (eOut.isEmpty()) break;

      // Check if any of eOut reaches an unmatched U
      const eToFreeU = eOut.diff(this.mapU.preImage(matchedU));
      if (!eToFreeU.isEmpty()) {
        // Back-propagate the reached free subset through the alternating layers
        let activeAdd = this.mapU.restrictMap(this.mapF.restrictMap(eToFreeU).minInv().image()).minInv().image();
        let totalAdd = activeAdd;
        let totalRemove = SBGSet.empty();

        for (let l = layers.length - 1; l >= 0; l--) {
          const layer = layers[l]!;
          const neededF = this.mapF.image(activeAdd);
          const mEdges = this.mapF.restrictMap(layer.eMatched).preImage(neededF);
          totalRemove = totalRemove.cup(mEdges);
          const neededU = this.mapU.image(mEdges);
          const prevAdd = this.mapF
            .restrictMap(this.mapU.restrictMap(layer.eUnmatched).preImage(neededU))
            .minInv()
            .image();
          totalAdd = totalAdd.cup(prevAdd);
          activeAdd = prevAdd;
        }
        return { addEdges: totalAdd, removeEdges: totalRemove };
      }

      // Otherwise advance along matched edges M
      const reachedU = this.mapU.image(eOut);
      visitedU = visitedU.cup(reachedU);
      const eMatched = this.mapU.restrictMap(M).preImage(reachedU);
      if (eMatched.isEmpty()) break;
      const nextF = this.mapF.image(eMatched).diff(visitedF);
      if (nextF.isEmpty()) break;
      visitedF = visitedF.cup(nextF);
      layers.push({ eUnmatched: eOut, eMatched });
      frontierF = nextF;
    }

    return null;
  }
}

/**
 * Functional helper for Set-Based Bipartite Matching (`SBGMatching`).
 */
export function sbgMatching(G: SBGraph) {
  return new SBGMatchingEngine(G).solve();
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Multi-Dimensional Intentional Vector Causalization (`VectorCausalizationGraph`,
//    `VectorMatching`, `VectorTarjan`, `splitForArena`, `isolateSymbolicallyForArena`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Affine subscript usage of an array unknown inside a `For` equation or scalar equation
 * (`Usage` & `Offset` in `multidim_vector_graph_definition.h`).
 *
 * For dimension $d$:
 *   - If `isLoopIndexed[d]` is true, subscript is $a_d \cdot i_d + b_d$ where $i_d$ is the loop iterator.
 *   - If `isLoopIndexed[d]` is false, subscript is the constant index $b_d$.
 */
export interface VectorUsage {
  /** Target variable index in `DAEBuilder` (or derivative pseudo-variable index). */
  readonly varIdx: number;
  /** Variable base name (e.g. `"u"` or `"der(u)"`). */
  readonly varName: string;
  /** True if this usage is inside `der(...)`. */
  readonly isDerivative: boolean;
  /** Per-dimension whether the subscript depends on the loop index variable. */
  readonly isLoopIndexed: readonly boolean[];
  /** Per-dimension multiplier $a_d$ on the loop iterator (1 by default when loop-indexed, 0 when constant). */
  readonly coeff: readonly number[];
  /** Per-dimension integer offset $b_d$. */
  readonly offset: readonly number[];
  /** Expression arena ID of the subscript or variable reference node. */
  readonly exprId: number;
}

/**
 * Maps an equation domain `MultiInterval` to the corresponding variable `MultiInterval`
 * under a `VectorUsage`.
 */
export function usageEquationToUnknownMDI(eqMdi: MultiInterval, usage: VectorUsage): MultiInterval {
  if (eqMdi.isEmpty()) return eqMdi;
  const dims = usage.offset.length;
  if (dims === 0) {
    // Scalar variable
    return new MultiInterval([new SBGInterval(1, 1, 1)]);
  }
  const out: SBGInterval[] = [];
  for (let d = 0; d < dims; d++) {
    const c = usage.coeff[d] ?? 0;
    const o = usage.offset[d] ?? 0;
    if (!usage.isLoopIndexed[d] || c === 0) {
      out.push(new SBGInterval(o, 1, o));
    } else {
      const eqIv = eqMdi.intervals[Math.min(d, eqMdi.intervals.length - 1)]!;
      out.push(eqIv.scale(c).offset(o));
    }
  }
  return new MultiInterval(out);
}

/**
 * Inverse map: given a variable sub-interval `unkMdi` and a `VectorUsage` on an equation
 * with domain `eqDomain`, returns the equation `MultiInterval` that accesses `unkMdi`
 * (`Usage::UsedToUse` in `multidim_vector_graph_definition.h`).
 */
export function usageUnknownToEquationMDI(
  unkMdi: MultiInterval,
  eqDomain: MultiInterval,
  usage: VectorUsage,
): MultiInterval {
  if (unkMdi.isEmpty() || eqDomain.isEmpty()) {
    return new MultiInterval(eqDomain.intervals.map(() => SBGInterval.empty()));
  }
  if (usage.offset.length === 0) {
    return eqDomain;
  }
  const out: SBGInterval[] = [...eqDomain.intervals];
  for (let d = 0; d < usage.offset.length; d++) {
    const c = usage.coeff[d] ?? 0;
    const o = usage.offset[d] ?? 0;
    const uIv = unkMdi.intervals[d]!;
    if (!usage.isLoopIndexed[d] || c === 0) {
      if (!uIv.isIn(o)) {
        return new MultiInterval(eqDomain.intervals.map(() => SBGInterval.empty()));
      }
    } else {
      const eqDim = Math.min(d, out.length - 1);
      const eqIv = out[eqDim]!;
      const fwd = eqIv.scale(c).offset(o);
      const inter = fwd.cap(uIv);
      if (inter.isEmpty()) {
        return new MultiInterval(eqDomain.intervals.map(() => SBGInterval.empty()));
      }
      const lo = Math.trunc((inter.lo - o) / c);
      const hi = Math.trunc((inter.hi - o) / c);
      const step = Math.max(1, Math.trunc(inter.step / Math.abs(c)));
      out[eqDim] = new SBGInterval(Math.min(lo, hi), step, Math.max(lo, hi)).cap(eqIv);
    }
  }
  return new MultiInterval(out);
}

/**
 * Equation vertex in the `VectorCausalizationGraph`.
 */
export interface VectorEquationVertex {
  readonly id: number;
  readonly arenaEqIdx: number;
  readonly isForEq: boolean;
  readonly iteratorName: string | null;
  readonly domain: MultiInterval;
  readonly bodyLhsExprId: number;
  readonly bodyRhsExprId: number;
}

/**
 * Unknown (variable or state derivative) vertex in the `VectorCausalizationGraph`.
 */
export interface VectorUnknownVertex {
  readonly id: number;
  readonly arenaVarIdx: number;
  readonly name: string;
  readonly isDerivative: boolean;
  readonly domain: MultiInterval;
}

/**
 * Edge in the `VectorCausalizationGraph` connecting an equation vertex and an unknown vertex
 * with one or more `VectorUsage` descriptors (`Label` / `IndexPairSet`).
 */
export interface VectorCausalizationEdge {
  readonly id: number;
  readonly eqVertexId: number;
  readonly unkVertexId: number;
  readonly usages: VectorUsage[];
  /** Matched equation sub-domains paired with their matched unknown sub-domains and active usage. */
  matchedPairs: { eqMdi: MultiInterval; unkMdi: MultiInterval; usage: VectorUsage }[];
}

/**
 * Causalized vector execution step produced by `VectorTarjan` + `causalizeVectorArena`.
 */
export interface VectorCausalizedBlock {
  /** Equation vertex IDs participating in this causal step. */
  readonly eqVertexIds: number[];
  /** Arena equation indices (`EqId`s) corresponding to this block (after any `splitForArena`). */
  readonly arenaEqIndices: number[];
  /** Unknown vertex IDs solved in this block. */
  readonly unkVertexIds: number[];
  /** Equation domain `MultiInterval` over which this causal step executes. */
  readonly eqMdi: MultiInterval;
  /** Unknown domain `MultiInterval` solved by this causal step. */
  readonly unkMdi: MultiInterval;
  /** Chosen `VectorUsage` for explicit/linear isolation when `eqVertexIds.length === 1`. */
  readonly usage?: VectorUsage | undefined;
  /** Isolated right-hand side `ExprId` when symbolically isolated in-place. */
  readonly isolatedRhsExprId?: number | undefined;
  /** True if this block is an algebraic loop (SCC with >1 equations or self-coupled stencil). */
  readonly isAlgebraicLoop: boolean;
}

/**
 * Extracts integer `[lo, step, hi]` bounds from an `ExprKind.Range` expression in `arena`.
 */
export function extractRangeInterval(arena: DAEBuilder, rangeExprId: number): SBGInterval | null {
  if (rangeExprId < 0 || arena.getExprKind(rangeExprId) !== ExprKind.Range) return null;
  const startId = arena.getExprData1(rangeExprId);
  const stepId = arena.getExprLeft(rangeExprId);
  const stopId = arena.getExprRight(rangeExprId);

  const evalInt = (id: number): number | null => {
    if (id < 0 || id === 0xffffffff) return null;
    const k = arena.getExprKind(id);
    if (k === ExprKind.IntLiteral) return arena.getExprData1(id);
    if (k === ExprKind.RealLiteral) return Math.round(arena.getExprRealValue(id));
    if (k === ExprKind.Negate || (k === ExprKind.Unary && (arena.getExprData1(id) as UnaryOp) === UnaryOp.Negate)) {
      const inner = evalInt(arena.getExprLeft(id));
      return inner !== null ? -inner : null;
    }
    if (k === ExprKind.Name) {
      const nameId = arena.getExprData1(id);
      const vIdx = arena.lookupVariable(nameId);
      if (vIdx >= 0) {
        const v = arena.getVarVariability(vIdx);
        if (v === Variability.Parameter || v === Variability.Constant) {
          const bindId = arena.getVarExpression(vIdx);
          if (typeof bindId === "number" && bindId >= 0) {
            const bVal = evalInt(bindId);
            if (bVal !== null) return bVal;
          }
          return Math.round(arena.getVarStartValue(vIdx));
        }
      }
    }
    if (k === ExprKind.Binary) {
      const op = arena.getExprData1(id) as BinOp;
      const l = evalInt(arena.getExprLeft(id));
      const r = evalInt(arena.getExprRight(id));
      if (l !== null && r !== null) {
        if (op === BinOp.Add) return l + r;
        if (op === BinOp.Sub) return l - r;
        if (op === BinOp.Mul) return l * r;
      }
    }
    return null;
  };

  const lo = evalInt(startId);
  const hi = evalInt(stopId);
  if (lo === null || hi === null) return null;
  let step = 1;
  if (stepId >= 0 && stepId !== 0xffffffff) {
    const s = evalInt(stepId);
    if (s !== null && s !== 0) step = s;
  }
  return new SBGInterval(lo, step, hi);
}

/**
 * Parses an affine index expression $a \cdot i + b$ in terms of `iteratorName` (or constant $b$).
 */
export function parseAffineSubscriptExpr(
  arena: DAEBuilder,
  subExprId: number,
  iteratorName: string | null,
): { isLoopIndexed: boolean; coeff: number; offset: number } | null {
  if (subExprId < 0) return null;
  const kind = arena.getExprKind(subExprId);

  if (kind === ExprKind.IntLiteral) {
    return { isLoopIndexed: false, coeff: 0, offset: arena.getExprData1(subExprId) };
  }
  if (kind === ExprKind.RealLiteral) {
    return { isLoopIndexed: false, coeff: 0, offset: Math.round(arena.getExprRealValue(subExprId)) };
  }
  if (kind === ExprKind.Name) {
    const nameId = arena.getExprData1(subExprId);
    const name = arena.interner.resolve(nameId);
    if (iteratorName && name === iteratorName) {
      return { isLoopIndexed: true, coeff: 1, offset: 0 };
    }
    const vIdx = arena.lookupVariable(nameId);
    if (vIdx >= 0) {
      const v = arena.getVarVariability(vIdx);
      if (v === Variability.Parameter || v === Variability.Constant) {
        return { isLoopIndexed: false, coeff: 0, offset: Math.round(arena.getVarStartValue(vIdx)) };
      }
    }
    return null;
  }
  if (
    kind === ExprKind.Negate ||
    (kind === ExprKind.Unary && (arena.getExprData1(subExprId) as UnaryOp) === UnaryOp.Negate)
  ) {
    const inner = parseAffineSubscriptExpr(arena, arena.getExprLeft(subExprId), iteratorName);
    if (!inner) return null;
    return {
      isLoopIndexed: inner.isLoopIndexed,
      coeff: -inner.coeff,
      offset: -inner.offset,
    };
  }
  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(subExprId) as BinOp;
    const left = parseAffineSubscriptExpr(arena, arena.getExprLeft(subExprId), iteratorName);
    const right = parseAffineSubscriptExpr(arena, arena.getExprRight(subExprId), iteratorName);
    if (!left || !right) return null;
    if (op === BinOp.Add) {
      return {
        isLoopIndexed: left.isLoopIndexed || right.isLoopIndexed,
        coeff: left.coeff + right.coeff,
        offset: left.offset + right.offset,
      };
    }
    if (op === BinOp.Sub) {
      return {
        isLoopIndexed: left.isLoopIndexed || right.isLoopIndexed,
        coeff: left.coeff - right.coeff,
        offset: left.offset - right.offset,
      };
    }
    if (op === BinOp.Mul) {
      if (!left.isLoopIndexed) {
        return {
          isLoopIndexed: right.isLoopIndexed,
          coeff: left.offset * right.coeff,
          offset: left.offset * right.offset,
        };
      }
      if (!right.isLoopIndexed) {
        return {
          isLoopIndexed: left.isLoopIndexed,
          coeff: right.offset * left.coeff,
          offset: right.offset * left.offset,
        };
      }
    }
  }
  return null;
}

/**
 * Extracts all subscripts of an `ExprKind.Subscript` node in `arena`.
 */
export function getSubscriptArgs(arena: DAEBuilder, subExprId: number): { baseExprId: number; subIds: number[] } {
  const baseExprId = arena.getExprData1(subExprId);
  const firstSub = arena.getExprLeft(subExprId);
  const count = arena.getExprRight(subExprId);
  const subIds: number[] = [];
  const n = count > 0 ? count : 1;
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      subIds.push(firstSub);
    } else {
      subIds.push(arena.getExprLeft(subExprId + i));
    }
  }
  return { baseExprId, subIds };
}

/**
 * Multi-Dimensional Vector Causalization Graph (`VectorCausalizationGraph`),
 * implementing `VectorMatching` (`dfs_matching` + `heuristica_inicial`) and
 * `VectorTarjan` (`GetConnectedComponent` + `TestBreak` / `CanCausalize`).
 */
export class VectorCausalizationGraph {
  public readonly arena: DAEBuilder;
  public readonly equations: VectorEquationVertex[] = [];
  public readonly unknowns: VectorUnknownVertex[] = [];
  public readonly edges: VectorCausalizationEdge[] = [];
  private readonly unkByName = new Map<string, VectorUnknownVertex>();
  private readonly edgesByEq = new Map<number, VectorCausalizationEdge[]>();
  private readonly edgesByUnk = new Map<number, VectorCausalizationEdge[]>();

  constructor(arena: DAEBuilder) {
    this.arena = arena;
    this.buildFromArena();
  }

  private buildFromArena(): void {
    const arena = this.arena;

    // 1. Collect all differentiated base variable names so we know which variables are states vs algebraic
    const differentiatedBaseNames = new Set<string>();
    const scanForDer = (exprId: number): void => {
      if (exprId < 0) return;
      const k = arena.getExprKind(exprId);
      if (k === ExprKind.Der) {
        const arg = arena.getExprData1(exprId);
        if (arg >= 0) {
          const ak = arena.getExprKind(arg);
          if (ak === ExprKind.Name) {
            const nm = arena.interner.resolve(arena.getExprData1(arg));
            if (nm) differentiatedBaseNames.add(nm.split("[")[0]!);
          } else if (ak === ExprKind.Subscript) {
            const base = arena.getExprData1(arg);
            if (base >= 0 && arena.getExprKind(base) === ExprKind.Name) {
              const nm = arena.interner.resolve(arena.getExprData1(base));
              if (nm) differentiatedBaseNames.add(nm);
            }
          }
        }
        return;
      }
      if (k === ExprKind.Binary) {
        scanForDer(arena.getExprLeft(exprId));
        scanForDer(arena.getExprRight(exprId));
      } else if (k === ExprKind.Unary || k === ExprKind.Negate) {
        scanForDer(arena.getExprLeft(exprId));
      } else if (k === ExprKind.IfElse) {
        scanForDer(arena.getExprData1(exprId));
        scanForDer(arena.getExprLeft(exprId));
        scanForDer(arena.getExprRight(exprId));
      } else if (k === ExprKind.Call) {
        const argc = arena.getExprRight(exprId);
        for (let i = 0; i < argc; i++) {
          scanForDer(i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i));
        }
      }
    };

    for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
      if (arena.isEqRemoved(eqIdx)) continue;
      const kind = arena.getEqKind(eqIdx);
      if (kind === EqKind.Simple) {
        scanForDer(arena.getEqLhs(eqIdx));
        scanForDer(arena.getEqRhs(eqIdx));
      } else if (kind === EqKind.For) {
        const meta = arena.getForEquationMeta(eqIdx);
        if (meta) {
          for (const b of meta.bodyEquations) {
            scanForDer(b.lhsExprId);
            scanForDer(b.rhsExprId);
          }
        }
      }
    }

    // 2. Register unknown vertices (algebraic variables and state derivatives)
    for (let vIdx = 0; vIdx < arena.varCount; vIdx++) {
      if (arena.isVarRemoved(vIdx)) continue;
      const variability = arena.getVarVariability(vIdx);
      const causality = arena.getVarCausality(vIdx);
      if (
        variability === Variability.Parameter ||
        variability === Variability.Constant ||
        causality === Causality.Input
      ) {
        continue;
      }
      const rawName = arena.getVarName(vIdx);
      if (rawName === "time") continue;

      const shape = arena.getVarShape(vIdx);
      const domain =
        shape.length > 0
          ? new MultiInterval(shape.map((dim) => new SBGInterval(1, 1, Math.max(1, dim))))
          : new MultiInterval([new SBGInterval(1, 1, 1)]);

      if (differentiatedBaseNames.has(rawName)) {
        // State variable: its derivative `der(rawName)` is the unknown in ODE causalization
        const derName = `der(${rawName})`;
        if (!this.unkByName.has(derName)) {
          const uVertex: VectorUnknownVertex = {
            id: this.unknowns.length,
            arenaVarIdx: vIdx,
            name: derName,
            isDerivative: true,
            domain,
          };
          this.unknowns.push(uVertex);
          this.unkByName.set(derName, uVertex);
          this.edgesByUnk.set(uVertex.id, []);
        }
      } else if (!this.unkByName.has(rawName)) {
        const uVertex: VectorUnknownVertex = {
          id: this.unknowns.length,
          arenaVarIdx: vIdx,
          name: rawName,
          isDerivative: rawName.startsWith("der("),
          domain,
        };
        this.unknowns.push(uVertex);
        this.unkByName.set(rawName, uVertex);
        this.edgesByUnk.set(uVertex.id, []);
      }
    }

    // 3. Register equation vertices and extract `VectorUsage` edges
    for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
      if (arena.isEqRemoved(eqIdx)) continue;
      const kind = arena.getEqKind(eqIdx);
      if (kind === EqKind.Simple) {
        const lhs = arena.getEqLhs(eqIdx);
        const rhs = arena.getEqRhs(eqIdx);
        const eqVertex: VectorEquationVertex = {
          id: this.equations.length,
          arenaEqIdx: eqIdx,
          isForEq: false,
          iteratorName: null,
          domain: new MultiInterval([new SBGInterval(1, 1, 1)]),
          bodyLhsExprId: lhs,
          bodyRhsExprId: rhs,
        };
        this.equations.push(eqVertex);
        this.edgesByEq.set(eqVertex.id, []);
        this.extractEquationUsages(eqVertex, lhs, rhs);
      } else if (kind === EqKind.For) {
        const meta = arena.getForEquationMeta(eqIdx);
        if (!meta) continue;
        const rangeIv = extractRangeInterval(arena, meta.rangeExprId);
        if (!rangeIv || rangeIv.isEmpty()) continue;
        const iterName = arena.interner.resolve(meta.indexNameId) ?? "i";
        for (const bodyEq of meta.bodyEquations) {
          if (bodyEq.kind !== EqKind.Simple) continue;
          const eqVertex: VectorEquationVertex = {
            id: this.equations.length,
            arenaEqIdx: eqIdx,
            isForEq: true,
            iteratorName: iterName,
            domain: new MultiInterval([rangeIv]),
            bodyLhsExprId: bodyEq.lhsExprId,
            bodyRhsExprId: bodyEq.rhsExprId,
          };
          this.equations.push(eqVertex);
          this.edgesByEq.set(eqVertex.id, []);
          this.extractEquationUsages(eqVertex, bodyEq.lhsExprId, bodyEq.rhsExprId);
        }
      }
    }
  }

  private extractEquationUsages(eqVertex: VectorEquationVertex, lhsId: number, rhsId: number): void {
    const arena = this.arena;
    const usagesByUnk = new Map<number, VectorUsage[]>();

    const addUsage = (unk: VectorUnknownVertex, usage: VectorUsage) => {
      let list = usagesByUnk.get(unk.id);
      if (!list) {
        list = [];
        usagesByUnk.set(unk.id, list);
      }
      // Deduplicate identical affine offsets on the same unknown
      const duplicate = list.some(
        (u) =>
          u.isLoopIndexed.length === usage.isLoopIndexed.length &&
          u.isLoopIndexed.every((v, idx) => v === usage.isLoopIndexed[idx]) &&
          u.coeff.every((v, idx) => v === usage.coeff[idx]) &&
          u.offset.every((v, idx) => v === usage.offset[idx]),
      );
      if (!duplicate) {
        list.push(usage);
      }
    };

    const visit = (exprId: number, inDer: boolean): void => {
      if (exprId < 0) return;
      const k = arena.getExprKind(exprId);
      if (k === ExprKind.Der) {
        visit(arena.getExprData1(exprId), true);
        return;
      }
      if (k === ExprKind.Subscript) {
        const { baseExprId, subIds } = getSubscriptArgs(arena, exprId);
        if (baseExprId >= 0 && arena.getExprKind(baseExprId) === ExprKind.Name) {
          const baseName = arena.interner.resolve(arena.getExprData1(baseExprId)) ?? "";
          const lookupName = inDer ? `der(${baseName})` : baseName;
          const unk = this.unkByName.get(lookupName);
          if (unk) {
            const isLoopIndexed: boolean[] = [];
            const coeff: number[] = [];
            const offset: number[] = [];
            let valid = true;
            for (const sId of subIds) {
              const parsed = parseAffineSubscriptExpr(arena, sId, eqVertex.iteratorName);
              if (!parsed) {
                valid = false;
                break;
              }
              isLoopIndexed.push(parsed.isLoopIndexed);
              coeff.push(parsed.coeff);
              offset.push(parsed.offset);
            }
            if (valid) {
              addUsage(unk, {
                varIdx: unk.arenaVarIdx,
                varName: unk.name,
                isDerivative: inDer,
                isLoopIndexed,
                coeff,
                offset,
                exprId,
              });
            }
          }
        }
        for (const sId of subIds) visit(sId, false);
        return;
      }
      if (k === ExprKind.Name) {
        const rawName = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
        if (rawName === eqVertex.iteratorName) return;
        // Check if scalarized subscript syntax `u[3]` was interned as a Name
        const bracketIdx = rawName.indexOf("[");
        if (bracketIdx > 0 && rawName.endsWith("]")) {
          const baseName = rawName.slice(0, bracketIdx);
          const idxStr = rawName.slice(bracketIdx + 1, -1);
          const idxVal = Number.parseInt(idxStr, 10);
          const lookupName = inDer ? `der(${baseName})` : baseName;
          const unk = this.unkByName.get(lookupName);
          if (unk && Number.isInteger(idxVal)) {
            addUsage(unk, {
              varIdx: unk.arenaVarIdx,
              varName: unk.name,
              isDerivative: inDer,
              isLoopIndexed: [false],
              coeff: [0],
              offset: [idxVal],
              exprId,
            });
            return;
          }
        }
        const lookupName = inDer ? `der(${rawName})` : rawName;
        const unk = this.unkByName.get(lookupName);
        if (unk) {
          addUsage(unk, {
            varIdx: unk.arenaVarIdx,
            varName: unk.name,
            isDerivative: inDer,
            isLoopIndexed: [],
            coeff: [],
            offset: [],
            exprId,
          });
        }
        return;
      }
      if (k === ExprKind.Binary) {
        visit(arena.getExprLeft(exprId), false);
        visit(arena.getExprRight(exprId), false);
      } else if (k === ExprKind.Unary || k === ExprKind.Negate) {
        visit(arena.getExprLeft(exprId), false);
      } else if (k === ExprKind.IfElse) {
        visit(arena.getExprData1(exprId), false);
        visit(arena.getExprLeft(exprId), false);
        visit(arena.getExprRight(exprId), false);
      } else if (k === ExprKind.Call) {
        const argc = arena.getExprRight(exprId);
        for (let i = 0; i < argc; i++) {
          visit(i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i), false);
        }
      }
    };

    visit(lhsId, false);
    visit(rhsId, false);

    for (const [unkId, usages] of usagesByUnk) {
      const edge: VectorCausalizationEdge = {
        id: this.edges.length,
        eqVertexId: eqVertex.id,
        unkVertexId: unkId,
        usages,
        matchedPairs: [],
      };
      this.edges.push(edge);
      this.edgesByEq.get(eqVertex.id)!.push(edge);
      this.edgesByUnk.get(unkId)!.push(edge);
    }
  }

  /**
   * Executes Multi-Dimensional Vector Matching (`VectorMatching::dfs_matching` + `heuristica_inicial`
   * from `multidim_vector_matching.cpp`).
   *
   * Matches equation `MultiInterval` domains against unknown `MultiInterval` domains,
   * automatically partitioning unknown/equation `MDI`s when boundary equations cover
   * sub-intervals (e.g. `[1:1]` vs `[2:N]`).
   */
  runVectorMatching(): { isFullMatch: boolean; unmatchedEquations: { eqId: number; rem: SBGSet }[] } {
    for (const e of this.edges) {
      e.matchedPairs = [];
    }

    // Track unmatched set per equation vertex and per unknown vertex
    const unmatchedEq = new Map<number, SBGSet>();
    const unmatchedUnk = new Map<number, SBGSet>();
    for (const eq of this.equations) {
      unmatchedEq.set(eq.id, SBGSet.fromMDI(eq.domain));
    }
    for (const unk of this.unknowns) {
      unmatchedUnk.set(unk.id, SBGSet.fromMDI(unk.domain));
    }

    // Phase 1: `heuristica_inicial` — prioritize equations with fewer incident edges (e.g., boundary equations)
    const eqOrder = [...this.equations].sort((a, b) => {
      const degA = this.edgesByEq.get(a.id)?.length ?? 0;
      const degB = this.edgesByEq.get(b.id)?.length ?? 0;
      if (degA !== degB) return degA - degB;
      return a.domain.size() - b.domain.size();
    });

    for (const eq of eqOrder) {
      let remEqSet = unmatchedEq.get(eq.id)!;
      if (remEqSet.isEmpty()) continue;
      const incEdges = this.edgesByEq.get(eq.id) ?? [];
      for (const edge of incEdges) {
        if (remEqSet.isEmpty()) break;
        const unk = this.unknowns[edge.unkVertexId]!;
        let remUnkSet = unmatchedUnk.get(unk.id)!;
        if (remUnkSet.isEmpty()) continue;

        for (const usage of edge.usages) {
          if (remEqSet.isEmpty() || remUnkSet.isEmpty()) break;
          for (const eqAtom of [...remEqSet.atoms]) {
            const neededUnkMdi = usageEquationToUnknownMDI(eqAtom, usage);
            const availUnk = remUnkSet.cap(SBGSet.fromMDI(neededUnkMdi));
            if (availUnk.isEmpty()) continue;
            for (const availAtom of availUnk.atoms) {
              const matchedEqAtom = usageUnknownToEquationMDI(availAtom, eqAtom, usage);
              if (!matchedEqAtom.isEmpty()) {
                const matchedUnkAtom = usageEquationToUnknownMDI(matchedEqAtom, usage);
                edge.matchedPairs.push({
                  eqMdi: matchedEqAtom,
                  unkMdi: matchedUnkAtom,
                  usage,
                });
                remEqSet = remEqSet.diff(SBGSet.fromMDI(matchedEqAtom));
                remUnkSet = remUnkSet.diff(SBGSet.fromMDI(matchedUnkAtom));
                unmatchedEq.set(eq.id, remEqSet);
                unmatchedUnk.set(unk.id, remUnkSet);
              }
            }
          }
        }
      }
    }

    // Phase 2: Augmenting DFS with `MDI` splitting (`VectorMatching::DFS(v, mdi)`)
    const tryAugmentEqMdi = (
      eqId: number,
      eqMdi: MultiInterval,
      visitedUnk: { unkId: number; mdi: MultiInterval }[],
    ): boolean => {
      let remaining: MultiInterval[] = [eqMdi];
      const incEdges = this.edgesByEq.get(eqId) ?? [];

      for (const edge of incEdges) {
        const unkId = edge.unkVertexId;
        for (const usage of edge.usages) {
          const nextRemaining: MultiInterval[] = [];
          for (const reqEqMdi of remaining) {
            const targetUnkMdi = usageEquationToUnknownMDI(reqEqMdi, usage);
            if (targetUnkMdi.isEmpty()) {
              nextRemaining.push(reqEqMdi);
              continue;
            }
            // Subtract any already-visited unknown sub-intervals in the current DFS path
            let candidateUnkSet = SBGSet.fromMDI(targetUnkMdi);
            for (const v of visitedUnk) {
              if (v.unkId === unkId) {
                candidateUnkSet = candidateUnkSet.diff(SBGSet.fromMDI(v.mdi));
              }
            }
            if (candidateUnkSet.isEmpty()) {
              nextRemaining.push(reqEqMdi);
              continue;
            }

            // 2a. First match directly against any free unknown portion
            const freeUnk = unmatchedUnk.get(unkId)!.cap(candidateUnkSet);
            let unsettledEqSet = SBGSet.fromMDI(reqEqMdi);
            for (const freeAtom of freeUnk.atoms) {
              const eqSub = usageUnknownToEquationMDI(freeAtom, reqEqMdi, usage);
              if (!eqSub.isEmpty()) {
                const unkSub = usageEquationToUnknownMDI(eqSub, usage);
                edge.matchedPairs.push({ eqMdi: eqSub, unkMdi: unkSub, usage });
                unmatchedEq.set(eqId, unmatchedEq.get(eqId)!.diff(SBGSet.fromMDI(eqSub)));
                unmatchedUnk.set(unkId, unmatchedUnk.get(unkId)!.diff(SBGSet.fromMDI(unkSub)));
                unsettledEqSet = unsettledEqSet.diff(SBGSet.fromMDI(eqSub));
              }
            }

            // 2b. For still-unsettled portions, try displacing existing matches on `unkId`
            if (!unsettledEqSet.isEmpty()) {
              const otherEdges = this.edgesByUnk.get(unkId) ?? [];
              for (const unsettledEqAtom of [...unsettledEqSet.atoms]) {
                const neededUnk = usageEquationToUnknownMDI(unsettledEqAtom, usage);
                for (const otherEdge of otherEdges) {
                  for (let pIdx = 0; pIdx < otherEdge.matchedPairs.length; pIdx++) {
                    const pair = otherEdge.matchedPairs[pIdx]!;
                    const overlapUnk = neededUnk.cap(pair.unkMdi);
                    if (overlapUnk.isEmpty()) continue;

                    // Avoid cycle on the same unknown interval
                    const alreadyVisited = visitedUnk.some(
                      (v) => v.unkId === unkId && !v.mdi.cap(overlapUnk).isEmpty(),
                    );
                    if (alreadyVisited) continue;

                    const displacedEqMdi = usageUnknownToEquationMDI(overlapUnk, pair.eqMdi, pair.usage);
                    if (displacedEqMdi.isEmpty()) continue;

                    const canReassign = tryAugmentEqMdi(otherEdge.eqVertexId, displacedEqMdi, [
                      ...visitedUnk,
                      { unkId, mdi: overlapUnk },
                    ]);
                    if (canReassign) {
                      // Split `pair` around `displacedEqMdi`
                      const leftoverEqMdis = pair.eqMdi.diff(displacedEqMdi);
                      otherEdge.matchedPairs.splice(pIdx, 1);
                      pIdx--;
                      for (const leftEq of leftoverEqMdis) {
                        otherEdge.matchedPairs.push({
                          eqMdi: leftEq,
                          unkMdi: usageEquationToUnknownMDI(leftEq, pair.usage),
                          usage: pair.usage,
                        });
                      }

                      // Assign `overlapUnk` to `(edge, usage)`
                      const gainedEqMdi = usageUnknownToEquationMDI(overlapUnk, unsettledEqAtom, usage);
                      const gainedUnkMdi = usageEquationToUnknownMDI(gainedEqMdi, usage);
                      edge.matchedPairs.push({
                        eqMdi: gainedEqMdi,
                        unkMdi: gainedUnkMdi,
                        usage,
                      });
                      unmatchedEq.set(eqId, unmatchedEq.get(eqId)!.diff(SBGSet.fromMDI(gainedEqMdi)));
                      unsettledEqSet = unsettledEqSet.diff(SBGSet.fromMDI(gainedEqMdi));
                      break;
                    }
                  }
                }
              }
            }

            nextRemaining.push(...unsettledEqSet.atoms);
          }
          remaining = nextRemaining;
          if (remaining.length === 0) return true;
        }
      }

      return remaining.length === 0;
    };

    for (const eq of this.equations) {
      const rem = unmatchedEq.get(eq.id)!;
      if (rem.isEmpty()) continue;
      for (const atom of [...rem.atoms]) {
        tryAugmentEqMdi(eq.id, atom, []);
      }
    }

    const unmatchedList: { eqId: number; rem: SBGSet }[] = [];
    for (const eq of this.equations) {
      const rem = unmatchedEq.get(eq.id)!;
      if (!rem.isEmpty()) {
        unmatchedList.push({ eqId: eq.id, rem });
      }
    }

    return {
      isFullMatch: unmatchedList.length === 0,
      unmatchedEquations: unmatchedList,
    };
  }

  /**
   * Computes the topological / BLT causalization order over the matched `VectorCausalizationGraph`
   * using Set-Based / Vector Tarjan SCC (`VectorTarjan::GetConnectedComponent` and
   * `CausalizationStrategyVector::CanCausalize` / `TestBreak`).
   */
  runVectorTarjan(): VectorCausalizedBlock[] {
    // Flatten matched `(eqVertexId, eqMdi, unkVertexId, unkMdi, usage)` slices into fine-grained
    // vector nodes; if a `For` equation has a recurrence stencil (e.g. `u[i]` depends on `u[i-1]`),
    // `VectorTarjan` preserves the `For` loop when the recurrence is causal (forward `i-1` or backward `i+1`).
    interface MatchedSlice {
      id: number;
      eqVertexId: number;
      unkVertexId: number;
      eqMdi: MultiInterval;
      unkMdi: MultiInterval;
      usage: VectorUsage;
    }

    const slices: MatchedSlice[] = [];
    for (const edge of this.edges) {
      for (const pair of edge.matchedPairs) {
        slices.push({
          id: slices.length,
          eqVertexId: edge.eqVertexId,
          unkVertexId: edge.unkVertexId,
          eqMdi: pair.eqMdi,
          unkMdi: pair.unkMdi,
          usage: pair.usage,
        });
      }
    }

    // Build dependency graph between slices: slice A depends on slice B if equation of A
    // uses an unknown slice solved by B (excluding A's own matched unknown at the same index).
    const deps = new Map<number, Set<number>>();
    for (const s of slices) deps.set(s.id, new Set());

    for (const sA of slices) {
      const incEdges = this.edgesByEq.get(sA.eqVertexId) ?? [];
      for (const e of incEdges) {
        for (const u of e.usages) {
          const accessedUnkMdi = usageEquationToUnknownMDI(sA.eqMdi, u);
          for (const sB of slices) {
            if (sB.unkVertexId !== e.unkVertexId) continue;
            const overlap = accessedUnkMdi.cap(sB.unkMdi);
            if (overlap.isEmpty()) continue;
            if (sA.id === sB.id) {
              // Self-dependency across loop iterations (e.g. stencil `x[i] = f(x[i-1])`)
              // is causal in forward or backward loop sweep, not a simultaneous algebraic loop
              continue;
            }
            deps.get(sA.id)!.add(sB.id);
          }
        }
      }
    }

    // Run Tarjan's SCC algorithm on the slice dependency graph
    let index = 0;
    const indices = new Map<number, number>();
    const lowlink = new Map<number, number>();
    const onStack = new Set<number>();
    const stack: number[] = [];
    const sccs: MatchedSlice[][] = [];

    const strongconnect = (v: number): void => {
      indices.set(v, index);
      lowlink.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      for (const w of deps.get(v) ?? []) {
        if (!indices.has(w)) {
          strongconnect(w);
          lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
        }
      }

      if (lowlink.get(v) === indices.get(v)) {
        const comp: MatchedSlice[] = [];
        while (stack.length > 0) {
          const w = stack.pop()!;
          onStack.delete(w);
          comp.push(slices[w]!);
          if (w === v) break;
        }
        sccs.push(comp);
      }
    };

    for (const s of slices) {
      if (!indices.has(s.id)) {
        strongconnect(s.id);
      }
    }

    return sccs.map((comp) => {
      if (comp.length === 1) {
        const s = comp[0]!;
        const eqV = this.equations[s.eqVertexId]!;
        return {
          eqVertexIds: [s.eqVertexId],
          arenaEqIndices: [eqV.arenaEqIdx],
          unkVertexIds: [s.unkVertexId],
          eqMdi: s.eqMdi,
          unkMdi: s.unkMdi,
          usage: s.usage,
          isAlgebraicLoop: false,
        };
      }
      const eqVertexIds = Array.from(new Set(comp.map((s) => s.eqVertexId)));
      const arenaEqIndices = Array.from(new Set(comp.map((s) => this.equations[s.eqVertexId]!.arenaEqIdx)));
      const unkVertexIds = Array.from(new Set(comp.map((s) => s.unkVertexId)));
      return {
        eqVertexIds,
        arenaEqIndices,
        unkVertexIds,
        eqMdi: comp[0]!.eqMdi,
        unkMdi: comp[0]!.unkMdi,
        isAlgebraicLoop: true,
      };
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Loop Splitting (`splitForArena`) & Symbolic Isolation in `ForEq`
//    (`isolateSymbolicallyForArena` & `causalizeVectorArena`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deep-clones an expression subtree in `arena`, optionally substituting a target expression node
 * or shifting loop iterator references.
 */
export function cloneArenaExpression(arena: DAEBuilder, exprId: number, replacements?: Map<number, number>): number {
  if (exprId < 0) return exprId;
  if (replacements?.has(exprId)) return replacements.get(exprId)!;

  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.IntLiteral:
      return arena.addIntLiteral(arena.getExprData1(exprId));
    case ExprKind.RealLiteral:
      return arena.addRealLiteral(arena.getExprRealValue(exprId));
    case ExprKind.BoolLiteral:
      return arena.addBoolLiteral(arena.getExprData1(exprId) !== 0);
    case ExprKind.StringLiteral:
      return arena.addStringLiteral(arena.getExprData1(exprId));
    case ExprKind.Name:
      return arena.addName(arena.getExprData1(exprId));
    case ExprKind.Der:
      return arena.addDerExpr(cloneArenaExpression(arena, arena.getExprData1(exprId), replacements));
    case ExprKind.Pre:
      return arena.addPreExpr(cloneArenaExpression(arena, arena.getExprData1(exprId), replacements));
    case ExprKind.Negate:
      return arena.addNegateExpr(cloneArenaExpression(arena, arena.getExprLeft(exprId), replacements));
    case ExprKind.Unary:
      return arena.addUnaryExpr(
        arena.getExprData1(exprId) as UnaryOp,
        cloneArenaExpression(arena, arena.getExprLeft(exprId), replacements),
      );
    case ExprKind.Binary:
      return arena.addBinaryExpr(
        arena.getExprData1(exprId) as BinOp,
        cloneArenaExpression(arena, arena.getExprLeft(exprId), replacements),
        cloneArenaExpression(arena, arena.getExprRight(exprId), replacements),
      );
    case ExprKind.IfElse:
      return arena.addIfElse(
        cloneArenaExpression(arena, arena.getExprData1(exprId), replacements),
        cloneArenaExpression(arena, arena.getExprLeft(exprId), replacements),
        cloneArenaExpression(arena, arena.getExprRight(exprId), replacements),
      );
    case ExprKind.Subscript: {
      const { baseExprId, subIds } = getSubscriptArgs(arena, exprId);
      const newBase = cloneArenaExpression(arena, baseExprId, replacements);
      const newSubs = subIds.map((s) => cloneArenaExpression(arena, s, replacements));
      return arena.addSubscriptExpr(newBase, newSubs);
    }
    case ExprKind.Call: {
      const fnNameId = arena.getExprData1(exprId);
      const argc = arena.getExprRight(exprId);
      const args: number[] = [];
      for (let i = 0; i < argc; i++) {
        const argId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        args.push(cloneArenaExpression(arena, argId, replacements));
      }
      return arena.addCallExpr(fnNameId, args);
    }
    case ExprKind.Range: {
      const startId = cloneArenaExpression(arena, arena.getExprData1(exprId), replacements);
      const stepRaw = arena.getExprLeft(exprId);
      const stepId = stepRaw >= 0 && stepRaw !== 0xffffffff ? cloneArenaExpression(arena, stepRaw, replacements) : -1;
      const stopId = cloneArenaExpression(arena, arena.getExprRight(exprId), replacements);
      return arena.addRange(startId, stopId, stepId);
    }
    default:
      return exprId;
  }
}

/**
 * Splits an existing `EqKind.For` equation in `arena` across multiple disjoint `SBGInterval`
 * sub-ranges (`CausalizationStrategyVector::SplitIrregularLoops` / `TestBreak` in `modelicacc`).
 *
 * When a sub-range has `size() === 1` (`lo === hi`), it can either remain a 1-iteration `For`
 * or be specialized by substituting `iterator = lo` directly. By default, preserves `EqKind.For`
 * with updated range expressions `[sub.lo : sub.step : sub.hi]`.
 *
 * @returns Array of new `EqKind.For` equation indices in `arena` corresponding to `subRanges`.
 */
export function splitForArena(arena: DAEBuilder, forEqIdx: number, subRanges: readonly SBGInterval[]): number[] {
  const meta = arena.getForEquationMeta(forEqIdx);
  if (!meta) return [forEqIdx];
  const validRanges = subRanges.filter((r) => !r.isEmpty());
  if (validRanges.length <= 1) return [forEqIdx];

  const newEqIndices: number[] = [];
  for (let rIdx = 0; rIdx < validRanges.length; rIdx++) {
    const sub = validRanges[rIdx]!;
    const startExpr = arena.addIntLiteral(sub.lo);
    const stopExpr = arena.addIntLiteral(sub.hi);
    const stepExpr = sub.step === 1 ? -1 : arena.addIntLiteral(sub.step);
    const rangeExprId = arena.addRange(startExpr, stopExpr, stepExpr);

    if (rIdx === 0) {
      // Update the original `For` equation in-place for the first sub-range
      arena.setEqRhs(forEqIdx, rangeExprId);
      meta.rangeExprId = rangeExprId;
      newEqIndices.push(forEqIdx);
    } else {
      const clonedForIdx = arena.addForEquation(meta.indexNameId, rangeExprId);
      for (const bodyEq of meta.bodyEquations) {
        const clonedLhs = cloneArenaExpression(arena, bodyEq.lhsExprId);
        const clonedRhs = cloneArenaExpression(arena, bodyEq.rhsExprId);
        arena.addForBodyEquation(clonedForIdx, bodyEq.kind, clonedLhs, clonedRhs);
      }
      newEqIndices.push(clonedForIdx);
    }
  }
  return newEqIndices;
}

/**
 * Checks if `exprId` matches the target `VectorUsage` (e.g. `u[a*i + b]` or `der(u[a*i + b])`).
 */
export function matchesVectorUsage(
  arena: DAEBuilder,
  exprId: number,
  usage: VectorUsage,
  iteratorName: string | null,
): boolean {
  if (exprId < 0) return false;
  const kind = arena.getExprKind(exprId);
  if (usage.isDerivative) {
    if (kind !== ExprKind.Der) return false;
    const inner = arena.getExprData1(exprId);
    return matchesVectorUsage(
      arena,
      inner,
      { ...usage, isDerivative: false, varName: usage.varName.replace(/^der\((.*)\)$/, "$1") },
      iteratorName,
    );
  }
  if (usage.offset.length === 0) {
    if (kind !== ExprKind.Name) return false;
    const nm = arena.interner.resolve(arena.getExprData1(exprId));
    return nm === usage.varName;
  }
  if (kind === ExprKind.Subscript) {
    const { baseExprId, subIds } = getSubscriptArgs(arena, exprId);
    if (baseExprId < 0 || arena.getExprKind(baseExprId) !== ExprKind.Name) return false;
    const baseName = arena.interner.resolve(arena.getExprData1(baseExprId));
    const expectedBase = usage.varName.replace(/^der\((.*)\)$/, "$1");
    if (baseName !== expectedBase) return false;
    if (subIds.length !== usage.offset.length) return false;
    for (let d = 0; d < subIds.length; d++) {
      const parsed = parseAffineSubscriptExpr(arena, subIds[d]!, iteratorName);
      if (!parsed) return false;
      if (
        parsed.isLoopIndexed !== usage.isLoopIndexed[d] ||
        parsed.coeff !== usage.coeff[d] ||
        parsed.offset !== usage.offset[d]
      ) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function containsVectorUsage(
  arena: DAEBuilder,
  exprId: number,
  usage: VectorUsage,
  iteratorName: string | null,
): boolean {
  if (exprId < 0) return false;
  if (matchesVectorUsage(arena, exprId, usage, iteratorName)) return true;
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Binary:
      return (
        containsVectorUsage(arena, arena.getExprLeft(exprId), usage, iteratorName) ||
        containsVectorUsage(arena, arena.getExprRight(exprId), usage, iteratorName)
      );
    case ExprKind.Unary:
    case ExprKind.Negate:
      return containsVectorUsage(arena, arena.getExprLeft(exprId), usage, iteratorName);
    case ExprKind.Der:
    case ExprKind.Pre:
      return containsVectorUsage(arena, arena.getExprData1(exprId), usage, iteratorName);
    case ExprKind.IfElse:
      return (
        containsVectorUsage(arena, arena.getExprData1(exprId), usage, iteratorName) ||
        containsVectorUsage(arena, arena.getExprLeft(exprId), usage, iteratorName) ||
        containsVectorUsage(arena, arena.getExprRight(exprId), usage, iteratorName)
      );
    case ExprKind.Subscript: {
      const { subIds } = getSubscriptArgs(arena, exprId);
      return subIds.some((s) => containsVectorUsage(arena, s, usage, iteratorName));
    }
    case ExprKind.Call: {
      const argc = arena.getExprRight(exprId);
      for (let i = 0; i < argc; i++) {
        const arg = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        if (containsVectorUsage(arena, arg, usage, iteratorName)) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

function extractLinearCoeffsForUsage(
  arena: DAEBuilder,
  exprId: number,
  usage: VectorUsage,
  iteratorName: string | null,
): { aId: number; bId: number } | null {
  if (exprId < 0) return null;
  if (!containsVectorUsage(arena, exprId, usage, iteratorName)) {
    return { aId: arena.addRealLiteral(0), bId: exprId };
  }
  if (matchesVectorUsage(arena, exprId, usage, iteratorName)) {
    return { aId: arena.addRealLiteral(1), bId: arena.addRealLiteral(0) };
  }

  const kind = arena.getExprKind(exprId);
  if (
    kind === ExprKind.Negate ||
    (kind === ExprKind.Unary && (arena.getExprData1(exprId) as UnaryOp) === UnaryOp.Negate)
  ) {
    const inner = extractLinearCoeffsForUsage(arena, arena.getExprLeft(exprId), usage, iteratorName);
    if (!inner) return null;
    return {
      aId: isZeroExpr(arena, inner.aId) ? inner.aId : arena.addNegateExpr(inner.aId),
      bId: isZeroExpr(arena, inner.bId) ? inner.bId : arena.addNegateExpr(inner.bId),
    };
  }

  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId) as BinOp;
    const left = arena.getExprLeft(exprId);
    const right = arena.getExprRight(exprId);
    const lCoeff = extractLinearCoeffsForUsage(arena, left, usage, iteratorName);
    const rCoeff = extractLinearCoeffsForUsage(arena, right, usage, iteratorName);
    if (!lCoeff || !rCoeff) return null;

    if (op === BinOp.Add || op === BinOp.ElemAdd) {
      const aId = isZeroExpr(arena, lCoeff.aId)
        ? rCoeff.aId
        : isZeroExpr(arena, rCoeff.aId)
          ? lCoeff.aId
          : arena.addBinaryExpr(BinOp.Add, lCoeff.aId, rCoeff.aId);
      const bId = isZeroExpr(arena, lCoeff.bId)
        ? rCoeff.bId
        : isZeroExpr(arena, rCoeff.bId)
          ? lCoeff.bId
          : arena.addBinaryExpr(BinOp.Add, lCoeff.bId, rCoeff.bId);
      return { aId, bId };
    }
    if (op === BinOp.Sub || op === BinOp.ElemSub) {
      const aId = isZeroExpr(arena, rCoeff.aId)
        ? lCoeff.aId
        : isZeroExpr(arena, lCoeff.aId)
          ? arena.addNegateExpr(rCoeff.aId)
          : arena.addBinaryExpr(BinOp.Sub, lCoeff.aId, rCoeff.aId);
      const bId = isZeroExpr(arena, rCoeff.bId)
        ? lCoeff.bId
        : isZeroExpr(arena, lCoeff.bId)
          ? arena.addNegateExpr(rCoeff.bId)
          : arena.addBinaryExpr(BinOp.Sub, lCoeff.bId, rCoeff.bId);
      return { aId, bId };
    }
    if (op === BinOp.Mul || op === BinOp.ElemMul) {
      if (isZeroExpr(arena, lCoeff.aId)) {
        return {
          aId: isZeroExpr(arena, rCoeff.aId) ? rCoeff.aId : arena.addBinaryExpr(BinOp.Mul, lCoeff.bId, rCoeff.aId),
          bId: isZeroExpr(arena, rCoeff.bId) ? rCoeff.bId : arena.addBinaryExpr(BinOp.Mul, lCoeff.bId, rCoeff.bId),
        };
      }
      if (isZeroExpr(arena, rCoeff.aId)) {
        return {
          aId: arena.addBinaryExpr(BinOp.Mul, lCoeff.aId, rCoeff.bId),
          bId: isZeroExpr(arena, lCoeff.bId) ? lCoeff.bId : arena.addBinaryExpr(BinOp.Mul, lCoeff.bId, rCoeff.bId),
        };
      }
      return null; // Nonlinear product
    }
    if (op === BinOp.Div || op === BinOp.ElemDiv) {
      if (isZeroExpr(arena, rCoeff.aId)) {
        return {
          aId: isZeroExpr(arena, lCoeff.aId) ? lCoeff.aId : arena.addBinaryExpr(BinOp.Div, lCoeff.aId, rCoeff.bId),
          bId: isZeroExpr(arena, lCoeff.bId) ? lCoeff.bId : arena.addBinaryExpr(BinOp.Div, lCoeff.bId, rCoeff.bId),
        };
      }
      return null;
    }
  }

  return null;
}

/**
 * Constructs an arena expression for `usage` (e.g. `u[a*i + b]` or `der(u[a*i + b])`).
 */
export function buildVectorUsageExpr(arena: DAEBuilder, usage: VectorUsage, iteratorName: string | null): number {
  const baseName = usage.varName.replace(/^der\((.*)\)$/, "$1");
  const baseExpr = arena.addNameExpr(baseName);
  let targetExpr = baseExpr;

  if (usage.offset.length > 0) {
    const subExprs: number[] = [];
    for (let d = 0; d < usage.offset.length; d++) {
      const c = usage.coeff[d] ?? 0;
      const o = usage.offset[d] ?? 0;
      if (!usage.isLoopIndexed[d] || c === 0 || !iteratorName) {
        subExprs.push(arena.addIntLiteral(o));
      } else {
        const iterExpr = arena.addNameExpr(iteratorName);
        const scaled = c === 1 ? iterExpr : arena.addBinaryExpr(BinOp.Mul, arena.addIntLiteral(c), iterExpr);
        if (o === 0) {
          subExprs.push(scaled);
        } else if (o > 0) {
          subExprs.push(arena.addBinaryExpr(BinOp.Add, scaled, arena.addIntLiteral(o)));
        } else {
          subExprs.push(arena.addBinaryExpr(BinOp.Sub, scaled, arena.addIntLiteral(-o)));
        }
      }
    }
    targetExpr = arena.addSubscriptExpr(baseExpr, subExprs);
  }

  if (usage.isDerivative) {
    return arena.addDerExpr(targetExpr);
  }
  return targetExpr;
}

/**
 * Symbolically isolates `usage` (e.g. `u[i + offset]` or `der(u[i + offset])`) inside an
 * `EqKind.For` or `EqKind.Simple` equation in `arena` without unrolling the loop!
 * Rewrites the equation in-place to `targetUsageExpr = isolatedRhsExpr` and returns `isolatedRhsExpr`
 * (or `-1` if symbolic isolation fails).
 */
export function isolateSymbolicallyForArena(arena: DAEBuilder, eqIdx: number, usage: VectorUsage, bodyIdx = 0): number {
  const kind = arena.getEqKind(eqIdx);
  let lhs = -1;
  let rhs = -1;
  let iteratorName: string | null = null;
  let meta: ForEquationMeta | undefined;

  if (kind === EqKind.For) {
    meta = arena.getForEquationMeta(eqIdx);
    if (!meta || bodyIdx >= meta.bodyEquations.length) return -1;
    lhs = meta.bodyEquations[bodyIdx]!.lhsExprId;
    rhs = meta.bodyEquations[bodyIdx]!.rhsExprId;
    iteratorName = arena.interner.resolve(meta.indexNameId) ?? null;
  } else if (kind === EqKind.Simple) {
    lhs = arena.getEqLhs(eqIdx);
    rhs = arena.getEqRhs(eqIdx);
  } else {
    return -1;
  }

  let isolatedRhs = -1;
  if (matchesVectorUsage(arena, lhs, usage, iteratorName) && !containsVectorUsage(arena, rhs, usage, iteratorName)) {
    isolatedRhs = rhs;
  } else if (
    matchesVectorUsage(arena, rhs, usage, iteratorName) &&
    !containsVectorUsage(arena, lhs, usage, iteratorName)
  ) {
    isolatedRhs = lhs;
  } else {
    // Linear symbolic isolation: A * usage + B = 0 => usage = -B / A
    const residual = arena.addBinaryExpr(BinOp.Sub, lhs, rhs);
    const coeffs = extractLinearCoeffsForUsage(arena, residual, usage, iteratorName);
    if (coeffs && !isZeroExpr(arena, coeffs.aId)) {
      const negB = isZeroExpr(arena, coeffs.bId) ? arena.addRealLiteral(0) : arena.addNegateExpr(coeffs.bId);
      const isUnitA =
        (arena.getExprKind(coeffs.aId) === ExprKind.RealLiteral && arena.getExprRealValue(coeffs.aId) === 1) ||
        (arena.getExprKind(coeffs.aId) === ExprKind.IntLiteral && arena.getExprData1(coeffs.aId) === 1);
      const isNegUnitA =
        (arena.getExprKind(coeffs.aId) === ExprKind.RealLiteral && arena.getExprRealValue(coeffs.aId) === -1) ||
        (arena.getExprKind(coeffs.aId) === ExprKind.IntLiteral && arena.getExprData1(coeffs.aId) === -1);
      if (isUnitA) {
        isolatedRhs = negB;
      } else if (isNegUnitA) {
        isolatedRhs = coeffs.bId;
      } else {
        isolatedRhs = arena.addBinaryExpr(BinOp.Div, negB, coeffs.aId);
      }
    }
  }

  if (isolatedRhs === -1) return -1;

  const targetLhs = buildVectorUsageExpr(arena, usage, iteratorName);
  if (kind === EqKind.For && meta) {
    meta.bodyEquations[bodyIdx]!.lhsExprId = targetLhs;
    meta.bodyEquations[bodyIdx]!.rhsExprId = isolatedRhs;
    if (meta.equations[bodyIdx]) {
      meta.equations[bodyIdx]!.lhs = targetLhs;
      meta.equations[bodyIdx]!.rhs = isolatedRhs;
    }
  } else if (kind === EqKind.Simple) {
    arena.setEqLhs(eqIdx, targetLhs);
    arena.setEqRhs(eqIdx, isolatedRhs);
  }
  return isolatedRhs;
}

/**
 * High-level entry point for Multi-Dimensional Intentional Vector Causalization on `DAEBuilder`
 * (`CausalizationStrategyVector::Causalize` in `CIFASIS/modelicacc`).
 *
 * 1. Builds the `VectorCausalizationGraph` directly from `arena`.
 * 2. Runs `VectorMatching` (with automatic `MDI` splitting when boundary equations cover sub-ranges).
 * 3. Splits `EqKind.For` loops via `splitForArena` whenever a single `For` equation is matched across
 *    multiple disjoint `MDI` sub-ranges with different causal usages.
 * 4. Runs `VectorTarjan` to order the vector blocks topologically.
 * 5. Isolates the matched array unknown in each causal `For` / scalar equation via `isolateSymbolicallyForArena`.
 */
export function causalizeVectorArena(arena: DAEBuilder): {
  graph: VectorCausalizationGraph;
  isFullMatch: boolean;
  blocks: VectorCausalizedBlock[];
} {
  const graph = new VectorCausalizationGraph(arena);
  const matchRes = graph.runVectorMatching();

  // Check if any `For` equation was matched across multiple disjoint `MDI` sub-intervals
  // with different usages, and split it in the arena if needed
  for (const eqV of graph.equations) {
    if (!eqV.isForEq) continue;
    const incEdges = graph.edges.filter((e) => e.eqVertexId === eqV.id && e.matchedPairs.length > 0);
    const subIntervals: SBGInterval[] = [];
    for (const edge of incEdges) {
      for (const pair of edge.matchedPairs) {
        if (pair.eqMdi.intervals[0]) {
          subIntervals.push(pair.eqMdi.intervals[0]);
        }
      }
    }
    if (subIntervals.length > 1) {
      splitForArena(arena, eqV.arenaEqIdx, subIntervals);
    }
  }

  const rawBlocks = graph.runVectorTarjan();
  const blocks: VectorCausalizedBlock[] = rawBlocks.map((b) => {
    if (!b.isAlgebraicLoop && b.usage && b.arenaEqIndices.length === 1) {
      const isolatedRhs = isolateSymbolicallyForArena(arena, b.arenaEqIndices[0]!, b.usage);
      if (isolatedRhs !== -1) {
        return { ...b, isolatedRhsExprId: isolatedRhs };
      }
    }
    return b;
  });

  return {
    graph,
    isFullMatch: matchRes.isFullMatch,
    blocks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Pillar 2A: Array-Preserving Loop Alias Elimination (`eliminateVectorArenaAliases`)
// ─────────────────────────────────────────────────────────────────────────────

export interface VectorAliasEntry {
  /** Eliminated array variable name. */
  readonly eliminatedVar: string;
  /** Target canonical array variable name (or `null` when aliased to a constant/parameter). */
  readonly targetVar: string | null;
  /** Index shift `targetIdx = eliminatedIdx + indexShift`. */
  readonly indexShift: number;
  /** Multiplier (`+1` or `-1` for negated aliases). */
  readonly sign: 1 | -1;
  /** Constant/parameter `ExprId` when `targetVar === null`. */
  readonly constantExprId?: number | undefined;
}

/**
 * Eliminates whole-array and `ForEq` loop aliases (`for i in 1:N loop a[i + o1] = ±b[i + o2]`
 * and `for i in 1:N loop a[i] = K`) directly on `DAEBuilder` without unrolling loops
 * (faithful to and generalizing `RemoveAlias::removeAliasEquations` in `CIFASIS/modelicacc`).
 */
export function eliminateVectorArenaAliases(arena: DAEBuilder): VectorAliasEntry[] {
  const aliases = new Map<string, VectorAliasEntry>();
  const aliasForEqIndices: number[] = [];

  for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
    if (arena.isEqRemoved(eqIdx)) continue;
    if (arena.getEqKind(eqIdx) !== EqKind.For) continue;
    const meta = arena.getForEquationMeta(eqIdx);
    if (!meta || meta.bodyEquations.length !== 1) continue;
    const bodyEq = meta.bodyEquations[0]!;
    if (bodyEq.kind !== EqKind.Simple) continue;

    const rangeIv = extractRangeInterval(arena, meta.rangeExprId);
    if (!rangeIv || rangeIv.isEmpty() || rangeIv.step !== 1) continue;
    const iterName = arena.interner.resolve(meta.indexNameId) ?? "i";

    const parseSide = (
      exprId: number,
    ):
      | {
          kind: "subscript";
          varIdx: number;
          varName: string;
          offset: number;
          sign: 1 | -1;
        }
      | {
          kind: "const";
          exprId: number;
        }
      | null => {
      if (exprId < 0) return null;
      let sign: 1 | -1 = 1;
      let curr = exprId;
      while (
        arena.getExprKind(curr) === ExprKind.Negate ||
        (arena.getExprKind(curr) === ExprKind.Unary && (arena.getExprData1(curr) as UnaryOp) === UnaryOp.Negate)
      ) {
        sign = (sign * -1) as 1 | -1;
        curr = arena.getExprLeft(curr);
      }

      const k = arena.getExprKind(curr);
      if (k === ExprKind.Subscript) {
        const { baseExprId, subIds } = getSubscriptArgs(arena, curr);
        if (subIds.length !== 1 || baseExprId < 0 || arena.getExprKind(baseExprId) !== ExprKind.Name) return null;
        const varName = arena.interner.resolve(arena.getExprData1(baseExprId)) ?? "";
        const varIdx = arena.getVarIdxByName(varName);
        if (varIdx < 0 || arena.isVarRemoved(varIdx)) return null;
        const aff = parseAffineSubscriptExpr(arena, subIds[0]!, iterName);
        if (!aff || !aff.isLoopIndexed || aff.coeff !== 1) return null;
        return { kind: "subscript", varIdx, varName, offset: aff.offset, sign };
      }
      if (k === ExprKind.IntLiteral || k === ExprKind.RealLiteral || k === ExprKind.BoolLiteral) {
        return { kind: "const", exprId };
      }
      if (k === ExprKind.Name) {
        const nameId = arena.getExprData1(curr);
        const vIdx = arena.lookupVariable(nameId);
        if (vIdx >= 0) {
          const v = arena.getVarVariability(vIdx);
          if (v === Variability.Parameter || v === Variability.Constant) {
            return { kind: "const", exprId };
          }
        }
      }
      return null;
    };

    const lhsSide = parseSide(bodyEq.lhsExprId);
    const rhsSide = parseSide(bodyEq.rhsExprId);
    if (!lhsSide || !rhsSide) continue;

    if (lhsSide.kind === "subscript" && rhsSide.kind === "subscript") {
      if (lhsSide.varName === rhsSide.varName) continue;
      const shape1 = arena.getVarShape(lhsSide.varIdx);
      const shape2 = arena.getVarShape(rhsSide.varIdx);
      if (shape1.length !== 1 || shape2.length !== 1) continue;

      // Verify the loop covers the entire array dimension of the eliminated variable
      const covered1 = rangeIv.offset(lhsSide.offset);
      const covered2 = rangeIv.offset(rhsSide.offset);
      const full1 = covered1.lo === 1 && covered1.hi === shape1[0];
      const full2 = covered2.lo === 1 && covered2.hi === shape2[0];
      if (!full1 && !full2) continue;

      const relSign = (lhsSide.sign * rhsSide.sign) as 1 | -1;
      // Prefer keeping the state/shorter-named variable and eliminating the connector/longer-named one
      const chooseElim1 = full1 && (!full2 || lhsSide.varName.length >= rhsSide.varName.length);
      const elimSide = chooseElim1 ? lhsSide : rhsSide;
      const keepSide = chooseElim1 ? rhsSide : lhsSide;
      if (aliases.has(elimSide.varName) || aliases.has(keepSide.varName)) continue;

      aliases.set(elimSide.varName, {
        eliminatedVar: elimSide.varName,
        targetVar: keepSide.varName,
        indexShift: keepSide.offset - elimSide.offset,
        sign: relSign,
      });
      aliasForEqIndices.push(eqIdx);
    } else if (lhsSide.kind === "subscript" && rhsSide.kind === "const") {
      const shape1 = arena.getVarShape(lhsSide.varIdx);
      if (shape1.length !== 1) continue;
      const covered1 = rangeIv.offset(lhsSide.offset);
      if (covered1.lo !== 1 || covered1.hi !== shape1[0]) continue;
      if (aliases.has(lhsSide.varName)) continue;

      const constExpr = lhsSide.sign === -1 ? arena.addNegateExpr(rhsSide.exprId) : rhsSide.exprId;
      aliases.set(lhsSide.varName, {
        eliminatedVar: lhsSide.varName,
        targetVar: null,
        indexShift: 0,
        sign: 1,
        constantExprId: constExpr,
      });
      aliasForEqIndices.push(eqIdx);
    } else if (rhsSide.kind === "subscript" && lhsSide.kind === "const") {
      const shape2 = arena.getVarShape(rhsSide.varIdx);
      if (shape2.length !== 1) continue;
      const covered2 = rangeIv.offset(rhsSide.offset);
      if (covered2.lo !== 1 || covered2.hi !== shape2[0]) continue;
      if (aliases.has(rhsSide.varName)) continue;

      const constExpr = rhsSide.sign === -1 ? arena.addNegateExpr(lhsSide.exprId) : lhsSide.exprId;
      aliases.set(rhsSide.varName, {
        eliminatedVar: rhsSide.varName,
        targetVar: null,
        indexShift: 0,
        sign: 1,
        constantExprId: constExpr,
      });
      aliasForEqIndices.push(eqIdx);
    }
  }

  if (aliases.size === 0) return [];

  // Resolve transitive alias chains
  const resolveAlias = (varName: string): VectorAliasEntry | undefined => {
    let curr = aliases.get(varName);
    if (!curr) return undefined;
    let totalShift = curr.indexShift;
    let totalSign: 1 | -1 = curr.sign;
    let target = curr.targetVar;
    let constId = curr.constantExprId;
    const seen = new Set<string>([varName]);
    while (target && aliases.has(target) && !seen.has(target)) {
      seen.add(target);
      const next = aliases.get(target)!;
      totalShift += next.indexShift;
      totalSign = (totalSign * next.sign) as 1 | -1;
      target = next.targetVar;
      constId = next.constantExprId;
    }
    return {
      eliminatedVar: varName,
      targetVar: target,
      indexShift: totalShift,
      sign: totalSign,
      constantExprId: constId,
    };
  };

  // Propagate start/fixed attributes and mark eliminated array variables & alias ForEqs as removed
  for (const [elimName] of aliases) {
    const resolved = resolveAlias(elimName)!;
    aliases.set(elimName, resolved);
    const vElim = arena.getVarIdxByName(elimName);
    if (vElim >= 0) {
      if (resolved.targetVar) {
        const vKeep = arena.getVarIdxByName(resolved.targetVar);
        if (vKeep >= 0) {
          if (arena.isVarFixed(vElim) && !arena.isVarFixed(vKeep)) {
            arena.setVarFixed(vKeep, true);
          }
          const sElim = arena.getVarStartValue(vElim);
          if (sElim !== 0 && arena.getVarStartValue(vKeep) === 0) {
            arena.setVarStartValue(vKeep, sElim * resolved.sign);
          }
          arena.addAlias(vElim, arena.getVarNameId(vKeep));
        }
      }
      arena.markVarRemoved(vElim);
    }
  }

  for (const eqIdx of aliasForEqIndices) {
    arena.markEqRemoved(eqIdx);
  }

  // Rewrite expressions across all remaining equations (including inside ForEq bodies)
  const rewriteExpr = (exprId: number): number => {
    if (exprId < 0) return exprId;
    const kind = arena.getExprKind(exprId);
    switch (kind) {
      case ExprKind.Subscript: {
        const { baseExprId, subIds } = getSubscriptArgs(arena, exprId);
        const newSubs = subIds.map(rewriteExpr);
        if (baseExprId >= 0 && arena.getExprKind(baseExprId) === ExprKind.Name) {
          const baseName = arena.interner.resolve(arena.getExprData1(baseExprId)) ?? "";
          const alias = aliases.get(baseName);
          if (alias && newSubs.length === 1) {
            if (alias.targetVar === null && alias.constantExprId !== undefined) {
              return cloneArenaExpression(arena, alias.constantExprId);
            }
            if (alias.targetVar) {
              const newBase = arena.addNameExpr(alias.targetVar);
              const shiftedSub =
                alias.indexShift === 0
                  ? newSubs[0]!
                  : alias.indexShift > 0
                    ? arena.addBinaryExpr(BinOp.Add, newSubs[0]!, arena.addIntLiteral(alias.indexShift))
                    : arena.addBinaryExpr(BinOp.Sub, newSubs[0]!, arena.addIntLiteral(-alias.indexShift));
              const subNode = arena.addSubscriptExpr(newBase, [shiftedSub]);
              return alias.sign === -1 ? arena.addNegateExpr(subNode) : subNode;
            }
          }
        }
        const newBase = rewriteExpr(baseExprId);
        if (newBase === baseExprId && newSubs.every((s, idx) => s === subIds[idx])) {
          return exprId;
        }
        return arena.addSubscriptExpr(newBase, newSubs);
      }
      case ExprKind.Der: {
        const arg = arena.getExprData1(exprId);
        const newArg = rewriteExpr(arg);
        if (newArg === arg) return exprId;
        // If `der(-u[i])` was produced by a negated alias, pull negation outside `der`: `-der(u[i])`
        if (arena.getExprKind(newArg) === ExprKind.Negate) {
          return arena.addNegateExpr(arena.addDerExpr(arena.getExprLeft(newArg)));
        }
        return arena.addDerExpr(newArg);
      }
      case ExprKind.Pre: {
        const arg = arena.getExprData1(exprId);
        const newArg = rewriteExpr(arg);
        return newArg === arg ? exprId : arena.addPreExpr(newArg);
      }
      case ExprKind.Negate: {
        const op = arena.getExprLeft(exprId);
        const newOp = rewriteExpr(op);
        return newOp === op ? exprId : arena.addNegateExpr(newOp);
      }
      case ExprKind.Unary: {
        const op = arena.getExprLeft(exprId);
        const newOp = rewriteExpr(op);
        return newOp === op ? exprId : arena.addUnaryExpr(arena.getExprData1(exprId) as UnaryOp, newOp);
      }
      case ExprKind.Binary: {
        const l = arena.getExprLeft(exprId);
        const r = arena.getExprRight(exprId);
        const nl = rewriteExpr(l);
        const nr = rewriteExpr(r);
        return nl === l && nr === r ? exprId : arena.addBinaryExpr(arena.getExprData1(exprId) as BinOp, nl, nr);
      }
      case ExprKind.IfElse: {
        const c = arena.getExprData1(exprId);
        const t = arena.getExprLeft(exprId);
        const f = arena.getExprRight(exprId);
        const nc = rewriteExpr(c);
        const nt = rewriteExpr(t);
        const nf = rewriteExpr(f);
        return nc === c && nt === t && nf === f ? exprId : arena.addIfElse(nc, nt, nf);
      }
      case ExprKind.Call: {
        const fnId = arena.getExprData1(exprId);
        const argc = arena.getExprRight(exprId);
        const args: number[] = [];
        let changed = false;
        for (let i = 0; i < argc; i++) {
          const orig = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
          const rw = rewriteExpr(orig);
          if (rw !== orig) changed = true;
          args.push(rw);
        }
        return changed ? arena.addCallExpr(fnId, args) : exprId;
      }
      default:
        return exprId;
    }
  };

  for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
    if (arena.isEqRemoved(eqIdx)) continue;
    const kind = arena.getEqKind(eqIdx);
    if (kind === EqKind.Simple || kind === EqKind.InitialSimple) {
      arena.setEqLhs(eqIdx, rewriteExpr(arena.getEqLhs(eqIdx)));
      arena.setEqRhs(eqIdx, rewriteExpr(arena.getEqRhs(eqIdx)));
    } else if (kind === EqKind.For) {
      const meta = arena.getForEquationMeta(eqIdx);
      if (meta) {
        for (let i = 0; i < meta.bodyEquations.length; i++) {
          const b = meta.bodyEquations[i]!;
          b.lhsExprId = rewriteExpr(b.lhsExprId);
          b.rhsExprId = rewriteExpr(b.rhsExprId);
          if (meta.equations[i]) {
            meta.equations[i]!.lhs = b.lhsExprId;
            meta.equations[i]!.rhs = b.rhsExprId;
          }
        }
      }
    }
  }

  return Array.from(aliases.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Pillar 2B: Set-Based Connector Expansion (`expandSetBasedConnectionsArena`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expands `EqKind.For` loops containing `EqKind.Connect` equations (e.g.
 * `for i in 1:N-1 loop connect(c[i].n, c[i+1].p); end for;`) using an `SBGraph`
 * and `connectedComponents(sbg)` to emit compact `EqKind.For` potential equalities
 * and Kirchhoff flow equations without unrolling the loop (faithful to
 * `Connectors::solve` in `SBGraphs_connectors.cpp`).
 */
export function expandSetBasedConnectionsArena(arena: DAEBuilder): {
  sbg: SBGraph;
  componentsMap: PWLMap;
  generatedForEquations: number[];
} {
  // Collect connector variables (flow vs potential) grouped by connector array prefix
  interface ConnectorPortGroup {
    prefix: string;
    size: number;
    potentialFields: string[];
    flowFields: string[];
    offsetStart: number;
  }

  const portGroups = new Map<string, ConnectorPortGroup>();
  for (let vIdx = 0; vIdx < arena.varCount; vIdx++) {
    if (arena.isVarRemoved(vIdx)) continue;
    const name = arena.getVarName(vIdx);
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx <= 0) continue;
    const prefix = name.slice(0, dotIdx);
    const field = name.slice(dotIdx + 1);
    const shape = arena.getVarShape(vIdx);
    const size = shape.length > 0 ? shape[0]! : 1;

    let grp = portGroups.get(prefix);
    if (!grp) {
      grp = {
        prefix,
        size,
        potentialFields: [],
        flowFields: [],
        offsetStart: 1,
      };
      portGroups.set(prefix, grp);
    } else if (size > grp.size) {
      grp.size = size;
    }

    if (arena.isVarFlow(vIdx)) {
      if (!grp.flowFields.includes(field)) grp.flowFields.push(field);
    } else if (!arena.isVarStream(vIdx)) {
      if (!grp.potentialFields.includes(field)) grp.potentialFields.push(field);
    }
  }

  // Assign contiguous 1D SBGraph vertex intervals to each connector port group
  let nextVertexOffset = 1;
  const vAtoms: MultiInterval[] = [];
  for (const grp of portGroups.values()) {
    grp.offsetStart = nextVertexOffset;
    vAtoms.push(new MultiInterval([new SBGInterval(grp.offsetStart, 1, grp.offsetStart + grp.size - 1)]));
    nextVertexOffset += grp.size + 1;
  }
  const V = new SBGSet(vAtoms);

  // Inspect `For` equations containing `EqKind.Connect`
  const eAtoms: MultiInterval[] = [];
  const map1Pieces: PWLMapPiece[] = [];
  const map2Pieces: PWLMapPiece[] = [];
  let nextEdgeOffset = 1;
  const generatedForEquations: number[] = [];

  const parseConnectEndpoint = (
    exprId: number,
    iterName: string | null,
  ): { prefix: string; isLoopIndexed: boolean; coeff: number; offset: number } | null => {
    if (exprId < 0) return null;
    const k = arena.getExprKind(exprId);
    if (k === ExprKind.Subscript) {
      const { baseExprId, subIds } = getSubscriptArgs(arena, exprId);
      if (subIds.length === 1 && baseExprId >= 0 && arena.getExprKind(baseExprId) === ExprKind.Name) {
        const prefix = arena.interner.resolve(arena.getExprData1(baseExprId)) ?? "";
        const aff = parseAffineSubscriptExpr(arena, subIds[0]!, iterName);
        if (aff) {
          return { prefix, ...aff };
        }
      }
    } else if (k === ExprKind.Name) {
      const prefix = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
      return { prefix, isLoopIndexed: false, coeff: 0, offset: 1 };
    }
    return null;
  };

  interface ParsedEndpoint {
    prefix: string;
    isLoopIndexed: boolean;
    coeff: number;
    offset: number;
  }

  interface LoopConnectRecord {
    eqIdx: number;
    meta: ForEquationMeta;
    iterName: string;
    rangeIv: SBGInterval;
    pairs: {
      ep1: ParsedEndpoint;
      ep2: ParsedEndpoint;
      grp1: ConnectorPortGroup;
      grp2: ConnectorPortGroup;
    }[];
  }

  const loopRecords: LoopConnectRecord[] = [];

  for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
    if (arena.isEqRemoved(eqIdx)) continue;
    if (arena.getEqKind(eqIdx) !== EqKind.For) continue;
    const meta = arena.getForEquationMeta(eqIdx);
    if (!meta) continue;
    const connectBodies = meta.bodyEquations.filter((b) => b.kind === EqKind.Connect);
    if (connectBodies.length === 0) continue;

    const rangeIv = extractRangeInterval(arena, meta.rangeExprId);
    if (!rangeIv || rangeIv.isEmpty()) continue;
    const iterName = arena.interner.resolve(meta.indexNameId) ?? "i";
    const pairs: LoopConnectRecord["pairs"] = [];

    for (const cBody of connectBodies) {
      const ep1 = parseConnectEndpoint(cBody.lhsExprId, iterName);
      const ep2 = parseConnectEndpoint(cBody.rhsExprId, iterName);
      if (!ep1 || !ep2) continue;

      const grp1 = portGroups.get(ep1.prefix);
      const grp2 = portGroups.get(ep2.prefix);
      if (!grp1 || !grp2) continue;

      // Add SBGraph edge interval and endpoint maps
      const edgeIv = new SBGInterval(nextEdgeOffset, 1, nextEdgeOffset + rangeIv.size() - 1);
      const edgeDom = new SBGSet([new MultiInterval([edgeIv])]);
      eAtoms.push(new MultiInterval([edgeIv]));

      // Map edge index e in [nextEdgeOffset ..] -> loop i = rangeIv.lo + (e - nextEdgeOffset) * rangeIv.step
      // -> vertex = grp.offsetStart - 1 + (coeff * i + offset)
      const g1 = ep1.isLoopIndexed ? ep1.coeff * rangeIv.step : 0;
      const o1 =
        grp1.offsetStart -
        1 +
        ep1.offset +
        (ep1.isLoopIndexed ? ep1.coeff * (rangeIv.lo - nextEdgeOffset * rangeIv.step) : 0);
      const g2 = ep2.isLoopIndexed ? ep2.coeff * rangeIv.step : 0;
      const o2 =
        grp2.offsetStart -
        1 +
        ep2.offset +
        (ep2.isLoopIndexed ? ep2.coeff * (rangeIv.lo - nextEdgeOffset * rangeIv.step) : 0);

      map1Pieces.push({ dom: edgeDom, map: new LMap([g1], [o1]) });
      map2Pieces.push({ dom: edgeDom, map: new LMap([g2], [o2]) });
      nextEdgeOffset += rangeIv.size() + 1;

      pairs.push({ ep1, ep2, grp1, grp2 });
    }

    if (pairs.length > 0) {
      loopRecords.push({ eqIdx, meta, iterName, rangeIv, pairs });
    }

    // Remove the `Connect` equations from the original `For` equation
    meta.bodyEquations = meta.bodyEquations.filter((b) => b.kind !== EqKind.Connect);
    meta.equations = meta.equations.filter((b) => b.kind !== EqKind.Connect);
    if (meta.bodyEquations.length === 0) {
      arena.markEqRemoved(eqIdx);
    }
  }

  const E = new SBGSet(eAtoms);
  const sbg = new SBGraph(V, E, new PWLMap(map1Pieces), new PWLMap(map2Pieces));
  const componentsMap = connectedComponents(sbg);

  const endpointKey = (ep: ParsedEndpoint): string =>
    `${ep.prefix}:${ep.isLoopIndexed ? 1 : 0}:${ep.coeff}:${ep.offset}`;

  const vertexAtIter = (ep: ParsedEndpoint, grp: ConnectorPortGroup, iterVal: number): number =>
    grp.offsetStart - 1 + (ep.isLoopIndexed ? ep.coeff * iterVal + ep.offset : ep.offset);

  for (const rec of loopRecords) {
    const { meta, iterName, rangeIv, pairs } = rec;

    const buildFieldRef = (ep: ParsedEndpoint, field: string): number => {
      const fullVarName = `${ep.prefix}.${field}`;
      const baseId = arena.addNameExpr(fullVarName);
      if (!ep.isLoopIndexed && ep.offset === 1 && (portGroups.get(ep.prefix)?.size ?? 1) === 1) {
        return baseId;
      }
      return buildVectorUsageExpr(
        arena,
        {
          varIdx: -1,
          varName: fullVarName,
          isDerivative: false,
          isLoopIndexed: [ep.isLoopIndexed],
          coeff: [ep.coeff],
          offset: [ep.offset],
          exprId: -1,
        },
        iterName,
      );
    };

    // Group connected endpoints within the loop using both direct connect pairs and SBGraph connectedComponents
    const epByKey = new Map<string, { ep: ParsedEndpoint; grp: ConnectorPortGroup }>();
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      let curr = k;
      while (parent.get(curr) !== undefined && parent.get(curr) !== curr) {
        curr = parent.get(curr)!;
      }
      return curr;
    };
    const union = (a: string, b: string): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    };

    const repToFirstKey = new Map<number, string>();
    const registerEndpoint = (ep: ParsedEndpoint, grp: ConnectorPortGroup): string => {
      const k = endpointKey(ep);
      if (!epByKey.has(k)) {
        epByKey.set(k, { ep, grp });
        parent.set(k, k);
        const v0 = vertexAtIter(ep, grp, rangeIv.lo);
        const compRep = componentsMap.apply([v0])?.[0];
        if (compRep !== undefined) {
          const existingKey = repToFirstKey.get(compRep);
          if (existingKey !== undefined) {
            union(existingKey, k);
          } else {
            repToFirstKey.set(compRep, k);
          }
        }
      }
      return k;
    };

    for (const { ep1, ep2, grp1, grp2 } of pairs) {
      const k1 = registerEndpoint(ep1, grp1);
      const k2 = registerEndpoint(ep2, grp2);
      union(k1, k2);
    }

    const componentGroups = new Map<string, { ep: ParsedEndpoint; grp: ConnectorPortGroup }[]>();
    for (const [k, item] of epByKey.entries()) {
      const root = find(k);
      let list = componentGroups.get(root);
      if (!list) {
        list = [];
        componentGroups.set(root, list);
      }
      list.push(item);
    }

    for (const compEndpoints of componentGroups.values()) {
      if (compEndpoints.length < 2) continue;
      const first = compEndpoints[0]!;
      const newForIdx = arena.addForEquation(meta.indexNameId, cloneArenaExpression(arena, meta.rangeExprId));

      // Emit (k - 1) potential equalities against the component representative endpoint
      for (const potField of first.grp.potentialFields) {
        for (let m = 1; m < compEndpoints.length; m++) {
          const other = compEndpoints[m]!;
          if (!other.grp.potentialFields.includes(potField)) continue;
          const lhsPot = buildFieldRef(first.ep, potField);
          const rhsPot = buildFieldRef(other.ep, potField);
          arena.addForBodyEquation(newForIdx, EqKind.Simple, lhsPot, rhsPot);
        }
      }

      // Emit one Kirchhoff zero-sum equation per flow field across all k endpoints in the component
      for (const flowField of first.grp.flowFields) {
        const flowTerms: number[] = [];
        for (const item of compEndpoints) {
          if (item.grp.flowFields.includes(flowField)) {
            flowTerms.push(buildFieldRef(item.ep, flowField));
          }
        }
        if (flowTerms.length >= 2) {
          let sumExpr = flowTerms[0]!;
          for (let m = 1; m < flowTerms.length; m++) {
            sumExpr = arena.addBinaryExpr(BinOp.Add, sumExpr, flowTerms[m]!);
          }
          arena.addForBodyEquation(newForIdx, EqKind.Simple, sumExpr, arena.addRealLiteral(0));
        }
      }

      generatedForEquations.push(newForIdx);
    }
  }

  return {
    sbg,
    componentsMap,
    generatedForEquations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Pillar 3B: Micro-Modelica (μ-Modelica) Discontinuity Lowering
//     (`convertArenaToMicroModelica`)
// ─────────────────────────────────────────────────────────────────────────────

export interface MicroModelicaLoweringResult {
  /** Names of newly synthesized `discrete Real` variables (`_d1`, `_d2`, ...). */
  readonly discreteVars: string[];
  /** Arena indices of newly synthesized `EqKind.When` zero-crossing equations. */
  readonly whenEquationIndices: number[];
  /** Zero-crossing event indicator `ExprId`s registered on `arena`. */
  readonly eventIndicatorExprIds: number[];
}

/**
 * Lowers discontinuous expressions (`abs(x)`, `sign(x)`, `min(a, b)`, `max(a, b)`,
 * `IfElse` expressions) in `arena` into canonical $\mu$-Modelica form
 * (`ConvertToMicro` in `CIFASIS/modelicacc` `src/mmo/util/convert_to_micro.cpp`),
 * introducing auxiliary `discrete Real` variables updated inside complementary
 * `When` zero-crossing clauses and registering event indicators on `arena`.
 */
export function convertArenaToMicroModelica(
  arena: DAEBuilder,
  options?: { hysteresisEps?: number | undefined },
): MicroModelicaLoweringResult {
  const eps = options?.hysteresisEps ?? 1e-9;
  const discreteVars: string[] = [];
  const whenEquationIndices: number[] = [];
  const eventIndicatorExprIds: number[] = [];
  let discCounter = 1;

  const allocDiscreteVar = (initialVal: number): { name: string; nameId: number; varIdx: number } => {
    let name = `_d${discCounter++}`;
    while (arena.getVarIdxByName(name) >= 0) {
      name = `_d${discCounter++}`;
    }
    const varIdx = arena.addVariable(name, VarType.Real, Variability.Discrete, Causality.Local, initialVal);
    const nameId = arena.getVarNameId(varIdx);
    arena.setVarStartValue(varIdx, initialVal);
    discreteVars.push(name);
    return { name, nameId, varIdx };
  };

  /**
   * Emits a complementary pair of `When` zero-crossing clauses for condition `argExpr > 0`:
   *   - `when argExpr > eps then d = posVal; end when;`
   *   - `when argExpr < -eps then d = negVal; end when;`
   * and registers `argExpr` as a zero-crossing event indicator.
   */
  const addComplementaryWhenZeroCrossing = (
    argExpr: number,
    discNameId: number,
    posVal: number,
    negVal: number,
  ): void => {
    const condPos = arena.addBinaryExpr(BinOp.Gt, cloneArenaExpression(arena, argExpr), arena.addRealLiteral(eps));
    const condNeg = arena.addBinaryExpr(BinOp.Lt, cloneArenaExpression(arena, argExpr), arena.addRealLiteral(-eps));

    const whenIdx = arena.addWhenEquation(condPos);
    arena.addWhenBodyEquation(whenIdx, EqKind.Simple, arena.addName(discNameId), arena.addRealLiteral(posVal));
    const meta = arena.getWhenEquationMeta(whenIdx);
    if (meta) {
      const elseLhs = arena.addName(discNameId);
      const elseRhs = arena.addRealLiteral(negVal);
      meta.elseWhenClauses.push({
        conditionExprId: condNeg,
        bodyEquations: [{ kind: EqKind.Simple, lhsExprId: elseLhs, rhsExprId: elseRhs }],
        equations: [{ kind: EqKind.Simple, lhs: elseLhs, rhs: elseRhs }],
      });
    }
    whenEquationIndices.push(whenIdx);
    const zcExpr = cloneArenaExpression(arena, argExpr);
    arena.addEventIndicator(zcExpr);
    eventIndicatorExprIds.push(zcExpr);
  };

  const lowerExpr = (exprId: number): number => {
    if (exprId < 0) return exprId;
    const kind = arena.getExprKind(exprId);

    switch (kind) {
      case ExprKind.Call: {
        const fnName = arena.getExprFuncName(exprId);
        const argc = arena.getExprRight(exprId);
        const args: number[] = [];
        for (let i = 0; i < argc; i++) {
          const rawArg = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
          args.push(lowerExpr(rawArg));
        }

        if (fnName === "abs" && args.length === 1) {
          // abs(x) -> _d * x where _d in {+1, -1} switches on x > 0 / x < 0
          const xExpr = args[0]!;
          const disc = allocDiscreteVar(1.0);
          addComplementaryWhenZeroCrossing(xExpr, disc.nameId, 1.0, -1.0);
          return arena.addBinaryExpr(BinOp.Mul, arena.addName(disc.nameId), xExpr);
        }

        if (fnName === "sign" && args.length === 1) {
          // sign(x) -> _d where _d in {+1, -1} switches on x > 0 / x < 0
          const xExpr = args[0]!;
          const disc = allocDiscreteVar(1.0);
          addComplementaryWhenZeroCrossing(xExpr, disc.nameId, 1.0, -1.0);
          return arena.addName(disc.nameId);
        }

        if ((fnName === "min" || fnName === "max") && args.length === 2) {
          // max(a, b) -> _d * a + (1 - _d) * b where _d in {1, 0} switches on (a - b) > 0
          // min(a, b) -> _d * b + (1 - _d) * a
          const aExpr = args[0]!;
          const bExpr = args[1]!;
          const diffExpr = arena.addBinaryExpr(BinOp.Sub, aExpr, bExpr);
          const disc = allocDiscreteVar(1.0);
          addComplementaryWhenZeroCrossing(diffExpr, disc.nameId, 1.0, 0.0);

          const dRef1 = arena.addName(disc.nameId);
          const dRef2 = arena.addName(disc.nameId);
          const oneMinusD = arena.addBinaryExpr(BinOp.Sub, arena.addRealLiteral(1.0), dRef2);
          if (fnName === "max") {
            return arena.addBinaryExpr(
              BinOp.Add,
              arena.addBinaryExpr(BinOp.Mul, dRef1, aExpr),
              arena.addBinaryExpr(BinOp.Mul, oneMinusD, bExpr),
            );
          }
          return arena.addBinaryExpr(
            BinOp.Add,
            arena.addBinaryExpr(BinOp.Mul, dRef1, bExpr),
            arena.addBinaryExpr(BinOp.Mul, oneMinusD, aExpr),
          );
        }

        return arena.addCallExpr(arena.getExprData1(exprId), args);
      }

      case ExprKind.IfElse: {
        const condId = arena.getExprData1(exprId);
        const thenId = lowerExpr(arena.getExprLeft(exprId));
        const elseId = lowerExpr(arena.getExprRight(exprId));

        // If condition is a relational comparison `lhs > rhs`, `lhs >= rhs`, `lhs < rhs`, `lhs <= rhs`,
        // lower to `_d * thenExpr + (1 - _d) * elseExpr`
        if (condId >= 0 && arena.getExprKind(condId) === ExprKind.Binary) {
          const op = arena.getExprData1(condId) as BinOp;
          const cLeft = lowerExpr(arena.getExprLeft(condId));
          const cRight = lowerExpr(arena.getExprRight(condId));
          if (op === BinOp.Gt || op === BinOp.Gte || op === BinOp.Lt || op === BinOp.Lte) {
            const zcDiff =
              op === BinOp.Gt || op === BinOp.Gte
                ? arena.addBinaryExpr(BinOp.Sub, cLeft, cRight)
                : arena.addBinaryExpr(BinOp.Sub, cRight, cLeft);
            const disc = allocDiscreteVar(1.0);
            addComplementaryWhenZeroCrossing(zcDiff, disc.nameId, 1.0, 0.0);
            const dRef1 = arena.addName(disc.nameId);
            const dRef2 = arena.addName(disc.nameId);
            const oneMinusD = arena.addBinaryExpr(BinOp.Sub, arena.addRealLiteral(1.0), dRef2);
            return arena.addBinaryExpr(
              BinOp.Add,
              arena.addBinaryExpr(BinOp.Mul, dRef1, thenId),
              arena.addBinaryExpr(BinOp.Mul, oneMinusD, elseId),
            );
          }
        }
        return arena.addIfElse(condId, thenId, elseId);
      }

      case ExprKind.Binary: {
        const l = arena.getExprLeft(exprId);
        const r = arena.getExprRight(exprId);
        const nl = lowerExpr(l);
        const nr = lowerExpr(r);
        return nl === l && nr === r ? exprId : arena.addBinaryExpr(arena.getExprData1(exprId) as BinOp, nl, nr);
      }

      case ExprKind.Negate: {
        const op = arena.getExprLeft(exprId);
        const nop = lowerExpr(op);
        return nop === op ? exprId : arena.addNegateExpr(nop);
      }

      case ExprKind.Unary: {
        const op = arena.getExprLeft(exprId);
        const nop = lowerExpr(op);
        return nop === op ? exprId : arena.addUnaryExpr(arena.getExprData1(exprId) as UnaryOp, nop);
      }

      default:
        return exprId;
    }
  };

  // Snapshot original equation count so we don't re-traverse newly added When equations
  const origEqCount = arena.eqCount;
  for (let eqIdx = 0; eqIdx < origEqCount; eqIdx++) {
    if (arena.isEqRemoved(eqIdx)) continue;
    const kind = arena.getEqKind(eqIdx);
    if (kind === EqKind.Simple) {
      arena.setEqLhs(eqIdx, lowerExpr(arena.getEqLhs(eqIdx)));
      arena.setEqRhs(eqIdx, lowerExpr(arena.getEqRhs(eqIdx)));
    } else if (kind === EqKind.For) {
      const meta = arena.getForEquationMeta(eqIdx);
      if (meta) {
        for (let i = 0; i < meta.bodyEquations.length; i++) {
          const b = meta.bodyEquations[i]!;
          if (b.kind === EqKind.Simple) {
            b.lhsExprId = lowerExpr(b.lhsExprId);
            b.rhsExprId = lowerExpr(b.rhsExprId);
            if (meta.equations[i]) {
              meta.equations[i]!.lhs = b.lhsExprId;
              meta.equations[i]!.rhs = b.rhsExprId;
            }
          }
        }
      }
    }
  }

  void VarAttrKind;
  return {
    discreteVars,
    whenEquationIndices,
    eventIndicatorExprIds,
  };
}
