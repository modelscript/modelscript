// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OWL2 Axiom Types — Shared type definitions for cross-language
 * OWL2 projections (Modelica/SysML2/STEP → OWL2).
 *
 * These types represent the subset of OWL2 Functional-Style Syntax
 * axioms that are projected from engineering domain models during
 * polyglot transformation.
 */

// ---------------------------------------------------------------------------
// Class Axioms
// ---------------------------------------------------------------------------

export interface OWL2ClassDeclaration {
  readonly type: "ClassDeclaration";
  readonly iri: string;
  /** Originating language (e.g. "modelica", "sysml2", "step") */
  readonly sourceLang: string;
  /** Fully qualified name in the source language */
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

// ---------------------------------------------------------------------------
// Property Axioms
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Individual Axioms
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Restriction Axioms (complex class expressions)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Union Type & Delta
// ---------------------------------------------------------------------------

/** Any projected OWL2 axiom. */
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
  | OWL2DataSomeValuesFrom;

/**
 * Incremental axiom change set. When a source file is edited,
 * only the axioms from that file's symbols are invalidated.
 * The delta captures what was retracted and what was newly asserted.
 */
export interface OWL2AxiomDelta {
  /** Axioms that were removed (previous revision). */
  readonly retractions: readonly OWL2Axiom[];
  /** Axioms that were added (current revision). */
  readonly assertions: readonly OWL2Axiom[];
}

// ---------------------------------------------------------------------------
// IRI Namespace Helpers
// ---------------------------------------------------------------------------

/** Standard IRI prefixes for each language domain. */
export const OWL2_IRI_PREFIX = {
  modelica: "mo:",
  sysml2: "sysml:",
  step: "step:",
  owl2: "",
} as const;

/** Create a fully qualified IRI from a source language and name. */
export function makeIri(sourceLang: string, name: string): string {
  const prefix = (OWL2_IRI_PREFIX as Record<string, string>)[sourceLang] ?? `${sourceLang}:`;
  return `${prefix}${name}`;
}
