import type { BoundaryActionPayload, MaterializeOptions, ParameterLookup } from "./types.js";

/**
 * Evaluates an arithmetic expression string with parameter lookup.
 */
export function evaluateCfdExpression(
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
    const sanitized = trimmed.replace(/([A-Za-z_][A-Za-z0-9_.]*)/g, (match) => {
      const resolved = resolveVal(match);
      if (typeof resolved === "number") return resolved.toString();
      if (typeof resolved === "string" && !isNaN(Number(resolved))) return resolved;
      if (typeof resolved === "string") return JSON.stringify(resolved);
      throw new Error(`Unresolved parameter: '${match}'`);
    });

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
    console.warn(`[cfd:materializer] Failed to evaluate expression '${trimmed}':`, err.message || err);
  }

  return trimmed;
}

/**
 * Materializes a CFD configuration template by replacing all {{ expression }} blocks
 * with their evaluated numeric or string values.
 */
export function materializeCfdConfig(templateText: string, options: MaterializeOptions = {}): string {
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
    const evaluated = evaluateCfdExpression(expr, evaluator);
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

  if (normDialect === "su2" || normDialect === ".cfg") {
    // Look for existing MARKER_* directive with this marker name
    const markerRegex = new RegExp(`^MARKER_[A-Z0-9_]+\\s*=\\s*\\(\\s*${name}\\s*,.*$`, "m");
    if (markerRegex.test(configText)) {
      return configText.replace(markerRegex, directive);
    }
    // Append to configuration
    const trimmed = configText.trimEnd();
    return `${trimmed}\n${directive}\n`;
  } else if (normDialect === "openfoam") {
    const blockRegex = new RegExp(`^\\s*${name}\\s*\\{[^}]*\\}`, "m");
    if (blockRegex.test(configText)) {
      return configText.replace(blockRegex, directive);
    }
    const trimmed = configText.trimEnd();
    return `${trimmed}\n${directive}\n`;
  }

  return `${configText}\n${directive}\n`;
}
