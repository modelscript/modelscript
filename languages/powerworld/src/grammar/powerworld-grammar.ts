// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/powerworld — Formal DSL Grammar Specification.
 *
 * Declarative PowerWorld Auxiliary (.aux) grammar defined via @modelscript/dsl combinators,
 * compiled into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, prec, repeat, semanticToken, seq } from "@modelscript/dsl";

export const powerworldGrammar = language({
  name: "PowerWorldAux",
  word: ($) => $.Identifier,
  extras: ($) => [/\s+/, $.LineComment, $.BlockComment],
  lsp: {
    folding: ["DataSection", "ScriptBlock"],
    outline: ["DataSection", "ScriptBlock"],
  },
  conflicts: ($) => [[$.DataRow, $.StringLiteral, $.NumberLiteral, $.Identifier]],
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
        repeat(seq($.DataRow, optional(";"))),
        "}",
      ),

    FieldName: ($) => choice($.Identifier, $.StringLiteral),

    _DataValue: ($) => choice($.StringLiteral, $.NumberLiteral, $.Identifier),

    DataRow: ($) => prec.right(seq($._DataValue, repeat(choice(seq(",", $._DataValue), $._DataValue)))),

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
