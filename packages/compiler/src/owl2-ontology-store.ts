import { IdTrieMap, StringTrieMap } from "./utils/radix-trie.js";
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OWL2 Ontology Store
 *
 * Maintains a unified, incrementally-updated OWL2 ontology derived from
 * all source language workspaces (Modelica, SysML2, STEP) via the
 * AdapterRegistry. Designed to be integrated into the UnifiedWorkspace
 * so that axiom re-projection is triggered automatically when the
 * workspace version changes.
 *
 * ## Architecture
 *
 * ```
 *   Modelica WorkspaceIndex ─┐
 *   SysML2  WorkspaceIndex ──┤──→ AdapterRegistry ──→ OWL2OntologyStore
 *   STEP    WorkspaceIndex ──┘                          │
 *                                                       ├─ axioms: OWL2Axiom[]
 *                                                       ├─ axiomsBySource: Map<string, OWL2Axiom[]>
 *                                                       ├─ lastDelta: OWL2AxiomDelta
 *                                                       └─ revision: number
 * ```
 *
 * ## Incremental Strategy
 *
 * Instead of re-projecting the entire workspace on every keystroke,
 * the store tracks which source languages changed (via workspace
 * version numbers) and only re-projects the changed language's symbols.
 *
 * The delta is computed by comparing the previous axiom set for that
 * language against the newly projected set. This allows downstream
 * consumers (e.g., FaCT++ reasoner, IDE hierarchy views) to process
 * only the incremental changes.
 */

import type { AdapterRegistry } from "./adapter-registry.js";
import type { OWL2Axiom, OWL2AxiomDelta } from "./owl2-axioms.js";
import { projectionToAxioms } from "./owl2-projection.js";
import type { SymbolEntry, SymbolIndex } from "./runtime.js";

// ---------------------------------------------------------------------------
// OWL2 Ontology Store
// ---------------------------------------------------------------------------

export class OWL2OntologyStore {
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

  constructor(registry: AdapterRegistry) {
    this._registry = registry;
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
   * Call this when the workspace is first initialized or after
   * a major structural change.
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
   *
   * @param language - The source language that changed.
   * @returns The incremental delta for this language.
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
   *
   * @param workspaceVersions - Map of language → current workspace version.
   * @returns Combined delta across all re-projected languages, or null if nothing changed.
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

    // Aggregate deltas across all changed languages
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
   * Useful for on-demand tooltip/hover information.
   */
  projectSymbol(entry: SymbolEntry, sourceLang: string): OWL2Axiom[] {
    const result = this._registry.project(entry, sourceLang, "owl2");
    if (!result) return [];
    return projectionToAxioms(result);
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
   *
   * This enables cross-language IRI resolution: when an OWL2 lint query
   * does `db.byName("mo:Motor")`, it will find the synthetic entry
   * created from a Modelica-projected ClassDeclaration axiom.
   *
   * Synthetic entries use negative IDs (starting from -1_000_000) to
   * avoid collisions with real CST-derived symbol IDs.
   */
  toSyntheticSymbolEntries(): SymbolIndex {
    const symbols = new IdTrieMap<SymbolEntry>();
    const byName = new StringTrieMap<number[]>();
    const childrenOf = new IdTrieMap<number[]>();

    // Start synthetic IDs at a large negative offset to avoid collisions
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
    this._axioms = [];
    this._axiomsBySource.clear();
    this._projectedVersions.clear();
    this._lastDelta = { retractions: [], assertions: [] };
    this._revision++;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Compute the delta between two axiom sets. */
function computeDelta(previous: readonly OWL2Axiom[], current: readonly OWL2Axiom[]): OWL2AxiomDelta {
  const prevKeys = new Set(previous.map(axiomKey));
  const currKeys = new Set(current.map(axiomKey));

  const retractions = previous.filter((a) => !currKeys.has(axiomKey(a)));
  const assertions = current.filter((a) => !prevKeys.has(axiomKey(a)));

  return { retractions, assertions };
}

/** Stable string key for axiom identity. */
function axiomKey(axiom: OWL2Axiom): string {
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
function axiomReferencesIri(axiom: OWL2Axiom, iri: string): boolean {
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
function axiomToFSS(axiom: OWL2Axiom): string {
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
 * IRI resolution. Only declaration axioms produce entries — assertion axioms
 * don't introduce new names.
 */
function axiomToSymbolEntry(axiom: OWL2Axiom, id: number): SymbolEntry | null {
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
