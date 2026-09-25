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
import { SimplificationWaterfall } from "./simplification_waterfall.js";

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

export type PropagationEvent =
  | {
      kind: "equality";
      varA: string;
      varB: string;
      domain?: "discrete" | "real" | "interval" | "spatial" | "concept";
      theoryDomain?: TheoryDomain;
      bounds?: [number, number];
      explanation?: string;
      sourceOracle: string;
      justification?: number[];
    }
  | {
      kind: "bound";
      varName: string;
      theoryDomain?: TheoryDomain;
      bounds: [number, number];
      explanation?: string;
      sourceOracle: string;
      justification?: number[];
    };

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
  private parentMap = new Map<string, string>();
  private canonicalBounds = new Map<string, [number, number]>();
  private varSubscribers = new Map<string, Set<TheoryOracle>>();
  private domainSubscribers = new Map<TheoryDomain, Set<TheoryOracle>>();
  private dirtyOracles = new Set<string>();
  private worklist: PropagationEvent[] = [];
  private memoizedResult?: { revision: number; result: CoordinatorSatResult };
  private levelStack: {
    literalIds: number[];
    equalityKeys: string[];
    parentSnapshot?: Map<string, string>;
    boundsSnapshot?: Map<string, [number, number]>;
  }[] = [];
  private nextLitId = 1;

  /**
   * Registers a specialized Theory Oracle with the coordinator.
   */
  public registerOracle(oracle: TheoryOracle): void {
    this.oracles.set(oracle.name, oracle);
    this.dirtyOracles.add(oracle.name);
    this.memoizedResult = undefined;
    this.subscribeDomain(oracle.domain, oracle);
  }

  public getOracle(name: string): TheoryOracle | undefined {
    return this.oracles.get(name);
  }

  public getRegisteredOracles(): TheoryOracle[] {
    return Array.from(this.oracles.values());
  }

  /**
   * Subscribes an oracle to notifications for a specific variable name.
   */
  public subscribe(varName: string, oracle: TheoryOracle): void {
    if (!this.varSubscribers.has(varName)) {
      this.varSubscribers.set(varName, new Set());
    }
    this.varSubscribers.get(varName)!.add(oracle);
  }

  /**
   * Unsubscribes an oracle from a variable.
   */
  public unsubscribe(varName: string, oracle: TheoryOracle): void {
    this.varSubscribers.get(varName)?.delete(oracle);
  }

  /**
   * Subscribes an oracle to all events in a specific domain.
   */
  public subscribeDomain(domain: TheoryDomain, oracle: TheoryOracle): void {
    if (!this.domainSubscribers.has(domain)) {
      this.domainSubscribers.set(domain, new Set());
    }
    this.domainSubscribers.get(domain)!.add(oracle);
  }

  /**
   * Unsubscribes an oracle from all events in a specific domain.
   */
  public unsubscribeDomain(domain: TheoryDomain, oracle: TheoryOracle): void {
    this.domainSubscribers.get(domain)?.delete(oracle);
  }

  /**
   * Enqueues an equality or bound propagation event into the coordinator worklist.
   */
  public enqueueEvent(event: PropagationEvent): void {
    this.worklist.push(event);
    this.memoizedResult = undefined;
  }

  /**
   * Resolves the canonical representative for a variable.
   */
  public getCanonicalVar(v: string): string {
    const parent = this.parentMap.get(v);
    if (!parent || parent === v) {
      this.parentMap.set(v, v);
      return v;
    }
    const root = this.getCanonicalVar(parent);
    this.parentMap.set(v, root);
    return root;
  }

  /**
   * Merges equivalence classes of two variables and intersects their known bounds.
   */
  private unionVars(a: string, b: string): string {
    const rootA = this.getCanonicalVar(a);
    const rootB = this.getCanonicalVar(b);
    if (rootA !== rootB) {
      this.parentMap.set(rootA, rootB);
      const bA = this.canonicalBounds.get(rootA);
      const bB = this.canonicalBounds.get(rootB);
      if (bA || bB) {
        const lo = Math.max(bA ? bA[0] : -Infinity, bB ? bB[0] : -Infinity);
        const hi = Math.min(bA ? bA[1] : Infinity, bB ? bB[1] : Infinity);
        this.canonicalBounds.set(rootB, [lo, hi]);
      }
      return rootB;
    }
    return rootA;
  }

  /**
   * Retrieves a copy of the canonical bounds table for all tracked equivalence roots.
   */
  public getAllCanonicalBounds(): Map<string, [number, number]> {
    return new Map(this.canonicalBounds);
  }

  /**
   * Extracts variable identifiers from a theory literal for subscriber tracking.
   */
  private extractReferencedVariables(lit: TheoryLiteral): string[] {
    const vars: string[] = [];
    if (!lit.args || !Array.isArray(lit.args)) return vars;

    const { predicate, args } = lit;
    if (predicate === "hyperplane" && args[0] && typeof args[0] === "object") {
      return Object.keys(args[0]);
    }
    if (predicate === "bundleClosure" && Array.isArray(args[1])) {
      return [...args[1]];
    }

    const extractVarsFromExprNode = (node: any, out: string[]): void => {
      if (!node || typeof node !== "object") return;
      if (node.kind === "var" && typeof node.name === "string") {
        out.push(node.name);
      }
      if (node.left) extractVarsFromExprNode(node.left, out);
      if (node.right) extractVarsFromExprNode(node.right, out);
      if (node.child) extractVarsFromExprNode(node.child, out);
    };

    if ((predicate === "nonlinear" || predicate === "expr") && args[0] && typeof args[0] === "object") {
      const expr = args[0].expr ?? args[0];
      extractVarsFromExprNode(expr, vars);
      if (Array.isArray(args[0].vars)) {
        vars.push(...args[0].vars);
      }
      return vars;
    }

    for (const arg of args) {
      if (typeof arg === "string" && arg.length > 0 && !arg.includes(" ") && !arg.includes("\n")) {
        if (
          !["<=", ">=", "==", "<", ">", "!=", "normal", "uniform", "kg", "m", "s", "N", "Pa", "W", "V"].includes(arg)
        ) {
          vars.push(arg);
        }
      }
    }
    return vars;
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

    const refVars = this.extractReferencedVariables(fullLit);
    for (const v of refVars) {
      if (!this.varSubscribers.has(v)) {
        this.varSubscribers.set(v, new Set());
      }
    }

    // Invalidation and ingestion normalization via SimplificationWaterfall
    this.memoizedResult = undefined;

    if (fullLit.predicate === "nonlinear" || fullLit.predicate === "expr") {
      if (fullLit.args[0] && typeof fullLit.args[0] === "object") {
        if (fullLit.args[0].expr && fullLit.args[0].rel) {
          fullLit.args[0] = SimplificationWaterfall.simplifyConstraint(fullLit.args[0]);
        } else if (fullLit.args[0].kind) {
          fullLit.args[0] = SimplificationWaterfall.simplifyExpr(fullLit.args[0]);
        }
      }
    } else if (fullLit.predicate === "hyperplane" && fullLit.args[0] && typeof fullLit.args[0] === "object") {
      const filteredCoeffs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fullLit.args[0])) {
        if (typeof v !== "number" || Math.abs(v) >= 1e-12) {
          filteredCoeffs[k] = v;
        }
      }
      fullLit.args[0] = filteredCoeffs;
    }

    // Route literal to relevant oracles and mark dirty
    const receivingOracles: string[] = [];
    for (const oracle of this.oracles.values()) {
      if (!fullLit.domain || fullLit.domain === oracle.domain) {
        oracle.assertLiteral(fullLit);
        this.dirtyOracles.add(oracle.name);
        receivingOracles.push(oracle.name);

        for (const v of refVars) {
          this.varSubscribers.get(v)!.add(oracle);
        }
      }
    }

    const srcOracle = receivingOracles[0] ?? fullLit.domain ?? "coordinator";

    // Automatically enqueue worklist event for bounds and equalities asserted directly
    if (fullLit.predicate === "interval" && Array.isArray(fullLit.args) && fullLit.args.length >= 3) {
      const [varName, lo, hi] = fullLit.args;
      if (typeof varName === "string" && typeof lo === "number" && typeof hi === "number") {
        this.enqueueEvent({
          kind: "bound",
          varName,
          bounds: [lo, hi],
          theoryDomain: fullLit.domain,
          sourceOracle: srcOracle,
        });
      }
    } else if (fullLit.predicate === "bound" && Array.isArray(fullLit.args) && fullLit.args.length >= 3) {
      const [varName, op, val] = fullLit.args;
      if (typeof varName === "string" && typeof val === "number") {
        let b: [number, number] | undefined;
        if (op === "<=" || op === "<") b = [-Infinity, val];
        else if (op === ">=" || op === ">") b = [val, Infinity];
        else if (op === "==") b = [val, val];
        if (b) {
          this.enqueueEvent({
            kind: "bound",
            varName,
            bounds: b,
            theoryDomain: fullLit.domain,
            sourceOracle: srcOracle,
          });
        }
      }
    } else if (fullLit.predicate === "equal" && Array.isArray(fullLit.args) && fullLit.args.length >= 2) {
      const [varA, varB] = fullLit.args;
      if (typeof varA === "string" && typeof varB === "string") {
        this.enqueueEvent({
          kind: "equality",
          varA,
          varB,
          domain: "real",
          theoryDomain: fullLit.domain,
          sourceOracle: srcOracle,
        });
      }
    } else if (fullLit.predicate === "sameIndividual" && Array.isArray(fullLit.args) && fullLit.args.length >= 2) {
      const [varA, varB] = fullLit.args;
      if (typeof varA === "string" && typeof varB === "string") {
        this.enqueueEvent({
          kind: "equality",
          varA,
          varB,
          domain: "concept",
          theoryDomain: fullLit.domain,
          sourceOracle: srcOracle,
        });
      }
    }

    return id;
  }

  /**
   * Retracts an asserted literal from all oracles.
   */
  public retractLiteral(litId: number): void {
    if (!this.activeLiterals.has(litId)) return;
    const lit = this.activeLiterals.get(litId)!;
    this.activeLiterals.delete(litId);
    this.memoizedResult = undefined;

    // Clear and rebuild canonical bounds from remaining active literals
    const refVars = this.extractReferencedVariables(lit);
    for (const v of refVars) {
      const canon = this.getCanonicalVar(v);
      this.canonicalBounds.delete(canon);
    }

    for (const activeLit of this.activeLiterals.values()) {
      if (activeLit.predicate === "interval" && Array.isArray(activeLit.args) && activeLit.args.length >= 3) {
        const [vName, lo, hi] = activeLit.args;
        if (typeof vName === "string" && typeof lo === "number" && typeof hi === "number") {
          const canon = this.getCanonicalVar(vName);
          const curr = this.canonicalBounds.get(canon);
          const newLo = Math.max(curr ? curr[0] : -Infinity, lo);
          const newHi = Math.min(curr ? curr[1] : Infinity, hi);
          this.canonicalBounds.set(canon, [newLo, newHi]);
        }
      } else if (activeLit.predicate === "bound" && Array.isArray(activeLit.args) && activeLit.args.length >= 3) {
        const [vName, op, val] = activeLit.args;
        if (typeof vName === "string" && typeof val === "number") {
          let lo = -Infinity;
          let hi = Infinity;
          if (op === "<=" || op === "<") hi = val;
          else if (op === ">=" || op === ">") lo = val;
          else if (op === "==") {
            lo = val;
            hi = val;
          }
          const canon = this.getCanonicalVar(vName);
          const curr = this.canonicalBounds.get(canon);
          const newLo = Math.max(curr ? curr[0] : -Infinity, lo);
          const newHi = Math.min(curr ? curr[1] : Infinity, hi);
          this.canonicalBounds.set(canon, [newLo, newHi]);
        }
      }
    }

    for (const oracle of this.oracles.values()) {
      oracle.retractLiteral(litId);
      this.dirtyOracles.add(oracle.name);
    }
  }

  /**
   * Pushes a backtracking decision level.
   */
  public pushLevel(): void {
    this.levelStack.push({
      literalIds: [],
      equalityKeys: [],
      parentSnapshot: new Map(this.parentMap),
      boundsSnapshot: new Map(this.canonicalBounds),
    });
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

    this.memoizedResult = undefined;

    for (const id of top.literalIds) {
      this.retractLiteral(id);
    }

    for (const key of top.equalityKeys) {
      this.knownEqualities.delete(key);
    }

    if (top.parentSnapshot) {
      this.parentMap = top.parentSnapshot;
    }
    if (top.boundsSnapshot) {
      this.canonicalBounds = top.boundsSnapshot;
    }

    for (const oracle of this.oracles.values()) {
      oracle.popLevel?.();
      this.dirtyOracles.add(oracle.name);
    }
  }

  /**
   * Resets all registered oracles and internal equality graphs.
   */
  public reset(): void {
    this.activeLiterals.clear();
    this.knownEqualities.clear();
    this.parentMap.clear();
    this.canonicalBounds.clear();
    this.varSubscribers.clear();
    this.domainSubscribers.clear();
    this.dirtyOracles.clear();
    this.worklist = [];
    this.memoizedResult = undefined;
    this.levelStack = [];
    this.nextLitId = 1;
    for (const oracle of this.oracles.values()) {
      oracle.reset();
      this.dirtyOracles.add(oracle.name);
    }
  }

  /**
   * Checks if an oracle is subscribed to a variable or any variable in its equivalence class.
   */
  private isSubscribedToVar(oracle: TheoryOracle, varName: string): boolean {
    const directSubs = this.varSubscribers.get(varName);
    if (directSubs && directSubs.has(oracle)) return true;

    const canon = this.getCanonicalVar(varName);
    const canonSubs = this.varSubscribers.get(canon);
    if (canonSubs && canonSubs.has(oracle)) return true;

    for (const [v, subs] of this.varSubscribers.entries()) {
      if (subs.has(oracle) && this.getCanonicalVar(v) === canon) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if an oracle is subscribed to a domain.
   */
  private isSubscribedToDomain(oracle: TheoryOracle, domain?: TheoryDomain): boolean {
    if (!domain) return false;
    const subs = this.domainSubscribers.get(domain);
    return subs ? subs.has(oracle) : false;
  }

  /**
   * Generates a canonical equality key for undirected pairs: (min, max).
   */
  private makeEqualityKey(varA: string, varB: string): string {
    return varA < varB ? `${varA}===#===${varB}` : `${varB}===#===${varA}`;
  }

  /**
   * Memoized query execution compatible with Salsa QueryEngine caching.
   */
  public querySat(revision = 0): CoordinatorSatResult {
    if (
      this.memoizedResult &&
      this.memoizedResult.revision === revision &&
      this.dirtyOracles.size === 0 &&
      this.worklist.length === 0
    ) {
      return this.memoizedResult.result;
    }
    const result = this.checkSat();
    this.memoizedResult = { revision, result };
    return result;
  }

  /**
   * Executes the Nelson-Oppen Worklist-Driven Equality Exchange & Satisfiability Procedure.
   * Alternates between:
   *   1. Checking local satisfiability across dirty oracles only.
   *   2. Enqueueing newly propagated equalities and bound contractions into the worklist.
   *   3. Draining worklist by selectively notifying subscribed and cross-domain oracles.
   * Repeats until fixpoint (empty worklist and clean SAT oracles) or conflict.
   */
  public checkSat(maxIterations = 50): CoordinatorSatResult {
    const startTime = performance.now();
    let iteration = 0;

    if (this.dirtyOracles.size === 0) {
      for (const name of this.oracles.keys()) {
        this.dirtyOracles.add(name);
      }
    }

    while (iteration < maxIterations) {
      iteration++;

      // Phase 1: Local oracle satisfiability check on dirty oracles only
      const checkingOracles = Array.from(this.dirtyOracles);
      for (const oracleName of checkingOracles) {
        const oracle = this.oracles.get(oracleName);
        if (!oracle) continue;
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
      this.dirtyOracles.clear();

      // Phase 2: Collect newly propagated equalities from checked oracles only and populate worklist
      for (const oracleName of checkingOracles) {
        const oracle = this.oracles.get(oracleName);
        if (!oracle) continue;
        const props = oracle.propagateEqualities();
        for (const eq of props) {
          this.enqueueEvent({
            kind: "equality",
            varA: eq.varA,
            varB: eq.varB,
            domain: eq.domain,
            theoryDomain: oracle.domain,
            bounds: eq.bounds,
            explanation: eq.explanation,
            sourceOracle: eq.sourceOracle ?? oracle.name,
          });
        }
      }

      // Phase 3: Drain worklist (event-driven propagation to subscribers)
      let eventsProcessed = 0;
      while (this.worklist.length > 0) {
        const event = this.worklist.shift()!;
        if (event.kind === "equality") {
          const key = this.makeEqualityKey(event.varA, event.varB);
          const existing = this.knownEqualities.get(key);
          let isNewOrTightened = false;

          const canonRoot = this.unionVars(event.varA, event.varB);
          const currentBound = this.canonicalBounds.get(canonRoot);

          if (event.bounds) {
            const lo = Math.max(currentBound ? currentBound[0] : -Infinity, event.bounds[0]);
            const hi = Math.min(currentBound ? currentBound[1] : Infinity, event.bounds[1]);
            // Guard against micro-contractions (Zeno loop prevention)
            if (!currentBound || lo > currentBound[0] + 1e-7 || hi < currentBound[1] - 1e-7) {
              this.canonicalBounds.set(canonRoot, [lo, hi]);
              isNewOrTightened = true;
            }
          }

          let eqToBroadcast: SharedEquality | null = null;
          if (!existing) {
            isNewOrTightened = true;
            eqToBroadcast = {
              varA: event.varA,
              varB: event.varB,
              domain: event.domain ?? "real",
              bounds:
                event.bounds ??
                (this.canonicalBounds.get(canonRoot) ? [...this.canonicalBounds.get(canonRoot)!] : undefined),
              explanation: event.explanation,
              sourceOracle: event.sourceOracle,
            };
            this.knownEqualities.set(key, eqToBroadcast);
            if (this.levelStack.length > 0) {
              this.levelStack[this.levelStack.length - 1]!.equalityKeys.push(key);
            }
          } else if (isNewOrTightened && event.bounds) {
            existing.bounds = [...event.bounds];
            existing.sourceOracle = event.sourceOracle;
            eqToBroadcast = { ...existing };
          }

          if (isNewOrTightened && eqToBroadcast) {
            eventsProcessed++;
            // Broadcast targeted event to subscribed oracles or relevant domain oracles
            for (const oracle of this.oracles.values()) {
              if (oracle.name === event.sourceOracle) continue;
              const isSubscribed =
                this.isSubscribedToVar(oracle, event.varA) ||
                this.isSubscribedToVar(oracle, event.varB) ||
                (event.theoryDomain ? this.isSubscribedToDomain(oracle, event.theoryDomain) : false);
              const isRelevantDomain =
                !event.domain ||
                oracle.domain === "constraint" ||
                (event.theoryDomain ? oracle.domain === event.theoryDomain : false);
              if (isSubscribed || isRelevantDomain) {
                oracle.onSharedEquality(eqToBroadcast);
                this.dirtyOracles.add(oracle.name);
              }
            }
          }
        } else if (event.kind === "bound") {
          const canonRoot = this.getCanonicalVar(event.varName);
          const currentBound = this.canonicalBounds.get(canonRoot);

          const lo = Math.max(currentBound ? currentBound[0] : -Infinity, event.bounds[0]);
          const hi = Math.min(currentBound ? currentBound[1] : Infinity, event.bounds[1]);

          let isNewOrTightened = false;
          if (!currentBound || lo > currentBound[0] + 1e-7 || hi < currentBound[1] - 1e-7) {
            this.canonicalBounds.set(canonRoot, [lo, hi]);
            isNewOrTightened = true;
          }

          if (isNewOrTightened) {
            eventsProcessed++;
            const boundEq: SharedEquality = {
              varA: event.varName,
              varB: event.varName,
              domain: "interval",
              bounds: [lo, hi],
              explanation: event.explanation ?? `Contracted bound on '${event.varName}' to [${lo}, ${hi}]`,
              sourceOracle: event.sourceOracle,
            };

            for (const oracle of this.oracles.values()) {
              if (oracle.name === event.sourceOracle) continue;
              const isSubscribed =
                this.isSubscribedToVar(oracle, event.varName) ||
                (event.theoryDomain ? this.isSubscribedToDomain(oracle, event.theoryDomain) : false);
              if (isSubscribed) {
                oracle.onSharedEquality(boundEq);
                this.dirtyOracles.add(oracle.name);
              }
            }
          }
        }
      }

      // Phase 4: Fixed point check — no dirty oracles and no worklist events
      if (this.dirtyOracles.size === 0 && eventsProcessed === 0) {
        break;
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
