// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - Pure numeric and scalar built-in arithmetic evaluation helpers.
 */

export function evalArithmeticString(
  expr: string,
  allowFloat = false,
  subs?: ReadonlyMap<string, number | string>,
): number | null {
  let pos = 0;
  const len = expr.length;

  function skipWhitespace(): void {
    while (pos < len && expr.charCodeAt(pos) <= 32) pos++;
  }

  function parsePrimary(): number | null {
    skipWhitespace();
    if (pos >= len) return null;
    const ch = expr.charCodeAt(pos);
    if (ch === 43) {
      pos++;
      return parsePrimary();
    }
    if (ch === 45) {
      pos++;
      const val = parsePrimary();
      return val === null ? null : -val;
    }
    if (ch === 40) {
      pos++;
      const val = parseExpr();
      skipWhitespace();
      if (pos >= len || expr.charCodeAt(pos) !== 41) return null;
      pos++;
      return val;
    }
    if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95) {
      const idStart = pos;
      while (pos < len) {
        const c = expr.charCodeAt(pos);
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95) {
          pos++;
        } else {
          break;
        }
      }
      const fnName = expr.slice(idStart, pos);
      skipWhitespace();
      if (pos >= len || expr.charCodeAt(pos) !== 40) {
        if (subs && subs.has(fnName)) {
          const sv = subs.get(fnName);
          if (typeof sv === "number" && Number.isFinite(sv)) return sv;
        }
        return null;
      }
      pos++; // skip '('
      const args: number[] = [];
      skipWhitespace();
      if (pos < len && expr.charCodeAt(pos) !== 41) {
        while (true) {
          const argVal = parseExpr();
          if (argVal === null) return null;
          args.push(argVal);
          skipWhitespace();
          if (pos < len && expr.charCodeAt(pos) === 44) {
            pos++;
          } else {
            break;
          }
        }
      }
      if (pos >= len || expr.charCodeAt(pos) !== 41) return null;
      pos++; // skip ')'
      return evalScalarBuiltinCall(fnName, args);
    }
    const start = pos;
    while (pos < len) {
      const c = expr.charCodeAt(pos);
      if ((c >= 48 && c <= 57) || c === 46) {
        pos++;
      } else if ((c === 101 || c === 69) && pos > start) {
        pos++;
        if (pos < len && (expr.charCodeAt(pos) === 43 || expr.charCodeAt(pos) === 45)) {
          pos++;
        }
      } else {
        break;
      }
    }
    if (pos === start) return null;
    const num = Number(expr.slice(start, pos));
    return isNaN(num) ? null : num;
  }

  function parsePower(): number | null {
    const base = parsePrimary();
    if (base === null) return null;
    skipWhitespace();
    if (pos < len && expr.charCodeAt(pos) === 94) {
      pos++;
      const exp = parsePower();
      if (exp === null) return null;
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseMulDiv(): number | null {
    let left = parsePower();
    if (left === null) return null;
    while (pos < len) {
      skipWhitespace();
      if (pos >= len) break;
      const c = expr.charCodeAt(pos);
      if (c === 42) {
        pos++;
        const right = parsePower();
        if (right === null) return null;
        left = left * right;
      } else if (c === 47) {
        pos++;
        const right = parsePower();
        if (right === null || right === 0) return null;
        left = left / right;
      } else {
        break;
      }
    }
    return left;
  }

  function parseExpr(): number | null {
    let left = parseMulDiv();
    if (left === null) return null;
    while (pos < len) {
      skipWhitespace();
      if (pos >= len) break;
      const c = expr.charCodeAt(pos);
      if (c === 43) {
        pos++;
        const right = parseMulDiv();
        if (right === null) return null;
        left = left + right;
      } else if (c === 45) {
        pos++;
        const right = parseMulDiv();
        if (right === null) return null;
        left = left - right;
      } else {
        break;
      }
    }
    return left;
  }

  const res = parseExpr();
  skipWhitespace();
  if (res === null || pos < len) return null;
  return allowFloat ? res : Math.round(res);
}

export function evalArithmeticText(
  str: string,
  subs?: ReadonlyMap<string, number | string>,
  allowFloat = false,
): number | null {
  if (!str) return null;
  return evalArithmeticString(str.trim(), allowFloat, subs);
}

/** Evaluates a binary Modelica numeric/relational/logical operator over two numeric values (`true=1, false=0`). */
export function evalBinaryNumericOp(op: string, left: number, right: number, integerDivision = false): number | null {
  switch (op) {
    case "+":
    case ".+":
      return left + right;
    case "-":
    case ".-":
      return left - right;
    case "*":
    case ".*":
      return left * right;
    case "/":
    case "./":
      if (right === 0) return null;
      return integerDivision ? Math.floor(left / right) : left / right;
    case "^":
    case ".^":
      return Math.pow(left, right);
    case ">":
      return left > right ? 1 : 0;
    case ">=":
      return left >= right ? 1 : 0;
    case "<":
      return left < right ? 1 : 0;
    case "<=":
      return left <= right ? 1 : 0;
    case "==":
      return left === right ? 1 : 0;
    case "<>":
      return left !== right ? 1 : 0;
    case "and":
      return left !== 0 && right !== 0 ? 1 : 0;
    case "or":
      return left !== 0 || right !== 0 ? 1 : 0;
    default:
      return null;
  }
}

/** Evaluates Modelica scalar integer/real builtin functions over pre-evaluated numeric arguments. */
export function evalScalarBuiltinCall(fnName: string, args: number[]): number | null {
  if (args.length === 1) {
    const a0 = args[0]!;
    switch (fnName) {
      case "abs":
        return Math.abs(a0);
      case "ceil":
        return Math.ceil(a0);
      case "floor":
      case "integer":
        return Math.floor(a0);
      case "sign":
        return Math.sign(a0);
    }
  } else if (args.length === 2) {
    const a0 = args[0]!;
    const a1 = args[1]!;
    switch (fnName) {
      case "min":
        return Math.min(a0, a1);
      case "max":
        return Math.max(a0, a1);
      case "div":
        return a1 !== 0 ? Math.trunc(a0 / a1) : null;
      case "mod":
        return a1 !== 0 ? a0 - Math.floor(a0 / a1) * a1 : null;
      case "rem":
        return a1 !== 0 ? a0 % a1 : null;
    }
  }
  return null;
}
