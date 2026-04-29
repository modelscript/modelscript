module.exports = grammar({
  name: "step",
  extras: ($) => [/\s/, $.BLOCK_COMMENT],
  rules: {
    StepFile: ($) =>
      seq(
        field("header", $.HeaderSection),
        repeat(field("dataSection", $.DataSection)),
        optional(field("trailer", $.Trailer)),
      ),
    Trailer: ($) => "END-ISO-10303-21;",
    HeaderSection: ($) => seq("ISO-10303-21;", "HEADER;", repeat(field("headerEntity", $.HeaderEntity)), "ENDSEC;"),
    HeaderEntity: ($) => seq(field("keyword", $.KEYWORD), "(", field("parameters", $.ParameterList), ")", ";"),
    DataSection: ($) =>
      seq(
        "DATA",
        optional(seq("(", field("scopeName", $.STRING), ")")),
        ";",
        repeat(field("entity", $.EntityInstance)),
        "ENDSEC;",
      ),
    EntityInstance: ($) => seq(field("id", $.ENTITY_INSTANCE_NAME), "=", field("record", $._Record), ";"),
    _Record: ($) => choice($.SimpleRecord, $.ComplexRecord),
    SimpleRecord: ($) => seq(field("keyword", $.KEYWORD), "(", optional(field("parameters", $.ParameterList)), ")"),
    ComplexRecord: ($) => seq("(", repeat1($.SimpleRecord), ")"),
    ParameterList: ($) => seq($._Parameter, repeat(seq(",", $._Parameter))),
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
    EntityReference: ($) => field("target", $.ENTITY_INSTANCE_NAME),
    TypedParameter: ($) => seq(field("keyword", $.KEYWORD), "(", optional(field("parameters", $.ParameterList)), ")"),
    ListValue: ($) => seq("(", optional($.ParameterList), ")"),
    OMITTED_PARAMETER: ($) => "$",
    DERIVED_PARAMETER: ($) => "*",
    ENTITY_INSTANCE_NAME: ($) => token(seq("#", /[0-9]+/)),
    KEYWORD: ($) => /[A-Z][A-Z0-9_]*/,
    INTEGER: ($) => token(seq(optional(choice("+", "-")), /[0-9]+/)),
    REAL: ($) =>
      token(
        seq(
          optional(choice("+", "-")),
          /[0-9]+/,
          ".",
          optional(/[0-9]+/),
          optional(seq(choice("E", "e"), optional(choice("+", "-")), /[0-9]+/)),
        ),
      ),
    STRING: ($) => token(seq("'", repeat(choice(/[^']/, "''")), "'")),
    ENUMERATION: ($) => token(seq(".", /[A-Z][A-Z0-9_]*/, ".")),
    BLOCK_COMMENT: ($) => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),
  },
});
