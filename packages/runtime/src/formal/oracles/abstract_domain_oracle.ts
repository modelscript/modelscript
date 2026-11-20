// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Abstract Domain Theory Oracle (Octagon DBM & 4D Spatiotemporal Bounds).
 *
 * Tracks difference bounds (±x_i ± x_j ≤ c) and 4D time intervals using Difference Bound Matrices.
 * Detects negative cycles (temporal ordering contradictions) and propagates relational equalities.
 */

import { OctagonDBM } from "../../analysis/octagon_dbm.js";
import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";
import { hasSharedEqualityWithLiteral, retainSharedEqualitiesWithoutLiteral } from "./retraction_utils.js";
import { UndoTrail } from "./undo_trail.js";

export class AbstractDomainOracle implements TheoryOracle {
  public readonly name = "AbstractDomainOracle";
  public readonly domain = "abstract_domain" as const;

  private varToIdx = new Map<string, number>();
  private idxToVar: string[] = [];
  private dbm: OctagonDBM;
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private propagatedEqualities = new Set<string>();
  private sharedEqualities: SharedEquality[] = [];
  private trail = new UndoTrail();
  private dbmSavedDepth = 0;

  private dirtyIndices = new Set<number>();

  constructor(maxVars = 64) {
    this.dbm = new OctagonDBM(maxVars);
    this.reset();
  }

  public reset(): void {
    this.varToIdx.clear();
    this.idxToVar = [];
    this.dirtyIndices.clear();
    this.assertedLiterals.clear();
    this.propagatedEqualities.clear();
    this.sharedEqualities = [];
    this.trail.reset();
    this.dbmSavedDepth = 0;
    this.dbm.reset();
  }

  public pushLevel(): void {
    this.trail.pushLevel();
  }

  public popLevel(): void {
    this.trail.popLevel();
  }

  private saveDbmForTrail(): void {
    const d = this.trail.depth;
    if (d > 0 && this.dbmSavedDepth < d) {
      const prevDbm = this.dbm.clone();
      const prevSavedDepth = this.dbmSavedDepth;
      this.dbmSavedDepth = d;
      this.trail.record(() => {
        this.dbm = prevDbm;
        this.dbmSavedDepth = prevSavedDepth;
      });
    }
  }

  private getOrAllocVar(name: string): number {
    let idx = this.varToIdx.get(name);
    if (idx !== undefined) return idx;

    idx = this.idxToVar.length;
    this.trail.arrayPush(this.idxToVar, name);
    this.trail.mapSet(this.varToIdx, name, idx);

    if (idx >= this.dbm.numVars) {
      // Re-allocate larger DBM and copy
      this.saveDbmForTrail();
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
        this.saveDbmForTrail();
        this.dbm.assumeDiff(idxA, idxB, maxDiff);
        this.trail.setAdd(this.dirtyIndices, idxA);
        this.trail.setAdd(this.dirtyIndices, idxB);
        break;
      }
      case "time_succession": {
        // Event B succeeds Event A: t_B - t_A in [minDelay, maxDelay]
        const [eventA, eventB, minDelay, maxDelay] = args as [string, string, number, number];
        const idxA = this.getOrAllocVar(eventA);
        const idxB = this.getOrAllocVar(eventB);
        this.saveDbmForTrail();
        // t_B - t_A <= maxDelay
        this.dbm.assumeDiff(idxB, idxA, maxDelay);
        // t_A - t_B <= -minDelay (equivalent to t_B - t_A >= minDelay)
        this.dbm.assumeDiff(idxA, idxB, -minDelay);
        this.trail.setAdd(this.dirtyIndices, idxA);
        this.trail.setAdd(this.dirtyIndices, idxB);
        break;
      }
      case "interval": {
        const [varName, lo, hi] = args as [string, number, number];
        const idx = this.getOrAllocVar(varName);
        this.saveDbmForTrail();
        this.dbm.assumeInterval(idx, lo, hi);
        this.trail.setAdd(this.dirtyIndices, idx);
        break;
      }
      case "equal": {
        const [varA, varB] = args as [string, string];
        const idxA = this.getOrAllocVar(varA);
        const idxB = this.getOrAllocVar(varB);
        this.saveDbmForTrail();
        this.dbm.assumeDiff(idxA, idxB, 0);
        this.dbm.assumeDiff(idxB, idxA, 0);
        this.trail.setAdd(this.dirtyIndices, idxA);
        this.trail.setAdd(this.dirtyIndices, idxB);
        break;
      }
    }
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.trail.mapSet(this.assertedLiterals, lit.id, lit);
    this.applyLiteralToDbm(lit);
    return true;
  }

  public retractLiteral(litId: number): void {
    const hasShared = hasSharedEqualityWithLiteral(this.sharedEqualities, litId);
    if (!this.assertedLiterals.has(litId) && !hasShared) return;
    this.assertedLiterals.delete(litId);
    const savedDepth = this.trail.depth;
    // Replay remaining asserted literals and re-apply non-retracted shared equalities
    const remaining = Array.from(this.assertedLiterals.values());
    const savedShared = retainSharedEqualitiesWithoutLiteral(this.sharedEqualities, litId);
    this.reset();
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
    for (const eq of savedShared) {
      this.onSharedEquality(eq);
    }
    for (let i = 0; i < savedDepth; i++) {
      this.trail.pushLevel();
    }
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
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
    if (this.dirtyIndices.size === 0) return [];

    const equalities: SharedEquality[] = [];
    const n = this.idxToVar.length;

    for (const i of this.dirtyIndices) {
      if (i >= n) continue;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const low = Math.min(i, j);
        const high = Math.max(i, j);
        // If x_low - x_high <= 0 and x_high - x_low <= 0, then x_low == x_high
        if (this.dbm.checkDiff(low, high, 0) && this.dbm.checkDiff(high, low, 0)) {
          const varA = this.idxToVar[low]!;
          const varB = this.idxToVar[high]!;
          const key = varA < varB ? `${varA}==${varB}` : `${varB}==${varA}`;

          if (!this.propagatedEqualities.has(key)) {
            this.trail.setAdd(this.propagatedEqualities, key);
            const justs: number[] = [];
            for (const lit of this.assertedLiterals.values()) {
              if (lit.args.includes(varA) || lit.args.includes(varB)) {
                justs.push(lit.id);
              }
            }
            equalities.push({
              varA,
              varB,
              domain: "interval",
              explanation: `Deduced from difference bounds: (${varA} - ${varB} <= 0) and (${varB} - ${varA} <= 0)`,
              sourceOracle: this.name,
              justifications: justs,
              justification: justs,
            });
          }
        }
      }
    }

    if (this.trail.depth > 0) {
      const savedDirty = Array.from(this.dirtyIndices);
      this.trail.record(() => {
        for (const idx of savedDirty) this.dirtyIndices.add(idx);
      });
    }
    this.dirtyIndices.clear();
    return equalities;
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.trail.arrayPush(this.sharedEqualities, eq);
    if (eq.domain === "interval" || eq.domain === "real" || eq.domain === "discrete") {
      const idxA = this.getOrAllocVar(eq.varA);
      const idxB = this.getOrAllocVar(eq.varB);
      this.saveDbmForTrail();
      this.dbm.assumeDiff(idxA, idxB, 0);
      this.dbm.assumeDiff(idxB, idxA, 0);
      this.trail.setAdd(this.dirtyIndices, idxA);
      this.trail.setAdd(this.dirtyIndices, idxB);
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
