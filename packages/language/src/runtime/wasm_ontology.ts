// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WASM-Backed OWL2 Ontology Store
 *
 * Maintains a unified, incrementally-updated OWL2 ontology derived from
 * all source language workspaces (Modelica, SysML2, STEP, OWL2) via the
 * AdapterRegistry and WebAssembly zero-GC runtime.
 */

import type { AdapterRegistry, ProjectionResult } from "../compiler/adapter-registry.js";
import type { SymbolEntry, SymbolIndex } from "../compiler/runtime.js";
import { IdTrieMap, StringTrieMap } from "../compiler/utils/radix-trie.js";
import type {
  IOWL2OntologyStore,
  OWL2Axiom,
  OWL2AxiomDelta,
  OWL2ClassAssertion,
  OWL2ClassDeclaration,
  OWL2DataPropertyAssertion,
  OWL2DataPropertyDeclaration,
  OWL2DisjointClasses,
  OWL2IndividualDeclaration,
  OWL2ObjectPropertyAssertion,
  OWL2ObjectPropertyDeclaration,
  OWL2SubClassOf,
  OWL2TransitiveObjectProperty,
} from "../reasoner/types.js";

/**
 * Convert a ProjectionResult (from AdapterRegistry.project()) into
 * concrete OWL2Axiom instances.
 */
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

// Axiom Type Constants matching AssemblyScript ontology.ts
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

export class WasmOntologyStore implements IOWL2OntologyStore {
  /** Monotonic revision counter — incremented on every re-projection. */
  private _revision = 0;

  /** All currently asserted axioms (union of all source languages). */
  private _axioms: OWL2Axiom[] = [];

  /** Axioms partitioned by source language — enables per-language invalidation. */
  private _axiomsBySource = new Map<string, OWL2Axiom[]>();

  /** Workspace version numbers at the time of last projection — per language. */
  private _projectedVersions = new Map<string, number>();

  /** The most recent incremental delta. */
  private _lastDelta: OWL2AxiomDelta = { retractions: [], assertions: [] };

  /** Registered source languages that participate in OWL2 projection. */
  private _sourceLanguages: string[] = [];

  /** The adapter registry used for projection. */
  private _registry: AdapterRegistry;

  /** Optional direct handle to compiled WebAssembly runtime. */
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

  // -------------------------------------------------------------------------
  // Public API — Read
  // -------------------------------------------------------------------------

  /** Current revision (monotonic, incremented on re-projection). */
  get revision(): number {
    return this._revision;
  }

  /** All currently asserted OWL2 axioms. */
  get axioms(): readonly OWL2Axiom[] {
    return this._axioms;
  }

  /** Axioms partitioned by source language. */
  get axiomsBySource(): ReadonlyMap<string, readonly OWL2Axiom[]> {
    return this._axiomsBySource;
  }

  /** The most recent incremental change set. */
  get lastDelta(): Readonly<OWL2AxiomDelta> {
    return this._lastDelta;
  }

  /** Number of axioms in the store. */
  get size(): number {
    if (this._wasmInstance?.ontology_getAxiomCount) {
      return this._wasmInstance.ontology_getAxiomCount();
    }
    return this._axioms.length;
  }

  // -------------------------------------------------------------------------
  // Public API — Mutate
  // -------------------------------------------------------------------------

  /**
   * Register a source language to participate in OWL2 projection.
   * Must be called before `update()` to include that language's symbols.
   */
  registerSourceLanguage(language: string): void {
    if (!this._sourceLanguages.includes(language)) {
      this._sourceLanguages.push(language);
    }
  }

  /**
   * Full re-projection: project all source languages into OWL2.
   * Computes the delta against the previous axiom set.
   */
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

  /**
   * Incremental re-projection for a single source language.
   * Only re-projects the specified language's symbols and patches
   * the unified axiom set. Much cheaper than fullProjection() for
   * single-file edits.
   */
  projectLanguage(language: string): OWL2AxiomDelta {
    const previousLangAxioms = this._axiomsBySource.get(language) ?? [];
    const newLangAxioms: OWL2Axiom[] = [];

    if (language === "sysml2" && this._registry.queryProvider) {
      const index = this._registry.getIndex("sysml2");
      if (index) {
        // Find root nodes (packages/namespaces) and extract their axioms natively
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

    // Rebuild the unified axiom set from all language partitions
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

  /**
   * Incremental update driven by workspace version tracking.
   * Checks which registered workspaces have a newer version than
   * the last projection and re-projects only those.
   */
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

  /**
   * Project a single symbol into OWL2 axioms.
   */
  projectSymbol(entry: SymbolEntry, sourceLang: string): OWL2Axiom[] {
    const result = this._registry.project(entry, sourceLang, "owl2");
    if (!result) return [];
    return projectionToAxioms(result);
  }

  // -------------------------------------------------------------------------
  // In-WASM Reasoning & Query Acceleration
  // -------------------------------------------------------------------------

  /** Direct check if subClass ⊑ superClass */
  isSubClassOf(subClassHash: number, superClassHash: number): boolean {
    if (this._wasmInstance?.ontology_isSubClassOf) {
      return this._wasmInstance.ontology_isSubClassOf(subClassHash, superClassHash) !== 0;
    }
    return false;
  }

  /** Direct ontology consistency check */
  checkConsistency(): boolean {
    if (this._wasmInstance?.ontology_checkConsistency) {
      return this._wasmInstance.ontology_checkConsistency() !== 0;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Query Helpers (for IDE integration)
  // -------------------------------------------------------------------------

  /** Get all ClassDeclaration axioms. */
  getClassDeclarations(): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "ClassDeclaration");
  }

  /** Get all SubClassOf axioms for a given class IRI. */
  getSuperClasses(classIri: string): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "SubClassOf" && a.subClassIri === classIri);
  }

  /** Get all SubClassOf axioms where the given class is the superclass. */
  getSubClasses(classIri: string): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "SubClassOf" && a.superClassIri === classIri);
  }

  /** Get all ObjectPropertyDeclaration axioms. */
  getObjectProperties(): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "ObjectPropertyDeclaration");
  }

  /** Get all DataPropertyDeclaration axioms. */
  getDataProperties(): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "DataPropertyDeclaration");
  }

  /** Get all axioms referencing a specific IRI (as subject or object). */
  getAxiomsForIri(iri: string): OWL2Axiom[] {
    return this._axioms.filter((a) => axiomReferencesIri(a, iri));
  }

  /** Serialize the full ontology to OWL2 Functional-Style Syntax. */
  toFunctionalSyntax(): string {
    const lines: string[] = [];
    lines.push("Ontology(<urn:modelscript:unified>");

    for (const axiom of this._axioms) {
      lines.push(`  ${axiomToFSS(axiom)}`);
    }

    lines.push(")");
    return lines.join("\n");
  }

  /**
   * Generate synthetic SymbolEntry objects for projected axioms.
   * Enables cross-language IRI resolution in LSP.
   */
  toSyntheticSymbolEntries(): SymbolIndex {
    const symbols = new IdTrieMap<SymbolEntry>();
    const byName = new StringTrieMap<number[]>();
    const childrenOf = new IdTrieMap<number[]>();

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

  /** Clear all axioms and reset state. */
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

// ---------------------------------------------------------------------------
// Backward-compatibility alias
// ---------------------------------------------------------------------------
export { WasmOntologyStore as OWL2OntologyStore };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Compute the delta between two axiom sets. */
export function computeDelta(previous: readonly OWL2Axiom[], current: readonly OWL2Axiom[]): OWL2AxiomDelta {
  const prevKeys = new Set(previous.map(axiomKey));
  const currKeys = new Set(current.map(axiomKey));

  const retractions = previous.filter((a) => !currKeys.has(axiomKey(a)));
  const assertions = current.filter((a) => !prevKeys.has(axiomKey(a)));

  return { retractions, assertions };
}

/** Stable string key for axiom identity. */
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
  }
}

/** Check if an axiom references a given IRI. */
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
  }
}

/** Convert an axiom to OWL2 Functional-Style Syntax string. */
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
  }
}

/**
 * Convert a projected axiom into a synthetic SymbolEntry for cross-language
 * IRI resolution.
 */
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
