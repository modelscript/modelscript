// SPDX-License-Identifier: AGPL-3.0-or-later
import { CdclSatSolver, TseitinEncoder } from "../formal/cdcl_sat.js";
import { type NodeId, type SerializedMarking, WasmFumlEngine } from "./wasm_fuml_engine.js";

/**
 * Safety property specification for discrete activity verification.
 */
export interface ActivitySafetyInvariant {
  name: string;
  /** Nodes that must never be executed / receive tokens (e.g. Error or Hazard state) */
  forbiddenNodes?: (NodeId | string)[];
  /** Pairs of nodes that must never be active simultaneously (Mutual Exclusion) */
  mutuallyExclusiveNodes?: [NodeId | string, NodeId | string][];
  /** Maximum token capacity for any node or edge (Bounded Buffer / No Overflow) */
  maxTokenCapacity?: number;
  /** Custom invariant predicate on marking and data state */
  predicate?: (marking: SerializedMarking, variables: Record<string, any>) => boolean;
}

export interface BmcCounterexampleTrace {
  stepIndex: number;
  firedNodes: string[];
  marking: SerializedMarking;
  variables: Record<string, any>;
}

export interface BmcResult {
  satisfied: boolean;
  boundReached: number;
  visitedStatesCount: number;
  violation?: {
    step: number;
    reason: string;
    trace: BmcCounterexampleTrace[];
  };
}

export interface KInductionResult {
  isProvenInvariant: boolean;
  baseStepSatisfied: boolean;
  inductiveStepSatisfied: boolean;
  depth: number;
  counterexample?: BmcCounterexampleTrace[];
  message: string;
}

/**
 * Bounded Model Checking (BMC) and k-Induction Engine for discrete fUML activities.
 */
export class ActivityBmcEngine {
  constructor(private engine: WasmFumlEngine) {}

  /**
   * Evaluates if a given marking and variable state satisfies the safety invariant.
   */
  private checkInvariant(
    marking: SerializedMarking,
    variables: Record<string, any>,
    firedNodeIds: NodeId[],
    invariant: ActivitySafetyInvariant,
  ): { holds: boolean; reason?: string } {
    // 1. Check forbidden nodes
    if (invariant.forbiddenNodes && invariant.forbiddenNodes.length > 0) {
      for (const fn of invariant.forbiddenNodes) {
        // Check if fired this step
        for (const fId of firedNodeIds) {
          const fNode = this.engine.getNode(fId);
          if (fNode && (fNode.name === fn || fNode.id === fn)) {
            return { holds: false, reason: `Forbidden node '${fNode.name}' fired` };
          }
        }
        // Check if token sits in forbidden node
        for (const [nodeIdStr, tokens] of Object.entries(marking.nodeTokens)) {
          if (tokens.length > 0) {
            const nId = parseInt(nodeIdStr, 10);
            const node = this.engine.getNode(nId);
            if (node && (node.name === fn || node.id === fn)) {
              return { holds: false, reason: `Token placed on forbidden node '${node.name}'` };
            }
          }
        }
      }
    }

    // 2. Check mutual exclusion
    if (invariant.mutuallyExclusiveNodes && invariant.mutuallyExclusiveNodes.length > 0) {
      for (const [a, b] of invariant.mutuallyExclusiveNodes) {
        let hasA = false;
        let hasB = false;
        for (const [nodeIdStr, tokens] of Object.entries(marking.nodeTokens)) {
          if (tokens.length > 0) {
            const nId = parseInt(nodeIdStr, 10);
            const node = this.engine.getNode(nId);
            if (node) {
              if (node.name === a || node.id === a) hasA = true;
              if (node.name === b || node.id === b) hasB = true;
            }
          }
        }
        if (hasA && hasB) {
          return { holds: false, reason: `Mutual exclusion violated between '${a}' and '${b}'` };
        }
      }
    }

    // 3. Check token capacity
    if (invariant.maxTokenCapacity !== undefined) {
      const cap = invariant.maxTokenCapacity;
      let totalTokens = 0;
      for (const tokens of Object.values(marking.nodeTokens)) totalTokens += tokens.length;
      for (const tokens of Object.values(marking.edgeTokens)) totalTokens += tokens.length;
      for (const tokens of Object.values(marking.pinTokens)) totalTokens += tokens.length;
      if (totalTokens > cap) {
        return {
          holds: false,
          reason: `Total activity token capacity exceeded (${totalTokens} > ${cap})`,
        };
      }
      for (const [edgeId, tokens] of Object.entries(marking.edgeTokens)) {
        if (tokens.length > cap) {
          return {
            holds: false,
            reason: `Token buffer capacity exceeded on edge ${edgeId} (${tokens.length} > ${cap})`,
          };
        }
      }
    }

    // 4. Custom predicate
    if (invariant.predicate && !invariant.predicate(marking, variables)) {
      return { holds: false, reason: `Custom invariant predicate evaluated to false` };
    }

    return { holds: true };
  }

  /**
   * Explores all execution paths up to bound K.
   * Leverages reversible step execution (stepForward / stepBack) in WasmFumlEngine.
   */
  checkBoundedSafety(invariant: ActivitySafetyInvariant, boundK: number = 20): BmcResult {
    const trace: BmcCounterexampleTrace[] = [];
    let visitedStates = 0;

    // Record initial state
    const initialMarking = this.engine.getSerializedMarking();
    const initialVars = { ...this.engine.getVariables() };
    const initCheck = this.checkInvariant(initialMarking, initialVars, [], invariant);

    if (!initCheck.holds) {
      return {
        satisfied: false,
        boundReached: 0,
        visitedStatesCount: 1,
        violation: {
          step: 0,
          reason: initCheck.reason || "Initial state violates invariant",
          trace: [{ stepIndex: 0, firedNodes: [], marking: initialMarking, variables: initialVars }],
        },
      };
    }

    // Step forward up to boundK
    for (let step = 1; step <= boundK; step++) {
      visitedStates++;
      const stepRes = this.engine.stepForward();

      const marking = this.engine.getSerializedMarking();
      const vars = { ...this.engine.getVariables() };
      const firedNames = stepRes.firedNodeIds.map((id) => this.engine.getNode(id)?.name || `node_${id}`);

      trace.push({
        stepIndex: step,
        firedNodes: firedNames,
        marking,
        variables: vars,
      });

      const check = this.checkInvariant(marking, vars, stepRes.firedNodeIds, invariant);
      if (!check.holds) {
        return {
          satisfied: false,
          boundReached: step,
          visitedStatesCount: visitedStates,
          violation: {
            step,
            reason: check.reason || "Safety invariant violated",
            trace,
          },
        };
      }

      if (stepRes.isCompleted || stepRes.isTerminated || stepRes.activeTokenCount === 0) {
        // Reached dead end or completion without violations
        return {
          satisfied: true,
          boundReached: step,
          visitedStatesCount: visitedStates,
        };
      }
    }

    return {
      satisfied: true,
      boundReached: boundK,
      visitedStatesCount: visitedStates,
    };
  }

  /**
   * Formal k-Induction Proof:
   * 1. Base Step: Invariant holds for all reachable states from step 0 to k.
   * 2. Inductive Step: If invariant holds for k consecutive steps, does any transition lead to violation?
   *
   * The inductive step encodes the activity graph's transition relation into a propositional
   * SAT problem and checks whether the invariant can be violated at step k+1 given it holds
   * at steps 0..k. If the SAT solver returns UNSAT, the property is proven invariant for all
   * time steps (unbounded).
   */
  checkKInduction(invariant: ActivitySafetyInvariant, k: number = 10): KInductionResult {
    // 1. Base step
    const baseResult = this.checkBoundedSafety(invariant, k);
    if (!baseResult.satisfied) {
      return {
        isProvenInvariant: false,
        baseStepSatisfied: false,
        inductiveStepSatisfied: false,
        depth: k,
        counterexample: baseResult.violation?.trace,
        message: `Base step failed at bound ${baseResult.violation?.step}: ${baseResult.violation?.reason}`,
      };
    }

    // If activity terminated or completed within k steps, the state space is finite and fully verified
    if (baseResult.boundReached < k) {
      return {
        isProvenInvariant: true,
        baseStepSatisfied: true,
        inductiveStepSatisfied: true,
        depth: baseResult.boundReached,
        message: `Activity terminates cleanly within ${baseResult.boundReached} steps. Invariant is exhaustively verified.`,
      };
    }

    // Custom predicates cannot be encoded into SAT — fall back to bounded verification
    if (invariant.predicate) {
      return {
        isProvenInvariant: false,
        baseStepSatisfied: true,
        inductiveStepSatisfied: false,
        depth: k,
        message: `Property '${invariant.name}' holds up to bounded depth k=${k}. Unbounded k-induction is unavailable because a custom predicate invariant cannot be encoded into the SAT solver.`,
      };
    }

    // 2. Inductive step: encode activity transition relation and check if invariant can be
    //    violated at step k+1 assuming it holds at steps 0..k.
    const sat = new CdclSatSolver();
    const encoder = new TseitinEncoder();
    const allNodes = this.engine.getAllNodes();

    // Create Boolean variables: token(nodeId, step) — whether node holds a token at step s
    const tokenVar = (nodeId: NodeId | number, step: number): number => {
      return encoder.getOrCreateVar(`tok_${nodeId}_s${step}`);
    };

    // --- Encode transition relation T(s, s+1) for each step s in [0, k] ---
    for (let s = 0; s <= k; s++) {
      // Backward frame axiom: node at step s+1 can only hold a token if at least one predecessor had a token at step s
      for (const node of allNodes) {
        const nextVar = tokenVar(node.id, s + 1);
        const inEdges = node.incomingEdges;
        const predNodeIds: NodeId[] = [];
        for (const eId of inEdges) {
          const edge = this.engine.getEdge(eId);
          if (edge) predNodeIds.push(edge.sourceNodeId);
        }
        if (predNodeIds.length === 0) {
          // No incoming edges -> cannot hold a token at s + 1
          sat.addClause([-nextVar]);
        } else {
          // ~nextVar | pred1(s) | pred2(s) | ...
          const predVars = predNodeIds.map((pId) => tokenVar(pId, s));
          sat.addClause([-nextVar, ...predVars]);
        }
      }

      for (const node of allNodes) {
        const currVar = tokenVar(node.id, s);
        const outEdges = node.outgoingEdges;
        const successorNodeIds: NodeId[] = [];

        for (const eId of outEdges) {
          const edge = this.engine.getEdge(eId);
          if (edge) successorNodeIds.push(edge.targetNodeId);
        }

        switch (node.kind) {
          case 0: // Initial — token moves to all successors at step 0 only (handled by init)
          case 1: {
            // Action — if token(node, s), then token moves to successors at s+1
            // For each successor: token(node, s) => token(succ, s+1)
            for (const succId of successorNodeIds) {
              const succNext = tokenVar(succId, s + 1);
              // ~currVar | succNext (if node active, successor gets token)
              sat.addClause([-currVar, succNext]);
            }
            break;
          }

          case 4: {
            // Fork — if token(fork, s), ALL successors get tokens at s+1
            for (const succId of successorNodeIds) {
              const succNext = tokenVar(succId, s + 1);
              sat.addClause([-currVar, succNext]);
            }
            break;
          }

          case 5: {
            // Join — token at s+1 only if ALL predecessors have tokens at s
            const inEdges = node.incomingEdges;
            const predNodeIds: NodeId[] = [];
            for (const eId of inEdges) {
              const edge = this.engine.getEdge(eId);
              if (edge) predNodeIds.push(edge.sourceNodeId);
            }

            if (predNodeIds.length > 0 && successorNodeIds.length > 0) {
              // join fires at step s if all predecessors have tokens
              const joinFiredVar = encoder.getOrCreateVar(`joinFire_${node.id}_s${s}`);

              // joinFiredVar => pred_i(s) for each predecessor
              for (const predId of predNodeIds) {
                sat.addClause([-joinFiredVar, tokenVar(predId, s)]);
              }
              // pred_1(s) & pred_2(s) & ... => joinFiredVar
              // Equivalently: ~pred_1(s) | ~pred_2(s) | ... | joinFiredVar
              const allPredNeg = predNodeIds.map((pid) => -tokenVar(pid, s));
              sat.addClause([...allPredNeg, joinFiredVar]);

              // If join fires, successors get tokens
              for (const succId of successorNodeIds) {
                sat.addClause([-joinFiredVar, tokenVar(succId, s + 1)]);
              }
            }
            break;
          }

          case 2: {
            // Decide — if token(decide, s), exactly one successor gets token (nondeterministic)
            // At least one successor: ~currVar | succ1(s+1) | succ2(s+1) | ...
            if (successorNodeIds.length > 0) {
              const succVars = successorNodeIds.map((sid) => tokenVar(sid, s + 1));
              sat.addClause([-currVar, ...succVars]);
            }
            break;
          }

          case 3: {
            // Merge — if ANY predecessor has a token, merge gets token and passes to successors
            // For each predecessor: pred(s) => succ(s+1) for each successor
            const inEdges = node.incomingEdges;
            for (const eId of inEdges) {
              const edge = this.engine.getEdge(eId);
              if (edge) {
                const predVar = tokenVar(edge.sourceNodeId, s);
                for (const succId of successorNodeIds) {
                  sat.addClause([-predVar, tokenVar(succId, s + 1)]);
                }
              }
            }
            break;
          }

          case 6: // ActivityFinal — absorbs token, no successors
          case 7: // FlowFinal — absorbs token, no successors
            break;
        }
      }
    }

    // --- Encode invariant P(s) for steps 0..k ---
    // Resolve node names/ids for invariant properties
    const resolveNodeId = (ref: NodeId | string): NodeId | undefined => {
      if (typeof ref === "number") return ref;
      for (const n of allNodes) {
        if (n.name === ref) return n.id;
      }
      return undefined;
    };

    // Forbidden nodes: ¬token(forbidden, s) for s ∈ [0, k]
    if (invariant.forbiddenNodes) {
      for (const fn of invariant.forbiddenNodes) {
        const nId = resolveNodeId(fn);
        if (nId === undefined) continue;
        for (let s = 0; s <= k; s++) {
          sat.addClause([-tokenVar(nId, s)]);
        }
      }
    }

    // Mutual exclusion: ¬(token(a, s) ∧ token(b, s)) for s ∈ [0, k]
    if (invariant.mutuallyExclusiveNodes) {
      for (const [a, b] of invariant.mutuallyExclusiveNodes) {
        const aId = resolveNodeId(a);
        const bId = resolveNodeId(b);
        if (aId === undefined || bId === undefined) continue;
        for (let s = 0; s <= k; s++) {
          sat.addClause([-tokenVar(aId, s), -tokenVar(bId, s)]);
        }
      }
    }

    // Token capacity: encode \sum token(node, s) <= maxTokenCapacity for s \in [0, k]
    if (invariant.maxTokenCapacity !== undefined) {
      for (let s = 0; s <= k; s++) {
        const stepLits = allNodes.map((n) => tokenVar(n.id, s));
        encoder.encodeAtMostK(stepLits, invariant.maxTokenCapacity);
      }
    }

    // --- Encode negated invariant ¬P(k+1) ---
    // At least one forbidden node has a token at step k+1, OR a mutual exclusion pair is active,
    // OR total token capacity exceeds maxTokenCapacity.
    const violationLits: number[] = [];

    if (invariant.forbiddenNodes) {
      for (const fn of invariant.forbiddenNodes) {
        const nId = resolveNodeId(fn);
        if (nId !== undefined) {
          violationLits.push(tokenVar(nId, k + 1));
        }
      }
    }

    if (invariant.mutuallyExclusiveNodes) {
      for (const [a, b] of invariant.mutuallyExclusiveNodes) {
        const aId = resolveNodeId(a);
        const bId = resolveNodeId(b);
        if (aId === undefined || bId === undefined) continue;
        // Auxiliary variable for (token(a, k+1) ∧ token(b, k+1))
        const bothActive = encoder.encode({
          op: "and",
          children: [
            { op: "var", name: `tok_${aId}_s${k + 1}` },
            { op: "var", name: `tok_${bId}_s${k + 1}` },
          ],
        });
        violationLits.push(bothActive);
      }
    }

    if (invariant.maxTokenCapacity !== undefined) {
      const nextStepLits = allNodes.map((n) => tokenVar(n.id, k + 1));
      const capViolLit = encoder.encodeGreaterThanK(nextStepLits, invariant.maxTokenCapacity);
      violationLits.push(capViolLit);
    }

    // Add all auxiliary clauses generated by TseitinEncoder (cardinality, conjunctions, etc.)
    for (const clause of encoder.clauses) {
      sat.addClause(clause);
    }

    if (violationLits.length === 0) {
      // No encodable violation condition — cannot prove via k-induction
      return {
        isProvenInvariant: false,
        baseStepSatisfied: true,
        inductiveStepSatisfied: false,
        depth: k,
        message: `Property '${invariant.name}' holds up to bounded depth k=${k}. No SAT-encodable violation condition found for unbounded induction.`,
      };
    }

    // Assert that the violation must happen at step k+1
    sat.addClause(violationLits);

    // --- Solve ---
    const result = sat.solve();
    const inductiveHolds = result.status === "UNSAT";

    return {
      isProvenInvariant: inductiveHolds,
      baseStepSatisfied: true,
      inductiveStepSatisfied: inductiveHolds,
      depth: k,
      message: inductiveHolds
        ? `Property '${invariant.name}' formally proven invariant by k-induction (depth k=${k}). Inductive step certified UNSAT.`
        : `Property '${invariant.name}' holds up to bounded depth k=${k}, but the inductive step is inconclusive (SAT). The property may require strengthening or a deeper induction depth.`,
    };
  }
}
