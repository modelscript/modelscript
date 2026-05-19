import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp } from "@modelscript/compiler";
import {
  ModelicaArrayConstructorSyntaxNode,
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaBinaryOperator,
  ModelicaBooleanLiteralSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaIfElseExpressionSyntaxNode,
  ModelicaLiteralSyntaxNode,
  ModelicaRangeExpressionSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  ModelicaUnaryExpressionSyntaxNode,
  ModelicaUnaryOperator,
  ModelicaUnsignedIntegerLiteralSyntaxNode,
  ModelicaUnsignedRealLiteralSyntaxNode,
} from "./ast.js";

/**
 * Translates a Modelica CST/AST expression tree into integer-based `ExprId`s
 * inside the given `ArenaDAEBuilder`.
 */
export class ArenaExprVisitor {
  private loopVars: Map<string, number>;
  private inNoEvent = false;
  constructor(
    private dae: ArenaDAEBuilder,
    loopVars?: Map<string, number>,
    private onFunctionCall?: (funcName: string) => void,
  ) {
    this.loopVars = loopVars ?? new Map();
  }

  public visit(node: unknown): number | undefined {
    if (!node) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = node as any;

    // Check specific node types. The AST nodes are subclasses of ModelicaSyntaxNode.
    // Literal subclasses must be checked before the base ModelicaLiteralSyntaxNode.
    if (n instanceof ModelicaBooleanLiteralSyntaxNode) {
      return this.dae.addBoolLiteral(n.value);
    } else if (n instanceof ModelicaUnsignedRealLiteralSyntaxNode) {
      return this.dae.addRealLiteral(n.value);
    } else if (n instanceof ModelicaUnsignedIntegerLiteralSyntaxNode) {
      return this.dae.addIntLiteral(n.value);
    } else if (n instanceof ModelicaStringLiteralSyntaxNode) {
      if (n.text != null) return this.dae.addStringLiteral(n.text);
      return undefined;
    } else if (n instanceof ModelicaLiteralSyntaxNode) {
      // Fallback for any other literal subclass
      return this.visitLiteralFallback(n);
    } else if (n instanceof ModelicaComponentReferenceSyntaxNode) {
      return this.visitComponentReference(n);
    } else if (n instanceof ModelicaBinaryExpressionSyntaxNode) {
      return this.visitBinaryExpression(n);
    } else if (n instanceof ModelicaUnaryExpressionSyntaxNode) {
      return this.visitUnaryExpression(n);
    } else if (n instanceof ModelicaFunctionCallSyntaxNode) {
      return this.visitFunctionCall(n);
    } else if (n instanceof ModelicaIfElseExpressionSyntaxNode) {
      return this.visitIfElseExpression(n);
    } else if (n instanceof ModelicaRangeExpressionSyntaxNode) {
      return this.visitRangeExpression(n);
    } else if (n instanceof ModelicaArrayConstructorSyntaxNode) {
      return this.visitArrayConstructor(n);
    }

    // Fallback: if it's an unrecognized node, drill down into common children.
    if (n.expression) {
      return this.visit(n.expression);
    }
    if (n.term) {
      return this.visit(n.term);
    }
    if (n.factor) {
      return this.visit(n.factor);
    }

    // Unhandled node type
    console.warn(`ArenaExprVisitor: Unhandled expression node type: ${n.constructor?.name}`);
    return undefined;
  }

  /**
   * Fallback for ModelicaLiteralSyntaxNode subclasses we haven't matched.
   * Attempts to parse the text as a number or string.
   */
  private visitLiteralFallback(node: ModelicaLiteralSyntaxNode): number | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (node as any).text as string | null;
    if (!text) return undefined;

    if (text === "true") return this.dae.addBoolLiteral(true);
    if (text === "false") return this.dae.addBoolLiteral(false);

    const num = Number(text);
    if (!isNaN(num)) {
      if (text.includes(".") || text.includes("e") || text.includes("E")) {
        return this.dae.addRealLiteral(num);
      }
      return this.dae.addIntLiteral(num);
    }

    // String literal (already unquoted by AST constructor for StringLiteral)
    return this.dae.addStringLiteral(text);
  }

  private visitComponentReference(node: ModelicaComponentReferenceSyntaxNode): number | undefined {
    let path = "";
    let baseId: number | undefined = undefined;

    for (const part of node.parts) {
      const ident = part.identifier?.text;
      if (!ident) return undefined;

      // If we had a dynamic subscript previously, we cannot easily append '.ident' natively.
      // So if baseId is already set (meaning we emitted a dynamic Subscript), we're in trouble.
      // But standard Modelica flattening assumes array indices can be resolved statically.
      if (path.length > 0) path += ".";
      path += ident;

      if (part.arraySubscripts && part.arraySubscripts.subscripts.length > 0) {
        const subIds: number[] = [];
        let allStatic = true;
        let staticSuffix = "";

        for (const sub of part.arraySubscripts.subscripts) {
          if (!sub.expression) continue;
          const subId = this.visit(sub.expression);
          if (subId === undefined) return undefined;
          subIds.push(subId);

          if (this.dae.getExprKind(subId) === ExprKind.IntLiteral) {
            staticSuffix += `[${this.dae.getExprData1(subId)}]`;
          } else {
            allStatic = false;
          }
        }

        if (allStatic) {
          path += staticSuffix;
        } else {
          // Dynamic subscript. We emit a Name expr for the path so far, then a Subscript expr.
          const currentBase = this.dae.addNameExpr(path);
          baseId = this.dae.addSubscriptExpr(currentBase, subIds);
        }
      }
    }

    if (baseId !== undefined) {
      return baseId; // Return the dynamic subscript expression
    }

    // Check if this reference is a loop variable — substitute with IntLiteral
    if (this.loopVars.has(path)) {
      return this.dae.addIntLiteral(this.loopVars.get(path) as number);
    }

    // Emit a Name expression
    return this.dae.addNameExpr(path);
  }

  private visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode): number | undefined {
    const leftId = this.visit(node.operand1);
    const rightId = this.visit(node.operand2);
    if (leftId === undefined || rightId === undefined) return undefined;

    const op = node.operator;
    let binOp: BinOp;
    switch (op) {
      case ModelicaBinaryOperator.ADDITION:
        binOp = BinOp.Add;
        break;
      case ModelicaBinaryOperator.SUBTRACTION:
        binOp = BinOp.Sub;
        break;
      case ModelicaBinaryOperator.MULTIPLICATION:
        binOp = BinOp.Mul;
        break;
      case ModelicaBinaryOperator.DIVISION:
        binOp = BinOp.Div;
        break;
      case ModelicaBinaryOperator.EXPONENTIATION:
        binOp = BinOp.Pow;
        break;
      case ModelicaBinaryOperator.EQUALITY:
        binOp = BinOp.Eq;
        break;
      case ModelicaBinaryOperator.INEQUALITY:
        binOp = BinOp.Neq;
        break;
      case ModelicaBinaryOperator.LESS_THAN:
        binOp = BinOp.Lt;
        break;
      case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
        binOp = BinOp.Lte;
        break;
      case ModelicaBinaryOperator.GREATER_THAN:
        binOp = BinOp.Gt;
        break;
      case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
        binOp = BinOp.Gte;
        break;
      case ModelicaBinaryOperator.LOGICAL_AND:
        binOp = BinOp.And;
        break;
      case ModelicaBinaryOperator.LOGICAL_OR:
        binOp = BinOp.Or;
        break;
      case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
        binOp = BinOp.ElemAdd;
        break;
      case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
        binOp = BinOp.ElemSub;
        break;
      case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
        binOp = BinOp.ElemMul;
        break;
      case ModelicaBinaryOperator.ELEMENTWISE_DIVISION:
        binOp = BinOp.ElemDiv;
        break;
      case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION:
        binOp = BinOp.ElemPow;
        break;
      default:
        console.warn(`ArenaExprVisitor: Unhandled binary operator: ${op}`);
        return undefined;
    }

    const resultId = this.dae.addBinaryExpr(binOp, leftId, rightId);

    // Extract zero-crossing event indicators (operand1 - operand2)
    if (
      !this.inNoEvent &&
      (binOp === BinOp.Eq ||
        binOp === BinOp.Neq ||
        binOp === BinOp.Lt ||
        binOp === BinOp.Lte ||
        binOp === BinOp.Gt ||
        binOp === BinOp.Gte)
    ) {
      const diffId = this.dae.addBinaryExpr(BinOp.Sub, leftId, rightId);
      this.dae.eventIndicatorExprIds.push(diffId);
    }

    return resultId;
  }

  private visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode): number | undefined {
    const exprId = this.visit(node.operand);
    if (exprId === undefined) return undefined;

    const op = node.operator;
    let unOp: UnaryOp;
    switch (op) {
      case ModelicaUnaryOperator.UNARY_MINUS:
      case ModelicaUnaryOperator.ELEMENTWISE_UNARY_MINUS:
        unOp = UnaryOp.Negate;
        break;
      case ModelicaUnaryOperator.LOGICAL_NEGATION:
        unOp = UnaryOp.Not;
        break;
      case ModelicaUnaryOperator.UNARY_PLUS:
      case ModelicaUnaryOperator.ELEMENTWISE_UNARY_PLUS:
        return exprId; // Positive is a no-op
      default:
        console.warn(`ArenaExprVisitor: Unhandled unary operator: ${op}`);
        return undefined;
    }

    return this.dae.addUnaryExpr(unOp, exprId);
  }

  private visitIfElseExpression(node: ModelicaIfElseExpressionSyntaxNode): number | undefined {
    const condId = this.visit(node.condition);
    const thenId = this.visit(node.expression);
    let elseId = this.visit(node.elseExpression);

    if (condId === undefined || thenId === undefined) return undefined;

    // Use -1 if no else clause (though usually required in Modelica expressions)
    if (elseId === undefined) elseId = -1;

    // Modelica parses else-ifs, need to nest them from back to front
    if (node.elseIfExpressionClauses && node.elseIfExpressionClauses.length > 0) {
      for (let i = node.elseIfExpressionClauses.length - 1; i >= 0; i--) {
        const clause = node.elseIfExpressionClauses[i];
        if (clause) {
          const cCondId = this.visit(clause.condition);
          const cThenId = this.visit(clause.expression);
          if (cCondId !== undefined && cThenId !== undefined) {
            elseId = this.dae.addIfElseExpr(cCondId, cThenId, elseId);
          }
        }
      }
    }

    return this.dae.addIfElseExpr(condId, thenId, elseId);
  }

  private visitRangeExpression(node: ModelicaRangeExpressionSyntaxNode): number | undefined {
    const startId = this.visit(node.startExpression);
    const stopId = this.visit(node.stopExpression);
    if (startId === undefined || stopId === undefined) return undefined;

    if (node.stepExpression) {
      const stepId = this.visit(node.stepExpression);
      if (stepId !== undefined) {
        return this.dae.addRangeExpr(startId, stopId, stepId);
      }
    }
    return this.dae.addRangeExpr(startId, stopId);
  }

  private visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode): number | undefined {
    const elementIds: number[] = [];
    if (node.expressionList?.expressions) {
      for (const expr of node.expressionList.expressions) {
        const id = this.visit(expr);
        if (id !== undefined) elementIds.push(id);
      }
    }
    return this.dae.addArrayCtorExpr(elementIds);
  }

  private visitFunctionCall(node: ModelicaFunctionCallSyntaxNode): number | undefined {
    const funcName = node.functionReferenceName;
    if (!funcName) return undefined;

    // Collect positional arguments from FunctionCallArguments.arguments[]
    const getArgExprs = (): number[] => {
      const ids: number[] = [];
      if (node.functionCallArguments?.arguments) {
        for (const arg of node.functionCallArguments.arguments) {
          // Each FunctionArgumentSyntaxNode has an expression child
          const id = this.visit(arg.expression);
          if (id !== undefined) ids.push(id);
        }
      }
      return ids;
    };

    // Specialized: der(x)
    if (funcName === "der") {
      const argIds = getArgExprs();
      if (argIds.length > 0) {
        return this.dae.addDerExpr(argIds[0] as number);
      }
    }

    // Specialized: pre(x)
    if (funcName === "pre") {
      const argIds = getArgExprs();
      if (argIds.length > 0) {
        return this.dae.addPreExpr(argIds[0] as number);
      }
    }

    // Specialized: noEvent(x) — pass through
    if (funcName === "noEvent") {
      const oldNoEvent = this.inNoEvent;
      this.inNoEvent = true;
      const argIds = getArgExprs();
      this.inNoEvent = oldNoEvent;
      if (argIds.length > 0) {
        return argIds[0] as number;
      }
    }

    // General function call
    if (this.onFunctionCall) {
      this.onFunctionCall(funcName);
    }
    const argIds = getArgExprs();
    return this.dae.addCallExpr(funcName, argIds);
  }
}
