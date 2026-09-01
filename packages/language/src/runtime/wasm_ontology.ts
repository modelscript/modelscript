// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WASM-Backed OWL2 / SHACL Reasoning Framework and Ontology Store
 *
 * Maintains a unified, incrementally-updated OWL2 ontology derived from
 * all source language workspaces (Modelica, SysML2, STEP, OWL2) via the
 * AdapterRegistry and WebAssembly zero-GC runtime.
 */

import type { AdapterRegistry, ProjectionResult } from "../compiler/adapter-registry.js";
import type { SymbolEntry, SymbolId, SymbolIndex } from "../compiler/runtime.js";

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
  readonly type: "NominalClass";
  readonly classIri: string;
  readonly individualIris: readonly string[];
  readonly sourceLang?: string;
}

export interface OWL2SelfRestriction {
  readonly type: "SelfRestriction";
  readonly classIri: string;
  readonly propertyIri: string;
  readonly sourceLang?: string;
}

// ---------------------------------------------------------------------------
// SHACL Shapes and Rules (SHACL-AF)
// ---------------------------------------------------------------------------

export interface SHACLPropertyShape {
  readonly path: string;
  readonly targetClass?: string;
  readonly minCount?: number;
  readonly maxCount?: number;
  readonly qualifiedValueShape?: string;
  readonly pattern?: string;
  readonly hasValue?: string;
  readonly in?: readonly string[];
}

export interface SHACLNodeShape {
  readonly targetClass: string;
  readonly propertyShapes: readonly SHACLPropertyShape[];
  readonly closed?: boolean;
}

export interface SHACLRule {
  readonly targetClass: string;
  readonly propertyIri: string;
  readonly fillerClassIri?: string;
  readonly minCount?: number;
  readonly maxCount?: number;
  readonly derivedClassIri?: string;
  readonly derivedPropertyIri?: string;
  readonly derivedValueIri?: string;
}

export interface SHACLViolation {
  readonly focusNode: string;
  readonly resultPath: string;
  readonly message: string;
  readonly constraintComponent: string;
  readonly severity?: "Violation" | "Warning" | "Info";
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
  | OWL2SelfRestriction;

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

export function projectionToAxioms(result: ProjectionResult): OWL2Axiom[] {
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
  memory?: WebAssembly.Memory;
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
    const bgSet = new Set(bg.map((a) => JSON.stringify(a)));
    const delta = this._axioms.filter((a) => !bgSet.has(JSON.stringify(a)));

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

    const serializeAxiom = (a: OWL2Axiom) => JSON.stringify(a);
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
    for (const a of merged) unique.set(JSON.stringify(a), a);
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

    const allFacts: { s: string; p: string; o: string }[] = [];
    for (const ax of this._axioms) {
      if (ax.type === "ObjectPropertyAssertion") {
        allFacts.push({ s: ax.subjectIri, p: ax.propertyIri, o: ax.objectIri });
      } else if (ax.type === "SubClassOf") {
        allFacts.push({ s: ax.subClassIri, p: "rdfs:subClassOf", o: ax.superClassIri });
      } else if (ax.type === "ClassAssertion") {
        allFacts.push({ s: ax.individualIri, p: "rdf:type", o: ax.classIri });
      }
    }

    let currentBindings: Record<string, string>[] = [{}];

    for (const pat of query.patterns) {
      const nextBindings: Record<string, string>[] = [];

      for (const env of currentBindings) {
        for (const fact of allFacts) {
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

      case "NominalClass": {
        for (const ind of axiom.individualIris) {
          const types = this.individualTypes.get(ind) ?? new Set();
          types.add(axiom.classIri);
          this.individualTypes.set(ind, types);
        }
        break;
      }

      case "QualifiedCardinality":
      case "AsymmetricObjectProperty":
      case "IrreflexiveObjectProperty":
      case "DisjointObjectProperties":
        break;
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

    if (conflicts.length > 0) {
      return {
        isConsistent: false,
        conflictingAxioms: conflicts,
        explanation: `Found ${conflicts.length} disjointness violation(s) in the ontology.`,
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

  private clear(): void {
    this._axioms = [];
    this.classes.clear();
    this.disjointPairs.clear();
    this.objectProperties.clear();
    this.dataProperties.clear();
    this.transitiveProperties.clear();
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

export class WasmOntologyStore implements IOWL2OntologyStore {
  private _revision = 0;
  private _axioms: OWL2Axiom[] = [];
  private _axiomsBySource = new Map<string, OWL2Axiom[]>();
  private _projectedVersions = new Map<string, number>();
  private _lastDelta: OWL2AxiomDelta = { retractions: [], assertions: [] };
  private _sourceLanguages: string[] = [];
  private _registry: AdapterRegistry;
  private _wasmInstance: WasmOntologyInstance | null = null;

  constructor(registry: AdapterRegistry, wasmInstance?: WasmOntologyInstance | null) {
    this._registry = registry;
    this._wasmInstance = wasmInstance ?? null;
  }

  public setWasmInstance(wasmInstance: WasmOntologyInstance): void {
    this._wasmInstance = wasmInstance;
  }

  public get wasmInstance(): WasmOntologyInstance | null {
    return this._wasmInstance;
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

  fullProjection(): void {
    const previousAxioms = [...this._axioms];
    this._axiomsBySource.clear();
    const allAxioms: OWL2Axiom[] = [];

    for (const lang of this._sourceLanguages) {
      const projections = this._registry.projectAll(lang, "owl2");
      const langAxioms: OWL2Axiom[] = [];

      for (const projection of projections) {
        langAxioms.push(...projectionToAxioms(projection));
      }

      this._axiomsBySource.set(lang, langAxioms);
      allAxioms.push(...langAxioms);
    }

    this._axioms = allAxioms;
    this._lastDelta = computeDelta(previousAxioms, allAxioms);
    this._revision++;
  }

  projectLanguage(language: string): OWL2AxiomDelta {
    const previousLangAxioms = this._axiomsBySource.get(language) ?? [];
    const newLangAxioms: OWL2Axiom[] = [];

    if (language === "sysml2" && this._registry.queryProvider) {
      const index = this._registry.getIndex("sysml2");
      if (index) {
        for (const entry of index.symbols.values()) {
          if (entry.parentId === null) {
            const axioms = this._registry.queryProvider("emitAxioms", entry.id) as OWL2Axiom[] | null;
            if (axioms) {
              newLangAxioms.push(...axioms);
            }
          }
        }
      }
    } else {
      const projections = this._registry.projectAll(language, "owl2");
      for (const projection of projections) {
        newLangAxioms.push(...projectionToAxioms(projection));
      }
    }

    this._axiomsBySource.set(language, newLangAxioms);

    const allAxioms: OWL2Axiom[] = [];
    for (const langAxioms of this._axiomsBySource.values()) {
      allAxioms.push(...langAxioms);
    }

    const delta = computeDelta(previousLangAxioms, newLangAxioms);
    this._axioms = allAxioms;
    this._lastDelta = delta;
    this._revision++;
    return delta;
  }

  update(workspaceVersions: Map<string, number>): OWL2AxiomDelta | null {
    const changedLanguages: string[] = [];

    for (const lang of this._sourceLanguages) {
      const currentVersion = workspaceVersions.get(lang);
      if (currentVersion === undefined) continue;

      const lastVersion = this._projectedVersions.get(lang);
      if (lastVersion === undefined || currentVersion !== lastVersion) {
        changedLanguages.push(lang);
        this._projectedVersions.set(lang, currentVersion);
      }
    }

    if (changedLanguages.length === 0) return null;

    const allRetractions: OWL2Axiom[] = [];
    const allAssertions: OWL2Axiom[] = [];

    for (const lang of changedLanguages) {
      const delta = this.projectLanguage(lang);
      allRetractions.push(...delta.retractions);
      allAssertions.push(...delta.assertions);
    }

    this._lastDelta = { retractions: allRetractions, assertions: allAssertions };
    return this._lastDelta;
  }

  projectSymbol(entry: SymbolEntry, sourceLang: string): OWL2Axiom[] {
    const result = this._registry.project(entry, sourceLang, "owl2");
    if (!result) return [];
    return projectionToAxioms(result);
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
