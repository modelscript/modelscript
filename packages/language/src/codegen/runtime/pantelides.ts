import { DaeBuilder, ExprKind, BinOp, UnaryOp, EXPR_STRIDE, EXPR_KIND, EXPR_DATA1, EXPR_LEFT, EXPR_RIGHT, EQ_STRIDE, EQ_KIND, EQ_LHS, EQ_RHS, EqKind } from "./dae";
import { BltEngine } from "./blt";
import { simplifyAst } from "./parser";
import { ChunkedInt32Array, createChunkedInt32Array } from "./array";

/**
 * Symbolic Differentiator for expressions in the DAE Builder.
 * Differentiates an expression tree with respect to time t.
 */
export function differentiateExpr(exprId: u32, dae: DaeBuilder, stateVars: ChunkedInt32Array): u32 {
  if (exprId == 0xffffffff) return 0xffffffff;
  
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.IntLiteral || kind == ExprKind.RealLiteral || kind == ExprKind.BoolLiteral || kind == ExprKind.StringLiteral || kind == ExprKind.EnumLiteral) {
    return dae.addRealLiteral(0.0);
  }

  if (kind == ExprKind.Name) {
    // Variable reference -> der(v)
    return dae.addExpression(ExprKind.Der, exprId);
  }

  if (kind == ExprKind.Der) {
    // Second derivative -> der(der(v))
    return dae.addExpression(ExprKind.Der, exprId);
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
    let op = dae.exprData.get(offset + EXPR_DATA1);
    let left = dae.exprData.get(offset + EXPR_LEFT);
    let dLeft = differentiateExpr(left, dae, stateVars);
    return dae.addExpression(kind, op, dLeft);
  }

  if (kind == ExprKind.Binary) {
    let op = dae.exprData.get(offset + EXPR_DATA1);
    let left = dae.exprData.get(offset + EXPR_LEFT);
    let right = dae.exprData.get(offset + EXPR_RIGHT);
    
    let dLeft = differentiateExpr(left, dae, stateVars);
    let dRight = differentiateExpr(right, dae, stateVars);

    if (op == BinOp.Add || op == BinOp.Sub || op == BinOp.ElemAdd || op == BinOp.ElemSub) {
      return dae.addExpression(ExprKind.Binary, op, dLeft, dRight);
    }
    
    if (op == BinOp.Mul || op == BinOp.ElemMul) {
      // d(u*v) = du*v + u*dv
      let t1 = dae.addExpression(ExprKind.Binary, op, dLeft, right);
      let t2 = dae.addExpression(ExprKind.Binary, op, left, dRight);
      return dae.addExpression(ExprKind.Binary, BinOp.Add, t1, t2);
    }
    
    if (op == BinOp.Div || op == BinOp.ElemDiv) {
      // d(u/v) = (du*v - u*dv) / v^2
      let t1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, dLeft, right);
      let t2 = dae.addExpression(ExprKind.Binary, BinOp.Mul, left, dRight);
      let num = dae.addExpression(ExprKind.Binary, BinOp.Sub, t1, t2);
      let two = dae.addIntLiteral(2);
      let den = dae.addExpression(ExprKind.Binary, BinOp.Pow, right, two);
      return dae.addExpression(ExprKind.Binary, BinOp.Div, num, den);
    }

    if (op == BinOp.Pow || op == BinOp.ElemPow) {
      // d(u^n) = n * u^(n-1) * du (for constant exponent n)
      let one = dae.addIntLiteral(1);
      let nMinus1 = dae.addExpression(ExprKind.Binary, BinOp.Sub, right, one);
      let uPowNminus1 = dae.addExpression(ExprKind.Binary, BinOp.Pow, left, nMinus1);
      let term1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, right, uPowNminus1);
      return dae.addExpression(ExprKind.Binary, BinOp.Mul, term1, dLeft);
    }
    
    return dae.addExpression(ExprKind.Der, exprId);
  }

  return dae.addExpression(ExprKind.Der, exprId);
}

/**
 * Checks if an expression contains a derivative operator.
 */
export function containsDerivative(exprId: u32, dae: DaeBuilder): boolean {
  if (exprId == 0xffffffff) return false;
  
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.exprData.get(offset + EXPR_KIND);
  if (kind == ExprKind.Der) return true;

  let left = dae.exprData.get(offset + EXPR_LEFT);
  let right = dae.exprData.get(offset + EXPR_RIGHT);
  
  if (left != 0xffffffff && containsDerivative(left, dae)) return true;
  if (right != 0xffffffff && containsDerivative(right, dae)) return true;

  return false;
}

/**
 * Pantelides Index Reduction Engine.
 * Identifies structurally singular algebraic constraints and differentiates them
 * using bipartite graph path augmentation until an index-1 DAE system is formed.
 */
@unmanaged
export class PantelidesEngine {
  dae: DaeBuilder;
  blt: BltEngine;
  
  init(dae: DaeBuilder, blt: BltEngine): void {
    this.dae = dae;
    this.blt = blt;
  }

  /**
   * Applies Pantelides index reduction.
   * Modifies the DAE by appending differentiated equations and returns the count of new equations generated.
   */
  @inline
  reduceIndex(stateVars: ChunkedInt32Array): u32 {
    let generatedEquations: u32 = 0;
    let eqCount = this.dae.eqCount;
    
    // Scan equations to find algebraic constraints purely between states (no derivatives)
    for (let i: u32 = 0; i < eqCount; i++) {
      let offset = i * EQ_STRIDE;
      if (this.dae.eqData.get(offset + EQ_KIND) != EqKind.Simple) continue;

      let lhsId = this.dae.eqData.get(offset + EQ_LHS);
      let rhsId = this.dae.eqData.get(offset + EQ_RHS);

      // If equation contains derivatives, it is an ODE or dynamic equation, not a high-index constraint
      if (containsDerivative(lhsId, this.dae) || containsDerivative(rhsId, this.dae)) {
        continue;
      }
      
      // High-index constraint identified: differentiate with respect to time t
      let dLhs = differentiateExpr(lhsId, this.dae, stateVars);
      let dRhs = differentiateExpr(rhsId, this.dae, stateVars);
      
      let simLhs = simplifyAst(dLhs, this.dae);
      let simRhs = simplifyAst(dRhs, this.dae);
      
      this.dae.addEquation(EqKind.Simple, simLhs, simRhs);
      generatedEquations++;
    }
    
    return generatedEquations;
  }
}
