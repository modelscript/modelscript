// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reasoner Interface & Types
 *
 * Abstract types and interfaces for OWL2 DL reasoners and SPARQL-DL queries.
 */

import type { OWL2Axiom, OWL2AxiomDelta } from "@modelscript/compiler";

// ---------------------------------------------------------------------------
// Reasoner Status
// ---------------------------------------------------------------------------

export type ReasonerStatus = "idle" | "loading" | "classifying" | "ready" | "inconsistent" | "error";

// ---------------------------------------------------------------------------
// Query Results
// ---------------------------------------------------------------------------

/** Result of a subsumption check. */
export interface SubsumptionResult {
  readonly subClassIri: string;
  readonly superClassIri: string;
  readonly holds: boolean;
  /** If computed, the chain of axioms justifying the entailment. */
  readonly justification?: readonly OWL2Axiom[] | undefined;
}

/** Result of a consistency check. */
export interface ConsistencyResult {
  readonly isConsistent: boolean;
  /** If inconsistent, the set of conflicting axioms. */
  readonly conflictingAxioms?: readonly OWL2Axiom[] | undefined;
  /** If computed, the minimal unsatisfiable subset (MUS) / minimal conflict core via QuickXplain. */
  readonly minimalConflictCore?: readonly OWL2Axiom[] | undefined;
  /** Human-readable explanation. */
  readonly explanation?: string | undefined;
}

/** A classified individual with its inferred types. */
export interface ClassificationResult {
  readonly individualIri: string;
  readonly directTypes: readonly string[];
  readonly allTypes: readonly string[];
}

/** A node in the inferred class hierarchy. */
export interface TaxonomyNode {
  readonly iri: string;
  readonly directSuperClasses: readonly string[];
  readonly directSubClasses: readonly string[];
  readonly equivalentClasses: readonly string[];
}

/** Result of a property chain query (e.g., fault propagation). */
export interface PropertyChainResult {
  readonly propertyIri: string;
  readonly sourceIri: string;
  /** Ordered list of reachable IRIs via transitive closure. */
  readonly reachable: readonly string[];
  /** The path of property assertions traversed. */
  readonly path: readonly { subjectIri: string; objectIri: string }[];
}

// ---------------------------------------------------------------------------
// SPARQL-DL & Property Path Queries
// ---------------------------------------------------------------------------

export type PropertyPathOp = "direct" | "plus" | "star" | "inverse" | "inverse-plus" | "sequence" | "alternation";

/** A simplified SPARQL-DL or Property Path query. */
export interface DLQuery {
  /** The query type. */
  readonly type:
    | "instances" // ?x : C — find all instances of class C
    | "subclasses" // ?x ⊑ C — find all subclasses of C
    | "superclasses" // C ⊑ ?x — find all superclasses of C
    | "equivalents" // C ≡ ?x — find all equivalent classes
    | "disjoint" // C ⊓ ?x ⊑ ⊥ — find all disjoint classes
    | "property-values" // C(?x, ?y) — find all (subject, object) pairs for property
    | "reachable" // C*(?x, ?y) — transitive closure of property
    | "path"; // SPARQL 1.1 Property Path (+, *, ^, /, |)
  /** The class or property IRI to query against, or raw path expression. */
  readonly iri: string;
  /** For reachable/path queries: the starting individual IRI. */
  readonly fromIri?: string | undefined;
  /** Property path operator if parsed. */
  readonly pathOp?: PropertyPathOp | undefined;
  /** Second property IRI for sequence (/) or alternation (|). */
  readonly stepPropertyIri2?: string | undefined;
}

/** A single triple pattern for conjunctive / BGP queries. */
export interface TriplePattern {
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
}

/** Basic Graph Pattern (BGP) query with multiple join variables. */
export interface BgpQuery {
  readonly patterns: readonly TriplePattern[];
}

/** Result of a BGP query. */
export interface BgpQueryResult {
  readonly variables: readonly string[];
  readonly bindings: readonly Record<string, string>[];
  readonly executionTimeMs: number;
}

/** Result of a DL query. */
export interface DLQueryResult {
  readonly query: DLQuery;
  readonly bindings: readonly string[];
  /** For property-values queries: pairs of (subject, object). */
  readonly pairs?: readonly { subject: string; object: string }[] | undefined;
  readonly executionTimeMs: number;
}

// ---------------------------------------------------------------------------
// Reasoner Interface
// ---------------------------------------------------------------------------

/**
 * Abstract reasoner interface. All reasoner implementations must
 * implement this contract.
 */
export interface IOWLReasoner {
  /** Current reasoner status. */
  readonly status: ReasonerStatus;

  /** Number of axioms currently loaded. */
  readonly axiomCount: number;

  // -- Lifecycle --

  /** Initialize the reasoner (load WASM, allocate resources, etc.) */
  init(): Promise<void>;

  /** Load a complete set of axioms (replaces any existing ontology). */
  loadOntology(axioms: readonly OWL2Axiom[]): void;

  /**
   * Apply an incremental delta (retract old axioms, assert new ones).
   * Much faster than `loadOntology()` for single-file edits.
   */
  applyDelta(delta: OWL2AxiomDelta): void;

  /** Trigger full classification (compute inferred hierarchy). */
  classify(): void;

  /** Release resources (WASM memory, etc.) */
  dispose(): void;

  // -- Queries --

  /** Check if subClass ⊑ superClass is entailed. */
  isSubClassOf(subClassIri: string, superClassIri: string): SubsumptionResult;

  /** Check if the current ontology is consistent. */
  checkConsistency(): ConsistencyResult;

  /**
   * Fast conflict pinpointing via Junker's QuickXplain algorithm.
   * Finds the minimal conflict core in O(k log (N/k)) tests.
   */
  quickXplain(backgroundAxioms?: readonly OWL2Axiom[]): readonly OWL2Axiom[];

  /** Get the inferred taxonomy (class hierarchy). */
  getTaxonomy(): TaxonomyNode[];

  /** Classify an individual: infer all types it belongs to. */
  classifyIndividual(individualIri: string): ClassificationResult;

  /**
   * Compute the transitive closure of a property from a starting individual.
   * Used for fault propagation, connection tracing, etc.
   */
  getTransitiveClosure(propertyIri: string, fromIri: string): PropertyChainResult;

  /**
   * Evaluates a SPARQL 1.1 Property Path (+, *, ^, /, |).
   */
  evaluatePropertyPath(
    propertyIri: string,
    pathOp: PropertyPathOp,
    fromIri: string,
    stepPropertyIri2?: string,
  ): readonly string[];

  /** Execute a DL query. */
  query(q: DLQuery): DLQueryResult;

  /** Execute a multi-pattern BGP query using Leapfrog Triejoin (WCOJ). */
  queryBgp?(query: BgpQuery): BgpQueryResult;

  // -- Justification --

  /**
   * Explain why a given subsumption holds.
   * Returns the minimal set of axioms that entail the relationship.
   */
  explain(subClassIri: string, superClassIri: string): readonly OWL2Axiom[];
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type OntologyEvent =
  | { type: "status-changed"; status: ReasonerStatus }
  | { type: "classified"; axiomCount: number; timeMs: number }
  | { type: "consistency-result"; result: ConsistencyResult }
  | { type: "delta-applied"; delta: OWL2AxiomDelta }
  | { type: "error"; error: Error };

export type OntologyEventListener = (event: OntologyEvent) => void;
