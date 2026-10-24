// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DAEBuilder } from "../wasm_dae.js";
import { EqKind } from "../wasm_dae.js";
import { ArenaExpr } from "./arena-expr.js";

/**
 * Ephemeral flyweight wrapper around an arena equation (`EqId`) in a `DAEBuilder`.
 *
 * Enables fluent equation inspection, left/right hand side rewriting, and kind tagging.
 */
export class ArenaEquation {
  constructor(
    public readonly arena: DAEBuilder,
    public readonly id: number,
  ) {}

  /** The equation kind tag. */
  get kind(): EqKind {
    return this.arena.getEqKind(this.id);
  }

  /** Updates the equation kind tag. */
  setKind(kind: EqKind): void {
    this.arena.setEqKind(this.id, kind);
  }

  /** The left-hand side expression. */
  get lhs(): ArenaExpr {
    return new ArenaExpr(this.arena, this.arena.getEqLhs(this.id));
  }

  /** Updates the left-hand side expression. */
  setLhs(expr: ArenaExpr | number): void {
    const exprId = typeof expr === "number" ? expr : expr.id;
    this.arena.setEqLhs(this.id, exprId);
  }

  /** The right-hand side expression. */
  get rhs(): ArenaExpr {
    return new ArenaExpr(this.arena, this.arena.getEqRhs(this.id));
  }

  /** Updates the right-hand side expression. */
  setRhs(expr: ArenaExpr | number): void {
    const exprId = typeof expr === "number" ? expr : expr.id;
    this.arena.setEqRhs(this.id, exprId);
  }

  /** Equation auxiliary data / bitmask flags. */
  get flags(): number {
    return this.arena.getEqFlags ? this.arena.getEqFlags(this.id) : this.arena.getEqAux(this.id);
  }

  /** True if this is an initial equation. */
  get isInitial(): boolean {
    const k = this.kind;
    return (
      k === EqKind.InitialSimple ||
      k === EqKind.InitialFor ||
      k === EqKind.InitialFunctionCall ||
      (this.arena.isEqInitial ? this.arena.isEqInitial(this.id) : false)
    );
  }

  /** True if this equation has been marked removed in the arena. */
  get isRemoved(): boolean {
    return this.arena.isEqRemoved ? this.arena.isEqRemoved(this.id) : false;
  }

  /** Marks this equation as removed. */
  remove(): void {
    if (this.arena.removeEquation) {
      this.arena.removeEquation(this.id);
    }
  }

  /** Returns formatted equation text (`lhs = rhs;`). */
  toString(): string {
    const lhsText = this.lhs.toString();
    const rhsText = this.rhs.toString();
    const prefix = this.isInitial ? "initial equation " : "";
    return `${prefix}${lhsText} = ${rhsText};`;
  }
}
