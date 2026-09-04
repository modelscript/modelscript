import {
  DaeBuilder,
  ExprKind,
  BinOp,
  UnaryOp,
  Variability,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  EXPR_LEFT,
  EXPR_RIGHT,
  EQ_STRIDE,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
  EqKind,
  VAR_STRIDE,
  VAR_NAME,
  VAR_TYPE,
  VAR_VARIABILITY,
  VAR_CAUSALITY,
  VAR_FLAGS,
  FLAG_TEARING_VAR,
  FLAG_VAR_STATE,
  FLAG_VAR_STATE_DER,
} from "./dae";
import { BltEngine } from "./blt";
import { simplifyAst } from "./parser";
import {
  ChunkedInt32Array,
  ChunkedUint8Array,
  createChunkedInt32Array,
  createChunkedUint8Array,
} from "./array";
import { atomicChunkAlloc, debugLog } from "./arena";

/**
 * Checks if an expression evaluates structurally to zero literal.
 */
@inline
export function isZeroExpr(exprId: u32, dae: DaeBuilder): boolean {
  if (exprId == 0xffffffff) return false;
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);
  if (kind == ExprKind.IntLiteral) {
    return (dae.getExprData().get(offset + EXPR_DATA1) as i32) == 0;
  }
  if (kind == ExprKind.RealLiteral) {
    let lo = (dae.getExprData().get(offset + EXPR_DATA1) as u64) & 0xffffffff;
    let hi = (dae.getExprData().get(offset + EXPR_LEFT) as u64) & 0xffffffff;
    let bits = (hi << 32) | lo;
    let val = f64.reinterpret_i64(bits as i64);
    return val == 0.0;
  }
  return false;
}

/**
 * Checks if an expression evaluates structurally to one literal.
 */
@inline
export function isOneExpr(exprId: u32, dae: DaeBuilder): boolean {
  if (exprId == 0xffffffff) return false;
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);
  if (kind == ExprKind.IntLiteral) {
    return (dae.getExprData().get(offset + EXPR_DATA1) as i32) == 1;
  }
  if (kind == ExprKind.RealLiteral) {
    let lo = (dae.getExprData().get(offset + EXPR_DATA1) as u64) & 0xffffffff;
    let hi = (dae.getExprData().get(offset + EXPR_LEFT) as u64) & 0xffffffff;
    let bits = (hi << 32) | lo;
    let val = f64.reinterpret_i64(bits as i64);
    return val == 1.0;
  }
  return false;
}

/**
 * Checks if an expression contains a derivative operator (recursing across all AST nodes).
 */
export function containsDerivative(exprId: u32, dae: DaeBuilder): boolean {
  if (exprId == 0xffffffff) return false;

  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);
  if (kind == ExprKind.Der) return true;

  if (kind == ExprKind.Binary || kind == ExprKind.Range) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    if (left != 0xffffffff && containsDerivative(left, dae)) return true;
    if (right != 0xffffffff && containsDerivative(right, dae)) return true;
    return false;
  }

  if (kind == ExprKind.IfElse) {
    let cond = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let thenBranch = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let elseBranch = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    if (cond != 0xffffffff && containsDerivative(cond, dae)) return true;
    if (thenBranch != 0xffffffff && containsDerivative(thenBranch, dae)) return true;
    if (elseBranch != 0xffffffff && containsDerivative(elseBranch, dae)) return true;
    return false;
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate || kind == ExprKind.Pre) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    return left != 0xffffffff && containsDerivative(left, dae);
  }

  if (kind == ExprKind.Call || kind == ExprKind.ArrayCtor || kind == ExprKind.Tuple) {
    let count: u32 = u32(dae.getExprData().get(offset + EXPR_RIGHT));
    let first: u32 = u32(dae.getExprData().get(offset + EXPR_LEFT));
    for (let j: u32 = 0; j < count; j++) {
      if (containsDerivative(first + j, dae)) return true;
    }
    return false;
  }

  return false;
}

/**
 * Symbolic Differentiator for expressions in the DAE Builder.
 * Differentiates an expression tree with respect to continuous time t.
 */
export function differentiateExpr(exprId: u32, dae: DaeBuilder, stateVars: ChunkedInt32Array): u32 {
  if (exprId == 0xffffffff) return 0xffffffff;

  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  // Constants & Literals -> d/dt (c) = 0.0
  if (
    kind == ExprKind.IntLiteral ||
    kind == ExprKind.RealLiteral ||
    kind == ExprKind.BoolLiteral ||
    kind == ExprKind.StringLiteral ||
    kind == ExprKind.EnumLiteral
  ) {
    return dae.addRealLiteral(0.0);
  }

  // Variable Reference
  if (kind == ExprKind.Name) {
    let varId: u32 = u32(dae.getExprData().get(offset + EXPR_DATA1));
    if (varId < dae.varCount) {
      let variability = dae.getVarData().get(varId * VAR_STRIDE + VAR_VARIABILITY);
      if (variability == Variability.Parameter || variability == Variability.Constant) {
        return dae.addRealLiteral(0.0);
      }
      return dae.addExpression(ExprKind.Der, exprId);
    }
    return dae.addExpression(ExprKind.Der, exprId);
  }

  // Pre operator: discrete history has zero time derivative
  if (kind == ExprKind.Pre) {
    return dae.addRealLiteral(0.0);
  }

  // Derivative: der(x) -> der(der(x))
  if (kind == ExprKind.Der) {
    return dae.addExpression(ExprKind.Der, exprId);
  }

  // Unary Negation: d(-u) = -(du)
  if (kind == ExprKind.Negate) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let dLeft = differentiateExpr(left, dae, stateVars);
    if (isZeroExpr(dLeft, dae)) return dLeft;
    return dae.addExpression(ExprKind.Negate, 0, dLeft);
  }

  if (kind == ExprKind.Unary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1);
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let dLeft = differentiateExpr(left, dae, stateVars);
    if (op == UnaryOp.Negate) {
      if (isZeroExpr(dLeft, dae)) return dLeft;
      return dae.addExpression(ExprKind.Negate, 0, dLeft);
    }
    return dae.addRealLiteral(0.0);
  }

  // Conditional Expression: d(if c then u else v) = if c then du else dv
  if (kind == ExprKind.IfElse) {
    let cond = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let thenBranch = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let elseBranch = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    let dThen = differentiateExpr(thenBranch, dae, stateVars);
    let dElse = differentiateExpr(elseBranch, dae, stateVars);
    return dae.addExpression(ExprKind.IfElse, cond, dThen, dElse);
  }

  // Binary Expression
  if (kind == ExprKind.Binary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1);
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;

    let dLeft = differentiateExpr(left, dae, stateVars);
    let dRight = differentiateExpr(right, dae, stateVars);

    let leftZero = isZeroExpr(dLeft, dae);
    let rightZero = isZeroExpr(dRight, dae);

    // Sum / Difference Rules
    if (op == BinOp.Add || op == BinOp.ElemAdd) {
      if (leftZero && rightZero) return dLeft;
      if (leftZero) return dRight;
      if (rightZero) return dLeft;
      return dae.addExpression(ExprKind.Binary, op, dLeft, dRight);
    }

    if (op == BinOp.Sub || op == BinOp.ElemSub) {
      if (leftZero && rightZero) return dLeft;
      if (leftZero) return dae.addExpression(ExprKind.Negate, 0, dRight);
      if (rightZero) return dLeft;
      return dae.addExpression(ExprKind.Binary, op, dLeft, dRight);
    }

    // Product Rule: d(u*v) = du*v + u*dv
    if (op == BinOp.Mul || op == BinOp.ElemMul) {
      if (leftZero && rightZero) return dae.addRealLiteral(0.0);
      if (leftZero) return dae.addExpression(ExprKind.Binary, op, left, dRight);
      if (rightZero) return dae.addExpression(ExprKind.Binary, op, dLeft, right);
      let t1 = dae.addExpression(ExprKind.Binary, op, dLeft, right);
      let t2 = dae.addExpression(ExprKind.Binary, op, left, dRight);
      return dae.addExpression(ExprKind.Binary, BinOp.Add, t1, t2);
    }

    // Quotient Rule: d(u/v) = (du*v - u*dv) / v^2
    if (op == BinOp.Div || op == BinOp.ElemDiv) {
      if (leftZero && rightZero) return dae.addRealLiteral(0.0);
      if (rightZero) {
        // d(u / c) = du / c
        return dae.addExpression(ExprKind.Binary, op, dLeft, right);
      }
      if (leftZero) {
        // d(c / v) = -c * dv / v^2
        let two = dae.addIntLiteral(2);
        let den = dae.addExpression(ExprKind.Binary, BinOp.Pow, right, two);
        let num = dae.addExpression(ExprKind.Binary, BinOp.Mul, left, dRight);
        let quot = dae.addExpression(ExprKind.Binary, BinOp.Div, num, den);
        return dae.addExpression(ExprKind.Negate, 0, quot);
      }
      let t1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, dLeft, right);
      let t2 = dae.addExpression(ExprKind.Binary, BinOp.Mul, left, dRight);
      let num = dae.addExpression(ExprKind.Binary, BinOp.Sub, t1, t2);
      let two = dae.addIntLiteral(2);
      let den = dae.addExpression(ExprKind.Binary, BinOp.Pow, right, two);
      return dae.addExpression(ExprKind.Binary, BinOp.Div, num, den);
    }

    // Power Rule: d(u^n) = n * u^(n-1) * du (constant exponent n)
    if (op == BinOp.Pow || op == BinOp.ElemPow) {
      if (leftZero && rightZero) return dae.addRealLiteral(0.0);
      if (rightZero) {
        if (leftZero) return dae.addRealLiteral(0.0);
        let one = dae.addIntLiteral(1);
        let nMinus1 = dae.addExpression(ExprKind.Binary, BinOp.Sub, right, one);
        let uPowNminus1 = dae.addExpression(ExprKind.Binary, BinOp.Pow, left, nMinus1);
        let term1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, right, uPowNminus1);
        return dae.addExpression(ExprKind.Binary, BinOp.Mul, term1, dLeft);
      }
      return dae.addRealLiteral(0.0);
    }

    return dae.addRealLiteral(0.0);
  }

  return dae.addRealLiteral(0.0);
}

/**
 * Pantelides Structural Index Reduction Engine.
 * Formulates the bipartite graph of equations and highest-order derivatives,
 * finds maximal matchings via augmenting paths, differentiates structurally singular
 * constraint subsets, and selects dummy derivatives via Mattsson-Söderlind.
 */
@unmanaged
export class PantelidesEngine {
  dae: DaeBuilder;
  blt: BltEngine;

  // CSR Graph adjacency
  eqDepPtrs: ChunkedInt32Array;
  eqDepVars: ChunkedInt32Array;

  // Bipartite matching arrays
  matchEqToVar: ChunkedInt32Array; // eq -> var
  matchVarToEq: ChunkedInt32Array; // var -> eq

  // Alternating path search markers
  visitedEq: ChunkedUint8Array;
  visitedVar: ChunkedUint8Array;

  // Differentiation tracking
  eqDiffLevel: ChunkedInt32Array;
  varDiffLevel: ChunkedInt32Array;
  varDerivativeOf: ChunkedInt32Array;

  // Mattsson-Söderlind dummy derivatives
  dummyDerivatives: ChunkedInt32Array;

  diffRounds: u32;
  structuralIndex: u32;

  init(dae: DaeBuilder, blt: BltEngine | null = null): void {
    this.dae = dae;
    if (blt != null) {
      this.blt = blt;
    } else {
      let bltPtr = atomicChunkAlloc(sizeof<BltEngine>());
      this.blt = changetype<BltEngine>(bltPtr);
      this.blt.init(dae);
    }

    this.eqDepPtrs = createChunkedInt32Array(1024);
    this.eqDepVars = createChunkedInt32Array(4096);
    this.matchEqToVar = createChunkedInt32Array(1024);
    this.matchVarToEq = createChunkedInt32Array(1024);
    this.visitedEq = createChunkedUint8Array(1024);
    this.visitedVar = createChunkedUint8Array(1024);
    this.eqDiffLevel = createChunkedInt32Array(1024);
    this.varDiffLevel = createChunkedInt32Array(1024);
    this.varDerivativeOf = createChunkedInt32Array(1024);
    this.dummyDerivatives = createChunkedInt32Array(256);
    this.diffRounds = 0;
    this.structuralIndex = 1;
  }

  /**
   * Phase 1: Build the CSR equation-to-variable dependency graph.
   * Identifies highest-order derivative unknowns for state variables
   * and order-0 unknowns for algebraic variables.
   * Excludes parameters and constants.
   */
  @inline
  buildDependencies(): void {
    let eqCount = this.dae.eqCount;
    let varCount = this.dae.varCount;

    this.eqDepPtrs.clear();
    this.eqDepVars.clear();

    for (let i: u32 = 0; i <= eqCount; i++) {
      this.eqDepPtrs.push(0);
    }
    let isStateVar = createChunkedUint8Array(varCount);
    for (let i: u32 = 0; i < varCount; i++) {
      let flags = this.dae.getVarData().get(i * VAR_STRIDE + VAR_FLAGS);
      isStateVar.push((flags & (FLAG_VAR_STATE | FLAG_VAR_STATE_DER)) != 0 ? 1 : 0);
    }

    // Also mark variables that appear inside ExprKind.Der as state variables
    let exprStack = createChunkedInt32Array(256);
    for (let i: u32 = 0; i < eqCount; i++) {
      let offset = i * EQ_STRIDE;
      if (this.dae.getEqData().get(offset + EQ_KIND) != EqKind.Simple) continue;
      let lhsId = this.dae.getEqData().get(offset + EQ_LHS) as u32;
      let rhsId = this.dae.getEqData().get(offset + EQ_RHS) as u32;
      exprStack.clear();
      if (lhsId != 0xffffffff) exprStack.push(lhsId as i32);
      if (rhsId != 0xffffffff) exprStack.push(rhsId as i32);

      while (exprStack.length > 0) {
        let exprId = exprStack.pop() as u32;
        if (exprId == 0xffffffff) continue;
        let exprOffset = exprId * EXPR_STRIDE;
        let kind = this.dae.getExprData().get(exprOffset + EXPR_KIND);
        if (kind == ExprKind.Der) {
          let inner = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          if (inner != 0xffffffff) {
            let innerOffset = inner * EXPR_STRIDE;
            if (this.dae.getExprData().get(innerOffset + EXPR_KIND) == ExprKind.Name) {
              let vId = this.dae.getExprData().get(innerOffset + EXPR_DATA1) as u32;
              if (vId < varCount) isStateVar.set(vId, 1);
            }
          }
        } else if (kind == ExprKind.Binary) {
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          let right = this.dae.getExprData().get(exprOffset + EXPR_RIGHT) as u32;
          if (left != 0xffffffff) exprStack.push(left as i32);
          if (right != 0xffffffff) exprStack.push(right as i32);
        } else if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          if (left != 0xffffffff) exprStack.push(left as i32);
        } else if (kind == ExprKind.IfElse) {
          let cond = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          let right = this.dae.getExprData().get(exprOffset + EXPR_RIGHT) as u32;
          if (cond != 0xffffffff) exprStack.push(cond as i32);
          if (left != 0xffffffff) exprStack.push(left as i32);
          if (right != 0xffffffff) exprStack.push(right as i32);
        }
      }
    }

    let seenVars = createChunkedUint8Array(varCount);
    for (let i: u32 = 0; i < varCount; i++) seenVars.push(0);

    for (let i: u32 = 0; i < eqCount; i++) {
      this.eqDepPtrs.set(i, this.eqDepVars.length as i32);

      let offset = i * EQ_STRIDE;
      if (this.dae.getEqData().get(offset + EQ_KIND) != EqKind.Simple) continue;

      let lhsId = this.dae.getEqData().get(offset + EQ_LHS) as u32;
      let rhsId = this.dae.getEqData().get(offset + EQ_RHS) as u32;

      exprStack.clear();
      if (lhsId != 0xffffffff) exprStack.push(lhsId as i32);
      if (rhsId != 0xffffffff) exprStack.push(rhsId as i32);

      while (exprStack.length > 0) {
        let exprId = exprStack.pop() as u32;
        if (exprId == 0xffffffff) continue;

        let exprOffset = exprId * EXPR_STRIDE;
        let kind = this.dae.getExprData().get(exprOffset + EXPR_KIND);

        if (kind == ExprKind.Der) {
          let inner = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          if (inner != 0xffffffff) {
            let innerOffset = inner * EXPR_STRIDE;
            if (this.dae.getExprData().get(innerOffset + EXPR_KIND) == ExprKind.Name) {
              let varId = this.dae.getExprData().get(innerOffset + EXPR_DATA1) as u32;
              if (varId < varCount) {
                if (seenVars.get(varId) == 0) {
                  seenVars.set(varId, 1);
                  this.eqDepVars.push(varId as i32);
                }
              }
            }
          }
        } else if (kind == ExprKind.Name) {
          let varId: u32 = u32(this.dae.getExprData().get(exprOffset + EXPR_DATA1));
          if (varId < varCount) {
            let variability = this.dae.getVarData().get(varId * VAR_STRIDE + VAR_VARIABILITY);
            if (variability != Variability.Parameter && variability != Variability.Constant) {
              if (isStateVar.get(varId) == 0) {
                if (seenVars.get(varId) == 0) {
                  seenVars.set(varId, 1);
                  this.eqDepVars.push(varId as i32);
                }
              }
            }
          }
        } else if (kind == ExprKind.Binary) {
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          let right = this.dae.getExprData().get(exprOffset + EXPR_RIGHT) as u32;
          if (left != 0xffffffff) exprStack.push(left as i32);
          if (right != 0xffffffff) exprStack.push(right as i32);
        } else if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          if (left != 0xffffffff) exprStack.push(left as i32);
        } else if (kind == ExprKind.IfElse) {
          let cond = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          let right = this.dae.getExprData().get(exprOffset + EXPR_RIGHT) as u32;
          if (cond != 0xffffffff) exprStack.push(cond as i32);
          if (left != 0xffffffff) exprStack.push(left as i32);
          if (right != 0xffffffff) exprStack.push(right as i32);
        }
      }

      let startVars = this.eqDepPtrs.get(i) as u32;
      let endVars = this.eqDepVars.length;
      for (let j: u32 = startVars; j < endVars; j++) {
        let v = this.eqDepVars.get(j) as u32;
        if (v < varCount) seenVars.set(v, 0);
      }
    }

    this.eqDepPtrs.set(eqCount, this.eqDepVars.length as i32);
  }

  /**
   * Performs an augmenting path search from equation `eqIdx`.
   */
  private augment(eqIdx: u32): boolean {
    if (this.visitedEq.get(eqIdx) == 1) return false;
    this.visitedEq.set(eqIdx, 1);

    let start = this.eqDepPtrs.get(eqIdx) as u32;
    let end = this.eqDepPtrs.get(eqIdx + 1) as u32;

    for (let i: u32 = start; i < end; i++) {
      let varIdx = this.eqDepVars.get(i) as u32;
      if (this.visitedVar.get(varIdx) == 0) {
        this.visitedVar.set(varIdx, 1);
        let prevEq = this.matchVarToEq.get(varIdx);

        if (prevEq == -1 || this.augment(prevEq as u32)) {
          this.matchVarToEq.set(varIdx, eqIdx as i32);
          this.matchEqToVar.set(eqIdx, varIdx as i32);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Applies Pantelides structural index reduction.
   * Differentiates minimally singular equation subsets until full bipartite matching is achieved.
   * Returns the count of newly synthesized constraint equations.
   */
  @inline
  reduceIndex(stateVars: ChunkedInt32Array | null = null): u32 {
    if (stateVars == null) {
      stateVars = createChunkedInt32Array(0);
    }
    let initialEqCount = this.dae.eqCount;
    let initialVarCount = this.dae.varCount;
    if (initialEqCount == 0 || initialVarCount == 0) {
      this.structuralIndex = 1;
      return 0;
    }

    this.eqDiffLevel.clear();
    for (let i: u32 = 0; i < initialEqCount; i++) this.eqDiffLevel.push(0);

    this.varDiffLevel.clear();
    this.varDerivativeOf.clear();
    for (let i: u32 = 0; i < initialVarCount; i++) {
      this.varDiffLevel.push(0);
      this.varDerivativeOf.push(-1);
    }

    let activeEqs = createChunkedInt32Array(initialEqCount);
    for (let i: u32 = 0; i < initialEqCount; i++) {
      activeEqs.push(i as i32);
    }

    this.dummyDerivatives.clear();
    this.diffRounds = 0;
    let generatedEquations: u32 = 0;
    const maxRounds: u32 = 50;

    while (this.diffRounds < maxRounds) {
      let currentEqCount = this.dae.eqCount;
      let currentVarCount = this.dae.varCount;

      this.buildDependencies();

      while (this.matchVarToEq.length < currentVarCount) this.matchVarToEq.push(-1);
      while (this.matchEqToVar.length < currentEqCount) this.matchEqToVar.push(-1);
      while (this.visitedVar.length < currentVarCount) this.visitedVar.push(0);
      while (this.visitedEq.length < currentEqCount) this.visitedEq.push(0);

      for (let i: u32 = 0; i < currentVarCount; i++) this.matchVarToEq.set(i, -1);
      for (let i: u32 = 0; i < currentEqCount; i++) this.matchEqToVar.set(i, -1);

      let allMatched = true;
      let unmatchedActive = createChunkedInt32Array(64);

      for (let a: u32 = 0; a < initialEqCount; a++) {
        let eqIdx = activeEqs.get(a) as u32;
        for (let v: u32 = 0; v < currentVarCount; v++) this.visitedVar.set(v, 0);
        for (let e: u32 = 0; e < currentEqCount; e++) this.visitedEq.set(e, 0);

        if (!this.augment(eqIdx)) {
          allMatched = false;
          unmatchedActive.push(a as i32);
        }
      }

      if (allMatched || unmatchedActive.length == 0) {
        break;
      }

      this.diffRounds++;

      // Collect all equations in the alternating search tree for unmatched active equations
      for (let v: u32 = 0; v < currentVarCount; v++) this.visitedVar.set(v, 0);
      for (let e: u32 = 0; e < currentEqCount; e++) this.visitedEq.set(e, 0);

      let queue = createChunkedInt32Array(64);
      for (let u: u32 = 0; u < unmatchedActive.length; u++) {
        let a = unmatchedActive.get(u) as u32;
        let eqIdx = activeEqs.get(a) as u32;
        this.visitedEq.set(eqIdx, 1);
        queue.push(eqIdx as i32);
      }

      let qHead: u32 = 0;
      while (qHead < queue.length) {
        let eqIdx = queue.get(qHead++) as u32;
        let start = this.eqDepPtrs.get(eqIdx) as u32;
        let end = this.eqDepPtrs.get(eqIdx + 1) as u32;

        for (let i: u32 = start; i < end; i++) {
          let varIdx = this.eqDepVars.get(i) as u32;
          if (this.visitedVar.get(varIdx) == 0) {
            this.visitedVar.set(varIdx, 1);
            let matchedEq = this.matchVarToEq.get(varIdx);
            if (matchedEq != -1 && (matchedEq as u32) < currentEqCount) {
              if (this.visitedEq.get(matchedEq as u32) == 0) {
                this.visitedEq.set(matchedEq as u32, 1);
                queue.push(matchedEq);
              }
            }
          }
        }
      }

      // Differentiate the visited active equations
      for (let a: u32 = 0; a < initialEqCount; a++) {
        let eqIdx = activeEqs.get(a) as u32;
        if (this.visitedEq.get(eqIdx) == 1) {
          let offset = eqIdx * EQ_STRIDE;
          let lhsId = this.dae.getEqData().get(offset + EQ_LHS) as u32;
          let rhsId = this.dae.getEqData().get(offset + EQ_RHS) as u32;

          let dLhs = differentiateExpr(lhsId, this.dae, stateVars);
          let dRhs = differentiateExpr(rhsId, this.dae, stateVars);

          let simLhs = simplifyAst(dLhs, this.dae);
          let simRhs = simplifyAst(dRhs, this.dae);

          let newEqIdx = this.dae.addEquation(EqKind.Simple, simLhs, simRhs);
          let currLevel = eqIdx < this.eqDiffLevel.length ? this.eqDiffLevel.get(eqIdx) : 0;
          this.eqDiffLevel.push(currLevel + 1);

          activeEqs.set(a, newEqIdx as i32);
          generatedEquations++;
        }
      }
    }

    this.structuralIndex = this.diffRounds + 1;

    // Phase 4: Mattsson-Söderlind Dummy Derivative Selection
    this.selectDummyDerivatives();

    return generatedEquations;
  }

  /**
   * Selects dummy derivatives according to the Mattsson-Söderlind algorithm.
   */
  @inline
  selectDummyDerivatives(): void {
    let varCount = this.dae.varCount;

    for (let v: u32 = 0; v < varCount; v++) {
      let parent = v < this.varDerivativeOf.length ? this.varDerivativeOf.get(v) : -1;

      if (parent != -1 && (parent as u32) < varCount) {
        let parentIsState = (this.dae.getVarData().get((parent as u32) * VAR_STRIDE + VAR_FLAGS) & FLAG_VAR_STATE) != 0;
        if (parentIsState) {
          let matchedEq = v < this.matchVarToEq.length ? this.matchVarToEq.get(v) : -1;
          let isMatchedAsState = false;
          if (matchedEq != -1 && (matchedEq as u32) < this.eqDiffLevel.length) {
            if (this.eqDiffLevel.get(matchedEq as u32) > 0) {
              isMatchedAsState = true;
            }
          }
          if (!isMatchedAsState) {
            this.dummyDerivatives.push(v as i32);
            this.dae.setVarFlag(v, FLAG_TEARING_VAR);
          }
        }
      }
    }
  }

  /**
   * Dynamically swaps dynamic state variables when approaching kinematic singularities.
   */
  swapDynamicState(oldVar: u32, newVar: u32): boolean {
    if (oldVar >= this.dae.varCount || newVar >= this.dae.varCount) return false;

    let eq = this.matchVarToEq.get(oldVar);
    if (eq >= 0) {
      this.matchVarToEq.set(oldVar, -1);
      this.matchVarToEq.set(newVar, eq);
      this.matchEqToVar.set(eq, newVar as i32);
    }

    this.dae.setVarFlag(oldVar, FLAG_TEARING_VAR);
    let currFlags = this.dae.getVarData().get(newVar * VAR_STRIDE + VAR_FLAGS);
    this.dae.getVarData().set(newVar * VAR_STRIDE + VAR_FLAGS, currFlags & ~FLAG_TEARING_VAR);
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported C/WASM Bridge Functions
// ─────────────────────────────────────────────────────────────────────────────

export function dae_createPantelides(daePtr: u32, bltPtr: u32): u32 {
  let pantPtr = atomicChunkAlloc(sizeof<PantelidesEngine>());
  let pant = changetype<PantelidesEngine>(pantPtr);
  let dae = changetype<DaeBuilder>(daePtr);
  let blt: BltEngine | null = null;
  if (bltPtr != 0) {
    blt = changetype<BltEngine>(bltPtr);
  }
  pant.init(dae, blt);
  return pantPtr as u32;
}

export function dae_runPantelides(pantPtr: u32, stateVarsPtr: u32): u32 {
  if (pantPtr == 0) return 0;
  let stateVars = stateVarsPtr != 0 ? changetype<ChunkedInt32Array>(stateVarsPtr) : changetype<PantelidesEngine>(pantPtr).dummyDerivatives;
  return changetype<PantelidesEngine>(pantPtr).reduceIndex(stateVars);
}

export function dae_getPantelidesIndex(pantPtr: u32): u32 {
  if (pantPtr == 0) return 1;
  return changetype<PantelidesEngine>(pantPtr).structuralIndex;
}

export function dae_getDummyDerivativeCount(pantPtr: u32): u32 {
  if (pantPtr == 0) return 0;
  return changetype<PantelidesEngine>(pantPtr).dummyDerivatives.length;
}

export function dae_swapDynamicState(pantPtr: u32, oldVar: u32, newVar: u32): boolean {
  if (pantPtr == 0) return false;
  return changetype<PantelidesEngine>(pantPtr).swapDynamicState(oldVar, newVar);
}


