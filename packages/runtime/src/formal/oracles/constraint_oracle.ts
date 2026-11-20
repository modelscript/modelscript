// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Constraint Theory Oracle (DPLL(T) / LRA / LIA / Interval HC4).
 *
 * Handles continuous and integer numerical bounds, strict inequalities (`<`, `>`),
 * constant disequalities (`!=`), linear arithmetic hyperplanes (via persistent warm-started
 * Dutertre–de Moura Simplex + Gomory Mixed-Integer cuts), and nonlinear HC4 contraction.
 * Propagates tightened bounds, equalities, and disequalities in the Nelson-Oppen loop.
 */

import { Interval, intersectInterval } from "../../analysis/wasm_interval.js";
import { type ExprNode, Hc4Contractor, type NonlinearConstraint } from "../hc4_contractor.js";
import { type LinearOp, LraSimplexSolver } from "../lra_simplex.js";
import type {
  ConflictClause,
  SharedDisequality,
  SharedEquality,
  TheoryLiteral,
  TheoryOracle,
} from "../theory_coordinator.js";
import { hasSharedEqualityWithLiteral, retainSharedEqualitiesWithoutLiteral } from "./retraction_utils.js";
import { UndoTrail } from "./undo_trail.js";

export class ConstraintTheoryOracle implements TheoryOracle {
  public readonly name = "ConstraintTheoryOracle";
  public readonly domain = "constraint" as const;

  // Map of canonical variable -> Interval (or null if empty/infeasible)
  private intervals = new Map<string, Interval | null>();
  /** Open-endpoint flags `[loOpen, hiOpen]` for strict inequalities (`>` / `<`). */
  private boundStrict = new Map<string, [boolean, boolean]>();
  /** Disallowed point values (`x != val`) per canonical variable. */
  private disallowedValues = new Map<string, Map<number, number[]>>();
  /** Last propagated bounds per canonical variable to avoid redundant interval broadcasts. */
  private propagatedBounds = new Map<string, [number, number]>();
  /** Equalities deduced by the LRA/LIA Simplex solver during checkSat(). */
  private lraDeducedEqualities: { varA: string; varB: string; justs: number[] }[] = [];
  /** Variables constrained to integer values (for LIA branch-and-bound / GMI cuts). */
  private integerVars = new Set<string>();
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private propagatedEqualities = new Set<string>();
  private aliases = new Map<string, string>();
  private varJustifications = new Map<string, Set<number>>();
  private oppositeSignPairs = new Map<string, Set<string>>();
  private sharedEqualities: SharedEquality[] = [];
  private trail = new UndoTrail();
  /** Persistent warm-started Dutertre–de Moura Simplex tableau synced with pushLevel()/popLevel(). */
  private simplex = new LraSimplexSolver();
  /** Hyperplane literal IDs already asserted into the persistent Simplex tableau. */
  private simplexLoadedHyperplanes = new Set<number>();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.intervals.clear();
    this.boundStrict.clear();
    this.disallowedValues.clear();
    this.propagatedBounds.clear();
    this.lraDeducedEqualities = [];
    this.integerVars.clear();
    this.assertedLiterals.clear();
    this.propagatedEqualities.clear();
    this.aliases.clear();
    this.varJustifications.clear();
    this.oppositeSignPairs.clear();
    this.sharedEqualities = [];
    this.simplexLoadedHyperplanes.clear();
    this.simplex.reset();
    this.trail.reset();
  }

  public pushLevel(): void {
    this.trail.pushLevel();
    this.simplex.pushLevel();
  }

  public popLevel(): void {
    this.trail.popLevel();
    this.simplex.popLevel();
  }

  private getCanonicalVar(v: string): string {
    const directParent = this.aliases.get(v);
    if (!directParent || directParent === v) {
      return v;
    }
    const grandParent = this.aliases.get(directParent);
    if (!grandParent || grandParent === directParent) {
      return directParent;
    }

    let curr = v;
    const visited = new Set<string>();
    const path: string[] = [];
    while (true) {
      const parent = this.aliases.get(curr);
      if (!parent || parent === curr || visited.has(curr)) {
        break;
      }
      visited.add(curr);
      path.push(curr);
      curr = parent;
    }
    const root = curr;
    for (const node of path) {
      if (this.aliases.get(node) !== root) {
        this.trail.mapSet(this.aliases, node, root);
      }
    }
    return root;
  }

  private mergeStrictFlags(
    canon: string,
    prevInt: Interval | null,
    newInt: Interval,
    newLoOpen: boolean,
    newHiOpen: boolean,
  ): void {
    const prevStrict = this.boundStrict.get(canon) ?? [false, false];
    let loOpen = prevStrict[0];
    let hiOpen = prevStrict[1];
    if (!prevInt) {
      loOpen = newLoOpen;
      hiOpen = newHiOpen;
    } else {
      const loEps = 1e-12 * Math.max(Math.abs(prevInt.lo), Math.abs(newInt.lo));
      const hiEps = 1e-12 * Math.max(Math.abs(prevInt.hi), Math.abs(newInt.hi));
      if (newInt.lo > prevInt.lo + loEps) loOpen = newLoOpen;
      else if (Math.abs(newInt.lo - prevInt.lo) <= loEps) loOpen = prevStrict[0] || newLoOpen;

      if (newInt.hi < prevInt.hi - hiEps) hiOpen = newHiOpen;
      else if (Math.abs(newInt.hi - prevInt.hi) <= hiEps) hiOpen = prevStrict[1] || newHiOpen;
    }
    if (loOpen || hiOpen || this.boundStrict.has(canon)) {
      this.trail.mapSet(this.boundStrict, canon, [loOpen, hiOpen]);
    }
  }

  private mirrorOppositeSignBounds(canon: string): void {
    const partners = this.oppositeSignPairs.get(canon);
    if (!partners || partners.size === 0) return;
    const intA = this.getInterval(canon);
    const jA = this.varJustifications.get(canon);
    const strictA = this.boundStrict.get(canon) ?? [false, false];
    for (const rawPartner of partners) {
      const canonB = this.getCanonicalVar(rawPartner);
      if (jA) {
        let setB = this.varJustifications.get(canonB);
        if (!setB) {
          setB = new Set();
          this.trail.mapSet(this.varJustifications, canonB, setB);
        }
        for (const id of jA) this.trail.setAdd(setB, id);
      }
      if (intA === null) {
        this.trail.mapSet(this.intervals, canonB, null);
      } else {
        const negA = new Interval(-intA.hi, -intA.lo);
        const intB = this.getInterval(canonB);
        this.mergeStrictFlags(canonB, intB, negA, strictA[1], strictA[0]);
        this.trail.mapSet(this.intervals, canonB, intB ? intersectInterval(intB, negA) : null);
      }
    }
  }

  private registerOppositeSignEquality(rawA: string, rawB: string, justIds: Iterable<number>): void {
    const canonA = this.getCanonicalVar(rawA);
    const canonB = this.getCanonicalVar(rawB);
    let setA = this.varJustifications.get(canonA);
    if (!setA) {
      setA = new Set();
      this.trail.mapSet(this.varJustifications, canonA, setA);
    }
    let setB = this.varJustifications.get(canonB);
    if (!setB) {
      setB = new Set();
      this.trail.mapSet(this.varJustifications, canonB, setB);
    }
    for (const id of justIds) {
      this.trail.setAdd(setA, id);
      this.trail.setAdd(setB, id);
    }
    for (const id of setA) this.trail.setAdd(setB, id);
    for (const id of setB) this.trail.setAdd(setA, id);

    let ospA = this.oppositeSignPairs.get(canonA);
    if (!ospA) {
      ospA = new Set();
      this.trail.mapSet(this.oppositeSignPairs, canonA, ospA);
    }
    let ospB = this.oppositeSignPairs.get(canonB);
    if (!ospB) {
      ospB = new Set();
      this.trail.mapSet(this.oppositeSignPairs, canonB, ospB);
    }
    this.trail.setAdd(ospA, canonB);
    this.trail.setAdd(ospB, canonA);

    const intA = this.getInterval(canonA);
    const intB = this.getInterval(canonB);
    if (intA === null || intB === null) {
      this.trail.mapSet(this.intervals, canonA, null);
      this.trail.mapSet(this.intervals, canonB, null);
    } else {
      const negB = new Interval(-intB.hi, -intB.lo);
      const negA = new Interval(-intA.hi, -intA.lo);
      this.trail.mapSet(this.intervals, canonA, intersectInterval(intA, negB));
      this.trail.mapSet(this.intervals, canonB, intersectInterval(intB, negA));
    }
  }

  private unionVars(a: string, b: string): void {
    const rootA = this.getCanonicalVar(a);
    const rootB = this.getCanonicalVar(b);
    if (rootA !== rootB) {
      this.trail.mapSet(this.aliases, rootA, rootB);
      // Merge intervals
      const intA = this.intervals.get(rootA) ?? new Interval(-Infinity, Infinity);
      const intB = this.intervals.get(rootB) ?? new Interval(-Infinity, Infinity);
      const stA = this.boundStrict.get(rootA) ?? [false, false];
      if (intA && intB) {
        this.mergeStrictFlags(rootB, intB, intA, stA[0], stA[1]);
      }
      const merged = intA && intB ? intersectInterval(intA, intB) : null;
      this.trail.mapSet(this.intervals, rootB, merged);

      // Merge disallowed point values
      const disA = this.disallowedValues.get(rootA);
      if (disA && disA.size > 0) {
        let disB = this.disallowedValues.get(rootB);
        if (!disB) {
          disB = new Map();
          this.trail.mapSet(this.disallowedValues, rootB, disB);
        }
        for (const [val, justs] of disA.entries()) {
          if (!disB.has(val)) this.trail.mapSet(disB, val, [...justs]);
        }
      }

      // Merge integer constraint
      if (this.integerVars.has(rootA)) {
        this.trail.setAdd(this.integerVars, rootB);
      }

      // Merge justifications
      const jA = this.varJustifications.get(rootA);
      if (jA && jA.size > 0) {
        let setB = this.varJustifications.get(rootB);
        if (!setB) {
          setB = new Set();
          this.trail.mapSet(this.varJustifications, rootB, setB);
        }
        for (const id of jA) this.trail.setAdd(setB, id);
      }

      // Merge opposite-sign pairs
      const ospA = this.oppositeSignPairs.get(rootA);
      if (ospA) {
        let ospB = this.oppositeSignPairs.get(rootB);
        if (!ospB) {
          ospB = new Set();
          this.trail.mapSet(this.oppositeSignPairs, rootB, ospB);
        }
        for (const p of ospA) this.trail.setAdd(ospB, p);
      }
      this.mirrorOppositeSignBounds(rootB);
      if (this.simplexLoadedHyperplanes.size > 0) {
        const jSet = this.varJustifications.get(rootB);
        const firstJust = jSet ? jSet.values().next().value : -1;
        this.simplex.assertConstraint({
          coeffs: { [rootA]: 1, [rootB]: -1 },
          op: "==",
          rhs: 0,
          litId: firstJust ?? -1,
        });
      }
    }
  }

  public getInterval(varName: string): Interval | null {
    const canon = this.getCanonicalVar(varName);
    if (this.intervals.has(canon)) {
      return this.intervals.get(canon) ?? null;
    }
    return new Interval(-Infinity, Infinity);
  }

  private recordPropagatedBound(canon: string, int: Interval | null): void {
    if (int && (Number.isFinite(int.lo) || Number.isFinite(int.hi))) {
      this.trail.mapSet(this.propagatedBounds, canon, [int.lo, int.hi]);
    }
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.trail.mapSet(this.assertedLiterals, lit.id, lit);
    const { predicate, args } = lit;

    switch (predicate) {
      case "integer":
      case "intVar": {
        if (Array.isArray(args[0])) {
          for (const v of args[0]) {
            if (typeof v === "string") {
              this.trail.setAdd(this.integerVars, this.getCanonicalVar(v));
            }
          }
        } else if (typeof args[0] === "string") {
          this.trail.setAdd(this.integerVars, this.getCanonicalVar(args[0]));
        }
        break;
      }
      case "bound": {
        const [varName, op, val] = args as [string, "<=" | "<" | ">=" | ">" | "==" | "!=", number];
        const canon = this.getCanonicalVar(varName);
        let jSet = this.varJustifications.get(canon);
        if (!jSet) {
          jSet = new Set();
          this.trail.mapSet(this.varJustifications, canon, jSet);
        }
        this.trail.setAdd(jSet, lit.id);

        if (op === "!=") {
          let disMap = this.disallowedValues.get(canon);
          if (!disMap) {
            disMap = new Map();
            this.trail.mapSet(this.disallowedValues, canon, disMap);
          }
          const existing = disMap.get(val);
          this.trail.mapSet(disMap, val, existing ? [...existing, lit.id] : [lit.id]);
          break;
        }

        const curr = this.getInterval(canon);
        if (!curr) {
          this.trail.mapSet(this.intervals, canon, null);
          this.mirrorOppositeSignBounds(canon);
          break;
        }

        let boundInt: Interval;
        let loOpen = false;
        let hiOpen = false;
        if (op === "<=" || op === "<") {
          boundInt = new Interval(-Infinity, val);
          hiOpen = op === "<";
        } else if (op === ">=" || op === ">") {
          boundInt = new Interval(val, Infinity);
          loOpen = op === ">";
        } else if (op === "==") {
          boundInt = new Interval(val, val);
        } else {
          boundInt = new Interval(-Infinity, Infinity);
        }

        this.mergeStrictFlags(canon, curr, boundInt, loOpen, hiOpen);
        const next = intersectInterval(curr, boundInt);
        this.trail.mapSet(this.intervals, canon, next);
        this.recordPropagatedBound(canon, next);
        this.mirrorOppositeSignBounds(canon);
        break;
      }
      case "equal": {
        const [rawA, rawB] = args;
        const varA = typeof rawA === "string" ? rawA : String(rawA ?? "");
        const varB = typeof rawB === "string" ? rawB : String(rawB ?? "");
        const negA = varA.startsWith("-");
        const negB = varB.startsWith("-");
        const cleanA = negA ? varA.slice(1) : varA;
        const cleanB = negB ? varB.slice(1) : varB;
        if (negA !== negB) {
          this.registerOppositeSignEquality(cleanA, cleanB, [lit.id]);
        } else {
          const canonA = this.getCanonicalVar(cleanA);
          const canonB = this.getCanonicalVar(cleanB);
          let jA = this.varJustifications.get(canonA);
          if (!jA) {
            jA = new Set();
            this.trail.mapSet(this.varJustifications, canonA, jA);
          }
          this.trail.setAdd(jA, lit.id);
          let jB = this.varJustifications.get(canonB);
          if (!jB) {
            jB = new Set();
            this.trail.mapSet(this.varJustifications, canonB, jB);
          }
          this.trail.setAdd(jB, lit.id);

          this.unionVars(cleanA, cleanB);
        }
        break;
      }
      case "interval": {
        const [varName, lo, hi] = args as [string, number, number];
        const canon = this.getCanonicalVar(varName);
        let jSet = this.varJustifications.get(canon);
        if (!jSet) {
          jSet = new Set();
          this.trail.mapSet(this.varJustifications, canon, jSet);
        }
        this.trail.setAdd(jSet, lit.id);

        const curr = this.getInterval(canon);
        if (!curr) {
          this.trail.mapSet(this.intervals, canon, null);
        } else {
          const next = intersectInterval(curr, new Interval(lo, hi));
          this.trail.mapSet(this.intervals, canon, next);
          this.recordPropagatedBound(canon, next);
        }
        this.mirrorOppositeSignBounds(canon);
        break;
      }
      case "hyperplane":
      case "nonlinear":
      case "expr": {
        this.applyRelationalLiteral(lit);
        break;
      }
    }

    return true;
  }

  private canonicalizeExpr(expr: ExprNode, varsOut: Set<string>): ExprNode {
    switch (expr.kind) {
      case "var": {
        const canon = this.getCanonicalVar(expr.name);
        varsOut.add(canon);
        return { kind: "var", name: canon };
      }
      case "const":
        return expr;
      case "neg":
      case "sqr":
      case "sqrt":
      case "sin":
      case "cos":
        return { kind: expr.kind, child: this.canonicalizeExpr(expr.child, varsOut) };
      case "add":
      case "sub":
      case "mul":
      case "div":
      case "pow":
        return {
          kind: expr.kind,
          left: this.canonicalizeExpr(expr.left, varsOut),
          right: this.canonicalizeExpr(expr.right, varsOut),
        };
      case "call":
        return {
          kind: "call",
          fn: expr.fn,
          args: expr.args.map((a) => this.canonicalizeExpr(a, varsOut)),
        };
    }
  }

  private applyRelationalLiteral(lit: TheoryLiteral): void {
    const { predicate, args } = lit;
    if (predicate === "hyperplane") {
      let coeffs: Record<string, number>;
      let op: LinearOp;
      let rhsVal: number;
      if (
        args.length === 1 &&
        typeof args[0] === "object" &&
        args[0] !== null &&
        "coeffs" in (args[0] as Record<string, unknown>)
      ) {
        const obj = args[0] as { coeffs: Record<string, number>; op: LinearOp; rhs: number };
        coeffs = obj.coeffs;
        op = obj.op;
        rhsVal = obj.rhs;
      } else {
        [coeffs, op, rhsVal] = args as [Record<string, number>, LinearOp, number];
      }
      if (!coeffs) return;
      const box = new Map<string, Interval>();
      let sumExpr: ExprNode | null = null;
      let isAlreadyInfeasible = false;

      for (const [vName, coeff] of Object.entries(coeffs)) {
        const canon = this.getCanonicalVar(vName);
        let jSet = this.varJustifications.get(canon);
        if (!jSet) {
          jSet = new Set();
          this.trail.mapSet(this.varJustifications, canon, jSet);
        }
        this.trail.setAdd(jSet, lit.id);

        const current = this.getInterval(canon);
        if (current === null) {
          isAlreadyInfeasible = true;
          break;
        }
        box.set(canon, new Interval(current.lo, current.hi));
        const termExpr: ExprNode = {
          kind: "mul",
          left: { kind: "const", value: coeff },
          right: { kind: "var", name: canon },
        };
        sumExpr = sumExpr ? { kind: "add", left: sumExpr, right: termExpr } : termExpr;
      }

      if (isAlreadyInfeasible || !sumExpr) return;

      const hc4Op: ">=" | "<=" | "==" = op === "<" ? "<=" : op === ">" ? ">=" : op;
      const constraint: NonlinearConstraint = {
        expr: sumExpr,
        rel: hc4Op,
        rhs: rhsVal,
      };
      const valid = Hc4Contractor.revise(constraint, box);
      if (!valid) {
        for (const vName of Object.keys(coeffs)) {
          const canon = this.getCanonicalVar(vName);
          this.trail.mapSet(this.intervals, canon, null);
        }
      } else {
        for (const [canon, contractedInt] of box.entries()) {
          const prev = this.getInterval(canon);
          this.trail.mapSet(this.intervals, canon, prev ? intersectInterval(prev, contractedInt) : contractedInt);
          this.mirrorOppositeSignBounds(canon);
        }
      }
    } else if (predicate === "nonlinear" || predicate === "expr") {
      const [rawConstraint] = args as [NonlinearConstraint];
      if (!rawConstraint || !rawConstraint.expr) return;
      const exprVars = new Set<string>();
      const canonExpr = this.canonicalizeExpr(rawConstraint.expr, exprVars);
      const constraint: NonlinearConstraint = {
        expr: canonExpr,
        rel: rawConstraint.rel,
        rhs: rawConstraint.rhs,
      };
      const box = new Map<string, Interval>();
      for (const canon of exprVars) {
        let jSet = this.varJustifications.get(canon);
        if (!jSet) {
          jSet = new Set();
          this.trail.mapSet(this.varJustifications, canon, jSet);
        }
        this.trail.setAdd(jSet, lit.id);
        const current = this.getInterval(canon);
        if (current === null) return;
        box.set(canon, new Interval(current.lo, current.hi));
      }
      const valid = Hc4Contractor.revise(constraint, box);
      if (!valid) {
        for (const canon of exprVars) {
          this.trail.mapSet(this.intervals, canon, null);
        }
      } else {
        for (const [canon, contractedInt] of box.entries()) {
          const prev = this.getInterval(canon);
          this.trail.mapSet(this.intervals, canon, prev ? intersectInterval(prev, contractedInt) : contractedInt);
          this.mirrorOppositeSignBounds(canon);
        }
      }
    }
  }

  public retractLiteral(litId: number): void {
    const lit = this.assertedLiterals.get(litId);
    const hasShared = hasSharedEqualityWithLiteral(this.sharedEqualities, litId);
    if (!lit && !hasShared) return;

    // Fast path: single-variable bound/interval retraction at decision depth 0 with no aliases,
    // opposite-sign pairings, relational constraints, or dependent shared equalities.
    if (
      lit &&
      !hasShared &&
      this.trail.depth === 0 &&
      (lit.predicate === "interval" || lit.predicate === "bound") &&
      typeof lit.args[0] === "string"
    ) {
      const targetVar = lit.args[0];
      const canon = this.getCanonicalVar(targetVar);
      const hasRelational =
        this.simplexLoadedHyperplanes.size > 0 ||
        Array.from(this.assertedLiterals.values()).some(
          (l) => l.predicate === "hyperplane" || l.predicate === "nonlinear" || l.predicate === "expr",
        );
      if (
        canon === targetVar &&
        !this.aliases.has(targetVar) &&
        !this.oppositeSignPairs.has(targetVar) &&
        !hasRelational
      ) {
        this.assertedLiterals.delete(litId);
        this.intervals.delete(targetVar);
        this.boundStrict.delete(targetVar);
        this.disallowedValues.delete(targetVar);
        this.propagatedBounds.delete(targetVar);
        this.varJustifications.delete(targetVar);

        // Re-apply only literals affecting targetVar
        for (const rem of this.assertedLiterals.values()) {
          if ((rem.predicate === "interval" || rem.predicate === "bound") && rem.args[0] === targetVar) {
            this.assertLiteral(rem);
          }
        }
        return;
      }
    }

    // Full replay fallback
    const savedDepth = this.trail.depth;
    this.assertedLiterals.delete(litId);
    const remaining = Array.from(this.assertedLiterals.values());
    const savedShared = retainSharedEqualitiesWithoutLiteral(this.sharedEqualities, litId);
    this.reset();
    for (const remLit of remaining) {
      this.assertLiteral(remLit);
    }
    for (const eq of savedShared) {
      this.onSharedEquality(eq);
    }
    for (let i = 0; i < savedDepth; i++) {
      this.pushLevel();
    }
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    for (const lit of this.assertedLiterals.values()) {
      if (lit.predicate === "hyperplane" || lit.predicate === "nonlinear" || lit.predicate === "expr") {
        this.applyRelationalLiteral(lit);
      }
    }

    for (const [varName, interval] of this.intervals.entries()) {
      const strict = this.boundStrict.get(varName) ?? [false, false];
      let effectiveInterval = interval;
      let effStrict: [boolean, boolean] = [strict[0], strict[1]];

      // Integer domain endpoint tightening: [lo, hi] -> [ceil(lo), floor(hi)]
      if (effectiveInterval && this.integerVars.has(varName)) {
        let intLo = effectiveInterval.lo;
        let intHi = effectiveInterval.hi;
        if (Number.isFinite(intLo)) {
          intLo = effStrict[0] ? Math.floor(intLo) + 1 : Math.ceil(intLo - 1e-12);
          effStrict = [false, effStrict[1]];
        }
        if (Number.isFinite(intHi)) {
          intHi = effStrict[1] ? Math.ceil(intHi) - 1 : Math.floor(intHi + 1e-12);
          effStrict = [effStrict[0], false];
        }
        if (intLo > intHi) {
          effectiveInterval = null;
        } else if (intLo !== effectiveInterval.lo || intHi !== effectiveInterval.hi) {
          effectiveInterval = new Interval(intLo, intHi);
          this.trail.mapSet(this.intervals, varName, effectiveInterval);
          this.trail.mapSet(this.boundStrict, varName, effStrict);
        }
      }

      const eps = effectiveInterval
        ? 1e-12 * Math.max(Math.abs(effectiveInterval.lo), Math.abs(effectiveInterval.hi))
        : 0;
      const isEmpty =
        effectiveInterval === null ||
        effectiveInterval.lo > effectiveInterval.hi + eps ||
        ((effStrict[0] || effStrict[1]) && Math.abs(effectiveInterval.lo - effectiveInterval.hi) <= eps);

      if (isEmpty) {
        const culpritLitIds = this.varJustifications.get(varName) ?? new Set<number>();
        const culprits: TheoryLiteral[] = [];
        for (const id of culpritLitIds) {
          const l = this.assertedLiterals.get(id);
          if (l) {
            culprits.push(l);
          } else {
            culprits.push({
              id,
              predicate: "crossTheoryAntecedent",
              args: [varName],
            });
          }
        }

        for (const l of this.assertedLiterals.values()) {
          if (
            (l.args.includes(varName) || this.getCanonicalVar(l.args[0] as string) === varName) &&
            !culpritLitIds.has(l.id)
          ) {
            culprits.push(l);
          }
        }

        return {
          isSat: false,
          conflict: {
            literals: culprits,
            explanation: `Arithmetic Bound Conflict: Variable '${varName}' has empty interval. Lower bound exceeds upper bound.`,
            culpritEntities: [varName],
            theoryName: this.name,
          },
        };
      }

      // Check disallowed point values (`!=`) when interval collapses to a point
      if (
        effectiveInterval &&
        Number.isFinite(effectiveInterval.lo) &&
        Number.isFinite(effectiveInterval.hi) &&
        Math.abs(effectiveInterval.lo - effectiveInterval.hi) <= eps
      ) {
        const disMap = this.disallowedValues.get(varName);
        if (disMap && disMap.size > 0) {
          const pt = (effectiveInterval.lo + effectiveInterval.hi) * 0.5;
          for (const [forbVal, forbJusts] of disMap.entries()) {
            const pEps = 1e-12 * Math.max(Math.abs(pt), Math.abs(forbVal));
            if (Math.abs(pt - forbVal) <= pEps) {
              const allIds = new Set<number>(forbJusts);
              const jSet = this.varJustifications.get(varName);
              if (jSet) for (const id of jSet) allIds.add(id);
              const culprits: TheoryLiteral[] = [];
              for (const id of allIds) {
                const l = this.assertedLiterals.get(id);
                culprits.push(l ?? { id, predicate: "crossTheoryAntecedent", args: [varName] });
              }
              return {
                isSat: false,
                conflict: {
                  literals: culprits,
                  explanation: `Arithmetic Disequality Conflict: Variable '${varName}' is constrained to ${pt} but must satisfy != ${forbVal}.`,
                  culpritEntities: [varName],
                  theoryName: this.name,
                },
              };
            }
          }
        }
      }
    }

    // Complete LRA / LIA Simplex feasibility & implied-equality pass over persistent warm-started tableau
    this.lraDeducedEqualities = [];
    let hasHyperplanes = this.simplexLoadedHyperplanes.size > 0;
    const newHyperplanes: { coeffs: Record<string, number>; op: LinearOp; rhs: number; litId: number }[] = [];
    for (const lit of this.assertedLiterals.values()) {
      if (lit.predicate === "hyperplane") {
        hasHyperplanes = true;
        if (this.simplexLoadedHyperplanes.has(lit.id)) continue;
        let rawCoeffs: Record<string, number> | undefined;
        let op: LinearOp | undefined;
        let rhs: number | undefined;
        if (
          lit.args.length === 1 &&
          typeof lit.args[0] === "object" &&
          lit.args[0] !== null &&
          "coeffs" in (lit.args[0] as Record<string, unknown>)
        ) {
          const obj = lit.args[0] as { coeffs: Record<string, number>; op: LinearOp; rhs: number };
          rawCoeffs = obj.coeffs;
          op = obj.op;
          rhs = obj.rhs;
        } else {
          [rawCoeffs, op, rhs] = lit.args as [Record<string, number>, LinearOp, number];
        }
        if (rawCoeffs && op && typeof rhs === "number") {
          const canonCoeffs: Record<string, number> = {};
          for (const [vName, c] of Object.entries(rawCoeffs)) {
            const canon = this.getCanonicalVar(vName);
            canonCoeffs[canon] = (canonCoeffs[canon] ?? 0) + c;
          }
          newHyperplanes.push({ coeffs: canonCoeffs, op, rhs, litId: lit.id });
        }
      }
    }

    if (hasHyperplanes) {
      for (const intVar of this.integerVars) {
        this.simplex.markIntegerVar(this.getCanonicalVar(intVar));
      }
      for (const [v, int] of this.intervals.entries()) {
        if (!int) continue;
        const canon = this.getCanonicalVar(v);
        const st = this.boundStrict.get(canon) ?? [false, false];
        const jSet = this.varJustifications.get(canon);
        const firstJust = jSet ? jSet.values().next().value : undefined;
        this.simplex.assertVarBound(canon, int.lo, int.hi, st[0], st[1], firstJust);
      }
      for (const hp of newHyperplanes) {
        this.simplex.assertConstraint(hp);
        this.trail.setAdd(this.simplexLoadedHyperplanes, hp.litId);
      }
      const lraRes = this.integerVars.size > 0 ? this.simplex.checkSatLia() : this.simplex.checkSat();
      if (!lraRes.isSat) {
        const culprits: TheoryLiteral[] = [];
        const culpritVars = new Set<string>();
        for (const id of lraRes.conflictLitIds ?? []) {
          const l = this.assertedLiterals.get(id);
          if (l) {
            culprits.push(l);
            if (l.predicate === "hyperplane" && l.args[0] && typeof l.args[0] === "object") {
              const obj = l.args[0] as Record<string, unknown>;
              const cMap = "coeffs" in obj ? (obj["coeffs"] as Record<string, unknown>) : obj;
              for (const k of Object.keys(cMap)) culpritVars.add(k);
            } else if (typeof l.args[0] === "string") {
              culpritVars.add(l.args[0]);
            }
          }
        }
        return {
          isSat: false,
          conflict: {
            literals: culprits,
            explanation: `Linear ${this.integerVars.size > 0 ? "Integer" : "Real"} Arithmetic (Simplex) Conflict: Infeasible linear constraint system over [${Array.from(culpritVars).join(", ")}].`,
            culpritEntities: Array.from(culpritVars),
            theoryName: this.name,
          },
        };
      }
      if (lraRes.model) {
        this.lraDeducedEqualities = this.simplex.deduceImpliedEqualities(lraRes.model);
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    const equalities: SharedEquality[] = [];

    // 1. Point intervals: If x in [c, c] and y in [c, c], x = y
    const pointVars = new Map<number, string[]>();
    for (const [v, int] of this.intervals.entries()) {
      if (int && isFinite(int.lo) && isFinite(int.hi)) {
        const eps = 1e-12 * Math.max(Math.abs(int.lo), Math.abs(int.hi));
        if (Math.abs(int.lo - int.hi) <= eps) {
          const val = (int.lo + int.hi) * 0.5;
          if (!pointVars.has(val)) pointVars.set(val, []);
          pointVars.get(val)!.push(v);
        }
      }
    }

    for (const [val, vars] of pointVars.entries()) {
      if (vars.length > 1) {
        for (let i = 0; i < vars.length - 1; i++) {
          const vA = vars[i]!;
          const vB = vars[i + 1]!;
          const key = vA < vB ? `${vA}==${vB}` : `${vB}==${vA}`;
          if (!this.propagatedEqualities.has(key)) {
            this.trail.setAdd(this.propagatedEqualities, key);
            const justA = this.varJustifications.get(this.getCanonicalVar(vA));
            const justB = this.varJustifications.get(this.getCanonicalVar(vB));
            const justs = new Set<number>();
            if (justA) for (const id of justA) justs.add(id);
            if (justB) for (const id of justB) justs.add(id);
            equalities.push({
              varA: vA,
              varB: vB,
              domain: "real",
              bounds: [val, val],
              explanation: `Deduced from identical point intervals [${val}, ${val}]`,
              sourceOracle: this.name,
              justifications: Array.from(justs),
              justification: Array.from(justs),
            });
          }
        }
      }
    }

    // 2. Simplex-deduced implied equalities (e.g. x <= y && y <= x => x == y)
    for (const ded of this.lraDeducedEqualities) {
      const key = ded.varA < ded.varB ? `${ded.varA}==${ded.varB}` : `${ded.varB}==${ded.varA}`;
      if (!this.propagatedEqualities.has(key)) {
        this.trail.setAdd(this.propagatedEqualities, key);
        equalities.push({
          varA: ded.varA,
          varB: ded.varB,
          domain: "real",
          explanation: `Deduced by Simplex LRA/LIA solver: ${ded.varA} == ${ded.varB}`,
          sourceOracle: this.name,
          justifications: ded.justs,
          justification: ded.justs,
        });
      }
    }

    // 3. Propagate merged aliases
    const aliasGroups = new Map<string, string[]>();
    for (const [v] of this.aliases.entries()) {
      const root = this.getCanonicalVar(v);
      if (!aliasGroups.has(root)) aliasGroups.set(root, []);
      aliasGroups.get(root)!.push(v);
    }

    for (const [, vars] of aliasGroups.entries()) {
      if (vars.length > 1) {
        for (let i = 0; i < vars.length - 1; i++) {
          const vA = vars[i]!;
          const vB = vars[i + 1]!;
          const key = vA < vB ? `${vA}==${vB}` : `${vB}==${vA}`;
          if (!this.propagatedEqualities.has(key)) {
            this.trail.setAdd(this.propagatedEqualities, key);
            const justA = this.varJustifications.get(this.getCanonicalVar(vA));
            const justB = this.varJustifications.get(this.getCanonicalVar(vB));
            const justs = new Set<number>();
            if (justA) for (const id of justA) justs.add(id);
            if (justB) for (const id of justB) justs.add(id);
            equalities.push({
              varA: vA,
              varB: vB,
              domain: "real",
              explanation: `Deduced from alias union ${vA} == ${vB}`,
              sourceOracle: this.name,
              justifications: Array.from(justs),
              justification: Array.from(justs),
            });
          }
        }
      }
    }

    // 4. Propagate newly contracted non-point bounds (e.g. from HC4 / relational constraints)
    for (const [v, int] of this.intervals.entries()) {
      if (!int || (!Number.isFinite(int.lo) && !Number.isFinite(int.hi))) continue;
      const prev = this.propagatedBounds.get(v);
      const loEps = prev ? 1e-12 * Math.max(Math.abs(prev[0]), Math.abs(int.lo)) : 0;
      const hiEps = prev ? 1e-12 * Math.max(Math.abs(prev[1]), Math.abs(int.hi)) : 0;
      const changed = !prev || Math.abs(int.lo - prev[0]) > loEps || Math.abs(int.hi - prev[1]) > hiEps;
      if (changed) {
        this.trail.mapSet(this.propagatedBounds, v, [int.lo, int.hi]);
        const justs = Array.from(this.varJustifications.get(v) ?? []);
        const strict = this.boundStrict.get(v);
        equalities.push({
          varA: v,
          varB: v,
          domain: "interval",
          bounds: [int.lo, int.hi],
          strict: strict ? [strict[0], strict[1]] : undefined,
          explanation: `Contracted interval bound ${v} in [${int.lo}, ${int.hi}]`,
          sourceOracle: this.name,
          justifications: justs,
          justification: justs,
        });
      }
    }

    return equalities;
  }

  public propagateDisequalities(): SharedDisequality[] {
    const disequalities: SharedDisequality[] = [];
    const finiteVars: { v: string; lo: number; hi: number; loOpen: boolean; hiOpen: boolean }[] = [];
    for (const [v, int] of this.intervals.entries()) {
      if (int && (Number.isFinite(int.lo) || Number.isFinite(int.hi))) {
        const st = this.boundStrict.get(v) ?? [false, false];
        finiteVars.push({ v, lo: int.lo, hi: int.hi, loOpen: st[0], hiOpen: st[1] });
      }
    }
    for (let i = 0; i < finiteVars.length; i++) {
      const a = finiteVars[i]!;
      for (let j = i + 1; j < finiteVars.length; j++) {
        const b = finiteVars[j]!;
        const eps = 1e-12 * Math.max(Math.abs(a.hi), Math.abs(b.lo), Math.abs(b.hi), Math.abs(a.lo));
        const aBelowB = a.hi < b.lo - eps || ((a.hiOpen || b.loOpen) && Math.abs(a.hi - b.lo) <= eps);
        const bBelowA = b.hi < a.lo - eps || ((b.hiOpen || a.loOpen) && Math.abs(b.hi - a.lo) <= eps);
        if (aBelowB || bBelowA) {
          const justs = new Set<number>();
          const jA = this.varJustifications.get(this.getCanonicalVar(a.v));
          const jB = this.varJustifications.get(this.getCanonicalVar(b.v));
          if (jA) for (const id of jA) justs.add(id);
          if (jB) for (const id of jB) justs.add(id);
          disequalities.push({
            varA: a.v,
            varB: b.v,
            explanation: `Disjoint intervals: ${a.v} in [${a.lo}, ${a.hi}] and ${b.v} in [${b.lo}, ${b.hi}]`,
            sourceOracle: this.name,
            justifications: Array.from(justs),
          });
        }
      }
    }
    return disequalities;
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.trail.arrayPush(this.sharedEqualities, eq);
    const justs = eq.justifications ?? eq.justification ?? [];
    const negA = eq.varA.startsWith("-");
    const negB = eq.varB.startsWith("-");
    const cleanA = negA ? eq.varA.slice(1) : eq.varA;
    const cleanB = negB ? eq.varB.slice(1) : eq.varB;

    if (negA !== negB) {
      this.registerOppositeSignEquality(cleanA, cleanB, justs);
      if (eq.bounds) {
        const canonA = this.getCanonicalVar(cleanA);
        const currA = this.getInterval(canonA);
        const bA = negA ? new Interval(-eq.bounds[1], -eq.bounds[0]) : new Interval(eq.bounds[0], eq.bounds[1]);
        if (currA) {
          const next = intersectInterval(currA, bA);
          this.trail.mapSet(this.intervals, canonA, next);
          this.recordPropagatedBound(canonA, next);
        }
        this.mirrorOppositeSignBounds(canonA);
      }
      return;
    }

    if (justs.length > 0) {
      const rA = this.getCanonicalVar(cleanA);
      const rB = this.getCanonicalVar(cleanB);
      let setA = this.varJustifications.get(rA);
      if (!setA) {
        setA = new Set();
        this.trail.mapSet(this.varJustifications, rA, setA);
      }
      for (const id of justs) this.trail.setAdd(setA, id);
      let setB = this.varJustifications.get(rB);
      if (!setB) {
        setB = new Set();
        this.trail.mapSet(this.varJustifications, rB, setB);
      }
      for (const id of justs) this.trail.setAdd(setB, id);
    }

    this.unionVars(cleanA, cleanB);
    if (eq.bounds) {
      const canon = this.getCanonicalVar(cleanA);
      const curr = this.getInterval(canon);
      const bInt = negA ? new Interval(-eq.bounds[1], -eq.bounds[0]) : new Interval(eq.bounds[0], eq.bounds[1]);
      if (curr) {
        if (eq.strict) {
          this.mergeStrictFlags(canon, curr, bInt, eq.strict[0], eq.strict[1]);
        }
        const next = intersectInterval(curr, bInt);
        this.trail.mapSet(this.intervals, canon, next);
        this.recordPropagatedBound(canon, next);
      }
      this.mirrorOppositeSignBounds(canon);
    }
  }

  public getModel(): Record<string, number> {
    const model: Record<string, number> = {};
    for (const [v, int] of this.intervals.entries()) {
      if (int) {
        model[v] = int.mid;
      }
    }
    return model;
  }
}
