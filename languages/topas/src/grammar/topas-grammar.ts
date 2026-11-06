// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/topas — Formal DSL Grammar Specification.
 *
 * Declarative TOPAS & GATE Monte Carlo particle therapy deck grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";

export const topasDeckGrammar = language({
  name: "TopasDeck",
  word: ($) => $.Identifier,
  extras: ($) => [/\s+/, $.CommentLine],
  lsp: {
    folding: ["ParameterAssignment", "GateCommand"],
    outline: ["ParameterAssignment", "IncludeDirective", "GateCommand"],
  },
  rules: {
    Deck: ($) => repeat(choice($.Statement, $.CommentLine)),

    Statement: ($) => choice($.ParameterAssignment, $.VectorAssignment, $.IncludeDirective, $.GateCommand),

    ParameterAssignment: ($) =>
      seq(
        field("typePrefix", $.ScalarPrefix),
        ":",
        field("path", $.ParamPath),
        "=",
        field("value", choice($.NumberLiteral, $.StringLiteral, $.Identifier)),
        optional(field("unit", $.UnitIdentifier)),
      ),

    VectorAssignment: ($) =>
      seq(
        field("typePrefix", $.VectorPrefix),
        ":",
        field("path", $.ParamPath),
        "=",
        field("count", choice($.NumberLiteral, $.Identifier)),
        repeat(field("item", choice($.NumberLiteral, $.StringLiteral, $.Identifier))),
        optional(field("unit", $.UnitIdentifier)),
      ),

    IncludeDirective: ($) =>
      seq(semanticToken("keyword", "includeFile"), "=", field("path", choice($.StringLiteral, $.Identifier))),

    GateCommand: ($) =>
      seq(field("command", $.GatePath), repeat(field("arg", choice($.NumberLiteral, $.StringLiteral, $.Identifier)))),

    ScalarPrefix: () => choice("d", "i", "b", "s", "u"),
    VectorPrefix: () => choice("dv", "iv", "bv", "sv", "uv"),

    ParamPath: () => /[a-zA-Z_][a-zA-Z0-9_/.-]*/,
    GatePath: () => /\/gate\/[a-zA-Z0-9_/.-]*/,
    UnitIdentifier: () => /[a-zA-Zµ][a-zA-Z0-9/]*/,

    CommentLine: () => /([#].*)/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_.]*/,
    NumberLiteral: () => /[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/,
    StringLiteral: () => /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/,
  },
});
