// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  choice,
  field,
  language,
  optional,
  repeat,
  semanticToken,
  seq,
  tggComplement,
  tggEq,
  tggRule,
} from "@modelscript/dsl";

export const owl2Language = language({
  name: "owl2",
  displayName: "OWL 2",
  fileExtensions: [".owl", ".owl2", ".ofn", ".ttl"],
  lsp: {
    fileExtensions: [".owl", ".owl2", ".ofn", ".ttl"],
    icons: {
      light: "./assets/owl2/icon-light.png",
      dark: "./assets/owl2/icon-dark.png",
    },
  },

  writeback: (ctx) => {
    const { entry, fullText, newValue } = ctx;
    if (entry?.startByte != null && entry?.endByte != null && entry.endByte > entry.startByte) {
      const declText = fullText.substring(entry.startByte, entry.endByte);
      // E.g. DataPropertyAssertion(:maxPayload :Drone "2.5"^^xsd:double)
      const strMatch = declText.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (strMatch && strMatch.index !== undefined) {
        const valStartByte = entry.startByte + strMatch.index + 1;
        const valEndByte = valStartByte + strMatch[1].length;
        const cleanVal = newValue.replace(/^"|"$/g, "");
        return { startByte: valStartByte, endByte: valEndByte, newText: cleanVal };
      }

      const numMatch = declText.match(/\s+([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*\)/);
      if (numMatch && numMatch.index !== undefined) {
        const valStartByte = entry.startByte + numMatch.index + (numMatch[0].length - numMatch[1].length - 1);
        const valEndByte = valStartByte + numMatch[1].length;
        return { startByte: valStartByte, endByte: valEndByte, newText: newValue.trim() };
      }
    }
    return null;
  },

  actions: [
    {
      id: "validate_consistency",
      title: "Validate Ontology Consistency",
      description:
        "Validates the logical consistency and satisfiability of the active OWL 2 ontology using the tableau reasoner.",
      category: "verify",
      ui: {
        editorTitle: {
          icon: "$(check)",
          group: "navigation@1",
        },
        editorContextMenu: {
          group: "1_run@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "owl2_validate_consistency",
          displayName: "Validate OWL2 Ontology Consistency",
          modelDescription: "Validates the logical consistency and satisfiability of an OWL 2 ontology.",
        },
      },
    },
    {
      id: "open_ontology_diagram",
      title: "Open Ontology Graph Diagram",
      description: "Renders an interactive 2D node-link graph diagram of classes, properties, and axioms.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(organization)",
          group: "navigation@0",
        },
        editorContextMenu: {
          group: "3_analysis@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@1",
        },
        languageModelTool: {
          name: "owl2_open_ontology_diagram",
          displayName: "Open OWL2 Graph Diagram",
          modelDescription: "Renders an interactive 2D graph diagram of classes and relations.",
        },
      },
    },
    {
      id: "explain_inferences",
      title: "Explain Inferences & Justifications",
      description: "Computes the minimal conflict cores and axiom justifications for inferred class subsumptions.",
      category: "query",
      inputs: {
        subClass: { type: "string", description: "Subclass IRI" },
        superClass: { type: "string", description: "Superclass IRI" },
      },
      ui: {
        editorContextMenu: {
          group: "3_analysis@1",
        },
        languageModelTool: {
          name: "owl2_explain_inferences",
          displayName: "Explain OWL2 Inferences",
          modelDescription: "Extracts axiom justification trees explaining inferred subclass relationships.",
        },
      },
    },
    {
      id: "query_sparql",
      title: "Query with SPARQL-DL",
      description: "Executes a SPARQL-DL graph pattern query against the active polyglot knowledge graph.",
      category: "query",
      inputs: {
        query: { type: "string", description: "SPARQL-DL query expression" },
      },
      ui: {
        editorContextMenu: {
          group: "3_analysis@2",
        },
        languageModelTool: {
          name: "owl2_query_sparql",
          displayName: "Query OWL2 with SPARQL-DL",
          modelDescription: "Executes a SPARQL-DL graph query against the active ontology.",
        },
      },
    },
  ],

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

  polyglot: {
    languages: ["sysml2", "modelica"],
    rules: [
      tggRule({
        name: "OWL2ClassToSysML2Part",
        sourceLang: "owl2",
        targetLang: "sysml2",
        source: ($, v) => $.ClassDeclaration({ iri: v("iri") }),
        target: ($, v) => $.PartDefinition({ declaredName: v("iri") }),
        where: (v) => [tggEq(v("iri"), v("iri")), tggComplement(["annotations"])],
      }),
      tggRule({
        name: "OWL2SubClassToSysML2Specialization",
        sourceLang: "owl2",
        targetLang: "sysml2",
        source: ($, v) => $.SubClassOfAxiom({ subClass: v("sub"), superClass: v("sup") }),
        target: ($, v) => $.Specialization({ generalName: v("sup"), specificName: v("sub") }),
        where: (v) => [tggEq(v("sub"), v("sub")), tggEq(v("sup"), v("sup"))],
      }),
      tggRule({
        name: "OWL2ObjectPropertyToSysML2Port",
        sourceLang: "owl2",
        targetLang: "sysml2",
        source: ($, v) => $.ObjectPropertyDeclaration({ iri: v("iri") }),
        target: ($, v) => $.PortDefinition({ declaredName: v("iri") }),
        where: (v) => [tggEq(v("iri"), v("iri")), tggComplement(["isFunctional", "isTransitive"])],
      }),
      tggRule({
        name: "OWL2DataPropertyToSysML2Attribute",
        sourceLang: "owl2",
        targetLang: "sysml2",
        source: ($, v) => $.DataPropertyDeclaration({ iri: v("iri") }),
        target: ($, v) => $.AttributeDefinition({ declaredName: v("iri") }),
        where: (v) => [tggEq(v("iri"), v("iri")), tggComplement(["rangeType"])],
      }),
      tggRule({
        name: "OWL2ClassToModelicaModel",
        sourceLang: "owl2",
        targetLang: "modelica",
        source: ($, v) => $.ClassDeclaration({ iri: v("iri") }),
        target: ($, v) => $.ClassDefinition({ name: v("iri"), classKind: "model" }),
        where: (v) => [tggEq(v("iri"), v("iri")), tggComplement(["annotations"])],
      }),
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
    INTEGER: () => semanticToken("number", /[0-9]+/),
    PrefixName: ($) => choice(seq($.IDENT, ":"), ":"),
    FullIRI: () => /<[^>]*>/,
    AbbreviatedIRI: ($) => choice(seq($.IDENT, ":", $.IDENT), seq(":", $.IDENT)),
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
        $.SubObjectPropertyOfAxiom,
        $.SubDataPropertyOfAxiom,
        $.InverseObjectPropertiesAxiom,
        $.DisjointObjectPropertiesAxiom,
        $.ObjectPropertyDomainAxiom,
        $.ObjectPropertyRangeAxiom,
        $.DataPropertyDomainAxiom,
        $.DataPropertyRangeAxiom,
        $.FunctionalObjectPropertyAxiom,
        $.InverseFunctionalObjectPropertyAxiom,
        $.ReflexiveObjectPropertyAxiom,
        $.IrreflexiveObjectPropertyAxiom,
        $.SymmetricObjectPropertyAxiom,
        $.AsymmetricObjectPropertyAxiom,
        $.TransitiveObjectPropertyAxiom,
        $.FunctionalDataPropertyAxiom,
        $.ObjectPropertyAssertionAxiom,
        $.DataPropertyAssertionAxiom,
        $.NegativeObjectPropertyAssertionAxiom,
        $.NegativeDataPropertyAssertionAxiom,
        $.ClassAssertionAxiom,
        $.SameIndividualAxiom,
        $.DifferentIndividualsAxiom,
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
        $.ObjectHasSelf,
        $.ObjectHasValue,
        $.ObjectOneOf,
        $.ObjectMinCardinality,
        $.ObjectMaxCardinality,
        $.ObjectExactCardinality,
        $.DataSomeValuesFrom,
        $.DataAllValuesFrom,
        $.DataMinCardinality,
        $.DataMaxCardinality,
        $.DataExactCardinality,
      ),

    ObjectIntersectionOf: ($) => seq("ObjectIntersectionOf", "(", repeat($._ClassExpression), ")"),
    ObjectUnionOf: ($) => seq("ObjectUnionOf", "(", repeat($._ClassExpression), ")"),
    ObjectComplementOf: ($) => seq("ObjectComplementOf", "(", $._ClassExpression, ")"),
    ObjectSomeValuesFrom: ($) => seq("ObjectSomeValuesFrom", "(", $.IRI, $._ClassExpression, ")"),
    ObjectAllValuesFrom: ($) => seq("ObjectAllValuesFrom", "(", $.IRI, $._ClassExpression, ")"),
    ObjectHasSelf: ($) => seq("ObjectHasSelf", "(", field("property", $.IRI), ")"),
    ObjectHasValue: ($) => seq("ObjectHasValue", "(", field("property", $.IRI), field("individual", $.IRI), ")"),
    ObjectOneOf: ($) => seq("ObjectOneOf", "(", repeat(field("individual", $.IRI)), ")"),

    ObjectMinCardinality: ($) =>
      seq(
        "ObjectMinCardinality",
        "(",
        field("cardinality", $.INTEGER),
        field("property", $.IRI),
        optional(field("filler", $._ClassExpression)),
        ")",
      ),
    ObjectMaxCardinality: ($) =>
      seq(
        "ObjectMaxCardinality",
        "(",
        field("cardinality", $.INTEGER),
        field("property", $.IRI),
        optional(field("filler", $._ClassExpression)),
        ")",
      ),
    ObjectExactCardinality: ($) =>
      seq(
        "ObjectExactCardinality",
        "(",
        field("cardinality", $.INTEGER),
        field("property", $.IRI),
        optional(field("filler", $._ClassExpression)),
        ")",
      ),

    DataSomeValuesFrom: ($) => seq("DataSomeValuesFrom", "(", $.IRI, $.DataRange, ")"),
    DataAllValuesFrom: ($) => seq("DataAllValuesFrom", "(", $.IRI, $.DataRange, ")"),
    DataMinCardinality: ($) =>
      seq(
        "DataMinCardinality",
        "(",
        field("cardinality", $.INTEGER),
        field("property", $.IRI),
        optional(field("range", $.DataRange)),
        ")",
      ),
    DataMaxCardinality: ($) =>
      seq(
        "DataMaxCardinality",
        "(",
        field("cardinality", $.INTEGER),
        field("property", $.IRI),
        optional(field("range", $.DataRange)),
        ")",
      ),
    DataExactCardinality: ($) =>
      seq(
        "DataExactCardinality",
        "(",
        field("cardinality", $.INTEGER),
        field("property", $.IRI),
        optional(field("range", $.DataRange)),
        ")",
      ),

    DataRange: ($) => choice($.IRI),

    SubClassOfAxiom: ($) =>
      seq("SubClassOf", "(", field("subClass", $._ClassExpression), field("superClass", $._ClassExpression), ")"),

    EquivalentClassesAxiom: ($) => seq("EquivalentClasses", "(", repeat(field("classExpr", $._ClassExpression)), ")"),

    DisjointClassesAxiom: ($) => seq("DisjointClasses", "(", repeat(field("classExpr", $._ClassExpression)), ")"),

    SubObjectPropertyOfAxiom: ($) =>
      seq("SubObjectPropertyOf", "(", field("subProperty", $.IRI), field("superProperty", $.IRI), ")"),

    SubDataPropertyOfAxiom: ($) =>
      seq("SubDataPropertyOf", "(", field("subProperty", $.IRI), field("superProperty", $.IRI), ")"),

    InverseObjectPropertiesAxiom: ($) =>
      seq("InverseObjectProperties", "(", field("property", $.IRI), field("inverseProperty", $.IRI), ")"),

    DisjointObjectPropertiesAxiom: ($) => seq("DisjointObjectProperties", "(", repeat(field("property", $.IRI)), ")"),

    ObjectPropertyDomainAxiom: ($) =>
      seq("ObjectPropertyDomain", "(", field("property", $.IRI), field("domain", $._ClassExpression), ")"),

    ObjectPropertyRangeAxiom: ($) =>
      seq("ObjectPropertyRange", "(", field("property", $.IRI), field("range", $._ClassExpression), ")"),

    DataPropertyDomainAxiom: ($) =>
      seq("DataPropertyDomain", "(", field("property", $.IRI), field("domain", $._ClassExpression), ")"),

    DataPropertyRangeAxiom: ($) =>
      seq("DataPropertyRange", "(", field("property", $.IRI), field("range", $.DataRange), ")"),

    FunctionalObjectPropertyAxiom: ($) => seq("FunctionalObjectProperty", "(", field("property", $.IRI), ")"),

    InverseFunctionalObjectPropertyAxiom: ($) =>
      seq("InverseFunctionalObjectProperty", "(", field("property", $.IRI), ")"),

    ReflexiveObjectPropertyAxiom: ($) => seq("ReflexiveObjectProperty", "(", field("property", $.IRI), ")"),

    IrreflexiveObjectPropertyAxiom: ($) => seq("IrreflexiveObjectProperty", "(", field("property", $.IRI), ")"),

    SymmetricObjectPropertyAxiom: ($) => seq("SymmetricObjectProperty", "(", field("property", $.IRI), ")"),

    AsymmetricObjectPropertyAxiom: ($) => seq("AsymmetricObjectProperty", "(", field("property", $.IRI), ")"),

    TransitiveObjectPropertyAxiom: ($) => seq("TransitiveObjectProperty", "(", field("property", $.IRI), ")"),

    FunctionalDataPropertyAxiom: ($) => seq("FunctionalDataProperty", "(", field("property", $.IRI), ")"),

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

    NegativeObjectPropertyAssertionAxiom: ($) =>
      seq(
        "NegativeObjectPropertyAssertion",
        "(",
        field("property", $.IRI),
        field("subject", $.IRI),
        field("object", $.IRI),
        ")",
      ),

    NegativeDataPropertyAssertionAxiom: ($) =>
      seq(
        "NegativeDataPropertyAssertion",
        "(",
        field("property", $.IRI),
        field("subject", $.IRI),
        field("value", $.StringLiteral),
        ")",
      ),

    ClassAssertionAxiom: ($) =>
      seq("ClassAssertion", "(", field("classExpr", $._ClassExpression), field("individual", $.IRI), ")"),

    SameIndividualAxiom: ($) => seq("SameIndividual", "(", repeat(field("individual", $.IRI)), ")"),

    DifferentIndividualsAxiom: ($) => seq("DifferentIndividuals", "(", repeat(field("individual", $.IRI)), ")"),
  },

  symbols: {
    ClassEntity: { name: "iri", kind: "Class", scope: true },
    ObjectPropertyEntity: { name: "iri", kind: "ObjectProperty", scope: false },
    DataPropertyEntity: { name: "iri", kind: "DataProperty", scope: false },
    NamedIndividualEntity: { name: "iri", kind: "Individual", scope: false },
  },
});

export default owl2Language;
