// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/rocets — Formal DSL Grammar Specification.
 *
 * Declarative NASA ROCETS rocket propulsion deck grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear memory CST.
 */

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";

export const rocetsDeckGrammar = language({
  name: "RocetsDeck",
  word: ($) => $.Identifier,
  extras: ($) => [/\s+/, $.CommentLine],
  lsp: {
    folding: ["SubroutineBlock", "UserCodeBlock"],
    outline: ["SubroutineHeader", "ModuleDef", "LinkDef"],
  },
  rules: {
    Deck: ($) => repeat(choice($.SubroutineBlock, $.UserCodeBlock)),

    SubroutineBlock: ($) =>
      seq(
        $.SubroutineHeader,
        optional($.TitleDirective),
        repeat(choice($.ModuleDef, $.LinkDef, $.ParamDirective)),
        choice("END SUBROUTINE", "END"),
      ),

    SubroutineHeader: ($) => seq("SUBROUTINE", field("name", $.Identifier)),

    TitleDirective: ($) => seq("TITLE", "=", field("title", $.StringLiteral)),

    ModuleDef: ($) =>
      seq(
        field("id", $.Identifier),
        ",",
        field("type", $.Identifier),
        optional(seq(",", optional(field("title", $.StringLiteral)))),
        optional(seq(",", repeat($.ParamAssignment))),
      ),

    LinkDef: ($) =>
      seq(
        field("fromModule", $.Identifier),
        ".",
        field("fromPort", $.Identifier),
        choice("->", "TO"),
        field("toModule", $.Identifier),
        ".",
        field("toPort", $.Identifier),
      ),

    ParamDirective: ($) => seq(field("module", $.Identifier), ":", repeat($.ParamAssignment)),

    ParamAssignment: ($) =>
      seq(
        field("param", $.Identifier),
        "=",
        field("value", choice($.NumberLiteral, $.Identifier, $.StringLiteral)),
        optional(","),
      ),

    UserCodeBlock: ($) =>
      seq(
        "USER_CODE",
        field("name", optional($.Identifier)),
        field("code", repeat(choice($.Identifier, $.NumberLiteral, $.Operator))),
        "END_USER_CODE",
      ),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[-+]?(?:[0-9]*\.[0-9]+|[0-9]+)(?:[eE][-+]?[0-9]+)?/,
    StringLiteral: () => /"[^"\r\n]*"|'[^'\r\n]*'/,
    CommentLine: () => /[*#C!][^\r\n]*/,
    Operator: () => /[=+\-*/()><,:]+/,
  },
});
