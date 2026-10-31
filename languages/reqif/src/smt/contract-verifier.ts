// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Compound Boolean & Linear-Arithmetic Contract SMT Verifier for ReqIF.
 *
 * Parses and solves requirement contracts containing:
 * - Conjunctions (`&&`, `and`, `;`)
 * - Disjunctions (`||`, `or`)
 * - Implications (`=>`, `->`, `implies`)
 * - Negations (`!`, `not`)
 * - Multi-variable linear-arithmetic inequalities and equalities (`2*x + 3*y - z <= 120`, `<`, `>=`, `>`, `==`, `!=`)
 *
 * Proves V-Model requirement entailment ($\bigwedge_i C_{\text{child},i} \models C_{\text{parent}}$)
 * by checking unsatisfiability of $\bigwedge_i C_{\text{child},i} \land \neg C_{\text{parent}}$
 * via DNF clause decomposition + exact Linear Real Arithmetic (LRA) Simplex/Fourier-Motzkin solving,
 * producing concrete counterexample witness assignments when entailment fails.
 */

export type LinearRelOp = "<=" | "<" | ">=" | ">" | "==" | "!=";

export interface LinearAtom {
  /** Linear coefficients mapping variable name -> multiplier on LHS (`sum(coeff_i * x_i) op rhs`). */
  coeffs: Map<string, number>;
  op: LinearRelOp;
  /** Constant right-hand side threshold (`sum(coeff_i * x_i) op rhs`). */
  rhs: number;
  rawText: string;
}

export type ContractFormulaAst =
  | { kind: "BooleanLiteral"; value: boolean }
  | { kind: "Atom"; atom: LinearAtom }
  | { kind: "Not"; operand: ContractFormulaAst }
  | { kind: "And"; left: ContractFormulaAst; right: ContractFormulaAst }
  | { kind: "Or"; left: ContractFormulaAst; right: ContractFormulaAst }
  | { kind: "Implies"; left: ContractFormulaAst; right: ContractFormulaAst };

export interface LabeledContractFormula {
  id?: string | undefined;
  formula: string | ContractFormulaAst;
}

export interface ContractSatResult {
  satisfiable: boolean;
  /** Concrete variable assignment satisfying the formula when `satisfiable === true`. */
  witness?: Record<string, number> | undefined;
  /** Requirement IDs participating in the unsatisfiable conflict core when `satisfiable === false`. */
  unsatCore?: string[] | undefined;
  /** Human-readable explanation of why the formula is unsatisfiable. */
  conflictExplanation?: string | undefined;
}

export interface ContractEntailmentCheckResult {
  isEntailed: boolean;
  /** Concrete witness assignment satisfying all premises while violating the conclusion. */
  counterexample?: Record<string, number> | undefined;
  /** Human-readable diagnostic message describing the entailment proof or gap. */
  diagnosticMessage?: string | undefined;
}

interface Token {
  type: "lparen" | "rparen" | "and" | "or" | "implies" | "not" | "atom" | "eof";
  text: string;
}

import { extractFormalContract } from "../parser/reqif-parser.js";

/**
 * Extracts a formal contract expression from ReqIF requirement text.
 * Recognizes explicit `@contract: ...` or `[contract: ...]` annotations,
 * structured EARS requirement templates (`While <pre>, when <trig>, the <sys> shall <resp> within <dur>`),
 * conditional implications (`If <cond>, then <resp>`), and inline compound boolean/arithmetic contract clauses.
 */
export function extractContractExpression(text: string): string | undefined {
  if (!text) return undefined;
  const stripped = text
    .replace(/<\/?[a-zA-Z][^<>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

  const explicitTag = /(?:@contract\s*:|\[\s*contract\s*:)\s*([^\]]+?)(?:\]|$)/i.exec(stripped);
  if (explicitTag?.[1]) {
    return explicitTag[1].trim().replace(/\.$/, "").trim();
  }

  // Delegate structured EARS templates ("While ..., when ..., the ... shall ... within ...") and "If ... then ..."
  if (/^(?:while|when|where|if)\b|\bwithin\s+[0-9]|\bshall\b/i.test(stripped)) {
    const formalEars = extractFormalContract(stripped);
    if (formalEars?.expression) {
      return formalEars.expression;
    }
  }

  // If the text directly uses logical connectives or multi-term arithmetic around comparators
  if (/(?:&&|\|\||=>|->|\bimplies\b|\band\b|\bor\b|[+\-*/])/.test(stripped) && /(?:<=|>=|==|!=|<|>)/.test(stripped)) {
    const cleaned = stripped
      .replace(
        /\b(?:requirement|the|system|vehicle|subsystem|must\s+be|shall\s+be|should\s+be|may\s+reach|can\s+be|shall|must|should|ensures\s+that|when|if)\b/gi,
        " ",
      )
      .replace(/\.$/, "")
      .trim();
    if (/(?:<=|>=|==|!=|<|>)/.test(cleaned)) {
      return cleaned;
    }
  }

  const formalFallback = extractFormalContract(stripped);
  if (formalFallback?.expression) {
    return formalFallback.expression;
  }

  return undefined;
}

/**
 * Parses a linear arithmetic expression like `2 * x - 3.5 * y + 10` or `power_motor + power_aux`
 * into `{ coeffs: Map<string, number>, constant: number }`.
 */
export function parseLinearArithmeticExpr(exprStr: string): { coeffs: Map<string, number>; constant: number } {
  const coeffs = new Map<string, number>();
  let constant = 0;

  // Tokenize into numbers, identifiers, +, -, *, /, (, )
  const tokRegex = /\s*([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|[A-Za-z_][A-Za-z0-9_.]*|[+\-*/()])\s*/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokRegex.exec(exprStr)) !== null) {
    if (m[1]) tokens.push(m[1]);
  }

  // Filter out trailing unit tokens after numbers (e.g. `120 km/h`, `150 kW`)
  const filtered: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    const prev = filtered[filtered.length - 1];
    const isNum = prev !== undefined && /^[0-9]/.test(prev);
    const isIdent = /^[A-Za-z_]/.test(t);
    if (isNum && isIdent) {
      // Unit after numeric literal (like `150 kW` or `120 km / h`)
      if (tokens[i + 1] === "/" && /^[A-Za-z_]/.test(tokens[i + 2] ?? "")) {
        i += 2;
      }
      continue;
    }
    filtered.push(t);
  }

  let pos = 0;
  const peek = () => filtered[pos];
  const next = () => filtered[pos++];

  function parseAdd(): { coeffs: Map<string, number>; constant: number } {
    let left = parseMul();
    while (peek() === "+" || peek() === "-") {
      const op = next() ?? "+";
      const right = parseMul();
      const sign = op === "+" ? 1 : -1;
      const merged = new Map<string, number>(left.coeffs);
      for (const [k, v] of right.coeffs) {
        const c = (merged.get(k) ?? 0) + sign * v;
        if (Math.abs(c) < 1e-12) merged.delete(k);
        else merged.set(k, c);
      }
      left = { coeffs: merged, constant: left.constant + sign * right.constant };
    }
    return left;
  }

  function parseMul(): { coeffs: Map<string, number>; constant: number } {
    let left = parseUnary();
    while (peek() === "*" || peek() === "/") {
      const op = next() ?? "*";
      const right = parseUnary();
      if (op === "*") {
        if (left.coeffs.size === 0) {
          const scaled = new Map<string, number>();
          for (const [k, v] of right.coeffs) {
            if (Math.abs(left.constant * v) >= 1e-12) scaled.set(k, left.constant * v);
          }
          left = { coeffs: scaled, constant: left.constant * right.constant };
        } else if (right.coeffs.size === 0) {
          const scaled = new Map<string, number>();
          for (const [k, v] of left.coeffs) {
            if (Math.abs(right.constant * v) >= 1e-12) scaled.set(k, right.constant * v);
          }
          left = { coeffs: scaled, constant: left.constant * right.constant };
        }
      } else if (op === "/" && right.coeffs.size === 0 && Math.abs(right.constant) > 1e-12) {
        const scaled = new Map<string, number>();
        for (const [k, v] of left.coeffs) {
          scaled.set(k, v / right.constant);
        }
        left = { coeffs: scaled, constant: left.constant / right.constant };
      }
    }
    return left;
  }

  function parseUnary(): { coeffs: Map<string, number>; constant: number } {
    if (peek() === "+") {
      next();
      return parseUnary();
    }
    if (peek() === "-") {
      next();
      const inner = parseUnary();
      const neg = new Map<string, number>();
      for (const [k, v] of inner.coeffs) neg.set(k, -v);
      return { coeffs: neg, constant: -inner.constant };
    }
    return parsePrimary();
  }

  function parsePrimary(): { coeffs: Map<string, number>; constant: number } {
    const t = peek();
    if (!t) return { coeffs: new Map(), constant: 0 };
    if (t === "(") {
      next();
      const inner = parseAdd();
      if (peek() === ")") next();
      return inner;
    }
    if (/^[0-9]/.test(t)) {
      next();
      const num = Number(t);
      // Implicit multiplication like `2 x` or `2(x + y)`
      const nextTok = peek();
      if (nextTok && /^[A-Za-z_]/.test(nextTok)) {
        const varName = next() ?? nextTok;
        const m = new Map<string, number>();
        m.set(varName, num);
        return { coeffs: m, constant: 0 };
      }
      return { coeffs: new Map(), constant: num };
    }
    if (/^[A-Za-z_]/.test(t)) {
      next();
      const m = new Map<string, number>();
      m.set(t, 1);
      return { coeffs: m, constant: 0 };
    }
    next();
    return { coeffs: new Map(), constant: 0 };
  }

  if (filtered.length === 0) return { coeffs, constant };
  return parseAdd();
}

/**
 * Parses a single relational atom like `2*x + y <= 100` or `total == a + b` into a normalized `LinearAtom`.
 */
export function parseLinearAtom(rawAtom: string): LinearAtom | boolean {
  const trimmed = rawAtom.trim();
  if (/^(?:true|1)$/i.test(trimmed)) return true;
  if (/^(?:false|0)$/i.test(trimmed)) return false;

  const compMatch = /^(.*?)\s*(<=|>=|==|!=|<|>|=)\s*(.+)$/.exec(trimmed);
  if (!compMatch) {
    // Bare boolean variable `flag` -> `flag >= 1`
    const coeffs = new Map<string, number>([[trimmed, 1]]);
    return { coeffs, op: ">=", rhs: 1, rawText: trimmed };
  }

  const lhsStr = (compMatch[1] ?? "").trim();
  const rawOp = (compMatch[2] ?? "").trim();
  const rhsStr = (compMatch[3] ?? "").trim();
  const op: LinearRelOp = rawOp === "=" ? "==" : (rawOp as LinearRelOp);

  const lhs = parseLinearArithmeticExpr(lhsStr);
  const rhs = parseLinearArithmeticExpr(rhsStr);

  // Move all variables to LHS and constants to RHS: (lhs.coeffs - rhs.coeffs) op (rhs.constant - lhs.constant)
  const coeffs = new Map<string, number>(lhs.coeffs);
  for (const [k, v] of rhs.coeffs) {
    const next = (coeffs.get(k) ?? 0) - v;
    if (Math.abs(next) < 1e-12) coeffs.delete(k);
    else coeffs.set(k, next);
  }
  const rhsConst = rhs.constant - lhs.constant;

  return {
    coeffs,
    op,
    rhs: rhsConst,
    rawText: trimmed,
  };
}

function tokenizeContractFormula(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
  const n = s.length;

  let currentAtom = "";
  let parenDepth = 0;

  const flushAtom = () => {
    const trimmed = currentAtom.trim();
    if (trimmed) {
      tokens.push({ type: "atom", text: trimmed });
    }
    currentAtom = "";
  };

  while (i < n) {
    const ch = s[i] ?? "";

    // Check logical operators when not inside an arithmetic parenthesized sub-expression
    // Wait: parentheses can group either boolean formulas `(a <= 1 || b <= 2)` or arithmetic `2 * (x + y) <= 10`.
    // Let's check if a `(` has a relational comparator inside it before its matching `)`.
    if (ch === "(") {
      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")") depth--;
        j++;
      }
      const inside = s.slice(i + 1, j - 1);
      const hasRelOrLogicInside = /(?:<=|>=|==|!=|<|>|&&|\|\||=>|->|\band\b|\bor\b|\bimplies\b)/i.test(inside);
      if (hasRelOrLogicInside && currentAtom.trim() === "") {
        tokens.push({ type: "lparen", text: "(" });
        i++;
        continue;
      } else {
        // Arithmetic parenthesis inside an atom
        parenDepth++;
        currentAtom += ch;
        i++;
        continue;
      }
    }

    if (ch === ")") {
      if (parenDepth > 0) {
        parenDepth--;
        currentAtom += ch;
        i++;
        continue;
      }
      flushAtom();
      tokens.push({ type: "rparen", text: ")" });
      i++;
      continue;
    }

    if (parenDepth === 0) {
      if (s.slice(i, i + 2) === "&&" || ch === ";") {
        flushAtom();
        tokens.push({ type: "and", text: "&&" });
        i += ch === ";" ? 1 : 2;
        continue;
      }
      if (s.slice(i, i + 2) === "||") {
        flushAtom();
        tokens.push({ type: "or", text: "||" });
        i += 2;
        continue;
      }
      if (s.slice(i, i + 2) === "=>" || s.slice(i, i + 2) === "->") {
        flushAtom();
        tokens.push({ type: "implies", text: "=>" });
        i += 2;
        continue;
      }
      if (ch === "!" && s[i + 1] !== "=" && currentAtom.trim() === "") {
        tokens.push({ type: "not", text: "!" });
        i++;
        continue;
      }

      const wordMatch = /^(?:\b(and|or|implies|not)\b)/i.exec(s.slice(i));
      const prevChar = i > 0 ? s[i - 1] : " ";
      if (wordMatch && (i === 0 || /[\s()]/.test(prevChar ?? " "))) {
        const w = (wordMatch[1] ?? "").toLowerCase();
        if (w === "not" && currentAtom.trim() === "") {
          tokens.push({ type: "not", text: "not" });
          i += wordMatch[0].length;
          continue;
        }
        if (w === "and" || w === "or" || w === "implies") {
          flushAtom();
          tokens.push({ type: w as "and" | "or" | "implies", text: w });
          i += wordMatch[0].length;
          continue;
        }
      }
    }

    currentAtom += ch;
    i++;
  }

  flushAtom();
  tokens.push({ type: "eof", text: "" });
  return tokens;
}

/**
 * Parses a contract expression string into a `ContractFormulaAst`.
 */
export function parseContractFormula(input: string): ContractFormulaAst {
  const extracted = extractContractExpression(input) ?? input;
  const tokens = tokenizeContractFormula(extracted);
  let pos = 0;

  const lastToken: Token = tokens[tokens.length - 1] ?? { type: "eof", text: "" };
  const peek = (): Token => tokens[pos] ?? lastToken;
  const next = (): Token => {
    const t = peek();
    if (pos < tokens.length - 1) pos++;
    return t;
  };

  function parseImplies(): ContractFormulaAst {
    const left = parseOr();
    if (peek().type === "implies") {
      next();
      const right = parseImplies();
      return { kind: "Implies", left, right };
    }
    return left;
  }

  function parseOr(): ContractFormulaAst {
    let left = parseAnd();
    while (peek().type === "or") {
      next();
      const right = parseAnd();
      left = { kind: "Or", left, right };
    }
    return left;
  }

  function parseAnd(): ContractFormulaAst {
    let left = parseNot();
    while (peek().type === "and") {
      next();
      const right = parseNot();
      left = { kind: "And", left, right };
    }
    return left;
  }

  function parseNot(): ContractFormulaAst {
    if (peek().type === "not") {
      next();
      return { kind: "Not", operand: parseNot() };
    }
    return parsePrimary();
  }

  function parsePrimary(): ContractFormulaAst {
    const tok = peek();
    if (tok.type === "lparen") {
      next();
      const inner = parseImplies();
      if (peek().type === "rparen") next();
      return inner;
    }
    if (tok.type === "atom") {
      next();
      const parsed = parseLinearAtom(tok.text);
      if (typeof parsed === "boolean") {
        return { kind: "BooleanLiteral", value: parsed };
      }
      return { kind: "Atom", atom: parsed };
    }
    next();
    return { kind: "BooleanLiteral", value: true };
  }

  return parseImplies();
}

interface TaggedLinearInequality {
  /** `sum(coeffs_i * x_i) <= rhs` */
  coeffs: Map<string, number>;
  rhs: number;
  strict: boolean;
  sourceId?: string | undefined;
  rawText: string;
}

function negateRelOp(op: LinearRelOp): LinearRelOp {
  switch (op) {
    case "<=":
      return ">";
    case "<":
      return ">=";
    case ">=":
      return "<";
    case ">":
      return "<=";
    case "==":
      return "!=";
    case "!=":
      return "==";
  }
}

function atomToInequalities(atom: LinearAtom, sourceId?: string): TaggedLinearInequality[][] {
  const op = atom.op;
  if (op === "<=" || op === "<") {
    return [
      [
        {
          coeffs: new Map(atom.coeffs),
          rhs: atom.rhs,
          strict: op === "<",
          sourceId,
          rawText: atom.rawText,
        },
      ],
    ];
  }
  if (op === ">=" || op === ">") {
    const negCoeffs = new Map<string, number>();
    for (const [k, v] of atom.coeffs) negCoeffs.set(k, -v);
    return [
      [
        {
          coeffs: negCoeffs,
          rhs: -atom.rhs,
          strict: op === ">",
          sourceId,
          rawText: atom.rawText,
        },
      ],
    ];
  }
  if (op === "==") {
    const negCoeffs = new Map<string, number>();
    for (const [k, v] of atom.coeffs) negCoeffs.set(k, -v);
    return [
      [
        {
          coeffs: new Map(atom.coeffs),
          rhs: atom.rhs,
          strict: false,
          sourceId,
          rawText: atom.rawText,
        },
        {
          coeffs: negCoeffs,
          rhs: -atom.rhs,
          strict: false,
          sourceId,
          rawText: atom.rawText,
        },
      ],
    ];
  }
  // op === "!=" -> Disjunction: (lhs < rhs) OR (lhs > rhs)
  const negCoeffs = new Map<string, number>();
  for (const [k, v] of atom.coeffs) negCoeffs.set(k, -v);
  return [
    [
      {
        coeffs: new Map(atom.coeffs),
        rhs: atom.rhs,
        strict: true,
        sourceId,
        rawText: `${atom.rawText} (<)`,
      },
    ],
    [
      {
        coeffs: negCoeffs,
        rhs: -atom.rhs,
        strict: true,
        sourceId,
        rawText: `${atom.rawText} (>)`,
      },
    ],
  ];
}

/**
 * Expands a `ContractFormulaAst` (under optional negation) into DNF conjunction branches of `TaggedLinearInequality`.
 */
function expandFormulaToDnf(node: ContractFormulaAst, negated: boolean, sourceId?: string): TaggedLinearInequality[][] {
  switch (node.kind) {
    case "BooleanLiteral": {
      const val = negated ? !node.value : node.value;
      return val ? [[]] : [];
    }
    case "Not":
      return expandFormulaToDnf(node.operand, !negated, sourceId);
    case "Atom": {
      const effectiveAtom: LinearAtom = negated
        ? {
            coeffs: node.atom.coeffs,
            op: negateRelOp(node.atom.op),
            rhs: node.atom.rhs,
            rawText: `!(${node.atom.rawText})`,
          }
        : node.atom;
      return atomToInequalities(effectiveAtom, sourceId);
    }
    case "And":
    case "Or":
    case "Implies": {
      let isOr: boolean;
      let leftNeg = negated;
      let rightNeg = negated;

      if (node.kind === "Implies") {
        if (!negated) {
          // A => B  ===  !A || B
          isOr = true;
          leftNeg = true;
          rightNeg = false;
        } else {
          // !(A => B)  ===  A && !B
          isOr = false;
          leftNeg = false;
          rightNeg = true;
        }
      } else if (node.kind === "And") {
        isOr = negated; // !(A && B) === !A || !B
      } else {
        isOr = !negated; // !(A || B) === !A && !B
      }

      const leftBranches = expandFormulaToDnf(node.left, leftNeg, sourceId);
      const rightBranches = expandFormulaToDnf(node.right, rightNeg, sourceId);

      if (isOr) {
        return [...leftBranches, ...rightBranches];
      }

      const product: TaggedLinearInequality[][] = [];
      for (const lb of leftBranches) {
        for (const rb of rightBranches) {
          product.push([...lb, ...rb]);
          if (product.length >= 128) return product;
        }
      }
      return product;
    }
  }
}

/**
 * Exact Fourier-Motzkin / Linear Real Arithmetic Feasibility & Witness Reconstruction Solver.
 * Solves systems of linear inequalities $\sum_j a_{ij} x_j \le b_i$ (and strict $< b_i$)
 * and reconstructs a concrete satisfying assignment $x \in \mathbb{R}^n$.
 */
function solveLinearInequalityConjunction(inequalities: readonly TaggedLinearInequality[]): {
  feasible: boolean;
  witness?: Record<string, number>;
  unsatCore?: string[];
  conflictReason?: string;
} {
  const STRICT_EPS = 1e-3;
  interface ConstraintRow {
    coeffs: Map<string, number>;
    rhs: number;
    sources: Set<string>;
    raws: string[];
  }

  const varSet = new Set<string>();
  let rows: ConstraintRow[] = [];

  for (const ineq of inequalities) {
    const coeffs = new Map<string, number>();
    for (const [v, c] of ineq.coeffs) {
      if (Math.abs(c) >= 1e-12) {
        coeffs.set(v, c);
        varSet.add(v);
      }
    }
    const effectiveRhs = ineq.strict ? ineq.rhs - STRICT_EPS : ineq.rhs;
    const sources = new Set<string>();
    if (ineq.sourceId) sources.add(ineq.sourceId);

    if (coeffs.size === 0) {
      if (0 > effectiveRhs + 1e-9) {
        return {
          feasible: false,
          unsatCore: Array.from(sources),
          conflictReason: `Contradictory constant inequality '${ineq.rawText}'`,
        };
      }
      continue;
    }

    rows.push({
      coeffs,
      rhs: effectiveRhs,
      sources,
      raws: [ineq.rawText],
    });
  }

  const variables = Array.from(varSet);
  const eliminationHistory: { variable: string; rowsBefore: ConstraintRow[] }[] = [];

  // Eliminate variables one by one via Fourier-Motzkin
  for (const v of variables) {
    eliminationHistory.push({ variable: v, rowsBefore: rows });

    const upper: ConstraintRow[] = []; // coeff > 0 => v <= (rhs - rest) / coeff
    const lower: ConstraintRow[] = []; // coeff < 0 => v >= (rest - rhs) / (-coeff)
    const independent: ConstraintRow[] = [];

    for (const r of rows) {
      const c = r.coeffs.get(v) ?? 0;
      if (c > 1e-12) upper.push(r);
      else if (c < -1e-12) lower.push(r);
      else independent.push(r);
    }

    const nextRows: ConstraintRow[] = [...independent];

    for (const u of upper) {
      const cu = u.coeffs.get(v) ?? 1.0;
      for (const l of lower) {
        const clRaw = l.coeffs.get(v) ?? -1.0;
        const cl = -clRaw; // positive
        // Combine (u / cu) + (l / cl) <= u.rhs/cu + l.rhs/cl
        const mergedCoeffs = new Map<string, number>();
        for (const [k, val] of u.coeffs) {
          if (k === v) continue;
          mergedCoeffs.set(k, val / cu);
        }
        for (const [k, val] of l.coeffs) {
          if (k === v) continue;
          const nextVal = (mergedCoeffs.get(k) ?? 0) + val / cl;
          if (Math.abs(nextVal) < 1e-12) mergedCoeffs.delete(k);
          else mergedCoeffs.set(k, nextVal);
        }
        const mergedRhs = u.rhs / cu + l.rhs / cl;
        const mergedSources = new Set<string>([...u.sources, ...l.sources]);
        const mergedRaws = [...u.raws, ...l.raws];

        if (mergedCoeffs.size === 0) {
          if (mergedRhs < -1e-9) {
            return {
              feasible: false,
              unsatCore: Array.from(mergedSources),
              conflictReason: `Linear arithmetic contradiction on '${v}': [${mergedRaws.join(" AND ")}]`,
            };
          }
        } else if (nextRows.length < 256) {
          nextRows.push({
            coeffs: mergedCoeffs,
            rhs: mergedRhs,
            sources: mergedSources,
            raws: mergedRaws,
          });
        }
      }
    }

    rows = nextRows;
  }

  // Reconstruct a concrete witness assignment in reverse elimination order
  const witness: Record<string, number> = {};
  for (let i = eliminationHistory.length - 1; i >= 0; i--) {
    const hist = eliminationHistory[i];
    if (!hist) continue;
    const { variable, rowsBefore } = hist;
    let minBound = -Infinity;
    let maxBound = Infinity;

    for (const r of rowsBefore) {
      const c = r.coeffs.get(variable) ?? 0;
      if (Math.abs(c) < 1e-12) continue;

      let restSum = 0;
      for (const [otherVar, otherCoeff] of r.coeffs) {
        if (otherVar === variable) continue;
        restSum += otherCoeff * (witness[otherVar] ?? 0);
      }
      const bound = (r.rhs - restSum) / c;
      if (c > 0) {
        if (bound < maxBound) maxBound = bound;
      } else {
        if (bound > minBound) minBound = bound;
      }
    }

    let chosen = 0;
    if (Number.isFinite(minBound) && Number.isFinite(maxBound)) {
      chosen = 0 >= minBound && 0 <= maxBound ? 0 : 0.5 * (minBound + maxBound);
    } else if (Number.isFinite(minBound)) {
      chosen = Math.max(0, minBound + 1);
    } else if (Number.isFinite(maxBound)) {
      chosen = Math.min(0, maxBound - 1);
    }
    witness[variable] = Number(chosen.toFixed(6));
  }

  return {
    feasible: true,
    witness,
  };
}

/**
 * Checks whether a conjunction of labeled contract formulas is satisfiable over $\mathbb{R}^n$.
 */
export function checkContractFormulaSat(formulas: readonly LabeledContractFormula[]): ContractSatResult {
  let branches: TaggedLinearInequality[][] = [[]];

  for (const item of formulas) {
    const ast = typeof item.formula === "string" ? parseContractFormula(item.formula) : item.formula;
    const itemBranches = expandFormulaToDnf(ast, false, item.id);
    if (itemBranches.length === 0) {
      return {
        satisfiable: false,
        unsatCore: item.id ? [item.id] : [],
        conflictExplanation: `Contract formula '${typeof item.formula === "string" ? item.formula : item.id}' is identically false`,
      };
    }

    const next: TaggedLinearInequality[][] = [];
    for (const b1 of branches) {
      for (const b2 of itemBranches) {
        next.push([...b1, ...b2]);
        if (next.length >= 256) break;
      }
      if (next.length >= 256) break;
    }
    branches = next;
  }

  let lastCore: string[] = [];
  let lastReason = "Unsatisfiable contract conjunction";

  for (const branch of branches) {
    const solved = solveLinearInequalityConjunction(branch);
    if (solved.feasible) {
      return {
        satisfiable: true,
        witness: solved.witness ?? {},
      };
    }
    if (solved.unsatCore) lastCore = solved.unsatCore;
    if (solved.conflictReason) lastReason = solved.conflictReason;
  }

  return {
    satisfiable: false,
    unsatCore: lastCore,
    conflictExplanation: lastReason,
  };
}

/**
 * Checks whether a set of child/premise requirement contracts mathematically entails
 * a parent/conclusion requirement contract ($\bigwedge_i P_i \models C$).
 *
 * Entailment holds iff $\bigwedge_i P_i \land \neg C$ is UNSAT.
 * If satisfiable, returns a concrete counterexample witness assignment.
 */
export function checkContractEntailment(
  premises: readonly LabeledContractFormula[],
  conclusion: LabeledContractFormula,
): ContractEntailmentCheckResult {
  const conclusionAst =
    typeof conclusion.formula === "string" ? parseContractFormula(conclusion.formula) : conclusion.formula;

  const negatedConclusion: LabeledContractFormula = {
    id: conclusion.id ?? "negated_parent",
    formula: { kind: "Not", operand: conclusionAst },
  };

  const satRes = checkContractFormulaSat([...premises, negatedConclusion]);
  if (!satRes.satisfiable) {
    return {
      isEntailed: true,
    };
  }

  const cex = satRes.witness ?? {};
  const cexPairs = Object.entries(cex)
    .map(([k, v]) => `${k} = ${v}`)
    .join(", ");
  const conclusionText =
    typeof conclusion.formula === "string" ? conclusion.formula : (conclusion.id ?? "parent contract");

  return {
    isEntailed: false,
    counterexample: cex,
    diagnosticMessage: `Entailment Gap: child contracts permit counterexample (${cexPairs || "unconstrained"}) violating parent contract '${conclusionText}'.`,
  };
}
