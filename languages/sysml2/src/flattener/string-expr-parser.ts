// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, UnaryOp, type DAEBuilder } from "@modelscript/runtime";

/**
 * Lexical token produced by `tokenizeSysml` for lightweight expression/statement parsing.
 */
export interface SysML2Token {
  /** Token classification (`num`, `ident`, `op`, `paren`, `semi`, or `kw`). */
  type: "num" | "ident" | "op" | "paren" | "semi" | "kw";
  /** Raw token lexeme string. */
  val: string;
}

export const SYSML_KEYWORDS = new Set([
  "action",
  "calc",
  "def",
  "in",
  "out",
  "item",
  "attribute",
  "assign",
  "return",
  "if",
  "else",
  "while",
  "loop",
  "true",
  "false",
  "and",
  "or",
  "not",
]);

/**
 * Tokenizes simple SysML v2 calculation expressions and statements without regular expressions.
 */
export function tokenizeSysml(input: string): SysML2Token[] {
  const tokens: SysML2Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i]!;

    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }

    // Skip single-line comments //
    if (ch === "/" && i + 1 < len && input[i + 1] === "/") {
      i += 2;
      while (i < len && input[i] !== "\n") i++;
      continue;
    }

    // Skip block comments /* ... */
    if (ch === "/" && i + 1 < len && input[i + 1] === "*") {
      i += 2;
      while (i + 1 < len && !(input[i] === "*" && input[i + 1] === "/")) i++;
      if (i + 1 < len) i += 2;
      continue;
    }

    // Number: \d+(?:\.\d+)?(?:[eE][+-]?\d+)?
    if (ch >= "0" && ch <= "9") {
      const start = i;
      i++;
      let hasDot = false;
      let hasExp = false;
      while (i < len) {
        const c = input[i]!;
        if (c >= "0" && c <= "9") {
          i++;
        } else if (c === "." && !hasDot && !hasExp && i + 1 < len && input[i + 1]! >= "0" && input[i + 1]! <= "9") {
          hasDot = true;
          i++;
        } else if ((c === "e" || c === "E") && !hasExp) {
          hasExp = true;
          i++;
          if (i < len && (input[i] === "+" || input[i] === "-")) {
            i++;
          }
        } else {
          break;
        }
      }
      tokens.push({ type: "num", val: input.slice(start, i) });
      continue;
    }

    // Ident / Keyword: [A-Za-z_][A-Za-z0-9_.]*
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      const start = i;
      i++;
      while (i < len) {
        const c = input[i]!;
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === ".") {
          i++;
        } else {
          break;
        }
      }
      const val = input.slice(start, i);
      if (SYSML_KEYWORDS.has(val)) {
        tokens.push({ type: "kw", val });
      } else {
        tokens.push({ type: "ident", val });
      }
      continue;
    }

    // Two-character operators: ==, !=, <=, >=, :=, &&, ||, **
    if (i + 1 < len) {
      const next = input[i + 1]!;
      if (
        (ch === "=" && next === "=") ||
        (ch === "!" && next === "=") ||
        (ch === "<" && next === "=") ||
        (ch === ">" && next === "=") ||
        (ch === ":" && next === "=") ||
        (ch === "&" && next === "&") ||
        (ch === "|" && next === "|") ||
        (ch === "*" && next === "*")
      ) {
        tokens.push({ type: "op", val: ch + next });
        i += 2;
        continue;
      }
    }

    // Single-character punctuation: [();{},]
    if (ch === "(" || ch === ")" || ch === "{" || ch === "}" || ch === ",") {
      tokens.push({ type: "paren", val: ch });
      i++;
      continue;
    }
    if (ch === ";") {
      tokens.push({ type: "semi", val: ch });
      i++;
      continue;
    }

    // Single-character operators: ^, +, -, *, /, %, =, <, >, !, :
    if (
      ch === "^" ||
      ch === "+" ||
      ch === "-" ||
      ch === "*" ||
      ch === "/" ||
      ch === "%" ||
      ch === "=" ||
      ch === "<" ||
      ch === ">" ||
      ch === "!" ||
      ch === ":"
    ) {
      tokens.push({ type: "op", val: ch });
      i++;
      continue;
    }

    // Any other character: skip
    i++;
  }

  return tokens;
}

/**
 * Pratt / recursive-descent expression parser generating linear-memory `DAEBuilder` `ExprId`s directly.
 *
 * @deprecated Prefer direct linear CST expression lowering via `lowerDirectCstExpression` in `expression-lowerer.ts`.
 * This parser is preserved as a fallback utility for string-based dynamic evaluation and fUML discrete expressions.
 */
export class SysmlExprParser {
  private pos = 0;

  /**
   * @param tokens - Token stream produced by `tokenizeSysml`.
   * @param arena - Target `DAEBuilder` arena to allocate expression nodes in.
   */
  constructor(
    private tokens: SysML2Token[],
    private arena: DAEBuilder,
  ) {}

  /**
   * Parses the token stream and returns the root `ExprId` in `this.arena`.
   */
  public parse(): number {
    return this.parseLogicalOr();
  }

  private peek(): SysML2Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): SysML2Token {
    return this.tokens[this.pos++]!;
  }

  private matchOp(...ops: string[]): string | null {
    const t = this.peek();
    if (t && (t.type === "op" || (t.type === "kw" && (t.val === "and" || t.val === "or"))) && ops.includes(t.val)) {
      this.pos++;
      return t.val;
    }
    return null;
  }

  private parseLogicalOr(): number {
    let left = this.parseLogicalAnd();
    while (this.matchOp("||", "or")) {
      const right = this.parseLogicalAnd();
      left = this.arena.addBinaryExpr(BinOp.Or, left, right);
    }
    return left;
  }

  private parseLogicalAnd(): number {
    let left = this.parseEquality();
    while (this.matchOp("&&", "and")) {
      const right = this.parseEquality();
      left = this.arena.addBinaryExpr(BinOp.And, left, right);
    }
    return left;
  }

  private parseEquality(): number {
    let left = this.parseRelational();
    let op: string | null;
    while ((op = this.matchOp("==", "!="))) {
      const right = this.parseRelational();
      left = this.arena.addBinaryExpr(op === "==" ? BinOp.Eq : BinOp.Neq, left, right);
    }
    return left;
  }

  private parseRelational(): number {
    let left = this.parseAdditive();
    let op: string | null;
    while ((op = this.matchOp("<", "<=", ">", ">="))) {
      const right = this.parseAdditive();
      const binOp = op === "<" ? BinOp.Lt : op === "<=" ? BinOp.Lte : op === ">" ? BinOp.Gt : BinOp.Gte;
      left = this.arena.addBinaryExpr(binOp, left, right);
    }
    return left;
  }

  private parseAdditive(): number {
    let left = this.parseMultiplicative();
    let op: string | null;
    while ((op = this.matchOp("+", "-"))) {
      const right = this.parseMultiplicative();
      left = this.arena.addBinaryExpr(op === "+" ? BinOp.Add : BinOp.Sub, left, right);
    }
    return left;
  }

  private parseMultiplicative(): number {
    let left = this.parsePower();
    let op: string | null;
    while ((op = this.matchOp("*", "/", "%"))) {
      const right = this.parsePower();
      if (op === "%") {
        left = this.arena.addCallExpr("mod", [left, right]);
      } else {
        left = this.arena.addBinaryExpr(op === "*" ? BinOp.Mul : BinOp.Div, left, right);
      }
    }
    return left;
  }

  private parsePower(): number {
    let left = this.parseUnary();
    while (this.matchOp("^", "**")) {
      const right = this.parseUnary();
      left = this.arena.addBinaryExpr(BinOp.Pow, left, right);
    }
    return left;
  }

  private parseUnary(): number {
    const t = this.peek();
    if (
      t &&
      (t.type === "op" || t.type === "kw") &&
      (t.val === "-" || t.val === "+" || t.val === "!" || t.val === "not")
    ) {
      this.pos++;
      const operand = this.parseUnary();
      if (t.val === "-") {
        return this.arena.addUnaryExpr(UnaryOp.Negate, operand);
      } else if (t.val === "+") {
        return operand;
      } else {
        return this.arena.addUnaryExpr(UnaryOp.Not, operand);
      }
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const t = this.next();
    if (!t) return this.arena.addRealLiteral(0);

    if (t.type === "num") {
      const val = parseFloat(t.val);
      return this.arena.addRealLiteral(val);
    }
    if (t.type === "kw") {
      if (t.val === "true") return this.arena.addBoolLiteral(true);
      if (t.val === "false") return this.arena.addBoolLiteral(false);
    }
    if (t.type === "ident") {
      let varName = t.val;
      while (this.peek() && this.peek()!.type === "paren" && this.peek()!.val === "[") {
        this.next(); // consume '['
        const idx = this.peek()?.val ?? "";
        this.next(); // consume index/num
        if (this.peek() && this.peek()!.type === "paren" && this.peek()!.val === "]") {
          this.next(); // consume ']'
        }
        varName += `[${idx}]`;
        if (this.peek() && this.peek()!.type === "ident" && this.peek()!.val.startsWith(".")) {
          varName += this.next().val;
        }
      }
      if (this.peek() && this.peek()!.type === "paren" && this.peek()!.val === "(") {
        this.next(); // consume '('
        const args: number[] = [];
        if (!(this.peek() && this.peek()!.type === "paren" && this.peek()!.val === ")")) {
          while (true) {
            args.push(this.parse());
            if (this.peek() && this.peek()!.val === ",") {
              this.next(); // consume ','
              continue;
            }
            break;
          }
        }
        if (this.peek() && this.peek()!.type === "paren" && this.peek()!.val === ")") {
          this.next(); // consume ')'
        }
        if (varName === "der" && args.length === 1) {
          return this.arena.addDerExpr(args[0]!);
        }
        return this.arena.addCallExpr(varName, args);
      }
      const nameId = this.arena.interner.intern(varName);
      return this.arena.addName(nameId);
    }
    if (t.type === "paren" && t.val === "(") {
      const expr = this.parse();
      if (this.peek() && this.peek()!.val === ")") {
        this.next();
      }
      return expr;
    }

    return this.arena.addRealLiteral(0);
  }
}

/**
 * Lowers an expression string into an arena ExprId.
 *
 * @deprecated Prefer direct linear CST lowering via `lowerDirectCstExpression` in `expression-lowerer.ts`.
 */
export function lowerSysmlExpr(exprText: string, arena: DAEBuilder): number {
  const tokens = tokenizeSysml(exprText);
  const parser = new SysmlExprParser(tokens, arena);
  return parser.parse();
}

/**
 * Prefixes local variable and port identifiers in an equation or expression string.
 */
export function prefixSysmlExpression(exprText: string, prefix: string, localNames: Set<string>): string {
  if (!prefix || localNames.size === 0) return exprText;
  const tokens = tokenizeSysml(exprText);
  const result: string[] = [];
  for (const t of tokens) {
    if (t.type === "ident") {
      const root = t.val.split(".")[0]!;
      if (localNames.has(root)) {
        result.push(prefix + t.val);
      } else {
        result.push(t.val);
      }
    } else {
      result.push(t.val);
    }
  }
  return result.join(" ");
}
