// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — High-Performance In-Engine CDCL SAT Solver.
 *
 * Implements:
 *   - Two-Watched-Literals scheme for O(1) Boolean Constraint Propagation (BCP).
 *   - 1-UIP (Unique Implication Point) conflict graph analysis and non-chronological backjumping.
 *   - VSIDS (Variable State Independent Decaying Sum) decision heuristics with geometric restarts (1.5× conflict limit growth).
 *   - Tseitin CNF transformation from propositional logic ASTs into equisatisfiable 3-CNF.
 *   - Incremental solving with assumptions and UNSAT core extraction for IC3/PDR.
 */

export type VarId = number; // 1-indexed: 1, 2, 3, ...
export type LitId = number; // Positive: +v, Negative: -v

export function litToVar(lit: LitId): VarId {
  return Math.abs(lit);
}

export function litSign(lit: LitId): boolean {
  return lit > 0;
}

export function negateLit(lit: LitId): LitId {
  return -lit;
}

export type SatStatus = "SAT" | "UNSAT" | "UNKNOWN";

export interface SatResult {
  status: SatStatus;
  model?: Map<VarId, boolean>;
  unsatCore?: LitId[];
}

/** Propositional AST for Tseitin transformation */
export type PropExpr =
  | { op: "var"; name?: string; id?: VarId }
  | { op: "const"; value: boolean }
  | { op: "not"; child: PropExpr }
  | { op: "and"; children: PropExpr[] }
  | { op: "or"; children: PropExpr[] }
  | { op: "implies"; left: PropExpr; right: PropExpr }
  | { op: "iff"; left: PropExpr; right: PropExpr }
  | { op: "xor"; left: PropExpr; right: PropExpr };

export class TseitinEncoder {
  private nextVarId = 1;
  private nameToVar = new Map<string, VarId>();
  private varToName = new Map<VarId, string>();
  public clauses: LitId[][] = [];

  public getOrCreateVar(name: string): VarId {
    let id = this.nameToVar.get(name);
    if (id === undefined) {
      id = this.nextVarId++;
      this.nameToVar.set(name, id);
      this.varToName.set(id, name);
    }
    return id;
  }

  public getVarName(id: VarId): string | undefined {
    return this.varToName.get(id);
  }

  public newAnonymousVar(): VarId {
    const id = this.nextVarId++;
    const name = `_aux_${id}`;
    this.nameToVar.set(name, id);
    this.varToName.set(id, name);
    return id;
  }

  public get numVars(): number {
    return this.nextVarId - 1;
  }

  /**
   * Encodes a propositional formula into equisatisfiable CNF, returning the representative literal.
   */
  public encode(expr: PropExpr): LitId {
    switch (expr.op) {
      case "var": {
        const v = expr.id ?? (expr.name !== undefined ? this.getOrCreateVar(expr.name) : this.newAnonymousVar());
        return v;
      }
      case "const": {
        const aux = this.newAnonymousVar();
        if (expr.value) {
          this.clauses.push([aux]); // aux must be true
        } else {
          this.clauses.push([-aux]); // aux must be false
        }
        return aux;
      }
      case "not": {
        const childLit = this.encode(expr.child);
        return -childLit;
      }
      case "and": {
        if (expr.children.length === 0) return this.encode({ op: "const", value: true });
        if (expr.children.length === 1) return this.encode(expr.children[0]!);
        const childLits = expr.children.map((c) => this.encode(c));
        const aux = this.newAnonymousVar();
        // aux <-> (c1 & c2 & ... & cn)
        // (aux -> c_i)  => (~aux | c_i)
        for (const cl of childLits) {
          this.clauses.push([-aux, cl]);
        }
        // (c1 & c2 & ... -> aux) => (~c1 | ~c2 | ... | aux)
        this.clauses.push([...childLits.map((l) => -l), aux]);
        return aux;
      }
      case "or": {
        if (expr.children.length === 0) return this.encode({ op: "const", value: false });
        if (expr.children.length === 1) return this.encode(expr.children[0]!);
        const childLits = expr.children.map((c) => this.encode(c));
        const aux = this.newAnonymousVar();
        // aux <-> (c1 | c2 | ... | cn)
        // (c_i -> aux) => (~c_i | aux)
        for (const cl of childLits) {
          this.clauses.push([-cl, aux]);
        }
        // (aux -> c1 | ... | cn) => (~aux | c1 | c2 | ... | cn)
        this.clauses.push([-aux, ...childLits]);
        return aux;
      }
      case "implies": {
        // a -> b  equiv (~a | b)
        return this.encode({
          op: "or",
          children: [{ op: "not", child: expr.left }, expr.right],
        });
      }
      case "iff": {
        // aux <-> (a <-> b)
        const l = this.encode(expr.left);
        const r = this.encode(expr.right);
        const aux = this.newAnonymousVar();
        // (~aux | ~l | r), (~aux | ~r | l), (aux | ~l | ~r), (aux | l | r)
        this.clauses.push([-aux, -l, r]);
        this.clauses.push([-aux, -r, l]);
        this.clauses.push([aux, -l, -r]);
        this.clauses.push([aux, l, r]);
        return aux;
      }
      case "xor": {
        // a xor b equiv ~(a <-> b)
        const iffLit = this.encode({ op: "iff", left: expr.left, right: expr.right });
        return -iffLit;
      }
    }
  }

  /**
   * Encodes a Boolean cardinality upper bound constraint (\sum_{i=1}^n lits[i] <= k) into CNF
   * using Carsten Sinz's sequential counter encoding.
   *
   * @param lits Array of input literals
   * @param k Maximum number of literals allowed to be true
   * @returns Array of CNF clauses enforcing \sum lits <= k
   */
  public encodeAtMostK(lits: LitId[], k: number): LitId[][] {
    const n = lits.length;
    if (k >= n) {
      return []; // Trivially satisfied
    }
    if (k < 0) {
      const aux = this.newAnonymousVar();
      const c: LitId[][] = [[aux], [-aux]];
      this.clauses.push(...c);
      return c;
    }
    if (k === 0) {
      const c = lits.map((l) => [-l]);
      this.clauses.push(...c);
      return c;
    }

    const clauses: LitId[][] = [];
    const s: VarId[][] = [];

    for (let i = 1; i <= n - 1; i++) {
      s[i] = [];
      for (let j = 1; j <= k; j++) {
        s[i]![j] = this.newAnonymousVar();
      }
    }

    // 1. For i = 1:
    clauses.push([-lits[0]!, s[1]![1]!]);
    for (let j = 2; j <= k; j++) {
      clauses.push([-s[1]![j]!]);
    }

    // 2. For 1 < i < n:
    for (let i = 2; i <= n - 1; i++) {
      const xi = lits[i - 1]!;
      clauses.push([-xi, s[i]![1]!]);
      clauses.push([-s[i - 1]![1]!, s[i]![1]!]);

      for (let j = 2; j <= k; j++) {
        clauses.push([-xi, -s[i - 1]![j - 1]!, s[i]![j]!]);
        clauses.push([-s[i - 1]![j]!, s[i]![j]!]);
      }
    }

    // 3. Overflow prohibition: for 1 < i <= n:
    for (let i = 2; i <= n; i++) {
      const xi = lits[i - 1]!;
      clauses.push([-xi, -s[i - 1]![k]!]);
    }

    this.clauses.push(...clauses);
    return clauses;
  }

  /**
   * Encodes a Boolean cardinality lower bound violation condition (\sum_{i=1}^n lits[i] > k),
   * returning a representative literal that is true iff the bound is exceeded.
   *
   * @param lits Array of input literals
   * @param k Cardinality threshold
   * @returns Representative LitId that is true iff \sum lits > k
   */
  public encodeGreaterThanK(lits: LitId[], k: number): LitId {
    const n = lits.length;
    if (k >= n) {
      return this.encode({ op: "const", value: false });
    }
    if (k < 0) {
      return this.encode({ op: "const", value: true });
    }
    if (k === 0) {
      return this.encode({ op: "or", children: lits.map((id) => ({ op: "var", id })) });
    }

    // Sinz sequential counter up to k without overflow prohibition:
    // s[i][j] indicates at least j of the first i literals are true.
    const s: VarId[][] = [];
    for (let i = 1; i <= n - 1; i++) {
      s[i] = [];
      for (let j = 1; j <= k; j++) {
        s[i]![j] = this.newAnonymousVar();
      }
    }

    // 1. For i = 1:
    this.clauses.push([-lits[0]!, s[1]![1]!]);
    this.clauses.push([-s[1]![1]!, lits[0]!]); // s_{1,1} => x_1
    for (let j = 2; j <= k; j++) {
      this.clauses.push([-s[1]![j]!]);
    }

    // 2. For 1 < i < n:
    for (let i = 2; i <= n - 1; i++) {
      const xi = lits[i - 1]!;
      // Forward: x_i => s_{i,1}, s_{i-1,1} => s_{i,1}
      this.clauses.push([-xi, s[i]![1]!]);
      this.clauses.push([-s[i - 1]![1]!, s[i]![1]!]);
      // Backward: s_{i,1} => (x_i | s_{i-1,1})
      this.clauses.push([-s[i]![1]!, xi, s[i - 1]![1]!]);

      for (let j = 2; j <= k; j++) {
        // Forward: (x_i & s_{i-1,j-1}) => s_{i,j}, s_{i-1,j} => s_{i,j}
        this.clauses.push([-xi, -s[i - 1]![j - 1]!, s[i]![j]!]);
        this.clauses.push([-s[i - 1]![j]!, s[i]![j]!]);
        // Backward: s_{i,j} => (s_{i-1,j} | s_{i-1,j-1}) and s_{i,j} => (s_{i-1,j} | x_i)
        this.clauses.push([-s[i]![j]!, s[i - 1]![j]!, s[i - 1]![j - 1]!]);
        this.clauses.push([-s[i]![j]!, s[i - 1]![j]!, xi]);
      }
    }

    // 3. Overflow condition:
    // Exceeding k occurs iff for some i in (k+1)..n, s[i-1][k] is true AND xi is true
    const overflowLits: LitId[] = [];
    for (let i = k + 1; i <= n; i++) {
      const xi = lits[i - 1]!;
      const prevK = s[i - 1]![k]!;
      const oLit = this.encode({
        op: "and",
        children: [
          { op: "var", id: prevK },
          { op: "var", id: xi },
        ],
      });
      overflowLits.push(oLit);
    }

    return this.encode({
      op: "or",
      children: overflowLits.map((id) => ({ op: "var", id })),
    });
  }
}

/**
 * Native Conflict-Driven Clause Learning (CDCL) SAT Solver.
 */
export class CdclSatSolver {
  private clauses: LitId[][] = [];
  private watchers: Map<LitId, number[]> = new Map(); // lit -> clause indices watching lit

  // Variable state: 0 = unassigned, 1 = true, -1 = false
  private assignments: Map<VarId, number> = new Map();
  private decisionLevel: Map<VarId, number> = new Map();
  private reasonClause: Map<VarId, number> = new Map(); // var -> clauseIdx that forced assignment
  private trail: LitId[] = [];
  private trailLim: number[] = []; // indices in trail for each decision level

  private activity: Map<VarId, number> = new Map();
  private varInc = 1.0;
  private readonly varDecay = 0.95;

  private currentLevel = 0;
  private maxVarId = 0;
  private isRootUnsat = false;

  public ensureVar(v: VarId): void {
    if (v > this.maxVarId) {
      this.maxVarId = v;
    }
    if (!this.activity.has(v)) {
      this.activity.set(v, 0.0);
    }
  }

  public addClause(clause: LitId[]): boolean {
    if (this.isRootUnsat) return false;
    if (this.currentLevel > 0) {
      this.backtrack(0);
    }
    // Simplify clause: remove duplicate literals, check for tautology (l and ~l)
    const set = new Set<LitId>();
    for (const lit of clause) {
      if (set.has(-lit)) return true; // Tautology, ignore
      set.add(lit);
      this.ensureVar(litToVar(lit));
    }

    const simplified = Array.from(set);
    if (simplified.length === 0) {
      this.isRootUnsat = true;
      return false; // Empty clause = unsatisfiable
    }

    if (simplified.length === 1) {
      const lit = simplified[0]!;
      this.clauses.push(simplified);
      const cIdx = this.clauses.length - 1;
      const ok = this.enqueue(lit, cIdx);
      if (!ok) {
        this.isRootUnsat = true;
        return false;
      }
      return true;
    }

    const cIdx = this.clauses.length;
    this.clauses.push(simplified);

    // Watch first two literals
    this.addWatcher(simplified[0]!, cIdx);
    this.addWatcher(simplified[1]!, cIdx);
    return true;
  }

  private addWatcher(lit: LitId, cIdx: number): void {
    let list = this.watchers.get(lit);
    if (!list) {
      list = [];
      this.watchers.set(lit, list);
    }
    list.push(cIdx);
  }

  private litValue(lit: LitId): number {
    const v = litToVar(lit);
    const assign = this.assignments.get(v) ?? 0;
    if (assign === 0) return 0;
    return litSign(lit) ? assign : -assign; // 1 = true, -1 = false
  }

  private enqueue(lit: LitId, reason = -1): boolean {
    const val = this.litValue(lit);
    if (val === 1) return true; // Already satisfied
    if (val === -1) return false; // Conflict!

    const v = litToVar(lit);
    const assignVal = litSign(lit) ? 1 : -1;
    this.assignments.set(v, assignVal);
    this.decisionLevel.set(v, this.currentLevel);
    if (reason !== -1) {
      this.reasonClause.set(v, reason);
    }
    this.trail.push(lit);
    return true;
  }

  /**
   * Boolean Constraint Propagation (BCP) with 2-watched-literals.
   * Returns conflicting clause index or -1 if no conflict.
   */
  private propagate(): number {
    let head = this.trailLim.length > 0 ? this.trailLim[this.trailLim.length - 1]! : 0;
    if (this.currentLevel === 0) head = 0;

    let pIdx = head;
    while (pIdx < this.trail.length) {
      const lit = this.trail[pIdx++]!;
      const falseLit = -lit; // clauses watching falseLit need new watchers
      const watchList = this.watchers.get(falseLit);
      if (!watchList) continue;

      const remainingWatches: number[] = [];
      for (let i = 0; i < watchList.length; i++) {
        const cIdx = watchList[i]!;
        const clause = this.clauses[cIdx]!;

        // Make sure falseLit is at clause[1]
        if (clause[0] === falseLit) {
          clause[0] = clause[1]!;
          clause[1] = falseLit;
        }

        const firstLit = clause[0]!;
        const firstVal = this.litValue(firstLit);

        // If first watcher is already satisfied, clause is satisfied
        if (firstVal === 1) {
          remainingWatches.push(cIdx);
          continue;
        }

        // Look for a new replacement watcher for clause[1]
        let foundNewWatcher = false;
        for (let j = 2; j < clause.length; j++) {
          if (this.litValue(clause[j]!) !== -1) {
            // Swap clause[1] and clause[j]
            clause[1] = clause[j]!;
            clause[j] = falseLit;
            this.addWatcher(clause[1]!, cIdx);
            foundNewWatcher = true;
            break;
          }
        }

        if (foundNewWatcher) continue;

        // No replacement watcher found. Clause is either unit or conflicting.
        remainingWatches.push(cIdx);
        if (firstVal === -1) {
          // Conflict!
          for (let k = i + 1; k < watchList.length; k++) {
            remainingWatches.push(watchList[k]!);
          }
          this.watchers.set(falseLit, remainingWatches);
          return cIdx;
        } else {
          // Unit propagation: firstLit must be true!
          if (!this.enqueue(firstLit, cIdx)) {
            return cIdx;
          }
        }
      }
      this.watchers.set(falseLit, remainingWatches);
    }
    return -1;
  }

  /**
   * 1-UIP (First Unique Implication Point) conflict analysis.
   */
  private analyzeConflict(conflictCIdx: number): { learnedClause: LitId[]; backtrackLevel: number } {
    const learned: LitId[] = [];
    let pathCount = 0;
    let pLit: LitId = 0;

    const seenVars = new Set<VarId>();
    let currentClause: LitId[] = this.clauses[conflictCIdx]!;

    let trailIdx = this.trail.length - 1;

    do {
      for (const lit of currentClause) {
        const v = litToVar(lit);
        const lvl = this.decisionLevel.get(v) ?? 0;

        if (!seenVars.has(v) && lvl > 0) {
          seenVars.add(v);
          this.bumpVarActivity(v);
          if (lvl === this.currentLevel) {
            pathCount++;
          } else {
            learned.push(lit);
          }
        }
      }

      // Find next variable on trail belonging to current decision level
      while (trailIdx >= 0) {
        const nextLit = this.trail[trailIdx--]!;
        const nextVar = litToVar(nextLit);
        if (seenVars.has(nextVar) && (this.decisionLevel.get(nextVar) ?? 0) === this.currentLevel) {
          pLit = nextLit;
          break;
        }
      }

      pathCount--;
      if (pathCount > 0) {
        const rCIdx = this.reasonClause.get(litToVar(pLit));
        if (rCIdx !== undefined && rCIdx !== -1) {
          currentClause = this.clauses[rCIdx]!;
        } else {
          break;
        }
      }
    } while (pathCount > 0);

    // 1-UIP literal is -pLit
    learned.unshift(-pLit);

    // Compute backjump level (highest decision level among other literals in learned clause)
    let backtrackLevel = 0;
    for (let i = 1; i < learned.length; i++) {
      const lvl = this.decisionLevel.get(litToVar(learned[i]!)) ?? 0;
      if (lvl > backtrackLevel) {
        backtrackLevel = lvl;
      }
    }

    this.decayVarActivity();
    return { learnedClause: learned, backtrackLevel };
  }

  public backtrack(level: number): void {
    if (this.currentLevel <= level) return;

    const targetTrailLim = level === 0 ? (this.trailLim[0] ?? 0) : this.trailLim[level - 1]!;
    while (this.trail.length > targetTrailLim) {
      const lit = this.trail.pop()!;
      const v = litToVar(lit);
      this.assignments.delete(v);
      this.decisionLevel.delete(v);
      this.reasonClause.delete(v);
    }

    this.trailLim.length = level;
    this.currentLevel = level;
  }

  private bumpVarActivity(v: VarId): void {
    const act = (this.activity.get(v) ?? 0) + this.varInc;
    this.activity.set(v, act);
  }

  private decayVarActivity(): void {
    this.varInc *= 1.0 / this.varDecay;
  }

  private pickBranchLit(): LitId | 0 {
    let bestVar: VarId = 0;
    let bestScore = -1;

    for (let v = 1; v <= this.maxVarId; v++) {
      if (!this.assignments.has(v)) {
        const score = this.activity.get(v) ?? 0;
        if (score > bestScore) {
          bestScore = score;
          bestVar = v;
        }
      }
    }

    if (bestVar === 0) return 0;
    return bestVar;
  }

  /**
   * Solves the propositional SAT problem under optional assumptions.
   */
  public solve(assumptions: LitId[] = []): SatResult {
    if (this.isRootUnsat) {
      return { status: "UNSAT" };
    }

    if (this.currentLevel > 0) {
      this.backtrack(0);
    }

    // Check level 0 consistency
    if (this.propagate() !== -1) {
      return { status: "UNSAT" };
    }

    // Apply assumptions
    for (const aLit of assumptions) {
      this.ensureVar(litToVar(aLit));
      this.currentLevel++;
      this.trailLim.push(this.trail.length);
      if (!this.enqueue(aLit, -1) || this.propagate() !== -1) {
        // Assumption caused immediate conflict
        this.backtrack(0);
        return { status: "UNSAT", unsatCore: [aLit] };
      }
    }

    const assumptionLevel = this.currentLevel;
    let restartConflictLimit = 100;
    let conflictsSinceRestart = 0;

    while (true) {
      const conflictCIdx = this.propagate();

      if (conflictCIdx !== -1) {
        if (this.currentLevel === 0) {
          return { status: "UNSAT" };
        }

        const { learnedClause, backtrackLevel } = this.analyzeConflict(conflictCIdx);

        if (backtrackLevel < assumptionLevel) {
          // Cannot backtrack past assumptions => UNSAT under assumptions
          this.backtrack(0);
          return { status: "UNSAT", unsatCore: assumptions };
        }

        this.backtrack(backtrackLevel);
        const newCIdx = this.clauses.length;
        this.clauses.push(learnedClause);

        if (learnedClause.length > 1) {
          this.addWatcher(learnedClause[0]!, newCIdx);
          this.addWatcher(learnedClause[1]!, newCIdx);
        }

        // Unit propagate the UIP literal
        this.enqueue(learnedClause[0]!, newCIdx);

        conflictsSinceRestart++;
        if (conflictsSinceRestart >= restartConflictLimit) {
          conflictsSinceRestart = 0;
          restartConflictLimit = Math.floor(restartConflictLimit * 1.5);
          this.backtrack(assumptionLevel);
        }
      } else {
        // Pick next unassigned literal
        const nextLit = this.pickBranchLit();
        if (nextLit === 0) {
          // All variables assigned and satisfied!
          const model = new Map<VarId, boolean>();
          for (let v = 1; v <= this.maxVarId; v++) {
            model.set(v, (this.assignments.get(v) ?? 1) === 1);
          }
          return { status: "SAT", model };
        }

        // Branch
        this.currentLevel++;
        this.trailLim.push(this.trail.length);
        this.enqueue(nextLit, -1);
      }
    }
  }
}
