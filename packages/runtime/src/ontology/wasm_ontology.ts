// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WASM-Backed OWL2 / SHACL Reasoning Framework and Ontology Store
 *
 * Maintains a unified, incrementally-updated OWL2 ontology derived from
 * all source language workspaces (Modelica, SysML2, STEP, OWL2) via the
 * TGG polyglot correspondence index and WebAssembly zero-GC runtime.
 */

import type { SymbolEntry, SymbolId, SymbolIndex } from "../runtime.js";
import {
  AxiomRecordView,
  axiomReferencesIri,
  axiomToFSS,
  axiomToSymbolEntry,
  axiomToTypeAndIris,
  computeDelta,
  hashIri64,
  projectCadEnvelopes,
  projectWorkspaceLanguageSymbols,
} from "./axiom-utils.js";
import {
  AXIOM_CLASS_ASSERT,
  AXIOM_DATA_PROP_ASSERT,
  AXIOM_OBJ_PROP_ASSERT,
  AXIOM_SUBCLASS_OF,
  type CadBoundingBox,
  type IOWL2OntologyStore,
  type OWL2Axiom,
  type OWL2AxiomDelta,
  type OntologyWorkspaceLike,
  type PropertyChainResult,
  type PropertyPathOp,
  type WasmOntologyInstance,
} from "./owl2-types.js";

// Re-export decomposed ontology types, utilities, query engine, reasoner, and builder
export {
  AxiomRecordView,
  absorbGCIs,
  axiomKey,
  axiomReferencesIri,
  axiomToFSS,
  axiomToSymbolEntry,
  axiomToTypeAndIris,
  computeDelta,
  computeRcc8Relation,
  hashIri64,
  projectCadEnvelopes,
  projectionToAxioms,
} from "./axiom-utils.js";
export * from "./dl-query.js";
export * from "./owl2-types.js";
export { OntologyBuilder, TableauReasoner, WasmOntologyReasoner } from "./wasm-reasoner.js";

// ---------------------------------------------------------------------------
// WASM-Backed Ontology Store
// ---------------------------------------------------------------------------

/**
 * Multi-language OWL 2 ontology store backed by WebAssembly linear memory and Roaring Bitmap triple indices.
 */
export class WasmOntologyStore implements IOWL2OntologyStore {
  /** Monotonically increasing store revision counter. */
  private _revision = 0;
  /** All active OWL 2 axioms across all registered source languages. */
  private _axioms: OWL2Axiom[] = [];
  /** Axioms partitioned by source language identifier. */
  private _axiomsBySource = new Map<string, OWL2Axiom[]>();
  /** Last projected workspace version per language. */
  private _projectedVersions = new Map<string, number>();
  /** Most recent incremental delta produced by a store update. */
  private _lastDelta: OWL2AxiomDelta = { retractions: [], assertions: [] };
  /** Registered source engineering languages (`"modelica"`, `"sysml2"`, `"step"`, etc.). */
  private _sourceLanguages: string[] = [];
  /** Optional native WebAssembly ontology module instance. */
  private _wasmInstance: WasmOntologyInstance | null = null;
  /** Optional multi-file `WorkspaceIndex` used for automatic symbol-to-axiom projection. */
  private _workspace: OntologyWorkspaceLike | null = null;
  /** Optional unified disk/OPFS-backed `PagedStorageEngine` for crash-safe CoW MVCC persistence. */
  private _pagedStorage: {
    insertTriple(
      subject: string | number,
      predicate: string | number,
      object: string | number | boolean,
      axiomType?: number,
      flags?: number,
    ): boolean;
    encodeLiteral?(value: number | boolean | string): number;
  } | null = null;
  /** When true, skips JS-side axiom array materialization and forwards directly to WASM. */
  private _pureWasmMode = false;
  /** Bidirectional map from numeric entity ID to IRI string. */
  private _entityIriMap = new Map<number, string>();
  /** Bidirectional map from IRI string to numeric entity ID. */
  private _iriEntityMap = new Map<string, number>();

  /** Creates a new `WasmOntologyStore`, optionally bound to a WASM module and workspace index. */
  constructor(wasmInstance?: WasmOntologyInstance | null, workspace?: OntologyWorkspaceLike | null) {
    this._wasmInstance = wasmInstance ?? null;
    this._workspace = workspace ?? null;
  }

  /** Attaches a `WorkspaceIndex` for polyglot symbol projection. */
  public setWorkspace(workspace: OntologyWorkspaceLike | null): void {
    this._workspace = workspace;
  }

  /** Currently attached `WorkspaceIndex`, if any. */
  public get workspace(): OntologyWorkspaceLike | null {
    return this._workspace;
  }

  /** Attaches a compiled WebAssembly ontology module instance. */
  public setWasmInstance(wasmInstance: WasmOntologyInstance): void {
    this._wasmInstance = wasmInstance;
  }

  /** Currently attached WebAssembly ontology module instance, if any. */
  public get wasmInstance(): WasmOntologyInstance | null {
    return this._wasmInstance;
  }

  /** Attaches a `PagedStorageEngine` as the unified disk/OPFS persistence backend for this store. */
  public attachPagedStorage(pagedStore: {
    insertTriple(
      subject: string | number,
      predicate: string | number,
      object: string | number | boolean,
      axiomType?: number,
      flags?: number,
    ): boolean;
    encodeLiteral?(value: number | boolean | string): number;
  }): void {
    this._pagedStorage = pagedStore;
    // Mirror any already-loaded axioms into the newly attached paged backend
    for (const ax of this._axioms) {
      this._mirrorAxiomToPaged(ax);
    }
  }

  /** Returns the attached `PagedStorageEngine`, if any. */
  public get pagedStorage() {
    return this._pagedStorage;
  }

  private _mirrorAxiomToPaged(ax: OWL2Axiom): void {
    const ps = this._pagedStorage;
    if (!ps) return;
    if (ax.type === "SubClassOf") {
      ps.insertTriple(
        ax.subClassIri,
        "http://www.w3.org/2000/01/rdf-schema#subClassOf",
        ax.superClassIri,
        AXIOM_SUBCLASS_OF,
      );
    } else if (ax.type === "ClassAssertion") {
      ps.insertTriple(
        ax.individualIri,
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        ax.classIri,
        AXIOM_CLASS_ASSERT,
      );
    } else if (ax.type === "ObjectPropertyAssertion") {
      ps.insertTriple(ax.subjectIri, ax.propertyIri, ax.objectIri, AXIOM_OBJ_PROP_ASSERT);
    } else if (ax.type === "DataPropertyAssertion") {
      const num = Number(ax.value);
      const objVal =
        ps.encodeLiteral && ax.value.trim() !== "" && !Number.isNaN(num) ? ps.encodeLiteral(num) : ax.value;
      ps.insertTriple(ax.subjectIri, ax.propertyIri, objVal, AXIOM_DATA_PROP_ASSERT);
    }
  }

  /** Enables or disables pure-WASM mode (bypassing JS-side axiom arrays). */
  public setPureWasmMode(enabled: boolean): void {
    this._pureWasmMode = enabled;
  }

  /** Whether pure-WASM mode is currently enabled. */
  public get isPureWasmMode(): boolean {
    return this._pureWasmMode;
  }

  /** Interns an IRI string into a 32-bit entity ID (synchronized with the WASM entity dictionary). */
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

  /** Resolves an interned numeric entity ID back to its original IRI string. */
  public getIri(entityId: number): string | undefined {
    return this._entityIriMap.get(entityId);
  }

  private static readonly _textEncoder = new TextEncoder();
  private static readonly _textDecoder = new TextDecoder();

  /** Interns a UTF-8 string into the WASM prefix-compressed Front-Coding string arena. */
  public internStringWasm(str: string): number {
    if (!this._wasmInstance?.ontology_internString || !this._wasmInstance.memory) return 0;
    const bytes = WasmOntologyStore._textEncoder.encode(str);
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

  /** Decompresses and extracts a UTF-8 string by entity ID from the WASM Front-Coding string arena. */
  public extractStringWasm(id: number): string {
    if (!this._wasmInstance?.ontology_extractString || !this._wasmInstance.memory) return "";
    let ptr = 0;
    const exactLen = this._wasmInstance.ontology_getStringLen ? this._wasmInstance.ontology_getStringLen(id) : 0;
    const maxLen = exactLen > 0 ? exactLen : 4096;
    if (this._wasmInstance.alloc) {
      ptr = this._wasmInstance.alloc(maxLen);
    } else {
      ptr = this._wasmInstance.ontology_getQueryBuffer ? this._wasmInstance.ontology_getQueryBuffer() : 1024;
    }
    const len = this._wasmInstance.ontology_extractStringBounded
      ? this._wasmInstance.ontology_extractStringBounded(id, ptr, maxLen)
      : this._wasmInstance.ontology_extractString(id, ptr);
    const safeLen = Math.min(len, maxLen);
    const mem8 = new Uint8Array(this._wasmInstance.memory.buffer, ptr, safeLen);
    const str = WasmOntologyStore._textDecoder.decode(mem8);
    if (this._wasmInstance.alloc && this._wasmInstance.free) {
      this._wasmInstance.free(ptr);
    }
    return str;
  }

  /** Returns the current compression ratio (`compressedBytes / rawBytes`) of the WASM string arena. */
  public getStringCompressionRatio(): number {
    if (!this._wasmInstance?.ontology_getStringCompressionRatio) return 1.0;
    return this._wasmInstance.ontology_getStringCompressionRatio();
  }

  /** Queries matching axiom records in WASM linear memory using Roaring Bitmap index intersections. */
  public queryTriplesBitmap(pattern: {
    subject?: string | number | undefined;
    predicate?: string | number | undefined;
    object?: string | number | undefined;
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

  /** Returns the Roaring Bitmap cardinality for `key` in the specified index (`0=S`, `1=P`, `2=O`). */
  public getRoaringCardinality(indexType: number, key: string | number): number {
    if (!this._wasmInstance?.ontology_getRoaringCardinality) return 0;
    const entityId = typeof key === "string" ? this.internIri(key) : key;
    return this._wasmInstance.ontology_getRoaringCardinality(indexType, entityId);
  }

  /**
   * Evaluates a multi-pattern BGP directly in WASM linear memory using integer-ID
   * Generalized Leapfrog Triejoin over Roaring Bitmaps.
   * Decodes `EntityId -> IRI` only for the final result rows.
   * Returns `null` if WASM Leapfrog is unavailable or unsupported for the given pattern shape.
   */
  public evalBgpWasm(
    patterns: readonly { subject: string; predicate: string; object: string }[],
    maxResults: number = 50000,
  ): { variables: string[]; bindings: Record<string, string>[] } | null {
    const wasm = this._wasmInstance;
    if (!wasm?.ontology_evalBgpLeapfrog || !wasm.ontology_getQueryBuffer || !wasm.memory || !wasm.alloc || !wasm.free) {
      return null;
    }
    if (patterns.length === 0 || patterns.length > 32) return null;

    const VAR_TAG = 0x80000000;
    const varToIdx = new Map<string, number>();
    const varNames: string[] = [];

    const encodeTerm = (t: string): number | null => {
      if (t.startsWith("?")) {
        let idx = varToIdx.get(t);
        if (idx === undefined) {
          if (varNames.length >= 32) return null;
          idx = varNames.length;
          varToIdx.set(t, idx);
          varNames.push(t);
        }
        return (VAR_TAG | idx) >>> 0;
      }
      const existingId = this._iriEntityMap.get(t);
      if (existingId === undefined) return 0; // Constant not present in store -> 0 matches
      return existingId >>> 0;
    };

    const flatPatterns = new Uint32Array(patterns.length * 3);
    for (let i = 0; i < patterns.length; i++) {
      const pat = patterns[i]!;
      const s = encodeTerm(pat.subject);
      const p = encodeTerm(pat.predicate);
      const o = encodeTerm(pat.object);
      if (s === null || p === null || o === null) return null;
      if (s === 0 || p === 0 || o === 0) {
        return { variables: varNames, bindings: [] };
      }
      flatPatterns[i * 3] = s;
      flatPatterns[i * 3 + 1] = p;
      flatPatterns[i * 3 + 2] = o;
    }

    const patPtr = wasm.alloc(flatPatterns.byteLength);
    if (patPtr === 0) return null;
    try {
      new Uint32Array(wasm.memory.buffer, patPtr, flatPatterns.length).set(flatPatterns);
      const rowCount = wasm.ontology_evalBgpLeapfrog(patterns.length, patPtr, varNames.length, maxResults);
      if (rowCount === 0) {
        return { variables: varNames, bindings: [] };
      }
      const varCount = varNames.length;
      if (varCount === 0) {
        return { variables: [], bindings: [{}] };
      }
      const bufPtr = wasm.ontology_getQueryBuffer();
      const raw = new Uint32Array(wasm.memory.buffer, bufPtr, rowCount * varCount);
      const bindings: Record<string, string>[] = new Array(rowCount);
      for (let r = 0; r < rowCount; r++) {
        const row: Record<string, string> = {};
        const base = r * varCount;
        for (let v = 0; v < varCount; v++) {
          const id = raw[base + v]!;
          row[varNames[v]!] = this._entityIriMap.get(id) ?? String(id);
        }
        bindings[r] = row;
      }
      return { variables: varNames, bindings };
    } finally {
      wasm.free(patPtr);
    }
  }

  /** Directly inserts an axiom into the WASM store using 64-bit FNV-1a IRI hashes. */
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

  /** Monotonically increasing revision number of the store. */
  get revision(): number {
    return this._revision;
  }

  /** All OWL 2 axioms currently held in the store. */
  get axioms(): readonly OWL2Axiom[] {
    return this._axioms;
  }

  /** Read-only map of axioms grouped by source language. */
  get axiomsBySource(): ReadonlyMap<string, readonly OWL2Axiom[]> {
    return this._axiomsBySource;
  }

  /** Most recent axiom delta produced by `addAxioms`, `setAxioms`, or `update`. */
  get lastDelta(): Readonly<OWL2AxiomDelta> {
    return this._lastDelta;
  }

  /** Total number of axioms in the store. */
  get size(): number {
    if (this._wasmInstance?.ontology_getAxiomCount) {
      return this._wasmInstance.ontology_getAxiomCount();
    }
    return this._axioms.length;
  }

  /** Registers a source engineering language for workspace projection. */
  registerSourceLanguage(language: string): void {
    if (!this._sourceLanguages.includes(language)) {
      this._sourceLanguages.push(language);
    }
  }

  /** Appends `axioms` to the partition for `sourceLang` and returns the resulting delta. */
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

    // Forward to attached unified PagedStorageEngine if present
    if (this._pagedStorage) {
      for (const ax of axioms) {
        this._mirrorAxiomToPaged(ax);
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

  /** Rebuilds the attached WASM ontology store from `_axiomsBySource` to guarantee JS/WASM parity. */
  private _resyncWasmStore(): void {
    if (!this._wasmInstance?.ontology_clear || !this._wasmInstance.ontology_addAxiom64) return;
    this._wasmInstance.ontology_clear();
    this._entityIriMap.clear();
    this._iriEntityMap.clear();
    for (const [srcLang, langAxioms] of this._axiomsBySource) {
      const langId = srcLang === "modelica" ? 1 : srcLang === "sysml2" ? 2 : srcLang === "step" ? 3 : 0;
      for (const ax of langAxioms) {
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
  }

  /** Replaces all axioms for `sourceLang` with `axioms` and returns the resulting delta. */
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
    this._resyncWasmStore();
    this._revision++;
    return delta;
  }

  /** Clears axioms for `sourceLang`, or all languages if omitted. */
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
    if (this._wasmInstance?.ontology_clear) {
      if (this._axiomsBySource.size === 0) {
        this._wasmInstance.ontology_clear();
        this._entityIriMap.clear();
        this._iriEntityMap.clear();
      } else {
        this._resyncWasmStore();
      }
    }
    this._revision++;
  }

  /** Projects all registered source languages from the attached `WorkspaceIndex` into OWL 2 axioms. */
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

  /** Projects symbols from `language` in the attached `WorkspaceIndex` into OWL 2 axioms. */
  projectLanguage(language: string): OWL2AxiomDelta {
    if (!this._workspace) return { assertions: [], retractions: [] };
    const projected = projectWorkspaceLanguageSymbols(this._workspace, language);
    if (!projected) return { assertions: [], retractions: [] };
    return this.setAxioms(language, projected);
  }

  /** Projects 3D CAD bounding envelopes into RCC-8 spatial OWL 2 axioms under the `"step"` partition. */
  projectCadEnvelopes(boxes: readonly CadBoundingBox[]): OWL2AxiomDelta {
    const axioms = projectCadEnvelopes(boxes);
    return this.setAxioms("step", axioms);
  }

  /** Incrementally re-projects any source languages whose workspace version has changed. */
  update(workspaceVersions: Map<string, number>): OWL2AxiomDelta | null {
    let changed = false;
    const assertions: OWL2Axiom[] = [];
    const retractions: OWL2Axiom[] = [];

    const languagesToCheck = new Set<string>([...this._sourceLanguages, ...workspaceVersions.keys()]);

    for (const lang of languagesToCheck) {
      const currentVersion = workspaceVersions.get(lang);
      if (currentVersion === undefined) continue;

      const lastVersion = this._projectedVersions.get(lang);
      if (lastVersion === undefined || currentVersion !== lastVersion) {
        changed = true;
        this._projectedVersions.set(lang, currentVersion);
        this.registerSourceLanguage(lang);
        const delta = this.projectLanguage(lang);
        assertions.push(...delta.assertions);
        retractions.push(...delta.retractions);
      }
    }

    if (!changed) return null;
    const combinedDelta: OWL2AxiomDelta = { assertions, retractions };
    this._lastDelta = combinedDelta;
    return combinedDelta;
  }

  /** Queries the native WASM store for whether `subClassHash` is a subclass of `superClassHash`. */
  isSubClassOf(subClassHash: number, superClassHash: number): boolean {
    if (this._wasmInstance?.ontology_isSubClassOf) {
      return this._wasmInstance.ontology_isSubClassOf(subClassHash, superClassHash) !== 0;
    }
    return false;
  }

  /** Queries the native WASM store for global ontology consistency. */
  checkConsistency(): boolean {
    if (this._wasmInstance?.ontology_checkConsistency) {
      return this._wasmInstance.ontology_checkConsistency() !== 0;
    }
    return true;
  }

  /** Runs polynomial EL++ consequence-based saturation rules in the attached WASM store. */
  saturateELRules(): number {
    if (this._wasmInstance?.ontology_saturateELRules) {
      return this._wasmInstance.ontology_saturateELRules();
    }
    return 0;
  }

  /** Runs the full hybrid interleaved saturation fixpoint loop in the attached WASM store. */
  runHybridFixpoint(): number {
    if (this._wasmInstance?.ontology_runHybridFixpoint) {
      return this._wasmInstance.ontology_runHybridFixpoint();
    }
    return 0;
  }

  /** Recomputes the O(1) Euler-interval dominance index for class subsumption in WASM. */
  computeIntervalIndex(): void {
    this._wasmInstance?.ontology_computeIntervalIndex?.();
  }

  /** Computes the transitive closure of `propertyIri` from `fromIri` via the WASM SPO index. */
  getTransitiveClosure(propertyIri: string, fromIri: string): PropertyChainResult {
    const wasm = this._wasmInstance;
    if (wasm?.ontology_getTransitiveClosureWithPath && wasm.ontology_getQueryBuffer && wasm.memory) {
      const propId = this._iriEntityMap.get(propertyIri);
      const fromId = this._iriEntityMap.get(fromIri);
      if (propId === undefined || fromId === undefined) {
        return { propertyIri, sourceIri: fromIri, reachable: [], path: [] };
      }
      const reachCount = wasm.ontology_getTransitiveClosureWithPath(propId, fromId);
      if (reachCount === 0) {
        return { propertyIri, sourceIri: fromIri, reachable: [], path: [] };
      }
      const bufPtr = wasm.ontology_getQueryBuffer();
      const headerView = new Uint32Array(wasm.memory.buffer, bufPtr, reachCount + 2);
      const actualReach = headerView[0]!;
      const edgeCount = headerView[actualReach + 1]!;
      const fullView = new Uint32Array(wasm.memory.buffer, bufPtr, actualReach + 2 + edgeCount * 2);
      const reachable: string[] = new Array(actualReach);
      for (let i = 0; i < actualReach; i++) {
        const id = fullView[1 + i]!;
        reachable[i] = this._entityIriMap.get(id) ?? String(id);
      }
      const path: { subjectIri: string; objectIri: string }[] = new Array(edgeCount);
      const edgeBase = actualReach + 2;
      for (let i = 0; i < edgeCount; i++) {
        const sId = fullView[edgeBase + i * 2]!;
        const oId = fullView[edgeBase + i * 2 + 1]!;
        path[i] = {
          subjectIri: this._entityIriMap.get(sId) ?? String(sId),
          objectIri: this._entityIriMap.get(oId) ?? String(oId),
        };
      }
      return { propertyIri, sourceIri: fromIri, reachable, path };
    }
    return { propertyIri, sourceIri: fromIri, reachable: [], path: [] };
  }

  /** Evaluates a SPARQL 1.1 property path expression in WASM linear memory. */
  evaluatePropertyPath(
    propertyIri: string,
    pathOp: PropertyPathOp,
    fromIri: string,
    stepPropertyIri2?: string,
  ): readonly string[] {
    const wasm = this._wasmInstance;
    if (!wasm?.ontology_evaluatePropertyPath || !wasm.ontology_getQueryBuffer || !wasm.memory) {
      return pathOp === "star" ? [fromIri] : [];
    }
    const opCode =
      pathOp === "direct"
        ? 1
        : pathOp === "plus"
          ? 2
          : pathOp === "star"
            ? 3
            : pathOp === "inverse"
              ? 4
              : pathOp === "inverse-plus"
                ? 5
                : pathOp === "sequence"
                  ? 6
                  : pathOp === "alternation"
                    ? 7
                    : 0;
    if (opCode === 0) return [];
    const fromId = this._iriEntityMap.get(fromIri);
    if (fromId === undefined) return pathOp === "star" ? [fromIri] : [];
    const propId = this._iriEntityMap.get(propertyIri);
    const prop2Id = stepPropertyIri2 ? this._iriEntityMap.get(stepPropertyIri2) : undefined;
    if (pathOp === "sequence" && (propId === undefined || prop2Id === undefined)) return [];
    if (pathOp === "alternation" && propId === undefined && prop2Id === undefined) return [];
    if (pathOp !== "alternation" && pathOp !== "sequence" && propId === undefined) {
      return pathOp === "star" ? [fromIri] : [];
    }
    const count = wasm.ontology_evaluatePropertyPath(propId ?? 0, opCode, prop2Id ?? 0, fromId);
    if (count === 0) return pathOp === "star" ? [fromIri] : [];
    const bufPtr = wasm.ontology_getQueryBuffer();
    const raw = new Uint32Array(wasm.memory.buffer, bufPtr, count);
    const out = new Set<string>();
    for (let i = 0; i < count; i++) {
      const id = raw[i]!;
      out.add(this._entityIriMap.get(id) ?? String(id));
    }
    return Array.from(out);
  }

  /** Returns all `ClassDeclaration` axioms in the store. */
  getClassDeclarations(): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "ClassDeclaration");
  }

  /** Returns all `SubClassOf` axioms where `subClassIri === classIri`. */
  getSuperClasses(classIri: string): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "SubClassOf" && a.subClassIri === classIri);
  }

  /** Returns all `SubClassOf` axioms where `superClassIri === classIri`. */
  getSubClasses(classIri: string): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "SubClassOf" && a.superClassIri === classIri);
  }

  /** Returns all `ObjectPropertyDeclaration` axioms in the store. */
  getObjectProperties(): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "ObjectPropertyDeclaration");
  }

  /** Returns all `DataPropertyDeclaration` axioms in the store. */
  getDataProperties(): OWL2Axiom[] {
    return this._axioms.filter((a) => a.type === "DataPropertyDeclaration");
  }

  /** Returns all axioms in the store that reference `iri`. */
  getAxiomsForIri(iri: string): OWL2Axiom[] {
    return this._axioms.filter((a) => axiomReferencesIri(a, iri));
  }

  /** Serializes all axioms in the store to OWL 2 Functional-Style Syntax (FSS). */
  toFunctionalSyntax(): string {
    const lines: string[] = [];
    lines.push("Ontology(<urn:modelscript:unified>");

    for (const axiom of this._axioms) {
      lines.push(`  ${axiomToFSS(axiom)}`);
    }

    lines.push(")");
    return lines.join("\n");
  }

  /** Converts all entity declaration axioms in the store into a synthetic `SymbolIndex`. */
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

  /** Clears all axioms, entity mappings, and WASM state in the store. */
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
