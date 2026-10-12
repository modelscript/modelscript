// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Arena → validated DAE compiler.
 *
 * Turns a flattened `DAEBuilder` arena in semi-explicit form
 *     der(x) = f(x, z, p),   0 = g(x, z, p)
 * into a {@link DaeSystem} with interval extensions of `f`, `g` and `J_z` for the validated
 * `DaeFlowpipeSolver` path. No hand-written lambdas are involved (fixes D11 for DAE flowpipes).
 *
 * Soundness notes:
 *  - `f` and `g` are evaluated with the shared outward-rounded `evalArenaExpr` interpreter.
 *  - `J_z` is computed by forward-mode interval AD ({@link DualDomain}) rather than by the symbolic
 *    differentiator, which silently returns 0 for unsupported constructs. Anything non-smooth or
 *    unsupported yields an unbounded gradient, so the Krawczyk test fails instead of lying.
 *  - Parameters/inputs are enclosed by their declared bounds (`DaeIntervalEvaluator.getVarBound`);
 *    unbounded parameters make the result `unknown`, never a false proof.
 */

import {
  ivAbs,
  ivAdd,
  ivAtan,
  ivCos,
  ivDiv,
  ivExp,
  ivLog,
  ivMul,
  ivNeg,
  ivPowInt,
  ivSin,
  ivSqrt,
  ivSub,
  ivTan,
  ivTanh,
} from "../../analysis/outward_rounding.js";
import type { DaeSystem } from "../../analysis/wasm_dae_flowpipe.js";
import { Interval } from "../../analysis/wasm_interval.js";
import { Causality, DAEBuilder, EqKind, ExprKind, Variability } from "../../dae/wasm_dae.js";
import { ExprDomain, IntervalDomain, WHOLE_LINE, evalArenaExpr } from "./arena_eval.js";
import { DaeIntervalEvaluator } from "./dae_interval_evaluator.js";

const pt = (v: number): Interval => new Interval(v, v);

/** Interval value with an interval gradient with respect to a fixed list of directions. */
export interface IntervalDual {
  v: Interval;
  g: Interval[];
}

/** Forward-mode interval automatic differentiation as an {@link ExprDomain}. */
export function createDualDomain(nDir: number): ExprDomain<IntervalDual> {
  const zeros = (): Interval[] => Array.from({ length: nDir }, () => pt(0));
  const wholes = (): Interval[] => Array.from({ length: nDir }, () => WHOLE_LINE());
  const scale = (g: Interval[], s: Interval): Interval[] => g.map((c) => ivMul(c, s));
  const chain = (a: IntervalDual, v: Interval, deriv: Interval): IntervalDual => ({ v, g: scale(a.g, deriv) });
  const one = pt(1);

  const dom: ExprDomain<IntervalDual> = {
    constant: (c) => (Number.isFinite(c) ? { v: pt(c), g: zeros() } : { v: WHOLE_LINE(), g: wholes() }),
    // Used for TOP / truth values / non-smooth results: conservative unbounded gradient.
    fromInterval: (iv) => ({ v: new Interval(iv.lo, iv.hi), g: wholes() }),
    toInterval: (a) => a.v,
    add: (a, b) => ({ v: ivAdd(a.v, b.v), g: a.g.map((c, k) => ivAdd(c, b.g[k]!)) }),
    sub: (a, b) => ({ v: ivSub(a.v, b.v), g: a.g.map((c, k) => ivSub(c, b.g[k]!)) }),
    mul: (a, b) => ({
      v: ivMul(a.v, b.v),
      g: a.g.map((c, k) => ivAdd(ivMul(c, b.v), ivMul(a.v, b.g[k]!))),
    }),
    div: (a, b) => {
      const v = ivDiv(a.v, b.v);
      const den = ivPowInt(b.v, 2);
      return {
        v,
        g: a.g.map((c, k) => ivDiv(ivSub(ivMul(c, b.v), ivMul(a.v, b.g[k]!)), den)),
      };
    },
    neg: (a) => ({ v: ivNeg(a.v), g: a.g.map(ivNeg) }),
    abs: (a) => {
      if (a.v.lo > 0) return { v: ivAbs(a.v), g: a.g };
      if (a.v.hi < 0) return { v: ivAbs(a.v), g: a.g.map(ivNeg) };
      return { v: ivAbs(a.v), g: wholes() }; // non-differentiable at 0
    },
    powInt: (a, n) => {
      if (n === 0) return dom.constant(1);
      if (n === 1) return a;
      const deriv = ivMul(pt(n), ivPowInt(a.v, n - 1));
      return chain(a, ivPowInt(a.v, n), deriv);
    },
    exp: (a) => {
      const v = ivExp(a.v);
      return chain(a, v, v);
    },
    log: (a) => ({ v: ivLog(a.v), g: a.g.map((c) => ivDiv(c, a.v)) }),
    sqrt: (a) => {
      const v = ivSqrt(a.v);
      return { v, g: a.g.map((c) => ivDiv(c, ivMul(pt(2), v))) };
    },
    sin: (a) => chain(a, ivSin(a.v), ivCos(a.v)),
    cos: (a) => chain(a, ivCos(a.v), ivNeg(ivSin(a.v))),
    tan: (a) => {
      const v = ivTan(a.v);
      return chain(a, v, ivAdd(one, ivPowInt(v, 2)));
    },
    atan: (a) => chain(a, ivAtan(a.v), ivDiv(one, ivAdd(one, ivPowInt(a.v, 2)))),
    tanh: (a) => {
      const v = ivTanh(a.v);
      return chain(a, v, ivSub(one, ivPowInt(v, 2)));
    },
    min: (a, b) => {
      if (a.v.hi <= b.v.lo) return a;
      if (b.v.hi <= a.v.lo) return b;
      return { v: new Interval(Math.min(a.v.lo, b.v.lo), Math.min(a.v.hi, b.v.hi)), g: wholes() };
    },
    max: (a, b) => {
      if (a.v.lo >= b.v.hi) return a;
      if (b.v.lo >= a.v.hi) return b;
      return { v: new Interval(Math.max(a.v.lo, b.v.lo), Math.max(a.v.hi, b.v.hi)), g: wholes() };
    },
    // Undecided `if`: the function may be discontinuous, so the gradient is unbounded.
    join: (a, b) => ({
      v: new Interval(Math.min(a.v.lo, b.v.lo), Math.max(a.v.hi, b.v.hi)),
      g: wholes(),
    }),
  };
  return dom;
}

export interface CompiledDae {
  dae: DaeSystem;
  stateNames: string[];
  algebraicNames: string[];
  /** Bounds used for parameters / inputs (by name). */
  fixedBounds: Map<string, Interval>;
}

export type CompileResult = { ok: true; compiled: CompiledDae } | { ok: false; reason: string };

/**
 * Compiles a flattened arena into a semi-explicit DAE with interval hooks.
 * Returns `{ ok: false }` (never a guess) when the system is not in semi-explicit form.
 */
export function compileArenaToDae(arena: DAEBuilder): CompileResult {
  const containsDer = (id: number): boolean => {
    if (id < 0) return false;
    const kind = arena.getExprKind(id);
    switch (kind) {
      case ExprKind.Der:
        return true;
      case ExprKind.Binary:
        return containsDer(arena.getExprLeft(id)) || containsDer(arena.getExprRight(id));
      case ExprKind.Unary:
      case ExprKind.Negate:
        return containsDer(arena.getExprLeft(id));
      case ExprKind.IfElse:
        return (
          containsDer(arena.getExprData1(id)) ||
          containsDer(arena.getExprLeft(id)) ||
          containsDer(arena.getExprRight(id))
        );
      case ExprKind.Call: {
        const n = arena.getExprRight(id);
        for (let k = 0; k < n; k++) if (containsDer(arena.getExprLeft(id + k))) return true;
        return false;
      }
      default:
        return false;
    }
  };
  const derTarget = (id: number): number => {
    if (id < 0 || arena.getExprKind(id) !== ExprKind.Der) return -1;
    const inner = arena.getExprData1(id);
    if (inner < 0 || arena.getExprKind(inner) !== ExprKind.Name) return -1;
    const nameId = arena.getExprData1(inner);
    let idx = arena.lookupVariable(nameId);
    if (idx < 0) idx = arena.getVarIdxByName(arena.interner.resolve(nameId) ?? "");
    return idx;
  };

  const stateIdx: number[] = [];
  const stateRhs: number[] = [];
  const algLhs: number[] = [];
  const algRhs: number[] = [];

  for (let e = 0; e < arena.eqCount; e++) {
    if (arena.getEqKind(e) !== EqKind.Simple) {
      return {
        ok: false,
        reason: `Equation ${e} is not a simple equation (arrays/for/if/when need flattening first).`,
      };
    }
    const lhs = arena.getEqLhs(e);
    const rhs = arena.getEqRhs(e);
    const lt = derTarget(lhs);
    const rt = derTarget(rhs);
    if (lt >= 0 && !containsDer(rhs)) {
      stateIdx.push(lt);
      stateRhs.push(rhs);
    } else if (rt >= 0 && !containsDer(lhs)) {
      stateIdx.push(rt);
      stateRhs.push(lhs);
    } else if (containsDer(lhs) || containsDer(rhs)) {
      return { ok: false, reason: `Equation ${e} is implicit in der(); only der(x) = f(...) is supported.` };
    } else {
      algLhs.push(lhs);
      algRhs.push(rhs);
    }
  }
  if (new Set(stateIdx).size !== stateIdx.length) {
    return { ok: false, reason: "A state has more than one defining der() equation." };
  }

  const evaluator = new DaeIntervalEvaluator(arena);
  const fixed = new Map<number, Interval>();
  const fixedBounds = new Map<string, Interval>();
  const algIdx: number[] = [];
  const stateSet = new Set(stateIdx);
  for (let i = 0; i < arena.varCount; i++) {
    if (stateSet.has(i)) continue;
    const variability = arena.getVarVariability(i);
    const isFixed =
      variability === Variability.Parameter ||
      variability === Variability.Constant ||
      arena.getVarCausality(i) === Causality.Input;
    if (isFixed) {
      const b = evaluator.getVarBound(i);
      const iv = b.isBottom() ? WHOLE_LINE() : new Interval(b.low, b.high);
      fixed.set(i, iv);
      fixedBounds.set(arena.getVarName(i), iv);
    } else if (variability === Variability.Continuous) {
      algIdx.push(i);
    }
  }
  if (algIdx.length !== algLhs.length) {
    return {
      ok: false,
      reason: `Not square: ${algIdx.length} algebraic unknown(s) vs ${algLhs.length} algebraic equation(s) (needs BLT/Pantelides first).`,
    };
  }

  const stateSlot = new Map(stateIdx.map((v, k) => [v, k]));
  const algSlot = new Map(algIdx.map((v, k) => [v, k]));
  const nx = stateIdx.length;
  const m = algIdx.length;

  const makeEnv = (x: Interval[], z: Interval[]) => ({
    variable: (idx: number): Interval | undefined => {
      const s = stateSlot.get(idx);
      if (s !== undefined) return x[s];
      const a = algSlot.get(idx);
      if (a !== undefined) return z[a];
      return fixed.get(idx);
    },
  });
  const evalIv = (id: number, x: Interval[], z: Interval[]): Interval =>
    evalArenaExpr(arena, id, makeEnv(x, z), IntervalDomain).value;

  const dualDomain = createDualDomain(m);
  const evalDual = (id: number, x: Interval[], z: Interval[]): IntervalDual =>
    evalArenaExpr(
      arena,
      id,
      {
        variable: (idx): IntervalDual | undefined => {
          const s = stateSlot.get(idx);
          if (s !== undefined) return { v: x[s]!, g: Array.from({ length: m }, () => pt(0)) };
          const a = algSlot.get(idx);
          if (a !== undefined) return { v: z[a]!, g: Array.from({ length: m }, (_, k) => pt(k === a ? 1 : 0)) };
          const f = fixed.get(idx);
          return f ? { v: f, g: Array.from({ length: m }, () => pt(0)) } : undefined;
        },
      },
      dualDomain,
    ).value;

  const mid = (iv: Interval): number => iv.lo + 0.5 * (iv.hi - iv.lo);
  const pts = (v: number[]): Interval[] => v.map(pt);

  const dae: DaeSystem = {
    numDiffStates: nx,
    numAlgStates: m,
    f: (_t, x, z) => stateRhs.map((id) => mid(evalIv(id, pts(x), pts(z)))),
    g: (x, z) => algLhs.map((l, k) => mid(ivSub(evalIv(l, pts(x), pts(z)), evalIv(algRhs[k]!, pts(x), pts(z))))),
    jacobianGz: (x, z) =>
      algLhs.map((l, k) => {
        const d = dualDomain.sub(evalDual(l, pts(x), pts(z)), evalDual(algRhs[k]!, pts(x), pts(z)));
        return d.g.map(mid);
      }),
    fInterval: (_t, x, z) => stateRhs.map((id) => evalIv(id, x, z)),
    gInterval: (x, z) => algLhs.map((l, k) => ivSub(evalIv(l, x, z), evalIv(algRhs[k]!, x, z))),
    jacobianGzInterval: (x, z) => algLhs.map((l, k) => dualDomain.sub(evalDual(l, x, z), evalDual(algRhs[k]!, x, z)).g),
  };

  return {
    ok: true,
    compiled: {
      dae,
      stateNames: stateIdx.map((i) => arena.getVarName(i)),
      algebraicNames: algIdx.map((i) => arena.getVarName(i)),
      fixedBounds,
    },
  };
}
