// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gridlabd — Formal DSL Grammar Specification.
 *
 * Declarative GridLAB-D (.glm) grammar defined via @modelscript/dsl combinators,
 * compiled into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";

export const gridlabdGrammar = language({
  name: "GridlabdModel",
  word: ($) => $.Identifier,
  extras: ($) => [/\s+/, $.LineComment, $.BlockComment],
  lsp: {
    folding: ["ClockBlock", "ModuleBlock", "ClassBlock", "ScheduleBlock", "ObjectBlock"],
    outline: ["ClockBlock", "ModuleBlock", "ClassBlock", "ScheduleBlock", "ObjectBlock"],
  },
  rules: {
    GlmFile: ($) => repeat($.TopLevelItem),

    TopLevelItem: ($) =>
      choice($.PreprocessorDirective, $.ClockBlock, $.ModuleBlock, $.ClassBlock, $.ScheduleBlock, $.ObjectBlock),

    PreprocessorDirective: ($) =>
      choice(
        seq(semanticToken("keyword", "#set"), field("name", $.Identifier), "=", field("value", $.DirectiveValue)),
        seq(
          semanticToken("keyword", "#define"),
          field("name", $.Identifier),
          optional(seq("=", field("value", $.DirectiveValue))),
        ),
        seq(semanticToken("keyword", "#include"), field("path", choice($.StringLiteral, $.Identifier))),
      ),

    DirectiveValue: ($) => choice($.StringLiteral, $.ComplexLiteral, $.NumberLiteral, $.Identifier),

    ClockBlock: ($) => seq(semanticToken("keyword", "clock"), "{", repeat($.PropertyAssignment), "}", optional(";")),

    ModuleBlock: ($) =>
      seq(
        semanticToken("keyword", "module"),
        field("name", $.Identifier),
        optional(seq("{", repeat($.PropertyAssignment), "}")),
        optional(";"),
      ),

    ClassBlock: ($) =>
      seq(
        semanticToken("keyword", "class"),
        field("name", $.Identifier),
        "{",
        repeat($.ClassFieldDecl),
        "}",
        optional(";"),
      ),

    ClassFieldDecl: ($) =>
      seq(
        field("fieldType", $.Identifier),
        field("fieldName", $.Identifier),
        optional(seq("[", field("unit", $.Identifier), "]")),
        ";",
      ),

    ScheduleBlock: ($) =>
      seq(
        semanticToken("keyword", "schedule"),
        field("name", $.Identifier),
        "{",
        repeat($.ScheduleEntry),
        "}",
        optional(";"),
      ),

    ScheduleEntry: ($) => seq(repeat(choice($.NumberLiteral, $.Identifier, "*", "-", "/", ",")), ";"),

    ObjectBlock: ($) =>
      seq(
        semanticToken("keyword", "object"),
        field("className", $.Identifier),
        optional(seq(":", field("objectId", choice($.Identifier, $.NumberLiteral)))),
        "{",
        repeat(choice($.PropertyAssignment, $.ObjectBlock)),
        "}",
        optional(";"),
      ),

    PropertyAssignment: ($) => seq(field("key", $.Identifier), field("value", $.PropertyValue), ";"),

    PropertyValue: ($) =>
      seq(
        choice($.StringLiteral, $.ComplexLiteral, $.NumberLiteral, $.Identifier),
        optional(field("unit", $.Identifier)),
      ),

    ComplexLiteral: () => /[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[+-]\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[ij]/,
    NumberLiteral: () => /[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_.:-]*/,

    LineComment: () => /\/\/[^\n]*/,
    BlockComment: () => /\/\*[\s\S]*?\*\//,
  },
});
