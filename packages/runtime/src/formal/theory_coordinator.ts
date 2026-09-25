// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Generalized Nelson-Oppen Semantic Theory Coordinator.
 *
 * Implements a First-Order Logic (FOL) multi-solver theory conductor that coordinates
 * equality sharing, bound tightening, and conflict clause propagation across
 * specialized theory oracles:
 *   - OntologyTheoryOracle (Tableau DL, Bundle Closure, Scoped Disjointness)
 *   - ConstraintTheoryOracle (DPLL(T), Interval Contraction, Arithmetic)
 *   - AbstractDomainOracle (Octagon DBM, 4D Time Intervals, Relational Bounds)
 *   - ContinuousSafetyOracle (Reachability Flowpipes & SOS Barrier Certificates)
 *   - DynamicSimulationOracle (DAE Trajectories, STL Robustness, UQ Tolerancing)
 *   - SpatialPhysicsOracle (CAD B-Rep Solids, Watertightness, 3D FEA/CFD)
 *
 * Grounded in Nelson-Oppen equality exchange over stably infinite, signature-disjoint
 * theories with CDCL(T) case splitting for non-convex disjunctions.
 */

export type TheoryDomain =
  | "ontology"
  | "constraint"
  | "abstract_domain"
  | "continuous_safety"
  | "dynamic_simulation"
  | "spatial_physics"
  | "custom";

export interface TheoryLiteral {
  id: number;
  predicate: string;
  args: any[];
  isNegated?: boolean;
  domain?: TheoryDomain;
  sourceContext?: any;
}

export interface SharedEquality {
  varA: string;
  varB: string;
  domain: "discrete" | "real" | "interval" | "spatial" | "concept";
  bounds?: [number, number];
  explanation?: string;
  sourceOracle?: string;
}

export interface ConflictClause {
  literals: TheoryLiteral[];
  explanation: string;
  culpritEntities: string[];
  theoryName: string;
}

export interface CoordinatorSatResult {
  isSat: boolean;
  conflict?: ConflictClause;
  sharedEqualities: SharedEquality[];
  models?: Record<string, any>;
  iterations: number;
  durationMs: number;
}

export interface TheoryOracle {
  readonly name: string;
  readonly domain: TheoryDomain;
  assertLiteral(lit: TheoryLiteral): boolean;
  retractLiteral(litId: number): void;
  checkSat(): { isSat: boolean; conflict?: ConflictClause };
  propagateEqualities(): SharedEquality[];
  onSharedEquality(eq: SharedEquality): void;
  pushLevel?(): void;
  popLevel?(): void;
  reset(): void;
  getModel?(): Record<string, any>;
}

export class SemanticTheoryCoordinator {
  private oracles = new Map<string, TheoryOracle>();
  private activeLiterals = new Map<number, TheoryLiteral>();
  private knownEqualities = new Map<string, SharedEquality>();
  private levelStack: { literalIds: number[]; equalityKeys: string[] }[] = [];
  private nextLitId = 1;

  /**
   * Registers a specialized Theory Oracle with the coordinator.
   */
  public registerOracle(oracle: TheoryOracle): void {
    this.oracles.set(oracle.name, oracle);
  }

  public getOracle(name: string): TheoryOracle | undefined {
    return this.oracles.get(name);
  }

  public getRegisteredOracles(): TheoryOracle[] {
    return Array.from(this.oracles.values());
  }

  /**
   * Asserts a new theory literal into the coordinator, routing to appropriate oracles.
   */
  public assertLiteral(lit: Omit<TheoryLiteral, "id"> & { id?: number }): number {
    const id = lit.id ?? this.nextLitId++;
    const fullLit: TheoryLiteral = { ...lit, id };
    this.activeLiterals.set(id, fullLit);

    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1]!.literalIds.push(id);
    }

    // Route literal to relevant oracles
    for (const oracle of this.oracles.values()) {
      if (!fullLit.domain || fullLit.domain === oracle.domain) {
        oracle.assertLiteral(fullLit);
      }
    }

    return id;
  }

  /**
   * Retracts an asserted literal from all oracles.
   */
  public retractLiteral(litId: number): void {
    if (!this.activeLiterals.has(litId)) return;
    this.activeLiterals.delete(litId);

    for (const oracle of this.oracles.values()) {
      oracle.retractLiteral(litId);
    }
  }

  /**
   * Pushes a backtracking decision level.
   */
  public pushLevel(): void {
    this.levelStack.push({ literalIds: [], equalityKeys: [] });
    for (const oracle of this.oracles.values()) {
      oracle.pushLevel?.();
    }
  }

  /**
   * Pops the current decision level, retracting all literals and equalities asserted within it.
   */
  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;

    for (const id of top.literalIds) {
      this.retractLiteral(id);
    }

    for (const key of top.equalityKeys) {
      this.knownEqualities.delete(key);
    }

    for (const oracle of this.oracles.values()) {
      oracle.popLevel?.();
    }
  }

  /**
   * Resets all registered oracles and internal equality graphs.
   */
  public reset(): void {
    this.activeLiterals.clear();
    this.knownEqualities.clear();
    this.levelStack = [];
    this.nextLitId = 1;
    for (const oracle of this.oracles.values()) {
      oracle.reset();
    }
  }

  /**
   * Generates a canonical equality key for undirected pairs: (min, max).
   */
  private makeEqualityKey(varA: string, varB: string): string {
    return varA < varB ? `${varA}===#===${varB}` : `${varB}===#===${varA}`;
  }

  /**
   * Executes the Nelson-Oppen Equality Exchange & Satisfiability Procedure.
   * Alternates between:
   *   1. Checking local satisfiability across all oracles.
   *   2. Collecting newly propagated equalities from each oracle.
   *   3. Broadcasting discovered equalities to all other oracles.
   * Repeats until fixpoint (no new equalities) or conflict.
   */
  public checkSat(maxIterations = 50): CoordinatorSatResult {
    const startTime = performance.now();
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      // Phase 1: Local oracle satisfiability check
      for (const oracle of this.oracles.values()) {
        const res = oracle.checkSat();
        if (!res.isSat) {
          return {
            isSat: false,
            conflict: res.conflict ?? {
              literals: [],
              explanation: `Conflict discovered in theory oracle '${oracle.name}'.`,
              culpritEntities: [],
              theoryName: oracle.name,
            },
            sharedEqualities: Array.from(this.knownEqualities.values()),
            iterations: iteration,
            durationMs: performance.now() - startTime,
          };
        }
      }

      // Phase 2: Collect newly propagated equalities
      const newEqualities: SharedEquality[] = [];
      for (const oracle of this.oracles.values()) {
        const props = oracle.propagateEqualities();
        for (const eq of props) {
          const key = this.makeEqualityKey(eq.varA, eq.varB);
          if (!this.knownEqualities.has(key)) {
            eq.sourceOracle = eq.sourceOracle ?? oracle.name;
            this.knownEqualities.set(key, eq);
            newEqualities.push(eq);

            if (this.levelStack.length > 0) {
              this.levelStack[this.levelStack.length - 1]!.equalityKeys.push(key);
            }
          }
        }
      }

      // Phase 3: Check for fixpoint (no new equalities discovered)
      if (newEqualities.length === 0) {
        break;
      }

      // Phase 4: Broadcast new equalities to all other oracles
      for (const eq of newEqualities) {
        for (const oracle of this.oracles.values()) {
          if (oracle.name !== eq.sourceOracle) {
            oracle.onSharedEquality(eq);
          }
        }
      }
    }

    // Combine models across all oracles
    const combinedModels: Record<string, any> = {};
    for (const oracle of this.oracles.values()) {
      if (oracle.getModel) {
        combinedModels[oracle.name] = oracle.getModel();
      }
    }

    return {
      isSat: true,
      sharedEqualities: Array.from(this.knownEqualities.values()),
      models: combinedModels,
      iterations: iteration,
      durationMs: performance.now() - startTime,
    };
  }
}
