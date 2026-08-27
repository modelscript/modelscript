module.exports = grammar({
  name: "owl2",
  extras: ($) => [/\s/, /#.*/],
  word: ($) => $.IDENT,
  rules: {
    OntologyDocument: ($) => seq(repeat($.PrefixDeclaration), $.Ontology),
    PrefixDeclaration: ($) =>
      seq(
        token("Prefix"),
        token("("),
        field(undefined, choice($.PrefixName, seq())),
        token("="),
        field(undefined, $.FullIRI),
        token(")"),
      ),
    IDENT: ($) => token(/[a-zA-Z_][a-zA-Z0-9_]*/),
    PrefixName: ($) => seq($.IDENT, token(":")),
    FullIRI: ($) => /<[^>]*>/,
    AbbreviatedIRI: ($) => seq($.IDENT, token(":"), $.IDENT),
    IRI: ($) => choice($.FullIRI, $.AbbreviatedIRI),
    StringLiteral: ($) => /"[^"]*"/,
    Ontology: ($) =>
      seq(
        token("Ontology"),
        token("("),
        choice(field(undefined, $.IRI), seq()),
        repeat(field(undefined, $.ImportDeclaration)),
        repeat(field(undefined, $._Axiom)),
        token(")"),
      ),
    ImportDeclaration: ($) => seq(token("Import"), token("("), field(undefined, $.IRI), token(")")),
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
    Declaration: ($) => seq(token("Declaration"), token("("), field(undefined, $._Entity), token(")")),
    _Entity: ($) => choice($.ClassEntity, $.ObjectPropertyEntity, $.DataPropertyEntity, $.NamedIndividualEntity),
    ClassEntity: ($) => seq(token("Class"), token("("), field(undefined, $.IRI), token(")")),
    ObjectPropertyEntity: ($) => seq(token("ObjectProperty"), token("("), field(undefined, $.IRI), token(")")),
    DataPropertyEntity: ($) => seq(token("DataProperty"), token("("), field(undefined, $.IRI), token(")")),
    NamedIndividualEntity: ($) => seq(token("NamedIndividual"), token("("), field(undefined, $.IRI), token(")")),
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
    ObjectIntersectionOf: ($) => seq(token("ObjectIntersectionOf"), token("("), repeat($._ClassExpression), token(")")),
    ObjectUnionOf: ($) => seq(token("ObjectUnionOf"), token("("), repeat($._ClassExpression), token(")")),
    ObjectComplementOf: ($) => seq(token("ObjectComplementOf"), token("("), $._ClassExpression, token(")")),
    ObjectSomeValuesFrom: ($) => seq(token("ObjectSomeValuesFrom"), token("("), $.IRI, $._ClassExpression, token(")")),
    ObjectAllValuesFrom: ($) => seq(token("ObjectAllValuesFrom"), token("("), $.IRI, $._ClassExpression, token(")")),
    DataSomeValuesFrom: ($) => seq(token("DataSomeValuesFrom"), token("("), $.IRI, $.DataRange, token(")")),
    DataAllValuesFrom: ($) => seq(token("DataAllValuesFrom"), token("("), $.IRI, $.DataRange, token(")")),
    DataRange: ($) => choice($.IRI),
    SubClassOfAxiom: ($) =>
      seq(
        token("SubClassOf"),
        token("("),
        field(undefined, $._ClassExpression),
        field(undefined, $._ClassExpression),
        token(")"),
      ),
    EquivalentClassesAxiom: ($) =>
      seq(token("EquivalentClasses"), token("("), repeat(field(undefined, $._ClassExpression)), token(")")),
    DisjointClassesAxiom: ($) =>
      seq(token("DisjointClasses"), token("("), repeat(field(undefined, $._ClassExpression)), token(")")),
    ObjectPropertyAssertionAxiom: ($) =>
      seq(
        token("ObjectPropertyAssertion"),
        token("("),
        field(undefined, $.IRI),
        field(undefined, $.IRI),
        field(undefined, $.IRI),
        token(")"),
      ),
    DataPropertyAssertionAxiom: ($) =>
      seq(
        token("DataPropertyAssertion"),
        token("("),
        field(undefined, $.IRI),
        field(undefined, $.IRI),
        field(undefined, $.StringLiteral),
        token(")"),
      ),
    ClassAssertionAxiom: ($) =>
      seq(
        token("ClassAssertion"),
        token("("),
        field(undefined, $._ClassExpression),
        field(undefined, $.IRI),
        token(")"),
      ),
    TransitiveObjectPropertyAxiom: ($) =>
      seq(token("TransitiveObjectProperty"), token("("), field(undefined, $.IRI), token(")")),
  },
});
