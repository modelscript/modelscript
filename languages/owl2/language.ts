import {
  choice,
  def,
  error,
  field,
  language,
  optional,
  repeat,
  seq,
  warning,
  type QueryDB,
  type SymbolEntry,
} from "@modelscript/compiler";

interface CstNode {
  type: string;
  text: string;
  childForFieldName(name: string): CstNode | null;
  namedChildren?: CstNode[];
}

export default language({
  name: "owl2",

  extras: () => [
    /\s/,
    /#.*/, // Line comments in OWL2 FSS usually start with #
  ],

  word: ($) => $.IDENT,

  rules: {
    // Top-level
    OntologyDocument: ($) =>
      def({
        syntax: seq(repeat($.PrefixDeclaration), $.Ontology),
        symbol: () => ({
          kind: "OntologyDocument",
        }),
      }),

    PrefixDeclaration: ($) =>
      seq("Prefix", "(", field("name", optional($.PrefixName)), "=", field("iri", $.FullIRI), ")"),

    IDENT: () => /[a-zA-Z_][a-zA-Z0-9_]*/,
    PrefixName: ($) => seq($.IDENT, ":"),
    FullIRI: () => /<[^>]*>/,
    AbbreviatedIRI: ($) => seq($.IDENT, ":", $.IDENT),
    IRI: ($) => choice($.FullIRI, $.AbbreviatedIRI),
    StringLiteral: () => /"[^"]*"/,

    Ontology: ($) =>
      def({
        syntax: seq(
          "Ontology",
          "(",
          optional(field("iri", $.IRI)),
          repeat(field("import", $.ImportDeclaration)),
          repeat(field("axiom", $._Axiom)),
          ")",
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Ontology",
          name: self.iri,
        }),
        queries: {
          axioms: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id),
        },
      }),

    ImportDeclaration: ($) =>
      def({
        syntax: seq("Import", "(", field("iri", $.IRI), ")"),
        symbol: (self: Record<string, string>) => ({
          kind: "Import",
          name: self.iri,
        }),
      }),

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

    Declaration: ($) =>
      def({
        syntax: seq("Declaration", "(", field("entity", $._Entity), ")"),
        symbol: (self: Record<string, string>) => ({
          kind: "Declaration",
          name: self.entity,
        }),
      }),

    _Entity: ($) => choice($.ClassEntity, $.ObjectPropertyEntity, $.DataPropertyEntity, $.NamedIndividualEntity),

    ClassEntity: ($) =>
      def({
        syntax: seq("Class", "(", field("iri", $.IRI), ")"),
        symbol: (self: Record<string, string>) => ({
          kind: "Class",
          name: self.iri,
          exports: [self.iri],
          graphics: { shape: "class-box", color: "#e74c3c" },
        }),
      }),

    ObjectPropertyEntity: ($) =>
      def({
        syntax: seq("ObjectProperty", "(", field("iri", $.IRI), ")"),
        symbol: (self: Record<string, string>) => ({
          kind: "ObjectProperty",
          name: self.iri,
          exports: [self.iri],
          graphics: { shape: "diamond", color: "#9b59b6" },
        }),
      }),

    DataPropertyEntity: ($) =>
      def({
        syntax: seq("DataProperty", "(", field("iri", $.IRI), ")"),
        symbol: (self: Record<string, string>) => ({
          kind: "DataProperty",
          name: self.iri,
          exports: [self.iri],
        }),
      }),

    NamedIndividualEntity: ($) =>
      def({
        syntax: seq("NamedIndividual", "(", field("iri", $.IRI), ")"),
        symbol: (self: Record<string, string>) => ({
          kind: "Individual",
          name: self.iri,
          exports: [self.iri],
        }),
      }),

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
    DataRange: ($) => choice($.IRI), // Simplification for now

    SubClassOfAxiom: ($) =>
      def({
        syntax: seq(
          "SubClassOf",
          "(",
          field("subClass", $._ClassExpression),
          field("superClass", $._ClassExpression),
          ")",
        ),
        symbol: () => ({
          kind: "SubClassOf",
        }),
        queries: {
          lint: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as CstNode | undefined;
            if (!cst) return;
            const sub = cst.childForFieldName("subClass");
            const sup = cst.childForFieldName("superClass");
            if (sub?.type === "IRI") {
              const entries = db.byName(sub.text);
              if (!entries.find((e: SymbolEntry) => e.kind === "Class")) {
                warning(`Unresolved or undeclared IRI '${sub.text}' used as subclass.`, { field: "subClass" });
              }
            }
            if (sup?.type === "IRI") {
              const entries = db.byName(sup.text);
              if (!entries.find((e: SymbolEntry) => e.kind === "Class")) {
                warning(`Unresolved or undeclared IRI '${sup.text}' used as superclass.`, { field: "superClass" });
              }
            }
          },
        },
      }),

    EquivalentClassesAxiom: ($) =>
      def({
        syntax: seq("EquivalentClasses", "(", repeat(field("classExpr", $._ClassExpression)), ")"),
        symbol: () => ({ kind: "EquivalentClasses" }),
        queries: {
          lint: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as CstNode | undefined;
            if (!cst) return;
            for (const child of cst.namedChildren ?? []) {
              if (child.type === "IRI") {
                const entries = db.byName(child.text);
                if (!entries.find((e: SymbolEntry) => e.kind === "Class")) {
                  warning(`Undeclared class IRI '${child.text}' in EquivalentClasses.`);
                }
              }
            }
          },
        },
      }),

    DisjointClassesAxiom: ($) =>
      def({
        syntax: seq("DisjointClasses", "(", repeat(field("classExpr", $._ClassExpression)), ")"),
        symbol: () => ({ kind: "DisjointClasses" }),
        queries: {
          lint: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as CstNode | undefined;
            if (!cst) return;
            const classIris: string[] = [];
            for (const child of cst.namedChildren ?? []) {
              if (child.type === "IRI") {
                const entries = db.byName(child.text);
                if (!entries.find((e: SymbolEntry) => e.kind === "Class")) {
                  warning(`Undeclared class IRI '${child.text}' in DisjointClasses.`);
                }
                if (classIris.includes(child.text)) {
                  error(
                    `Duplicate class IRI '${child.text}' in DisjointClasses — a class cannot be disjoint with itself.`,
                  );
                }
                classIris.push(child.text);
              }
            }
          },
        },
      }),

    ObjectPropertyAssertionAxiom: ($) =>
      def({
        syntax: seq(
          "ObjectPropertyAssertion",
          "(",
          field("property", $.IRI),
          field("subject", $.IRI),
          field("object", $.IRI),
          ")",
        ),
        symbol: () => ({ kind: "ObjectPropertyAssertion" }),
        queries: {
          lint: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as CstNode | undefined;
            if (!cst) return;
            const prop = cst.childForFieldName("property");
            if (prop) {
              const entries = db.byName(prop.text);
              if (!entries.find((e: SymbolEntry) => e.kind === "ObjectProperty")) {
                warning(`'${prop.text}' is not declared as an ObjectProperty.`, { field: "property" });
              }
            }
            const subj = cst.childForFieldName("subject");
            if (subj) {
              const entries = db.byName(subj.text);
              if (!entries.find((e: SymbolEntry) => e.kind === "Individual")) {
                warning(`'${subj.text}' is not declared as a NamedIndividual.`, { field: "subject" });
              }
            }
          },
        },
      }),

    DataPropertyAssertionAxiom: ($) =>
      def({
        syntax: seq(
          "DataPropertyAssertion",
          "(",
          field("property", $.IRI),
          field("subject", $.IRI),
          field("value", $.StringLiteral),
          ")",
        ),
        symbol: () => ({ kind: "DataPropertyAssertion" }),
        queries: {
          lint: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as CstNode | undefined;
            if (!cst) return;
            const prop = cst.childForFieldName("property");
            if (prop) {
              const entries = db.byName(prop.text);
              if (!entries.find((e: SymbolEntry) => e.kind === "DataProperty")) {
                warning(`'${prop.text}' is not declared as a DataProperty.`, { field: "property" });
              }
            }
          },
        },
      }),

    ClassAssertionAxiom: ($) =>
      def({
        syntax: seq("ClassAssertion", "(", field("classExpr", $._ClassExpression), field("individual", $.IRI), ")"),
        symbol: () => ({ kind: "ClassAssertion" }),
        queries: {
          lint: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as CstNode | undefined;
            if (!cst) return;
            const ind = cst.childForFieldName("individual");
            if (ind) {
              const entries = db.byName(ind.text);
              if (!entries.find((e: SymbolEntry) => e.kind === "Individual")) {
                warning(`'${ind.text}' is not declared as a NamedIndividual.`, { field: "individual" });
              }
            }
            const cls = cst.childForFieldName("classExpr");
            if (cls?.type === "IRI") {
              const entries = db.byName(cls.text);
              if (!entries.find((e: SymbolEntry) => e.kind === "Class")) {
                warning(`'${cls.text}' is not declared as a Class.`, { field: "classExpr" });
              }
            }
          },
        },
      }),

    TransitiveObjectPropertyAxiom: ($) =>
      def({
        syntax: seq("TransitiveObjectProperty", "(", field("property", $.IRI), ")"),
        symbol: () => ({ kind: "TransitiveObjectProperty" }),
        queries: {
          lint: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as CstNode | undefined;
            if (!cst) return;
            const prop = cst.childForFieldName("property");
            if (prop) {
              const entries = db.byName(prop.text);
              if (!entries.find((e: SymbolEntry) => e.kind === "ObjectProperty")) {
                warning(`'${prop.text}' is not declared as an ObjectProperty.`, { field: "property" });
              }
            }
          },
        },
      }),
  },

  // =====================================================================
  // Top-Level Adapters (Approach C — accept projected axioms)
  // =====================================================================

  adapters: {
    /**
     * Accept projected Modelica classes as OWL2 ClassEntity declarations.
     * This enables the unified ontology to include Modelica-originated classes.
     */
    modelica: {
      ClassDefinition: (_db, foreignNode) => ({
        target: "ClassEntity",
        props: {
          iri: `mo:${foreignNode.name}`,
          sourceLang: "modelica",
        },
      }),
    },
    /**
     * Accept projected SysML2 definitions as OWL2 ClassEntity declarations.
     */
    sysml2: {
      PartDefinition: (_db, foreignNode) => ({
        target: "ClassEntity",
        props: {
          iri: `sysml:${foreignNode.name}`,
          sourceLang: "sysml2",
        },
      }),
      PortDefinition: (_db, foreignNode) => ({
        target: "ObjectPropertyEntity",
        props: {
          iri: `sysml:hasPort_${foreignNode.name}`,
          sourceLang: "sysml2",
        },
      }),
    },
    /**
     * Accept projected STEP entities as OWL2 ClassEntity declarations.
     */
    step: {
      EntityInstance: (_db, foreignNode) => ({
        target: "ClassEntity",
        props: {
          iri: `step:${foreignNode.name}`,
          sourceLang: "step",
        },
      }),
    },
  },
});
