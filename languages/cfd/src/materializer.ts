// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BoundaryActionPayload, CaeDiagnostic, MaterializeOptions, ParameterLookup } from "./types.js";

/**
 * Safe mathematical function and constant environment available inside CFD template `{{ ... }}` expressions.
 */
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

/**
 * Set of permitted built-in function and constant identifiers in `MATH_ENV`.
 */
const ALLOWED_IDENTIFIERS = new Set(Object.keys(MATH_ENV));

/**
 * Lexical token produced by `tokenizeArithmeticExpression`.
 */
type ExprToken =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: string }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" };

/**
 * Tokenizes a CFD template arithmetic or string expression into a sequence of `ExprToken` items.
 */
function tokenizeArithmeticExpression(input: string): ExprToken[] {
  const tokens: ExprToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let str = "";
      while (j < input.length && input[j] !== quote) {
        if (input[j] === "\\" && j + 1 < input.length) {
          str += input[j + 1];
          j += 2;
        } else {
          str += input[j];
          j++;
        }
      }
      if (j >= input.length) {
        throw new Error(`Unterminated string literal in expression: ${input}`);
      }
      tokens.push({ kind: "string", value: str });
      i = j + 1;
      continue;
    }
    const numMatch = input.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (numMatch) {
      tokens.push({ kind: "number", value: Number(numMatch[0]) });
      i += numMatch[0].length;
      continue;
    }
    const identMatch = input.slice(i).match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (identMatch) {
      tokens.push({ kind: "ident", value: identMatch[0] });
      i += identMatch[0].length;
      continue;
    }
    if (input.startsWith("**", i)) {
      tokens.push({ kind: "op", value: "^" });
      i += 2;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "%" || ch === "^") {
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      i++;
      continue;
    }
    throw new Error(`Expression contains illegal characters: ${input}`);
  }
  return tokens;
}

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
    // Recursive-descent parser for arithmetic expressions (+, -, *, /, %, ^, unary +/-, function calls)
    const tokens = tokenizeArithmeticExpression(trimmed);
    let pos = 0;

    const peek = (): ExprToken | undefined => tokens[pos];
    const consume = (): ExprToken => {
      const tok = tokens[pos];
      if (!tok) throw new Error(`Unexpected end of expression: '${trimmed}'`);
      pos++;
      return tok;
    };

    const toNum = (v: number | string): number => {
      if (typeof v === "number") return v;
      const n = Number(v);
      if (isNaN(n)) throw new Error(`Expected numeric operand, got '${v}'`);
      return n;
    };

    const parseAddSub = (): number | string => {
      let left = parseMulDiv();
      while (true) {
        const next = peek();
        if (next?.kind === "op" && (next.value === "+" || next.value === "-")) {
          consume();
          const right = parseMulDiv();
          if (next.value === "+") {
            if (typeof left === "string" || typeof right === "string") {
              left = `${left}${right}`;
            } else {
              left = left + right;
            }
          } else {
            left = toNum(left) - toNum(right);
          }
        } else {
          break;
        }
      }
      return left;
    };

    const parseMulDiv = (): number | string => {
      let left = parseUnary();
      while (true) {
        const next = peek();
        if (next?.kind === "op" && (next.value === "*" || next.value === "/" || next.value === "%")) {
          consume();
          const right = parseUnary();
          const lNum = toNum(left);
          const rNum = toNum(right);
          if (next.value === "*") left = lNum * rNum;
          else if (next.value === "/") left = lNum / rNum;
          else left = lNum % rNum;
        } else {
          break;
        }
      }
      return left;
    };

    const parseUnary = (): number | string => {
      const next = peek();
      if (next?.kind === "op" && (next.value === "+" || next.value === "-")) {
        consume();
        const operand = toNum(parseUnary());
        return next.value === "-" ? -operand : operand;
      }
      return parsePower();
    };

    const parsePower = (): number | string => {
      const base = parsePrimary();
      const next = peek();
      if (next?.kind === "op" && next.value === "^") {
        consume();
        const exponent = parseUnary();
        return Math.pow(toNum(base), toNum(exponent));
      }
      return base;
    };

    const parsePrimary = (): number | string => {
      const tok = consume();
      if (tok.kind === "number") return tok.value;
      if (tok.kind === "string") return tok.value;
      if (tok.kind === "lparen") {
        const inner = parseAddSub();
        const close = consume();
        if (close.kind !== "rparen") {
          throw new Error(`Expected closing parenthesis in '${trimmed}'`);
        }
        return inner;
      }
      if (tok.kind === "ident") {
        const ident = tok.value;
        if (peek()?.kind === "lparen") {
          if (!ALLOWED_IDENTIFIERS.has(ident) || typeof MATH_ENV[ident] !== "function") {
            throw new Error(`Expression contains illegal identifier: '${ident}'`);
          }
          consume(); // '('
          const args: number[] = [];
          if (peek()?.kind !== "rparen") {
            args.push(toNum(parseAddSub()));
            while (peek()?.kind === "comma") {
              consume();
              args.push(toNum(parseAddSub()));
            }
          }
          const close = consume();
          if (close.kind !== "rparen") {
            throw new Error(`Expected closing parenthesis for call to '${ident}'`);
          }
          return Number(MATH_ENV[ident](...args));
        }

        if (ident in MATH_ENV && typeof MATH_ENV[ident] === "number") {
          return MATH_ENV[ident] as number;
        }
        const resolved = resolveVal(ident);
        if (resolved === undefined) {
          throw new Error(`Unresolved parameter: '${ident}'`);
        }
        if (typeof resolved === "number") return resolved;
        if (typeof resolved === "string" && resolved.trim() !== "" && !isNaN(Number(resolved))) {
          return Number(resolved);
        }
        return resolved;
      }
      throw new Error(`Unexpected token in expression: '${trimmed}'`);
    };

    const result = parseAddSub();
    if (pos < tokens.length) {
      const trailing = tokens[pos]!;
      if (trailing.kind === "ident") {
        throw new Error(`Expression contains illegal identifier: '${trailing.value}'`);
      }
      throw new Error(`Unexpected trailing tokens in expression: '${trimmed}'`);
    }
    if (typeof result === "number" && !isNaN(result)) {
      return result;
    }
    if (typeof result === "string") {
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

  return templateText.replace(/\{\{([^{}]+)\}\}/g, (_match, expr, offset: number) => {
    const prevDiagLen = diagnostics ? diagnostics.length : 0;
    const evaluated = evaluateCfdExpression(expr.trim(), evaluator, diagnostics);
    if (diagnostics && diagnostics.length > prevDiagLen) {
      let targetOffset = offset + 2 + expr.indexOf(expr.trim());
      const diag = diagnostics[diagnostics.length - 1]!;
      const paramMatch = diag.message.match(/Unresolved parameter: '([^']+)'|illegal identifier: '([^']+)'/);
      const offendingToken = paramMatch?.[1] ?? paramMatch?.[2];
      if (offendingToken) {
        const tokenIdx = expr.indexOf(offendingToken);
        if (tokenIdx >= 0) {
          targetOffset = offset + 2 + tokenIdx;
        }
      }
      const prefix = templateText.slice(0, targetOffset);
      const lastNewline = prefix.lastIndexOf("\n");
      diag.line = (prefix.match(/\n/g)?.length ?? 0) + 1;
      diag.column = lastNewline === -1 ? targetOffset + 1 : targetOffset - lastNewline;
    }
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

/**
 * Aerodynamic and thermodynamic flow state extracted from a CFD configuration deck for 1D-3D co-simulation.
 */
export interface CfdSlicingProperties {
  cd: number;
  cl?: number | undefined;
  refArea: number;
  refLength?: number | undefined;
  density: number;
  freeStreamVelocity: number;
  machNumber?: number | undefined;
  reynoldsNumber?: number | undefined;
  aoaDeg?: number | undefined;
  dragForce?: number | undefined;
  liftForce?: number | undefined;
}

/**
 * Evaluates an SU2/OpenFOAM CFD configuration to derive physical freestream state,
 * Reynolds/Mach numbers, boundary-layer skin friction, compressible Prandtl-Glauert
 * lift coefficient, and drag polar parameters.
 */
export function extractCfdSlicingProperties(cfgText: string): CfdSlicingProperties {
  const numOpt = (pattern: RegExp): number | undefined => {
    const m = cfgText.match(pattern);
    if (!m || m[1] === undefined) return undefined;
    const val = parseFloat(m[1]);
    return Number.isFinite(val) ? val : undefined;
  };

  const cdExplicit =
    numOpt(/\bCd_total\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i) ?? numOpt(/\bCD\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);
  const clExplicit =
    numOpt(/\bCl_total\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i) ?? numOpt(/\bCL\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);

  const refAreaOpt = numOpt(/\bREF_AREA\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);
  const refLengthOpt =
    numOpt(/\bREF_LENGTH\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i) ??
    numOpt(/\bREYNOLDS_LENGTH\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);

  const refArea =
    refAreaOpt !== undefined && refAreaOpt > 0
      ? refAreaOpt
      : refLengthOpt !== undefined && refLengthOpt > 0
        ? parseFloat((refLengthOpt * refLengthOpt * 0.25).toFixed(6))
        : 0.03;
  const refLength =
    refLengthOpt !== undefined && refLengthOpt > 0
      ? refLengthOpt
      : parseFloat(Math.sqrt(Math.max(refArea, 1e-6)).toFixed(4));

  // Thermodynamic state (Ideal Gas / Incompressible)
  const R_AIR = 287.058;
  const GAMMA = 1.4;
  const tempK =
    numOpt(/\b(?:FREESTREAM_TEMPERATURE|INC_TEMPERATURE_INIT)\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i) ?? 288.15;
  const pressurePa = numOpt(/\bFREESTREAM_PRESSURE\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i) ?? 101325.0;

  const rhoExplicit = numOpt(/\b(?:INC_DENSITY_INIT|FREESTREAM_DENSITY)\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);
  const hasThermoDirective = /\b(?:FREESTREAM_PRESSURE|FREESTREAM_TEMPERATURE)\s*=/i.test(cfgText);
  const density =
    rhoExplicit !== undefined && rhoExplicit > 0
      ? rhoExplicit
      : hasThermoDirective
        ? parseFloat((pressurePa / (R_AIR * Math.max(tempK, 1.0))).toFixed(5))
        : 1.225;

  // Dynamic viscosity via MU_CONSTANT / FREESTREAM_VISCOSITY or Sutherland's Law
  const muExplicit = numOpt(/\b(?:MU_CONSTANT|FREESTREAM_VISCOSITY)\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);
  const sutherlandMu = 1.716e-5 * Math.pow(tempK / 273.15, 1.5) * ((273.15 + 110.4) / (tempK + 110.4));
  const mu = muExplicit !== undefined && muExplicit > 0 ? muExplicit : sutherlandMu;

  // Speed of sound
  const soundSpeed = Math.sqrt(GAMMA * R_AIR * Math.max(tempK, 1.0));

  const machOpt = numOpt(/\bMACH_NUMBER\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);
  const reynoldsOpt = numOpt(/\bREYNOLDS_NUMBER\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);
  const aoaOpt = numOpt(/\bAOA\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);

  const velTupleMatch = cfgText.match(
    /\b(?:INC_VELOCITY_INIT|FREESTREAM_VELOCITY)\s*=\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/i,
  );
  const openFoamVelMatch = cfgText.match(/\buniform\s*\(\s*([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s*\)/i);
  const inletMatch = cfgText.match(/\bMARKER_INLET\s*=\s*\(\s*[^,)]+\s*,\s*([-+\d.eE]+)(?:\s*,\s*([-+\d.eE]+))?/i);

  let vx = 0.0,
    vy = 0.0,
    vz = 0.0;
  let freeStreamVelocity: number;
  if (velTupleMatch) {
    vx = parseFloat(velTupleMatch[1]!);
    vy = parseFloat(velTupleMatch[2]!);
    vz = parseFloat(velTupleMatch[3]!);
    freeStreamVelocity = parseFloat(Math.hypot(vx, vy, vz).toFixed(4));
  } else if (openFoamVelMatch) {
    vx = parseFloat(openFoamVelMatch[1]!);
    vy = parseFloat(openFoamVelMatch[2]!);
    vz = parseFloat(openFoamVelMatch[3]!);
    freeStreamVelocity = parseFloat(Math.hypot(vx, vy, vz).toFixed(4));
  } else if (machOpt !== undefined && machOpt > 0) {
    freeStreamVelocity = parseFloat((machOpt * soundSpeed).toFixed(4));
  } else if (reynoldsOpt !== undefined && reynoldsOpt > 0) {
    freeStreamVelocity = parseFloat(((reynoldsOpt * mu) / (density * Math.max(refLength, 1e-6))).toFixed(4));
  } else if (inletMatch) {
    const v1 = parseFloat(inletMatch[1]!);
    const v2 = inletMatch[2] !== undefined ? parseFloat(inletMatch[2]!) : undefined;
    // In SU2 incompressible MARKER_INLET = (name, T, V, nx, ny, nz) or (name, V, nx, ny, nz)
    freeStreamVelocity = parseFloat((v2 !== undefined && v1 > 150 ? Math.abs(v2) : Math.abs(v1)).toFixed(4));
  } else {
    freeStreamVelocity = 10.0;
  }

  const machNumber =
    machOpt !== undefined && machOpt >= 0 ? machOpt : parseFloat((freeStreamVelocity / soundSpeed).toFixed(5));

  const reynoldsNumber =
    reynoldsOpt !== undefined && reynoldsOpt > 0
      ? reynoldsOpt
      : Math.max((density * Math.max(freeStreamVelocity, 0.01) * refLength) / Math.max(mu, 1e-9), 100.0);

  const aoaDeg =
    aoaOpt !== undefined ? aoaOpt : velTupleMatch && Math.abs(vx) > 1e-6 ? (Math.atan2(vz, vx) * 180.0) / Math.PI : 0.0;
  const aoaRad = (aoaDeg * Math.PI) / 180.0;

  // Aspect ratio & Prandtl-Glauert compressible 3D finite-wing lift
  const aspectRatio = Math.min(Math.max((refLength * refLength) / Math.max(refArea, 1e-6), 1.0), 20.0);
  const pgBeta = Math.sqrt(Math.max(Math.abs(1.0 - machNumber * machNumber), 0.09));
  const computedCl = (2.0 * Math.PI * Math.sin(aoaRad)) / (pgBeta + 2.0 / aspectRatio);
  const cl = clExplicit !== undefined ? clExplicit : parseFloat(computedCl.toFixed(5));

  // Boundary-layer skin friction coefficient Cf (Blasius laminar / Prandtl-Schlichting turbulent)
  const cf =
    reynoldsNumber < 5.0e5 ? 1.328 / Math.sqrt(reynoldsNumber) : 0.455 / Math.pow(Math.log10(reynoldsNumber), 2.58);

  const solverMatch = cfgText.match(/\bSOLVER\s*=\s*([A-Z0-9_]+)/i);
  const solverType = solverMatch ? solverMatch[1]!.toUpperCase() : "INC_RANS";
  const isIncompressibleBluff = solverType.startsWith("INC_") && Math.abs(vz) > Math.abs(vx) && machOpt === undefined;

  // Parasitic form factor + pressure drag + induced drag + transonic wave drag
  const formFactor = isIncompressibleBluff ? 0.78 / Math.max(cf, 1e-4) : 2.2;
  const cd0 = cf * formFactor + (isIncompressibleBluff ? 0.0 : 0.012);
  const oswaldEfficiency = 0.82;
  const cdi = (cl * cl) / (Math.PI * aspectRatio * oswaldEfficiency);
  const cdWave = machNumber > 0.72 ? 20.0 * Math.pow(machNumber - 0.72, 4) : 0.0;
  const computedCd = Math.max(cd0 + cdi + cdWave, 0.005);

  const cd = cdExplicit !== undefined ? cdExplicit : parseFloat(computedCd.toFixed(4));
  const qInf = 0.5 * density * freeStreamVelocity * freeStreamVelocity;
  const dragForce = parseFloat((qInf * refArea * cd).toFixed(4));
  const liftForce = parseFloat((qInf * refArea * cl).toFixed(4));

  return {
    cd,
    cl,
    refArea,
    refLength,
    density,
    freeStreamVelocity,
    machNumber: parseFloat(machNumber.toFixed(5)),
    reynoldsNumber: parseFloat(reynoldsNumber.toFixed(1)),
    aoaDeg: parseFloat(aoaDeg.toFixed(3)),
    dragForce,
    liftForce,
  };
}
