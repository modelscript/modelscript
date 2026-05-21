import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp, VarType } from "@modelscript/compiler";
import {
  ModelicaArrayConstructorSyntaxNode,
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaBinaryOperator,
  ModelicaBooleanLiteralSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaFunctionPartialApplicationSyntaxNode,
  ModelicaIfElseExpressionSyntaxNode,
  ModelicaLiteralSyntaxNode,
  ModelicaOutputExpressionListSyntaxNode,
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
    private cardinalityMap?: Map<string, number>,
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
    } else if (n instanceof ModelicaFunctionPartialApplicationSyntaxNode) {
      return this.visitPartialApplication(n);
    } else if (n instanceof ModelicaIfElseExpressionSyntaxNode) {
      return this.visitIfElseExpression(n);
    } else if (n instanceof ModelicaOutputExpressionListSyntaxNode) {
      return this.visitOutputExpressionList(n);
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

    // Fallback for raw CST nodes that don't have AST wrapper classes.
    // Tree-sitter produces "true"/"false" node types for Boolean literals,
    // but the AST expects "BOOLEAN" type so ModelicaSyntaxNode.new returns null.
    const cstType = n.concreteSyntaxNode?.type ?? n.type;
    const cstText = n.concreteSyntaxNode?.text ?? n.text;
    if (cstType === "true" || cstText === "true") {
      return this.dae.addBoolLiteral(true);
    }
    if (cstType === "false" || cstText === "false") {
      return this.dae.addBoolLiteral(false);
    }

    // Unhandled node type
    console.warn(`ArenaExprVisitor: Unhandled expression node type: ${n.constructor?.name}`);
    return undefined;
  }

  private visitOutputExpressionList(node: ModelicaOutputExpressionListSyntaxNode): number | undefined {
    if (node.outputs.length === 1) {
      return this.visit(node.outputs[0]);
    }
    const elementIds: number[] = [];
    for (const output of node.outputs) {
      if (output) {
        const id = this.visit(output);
        if (id !== undefined) {
          elementIds.push(id);
          continue;
        }
      }
      elementIds.push(-1);
    }
    return this.dae.addTupleExpr(elementIds);
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
    let leftId = this.visit(node.operand1);
    let rightId = this.visit(node.operand2);
    if (leftId === undefined || rightId === undefined) return undefined;

    // Coerce operands if one is Real-typed and the other is not
    const leftReal = this.isRealTypedExpr(leftId);
    const rightReal = this.isRealTypedExpr(rightId);
    if (leftReal && !rightReal) {
      rightId = this.castToRealExpr(rightId);
    } else if (rightReal && !leftReal) {
      leftId = this.castToRealExpr(leftId);
    }

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

    if (unOp === UnaryOp.Negate) {
      // Optimize: negate literal → negative literal (avoid Negate wrapper)
      const operandKind = this.dae.getExprKind(exprId);
      if (operandKind === ExprKind.RealLiteral) {
        const val = this.dae.getExprRealValue(exprId);
        return this.dae.addRealLiteral(-val);
      }
      if (operandKind === ExprKind.IntLiteral) {
        const val = this.dae.getExprData1(exprId);
        return this.dae.addIntLiteral(-val);
      }
      // Negation distribution: -(a * b) → (-a) * b
      if (operandKind === ExprKind.Binary) {
        const binOp = this.dae.getExprData1(exprId);
        if (binOp === BinOp.Mul || binOp === BinOp.ElemMul) {
          const a = this.dae.getExprLeft(exprId);
          const b = this.dae.getExprRight(exprId);
          let negatedA: number;
          const aKind = this.dae.getExprKind(a);
          if (aKind === ExprKind.RealLiteral) {
            negatedA = this.dae.addRealLiteral(-this.dae.getExprRealValue(a));
          } else if (aKind === ExprKind.IntLiteral) {
            negatedA = this.dae.addIntLiteral(-this.dae.getExprData1(a));
          } else {
            negatedA = this.dae.addUnaryExpr(UnaryOp.Negate, a);
          }
          return this.dae.addBinaryExpr(binOp, negatedA, b);
        }
      }
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
      return argIds.length > 0 ? this.dae.addDerExpr(argIds[0] as number) : undefined;
    }

    // Specialized: pre(x)
    if (funcName === "pre") {
      const argIds = getArgExprs();
      return argIds.length > 0 ? this.dae.addPreExpr(argIds[0] as number) : undefined;
    }

    // Specialized: noEvent(x) — pass through, suppressing event indicator extraction
    if (funcName === "noEvent") {
      const oldNoEvent = this.inNoEvent;
      this.inNoEvent = true;
      const argIds = getArgExprs();
      this.inNoEvent = oldNoEvent;
      return argIds.length > 0 ? (argIds[0] as number) : undefined;
    }

    // Specialized: cardinality(x) — resolve from pre-computed cardinality map
    if (funcName === "cardinality" && this.cardinalityMap) {
      const argIds = getArgExprs();
      if (argIds.length > 0) {
        const argId = argIds[0];
        if (argId !== undefined) {
          const argKind = this.dae.getExprKind(argId);
          if (argKind === ExprKind.Name) {
            const nameStr = this.dae.interner.resolve(this.dae.getExprData1(argId));
            const count = this.cardinalityMap.get(nameStr) ?? 0;
            return this.dae.addIntLiteral(count);
          }
        }
      }
      // Fallback: return 0
      return this.dae.addIntLiteral(0);
    }

    // General function call — trigger function collection callback
    if (this.onFunctionCall) {
      this.onFunctionCall(funcName);
    }
    const argIds = getArgExprs();
    return this.dae.addCallExpr(funcName, argIds);
  }

  /**
   * Handle partial function application: `function Foo(x = val, ...)`
   * Emits a call expression with the bound arguments.
   */
  private visitPartialApplication(node: ModelicaFunctionPartialApplicationSyntaxNode): number | undefined {
    const funcName = node.typeSpecifier?.text;
    if (!funcName) return undefined;

    // Collect named arguments from the partial application
    const argIds: number[] = [];
    const namedArgs = node.namedArguments ?? [];
    for (const arg of namedArgs) {
      const id = this.visit(arg.argument?.expression);
      if (id !== undefined) argIds.push(id);
    }

    // Notify function collector
    if (this.onFunctionCall) {
      this.onFunctionCall(funcName);
    }

    // Emit as a regular call expression (monomorphized at this point)
    return this.dae.addCallExpr(funcName, argIds);
  }

  public isRealTypedExpr(exprId: number): boolean {
    const kind = this.dae.getExprKind(exprId);
    if (kind === ExprKind.Name) {
      const nameId = this.dae.getExprData1(exprId);
      const name = this.dae.interner.resolve(nameId);
      if (name) {
        const varIdx = this.dae.getVarIdxByName(name);
        if (varIdx >= 0) {
          return this.dae.getVarType(varIdx) === VarType.Real;
        }
      }
    }
    if (kind === ExprKind.RealLiteral) {
      return true;
    }
    if (kind === ExprKind.Binary) {
      const op1 = this.dae.getExprLeft(exprId);
      const op2 = this.dae.getExprRight(exprId);
      return this.isRealTypedExpr(op1) || this.isRealTypedExpr(op2);
    }
    if (kind === ExprKind.Unary) {
      const operand = this.dae.getExprLeft(exprId);
      return this.isRealTypedExpr(operand);
    }
    if (kind === ExprKind.Der) {
      return true;
    }
    return false;
  }

  public castToRealExpr(exprId: number): number {
    const kind = this.dae.getExprKind(exprId);
    if (kind === ExprKind.IntLiteral) {
      const val = this.dae.getExprData1(exprId);
      return this.dae.addRealLiteral(val);
    }
    if (kind === ExprKind.ArrayCtor) {
      const count = this.dae.getExprData1(exprId);
      if (count === 0) return exprId;
      const firstElem = this.dae.getExprLeft(exprId);
      const elements: number[] = [];
      elements.push(this.castToRealExpr(firstElem));
      for (let i = 1; i < count; i++) {
        const tupleExprId = firstElem + i;
        const elemId = this.dae.getExprRight(tupleExprId);
        elements.push(this.castToRealExpr(elemId));
      }
      return this.dae.addArrayCtorExpr(elements);
    }
    if (kind === ExprKind.Unary) {
      const op = this.dae.getExprData1(exprId);
      const operand = this.dae.getExprLeft(exprId);
      const casted = this.castToRealExpr(operand);
      if (casted !== operand) {
        return this.dae.addUnaryExpr(op, casted);
      }
    }
    if (kind === ExprKind.Binary) {
      const op = this.dae.getExprData1(exprId);
      const op1 = this.dae.getExprLeft(exprId);
      const op2 = this.dae.getExprRight(exprId);
      const casted1 = this.castToRealExpr(op1);
      const casted2 = this.castToRealExpr(op2);
      if (casted1 !== op1 || casted2 !== op2) {
        return this.dae.addBinaryExpr(op, casted1, casted2);
      }
    }
    return exprId;
  }
}
