// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Formula evaluator and detector for Modelica/Morsel parameter expressions.
 * Provides safe arithmetic, constant and function evaluation with variable substitution.
 */

export interface FormulaResult {
  success: boolean;
  value?: number | boolean;
  formatted?: string;
  error?: string;
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  "modelica.constants.pi": Math.PI,
  e: Math.E,
  "modelica.constants.e": Math.E,
  eps: 1e-15,
  "modelica.constants.eps": 1e-15,
};

const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: (x) => Math.sqrt(x),
  abs: (x) => Math.abs(x),
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  asin: (x) => Math.asin(x),
  acos: (x) => Math.acos(x),
  atan: (x) => Math.atan(x),
  atan2: (y, x) => Math.atan2(y, x),
  exp: (x) => Math.exp(x),
  log: (x) => Math.log(x),
  log10: (x) => Math.log10(x),
  min: (a, b) => Math.min(a, b),
  max: (a, b) => Math.max(a, b),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  sign: (x) => Math.sign(x),
};

/**
 * Checks if a string represents an engineering mathematical formula or expression
 * (as opposed to a plain number literal or empty string).
 */
export function isFormula(text: string | undefined | null): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "-") return false;

  // Plain number without operators or symbols is not a formula
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
    return false;
  }

  // Plain boolean is not a formula
  if (trimmed === "true" || trimmed === "false") {
    return false;
  }

  // Check for presence of operators, functions, constants or variable identifiers
  return (
    /[+\-*/^%<>=()]/.test(trimmed) ||
    /\b(if|then|else|sqrt|sin|cos|tan|abs|exp|log|min|max|pi|Modelica)\b/i.test(trimmed)
  );
}

/**
 * Token types for formula lexer.
 */
type TokenType = "NUMBER" | "IDENT" | "OP" | "LPAREN" | "RPAREN" | "COMMA" | "KEYWORD" | "EOF";

interface Token {
  type: TokenType;
  value: string;
  start: number;
}

class Tokenizer {
  private pos = 0;
  private len: number;

  constructor(private input: string) {
    this.len = input.length;
  }

  nextToken(): Token {
    while (this.pos < this.len && /\s/.test(this.input[this.pos]!)) {
      this.pos++;
    }

    if (this.pos >= this.len) {
      return { type: "EOF", value: "", start: this.pos };
    }

    const start = this.pos;
    const ch = this.input[this.pos]!;

    if (ch === "(") {
      this.pos++;
      return { type: "LPAREN", value: "(", start };
    }
    if (ch === ")") {
      this.pos++;
      return { type: "RPAREN", value: ")", start };
    }
    if (ch === ",") {
      this.pos++;
      return { type: "COMMA", value: ",", start };
    }

    // Number literal
    if (/\d/.test(ch) || (ch === "." && this.pos + 1 < this.len && /\d/.test(this.input[this.pos + 1]!))) {
      let numStr = "";
      while (this.pos < this.len && /[\d.]/.test(this.input[this.pos]!)) {
        numStr += this.input[this.pos]!;
        this.pos++;
      }
      if (this.pos < this.len && (this.input[this.pos] === "e" || this.input[this.pos] === "E")) {
        numStr += this.input[this.pos]!;
        this.pos++;
        if (this.pos < this.len && (this.input[this.pos] === "+" || this.input[this.pos] === "-")) {
          numStr += this.input[this.pos]!;
          this.pos++;
        }
        while (this.pos < this.len && /\d/.test(this.input[this.pos]!)) {
          numStr += this.input[this.pos]!;
          this.pos++;
        }
      }
      return { type: "NUMBER", value: numStr, start };
    }

    // Identifiers and dotted qualified identifiers (e.g. Modelica.Constants.pi)
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (this.pos < this.len && /[a-zA-Z0-9_.]/.test(this.input[this.pos]!)) {
        ident += this.input[this.pos]!;
        this.pos++;
      }
      const lower = ident.toLowerCase();
      if (
        lower === "if" ||
        lower === "then" ||
        lower === "else" ||
        lower === "not" ||
        lower === "and" ||
        lower === "or"
      ) {
        return { type: "KEYWORD", value: lower, start };
      }
      if (lower === "true" || lower === "false") {
        return { type: "KEYWORD", value: lower, start };
      }
      return { type: "IDENT", value: ident, start };
    }

    // Two-character operators: ==, !=, <=, >=, <>
    const next2 = this.input.substring(this.pos, this.pos + 2);
    if (next2 === "==" || next2 === "!=" || next2 === "<=" || next2 === ">=" || next2 === "<>") {
      this.pos += 2;
      return { type: "OP", value: next2, start };
    }

    // Single-character operator: +, -, *, /, ^, <, >
    if (/[+\-*/^%<>=]/.test(ch)) {
      this.pos++;
      return { type: "OP", value: ch, start };
    }

    // Unknown char, advance to avoid infinite loop
    this.pos++;
    return { type: "OP", value: ch, start };
  }
}

class Parser {
  private currentToken: Token;
  private tokenizer: Tokenizer;
  private callDepth = 0;

  constructor(
    input: string,
    private scope: Record<string, any> = {},
  ) {
    this.tokenizer = new Tokenizer(input);
    this.currentToken = this.tokenizer.nextToken();
  }

  private eat(type: TokenType, val?: string): Token {
    const tok = this.currentToken;
    if (tok.type !== type || (val !== undefined && tok.value !== val)) {
      throw new Error(`Unexpected token '${tok.value}'`);
    }
    this.currentToken = this.tokenizer.nextToken();
    return tok;
  }

  parse(): number | boolean {
    const res = this.parseConditional();
    if (this.currentToken.type !== "EOF") {
      throw new Error(`Unexpected token '${this.currentToken.value}' after expression`);
    }
    return res;
  }

  private parseConditional(): number | boolean {
    if (this.currentToken.type === "KEYWORD" && this.currentToken.value === "if") {
      this.eat("KEYWORD", "if");
      const cond = this.parseLogicalOr();
      this.eat("KEYWORD", "then");
      const thenVal = this.parseConditional();
      this.eat("KEYWORD", "else");
      const elseVal = this.parseConditional();
      return cond ? thenVal : elseVal;
    }
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): number | boolean {
    let left = this.parseLogicalAnd();
    while (this.currentToken.type === "KEYWORD" && this.currentToken.value === "or") {
      this.eat("KEYWORD", "or");
      const right = this.parseLogicalAnd();
      left = Boolean(left || right);
    }
    return left;
  }

  private parseLogicalAnd(): number | boolean {
    let left = this.parseComparison();
    while (this.currentToken.type === "KEYWORD" && this.currentToken.value === "and") {
      this.eat("KEYWORD", "and");
      const right = this.parseComparison();
      left = Boolean(left && right);
    }
    return left;
  }

  private parseComparison(): number | boolean {
    let left = this.parseAdditive();
    const tok = this.currentToken;
    if (tok.type === "OP" && ["==", "!=", "<>", "<", "<=", ">", ">="].includes(tok.value)) {
      this.eat("OP", tok.value);
      const right = this.parseAdditive();
      const lNum = Number(left);
      const rNum = Number(right);
      switch (tok.value) {
        case "==":
          return left === right;
        case "!=":
        case "<>":
          return left !== right;
        case "<":
          return lNum < rNum;
        case "<=":
          return lNum <= rNum;
        case ">":
          return lNum > rNum;
        case ">=":
          return lNum >= rNum;
      }
    }
    return left;
  }

  private parseAdditive(): number {
    let left = this.parseMultiplicative();
    while (this.currentToken.type === "OP" && (this.currentToken.value === "+" || this.currentToken.value === "-")) {
      const op = this.currentToken.value;
      this.eat("OP", op);
      const right = this.parseMultiplicative();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  private parseMultiplicative(): number {
    let left = this.parseExponent();
    while (
      this.currentToken.type === "OP" &&
      (this.currentToken.value === "*" || this.currentToken.value === "/" || this.currentToken.value === "%")
    ) {
      const op = this.currentToken.value;
      this.eat("OP", op);
      const right = this.parseExponent();
      if (op === "*") {
        left = left * right;
      } else if (op === "/") {
        if (right === 0) throw new Error("Division by zero");
        left = left / right;
      } else {
        left = left % right;
      }
    }
    return left;
  }

  private parseExponent(): number {
    let left = this.parseUnary();
    if (this.currentToken.type === "OP" && this.currentToken.value === "^") {
      this.eat("OP", "^");
      const right = this.parseExponent(); // right-associative
      return Math.pow(left, right);
    }
    return left;
  }

  private parseUnary(): number {
    if (this.currentToken.type === "OP" && this.currentToken.value === "+") {
      this.eat("OP", "+");
      return this.parseUnary();
    }
    if (this.currentToken.type === "OP" && this.currentToken.value === "-") {
      this.eat("OP", "-");
      return -this.parseUnary();
    }
    if (this.currentToken.type === "KEYWORD" && this.currentToken.value === "not") {
      this.eat("KEYWORD", "not");
      const val = this.parseUnary();
      return !val ? 1 : 0;
    }
    return Number(this.parsePrimary());
  }

  private parsePrimary(): number | boolean {
    const tok = this.currentToken;

    if (tok.type === "NUMBER") {
      this.eat("NUMBER");
      const val = parseFloat(tok.value);
      if (isNaN(val)) throw new Error(`Invalid number: ${tok.value}`);
      return val;
    }

    if (tok.type === "KEYWORD") {
      if (tok.value === "true") {
        this.eat("KEYWORD", "true");
        return true;
      }
      if (tok.value === "false") {
        this.eat("KEYWORD", "false");
        return false;
      }
    }

    if (tok.type === "LPAREN") {
      this.eat("LPAREN");
      const expr = this.parseConditional();
      this.eat("RPAREN");
      return expr;
    }

    if (tok.type === "IDENT") {
      const name = tok.value;
      this.eat("IDENT");

      // Check if function call
      if (this.currentToken.type === "LPAREN") {
        this.eat("LPAREN");
        const args: number[] = [];
        if (this.currentToken.type !== "RPAREN") {
          args.push(Number(this.parseConditional()));
          while (this.currentToken.type === "COMMA") {
            this.eat("COMMA");
            args.push(Number(this.parseConditional()));
          }
        }
        this.eat("RPAREN");

        const fnName = name.toLowerCase();
        const fn = MATH_FUNCTIONS[fnName];
        if (!fn) throw new Error(`Unknown function: '${name}'`);
        return fn(...args);
      }

      // Check constants
      const lower = name.toLowerCase();
      if (lower in CONSTANTS) {
        return CONSTANTS[lower]!;
      }

      // Check scope variable
      const scopeVal = this.scope[name] ?? this.scope[lower];
      if (scopeVal !== undefined && scopeVal !== null && scopeVal !== "") {
        if (typeof scopeVal === "boolean") return scopeVal;
        if (typeof scopeVal === "number") return scopeVal;
        if (typeof scopeVal === "string") {
          // If scope variable is itself an expression, resolve it safely
          if (this.callDepth > 10) throw new Error("Circular variable dependency");
          const num = parseFloat(scopeVal);
          if (!isNaN(num) && /^[+-]?\d+(\.\d*)?([eE][+-]?\d+)?$/.test(scopeVal.trim())) {
            return num;
          }
          if (scopeVal.trim() === "true") return true;
          if (scopeVal.trim() === "false") return false;
          // Recursively evaluate formula in variable
          const subParser = new Parser(scopeVal, this.scope);
          subParser.callDepth = this.callDepth + 1;
          return subParser.parse();
        }
      }

      throw new Error(`Unresolved identifier '${name}'`);
    }

    throw new Error(`Unexpected token '${tok.value}'`);
  }
}

/**
 * Safely evaluates a mathematical formula with scope variables and returns formatted result.
 */
export function tryEvaluateFormula(
  expression: string | undefined | null,
  scope: Record<string, any> = {},
): FormulaResult {
  if (!expression || expression.trim() === "" || expression.trim() === "-") {
    return { success: false, error: "Empty expression" };
  }

  try {
    const parser = new Parser(expression.trim(), scope);
    const result = parser.parse();

    if (typeof result === "boolean") {
      return { success: true, value: result, formatted: result ? "true" : "false" };
    }

    if (typeof result === "number") {
      if (isNaN(result) || !isFinite(result)) {
        return { success: false, error: "Numerical overflow or undefined result" };
      }

      // Format cleanly: round to 5 decimal places or use scientific notation for very small/large
      let formatted: string;
      if (Number.isInteger(result)) {
        formatted = result.toString();
      } else if (Math.abs(result) < 1e-4 && Math.abs(result) > 0) {
        formatted = result.toExponential(4);
      } else if (Math.abs(result) >= 1e7) {
        formatted = result.toExponential(4);
      } else {
        formatted = parseFloat(result.toFixed(5)).toString();
      }

      return { success: true, value: result, formatted };
    }

    return { success: false, error: "Unsupported return type" };
  } catch (err: any) {
    return { success: false, error: err?.message || "Invalid formula syntax" };
  }
}

/**
 * Formats a fully-qualified Modelica choice label to its clean short name.
 * e.g. "Modelica.Blocks.Types.Init.SteadyState" -> "SteadyState"
 */
export function formatChoiceLabel(label: string | undefined, value: string | undefined): string {
  const target = label || value || "";
  if (!target) return "";
  if (label && label !== value && !label.includes(".")) {
    return label;
  }
  if (target.includes(".")) {
    const parts = target.split(".");
    return parts[parts.length - 1] || target;
  }
  return target;
}
