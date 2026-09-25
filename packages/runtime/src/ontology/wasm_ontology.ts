// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WASM-Backed OWL2 / SHACL Reasoning Framework and Ontology Store
 *
 * Maintains a unified, incrementally-updated OWL2 ontology derived from
 * all source language workspaces (Modelica, SysML2, STEP, OWL2) via the
 * TGG polyglot correspondence index and WebAssembly zero-GC runtime.
 */

export interface ProvenanceToken {
  readonly tokenId: number;
  readonly sourceLang?: string;
  readonly sourceUri?: string;
  readonly startByte?: number;
  readonly endByte?: number;
  readonly symbolId?: string | number;
}

export interface OntologyProjectionResult {
  props: Record<string, unknown>;
  provenanceTokens?: readonly ProvenanceToken[];
  blameLocations?: readonly {
    uri?: string;
    startByte?: number;
    endByte?: number;
    sourceLang?: string;
    symbolId?: string | number;
  }[];
}
import type { SymbolEntry, SymbolId, SymbolIndex } from "../runtime.js";

// ---------------------------------------------------------------------------
// OWL2 Axiom Types
// ---------------------------------------------------------------------------

export interface OWL2ClassDeclaration {
  readonly type: "ClassDeclaration";
  readonly iri: string;
  readonly sourceLang?: string;
  readonly sourceQualifiedName?: string;
}

export interface OWL2SubClassOf {
  readonly type: "SubClassOf";
  readonly subClassIri: string;
  readonly superClassIri: string;
  readonly sourceLang?: string;
}

export interface OWL2EquivalentClasses {
  readonly type: "EquivalentClasses";
  readonly classIris: readonly string[];
  readonly sourceLang?: string;
}

export interface OWL2DisjointClasses {
  readonly type: "DisjointClasses";
  readonly classIris: readonly string[];
  readonly sourceLang?: string;
}

export interface OWL2ObjectPropertyDeclaration {
  readonly type: "ObjectPropertyDeclaration";
  readonly iri: string;
  readonly sourceLang?: string;
  readonly characteristics?: readonly ("Transitive" | "Functional" | "Symmetric" | "InverseFunctional")[];
}

export interface OWL2DataPropertyDeclaration {
  readonly type: "DataPropertyDeclaration";
  readonly iri: string;
  readonly sourceLang?: string;
}

export interface OWL2ObjectPropertyAssertion {
  readonly type: "ObjectPropertyAssertion";
  readonly propertyIri: string;
  readonly subjectIri: string;
  readonly objectIri: string;
  readonly sourceLang?: string;
}

export interface OWL2DataPropertyAssertion {
  readonly type: "DataPropertyAssertion";
  readonly propertyIri: string;
  readonly subjectIri: string;
  readonly value: string;
  readonly datatype?: string;
  readonly sourceLang?: string;
  readonly minVal?: number;
  readonly maxVal?: number;
  readonly op?: "<" | "<=" | ">" | ">=" | "=" | "!=";
}

export interface OWL2TransitiveObjectProperty {
  readonly type: "TransitiveObjectProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string;
}

export interface OWL2IndividualDeclaration {
  readonly type: "IndividualDeclaration";
  readonly iri: string;
  readonly sourceLang?: string;
}

export interface OWL2ClassAssertion {
  readonly type: "ClassAssertion";
  readonly classIri: string;
  readonly individualIri: string;
  readonly sourceLang?: string;
}

export interface OWL2ObjectSomeValuesFrom {
  readonly type: "ObjectSomeValuesFrom";
  readonly propertyIri: string;
  readonly fillerClassIri: string;
  readonly sourceLang?: string;
}

export interface OWL2DataSomeValuesFrom {
  readonly type: "DataSomeValuesFrom";
  readonly propertyIri: string;
  readonly dataRange: string;
  readonly sourceLang?: string;
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

export interface OWL2UniversalRestriction {
  readonly type: "UniversalRestriction";
  readonly propertyIri: string;
  readonly targetClassIri: string;
  readonly classIri?: string;
  readonly sourceLang?: string;
}

export interface OWL2DisjunctiveClass {
  readonly type: "DisjunctiveClass";
  readonly classIris: readonly string[];
  readonly superClassIri?: string;
  readonly sourceLang?: string;
}

export interface OWL2QualifiedCardinality {
  readonly type: "QualifiedCardinality";
  readonly classIri: string;
  readonly propertyIri: string;
  readonly fillerClassIri?: string;
  readonly cardinalityType: "min" | "max" | "exact";
  readonly count: number;
  readonly sourceLang?: string;
}

export interface OWL2SymmetricObjectProperty {
  readonly type: "SymmetricObjectProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string;
}

export interface OWL2InverseObjectProperty {
  readonly type: "InverseObjectProperty";
  readonly propertyIri: string;
  readonly inversePropertyIri: string;
  readonly sourceLang?: string;
}

export interface OWL2AsymmetricObjectProperty {
  readonly type: "AsymmetricObjectProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string;
}

export interface OWL2IrreflexiveObjectProperty {
  readonly type: "IrreflexiveObjectProperty";
  readonly propertyIri: string;
  readonly sourceLang?: string;
}

export interface OWL2DisjointObjectProperties {
  readonly type: "DisjointObjectProperties";
  readonly propertyIris: readonly string[];
  readonly sourceLang?: string;
}

export interface OWL2NominalClass {
  readonly type: "NominalClass" | "ObjectOneOf";
  readonly classIri: string;
  readonly individualIris: readonly string[];
  readonly sourceLang?: string;
}
export type OWL2ObjectOneOf = OWL2NominalClass;

export interface OWL2DifferentIndividuals {
  readonly type: "DifferentIndividuals";
  readonly individualIris: readonly string[];
  readonly sourceLang?: string;
}

export interface OWL2SelfRestriction {
  readonly type: "SelfRestriction";
  readonly classIri: string;
  readonly propertyIri: string;
  readonly sourceLang?: string;
}

export interface OWL2SubPropertyChainOf {
  readonly type: "SubPropertyChainOf";
  readonly subPropertyChain: readonly string[];
  readonly superPropertyIri: string;
  readonly sourceLang?: string;
}

export interface OWL2LinearTerm {
  readonly propertyIri: string;
  readonly coefficient: number;
}

export interface OWL2LinearConstraint {
  readonly type: "LinearConstraint";
  readonly subjectIri: string;
  readonly terms: readonly OWL2LinearTerm[];
  readonly op: "<" | "<=" | ">" | ">=" | "=";
  readonly bound: number;
  readonly sourceLang?: string;
}

// ---------------------------------------------------------------------------
// SWRL Rules and Atoms
// ---------------------------------------------------------------------------

export interface SWRLClassAtom {
  readonly type: "ClassAtom";
  readonly classIri: string;
  readonly argument: string;
}

export interface SWRLIndividualPropertyAtom {
  readonly type: "IndividualPropertyAtom";
  readonly propertyIri: string;
  readonly argument1: string;
  readonly argument2: string;
}

export interface SWRLDataPropertyAtom {
  readonly type: "DataPropertyAtom";
  readonly propertyIri: string;
  readonly argument1: string;
  readonly argument2: string | number;
}

export interface SWRLBuiltInAtom {
  readonly type: "BuiltInAtom";
  readonly builtInIri: string;
  readonly arguments: readonly (string | number)[];
}

export interface SWRLSameIndividualAtom {
  readonly type: "SameIndividualAtom";
  readonly argument1: string;
  readonly argument2: string;
}

export interface SWRLDifferentIndividualsAtom {
  readonly type: "DifferentIndividualsAtom";
  readonly argument1: string;
  readonly argument2: string;
}

export type SWRLAtom =
  | SWRLClassAtom
  | SWRLIndividualPropertyAtom
  | SWRLDataPropertyAtom
  | SWRLBuiltInAtom
  | SWRLSameIndividualAtom
  | SWRLDifferentIndividualsAtom;

export interface OWL2SwrlRule {
  readonly type: "SwrlRule";
  readonly ruleIri?: string;
  readonly body: readonly SWRLAtom[];
  readonly head: readonly SWRLAtom[];
  readonly sourceLang?: string;
}

// ---------------------------------------------------------------------------
// SHACL Shapes and Rules (SHACL-AF)
// ---------------------------------------------------------------------------

export interface SHACLSparqlConstraint {
  readonly ask?: BgpQuery;
  readonly select?: BgpQuery;
  readonly expectEmpty?: boolean;
  readonly message?: string;
}

export interface SHACLPropertyShape {
  readonly path: string;
  readonly targetClass?: string;
  readonly minCount?: number;
  readonly maxCount?: number;
  readonly qualifiedValueShape?: string;
  readonly pattern?: string;
  readonly hasValue?: string;
  readonly in?: readonly string[];
  readonly class?: string;
  readonly or?: readonly SHACLPropertyShape[];
  readonly and?: readonly SHACLPropertyShape[];
  readonly not?: SHACLPropertyShape;
  readonly xone?: readonly SHACLPropertyShape[];
  readonly minInclusive?: number;
  readonly maxInclusive?: number;
  readonly minExclusive?: number;
  readonly maxExclusive?: number;
  readonly lessThan?: string;
  readonly lessThanOrEquals?: string;
  readonly sparql?: SHACLSparqlConstraint;
}

export interface SHACLTripleRule {
  readonly type?: "TripleRule";
  readonly targetClass: string;
  readonly subject?: string; // defaults to "?this" or "sh:this"
  readonly predicate: string;
  readonly object: string;
  readonly condition?: SHACLPropertyShape;
}

export interface SHACLSparqlRule {
  readonly type: "SparqlRule";
  readonly targetClass: string;
  readonly constructPatterns: readonly TriplePattern[];
  readonly wherePatterns: readonly TriplePattern[];
}

export interface SHACLLegacyRule {
  readonly targetClass: string;
  readonly propertyIri: string;
  readonly fillerClassIri?: string;
  readonly minCount?: number;
  readonly maxCount?: number;
  readonly derivedClassIri?: string;
  readonly derivedPropertyIri?: string;
  readonly derivedValueIri?: string;
}

export type SHACLRule = SHACLTripleRule | SHACLSparqlRule | SHACLLegacyRule;

export interface SHACLNodeShape {
  readonly targetClass: string;
  readonly propertyShapes: readonly SHACLPropertyShape[];
  readonly closed?: boolean;
  readonly rules?: readonly SHACLRule[];
}

export interface SHACLViolation {
  readonly focusNode: string;
  readonly resultPath: string;
  readonly message: string;
  readonly constraintComponent: string;
  readonly severity?: "Violation" | "Warning" | "Info";
  readonly blameLocations?: readonly {
    uri?: string;
    startByte?: number;
    endByte?: number;
    sourceLang?: string;
    symbolId?: string | number;
  }[];
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

export interface OWL2AxiomDelta {
  readonly retractions: readonly OWL2Axiom[];
  readonly assertions: readonly OWL2Axiom[];
}

export interface IOWL2OntologyStore {
  readonly size: number;
  readonly axioms: readonly OWL2Axiom[];
}

// ---------------------------------------------------------------------------
// Reasoner Status & Query Results
// ---------------------------------------------------------------------------

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

export type PropertyPathOp = "direct" | "plus" | "star" | "inverse" | "inverse-plus" | "sequence" | "alternation";

/** A simplified SPARQL-DL or Property Path query. */
export interface DLQuery {
  readonly type:
    | "instances"
    | "subclasses"
    | "superclasses"
    | "equivalents"
    | "disjoint"
    | "property-values"
    | "reachable"
    | "path";
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

export type OntologyEvent =
  | { type: "status-changed"; status: ReasonerStatus }
  | { type: "classified"; axiomCount: number; timeMs: number }
  | { type: "consistency-result"; result: ConsistencyResult }
  | { type: "delta-applied"; delta: OWL2AxiomDelta }
  | { type: "error"; error: Error };

export type OntologyEventListener = (event: OntologyEvent) => void;

export const OWL2_IRI_PREFIX = {
  modelica: "mo:",
  sysml2: "sysml:",
  step: "step:",
  owl2: "",
} as const;

export function makeIri(sourceLang: string, name: string): string {
  const prefix = (OWL2_IRI_PREFIX as Record<string, string>)[sourceLang] ?? `${sourceLang}:`;
  return `${prefix}${name}`;
}

// ---------------------------------------------------------------------------
// Axiom Type Constants matching AssemblyScript ontology.ts
// ---------------------------------------------------------------------------

export const AXIOM_CLASS_DECL = 1;
export const AXIOM_SUBCLASS_OF = 2;
export const AXIOM_EQUIV_CLASS = 3;
export const AXIOM_DISJOINT_CLASSES = 4;
export const AXIOM_OBJ_PROP_DECL = 5;
export const AXIOM_DATA_PROP_DECL = 6;
export const AXIOM_OBJ_PROP_ASSERT = 7;
export const AXIOM_DATA_PROP_ASSERT = 8;
export const AXIOM_TRANSITIVE_PROP = 9;
export const AXIOM_INDIVIDUAL_DECL = 10;
export const AXIOM_CLASS_ASSERT = 11;
export const AXIOM_OBJECT_SOME_VALUES_FROM = 12;
export const AXIOM_SUB_PROPERTY_CHAIN = 13;
export const AXIOM_FUNCTIONAL_OBJ_PROP = 14;
export const AXIOM_FUNCTIONAL_DATA_PROP = 15;
export const AXIOM_SAME_INDIVIDUAL = 16;
export const AXIOM_UNIVERSAL_RESTRICTION = 17;
export const AXIOM_DISJUNCTIVE_CLASS = 18;
export const AXIOM_QUALIFIED_CARDINALITY = 19;
export const AXIOM_SYMMETRIC_PROP = 20;
export const AXIOM_INVERSE_PROP = 21;
export const AXIOM_ASYMMETRIC_PROP = 22;
export const AXIOM_IRREFLEXIVE_PROP = 23;
export const AXIOM_DISJOINT_PROPS = 24;
export const AXIOM_NOMINAL_CLASS = 25;
export const AXIOM_SELF_RESTRICTION = 26;
export const AXIOM_SHACL_RULE = 27;

// ---------------------------------------------------------------------------
// Conversion from ProjectionResult
// ---------------------------------------------------------------------------

export function projectionToAxioms(result: OntologyProjectionResult): OWL2Axiom[] {
  const props = result.props;
  const axiomType = props.axiomType as string | undefined;

  if (axiomType) {
    return convertExplicitAxiom(props, axiomType);
  }

  if (Array.isArray(props.axioms)) {
    return props.axioms as OWL2Axiom[];
  }

  return [];
}

function convertExplicitAxiom(props: Record<string, unknown>, axiomType: string): OWL2Axiom[] {
  switch (axiomType) {
    case "ClassDeclaration":
      return [
        {
          type: "ClassDeclaration",
          iri: props.iri as string,
          sourceLang: props.sourceLang as string,
          sourceQualifiedName: props.sourceQualifiedName as string,
        } satisfies OWL2ClassDeclaration,
      ];

    case "SubClassOf":
      return [
        {
          type: "SubClassOf",
          subClassIri: props.subClassIri as string,
          superClassIri: props.superClassIri as string,
          sourceLang: props.sourceLang as string,
        } satisfies OWL2SubClassOf,
      ];

    case "DisjointClasses":
      return [
        {
          type: "DisjointClasses",
          classIris: props.classIris as string[],
          sourceLang: props.sourceLang as string,
        } satisfies OWL2DisjointClasses,
      ];

    case "ObjectPropertyDeclaration":
      return [
        {
          type: "ObjectPropertyDeclaration",
          iri: props.iri as string,
          sourceLang: props.sourceLang as string,
          characteristics: props.characteristics as OWL2ObjectPropertyDeclaration["characteristics"],
        } satisfies OWL2ObjectPropertyDeclaration,
      ];

    case "DataPropertyDeclaration":
      return [
        {
          type: "DataPropertyDeclaration",
          iri: props.iri as string,
          sourceLang: props.sourceLang as string,
        } satisfies OWL2DataPropertyDeclaration,
      ];

    case "ObjectPropertyAssertion":
      return [
        {
          type: "ObjectPropertyAssertion",
          propertyIri: props.propertyIri as string,
          subjectIri: props.subjectIri as string,
          objectIri: props.objectIri as string,
          sourceLang: props.sourceLang as string,
        } satisfies OWL2ObjectPropertyAssertion,
      ];

    case "DataPropertyAssertion":
      return [
        {
          type: "DataPropertyAssertion",
          propertyIri: props.propertyIri as string,
          subjectIri: props.subjectIri as string,
          value: props.value as string,
          datatype: props.datatype as string | undefined,
          sourceLang: props.sourceLang as string,
        } satisfies OWL2DataPropertyAssertion,
      ];

    case "TransitiveObjectProperty":
      return [
        {
          type: "TransitiveObjectProperty",
          propertyIri: props.propertyIri as string,
          sourceLang: props.sourceLang as string,
        } satisfies OWL2TransitiveObjectProperty,
      ];

    case "IndividualDeclaration":
      return [
        {
          type: "IndividualDeclaration",
          iri: props.iri as string,
          sourceLang: props.sourceLang as string,
        } satisfies OWL2IndividualDeclaration,
      ];

    case "ClassAssertion":
      return [
        {
          type: "ClassAssertion",
          classIri: props.classIri as string,
          individualIri: props.individualIri as string,
          sourceLang: props.sourceLang as string,
        } satisfies OWL2ClassAssertion,
      ];

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// SPARQL 1.1 Property Path Parser & DSL Query Helpers
// ---------------------------------------------------------------------------

export function parsePropertyPathExpression(expr: string): {
  iri: string;
  pathOp: PropertyPathOp;
  stepPropertyIri2?: string;
} {
  const trimmed = expr.trim();

  if (trimmed.includes("/")) {
    const parts = trimmed.split("/").map((s) => s.trim());
    return {
      iri: parts[0] || trimmed,
      pathOp: "sequence",
      stepPropertyIri2: parts[1] || "",
    };
  }

  if (trimmed.includes("|")) {
    const parts = trimmed.split("|").map((s) => s.trim());
    return {
      iri: parts[0] || trimmed,
      pathOp: "alternation",
      stepPropertyIri2: parts[1] || "",
    };
  }

  if (trimmed.startsWith("^") && trimmed.endsWith("+")) {
    return {
      iri: trimmed.slice(1, -1).trim(),
      pathOp: "inverse-plus",
    };
  }

  if (trimmed.startsWith("^")) {
    return {
      iri: trimmed.slice(1).trim(),
      pathOp: "inverse",
    };
  }

  if (trimmed.endsWith("+")) {
    return {
      iri: trimmed.slice(0, -1).trim(),
      pathOp: "plus",
    };
  }

  if (trimmed.endsWith("*")) {
    return {
      iri: trimmed.slice(0, -1).trim(),
      pathOp: "star",
    };
  }

  return {
    iri: trimmed,
    pathOp: "direct",
  };
}

export function parseDLQuery(queryString: string): DLQuery | null {
  const trimmed = queryString.trim();

  const match = trimmed.match(/^(\w[\w-]*)\(([^)]+)\)$/);
  if (!match) return null;

  const type = match[1] as DLQuery["type"];
  const argsStr = match[2];
  if (!type || !argsStr) return null;
  const args = argsStr.split(",").map((s) => s.trim());

  const validTypes = [
    "instances",
    "subclasses",
    "superclasses",
    "equivalents",
    "disjoint",
    "property-values",
    "reachable",
    "path",
  ];

  if (!validTypes.includes(type)) return null;

  if (type === "path") {
    const rawPath = args[0];
    if (!rawPath) return null;
    const fromIri = args[1];
    const parsed = parsePropertyPathExpression(rawPath);
    return {
      type: "path",
      iri: parsed.iri,
      pathOp: parsed.pathOp,
      stepPropertyIri2: parsed.stepPropertyIri2,
      fromIri,
    };
  }

  const iri = args[0];
  if (!iri) return null;
  const fromIri = args[1];

  return { type, iri, fromIri };
}

export function executeDLQuery(reasoner: IOWLReasoner, query: DLQuery): DLQueryResult {
  return reasoner.query(query);
}

export function executeQueryString(reasoner: IOWLReasoner, queryString: string): DLQueryResult | null {
  const query = parseDLQuery(queryString);
  if (!query) return null;
  return executeDLQuery(reasoner, query);
}

export function executeBgpQuery(reasoner: IOWLReasoner, query: BgpQuery): BgpQueryResult {
  if (reasoner.queryBgp) {
    return reasoner.queryBgp(query);
  }
  return {
    variables: [],
    bindings: [],
    executionTimeMs: 0,
  };
}

export function executeBatchQueries(reasoner: IOWLReasoner, queries: readonly DLQuery[]): DLQueryResult[] {
  return queries.map((q) => executeDLQuery(reasoner, q));
}

export function formatQueryResult(result: DLQueryResult): string {
  const lines: string[] = [];

  lines.push(
    `Query: ${result.query.type}(${result.query.iri}${result.query.fromIri ? `, ${result.query.fromIri}` : ""})`,
  );
  lines.push(`Results: ${result.bindings.length} binding(s) in ${result.executionTimeMs.toFixed(2)}ms`);

  if (result.bindings.length > 0) {
    lines.push("");
    for (const binding of result.bindings) {
      lines.push(`  - ${binding}`);
    }
  }

  if (result.pairs && result.pairs.length > 0) {
    lines.push("");
    lines.push("Pairs:");
    for (const pair of result.pairs) {
      lines.push(`  ${pair.subject} → ${pair.object}`);
    }
  }

  return lines.join("\n");
}

export function formatBgpQueryResult(result: BgpQueryResult): string {
  const lines: string[] = [];
  lines.push(`BGP Query Results: ${result.bindings.length} row(s) in ${result.executionTimeMs.toFixed(2)}ms`);
  lines.push(`Variables: ${result.variables.join(", ")}`);

  if (result.bindings.length > 0) {
    lines.push("");
    for (const row of result.bindings) {
      const entries = Object.entries(row)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      lines.push(`  { ${entries} }`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// WASM Instance Interface
// ---------------------------------------------------------------------------

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
  ontology_applyDelta?(
    retractionsPtr: number,
    retractionsCount: number,
    assertionsPtr: number,
    assertionsCount: number,
  ): number;
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
  ontology_getStringCompressionRatio?(): number;
  ontology_getStringCount?(): number;
  ontology_getRawStringBytes?(): number;
  ontology_getCompressedStringBytes?(): number;
  ontology_queryTriplesBitmap?(subjectPattern: number, predicatePattern: number, objectPattern: number): number;
  ontology_getRoaringCardinality?(indexType: number, keyHash: number): number;
  alloc?(size: number): number;
  free?(ptr: number): void;
  memory?: WebAssembly.Memory;
}

/**
 * 64-bit FNV-1a IRI hashing to eliminate birthday paradox collisions in large ontologies.
 */
export function hashIri64(s: string): { lo: number; hi: number; hash64: bigint } {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ BigInt(s.charCodeAt(i))) * prime;
    h = h & 0xffffffffffffffffn;
  }
  const lo = Number(h & 0xffffffffn) >>> 0;
  const hi = Number((h >> 32n) & 0xffffffffn) >>> 0;
  return { lo, hi, hash64: h };
}

/**
 * Zero-copy flyweight view over an in-WASM axiom record in linear memory.
 */
export class AxiomRecordView {
  constructor(
    private _buffer: Uint32Array,
    private _wordOffset: number,
  ) {}

  get axiomType(): number {
    return this._buffer[this._wordOffset] & 0xffff;
  }
  get sourceLangId(): number {
    return (this._buffer[this._wordOffset] >> 16) & 0xffff;
  }
  get subjectId(): number {
    return this._buffer[this._wordOffset + 1] ?? 0;
  }
  get predicateId(): number {
    return this._buffer[this._wordOffset + 2] ?? 0;
  }
  get objectId(): number {
    return this._buffer[this._wordOffset + 3] ?? 0;
  }
  get flags(): number {
    return this._buffer[this._wordOffset + 4] ?? 0;
  }
  get extra(): number {
    return this._buffer[this._wordOffset + 5] ?? 0;
  }
}

// ---------------------------------------------------------------------------
// WASM-Backed Reasoner Implementation
// ---------------------------------------------------------------------------

interface ClassNode {
  superClasses: Set<string>;
  subClasses: Set<string>;
  equivalents: Set<string>;
  allSuperClasses: Set<string> | null;
  allSubClasses: Set<string> | null;
}

interface PropertyEdge {
  subjectIri: string;
  objectIri: string;
}

export class WasmOntologyReasoner implements IOWLReasoner {
  private _status: ReasonerStatus = "idle";
  private _axioms: OWL2Axiom[] = [];

  private classes = new Map<string, ClassNode>();
  private disjointPairs = new Set<string>();
  private objectProperties = new Set<string>();
  private dataProperties = new Set<string>();
  private transitiveProperties = new Set<string>();
  private functionalObjectProperties = new Set<string>();
  private sameIndividualGroups = new Map<string, Set<string>>();

  private individualTypes = new Map<string, Set<string>>();
  private objectPropertyAssertions = new Map<string, PropertyEdge[]>();
  private dataPropertyAssertions = new Map<string, { subjectIri: string; value: string }[]>();
  private functionalDataProperties = new Set<string>();
  private asymmetricProperties = new Set<string>();
  private irreflexiveProperties = new Set<string>();
  private disjointPropertyPairs = new Set<string>();
  private rawDataPropertyAssertions: OWL2DataPropertyAssertion[] = [];
  private subPropertyChains: OWL2SubPropertyChainOf[] = [];
  private qualifiedCardinalities: OWL2QualifiedCardinality[] = [];
  private linearConstraints: OWL2LinearConstraint[] = [];
  private objectOneOfMap = new Map<string, Set<string>>();
  private differentIndividualPairs = new Set<string>();
  private swrlRules: OWL2SwrlRule[] = [];

  private _classified = false;
  private _wasmInstance: WasmOntologyInstance | null = null;

  constructor(wasmInstance?: WasmOntologyInstance | null) {
    this._wasmInstance = wasmInstance ?? null;
  }

  public setWasmInstance(wasmInstance: WasmOntologyInstance): void {
    this._wasmInstance = wasmInstance;
  }

  get status(): ReasonerStatus {
    return this._status;
  }

  get axiomCount(): number {
    if (this._wasmInstance?.ontology_getAxiomCount) {
      return this._wasmInstance.ontology_getAxiomCount();
    }
    return this._axioms.length;
  }

  async init(): Promise<void> {
    this._status = "ready";
  }

  loadOntology(axioms: readonly OWL2Axiom[]): void {
    this._status = "loading";
    this.clear();
    this._axioms = [...axioms];

    for (const axiom of axioms) {
      this.indexAxiom(axiom);
    }

    this._classified = false;
    this._status = "ready";
  }

  applyDelta(delta: OWL2AxiomDelta): void {
    for (const axiom of delta.retractions) {
      this.removeAxiom(axiom);
    }

    for (const axiom of delta.assertions) {
      this._axioms.push(axiom);
      this.indexAxiom(axiom);
    }

    this._classified = false;
  }

  classify(): void {
    this._status = "classifying";

    for (const node of this.classes.values()) {
      node.allSuperClasses = null;
      node.allSubClasses = null;
    }

    for (const iri of this.classes.keys()) {
      this.computeAllSuperClasses(iri);
    }

    for (const [iri, node] of this.classes) {
      if (!node.allSuperClasses) continue;
      for (const superIri of node.allSuperClasses) {
        const superNode = this.ensureClass(superIri);
        if (!superNode.allSubClasses) superNode.allSubClasses = new Set();
        superNode.allSubClasses.add(iri);
      }
    }

    // Functional property unification
    for (const propIri of this.functionalObjectProperties) {
      const edges = this.objectPropertyAssertions.get(propIri) ?? [];
      const bySubject = new Map<string, string[]>();
      for (const e of edges) {
        const list = bySubject.get(e.subjectIri) ?? [];
        list.push(e.objectIri);
        bySubject.set(e.subjectIri, list);
      }
      for (const [, objs] of bySubject) {
        if (objs.length > 1) {
          for (let i = 0; i < objs.length; i++) {
            for (let j = i + 1; j < objs.length; j++) {
              const o1 = objs[i]!;
              const o2 = objs[j]!;
              this.unifyIndividuals(o1, o2);
            }
          }
        }
      }
    }

    // Restrictions propagation
    for (const axiom of this._axioms) {
      if (axiom.type === "SymmetricObjectProperty") {
        const edges = this.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
        const toAdd: PropertyEdge[] = [];
        for (const e of edges) {
          if (!edges.some((ex) => ex.subjectIri === e.objectIri && ex.objectIri === e.subjectIri)) {
            toAdd.push({ subjectIri: e.objectIri, objectIri: e.subjectIri });
          }
        }
        for (const add of toAdd) edges.push(add);
        this.objectPropertyAssertions.set(axiom.propertyIri, edges);
      } else if (axiom.type === "InverseObjectProperty") {
        const edgesR = this.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
        const edgesS = this.objectPropertyAssertions.get(axiom.inversePropertyIri) ?? [];
        for (const e of edgesR) {
          if (!edgesS.some((ex) => ex.subjectIri === e.objectIri && ex.objectIri === e.subjectIri)) {
            edgesS.push({ subjectIri: e.objectIri, objectIri: e.subjectIri });
          }
        }
        for (const e of edgesS) {
          if (!edgesR.some((ex) => ex.subjectIri === e.objectIri && ex.objectIri === e.subjectIri)) {
            edgesR.push({ subjectIri: e.objectIri, objectIri: e.subjectIri });
          }
        }
        this.objectPropertyAssertions.set(axiom.propertyIri, edgesR);
        this.objectPropertyAssertions.set(axiom.inversePropertyIri, edgesS);
      } else if (axiom.type === "UniversalRestriction") {
        const edges = this.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
        for (const e of edges) {
          if (!axiom.classIri || (this.individualTypes.get(e.subjectIri)?.has(axiom.classIri) ?? false)) {
            const types = this.individualTypes.get(e.objectIri) ?? new Set();
            types.add(axiom.targetClassIri);
            this.individualTypes.set(e.objectIri, types);
          }
        }
      } else if (axiom.type === "SelfRestriction") {
        for (const [indIri, types] of this.individualTypes) {
          if (types.has(axiom.classIri)) {
            const edges = this.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
            if (!edges.some((e) => e.subjectIri === indIri && e.objectIri === indIri)) {
              edges.push({ subjectIri: indIri, objectIri: indIri });
              this.objectPropertyAssertions.set(axiom.propertyIri, edges);
            }
          }
        }
      }
    }

    // Property chains saturation: R1 o R2 o ... o Rn SubPropertyOf S
    if (this.subPropertyChains.length > 0) {
      let chainChanged = true;
      let chainPasses = 0;
      while (chainChanged && chainPasses < 50) {
        chainChanged = false;
        chainPasses++;

        for (const chainAxiom of this.subPropertyChains) {
          const chain = chainAxiom.subPropertyChain;
          if (chain.length < 2) continue;

          let currPairs: { subjectIri: string; objectIri: string }[] = (
            this.objectPropertyAssertions.get(chain[0]!) ?? []
          ).map((e) => ({ ...e }));

          for (let step = 1; step < chain.length; step++) {
            const nextEdges = this.objectPropertyAssertions.get(chain[step]!) ?? [];
            const nextPairs: { subjectIri: string; objectIri: string }[] = [];

            for (const p of currPairs) {
              for (const e of nextEdges) {
                if (p.objectIri === e.subjectIri) {
                  nextPairs.push({ subjectIri: p.subjectIri, objectIri: e.objectIri });
                }
              }
            }
            currPairs = nextPairs;
            if (currPairs.length === 0) break;
          }

          const targetEdges = this.objectPropertyAssertions.get(chainAxiom.superPropertyIri) ?? [];
          for (const pair of currPairs) {
            if (!targetEdges.some((te) => te.subjectIri === pair.subjectIri && te.objectIri === pair.objectIri)) {
              targetEdges.push({ subjectIri: pair.subjectIri, objectIri: pair.objectIri });
              chainChanged = true;
            }
          }
          this.objectPropertyAssertions.set(chainAxiom.superPropertyIri, targetEdges);
        }
      }
    }

    // Propagate individual types
    for (const [, types] of this.individualTypes) {
      const inferredTypes = new Set(types);
      for (const typeIri of types) {
        const node = this.classes.get(typeIri);
        if (node?.allSuperClasses) {
          for (const superIri of node.allSuperClasses) {
            inferredTypes.add(superIri);
          }
        }
      }
      for (const t of inferredTypes) types.add(t);
    }

    // ObjectOneOf / Nominal reasoning
    if (this.objectOneOfMap.size > 0) {
      let nomChanged = true;
      let nomPasses = 0;
      while (nomChanged && nomPasses < 10) {
        nomChanged = false;
        nomPasses++;

        for (const [classIri, nominals] of this.objectOneOfMap) {
          const nominalArr = Array.from(nominals);
          // 1. Singleton nominal: C = {a} => any instance x of C is identical to a
          if (nominalArr.length === 1) {
            const singletonNominal = nominalArr[0]!;
            for (const [ind, types] of this.individualTypes) {
              if (types.has(classIri) && ind !== singletonNominal) {
                const group = this.sameIndividualGroups.get(ind);
                if (!group || !group.has(singletonNominal)) {
                  this.unifyIndividuals(ind, singletonNominal);
                  nomChanged = true;
                }
              }
            }
          }

          // 2. Unit resolution / Negative elimination:
          // If ind has type C, and ind is DifferentFrom k-1 nominals, ind must be the remaining one!
          if (nominalArr.length > 1) {
            for (const [ind, types] of this.individualTypes) {
              if (!types.has(classIri)) continue;
              if (nominals.has(ind)) continue;

              const differentNominals: string[] = [];
              for (const nom of nominalArr) {
                if (this.isDifferent(ind, nom)) {
                  differentNominals.push(nom);
                }
              }

              if (differentNominals.length === nominalArr.length - 1) {
                const remaining = nominalArr.find((n) => !differentNominals.includes(n))!;
                const group = this.sameIndividualGroups.get(ind);
                if (!group || !group.has(remaining)) {
                  this.unifyIndividuals(ind, remaining);
                  nomChanged = true;
                }
              }
            }
          }
        }
      }
    }

    // SWRL rule saturation
    if (this.swrlRules.length > 0) {
      let swrlChanged = true;
      let swrlPasses = 0;
      while (swrlChanged && swrlPasses < 25) {
        swrlChanged = false;
        swrlPasses++;

        for (const rule of this.swrlRules) {
          const bindings = this.evaluateSwrlBody(rule.body);
          for (const env of bindings) {
            for (const headAtom of rule.head) {
              if (this.applySwrlHeadAtom(headAtom, env)) {
                swrlChanged = true;
              }
            }
          }
        }
      }
    }

    // Final propagation of individual types
    for (const [, types] of this.individualTypes) {
      const inferredTypes = new Set(types);
      for (const typeIri of types) {
        const node = this.classes.get(typeIri);
        if (node?.allSuperClasses) {
          for (const superIri of node.allSuperClasses) {
            inferredTypes.add(superIri);
          }
        }
      }
      for (const t of inferredTypes) types.add(t);
    }

    const consistency = this.checkConsistencyInternal();
    this._status = consistency.isConsistent ? "ready" : "inconsistent";
    this._classified = true;
  }

  private unifyIndividuals(ind1: string, ind2: string): void {
    if (ind1 === ind2) return;
    const group = this.sameIndividualGroups.get(ind1) ?? new Set([ind1]);
    group.add(ind2);
    this.sameIndividualGroups.set(ind1, group);
    this.sameIndividualGroups.set(ind2, group);

    const types1 = this.individualTypes.get(ind1) ?? new Set();
    const types2 = this.individualTypes.get(ind2) ?? new Set();
    for (const t of types1) types2.add(t);
    for (const t of types2) types1.add(t);
    this.individualTypes.set(ind1, types1);
    this.individualTypes.set(ind2, types2);
  }

  private isDifferent(ind1: string, ind2: string): boolean {
    if (ind1 === ind2) return false;
    let rep1 = ind1;
    const g1 = this.sameIndividualGroups.get(ind1);
    if (g1 && g1.size > 0) rep1 = Array.from(g1).sort()[0]!;

    let rep2 = ind2;
    const g2 = this.sameIndividualGroups.get(ind2);
    if (g2 && g2.size > 0) rep2 = Array.from(g2).sort()[0]!;

    if (rep1 === rep2) return false;
    const key = rep1 < rep2 ? `${rep1}|${rep2}` : `${rep2}|${rep1}`;
    if (this.differentIndividualPairs.has(key)) return true;

    const keyDirect = ind1 < ind2 ? `${ind1}|${ind2}` : `${ind2}|${ind1}`;
    return this.differentIndividualPairs.has(keyDirect);
  }

  private evaluateSwrlBody(body: readonly SWRLAtom[]): Record<string, string>[] {
    let currentEnvs: Record<string, string>[] = [{}];

    for (const atom of body) {
      const nextEnvs: Record<string, string>[] = [];

      for (const env of currentEnvs) {
        switch (atom.type) {
          case "ClassAtom": {
            const arg = atom.argument;
            if (arg.startsWith("?")) {
              if (env[arg] !== undefined) {
                const ind = env[arg]!;
                if (this.individualTypes.get(ind)?.has(atom.classIri)) {
                  nextEnvs.push({ ...env });
                }
              } else {
                for (const [ind, types] of this.individualTypes) {
                  if (types.has(atom.classIri)) {
                    nextEnvs.push({ ...env, [arg]: ind });
                  }
                }
              }
            } else {
              if (this.individualTypes.get(arg)?.has(atom.classIri)) {
                nextEnvs.push({ ...env });
              }
            }
            break;
          }

          case "IndividualPropertyAtom": {
            const edges = this.objectPropertyAssertions.get(atom.propertyIri) ?? [];
            const sArg = atom.argument1;
            const oArg = atom.argument2;

            for (const edge of edges) {
              const newEnv = { ...env };
              let match = true;

              if (sArg.startsWith("?")) {
                if (env[sArg] !== undefined) {
                  if (env[sArg] !== edge.subjectIri) match = false;
                } else {
                  newEnv[sArg] = edge.subjectIri;
                }
              } else if (sArg !== edge.subjectIri) {
                match = false;
              }

              if (!match) continue;

              if (oArg.startsWith("?")) {
                if (env[oArg] !== undefined) {
                  if (env[oArg] !== edge.objectIri) match = false;
                } else {
                  newEnv[oArg] = edge.objectIri;
                }
              } else if (oArg !== edge.objectIri) {
                match = false;
              }

              if (match) nextEnvs.push(newEnv);
            }
            break;
          }

          case "DataPropertyAtom": {
            const asserts = this.dataPropertyAssertions.get(atom.propertyIri) ?? [];
            const sArg = atom.argument1;
            const valArg = String(atom.argument2);

            for (const a of asserts) {
              const newEnv = { ...env };
              let match = true;

              if (sArg.startsWith("?")) {
                if (env[sArg] !== undefined) {
                  if (env[sArg] !== a.subjectIri) match = false;
                } else {
                  newEnv[sArg] = a.subjectIri;
                }
              } else if (sArg !== a.subjectIri) {
                match = false;
              }

              if (!match) continue;

              if (valArg.startsWith("?")) {
                if (env[valArg] !== undefined) {
                  if (env[valArg] !== a.value) match = false;
                } else {
                  newEnv[valArg] = a.value;
                }
              } else if (valArg !== a.value) {
                match = false;
              }

              if (match) nextEnvs.push(newEnv);
            }
            break;
          }

          case "SameIndividualAtom": {
            const a1 = atom.argument1.startsWith("?") ? env[atom.argument1] : atom.argument1;
            const a2 = atom.argument2.startsWith("?") ? env[atom.argument2] : atom.argument2;
            if (a1 && a2) {
              const rep1 = this.sameIndividualGroups.get(a1)
                ? Array.from(this.sameIndividualGroups.get(a1)!).sort()[0]
                : a1;
              const rep2 = this.sameIndividualGroups.get(a2)
                ? Array.from(this.sameIndividualGroups.get(a2)!).sort()[0]
                : a2;
              if (rep1 === rep2) nextEnvs.push({ ...env });
            }
            break;
          }

          case "DifferentIndividualsAtom": {
            const a1 = atom.argument1.startsWith("?") ? env[atom.argument1] : atom.argument1;
            const a2 = atom.argument2.startsWith("?") ? env[atom.argument2] : atom.argument2;
            if (a1 && a2 && this.isDifferent(a1, a2)) {
              nextEnvs.push({ ...env });
            }
            break;
          }

          case "BuiltInAtom": {
            const evaluated = this.evaluateSwrlBuiltIn(atom, env);
            if (evaluated) nextEnvs.push(evaluated);
            break;
          }
        }
      }

      currentEnvs = nextEnvs;
      if (currentEnvs.length === 0) break;
    }

    return currentEnvs;
  }

  private evaluateSwrlBuiltIn(atom: SWRLBuiltInAtom, env: Record<string, string>): Record<string, string> | null {
    const resolveVal = (arg: string | number): number => {
      const str = String(arg);
      if (str.startsWith("?")) {
        const bound = env[str];
        return bound !== undefined ? Number(bound) : NaN;
      }
      return Number(arg);
    };

    const resolveStr = (arg: string | number): string => {
      const str = String(arg);
      if (str.startsWith("?")) {
        return env[str] ?? "";
      }
      return String(arg);
    };

    const args = atom.arguments;
    switch (atom.builtInIri) {
      case "swrlb:add": {
        if (args.length !== 3) return null;
        const resArg = String(args[0]);
        const a = resolveVal(args[1]!);
        const b = resolveVal(args[2]!);
        if (isNaN(a) || isNaN(b)) return null;
        const sum = a + b;
        if (resArg.startsWith("?")) {
          if (env[resArg] !== undefined) {
            return Number(env[resArg]) === sum ? { ...env } : null;
          }
          return { ...env, [resArg]: String(sum) };
        }
        return Number(resArg) === sum ? { ...env } : null;
      }

      case "swrlb:subtract": {
        if (args.length !== 3) return null;
        const resArg = String(args[0]);
        const a = resolveVal(args[1]!);
        const b = resolveVal(args[2]!);
        if (isNaN(a) || isNaN(b)) return null;
        const diff = a - b;
        if (resArg.startsWith("?")) {
          if (env[resArg] !== undefined) {
            return Number(env[resArg]) === diff ? { ...env } : null;
          }
          return { ...env, [resArg]: String(diff) };
        }
        return Number(resArg) === diff ? { ...env } : null;
      }

      case "swrlb:multiply": {
        if (args.length !== 3) return null;
        const resArg = String(args[0]);
        const a = resolveVal(args[1]!);
        const b = resolveVal(args[2]!);
        if (isNaN(a) || isNaN(b)) return null;
        const prod = a * b;
        if (resArg.startsWith("?")) {
          if (env[resArg] !== undefined) {
            return Number(env[resArg]) === prod ? { ...env } : null;
          }
          return { ...env, [resArg]: String(prod) };
        }
        return Number(resArg) === prod ? { ...env } : null;
      }

      case "swrlb:divide": {
        if (args.length !== 3) return null;
        const resArg = String(args[0]);
        const a = resolveVal(args[1]!);
        const b = resolveVal(args[2]!);
        if (isNaN(a) || isNaN(b) || b === 0) return null;
        const div = a / b;
        if (resArg.startsWith("?")) {
          if (env[resArg] !== undefined) {
            return Number(env[resArg]) === div ? { ...env } : null;
          }
          return { ...env, [resArg]: String(div) };
        }
        return Number(resArg) === div ? { ...env } : null;
      }

      case "swrlb:equal": {
        if (args.length !== 2) return null;
        const v1 = resolveStr(args[0]!);
        const v2 = resolveStr(args[1]!);
        return v1 === v2 ? { ...env } : null;
      }

      case "swrlb:notEqual": {
        if (args.length !== 2) return null;
        const v1 = resolveStr(args[0]!);
        const v2 = resolveStr(args[1]!);
        return v1 !== v2 ? { ...env } : null;
      }

      case "swrlb:lessThan": {
        if (args.length !== 2) return null;
        const a = resolveVal(args[0]!);
        const b = resolveVal(args[1]!);
        return !isNaN(a) && !isNaN(b) && a < b ? { ...env } : null;
      }

      case "swrlb:lessThanOrEqual": {
        if (args.length !== 2) return null;
        const a = resolveVal(args[0]!);
        const b = resolveVal(args[1]!);
        return !isNaN(a) && !isNaN(b) && a <= b ? { ...env } : null;
      }

      case "swrlb:greaterThan": {
        if (args.length !== 2) return null;
        const a = resolveVal(args[0]!);
        const b = resolveVal(args[1]!);
        return !isNaN(a) && !isNaN(b) && a > b ? { ...env } : null;
      }

      case "swrlb:greaterThanOrEqual": {
        if (args.length !== 2) return null;
        const a = resolveVal(args[0]!);
        const b = resolveVal(args[1]!);
        return !isNaN(a) && !isNaN(b) && a >= b ? { ...env } : null;
      }

      case "swrlb:stringConcat": {
        if (args.length < 2) return null;
        const resArg = String(args[0]);
        const parts = args.slice(1).map(resolveStr);
        const concatenated = parts.join("");
        if (resArg.startsWith("?")) {
          if (env[resArg] !== undefined) {
            return env[resArg] === concatenated ? { ...env } : null;
          }
          return { ...env, [resArg]: concatenated };
        }
        return resArg === concatenated ? { ...env } : null;
      }

      default:
        return { ...env };
    }
  }

  private applySwrlHeadAtom(headAtom: SWRLAtom, env: Record<string, string>): boolean {
    const resolveInd = (arg: string): string => {
      if (arg.startsWith("?")) return env[arg] ?? arg;
      return arg;
    };

    switch (headAtom.type) {
      case "ClassAtom": {
        const ind = resolveInd(headAtom.argument);
        const types = this.individualTypes.get(ind) ?? new Set();
        if (!types.has(headAtom.classIri)) {
          types.add(headAtom.classIri);
          this.individualTypes.set(ind, types);
          this._axioms.push({
            type: "ClassAssertion",
            individualIri: ind,
            classIri: headAtom.classIri,
            sourceLang: "swrl",
          });
          return true;
        }
        return false;
      }

      case "IndividualPropertyAtom": {
        const s = resolveInd(headAtom.argument1);
        const o = resolveInd(headAtom.argument2);
        const edges = this.objectPropertyAssertions.get(headAtom.propertyIri) ?? [];
        if (!edges.some((e) => e.subjectIri === s && e.objectIri === o)) {
          edges.push({ subjectIri: s, objectIri: o });
          this.objectPropertyAssertions.set(headAtom.propertyIri, edges);
          this._axioms.push({
            type: "ObjectPropertyAssertion",
            propertyIri: headAtom.propertyIri,
            subjectIri: s,
            objectIri: o,
            sourceLang: "swrl",
          });
          return true;
        }
        return false;
      }

      case "DataPropertyAtom": {
        const s = resolveInd(headAtom.argument1);
        const rawVal = headAtom.argument2.toString();
        const val = rawVal.startsWith("?") ? (env[rawVal] ?? rawVal) : rawVal;
        const asserts = this.dataPropertyAssertions.get(headAtom.propertyIri) ?? [];
        if (!asserts.some((a) => a.subjectIri === s && a.value === val)) {
          asserts.push({ subjectIri: s, value: val });
          this.dataPropertyAssertions.set(headAtom.propertyIri, asserts);
          this._axioms.push({
            type: "DataPropertyAssertion",
            propertyIri: headAtom.propertyIri,
            subjectIri: s,
            value: val,
            sourceLang: "swrl",
          });
          return true;
        }
        return false;
      }

      case "SameIndividualAtom": {
        const a1 = resolveInd(headAtom.argument1);
        const a2 = resolveInd(headAtom.argument2);
        const g = this.sameIndividualGroups.get(a1);
        if (!g || !g.has(a2)) {
          this.unifyIndividuals(a1, a2);
          return true;
        }
        return false;
      }

      default:
        return false;
    }
  }

  dispose(): void {
    this.clear();
    this._status = "idle";
  }

  isSubClassOf(subClassIri: string, superClassIri: string): SubsumptionResult {
    if (!this._classified) this.classify();

    if (subClassIri === superClassIri) {
      return { subClassIri, superClassIri, holds: true };
    }

    const node = this.classes.get(subClassIri);
    const holds = node?.allSuperClasses?.has(superClassIri) ?? false;

    return {
      subClassIri,
      superClassIri,
      holds,
      justification: holds ? this.buildJustification(subClassIri, superClassIri) : undefined,
    };
  }

  checkConsistency(): ConsistencyResult {
    if (!this._classified) this.classify();
    const res = this.checkConsistencyInternal();
    if (!res.isConsistent) {
      const allCores = this.allMus();
      const core = allCores.length > 0 ? allCores[0]! : this.quickXplain() || res.conflictingAxioms;
      return {
        ...res,
        minimalConflictCore: core,
        allMinimalConflictCores: allCores,
      };
    }
    return res;
  }

  quickXplain(backgroundAxioms?: readonly OWL2Axiom[]): readonly OWL2Axiom[] {
    const bg = backgroundAxioms ? [...backgroundAxioms] : [];
    const bgSet = new Set(bg.map((a) => axiomKey(a)));
    const delta = this._axioms.filter((a) => !bgSet.has(axiomKey(a)));

    if (this.testConsistencySubset([...bg, ...delta])) {
      return [];
    }

    return this.qxRecursive(bg, delta);
  }

  allMus(maxCores: number = 16): readonly (readonly OWL2Axiom[])[] {
    const root = this.quickXplain();
    if (root.length === 0) return [];

    const discovered: (readonly OWL2Axiom[])[] = [root];
    const queue: OWL2Axiom[][] = root.map((ax) => [ax]);

    const serializeAxiom = (a: OWL2Axiom) => axiomKey(a);
    const areCoresEqual = (c1: readonly OWL2Axiom[], c2: readonly OWL2Axiom[]) => {
      if (c1.length !== c2.length) return false;
      const s1 = new Set(c1.map(serializeAxiom));
      return c2.every((a) => s1.has(serializeAxiom(a)));
    };

    while (queue.length > 0 && discovered.length < maxCores) {
      const excludedPath = queue.shift()!;
      const excludedSet = new Set(excludedPath.map(serializeAxiom));
      const delta = this._axioms.filter((a) => !excludedSet.has(serializeAxiom(a)));

      const temp = new WasmOntologyReasoner();
      temp.loadOntology(delta);
      if (!temp.checkConsistencyInternal().isConsistent) {
        const newCore = temp.quickXplain();
        if (newCore.length > 0) {
          const alreadyFound = discovered.some((d) => areCoresEqual(d, newCore));
          if (!alreadyFound) {
            discovered.push(newCore);
            if (discovered.length < maxCores) {
              for (const ax of newCore) {
                if (!excludedSet.has(serializeAxiom(ax))) {
                  queue.push([...excludedPath, ax]);
                }
              }
            }
          }
        }
      }
    }

    return discovered;
  }

  private testConsistencySubset(axioms: OWL2Axiom[]): boolean {
    const temp = new WasmOntologyReasoner();
    temp.loadOntology(axioms);
    temp.classify();
    return temp.checkConsistencyInternal().isConsistent;
  }

  private qxRecursive(b: OWL2Axiom[], delta: OWL2Axiom[]): OWL2Axiom[] {
    if (b.length > 0 && !this.testConsistencySubset(b)) {
      return [];
    }
    if (delta.length === 0) return [];
    if (delta.length === 1) return delta;

    const mid = Math.floor(delta.length / 2);
    const d1 = delta.slice(0, mid);
    const d2 = delta.slice(mid);

    if (!this.testConsistencySubset([...b, ...d1])) {
      return this.qxRecursive(b, d1);
    }

    const d2Core = this.qxRecursive([...b, ...d1], d2);
    const d1Core = this.qxRecursive([...b, ...d2Core], d1);

    const merged = [...d1Core, ...d2Core];
    const unique = new Map<string, OWL2Axiom>();
    for (const a of merged) unique.set(axiomKey(a), a);
    return Array.from(unique.values());
  }

  getTaxonomy(): TaxonomyNode[] {
    if (!this._classified) this.classify();

    const nodes: TaxonomyNode[] = [];
    for (const [iri, node] of this.classes) {
      nodes.push({
        iri,
        directSuperClasses: [...node.superClasses],
        directSubClasses: [...node.subClasses],
        equivalentClasses: [...node.equivalents],
      });
    }
    return nodes;
  }

  classifyIndividual(individualIri: string): ClassificationResult {
    if (!this._classified) this.classify();

    const allTypes = this.individualTypes.get(individualIri) ?? new Set<string>();
    const directTypes = new Set(allTypes);

    for (const typeIri of allTypes) {
      const node = this.classes.get(typeIri);
      if (node?.allSubClasses) {
        for (const subIri of node.allSubClasses) {
          if (allTypes.has(subIri) && subIri !== typeIri) {
            directTypes.delete(typeIri);
            break;
          }
        }
      }
    }

    return {
      individualIri,
      directTypes: [...directTypes],
      allTypes: [...allTypes],
    };
  }

  getTransitiveClosure(propertyIri: string, fromIri: string): PropertyChainResult {
    const edges = this.objectPropertyAssertions.get(propertyIri) ?? [];
    const visited = new Set<string>();
    const reachable: string[] = [];
    const path: { subjectIri: string; objectIri: string }[] = [];

    const queue = [fromIri];
    visited.add(fromIri);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;

      for (const edge of edges) {
        if (edge.subjectIri === current && !visited.has(edge.objectIri)) {
          visited.add(edge.objectIri);
          reachable.push(edge.objectIri);
          path.push({ subjectIri: edge.subjectIri, objectIri: edge.objectIri });
          queue.push(edge.objectIri);
        }
      }
    }

    return { propertyIri, sourceIri: fromIri, reachable, path };
  }

  query(q: DLQuery): DLQueryResult {
    if (!this._classified) this.classify();
    const start = performance.now();
    let bindings: string[] = [];
    let pairs: { subject: string; object: string }[] | undefined;

    switch (q.type) {
      case "instances": {
        for (const [indIri, types] of this.individualTypes) {
          if (types.has(q.iri)) bindings.push(indIri);
        }
        break;
      }

      case "subclasses": {
        const node = this.classes.get(q.iri);
        if (node?.allSubClasses) bindings = [...node.allSubClasses];
        break;
      }

      case "superclasses": {
        const node = this.classes.get(q.iri);
        if (node?.allSuperClasses) bindings = [...node.allSuperClasses];
        break;
      }

      case "equivalents": {
        const node = this.classes.get(q.iri);
        if (node?.equivalents) bindings = [...node.equivalents];
        break;
      }

      case "disjoint": {
        for (const pairKey of this.disjointPairs) {
          const [a, b] = pairKey.split("|");
          if (a === q.iri && b) bindings.push(b);
          else if (b === q.iri && a) bindings.push(a);
        }
        break;
      }

      case "property-values": {
        const edges = this.objectPropertyAssertions.get(q.iri) ?? [];
        pairs = edges.map((e) => ({ subject: e.subjectIri, object: e.objectIri }));
        bindings = [...new Set(edges.map((e) => e.objectIri))];
        break;
      }

      case "reachable": {
        if (q.fromIri) {
          const result = this.getTransitiveClosure(q.iri, q.fromIri);
          bindings = [...result.reachable];
        }
        break;
      }

      case "path": {
        if (q.fromIri) {
          const op = q.pathOp ?? "direct";
          bindings = [...this.evaluatePropertyPath(q.iri, op, q.fromIri, q.stepPropertyIri2)];
        }
        break;
      }
    }

    return {
      query: q,
      bindings,
      pairs,
      executionTimeMs: performance.now() - start,
    };
  }

  evaluatePropertyPath(
    propertyIri: string,
    pathOp: PropertyPathOp,
    fromIri: string,
    stepPropertyIri2?: string,
  ): readonly string[] {
    const reachable = new Set<string>();

    switch (pathOp) {
      case "direct": {
        const edges = this.objectPropertyAssertions.get(propertyIri) ?? [];
        for (const e of edges) {
          if (e.subjectIri === fromIri) reachable.add(e.objectIri);
        }
        break;
      }

      case "inverse": {
        const edges = this.objectPropertyAssertions.get(propertyIri) ?? [];
        for (const e of edges) {
          if (e.objectIri === fromIri) reachable.add(e.subjectIri);
        }
        break;
      }

      case "star": {
        reachable.add(fromIri);
        const queue = [fromIri];
        const visited = new Set<string>([fromIri]);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          const edges = this.objectPropertyAssertions.get(propertyIri) ?? [];
          for (const e of edges) {
            if (e.subjectIri === curr && !visited.has(e.objectIri)) {
              visited.add(e.objectIri);
              reachable.add(e.objectIri);
              queue.push(e.objectIri);
            }
          }
        }
        break;
      }

      case "plus": {
        const queue = [fromIri];
        const visited = new Set<string>([fromIri]);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          const edges = this.objectPropertyAssertions.get(propertyIri) ?? [];
          for (const e of edges) {
            if (e.subjectIri === curr && !visited.has(e.objectIri)) {
              visited.add(e.objectIri);
              reachable.add(e.objectIri);
              queue.push(e.objectIri);
            }
          }
        }
        break;
      }

      case "inverse-plus": {
        const queue = [fromIri];
        const visited = new Set<string>([fromIri]);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          const edges = this.objectPropertyAssertions.get(propertyIri) ?? [];
          for (const e of edges) {
            if (e.objectIri === curr && !visited.has(e.subjectIri)) {
              visited.add(e.subjectIri);
              reachable.add(e.subjectIri);
              queue.push(e.subjectIri);
            }
          }
        }
        break;
      }

      case "sequence": {
        const step1Targets = new Set<string>();
        const edges1 = this.objectPropertyAssertions.get(propertyIri) ?? [];
        for (const e of edges1) {
          if (e.subjectIri === fromIri) step1Targets.add(e.objectIri);
        }
        if (stepPropertyIri2) {
          const edges2 = this.objectPropertyAssertions.get(stepPropertyIri2) ?? [];
          for (const s of step1Targets) {
            for (const e of edges2) {
              if (e.subjectIri === s) reachable.add(e.objectIri);
            }
          }
        }
        break;
      }

      case "alternation": {
        const edges1 = this.objectPropertyAssertions.get(propertyIri) ?? [];
        for (const e of edges1) {
          if (e.subjectIri === fromIri) reachable.add(e.objectIri);
        }
        if (stepPropertyIri2) {
          const edges2 = this.objectPropertyAssertions.get(stepPropertyIri2) ?? [];
          for (const e of edges2) {
            if (e.subjectIri === fromIri) reachable.add(e.objectIri);
          }
        }
        break;
      }
    }

    return Array.from(reachable);
  }

  queryBgp(query: BgpQuery): BgpQueryResult {
    if (!this._classified) this.classify();
    const start = performance.now();

    const varSet = new Set<string>();
    for (const pat of query.patterns) {
      if (pat.subject.startsWith("?")) varSet.add(pat.subject);
      if (pat.predicate.startsWith("?")) varSet.add(pat.predicate);
      if (pat.object.startsWith("?")) varSet.add(pat.object);
    }
    const variables = Array.from(varSet);

    if (query.patterns.length === 0) {
      return { variables, bindings: [], executionTimeMs: performance.now() - start };
    }

    // 1. Gather all asserted + inferred facts
    const allFacts: { s: string; p: string; o: string }[] = [];
    const byPred = new Map<string, { s: string; o: string }[]>();
    const bySubjPred = new Map<string, string[]>();

    const addFact = (s: string, p: string, o: string) => {
      allFacts.push({ s, p, o });
      let pList = byPred.get(p);
      if (!pList) {
        pList = [];
        byPred.set(p, pList);
      }
      pList.push({ s, o });

      const spKey = `${s}|${p}`;
      let spList = bySubjPred.get(spKey);
      if (!spList) {
        spList = [];
        bySubjPred.set(spKey, spList);
      }
      spList.push(o);
    };

    // Object property assertions (inferred + asserted)
    for (const [p, edges] of this.objectPropertyAssertions) {
      for (const e of edges) addFact(e.subjectIri, p, e.objectIri);
    }

    // Data property assertions (inferred + asserted)
    for (const [p, asserts] of this.dataPropertyAssertions) {
      for (const a of asserts) addFact(a.subjectIri, p, a.value);
    }

    // Class assertions (inferred + asserted)
    for (const [ind, types] of this.individualTypes) {
      for (const t of types) addFact(ind, "rdf:type", t);
    }

    // SubClassOf axioms
    for (const ax of this._axioms) {
      if (ax.type === "SubClassOf") {
        addFact(ax.subClassIri, "rdfs:subClassOf", ax.superClassIri);
      }
    }

    // 2. Selectivity-guided pattern reordering
    // Score patterns based on bound variables and constants
    const remainingPatterns = [...query.patterns];
    const orderedPatterns: TriplePattern[] = [];
    const boundVars = new Set<string>();

    while (remainingPatterns.length > 0) {
      let bestIdx = 0;
      let bestScore = -1;

      for (let i = 0; i < remainingPatterns.length; i++) {
        const pat = remainingPatterns[i]!;
        let score = 0;
        if (!pat.subject.startsWith("?") || boundVars.has(pat.subject)) score += 3;
        if (!pat.predicate.startsWith("?") || boundVars.has(pat.predicate)) score += 5;
        if (!pat.object.startsWith("?") || boundVars.has(pat.object)) score += 3;

        // Bias towards smaller predicates
        if (!pat.predicate.startsWith("?")) {
          const predCount = byPred.get(pat.predicate)?.length ?? 0;
          score += 1000 / (predCount + 1);
        }

        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      const selected = remainingPatterns.splice(bestIdx, 1)[0]!;
      orderedPatterns.push(selected);
      if (selected.subject.startsWith("?")) boundVars.add(selected.subject);
      if (selected.predicate.startsWith("?")) boundVars.add(selected.predicate);
      if (selected.object.startsWith("?")) boundVars.add(selected.object);
    }

    // 3. Index-accelerated join execution
    let currentBindings: Record<string, string>[] = [{}];

    for (const pat of orderedPatterns) {
      const nextBindings: Record<string, string>[] = [];

      for (const env of currentBindings) {
        const pVal = pat.predicate.startsWith("?") ? env[pat.predicate] : pat.predicate;
        const sVal = pat.subject.startsWith("?") ? env[pat.subject] : pat.subject;

        let candidateFacts: { s: string; p: string; o: string }[];
        if (pVal && sVal) {
          const objs = bySubjPred.get(`${sVal}|${pVal}`);
          if (!objs || objs.length === 0) continue;
          candidateFacts = objs.map((o) => ({ s: sVal, p: pVal, o }));
        } else if (pVal) {
          const edges = byPred.get(pVal);
          if (!edges || edges.length === 0) continue;
          candidateFacts = edges.map((e) => ({ s: e.s, p: pVal, o: e.o }));
        } else {
          candidateFacts = allFacts;
        }

        for (const fact of candidateFacts) {
          let match = true;
          const newEnv = { ...env };

          if (pat.subject.startsWith("?")) {
            if (env[pat.subject] !== undefined) {
              if (env[pat.subject] !== fact.s) match = false;
            } else {
              newEnv[pat.subject] = fact.s;
            }
          } else if (pat.subject !== fact.s) {
            match = false;
          }

          if (!match) continue;

          if (pat.predicate.startsWith("?")) {
            if (env[pat.predicate] !== undefined) {
              if (env[pat.predicate] !== fact.p) match = false;
            } else {
              newEnv[pat.predicate] = fact.p;
            }
          } else if (pat.predicate !== fact.p) {
            match = false;
          }

          if (!match) continue;

          if (pat.object.startsWith("?")) {
            if (env[pat.object] !== undefined) {
              if (env[pat.object] !== fact.o) match = false;
            } else {
              newEnv[pat.object] = fact.o;
            }
          } else if (pat.object !== fact.o) {
            match = false;
          }

          if (match) {
            nextBindings.push(newEnv);
          }
        }
      }

      currentBindings = nextBindings;
      if (currentBindings.length === 0) break;
    }

    const uniqueMap = new Map<string, Record<string, string>>();
    for (const b of currentBindings) {
      uniqueMap.set(JSON.stringify(b), b);
    }

    return {
      variables,
      bindings: Array.from(uniqueMap.values()),
      executionTimeMs: performance.now() - start,
    };
  }

  explain(subClassIri: string, superClassIri: string): readonly OWL2Axiom[] {
    if (!this._classified) this.classify();
    return this.buildJustification(subClassIri, superClassIri);
  }

  private indexAxiom(axiom: OWL2Axiom): void {
    switch (axiom.type) {
      case "ClassDeclaration": {
        this.ensureClass(axiom.iri);
        break;
      }

      case "SubClassOf": {
        const sub = this.ensureClass(axiom.subClassIri);
        const sup = this.ensureClass(axiom.superClassIri);
        sub.superClasses.add(axiom.superClassIri);
        sup.subClasses.add(axiom.subClassIri);
        break;
      }

      case "EquivalentClasses": {
        for (let i = 0; i < axiom.classIris.length; i++) {
          const aIri = axiom.classIris[i];
          if (!aIri) continue;
          const a = this.ensureClass(aIri);
          for (let j = 0; j < axiom.classIris.length; j++) {
            if (i === j) continue;
            const bIri = axiom.classIris[j];
            if (!bIri) continue;
            a.equivalents.add(bIri);
            a.superClasses.add(bIri);
            const b = this.ensureClass(bIri);
            b.subClasses.add(aIri);
          }
        }
        break;
      }

      case "DisjointClasses": {
        for (let i = 0; i < axiom.classIris.length; i++) {
          const classIri = axiom.classIris[i];
          if (!classIri) continue;
          this.ensureClass(classIri);
          for (let j = i + 1; j < axiom.classIris.length; j++) {
            const a = classIri;
            const b = axiom.classIris[j];
            if (!b) continue;
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            this.disjointPairs.add(key);
          }
        }
        break;
      }

      case "ObjectPropertyDeclaration": {
        this.objectProperties.add(axiom.iri);
        if (axiom.characteristics?.includes("Transitive")) {
          this.transitiveProperties.add(axiom.iri);
        }
        break;
      }

      case "DataPropertyDeclaration": {
        this.dataProperties.add(axiom.iri);
        break;
      }

      case "TransitiveObjectProperty": {
        this.transitiveProperties.add(axiom.propertyIri);
        break;
      }

      case "ObjectPropertyAssertion": {
        const edges = this.objectPropertyAssertions.get(axiom.propertyIri);
        const edge = { subjectIri: axiom.subjectIri, objectIri: axiom.objectIri };
        if (edges) {
          edges.push(edge);
        } else {
          this.objectPropertyAssertions.set(axiom.propertyIri, [edge]);
        }
        break;
      }

      case "DataPropertyAssertion": {
        this.rawDataPropertyAssertions.push(axiom);
        const assertions = this.dataPropertyAssertions.get(axiom.propertyIri);
        const assertion = { subjectIri: axiom.subjectIri, value: axiom.value };
        if (assertions) {
          assertions.push(assertion);
        } else {
          this.dataPropertyAssertions.set(axiom.propertyIri, [assertion]);
        }
        break;
      }

      case "IndividualDeclaration": {
        if (!this.individualTypes.has(axiom.iri)) {
          this.individualTypes.set(axiom.iri, new Set());
        }
        break;
      }

      case "ClassAssertion": {
        const types = this.individualTypes.get(axiom.individualIri);
        if (types) {
          types.add(axiom.classIri);
        } else {
          this.individualTypes.set(axiom.individualIri, new Set([axiom.classIri]));
        }
        break;
      }

      case "FunctionalObjectProperty": {
        this.functionalObjectProperties.add(axiom.propertyIri);
        break;
      }

      case "FunctionalDataProperty": {
        this.dataProperties.add(axiom.propertyIri);
        this.functionalDataProperties.add(axiom.propertyIri);
        break;
      }

      case "SameIndividual": {
        for (let i = 0; i < axiom.individualIris.length; i++) {
          for (let j = i + 1; j < axiom.individualIris.length; j++) {
            const a = axiom.individualIris[i]!;
            const b = axiom.individualIris[j]!;
            this.unifyIndividuals(a, b);
          }
        }
        break;
      }

      case "ObjectSomeValuesFrom":
      case "DataSomeValuesFrom":
        break;

      case "SymmetricObjectProperty": {
        const edges = this.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
        const toAdd: { subjectIri: string; objectIri: string }[] = [];
        for (const e of edges) {
          if (!edges.some((ex) => ex.subjectIri === e.objectIri && ex.objectIri === e.subjectIri)) {
            toAdd.push({ subjectIri: e.objectIri, objectIri: e.subjectIri });
          }
        }
        for (const add of toAdd) edges.push(add);
        this.objectPropertyAssertions.set(axiom.propertyIri, edges);
        break;
      }

      case "InverseObjectProperty": {
        const edgesR = this.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
        const edgesS = this.objectPropertyAssertions.get(axiom.inversePropertyIri) ?? [];
        for (const e of edgesR) {
          if (!edgesS.some((ex) => ex.subjectIri === e.objectIri && ex.objectIri === e.subjectIri)) {
            edgesS.push({ subjectIri: e.objectIri, objectIri: e.subjectIri });
          }
        }
        for (const e of edgesS) {
          if (!edgesR.some((ex) => ex.subjectIri === e.objectIri && ex.objectIri === e.subjectIri)) {
            edgesR.push({ subjectIri: e.objectIri, objectIri: e.subjectIri });
          }
        }
        this.objectPropertyAssertions.set(axiom.propertyIri, edgesR);
        this.objectPropertyAssertions.set(axiom.inversePropertyIri, edgesS);
        break;
      }

      case "UniversalRestriction": {
        const edges = this.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
        for (const e of edges) {
          if (!axiom.classIri || (this.individualTypes.get(e.subjectIri)?.has(axiom.classIri) ?? false)) {
            const types = this.individualTypes.get(e.objectIri) ?? new Set();
            types.add(axiom.targetClassIri);
            this.individualTypes.set(e.objectIri, types);
          }
        }
        break;
      }

      case "DisjunctiveClass": {
        if (axiom.superClassIri && axiom.classIris.length > 0) {
          for (const c of axiom.classIris) {
            const sub = this.ensureClass(c);
            sub.superClasses.add(axiom.superClassIri);
          }
        }
        break;
      }

      case "SelfRestriction": {
        for (const [indIri, types] of this.individualTypes) {
          if (types.has(axiom.classIri)) {
            const edges = this.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
            if (!edges.some((e) => e.subjectIri === indIri && e.objectIri === indIri)) {
              edges.push({ subjectIri: indIri, objectIri: indIri });
              this.objectPropertyAssertions.set(axiom.propertyIri, edges);
            }
          }
        }
        break;
      }

      case "NominalClass":
      case "ObjectOneOf": {
        this.ensureClass(axiom.classIri);
        let nomSet = this.objectOneOfMap.get(axiom.classIri);
        if (!nomSet) {
          nomSet = new Set<string>();
          this.objectOneOfMap.set(axiom.classIri, nomSet);
        }
        for (const ind of axiom.individualIris) {
          nomSet.add(ind);
          const types = this.individualTypes.get(ind) ?? new Set();
          types.add(axiom.classIri);
          this.individualTypes.set(ind, types);
        }
        break;
      }

      case "DifferentIndividuals": {
        for (let i = 0; i < axiom.individualIris.length; i++) {
          for (let j = i + 1; j < axiom.individualIris.length; j++) {
            const a = axiom.individualIris[i]!;
            const b = axiom.individualIris[j]!;
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            this.differentIndividualPairs.add(key);
          }
        }
        break;
      }

      case "SwrlRule": {
        this.swrlRules.push(axiom);
        break;
      }

      case "QualifiedCardinality": {
        this.qualifiedCardinalities.push(axiom);
        this.ensureClass(axiom.classIri);
        this.objectProperties.add(axiom.propertyIri);
        if (axiom.fillerClassIri) {
          this.ensureClass(axiom.fillerClassIri);
        }
        break;
      }

      case "SubPropertyChainOf": {
        this.subPropertyChains.push(axiom);
        this.objectProperties.add(axiom.superPropertyIri);
        for (const p of axiom.subPropertyChain) {
          this.objectProperties.add(p);
        }
        break;
      }

      case "LinearConstraint": {
        this.linearConstraints.push(axiom);
        for (const t of axiom.terms) {
          this.dataProperties.add(t.propertyIri);
        }
        break;
      }

      case "AsymmetricObjectProperty": {
        this.objectProperties.add(axiom.propertyIri);
        this.asymmetricProperties.add(axiom.propertyIri);
        break;
      }

      case "IrreflexiveObjectProperty": {
        this.objectProperties.add(axiom.propertyIri);
        this.irreflexiveProperties.add(axiom.propertyIri);
        break;
      }

      case "DisjointObjectProperties": {
        for (let i = 0; i < axiom.propertyIris.length; i++) {
          const p1 = axiom.propertyIris[i]!;
          this.objectProperties.add(p1);
          for (let j = i + 1; j < axiom.propertyIris.length; j++) {
            const p2 = axiom.propertyIris[j]!;
            this.objectProperties.add(p2);
            const key = p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
            this.disjointPropertyPairs.add(key);
          }
        }
        break;
      }
    }
  }

  private removeAxiom(axiom: OWL2Axiom): void {
    const idx = this._axioms.findIndex((a) => axiomEqual(a, axiom));
    if (idx !== -1) this._axioms.splice(idx, 1);

    switch (axiom.type) {
      case "SubClassOf": {
        const sub = this.classes.get(axiom.subClassIri);
        const sup = this.classes.get(axiom.superClassIri);
        sub?.superClasses.delete(axiom.superClassIri);
        sup?.subClasses.delete(axiom.subClassIri);
        break;
      }

      case "EquivalentClasses": {
        for (const iri of axiom.classIris) {
          const node = this.classes.get(iri);
          if (node) {
            for (const other of axiom.classIris) {
              if (other !== iri) {
                node.equivalents.delete(other);
                node.superClasses.delete(other);
              }
            }
          }
        }
        break;
      }

      case "DisjointClasses": {
        for (let i = 0; i < axiom.classIris.length; i++) {
          for (let j = i + 1; j < axiom.classIris.length; j++) {
            const a = axiom.classIris[i];
            const b = axiom.classIris[j];
            if (!a || !b) continue;
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            this.disjointPairs.delete(key);
          }
        }
        break;
      }

      case "ObjectPropertyAssertion": {
        const edges = this.objectPropertyAssertions.get(axiom.propertyIri);
        if (edges) {
          const idx = edges.findIndex((e) => e.subjectIri === axiom.subjectIri && e.objectIri === axiom.objectIri);
          if (idx !== -1) edges.splice(idx, 1);
        }
        break;
      }

      case "ClassAssertion": {
        const types = this.individualTypes.get(axiom.individualIri);
        types?.delete(axiom.classIri);
        break;
      }

      case "FunctionalObjectProperty": {
        this.functionalObjectProperties.delete(axiom.propertyIri);
        break;
      }

      case "FunctionalDataProperty": {
        this.functionalDataProperties.delete(axiom.propertyIri);
        break;
      }

      case "AsymmetricObjectProperty": {
        this.asymmetricProperties.delete(axiom.propertyIri);
        break;
      }

      case "IrreflexiveObjectProperty": {
        this.irreflexiveProperties.delete(axiom.propertyIri);
        break;
      }

      case "DisjointObjectProperties": {
        for (let i = 0; i < axiom.propertyIris.length; i++) {
          for (let j = i + 1; j < axiom.propertyIris.length; j++) {
            const p1 = axiom.propertyIris[i]!;
            const p2 = axiom.propertyIris[j]!;
            const key = p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
            this.disjointPropertyPairs.delete(key);
          }
        }
        break;
      }

      case "DataPropertyAssertion": {
        const rawIdx = this.rawDataPropertyAssertions.findIndex((a) => axiomEqual(a, axiom));
        if (rawIdx !== -1) this.rawDataPropertyAssertions.splice(rawIdx, 1);
        const assertions = this.dataPropertyAssertions.get(axiom.propertyIri);
        if (assertions) {
          const aIdx = assertions.findIndex((a) => a.subjectIri === axiom.subjectIri && a.value === axiom.value);
          if (aIdx !== -1) assertions.splice(aIdx, 1);
        }
        break;
      }

      case "SubPropertyChainOf": {
        const idx = this.subPropertyChains.findIndex((a) => axiomEqual(a, axiom));
        if (idx !== -1) this.subPropertyChains.splice(idx, 1);
        break;
      }

      case "QualifiedCardinality": {
        const idx = this.qualifiedCardinalities.findIndex((a) => axiomEqual(a, axiom));
        if (idx !== -1) this.qualifiedCardinalities.splice(idx, 1);
        break;
      }

      case "LinearConstraint": {
        const idx = this.linearConstraints.findIndex((a) => axiomEqual(a, axiom));
        if (idx !== -1) this.linearConstraints.splice(idx, 1);
        break;
      }

      case "NominalClass":
      case "ObjectOneOf": {
        this.objectOneOfMap.delete(axiom.classIri);
        break;
      }

      case "DifferentIndividuals": {
        for (let i = 0; i < axiom.individualIris.length; i++) {
          for (let j = i + 1; j < axiom.individualIris.length; j++) {
            const a = axiom.individualIris[i]!;
            const b = axiom.individualIris[j]!;
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            this.differentIndividualPairs.delete(key);
          }
        }
        break;
      }

      case "SwrlRule": {
        const idx = this.swrlRules.findIndex((r) => axiomEqual(r, axiom));
        if (idx !== -1) this.swrlRules.splice(idx, 1);
        break;
      }

      default:
        break;
    }
  }

  private computeAllSuperClasses(iri: string): Set<string> {
    const node = this.classes.get(iri);
    if (!node) return new Set();
    if (node.allSuperClasses) return node.allSuperClasses;

    node.allSuperClasses = new Set();

    for (const superIri of node.superClasses) {
      node.allSuperClasses.add(superIri);
      const transitive = this.computeAllSuperClasses(superIri);
      for (const t of transitive) {
        node.allSuperClasses.add(t);
      }
    }

    for (const eqIri of node.equivalents) {
      node.allSuperClasses.add(eqIri);
    }

    return node.allSuperClasses;
  }

  private checkConsistencyInternal(): ConsistencyResult {
    const conflicts: OWL2Axiom[] = [];

    for (const pairKey of this.disjointPairs) {
      const [aIri, bIri] = pairKey.split("|");
      if (!aIri || !bIri) continue;

      const aNode = this.classes.get(aIri);
      const bNode = this.classes.get(bIri);

      let hasClassConflict = aNode?.allSuperClasses?.has(bIri) || bNode?.allSuperClasses?.has(aIri);
      if (!hasClassConflict) {
        for (const [, candNode] of this.classes) {
          if (candNode.allSuperClasses?.has(aIri) && candNode.allSuperClasses?.has(bIri)) {
            hasClassConflict = true;
            break;
          }
        }
      }

      if (hasClassConflict) {
        conflicts.push({
          type: "DisjointClasses",
          classIris: [aIri, bIri],
          sourceLang: "inferred",
        });
      }

      for (const [indIri, types] of this.individualTypes) {
        if (types.has(aIri) && types.has(bIri)) {
          conflicts.push({
            type: "ClassAssertion",
            classIri: aIri,
            individualIri: indIri,
            sourceLang: "inferred",
          });
        }
      }
    }

    // Disjoint object properties
    for (const pairKey of this.disjointPropertyPairs) {
      const [p1, p2] = pairKey.split("|");
      if (!p1 || !p2) continue;
      const edges1 = this.objectPropertyAssertions.get(p1) ?? [];
      const edges2 = this.objectPropertyAssertions.get(p2) ?? [];
      for (const e1 of edges1) {
        const match = edges2.find((e2) => e2.subjectIri === e1.subjectIri && e2.objectIri === e1.objectIri);
        if (match) {
          conflicts.push({
            type: "DisjointObjectProperties",
            propertyIris: [p1, p2],
            sourceLang: "inferred",
          });
          conflicts.push({
            type: "ObjectPropertyAssertion",
            propertyIri: p1,
            subjectIri: e1.subjectIri,
            objectIri: e1.objectIri,
            sourceLang: "inferred",
          });
          conflicts.push({
            type: "ObjectPropertyAssertion",
            propertyIri: p2,
            subjectIri: match.subjectIri,
            objectIri: match.objectIri,
            sourceLang: "inferred",
          });
          break;
        }
      }
    }

    // Asymmetric object properties
    for (const propIri of this.asymmetricProperties) {
      const edges = this.objectPropertyAssertions.get(propIri) ?? [];
      for (const e of edges) {
        const rev = edges.find((r) => r.subjectIri === e.objectIri && r.objectIri === e.subjectIri);
        if (rev) {
          conflicts.push({
            type: "AsymmetricObjectProperty",
            propertyIri: propIri,
            sourceLang: "inferred",
          });
          conflicts.push({
            type: "ObjectPropertyAssertion",
            propertyIri: propIri,
            subjectIri: e.subjectIri,
            objectIri: e.objectIri,
            sourceLang: "inferred",
          });
          conflicts.push({
            type: "ObjectPropertyAssertion",
            propertyIri: propIri,
            subjectIri: rev.subjectIri,
            objectIri: rev.objectIri,
            sourceLang: "inferred",
          });
          break;
        }
      }
    }

    // Irreflexive object properties
    for (const propIri of this.irreflexiveProperties) {
      const edges = this.objectPropertyAssertions.get(propIri) ?? [];
      for (const e of edges) {
        if (e.subjectIri === e.objectIri) {
          conflicts.push({
            type: "IrreflexiveObjectProperty",
            propertyIri: propIri,
            sourceLang: "inferred",
          });
          conflicts.push({
            type: "ObjectPropertyAssertion",
            propertyIri: propIri,
            subjectIri: e.subjectIri,
            objectIri: e.objectIri,
            sourceLang: "inferred",
          });
          break;
        }
      }
    }

    // Functional data properties
    for (const propIri of this.functionalDataProperties) {
      const asserts = this.dataPropertyAssertions.get(propIri) ?? [];
      const bySubj = new Map<string, string[]>();
      for (const a of asserts) {
        const list = bySubj.get(a.subjectIri) ?? [];
        list.push(a.value);
        bySubj.set(a.subjectIri, list);
      }
      for (const [subj, vals] of bySubj) {
        const uniqueVals = Array.from(new Set(vals));
        if (uniqueVals.length > 1) {
          conflicts.push({
            type: "FunctionalDataProperty",
            propertyIri: propIri,
            sourceLang: "inferred",
          });
          for (const v of uniqueVals) {
            conflicts.push({
              type: "DataPropertyAssertion",
              propertyIri: propIri,
              subjectIri: subj,
              value: v,
              sourceLang: "inferred",
            });
          }
        }
      }
    }

    // Quantitative and numeric intervals
    const numericIntervals = new Map<string, { min: number; max: number; axioms: OWL2DataPropertyAssertion[] }>();
    for (const dpa of this.rawDataPropertyAssertions) {
      const key = `${dpa.subjectIri}|${dpa.propertyIri}`;
      let bounds = numericIntervals.get(key);
      if (!bounds) {
        bounds = { min: -Infinity, max: Infinity, axioms: [] };
        numericIntervals.set(key, bounds);
      }
      bounds.axioms.push(dpa);

      const eps = 1e-9;
      if (dpa.minVal !== undefined) {
        bounds.min = Math.max(bounds.min, dpa.minVal);
      }
      if (dpa.maxVal !== undefined) {
        bounds.max = Math.min(bounds.max, dpa.maxVal);
      }

      if (dpa.op) {
        const numVal = Number(dpa.value);
        if (!isNaN(numVal)) {
          switch (dpa.op) {
            case ">":
              bounds.min = Math.max(bounds.min, numVal + eps);
              break;
            case ">=":
              bounds.min = Math.max(bounds.min, numVal);
              break;
            case "<":
              bounds.max = Math.min(bounds.max, numVal - eps);
              break;
            case "<=":
              bounds.max = Math.min(bounds.max, numVal);
              break;
            case "=":
              bounds.min = Math.max(bounds.min, numVal);
              bounds.max = Math.min(bounds.max, numVal);
              break;
          }
        }
      } else if (dpa.value !== undefined) {
        const numVal = Number(dpa.value);
        if (!isNaN(numVal) && this.functionalDataProperties.has(dpa.propertyIri)) {
          bounds.min = Math.max(bounds.min, numVal);
          bounds.max = Math.min(bounds.max, numVal);
        }
      }
    }

    for (const [, bounds] of numericIntervals) {
      if (bounds.min > bounds.max) {
        for (const ax of bounds.axioms) {
          conflicts.push(ax);
        }
      }
    }

    // Qualified cardinality restrictions
    for (const qc of this.qualifiedCardinalities) {
      for (const [indIri, types] of this.individualTypes) {
        if (!types.has(qc.classIri)) continue;

        const edges = this.objectPropertyAssertions.get(qc.propertyIri) ?? [];
        const rawFillers = edges.filter((e) => e.subjectIri === indIri).map((e) => e.objectIri);

        const matchingFillers = qc.fillerClassIri
          ? rawFillers.filter((fillerIri) => this.individualTypes.get(fillerIri)?.has(qc.fillerClassIri!))
          : rawFillers;

        const distinctFillers = new Set<string>();
        for (const filler of matchingFillers) {
          let rep = filler;
          const group = this.sameIndividualGroups.get(filler);
          if (group && group.size > 0) {
            rep = Array.from(group).sort()[0]!;
          }
          distinctFillers.add(rep);
        }

        const count = distinctFillers.size;

        if (qc.cardinalityType === "max" || qc.cardinalityType === "exact") {
          if (count > qc.count) {
            conflicts.push({
              type: "QualifiedCardinality",
              classIri: qc.classIri,
              propertyIri: qc.propertyIri,
              fillerClassIri: qc.fillerClassIri,
              cardinalityType: qc.cardinalityType,
              count: qc.count,
              sourceLang: "inferred",
            });
            for (const f of distinctFillers) {
              conflicts.push({
                type: "ObjectPropertyAssertion",
                propertyIri: qc.propertyIri,
                subjectIri: indIri,
                objectIri: f,
                sourceLang: "inferred",
              });
            }
          }
        }
      }
    }

    // Multivariate Linear Constraints (D reasoning)
    for (const lc of this.linearConstraints) {
      const targetIndividuals: string[] = [];
      if (this.individualTypes.has(lc.subjectIri)) {
        targetIndividuals.push(lc.subjectIri);
      } else if (this.classes.has(lc.subjectIri)) {
        for (const [ind, types] of this.individualTypes) {
          if (types.has(lc.subjectIri)) targetIndividuals.push(ind);
        }
      } else {
        targetIndividuals.push(lc.subjectIri);
      }

      for (const ind of targetIndividuals) {
        let exprMin = 0;
        let exprMax = 0;
        let allTermsResolved = true;
        const contributingAxioms: OWL2Axiom[] = [];

        for (const term of lc.terms) {
          const key = `${ind}|${term.propertyIri}`;
          const bounds = numericIntervals.get(key);
          if (!bounds || bounds.min === -Infinity || bounds.max === Infinity) {
            const asserts =
              this.dataPropertyAssertions.get(term.propertyIri)?.filter((a) => a.subjectIri === ind) ?? [];
            if (asserts.length > 0) {
              const numVal = Number(asserts[0]!.value);
              if (!isNaN(numVal)) {
                exprMin += term.coefficient * numVal;
                exprMax += term.coefficient * numVal;
                continue;
              }
            }
            allTermsResolved = false;
            break;
          }

          for (const ax of bounds.axioms) contributingAxioms.push(ax);

          if (term.coefficient >= 0) {
            exprMin += term.coefficient * bounds.min;
            exprMax += term.coefficient * bounds.max;
          } else {
            exprMin += term.coefficient * bounds.max;
            exprMax += term.coefficient * bounds.min;
          }
        }

        if (allTermsResolved && lc.terms.length > 0) {
          const eps = 1e-9;
          let clash = false;
          switch (lc.op) {
            case "<=":
              if (exprMin > lc.bound + eps) clash = true;
              break;
            case "<":
              if (exprMin >= lc.bound - eps) clash = true;
              break;
            case ">=":
              if (exprMax < lc.bound - eps) clash = true;
              break;
            case ">":
              if (exprMax <= lc.bound + eps) clash = true;
              break;
            case "=":
              if (lc.bound < exprMin - eps || lc.bound > exprMax + eps) clash = true;
              break;
          }

          if (clash) {
            conflicts.push(lc);
            for (const ax of contributingAxioms) conflicts.push(ax);
          }
        }
      }
    }

    // DifferentIndividuals vs SameIndividual conflicts
    for (const pair of this.differentIndividualPairs) {
      const [a, b] = pair.split("|");
      if (a && b) {
        const ga = this.sameIndividualGroups.get(a);
        if (ga && ga.has(b)) {
          conflicts.push({
            type: "DifferentIndividuals",
            individualIris: [a, b],
            sourceLang: "inferred",
          });
          conflicts.push({
            type: "SameIndividual",
            individualIris: [a, b],
            sourceLang: "inferred",
          });
        }
      }
    }

    // ObjectOneOf conflicts: individual has type C, but is DifferentFrom ALL nominals of C
    for (const [classIri, nominals] of this.objectOneOfMap) {
      const nominalArr = Array.from(nominals);
      for (const [ind, types] of this.individualTypes) {
        if (!types.has(classIri)) continue;

        let diffCount = 0;
        for (const nom of nominalArr) {
          if (this.isDifferent(ind, nom)) diffCount++;
        }

        if (diffCount === nominalArr.length) {
          conflicts.push({
            type: "ObjectOneOf",
            classIri,
            individualIris: nominalArr,
            sourceLang: "inferred",
          });
          conflicts.push({
            type: "ClassAssertion",
            classIri,
            individualIri: ind,
            sourceLang: "inferred",
          });
        }
      }
    }

    if (conflicts.length > 0) {
      return {
        isConsistent: false,
        conflictingAxioms: conflicts,
        explanation: `Found ${conflicts.length} consistency violation(s) in the ontology.`,
      };
    }

    return { isConsistent: true };
  }

  private buildJustification(subIri: string, superIri: string): OWL2Axiom[] {
    const visited = new Set<string>();
    const queue: { iri: string; trail: OWL2Axiom[] }[] = [{ iri: subIri, trail: [] }];

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const { iri, trail } = item;
      if (iri === superIri) return trail;
      if (visited.has(iri)) continue;
      visited.add(iri);

      const node = this.classes.get(iri);
      if (!node) continue;

      for (const supIri of node.superClasses) {
        const axiom: OWL2Axiom = {
          type: "SubClassOf",
          subClassIri: iri,
          superClassIri: supIri,
          sourceLang: "asserted",
        };
        queue.push({ iri: supIri, trail: [...trail, axiom] });
      }

      for (const eqIri of node.equivalents) {
        const axiom: OWL2Axiom = {
          type: "EquivalentClasses",
          classIris: [iri, eqIri],
          sourceLang: "asserted",
        };
        queue.push({ iri: eqIri, trail: [...trail, axiom] });
      }
    }

    return [];
  }

  private ensureClass(iri: string): ClassNode {
    let node = this.classes.get(iri);
    if (!node) {
      node = {
        superClasses: new Set(),
        subClasses: new Set(),
        equivalents: new Set(),
        allSuperClasses: null,
        allSubClasses: null,
      };
      this.classes.set(iri, node);
    }
    return node;
  }

  validateShacl(shapes: readonly SHACLNodeShape[]): readonly SHACLViolation[] {
    if (!this._classified) this.classify();
    const violations: SHACLViolation[] = [];

    const evaluatePropertyShape = (
      focusNode: string,
      ps: SHACLPropertyShape,
      values: readonly string[],
      numericVals: readonly number[],
      nodeViolations: SHACLViolation[],
      recordViolations: boolean,
    ): boolean => {
      let valid = true;
      const count = values.length;

      // minCount
      if (ps.minCount !== undefined && count < ps.minCount) {
        valid = false;
        if (recordViolations) {
          nodeViolations.push({
            focusNode,
            resultPath: ps.path,
            message: `Node ${focusNode} has ${count} value(s) for property ${ps.path}, but minCount is ${ps.minCount}.`,
            constraintComponent: "sh:MinCountConstraintComponent",
            severity: "Violation",
          });
        }
      }

      // maxCount
      if (ps.maxCount !== undefined && count > ps.maxCount) {
        valid = false;
        if (recordViolations) {
          nodeViolations.push({
            focusNode,
            resultPath: ps.path,
            message: `Node ${focusNode} has ${count} value(s) for property ${ps.path}, but maxCount is ${ps.maxCount}.`,
            constraintComponent: "sh:MaxCountConstraintComponent",
            severity: "Violation",
          });
        }
      }

      // hasValue
      if (ps.hasValue !== undefined) {
        const found = values.some((v) => String(v) === ps.hasValue);
        if (!found) {
          valid = false;
          if (recordViolations) {
            nodeViolations.push({
              focusNode,
              resultPath: ps.path,
              message: `Node ${focusNode} does not have required value ${ps.hasValue} for property ${ps.path}.`,
              constraintComponent: "sh:HasValueConstraintComponent",
              severity: "Violation",
            });
          }
        }
      }

      // in
      if (ps.in && ps.in.length > 0) {
        const inSet = new Set(ps.in);
        for (const v of values) {
          if (!inSet.has(String(v))) {
            valid = false;
            if (recordViolations) {
              nodeViolations.push({
                focusNode,
                resultPath: ps.path,
                message: `Value ${String(v)} on ${focusNode} is not in allowed set: [${ps.in.join(", ")}].`,
                constraintComponent: "sh:InConstraintComponent",
                severity: "Violation",
              });
            }
          }
        }
      }

      // pattern
      if (ps.pattern) {
        const regex = new RegExp(ps.pattern);
        for (const v of values) {
          if (!regex.test(String(v))) {
            valid = false;
            if (recordViolations) {
              nodeViolations.push({
                focusNode,
                resultPath: ps.path,
                message: `Value ${String(v)} on ${focusNode} does not match regex pattern "${ps.pattern}".`,
                constraintComponent: "sh:PatternConstraintComponent",
                severity: "Violation",
              });
            }
          }
        }
      }

      // class
      if (ps.class) {
        for (const v of values) {
          const strVal = String(v);
          const types = this.individualTypes.get(strVal);
          const isInstance = types?.has(ps.class) || false;
          if (!isInstance) {
            valid = false;
            if (recordViolations) {
              nodeViolations.push({
                focusNode,
                resultPath: ps.path,
                message: `Object ${strVal} on ${focusNode} is not an instance of class ${ps.class}.`,
                constraintComponent: "sh:ClassConstraintComponent",
                severity: "Violation",
              });
            }
          }
        }
      }

      // Numeric boundary constraints
      for (const num of numericVals) {
        if (ps.minInclusive !== undefined && num < ps.minInclusive) {
          valid = false;
          if (recordViolations) {
            nodeViolations.push({
              focusNode,
              resultPath: ps.path,
              message: `Value ${num} on ${focusNode} violates minInclusive ${ps.minInclusive}.`,
              constraintComponent: "sh:MinInclusiveConstraintComponent",
              severity: "Violation",
            });
          }
        }
        if (ps.maxInclusive !== undefined && num > ps.maxInclusive) {
          valid = false;
          if (recordViolations) {
            nodeViolations.push({
              focusNode,
              resultPath: ps.path,
              message: `Value ${num} on ${focusNode} violates maxInclusive ${ps.maxInclusive}.`,
              constraintComponent: "sh:MaxInclusiveConstraintComponent",
              severity: "Violation",
            });
          }
        }
        if (ps.minExclusive !== undefined && num <= ps.minExclusive) {
          valid = false;
          if (recordViolations) {
            nodeViolations.push({
              focusNode,
              resultPath: ps.path,
              message: `Value ${num} on ${focusNode} violates minExclusive ${ps.minExclusive}.`,
              constraintComponent: "sh:MinExclusiveConstraintComponent",
              severity: "Violation",
            });
          }
        }
        if (ps.maxExclusive !== undefined && num >= ps.maxExclusive) {
          valid = false;
          if (recordViolations) {
            nodeViolations.push({
              focusNode,
              resultPath: ps.path,
              message: `Value ${num} on ${focusNode} violates maxExclusive ${ps.maxExclusive}.`,
              constraintComponent: "sh:MaxExclusiveConstraintComponent",
              severity: "Violation",
            });
          }
        }
      }

      // Property comparisons (lessThan, lessThanOrEquals)
      if (ps.lessThan) {
        const otherVals = this.getPropertyValues(focusNode, ps.lessThan);
        const otherNums = otherVals.map(Number).filter((n) => !isNaN(n));
        for (const num of numericVals) {
          for (const otherNum of otherNums) {
            if (num >= otherNum) {
              valid = false;
              if (recordViolations) {
                nodeViolations.push({
                  focusNode,
                  resultPath: ps.path,
                  message: `Value ${num} for ${ps.path} is not strictly less than value ${otherNum} for ${ps.lessThan}.`,
                  constraintComponent: "sh:LessThanConstraintComponent",
                  severity: "Violation",
                });
              }
            }
          }
        }
      }

      if (ps.lessThanOrEquals) {
        const otherVals = this.getPropertyValues(focusNode, ps.lessThanOrEquals);
        const otherNums = otherVals.map(Number).filter((n) => !isNaN(n));
        for (const num of numericVals) {
          for (const otherNum of otherNums) {
            if (num > otherNum) {
              valid = false;
              if (recordViolations) {
                nodeViolations.push({
                  focusNode,
                  resultPath: ps.path,
                  message: `Value ${num} for ${ps.path} exceeds value ${otherNum} for ${ps.lessThanOrEquals}.`,
                  constraintComponent: "sh:LessThanOrEqualsConstraintComponent",
                  severity: "Violation",
                });
              }
            }
          }
        }
      }

      // Logical: or
      if (ps.or && ps.or.length > 0) {
        const anyPass = ps.or.some((subPs) => {
          const subVals = subPs.path ? this.getPropertyValues(focusNode, subPs.path) : values;
          const subNums = subVals.map(Number).filter((n) => !isNaN(n));
          return evaluatePropertyShape(focusNode, subPs, subVals, subNums, [], false);
        });
        if (!anyPass) {
          valid = false;
          if (recordViolations) {
            nodeViolations.push({
              focusNode,
              resultPath: ps.path,
              message: `Node ${focusNode} does not satisfy any disjunct in sh:or constraint on ${ps.path}.`,
              constraintComponent: "sh:OrConstraintComponent",
              severity: "Violation",
            });
          }
        }
      }

      // Logical: and
      if (ps.and && ps.and.length > 0) {
        for (const subPs of ps.and) {
          const subVals = subPs.path ? this.getPropertyValues(focusNode, subPs.path) : values;
          const subNums = subVals.map(Number).filter((n) => !isNaN(n));
          const pass = evaluatePropertyShape(focusNode, subPs, subVals, subNums, nodeViolations, recordViolations);
          if (!pass) valid = false;
        }
      }

      // Logical: not
      if (ps.not) {
        const subVals = ps.not.path ? this.getPropertyValues(focusNode, ps.not.path) : values;
        const subNums = subVals.map(Number).filter((n) => !isNaN(n));
        const passedSub = evaluatePropertyShape(focusNode, ps.not, subVals, subNums, [], false);
        if (passedSub) {
          valid = false;
          if (recordViolations) {
            nodeViolations.push({
              focusNode,
              resultPath: ps.path,
              message: `Node ${focusNode} satisfied forbidden constraint in sh:not on ${ps.path}.`,
              constraintComponent: "sh:NotConstraintComponent",
              severity: "Violation",
            });
          }
        }
      }

      // Logical: xone
      if (ps.xone && ps.xone.length > 0) {
        let passCount = 0;
        for (const subPs of ps.xone) {
          const subVals = subPs.path ? this.getPropertyValues(focusNode, subPs.path) : values;
          const subNums = subVals.map(Number).filter((n) => !isNaN(n));
          if (evaluatePropertyShape(focusNode, subPs, subVals, subNums, [], false)) {
            passCount++;
          }
        }
        if (passCount !== 1) {
          valid = false;
          if (recordViolations) {
            nodeViolations.push({
              focusNode,
              resultPath: ps.path,
              message: `Node ${focusNode} matched ${passCount} shapes in sh:xone on ${ps.path} (expected exactly 1).`,
              constraintComponent: "sh:XoneConstraintComponent",
              severity: "Violation",
            });
          }
        }
      }

      // Query / SPARQL constraint
      if (ps.sparql) {
        const query = ps.sparql.select ?? ps.sparql.ask;
        if (query) {
          const boundPatterns = query.patterns.map((p) => ({
            subject: p.subject === "?this" ? focusNode : p.subject,
            predicate: p.predicate,
            object: p.object === "?this" ? focusNode : p.object,
          }));
          const queryRes = this.queryBgp({ patterns: boundPatterns });
          const hasMatches = queryRes.bindings.length > 0;
          const expectEmpty = ps.sparql.expectEmpty ?? false;

          if (expectEmpty && hasMatches) {
            valid = false;
            if (recordViolations) {
              nodeViolations.push({
                focusNode,
                resultPath: ps.path,
                message: ps.sparql.message ?? `SPARQL graph query matched forbidden pattern on ${focusNode}.`,
                constraintComponent: "sh:SPARQLConstraintComponent",
                severity: "Violation",
              });
            }
          } else if (!expectEmpty && !hasMatches) {
            valid = false;
            if (recordViolations) {
              nodeViolations.push({
                focusNode,
                resultPath: ps.path,
                message: ps.sparql.message ?? `SPARQL graph query failed to match required pattern on ${focusNode}.`,
                constraintComponent: "sh:SPARQLConstraintComponent",
                severity: "Violation",
              });
            }
          }
        }
      }

      return valid;
    };

    for (const shape of shapes) {
      const targetClassNode = this.classes.get(shape.targetClass);
      const targetClasses = new Set<string>([shape.targetClass]);
      if (targetClassNode?.allSubClasses) {
        for (const sub of targetClassNode.allSubClasses) targetClasses.add(sub);
      }

      const focusNodes: string[] = [];
      for (const [indIri, types] of this.individualTypes) {
        let match = false;
        for (const tc of targetClasses) {
          if (types.has(tc)) {
            match = true;
            break;
          }
        }
        if (match) focusNodes.push(indIri);
      }

      for (const focusNode of focusNodes) {
        if (shape.closed) {
          const allowedPaths = new Set(shape.propertyShapes.map((ps) => ps.path));
          allowedPaths.add("rdf:type");
          for (const [propIri, edges] of this.objectPropertyAssertions) {
            if (edges.some((e) => e.subjectIri === focusNode) && !allowedPaths.has(propIri)) {
              violations.push({
                focusNode,
                resultPath: propIri,
                message: `Node ${focusNode} has unallowed property ${propIri} on closed shape.`,
                constraintComponent: "sh:ClosedConstraintComponent",
                severity: "Violation",
              });
            }
          }
          for (const [propIri, assertions] of this.dataPropertyAssertions) {
            if (assertions.some((a) => a.subjectIri === focusNode) && !allowedPaths.has(propIri)) {
              violations.push({
                focusNode,
                resultPath: propIri,
                message: `Node ${focusNode} has unallowed data property ${propIri} on closed shape.`,
                constraintComponent: "sh:ClosedConstraintComponent",
                severity: "Violation",
              });
            }
          }
        }

        for (const ps of shape.propertyShapes) {
          const values = this.getPropertyValues(focusNode, ps.path);
          const numericVals = values.map(Number).filter((n) => !isNaN(n));
          evaluatePropertyShape(focusNode, ps, values, numericVals, violations, true);
        }
      }
    }

    return violations;
  }

  executeShaclRules(
    shapes: readonly SHACLNodeShape[],
    maxPasses = 10,
  ): { materializedAxioms: OWL2Axiom[]; passes: number } {
    const materializedAxioms: OWL2Axiom[] = [];
    let passes = 0;
    let changed = true;

    while (changed && passes < maxPasses) {
      changed = false;
      passes++;

      for (const shape of shapes) {
        if (!shape.rules || shape.rules.length === 0) continue;

        const targetClasses = new Set<string>([shape.targetClass]);
        const node = this.classes.get(shape.targetClass);
        if (node?.allSubClasses) {
          for (const sub of node.allSubClasses) targetClasses.add(sub);
        }

        const focusNodes: string[] = [];
        for (const [indIri, types] of this.individualTypes) {
          if ([...targetClasses].some((tc) => types.has(tc))) {
            focusNodes.push(indIri);
          }
        }

        for (const focusNode of focusNodes) {
          for (const rule of shape.rules) {
            if ("type" in rule && rule.type === "SparqlRule") {
              const boundWhere = rule.wherePatterns.map((p) => ({
                subject: p.subject === "?this" ? focusNode : p.subject,
                predicate: p.predicate,
                object: p.object === "?this" ? focusNode : p.object,
              }));
              const qRes = this.queryBgp({ patterns: boundWhere });
              for (const b of qRes.bindings) {
                for (const cp of rule.constructPatterns) {
                  const s = cp.subject === "?this" ? focusNode : (b[cp.subject] ?? cp.subject);
                  const p = b[cp.predicate] ?? cp.predicate;
                  const o = cp.object === "?this" ? focusNode : (b[cp.object] ?? cp.object);

                  if (p === "rdf:type") {
                    const types = this.individualTypes.get(s) ?? new Set();
                    if (!types.has(o)) {
                      types.add(o);
                      this.individualTypes.set(s, types);
                      const ax: OWL2Axiom = {
                        type: "ClassAssertion",
                        individualIri: s,
                        classIri: o,
                        sourceLang: "inferred",
                      };
                      materializedAxioms.push(ax);
                      this._axioms.push(ax);
                      changed = true;
                    }
                  } else {
                    const edges = this.objectPropertyAssertions.get(p) ?? [];
                    if (!edges.some((e) => e.subjectIri === s && e.objectIri === o)) {
                      edges.push({ subjectIri: s, objectIri: o });
                      this.objectPropertyAssertions.set(p, edges);
                      const ax: OWL2Axiom = {
                        type: "ObjectPropertyAssertion",
                        propertyIri: p,
                        subjectIri: s,
                        objectIri: o,
                        sourceLang: "inferred",
                      };
                      materializedAxioms.push(ax);
                      this._axioms.push(ax);
                      changed = true;
                    }
                  }
                }
              }
            } else {
              const tr = rule as SHACLTripleRule;
              let matchesCondition = true;
              if (tr.condition) {
                const values = this.getPropertyValues(focusNode, tr.condition.path);
                const numVals = values.map(Number).filter((n) => !isNaN(n));
                if (tr.condition.minCount !== undefined && values.length < tr.condition.minCount)
                  matchesCondition = false;
                if (tr.condition.maxCount !== undefined && values.length > tr.condition.maxCount)
                  matchesCondition = false;
                if (
                  tr.condition.class !== undefined &&
                  !values.some((v) => this.individualTypes.get(v)?.has(tr.condition!.class!))
                )
                  matchesCondition = false;
                if (tr.condition.minInclusive !== undefined && !numVals.some((n) => n >= tr.condition!.minInclusive!))
                  matchesCondition = false;
                if (tr.condition.maxInclusive !== undefined && !numVals.some((n) => n <= tr.condition!.maxInclusive!))
                  matchesCondition = false;
              }

              if (matchesCondition) {
                const s = !tr.subject || tr.subject === "?this" || tr.subject === "sh:this" ? focusNode : tr.subject;
                const p = tr.predicate;
                const o = tr.object;

                if (p === "rdf:type") {
                  const types = this.individualTypes.get(s) ?? new Set();
                  if (!types.has(o)) {
                    types.add(o);
                    this.individualTypes.set(s, types);
                    const ax: OWL2Axiom = {
                      type: "ClassAssertion",
                      individualIri: s,
                      classIri: o,
                      sourceLang: "inferred",
                    };
                    materializedAxioms.push(ax);
                    this._axioms.push(ax);
                    changed = true;
                  }
                } else if (
                  this.objectProperties.has(p) ||
                  (isNaN(Number(o)) && (this.classes.has(o) || this.individualTypes.has(o)))
                ) {
                  const edges = this.objectPropertyAssertions.get(p) ?? [];
                  if (!edges.some((e) => e.subjectIri === s && e.objectIri === o)) {
                    edges.push({ subjectIri: s, objectIri: o });
                    this.objectPropertyAssertions.set(p, edges);
                    const ax: OWL2Axiom = {
                      type: "ObjectPropertyAssertion",
                      propertyIri: p,
                      subjectIri: s,
                      objectIri: o,
                      sourceLang: "inferred",
                    };
                    materializedAxioms.push(ax);
                    this._axioms.push(ax);
                    changed = true;
                  }
                } else {
                  const list = this.dataPropertyAssertions.get(p) ?? [];
                  if (!list.some((a) => a.subjectIri === s && a.value === String(o))) {
                    list.push({ subjectIri: s, value: String(o) });
                    this.dataPropertyAssertions.set(p, list);
                    const ax: OWL2Axiom = {
                      type: "DataPropertyAssertion",
                      propertyIri: p,
                      subjectIri: s,
                      value: String(o),
                      sourceLang: "inferred",
                    };
                    materializedAxioms.push(ax);
                    this._axioms.push(ax);
                    changed = true;
                  }
                }
              }
            }
          }
        }
      }
    }

    return { materializedAxioms, passes };
  }

  private getPropertyValues(focusNode: string, path: string): string[] {
    const res: string[] = [];
    if (path === "rdf:type") {
      const types = this.individualTypes.get(focusNode);
      if (types) res.push(...types);
      return res;
    }
    const objEdges = this.objectPropertyAssertions.get(path);
    if (objEdges) {
      for (const e of objEdges) {
        if (e.subjectIri === focusNode) res.push(e.objectIri);
      }
    }
    const dataAsserts = this.dataPropertyAssertions.get(path);
    if (dataAsserts) {
      for (const a of dataAsserts) {
        if (a.subjectIri === focusNode) res.push(a.value);
      }
    }
    return res;
  }

  /**
   * Extract minimal syntactic bot-locality module M for a given seed signature.
   * Guarantees: M |= alpha <=> O |= alpha for any axiom alpha over seedSignature.
   */
  extractBotLocalityModule(seedSignature: ReadonlySet<string>): OWL2Axiom[] {
    const currentSig = new Set<string>(seedSignature);
    const module = new Set<OWL2Axiom>();
    let changed = true;

    while (changed) {
      changed = false;
      for (const axiom of this._axioms) {
        if (module.has(axiom)) continue;
        if (!this.isAxiomBotLocal(axiom, currentSig)) {
          module.add(axiom);
          for (const s of this.getAxiomSignature(axiom)) {
            currentSig.add(s);
          }
          changed = true;
        }
      }
    }

    return Array.from(module);
  }

  private isAxiomBotLocal(axiom: OWL2Axiom, sig: ReadonlySet<string>): boolean {
    switch (axiom.type) {
      case "ClassDeclaration":
      case "ObjectPropertyDeclaration":
      case "DataPropertyDeclaration":
      case "IndividualDeclaration":
        return sig.has(axiom.iri);
      case "SubClassOf":
        return !sig.has(axiom.subClassIri);
      case "EquivalentClasses":
        return axiom.classIris.every((c) => !sig.has(c));
      case "DisjointClasses":
        return axiom.classIris.filter((c) => sig.has(c)).length <= 1;
      case "ClassAssertion":
        return !sig.has(axiom.individualIri) && !sig.has(axiom.classIri);
      case "ObjectPropertyAssertion":
        return !sig.has(axiom.subjectIri) && !sig.has(axiom.objectIri);
      case "DataPropertyAssertion":
        return !sig.has(axiom.subjectIri);
      case "SubPropertyChainOf":
        return !axiom.subPropertyChain.some((p) => sig.has(p));
      case "QualifiedCardinality":
        return !sig.has(axiom.classIri);
      case "LinearConstraint":
        return !sig.has(axiom.subjectIri);
      case "NominalClass":
      case "ObjectOneOf":
        return !sig.has(axiom.classIri);
      case "DifferentIndividuals":
        return axiom.individualIris.filter((ind) => sig.has(ind)).length <= 1;
      case "SwrlRule":
        return !axiom.body.some((a) => {
          if ("classIri" in a) return sig.has(a.classIri);
          if ("propertyIri" in a) return sig.has(a.propertyIri);
          return false;
        });
      default:
        return false;
    }
  }

  private getAxiomSignature(axiom: OWL2Axiom): string[] {
    const s = new Set<string>();
    switch (axiom.type) {
      case "ClassDeclaration":
      case "ObjectPropertyDeclaration":
      case "DataPropertyDeclaration":
      case "IndividualDeclaration":
        s.add(axiom.iri);
        break;
      case "SubClassOf":
        s.add(axiom.subClassIri);
        s.add(axiom.superClassIri);
        break;
      case "EquivalentClasses":
      case "DisjointClasses":
        for (const c of axiom.classIris) s.add(c);
        break;
      case "ClassAssertion":
        s.add(axiom.individualIri);
        s.add(axiom.classIri);
        break;
      case "ObjectPropertyAssertion":
        s.add(axiom.subjectIri);
        s.add(axiom.propertyIri);
        s.add(axiom.objectIri);
        break;
      case "DataPropertyAssertion":
        s.add(axiom.subjectIri);
        s.add(axiom.propertyIri);
        break;
      case "SubPropertyChainOf":
        s.add(axiom.superPropertyIri);
        for (const p of axiom.subPropertyChain) s.add(p);
        break;
      case "QualifiedCardinality":
        s.add(axiom.classIri);
        s.add(axiom.propertyIri);
        if (axiom.fillerClassIri) s.add(axiom.fillerClassIri);
        break;
      case "LinearConstraint":
        s.add(axiom.subjectIri);
        for (const t of axiom.terms) s.add(t.propertyIri);
        break;
      case "NominalClass":
      case "ObjectOneOf":
        s.add(axiom.classIri);
        for (const ind of axiom.individualIris) s.add(ind);
        break;
      case "DifferentIndividuals":
        for (const ind of axiom.individualIris) s.add(ind);
        break;
      case "SwrlRule":
        for (const a of [...axiom.body, ...axiom.head]) {
          if ("classIri" in a) s.add(a.classIri);
          if ("propertyIri" in a) s.add(a.propertyIri);
        }
        break;
    }
    return Array.from(s);
  }

  private clear(): void {
    this._axioms = [];
    this.classes.clear();
    this.disjointPairs.clear();
    this.objectProperties.clear();
    this.dataProperties.clear();
    this.transitiveProperties.clear();
    this.functionalObjectProperties.clear();
    this.functionalDataProperties.clear();
    this.asymmetricProperties.clear();
    this.irreflexiveProperties.clear();
    this.disjointPropertyPairs.clear();
    this.rawDataPropertyAssertions = [];
    this.subPropertyChains = [];
    this.qualifiedCardinalities = [];
    this.linearConstraints = [];
    this.objectOneOfMap.clear();
    this.differentIndividualPairs.clear();
    this.swrlRules = [];
    this.sameIndividualGroups.clear();
    this.individualTypes.clear();
    this.objectPropertyAssertions.clear();
    this.dataPropertyAssertions.clear();
    this._classified = false;
  }
}

// ---------------------------------------------------------------------------
// Backward-compatibility alias
// ---------------------------------------------------------------------------
export { WasmOntologyReasoner as TableauReasoner };

// ---------------------------------------------------------------------------
// Ontology Builder (debouncing, events, re-classification)
// ---------------------------------------------------------------------------

export class OntologyBuilder {
  private reasoner: IOWLReasoner;
  private store: IOWL2OntologyStore;
  private listeners: OntologyEventListener[] = [];

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDelta: OWL2AxiomDelta | null = null;
  private debounceMs: number;
  private autoClassify: boolean;

  constructor(
    reasoner: IOWLReasoner,
    store: IOWL2OntologyStore,
    options?: {
      debounceMs?: number;
      autoClassify?: boolean;
    },
  ) {
    this.reasoner = reasoner;
    this.store = store;
    this.debounceMs = options?.debounceMs ?? 300;
    this.autoClassify = options?.autoClassify ?? true;
  }

  get backend(): IOWLReasoner {
    return this.reasoner;
  }

  async initialize(): Promise<void> {
    await this.reasoner.init();
    this.emit({ type: "status-changed", status: this.reasoner.status });

    if (this.store.size > 0) {
      this.loadFromStore();
    }
  }

  loadFromStore(): void {
    const axioms = this.store.axioms;
    this.reasoner.loadOntology(axioms);
    this.emit({ type: "status-changed", status: this.reasoner.status });

    if (this.autoClassify && axioms.length > 0) {
      this.classifyAndEmit();
    }
  }

  applyDelta(delta: OWL2AxiomDelta): void {
    if (delta.retractions.length === 0 && delta.assertions.length === 0) return;

    if (this.debounceMs <= 0) {
      this.applyDeltaImmediate(delta);
      return;
    }

    if (this.pendingDelta) {
      this.pendingDelta = {
        retractions: [...this.pendingDelta.retractions, ...delta.retractions],
        assertions: [...this.pendingDelta.assertions, ...delta.assertions],
      };
    } else {
      this.pendingDelta = delta;
    }

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.flushPendingDelta();
    }, this.debounceMs);
  }

  flush(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.flushPendingDelta();
  }

  classifyAndCheck(): ConsistencyResult {
    this.classifyAndEmit();
    const result = this.reasoner.checkConsistency();
    this.emit({ type: "consistency-result", result });
    return result;
  }

  getTaxonomy(): TaxonomyNode[] {
    return this.reasoner.getTaxonomy();
  }

  on(listener: OntologyEventListener): void {
    this.listeners.push(listener);
  }

  off(listener: OntologyEventListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }

  dispose(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingDelta = null;
    this.reasoner.dispose();
    this.listeners = [];
  }

  private applyDeltaImmediate(delta: OWL2AxiomDelta): void {
    try {
      this.reasoner.applyDelta(delta);
      this.emit({ type: "delta-applied", delta });

      if (this.autoClassify) {
        this.classifyAndEmit();
      }
    } catch (e) {
      this.emit({ type: "error", error: e instanceof Error ? e : new Error(String(e)) });
    }
  }

  private flushPendingDelta(): void {
    if (this.pendingDelta) {
      const delta = this.pendingDelta;
      this.pendingDelta = null;
      this.applyDeltaImmediate(delta);
    }
  }

  private classifyAndEmit(): void {
    const start = performance.now();
    this.reasoner.classify();
    const timeMs = performance.now() - start;
    this.emit({
      type: "classified",
      axiomCount: this.reasoner.axiomCount,
      timeMs,
    });
    this.emit({ type: "status-changed", status: this.reasoner.status });
  }

  private emit(event: OntologyEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Suppress listener errors
      }
    }
  }
}

// ---------------------------------------------------------------------------
// WASM-Backed Ontology Store
// ---------------------------------------------------------------------------

export function axiomToTypeAndIris(axiom: OWL2Axiom): {
  type: number;
  sIri: string;
  pIri: string;
  oIri: string;
  flags?: number;
  extra?: number;
} | null {
  switch (axiom.type) {
    case "ClassDeclaration":
      return { type: AXIOM_CLASS_DECL, sIri: axiom.iri, pIri: "", oIri: "" };
    case "SubClassOf":
      return { type: AXIOM_SUBCLASS_OF, sIri: axiom.subClassIri, pIri: "", oIri: axiom.superClassIri };
    case "EquivalentClasses":
      if (axiom.classIris.length >= 2) {
        return { type: AXIOM_EQUIV_CLASS, sIri: axiom.classIris[0]!, pIri: "", oIri: axiom.classIris[1]! };
      }
      return null;
    case "DisjointClasses":
      if (axiom.classIris.length >= 2) {
        return { type: AXIOM_DISJOINT_CLASSES, sIri: axiom.classIris[0]!, pIri: "", oIri: axiom.classIris[1]! };
      }
      return null;
    case "ObjectPropertyDeclaration":
      return { type: AXIOM_OBJ_PROP_DECL, sIri: axiom.iri, pIri: "", oIri: "" };
    case "DataPropertyDeclaration":
      return { type: AXIOM_DATA_PROP_DECL, sIri: axiom.iri, pIri: "", oIri: "" };
    case "ObjectPropertyAssertion":
      return { type: AXIOM_OBJ_PROP_ASSERT, sIri: axiom.subjectIri, pIri: axiom.propertyIri, oIri: axiom.objectIri };
    case "DataPropertyAssertion":
      return {
        type: AXIOM_DATA_PROP_ASSERT,
        sIri: axiom.subjectIri,
        pIri: axiom.propertyIri,
        oIri: String(axiom.value),
      };
    case "TransitiveObjectProperty":
      return { type: AXIOM_TRANSITIVE_PROP, sIri: axiom.propertyIri, pIri: "", oIri: "" };
    case "IndividualDeclaration":
      return { type: AXIOM_INDIVIDUAL_DECL, sIri: axiom.iri, pIri: "", oIri: "" };
    case "ClassAssertion":
      return { type: AXIOM_CLASS_ASSERT, sIri: axiom.individualIri, pIri: "", oIri: axiom.classIri };
    case "ObjectSomeValuesFrom":
      return {
        type: AXIOM_OBJECT_SOME_VALUES_FROM,
        sIri: "owl:Thing",
        pIri: axiom.propertyIri,
        oIri: axiom.fillerClassIri,
      };
    case "FunctionalObjectProperty":
      return { type: AXIOM_FUNCTIONAL_OBJ_PROP, sIri: axiom.propertyIri, pIri: "", oIri: "" };
    case "FunctionalDataProperty":
      return { type: AXIOM_FUNCTIONAL_DATA_PROP, sIri: axiom.propertyIri, pIri: "", oIri: "" };
    case "SameIndividual":
      if (axiom.individualIris.length >= 2) {
        return {
          type: AXIOM_SAME_INDIVIDUAL,
          sIri: axiom.individualIris[0]!,
          pIri: "",
          oIri: axiom.individualIris[1]!,
        };
      }
      return null;
    case "UniversalRestriction":
      return {
        type: AXIOM_UNIVERSAL_RESTRICTION,
        sIri: axiom.classIri || "owl:Thing",
        pIri: axiom.propertyIri,
        oIri: axiom.targetClassIri,
      };
    case "DisjunctiveClass":
      return {
        type: AXIOM_DISJUNCTIVE_CLASS,
        sIri: axiom.superClassIri || "",
        pIri: "",
        oIri: axiom.classIris[0] || "",
      };
    case "SymmetricObjectProperty":
      return { type: AXIOM_SYMMETRIC_PROP, sIri: axiom.propertyIri, pIri: "", oIri: "" };
    case "InverseObjectProperty":
      return { type: AXIOM_INVERSE_PROP, sIri: axiom.propertyIri, pIri: "", oIri: axiom.inversePropertyIri };
    case "AsymmetricObjectProperty":
      return { type: AXIOM_ASYMMETRIC_PROP, sIri: axiom.propertyIri, pIri: "", oIri: "" };
    case "IrreflexiveObjectProperty":
      return { type: AXIOM_IRREFLEXIVE_PROP, sIri: axiom.propertyIri, pIri: "", oIri: "" };
    case "DisjointObjectProperties":
      if (axiom.propertyIris.length >= 2) {
        return { type: AXIOM_DISJOINT_PROPS, sIri: axiom.propertyIris[0]!, pIri: "", oIri: axiom.propertyIris[1]! };
      }
      return null;
    default:
      return null;
  }
}

export class WasmOntologyStore implements IOWL2OntologyStore {
  private _revision = 0;
  private _axioms: OWL2Axiom[] = [];
  private _axiomsBySource = new Map<string, OWL2Axiom[]>();
  private _projectedVersions = new Map<string, number>();
  private _lastDelta: OWL2AxiomDelta = { retractions: [], assertions: [] };
  private _sourceLanguages: string[] = [];
  private _wasmInstance: WasmOntologyInstance | null = null;
  private _workspace: any = null;
  private _pureWasmMode = false;
  private _entityIriMap = new Map<number, string>();
  private _iriEntityMap = new Map<string, number>();

  constructor(wasmInstance?: WasmOntologyInstance | null, workspace?: any) {
    this._wasmInstance = wasmInstance ?? null;
    this._workspace = workspace ?? null;
  }

  public setWorkspace(workspace: any): void {
    this._workspace = workspace;
  }

  public get workspace(): any {
    return this._workspace;
  }

  public setWasmInstance(wasmInstance: WasmOntologyInstance): void {
    this._wasmInstance = wasmInstance;
  }

  public get wasmInstance(): WasmOntologyInstance | null {
    return this._wasmInstance;
  }

  public setPureWasmMode(enabled: boolean): void {
    this._pureWasmMode = enabled;
  }

  public get isPureWasmMode(): boolean {
    return this._pureWasmMode;
  }

  public internIri(iri: string): number {
    if (!iri) return 0;
    const existing = this._iriEntityMap.get(iri);
    if (existing !== undefined) return existing;

    const { lo, hi } = hashIri64(iri);
    let id: number;
    if (this._wasmInstance?.ontology_getOrCreateEntity) {
      id = this._wasmInstance.ontology_getOrCreateEntity(lo, hi);
    } else {
      id = this._iriEntityMap.size + 1;
    }
    this._iriEntityMap.set(iri, id);
    this._entityIriMap.set(id, iri);
    return id;
  }

  public getIri(entityId: number): string | undefined {
    return this._entityIriMap.get(entityId);
  }

  public internStringWasm(str: string): number {
    if (!this._wasmInstance?.ontology_internString || !this._wasmInstance.memory) return 0;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const { lo, hi } = hashIri64(str);
    let ptr = 0;
    if (this._wasmInstance.alloc) {
      ptr = this._wasmInstance.alloc(bytes.length);
    } else {
      ptr = this._wasmInstance.ontology_getQueryBuffer ? this._wasmInstance.ontology_getQueryBuffer() : 1024;
    }
    const mem8 = new Uint8Array(this._wasmInstance.memory.buffer);
    mem8.set(bytes, ptr);
    const id = this._wasmInstance.ontology_internString(ptr, bytes.length, lo, hi);
    if (this._wasmInstance.alloc && this._wasmInstance.free) {
      this._wasmInstance.free(ptr);
    }
    return id;
  }

  public extractStringWasm(id: number): string {
    if (!this._wasmInstance?.ontology_extractString || !this._wasmInstance.memory) return "";
    let ptr = 0;
    const maxLen = 4096;
    if (this._wasmInstance.alloc) {
      ptr = this._wasmInstance.alloc(maxLen);
    } else {
      ptr = this._wasmInstance.ontology_getQueryBuffer ? this._wasmInstance.ontology_getQueryBuffer() : 1024;
    }
    const len = this._wasmInstance.ontology_extractString(id, ptr);
    const mem8 = new Uint8Array(this._wasmInstance.memory.buffer, ptr, len);
    const decoder = new TextDecoder();
    const str = decoder.decode(mem8);
    if (this._wasmInstance.alloc && this._wasmInstance.free) {
      this._wasmInstance.free(ptr);
    }
    return str;
  }

  public getStringCompressionRatio(): number {
    if (!this._wasmInstance?.ontology_getStringCompressionRatio) return 1.0;
    return this._wasmInstance.ontology_getStringCompressionRatio();
  }

  public queryTriplesBitmap(pattern: {
    subject?: string | number;
    predicate?: string | number;
    object?: string | number;
  }): AxiomRecordView[] {
    if (
      !this._wasmInstance?.ontology_queryTriplesBitmap ||
      !this._wasmInstance.memory ||
      !this._wasmInstance.ontology_getQueryBuffer
    ) {
      return [];
    }
    const sId =
      typeof pattern.subject === "string"
        ? pattern.subject
          ? this.internIri(pattern.subject)
          : 0
        : (pattern.subject ?? 0);
    const pId =
      typeof pattern.predicate === "string"
        ? pattern.predicate
          ? this.internIri(pattern.predicate)
          : 0
        : (pattern.predicate ?? 0);
    const oId =
      typeof pattern.object === "string"
        ? pattern.object
          ? this.internIri(pattern.object)
          : 0
        : (pattern.object ?? 0);

    const count = this._wasmInstance.ontology_queryTriplesBitmap(sId, pId, oId);
    const bufPtr = this._wasmInstance.ontology_getQueryBuffer();
    const uint32 = new Uint32Array(this._wasmInstance.memory.buffer, bufPtr, count * 6);
    const results: AxiomRecordView[] = [];
    for (let i = 0; i < count; i++) {
      results.push(new AxiomRecordView(uint32, i * 6));
    }
    return results;
  }

  public getRoaringCardinality(indexType: number, key: string | number): number {
    if (!this._wasmInstance?.ontology_getRoaringCardinality) return 0;
    const entityId = typeof key === "string" ? this.internIri(key) : key;
    return this._wasmInstance.ontology_getRoaringCardinality(indexType, entityId);
  }

  public addAxiomDirect64(
    axiomType: number,
    sourceLangId: number,
    subjectIri: string,
    predicateIri: string = "",
    objectIri: string = "",
    flags: number = 0,
    extra: number = 0,
  ): number {
    const s = hashIri64(subjectIri);
    const p = predicateIri ? hashIri64(predicateIri) : { lo: 0, hi: 0, hash64: 0n };
    const o = objectIri ? hashIri64(objectIri) : { lo: 0, hi: 0, hash64: 0n };

    let axId = 0;
    if (this._wasmInstance?.ontology_addAxiom64) {
      axId = this._wasmInstance.ontology_addAxiom64(
        axiomType,
        sourceLangId,
        s.lo,
        s.hi,
        p.lo,
        p.hi,
        o.lo,
        o.hi,
        flags,
        extra,
      );
    }
    if (!this._pureWasmMode) {
      this.internIri(subjectIri);
      if (predicateIri) this.internIri(predicateIri);
      if (objectIri) this.internIri(objectIri);
    }
    this._revision++;
    return axId;
  }

  get revision(): number {
    return this._revision;
  }

  get axioms(): readonly OWL2Axiom[] {
    return this._axioms;
  }

  get axiomsBySource(): ReadonlyMap<string, readonly OWL2Axiom[]> {
    return this._axiomsBySource;
  }

  get lastDelta(): Readonly<OWL2AxiomDelta> {
    return this._lastDelta;
  }

  get size(): number {
    if (this._wasmInstance?.ontology_getAxiomCount) {
      return this._wasmInstance.ontology_getAxiomCount();
    }
    return this._axioms.length;
  }

  registerSourceLanguage(language: string): void {
    if (!this._sourceLanguages.includes(language)) {
      this._sourceLanguages.push(language);
    }
  }

  addAxioms(sourceLang: string, axioms: OWL2Axiom[]): OWL2AxiomDelta {
    // Forward to WASM instance directly if present
    if (this._wasmInstance?.ontology_addAxiom64) {
      const langId = sourceLang === "modelica" ? 1 : sourceLang === "sysml2" ? 2 : sourceLang === "step" ? 3 : 0;
      for (const ax of axioms) {
        const mapped = axiomToTypeAndIris(ax);
        if (mapped) {
          this.addAxiomDirect64(
            mapped.type,
            langId,
            mapped.sIri,
            mapped.pIri,
            mapped.oIri,
            mapped.flags ?? 0,
            mapped.extra ?? 0,
          );
        }
      }
    }

    if (this._pureWasmMode) {
      this._lastDelta = { retractions: [], assertions: axioms };
      this._revision++;
      return this._lastDelta;
    }

    const previousAxioms = this._axiomsBySource.get(sourceLang) ?? [];
    const updatedAxioms = [...previousAxioms, ...axioms];
    this._axiomsBySource.set(sourceLang, updatedAxioms);

    const allAxioms: OWL2Axiom[] = [];
    for (const langAxioms of this._axiomsBySource.values()) {
      allAxioms.push(...langAxioms);
    }

    const delta = computeDelta(previousAxioms, updatedAxioms);
    this._axioms = allAxioms;
    this._lastDelta = delta;
    this._revision++;
    return delta;
  }

  setAxioms(sourceLang: string, axioms: OWL2Axiom[]): OWL2AxiomDelta {
    const previousAxioms = this._axiomsBySource.get(sourceLang) ?? [];
    this._axiomsBySource.set(sourceLang, axioms);

    const allAxioms: OWL2Axiom[] = [];
    for (const langAxioms of this._axiomsBySource.values()) {
      allAxioms.push(...langAxioms);
    }

    const delta = computeDelta(previousAxioms, axioms);
    this._axioms = allAxioms;
    this._lastDelta = delta;
    this._revision++;
    return delta;
  }

  clearAxioms(sourceLang?: string): void {
    if (sourceLang) {
      this._axiomsBySource.delete(sourceLang);
    } else {
      this._axiomsBySource.clear();
    }
    const allAxioms: OWL2Axiom[] = [];
    for (const langAxioms of this._axiomsBySource.values()) {
      allAxioms.push(...langAxioms);
    }
    this._axioms = allAxioms;
    this._revision++;
  }

  fullProjection(): void {
    if (this._workspace) {
      if (this._sourceLanguages.length === 0) {
        this.registerSourceLanguage("modelica");
        this.registerSourceLanguage("sysml2");
      }
      for (const lang of this._sourceLanguages) {
        this.projectLanguage(lang);
      }
    }
    this._revision++;
  }

  projectLanguage(language: string): OWL2AxiomDelta {
    if (!this._workspace) return { assertions: [], retractions: [] };

    const unified = typeof this._workspace.toUnifiedPartial === "function" ? this._workspace.toUnifiedPartial() : null;
    if (!unified || !unified.symbols) return { assertions: [], retractions: [] };

    const projected: OWL2Axiom[] = [];
    const prefix = language === "sysml2" ? "sysml:" : language === "modelica" ? "mo:" : `${language}:`;

    for (const [id, entry] of unified.symbols.entries()) {
      if (entry.language !== language && (!entry.resourceId || !entry.resourceId.includes(`.${language}`))) {
        continue;
      }

      const iri = `${prefix}${entry.name || `anon_${id}`}`;

      if (language === "sysml2") {
        if (entry.kind === "Definition") {
          projected.push({
            type: "ClassDeclaration",
            iri,
            sourceLang: "sysml2",
            sourceQualifiedName: entry.name || "",
          });
          const children = unified.childrenOf?.get(id) ?? [];
          for (const childId of children) {
            const child = unified.symbols.get(childId);
            if (child) {
              if ((child.ruleName === "OwnedSubsetting" || child.ruleName === "OwnedRedefinition") && child.name) {
                projected.push({
                  type: "SubClassOf",
                  subClassIri: iri,
                  superClassIri: `${prefix}${child.name}`,
                  sourceLang: "sysml2",
                });
              } else if (
                child.kind === "Flow" ||
                child.ruleName === "ItemFlow" ||
                child.ruleName === "FlowConnectionUsage"
              ) {
                const src = (child as any).source || (child as any).from;
                const tgt = (child as any).target || (child as any).to;
                if (src && tgt) {
                  projected.push({
                    type: "ObjectPropertyAssertion",
                    propertyIri: "sysml:flowsTo",
                    subjectIri: `${prefix}${src}`,
                    objectIri: `${prefix}${tgt}`,
                    sourceLang: "sysml2",
                  });
                }
              } else if (child.kind === "Allocation" || child.ruleName === "AllocationUsage") {
                const src = (child as any).source || (child as any).from;
                const tgt = (child as any).target || (child as any).to;
                if (src && tgt) {
                  projected.push({
                    type: "ObjectPropertyAssertion",
                    propertyIri: "sysml:allocatedTo",
                    subjectIri: `${prefix}${src}`,
                    objectIri: `${prefix}${tgt}`,
                    sourceLang: "sysml2",
                  });
                }
              }
            }
          }
        } else if (entry.kind === "Usage") {
          projected.push({
            type: "ClassDeclaration",
            iri,
            sourceLang: "sysml2",
            sourceQualifiedName: entry.name || "",
          });
          if (entry.parentId !== null) {
            const parent = unified.symbols.get(entry.parentId);
            if (parent) {
              projected.push({
                type: "ObjectPropertyAssertion",
                propertyIri: "sysml:hasPart",
                subjectIri: `${prefix}${parent.name}`,
                objectIri: iri,
                sourceLang: "sysml2",
              });
            }
          }
        }
      } else if (language === "modelica") {
        if (
          entry.kind === "Class" ||
          entry.kind === "model" ||
          entry.kind === "block" ||
          entry.kind === "connector" ||
          entry.kind === "record"
        ) {
          projected.push({
            type: "ClassDeclaration",
            iri,
            sourceLang: "modelica",
            sourceQualifiedName: entry.name || "",
          });
          if (Array.isArray(entry.inherits)) {
            for (const sup of entry.inherits) {
              if (sup) {
                projected.push({
                  type: "SubClassOf",
                  subClassIri: iri,
                  superClassIri: `${prefix}${sup}`,
                  sourceLang: "modelica",
                });
              }
            }
          }
          const children = unified.childrenOf?.get(id) ?? [];
          for (const childId of children) {
            const child = unified.symbols.get(childId);
            if (child && (child.kind === "Component" || child.kind === "Variable" || child.kind === "Connector")) {
              const compIri = `${prefix}${entry.name}.${child.name}`;
              projected.push({
                type: "ClassDeclaration",
                iri: compIri,
                sourceLang: "modelica",
              });
              projected.push({
                type: "ObjectPropertyAssertion",
                propertyIri: "mo:hasPart",
                subjectIri: iri,
                objectIri: compIri,
                sourceLang: "modelica",
              });
              const typeName = (child as any).type || (child as any).typeName;
              if (typeName) {
                projected.push({
                  type: "ClassAssertion",
                  individualIri: compIri,
                  classIri: `${prefix}${typeName}`,
                  sourceLang: "modelica",
                });
              }
            } else if (child && (child.kind === "Connect" || child.ruleName === "ConnectEquation")) {
              const lhs = (child as any).lhs || (child as any).left;
              const rhs = (child as any).rhs || (child as any).right;
              if (lhs && rhs) {
                projected.push({
                  type: "ObjectPropertyAssertion",
                  propertyIri: "mo:connectedTo",
                  subjectIri: `${prefix}${lhs}`,
                  objectIri: `${prefix}${rhs}`,
                  sourceLang: "modelica",
                });
              }
            }
          }
        }
      }
    }

    if (language === "modelica") {
      projected.push({
        type: "SymmetricObjectProperty",
        propertyIri: "mo:connectedTo",
        sourceLang: "modelica",
      });
    }

    return this.setAxioms(language, projected);
  }

  projectCadEnvelopes(boxes: readonly CadBoundingBox[]): OWL2AxiomDelta {
    const axioms = projectCadEnvelopes(boxes);
    return this.setAxioms("step", axioms);
  }

  update(workspaceVersions: Map<string, number>): OWL2AxiomDelta | null {
    let changed = false;
    for (const lang of this._sourceLanguages) {
      const currentVersion = workspaceVersions.get(lang);
      if (currentVersion === undefined) continue;

      const lastVersion = this._projectedVersions.get(lang);
      if (lastVersion === undefined || currentVersion !== lastVersion) {
        changed = true;
        this._projectedVersions.set(lang, currentVersion);
      }
    }

    if (!changed) return null;
    return this._lastDelta;
  }

  isSubClassOf(subClassHash: number, superClassHash: number): boolean {
    if (this._wasmInstance?.ontology_isSubClassOf) {
      return this._wasmInstance.ontology_isSubClassOf(subClassHash, superClassHash) !== 0;
    }
    return false;
  }

  checkConsistency(): boolean {
    if (this._wasmInstance?.ontology_checkConsistency) {
      return this._wasmInstance.ontology_checkConsistency() !== 0;
    }
    return true;
  }

  getClassDeclarations(): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "ClassDeclaration");
  }

  getSuperClasses(classIri: string): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "SubClassOf" && a.subClassIri === classIri);
  }

  getSubClasses(classIri: string): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "SubClassOf" && a.superClassIri === classIri);
  }

  getObjectProperties(): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "ObjectPropertyDeclaration");
  }

  getDataProperties(): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "DataPropertyDeclaration");
  }

  getAxiomsForIri(iri: string): OWL2Axiom[] {
    return this._axioms.filter((a) => axiomReferencesIri(a, iri));
  }

  toFunctionalSyntax(): string {
    const lines: string[] = [];
    lines.push("Ontology(<urn:modelscript:unified>");

    for (const axiom of this._axioms) {
      lines.push(`  ${axiomToFSS(axiom)}`);
    }

    lines.push(")");
    return lines.join("\n");
  }

  toSyntheticSymbolEntries(): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, number[]>();
    const childrenOf = new Map<SymbolId | null, number[]>();

    let nextId = -1_000_000;

    for (const axiom of this._axioms) {
      const entry = axiomToSymbolEntry(axiom, nextId);
      if (entry) {
        symbols.set(entry.id, entry);
        const nameIds = byName.get(entry.name);
        if (nameIds) {
          nameIds.push(entry.id);
        } else {
          byName.set(entry.name, [entry.id]);
        }
        nextId--;
      }
    }

    return { symbols, byName, childrenOf };
  }

  clear(): void {
    if (this._wasmInstance?.ontology_clear) {
      this._wasmInstance.ontology_clear();
    }
    this._entityIriMap.clear();
    this._iriEntityMap.clear();
    this._axioms = [];
    this._axiomsBySource.clear();
    this._projectedVersions.clear();
    this._lastDelta = { retractions: [], assertions: [] };
    this._revision++;
  }
}

export { WasmOntologyStore as OWL2OntologyStore };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function axiomEqual(a: OWL2Axiom, b: OWL2Axiom): boolean {
  if (a.type !== b.type) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function computeDelta(previous: readonly OWL2Axiom[], current: readonly OWL2Axiom[]): OWL2AxiomDelta {
  const prevKeys = new Set(previous.map(axiomKey));
  const currKeys = new Set(current.map(axiomKey));

  const retractions = previous.filter((a) => !currKeys.has(axiomKey(a)));
  const assertions = current.filter((a) => !prevKeys.has(axiomKey(a)));

  return { retractions, assertions };
}

export function axiomKey(axiom: OWL2Axiom): string {
  switch (axiom.type) {
    case "ClassDeclaration":
      return `CD:${axiom.iri}`;
    case "SubClassOf":
      return `SCO:${axiom.subClassIri}|${axiom.superClassIri}`;
    case "EquivalentClasses":
      return `EC:${[...axiom.classIris].sort().join(",")}`;
    case "DisjointClasses":
      return `DC:${[...axiom.classIris].sort().join(",")}`;
    case "ObjectPropertyDeclaration":
      return `OPD:${axiom.iri}`;
    case "DataPropertyDeclaration":
      return `DPD:${axiom.iri}`;
    case "ObjectPropertyAssertion":
      return `OPA:${axiom.propertyIri}|${axiom.subjectIri}|${axiom.objectIri}`;
    case "DataPropertyAssertion":
      return `DPA:${axiom.propertyIri}|${axiom.subjectIri}|${axiom.value}`;
    case "TransitiveObjectProperty":
      return `TOP:${axiom.propertyIri}`;
    case "IndividualDeclaration":
      return `ID:${axiom.iri}`;
    case "ClassAssertion":
      return `CA:${axiom.classIri}|${axiom.individualIri}`;
    case "ObjectSomeValuesFrom":
      return `OSVF:${axiom.propertyIri}|${axiom.fillerClassIri}`;
    case "DataSomeValuesFrom":
      return `DSVF:${axiom.propertyIri}|${axiom.dataRange}`;
    case "SubPropertyChainOf":
      return `SPCO:${axiom.subPropertyChain.join("o")}->${axiom.superPropertyIri}`;
    case "QualifiedCardinality":
      return `QC:${axiom.classIri}|${axiom.propertyIri}|${axiom.cardinalityType}|${axiom.count}|${axiom.fillerClassIri ?? ""}`;
    case "LinearConstraint":
      return `LC:${axiom.subjectIri}|${axiom.terms.map((t) => `${t.coefficient}*${t.propertyIri}`).join("+")}|${axiom.op}|${axiom.bound}`;
    case "NominalClass":
    case "ObjectOneOf":
      return `OOC:${axiom.classIri}|${[...axiom.individualIris].sort().join(",")}`;
    case "DifferentIndividuals":
      return `DIFF:${[...axiom.individualIris].sort().join(",")}`;
    case "SwrlRule":
      return `SWRL:${axiom.ruleIri ?? ""}|${JSON.stringify(axiom.body)}->${JSON.stringify(axiom.head)}`;
    default:
      return JSON.stringify(axiom);
  }
}

export function axiomReferencesIri(axiom: OWL2Axiom, iri: string): boolean {
  switch (axiom.type) {
    case "ClassDeclaration":
      return axiom.iri === iri;
    case "SubClassOf":
      return axiom.subClassIri === iri || axiom.superClassIri === iri;
    case "EquivalentClasses":
    case "DisjointClasses":
      return axiom.classIris.includes(iri);
    case "ObjectPropertyDeclaration":
    case "DataPropertyDeclaration":
      return axiom.iri === iri;
    case "ObjectPropertyAssertion":
      return axiom.propertyIri === iri || axiom.subjectIri === iri || axiom.objectIri === iri;
    case "DataPropertyAssertion":
      return axiom.propertyIri === iri || axiom.subjectIri === iri;
    case "TransitiveObjectProperty":
      return axiom.propertyIri === iri;
    case "IndividualDeclaration":
      return axiom.iri === iri;
    case "ClassAssertion":
      return axiom.classIri === iri || axiom.individualIri === iri;
    case "ObjectSomeValuesFrom":
      return axiom.propertyIri === iri || axiom.fillerClassIri === iri;
    case "DataSomeValuesFrom":
      return axiom.propertyIri === iri;
    case "SubPropertyChainOf":
      return axiom.superPropertyIri === iri || axiom.subPropertyChain.includes(iri);
    case "QualifiedCardinality":
      return axiom.classIri === iri || axiom.propertyIri === iri || axiom.fillerClassIri === iri;
    case "LinearConstraint":
      return axiom.subjectIri === iri || axiom.terms.some((t) => t.propertyIri === iri);
    case "NominalClass":
    case "ObjectOneOf":
      return axiom.classIri === iri || axiom.individualIris.includes(iri);
    case "DifferentIndividuals":
      return axiom.individualIris.includes(iri);
    case "SwrlRule":
      return (
        axiom.body.some(
          (a) => ("classIri" in a && a.classIri === iri) || ("propertyIri" in a && a.propertyIri === iri),
        ) ||
        axiom.head.some((a) => ("classIri" in a && a.classIri === iri) || ("propertyIri" in a && a.propertyIri === iri))
      );
    default:
      return false;
  }
}

export function axiomToFSS(axiom: OWL2Axiom): string {
  switch (axiom.type) {
    case "ClassDeclaration":
      return `Declaration(Class(${axiom.iri}))`;
    case "SubClassOf":
      return `SubClassOf(${axiom.subClassIri} ${axiom.superClassIri})`;
    case "EquivalentClasses":
      return `EquivalentClasses(${axiom.classIris.join(" ")})`;
    case "DisjointClasses":
      return `DisjointClasses(${axiom.classIris.join(" ")})`;
    case "ObjectPropertyDeclaration":
      return `Declaration(ObjectProperty(${axiom.iri}))`;
    case "DataPropertyDeclaration":
      return `Declaration(DataProperty(${axiom.iri}))`;
    case "ObjectPropertyAssertion":
      return `ObjectPropertyAssertion(${axiom.propertyIri} ${axiom.subjectIri} ${axiom.objectIri})`;
    case "DataPropertyAssertion":
      return `DataPropertyAssertion(${axiom.propertyIri} ${axiom.subjectIri} "${axiom.value}")`;
    case "TransitiveObjectProperty":
      return `TransitiveObjectProperty(${axiom.propertyIri})`;
    case "IndividualDeclaration":
      return `Declaration(NamedIndividual(${axiom.iri}))`;
    case "ClassAssertion":
      return `ClassAssertion(${axiom.classIri} ${axiom.individualIri})`;
    case "ObjectSomeValuesFrom":
      return `SubClassOf(owl:Thing ObjectSomeValuesFrom(${axiom.propertyIri} ${axiom.fillerClassIri}))`;
    case "DataSomeValuesFrom":
      return `SubClassOf(owl:Thing DataSomeValuesFrom(${axiom.propertyIri} ${axiom.dataRange}))`;
    case "NominalClass":
    case "ObjectOneOf":
      return `EquivalentClasses(${axiom.classIri} ObjectOneOf(${axiom.individualIris.join(" ")}))`;
    case "DifferentIndividuals":
      return `DifferentIndividuals(${axiom.individualIris.join(" ")})`;
    case "SwrlRule":
      return `# DLSafeRule(${axiom.ruleIri ?? "anon"})`;
    default:
      return `# ${axiom.type}`;
  }
}

export function axiomToSymbolEntry(axiom: OWL2Axiom, id: number): SymbolEntry | null {
  const base: Omit<SymbolEntry, "id" | "kind" | "name"> = {
    ruleName: "owl2:projected",
    namePath: "iri",
    startByte: 0,
    endByte: 0,
    parentId: null,
    exports: [],
    inherits: [],
    metadata: { sourceLang: axiom.sourceLang, projected: true },
    fieldRanges: undefined,
    fieldName: null,
    language: "owl2",
  };

  switch (axiom.type) {
    case "ClassDeclaration":
      return { ...base, id, kind: "Class", name: axiom.iri };
    case "ObjectPropertyDeclaration":
      return { ...base, id, kind: "ObjectProperty", name: axiom.iri };
    case "DataPropertyDeclaration":
      return { ...base, id, kind: "DataProperty", name: axiom.iri };
    case "IndividualDeclaration":
      return { ...base, id, kind: "Individual", name: axiom.iri };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// GCI Absorption Preprocessor (HermiT / Pellet optimization)
// ---------------------------------------------------------------------------

export function absorbGCIs(axioms: readonly OWL2Axiom[]): OWL2Axiom[] {
  const result: OWL2Axiom[] = [];
  for (const ax of axioms) {
    if (ax.type === "SubClassOf") {
      // Tautology: C SubClassOf C
      if (ax.subClassIri === ax.superClassIri) continue;
      // C SubClassOf owl:Thing is trivial
      if (ax.superClassIri === "owl:Thing" || ax.superClassIri === "http://www.w3.org/2002/07/owl#Thing") continue;
      // owl:Nothing SubClassOf C is trivial
      if (ax.subClassIri === "owl:Nothing" || ax.subClassIri === "http://www.w3.org/2002/07/owl#Nothing") continue;
      result.push(ax);
    } else if (ax.type === "EquivalentClasses") {
      const unique = Array.from(new Set(ax.classIris));
      if (unique.length < 2) continue;
      result.push({
        ...ax,
        classIris: unique,
      });
    } else if (ax.type === "DisjointClasses") {
      const unique = Array.from(new Set(ax.classIris));
      if (unique.length < 2) continue;
      result.push({
        ...ax,
        classIris: unique,
      });
    } else {
      result.push(ax);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// STEP CAD 3D Bounding Box RCC-8 Spatial Projections
// ---------------------------------------------------------------------------

export interface CadBoundingBox {
  readonly id: string;
  readonly name?: string;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export type Rcc8Relation =
  | "rcc:DC"
  | "rcc:EC"
  | "rcc:PO"
  | "rcc:EQ"
  | "rcc:TPP"
  | "rcc:NTPP"
  | "rcc:TPPi"
  | "rcc:NTPPi";

export function computeRcc8Relation(a: CadBoundingBox, b: CadBoundingBox, epsilon: number = 1e-6): Rcc8Relation {
  // Check for exact identity (EQ)
  let isEqual = true;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a.min[i] - b.min[i]) > epsilon || Math.abs(a.max[i] - b.max[i]) > epsilon) {
      isEqual = false;
      break;
    }
  }
  if (isEqual) return "rcc:EQ";

  // Intersection bounds
  const interMin = [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])];
  const interMax = [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])];

  // If disjoint on any axis => Disconnected (DC)
  for (let i = 0; i < 3; i++) {
    if (interMin[i] > interMax[i] + epsilon) {
      return "rcc:DC";
    }
  }

  // If touches at boundary face/edge/corner with 0-volume intersection => Externally Connected (EC)
  let touchesBoundary = false;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(interMin[i] - interMax[i]) <= epsilon) {
      touchesBoundary = true;
      break;
    }
  }
  if (touchesBoundary) {
    return "rcc:EC";
  }

  // 3D volume overlap exists: test proper part containment
  // Is A inside B?
  const aInB =
    a.min[0] >= b.min[0] - epsilon &&
    a.max[0] <= b.max[0] + epsilon &&
    a.min[1] >= b.min[1] - epsilon &&
    a.max[1] <= b.max[1] + epsilon &&
    a.min[2] >= b.min[2] - epsilon &&
    a.max[2] <= b.max[2] + epsilon;

  if (aInB) {
    const touchesEdge =
      Math.abs(a.min[0] - b.min[0]) <= epsilon ||
      Math.abs(a.max[0] - b.max[0]) <= epsilon ||
      Math.abs(a.min[1] - b.min[1]) <= epsilon ||
      Math.abs(a.max[1] - b.max[1]) <= epsilon ||
      Math.abs(a.min[2] - b.min[2]) <= epsilon ||
      Math.abs(a.max[2] - b.max[2]) <= epsilon;
    return touchesEdge ? "rcc:TPP" : "rcc:NTPP";
  }

  // Is B inside A?
  const bInA =
    b.min[0] >= a.min[0] - epsilon &&
    b.max[0] <= a.max[0] + epsilon &&
    b.min[1] >= a.min[1] - epsilon &&
    b.max[1] <= a.max[1] + epsilon &&
    b.min[2] >= a.min[2] - epsilon &&
    b.max[2] <= a.max[2] + epsilon;

  if (bInA) {
    const touchesEdge =
      Math.abs(b.min[0] - a.min[0]) <= epsilon ||
      Math.abs(b.max[0] - a.max[0]) <= epsilon ||
      Math.abs(b.min[1] - a.min[1]) <= epsilon ||
      Math.abs(b.max[1] - a.max[1]) <= epsilon ||
      Math.abs(b.min[2] - a.min[2]) <= epsilon ||
      Math.abs(b.max[2] - a.max[2]) <= epsilon;
    return touchesEdge ? "rcc:TPPi" : "rcc:NTPPi";
  }

  return "rcc:PO";
}

export function projectCadEnvelopes(boxes: readonly CadBoundingBox[]): OWL2Axiom[] {
  const axioms: OWL2Axiom[] = [
    { type: "ClassDeclaration", iri: "cad:BoundingEnvelope", sourceLang: "step" },
    { type: "SymmetricObjectProperty", propertyIri: "rcc:DC", sourceLang: "step" },
    { type: "SymmetricObjectProperty", propertyIri: "rcc:EC", sourceLang: "step" },
    { type: "SymmetricObjectProperty", propertyIri: "rcc:PO", sourceLang: "step" },
    { type: "SymmetricObjectProperty", propertyIri: "rcc:EQ", sourceLang: "step" },
    { type: "InverseObjectProperty", propertyIri: "rcc:TPP", inversePropertyIri: "rcc:TPPi", sourceLang: "step" },
    { type: "InverseObjectProperty", propertyIri: "rcc:NTPP", inversePropertyIri: "rcc:NTPPi", sourceLang: "step" },
  ];

  for (const box of boxes) {
    const indIri = `cad:${box.id}`;
    axioms.push({ type: "IndividualDeclaration", iri: indIri, sourceLang: "step" });
    axioms.push({
      type: "ClassAssertion",
      individualIri: indIri,
      classIri: "cad:BoundingEnvelope",
      sourceLang: "step",
    });
  }

  const inverseMap: Record<Rcc8Relation, Rcc8Relation> = {
    "rcc:DC": "rcc:DC",
    "rcc:EC": "rcc:EC",
    "rcc:PO": "rcc:PO",
    "rcc:EQ": "rcc:EQ",
    "rcc:TPP": "rcc:TPPi",
    "rcc:NTPP": "rcc:NTPPi",
    "rcc:TPPi": "rcc:TPP",
    "rcc:NTPPi": "rcc:NTPP",
  };

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const b1 = boxes[i]!;
      const b2 = boxes[j]!;
      const rel = computeRcc8Relation(b1, b2);
      axioms.push({
        type: "ObjectPropertyAssertion",
        propertyIri: rel,
        subjectIri: `cad:${b1.id}`,
        objectIri: `cad:${b2.id}`,
        sourceLang: "step",
      });
      axioms.push({
        type: "ObjectPropertyAssertion",
        propertyIri: inverseMap[rel],
        subjectIri: `cad:${b2.id}`,
        objectIri: `cad:${b1.id}`,
        sourceLang: "step",
      });
    }
  }

  return axioms;
}
