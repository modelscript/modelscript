import {
  ArenaDAEBuilder,
  BinOp,
  Causality,
  evaluateArenaExpression,
  evaluateArenaFunctionCall,
  ExprKind,
  inferArenaExprVarType,
  UnaryOp,
  VarType,
  type ArenaValue,
  type QueryDB,
  type SymbolId,
} from "@modelscript/compiler";
import {
  ModelicaArrayConcatenationSyntaxNode,
  ModelicaArrayConstructorSyntaxNode,
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaBinaryOperator,
  ModelicaBooleanLiteralSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaExpressionSyntaxNode,
  ModelicaForIndexSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaFunctionPartialApplicationSyntaxNode,
  ModelicaIdentifierSyntaxNode,
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

// ── Built-in function metadata for compile-time folding ──

interface BuiltinFoldDef {
  fold1?: (x: number) => number;
  fold2?: (a: number, b: number) => number;
  outputType?: string;
  preserveIntegerType?: boolean;
  identityValue?: number;
  reduction?: boolean;
  foldConstants?: (values: number[]) => number;
}

const ARENA_BUILTIN_FOLDS = new Map<string, BuiltinFoldDef>([
  ["abs", { fold1: Math.abs, preserveIntegerType: true }],
  ["sign", { fold1: Math.sign, outputType: "Integer", preserveIntegerType: true }],
  ["sqrt", { fold1: Math.sqrt }],
  ["integer", { fold1: Math.floor, outputType: "Integer" }],
  ["sin", { fold1: Math.sin }],
  ["cos", { fold1: Math.cos }],
  ["tan", { fold1: Math.tan }],
  ["asin", { fold1: Math.asin }],
  ["acos", { fold1: Math.acos }],
  ["atan", { fold1: Math.atan }],
  ["atan2", { fold2: Math.atan2 }],
  ["sinh", { fold1: Math.sinh }],
  ["cosh", { fold1: Math.cosh }],
  ["tanh", { fold1: Math.tanh }],
  ["exp", { fold1: Math.exp }],
  ["log", { fold1: Math.log }],
  ["log10", { fold1: Math.log10 }],
  ["ceil", { fold1: Math.ceil }],
  ["floor", { fold1: Math.floor }],
  ["div", { fold2: (a, b) => (b !== 0 ? Math.trunc(a / b) : NaN), outputType: "Integer" }],
  ["mod", { fold2: (a, b) => (b !== 0 ? a - Math.floor(a / b) * b : NaN) }],
  ["rem", { fold2: (a, b) => (b !== 0 ? a - Math.trunc(a / b) * b : NaN) }],
  [
    "min",
    { fold2: Math.min, reduction: true, foldConstants: (v) => Math.min(...v), identityValue: 8.777798510069901e304 },
  ],
  [
    "max",
    { fold2: Math.max, reduction: true, foldConstants: (v) => Math.max(...v), identityValue: -8.777798510069901e304 },
  ],
  ["sum", { reduction: true, foldConstants: (v) => v.reduce((a, b) => a + b, 0), identityValue: 0 }],
  ["product", { reduction: true, foldConstants: (v) => v.reduce((a, b) => a * b, 1), identityValue: 1 }],
]);

/**
 * Translates a Modelica CST/AST expression tree into integer-based `ExprId`s
 * inside the given `ArenaDAEBuilder`.
 */

// ── Operator name mapping for operator record dispatch ──

/** Map from ModelicaBinaryOperator enum to the quoted Modelica operator name. */
const BINARY_OP_TO_MODELICA: Record<string, string> = {
  [ModelicaBinaryOperator.ADDITION]: "'+'",
  [ModelicaBinaryOperator.SUBTRACTION]: "'-'",
  [ModelicaBinaryOperator.MULTIPLICATION]: "'*'",
  [ModelicaBinaryOperator.DIVISION]: "'/'",
  [ModelicaBinaryOperator.EXPONENTIATION]: "'^'",
  [ModelicaBinaryOperator.EQUALITY]: "'=='",
  [ModelicaBinaryOperator.INEQUALITY]: "'<>'",
  [ModelicaBinaryOperator.LESS_THAN]: "'<'",
  [ModelicaBinaryOperator.LESS_THAN_OR_EQUAL]: "'<='",
  [ModelicaBinaryOperator.GREATER_THAN]: "'>'",
  [ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL]: "'>='",
  [ModelicaBinaryOperator.LOGICAL_AND]: "'and'",
  [ModelicaBinaryOperator.LOGICAL_OR]: "'or'",
};

/** Map from ModelicaUnaryOperator enum to the quoted Modelica operator name. */
const UNARY_OP_TO_MODELICA: Record<string, string> = {
  [ModelicaUnaryOperator.UNARY_MINUS]: "'-'",
  [ModelicaUnaryOperator.LOGICAL_NEGATION]: "'not'",
};

/** Predefined scalar types that are NOT operator records. */
const BUILTIN_SCALAR_TYPES = new Set(["Real", "Integer", "Boolean", "String"]);

/** Names that should never be prefixed (Modelica built-in variables). */
const BUILTIN_NAMES = new Set(["time"]);

export class ArenaExprVisitor {
  private loopVars: Map<string, number>;
  private localIterators: Set<string>;
  private inNoEvent = false;
  constructor(
    private dae: ArenaDAEBuilder,
    loopVars?: Map<string, number>,
    private onFunctionCall?: (funcName: string) => string | undefined,
    private cardinalityMap?: Map<string, number>,
    private resolveFunctionInputs?: (funcName: string) => string[],
    private namePrefix?: string,
    private db?: QueryDB,
    private scopeId?: SymbolId,
    localIterators?: Set<string>,
  ) {
    this.loopVars = loopVars ?? new Map();
    this.localIterators = localIterators ?? new Set();
  }

  /** Apply the name prefix to a path, unless it's a built-in or already qualified. */
  private prefixName(path: string): string {
    if (!this.namePrefix || BUILTIN_NAMES.has(path) || this.localIterators.has(path)) return path;
    return `${this.namePrefix}.${path}`;
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
    } else if (n instanceof ModelicaIdentifierSyntaxNode) {
      const text = n.text;
      if (text) {
        if (this.loopVars.has(text)) {
          return this.dae.addIntLiteral(this.loopVars.get(text) as number);
        }
        const pref = this.prefixName(text);
        return this.dae.addNameExpr(pref);
      }
      return undefined;
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
    } else if (
      n.type === "ModelicaArrayConcatenationSyntaxNode" ||
      n.constructor?.name === "ModelicaArrayConcatenationSyntaxNode"
    ) {
      return this.visitArrayConcatenation(n);
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

  private unrollComprehension(
    forIndexes: ModelicaForIndexSyntaxNode[],
    indexPos: number,
    expression: ModelicaExpressionSyntaxNode,
    loopVars: Map<string, number>,
  ): number[] | undefined {
    if (indexPos >= forIndexes.length) {
      const visitor = new ArenaExprVisitor(
        this.dae,
        loopVars,
        this.onFunctionCall,
        this.cardinalityMap,
        this.resolveFunctionInputs,
        this.namePrefix,
        this.db,
        this.scopeId,
        this.localIterators,
      );
      const exprId = visitor.visit(expression);
      return exprId !== undefined ? [exprId] : undefined;
    }

    const forIndex = forIndexes[indexPos];
    if (!forIndex) return undefined;

    const indexName = forIndex.identifier?.text ?? "";
    if (!indexName) return undefined;

    const rangeValues = this.evaluateForRange(forIndex, loopVars);
    if (!rangeValues) return undefined;

    const results: number[] = [];
    for (const val of rangeValues) {
      const newVars = new Map(loopVars);
      newVars.set(indexName, val);
      const subResults = this.unrollComprehension(forIndexes, indexPos + 1, expression, newVars);
      if (!subResults) return undefined;
      results.push(...subResults);
    }
    return results;
  }

  private evaluateForRange(forIndex: ModelicaForIndexSyntaxNode, loopVars: Map<string, number>): number[] | null {
    if (!forIndex.expression) return null;

    const visitor = new ArenaExprVisitor(
      this.dae,
      loopVars,
      this.onFunctionCall,
      this.cardinalityMap,
      this.resolveFunctionInputs,
      this.namePrefix,
      this.db,
      this.scopeId,
      this.localIterators,
    );
    const rangeExprId = visitor.visit(forIndex.expression);
    if (rangeExprId === undefined) return null;

    // Check if it's a Range expression
    if (this.dae.getExprKind(rangeExprId) === ExprKind.Range) {
      const startId = this.dae.getExprData1(rangeExprId);
      const stepId = this.dae.getExprLeft(rangeExprId);
      const stopId = this.dae.getExprRight(rangeExprId);

      const startVal = evaluateArenaExpression(this.dae, startId, undefined, this.db, this.scopeId);
      const stopVal = evaluateArenaExpression(this.dae, stopId, undefined, this.db, this.scopeId);
      if (typeof startVal !== "number" || typeof stopVal !== "number") return null;

      let stepVal = 1;
      if (stepId >= 0) {
        const sv = evaluateArenaExpression(this.dae, stepId, undefined, this.db, this.scopeId);
        if (typeof sv === "number") stepVal = sv;
      }

      const result: number[] = [];
      if (stepVal > 0) {
        for (let i = startVal; i <= stopVal; i += stepVal) result.push(i);
      } else if (stepVal < 0) {
        for (let i = startVal; i >= stopVal; i += stepVal) result.push(i);
      }
      return result;
    }

    const val = evaluateArenaExpression(this.dae, rangeExprId, undefined, this.db, this.scopeId);
    if (typeof val === "number") return [val];

    return null;
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
          // Handle flexible subscript (:) — whole-dimension slice
          if (sub.flexible) {
            subIds.push(this.dae.addColonExpr());
            allStatic = false;
            continue;
          }
          if (!sub.expression) continue;
          const subId = this.visit(sub.expression);
          if (subId === undefined) return undefined;
          subIds.push(subId);

          // Check if subscript is a compile-time constant integer.
          // This handles both literal subscripts (x[3]) and loop variable
          // expressions (x[i+1] where i is substituted during for-loop unrolling).
          const exprKind = this.dae.getExprKind(subId);
          if (exprKind === ExprKind.IntLiteral) {
            staticSuffix += `[${this.dae.getExprData1(subId)}]`;
          } else {
            // Try to evaluate non-literal subscript expressions (e.g., i+1, 2*j-1)
            const evaluated = evaluateArenaExpression(this.dae, subId);
            if (typeof evaluated === "number" && Number.isInteger(evaluated)) {
              staticSuffix += `[${evaluated}]`;
              // Replace the complex expression with a plain IntLiteral for downstream use
              subIds[subIds.length - 1] = this.dae.addIntLiteral(evaluated);
            } else {
              allStatic = false;
            }
          }
        }

        if (allStatic) {
          path += staticSuffix;
        } else {
          // Dynamic subscript or slice. We emit a Name expr for the path so far, then a Subscript expr.
          const currentBase = this.dae.addNameExpr(this.prefixName(path));
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
    return this.dae.addNameExpr(this.prefixName(path));
  }

  private visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode): number | undefined {
    let leftId = this.visit(node.operand1);
    let rightId = this.visit(node.operand2);
    if (leftId === undefined || rightId === undefined) return undefined;

    const op = node.operator;

    // --- Operator record dispatch ---
    // Check if either operand is an operator record type. If so, dispatch
    // to the matching operator function instead of emitting a primitive BinOp.
    const operatorCallId = this.tryOperatorOverloadBinary(op, node, leftId, rightId);
    if (operatorCallId !== undefined) return operatorCallId;

    // Coerce operands if one is Real-typed and the other is not
    const leftReal = this.isRealTypedExpr(leftId);
    const rightReal = this.isRealTypedExpr(rightId);
    if (leftReal && !rightReal) {
      rightId = this.castToRealExpr(rightId);
    } else if (rightReal && !leftReal) {
      leftId = this.castToRealExpr(leftId);
    }

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

    // --- Operator record dispatch for unary ---
    const operatorCallId = this.tryOperatorOverloadUnary(op, node, exprId);
    if (operatorCallId !== undefined) return operatorCallId;

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
    if (node.comprehensionClause) {
      const compClause = node.comprehensionClause;
      if (compClause.expression) {
        const unrolled = this.unrollComprehension(compClause.forIndexes, 0, compClause.expression, this.loopVars);
        if (unrolled) {
          return this.dae.addArrayCtorExpr(unrolled);
        }

        const nextLocalIters = new Set(this.localIterators);
        for (const idx of compClause.forIndexes) {
          const name = idx.identifier?.text;
          if (name) nextLocalIters.add(name);
        }
        const bodyVisitor = new ArenaExprVisitor(
          this.dae,
          this.loopVars,
          this.onFunctionCall,
          this.cardinalityMap,
          this.resolveFunctionInputs,
          this.namePrefix,
          this.db,
          this.scopeId,
          nextLocalIters,
        );
        const bodyId = bodyVisitor.visit(compClause.expression);
        if (bodyId === undefined) return undefined;
        const iteratorCount = compClause.forIndexes?.length ?? 0;
        return this.dae.addComprehensionExpr("array", bodyId, iteratorCount);
      }
    }

    const elementIds: number[] = [];
    if (node.expressionList?.expressions) {
      for (const expr of node.expressionList.expressions) {
        const id = this.visit(expr);
        if (id !== undefined) elementIds.push(id);
      }
    }
    return this.dae.addArrayCtorExpr(elementIds);
  }

  private visitArrayConcatenation(node: ModelicaArrayConcatenationSyntaxNode): number | undefined {
    const rows: number[] = [];
    for (const expressionList of node.expressionLists ?? []) {
      const rowElements: number[] = [];
      for (const expression of expressionList.expressions ?? []) {
        const id = this.visit(expression);
        if (id !== undefined) {
          rowElements.push(id);
        }
      }
      const firstRowElement = rowElements[0];
      if (
        rowElements.length === 1 &&
        firstRowElement !== undefined &&
        this.dae.getExprKind(firstRowElement) === ExprKind.ArrayCtor
      ) {
        rows.push(firstRowElement);
      } else if (rowElements.length > 0) {
        rows.push(this.dae.addArrayCtorExpr(rowElements));
      }
    }
    if (rows.length === 0) return undefined;
    if (rows.length === 1) return rows[0];
    return this.dae.addArrayCtorExpr(rows);
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
          // Also handle function partial applications as arguments
          if (arg.functionPartialApplication) {
            const id = this.visitPartialApplication(arg.functionPartialApplication);
            if (id !== undefined) ids.push(id);
          } else {
            const id = this.visit(arg.expression);
            if (id !== undefined) ids.push(id);
          }
        }
      }
      return ids;
    };

    // Collect named arguments from FunctionCallArguments.namedArguments[]
    const getNamedArgs = (): { name: string; exprId: number }[] => {
      const result: { name: string; exprId: number }[] = [];
      if (node.functionCallArguments?.namedArguments) {
        for (const namedArg of node.functionCallArguments.namedArguments) {
          const argName = namedArg.identifier?.text;
          if (!argName) continue;
          const id = this.visit(namedArg.argument?.expression);
          if (id !== undefined) result.push({ name: argName, exprId: id });
        }
      }
      return result;
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

    // Specialized: smooth(p, expr) — pass through as generic call (semantically a hint)
    // Specialized: sample(start, interval) — coerce arguments to Real
    if (funcName === "sample") {
      const argIds = getArgExprs().map((id) => this.castToRealExpr(id));
      const namedArgs = getNamedArgs().map((na) => ({ name: na.name, exprId: this.castToRealExpr(na.exprId) }));
      for (const na of namedArgs) argIds.push(na.exprId);
      return this.dae.addCallExpr(funcName, argIds);
    }
    // Specialized: initial() / terminal() — zero-arg built-ins
    // Specialized: edge(b) / change(b) — pass through as generic call
    // These are all correctly handled as generic calls below, no special arena treatment needed.

    // Specialized: Integer(enumVal) — type cast from enumeration to integer
    if (funcName === "Integer") {
      const argIds = getArgExprs();
      if (argIds.length > 0) {
        const argId = argIds[0];
        if (argId !== undefined) {
          // If the argument is an enum literal, extract its ordinal value
          if (this.dae.getExprKind(argId) === ExprKind.EnumLiteral) {
            return this.dae.addIntLiteral(this.dae.getExprData1(argId));
          }
          // Otherwise emit as a generic call
          return this.dae.addCallExpr(funcName, argIds);
        }
      }
      return undefined;
    }

    // Specialized: Real(x) — type cast to real
    if (funcName === "Real") {
      const argIds = getArgExprs();
      if (argIds.length > 0) {
        const argId = argIds[0];
        if (argId !== undefined) {
          return this.castToRealExpr(argId);
        }
      }
      return undefined;
    }

    // Check for comprehension/reduction syntax: func(expr for i in range)
    if (node.functionCallArguments?.comprehensionClause) {
      const compClause = node.functionCallArguments.comprehensionClause;
      if (compClause.expression) {
        const unrolled = this.unrollComprehension(compClause.forIndexes, 0, compClause.expression, this.loopVars);
        if (unrolled) {
          if (funcName === "sum") {
            if (unrolled.length === 0) return this.dae.addRealLiteral(0.0);
            return unrolled.reduce((acc, curr) => this.dae.addBinaryExpr(BinOp.Add, acc, curr));
          } else if (funcName === "product") {
            if (unrolled.length === 0) return this.dae.addRealLiteral(1.0);
            return unrolled.reduce((acc, curr) => this.dae.addBinaryExpr(BinOp.Mul, acc, curr));
          } else if (funcName === "min") {
            if (unrolled.length === 0) return this.dae.addArrayCtorExpr([]);
            return unrolled.reduce((acc, curr) => this.dae.addCallExpr("min", [acc, curr]));
          } else if (funcName === "max") {
            if (unrolled.length === 0) return this.dae.addArrayCtorExpr([]);
            return unrolled.reduce((acc, curr) => this.dae.addCallExpr("max", [acc, curr]));
          }
          return this.dae.addArrayCtorExpr(unrolled);
        }

        const nextLocalIters = new Set(this.localIterators);
        for (const idx of compClause.forIndexes) {
          const name = idx.identifier?.text;
          if (name) nextLocalIters.add(name);
        }
        const bodyVisitor = new ArenaExprVisitor(
          this.dae,
          this.loopVars,
          this.onFunctionCall,
          this.cardinalityMap,
          this.resolveFunctionInputs,
          this.namePrefix,
          this.db,
          this.scopeId,
          nextLocalIters,
        );
        const bodyId = bodyVisitor.visit(compClause.expression);
        if (bodyId === undefined) return undefined;
        const iteratorCount = compClause.forIndexes?.length ?? 0;
        return this.dae.addComprehensionExpr(funcName, bodyId, iteratorCount);
      }
    }

    // Specialized: fill(s, n1, n2, ...) — expand to array constructor
    if (funcName === "fill") {
      const argIds = getArgExprs();
      if (argIds.length >= 2) {
        return this.expandFill(argIds);
      }
    }

    // Specialized: zeros(n1, n2, ...) — expand to array of zeros
    if (funcName === "zeros") {
      const argIds = getArgExprs();
      if (argIds.length >= 1) {
        return this.expandFillValue(argIds, 0);
      }
    }

    // Specialized: ones(n1, n2, ...) — expand to array of ones
    if (funcName === "ones") {
      const argIds = getArgExprs();
      if (argIds.length >= 1) {
        return this.expandFillValue(argIds, 1);
      }
    }

    // Specialized: identity(n) — expand to identity matrix
    if (funcName === "identity") {
      const argIds = getArgExprs();
      if (argIds.length >= 1) {
        const argId = argIds[0];
        if (argId !== undefined) {
          return this.expandIdentity(argId);
        }
      }
    }

    // General function call — collect positional + named arguments
    const argIds = getArgExprs();
    const namedArgs = getNamedArgs();

    // Attempt compile-time constant folding for built-in functions
    const folded = this.tryFoldBuiltinCall(funcName, argIds);
    if (folded !== undefined) return folded;

    // Trigger function collection callback for non-builtins
    let effectiveFuncName = funcName;
    if (this.onFunctionCall) {
      const qualifiedName = this.onFunctionCall(funcName);
      if (typeof qualifiedName === "string") effectiveFuncName = qualifiedName;
    }

    // If there are named arguments, append them after positional args
    // (named args are resolved positionally by the function definition)
    if (namedArgs.length > 0) {
      for (const na of namedArgs) {
        argIds.push(na.exprId);
      }
    }

    // Attempt function inlining: if all args are constant and the function body
    // can be fully evaluated, replace the call with the computed result.
    const inlined = this.tryInlineFunctionCall(effectiveFuncName, argIds);
    if (inlined !== undefined) return inlined;

    return this.dae.addCallExpr(effectiveFuncName, argIds);
  }

  /**
   * Try to fold a built-in function call with literal arguments at compile time.
   * Returns the folded expression ID, or undefined if folding is not possible.
   */
  private tryFoldBuiltinCall(funcName: string, argIds: number[]): number | undefined {
    const def = ARENA_BUILTIN_FOLDS.get(funcName);
    if (!def) return undefined;

    // Zero-argument identity values for reduction functions over empty ranges
    if (argIds.length === 0 && def.identityValue !== undefined) {
      return Number.isInteger(def.identityValue)
        ? this.dae.addIntLiteral(def.identityValue)
        : this.dae.addRealLiteral(def.identityValue);
    }

    // Single-argument constant folding
    if (argIds.length === 1 && def.fold1) {
      const argId = argIds[0];
      if (argId !== undefined) {
        const val = this.tryGetLiteralValue(argId);
        if (val !== null) {
          const result = def.fold1(val);
          if (!Number.isFinite(result)) return undefined;
          // Type-preserving functions (abs, sign): Integer in → Integer out
          if (def.preserveIntegerType && this.dae.getExprKind(argId) === ExprKind.IntLiteral) {
            return this.dae.addIntLiteral(result);
          }
          if (def.outputType === "Integer") return this.dae.addIntLiteral(result);
          return this.dae.addRealLiteral(result);
        }
      }
    }

    // Two-argument constant folding
    if (argIds.length === 2 && def.fold2) {
      const arg0 = argIds[0];
      const arg1 = argIds[1];
      if (arg0 !== undefined && arg1 !== undefined) {
        const a = this.tryGetLiteralValue(arg0);
        const b = this.tryGetLiteralValue(arg1);
        if (a !== null && b !== null) {
          const result = def.fold2(a, b);
          if (!Number.isFinite(result)) return undefined;
          const bothInt =
            this.dae.getExprKind(arg0) === ExprKind.IntLiteral && this.dae.getExprKind(arg1) === ExprKind.IntLiteral;
          if (def.outputType === "Integer" || (bothInt && Number.isInteger(result))) {
            return this.dae.addIntLiteral(result);
          }
          return this.dae.addRealLiteral(result);
        }
      }
    }

    // Single-argument reduction over an array constructor: sum({1,2,3}) → 6
    if (argIds.length === 1 && def.foldConstants) {
      const argId = argIds[0];
      if (argId !== undefined) {
        if (this.dae.getExprKind(argId) === ExprKind.ArrayCtor) {
          const values = this.tryGetArrayLiteralValues(argId);
          if (values !== null) {
            const result = def.foldConstants(values);
            if (Number.isFinite(result)) {
              return Number.isInteger(result) ? this.dae.addIntLiteral(result) : this.dae.addRealLiteral(result);
            }
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Try to extract a numeric literal value from an expression ID.
   * Returns the number, or null if the expression is not a numeric literal.
   */
  private tryGetLiteralValue(exprId: number): number | null {
    const kind = this.dae.getExprKind(exprId);
    if (kind === ExprKind.RealLiteral) return this.dae.getExprRealValue(exprId);
    if (kind === ExprKind.IntLiteral) return this.dae.getExprData1(exprId);
    // Try evaluating constant expressions
    const val = evaluateArenaExpression(this.dae, exprId);
    if (typeof val === "number") return val;
    return null;
  }

  /**
   * Try to extract all numeric values from an array constructor expression.
   * Returns the array of numbers, or null if any element is not a literal.
   */
  private tryGetArrayLiteralValues(exprId: number): number[] | null {
    const count = this.dae.getExprData1(exprId);
    if (count === 0) return [];
    const firstElem = this.dae.getExprLeft(exprId);
    const values: number[] = [];
    const firstVal = this.tryGetLiteralValue(firstElem);
    if (firstVal === null) return null;
    values.push(firstVal);
    for (let i = 1; i < count; i++) {
      const tupleId = exprId + i;
      const elemId = this.dae.getExprRight(tupleId);
      const val = this.tryGetLiteralValue(elemId);
      if (val === null) return null;
      values.push(val);
    }
    return values;
  }

  /**
   * Expand fill(s, n1, n2, ...) into nested array constructors.
   * fill(v, 3) → {v, v, v}
   * fill(v, 2, 3) → {{v,v,v},{v,v,v}}
   */
  private expandFill(argIds: number[]): number | undefined {
    const valueId = argIds[0];
    if (valueId === undefined) return undefined;
    const dimIds = argIds.slice(1);
    return this.expandFillRecursive(valueId, dimIds, 0);
  }

  private expandFillRecursive(valueId: number, dimIds: number[], depth: number): number | undefined {
    if (depth >= dimIds.length) return valueId;
    const dimId = dimIds[depth];
    if (dimId === undefined) return undefined;
    const dimVal = this.tryGetLiteralValue(dimId);
    if (dimVal === null || dimVal < 0) return undefined;
    const n = Math.floor(dimVal);
    const elements: number[] = [];
    for (let i = 0; i < n; i++) {
      const elem = this.expandFillRecursive(valueId, dimIds, depth + 1);
      if (elem === undefined) return undefined;
      elements.push(elem);
    }
    return this.dae.addArrayCtorExpr(elements);
  }

  /**
   * Expand zeros(n)/ones(n) into array constructors filled with 0 or 1.
   */
  private expandFillValue(dimArgIds: number[], fillValue: number): number | undefined {
    const valueId = this.dae.addIntLiteral(fillValue);
    return this.expandFillRecursive(valueId, dimArgIds, 0);
  }

  /**
   * Expand identity(n) into an n×n identity matrix array constructor.
   */
  private expandIdentity(nId: number): number | undefined {
    const n = this.tryGetLiteralValue(nId);
    if (n === null || n < 0) return undefined;
    const size = Math.floor(n);
    const rows: number[] = [];
    for (let i = 0; i < size; i++) {
      const cols: number[] = [];
      for (let j = 0; j < size; j++) {
        cols.push(this.dae.addIntLiteral(i === j ? 1 : 0));
      }
      rows.push(this.dae.addArrayCtorExpr(cols));
    }
    return this.dae.addArrayCtorExpr(rows);
  }

  /**
   * Handle partial function application: `function Foo(x = val, ...)`
   * Emits a call expression with the bound arguments.
   */
  private visitPartialApplication(node: ModelicaFunctionPartialApplicationSyntaxNode): number | undefined {
    const funcName = node.typeSpecifier?.text;
    if (!funcName) return undefined;

    // Collect bound named arguments from the partial application
    const boundArgs = new Map<string, number>();
    const namedArgs = node.namedArguments ?? [];
    for (const arg of namedArgs) {
      const argName = arg.identifier?.text;
      if (!argName) continue;
      const id = this.visit(arg.argument?.expression);
      if (id !== undefined) {
        boundArgs.set(argName, id);
      }
    }

    // Resolve input parameters of the target function to correctly order the bound arguments
    let argIds: number[] = [];
    if (this.resolveFunctionInputs) {
      const inputNames = this.resolveFunctionInputs(funcName);
      for (const inputName of inputNames) {
        const exprId = boundArgs.get(inputName);
        if (exprId !== undefined) {
          argIds.push(exprId);
        }
      }
    } else {
      // Fallback to original order if resolver is not available
      argIds = Array.from(boundArgs.values());
    }

    // Notify function collector
    if (this.onFunctionCall) {
      this.onFunctionCall(funcName);
    }

    // Emit as a partial function application expression
    return this.dae.addPartialFuncExpr(funcName, argIds);
  }

  public isRealTypedExpr(exprId: number): boolean {
    const kind = this.dae.getExprKind(exprId);
    if (kind === ExprKind.Name) {
      const nameId = this.dae.getExprData1(exprId);
      const name = this.dae.interner.resolve(nameId);
      if (name) {
        // Built-in "time" is always Real
        if (name === "time") return true;
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
    // Call expressions: check if the function returns Real
    if (kind === ExprKind.Call) {
      const fn = this.dae.interner.resolve(this.dae.getExprData1(exprId));
      // Explicit cast to Real
      if (fn === "/*Real*/" || fn === "Real") return true;
      // Transcendental functions always return Real
      if (
        fn === "sin" ||
        fn === "cos" ||
        fn === "tan" ||
        fn === "exp" ||
        fn === "log" ||
        fn === "log10" ||
        fn === "asin" ||
        fn === "acos" ||
        fn === "atan" ||
        fn === "atan2" ||
        fn === "sinh" ||
        fn === "cosh" ||
        fn === "tanh" ||
        fn === "sqrt"
      )
        return true;
    }
    return false;
  }

  public castToRealExpr(exprId: number): number {
    const kind = this.dae.getExprKind(exprId);
    // IntLiteral → promote to RealLiteral
    if (kind === ExprKind.IntLiteral) {
      const val = this.dae.getExprData1(exprId);
      return this.dae.addRealLiteral(val);
    }
    // RealLiteral, BoolLiteral, StringLiteral, EnumLiteral — already correct type
    if (
      kind === ExprKind.RealLiteral ||
      kind === ExprKind.BoolLiteral ||
      kind === ExprKind.StringLiteral ||
      kind === ExprKind.EnumLiteral
    ) {
      return exprId;
    }
    // ArrayCtor — recursively cast each element
    if (kind === ExprKind.ArrayCtor) {
      const count = this.dae.getExprData1(exprId);
      if (count === 0) return exprId;
      const firstElem = this.dae.getExprLeft(exprId);
      const elements: number[] = [];
      elements.push(this.castToRealExpr(firstElem));
      for (let i = 1; i < count; i++) {
        const tupleExprId = exprId + i;
        const elemId = this.dae.getExprLeft(tupleExprId);
        elements.push(this.castToRealExpr(elemId));
      }
      return this.dae.addArrayCtorExpr(elements);
    }
    // Unary — recursively cast operand
    if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
      const operand = this.dae.getExprLeft(exprId);
      const casted = this.castToRealExpr(operand);
      if (casted !== operand) {
        if (kind === ExprKind.Negate) {
          return this.dae.addUnaryExpr(UnaryOp.Negate, casted);
        }
        return this.dae.addUnaryExpr(this.dae.getExprData1(exprId), casted);
      }
      return exprId;
    }
    // Binary — recursively cast both operands
    if (kind === ExprKind.Binary) {
      const op = this.dae.getExprData1(exprId);
      const op1 = this.dae.getExprLeft(exprId);
      const op2 = this.dae.getExprRight(exprId);
      const casted1 = this.castToRealExpr(op1);
      const casted2 = this.castToRealExpr(op2);
      if (casted1 !== op1 || casted2 !== op2) {
        return this.dae.addBinaryExpr(op, casted1, casted2);
      }
      return exprId;
    }
    // Name — check if it's a known Integer variable; if so, wrap it.
    // Otherwise assume it's already Real (or unknown, which is safe to leave as-is).
    if (kind === ExprKind.Name) {
      const nameId = this.dae.getExprData1(exprId);
      const name = this.dae.interner.resolve(nameId);
      if (name) {
        // Built-in "time" is always Real
        if (name === "time") return exprId;
        const varIdx = this.dae.getVarIdxByName(name);
        if (varIdx >= 0) {
          const varType = this.dae.getVarType(varIdx);
          if (varType === VarType.Integer) {
            // Provably Integer — wrap with cast
            return this.dae.addCallExpr("/*Real*/", [exprId]);
          }
          // Real or other type — no cast needed
          return exprId;
        }
      }
      // Unknown variable (not yet in DAE) — assume Real, don't wrap
      return exprId;
    }
    // Call — check if it's already a /*Real*/ cast; otherwise check for Integer-returning calls
    if (kind === ExprKind.Call) {
      const funcNameId = this.dae.getExprData1(exprId);
      const funcName = this.dae.interner.resolve(funcNameId);
      if (funcName === "/*Real*/") return exprId; // already cast
      // For type-preserving built-ins (abs, sign, etc.), check argument type
      if (funcName === "abs" || funcName === "sign") {
        const argId = this.dae.getExprLeft(exprId);
        if (argId >= 0) {
          const argType = inferArenaExprVarType(this.dae, argId);
          if (argType === VarType.Integer) {
            return this.dae.addCallExpr("/*Real*/", [exprId]);
          }
        }
      }
      return exprId;
    }
    // Pre — check if the argument is Integer-typed
    if (kind === ExprKind.Pre) {
      const argId = this.dae.getExprData1(exprId);
      if (argId >= 0) {
        const argType = inferArenaExprVarType(this.dae, argId);
        if (argType === VarType.Integer) {
          return this.dae.addCallExpr("/*Real*/", [exprId]);
        }
      }
      return exprId;
    }
    // Der, IfElse, Range, Subscript, Comprehension, etc. —
    // these are already typed by their context; don't wrap.
    return exprId;
  }
  // -------------------------------------------------------------------------
  // Function Inlining
  // -------------------------------------------------------------------------

  /**
   * Helper to serialize an ArenaValue back to an ExprId in the DAE.
   */
  private addArenaValueAsExpr(value: ArenaValue, preferredType?: VarType, isTuple = false): number {
    if (typeof value === "number") {
      if (preferredType === VarType.Integer) {
        return this.dae.addIntLiteral(value);
      } else if (preferredType === VarType.Real) {
        return this.dae.addRealLiteral(value);
      }
      return Number.isInteger(value) ? this.dae.addIntLiteral(value) : this.dae.addRealLiteral(value);
    }
    if (typeof value === "boolean") {
      return this.dae.addBoolLiteral(value);
    }
    if (typeof value === "string") {
      return this.dae.addStringLiteral(value);
    }
    if (Array.isArray(value)) {
      const ids = value.map((v) => this.addArenaValueAsExpr(v, preferredType, false));
      return isTuple ? this.dae.addTupleExpr(ids) : this.dae.addArrayCtorExpr(ids);
    }
    return -1;
  }

  /**
   * Try to inline a user-defined function call by interpreting its body
   * when all arguments are compile-time constants.
   *
   * Returns a literal expression ID if inlining succeeds, undefined otherwise.
   */
  private tryInlineFunctionCall(funcName: string, argIds: number[]): number | undefined {
    // Look up the function sub-DAE
    const funcNameId = this.dae.interner.intern(funcName);
    const fnDae = this.dae.functions.get(funcNameId);
    if (!fnDae) return undefined;

    // Skip functions with external declarations (can't inline C/Fortran code)
    if (fnDae.externalDecl) return undefined;

    // Evaluate all arguments to constant values
    const argValues: ArenaValue[] = [];
    for (const argId of argIds) {
      const val = evaluateArenaExpression(this.dae, argId);
      if (val === null) {
        return undefined;
      } // Non-constant argument
      argValues.push(val);
    }

    // Determine the type of the first output variable for type-preserving serialization
    const outputVars: { name: string; idx: number }[] = [];
    for (let i = 0; i < fnDae.varCount; i++) {
      const causality = fnDae.getVarCausality(i);
      if (causality === Causality.Output) {
        outputVars.push({ name: fnDae.getVarName(i), idx: i });
      }
    }
    const outVar = outputVars[0];
    const outType = outVar ? fnDae.getVarType(outVar.idx) : undefined;

    // Evaluate function using the new evaluateArenaFunctionCall
    const outVal = evaluateArenaFunctionCall(this.dae, funcNameId, argValues);
    if (outVal === null) return undefined;

    const resultExprId = this.addArenaValueAsExpr(outVal, outType, outputVars.length > 1);
    if (resultExprId === -1) return undefined;

    // We do NOT remove the function definition from the DAE because OpenModelica
    // continues to print inlined functions in the final flattened model output.

    return resultExprId;
  }

  // ── Operator Record Dispatch ──

  /**
   * Resolve the operator record type name for a CST expression operand.
   * Returns the type name (e.g. "C", "Complex") if the operand is a
   * component of an operator record type, or null otherwise.
   */
  private resolveOperandRecordType(operandNode: unknown): string | null {
    if (!this.db || !this.scopeId) return null;

    // Extract the variable name from the operand's CST
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = operandNode as any;
    let varName: string | null = null;

    if (n instanceof ModelicaComponentReferenceSyntaxNode) {
      // Use just the first part (e.g., "c1" from "c1.re")
      const firstPart = n.parts[0];
      varName = firstPart?.identifier?.text ?? null;
    } else if (n instanceof ModelicaIdentifierSyntaxNode) {
      varName = n.text ?? null;
    }

    if (!varName) return null;

    // Resolve the variable in scope to find its type
    const resolver = this.db.query<
      ((name: string) => { id: SymbolId; kind: string; name: string; metadata?: Record<string, unknown> } | null) | null
    >("resolveSimpleName", this.scopeId);
    if (!resolver) return null;
    const entry = resolver(varName);
    if (!entry || entry.kind !== "Component") return null;

    const typeSpec = (entry.metadata as Record<string, unknown>)?.typeSpecifier as string | undefined;
    if (!typeSpec || BUILTIN_SCALAR_TYPES.has(typeSpec)) return null;

    // Check if the resolved type is an operator record
    const typeEntries = this.db.byName(typeSpec);
    const typeEntry = typeEntries?.find((e: { kind: string }) => e.kind === "Class");
    if (!typeEntry) return null;

    const classPrefixes = (typeEntry.metadata as Record<string, unknown>)?.classPrefixes as string | undefined;
    if (classPrefixes !== "operator record") return null;

    return typeSpec;
  }

  /**
   * Get the operator function overloads for a given operator record type and operator name.
   */
  private getOperatorOverloads(
    recordTypeName: string,
    operatorName: string,
  ):
    | {
        qualifiedName: string;
        inputTypes: string[];
        outputType: string;
        inputCount: number;
      }[]
    | null {
    if (!this.db) return null;

    const typeEntries = this.db.byName(recordTypeName);
    const typeEntry = typeEntries?.find((e: { kind: string }) => e.kind === "Class");
    if (!typeEntry) return null;

    const opMap = this.db.query<Map<
      string,
      {
        qualifiedName: string;
        inputTypes: string[];
        outputType: string;
        inputCount: number;
      }[]
    > | null>("operatorFunctions", typeEntry.id);
    if (!opMap) return null;

    return opMap.get(operatorName) ?? null;
  }

  /**
   * Get the builtin type name of an operand ("Real", "Integer", etc.),
   * or the operator record type name if it's a record-typed variable.
   */
  private getOperandTypeName(operandNode: unknown): string {
    const recordType = this.resolveOperandRecordType(operandNode);
    if (recordType) return recordType;

    // Check if it's a literal
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = operandNode as any;
    if (n instanceof ModelicaUnsignedIntegerLiteralSyntaxNode) return "Integer";
    if (n instanceof ModelicaUnsignedRealLiteralSyntaxNode) return "Real";
    if (n instanceof ModelicaBooleanLiteralSyntaxNode) return "Boolean";
    if (n instanceof ModelicaStringLiteralSyntaxNode) return "String";

    // Fallback: try to resolve component type
    if (n instanceof ModelicaComponentReferenceSyntaxNode || n instanceof ModelicaIdentifierSyntaxNode) {
      const varName = n instanceof ModelicaComponentReferenceSyntaxNode ? n.parts[0]?.identifier?.text : n.text;
      if (varName && this.db && this.scopeId) {
        const resolver = this.db.query<
          ((name: string) => { id: SymbolId; kind: string; metadata?: Record<string, unknown> } | null) | null
        >("resolveSimpleName", this.scopeId);
        if (resolver) {
          const entry = resolver(varName);
          if (entry?.kind === "Component") {
            return ((entry.metadata as Record<string, unknown>)?.typeSpecifier as string) ?? "Real";
          }
        }
      }
    }

    return "Real"; // default
  }

  /**
   * Try to dispatch a binary operator to an operator record overload.
   * Returns the CallExpr ID if a matching overload is found, undefined otherwise.
   */
  private tryOperatorOverloadBinary(
    op: ModelicaBinaryOperator,
    node: ModelicaBinaryExpressionSyntaxNode,
    leftId: number,
    rightId: number,
  ): number | undefined {
    if (!this.db || !this.scopeId) return undefined;

    const opName = BINARY_OP_TO_MODELICA[op];
    if (!opName) return undefined;

    const leftType = this.getOperandTypeName(node.operand1);
    const rightType = this.getOperandTypeName(node.operand2);

    // Only dispatch if at least one operand is an operator record
    const leftIsRecord = !BUILTIN_SCALAR_TYPES.has(leftType);
    const rightIsRecord = !BUILTIN_SCALAR_TYPES.has(rightType);
    if (!leftIsRecord && !rightIsRecord) return undefined;

    // Look up overloads from the operator record type (prefer left, fallback to right)
    const recordType = leftIsRecord ? leftType : rightType;
    const overloads = this.getOperatorOverloads(recordType, opName);
    if (!overloads || overloads.length === 0) return undefined;

    // Find matching overload by input types
    let bestMatch = this.findOverload(overloads, leftType, rightType);

    if (!bestMatch) {
      // Implicit constructor coercion
      if (leftIsRecord && !rightIsRecord) {
        const coercedRight = this.coerceToRecord(recordType, rightType, rightId);
        if (coercedRight !== undefined) {
          bestMatch = this.findOverload(overloads, recordType, recordType);
          if (bestMatch) rightId = coercedRight;
        }
      } else if (!leftIsRecord && rightIsRecord) {
        const coercedLeft = this.coerceToRecord(recordType, leftType, leftId);
        if (coercedLeft !== undefined) {
          bestMatch = this.findOverload(overloads, recordType, recordType);
          if (bestMatch) leftId = coercedLeft;
        }
      }
    }

    if (!bestMatch) return undefined;

    this.onFunctionCall?.(bestMatch.qualifiedName);
    // Emit as a function call
    return this.dae.addCallExpr(bestMatch.qualifiedName, [leftId, rightId]);
  }

  private findOverload(
    overloads: { qualifiedName: string; inputTypes: string[]; outputType: string; inputCount: number }[],
    t1: string,
    t2: string,
  ) {
    for (const overload of overloads) {
      if (
        overload.inputCount >= 2 &&
        overload.inputTypes[0] !== undefined &&
        overload.inputTypes[1] !== undefined &&
        this.typeMatches(t1, overload.inputTypes[0]) &&
        this.typeMatches(t2, overload.inputTypes[1])
      ) {
        return overload;
      }
    }
    return null;
  }

  private coerceToRecord(recordType: string, scalarType: string, exprId: number): number | undefined {
    const constructors = this.getOperatorOverloads(recordType, "'constructor'");
    if (!constructors) return undefined;

    for (const ctor of constructors) {
      if (
        ctor.inputTypes.length >= 1 &&
        ctor.inputTypes[0] !== undefined &&
        this.typeMatches(scalarType, ctor.inputTypes[0])
      ) {
        this.onFunctionCall?.(ctor.qualifiedName);
        return this.dae.addCallExpr(ctor.qualifiedName, [exprId]);
      }
    }
    return undefined;
  }

  /**
   * Try to dispatch a unary operator to an operator record overload.
   * Returns the CallExpr ID if a matching overload is found, undefined otherwise.
   */
  private tryOperatorOverloadUnary(
    op: ModelicaUnaryOperator,
    node: ModelicaUnaryExpressionSyntaxNode,
    exprId: number,
  ): number | undefined {
    if (!this.db || !this.scopeId) return undefined;

    const opName = UNARY_OP_TO_MODELICA[op];
    if (!opName) return undefined;

    const operandType = this.getOperandTypeName(node.operand);
    if (BUILTIN_SCALAR_TYPES.has(operandType)) return undefined;

    const overloads = this.getOperatorOverloads(operandType, opName);
    if (!overloads || overloads.length === 0) return undefined;

    // Find matching unary overload (1 input)
    let bestMatch: (typeof overloads)[0] | null = null;
    for (const overload of overloads) {
      if (overload.inputCount !== 1) continue;
      if (overload.inputTypes[0] !== undefined && this.typeMatches(operandType, overload.inputTypes[0])) {
        bestMatch = overload;
        break;
      }
    }

    if (!bestMatch) return undefined;

    this.onFunctionCall?.(bestMatch.qualifiedName);
    return this.dae.addCallExpr(bestMatch.qualifiedName, [exprId]);
  }

  /**
   * Check if an actual type matches an expected parameter type.
   * Handles the case where the record type name matches itself,
   * and basic builtin compatibility.
   */
  private typeMatches(actual: string, expected: string): boolean {
    if (actual === expected) return true;
    // Integer is compatible with Real parameter
    if (actual === "Integer" && expected === "Real") return true;
    // Real is compatible with Integer parameter (with coercion)
    if (actual === "Real" && expected === "Integer") return true;
    return false;
  }
}
