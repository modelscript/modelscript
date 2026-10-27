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
  private varJustifications = new Map<string, Set<number>>();
  private oppositeSignPairs = new Map<string, Set<string>>();
  private sharedEqualities: SharedEquality[] = [];
  private levelStack: {
    intervals: Map<string, Interval | null>;
    aliases: Map<string, string>;
    propagatedEqualities: Set<string>;
    assertedLitIds: number[];
    varJustifications: Map<string, Set<number>>;
    oppositeSignPairs: Map<string, Set<string>>;
  }[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.intervals.clear();
    this.assertedLiterals.clear();
    this.propagatedEqualities.clear();
    this.aliases.clear();
    this.varJustifications.clear();
    this.oppositeSignPairs.clear();
    this.sharedEqualities = [];
    this.levelStack = [];
  }

  public pushLevel(): void {
    const vjSnapshot = new Map<string, Set<number>>();
    for (const [k, v] of this.varJustifications) {
      vjSnapshot.set(k, new Set(v));
    }
    const ospSnapshot = new Map<string, Set<string>>();
    for (const [k, v] of this.oppositeSignPairs) {
      ospSnapshot.set(k, new Set(v));
    }
    this.levelStack.push({
      intervals: new Map(this.intervals),
      aliases: new Map(this.aliases),
      propagatedEqualities: new Set(this.propagatedEqualities),
      assertedLitIds: [],
      varJustifications: vjSnapshot,
      oppositeSignPairs: ospSnapshot,
    });
  }

  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;
    this.intervals = top.intervals;
    this.aliases = top.aliases;
    this.propagatedEqualities = top.propagatedEqualities;
    this.varJustifications = top.varJustifications;
    this.oppositeSignPairs = top.oppositeSignPairs;
    for (const id of top.assertedLitIds) {
      this.assertedLiterals.delete(id);
    }
  }

  private getCanonicalVar(v: string): string {
    let curr = v;
    const visited = new Set<string>();
    while (true) {
      const parent = this.aliases.get(curr);
      if (!parent || parent === curr || visited.has(curr)) {
        break;
      }
      visited.add(curr);
      curr = parent;
    }
    const root = curr;
    this.aliases.set(root, root);
    let node = v;
    const compressVisited = new Set<string>();
    while (node !== root && !compressVisited.has(node)) {
      compressVisited.add(node);
      const next = this.aliases.get(node);
      this.aliases.set(node, root);
      if (!next || next === node) break;
      node = next;
    }
    return root;
  }

  private mirrorOppositeSignBounds(canon: string): void {
    const partners = this.oppositeSignPairs.get(canon);
    if (!partners || partners.size === 0) return;
    const intA = this.getInterval(canon);
    const jA = this.varJustifications.get(canon);
    for (const rawPartner of partners) {
      const canonB = this.getCanonicalVar(rawPartner);
      if (jA) {
        if (!this.varJustifications.has(canonB)) this.varJustifications.set(canonB, new Set());
        const setB = this.varJustifications.get(canonB)!;
        for (const id of jA) setB.add(id);
      }
      if (intA === null) {
        this.intervals.set(canonB, null);
      } else {
        const negA = new Interval(-intA.hi, -intA.lo);
        const intB = this.getInterval(canonB);
        this.intervals.set(canonB, intB ? intersectInterval(intB, negA) : null);
      }
    }
  }

  private registerOppositeSignEquality(rawA: string, rawB: string, justIds: Iterable<number>): void {
    const canonA = this.getCanonicalVar(rawA);
    const canonB = this.getCanonicalVar(rawB);
    if (!this.varJustifications.has(canonA)) this.varJustifications.set(canonA, new Set());
    if (!this.varJustifications.has(canonB)) this.varJustifications.set(canonB, new Set());
    const setA = this.varJustifications.get(canonA)!;
    const setB = this.varJustifications.get(canonB)!;
    for (const id of justIds) {
      setA.add(id);
      setB.add(id);
    }
    for (const id of setA) setB.add(id);
    for (const id of setB) setA.add(id);

    if (!this.oppositeSignPairs.has(canonA)) this.oppositeSignPairs.set(canonA, new Set());
    if (!this.oppositeSignPairs.has(canonB)) this.oppositeSignPairs.set(canonB, new Set());
    this.oppositeSignPairs.get(canonA)!.add(canonB);
    this.oppositeSignPairs.get(canonB)!.add(canonA);

    const intA = this.getInterval(canonA);
    const intB = this.getInterval(canonB);
    if (intA === null || intB === null) {
      this.intervals.set(canonA, null);
      this.intervals.set(canonB, null);
    } else {
      const negB = new Interval(-intB.hi, -intB.lo);
      const negA = new Interval(-intA.hi, -intA.lo);
      this.intervals.set(canonA, intersectInterval(intA, negB));
      this.intervals.set(canonB, intersectInterval(intB, negA));
    }
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

      // Merge justifications
      const jA = this.varJustifications.get(rootA);
      const jB = this.varJustifications.get(rootB);
      if (jA || jB) {
        if (!this.varJustifications.has(rootB)) this.varJustifications.set(rootB, new Set());
        const setB = this.varJustifications.get(rootB)!;
        if (jA) for (const id of jA) setB.add(id);
      }

      // Merge opposite-sign pairs
      const ospA = this.oppositeSignPairs.get(rootA);
      if (ospA) {
        if (!this.oppositeSignPairs.has(rootB)) this.oppositeSignPairs.set(rootB, new Set());
        const ospB = this.oppositeSignPairs.get(rootB)!;
        for (const p of ospA) ospB.add(p);
      }
      this.mirrorOppositeSignBounds(rootB);
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
        if (!this.varJustifications.has(canon)) this.varJustifications.set(canon, new Set());
        this.varJustifications.get(canon)!.add(lit.id);

        const curr = this.getInterval(canon);
        if (!curr) {
          this.intervals.set(canon, null);
          this.mirrorOppositeSignBounds(canon);
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
        this.mirrorOppositeSignBounds(canon);
        break;
      }
      case "equal": {
        const [varA, varB] = args as [string, string];
        const negA = varA.startsWith("-");
        const negB = varB.startsWith("-");
        const cleanA = negA ? varA.slice(1) : varA;
        const cleanB = negB ? varB.slice(1) : varB;
        if (negA !== negB) {
          this.registerOppositeSignEquality(cleanA, cleanB, [lit.id]);
        } else {
          const canonA = this.getCanonicalVar(cleanA);
          const canonB = this.getCanonicalVar(cleanB);
          if (!this.varJustifications.has(canonA)) this.varJustifications.set(canonA, new Set());
          this.varJustifications.get(canonA)!.add(lit.id);
          if (!this.varJustifications.has(canonB)) this.varJustifications.set(canonB, new Set());
          this.varJustifications.get(canonB)!.add(lit.id);

          this.unionVars(cleanA, cleanB);
        }
        break;
      }
      case "interval": {
        const [varName, lo, hi] = args as [string, number, number];
        const canon = this.getCanonicalVar(varName);
        if (!this.varJustifications.has(canon)) this.varJustifications.set(canon, new Set());
        this.varJustifications.get(canon)!.add(lit.id);

        const curr = this.getInterval(canon);
        if (!curr) {
          this.intervals.set(canon, null);
        } else {
          this.intervals.set(canon, intersectInterval(curr, new Interval(lo, hi)));
        }
        this.mirrorOppositeSignBounds(canon);
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
          if (!this.varJustifications.has(canon)) this.varJustifications.set(canon, new Set());
          this.varJustifications.get(canon)!.add(lit.id);

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
              if (!this.varJustifications.has(v)) this.varJustifications.set(v, new Set());
              this.varJustifications.get(v)!.add(lit.id);
            }
          } else {
            for (const [v, contractedInt] of box.entries()) {
              this.intervals.set(v, contractedInt);
              if (!this.varJustifications.has(v)) this.varJustifications.set(v, new Set());
              this.varJustifications.get(v)!.add(lit.id);
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
    const savedStack = this.levelStack;
    // Replay remaining asserted literals and re-apply non-retracted shared equalities
    const remaining = Array.from(this.assertedLiterals.values());
    const savedShared = this.sharedEqualities.filter((eq) => {
      const justs = eq.justifications ?? eq.justification;
      return !justs || !justs.includes(litId);
    });
    this.reset();
    this.levelStack = savedStack;
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
    for (const eq of savedShared) {
      this.onSharedEquality(eq);
    }
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    for (const [varName, interval] of this.intervals.entries()) {
      if (interval === null || interval.lo > interval.hi + 1e-9) {
        const culpritLitIds = this.varJustifications.get(varName) ?? new Set<number>();
        const culprits: TheoryLiteral[] = [];
        for (const id of culpritLitIds) {
          const l = this.assertedLiterals.get(id);
          if (l) {
            culprits.push(l);
          } else {
            culprits.push({
              id,
              predicate: "crossTheoryAntecedent",
              args: [varName],
            });
          }
        }

        for (const l of this.assertedLiterals.values()) {
          if (
            (l.args.includes(varName) || this.getCanonicalVar(l.args[0] as string) === varName) &&
            !culpritLitIds.has(l.id)
          ) {
            culprits.push(l);
          }
        }

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
        // Emit spanning path v[i] == v[i+1] rather than O(V^2) clique
        for (let i = 0; i < vars.length - 1; i++) {
          const vA = vars[i]!;
          const vB = vars[i + 1]!;
          const key = vA < vB ? `${vA}==${vB}` : `${vB}==${vA}`;
          if (!this.propagatedEqualities.has(key)) {
            this.propagatedEqualities.add(key);
            const justA = this.varJustifications.get(this.getCanonicalVar(vA));
            const justB = this.varJustifications.get(this.getCanonicalVar(vB));
            const justs = new Set<number>();
            if (justA) for (const id of justA) justs.add(id);
            if (justB) for (const id of justB) justs.add(id);
            equalities.push({
              varA: vA,
              varB: vB,
              domain: "real",
              bounds: [val, val],
              explanation: `Deduced from identical point intervals [${val}, ${val}]`,
              sourceOracle: this.name,
              justifications: Array.from(justs),
              justification: Array.from(justs),
            });
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
        // Emit spanning path v[i] == v[i+1] rather than O(V^2) clique
        for (let i = 0; i < vars.length - 1; i++) {
          const vA = vars[i]!;
          const vB = vars[i + 1]!;
          const key = vA < vB ? `${vA}==${vB}` : `${vB}==${vA}`;
          if (!this.propagatedEqualities.has(key)) {
            this.propagatedEqualities.add(key);
            const justA = this.varJustifications.get(this.getCanonicalVar(vA));
            const justB = this.varJustifications.get(this.getCanonicalVar(vB));
            const justs = new Set<number>();
            if (justA) for (const id of justA) justs.add(id);
            if (justB) for (const id of justB) justs.add(id);
            equalities.push({
              varA: vA,
              varB: vB,
              domain: "real",
              explanation: `Deduced from alias union ${vA} == ${vB}`,
              sourceOracle: this.name,
              justifications: Array.from(justs),
              justification: Array.from(justs),
            });
          }
        }
      }
    }

    return equalities;
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.sharedEqualities.push(eq);
    const justs = eq.justifications ?? eq.justification ?? [];
    const negA = eq.varA.startsWith("-");
    const negB = eq.varB.startsWith("-");
    const cleanA = negA ? eq.varA.slice(1) : eq.varA;
    const cleanB = negB ? eq.varB.slice(1) : eq.varB;

    if (negA !== negB) {
      this.registerOppositeSignEquality(cleanA, cleanB, justs);
      if (eq.bounds) {
        const canonA = this.getCanonicalVar(cleanA);
        const currA = this.getInterval(canonA);
        const bA = negA ? new Interval(-eq.bounds[1], -eq.bounds[0]) : new Interval(eq.bounds[0], eq.bounds[1]);
        if (currA) {
          this.intervals.set(canonA, intersectInterval(currA, bA));
        }
        this.mirrorOppositeSignBounds(canonA);
      }
      return;
    }

    if (justs.length > 0) {
      const rA = this.getCanonicalVar(cleanA);
      const rB = this.getCanonicalVar(cleanB);
      if (!this.varJustifications.has(rA)) this.varJustifications.set(rA, new Set());
      const setA = this.varJustifications.get(rA)!;
      for (const id of justs) setA.add(id);
      if (!this.varJustifications.has(rB)) this.varJustifications.set(rB, new Set());
      const setB = this.varJustifications.get(rB)!;
      for (const id of justs) setB.add(id);
    }

    this.unionVars(cleanA, cleanB);
    if (eq.bounds) {
      const canon = this.getCanonicalVar(cleanA);
      const curr = this.getInterval(canon);
      const bInt = negA ? new Interval(-eq.bounds[1], -eq.bounds[0]) : new Interval(eq.bounds[0], eq.bounds[1]);
      if (curr) {
        this.intervals.set(canon, intersectInterval(curr, bInt));
      }
      this.mirrorOppositeSignBounds(canon);
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
