// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tier 2 static analysis: sound interval abstract interpretation over the CSMF control-block graph.
 *
 * Transfer functions mirror the runtime semantics in `packages/simulate` (`csmf-controls.ts`). Any block whose
 * behavior is not bounded with certainty (sensors, filters, transforms, unknown kinds) maps to `[-inf, +inf]`,
 * so a reported finite bound is always an over-approximation and never an unsound claim.
 */

import type { EmtControlBlock } from "../types.js";

export interface Interval {
  lo: number;
  hi: number;
}

const TOP: Interval = { lo: -Infinity, hi: Infinity };
const ZERO: Interval = { lo: 0, hi: 0 };

export const isBounded = (i: Interval): boolean => Number.isFinite(i.lo) && Number.isFinite(i.hi);

const pt = (v: number): Interval => (Number.isFinite(v) ? { lo: v, hi: v } : TOP);
const hull = (...xs: Interval[]): Interval => ({
  lo: Math.min(...xs.map((x) => x.lo)),
  hi: Math.max(...xs.map((x) => x.hi)),
});
const add = (a: Interval, b: Interval): Interval => ({ lo: a.lo + b.lo, hi: a.hi + b.hi });
/** Scalar product with the convention 0 * infinity = 0. */
const smul = (k: number, a: Interval): Interval => {
  const m = (x: number): number => (k === 0 || x === 0 ? 0 : k * x);
  const p = m(a.lo);
  const q = m(a.hi);
  return { lo: Math.min(p, q), hi: Math.max(p, q) };
};
const mul = (a: Interval, b: Interval): Interval => {
  const m = (x: number, y: number): number => (x === 0 || y === 0 ? 0 : x * y);
  const c = [m(a.lo, b.lo), m(a.lo, b.hi), m(a.hi, b.lo), m(a.hi, b.hi)];
  return { lo: Math.min(...c), hi: Math.max(...c) };
};
const clamp = (a: Interval, lo: number, hi: number): Interval => ({
  lo: Math.min(hi, Math.max(lo, a.lo)),
  hi: Math.min(hi, Math.max(lo, a.hi)),
});

/** Reads the first defined numeric parameter among `keys`, else `dflt`. */
function param(p: Record<string, number>, keys: string[], dflt: number): number {
  for (const k of keys) {
    const v = p[k];
    if (v !== undefined && Number.isFinite(v)) return v;
  }
  return dflt;
}

/** Output limits of a limiter-like block (`limit`, `pi`, `integral`). */
export function outputLimits(b: Pick<EmtControlBlock, "params">): { lo: number; hi: number } {
  const lo = param(b.params, ["min", "LL", "Min", "LLim"], -Infinity);
  const hi = param(b.params, ["max", "UL", "Max", "ULim"], Infinity);
  return { lo, hi };
}

/** Sign applied to input `k` of a `sum` block (`s1..s3` parameters, default +1), as in the runtime. */
function sumSign(p: Record<string, number>, k: number): number {
  return k < 3 ? (p[`s${k + 1}`] ?? 1) : 1;
}

function transfer(b: EmtControlBlock, ins: Interval[]): Interval {
  const p = b.params;
  const u0 = ins[0] ?? ZERO;
  const u1 = ins[1] ?? ZERO;
  switch (b.kind) {
    case "const":
      return pt(param(p, ["value", "K", "k"], 0));
    case "gain":
      return smul(param(p, ["K", "k", "G"], 1), u0);
    case "sum": {
      let acc: Interval = ZERO;
      ins.forEach((x, k) => {
        acc = add(acc, smul(sumSign(p, k), x));
      });
      return acc;
    }
    case "mult":
      return mul(u0, u1);
    case "square": {
      const m = Math.max(u0.lo * u0.lo, u0.hi * u0.hi);
      return { lo: u0.lo <= 0 && u0.hi >= 0 ? 0 : Math.min(u0.lo * u0.lo, u0.hi * u0.hi), hi: m };
    }
    case "limit": {
      const { lo, hi } = outputLimits(b);
      return clamp(u0, lo, hi);
    }
    case "pi":
    case "integral": {
      const { lo, hi } = outputLimits(b);
      return Number.isFinite(lo) && Number.isFinite(hi) ? { lo, hi } : TOP;
    }
    case "trans_filt":
      return u0;
    case "ratelimit":
      // The output moves toward the input and never leaves the hull of the input history (and its initial 0).
      return hull(u0, ZERO);
    case "select":
      return hull(u0, u1);
    case "abs":
      return { lo: 0, hi: Math.max(Math.abs(u0.lo), Math.abs(u0.hi)) };
    case "tdelay":
    case "zminusone":
      return u0;
    case "maxmin":
      // max/min of the operands always lies within the hull of the operands.
      return ins.length > 0 ? hull(...ins) : ZERO;
    case "fp_int":
      return { lo: Math.trunc(u0.lo), hi: Math.trunc(u0.hi) };
    case "trig":
      return { lo: -1, hi: 1 };
    case "angle_resolver":
      return { lo: -Math.PI, hi: Math.PI };
    case "logic":
    case "bin_delay":
    case "tbreakn":
      return { lo: 0, hi: 1 };
    case "compar":
      return hull(pt(param(p, ["high"], 1)), pt(param(p, ["low"], 0)));
    case "compare":
      return hull(pt(param(p, ["OL"], 0)), pt(param(p, ["OH"], 1)));
    case "range":
      return hull(pt(param(p, ["OL"], 0)), pt(param(p, ["OM"], 0)), pt(param(p, ["OH"], 0)));
    case "upramp":
      return hull(ZERO, pt(param(p, ["Y2"], 1)));
    case "rms3ph":
    case "time_sig":
      return { lo: 0, hi: Infinity };
    case "xy_table": {
      const n = Math.max(0, Math.trunc(param(p, ["N"], 0)));
      const ys: number[] = [];
      for (let k = 1; k <= n; k++) {
        const y = p[`Y${k}`];
        if (y !== undefined && Number.isFinite(y) && p[`X${k}`] !== undefined) ys.push(y);
      }
      if (ys.length === 0) return pt(param(p, ["Yoff"], 0));
      return add(smul(param(p, ["Ky"], 1), { lo: Math.min(...ys), hi: Math.max(...ys) }), pt(param(p, ["Yoff"], 0)));
    }
    default:
      // sensors, filters, transforms, division, inversion, ... : no sound finite bound is claimed.
      return TOP;
  }
}

interface AffineForm {
  center: number;
  terms: Map<string, number>;
}

const ZERO_AFFINE: AffineForm = { center: 0, terms: new Map() };

function intervalToAffine(iv: Interval, noiseId: string): AffineForm | null {
  if (!isBounded(iv)) return null;
  const center = 0.5 * (iv.lo + iv.hi);
  const rad = 0.5 * (iv.hi - iv.lo);
  const terms = new Map<string, number>();
  if (rad > 0) terms.set(noiseId, rad);
  return { center, terms };
}

function affineToInterval(a: AffineForm): Interval {
  let rad = 0;
  for (const w of a.terms.values()) rad += Math.abs(w);
  return { lo: a.center - rad, hi: a.center + rad };
}

function scaleAffine(k: number, a: AffineForm | null): AffineForm | null {
  if (k === 0) return ZERO_AFFINE;
  if (!a) return null;
  const terms = new Map<string, number>();
  for (const [id, w] of a.terms) {
    const scaled = k * w;
    if (scaled !== 0) terms.set(id, scaled);
  }
  return { center: k * a.center, terms };
}

function addWeightedAffines(items: Array<{ k: number; a: AffineForm | null }>): AffineForm | null {
  let center = 0;
  const terms = new Map<string, number>();
  for (const { k, a } of items) {
    if (k === 0) continue;
    if (!a) return null;
    center += k * a.center;
    for (const [id, w] of a.terms) {
      const next = (terms.get(id) ?? 0) + k * w;
      if (next === 0) terms.delete(id);
      else terms.set(id, next);
    }
  }
  return { center, terms };
}

export interface ControlZonotopeEntry {
  interval: Interval;
  plainInterval: Interval;
  tightenedByZonotope: boolean;
}

/**
 * Computes sound plain-interval AND affine-zonotope bounds for every control block by Kleene iteration
 * with widening and multi-step correlation preservation (`x - x` cancellation across gains, summers,
 * delays, filters, and non-saturating limiters).
 */
export function analyzeControlZonotopes(blocks: readonly EmtControlBlock[]): Map<string, ControlZonotopeEntry> {
  const out = new Map<string, Interval>();
  const plainOut = new Map<string, Interval>();
  const aff = new Map<string, AffineForm | null>();
  // Blocks with internal state expose their initial output (0) on the first step; memoryless blocks start unreached.
  for (const b of blocks) {
    if (INITIAL_ZERO_KINDS.has(b.kind)) {
      out.set(b.id, ZERO);
      plainOut.set(b.id, ZERO);
      aff.set(b.id, ZERO_AFFINE);
    }
  }
  const known = new Set(blocks.map((b) => b.id));
  const MAX_PASSES = 40;
  const WIDEN_AFTER = 6;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (const b of blocks) {
      // Unresolved ids read as 0 (runtime behavior); a known-but-unreached input defers this block to a later pass.
      if (b.inputs.some((id) => known.has(id) && !out.has(id))) continue;
      const ins = b.inputs.map((id) => out.get(id) ?? ZERO);
      const plainIns = b.inputs.map((id) => plainOut.get(id) ?? ZERO);
      const inAff = b.inputs.map((id) => (aff.has(id) ? aff.get(id)! : ZERO_AFFINE));
      const prev = out.get(b.id);
      const prevPlain = plainOut.get(b.id);

      let fresh = transfer(b, ins);
      const freshPlain = transfer(b, plainIns);
      let nextAff: AffineForm | null = null;

      if (b.kind === "const") {
        nextAff = intervalToAffine(fresh, b.id);
      } else if (b.kind === "gain") {
        const k = param(b.params, ["K", "k", "G"], 1);
        nextAff = scaleAffine(k, b.inputs.length === 0 ? ZERO_AFFINE : (inAff[0] ?? null));
      } else if (b.kind === "sum") {
        nextAff = addWeightedAffines(inAff.map((a, idx) => ({ k: sumSign(b.params, idx), a })));
      } else if (b.kind === "tdelay" || b.kind === "zminusone" || b.kind === "trans_filt") {
        // Soundness: x(t - tau) is NOT instantaneously identical to x(t), so propagating the
        // same noise symbols would unsoundly prove x(t) - x(t - tau) = [0, 0]. Allocate a
        // fresh independent noise symbol preserving the exact [lo, hi] range enclosure.
        nextAff = b.inputs.length === 0 ? ZERO_AFFINE : intervalToAffine(fresh, b.id);
      } else if (b.kind === "limit") {
        const uAff = b.inputs.length === 0 ? ZERO_AFFINE : (inAff[0] ?? null);
        if (uAff) {
          const z = affineToInterval(uAff);
          const lim = outputLimits(b);
          if (z.lo >= lim.lo && z.hi <= lim.hi) {
            // Non-saturating limiter acts as identity on this zonotope
            nextAff = uAff;
          }
        }
      }

      if (nextAff) {
        const zBounds = affineToInterval(nextAff);
        fresh = { lo: Math.max(fresh.lo, zBounds.lo), hi: Math.min(fresh.hi, zBounds.hi) };
      }

      let next = prev ? hull(prev, fresh) : fresh;
      let nextPlain = prevPlain ? hull(prevPlain, freshPlain) : freshPlain;
      if (prev && pass >= WIDEN_AFTER) {
        next = { lo: next.lo < prev.lo ? -Infinity : next.lo, hi: next.hi > prev.hi ? Infinity : next.hi };
      }
      if (prevPlain && pass >= WIDEN_AFTER) {
        nextPlain = {
          lo: nextPlain.lo < prevPlain.lo ? -Infinity : nextPlain.lo,
          hi: nextPlain.hi > prevPlain.hi ? Infinity : nextPlain.hi,
        };
      }

      const effAff = nextAff && next.lo === fresh.lo && next.hi === fresh.hi ? nextAff : intervalToAffine(next, b.id);
      aff.set(b.id, effAff);

      if (
        !prev ||
        next.lo !== prev.lo ||
        next.hi !== prev.hi ||
        !prevPlain ||
        nextPlain.lo !== prevPlain.lo ||
        nextPlain.hi !== prevPlain.hi
      ) {
        out.set(b.id, next);
        plainOut.set(b.id, nextPlain);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const report = new Map<string, ControlZonotopeEntry>();
  for (const [id, interval] of out) {
    const plainInterval = plainOut.get(id) ?? interval;
    const zWidth = interval.hi - interval.lo;
    const pWidth = plainInterval.hi - plainInterval.lo;
    const tightenedByZonotope = isBounded(interval) && (!isBounded(plainInterval) || zWidth + 1e-6 < pWidth * 0.75);
    report.set(id, { interval, plainInterval, tightenedByZonotope });
  }
  return report;
}

/**
 * Computes a sound output interval for every control block by Kleene iteration with widening (to +/-infinity)
 * and 1D affine/zonotope noise-symbol correlation tracking so feedforward differences `x - x` cancel exactly.
 */
export function analyzeControlIntervals(blocks: readonly EmtControlBlock[]): Map<string, Interval> {
  const res = new Map<string, Interval>();
  for (const [id, entry] of analyzeControlZonotopes(blocks)) {
    res.set(id, entry.interval);
  }
  return res;
}

/** Kinds whose first-step output is their zero-initialised state. */
const INITIAL_ZERO_KINDS = new Set<string>(["pi", "integral", "lag", "leadlag", "ratelimit", "bin_delay", "rms3ph"]);
