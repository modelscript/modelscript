// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/homotopy-synthesis
 *
 * Static analysis and automatic code-action synthesis for the Modelica `homotopy(actual, simplified)`
 * operator (MLS §3.7.2.4). Identifies steep nonlinearities in continuous equations (such as
 * radiation $T^4$, quadratic turbulent drag $v \cdot |v|$, exponentials, and square roots) and
 * synthesizes first-order Taylor linearizations around nominal operating points to aid
 * nonlinear Newton-Raphson initialization convergence.
 */

/**
 * Metadata and synthesized replacement strings for a detected steep nonlinear sub-expression
 * within a Modelica equation.
 */
export interface NonlinearTermInfo {
  /** Raw source text of the nonlinear sub-expression (e.g. `T ^ 4` or `v * abs(v)`). */
  termText: string;
  /** Starting byte offset of the nonlinear sub-expression in the source file. */
  startByte: number;
  /** Ending byte offset (exclusive) of the nonlinear sub-expression in the source file. */
  endByte: number;
  /** Optional starting offset alias used by IDE code actions. */
  startOffset?: number | undefined;
  /** Optional ending offset alias used by IDE code actions. */
  endOffset?: number | undefined;
  /** Starting byte offset of the enclosing equation. */
  eqStartByte: number;
  /** Ending byte offset (exclusive) of the enclosing equation. */
  eqEndByte: number;
  /** Classification of the nonlinear mathematical form. */
  kind: "power" | "quadratic_drag" | "exp" | "sqrt" | "log";
  /** Primary iteration variable name inside the nonlinear term. */
  variableName: string;
  /** Synthesized linear proxy expression `simplified` for `homotopy(actual, simplified)`. */
  simplifiedSubterm: string;
  /** The sub-expression wrapped in `homotopy(actual, simplified)`. */
  wrappedSubterm: string;
  /** Complete equation text with the nonlinear sub-expression replaced by `wrappedSubterm`. */
  wrappedEquation: string;
}

/**
 * Derives a first-order Taylor expansion or secant linear proxy for a nonlinear sub-expression
 * around a nominal operating point ($300\,\text{K}$ for temperature-like variables starting with `T`/`t`,
 * or $1.0$ otherwise).
 *
 * @param kind - Category of nonlinearity (`"power"`, `"quadratic_drag"`, `"exp"`, `"sqrt"`, `"log"`).
 * @param varName - Primary state/algebraic variable identifier.
 * @param extra - Optional parameters including exponent `power`, inner `arg` expression, or `startVal`.
 * @returns Parenthesized Modelica expression string representing the linearized proxy.
 */
export function deriveSimplification(
  kind: "power" | "quadratic_drag" | "exp" | "sqrt" | "log",
  varName: string,
  extra?: { power?: number | undefined; arg?: string | undefined; startVal?: number | undefined },
): string {
  // Default nominal linearization point: 300.0 for thermodynamic temperatures (T*), 1.0 for general variables
  const startVal = extra?.startVal ?? (varName.toLowerCase().startsWith("t") ? 300.0 : 1.0);

  switch (kind) {
    case "power": {
      const p = extra?.power ?? 2;
      if (p === 2) {
        // First-order Taylor expansion of x^2 at x0: 2 * x0 * x - x0^2
        // x^2 -> 2 * x0 * x - x0^2
        const slope = 2 * startVal;
        const intercept = startVal * startVal;
        return `(${slope} * ${varName} - ${intercept})`;
      } else if (p === 4) {
        // First-order Taylor expansion of Stefan-Boltzmann radiation T^4 at T0: 4 * T0^3 * T - 3 * T0^4
        // x^4 -> 4 * x0^3 * x - 3 * x0^4
        const slope = 4 * Math.pow(startVal, 3);
        const intercept = 3 * Math.pow(startVal, 4);
        return `(${slope} * ${varName} - ${intercept})`;
      } else {
        // General power x^p linearization: p * x0^(p-1) * x - (p-1) * x0^p
        const slope = p * Math.pow(startVal, p - 1);
        const intercept = (p - 1) * Math.pow(startVal, p);
        return `(${slope.toFixed(4)} * ${varName} - ${intercept.toFixed(4)})`;
      }
    }
    case "quadratic_drag": {
      // Secant linearization of turbulent flow friction v * abs(v) -> v * v_nominal (or v * startVal)
      return `(${varName} * ${startVal})`;
    }
    case "exp": {
      const arg = extra?.arg ?? varName;
      // Maclaurin linearization of exp(u) around u0 = 0: exp(u) -> 1 + u
      return `(1.0 + (${arg}))`;
    }
    case "sqrt": {
      const arg = extra?.arg ?? varName;
      // First-order Taylor expansion of sqrt(u) around u0 = 1: 1 + 0.5 * (u - 1)
      return `(1.0 + 0.5 * ((${arg}) - 1.0))`;
    }
    case "log": {
      const arg = extra?.arg ?? varName;
      // First-order Taylor expansion of log(u) around u0 = 1: u - 1
      return `((${arg}) - 1.0)`;
    }
  }
}

/**
 * Recursively searches a CST node or text for equations containing steep nonlinearities
 * that do not already use the `homotopy()` operator (rule M5010 `homotopy-recommended`).
 *
 * @param cst - Root CST node of the class definition or equation section to inspect.
 * @returns Array of `NonlinearTermInfo` descriptors for all un-wrapped nonlinear terms found.
 */
export function findNonlinearTermsInCst(cst: any): NonlinearTermInfo[] {
  const results: NonlinearTermInfo[] = [];
  if (!cst) return results;

  // Find all equation sections and simple equations without crossing into nested class definitions
  function walk(node: any) {
    if (!node) return;

    const nodeType = node.type || "";
    if (node !== cst && (nodeType === "class_definition" || nodeType === "ClassDefinition")) {
      return;
    }
    if (
      nodeType === "simple_equation" ||
      nodeType === "SimpleEquation" ||
      nodeType === "equation" ||
      nodeType === "Equation"
    ) {
      const text = node.text || "";
      // If already wrapped in homotopy, skip per MLS §3.7.2.4 (nested homotopy is not needed)
      if (text.includes("homotopy(") || text.includes("homotopy (") || /homotopy\s*\(/.test(text)) {
        return;
      }

      // Guard against sub-expressions that are immediately preceded by `homotopy(`
      const isAlreadyInHomotopy = (idx: number) => {
        const prefix = text.slice(0, idx).trimEnd();
        return /homotopy\s*\(\s*$/.test(prefix);
      };

      // Check for nonlinear patterns in equation CST first, then fallback to text
      let eqStart = node.startIndex ?? node.startOffset ?? node.startByte ?? node.from ?? 0;
      if (eqStart === 0 && cst.text && text) {
        const posInCst = cst.text.indexOf(text);
        if (posInCst >= 0) {
          const cstStart = cst.startIndex ?? cst.startOffset ?? cst.startByte ?? cst.from ?? 0;
          eqStart = cstStart + posInCst;
        }
      }
      const eqEnd = node.endIndex ?? node.endOffset ?? node.endByte ?? node.to ?? eqStart + text.length;
      const seenRanges = new Set<string>();
      // Deduplicates by (kind, startByte, endByte) so CST traversal and regex fallback do not double-report
      const recordTerm = (
        kind: "power" | "quadratic_drag" | "exp" | "sqrt" | "log",
        termText: string,
        relIdx: number,
        varName: string,
        extra?: { power?: number | undefined; arg?: string | undefined },
      ) => {
        if (relIdx < 0 || isAlreadyInHomotopy(relIdx)) return;
        const startByte = eqStart + relIdx;
        const endByte = startByte + termText.length;
        const key = `${kind}:${startByte}:${endByte}`;
        if (seenRanges.has(key)) return;
        seenRanges.add(key);
        const simplified = deriveSimplification(kind, varName, extra);
        results.push({
          termText,
          startByte,
          endByte,
          startOffset: startByte,
          endOffset: endByte,
          eqStartByte: eqStart,
          eqEndByte: eqEnd,
          kind,
          variableName: varName,
          simplifiedSubterm: simplified,
          wrappedSubterm: `homotopy(${termText}, ${simplified})`,
          wrappedEquation:
            text.slice(0, relIdx) + `homotopy(${termText}, ${simplified})` + text.slice(relIdx + termText.length),
        });
      };

      const walkExprCst = (exprNode: any) => {
        if (!exprNode) return;
        const et = exprNode.type || "";
        const eText = (exprNode.text || "").trim();
        const nodeStart = exprNode.startIndex ?? exprNode.startOffset ?? exprNode.startByte ?? exprNode.from;
        const relIdx =
          typeof nodeStart === "number" && nodeStart >= eqStart ? nodeStart - eqStart : text.indexOf(eText);

        if (et === "binary_expression" || et === "arithmetic_expression" || et === "term" || et === "factor") {
          const powMatch = eText.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\^\s*([0-9]+(?:\.[0-9]+)?)$/);
          if (powMatch) {
            const power = parseFloat(powMatch[2]!);
            if (power > 1.0) {
              recordTerm("power", eText, relIdx, powMatch[1]!, { power });
              return;
            }
          }
          const dragMatch = eText.match(
            /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\*\s*abs\(\s*\1\s*\)$|^abs\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*\*\s*\2$/,
          );
          if (dragMatch) {
            const vName = (dragMatch[1] || dragMatch[2])!;
            recordTerm("quadratic_drag", eText, relIdx, vName);
            return;
          }
        } else if (et === "function_call" || et === "primary") {
          const fnMatch = eText.match(/^(exp|sqrt)\(([^()]+)\)$/);
          if (fnMatch) {
            const fnKind = fnMatch[1] as "exp" | "sqrt";
            const arg = fnMatch[2]!.trim();
            if (!/^[0-9.-]+$/.test(arg)) {
              const varName = arg.match(/[a-zA-Z_][a-zA-Z0-9_]*/)?.[0] || "x";
              recordTerm(fnKind, eText, relIdx, varName, { arg });
              return;
            }
          }
        }
        if (typeof exprNode.childCount === "number") {
          for (let i = 0; i < exprNode.childCount; i++) walkExprCst(exprNode.child(i));
        } else if (Array.isArray(exprNode.children)) {
          for (const ch of exprNode.children) walkExprCst(ch);
        }
      };
      walkExprCst(node);

      // 1. Power expressions: e.g. T ^ 4, v ^ 2, x ^ 3
      const powRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\^\s*([0-9]+(?:\.[0-9]+)?)/g;
      let match: RegExpExecArray | null;
      while ((match = powRegex.exec(text)) !== null) {
        const fullMatch = match[0];
        const varName = match[1]!;
        const power = parseFloat(match[2]!);
        if (power > 1.0) {
          recordTerm("power", fullMatch, match.index, varName, { power });
        }
      }

      // 2. Quadratic drag / friction: v * abs(v) or abs(v) * v
      const dragRegex =
        /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\*\s*abs\(\s*\1\s*\)|\babs\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*\*\s*\2/g;
      while ((match = dragRegex.exec(text)) !== null) {
        const fullMatch = match[0];
        const varName = (match[1] || match[2])!;
        recordTerm("quadratic_drag", fullMatch, match.index, varName);
      }

      // 3. Exponentials: exp(...)
      const expRegex = /\bexp\(([^()]+)\)/g;
      while ((match = expRegex.exec(text)) !== null) {
        const fullMatch = match[0];
        const arg = match[1]!.trim();
        // Skip trivial constants e.g. exp(1) or exp(0)
        if (!/^[0-9.-]+$/.test(arg)) {
          const varName = arg.match(/[a-zA-Z_][a-zA-Z0-9_]*/)?.[0] || "x";
          recordTerm("exp", fullMatch, match.index, varName, { arg });
        }
      }

      // 4. Square roots: sqrt(...)
      const sqrtRegex = /\bsqrt\(([^()]+)\)/g;
      while ((match = sqrtRegex.exec(text)) !== null) {
        const fullMatch = match[0];
        const arg = match[1]!.trim();
        if (!/^[0-9.-]+$/.test(arg)) {
          const varName = arg.match(/[a-zA-Z_][a-zA-Z0-9_]*/)?.[0] || "x";
          recordTerm("sqrt", fullMatch, match.index, varName, { arg });
        }
      }

      return; // Do not recurse deeper into simple_equation children once handled
    }

    if (typeof node.childCount === "number") {
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i));
      }
    } else if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(cst);
  return results;
}
