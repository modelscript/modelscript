// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OWL2 Projection Engine
 *
 * Collects OWL2 axioms projected from multiple source languages
 * (Modelica, SysML2, STEP) via the AdapterRegistry, and produces
 * a unified ontology with incremental delta support.
 *
 * Designed to be integrated as memoized Salsa queries in the
 * QueryEngine for minimal re-computation on file changes.
 */

import type { AdapterRegistry, ProjectionResult } from "./adapter-registry.js";
import type {
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
} from "./owl2-axioms.js";
import { makeIri } from "./owl2-axioms.js";

// ---------------------------------------------------------------------------
// Projection result → OWL2 axiom conversion
// ---------------------------------------------------------------------------

/**
 * Convert a ProjectionResult (from AdapterRegistry.project()) into
 * concrete OWL2Axiom instances. A single source symbol may produce
 * multiple axioms (e.g., a Modelica model produces a ClassDeclaration
 * + SubClassOf + DataPropertyAssertions for each parameter).
 */
export function projectionToAxioms(result: ProjectionResult): OWL2Axiom[] {
  const props = result.props;
  const axiomType = props.axiomType as string | undefined;

  // If the adapter explicitly set axiomType, use it directly
  if (axiomType) {
    return convertExplicitAxiom(props, axiomType);
  }

  // Otherwise, if the adapter returned a batch of axioms
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
// Full Ontology Collector
// ---------------------------------------------------------------------------

/**
 * Collect all OWL2 axioms by projecting every registered source language
 * into the "owl2" target language via the AdapterRegistry.
 *
 * This is the main entry point for computing the full unified ontology.
 */
export function collectOWL2Ontology(registry: AdapterRegistry, sourceLanguages: readonly string[]): OWL2Axiom[] {
  const axioms: OWL2Axiom[] = [];

  for (const sourceLang of sourceLanguages) {
    const projections = registry.projectAll(sourceLang, "owl2");
    for (const projection of projections) {
      axioms.push(...projectionToAxioms(projection));
    }
  }

  return axioms;
}

/**
 * Compute the incremental delta between two axiom sets.
 * Uses axiom identity (serialized JSON) for comparison.
 */
export function computeAxiomDelta(
  previousAxioms: readonly OWL2Axiom[],
  currentAxioms: readonly OWL2Axiom[],
): OWL2AxiomDelta {
  const prevSet = new Set(previousAxioms.map(axiomKey));
  const currSet = new Set(currentAxioms.map(axiomKey));

  const retractions: OWL2Axiom[] = [];
  const assertions: OWL2Axiom[] = [];

  for (const axiom of previousAxioms) {
    if (!currSet.has(axiomKey(axiom))) {
      retractions.push(axiom);
    }
  }

  for (const axiom of currentAxioms) {
    if (!prevSet.has(axiomKey(axiom))) {
      assertions.push(axiom);
    }
  }

  return { retractions, assertions };
}

/**
 * Serialize an axiom to a stable string key for delta comparison.
 * Uses a compact representation to avoid full JSON overhead.
 */
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

// Re-export makeIri for use in adapter transforms
export { makeIri };
