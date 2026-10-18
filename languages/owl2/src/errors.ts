// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Severity level for an OWL 2 linter or reasoner diagnostic.
 */
export type Owl2DiagnosticSeverity = "error" | "warning" | "info";

/**
 * Definition of an OWL 2 diagnostic error code, rule slug, severity, and message formatter.
 */
export interface Owl2ErrorCodeDef {
  readonly code: number;
  readonly rule: string;
  readonly severity: Owl2DiagnosticSeverity;
  readonly message: (...args: string[]) => string;
}

/**
 * Canonical OWL 2 Linter & Verifier Error Code Registry.
 *
 * Numbering scheme:
 * - O1xxx: Parser & Prefix / IRI Syntax
 * - O2xxx: Declarations & Built-in Vocabulary
 * - O3xxx: Typing, Punning & Datatype Lexical Validation
 * - O4xxx: OWL 2 DL Structural & Global Restrictions (Simple/Composite Roles, Cycles)
 * - O5xxx: Logical Consistency & Satisfiability (Reasoner Integration)
 * - O6xxx: OWL 2 Profile Conformance (OWL 2 EL)
 */
export const Owl2ErrorCode = {
  // 1xxx — Parser & Prefix / IRI Syntax
  PARSE_ERROR: {
    code: 1001,
    rule: "parse-error",
    severity: "error" as const,
    message: (snippet: string) => `Syntax error near '${snippet}'.`,
  },
  UNDECLARED_PREFIX: {
    code: 1002,
    rule: "undeclared-prefix",
    severity: "error" as const,
    message: (prefix: string, iri: string) => `Prefix '${prefix}:' used in abbreviated IRI '${iri}' is not declared.`,
  },
  DUPLICATE_PREFIX: {
    code: 1003,
    rule: "duplicate-prefix",
    severity: "warning" as const,
    message: (prefix: string) => `Prefix '${prefix}:' is declared multiple times in the ontology header.`,
  },
  INVALID_IRI: {
    code: 1004,
    rule: "invalid-iri",
    severity: "error" as const,
    message: (iri: string) => `Invalid or malformed IRI '${iri}'.`,
  },
  INSUFFICIENT_ARITY: {
    code: 1005,
    rule: "insufficient-arity",
    severity: "error" as const,
    message: (construct: string, minArity: string, actualArity: string) =>
      `OWL 2 construct '${construct}' requires at least ${minArity} arguments, but got ${actualArity}.`,
  },

  // 2xxx — Declarations & Vocabulary
  UNDECLARED_ENTITY: {
    code: 2001,
    rule: "undeclared-entity",
    severity: "warning" as const,
    message: (iri: string, role: string) =>
      `Entity '${iri}' is used as a ${role} without an explicit Declaration axiom.`,
  },
  DUPLICATE_DECLARATION: {
    code: 2002,
    rule: "duplicate-declaration",
    severity: "warning" as const,
    message: (kind: string, iri: string) => `Duplicate Declaration(${kind}(${iri})) in ontology.`,
  },
  RESERVED_VOCABULARY_DECLARATION: {
    code: 2003,
    rule: "reserved-vocabulary-declaration",
    severity: "error" as const,
    message: (iri: string) => `Cannot declare or redefine built-in OWL 2 / RDF / RDFS / XSD vocabulary IRI '${iri}'.`,
  },

  // 3xxx — Typing, Punning & Datatypes
  ILLEGAL_PROPERTY_PUNNING: {
    code: 3001,
    rule: "illegal-property-punning",
    severity: "error" as const,
    message: (iri: string, kindA: string, kindB: string) =>
      `Illegal OWL 2 DL punning: '${iri}' is used as both '${kindA}' and '${kindB}' (ObjectProperty, DataProperty, and AnnotationProperty vocabularies must be disjoint).`,
  },
  EXPECTED_OBJECT_PROPERTY: {
    code: 3002,
    rule: "expected-object-property",
    severity: "error" as const,
    message: (iri: string, construct: string) =>
      `Expected an ObjectProperty in '${construct}', but '${iri}' is declared as a DataProperty.`,
  },
  EXPECTED_DATA_PROPERTY: {
    code: 3003,
    rule: "expected-data-property",
    severity: "error" as const,
    message: (iri: string, construct: string) =>
      `Expected a DataProperty in '${construct}', but '${iri}' is declared as an ObjectProperty.`,
  },
  EXPECTED_CLASS_EXPRESSION: {
    code: 3004,
    rule: "expected-class-expression",
    severity: "error" as const,
    message: (iri: string, construct: string) =>
      `Expected a Class expression in '${construct}', but '${iri}' is a Datatype.`,
  },
  INVALID_DATATYPE: {
    code: 3005,
    rule: "invalid-datatype",
    severity: "warning" as const,
    message: (datatypeIri: string) => `Datatype '${datatypeIri}' is not in the standard OWL 2 datatype map.`,
  },
  DATATYPE_LITERAL_MISMATCH: {
    code: 3006,
    rule: "datatype-literal-mismatch",
    severity: "error" as const,
    message: (literal: string, datatypeIri: string) =>
      `Lexical value '${literal}' is not a valid literal for datatype '${datatypeIri}'.`,
  },

  // 4xxx — OWL 2 DL Structural & Global Restrictions
  NON_SIMPLE_PROPERTY_RESTRICTION: {
    code: 4001,
    rule: "non-simple-property-restriction",
    severity: "error" as const,
    message: (propertyIri: string, construct: string) =>
      `OWL 2 DL global restriction violation: non-simple (transitive or composite) property '${propertyIri}' cannot be used in '${construct}'.`,
  },
  CONTRADICTORY_PROPERTY_CHARACTERISTICS: {
    code: 4002,
    rule: "contradictory-property-characteristics",
    severity: "error" as const,
    message: (propertyIri: string, charA: string, charB: string) =>
      `Object property '${propertyIri}' has contradictory characteristics '${charA}' and '${charB}'.`,
  },
  PROPERTY_HIERARCHY_CYCLE: {
    code: 4003,
    rule: "property-hierarchy-cycle",
    severity: "warning" as const,
    message: (cycle: string) => `Cycle detected in property hierarchy: '${cycle}'.`,
  },
  CLASS_HIERARCHY_CYCLE: {
    code: 4004,
    rule: "class-hierarchy-cycle",
    severity: "info" as const,
    message: (cycle: string) => `SubClassOf cycle detected (equivalent classes): '${cycle}'.`,
  },
  SELF_REFERENTIAL_AXIOM: {
    code: 4005,
    rule: "self-referential-axiom",
    severity: "warning" as const,
    message: (axiomType: string, iri: string) =>
      `Redundant or contradictory self-referential axiom '${axiomType}' on '${iri}'.`,
  },

  // 5xxx — Logical Consistency & Satisfiability (Reasoner)
  FUNCTIONAL_PROPERTY_CLASH: {
    code: 5001,
    rule: "functional-property-clash",
    severity: "error" as const,
    message: (propertyIri: string, detail: string) =>
      `Functional/InverseFunctional property '${propertyIri}' violation: ${detail}.`,
  },
  NEGATIVE_ASSERTION_CLASH: {
    code: 5002,
    rule: "negative-assertion-clash",
    severity: "error" as const,
    message: (propertyIri: string, subjectIri: string, target: string) =>
      `Negative property assertion on '${propertyIri}' for '${subjectIri}' clashes with asserted or inferred value '${target}'.`,
  },
  UNSATISFIABLE_CLASS: {
    code: 5003,
    rule: "unsatisfiable-class",
    severity: "error" as const,
    message: (classIri: string, reason: string) =>
      `Class '${classIri}' is unsatisfiable (equivalent to owl:Nothing): ${reason}.`,
  },
  ONTOLOGY_INCONSISTENT: {
    code: 5004,
    rule: "ontology-inconsistent",
    severity: "error" as const,
    message: (explanation: string) => `Ontology is logically inconsistent: ${explanation}`,
  },

  // 6xxx — OWL 2 Profiles
  PROFILE_EL_VIOLATION: {
    code: 6001,
    rule: "profile-el-violation",
    severity: "warning" as const,
    message: (construct: string) => `Construct '${construct}' is outside the OWL 2 EL profile.`,
  },
} as const;

/** Index mapping numeric OWL 2 error codes (e.g. `1001`) to their `Owl2ErrorCodeDef`. */
const BY_CODE = new Map<number, Owl2ErrorCodeDef>();
/** Index mapping kebab-case OWL 2 rule names (e.g. `"parse-error"`) to their `Owl2ErrorCodeDef`. */
const BY_RULE = new Map<string, Owl2ErrorCodeDef>();

for (const def of Object.values(Owl2ErrorCode)) {
  BY_CODE.set(def.code, def);
  BY_RULE.set(def.rule, def);
}

/**
 * Looks up an `Owl2ErrorCodeDef` by its numeric code (e.g., `3001`).
 */
export function getOwl2ErrorCodeDef(code: number): Owl2ErrorCodeDef | undefined {
  return BY_CODE.get(code);
}

/**
 * Looks up an `Owl2ErrorCodeDef` by its kebab-case rule identifier (e.g., `"illegal-property-punning"`).
 */
export function getOwl2ErrorByRule(rule: string): Owl2ErrorCodeDef | undefined {
  return BY_RULE.get(rule);
}
