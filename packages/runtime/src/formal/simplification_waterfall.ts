// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — SMT Term-Rewriting Simplification Waterfall.
 *
 * Implements an active equational rewriting engine (Imandra computational logic equivalent)
 * that algebraically normalizes terms and constraints prior to DPLL(T), HC4 contraction,
 * and inductive proving:
 *   1. Identity elimination (x + 0 -> x, x * 1 -> x, x * 0 -> 0, x - x -> 0).
 *   2. Constant folding on arithmetic ASTs.
 *   3. Sign and negation canonicalization (-(-x) -> x, -(x - y) -> y - x).
 *   4. Linear subterm gathering (c1*x + c2*x -> (c1+c2)*x, (x + y) - y -> x).
 *   5. Constant migration from LHS expressions to constraint RHS.
 *   6. Zero external dependencies: 100% in-process WebAssembly/TypeScript.
 */

import type { ExprNode, NonlinearConstraint } from "./hc4_contractor.js";

export class SimplificationWaterfall {
  /**
   * Checks if two ExprNode structures are structurally identical.
   */
  public static areEqual(a: ExprNode, b: ExprNode): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
      case "var":
        return a.name === (b as typeof a).name;
      case "const":
        return Math.abs(a.value - (b as typeof a).value) < 1e-12;
      case "neg":
      case "sqr":
      case "sqrt":
      case "sin":
      case "cos":
        return SimplificationWaterfall.areEqual(a.child, (b as typeof a).child);
      case "add":
      case "sub":
      case "mul":
      case "div":
        return (
          SimplificationWaterfall.areEqual(a.left, (b as typeof a).left) &&
          SimplificationWaterfall.areEqual(a.right, (b as typeof a).right)
        );
    }
  }

  /**
   * Simplifies an ExprNode by applying the term rewriting waterfall until a fixed point is reached.
   */
  public static simplifyExpr(node: ExprNode, maxPasses = 10): ExprNode {
    let current = node;
    for (let pass = 0; pass < maxPasses; pass++) {
      const rewritten = SimplificationWaterfall.rewriteOnce(current);
      if (SimplificationWaterfall.areEqual(current, rewritten)) {
        break; // Fixed point reached
      }
      current = rewritten;
    }
    return current;
  }

  /**
   * Single recursive bottom-up rewriting pass.
   */
  private static rewriteOnce(node: ExprNode): ExprNode {
    switch (node.kind) {
      case "var":
      case "const":
        return node;

      case "neg": {
        const child = SimplificationWaterfall.rewriteOnce(node.child);
        // -(-x) -> x
        if (child.kind === "neg") return child.child;
        // -(const c) -> const(-c)
        if (child.kind === "const") return { kind: "const", value: -child.value };
        // -(x - y) -> y - x
        if (child.kind === "sub") return { kind: "sub", left: child.right, right: child.left };
        return { kind: "neg", child };
      }

      case "add": {
        const left = SimplificationWaterfall.rewriteOnce(node.left);
        const right = SimplificationWaterfall.rewriteOnce(node.right);

        // Constant folding: c1 + c2 -> c3
        if (left.kind === "const" && right.kind === "const") {
          return { kind: "const", value: left.value + right.value };
        }

        // x + 0 -> x
        if (right.kind === "const" && Math.abs(right.value) < 1e-12) return left;
        // 0 + x -> x
        if (left.kind === "const" && Math.abs(left.value) < 1e-12) return right;

        // x + (-y) -> x - y
        if (right.kind === "neg") return { kind: "sub", left, right: right.child };
        // (-x) + y -> y - x
        if (left.kind === "neg") return { kind: "sub", left: right, right: left.child };

        // x + x -> 2 * x
        if (SimplificationWaterfall.areEqual(left, right)) {
          return { kind: "mul", left: { kind: "const", value: 2 }, right: left };
        }

        // (x - y) + y -> x
        if (left.kind === "sub" && SimplificationWaterfall.areEqual(left.right, right)) {
          return left.left;
        }
        // y + (x - y) -> x
        if (right.kind === "sub" && SimplificationWaterfall.areEqual(left, right.right)) {
          return right.left;
        }

        // (c1 * x) + (c2 * x) -> (c1 + c2) * x
        if (
          left.kind === "mul" &&
          right.kind === "mul" &&
          left.left.kind === "const" &&
          right.left.kind === "const" &&
          SimplificationWaterfall.areEqual(left.right, right.right)
        ) {
          const sumCoeff = left.left.value + right.left.value;
          if (Math.abs(sumCoeff) < 1e-12) return { kind: "const", value: 0 };
          if (Math.abs(sumCoeff - 1) < 1e-12) return left.right;
          return { kind: "mul", left: { kind: "const", value: sumCoeff }, right: left.right };
        }

        return { kind: "add", left, right };
      }

      case "sub": {
        const left = SimplificationWaterfall.rewriteOnce(node.left);
        const right = SimplificationWaterfall.rewriteOnce(node.right);

        // Constant folding: c1 - c2 -> c3
        if (left.kind === "const" && right.kind === "const") {
          return { kind: "const", value: left.value - right.value };
        }

        // x - 0 -> x
        if (right.kind === "const" && Math.abs(right.value) < 1e-12) return left;
        // 0 - x -> -x
        if (left.kind === "const" && Math.abs(left.value) < 1e-12) return { kind: "neg", child: right };

        // x - x -> 0
        if (SimplificationWaterfall.areEqual(left, right)) {
          return { kind: "const", value: 0 };
        }

        // x - (-y) -> x + y
        if (right.kind === "neg") return { kind: "add", left, right: right.child };

        // (x + y) - y -> x
        if (left.kind === "add" && SimplificationWaterfall.areEqual(left.right, right)) {
          return left.left;
        }
        // (x + y) - x -> y
        if (left.kind === "add" && SimplificationWaterfall.areEqual(left.left, right)) {
          return left.right;
        }

        return { kind: "sub", left, right };
      }

      case "mul": {
        const left = SimplificationWaterfall.rewriteOnce(node.left);
        const right = SimplificationWaterfall.rewriteOnce(node.right);

        // Constant folding: c1 * c2 -> c3
        if (left.kind === "const" && right.kind === "const") {
          return { kind: "const", value: left.value * right.value };
        }

        // x * 0 -> 0, 0 * x -> 0
        if (
          (left.kind === "const" && Math.abs(left.value) < 1e-12) ||
          (right.kind === "const" && Math.abs(right.value) < 1e-12)
        ) {
          return { kind: "const", value: 0 };
        }

        // x * 1 -> x
        if (right.kind === "const" && Math.abs(right.value - 1) < 1e-12) return left;
        // 1 * x -> x
        if (left.kind === "const" && Math.abs(left.value - 1) < 1e-12) return right;

        // Canonical ordering: constants on the left
        if (right.kind === "const" && left.kind !== "const") {
          return { kind: "mul", left: right, right: left };
        }

        return { kind: "mul", left, right };
      }

      case "div": {
        const left = SimplificationWaterfall.rewriteOnce(node.left);
        const right = SimplificationWaterfall.rewriteOnce(node.right);

        // Constant folding: c1 / c2 -> c3
        if (left.kind === "const" && right.kind === "const" && Math.abs(right.value) > 1e-12) {
          return { kind: "const", value: left.value / right.value };
        }

        // x / 1 -> x
        if (right.kind === "const" && Math.abs(right.value - 1) < 1e-12) return left;
        // 0 / x -> 0
        if (left.kind === "const" && Math.abs(left.value) < 1e-12) return { kind: "const", value: 0 };

        // x / x -> 1
        if (SimplificationWaterfall.areEqual(left, right)) {
          return { kind: "const", value: 1 };
        }

        return { kind: "div", left, right };
      }

      case "sqr": {
        const child = SimplificationWaterfall.rewriteOnce(node.child);
        if (child.kind === "const") return { kind: "const", value: child.value * child.value };
        // (-x)^2 -> x^2
        if (child.kind === "neg") return { kind: "sqr", child: child.child };
        return { kind: "sqr", child };
      }

      case "sqrt": {
        const child = SimplificationWaterfall.rewriteOnce(node.child);
        if (child.kind === "const" && child.value >= 0) {
          return { kind: "const", value: Math.sqrt(child.value) };
        }
        return { kind: "sqrt", child };
      }

      case "sin": {
        const child = SimplificationWaterfall.rewriteOnce(node.child);
        if (child.kind === "const" && Math.abs(child.value) < 1e-12) return { kind: "const", value: 0 };
        return { kind: "sin", child };
      }

      case "cos": {
        const child = SimplificationWaterfall.rewriteOnce(node.child);
        if (child.kind === "const" && Math.abs(child.value) < 1e-12) return { kind: "const", value: 1 };
        return { kind: "cos", child };
      }
    }
  }

  /**
   * Simplifies a single non-linear constraint and migrates constants to RHS.
   */
  public static simplifyConstraint(constraint: NonlinearConstraint): NonlinearConstraint {
    let expr = SimplificationWaterfall.simplifyExpr(constraint.expr);
    let rel = constraint.rel;
    let rhs = constraint.rhs;

    // Migrate additions/subtractions of constants: (expr + c) rel rhs -> expr rel (rhs - c)
    if (expr.kind === "add") {
      if (expr.right.kind === "const") {
        rhs -= expr.right.value;
        expr = SimplificationWaterfall.simplifyExpr(expr.left);
      } else if (expr.left.kind === "const") {
        rhs -= expr.left.value;
        expr = SimplificationWaterfall.simplifyExpr(expr.right);
      }
    } else if (expr.kind === "sub") {
      if (expr.right.kind === "const") {
        rhs += expr.right.value;
        expr = SimplificationWaterfall.simplifyExpr(expr.left);
      }
    }

    // Eliminate negative multipliers: (-expr) rel rhs -> expr inverted_rel (-rhs)
    if (expr.kind === "neg") {
      expr = expr.child;
      rhs = -rhs;
      if (rel === "<=") rel = ">=";
      else if (rel === ">=") rel = "<=";
    }

    // Eliminate positive scalar multipliers: (c * expr) rel rhs -> expr rel (rhs / c)
    if (expr.kind === "mul" && expr.left.kind === "const" && expr.left.value > 0) {
      rhs = rhs / expr.left.value;
      expr = expr.right;
    }

    return { expr, rel, rhs };
  }

  /**
   * Pre-processes an array of constraints through the simplification waterfall.
   */
  public static simplifyConstraints(constraints: NonlinearConstraint[]): NonlinearConstraint[] {
    return constraints.map((c) => SimplificationWaterfall.simplifyConstraint(c));
  }
}
