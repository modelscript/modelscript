// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  ModelicaAnnotationClauseSyntaxNode,
  ModelicaArrayConcatenationSyntaxNode,
  ModelicaArrayConstructorSyntaxNode,
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaBinaryOperator,
  ModelicaBooleanLiteralSyntaxNode,
  ModelicaClassModificationSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaElementModificationSyntaxNode,
  ModelicaExpressionSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaIfElseExpressionSyntaxNode,
  ModelicaRangeExpressionSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  ModelicaUnaryExpressionSyntaxNode,
  ModelicaUnaryOperator,
  ModelicaUnsignedIntegerLiteralSyntaxNode,
  ModelicaUnsignedRealLiteralSyntaxNode,
} from "../ast.js";

// ── Annotation Enum Definitions ─────────────────────────────────────────────
// These are the standard Modelica annotation enumeration types that appear
// in Icon/Diagram/Placement annotations. The evaluator resolves qualified
// references like FillPattern.Solid directly from this table.

type EnumDef = Record<string, number>;

const ANNOTATION_ENUMS: Record<string, EnumDef> = {
  FillPattern: {
    None: 0,
    Solid: 1,
    Horizontal: 2,
    Vertical: 3,
    Cross: 4,
    Forward: 5,
    Backward: 6,
    CrossDiag: 7,
    HorizontalCylinder: 8,
    VerticalCylinder: 9,
    Sphere: 10,
  },
  LinePattern: { None: 0, Solid: 1, Dash: 2, Dot: 3, DashDot: 4, DashDotDot: 5 },
  Arrow: { None: 0, Open: 1, Filled: 2, Half: 3 },
  Smooth: { None: 0, Bezier: 1 },
  BorderPattern: { None: 0, Raised: 1, Sunken: 2, Engraved: 3 },
  EllipseClosure: { None: 0, Chord: 1, Radial: 2, Automatic: 3 },
  TextAlignment: { Left: 0, Center: 1, Right: 2 },
  TextStyle: { Bold: 0, Italic: 1, UnderLine: 2 },
};

// ── Lightweight CST Expression Evaluator ────────────────────────────────────
// Walks CST syntax nodes directly and returns plain JS values (numbers,
// strings, booleans, arrays). No ModelicaInterpreter or ModelicaExpression
// intermediate types needed.

/**
 * Resolve a name through the eval scope chain.
 * Handles dotted paths like "FillPattern.Solid" by first checking the
 * annotation enum table, then falling back to scope lookups.
 */
function resolveAnnotationName(name: string, evalScope: any): any {
  // Check annotation enums first (e.g., "FillPattern.Solid")
  const dotIdx = name.indexOf(".");
  if (dotIdx > 0) {
    const root = name.substring(0, dotIdx);
    const member = name.substring(dotIdx + 1);
    const enumDef = ANNOTATION_ENUMS[root];
    if (enumDef && member in enumDef) {
      return enumDef[member];
    }
  }

  // Check single-segment enum name (e.g., just "Solid" won't match, but check scope)
  if (!evalScope) return undefined;

  // Try resolveSimpleName on the scope
  if (typeof evalScope.resolveSimpleName === "function") {
    const resolved = evalScope.resolveSimpleName(name);
    if (resolved != null) {
      // Extract value from component modification
      const mod = resolved.modification;
      if (mod) {
        const expr = mod.evaluatedExpression ?? mod.expression;
        if (expr != null) {
          if (typeof expr === "number" || typeof expr === "boolean" || typeof expr === "string") return expr;
          if (typeof expr.value !== "undefined") return expr.value;
        }
      }
      return resolved;
    }
  }

  return undefined;
}

/**
 * Evaluate a CST expression node directly to a plain JS value.
 * Returns number | boolean | string | any[] | null.
 */
export function evaluateCSTExpression(node: ModelicaExpressionSyntaxNode | null | undefined, evalScope?: any): any {
  if (!node) return null;

  // Integer literal
  if (node instanceof ModelicaUnsignedIntegerLiteralSyntaxNode) {
    return node.value;
  }

  // Real literal
  if (node instanceof ModelicaUnsignedRealLiteralSyntaxNode) {
    return node.value;
  }

  // Boolean literal
  if (node instanceof ModelicaBooleanLiteralSyntaxNode) {
    return node.value;
  }

  // String literal — uses .text not .value
  if (node instanceof ModelicaStringLiteralSyntaxNode) {
    return node.text;
  }

  // Unary expression (-x, not x)
  if (node instanceof ModelicaUnaryExpressionSyntaxNode) {
    const operand = evaluateCSTExpression(node.operand, evalScope);
    if (operand === null) return null;
    const op = node.operator;
    if (op === ModelicaUnaryOperator.UNARY_MINUS || op === ModelicaUnaryOperator.ELEMENTWISE_UNARY_MINUS)
      return typeof operand === "number" ? -operand : null;
    if (op === ModelicaUnaryOperator.UNARY_PLUS || op === ModelicaUnaryOperator.ELEMENTWISE_UNARY_PLUS) return operand;
    if (op === ModelicaUnaryOperator.LOGICAL_NEGATION) return typeof operand === "boolean" ? !operand : null;
    return null;
  }

  // Binary expression (a + b, a * b, etc.) — uses .operand1/.operand2
  if (node instanceof ModelicaBinaryExpressionSyntaxNode) {
    const left = evaluateCSTExpression(node.operand1, evalScope);
    const right = evaluateCSTExpression(node.operand2, evalScope);
    if (left === null || right === null) return null;
    const op = node.operator;

    if (typeof left === "number" && typeof right === "number") {
      switch (op) {
        case ModelicaBinaryOperator.ADDITION:
        case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
          return left + right;
        case ModelicaBinaryOperator.SUBTRACTION:
        case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
          return left - right;
        case ModelicaBinaryOperator.MULTIPLICATION:
        case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
          return left * right;
        case ModelicaBinaryOperator.DIVISION:
        case ModelicaBinaryOperator.ELEMENTWISE_DIVISION:
          return right !== 0 ? left / right : null;
        case ModelicaBinaryOperator.EXPONENTIATION:
        case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION:
          return Math.pow(left, right);
        case ModelicaBinaryOperator.LESS_THAN:
          return left < right;
        case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
          return left <= right;
        case ModelicaBinaryOperator.GREATER_THAN:
          return left > right;
        case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
          return left >= right;
        case ModelicaBinaryOperator.EQUALITY:
          return left === right;
        case ModelicaBinaryOperator.INEQUALITY:
          return left !== right;
      }
    }

    if (typeof left === "boolean" && typeof right === "boolean") {
      if (op === ModelicaBinaryOperator.LOGICAL_AND) return left && right;
      if (op === ModelicaBinaryOperator.LOGICAL_OR) return left || right;
      if (op === ModelicaBinaryOperator.EQUALITY) return left === right;
      if (op === ModelicaBinaryOperator.INEQUALITY) return left !== right;
    }

    if (typeof left === "string" && typeof right === "string") {
      if (op === ModelicaBinaryOperator.ADDITION) return left + right;
      if (op === ModelicaBinaryOperator.EQUALITY) return left === right;
      if (op === ModelicaBinaryOperator.INEQUALITY) return left !== right;
    }

    return null;
  }

  // If-else expression — uses .expression (then), .elseExpression, .elseIfExpressionClauses
  if (node instanceof ModelicaIfElseExpressionSyntaxNode) {
    const cond = evaluateCSTExpression(node.condition, evalScope);
    if (cond === true) return evaluateCSTExpression(node.expression, evalScope);
    // Try elseif clauses
    for (const clause of node.elseIfExpressionClauses) {
      const elseIfCond = evaluateCSTExpression(clause.condition, evalScope);
      if (elseIfCond === true) return evaluateCSTExpression(clause.expression, evalScope);
    }
    if (cond === false) return evaluateCSTExpression(node.elseExpression, evalScope);
    return null;
  }

  // Range expression — uses .startExpression, .stepExpression, .stopExpression
  if (node instanceof ModelicaRangeExpressionSyntaxNode) {
    const start = evaluateCSTExpression(node.startExpression, evalScope);
    const stop = evaluateCSTExpression(node.stopExpression, evalScope);
    if (typeof start !== "number" || typeof stop !== "number") return null;
    const step = node.stepExpression ? evaluateCSTExpression(node.stepExpression, evalScope) : 1;
    if (typeof step !== "number" || step === 0) return null;
    const result: number[] = [];
    if (step > 0) {
      for (let v = start; v <= stop + 1e-10; v += step) result.push(v);
    } else {
      for (let v = start; v >= stop - 1e-10; v += step) result.push(v);
    }
    return result;
  }

  // Component reference (name resolution: "x", "a.b", "FillPattern.Solid")
  if (node instanceof ModelicaComponentReferenceSyntaxNode) {
    const parts = node.parts?.map((p: any) => p.identifier?.text).filter(Boolean);
    if (!parts || parts.length === 0) return null;
    const fullName = parts.join(".");
    const resolved = resolveAnnotationName(fullName, evalScope);
    if (resolved !== undefined) return resolved;
    // Try resolving segment by segment
    if (parts.length > 1) {
      let current = resolveAnnotationName(parts[0], evalScope);
      for (let i = 1; i < parts.length; i++) {
        if (current == null) return null;
        if (typeof current.resolveSimpleName === "function") {
          current = current.resolveSimpleName(parts[i]);
          if (current?.modification) {
            const expr = current.modification.evaluatedExpression ?? current.modification.expression;
            if (expr != null && (typeof expr === "number" || typeof expr === "boolean" || typeof expr === "string")) {
              current = expr;
            }
          }
        } else {
          return null;
        }
      }
      return current;
    }
    return null;
  }

  // Array constructor
  if (node instanceof ModelicaArrayConstructorSyntaxNode) {
    const elements = node.expressionList?.expressions ?? [];
    return elements.map((e: any) => evaluateCSTExpression(e, evalScope));
  }

  // Array concatenation
  if (node instanceof ModelicaArrayConcatenationSyntaxNode) {
    const result: any[] = [];
    for (const list of node.expressionLists) {
      const row = list.expressions.map((e: any) => evaluateCSTExpression(e, evalScope));
      result.push(row);
    }
    // If single row, flatten
    return result.length === 1 ? result[0] : result;
  }

  // Function call — only for DynamicSelect and basic built-ins
  if (node instanceof ModelicaFunctionCallSyntaxNode) {
    const funcNameParts = node.functionReference?.parts?.map((p: any) => p.identifier?.text);
    const funcName = funcNameParts ? funcNameParts[funcNameParts.length - 1] : null;
    if (funcName === "DynamicSelect") {
      // Return the static value (first positional argument)
      const posArgs = node.functionCallArguments?.arguments ?? [];
      if (posArgs.length > 0 && posArgs[0]?.expression) {
        return evaluateCSTExpression(posArgs[0].expression, evalScope);
      }
      return null;
    }
    // For other function calls, return null (record constructors handled by parseFunctionCall)
    return null;
  }

  return null;
}

// ── evaluateCondition ───────────────────────────────────────────────────────
// Evaluates conditional component attributes using the lightweight CST walker.
// Previously this lived in interpreter.ts and created a ModelicaInterpreter.

/**
 * WeakMap cache for evaluateCondition results.
 * Keyed on the component instance identity — since components are cloned when
 * modifications are applied, object identity is a safe cache key.
 */
const conditionCache = new WeakMap<any, boolean | undefined>();

/**
 * Evaluate a conditional component's condition attribute.
 * Returns true if the component should be included, false if excluded,
 * or undefined if the condition cannot be evaluated.
 */
export function evaluateCondition(component: any, parentContext?: any): boolean | undefined {
  const node = component.abstractSyntaxNode;
  if (!node || !("conditionAttribute" in node) || !node.conditionAttribute?.condition) return true;

  const cached = conditionCache.get(component);
  if (cached !== undefined) return cached;

  const condition = node.conditionAttribute.condition;
  const scope = parentContext ?? component.parent ?? component;
  try {
    const result = evaluateCSTExpression(condition, scope);
    if (typeof result === "boolean") {
      conditionCache.set(component, result);
      return result;
    }
  } catch (e) {
    console.warn(`[evaluateCondition] failed for ${component.name}:`, e);
  }
  return undefined;
}

// ── AnnotationEvaluator ─────────────────────────────────────────────────────

/**
 * A lightweight synchronous evaluator to convert raw ModelicaAnnotationClauseSyntaxNode
 * structures from the polyglot CST into plain JSON objects matching IIcon / IPlacement.
 *
 * This implementation walks the CST directly using `evaluateCSTExpression()` — it does
 * NOT depend on ModelicaInterpreter.
 */
export class AnnotationEvaluator {
  private scope: any;

  constructor(
    private evalScope?: any | null,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _overrideModification?: any,
  ) {
    this.scope = evalScope ?? null;
  }

  /**
   * Evaluate an annotation by name (like "Icon", "Diagram", or "Placement")
   */
  public evaluate(ast: ModelicaAnnotationClauseSyntaxNode | null | undefined, name: string): any {
    if (!ast?.classModification) return null;
    const layerMod = this.findModByName(ast.classModification, name);
    if (!layerMod) return null;

    return this.parseMod(layerMod, name);
  }

  private findModByName(
    classMod: ModelicaClassModificationSyntaxNode | null | undefined,
    name: string,
  ): ModelicaElementModificationSyntaxNode | null {
    if (!classMod) return null;
    for (const arg of classMod.modificationArguments) {
      if (arg instanceof ModelicaElementModificationSyntaxNode) {
        if (arg.name?.parts?.[0]?.text === name) return arg;
      }
    }
    return null;
  }

  private parseMod(mod: ModelicaElementModificationSyntaxNode, name: string): any {
    const result: any = { "@type": name };

    if (mod.modification?.classModification) {
      for (const arg of mod.modification.classModification.modificationArguments) {
        if (arg instanceof ModelicaElementModificationSyntaxNode) {
          const argName = arg.name?.parts?.[0]?.text;
          if (argName) {
            let mappedName = argName;
            if (name === "Rectangle" && argName === "cornerRadius") {
              mappedName = "radius";
            }
            result[mappedName] = this.parseValue(arg, argName);
          }
        }
      }
    } else if (mod.modification?.modificationExpression?.expression) {
      const expr = mod.modification.modificationExpression.expression;
      if (name === "graphics") {
        return this.parseGraphicsArray(expr);
      } else if (expr instanceof ModelicaFunctionCallSyntaxNode) {
        return this.parseFunctionCall(expr);
      }
      return this.toJSON(evaluateCSTExpression(expr, this.scope));
    }

    return result;
  }

  private parseValue(arg: ModelicaElementModificationSyntaxNode, fallbackName: string): any {
    // If it's a nested class modification (like transformation(extent=...))
    if (arg.modification?.classModification) {
      return this.parseMod(arg, arg.name?.parts?.[0]?.text ?? fallbackName);
    }

    const expr = arg.modification?.modificationExpression?.expression;
    if (!expr) return null;

    // "graphics" usually contains array constructors we want to unroll
    if (fallbackName === "graphics") {
      return this.parseGraphicsArray(expr);
    }

    if (expr instanceof ModelicaFunctionCallSyntaxNode) {
      return this.parseFunctionCall(expr);
    }

    return this.toJSON(evaluateCSTExpression(expr, this.scope));
  }

  private parseFunctionCall(node: ModelicaFunctionCallSyntaxNode): any {
    const funcNameParts = node.functionReference?.parts?.map((p: any) => p.identifier?.text);
    const funcName = funcNameParts ? funcNameParts[funcNameParts.length - 1] : "Unknown";

    if (funcName === "DynamicSelect") {
      const posArgs = node.functionCallArguments?.arguments ?? [];
      if (posArgs.length > 0 && posArgs[0]?.expression) {
        return this.parseValueForExpr(posArgs[0].expression);
      }
      return null;
    }

    const obj: any = { "@type": funcName };

    for (const arg of node.functionCallArguments?.namedArguments ?? []) {
      if (arg.identifier?.text && arg.argument?.expression) {
        let argName = arg.identifier.text;
        if (funcName === "Rectangle" && argName === "cornerRadius") {
          argName = "radius";
        }
        obj[argName] = this.parseValueForExpr(arg.argument.expression);
      }
    }

    // Best-effort positional mapping for visibility (first parameter in Modelica graphic items)
    const posArgs = node.functionCallArguments?.arguments ?? [];
    if (posArgs.length > 0 && posArgs[0] && obj.visible === undefined) {
      const val = evaluateCSTExpression(posArgs[0].expression, this.scope);
      if (typeof val === "boolean") {
        obj.visible = val;
      }
    }

    return obj;
  }

  private parseValueForExpr(expr: ModelicaExpressionSyntaxNode): any {
    if (expr instanceof ModelicaFunctionCallSyntaxNode) return this.parseFunctionCall(expr);
    return this.toJSON(evaluateCSTExpression(expr, this.scope));
  }

  private parseGraphicsArray(expr: ModelicaExpressionSyntaxNode): any[] {
    const graphics: any[] = [];
    const walkGraphics = (node: ModelicaExpressionSyntaxNode) => {
      if (node instanceof ModelicaFunctionCallSyntaxNode) {
        graphics.push(this.parseFunctionCall(node));
      } else if (node instanceof ModelicaArrayConcatenationSyntaxNode) {
        for (const list of node.expressionLists) {
          for (const e of list.expressions) {
            if (e) walkGraphics(e);
          }
        }
      } else if (node instanceof ModelicaArrayConstructorSyntaxNode) {
        for (const e of node.expressionList?.expressions ?? []) {
          if (e) walkGraphics(e);
        }
      }
    };
    walkGraphics(expr);
    return graphics;
  }

  private toJSON(val: any): any {
    if (val === null || val === undefined) return null;
    if (typeof val === "number" || typeof val === "boolean" || typeof val === "string") return val;
    if (Array.isArray(val)) return val.map((e) => this.toJSON(e));
    if (typeof val === "object" && val.elements instanceof Map) {
      // Handle ModelicaObject-like structures
      const obj: any = {};
      for (const [k, v] of val.elements.entries()) {
        obj[k] = this.toJSON(v);
      }
      return obj;
    }
    return null;
  }
}
