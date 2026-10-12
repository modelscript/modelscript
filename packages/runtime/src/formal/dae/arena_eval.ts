// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Domain-generic arena expression interpreter.
 *
 * `evalArenaExpr<T>` walks a DAEBuilder expression tree once, parameterised by an
 * {@link AbstractDomain} (outward-rounded intervals, affine forms, Taylor models, ...).
 * All domains therefore share ONE definition of the expression semantics, so a soundness
 * fix here benefits every verification method.
 *
 * Soundness conventions (differences from the legacy `DaeIntervalEvaluator`):
 *  - `der(x)` is NOT the bound of `x`; it is resolved through {@link ArenaEvalEnv.derivative}
 *    and is unbounded (TOP) when the environment does not supply it.
 *  - Unknown functions, array/record operations, and unsupported operators yield TOP.
 *  - Domain violations (sqrt/log of negatives, division by zero, tan poles) are reported as
 *    issues AND the result is widened, never silently clipped.
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
import { Interval } from "../../analysis/wasm_interval.js";
import { BinOp, DAEBuilder, ExprKind, UnaryOp } from "../../dae/wasm_dae.js";
import { NumericalInterval } from "../abstract_interpretation/interval_domain.js";
import type { DaeSingularityIssue } from "./dae_interval_evaluator.js";

/** Abstract domain over real-valued expressions. All operations must be sound enclosures. */
export interface AbstractDomain<T> {
  constant(v: number): T;
  fromInterval(iv: Interval): T;
  /** Sound interval hull of the abstract value. */
  toInterval(t: T): Interval;
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  div(a: T, b: T): T;
  neg(a: T): T;
  abs(a: T): T;
  /** Integer power, n >= 0. */
  powInt(a: T, n: number): T;
  exp(a: T): T;
  log(a: T): T;
  sqrt(a: T): T;
  sin(a: T): T;
  cos(a: T): T;
  tan(a: T): T;
  atan(a: T): T;
  tanh(a: T): T;
  min(a: T, b: T): T;
  max(a: T, b: T): T;
  /** Least upper bound (used to merge branches of `if`). */
  join(a: T, b: T): T;
}

export const WHOLE_LINE = (): Interval => new Interval(-Infinity, Infinity);

function sanitize(iv: Interval): Interval {
  return Number.isNaN(iv.lo) || Number.isNaN(iv.hi) ? WHOLE_LINE() : iv;
}

/** Sound interval domain built on the outward-rounded scalar kernel. */
export const IntervalDomain: AbstractDomain<Interval> = {
  constant: (v) => (Number.isFinite(v) ? new Interval(v, v) : WHOLE_LINE()),
  fromInterval: (iv) => new Interval(iv.lo, iv.hi),
  toInterval: (t) => t,
  add: ivAdd,
  sub: ivSub,
  mul: ivMul,
  div: ivDiv,
  neg: ivNeg,
  abs: ivAbs,
  powInt: ivPowInt,
  exp: ivExp,
  log: (a) => sanitize(ivLog(a)),
  sqrt: (a) => sanitize(ivSqrt(a)),
  sin: ivSin,
  cos: ivCos,
  tan: ivTan,
  atan: ivAtan,
  tanh: ivTanh,
  min: (a, b) => new Interval(Math.min(a.lo, b.lo), Math.min(a.hi, b.hi)),
  max: (a, b) => new Interval(Math.max(a.lo, b.lo), Math.max(a.hi, b.hi)),
  join: (a, b) => new Interval(Math.min(a.lo, b.lo), Math.max(a.hi, b.hi)),
};

/** Environment supplying values for variables. */
export interface ArenaEvalEnv<T> {
  /** Value of a variable (by arena index); return `undefined` for TOP. */
  variable(varIdx: number, name: string, exprId?: number): T | undefined;
  /** Value of der(x); `undefined` means unbounded. */
  derivative?(varIdx: number, name: string): T | undefined;
}

export interface ArenaEvalResult<T> {
  value: T;
  issues: DaeSingularityIssue[];
}

type Tri = "true" | "false" | "unknown";

function resolveVar(arena: DAEBuilder, nameId: number): { idx: number; name: string } {
  const name = arena.interner.resolve(nameId) ?? "";
  let idx = arena.lookupVariable(nameId);
  if (idx < 0 && name) idx = arena.getVarIdxByName(name);
  return { idx, name };
}

/**
 * Evaluate `exprId` in `domain` under `env`.
 */
export function evalArenaExpr<T>(
  arena: DAEBuilder,
  exprId: number,
  env: ArenaEvalEnv<T>,
  domain: AbstractDomain<T>,
): ArenaEvalResult<T> {
  const issues: DaeSingularityIssue[] = [];
  const top = (): T => domain.fromInterval(WHOLE_LINE());
  const unitInterval = (): T => domain.fromInterval(new Interval(0, 1));
  const fromTri = (t: Tri): T =>
    t === "true" ? domain.constant(1) : t === "false" ? domain.constant(0) : unitInterval();

  const report = (
    kind: DaeSingularityIssue["kind"],
    severity: DaeSingularityIssue["severity"],
    id: number,
    message: string,
    iv: Interval,
  ): void => {
    issues.push({ kind, severity, exprId: id, message, interval: new NumericalInterval(iv.lo, iv.hi) });
  };

  const truth = (iv: Interval): Tri => {
    if (iv.lo > 0 || iv.hi < 0) return "true";
    if (iv.lo === 0 && iv.hi === 0) return "false";
    return "unknown";
  };

  const go = (id: number): T => {
    if (id < 0) return top();
    const kind = arena.getExprKind(id);
    switch (kind) {
      case ExprKind.RealLiteral:
        return domain.constant(arena.getExprRealValue(id));
      case ExprKind.IntLiteral:
      case ExprKind.BoolLiteral:
        return domain.constant(arena.getExprData1(id));

      case ExprKind.Name: {
        const { idx, name } = resolveVar(arena, arena.getExprData1(id));
        if (idx < 0) return top();
        return env.variable(idx, name, id) ?? top();
      }

      case ExprKind.Unary: {
        const op = arena.getExprData1(id) as UnaryOp;
        const sub = go(arena.getExprLeft(id));
        if (op === UnaryOp.Negate) return domain.neg(sub);
        if (op === UnaryOp.Not) {
          const t = truth(domain.toInterval(sub));
          return fromTri(t === "true" ? "false" : t === "false" ? "true" : "unknown");
        }
        return top();
      }

      case ExprKind.Negate:
        return domain.neg(go(arena.getExprLeft(id)));

      case ExprKind.Binary:
        return binary(id);

      case ExprKind.Call:
        return call(id);

      case ExprKind.IfElse: {
        const cond = truth(domain.toInterval(go(arena.getExprData1(id))));
        const thenId = arena.getExprLeft(id);
        const elseId = arena.getExprRight(id);
        if (cond === "true") return go(thenId);
        if (cond === "false") return go(elseId);
        return domain.join(go(thenId), go(elseId));
      }

      case ExprKind.Der: {
        const inner = arena.getExprData1(id);
        if (inner >= 0 && arena.getExprKind(inner) === ExprKind.Name) {
          const { idx, name } = resolveVar(arena, arena.getExprData1(inner));
          if (idx >= 0) return env.derivative?.(idx, name) ?? top();
        }
        return top();
      }

      default:
        return top();
    }
  };

  const binary = (id: number): T => {
    const op = arena.getExprData1(id) as BinOp;
    const l = go(arena.getExprLeft(id));
    const r = go(arena.getExprRight(id));
    const li = domain.toInterval(l);
    const ri = domain.toInterval(r);
    switch (op) {
      case BinOp.Add:
      case BinOp.ElemAdd:
        return domain.add(l, r);
      case BinOp.Sub:
      case BinOp.ElemSub:
        return domain.sub(l, r);
      case BinOp.Mul:
      case BinOp.ElemMul:
        return domain.mul(l, r);
      case BinOp.Div:
      case BinOp.ElemDiv: {
        if (ri.lo === 0 && ri.hi === 0) {
          report("div_by_zero", "definite", id, `Definite division by zero: denominator is [0, 0].`, ri);
          return top();
        }
        if (ri.lo <= 0 && ri.hi >= 0) {
          report(
            "div_by_zero",
            "possible",
            id,
            `Possible division by zero: denominator interval [${ri.lo}, ${ri.hi}] contains 0.`,
            ri,
          );
          return top();
        }
        return domain.div(l, r);
      }
      case BinOp.Pow:
      case BinOp.ElemPow:
        return power(id, l, r, li, ri);

      case BinOp.Lt:
        return fromTri(li.hi < ri.lo ? "true" : li.lo >= ri.hi ? "false" : "unknown");
      case BinOp.Lte:
        return fromTri(li.hi <= ri.lo ? "true" : li.lo > ri.hi ? "false" : "unknown");
      case BinOp.Gt:
        return fromTri(li.lo > ri.hi ? "true" : li.hi <= ri.lo ? "false" : "unknown");
      case BinOp.Gte:
        return fromTri(li.lo >= ri.hi ? "true" : li.hi < ri.lo ? "false" : "unknown");
      case BinOp.Eq: {
        if (li.lo === li.hi && ri.lo === ri.hi && li.lo === ri.lo) return fromTri("true");
        return fromTri(li.hi < ri.lo || li.lo > ri.hi ? "false" : "unknown");
      }
      case BinOp.Neq: {
        if (li.hi < ri.lo || li.lo > ri.hi) return fromTri("true");
        return fromTri(li.lo === li.hi && ri.lo === ri.hi && li.lo === ri.lo ? "false" : "unknown");
      }
      case BinOp.And: {
        const a = truth(li);
        const b = truth(ri);
        return fromTri(a === "false" || b === "false" ? "false" : a === "true" && b === "true" ? "true" : "unknown");
      }
      case BinOp.Or: {
        const a = truth(li);
        const b = truth(ri);
        return fromTri(a === "true" || b === "true" ? "true" : a === "false" && b === "false" ? "false" : "unknown");
      }
      default:
        return top();
    }
  };

  const power = (id: number, l: T, r: T, li: Interval, ri: Interval): T => {
    if (ri.lo === ri.hi) {
      const y = ri.lo;
      if (Number.isInteger(y) && y >= 0 && y <= 64) return domain.powInt(l, y);
      if (Number.isInteger(y) && y < 0 && y >= -64) {
        const d = domain.toInterval(domain.powInt(l, -y));
        if (d.lo <= 0 && d.hi >= 0) {
          report("div_by_zero", "possible", id, `Possible division by zero: base [${li.lo}, ${li.hi}] contains 0.`, li);
          return top();
        }
        return domain.div(domain.constant(1), domain.powInt(l, -y));
      }
      if (y === 0.5) {
        if (li.hi < 0) report("pow_domain_violation", "definite", id, `Negative base with exponent 0.5.`, li);
        else if (li.lo < 0) report("pow_domain_violation", "possible", id, `Base may be negative.`, li);
        return li.lo < 0 ? top() : domain.sqrt(l);
      }
    }
    if (li.lo > 0) return domain.exp(domain.mul(r, domain.log(l)));
    report(
      "pow_domain_violation",
      li.hi <= 0 ? "definite" : "possible",
      id,
      `Power domain violation: base [${li.lo}, ${li.hi}] is not strictly positive for non-integer/interval exponent.`,
      li,
    );
    return top();
  };

  const call = (id: number): T => {
    const fname = arena.interner.resolve(arena.getExprData1(id))?.toLowerCase() ?? "";
    const argCount = arena.getExprRight(id);
    const a0 = go(arena.getExprLeft(id));
    const iv0 = domain.toInterval(a0);
    const a1 = (): T => go(arena.getExprLeft(id + 1));
    switch (fname) {
      case "sqrt":
        if (iv0.hi < 0) {
          report(
            "sqrt_negative",
            "definite",
            id,
            `Definite domain violation in sqrt(): radicand is strictly negative.`,
            iv0,
          );
          return top();
        }
        if (iv0.lo < 0) {
          report(
            "sqrt_negative",
            "possible",
            id,
            `Possible domain violation in sqrt(): radicand contains negatives.`,
            iv0,
          );
          return top();
        }
        return domain.sqrt(a0);
      case "exp":
        return domain.exp(a0);
      case "log":
      case "ln":
        if (iv0.hi <= 0) {
          report(
            "log_nonpositive",
            "definite",
            id,
            `Definite domain violation in log(): argument is non-positive.`,
            iv0,
          );
          return top();
        }
        if (iv0.lo <= 0) {
          report(
            "log_nonpositive",
            "possible",
            id,
            `Possible domain violation in log(): argument contains values <= 0.`,
            iv0,
          );
          return top();
        }
        return domain.log(a0);
      case "sin":
        return domain.sin(a0);
      case "cos":
        return domain.cos(a0);
      case "tan": {
        const t = domain.toInterval(domain.tan(a0));
        if (!Number.isFinite(t.lo) || !Number.isFinite(t.hi)) {
          report(
            "tan_singularity",
            "possible",
            id,
            `Possible singularity in tan(): interval may contain pi/2 + k*pi.`,
            iv0,
          );
          return top();
        }
        return domain.tan(a0);
      }
      case "atan":
        return domain.atan(a0);
      case "tanh":
        return domain.tanh(a0);
      case "abs":
        return domain.abs(a0);
      case "smooth":
        // smooth(p, expr): value is expr (second argument); a single argument is passed through.
        return argCount >= 2 ? a1() : a0;
      case "min":
        return argCount >= 2 ? domain.min(a0, a1()) : a0;
      case "max":
        return argCount >= 2 ? domain.max(a0, a1()) : a0;
      case "sign": {
        if (iv0.lo > 0) return domain.constant(1);
        if (iv0.hi < 0) return domain.constant(-1);
        if (iv0.lo === 0 && iv0.hi === 0) return domain.constant(0);
        return domain.fromInterval(new Interval(iv0.lo < 0 ? -1 : 0, iv0.hi > 0 ? 1 : 0));
      }
      default:
        return top();
    }
  };

  return { value: go(exprId), issues };
}
