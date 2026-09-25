import type { BoundaryActionPayload, MaterializeOptions, ParameterLookup } from "./types.js";

/**
 * Evaluates an arithmetic expression string with parameter lookup.
 */
export function evaluateFeaExpression(
  exprStr: string,
  lookup?: ParameterLookup | Record<string, number | string>,
): number | string {
  const trimmed = exprStr.trim();
  if (!trimmed) return "";

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  const resolveVal = (token: string): number | string | undefined => {
    if (!isNaN(Number(token))) return Number(token);
    if (typeof lookup === "function") {
      const val = lookup(token);
      if (val !== undefined) return val;
    } else if (lookup && typeof lookup === "object") {
      if (token in lookup) return lookup[token];
    }
    return undefined;
  };

  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(trimmed)) {
    const val = resolveVal(trimmed);
    if (val !== undefined) return val;
  }

  try {
    const sanitized = trimmed.replace(
      /(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_][A-Za-z0-9_.]*)/g,
      (match, numMatch, identMatch) => {
        if (numMatch) return numMatch;
        const resolved = resolveVal(identMatch);
        if (typeof resolved === "number") return resolved.toString();
        if (typeof resolved === "string" && !isNaN(Number(resolved))) return resolved;
        if (typeof resolved === "string") return JSON.stringify(resolved);
        throw new Error(`Unresolved parameter: '${identMatch}'`);
      },
    );

    const jsExpr = sanitized.replace(/\^/g, "**");
    if (!/^[0-9+\-*/().eE\s*]+$/.test(jsExpr)) {
      throw new Error(`Expression contains illegal characters: ${jsExpr}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const result = Function(`"use strict"; return (${jsExpr})`)();
    if (typeof result === "number" && !isNaN(result)) {
      return result;
    }
  } catch (err: any) {
    console.warn(`[fea:materializer] Failed to evaluate expression '${trimmed}':`, err.message || err);
  }

  return trimmed;
}

/**
 * Materializes an FEA deck template by replacing all {{ expression }} blocks
 * with their evaluated numeric or string values.
 */
export function materializeFeaDeck(templateText: string, options: MaterializeOptions = {}): string {
  const { evaluator, formatNumber } = options;

  const defaultFormat = (val: number): string => {
    if (Number.isInteger(val)) return val.toString();
    if (Math.abs(val) >= 1e9 || (Math.abs(val) < 1e-4 && Math.abs(val) > 0)) {
      return val.toExponential(6);
    }
    return parseFloat(val.toFixed(6)).toString();
  };

  const formatter = formatNumber || defaultFormat;

  return templateText.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr) => {
    const evaluated = evaluateFeaExpression(expr, evaluator);
    if (typeof evaluated === "number") {
      return formatter(evaluated);
    }
    return String(evaluated);
  });
}

/**
 * Synthesizes a syntactic boundary or load directive for FEA decks (CalculiX/Abaqus).
 */
export function synthesizeFeaBoundary(
  action: BoundaryActionPayload,
  dialect: "calculix" | "abaqus" | string = "calculix",
): string {
  const targetId = action.targetId;
  const normDialect = dialect.toLowerCase();

  if (normDialect === "calculix" || normDialect === "abaqus" || normDialect === ".inp" || normDialect === "inp") {
    switch (action.kind) {
      case "fix": {
        const dofStart = action.dofs && action.dofs.length > 0 ? action.dofs[0] : 1;
        const dofEnd =
          action.dofs && action.dofs.length > 1
            ? action.dofs[action.dofs.length - 1]
            : action.dofs && action.dofs.length === 1
              ? dofStart
              : 3;
        return `*BOUNDARY\n${targetId}, ${dofStart}, ${dofEnd}, 0.0`;
      }
      case "displacement": {
        const dofStart = action.dofs && action.dofs.length > 0 ? action.dofs[0] : 1;
        const dofEnd = action.dofs && action.dofs.length > 1 ? action.dofs[action.dofs.length - 1] : dofStart;
        const mag = action.magnitude ?? 0.0;
        return `*BOUNDARY\n${targetId}, ${dofStart}, ${dofEnd}, ${mag}`;
      }
      case "force": {
        if (action.vector) {
          const lines: string[] = ["*CLOAD"];
          if (action.vector[0] !== 0) lines.push(`${targetId}, 1, ${action.vector[0]}`);
          if (action.vector[1] !== 0) lines.push(`${targetId}, 2, ${action.vector[1]}`);
          if (action.vector[2] !== 0) lines.push(`${targetId}, 3, ${action.vector[2]}`);
          if (lines.length === 1) lines.push(`${targetId}, 3, ${action.magnitude ?? -1000.0}`);
          return lines.join("\n");
        }
        const dof = action.dofs && action.dofs.length > 0 ? action.dofs[0] : 3;
        const mag = action.magnitude ?? -1000.0;
        return `*CLOAD\n${targetId}, ${dof}, ${mag}`;
      }
      case "pressure": {
        const mag = action.magnitude ?? 1e5;
        return `*DLOAD\n${targetId}, P, ${mag}`;
      }
      default:
        return `** Boundary ${targetId}: ${action.kind}`;
    }
  }

  return `** Boundary ${targetId}: ${action.kind}`;
}

/**
 * Injects or updates a boundary constraint or load in an FEA deck template (*STEP ... *END STEP).
 */
export function applyBoundaryActionToDeck(
  deckText: string,
  action: BoundaryActionPayload,
  dialect: string = "calculix",
): string {
  const snippet = synthesizeFeaBoundary(action, dialect);
  if (!snippet) return deckText;

  const endStepIdx = deckText.lastIndexOf("*END STEP");
  if (endStepIdx !== -1) {
    return `${deckText.slice(0, endStepIdx).trimEnd()}\n${snippet}\n${deckText.slice(endStepIdx)}`;
  }

  // If no step block exists, append snippet
  return `${deckText.trimEnd()}\n${snippet}\n`;
}
