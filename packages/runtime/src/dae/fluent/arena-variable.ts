// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DAEBuilder } from "../wasm_dae.js";
import { Causality, ExprKind, VarType, Variability } from "../wasm_dae.js";
import { ArenaExpr } from "./arena-expr.js";

/**
 * Ephemeral flyweight wrapper around an arena variable declaration (`VarId`) in a `DAEBuilder`.
 *
 * Provides inspection of variable metadata (variability, causality, start value, attributes)
 * and helpers for binding equations or symbolic expression references.
 */
export class ArenaVariable {
  constructor(
    public readonly arena: DAEBuilder,
    public readonly id: number,
  ) {}

  /** Variable identifier name. */
  get name(): string {
    return this.arena.getVarName(this.id);
  }

  /** Variable basic type (Real, Integer, Boolean, String, Enumeration, Clock). */
  get type(): VarType {
    return this.arena.getVarType(this.id);
  }

  /** Variable variability (Continuous, Discrete, Parameter, Constant). */
  get variability(): Variability {
    return this.arena.getVarVariability(this.id);
  }

  /** Variable causality (Local, Input, Output). */
  get causality(): Causality {
    return this.arena.getVarCausality(this.id);
  }

  /** Variable start value. */
  get start(): number {
    return this.arena.getVarStartValue(this.id);
  }

  /** Updates the start value. */
  setStart(val: number): void {
    this.arena.setVarStartValue(this.id, val);
  }

  /** Whether the start value is fixed. */
  get fixed(): boolean {
    return this.arena.isVarFixed(this.id);
  }

  /** Updates the fixed attribute flag. */
  setFixed(fixed: boolean): void {
    this.arena.setVarFixed(this.id, fixed);
  }

  /** Whether this variable is marked as removed from the active arena. */
  get isRemoved(): boolean {
    return this.arena.isVarRemoved(this.id);
  }

  /** Variable binding expression, if explicitly set. */
  get bindingExpr(): ArenaExpr | null {
    const exprId = (this.arena as any).getVarExpression ? (this.arena as any).getVarExpression(this.id) : -1;
    return typeof exprId === "number" && exprId >= 0 ? new ArenaExpr(this.arena, exprId) : null;
  }

  /** Sets or updates the variable's binding expression. */
  setBinding(expr: ArenaExpr | number): void {
    const exprId = typeof expr === "number" ? expr : expr.id;
    if ((this.arena as any).setVarExpression) {
      (this.arena as any).setVarExpression(this.id, exprId);
    }
  }

  /** Creates a symbolic `ArenaExpr` referencing this variable. */
  asExpr(): ArenaExpr {
    const nameId = this.arena.interner.intern(this.name);
    return new ArenaExpr(this.arena, this.arena.addExpression(ExprKind.Name, nameId));
  }

  /** Creates a symbolic `der(var)` derivative expression. */
  derExpr(): ArenaExpr {
    return new ArenaExpr(this.arena, this.arena.addDerExpr(this.asExpr().id));
  }

  /** String representation of variable declaration. */
  toString(): string {
    const varKindStr =
      this.variability === Variability.Parameter
        ? "parameter "
        : this.variability === Variability.Constant
          ? "constant "
          : this.variability === Variability.Discrete
            ? "discrete "
            : "";
    const typeStr =
      this.type === VarType.Real
        ? "Real"
        : this.type === VarType.Integer
          ? "Integer"
          : this.type === VarType.Boolean
            ? "Boolean"
            : this.type === VarType.String
              ? "String"
              : "Var";
    return `${varKindStr}${typeStr} ${this.name}`;
  }
}
