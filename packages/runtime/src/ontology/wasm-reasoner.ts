// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WASM-Backed OWL 2 DL / EL++ / SROIQ(D), SWRL, and SHACL Reasoner and
 * Incremental `OntologyBuilder` Coordinator.
 */

import { axiomKey, axiomToTypeAndIris, extractBotLocalityModuleFromAxioms, hashIri64 } from "./axiom-utils.js";
import {
  bgpIndexAddFact,
  buildBgpIndex,
  estimateTripleCardinalityOnIndex,
  evaluatePropertyPathInMemory,
  matchTriplesLiveOnIndex,
  queryBgpOnIndex,
} from "./bgp-engine.js";
import { buildJustificationOnState, checkConsistencyOnState } from "./consistency-checker.js";
import type {
  BgpQuery,
  BgpQueryResult,
  ClassificationResult,
  ConsistencyResult,
  DLQuery,
  DLQueryResult,
  IOWL2OntologyStore,
  IOWLReasoner,
  OWL2Axiom,
  OWL2AxiomDelta,
  OWL2DataPropertyAssertion,
  OWL2LinearConstraint,
  OWL2NegativeDataPropertyAssertion,
  OWL2NegativeObjectPropertyAssertion,
  OWL2QualifiedCardinality,
  OWL2SubPropertyChainOf,
  OWL2SwrlRule,
  OntologyEvent,
  OntologyEventListener,
  PropertyChainResult,
  PropertyPathOp,
  ReasonerStatus,
  SHACLNodeShape,
  SHACLViolation,
  SWRLAtom,
  SubsumptionResult,
  TaxonomyNode,
  WasmOntologyInstance,
} from "./owl2-types.js";
import { clearReasonerState, indexAxiomIntoState, removeAxiomFromState } from "./reasoner-index.js";
import {
  computeAllSuperClassesInState,
  ensureClassInState,
  isDifferentInState,
  unifyIndividualsInState,
  type BgpCompiledIndex,
  type ClassNode,
  type PropertyEdge,
  type ReasonerState,
} from "./reasoner-state.js";
import { executeShaclRulesOnState, getPropertyValuesOnState, validateShaclOnState } from "./shacl-validator.js";
import { applySwrlHeadAtom, evaluateSwrlBody } from "./swrl-engine.js";

/**
 * OWL 2 DL / EL++ / SROIQ(D), SWRL, and SHACL reasoner backed by WebAssembly and indexed graph structures.
 */
export class WasmOntologyReasoner implements IOWLReasoner {
  /** Current lifecycle status of the reasoner. */
  private _status: ReasonerStatus = "idle";
  /** Active list of asserted and inferred OWL 2 axioms. */
  private _axioms: OWL2Axiom[] = [];

  /** Map from class IRI to its taxonomy node. */
  private classes = new Map<string, ClassNode>();
  /** Set of canonical `classA|classB` disjoint class pairs. */
  private disjointPairs = new Set<string>();
  /** Declared object property IRIs. */
  private objectProperties = new Set<string>();
  /** Declared data property IRIs. */
  private dataProperties = new Set<string>();
  /** Object properties declared transitive. */
  private transitiveProperties = new Set<string>();
  /** Object properties declared functional. */
  private functionalObjectProperties = new Set<string>();
  /** Equivalence classes of individuals unified via `SameIndividual` or functional roles. */
  private sameIndividualGroups = new Map<string, Set<string>>();

  /** Map from individual IRI to its set of asserted and inferred class IRIs. */
  private individualTypes = new Map<string, Set<string>>();
  /** Map from object property IRI to its asserted/inferred edges. */
  private objectPropertyAssertions = new Map<string, PropertyEdge[]>();
  /** Map from data property IRI to its subject-value assertions. */
  private dataPropertyAssertions = new Map<string, { subjectIri: string; value: string }[]>();
  /** Data properties declared functional. */
  private functionalDataProperties = new Set<string>();
  /** Object properties declared inverse-functional. */
  private inverseFunctionalObjectProperties = new Set<string>();
  /** Object properties declared reflexive. */
  private reflexiveProperties = new Set<string>();
  /** Object properties declared asymmetric. */
  private asymmetricProperties = new Set<string>();
  /** Object properties declared irreflexive. */
  private irreflexiveProperties = new Set<string>();
  /** Canonical pairs `prop1|prop2` of disjoint object properties. */
  private disjointPropertyPairs = new Set<string>();
  /** Sub-object-property hierarchy edges (`subProp -> Set<superProp>`). */
  private subObjectPropertyEdges = new Map<string, Set<string>>();
  /** Sub-data-property hierarchy edges (`subProp -> Set<superProp>`). */
  private subDataPropertyEdges = new Map<string, Set<string>>();
  /** Object property domain restrictions (`prop -> Set<domainClass>`). */
  private objectPropertyDomains = new Map<string, Set<string>>();
  /** Object property range restrictions (`prop -> Set<rangeClass>`). */
  private objectPropertyRanges = new Map<string, Set<string>>();
  /** Data property domain restrictions (`prop -> Set<domainClass>`). */
  private dataPropertyDomains = new Map<string, Set<string>>();
  /** Data property range restrictions (`prop -> Set<rangeDatatype>`). */
  private dataPropertyRanges = new Map<string, Set<string>>();
  /** Asserted negative object property assertions. */
  private negativeObjectAssertions: OWL2NegativeObjectPropertyAssertion[] = [];
  /** Asserted negative data property assertions. */
  private negativeDataAssertions: OWL2NegativeDataPropertyAssertion[] = [];
  /** Raw data property assertions preserving numeric interval bounds and comparison operators. */
  private rawDataPropertyAssertions: OWL2DataPropertyAssertion[] = [];
  /** Role composition chain axioms (`R1 o ... o Rn SubPropertyOf S`). */
  private subPropertyChains: OWL2SubPropertyChainOf[] = [];
  /** Qualified cardinality restrictions (`>= n R.C`, `<= n R.C`, `= n R.C`). */
  private qualifiedCardinalities: OWL2QualifiedCardinality[] = [];
  /** Multivariate linear arithmetic constraints over data properties. */
  private linearConstraints: OWL2LinearConstraint[] = [];
  /** Nominal class definitions (`classIri -> Set<individualIri>`). */
  private objectOneOfMap = new Map<string, Set<string>>();
  /** Canonical `ind1|ind2` pairs declared `DifferentIndividuals`. */
  private differentIndividualPairs = new Set<string>();
  /** Active DL-safe SWRL rules. */
  private swrlRules: OWL2SwrlRule[] = [];

  /** Whether the ontology has been classified since the last axiom mutation. */
  private _classified = false;
  /** Monotonically increasing revision counter incremented on every ontology mutation. */
  private _revision = 0;
  /** Lazily compiled covering index for BGP conjunctive queries. */
  private _bgpIndex: BgpCompiledIndex | null = null;
  /** Optional native WebAssembly ontology instance. */
  private _wasmInstance: WasmOntologyInstance | null = null;
  /** Reverse IRI lookup table for WASM entity IDs synchronized by this reasoner. */
  private _wasmIriToId = new Map<string, number>();
  /** Forward IRI lookup table for WASM entity IDs synchronized by this reasoner. */
  private _wasmIdToIri = new Map<number, string>();
  /** True if TS-only classification rules inferred object property edges not yet mirrored in WASM. */
  private _wasmEdgesDirty = false;

  /** Live shared view of the indexed knowledge base passed to reasoning subsystems without copying. */
  private readonly _kb: ReasonerState = {
    axioms: this._axioms,
    classes: this.classes,
    disjointPairs: this.disjointPairs,
    objectProperties: this.objectProperties,
    dataProperties: this.dataProperties,
    transitiveProperties: this.transitiveProperties,
    functionalObjectProperties: this.functionalObjectProperties,
    sameIndividualGroups: this.sameIndividualGroups,
    individualTypes: this.individualTypes,
    objectPropertyAssertions: this.objectPropertyAssertions,
    dataPropertyAssertions: this.dataPropertyAssertions,
    functionalDataProperties: this.functionalDataProperties,
    inverseFunctionalObjectProperties: this.inverseFunctionalObjectProperties,
    reflexiveProperties: this.reflexiveProperties,
    asymmetricProperties: this.asymmetricProperties,
    irreflexiveProperties: this.irreflexiveProperties,
    disjointPropertyPairs: this.disjointPropertyPairs,
    subObjectPropertyEdges: this.subObjectPropertyEdges,
    subDataPropertyEdges: this.subDataPropertyEdges,
    objectPropertyDomains: this.objectPropertyDomains,
    objectPropertyRanges: this.objectPropertyRanges,
    dataPropertyDomains: this.dataPropertyDomains,
    dataPropertyRanges: this.dataPropertyRanges,
    negativeObjectAssertions: this.negativeObjectAssertions,
    negativeDataAssertions: this.negativeDataAssertions,
    rawDataPropertyAssertions: this.rawDataPropertyAssertions,
    subPropertyChains: this.subPropertyChains,
    qualifiedCardinalities: this.qualifiedCardinalities,
    linearConstraints: this.linearConstraints,
    objectOneOfMap: this.objectOneOfMap,
    differentIndividualPairs: this.differentIndividualPairs,
    swrlRules: this.swrlRules,
  };

  /** Counts total asserted/inferred object property assertion edges currently held in TS maps. */
  private _countObjectPropertyEdges(): number {
    let total = 0;
    for (const edges of this.objectPropertyAssertions.values()) {
      total += edges.length;
    }
    return total;
  }

  /** Creates a new `WasmOntologyReasoner`, optionally bound to a compiled WASM instance. */
  constructor(wasmInstance?: WasmOntologyInstance | null) {
    this._wasmInstance = wasmInstance ?? null;
  }

  /** Binds a compiled WebAssembly ontology module instance to this reasoner. */
  public setWasmInstance(wasmInstance: WasmOntologyInstance): void {
    this._wasmInstance = wasmInstance;
  }

  /** Current lifecycle status of the reasoner. */
  get status(): ReasonerStatus {
    return this._status;
  }

  /** Monotonically increasing revision number of this reasoner state. */
  get revision(): number {
    return this._revision;
  }

  /** Total number of axioms currently loaded in the reasoner. */
  get axiomCount(): number {
    if (this._wasmInstance?.ontology_getAxiomCount) {
      return this._wasmInstance.ontology_getAxiomCount();
    }
    return this._axioms.length;
  }

  /** Initializes the reasoner and transitions its status to `"ready"`. */
  async init(): Promise<void> {
    this._status = "ready";
  }

  /** Interns an IRI into the attached WASM `OntologyStore` entity dictionary. */
  private _internWasmIri(iri: string): number {
    if (!iri || !this._wasmInstance?.ontology_getOrCreateEntity) return 0;
    const existing = this._wasmIriToId.get(iri);
    if (existing !== undefined) return existing;
    const { lo, hi } = hashIri64(iri);
    const id = this._wasmInstance.ontology_getOrCreateEntity(lo, hi);
    this._wasmIriToId.set(iri, id);
    this._wasmIdToIri.set(id, iri);
    return id;
  }

  /** Mirrors a batch delta into the attached WASM `OntologyStore` via `ontology_applyDelta`. */
  private _syncDeltaToWasm(delta: OWL2AxiomDelta): void {
    const wasm = this._wasmInstance;
    if (!wasm?.ontology_applyDelta || !wasm.memory || !wasm.alloc || !wasm.free) return;

    const addRecords: number[] = [];
    for (const ax of delta.assertions) {
      const m = axiomToTypeAndIris(ax);
      if (!m) continue;
      const sId = m.sIri ? this._internWasmIri(m.sIri) : 0;
      const pId = m.pIri ? this._internWasmIri(m.pIri) : 0;
      const oId = m.oIri ? this._internWasmIri(m.oIri) : 0;
      addRecords.push(m.type & 0xffff, sId, pId, oId, m.flags ?? 0, m.extra ?? 0);
    }

    const retractRecords: number[] = [];
    for (const ax of delta.retractions) {
      const m = axiomToTypeAndIris(ax);
      if (!m) continue;
      const sId = m.sIri ? this._internWasmIri(m.sIri) : 0;
      const pId = m.pIri ? this._internWasmIri(m.pIri) : 0;
      const oId = m.oIri ? this._internWasmIri(m.oIri) : 0;
      retractRecords.push(m.type & 0xffff, sId, pId, oId, m.flags ?? 0, m.extra ?? 0);
    }

    const addCount = addRecords.length / 6;
    const retractCount = retractRecords.length / 6;
    if (addCount === 0 && retractCount === 0) return;

    const addPtr = addCount > 0 ? wasm.alloc(addRecords.length * 4) : 0;
    const retPtr = retractCount > 0 ? wasm.alloc(retractRecords.length * 4) : 0;
    try {
      if (addCount > 0 && addPtr !== 0) {
        new Uint32Array(wasm.memory.buffer, addPtr, addRecords.length).set(addRecords);
      }
      if (retractCount > 0 && retPtr !== 0) {
        new Uint32Array(wasm.memory.buffer, retPtr, retractRecords.length).set(retractRecords);
      }
      wasm.ontology_applyDelta(addCount, addPtr, retractCount, retPtr);
    } finally {
      if (addPtr !== 0) wasm.free(addPtr);
      if (retPtr !== 0) wasm.free(retPtr);
    }
  }

  /** Replaces the current ontology with the given axioms and indexes them. */
  loadOntology(axioms: readonly OWL2Axiom[]): void {
    this._status = "loading";
    this.clear();
    for (const axiom of axioms) {
      this._axioms.push(axiom);
      this.indexAxiom(axiom);
    }

    // Mirror into attached WASM store if present
    if (this._wasmInstance?.ontology_clear && this._wasmInstance.ontology_addAxiom64) {
      this._wasmInstance.ontology_clear();
      this._wasmIriToId.clear();
      this._wasmIdToIri.clear();
      for (const ax of axioms) {
        const m = axiomToTypeAndIris(ax);
        if (!m) continue;
        const s = m.sIri ? hashIri64(m.sIri) : { lo: 0, hi: 0 };
        const p = m.pIri ? hashIri64(m.pIri) : { lo: 0, hi: 0 };
        const o = m.oIri ? hashIri64(m.oIri) : { lo: 0, hi: 0 };
        this._wasmInstance.ontology_addAxiom64(
          m.type,
          0,
          s.lo,
          s.hi,
          p.lo,
          p.hi,
          o.lo,
          o.hi,
          m.flags ?? 0,
          m.extra ?? 0,
        );
        if (m.sIri) this._internWasmIri(m.sIri);
        if (m.pIri) this._internWasmIri(m.pIri);
        if (m.oIri) this._internWasmIri(m.oIri);
      }
    }

    this._wasmEdgesDirty = false;
    this._classified = false;
    this._bgpIndex = null;
    this._revision++;
    this._status = "ready";
  }

  /** Returns true if the current ontology + delta can be maintained via fast O(Δ) incremental updates. */
  private _canApplyIncrementally(delta: OWL2AxiomDelta): boolean {
    if (!this._classified) return false;
    if (
      this.swrlRules.length > 0 ||
      this.functionalObjectProperties.size > 0 ||
      this.inverseFunctionalObjectProperties.size > 0 ||
      this.reflexiveProperties.size > 0 ||
      this.subPropertyChains.length > 0 ||
      this.objectOneOfMap.size > 0 ||
      this.sameIndividualGroups.size > 0 ||
      this.disjointPairs.size > 0 ||
      this.disjointPropertyPairs.size > 0 ||
      this.asymmetricProperties.size > 0 ||
      this.irreflexiveProperties.size > 0 ||
      this.differentIndividualPairs.size > 0
    ) {
      return false;
    }
    // Retractions with active sub-property or domain/range rules fall back to full classify for exactness;
    // additive-only deltas propagate sub-properties and domains/ranges incrementally in O(Δ)!
    const hasPropRules =
      this.subObjectPropertyEdges.size > 0 ||
      this.subDataPropertyEdges.size > 0 ||
      this.objectPropertyDomains.size > 0 ||
      this.objectPropertyRanges.size > 0 ||
      this.dataPropertyDomains.size > 0 ||
      this.dataPropertyRanges.size > 0;
    if (delta.retractions.length > 0 && hasPropRules) {
      return false;
    }
    const isSimple = (ax: OWL2Axiom): boolean =>
      ax.type === "ClassDeclaration" ||
      ax.type === "SubClassOf" ||
      ax.type === "ClassAssertion" ||
      ax.type === "IndividualDeclaration" ||
      ax.type === "ObjectPropertyDeclaration" ||
      ax.type === "DataPropertyDeclaration" ||
      ax.type === "ObjectPropertyAssertion" ||
      ax.type === "DataPropertyAssertion";

    for (const ax of delta.assertions) {
      if (!isSimple(ax)) return false;
    }
    for (const ax of delta.retractions) {
      if (!isSimple(ax)) return false;
    }
    return true;
  }

  /** Appends a single fact into the live `_bgpIndex` if already compiled. */
  private _bgpIndexAddFact(s: string, p: string, o: string): void {
    if (!this._bgpIndex) return;
    bgpIndexAddFact(this._bgpIndex, s, p, o);
  }

  /** Incrementally applies a set of axiom retractions and assertions. */
  applyDelta(delta: OWL2AxiomDelta): void {
    this._revision++;
    const canIncremental = this._canApplyIncrementally(delta);

    // Sync to attached WASM store using batched DRed (Phase 1 over-delete + Phase 2 once)
    this._syncDeltaToWasm(delta);

    if (!canIncremental) {
      for (const axiom of delta.retractions) {
        this.removeAxiom(axiom);
      }
      for (const axiom of delta.assertions) {
        this._axioms.push(axiom);
        this.indexAxiom(axiom);
      }
      this._classified = false;
      this._bgpIndex = null;
      return;
    }

    // Fast O(Δ) Incremental Maintenance (DRed for retractions + incremental closure for assertions)
    const affectedClasses = new Set<string>();
    const affectedIndividuals = new Set<string>();

    // 1. Retractions (local DRed)
    if (delta.retractions.length > 0) {
      this._bgpIndex = null; // rebuild lazily on next BGP query
      for (const axiom of delta.retractions) {
        if (axiom.type === "SubClassOf") {
          const subNode = this.classes.get(axiom.subClassIri);
          affectedClasses.add(axiom.subClassIri);
          if (subNode?.allSubClasses) {
            for (const desc of subNode.allSubClasses) affectedClasses.add(desc);
          }
        } else if (axiom.type === "ClassAssertion") {
          affectedIndividuals.add(axiom.individualIri);
        }
        this.removeAxiom(axiom);
      }

      // Phase 1+2 local DRed for affected classes only
      if (affectedClasses.size > 0) {
        for (const cls of affectedClasses) {
          const node = this.classes.get(cls);
          if (!node) continue;
          if (node.allSuperClasses) {
            for (const oldSup of node.allSuperClasses) {
              this.classes.get(oldSup)?.allSubClasses?.delete(cls);
            }
          }
          node.allSuperClasses = null;
        }
        for (const cls of affectedClasses) {
          const supers = this.computeAllSuperClasses(cls);
          for (const sup of supers) {
            const supNode = this.ensureClass(sup);
            if (!supNode.allSubClasses) supNode.allSubClasses = new Set();
            supNode.allSubClasses.add(cls);
          }
        }
        // Any individual currently typed with an affected class needs local type re-derivation
        for (const [ind, types] of this.individualTypes) {
          for (const cls of affectedClasses) {
            if (types.has(cls)) {
              affectedIndividuals.add(ind);
              break;
            }
          }
        }
      }

      // Local type re-derivation for affected individuals only
      if (affectedIndividuals.size > 0) {
        for (const ind of affectedIndividuals) {
          const types = this.individualTypes.get(ind);
          if (types) types.clear();
        }
        for (const ax of this._axioms) {
          if (ax.type === "ClassAssertion" && affectedIndividuals.has(ax.individualIri)) {
            let types = this.individualTypes.get(ax.individualIri);
            if (!types) {
              types = new Set();
              this.individualTypes.set(ax.individualIri, types);
            }
            types.add(ax.classIri);
            const clsNode = this.classes.get(ax.classIri);
            if (clsNode?.allSuperClasses) {
              for (const sup of clsNode.allSuperClasses) types.add(sup);
            }
          }
        }
      }
    }

    // 2. Assertions (O(Δ) incremental closure propagation + live _bgpIndex update)
    for (const axiom of delta.assertions) {
      this._axioms.push(axiom);
      this.indexAxiom(axiom);

      if (axiom.type === "ClassDeclaration") {
        const node = this.ensureClass(axiom.iri);
        if (!node.allSuperClasses) node.allSuperClasses = new Set();
        if (!node.allSubClasses) node.allSubClasses = new Set();
      } else if (axiom.type === "SubClassOf") {
        const subNode = this.ensureClass(axiom.subClassIri);
        const supNode = this.ensureClass(axiom.superClassIri);
        if (!subNode.allSuperClasses) subNode.allSuperClasses = new Set();
        if (!subNode.allSubClasses) subNode.allSubClasses = new Set();
        if (!supNode.allSuperClasses) supNode.allSuperClasses = new Set();
        if (!supNode.allSubClasses) supNode.allSubClasses = new Set();

        const newSupers = new Set<string>([axiom.superClassIri, ...supNode.allSuperClasses]);
        const subGroup = [axiom.subClassIri, ...subNode.allSubClasses];
        for (const desc of subGroup) {
          const dNode = this.ensureClass(desc);
          if (!dNode.allSuperClasses) dNode.allSuperClasses = new Set();
          for (const sup of newSupers) {
            if (sup === desc) continue;
            if (!dNode.allSuperClasses.has(sup)) {
              dNode.allSuperClasses.add(sup);
              const sNode = this.ensureClass(sup);
              if (!sNode.allSubClasses) sNode.allSubClasses = new Set();
              sNode.allSubClasses.add(desc);
            }
          }
        }
        this._bgpIndexAddFact(axiom.subClassIri, "rdfs:subClassOf", axiom.superClassIri);

        // Propagate new superclasses to existing individuals of subGroup
        const subSet = new Set(subGroup);
        for (const [ind, types] of this.individualTypes) {
          let matched = false;
          for (const d of subSet) {
            if (types.has(d)) {
              matched = true;
              break;
            }
          }
          if (matched) {
            for (const sup of newSupers) {
              if (!types.has(sup)) {
                types.add(sup);
                this._bgpIndexAddFact(ind, "rdf:type", sup);
              }
            }
          }
        }
      } else if (axiom.type === "ClassAssertion") {
        const types = this.individualTypes.get(axiom.individualIri)!;
        this._bgpIndexAddFact(axiom.individualIri, "rdf:type", axiom.classIri);
        const clsNode = this.classes.get(axiom.classIri);
        if (clsNode?.allSuperClasses) {
          for (const sup of clsNode.allSuperClasses) {
            types.add(sup);
            this._bgpIndexAddFact(axiom.individualIri, "rdf:type", sup);
          }
        }
      } else if (axiom.type === "ObjectPropertyAssertion") {
        // Incrementally propagate SubObjectPropertyOf closure + ObjectPropertyDomain/Range + superclasses
        const propQueue = [axiom.propertyIri];
        const visitedProps = new Set<string>([axiom.propertyIri]);
        const addTypeAndSupers = (ind: string, cls: string) => {
          let types = this.individualTypes.get(ind);
          if (!types) {
            types = new Set();
            this.individualTypes.set(ind, types);
          }
          if (!types.has(cls)) {
            types.add(cls);
            this._bgpIndexAddFact(ind, "rdf:type", cls);
          }
          const clsNode = this.classes.get(cls);
          if (clsNode?.allSuperClasses) {
            for (const sup of clsNode.allSuperClasses) {
              if (!types.has(sup)) {
                types.add(sup);
                this._bgpIndexAddFact(ind, "rdf:type", sup);
              }
            }
          }
        };

        while (propQueue.length > 0) {
          const pIri = propQueue.pop()!;
          const edges = this.objectPropertyAssertions.get(pIri) ?? [];
          if (!edges.some((e) => e.subjectIri === axiom.subjectIri && e.objectIri === axiom.objectIri)) {
            edges.push({ subjectIri: axiom.subjectIri, objectIri: axiom.objectIri });
            this.objectPropertyAssertions.set(pIri, edges);
          }
          this._bgpIndexAddFact(axiom.subjectIri, pIri, axiom.objectIri);

          const doms = this.objectPropertyDomains.get(pIri);
          if (doms) {
            for (const d of doms) addTypeAndSupers(axiom.subjectIri, d);
          }
          const rngs = this.objectPropertyRanges.get(pIri);
          if (rngs) {
            for (const r of rngs) addTypeAndSupers(axiom.objectIri, r);
          }
          const supProps = this.subObjectPropertyEdges.get(pIri);
          if (supProps) {
            for (const sp of supProps) {
              if (!visitedProps.has(sp)) {
                visitedProps.add(sp);
                propQueue.push(sp);
              }
            }
          }
        }
      } else if (axiom.type === "DataPropertyAssertion") {
        // Incrementally propagate SubDataPropertyOf closure + DataPropertyDomain
        const propQueue = [axiom.propertyIri];
        const visitedProps = new Set<string>([axiom.propertyIri]);
        while (propQueue.length > 0) {
          const pIri = propQueue.pop()!;
          const asserts = this.dataPropertyAssertions.get(pIri) ?? [];
          if (!asserts.some((a) => a.subjectIri === axiom.subjectIri && a.value === axiom.value)) {
            asserts.push({ subjectIri: axiom.subjectIri, value: axiom.value });
            this.dataPropertyAssertions.set(pIri, asserts);
          }
          this._bgpIndexAddFact(axiom.subjectIri, pIri, axiom.value);

          const doms = this.dataPropertyDomains.get(pIri);
          if (doms) {
            let types = this.individualTypes.get(axiom.subjectIri);
            if (!types) {
              types = new Set();
              this.individualTypes.set(axiom.subjectIri, types);
            }
            for (const d of doms) {
              if (!types.has(d)) {
                types.add(d);
                this._bgpIndexAddFact(axiom.subjectIri, "rdf:type", d);
              }
              const clsNode = this.classes.get(d);
              if (clsNode?.allSuperClasses) {
                for (const sup of clsNode.allSuperClasses) {
                  if (!types.has(sup)) {
                    types.add(sup);
                    this._bgpIndexAddFact(axiom.subjectIri, "rdf:type", sup);
                  }
                }
              }
            }
          }
          const supProps = this.subDataPropertyEdges.get(pIri);
          if (supProps) {
            for (const sp of supProps) {
              if (!visitedProps.has(sp)) {
                visitedProps.add(sp);
                propQueue.push(sp);
              }
            }
          }
        }
      }
    }

    this._classified = true;
    this._status = "ready";
  }

  /**
   * Classifies the ontology by saturating class/property hierarchies, nominals, SWRL rules,
   * and checking global consistency.
   */
  classify(): void {
    this._status = "classifying";
    this._bgpIndex = null;
    const preClassifyEdgeCount = this._wasmInstance ? this._countObjectPropertyEdges() : 0;

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

    // Outer interleaved fixpoint loop so inferences from sub-properties, inverses,
    // symmetric properties, domains/ranges, functional unification, universal restrictions,
    // property chains, nominals, and SWRL rules feed back into each other.
    let outerChanged = true;
    let outerRounds = 0;
    while (outerChanged && outerRounds < 10) {
      outerChanged = false;
      outerRounds++;

      // Saturate SubObjectPropertyOf and SubDataPropertyOf hierarchies
      if (this.subObjectPropertyEdges.size > 0) {
        let propChanged = true;
        let propPasses = 0;
        while (propChanged && propPasses < 25) {
          propChanged = false;
          propPasses++;
          for (const [subP, superSet] of this.subObjectPropertyEdges) {
            const subEdges = this.objectPropertyAssertions.get(subP);
            if (!subEdges || subEdges.length === 0) continue;
            for (const supP of superSet) {
              const supEdges = this.objectPropertyAssertions.get(supP) ?? [];
              for (const e of subEdges) {
                if (!supEdges.some((ex) => ex.subjectIri === e.subjectIri && ex.objectIri === e.objectIri)) {
                  supEdges.push({ subjectIri: e.subjectIri, objectIri: e.objectIri });
                  propChanged = true;
                  outerChanged = true;
                }
              }
              this.objectPropertyAssertions.set(supP, supEdges);
            }
          }
        }
      }

      if (this.subDataPropertyEdges.size > 0) {
        let dataPropChanged = true;
        let dataPropPasses = 0;
        while (dataPropChanged && dataPropPasses < 25) {
          dataPropChanged = false;
          dataPropPasses++;
          for (const [subP, superSet] of this.subDataPropertyEdges) {
            const subAsserts = this.dataPropertyAssertions.get(subP);
            if (!subAsserts || subAsserts.length === 0) continue;
            for (const supP of superSet) {
              const supAsserts = this.dataPropertyAssertions.get(supP) ?? [];
              for (const a of subAsserts) {
                if (!supAsserts.some((ex) => ex.subjectIri === a.subjectIri && ex.value === a.value)) {
                  supAsserts.push({ subjectIri: a.subjectIri, value: a.value });
                  dataPropChanged = true;
                  outerChanged = true;
                }
              }
              this.dataPropertyAssertions.set(supP, supAsserts);
            }
          }
        }
      }

      // Reflexive object properties: R(x, x) for all known individuals x
      for (const propIri of this.reflexiveProperties) {
        const edges = this.objectPropertyAssertions.get(propIri) ?? [];
        for (const indIri of this.individualTypes.keys()) {
          if (!edges.some((e) => e.subjectIri === indIri && e.objectIri === indIri)) {
            edges.push({ subjectIri: indIri, objectIri: indIri });
            outerChanged = true;
          }
        }
        this.objectPropertyAssertions.set(propIri, edges);
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
                if (this.unifyIndividuals(o1, o2)) outerChanged = true;
              }
            }
          }
        }
      }

      // InverseFunctional property unification
      for (const propIri of this.inverseFunctionalObjectProperties) {
        const edges = this.objectPropertyAssertions.get(propIri) ?? [];
        const byObject = new Map<string, string[]>();
        for (const e of edges) {
          const list = byObject.get(e.objectIri) ?? [];
          list.push(e.subjectIri);
          byObject.set(e.objectIri, list);
        }
        for (const [, subjs] of byObject) {
          if (subjs.length > 1) {
            for (let i = 0; i < subjs.length; i++) {
              for (let j = i + 1; j < subjs.length; j++) {
                const s1 = subjs[i]!;
                const s2 = subjs[j]!;
                if (this.unifyIndividuals(s1, s2)) outerChanged = true;
              }
            }
          }
        }
      }

      // ObjectPropertyDomain, ObjectPropertyRange, DataPropertyDomain propagation
      for (const [propIri, domains] of this.objectPropertyDomains) {
        const edges = this.objectPropertyAssertions.get(propIri) ?? [];
        for (const e of edges) {
          const types = this.individualTypes.get(e.subjectIri) ?? new Set();
          for (const domIri of domains) {
            if (!types.has(domIri)) {
              types.add(domIri);
              outerChanged = true;
            }
          }
          this.individualTypes.set(e.subjectIri, types);
        }
      }
      for (const [propIri, ranges] of this.objectPropertyRanges) {
        const edges = this.objectPropertyAssertions.get(propIri) ?? [];
        for (const e of edges) {
          const types = this.individualTypes.get(e.objectIri) ?? new Set();
          for (const rngIri of ranges) {
            if (!types.has(rngIri)) {
              types.add(rngIri);
              outerChanged = true;
            }
          }
          this.individualTypes.set(e.objectIri, types);
        }
      }
      for (const [propIri, domains] of this.dataPropertyDomains) {
        const asserts = this.dataPropertyAssertions.get(propIri) ?? [];
        for (const a of asserts) {
          const types = this.individualTypes.get(a.subjectIri) ?? new Set();
          for (const domIri of domains) {
            if (!types.has(domIri)) {
              types.add(domIri);
              outerChanged = true;
            }
          }
          this.individualTypes.set(a.subjectIri, types);
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
          for (const add of toAdd) {
            edges.push(add);
            outerChanged = true;
          }
          this.objectPropertyAssertions.set(axiom.propertyIri, edges);
        } else if (axiom.type === "InverseObjectProperty") {
          const edgesR = this.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
          const edgesS = this.objectPropertyAssertions.get(axiom.inversePropertyIri) ?? [];
          for (const e of edgesR) {
            if (!edgesS.some((ex) => ex.subjectIri === e.objectIri && ex.objectIri === e.subjectIri)) {
              edgesS.push({ subjectIri: e.objectIri, objectIri: e.subjectIri });
              outerChanged = true;
            }
          }
          for (const e of edgesS) {
            if (!edgesR.some((ex) => ex.subjectIri === e.objectIri && ex.objectIri === e.subjectIri)) {
              edgesR.push({ subjectIri: e.objectIri, objectIri: e.subjectIri });
              outerChanged = true;
            }
          }
          this.objectPropertyAssertions.set(axiom.propertyIri, edgesR);
          this.objectPropertyAssertions.set(axiom.inversePropertyIri, edgesS);
        } else if (axiom.type === "UniversalRestriction") {
          const edges = this.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
          for (const e of edges) {
            if (!axiom.classIri || (this.individualTypes.get(e.subjectIri)?.has(axiom.classIri) ?? false)) {
              const types = this.individualTypes.get(e.objectIri) ?? new Set();
              if (!types.has(axiom.targetClassIri)) {
                types.add(axiom.targetClassIri);
                outerChanged = true;
              }
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
                outerChanged = true;
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
                outerChanged = true;
              }
            }
            this.objectPropertyAssertions.set(chainAxiom.superPropertyIri, targetEdges);
          }
        }
      }

      // Propagate individual types along class hierarchy
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
        for (const t of inferredTypes) {
          if (!types.has(t)) {
            types.add(t);
            outerChanged = true;
          }
        }
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
            if (nominalArr.length === 1) {
              const singletonNominal = nominalArr[0]!;
              for (const [ind, types] of this.individualTypes) {
                if (types.has(classIri) && ind !== singletonNominal) {
                  if (this.unifyIndividuals(ind, singletonNominal)) {
                    nomChanged = true;
                    outerChanged = true;
                  }
                }
              }
            }

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
                  if (this.unifyIndividuals(ind, remaining)) {
                    nomChanged = true;
                    outerChanged = true;
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
                  outerChanged = true;
                }
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

    if (this._wasmInstance) {
      if (this._countObjectPropertyEdges() !== preClassifyEdgeCount) {
        this._wasmEdgesDirty = true;
      }
      if (typeof this._wasmInstance.ontology_saturateELRules === "function") {
        this._wasmInstance.ontology_saturateELRules();
      }
      if (typeof this._wasmInstance.ontology_computeIntervalIndex === "function") {
        this._wasmInstance.ontology_computeIntervalIndex();
      }
    }

    const consistency = this.checkConsistencyInternal();
    this._status = consistency.isConsistent ? "ready" : "inconsistent";
    this._classified = true;
    this._ensureBgpIndex();
  }

  /** Unifies two individuals into the same equivalence group and merges their class assertions. */

  /** Unifies two individuals via `SameIndividual` equivalence and merges their inferred class memberships. */
  private unifyIndividuals(ind1: string, ind2: string): boolean {
    return unifyIndividualsInState(this.sameIndividualGroups, this.individualTypes, ind1, ind2);
  }

  /** Checks whether two individuals (or their equivalence representatives) are asserted `DifferentIndividuals`. */
  private isDifferent(ind1: string, ind2: string): boolean {
    return isDifferentInState(this.sameIndividualGroups, this.differentIndividualPairs, ind1, ind2);
  }

  /** Evaluates the conjunctive body atoms of a DL-safe SWRL rule and returns all satisfying variable bindings. */
  private evaluateSwrlBody(body: readonly SWRLAtom[]): Record<string, string>[] {
    return evaluateSwrlBody(this._kb, body);
  }

  /** Materializes a SWRL rule head atom using the bound variables in `env`, returning true if a new fact was added. */
  private applySwrlHeadAtom(headAtom: SWRLAtom, env: Record<string, string>): boolean {
    return applySwrlHeadAtom(this._kb, headAtom, env);
  }
  /** Clears all loaded axioms and resets the reasoner to `"idle"`. */
  dispose(): void {
    this.clear();
    this._status = "idle";
  }

  /** Tests whether `subClassIri` is subsumed by `superClassIri` and builds a justification trail if true. */
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

  /** Checks global consistency of the ontology and extracts minimal conflict cores (MUS) if inconsistent. */
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

  /** Computes a single minimal unsatisfiable subset (MUS) using Junker's QuickXplain algorithm. */
  quickXplain(backgroundAxioms?: readonly OWL2Axiom[]): readonly OWL2Axiom[] {
    const bg = backgroundAxioms ? [...backgroundAxioms] : [];
    const bgSet = new Set(bg.map((a) => axiomKey(a)));
    const delta = this._axioms.filter((a) => !bgSet.has(axiomKey(a)));

    if (this.testConsistencySubset([...bg, ...delta])) {
      return [];
    }

    return this.qxRecursive(bg, delta);
  }

  /** Enumerates up to `maxCores` distinct Minimal Unsatisfiable Subsets (MUS) via Reiter's Hitting Set Tree. */
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

  /** Tests whether a candidate subset of axioms is consistent in an isolated temporary reasoner. */
  private testConsistencySubset(axioms: OWL2Axiom[]): boolean {
    const temp = new WasmOntologyReasoner();
    temp.loadOntology(axioms);
    temp.classify();
    return temp.checkConsistencyInternal().isConsistent;
  }

  /** Recursive divide-and-conquer step for Junker's QuickXplain algorithm. */
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

  /** Returns the classified class hierarchy as an array of `TaxonomyNode` descriptors. */
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

  /** Computes the direct (most specific) and all inferred class types for the given individual IRI. */
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

  /** Returns all superclasses of `classIri`. */
  getSuperClasses(classIri: string): readonly string[] {
    if (!this._classified) this.classify();
    const node = this.classes.get(classIri);
    return node?.allSuperClasses ? [...node.allSuperClasses] : [];
  }

  /** Returns all subclasses of `classIri`. */
  getSubClasses(classIri: string): readonly string[] {
    if (!this._classified) this.classify();
    const node = this.classes.get(classIri);
    return node?.allSubClasses ? [...node.allSubClasses] : [];
  }

  /** Returns all asserted and inferred class IRIs for `individualIri`. */
  getIndividualTypes(individualIri: string): readonly string[] {
    if (!this._classified) this.classify();
    const types = this.individualTypes.get(individualIri);
    return types ? [...types] : [];
  }

  /** Computes the transitive closure of `propertyIri` starting from `fromIri` via breadth-first search. */
  getTransitiveClosure(propertyIri: string, fromIri: string): PropertyChainResult {
    const wasm = this._wasmInstance;
    if (
      !this._wasmEdgesDirty &&
      wasm?.ontology_getTransitiveClosureWithPath &&
      wasm.ontology_getQueryBuffer &&
      wasm.memory
    ) {
      const propId = this._wasmIriToId.get(propertyIri);
      const fromId = this._wasmIriToId.get(fromIri);
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
        reachable[i] = this._wasmIdToIri.get(id) ?? String(id);
      }
      const path: { subjectIri: string; objectIri: string }[] = new Array(edgeCount);
      const edgeBase = actualReach + 2;
      for (let i = 0; i < edgeCount; i++) {
        const sId = fullView[edgeBase + i * 2]!;
        const oId = fullView[edgeBase + i * 2 + 1]!;
        path[i] = {
          subjectIri: this._wasmIdToIri.get(sId) ?? String(sId),
          objectIri: this._wasmIdToIri.get(oId) ?? String(oId),
        };
      }
      return { propertyIri, sourceIri: fromIri, reachable, path };
    }

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

  /** Executes a structured `DLQuery` against the classified ontology. */
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

  /** Evaluates a SPARQL 1.1 property path expression from `fromIri` and returns all reachable target IRIs. */
  evaluatePropertyPath(
    propertyIri: string,
    pathOp: PropertyPathOp,
    fromIri: string,
    stepPropertyIri2?: string,
  ): readonly string[] {
    const wasm = this._wasmInstance;
    if (!this._wasmEdgesDirty && wasm?.ontology_evaluatePropertyPath && wasm.ontology_getQueryBuffer && wasm.memory) {
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
      if (opCode !== 0) {
        const fromId = this._wasmIriToId.get(fromIri);
        if (fromId === undefined) {
          return pathOp === "star" ? [fromIri] : [];
        }
        const propId = this._wasmIriToId.get(propertyIri);
        const prop2Id = stepPropertyIri2 ? this._wasmIriToId.get(stepPropertyIri2) : undefined;
        if (pathOp === "sequence") {
          if (propId === undefined || prop2Id === undefined) return [];
        } else if (pathOp === "alternation") {
          if (propId === undefined && prop2Id === undefined) return [];
        } else if (propId === undefined) {
          return pathOp === "star" ? [fromIri] : [];
        }
        const count = wasm.ontology_evaluatePropertyPath(propId ?? 0, opCode, prop2Id ?? 0, fromId);
        if (count === 0) {
          return pathOp === "star" ? [fromIri] : [];
        }
        const bufPtr = wasm.ontology_getQueryBuffer();
        const raw = new Uint32Array(wasm.memory.buffer, bufPtr, count);
        const out = new Set<string>();
        for (let i = 0; i < count; i++) {
          const id = raw[i]!;
          out.add(this._wasmIdToIri.get(id) ?? String(id));
        }
        return Array.from(out);
      }
    }

    return evaluatePropertyPathInMemory(this.objectPropertyAssertions, propertyIri, pathOp, fromIri, stepPropertyIri2);
  }

  /** Lazily builds and caches the 6-way covering index for BGP conjunctive query evaluation. */
  private _ensureBgpIndex(): BgpCompiledIndex {
    if (this._bgpIndex !== null) return this._bgpIndex;
    this._bgpIndex = buildBgpIndex(this._kb);
    return this._bgpIndex;
  }

  /** Evaluates a Basic Graph Pattern (BGP) conjunctive query using selectivity-guided index joins. */
  queryBgp(query: BgpQuery): BgpQueryResult {
    if (!this._classified) this.classify();
    return queryBgpOnIndex(this._ensureBgpIndex(), query);
  }

  /**
   * O(1) cardinality estimate for a triple pattern `(subject, predicate, object)` using
   * the reasoner's 6-way covering index. Used by the cost-based SPARQL join planner.
   */
  estimateTripleCardinality(subject?: string | null, predicate?: string | null, object?: string | null): number {
    if (!this._classified) this.classify();
    return estimateTripleCardinalityOnIndex(this._ensureBgpIndex(), subject, predicate, object);
  }

  /**
   * Live, zero-snapshot triple matcher over the reasoner's classified covering index + taxonomy.
   * Automatically runs `classify()` if dirty and reflects incremental `applyDelta()` mutations immediately.
   */
  *matchTriplesLive(
    subject?: string | null,
    predicate?: string | null,
    object?: string | null,
  ): Iterable<{ s: string; p: string; o: string }> {
    if (!this._classified) this.classify();
    yield* matchTriplesLiveOnIndex(this._ensureBgpIndex(), this.classes, subject, predicate, object);
  }

  /** Returns a minimal sequence of asserted axioms justifying why `subClassIri` is a subclass of `superClassIri`. */
  explain(subClassIri: string, superClassIri: string): readonly OWL2Axiom[] {
    if (!this._classified) this.classify();
    return this.buildJustification(subClassIri, superClassIri);
  }

  /** Indexes a single OWL 2 axiom into the reasoner's internal class, property, and individual tables. */
  private indexAxiom(axiom: OWL2Axiom): void {
    indexAxiomIntoState(this._kb, axiom);
  }

  /** Retracts a single OWL 2 axiom from the reasoner's internal tables. */
  private removeAxiom(axiom: OWL2Axiom): void {
    removeAxiomFromState(this._kb, axiom);
  }

  /** Recursively computes and caches the transitive closure of superclasses for `iri`. */
  private computeAllSuperClasses(iri: string): Set<string> {
    return computeAllSuperClassesInState(this.classes, iri);
  }

  /** Performs internal consistency checks across disjointness, property characteristics, intervals, cardinalities, and nominals. */
  private checkConsistencyInternal(): ConsistencyResult {
    return checkConsistencyOnState(this._kb);
  }

  /** Finds a shortest-path justification trail of `SubClassOf` / `EquivalentClasses` axioms from `subIri` to `superIri`. */
  private buildJustification(subIri: string, superIri: string): OWL2Axiom[] {
    return buildJustificationOnState(this.classes, subIri, superIri);
  }

  /** Retrieves or creates a `ClassNode` entry for `iri` in the class table. */
  private ensureClass(iri: string): ClassNode {
    return ensureClassInState(this.classes, iri);
  }

  /** Validates all focus nodes in the ontology against the given SHACL node shapes and returns any violations. */
  validateShacl(shapes: readonly SHACLNodeShape[]): readonly SHACLViolation[] {
    if (!this._classified) this.classify();
    return validateShaclOnState(this._kb, shapes, (q) => this.queryBgp(q));
  }

  /** Executes SHACL-AF triple and SPARQL construct rules up to `maxPasses` fixpoint iterations. */
  executeShaclRules(
    shapes: readonly SHACLNodeShape[],
    maxPasses = 10,
  ): { materializedAxioms: OWL2Axiom[]; passes: number } {
    return executeShaclRulesOnState(
      this._kb,
      shapes,
      (q) => this.queryBgp(q),
      () => {
        this._bgpIndex = null;
      },
      maxPasses,
    );
  }

  /** Returns all object or data property values asserted/inferred for `focusNode` along `path`. */
  getPropertyValues(focusNode: string, path: string): string[] {
    return getPropertyValuesOnState(this._kb, focusNode, path);
  }

  /**
   * Extract minimal syntactic bot-locality module M for a given seed signature.
   * Guarantees: M |= alpha <=> O |= alpha for any axiom alpha over seedSignature.
   */
  extractBotLocalityModule(seedSignature: ReadonlySet<string>): OWL2Axiom[] {
    return extractBotLocalityModuleFromAxioms(this._axioms, seedSignature);
  }

  /** Resets all internal axiom lists, class/property maps, and cached indices. */
  private clear(): void {
    clearReasonerState(this._kb);
    this._classified = false;
    this._bgpIndex = null;
  }
}

// ---------------------------------------------------------------------------
// Backward-compatibility alias
// ---------------------------------------------------------------------------
export { WasmOntologyReasoner as TableauReasoner };

// ---------------------------------------------------------------------------
// Ontology Builder (debouncing, events, re-classification)
// ---------------------------------------------------------------------------

/**
 * Coordinates an `IOWL2OntologyStore` and `IOWLReasoner` with debounced delta application,
 * automatic re-classification, and lifecycle event broadcasting.
 */
export class OntologyBuilder {
  /** Underlying OWL 2 reasoner engine. */
  private reasoner: IOWLReasoner;
  /** Underlying OWL 2 ontology store. */
  private store: IOWL2OntologyStore;
  /** Registered lifecycle event listeners. */
  private listeners: OntologyEventListener[] = [];

  /** Active debounce timer handle for coalescing rapid axiom deltas. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Accumulated axiom delta awaiting flush. */
  private pendingDelta: OWL2AxiomDelta | null = null;
  /** Debounce delay in milliseconds before applying accumulated deltas. */
  private debounceMs: number;
  /** Whether to automatically re-classify the ontology after applying a delta. */
  private autoClassify: boolean;

  /** Creates a new `OntologyBuilder` wrapping `reasoner` and `store`. */
  constructor(
    reasoner: IOWLReasoner,
    store: IOWL2OntologyStore,
    options?: {
      debounceMs?: number | undefined;
      autoClassify?: boolean | undefined;
    },
  ) {
    this.reasoner = reasoner;
    this.store = store;
    this.debounceMs = options?.debounceMs ?? 300;
    this.autoClassify = options?.autoClassify ?? true;
  }

  /** Returns the underlying `IOWLReasoner` instance. */
  get backend(): IOWLReasoner {
    return this.reasoner;
  }

  /** Initializes the reasoner and loads any existing axioms from the store. */
  async initialize(): Promise<void> {
    await this.reasoner.init();
    this.emit({ type: "status-changed", status: this.reasoner.status });

    if (this.store.size > 0) {
      this.loadFromStore();
    }
  }

  /** Loads all axioms currently in `store` into the reasoner and optionally classifies. */
  loadFromStore(): void {
    const axioms = this.store.axioms;
    this.reasoner.loadOntology(axioms);
    this.emit({ type: "status-changed", status: this.reasoner.status });

    if (this.autoClassify && axioms.length > 0) {
      this.classifyAndEmit();
    }
  }

  /** Queues or immediately applies an incremental `OWL2AxiomDelta` to the reasoner. */
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

  /** Immediately flushes any pending debounced axiom delta. */
  flush(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.flushPendingDelta();
  }

  /** Classifies the ontology, checks global consistency, and emits a `"consistency-result"` event. */
  classifyAndCheck(): ConsistencyResult {
    this.classifyAndEmit();
    const result = this.reasoner.checkConsistency();
    this.emit({ type: "consistency-result", result });
    return result;
  }

  /** Returns the classified taxonomy hierarchy from the reasoner. */
  getTaxonomy(): TaxonomyNode[] {
    return this.reasoner.getTaxonomy();
  }

  /** Subscribes `listener` to ontology lifecycle events. */
  on(listener: OntologyEventListener): void {
    this.listeners.push(listener);
  }

  /** Unsubscribes `listener` from ontology lifecycle events. */
  off(listener: OntologyEventListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }

  /** Cancels pending timers, disposes the reasoner, and clears all listeners. */
  dispose(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingDelta = null;
    this.reasoner.dispose();
    this.listeners = [];
  }

  /** Applies `delta` directly to the reasoner and triggers classification if `autoClassify` is enabled. */
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

  /** Flushes `pendingDelta` through `applyDeltaImmediate`. */
  private flushPendingDelta(): void {
    if (this.pendingDelta) {
      const delta = this.pendingDelta;
      this.pendingDelta = null;
      this.applyDeltaImmediate(delta);
    }
  }

  /** Runs `reasoner.classify()` and emits `"classified"` and `"status-changed"` events. */
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

  /** Dispatches `event` to all registered listeners. */
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
