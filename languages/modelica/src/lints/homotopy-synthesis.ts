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
  /** Starting character offset of the nonlinear sub-expression in the source file. */
  startOffset: number;
  /** Ending character offset (exclusive) of the nonlinear sub-expression in the source file. */
  endOffset: number;
  /** Starting character offset of the enclosing equation. */
  eqStartOffset: number;
  /** Ending character offset (exclusive) of the enclosing equation. */
  eqEndOffset: number;
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
      let eqStart = node.startIndex ?? node.startOffset ?? node.from ?? 0;
      if (eqStart === 0 && cst.text && text) {
        const posInCst = cst.text.indexOf(text);
        if (posInCst >= 0) {
          const cstStart = cst.startIndex ?? cst.startOffset ?? cst.from ?? 0;
          eqStart = cstStart + posInCst;
        }
      }
      const eqEnd = node.endIndex ?? node.endOffset ?? node.to ?? eqStart + text.length;
      const seenRanges = new Set<string>();
      // Deduplicates by (kind, startOffset, endOffset) so CST traversal and regex fallback do not double-report
      const recordTerm = (
        kind: "power" | "quadratic_drag" | "exp" | "sqrt" | "log",
        termText: string,
        relIdx: number,
        varName: string,
        extra?: { power?: number | undefined; arg?: string | undefined },
      ) => {
        if (relIdx < 0 || isAlreadyInHomotopy(relIdx)) return;
        const startOffset = eqStart + relIdx;
        const endOffset = startOffset + termText.length;
        const key = `${kind}:${startOffset}:${endOffset}`;
        if (seenRanges.has(key)) return;
        seenRanges.add(key);
        const simplified = deriveSimplification(kind, varName, extra);
        results.push({
          termText,
          startOffset,
          endOffset,
          eqStartOffset: eqStart,
          eqEndOffset: eqEnd,
          kind,
          variableName: varName,
          simplifiedSubterm: simplified,
          wrappedSubterm: `homotopy(${termText}, ${simplified})`,
          wrappedEquation:
            text.slice(0, relIdx) + `homotopy(${termText}, ${simplified})` + text.slice(relIdx + termText.length),
        });
      };

      function isIdent(s: string): boolean {
        if (!s) return false;
        const first = s[0]!;
        if (!((first >= "a" && first <= "z") || (first >= "A" && first <= "Z") || first === "_")) return false;
        for (let i = 1; i < s.length; i++) {
          const c = s[i]!;
          if (!((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_")) return false;
        }
        return true;
      }

      function isNumeric(s: string): boolean {
        if (!s) return false;
        let hasDot = false;
        let start = 0;
        if (s[0] === "-" || s[0] === "+") start = 1;
        if (start >= s.length) return false;
        for (let i = start; i < s.length; i++) {
          const c = s[i]!;
          if (c >= "0" && c <= "9") continue;
          if (c === "." && !hasDot) {
            hasDot = true;
            continue;
          }
          return false;
        }
        return true;
      }

      function extractFirstIdent(s: string): string | undefined {
        let i = 0;
        const len = s.length;
        while (i < len) {
          const ch = s[i]!;
          if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
            const start = i;
            i++;
            while (i < len) {
              const c = s[i]!;
              if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_") {
                i++;
              } else {
                break;
              }
            }
            return s.slice(start, i);
          }
          i++;
        }
        return undefined;
      }

      const walkExprCst = (exprNode: any) => {
        if (!exprNode) return;
        const et = exprNode.type || "";
        const eText = (exprNode.text || "").trim();
        const nodeStart = exprNode.startIndex ?? exprNode.startOffset ?? exprNode.from;
        const relIdx =
          typeof nodeStart === "number" && nodeStart >= eqStart ? nodeStart - eqStart : text.indexOf(eText);

        if (et === "binary_expression" || et === "arithmetic_expression" || et === "term" || et === "factor") {
          const caretIdx = eText.indexOf("^");
          if (caretIdx !== -1) {
            const lhs = eText.slice(0, caretIdx).trim();
            const rhs = eText.slice(caretIdx + 1).trim();
            const power = parseFloat(rhs);
            if (!isNaN(power) && power > 1.0 && isIdent(lhs)) {
              recordTerm("power", eText, relIdx, lhs, { power });
              return;
            }
          }
          const starIdx = eText.indexOf("*");
          if (starIdx !== -1) {
            const left = eText.slice(0, starIdx).trim();
            const right = eText.slice(starIdx + 1).trim();
            if (right.startsWith("abs(") && right.endsWith(")")) {
              const arg = right.slice(4, -1).trim();
              if (arg === left && isIdent(left)) {
                recordTerm("quadratic_drag", eText, relIdx, left);
                return;
              }
            } else if (left.startsWith("abs(") && left.endsWith(")")) {
              const arg = left.slice(4, -1).trim();
              if (arg === right && isIdent(right)) {
                recordTerm("quadratic_drag", eText, relIdx, right);
                return;
              }
            }
          }
        } else if (et === "function_call" || et === "primary") {
          if (eText.startsWith("exp(") && eText.endsWith(")")) {
            const arg = eText.slice(4, -1).trim();
            if (!isNumeric(arg)) {
              const varName = extractFirstIdent(arg) || "x";
              recordTerm("exp", eText, relIdx, varName, { arg });
              return;
            }
          } else if (eText.startsWith("sqrt(") && eText.endsWith(")")) {
            const arg = eText.slice(5, -1).trim();
            if (!isNumeric(arg)) {
              const varName = extractFirstIdent(arg) || "x";
              recordTerm("sqrt", eText, relIdx, varName, { arg });
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

      // Only run text-level scan when the CST visitor didn't match candidate terms
      if (seenRanges.size === 0) {
        // 1. Power expressions: e.g. T ^ 4, v ^ 2, x ^ 3
        let pIdx = text.indexOf("^");
        while (pIdx !== -1) {
          // Look backward for identifier
          let lhsEnd = pIdx - 1;
          while (lhsEnd >= 0 && (text[lhsEnd] === " " || text[lhsEnd] === "\t")) lhsEnd--;
          let lhsStart = lhsEnd;
          while (
            lhsStart >= 0 &&
            ((text[lhsStart]! >= "a" && text[lhsStart]! <= "z") ||
              (text[lhsStart]! >= "A" && text[lhsStart]! <= "Z") ||
              (text[lhsStart]! >= "0" && text[lhsStart]! <= "9") ||
              text[lhsStart] === "_")
          ) {
            lhsStart--;
          }
          lhsStart++;
          const varName = text.slice(lhsStart, lhsEnd + 1);

          // Look forward for number
          let rhsStart = pIdx + 1;
          while (rhsStart < text.length && (text[rhsStart] === " " || text[rhsStart] === "\t")) rhsStart++;
          let rhsEnd = rhsStart;
          while (rhsEnd < text.length && ((text[rhsEnd]! >= "0" && text[rhsEnd]! <= "9") || text[rhsEnd] === ".")) {
            rhsEnd++;
          }
          const numStr = text.slice(rhsStart, rhsEnd);
          const power = parseFloat(numStr);
          if (isIdent(varName) && !isNaN(power) && power > 1.0) {
            const fullMatch = text.slice(lhsStart, rhsEnd);
            recordTerm("power", fullMatch, lhsStart, varName, { power });
          }
          pIdx = text.indexOf("^", pIdx + 1);
        }

        // 2. Quadratic drag / friction: v * abs(v) or abs(v) * v
        let absIdx = text.indexOf("abs(");
        while (absIdx !== -1) {
          const closeParen = text.indexOf(")", absIdx);
          if (closeParen !== -1) {
            const vName = text.slice(absIdx + 4, closeParen).trim();
            if (isIdent(vName)) {
              // check if preceded by `vName * ` or followed by ` * vName`
              const pre = text.slice(0, absIdx).trimEnd();
              const post = text.slice(closeParen + 1).trimStart();
              if (pre.endsWith(`*`) && pre.slice(0, -1).trimEnd().endsWith(vName)) {
                const termStart = text.lastIndexOf(vName, absIdx);
                const fullMatch = text.slice(termStart, closeParen + 1);
                recordTerm("quadratic_drag", fullMatch, termStart, vName);
              } else if (post.startsWith(`*`) && post.slice(1).trimStart().startsWith(vName)) {
                const termEnd = closeParen + 1 + text.slice(closeParen + 1).indexOf(vName) + vName.length;
                const fullMatch = text.slice(absIdx, termEnd);
                recordTerm("quadratic_drag", fullMatch, absIdx, vName);
              }
            }
          }
          absIdx = text.indexOf("abs(", absIdx + 1);
        }

        // 3. Exponentials: exp(...)
        let expIdx = text.indexOf("exp(");
        while (expIdx !== -1) {
          const closeParen = text.indexOf(")", expIdx);
          if (closeParen !== -1) {
            const arg = text.slice(expIdx + 4, closeParen).trim();
            if (!isNumeric(arg)) {
              const varName = extractFirstIdent(arg) || "x";
              const fullMatch = text.slice(expIdx, closeParen + 1);
              recordTerm("exp", fullMatch, expIdx, varName, { arg });
            }
          }
          expIdx = text.indexOf("exp(", expIdx + 1);
        }

        // 4. Square roots: sqrt(...)
        let sqrtIdx = text.indexOf("sqrt(");
        while (sqrtIdx !== -1) {
          const closeParen = text.indexOf(")", sqrtIdx);
          if (closeParen !== -1) {
            const arg = text.slice(sqrtIdx + 5, closeParen).trim();
            if (!isNumeric(arg)) {
              const varName = extractFirstIdent(arg) || "x";
              const fullMatch = text.slice(sqrtIdx, closeParen + 1);
              recordTerm("sqrt", fullMatch, sqrtIdx, varName, { arg });
            }
          }
          sqrtIdx = text.indexOf("sqrt(", sqrtIdx + 1);
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
