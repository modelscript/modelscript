// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Scope, ModelicaLoopScope } from "../scope.js";
import {
  ModelicaArray,
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaExpression,
  ModelicaIntegerLiteral,
  ModelicaRealLiteral,
  ModelicaStringLiteral,
  ModelicaUnaryExpression,
} from "./dae.js";
import {
  ModelicaArrayClassInstance,
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaIntegerClassInstance,
  ModelicaModification,
  ModelicaParameterModification,
} from "./model.js";
import {
  ModelicaArrayConcatenationSyntaxNode,
  ModelicaArrayConstructorSyntaxNode,
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaBooleanLiteralSyntaxNode,
  ModelicaClassKind,
  ModelicaComplexAssignmentStatementSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaEndExpressionSyntaxNode,
  ModelicaForStatementSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaIfElseExpressionSyntaxNode,
  ModelicaIfStatementSyntaxNode,
  ModelicaOutputExpressionListSyntaxNode,
  ModelicaProcedureCallStatementSyntaxNode,
  ModelicaRangeExpressionSyntaxNode,
  ModelicaSimpleAssignmentStatementSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  ModelicaSyntaxVisitor,
  ModelicaUnaryExpressionSyntaxNode,
  ModelicaUnsignedIntegerLiteralSyntaxNode,
  ModelicaUnsignedRealLiteralSyntaxNode,
  ModelicaWhenStatementSyntaxNode,
  ModelicaWhileStatementSyntaxNode,
} from "./syntax.js";

/** Set of Modelica built-in array function names handled directly by the interpreter. */
const BUILTIN_ARRAY_FUNCTIONS = new Set([
  "fill",
  "size",
  "zeros",
  "ones",
  "linspace",
  "promote",
  "ndims",
  "scalar",
  "vector",
  "matrix",
  "identity",
  "diagonal",
  "min",
  "max",
  "sum",
  "product",
  "transpose",
  "outerProduct",
  "symmetric",
  "cross",
  "skew",
]);

/**
 * Helper: build a (possibly nested) ModelicaArray filled with `value`.
 *
 * @param shape - An array of integers describing the target dimensions (e.g., [2, 3] for a 2x3 matrix).
 * @param value - The Modelica expression to use as the constant fill value.
 * @returns A new ModelicaArray instance representing the correctly shaped tensor of identical values.
 */
export function buildFilledArray(shape: number[], value: ModelicaExpression): ModelicaArray {
  if (shape.length === 1) {
    const n = shape[0] ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
      return new ModelicaArray([0], []);
    }
    // When the value is itself an array, produce a higher-dimensional result
    // e.g. fill({1,0,0}, 3) → {{1,0,0},{1,0,0},{1,0,0}} with shape [3,3]
    if (value instanceof ModelicaArray) {
      const innerElements = flattenArray(value);
      const elements: ModelicaExpression[] = [];
      for (let i = 0; i < n; i++) elements.push(...innerElements);
      return new ModelicaArray([n, ...value.shape], elements);
    }
    const arr = new ModelicaArray([n], Array(n).fill(value));
    return arr;
  }
  const [first, ...rest] = shape;
  const n = first ?? 0;
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
    return new ModelicaArray(
      shape.map(() => 0),
      [],
    );
  }
  if (n === 0) {
    // Empty array — preserve full shape for size() queries
    const innerShape = value instanceof ModelicaArray ? value.shape : [];
    return new ModelicaArray([...shape, ...innerShape], []);
  }
  const elements: ModelicaExpression[] = [];
  for (let i = 0; i < n; i++) {
    elements.push(buildFilledArray(rest, value));
  }
  return new ModelicaArray([n], elements);
}

/**
 * Extract a numeric value from an expression if it is an Integer or Real literal.
 *
 * @param expr - The evaluated ModelicaExpression to inspect.
 * @returns The primitive numeric value if it is a literal, or null otherwise.
 */
function toNumber(expr: ModelicaExpression | null): number | null {
  if (expr instanceof ModelicaIntegerLiteral) return expr.value;
  if (expr instanceof ModelicaRealLiteral) return expr.value;
  return null;
}

/**
 * Flatten a potentially nested ModelicaArray into a 1D list of leaf expressions.
 *
 * @param expr - The nested array expression (or scalar value) to flatten.
 * @returns A flat array of leaf ModelicaExpressions.
 */
function flattenArray(expr: ModelicaExpression): ModelicaExpression[] {
  if (expr instanceof ModelicaArray) {
    const result: ModelicaExpression[] = [];
    for (const e of expr.elements) result.push(...flattenArray(e));
    return result;
  }
  return [expr];
}

/**
 * Extract the multidimensional shape vector of a ModelicaArray expression.
 *
 * @param expr - The evaluated ModelicaExpression to analyze.
 * @returns An array of integers representing the dimension extents (e.g., [2, 3]). Returns an empty array [] for scalars.
 */
function getArrayShape(expr: ModelicaExpression): number[] {
  if (!(expr instanceof ModelicaArray)) return [];
  const shape = [expr.elements.length];
  if (expr.elements.length > 0 && expr.elements[0] instanceof ModelicaArray) {
    shape.push(...getArrayShape(expr.elements[0]));
  }
  return shape;
}

/**
 * Retrieve the element at index `[i, j]` of a 2D ModelicaArray.
 *
 * @param arr - The 2-dimensional array expression.
 * @param i - The row index.
 * @param j - The column index.
 * @returns The target ModelicaExpression if found, otherwise null.
 */
function getElement2D(arr: ModelicaArray, i: number, j: number): ModelicaExpression | null {
  const row = arr.elements[i];
  if (row instanceof ModelicaArray) return row.elements[j] ?? null;
  return null;
}

/** Control flow signal for break statements inside while loops. */
const BreakSignal = Symbol("BreakSignal");

/** Control flow signal for return statements inside functions. */
const ReturnSignal = Symbol("ReturnSignal");

/**
 * Visitor that interprets Modelica syntax expressions and evaluates them into runtime values.
 */
export class ModelicaInterpreter extends ModelicaSyntaxVisitor<ModelicaExpression, Scope> {
  /** Guard against infinite recursion during function algorithm execution. */
  #functionCallDepth = 0;
  static readonly MAX_FUNCTION_CALL_DEPTH = 64;
  /** When true, function algorithm sections are executed to compute output values. */
  #evaluateAlgorithms: boolean;
  /** Current `end` value for array subscript evaluation. */
  #endValue: number | null = null;

  /**
   * Initializes a new ModelicaInterpreter.
   *
   * @param evaluateAlgorithms - If true, the interpreter will actively execute function algorithm sections to compute values. Defaults to false.
   */
  constructor(evaluateAlgorithms = false) {
    super();
    this.#evaluateAlgorithms = evaluateAlgorithms;
  }

  /** Set the current `end` value for array subscript evaluation. */
  set endValue(value: number | null) {
    this.#endValue = value;
  }

  /**
   * Visits an array concatenation expression, evaluating each sub-expression and shaping the final array.
   *
   * @param node - The array concatenation syntax node (e.g., `[a, b; c, d]`).
   * @param scope - The current scope for name resolution.
   * @returns The evaluated ModelicaArray, or null if evaluation fails.
   */
  visitArrayConcatenation(node: ModelicaArrayConcatenationSyntaxNode, scope: Scope): ModelicaExpression | null {
    const elements: ModelicaExpression[] = [];
    const shape = [node.expressionLists.length, node.expressionLists[0]?.expressions?.length ?? 0];
    for (const expressionList of node.expressionLists ?? []) {
      for (const expression of expressionList.expressions ?? []) {
        const element = expression.accept(this, scope);
        if (element != null) elements.push(element);
      }
    }
    return new ModelicaArray(shape, elements);
  }

  /**
   * Visits an array constructor expression, evaluating elements to build an array.
   *
   * @param node - The array constructor syntax node (e.g., `{1, 2, 3}`).
   * @param scope - The current scope for name resolution.
   * @returns The evaluated ModelicaArray (1D), or null if evaluation fails.
   */
  visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode, scope: Scope): ModelicaExpression | null {
    const elements: ModelicaExpression[] = [];
    for (const expression of node.expressionList?.expressions ?? []) {
      const element = expression.accept(this, scope);
      if (element != null) elements.push(element);
    }
    return new ModelicaArray([elements.length], elements);
  }

  /**
   * Visits a binary expression, pushing evaluation to its operands.
   *
   * @param node - The binary expression syntax node (e.g., `a + b`).
   * @param scope - The current scope for name resolution.
   * @returns The resulting ModelicaBinaryExpression, or null if evaluation fails.
   */
  visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, scope: Scope): ModelicaExpression | null {
    const operand1 = node.operand1?.accept(this, scope);
    const operand2 = node.operand2?.accept(this, scope);
    if (node.operator && operand1 && operand2) return ModelicaBinaryExpression.new(node.operator, operand1, operand2);
    return null;
  }

  /**
   * Visits a boolean literal.
   *
   * @param node - The boolean literal syntax node.
   * @returns The evaluated ModelicaBooleanLiteral.
   */
  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode): ModelicaBooleanLiteral {
    return new ModelicaBooleanLiteral(node.value);
  }

  /**
   * Visits a range expression, evaluating the start, stop, and step expressions.
   *
   * @param node - The range expression syntax node (e.g., `1:2:10`).
   * @param scope - The current scope for name resolution.
   * @returns A ModelicaArray containing the generated sequence, or null if evaluation fails.
   */
  visitRangeExpression(node: ModelicaRangeExpressionSyntaxNode, scope: Scope): ModelicaExpression | null {
    const startExpr = node.startExpression?.accept(this, scope);
    const stopExpr = node.stopExpression?.accept(this, scope);
    const stepExpr = node.stepExpression?.accept(this, scope);
    const start = toNumber(startExpr ?? null);
    const stop = toNumber(stopExpr ?? null);
    const step = stepExpr ? toNumber(stepExpr) : 1;
    if (start == null || stop == null || step == null || step === 0) return null;

    const isReal =
      startExpr instanceof ModelicaRealLiteral ||
      stopExpr instanceof ModelicaRealLiteral ||
      stepExpr instanceof ModelicaRealLiteral;

    // Guard against infinite/huge ranges (e.g., 1:1e-300:10)
    const estimatedCount = Math.abs((stop - start) / step) + 1;
    if (!isFinite(estimatedCount) || estimatedCount > 100_000) return null;

    const elements: ModelicaExpression[] = [];
    if (step > 0) {
      for (let v = start; v <= stop; v += step)
        elements.push(isReal ? new ModelicaRealLiteral(v) : new ModelicaIntegerLiteral(v));
    } else {
      for (let v = start; v >= stop; v += step)
        elements.push(isReal ? new ModelicaRealLiteral(v) : new ModelicaIntegerLiteral(v));
    }
    return new ModelicaArray([elements.length], elements);
  }

  /**
   * Visits an if-else expression, evaluating the condition and returning the appropriate branch.
   * Only constant-folds when the condition evaluates to a literal boolean.
   *
   * @param node - The if-else expression syntax node.
   * @param scope - The current scope for name resolution.
   * @returns The evaluated branch expression, or null if the condition can't be resolved.
   */
  visitIfElseExpression(node: ModelicaIfElseExpressionSyntaxNode, scope: Scope): ModelicaExpression | null {
    // Only constant-fold when the condition is a direct boolean literal in the AST
    // (e.g., `if true then...`), not a resolved parameter reference. This preserves
    // `if b then 1.0 else 2.0` for the flattener to handle symbolically.
    if (!(node.condition instanceof ModelicaBooleanLiteralSyntaxNode)) {
      return null;
    }
    const condValue = node.condition.value;
    if (condValue) {
      return node.expression?.accept(this, scope) ?? null;
    }
    // Check elseif clauses
    for (const clause of node.elseIfExpressionClauses ?? []) {
      if (clause.condition instanceof ModelicaBooleanLiteralSyntaxNode && clause.condition.value) {
        return clause.expression?.accept(this, scope) ?? null;
      }
      // If elseif condition is not a literal, can't fold further
      if (!(clause.condition instanceof ModelicaBooleanLiteralSyntaxNode)) {
        return null;
      }
    }
    return node.elseExpression?.accept(this, scope) ?? null;
  }

  /**
   * Visits a component reference, resolving the name to its corresponding value or expression.
   * Handles static array subscript evaluation if subscripts are provided.
   *
   * @param node - The component reference syntax node.
   * @param scope - The current scope for name resolution.
   * @returns The resolved ModelicaExpression, or null if unresolved.
   */
  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, scope: Scope): ModelicaExpression | null {
    const namedElement = scope.resolveComponentReference(node);
    if (!namedElement) return null;
    let result: ModelicaExpression | null;
    if (namedElement instanceof ModelicaClassInstance) result = ModelicaExpression.fromClassInstance(namedElement);
    else if (namedElement instanceof ModelicaComponentInstance) {
      if (!namedElement.instantiated && !namedElement.instantiating) namedElement.instantiate();
      result = ModelicaExpression.fromClassInstance(namedElement.classInstance);
    } else {
      throw new Error();
    }
    // Handle array subscripts like b[end] or b[2]
    const subscripts = node.parts[node.parts.length - 1]?.arraySubscripts?.subscripts;
    if (result instanceof ModelicaArray && subscripts && subscripts.length > 0) {
      for (const sub of subscripts) {
        if (!(result instanceof ModelicaArray)) break;
        // Set end value for this array dimension
        const prevEnd = this.#endValue;
        this.#endValue = result.shape[0] ?? 0;
        const indexExpr = sub.expression?.accept(this, scope);
        this.#endValue = prevEnd;
        if (indexExpr instanceof ModelicaIntegerLiteral) {
          const idx = indexExpr.value - 1; // 1-indexed to 0-indexed
          result = result.elements[idx] ?? null;
        } else {
          return null; // Cannot resolve subscript statically
        }
      }
    }
    return result;
  }

  /**
   * Visits an 'end' expression used inside array subscripts.
   *
   * @param _node - The end expression syntax node.
   * @param _scope - The current scope.
   * @returns The evaluated end integer value based on the current dimension, or null if unknown.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitEndExpression(_node: ModelicaEndExpressionSyntaxNode, _scope: Scope): ModelicaExpression | null {
    if (this.#endValue != null) return new ModelicaIntegerLiteral(this.#endValue);
    return null;
  }

  /**
   * Evaluate positional arguments of a function call node, returning evaluated
   * `ModelicaExpression` values (or `null` for arguments that cannot be evaluated).
   */
  private evaluateArgs(node: ModelicaFunctionCallSyntaxNode, scope: Scope): (ModelicaExpression | null)[] {
    return (node.functionCallArguments?.arguments ?? []).map((arg) => arg.expression?.accept(this, scope) ?? null);
  }

  /**
   * Evaluate a comprehension clause, e.g. `sum(expr for i in 1:n)`.
   * Returns the array of evaluated body expressions for each iteration.
   */
  private evaluateComprehension(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression[] | null {
    const comp = node.functionCallArguments?.comprehensionClause;
    if (!comp?.expression || !comp.forIndexes.length) return null;

    // Evaluate all for-indexes to get their iteration ranges
    const iterators: { name: string; values: number[] }[] = [];
    for (const forIndex of comp.forIndexes) {
      const varName = forIndex.identifier?.text;
      if (!varName) return null;

      const rangeExpr = forIndex.expression;
      if (!rangeExpr) return null;

      if (rangeExpr instanceof ModelicaRangeExpressionSyntaxNode) {
        const startExpr = rangeExpr.startExpression?.accept(this, scope);
        const stopExpr = rangeExpr.stopExpression?.accept(this, scope);
        const stepExpr = rangeExpr.stepExpression?.accept(this, scope);
        const start = toNumber(startExpr ?? null);
        const stop = toNumber(stopExpr ?? null);
        const step = stepExpr ? toNumber(stepExpr) : 1;
        if (start == null || stop == null || step == null || step === 0) return null;

        const values: number[] = [];
        if (step > 0) {
          for (let v = start; v <= stop; v += step) values.push(v);
        } else {
          for (let v = start; v >= stop; v += step) values.push(v);
        }
        iterators.push({ name: varName, values });
      } else {
        // Could be an array expression
        const evaluated = rangeExpr.accept(this, scope);
        if (evaluated instanceof ModelicaArray) {
          const values: number[] = [];
          for (const el of evaluated.elements) {
            const v = toNumber(el);
            if (v == null) return null;
            values.push(v);
          }
          iterators.push({ name: varName, values });
        } else {
          return null;
        }
      }
    }

    // Generate cartesian product of all iterators and evaluate body
    const results: ModelicaExpression[] = [];
    const indices = iterators.map(() => 0);
    const body = comp.expression;

    while (true) {
      // Create bindings for current iteration
      const bindings = new Map<string, ModelicaClassInstance>();
      for (let k = 0; k < iterators.length; k++) {
        const iter = iterators[k];
        if (!iter) break;
        const val = iter.values[indices[k] ?? 0];
        if (val == null) break;
        const mod = new ModelicaModification(scope, [], null, null, new ModelicaIntegerLiteral(val));
        const instance = new ModelicaIntegerClassInstance(scope, mod);
        instance.instantiate();
        bindings.set(iter.name, instance);
      }

      const loopScope = new ModelicaLoopScope(scope, bindings);
      const result = body.accept(this, loopScope);
      if (result) results.push(result);

      // Advance indices (rightmost first)
      let carry = true;
      for (let k = iterators.length - 1; k >= 0; k--) {
        const iter = iterators[k];
        if (!iter) continue;
        const idx = (indices[k] ?? 0) + 1;
        if (idx < iter.values.length) {
          indices[k] = idx;
          carry = false;
          break;
        } else {
          indices[k] = 0;
        }
      }
      if (carry) break;
    }

    return results;
  }

  /**
   * Handle Modelica built-in array functions.
   * Returns the result expression, or `null` if the function name is not a
   * recognised built-in (so the caller can fall through to user-defined function handling).
   */
  private evaluateBuiltinFunction(
    name: string,
    node: ModelicaFunctionCallSyntaxNode,
    scope: Scope,
  ): ModelicaExpression | null | undefined {
    switch (name) {
      case "fill":
        return this.#evaluateFill(node, scope);
      case "size":
        return this.#evaluateSize(node, scope);
      case "zeros":
        return this.#evaluateZeros(node, scope);
      case "ones":
        return this.#evaluateOnes(node, scope);
      case "linspace":
        return this.#evaluateLinspace(node, scope);
      case "promote":
        return this.#evaluatePromote(node, scope);
      case "ndims":
        return this.#evaluateNdims(node, scope);
      case "scalar":
        return this.#evaluateScalar(node, scope);
      case "vector":
        return this.#evaluateVector(node, scope);
      case "matrix":
        return this.#evaluateMatrix(node, scope);
      case "identity":
        return this.#evaluateIdentity(node, scope);
      case "diagonal":
        return this.#evaluateDiagonal(node, scope);
      case "min":
        return this.#evaluateMin(node, scope);
      case "max":
        return this.#evaluateMax(node, scope);
      case "sum":
        return this.#evaluateSum(node, scope);
      case "product":
        return this.#evaluateProduct(node, scope);
      case "transpose":
        return this.#evaluateTranspose(node, scope);
      case "outerProduct":
        return this.#evaluateOuterProduct(node, scope);
      case "symmetric":
        return this.#evaluateSymmetric(node, scope);
      case "cross":
        return this.#evaluateCross(node, scope);
      case "skew":
        return this.#evaluateSkew(node, scope);
      default:
        return undefined;
    }
  }

  #evaluateFill(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const value = args[0];
    if (!value) return null;
    const shape: number[] = [];
    for (let i = 1; i < args.length; i++) {
      const dim = args[i];
      if (dim instanceof ModelicaIntegerLiteral) shape.push(dim.value);
      else return null;
    }
    if (shape.length === 0) return null;
    return buildFilledArray(shape, value);
  }

  #evaluateSize(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const argNodes = node.functionCallArguments?.arguments ?? [];
    const arrayRefExpr = argNodes[0]?.expression;
    if (!arrayRefExpr) return null;

    const dimArgExpr = argNodes[1]?.expression;
    const dimArg = dimArgExpr?.accept(this, scope) ?? null;

    // Try resolving via component reference first (handles ModelicaArrayClassInstance shapes)
    let shape: number[] | null = null;
    if (arrayRefExpr instanceof ModelicaComponentReferenceSyntaxNode) {
      const namedElement = scope.resolveComponentReference(arrayRefExpr);
      let arrayClassInstance: ModelicaArrayClassInstance | null = null;
      if (namedElement instanceof ModelicaComponentInstance) {
        if (!namedElement.instantiated && !namedElement.instantiating) namedElement.instantiate();
        if (namedElement.classInstance instanceof ModelicaArrayClassInstance) {
          arrayClassInstance = namedElement.classInstance;
        }
      } else if (namedElement instanceof ModelicaArrayClassInstance) {
        arrayClassInstance = namedElement;
      }
      if (arrayClassInstance) {
        shape = arrayClassInstance.shape;
      }
    }

    // Fallback: evaluate the expression and get shape from the resulting array
    if (!shape) {
      const evaluated = arrayRefExpr.accept(this, scope);
      if (evaluated) {
        shape = getArrayShape(evaluated);
      }
    }

    if (!shape || shape.length === 0) return null;

    if (dimArg instanceof ModelicaIntegerLiteral) {
      // 2-arg form: size(x, dim) — return the size of the given dimension
      const dimIndex = dimArg.value;
      const dimSize = shape[dimIndex - 1];
      if (dimSize == null) return null;
      return new ModelicaIntegerLiteral(dimSize);
    } else if (!dimArgExpr) {
      // 1-arg form: size(x) — return the full shape as an array
      const elements = shape.map((s) => new ModelicaIntegerLiteral(s));
      return new ModelicaArray([elements.length], elements);
    }

    return null;
  }

  #evaluateZeros(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const shape: number[] = [];
    for (const arg of args) {
      if (arg instanceof ModelicaIntegerLiteral) shape.push(arg.value);
      else return null;
    }
    if (shape.length === 0) return null;
    return buildFilledArray(shape, new ModelicaIntegerLiteral(0));
  }

  #evaluateOnes(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const shape: number[] = [];
    for (const arg of args) {
      if (arg instanceof ModelicaIntegerLiteral) shape.push(arg.value);
      else return null;
    }
    if (shape.length === 0) return null;
    return buildFilledArray(shape, new ModelicaIntegerLiteral(1));
  }

  #evaluateLinspace(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const x1Expr = args[0];
    const x2Expr = args[1];
    const nExpr = args[2];
    if (!x1Expr || !x2Expr || !(nExpr instanceof ModelicaIntegerLiteral)) return null;
    const n = nExpr.value;
    if (n < 2) return null;

    const x1 = toNumber(x1Expr);
    const x2 = toNumber(x2Expr);
    if (x1 == null || x2 == null) return null;

    const elements: ModelicaExpression[] = [];
    for (let i = 0; i < n; i++) {
      elements.push(new ModelicaRealLiteral(x1 + ((x2 - x1) * i) / (n - 1)));
    }
    return new ModelicaArray([n], elements);
  }

  #evaluatePromote(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const A = args[0];
    const nExpr = args[1];
    if (!A || !(nExpr instanceof ModelicaIntegerLiteral)) return null;
    const targetNdims = nExpr.value;
    const currentShape = getArrayShape(A);
    const currentNdims = currentShape.length;
    if (targetNdims <= currentNdims) return A;
    let result: ModelicaExpression = A;
    for (let i = currentNdims; i < targetNdims; i++) {
      result = new ModelicaArray([1], [result]);
    }
    return result;
  }

  #evaluateNdims(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const A = args[0];
    if (!A) return null;
    return new ModelicaIntegerLiteral(getArrayShape(A).length);
  }

  #evaluateScalar(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const A = args[0];
    if (!A) return null;
    const flat = flattenArray(A);
    if (flat.length === 1 && flat[0]) return flat[0];
    return null;
  }

  #evaluateVector(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const A = args[0];
    if (!A) return null;
    const flat = flattenArray(A);
    return new ModelicaArray([flat.length], flat);
  }

  #evaluateMatrix(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const A = args[0];
    if (!A) return null;
    const shape = getArrayShape(A);
    if (shape.length === 0) {
      return new ModelicaArray([1], [new ModelicaArray([1], [A])]);
    } else if (shape.length === 1) {
      return new ModelicaArray([1], [A]);
    } else if (shape.length === 2) {
      return A;
    }
    return null;
  }

  #evaluateIdentity(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const nExpr = args[0];
    if (!(nExpr instanceof ModelicaIntegerLiteral)) return null;
    const n = nExpr.value;
    const rows: ModelicaExpression[] = [];
    for (let i = 0; i < n; i++) {
      const row: ModelicaExpression[] = [];
      for (let j = 0; j < n; j++) {
        row.push(new ModelicaIntegerLiteral(i === j ? 1 : 0));
      }
      rows.push(new ModelicaArray([n], row));
    }
    return new ModelicaArray([n], rows);
  }

  #evaluateDiagonal(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const v = args[0];
    if (!(v instanceof ModelicaArray)) return null;
    const n = v.elements.length;
    const rows: ModelicaExpression[] = [];
    for (let i = 0; i < n; i++) {
      const row: ModelicaExpression[] = [];
      for (let j = 0; j < n; j++) {
        row.push(i === j ? (v.elements[i] ?? new ModelicaIntegerLiteral(0)) : new ModelicaIntegerLiteral(0));
      }
      rows.push(new ModelicaArray([n], row));
    }
    return new ModelicaArray([n], rows);
  }

  #evaluateMin(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    if (node.functionCallArguments?.comprehensionClause) {
      const values = this.evaluateComprehension(node, scope);
      if (!values || values.length === 0) return null;
      let minVal: number | null = null;
      let isReal = false;
      for (const e of values) {
        const v = toNumber(e);
        if (v == null) return null;
        if (minVal == null || v < minVal) minVal = v;
        if (e instanceof ModelicaRealLiteral) isReal = true;
      }
      if (minVal == null) return null;
      return isReal ? new ModelicaRealLiteral(minVal) : new ModelicaIntegerLiteral(minVal);
    }
    const args = this.evaluateArgs(node, scope);
    if (args.length === 2) {
      const x = toNumber(args[0] ?? null);
      const y = toNumber(args[1] ?? null);
      if (x == null || y == null) return null;
      const minVal = Math.min(x, y);
      if (args[0] instanceof ModelicaRealLiteral || args[1] instanceof ModelicaRealLiteral) {
        return new ModelicaRealLiteral(minVal);
      }
      return new ModelicaIntegerLiteral(minVal);
    } else if (args.length === 1 && args[0]) {
      const flat = flattenArray(args[0]);
      let minVal: number | null = null;
      let isReal = false;
      for (const e of flat) {
        const v = toNumber(e);
        if (v == null) return null;
        if (minVal == null || v < minVal) minVal = v;
        if (e instanceof ModelicaRealLiteral) isReal = true;
      }
      if (minVal == null) return null;
      return isReal ? new ModelicaRealLiteral(minVal) : new ModelicaIntegerLiteral(minVal);
    }
    return null;
  }

  #evaluateMax(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    if (node.functionCallArguments?.comprehensionClause) {
      const values = this.evaluateComprehension(node, scope);
      if (!values || values.length === 0) return null;
      let maxVal: number | null = null;
      let isReal = false;
      for (const e of values) {
        const v = toNumber(e);
        if (v == null) return null;
        if (maxVal == null || v > maxVal) maxVal = v;
        if (e instanceof ModelicaRealLiteral) isReal = true;
      }
      if (maxVal == null) return null;
      return isReal ? new ModelicaRealLiteral(maxVal) : new ModelicaIntegerLiteral(maxVal);
    }
    const args = this.evaluateArgs(node, scope);
    if (args.length === 2) {
      const x = toNumber(args[0] ?? null);
      const y = toNumber(args[1] ?? null);
      if (x == null || y == null) return null;
      const maxVal = Math.max(x, y);
      if (args[0] instanceof ModelicaRealLiteral || args[1] instanceof ModelicaRealLiteral) {
        return new ModelicaRealLiteral(maxVal);
      }
      return new ModelicaIntegerLiteral(maxVal);
    } else if (args.length === 1 && args[0]) {
      const flat = flattenArray(args[0]);
      let maxVal: number | null = null;
      let isReal = false;
      for (const e of flat) {
        const v = toNumber(e);
        if (v == null) return null;
        if (maxVal == null || v > maxVal) maxVal = v;
        if (e instanceof ModelicaRealLiteral) isReal = true;
      }
      if (maxVal == null) return null;
      return isReal ? new ModelicaRealLiteral(maxVal) : new ModelicaIntegerLiteral(maxVal);
    }
    return null;
  }

  #evaluateSum(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    if (node.functionCallArguments?.comprehensionClause) {
      const values = this.evaluateComprehension(node, scope);
      if (!values || values.length === 0) return null;
      let total = 0;
      let isReal = false;
      for (const e of values) {
        const v = toNumber(e);
        if (v == null) return null;
        total += v;
        if (e instanceof ModelicaRealLiteral) isReal = true;
      }
      return isReal ? new ModelicaRealLiteral(total) : new ModelicaIntegerLiteral(total);
    }
    const args = this.evaluateArgs(node, scope);
    if (args.length === 1 && args[0]) {
      const flat = flattenArray(args[0]);
      let total = 0;
      let isReal = false;
      for (const e of flat) {
        const v = toNumber(e);
        if (v == null) return null;
        total += v;
        if (e instanceof ModelicaRealLiteral) isReal = true;
      }
      return isReal ? new ModelicaRealLiteral(total) : new ModelicaIntegerLiteral(total);
    }
    return null;
  }

  #evaluateProduct(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    if (node.functionCallArguments?.comprehensionClause) {
      const values = this.evaluateComprehension(node, scope);
      if (!values || values.length === 0) return null;
      let total = 1;
      let isReal = false;
      for (const e of values) {
        const v = toNumber(e);
        if (v == null) return null;
        total *= v;
        if (e instanceof ModelicaRealLiteral) isReal = true;
      }
      return isReal ? new ModelicaRealLiteral(total) : new ModelicaIntegerLiteral(total);
    }
    const args = this.evaluateArgs(node, scope);
    if (args.length === 1 && args[0]) {
      const flat = flattenArray(args[0]);
      let total = 1;
      let isReal = false;
      for (const e of flat) {
        const v = toNumber(e);
        if (v == null) return null;
        total *= v;
        if (e instanceof ModelicaRealLiteral) isReal = true;
      }
      return isReal ? new ModelicaRealLiteral(total) : new ModelicaIntegerLiteral(total);
    }
    return null;
  }

  #evaluateTranspose(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const A = args[0];
    if (!(A instanceof ModelicaArray)) return null;
    const shape = getArrayShape(A);
    if (shape.length !== 2) return null;
    const [nRows, nCols] = shape;
    if (nRows == null || nCols == null) return null;
    const rows: ModelicaExpression[] = [];
    for (let j = 0; j < nCols; j++) {
      const row: ModelicaExpression[] = [];
      for (let i = 0; i < nRows; i++) {
        row.push(getElement2D(A, i, j) ?? new ModelicaIntegerLiteral(0));
      }
      rows.push(new ModelicaArray([nRows], row));
    }
    return new ModelicaArray([nCols], rows);
  }

  #evaluateOuterProduct(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const x = args[0];
    const y = args[1];
    if (!(x instanceof ModelicaArray) || !(y instanceof ModelicaArray)) return null;
    const n = x.elements.length;
    const m = y.elements.length;
    const rows: ModelicaExpression[] = [];
    for (let i = 0; i < n; i++) {
      const row: ModelicaExpression[] = [];
      for (let j = 0; j < m; j++) {
        const xi = toNumber(x.elements[i] ?? null);
        const yj = toNumber(y.elements[j] ?? null);
        if (xi == null || yj == null) return null;
        row.push(new ModelicaRealLiteral(xi * yj));
      }
      rows.push(new ModelicaArray([m], row));
    }
    return new ModelicaArray([n], rows);
  }

  #evaluateSymmetric(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const A = args[0];
    if (!(A instanceof ModelicaArray)) return null;
    const shape = getArrayShape(A);
    if (shape.length !== 2 || shape[0] !== shape[1]) return null;
    const n = shape[0] ?? 0;
    const rows: ModelicaExpression[] = [];
    for (let i = 0; i < n; i++) {
      const row: ModelicaExpression[] = [];
      for (let j = 0; j < n; j++) {
        if (j >= i) {
          row.push(getElement2D(A, i, j) ?? new ModelicaIntegerLiteral(0));
        } else {
          row.push(getElement2D(A, j, i) ?? new ModelicaIntegerLiteral(0));
        }
      }
      rows.push(new ModelicaArray([n], row));
    }
    return new ModelicaArray([n], rows);
  }

  #evaluateCross(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const x = args[0];
    const y = args[1];
    if (!(x instanceof ModelicaArray) || !(y instanceof ModelicaArray)) return null;
    if (x.elements.length !== 3 || y.elements.length !== 3) return null;
    const x1 = toNumber(x.elements[0] ?? null),
      x2 = toNumber(x.elements[1] ?? null),
      x3 = toNumber(x.elements[2] ?? null);
    const y1 = toNumber(y.elements[0] ?? null),
      y2 = toNumber(y.elements[1] ?? null),
      y3 = toNumber(y.elements[2] ?? null);
    if (x1 == null || x2 == null || x3 == null || y1 == null || y2 == null || y3 == null) return null;
    return new ModelicaArray(
      [3],
      [
        new ModelicaRealLiteral(x2 * y3 - x3 * y2),
        new ModelicaRealLiteral(x3 * y1 - x1 * y3),
        new ModelicaRealLiteral(x1 * y2 - x2 * y1),
      ],
    );
  }

  #evaluateSkew(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    const args = this.evaluateArgs(node, scope);
    const x = args[0];
    if (!(x instanceof ModelicaArray) || x.elements.length !== 3) return null;
    const x1 = toNumber(x.elements[0] ?? null),
      x2 = toNumber(x.elements[1] ?? null),
      x3 = toNumber(x.elements[2] ?? null);
    if (x1 == null || x2 == null || x3 == null) return null;
    return new ModelicaArray(
      [3],
      [
        new ModelicaArray([3], [new ModelicaRealLiteral(0), new ModelicaRealLiteral(-x3), new ModelicaRealLiteral(x2)]),
        new ModelicaArray([3], [new ModelicaRealLiteral(x3), new ModelicaRealLiteral(0), new ModelicaRealLiteral(-x1)]),
        new ModelicaArray([3], [new ModelicaRealLiteral(-x2), new ModelicaRealLiteral(x1), new ModelicaRealLiteral(0)]),
      ],
    );
  }

  /**
   * Visits a generic function call node, evaluating arguments and interpreting built-in or user-defined functions.
   *
   * @param node - The function call syntax node.
   * @param scope - The current scope for resolving the function definition.
   * @returns The evaluated result expression (scalar or array), or null if the function is unresolvable or fails.
   */
  visitFunctionCall(node: ModelicaFunctionCallSyntaxNode, scope: Scope): ModelicaExpression | null {
    // Check for built-in array functions first
    const funcName =
      node.functionReference?.parts?.length === 1 ? (node.functionReference.parts[0]?.identifier?.text ?? null) : null;
    if (funcName && BUILTIN_ARRAY_FUNCTIONS.has(funcName)) {
      const result = this.evaluateBuiltinFunction(funcName, node, scope);
      if (result !== undefined) return result;
    }

    const functionInstance = scope.resolveComponentReference(node.functionReference);
    if (!(functionInstance instanceof ModelicaClassInstance)) return null;
    const parameters: ModelicaParameterModification[] = [];
    const inputParameters = Array.from(functionInstance.inputParameters);
    if (node.functionCallArguments?.arguments) {
      for (let i = 0; i < node.functionCallArguments.arguments.length; i++) {
        const name = inputParameters[i]?.name;
        const expression = node.functionCallArguments.arguments[i]?.expression;
        if (name && expression) parameters.push(new ModelicaParameterModification(scope, name, expression));
      }
    }
    for (const namedArgument of node.functionCallArguments?.namedArguments ?? []) {
      const name = namedArgument.identifier?.text;
      const expression = namedArgument.argument?.expression;
      if (name && expression) parameters.push(new ModelicaParameterModification(scope, name, expression));
    }
    if (functionInstance.classKind === ModelicaClassKind.RECORD) {
      return ModelicaExpression.fromClassInstance(functionInstance.clone(new ModelicaModification(scope, parameters)));
    } else if (functionInstance.classKind === ModelicaClassKind.FUNCTION) {
      const modification = new ModelicaModification(scope, parameters);
      // When evaluating algorithms, create a fresh clone to avoid mutating cached instances.
      // The clone cache returns the same instance on repeated calls, so algorithm execution
      // (which mutates output parameters in-place) would corrupt the cache.
      let clonedFunction: ModelicaClassInstance;
      if (this.#evaluateAlgorithms && functionInstance.abstractSyntaxNode) {
        const mergedModification = ModelicaModification.merge(functionInstance.modification, modification);
        clonedFunction = ModelicaClassInstance.new(
          functionInstance.parent,
          functionInstance.abstractSyntaxNode,
          mergedModification,
        );
        clonedFunction.instantiate();
      } else {
        clonedFunction = functionInstance.clone(modification);
      }

      // Execute algorithm statements to compute output values
      if (this.#evaluateAlgorithms && this.#functionCallDepth < ModelicaInterpreter.MAX_FUNCTION_CALL_DEPTH) {
        this.#functionCallDepth++;
        try {
          for (const statement of clonedFunction.algorithms) {
            statement.accept(this, clonedFunction);
          }
        } catch (e) {
          if (e !== ReturnSignal) throw e;
        } finally {
          this.#functionCallDepth--;
        }
      }

      const outputExpressions: ModelicaExpression[] = [];
      for (const outputParameter of clonedFunction.outputParameters) {
        const outputExpression = ModelicaExpression.fromClassInstance(outputParameter.classInstance);
        if (outputExpression) outputExpressions.push(outputExpression);
      }
      if (outputExpressions.length <= 1) {
        return outputExpressions[0] ?? null;
      } else {
        return new ModelicaArray([outputExpressions.length], outputExpressions);
      }
    } else {
      return null;
    }
  }

  /**
   * Visits a simple assignment statement (e.g., `v := expr;`), evaluating the source and mutating the target component.
   *
   * @param node - The simple assignment syntax node.
   * @param scope - The current scope to update.
   * @returns `null` in all cases, as assignment statements do not return expressions.
   */
  visitSimpleAssignmentStatement(node: ModelicaSimpleAssignmentStatementSyntaxNode, scope: Scope): null {
    const value = node.source?.accept(this, scope);
    const targetName = node.target?.parts?.[0]?.identifier?.text;
    if (value && targetName) {
      const target = scope.resolveSimpleName(targetName);
      if (target instanceof ModelicaComponentInstance) {
        const mod = new ModelicaModification(null, [], null, null, value);
        target.classInstance = target.classInstance?.clone(mod) ?? null;
      }
    }
    return null;
  }

  /**
   * Evaluate a function call from a procedure call or complex assignment statement.
   * These nodes have separate functionReference and functionCallArguments fields
   * instead of being wrapped in a ModelicaFunctionCallSyntaxNode.
   */
  private callFunction(
    functionReference: ModelicaComponentReferenceSyntaxNode | null,
    functionCallArguments: ModelicaFunctionCallSyntaxNode["functionCallArguments"],
    scope: Scope,
  ): ModelicaExpression | null {
    const functionInstance = scope.resolveComponentReference(functionReference);
    if (!(functionInstance instanceof ModelicaClassInstance)) return null;
    if (functionInstance.classKind !== ModelicaClassKind.FUNCTION) return null;

    const parameters: ModelicaParameterModification[] = [];
    const inputParameters = Array.from(functionInstance.inputParameters);
    if (functionCallArguments?.arguments) {
      for (let i = 0; i < functionCallArguments.arguments.length; i++) {
        const name = inputParameters[i]?.name;
        const expression = functionCallArguments.arguments[i]?.expression;
        if (name && expression) parameters.push(new ModelicaParameterModification(scope, name, expression));
      }
    }
    for (const namedArgument of functionCallArguments?.namedArguments ?? []) {
      const name = namedArgument.identifier?.text;
      const expression = namedArgument.argument?.expression;
      if (name && expression) parameters.push(new ModelicaParameterModification(scope, name, expression));
    }

    const modification = new ModelicaModification(scope, parameters);
    let clonedFunction: ModelicaClassInstance;
    if (this.#evaluateAlgorithms && functionInstance.abstractSyntaxNode) {
      const mergedModification = ModelicaModification.merge(functionInstance.modification, modification);
      clonedFunction = ModelicaClassInstance.new(
        functionInstance.parent,
        functionInstance.abstractSyntaxNode,
        mergedModification,
      );
      clonedFunction.instantiate();
    } else {
      clonedFunction = functionInstance.clone(modification);
    }

    if (this.#evaluateAlgorithms && this.#functionCallDepth < ModelicaInterpreter.MAX_FUNCTION_CALL_DEPTH) {
      this.#functionCallDepth++;
      try {
        for (const statement of clonedFunction.algorithms) {
          statement.accept(this, clonedFunction);
        }
      } catch (e) {
        if (e !== ReturnSignal) throw e;
      } finally {
        this.#functionCallDepth--;
      }
    }

    const outputExpressions: ModelicaExpression[] = [];
    for (const outputParameter of clonedFunction.outputParameters) {
      const outputExpression = ModelicaExpression.fromClassInstance(outputParameter.classInstance);
      if (outputExpression) outputExpressions.push(outputExpression);
    }
    if (outputExpressions.length <= 1) {
      return outputExpressions[0] ?? null;
    } else {
      return new ModelicaArray([outputExpressions.length], outputExpressions);
    }
  }

  /**
   * Visits a procedure call statement, executing the referenced function specifically for its side effects.
   *
   * @param node - The procedure call syntax node.
   * @param scope - The current scope.
   * @returns `null` in all cases.
   */
  visitProcedureCallStatement(node: ModelicaProcedureCallStatementSyntaxNode, scope: Scope): null {
    this.callFunction(node.functionReference, node.functionCallArguments, scope);
    return null;
  }

  /**
   * Visits a complex assignment statement (e.g., `(x, y) := f(z)`), evaluating the function and assigning matching outputs.
   *
   * @param node - The complex assignment syntax node.
   * @param scope - The current scope to update outputs in.
   * @returns `null` in all cases.
   */
  visitComplexAssignmentStatement(node: ModelicaComplexAssignmentStatementSyntaxNode, scope: Scope): null {
    const result = this.callFunction(node.functionReference, node.functionCallArguments, scope);
    if (!result || !node.outputExpressionList) return null;

    // Extract output values — result is either a single expression or an array of expressions
    const outputs = result instanceof ModelicaArray ? result.elements : [result];
    const targets = node.outputExpressionList.outputs;

    for (let i = 0; i < Math.min(outputs.length, targets.length); i++) {
      const targetExpr = targets[i];
      const value = outputs[i];
      if (!targetExpr || !value) continue;

      // Target should be a component reference
      if (targetExpr instanceof ModelicaComponentReferenceSyntaxNode) {
        const targetName = targetExpr.parts?.[0]?.identifier?.text;
        if (targetName) {
          const target = scope.resolveSimpleName(targetName);
          if (target instanceof ModelicaComponentInstance) {
            const mod = new ModelicaModification(null, [], null, null, value);
            target.classInstance = target.classInstance?.clone(mod) ?? null;
          }
        }
      }
    }
    return null;
  }

  /**
   * Visits an output expression list, primarily unwrapping single parenthesized expressions.
   *
   * @param node - The output expression list syntax node.
   * @param scope - The current scope.
   * @returns The evaluated inner expression, or null if it's an un-handled multiple output list.
   */
  visitOutputExpressionList(node: ModelicaOutputExpressionListSyntaxNode, scope: Scope): ModelicaExpression | null {
    // For single-element output lists (parenthesized expressions), unwrap the inner expression
    if (node.outputs.length === 1 && node.outputs[0]) {
      return node.outputs[0].accept(this, scope);
    }
    return null;
  }

  /**
   * Visits an if-statement inside an algorithm section, evaluating branches sequentially and executing the first true branch.
   *
   * @param node - The if-statement syntax node.
   * @param scope - The current scope.
   * @returns `null` in all cases.
   */
  visitIfStatement(node: ModelicaIfStatementSyntaxNode, scope: Scope): null {
    // Evaluate the main condition
    const condition = node.condition?.accept(this, scope);
    if (condition instanceof ModelicaBooleanLiteral && condition.value) {
      for (const statement of node.statements) {
        statement.accept(this, scope);
      }
      return null;
    }
    // Evaluate elseif clauses
    for (const elseIfClause of node.elseIfStatementClauses) {
      const elseIfCondition = elseIfClause.condition?.accept(this, scope);
      if (elseIfCondition instanceof ModelicaBooleanLiteral && elseIfCondition.value) {
        for (const statement of elseIfClause.statements) {
          statement.accept(this, scope);
        }
        return null;
      }
    }
    // Execute else branch
    for (const statement of node.elseStatements) {
      statement.accept(this, scope);
    }
    return null;
  }

  /**
   * Visits a when-statement, evaluating branches and executing the first true branch block.
   *
   * @param node - The when-statement syntax node.
   * @param scope - The current scope.
   * @returns `null` in all cases.
   */
  visitWhenStatement(node: ModelicaWhenStatementSyntaxNode, scope: Scope): null {
    const condition = node.condition?.accept(this, scope);
    if (condition instanceof ModelicaBooleanLiteral && condition.value) {
      for (const statement of node.statements) {
        statement.accept(this, scope);
      }
      return null;
    }
    for (const elseWhenClause of node.elseWhenStatementClauses) {
      const elseWhenCondition = elseWhenClause.condition?.accept(this, scope);
      if (elseWhenCondition instanceof ModelicaBooleanLiteral && elseWhenCondition.value) {
        for (const statement of elseWhenClause.statements) {
          statement.accept(this, scope);
        }
        return null;
      }
    }
    return null;
  }

  /**
   * Visits a while-statement, evaluating the condition and executing the body loop iteratively.
   * Handles inner `break` signals automatically. Imposes a hard iteration limit to prevent infinite loops.
   *
   * @param node - The while-statement syntax node.
   * @param scope - The looping scope.
   * @returns `null` in all cases.
   */
  visitWhileStatement(node: ModelicaWhileStatementSyntaxNode, scope: Scope): null {
    const MAX_ITERATIONS = 10000;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const condition = node.condition?.accept(this, scope);
      if (!(condition instanceof ModelicaBooleanLiteral) || !condition.value) break;
      try {
        for (const statement of node.statements) {
          statement.accept(this, scope);
        }
      } catch (e) {
        if (e === BreakSignal) break;
        throw e;
      }
    }
    return null;
  }

  /**
   * Visits a for-statement, executing the body repeatedly across iterating ranges for each index variable.
   *
   * @param node - The for-statement syntax node.
   * @param scope - The base scope, which gets extended with the loop iteration variables.
   * @returns `null` in all cases.
   */
  visitForStatement(node: ModelicaForStatementSyntaxNode, scope: Scope): null {
    for (const forIndex of node.forIndexes) {
      const varName = forIndex.identifier?.text;
      if (!varName) continue;

      const rangeExpr = forIndex.expression;
      if (!rangeExpr) continue;

      // Evaluate the range to get iteration values
      const values: number[] = [];
      if (rangeExpr instanceof ModelicaRangeExpressionSyntaxNode) {
        const startExpr = rangeExpr.startExpression?.accept(this, scope);
        const stopExpr = rangeExpr.stopExpression?.accept(this, scope);
        const stepExpr = rangeExpr.stepExpression?.accept(this, scope);
        const start = toNumber(startExpr ?? null);
        const stop = toNumber(stopExpr ?? null);
        const step = stepExpr ? toNumber(stepExpr) : 1;
        if (start == null || stop == null || step == null || step === 0) continue;
        if (step > 0) {
          for (let v = start; v <= stop; v += step) values.push(v);
        } else {
          for (let v = start; v >= stop; v += step) values.push(v);
        }
      } else {
        const evaluated = rangeExpr.accept(this, scope);
        if (evaluated instanceof ModelicaArray) {
          for (const el of evaluated.elements) {
            const v = toNumber(el);
            if (v != null) values.push(v);
          }
        }
      }

      // Execute body for each iteration value
      for (const val of values) {
        const bindings = new Map<string, ModelicaClassInstance>();
        const mod = new ModelicaModification(scope, [], null, null, new ModelicaIntegerLiteral(val));
        const instance = new ModelicaIntegerClassInstance(scope, mod);
        instance.instantiate();
        bindings.set(varName, instance);
        const loopScope = new ModelicaLoopScope(scope, bindings);
        try {
          for (const statement of node.statements) {
            statement.accept(this, loopScope);
          }
        } catch (e) {
          if (e === BreakSignal) break;
          throw e;
        }
      }
    }
    return null;
  }

  /**
   * Initiates a break control flow signal.
   *
   * @throws A special BreakSignal symbol.
   */
  visitBreakStatement(): never {
    throw BreakSignal;
  }

  /**
   * Initiates a return control flow signal.
   *
   * @throws A special ReturnSignal symbol.
   */
  visitReturnStatement(): never {
    throw ReturnSignal;
  }

  /**
   * Visits a string literal.
   *
   * @param node - The string literal syntax node.
   * @returns The evaluated ModelicaStringLiteral.
   */
  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode): ModelicaExpression | null {
    return new ModelicaStringLiteral(node.text ?? "");
  }

  /**
   * Visits a unary expression.
   *
   * @param node - The unary expression syntax node.
   * @param scope - The current scope.
   * @returns The evaluated ModelicaUnaryExpression.
   */
  visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, scope: Scope): ModelicaExpression | null {
    const operand = node.operand?.accept(this, scope);
    if (node.operator && operand) return ModelicaUnaryExpression.new(node.operator, operand);
    return null;
  }

  /**
   * Visits an unsigned integer literal.
   *
   * @param node - The literal syntax node.
   * @returns The typed integer literal.
   */
  visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode): ModelicaIntegerLiteral {
    return new ModelicaIntegerLiteral(node.value);
  }

  /**
   * Visits an unsigned real literal.
   *
   * @param node - The literal syntax node.
   * @returns The typed real literal.
   */
  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode): ModelicaRealLiteral {
    return new ModelicaRealLiteral(node.value);
  }
}

/**
 * Evaluates a condition attribute (e.g., for conditional component instantiations).
 *
 * @param component - The component instance holding the condition attribute.
 * @returns The evaluated boolean result. Returns true if no condition is present. Returns undefined if evaluation fails.
 */
export function evaluateCondition(component: ModelicaComponentInstance): boolean | undefined {
  const node = component.abstractSyntaxNode;
  if (!node || !("conditionAttribute" in node) || !node.conditionAttribute?.condition) return true;

  const condition = node.conditionAttribute.condition;
  const interpreter = new ModelicaInterpreter();
  try {
    const result = condition.accept(interpreter, component.parent ?? component);
    if (result instanceof ModelicaBooleanLiteral) {
      return result.value;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    // Ignore evaluation failures
  }
  return undefined;
}
