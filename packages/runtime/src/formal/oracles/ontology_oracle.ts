// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Ontology Theory Oracle.
 *
 * Implements description logic reasoning over concepts, subsumptions, disjointness,
 * individuals, and automated package bundle closures.
 */

import type {
  ConflictClause,
  FiniteDomainConstraint,
  SharedDisequality,
  SharedEquality,
  TheoryLiteral,
  TheoryOracle,
} from "../theory_coordinator.js";
import { hasSharedEqualityWithLiteral, retainSharedEqualitiesWithoutLiteral } from "./retraction_utils.js";
import { UndoTrail } from "./undo_trail.js";

export interface ScopedBundleDef {
  packageIri: string;
  classes: string[];
}

export class OntologyTheoryOracle implements TheoryOracle {
  public readonly name = "OntologyTheoryOracle";
  public readonly domain = "ontology" as const;

  // Subclass hierarchy: subClass -> Set<superClass>
  private subClasses = new Map<string, Set<string>>();
  // Disjoint class pairs: classA -> Set<classB>
  private disjointClasses = new Map<string, Set<string>>();
  // Individual typing: individual -> Set<class>
  private individualTypes = new Map<string, Set<string>>();
  // Same individual equivalence classes (Disjoint Set / Union-Find)
  private sameIndividualMap = new Map<string, string>();
  // Explicitly different individuals: indA -> Set<indB>
  private differentIndividuals = new Map<string, Set<string>>();
  // Finite-domain cardinality constraints for Polite/Shiny Nelson-Oppen combination
  private finiteDomains: FiniteDomainConstraint[] = [];

  private assertedLiterals = new Map<number, TheoryLiteral>();
  private propagatedEqualities = new Set<string>();
  private propagatedDisequalities = new Set<string>();
  private sharedEqualities: SharedEquality[] = [];
  private individualJustifications = new Map<string, Set<number>>();
  private trail = new UndoTrail();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.subClasses.clear();
    this.disjointClasses.clear();
    this.individualTypes.clear();
    this.sameIndividualMap.clear();
    this.differentIndividuals.clear();
    this.finiteDomains = [];
    this.assertedLiterals.clear();
    this.propagatedEqualities.clear();
    this.propagatedDisequalities.clear();
    this.sharedEqualities = [];
    this.individualJustifications.clear();
    this.trail.reset();
  }

  public pushLevel(): void {
    this.trail.pushLevel();
  }

  public popLevel(): void {
    this.trail.popLevel();
  }

  private findRootIndividual(x: string): string {
    const directParent = this.sameIndividualMap.get(x);
    if (!directParent || directParent === x) {
      return x;
    }
    const grandParent = this.sameIndividualMap.get(directParent);
    if (!grandParent || grandParent === directParent) {
      return directParent;
    }

    let curr = x;
    const visited = new Set<string>();
    const path: string[] = [];

    while (true) {
      if (visited.has(curr)) {
        this.trail.mapSet(this.sameIndividualMap, curr, curr);
        break;
      }
      visited.add(curr);
      path.push(curr);
      const parent = this.sameIndividualMap.get(curr);
      if (!parent || parent === curr) {
        break;
      }
      curr = parent;
    }

    const root = curr;
    for (const node of path) {
      if (this.sameIndividualMap.get(node) !== root) {
        this.trail.mapSet(this.sameIndividualMap, node, root);
      }
    }
    return root;
  }

  private unionIndividuals(x: string, y: string, justIds: readonly number[] = []): void {
    const rootX = this.findRootIndividual(x);
    const rootY = this.findRootIndividual(y);
    if (rootX !== rootY) {
      this.trail.mapSet(this.sameIndividualMap, rootX, rootY);
      if (!this.sameIndividualMap.has(rootY)) {
        this.trail.mapSet(this.sameIndividualMap, rootY, rootY);
      }

      // Merge individual types
      const typesX = this.individualTypes.get(rootX);
      if (typesX && typesX.size > 0) {
        let typesY = this.individualTypes.get(rootY);
        if (!typesY) {
          typesY = new Set<string>();
          this.trail.mapSet(this.individualTypes, rootY, typesY);
        }
        for (const t of typesX) this.trail.setAdd(typesY, t);
      }

      // Merge justifications
      const jX = this.individualJustifications.get(rootX);
      let jY = this.individualJustifications.get(rootY);
      if (!jY && (jX || justIds.length > 0)) {
        jY = new Set<number>();
        this.trail.mapSet(this.individualJustifications, rootY, jY);
      }
      if (jY) {
        if (jX) for (const id of jX) this.trail.setAdd(jY, id);
        for (const id of justIds) this.trail.setAdd(jY, id);
      }
    } else if (justIds.length > 0) {
      let jY = this.individualJustifications.get(rootY);
      if (!jY) {
        jY = new Set<number>();
        this.trail.mapSet(this.individualJustifications, rootY, jY);
      }
      for (const id of justIds) this.trail.setAdd(jY, id);
    }
  }

  /**
   * Computes transitive closure of superclasses for a given class.
   */
  public getSuperClasses(cls: string, visited = new Set<string>()): Set<string> {
    if (visited.has(cls)) return visited;
    visited.add(cls);
    const directSupers = this.subClasses.get(cls);
    if (directSupers) {
      for (const sup of directSupers) {
        this.getSuperClasses(sup, visited);
      }
    }
    return visited;
  }

  /**
   * Asserts a theory literal into the ontology oracle.
   */
  public assertLiteral(lit: TheoryLiteral): boolean {
    this.trail.mapSet(this.assertedLiterals, lit.id, lit);
    const { predicate, args } = lit;

    switch (predicate) {
      case "subClassOf": {
        const [sub, sup] = args as [string, string];
        let set = this.subClasses.get(sub);
        if (!set) {
          set = new Set();
          this.trail.mapSet(this.subClasses, sub, set);
        }
        this.trail.setAdd(set, sup);
        break;
      }
      case "disjoint": {
        const [clsA, clsB] = args as [string, string];
        let setA = this.disjointClasses.get(clsA);
        if (!setA) {
          setA = new Set();
          this.trail.mapSet(this.disjointClasses, clsA, setA);
        }
        let setB = this.disjointClasses.get(clsB);
        if (!setB) {
          setB = new Set();
          this.trail.mapSet(this.disjointClasses, clsB, setB);
        }
        this.trail.setAdd(setA, clsB);
        this.trail.setAdd(setB, clsA);
        break;
      }
      case "type":
      case "isa":
      case "classAssertion": {
        const [ind, cls] = args as [string, string];
        const root = this.findRootIndividual(ind);
        if (!this.sameIndividualMap.has(root)) this.trail.mapSet(this.sameIndividualMap, root, root);
        let types = this.individualTypes.get(root);
        if (!types) {
          types = new Set();
          this.trail.mapSet(this.individualTypes, root, types);
        }
        this.trail.setAdd(types, cls);
        break;
      }
      case "sameIndividual": {
        const [indA, indB] = args as [string, string];
        this.unionIndividuals(indA, indB, [lit.id]);
        break;
      }
      case "differentIndividuals": {
        const [indA, indB] = args as [string, string];
        let setA = this.differentIndividuals.get(indA);
        if (!setA) {
          setA = new Set();
          this.trail.mapSet(this.differentIndividuals, indA, setA);
        }
        let setB = this.differentIndividuals.get(indB);
        if (!setB) {
          setB = new Set();
          this.trail.mapSet(this.differentIndividuals, indB, setB);
        }
        this.trail.setAdd(setA, indB);
        this.trail.setAdd(setB, indA);
        break;
      }
      case "bundleClosure": {
        // Automatically enforce pairwise disjointness for all sibling classes
        // declared within the bundle that do not have a declared common subclass.
        const [, siblings] = args as [string, string[]];
        for (let i = 0; i < siblings.length; i++) {
          for (let j = i + 1; j < siblings.length; j++) {
            const cA = siblings[i]!;
            const cB = siblings[j]!;
            if (!this.hasDeclaredJointSubclass(cA, cB)) {
              let setA = this.disjointClasses.get(cA);
              if (!setA) {
                setA = new Set();
                this.trail.mapSet(this.disjointClasses, cA, setA);
              }
              let setB = this.disjointClasses.get(cB);
              if (!setB) {
                setB = new Set();
                this.trail.mapSet(this.disjointClasses, cB, setB);
              }
              this.trail.setAdd(setA, cB);
              this.trail.setAdd(setB, cA);
            }
          }
        }
        break;
      }
      case "finiteDomain": {
        // args: [vars: string[], maxCardinality: number] or [domainName: string, vars: string[], maxCardinality: number]
        let vars: string[] = [];
        let maxCard = 0;
        if (Array.isArray(args[0]) && typeof args[1] === "number") {
          vars = args[0].map(String);
          maxCard = args[1];
        } else if (typeof args[0] === "string" && Array.isArray(args[1]) && typeof args[2] === "number") {
          vars = args[1].map(String);
          maxCard = args[2];
        }
        if (vars.length > 0 && maxCard >= 1) {
          this.trail.arrayPush(this.finiteDomains, {
            vars,
            maxCardinality: maxCard,
            sourceOracle: this.name,
            justifications: [lit.id],
          });
        }
        break;
      }
    }
    return true;
  }

  private hasDeclaredJointSubclass(clsA: string, clsB: string): boolean {
    for (const [sub] of this.subClasses.entries()) {
      const supers = this.getSuperClasses(sub);
      if (supers.has(clsA) && supers.has(clsB)) {
        return true;
      }
    }
    return false;
  }

  public retractLiteral(litId: number): void {
    const hasShared = hasSharedEqualityWithLiteral(this.sharedEqualities, litId);
    const existingLit = this.assertedLiterals.get(litId);
    if (!existingLit && !hasShared) return;
    this.assertedLiterals.delete(litId);

    // Incremental fast-path for single-individual type/isa/classAssertion or differentIndividuals
    if (existingLit && !hasShared) {
      if (
        (existingLit.predicate === "type" ||
          existingLit.predicate === "isa" ||
          existingLit.predicate === "classAssertion") &&
        typeof existingLit.args[0] === "string"
      ) {
        const root = this.findRootIndividual(existingLit.args[0]);
        const newTypes = new Set<string>();
        for (const lit of this.assertedLiterals.values()) {
          if (
            (lit.predicate === "type" || lit.predicate === "isa" || lit.predicate === "classAssertion") &&
            typeof lit.args[0] === "string" &&
            this.findRootIndividual(lit.args[0]) === root &&
            typeof lit.args[1] === "string"
          ) {
            newTypes.add(lit.args[1]);
          }
        }
        if (newTypes.size === 0) this.individualTypes.delete(root);
        else this.individualTypes.set(root, newTypes);
        return;
      }
      if (
        existingLit.predicate === "differentIndividuals" &&
        typeof existingLit.args[0] === "string" &&
        typeof existingLit.args[1] === "string"
      ) {
        const [indA, indB] = existingLit.args as [string, string];
        const stillDifferent = Array.from(this.assertedLiterals.values()).some(
          (l) =>
            l.predicate === "differentIndividuals" &&
            ((l.args[0] === indA && l.args[1] === indB) || (l.args[0] === indB && l.args[1] === indA)),
        );
        if (!stillDifferent) {
          this.differentIndividuals.get(indA)?.delete(indB);
          this.differentIndividuals.get(indB)?.delete(indA);
          const key = indA < indB ? `${indA}!=${indB}` : `${indB}!=${indA}`;
          this.propagatedDisequalities.delete(key);
        }
        return;
      }
    }

    const savedTrail = this.trail;
    const remaining = Array.from(this.assertedLiterals.values());
    const savedShared = retainSharedEqualitiesWithoutLiteral(this.sharedEqualities, litId);
    this.reset();
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
    for (const eq of savedShared) {
      this.onSharedEquality(eq);
    }
    this.trail = savedTrail;
  }

  /**
   * Checks for ontological consistency:
   *   1. No individual has multiple types that are disjoint.
   *   2. No individuals that are marked different are inferred to be the same.
   */
  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    // 1. Check disjointness violation across all individuals
    const checkedRoots = new Set<string>();
    for (const ind of this.sameIndividualMap.keys()) {
      const root = this.findRootIndividual(ind);
      if (checkedRoots.has(root)) continue;
      checkedRoots.add(root);
      const directTypes = this.individualTypes.get(root);
      if (!directTypes) continue;

      // Expand all inferred superclasses
      const allTypes = new Set<string>();
      for (const t of directTypes) {
        for (const sup of this.getSuperClasses(t)) {
          allTypes.add(sup);
        }
      }

      // Check if any pair in allTypes is disjoint
      for (const t1 of allTypes) {
        const disj = this.disjointClasses.get(t1);
        if (!disj) continue;
        for (const t2 of allTypes) {
          if (disj.has(t2)) {
            // Conflict found!
            const culpritLiterals = Array.from(this.assertedLiterals.values()).filter((lit) => {
              const args = lit.args as string[];
              return args.includes(ind) || args.includes(root) || args.includes(t1) || args.includes(t2);
            });

            return {
              isSat: false,
              conflict: {
                literals: culpritLiterals,
                explanation: `Ontological Conflict: Individual '${ind}' cannot simultaneously be both '${t1}' and '${t2}' (classes are disjoint).`,
                culpritEntities: [ind, t1, t2],
                theoryName: this.name,
              },
            };
          }
        }
      }
    }

    // 2. Check differentIndividuals violation
    for (const [indA, diffs] of this.differentIndividuals.entries()) {
      const rootA = this.findRootIndividual(indA);
      for (const indB of diffs) {
        const rootB = this.findRootIndividual(indB);
        if (rootA === rootB) {
          const culprits: TheoryLiteral[] = Array.from(this.assertedLiterals.values()).filter(
            (l) => l.args.includes(indA) && l.args.includes(indB),
          );
          const rootJusts = this.individualJustifications.get(rootA);
          if (rootJusts) {
            for (const id of rootJusts) {
              if (!culprits.some((c) => c.id === id)) {
                const l = this.assertedLiterals.get(id);
                culprits.push(l ?? { id, predicate: "crossTheoryAntecedent", args: [indA, indB] });
              }
            }
          }
          return {
            isSat: false,
            conflict: {
              literals: culprits,
              explanation: `Identity Conflict: Individuals '${indA}' and '${indB}' are declared different, but inferred to be the same.`,
              culpritEntities: [indA, indB],
              theoryName: this.name,
            },
          };
        }
      }
    }

    return { isSat: true };
  }

  /**
   * Propagates deduced equalities (sameIndividual relations) as an O(k) spanning path with justifications.
   */
  public propagateEqualities(): SharedEquality[] {
    const equalities: SharedEquality[] = [];
    const roots = new Map<string, string[]>();

    for (const [ind] of this.sameIndividualMap.entries()) {
      const root = this.findRootIndividual(ind);
      if (!roots.has(root)) roots.set(root, []);
      roots.get(root)!.push(ind);
    }

    for (const [root, group] of roots.entries()) {
      if (group.length > 1) {
        const rootJusts = this.individualJustifications.get(root);
        const justsArr = rootJusts ? Array.from(rootJusts) : [];
        // Emit O(k) spanning path group[i] == group[i+1] rather than O(k^2) clique
        for (let i = 0; i < group.length - 1; i++) {
          const vA = group[i]!;
          const vB = group[i + 1]!;
          const key = vA < vB ? `${vA}==${vB}` : `${vB}==${vA}`;
          if (!this.propagatedEqualities.has(key)) {
            this.trail.setAdd(this.propagatedEqualities, key);
            equalities.push({
              varA: vA,
              varB: vB,
              domain: "concept",
              explanation: `Deduced from ontology SameIndividual(${vA}, ${vB})`,
              sourceOracle: this.name,
              justifications: justsArr,
              justification: justsArr,
            });
          }
        }
      }
    }

    return equalities;
  }

  /**
   * Receives shared equalities from the coordinator and merges individuals.
   * Accepts concept, discrete, and cross-theory real equalities (excluding self-bound events).
   */
  public onSharedEquality(eq: SharedEquality): void {
    this.trail.arrayPush(this.sharedEqualities, eq);
    if (eq.varA !== eq.varB && (eq.domain === "concept" || eq.domain === "discrete" || eq.domain === "real")) {
      const justs = eq.justifications ?? eq.justification ?? [];
      this.unionIndividuals(eq.varA, eq.varB, justs);
    }
  }

  /**
   * Propagates explicitly asserted `differentIndividuals` disequalities to other theory oracles.
   */
  public propagateDisequalities(): SharedDisequality[] {
    const result: SharedDisequality[] = [];
    for (const [indA, diffs] of this.differentIndividuals.entries()) {
      for (const indB of diffs) {
        if (indA >= indB) continue;
        const key = `${indA}!=${indB}`;
        if (this.propagatedDisequalities.has(key)) continue;
        this.trail.setAdd(this.propagatedDisequalities, key);
        const justs = Array.from(this.assertedLiterals.values())
          .filter((l) => l.predicate === "differentIndividuals" && l.args.includes(indA) && l.args.includes(indB))
          .map((l) => l.id);
        result.push({
          varA: indA,
          varB: indB,
          explanation: `Ontology DifferentIndividuals(${indA}, ${indB})`,
          sourceOracle: this.name,
          justifications: justs,
        });
      }
    }
    return result;
  }

  /**
   * Receives deduced disequalities (`x != y`) from other theories (e.g., disjoint intervals).
   */
  public onSharedDisequality(diseq: SharedDisequality): void {
    let setA = this.differentIndividuals.get(diseq.varA);
    if (!setA) {
      setA = new Set();
      this.trail.mapSet(this.differentIndividuals, diseq.varA, setA);
    }
    let setB = this.differentIndividuals.get(diseq.varB);
    if (!setB) {
      setB = new Set();
      this.trail.mapSet(this.differentIndividuals, diseq.varB, setB);
    }
    this.trail.setAdd(setA, diseq.varB);
    this.trail.setAdd(setB, diseq.varA);
  }

  /**
   * Returns finite-domain cardinality constraints for Polite/Shiny Nelson-Oppen combination.
   */
  public getFiniteDomainConstraints(): FiniteDomainConstraint[] {
    return this.finiteDomains;
  }
}
