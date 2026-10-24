// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DAEBuilder } from "../wasm_dae.js";
import { BinOp, ExprKind, UnaryOp } from "../wasm_dae.js";

/**
 * Ephemeral flyweight wrapper around an arena `ExprId` in a `DAEBuilder`.
 *
 * Provides a symbolic fluent interface for inspecting and composing expressions
 * directly in linear memory without constructing intermediate AST heap objects.
 */
export class ArenaExpr {
  constructor(
    public readonly arena: DAEBuilder,
    public readonly id: number,
  ) {}

  /** The expression kind tag. */
  get kind(): ExprKind {
    return this.arena.getExprKind(this.id);
  }

  /** True if this expression is an integer, real, boolean, or string literal. */
  get isLiteral(): boolean {
    const k = this.kind;
    return (
      k === ExprKind.IntLiteral ||
      k === ExprKind.RealLiteral ||
      k === ExprKind.BoolLiteral ||
      k === ExprKind.StringLiteral ||
      k === ExprKind.EnumLiteral
    );
  }

  /** Real-valued numeric literal value, or `null` if not a RealLiteral. */
  get realValue(): number | null {
    return this.kind === ExprKind.RealLiteral ? this.arena.getExprRealValue(this.id) : null;
  }

  /** Integer numeric literal value, or `null` if not an IntLiteral. */
  get intValue(): number | null {
    return this.kind === ExprKind.IntLiteral ? this.arena.getExprData1(this.id) : null;
  }

  /** Boolean literal value, or `null` if not a BoolLiteral. */
  get boolValue(): boolean | null {
    return this.kind === ExprKind.BoolLiteral ? this.arena.getExprData1(this.id) !== 0 : null;
  }

  /** Variable name if this expression is a Name or Der node, or `null` otherwise. */
  get varName(): string | null {
    if (this.kind === ExprKind.Name) {
      const strId = this.arena.getExprData1(this.id);
      return this.arena.interner.resolve(strId);
    }
    if (this.kind === ExprKind.Der) {
      const argId = this.arena.getExprData1(this.id);
      const innerName = this.arena.interner.resolve(this.arena.getExprData1(argId));
      return innerName ? `der(${innerName})` : null;
    }
    return null;
  }

  /** Checks whether this expression represents a variable (optionally matching a specific name). */
  isVar(targetName?: string): boolean {
    const name = this.varName;
    if (name === null) return false;
    return targetName === undefined || name === targetName;
  }

  /** Checks whether this expression represents a derivative (optionally matching the differentiated variable). */
  isDer(targetVarName?: string): boolean {
    if (this.kind !== ExprKind.Der) return false;
    if (!targetVarName) return true;
    const argId = this.arena.getExprData1(this.id);
    const innerName = this.arena.interner.resolve(this.arena.getExprData1(argId));
    return innerName === targetVarName;
  }

  /** Left child expression, or `null` if none. */
  get left(): ArenaExpr | null {
    const lId = this.arena.getExprLeft(this.id);
    return lId >= 0 ? new ArenaExpr(this.arena, lId) : null;
  }

  /** Right child expression, or `null` if none. */
  get right(): ArenaExpr | null {
    const rId = this.arena.getExprRight(this.id);
    return rId >= 0 ? new ArenaExpr(this.arena, rId) : null;
  }

  /** Primary integer payload / metadata word (`data1`). */
  get data1(): number {
    return this.arena.getExprData1(this.id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Arithmetic Operators
  // ───────────────────────────────────────────────────────────────────────────

  add(other: ArenaExpr | number): ArenaExpr {
    const rId = typeof other === "number" ? this.arena.addRealLiteral(other) : other.id;
    return new ArenaExpr(this.arena, this.arena.addBinaryExpr(BinOp.Add, this.id, rId));
  }

  sub(other: ArenaExpr | number): ArenaExpr {
    const rId = typeof other === "number" ? this.arena.addRealLiteral(other) : other.id;
    return new ArenaExpr(this.arena, this.arena.addBinaryExpr(BinOp.Sub, this.id, rId));
  }

  mul(other: ArenaExpr | number): ArenaExpr {
    const rId = typeof other === "number" ? this.arena.addRealLiteral(other) : other.id;
    return new ArenaExpr(this.arena, this.arena.addBinaryExpr(BinOp.Mul, this.id, rId));
  }

  div(other: ArenaExpr | number): ArenaExpr {
    const rId = typeof other === "number" ? this.arena.addRealLiteral(other) : other.id;
    return new ArenaExpr(this.arena, this.arena.addBinaryExpr(BinOp.Div, this.id, rId));
  }

  pow(other: ArenaExpr | number): ArenaExpr {
    const rId = typeof other === "number" ? this.arena.addRealLiteral(other) : other.id;
    return new ArenaExpr(this.arena, this.arena.addBinaryExpr(BinOp.Pow, this.id, rId));
  }

  mod(other: ArenaExpr | number): ArenaExpr {
    const rId = typeof other === "number" ? this.arena.addRealLiteral(other) : other.id;
    return new ArenaExpr(this.arena, this.arena.addCallExpr("mod", [this.id, rId]));
  }

  neg(): ArenaExpr {
    return new ArenaExpr(this.arena, this.arena.addUnaryExpr(UnaryOp.Negate, this.id));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Relational & Logical Operators
  // ───────────────────────────────────────────────────────────────────────────

  eq(other: ArenaExpr | number | boolean): ArenaExpr {
    const rId =
      typeof other === "number"
        ? this.arena.addRealLiteral(other)
        : typeof other === "boolean"
          ? this.arena.addBoolLiteral(other)
          : other.id;
    return new ArenaExpr(this.arena, this.arena.addBinaryExpr(BinOp.Eq, this.id, rId));
  }

  neq(other: ArenaExpr | number | boolean): ArenaExpr {
    const rId =
      typeof other === "number"
        ? this.arena.addRealLiteral(other)
        : typeof other === "boolean"
          ? this.arena.addBoolLiteral(other)
          : other.id;
    return new ArenaExpr(this.arena, this.arena.addBinaryExpr(BinOp.Neq, this.id, rId));
  }

  lt(other: ArenaExpr | number): ArenaExpr {
    const rId = typeof other === "number" ? this.arena.addRealLiteral(other) : other.id;
    return new ArenaExpr(this.arena, this.arena.addBinaryExpr(BinOp.Lt, this.id, rId));
  }

  lte(other: ArenaExpr | number): ArenaExpr {
    const rId = typeof other === "number" ? this.arena.addRealLiteral(other) : other.id;
    return new ArenaExpr(this.arena, this.arena.addBinaryExpr(BinOp.Lte, this.id, rId));
  }

  gt(other: ArenaExpr | number): ArenaExpr {
    const rId = typeof other === "number" ? this.arena.addRealLiteral(other) : other.id;
    return new ArenaExpr(this.arena, this.arena.addBinaryExpr(BinOp.Gt, this.id, rId));
  }

  gte(other: ArenaExpr | number): ArenaExpr {
    const rId = typeof other === "number" ? this.arena.addRealLiteral(other) : other.id;
    return new ArenaExpr(this.arena, this.arena.addBinaryExpr(BinOp.Gte, this.id, rId));
  }

  and(other: ArenaExpr | boolean): ArenaExpr {
    const rId = typeof other === "boolean" ? this.arena.addBoolLiteral(other) : other.id;
    return new ArenaExpr(this.arena, this.arena.addBinaryExpr(BinOp.And, this.id, rId));
  }

  or(other: ArenaExpr | boolean): ArenaExpr {
    const rId = typeof other === "boolean" ? this.arena.addBoolLiteral(other) : other.id;
    return new ArenaExpr(this.arena, this.arena.addBinaryExpr(BinOp.Or, this.id, rId));
  }

  not(): ArenaExpr {
    return new ArenaExpr(this.arena, this.arena.addUnaryExpr(UnaryOp.Not, this.id));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Common Mathematical Functions
  // ───────────────────────────────────────────────────────────────────────────

  sin(): ArenaExpr {
    return new ArenaExpr(this.arena, this.arena.addCallExpr("sin", [this.id]));
  }

  cos(): ArenaExpr {
    return new ArenaExpr(this.arena, this.arena.addCallExpr("cos", [this.id]));
  }

  tan(): ArenaExpr {
    return new ArenaExpr(this.arena, this.arena.addCallExpr("tan", [this.id]));
  }

  exp(): ArenaExpr {
    return new ArenaExpr(this.arena, this.arena.addCallExpr("exp", [this.id]));
  }

  log(): ArenaExpr {
    return new ArenaExpr(this.arena, this.arena.addCallExpr("log", [this.id]));
  }

  sqrt(): ArenaExpr {
    return new ArenaExpr(this.arena, this.arena.addCallExpr("sqrt", [this.id]));
  }

  abs(): ArenaExpr {
    return new ArenaExpr(this.arena, this.arena.addCallExpr("abs", [this.id]));
  }

  /** Wraps this expression in a `der(...)` time derivative operator. */
  der(): ArenaExpr {
    return new ArenaExpr(this.arena, this.arena.addDerExpr(this.id));
  }

  /** Pretty-prints this expression into canonical Modelica text. */
  toString(): string {
    return (this.arena as any).printExpr ? (this.arena as any).printExpr(this.id) : `expr#${this.id}`;
  }
}
