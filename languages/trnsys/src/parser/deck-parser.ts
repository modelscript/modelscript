// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  TrnsysAssignCard,
  TrnsysAssignment,
  TrnsysDeck,
  TrnsysEquationBlock,
  TrnsysInputConnection,
  TrnsysParseError,
  TrnsysUnit,
  TrnsysValue,
} from "../types.js";

/**
 * Evaluates a simple arithmetic expression in TRNSYS CONSTANTS / EQUATIONS
 * given already-known numeric symbols.
 */
export function evaluateTrnsysExpression(expr: string, env: ReadonlyMap<string, number>): number | undefined {
  const trimmed = expr.trim();
  if (!trimmed) return undefined;

  // Replace known functions & identifiers with numeric values for safe recursive-descent evaluation
  const tokens = tokenizeExpr(trimmed);
  if (!tokens) return undefined;
  let pos = 0;

  function peek(): ExprToken | undefined {
    return tokens?.[pos];
  }
  function consume(): ExprToken | undefined {
    const t = tokens?.[pos];
    pos++;
    return t;
  }

  function parseAddSub(): number | undefined {
    let left = parseMulDiv();
    if (left === undefined) return undefined;
    while (true) {
      const tok = peek();
      if (tok && tok.kind === "op" && (tok.value === "+" || tok.value === "-")) {
        consume();
        const right = parseMulDiv();
        if (right === undefined) return undefined;
        left = tok.value === "+" ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  }

  function parseMulDiv(): number | undefined {
    let left = parsePower();
    if (left === undefined) return undefined;
    while (true) {
      const tok = peek();
      if (tok && tok.kind === "op" && (tok.value === "*" || tok.value === "/")) {
        consume();
        const right = parsePower();
        if (right === undefined) return undefined;
        left = tok.value === "*" ? left * right : right !== 0 ? left / right : NaN;
      } else {
        break;
      }
    }
    return left;
  }

  function parsePower(): number | undefined {
    const base = parseUnary();
    if (base === undefined) return undefined;
    const tok = peek();
    if (tok && tok.kind === "op" && tok.value === "^") {
      consume();
      const exp = parsePower();
      if (exp === undefined) return undefined;
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary(): number | undefined {
    const tok = peek();
    if (tok && tok.kind === "op" && (tok.value === "+" || tok.value === "-")) {
      consume();
      const v = parseUnary();
      if (v === undefined) return undefined;
      return tok.value === "-" ? -v : v;
    }
    return parsePrimary();
  }

  function parsePrimary(): number | undefined {
    const tok = peek();
    if (!tok) return undefined;
    if (tok.kind === "num") {
      consume();
      return tok.num;
    }
    if (tok.kind === "lparen") {
      consume();
      const v = parseAddSub();
      const close = consume();
      if (v === undefined || !close || close.kind !== "rparen") return undefined;
      return v;
    }
    if (tok.kind === "ident") {
      consume();
      const upper = tok.value.toUpperCase();
      // Function call: SIN(...), COS(...), MAX(a,b), MIN(a,b), ABS(...), EXP(...), LN(...), SQRT(...), GT(a,b), LT(a,b), GE(a,b), LE(a,b), EQL(a,b)
      if (peek()?.kind === "lparen") {
        consume();
        const args: number[] = [];
        if (peek()?.kind !== "rparen") {
          while (true) {
            const arg = parseAddSub();
            if (arg === undefined) return undefined;
            args.push(arg);
            if (peek()?.kind === "comma") {
              consume();
              continue;
            }
            break;
          }
        }
        const close = consume();
        if (!close || close.kind !== "rparen") return undefined;
        return evalBuiltinFn(upper, args);
      }
      if (upper === "PI") return Math.PI;
      return env.get(upper);
    }
    return undefined;
  }

  const res = parseAddSub();
  if (res === undefined || pos !== tokens.length || !Number.isFinite(res)) return undefined;
  return res;
}

type ExprToken =
  | { kind: "num"; num: number }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: string }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" };

function tokenizeExpr(input: string): ExprToken[] | undefined {
  const out: ExprToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      out.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      out.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (ch === ",") {
      out.push({ kind: "comma" });
      i++;
      continue;
    }
    if (ch === "*" && input[i + 1] === "*") {
      out.push({ kind: "op", value: "^" });
      i += 2;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      out.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = input.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/);
      if (!m) return undefined;
      const num = Number(m[0].replace(/[dD]/, "e"));
      out.push({ kind: "num", num });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = input.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!m) return undefined;
      out.push({ kind: "ident", value: m[0] });
      i += m[0].length;
      continue;
    }
    return undefined;
  }
  return out;
}

function evalBuiltinFn(name: string, args: number[]): number | undefined {
  const a0 = args[0];
  const a1 = args[1];
  switch (name) {
    case "ABS":
      return a0 !== undefined ? Math.abs(a0) : undefined;
    case "SQRT":
      return a0 !== undefined ? Math.sqrt(Math.max(0, a0)) : undefined;
    case "EXP":
      return a0 !== undefined ? Math.exp(a0) : undefined;
    case "LN":
    case "LOG":
      return a0 !== undefined && a0 > 0 ? Math.log(a0) : undefined;
    case "SIN":
      return a0 !== undefined ? Math.sin(a0) : undefined;
    case "COS":
      return a0 !== undefined ? Math.cos(a0) : undefined;
    case "TAN":
      return a0 !== undefined ? Math.tan(a0) : undefined;
    case "MAX":
      return args.length > 0 ? Math.max(...args) : undefined;
    case "MIN":
      return args.length > 0 ? Math.min(...args) : undefined;
    case "GT":
      return a0 !== undefined && a1 !== undefined ? (a0 > a1 ? 1 : 0) : undefined;
    case "GE":
      return a0 !== undefined && a1 !== undefined ? (a0 >= a1 ? 1 : 0) : undefined;
    case "LT":
      return a0 !== undefined && a1 !== undefined ? (a0 < a1 ? 1 : 0) : undefined;
    case "LE":
      return a0 !== undefined && a1 !== undefined ? (a0 <= a1 ? 1 : 0) : undefined;
    case "EQL":
      return a0 !== undefined && a1 !== undefined ? (Math.abs(a0 - a1) < 1e-12 ? 1 : 0) : undefined;
    case "AND":
      return a0 !== undefined && a1 !== undefined ? (a0 > 0.5 && a1 > 0.5 ? 1 : 0) : undefined;
    case "OR":
      return a0 !== undefined && a1 !== undefined ? (a0 > 0.5 || a1 > 0.5 ? 1 : 0) : undefined;
    case "NOT":
      return a0 !== undefined ? (a0 > 0.5 ? 0 : 1) : undefined;
    default:
      return undefined;
  }
}

export const TRNSYS_BUILTIN_FUNCS = new Set([
  "ABS",
  "SQRT",
  "EXP",
  "LN",
  "LOG",
  "SIN",
  "COS",
  "TAN",
  "MAX",
  "MIN",
  "GT",
  "GE",
  "LT",
  "LE",
  "EQL",
  "AND",
  "OR",
  "NOT",
  "TIME",
  "START",
  "STOP",
  "STEP",
  "PI",
]);

/**
 * Extracts identifier references from a TRNSYS expression (excluding numeric literals and built-in function names).
 */
export function extractExpressionIdentifiers(expr: string): string[] {
  const out: string[] = [];
  const regex = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(expr)) !== null) {
    const id = m[1]!;
    if (!TRNSYS_BUILTIN_FUNCS.has(id.toUpperCase())) {
      out.push(id);
    }
  }
  return out;
}

function stripInlineComment(line: string): string {
  let inQuotes = false;
  let quoteChar = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
      continue;
    }
    if (ch === "!") {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseValueToken(tok: string, env: ReadonlyMap<string, number>): TrnsysValue {
  const num = Number(tok.replace(/[dD]/, "e"));
  if (tok.length > 0 && Number.isFinite(num)) {
    return { kind: "number", value: num, raw: tok };
  }
  const upper = tok.toUpperCase();
  const envVal = env.get(upper);
  if (envVal !== undefined) {
    return { kind: "number", value: envVal, raw: tok };
  }
  return { kind: "variable", name: tok, raw: tok };
}

function parseInputToken(tok: string, line: number, env: ReadonlyMap<string, number>): TrnsysInputConnection {
  const connMatch = tok.match(/^(\d+)\s*,\s*(\d+)$/);
  if (connMatch) {
    const unitNum = Number(connMatch[1]!);
    const outIdx = Number(connMatch[2]!);
    if (unitNum === 0 && outIdx === 0) {
      return { kind: "constant", value: 0, raw: tok, line };
    }
    return { kind: "connection", unitNumber: unitNum, outputIndex: outIdx, raw: tok, line };
  }
  const num = Number(tok.replace(/[dD]/, "e"));
  if (tok.length > 0 && Number.isFinite(num)) {
    return { kind: "constant", value: num, raw: tok, line };
  }
  const upper = tok.toUpperCase();
  const envVal = env.get(upper);
  if (envVal !== undefined) {
    return { kind: "constant", value: envVal, raw: tok, line };
  }
  return { kind: "variable", name: tok, raw: tok, line };
}

type ActiveSection =
  | { kind: "none" }
  | { kind: "constants"; remaining: number }
  | { kind: "equations"; block: TrnsysEquationBlock; remaining: number }
  | { kind: "parameters"; unit: TrnsysUnit; expected: number }
  | { kind: "inputs"; unit: TrnsysUnit; expected: number; stage: "connections" | "initials" }
  | { kind: "derivatives"; unit: TrnsysUnit; expected: number }
  | { kind: "labels"; unit: TrnsysUnit; expected: number };

const CONTROL_KEYWORD_RE =
  /^(?:VERSION|CONSTANTS|EQUATIONS|SIMULATION|TOLERANCES|LIMITS|DFQ|WIDTH|LIST|NOLIST|MAP|UNIT|PARAMETERS|INPUTS|DERIVATIVES|LABELS|ASSIGN|END)\b/i;

/**
 * Parses a TRNSYS `.dck` simulation deck into a structured `TrnsysDeck` IR.
 */
export function parseTrnsysDeck(source: string, deckName: string = "TrnsysDeck"): TrnsysDeck {
  const rawLines = source.split(/\r?\n/);
  const env = new Map<string, number>();

  const constants: TrnsysAssignment[] = [];
  const equationBlocks: TrnsysEquationBlock[] = [];
  const units: TrnsysUnit[] = [];
  const assigns: TrnsysAssignCard[] = [];
  const parseErrors: TrnsysParseError[] = [];

  let version: number | undefined;
  let simulation: TrnsysDeck["simulation"];
  let tolerances: TrnsysDeck["tolerances"];
  let limits: TrnsysDeck["limits"];
  let dfq: number | undefined;
  let width: number | undefined;
  let listMode: "LIST" | "NOLIST" | undefined;
  let map: boolean | undefined;
  let hasEnd = false;

  let currentUnit: TrnsysUnit | undefined;
  let section: ActiveSection = { kind: "none" };
  let offset = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i]!;
    const lineNum = i + 1;
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    offset = lineEnd + 1;

    const trimmedRaw = rawLine.trim();
    if (!trimmedRaw || trimmedRaw.startsWith("*") || trimmedRaw.startsWith("!")) {
      continue;
    }

    const cleaned = stripInlineComment(rawLine).trim();
    if (!cleaned) continue;

    // Check if this line starts a new control card
    if (CONTROL_KEYWORD_RE.test(cleaned)) {
      // Close previous unit endOffset if starting a new UNIT or END
      const kwMatch = cleaned.match(/^([A-Za-z]+)\b(.*)$/);
      const kw = kwMatch ? kwMatch[1]!.toUpperCase() : "";
      const rest = kwMatch ? kwMatch[2]!.trim() : "";

      // Reset section before handling new control card
      section = { kind: "none" };

      switch (kw) {
        case "VERSION": {
          const v = Number(rest.split(/\s+/)[0]);
          if (Number.isFinite(v)) {
            version = v;
          } else {
            parseErrors.push({ message: `Invalid VERSION number '${rest}'`, line: lineNum, column: 1 });
          }
          continue;
        }

        case "SIMULATION": {
          const parts = rest.split(/[\s,]+/).filter(Boolean);
          if (parts.length < 3) {
            parseErrors.push({
              message: `SIMULATION card requires 3 arguments (tStart tStop dt), found ${parts.length}`,
              line: lineNum,
              column: 1,
            });
            continue;
          }
          const tStart = resolveNumericArg(parts[0]!, env);
          const tStop = resolveNumericArg(parts[1]!, env);
          const dt = resolveNumericArg(parts[2]!, env);
          if (tStart === undefined || tStop === undefined || dt === undefined) {
            parseErrors.push({
              message: `Invalid numeric argument in SIMULATION card '${rest}'`,
              line: lineNum,
              column: 1,
            });
            continue;
          }
          simulation = { tStart, tStop, dt, line: lineNum };
          env.set("START", tStart);
          env.set("STOP", tStop);
          env.set("STEP", dt);
          continue;
        }

        case "TOLERANCES": {
          const parts = rest.split(/[\s,]+/).filter(Boolean);
          const integration = resolveNumericArg(parts[0] ?? "", env);
          const convergence = resolveNumericArg(parts[1] ?? "", env);
          if (integration === undefined || convergence === undefined) {
            parseErrors.push({ message: `TOLERANCES requires 2 numeric arguments`, line: lineNum, column: 1 });
            continue;
          }
          tolerances = { integration, convergence, line: lineNum };
          continue;
        }

        case "LIMITS": {
          const parts = rest.split(/[\s,]+/).filter(Boolean);
          const maxIterations = resolveNumericArg(parts[0] ?? "", env);
          const maxWarnings = resolveNumericArg(parts[1] ?? "", env);
          const traceLimit = parts[2] ? resolveNumericArg(parts[2], env) : undefined;
          if (maxIterations === undefined || maxWarnings === undefined) {
            parseErrors.push({ message: `LIMITS requires at least 2 numeric arguments`, line: lineNum, column: 1 });
            continue;
          }
          limits = { maxIterations, maxWarnings, traceLimit, line: lineNum };
          continue;
        }

        case "DFQ": {
          const v = Number(rest.split(/\s+/)[0]);
          if (Number.isFinite(v)) dfq = v;
          else parseErrors.push({ message: `Invalid DFQ method '${rest}'`, line: lineNum, column: 1 });
          continue;
        }

        case "WIDTH": {
          const v = Number(rest.split(/\s+/)[0]);
          if (Number.isFinite(v)) width = v;
          else parseErrors.push({ message: `Invalid WIDTH value '${rest}'`, line: lineNum, column: 1 });
          continue;
        }

        case "LIST": {
          listMode = "LIST";
          continue;
        }

        case "NOLIST": {
          listMode = "NOLIST";
          continue;
        }

        case "MAP": {
          map = true;
          continue;
        }

        case "CONSTANTS": {
          const n = Number(rest.split(/\s+/)[0]);
          if (!Number.isInteger(n) || n < 0) {
            parseErrors.push({ message: `Invalid CONSTANTS count '${rest}'`, line: lineNum, column: 1 });
            continue;
          }
          section = { kind: "constants", remaining: n };
          continue;
        }

        case "EQUATIONS": {
          const n = Number(rest.split(/\s+/)[0]);
          if (!Number.isInteger(n) || n < 0) {
            parseErrors.push({ message: `Invalid EQUATIONS count '${rest}'`, line: lineNum, column: 1 });
            continue;
          }
          const block: TrnsysEquationBlock = { declaredCount: n, equations: [], line: lineNum };
          equationBlocks.push(block);
          section = { kind: "equations", block, remaining: n };
          continue;
        }

        case "UNIT": {
          if (currentUnit) {
            currentUnit.endOffset = lineStart;
          }
          const m = rest.match(/^(\d+)\s+TYPE\s+(\d+)(?:\s+(.*))?$/i);
          if (!m) {
            parseErrors.push({ message: `Malformed UNIT header: '${cleaned}'`, line: lineNum, column: 1 });
            currentUnit = undefined;
            continue;
          }
          const unitNumber = Number(m[1]!);
          const typeNumber = Number(m[2]!);
          const label = m[3]?.trim() || undefined;
          const unit: TrnsysUnit = {
            unitNumber,
            typeNumber,
            label,
            parameters: [],
            inputs: [],
            initialInputs: [],
            derivatives: [],
            labels: [],
            line: lineNum,
            startOffset: lineStart,
            endOffset: lineEnd,
          };
          units.push(unit);
          currentUnit = unit;
          continue;
        }

        case "PARAMETERS": {
          if (!currentUnit) {
            parseErrors.push({ message: `PARAMETERS card found outside of a UNIT block`, line: lineNum, column: 1 });
            continue;
          }
          const n = Number(rest.split(/\s+/)[0]);
          if (!Number.isInteger(n) || n < 0) {
            parseErrors.push({ message: `Invalid PARAMETERS count '${rest}'`, line: lineNum, column: 1 });
            continue;
          }
          currentUnit.parametersDeclared = n;
          currentUnit.endOffset = lineEnd;
          section = { kind: "parameters", unit: currentUnit, expected: n };
          continue;
        }

        case "INPUTS": {
          if (!currentUnit) {
            parseErrors.push({ message: `INPUTS card found outside of a UNIT block`, line: lineNum, column: 1 });
            continue;
          }
          const n = Number(rest.split(/\s+/)[0]);
          if (!Number.isInteger(n) || n < 0) {
            parseErrors.push({ message: `Invalid INPUTS count '${rest}'`, line: lineNum, column: 1 });
            continue;
          }
          currentUnit.inputsDeclared = n;
          currentUnit.endOffset = lineEnd;
          section = { kind: "inputs", unit: currentUnit, expected: n, stage: "connections" };
          continue;
        }

        case "DERIVATIVES": {
          if (!currentUnit) {
            parseErrors.push({ message: `DERIVATIVES card found outside of a UNIT block`, line: lineNum, column: 1 });
            continue;
          }
          const n = Number(rest.split(/\s+/)[0]);
          if (!Number.isInteger(n) || n < 0) {
            parseErrors.push({ message: `Invalid DERIVATIVES count '${rest}'`, line: lineNum, column: 1 });
            continue;
          }
          currentUnit.derivativesDeclared = n;
          currentUnit.endOffset = lineEnd;
          section = { kind: "derivatives", unit: currentUnit, expected: n };
          continue;
        }

        case "LABELS": {
          if (!currentUnit) {
            parseErrors.push({ message: `LABELS card found outside of a UNIT block`, line: lineNum, column: 1 });
            continue;
          }
          const n = Number(rest.split(/\s+/)[0]);
          if (!Number.isInteger(n) || n < 0) {
            parseErrors.push({ message: `Invalid LABELS count '${rest}'`, line: lineNum, column: 1 });
            continue;
          }
          currentUnit.endOffset = lineEnd;
          section = { kind: "labels", unit: currentUnit, expected: n };
          continue;
        }

        case "ASSIGN": {
          // ASSIGN "filename.out" 30  or  ASSIGN filename.out 30
          const m = rest.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))\s+(\d+)/);
          if (!m) {
            parseErrors.push({ message: `Malformed ASSIGN card: '${cleaned}'`, line: lineNum, column: 1 });
            continue;
          }
          const filename = (m[1] ?? m[2] ?? m[3])!;
          const logicalUnit = Number(m[4]!);
          assigns.push({ filename, logicalUnit, line: lineNum });
          continue;
        }

        case "END": {
          if (currentUnit) {
            currentUnit.endOffset = lineStart;
          }
          hasEnd = true;
          section = { kind: "none" };
          continue;
        }
      }
    }

    // Handle data lines within active section
    switch (section.kind) {
      case "constants": {
        const eqIdx = cleaned.indexOf("=");
        if (eqIdx < 1) {
          parseErrors.push({
            message: `Expected constant assignment 'NAME = EXPR', got '${cleaned}'`,
            line: lineNum,
            column: 1,
          });
          continue;
        }
        const name = cleaned.slice(0, eqIdx).trim();
        const expression = cleaned.slice(eqIdx + 1).trim();
        const value = evaluateTrnsysExpression(expression, env);
        if (value !== undefined) {
          env.set(name.toUpperCase(), value);
        }
        constants.push({ name, expression, value, line: lineNum, startOffset: lineStart, endOffset: lineEnd });
        section.remaining--;
        if (section.remaining <= 0) section = { kind: "none" };
        break;
      }

      case "equations": {
        const eqIdx = cleaned.indexOf("=");
        if (eqIdx < 1) {
          parseErrors.push({
            message: `Expected equation assignment 'NAME = EXPR', got '${cleaned}'`,
            line: lineNum,
            column: 1,
          });
          continue;
        }
        const name = cleaned.slice(0, eqIdx).trim();
        const expression = cleaned.slice(eqIdx + 1).trim();
        const value = evaluateTrnsysExpression(expression, env);
        if (value !== undefined) {
          env.set(name.toUpperCase(), value);
        }
        section.block.equations.push({
          name,
          expression,
          value,
          line: lineNum,
          startOffset: lineStart,
          endOffset: lineEnd,
        });
        section.remaining--;
        if (section.remaining <= 0) section = { kind: "none" };
        break;
      }

      case "parameters": {
        const toks = cleaned.split(/\s+/).filter(Boolean);
        for (const tok of toks) {
          section.unit.parameters.push(parseValueToken(tok, env));
        }
        section.unit.endOffset = lineEnd;
        break;
      }

      case "inputs": {
        const toks = tokenizeInputLine(cleaned);
        const hasConnToken = toks.some((t) => /^\d+\s*,\s*\d+$/.test(t));
        if (section.stage === "connections" && section.unit.inputs.length > 0 && !hasConnToken) {
          section.stage = "initials";
        }
        if (section.stage === "connections") {
          for (const tok of toks) {
            section.unit.inputs.push(parseInputToken(tok, lineNum, env));
          }
          if (section.unit.inputs.length >= section.expected) {
            section.stage = "initials";
          }
        } else {
          for (const tok of toks) {
            section.unit.initialInputs.push(parseValueToken(tok, env));
          }
        }
        section.unit.endOffset = lineEnd;
        break;
      }

      case "derivatives": {
        const toks = cleaned.split(/\s+/).filter(Boolean);
        for (const tok of toks) {
          section.unit.derivatives.push(parseValueToken(tok, env));
        }
        section.unit.endOffset = lineEnd;
        break;
      }

      case "labels": {
        section.unit.labels.push(cleaned);
        section.unit.endOffset = lineEnd;
        if (section.unit.labels.length >= section.expected) {
          section = { kind: "none" };
        }
        break;
      }

      case "none": {
        parseErrors.push({
          message: `Unexpected statement outside control card: '${cleaned}'`,
          line: lineNum,
          column: 1,
        });
        break;
      }
    }
  }

  return {
    name: deckName,
    version,
    simulation,
    tolerances,
    limits,
    dfq,
    width,
    listMode,
    map,
    constants,
    equationBlocks,
    units,
    assigns,
    hasEnd,
    parseErrors,
  };
}

function resolveNumericArg(tok: string, env: ReadonlyMap<string, number>): number | undefined {
  if (!tok) return undefined;
  const num = Number(tok.replace(/[dD]/, "e"));
  if (Number.isFinite(num)) return num;
  return env.get(tok.toUpperCase());
}

/**
 * Tokenizes an INPUTS line while preserving `unit,output` pairs (e.g. `1,2` or `0,0`) as single tokens.
 */
function tokenizeInputLine(line: string): string[] {
  // Normalize spaces around commas inside `digit , digit` pairs so `1 , 2` stays `1,2`
  const normalized = line.replace(/(\d+)\s*,\s*(\d+)/g, "$1,$2");
  return normalized.split(/\s+/).filter(Boolean);
}
