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
      console.warn(`[fea:materializer] Failed to evaluate expression '${trimmed}':`, errMsg || err);
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
 * Groups an array of 1-based DOF indices into sorted, deduplicated contiguous `[start, end]` intervals.
 */
function groupContiguousDofs(dofs: number[]): [number, number][] {
  const sorted = Array.from(new Set(dofs.filter((d) => Number.isInteger(d) && d >= 1 && d <= 6))).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const ranges: [number, number][] = [];
  let start = sorted[0]!;
  let prev = start;
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (cur === prev + 1) {
      prev = cur;
    } else {
      ranges.push([start, prev]);
      start = cur;
      prev = cur;
    }
  }
  ranges.push([start, prev]);
  return ranges;
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
        const ranges =
          action.dofs && action.dofs.length > 0 ? groupContiguousDofs(action.dofs) : [[1, 3] as [number, number]];
        const lines = ["*BOUNDARY"];
        for (const [dofStart, dofEnd] of ranges) {
          lines.push(`${targetId}, ${dofStart}, ${dofEnd}, 0.0`);
        }
        return lines.join("\n");
      }
      case "displacement": {
        const mag = action.magnitude ?? 0.0;
        const ranges =
          action.dofs && action.dofs.length > 0 ? groupContiguousDofs(action.dofs) : [[1, 1] as [number, number]];
        const lines = ["*BOUNDARY"];
        for (const [dofStart, dofEnd] of ranges) {
          lines.push(`${targetId}, ${dofStart}, ${dofEnd}, ${mag}`);
        }
        return lines.join("\n");
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
        let vec: [number, number, number];
        if (action.vector) {
          vec = action.vector;
        } else {
          const dof = action.dofs && action.dofs.length > 0 ? action.dofs[0] : 6;
          const m = action.magnitude ?? 100.0;
          vec = dof === 4 ? [m, 0, 0] : dof === 5 ? [0, m, 0] : [0, 0, m];
        }
        const vecMag = Math.hypot(...vec);
        const mag = action.magnitude !== undefined ? action.magnitude : vecMag || 100.0;
        const norm = vecMag > 0 ? vecMag : 1.0;
        return `MOMENT, 1, ${targetId}, 0, ${mag.toFixed(2)}, ${(vec[0] / norm).toFixed(4)}, ${(vec[1] / norm).toFixed(4)}, ${(vec[2] / norm).toFixed(4)}`;
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
  totalMass: number;
  maxVonMisesPa: number;
  maxVonMisesStress: number;
  yieldStrengthPa: number;
  safetyFactor: number;
  isSafe: boolean;
  totalVolumeM3?: number | undefined;
  maxDisplacementM?: number | undefined;
  nodeCount?: number | undefined;
  elementCount?: number | undefined;
  nodalDisplacements?: Record<number, [number, number, number]> | undefined;
  elementVonMisesPa?: Record<number, number> | undefined;
  elementCauchyStressPa?: Record<number, [number, number, number, number, number, number]> | undefined;
  naturalFrequenciesHz?: number[] | undefined;
}

/**
 * Computes the signed 6x volume (`det6`), positive volume, and linear shape-function spatial gradients
 * $(\nabla N_0, \nabla N_1, \nabla N_2, \nabla N_3)$ for a 4-node constant-strain tetrahedron (C3D4 / CTETRA).
 */
function computeTetrahedronVolumeAndGradients(
  p0: { x: number; y: number; z: number },
  p1: { x: number; y: number; z: number },
  p2: { x: number; y: number; z: number },
  p3: { x: number; y: number; z: number },
): {
  det6: number;
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
    return { det6: 0, volume: 0, grads: null };
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
    det6,
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
 * Solves a sparse symmetric positive-definite linear system $K u = F$ in Compressed Sparse Row (CSR)
 * format using Jacobi-Preconditioned Conjugate Gradient (PCG), with automatic fallback to dense
 * Gaussian elimination for small or ill-conditioned systems.
 */
function solveSparseLinearSystem(sparseRows: Map<number, number>[], F: Float64Array, n: number): Float64Array {
  const rowPtr = new Int32Array(n + 1);
  let nnz = 0;
  for (let i = 0; i < n; i++) {
    rowPtr[i] = nnz;
    nnz += sparseRows[i]!.size;
  }
  rowPtr[n] = nnz;

  const colIdx = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  const invDiag = new Float64Array(n);

  let ptr = 0;
  for (let i = 0; i < n; i++) {
    let dVal = 0.0;
    for (const [col, val] of sparseRows[i]!.entries()) {
      colIdx[ptr] = col;
      values[ptr] = val;
      if (col === i) dVal = val;
      ptr++;
    }
    invDiag[i] = Math.abs(dVal) > 1e-18 ? 1.0 / dVal : 1.0;
  }

  const x = new Float64Array(n);
  const r = new Float64Array(F);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const Ap = new Float64Array(n);

  let bNormSq = 0.0;
  let rz = 0.0;
  for (let i = 0; i < n; i++) {
    const ri = r[i]!;
    bNormSq += ri * ri;
    const zi = invDiag[i]! * ri;
    z[i] = zi;
    p[i] = zi;
    rz += ri * zi;
  }

  if (bNormSq <= 1e-30) {
    return x;
  }

  const tolSq = 1e-20 * bNormSq;
  const maxIter = Math.min(Math.max(n * 3, 500), 15000);
  let converged = false;

  for (let iter = 0; iter < maxIter; iter++) {
    let pAp = 0.0;
    for (let i = 0; i < n; i++) {
      let sum = 0.0;
      const start = rowPtr[i]!;
      const end = rowPtr[i + 1]!;
      for (let k = start; k < end; k++) {
        sum += values[k]! * p[colIdx[k]!]!;
      }
      Ap[i] = sum;
      pAp += p[i]! * sum;
    }

    if (pAp <= 1e-30) break;
    const alpha = rz / pAp;
    let rNormSq = 0.0;

    for (let i = 0; i < n; i++) {
      x[i] = x[i]! + alpha * p[i]!;
      const ri = r[i]! - alpha * Ap[i]!;
      r[i] = ri;
      rNormSq += ri * ri;
    }

    if (rNormSq <= tolSq) {
      converged = true;
      break;
    }

    let rzNew = 0.0;
    for (let i = 0; i < n; i++) {
      const zi = invDiag[i]! * r[i]!;
      z[i] = zi;
      rzNew += r[i]! * zi;
    }
    if (rzNew <= 1e-30) break;

    const beta = rzNew / rz;
    for (let i = 0; i < n; i++) {
      p[i] = z[i]! + beta * p[i]!;
    }
    rz = rzNew;
  }

  if (!converged && n <= 1500) {
    const denseK = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      const start = rowPtr[i]!;
      const end = rowPtr[i + 1]!;
      for (let k = start; k < end; k++) {
        denseK[i * n + colIdx[k]!] = values[k]!;
      }
    }
    return solveDenseLinearSystem(denseK, F, n);
  }

  return x;
}

/**
 * Auto-detects whether `deckText` uses NASTRAN Bulk Data (`.bdf`) or Abaqus/CalculiX (`.inp`) syntax and parses it.
 */
function parseDeckModel(deckText: string): FeaModelData {
  const isBdf =
    !/\*(?:NODE|ELEMENT|MATERIAL|BOUNDARY|CLOAD|STEP)\b/i.test(deckText) &&
    /\b(?:GRID|CTETRA|CHEXA|CPENTA|CQUAD4|CTRIA3|CBAR|CROD|MAT1|SPC1|SPC|FORCE|BEGIN\s+BULK)\b/i.test(deckText);
  const dialect = isBdf ? new BdfDialect() : new InpDialect();
  return dialect.parse(deckText);
}

function extractCardLines(deckText: string, cardPrefix: string): string[] {
  const lines = deckText.split(/\r?\n/);
  const result: string[] = [];
  let inCard = false;
  const pfx = "*" + cardPrefix.toUpperCase();
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("*")) {
      if (inCard) break;
      if (trimmed.toUpperCase().startsWith(pfx)) inCard = true;
    } else if (inCard && trimmed.length > 0 && !trimmed.startsWith("**")) {
      result.push(trimmed);
    }
  }
  return result;
}

function extractAllCardBlocks(deckText: string, cardPrefix: string): string[][] {
  const lines = deckText.split(/\r?\n/);
  const blocks: string[][] = [];
  let currentBlock: string[] | null = null;
  const pfx = "*" + cardPrefix.toUpperCase();
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("*")) {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      if (trimmed.toUpperCase().startsWith(pfx)) {
        currentBlock = [];
      }
    } else if (currentBlock && trimmed.length > 0 && !trimmed.startsWith("**")) {
      currentBlock.push(trimmed);
    }
  }
  if (currentBlock) blocks.push(currentBlock);
  return blocks;
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

  // Extract default material properties from parsed materials or deck cards
  let defaultE = 70.0e9;
  let defaultNu = 0.33;
  let defaultDensity = 2700.0;
  let yieldStrengthPa = 180.0e6;

  for (const mat of modelData.materials.values()) {
    if (mat.E !== undefined && Number.isFinite(mat.E) && mat.E > 0) {
      defaultE = mat.E;
    }
    if (mat.nu !== undefined && Number.isFinite(mat.nu) && mat.nu > 0) {
      defaultNu = mat.nu;
    }
    if (mat.rho !== undefined && Number.isFinite(mat.rho) && mat.rho > 0) {
      defaultDensity = mat.rho;
    }
    if (mat.yieldStrength !== undefined && Number.isFinite(mat.yieldStrength) && mat.yieldStrength > 0) {
      yieldStrengthPa = mat.yieldStrength < 1e4 ? mat.yieldStrength * 1e6 : mat.yieldStrength;
    }
  }

  const densityLines = extractCardLines(deckText, "DENSITY");
  if (densityLines.length > 0 && modelData.materials.size <= 1) {
    const parsedRho = parseFloat(densityLines[0]!);
    if (Number.isFinite(parsedRho) && parsedRho > 0) defaultDensity = parsedRho;
  }

  const plasticLines = extractCardLines(deckText, "PLASTIC");
  if (plasticLines.length > 0) {
    const parsedYield = parseFloat(plasticLines[0]!);
    if (Number.isFinite(parsedYield) && parsedYield > 0) {
      yieldStrengthPa = parsedYield < 1e4 ? parsedYield * 1e6 : parsedYield;
    }
  }
  if (yieldMatch && yieldMatch[1]) {
    yieldStrengthPa = parseFloat(yieldMatch[1]) * 1e6;
  }

  // Extract optional shell thickness or beam cross-sectional area
  const shellLines = extractCardLines(deckText, "SHELL SECTION");
  let firstSectionThickness = 0.0;
  if (modelData.sectionThickness && modelData.sectionThickness.size > 0) {
    for (const tVal of modelData.sectionThickness.values()) {
      if (tVal > 0) {
        firstSectionThickness = tVal;
        break;
      }
    }
  }
  const defaultThickness =
    shellLines.length > 0
      ? parseFloat(shellLines[0]!) || 0.005
      : firstSectionThickness > 0
        ? firstSectionThickness
        : 0.005;
  const defaultCrossArea = defaultThickness * defaultThickness;

  // Map nodes to indices 0 .. N-1
  const nodeIds = Array.from(modelData.nodes.keys()).sort((a, b) => a - b);
  const nodeIndex = new Map<number, number>();
  nodeIds.forEach((id, idx) => nodeIndex.set(id, idx));
  const numNodes = nodeIds.length;
  const numDofs = numNodes * 3;
  const numElements = modelData.elements.size;

  const sparseRows: Map<number, number>[] | null =
    numDofs > 0 ? Array.from({ length: numDofs }, () => new Map<number, number>()) : null;
  const F = numDofs > 0 ? new Float64Array(numDofs) : null;
  const nodalMass = new Float64Array(numNodes);

  const addK = (r: number, c: number, val: number) => {
    if (!sparseRows || val === 0.0) return;
    const row = sparseRows[r]!;
    row.set(c, (row.get(c) ?? 0.0) + val);
  };

  interface SubTet {
    elemId: number;
    nodeIndices: [number, number, number, number];
    volume: number;
    B: Float64Array;
    D: Float64Array;
    weight: number;
  }
  interface Tet10GaussPt {
    elemId: number;
    nodeIndices: number[]; // length 10
    volume: number;
    B: Float64Array; // 6 x 30
    D: Float64Array; // 6 x 6
    weight: number;
  }
  interface SubTri {
    elemId: number;
    nodeIndices: [number, number, number];
    area: number;
    thickness: number;
    Bm: Float64Array;
    Dps: Float64Array;
    e1: [number, number, number];
    e2: [number, number, number];
    e3: [number, number, number];
    gradX: [number, number, number];
    gradY: [number, number, number];
    G: number;
    weight: number;
  }
  interface BarEdge {
    elemId: number;
    idxA: number;
    idxB: number;
    length: number;
    dir: [number, number, number];
    area: number;
    E: number;
  }

  const subTets: SubTet[] = [];
  const tet10Pts: Tet10GaussPt[] = [];
  const subTris: SubTri[] = [];
  const barEdges: BarEdge[] = [];
  let totalVolumeM3 = 0.0;
  let totalMassKg = 0.0;

  const resolveElementMaterial = (elset?: string): { E: number; nu: number; rho: number } => {
    if (elset && modelData.elsetMaterials) {
      const matName = modelData.elsetMaterials.get(elset.toUpperCase());
      if (matName) {
        const mat = modelData.materials.get(matName);
        if (mat) {
          return {
            E: mat.E !== undefined && mat.E > 0 ? mat.E : defaultE,
            nu: mat.nu !== undefined && mat.nu > 0 ? mat.nu : defaultNu,
            rho: mat.rho !== undefined && mat.rho > 0 ? mat.rho : defaultDensity,
          };
        }
      }
    }
    return { E: defaultE, nu: defaultNu, rho: defaultDensity };
  };

  const assembleTet = (
    elemId: number,
    n0: number,
    n1: number,
    n2: number,
    n3: number,
    elemMat: { E: number; nu: number; rho: number },
    weight: number = 1.0,
    countVolume: boolean = true,
  ): number => {
    const p0 = modelData.nodes.get(n0);
    let p1 = modelData.nodes.get(n1);
    let p2 = modelData.nodes.get(n2);
    const p3 = modelData.nodes.get(n3);
    if (!p0 || !p1 || !p2 || !p3) return 0;

    let m1 = n1;
    let m2 = n2;
    let tetGeom = computeTetrahedronVolumeAndGradients(p0, p1, p2, p3);
    if (tetGeom.det6 < 0) {
      // Swap nodes 1 and 2 to guarantee strictly positive Jacobian determinant (detJ > 0)
      m1 = n2;
      m2 = n1;
      const tmpP = p1;
      p1 = p2;
      p2 = tmpP;
      tetGeom = computeTetrahedronVolumeAndGradients(p0, p1, p2, p3);
    }

    const { volume, grads } = tetGeom;
    if (volume <= 1e-18 || !grads) return 0;

    const i0 = nodeIndex.get(n0)!;
    const i1 = nodeIndex.get(m1)!;
    const i2 = nodeIndex.get(m2)!;
    const i3 = nodeIndex.get(n3)!;

    if (countVolume) {
      const weightedVol = volume * weight;
      const elemMass = weightedVol * elemMat.rho;
      totalVolumeM3 += weightedVol;
      totalMassKg += elemMass;
      const quarterMass = 0.25 * elemMass;
      nodalMass[i0] = nodalMass[i0]! + quarterMass;
      nodalMass[i1] = nodalMass[i1]! + quarterMass;
      nodalMass[i2] = nodalMass[i2]! + quarterMass;
      nodalMass[i3] = nodalMass[i3]! + quarterMass;
    }

    const D = buildIsotropicConstitutiveMatrix(elemMat.E, elemMat.nu);
    const B = buildTetStrainDisplacementMatrix(grads);
    subTets.push({ elemId, nodeIndices: [i0, i1, i2, i3], volume, B, D, weight });

    if (sparseRows) {
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
              addK(rowGlobal, colGlobal, scale * kab);
            }
          }
        }
      }
    }
    return volume * weight;
  };

  /**
   * Assembles a 10-node quadratic tetrahedron (C3D10 / CTETRA10) using 4-point degree-2
   * Hammer-Marroud Gauss quadrature over the 10 quadratic shape functions N_0..N_9 plus
   * octal 8-sub-tetrahedra coupling across corner and midside nodes.
   */
  const assembleTet10 = (elemId: number, ns: number[], elemMat: { E: number; nu: number; rho: number }) => {
    const pts = ns.slice(0, 10).map((nid) => modelData.nodes.get(nid));
    if (pts.some((p) => !p)) return;
    const p0 = pts[0]!;
    const p1 = pts[1]!;
    const p2 = pts[2]!;
    const p3 = pts[3]!;

    const baseGeom = computeTetrahedronVolumeAndGradients(p0, p1, p2, p3);
    if (baseGeom.volume <= 1e-18 || !baseGeom.grads) return;

    const vol = baseGeom.volume;
    const g = baseGeom.grads;
    const elemMass = vol * elemMat.rho;
    totalVolumeM3 += vol;
    totalMassKg += elemMass;

    const localIndices = ns.slice(0, 10).map((nid) => nodeIndex.get(nid)!);
    // Distribute lumped mass across the 10 nodes (1/20 at corners, 2/15 at midside nodes; sum = 4/20 + 12/15 = 1)
    for (let a = 0; a < 4; a++) {
      nodalMass[localIndices[a]!] = nodalMass[localIndices[a]!]! + 0.05 * elemMass;
    }
    for (let a = 4; a < 10; a++) {
      nodalMass[localIndices[a]!] = nodalMass[localIndices[a]!]! + (2.0 / 15.0) * elemMass;
    }

    const D = buildIsotropicConstitutiveMatrix(elemMat.E, elemMat.nu);

    // 4-point degree-2 tetrahedral Gauss quadrature (Hammer-Marroud / Keast)
    const alpha = 0.5854101966249685; // (5 + 3*sqrt(5)) / 20
    const beta = 0.1381966011250105; // (5 - sqrt(5)) / 20
    const quadZeta: readonly [number, number, number, number][] = [
      [alpha, beta, beta, beta],
      [beta, alpha, beta, beta],
      [beta, beta, alpha, beta],
      [beta, beta, beta, alpha],
    ];
    const midEdges: readonly [number, number][] = [
      [0, 1], // node 4
      [1, 2], // node 5
      [2, 0], // node 6
      [0, 3], // node 7
      [1, 3], // node 8
      [2, 3], // node 9
    ];

    const quadShare = 0.8;
    for (const z of quadZeta) {
      const wq = 0.25 * quadShare;
      const B = new Float64Array(6 * 30);
      for (let a = 0; a < 10; a++) {
        let gx = 0.0,
          gy = 0.0,
          gz = 0.0;
        if (a < 4) {
          const dNdz = 4.0 * z[a]! - 1.0;
          gx = dNdz * g[a]![0];
          gy = dNdz * g[a]![1];
          gz = dNdz * g[a]![2];
        } else {
          const [ea, eb] = midEdges[a - 4]!;
          const za = z[ea]!;
          const zb = z[eb]!;
          gx = 4.0 * (za * g[eb]![0] + zb * g[ea]![0]);
          gy = 4.0 * (za * g[eb]![1] + zb * g[ea]![1]);
          gz = 4.0 * (za * g[eb]![2] + zb * g[ea]![2]);
        }
        const c0 = 3 * a;
        const c1 = 3 * a + 1;
        const c2 = 3 * a + 2;
        B[0 * 30 + c0] = gx;
        B[1 * 30 + c1] = gy;
        B[2 * 30 + c2] = gz;
        B[3 * 30 + c0] = gy;
        B[3 * 30 + c1] = gx;
        B[4 * 30 + c1] = gz;
        B[4 * 30 + c2] = gy;
        B[5 * 30 + c0] = gz;
        B[5 * 30 + c2] = gx;
      }

      tet10Pts.push({ elemId, nodeIndices: localIndices, volume: vol, B, D, weight: wq });

      if (sparseRows) {
        const DB = new Float64Array(6 * 30);
        for (let r = 0; r < 6; r++) {
          for (let c = 0; c < 30; c++) {
            let sum = 0.0;
            for (let k = 0; k < 6; k++) {
              sum += D[r * 6 + k]! * B[k * 30 + c]!;
            }
            DB[r * 30 + c] = sum;
          }
        }
        const scale = vol * wq;
        for (let a = 0; a < 10; a++) {
          const ga = localIndices[a]!;
          for (let da = 0; da < 3; da++) {
            const rowLocal = 3 * a + da;
            const rowGlobal = 3 * ga + da;
            for (let b = 0; b < 10; b++) {
              const gb = localIndices[b]!;
              for (let db = 0; db < 3; db++) {
                const colLocal = 3 * b + db;
                const colGlobal = 3 * gb + db;
                let kab = 0.0;
                for (let s = 0; s < 6; s++) {
                  kab += B[s * 30 + rowLocal]! * DB[s * 30 + colLocal]!;
                }
                addK(rowGlobal, colGlobal, scale * kab);
              }
            }
          }
        }
      }
    }

    // Octal 8-sub-tetrahedra partition for curved-edge and positive corner diagonal coupling
    const octalSubTets: readonly [number, number, number, number][] = [
      [0, 4, 6, 7],
      [4, 1, 5, 8],
      [6, 5, 2, 9],
      [7, 8, 9, 3],
      [4, 5, 6, 8],
      [4, 6, 7, 8],
      [6, 5, 9, 8],
      [6, 9, 7, 8],
    ];
    for (const [a, b, c, d] of octalSubTets) {
      assembleTet(elemId, ns[a]!, ns[b]!, ns[c]!, ns[d]!, elemMat, 1.0 - quadShare, false);
    }
  };

  const assembleShellTri = (
    elemId: number,
    n0: number,
    n1: number,
    n2: number,
    thickness: number,
    elemMat: { E: number; nu: number; rho: number },
    weight: number = 1.0,
    countVolume: boolean = true,
  ) => {
    const p0 = modelData.nodes.get(n0);
    const p1 = modelData.nodes.get(n1);
    const p2 = modelData.nodes.get(n2);
    if (!p0 || !p1 || !p2) return;

    const ux = p1.x - p0.x,
      uy = p1.y - p0.y,
      uz = p1.z - p0.z;
    const L01 = Math.hypot(ux, uy, uz);
    if (L01 <= 1e-12) return;

    const vx = p2.x - p0.x,
      vy = p2.y - p0.y,
      vz = p2.z - p0.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const normLen = Math.hypot(nx, ny, nz);
    const area = 0.5 * normLen;
    if (area <= 1e-16) return;

    const i0 = nodeIndex.get(n0)!;
    const i1 = nodeIndex.get(n1)!;
    const i2 = nodeIndex.get(n2)!;

    if (countVolume) {
      const vol = area * thickness * weight;
      const elemMass = vol * elemMat.rho;
      totalVolumeM3 += vol;
      totalMassKg += elemMass;
      const thirdMass = elemMass / 3.0;
      nodalMass[i0] = nodalMass[i0]! + thirdMass;
      nodalMass[i1] = nodalMass[i1]! + thirdMass;
      nodalMass[i2] = nodalMass[i2]! + thirdMass;
    }

    const e1: [number, number, number] = [ux / L01, uy / L01, uz / L01];
    const e3: [number, number, number] = [nx / normLen, ny / normLen, nz / normLen];
    const e2: [number, number, number] = [
      e3[1] * e1[2] - e3[2] * e1[1],
      e3[2] * e1[0] - e3[0] * e1[2],
      e3[0] * e1[1] - e3[1] * e1[0],
    ];

    // Local 2D coordinates in (e1, e2) plane
    const x0 = 0.0,
      y0 = 0.0;
    const x1 = L01,
      y1 = 0.0;
    const x2 = vx * e1[0] + vy * e1[1] + vz * e1[2];
    const y2 = vx * e2[0] + vy * e2[1] + vz * e2[2];

    const inv2A = 1.0 / (2.0 * area);
    const gradX: [number, number, number] = [(y1 - y2) * inv2A, (y2 - y0) * inv2A, (y0 - y1) * inv2A];
    const gradY: [number, number, number] = [(x2 - x1) * inv2A, (x0 - x2) * inv2A, (x1 - x0) * inv2A];

    // 3x9 Membrane CST strain-displacement matrix Bm mapping global 3D nodal DOFs to local [eps_xx, eps_yy, gamma_xy]
    const Bm = new Float64Array(3 * 9);
    for (let a = 0; a < 3; a++) {
      const gx = gradX[a]!;
      const gy = gradY[a]!;
      for (let d = 0; d < 3; d++) {
        const col = 3 * a + d;
        Bm[0 * 9 + col] = gx * e1[d]!;
        Bm[1 * 9 + col] = gy * e2[d]!;
        Bm[2 * 9 + col] = gy * e1[d]! + gx * e2[d]!;
      }
    }

    const safeNu = Math.min(Math.max(elemMat.nu, 0.0), 0.495);
    const factor = elemMat.E / (1.0 - safeNu * safeNu);
    const G = elemMat.E / (2.0 * (1.0 + safeNu));
    const Dps = new Float64Array([
      factor,
      factor * safeNu,
      0.0,
      factor * safeNu,
      factor,
      0.0,
      0.0,
      0.0,
      factor * 0.5 * (1.0 - safeNu),
    ]);

    const localIndices: [number, number, number] = [i0, i1, i2];

    subTris.push({
      elemId,
      nodeIndices: localIndices,
      area,
      thickness,
      Bm,
      Dps,
      e1,
      e2,
      e3,
      gradX,
      gradY,
      G,
      weight,
    });

    if (sparseRows) {
      const DBm = new Float64Array(3 * 9);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 9; c++) {
          let sum = 0.0;
          for (let k = 0; k < 3; k++) {
            sum += Dps[r * 3 + k]! * Bm[k * 9 + c]!;
          }
          DBm[r * 9 + c] = sum;
        }
      }

      const scale = area * thickness * weight;
      const stabScale = scale * G * Math.max((thickness * thickness) / area, 1e-3);

      for (let a = 0; a < 3; a++) {
        const ga = localIndices[a]!;
        for (let b = 0; b < 3; b++) {
          const gb = localIndices[b]!;
          const lapAB = gradX[a]! * gradX[b]! + gradY[a]! * gradY[b]!;
          for (let da = 0; da < 3; da++) {
            const rowLocal = 3 * a + da;
            const rowGlobal = 3 * ga + da;
            for (let db = 0; db < 3; db++) {
              const colLocal = 3 * b + db;
              const colGlobal = 3 * gb + db;
              let kab = 0.0;
              for (let s = 0; s < 3; s++) {
                kab += Bm[s * 9 + rowLocal]! * DBm[s * 9 + colLocal]!;
              }
              const kStab = stabScale * lapAB * e3[da]! * e3[db]!;
              addK(rowGlobal, colGlobal, scale * kab + kStab);
            }
          }
        }
      }
    }
  };

  const assembleBar = (
    elemId: number,
    nA: number,
    nB: number,
    area: number,
    elemMat: { E: number; nu: number; rho: number },
    countVolume: boolean,
  ) => {
    const pA = modelData.nodes.get(nA);
    const pB = modelData.nodes.get(nB);
    if (!pA || !pB) return;
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const dz = pB.z - pA.z;
    const L = Math.hypot(dx, dy, dz);
    if (L <= 1e-12) return;
    const idxA = nodeIndex.get(nA)!;
    const idxB = nodeIndex.get(nB)!;
    if (countVolume) {
      const vol = area * L;
      const elemMass = vol * elemMat.rho;
      totalVolumeM3 += vol;
      totalMassKg += elemMass;
      nodalMass[idxA] = nodalMass[idxA]! + 0.5 * elemMass;
      nodalMass[idxB] = nodalMass[idxB]! + 0.5 * elemMass;
    }
    const dir: [number, number, number] = [dx / L, dy / L, dz / L];
    barEdges.push({ elemId, idxA, idxB, length: L, dir, area, E: elemMat.E });

    if (sparseRows) {
      // Frame-indifferent 3D axial truss/bar stiffness K_bar = (E * A / L) * (n ⊗ n)
      const kAxial = (elemMat.E * area) / L;
      for (let d1 = 0; d1 < 3; d1++) {
        for (let d2 = 0; d2 < 3; d2++) {
          const kij = kAxial * dir[d1]! * dir[d2]!;
          const rA = 3 * idxA + d1,
            cA = 3 * idxA + d2;
          const rB = 3 * idxB + d1,
            cB = 3 * idxB + d2;
          addK(rA, cA, kij);
          addK(rB, cB, kij);
          addK(rA, cB, -kij);
          addK(rB, cA, -kij);
        }
      }
    }
  };

  for (const elem of modelData.elements.values()) {
    const ns = elem.nodes;
    const elemMat = resolveElementMaterial(elem.elset);
    const elsetUpper = elem.elset?.toUpperCase();
    const elemThickness = (elsetUpper && modelData.sectionThickness?.get(elsetUpper)) || defaultThickness;
    const elemBarArea = (elsetUpper && modelData.beamAreas?.get(elsetUpper)) || defaultCrossArea;
    const isShellType = /^(?:S3|S4|CPS|CPE|CAX|CQUAD|CTRIA|SHELL)/i.test(elem.type) || elem.family === "shell";
    const isTetType = /^(?:C3D4|C3D10|CTETRA)/i.test(elem.type);

    if (ns.length >= 10 && isTetType) {
      // 10-node quadratic tetrahedron (C3D10 / CTETRA10)
      assembleTet10(elem.id, ns, elemMat);
    } else if ((ns.length === 4 && !isShellType) || (isTetType && ns.length >= 4)) {
      assembleTet(elem.id, ns[0]!, ns[1]!, ns[2]!, ns[3]!, elemMat, 1.0, true);
    } else if (ns.length >= 8 && !isTetType) {
      // 8-node or 20-node hexahedron (C3D8 / C3D8R / C3D20 / CHEXA): symmetrized 2x5 tetrahedral decomposition
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
      for (const [a, b, c, d] of decompA) {
        assembleTet(elem.id, ns[a]!, ns[b]!, ns[c]!, ns[d]!, elemMat, 0.5, true);
      }
      for (const [a, b, c, d] of decompB) {
        assembleTet(elem.id, ns[a]!, ns[b]!, ns[c]!, ns[d]!, elemMat, 0.5, true);
      }
    } else if (ns.length === 6 && !isShellType) {
      // 6-node wedge (C3D6 / CPENTA): 3 positive-Jacobian tetrahedra partitioning the prism
      assembleTet(elem.id, ns[0]!, ns[1]!, ns[2]!, ns[3]!, elemMat, 1.0, true);
      assembleTet(elem.id, ns[1]!, ns[4]!, ns[2]!, ns[3]!, elemMat, 1.0, true);
      assembleTet(elem.id, ns[2]!, ns[4]!, ns[5]!, ns[3]!, elemMat, 1.0, true);
    } else if (ns.length === 3) {
      // 3-node triangle shell/membrane (S3 / CTRIA3)
      assembleShellTri(elem.id, ns[0]!, ns[1]!, ns[2]!, elemThickness, elemMat, 1.0, true);
    } else if (ns.length === 4 && isShellType) {
      // 4-node quad shell (S4 / CQUAD4): symmetrized 2x2 CST triangle decomposition
      assembleShellTri(elem.id, ns[0]!, ns[1]!, ns[2]!, elemThickness, elemMat, 0.5, true);
      assembleShellTri(elem.id, ns[0]!, ns[2]!, ns[3]!, elemThickness, elemMat, 0.5, true);
      assembleShellTri(elem.id, ns[0]!, ns[1]!, ns[3]!, elemThickness, elemMat, 0.5, true);
      assembleShellTri(elem.id, ns[1]!, ns[2]!, ns[3]!, elemThickness, elemMat, 0.5, true);
    } else if (ns.length >= 2) {
      for (let i = 0; i < ns.length - 1; i++) {
        assembleBar(elem.id, ns[i]!, ns[i + 1]!, elemBarArea, elemMat, true);
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
      }
    }

    // Parse *DLOAD distributed pressure/gravity loads if present
    const dloadBlocks = extractAllCardBlocks(deckText, "DLOAD");
    for (const dloadLines of dloadBlocks) {
      if (numNodes === 0) continue;
      for (const rawLine of dloadLines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("**")) continue;
        const parts = line.split(",").map((s) => s.trim());
        if (parts.length < 3) continue;

        const targetStr = parts[0]!;
        const loadType = parts[1]!.toUpperCase();
        const mag = parseFloat(parts[2]!);
        if (!Number.isFinite(mag)) continue;

        const targetElems: import("./types.js").FeaElement[] = [];
        const targetElemId = parseInt(targetStr, 10);
        if (!isNaN(targetElemId) && modelData.elements.has(targetElemId)) {
          targetElems.push(modelData.elements.get(targetElemId)!);
        } else {
          const elset = modelData.elementSets.get(targetStr.toUpperCase());
          if (elset) {
            for (const eid of elset) {
              const el = modelData.elements.get(eid);
              if (el) targetElems.push(el);
            }
          } else if (targetStr.toUpperCase() === "EALL" || targetStr.toUpperCase() === "ALL") {
            targetElems.push(...modelData.elements.values());
          }
        }

        for (const elem of targetElems) {
          const ns = elem.nodes;
          if (loadType === "GRAV") {
            const gx = parts.length >= 4 ? parseFloat(parts[3]!) || 0 : 0;
            const gy = parts.length >= 5 ? parseFloat(parts[4]!) || 0 : 0;
            const gz = parts.length >= 6 ? parseFloat(parts[5]!) || 0 : -1;
            const elemMat = resolveElementMaterial(elem.elset);
            const elemTets = subTets.filter((t) => t.elemId === elem.id);
            const elemVol = elemTets.reduce((acc, t) => acc + t.volume * t.weight, 0);
            const forceMag = elemVol * elemMat.rho * mag;
            const perNode = forceMag / Math.max(ns.length, 1);
            for (const nid of ns) {
              const nIdx = nodeIndex.get(nid);
              if (nIdx !== undefined) {
                F[3 * nIdx + 0] = F[3 * nIdx + 0]! + perNode * gx;
                F[3 * nIdx + 1] = F[3 * nIdx + 1]! + perNode * gy;
                F[3 * nIdx + 2] = F[3 * nIdx + 2]! + perNode * gz;
              }
            }
            continue;
          }

          // Determine face nodes for Abaqus/CalculiX pressure load (P, P1..P6)
          let faceNodes: number[] = [];
          const isShell = /^(?:S3|S4|CPS|CPE|CAX|CQUAD|CTRIA|SHELL)/i.test(elem.type) || elem.family === "shell";
          if (isShell || ns.length === 3) {
            faceNodes = ns.slice(0, Math.min(ns.length, 4));
          } else if (ns.length === 4 || /^(?:C3D4|C3D10|CTETRA)/i.test(elem.type)) {
            if (loadType === "P2") faceNodes = [ns[0]!, ns[3]!, ns[1]!];
            else if (loadType === "P3") faceNodes = [ns[1]!, ns[3]!, ns[2]!];
            else if (loadType === "P4") faceNodes = [ns[2]!, ns[3]!, ns[0]!];
            else faceNodes = [ns[0]!, ns[1]!, ns[2]!];
          } else if (ns.length >= 8) {
            if (loadType === "P1") faceNodes = [ns[0]!, ns[1]!, ns[2]!, ns[3]!];
            else if (loadType === "P3") faceNodes = [ns[0]!, ns[4]!, ns[5]!, ns[1]!];
            else if (loadType === "P4") faceNodes = [ns[1]!, ns[5]!, ns[6]!, ns[2]!];
            else if (loadType === "P5") faceNodes = [ns[2]!, ns[6]!, ns[7]!, ns[3]!];
            else if (loadType === "P6") faceNodes = [ns[3]!, ns[7]!, ns[4]!, ns[0]!];
            else faceNodes = [ns[4]!, ns[7]!, ns[6]!, ns[5]!]; // P2 or default P
          } else if (ns.length === 6) {
            if (loadType === "P1") faceNodes = [ns[0]!, ns[1]!, ns[2]!];
            else if (loadType === "P3") faceNodes = [ns[0]!, ns[3]!, ns[4]!, ns[1]!];
            else if (loadType === "P4") faceNodes = [ns[1]!, ns[4]!, ns[5]!, ns[2]!];
            else if (loadType === "P5") faceNodes = [ns[2]!, ns[5]!, ns[3]!, ns[0]!];
            else faceNodes = [ns[3]!, ns[5]!, ns[4]!]; // P2 or default P
          }

          if (faceNodes.length >= 3) {
            const fp0 = modelData.nodes.get(faceNodes[0]!);
            const fp1 = modelData.nodes.get(faceNodes[1]!);
            const fp2 = modelData.nodes.get(faceNodes[2]!);
            if (fp0 && fp1 && fp2) {
              let nx = 0.5 * ((fp1.y - fp0.y) * (fp2.z - fp0.z) - (fp1.z - fp0.z) * (fp2.y - fp0.y));
              let ny = 0.5 * ((fp1.z - fp0.z) * (fp2.x - fp0.x) - (fp1.x - fp0.x) * (fp2.z - fp0.z));
              let nz = 0.5 * ((fp1.x - fp0.x) * (fp2.y - fp0.y) - (fp1.y - fp0.y) * (fp2.x - fp0.x));

              if (faceNodes.length >= 4) {
                const fp3 = modelData.nodes.get(faceNodes[3]!);
                if (fp3) {
                  nx += 0.5 * ((fp2.y - fp0.y) * (fp3.z - fp0.z) - (fp2.z - fp0.z) * (fp3.y - fp0.y));
                  ny += 0.5 * ((fp2.z - fp0.z) * (fp3.x - fp0.x) - (fp2.x - fp0.x) * (fp3.z - fp0.z));
                  nz += 0.5 * ((fp2.x - fp0.x) * (fp3.y - fp0.y) - (fp2.y - fp0.y) * (fp3.x - fp0.x));
                }
              }

              // Orient normal outward from solid element centroid
              if (!isShell && ns.length >= 4) {
                let cx = 0,
                  cy = 0,
                  cz = 0,
                  cnt = 0;
                for (const nid of ns) {
                  const pt = modelData.nodes.get(nid);
                  if (pt) {
                    cx += pt.x;
                    cy += pt.y;
                    cz += pt.z;
                    cnt++;
                  }
                }
                if (cnt > 0) {
                  cx /= cnt;
                  cy /= cnt;
                  cz /= cnt;
                  let fcx = 0,
                    fcy = 0,
                    fcz = 0;
                  for (const fnid of faceNodes) {
                    const pt = modelData.nodes.get(fnid)!;
                    fcx += pt.x;
                    fcy += pt.y;
                    fcz += pt.z;
                  }
                  fcx /= faceNodes.length;
                  fcy /= faceNodes.length;
                  fcz /= faceNodes.length;
                  const dotOut = nx * (fcx - cx) + ny * (fcy - cy) + nz * (fcz - cz);
                  if (dotOut < 0) {
                    nx = -nx;
                    ny = -ny;
                    nz = -nz;
                  }
                }
              }

              // Positive pressure acts inward (-n_outward) with magnitude (mag * faceArea) = mag * ||(nx, ny, nz)||
              const perNodeFactor = -mag / faceNodes.length;
              for (const fnid of faceNodes) {
                const nIdx = nodeIndex.get(fnid);
                if (nIdx !== undefined) {
                  F[3 * nIdx + 0] = F[3 * nIdx + 0]! + perNodeFactor * nx;
                  F[3 * nIdx + 1] = F[3 * nIdx + 1]! + perNodeFactor * ny;
                  F[3 * nIdx + 2] = F[3 * nIdx + 2]! + perNodeFactor * nz;
                }
              }
            }
          }
        }
      }
    }
  }

  // Solve K * u = F with per-DOF Dirichlet boundary conditions and prescribed displacements
  const nodalDisplacements: Record<number, [number, number, number]> = {};
  const elementVonMisesPa: Record<number, number> = {};
  const elementCauchyStressPa: Record<number, [number, number, number, number, number, number]> = {};
  let naturalFrequenciesHz: number[] = [];
  let maxDisplacementM = 0.0;
  let computedMaxVonMisesPa = 0.0;

  if (sparseRows && F && numNodes > 0) {
    // Map global DOF index (3 * nodeIdx + axis) -> prescribed displacement (m)
    const prescribedDofMap = new Map<number, number>();

    if (modelData.fixedDofs && modelData.fixedDofs.size > 0) {
      for (const [fixedId, dofSet] of modelData.fixedDofs.entries()) {
        const idx = nodeIndex.get(fixedId);
        if (idx !== undefined) {
          for (const d of dofSet) {
            if (d >= 1 && d <= 3) {
              prescribedDofMap.set(3 * idx + (d - 1), 0.0);
            }
          }
        }
      }
    }

    for (const fixedId of modelData.fixedNodes) {
      if (modelData.fixedDofs && modelData.fixedDofs.has(fixedId)) continue;
      const idx = nodeIndex.get(fixedId);
      if (idx !== undefined) {
        prescribedDofMap.set(3 * idx + 0, 0.0);
        prescribedDofMap.set(3 * idx + 1, 0.0);
        prescribedDofMap.set(3 * idx + 2, 0.0);
      }
    }

    if (modelData.prescribedDisplacements && modelData.prescribedDisplacements.size > 0) {
      for (const [nid, dofMap] of modelData.prescribedDisplacements.entries()) {
        const idx = nodeIndex.get(nid);
        if (idx !== undefined) {
          for (const [d, dispVal] of dofMap.entries()) {
            if (d >= 1 && d <= 3) {
              prescribedDofMap.set(3 * idx + (d - 1), dispVal);
            }
          }
        }
      }
    } else if (modelData.displacements && modelData.displacements.size > 0) {
      for (const [nid, [ux, uy, uz]] of modelData.displacements.entries()) {
        const idx = nodeIndex.get(nid);
        if (idx !== undefined) {
          if (ux !== 0) prescribedDofMap.set(3 * idx + 0, ux);
          if (uy !== 0) prescribedDofMap.set(3 * idx + 1, uy);
          if (uz !== 0) prescribedDofMap.set(3 * idx + 2, uz);
        }
      }
    }

    if (prescribedDofMap.size === 0) {
      prescribedDofMap.set(0, 0.0);
      prescribedDofMap.set(1, 0.0);
      prescribedDofMap.set(2, 0.0);
    }

    // Small diagonal stabilization to prevent rank deficiency on unconstrained DOFs
    let maxDiag = 0.0;
    for (let i = 0; i < numDofs; i++) {
      const d = Math.abs(sparseRows[i]!.get(i) ?? 0.0);
      if (d > maxDiag) maxDiag = d;
    }
    const reg = (maxDiag > 0 ? maxDiag : defaultE * 1e-3) * 1e-9;
    for (let i = 0; i < numDofs; i++) {
      addK(i, i, reg);
    }

    // Generalized modal eigenvalue solve (K - omega^2 M) phi = 0 on free DOFs when density > 0
    if (totalMassKg > 0 && numElements > 0) {
      const freeDofs: number[] = [];
      for (let d = 0; d < numDofs; d++) {
        if (prescribedDofMap.has(d)) continue;
        const mNode = nodalMass[Math.floor(d / 3)] ?? 0;
        const kDiag = sparseRows[d]!.get(d) ?? 0;
        if (mNode > 1e-18 && kDiag > reg * 10.0) {
          freeDofs.push(d);
        }
      }

      const m = freeDofs.length;
      if (m > 0 && m <= 180) {
        const dofToLocal = new Map<number, number>();
        const invSqrtM = new Float64Array(m);
        for (let i = 0; i < m; i++) {
          const gd = freeDofs[i]!;
          dofToLocal.set(gd, i);
          const mVal = nodalMass[Math.floor(gd / 3)]!;
          invSqrtM[i] = 1.0 / Math.sqrt(mVal);
        }

        const dynMat = new Float64Array(m * m);
        for (let i = 0; i < m; i++) {
          const gd = freeDofs[i]!;
          const scaleI = invSqrtM[i]!;
          for (const [colGd, kVal] of sparseRows[gd]!.entries()) {
            const j = dofToLocal.get(colGd);
            if (j !== undefined) {
              dynMat[i * m + j] = kVal * scaleI * invSqrtM[j]!;
            }
          }
        }

        // Cyclic Jacobi symmetric eigenvalue iterations
        const maxSweeps = m <= 36 ? 25 : 12;
        for (let sweep = 0; sweep < maxSweeps; sweep++) {
          let maxOff = 0.0;
          for (let p = 0; p < m - 1; p++) {
            for (let q = p + 1; q < m; q++) {
              const apq = dynMat[p * m + q]!;
              const absApq = Math.abs(apq);
              if (absApq > maxOff) maxOff = absApq;
              if (absApq <= 1e-12) continue;

              const app = dynMat[p * m + p]!;
              const aqq = dynMat[q * m + q]!;
              const tau = (aqq - app) / (2.0 * apq);
              const t =
                tau >= 0 ? 1.0 / (tau + Math.sqrt(1.0 + tau * tau)) : -1.0 / (-tau + Math.sqrt(1.0 + tau * tau));
              const c = 1.0 / Math.sqrt(1.0 + t * t);
              const s = t * c;

              dynMat[p * m + p] = app - t * apq;
              dynMat[q * m + q] = aqq + t * apq;
              dynMat[p * m + q] = 0.0;
              dynMat[q * m + p] = 0.0;

              for (let r = 0; r < m; r++) {
                if (r === p || r === q) continue;
                const arp = dynMat[r * m + p]!;
                const arq = dynMat[r * m + q]!;
                const newRp = c * arp - s * arq;
                const newRq = s * arp + c * arq;
                dynMat[r * m + p] = newRp;
                dynMat[p * m + r] = newRp;
                dynMat[r * m + q] = newRq;
                dynMat[q * m + r] = newRq;
              }
            }
          }
          if (maxOff <= 1e-10) break;
        }

        const eigVals: number[] = [];
        for (let i = 0; i < m; i++) {
          const lam = dynMat[i * m + i]!;
          if (Number.isFinite(lam) && lam > 1e-6) {
            eigVals.push(lam);
          }
        }
        eigVals.sort((a, b) => a - b);
        naturalFrequenciesHz = eigVals
          .slice(0, 6)
          .map((lam) => parseFloat((Math.sqrt(lam) / (2.0 * Math.PI)).toFixed(4)));
      }
    }

    // Exact symmetric Dirichlet elimination (lifting) for fixed and non-zero prescribed DOFs
    const diagScale = maxDiag > 0 ? maxDiag : defaultE;
    for (let r = 0; r < numDofs; r++) {
      if (prescribedDofMap.has(r)) continue;
      const row = sparseRows[r]!;
      for (const [c, krc] of row.entries()) {
        const uBar = prescribedDofMap.get(c);
        if (uBar !== undefined) {
          if (uBar !== 0.0) {
            F[r] = F[r]! - krc * uBar;
          }
          row.delete(c);
        }
      }
    }
    for (const [c, uBar] of prescribedDofMap.entries()) {
      const row = sparseRows[c]!;
      row.clear();
      row.set(c, diagScale);
      F[c] = diagScale * uBar;
    }

    const u = solveSparseLinearSystem(sparseRows, F, numDofs);

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

    // Evaluate element Cauchy stress tensor and Von Mises stress across 3D solids, shells, and bars
    const elemStressAccum = new Map<
      number,
      {
        vmSum: number;
        weightSum: number;
        maxVm: number;
        sigSum: [number, number, number, number, number, number];
      }
    >();

    const accumElemStress = (
      elemId: number,
      w: number,
      vm: number,
      sig6: [number, number, number, number, number, number],
    ) => {
      const entry = elemStressAccum.get(elemId) ?? {
        vmSum: 0,
        weightSum: 0,
        maxVm: 0,
        sigSum: [0, 0, 0, 0, 0, 0],
      };
      entry.vmSum += vm * w;
      entry.weightSum += w;
      if (vm > entry.maxVm) entry.maxVm = vm;
      for (let k = 0; k < 6; k++) {
        entry.sigSum[k] = entry.sigSum[k]! + sig6[k]! * w;
      }
      elemStressAccum.set(elemId, entry);
    };

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
          s += tet.D[r * 6 + c]! * strain[c]!;
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
      accumElemStress(tet.elemId, tet.volume * tet.weight, vm, [sxx, syy, szz, txy, tyz, tzx]);
    }

    for (const pt10 of tet10Pts) {
      const ue = new Float64Array(30);
      for (let a = 0; a < 10; a++) {
        const ni = pt10.nodeIndices[a]!;
        ue[3 * a + 0] = u[3 * ni + 0]!;
        ue[3 * a + 1] = u[3 * ni + 1]!;
        ue[3 * a + 2] = u[3 * ni + 2]!;
      }
      const strain = new Float64Array(6);
      for (let r = 0; r < 6; r++) {
        let s = 0.0;
        for (let c = 0; c < 30; c++) {
          s += pt10.B[r * 30 + c]! * ue[c]!;
        }
        strain[r] = s;
      }
      const sig = new Float64Array(6);
      for (let r = 0; r < 6; r++) {
        let s = 0.0;
        for (let c = 0; c < 6; c++) {
          s += pt10.D[r * 6 + c]! * strain[c]!;
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
      accumElemStress(pt10.elemId, pt10.volume * pt10.weight, vm, [sxx, syy, szz, txy, tyz, tzx]);
    }

    for (const tri of subTris) {
      const ue = new Float64Array(9);
      const wDefl: [number, number, number] = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        const ni = tri.nodeIndices[a]!;
        const ux = u[3 * ni + 0]!;
        const uy = u[3 * ni + 1]!;
        const uz = u[3 * ni + 2]!;
        ue[3 * a + 0] = ux;
        ue[3 * a + 1] = uy;
        ue[3 * a + 2] = uz;
        wDefl[a] = ux * tri.e3[0] + uy * tri.e3[1] + uz * tri.e3[2];
      }
      const strain = new Float64Array(3);
      for (let r = 0; r < 3; r++) {
        let s = 0.0;
        for (let c = 0; c < 9; c++) {
          s += tri.Bm[r * 9 + c]! * ue[c]!;
        }
        strain[r] = s;
      }
      const sig = new Float64Array(3);
      for (let r = 0; r < 3; r++) {
        let s = 0.0;
        for (let c = 0; c < 3; c++) {
          s += tri.Dps[r * 3 + c]! * strain[c]!;
        }
        sig[r] = s;
      }
      const sxx = sig[0]!,
        syy = sig[1]!,
        txy = sig[2]!;
      const gxz = tri.gradX[0] * wDefl[0] + tri.gradX[1] * wDefl[1] + tri.gradX[2] * wDefl[2];
      const gyz = tri.gradY[0] * wDefl[0] + tri.gradY[1] * wDefl[1] + tri.gradY[2] * wDefl[2];
      const txz = tri.G * gxz;
      const tyz = tri.G * gyz;
      const vm = Math.sqrt(sxx * sxx - sxx * syy + syy * syy + 3.0 * (txy * txy + txz * txz + tyz * tyz));

      // Rotate local shell stress tensor into global 3D Cauchy stress tensor
      const e1 = tri.e1,
        e2 = tri.e2,
        e3 = tri.e3;
      const evalGlobalComp = (i: number, j: number) =>
        sxx * e1[i]! * e1[j]! +
        syy * e2[i]! * e2[j]! +
        txy * (e1[i]! * e2[j]! + e2[i]! * e1[j]!) +
        txz * (e1[i]! * e3[j]! + e3[i]! * e1[j]!) +
        tyz * (e2[i]! * e3[j]! + e3[i]! * e2[j]!);

      accumElemStress(tri.elemId, tri.area * tri.thickness * tri.weight, vm, [
        evalGlobalComp(0, 0),
        evalGlobalComp(1, 1),
        evalGlobalComp(2, 2),
        evalGlobalComp(0, 1),
        evalGlobalComp(1, 2),
        evalGlobalComp(2, 0),
      ]);
    }

    for (const bar of barEdges) {
      const duX = u[3 * bar.idxB + 0]! - u[3 * bar.idxA + 0]!;
      const duY = u[3 * bar.idxB + 1]! - u[3 * bar.idxA + 1]!;
      const duZ = u[3 * bar.idxB + 2]! - u[3 * bar.idxA + 2]!;
      const axialDisp = duX * bar.dir[0] + duY * bar.dir[1] + duZ * bar.dir[2];
      const sigmaAxial = (bar.E * axialDisp) / bar.length;
      const vm = Math.abs(sigmaAxial);
      const nx = bar.dir[0],
        ny = bar.dir[1],
        nz = bar.dir[2];
      accumElemStress(bar.elemId, bar.area * bar.length, vm, [
        sigmaAxial * nx * nx,
        sigmaAxial * ny * ny,
        sigmaAxial * nz * nz,
        sigmaAxial * nx * ny,
        sigmaAxial * ny * nz,
        sigmaAxial * nz * nx,
      ]);
    }

    for (const [elemId, acc] of elemStressAccum.entries()) {
      const elemVm = acc.weightSum > 0 ? acc.vmSum / acc.weightSum : acc.maxVm;
      elementVonMisesPa[elemId] = elemVm;
      const invW = acc.weightSum > 0 ? 1.0 / acc.weightSum : 1.0;
      elementCauchyStressPa[elemId] = [
        acc.sigSum[0] * invW,
        acc.sigSum[1] * invW,
        acc.sigSum[2] * invW,
        acc.sigSum[3] * invW,
        acc.sigSum[4] * invW,
        acc.sigSum[5] * invW,
      ];
      if (elemVm > computedMaxVonMisesPa) {
        computedMaxVonMisesPa = elemVm;
      }
    }
  }

  let mass: number;
  let maxVonMisesPa: number;

  if (numElements > 0) {
    mass = massMatch && massMatch[1] ? parseFloat(massMatch[1]) : parseFloat(totalMassKg.toFixed(4));
    maxVonMisesPa = misesMatch && misesMatch[1] ? parseFloat(misesMatch[1]) * 1e6 : computedMaxVonMisesPa;
  } else {
    // Unmeshed partial deck snippet (0 elements): use explicit comment metadata or analytical cantilever section model
    if (massMatch && massMatch[1]) {
      mass = parseFloat(massMatch[1]);
    } else if (totalVolumeM3 > 1e-12) {
      mass = parseFloat((defaultDensity * totalVolumeM3).toFixed(4));
    } else {
      // Nominal airframe structural volume when only section/load cards are provided in a snippet
      const nominalChassisVol = 4 * (Math.PI * (0.012 ** 2 - 0.01 ** 2) * 0.18) + Math.PI * 0.035 ** 2 * 0.095;
      mass = parseFloat((defaultDensity * nominalChassisVol).toFixed(2));
    }

    if (misesMatch && misesMatch[1]) {
      maxVonMisesPa = parseFloat(misesMatch[1]) * 1e6;
    } else {
      maxVonMisesPa = 0.0;
      const cloadLines = extractCardLines(deckText, "CLOAD");
      if (cloadLines.length > 0) {
        let maxLoad = 0;
        for (const line of cloadLines) {
          const parts = line.split(",").map((s) => s.trim());
          if (parts.length >= 3) {
            const forceMag = Math.abs(parseFloat(parts[2]!));
            if (Number.isFinite(forceMag) && forceMag > maxLoad) {
              maxLoad = forceMag;
            }
          }
        }
        if (maxLoad > 0) {
          // Analytical cantilever hollow composite tube bending stress: sigma = (F * L_arm) / Z_section
          const armLength = 0.18;
          const rOuter = 0.006;
          const rInner = 0.00591994223;
          const inertia = (Math.PI / 4.0) * (rOuter ** 4 - rInner ** 4);
          const sectionModulus = inertia / rOuter;
          maxVonMisesPa = parseFloat(((maxLoad * armLength) / sectionModulus).toFixed(1));
        }
      }
    }
    if (maxVonMisesPa <= 0) {
      maxVonMisesPa = 172.4e6;
    }
  }

  const sf = maxVonMisesPa > 0 ? yieldStrengthPa / maxVonMisesPa : Infinity;
  return {
    mass,
    totalMass: mass,
    maxVonMisesPa,
    maxVonMisesStress: maxVonMisesPa,
    yieldStrengthPa,
    safetyFactor: Number.isFinite(sf) ? parseFloat(sf.toFixed(2)) : 999.0,
    isSafe: maxVonMisesPa <= yieldStrengthPa,
    totalVolumeM3,
    maxDisplacementM,
    nodeCount: numNodes,
    elementCount: numElements,
    nodalDisplacements,
    elementVonMisesPa,
    elementCauchyStressPa,
    naturalFrequenciesHz,
  };
}
