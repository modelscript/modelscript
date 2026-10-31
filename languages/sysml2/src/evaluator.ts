// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview SysML v2 Compound Boolean & Arithmetic Expression Parser and Evaluator.
 *
 * Supports full operator precedence for SysML v2 / KerML constraint and attribute expressions:
 * - Implication: `implies`, `=>`
 * - Disjunction / XOR: `or`, `||`, `xor`
 * - Conjunction: `and`, `&&`
 * - Logical Negation: `not`, `!`
 * - Relational Comparisons: `<=`, `>=`, `==`, `!=`, `<`, `>`, `=`
 * - Additive Arithmetic: `+`, `-`
 * - Multiplicative Arithmetic: `*`, `/`, `%`
 * - Exponentiation: `^`, `**`
 * - Unary Arithmetic: `-`, `+`
 * - Parentheses `(...)`, qualified feature paths (`vehicle.engine.power`), and math functions (`abs`, `sqrt`, `min`, `max`, `pow`, `sin`, `cos`).
 */

export type SysML2BinaryOp =
  | "implies"
  | "or"
  | "xor"
  | "and"
  | "=="
  | "!="
  | "<="
  | ">="
  | "<"
  | ">"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "^";

export type SysML2ExprAst =
  | { kind: "NumberLiteral"; value: number }
  | { kind: "BooleanLiteral"; value: boolean }
  | { kind: "StringLiteral"; value: string }
  | { kind: "Identifier"; name: string }
  | { kind: "UnaryExpr"; op: "not" | "-" | "+"; operand: SysML2ExprAst }
  | { kind: "BinaryExpr"; op: SysML2BinaryOp; left: SysML2ExprAst; right: SysML2ExprAst }
  | { kind: "ConditionalExpr"; condition: SysML2ExprAst; thenExpr: SysML2ExprAst; elseExpr: SysML2ExprAst }
  | { kind: "CallExpr"; callee: string; args: SysML2ExprAst[] };

export interface AtomicComparisonConstraint {
  lhs: string;
  lhsAst: SysML2ExprAst;
  operator: "<=" | ">=" | "==" | "!=" | "<" | ">";
  rhs: string;
  rhsAst: SysML2ExprAst;
  negated: boolean;
  expression: string;
}

export interface EvaluatedConstraintOutcome {
  satisfied: boolean;
  /** Quantitative robustness margin (> 0 satisfied, < 0 violated). */
  margin: number;
  value: number | boolean | string;
  violatedAtoms: string[];
}

interface Token {
  type: "number" | "ident" | "string" | "op" | "punct" | "eof";
  text: string;
}

function tokenizeSysML2Expr(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "/" && input[i + 1] === "/") {
      i += 2;
      while (i < n && input[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < n && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // Strip SI unit bracket annotations like `100 [kg]` or `[N*m]` when preceded by a number
    if (ch === "[") {
      const prev = tokens[tokens.length - 1];
      if (prev && prev.type === "number") {
        i++;
        while (i < n && input[i] !== "]") i++;
        if (i < n) i++;
        continue;
      }
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = ++i;
      while (i < n && input[i] !== quote) {
        if (input[i] === "\\") i++;
        i++;
      }
      const str = input.slice(start, i);
      if (i < n) i++;
      tokens.push({ type: "string", text: str });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(input[i + 1] ?? ""))) {
      const start = i;
      while (i < n && /[0-9]/.test(input[i]!)) i++;
      if (i < n && input[i] === ".") {
        i++;
        while (i < n && /[0-9]/.test(input[i]!)) i++;
      }
      if (i < n && (input[i] === "e" || input[i] === "E")) {
        i++;
        if (i < n && (input[i] === "+" || input[i] === "-")) i++;
        while (i < n && /[0-9]/.test(input[i]!)) i++;
      }
      tokens.push({ type: "number", text: input.slice(start, i) });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i++;
      while (i < n && /[A-Za-z0-9_.]/.test(input[i]!)) {
        // Don't consume trailing dot if not followed by identifier char
        if (input[i] === "." && !/[A-Za-z_]/.test(input[i + 1] ?? "")) break;
        i++;
      }
      const word = input.slice(start, i);
      const lower = word.toLowerCase();
      if (lower === "and" || lower === "or" || lower === "xor" || lower === "implies" || lower === "not") {
        tokens.push({ type: "op", text: lower });
      } else {
        tokens.push({ type: "ident", text: word });
      }
      continue;
    }
    const two = input.slice(i, i + 2);
    if (
      two === "<=" ||
      two === ">=" ||
      two === "==" ||
      two === "!=" ||
      two === "<>" ||
      two === "&&" ||
      two === "||" ||
      two === "=>" ||
      two === "->" ||
      two === "**"
    ) {
      const norm =
        two === "&&"
          ? "and"
          : two === "||"
            ? "or"
            : two === "=>" || two === "->"
              ? "implies"
              : two === "<>"
                ? "!="
                : two === "**"
                  ? "^"
                  : two;
      tokens.push({ type: "op", text: norm });
      i += 2;
      continue;
    }
    if ("+-*/%^<>!=".includes(ch)) {
      const norm = ch === "!" ? "not" : ch === "=" ? "==" : ch;
      tokens.push({ type: "op", text: norm });
      i++;
      continue;
    }
    if ("(),?:;{}".includes(ch)) {
      tokens.push({ type: "punct", text: ch });
      i++;
      continue;
    }
    i++;
  }

  tokens.push({ type: "eof", text: "" });
  return tokens;
}

/**
 * Strips outer `require constraint { ... }` or `assert constraint name { ... }` wrappers
 * and joins multiple semicolon-separated statements inside a constraint block with `and`.
 */
export function unwrapConstraintBody(rawText: string): string {
  let text = rawText.trim();
  const openBrace = text.indexOf("{");
  const closeBrace = text.lastIndexOf("}");
  if (openBrace !== -1 && closeBrace > openBrace) {
    text = text.slice(openBrace + 1, closeBrace).trim();
  }
  // Remove inner doc/comment statements or attribute declarations if present, keeping expression statements
  const parts = text
    .split(";")
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      if (/^(?:doc|comment|attribute|in|out|inout|subject|objective)\b/i.test(s)) return false;
      return true;
    })
    .map((s) =>
      s
        .replace(/^(?:require\s+constraint|assert\s+constraint|assume\s+constraint|constraint)\b[^{]*\{?/i, "")
        .replace(/\}$/, "")
        .trim(),
    )
    .filter(Boolean);

  if (parts.length === 0) return text.replace(/;+$/, "").trim();
  if (parts.length === 1) return parts[0]!;
  return parts.map((p) => `(${p})`).join(" and ");
}

/**
 * Parses a SysML v2 boolean/arithmetic expression string into a typed `SysML2ExprAst`.
 */
export function parseSysML2Expression(exprText: string): SysML2ExprAst {
  const cleaned = unwrapConstraintBody(exprText);
  const tokens = tokenizeSysML2Expr(cleaned);
  let pos = 0;

  const peek = (): Token => tokens[pos] ?? tokens[tokens.length - 1]!;
  const next = (): Token => {
    const t = peek();
    if (pos < tokens.length - 1) pos++;
    return t;
  };
  const match = (text: string): boolean => {
    if (peek().text === text) {
      next();
      return true;
    }
    return false;
  };

  function parseImplies(): SysML2ExprAst {
    let left = parseOr();
    if (match("implies")) {
      const right = parseImplies(); // right-associative
      left = { kind: "BinaryExpr", op: "implies", left, right };
    } else if (match("?")) {
      const thenExpr = parseImplies();
      match(":");
      const elseExpr = parseImplies();
      left = { kind: "ConditionalExpr", condition: left, thenExpr, elseExpr };
    } else if (peek().type === "ident" && peek().text === "if") {
      next();
      const cond = parseImplies();
      if (peek().text === "then") next();
      const thenExpr = parseImplies();
      if (peek().text === "else") next();
      const elseExpr = parseImplies();
      left = { kind: "ConditionalExpr", condition: cond, thenExpr, elseExpr };
    }
    return left;
  }

  function parseOr(): SysML2ExprAst {
    let left = parseAnd();
    while (peek().text === "or" || peek().text === "xor") {
      const op = next().text as "or" | "xor";
      const right = parseAnd();
      left = { kind: "BinaryExpr", op, left, right };
    }
    return left;
  }

  function parseAnd(): SysML2ExprAst {
    let left = parseNot();
    while (peek().text === "and") {
      next();
      const right = parseNot();
      left = { kind: "BinaryExpr", op: "and", left, right };
    }
    return left;
  }

  function parseNot(): SysML2ExprAst {
    if (match("not")) {
      return { kind: "UnaryExpr", op: "not", operand: parseNot() };
    }
    return parseComparison();
  }

  function parseComparison(): SysML2ExprAst {
    let left = parseAdditive();
    while (
      peek().text === "<=" ||
      peek().text === ">=" ||
      peek().text === "==" ||
      peek().text === "!=" ||
      peek().text === "<" ||
      peek().text === ">"
    ) {
      const op = next().text as "<=" | ">=" | "==" | "!=" | "<" | ">";
      const right = parseAdditive();
      left = { kind: "BinaryExpr", op, left, right };
    }
    return left;
  }

  function parseAdditive(): SysML2ExprAst {
    let left = parseMultiplicative();
    while (peek().text === "+" || peek().text === "-") {
      const op = next().text as "+" | "-";
      const right = parseMultiplicative();
      left = { kind: "BinaryExpr", op, left, right };
    }
    return left;
  }

  function parseMultiplicative(): SysML2ExprAst {
    let left = parsePower();
    while (peek().text === "*" || peek().text === "/" || peek().text === "%") {
      const op = next().text as "*" | "/" | "%";
      const right = parsePower();
      left = { kind: "BinaryExpr", op, left, right };
    }
    return left;
  }

  function parsePower(): SysML2ExprAst {
    const left = parseUnary();
    if (match("^")) {
      const right = parsePower();
      return { kind: "BinaryExpr", op: "^", left, right };
    }
    return left;
  }

  function parseUnary(): SysML2ExprAst {
    if (match("-")) {
      return { kind: "UnaryExpr", op: "-", operand: parseUnary() };
    }
    if (match("+")) {
      return { kind: "UnaryExpr", op: "+", operand: parseUnary() };
    }
    if (match("not")) {
      return { kind: "UnaryExpr", op: "not", operand: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): SysML2ExprAst {
    const tok = peek();
    if (tok.type === "number") {
      next();
      return { kind: "NumberLiteral", value: Number(tok.text) };
    }
    if (tok.type === "string") {
      next();
      return { kind: "StringLiteral", value: tok.text };
    }
    if (tok.type === "ident") {
      next();
      if (tok.text === "true" || tok.text === "TRUE") {
        return { kind: "BooleanLiteral", value: true };
      }
      if (tok.text === "false" || tok.text === "FALSE") {
        return { kind: "BooleanLiteral", value: false };
      }
      if (tok.text === "if") {
        const cond = parseImplies();
        if (peek().text === "then") next();
        const thenExpr = parseImplies();
        if (peek().text === "else") next();
        const elseExpr = parseImplies();
        return { kind: "ConditionalExpr", condition: cond, thenExpr, elseExpr };
      }
      if (match("(")) {
        const args: SysML2ExprAst[] = [];
        while (peek().type !== "eof" && peek().text !== ")") {
          args.push(parseImplies());
          if (!match(",")) break;
        }
        match(")");
        return { kind: "CallExpr", callee: tok.text, args };
      }
      return { kind: "Identifier", name: tok.text };
    }
    if (match("(")) {
      const inner = parseImplies();
      match(")");
      return inner;
    }
    next();
    return { kind: "NumberLiteral", value: 0 };
  }

  return parseImplies();
}

/**
 * Formats a `SysML2ExprAst` back into canonical infix text.
 */
export function formatSysML2Expr(ast: SysML2ExprAst): string {
  switch (ast.kind) {
    case "NumberLiteral":
      return String(ast.value);
    case "BooleanLiteral":
      return String(ast.value);
    case "StringLiteral":
      return `"${ast.value}"`;
    case "Identifier":
      return ast.name;
    case "UnaryExpr":
      return ast.op === "not" ? `not (${formatSysML2Expr(ast.operand)})` : `${ast.op}${formatSysML2Expr(ast.operand)}`;
    case "BinaryExpr":
      return `${formatSysML2Expr(ast.left)} ${ast.op} ${formatSysML2Expr(ast.right)}`;
    case "ConditionalExpr":
      return `if ${formatSysML2Expr(ast.condition)} then ${formatSysML2Expr(ast.thenExpr)} else ${formatSysML2Expr(ast.elseExpr)}`;
    case "CallExpr":
      return `${ast.callee}(${ast.args.map(formatSysML2Expr).join(", ")})`;
  }
}

function resolveIdentifierInEnv(
  name: string,
  env: Readonly<Record<string, number | boolean | string>>,
): number | boolean | string | undefined {
  if (name in env) return env[name];
  // Fallback: try unqualified leaf name (`sled.mass` -> `mass`) or vice-versa
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx !== -1) {
    const shortName = name.slice(dotIdx + 1);
    if (shortName in env) return env[shortName];
  } else {
    for (const [k, v] of Object.entries(env)) {
      if (k.endsWith(`.${name}`)) return v;
    }
  }
  return undefined;
}

/**
 * Evaluates a `SysML2ExprAst` or expression string within `env`.
 */
export function evaluateSysML2Expression(
  exprOrAst: string | SysML2ExprAst,
  env: Readonly<Record<string, number | boolean | string>> = {},
): number | boolean | string {
  const ast = typeof exprOrAst === "string" ? parseSysML2Expression(exprOrAst) : exprOrAst;

  switch (ast.kind) {
    case "NumberLiteral":
      return ast.value;
    case "BooleanLiteral":
      return ast.value;
    case "StringLiteral":
      return ast.value;
    case "Identifier": {
      const resolved = resolveIdentifierInEnv(ast.name, env);
      return resolved !== undefined ? resolved : Number.NaN;
    }
    case "UnaryExpr": {
      const val = evaluateSysML2Expression(ast.operand, env);
      if (ast.op === "not") return !val;
      if (ast.op === "-") return -Number(val);
      return Number(val);
    }
    case "ConditionalExpr": {
      const cond = Boolean(evaluateSysML2Expression(ast.condition, env));
      return cond ? evaluateSysML2Expression(ast.thenExpr, env) : evaluateSysML2Expression(ast.elseExpr, env);
    }
    case "CallExpr": {
      const vals = ast.args.map((a) => Number(evaluateSysML2Expression(a, env)));
      const x = vals[0] ?? 0;
      const y = vals[1] ?? 0;
      switch (ast.callee.toLowerCase()) {
        case "abs":
          return Math.abs(x);
        case "sqrt":
          return Math.sqrt(x);
        case "min":
          return Math.min(...vals);
        case "max":
          return Math.max(...vals);
        case "pow":
          return Math.pow(x, y);
        case "sin":
          return Math.sin(x);
        case "cos":
          return Math.cos(x);
        case "tan":
          return Math.tan(x);
        case "exp":
          return Math.exp(x);
        case "ln":
        case "log":
          return Math.log(x);
        case "floor":
          return Math.floor(x);
        case "ceil":
          return Math.ceil(x);
        case "round":
          return Math.round(x);
        default:
          return x;
      }
    }
    case "BinaryExpr": {
      if (ast.op === "and") {
        const l = Boolean(evaluateSysML2Expression(ast.left, env));
        if (!l) return false;
        return Boolean(evaluateSysML2Expression(ast.right, env));
      }
      if (ast.op === "or") {
        const l = Boolean(evaluateSysML2Expression(ast.left, env));
        if (l) return true;
        return Boolean(evaluateSysML2Expression(ast.right, env));
      }
      if (ast.op === "xor") {
        const l = Boolean(evaluateSysML2Expression(ast.left, env));
        const r = Boolean(evaluateSysML2Expression(ast.right, env));
        return l !== r;
      }
      if (ast.op === "implies") {
        const l = Boolean(evaluateSysML2Expression(ast.left, env));
        if (!l) return true;
        return Boolean(evaluateSysML2Expression(ast.right, env));
      }

      const lv = evaluateSysML2Expression(ast.left, env);
      const rv = evaluateSysML2Expression(ast.right, env);
      const ln = Number(lv);
      const rn = Number(rv);

      switch (ast.op) {
        case "+":
          return typeof lv === "string" || typeof rv === "string" ? `${lv}${rv}` : ln + rn;
        case "-":
          return ln - rn;
        case "*":
          return ln * rn;
        case "/":
          return rn !== 0 ? ln / rn : Number.NaN;
        case "%":
          return ln % rn;
        case "^":
          return Math.pow(ln, rn);
        case "<=":
          return ln <= rn + 1e-9;
        case ">=":
          return ln >= rn - 1e-9;
        case "<":
          return ln < rn - 1e-9;
        case ">":
          return ln > rn + 1e-9;
        case "==":
          if (typeof lv === "number" && typeof rv === "number") {
            return Math.abs(ln - rn) <= 1e-9;
          }
          return lv === rv;
        case "!=":
          if (typeof lv === "number" && typeof rv === "number") {
            return Math.abs(ln - rn) > 1e-9;
          }
          return lv !== rv;
      }
    }
  }
}

/**
 * Evaluates a compound boolean/arithmetic constraint with quantitative STL/robustness margin:
 * - `and` -> `min(margin(L), margin(R))`
 * - `or` -> `max(margin(L), margin(R))`
 * - `not` -> `-margin(operand)`
 * - `implies` -> `max(-margin(L), margin(R))`
 * - `a <= b` -> `b - a`
 * - `a >= b` -> `a - b`
 * - `a == b` -> `-|a - b|`
 */
export function evaluateSysML2Constraint(
  exprOrAst: string | SysML2ExprAst,
  env: Readonly<Record<string, number | boolean | string>> = {},
): EvaluatedConstraintOutcome {
  const ast = typeof exprOrAst === "string" ? parseSysML2Expression(exprOrAst) : exprOrAst;
  const violatedAtoms: string[] = [];

  function evalMargin(node: SysML2ExprAst): { sat: boolean; margin: number } {
    if (node.kind === "BooleanLiteral") {
      return { sat: node.value, margin: node.value ? Infinity : -Infinity };
    }
    if (node.kind === "Identifier") {
      const v = resolveIdentifierInEnv(node.name, env);
      const b = Boolean(v);
      return { sat: b, margin: b ? 1 : -1 };
    }
    if (node.kind === "UnaryExpr" && node.op === "not") {
      const prevLen = violatedAtoms.length;
      const inner = evalMargin(node.operand);
      const sat = !inner.sat;
      violatedAtoms.length = prevLen;
      if (!sat) violatedAtoms.push(formatSysML2Expr(node));
      return { sat, margin: -inner.margin };
    }
    if (node.kind === "BinaryExpr") {
      if (node.op === "and") {
        const l = evalMargin(node.left);
        const r = evalMargin(node.right);
        return { sat: l.sat && r.sat, margin: Math.min(l.margin, r.margin) };
      }
      if (node.op === "or") {
        const prevLen = violatedAtoms.length;
        const l = evalMargin(node.left);
        const r = evalMargin(node.right);
        const sat = l.sat || r.sat;
        if (sat) violatedAtoms.length = prevLen;
        return { sat, margin: Math.max(l.margin, r.margin) };
      }
      if (node.op === "xor") {
        const prevLen = violatedAtoms.length;
        const l = evalMargin(node.left);
        const r = evalMargin(node.right);
        const sat = l.sat !== r.sat;
        if (sat) violatedAtoms.length = prevLen;
        return { sat, margin: sat ? Math.abs(l.margin - r.margin) || 1 : -1 };
      }
      if (node.op === "implies") {
        const prevLen = violatedAtoms.length;
        const l = evalMargin(node.left);
        const r = evalMargin(node.right);
        const sat = !l.sat || r.sat;
        if (sat) {
          violatedAtoms.length = prevLen;
        }
        return { sat, margin: Math.max(-l.margin, r.margin) };
      }

      if (
        node.op === "<=" ||
        node.op === ">=" ||
        node.op === "<" ||
        node.op === ">" ||
        node.op === "==" ||
        node.op === "!="
      ) {
        const lv = evaluateSysML2Expression(node.left, env);
        const rv = evaluateSysML2Expression(node.right, env);
        const ln = Number(lv);
        const rn = Number(rv);
        if (Number.isNaN(ln) || Number.isNaN(rn)) {
          const eqSat = node.op === "==" ? lv === rv : node.op === "!=" ? lv !== rv : false;
          if (!eqSat) violatedAtoms.push(formatSysML2Expr(node));
          return { sat: eqSat, margin: eqSat ? 0 : -1 };
        }
        let margin = 0;
        let sat = false;
        switch (node.op) {
          case "<=":
            margin = rn - ln;
            sat = margin >= -1e-9;
            break;
          case "<":
            margin = rn - ln;
            sat = margin > 1e-9;
            break;
          case ">=":
            margin = ln - rn;
            sat = margin >= -1e-9;
            break;
          case ">":
            margin = ln - rn;
            sat = margin > 1e-9;
            break;
          case "==":
            margin = -Math.abs(ln - rn);
            sat = Math.abs(ln - rn) <= 1e-9;
            break;
          case "!=":
            margin = Math.abs(ln - rn);
            sat = margin > 1e-9;
            break;
        }
        if (!sat) violatedAtoms.push(formatSysML2Expr(node));
        return { sat, margin };
      }
    }

    const v = evaluateSysML2Expression(node, env);
    const sat = Boolean(v);
    if (!sat) violatedAtoms.push(formatSysML2Expr(node));
    return { sat, margin: sat ? 1 : -1 };
  }

  const { sat, margin } = evalMargin(ast);
  return {
    satisfied: sat,
    margin,
    value: sat,
    violatedAtoms,
  };
}

/**
 * Extracts all atomic relational comparisons from a `SysML2ExprAst` or expression string.
 */
export function extractAtomicComparisons(exprOrAst: string | SysML2ExprAst): AtomicComparisonConstraint[] {
  const ast = typeof exprOrAst === "string" ? parseSysML2Expression(exprOrAst) : exprOrAst;
  const out: AtomicComparisonConstraint[] = [];

  function visit(node: SysML2ExprAst, negated: boolean): void {
    if (node.kind === "UnaryExpr" && node.op === "not") {
      visit(node.operand, !negated);
      return;
    }
    if (node.kind === "BinaryExpr") {
      if (node.op === "and" || node.op === "or" || node.op === "xor") {
        visit(node.left, negated);
        visit(node.right, negated);
        return;
      }
      if (node.op === "implies") {
        visit(node.left, !negated);
        visit(node.right, negated);
        return;
      }
      if (
        node.op === "<=" ||
        node.op === ">=" ||
        node.op === "<" ||
        node.op === ">" ||
        node.op === "==" ||
        node.op === "!="
      ) {
        const lhs = formatSysML2Expr(node.left);
        const rhs = formatSysML2Expr(node.right);
        out.push({
          lhs,
          lhsAst: node.left,
          operator: node.op,
          rhs,
          rhsAst: node.right,
          negated,
          expression: `${lhs} ${node.op} ${rhs}`,
        });
      }
    }
  }

  visit(ast, false);
  return out;
}
