// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure OWL 2 Axiom Utilities: Hashing, Zero-Copy Flyweight View, Conversion,
 * Deduplication, Serialization (FSS), GCI Absorption, Bot-Locality Modularization,
 * RCC-8 Spatial Projection, and Workspace Symbol Projection.
 */

import type { SymbolEntry } from "../runtime.js";
import {
  AXIOM_ASYMMETRIC_PROP,
  AXIOM_CLASS_ASSERT,
  AXIOM_CLASS_DECL,
  AXIOM_DATA_PROP_ASSERT,
  AXIOM_DATA_PROP_DECL,
  AXIOM_DISJOINT_CLASSES,
  AXIOM_DISJOINT_PROPS,
  AXIOM_DISJUNCTIVE_CLASS,
  AXIOM_EQUIV_CLASS,
  AXIOM_FUNCTIONAL_DATA_PROP,
  AXIOM_FUNCTIONAL_OBJ_PROP,
  AXIOM_INDIVIDUAL_DECL,
  AXIOM_INVERSE_PROP,
  AXIOM_IRREFLEXIVE_PROP,
  AXIOM_OBJ_PROP_ASSERT,
  AXIOM_OBJ_PROP_DECL,
  AXIOM_OBJECT_SOME_VALUES_FROM,
  AXIOM_SAME_INDIVIDUAL,
  AXIOM_SUBCLASS_OF,
  AXIOM_SYMMETRIC_PROP,
  AXIOM_TRANSITIVE_PROP,
  AXIOM_UNIVERSAL_RESTRICTION,
  type CadBoundingBox,
  type OntologyProjectionResult,
  type OntologyWorkspaceLike,
  type OWL2Axiom,
  type OWL2AxiomDelta,
  type OWL2ClassAssertion,
  type OWL2ClassDeclaration,
  type OWL2DataPropertyAssertion,
  type OWL2DataPropertyDeclaration,
  type OWL2DisjointClasses,
  type OWL2IndividualDeclaration,
  type OWL2ObjectPropertyAssertion,
  type OWL2ObjectPropertyDeclaration,
  type OWL2SubClassOf,
  type OWL2TransitiveObjectProperty,
  type Rcc8Relation,
} from "./owl2-types.js";

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
  /** Creates a zero-copy view over a 6-word axiom record in `buffer` at `wordOffset`. */
  constructor(
    private _buffer: Uint32Array,
    private _wordOffset: number,
  ) {}

  /** Numeric `AXIOM_*` type tag of the record. */
  get axiomType(): number {
    return this._buffer[this._wordOffset]! & 0xffff;
  }
  /** Numeric identifier of the source engineering language. */
  get sourceLangId(): number {
    return (this._buffer[this._wordOffset]! >> 16) & 0xffff;
  }
  /** Interned entity ID of the subject argument. */
  get subjectId(): number {
    return this._buffer[this._wordOffset + 1] ?? 0;
  }
  /** Interned entity ID of the predicate argument. */
  get predicateId(): number {
    return this._buffer[this._wordOffset + 2] ?? 0;
  }
  /** Interned entity ID of the object argument. */
  get objectId(): number {
    return this._buffer[this._wordOffset + 3] ?? 0;
  }
  /** Packed bitflags or lower 32 bits of quantitative literal data. */
  get flags(): number {
    return this._buffer[this._wordOffset + 4] ?? 0;
  }
  /** Extra payload word or upper 32 bits of quantitative literal data. */
  get extra(): number {
    return this._buffer[this._wordOffset + 5] ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Conversion from ProjectionResult
// ---------------------------------------------------------------------------

/** Converts an `OntologyProjectionResult` emitted by a language grammar rule into `OWL2Axiom` objects. */
export function projectionToAxioms(result: OntologyProjectionResult): OWL2Axiom[] {
  const props = result.props;
  const axiomType = props["axiomType"] as string | undefined;

  if (axiomType) {
    return convertExplicitAxiom(props, axiomType);
  }

  if (Array.isArray(props["axioms"])) {
    return props["axioms"] as OWL2Axiom[];
  }

  return [];
}

/** Converts an untyped property dictionary with an explicit `axiomType` tag into typed `OWL2Axiom` records. */
function convertExplicitAxiom(props: Record<string, unknown>, axiomType: string): OWL2Axiom[] {
  switch (axiomType) {
    case "ClassDeclaration":
      return [
        {
          type: "ClassDeclaration",
          iri: props["iri"] as string,
          sourceLang: props["sourceLang"] as string,
          sourceQualifiedName: props["sourceQualifiedName"] as string,
        } satisfies OWL2ClassDeclaration,
      ];

    case "SubClassOf":
      return [
        {
          type: "SubClassOf",
          subClassIri: props["subClassIri"] as string,
          superClassIri: props["superClassIri"] as string,
          sourceLang: props["sourceLang"] as string,
        } satisfies OWL2SubClassOf,
      ];

    case "DisjointClasses":
      return [
        {
          type: "DisjointClasses",
          classIris: props["classIris"] as string[],
          sourceLang: props["sourceLang"] as string,
        } satisfies OWL2DisjointClasses,
      ];

    case "ObjectPropertyDeclaration":
      return [
        {
          type: "ObjectPropertyDeclaration",
          iri: props["iri"] as string,
          sourceLang: props["sourceLang"] as string,
          characteristics: props["characteristics"] as OWL2ObjectPropertyDeclaration["characteristics"],
        } satisfies OWL2ObjectPropertyDeclaration,
      ];

    case "DataPropertyDeclaration":
      return [
        {
          type: "DataPropertyDeclaration",
          iri: props["iri"] as string,
          sourceLang: props["sourceLang"] as string,
        } satisfies OWL2DataPropertyDeclaration,
      ];

    case "ObjectPropertyAssertion":
      return [
        {
          type: "ObjectPropertyAssertion",
          propertyIri: props["propertyIri"] as string,
          subjectIri: props["subjectIri"] as string,
          objectIri: props["objectIri"] as string,
          sourceLang: props["sourceLang"] as string,
        } satisfies OWL2ObjectPropertyAssertion,
      ];

    case "DataPropertyAssertion":
      return [
        {
          type: "DataPropertyAssertion",
          propertyIri: props["propertyIri"] as string,
          subjectIri: props["subjectIri"] as string,
          value: props["value"] as string,
          datatype: props["datatype"] as string | undefined,
          sourceLang: props["sourceLang"] as string,
        } satisfies OWL2DataPropertyAssertion,
      ];

    case "TransitiveObjectProperty":
      return [
        {
          type: "TransitiveObjectProperty",
          propertyIri: props["propertyIri"] as string,
          sourceLang: props["sourceLang"] as string,
        } satisfies OWL2TransitiveObjectProperty,
      ];

    case "IndividualDeclaration":
      return [
        {
          type: "IndividualDeclaration",
          iri: props["iri"] as string,
          sourceLang: props["sourceLang"] as string,
        } satisfies OWL2IndividualDeclaration,
      ];

    case "ClassAssertion":
      return [
        {
          type: "ClassAssertion",
          classIri: props["classIri"] as string,
          individualIri: props["individualIri"] as string,
          sourceLang: props["sourceLang"] as string,
        } satisfies OWL2ClassAssertion,
      ];

    default:
      return [];
  }
}

/**
 * Maps a high-level `OWL2Axiom` to its numeric `AXIOM_*` code and `(subject, predicate, object)` IRI triple
 * for insertion into the linear-memory WASM ontology store.
 */
export function axiomToTypeAndIris(axiom: OWL2Axiom): {
  type: number;
  sIri: string;
  pIri: string;
  oIri: string;
  flags?: number | undefined;
  extra?: number | undefined;
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

// ---------------------------------------------------------------------------
// Axiom Comparison, Delta, Deduplication, FSS & GCI Absorption
// ---------------------------------------------------------------------------

/** Structural equality check between two `OWL2Axiom` objects. */
export function axiomEqual(a: OWL2Axiom, b: OWL2Axiom): boolean {
  if (a.type !== b.type) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Computes the set of retracted and newly asserted axioms between `previous` and `current`. */
export function computeDelta(previous: readonly OWL2Axiom[], current: readonly OWL2Axiom[]): OWL2AxiomDelta {
  const prevKeys = new Set(previous.map(axiomKey));
  const currKeys = new Set(current.map(axiomKey));

  const retractions = previous.filter((a) => !currKeys.has(axiomKey(a)));
  const assertions = current.filter((a) => !prevKeys.has(axiomKey(a)));

  return { retractions, assertions };
}

/** Computes a canonical string deduplication key for an `OWL2Axiom`. */
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
      return `OSVF:${axiom.subClassIri ?? ""}|${axiom.propertyIri}|${axiom.fillerClassIri}`;
    case "DataSomeValuesFrom":
      return `DSVF:${axiom.subClassIri ?? ""}|${axiom.propertyIri}|${axiom.dataRange}`;
    case "InverseFunctionalObjectProperty":
      return `IFOP:${axiom.propertyIri}`;
    case "ReflexiveObjectProperty":
      return `ROP:${axiom.propertyIri}`;
    case "SubObjectPropertyOf":
      return `SOPO:${axiom.subPropertyIri}|${axiom.superPropertyIri}`;
    case "SubDataPropertyOf":
      return `SDPO:${axiom.subPropertyIri}|${axiom.superPropertyIri}`;
    case "ObjectPropertyDomain":
      return `OPDOM:${axiom.propertyIri}|${axiom.domainIri}`;
    case "ObjectPropertyRange":
      return `OPRNG:${axiom.propertyIri}|${axiom.rangeIri}`;
    case "DataPropertyDomain":
      return `DPDOM:${axiom.propertyIri}|${axiom.domainIri}`;
    case "DataPropertyRange":
      return `DPRNG:${axiom.propertyIri}|${axiom.rangeIri}`;
    case "NegativeObjectPropertyAssertion":
      return `NOPA:${axiom.propertyIri}|${axiom.subjectIri}|${axiom.objectIri}`;
    case "NegativeDataPropertyAssertion":
      return `NDPA:${axiom.propertyIri}|${axiom.subjectIri}|${axiom.value}`;
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

/** Checks whether `axiom` references the given entity `iri` in any position. */
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
    case "InverseFunctionalObjectProperty":
    case "ReflexiveObjectProperty":
    case "FunctionalObjectProperty":
    case "FunctionalDataProperty":
    case "SymmetricObjectProperty":
    case "AsymmetricObjectProperty":
    case "IrreflexiveObjectProperty":
      return axiom.propertyIri === iri;
    case "InverseObjectProperty":
      return axiom.propertyIri === iri || axiom.inversePropertyIri === iri;
    case "DisjointObjectProperties":
      return axiom.propertyIris.includes(iri);
    case "SubObjectPropertyOf":
    case "SubDataPropertyOf":
      return axiom.subPropertyIri === iri || axiom.superPropertyIri === iri;
    case "ObjectPropertyDomain":
    case "DataPropertyDomain":
      return axiom.propertyIri === iri || axiom.domainIri === iri;
    case "ObjectPropertyRange":
    case "DataPropertyRange":
      return axiom.propertyIri === iri || axiom.rangeIri === iri;
    case "NegativeObjectPropertyAssertion":
      return axiom.propertyIri === iri || axiom.subjectIri === iri || axiom.objectIri === iri;
    case "NegativeDataPropertyAssertion":
      return axiom.propertyIri === iri || axiom.subjectIri === iri;
    case "IndividualDeclaration":
      return axiom.iri === iri;
    case "ClassAssertion":
      return axiom.classIri === iri || axiom.individualIri === iri;
    case "ObjectSomeValuesFrom":
      return axiom.propertyIri === iri || axiom.fillerClassIri === iri || axiom.subClassIri === iri;
    case "DataSomeValuesFrom":
      return axiom.propertyIri === iri || axiom.subClassIri === iri;
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

/** Formats a single `OWL2Axiom` in OWL 2 Functional-Style Syntax (FSS). */
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
    case "FunctionalObjectProperty":
      return `FunctionalObjectProperty(${axiom.propertyIri})`;
    case "FunctionalDataProperty":
      return `FunctionalDataProperty(${axiom.propertyIri})`;
    case "InverseFunctionalObjectProperty":
      return `InverseFunctionalObjectProperty(${axiom.propertyIri})`;
    case "ReflexiveObjectProperty":
      return `ReflexiveObjectProperty(${axiom.propertyIri})`;
    case "SymmetricObjectProperty":
      return `SymmetricObjectProperty(${axiom.propertyIri})`;
    case "AsymmetricObjectProperty":
      return `AsymmetricObjectProperty(${axiom.propertyIri})`;
    case "IrreflexiveObjectProperty":
      return `IrreflexiveObjectProperty(${axiom.propertyIri})`;
    case "InverseObjectProperty":
      return `InverseObjectProperties(${axiom.propertyIri} ${axiom.inversePropertyIri})`;
    case "DisjointObjectProperties":
      return `DisjointObjectProperties(${axiom.propertyIris.join(" ")})`;
    case "SubObjectPropertyOf":
      return `SubObjectPropertyOf(${axiom.subPropertyIri} ${axiom.superPropertyIri})`;
    case "SubDataPropertyOf":
      return `SubDataPropertyOf(${axiom.subPropertyIri} ${axiom.superPropertyIri})`;
    case "ObjectPropertyDomain":
      return `ObjectPropertyDomain(${axiom.propertyIri} ${axiom.domainIri})`;
    case "ObjectPropertyRange":
      return `ObjectPropertyRange(${axiom.propertyIri} ${axiom.rangeIri})`;
    case "DataPropertyDomain":
      return `DataPropertyDomain(${axiom.propertyIri} ${axiom.domainIri})`;
    case "DataPropertyRange":
      return `DataPropertyRange(${axiom.propertyIri} ${axiom.rangeIri})`;
    case "NegativeObjectPropertyAssertion":
      return `NegativeObjectPropertyAssertion(${axiom.propertyIri} ${axiom.subjectIri} ${axiom.objectIri})`;
    case "NegativeDataPropertyAssertion":
      return `NegativeDataPropertyAssertion(${axiom.propertyIri} ${axiom.subjectIri} "${axiom.value}")`;
    case "IndividualDeclaration":
      return `Declaration(NamedIndividual(${axiom.iri}))`;
    case "ClassAssertion":
      return `ClassAssertion(${axiom.classIri} ${axiom.individualIri})`;
    case "ObjectSomeValuesFrom":
      return `SubClassOf(${axiom.subClassIri ?? "owl:Thing"} ObjectSomeValuesFrom(${axiom.propertyIri} ${axiom.fillerClassIri}))`;
    case "DataSomeValuesFrom":
      return `SubClassOf(${axiom.subClassIri ?? "owl:Thing"} DataSomeValuesFrom(${axiom.propertyIri} ${axiom.dataRange}))`;
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

/** Converts an OWL 2 entity declaration axiom into a synthetic `SymbolEntry`, or `null` if not a declaration. */
export function axiomToSymbolEntry(axiom: OWL2Axiom, id: number): SymbolEntry | null {
  const base: Omit<SymbolEntry, "id" | "kind" | "name"> = {
    ruleName: "owl2:projected",
    namePath: "iri",
    startOffset: 0,
    endOffset: 0,
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

/**
 * Simplifies and absorbs General Concept Inclusion (GCI) tautologies and redundant class lists
 * before tableau / saturation reasoning.
 */
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

/**
 * Computes the topological RCC-8 relation (`rcc:DC`, `rcc:EC`, `rcc:PO`, `rcc:EQ`, `rcc:TPP`, `rcc:NTPP`, etc.)
 * between two 3D axis-aligned bounding boxes `a` and `b` within tolerance `epsilon`.
 */
export function computeRcc8Relation(a: CadBoundingBox, b: CadBoundingBox, epsilon: number = 1e-6): Rcc8Relation {
  // Check for exact identity (EQ)
  let isEqual = true;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a.min[i]! - b.min[i]!) > epsilon || Math.abs(a.max[i]! - b.max[i]!) > epsilon) {
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
    if (interMin[i]! > interMax[i]! + epsilon) {
      return "rcc:DC";
    }
  }

  // If touches at boundary face/edge/corner with 0-volume intersection => Externally Connected (EC)
  let touchesBoundary = false;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(interMin[i]! - interMax[i]!) <= epsilon) {
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

/**
 * Projects a collection of 3D CAD bounding boxes into OWL 2 `cad:BoundingEnvelope` individuals
 * and pairwise RCC-8 spatial object property assertions.
 */
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

// ---------------------------------------------------------------------------
// Syntactic Bot-Locality Modularization
// ---------------------------------------------------------------------------

/**
 * Extract minimal syntactic bot-locality module M for a given seed signature.
 * Guarantees: M |= alpha <=> O |= alpha for any axiom alpha over seedSignature.
 */
export function extractBotLocalityModuleFromAxioms(
  axioms: readonly OWL2Axiom[],
  seedSignature: ReadonlySet<string>,
): OWL2Axiom[] {
  const currentSig = new Set<string>(seedSignature);
  const module = new Set<OWL2Axiom>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const axiom of axioms) {
      if (module.has(axiom)) continue;
      if (!isAxiomBotLocal(axiom, currentSig)) {
        module.add(axiom);
        for (const s of getAxiomSignature(axiom)) {
          currentSig.add(s);
        }
        changed = true;
      }
    }
  }

  return Array.from(module);
}

/** Tests whether `axiom` is syntactically $\bot$-local with respect to signature `sig`. */
export function isAxiomBotLocal(axiom: OWL2Axiom, sig: ReadonlySet<string>): boolean {
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

/** Extracts all entity IRIs referenced in `axiom`. */
export function getAxiomSignature(axiom: OWL2Axiom): string[] {
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
    case "InverseFunctionalObjectProperty":
    case "ReflexiveObjectProperty":
      s.add(axiom.propertyIri);
      break;
    case "SubObjectPropertyOf":
    case "SubDataPropertyOf":
      s.add(axiom.subPropertyIri);
      s.add(axiom.superPropertyIri);
      break;
    case "ObjectPropertyDomain":
    case "DataPropertyDomain":
      s.add(axiom.propertyIri);
      s.add(axiom.domainIri);
      break;
    case "ObjectPropertyRange":
      s.add(axiom.propertyIri);
      s.add(axiom.rangeIri);
      break;
    case "DataPropertyRange":
      s.add(axiom.propertyIri);
      break;
    case "NegativeObjectPropertyAssertion":
      s.add(axiom.propertyIri);
      s.add(axiom.subjectIri);
      s.add(axiom.objectIri);
      break;
    case "NegativeDataPropertyAssertion":
      s.add(axiom.propertyIri);
      s.add(axiom.subjectIri);
      break;
  }
  return Array.from(s);
}

// ---------------------------------------------------------------------------
// Workspace Symbol-to-Axiom Projection
// ---------------------------------------------------------------------------

/** Projects symbols for `language` from an attached workspace symbol index into OWL 2 axioms. */
export function projectWorkspaceLanguageSymbols(
  workspace: OntologyWorkspaceLike,
  language: string,
): OWL2Axiom[] | null {
  const unified = typeof workspace.getIndex === "function" ? workspace.getIndex() : null;
  if (!unified || !unified.symbols) return null;

  const projected: OWL2Axiom[] = [];
  const prefix = language === "sysml2" ? "sysml:" : language === "modelica" ? "mo:" : `${language}:`;
  const formatIri = (name: string) => (name.startsWith(prefix) || name.includes(":") ? name : `${prefix}${name}`);

  for (const [id, entry] of unified.symbols.entries()) {
    if (entry.metadata?.isPredefined) continue;
    const rawName = entry.name || "";
    if (
      !rawName ||
      rawName.startsWith("'") ||
      rawName.startsWith('"') ||
      /[\s\r\n/]/.test(rawName) ||
      rawName === entry.ruleName
    ) {
      continue;
    }
    const resId = entry.resourceId || "";
    if (
      resId.startsWith("modelica:") ||
      resId.startsWith("sysml2://stdlib/") ||
      resId.startsWith("library-bundle:/") ||
      resId.includes("/modelscript_registry/") ||
      resId.includes("/lib/Modelica") ||
      resId.includes("/lib/Complex") ||
      resId.includes("/lib/ModelicaServices") ||
      resId.includes("data/libraries/")
    ) {
      continue;
    }

    let entryLang = entry.language;
    if (!entryLang && entry.resourceId && typeof workspace.detectLanguage === "function") {
      entryLang = workspace.detectLanguage(entry.resourceId);
    }
    if (!entryLang && entry.resourceId) {
      if (entry.resourceId.endsWith(".mo") || entry.resourceId.endsWith(".msim")) entryLang = "modelica";
      else if (entry.resourceId.endsWith(".sysml") || entry.resourceId.endsWith(".sysml2")) entryLang = "sysml2";
    }

    if (
      entryLang !== language &&
      entry.language !== language &&
      (!entry.resourceId || !entry.resourceId.includes(`.${language}`))
    ) {
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
                superClassIri: formatIri(child.name),
                sourceLang: "sysml2",
              });
            } else if (
              child.kind === "Flow" ||
              child.ruleName === "ItemFlow" ||
              child.ruleName === "FlowConnectionUsage"
            ) {
              const src = child.source || child.from;
              const tgt = child.target || child.to;
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
              const src = child.source || child.from;
              const tgt = child.target || child.to;
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
        if (entry.parentId !== null && entry.parentId !== undefined) {
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
            if (sup && !/[\s\r\n/]/.test(sup)) {
              projected.push({
                type: "SubClassOf",
                subClassIri: iri,
                superClassIri: formatIri(sup),
                sourceLang: "modelica",
              });
            }
          }
        }
        const children = unified.childrenOf?.get(id) ?? [];
        for (const childId of children) {
          const child = unified.symbols.get(childId);
          if (child && (child.kind === "Extends" || child.ruleName === "extends_clause")) {
            if (child.name && !/[\s\r\n/]/.test(child.name)) {
              projected.push({
                type: "SubClassOf",
                subClassIri: iri,
                superClassIri: formatIri(child.name),
                sourceLang: "modelica",
              });
            }
          } else if (child && (child.kind === "Component" || child.kind === "Variable" || child.kind === "Connector")) {
            if (
              !child.name ||
              child.name.startsWith("'") ||
              child.name.startsWith('"') ||
              /[\s\r\n/]/.test(child.name) ||
              child.name === child.ruleName
            ) {
              continue;
            }
            const compIri = `${prefix}${entry.name}.${child.name}`;
            projected.push({
              type: "ObjectPropertyAssertion",
              propertyIri: "mo:hasPart",
              subjectIri: iri,
              objectIri: compIri,
              sourceLang: "modelica",
            });
            const typeName = child.type || child.typeName;
            if (typeName && !/[\s\r\n/]/.test(typeName)) {
              projected.push({
                type: "ClassAssertion",
                individualIri: compIri,
                classIri: formatIri(typeName),
                sourceLang: "modelica",
              });
            }
          } else if (
            child &&
            (child.kind === "Connect" || child.kind === "ConnectEquation" || child.ruleName === "ConnectEquation")
          ) {
            const lhs = child.lhs || child.left;
            const rhs = child.rhs || child.right;
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

  return projected;
}
