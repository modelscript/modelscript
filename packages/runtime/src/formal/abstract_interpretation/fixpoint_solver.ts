// SPDX-License-Identifier: AGPL-3.0-or-later

import { CFGInstruction, GenericCFG } from "./cfg.js";
import { ReducedProductDomain, ReducedProductState } from "./reduced_product.js";

export type RTEVerdict = "proven_safe" | "definite_bug" | "potential_bug" | "dead_code";

export interface RTECheckResult {
  instId: number;
  category: "division_by_zero" | "array_out_of_bounds" | "math_domain" | "uninitialized_read" | "loop_termination";
  verdict: RTEVerdict;
  description: string;
  astNodeId?: number;
  startByte?: number;
  endByte?: number;
  witnessValues?: Record<string, string>;
}

export interface VerificationSummary {
  provenSafeCount: number;
  definiteBugCount: number;
  potentialBugCount: number;
  deadCodeBlockCount: number;
  checks: RTECheckResult[];
  blockEntryStates: Map<number, ReducedProductState>;
  blockExitStates: Map<number, ReducedProductState>;
}

export type InstructionTransferFunction = (
  inst: CFGInstruction,
  inState: ReducedProductState,
  collector: (check: RTECheckResult) => void,
) => ReducedProductState;

export class FixpointSolver {
  private domain = new ReducedProductDomain();

  constructor(
    private cfg: GenericCFG,
    private transferFn: InstructionTransferFunction,
    private thresholds: number[] = [-1, 0, 1, 10, 100, 1000],
    private maxWideningSteps: number = 20,
  ) {}

  solve(initialState?: ReducedProductState): VerificationSummary {
    const rpo = this.cfg.computeRPO();
    const loops = this.cfg.detectNaturalLoops();
    const loopHeaders = new Set<number>(loops.map((l) => l.headerBlockId));

    const inStates = new Map<number, ReducedProductState>();
    const outStates = new Map<number, ReducedProductState>();
    const blockVisitCounts = new Map<number, number>();
    const checks: RTECheckResult[] = [];

    const startState = initialState ?? this.domain.top();

    for (const bId of this.cfg.blocks.keys()) {
      inStates.set(bId, bId === this.cfg.entryBlockId ? startState : this.domain.bottom());
      outStates.set(bId, this.domain.bottom());
      blockVisitCounts.set(bId, 0);
    }

    // Worklist prioritized by RPO index
    const rpoOrder = new Map<number, number>();
    rpo.forEach((id, idx) => rpoOrder.set(id, idx));

    const worklist: number[] = [...rpo];
    const inWorklist = new Set<number>(rpo);

    const checkCollector = (c: RTECheckResult) => {
      checks.push(c);
    };

    while (worklist.length > 0) {
      // Pick smallest RPO index
      worklist.sort((a, b) => (rpoOrder.get(a) ?? 0) - (rpoOrder.get(b) ?? 0));
      const bId = worklist.shift()!;
      inWorklist.delete(bId);

      const block = this.cfg.getBlock(bId);
      if (!block) continue;

      const visits = (blockVisitCounts.get(bId) ?? 0) + 1;
      blockVisitCounts.set(bId, visits);

      // 1. Compute in-state from predecessors
      let currentIn = inStates.get(bId)!;
      if (bId !== this.cfg.entryBlockId) {
        let joinedPreds = this.domain.bottom();
        for (const pId of block.predecessors) {
          const pOut = outStates.get(pId);
          if (pOut && !this.domain.isBottom(pOut)) {
            joinedPreds = this.domain.join(joinedPreds, pOut);
          }
        }

        if (loopHeaders.has(bId) && visits > 2) {
          // Accelerate fixpoint via widening with thresholds
          currentIn = this.domain.widen(currentIn, joinedPreds, this.thresholds);
        } else {
          currentIn = joinedPreds;
        }
        inStates.set(bId, currentIn);
      }

      // If block entry is unreachable (⊥), output is ⊥
      let currentOut = currentIn.clone();
      if (!this.domain.isBottom(currentIn)) {
        for (const inst of block.instructions) {
          currentOut = this.transferFn(inst, currentOut, checkCollector);
          if (this.domain.isBottom(currentOut)) break;
        }
      }

      // Check if out-state changed
      const prevOut = outStates.get(bId)!;
      if (!this.domain.equals(prevOut, currentOut)) {
        outStates.set(bId, currentOut);
        for (const sId of block.successors) {
          if (!inWorklist.has(sId)) {
            worklist.push(sId);
            inWorklist.add(sId);
          }
        }
      }
    }

    // Tally verification metrics
    let provenSafe = 0;
    let definiteBug = 0;
    let potentialBug = 0;
    let deadCode = 0;

    for (const [bId, inState] of inStates) {
      if (this.domain.isBottom(inState)) {
        deadCode++;
      }
    }

    for (const c of checks) {
      if (c.verdict === "proven_safe") provenSafe++;
      else if (c.verdict === "definite_bug") definiteBug++;
      else if (c.verdict === "potential_bug") potentialBug++;
      else if (c.verdict === "dead_code") deadCode++;
    }

    return {
      provenSafeCount: provenSafe,
      definiteBugCount: definiteBug,
      potentialBugCount: potentialBug,
      deadCodeBlockCount: deadCode,
      checks,
      blockEntryStates: inStates,
      blockExitStates: outStates,
    };
  }
}
