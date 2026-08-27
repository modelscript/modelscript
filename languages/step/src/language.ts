// SPDX-License-Identifier: LGPL-3.0-or-later

import { choice, def, field, language, optional, ref, repeat, repeat1, seq, token } from "@modelscript/language";

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
        description: "Maps STEP geometry and assembly hierarchy to Modelica MultiBody or CSG structures.",
        category: "transformation",
        inputSchema: {
          productName: { type: "string", description: "Name of root product", required: true },
        },
      },
    ],
  },

  extras: ($) => [/\s/, $.BLOCK_COMMENT],

  rules: {
    // Top-level structure
    StepFile: ($) =>
      seq(
        field("header", $.HeaderSection),
        repeat(field("dataSection", $.DataSection)),
        optional(field("trailer", $.Trailer)),
      ),

    Trailer: () => "END-ISO-10303-21;",

    // Header Section
    HeaderSection: ($) => seq("ISO-10303-21;", "HEADER;", repeat(field("headerEntity", $.HeaderEntity)), "ENDSEC;"),

    HeaderEntity: ($) =>
      def({
        syntax: seq(field("keyword", $.KEYWORD), "(", field("parameters", $.ParameterList), ")", ";"),
        symbol: (self: Record<string, unknown>) => ({
          kind: "HeaderEntity",
          name: self.keyword as string,
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
        symbol: (self: Record<string, unknown>) => ({
          kind: "DataSection",
          name: (self.scopeName as string) || "DATA",
          exports: [self.scopeName as string],
        }),
      }),

    // Entity Instance
    EntityInstance: ($) =>
      def({
        syntax: seq(field("id", $.ENTITY_INSTANCE_NAME), "=", field("record", $._Record), ";"),
        symbol: (self: Record<string, unknown>) => ({
          kind: "Entity",
          name: self.id as string,
          exports: [self.id as string],
          attributes: {
            entityType: self.record as string,
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
        name: (self: Record<string, unknown>) => self.target as string,
        targetKinds: ["Entity"],
        resolve: "lexical",
      }),

    TypedParameter: ($) => seq(field("keyword", $.KEYWORD), "(", optional(field("parameters", $.ParameterList)), ")"),

    ListValue: ($) => seq("(", optional($.ParameterList), ")"),

    OMITTED_PARAMETER: () => "$",

    DERIVED_PARAMETER: () => "*",

    // Terminals
    ENTITY_INSTANCE_NAME: () => token(seq("#", /[0-9]+/)),

    KEYWORD: () => /[A-Z][A-Z0-9_]*/,

    INTEGER: () => token(seq(optional(choice("+", "-")), /[0-9]+/)),

    REAL: () =>
      token(
        seq(
          optional(choice("+", "-")),
          /[0-9]+/,
          ".",
          optional(/[0-9]+/),
          optional(seq(choice("E", "e"), optional(choice("+", "-")), /[0-9]+/)),
        ),
      ),

    STRING: () => token(seq("'", repeat(choice(/[^']/, "''")), "'")),

    ENUMERATION: () => token(seq(".", /[A-Z][A-Z0-9_]*/, ".")),

    BLOCK_COMMENT: () => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),
  },
});

export default stepLanguage;
