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
    PrefixName: ($) => choice(seq($.IDENT, token(":")), token(":")),
    FullIRI: ($) => /<[^>]*>/,
    AbbreviatedIRI: ($) => choice(seq($.IDENT, token(":"), $.IDENT), seq(token(":"), $.IDENT)),
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
    INTEGER: ($) => token(/[0-9]+/),
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
    ObjectIntersectionOf: ($) => seq(token("ObjectIntersectionOf"), token("("), repeat($._ClassExpression), token(")")),
    ObjectUnionOf: ($) => seq(token("ObjectUnionOf"), token("("), repeat($._ClassExpression), token(")")),
    ObjectComplementOf: ($) => seq(token("ObjectComplementOf"), token("("), $._ClassExpression, token(")")),
    ObjectSomeValuesFrom: ($) => seq(token("ObjectSomeValuesFrom"), token("("), $.IRI, $._ClassExpression, token(")")),
    ObjectAllValuesFrom: ($) => seq(token("ObjectAllValuesFrom"), token("("), $.IRI, $._ClassExpression, token(")")),
    ObjectHasSelf: ($) => seq(token("ObjectHasSelf"), token("("), $.IRI, token(")")),
    ObjectHasValue: ($) => seq(token("ObjectHasValue"), token("("), $.IRI, $.IRI, token(")")),
    ObjectOneOf: ($) => seq(token("ObjectOneOf"), token("("), repeat($.IRI), token(")")),
    ObjectMinCardinality: ($) =>
      seq(token("ObjectMinCardinality"), token("("), $.INTEGER, $.IRI, optional($._ClassExpression), token(")")),
    ObjectMaxCardinality: ($) =>
      seq(token("ObjectMaxCardinality"), token("("), $.INTEGER, $.IRI, optional($._ClassExpression), token(")")),
    ObjectExactCardinality: ($) =>
      seq(token("ObjectExactCardinality"), token("("), $.INTEGER, $.IRI, optional($._ClassExpression), token(")")),
    DataSomeValuesFrom: ($) => seq(token("DataSomeValuesFrom"), token("("), $.IRI, $.DataRange, token(")")),
    DataAllValuesFrom: ($) => seq(token("DataAllValuesFrom"), token("("), $.IRI, $.DataRange, token(")")),
    DataMinCardinality: ($) =>
      seq(token("DataMinCardinality"), token("("), $.INTEGER, $.IRI, optional($.DataRange), token(")")),
    DataMaxCardinality: ($) =>
      seq(token("DataMaxCardinality"), token("("), $.INTEGER, $.IRI, optional($.DataRange), token(")")),
    DataExactCardinality: ($) =>
      seq(token("DataExactCardinality"), token("("), $.INTEGER, $.IRI, optional($.DataRange), token(")")),
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
    SubObjectPropertyOfAxiom: ($) =>
      seq(token("SubObjectPropertyOf"), token("("), field(undefined, $.IRI), field(undefined, $.IRI), token(")")),
    SubDataPropertyOfAxiom: ($) =>
      seq(token("SubDataPropertyOf"), token("("), field(undefined, $.IRI), field(undefined, $.IRI), token(")")),
    InverseObjectPropertiesAxiom: ($) =>
      seq(token("InverseObjectProperties"), token("("), field(undefined, $.IRI), field(undefined, $.IRI), token(")")),
    DisjointObjectPropertiesAxiom: ($) =>
      seq(token("DisjointObjectProperties"), token("("), repeat(field(undefined, $.IRI)), token(")")),
    ObjectPropertyDomainAxiom: ($) =>
      seq(
        token("ObjectPropertyDomain"),
        token("("),
        field(undefined, $.IRI),
        field(undefined, $._ClassExpression),
        token(")"),
      ),
    ObjectPropertyRangeAxiom: ($) =>
      seq(
        token("ObjectPropertyRange"),
        token("("),
        field(undefined, $.IRI),
        field(undefined, $._ClassExpression),
        token(")"),
      ),
    DataPropertyDomainAxiom: ($) =>
      seq(
        token("DataPropertyDomain"),
        token("("),
        field(undefined, $.IRI),
        field(undefined, $._ClassExpression),
        token(")"),
      ),
    DataPropertyRangeAxiom: ($) =>
      seq(token("DataPropertyRange"), token("("), field(undefined, $.IRI), field(undefined, $.DataRange), token(")")),
    FunctionalObjectPropertyAxiom: ($) =>
      seq(token("FunctionalObjectProperty"), token("("), field(undefined, $.IRI), token(")")),
    InverseFunctionalObjectPropertyAxiom: ($) =>
      seq(token("InverseFunctionalObjectProperty"), token("("), field(undefined, $.IRI), token(")")),
    ReflexiveObjectPropertyAxiom: ($) =>
      seq(token("ReflexiveObjectProperty"), token("("), field(undefined, $.IRI), token(")")),
    IrreflexiveObjectPropertyAxiom: ($) =>
      seq(token("IrreflexiveObjectProperty"), token("("), field(undefined, $.IRI), token(")")),
    SymmetricObjectPropertyAxiom: ($) =>
      seq(token("SymmetricObjectProperty"), token("("), field(undefined, $.IRI), token(")")),
    AsymmetricObjectPropertyAxiom: ($) =>
      seq(token("AsymmetricObjectProperty"), token("("), field(undefined, $.IRI), token(")")),
    TransitiveObjectPropertyAxiom: ($) =>
      seq(token("TransitiveObjectProperty"), token("("), field(undefined, $.IRI), token(")")),
    FunctionalDataPropertyAxiom: ($) =>
      seq(token("FunctionalDataProperty"), token("("), field(undefined, $.IRI), token(")")),
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
    NegativeObjectPropertyAssertionAxiom: ($) =>
      seq(
        token("NegativeObjectPropertyAssertion"),
        token("("),
        field(undefined, $.IRI),
        field(undefined, $.IRI),
        field(undefined, $.IRI),
        token(")"),
      ),
    NegativeDataPropertyAssertionAxiom: ($) =>
      seq(
        token("NegativeDataPropertyAssertion"),
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
    SameIndividualAxiom: ($) => seq(token("SameIndividual"), token("("), repeat(field(undefined, $.IRI)), token(")")),
    DifferentIndividualsAxiom: ($) =>
      seq(token("DifferentIndividuals"), token("("), repeat(field(undefined, $.IRI)), token(")")),
  },
});
