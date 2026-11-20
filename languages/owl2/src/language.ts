// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";
import { indexOwl2Document } from "./indexing.js";
import { owl2PolyglotConfig } from "./tgg/index.js";

/**
 * Language definition for OWL 2 Functional-Style Syntax (`.owl`, `.owl2`, `.ofn`, `.owx`, `.ttl`),
 * providing the native GLR grammar, reasoning/query IDE actions, MCP server tools,
 * and Triple Graph Grammar (TGG) synchronization rules with SysML v2 and Modelica.
 */
export const owl2Language = language({
  name: "owl2",
  displayName: "OWL 2",
  fileExtensions: [".owl", ".owl2", ".ofn", ".owx", ".ttl", ".rdf"],
  maturity: "stable",
  indexing: {
    indexFile: indexOwl2Document,
  },
  lsp: {
    fileExtensions: [".owl", ".owl2", ".ofn", ".owx", ".ttl", ".rdf"],
    icons: {
      light: "./assets/owl2/icon-light.png",
      dark: "./assets/owl2/icon-dark.png",
    },
  },
  ui: {
    panels: [
      {
        id: "owl2Diagram",
        viewType: "modelscript.owl2Diagram",
        title: "OWL 2 Ontology Taxonomy & Inspector",
        shortTitle: "Ontology",
        selector: ["*.owl", "*.owl2", "*.ofn", "*.ttl"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/Owl2Panel.tsx",
        artifactViewTypes: ["owl2", "owl", "ontology"],
      },
    ],
    stencils: [
      { label: "Class", snippet: "Declaration(Class(:NewConcept))\n" },
      { label: "ObjectProperty", snippet: "Declaration(ObjectProperty(:connectedTo))\n" },
      { label: "SubClassOf", snippet: "SubClassOf(:NewConcept :SystemComponent)\n" },
      {
        label: "Individual",
        snippet: "Declaration(NamedIndividual(:instance_1))\nClassAssertion(:NewConcept :instance_1)\n",
      },
    ],
    treeViews: [
      {
        id: "modelscript.owl2ClassHierarchy",
        name: "OWL2 Class Hierarchy",
        container: "explorer",
        when: "modelscript.owl2Active && config.modelscript.languages.owl2.enabled",
        vscodeEntry: "./src/ui/Owl2Panel.tsx",
      },
      {
        id: "modelscript.owl2PropertyHierarchy",
        name: "OWL2 Property Hierarchy",
        container: "explorer",
        when: "modelscript.owl2Active && config.modelscript.languages.owl2.enabled",
        vscodeEntry: "./src/ui/Owl2Panel.tsx",
      },
    ],
    toolbarButtons: [
      {
        id: "validateConsistency",
        label: "Run OWL2 Reasoner & Consistency Check",
        shortLabel: "Reasoner",
        tooltip: "Check ontology consistency and compute inferred class hierarchy",
        icon: "shield-check",
        views: ["diagram", "inspector", "code"],
        targets: ["morsel", "vscode"],
        placement: "primary",
        order: 10,
        actionId: "validate_consistency",
      },
      {
        id: "explainInferences",
        label: "Explain Inferred Axioms",
        tooltip: "Generate justification proofs for inferred subsumptions",
        icon: "beaker",
        views: ["diagram", "inspector"],
        targets: ["morsel", "vscode"],
        placement: "overflow",
        order: 20,
        actionId: "explain_inferences",
      },
      {
        id: "querySparql",
        label: "Run SPARQL Query",
        tooltip: "Execute a SPARQL query against the active ontology",
        icon: "search",
        views: ["*"],
        targets: ["morsel", "vscode"],
        placement: "overflow",
        order: 30,
        actionId: "query_sparql",
      },
    ],
  },

  // Bi-directional source writeback for updating literal values inside DataPropertyAssertion axioms
  writeback: (ctx) => {
    const { entry, fullText, newValue } = ctx;
    if (entry?.startOffset != null && entry?.endOffset != null && entry.endOffset > entry.startOffset) {
      const declText = fullText.substring(entry.startOffset, entry.endOffset);
      // E.g. DataPropertyAssertion(:maxPayload :Drone "2.5"^^xsd:double)
      const strMatch = declText.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (strMatch && strMatch.index !== undefined) {
        const valStartByte = entry.startOffset + strMatch.index + 1;
        const valEndByte = valStartByte + strMatch[1]!.length;
        const cleanVal = newValue.replace(/^"|"$/g, "");
        return { startOffset: valStartByte, endOffset: valEndByte, newText: cleanVal };
      }

      const numMatch = declText.match(/\s+([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*\)/);
      if (numMatch && numMatch.index !== undefined) {
        const valStartByte = entry.startOffset + numMatch.index + (numMatch[0].length - numMatch[1]!.length - 1);
        const valEndByte = valStartByte + numMatch[1]!.length;
        return { startOffset: valStartByte, endOffset: valEndByte, newText: newValue.trim() };
      }
    }
    return null;
  },

  // IDE and AI agent actions for tableau reasoning, graph visualization, and SPARQL-DL querying
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

  // Model Context Protocol (MCP) tools, resources, and prompts exposed for ontological reasoning
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

  // Polyglot Triple Graph Grammar (TGG) rules bridging OWL 2 axioms with SysML v2 and Modelica
  polyglot: owl2PolyglotConfig,

  extras: () => [
    /\s/,
    /#.*/, // Line comments in OWL2 FSS usually start with #
  ],

  word: ($) => $["IDENT"]!,

  rules: {
    // Top-level
    OntologyDocument: ($) => seq(repeat($["PrefixDeclaration"]!), $["Ontology"]!),

    PrefixDeclaration: ($) =>
      seq("Prefix", "(", field("name", optional($["PrefixName"]!)), "=", field("iri", $["FullIRI"]!), ")"),

    IDENT: () => semanticToken("identifier", /[a-zA-Z_][a-zA-Z0-9_]*/),
    INTEGER: () => semanticToken("number", /[0-9]+/),
    PrefixName: ($) => choice(seq($["IDENT"]!, ":"), ":"),
    FullIRI: () => /<[^>]*>/,
    AbbreviatedIRI: ($) => choice(seq($["IDENT"]!, ":", $["IDENT"]!), seq(":", $["IDENT"]!)),
    IRI: ($) => choice($["FullIRI"]!, $["AbbreviatedIRI"]!),
    StringLiteral: () => /"[^"]*"(?:\^\^(?:<[^>]*>|[a-zA-Z_][a-zA-Z0-9_]*:[a-zA-Z_][a-zA-Z0-9_]*))?(?:@[a-zA-Z-]+)?/,

    Ontology: ($) =>
      seq(
        "Ontology",
        "(",
        optional(field("iri", $["IRI"]!)),
        repeat(field("import", $["ImportDeclaration"]!)),
        repeat(field("axiom", $["_Axiom"]!)),
        ")",
      ),

    ImportDeclaration: ($) => seq("Import", "(", field("iri", $["IRI"]!), ")"),

    // OWL 2 Functional-Style Syntax axiom productions
    _Axiom: ($) =>
      choice(
        $["Declaration"]!,
        $["SubClassOfAxiom"]!,
        $["EquivalentClassesAxiom"]!,
        $["DisjointClassesAxiom"]!,
        $["DisjointUnionAxiom"]!,
        $["SubObjectPropertyOfAxiom"]!,
        $["SubDataPropertyOfAxiom"]!,
        $["InverseObjectPropertiesAxiom"]!,
        $["DisjointObjectPropertiesAxiom"]!,
        $["ObjectPropertyDomainAxiom"]!,
        $["ObjectPropertyRangeAxiom"]!,
        $["DataPropertyDomainAxiom"]!,
        $["DataPropertyRangeAxiom"]!,
        $["FunctionalObjectPropertyAxiom"]!,
        $["InverseFunctionalObjectPropertyAxiom"]!,
        $["ReflexiveObjectPropertyAxiom"]!,
        $["IrreflexiveObjectPropertyAxiom"]!,
        $["SymmetricObjectPropertyAxiom"]!,
        $["AsymmetricObjectPropertyAxiom"]!,
        $["TransitiveObjectPropertyAxiom"]!,
        $["FunctionalDataPropertyAxiom"]!,
        $["ObjectPropertyAssertionAxiom"]!,
        $["DataPropertyAssertionAxiom"]!,
        $["NegativeObjectPropertyAssertionAxiom"]!,
        $["NegativeDataPropertyAssertionAxiom"]!,
        $["ClassAssertionAxiom"]!,
        $["SameIndividualAxiom"]!,
        $["DifferentIndividualsAxiom"]!,
      ),

    Declaration: ($) => seq("Declaration", "(", field("entity", $["_Entity"]!), ")"),

    _Entity: ($) =>
      choice($["ClassEntity"]!, $["ObjectPropertyEntity"]!, $["DataPropertyEntity"]!, $["NamedIndividualEntity"]!),

    ClassEntity: ($) => seq("Class", "(", field("iri", $["IRI"]!), ")"),

    ObjectPropertyEntity: ($) => seq("ObjectProperty", "(", field("iri", $["IRI"]!), ")"),

    DataPropertyEntity: ($) => seq("DataProperty", "(", field("iri", $["IRI"]!), ")"),

    NamedIndividualEntity: ($) => seq("NamedIndividual", "(", field("iri", $["IRI"]!), ")"),

    // Propositional, existential/universal, nominal, and cardinality class expressions
    _ClassExpression: ($) =>
      choice(
        $["IRI"]!,
        $["ObjectIntersectionOf"]!,
        $["ObjectUnionOf"]!,
        $["ObjectComplementOf"]!,
        $["ObjectSomeValuesFrom"]!,
        $["ObjectAllValuesFrom"]!,
        $["ObjectHasSelf"]!,
        $["ObjectHasValue"]!,
        $["ObjectOneOf"]!,
        $["ObjectMinCardinality"]!,
        $["ObjectMaxCardinality"]!,
        $["ObjectExactCardinality"]!,
        $["DataSomeValuesFrom"]!,
        $["DataAllValuesFrom"]!,
        $["DataHasValue"]!,
        $["DataMinCardinality"]!,
        $["DataMaxCardinality"]!,
        $["DataExactCardinality"]!,
      ),

    ObjectIntersectionOf: ($) => seq("ObjectIntersectionOf", "(", repeat($["_ClassExpression"]!), ")"),
    ObjectUnionOf: ($) => seq("ObjectUnionOf", "(", repeat($["_ClassExpression"]!), ")"),
    ObjectComplementOf: ($) => seq("ObjectComplementOf", "(", $["_ClassExpression"]!, ")"),
    ObjectSomeValuesFrom: ($) => seq("ObjectSomeValuesFrom", "(", $["IRI"]!, $["_ClassExpression"]!, ")"),
    ObjectAllValuesFrom: ($) => seq("ObjectAllValuesFrom", "(", $["IRI"]!, $["_ClassExpression"]!, ")"),
    ObjectHasSelf: ($) => seq("ObjectHasSelf", "(", field("property", $["IRI"]!), ")"),
    ObjectHasValue: ($) =>
      seq("ObjectHasValue", "(", field("property", $["IRI"]!), field("individual", $["IRI"]!), ")"),
    ObjectOneOf: ($) => seq("ObjectOneOf", "(", repeat(field("individual", $["IRI"]!)), ")"),

    ObjectMinCardinality: ($) =>
      seq(
        "ObjectMinCardinality",
        "(",
        field("cardinality", $["INTEGER"]!),
        field("property", $["IRI"]!),
        optional(field("filler", $["_ClassExpression"]!)),
        ")",
      ),
    ObjectMaxCardinality: ($) =>
      seq(
        "ObjectMaxCardinality",
        "(",
        field("cardinality", $["INTEGER"]!),
        field("property", $["IRI"]!),
        optional(field("filler", $["_ClassExpression"]!)),
        ")",
      ),
    ObjectExactCardinality: ($) =>
      seq(
        "ObjectExactCardinality",
        "(",
        field("cardinality", $["INTEGER"]!),
        field("property", $["IRI"]!),
        optional(field("filler", $["_ClassExpression"]!)),
        ")",
      ),

    DataSomeValuesFrom: ($) => seq("DataSomeValuesFrom", "(", $["IRI"]!, $["DataRange"]!, ")"),
    DataAllValuesFrom: ($) => seq("DataAllValuesFrom", "(", $["IRI"]!, $["DataRange"]!, ")"),
    DataHasValue: ($) =>
      seq("DataHasValue", "(", field("property", $["IRI"]!), field("value", $["StringLiteral"]!), ")"),
    DataMinCardinality: ($) =>
      seq(
        "DataMinCardinality",
        "(",
        field("cardinality", $["INTEGER"]!),
        field("property", $["IRI"]!),
        optional(field("range", $["DataRange"]!)),
        ")",
      ),
    DataMaxCardinality: ($) =>
      seq(
        "DataMaxCardinality",
        "(",
        field("cardinality", $["INTEGER"]!),
        field("property", $["IRI"]!),
        optional(field("range", $["DataRange"]!)),
        ")",
      ),
    DataExactCardinality: ($) =>
      seq(
        "DataExactCardinality",
        "(",
        field("cardinality", $["INTEGER"]!),
        field("property", $["IRI"]!),
        optional(field("range", $["DataRange"]!)),
        ")",
      ),

    FacetRestriction: ($) => seq(field("facet", $["IRI"]!), field("value", $["StringLiteral"]!)),
    DatatypeRestriction: ($) =>
      seq("DatatypeRestriction", "(", field("datatype", $["IRI"]!), repeat($["FacetRestriction"]!), ")"),
    DataIntersectionOf: ($) => seq("DataIntersectionOf", "(", repeat($["DataRange"]!), ")"),
    DataUnionOf: ($) => seq("DataUnionOf", "(", repeat($["DataRange"]!), ")"),
    DataOneOf: ($) => seq("DataOneOf", "(", repeat($["StringLiteral"]!), ")"),

    DataRange: ($) =>
      choice($["IRI"]!, $["DatatypeRestriction"]!, $["DataIntersectionOf"]!, $["DataUnionOf"]!, $["DataOneOf"]!),

    // TBox, RBox, and ABox axiom grammar rules
    SubClassOfAxiom: ($) =>
      seq(
        "SubClassOf",
        "(",
        field("subClass", $["_ClassExpression"]!),
        field("superClass", $["_ClassExpression"]!),
        ")",
      ),

    EquivalentClassesAxiom: ($) =>
      seq("EquivalentClasses", "(", repeat(field("classExpr", $["_ClassExpression"]!)), ")"),

    DisjointClassesAxiom: ($) => seq("DisjointClasses", "(", repeat(field("classExpr", $["_ClassExpression"]!)), ")"),

    DisjointUnionAxiom: ($) =>
      seq("DisjointUnion", "(", field("class", $["IRI"]!), repeat(field("disjointClass", $["_ClassExpression"]!)), ")"),

    ObjectPropertyChain: ($) => seq("ObjectPropertyChain", "(", repeat(field("property", $["IRI"]!)), ")"),

    SubObjectPropertyOfAxiom: ($) =>
      seq(
        "SubObjectPropertyOf",
        "(",
        field("subProperty", choice($["IRI"]!, $["ObjectPropertyChain"]!)),
        field("superProperty", $["IRI"]!),
        ")",
      ),

    SubDataPropertyOfAxiom: ($) =>
      seq("SubDataPropertyOf", "(", field("subProperty", $["IRI"]!), field("superProperty", $["IRI"]!), ")"),

    InverseObjectPropertiesAxiom: ($) =>
      seq("InverseObjectProperties", "(", field("property", $["IRI"]!), field("inverseProperty", $["IRI"]!), ")"),

    DisjointObjectPropertiesAxiom: ($) =>
      seq("DisjointObjectProperties", "(", repeat(field("property", $["IRI"]!)), ")"),

    ObjectPropertyDomainAxiom: ($) =>
      seq("ObjectPropertyDomain", "(", field("property", $["IRI"]!), field("domain", $["_ClassExpression"]!), ")"),

    ObjectPropertyRangeAxiom: ($) =>
      seq("ObjectPropertyRange", "(", field("property", $["IRI"]!), field("range", $["_ClassExpression"]!), ")"),

    DataPropertyDomainAxiom: ($) =>
      seq("DataPropertyDomain", "(", field("property", $["IRI"]!), field("domain", $["_ClassExpression"]!), ")"),

    DataPropertyRangeAxiom: ($) =>
      seq("DataPropertyRange", "(", field("property", $["IRI"]!), field("range", $["DataRange"]!), ")"),

    FunctionalObjectPropertyAxiom: ($) => seq("FunctionalObjectProperty", "(", field("property", $["IRI"]!), ")"),

    InverseFunctionalObjectPropertyAxiom: ($) =>
      seq("InverseFunctionalObjectProperty", "(", field("property", $["IRI"]!), ")"),

    ReflexiveObjectPropertyAxiom: ($) => seq("ReflexiveObjectProperty", "(", field("property", $["IRI"]!), ")"),

    IrreflexiveObjectPropertyAxiom: ($) => seq("IrreflexiveObjectProperty", "(", field("property", $["IRI"]!), ")"),

    SymmetricObjectPropertyAxiom: ($) => seq("SymmetricObjectProperty", "(", field("property", $["IRI"]!), ")"),

    AsymmetricObjectPropertyAxiom: ($) => seq("AsymmetricObjectProperty", "(", field("property", $["IRI"]!), ")"),

    TransitiveObjectPropertyAxiom: ($) => seq("TransitiveObjectProperty", "(", field("property", $["IRI"]!), ")"),

    FunctionalDataPropertyAxiom: ($) => seq("FunctionalDataProperty", "(", field("property", $["IRI"]!), ")"),

    ObjectPropertyAssertionAxiom: ($) =>
      seq(
        "ObjectPropertyAssertion",
        "(",
        field("property", $["IRI"]!),
        field("subject", $["IRI"]!),
        field("object", $["IRI"]!),
        ")",
      ),

    DataPropertyAssertionAxiom: ($) =>
      seq(
        "DataPropertyAssertion",
        "(",
        field("property", $["IRI"]!),
        field("subject", $["IRI"]!),
        field("value", $["StringLiteral"]!),
        ")",
      ),

    NegativeObjectPropertyAssertionAxiom: ($) =>
      seq(
        "NegativeObjectPropertyAssertion",
        "(",
        field("property", $["IRI"]!),
        field("subject", $["IRI"]!),
        field("object", $["IRI"]!),
        ")",
      ),

    NegativeDataPropertyAssertionAxiom: ($) =>
      seq(
        "NegativeDataPropertyAssertion",
        "(",
        field("property", $["IRI"]!),
        field("subject", $["IRI"]!),
        field("value", $["StringLiteral"]!),
        ")",
      ),

    ClassAssertionAxiom: ($) =>
      seq("ClassAssertion", "(", field("classExpr", $["_ClassExpression"]!), field("individual", $["IRI"]!), ")"),

    SameIndividualAxiom: ($) => seq("SameIndividual", "(", repeat(field("individual", $["IRI"]!)), ")"),

    DifferentIndividualsAxiom: ($) => seq("DifferentIndividuals", "(", repeat(field("individual", $["IRI"]!)), ")"),
  },

  // Symbol indexing rules mapping OWL 2 entity declarations into the unified WorkspaceIndex
  symbols: {
    OntologyDocument: {
      name: "$self",
      kind: "Package",
      scope: true,
    },
    ClassEntity: { name: "iri", kind: "Class", scope: true },
    ObjectPropertyEntity: { name: "iri", kind: "ObjectProperty", scope: false },
    DataPropertyEntity: { name: "iri", kind: "DataProperty", scope: false },
    NamedIndividualEntity: { name: "iri", kind: "Individual", scope: false },
  },
});

export default owl2Language;
