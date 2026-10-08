// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BoundaryActionPayload, CaeDiagnostic, MaterializeOptions, ParameterLookup } from "./types.js";

const MATH_ENV: Record<string, any> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sind: (deg: number) => Math.sin((deg * Math.PI) / 180),
  cosd: (deg: number) => Math.cos((deg * Math.PI) / 180),
  tand: (deg: number) => Math.tan((deg * Math.PI) / 180),
  rad: (deg: number) => (deg * Math.PI) / 180,
  deg: (rad: number) => (rad * 180) / Math.PI,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  E: Math.E,
};

const MATH_KEYS = Object.keys(MATH_ENV);
const MATH_VALS = Object.values(MATH_ENV);
const ALLOWED_IDENTIFIERS = new Set(MATH_KEYS);

/**
 * Evaluates an arithmetic expression string with parameter lookup and safe math functions.
 */
export function evaluateFeaExpression(
  exprStr: string,
  lookup?: ParameterLookup | Record<string, number | string>,
  diagnostics?: CaeDiagnostic[],
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
    if (trimmed in MATH_ENV) {
      const val = MATH_ENV[trimmed];
      if (typeof val === "number") return val;
    }
    const val = resolveVal(trimmed);
    if (val !== undefined) return val;
  }

  try {
    const numOrIdentRegex = /(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\.\d+(?:[eE][+-]?\d+)?\b)|([A-Za-z_][A-Za-z0-9_.]*)/g;

    const sanitized = trimmed.replace(numOrIdentRegex, (_match, numMatch, identMatch) => {
      if (numMatch) return numMatch;
      if (identMatch in MATH_ENV) return identMatch;
      const resolved = resolveVal(identMatch);
      if (typeof resolved === "number") return resolved.toString();
      if (typeof resolved === "string" && !isNaN(Number(resolved))) return resolved;
      if (typeof resolved === "string") return JSON.stringify(resolved);
      throw new Error(`Unresolved parameter: '${identMatch}'`);
    });

    // Replace ^ with ** and wrap unary minus before ** to avoid JS syntax error
    let jsExpr = sanitized.replace(/\^/g, "**");
    jsExpr = jsExpr.replace(/(^|[+\-*/(,\s])\s*-\s*([0-9.]+|\([^)]+\))\s*\*\*/g, "$1(-$2)**");

    // Validate that all remaining identifiers are in MATH_ENV
    const identsOnly = jsExpr.replace(/(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\.\d+(?:[eE][+-]?\d+)?\b)/g, "");
    const remainingIdents = identsOnly.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
    for (const ident of remainingIdents) {
      if (!ALLOWED_IDENTIFIERS.has(ident)) {
        throw new Error(`Expression contains illegal identifier: '${ident}'`);
      }
    }

    if (!/^[A-Za-z0-9+\-*/().,\s*]+$/.test(jsExpr)) {
      throw new Error(`Expression contains illegal characters: ${jsExpr}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...MATH_KEYS, `"use strict"; return (${jsExpr});`);
    const result = fn(...MATH_VALS);
    if (typeof result === "number" && !isNaN(result)) {
      return result;
    }
  } catch (err: any) {
    if (diagnostics) {
      diagnostics.push({
        severity: "error",
        message: err.message || String(err),
        expression: trimmed,
      });
    } else {
      console.warn(`[fea:materializer] Failed to evaluate expression '${trimmed}':`, err.message || err);
    }
  }

  return trimmed;
}

/**
 * Materializes an FEA deck template by replacing all {{ expression }} blocks
 * with their evaluated numeric or string values.
 */
export function materializeFeaDeck(templateText: string, options: MaterializeOptions = {}): string {
  const { evaluator, formatNumber, diagnostics } = options;

  const defaultFormat = (val: number): string => {
    if (Number.isInteger(val)) return val.toString();
    if (Math.abs(val) >= 1e9 || (Math.abs(val) < 1e-4 && Math.abs(val) > 0)) {
      return val.toExponential(6);
    }
    return parseFloat(val.toFixed(6)).toString();
  };

  const formatter = formatNumber || defaultFormat;

  return templateText.replace(/\{\{([^{}]+)\}\}/g, (_match, expr) => {
    const evaluated = evaluateFeaExpression(expr.trim(), evaluator, diagnostics);
    if (typeof evaluated === "number") {
      return formatter(evaluated);
    }
    return String(evaluated);
  });
}

/**
 * Synthesizes a syntactic boundary or load directive for FEA decks (CalculiX / .inp / NASTRAN BDF).
 */
export function synthesizeFeaBoundary(
  action: BoundaryActionPayload,
  dialect: "calculix" | "abaqus" | "bdf" | string = "calculix",
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
      case "moment": {
        const dof = action.dofs && action.dofs.length > 0 ? action.dofs[0] : 4;
        const mag = action.magnitude ?? 100.0;
        return `*CLOAD\n${targetId}, ${dof}, ${mag}`;
      }
      case "pressure": {
        const mag = action.magnitude ?? 1e5;
        return `*DLOAD\n${targetId}, P, ${mag}`;
      }
      default:
        return `** Boundary ${targetId}: ${action.kind}`;
    }
  } else if (normDialect === "bdf" || normDialect === "dat" || normDialect === "nastran" || normDialect === ".bdf") {
    switch (action.kind) {
      case "fix": {
        const dofs = action.dofs && action.dofs.length > 0 ? action.dofs.join("") : "123456";
        return `SPC1, 1, ${dofs}, ${targetId}`;
      }
      case "force": {
        const vec = action.vector ?? [0, 0, action.magnitude ?? -1000.0];
        const mag = Math.hypot(...vec) || 1.0;
        return `FORCE, 1, ${targetId}, 0, ${mag.toFixed(2)}, ${(vec[0] / mag).toFixed(4)}, ${(vec[1] / mag).toFixed(4)}, ${(vec[2] / mag).toFixed(4)}`;
      }
      case "moment": {
        const mag = action.magnitude ?? 100.0;
        return `MOMENT, 1, ${targetId}, 0, ${mag.toFixed(2)}, 0.0, 0.0, 1.0`;
      }
      default:
        return `$ Boundary ${targetId}: ${action.kind}`;
    }
  }

  return `** Boundary ${targetId}: ${action.kind}`;
}

/**
 * Injects or updates a boundary constraint or load in an FEA deck template.
 */
export function applyBoundaryActionToDeck(
  deckText: string,
  action: BoundaryActionPayload,
  dialect: string = "calculix",
): string {
  const snippet = synthesizeFeaBoundary(action, dialect);
  if (!snippet) return deckText;

  const normDialect = dialect.toLowerCase();
  if (normDialect === "bdf" || normDialect === "dat" || normDialect === "nastran" || normDialect === ".bdf") {
    const endDataMatch = deckText.match(/\bENDDATA\b/i);
    if (endDataMatch && endDataMatch.index !== undefined) {
      return `${deckText.slice(0, endDataMatch.index).trimEnd()}\n${snippet}\n${deckText.slice(endDataMatch.index)}`;
    }
    return `${deckText.trimEnd()}\n${snippet}\n`;
  }

  // Case-insensitive search for *END STEP
  const endStepMatch = deckText.match(/\*END\s+STEP/i);
  if (endStepMatch && endStepMatch.index !== undefined) {
    // Find the last occurrence of *END STEP
    const matches = [...deckText.matchAll(/\*END\s+STEP/gi)];
    const lastMatch = matches[matches.length - 1];
    if (lastMatch && lastMatch.index !== undefined) {
      return `${deckText.slice(0, lastMatch.index).trimEnd()}\n${snippet}\n${deckText.slice(lastMatch.index)}`;
    }
  }

  // If no step block exists, append snippet
  return `${deckText.trimEnd()}\n${snippet}\n`;
}
