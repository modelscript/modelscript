// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Ontology Theory Oracle.
 *
 * Implements description logic reasoning over concepts, subsumptions, disjointness,
 * individuals, and automated package bundle closures.
 */

import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";

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

  private assertedLiterals = new Map<number, TheoryLiteral>();
  private propagatedEqualities = new Set<string>();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.subClasses.clear();
    this.disjointClasses.clear();
    this.individualTypes.clear();
    this.sameIndividualMap.clear();
    this.differentIndividuals.clear();
    this.assertedLiterals.clear();
    this.propagatedEqualities.clear();
  }

  private findRootIndividual(x: string): string {
    const parent = this.sameIndividualMap.get(x);
    if (!parent || parent === x) {
      this.sameIndividualMap.set(x, x);
      return x;
    }
    const root = this.findRootIndividual(parent);
    this.sameIndividualMap.set(x, root);
    return root;
  }

  private unionIndividuals(x: string, y: string): void {
    const rootX = this.findRootIndividual(x);
    const rootY = this.findRootIndividual(y);
    if (rootX !== rootY) {
      this.sameIndividualMap.set(rootX, rootY);

      // Merge individual types
      const typesX = this.individualTypes.get(rootX) ?? new Set<string>();
      const typesY = this.individualTypes.get(rootY) ?? new Set<string>();
      for (const t of typesX) typesY.add(t);
      this.individualTypes.set(rootY, typesY);
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
    this.assertedLiterals.set(lit.id, lit);
    const { predicate, args } = lit;

    switch (predicate) {
      case "subClassOf": {
        const [sub, sup] = args as [string, string];
        if (!this.subClasses.has(sub)) this.subClasses.set(sub, new Set());
        this.subClasses.get(sub)!.add(sup);
        break;
      }
      case "disjoint": {
        const [clsA, clsB] = args as [string, string];
        if (!this.disjointClasses.has(clsA)) this.disjointClasses.set(clsA, new Set());
        if (!this.disjointClasses.has(clsB)) this.disjointClasses.set(clsB, new Set());
        this.disjointClasses.get(clsA)!.add(clsB);
        this.disjointClasses.get(clsB)!.add(clsA);
        break;
      }
      case "type":
      case "isa":
      case "classAssertion": {
        const [ind, cls] = args as [string, string];
        const root = this.findRootIndividual(ind);
        if (!this.individualTypes.has(root)) this.individualTypes.set(root, new Set());
        this.individualTypes.get(root)!.add(cls);
        break;
      }
      case "sameIndividual": {
        const [indA, indB] = args as [string, string];
        this.unionIndividuals(indA, indB);
        break;
      }
      case "differentIndividuals": {
        const [indA, indB] = args as [string, string];
        if (!this.differentIndividuals.has(indA)) this.differentIndividuals.set(indA, new Set());
        if (!this.differentIndividuals.has(indB)) this.differentIndividuals.set(indB, new Set());
        this.differentIndividuals.get(indA)!.add(indB);
        this.differentIndividuals.get(indB)!.add(indA);
        break;
      }
      case "bundleClosure": {
        // Automatically enforce pairwise disjointness for all sibling classes
        // declared within the bundle that do not have a declared common subclass.
        const [pkg, siblings] = args as [string, string[]];
        for (let i = 0; i < siblings.length; i++) {
          for (let j = i + 1; j < siblings.length; j++) {
            const cA = siblings[i]!;
            const cB = siblings[j]!;
            if (!this.hasDeclaredJointSubclass(cA, cB)) {
              if (!this.disjointClasses.has(cA)) this.disjointClasses.set(cA, new Set());
              if (!this.disjointClasses.has(cB)) this.disjointClasses.set(cB, new Set());
              this.disjointClasses.get(cA)!.add(cB);
              this.disjointClasses.get(cB)!.add(cA);
            }
          }
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
    if (!this.assertedLiterals.has(litId)) return;
    this.assertedLiterals.delete(litId);
    // Replay remaining literals
    const remaining = Array.from(this.assertedLiterals.values());
    this.reset();
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
  }

  /**
   * Checks for ontological consistency:
   *   1. No individual has multiple types that are disjoint.
   *   2. No individuals that are marked different are inferred to be the same.
   */
  public checkSat(): { isSat: boolean; conflict?: ConflictClause } {
    // 1. Check disjointness violation across all individuals
    for (const [ind] of this.sameIndividualMap.entries()) {
      const root = this.findRootIndividual(ind);
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
          return {
            isSat: false,
            conflict: {
              literals: Array.from(this.assertedLiterals.values()).filter(
                (l) => l.args.includes(indA) && l.args.includes(indB),
              ),
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
   * Propagates deduced equalities (sameIndividual relations).
   */
  public propagateEqualities(): SharedEquality[] {
    const equalities: SharedEquality[] = [];
    const roots = new Map<string, string[]>();

    for (const [ind] of this.sameIndividualMap.entries()) {
      const root = this.findRootIndividual(ind);
      if (!roots.has(root)) roots.set(root, []);
      roots.get(root)!.push(ind);
    }

    for (const [, group] of roots.entries()) {
      if (group.length > 1) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const vA = group[i]!;
            const vB = group[j]!;
            const key = vA < vB ? `${vA}==${vB}` : `${vB}==${vA}`;
            if (!this.propagatedEqualities.has(key)) {
              this.propagatedEqualities.add(key);
              equalities.push({
                varA: vA,
                varB: vB,
                domain: "concept",
                explanation: `Deduced from ontology SameIndividual(${vA}, ${vB})`,
                sourceOracle: this.name,
              });
            }
          }
        }
      }
    }

    return equalities;
  }

  /**
   * Receives shared equalities from the coordinator and merges individuals.
   */
  public onSharedEquality(eq: SharedEquality): void {
    if (eq.domain === "concept" || eq.domain === "discrete") {
      this.unionIndividuals(eq.varA, eq.varB);
    }
  }
}
