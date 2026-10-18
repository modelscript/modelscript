// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Linear-Memory DAE Expression & Interval Evaluator.
 *
 * Implements sound interval propagation and affine arithmetic (1D zonotopes)
 * directly over DAEBuilder's struct-of-arrays linear memory expressions.
 * Detects mathematical domain violations (division by zero, negative radicands,
 * non-positive logarithms) and physical invariant breaches (min/max bound violations).
 */

import { ivSub } from "../../analysis/outward_rounding.js";
import { Interval } from "../../analysis/wasm_interval.js";
import { DAEBuilder, EqKind, ExprKind, Variability } from "../../dae/wasm_dae.js";
import { NumericalInterval } from "../abstract_interpretation/interval_domain.js";
import { Aff, createAffineDomain, type AffineDomain } from "./affine_domain.js";
import { evalArenaExpr, IntervalDomain, type ArenaEvalEnv } from "./arena_eval.js";

export type DaeSingularityKind =
  | "div_by_zero"
  | "sqrt_negative"
  | "log_nonpositive"
  | "tan_singularity"
  | "pow_domain_violation"
  | "min_bound_violation"
  | "max_bound_violation"
  | "state_jump_discontinuity"
  | "singular_algebraic_loop";

export interface DaeSingularityIssue {
  kind: DaeSingularityKind;
  severity: "definite" | "possible";
  exprId: number;
  varIdx?: number | undefined;
  varName?: string | undefined;
  eqIdx?: number | undefined;
  message: string;
  interval: NumericalInterval;
}

export interface DaeEvaluatorOptions {
  /** Explicit bounds mapped by variable index (0 .. varCount-1) */
  varBounds?: Map<number, NumericalInterval> | undefined;
  /** Explicit bounds mapped by variable name */
  varBoundsByName?: Map<string, NumericalInterval> | undefined;
  /** Pre-allocated noise symbol indices for affine arithmetic */
  noiseSymbols?: Map<number, number> | undefined;
  /** Check if evaluated bounds violate Modelica min/max attributes */
  checkAttributes?: boolean | undefined;
}

export interface DaeEvaluationResult {
  interval: NumericalInterval;
  affine?: AffineForm | undefined;
  /** Sound affine form (same value as `affine`, with rounding-safe error term). */
  aff?: Aff | undefined;
  issues: DaeSingularityIssue[];
}

/**
 * 1-dimensional Affine Form for scalar affine arithmetic (zonotope in R).
 * Represents: x = c0 + \sum_{i} c_i * \epsilon_i + r * \epsilon_new
 * where \epsilon_i \in [-1, 1] are shared noise symbols and r is the independent remainder bound.
 */
export class AffineForm {
  constructor(
    public readonly c0: number,
    public readonly terms: Map<number, number> = new Map(),
    public readonly r: number = 0,
  ) {}

  static fromInterval(iv: NumericalInterval, noiseSymbol: number): AffineForm {
    if (iv.isBottom() || iv.isTop()) {
      const mid = iv.isTop() ? 0 : (iv.low + iv.high) / 2;
      return new AffineForm(isNaN(mid) ? 0 : mid, new Map(), Infinity);
    }
    const mid = (iv.low + iv.high) / 2;
    const rad = (iv.high - iv.low) / 2;
    const terms = new Map<number, number>();
    if (rad > 0 && Number.isFinite(rad)) {
      terms.set(noiseSymbol, rad);
    }
    return new AffineForm(mid, terms, 0);
  }

  static constant(val: number): AffineForm {
    return new AffineForm(val, new Map(), 0);
  }

  toInterval(): NumericalInterval {
    if (this.r === Infinity || isNaN(this.c0)) return NumericalInterval.TOP;
    let rad = this.r;
    for (const coef of this.terms.values()) {
      rad += Math.abs(coef);
    }
    return new NumericalInterval(this.c0 - rad, this.c0 + rad);
  }

  add(other: AffineForm): AffineForm {
    const newTerms = new Map(this.terms);
    for (const [sym, coef] of other.terms) {
      newTerms.set(sym, (newTerms.get(sym) ?? 0) + coef);
    }
    return new AffineForm(this.c0 + other.c0, newTerms, this.r + other.r);
  }

  sub(other: AffineForm): AffineForm {
    const newTerms = new Map(this.terms);
    for (const [sym, coef] of other.terms) {
      newTerms.set(sym, (newTerms.get(sym) ?? 0) - coef);
    }
    return new AffineForm(this.c0 - other.c0, newTerms, this.r + other.r);
  }

  scale(k: number): AffineForm {
    const newTerms = new Map<number, number>();
    for (const [sym, coef] of this.terms) {
      newTerms.set(sym, coef * k);
    }
    return new AffineForm(this.c0 * k, newTerms, this.r * Math.abs(k));
  }

  neg(): AffineForm {
    return this.scale(-1);
  }

  mul(other: AffineForm): AffineForm {
    const newC0 = this.c0 * other.c0;
    const newTerms = new Map<number, number>();

    for (const [sym, coef] of this.terms) {
      newTerms.set(sym, (newTerms.get(sym) ?? 0) + other.c0 * coef);
    }
    for (const [sym, coef] of other.terms) {
      newTerms.set(sym, (newTerms.get(sym) ?? 0) + this.c0 * coef);
    }

    let radThis = this.r;
    for (const coef of this.terms.values()) radThis += Math.abs(coef);
    let radOther = other.r;
    for (const coef of other.terms.values()) radOther += Math.abs(coef);

    const remainder = radThis * radOther + Math.abs(this.c0) * other.r + Math.abs(other.c0) * this.r;
    return new AffineForm(newC0, newTerms, this.r * other.r + remainder);
  }
}

/**
 * Sound evaluator of DAEBuilder expressions over NumericalIntervals and AffineForms.
 */
export class DaeIntervalEvaluator {
  private varBounds: Map<number, NumericalInterval>;
  private varBoundsByName: Map<string, NumericalInterval>;
  private affineDomain: AffineDomain = createAffineDomain();
  private affineCache = new Map<number, { lo: number; hi: number; form: Aff }>();
  private checkAttributes: boolean;

  constructor(
    public readonly arena: DAEBuilder,
    options: DaeEvaluatorOptions = {},
  ) {
    this.varBounds = options.varBounds ? new Map(options.varBounds) : new Map();
    this.varBoundsByName = options.varBoundsByName ? new Map(options.varBoundsByName) : new Map();
    // `options.noiseSymbols` is accepted for API compatibility; noise symbols are now allocated
    // by the shared sound affine domain.
    this.checkAttributes = options.checkAttributes ?? true;
  }

  /**
   * Sets or updates the interval bounds for a variable by index.
   */
  public setVarBound(varIdx: number, bound: NumericalInterval): void {
    this.varBounds.set(varIdx, bound);
    const name = this.arena.getVarName(varIdx);
    if (name) {
      this.varBoundsByName.set(name, bound);
    }
  }

  /**
   * Sets or updates the interval bounds for a variable by name.
   */
  public setVarBoundByName(name: string, bound: NumericalInterval): void {
    this.varBoundsByName.set(name, bound);
    const idx = this.arena.getVarIdxByName(name);
    if (idx >= 0) {
      this.varBounds.set(idx, bound);
    }
  }

  /**
   * Retrieves the current interval bound for a variable, resolving from explicit bounds,
   * Modelica min/max attributes, or parameter/start values.
   */
  public getVarBound(varIdx: number): NumericalInterval {
    // 1. Explicit bound in map
    const explicit = this.varBounds.get(varIdx);
    if (explicit) return explicit;

    const name = this.arena.getVarName(varIdx);
    if (name && this.varBoundsByName.has(name)) {
      const b = this.varBoundsByName.get(name)!;
      this.varBounds.set(varIdx, b);
      return b;
    }

    // 2. Constants / Parameters with start or binding values
    const variability = this.arena.getVarVariability(varIdx);
    if (variability === Variability.Parameter || variability === Variability.Constant) {
      const bindingExpr = (this.arena as any).getVarBindingExpr?.(varIdx) ?? -1;
      if (bindingExpr >= 0) {
        const res = this.evaluateExpr(bindingExpr);
        if (!res.interval.isBottom()) {
          this.varBounds.set(varIdx, res.interval);
          return res.interval;
        }
      }
      // An unbound parameter with declared min/max ranges over that interval; the start value is
      // then only a nominal point inside it.
      const hasRange =
        (this.arena.getVarAttrExprId(varIdx, "min") ?? -1) >= 0 ||
        (this.arena.getVarAttrExprId(varIdx, "max") ?? -1) >= 0;
      // The start accessor defaults to 0.0 for "unset", so only a declared start attribute is trusted.
      const hasStart = (this.arena.getVarAttrExprId(varIdx, "start") ?? -1) >= 0;
      if (!hasRange && hasStart) {
        const startVal = this.arena.getVarStartValue(varIdx);
        if (Number.isFinite(startVal)) {
          const b = NumericalInterval.const(startVal);
          this.varBounds.set(varIdx, b);
          return b;
        }
      }
    }

    // 3. Inspect min/max attributes
    let low = -Infinity;
    let high = Infinity;

    const minExpr = this.arena.getVarAttrExprId(varIdx, "min");
    if (minExpr !== undefined && minExpr >= 0) {
      const kind = this.arena.getExprKind(minExpr);
      if (kind === ExprKind.RealLiteral) {
        low = this.arena.getExprRealValue(minExpr);
      } else if (kind === ExprKind.IntLiteral) {
        low = this.arena.getExprData1(minExpr);
      }
    }

    const maxExpr = this.arena.getVarAttrExprId(varIdx, "max");
    if (maxExpr !== undefined && maxExpr >= 0) {
      const kind = this.arena.getExprKind(maxExpr);
      if (kind === ExprKind.RealLiteral) {
        high = this.arena.getExprRealValue(maxExpr);
      } else if (kind === ExprKind.IntLiteral) {
        high = this.arena.getExprData1(maxExpr);
      }
    }

    if (low !== -Infinity || high !== Infinity) {
      const b = new NumericalInterval(low, high);
      this.varBounds.set(varIdx, b);
      return b;
    }

    // 4. No fallback to the start value: for a continuous/discrete variable `start` is only an
    //    initial guess, not an enclosure of its trajectory (soundness fix K3). Callers that know the
    //    initial set must supply it explicitly via varBounds.

    return NumericalInterval.TOP;
  }

  /**
   * Evaluates an arbitrary DAE expression in arena linear memory.
   */
  public evaluateExpr(exprId: number, localEnv?: Map<number, NumericalInterval>): DaeEvaluationResult {
    if (exprId < 0) {
      return { interval: NumericalInterval.BOTTOM, issues: [] };
    }
    const issues: DaeSingularityIssue[] = [];
    const whole = (): Interval => new Interval(-Infinity, Infinity);
    const boundOf = (varIdx: number): NumericalInterval => localEnv?.get(varIdx) ?? this.getVarBound(varIdx);
    const toIv = (b: NumericalInterval): Interval => (b.isBottom() ? whole() : new Interval(b.low, b.high));

    // Pass 1: outward-rounded interval semantics (shared interpreter), collects singularity issues.
    const ivEnv: ArenaEvalEnv<Interval> = {
      variable: (varIdx, name, eid) => {
        const b = boundOf(varIdx);
        if (this.checkAttributes) {
          this.validateVarAttributes(varIdx, name || `var_${varIdx}`, b, eid ?? exprId, issues);
        }
        return toIv(b);
      },
    };
    const ivRes = evalArenaExpr(this.arena, exprId, ivEnv, IntervalDomain);
    issues.push(...ivRes.issues);
    const ivHull = ivRes.value;
    let interval = new NumericalInterval(ivHull.lo, ivHull.hi);

    // Pass 2: sound affine arithmetic with one noise symbol per variable (shared across calls).
    const affEnv: ArenaEvalEnv<Aff> = {
      variable: (varIdx) => {
        const b = toIv(boundOf(varIdx));
        const hit = this.affineCache.get(varIdx);
        if (hit && hit.lo === b.lo && hit.hi === b.hi) return hit.form;
        const form = this.affineDomain.fresh(b);
        this.affineCache.set(varIdx, { lo: b.lo, hi: b.hi, form });
        return form;
      },
    };
    const affRes = evalArenaExpr(this.arena, exprId, affEnv, this.affineDomain);
    const aff = affRes.value;
    const affHull = this.affineDomain.toInterval(aff);
    const met = interval.meet(new NumericalInterval(affHull.lo, affHull.hi));
    if (!met.isBottom()) interval = met;

    const terms = new Map<number, number>(aff.terms);
    const affine = aff.isTop ? undefined : new AffineForm(aff.c, terms, aff.err);
    return { interval, affine, aff, issues };
  }

  /**
   * Validates if a variable interval exceeds Modelica min or max attributes.
   */
  private validateVarAttributes(
    varIdx: number,
    varName: string,
    interval: NumericalInterval,
    exprId: number,
    issues: DaeSingularityIssue[],
  ): void {
    const minExpr = this.arena.getVarAttrExprId(varIdx, "min");
    if (minExpr !== undefined && minExpr >= 0) {
      let minVal = -Infinity;
      const k = this.arena.getExprKind(minExpr);
      if (k === ExprKind.RealLiteral) minVal = this.arena.getExprRealValue(minExpr);
      else if (k === ExprKind.IntLiteral) minVal = this.arena.getExprData1(minExpr);

      if (Number.isFinite(minVal)) {
        if (interval.high < minVal) {
          issues.push({
            kind: "min_bound_violation",
            severity: "definite",
            exprId,
            varIdx,
            varName,
            message: `Definite physical invariant breach: variable '${varName}' interval [${interval.low}, ${interval.high}] is strictly below min attribute ${minVal}.`,
            interval,
          });
        } else if (interval.low < minVal) {
          issues.push({
            kind: "min_bound_violation",
            severity: "possible",
            exprId,
            varIdx,
            varName,
            message: `Possible physical invariant breach: variable '${varName}' interval [${interval.low}, ${interval.high}] extends below min attribute ${minVal}.`,
            interval,
          });
        }
      }
    }

    const maxExpr = this.arena.getVarAttrExprId(varIdx, "max");
    if (maxExpr !== undefined && maxExpr >= 0) {
      let maxVal = Infinity;
      const k = this.arena.getExprKind(maxExpr);
      if (k === ExprKind.RealLiteral) maxVal = this.arena.getExprRealValue(maxExpr);
      else if (k === ExprKind.IntLiteral) maxVal = this.arena.getExprData1(maxExpr);

      if (Number.isFinite(maxVal)) {
        if (interval.low > maxVal) {
          issues.push({
            kind: "max_bound_violation",
            severity: "definite",
            exprId,
            varIdx,
            varName,
            message: `Definite physical invariant breach: variable '${varName}' interval [${interval.low}, ${interval.high}] is strictly above max attribute ${maxVal}.`,
            interval,
          });
        } else if (interval.high > maxVal) {
          issues.push({
            kind: "max_bound_violation",
            severity: "possible",
            exprId,
            varIdx,
            varName,
            message: `Possible physical invariant breach: variable '${varName}' interval [${interval.low}, ${interval.high}] extends above max attribute ${maxVal}.`,
            interval,
          });
        }
      }
    }
  }

  /**
   * Evaluates an equation (lhs = rhs) and computes its residual (lhs - rhs).
   */
  public evaluateEquation(
    eqIdx: number,
    localEnv?: Map<number, NumericalInterval>,
  ): {
    lhs: DaeEvaluationResult;
    rhs: DaeEvaluationResult;
    residual: DaeEvaluationResult;
    issues: DaeSingularityIssue[];
  } {
    const issues: DaeSingularityIssue[] = [];
    const lhsExpr = this.arena.getEqLhs(eqIdx);
    const rhsExpr = this.arena.getEqRhs(eqIdx);

    const lhsRes = this.evaluateExpr(lhsExpr, localEnv);
    const rhsRes = this.evaluateExpr(rhsExpr, localEnv);

    // Tag issues with this equation index
    for (const issue of lhsRes.issues) {
      issue.eqIdx = eqIdx;
      issues.push(issue);
    }
    for (const issue of rhsRes.issues) {
      issue.eqIdx = eqIdx;
      issues.push(issue);
    }

    const rIv = ivSub(
      new Interval(lhsRes.interval.low, lhsRes.interval.high),
      new Interval(rhsRes.interval.low, rhsRes.interval.high),
    );
    const residualInterval =
      lhsRes.interval.isBottom() || rhsRes.interval.isBottom()
        ? NumericalInterval.BOTTOM
        : new NumericalInterval(rIv.lo, rIv.hi);
    const residualAff = lhsRes.aff && rhsRes.aff ? this.affineDomain.sub(lhsRes.aff, rhsRes.aff) : undefined;
    let residualMeet = residualInterval;
    let residualAffine: AffineForm | undefined;
    if (residualAff && !residualAff.isTop) {
      const h = this.affineDomain.toInterval(residualAff);
      const m = residualInterval.meet(new NumericalInterval(h.lo, h.hi));
      if (!m.isBottom()) residualMeet = m;
      residualAffine = new AffineForm(residualAff.c, new Map(residualAff.terms), residualAff.err);
    }

    return {
      lhs: lhsRes,
      rhs: rhsRes,
      residual: {
        interval: residualMeet,
        affine: residualAffine,
        aff: residualAff,
        issues: [],
      },
      issues,
    };
  }

  /**
   * Evaluates all equations in the DAEBuilder and collects all detected issues.
   */
  public evaluateAllEquations(): {
    issues: DaeSingularityIssue[];
    equationResiduals: Map<number, NumericalInterval>;
  } {
    const allIssues: DaeSingularityIssue[] = [];
    const equationResiduals = new Map<number, NumericalInterval>();

    for (let eqIdx = 0; eqIdx < this.arena.eqCount; eqIdx++) {
      const eqKind = this.arena.getEqKind(eqIdx);
      if (eqKind !== EqKind.Simple && eqKind !== EqKind.InitialSimple) continue;

      const res = this.evaluateEquation(eqIdx);
      equationResiduals.set(eqIdx, res.residual.interval);
      allIssues.push(...res.issues);
    }

    return { issues: allIssues, equationResiduals };
  }
}
