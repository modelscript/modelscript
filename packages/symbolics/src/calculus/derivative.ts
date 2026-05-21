// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Symbolic differentiation of Modelica DAE expressions.
 * Bridges the legacy AST representation with the new Arena DAE calculus engine.
 */

import { ArenaDAEBuilder, differentiateArenaExpr, simplifyArenaExpr } from "@modelscript/compiler";
import { ModelicaBinaryOperator, ModelicaUnaryOperator } from "@modelscript/modelica/ast";
import type { ModelicaExpression } from "../systems/index.js";
import {
  materializeExpression,
  mirrorExpressionToArena,
  ModelicaBinaryExpression,
  ModelicaFunctionCallExpression,
  ModelicaIntegerLiteral,
  ModelicaRealLiteral,
  ModelicaUnaryExpression,
} from "../systems/index.js";

// ── Bridge APIs ──

export function differentiateExpr(expr: ModelicaExpression, varName: string): ModelicaExpression {
  const arena = new ArenaDAEBuilder();
  const exprId = mirrorExpressionToArena(arena, expr);
  const diffId = differentiateArenaExpr(arena, exprId, varName);
  return materializeExpression(arena, diffId);
}

export function simplifyExpr(expr: ModelicaExpression): ModelicaExpression {
  const arena = new ArenaDAEBuilder();
  const exprId = mirrorExpressionToArena(arena, expr);
  const simpId = simplifyArenaExpr(arena, exprId);
  return materializeExpression(arena, simpId);
}

// ── Constants ──
export const ZERO = new ModelicaRealLiteral(0.0);
export const ONE = new ModelicaRealLiteral(1.0);
export const TWO = new ModelicaRealLiteral(2.0);
export const HALF = new ModelicaRealLiteral(0.5);
export const NEG_ONE = new ModelicaRealLiteral(-1.0);

export const DIFF_ZERO = ZERO;
export const DIFF_ONE = ONE;
export const DIFF_TWO = TWO;
export const DIFF_HALF = HALF;
export const DIFF_NEG_ONE = NEG_ONE;

// ── Helpers ──

export function isZero(expr: ModelicaExpression): boolean {
  if (expr instanceof ModelicaRealLiteral) return expr.value === 0;
  if (expr instanceof ModelicaIntegerLiteral) return expr.value === 0;
  return false;
}

export function isOne(expr: ModelicaExpression): boolean {
  if (expr instanceof ModelicaRealLiteral) return expr.value === 1;
  if (expr instanceof ModelicaIntegerLiteral) return expr.value === 1;
  return false;
}

export function add(a: ModelicaExpression, b: ModelicaExpression): ModelicaExpression {
  if (isZero(a)) return b;
  if (isZero(b)) return a;
  return new ModelicaBinaryExpression(ModelicaBinaryOperator.ADDITION, a, b);
}

export function sub(a: ModelicaExpression, b: ModelicaExpression): ModelicaExpression {
  if (isZero(b)) return a;
  if (isZero(a)) return negate(b);
  return new ModelicaBinaryExpression(ModelicaBinaryOperator.SUBTRACTION, a, b);
}

export function mul(a: ModelicaExpression, b: ModelicaExpression): ModelicaExpression {
  if (isZero(a) || isZero(b)) return ZERO;
  if (isOne(a)) return b;
  if (isOne(b)) return a;
  return new ModelicaBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, a, b);
}

export function div(a: ModelicaExpression, b: ModelicaExpression): ModelicaExpression {
  if (isZero(a)) return ZERO;
  if (isOne(b)) return a;
  return new ModelicaBinaryExpression(ModelicaBinaryOperator.DIVISION, a, b);
}

export function pow(base: ModelicaExpression, exp: ModelicaExpression): ModelicaExpression {
  if (isZero(exp)) return ONE;
  if (isOne(exp)) return base;
  return new ModelicaBinaryExpression(ModelicaBinaryOperator.EXPONENTIATION, base, exp);
}

export function call(name: string, ...args: ModelicaExpression[]): ModelicaExpression {
  return new ModelicaFunctionCallExpression(name, args);
}

export function negate(expr: ModelicaExpression): ModelicaExpression {
  if (isZero(expr)) return ZERO;
  if (expr instanceof ModelicaUnaryExpression && expr.operator === ModelicaUnaryOperator.UNARY_MINUS) {
    return expr.operand;
  }
  return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, expr);
}
