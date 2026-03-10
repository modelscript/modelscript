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
  ModelicaComponentReferenceSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaRangeExpressionSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  ModelicaSyntaxVisitor,
  ModelicaUnaryExpressionSyntaxNode,
  ModelicaUnsignedIntegerLiteralSyntaxNode,
  ModelicaUnsignedRealLiteralSyntaxNode,
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
 * `shape` is e.g. [2, 3] for a 2×3 matrix.
 */
function buildFilledArray(shape: number[], value: ModelicaExpression): ModelicaArray {
  if (shape.length === 1) {
    const n = shape[0] ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
      return new ModelicaArray([0], []);
    }
    return new ModelicaArray([n], Array(n).fill(value));
  }
  const [first, ...rest] = shape;
  const n = first ?? 0;
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
    return new ModelicaArray([0], []);
  }
  const elements: ModelicaExpression[] = [];
  for (let i = 0; i < n; i++) {
    elements.push(buildFilledArray(rest, value));
  }
  return new ModelicaArray([n], elements);
}

/** Extract a numeric value from an expression (Integer or Real literal). */
function toNumber(expr: ModelicaExpression | null): number | null {
  if (expr instanceof ModelicaIntegerLiteral) return expr.value;
  if (expr instanceof ModelicaRealLiteral) return expr.value;
  return null;
}

/** Flatten a potentially nested ModelicaArray into a 1D list of leaf expressions. */
function flattenArray(expr: ModelicaExpression): ModelicaExpression[] {
  if (expr instanceof ModelicaArray) {
    const result: ModelicaExpression[] = [];
    for (const e of expr.elements) result.push(...flattenArray(e));
    return result;
  }
  return [expr];
}

/** Get the shape of a ModelicaArray expression. */
function getArrayShape(expr: ModelicaExpression): number[] {
  if (!(expr instanceof ModelicaArray)) return [];
  const shape = [expr.elements.length];
  if (expr.elements.length > 0 && expr.elements[0] instanceof ModelicaArray) {
    shape.push(...getArrayShape(expr.elements[0]));
  }
  return shape;
}

/** Get element at [i,j] of a 2D array. */
function getElement2D(arr: ModelicaArray, i: number, j: number): ModelicaExpression | null {
  const row = arr.elements[i];
  if (row instanceof ModelicaArray) return row.elements[j] ?? null;
  return null;
}

export class ModelicaInterpreter extends ModelicaSyntaxVisitor<ModelicaExpression, Scope> {
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

  visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode, scope: Scope): ModelicaExpression | null {
    const elements: ModelicaExpression[] = [];
    for (const expression of node.expressionList?.expressions ?? []) {
      const element = expression.accept(this, scope);
      if (element != null) elements.push(element);
    }
    return new ModelicaArray([elements.length], elements);
  }

  visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, scope: Scope): ModelicaExpression | null {
    const operand1 = node.operand1?.accept(this, scope);
    const operand2 = node.operand2?.accept(this, scope);
    if (node.operator && operand1 && operand2) return ModelicaBinaryExpression.new(node.operator, operand1, operand2);
    return null;
  }

  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode): ModelicaBooleanLiteral {
    return new ModelicaBooleanLiteral(node.value);
  }

  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, scope: Scope): ModelicaExpression | null {
    const namedElement = scope.resolveComponentReference(node);
    if (!namedElement) return null;
    if (namedElement instanceof ModelicaClassInstance) return ModelicaExpression.fromClassInstance(namedElement);
    else if (namedElement instanceof ModelicaComponentInstance) {
      if (!namedElement.instantiated && !namedElement.instantiating) namedElement.instantiate();
      return ModelicaExpression.fromClassInstance(namedElement.classInstance);
    } else {
      throw new Error();
    }
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
      // fill(s, n1, n2, ...) → array of shape [n1, n2, ...] filled with s
      case "fill": {
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

      // size(A, i) → integer size of dimension i of array A
      case "size": {
        const argNodes = node.functionCallArguments?.arguments ?? [];
        // First argument: component reference to an array variable
        const arrayRefExpr = argNodes[0]?.expression;
        // Second argument: dimension index
        const dimArg = argNodes[1]?.expression?.accept(this, scope);
        if (!arrayRefExpr || !(dimArg instanceof ModelicaIntegerLiteral)) return null;

        // Resolve the component reference to find its ModelicaArrayClassInstance
        const componentRef = arrayRefExpr;
        const namedElement = scope.resolveComponentReference(
          componentRef as unknown as ModelicaComponentReferenceSyntaxNode,
        );
        let arrayClassInstance: ModelicaArrayClassInstance | null = null;
        if (namedElement instanceof ModelicaComponentInstance) {
          if (!namedElement.instantiated && !namedElement.instantiating) namedElement.instantiate();
          if (namedElement.classInstance instanceof ModelicaArrayClassInstance) {
            arrayClassInstance = namedElement.classInstance;
          }
        } else if (namedElement instanceof ModelicaArrayClassInstance) {
          arrayClassInstance = namedElement;
        }
        if (!arrayClassInstance) return null;

        const dimIndex = dimArg.value; // 1-based
        const dimSize = arrayClassInstance.shape[dimIndex - 1];
        if (dimSize == null) return null;
        return new ModelicaIntegerLiteral(dimSize);
      }

      // zeros(n1, n2, ...) → fill(0, n1, n2, ...)
      case "zeros": {
        const args = this.evaluateArgs(node, scope);
        const shape: number[] = [];
        for (const arg of args) {
          if (arg instanceof ModelicaIntegerLiteral) shape.push(arg.value);
          else return null;
        }
        if (shape.length === 0) return null;
        return buildFilledArray(shape, new ModelicaIntegerLiteral(0));
      }

      // ones(n1, n2, ...) → fill(1, n1, n2, ...)
      case "ones": {
        const args = this.evaluateArgs(node, scope);
        const shape: number[] = [];
        for (const arg of args) {
          if (arg instanceof ModelicaIntegerLiteral) shape.push(arg.value);
          else return null;
        }
        if (shape.length === 0) return null;
        return buildFilledArray(shape, new ModelicaIntegerLiteral(1));
      }

      // linspace(x1, x2, n) → {x1, x1 + (x2-x1)/(n-1), ..., x2}
      case "linspace": {
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

      // promote(A, n) — adds trailing dimensions of size 1
      case "promote": {
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

      // ndims(A) — number of dimensions
      case "ndims": {
        const args = this.evaluateArgs(node, scope);
        const A = args[0];
        if (!A) return null;
        return new ModelicaIntegerLiteral(getArrayShape(A).length);
      }

      // scalar(A) — convert array of size 1 to scalar
      case "scalar": {
        const args = this.evaluateArgs(node, scope);
        const A = args[0];
        if (!A) return null;
        const flat = flattenArray(A);
        if (flat.length === 1 && flat[0]) return flat[0];
        return null;
      }

      // vector(A) — convert to 1D vector
      case "vector": {
        const args = this.evaluateArgs(node, scope);
        const A = args[0];
        if (!A) return null;
        const flat = flattenArray(A);
        return new ModelicaArray([flat.length], flat);
      }

      // matrix(A) — convert to 2D matrix
      case "matrix": {
        const args = this.evaluateArgs(node, scope);
        const A = args[0];
        if (!A) return null;
        const shape = getArrayShape(A);
        if (shape.length === 0) {
          // scalar → 1×1 matrix
          return new ModelicaArray([1], [new ModelicaArray([1], [A])]);
        } else if (shape.length === 1) {
          // vector → 1×n matrix
          return new ModelicaArray([1], [A]);
        } else if (shape.length === 2) {
          return A; // already 2D
        }
        return null;
      }

      // identity(n) → n×n identity matrix
      case "identity": {
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

      // diagonal(v) → diagonal matrix from vector v
      case "diagonal": {
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

      // min(A), min(x, y), min(... for ...)
      case "min": {
        // Comprehension form: min(expr for i in 1:n)
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
          // min(x, y)
          const x = toNumber(args[0] ?? null);
          const y = toNumber(args[1] ?? null);
          if (x == null || y == null) return null;
          const minVal = Math.min(x, y);
          if (args[0] instanceof ModelicaRealLiteral || args[1] instanceof ModelicaRealLiteral) {
            return new ModelicaRealLiteral(minVal);
          }
          return new ModelicaIntegerLiteral(minVal);
        } else if (args.length === 1 && args[0]) {
          // min(A) — minimum of all elements
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

      // max(A), max(x, y), max(... for ...)
      case "max": {
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

      // sum(A), sum(... for ...)
      case "sum": {
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

      // product(A), product(... for ...)
      case "product": {
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

      // transpose(A) — transpose a 2D matrix
      case "transpose": {
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

      // outerProduct(x, y) — x * y^T for vectors
      case "outerProduct": {
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

      // symmetric(A) — returns symmetric matrix: upper triangle from A
      case "symmetric": {
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

      // cross(x, y) — cross product of 3-vectors
      case "cross": {
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

      // skew(x) — skew-symmetric matrix from 3-vector
      case "skew": {
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
            new ModelicaArray(
              [3],
              [new ModelicaRealLiteral(0), new ModelicaRealLiteral(-x3), new ModelicaRealLiteral(x2)],
            ),
            new ModelicaArray(
              [3],
              [new ModelicaRealLiteral(x3), new ModelicaRealLiteral(0), new ModelicaRealLiteral(-x1)],
            ),
            new ModelicaArray(
              [3],
              [new ModelicaRealLiteral(-x2), new ModelicaRealLiteral(x1), new ModelicaRealLiteral(0)],
            ),
          ],
        );
      }

      default:
        return undefined; // Not a built-in function
    }
  }

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
      const outputParameters = functionInstance.clone(new ModelicaModification(scope, parameters)).outputParameters;
      const outputExpressions: ModelicaExpression[] = [];
      for (const outputParameter of outputParameters) {
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

  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode): ModelicaExpression | null {
    return new ModelicaStringLiteral(node.text ?? "");
  }

  visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, scope: Scope): ModelicaExpression | null {
    const operand = node.operand?.accept(this, scope);
    if (node.operator && operand) return ModelicaUnaryExpression.new(node.operator, operand);
    return null;
  }

  visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode): ModelicaIntegerLiteral {
    return new ModelicaIntegerLiteral(node.value);
  }

  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode): ModelicaRealLiteral {
    return new ModelicaRealLiteral(node.value);
  }
}

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
