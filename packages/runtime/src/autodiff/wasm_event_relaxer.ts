// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parameter-Annealed Sigmoidal Event & Switch Relaxer for DAE Arenas.
 *
 * Transforms non-smooth, discontinuous expressions (if-then-else, abs, sign, max, min)
 * into infinitely differentiable (C^inf) smooth relaxations using parameter-annealed
 * hyperbolic tangent and logistic sigmoidal blends.
 *
 * Why this is necessary:
 *   Standard automatic differentiation and adjoint sensitivity fail across hard step
 *   functions because the subgradient is zero almost everywhere and undefined at the
 *   switching boundary. Sigmoidal relaxation opens smooth gradient flow channels,
 *   allowing gradient descent to pull parameters across discrete physical thresholds.
 */

import { BinOp, DAEBuilder, EqKind, ExprKind } from "../dae/wasm_dae.js";

export interface EventRelaxerOptions {
  /**
   * Stiffness / temperature parameter k > 0.
   * Default: 50.0.
   * - Lower values (e.g. 5-20): broad, smooth transitions; convex optimization landscape.
   * - Higher values (e.g. 100-1000): sharp transitions; closely mimics true discontinuous step.
   */
  smoothness?: number;

  /** Relax if-then-else expressions: if (c) then a else b -> sigma(c)*a + (1-sigma(c))*b. Default: true. */
  relaxIfElse?: boolean;

  /** Relax abs(x) -> sqrt(x^2 + 1/k^2). Default: true. */
  relaxAbs?: boolean;

  /** Relax sign(x) -> tanh(k*x). Default: true. */
  relaxSign?: boolean;

  /** Relax max(a, b) and min(a, b) -> smooth softmax/softmin. Default: true. */
  relaxMaxMin?: boolean;
}

export class DAEEventRelaxer {
  private k: number;
  private options: Required<EventRelaxerOptions>;
  private cache = new Map<number, number>();

  constructor(
    public arena: DAEBuilder,
    options?: EventRelaxerOptions,
  ) {
    this.k = options?.smoothness ?? 50.0;
    this.options = {
      smoothness: this.k,
      relaxIfElse: options?.relaxIfElse ?? true,
      relaxAbs: options?.relaxAbs ?? true,
      relaxSign: options?.relaxSign ?? true,
      relaxMaxMin: options?.relaxMaxMin ?? true,
    };
  }

  /**
   * Rewrites all equations in the DAEBuilder in-place to use differentiable smooth relaxations.
   */
  public relaxAllEquations(): void {
    const numEqs = this.arena.eqCount;
    for (let eqIdx = 0; eqIdx < numEqs; eqIdx++) {
      const kind = this.arena.getEqKind(eqIdx);
      if (kind === EqKind.Simple || kind === EqKind.InitialSimple) {
        const lhs = this.arena.getEqLhs(eqIdx);
        const rhs = this.arena.getEqRhs(eqIdx);

        const newLhs = this.relaxExpression(lhs);
        const newRhs = this.relaxExpression(rhs);

        if (newLhs !== lhs) this.arena.setEqLhs(eqIdx, newLhs);
        if (newRhs !== rhs) this.arena.setEqRhs(eqIdx, newRhs);
      }
    }

    // Also relax variable binding expressions (e.g. parameters or initial equations)
    const numVars = this.arena.varCount;
    for (let varIdx = 0; varIdx < numVars; varIdx++) {
      const exprId = this.arena.getVarExpression(varIdx);
      if (exprId !== -1) {
        const newExpr = this.relaxExpression(exprId);
        if (newExpr !== exprId) {
          this.arena.setVarExpression(varIdx, newExpr);
        }
      }
    }
  }

  /**
   * Recursively traverses and relaxes an expression tree.
   * Returns the new ExprId representing the smoothed formulation.
   */
  public relaxExpression(exprId: number): number {
    if (exprId < 0) return exprId;

    if (this.cache.has(exprId)) {
      return this.cache.get(exprId)!;
    }

    const kind = this.arena.getExprKind(exprId);

    switch (kind) {
      case ExprKind.IfElse: {
        if (!this.options.relaxIfElse) break;

        const condId = this.arena.getExprData1(exprId);
        const thenId = this.arena.getExprLeft(exprId);
        const elseId = this.arena.getExprRight(exprId);

        const relaxedThen = this.relaxExpression(thenId);
        const relaxedElse = this.relaxExpression(elseId);

        const resId = this.buildSmoothIfElse(condId, relaxedThen, relaxedElse);
        this.cache.set(exprId, resId);
        return resId;
      }

      case ExprKind.Binary: {
        const op = this.arena.getExprData1(exprId) as BinOp;
        const leftId = this.arena.getExprLeft(exprId);
        const rightId = this.arena.getExprRight(exprId);

        const relaxedLeft = this.relaxExpression(leftId);
        const relaxedRight = this.relaxExpression(rightId);

        if (relaxedLeft !== leftId || relaxedRight !== rightId) {
          const newBin = this.arena.addBinaryExpr(op, relaxedLeft, relaxedRight);
          this.cache.set(exprId, newBin);
          return newBin;
        }
        break;
      }

      case ExprKind.Unary: {
        const op = this.arena.getExprData1(exprId);
        const leftId = this.arena.getExprLeft(exprId);
        const relaxedLeft = this.relaxExpression(leftId);
        if (relaxedLeft !== leftId) {
          const newUnary = this.arena.addUnaryExpr(op, relaxedLeft);
          this.cache.set(exprId, newUnary);
          return newUnary;
        }
        break;
      }

      case ExprKind.Negate: {
        const leftId = this.arena.getExprLeft(exprId);
        const relaxedLeft = this.relaxExpression(leftId);
        if (relaxedLeft !== leftId) {
          const newNeg = this.arena.addUnaryExpr(0, relaxedLeft);
          this.cache.set(exprId, newNeg);
          return newNeg;
        }
        break;
      }

      case ExprKind.Call: {
        const nameId = this.arena.getExprData1(exprId);
        const funcName = this.arena.interner.resolve(nameId);
        const argCount = this.arena.getExprRight(exprId);
        const firstArgId = this.arena.getExprLeft(exprId);

        if (argCount === 1) {
          const arg = this.relaxExpression(firstArgId);

          if (funcName === "abs" && this.options.relaxAbs) {
            // sqrt(x^2 + eps^2)
            const res = this.buildSmoothAbs(arg);
            this.cache.set(exprId, res);
            return res;
          }

          if (funcName === "sign" && this.options.relaxSign) {
            // tanh(k * x)
            const res = this.buildSmoothSign(arg);
            this.cache.set(exprId, res);
            return res;
          }

          if (arg !== firstArgId) {
            const newCall = this.arena.addCallExpr(funcName, [arg]);
            this.cache.set(exprId, newCall);
            return newCall;
          }
        } else if (argCount === 2) {
          const secondArgId = this.arena.getExprLeft(exprId + 1);
          const arg0 = this.relaxExpression(firstArgId);
          const arg1 = this.relaxExpression(secondArgId);

          if (funcName === "max" && this.options.relaxMaxMin) {
            const res = this.buildSmoothMax(arg0, arg1);
            this.cache.set(exprId, res);
            return res;
          }

          if (funcName === "min" && this.options.relaxMaxMin) {
            const res = this.buildSmoothMin(arg0, arg1);
            this.cache.set(exprId, res);
            return res;
          }

          if (arg0 !== firstArgId || arg1 !== secondArgId) {
            const newCall = this.arena.addCallExpr(funcName, [arg0, arg1]);
            this.cache.set(exprId, newCall);
            return newCall;
          }
        }
        break;
      }
    }

    this.cache.set(exprId, exprId);
    return exprId;
  }

  /**
   * Builds smooth sigmoidal blend for if-then-else:
   *   sigma(g) * then + (1 - sigma(g)) * else
   * where sigma(g) = 0.5 * (1 + tanh(0.5 * k * g))
   */
  private buildSmoothIfElse(condExprId: number, thenExprId: number, elseExprId: number): number {
    const indicatorId = this.extractContinuousIndicator(condExprId);
    const sigmaId = this.buildSigmoid(indicatorId);

    // sigma * then
    const termThen = this.arena.addBinaryExpr(BinOp.Mul, sigmaId, thenExprId);

    // (1 - sigma)
    const oneLit = this.arena.addRealLiteral(1.0);
    const oneMinusSigma = this.arena.addBinaryExpr(BinOp.Sub, oneLit, sigmaId);

    // (1 - sigma) * else
    const termElse = this.arena.addBinaryExpr(BinOp.Mul, oneMinusSigma, elseExprId);

    // termThen + termElse
    return this.arena.addBinaryExpr(BinOp.Add, termThen, termElse);
  }

  /**
   * Continuous zero-crossing indicator g from condition:
   *   a > b  -> g = a - b
   *   a >= b -> g = a - b
   *   a < b  -> g = b - a
   *   a <= b -> g = b - a
   */
  private extractContinuousIndicator(condExprId: number): number {
    const kind = this.arena.getExprKind(condExprId);
    if (kind === ExprKind.Binary) {
      const op = this.arena.getExprData1(condExprId) as BinOp;
      const leftId = this.relaxExpression(this.arena.getExprLeft(condExprId));
      const rightId = this.relaxExpression(this.arena.getExprRight(condExprId));

      if (op === BinOp.Gt || op === BinOp.Gte) {
        return this.arena.addBinaryExpr(BinOp.Sub, leftId, rightId);
      }
      if (op === BinOp.Lt || op === BinOp.Lte) {
        return this.arena.addBinaryExpr(BinOp.Sub, rightId, leftId);
      }
    }

    // Default continuous fallback: cond - 0.5 (boolean 1 vs 0)
    const relaxedCond = this.relaxExpression(condExprId);
    const halfLit = this.arena.addRealLiteral(0.5);
    return this.arena.addBinaryExpr(BinOp.Sub, relaxedCond, halfLit);
  }

  /**
   * Numerically stable sigmoid: sigma_k(g) = 0.5 * (1 + tanh(0.5 * k * g)).
   */
  private buildSigmoid(indicatorId: number): number {
    const halfK = 0.5 * this.k;
    const halfKLit = this.arena.addRealLiteral(halfK);
    const scaled = this.arena.addBinaryExpr(BinOp.Mul, halfKLit, indicatorId);

    const tanhVal = this.arena.addCallExpr("tanh", [scaled]);
    const oneLit = this.arena.addRealLiteral(1.0);
    const onePlusTanh = this.arena.addBinaryExpr(BinOp.Add, oneLit, tanhVal);

    const halfLit = this.arena.addRealLiteral(0.5);
    return this.arena.addBinaryExpr(BinOp.Mul, halfLit, onePlusTanh);
  }

  /**
   * Smooth abs: sqrt(x^2 + eps^2) where eps = 1 / k.
   */
  private buildSmoothAbs(xId: number): number {
    const eps = 1.0 / this.k;
    const epsSqLit = this.arena.addRealLiteral(eps * eps);
    const xSq = this.arena.addBinaryExpr(BinOp.Mul, xId, xId);
    const sum = this.arena.addBinaryExpr(BinOp.Add, xSq, epsSqLit);
    return this.arena.addCallExpr("sqrt", [sum]);
  }

  /**
   * Smooth sign: tanh(k * x).
   */
  private buildSmoothSign(xId: number): number {
    const kLit = this.arena.addRealLiteral(this.k);
    const kx = this.arena.addBinaryExpr(BinOp.Mul, kLit, xId);
    return this.arena.addCallExpr("tanh", [kx]);
  }

  /**
   * Smooth max(a, b) = a * sigma_k(a - b) + b * (1 - sigma_k(a - b)).
   */
  private buildSmoothMax(aId: number, bId: number): number {
    const diff = this.arena.addBinaryExpr(BinOp.Sub, aId, bId);
    const sigma = this.buildSigmoid(diff);

    const termA = this.arena.addBinaryExpr(BinOp.Mul, sigma, aId);
    const oneLit = this.arena.addRealLiteral(1.0);
    const oneMinusSigma = this.arena.addBinaryExpr(BinOp.Sub, oneLit, sigma);
    const termB = this.arena.addBinaryExpr(BinOp.Mul, oneMinusSigma, bId);

    return this.arena.addBinaryExpr(BinOp.Add, termA, termB);
  }

  /**
   * Smooth min(a, b) = a * (1 - sigma_k(a - b)) + b * sigma_k(a - b).
   */
  private buildSmoothMin(aId: number, bId: number): number {
    const diff = this.arena.addBinaryExpr(BinOp.Sub, aId, bId);
    const sigma = this.buildSigmoid(diff);

    const oneLit = this.arena.addRealLiteral(1.0);
    const oneMinusSigma = this.arena.addBinaryExpr(BinOp.Sub, oneLit, sigma);
    const termA = this.arena.addBinaryExpr(BinOp.Mul, oneMinusSigma, aId);
    const termB = this.arena.addBinaryExpr(BinOp.Mul, sigma, bId);

    return this.arena.addBinaryExpr(BinOp.Add, termA, termB);
  }
}

/**
 * Convenient utility to relax all non-smooth events and switches in a DAEBuilder.
 */
export function relaxArenaEvents(arena: DAEBuilder, options?: EventRelaxerOptions): DAEBuilder {
  const relaxer = new DAEEventRelaxer(arena, options);
  relaxer.relaxAllEquations();
  return arena;
}
