// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/language";

export const owl2Language = language({
  name: "owl2",

  mcp: {
    serverName: "owl2-mcp",
    serverVersion: "1.0.0",
    tools: [
      {
        name: "validate_system_consistency",
        description: "Validates the consistency of the unified polyglot ontology using the OWL2 reasoner.",
        category: "reasoning",
        pure: true,
        inputSchema: {},
      },
      {
        name: "query_ontology_sparql",
        description: "Evaluate a SPARQL-DL or Property Path query against the unified polyglot ontology.",
        category: "query",
        inputSchema: {
          query: {
            type: "string",
            description: "Query string (e.g. 'subclasses(mo:ElectricalDevice)')",
            required: true,
          },
        },
      },
      {
        name: "query_ontology_bgp",
        description: "Evaluate a multi-pattern Basic Graph Pattern (BGP) query using Leapfrog Triejoin.",
        category: "query",
        inputSchema: {
          patterns: {
            type: "array",
            description: "List of triple patterns to join",
            required: true,
            items: { type: "object" },
          },
        },
      },
      {
        name: "explain_inference",
        description: "Get the axiom justification chain for why a SubClassOf relationship holds.",
        category: "reasoning",
        inputSchema: {
          subClass: { type: "string", description: "Subclass IRI", required: true },
          superClass: { type: "string", description: "Superclass IRI", required: true },
        },
      },
      {
        name: "trace_fault_propagation",
        description: "Trace connections via transitive closure of the isConnectedTo property.",
        category: "reasoning",
        inputSchema: {
          sourceIri: { type: "string", description: "Starting node IRI", required: true },
        },
      },
    ],
    resources: [
      {
        uriTemplate: "owl2://ontology/{iri}/triples",
        name: "OWL2 Ontology Triples",
        mimeType: "text/turtle",
        description: "Indexed SPO triple graph of the active ontology",
      },
    ],
    prompts: [
      {
        name: "owl2_diagnose_inconsistency",
        description: "Explain why an ontology became unsatisfiable or inconsistent",
        arguments: [],
        template: () => "Diagnose inconsistency and minimal conflict cores in active ontology.",
      },
    ],
  },

  extras: () => [
    /\s/,
    /#.*/, // Line comments in OWL2 FSS usually start with #
  ],

  word: ($) => $.IDENT,

  rules: {
    // Top-level
    OntologyDocument: ($) => seq(repeat($.PrefixDeclaration), $.Ontology),

    PrefixDeclaration: ($) =>
      seq("Prefix", "(", field("name", optional($.PrefixName)), "=", field("iri", $.FullIRI), ")"),

    IDENT: () => semanticToken("identifier", /[a-zA-Z_][a-zA-Z0-9_]*/),
    PrefixName: ($) => seq($.IDENT, ":"),
    FullIRI: () => /<[^>]*>/,
    AbbreviatedIRI: ($) => seq($.IDENT, ":", $.IDENT),
    IRI: ($) => choice($.FullIRI, $.AbbreviatedIRI),
    StringLiteral: () => /"[^"]*"/,

    Ontology: ($) =>
      seq(
        "Ontology",
        "(",
        optional(field("iri", $.IRI)),
        repeat(field("import", $.ImportDeclaration)),
        repeat(field("axiom", $._Axiom)),
        ")",
      ),

    ImportDeclaration: ($) => seq("Import", "(", field("iri", $.IRI), ")"),

    _Axiom: ($) =>
      choice(
        $.Declaration,
        $.SubClassOfAxiom,
        $.EquivalentClassesAxiom,
        $.DisjointClassesAxiom,
        $.ObjectPropertyAssertionAxiom,
        $.DataPropertyAssertionAxiom,
        $.ClassAssertionAxiom,
        $.TransitiveObjectPropertyAxiom,
      ),

    Declaration: ($) => seq("Declaration", "(", field("entity", $._Entity), ")"),

    _Entity: ($) => choice($.ClassEntity, $.ObjectPropertyEntity, $.DataPropertyEntity, $.NamedIndividualEntity),

    ClassEntity: ($) => seq("Class", "(", field("iri", $.IRI), ")"),

    ObjectPropertyEntity: ($) => seq("ObjectProperty", "(", field("iri", $.IRI), ")"),

    DataPropertyEntity: ($) => seq("DataProperty", "(", field("iri", $.IRI), ")"),

    NamedIndividualEntity: ($) => seq("NamedIndividual", "(", field("iri", $.IRI), ")"),

    _ClassExpression: ($) =>
      choice(
        $.IRI,
        $.ObjectIntersectionOf,
        $.ObjectUnionOf,
        $.ObjectComplementOf,
        $.ObjectSomeValuesFrom,
        $.ObjectAllValuesFrom,
        $.DataSomeValuesFrom,
        $.DataAllValuesFrom,
      ),

    ObjectIntersectionOf: ($) => seq("ObjectIntersectionOf", "(", repeat($._ClassExpression), ")"),
    ObjectUnionOf: ($) => seq("ObjectUnionOf", "(", repeat($._ClassExpression), ")"),
    ObjectComplementOf: ($) => seq("ObjectComplementOf", "(", $._ClassExpression, ")"),
    ObjectSomeValuesFrom: ($) => seq("ObjectSomeValuesFrom", "(", $.IRI, $._ClassExpression, ")"),
    ObjectAllValuesFrom: ($) => seq("ObjectAllValuesFrom", "(", $.IRI, $._ClassExpression, ")"),
    DataSomeValuesFrom: ($) => seq("DataSomeValuesFrom", "(", $.IRI, $.DataRange, ")"),
    DataAllValuesFrom: ($) => seq("DataAllValuesFrom", "(", $.IRI, $.DataRange, ")"),
    DataRange: ($) => choice($.IRI),

    SubClassOfAxiom: ($) =>
      seq("SubClassOf", "(", field("subClass", $._ClassExpression), field("superClass", $._ClassExpression), ")"),

    EquivalentClassesAxiom: ($) => seq("EquivalentClasses", "(", repeat(field("classExpr", $._ClassExpression)), ")"),

    DisjointClassesAxiom: ($) => seq("DisjointClasses", "(", repeat(field("classExpr", $._ClassExpression)), ")"),

    ObjectPropertyAssertionAxiom: ($) =>
      seq(
        "ObjectPropertyAssertion",
        "(",
        field("property", $.IRI),
        field("subject", $.IRI),
        field("object", $.IRI),
        ")",
      ),

    DataPropertyAssertionAxiom: ($) =>
      seq(
        "DataPropertyAssertion",
        "(",
        field("property", $.IRI),
        field("subject", $.IRI),
        field("value", $.StringLiteral),
        ")",
      ),

    ClassAssertionAxiom: ($) =>
      seq("ClassAssertion", "(", field("classExpr", $._ClassExpression), field("individual", $.IRI), ")"),

    TransitiveObjectPropertyAxiom: ($) => seq("TransitiveObjectProperty", "(", field("property", $.IRI), ")"),
  },
});

export default owl2Language;
