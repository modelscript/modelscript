// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for C.
 *
 * Lowers continuous state derivative assignments (dx[i] = expr, der_x = expr)
 * and explicit algebraic relations directly into @modelscript/runtime's linear-memory IDaeBuilder.
 */

import { BinOp, Causality, EqKind, IDaeBuilder, UnaryOp, VarType, Variability } from "@modelscript/runtime";

export interface CDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
}

export function lowerCToDae(builder: IDaeBuilder, lines: string[], prefix: string = "c_blk"): CDaeLoweringResult {
  const stateVarIndices: number[] = [];
  let equationCount = 0;
  const varMap = new Map<string, number>();

  function getOrAddVar(name: string, isContinuousState: boolean = false): number {
    const key = name.toLowerCase();
    if (varMap.has(key)) return varMap.get(key)!;

    const varName = `${prefix}_${name}`;
    const idx = builder.addVariable(
      varName,
      VarType.Real,
      isContinuousState ? Variability.Continuous : Variability.Discrete,
      Causality.Local,
      0.0,
    );
    varMap.set(key, idx);
    if (isContinuousState) {
      stateVarIndices.push(idx);
    }
    return idx;
  }

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("/*")) continue;

    // Strip trailing semicolon
    if (line.endsWith(";")) {
      line = line.slice(0, -1).trim();
    }

    // Check for assignment: Target = Value
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0 || /^[><!=]=/.test(line.slice(eqIdx - 1))) continue;

    const target = line.slice(0, eqIdx).trim();
    const rhs = line.slice(eqIdx + 1).trim();

    // 1. ODE State Derivative: dx[i] = expr or der_x = expr -> der(s_i) = expr
    const dxSubscriptMatch = /^(?:dx|der_x|s_dot|x_dot)\s*\[\s*([0-9]+)\s*\]$/i.exec(target);
    if (dxSubscriptMatch) {
      const stateNum = dxSubscriptMatch[1]!;
      const stateVarName = `s_${stateNum}`;
      const stateVarIdx = getOrAddVar(stateVarName, true);

      const derExprId = builder.addDer(stateVarIdx);
      const rhsExprId = lowerCExprToArena(builder, rhs, getOrAddVar);

      builder.addEquation(EqKind.Simple, derExprId, rhsExprId);
      equationCount++;
      continue;
    }

    const derPrefixMatch = /^der_([A-Za-z_][A-Za-z0-9_]*)$/i.exec(target);
    if (derPrefixMatch) {
      const stateVarName = derPrefixMatch[1]!;
      const stateVarIdx = getOrAddVar(stateVarName, true);

      const derExprId = builder.addDer(stateVarIdx);
      const rhsExprId = lowerCExprToArena(builder, rhs, getOrAddVar);

      builder.addEquation(EqKind.Simple, derExprId, rhsExprId);
      equationCount++;
      continue;
    }

    // 2. Algebraic Assignment: Var = expr
    const varMatch = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(target);
    if (varMatch) {
      const varName = varMatch[1]!;
      const varIdx = getOrAddVar(varName, false);
      const lhsExprId = builder.addName(varIdx);
      const rhsExprId = lowerCExprToArena(builder, rhs, getOrAddVar);

      builder.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
      equationCount++;
      continue;
    }
  }

  return {
    stateVarIndices,
    equationCount,
  };
}

function lowerCExprToArena(
  builder: IDaeBuilder,
  expr: string,
  getOrAddVar: (name: string, isContinuousState?: boolean) => number,
): number {
  const tokens = tokenizeCExpr(expr);
  if (tokens.length === 0) return builder.addRealLiteral(0.0);
  return parseCExprTokens(tokens, builder, getOrAddVar);
}

interface CExprToken {
  type: "num" | "ident" | "state" | "op" | "lparen" | "rparen" | "comma";
  value: string;
  num?: number;
}

function tokenizeCExpr(expr: string): CExprToken[] {
  const tokens: CExprToken[] = [];
  let i = 0;
  const n = expr.length;

  while (i < n) {
    const ch = expr[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Number literal
    if (/\d/.test(ch) || (ch === "." && i + 1 < n && /\d/.test(expr[i + 1]!))) {
      const start = i;
      while (i < n && /[0-9.eEdD+-]/.test(expr[i]!)) {
        if ((expr[i] === "+" || expr[i] === "-") && !/[eEdD]/.test(expr[i - 1] ?? "")) {
          break;
        }
        i++;
      }
      while (i < n && /[fFlLuU]/.test(expr[i]!)) {
        i++;
      }
      const raw = expr
        .slice(start, i)
        .replace(/[fFlLuU]/g, "")
        .replace(/[dD]/g, "e");
      tokens.push({ type: "num", value: raw, num: parseFloat(raw) });
      continue;
    }

    // Power operator: ** or ^
    if (ch === "*" && i + 1 < n && expr[i + 1] === "*") {
      tokens.push({ type: "op", value: "**" });
      i += 2;
      continue;
    }
    if (ch === "^") {
      tokens.push({ type: "op", value: "^" });
      i++;
      continue;
    }

    // Single-character operators & punctuation
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", value: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ")" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: "," });
      i++;
      continue;
    }

    // Identifiers, states (e.g. x[0], s[0], state->x, state.x)
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(expr[i]!)) {
        i++;
      }
      let ident = expr.slice(start, i);

      // Check for arrow -> or dot . member access
      while (i < n) {
        if (expr.slice(i, i + 2) === "->") {
          i += 2;
          const mStart = i;
          while (i < n && /[A-Za-z0-9_]/.test(expr[i]!)) i++;
          ident += `_${expr.slice(mStart, i)}`;
        } else if (expr[i] === "." && i + 1 < n && /[A-Za-z_]/.test(expr[i + 1]!)) {
          i++;
          const mStart = i;
          while (i < n && /[A-Za-z0-9_]/.test(expr[i]!)) i++;
          ident += `_${expr.slice(mStart, i)}`;
        } else {
          break;
        }
      }

      // Check for array subscript [0-9+]
      if (i < n && expr[i] === "[") {
        const bracketClose = expr.indexOf("]", i);
        if (bracketClose > i) {
          const indexStr = expr.slice(i + 1, bracketClose).trim();
          if (/^\d+$/.test(indexStr)) {
            i = bracketClose + 1;
            if (/^(?:x|s|state|s_dot|x_dot)$/i.test(ident)) {
              tokens.push({ type: "state", value: indexStr });
              continue;
            } else {
              ident = `${ident}_${indexStr}`;
            }
          }
        }
      }

      tokens.push({ type: "ident", value: ident });
      continue;
    }

    i++;
  }

  return tokens;
}

function parseCExprTokens(
  tokens: CExprToken[],
  builder: IDaeBuilder,
  getOrAddVar: (name: string, isContinuousState?: boolean) => number,
): number {
  let pos = 0;

  function peek(): CExprToken | undefined {
    return tokens[pos];
  }

  function consume(): CExprToken {
    return tokens[pos++]!;
  }

  function parseExpression(): number {
    return parseBinary(1);
  }

  function getPrecedence(op: string): number {
    if (op === "+" || op === "-") return 1;
    if (op === "*" || op === "/") return 2;
    if (op === "^" || op === "**") return 3;
    return 0;
  }

  function parseBinary(minPrec: number): number {
    let left = parseUnary();

    while (pos < tokens.length) {
      const tok = peek();
      if (!tok || tok.type !== "op") break;

      const prec = getPrecedence(tok.value);
      if (prec < minPrec) break;

      consume();
      const nextMinPrec = tok.value === "^" || tok.value === "**" ? prec : prec + 1;
      const right = parseBinary(nextMinPrec);

      if (tok.value === "+") {
        left = builder.addBinaryExpr(BinOp.Add, left, right);
      } else if (tok.value === "-") {
        left = builder.addBinaryExpr(BinOp.Sub, left, right);
      } else if (tok.value === "*") {
        left = builder.addBinaryExpr(BinOp.Mul, left, right);
      } else if (tok.value === "/") {
        left = builder.addBinaryExpr(BinOp.Div, left, right);
      } else if (tok.value === "^" || tok.value === "**") {
        left = builder.addBinaryExpr(BinOp.Pow, left, right);
      }
    }

    return left;
  }

  function parseUnary(): number {
    const tok = peek();
    if (tok && tok.type === "op" && (tok.value === "+" || tok.value === "-")) {
      consume();
      const op = tok.value;
      const operand = parseUnary();
      if (op === "+") return operand;
      if (typeof builder.addUnaryExpr === "function") {
        return builder.addUnaryExpr(UnaryOp.Negate, operand);
      }
      return builder.addBinaryExpr(BinOp.Sub, builder.addRealLiteral(0.0), operand);
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const tok = peek();
    if (!tok) {
      return builder.addRealLiteral(0.0);
    }

    if (tok.type === "num") {
      consume();
      return builder.addRealLiteral(tok.num ?? 0.0);
    }

    if (tok.type === "state") {
      consume();
      const varIdx = getOrAddVar(`s_${tok.value}`, true);
      return builder.addName(varIdx);
    }

    if (tok.type === "ident") {
      consume();
      const identName = tok.value;

      // Check if function call: ident(arg1, arg2, ...)
      if (peek() && peek()!.type === "lparen") {
        consume(); // (
        const args: number[] = [];
        if (peek() && peek()!.type !== "rparen") {
          args.push(parseExpression());
          while (peek() && peek()!.type === "comma") {
            consume(); // ,
            args.push(parseExpression());
          }
        }
        if (peek() && peek()!.type === "rparen") {
          consume(); // )
        }

        const fnLower = identName.toLowerCase();
        if (fnLower === "sqrt" && args.length >= 1) {
          return builder.addBinaryExpr(BinOp.Pow, args[0]!, builder.addRealLiteral(0.5));
        }
        if (fnLower === "pow" && args.length >= 2) {
          return builder.addBinaryExpr(BinOp.Pow, args[0]!, args[1]!);
        }
        if ((fnLower === "abs" || fnLower === "fabs") && args.length >= 1) {
          if (typeof builder.addCall === "function") {
            return builder.addCall(14, args[0]!, 1); // BuiltinMathFunc.Abs
          }
          return args[0]!;
        }
        if (fnLower === "exp" && args.length >= 1) {
          if (typeof builder.addCall === "function") {
            return builder.addCall(10, args[0]!, 1); // BuiltinMathFunc.Exp
          }
          return builder.addBinaryExpr(BinOp.Pow, builder.addRealLiteral(Math.E), args[0]!);
        }
        if (fnLower === "sin" && args.length >= 1 && typeof builder.addCall === "function") {
          return builder.addCall(0, args[0]!, 1); // BuiltinMathFunc.Sin
        }
        if (fnLower === "cos" && args.length >= 1 && typeof builder.addCall === "function") {
          return builder.addCall(1, args[0]!, 1); // BuiltinMathFunc.Cos
        }
        if (fnLower === "log" && args.length >= 1 && typeof builder.addCall === "function") {
          return builder.addCall(11, args[0]!, 1); // BuiltinMathFunc.Log
        }

        return args[0] ?? builder.addRealLiteral(0.0);
      }

      const sSubMatch = /^(?:x|s)_?([0-9]+)$/i.exec(identName);
      if (sSubMatch) {
        const varIdx = getOrAddVar(`s_${sSubMatch[1]!}`, true);
        return builder.addName(varIdx);
      }

      const varIdx = getOrAddVar(identName, false);
      return builder.addName(varIdx);
    }

    if (tok.type === "lparen") {
      consume(); // (
      const expr = parseExpression();
      if (peek() && peek()!.type === "rparen") {
        consume(); // )
      }
      return expr;
    }

    consume();
    return builder.addRealLiteral(0.0);
  }

  if (tokens.length === 0) return builder.addRealLiteral(0.0);
  return parseExpression();
}
