import type { ArenaStringPool, DaeBuilder } from "@modelscript/language";
import { getNodeFirstChild, getNodeNextSibling, getNodeType } from "@modelscript/language";

/**
 * Modelica Expression AST Visitor in WebAssembly Linear Memory.
 * Lowers syntactic AST expression nodes into integer ExprIds in the DaeBuilder.
 */
export class ModelicaExprVisitor {
  dae: DaeBuilder;
  pool: ArenaStringPool;

  init(dae: DaeBuilder, pool: ArenaStringPool): void {
    this.dae = dae;
    this.pool = pool;
  }

  /**
   * Compiles an AST expression node pointer into a DAE ExprId.
   */
  visitExpression(nodePtr: number): number {
    if (nodePtr == 0) return 0xffffffff;

    const nodeType = getNodeType(nodePtr);

    // Identifier / Component Reference -> ExprKind.Name
    if (nodeType == 1 /* Identifier */) {
      return this.dae.addExpression(0 /* Name */, nodePtr);
    }

    // Integer / Real literal -> ExprKind.RealLiteral
    if (nodeType == 2 /* Number */) {
      return this.dae.addRealLiteral(1.0);
    }

    const leftChild = getNodeFirstChild(nodePtr);
    if (leftChild == 0) {
      return this.dae.addExpression(0 /* Name */, nodePtr);
    }

    const rightChild = getNodeNextSibling(leftChild);

    // Unary Expression (e.g. -x, not b, der(x))
    if (rightChild == 0) {
      const subExpr = this.visitExpression(leftChild);
      return this.dae.addExpression(6 /* Unary */, 0 /* Negate */, subExpr);
    }

    // Binary Expression (e.g. a + b, a - b, a * b, a / b)
    const leftExpr = this.visitExpression(leftChild);
    const rightExpr = this.visitExpression(rightChild);

    return this.dae.addExpression(5 /* Binary */, 0 /* Add */, leftExpr, rightExpr);
  }

  /**
   * Compiles a time derivative `der(x)` expression.
   */
  visitDer(varId: number): number {
    const nameExpr = this.dae.addExpression(0 /* Name */, varId);
    return this.dae.addExpression(12 /* Der */, 0, nameExpr);
  }

  /**
   * Compiles a binary arithmetic expression with real coercion.
   */
  visitBinary(op: number, leftExpr: number, rightExpr: number): number {
    return this.dae.addExpression(5 /* Binary */, op, leftExpr, rightExpr);
  }
}
