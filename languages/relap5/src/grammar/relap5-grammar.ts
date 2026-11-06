// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/relap5 — Formal DSL Grammar Specification.
 *
 * Declarative RELAP5-3D / TRACE nuclear safety card-deck grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";

export const relap5DeckGrammar = language({
  name: "Relap5Deck",
  word: ($) => $.Identifier,
  extras: ($) => [/\s+/, $.CommentLine],
  lsp: {
    folding: ["VolumeCard", "JunctionCard", "HeatStructureCard", "KineticsCard", "TripCard"],
    outline: ["TitleCard", "VolumeCard", "JunctionCard", "HeatStructureCard", "KineticsCard", "TripCard"],
  },
  rules: {
    Deck: ($) => seq(repeat(choice($.Card, $.CommentLine)), optional($.TerminalCard)),

    Card: ($) =>
      choice(
        $.TitleCard,
        $.ControlCard,
        $.TimeStepCard,
        $.VolumeCard,
        $.JunctionCard,
        $.HeatStructureCard,
        $.KineticsCard,
        $.TripCard,
        $.GenericCard,
      ),

    TitleCard: ($) => seq(semanticToken("keyword", choice("0000100", "100")), field("title", $.RestOfLine)),

    ControlCard: () =>
      seq(
        field("cardNumber", choice("0000101", "101", "0000102", "102")),
        field("problemType", choice("transnt", "stdy-st")),
        optional(field("execType", choice("new", "restart"))),
      ),

    TimeStepCard: ($) =>
      seq(
        field("cardNumber", choice("0000201", "201", "0000202", "202")),
        field("endTime", choice($.NumberLiteral, $.Identifier)),
        field("minDt", choice($.NumberLiteral, $.Identifier)),
        field("maxDt", choice($.NumberLiteral, $.Identifier)),
        optional(field("controlFlags", choice($.NumberLiteral, $.Identifier))),
      ),

    VolumeCard: ($) =>
      seq(
        field("cardNumber", $.VolumeCardNum),
        field("componentName", $.Identifier),
        field("componentType", choice("pipe", "branch", "annulus", "single_volume", "tmdv")),
        repeat(field("word", choice($.NumberLiteral, $.Identifier, $.StringLiteral))),
      ),

    JunctionCard: ($) =>
      seq(
        field("cardNumber", $.JunctionCardNum),
        field("componentName", $.Identifier),
        field("componentType", choice("sngljn", "valve", "pump", "tmdj")),
        repeat(field("word", choice($.NumberLiteral, $.Identifier, $.StringLiteral))),
      ),

    HeatStructureCard: ($) =>
      seq(
        field("cardNumber", $.HeatCardNum),
        field("structureName", $.Identifier),
        repeat(field("word", choice($.NumberLiteral, $.Identifier, $.StringLiteral))),
      ),

    KineticsCard: ($) =>
      seq(
        field("cardNumber", $.KineticsCardNum),
        repeat(field("word", choice($.NumberLiteral, $.Identifier, $.StringLiteral))),
      ),

    TripCard: ($) =>
      seq(
        field("cardNumber", $.TripCardNum),
        field("variable", $.Identifier),
        field("operator", choice("ge", "le", "gt", "lt", "eq", "ne")),
        field("setpoint", choice($.NumberLiteral, $.Identifier)),
        optional(field("latch", choice("latch", "nlat"))),
      ),

    GenericCard: ($) =>
      seq(
        field("cardNumber", $.CardNumber),
        repeat(field("word", choice($.NumberLiteral, $.Identifier, $.StringLiteral))),
      ),

    TerminalCard: () => choice("/", ".", "end", "END"),

    VolumeCardNum: () => /[1][0-9]{6}/,
    JunctionCardNum: () => /[2][0-9]{6}/,
    HeatCardNum: () => /[3][0-9]{6}/,
    KineticsCardNum: () => /[4][0-9]{6}/,
    TripCardNum: () => /[5][0-9]{6}/,
    CardNumber: () => /[0-9]{3,7}/,

    CommentLine: () => /([*].*|\/\/.*)/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_.-]*/,
    NumberLiteral: () => /[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/,
    StringLiteral: () => /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/,
    RestOfLine: () => /[^\r\n]+/,
  },
});
