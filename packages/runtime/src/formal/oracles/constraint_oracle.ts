// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Constraint Theory Oracle (DPLL(T) / Linear Real Arithmetic).
 *
 * Handles continuous numerical bounds, linear arithmetic equations, and intervals.
 * Propagates tightened bounds and equalities to other oracles in the Nelson-Oppen loop.
 */

import { Interval, intersectInterval } from "../../analysis/wasm_interval.js";
import { type ExprNode, Hc4Contractor, type NonlinearConstraint } from "../hc4_contractor.js";
import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";

export class ConstraintTheoryOracle implements TheoryOracle {
  public readonly name = "ConstraintTheoryOracle";
  public readonly domain = "constraint" as const;

  // Map of canonical variable -> Interval (or null if empty/infeasible)
  private intervals = new Map<string, Interval | null>();
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private propagatedEqualities = new Set<string>();
  private aliases = new Map<string, string>(); // canonical alias mapping
  private sharedEqualities: SharedEquality[] = [];
  private levelStack: {
    intervals: Map<string, Interval | null>;
    aliases: Map<string, string>;
    propagatedEqualities: Set<string>;
    assertedLitIds: number[];
  }[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.intervals.clear();
    this.assertedLiterals.clear();
    this.propagatedEqualities.clear();
    this.aliases.clear();
    this.sharedEqualities = [];
    this.levelStack = [];
  }

  public pushLevel(): void {
    this.levelStack.push({
      intervals: new Map(this.intervals),
      aliases: new Map(this.aliases),
      propagatedEqualities: new Set(this.propagatedEqualities),
      assertedLitIds: [],
    });
  }

  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;
    this.intervals = top.intervals;
    this.aliases = top.aliases;
    this.propagatedEqualities = top.propagatedEqualities;
    for (const id of top.assertedLitIds) {
      this.assertedLiterals.delete(id);
    }
  }

  private getCanonicalVar(v: string): string {
    const parent = this.aliases.get(v);
    if (!parent || parent === v) {
      this.aliases.set(v, v);
      return v;
    }
    const root = this.getCanonicalVar(parent);
    this.aliases.set(v, root);
    return root;
  }

  private unionVars(a: string, b: string): void {
    const rootA = this.getCanonicalVar(a);
    const rootB = this.getCanonicalVar(b);
    if (rootA !== rootB) {
      this.aliases.set(rootA, rootB);
      // Merge intervals
      const intA = this.intervals.get(rootA) ?? new Interval(-Infinity, Infinity);
      const intB = this.intervals.get(rootB) ?? new Interval(-Infinity, Infinity);
      const merged = intA && intB ? intersectInterval(intA, intB) : null;
      this.intervals.set(rootB, merged);
    }
  }

  public getInterval(varName: string): Interval | null {
    const canon = this.getCanonicalVar(varName);
    if (this.intervals.has(canon)) {
      return this.intervals.get(canon) ?? null;
    }
    return new Interval(-Infinity, Infinity);
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.assertedLiterals.set(lit.id, lit);
    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1]!.assertedLitIds.push(lit.id);
    }
    const { predicate, args } = lit;

    switch (predicate) {
      case "bound": {
        const [varName, op, val] = args as [string, "<=" | "<" | ">=" | ">" | "==", number];
        const canon = this.getCanonicalVar(varName);
        const curr = this.getInterval(canon);
        if (!curr) {
          this.intervals.set(canon, null);
          break;
        }

        let boundInt: Interval;
        if (op === "<=" || op === "<") {
          boundInt = new Interval(-Infinity, val);
        } else if (op === ">=" || op === ">") {
          boundInt = new Interval(val, Infinity);
        } else if (op === "==") {
          boundInt = new Interval(val, val);
        } else {
          boundInt = new Interval(-Infinity, Infinity);
        }

        this.intervals.set(canon, intersectInterval(curr, boundInt));
        break;
      }
      case "equal": {
        const [varA, varB] = args as [string, string];
        this.unionVars(varA, varB);
        break;
      }
      case "interval": {
        const [varName, lo, hi] = args as [string, number, number];
        const canon = this.getCanonicalVar(varName);
        const curr = this.getInterval(canon);
        if (!curr) {
          this.intervals.set(canon, null);
        } else {
          this.intervals.set(canon, intersectInterval(curr, new Interval(lo, hi)));
        }
        break;
      }
      case "hyperplane": {
        // args: [coefficients: Record<string, number>, op: ">=" | "<=" | "==", constant: number]
        const [coeffs, op, rhsVal] = args as [Record<string, number>, ">=" | "<=" | "==", number];
        const box = new Map<string, Interval>();
        let sumExpr: ExprNode | null = null;
        let isAlreadyInfeasible = false;

        for (const [vName, coeff] of Object.entries(coeffs)) {
          const canon = this.getCanonicalVar(vName);
          const current = this.getInterval(canon);
          if (current === null) {
            isAlreadyInfeasible = true;
            break;
          }
          box.set(canon, new Interval(current.lo, current.hi));
          const termExpr: ExprNode = {
            kind: "mul",
            left: { kind: "const", value: coeff },
            right: { kind: "var", name: canon },
          };
          sumExpr = sumExpr ? { kind: "add", left: sumExpr, right: termExpr } : termExpr;
        }

        if (isAlreadyInfeasible) {
          break;
        }

        if (sumExpr) {
          const constraint: NonlinearConstraint = {
            expr: sumExpr,
            rel: op,
            rhs: rhsVal,
          };
          const valid = Hc4Contractor.revise(constraint, box);
          if (!valid) {
            for (const vName of Object.keys(coeffs)) {
              this.intervals.set(this.getCanonicalVar(vName), null);
            }
          } else {
            for (const [vName, contractedInt] of box.entries()) {
              this.intervals.set(vName, contractedInt);
            }
          }
        }
        break;
      }
      case "nonlinear":
      case "expr": {
        const [constraint] = args as [NonlinearConstraint];
        if (constraint && constraint.expr) {
          const box = new Map<string, Interval>();
          let hasNull = false;
          for (const [v, int] of this.intervals.entries()) {
            if (int === null) {
              hasNull = true;
              break;
            }
            box.set(v, new Interval(int.lo, int.hi));
          }
          if (hasNull) break;
          const valid = Hc4Contractor.revise(constraint, box);
          if (!valid) {
            for (const [v] of box.entries()) {
              this.intervals.set(v, null);
            }
          } else {
            for (const [v, contractedInt] of box.entries()) {
              this.intervals.set(v, contractedInt);
            }
          }
        }
        break;
      }
    }

    return true;
  }

  public retractLiteral(litId: number): void {
    if (!this.assertedLiterals.has(litId)) return;
    this.assertedLiterals.delete(litId);
    // Replay remaining asserted literals and re-apply shared equalities
    const remaining = Array.from(this.assertedLiterals.values());
    const savedShared = [...this.sharedEqualities];
    this.reset();
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
    for (const eq of savedShared) {
      this.onSharedEquality(eq);
    }
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause } {
    for (const [varName, interval] of this.intervals.entries()) {
      if (interval === null || interval.lo > interval.hi + 1e-9) {
        const culprits = Array.from(this.assertedLiterals.values()).filter(
          (l) => l.args.includes(varName) || this.getCanonicalVar(l.args[0] as string) === varName,
        );

        return {
          isSat: false,
          conflict: {
            literals: culprits,
            explanation: `Arithmetic Bound Conflict: Variable '${varName}' has empty interval. Lower bound exceeds upper bound.`,
            culpritEntities: [varName],
            theoryName: this.name,
          },
        };
      }
    }
    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    const equalities: SharedEquality[] = [];

    // 1. Point intervals: If x in [c, c] and y in [c, c], x = y
    const pointVars = new Map<number, string[]>();
    for (const [v, int] of this.intervals.entries()) {
      if (int && Math.abs(int.lo - int.hi) <= 1e-9 && isFinite(int.lo)) {
        const val = int.lo;
        if (!pointVars.has(val)) pointVars.set(val, []);
        pointVars.get(val)!.push(v);
      }
    }

    for (const [val, vars] of pointVars.entries()) {
      if (vars.length > 1) {
        for (let i = 0; i < vars.length; i++) {
          for (let j = i + 1; j < vars.length; j++) {
            const vA = vars[i]!;
            const vB = vars[j]!;
            const key = vA < vB ? `${vA}==${vB}` : `${vB}==${vA}`;
            if (!this.propagatedEqualities.has(key)) {
              this.propagatedEqualities.add(key);
              equalities.push({
                varA: vA,
                varB: vB,
                domain: "real",
                bounds: [val, val],
                explanation: `Deduced from identical point intervals [${val}, ${val}]`,
                sourceOracle: this.name,
              });
            }
          }
        }
      }
    }

    // 2. Propagate merged aliases
    const aliasGroups = new Map<string, string[]>();
    for (const [v] of this.aliases.entries()) {
      const root = this.getCanonicalVar(v);
      if (!aliasGroups.has(root)) aliasGroups.set(root, []);
      aliasGroups.get(root)!.push(v);
    }

    for (const [, vars] of aliasGroups.entries()) {
      if (vars.length > 1) {
        for (let i = 0; i < vars.length; i++) {
          for (let j = i + 1; j < vars.length; j++) {
            const vA = vars[i]!;
            const vB = vars[j]!;
            const key = vA < vB ? `${vA}==${vB}` : `${vB}==${vA}`;
            if (!this.propagatedEqualities.has(key)) {
              this.propagatedEqualities.add(key);
              equalities.push({
                varA: vA,
                varB: vB,
                domain: "real",
                explanation: `Deduced from alias union ${vA} == ${vB}`,
                sourceOracle: this.name,
              });
            }
          }
        }
      }
    }

    return equalities;
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.sharedEqualities.push(eq);
    this.unionVars(eq.varA, eq.varB);
    if (eq.bounds) {
      const canon = this.getCanonicalVar(eq.varA);
      const curr = this.getInterval(canon);
      if (curr) {
        this.intervals.set(canon, intersectInterval(curr, new Interval(eq.bounds[0], eq.bounds[1])));
      }
    }
  }

  public getModel(): Record<string, number> {
    const model: Record<string, number> = {};
    for (const [v, int] of this.intervals.entries()) {
      if (int) {
        model[v] = int.mid;
      }
    }
    return model;
  }
}
