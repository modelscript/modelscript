// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Structured parser for CPLEX LP and LINDO algebraic optimization formats.
 *
 * Supports:
 * - CPLEX LP (`Minimize`/`Maximize`, `Subject To`, `Bounds`, `Generals`, `Binaries`,
 *   `Semi-Continuous`, `SOS`, `End`, `\` comments, quadratic `[ ... ] / 2` terms)
 * - LINDO dialect (`MIN`/`MAX`, `ST`/`S.T.`, `!` comments, `<`/`>`, `TITLE`,
 *   `FREE`, `SLB`, `SUB`, `GIN`, `INT`, `END`)
 */

import type {
  ConstraintSense,
  CplexLpModel,
  LinearTerm,
  LpConstraint,
  LpDialect,
  LpObjective,
  LpParseError,
  LpSosConstraint,
  LpSosEntry,
  LpVariableBound,
  LpVariableInfo,
  ObjectiveSense,
  QuadraticExpression,
  QuadraticTerm,
  RawConstraintOperator,
  SourceLocation,
  VariableDomain,
} from "../types.js";

type SectionKind =
  "none" | "objective" | "constraints" | "bounds" | "generals" | "binaries" | "semi-continuous" | "sos" | "post-end";

interface RawLine {
  lineNumber: number; // 1-indexed
  startOffset: number;
  endOffset: number;
  raw: string;
  code: string;
  comment?: string | undefined;
}

const IDENT_RE = /^[A-Za-z_.$#@%&~][A-Za-z0-9_.$#@%&~()[\]]*/;
const SIMPLE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_.#$@%&~]*/;
const NUMBER_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

function splitLinesWithOffsets(source: string): RawLine[] {
  const result: RawLine[] = [];
  let offset = 0;
  let lineNumber = 1;
  const parts = source.split(/\r?\n/);
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i] ?? "";
    const startOffset = offset;
    const endOffset = offset + raw.length;
    // Detect comment (`\` for CPLEX LP, `!` for LINDO)
    let commentIdx = -1;
    for (let j = 0; j < raw.length; j++) {
      const ch = raw[j];
      if (ch === "\\" || ch === "!") {
        commentIdx = j;
        break;
      }
    }
    const code = commentIdx >= 0 ? raw.slice(0, commentIdx) : raw;
    const comment = commentIdx >= 0 ? raw.slice(commentIdx) : undefined;
    result.push({ lineNumber, startOffset, endOffset, raw, code, comment });
    // Advance past newline
    offset = endOffset + (source[endOffset] === "\r" && source[endOffset + 1] === "\n" ? 2 : 1);
    lineNumber++;
  }
  return result;
}

function makeLoc(line: number, column: number, startOffset: number, endOffset: number): SourceLocation {
  return { line, column, startOffset, endOffset };
}

interface SectionMatch {
  section: SectionKind;
  sense?: ObjectiveSense | undefined;
  remainder: string;
  isLindoHint?: boolean | undefined;
}

function matchSectionHeader(trimmed: string): SectionMatch | null {
  // Objective headers
  const objMatch = trimmed.match(/^(minimize|minimise|minimum|min|maximize|maximise|maximum|max)(?:\s+(.*)|$)/i);
  if (objMatch) {
    const kw = (objMatch[1] ?? "").toLowerCase();
    const rest = (objMatch[2] ?? "").trim();
    // Avoid matching a variable named "min_x" — regex already requires whitespace or EOL after keyword
    // Also ensure it's not a bound like "min <= 5" or "max = 10"
    if (!/^(?:<=|>=|<|>|=)/.test(rest)) {
      const sense: ObjectiveSense = kw.startsWith("min") ? "minimize" : "maximize";
      const isLindoHint = kw === "min" || kw === "max";
      return { section: "objective", sense, remainder: rest, isLindoHint };
    }
  }

  // Subject To / Such That / S.T. / ST
  const stMatch = trimmed.match(/^(subject\s+to|such\s+that|s\.t\.|st)(?:\s+(.*)|$)/i);
  if (stMatch) {
    const kw = (stMatch[1] ?? "").toLowerCase();
    const rest = (stMatch[2] ?? "").trim();
    if (!/^(?:<=|>=|<|>|=)/.test(rest)) {
      const isLindoHint = kw === "st" || kw === "s.t.";
      return { section: "constraints", remainder: rest, isLindoHint };
    }
  }

  // Bounds
  const boundsMatch = trimmed.match(/^(bounds?)(?:\s+(.*)|$)/i);
  if (boundsMatch) {
    const rest = (boundsMatch[2] ?? "").trim();
    if (!/^(?:<=|>=|<|>|=)/.test(rest)) {
      return { section: "bounds", remainder: rest };
    }
  }

  // Generals
  const genMatch = trimmed.match(/^(generals?|gen)(?:\s+(.*)|$)/i);
  if (genMatch) {
    const rest = (genMatch[2] ?? "").trim();
    if (!/^(?:<=|>=|<|>|=)/.test(rest)) {
      return { section: "generals", remainder: rest };
    }
  }

  // Binaries
  const binMatch = trimmed.match(/^(binaries|binary|bin)(?:\s+(.*)|$)/i);
  if (binMatch) {
    const rest = (binMatch[2] ?? "").trim();
    if (!/^(?:<=|>=|<|>|=)/.test(rest)) {
      return { section: "binaries", remainder: rest };
    }
  }

  // Semi-Continuous
  const semiMatch = trimmed.match(/^(semi-continuous|semis|semi)(?:\s+(.*)|$)/i);
  if (semiMatch) {
    const rest = (semiMatch[2] ?? "").trim();
    if (!/^(?:<=|>=|<|>|=)/.test(rest)) {
      return { section: "semi-continuous", remainder: rest };
    }
  }

  // SOS
  const sosMatch = trimmed.match(/^(sos)(?:\s+(.*)|$)/i);
  if (sosMatch) {
    const rest = (sosMatch[2] ?? "").trim();
    if (!/^(?:<=|>=|<|>|=)/.test(rest)) {
      return { section: "sos", remainder: rest };
    }
  }

  // End
  const endMatch = trimmed.match(/^end\b(?:\s+(.*)|$)/i);
  if (endMatch) {
    return { section: "post-end", remainder: (endMatch[1] ?? "").trim() };
  }

  return null;
}

function normalizeOperator(op: RawConstraintOperator): ConstraintSense {
  if (op === "<" || op === "<=") return "<=";
  if (op === ">" || op === ">=") return ">=";
  return "=";
}

function parseBoundNumber(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (s === "inf" || s === "+inf" || s === "infinity" || s === "+infinity") return Infinity;
  if (s === "-inf" || s === "-infinity") return -Infinity;
  const val = Number(s);
  return Number.isFinite(val) ? val : null;
}

interface ParsedLinearQuad {
  linearTerms: LinearTerm[];
  quadratic?: QuadraticExpression | undefined;
  constant: number;
  errors: LpParseError[];
}

function parseQuadraticBlock(
  blockText: string,
  outerSign: number,
  loc: SourceLocation,
): { terms: QuadraticTerm[]; errors: LpParseError[] } {
  const terms: QuadraticTerm[] = [];
  const errors: LpParseError[] = [];
  let pos = 0;
  const n = blockText.length;

  const skipWs = (): void => {
    while (pos < n && /\s/.test(blockText[pos] ?? "")) pos++;
  };

  while (pos < n) {
    skipWs();
    if (pos >= n) break;

    let sign = 1;
    if (blockText[pos] === "+") {
      sign = 1;
      pos++;
      skipWs();
    } else if (blockText[pos] === "-") {
      sign = -1;
      pos++;
      skipWs();
    }

    let coeff = 1;
    const numMatch = blockText.slice(pos).match(NUMBER_RE);
    if (numMatch) {
      coeff = Number(numMatch[0]);
      pos += numMatch[0].length;
      skipWs();
      if (blockText[pos] === "*") {
        pos++;
        skipWs();
      }
    }

    const v1Match = blockText.slice(pos).match(SIMPLE_IDENT_RE);
    if (!v1Match) {
      errors.push({
        message: `Expected variable name in quadratic block near '${blockText.slice(pos, pos + 16)}'`,
        location: loc,
      });
      break;
    }
    const var1 = v1Match[0];
    pos += var1.length;
    skipWs();

    let var2 = var1;
    if (blockText[pos] === "^") {
      pos++;
      skipWs();
      if (blockText[pos] === "2") {
        pos++;
      } else {
        errors.push({
          message: `Only exponent '^ 2' is supported in quadratic terms near '${var1}'`,
          location: loc,
        });
      }
    } else if (blockText[pos] === "*") {
      pos++;
      skipWs();
      const v2Match = blockText.slice(pos).match(SIMPLE_IDENT_RE);
      if (!v2Match) {
        errors.push({
          message: `Expected second variable after '*' in quadratic term near '${var1}'`,
          location: loc,
        });
        break;
      }
      var2 = v2Match[0];
      pos += var2.length;
    } else {
      errors.push({
        message: `Expected '^ 2' or '* var' in quadratic term after '${var1}'`,
        location: loc,
      });
    }

    terms.push({
      coeff: outerSign * sign * coeff,
      var1,
      var2,
      location: loc,
    });
  }

  return { terms, errors };
}

function parseExpression(text: string, loc: SourceLocation, allowConstant: boolean): ParsedLinearQuad {
  const linearTerms: LinearTerm[] = [];
  const quadTerms: QuadraticTerm[] = [];
  let quadDivisor = 2;
  let hasQuad = false;
  let constant = 0;
  const errors: LpParseError[] = [];

  let pos = 0;
  const n = text.length;

  const skipWs = (): void => {
    while (pos < n && /\s/.test(text[pos] ?? "")) pos++;
  };

  while (pos < n) {
    skipWs();
    if (pos >= n) break;

    let sign = 1;
    let sawSign = false;
    while (pos < n && (text[pos] === "+" || text[pos] === "-")) {
      if (text[pos] === "-") sign = -sign;
      sawSign = true;
      pos++;
      skipWs();
    }

    if (pos >= n) {
      if (sawSign) {
        errors.push({ message: "Trailing sign with no following term", location: loc });
      }
      break;
    }

    // Quadratic block: [ ... ] / 2
    if (text[pos] === "[") {
      const closeIdx = text.indexOf("]", pos + 1);
      if (closeIdx < 0) {
        errors.push({ message: "Unterminated quadratic block '[' (missing ']')", location: loc });
        break;
      }
      const inner = text.slice(pos + 1, closeIdx);
      const qRes = parseQuadraticBlock(inner, sign, loc);
      quadTerms.push(...qRes.terms);
      errors.push(...qRes.errors);
      hasQuad = true;
      pos = closeIdx + 1;
      skipWs();
      if (text[pos] === "/") {
        pos++;
        skipWs();
        const divMatch = text.slice(pos).match(NUMBER_RE);
        if (divMatch) {
          quadDivisor = Number(divMatch[0]);
          pos += divMatch[0].length;
        } else {
          errors.push({ message: "Expected numeric divisor after '/' in quadratic expression", location: loc });
        }
      } else {
        quadDivisor = 1;
      }
      continue;
    }

    // Optional numeric coefficient
    let coeff = 1;
    let sawNum = false;
    const numMatch = text.slice(pos).match(NUMBER_RE);
    if (numMatch) {
      coeff = Number(numMatch[0]);
      sawNum = true;
      pos += numMatch[0].length;
      skipWs();
      if (text[pos] === "*") {
        pos++;
        skipWs();
      }
    }

    // Variable identifier
    const identMatch = text.slice(pos).match(SIMPLE_IDENT_RE);
    if (identMatch) {
      const variable = identMatch[0];
      pos += variable.length;
      linearTerms.push({ coeff: sign * coeff, variable, location: loc });
      continue;
    }

    if (sawNum) {
      if (allowConstant) {
        constant += sign * coeff;
        continue;
      }
      // In constraints, a standalone constant on the LHS can still be absorbed
      constant += sign * coeff;
      continue;
    }

    // Unrecognized token
    const badTok = text.slice(pos).match(/^\S+/)?.[0] ?? text[pos] ?? "";
    errors.push({
      message: `Unexpected token '${badTok}' in expression`,
      location: loc,
    });
    pos += Math.max(1, badTok.length);
  }

  return {
    linearTerms,
    quadratic: hasQuad ? { terms: quadTerms, divisor: quadDivisor } : undefined,
    constant,
    errors,
  };
}

/**
 * Parses a CPLEX LP or LINDO source string into a structured `CplexLpModel`.
 */
export function parseCplexLp(source: string, modelName = "CplexLpModel"): CplexLpModel {
  const lines = splitLinesWithOffsets(source);
  const parseErrors: LpParseError[] = [];
  const comments: string[] = [];

  let detectedName = modelName;
  let dialect: LpDialect = "cplex-lp";
  let section: SectionKind = "none";
  let hasEnd = false;

  let objective: LpObjective | undefined;
  let objBuffer = "";
  let objLoc: SourceLocation | undefined;
  let objName: string | undefined;

  const constraints: LpConstraint[] = [];
  let conBuffer = "";
  let conLoc: SourceLocation | undefined;
  let conName: string | undefined;
  let conHasExplicitName = false;
  let autoConCounter = 1;

  const bounds = new Map<string, LpVariableBound>();
  const generals = new Set<string>();
  const binaries = new Set<string>();
  const semiContinuous = new Set<string>();
  const sos: LpSosConstraint[] = [];
  let currentSos: LpSosConstraint | undefined;

  // Track variable appearance order & first locations
  const variableOrder: string[] = [];
  const variableOrderSet = new Set<string>();
  const referencedVars = new Set<string>();
  const varFirstLoc = new Map<string, SourceLocation>();

  const registerVar = (name: string, referenced: boolean, loc?: SourceLocation): void => {
    if (!variableOrderSet.has(name)) {
      variableOrderSet.add(name);
      variableOrder.push(name);
    }
    if (referenced) {
      referencedVars.add(name);
    }
    if (loc && !varFirstLoc.has(name)) {
      varFirstLoc.set(name, loc);
    }
  };

  const getOrCreateBound = (variable: string, loc?: SourceLocation): LpVariableBound => {
    let b = bounds.get(variable);
    if (!b) {
      b = {
        variable,
        lower: 0,
        upper: Infinity,
        isFree: false,
        location: loc,
      };
      bounds.set(variable, b);
    } else if (loc && !b.location) {
      b.location = loc;
    }
    registerVar(variable, false, loc);
    return b;
  };

  const flushObjective = (): void => {
    if (!objective) return;
    const text = objBuffer.trim();
    if (!text) return;
    const loc = objLoc ?? makeLoc(1, 1, 0, 0);
    const parsed = parseExpression(text, loc, true);
    objective.linearTerms.push(...parsed.linearTerms);
    objective.constant += parsed.constant;
    if (parsed.quadratic) {
      if (!objective.quadratic) {
        objective.quadratic = parsed.quadratic;
      } else {
        objective.quadratic.terms.push(...parsed.quadratic.terms);
      }
    }
    parseErrors.push(...parsed.errors);
    for (const t of parsed.linearTerms) {
      registerVar(t.variable, true, t.location ?? loc);
    }
    if (parsed.quadratic) {
      for (const qt of parsed.quadratic.terms) {
        registerVar(qt.var1, true, qt.location ?? loc);
        registerVar(qt.var2, true, qt.location ?? loc);
      }
    }
    objBuffer = "";
  };

  const flushDanglingConstraint = (): void => {
    const text = conBuffer.trim();
    if (!text) {
      conBuffer = "";
      conName = undefined;
      conHasExplicitName = false;
      conLoc = undefined;
      return;
    }
    const loc = conLoc ?? makeLoc(1, 1, 0, 0);
    parseErrors.push({
      message: `Incomplete constraint '${conName ?? `c${autoConCounter}`}' missing relational operator ('<=', '>=', '=') and RHS`,
      location: loc,
    });
    conBuffer = "";
    conName = undefined;
    conHasExplicitName = false;
    conLoc = undefined;
  };

  const processConstraintText = (chunk: string, loc: SourceLocation): void => {
    let text = chunk.trim();
    if (!text) return;

    // Check for explicit label `name:` or LINDO `name)` at start when buffer is empty
    if (!conBuffer.trim()) {
      const colonLabel = text.match(/^([A-Za-z_][A-Za-z0-9_.#$@%&~]*)\s*:\s*(.*)$/);
      if (colonLabel) {
        conName = colonLabel[1];
        conHasExplicitName = true;
        conLoc = loc;
        text = (colonLabel[2] ?? "").trim();
      } else {
        const lindoLabel = text.match(/^([A-Za-z0-9_]+)\)\s*(.*)$/);
        if (lindoLabel) {
          dialect = "lindo";
          conName = lindoLabel[1];
          conHasExplicitName = true;
          conLoc = loc;
          text = (lindoLabel[2] ?? "").trim();
        } else {
          conLoc = loc;
        }
      }
    } else {
      // If buffer already has content and a new label appears, previous constraint was incomplete
      const newLabel = text.match(/^([A-Za-z_][A-Za-z0-9_.#$@%&~]*)\s*:\s*(.*)$/);
      if (newLabel) {
        flushDanglingConstraint();
        conName = newLabel[1];
        conHasExplicitName = true;
        conLoc = loc;
        text = (newLabel[2] ?? "").trim();
      }
    }

    if (!text) return;
    conBuffer = conBuffer ? `${conBuffer} ${text}` : text;

    // Look for relational operator (outside quadratic brackets `[ ... ]`)
    let depth = 0;
    let opIndex = -1;
    let rawOp: RawConstraintOperator | null = null;
    for (let i = 0; i < conBuffer.length; i++) {
      const ch = conBuffer[i];
      if (ch === "[") depth++;
      else if (ch === "]") depth = Math.max(0, depth - 1);
      else if (depth === 0) {
        const two = conBuffer.slice(i, i + 2);
        if (two === "<=" || two === ">=") {
          opIndex = i;
          rawOp = two;
          break;
        }
        if (ch === "<" || ch === ">" || ch === "=") {
          opIndex = i;
          rawOp = ch;
          break;
        }
      }
    }

    if (opIndex >= 0 && rawOp) {
      if (rawOp === "<" || rawOp === ">") {
        dialect = "lindo";
      }
      const lhsText = conBuffer.slice(0, opIndex).trim();
      const rhsText = conBuffer.slice(opIndex + rawOp.length).trim();

      const cLoc = conLoc ?? loc;
      const resolvedName = conName ?? `c${autoConCounter}`;
      autoConCounter++;

      const rhsVal = Number(rhsText);
      if (!rhsText || !Number.isFinite(rhsVal)) {
        parseErrors.push({
          message: `Invalid right-hand side '${rhsText}' in constraint '${resolvedName}'`,
          location: cLoc,
        });
      }

      const parsedLhs = parseExpression(lhsText, cLoc, false);
      parseErrors.push(...parsedLhs.errors);
      for (const t of parsedLhs.linearTerms) {
        registerVar(t.variable, true, t.location ?? cLoc);
      }
      if (parsedLhs.quadratic) {
        for (const qt of parsedLhs.quadratic.terms) {
          registerVar(qt.var1, true, qt.location ?? cLoc);
          registerVar(qt.var2, true, qt.location ?? cLoc);
        }
      }

      // Move any constant term from LHS to RHS
      const effectiveRhs = (Number.isFinite(rhsVal) ? rhsVal : 0) - parsedLhs.constant;

      constraints.push({
        name: resolvedName,
        hasExplicitName: conHasExplicitName,
        linearTerms: parsedLhs.linearTerms,
        quadratic: parsedLhs.quadratic,
        operator: rawOp,
        sense: normalizeOperator(rawOp),
        rhs: effectiveRhs,
        location: cLoc,
      });

      conBuffer = "";
      conName = undefined;
      conHasExplicitName = false;
      conLoc = undefined;
    }
  };

  const processBoundLine = (text: string, loc: SourceLocation): void => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // 1. `<var> free`
    const freeMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_.#$@%&~]*)\s+free$/i);
    if (freeMatch) {
      const v = freeMatch[1]!;
      const b = getOrCreateBound(v, loc);
      b.lower = -Infinity;
      b.upper = Infinity;
      b.isFree = true;
      b.explicitFree = true;
      return;
    }

    // 2. `<lb> <= <var> <= <ub>` (or `<`)
    const rangeMatch = trimmed.match(
      /^([+-]?(?:inf(?:inity)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?))\s*<=?\s*([A-Za-z_][A-Za-z0-9_.#$@%&~]*)\s*<=?\s*([+-]?(?:inf(?:inity)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?))$/i,
    );
    if (rangeMatch) {
      const lb = parseBoundNumber(rangeMatch[1]!);
      const v = rangeMatch[2]!;
      const ub = parseBoundNumber(rangeMatch[3]!);
      if (lb === null || ub === null) {
        parseErrors.push({ message: `Invalid bound range '${trimmed}'`, location: loc });
        return;
      }
      const b = getOrCreateBound(v, loc);
      b.lower = lb;
      b.upper = ub;
      b.explicitLower = lb;
      b.explicitUpper = ub;
      b.isFree = lb === -Infinity && ub === Infinity;
      return;
    }

    // 3. `<lb> <= <var>`
    const lbLeftMatch = trimmed.match(
      /^([+-]?(?:inf(?:inity)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?))\s*<=?\s*([A-Za-z_][A-Za-z0-9_.#$@%&~]*)$/i,
    );
    if (lbLeftMatch) {
      const lb = parseBoundNumber(lbLeftMatch[1]!);
      const v = lbLeftMatch[2]!;
      if (lb === null) {
        parseErrors.push({ message: `Invalid lower bound '${trimmed}'`, location: loc });
        return;
      }
      const b = getOrCreateBound(v, loc);
      b.lower = lb;
      b.explicitLower = lb;
      return;
    }

    // 4. `<var> >= <lb>`
    const geMatch = trimmed.match(
      /^([A-Za-z_][A-Za-z0-9_.#$@%&~]*)\s*>=?\s*([+-]?(?:inf(?:inity)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?))$/i,
    );
    if (geMatch) {
      const v = geMatch[1]!;
      const lb = parseBoundNumber(geMatch[2]!);
      if (lb === null) {
        parseErrors.push({ message: `Invalid lower bound '${trimmed}'`, location: loc });
        return;
      }
      const b = getOrCreateBound(v, loc);
      b.lower = lb;
      b.explicitLower = lb;
      return;
    }

    // 5. `<var> <= <ub>`
    const leMatch = trimmed.match(
      /^([A-Za-z_][A-Za-z0-9_.#$@%&~]*)\s*<=?\s*([+-]?(?:inf(?:inity)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?))$/i,
    );
    if (leMatch) {
      const v = leMatch[1]!;
      const ub = parseBoundNumber(leMatch[2]!);
      if (ub === null) {
        parseErrors.push({ message: `Invalid upper bound '${trimmed}'`, location: loc });
        return;
      }
      const b = getOrCreateBound(v, loc);
      b.upper = ub;
      b.explicitUpper = ub;
      return;
    }

    // 6. `<var> = <val>`
    const eqMatch = trimmed.match(
      /^([A-Za-z_][A-Za-z0-9_.#$@%&~]*)\s*=\s*([+-]?(?:inf(?:inity)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?))$/i,
    );
    if (eqMatch) {
      const v = eqMatch[1]!;
      const val = parseBoundNumber(eqMatch[2]!);
      if (val === null) {
        parseErrors.push({ message: `Invalid fixed bound '${trimmed}'`, location: loc });
        return;
      }
      const b = getOrCreateBound(v, loc);
      b.lower = val;
      b.upper = val;
      b.explicitLower = val;
      b.explicitUpper = val;
      return;
    }

    parseErrors.push({ message: `Unrecognized bound specification '${trimmed}'`, location: loc });
  };

  const processLindoDirective = (trimmed: string, loc: SourceLocation): boolean => {
    // TITLE <name>
    const titleMatch = trimmed.match(/^title\s+(.+)$/i);
    if (titleMatch) {
      dialect = "lindo";
      detectedName = (titleMatch[1] ?? modelName).trim();
      return true;
    }

    // FREE <var>
    const freeMatch = trimmed.match(/^free\s+([A-Za-z_][A-Za-z0-9_.#$@%&~]*)$/i);
    if (freeMatch) {
      dialect = "lindo";
      const v = freeMatch[1]!;
      const b = getOrCreateBound(v, loc);
      b.lower = -Infinity;
      b.upper = Infinity;
      b.isFree = true;
      b.explicitFree = true;
      return true;
    }

    // SLB <var> <val>
    const slbMatch = trimmed.match(/^slb\s+([A-Za-z_][A-Za-z0-9_.#$@%&~]*)\s+(\S+)$/i);
    if (slbMatch) {
      dialect = "lindo";
      const v = slbMatch[1]!;
      const val = parseBoundNumber(slbMatch[2]!);
      if (val === null) {
        parseErrors.push({ message: `Invalid SLB value '${slbMatch[2]}' for '${v}'`, location: loc });
      } else {
        const b = getOrCreateBound(v, loc);
        b.lower = val;
        b.explicitLower = val;
      }
      return true;
    }

    // SUB <var> <val>
    const subMatch = trimmed.match(/^sub\s+([A-Za-z_][A-Za-z0-9_.#$@%&~]*)\s+(\S+)$/i);
    if (subMatch) {
      dialect = "lindo";
      const v = subMatch[1]!;
      const val = parseBoundNumber(subMatch[2]!);
      if (val === null) {
        parseErrors.push({ message: `Invalid SUB value '${subMatch[2]}' for '${v}'`, location: loc });
      } else {
        const b = getOrCreateBound(v, loc);
        b.upper = val;
        b.explicitUpper = val;
      }
      return true;
    }

    // GIN <var | count>
    const ginMatch = trimmed.match(/^gin\s+(\S+)$/i);
    if (ginMatch) {
      dialect = "lindo";
      const arg = ginMatch[1]!;
      if (/^\d+$/.test(arg)) {
        const count = Number(arg);
        for (let i = 0; i < Math.min(count, variableOrder.length); i++) {
          generals.add(variableOrder[i]!);
        }
      } else {
        generals.add(arg);
        registerVar(arg, false, loc);
      }
      return true;
    }

    // INT <var | count> (in LINDO, INT declares 0-1 binary variables)
    const intMatch = trimmed.match(/^int\s+(\S+)$/i);
    if (intMatch) {
      dialect = "lindo";
      const arg = intMatch[1]!;
      if (/^\d+$/.test(arg)) {
        const count = Number(arg);
        for (let i = 0; i < Math.min(count, variableOrder.length); i++) {
          binaries.add(variableOrder[i]!);
        }
      } else {
        binaries.add(arg);
        registerVar(arg, false, loc);
      }
      return true;
    }

    return false;
  };

  const processSosLine = (text: string, loc: SourceLocation): void => {
    let rest = text.trim();
    if (!rest) return;

    // Check for `<name>: <S1|S2>:: ...` or `<S1|S2>:: ...`
    const namedSos = rest.match(/^([A-Za-z_][A-Za-z0-9_.#$@%&~]*)\s*:\s*([A-Za-z0-9_]+)\s*::\s*(.*)$/);
    if (namedSos) {
      currentSos = {
        name: namedSos[1]!,
        type: namedSos[2]!.toUpperCase(),
        entries: [],
        location: loc,
      };
      sos.push(currentSos);
      rest = (namedSos[3] ?? "").trim();
    } else {
      const unnamedSos = rest.match(/^([A-Za-z0-9_]+)\s*::\s*(.*)$/);
      if (unnamedSos) {
        currentSos = {
          name: `sos${sos.length + 1}`,
          type: unnamedSos[1]!.toUpperCase(),
          entries: [],
          location: loc,
        };
        sos.push(currentSos);
        rest = (unnamedSos[2] ?? "").trim();
      }
    }

    if (!rest) return;
    if (!currentSos) {
      parseErrors.push({
        message: `SOS entries '${rest}' appeared before an SOS header (expected 'S1::' or 'S2::')`,
        location: loc,
      });
      return;
    }

    const tokens = rest.split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      const pair = tok.split(":");
      if (pair.length !== 2 || !pair[0]) {
        parseErrors.push({
          message: `Invalid SOS entry '${tok}' (expected 'variable:weight')`,
          location: loc,
        });
        continue;
      }
      const variable = pair[0];
      const weight = Number(pair[1]);
      registerVar(variable, false, loc);
      const entry: LpSosEntry = {
        variable,
        weight,
        location: loc,
      };
      currentSos.entries.push(entry);
    }
  };

  // Main line-by-line pass
  for (const line of lines) {
    if (line.comment) {
      comments.push(line.comment);
      if (line.comment.startsWith("!")) {
        dialect = "lindo";
      }
    }

    const trimmed = line.code.trim();
    if (!trimmed) continue;

    const col = line.code.indexOf(trimmed) + 1;
    const loc = makeLoc(line.lineNumber, Math.max(1, col), line.startOffset + Math.max(0, col - 1), line.endOffset);

    // Check LINDO directives before section headers (TITLE, FREE, SLB, SUB, GIN, INT)
    if (section === "none" || section === "post-end" || section === "bounds") {
      if (processLindoDirective(trimmed, loc)) {
        continue;
      }
    }

    // Check for section header
    const secMatch = matchSectionHeader(trimmed);
    if (secMatch) {
      if (secMatch.isLindoHint) {
        dialect = "lindo";
      }
      if (section === "objective") flushObjective();
      if (section === "constraints") flushDanglingConstraint();

      section = secMatch.section;
      if (section === "post-end") {
        hasEnd = true;
        if (secMatch.remainder) {
          processLindoDirective(secMatch.remainder, loc);
        }
        continue;
      }

      if (section === "objective") {
        objective = {
          sense: secMatch.sense ?? "minimize",
          linearTerms: [],
          constant: 0,
          location: loc,
        };
        objBuffer = "";
        objLoc = loc;
        objName = undefined;

        if (secMatch.remainder) {
          let rem = secMatch.remainder;
          const labelMatch = rem.match(/^([A-Za-z_][A-Za-z0-9_.#$@%&~]*)\s*:\s*(.*)$/);
          if (labelMatch) {
            objName = labelMatch[1];
            objective.name = objName;
            rem = (labelMatch[2] ?? "").trim();
          }
          if (rem) {
            objBuffer = rem;
          }
        }
        continue;
      }

      if (section === "constraints" && secMatch.remainder) {
        processConstraintText(secMatch.remainder, loc);
        continue;
      }

      if (section === "bounds" && secMatch.remainder) {
        processBoundLine(secMatch.remainder, loc);
        continue;
      }

      if ((section === "generals" || section === "binaries" || section === "semi-continuous") && secMatch.remainder) {
        const target = section === "generals" ? generals : section === "binaries" ? binaries : semiContinuous;
        for (const v of secMatch.remainder.split(/\s+/).filter(Boolean)) {
          target.add(v);
          registerVar(v, false, loc);
        }
        continue;
      }

      if (section === "sos" && secMatch.remainder) {
        processSosLine(secMatch.remainder, loc);
        continue;
      }

      continue;
    }

    // Also allow LINDO directives in constraints/generals/binaries if encountered before END
    if (
      (section === "constraints" || section === "generals" || section === "binaries") &&
      /^(?:free|slb|sub|gin|int)\s+/i.test(trimmed)
    ) {
      if (section === "constraints") flushDanglingConstraint();
      if (processLindoDirective(trimmed, loc)) {
        continue;
      }
    }

    // Section body dispatch
    switch (section) {
      case "objective": {
        let body = trimmed;
        if (!objName && !objBuffer) {
          const labelMatch = body.match(/^([A-Za-z_][A-Za-z0-9_.#$@%&~]*)\s*:\s*(.*)$/);
          if (labelMatch && objective) {
            objName = labelMatch[1];
            objective.name = objName;
            body = (labelMatch[2] ?? "").trim();
          }
        }
        if (body) {
          objBuffer = objBuffer ? `${objBuffer} ${body}` : body;
        }
        break;
      }
      case "constraints": {
        processConstraintText(trimmed, loc);
        break;
      }
      case "bounds": {
        processBoundLine(trimmed, loc);
        break;
      }
      case "generals": {
        for (const tok of trimmed.split(/\s+/).filter(Boolean)) {
          if (!IDENT_RE.test(tok)) {
            parseErrors.push({ message: `Invalid variable name '${tok}' in Generals section`, location: loc });
          } else {
            generals.add(tok);
            registerVar(tok, false, loc);
          }
        }
        break;
      }
      case "binaries": {
        for (const tok of trimmed.split(/\s+/).filter(Boolean)) {
          if (!IDENT_RE.test(tok)) {
            parseErrors.push({ message: `Invalid variable name '${tok}' in Binaries section`, location: loc });
          } else {
            binaries.add(tok);
            registerVar(tok, false, loc);
          }
        }
        break;
      }
      case "semi-continuous": {
        for (const tok of trimmed.split(/\s+/).filter(Boolean)) {
          if (!IDENT_RE.test(tok)) {
            parseErrors.push({ message: `Invalid variable name '${tok}' in Semi-Continuous section`, location: loc });
          } else {
            semiContinuous.add(tok);
            registerVar(tok, false, loc);
          }
        }
        break;
      }
      case "sos": {
        processSosLine(trimmed, loc);
        break;
      }
      case "post-end": {
        // Ignore trailing LINDO commands like GO, LOOK, QUIT, LEAVE or blank lines
        if (!/^(?:go|look|quit|leave|terse|verbose|page|picture|range)\b/i.test(trimmed)) {
          if (!processLindoDirective(trimmed, loc)) {
            parseErrors.push({
              message: `Unexpected content '${trimmed}' after 'End'`,
              location: loc,
            });
          }
        }
        break;
      }
      case "none": {
        parseErrors.push({
          message: `Unexpected statement '${trimmed}' before objective section`,
          location: loc,
        });
        break;
      }
    }
  }

  // Final flushes
  if (section === "objective") flushObjective();
  if (section === "constraints") flushDanglingConstraint();

  // Build unified variable metadata map
  const variables = new Map<string, LpVariableInfo>();
  for (const name of variableOrder) {
    let domain: VariableDomain = "continuous";
    if (binaries.has(name)) domain = "binary";
    else if (generals.has(name)) domain = "general";
    else if (semiContinuous.has(name)) domain = "semi-continuous";

    const b = bounds.get(name);
    let lower = b ? b.lower : 0;
    let upper = b ? b.upper : domain === "binary" ? 1 : Infinity;
    const isFree = b ? b.isFree : false;

    if (domain === "binary" && b) {
      if (b.explicitLower === undefined && !b.explicitFree) lower = 0;
      if (b.explicitUpper === undefined && !b.explicitFree) upper = 1;
    }

    variables.set(name, {
      name,
      domain,
      lower,
      upper,
      isFree,
      referencedInModel: referencedVars.has(name),
      firstLocation: varFirstLoc.get(name),
    });
  }

  return {
    name: detectedName,
    dialect,
    objective,
    constraints,
    bounds,
    generals,
    binaries,
    semiContinuous,
    sos,
    variables,
    variableOrder,
    hasEnd,
    parseErrors,
    comments,
  };
}
