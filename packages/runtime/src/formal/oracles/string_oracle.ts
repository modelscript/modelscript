// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Theory of Strings & Word Equations Oracle (T_S).
 *
 * Implements Nelson-Oppen-integrated decision procedure for strings with length constraints
 * and incremental UndoTrail backtracking:
 *   - Union-Find equivalence classes for string variables with proof-graph justifications
 *   - Constant propagation across strConst, strConcat (forward & backward), strPrefixOf, strSuffixOf
 *   - Length interval propagation [minLen, maxLen] synchronized with arithmetic ConstraintTheoryOracle via strLen
 *   - Word predicate verification: strContains, strPrefixOf, strSuffixOf (positive and negated)
 *   - Cross-theory equality, length-interval bound, and disequality propagation
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

interface ProofEdge {
  neighbor: string;
  justs: number[];
}

interface ConstEntry {
  readonly value: string;
  readonly sourceVar: string;
  readonly justs: readonly number[];
}

interface LenBounds {
  readonly min: number;
  readonly max: number;
  readonly justs: readonly number[];
}

interface ConcatConstraint {
  result: string;
  parts: string[];
  litId: number;
}

interface LenConstraint {
  strVar: string;
  lenVar: string;
  litId: number;
}

interface BinaryStrPredicate {
  arg0: string;
  arg1: string;
  negated: boolean;
  litId: number;
}

interface StrDisequality {
  a: string;
  b: string;
  justs: number[];
  fromShared: boolean;
}

interface StrConflictRecord {
  explanation: string;
  entities: string[];
  justs: number[];
}

const STRING_PREDICATES = new Set([
  "strConst",
  "strConcat",
  "strLen",
  "strContains",
  "strPrefixOf",
  "strSuffixOf",
  "strEq",
  "strNeq",
  "equal",
  "notEqual",
]);

function mergeJusts(a: readonly number[], b: readonly number[]): number[] {
  if (b.length === 0) return a.slice();
  if (a.length === 0) return b.slice();
  const set = new Set<number>(a);
  for (const id of b) set.add(id);
  return Array.from(set);
}

export class StringTheoryOracle implements TheoryOracle {
  public readonly name = "StringTheoryOracle";
  public readonly domain = "custom" as const;

  private parent = new Map<string, string>();
  private proofEdges = new Map<string, ProofEdge[]>();
  private classConst = new Map<string, ConstEntry>();
  private classLen = new Map<string, LenBounds>();

  // Length variables (arithmetic domain) linked via strLen
  private lenVars = new Set<string>();
  private lenVarBounds = new Map<string, LenBounds>();
  private lenVarEqPairs: Array<{ a: string; b: string; justs: number[] }> = [];

  private concats: ConcatConstraint[] = [];
  private lenLinks: LenConstraint[] = [];
  private containsList: BinaryStrPredicate[] = [];
  private prefixList: BinaryStrPredicate[] = [];
  private suffixList: BinaryStrPredicate[] = [];
  private disequalities: StrDisequality[] = [];
  private pendingConflict: StrConflictRecord | null = null;

  private assertedLiterals = new Map<number, TheoryLiteral>();
  private sharedEqualities: SharedEquality[] = [];
  private sharedDisequalities: SharedDisequality[] = [];
  private propagatedEqualities = new Set<string>();
  private propagatedBounds = new Set<string>();
  private propagatedDisequalities = new Set<string>();
  private trail = new UndoTrail();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.parent.clear();
    this.proofEdges.clear();
    this.classConst.clear();
    this.classLen.clear();
    this.lenVars.clear();
    this.lenVarBounds.clear();
    this.lenVarEqPairs = [];
    this.concats = [];
    this.lenLinks = [];
    this.containsList = [];
    this.prefixList = [];
    this.suffixList = [];
    this.disequalities = [];
    this.pendingConflict = null;
    this.assertedLiterals.clear();
    this.sharedEqualities = [];
    this.sharedDisequalities = [];
    this.propagatedEqualities.clear();
    this.propagatedBounds.clear();
    this.propagatedDisequalities.clear();
    this.trail.reset();
  }

  public pushLevel(): void {
    this.trail.pushLevel();
  }

  public popLevel(): void {
    this.trail.popLevel();
  }

  private recordConflict(explanation: string, entities: string[], justs: readonly number[]): void {
    if (this.pendingConflict !== null) return;
    const prev = this.pendingConflict;
    this.trail.record(() => {
      this.pendingConflict = prev;
    });
    this.pendingConflict = {
      explanation,
      entities,
      justs: Array.from(new Set(justs)),
    };
  }

  private ensureStrVar(v: string): void {
    if (!this.parent.has(v)) {
      this.trail.mapSet(this.parent, v, v);
    }
    if (!this.classLen.has(v)) {
      this.trail.mapSet(this.classLen, v, { min: 0, max: Infinity, justs: [] });
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

  private getLenBounds(v: string): LenBounds {
    const root = this.find(v);
    return this.classLen.get(root) ?? { min: 0, max: Infinity, justs: [] };
  }

  private getConst(v: string): ConstEntry | undefined {
    return this.classConst.get(this.find(v));
  }

  private tightenStrLen(v: string, min: number, max: number, justs: readonly number[]): boolean {
    const root = this.find(v);
    const curr = this.classLen.get(root) ?? { min: 0, max: Infinity, justs: [] };
    const nextMin = Math.max(0, curr.min, Number.isFinite(min) ? Math.ceil(min) : 0);
    const nextMax = Math.min(curr.max, Number.isFinite(max) ? Math.floor(max) : Infinity);
    const combinedJusts = mergeJusts(curr.justs, justs);

    if (nextMin > nextMax || nextMax < 0) {
      this.recordConflict(
        `String Length Conflict on '${v}': unsatisfiable length interval [${nextMin}, ${nextMax}].`,
        [v],
        combinedJusts,
      );
      return false;
    }

    if (nextMin !== curr.min || nextMax !== curr.max) {
      this.trail.mapSet(this.classLen, root, {
        min: nextMin,
        max: nextMax,
        justs: combinedJusts,
      });
      return true;
    }
    return false;
  }

  private setConst(v: string, value: string, justs: readonly number[]): boolean {
    this.ensureStrVar(v);
    const root = this.find(v);
    const existing = this.classConst.get(root);
    if (existing) {
      if (existing.value !== value) {
        const eqJusts = this.explainEquality(existing.sourceVar, v);
        this.recordConflict(
          `String Constant Conflict on '${v}': cannot simultaneously equal "${existing.value}" and "${value}".`,
          [existing.sourceVar, v],
          mergeJusts(mergeJusts(existing.justs, justs), eqJusts),
        );
      }
      return false;
    }

    const entry: ConstEntry = {
      value,
      sourceVar: v,
      justs: Array.from(new Set(justs)),
    };
    this.trail.mapSet(this.classConst, root, entry);
    this.tightenStrLen(v, value.length, value.length, entry.justs);
    return true;
  }

  private union(a: string, b: string, justs: readonly number[]): boolean {
    this.ensureStrVar(a);
    this.ensureStrVar(b);
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return false;

    const constA = this.classConst.get(rootA);
    const constB = this.classConst.get(rootB);
    const lenA = this.classLen.get(rootA) ?? { min: 0, max: Infinity, justs: [] };
    const lenB = this.classLen.get(rootB) ?? { min: 0, max: Infinity, justs: [] };

    this.trail.mapSet(this.parent, rootA, rootB);
    this.addProofEdge(a, b, justs);

    // Merge constants
    if (constA && constB) {
      if (constA.value !== constB.value) {
        const eqJusts = this.explainEquality(constA.sourceVar, constB.sourceVar);
        this.recordConflict(
          `String Constant Conflict: '${a}' ("${constA.value}") and '${b}' ("${constB.value}") cannot be equal.`,
          [a, b],
          mergeJusts(mergeJusts(constA.justs, constB.justs), mergeJusts(justs, eqJusts)),
        );
      }
    } else if (constA && !constB) {
      this.trail.mapSet(this.classConst, rootB, constA);
    }

    // Merge length bounds
    const mergedMin = Math.max(lenA.min, lenB.min);
    const mergedMax = Math.min(lenA.max, lenB.max);
    const mergedJusts = mergeJusts(mergeJusts(lenA.justs, lenB.justs), justs);
    if (mergedMin > mergedMax) {
      this.recordConflict(
        `String Length Conflict: merged equivalence class of '${a}' and '${b}' has empty length interval [${mergedMin}, ${mergedMax}].`,
        [a, b],
        mergedJusts,
      );
    } else {
      this.trail.mapSet(this.classLen, rootB, {
        min: mergedMin,
        max: mergedMax,
        justs: mergedJusts,
      });
    }

    return true;
  }

  private addDisequality(a: string, b: string, justs: readonly number[], fromShared: boolean): boolean {
    this.ensureStrVar(a);
    this.ensureStrVar(b);
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

  private tightenLenVar(lenVar: string, min: number, max: number, justs: readonly number[]): boolean {
    const curr = this.lenVarBounds.get(lenVar) ?? { min: 0, max: Infinity, justs: [] };
    const nextMin = Math.max(0, curr.min, Number.isFinite(min) ? Math.ceil(min) : 0);
    const nextMax = Math.min(curr.max, Number.isFinite(max) ? Math.floor(max) : Infinity);
    const combinedJusts = mergeJusts(curr.justs, justs);

    if (nextMin > nextMax || nextMax < 0) {
      this.recordConflict(
        `String Length Variable Conflict on '${lenVar}': unsatisfiable integer interval [${nextMin}, ${nextMax}].`,
        [lenVar],
        combinedJusts,
      );
      return false;
    }

    if (nextMin !== curr.min || nextMax !== curr.max || !this.lenVarBounds.has(lenVar)) {
      this.trail.mapSet(this.lenVarBounds, lenVar, {
        min: nextMin,
        max: nextMax,
        justs: combinedJusts,
      });
      return nextMin !== curr.min || nextMax !== curr.max;
    }
    return false;
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    if (!STRING_PREDICATES.has(lit.predicate)) {
      return false;
    }
    this.trail.mapSet(this.assertedLiterals, lit.id, lit);
    const { predicate, args, isNegated } = lit;

    switch (predicate) {
      case "strConst": {
        if (args.length < 2) return false;
        const varName = String(args[0]);
        const value = String(args[1]);
        this.ensureStrVar(varName);
        this.setConst(varName, value, [lit.id]);
        break;
      }
      case "strConcat": {
        if (args.length < 3) return false;
        const result = String(args[0]);
        const parts = args.slice(1).map((a) => String(a));
        this.ensureStrVar(result);
        for (const p of parts) this.ensureStrVar(p);
        this.trail.arrayPush(this.concats, { result, parts, litId: lit.id });
        break;
      }
      case "strLen": {
        if (args.length < 2) return false;
        const strVar = String(args[0]);
        const lenVar = String(args[1]);
        this.ensureStrVar(strVar);
        this.trail.setAdd(this.lenVars, lenVar);
        if (!this.lenVarBounds.has(lenVar)) {
          this.trail.mapSet(this.lenVarBounds, lenVar, { min: 0, max: Infinity, justs: [lit.id] });
        }
        this.trail.arrayPush(this.lenLinks, { strVar, lenVar, litId: lit.id });
        break;
      }
      case "strContains": {
        if (args.length < 2) return false;
        const haystack = String(args[0]);
        const needle = String(args[1]);
        this.ensureStrVar(haystack);
        this.ensureStrVar(needle);
        this.trail.arrayPush(this.containsList, {
          arg0: haystack,
          arg1: needle,
          negated: Boolean(isNegated),
          litId: lit.id,
        });
        break;
      }
      case "strPrefixOf": {
        if (args.length < 2) return false;
        const prefix = String(args[0]);
        const str = String(args[1]);
        this.ensureStrVar(prefix);
        this.ensureStrVar(str);
        this.trail.arrayPush(this.prefixList, {
          arg0: prefix,
          arg1: str,
          negated: Boolean(isNegated),
          litId: lit.id,
        });
        break;
      }
      case "strSuffixOf": {
        if (args.length < 2) return false;
        const suffix = String(args[0]);
        const str = String(args[1]);
        this.ensureStrVar(suffix);
        this.ensureStrVar(str);
        this.trail.arrayPush(this.suffixList, {
          arg0: suffix,
          arg1: str,
          negated: Boolean(isNegated),
          litId: lit.id,
        });
        break;
      }
      case "strEq":
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
      case "strNeq":
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

  private propagateConcat(c: ConcatConstraint): boolean {
    let changed = false;

    // 1. Length forward: len(result) = sum(len(parts))
    let sumMin = 0;
    let sumMax = 0;
    let forwardJusts: number[] = [c.litId];
    for (const p of c.parts) {
      const b = this.getLenBounds(p);
      sumMin += b.min;
      sumMax = Number.isFinite(sumMax) && Number.isFinite(b.max) ? sumMax + b.max : Infinity;
      forwardJusts = mergeJusts(forwardJusts, b.justs);
    }
    if (this.tightenStrLen(c.result, sumMin, sumMax, forwardJusts)) changed = true;
    if (this.pendingConflict) return false;

    // 2. Length backward: len(p_i) = len(result) - sum_{j != i} len(p_j)
    const resBounds = this.getLenBounds(c.result);
    for (let i = 0; i < c.parts.length; i++) {
      let otherMin = 0;
      let otherMax = 0;
      let bJusts = mergeJusts([c.litId], resBounds.justs);
      for (let j = 0; j < c.parts.length; j++) {
        if (i === j) continue;
        const b = this.getLenBounds(c.parts[j]!);
        otherMin += b.min;
        otherMax = Number.isFinite(otherMax) && Number.isFinite(b.max) ? otherMax + b.max : Infinity;
        bJusts = mergeJusts(bJusts, b.justs);
      }
      const pMin = Number.isFinite(otherMax) ? Math.max(0, resBounds.min - otherMax) : 0;
      const pMax = Number.isFinite(resBounds.max) ? resBounds.max - otherMin : Infinity;
      if (this.tightenStrLen(c.parts[i]!, pMin, pMax, bJusts)) changed = true;
      if (this.pendingConflict) return false;
    }

    // 3. Identity simplification: if all parts except one are "", union result with that part
    const nonEmptyIndices: number[] = [];
    let emptyJusts: number[] = [c.litId];
    let allOthersEmpty = true;
    for (let i = 0; i < c.parts.length; i++) {
      const pConst = this.getConst(c.parts[i]!);
      if (pConst && pConst.value === "") {
        emptyJusts = mergeJusts(emptyJusts, pConst.justs);
      } else {
        nonEmptyIndices.push(i);
        if (nonEmptyIndices.length > 1) {
          allOthersEmpty = false;
        }
      }
    }
    if (allOthersEmpty && nonEmptyIndices.length === 1) {
      const solePart = c.parts[nonEmptyIndices[0]!]!;
      if (this.find(c.result) !== this.find(solePart)) {
        if (this.union(c.result, solePart, emptyJusts)) changed = true;
        if (this.pendingConflict) return false;
      }
    }

    // 4. Constant forward: all parts known => evaluate result
    const partConsts = c.parts.map((p) => this.getConst(p));
    if (partConsts.every((pc) => pc !== undefined)) {
      const combined = partConsts.map((pc) => pc!.value).join("");
      let cJusts: number[] = [c.litId];
      for (let i = 0; i < c.parts.length; i++) {
        const pc = partConsts[i]!;
        cJusts = mergeJusts(cJusts, pc.justs);
        cJusts = mergeJusts(cJusts, this.explainEquality(c.parts[i]!, pc.sourceVar));
      }
      if (this.setConst(c.result, combined, cJusts)) changed = true;
      if (this.pendingConflict) return false;
    }

    // 5. Constant backward: result known => strip known prefix/suffix parts
    const resConst = this.getConst(c.result);
    if (resConst) {
      let rem = resConst.value;
      let left = 0;
      let right = c.parts.length - 1;
      let stripJusts = mergeJusts(
        mergeJusts([c.litId], resConst.justs),
        this.explainEquality(c.result, resConst.sourceVar),
      );

      while (left <= right) {
        const pc = this.getConst(c.parts[left]!);
        if (!pc) break;
        stripJusts = mergeJusts(mergeJusts(stripJusts, pc.justs), this.explainEquality(c.parts[left]!, pc.sourceVar));
        if (!rem.startsWith(pc.value)) {
          this.recordConflict(
            `String Concatenation Conflict: '${c.result}' ("${resConst.value}") does not match prefix part '${c.parts[left]}' ("${pc.value}").`,
            [c.result, c.parts[left]!],
            stripJusts,
          );
          return false;
        }
        rem = rem.slice(pc.value.length);
        left++;
      }

      while (right >= left) {
        const pc = this.getConst(c.parts[right]!);
        if (!pc) break;
        stripJusts = mergeJusts(mergeJusts(stripJusts, pc.justs), this.explainEquality(c.parts[right]!, pc.sourceVar));
        if (!rem.endsWith(pc.value)) {
          this.recordConflict(
            `String Concatenation Conflict: '${c.result}' ("${resConst.value}") does not match suffix part '${c.parts[right]}' ("${pc.value}").`,
            [c.result, c.parts[right]!],
            stripJusts,
          );
          return false;
        }
        rem = rem.slice(0, rem.length - pc.value.length);
        right--;
      }

      if (left > right) {
        if (rem.length > 0) {
          this.recordConflict(
            `String Concatenation Conflict: '${c.result}' ("${resConst.value}") has leftover characters "${rem}".`,
            [c.result, ...c.parts],
            stripJusts,
          );
          return false;
        }
      } else if (left === right) {
        // Single unknown part uniquely determined!
        if (this.setConst(c.parts[left]!, rem, stripJusts)) changed = true;
        if (this.pendingConflict) return false;
      }
    }

    return changed;
  }

  private saturate(): void {
    if (this.pendingConflict) return;
    let changed = true;
    let iterations = 0;
    const maxIterations = 128;

    while (changed && iterations < maxIterations && !this.pendingConflict) {
      changed = false;
      iterations++;

      // 1. Zero-length strings must equal ""
      for (const v of this.parent.keys()) {
        const root = this.find(v);
        if (root !== v) continue;
        const lb = this.classLen.get(root);
        if (lb && lb.min === 0 && lb.max === 0 && !this.classConst.has(root)) {
          if (this.setConst(root, "", lb.justs)) changed = true;
          if (this.pendingConflict) return;
        }
      }

      // 2. Sync lenVar equalities
      for (const eq of this.lenVarEqPairs) {
        const bA = this.lenVarBounds.get(eq.a);
        const bB = this.lenVarBounds.get(eq.b);
        if (bA) {
          if (this.tightenLenVar(eq.b, bA.min, bA.max, mergeJusts(bA.justs, eq.justs))) changed = true;
          if (this.pendingConflict) return;
        }
        if (bB) {
          if (this.tightenLenVar(eq.a, bB.min, bB.max, mergeJusts(bB.justs, eq.justs))) changed = true;
          if (this.pendingConflict) return;
        }
      }

      // 3. Sync strLen(strVar, lenVar)
      for (const link of this.lenLinks) {
        const sBounds = this.getLenBounds(link.strVar);
        const lBounds = this.lenVarBounds.get(link.lenVar) ?? { min: 0, max: Infinity, justs: [] };
        const jToLen = mergeJusts(sBounds.justs, [link.litId]);
        const jToStr = mergeJusts(lBounds.justs, [link.litId]);

        if (this.tightenLenVar(link.lenVar, sBounds.min, sBounds.max, jToLen)) changed = true;
        if (this.pendingConflict) return;
        const lBounds2 = this.lenVarBounds.get(link.lenVar)!;
        if (this.tightenStrLen(link.strVar, lBounds2.min, lBounds2.max, jToStr)) changed = true;
        if (this.pendingConflict) return;
      }

      // 4. strConcat
      for (const c of this.concats) {
        if (this.propagateConcat(c)) changed = true;
        if (this.pendingConflict) return;
      }

      // 5. strPrefixOf(prefix, str)
      for (const p of this.prefixList) {
        const pConst = this.getConst(p.arg0);
        const sConst = this.getConst(p.arg1);
        const pLen = this.getLenBounds(p.arg0);
        const sLen = this.getLenBounds(p.arg1);

        if (!p.negated) {
          const jP = mergeJusts(pLen.justs, [p.litId]);
          const jS = mergeJusts(sLen.justs, [p.litId]);
          if (this.tightenStrLen(p.arg0, 0, sLen.max, jS)) changed = true;
          if (this.pendingConflict) return;
          if (this.tightenStrLen(p.arg1, pLen.min, Infinity, jP)) changed = true;
          if (this.pendingConflict) return;

          if (pConst && sConst) {
            if (!sConst.value.startsWith(pConst.value)) {
              const justs = mergeJusts(
                mergeJusts([p.litId], mergeJusts(pConst.justs, sConst.justs)),
                mergeJusts(
                  this.explainEquality(p.arg0, pConst.sourceVar),
                  this.explainEquality(p.arg1, sConst.sourceVar),
                ),
              );
              this.recordConflict(
                `String Prefix Conflict: "${pConst.value}" is not a prefix of "${sConst.value}".`,
                [p.arg0, p.arg1],
                justs,
              );
              return;
            }
          } else if (sConst && pLen.min === pLen.max && pLen.min <= sConst.value.length) {
            const deduced = sConst.value.slice(0, pLen.min);
            const justs = mergeJusts(
              mergeJusts([p.litId], mergeJusts(sConst.justs, pLen.justs)),
              this.explainEquality(p.arg1, sConst.sourceVar),
            );
            if (this.setConst(p.arg0, deduced, justs)) changed = true;
            if (this.pendingConflict) return;
          }

          // If len(prefix) >= len(str), prefix == str
          const pLen2 = this.getLenBounds(p.arg0);
          const sLen2 = this.getLenBounds(p.arg1);
          if (pLen2.min >= sLen2.max && Number.isFinite(sLen2.max) && this.find(p.arg0) !== this.find(p.arg1)) {
            const justs = mergeJusts([p.litId], mergeJusts(pLen2.justs, sLen2.justs));
            if (this.union(p.arg0, p.arg1, justs)) changed = true;
            if (this.pendingConflict) return;
          }
        } else {
          // Negated: !prefixOf(prefix, str)
          if (this.find(p.arg0) === this.find(p.arg1)) {
            this.recordConflict(
              `String Prefix Conflict: '${p.arg0}' cannot fail to be a prefix of itself.`,
              [p.arg0, p.arg1],
              mergeJusts([p.litId], this.explainEquality(p.arg0, p.arg1)),
            );
            return;
          }
          if (pConst && pConst.value === "") {
            this.recordConflict(
              `String Prefix Conflict: empty string "" is always a prefix of '${p.arg1}'.`,
              [p.arg0, p.arg1],
              mergeJusts([p.litId], pConst.justs),
            );
            return;
          }
          if (pConst && sConst && sConst.value.startsWith(pConst.value)) {
            const justs = mergeJusts(
              mergeJusts([p.litId], mergeJusts(pConst.justs, sConst.justs)),
              mergeJusts(
                this.explainEquality(p.arg0, pConst.sourceVar),
                this.explainEquality(p.arg1, sConst.sourceVar),
              ),
            );
            this.recordConflict(
              `String Prefix Conflict: "${pConst.value}" IS a prefix of "${sConst.value}", contradicting negated strPrefixOf.`,
              [p.arg0, p.arg1],
              justs,
            );
            return;
          }
        }
      }

      // 6. strSuffixOf(suffix, str)
      for (const s of this.suffixList) {
        const sfConst = this.getConst(s.arg0);
        const strConst = this.getConst(s.arg1);
        const sfLen = this.getLenBounds(s.arg0);
        const strLen = this.getLenBounds(s.arg1);

        if (!s.negated) {
          const jSf = mergeJusts(sfLen.justs, [s.litId]);
          const jStr = mergeJusts(strLen.justs, [s.litId]);
          if (this.tightenStrLen(s.arg0, 0, strLen.max, jStr)) changed = true;
          if (this.pendingConflict) return;
          if (this.tightenStrLen(s.arg1, sfLen.min, Infinity, jSf)) changed = true;
          if (this.pendingConflict) return;

          if (sfConst && strConst) {
            if (!strConst.value.endsWith(sfConst.value)) {
              const justs = mergeJusts(
                mergeJusts([s.litId], mergeJusts(sfConst.justs, strConst.justs)),
                mergeJusts(
                  this.explainEquality(s.arg0, sfConst.sourceVar),
                  this.explainEquality(s.arg1, strConst.sourceVar),
                ),
              );
              this.recordConflict(
                `String Suffix Conflict: "${sfConst.value}" is not a suffix of "${strConst.value}".`,
                [s.arg0, s.arg1],
                justs,
              );
              return;
            }
          } else if (strConst && sfLen.min === sfLen.max && sfLen.min <= strConst.value.length) {
            const deduced = strConst.value.slice(strConst.value.length - sfLen.min);
            const justs = mergeJusts(
              mergeJusts([s.litId], mergeJusts(strConst.justs, sfLen.justs)),
              this.explainEquality(s.arg1, strConst.sourceVar),
            );
            if (this.setConst(s.arg0, deduced, justs)) changed = true;
            if (this.pendingConflict) return;
          }

          const sfLen2 = this.getLenBounds(s.arg0);
          const strLen2 = this.getLenBounds(s.arg1);
          if (sfLen2.min >= strLen2.max && Number.isFinite(strLen2.max) && this.find(s.arg0) !== this.find(s.arg1)) {
            const justs = mergeJusts([s.litId], mergeJusts(sfLen2.justs, strLen2.justs));
            if (this.union(s.arg0, s.arg1, justs)) changed = true;
            if (this.pendingConflict) return;
          }
        } else {
          if (this.find(s.arg0) === this.find(s.arg1)) {
            this.recordConflict(
              `String Suffix Conflict: '${s.arg0}' cannot fail to be a suffix of itself.`,
              [s.arg0, s.arg1],
              mergeJusts([s.litId], this.explainEquality(s.arg0, s.arg1)),
            );
            return;
          }
          if (sfConst && sfConst.value === "") {
            this.recordConflict(
              `String Suffix Conflict: empty string "" is always a suffix of '${s.arg1}'.`,
              [s.arg0, s.arg1],
              mergeJusts([s.litId], sfConst.justs),
            );
            return;
          }
          if (sfConst && strConst && strConst.value.endsWith(sfConst.value)) {
            const justs = mergeJusts(
              mergeJusts([s.litId], mergeJusts(sfConst.justs, strConst.justs)),
              mergeJusts(
                this.explainEquality(s.arg0, sfConst.sourceVar),
                this.explainEquality(s.arg1, strConst.sourceVar),
              ),
            );
            this.recordConflict(
              `String Suffix Conflict: "${sfConst.value}" IS a suffix of "${strConst.value}", contradicting negated strSuffixOf.`,
              [s.arg0, s.arg1],
              justs,
            );
            return;
          }
        }
      }

      // 7. strContains(haystack, needle)
      for (const ct of this.containsList) {
        const hConst = this.getConst(ct.arg0);
        const nConst = this.getConst(ct.arg1);
        const hLen = this.getLenBounds(ct.arg0);
        const nLen = this.getLenBounds(ct.arg1);

        if (!ct.negated) {
          const jH = mergeJusts(hLen.justs, [ct.litId]);
          const jN = mergeJusts(nLen.justs, [ct.litId]);
          if (this.tightenStrLen(ct.arg1, 0, hLen.max, jH)) changed = true;
          if (this.pendingConflict) return;
          if (this.tightenStrLen(ct.arg0, nLen.min, Infinity, jN)) changed = true;
          if (this.pendingConflict) return;

          if (hConst && nConst && !hConst.value.includes(nConst.value)) {
            const justs = mergeJusts(
              mergeJusts([ct.litId], mergeJusts(hConst.justs, nConst.justs)),
              mergeJusts(
                this.explainEquality(ct.arg0, hConst.sourceVar),
                this.explainEquality(ct.arg1, nConst.sourceVar),
              ),
            );
            this.recordConflict(
              `String Contains Conflict: "${hConst.value}" does not contain "${nConst.value}".`,
              [ct.arg0, ct.arg1],
              justs,
            );
            return;
          }

          const hLen2 = this.getLenBounds(ct.arg0);
          const nLen2 = this.getLenBounds(ct.arg1);
          if (nLen2.min >= hLen2.max && Number.isFinite(hLen2.max) && this.find(ct.arg0) !== this.find(ct.arg1)) {
            const justs = mergeJusts([ct.litId], mergeJusts(hLen2.justs, nLen2.justs));
            if (this.union(ct.arg0, ct.arg1, justs)) changed = true;
            if (this.pendingConflict) return;
          }
        } else {
          if (this.find(ct.arg0) === this.find(ct.arg1)) {
            this.recordConflict(
              `String Contains Conflict: '${ct.arg0}' always contains itself.`,
              [ct.arg0, ct.arg1],
              mergeJusts([ct.litId], this.explainEquality(ct.arg0, ct.arg1)),
            );
            return;
          }
          if (nConst && nConst.value === "") {
            this.recordConflict(
              `String Contains Conflict: '${ct.arg0}' always contains empty string "".`,
              [ct.arg0, ct.arg1],
              mergeJusts([ct.litId], nConst.justs),
            );
            return;
          }
          if (hConst && nConst && hConst.value.includes(nConst.value)) {
            const justs = mergeJusts(
              mergeJusts([ct.litId], mergeJusts(hConst.justs, nConst.justs)),
              mergeJusts(
                this.explainEquality(ct.arg0, hConst.sourceVar),
                this.explainEquality(ct.arg1, nConst.sourceVar),
              ),
            );
            this.recordConflict(
              `String Contains Conflict: "${hConst.value}" DOES contain "${nConst.value}", contradicting negated strContains.`,
              [ct.arg0, ct.arg1],
              justs,
            );
            return;
          }
        }
      }

      // 8. Merge distinct classes resolved to the exact same constant string
      const byConstVal = new Map<string, { root: string; entry: ConstEntry }>();
      for (const [root, entry] of this.classConst.entries()) {
        if (this.find(root) !== root) continue;
        const prev = byConstVal.get(entry.value);
        if (!prev) {
          byConstVal.set(entry.value, { root, entry });
        } else if (this.find(prev.root) !== this.find(root)) {
          const justs = mergeJusts(prev.entry.justs, entry.justs);
          if (this.union(prev.entry.sourceVar, entry.sourceVar, justs)) changed = true;
          if (this.pendingConflict) return;
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
      if (lit) result.push(lit);
      else result.push({ id, predicate: "crossTheoryAntecedent", args: entities });
    }
    return result;
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    this.saturate();

    if (this.pendingConflict) {
      const c = this.pendingConflict;
      return {
        isSat: false,
        conflict: {
          literals: this.buildConflictLiterals(c.justs, c.entities),
          explanation: c.explanation,
          culpritEntities: c.entities,
          theoryName: this.name,
        },
      };
    }

    // Check strEq vs strNeq contradictions
    for (const d of this.disequalities) {
      if (this.find(d.a) === this.find(d.b)) {
        const eqJusts = this.explainEquality(d.a, d.b);
        const allJusts = mergeJusts(d.justs, eqJusts);
        return {
          isSat: false,
          conflict: {
            literals: this.buildConflictLiterals(allJusts, [d.a, d.b]),
            explanation: `String Equality/Disequality Conflict: '${d.a}' and '${d.b}' are deduced equal, contradicting '${d.a} != ${d.b}'.`,
            culpritEntities: [d.a, d.b],
            theoryName: this.name,
          },
        };
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    this.saturate();
    if (this.pendingConflict) return [];

    const equalities: SharedEquality[] = [];

    // 1. Propagate string variable equalities (O(k) spanning path per equivalence class)
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
          explanation: `String theory deduced equality ${vA} == ${vB}`,
          sourceOracle: this.name,
          justifications: justs,
          justification: justs,
        });
      }
    }

    // 2. Propagate lenVar interval bounds [minLen, maxLen] to ConstraintTheoryOracle
    for (const [lenVar, bounds] of this.lenVarBounds.entries()) {
      const bKey = `${lenVar}:[${bounds.min},${bounds.max}]`;
      if (this.propagatedBounds.has(bKey)) continue;
      this.trail.setAdd(this.propagatedBounds, bKey);
      const justs = bounds.justs.slice();
      equalities.push({
        varA: lenVar,
        varB: lenVar,
        domain: "interval",
        bounds: [bounds.min, bounds.max],
        explanation: `String length interval ${lenVar} in [${bounds.min}, ${bounds.max}]`,
        sourceOracle: this.name,
        justifications: justs,
        justification: justs,
      });
    }

    return equalities;
  }

  public propagateDisequalities(): SharedDisequality[] {
    this.saturate();
    if (this.pendingConflict) return [];

    const result: SharedDisequality[] = [];

    // 1. Explicit strNeq
    for (const d of this.disequalities) {
      if (d.fromShared) continue;
      const key = d.a < d.b ? `${d.a}!=${d.b}` : `${d.b}!=${d.a}`;
      if (this.propagatedDisequalities.has(key)) continue;
      this.trail.setAdd(this.propagatedDisequalities, key);
      result.push({
        varA: d.a,
        varB: d.b,
        explanation: `String disequality ${d.a} != ${d.b}`,
        sourceOracle: this.name,
        justifications: d.justs,
      });
    }

    // 2. Distinct resolved constants or disjoint length intervals
    const vars = Array.from(this.parent.keys());
    for (let i = 0; i < vars.length; i++) {
      const vA = vars[i]!;
      const cA = this.getConst(vA);
      const lA = this.getLenBounds(vA);
      for (let j = i + 1; j < vars.length; j++) {
        const vB = vars[j]!;
        if (this.find(vA) === this.find(vB)) continue;
        const cB = this.getConst(vB);
        const lB = this.getLenBounds(vB);

        const diffConst = cA !== undefined && cB !== undefined && cA.value !== cB.value;
        const disjointLen = lA.max < lB.min || lB.max < lA.min;
        if (!diffConst && !disjointLen) continue;

        const key = vA < vB ? `${vA}!=${vB}` : `${vB}!=${vA}`;
        if (this.propagatedDisequalities.has(key)) continue;
        this.trail.setAdd(this.propagatedDisequalities, key);

        const justs = diffConst ? mergeJusts(cA!.justs, cB!.justs) : mergeJusts(lA.justs, lB.justs);
        result.push({
          varA: vA,
          varB: vB,
          explanation: diffConst
            ? `Distinct string constants: '${vA}' ("${cA!.value}") != '${vB}' ("${cB!.value}")`
            : `Disjoint string length intervals: '${vA}' in [${lA.min}, ${lA.max}] and '${vB}' in [${lB.min}, ${lB.max}]`,
          sourceOracle: this.name,
          justifications: justs,
        });
      }
    }

    return result;
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.trail.arrayPush(this.sharedEqualities, eq);
    const justs = eq.justifications ?? eq.justification ?? [];

    // Handle incoming arithmetic bounds on length variables
    if (eq.bounds) {
      const [rawLo, rawHi] = eq.bounds;
      if (this.lenVars.has(eq.varA)) {
        this.tightenLenVar(eq.varA, rawLo, rawHi, justs);
      }
      if (eq.varB !== eq.varA && this.lenVars.has(eq.varB)) {
        this.tightenLenVar(eq.varB, rawLo, rawHi, justs);
      }
    }

    if (eq.varA !== eq.varB) {
      const isLenA = this.lenVars.has(eq.varA);
      const isLenB = this.lenVars.has(eq.varB);
      if (isLenA || isLenB) {
        this.trail.setAdd(this.lenVars, eq.varA);
        this.trail.setAdd(this.lenVars, eq.varB);
        this.trail.arrayPush(this.lenVarEqPairs, {
          a: eq.varA,
          b: eq.varB,
          justs: Array.from(new Set(justs)),
        });
      } else if (this.parent.has(eq.varA) || this.parent.has(eq.varB)) {
        this.union(eq.varA, eq.varB, justs);
      }
    }
  }

  public onSharedDisequality(diseq: SharedDisequality): void {
    this.trail.arrayPush(this.sharedDisequalities, diseq);
    if (this.parent.has(diseq.varA) || this.parent.has(diseq.varB)) {
      this.addDisequality(diseq.varA, diseq.varB, diseq.justifications ?? [], true);
    }
  }

  public getModel(): Record<string, string | number> {
    this.saturate();
    const model: Record<string, string | number> = {};

    const classWitness = new Map<string, string>();
    for (const v of this.parent.keys()) {
      const root = this.find(v);
      if (!classWitness.has(root)) {
        const c = this.classConst.get(root);
        if (c) {
          classWitness.set(root, c.value);
        } else {
          const lb = this.classLen.get(root);
          const targetLen = lb ? Math.max(0, Math.min(lb.min, 64)) : 0;
          classWitness.set(root, "a".repeat(targetLen));
        }
      }
      model[v] = classWitness.get(root)!;
    }

    for (const link of this.lenLinks) {
      const strVal = model[link.strVar];
      if (typeof strVal === "string") {
        model[link.lenVar] = strVal.length;
      }
    }
    for (const [lenVar, lb] of this.lenVarBounds.entries()) {
      if (!(lenVar in model)) {
        model[lenVar] = lb.min;
      }
    }

    return model;
  }
}
