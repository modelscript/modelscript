// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Lightweight, secure expression evaluator for Property Inspector
 * conditions (`enabledIf`, `visibleIf`). Supports Modelica boolean and relational syntax
 * (`not`, `and`, `or`, `==`, `<>`, `<`, `>`, `size(...)`), standard JS operators (`!`, `&&`, `||`, `!=`),
 * and identifier resolution against component property values.
 */

export type PropertyContextValues = Record<string, any>;

type TokenType =
  | "NUMBER"
  | "STRING"
  | "IDENT"
  | "NOT"
  | "AND"
  | "OR"
  | "EQ"
  | "NEQ"
  | "LTE"
  | "GTE"
  | "LT"
  | "GT"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "EOF";

interface Token {
  type: TokenType;
  value: any;
  pos: number;
}

class Tokenizer {
  private pos = 0;

  constructor(private input: string) {}

  nextToken(): Token {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }

    if (this.pos >= this.input.length) {
      return { type: "EOF", value: null, pos: this.pos };
    }

    const start = this.pos;
    const ch = this.input[this.pos];

    // Parentheses & comma
    if (ch === "(") {
      this.pos++;
      return { type: "LPAREN", value: "(", pos: start };
    }
    if (ch === ")") {
      this.pos++;
      return { type: "RPAREN", value: ")", pos: start };
    }
    if (ch === ",") {
      this.pos++;
      return { type: "COMMA", value: ",", pos: start };
    }

    // String literals
    if (ch === '"' || ch === "'") {
      const quote = ch;
      this.pos++;
      let str = "";
      while (this.pos < this.input.length && this.input[this.pos] !== quote) {
        if (this.input[this.pos] === "\\" && this.pos + 1 < this.input.length) {
          this.pos++;
        }
        str += this.input[this.pos];
        this.pos++;
      }
      if (this.pos < this.input.length) this.pos++; // consume closing quote
      return { type: "STRING", value: str, pos: start };
    }

    // Operators
    if (this.input.startsWith("==", this.pos)) {
      this.pos += 2;
      return { type: "EQ", value: "==", pos: start };
    }
    if (this.input.startsWith("!=", this.pos) || this.input.startsWith("<>", this.pos)) {
      this.pos += 2;
      return { type: "NEQ", value: "!=", pos: start };
    }
    if (this.input.startsWith("<=", this.pos)) {
      this.pos += 2;
      return { type: "LTE", value: "<=", pos: start };
    }
    if (this.input.startsWith(">=", this.pos)) {
      this.pos += 2;
      return { type: "GTE", value: ">=", pos: start };
    }
    if (this.input.startsWith("&&", this.pos)) {
      this.pos += 2;
      return { type: "AND", value: "&&", pos: start };
    }
    if (this.input.startsWith("||", this.pos)) {
      this.pos += 2;
      return { type: "OR", value: "||", pos: start };
    }
    if (ch === "!") {
      this.pos++;
      return { type: "NOT", value: "!", pos: start };
    }
    if (ch === "<") {
      this.pos++;
      return { type: "LT", value: "<", pos: start };
    }
    if (ch === ">") {
      this.pos++;
      return { type: "GT", value: ">", pos: start };
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      let numStr = "";
      while (this.pos < this.input.length && /[0-9.]/.test(this.input[this.pos])) {
        numStr += this.input[this.pos];
        this.pos++;
      }
      return { type: "NUMBER", value: parseFloat(numStr), pos: start };
    }

    // Identifiers and Keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (this.pos < this.input.length && /[a-zA-Z0-9_.]/.test(this.input[this.pos])) {
        ident += this.input[this.pos];
        this.pos++;
      }

      const lower = ident.toLowerCase();
      if (lower === "not") return { type: "NOT", value: "not", pos: start };
      if (lower === "and") return { type: "AND", value: "and", pos: start };
      if (lower === "or") return { type: "OR", value: "or", pos: start };

      return { type: "IDENT", value: ident, pos: start };
    }

    // Advance unknown char to prevent infinite loop
    this.pos++;
    return this.nextToken();
  }
}

class ExpressionParser {
  private current: Token;

  constructor(
    private tokenizer: Tokenizer,
    private values: PropertyContextValues,
  ) {
    this.current = this.tokenizer.nextToken();
  }

  private eat(type: TokenType): Token {
    const token = this.current;
    if (token.type === type) {
      this.current = this.tokenizer.nextToken();
      return token;
    }
    throw new Error(`Unexpected token ${token.type} (expected ${type}) at pos ${token.pos}`);
  }

  public parse(): any {
    const res = this.parseOr();
    return res;
  }

  // expr -> orExpr
  private parseOr(): any {
    let left = this.parseAnd();
    while (this.current.type === "OR") {
      this.eat("OR");
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  // andExpr -> compExpr ( AND compExpr )*
  private parseAnd(): any {
    let left = this.parseComp();
    while (this.current.type === "AND") {
      this.eat("AND");
      const right = this.parseComp();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  // compExpr -> unaryExpr ( ( == | != | < | <= | > | >= ) unaryExpr )?
  private parseComp(): any {
    let left = this.parseUnary();
    if (
      this.current.type === "EQ" ||
      this.current.type === "NEQ" ||
      this.current.type === "LT" ||
      this.current.type === "LTE" ||
      this.current.type === "GT" ||
      this.current.type === "GTE"
    ) {
      const op = this.current.type;
      this.eat(op);
      const right = this.parseUnary();

      // Normalize string/numeric comparisons
      const l = typeof left === "string" && !isNaN(Number(left)) && typeof right === "number" ? Number(left) : left;
      const r = typeof right === "string" && !isNaN(Number(right)) && typeof left === "number" ? Number(right) : right;

      switch (op) {
        case "EQ":
          return String(l) === String(r);
        case "NEQ":
          return String(l) !== String(r);
        case "LT":
          return Number(l) < Number(r);
        case "LTE":
          return Number(l) <= Number(r);
        case "GT":
          return Number(l) > Number(r);
        case "GTE":
          return Number(l) >= Number(r);
      }
    }
    return left;
  }

  // unaryExpr -> ( NOT ) unaryExpr | primary
  private parseUnary(): any {
    if (this.current.type === "NOT") {
      this.eat("NOT");
      return !this.toBoolean(this.parseUnary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): any {
    const token = this.current;
    if (token.type === "NUMBER") {
      this.eat("NUMBER");
      return token.value;
    }
    if (token.type === "STRING") {
      this.eat("STRING");
      return token.value;
    }
    if (token.type === "LPAREN") {
      this.eat("LPAREN");
      const val = this.parseOr();
      this.eat("RPAREN");
      return val;
    }
    if (token.type === "IDENT") {
      const ident = token.value;
      this.eat("IDENT");

      // Check function call: size(cT, 1) or len(x)
      if (this.current.type === "LPAREN") {
        this.eat("LPAREN");
        const args: any[] = [];
        if ((this.current.type as TokenType) !== "RPAREN") {
          args.push(this.parseOr());
          while ((this.current.type as TokenType) === "COMMA") {
            this.eat("COMMA");
            args.push(this.parseOr());
          }
        }
        this.eat("RPAREN");
        return this.evaluateFunction(ident, args);
      }

      // Literal boolean keywords
      if (ident.toLowerCase() === "true") return true;
      if (ident.toLowerCase() === "false") return false;

      // Variable lookup in property context
      return this.resolveIdentifier(ident);
    }

    throw new Error(`Unexpected token ${token.type} at pos ${token.pos}`);
  }

  private toBoolean(val: any): boolean {
    if (val === true || val === "true" || val === 1) return true;
    if (val === false || val === "false" || val === 0 || val === null || val === undefined || val === "") return false;
    return Boolean(val);
  }

  private resolveIdentifier(ident: string): any {
    if (ident in this.values) {
      return this.values[ident];
    }
    // Check without prefix/suffix
    const short = ident.split(".").pop();
    if (short && short in this.values) {
      return this.values[short];
    }
    return undefined;
  }

  private evaluateFunction(name: string, args: any[]): any {
    const fn = name.toLowerCase();
    if (fn === "size") {
      const target = args[0];
      if (Array.isArray(target)) return target.length;
      if (typeof target === "string") {
        // e.g., matrix format or table
        if (target.startsWith("{") || target.startsWith("[")) {
          const rows = target.split(";");
          return rows.length;
        }
        return target.length > 0 ? 1 : 0;
      }
      return target !== undefined && target !== null && target !== "" ? 1 : 0;
    }
    if (fn === "len" || fn === "length") {
      const target = args[0];
      return Array.isArray(target) ? target.length : target ? String(target).length : 0;
    }
    return 0;
  }
}

/**
 * Evaluates an enabledIf or visibleIf predicate against current component property values.
 * Returns true if predicate is satisfied (or if predicate is empty/absent).
 */
export function evaluatePropertyPredicate(
  predicate: string | ((ctx: any) => boolean) | undefined | null,
  values: PropertyContextValues = {},
): boolean {
  if (predicate === undefined || predicate === null || predicate === "") {
    return true;
  }

  if (typeof predicate === "function") {
    try {
      return Boolean(predicate(values));
    } catch {
      return true;
    }
  }

  const trimmed = predicate.trim();
  if (trimmed === "") return true;

  try {
    const tokenizer = new Tokenizer(trimmed);
    const parser = new ExpressionParser(tokenizer, values);
    const result = parser.parse();
    if (typeof result === "boolean") return result;
    if (result === "true" || result === 1) return true;
    if (result === "false" || result === 0 || !result) return false;
    return Boolean(result);
  } catch (e) {
    // If parsing fails, fall back to safe identifier check or default to true
    if (trimmed.startsWith("!")) {
      const id = trimmed.slice(1).trim();
      const val = values[id];
      return val === false || val === "false" || !val;
    }
    if (trimmed.toLowerCase().startsWith("not ")) {
      const id = trimmed.slice(4).trim();
      const val = values[id];
      return val === false || val === "false" || !val;
    }
    const val = values[trimmed];
    if (val !== undefined) {
      return val === true || val === "true";
    }
    return true;
  }
}
