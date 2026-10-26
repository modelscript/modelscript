// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/easy5 — Formal DSL Grammar Specification.
 *
 * Declarative EASY5 model deck grammar defined via @modelscript/dsl language combinators,
 * enabling compilation into native WebAssembly GLR parse tables and linear memory CST.
 */

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";

export const easy5DeckGrammar = language({
  name: "Easy5Deck",
  word: ($) => $.Identifier,
  extras: ($) => [/\s+/, $.CommentLine],
  lsp: {
    folding: ["ComponentsSection", "ConnectionsSection", "TablesSection"],
    outline: ["ModelHeader", "ComponentDef", "ConnectionDef"],
  },
  rules: {
    Deck: ($) =>
      seq(
        $.ModelHeader,
        optional($.TitleHeader),
        repeat(choice($.ComponentsSection, $.ConnectionsSection, $.TablesSection)),
      ),

    ModelHeader: ($) => seq("MODEL:", field("name", $.Identifier)),

    TitleHeader: ($) => seq("TITLE:", field("title", $.StringLiteral)),

    ComponentsSection: ($) => seq("COMPONENTS:", repeat($.ComponentDef)),

    ComponentDef: ($) =>
      seq(
        field("id", $.Identifier),
        "TYPE=",
        field("type", $.TypeIdentifier),
        optional(seq("TITLE=", field("title", $.StringLiteral))),
        optional(seq("X=", field("x", $.NumberLiteral))),
        optional(seq("Y=", field("y", $.NumberLiteral))),
        repeat(choice($.ParamBlock, $.StateBlock)),
      ),

    ParamBlock: ($) => seq("XP:", field("bindings", repeat($.ParamBinding))),

    StateBlock: ($) => seq("S0:", field("states", repeat($.ParamBinding))),

    ParamBinding: ($) =>
      seq(
        field("param", $.Identifier),
        "=",
        field("value", choice($.NumberLiteral, $.Identifier, $.StringLiteral)),
        optional(","),
      ),

    ConnectionsSection: ($) => seq("CONNECTIONS:", repeat($.ConnectionDef)),

    ConnectionDef: ($) =>
      seq(
        field("fromComp", $.Identifier),
        ".",
        field("fromPort", $.Identifier),
        choice("->", "TO"),
        field("toComp", $.Identifier),
        ".",
        field("toPort", $.Identifier),
      ),

    TablesSection: ($) => seq("TABLES:", repeat($.TableDef)),

    TableDef: ($) => seq("TABLE", field("id", $.Identifier), repeat($.NumberLiteral), "END TABLE"),

    TypeIdentifier: ($) => seq($.Identifier, optional(seq("/", $.Identifier))),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[-+]?(?:[0-9]*\.[0-9]+|[0-9]+)(?:[eE][-+]?[0-9]+)?/,
    StringLiteral: () => /"[^"\r\n]*"|'[^'\r\n]*'/,
    CommentLine: () => /[*#][^\r\n]*/,
  },
});
