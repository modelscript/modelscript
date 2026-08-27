module.exports = grammar({
  name: "step",
  extras: ($) => [/\s/, $.BLOCK_COMMENT],
  rules: {
    StepFile: ($) =>
      seq(
        field(undefined, $.HeaderSection),
        repeat(field(undefined, $.DataSection)),
        choice(field(undefined, $.Trailer), seq()),
      ),
    Trailer: ($) => "END-ISO-10303-21;",
    HeaderSection: ($) =>
      seq(token("ISO-10303-21;"), token("HEADER;"), repeat(field(undefined, $.HeaderEntity)), token("ENDSEC;")),
    HeaderEntity: ($) =>
      seq(field(undefined, $.KEYWORD), token("("), field(undefined, $.ParameterList), token(")"), token(";")),
    DataSection: ($) =>
      seq(
        token("DATA"),
        choice(seq(token("("), field(undefined, $.STRING), token(")")), seq()),
        token(";"),
        repeat(field(undefined, $.EntityInstance)),
        token("ENDSEC;"),
      ),
    EntityInstance: ($) =>
      seq(field(undefined, $.ENTITY_INSTANCE_NAME), token("="), field(undefined, $._Record), token(";")),
    _Record: ($) => choice($.SimpleRecord, $.ComplexRecord),
    SimpleRecord: ($) =>
      seq(field(undefined, $.KEYWORD), token("("), choice(field(undefined, $.ParameterList), seq()), token(")")),
    ComplexRecord: ($) => seq(token("("), seq($.SimpleRecord, repeat($.SimpleRecord)), token(")")),
    ParameterList: ($) => seq($._Parameter, repeat(seq(token(","), $._Parameter))),
    _Parameter: ($) =>
      choice(
        $.TypedParameter,
        $.EntityReference,
        $.REAL,
        $.INTEGER,
        $.STRING,
        $.ENUMERATION,
        $.ListValue,
        $.OMITTED_PARAMETER,
        $.DERIVED_PARAMETER,
      ),
    EntityReference: ($) => field(undefined, $.ENTITY_INSTANCE_NAME),
    TypedParameter: ($) =>
      seq(field(undefined, $.KEYWORD), token("("), choice(field(undefined, $.ParameterList), seq()), token(")")),
    ListValue: ($) => seq(token("("), choice($.ParameterList, seq()), token(")")),
    OMITTED_PARAMETER: ($) => "$",
    DERIVED_PARAMETER: ($) => "*",
    ENTITY_INSTANCE_NAME: ($) => token(seq(token("#"), token(/[0-9]+/))),
    KEYWORD: ($) => /[A-Z][A-Z0-9_]*/,
    INTEGER: ($) => token(seq(choice(choice(token("+"), token("-")), seq()), token(/[0-9]+/))),
    REAL: ($) =>
      token(
        seq(
          choice(choice(token("+"), token("-")), seq()),
          token(/[0-9]+/),
          token("."),
          choice(token(/[0-9]+/), seq()),
          choice(
            seq(choice(token("E"), token("e")), choice(choice(token("+"), token("-")), seq()), token(/[0-9]+/)),
            seq(),
          ),
        ),
      ),
    STRING: ($) => token(seq(token("'"), repeat(choice(token(/[^']/), token("''"))), token("'"))),
    ENUMERATION: ($) => token(seq(token("."), token(/[A-Z][A-Z0-9_]*/), token("."))),
    BLOCK_COMMENT: ($) => token(seq(token("/*"), token(/[^*]*\*+([^/*][^*]*\*+)*/), token("/"))),
  },
});
