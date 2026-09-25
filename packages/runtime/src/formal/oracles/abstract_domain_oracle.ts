// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Abstract Domain Theory Oracle (Octagon DBM & 4D Spatiotemporal Bounds).
 *
 * Tracks difference bounds (±x_i ± x_j ≤ c) and 4D time intervals using Difference Bound Matrices.
 * Detects negative cycles (temporal ordering contradictions) and propagates relational equalities.
 */

import { OctagonDBM } from "../../analysis/octagon_dbm.js";
import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";

export class AbstractDomainOracle implements TheoryOracle {
  public readonly name = "AbstractDomainOracle";
  public readonly domain = "abstract_domain" as const;

  private varToIdx = new Map<string, number>();
  private idxToVar: string[] = [];
  private dbm: OctagonDBM;
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private propagatedEqualities = new Set<string>();
  private sharedEqualities: SharedEquality[] = [];
  private levelStack: {
    dbm: OctagonDBM;
    varToIdx: Map<string, number>;
    idxToVar: string[];
    assertedLitIds: number[];
  }[] = [];

  constructor(maxVars = 64) {
    this.dbm = new OctagonDBM(maxVars);
    this.reset();
  }

  public reset(): void {
    this.varToIdx.clear();
    this.idxToVar = [];
    this.assertedLiterals.clear();
    this.propagatedEqualities.clear();
    this.sharedEqualities = [];
    this.levelStack = [];
    this.dbm.reset();
  }

  public pushLevel(): void {
    this.levelStack.push({
      dbm: this.dbm.clone(),
      varToIdx: new Map(this.varToIdx),
      idxToVar: [...this.idxToVar],
      assertedLitIds: [],
    });
  }

  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;
    this.dbm = top.dbm;
    this.varToIdx = top.varToIdx;
    this.idxToVar = top.idxToVar;
    for (const id of top.assertedLitIds) {
      this.assertedLiterals.delete(id);
    }
  }

  private getOrAllocVar(name: string): number {
    let idx = this.varToIdx.get(name);
    if (idx !== undefined) return idx;

    idx = this.idxToVar.length;
    this.idxToVar.push(name);
    this.varToIdx.set(name, idx);

    if (idx >= this.dbm.numVars) {
      // Re-allocate larger DBM and copy
      const oldDbm = this.dbm;
      this.dbm = new OctagonDBM(Math.max(this.dbm.numVars * 2, idx + 16));
      // Replay all asserted literals into new DBM
      for (const lit of this.assertedLiterals.values()) {
        this.applyLiteralToDbm(lit);
      }
    }
    return idx;
  }

  private applyLiteralToDbm(lit: TheoryLiteral): void {
    const { predicate, args } = lit;
    switch (predicate) {
      case "diff": {
        const [varA, varB, maxDiff] = args as [string, string, number];
        const idxA = this.getOrAllocVar(varA);
        const idxB = this.getOrAllocVar(varB);
        this.dbm.assumeDiff(idxA, idxB, maxDiff);
        break;
      }
      case "time_succession": {
        // Event B succeeds Event A: t_B - t_A in [minDelay, maxDelay]
        const [eventA, eventB, minDelay, maxDelay] = args as [string, string, number, number];
        const idxA = this.getOrAllocVar(eventA);
        const idxB = this.getOrAllocVar(eventB);
        // t_B - t_A <= maxDelay
        this.dbm.assumeDiff(idxB, idxA, maxDelay);
        // t_A - t_B <= -minDelay (equivalent to t_B - t_A >= minDelay)
        this.dbm.assumeDiff(idxA, idxB, -minDelay);
        break;
      }
      case "interval": {
        const [varName, lo, hi] = args as [string, number, number];
        const idx = this.getOrAllocVar(varName);
        this.dbm.assumeInterval(idx, lo, hi);
        break;
      }
      case "equal": {
        const [varA, varB] = args as [string, string];
        const idxA = this.getOrAllocVar(varA);
        const idxB = this.getOrAllocVar(varB);
        this.dbm.assumeDiff(idxA, idxB, 0);
        this.dbm.assumeDiff(idxB, idxA, 0);
        break;
      }
    }
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.assertedLiterals.set(lit.id, lit);
    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1]!.assertedLitIds.push(lit.id);
    }
    this.applyLiteralToDbm(lit);
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
    if (this.dbm.hasNegativeCycle()) {
      return {
        isSat: false,
        conflict: {
          literals: Array.from(this.assertedLiterals.values()),
          explanation:
            "Difference Bound / Temporal Succession Conflict: Negative cycle detected in Octagon DBM. A temporal ordering or difference constraint loop is impossible.",
          culpritEntities: [...this.idxToVar],
          theoryName: this.name,
        },
      };
    }
    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    const equalities: SharedEquality[] = [];
    const n = this.idxToVar.length;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // If x_i - x_j <= 0 and x_j - x_i <= 0, then x_i == x_j
        if (this.dbm.checkDiff(i, j, 0) && this.dbm.checkDiff(j, i, 0)) {
          const varA = this.idxToVar[i]!;
          const varB = this.idxToVar[j]!;
          const key = varA < varB ? `${varA}==${varB}` : `${varB}==${varA}`;

          if (!this.propagatedEqualities.has(key)) {
            this.propagatedEqualities.add(key);
            equalities.push({
              varA,
              varB,
              domain: "interval",
              explanation: `Deduced from difference bounds: (${varA} - ${varB} <= 0) and (${varB} - ${varA} <= 0)`,
              sourceOracle: this.name,
            });
          }
        }
      }
    }

    return equalities;
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.sharedEqualities.push(eq);
    if (eq.domain === "interval" || eq.domain === "real" || eq.domain === "discrete") {
      const idxA = this.getOrAllocVar(eq.varA);
      const idxB = this.getOrAllocVar(eq.varB);
      this.dbm.assumeDiff(idxA, idxB, 0);
      this.dbm.assumeDiff(idxB, idxA, 0);
      if (eq.bounds) {
        this.dbm.assumeInterval(idxA, eq.bounds[0], eq.bounds[1]);
        this.dbm.assumeInterval(idxB, eq.bounds[0], eq.bounds[1]);
      }
    }
  }

  public getModel(): Record<string, [number, number]> {
    const model: Record<string, [number, number]> = {};
    for (let i = 0; i < this.idxToVar.length; i++) {
      const name = this.idxToVar[i]!;
      const lo = this.dbm.getLowerBound(i);
      const hi = this.dbm.getUpperBound(i);
      model[name] = [lo, hi];
    }
    return model;
  }
}
