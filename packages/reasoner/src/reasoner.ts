// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reasoner Interface
 *
 * Abstract interface for OWL2 DL reasoners. Implementations include:
 * - `TableauReasoner` — Pure-TypeScript tableau-based reasoner (built-in)
 * - `FaCTPPReasoner`  — FaCT++ WASM backend (optional, requires `.wasm` binary)
 *
 * The interface is designed around the engineering-domain use cases of
 * ModelScript rather than full OWL2 DL compliance. It focuses on:
 * - Subsumption checking (is Motor a subclass of ElectricalDevice?)
 * - Consistency checking (do constraints conflict?)
 * - Instance classification (which classes does this component belong to?)
 * - Transitive property queries (fault propagation chains)
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
  /** If inconsistent, the minimal set of conflicting axioms. */
  readonly conflictingAxioms?: readonly OWL2Axiom[] | undefined;
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
// SPARQL-DL Query
// ---------------------------------------------------------------------------

/** A simplified SPARQL-DL query for engineering use cases. */
export interface DLQuery {
  /** The query type. */
  readonly type:
    | "instances" // ?x : C — find all instances of class C
    | "subclasses" // ?x ⊑ C — find all subclasses of C
    | "superclasses" // C ⊑ ?x — find all superclasses of C
    | "equivalents" // C ≡ ?x — find all equivalent classes
    | "disjoint" // C ⊓ ?x ⊑ ⊥ — find all disjoint classes
    | "property-values" // C(?x, ?y) — find all (subject, object) pairs for property
    | "reachable"; // C*(?x, ?y) — transitive closure of property
  /** The class or property IRI to query against. */
  readonly iri: string;
  /** For reachable queries: the starting individual IRI. */
  readonly fromIri?: string | undefined;
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

  /** Get the inferred taxonomy (class hierarchy). */
  getTaxonomy(): TaxonomyNode[];

  /** Classify an individual: infer all types it belongs to. */
  classifyIndividual(individualIri: string): ClassificationResult;

  /**
   * Compute the transitive closure of a property from a starting individual.
   * Used for fault propagation, connection tracing, etc.
   */
  getTransitiveClosure(propertyIri: string, fromIri: string): PropertyChainResult;

  /** Execute a DL query. */
  query(q: DLQuery): DLQueryResult;

  // -- Justification --

  /**
   * Explain why a given subsumption holds.
   * Returns the minimal set of axioms that entail the relationship.
   */
  explain(subClassIri: string, superClassIri: string): readonly OWL2Axiom[];
}
