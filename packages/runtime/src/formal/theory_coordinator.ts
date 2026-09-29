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
  | "algebraic"
  | "custom";

export type CancellationTokenLike = { isCancellationRequested?: boolean; aborted?: boolean } | AbortSignal;

export interface FunctionApplicationTerm {
  functionName: string;
  args: string[];
  resultVar: string;
  literalId: number;
}

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
  justifications?: number[];
  justification?: number[];
}

export interface ConflictClause {
  literals: TheoryLiteral[];
  explanation: string;
  culpritEntities: string[];
  theoryName: string;
}

export interface CoordinatorSatResult {
  status: "SAT" | "UNSAT" | "UNKNOWN";
  isSat: boolean;
  conflict?: ConflictClause;
  sharedEqualities: SharedEquality[];
  models?: Record<string, any>;
  iterations: number;
  durationMs: number;
  reason?: string;
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
  private canonicalBoundJustifications = new Map<string, Set<number>>();
  private varSubscribers = new Map<string, Set<TheoryOracle>>();
  private canonSubscribers = new Map<string, Set<TheoryOracle>>();
  private domainSubscribers = new Map<TheoryDomain, Set<TheoryOracle>>();
  private dirtyOracles = new Set<string>();
  private worklist: PropagationEvent[] = [];
  private memoizedResult?: { revision: number; result: CoordinatorSatResult };
  private infeasibleConflict?: ConflictClause;
  private functionTerms: FunctionApplicationTerm[] = [];
  private levelStack: {
    literalIds: number[];
    equalityKeys: string[];
    worklistSnapshot?: PropagationEvent[];
    parentSnapshot?: Map<string, string>;
    boundsSnapshot?: Map<string, [number, number]>;
    canonSubscribersSnapshot?: Map<string, Set<TheoryOracle>>;
    boundJustificationsSnapshot?: Map<string, Set<number>>;
    infeasibleConflictSnapshot?: ConflictClause;
    functionTermsSnapshot?: FunctionApplicationTerm[];
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
   * Retracts an asserted literal from all oracles.
   */
  public retractLiteral(litId: number): void {
    if (!this.activeLiterals.has(litId)) return;
    const lit = this.activeLiterals.get(litId)!;
    this.activeLiterals.delete(litId);
    this.memoizedResult = undefined;
    this.worklist = this.worklist.filter((e) => !e.justification || !e.justification.includes(litId));
    this.functionTerms = this.functionTerms.filter((t) => t.literalId !== litId);
    for (const jSet of this.canonicalBoundJustifications.values()) {
      jSet.delete(litId);
    }
    this.infeasibleConflict = undefined;

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
    const canon = this.getCanonicalVar(varName);
    const canonSubs = this.canonSubscribers.get(canon);
    if (canonSubs && canonSubs.has(oracle)) return true;

    const directSubs = this.varSubscribers.get(varName);
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

  /**
   * Generates a canonical equality key for undirected pairs: (min, max).
   */
  private makeEqualityKey(varA: string, varB: string): string {
    return varA < varB ? `${varA}===#===${varB}` : `${varB}===#===${varA}`;
  }

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
  ): { unsat?: CoordinatorSatResult; eventsProcessed: number } {
    let eventsProcessed = 0;
    while (this.worklist.length > 0) {
      const event = this.worklist.shift()!;
      if (event.kind === "equality") {
        const key = this.makeEqualityKey(event.varA, event.varB);
        const existing = this.knownEqualities.get(key);
        let isNewOrTightened = false;

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

        const isTargetedByDomain = (oracle: TheoryOracle, ev: PropagationEvent): boolean => {
          if (ev.kind === "bound") {
            return (
              oracle.name === "ConstraintTheoryOracle" ||
              oracle.name === "SpatialPhysicsOracle" ||
              oracle.name === "ToleranceStackOracle"
            );
          }
          return (
            oracle.name === "ConstraintTheoryOracle" || (ev.theoryDomain ? oracle.domain === ev.theoryDomain : false)
          );
        };

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
        const isTargetedByDomain = (oracle: TheoryOracle, ev: PropagationEvent): boolean => {
          if (ev.kind === "bound") {
            return (
              oracle.name === "ConstraintTheoryOracle" ||
              oracle.name === "SpatialPhysicsOracle" ||
              oracle.name === "ToleranceStackOracle"
            );
          }
          return (
            oracle.name === "ConstraintTheoryOracle" || (ev.theoryDomain ? oracle.domain === ev.theoryDomain : false)
          );
        };

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
