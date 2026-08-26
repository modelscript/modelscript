// ---------------------------------------------------------------------------
// OWL2 Axiom Types
// ---------------------------------------------------------------------------

export interface OWL2ClassDeclaration {
  readonly type: "ClassDeclaration";
  readonly iri: string;
  readonly sourceLang: string;
  readonly sourceQualifiedName: string;
}

export interface OWL2SubClassOf {
  readonly type: "SubClassOf";
  readonly subClassIri: string;
  readonly superClassIri: string;
  readonly sourceLang: string;
}

export interface OWL2EquivalentClasses {
  readonly type: "EquivalentClasses";
  readonly classIris: readonly string[];
  readonly sourceLang: string;
}

export interface OWL2DisjointClasses {
  readonly type: "DisjointClasses";
  readonly classIris: readonly string[];
  readonly sourceLang: string;
}

export interface OWL2ObjectPropertyDeclaration {
  readonly type: "ObjectPropertyDeclaration";
  readonly iri: string;
  readonly sourceLang: string;
  readonly characteristics?: readonly ("Transitive" | "Functional" | "Symmetric" | "InverseFunctional")[];
}

export interface OWL2DataPropertyDeclaration {
  readonly type: "DataPropertyDeclaration";
  readonly iri: string;
  readonly sourceLang: string;
}

export interface OWL2ObjectPropertyAssertion {
  readonly type: "ObjectPropertyAssertion";
  readonly propertyIri: string;
  readonly subjectIri: string;
  readonly objectIri: string;
  readonly sourceLang: string;
}

export interface OWL2DataPropertyAssertion {
  readonly type: "DataPropertyAssertion";
  readonly propertyIri: string;
  readonly subjectIri: string;
  readonly value: string;
  readonly datatype?: string;
  readonly sourceLang: string;
}

export interface OWL2TransitiveObjectProperty {
  readonly type: "TransitiveObjectProperty";
  readonly propertyIri: string;
  readonly sourceLang: string;
}

export interface OWL2IndividualDeclaration {
  readonly type: "IndividualDeclaration";
  readonly iri: string;
  readonly sourceLang: string;
}

export interface OWL2ClassAssertion {
  readonly type: "ClassAssertion";
  readonly classIri: string;
  readonly individualIri: string;
  readonly sourceLang: string;
}

export interface OWL2ObjectSomeValuesFrom {
  readonly type: "ObjectSomeValuesFrom";
  readonly propertyIri: string;
  readonly fillerClassIri: string;
  readonly sourceLang: string;
}

export interface OWL2DataSomeValuesFrom {
  readonly type: "DataSomeValuesFrom";
  readonly propertyIri: string;
  readonly dataRange: string;
  readonly sourceLang: string;
}

export interface OWL2FunctionalObjectProperty {
  readonly type: "FunctionalObjectProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string;
}

export interface OWL2FunctionalDataProperty {
  readonly type: "FunctionalDataProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string;
}

export interface OWL2SameIndividual {
  readonly type: "SameIndividual";
  readonly individualIris: readonly string[];
  readonly sourceLang?: string;
}

export type OWL2Axiom =
  | OWL2ClassDeclaration
  | OWL2SubClassOf
  | OWL2EquivalentClasses
  | OWL2DisjointClasses
  | OWL2ObjectPropertyDeclaration
  | OWL2DataPropertyDeclaration
  | OWL2ObjectPropertyAssertion
  | OWL2DataPropertyAssertion
  | OWL2TransitiveObjectProperty
  | OWL2IndividualDeclaration
  | OWL2ClassAssertion
  | OWL2ObjectSomeValuesFrom
  | OWL2DataSomeValuesFrom
  | OWL2FunctionalObjectProperty
  | OWL2FunctionalDataProperty
  | OWL2SameIndividual;

export interface OWL2AxiomDelta {
  readonly retractions: readonly OWL2Axiom[];
  readonly assertions: readonly OWL2Axiom[];
}

export interface IOWL2OntologyStore {
  readonly size: number;
  readonly axioms: readonly OWL2Axiom[];
}

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
  /** All orthogonal minimal conflict cores via Reiter's Hitting Set Tree (HST). */
  readonly allMinimalConflictCores?: readonly (readonly OWL2Axiom[])[] | undefined;
  /** Minimal correction subsets (MCS) to restore consistency. */
  readonly minimalCorrectionSubsets?: readonly (readonly OWL2Axiom[])[] | undefined;
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

  /**
   * Enumerates All Minimal Unsatisfiable Subsets (All-MUS) via Reiter's Hitting Set Tree (HST).
   */
  allMus(maxCores?: number): readonly (readonly OWL2Axiom[])[];

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
