// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core OWL 2, SWRL, SHACL, Reasoner, Store, and Spatial Type Definitions & Constants.
 */

/** Source-location provenance token linking an inferred or projected ontology entity back to source code. */
export interface ProvenanceToken {
  readonly tokenId: number;
  readonly sourceLang?: string | undefined;
  readonly sourceUri?: string | undefined;
  readonly startOffset?: number | undefined;
  readonly endOffset?: number | undefined;
  readonly symbolId?: string | number | undefined;
}

/** Result of projecting a language-specific AST/CST construct into ontology properties and provenance tokens. */
export interface OntologyProjectionResult {
  props: Record<string, unknown>;
  provenanceTokens?: readonly ProvenanceToken[] | undefined;
  blameLocations?:
    | readonly {
        uri?: string | undefined;
        startOffset?: number | undefined;
        endOffset?: number | undefined;
        sourceLang?: string | undefined;
        symbolId?: string | number | undefined;
      }[]
    | undefined;
}

// ---------------------------------------------------------------------------
// OWL2 Axiom Types
// ---------------------------------------------------------------------------

/** OWL 2 class declaration axiom (`Declaration(Class(C))`). */
export interface OWL2ClassDeclaration {
  readonly type: "ClassDeclaration";
  readonly iri: string;
  readonly sourceLang?: string | undefined;
  readonly sourceQualifiedName?: string | undefined;
}

/** OWL 2 subclass inclusion axiom (`SubClassOf(C D)`). */
export interface OWL2SubClassOf {
  readonly type: "SubClassOf";
  readonly subClassIri: string;
  readonly superClassIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 class equivalence axiom (`EquivalentClasses(C1 ... Cn)`). */
export interface OWL2EquivalentClasses {
  readonly type: "EquivalentClasses";
  readonly classIris: readonly string[];
  readonly sourceLang?: string | undefined;
}

/** OWL 2 disjoint classes axiom (`DisjointClasses(C1 ... Cn)`). */
export interface OWL2DisjointClasses {
  readonly type: "DisjointClasses";
  readonly classIris: readonly string[];
  readonly subClassIri?: string | undefined;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 object property declaration axiom (`Declaration(ObjectProperty(R))`). */
export interface OWL2ObjectPropertyDeclaration {
  readonly type: "ObjectPropertyDeclaration";
  readonly iri: string;
  readonly sourceLang?: string | undefined;
  readonly characteristics?: readonly ("Transitive" | "Functional" | "Symmetric" | "InverseFunctional")[] | undefined;
}

/** OWL 2 data property declaration axiom (`Declaration(DataProperty(P))`). */
export interface OWL2DataPropertyDeclaration {
  readonly type: "DataPropertyDeclaration";
  readonly iri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 positive object property assertion (`ObjectPropertyAssertion(R a b)`). */
export interface OWL2ObjectPropertyAssertion {
  readonly type: "ObjectPropertyAssertion";
  readonly propertyIri: string;
  readonly subjectIri: string;
  readonly objectIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 positive data property assertion (`DataPropertyAssertion(P a v)`) with optional numeric bounds. */
export interface OWL2DataPropertyAssertion {
  readonly type: "DataPropertyAssertion";
  readonly propertyIri: string;
  readonly subjectIri: string;
  readonly value: string;
  readonly datatype?: string | undefined;
  readonly sourceLang?: string | undefined;
  readonly minVal?: number | undefined;
  readonly maxVal?: number | undefined;
  readonly op?: "<" | "<=" | ">" | ">=" | "=" | "!=" | undefined;
}

/** OWL 2 transitive object property axiom (`TransitiveObjectProperty(R)`). */
export interface OWL2TransitiveObjectProperty {
  readonly type: "TransitiveObjectProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 named individual declaration axiom (`Declaration(NamedIndividual(a))`). */
export interface OWL2IndividualDeclaration {
  readonly type: "IndividualDeclaration";
  readonly iri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 class assertion axiom (`ClassAssertion(C a)`). */
export interface OWL2ClassAssertion {
  readonly type: "ClassAssertion";
  readonly classIri: string;
  readonly individualIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 existential object restriction (`SubClassOf(C ObjectSomeValuesFrom(R D))`). */
export interface OWL2ObjectSomeValuesFrom {
  readonly type: "ObjectSomeValuesFrom";
  readonly subClassIri?: string | undefined;
  readonly propertyIri: string;
  readonly fillerClassIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 existential data restriction (`SubClassOf(C DataSomeValuesFrom(P DR))`). */
export interface OWL2DataSomeValuesFrom {
  readonly type: "DataSomeValuesFrom";
  readonly subClassIri?: string | undefined;
  readonly propertyIri: string;
  readonly dataRange: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 functional object property axiom (`FunctionalObjectProperty(R)`). */
export interface OWL2FunctionalObjectProperty {
  readonly type: "FunctionalObjectProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 inverse-functional object property axiom (`InverseFunctionalObjectProperty(R)`). */
export interface OWL2InverseFunctionalObjectProperty {
  readonly type: "InverseFunctionalObjectProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 reflexive object property axiom (`ReflexiveObjectProperty(R)`). */
export interface OWL2ReflexiveObjectProperty {
  readonly type: "ReflexiveObjectProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 functional data property axiom (`FunctionalDataProperty(P)`). */
export interface OWL2FunctionalDataProperty {
  readonly type: "FunctionalDataProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 object subproperty axiom (`SubObjectPropertyOf(R1 R2)`). */
export interface OWL2SubObjectPropertyOf {
  readonly type: "SubObjectPropertyOf";
  readonly subPropertyIri: string;
  readonly superPropertyIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 data subproperty axiom (`SubDataPropertyOf(P1 P2)`). */
export interface OWL2SubDataPropertyOf {
  readonly type: "SubDataPropertyOf";
  readonly subPropertyIri: string;
  readonly superPropertyIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 object property domain axiom (`ObjectPropertyDomain(R C)`). */
export interface OWL2ObjectPropertyDomain {
  readonly type: "ObjectPropertyDomain";
  readonly propertyIri: string;
  readonly domainIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 object property range axiom (`ObjectPropertyRange(R C)`). */
export interface OWL2ObjectPropertyRange {
  readonly type: "ObjectPropertyRange";
  readonly propertyIri: string;
  readonly rangeIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 data property domain axiom (`DataPropertyDomain(P C)`). */
export interface OWL2DataPropertyDomain {
  readonly type: "DataPropertyDomain";
  readonly propertyIri: string;
  readonly domainIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 data property range axiom (`DataPropertyRange(P DR)`). */
export interface OWL2DataPropertyRange {
  readonly type: "DataPropertyRange";
  readonly propertyIri: string;
  readonly rangeIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 negative object property assertion (`NegativeObjectPropertyAssertion(R a b)`). */
export interface OWL2NegativeObjectPropertyAssertion {
  readonly type: "NegativeObjectPropertyAssertion";
  readonly propertyIri: string;
  readonly subjectIri: string;
  readonly objectIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 negative data property assertion (`NegativeDataPropertyAssertion(P a v)`). */
export interface OWL2NegativeDataPropertyAssertion {
  readonly type: "NegativeDataPropertyAssertion";
  readonly propertyIri: string;
  readonly subjectIri: string;
  readonly value: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 individual equality axiom (`SameIndividual(a1 ... an)`). */
export interface OWL2SameIndividual {
  readonly type: "SameIndividual";
  readonly individualIris: readonly string[];
  readonly sourceLang?: string | undefined;
}

/** OWL 2 universal object restriction (`SubClassOf(C ObjectAllValuesFrom(R D))`). */
export interface OWL2UniversalRestriction {
  readonly type: "UniversalRestriction";
  readonly propertyIri: string;
  readonly targetClassIri: string;
  readonly classIri?: string | undefined;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 disjunctive class union axiom (`SubClassOf(C ObjectUnionOf(D1 ... Dn))`). */
export interface OWL2DisjunctiveClass {
  readonly type: "DisjunctiveClass";
  readonly classIris: readonly string[];
  readonly superClassIri?: string | undefined;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 qualified cardinality restriction (`ObjectMinCardinality` / `ObjectMaxCardinality` / `ObjectExactCardinality`). */
export interface OWL2QualifiedCardinality {
  readonly type: "QualifiedCardinality";
  readonly classIri: string;
  readonly propertyIri: string;
  readonly fillerClassIri?: string | undefined;
  readonly cardinalityType: "min" | "max" | "exact";
  readonly count: number;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 symmetric object property axiom (`SymmetricObjectProperty(R)`). */
export interface OWL2SymmetricObjectProperty {
  readonly type: "SymmetricObjectProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 inverse object properties axiom (`InverseObjectProperties(R S)`). */
export interface OWL2InverseObjectProperty {
  readonly type: "InverseObjectProperty";
  readonly propertyIri: string;
  readonly inversePropertyIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 asymmetric object property axiom (`AsymmetricObjectProperty(R)`). */
export interface OWL2AsymmetricObjectProperty {
  readonly type: "AsymmetricObjectProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 irreflexive object property axiom (`IrreflexiveObjectProperty(R)`). */
export interface OWL2IrreflexiveObjectProperty {
  readonly type: "IrreflexiveObjectProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 disjoint object properties axiom (`DisjointObjectProperties(R1 ... Rn)`). */
export interface OWL2DisjointObjectProperties {
  readonly type: "DisjointObjectProperties";
  readonly propertyIris: readonly string[];
  readonly sourceLang?: string | undefined;
}

/** OWL 2 enumeration / nominal class definition (`EquivalentClasses(C ObjectOneOf(a1 ... an))`). */
export interface OWL2NominalClass {
  readonly type: "NominalClass" | "ObjectOneOf";
  readonly classIri: string;
  readonly individualIris: readonly string[];
  readonly sourceLang?: string | undefined;
}
/** Alias for `OWL2NominalClass`. */
export type OWL2ObjectOneOf = OWL2NominalClass;

/** OWL 2 individual inequality axiom (`DifferentIndividuals(a1 ... an)`). */
export interface OWL2DifferentIndividuals {
  readonly type: "DifferentIndividuals";
  readonly individualIris: readonly string[];
  readonly sourceLang?: string | undefined;
}

/** OWL 2 local reflexivity restriction (`SubClassOf(C ObjectHasSelf(R))`). */
export interface OWL2SelfRestriction {
  readonly type: "SelfRestriction";
  readonly classIri: string;
  readonly propertyIri: string;
  readonly sourceLang?: string | undefined;
}

/** OWL 2 role composition / property chain inclusion (`SubObjectPropertyOf(ObjectPropertyChain(R1 ... Rn) S)`). */
export interface OWL2SubPropertyChainOf {
  readonly type: "SubPropertyChainOf";
  readonly subPropertyChain: readonly string[];
  readonly superPropertyIri: string;
  readonly sourceLang?: string | undefined;
}

/** Single weighted term in a linear data-property constraint (`coefficient * propertyIri`). */
export interface OWL2LinearTerm {
  readonly propertyIri: string;
  readonly coefficient: number;
}

/** Multivariate linear inequality/equality constraint over data properties of an individual or class. */
export interface OWL2LinearConstraint {
  readonly type: "LinearConstraint";
  readonly subjectIri: string;
  readonly terms: readonly OWL2LinearTerm[];
  readonly op: "<" | "<=" | ">" | ">=" | "=";
  readonly bound: number;
  readonly sourceLang?: string | undefined;
}

// ---------------------------------------------------------------------------
// SWRL Rules and Atoms
// ---------------------------------------------------------------------------

/** SWRL class atom (`C(?x)`). */
export interface SWRLClassAtom {
  readonly type: "ClassAtom";
  readonly classIri: string;
  readonly argument: string;
}

/** SWRL object property atom (`R(?x, ?y)`). */
export interface SWRLIndividualPropertyAtom {
  readonly type: "IndividualPropertyAtom";
  readonly propertyIri: string;
  readonly argument1: string;
  readonly argument2: string;
}

/** SWRL data property atom (`P(?x, ?v)`). */
export interface SWRLDataPropertyAtom {
  readonly type: "DataPropertyAtom";
  readonly propertyIri: string;
  readonly argument1: string;
  readonly argument2: string | number;
}

/** SWRL built-in predicate atom (`swrlb:add(?res, ?a, ?b)`, etc.). */
export interface SWRLBuiltInAtom {
  readonly type: "BuiltInAtom";
  readonly builtInIri: string;
  readonly arguments: readonly (string | number)[];
}

/** SWRL same-individual equality atom (`sameAs(?x, ?y)`). */
export interface SWRLSameIndividualAtom {
  readonly type: "SameIndividualAtom";
  readonly argument1: string;
  readonly argument2: string;
}

/** SWRL different-individuals inequality atom (`differentFrom(?x, ?y)`). */
export interface SWRLDifferentIndividualsAtom {
  readonly type: "DifferentIndividualsAtom";
  readonly argument1: string;
  readonly argument2: string;
}

/** Union of all supported SWRL rule body/head atom types. */
export type SWRLAtom =
  | SWRLClassAtom
  | SWRLIndividualPropertyAtom
  | SWRLDataPropertyAtom
  | SWRLBuiltInAtom
  | SWRLSameIndividualAtom
  | SWRLDifferentIndividualsAtom;

/** DL-safe SWRL implication rule (`body => head`). */
export interface OWL2SwrlRule {
  readonly type: "SwrlRule";
  readonly ruleIri?: string | undefined;
  readonly body: readonly SWRLAtom[];
  readonly head: readonly SWRLAtom[];
  readonly sourceLang?: string | undefined;
}

// ---------------------------------------------------------------------------
// SHACL Shapes and Rules (SHACL-AF)
// ---------------------------------------------------------------------------

/** SHACL-SPARQL BGP query constraint (`sh:sparql`). */
export interface SHACLSparqlConstraint {
  readonly ask?: BgpQuery | undefined;
  readonly select?: BgpQuery | undefined;
  readonly expectEmpty?: boolean | undefined;
  readonly message?: string | undefined;
}

/** SHACL property shape specification (`sh:PropertyShape`). */
export interface SHACLPropertyShape {
  readonly path: string;
  readonly targetClass?: string | undefined;
  readonly minCount?: number | undefined;
  readonly maxCount?: number | undefined;
  readonly qualifiedValueShape?: string | undefined;
  readonly pattern?: string | undefined;
  readonly hasValue?: string | undefined;
  readonly in?: readonly string[] | undefined;
  readonly class?: string | undefined;
  readonly or?: readonly SHACLPropertyShape[] | undefined;
  readonly and?: readonly SHACLPropertyShape[] | undefined;
  readonly not?: SHACLPropertyShape | undefined;
  readonly xone?: readonly SHACLPropertyShape[] | undefined;
  readonly minInclusive?: number | undefined;
  readonly maxInclusive?: number | undefined;
  readonly minExclusive?: number | undefined;
  readonly maxExclusive?: number | undefined;
  readonly lessThan?: string | undefined;
  readonly lessThanOrEquals?: string | undefined;
  readonly sparql?: SHACLSparqlConstraint | undefined;
}

/** SHACL Advanced Features (SHACL-AF) triple derivation rule (`sh:TripleRule`). */
export interface SHACLTripleRule {
  readonly type?: "TripleRule" | undefined;
  readonly targetClass: string;
  readonly subject?: string | undefined; // defaults to "?this" or "sh:this"
  readonly predicate: string;
  readonly object: string;
  readonly condition?: SHACLPropertyShape | undefined;
}

/** SHACL Advanced Features (SHACL-AF) SPARQL construct rule (`sh:SPARQLRule`). */
export interface SHACLSparqlRule {
  readonly type: "SparqlRule";
  readonly targetClass: string;
  readonly constructPatterns: readonly TriplePattern[];
  readonly wherePatterns: readonly TriplePattern[];
}

/**
 * @deprecated Legacy rule representation. Use `SHACLTripleRule` or `SHACLSparqlRule` instead.
 */
export interface SHACLLegacyRule {
  readonly targetClass: string;
  readonly propertyIri: string;
  readonly fillerClassIri?: string | undefined;
  readonly minCount?: number | undefined;
  readonly maxCount?: number | undefined;
  readonly derivedClassIri?: string | undefined;
  readonly derivedPropertyIri?: string | undefined;
  readonly derivedValueIri?: string | undefined;
}

/** Union of supported SHACL-AF derivation rules. */
export type SHACLRule = SHACLTripleRule | SHACLSparqlRule | SHACLLegacyRule;

/** SHACL node shape specification (`sh:NodeShape`) targeting a class and its instances. */
export interface SHACLNodeShape {
  readonly targetClass: string;
  readonly propertyShapes: readonly SHACLPropertyShape[];
  readonly closed?: boolean | undefined;
  readonly rules?: readonly SHACLRule[] | undefined;
}

/** Validation violation produced when a focus node fails a SHACL shape constraint. */
export interface SHACLViolation {
  readonly focusNode: string;
  readonly resultPath: string;
  readonly message: string;
  readonly constraintComponent: string;
  readonly severity?: "Violation" | "Warning" | "Info" | undefined;
  readonly blameLocations?:
    | readonly {
        uri?: string | undefined;
        startOffset?: number | undefined;
        endOffset?: number | undefined;
        sourceLang?: string | undefined;
        symbolId?: string | number | undefined;
      }[]
    | undefined;
}

/** Discriminated union of all supported OWL 2 and SWRL axioms. */
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
  | OWL2InverseFunctionalObjectProperty
  | OWL2ReflexiveObjectProperty
  | OWL2FunctionalDataProperty
  | OWL2SubObjectPropertyOf
  | OWL2SubDataPropertyOf
  | OWL2ObjectPropertyDomain
  | OWL2ObjectPropertyRange
  | OWL2DataPropertyDomain
  | OWL2DataPropertyRange
  | OWL2NegativeObjectPropertyAssertion
  | OWL2NegativeDataPropertyAssertion
  | OWL2SameIndividual
  | OWL2UniversalRestriction
  | OWL2DisjunctiveClass
  | OWL2QualifiedCardinality
  | OWL2SymmetricObjectProperty
  | OWL2InverseObjectProperty
  | OWL2AsymmetricObjectProperty
  | OWL2IrreflexiveObjectProperty
  | OWL2DisjointObjectProperties
  | OWL2NominalClass
  | OWL2DifferentIndividuals
  | OWL2SelfRestriction
  | OWL2SubPropertyChainOf
  | OWL2LinearConstraint
  | OWL2SwrlRule;

/** Incremental ontology changeset consisting of retracted and newly asserted OWL 2 axioms. */
export interface OWL2AxiomDelta {
  readonly retractions: readonly OWL2Axiom[];
  readonly assertions: readonly OWL2Axiom[];
}

/** Read-only interface to an OWL 2 ontology axiom store. */
export interface IOWL2OntologyStore {
  readonly size: number;
  readonly axioms: readonly OWL2Axiom[];
}

// ---------------------------------------------------------------------------
// Reasoner Status & Query Results
// ---------------------------------------------------------------------------

/** Lifecycle state of an OWL 2 ontology reasoner. */
export type ReasonerStatus = "idle" | "loading" | "classifying" | "ready" | "inconsistent" | "error";

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
  /** Minimal unsatisfiable subset (MUS) / minimal conflict core via QuickXplain. */
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

/** Result of a property chain query. */
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

/** Supported SPARQL 1.1 property path operators. */
export type PropertyPathOp = "direct" | "plus" | "star" | "inverse" | "inverse-plus" | "sequence" | "alternation";

/** A simplified SPARQL-DL or Property Path query. */
export interface DLQuery {
  readonly type:
    "instances" | "subclasses" | "superclasses" | "equivalents" | "disjoint" | "property-values" | "reachable" | "path";
  readonly iri: string;
  readonly fromIri?: string | undefined;
  readonly pathOp?: PropertyPathOp | undefined;
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
  readonly pairs?: readonly { subject: string; object: string }[] | undefined;
  readonly executionTimeMs: number;
}

// ---------------------------------------------------------------------------
// Reasoner Contract
// ---------------------------------------------------------------------------

/** Contract implemented by OWL 2 / SHACL reasoner backends. */
export interface IOWLReasoner {
  readonly status: ReasonerStatus;
  readonly axiomCount: number;

  init(): Promise<void>;
  loadOntology(axioms: readonly OWL2Axiom[]): void;
  applyDelta(delta: OWL2AxiomDelta): void;
  classify(): void;
  dispose(): void;

  isSubClassOf(subClassIri: string, superClassIri: string): SubsumptionResult;
  checkConsistency(): ConsistencyResult;
  quickXplain(backgroundAxioms?: readonly OWL2Axiom[]): readonly OWL2Axiom[];
  allMus(maxCores?: number): readonly (readonly OWL2Axiom[])[];
  getTaxonomy(): TaxonomyNode[];
  classifyIndividual(individualIri: string): ClassificationResult;
  getTransitiveClosure(propertyIri: string, fromIri: string): PropertyChainResult;
  evaluatePropertyPath(
    propertyIri: string,
    pathOp: PropertyPathOp,
    fromIri: string,
    stepPropertyIri2?: string,
  ): readonly string[];
  query(q: DLQuery): DLQueryResult;
  queryBgp?(query: BgpQuery): BgpQueryResult;
  explain(subClassIri: string, superClassIri: string): readonly OWL2Axiom[];
  validateShacl?(shapes: readonly SHACLNodeShape[]): readonly SHACLViolation[];
}

// ---------------------------------------------------------------------------
// Events & IRI Namespace Helpers
// ---------------------------------------------------------------------------

/** Discriminated union of lifecycle events emitted by `OntologyBuilder`. */
export type OntologyEvent =
  | { type: "status-changed"; status: ReasonerStatus }
  | { type: "classified"; axiomCount: number; timeMs: number }
  | { type: "consistency-result"; result: ConsistencyResult }
  | { type: "delta-applied"; delta: OWL2AxiomDelta }
  | { type: "error"; error: Error };

/** Callback signature for `OntologyBuilder` event subscribers. */
export type OntologyEventListener = (event: OntologyEvent) => void;

/** Default IRI namespace prefixes by source engineering language. */
export const OWL2_IRI_PREFIX = {
  modelica: "mo:",
  sysml2: "sysml:",
  step: "step:",
  owl2: "",
} as const;

/** Constructs a prefixed IRI for `name` in the given `sourceLang` namespace. */
export function makeIri(sourceLang: string, name: string): string {
  const prefix = (OWL2_IRI_PREFIX as Record<string, string>)[sourceLang] ?? `${sourceLang}:`;
  return `${prefix}${name}`;
}

// ---------------------------------------------------------------------------
// Axiom Type Constants matching AssemblyScript ontology.ts
// ---------------------------------------------------------------------------

/** Axiom type constant for `ClassDeclaration`. */
export const AXIOM_CLASS_DECL = 1;
/** Axiom type constant for `SubClassOf`. */
export const AXIOM_SUBCLASS_OF = 2;
/** Axiom type constant for `EquivalentClasses`. */
export const AXIOM_EQUIV_CLASS = 3;
/** Axiom type constant for `DisjointClasses`. */
export const AXIOM_DISJOINT_CLASSES = 4;
/** Axiom type constant for `ObjectPropertyDeclaration`. */
export const AXIOM_OBJ_PROP_DECL = 5;
/** Axiom type constant for `DataPropertyDeclaration`. */
export const AXIOM_DATA_PROP_DECL = 6;
/** Axiom type constant for `ObjectPropertyAssertion`. */
export const AXIOM_OBJ_PROP_ASSERT = 7;
/** Axiom type constant for `DataPropertyAssertion`. */
export const AXIOM_DATA_PROP_ASSERT = 8;
/** Axiom type constant for `TransitiveObjectProperty`. */
export const AXIOM_TRANSITIVE_PROP = 9;
/** Axiom type constant for `IndividualDeclaration`. */
export const AXIOM_INDIVIDUAL_DECL = 10;
/** Axiom type constant for `ClassAssertion`. */
export const AXIOM_CLASS_ASSERT = 11;
/** Axiom type constant for `ObjectSomeValuesFrom`. */
export const AXIOM_OBJECT_SOME_VALUES_FROM = 12;
/** Axiom type constant for `SubPropertyChainOf`. */
export const AXIOM_SUB_PROPERTY_CHAIN = 13;
/** Axiom type constant for `FunctionalObjectProperty`. */
export const AXIOM_FUNCTIONAL_OBJ_PROP = 14;
/** Axiom type constant for `FunctionalDataProperty`. */
export const AXIOM_FUNCTIONAL_DATA_PROP = 15;
/** Axiom type constant for `SameIndividual`. */
export const AXIOM_SAME_INDIVIDUAL = 16;
/** Axiom type constant for `UniversalRestriction`. */
export const AXIOM_UNIVERSAL_RESTRICTION = 17;
/** Axiom type constant for `DisjunctiveClass`. */
export const AXIOM_DISJUNCTIVE_CLASS = 18;
/** Axiom type constant for `QualifiedCardinality`. */
export const AXIOM_QUALIFIED_CARDINALITY = 19;
/** Axiom type constant for `SymmetricObjectProperty`. */
export const AXIOM_SYMMETRIC_PROP = 20;
/** Axiom type constant for `InverseObjectProperty`. */
export const AXIOM_INVERSE_PROP = 21;
/** Axiom type constant for `AsymmetricObjectProperty`. */
export const AXIOM_ASYMMETRIC_PROP = 22;
/** Axiom type constant for `IrreflexiveObjectProperty`. */
export const AXIOM_IRREFLEXIVE_PROP = 23;
/** Axiom type constant for `DisjointObjectProperties`. */
export const AXIOM_DISJOINT_PROPS = 24;
/** Axiom type constant for `NominalClass` / `ObjectOneOf`. */
export const AXIOM_NOMINAL_CLASS = 25;
/** Axiom type constant for `SelfRestriction`. */
export const AXIOM_SELF_RESTRICTION = 26;
/** Axiom type constant for an in-WASM SHACL-AF derivation rule. */
export const AXIOM_SHACL_RULE = 27;

// ---------------------------------------------------------------------------
// WASM Instance Interface
// ---------------------------------------------------------------------------

/**
 * Low-level WebAssembly exports interface for the native ontology store and reasoner module.
 */
export interface WasmOntologyInstance {
  ontology_addAxiom?(
    axiomType: number,
    sourceLangId: number,
    subjectHash: number,
    predicateHash: number,
    objectHash: number,
    dataValLo: number,
    dataValHi: number,
  ): number;
  ontology_addAxiom64?(
    axiomType: number,
    sourceLangId: number,
    sLo: number,
    sHi: number,
    pLo: number,
    pHi: number,
    oLo: number,
    oHi: number,
    flags: number,
    extra: number,
  ): number;
  ontology_getOrCreateEntity?(hashLo: number, hashHi: number): number;
  ontology_getEntityHashLo?(entityId: number): number;
  ontology_getEntityHashHi?(entityId: number): number;
  ontology_getEntityCount?(): number;
  ontology_getAxiomTablePtr?(): number;
  ontology_getQueryBuffer?(): number;
  ontology_isSubClassOf?(subClassHash: number, superClassHash: number): number;
  ontology_explainSubsumption?(subClassHash: number, superClassHash: number): number;
  ontology_checkConsistency?(): number;
  ontology_classifyIndividual?(individualHash: number): number;
  ontology_areDisjoint?(class1Hash: number, class2Hash: number): number;
  ontology_isInstanceOf?(individualHash: number, classHash: number): number;
  ontology_getTransitiveClosure?(propertyHash: number, sourceHash: number): number;
  ontology_getTransitiveClosureWithPath?(propertyHash: number, sourceHash: number): number;
  ontology_getTaxonomy?(): number;
  ontology_queryTriples?(subjectPattern: number, predicatePattern: number, objectPattern: number): number;
  ontology_getAxiomCount?(): number;
  ontology_clear?(): void;
  ontology_computeIntervalIndex?(): void;
  ontology_evaluatePropertyPath?(
    propertyHash: number,
    pathOp: number,
    stepPropertyHash2: number,
    sourceHash: number,
  ): number;
  ontology_saturateELRules?(): number;
  ontology_retractAxiom?(axiomId: number): number;
  ontology_applyDelta?(addCount: number, addPtr: number, retractCount: number, retractPtr: number): number;
  ontology_evalBgpLeapfrog?(patternCount: number, patternsPtr: number, varCount: number, maxResults: number): number;
  ontology_saturateFunctional?(): number;
  ontology_quickXplain?(): number;
  ontology_allMus?(maxCores?: number): number;
  ontology_runHybridFixpoint?(): number;
  ontology_validateAdvancedConstraints?(): number;
  ontology_runTableauSubsumption?(subClass: number, supClass: number): number;
  projection_projectFileStubs?(fileId: number, sourceLangId: number): number;
  projection_projectAllStubs?(sourceLangId: number): number;
  ontology_internString?(strPtr: number, strLen: number, hashLo: number, hashHi: number): number;
  ontology_extractString?(id: number, outPtr: number): number;
  ontology_extractStringBounded?(id: number, outPtr: number, maxLen: number): number;
  ontology_getStringLen?(id: number): number;
  ontology_getStringCompressionRatio?(): number;
  ontology_getStringCount?(): number;
  ontology_getRawStringBytes?(): number;
  ontology_getCompressedStringBytes?(): number;
  ontology_queryTriplesBitmap?(subjectPattern: number, predicatePattern: number, objectPattern: number): number;
  ontology_getRoaringCardinality?(indexType: number, keyHash: number): number;
  alloc?(size: number): number;
  free?(ptr: number): void;
  memory?: WebAssembly.Memory | undefined;
}

// ---------------------------------------------------------------------------
// Workspace Projection Interfaces
// ---------------------------------------------------------------------------

export interface OntologyProjectedSymbolEntry {
  name?: string | undefined;
  kind?: string | undefined;
  ruleName?: string | undefined;
  language?: string | undefined;
  resourceId?: string | undefined;
  parentId?: number | null | undefined;
  inherits?: string[] | undefined;
  metadata?: { isPredefined?: boolean | undefined; [key: string]: unknown } | undefined;
  source?: string | undefined;
  from?: string | undefined;
  target?: string | undefined;
  to?: string | undefined;
  type?: string | undefined;
  typeName?: string | undefined;
  lhs?: string | undefined;
  left?: string | undefined;
  rhs?: string | undefined;
  right?: string | undefined;
}

export interface OntologyWorkspaceSymbolIndex {
  symbols?: ReadonlyMap<number, OntologyProjectedSymbolEntry> | undefined;
  childrenOf?: ReadonlyMap<number | null, readonly number[]> | undefined;
}

export interface OntologyWorkspaceLike {
  getIndex?: (() => OntologyWorkspaceSymbolIndex | null | undefined) | undefined;
  detectLanguage?: ((resourceId: string) => string | undefined) | undefined;
}

// ---------------------------------------------------------------------------
// STEP CAD 3D Bounding Box & RCC-8 Spatial Types
// ---------------------------------------------------------------------------

/** 3D axis-aligned bounding box (AABB) for a STEP CAD solid or assembly component. */
export interface CadBoundingBox {
  /** Unique CAD entity identifier. */
  readonly id: string;
  /** Optional human-readable part or solid name. */
  readonly name?: string | undefined;
  /** Minimum corner coordinates `[xMin, yMin, zMin]`. */
  readonly min: readonly [number, number, number];
  /** Maximum corner coordinates `[xMax, yMax, zMax]`. */
  readonly max: readonly [number, number, number];
}

/** Region Connection Calculus (RCC-8) topological relation between two 3D bounding envelopes. */
export type Rcc8Relation =
  "rcc:DC" | "rcc:EC" | "rcc:PO" | "rcc:EQ" | "rcc:TPP" | "rcc:NTPP" | "rcc:TPPi" | "rcc:NTPPi";
