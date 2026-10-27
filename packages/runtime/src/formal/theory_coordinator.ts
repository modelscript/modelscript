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
 *
 * Academic Citations:
 *   - Nelson, G., & Oppen, D. C. (1979). "Simplification by cooperating decision procedures."
 *     ACM Transactions on Programming Languages and Systems (TOPLAS), 1(2), pp. 245–257.
 *     DOI: 10.1145/357073.357079.
 *   - Shostak, R. E. (1984). "Deciding combinations of theories." Journal of the ACM, 31(1),
 *     pp. 1–12. DOI: 10.1145/2422.322411.
 *   - Nieuwenhuis, R., Oliveras, A., & Tinelli, C. (2006). "Solving SAT and SAT Modulo Theories:
 *     From an abstract Davis--Putnam--Logemann--Loveland procedure to DPLL(T)."
 *     Journal of the ACM, 53(6), pp. 937–977. DOI: 10.1145/1217856.1217859.
 *
 * ModelScript Architectural Rationale:
 *   Modern cyber-physical systems cannot be verified within a single monolithic logic because they
 *   simultaneously involve discrete mode logic, continuous physical differential equations,
 *   geometric clearance constraints, and ontological classifications. The SemanticTheoryCoordinator
 *   acts as a central Nelson-Oppen exchange bus: specialized theory oracles reason independently
 *   over their own domains and propagate inferred variable bounds, equalities, and conflict clauses
 *   to each other, achieving sound cross-domain verification without semantic loss.
 *
 * Modifications:
 *   - Generalized from classical software theories (arrays, uninterpreted functions) to 12 cyber-physical
 *     engineering domains including CAD B-Reps, DAE dynamic simulation traces, STL monitors, and OWL2 DL.
 *   - DPLL(T) lazy constraint generation with learned conflict clause backpropagation.
 *   - Supports cancellation tokens and incremental query memoization compatible with the Salsa QueryEngine.
 */
import { SimplificationWaterfall } from "./simplification_waterfall.js";

/**
 * Identifier for a specialized formal reasoning domain managed by the coordinator.
 */
export type TheoryDomain =
  | "ontology"
  | "constraint"
  | "abstract_domain"
  | "continuous_safety"
  | "dynamic_simulation"
  | "spatial_physics"
  | "algebraic"
  | "custom";

/**
 * Cooperative cancellation token or standard `AbortSignal` used to interrupt long-running solver loops.
 */
export type CancellationTokenLike =
  | { isCancellationRequested?: boolean | undefined; aborted?: boolean | undefined }
  | AbortSignal;

/**
 * Uninterpreted or surrogate function application term `resultVar = f(args...)` tracked for congruence closure.
 */
export interface FunctionApplicationTerm {
  functionName: string;
  args: string[];
  resultVar: string;
  literalId: number;
}

/**
 * Atomic predicate literal asserted into a theory oracle.
 */
export interface TheoryLiteral {
  id: number;
  predicate: string;
  args: any[];
  isNegated?: boolean | undefined;
  domain?: TheoryDomain | undefined;
  sourceContext?: any;
}

/**
 * Equality or interval bound relation exchanged between theory oracles via the Nelson-Oppen bus.
 */
export interface SharedEquality {
  varA: string;
  varB: string;
  domain: "discrete" | "real" | "interval" | "spatial" | "concept";
  bounds?: [number, number] | undefined;
  explanation?: string | undefined;
  sourceOracle?: string | undefined;
  justifications?: number[] | undefined;
  justification?: number[] | undefined;
}

/**
 * Explanation and minimal conflict clause emitted when a theory oracle detects unsatisfiability.
 */
export interface ConflictClause {
  literals: TheoryLiteral[];
  explanation: string;
  culpritEntities: string[];
  theoryName: string;
}

/**
 * Result of a coordinated multi-theory satisfiability and equality-propagation fixpoint check.
 */
export interface CoordinatorSatResult {
  status: "SAT" | "UNSAT" | "UNKNOWN";
  isSat: boolean;
  conflict?: ConflictClause | undefined;
  sharedEqualities: SharedEquality[];
  models?: Record<string, any> | undefined;
  iterations: number;
  durationMs: number;
  reason?: string | undefined;
}

/**
 * Event enqueued on the coordinator worklist representing a newly deduced equality or interval bound.
 */
export type PropagationEvent =
  | {
      kind: "equality";
      varA: string;
      varB: string;
      domain?: "discrete" | "real" | "interval" | "spatial" | "concept" | undefined;
      theoryDomain?: TheoryDomain | undefined;
      bounds?: [number, number] | undefined;
      explanation?: string | undefined;
      sourceOracle: string;
      justification?: number[] | undefined;
    }
  | {
      kind: "bound";
      varName: string;
      theoryDomain?: TheoryDomain | undefined;
      bounds: [number, number];
      explanation?: string | undefined;
      sourceOracle: string;
      justification?: number[] | undefined;
    };

/**
 * Interface implemented by each domain-specific decision procedure participating in Nelson-Oppen / DPLL(T) coordination.
 */
export interface TheoryOracle {
  readonly name: string;
  readonly domain: TheoryDomain;
  assertLiteral(lit: TheoryLiteral): boolean;
  retractLiteral(litId: number): void;
  checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined };
  propagateEqualities(): SharedEquality[];
  onSharedEquality(eq: SharedEquality): void;
  pushLevel?(): void;
  popLevel?(): void;
  reset(): void;
  getModel?(): Record<string, any>;
}

/**
 * Central Nelson-Oppen and CDCL(T) theory coordinator that synchronizes variable equivalence classes,
 * interval bounds, congruence closure, and conflict clauses across heterogeneous engineering theory oracles.
 */
export class SemanticTheoryCoordinator {
  /** Registered theory oracles keyed by oracle name. */
  private oracles = new Map<string, TheoryOracle>();
  /** Currently asserted theory literals keyed by literal ID. */
  private activeLiterals = new Map<number, TheoryLiteral>();
  /** Deduplicated shared equalities exchanged between oracles, keyed by packed 64-bit pair ID. */
  private knownEqualities = new Map<bigint, SharedEquality>();
  /** Interned variable names to 32-bit IDs for packed 64-bit equality keys. */
  private varToId = new Map<string, number>();
  private idToVar: string[] = [];
  /** Union-Find parent map for variable equivalence classes. */
  private parentMap = new Map<string, string>();
  /** Tightest intersected interval `[low, high]` for each canonical variable representative. */
  private canonicalBounds = new Map<string, [number, number]>();
  /** Set of literal IDs justifying the current interval bounds of each canonical variable. */
  private canonicalBoundJustifications = new Map<string, Set<number>>();
  /** Oracles subscribed to updates on a specific raw variable name. */
  private varSubscribers = new Map<string, Set<TheoryOracle>>();
  /** Oracles subscribed to updates on a canonical variable equivalence class. */
  private canonSubscribers = new Map<string, Set<TheoryOracle>>();
  /** Oracles subscribed to all events within a specific `TheoryDomain`. */
  private domainSubscribers = new Map<TheoryDomain, Set<TheoryOracle>>();
  /** Set of oracle names whose state has changed since the last `checkSat` pass. */
  private dirtyOracles = new Set<string>();
  /** Pending equality and bound propagation events awaiting dispatch. */
  private worklist: PropagationEvent[] = [];
  /** Cached satisfiability result for the current state revision. */
  private memoizedResult?: { revision: number; result: CoordinatorSatResult } | undefined;
  /** Immediate bound-inversion or equality conflict detected during eager propagation. */
  private infeasibleConflict?: ConflictClause | undefined;
  /** Registered function application terms for congruence closure deduction. */
  private functionTerms: FunctionApplicationTerm[] = [];
  /** Opposite-sign flow conservation pairings (vA = -vB) keyed by variable name. */
  private oppositeSignPairs = new Map<string, { partner: string; justifications: number[] }[]>();
  /** Backtracking stack of solver state snapshots for `pushLevel()` / `popLevel()`. */
  private levelStack: {
    literalIds: number[];
    equalityKeys: bigint[];
    worklistSnapshot?: PropagationEvent[] | undefined;
    parentSnapshot?: Map<string, string> | undefined;
    boundsSnapshot?: Map<string, [number, number]> | undefined;
    canonSubscribersSnapshot?: Map<string, Set<TheoryOracle>> | undefined;
    boundJustificationsSnapshot?: Map<string, Set<number>> | undefined;
    infeasibleConflictSnapshot?: ConflictClause | undefined;
    functionTermsSnapshot?: FunctionApplicationTerm[] | undefined;
    oppositeSignPairsSnapshot?: Map<string, { partner: string; justifications: number[] }[]> | undefined;
  }[] = [];
  /** Monotonically increasing counter for auto-assigned literal IDs. */
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

  /**
   * Retrieves a registered theory oracle by its unique name.
   */
  public getOracle(name: string): TheoryOracle | undefined {
    return this.oracles.get(name);
  }

  /**
   * Returns all currently registered theory oracles.
   */
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

    const canon = this.getCanonicalVar(varName);
    if (!this.canonSubscribers.has(canon)) {
      this.canonSubscribers.set(canon, new Set());
    }
    this.canonSubscribers.get(canon)!.add(oracle);
  }

  /**
   * Unsubscribes an oracle from a variable.
   */
  public unsubscribe(varName: string, oracle: TheoryOracle): void {
    this.varSubscribers.get(varName)?.delete(oracle);
    const canon = this.getCanonicalVar(varName);
    this.canonSubscribers.get(canon)?.delete(oracle);
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
   * Resolves an array of justification literal IDs into their corresponding `TheoryLiteral` objects.
   */
  private resolveJustificationLiterals(justIds: number[]): TheoryLiteral[] {
    const result: TheoryLiteral[] = [];
    const seen = new Set<number>();
    for (const id of justIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const lit = this.activeLiterals.get(id);
      if (lit) {
        result.push(lit);
      } else {
        result.push({
          id,
          predicate: "inferredLiteral",
          args: [],
        });
      }
    }
    return result;
  }

  /**
   * Constructs a `ConflictClause` when interval bound intersection yields an empty interval (`lo > hi`).
   */
  private makeBoundInversionConflict(
    culpritVar: string,
    lo: number,
    hi: number,
    justIds: number[],
    culprits: string[] = [culpritVar],
  ): ConflictClause {
    const lits = this.resolveJustificationLiterals(justIds);
    return {
      literals: lits,
      explanation: `Arithmetic Bound Conflict: Immediate interval contradiction on '${culpritVar}': lower bound ${lo} exceeds upper bound ${hi}.`,
      culpritEntities: Array.from(new Set(culprits)),
      theoryName: "SemanticTheoryCoordinator",
    };
  }

  /**
   * Resolves the canonical representative for a variable.
   * Uses an iterative two-pass disjoint-set find with path compression and cycle guard.
   */
  public getCanonicalVar(v: string): string {
    let curr = v;
    const visited = new Set<string>();
    const path: string[] = [];

    while (true) {
      if (visited.has(curr)) {
        this.parentMap.set(curr, curr);
        break;
      }
      visited.add(curr);
      path.push(curr);
      const parent = this.parentMap.get(curr);
      if (!parent || parent === curr) {
        break;
      }
      curr = parent;
    }

    const root = curr;
    for (const node of path) {
      this.parentMap.set(node, root);
    }
    return root;
  }

  /**
   * Merges equivalence classes of two variables and intersects their known bounds.
   */
  private unionVars(a: string, b: string): string {
    const aIsNum = a.trim() !== "" && !isNaN(Number(a));
    const bIsNum = b.trim() !== "" && !isNaN(Number(b));
    if (bIsNum && !aIsNum) return this.getCanonicalVar(a);
    if (aIsNum && !bIsNum) return this.getCanonicalVar(b);
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
        if (lo > hi + 1e-9) {
          const allJusts = new Set<number>();
          const jA = this.canonicalBoundJustifications.get(rootA);
          const jB = this.canonicalBoundJustifications.get(rootB);
          if (jA) for (const id of jA) allJusts.add(id);
          if (jB) for (const id of jB) allJusts.add(id);
          this.infeasibleConflict = this.makeBoundInversionConflict(rootB, lo, hi, Array.from(allJusts), [
            rootA,
            rootB,
            a,
            b,
          ]);
        }
      }
      // Merge justifications
      const jA = this.canonicalBoundJustifications.get(rootA);
      const jB = this.canonicalBoundJustifications.get(rootB);
      if (jA || jB) {
        if (!this.canonicalBoundJustifications.has(rootB)) {
          this.canonicalBoundJustifications.set(rootB, new Set());
        }
        const setB = this.canonicalBoundJustifications.get(rootB)!;
        if (jA) for (const id of jA) setB.add(id);
      }
      // Merge canonical subscribers
      const subsA = this.canonSubscribers.get(rootA);
      if (subsA && subsA.size > 0) {
        if (!this.canonSubscribers.has(rootB)) {
          this.canonSubscribers.set(rootB, new Set());
        }
        const subsB = this.canonSubscribers.get(rootB)!;
        for (const oracle of subsA) {
          subsB.add(oracle);
        }
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
    if (
      predicate === "bundleClosure" ||
      predicate === "subClassOf" ||
      predicate === "disjoint" ||
      predicate === "portType"
    ) {
      return [];
    }
    if (predicate === "funcApply" || predicate === "functionApply" || predicate === "surrogateApply") {
      if (typeof args[0] === "string") vars.push(args[0]);
      if (Array.isArray(args[2])) {
        for (const a of args[2]) if (typeof a === "string") vars.push(a);
      } else {
        for (let i = 2; i < args.length; i++) {
          if (typeof args[i] === "string") vars.push(args[i]);
        }
      }
      return vars;
    }
    if (predicate === "type" || predicate === "isa" || predicate === "classAssertion") {
      if (typeof args[0] === "string") vars.push(args[0]);
      return vars;
    }
    if (predicate === "dimension" || predicate === "portUsage") {
      if (typeof args[0] === "string") vars.push(args[0]);
      return vars;
    }
    if (predicate === "distribution" || predicate === "probBound" || predicate === "sampleRate") {
      if (typeof args[0] === "string") vars.push(args[0]);
      return vars;
    }
    if (predicate === "requirement") {
      if (typeof args[1] === "string") vars.push(args[1]);
      return vars;
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

    const reservedWords = new Set([
      "<=",
      ">=",
      "==",
      "<",
      ">",
      "!=",
      "normal",
      "uniform",
      "exponential",
      "weibull",
      "kg",
      "m",
      "s",
      "N",
      "Pa",
      "W",
      "V",
      "kN",
      "MPa",
      "degC",
      "m/s",
      "m/s2",
      "rad/s",
      "bar",
      "J",
    ]);

    for (const arg of args) {
      if (typeof arg === "string" && arg.length > 0 && !arg.includes(" ") && !arg.includes("\n")) {
        if (!reservedWords.has(arg)) {
          vars.push(arg);
        }
      }
    }
    return vars;
  }

  /**
   * Asserts a new theory literal into the coordinator, routing to appropriate oracles.
   */
  public assertLiteral(lit: Omit<TheoryLiteral, "id"> & { id?: number | undefined }): number {
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

    // Register function application term for congruence closure
    if (
      (fullLit.predicate === "funcApply" ||
        fullLit.predicate === "functionApply" ||
        fullLit.predicate === "surrogateApply") &&
      Array.isArray(fullLit.args) &&
      fullLit.args.length >= 3
    ) {
      const resultVar = fullLit.args[0];
      const fnName = fullLit.args[1];
      const rawArgs = fullLit.args[2];
      const argVars = Array.isArray(rawArgs)
        ? rawArgs.map(String)
        : fullLit.args.slice(2).filter((a): a is string => typeof a === "string");
      if (typeof resultVar === "string" && typeof fnName === "string") {
        this.functionTerms.push({
          functionName: fnName,
          args: argVars,
          resultVar,
          literalId: id,
        });
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
          this.subscribe(v, oracle);
        }
      }
    }

    const srcOracle = receivingOracles[0] ?? fullLit.domain ?? "coordinator";

    // Automatically enqueue worklist event for bounds and equalities asserted directly
    if (fullLit.predicate === "interval" && Array.isArray(fullLit.args) && fullLit.args.length >= 3) {
      const [varName, lo, hi] = fullLit.args;
      if (typeof varName === "string" && typeof lo === "number" && typeof hi === "number") {
        if (lo > hi + 1e-9) {
          this.infeasibleConflict = this.makeBoundInversionConflict(varName, lo, hi, [id], [varName]);
        }
        this.enqueueEvent({
          kind: "bound",
          varName,
          bounds: [lo, hi],
          theoryDomain: fullLit.domain,
          sourceOracle: srcOracle,
          justification: [id],
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
            justification: [id],
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
          justification: [id],
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
          justification: [id],
        });
      }
    }

    return id;
  }

  /**
   * Registers an opposite-sign flow conservation pairing (`vA == -vB`, i.e., `vA + vB = 0`).
   */
  private registerOppositeSignPair(rawVarA: string, rawVarB: string, justifications: number[]): void {
    const cleanA = rawVarA.startsWith("-") ? rawVarA.slice(1) : rawVarA;
    const cleanB = rawVarB.startsWith("-") ? rawVarB.slice(1) : rawVarB;
    const addLink = (fromVar: string, toVar: string) => {
      if (!this.oppositeSignPairs.has(fromVar)) {
        this.oppositeSignPairs.set(fromVar, []);
      }
      const list = this.oppositeSignPairs.get(fromVar)!;
      const existing = list.find((item) => item.partner === toVar);
      if (existing) {
        for (const j of justifications) {
          if (!existing.justifications.includes(j)) existing.justifications.push(j);
        }
      } else {
        list.push({ partner: toVar, justifications: [...justifications] });
      }
    };
    addLink(cleanA, cleanB);
    addLink(cleanB, cleanA);
  }

  /**
   * Retracts an asserted literal from all oracles and rebuilds equivalence classes and bounds.
   */
  public retractLiteral(litId: number): void {
    if (!this.activeLiterals.has(litId)) return;
    const lit = this.activeLiterals.get(litId)!;
    this.activeLiterals.delete(litId);
    this.memoizedResult = undefined;
    this.worklist = this.worklist.filter((e) => !e.justification || !e.justification.includes(litId));
    this.functionTerms = this.functionTerms.filter((t) => t.literalId !== litId);
    this.infeasibleConflict = undefined;

    // Purge known equalities that depended on the retracted literal or congruence closure
    const directEqKey =
      (lit.predicate === "equal" || lit.predicate === "sameIndividual") &&
      Array.isArray(lit.args) &&
      typeof lit.args[0] === "string" &&
      typeof lit.args[1] === "string"
        ? this.makeEqualityKey(lit.args[0], lit.args[1])
        : undefined;

    for (const [key, eq] of Array.from(this.knownEqualities.entries())) {
      const justs = eq.justifications ?? eq.justification;
      const dependsOnLit =
        (justs && justs.includes(litId)) ||
        (directEqKey !== undefined && key === directEqKey) ||
        eq.sourceOracle === "CongruenceClosure";
      if (dependsOnLit) {
        this.knownEqualities.delete(key);
      }
    }

    // Clear and rebuild equivalence classes, opposite-sign pairs, justifications, and canonical bounds
    this.parentMap.clear();
    this.canonicalBounds.clear();
    this.canonicalBoundJustifications.clear();
    this.canonSubscribers.clear();
    this.oppositeSignPairs.clear();

    const addJustifications = (canon: string, ids: number[]) => {
      if (ids.length === 0) return;
      if (!this.canonicalBoundJustifications.has(canon)) {
        this.canonicalBoundJustifications.set(canon, new Set());
      }
      const set = this.canonicalBoundJustifications.get(canon)!;
      for (const id of ids) set.add(id);
    };

    // 1. Rebuild equivalence classes from remaining active equal/sameIndividual literals
    for (const activeLit of this.activeLiterals.values()) {
      if (
        (activeLit.predicate === "equal" || activeLit.predicate === "sameIndividual") &&
        Array.isArray(activeLit.args) &&
        activeLit.args.length >= 2
      ) {
        const [varA, varB] = activeLit.args;
        if (typeof varA === "string" && typeof varB === "string") {
          if (varA.startsWith("-") !== varB.startsWith("-")) {
            this.registerOppositeSignPair(varA, varB, [activeLit.id]);
          } else {
            const root = this.unionVars(varA, varB);
            addJustifications(root, [activeLit.id]);
          }
        }
      }
    }

    // 2. Rebuild equivalence classes from remaining valid knownEqualities
    for (const eq of this.knownEqualities.values()) {
      const justs = (eq.justifications ?? eq.justification ?? []).filter((id) => id !== litId);
      eq.justifications = justs;
      eq.justification = justs;
      if (eq.varA.startsWith("-") !== eq.varB.startsWith("-")) {
        this.registerOppositeSignPair(eq.varA, eq.varB, justs);
      } else {
        const root = this.unionVars(eq.varA, eq.varB);
        addJustifications(root, justs);
      }
    }

    // 3. Rebuild canonical subscribers from varSubscribers
    for (const [vName, subs] of this.varSubscribers.entries()) {
      if (subs.size === 0) continue;
      const canon = this.getCanonicalVar(vName);
      if (!this.canonSubscribers.has(canon)) {
        this.canonSubscribers.set(canon, new Set());
      }
      const canonSet = this.canonSubscribers.get(canon)!;
      for (const oracle of subs) {
        canonSet.add(oracle);
      }
    }

    // 4. Rebuild canonical bounds from remaining active interval/bound literals and knownEqualities
    for (const activeLit of this.activeLiterals.values()) {
      if (activeLit.predicate === "interval" && Array.isArray(activeLit.args) && activeLit.args.length >= 3) {
        const [vName, lo, hi] = activeLit.args;
        if (typeof vName === "string" && typeof lo === "number" && typeof hi === "number") {
          const canon = this.getCanonicalVar(vName);
          const curr = this.canonicalBounds.get(canon);
          const newLo = Math.max(curr ? curr[0] : -Infinity, lo);
          const newHi = Math.min(curr ? curr[1] : Infinity, hi);
          this.canonicalBounds.set(canon, [newLo, newHi]);
          addJustifications(canon, [activeLit.id]);
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
          addJustifications(canon, [activeLit.id]);
        }
      }
    }

    for (const eq of this.knownEqualities.values()) {
      if (eq.bounds && eq.varA.startsWith("-") === eq.varB.startsWith("-")) {
        const canon = this.getCanonicalVar(eq.varA);
        const curr = this.canonicalBounds.get(canon);
        const newLo = Math.max(curr ? curr[0] : -Infinity, eq.bounds[0]);
        const newHi = Math.min(curr ? curr[1] : Infinity, eq.bounds[1]);
        this.canonicalBounds.set(canon, [newLo, newHi]);
      }
    }

    // Mirror bounds across opposite-sign pairs
    for (const [varName, partners] of this.oppositeSignPairs.entries()) {
      const rootA = this.getCanonicalVar(varName);
      const bA = this.canonicalBounds.get(rootA);
      if (!bA) continue;
      for (const { partner, justifications } of partners) {
        const rootB = this.getCanonicalVar(partner);
        const currB = this.canonicalBounds.get(rootB);
        const newLo = Math.max(currB ? currB[0] : -Infinity, -bA[1]);
        const newHi = Math.min(currB ? currB[1] : Infinity, -bA[0]);
        this.canonicalBounds.set(rootB, [newLo, newHi]);
        addJustifications(rootB, justifications);
        const jA = this.canonicalBoundJustifications.get(rootA);
        if (jA) addJustifications(rootB, Array.from(jA));
      }
    }

    for (const [canon, [lo, hi]] of this.canonicalBounds.entries()) {
      if (lo > hi + 1e-9) {
        const justs = this.canonicalBoundJustifications.get(canon)
          ? Array.from(this.canonicalBoundJustifications.get(canon)!)
          : [];
        this.infeasibleConflict = this.makeBoundInversionConflict(canon, lo, hi, justs, [canon]);
        break;
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
    const csSnapshot = new Map<string, Set<TheoryOracle>>();
    for (const [k, v] of this.canonSubscribers.entries()) {
      csSnapshot.set(k, new Set(v));
    }
    const bjSnapshot = new Map<string, Set<number>>();
    for (const [k, v] of this.canonicalBoundJustifications.entries()) {
      bjSnapshot.set(k, new Set(v));
    }
    const ospSnapshot = new Map<string, { partner: string; justifications: number[] }[]>();
    for (const [k, v] of this.oppositeSignPairs.entries()) {
      ospSnapshot.set(
        k,
        v.map((item) => ({ partner: item.partner, justifications: [...item.justifications] })),
      );
    }
    this.levelStack.push({
      literalIds: [],
      equalityKeys: [],
      worklistSnapshot: [...this.worklist],
      parentSnapshot: new Map(this.parentMap),
      boundsSnapshot: new Map(this.canonicalBounds),
      canonSubscribersSnapshot: csSnapshot,
      boundJustificationsSnapshot: bjSnapshot,
      infeasibleConflictSnapshot: this.infeasibleConflict ? { ...this.infeasibleConflict } : undefined,
      functionTermsSnapshot: [...this.functionTerms],
      oppositeSignPairsSnapshot: ospSnapshot,
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
      this.activeLiterals.delete(id);
    }

    for (const key of top.equalityKeys) {
      this.knownEqualities.delete(key);
    }

    if (top.worklistSnapshot) {
      this.worklist = [...top.worklistSnapshot];
    }
    if (top.parentSnapshot) {
      this.parentMap = top.parentSnapshot;
    }
    if (top.boundsSnapshot) {
      this.canonicalBounds = top.boundsSnapshot;
    }
    if (top.canonSubscribersSnapshot) {
      this.canonSubscribers = top.canonSubscribersSnapshot;
    }
    if (top.boundJustificationsSnapshot) {
      this.canonicalBoundJustifications = top.boundJustificationsSnapshot;
    }
    this.infeasibleConflict = top.infeasibleConflictSnapshot;
    if (top.functionTermsSnapshot) {
      this.functionTerms = top.functionTermsSnapshot;
    }
    if (top.oppositeSignPairsSnapshot) {
      this.oppositeSignPairs = top.oppositeSignPairsSnapshot;
    }

    for (const oracle of this.oracles.values()) {
      if (oracle.popLevel) {
        oracle.popLevel();
      } else {
        for (const id of top.literalIds) {
          oracle.retractLiteral(id);
        }
      }
      this.dirtyOracles.add(oracle.name);
    }
  }

  /**
   * Resets all registered oracles and internal equality graphs.
   */
  public reset(): void {
    this.activeLiterals.clear();
    this.knownEqualities.clear();
    this.varToId.clear();
    this.idToVar = [];
    this.parentMap.clear();
    this.canonicalBounds.clear();
    this.canonicalBoundJustifications.clear();
    this.varSubscribers.clear();
    this.canonSubscribers.clear();
    this.domainSubscribers.clear();
    this.dirtyOracles.clear();
    this.worklist = [];
    this.memoizedResult = undefined;
    this.infeasibleConflict = undefined;
    this.functionTerms = [];
    this.oppositeSignPairs.clear();
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
    const cleanName = varName.startsWith("-") ? varName.slice(1) : varName;
    const canon = this.getCanonicalVar(cleanName);
    const canonSubs = this.canonSubscribers.get(canon);
    if (canonSubs && canonSubs.has(oracle)) return true;

    const directSubs = this.varSubscribers.get(cleanName) ?? this.varSubscribers.get(varName);
    if (directSubs && directSubs.has(oracle)) return true;

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

  private getVarId(name: string): number {
    let id = this.varToId.get(name);
    if (id === undefined) {
      id = this.idToVar.length;
      this.varToId.set(name, id);
      this.idToVar.push(name);
    }
    return id;
  }

  /**
   * Generates a canonical packed 64-bit equality key for undirected pairs: (min, max).
   * High 32 bits: min(idA, idB), Low 32 bits: max(idA, idB).
   */
  private makeEqualityKey(varA: string, varB: string): bigint {
    const idA = this.getVarId(varA);
    const idB = this.getVarId(varB);
    const min = idA < idB ? idA : idB;
    const max = idA < idB ? idB : idA;
    return (BigInt(min) << 32n) | BigInt(max);
  }

  /**
   * Checks whether the optional cancellation token or `AbortSignal` has been triggered.
   */
  private isCancelled(token?: CancellationTokenLike): boolean {
    if (!token) return false;
    if ("isCancellationRequested" in token && Boolean((token as any).isCancellationRequested)) {
      return true;
    }
    if ("aborted" in token && Boolean((token as any).aborted)) {
      return true;
    }
    return false;
  }

  /**
   * Evaluates congruence closure over uninterpreted / surrogate function applications:
   *   x_i == y_i for all i  ==>  f(x_1, ..., x_k) == f(y_1, ..., y_k)
   * Enqueues newly discovered equality events between the result variables.
   */
  public checkCongruenceClosure(): number {
    let deducedCount = 0;
    const sigMap = new Map<string, FunctionApplicationTerm[]>();

    for (const term of this.functionTerms) {
      const canonArgs = term.args.map((a) => this.getCanonicalVar(a)).join(",");
      const sig = `${term.functionName}(${canonArgs})`;
      if (!sigMap.has(sig)) {
        sigMap.set(sig, []);
      }
      const list = sigMap.get(sig)!;
      for (const existing of list) {
        const rootA = this.getCanonicalVar(existing.resultVar);
        const rootB = this.getCanonicalVar(term.resultVar);
        if (rootA !== rootB) {
          const key = this.makeEqualityKey(existing.resultVar, term.resultVar);
          if (!this.knownEqualities.has(key)) {
            deducedCount++;
            const combinedJusts = [existing.literalId, term.literalId];
            this.enqueueEvent({
              kind: "equality",
              varA: existing.resultVar,
              varB: term.resultVar,
              domain: "real",
              theoryDomain: "algebraic",
              explanation: `Congruence closure: ${existing.functionName}(${existing.args.join(", ")}) == ${term.functionName}(${term.args.join(", ")}) implies ${existing.resultVar} == ${term.resultVar}.`,
              sourceOracle: "CongruenceClosure",
              justification: combinedJusts,
            });
          }
        }
      }
      list.push(term);
    }

    return deducedCount;
  }

  /**
   * Drains the coordinator worklist, tightening bounds, performing core interval inversion checks,
   * and selectively notifying subscribed oracles.
   */
  private drainWorklist(
    iteration: number,
    startTime: number,
  ): { unsat?: CoordinatorSatResult | undefined; eventsProcessed: number } {
    let eventsProcessed = 0;
    const isTargetedByDomain = (oracle: TheoryOracle, ev: PropagationEvent): boolean => {
      if (ev.kind === "bound") {
        return (
          oracle.name === "ConstraintTheoryOracle" ||
          oracle.name === "SpatialPhysicsOracle" ||
          oracle.name === "ToleranceStackOracle"
        );
      }
      return oracle.name === "ConstraintTheoryOracle" || (ev.theoryDomain ? oracle.domain === ev.theoryDomain : false);
    };

    while (this.worklist.length > 0) {
      const event = this.worklist.shift()!;
      if (event.kind === "equality") {
        const key = this.makeEqualityKey(event.varA, event.varB);
        const existing = this.knownEqualities.get(key);
        let isNewOrTightened = false;

        // Check for opposite-sign Kirchhoff flow conservation relation (e.g. portA.m_flow == -portB.m_flow)
        const isOppositeSign = event.varA.startsWith("-") !== event.varB.startsWith("-");
        if (isOppositeSign) {
          const cleanA = event.varA.startsWith("-") ? event.varA.slice(1) : event.varA;
          const cleanB = event.varB.startsWith("-") ? event.varB.slice(1) : event.varB;
          const justs = event.justification ?? [];
          this.registerOppositeSignPair(cleanA, cleanB, justs);

          const rootA = this.getCanonicalVar(cleanA);
          const rootB = this.getCanonicalVar(cleanB);

          if (justs.length > 0) {
            if (!this.canonicalBoundJustifications.has(rootA)) {
              this.canonicalBoundJustifications.set(rootA, new Set());
            }
            if (!this.canonicalBoundJustifications.has(rootB)) {
              this.canonicalBoundJustifications.set(rootB, new Set());
            }
            const jA = this.canonicalBoundJustifications.get(rootA)!;
            const jB = this.canonicalBoundJustifications.get(rootB)!;
            for (const id of justs) {
              jA.add(id);
              jB.add(id);
            }
          }

          const bA = this.canonicalBounds.get(rootA);
          const bB = this.canonicalBounds.get(rootB);

          // Mirror bounds: vA = -vB => vA in [-hiB, -loB] and vB in [-hiA, -loA]
          if (bA || bB) {
            const loA = Math.max(bA ? bA[0] : -Infinity, bB ? -bB[1] : -Infinity);
            const hiA = Math.min(bA ? bA[1] : Infinity, bB ? -bB[0] : Infinity);
            const loB = Math.max(bB ? bB[0] : -Infinity, bA ? -bA[1] : -Infinity);
            const hiB = Math.min(bB ? bB[1] : Infinity, bA ? -bA[0] : Infinity);

            const combinedJusts = new Set<number>(justs);
            const jSetA = this.canonicalBoundJustifications.get(rootA);
            const jSetB = this.canonicalBoundJustifications.get(rootB);
            if (jSetA) for (const id of jSetA) combinedJusts.add(id);
            if (jSetB) for (const id of jSetB) combinedJusts.add(id);
            const allJustsArr = Array.from(combinedJusts);

            if (loA > hiA + 1e-9) {
              return {
                unsat: {
                  status: "UNSAT",
                  isSat: false,
                  conflict: this.makeBoundInversionConflict(cleanA, loA, hiA, allJustsArr, [
                    cleanA,
                    cleanB,
                    rootA,
                    rootB,
                  ]),
                  sharedEqualities: Array.from(this.knownEqualities.values()),
                  iterations: iteration,
                  durationMs: performance.now() - startTime,
                },
                eventsProcessed,
              };
            }
            if (loB > hiB + 1e-9) {
              return {
                unsat: {
                  status: "UNSAT",
                  isSat: false,
                  conflict: this.makeBoundInversionConflict(cleanB, loB, hiB, allJustsArr, [
                    cleanA,
                    cleanB,
                    rootA,
                    rootB,
                  ]),
                  sharedEqualities: Array.from(this.knownEqualities.values()),
                  iterations: iteration,
                  durationMs: performance.now() - startTime,
                },
                eventsProcessed,
              };
            }

            if (!bA || loA > bA[0] + 1e-9 || hiA < bA[1] - 1e-9) {
              this.canonicalBounds.set(rootA, [loA, hiA]);
              if (jSetB) {
                if (!this.canonicalBoundJustifications.has(rootA)) {
                  this.canonicalBoundJustifications.set(rootA, new Set());
                }
                for (const id of jSetB) this.canonicalBoundJustifications.get(rootA)!.add(id);
              }
              isNewOrTightened = true;
            }
            if (!bB || loB > bB[0] + 1e-9 || hiB < bB[1] - 1e-9) {
              this.canonicalBounds.set(rootB, [loB, hiB]);
              if (jSetA) {
                if (!this.canonicalBoundJustifications.has(rootB)) {
                  this.canonicalBoundJustifications.set(rootB, new Set());
                }
                for (const id of jSetA) this.canonicalBoundJustifications.get(rootB)!.add(id);
              }
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
              bounds: event.bounds,
              explanation: event.explanation,
              sourceOracle: event.sourceOracle,
              justifications: justs,
              justification: justs,
            };
            this.knownEqualities.set(key, eqToBroadcast);
            if (this.levelStack.length > 0) {
              this.levelStack[this.levelStack.length - 1]!.equalityKeys.push(key);
            }
          }

          if (isNewOrTightened && eqToBroadcast) {
            eventsProcessed++;
            for (const oracle of this.oracles.values()) {
              if (oracle.name === event.sourceOracle) continue;
              const isSubscribed =
                this.isSubscribedToVar(oracle, cleanA) ||
                this.isSubscribedToVar(oracle, cleanB) ||
                (event.theoryDomain ? this.isSubscribedToDomain(oracle, event.theoryDomain) : false);
              if (isSubscribed || isTargetedByDomain(oracle, event)) {
                oracle.onSharedEquality(eqToBroadcast);
                this.dirtyOracles.add(oracle.name);
              }
            }
          }
          continue;
        }

        const canonRoot = this.unionVars(event.varA, event.varB);
        if (this.infeasibleConflict) {
          if (event.justification) {
            const extraLits = this.resolveJustificationLiterals(event.justification);
            for (const lit of extraLits) {
              if (!this.infeasibleConflict.literals.some((l) => l.id === lit.id)) {
                this.infeasibleConflict.literals.push(lit);
              }
            }
          }
          return {
            unsat: {
              status: "UNSAT",
              isSat: false,
              conflict: this.infeasibleConflict,
              sharedEqualities: Array.from(this.knownEqualities.values()),
              iterations: iteration,
              durationMs: performance.now() - startTime,
            },
            eventsProcessed,
          };
        }

        const currentBound = this.canonicalBounds.get(canonRoot);

        if (event.justification && event.justification.length > 0) {
          if (!this.canonicalBoundJustifications.has(canonRoot)) {
            this.canonicalBoundJustifications.set(canonRoot, new Set());
          }
          const jSet = this.canonicalBoundJustifications.get(canonRoot)!;
          for (const id of event.justification) jSet.add(id);
        }

        if (event.bounds) {
          const lo = Math.max(currentBound ? currentBound[0] : -Infinity, event.bounds[0]);
          const hi = Math.min(currentBound ? currentBound[1] : Infinity, event.bounds[1]);
          if (lo > hi + 1e-9) {
            const allJustifications = this.canonicalBoundJustifications.get(canonRoot)
              ? Array.from(this.canonicalBoundJustifications.get(canonRoot)!)
              : event.justification
                ? [...event.justification]
                : [];
            return {
              unsat: {
                status: "UNSAT",
                isSat: false,
                conflict: this.makeBoundInversionConflict(canonRoot, lo, hi, allJustifications, [
                  canonRoot,
                  event.varA,
                  event.varB,
                ]),
                sharedEqualities: Array.from(this.knownEqualities.values()),
                iterations: iteration,
                durationMs: performance.now() - startTime,
              },
              eventsProcessed,
            };
          }
          // Guard against micro-contractions (Zeno loop prevention) using 1e-9 tolerance
          if (!currentBound || lo > currentBound[0] + 1e-9 || hi < currentBound[1] - 1e-9) {
            this.canonicalBounds.set(canonRoot, [lo, hi]);
            isNewOrTightened = true;
          }
        }

        const allJustifications = this.canonicalBoundJustifications.get(canonRoot)
          ? Array.from(this.canonicalBoundJustifications.get(canonRoot)!)
          : event.justification
            ? [...event.justification]
            : [];

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
            justifications: allJustifications,
            justification: allJustifications,
          };
          this.knownEqualities.set(key, eqToBroadcast);
          if (this.levelStack.length > 0) {
            this.levelStack[this.levelStack.length - 1]!.equalityKeys.push(key);
          }
        } else if (isNewOrTightened && event.bounds) {
          existing.bounds = [...event.bounds];
          existing.sourceOracle = event.sourceOracle;
          existing.justifications = allJustifications;
          existing.justification = allJustifications;
          eqToBroadcast = { ...existing };
        }

        if (isNewOrTightened && eqToBroadcast) {
          eventsProcessed++;
          for (const oracle of this.oracles.values()) {
            if (oracle.name === event.sourceOracle) continue;
            const isSubscribed =
              this.isSubscribedToVar(oracle, event.varA) ||
              this.isSubscribedToVar(oracle, event.varB) ||
              (event.theoryDomain ? this.isSubscribedToDomain(oracle, event.theoryDomain) : false);
            if (isSubscribed || isTargetedByDomain(oracle, event)) {
              oracle.onSharedEquality(eqToBroadcast);
              this.dirtyOracles.add(oracle.name);
            }
          }
        }
      } else if (event.kind === "bound") {
        const canonRoot = this.getCanonicalVar(event.varName);
        const currentBound = this.canonicalBounds.get(canonRoot);

        if (event.justification && event.justification.length > 0) {
          if (!this.canonicalBoundJustifications.has(canonRoot)) {
            this.canonicalBoundJustifications.set(canonRoot, new Set());
          }
          const jSet = this.canonicalBoundJustifications.get(canonRoot)!;
          for (const id of event.justification) jSet.add(id);
        }

        const lo = Math.max(currentBound ? currentBound[0] : -Infinity, event.bounds[0]);
        const hi = Math.min(currentBound ? currentBound[1] : Infinity, event.bounds[1]);

        if (lo > hi + 1e-9) {
          const allJustifications = this.canonicalBoundJustifications.get(canonRoot)
            ? Array.from(this.canonicalBoundJustifications.get(canonRoot)!)
            : event.justification
              ? [...event.justification]
              : [];
          return {
            unsat: {
              status: "UNSAT",
              isSat: false,
              conflict: this.makeBoundInversionConflict(event.varName, lo, hi, allJustifications, [
                canonRoot,
                event.varName,
              ]),
              sharedEqualities: Array.from(this.knownEqualities.values()),
              iterations: iteration,
              durationMs: performance.now() - startTime,
            },
            eventsProcessed,
          };
        }

        let isNewOrTightened = false;
        if (!currentBound || lo > currentBound[0] + 1e-9 || hi < currentBound[1] - 1e-9) {
          this.canonicalBounds.set(canonRoot, [lo, hi]);
          isNewOrTightened = true;
        }

        if (isNewOrTightened) {
          eventsProcessed++;
          const allJustifications = this.canonicalBoundJustifications.get(canonRoot)
            ? Array.from(this.canonicalBoundJustifications.get(canonRoot)!)
            : event.justification
              ? [...event.justification]
              : [];

          // Propagate negated bounds to any opposite-sign Kirchhoff flow partners
          const partners = this.oppositeSignPairs.get(event.varName) ?? this.oppositeSignPairs.get(canonRoot) ?? [];
          for (const { partner, justifications: pairJusts } of partners) {
            const mergedJusts = Array.from(new Set([...allJustifications, ...pairJusts]));
            this.enqueueEvent({
              kind: "bound",
              varName: partner,
              bounds: [-hi, -lo],
              theoryDomain: event.theoryDomain,
              explanation: `Kirchhoff opposite-sign flow bound from '${event.varName}' in [${lo}, ${hi}]`,
              sourceOracle: event.sourceOracle,
              justification: mergedJusts,
            });
          }

          const boundEq: SharedEquality = {
            varA: event.varName,
            varB: event.varName,
            domain: "interval",
            bounds: [lo, hi],
            explanation: event.explanation ?? `Contracted bound on '${event.varName}' to [${lo}, ${hi}]`,
            sourceOracle: event.sourceOracle,
            justifications: allJustifications,
            justification: allJustifications,
          };

          for (const oracle of this.oracles.values()) {
            if (oracle.name === event.sourceOracle) continue;
            const isSubscribed =
              this.isSubscribedToVar(oracle, event.varName) ||
              (event.theoryDomain ? this.isSubscribedToDomain(oracle, event.theoryDomain) : false);
            if (isSubscribed || isTargetedByDomain(oracle, event)) {
              oracle.onSharedEquality(boundEq);
              this.dirtyOracles.add(oracle.name);
            }
          }
        }
      }
    }
    return { eventsProcessed };
  }

  /**
   * Memoized query execution compatible with Salsa QueryEngine caching.
   */
  public querySat(revision = 0, cancellationToken?: CancellationTokenLike): CoordinatorSatResult {
    if (
      this.memoizedResult &&
      this.memoizedResult.revision === revision &&
      this.dirtyOracles.size === 0 &&
      this.worklist.length === 0 &&
      !this.infeasibleConflict
    ) {
      return this.memoizedResult.result;
    }
    const result = this.checkSat(50, cancellationToken);
    this.memoizedResult = { revision, result };
    return result;
  }

  /**
   * Executes the Nelson-Oppen Worklist-Driven Equality Exchange & Satisfiability Procedure.
   * Alternates between:
   *   1. Checking local satisfiability across dirty oracles only.
   *   2. Enqueueing newly propagated equalities and bound contractions into the worklist.
   *   3. Congruence closure deduction on uninterpreted function terms.
   *   4. Draining worklist by selectively notifying subscribed and cross-domain oracles.
   * Repeats until fixpoint (empty worklist and clean SAT oracles) or conflict.
   */
  public checkSat(maxIterations = 50, cancellationToken?: CancellationTokenLike): CoordinatorSatResult {
    const startTime = performance.now();
    let iteration = 0;

    if (this.isCancelled(cancellationToken)) {
      return {
        status: "UNKNOWN",
        isSat: false,
        reason: "Verification cancelled by client token.",
        sharedEqualities: Array.from(this.knownEqualities.values()),
        models: {},
        iterations: 0,
        durationMs: performance.now() - startTime,
      };
    }

    if (this.infeasibleConflict) {
      return {
        status: "UNSAT",
        isSat: false,
        conflict: this.infeasibleConflict,
        sharedEqualities: Array.from(this.knownEqualities.values()),
        iterations: 0,
        durationMs: performance.now() - startTime,
      };
    }

    if (this.dirtyOracles.size === 0) {
      for (const name of this.oracles.keys()) {
        this.dirtyOracles.add(name);
      }
    }

    while (iteration < maxIterations) {
      if (this.isCancelled(cancellationToken)) {
        return {
          status: "UNKNOWN",
          isSat: false,
          reason: "Verification cancelled by client token.",
          sharedEqualities: Array.from(this.knownEqualities.values()),
          models: {},
          iterations: iteration,
          durationMs: performance.now() - startTime,
        };
      }

      iteration++;

      // Phase 1: Drain pending events (eager bound tightening, core inversion check, and subscriber notifications)
      const drain1 = this.drainWorklist(iteration, startTime);
      if (drain1.unsat) return drain1.unsat;
      let totalEvents = drain1.eventsProcessed;

      // Phase 1.5: Congruence closure deduction across functional terms
      const congDeductions = this.checkCongruenceClosure();
      totalEvents += congDeductions;
      if (congDeductions > 0) {
        const drain2 = this.drainWorklist(iteration, startTime);
        if (drain2.unsat) return drain2.unsat;
        totalEvents += drain2.eventsProcessed;
      }

      // Phase 2: Local oracle satisfiability check on dirty oracles only
      const checkingOracles = Array.from(this.dirtyOracles);
      for (const oracleName of checkingOracles) {
        const oracle = this.oracles.get(oracleName);
        if (!oracle) continue;
        const res = oracle.checkSat();
        if (!res.isSat) {
          return {
            status: "UNSAT",
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

      // Phase 3: Collect newly propagated equalities from checked oracles only and populate worklist
      for (const oracleName of checkingOracles) {
        const oracle = this.oracles.get(oracleName);
        if (!oracle) continue;
        const props = oracle.propagateEqualities();
        for (const eq of props) {
          const justs = eq.justifications ?? (eq as any).justification ?? [];
          this.enqueueEvent({
            kind: "equality",
            varA: eq.varA,
            varB: eq.varB,
            domain: eq.domain,
            theoryDomain: oracle.domain,
            bounds: eq.bounds,
            explanation: eq.explanation,
            sourceOracle: eq.sourceOracle ?? oracle.name,
            justification: justs,
          });
        }
      }

      // Phase 4: Fixed point check — no dirty oracles, no worklist events, and no new congruence deductions
      if (this.dirtyOracles.size === 0 && totalEvents === 0 && this.worklist.length === 0) {
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

    const isFixedPoint = this.dirtyOracles.size === 0 && this.worklist.length === 0;

    if (!isFixedPoint && iteration >= maxIterations) {
      return {
        status: "UNKNOWN",
        isSat: false,
        reason: `Contraction iteration limit (${maxIterations}) reached without achieving fixpoint.`,
        sharedEqualities: Array.from(this.knownEqualities.values()),
        models: combinedModels,
        iterations: iteration,
        durationMs: performance.now() - startTime,
      };
    }

    return {
      status: "SAT",
      isSat: true,
      sharedEqualities: Array.from(this.knownEqualities.values()),
      models: combinedModels,
      iterations: iteration,
      durationMs: performance.now() - startTime,
    };
  }
}
