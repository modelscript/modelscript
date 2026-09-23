// SPDX-License-Identifier: AGPL-3.0-or-later

export interface NonlinearTermInfo {
  termText: string;
  startByte: number;
  endByte: number;
  eqStartByte: number;
  eqEndByte: number;
  kind: "power" | "quadratic_drag" | "exp" | "sqrt" | "log";
  variableName: string;
  simplifiedSubterm: string;
  wrappedSubterm: string;
  wrappedEquation: string;
}

/**
 * Derives a Taylor expansion or linear proxy for a nonlinear sub-expression.
 */
export function deriveSimplification(
  kind: "power" | "quadratic_drag" | "exp" | "sqrt" | "log",
  varName: string,
  extra?: { power?: number; arg?: string; startVal?: number },
): string {
  const startVal = extra?.startVal ?? (varName.toLowerCase().startsWith("t") ? 300.0 : 1.0);

  switch (kind) {
    case "power": {
      const p = extra?.power ?? 2;
      if (p === 2) {
        // x^2 -> 2 * x0 * x - x0^2
        const slope = 2 * startVal;
        const intercept = startVal * startVal;
        return `(${slope} * ${varName} - ${intercept})`;
      } else if (p === 4) {
        // x^4 -> 4 * x0^3 * x - 3 * x0^4
        const slope = 4 * Math.pow(startVal, 3);
        const intercept = 3 * Math.pow(startVal, 4);
        return `(${slope} * ${varName} - ${intercept})`;
      } else {
        const slope = p * Math.pow(startVal, p - 1);
        const intercept = (p - 1) * Math.pow(startVal, p);
        return `(${slope.toFixed(4)} * ${varName} - ${intercept.toFixed(4)})`;
      }
    }
    case "quadratic_drag": {
      // v * abs(v) -> v * v_nominal (or v * startVal)
      return `(${varName} * ${startVal})`;
    }
    case "exp": {
      const arg = extra?.arg ?? varName;
      // exp(u) -> 1 + u
      return `(1.0 + (${arg}))`;
    }
    case "sqrt": {
      const arg = extra?.arg ?? varName;
      // sqrt(u) around u0=1 -> 1 + 0.5 * (u - 1)
      return `(1.0 + 0.5 * ((${arg}) - 1.0))`;
    }
    case "log": {
      const arg = extra?.arg ?? varName;
      // log(u) around u0=1 -> u - 1
      return `((${arg}) - 1.0)`;
    }
  }
}

/**
 * Recursively searches a CST node or text for equations containing steep nonlinearities
 * that do not already use the homotopy() operator.
 */
export function findNonlinearTermsInCst(cst: any): NonlinearTermInfo[] {
  const results: NonlinearTermInfo[] = [];
  if (!cst) return results;

  // Find all equation sections and simple equations
  function walk(node: any) {
    if (!node) return;

    const nodeType = node.type || "";
    if (
      nodeType === "simple_equation" ||
      nodeType === "SimpleEquation" ||
      nodeType === "equation" ||
      nodeType === "Equation"
    ) {
      const text = node.text || "";
      // If already wrapped in homotopy, skip
      if (text.includes("homotopy(") || text.includes("homotopy (")) {
        return;
      }

      // Check for nonlinear patterns in equation text
      const eqStart = node.startIndex ?? 0;
      const eqEnd = node.endIndex ?? eqStart + text.length;

      // 1. Power expressions: e.g. T ^ 4, v ^ 2, x ^ 3
      const powRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\^\s*([0-9]+(?:\.[0-9]+)?)/g;
      let match: RegExpExecArray | null;
      while ((match = powRegex.exec(text)) !== null) {
        const fullMatch = match[0];
        const varName = match[1];
        const power = parseFloat(match[2]);
        if (power > 1.0) {
          const startByte = eqStart + match.index;
          const endByte = startByte + fullMatch.length;
          const simplified = deriveSimplification("power", varName, { power });
          results.push({
            termText: fullMatch,
            startByte,
            endByte,
            eqStartByte: eqStart,
            eqEndByte: eqEnd,
            kind: "power",
            variableName: varName,
            simplifiedSubterm: simplified,
            wrappedSubterm: `homotopy(${fullMatch}, ${simplified})`,
            wrappedEquation:
              text.slice(0, match.index) +
              `homotopy(${fullMatch}, ${simplified})` +
              text.slice(match.index + fullMatch.length),
          });
        }
      }

      // 2. Quadratic drag / friction: v * abs(v) or abs(v) * v
      const dragRegex =
        /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\*\s*abs\(\s*\1\s*\)|\babs\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*\*\s*\2/g;
      while ((match = dragRegex.exec(text)) !== null) {
        const fullMatch = match[0];
        const varName = match[1] || match[2];
        const startByte = eqStart + match.index;
        const endByte = startByte + fullMatch.length;
        const simplified = deriveSimplification("quadratic_drag", varName);
        results.push({
          termText: fullMatch,
          startByte,
          endByte,
          eqStartByte: eqStart,
          eqEndByte: eqEnd,
          kind: "quadratic_drag",
          variableName: varName,
          simplifiedSubterm: simplified,
          wrappedSubterm: `homotopy(${fullMatch}, ${simplified})`,
          wrappedEquation:
            text.slice(0, match.index) +
            `homotopy(${fullMatch}, ${simplified})` +
            text.slice(match.index + fullMatch.length),
        });
      }

      // 3. Exponentials: exp(...)
      const expRegex = /\bexp\(([^()]+)\)/g;
      while ((match = expRegex.exec(text)) !== null) {
        const fullMatch = match[0];
        const arg = match[1].trim();
        // Skip trivial constants e.g. exp(1) or exp(0)
        if (!/^[0-9.-]+$/.test(arg)) {
          const varName = arg.match(/[a-zA-Z_][a-zA-Z0-9_]*/)?.[0] || "x";
          const startByte = eqStart + match.index;
          const endByte = startByte + fullMatch.length;
          const simplified = deriveSimplification("exp", varName, { arg });
          results.push({
            termText: fullMatch,
            startByte,
            endByte,
            eqStartByte: eqStart,
            eqEndByte: eqEnd,
            kind: "exp",
            variableName: varName,
            simplifiedSubterm: simplified,
            wrappedSubterm: `homotopy(${fullMatch}, ${simplified})`,
            wrappedEquation:
              text.slice(0, match.index) +
              `homotopy(${fullMatch}, ${simplified})` +
              text.slice(match.index + fullMatch.length),
          });
        }
      }

      // 4. Square roots: sqrt(...)
      const sqrtRegex = /\bsqrt\(([^()]+)\)/g;
      while ((match = sqrtRegex.exec(text)) !== null) {
        const fullMatch = match[0];
        const arg = match[1].trim();
        if (!/^[0-9.-]+$/.test(arg)) {
          const varName = arg.match(/[a-zA-Z_][a-zA-Z0-9_]*/)?.[0] || "x";
          const startByte = eqStart + match.index;
          const endByte = startByte + fullMatch.length;
          const simplified = deriveSimplification("sqrt", varName, { arg });
          results.push({
            termText: fullMatch,
            startByte,
            endByte,
            eqStartByte: eqStart,
            eqEndByte: eqEnd,
            kind: "sqrt",
            variableName: varName,
            simplifiedSubterm: simplified,
            wrappedSubterm: `homotopy(${fullMatch}, ${simplified})`,
            wrappedEquation:
              text.slice(0, match.index) +
              `homotopy(${fullMatch}, ${simplified})` +
              text.slice(match.index + fullMatch.length),
          });
        }
      }

      return; // Do not recurse deeper into simple_equation children once handled
    }

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(cst);
  return results;
}
