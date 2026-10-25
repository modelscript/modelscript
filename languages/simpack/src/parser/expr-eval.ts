// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure, zero-eval, recursive-descent mathematical expression evaluator for deck tokens and attributes.
 * Handles +, -, *, /, ^, parentheses, numbers (including scientific notation), and variable bindings.
 */
export function evaluateMathExpr(
  input: string | undefined,
  scope?: Map<string, number>,
  defaultVal: number = 0,
): number {
  if (input == null) return defaultVal;
  const str = input.trim();
  if (str === "") return defaultVal;

  let pos = 0;

  function peek(): string {
    while (pos < str.length && str[pos] === " ") pos++;
    return pos < str.length ? str[pos]! : "";
  }

  function get(): string {
    while (pos < str.length && str[pos] === " ") pos++;
    return pos < str.length ? str[pos++]! : "";
  }

  function parsePrimary(): number {
    const ch = peek();
    if (ch === "+") {
      get();
      return parsePrimary();
    }
    if (ch === "-") {
      get();
      return -parsePrimary();
    }
    if (ch === "(") {
      get(); // consume '('
      const val = parseAddSub();
      if (peek() === ")") get(); // consume ')'
      return val;
    }

    // Number or Identifier
    let token = "";
    while (pos < str.length && /[a-zA-Z0-9_.]/.test(str[pos]!)) {
      token += str[pos++]!;
    }

    if (token === "") return defaultVal;

    // Check if it's a numeric literal
    const num = parseFloat(token);
    if (!Number.isNaN(num) && /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(token)) {
      return num;
    }

    // Lookup in scope
    if (scope && scope.has(token)) {
      return scope.get(token)!;
    }

    // Common scientific constants
    const lower = token.toLowerCase();
    if (lower === "pi") return Math.PI;
    if (lower === "g") return 9.81;

    return Number.isFinite(num) ? num : defaultVal;
  }

  function parsePower(): number {
    let base = parsePrimary();
    while (peek() === "^") {
      get();
      const exp = parsePrimary();
      base = Math.pow(base, exp);
    }
    return base;
  }

  function parseMulDiv(): number {
    let left = parsePower();
    while (peek() === "*" || peek() === "/") {
      const op = get();
      const right = parsePower();
      if (op === "*") left *= right;
      else left = right !== 0 ? left / right : 0;
    }
    return left;
  }

  function parseAddSub(): number {
    let left = parseMulDiv();
    while (peek() === "+" || peek() === "-") {
      const op = get();
      const right = parseMulDiv();
      if (op === "+") left += right;
      else left -= right;
    }
    return left;
  }

  try {
    const result = parseAddSub();
    return Number.isFinite(result) ? result : defaultVal;
  } catch {
    return defaultVal;
  }
}
