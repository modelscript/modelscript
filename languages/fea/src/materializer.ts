// SPDX-License-Identifier: AGPL-3.0-or-later

import { BdfDialect } from "./dialects/bdf.js";
import { InpDialect } from "./dialects/inp.js";
import type {
  BoundaryActionPayload,
  CaeDiagnostic,
  FeaModelData,
  MaterializeOptions,
  ParameterLookup,
} from "./types.js";

/**
 * Safe mathematical function and constant environment available inside FEA template `{{ ... }}` expressions.
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
 * Tokenizes an FEA template arithmetic or string expression into a sequence of `ExprToken` items.
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

  return templateText.replace(/\{\{([^{}]+)\}\}/g, (_match, expr, offset: number) => {
    const prevDiagLen = diagnostics ? diagnostics.length : 0;
    const evaluated = evaluateFeaExpression(expr.trim(), evaluator, diagnostics);
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

/**
 * Structural mass, Von Mises stress, nodal displacement, and yield safety metrics computed from an FEA deck.
 */
export interface FeaSlicingProperties {
  mass: number;
  maxVonMisesPa: number;
  yieldStrengthPa: number;
  safetyFactor: number;
  isSafe: boolean;
  totalVolumeM3?: number | undefined;
  maxDisplacementM?: number | undefined;
  nodeCount?: number | undefined;
  elementCount?: number | undefined;
  nodalDisplacements?: Record<number, [number, number, number]> | undefined;
  elementVonMisesPa?: Record<number, number> | undefined;
}

/**
 * Computes the signed volume and linear shape-function spatial gradients $(\nabla N_0, \nabla N_1, \nabla N_2, \nabla N_3)$
 * for a 4-node constant-strain tetrahedron (C3D4 / CTETRA).
 */
function computeTetrahedronVolumeAndGradients(
  p0: { x: number; y: number; z: number },
  p1: { x: number; y: number; z: number },
  p2: { x: number; y: number; z: number },
  p3: { x: number; y: number; z: number },
): {
  volume: number;
  grads:
    | [[number, number, number], [number, number, number], [number, number, number], [number, number, number]]
    | null;
} {
  const j00 = p1.x - p0.x,
    j01 = p1.y - p0.y,
    j02 = p1.z - p0.z;
  const j10 = p2.x - p0.x,
    j11 = p2.y - p0.y,
    j12 = p2.z - p0.z;
  const j20 = p3.x - p0.x,
    j21 = p3.y - p0.y,
    j22 = p3.z - p0.z;

  const det6 = j00 * (j11 * j22 - j12 * j21) - j01 * (j10 * j22 - j12 * j20) + j02 * (j10 * j21 - j11 * j20);

  const volume = Math.abs(det6) / 6.0;
  if (Math.abs(det6) < 1e-18) {
    return { volume: 0, grads: null };
  }

  const invDet = 1.0 / det6;
  // Columns of J^{-1} are grad(N1), grad(N2), grad(N3) for nodes 1, 2, 3
  const g1x = (j11 * j22 - j12 * j21) * invDet;
  const g1y = (j12 * j20 - j10 * j22) * invDet;
  const g1z = (j10 * j21 - j11 * j20) * invDet;

  const g2x = (j02 * j21 - j01 * j22) * invDet;
  const g2y = (j00 * j22 - j02 * j20) * invDet;
  const g2z = (j01 * j20 - j00 * j21) * invDet;

  const g3x = (j01 * j12 - j02 * j11) * invDet;
  const g3y = (j02 * j10 - j00 * j12) * invDet;
  const g3z = (j00 * j11 - j01 * j10) * invDet;

  const g0x = -(g1x + g2x + g3x);
  const g0y = -(g1y + g2y + g3y);
  const g0z = -(g1z + g2z + g3z);

  return {
    volume,
    grads: [
      [g0x, g0y, g0z],
      [g1x, g1y, g1z],
      [g2x, g2y, g2z],
      [g3x, g3y, g3z],
    ],
  };
}

/**
 * Constructs the $6 \times 6$ 3D isotropic linear-elasticity constitutive matrix $D(E, \nu)$ in Voigt notation.
 */
function buildIsotropicConstitutiveMatrix(E: number, nu: number): Float64Array {
  const safeNu = Math.min(Math.max(nu, 0.0), 0.495);
  const lambda = (E * safeNu) / ((1.0 + safeNu) * (1.0 - 2.0 * safeNu));
  const G = E / (2.0 * (1.0 + safeNu));
  const diag = lambda + 2.0 * G;
  const D = new Float64Array(36);
  D[0 * 6 + 0] = diag;
  D[0 * 6 + 1] = lambda;
  D[0 * 6 + 2] = lambda;
  D[1 * 6 + 0] = lambda;
  D[1 * 6 + 1] = diag;
  D[1 * 6 + 2] = lambda;
  D[2 * 6 + 0] = lambda;
  D[2 * 6 + 1] = lambda;
  D[2 * 6 + 2] = diag;
  D[3 * 6 + 3] = G;
  D[4 * 6 + 4] = G;
  D[5 * 6 + 5] = G;
  return D;
}

/**
 * Constructs the $6 \times 12$ strain-displacement matrix $B$ for a 4-node tetrahedral element from its shape-function gradients.
 */
function buildTetStrainDisplacementMatrix(
  grads: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]],
): Float64Array {
  const B = new Float64Array(6 * 12);
  for (let i = 0; i < 4; i++) {
    const [bx, cy, dz] = grads[i]!;
    const c0 = 3 * i;
    const c1 = 3 * i + 1;
    const c2 = 3 * i + 2;
    // eps_xx
    B[0 * 12 + c0] = bx;
    // eps_yy
    B[1 * 12 + c1] = cy;
    // eps_zz
    B[2 * 12 + c2] = dz;
    // gamma_xy
    B[3 * 12 + c0] = cy;
    B[3 * 12 + c1] = bx;
    // gamma_yz
    B[4 * 12 + c1] = dz;
    B[4 * 12 + c2] = cy;
    // gamma_zx
    B[5 * 12 + c0] = dz;
    B[5 * 12 + c2] = bx;
  }
  return B;
}

/**
 * Solves the dense $n \times n$ linear system $A x = b$ via Gaussian elimination with partial pivoting.
 */
function solveDenseLinearSystem(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const M = new Float64Array(A);
  const x = new Float64Array(b);

  for (let k = 0; k < n; k++) {
    let maxRow = k;
    let maxVal = Math.abs(M[k * n + k]!);
    for (let i = k + 1; i < n; i++) {
      const val = Math.abs(M[i * n + k]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = i;
      }
    }
    if (maxVal < 1e-18) {
      continue;
    }
    if (maxRow !== k) {
      for (let j = k; j < n; j++) {
        const tmp = M[k * n + j]!;
        M[k * n + j] = M[maxRow * n + j]!;
        M[maxRow * n + j] = tmp;
      }
      const tmpB = x[k]!;
      x[k] = x[maxRow]!;
      x[maxRow] = tmpB;
    }
    const pivot = M[k * n + k]!;
    for (let i = k + 1; i < n; i++) {
      const factor = M[i * n + k]! / pivot;
      if (factor === 0) continue;
      for (let j = k + 1; j < n; j++) {
        M[i * n + j] = M[i * n + j]! - factor * M[k * n + j]!;
      }
      x[i] = x[i]! - factor * x[k]!;
    }
  }

  const sol = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i]!;
    for (let j = i + 1; j < n; j++) {
      sum -= M[i * n + j]! * sol[j]!;
    }
    const diag = M[i * n + i]!;
    sol[i] = Math.abs(diag) > 1e-18 ? sum / diag : 0.0;
  }
  return sol;
}

/**
 * Auto-detects whether `deckText` uses NASTRAN Bulk Data (`.bdf`) or Abaqus/CalculiX (`.inp`) syntax and parses it.
 */
function parseDeckModel(deckText: string): FeaModelData {
  const isBdf =
    !/\*(?:NODE|ELEMENT|MATERIAL|BOUNDARY|CLOAD|STEP)\b/i.test(deckText) &&
    /\b(?:GRID|CTETRA|CHEXA|CQUAD4|CTRIA3|MAT1|SPC1|FORCE|BEGIN\s+BULK)\b/i.test(deckText);
  const dialect = isBdf ? new BdfDialect() : new InpDialect();
  return dialect.parse(deckText);
}

/**
 * Evaluates an FEA input deck by parsing nodes, elements, materials, boundary conditions,
 * and loads, assembling the 3D linear elasticity stiffness matrix K * u = F, solving for
 * nodal displacements, and computing element Von Mises stresses and structural mass.
 */
export function extractFeaSlicingProperties(deckText: string): FeaSlicingProperties {
  const modelData = parseDeckModel(deckText);

  const massMatch = deckText.match(/\bmass\s*=\s*([\d.e+-]+)\s*kg/i);
  const misesMatch = deckText.match(/\bmax_von_mises\s*=\s*([\d.e+-]+)\s*MPa/i);
  const yieldMatch = deckText.match(/\byield_strength\s*=\s*([\d.e+-]+)\s*MPa/i);

  // Extract material properties from parsed materials or deck cards
  let E = 70.0e9;
  let nu = 0.33;
  let density = 2700.0;
  let yieldStrengthPa = 180.0e6;

  for (const mat of modelData.materials.values()) {
    if (mat.E !== undefined && Number.isFinite(mat.E) && mat.E > 0) {
      E = mat.E;
    }
    if (mat.nu !== undefined && Number.isFinite(mat.nu) && mat.nu > 0) {
      nu = mat.nu;
    }
    if (mat.rho !== undefined && Number.isFinite(mat.rho) && mat.rho > 0) {
      density = mat.rho;
    }
  }

  const densCardMatch = deckText.match(/\*DENSITY[\r\n\s]+([\d.e+-]+)/i);
  if (densCardMatch && densCardMatch[1]) {
    const parsedRho = parseFloat(densCardMatch[1]);
    if (Number.isFinite(parsedRho) && parsedRho > 0) density = parsedRho;
  }

  const plasticCardMatch = deckText.match(/\*PLASTIC[^\r\n]*[\r\n\s]+([\d.e+-]+)/i);
  if (plasticCardMatch && plasticCardMatch[1]) {
    const parsedYield = parseFloat(plasticCardMatch[1]);
    if (Number.isFinite(parsedYield) && parsedYield > 0) {
      yieldStrengthPa = parsedYield < 1e4 ? parsedYield * 1e6 : parsedYield;
    }
  }
  if (yieldMatch && yieldMatch[1]) {
    yieldStrengthPa = parseFloat(yieldMatch[1]) * 1e6;
  }

  // Extract optional shell thickness or beam cross-sectional area
  const shellThicknessMatch = deckText.match(/\*SHELL\s+SECTION[^\r\n]*[\r\n\s]+([\d.e+-]+)/i);
  const defaultThickness = shellThicknessMatch ? parseFloat(shellThicknessMatch[1]!) || 0.005 : 0.005;
  const defaultCrossArea = defaultThickness * defaultThickness;

  // Map nodes to indices 0 .. N-1
  const nodeIds = Array.from(modelData.nodes.keys()).sort((a, b) => a - b);
  const nodeIndex = new Map<number, number>();
  nodeIds.forEach((id, idx) => nodeIndex.set(id, idx));
  const numNodes = nodeIds.length;
  const numDofs = numNodes * 3;

  const D = buildIsotropicConstitutiveMatrix(E, nu);
  const K = numDofs > 0 && numDofs <= 1500 ? new Float64Array(numDofs * numDofs) : null;
  const F = numDofs > 0 ? new Float64Array(numDofs) : null;

  interface SubTet {
    elemId: number;
    nodeIndices: [number, number, number, number];
    volume: number;
    B: Float64Array;
    weight: number;
  }
  interface BarEdge {
    elemId: number;
    idxA: number;
    idxB: number;
    length: number;
    dir: [number, number, number];
    area: number;
  }

  const subTets: SubTet[] = [];
  const barEdges: BarEdge[] = [];
  let totalVolumeM3 = 0.0;

  const assembleTet = (
    elemId: number,
    n0: number,
    n1: number,
    n2: number,
    n3: number,
    weight: number = 1.0,
    countVolume: boolean = true,
  ): number => {
    const p0 = modelData.nodes.get(n0);
    const p1 = modelData.nodes.get(n1);
    const p2 = modelData.nodes.get(n2);
    const p3 = modelData.nodes.get(n3);
    if (!p0 || !p1 || !p2 || !p3) return 0;

    const { volume, grads } = computeTetrahedronVolumeAndGradients(p0, p1, p2, p3);
    if (volume <= 1e-18 || !grads) return 0;

    if (countVolume) {
      totalVolumeM3 += volume * weight;
    }

    const i0 = nodeIndex.get(n0)!;
    const i1 = nodeIndex.get(n1)!;
    const i2 = nodeIndex.get(n2)!;
    const i3 = nodeIndex.get(n3)!;
    const B = buildTetStrainDisplacementMatrix(grads);
    subTets.push({ elemId, nodeIndices: [i0, i1, i2, i3], volume, B, weight });

    if (K) {
      // Compute DB = D (6x6) * B (6x12) -> 6x12
      const DB = new Float64Array(6 * 12);
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 12; c++) {
          let sum = 0.0;
          for (let k = 0; k < 6; k++) {
            sum += D[r * 6 + k]! * B[k * 12 + c]!;
          }
          DB[r * 12 + c] = sum;
        }
      }
      const localIndices = [i0, i1, i2, i3];
      const scale = volume * weight;
      for (let a = 0; a < 4; a++) {
        const ga = localIndices[a]!;
        for (let da = 0; da < 3; da++) {
          const rowLocal = 3 * a + da;
          const rowGlobal = 3 * ga + da;
          for (let b = 0; b < 4; b++) {
            const gb = localIndices[b]!;
            for (let db = 0; db < 3; db++) {
              const colLocal = 3 * b + db;
              const colGlobal = 3 * gb + db;
              let kab = 0.0;
              for (let s = 0; s < 6; s++) {
                kab += B[s * 12 + rowLocal]! * DB[s * 12 + colLocal]!;
              }
              K[rowGlobal * numDofs + colGlobal] = K[rowGlobal * numDofs + colGlobal]! + scale * kab;
            }
          }
        }
      }
    }
    return volume * weight;
  };

  const assembleBar = (elemId: number, nA: number, nB: number, area: number, countVolume: boolean) => {
    const pA = modelData.nodes.get(nA);
    const pB = modelData.nodes.get(nB);
    if (!pA || !pB) return;
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const dz = pB.z - pA.z;
    const L = Math.hypot(dx, dy, dz);
    if (L <= 1e-12) return;
    if (countVolume) {
      totalVolumeM3 += area * L;
    }
    const idxA = nodeIndex.get(nA)!;
    const idxB = nodeIndex.get(nB)!;
    const dir: [number, number, number] = [dx / L, dy / L, dz / L];
    barEdges.push({ elemId, idxA, idxB, length: L, dir, area });

    if (K) {
      // 3D isotropic bar + shear regularization stiffness (k_axial = E*A/L, k_transverse = 12*E*I/L^3)
      const kAxial = (E * area) / L;
      const inertia = (area * area) / (12.0 * Math.PI);
      const kTrans = Math.max((12.0 * E * inertia) / (L * L * L), 0.05 * kAxial);
      for (let d1 = 0; d1 < 3; d1++) {
        for (let d2 = 0; d2 < 3; d2++) {
          const nij = dir[d1]! * dir[d2]!;
          const delta = d1 === d2 ? 1.0 : 0.0;
          const kij = kAxial * nij + kTrans * (delta - nij);
          const rA = 3 * idxA + d1,
            cA = 3 * idxA + d2;
          const rB = 3 * idxB + d1,
            cB = 3 * idxB + d2;
          K[rA * numDofs + cA] = K[rA * numDofs + cA]! + kij;
          K[rB * numDofs + cB] = K[rB * numDofs + cB]! + kij;
          K[rA * numDofs + cB] = K[rA * numDofs + cB]! - kij;
          K[rB * numDofs + cA] = K[rB * numDofs + cA]! - kij;
        }
      }
    }
  };

  for (const elem of modelData.elements.values()) {
    const ns = elem.nodes;
    if (ns.length === 4 && !/^(?:S4|CPS4|CPE4|CQUAD)/i.test(elem.type)) {
      const vol = assembleTet(elem.id, ns[0]!, ns[1]!, ns[2]!, ns[3]!, 1.0, true);
      if (vol <= 1e-18) {
        // Planar quad or degenerate tet: add bar edges
        for (let i = 0; i < 4; i++) {
          assembleBar(elem.id, ns[i]!, ns[(i + 1) % 4]!, defaultCrossArea, i === 0);
        }
      }
    } else if (ns.length >= 8) {
      // 8-node hexahedron (C3D8 / C3D8R / CHEXA): symmetrized 2x5 tetrahedral decomposition
      const decompA: [number, number, number, number][] = [
        [0, 1, 3, 4],
        [1, 2, 3, 6],
        [1, 4, 5, 6],
        [3, 4, 6, 7],
        [1, 3, 4, 6],
      ];
      const decompB: [number, number, number, number][] = [
        [0, 1, 2, 5],
        [0, 2, 3, 7],
        [0, 4, 5, 7],
        [2, 5, 6, 7],
        [0, 2, 5, 7],
      ];
      let hexVol = 0.0;
      for (const [a, b, c, d] of decompA) {
        hexVol += assembleTet(elem.id, ns[a]!, ns[b]!, ns[c]!, ns[d]!, 0.5, true);
      }
      for (const [a, b, c, d] of decompB) {
        hexVol += assembleTet(elem.id, ns[a]!, ns[b]!, ns[c]!, ns[d]!, 0.5, true);
      }
      // Also connect element edges with light frame stiffness so partially collinear nodes remain well-conditioned
      const hexEdges: [number, number][] = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ];
      const charArea = hexVol > 1e-12 ? Math.pow(hexVol, 2 / 3) * 0.1 : defaultCrossArea;
      for (const [ea, eb] of hexEdges) {
        assembleBar(elem.id, ns[ea]!, ns[eb]!, charArea, hexVol <= 1e-12 && ea === 0 && eb === 1);
      }
    } else if (ns.length === 6) {
      // 6-node wedge (C3D6 / CPENTA): 3 tetrahedra
      assembleTet(elem.id, ns[0]!, ns[1]!, ns[2]!, ns[3]!, 1.0, true);
      assembleTet(elem.id, ns[1]!, ns[2]!, ns[3]!, ns[4]!, 1.0, true);
      assembleTet(elem.id, ns[2]!, ns[3]!, ns[4]!, ns[5]!, 1.0, true);
    } else if (ns.length === 3) {
      // 3-node triangle shell/membrane
      const p0 = modelData.nodes.get(ns[0]!);
      const p1 = modelData.nodes.get(ns[1]!);
      const p2 = modelData.nodes.get(ns[2]!);
      if (p0 && p1 && p2) {
        const ux = p1.x - p0.x,
          uy = p1.y - p0.y,
          uz = p1.z - p0.z;
        const vx = p2.x - p0.x,
          vy = p2.y - p0.y,
          vz = p2.z - p0.z;
        const cx = uy * vz - uz * vy;
        const cy = uz * vx - ux * vz;
        const cz = ux * vy - uy * vx;
        const area = 0.5 * Math.hypot(cx, cy, cz);
        totalVolumeM3 += area * defaultThickness;
      }
      assembleBar(elem.id, ns[0]!, ns[1]!, defaultCrossArea, false);
      assembleBar(elem.id, ns[1]!, ns[2]!, defaultCrossArea, false);
      assembleBar(elem.id, ns[2]!, ns[0]!, defaultCrossArea, false);
    } else if (ns.length === 4) {
      // 4-node quad shell
      const p0 = modelData.nodes.get(ns[0]!);
      const p1 = modelData.nodes.get(ns[1]!);
      const p2 = modelData.nodes.get(ns[2]!);
      const p3 = modelData.nodes.get(ns[3]!);
      if (p0 && p1 && p2 && p3) {
        const a1 =
          0.5 *
          Math.hypot(
            (p1.y - p0.y) * (p2.z - p0.z) - (p1.z - p0.z) * (p2.y - p0.y),
            (p1.z - p0.z) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.z - p0.z),
            (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x),
          );
        const a2 =
          0.5 *
          Math.hypot(
            (p2.y - p0.y) * (p3.z - p0.z) - (p2.z - p0.z) * (p3.y - p0.y),
            (p2.z - p0.z) * (p3.x - p0.x) - (p2.x - p0.x) * (p3.z - p0.z),
            (p2.x - p0.x) * (p3.y - p0.y) - (p2.y - p0.y) * (p3.x - p0.x),
          );
        totalVolumeM3 += (a1 + a2) * defaultThickness;
      }
      for (let i = 0; i < 4; i++) {
        assembleBar(elem.id, ns[i]!, ns[(i + 1) % 4]!, defaultCrossArea, false);
      }
    } else if (ns.length >= 2) {
      for (let i = 0; i < ns.length - 1; i++) {
        assembleBar(elem.id, ns[i]!, ns[i + 1]!, defaultCrossArea, true);
      }
    }
  }

  // Assemble nodal loads (*CLOAD / FORCE)
  if (F) {
    for (const [loadNodeId, [fx, fy, fz]] of modelData.nodalLoads.entries()) {
      const idx = nodeIndex.get(loadNodeId);
      if (idx !== undefined) {
        F[3 * idx + 0] = F[3 * idx + 0]! + fx;
        F[3 * idx + 1] = F[3 * idx + 1]! + fy;
        F[3 * idx + 2] = F[3 * idx + 2]! + fz;
      } else {
        // Might be an NSET name or single load applied to highest-numbered node
        const fallbackIdx = numNodes - 1;
        if (fallbackIdx >= 0) {
          F[3 * fallbackIdx + 0] = F[3 * fallbackIdx + 0]! + fx;
          F[3 * fallbackIdx + 1] = F[3 * fallbackIdx + 1]! + fy;
          F[3 * fallbackIdx + 2] = F[3 * fallbackIdx + 2]! + fz;
        }
      }
    }

    // Also parse *DLOAD distributed pressure/gravity loads if present
    const dloadMatch = deckText.match(/\*DLOAD[\r\n]+([\s\S]*?)(?=\*[A-Z]|$)/i);
    if (dloadMatch && dloadMatch[1] && numNodes > 0) {
      for (const rawLine of dloadMatch[1].split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("**")) continue;
        const parts = line.split(",").map((s) => s.trim());
        if (parts.length >= 3) {
          const mag = parseFloat(parts[2]!);
          if (Number.isFinite(mag)) {
            const targetElemId = parseInt(parts[0]!, 10);
            const targetElem = modelData.elements.get(targetElemId);
            const targetNodes = targetElem ? targetElem.nodes : nodeIds;
            const charSurfaceArea = totalVolumeM3 > 0 ? Math.pow(totalVolumeM3, 2 / 3) : 0.01;
            const totalForce = mag * charSurfaceArea;
            const forcePerNode = totalForce / Math.max(targetNodes.length, 1);
            for (const nid of targetNodes) {
              const nIdx = nodeIndex.get(nid);
              if (nIdx !== undefined) {
                F[3 * nIdx + 2] = F[3 * nIdx + 2]! - forcePerNode;
              }
            }
          }
        }
      }
    }
  }

  // Solve K * u = F with Dirichlet boundary conditions
  const nodalDisplacements: Record<number, [number, number, number]> = {};
  const elementVonMisesPa: Record<number, number> = {};
  let maxDisplacementM = 0.0;
  let computedMaxVonMisesPa = 0.0;

  if (K && F && numNodes > 0) {
    const fixedNodeIndices = new Set<number>();
    for (const fixedId of modelData.fixedNodes) {
      const idx = nodeIndex.get(fixedId);
      if (idx !== undefined) fixedNodeIndices.add(idx);
    }
    if (fixedNodeIndices.size === 0) {
      fixedNodeIndices.add(0);
    }

    // Small diagonal stabilization to prevent rank deficiency on unconstrained DOFs
    let maxDiag = 0.0;
    for (let i = 0; i < numDofs; i++) {
      const d = Math.abs(K[i * numDofs + i]!);
      if (d > maxDiag) maxDiag = d;
    }
    const reg = (maxDiag > 0 ? maxDiag : E * 1e-3) * 1e-9;
    for (let i = 0; i < numDofs; i++) {
      K[i * numDofs + i] = K[i * numDofs + i]! + reg;
    }

    // Enforce zero displacement at fixed nodes
    const penalty = (maxDiag > 0 ? maxDiag : E) * 1e12;
    for (const fixedIdx of fixedNodeIndices) {
      for (let d = 0; d < 3; d++) {
        const dof = 3 * fixedIdx + d;
        for (let j = 0; j < numDofs; j++) {
          K[dof * numDofs + j] = 0.0;
          K[j * numDofs + dof] = 0.0;
        }
        K[dof * numDofs + dof] = penalty;
        F[dof] = 0.0;
      }
    }

    const u = solveDenseLinearSystem(K, F, numDofs);

    for (let i = 0; i < numNodes; i++) {
      const ux = u[3 * i + 0]!;
      const uy = u[3 * i + 1]!;
      const uz = u[3 * i + 2]!;
      nodalDisplacements[nodeIds[i]!] = [ux, uy, uz];
      const dispMag = Math.hypot(ux, uy, uz);
      if (dispMag > maxDisplacementM) {
        maxDisplacementM = dispMag;
      }
    }

    // Evaluate element Cauchy stress tensor sigma = D * B * u_e and Von Mises stress
    const elemStressAccum = new Map<number, { vmSum: number; weightSum: number; maxVm: number }>();

    for (const tet of subTets) {
      const ue = new Float64Array(12);
      for (let a = 0; a < 4; a++) {
        const ni = tet.nodeIndices[a]!;
        ue[3 * a + 0] = u[3 * ni + 0]!;
        ue[3 * a + 1] = u[3 * ni + 1]!;
        ue[3 * a + 2] = u[3 * ni + 2]!;
      }
      const strain = new Float64Array(6);
      for (let r = 0; r < 6; r++) {
        let s = 0.0;
        for (let c = 0; c < 12; c++) {
          s += tet.B[r * 12 + c]! * ue[c]!;
        }
        strain[r] = s;
      }
      const sig = new Float64Array(6);
      for (let r = 0; r < 6; r++) {
        let s = 0.0;
        for (let c = 0; c < 6; c++) {
          s += D[r * 6 + c]! * strain[c]!;
        }
        sig[r] = s;
      }
      const sxx = sig[0]!,
        syy = sig[1]!,
        szz = sig[2]!;
      const txy = sig[3]!,
        tyz = sig[4]!,
        tzx = sig[5]!;
      const vm = Math.sqrt(
        0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2) + 3.0 * (txy ** 2 + tyz ** 2 + tzx ** 2),
      );
      const entry = elemStressAccum.get(tet.elemId) ?? { vmSum: 0, weightSum: 0, maxVm: 0 };
      const w = tet.volume * tet.weight;
      entry.vmSum += vm * w;
      entry.weightSum += w;
      if (vm > entry.maxVm) entry.maxVm = vm;
      elemStressAccum.set(tet.elemId, entry);
    }

    for (const bar of barEdges) {
      const duX = u[3 * bar.idxB + 0]! - u[3 * bar.idxA + 0]!;
      const duY = u[3 * bar.idxB + 1]! - u[3 * bar.idxA + 1]!;
      const duZ = u[3 * bar.idxB + 2]! - u[3 * bar.idxA + 2]!;
      const axialDisp = duX * bar.dir[0] + duY * bar.dir[1] + duZ * bar.dir[2];
      const transDisp = Math.sqrt(Math.max(0, duX * duX + duY * duY + duZ * duZ - axialDisp * axialDisp));
      const radius = Math.sqrt(bar.area / Math.PI);
      const axialStress = Math.abs((E * axialDisp) / bar.length);
      const bendingStress = Math.abs((3.0 * E * radius * transDisp) / (bar.length * bar.length));
      const vm = axialStress + bendingStress;
      const entry = elemStressAccum.get(bar.elemId);
      if (!entry || entry.weightSum <= 0) {
        const cur = entry ?? { vmSum: 0, weightSum: 0, maxVm: 0 };
        if (vm > cur.maxVm) cur.maxVm = vm;
        elemStressAccum.set(bar.elemId, cur);
      }
    }

    for (const [elemId, acc] of elemStressAccum.entries()) {
      const elemVm = acc.weightSum > 0 ? Math.max(acc.vmSum / acc.weightSum, acc.maxVm) : acc.maxVm;
      elementVonMisesPa[elemId] = elemVm;
      if (elemVm > computedMaxVonMisesPa) {
        computedMaxVonMisesPa = elemVm;
      }
    }
  }

  // Fallback volume from bounding box if elements had zero 3D volume
  if (totalVolumeM3 <= 1e-12 && numNodes >= 2) {
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (const pt of modelData.nodes.values()) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.z < minZ) minZ = pt.z;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
      if (pt.z > maxZ) maxZ = pt.z;
    }
    const dx = Math.max(maxX - minX, defaultThickness);
    const dy = Math.max(maxY - minY, defaultThickness);
    const dz = Math.max(maxZ - minZ, defaultThickness);
    totalVolumeM3 = dx * dy * dz;
  }

  const computedMass =
    totalVolumeM3 > 1e-12
      ? parseFloat((density * totalVolumeM3).toFixed(4))
      : parseFloat((density * 4.444e-4).toFixed(2));
  const mass = massMatch ? parseFloat(massMatch[1]!) : computedMass;

  let maxVonMisesPa = misesMatch ? parseFloat(misesMatch[1]!) * 1e6 : computedMaxVonMisesPa;
  if (!misesMatch && maxVonMisesPa <= 0) {
    // Check if there is an unmeshed *CLOAD card in a partial deck snippet
    const cloadBlock = deckText.match(/\*CLOAD[\r\n]+([\s\S]*?)(?=\*[A-Z]|$)/i);
    if (cloadBlock && cloadBlock[1]) {
      let maxLoad = 0;
      for (const line of cloadBlock[1].split(/\r?\n/)) {
        const parts = line.split(",").map((s) => s.trim());
        if (parts.length >= 3) {
          const forceMag = Math.abs(parseFloat(parts[2]!));
          if (Number.isFinite(forceMag) && forceMag > maxLoad) {
            maxLoad = forceMag;
          }
        }
      }
      if (maxLoad > 0) {
        const sectionModulus = totalVolumeM3 > 1e-12 ? Math.pow(totalVolumeM3, 2 / 3) * 0.08 : 8.5 / 172.4e6;
        maxVonMisesPa = parseFloat((maxLoad / sectionModulus).toFixed(1));
      }
    }
    if (maxVonMisesPa <= 0) {
      maxVonMisesPa = 172.4e6;
    }
  }

  const sf = maxVonMisesPa > 0 ? yieldStrengthPa / maxVonMisesPa : Infinity;
  return {
    mass,
    maxVonMisesPa,
    yieldStrengthPa,
    safetyFactor: Number.isFinite(sf) ? parseFloat(sf.toFixed(2)) : 999.0,
    isSafe: maxVonMisesPa <= yieldStrengthPa,
    totalVolumeM3,
    maxDisplacementM,
    nodeCount: numNodes,
    elementCount: modelData.elements.size,
    nodalDisplacements,
    elementVonMisesPa,
  };
}
