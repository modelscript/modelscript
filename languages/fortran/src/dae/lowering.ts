// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for Fortran.
 *
 * Lowers procedural equations, state derivative assignments (SD(i) = expr),
 * and algebraic relations directly into @modelscript/runtime's linear-memory DAEBuilder.
 */

import { BinOp, Causality, EqKind, IDaeBuilder, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import { extractFortranSignature } from "../ast.js";

export interface FortranDaeLoweringResult {
  stateVarIndices: number[];
  inputVarIndices: number[];
  outputVarIndices: number[];
  parameterVarIndices: number[];
  equationCount: number;
}

function unrollConstantDoLoops(lines: string[], constants: Record<string, number>): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    const doMatch =
      /^DO\s+(?:[0-9]+\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^,\s]+)\s*,\s*([^,\s]+)(?:\s*,\s*([^,\s]+))?\s*$/i.exec(
        trimmed,
      );
    if (doMatch) {
      const loopVar = doMatch[1]!;
      const parseBound = (s: string): number | null => {
        const clean = s.trim();
        const n = Number(clean);
        if (!isNaN(n)) return Math.round(n);
        const c = constants[clean] ?? constants[clean.toLowerCase()] ?? constants[clean.toUpperCase()];
        return typeof c === "number" ? Math.round(c) : null;
      };
      const startVal = parseBound(doMatch[2]!);
      const endVal = parseBound(doMatch[3]!);
      const stepVal = doMatch[4] ? parseBound(doMatch[4]) : 1;

      // Find matching END DO
      let depth = 1;
      let j = i + 1;
      const bodyLines: string[] = [];
      while (j < lines.length && depth > 0) {
        const inner = lines[j]!.trim();
        if (/^DO\b/i.test(inner)) depth++;
        else if (/^(?:END\s+DO|ENDDO)\b/i.test(inner)) {
          depth--;
          if (depth === 0) break;
        }
        bodyLines.push(lines[j]!);
        j++;
      }

      if (
        depth === 0 &&
        startVal !== null &&
        endVal !== null &&
        stepVal !== null &&
        stepVal !== 0 &&
        Math.abs((endVal - startVal) / stepVal) <= 32
      ) {
        const varRegex = new RegExp(`\\b${loopVar}\\b`, "gi");
        for (let k = startVal; stepVal > 0 ? k <= endVal : k >= endVal; k += stepVal) {
          for (const bLine of unrollConstantDoLoops(bodyLines, constants)) {
            result.push(bLine.replace(varRegex, String(k)));
          }
        }
        i = j + 1;
        continue;
      }
    }
    result.push(raw);
    i++;
  }
  return result;
}

/**
 * Lowers Fortran statements (such as EASY5 state derivatives SD(i) = ... and algebraic assignments)
 * directly into the DAEBuilder arena, preserving Input/Output/Parameter causality and scalarizing fixed arrays.
 */
export function lowerFortranToDae(
  builder: IDaeBuilder,
  lines: string[],
  prefix: string = "fortran",
): FortranDaeLoweringResult {
  const stateVarIndices: number[] = [];
  const inputVarIndices: number[] = [];
  const outputVarIndices: number[] = [];
  const parameterVarIndices: number[] = [];
  let equationCount = 0;
  const varMap = new Map<string, number>();

  const sig = extractFortranSignature(lines.join("\n"));
  const inputSet = new Set(sig.inputs.map((s) => s.toUpperCase()));
  const outputSet = new Set(sig.outputs.map((s) => s.toUpperCase()));
  const constMap = new Map<string, number>();
  for (const [k, v] of Object.entries(sig.constants)) {
    constMap.set(k.toUpperCase(), v);
  }

  function getOrAddVar(name: string, isContinuousState: boolean = false): number {
    const key = name.toUpperCase();
    if (varMap.has(key)) return varMap.get(key)!;

    const varName = prefix ? `${prefix}_${name}` : name;
    let variability = Variability.Continuous;
    let causality = Causality.Local;
    let startVal = 0.0;

    if (isContinuousState) {
      variability = Variability.Continuous;
      causality = Causality.Local;
    } else if (constMap.has(key)) {
      variability = Variability.Parameter;
      causality = Causality.Local;
      startVal = constMap.get(key)!;
    } else if (outputSet.has(key)) {
      variability = Variability.Continuous;
      causality = Causality.Output;
    } else if (inputSet.has(key)) {
      variability = Variability.Continuous;
      causality = Causality.Input;
      startVal = 1.0;
    }

    const idx = builder.addVariable(varName, VarType.Real, variability, causality, startVal);
    varMap.set(key, idx);
    if (isContinuousState) {
      stateVarIndices.push(idx);
    } else if (causality === Causality.Input) {
      inputVarIndices.push(idx);
    } else if (causality === Causality.Output) {
      outputVarIndices.push(idx);
    } else if (variability === Variability.Parameter) {
      parameterVarIndices.push(idx);
      const bSetter = (builder as unknown as { setVariableBinding?: (v: number, e: number) => void })
        .setVariableBinding;
      if (typeof bSetter === "function") {
        bSetter.call(builder, idx, builder.addRealLiteral(startVal));
      }
    }
    return idx;
  }

  // Pre-register signature parameters, inputs, outputs
  for (const [cName] of Object.entries(sig.constants)) {
    getOrAddVar(cName, false);
  }
  for (const inp of sig.inputs) {
    getOrAddVar(inp, false);
  }
  for (const out of sig.outputs) {
    getOrAddVar(out, false);
  }

  const expandedLines = unrollConstantDoLoops(lines, sig.constants);

  for (const rawLine of expandedLines) {
    let line = rawLine.trim();
    if (!line || line.startsWith("!")) continue;
    const ex = line.indexOf("!");
    if (ex >= 0) line = line.slice(0, ex).trim();
    if (!line) continue;

    // Skip declaration headers and structural statements
    if (
      /^(?:SUBROUTINE|FUNCTION|MODULE|PROGRAM|CONTAINS|USE|IMPLICIT|REAL|INTEGER|DOUBLE\s+PRECISION|LOGICAL|DIMENSION|PARAMETER|COMMON|ALLOCATE|DEALLOCATE|END|RETURN|CONTINUE)\b/i.test(
        line,
      ) &&
      (!line.includes("=") || line.includes("::") || /^PARAMETER\s*\(/i.test(line))
    ) {
      continue;
    }

    // Check for assignment: Target = Value
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0 || /^[><!=]=/.test(line.slice(eqIdx - 1))) continue;

    const target = line.slice(0, eqIdx).trim();
    const rhs = line.slice(eqIdx + 1).trim();

    // 1. EASY5 State Derivative: SD(i) = expr -> der(S_i) = expr
    const sdMatch = /^SD\s*\(\s*([0-9]+)\s*\)$/i.exec(target);
    if (sdMatch) {
      const stateNum = sdMatch[1]!;
      const stateVarName = `s_${stateNum}`;
      const stateVarIdx = getOrAddVar(stateVarName, true);

      // Create der(stateVar) expression
      const derExprId = builder.addDer(stateVarIdx);
      const rhsExprId = lowerExprToArena(builder, rhs, getOrAddVar);

      builder.addEquation(EqKind.Simple, derExprId, rhsExprId);
      equationCount++;
      continue;
    }

    const derPrefixMatch = /^der_([A-Za-z_][A-Za-z0-9_]*)$/i.exec(target);
    if (derPrefixMatch) {
      const stateVarName = derPrefixMatch[1]!;
      const stateVarIdx = getOrAddVar(stateVarName, true);

      const derExprId = builder.addDer(stateVarIdx);
      const rhsExprId = lowerExprToArena(builder, rhs, getOrAddVar);

      builder.addEquation(EqKind.Simple, derExprId, rhsExprId);
      equationCount++;
      continue;
    }

    // 2. Scalarized Array Element Assignment: A(1) = expr, A(I) = expr, or M(I, J) = expr
    const arrTargetMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*([^)]+)\s*\)$/.exec(target);
    if (arrTargetMatch && !/^(?:SD|S|X)$/i.test(arrTargetMatch[1]!)) {
      const base = arrTargetMatch[1]!;
      const indices = arrTargetMatch[2]!
        .split(",")
        .map((s) => {
          const clean = s.trim();
          const n = Number(clean);
          if (!Number.isNaN(n)) return String(Math.round(n));
          const c = sig.constants[clean] ?? sig.constants[clean.toLowerCase()] ?? sig.constants[clean.toUpperCase()];
          if (typeof c === "number") return String(Math.round(c));
          return clean.replace(/[^A-Za-z0-9_]/g, "_");
        })
        .join("_");
      const scalarName = `${base}_${indices}`;
      const varIdx = getOrAddVar(scalarName, false);
      const lhsExprId = builder.addName(varIdx);
      const rhsExprId = lowerExprToArena(builder, rhs, getOrAddVar);

      builder.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
      equationCount++;
      continue;
    }

    // 3. Algebraic Assignment: Var = expr
    const varMatch = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(target);
    if (varMatch) {
      const varName = varMatch[1]!;
      if (constMap.has(varName.toUpperCase())) continue;
      const varIdx = getOrAddVar(varName, false);
      const lhsExprId = builder.addName(varIdx);
      const rhsExprId = lowerExprToArena(builder, rhs, getOrAddVar);

      builder.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
      equationCount++;
      continue;
    }
  }

  return {
    stateVarIndices,
    inputVarIndices,
    outputVarIndices,
    parameterVarIndices,
    equationCount,
  };
}

function lowerExprToArena(
  builder: IDaeBuilder,
  expr: string,
  getOrAddVar: (name: string, isContinuousState?: boolean) => number,
): number {
  const tokens = tokenizeFortranExpr(expr);
  if (tokens.length === 0) return builder.addRealLiteral(0.0);
  return parseFortranExprTokens(tokens, builder, getOrAddVar);
}

interface FortranExprToken {
  type: "num" | "ident" | "state" | "op" | "lparen" | "rparen" | "comma";
  value: string;
  num?: number;
}

function tokenizeFortranExpr(expr: string): FortranExprToken[] {
  const tokens: FortranExprToken[] = [];
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
      const raw = expr.slice(start, i).replace(/[dD]/g, "e");
      tokens.push({ type: "num", value: raw, num: parseFloat(raw) });
      continue;
    }

    // Exponentiation ** or ^
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

    // Identifiers or state access: S(1), SD(1), X(1)
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(expr[i]!)) {
        i++;
      }
      const ident = expr.slice(start, i);

      // Check for S(1) or SD(1) or X(1)
      if (/^(?:S|SD|X)$/i.test(ident) && i < n && expr[i] === "(") {
        const parenClose = expr.indexOf(")", i);
        if (parenClose > i) {
          const inner = expr.slice(i + 1, parenClose).trim();
          if (/^\d+$/.test(inner)) {
            i = parenClose + 1;
            tokens.push({ type: "state", value: inner });
            continue;
          }
        }
      }

      // Check for scalarized array access: A(1), A(I), or M(I, J)
      if (
        !/^(?:SQRT|SIN|COS|TAN|ASIN|ACOS|ATAN|ATAN2|EXP|LOG|LOG10|ALOG|ABS|MAX|MIN|MOD|SIGN|POW|REAL|INT|DBLE)$/i.test(
          ident,
        ) &&
        i < n &&
        expr[i] === "("
      ) {
        const parenClose = expr.indexOf(")", i);
        if (parenClose > i) {
          const inner = expr.slice(i + 1, parenClose).trim();
          if (/^[A-Za-z0-9_]+(?:\s*,\s*[A-Za-z0-9_]+)*$/.test(inner)) {
            const idxSuffix = inner
              .split(",")
              .map((s) => s.trim())
              .join("_");
            i = parenClose + 1;
            tokens.push({ type: "ident", value: `${ident}_${idxSuffix}` });
            continue;
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

function parseFortranExprTokens(
  tokens: FortranExprToken[],
  builder: IDaeBuilder,
  getOrAddVar: (name: string, isContinuousState?: boolean) => number,
): number {
  let pos = 0;

  function peek(): FortranExprToken | undefined {
    return tokens[pos];
  }

  function consume(): FortranExprToken {
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

      // Function call: IDENT(arg1, arg2, ...)
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

        const fnUpper = identName.toUpperCase();
        if (fnUpper === "SQRT" && args.length >= 1) {
          return builder.addBinaryExpr(BinOp.Pow, args[0]!, builder.addRealLiteral(0.5));
        }
        if (fnUpper === "POW" && args.length >= 2) {
          return builder.addBinaryExpr(BinOp.Pow, args[0]!, args[1]!);
        }
        if (fnUpper === "ABS" && args.length >= 1) {
          if (typeof builder.addCall === "function") {
            return builder.addCall(14, args[0]!, 1); // BuiltinMathFunc.Abs
          }
          return args[0]!;
        }
        if (fnUpper === "EXP" && args.length >= 1) {
          if (typeof builder.addCall === "function") {
            return builder.addCall(10, args[0]!, 1); // BuiltinMathFunc.Exp
          }
          return builder.addBinaryExpr(BinOp.Pow, builder.addRealLiteral(Math.E), args[0]!);
        }
        if (fnUpper === "SIN" && args.length >= 1 && typeof builder.addCall === "function") {
          return builder.addCall(0, args[0]!, 1);
        }
        if (fnUpper === "COS" && args.length >= 1 && typeof builder.addCall === "function") {
          return builder.addCall(1, args[0]!, 1);
        }
        if ((fnUpper === "LOG" || fnUpper === "ALOG") && args.length >= 1 && typeof builder.addCall === "function") {
          return builder.addCall(11, args[0]!, 1);
        }

        return args[0] ?? builder.addRealLiteral(0.0);
      }

      // Check if state reference like S_1
      const sSubMatch = /^(?:S|SD)_?([0-9]+)$/i.exec(identName);
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
