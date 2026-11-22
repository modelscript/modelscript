// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/powerworld — Formal DSL Grammar Specification.
 *
 * Declarative PowerWorld Auxiliary (.aux) grammar defined via @modelscript/dsl combinators,
 * compiled into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";

export const powerworldGrammar = language({
  name: "PowerWorldAux",
  word: ($) => $.Identifier,
  extras: ($) => [/\s+/, $.LineComment, $.BlockComment],
  lsp: {
    folding: ["DataSection", "ScriptBlock"],
    outline: ["DataSection", "ScriptBlock"],
  },
  rules: {
    AuxFile: ($) => repeat(choice($.DataSection, $.ScriptBlock)),

    DataSection: ($) =>
      seq(
        semanticToken("keyword", choice("DATA", "data")),
        "(",
        field("objectType", $.Identifier),
        ",",
        "[",
        optional(seq($.FieldName, repeat(seq(",", $.FieldName)))),
        "]",
        optional(seq(",", $.Identifier, optional(seq(",", $.Identifier)))),
        ")",
        "{",
        repeat($.DataRow),
        "}",
      ),

    FieldName: ($) => choice($.Identifier, $.StringLiteral),

    DataRow: ($) =>
      seq(
        choice($.StringLiteral, $.NumberLiteral, $.Identifier),
        repeat(seq(optional(","), choice($.StringLiteral, $.NumberLiteral, $.Identifier))),
        optional(";"),
      ),

    ScriptBlock: ($) =>
      seq(
        semanticToken("keyword", choice("SCRIPT", "script")),
        optional(field("scriptName", $.Identifier)),
        "{",
        repeat($.ScriptStatement),
        "}",
      ),

    ScriptStatement: ($) =>
      seq(
        field("command", $.Identifier),
        optional(seq("(", optional(seq($.ScriptArg, repeat(seq(",", $.ScriptArg)))), ")")),
        ";",
      ),

    ScriptArg: ($) => choice($.StringLiteral, $.NumberLiteral, $.Identifier),

    NumberLiteral: () => /[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_.:-]*/,

    LineComment: () => /\/\/[^\n]*/,
    BlockComment: () => /\/\*([^*]|\*+[^*/])*\*+\//,
  },
});
