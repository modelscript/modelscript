// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — McCarthy Theory of Arrays Oracle (T_A).
 *
 * Implements Nelson-Oppen-integrated decision procedure for the extensional/read-over-write
 * theory of arrays with incremental UndoTrail backtracking and justification tracking:
 *   - Union-Find equivalence classes with spanning-forest proof graph
 *   - ROW1 (Read-Over-Write Same Index): select(store(a, i, v), j) = v when i = j
 *   - ROW2 (Read-Over-Write Different Index): select(store(a, i, v), j) = select(a, j) when i != j
 *   - Read & Store Congruence closure
 *   - Contrapositive read disequality deduction: select(a, i) != select(a, j) => i != j
 */

import type {
  ConflictClause,
  SharedDisequality,
  SharedEquality,
  TheoryLiteral,
  TheoryOracle,
} from "../theory_coordinator.js";
import { hasSharedEqualityWithLiteral, retainSharedEqualitiesWithoutLiteral } from "./retraction_utils.js";
import { UndoTrail } from "./undo_trail.js";

interface ArrayStoreTerm {
  resultArr: string;
  baseArr: string;
  indexVar: string;
  valueVar: string;
  litId: number;
}

interface ArraySelectTerm {
  resultVal: string;
  arrVar: string;
  indexVar: string;
  litId: number;
}

interface ArrayDisequality {
  a: string;
  b: string;
  justs: number[];
  fromShared: boolean;
}

interface ProofEdge {
  neighbor: string;
  justs: number[];
}

interface PointValueEntry {
  value: number;
  justs: number[];
}

const ARRAY_PREDICATES = new Set(["arrayStore", "arraySelect", "arrayEq", "arrayNeq", "equal", "notEqual"]);

export class ArrayTheoryOracle implements TheoryOracle {
  public readonly name = "ArrayTheoryOracle";
  public readonly domain = "custom" as const;

  private parent = new Map<string, string>();
  private proofEdges = new Map<string, ProofEdge[]>();
  private stores: ArrayStoreTerm[] = [];
  private selects: ArraySelectTerm[] = [];
  private disequalities: ArrayDisequality[] = [];
  private pointValues = new Map<string, PointValueEntry>();

  private assertedLiterals = new Map<number, TheoryLiteral>();
  private sharedEqualities: SharedEquality[] = [];
  private sharedDisequalities: SharedDisequality[] = [];
  private propagatedEqualities = new Set<string>();
  private propagatedDisequalities = new Set<string>();
  private trail = new UndoTrail();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.parent.clear();
    this.proofEdges.clear();
    this.stores = [];
    this.selects = [];
    this.disequalities = [];
    this.pointValues.clear();
    this.assertedLiterals.clear();
    this.sharedEqualities = [];
    this.sharedDisequalities = [];
    this.propagatedEqualities.clear();
    this.propagatedDisequalities.clear();
    this.trail.reset();
  }

  public pushLevel(): void {
    this.trail.pushLevel();
  }

  public popLevel(): void {
    this.trail.popLevel();
  }

  private ensureVar(v: string): void {
    if (!this.parent.has(v)) {
      this.trail.mapSet(this.parent, v, v);
    }
  }

  private find(x: string): string {
    const direct = this.parent.get(x);
    if (!direct || direct === x) return x;
    const grand = this.parent.get(direct);
    if (!grand || grand === direct) return direct;

    let curr = x;
    const visited = new Set<string>();
    const path: string[] = [];
    while (true) {
      if (visited.has(curr)) {
        this.trail.mapSet(this.parent, curr, curr);
        break;
      }
      visited.add(curr);
      path.push(curr);
      const p = this.parent.get(curr);
      if (!p || p === curr) break;
      curr = p;
    }

    const root = curr;
    for (const node of path) {
      if (this.parent.get(node) !== root) {
        this.trail.mapSet(this.parent, node, root);
      }
    }
    return root;
  }

  private addProofEdge(a: string, b: string, justs: readonly number[]): void {
    const copy = Array.from(new Set(justs));
    let listA = this.proofEdges.get(a);
    if (!listA) {
      listA = [];
      this.trail.mapSet(this.proofEdges, a, listA);
    }
    this.trail.arrayPush(listA, { neighbor: b, justs: copy });

    let listB = this.proofEdges.get(b);
    if (!listB) {
      listB = [];
      this.trail.mapSet(this.proofEdges, b, listB);
    }
    this.trail.arrayPush(listB, { neighbor: a, justs: copy });
  }

  private explainEquality(a: string, b: string): number[] {
    if (a === b) return [];
    const visited = new Set<string>([a]);
    const queue: Array<{ node: string; justs: number[] }> = [{ node: a, justs: [] }];
    let head = 0;

    while (head < queue.length) {
      const curr = queue[head++]!;
      const edges = this.proofEdges.get(curr.node);
      if (!edges) continue;
      for (const edge of edges) {
        if (visited.has(edge.neighbor)) continue;
        const nextJusts = curr.justs.concat(edge.justs);
        if (edge.neighbor === b) {
          return Array.from(new Set(nextJusts));
        }
        visited.add(edge.neighbor);
        queue.push({ node: edge.neighbor, justs: nextJusts });
      }
    }
    return [];
  }

  private union(a: string, b: string, justs: readonly number[]): boolean {
    this.ensureVar(a);
    this.ensureVar(b);
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return false;

    this.trail.mapSet(this.parent, rootA, rootB);
    this.addProofEdge(a, b, justs);
    return true;
  }

  private addDisequality(a: string, b: string, justs: readonly number[], fromShared: boolean): boolean {
    this.ensureVar(a);
    this.ensureVar(b);
    const already = this.disequalities.some((d) => (d.a === a && d.b === b) || (d.a === b && d.b === a));
    if (already) return false;
    this.trail.arrayPush(this.disequalities, {
      a,
      b,
      justs: Array.from(new Set(justs)),
      fromShared,
    });
    return true;
  }

  /**
   * Returns justification literal IDs proving `x != y`, or `null` if not known disequal.
   */
  private findDisequalityJusts(x: string, y: string): number[] | null {
    const rX = this.find(x);
    const rY = this.find(y);
    if (rX === rY) return null;

    for (const d of this.disequalities) {
      const rA = this.find(d.a);
      const rB = this.find(d.b);
      if (rA === rX && rB === rY) {
        return Array.from(new Set([...d.justs, ...this.explainEquality(d.a, x), ...this.explainEquality(d.b, y)]));
      }
      if (rA === rY && rB === rX) {
        return Array.from(new Set([...d.justs, ...this.explainEquality(d.a, y), ...this.explainEquality(d.b, x)]));
      }
    }

    // Check point values from arithmetic/interval theories
    const pvX = this.pointValues.get(x);
    const pvY = this.pointValues.get(y);
    if (pvX && pvY && pvX.value !== pvY.value) {
      return Array.from(new Set([...pvX.justs, ...pvY.justs]));
    }

    return null;
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    if (!ARRAY_PREDICATES.has(lit.predicate)) {
      return false;
    }
    this.trail.mapSet(this.assertedLiterals, lit.id, lit);
    const { predicate, args, isNegated } = lit;

    switch (predicate) {
      case "arrayStore": {
        if (args.length < 4) return false;
        const resultArr = String(args[0]);
        const baseArr = String(args[1]);
        const indexVar = String(args[2]);
        const valueVar = String(args[3]);
        this.ensureVar(resultArr);
        this.ensureVar(baseArr);
        this.ensureVar(indexVar);
        this.ensureVar(valueVar);
        this.trail.arrayPush(this.stores, {
          resultArr,
          baseArr,
          indexVar,
          valueVar,
          litId: lit.id,
        });
        break;
      }
      case "arraySelect": {
        if (args.length < 3) return false;
        const resultVal = String(args[0]);
        const arrVar = String(args[1]);
        const indexVar = String(args[2]);
        this.ensureVar(resultVal);
        this.ensureVar(arrVar);
        this.ensureVar(indexVar);
        this.trail.arrayPush(this.selects, {
          resultVal,
          arrVar,
          indexVar,
          litId: lit.id,
        });
        break;
      }
      case "arrayEq":
      case "equal": {
        if (args.length < 2) return false;
        const a = String(args[0]);
        const b = String(args[1]);
        if (isNegated) {
          this.addDisequality(a, b, [lit.id], false);
        } else {
          this.union(a, b, [lit.id]);
        }
        break;
      }
      case "arrayNeq":
      case "notEqual": {
        if (args.length < 2) return false;
        const a = String(args[0]);
        const b = String(args[1]);
        if (isNegated) {
          this.union(a, b, [lit.id]);
        } else {
          this.addDisequality(a, b, [lit.id], false);
        }
        break;
      }
    }
    return true;
  }

  public retractLiteral(litId: number): void {
    const hasAsserted = this.assertedLiterals.has(litId);
    const hasSharedEq = hasSharedEqualityWithLiteral(this.sharedEqualities, litId);
    const hasSharedDiseq = this.sharedDisequalities.some((d) => (d.justifications ?? []).includes(litId));
    if (!hasAsserted && !hasSharedEq && !hasSharedDiseq) return;

    this.assertedLiterals.delete(litId);
    const savedTrail = this.trail;
    const remaining = Array.from(this.assertedLiterals.values());
    const savedSharedEq = retainSharedEqualitiesWithoutLiteral(this.sharedEqualities, litId);
    const savedSharedDiseq = this.sharedDisequalities.filter((d) => !(d.justifications ?? []).includes(litId));

    this.reset();
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
    for (const eq of savedSharedEq) {
      this.onSharedEquality(eq);
    }
    for (const diseq of savedSharedDiseq) {
      this.onSharedDisequality(diseq);
    }
    this.trail = savedTrail;
  }

  /**
   * Fixpoint saturation of McCarthy array axioms (ROW1, ROW2, Read/Store Congruence,
   * and contrapositive read disequality).
   */
  private saturate(): void {
    let changed = true;
    let iterations = 0;
    const maxIterations = 128;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      // 0. Merge variables that share identical point values from arithmetic theories
      const pvEntries = Array.from(this.pointValues.entries());
      for (let i = 0; i < pvEntries.length; i++) {
        const [vA, eA] = pvEntries[i]!;
        for (let j = i + 1; j < pvEntries.length; j++) {
          const [vB, eB] = pvEntries[j]!;
          if (eA.value === eB.value && this.find(vA) !== this.find(vB)) {
            if (this.union(vA, vB, [...eA.justs, ...eB.justs])) {
              changed = true;
            }
          }
        }
      }

      // 1. ROW1 (Read-Over-Write Same Index):
      //    a' = store(a, i, v), r = select(a', j), i == j  ==>  r == v
      for (const st of this.stores) {
        const stResRoot = this.find(st.resultArr);
        const stIdxRoot = this.find(st.indexVar);
        for (const sel of this.selects) {
          if (this.find(sel.arrVar) === stResRoot && this.find(sel.indexVar) === stIdxRoot) {
            if (this.find(sel.resultVal) !== this.find(st.valueVar)) {
              const justs = [
                st.litId,
                sel.litId,
                ...this.explainEquality(sel.arrVar, st.resultArr),
                ...this.explainEquality(sel.indexVar, st.indexVar),
              ];
              if (this.union(sel.resultVal, st.valueVar, justs)) {
                changed = true;
              }
            }
          }
        }
      }

      // 2. ROW2 (Read-Over-Write Different Index):
      //    a' = store(a, i, v), r1 = select(a', j1), r2 = select(a, j2), j1 == j2, i != j1  ==>  r1 == r2
      for (const st of this.stores) {
        const stResRoot = this.find(st.resultArr);
        const stBaseRoot = this.find(st.baseArr);
        for (const sel1 of this.selects) {
          if (this.find(sel1.arrVar) !== stResRoot) continue;
          const diseqJusts = this.findDisequalityJusts(st.indexVar, sel1.indexVar);
          if (!diseqJusts) continue;

          const idx1Root = this.find(sel1.indexVar);
          for (const sel2 of this.selects) {
            if (this.find(sel2.arrVar) !== stBaseRoot) continue;
            if (this.find(sel2.indexVar) !== idx1Root) continue;
            if (this.find(sel1.resultVal) !== this.find(sel2.resultVal)) {
              const justs = [
                st.litId,
                sel1.litId,
                sel2.litId,
                ...diseqJusts,
                ...this.explainEquality(sel1.arrVar, st.resultArr),
                ...this.explainEquality(sel2.arrVar, st.baseArr),
                ...this.explainEquality(sel1.indexVar, sel2.indexVar),
              ];
              if (this.union(sel1.resultVal, sel2.resultVal, justs)) {
                changed = true;
              }
            }
          }
        }
      }

      // 3. Read Congruence & Contrapositive Read Disequality:
      //    r1 = select(a1, i1), r2 = select(a2, i2), a1 == a2:
      //      if i1 == i2  ==>  r1 == r2
      //      if r1 != r2  ==>  i1 != i2
      for (let i = 0; i < this.selects.length; i++) {
        const s1 = this.selects[i]!;
        const a1Root = this.find(s1.arrVar);
        const i1Root = this.find(s1.indexVar);
        for (let j = i + 1; j < this.selects.length; j++) {
          const s2 = this.selects[j]!;
          if (this.find(s2.arrVar) !== a1Root) continue;
          if (this.find(s2.indexVar) === i1Root) {
            if (this.find(s1.resultVal) !== this.find(s2.resultVal)) {
              const justs = [
                s1.litId,
                s2.litId,
                ...this.explainEquality(s1.arrVar, s2.arrVar),
                ...this.explainEquality(s1.indexVar, s2.indexVar),
              ];
              if (this.union(s1.resultVal, s2.resultVal, justs)) {
                changed = true;
              }
            }
          } else {
            const valDiseqJusts = this.findDisequalityJusts(s1.resultVal, s2.resultVal);
            if (valDiseqJusts) {
              const justs = [s1.litId, s2.litId, ...valDiseqJusts, ...this.explainEquality(s1.arrVar, s2.arrVar)];
              if (this.addDisequality(s1.indexVar, s2.indexVar, justs, false)) {
                changed = true;
              }
            }
          }
        }
      }

      // 4. Store Congruence:
      //    res1 = store(b1, i1, v1), res2 = store(b2, i2, v2), b1==b2, i1==i2, v1==v2 ==> res1 == res2
      for (let i = 0; i < this.stores.length; i++) {
        const s1 = this.stores[i]!;
        for (let j = i + 1; j < this.stores.length; j++) {
          const s2 = this.stores[j]!;
          if (
            this.find(s1.baseArr) === this.find(s2.baseArr) &&
            this.find(s1.indexVar) === this.find(s2.indexVar) &&
            this.find(s1.valueVar) === this.find(s2.valueVar) &&
            this.find(s1.resultArr) !== this.find(s2.resultArr)
          ) {
            const justs = [
              s1.litId,
              s2.litId,
              ...this.explainEquality(s1.baseArr, s2.baseArr),
              ...this.explainEquality(s1.indexVar, s2.indexVar),
              ...this.explainEquality(s1.valueVar, s2.valueVar),
            ];
            if (this.union(s1.resultArr, s2.resultArr, justs)) {
              changed = true;
            }
          }
        }
      }
    }
  }

  private buildConflictLiterals(justIds: readonly number[], entities: string[]): TheoryLiteral[] {
    const result: TheoryLiteral[] = [];
    const seen = new Set<number>();
    for (const id of justIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const lit = this.assertedLiterals.get(id);
      if (lit) {
        result.push(lit);
      } else {
        result.push({ id, predicate: "crossTheoryAntecedent", args: entities });
      }
    }
    return result;
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    this.saturate();

    // Check disequality violations
    for (const d of this.disequalities) {
      if (this.find(d.a) === this.find(d.b)) {
        const eqJusts = this.explainEquality(d.a, d.b);
        const allJusts = Array.from(new Set([...d.justs, ...eqJusts]));
        return {
          isSat: false,
          conflict: {
            literals: this.buildConflictLiterals(allJusts, [d.a, d.b]),
            explanation: `Array Theory Conflict: '${d.a}' and '${d.b}' are deduced equal via array axioms, contradicting '${d.a} != ${d.b}'.`,
            culpritEntities: [d.a, d.b],
            theoryName: this.name,
          },
        };
      }
    }

    // Check contradictory point values within the same equivalence class
    const classPointVal = new Map<string, { varName: string; entry: PointValueEntry }>();
    for (const [v, entry] of this.pointValues.entries()) {
      const root = this.find(v);
      const prev = classPointVal.get(root);
      if (!prev) {
        classPointVal.set(root, { varName: v, entry });
      } else if (prev.entry.value !== entry.value) {
        const eqJusts = this.explainEquality(prev.varName, v);
        const allJusts = Array.from(new Set([...prev.entry.justs, ...entry.justs, ...eqJusts]));
        return {
          isSat: false,
          conflict: {
            literals: this.buildConflictLiterals(allJusts, [prev.varName, v]),
            explanation: `Array Theory Conflict: '${prev.varName}' (= ${prev.entry.value}) and '${v}' (= ${entry.value}) are deduced equal via array axioms.`,
            culpritEntities: [prev.varName, v],
            theoryName: this.name,
          },
        };
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    this.saturate();
    const equalities: SharedEquality[] = [];
    const groups = new Map<string, string[]>();

    for (const v of this.parent.keys()) {
      const root = this.find(v);
      let list = groups.get(root);
      if (!list) {
        list = [];
        groups.set(root, list);
      }
      list.push(v);
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      // O(k) spanning path over each equivalence class
      for (let i = 0; i < group.length - 1; i++) {
        const vA = group[i]!;
        const vB = group[i + 1]!;
        const key = vA < vB ? `${vA}==${vB}` : `${vB}==${vA}`;
        if (this.propagatedEqualities.has(key)) continue;
        this.trail.setAdd(this.propagatedEqualities, key);
        const justs = this.explainEquality(vA, vB);
        equalities.push({
          varA: vA,
          varB: vB,
          domain: "discrete",
          explanation: `Array theory deduced equality ${vA} == ${vB}`,
          sourceOracle: this.name,
          justifications: justs,
          justification: justs,
        });
      }
    }

    return equalities;
  }

  public propagateDisequalities(): SharedDisequality[] {
    this.saturate();
    const result: SharedDisequality[] = [];
    for (const d of this.disequalities) {
      if (d.fromShared) continue;
      const key = d.a < d.b ? `${d.a}!=${d.b}` : `${d.b}!=${d.a}`;
      if (this.propagatedDisequalities.has(key)) continue;
      this.trail.setAdd(this.propagatedDisequalities, key);
      result.push({
        varA: d.a,
        varB: d.b,
        explanation: `Array theory deduced disequality ${d.a} != ${d.b}`,
        sourceOracle: this.name,
        justifications: d.justs,
      });
    }
    return result;
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.trail.arrayPush(this.sharedEqualities, eq);
    const justs = eq.justifications ?? eq.justification ?? [];

    if (eq.varA !== eq.varB) {
      this.union(eq.varA, eq.varB, justs);
    }

    if (eq.bounds && eq.bounds[0] === eq.bounds[1] && Number.isFinite(eq.bounds[0])) {
      this.ensureVar(eq.varA);
      this.trail.mapSet(this.pointValues, eq.varA, {
        value: eq.bounds[0],
        justs: Array.from(new Set(justs)),
      });
    }
  }

  public onSharedDisequality(diseq: SharedDisequality): void {
    this.trail.arrayPush(this.sharedDisequalities, diseq);
    this.addDisequality(diseq.varA, diseq.varB, diseq.justifications ?? [], true);
  }

  public getModel(): Record<string, unknown> {
    this.saturate();
    const model: Record<string, unknown> = {};

    // Assign canonical representative or known point value for every variable
    const rootPointVal = new Map<string, number>();
    for (const [v, pv] of this.pointValues.entries()) {
      rootPointVal.set(this.find(v), pv.value);
    }

    for (const v of this.parent.keys()) {
      const root = this.find(v);
      const pv = rootPointVal.get(root);
      model[v] = pv !== undefined ? pv : root;
    }

    // Build concrete index -> value map for array terms
    const arrayMaps = new Map<string, Record<string, unknown>>();
    for (const st of this.stores) {
      const arrRoot = this.find(st.resultArr);
      let entries = arrayMaps.get(arrRoot);
      if (!entries) {
        entries = {};
        arrayMaps.set(arrRoot, entries);
      }
      const idxKey = String(model[st.indexVar] ?? this.find(st.indexVar));
      entries[idxKey] = model[st.valueVar] ?? this.find(st.valueVar);
    }
    for (const sel of this.selects) {
      const arrRoot = this.find(sel.arrVar);
      let entries = arrayMaps.get(arrRoot);
      if (!entries) {
        entries = {};
        arrayMaps.set(arrRoot, entries);
      }
      const idxKey = String(model[sel.indexVar] ?? this.find(sel.indexVar));
      if (!(idxKey in entries)) {
        entries[idxKey] = model[sel.resultVal] ?? this.find(sel.resultVal);
      }
    }
    for (const st of this.stores) {
      model[st.resultArr] = arrayMaps.get(this.find(st.resultArr)) ?? {};
    }
    for (const sel of this.selects) {
      const arrRoot = this.find(sel.arrVar);
      if (arrayMaps.has(arrRoot)) {
        model[sel.arrVar] = arrayMaps.get(arrRoot);
      }
    }

    return model;
  }
}
