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
export function evaluateCfdExpression(
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
      console.warn(`[cfd:materializer] Failed to evaluate expression '${trimmed}':`, err.message || err);
    }
  }

  return trimmed;
}

/**
 * Materializes a CFD configuration template by replacing all {{ expression }} blocks
 * with their evaluated numeric or string values.
 */
export function materializeCfdConfig(templateText: string, options: MaterializeOptions = {}): string {
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
    const evaluated = evaluateCfdExpression(expr.trim(), evaluator, diagnostics);
    if (typeof evaluated === "number") {
      return formatter(evaluated);
    }
    return String(evaluated);
  });
}

/**
 * Synthesizes a syntactic boundary marker directive for CFD configuration decks
 * from interactive 3D CAD surface selections.
 */
export function synthesizeCfdBoundary(
  action: BoundaryActionPayload,
  dialect: "su2" | "openfoam" | string = "su2",
): string {
  const name = String(action.targetId);
  const normDialect = dialect.toLowerCase();

  if (normDialect === "su2" || normDialect === ".cfg") {
    switch (action.kind) {
      case "inlet": {
        const vx = action.vector ? action.vector[0] : (action.magnitude ?? 10.0);
        const vy = action.vector ? action.vector[1] : 0.0;
        const vz = action.vector ? action.vector[2] : 0.0;
        const totalVel = Math.hypot(vx, vy, vz) || 1.0;
        const nx = vx / totalVel;
        const ny = vy / totalVel;
        const nz = vz / totalVel;
        return `MARKER_INLET= ( ${name}, ${totalVel.toFixed(2)}, ${nx.toFixed(4)}, ${ny.toFixed(4)}, ${nz.toFixed(4)} )`;
      }
      case "outlet": {
        const pBack = action.magnitude ?? 0.0;
        return `MARKER_OUTLET= ( ${name}, ${pBack.toFixed(2)} )`;
      }
      case "heatflux": {
        const q = action.magnitude ?? 0.0;
        return `MARKER_HEATFLUX= ( ${name}, ${q.toFixed(2)} )`;
      }
      case "isothermal": {
        const T = action.temperature ?? action.magnitude ?? 300.0;
        return `MARKER_ISOTHERMAL= ( ${name}, ${T.toFixed(2)} )`;
      }
      case "wall":
      default:
        return `MARKER_HEATFLUX= ( ${name}, 0.00 )`;
    }
  } else if (normDialect === "openfoam") {
    switch (action.kind) {
      case "inlet": {
        const vx = action.vector ? action.vector[0] : (action.magnitude ?? 10.0);
        const vy = action.vector ? action.vector[1] : 0.0;
        const vz = action.vector ? action.vector[2] : 0.0;
        return `${name}\n{\n    type            fixedValue;\n    value           uniform (${vx} ${vy} ${vz});\n}`;
      }
      case "outlet": {
        const p = action.magnitude ?? 0.0;
        return `${name}\n{\n    type            fixedValue;\n    value           uniform ${p};\n}`;
      }
      case "wall":
      default:
        return `${name}\n{\n    type            noSlip;\n}`;
    }
  }

  return `% Boundary ${name}: ${action.kind}`;
}

/**
 * Injects or updates a boundary action directive in a CFD configuration template.
 */
export function applyBoundaryActionToConfig(
  configText: string,
  action: BoundaryActionPayload,
  dialect: string = "su2",
): string {
  const directive = synthesizeCfdBoundary(action, dialect);
  const name = String(action.targetId);
  const normDialect = dialect.toLowerCase();
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  if (normDialect === "su2" || normDialect === ".cfg") {
    // Look for existing MARKER_* directive with this marker name
    const markerRegex = new RegExp(`^\\s*MARKER_[A-Z0-9_]+\\s*=\\s*\\(\\s*${escapedName}\\s*[,\\)].*$`, "m");
    if (markerRegex.test(configText)) {
      return configText.replace(markerRegex, directive);
    }
    // Append to configuration
    const trimmed = configText.trimEnd();
    return `${trimmed}\n${directive}\n`;
  } else if (normDialect === "openfoam") {
    const blockRegex = new RegExp(`^\\s*${escapedName}\\s*\\{[^}]*\\}`, "m");
    if (blockRegex.test(configText)) {
      return configText.replace(blockRegex, directive);
    }
    // If boundaryField exists, insert before closing brace of boundaryField
    const bfIdx = configText.indexOf("boundaryField");
    if (bfIdx !== -1) {
      const openBrace = configText.indexOf("{", bfIdx);
      if (openBrace !== -1) {
        let depth = 1;
        let closeBrace = -1;
        for (let i = openBrace + 1; i < configText.length; i++) {
          if (configText[i] === "{") depth++;
          else if (configText[i] === "}") {
            depth--;
            if (depth === 0) {
              closeBrace = i;
              break;
            }
          }
        }
        if (closeBrace !== -1) {
          const indented = directive
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n");
          return `${configText.slice(0, closeBrace).trimEnd()}\n${indented}\n${configText.slice(closeBrace)}`;
        }
      }
    }
    const trimmed = configText.trimEnd();
    return `${trimmed}\n${directive}\n`;
  }

  return `${configText}\n${directive}\n`;
}
