// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Probabilistic Model Checking (PMC) & Fault Tree Safety Oracle.
 *
 * Discharges quantitative reliability & safety requirements (e.g., IEC 61508 SIL / ISO 26262 ASIL)
 * inside SemanticTheoryCoordinator using exact ROBDD Fault Trees and CTMC Uniformization.
 */

import { BddFaultTreeEngine, type FaultTreeNode } from "../reliability/bdd_fault_tree.js";
import { checkCtmcBoundedReachability, type CtmcModel } from "../reliability/ctmc_pmc.js";
import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";
import { hasSharedEqualityWithLiteral, retainSharedEqualitiesWithoutLiteral } from "./retraction_utils.js";
import { UndoTrail } from "./undo_trail.js";

export type QuantitativeSafetyCheck =
  | { readonly kind: "fault-tree"; readonly id: string; readonly tree: FaultTreeNode; readonly maxFailureProb: number }
  | {
      readonly kind: "ctmc";
      readonly id: string;
      readonly model: CtmcModel;
      readonly horizon: number;
      readonly maxFailureProb: number;
    };

export class ProbabilisticModelCheckingOracle implements TheoryOracle {
  public readonly name = "ProbabilisticModelCheckingOracle";
  public readonly domain = "dynamic_simulation" as const;

  private checks = new Map<string, QuantitativeSafetyCheck>();
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private sharedEqualities: SharedEquality[] = [];
  private trail = new UndoTrail();

  public reset(): void {
    this.checks.clear();
    this.assertedLiterals.clear();
    this.sharedEqualities = [];
    this.trail.reset();
  }

  public pushLevel(): void {
    this.trail.pushLevel();
  }

  public popLevel(): void {
    this.trail.popLevel();
  }

  public registerCheck(check: QuantitativeSafetyCheck): void {
    this.trail.mapSet(this.checks, check.id, check);
  }

  public assertLiteral(literal: TheoryLiteral): boolean {
    this.trail.mapSet(this.assertedLiterals, literal.id, literal);
    return true;
  }

  public retractLiteral(literalId: number): void {
    this.assertedLiterals.delete(literalId);
    if (hasSharedEqualityWithLiteral(this.sharedEqualities, literalId)) {
      this.sharedEqualities = retainSharedEqualitiesWithoutLiteral(this.sharedEqualities, literalId);
    }
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.sharedEqualities.push(eq);
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    const literals = Array.from(this.assertedLiterals.values());
    for (const chk of this.checks.values()) {
      if (chk.kind === "fault-tree") {
        const res = new BddFaultTreeEngine().analyze(chk.tree);
        if (res.topEventProbability > chk.maxFailureProb) {
          return {
            isSat: false,
            conflict: {
              literals,
              explanation: `Fault tree '${chk.id}' top-event probability ${res.topEventProbability.toExponential(4)} exceeds budget ${chk.maxFailureProb.toExponential(4)} (${res.minimalCutSets.length} minimal cut sets).`,
              culpritEntities: [chk.id],
              theoryName: this.name,
            },
          };
        }
      } else {
        const res = checkCtmcBoundedReachability(chk.model, chk.horizon);
        if (res.reachProbability + res.truncationError > chk.maxFailureProb) {
          return {
            isSat: false,
            conflict: {
              literals,
              explanation: `CTMC '${chk.id}' bounded failure probability ${(res.reachProbability + res.truncationError).toExponential(4)} at T=${chk.horizon} exceeds budget ${chk.maxFailureProb.toExponential(4)}.`,
              culpritEntities: [chk.id],
              theoryName: this.name,
            },
          };
        }
      }
    }
    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    return [];
  }
}
