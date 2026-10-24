// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DAEBuilder } from "../dae/wasm_dae.js";
import { BinOp, ExprKind, UnaryOp } from "../dae/wasm_dae.js";

/**
 * Symbolic pattern AST node for term rewriting.
 */
export type PatternNode =
  | { type: "var"; name: string }
  | { type: "lit"; value: number }
  | { type: "bin"; op: BinOp; left: PatternNode; right: PatternNode }
  | { type: "unary"; op: UnaryOp; operand: PatternNode }
  | { type: "call"; name: string; args: PatternNode[] };

/**
 * Tokenizes a simple pattern string into lexical tokens.
 */
function tokenize(str: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < str.length) {
    const ch = str[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[()+\-*/^,]/.test(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === "?") {
      let ident = "?";
      i++;
      while (i < str.length && /[a-zA-Z0-9_]/.test(str[i]!)) {
        ident += str[i]!;
        i++;
      }
      tokens.push(ident);
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < str.length && /[0-9.]/.test(str[i]!)) {
        num += str[i]!;
        i++;
      }
      tokens.push(num);
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < str.length && /[a-zA-Z0-9_]/.test(str[i]!)) {
        ident += str[i]!;
        i++;
      }
      tokens.push(ident);
      continue;
    }
    tokens.push(ch);
    i++;
  }
  return tokens;
}

/**
 * Recursive descent parser for pattern expressions.
 */
export function parsePattern(str: string): PatternNode {
  const tokens = tokenize(str);
  let pos = 0;

  function peek(): string | undefined {
    return tokens[pos];
  }

  function consume(expected?: string): string {
    const t = tokens[pos];
    if (expected !== undefined && t !== expected) {
      throw new Error(`Expected '${expected}' but found '${t}' in pattern '${str}'`);
    }
    pos++;
    return t!;
  }

  function parseExpression(): PatternNode {
    return parseAddition();
  }

  function parseAddition(): PatternNode {
    let left = parseMultiplication();
    while (peek() === "+" || peek() === "-") {
      const op = consume() === "+" ? BinOp.Add : BinOp.Sub;
      const right = parseMultiplication();
      left = { type: "bin", op, left, right };
    }
    return left;
  }

  function parseMultiplication(): PatternNode {
    let left = parsePower();
    while (peek() === "*" || peek() === "/") {
      const op = consume() === "*" ? BinOp.Mul : BinOp.Div;
      const right = parsePower();
      left = { type: "bin", op, left, right };
    }
    return left;
  }

  function parsePower(): PatternNode {
    let left = parseUnary();
    while (peek() === "^") {
      consume("^");
      const right = parseUnary();
      left = { type: "bin", op: BinOp.Pow, left, right };
    }
    return left;
  }

  function parseUnary(): PatternNode {
    if (peek() === "-") {
      consume("-");
      return { type: "unary", op: UnaryOp.Negate, operand: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): PatternNode {
    const t = peek();
    if (!t) throw new Error(`Unexpected end of pattern '${str}'`);

    if (t === "(") {
      consume("(");
      const inner = parseExpression();
      consume(")");
      return inner;
    }

    if (t.startsWith("?")) {
      return { type: "var", name: consume() };
    }

    if (/^[0-9]/.test(t)) {
      return { type: "lit", value: parseFloat(consume()) };
    }

    const ident = consume();
    if (peek() === "(") {
      consume("(");
      const args: PatternNode[] = [];
      if (peek() !== ")") {
        args.push(parseExpression());
        while (peek() === ",") {
          consume(",");
          args.push(parseExpression());
        }
      }
      consume(")");
      return { type: "call", name: ident, args };
    }

    // Concrete name as variable or literal
    return { type: "var", name: ident };
  }

  const res = parseExpression();
  if (pos < tokens.length) {
    throw new Error(`Unexpected trailing tokens in pattern '${str}' near '${tokens[pos]}'`);
  }
  return res;
}

/**
 * Matches a pattern AST against an arena expression, populating variable bindings.
 */
export function matchPattern(
  pattern: PatternNode,
  arena: DAEBuilder,
  exprId: number,
  bindings: Map<string, number>,
): boolean {
  if (exprId < 0) return false;
  const kind = arena.getExprKind(exprId);

  switch (pattern.type) {
    case "var": {
      if (pattern.name.startsWith("?")) {
        const existing = bindings.get(pattern.name);
        if (existing !== undefined) {
          return areExprsEquivalent(arena, existing, exprId);
        }
        bindings.set(pattern.name, exprId);
        return true;
      }
      if (kind === ExprKind.Name) {
        const name = arena.interner.resolve(arena.getExprData1(exprId));
        return name === pattern.name;
      }
      return false;
    }

    case "lit": {
      if (kind === ExprKind.RealLiteral) {
        return Math.abs(arena.getExprRealValue(exprId) - pattern.value) < 1e-12;
      }
      if (kind === ExprKind.IntLiteral) {
        return arena.getExprData1(exprId) === pattern.value;
      }
      return false;
    }

    case "unary": {
      if (kind === ExprKind.Negate && pattern.op === UnaryOp.Negate) {
        return matchPattern(pattern.operand, arena, arena.getExprLeft(exprId), bindings);
      }
      if (kind === ExprKind.Unary && arena.getExprData1(exprId) === pattern.op) {
        return matchPattern(pattern.operand, arena, arena.getExprLeft(exprId), bindings);
      }
      return false;
    }

    case "bin": {
      if (kind !== ExprKind.Binary || arena.getExprData1(exprId) !== pattern.op) {
        return false;
      }
      const leftId = arena.getExprLeft(exprId);
      const rightId = arena.getExprRight(exprId);
      return (
        matchPattern(pattern.left, arena, leftId, bindings) && matchPattern(pattern.right, arena, rightId, bindings)
      );
    }

    case "call": {
      if (kind !== ExprKind.Call) return false;
      const funcName = arena.interner.resolve(arena.getExprData1(exprId));
      if (funcName !== pattern.name) return false;
      const argCount = arena.getExprRight(exprId);
      if (argCount !== pattern.args.length) return false;
      const firstArg = arena.getExprLeft(exprId);
      for (let i = 0; i < argCount; i++) {
        const argId = i === 0 ? firstArg : arena.getExprLeft(firstArg + i);
        if (!matchPattern(pattern.args[i]!, arena, argId, bindings)) {
          return false;
        }
      }
      return true;
    }
  }
}

/**
 * Instantiates a pattern AST using variable bindings, adding new expressions to the arena.
 */
export function instantiatePattern(pattern: PatternNode, arena: DAEBuilder, bindings: Map<string, number>): number {
  switch (pattern.type) {
    case "var": {
      if (pattern.name.startsWith("?")) {
        const bound = bindings.get(pattern.name);
        if (bound === undefined) {
          throw new Error(`Unbound pattern variable '${pattern.name}' during replacement.`);
        }
        return bound;
      }
      const nameId = arena.interner.intern(pattern.name);
      return arena.addExpression(ExprKind.Name, nameId);
    }

    case "lit":
      return arena.addRealLiteral(pattern.value);

    case "unary": {
      const inner = instantiatePattern(pattern.operand, arena, bindings);
      return arena.addUnaryExpr(pattern.op, inner);
    }

    case "bin": {
      const left = instantiatePattern(pattern.left, arena, bindings);
      const right = instantiatePattern(pattern.right, arena, bindings);
      return arena.addBinaryExpr(pattern.op, left, right);
    }

    case "call": {
      const args = pattern.args.map((a) => instantiatePattern(a, arena, bindings));
      return arena.addCallExpr(pattern.name, args);
    }
  }
}

function areExprsEquivalent(arena: DAEBuilder, a: number, b: number): boolean {
  if (a === b) return true;
  const kA = arena.getExprKind(a);
  const kB = arena.getExprKind(b);
  if (kA !== kB) return false;
  if (kA === ExprKind.Name) {
    return arena.getExprData1(a) === arena.getExprData1(b);
  }
  if (kA === ExprKind.RealLiteral) {
    return Math.abs(arena.getExprRealValue(a) - arena.getExprRealValue(b)) < 1e-12;
  }
  if (kA === ExprKind.IntLiteral) {
    return arena.getExprData1(a) === arena.getExprData1(b);
  }
  return false;
}
