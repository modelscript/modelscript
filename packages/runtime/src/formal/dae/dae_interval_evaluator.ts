// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Linear-Memory DAE Expression & Interval Evaluator.
 *
 * Implements sound interval propagation and affine arithmetic (1D zonotopes)
 * directly over DAEBuilder's struct-of-arrays linear memory expressions.
 * Detects mathematical domain violations (division by zero, negative radicands,
 * non-positive logarithms) and physical invariant breaches (min/max bound violations).
 */

import { BinOp, DAEBuilder, EqKind, ExprKind, UnaryOp, Variability } from "../../dae/wasm_dae.js";
import { NumericalInterval } from "../abstract_interpretation/interval_domain.js";

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
  varIdx?: number;
  varName?: string;
  eqIdx?: number;
  message: string;
  interval: NumericalInterval;
}

export interface DaeEvaluatorOptions {
  /** Explicit bounds mapped by variable index (0 .. varCount-1) */
  varBounds?: Map<number, NumericalInterval>;
  /** Explicit bounds mapped by variable name */
  varBoundsByName?: Map<string, NumericalInterval>;
  /** Pre-allocated noise symbol indices for affine arithmetic */
  noiseSymbols?: Map<number, number>;
  /** Check if evaluated bounds violate Modelica min/max attributes */
  checkAttributes?: boolean;
}

export interface DaeEvaluationResult {
  interval: NumericalInterval;
  affine?: AffineForm;
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
  private noiseSymbols: Map<number, number>;
  private nextNoiseSymbol = 1;
  private checkAttributes: boolean;

  constructor(
    public readonly arena: DAEBuilder,
    options: DaeEvaluatorOptions = {},
  ) {
    this.varBounds = options.varBounds ? new Map(options.varBounds) : new Map();
    this.varBoundsByName = options.varBoundsByName ? new Map(options.varBoundsByName) : new Map();
    this.noiseSymbols = options.noiseSymbols ? new Map(options.noiseSymbols) : new Map();
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
      const startVal = this.arena.getVarStartValue(varIdx);
      if (Number.isFinite(startVal)) {
        const b = NumericalInterval.const(startVal);
        this.varBounds.set(varIdx, b);
        return b;
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

    // 4. Fallback to start value if finite
    const start = this.arena.getVarStartValue(varIdx);
    if (Number.isFinite(start)) {
      const b = NumericalInterval.const(start);
      this.varBounds.set(varIdx, b);
      return b;
    }

    return NumericalInterval.TOP;
  }

  /**
   * Allocates a noise symbol for a variable for affine arithmetic.
   */
  private getNoiseSymbol(varIdx: number): number {
    let sym = this.noiseSymbols.get(varIdx);
    if (sym === undefined) {
      sym = this.nextNoiseSymbol++;
      this.noiseSymbols.set(varIdx, sym);
    }
    return sym;
  }

  /**
   * Evaluates an arbitrary DAE expression in arena linear memory.
   */
  public evaluateExpr(exprId: number, localEnv?: Map<number, NumericalInterval>): DaeEvaluationResult {
    const issues: DaeSingularityIssue[] = [];

    if (exprId < 0) {
      return { interval: NumericalInterval.BOTTOM, issues };
    }

    const kind = this.arena.getExprKind(exprId);

    switch (kind) {
      case ExprKind.RealLiteral: {
        const val = this.arena.getExprRealValue(exprId);
        return {
          interval: NumericalInterval.const(val),
          affine: AffineForm.constant(val),
          issues,
        };
      }

      case ExprKind.IntLiteral: {
        const val = this.arena.getExprData1(exprId);
        return {
          interval: NumericalInterval.const(val),
          affine: AffineForm.constant(val),
          issues,
        };
      }

      case ExprKind.BoolLiteral: {
        const val = this.arena.getExprData1(exprId);
        return {
          interval: NumericalInterval.const(val),
          affine: AffineForm.constant(val),
          issues,
        };
      }

      case ExprKind.Name: {
        const nameId = this.arena.getExprData1(exprId);
        let varIdx = this.arena.lookupVariable(nameId);
        let nameStr = this.arena.interner.resolve(nameId);

        if (varIdx < 0 && nameStr) {
          varIdx = this.arena.getVarIdxByName(nameStr);
        }

        let bound: NumericalInterval;
        if (localEnv && varIdx >= 0 && localEnv.has(varIdx)) {
          bound = localEnv.get(varIdx)!;
        } else if (varIdx >= 0) {
          bound = this.getVarBound(varIdx);
        } else {
          bound = NumericalInterval.TOP;
        }

        let affine: AffineForm | undefined;
        if (varIdx >= 0) {
          const sym = this.getNoiseSymbol(varIdx);
          affine = AffineForm.fromInterval(bound, sym);
        }

        // Check if variable violates its own declared min/max attribute
        if (this.checkAttributes && varIdx >= 0) {
          this.validateVarAttributes(varIdx, nameStr ?? `var_${varIdx}`, bound, exprId, issues);
        }

        return { interval: bound, affine, issues };
      }

      case ExprKind.Unary: {
        const op = this.arena.getExprData1(exprId) as UnaryOp;
        const operandExpr = this.arena.getExprLeft(exprId);
        const sub = this.evaluateExpr(operandExpr, localEnv);
        issues.push(...sub.issues);

        if (op === UnaryOp.Negate) {
          return {
            interval: sub.interval.neg(),
            affine: sub.affine?.neg(),
            issues,
          };
        } else if (op === UnaryOp.Not) {
          if (sub.interval.isConstant()) {
            const v = sub.interval.low === 0 ? 1 : 0;
            return {
              interval: NumericalInterval.const(v),
              affine: AffineForm.constant(v),
              issues,
            };
          }
          return { interval: new NumericalInterval(0, 1), issues };
        }
        return { interval: sub.interval, affine: sub.affine, issues };
      }

      case ExprKind.Negate: {
        const operandExpr = this.arena.getExprLeft(exprId);
        const sub = this.evaluateExpr(operandExpr, localEnv);
        issues.push(...sub.issues);
        return {
          interval: sub.interval.neg(),
          affine: sub.affine?.neg(),
          issues,
        };
      }

      case ExprKind.Binary: {
        const op = this.arena.getExprData1(exprId) as BinOp;
        const leftExpr = this.arena.getExprLeft(exprId);
        const rightExpr = this.arena.getExprRight(exprId);

        const leftRes = this.evaluateExpr(leftExpr, localEnv);
        const rightRes = this.evaluateExpr(rightExpr, localEnv);
        issues.push(...leftRes.issues, ...rightRes.issues);

        switch (op) {
          case BinOp.Add:
          case BinOp.ElemAdd: {
            const intVal = leftRes.interval.add(rightRes.interval);
            const affVal = leftRes.affine && rightRes.affine ? leftRes.affine.add(rightRes.affine) : undefined;
            const combined = affVal ? intVal.meet(affVal.toInterval()) : intVal;
            return { interval: combined, affine: affVal, issues };
          }

          case BinOp.Sub:
          case BinOp.ElemSub: {
            const intVal = leftRes.interval.sub(rightRes.interval);
            const affVal = leftRes.affine && rightRes.affine ? leftRes.affine.sub(rightRes.affine) : undefined;
            const combined = affVal ? intVal.meet(affVal.toInterval()) : intVal;
            return { interval: combined, affine: affVal, issues };
          }

          case BinOp.Mul:
          case BinOp.ElemMul: {
            const intVal = leftRes.interval.mul(rightRes.interval);
            const affVal = leftRes.affine && rightRes.affine ? leftRes.affine.mul(rightRes.affine) : undefined;
            const combined = affVal ? intVal.meet(affVal.toInterval()) : intVal;
            return { interval: combined, affine: affVal, issues };
          }

          case BinOp.Div:
          case BinOp.ElemDiv: {
            const divRes = leftRes.interval.div(rightRes.interval);
            if (divRes.divisionByZero === "definite") {
              issues.push({
                kind: "div_by_zero",
                severity: "definite",
                exprId,
                message: `Definite division by zero in equation expression: denominator is [0, 0].`,
                interval: rightRes.interval,
              });
            } else if (divRes.divisionByZero === "possible") {
              issues.push({
                kind: "div_by_zero",
                severity: "possible",
                exprId,
                message: `Possible division by zero: denominator interval [${rightRes.interval.low}, ${rightRes.interval.high}] contains 0.`,
                interval: rightRes.interval,
              });
            }
            return { interval: divRes.result, issues };
          }

          case BinOp.Pow:
          case BinOp.ElemPow: {
            let exponent = 0;
            if (rightRes.interval.isConstant()) {
              exponent = rightRes.interval.low;
              const powRes = leftRes.interval.pow(exponent);
              if (powRes.domainViolation === "definite") {
                issues.push({
                  kind: "pow_domain_violation",
                  severity: "definite",
                  exprId,
                  message: `Definite power domain violation: base [${leftRes.interval.low}, ${leftRes.interval.high}] with non-integer power ${exponent}.`,
                  interval: leftRes.interval,
                });
              } else if (powRes.domainViolation === "possible") {
                issues.push({
                  kind: "pow_domain_violation",
                  severity: "possible",
                  exprId,
                  message: `Possible power domain violation: base [${leftRes.interval.low}, ${leftRes.interval.high}] contains negative values.`,
                  interval: leftRes.interval,
                });
              }
              return { interval: powRes.result, issues };
            }

            // Exponent is an interval
            if (leftRes.interval.low > 0) {
              const logLeft = leftRes.interval.log();
              const mul = rightRes.interval.mul(logLeft.result);
              return { interval: mul.exp(), issues };
            } else {
              issues.push({
                kind: "pow_domain_violation",
                severity: leftRes.interval.high <= 0 ? "definite" : "possible",
                exprId,
                message: `Power domain violation: base [${leftRes.interval.low}, ${leftRes.interval.high}] is non-positive with interval exponent.`,
                interval: leftRes.interval,
              });
              return { interval: NumericalInterval.TOP, issues };
            }
          }

          case BinOp.Lt: {
            if (leftRes.interval.high < rightRes.interval.low) {
              return { interval: NumericalInterval.ONE, affine: AffineForm.constant(1), issues };
            }
            if (leftRes.interval.low >= rightRes.interval.high) {
              return { interval: NumericalInterval.ZERO, affine: AffineForm.constant(0), issues };
            }
            return { interval: new NumericalInterval(0, 1), issues };
          }

          case BinOp.Lte: {
            if (leftRes.interval.high <= rightRes.interval.low) {
              return { interval: NumericalInterval.ONE, affine: AffineForm.constant(1), issues };
            }
            if (leftRes.interval.low > rightRes.interval.high) {
              return { interval: NumericalInterval.ZERO, affine: AffineForm.constant(0), issues };
            }
            return { interval: new NumericalInterval(0, 1), issues };
          }

          case BinOp.Gt: {
            if (leftRes.interval.low > rightRes.interval.high) {
              return { interval: NumericalInterval.ONE, affine: AffineForm.constant(1), issues };
            }
            if (leftRes.interval.high <= rightRes.interval.low) {
              return { interval: NumericalInterval.ZERO, affine: AffineForm.constant(0), issues };
            }
            return { interval: new NumericalInterval(0, 1), issues };
          }

          case BinOp.Gte: {
            if (leftRes.interval.low >= rightRes.interval.high) {
              return { interval: NumericalInterval.ONE, affine: AffineForm.constant(1), issues };
            }
            if (leftRes.interval.high < rightRes.interval.low) {
              return { interval: NumericalInterval.ZERO, affine: AffineForm.constant(0), issues };
            }
            return { interval: new NumericalInterval(0, 1), issues };
          }

          case BinOp.Eq: {
            if (
              leftRes.interval.isConstant() &&
              rightRes.interval.isConstant() &&
              leftRes.interval.low === rightRes.interval.low
            ) {
              return { interval: NumericalInterval.ONE, affine: AffineForm.constant(1), issues };
            }
            if (leftRes.interval.high < rightRes.interval.low || leftRes.interval.low > rightRes.interval.high) {
              return { interval: NumericalInterval.ZERO, affine: AffineForm.constant(0), issues };
            }
            return { interval: new NumericalInterval(0, 1), issues };
          }

          case BinOp.Neq: {
            if (leftRes.interval.high < rightRes.interval.low || leftRes.interval.low > rightRes.interval.high) {
              return { interval: NumericalInterval.ONE, affine: AffineForm.constant(1), issues };
            }
            if (
              leftRes.interval.isConstant() &&
              rightRes.interval.isConstant() &&
              leftRes.interval.low === rightRes.interval.low
            ) {
              return { interval: NumericalInterval.ZERO, affine: AffineForm.constant(0), issues };
            }
            return { interval: new NumericalInterval(0, 1), issues };
          }

          default:
            return { interval: NumericalInterval.TOP, issues };
        }
      }

      case ExprKind.Call: {
        const nameId = this.arena.getExprData1(exprId);
        const funcName = this.arena.interner.resolve(nameId)?.toLowerCase() ?? "";
        const firstArgId = this.arena.getExprLeft(exprId);
        const argCount = this.arena.getExprRight(exprId);

        const argRes = this.evaluateExpr(firstArgId, localEnv);
        issues.push(...argRes.issues);

        switch (funcName) {
          case "sqrt": {
            const sqrtRes = argRes.interval.sqrt();
            if (sqrtRes.domainViolation === "definite") {
              issues.push({
                kind: "sqrt_negative",
                severity: "definite",
                exprId,
                message: `Definite domain violation in sqrt(): radicand interval [${argRes.interval.low}, ${argRes.interval.high}] is strictly negative.`,
                interval: argRes.interval,
              });
            } else if (sqrtRes.domainViolation === "possible") {
              issues.push({
                kind: "sqrt_negative",
                severity: "possible",
                exprId,
                message: `Possible domain violation in sqrt(): radicand interval [${argRes.interval.low}, ${argRes.interval.high}] contains negative values.`,
                interval: argRes.interval,
              });
            }
            return { interval: sqrtRes.result, issues };
          }

          case "exp":
            return { interval: argRes.interval.exp(), issues };

          case "log":
          case "ln": {
            const logRes = argRes.interval.log();
            if (logRes.domainViolation === "definite") {
              issues.push({
                kind: "log_nonpositive",
                severity: "definite",
                exprId,
                message: `Definite domain violation in log(): argument interval [${argRes.interval.low}, ${argRes.interval.high}] is non-positive.`,
                interval: argRes.interval,
              });
            } else if (logRes.domainViolation === "possible") {
              issues.push({
                kind: "log_nonpositive",
                severity: "possible",
                exprId,
                message: `Possible domain violation in log(): argument interval [${argRes.interval.low}, ${argRes.interval.high}] contains values <= 0.`,
                interval: argRes.interval,
              });
            }
            return { interval: logRes.result, issues };
          }

          case "sin":
            return { interval: argRes.interval.sin(), issues };

          case "cos":
            return { interval: argRes.interval.cos(), issues };

          case "tan": {
            const tanRes = argRes.interval.tan();
            if (tanRes.domainViolation === "definite") {
              issues.push({
                kind: "tan_singularity",
                severity: "definite",
                exprId,
                message: `Definite singularity in tan(): interval [${argRes.interval.low}, ${argRes.interval.high}] contains odd multiples of pi/2.`,
                interval: argRes.interval,
              });
            }
            return { interval: tanRes.result, issues };
          }

          case "abs":
            return { interval: argRes.interval.abs(), issues };

          case "smooth":
            // Pass-through regularized expression
            return { interval: argRes.interval, affine: argRes.affine, issues };

          case "min":
            if (argCount >= 2) {
              const secondArgId = this.arena.getExprLeft(exprId + 1);
              const secondRes = this.evaluateExpr(secondArgId, localEnv);
              issues.push(...secondRes.issues);
              const l = Math.min(argRes.interval.low, secondRes.interval.low);
              const h = Math.min(argRes.interval.high, secondRes.interval.high);
              return { interval: new NumericalInterval(l, h), issues };
            }
            return { interval: argRes.interval, issues };

          case "max":
            if (argCount >= 2) {
              const secondArgId = this.arena.getExprLeft(exprId + 1);
              const secondRes = this.evaluateExpr(secondArgId, localEnv);
              issues.push(...secondRes.issues);
              const l = Math.max(argRes.interval.low, secondRes.interval.low);
              const h = Math.max(argRes.interval.high, secondRes.interval.high);
              return { interval: new NumericalInterval(l, h), issues };
            }
            return { interval: argRes.interval, issues };

          case "sign":
            if (argRes.interval.isDefinitePositive()) return { interval: NumericalInterval.ONE, issues };
            if (argRes.interval.high < 0) return { interval: new NumericalInterval(-1, -1), issues };
            return { interval: new NumericalInterval(-1, 1), issues };

          default:
            return { interval: NumericalInterval.TOP, issues };
        }
      }

      case ExprKind.IfElse: {
        const condExpr = this.arena.getExprData1(exprId);
        const thenExpr = this.arena.getExprLeft(exprId);
        const elseExpr = this.arena.getExprRight(exprId);

        const condRes = this.evaluateExpr(condExpr, localEnv);
        issues.push(...condRes.issues);

        if (condRes.interval.isDefinitePositive()) {
          const thenRes = this.evaluateExpr(thenExpr, localEnv);
          issues.push(...thenRes.issues);
          return thenRes;
        } else if (condRes.interval.isDefiniteZero()) {
          const elseRes = this.evaluateExpr(elseExpr, localEnv);
          issues.push(...elseRes.issues);
          return elseRes;
        } else {
          const thenRes = this.evaluateExpr(thenExpr, localEnv);
          const elseRes = this.evaluateExpr(elseExpr, localEnv);
          issues.push(...thenRes.issues, ...elseRes.issues);
          return {
            interval: thenRes.interval.join(elseRes.interval),
            issues,
          };
        }
      }

      case ExprKind.Der: {
        // der(x): look up bounds for the derivative variable
        const innerExpr = this.arena.getExprData1(exprId);
        const innerRes = this.evaluateExpr(innerExpr, localEnv);
        issues.push(...innerRes.issues);
        return innerRes;
      }

      default:
        return { interval: NumericalInterval.TOP, issues };
    }
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

    const residualInterval = lhsRes.interval.sub(rhsRes.interval);
    const residualAffine = lhsRes.affine && rhsRes.affine ? lhsRes.affine.sub(rhsRes.affine) : undefined;

    return {
      lhs: lhsRes,
      rhs: rhsRes,
      residual: {
        interval: residualAffine ? residualInterval.meet(residualAffine.toInterval()) : residualInterval,
        affine: residualAffine,
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
