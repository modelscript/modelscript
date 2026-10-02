// SPDX-License-Identifier: AGPL-3.0-or-later

import { CFGEdge, CFGInstruction, GenericCFG } from "./cfg.js";
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

export type EdgeTransferFunction = (edge: CFGEdge, outState: ReducedProductState) => ReducedProductState;

/**
 * Static Analysis Fixpoint Solver with Widening.
 *
 * Computes least fixpoints over Control Flow Graphs (CFG) using chaotic iteration
 * and delayed threshold widening over reduced product abstract domains.
 *
 * Academic Citations:
 *   - Cousot, P., & Cousot, R. (1977). "Abstract interpretation: a unified lattice model
 *     for static analysis of programs by construction or approximation of fixpoints."
 *     In Proceedings of the 4th ACM SIGACT-SIGPLAN Symposium on Principles of Programming
 *     Languages (POPL '77), pp. 238–252. DOI: 10.1145/512950.512973.
 *   - Bourdoncle, F. (1993). "Efficient chaotic iteration strategies with widening."
 *     In Formal Methods in Programming and Their Applications, LNCS 735, pp. 128–141.
 *     Springer. DOI: 10.1007/3-540-57316-X_23.
 *
 * ModelScript Architectural Rationale:
 *   Modelica algorithms and procedural functions contain loops and branches that can trigger
 *   critical runtime errors (division by zero, array out-of-bounds, math domain violations).
 *   FixpointSolver performs whole-function static verification across CFG basic blocks,
 *   propagating relational abstract states to mathematical convergence. Widening with jump
 *   thresholds guarantees termination in polynomial iterations while preserving precision.
 *
 * Modifications:
 *   - Uses Reverse Post-Order (RPO) block scheduling to minimize iteration counts.
 *   - Detects natural loop headers via dominator tree analysis, applying widening strictly at loop cuts.
 *   - Operates on a `ReducedProductDomain` coupling interval and relational polyhedral domains.
 *   - Emits structured Run-Time Error (RTE) verdicts for IDE and LSP diagnostic feeds.
 */
export class FixpointSolver {
  private domain = new ReducedProductDomain();

  constructor(
    private cfg: GenericCFG,
    private transferFn: InstructionTransferFunction,
    private thresholds: number[] = [-1, 0, 1, 10, 100, 1000],
    private maxWideningSteps: number = 20,
    private edgeTransferFn?: EdgeTransferFunction,
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
          let pOut = outStates.get(pId);
          if (pOut && !this.domain.isBottom(pOut)) {
            if (this.edgeTransferFn) {
              const edge = this.cfg.getEdge(pId, bId);
              if (edge) {
                pOut = this.edgeTransferFn(edge, pOut);
              }
            }
            if (!this.domain.isBottom(pOut)) {
              joinedPreds = this.domain.join(joinedPreds, pOut);
            }
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

    // 2. Narrowing Phase (Bounded meet iterations after widening post-fixpoint)
    for (let narrowStep = 0; narrowStep < 2; narrowStep++) {
      for (const bId of rpo) {
        if (bId === this.cfg.entryBlockId) continue;
        const block = this.cfg.getBlock(bId);
        if (!block) continue;

        let joinedPreds = this.domain.bottom();
        for (const pId of block.predecessors) {
          let pOut = outStates.get(pId);
          if (pOut && !this.domain.isBottom(pOut)) {
            if (this.edgeTransferFn) {
              const edge = this.cfg.getEdge(pId, bId);
              if (edge) {
                pOut = this.edgeTransferFn(edge, pOut);
              }
            }
            if (!this.domain.isBottom(pOut)) {
              joinedPreds = this.domain.join(joinedPreds, pOut);
            }
          }
        }

        if (!this.domain.isBottom(joinedPreds)) {
          const currentIn = inStates.get(bId)!;
          const narrowedIn = this.domain.meet(currentIn, joinedPreds);
          inStates.set(bId, narrowedIn);

          let currentOut = narrowedIn.clone();
          if (!this.domain.isBottom(narrowedIn)) {
            for (const inst of block.instructions) {
              currentOut = this.transferFn(inst, currentOut, () => {});
              if (this.domain.isBottom(currentOut)) break;
            }
          }
          outStates.set(bId, currentOut);
        }
      }
    }

    // 3. Final Verification Pass: collect definitive RTE checks on stabilized invariants
    checks.length = 0;
    for (const bId of rpo) {
      const block = this.cfg.getBlock(bId);
      if (!block) continue;
      const inState = inStates.get(bId)!;
      if (!this.domain.isBottom(inState)) {
        let curr = inState.clone();
        for (const inst of block.instructions) {
          curr = this.transferFn(inst, curr, checkCollector);
          if (this.domain.isBottom(curr)) break;
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
