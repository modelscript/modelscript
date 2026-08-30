import { choice, def, field, language, optional, ref, repeat, repeat1, seq } from "@modelscript/language";

export const stepLanguage = language({
  name: "step",

  mcp: {
    serverName: "step-mcp",
    serverVersion: "1.0.0",
    tools: [
      {
        name: "step_extract_entities",
        description: "Extracts CAD product entities and shape representations from a STEP Part 21 file.",
        category: "ast",
        inputSchema: {
          path: { type: "string", description: "Path to .step / .stp file", required: true },
        },
      },
      {
        name: "step_to_multibody",
        description: "Translates STEP geometry entities into Modelica MultiBody kinematic frames.",
        category: "transformation",
        inputSchema: {
          path: { type: "string", description: "Path to .step / .stp file", required: true },
        },
      },
    ],
  },

  extras: ($) => [/\s/, $.BLOCK_COMMENT],

  rules: {
    // Top-level structure
    StepFile: ($) => seq($.HeaderSection, repeat($.DataSection), $.Trailer),

    Trailer: () => "END-ISO-10303-21;",

    // Header Section
    HeaderSection: ($) => seq("ISO-10303-21;", "HEADER;", repeat(field("headerEntity", $.HeaderEntity)), "ENDSEC;"),

    HeaderEntity: ($) =>
      def({
        syntax: seq(field("keyword", $.KEYWORD), "(", field("parameters", $.ParameterList), ")", ";"),
        symbol: (self: Record<string, string>) => ({
          kind: "HeaderEntity",
          name: self.keyword ?? "",
        }),
      }),

    // Data Section
    DataSection: ($) =>
      def({
        syntax: seq(
          "DATA",
          optional(seq("(", field("scopeName", $.STRING), ")")),
          ";",
          repeat(field("entity", $.EntityInstance)),
          "ENDSEC;",
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "DataSection",
          name: self.scopeName || "DATA",
          exports: [self.scopeName ?? ""],
        }),
      }),

    // Entity Instance
    EntityInstance: ($) =>
      def({
        syntax: seq(field("id", $.ENTITY_INSTANCE_NAME), "=", field("record", $._Record), ";"),
        symbol: (self: Record<string, string>) => ({
          kind: "Entity",
          name: self.id ?? "",
          exports: [self.id ?? ""],
          attributes: {
            entityType: self.record ?? "",
          },
        }),
      }),

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

    EntityReference: ($) =>
      ref({
        syntax: field("target", $.ENTITY_INSTANCE_NAME),
        name: (self: Record<string, string>) => self.target ?? "",
        targetKinds: ["Entity"],
        resolve: "lexical",
      }),

    TypedParameter: ($) => seq(field("keyword", $.KEYWORD), "(", optional(field("parameters", $.ParameterList)), ")"),

    ListValue: ($) => seq("(", optional($.ParameterList), ")"),

    OMITTED_PARAMETER: () => "$",

    DERIVED_PARAMETER: () => "*",

    // Terminals
    ENTITY_INSTANCE_NAME: () => /#[0-9]+/,

    KEYWORD: () => /[A-Z][A-Z0-9_]*/,

    INTEGER: () => /[+-]?[0-9]+/,

    REAL: () => /[+-]?[0-9]+\.[0-9]*([eE][+-]?[0-9]+)?/,

    STRING: () => /'([^']|'')*'/,

    ENUMERATION: () => /\.[A-Z][A-Z0-9_]*\./,

    BLOCK_COMMENT: () => /\/\*[^*]*\*+([^/*][^*]*\*+)*\//,
  },
});

export default stepLanguage;
