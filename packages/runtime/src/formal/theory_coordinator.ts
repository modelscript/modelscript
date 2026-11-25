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
  { isCancellationRequested?: boolean | undefined; aborted?: boolean | undefined } | AbortSignal;

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
  args: unknown[];
  isNegated?: boolean | undefined;
  domain?: TheoryDomain | undefined;
  sourceContext?: unknown;
  /** Optional partitioned 32-bit `SymbolId` identifying the source model element that asserted this literal. */
  originSymbolId?: number | undefined;
}

/**
 * Equality or interval bound relation exchanged between theory oracles via the Nelson-Oppen bus.
 */
export interface SharedEquality {
  varA: string;
  varB: string;
  domain: "discrete" | "real" | "interval" | "spatial" | "concept";
  bounds?: [number, number] | undefined;
  /** Optional open-endpoint flags `[loOpen, hiOpen]` for strict inequalities (`>` / `<`). */
  strict?: [boolean, boolean] | undefined;
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
  /** Optional partitioned 32-bit `SymbolId`s of the conflicting model elements for cross-language causal traces. */
  culpritSymbolIds?: number[] | undefined;
}

/**
 * Result of a coordinated multi-theory satisfiability and equality-propagation fixpoint check.
 */
export interface CoordinatorSatResult {
  status: "SAT" | "UNSAT" | "UNKNOWN";
  isSat: boolean;
  conflict?: ConflictClause | undefined;
  sharedEqualities: SharedEquality[];
  models?: Record<string, unknown> | undefined;
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
      strict?: [boolean, boolean] | undefined;
      explanation?: string | undefined;
      sourceOracle: string;
      justification?: number[] | undefined;
    }
  | {
      kind: "bound";
      varName: string;
      theoryDomain?: TheoryDomain | undefined;
      bounds: [number, number];
      strict?: [boolean, boolean] | undefined;
      explanation?: string | undefined;
      sourceOracle: string;
      justification?: number[] | undefined;
    }
  | {
      kind: "disequality";
      varA: string;
      varB: string;
      theoryDomain?: TheoryDomain | undefined;
      explanation?: string | undefined;
      sourceOracle: string;
      justification?: number[] | undefined;
    };

/**
 * Variable-to-variable disequality (`varA != varB`) exchanged between theory oracles.
 */
export interface SharedDisequality {
  varA: string;
  varB: string;
  explanation?: string | undefined;
  sourceOracle?: string | undefined;
  justifications?: number[] | undefined;
}

/**
 * Finite-domain cardinality constraint (`|{vars}| <= maxCardinality`) for Polite/Shiny theory combination.
 */
export interface FiniteDomainConstraint {
  vars: string[];
  maxCardinality: number;
  sourceOracle?: string | undefined;
  justifications?: number[] | undefined;
}

/**
 * Non-convex equality disjunction `(varA_1 = varB_1) \/ ... \/ (varA_k = varB_k)` emitted for CDCL(T) splitting.
 */
export interface EqualityDisjunction {
  disjuncts: [string, string][];
  explanation?: string | undefined;
  sourceOracle?: string | undefined;
  justifications?: number[] | undefined;
}

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
  /** Optional variable-to-variable disequality propagation (`x != y`). */
  propagateDisequalities?(): SharedDisequality[];
  /** Optional handler for disequalities deduced by other theories. */
  onSharedDisequality?(diseq: SharedDisequality): void;
  /** Optional non-convex equality disjunction propagation for CDCL(T) case splitting. */
  propagateEqualityDisjunctions?(): EqualityDisjunction[];
  /** Optional finite-domain cardinality constraints for Polite/Shiny Nelson-Oppen combination. */
  getFiniteDomainConstraints?(): FiniteDomainConstraint[];
  onSharedEquality(eq: SharedEquality): void;
  pushLevel?(): void;
  popLevel?(): void;
  reset(): void;
  getModel?(): Record<string, unknown>;
}

/**
 * Central Nelson-Oppen and CDCL(T) theory coordinator that synchronizes variable equivalence classes,
 * interval bounds, disequalities, incremental congruence closure, finite-domain cardinality,
 * and conflict clauses across heterogeneous engineering theory oracles.
 */
export class SemanticTheoryCoordinator {
  /** Registered theory oracles keyed by oracle name. */
  private oracles = new Map<string, TheoryOracle>();
  /** Currently asserted theory literals keyed by literal ID. */
  private activeLiterals = new Map<number, TheoryLiteral>();
  /** Deduplicated shared equalities exchanged between oracles, keyed by packed 64-bit pair ID. */
  private knownEqualities = new Map<bigint, SharedEquality>();
  /** Deduplicated shared disequalities (`varA != varB`), keyed by packed 64-bit pair ID. */
  private knownDisequalities = new Map<bigint, SharedDisequality>();
  /** Interned variable names to 32-bit IDs for packed 64-bit equality keys. */
  private varToId = new Map<string, number>();
  private idToVar: string[] = [];
  /** Union-Find parent map for variable equivalence classes. */
  private parentMap = new Map<string, string>();
  /** Union-Find rank map for union-by-rank balancing. */
  private parentRank = new Map<string, number>();
  /** Spanning-forest proof graph tracking exact justifications for Union-Find merges. */
  private equalityProofGraph = new Map<string, { neighbor: string; justs: number[] }[]>();
  /** Tightest intersected interval `[low, high]` for each canonical variable representative. */
  private canonicalBounds = new Map<string, [number, number]>();
  /** Open-endpoint flags `[loOpen, hiOpen]` for strict inequalities on each canonical variable. */
  private canonicalBoundStrict = new Map<string, [boolean, boolean]>();
  /** Disallowed point values (`x != val`) per canonical variable, mapping forbidden value -> justification literal IDs. */
  private disallowedValues = new Map<string, Map<number, number[]>>();
  /** Set of literal IDs justifying the current interval bounds of each canonical variable. */
  private canonicalBoundJustifications = new Map<string, Set<number>>();
  /** Oracles subscribed to updates on a specific raw variable name. */
  private varSubscribers = new Map<string, Set<TheoryOracle>>();
  /** Oracles subscribed to updates on a canonical variable equivalence class. */
  private canonSubscribers = new Map<string, Set<TheoryOracle>>();
  /** Oracles subscribed to all events within a specific `TheoryDomain`. */
  private domainSubscribers = new Map<TheoryDomain, Set<TheoryOracle>>();
  /** Theory domains referencing each variable (for shared interface-variable detection). */
  private varDomains = new Map<string, Set<TheoryDomain>>();
  /** Oracles that directly received a literal or a shared event justified by it (for incremental retraction). */
  private literalAffectedOracles = new Map<number, Set<string>>();
  /** Set of oracle names whose state has changed since the last `checkSat` pass. */
  private dirtyOracles = new Set<string>();
  /** Pending equality, bound, and disequality propagation events awaiting dispatch. */
  private worklist: PropagationEvent[] = [];
  /** Cached satisfiability result for the current state revision. */
  private memoizedResult?: { revision: number; result: CoordinatorSatResult } | undefined;
  /** Immediate bound-inversion or equality/disequality conflict detected during eager propagation. */
  private infeasibleConflict?: ConflictClause | undefined;
  /** Registered function application terms for incremental congruence closure deduction. */
  private functionTerms: FunctionApplicationTerm[] = [];
  /** Incremental congruence use-list: canonical arg root -> indices into `functionTerms`. */
  private termUseList = new Map<string, Set<number>>();
  /** Incremental congruence signature table: canonical signature -> representative term index. */
  private congruenceSigTable = new Map<string, number>();
  /** Indices of `functionTerms` whose argument equivalence classes changed since last congruence check. */
  private dirtyCongruenceTerms = new Set<number>();
  /** Opposite-sign flow conservation pairings (vA = -vB) keyed by canonical variable root. */
  private oppositeSignPairs = new Map<string, { partner: string; justifications: number[] }[]>();
  /** Undo trail of lightweight O(1) rollback closures for pushed decision levels. */
  private undoTrail: (() => void)[] = [];
  /** O(1) backtracking frame stack storing trail marks and worklist/interning marks. */
  private levelStack: {
    literalIds: number[];
    trailMark: number;
    idToVarMark: number;
    worklistSnapshot: PropagationEvent[];
    infeasibleConflictSnapshot?: ConflictClause | undefined;
    purifyCounterSnapshot: number;
  }[] = [];
  /** Monotonically increasing counter for auto-assigned literal IDs. */
  private nextLitId = 1;
  /** Counter for fresh interface variables introduced during mixed-term purification. */
  private purifyCounter = 0;
  /**
   * When enabled (opt-in) and >= 2 oracles are registered, Phase 3 propagation suppresses
   * purely local equalities, bounds, and disequalities whose variables do not touch any
   * shared interface variable across theory domains.
   */
  private interfaceOnlyPropagation = false;

  constructor(options?: { interfaceOnlyPropagation?: boolean }) {
    if (options?.interfaceOnlyPropagation !== undefined) {
      this.interfaceOnlyPropagation = options.interfaceOnlyPropagation;
    }
  }

  /** Enable or disable interface-variable-only propagation filtering. */
  public setInterfaceOnlyPropagation(enabled: boolean): void {
    this.interfaceOnlyPropagation = enabled;
  }

  private trailMapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
    if (this.levelStack.length > 0) {
      const had = map.has(key);
      const prev = map.get(key);
      this.undoTrail.push(() => {
        if (had) map.set(key, prev as V);
        else map.delete(key);
      });
    }
    map.set(key, value);
  }

  private trailMapDelete<K, V>(map: Map<K, V>, key: K): void {
    if (!map.has(key)) return;
    if (this.levelStack.length > 0) {
      const prev = map.get(key) as V;
      this.undoTrail.push(() => {
        map.set(key, prev);
      });
    }
    map.delete(key);
  }

  private trailSetAdd<T>(set: Set<T>, value: T): void {
    if (set.has(value)) return;
    if (this.levelStack.length > 0) {
      this.undoTrail.push(() => {
        set.delete(value);
      });
    }
    set.add(value);
  }

  private trailSetDelete<T>(set: Set<T>, value: T): void {
    if (!set.has(value)) return;
    if (this.levelStack.length > 0) {
      this.undoTrail.push(() => {
        set.add(value);
      });
    }
    set.delete(value);
  }

  private trailArrayPush<T>(arr: T[], item: T): void {
    arr.push(item);
    if (this.levelStack.length > 0) {
      this.undoTrail.push(() => {
        arr.pop();
      });
    }
  }

  private markLiteralOracle(litId: number, oracleName: string): void {
    let set = this.literalAffectedOracles.get(litId);
    if (!set) {
      set = new Set();
      this.trailMapSet(this.literalAffectedOracles, litId, set);
    }
    this.trailSetAdd(set, oracleName);
  }

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
    let vSubs = this.varSubscribers.get(varName);
    if (!vSubs) {
      vSubs = new Set();
      this.trailMapSet(this.varSubscribers, varName, vSubs);
    }
    this.trailSetAdd(vSubs, oracle);

    const canon = this.getCanonicalVar(varName);
    let cSubs = this.canonSubscribers.get(canon);
    if (!cSubs) {
      cSubs = new Set();
      this.trailMapSet(this.canonSubscribers, canon, cSubs);
    }
    this.trailSetAdd(cSubs, oracle);
  }

  /**
   * Unsubscribes an oracle from a variable.
   */
  public unsubscribe(varName: string, oracle: TheoryOracle): void {
    const vSubs = this.varSubscribers.get(varName);
    if (vSubs) this.trailSetDelete(vSubs, oracle);
    const canon = this.getCanonicalVar(varName);
    const cSubs = this.canonSubscribers.get(canon);
    if (cSubs) this.trailSetDelete(cSubs, oracle);
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
   * Computes a scale-aware relative epsilon for comparing two finite numbers.
   */
  private relEps(a: number, b: number, factor = 1e-12): number {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return factor * Math.max(Math.abs(a), Math.abs(b));
  }

  /**
   * Checks whether an interval `[lo, hi]` with open-endpoint flags `[loOpen, hiOpen]` is empty.
   */
  private isEmptyBounds(lo: number, hi: number, loOpen = false, hiOpen = false): boolean {
    const eps = this.relEps(lo, hi, 1e-12);
    if (lo > hi + eps) return true;
    if ((loOpen || hiOpen) && Math.abs(lo - hi) <= eps) return true;
    return false;
  }

  /**
   * Checks whether `[newLo, newHi]` (with strictness) meaningfully tightens `[oldLo, oldHi]`.
   */
  private isTightenedBounds(
    newLo: number,
    newHi: number,
    oldLo: number,
    oldHi: number,
    newLoOpen = false,
    newHiOpen = false,
    oldLoOpen = false,
    oldHiOpen = false,
  ): boolean {
    const loEps = this.relEps(newLo, oldLo, 1e-9);
    const hiEps = this.relEps(newHi, oldHi, 1e-9);
    if (newLo > oldLo + loEps) return true;
    if (newHi < oldHi - hiEps) return true;
    if (newLoOpen && !oldLoOpen && Math.abs(newLo - oldLo) <= loEps) return true;
    if (newHiOpen && !oldHiOpen && Math.abs(newHi - oldHi) <= hiEps) return true;
    return false;
  }

  /**
   * Intersects two bounds with open-endpoint strictness flags.
   */
  private intersectBoundsWithStrict(
    aBounds: [number, number] | undefined,
    aStrict: [boolean, boolean] | undefined,
    bBounds: [number, number] | undefined,
    bStrict: [boolean, boolean] | undefined,
  ): { bounds: [number, number]; strict: [boolean, boolean] } {
    const aLo = aBounds ? aBounds[0] : -Infinity;
    const aHi = aBounds ? aBounds[1] : Infinity;
    const bLo = bBounds ? bBounds[0] : -Infinity;
    const bHi = bBounds ? bBounds[1] : Infinity;
    const aLoOpen = aStrict ? aStrict[0] : false;
    const aHiOpen = aStrict ? aStrict[1] : false;
    const bLoOpen = bStrict ? bStrict[0] : false;
    const bHiOpen = bStrict ? bStrict[1] : false;

    const loEps = this.relEps(aLo, bLo, 1e-12);
    let lo: number;
    let loOpen: boolean;
    if (bLo > aLo + loEps) {
      lo = bLo;
      loOpen = bLoOpen;
    } else if (aLo > bLo + loEps) {
      lo = aLo;
      loOpen = aLoOpen;
    } else {
      lo = Math.max(aLo, bLo);
      loOpen = aLoOpen || bLoOpen;
    }

    const hiEps = this.relEps(aHi, bHi, 1e-12);
    let hi: number;
    let hiOpen: boolean;
    if (bHi < aHi - hiEps) {
      hi = bHi;
      hiOpen = bHiOpen;
    } else if (aHi < bHi - hiEps) {
      hi = aHi;
      hiOpen = aHiOpen;
    } else {
      hi = Math.min(aHi, bHi);
      hiOpen = aHiOpen || bHiOpen;
    }

    return { bounds: [lo, hi], strict: [loOpen, hiOpen] };
  }

  /**
   * Registers a disallowed point value (`var != val`) on a canonical root and checks for point conflict.
   */
  private addDisallowedValue(
    canonRoot: string,
    val: number,
    justIds: number[],
    culprits: string[],
  ): ConflictClause | undefined {
    let map = this.disallowedValues.get(canonRoot);
    if (!map) {
      map = new Map();
      this.trailMapSet(this.disallowedValues, canonRoot, map);
    }
    const existing = map.get(val);
    if (existing) {
      for (const id of justIds) {
        if (!existing.includes(id)) this.trailArrayPush(existing, id);
      }
    } else {
      this.trailMapSet(map, val, [...justIds]);
    }
    return this.checkDisallowedConflict(canonRoot, culprits);
  }

  /**
   * Checks whether a canonical variable's tightened point interval collides with a disallowed value (`!=`).
   */
  private checkDisallowedConflict(canonRoot: string, culprits: string[]): ConflictClause | undefined {
    const b = this.canonicalBounds.get(canonRoot);
    if (!b) return undefined;
    const [lo, hi] = b;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
    const eps = this.relEps(lo, hi, 1e-12);
    if (Math.abs(lo - hi) > eps) return undefined;

    const disallowed = this.disallowedValues.get(canonRoot);
    if (!disallowed || disallowed.size === 0) return undefined;

    const pt = (lo + hi) * 0.5;
    for (const [forbVal, forbJusts] of disallowed.entries()) {
      if (Math.abs(pt - forbVal) <= this.relEps(pt, forbVal, 1e-12)) {
        const allJusts = new Set<number>(forbJusts);
        const bj = this.canonicalBoundJustifications.get(canonRoot);
        if (bj) for (const id of bj) allJusts.add(id);
        return {
          literals: this.resolveJustificationLiterals(Array.from(allJusts)),
          explanation: `Arithmetic Disequality Conflict: Variable '${canonRoot}' is constrained to ${pt} but must satisfy != ${forbVal}.`,
          culpritEntities: Array.from(new Set([canonRoot, ...culprits])),
          theoryName: "SemanticTheoryCoordinator",
        };
      }
    }
    return undefined;
  }

  /**
   * Records an undirected justification edge in the equality proof forest when merging distinct classes.
   */
  private recordEqualityProofEdge(a: string, b: string, justIds: number[]): void {
    if (a === b) return;
    const copy = [...justIds];
    let listA = this.equalityProofGraph.get(a);
    if (!listA) {
      listA = [];
      this.trailMapSet(this.equalityProofGraph, a, listA);
    }
    this.trailArrayPush(listA, { neighbor: b, justs: copy });

    let listB = this.equalityProofGraph.get(b);
    if (!listB) {
      listB = [];
      this.trailMapSet(this.equalityProofGraph, b, listB);
    }
    this.trailArrayPush(listB, { neighbor: a, justs: copy });
  }

  /**
   * Extracts the exact minimal set of justification literal IDs proving `a == b` in the equality proof forest.
   */
  public getEqualityProof(a: string, b: string): number[] {
    if (a === b) return [];
    if (this.getCanonicalVar(a) !== this.getCanonicalVar(b)) return [];

    const visited = new Set<string>([a]);
    const parent = new Map<string, { prev: string; justs: number[] }>();
    const queue: string[] = [a];
    let head = 0;

    while (head < queue.length) {
      const curr = queue[head++]!;
      if (curr === b) {
        const result = new Set<number>();
        let node = b;
        while (node !== a) {
          const step = parent.get(node);
          if (!step) break;
          for (const id of step.justs) result.add(id);
          node = step.prev;
        }
        return Array.from(result);
      }
      const edges = this.equalityProofGraph.get(curr);
      if (!edges) continue;
      for (const edge of edges) {
        if (!visited.has(edge.neighbor)) {
          visited.add(edge.neighbor);
          parent.set(edge.neighbor, { prev: curr, justs: edge.justs });
          queue.push(edge.neighbor);
        }
      }
    }
    return [];
  }

  /**
   * Constructs a `ConflictClause` when interval bound intersection yields an empty interval (`lo > hi` or strict collision).
   */
  private makeBoundInversionConflict(
    culpritVar: string,
    lo: number,
    hi: number,
    justIds: number[],
    culprits: string[] = [culpritVar],
    strict?: [boolean, boolean],
  ): ConflictClause {
    const lits = this.resolveJustificationLiterals(justIds);
    const strictNote =
      strict && (strict[0] || strict[1]) && Math.abs(lo - hi) <= this.relEps(lo, hi, 1e-12)
        ? ` (strict inequality conflict at ${lo})`
        : "";
    return {
      literals: lits,
      explanation: `Arithmetic Bound Conflict: Immediate interval contradiction on '${culpritVar}': lower bound ${lo} exceeds upper bound ${hi}${strictNote}.`,
      culpritEntities: Array.from(new Set(culprits)),
      theoryName: "SemanticTheoryCoordinator",
    };
  }

  /**
   * Resolves the canonical representative for a variable.
   * Uses a zero-allocation fast path for roots and an iterative two-pass disjoint-set find with cycle guard.
   */
  public getCanonicalVar(v: string): string {
    const directParent = this.parentMap.get(v);
    if (!directParent || directParent === v) {
      return v;
    }
    const grandParent = this.parentMap.get(directParent);
    if (!grandParent || grandParent === directParent) {
      return directParent;
    }

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
      if (this.parentMap.get(node) !== root) {
        this.trailMapSet(this.parentMap, node, root);
      }
    }
    return root;
  }

  /**
   * Merges equivalence classes of two variables using union-by-rank, records proof-forest edges,
   * checks variable disequalities (`x != y`), migrates incremental congruence use-lists,
   * and intersects bounds, strictness flags, disallowed values, and opposite-sign pairs.
   */
  private unionVars(a: string, b: string, justIds: number[] = []): string {
    const aIsNum = a.trim() !== "" && !isNaN(Number(a));
    const bIsNum = b.trim() !== "" && !isNaN(Number(b));
    if (aIsNum && bIsNum) {
      const nA = Number(a);
      const nB = Number(b);
      if (Math.abs(nA - nB) > this.relEps(nA, nB, 1e-12)) {
        this.infeasibleConflict = {
          literals: this.resolveJustificationLiterals(justIds),
          explanation: `Arithmetic Bound Conflict: Conflicting constant equality '${a}' == '${b}' (${nA} != ${nB}).`,
          culpritEntities: Array.from(new Set([a, b])),
          theoryName: "SemanticTheoryCoordinator",
        };
      }
      return a;
    }
    if (bIsNum && !aIsNum) {
      const rootA = this.getCanonicalVar(a);
      const val = Number(b);
      const merged = this.intersectBoundsWithStrict(
        this.canonicalBounds.get(rootA),
        this.canonicalBoundStrict.get(rootA),
        [val, val],
        [false, false],
      );
      this.trailMapSet(this.canonicalBounds, rootA, merged.bounds);
      this.trailMapSet(this.canonicalBoundStrict, rootA, merged.strict);
      if (this.isEmptyBounds(merged.bounds[0], merged.bounds[1], merged.strict[0], merged.strict[1])) {
        const jA = this.canonicalBoundJustifications.get(rootA);
        const allJusts = new Set<number>(justIds);
        if (jA) for (const id of jA) allJusts.add(id);
        this.infeasibleConflict = this.makeBoundInversionConflict(
          rootA,
          merged.bounds[0],
          merged.bounds[1],
          Array.from(allJusts),
          [rootA, a],
          merged.strict,
        );
      } else {
        const disConflict = this.checkDisallowedConflict(rootA, [rootA, a]);
        if (disConflict) this.infeasibleConflict = disConflict;
      }
      return rootA;
    }
    if (aIsNum && !bIsNum) {
      const rootB = this.getCanonicalVar(b);
      const val = Number(a);
      const merged = this.intersectBoundsWithStrict(
        this.canonicalBounds.get(rootB),
        this.canonicalBoundStrict.get(rootB),
        [val, val],
        [false, false],
      );
      this.trailMapSet(this.canonicalBounds, rootB, merged.bounds);
      this.trailMapSet(this.canonicalBoundStrict, rootB, merged.strict);
      if (this.isEmptyBounds(merged.bounds[0], merged.bounds[1], merged.strict[0], merged.strict[1])) {
        const jB = this.canonicalBoundJustifications.get(rootB);
        const allJusts = new Set<number>(justIds);
        if (jB) for (const id of jB) allJusts.add(id);
        this.infeasibleConflict = this.makeBoundInversionConflict(
          rootB,
          merged.bounds[0],
          merged.bounds[1],
          Array.from(allJusts),
          [rootB, b],
          merged.strict,
        );
      } else {
        const disConflict = this.checkDisallowedConflict(rootB, [rootB, b]);
        if (disConflict) this.infeasibleConflict = disConflict;
      }
      return rootB;
    }

    const rootA = this.getCanonicalVar(a);
    const rootB = this.getCanonicalVar(b);
    if (rootA !== rootB) {
      const rankA = this.parentRank.get(rootA) ?? 0;
      const rankB = this.parentRank.get(rootB) ?? 0;
      let childRoot: string;
      let newRoot: string;
      if (rankA > rankB) {
        childRoot = rootB;
        newRoot = rootA;
      } else {
        childRoot = rootA;
        newRoot = rootB;
        if (rankA === rankB) {
          this.trailMapSet(this.parentRank, newRoot, rankB + 1);
        }
      }

      this.trailMapSet(this.parentMap, childRoot, newRoot);
      this.recordEqualityProofEdge(a, b, justIds);

      // Check variable-to-variable disequalities (`x != y`)
      if (!this.infeasibleConflict && this.knownDisequalities.size > 0) {
        for (const diseq of this.knownDisequalities.values()) {
          if (this.getCanonicalVar(diseq.varA) === this.getCanonicalVar(diseq.varB)) {
            const allJusts = new Set<number>(justIds);
            for (const id of diseq.justifications ?? []) allJusts.add(id);
            for (const id of this.getEqualityProof(diseq.varA, diseq.varB)) allJusts.add(id);
            this.infeasibleConflict = {
              literals: this.resolveJustificationLiterals(Array.from(allJusts)),
              explanation: `Disequality Conflict: Variables '${diseq.varA}' and '${diseq.varB}' are declared disequal (${diseq.explanation ?? "!="}) but inferred equal.`,
              culpritEntities: Array.from(new Set([diseq.varA, diseq.varB, a, b])),
              theoryName: "SemanticTheoryCoordinator",
            };
            break;
          }
        }
      }

      // Migrate incremental congruence closure use-list from childRoot -> newRoot
      const childUses = this.termUseList.get(childRoot);
      if (childUses && childUses.size > 0) {
        let newUses = this.termUseList.get(newRoot);
        if (!newUses) {
          newUses = new Set();
          this.trailMapSet(this.termUseList, newRoot, newUses);
        }
        for (const termIdx of childUses) {
          this.trailSetAdd(newUses, termIdx);
          this.trailSetAdd(this.dirtyCongruenceTerms, termIdx);
        }
        this.trailMapDelete(this.termUseList, childRoot);
      }

      const bChild = this.canonicalBounds.get(childRoot);
      const bNew = this.canonicalBounds.get(newRoot);
      if (bChild || bNew) {
        const merged = this.intersectBoundsWithStrict(
          bChild,
          this.canonicalBoundStrict.get(childRoot),
          bNew,
          this.canonicalBoundStrict.get(newRoot),
        );
        this.trailMapSet(this.canonicalBounds, newRoot, merged.bounds);
        this.trailMapSet(this.canonicalBoundStrict, newRoot, merged.strict);
        this.trailMapDelete(this.canonicalBounds, childRoot);
        this.trailMapDelete(this.canonicalBoundStrict, childRoot);
        if (this.isEmptyBounds(merged.bounds[0], merged.bounds[1], merged.strict[0], merged.strict[1])) {
          const allJusts = new Set<number>(justIds);
          const jChild = this.canonicalBoundJustifications.get(childRoot);
          const jNew = this.canonicalBoundJustifications.get(newRoot);
          if (jChild) for (const id of jChild) allJusts.add(id);
          if (jNew) for (const id of jNew) allJusts.add(id);
          this.infeasibleConflict = this.makeBoundInversionConflict(
            newRoot,
            merged.bounds[0],
            merged.bounds[1],
            Array.from(allJusts),
            [rootA, rootB, a, b],
            merged.strict,
          );
        }
      }

      // Merge justifications
      const jChild = this.canonicalBoundJustifications.get(childRoot);
      if (jChild && jChild.size > 0) {
        let setNew = this.canonicalBoundJustifications.get(newRoot);
        if (!setNew) {
          setNew = new Set();
          this.trailMapSet(this.canonicalBoundJustifications, newRoot, setNew);
        }
        for (const id of jChild) this.trailSetAdd(setNew, id);
      }

      // Merge disallowed point values (`!=`)
      const disChild = this.disallowedValues.get(childRoot);
      if (disChild && disChild.size > 0) {
        let disNew = this.disallowedValues.get(newRoot);
        if (!disNew) {
          disNew = new Map();
          this.trailMapSet(this.disallowedValues, newRoot, disNew);
        }
        for (const [val, jList] of disChild.entries()) {
          const existing = disNew.get(val);
          if (existing) {
            for (const id of jList) if (!existing.includes(id)) this.trailArrayPush(existing, id);
          } else {
            this.trailMapSet(disNew, val, [...jList]);
          }
        }
      }
      if (!this.infeasibleConflict) {
        const disConflict = this.checkDisallowedConflict(newRoot, [rootA, rootB, a, b]);
        if (disConflict) this.infeasibleConflict = disConflict;
      }

      // Merge canonical subscribers
      const subsChild = this.canonSubscribers.get(childRoot);
      if (subsChild && subsChild.size > 0) {
        let subsNew = this.canonSubscribers.get(newRoot);
        if (!subsNew) {
          subsNew = new Set();
          this.trailMapSet(this.canonSubscribers, newRoot, subsNew);
        }
        for (const oracle of subsChild) {
          this.trailSetAdd(subsNew, oracle);
        }
      }

      // Merge opposite-sign pairs so bounds on either member propagate to all opposite-sign partners
      const ospChild = this.oppositeSignPairs.get(childRoot);
      if (ospChild && ospChild.length > 0) {
        let ospNew = this.oppositeSignPairs.get(newRoot);
        if (!ospNew) {
          ospNew = [];
          this.trailMapSet(this.oppositeSignPairs, newRoot, ospNew);
        }
        for (const item of ospChild) {
          const existing = ospNew.find((x) => this.getCanonicalVar(x.partner) === this.getCanonicalVar(item.partner));
          if (existing) {
            for (const j of item.justifications) {
              if (!existing.justifications.includes(j)) this.trailArrayPush(existing.justifications, j);
            }
          } else {
            this.trailArrayPush(ospNew, { partner: item.partner, justifications: [...item.justifications] });
          }
        }
        this.trailMapDelete(this.oppositeSignPairs, childRoot);
      }

      return newRoot;
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
   * Returns all shared interface variables referenced by 2 or more distinct theory domains.
   */
  public getSharedInterfaceVariables(): Set<string> {
    const shared = new Set<string>();
    for (const [v, domains] of this.varDomains.entries()) {
      if (domains.size >= 2) {
        shared.add(v);
      }
    }
    return shared;
  }

  /**
   * Returns true if `varName` is a shared interface variable across >= 2 theory domains.
   */
  public isSharedInterfaceVar(varName: string): boolean {
    const domains = this.varDomains.get(varName);
    return domains ? domains.size >= 2 : false;
  }

  /**
   * Returns true if two variables are known to be disequal (`varA != varB`).
   */
  public areKnownDisequal(varA: string, varB: string): boolean {
    const rootA = this.getCanonicalVar(varA);
    const rootB = this.getCanonicalVar(varB);
    if (rootA === rootB) return false;
    for (const d of this.knownDisequalities.values()) {
      const dA = this.getCanonicalVar(d.varA);
      const dB = this.getCanonicalVar(d.varB);
      if ((dA === rootA && dB === rootB) || (dA === rootB && dB === rootA)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks Polite/Shiny finite-domain cardinality constraints across all oracles.
   * Returns a ConflictClause if `k > maxCardinality` variables are pairwise known disequal.
   */
  private checkFiniteDomainConflicts(): ConflictClause | undefined {
    for (const oracle of this.oracles.values()) {
      if (!oracle.getFiniteDomainConstraints) continue;
      for (const fdc of oracle.getFiniteDomainConstraints()) {
        // Deduplicate variables by current canonical root
        const distinctReps: string[] = [];
        const seenRoots = new Set<string>();
        for (const v of fdc.vars) {
          const r = this.getCanonicalVar(v);
          if (!seenRoots.has(r)) {
            seenRoots.add(r);
            distinctReps.push(v);
          }
        }
        if (distinctReps.length <= fdc.maxCardinality) continue;

        // Check if any pair among distinctReps can still be merged (not known disequal)
        let hasMergeablePair = false;
        const diseqJusts = new Set<number>(fdc.justifications ?? []);
        for (let i = 0; i < distinctReps.length; i++) {
          for (let j = i + 1; j < distinctReps.length; j++) {
            const vA = distinctReps[i]!;
            const vB = distinctReps[j]!;
            if (!this.areKnownDisequal(vA, vB)) {
              hasMergeablePair = true;
              break;
            } else {
              for (const d of this.knownDisequalities.values()) {
                const dA = this.getCanonicalVar(d.varA);
                const dB = this.getCanonicalVar(d.varB);
                const rA = this.getCanonicalVar(vA);
                const rB = this.getCanonicalVar(vB);
                if ((dA === rA && dB === rB) || (dA === rB && dB === rA)) {
                  for (const id of d.justifications ?? []) diseqJusts.add(id);
                }
              }
            }
          }
          if (hasMergeablePair) break;
        }

        if (!hasMergeablePair) {
          return {
            literals: this.resolveJustificationLiterals(Array.from(diseqJusts)),
            explanation: `Finite-Domain Cardinality Conflict: ${distinctReps.length} pairwise distinct variables [${distinctReps.join(", ")}] cannot fit in a finite domain of cardinality ${fdc.maxCardinality}.`,
            culpritEntities: distinctReps,
            theoryName: fdc.sourceOracle ?? oracle.name,
          };
        }
      }
    }
    return undefined;
  }

  /**
   * Returns all tracked non-trivial variable equivalence classes (`root -> members`).
   */
  public getEquivalenceClasses(): Map<string, string[]> {
    const groups = new Map<string, Set<string>>();
    for (const v of this.parentMap.keys()) {
      const root = this.getCanonicalVar(v);
      let set = groups.get(root);
      if (!set) {
        set = new Set([root]);
        groups.set(root, set);
      }
      set.add(v);
    }
    const result = new Map<string, string[]>();
    for (const [root, members] of groups.entries()) {
      if (members.size > 1) {
        result.set(root, Array.from(members));
      }
    }
    return result;
  }

  /**
   * Collects non-convex equality disjunctions from registered oracles AND synthesizes
   * Pigeonhole equality disjunctions for finite-domain cardinality constraints (`|{vars}| <= m`).
   */
  public collectEqualityDisjunctions(): EqualityDisjunction[] {
    const result: EqualityDisjunction[] = [];
    for (const oracle of this.oracles.values()) {
      if (oracle.propagateEqualityDisjunctions) {
        const disjs = oracle.propagateEqualityDisjunctions();
        for (const d of disjs) {
          if (d.disjuncts.length > 0) {
            result.push({ ...d, sourceOracle: d.sourceOracle ?? oracle.name });
          }
        }
      }
      if (oracle.getFiniteDomainConstraints) {
        for (const fdc of oracle.getFiniteDomainConstraints()) {
          const distinctReps: string[] = [];
          const seenRoots = new Set<string>();
          for (const v of fdc.vars) {
            const r = this.getCanonicalVar(v);
            if (!seenRoots.has(r)) {
              seenRoots.add(r);
              distinctReps.push(v);
            }
          }
          if (distinctReps.length > fdc.maxCardinality) {
            // Pigeonhole Principle: at least two of the first (m + 1) distinct variables must be equal
            const subset = distinctReps.slice(0, fdc.maxCardinality + 1);
            const disjuncts: [string, string][] = [];
            for (let i = 0; i < subset.length; i++) {
              for (let j = i + 1; j < subset.length; j++) {
                if (!this.areKnownDisequal(subset[i]!, subset[j]!)) {
                  disjuncts.push([subset[i]!, subset[j]!]);
                }
              }
            }
            if (disjuncts.length > 0) {
              result.push({
                disjuncts,
                explanation: `Finite-domain Pigeonhole disjunction over [${subset.join(", ")}] (maxCardinality=${fdc.maxCardinality})`,
                sourceOracle: fdc.sourceOracle ?? oracle.name,
                justifications: fdc.justifications,
              });
            }
          }
        }
      }
    }
    return result;
  }

  /**
   * Extracts variable identifiers from a theory literal for subscriber tracking.
   */
  private extractReferencedVariables(lit: TheoryLiteral): string[] {
    const vars: string[] = [];
    if (!lit.args || !Array.isArray(lit.args)) return vars;

    const { predicate, args } = lit;
    if (predicate === "hyperplane" && args[0] && typeof args[0] === "object") {
      const obj = args[0] as Record<string, unknown>;
      const coeffs = obj["coeffs"];
      if (coeffs && typeof coeffs === "object") {
        return Object.keys(coeffs as Record<string, unknown>);
      }
      return Object.keys(obj);
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
          const arg = args[i];
          if (typeof arg === "string") vars.push(arg);
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

    const extractVarsFromExprNode = (node: unknown, out: string[]): void => {
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (obj["kind"] === "var" && typeof obj["name"] === "string") {
        out.push(obj["name"]);
      }
      if (obj["left"]) extractVarsFromExprNode(obj["left"], out);
      if (obj["right"]) extractVarsFromExprNode(obj["right"], out);
      if (obj["child"]) extractVarsFromExprNode(obj["child"], out);
    };

    if ((predicate === "nonlinear" || predicate === "expr") && args[0] && typeof args[0] === "object") {
      const arg0 = args[0] as Record<string, unknown>;
      const expr = arg0["expr"] ?? arg0;
      extractVarsFromExprNode(expr, vars);
      if (Array.isArray(arg0["vars"])) {
        for (const v of arg0["vars"]) {
          if (typeof v === "string") vars.push(v);
        }
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
   * Purifies mixed-theory arithmetic/uninterpreted-function expressions by replacing nested `call` nodes
   * `f(e_1, ..., e_k)` with fresh interface variables `__purify_N` and emitting pure `funcApply`
   * and binding `expr` literals.
   */
  private purifyExprNode(
    node: Record<string, unknown> & {
      kind?: string;
      fn?: string;
      name?: string;
      args?: Array<Record<string, unknown> & { kind?: string; name?: string }>;
      left?: Record<string, unknown>;
      right?: Record<string, unknown>;
      child?: Record<string, unknown>;
    },
    domain: TheoryDomain | undefined,
  ): { expr: Record<string, unknown>; changed: boolean } {
    if (!node || typeof node !== "object") return { expr: node, changed: false };
    if (node.kind === "call" && typeof node.fn === "string" && Array.isArray(node.args)) {
      const argVars: string[] = [];
      for (const arg of node.args) {
        if (arg && arg.kind === "var" && typeof arg.name === "string") {
          argVars.push(arg.name);
        } else {
          const purifiedArg = this.purifyExprNode(arg, domain);
          const freshArg = `__purify_${this.purifyCounter++}`;
          this.assertLiteral({
            predicate: "expr",
            args: [
              {
                expr: { kind: "sub", left: { kind: "var", name: freshArg }, right: purifiedArg.expr },
                rel: "==",
                rhs: 0,
              },
            ],
            domain: domain ?? "constraint",
          });
          argVars.push(freshArg);
        }
      }
      const freshResult = `__purify_${this.purifyCounter++}`;
      this.assertLiteral({
        predicate: "funcApply",
        args: [freshResult, node.fn, argVars],
        domain: domain ?? "constraint",
      });
      return { expr: { kind: "var", name: freshResult }, changed: true };
    }

    let changed = false;
    const copy: Record<string, unknown> = { ...node };
    if (node.left) {
      const res = this.purifyExprNode(node.left, domain);
      copy["left"] = res.expr;
      changed = changed || res.changed;
    }
    if (node.right) {
      const res = this.purifyExprNode(node.right, domain);
      copy["right"] = res.expr;
      changed = changed || res.changed;
    }
    if (node.child) {
      const res = this.purifyExprNode(node.child, domain);
      copy["child"] = res.expr;
      changed = changed || res.changed;
    }
    return { expr: changed ? copy : node, changed };
  }

  /**
   * Registers a function application term into the incremental congruence closure use-list index.
   */
  private registerFunctionTerm(term: FunctionApplicationTerm): void {
    const idx = this.functionTerms.length;
    this.trailArrayPush(this.functionTerms, term);
    for (const arg of term.args) {
      const root = this.getCanonicalVar(arg);
      let uses = this.termUseList.get(root);
      if (!uses) {
        uses = new Set();
        this.trailMapSet(this.termUseList, root, uses);
      }
      this.trailSetAdd(uses, idx);
    }
    this.trailSetAdd(this.dirtyCongruenceTerms, idx);
  }

  /**
   * Asserts a new theory literal into the coordinator, purifying mixed terms if needed
   * and routing to appropriate oracles.
   */
  public assertLiteral(lit: Omit<TheoryLiteral, "id"> & { id?: number | undefined }): number {
    const id = lit.id ?? this.nextLitId++;
    const fullLit: TheoryLiteral = { ...lit, id, args: Array.isArray(lit.args) ? [...lit.args] : lit.args };

    // Automatic Nelson-Oppen mixed-term purification for nonlinear/expr literals containing `call` nodes
    if (
      (fullLit.predicate === "nonlinear" || fullLit.predicate === "expr") &&
      fullLit.args[0] &&
      typeof fullLit.args[0] === "object"
    ) {
      const arg0 = fullLit.args[0] as Record<string, unknown>;
      if (arg0["expr"] && arg0["rel"]) {
        const purified = this.purifyExprNode(arg0["expr"] as Parameters<typeof this.purifyExprNode>[0], fullLit.domain);
        if (purified.changed) {
          fullLit.args[0] = { ...arg0, expr: purified.expr };
        }
      } else if (arg0["kind"]) {
        const purified = this.purifyExprNode(arg0 as Parameters<typeof this.purifyExprNode>[0], fullLit.domain);
        if (purified.changed) {
          fullLit.args[0] = purified.expr;
        }
      }
    }

    this.activeLiterals.set(id, fullLit);

    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1]!.literalIds.push(id);
    }

    const refVars = this.extractReferencedVariables(fullLit);
    for (const v of refVars) {
      if (!this.varSubscribers.has(v)) {
        this.trailMapSet(this.varSubscribers, v, new Set());
      }
      if (fullLit.domain) {
        let doms = this.varDomains.get(v);
        if (!doms) {
          doms = new Set();
          this.trailMapSet(this.varDomains, v, doms);
        }
        this.trailSetAdd(doms, fullLit.domain);
      }
    }

    // Register function application term for incremental congruence closure
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
        this.registerFunctionTerm({
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
        const arg0 = fullLit.args[0] as Record<string, unknown>;
        if (arg0["expr"] && arg0["rel"]) {
          fullLit.args[0] = SimplificationWaterfall.simplifyConstraint(
            arg0 as unknown as Parameters<typeof SimplificationWaterfall.simplifyConstraint>[0],
          );
        } else if (arg0["kind"]) {
          fullLit.args[0] = SimplificationWaterfall.simplifyExpr(
            arg0 as unknown as Parameters<typeof SimplificationWaterfall.simplifyExpr>[0],
          );
        }
      }
    } else if (fullLit.predicate === "hyperplane" && fullLit.args[0] && typeof fullLit.args[0] === "object") {
      const arg0 = fullLit.args[0] as Record<string, unknown>;
      const rawCoeffs = arg0["coeffs"];
      if (rawCoeffs && typeof rawCoeffs === "object") {
        const filteredCoeffs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rawCoeffs as Record<string, unknown>)) {
          if (typeof v !== "number" || Math.abs(v) >= 1e-12) {
            filteredCoeffs[k] = v;
          }
        }
        fullLit.args[0] = { ...arg0, coeffs: filteredCoeffs };
      } else {
        const filteredCoeffs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(arg0)) {
          if (typeof v !== "number" || Math.abs(v) >= 1e-12) {
            filteredCoeffs[k] = v;
          }
        }
        fullLit.args[0] = filteredCoeffs;
      }
    }

    // Route literal to relevant oracles and mark dirty
    const receivingOracles: string[] = [];
    for (const oracle of this.oracles.values()) {
      if (!fullLit.domain || fullLit.domain === oracle.domain) {
        oracle.assertLiteral(fullLit);
        this.dirtyOracles.add(oracle.name);
        receivingOracles.push(oracle.name);
        this.markLiteralOracle(id, oracle.name);

        for (const v of refVars) {
          this.subscribe(v, oracle);
          let doms = this.varDomains.get(v);
          if (!doms) {
            doms = new Set();
            this.trailMapSet(this.varDomains, v, doms);
          }
          this.trailSetAdd(doms, oracle.domain);
        }
      }
    }

    const srcOracle = receivingOracles[0] ?? fullLit.domain ?? "coordinator";

    // Automatically enqueue worklist event for bounds, equalities, and disequalities asserted directly
    if (fullLit.predicate === "interval" && Array.isArray(fullLit.args) && fullLit.args.length >= 3) {
      const [varName, lo, hi] = fullLit.args;
      if (typeof varName === "string" && typeof lo === "number" && typeof hi === "number") {
        if (this.isEmptyBounds(lo, hi, false, false)) {
          this.infeasibleConflict = this.makeBoundInversionConflict(varName, lo, hi, [id], [varName]);
        }
        this.enqueueEvent({
          kind: "bound",
          varName,
          bounds: [lo, hi],
          strict: [false, false],
          theoryDomain: fullLit.domain,
          sourceOracle: srcOracle,
          justification: [id],
        });
      }
    } else if (fullLit.predicate === "bound" && Array.isArray(fullLit.args) && fullLit.args.length >= 3) {
      const [varName, op, val] = fullLit.args;
      if (typeof varName === "string" && typeof val === "number") {
        if (op === "!=") {
          const canon = this.getCanonicalVar(varName);
          const conflict = this.addDisallowedValue(canon, val, [id], [varName]);
          if (conflict) {
            this.infeasibleConflict = conflict;
          }
        } else {
          let b: [number, number] | undefined;
          let strict: [boolean, boolean] = [false, false];
          if (op === "<=") {
            b = [-Infinity, val];
          } else if (op === "<") {
            b = [-Infinity, val];
            strict = [false, true];
          } else if (op === ">=") {
            b = [val, Infinity];
          } else if (op === ">") {
            b = [val, Infinity];
            strict = [true, false];
          } else if (op === "==") {
            b = [val, val];
          }
          if (b) {
            this.enqueueEvent({
              kind: "bound",
              varName,
              bounds: b,
              strict,
              theoryDomain: fullLit.domain,
              sourceOracle: srcOracle,
              justification: [id],
            });
          }
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
    } else if (
      (fullLit.predicate === "notEqual" || fullLit.predicate === "differentIndividuals") &&
      Array.isArray(fullLit.args) &&
      fullLit.args.length >= 2
    ) {
      const [varA, varB] = fullLit.args;
      if (typeof varA === "string" && typeof varB === "string") {
        this.enqueueEvent({
          kind: "disequality",
          varA,
          varB,
          theoryDomain: fullLit.domain,
          sourceOracle: srcOracle,
          justification: [id],
        });
      }
    }

    return id;
  }

  /**
   * Registers an opposite-sign flow conservation pairing (`vA == -vB`, i.e., `vA + vB = 0`)
   * keyed by canonical representatives, deducing self-negation (`a == -a => a == 0`)
   * and transitive equality (`a == -b && b == -c => a == c`).
   */
  private registerOppositeSignPair(
    rawVarA: string,
    rawVarB: string,
    justifications: number[],
    enqueueDeductions = true,
  ): void {
    const cleanA = rawVarA.startsWith("-") ? rawVarA.slice(1) : rawVarA;
    const cleanB = rawVarB.startsWith("-") ? rawVarB.slice(1) : rawVarB;
    const rootA = this.getCanonicalVar(cleanA);
    const rootB = this.getCanonicalVar(cleanB);

    // Self-negation: a == -a implies a == 0
    if (rootA === rootB) {
      if (enqueueDeductions) {
        this.enqueueEvent({
          kind: "bound",
          varName: rootA,
          bounds: [0, 0],
          strict: [false, false],
          explanation: `Opposite-sign self-equality '${cleanA} == -${cleanB}' implies '${rootA} == 0'.`,
          sourceOracle: "SemanticTheoryCoordinator",
          justification: [...justifications],
        });
      }
      return;
    }

    // Transitivity: if rootA is already opposite to partner P, then rootB == P
    if (enqueueDeductions) {
      const existingA = this.oppositeSignPairs.get(rootA);
      if (existingA) {
        for (const item of existingA) {
          const pRoot = this.getCanonicalVar(item.partner);
          if (pRoot !== rootB) {
            const combined = Array.from(new Set([...justifications, ...item.justifications]));
            this.enqueueEvent({
              kind: "equality",
              varA: rootB,
              varB: pRoot,
              domain: "real",
              explanation: `Transitive opposite-sign equality: ${rootB} == -${rootA} and ${pRoot} == -${rootA} implies ${rootB} == ${pRoot}.`,
              sourceOracle: "SemanticTheoryCoordinator",
              justification: combined,
            });
          }
        }
      }
      const existingB = this.oppositeSignPairs.get(rootB);
      if (existingB) {
        for (const item of existingB) {
          const pRoot = this.getCanonicalVar(item.partner);
          if (pRoot !== rootA) {
            const combined = Array.from(new Set([...justifications, ...item.justifications]));
            this.enqueueEvent({
              kind: "equality",
              varA: rootA,
              varB: pRoot,
              domain: "real",
              explanation: `Transitive opposite-sign equality: ${rootA} == -${rootB} and ${pRoot} == -${rootB} implies ${rootA} == ${pRoot}.`,
              sourceOracle: "SemanticTheoryCoordinator",
              justification: combined,
            });
          }
        }
      }
    }

    const addLink = (fromRoot: string, toRoot: string) => {
      let list = this.oppositeSignPairs.get(fromRoot);
      if (!list) {
        list = [];
        this.trailMapSet(this.oppositeSignPairs, fromRoot, list);
      }
      const existing = list.find((item) => this.getCanonicalVar(item.partner) === toRoot);
      if (existing) {
        for (const j of justifications) {
          if (!existing.justifications.includes(j)) this.trailArrayPush(existing.justifications, j);
        }
      } else {
        this.trailArrayPush(list, { partner: toRoot, justifications: [...justifications] });
      }
    };
    addLink(rootA, rootB);
    addLink(rootB, rootA);
  }

  /**
   * Retracts an asserted literal incrementally from only the affected oracles and rebuilds
   * coordinator equivalence classes, disequalities, congruence index, and bounds.
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

    // Purge known disequalities that depended on the retracted literal
    const directDiseqKey =
      (lit.predicate === "notEqual" || lit.predicate === "differentIndividuals") &&
      Array.isArray(lit.args) &&
      typeof lit.args[0] === "string" &&
      typeof lit.args[1] === "string"
        ? this.makeEqualityKey(lit.args[0], lit.args[1])
        : undefined;

    for (const [key, diseq] of Array.from(this.knownDisequalities.entries())) {
      const dependsOnLit =
        (diseq.justifications && diseq.justifications.includes(litId)) ||
        (directDiseqKey !== undefined && key === directDiseqKey);
      if (dependsOnLit) {
        this.knownDisequalities.delete(key);
      }
    }

    // Clear and rebuild equivalence classes, opposite-sign pairs, justifications, congruence index, and canonical bounds
    this.parentMap.clear();
    this.parentRank.clear();
    this.equalityProofGraph.clear();
    this.canonicalBounds.clear();
    this.canonicalBoundStrict.clear();
    this.disallowedValues.clear();
    this.canonicalBoundJustifications.clear();
    this.canonSubscribers.clear();
    this.oppositeSignPairs.clear();
    this.termUseList.clear();
    this.congruenceSigTable.clear();
    this.dirtyCongruenceTerms.clear();

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
            this.registerOppositeSignPair(varA, varB, [activeLit.id], false);
          } else {
            const root = this.unionVars(varA, varB, [activeLit.id]);
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
        this.registerOppositeSignPair(eq.varA, eq.varB, justs, false);
      } else {
        const root = this.unionVars(eq.varA, eq.varB, justs);
        addJustifications(root, justs);
      }
    }

    // 2.5 Rebuild incremental congruence use-list index from surviving functionTerms
    for (let idx = 0; idx < this.functionTerms.length; idx++) {
      const term = this.functionTerms[idx]!;
      for (const arg of term.args) {
        const root = this.getCanonicalVar(arg);
        let uses = this.termUseList.get(root);
        if (!uses) {
          uses = new Set();
          this.termUseList.set(root, uses);
        }
        uses.add(idx);
      }
      this.dirtyCongruenceTerms.add(idx);
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

    // 4. Rebuild canonical bounds, strictness, and disallowed values from remaining active literals
    for (const activeLit of this.activeLiterals.values()) {
      if (activeLit.predicate === "interval" && Array.isArray(activeLit.args) && activeLit.args.length >= 3) {
        const [vName, lo, hi] = activeLit.args;
        if (typeof vName === "string" && typeof lo === "number" && typeof hi === "number") {
          const canon = this.getCanonicalVar(vName);
          const merged = this.intersectBoundsWithStrict(
            this.canonicalBounds.get(canon),
            this.canonicalBoundStrict.get(canon),
            [lo, hi],
            [false, false],
          );
          this.canonicalBounds.set(canon, merged.bounds);
          this.canonicalBoundStrict.set(canon, merged.strict);
          addJustifications(canon, [activeLit.id]);
        }
      } else if (activeLit.predicate === "bound" && Array.isArray(activeLit.args) && activeLit.args.length >= 3) {
        const [vName, op, val] = activeLit.args;
        if (typeof vName === "string" && typeof val === "number") {
          const canon = this.getCanonicalVar(vName);
          if (op === "!=") {
            this.addDisallowedValue(canon, val, [activeLit.id], [vName]);
            continue;
          }
          let b: [number, number] | undefined;
          let strict: [boolean, boolean] = [false, false];
          if (op === "<=") {
            b = [-Infinity, val];
          } else if (op === "<") {
            b = [-Infinity, val];
            strict = [false, true];
          } else if (op === ">=") {
            b = [val, Infinity];
          } else if (op === ">") {
            b = [val, Infinity];
            strict = [true, false];
          } else if (op === "==") {
            b = [val, val];
          }
          if (!b) continue;
          const merged = this.intersectBoundsWithStrict(
            this.canonicalBounds.get(canon),
            this.canonicalBoundStrict.get(canon),
            b,
            strict,
          );
          this.canonicalBounds.set(canon, merged.bounds);
          this.canonicalBoundStrict.set(canon, merged.strict);
          addJustifications(canon, [activeLit.id]);
        }
      }
    }

    for (const eq of this.knownEqualities.values()) {
      if (eq.bounds && eq.varA.startsWith("-") === eq.varB.startsWith("-")) {
        const canon = this.getCanonicalVar(eq.varA);
        const merged = this.intersectBoundsWithStrict(
          this.canonicalBounds.get(canon),
          this.canonicalBoundStrict.get(canon),
          eq.bounds,
          eq.strict,
        );
        this.canonicalBounds.set(canon, merged.bounds);
        this.canonicalBoundStrict.set(canon, merged.strict);
      }
    }

    // Mirror bounds across opposite-sign pairs to a fixpoint (handles multi-hop chains)
    let mirrored = true;
    let mirrorPasses = 0;
    while (mirrored && mirrorPasses < 32) {
      mirrored = false;
      mirrorPasses++;
      for (const [varName, partners] of this.oppositeSignPairs.entries()) {
        const rootA = this.getCanonicalVar(varName);
        const bA = this.canonicalBounds.get(rootA);
        if (!bA) continue;
        const sA = this.canonicalBoundStrict.get(rootA) ?? [false, false];
        for (const { partner, justifications } of partners) {
          const rootB = this.getCanonicalVar(partner);
          const currB = this.canonicalBounds.get(rootB);
          const currSB = this.canonicalBoundStrict.get(rootB) ?? [false, false];
          const negBounds: [number, number] = [-bA[1], -bA[0]];
          const negStrict: [boolean, boolean] = [sA[1], sA[0]];
          const merged = this.intersectBoundsWithStrict(currB, currSB, negBounds, negStrict);
          if (
            !currB ||
            this.isTightenedBounds(
              merged.bounds[0],
              merged.bounds[1],
              currB[0],
              currB[1],
              merged.strict[0],
              merged.strict[1],
              currSB[0],
              currSB[1],
            )
          ) {
            this.canonicalBounds.set(rootB, merged.bounds);
            this.canonicalBoundStrict.set(rootB, merged.strict);
            addJustifications(rootB, justifications);
            const jA = this.canonicalBoundJustifications.get(rootA);
            if (jA) addJustifications(rootB, Array.from(jA));
            mirrored = true;
          }
        }
      }
    }

    for (const [canon, [lo, hi]] of this.canonicalBounds.entries()) {
      const strict = this.canonicalBoundStrict.get(canon) ?? [false, false];
      if (this.isEmptyBounds(lo, hi, strict[0], strict[1])) {
        const justs = this.canonicalBoundJustifications.get(canon)
          ? Array.from(this.canonicalBoundJustifications.get(canon)!)
          : [];
        this.infeasibleConflict = this.makeBoundInversionConflict(canon, lo, hi, justs, [canon], strict);
        break;
      }
      const disConflict = this.checkDisallowedConflict(canon, [canon]);
      if (disConflict) {
        this.infeasibleConflict = disConflict;
        break;
      }
    }

    // Incremental oracle retraction: only retract from oracles that actually received litId
    // or a shared equality/disequality justified by litId (falls back to all if untracked).
    const affected = this.literalAffectedOracles.get(litId);
    this.literalAffectedOracles.delete(litId);
    if (affected && affected.size > 0) {
      for (const oracleName of affected) {
        const oracle = this.oracles.get(oracleName);
        if (oracle) {
          oracle.retractLiteral(litId);
          this.dirtyOracles.add(oracle.name);
        }
      }
    } else {
      for (const oracle of this.oracles.values()) {
        oracle.retractLiteral(litId);
        this.dirtyOracles.add(oracle.name);
      }
    }
  }

  /**
   * Pushes a backtracking decision level in O(1) time using an undo trail.
   */
  public pushLevel(): void {
    this.levelStack.push({
      literalIds: [],
      trailMark: this.undoTrail.length,
      idToVarMark: this.idToVar.length,
      worklistSnapshot: [...this.worklist],
      infeasibleConflictSnapshot: this.infeasibleConflict ? { ...this.infeasibleConflict } : undefined,
      purifyCounterSnapshot: this.purifyCounter,
    });
    for (const oracle of this.oracles.values()) {
      oracle.pushLevel?.();
    }
  }

  /**
   * Pops the current decision level in O(mutations) time by unwinding the undo trail
   * and reclaiming transient interned variable IDs.
   */
  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;

    this.memoizedResult = undefined;

    for (const id of top.literalIds) {
      this.activeLiterals.delete(id);
    }

    // Unwind all map/set/array mutations in reverse order
    while (this.undoTrail.length > top.trailMark) {
      this.undoTrail.pop()!();
    }

    // Reclaim interned variable names created inside the popped level
    while (this.idToVar.length > top.idToVarMark) {
      const vName = this.idToVar.pop()!;
      this.varToId.delete(vName);
    }

    this.worklist = [...top.worklistSnapshot];
    this.infeasibleConflict = top.infeasibleConflictSnapshot;
    this.purifyCounter = top.purifyCounterSnapshot;

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
   * Resets all registered oracles and internal equality graphs while preserving oracle domain subscriptions.
   */
  public reset(): void {
    this.activeLiterals.clear();
    this.knownEqualities.clear();
    this.knownDisequalities.clear();
    this.varToId.clear();
    this.idToVar = [];
    this.parentMap.clear();
    this.parentRank.clear();
    this.equalityProofGraph.clear();
    this.canonicalBounds.clear();
    this.canonicalBoundStrict.clear();
    this.disallowedValues.clear();
    this.canonicalBoundJustifications.clear();
    this.varSubscribers.clear();
    this.canonSubscribers.clear();
    this.domainSubscribers.clear();
    this.varDomains.clear();
    this.literalAffectedOracles.clear();
    this.dirtyOracles.clear();
    this.worklist = [];
    this.memoizedResult = undefined;
    this.infeasibleConflict = undefined;
    this.functionTerms = [];
    this.termUseList.clear();
    this.congruenceSigTable.clear();
    this.dirtyCongruenceTerms.clear();
    this.oppositeSignPairs.clear();
    this.undoTrail = [];
    this.levelStack = [];
    this.nextLitId = 1;
    this.purifyCounter = 0;
    for (const oracle of this.oracles.values()) {
      oracle.reset();
      this.subscribeDomain(oracle.domain, oracle);
      this.dirtyOracles.add(oracle.name);
    }
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
    if ("isCancellationRequested" in token && Boolean(token.isCancellationRequested)) {
      return true;
    }
    if ("aborted" in token && Boolean(token.aborted)) {
      return true;
    }
    return false;
  }

  /**
   * Incrementally evaluates congruence closure over dirty function application terms:
   *   x_i == y_i for all i  ==>  f(x_1, ..., x_k) == f(y_1, ..., y_k)
   * Uses `dirtyCongruenceTerms` (populated on term registration and `unionVars` use-list merges)
   * and `congruenceSigTable` to avoid rescanning unchanged terms.
   */
  public checkCongruenceClosure(): number {
    if (this.dirtyCongruenceTerms.size === 0) return 0;
    let deducedCount = 0;
    const toProcess = Array.from(this.dirtyCongruenceTerms);
    for (const idx of toProcess) {
      this.trailSetDelete(this.dirtyCongruenceTerms, idx);
    }

    for (const idx of toProcess) {
      const term = this.functionTerms[idx];
      if (!term) continue;
      const canonArgs = term.args.map((a) => this.getCanonicalVar(a));
      const sig = `${term.functionName}\0${term.args.length}\0${canonArgs.join("\0")}`;
      const repIdx = this.congruenceSigTable.get(sig);
      if (repIdx === undefined) {
        this.trailMapSet(this.congruenceSigTable, sig, idx);
        continue;
      }
      if (repIdx === idx) continue;
      const representative = this.functionTerms[repIdx];
      if (!representative) {
        this.trailMapSet(this.congruenceSigTable, sig, idx);
        continue;
      }

      const rootA = this.getCanonicalVar(representative.resultVar);
      const rootB = this.getCanonicalVar(term.resultVar);
      if (rootA !== rootB) {
        const key = this.makeEqualityKey(representative.resultVar, term.resultVar);
        if (!this.knownEqualities.has(key)) {
          deducedCount++;
          const combinedJusts = new Set<number>([representative.literalId, term.literalId]);
          // Collect exact equality proof justifications for every argument pair (rep.args[i] == term.args[i])
          for (let i = 0; i < term.args.length; i++) {
            const argA = representative.args[i]!;
            const argB = term.args[i]!;
            if (argA !== argB) {
              const proofIds = this.getEqualityProof(argA, argB);
              for (const pid of proofIds) combinedJusts.add(pid);
            }
          }
          this.enqueueEvent({
            kind: "equality",
            varA: representative.resultVar,
            varB: term.resultVar,
            domain: "real",
            theoryDomain: "algebraic",
            explanation: `Congruence closure: ${representative.functionName}(${representative.args.join(", ")}) == ${term.functionName}(${term.args.join(", ")}) implies ${representative.resultVar} == ${term.resultVar}.`,
            sourceOracle: "CongruenceClosure",
            justification: Array.from(combinedJusts),
          });
        }
      }
    }

    return deducedCount;
  }

  /**
   * Collects target oracles directly from subscriber indices without scanning all registered oracles.
   */
  private collectTargetOracles(
    vars: string[],
    theoryDomain: TheoryDomain | undefined,
    kind: "equality" | "bound" | "disequality",
    sourceOracle: string,
  ): Set<TheoryOracle> {
    const targets = new Set<TheoryOracle>();
    for (const rawVar of vars) {
      const clean = rawVar.startsWith("-") ? rawVar.slice(1) : rawVar;
      const canon = this.getCanonicalVar(clean);
      const cSubs = this.canonSubscribers.get(canon);
      if (cSubs) for (const o of cSubs) targets.add(o);
      const vSubs = this.varSubscribers.get(clean);
      if (vSubs) for (const o of vSubs) targets.add(o);
      if (clean !== rawVar) {
        const rSubs = this.varSubscribers.get(rawVar);
        if (rSubs) for (const o of rSubs) targets.add(o);
      }
    }
    if (theoryDomain) {
      const dSubs = this.domainSubscribers.get(theoryDomain);
      if (dSubs) for (const o of dSubs) targets.add(o);
    }
    const constraintSubs = this.domainSubscribers.get("constraint");
    if (constraintSubs) for (const o of constraintSubs) targets.add(o);
    if (kind === "bound") {
      const spatialSubs = this.domainSubscribers.get("spatial_physics");
      if (spatialSubs) for (const o of spatialSubs) targets.add(o);
    }
    if (kind === "disequality") {
      const ontologySubs = this.domainSubscribers.get("ontology");
      if (ontologySubs) for (const o of ontologySubs) targets.add(o);
    }
    const src = this.oracles.get(sourceOracle);
    if (src) targets.delete(src);
    return targets;
  }

  /**
   * Drains the coordinator worklist in O(N) using a cursor, tightening bounds, performing
   * interval/strict/disequality conflict checks, and selectively notifying subscribed oracles.
   */
  private drainWorklist(
    iteration: number,
    startTime: number,
  ): { unsat?: CoordinatorSatResult | undefined; eventsProcessed: number } {
    let eventsProcessed = 0;
    let head = 0;

    while (head < this.worklist.length) {
      const event = this.worklist[head++]!;
      if (event.kind === "disequality") {
        const rootA = this.getCanonicalVar(event.varA);
        const rootB = this.getCanonicalVar(event.varB);
        const justs = event.justification ?? [];
        if (rootA === rootB) {
          const allJusts = new Set<number>(justs);
          for (const id of this.getEqualityProof(event.varA, event.varB)) allJusts.add(id);
          this.worklist.length = 0;
          return {
            unsat: {
              status: "UNSAT",
              isSat: false,
              conflict: {
                literals: this.resolveJustificationLiterals(Array.from(allJusts)),
                explanation: `Disequality Conflict: Variables '${event.varA}' and '${event.varB}' are declared disequal (${event.explanation ?? "!="}) but are already equal.`,
                culpritEntities: Array.from(new Set([event.varA, event.varB, rootA])),
                theoryName: "SemanticTheoryCoordinator",
              },
              sharedEqualities: Array.from(this.knownEqualities.values()),
              iterations: iteration,
              durationMs: performance.now() - startTime,
            },
            eventsProcessed,
          };
        }

        const dKey = this.makeEqualityKey(event.varA, event.varB);
        if (!this.knownDisequalities.has(dKey)) {
          const diseq: SharedDisequality = {
            varA: event.varA,
            varB: event.varB,
            explanation: event.explanation,
            sourceOracle: event.sourceOracle,
            justifications: justs,
          };
          this.trailMapSet(this.knownDisequalities, dKey, diseq);
          eventsProcessed++;
          const targets = this.collectTargetOracles(
            [event.varA, event.varB],
            event.theoryDomain,
            "disequality",
            event.sourceOracle,
          );
          for (const oracle of targets) {
            if (oracle.onSharedDisequality) {
              oracle.onSharedDisequality(diseq);
              this.dirtyOracles.add(oracle.name);
              for (const jId of justs) this.markLiteralOracle(jId, oracle.name);
            }
          }
        }
        continue;
      }

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
            let jA = this.canonicalBoundJustifications.get(rootA);
            if (!jA) {
              jA = new Set();
              this.trailMapSet(this.canonicalBoundJustifications, rootA, jA);
            }
            let jB = this.canonicalBoundJustifications.get(rootB);
            if (!jB) {
              jB = new Set();
              this.trailMapSet(this.canonicalBoundJustifications, rootB, jB);
            }
            for (const id of justs) {
              this.trailSetAdd(jA, id);
              this.trailSetAdd(jB, id);
            }
          }

          const bA = this.canonicalBounds.get(rootA);
          const bB = this.canonicalBounds.get(rootB);
          const sA = this.canonicalBoundStrict.get(rootA) ?? [false, false];
          const sB = this.canonicalBoundStrict.get(rootB) ?? [false, false];

          // Mirror bounds: vA = -vB => vA in [-hiB, -loB] and vB in [-hiA, -loA]
          if (bA || bB) {
            const negB: [number, number] | undefined = bB ? [-bB[1], -bB[0]] : undefined;
            const negSB: [boolean, boolean] = [sB[1], sB[0]];
            const negA: [number, number] | undefined = bA ? [-bA[1], -bA[0]] : undefined;
            const negSA: [boolean, boolean] = [sA[1], sA[0]];

            const mergedA = this.intersectBoundsWithStrict(bA, sA, negB, negSB);
            const mergedB = this.intersectBoundsWithStrict(bB, sB, negA, negSA);
            const [loA, hiA] = mergedA.bounds;
            const [loB, hiB] = mergedB.bounds;

            const combinedJusts = new Set<number>(justs);
            const jSetA = this.canonicalBoundJustifications.get(rootA);
            const jSetB = this.canonicalBoundJustifications.get(rootB);
            if (jSetA) for (const id of jSetA) combinedJusts.add(id);
            if (jSetB) for (const id of jSetB) combinedJusts.add(id);
            const allJustsArr = Array.from(combinedJusts);

            if (this.isEmptyBounds(loA, hiA, mergedA.strict[0], mergedA.strict[1])) {
              this.worklist.length = 0;
              return {
                unsat: {
                  status: "UNSAT",
                  isSat: false,
                  conflict: this.makeBoundInversionConflict(
                    cleanA,
                    loA,
                    hiA,
                    allJustsArr,
                    [cleanA, cleanB, rootA, rootB],
                    mergedA.strict,
                  ),
                  sharedEqualities: Array.from(this.knownEqualities.values()),
                  iterations: iteration,
                  durationMs: performance.now() - startTime,
                },
                eventsProcessed,
              };
            }
            if (this.isEmptyBounds(loB, hiB, mergedB.strict[0], mergedB.strict[1])) {
              this.worklist.length = 0;
              return {
                unsat: {
                  status: "UNSAT",
                  isSat: false,
                  conflict: this.makeBoundInversionConflict(
                    cleanB,
                    loB,
                    hiB,
                    allJustsArr,
                    [cleanA, cleanB, rootA, rootB],
                    mergedB.strict,
                  ),
                  sharedEqualities: Array.from(this.knownEqualities.values()),
                  iterations: iteration,
                  durationMs: performance.now() - startTime,
                },
                eventsProcessed,
              };
            }

            if (
              !bA ||
              this.isTightenedBounds(loA, hiA, bA[0], bA[1], mergedA.strict[0], mergedA.strict[1], sA[0], sA[1])
            ) {
              this.trailMapSet(this.canonicalBounds, rootA, [loA, hiA]);
              this.trailMapSet(this.canonicalBoundStrict, rootA, mergedA.strict);
              if (jSetB) {
                let targetSet = this.canonicalBoundJustifications.get(rootA);
                if (!targetSet) {
                  targetSet = new Set();
                  this.trailMapSet(this.canonicalBoundJustifications, rootA, targetSet);
                }
                for (const id of jSetB) this.trailSetAdd(targetSet, id);
              }
              isNewOrTightened = true;
            }
            if (
              !bB ||
              this.isTightenedBounds(loB, hiB, bB[0], bB[1], mergedB.strict[0], mergedB.strict[1], sB[0], sB[1])
            ) {
              this.trailMapSet(this.canonicalBounds, rootB, [loB, hiB]);
              this.trailMapSet(this.canonicalBoundStrict, rootB, mergedB.strict);
              if (jSetA) {
                let targetSet = this.canonicalBoundJustifications.get(rootB);
                if (!targetSet) {
                  targetSet = new Set();
                  this.trailMapSet(this.canonicalBoundJustifications, rootB, targetSet);
                }
                for (const id of jSetA) this.trailSetAdd(targetSet, id);
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
              strict: event.strict,
              explanation: event.explanation,
              sourceOracle: event.sourceOracle,
              justifications: justs,
              justification: justs,
            };
            this.trailMapSet(this.knownEqualities, key, eqToBroadcast);
          } else if (isNewOrTightened) {
            const updated: SharedEquality = {
              ...existing,
              bounds: event.bounds ? [...event.bounds] : existing.bounds,
              strict: event.strict ? [...event.strict] : existing.strict,
              sourceOracle: event.sourceOracle,
              justifications: justs.length > 0 ? justs : existing.justifications,
              justification: justs.length > 0 ? justs : existing.justification,
            };
            this.trailMapSet(this.knownEqualities, key, updated);
            eqToBroadcast = updated;
          }

          if (isNewOrTightened && eqToBroadcast) {
            eventsProcessed++;
            const targets = this.collectTargetOracles(
              [cleanA, cleanB],
              event.theoryDomain,
              "equality",
              event.sourceOracle,
            );
            for (const oracle of targets) {
              oracle.onSharedEquality(eqToBroadcast);
              this.dirtyOracles.add(oracle.name);
              for (const jId of eqToBroadcast.justifications ?? []) this.markLiteralOracle(jId, oracle.name);
            }
          }
          continue;
        }

        const canonRoot = this.unionVars(event.varA, event.varB, event.justification ?? []);
        if (this.infeasibleConflict) {
          if (event.justification) {
            const extraLits = this.resolveJustificationLiterals(event.justification);
            for (const lit of extraLits) {
              if (!this.infeasibleConflict.literals.some((l) => l.id === lit.id)) {
                this.infeasibleConflict.literals.push(lit);
              }
            }
          }
          this.worklist.length = 0;
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
        const currentStrict = this.canonicalBoundStrict.get(canonRoot) ?? [false, false];

        if (event.justification && event.justification.length > 0) {
          let jSet = this.canonicalBoundJustifications.get(canonRoot);
          if (!jSet) {
            jSet = new Set();
            this.trailMapSet(this.canonicalBoundJustifications, canonRoot, jSet);
          }
          for (const id of event.justification) this.trailSetAdd(jSet, id);
        }

        if (event.bounds) {
          const merged = this.intersectBoundsWithStrict(currentBound, currentStrict, event.bounds, event.strict);
          const [lo, hi] = merged.bounds;
          if (this.isEmptyBounds(lo, hi, merged.strict[0], merged.strict[1])) {
            const allJustifications = this.canonicalBoundJustifications.get(canonRoot)
              ? Array.from(this.canonicalBoundJustifications.get(canonRoot)!)
              : event.justification
                ? [...event.justification]
                : [];
            this.worklist.length = 0;
            return {
              unsat: {
                status: "UNSAT",
                isSat: false,
                conflict: this.makeBoundInversionConflict(
                  canonRoot,
                  lo,
                  hi,
                  allJustifications,
                  [canonRoot, event.varA, event.varB],
                  merged.strict,
                ),
                sharedEqualities: Array.from(this.knownEqualities.values()),
                iterations: iteration,
                durationMs: performance.now() - startTime,
              },
              eventsProcessed,
            };
          }
          if (
            !currentBound ||
            this.isTightenedBounds(
              lo,
              hi,
              currentBound[0],
              currentBound[1],
              merged.strict[0],
              merged.strict[1],
              currentStrict[0],
              currentStrict[1],
            )
          ) {
            this.trailMapSet(this.canonicalBounds, canonRoot, [lo, hi]);
            this.trailMapSet(this.canonicalBoundStrict, canonRoot, merged.strict);
            isNewOrTightened = true;
            const disConflict = this.checkDisallowedConflict(canonRoot, [canonRoot, event.varA, event.varB]);
            if (disConflict) {
              this.worklist.length = 0;
              return {
                unsat: {
                  status: "UNSAT",
                  isSat: false,
                  conflict: disConflict,
                  sharedEqualities: Array.from(this.knownEqualities.values()),
                  iterations: iteration,
                  durationMs: performance.now() - startTime,
                },
                eventsProcessed,
              };
            }
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
            strict:
              event.strict ??
              (this.canonicalBoundStrict.get(canonRoot) ? [...this.canonicalBoundStrict.get(canonRoot)!] : undefined),
            explanation: event.explanation,
            sourceOracle: event.sourceOracle,
            justifications: allJustifications,
            justification: allJustifications,
          };
          this.trailMapSet(this.knownEqualities, key, eqToBroadcast);
        } else if (isNewOrTightened && event.bounds) {
          const updated: SharedEquality = {
            ...existing,
            bounds: [...event.bounds],
            strict: event.strict ? [...event.strict] : existing.strict,
            sourceOracle: event.sourceOracle,
            justifications: allJustifications,
            justification: allJustifications,
          };
          this.trailMapSet(this.knownEqualities, key, updated);
          eqToBroadcast = updated;
        }

        if (isNewOrTightened && eqToBroadcast) {
          eventsProcessed++;
          const targets = this.collectTargetOracles(
            [event.varA, event.varB],
            event.theoryDomain,
            "equality",
            event.sourceOracle,
          );
          for (const oracle of targets) {
            oracle.onSharedEquality(eqToBroadcast);
            this.dirtyOracles.add(oracle.name);
            for (const jId of allJustifications) this.markLiteralOracle(jId, oracle.name);
          }
        }
      } else if (event.kind === "bound") {
        const canonRoot = this.getCanonicalVar(event.varName);
        const currentBound = this.canonicalBounds.get(canonRoot);
        const currentStrict = this.canonicalBoundStrict.get(canonRoot) ?? [false, false];

        if (event.justification && event.justification.length > 0) {
          let jSet = this.canonicalBoundJustifications.get(canonRoot);
          if (!jSet) {
            jSet = new Set();
            this.trailMapSet(this.canonicalBoundJustifications, canonRoot, jSet);
          }
          for (const id of event.justification) this.trailSetAdd(jSet, id);
        }

        const merged = this.intersectBoundsWithStrict(currentBound, currentStrict, event.bounds, event.strict);
        const [lo, hi] = merged.bounds;

        if (this.isEmptyBounds(lo, hi, merged.strict[0], merged.strict[1])) {
          const allJustifications = this.canonicalBoundJustifications.get(canonRoot)
            ? Array.from(this.canonicalBoundJustifications.get(canonRoot)!)
            : event.justification
              ? [...event.justification]
              : [];
          this.worklist.length = 0;
          return {
            unsat: {
              status: "UNSAT",
              isSat: false,
              conflict: this.makeBoundInversionConflict(
                event.varName,
                lo,
                hi,
                allJustifications,
                [canonRoot, event.varName],
                merged.strict,
              ),
              sharedEqualities: Array.from(this.knownEqualities.values()),
              iterations: iteration,
              durationMs: performance.now() - startTime,
            },
            eventsProcessed,
          };
        }

        let isNewOrTightened = false;
        if (
          !currentBound ||
          this.isTightenedBounds(
            lo,
            hi,
            currentBound[0],
            currentBound[1],
            merged.strict[0],
            merged.strict[1],
            currentStrict[0],
            currentStrict[1],
          )
        ) {
          this.trailMapSet(this.canonicalBounds, canonRoot, [lo, hi]);
          this.trailMapSet(this.canonicalBoundStrict, canonRoot, merged.strict);
          isNewOrTightened = true;

          const disConflict = this.checkDisallowedConflict(canonRoot, [canonRoot, event.varName]);
          if (disConflict) {
            this.worklist.length = 0;
            return {
              unsat: {
                status: "UNSAT",
                isSat: false,
                conflict: disConflict,
                sharedEqualities: Array.from(this.knownEqualities.values()),
                iterations: iteration,
                durationMs: performance.now() - startTime,
              },
              eventsProcessed,
            };
          }
        }

        if (isNewOrTightened) {
          eventsProcessed++;
          const allJustifications = this.canonicalBoundJustifications.get(canonRoot)
            ? Array.from(this.canonicalBoundJustifications.get(canonRoot)!)
            : event.justification
              ? [...event.justification]
              : [];

          // Propagate negated bounds to all opposite-sign Kirchhoff flow partners of the equivalence class
          const partners = this.oppositeSignPairs.get(canonRoot) ?? [];
          for (const { partner, justifications: pairJusts } of partners) {
            const mergedJusts = Array.from(new Set([...allJustifications, ...pairJusts]));
            this.enqueueEvent({
              kind: "bound",
              varName: partner,
              bounds: [-hi, -lo],
              strict: [merged.strict[1], merged.strict[0]],
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
            strict: merged.strict,
            explanation: event.explanation ?? `Contracted bound on '${event.varName}' to [${lo}, ${hi}]`,
            sourceOracle: event.sourceOracle,
            justifications: allJustifications,
            justification: allJustifications,
          };

          const targets = this.collectTargetOracles([event.varName], event.theoryDomain, "bound", event.sourceOracle);
          for (const oracle of targets) {
            oracle.onSharedEquality(boundEq);
            this.dirtyOracles.add(oracle.name);
            for (const jId of allJustifications) this.markLiteralOracle(jId, oracle.name);
          }
        }
      }
    }

    this.worklist.length = 0;
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
   *   1. Draining pending equality/bound/disequality events and running incremental congruence closure.
   *   2. Checking local satisfiability across dirty oracles only, plus finite-domain cardinality checks.
   *   3. Collecting newly propagated equalities, bounds, and disequalities into the worklist.
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

    if (this.dirtyOracles.size === 0 && this.worklist.length === 0) {
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

      // Phase 1.5: Incremental congruence closure deduction to local fixpoint across dirty functional terms
      if (this.dirtyCongruenceTerms.size > 0) {
        let congGuard = 0;
        while (congGuard < 64 && this.dirtyCongruenceTerms.size > 0) {
          const congDeductions = this.checkCongruenceClosure();
          if (congDeductions === 0) break;
          congGuard++;
          const drain2 = this.drainWorklist(iteration, startTime);
          if (drain2.unsat) return drain2.unsat;
        }
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

      // Phase 2.5: Polite/Shiny finite-domain cardinality conflict check
      const fdcConflict = this.checkFiniteDomainConflicts();
      if (fdcConflict) {
        return {
          status: "UNSAT",
          isSat: false,
          conflict: fdcConflict,
          sharedEqualities: Array.from(this.knownEqualities.values()),
          iterations: iteration,
          durationMs: performance.now() - startTime,
        };
      }

      // Phase 3: Collect newly propagated equalities, bounds, and disequalities from checked oracles only
      const filterToInterface = this.interfaceOnlyPropagation && this.oracles.size >= 2;
      for (const oracleName of checkingOracles) {
        const oracle = this.oracles.get(oracleName);
        if (!oracle) continue;
        const props = oracle.propagateEqualities();
        for (const eq of props) {
          if (filterToInterface && !this.isSharedInterfaceVar(eq.varA) && !this.isSharedInterfaceVar(eq.varB)) {
            continue;
          }
          const justs = eq.justifications ?? eq.justification ?? [];
          this.enqueueEvent({
            kind: "equality",
            varA: eq.varA,
            varB: eq.varB,
            domain: eq.domain,
            theoryDomain: oracle.domain,
            bounds: eq.bounds,
            strict: eq.strict,
            explanation: eq.explanation,
            sourceOracle: eq.sourceOracle ?? oracle.name,
            justification: justs,
          });
        }
        if (oracle.propagateDisequalities) {
          const diseqs = oracle.propagateDisequalities();
          for (const d of diseqs) {
            if (filterToInterface && !this.isSharedInterfaceVar(d.varA) && !this.isSharedInterfaceVar(d.varB)) {
              continue;
            }
            const dKey = this.makeEqualityKey(d.varA, d.varB);
            if (!this.knownDisequalities.has(dKey)) {
              this.enqueueEvent({
                kind: "disequality",
                varA: d.varA,
                varB: d.varB,
                theoryDomain: oracle.domain,
                explanation: d.explanation,
                sourceOracle: d.sourceOracle ?? oracle.name,
                justification: d.justifications ?? [],
              });
            }
          }
        }
      }

      // Phase 4: True fixpoint check — no dirty oracles and no newly enqueued worklist events
      if (this.dirtyOracles.size === 0 && this.worklist.length === 0) {
        break;
      }
    }

    // Combine models across all oracles
    const combinedModels: Record<string, unknown> = {};
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
