// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared internal knowledge-base state types and primitive graph helpers
 * used across the OWL 2 reasoner, SWRL engine, BGP engine, SHACL validator,
 * and consistency checker.
 */

import type {
  OWL2Axiom,
  OWL2DataPropertyAssertion,
  OWL2LinearConstraint,
  OWL2NegativeDataPropertyAssertion,
  OWL2NegativeObjectPropertyAssertion,
  OWL2QualifiedCardinality,
  OWL2SubPropertyChainOf,
  OWL2SwrlRule,
} from "./owl2-types.js";

/** Internal taxonomy graph node for an OWL 2 class. */
export interface ClassNode {
  /** Direct asserted superclasses. */
  superClasses: Set<string>;
  /** Direct asserted subclasses. */
  subClasses: Set<string>;
  /** Directly equivalent classes. */
  equivalents: Set<string>;
  /** Transitive closure of all superclasses (populated during classification). */
  allSuperClasses: Set<string> | null;
  /** Transitive closure of all subclasses (populated during classification). */
  allSubClasses: Set<string> | null;
}

/** Directed object property assertion edge between two individuals. */
export interface PropertyEdge {
  /** Subject individual IRI. */
  subjectIri: string;
  /** Object individual IRI. */
  objectIri: string;
}

/** Covering multi-index for fast Basic Graph Pattern (BGP) conjunctive query evaluation. */
export interface BgpCompiledIndex {
  /** Flat list of all materialized `(s, p, o)` triples. */
  allFacts: { s: string; p: string; o: string }[];
  /** Set of NUL-delimited `s\0p\0o` strings for O(1) exact triple existence checks. */
  exactSet: Set<string>;
  /** Index mapping `s\0p` to matching object IRIs. */
  bySubjPred: Map<string, string[]>;
  /** Index mapping `p\0o` to matching subject IRIs. */
  byPredObj: Map<string, string[]>;
  /** Index mapping `s\0o` to matching predicate IRIs. */
  bySubjObj: Map<string, string[]>;
  /** Index mapping predicate IRI `p` to `(s, o)` pairs. */
  byPred: Map<string, { s: string; o: string }[]>;
  /** Index mapping subject IRI `s` to `(p, o)` pairs. */
  bySubj: Map<string, { p: string; o: string }[]>;
  /** Index mapping object IRI `o` to `(s, p)` pairs. */
  byObj: Map<string, { s: string; p: string }[]>;
}

/** Mutable indexed knowledge base shared by all reasoning subsystems without copying. */
export interface ReasonerState {
  axioms: OWL2Axiom[];
  classes: Map<string, ClassNode>;
  disjointPairs: Set<string>;
  objectProperties: Set<string>;
  dataProperties: Set<string>;
  transitiveProperties: Set<string>;
  functionalObjectProperties: Set<string>;
  sameIndividualGroups: Map<string, Set<string>>;
  individualTypes: Map<string, Set<string>>;
  objectPropertyAssertions: Map<string, PropertyEdge[]>;
  dataPropertyAssertions: Map<string, { subjectIri: string; value: string }[]>;
  functionalDataProperties: Set<string>;
  inverseFunctionalObjectProperties: Set<string>;
  reflexiveProperties: Set<string>;
  asymmetricProperties: Set<string>;
  irreflexiveProperties: Set<string>;
  disjointPropertyPairs: Set<string>;
  subObjectPropertyEdges: Map<string, Set<string>>;
  subDataPropertyEdges: Map<string, Set<string>>;
  objectPropertyDomains: Map<string, Set<string>>;
  objectPropertyRanges: Map<string, Set<string>>;
  dataPropertyDomains: Map<string, Set<string>>;
  dataPropertyRanges: Map<string, Set<string>>;
  negativeObjectAssertions: OWL2NegativeObjectPropertyAssertion[];
  negativeDataAssertions: OWL2NegativeDataPropertyAssertion[];
  rawDataPropertyAssertions: OWL2DataPropertyAssertion[];
  subPropertyChains: OWL2SubPropertyChainOf[];
  qualifiedCardinalities: OWL2QualifiedCardinality[];
  linearConstraints: OWL2LinearConstraint[];
  objectOneOfMap: Map<string, Set<string>>;
  differentIndividualPairs: Set<string>;
  swrlRules: OWL2SwrlRule[];
}

/** Retrieves or creates a `ClassNode` entry for `iri` in `classes`. */
export function ensureClassInState(classes: Map<string, ClassNode>, iri: string): ClassNode {
  let node = classes.get(iri);
  if (!node) {
    node = {
      superClasses: new Set(),
      subClasses: new Set(),
      equivalents: new Set(),
      allSuperClasses: null,
      allSubClasses: null,
    };
    classes.set(iri, node);
  }
  return node;
}

/** Recursively computes and caches the transitive closure of superclasses for `iri`. */
export function computeAllSuperClassesInState(classes: Map<string, ClassNode>, iri: string): Set<string> {
  const node = classes.get(iri);
  if (!node) return new Set();
  if (node.allSuperClasses) return node.allSuperClasses;

  node.allSuperClasses = new Set();

  for (const superIri of node.superClasses) {
    node.allSuperClasses.add(superIri);
    const transitive = computeAllSuperClassesInState(classes, superIri);
    for (const t of transitive) {
      node.allSuperClasses.add(t);
    }
  }

  for (const eqIri of node.equivalents) {
    node.allSuperClasses.add(eqIri);
  }

  return node.allSuperClasses;
}

/** Unifies two individuals via `SameIndividual` equivalence and merges their inferred class memberships. */
export function unifyIndividualsInState(
  sameIndividualGroups: Map<string, Set<string>>,
  individualTypes: Map<string, Set<string>>,
  ind1: string,
  ind2: string,
): boolean {
  if (ind1 === ind2) return false;
  const group1 = sameIndividualGroups.get(ind1) ?? new Set([ind1]);
  const group2 = sameIndividualGroups.get(ind2) ?? new Set([ind2]);
  if (group1 === group2) return false;

  const merged = new Set<string>(group1);
  for (const m of group2) merged.add(m);
  for (const m of merged) {
    sameIndividualGroups.set(m, merged);
  }

  const mergedTypes = new Set<string>();
  for (const m of merged) {
    const t = individualTypes.get(m);
    if (t) {
      for (const cls of t) mergedTypes.add(cls);
    }
  }
  for (const m of merged) {
    let t = individualTypes.get(m);
    if (!t) {
      t = new Set<string>();
      individualTypes.set(m, t);
    }
    for (const cls of mergedTypes) t.add(cls);
  }
  return true;
}

/** Checks whether two individuals (or their equivalence representatives) are asserted `DifferentIndividuals`. */
export function isDifferentInState(
  sameIndividualGroups: Map<string, Set<string>>,
  differentIndividualPairs: Set<string>,
  ind1: string,
  ind2: string,
): boolean {
  if (ind1 === ind2) return false;
  let rep1 = ind1;
  const g1 = sameIndividualGroups.get(ind1);
  if (g1 && g1.size > 0) rep1 = Array.from(g1).sort()[0]!;

  let rep2 = ind2;
  const g2 = sameIndividualGroups.get(ind2);
  if (g2 && g2.size > 0) rep2 = Array.from(g2).sort()[0]!;

  if (rep1 === rep2) return false;
  const key = rep1 < rep2 ? `${rep1}|${rep2}` : `${rep2}|${rep1}`;
  if (differentIndividualPairs.has(key)) return true;

  const keyDirect = ind1 < ind2 ? `${ind1}|${ind2}` : `${ind2}|${ind1}`;
  return differentIndividualPairs.has(keyDirect);
}
