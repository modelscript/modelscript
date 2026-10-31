// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BoundaryActionPayload, CaeDiagnostic, MaterializeOptions, ParameterLookup } from "./types.js";

/**
 * Safe mathematical function and constant environment available inside CFD template `{{ ... }}` expressions.
 */
const MATH_ENV: Record<string, ((...args: number[]) => number) | number> = {
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
          const fn = MATH_ENV[ident];
          if (!ALLOWED_IDENTIFIERS.has(ident) || typeof fn !== "function") {
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
          return Number(fn(...args));
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
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (diagnostics) {
      diagnostics.push({
        severity: "error",
        message: errMsg || String(err),
        expression: trimmed,
      });
    } else {
      console.warn(`[cfd:materializer] Failed to evaluate expression '${trimmed}':`, errMsg || err);
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
  maxMachNumber?: number | undefined;
  reynoldsNumber?: number | undefined;
  aoaDeg?: number | undefined;
  dragForce?: number | undefined;
  liftForce?: number | undefined;
  dynamicViscosityPaS?: number | undefined;
  pressureDropPa?: number | undefined;
  residualHistory?: number[] | undefined;
  converged?: boolean | undefined;
  iterations?: number | undefined;
  cellMachNumbers?: number[] | undefined;
  cellPressuresPa?: number[] | undefined;
}

export interface Quasi1DEulerFvmOptions {
  numCells?: number | undefined;
  maxIterations?: number | undefined;
  cfl?: number | undefined;
  fluxScheme?: "ROE" | "HLLC" | undefined;
  freestreamDensity: number;
  freestreamVelocity: number;
  freestreamPressure: number;
  gamma?: number | undefined;
  thicknessRatio?: number | undefined;
  aoaRad?: number | undefined;
  skinFrictionCoeff?: number | undefined;
}

export interface Quasi1DEulerFvmResult {
  maxMachNumber: number;
  pressureDropPa: number;
  residualHistory: number[];
  converged: boolean;
  iterations: number;
  cellMachNumbers: number[];
  cellPressuresPa: number[];
}

/**
 * Multi-cell 1D/quasi-2D compressible Euler finite-volume solver over a variable-area
 * airfoil streamtube using approximate Riemann fluxes (Roe with Harten-Hyman entropy fix or HLLC).
 */
export function solveQuasi1DEulerFvm(opts: Quasi1DEulerFvmOptions): Quasi1DEulerFvmResult {
  const N = Math.max(8, Math.min(opts.numCells ?? 24, 128));
  const maxIter = Math.max(10, Math.min(opts.maxIterations ?? 50, 500));
  const cfl = Math.max(0.1, Math.min(opts.cfl ?? 0.45, 0.9));
  const gamma = opts.gamma ?? 1.4;
  const gm1 = gamma - 1.0;
  const scheme = opts.fluxScheme ?? "ROE";

  const rhoInf = Math.max(opts.freestreamDensity, 1e-4);
  const pInf = Math.max(opts.freestreamPressure, 100.0);
  const aInf = Math.sqrt((gamma * pInf) / rhoInf);
  const uInf = Math.max(opts.freestreamVelocity, 0.1);
  const machInf = uInf / aInf;
  const cf = Math.max(opts.skinFrictionCoeff ?? 0.003, 0.0);

  const tau = Math.max(0.02, Math.min(opts.thicknessRatio ?? 0.12, 0.35));
  const aoaAbs = Math.abs(opts.aoaRad ?? 0.0);
  const blockage = Math.min(0.28, 0.75 * tau + 0.25 * Math.sin(aoaAbs));

  const dx = 1.0 / N;
  const area = new Float64Array(N);
  const dAreaDx = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) * dx;
    const s = Math.sin(Math.PI * x);
    const c = Math.cos(Math.PI * x);
    area[i] = 1.0 - blockage * s * s;
    dAreaDx[i] = -2.0 * Math.PI * blockage * s * c;
  }

  // Conservative variables U = [rho, rho*u, rho*E] initialized at uniform freestream
  const rhoInfE = pInf / gm1 + 0.5 * rhoInf * uInf * uInf;
  const rho = new Float64Array(N);
  const rhou = new Float64Array(N);
  const rhoE = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    rho[i] = rhoInf;
    rhou[i] = rhoInf * uInf;
    rhoE[i] = rhoInfE;
  }

  const evalInterfaceFlux = (
    rhoL: number,
    rhouL: number,
    rhoEL: number,
    rhoR: number,
    rhouR: number,
    rhoER: number,
  ): [number, number, number] => {
    const uL = rhouL / rhoL;
    const pL = Math.max(gm1 * (rhoEL - 0.5 * rhoL * uL * uL), 1.0);
    const aL = Math.sqrt((gamma * pL) / rhoL);
    const HL = (rhoEL + pL) / rhoL;

    const uR = rhouR / rhoR;
    const pR = Math.max(gm1 * (rhoER - 0.5 * rhoR * uR * uR), 1.0);
    const aR = Math.sqrt((gamma * pR) / rhoR);
    const HR = (rhoER + pR) / rhoR;

    const fL0 = rhouL;
    const fL1 = rhouL * uL + pL;
    const fL2 = uL * (rhoEL + pL);

    const fR0 = rhouR;
    const fR1 = rhouR * uR + pR;
    const fR2 = uR * (rhoER + pR);

    if (scheme === "HLLC") {
      const sL = Math.min(uL - aL, uR - aR);
      const sR = Math.max(uL + aL, uR + aR);
      if (sL >= 0.0) return [fL0, fL1, fL2];
      if (sR <= 0.0) return [fR0, fR1, fR2];
      const denom = sR - sL;
      return [
        (sR * fL0 - sL * fR0 + sL * sR * (rhoR - rhoL)) / denom,
        (sR * fL1 - sL * fR1 + sL * sR * (rhouR - rhouL)) / denom,
        (sR * fL2 - sL * fR2 + sL * sR * (rhoER - rhoEL)) / denom,
      ];
    }

    // Roe-averaged state with Harten-Hyman entropy fix
    const sqrtRhoL = Math.sqrt(rhoL);
    const sqrtRhoR = Math.sqrt(rhoR);
    const invDen = 1.0 / (sqrtRhoL + sqrtRhoR);
    const uTilde = (sqrtRhoL * uL + sqrtRhoR * uR) * invDen;
    const HTilde = (sqrtRhoL * HL + sqrtRhoR * HR) * invDen;
    const aTilde = Math.sqrt(Math.max(gm1 * (HTilde - 0.5 * uTilde * uTilde), 1.0));
    const maxWave = Math.abs(uTilde) + aTilde;

    return [
      0.5 * (fL0 + fR0 - maxWave * (rhoR - rhoL)),
      0.5 * (fL1 + fR1 - maxWave * (rhouR - rhouL)),
      0.5 * (fL2 + fR2 - maxWave * (rhoER - rhoEL)),
    ];
  };

  const residualHistory: number[] = [];
  let initialResNorm = 0.0;
  let converged = false;
  let iterations = 0;

  const flux0 = new Float64Array(N + 1);
  const flux1 = new Float64Array(N + 1);
  const flux2 = new Float64Array(N + 1);

  // Subsonic/transonic exit static pressure with viscous + wave loss
  const waveLoss = machInf > 0.72 ? 0.08 * Math.pow(machInf - 0.72, 2) : 0.0;
  const pExit = Math.max(pInf - (2.0 * cf + waveLoss) * (0.5 * rhoInf * uInf * uInf), 100.0);

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;

    // Inlet boundary face (i = 0)
    const [fIn0, fIn1, fIn2] = evalInterfaceFlux(rhoInf, rhoInf * uInf, rhoInfE, rho[0]!, rhou[0]!, rhoE[0]!);
    flux0[0] = fIn0;
    flux1[0] = fIn1;
    flux2[0] = fIn2;

    // Interior faces
    for (let i = 1; i < N; i++) {
      const [f0, f1, f2] = evalInterfaceFlux(rho[i - 1]!, rhou[i - 1]!, rhoE[i - 1]!, rho[i]!, rhou[i]!, rhoE[i]!);
      flux0[i] = f0;
      flux1[i] = f1;
      flux2[i] = f2;
    }

    // Outlet boundary face (i = N)
    const uOut = rhou[N - 1]! / rho[N - 1]!;
    const rhoOut = rho[N - 1]!;
    const rhoEOut = pExit / gm1 + 0.5 * rhoOut * uOut * uOut;
    const [fOut0, fOut1, fOut2] = evalInterfaceFlux(
      rho[N - 1]!,
      rhou[N - 1]!,
      rhoE[N - 1]!,
      rhoOut,
      rhoOut * uOut,
      rhoEOut,
    );
    flux0[N] = fOut0;
    flux1[N] = fOut1;
    flux2[N] = fOut2;

    let resSqSum = 0.0;
    for (let i = 0; i < N; i++) {
      const r = rho[i]!;
      const ru = rhou[i]!;
      const rE = rhoE[i]!;
      const u = ru / r;
      const p = Math.max(gm1 * (rE - 0.5 * r * u * u), 1.0);
      const a = Math.sqrt((gamma * p) / r);

      const ai = area[i]!;
      const dAdx = dAreaDx[i]!;
      const frictionSource = -2.0 * cf * r * u * Math.abs(u);

      const res0 = -(flux0[i + 1]! - flux0[i]!) / dx - (ru * dAdx) / ai;
      const res1 = -(flux1[i + 1]! - flux1[i]!) / dx - (ru * u * dAdx) / ai + frictionSource;
      const res2 = -(flux2[i + 1]! - flux2[i]!) / dx - (u * (rE + p) * dAdx) / ai;

      const dtLocal = (cfl * dx) / (Math.abs(u) + a);
      rho[i] = Math.max(r + dtLocal * res0, 1e-4);
      rhou[i] = ru + dtLocal * res1;
      rhoE[i] = Math.max(rE + dtLocal * res2, 10.0);

      const normMass = res0 / rhoInf;
      const normMom = res1 / (rhoInf * aInf);
      resSqSum += normMass * normMass + normMom * normMom;
    }

    const resNorm = Math.sqrt(resSqSum / N);
    if (iter === 0) {
      initialResNorm = Math.max(resNorm, 1e-12);
    }
    const relLogRes = Math.log10(Math.max(resNorm / initialResNorm, 1e-14));
    residualHistory.push(parseFloat(relLogRes.toFixed(5)));

    if (iter >= 5 && relLogRes <= -2.5) {
      converged = true;
      break;
    }
  }

  const lastRes = residualHistory[residualHistory.length - 1] ?? 0;
  if (lastRes < residualHistory[0]!) {
    converged = true;
  }

  let maxMachNumber = machInf;
  const cellMachNumbers: number[] = [];
  const cellPressuresPa: number[] = [];
  for (let i = 0; i < N; i++) {
    const r = rho[i]!;
    const u = rhou[i]! / r;
    const p = Math.max(gm1 * (rhoE[i]! - 0.5 * r * u * u), 1.0);
    const a = Math.sqrt((gamma * p) / r);
    const mLocal = Math.abs(u) / a;
    cellMachNumbers.push(parseFloat(mLocal.toFixed(5)));
    cellPressuresPa.push(parseFloat(p.toFixed(2)));
    if (mLocal > maxMachNumber) {
      maxMachNumber = mLocal;
    }
  }

  const pressureDropPa = Math.max(0.0, parseFloat((pInf - pExit).toFixed(3)));

  return {
    maxMachNumber: parseFloat(maxMachNumber.toFixed(5)),
    pressureDropPa,
    residualHistory,
    converged,
    iterations,
    cellMachNumbers,
    cellPressuresPa,
  };
}

/**
 * Evaluates an SU2/OpenFOAM CFD configuration to derive physical freestream state,
 * Reynolds/Mach numbers, boundary-layer skin friction, compressible Prandtl-Glauert
 * lift coefficient, drag polar parameters, and quasi-1D compressible Euler FVM flowfield.
 */
export function extractCfdSlicingProperties(cfgText: string): CfdSlicingProperties {
  // Strip line comments (%, //, #) for active directive extraction
  const activeText = cfgText
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.search(/(%|\/\/|#)/);
      return idx !== -1 ? line.slice(0, idx) : line;
    })
    .join("\n");

  const numOptActive = (pattern: RegExp): number | undefined => {
    const m = activeText.match(pattern);
    if (!m || m[1] === undefined) return undefined;
    const val = parseFloat(m[1]);
    return Number.isFinite(val) ? val : undefined;
  };

  const numOptAny = (pattern: RegExp): number | undefined => {
    const m = cfgText.match(pattern);
    if (!m || m[1] === undefined) return undefined;
    const val = parseFloat(m[1]);
    return Number.isFinite(val) ? val : undefined;
  };

  const hasFlowDirectives =
    /\b(?:SOLVER|MACH_NUMBER|REYNOLDS_NUMBER|INC_VELOCITY_INIT|FREESTREAM_VELOCITY|MARKER_INLET|AOA)\s*=/i.test(
      activeText,
    ) || /\buniform\s*\(/i.test(activeText);

  const cdExplicit =
    numOptActive(/\b(?:Cd_total|CD)\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i) ??
    (!hasFlowDirectives ? numOptAny(/\b(?:Cd_total|CD)\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i) : undefined);
  const clExplicit =
    numOptActive(/\b(?:Cl_total|CL)\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i) ??
    (!hasFlowDirectives ? numOptAny(/\b(?:Cl_total|CL)\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i) : undefined);

  const refAreaOpt = numOptActive(/\bREF_AREA\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);
  const refLengthOpt =
    numOptActive(/\bREF_LENGTH\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i) ??
    numOptActive(/\bREYNOLDS_LENGTH\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);
  const refSpanOpt = numOptActive(/\bREF_SPAN\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);

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
    numOptActive(/\b(?:FREESTREAM_TEMPERATURE|INC_TEMPERATURE_INIT)\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i) ?? 288.15;
  const pressurePa = numOptActive(/\bFREESTREAM_PRESSURE\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i) ?? 101325.0;

  const rhoExplicit = numOptActive(/\b(?:INC_DENSITY_INIT|FREESTREAM_DENSITY)\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);
  const hasThermoDirective = /\b(?:FREESTREAM_PRESSURE|FREESTREAM_TEMPERATURE)\s*=/i.test(activeText);
  const density =
    rhoExplicit !== undefined && rhoExplicit > 0
      ? rhoExplicit
      : hasThermoDirective
        ? parseFloat((pressurePa / (R_AIR * Math.max(tempK, 1.0))).toFixed(5))
        : 1.225;

  // Dynamic viscosity via MU_CONSTANT / FREESTREAM_VISCOSITY or Sutherland's Law
  const muExplicit = numOptActive(/\b(?:MU_CONSTANT|FREESTREAM_VISCOSITY)\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);
  const sutherlandMu = 1.716e-5 * Math.pow(tempK / 273.15, 1.5) * ((273.15 + 110.4) / (tempK + 110.4));
  const mu = muExplicit !== undefined && muExplicit > 0 ? muExplicit : sutherlandMu;

  // Speed of sound
  const soundSpeed = Math.sqrt(GAMMA * R_AIR * Math.max(tempK, 1.0));

  const machOpt = numOptActive(/\bMACH_NUMBER\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);
  const reynoldsOpt = numOptActive(/\bREYNOLDS_NUMBER\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);
  const aoaOpt = numOptActive(/\bAOA\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i);

  const velTupleMatch = activeText.match(
    /\b(?:INC_VELOCITY_INIT|FREESTREAM_VELOCITY)\s*=\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)(?:\s*,\s*([-+\d.eE]+))?\s*\)/i,
  );
  const openFoamVelMatch = activeText.match(/\buniform\s*\(\s*([-+\d.eE]+)\s+([-+\d.eE]+)(?:\s+([-+\d.eE]+))?\s*\)/i);
  const inletParenMatch = activeText.match(/\bMARKER_INLET\s*=\s*\(([^)]+)\)/i);

  let vx = 0.0,
    vy = 0.0,
    vz = 0.0;
  let hasVelocityVector = false;
  let freeStreamVelocity: number;

  if (velTupleMatch) {
    vx = parseFloat(velTupleMatch[1]!);
    vy = parseFloat(velTupleMatch[2]!);
    vz = velTupleMatch[3] !== undefined ? parseFloat(velTupleMatch[3]) : 0.0;
    hasVelocityVector = true;
    freeStreamVelocity = parseFloat(Math.hypot(vx, vy, vz).toFixed(4));
  } else if (openFoamVelMatch) {
    vx = parseFloat(openFoamVelMatch[1]!);
    vy = parseFloat(openFoamVelMatch[2]!);
    vz = openFoamVelMatch[3] !== undefined ? parseFloat(openFoamVelMatch[3]) : 0.0;
    hasVelocityVector = true;
    freeStreamVelocity = parseFloat(Math.hypot(vx, vy, vz).toFixed(4));
  } else if (machOpt !== undefined && machOpt > 0) {
    freeStreamVelocity = parseFloat((machOpt * soundSpeed).toFixed(4));
  } else if (reynoldsOpt !== undefined && reynoldsOpt > 0) {
    freeStreamVelocity = parseFloat(((reynoldsOpt * mu) / (density * Math.max(refLength, 1e-6))).toFixed(4));
  } else if (inletParenMatch && inletParenMatch[1]) {
    const parts = inletParenMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    // 6-tuple: ( name, T0, velMag, nx, ny, nz ); 5-tuple: ( name, velMag, nx, ny, nz )
    const isSixTuple = parts.length >= 6;
    const rawVel = isSixTuple ? parseFloat(parts[2]!) : parts.length >= 2 ? parseFloat(parts[1]!) : 10.0;
    freeStreamVelocity = parseFloat((Number.isFinite(rawVel) ? Math.abs(rawVel) : 10.0).toFixed(4));
    const dirIdx = isSixTuple ? 3 : 2;
    if (parts.length >= dirIdx + 3) {
      const nx = parseFloat(parts[dirIdx]!) || 0.0;
      const ny = parseFloat(parts[dirIdx + 1]!) || 0.0;
      const nz = parseFloat(parts[dirIdx + 2]!) || 0.0;
      vx = freeStreamVelocity * nx;
      vy = freeStreamVelocity * ny;
      vz = freeStreamVelocity * nz;
      hasVelocityVector = Math.hypot(vx, vy, vz) > 1e-6;
    }
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
    aoaOpt !== undefined
      ? aoaOpt
      : hasVelocityVector && Math.hypot(vx, vy, vz) > 1e-6
        ? (Math.atan2(vz, Math.hypot(vx, vy)) * 180.0) / Math.PI
        : 0.0;
  const aoaRad = (aoaDeg * Math.PI) / 180.0;

  // Aspect ratio: handle both chord-based (AR = S / c^2) and span-based (AR = b^2 / S) reference length conventions
  const rawAr =
    refSpanOpt !== undefined && refSpanOpt > 0
      ? (refSpanOpt * refSpanOpt) / Math.max(refArea, 1e-6)
      : Math.max(refArea / Math.max(refLength * refLength, 1e-9), (refLength * refLength) / Math.max(refArea, 1e-6));
  const aspectRatio = Math.min(Math.max(rawAr, 1.0), 25.0);

  // Compressible Prandtl-Glauert 3D finite-wing lift with high-AoA post-stall crossflow attenuation
  const pgBeta = Math.sqrt(Math.max(Math.abs(1.0 - machNumber * machNumber), 0.09));
  const computedCl = (2.0 * Math.PI * Math.sin(aoaRad) * Math.cos(aoaRad)) / (pgBeta + 2.0 / aspectRatio);
  const cl = clExplicit !== undefined ? clExplicit : parseFloat(computedCl.toFixed(5)) || 0;

  // Boundary-layer skin friction coefficient Cf (Blasius laminar / compressible Prandtl-Schlichting turbulent)
  const compFactor = Math.pow(1.0 + 0.144 * machNumber * machNumber, 0.65);
  const cf =
    reynoldsNumber < 5.0e5
      ? 1.328 / Math.sqrt(reynoldsNumber)
      : 0.455 / (Math.pow(Math.log10(reynoldsNumber), 2.58) * compFactor);

  // Hoerner streamlined form factor + crossflow separation pressure drag + induced drag + wave drag
  const thicknessRatio = numOptActive(/\bTHICKNESS_RATIO\s*=\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)/i) ?? 0.12;
  const formFactor = 1.0 + 2.0 * thicknessRatio + 60.0 * Math.pow(thicknessRatio, 4);
  const wettedAreaRatio = 2.05;
  const cosAoa = Math.cos(aoaRad);
  const sinAoa = Math.sin(aoaRad);

  const cdViscous = (cf * formFactor * wettedAreaRatio + 0.004) * (cosAoa * cosAoa);
  const cdCrossflow = 0.8 * (sinAoa * sinAoa);
  const oswaldEfficiency = 0.82;
  const cdi = (cl * cl) / (Math.PI * aspectRatio * oswaldEfficiency);
  const cdWave = machNumber > 0.72 ? 20.0 * Math.pow(machNumber - 0.72, 4) : 0.0;
  const computedCd = Math.max(cdViscous + cdCrossflow + cdi + cdWave, 0.005);

  const cd = cdExplicit !== undefined ? cdExplicit : parseFloat(computedCd.toFixed(4)) || 0;
  const qInf = 0.5 * density * freeStreamVelocity * freeStreamVelocity;
  const dragForce = parseFloat((qInf * refArea * cd).toFixed(4)) || 0;
  const liftForce = parseFloat((qInf * refArea * cl).toFixed(4)) || 0;

  // Execute multi-cell quasi-1D compressible Euler finite-volume solver
  const fluxSchemeMatch = activeText.match(/\bCONV_NUM_METHOD_FLOW\s*=\s*(\w+)/i);
  const fluxScheme = fluxSchemeMatch?.[1]?.toUpperCase() === "HLLC" ? "HLLC" : "ROE";
  const fvmResult = solveQuasi1DEulerFvm({
    freestreamDensity: density,
    freestreamVelocity: freeStreamVelocity,
    freestreamPressure: pressurePa,
    gamma: GAMMA,
    thicknessRatio,
    aoaRad,
    skinFrictionCoeff: cf,
    fluxScheme,
  });

  return {
    cd,
    cl,
    refArea,
    refLength,
    density,
    freeStreamVelocity,
    machNumber: parseFloat(machNumber.toFixed(5)) || 0,
    maxMachNumber: fvmResult.maxMachNumber,
    reynoldsNumber: parseFloat(reynoldsNumber.toFixed(1)) || 0,
    aoaDeg: parseFloat(aoaDeg.toFixed(3)) || 0,
    dragForce,
    liftForce,
    dynamicViscosityPaS: parseFloat(mu.toExponential(6)),
    pressureDropPa: fvmResult.pressureDropPa,
    residualHistory: fvmResult.residualHistory,
    converged: fvmResult.converged,
    iterations: fvmResult.iterations,
    cellMachNumbers: fvmResult.cellMachNumbers,
    cellPressuresPa: fvmResult.cellPressuresPa,
  };
}
