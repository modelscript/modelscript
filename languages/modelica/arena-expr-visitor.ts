import { BinOp, DAEArenaBuilder, ExprKind, UnaryOp } from "@modelscript/compiler";
import {
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaLiteralSyntaxNode,
  ModelicaPrimarySyntaxNode,
  ModelicaUnaryExpressionSyntaxNode,
} from "./ast.js";

/**
 * Translates a Modelica CST/AST expression tree into integer-based `ExprId`s
 * inside the given `DAEArenaBuilder`.
 */
export class ArenaExprVisitor {
  constructor(private dae: DAEArenaBuilder) {}

  public visit(node: unknown): number | undefined {
    if (!node) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = node as any;

    // Check specific node types. Note: we use constructor names or instance checks
    // depending on what's available. The AST nodes are subclasses of ModelicaSyntaxNode.
    if (n instanceof ModelicaLiteralSyntaxNode) {
      return this.visitLiteral(n);
    } else if (n instanceof ModelicaPrimarySyntaxNode) {
      return this.visitPrimary(n);
    } else if (n instanceof ModelicaComponentReferenceSyntaxNode) {
      return this.visitComponentReference(n);
    } else if (n instanceof ModelicaBinaryExpressionSyntaxNode) {
      return this.visitBinaryExpression(n);
    } else if (n instanceof ModelicaUnaryExpressionSyntaxNode) {
      return this.visitUnaryExpression(n);
    } else if (n instanceof ModelicaFunctionCallSyntaxNode) {
      return this.visitFunctionCall(n);
    }

    // Fallback: if it's an unrecognized node, we might be dealing with an intermediate wrapper.
    // Try to drill down if there's an obvious child.
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

  private visitLiteral(node: ModelicaLiteralSyntaxNode): number | undefined {
    if (node.value === "true") return this.dae.addExpression(ExprKind.BoolLiteral, true);
    if (node.value === "false") return this.dae.addExpression(ExprKind.BoolLiteral, false);

    const num = Number(node.value);
    if (!isNaN(num)) {
      // Check if it's an integer
      if (node.value.includes(".") || node.value.includes("e") || node.value.includes("E")) {
        return this.dae.addExpression(ExprKind.RealLiteral, num);
      }
      return this.dae.addExpression(ExprKind.IntLiteral, num);
    }

    // String literals
    if (node.value.startsWith('"')) {
      const strVal = node.value.substring(1, node.value.length - 1);
      return this.dae.addExpression(ExprKind.StringLiteral, strVal);
    }

    return undefined;
  }

  private visitPrimary(node: ModelicaPrimarySyntaxNode): number | undefined {
    // A primary might be a literal, a component reference, or a function call
    if (node.literal) return this.visit(node.literal);
    if (node.componentReference) return this.visit(node.componentReference);
    if (node.functionCall) return this.visit(node.functionCall);
    if (node.expression) return this.visit(node.expression);
    return undefined;
  }

  private visitComponentReference(node: ModelicaComponentReferenceSyntaxNode): number | undefined {
    // We get the full dotted path
    const path = node.text;
    if (!path) return undefined;

    // For now, emit a Name expression. (Later, we can resolve to VarIdx if needed)
    return this.dae.addExpression(ExprKind.Name, path);
  }

  private visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode): number | undefined {
    const leftId = this.visit(node.left);
    const rightId = this.visit(node.right);
    if (leftId === undefined || rightId === undefined) return undefined;

    const op = node.operator?.text;
    let binOp: BinOp;
    switch (op) {
      case "+":
        binOp = BinOp.Add;
        break;
      case "-":
        binOp = BinOp.Sub;
        break;
      case "*":
        binOp = BinOp.Mul;
        break;
      case "/":
        binOp = BinOp.Div;
        break;
      case "^":
        binOp = BinOp.Pow;
        break;
      case "==":
        binOp = BinOp.Eq;
        break;
      case "<>":
        binOp = BinOp.Neq;
        break;
      case "<":
        binOp = BinOp.Lt;
        break;
      case "<=":
        binOp = BinOp.Lte;
        break;
      case ">":
        binOp = BinOp.Gt;
        break;
      case ">=":
        binOp = BinOp.Gte;
        break;
      case "and":
        binOp = BinOp.And;
        break;
      case "or":
        binOp = BinOp.Or;
        break;
      case ".+":
        binOp = BinOp.ElemAdd;
        break;
      case ".-":
        binOp = BinOp.ElemSub;
        break;
      case ".*":
        binOp = BinOp.ElemMul;
        break;
      case "./":
        binOp = BinOp.ElemDiv;
        break;
      case ".^":
        binOp = BinOp.ElemPow;
        break;
      default:
        console.warn(`ArenaExprVisitor: Unhandled binary operator: ${op}`);
        return undefined;
    }

    return this.dae.addExpression(ExprKind.Binary, binOp, leftId, rightId);
  }

  private visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode): number | undefined {
    const exprId = this.visit(node.expression);
    if (exprId === undefined) return undefined;

    const op = node.operator?.text;
    let unOp: UnaryOp;
    switch (op) {
      case "-":
        unOp = UnaryOp.Negate;
        break;
      case "not":
        unOp = UnaryOp.Not;
        break;
      case "+":
        return exprId; // Positive is a no-op
      default:
        console.warn(`ArenaExprVisitor: Unhandled unary operator: ${op}`);
        return undefined;
    }

    return this.dae.addExpression(ExprKind.Unary, unOp, exprId);
  }

  private visitFunctionCall(node: ModelicaFunctionCallSyntaxNode): number | undefined {
    const funcName = node.componentReference?.text;
    if (!funcName) return undefined;

    // We can emit a specialized expression for `der` or handle arbitrary function calls.
    if (funcName === "der") {
      // Typically `der` takes exactly one argument
      const args = node.functionArguments?.expressions;
      if (args && args.length > 0) {
        const argId = this.visit(args[0]);
        if (argId !== undefined) {
          return this.dae.addExpression(ExprKind.Der, argId);
        }
      }
    }

    // General function call
    // Collect arguments
    const argIds: number[] = [];
    if (node.functionArguments?.expressions) {
      for (const argNode of node.functionArguments.expressions) {
        const id = this.visit(argNode);
        if (id !== undefined) argIds.push(id);
      }
    }

    // Call expr needs to be represented. DAEArena uses an array for arguments.
    // DAEArenaBuilder: addExpression(ExprKind.Call, funcNameStringId, [arg1, arg2...])
    const funcStrId = this.dae.addString(funcName);
    return this.dae.addExpression(ExprKind.Call, funcStrId, argIds);
  }
}
