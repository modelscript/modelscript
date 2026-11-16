// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/relap5 — Formal DSL Grammar Specification.
 *
 * Declarative RELAP5-3D / TRACE nuclear safety card-deck grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, repeat1, semanticToken, seq } from "@modelscript/dsl";

export const relap5DeckGrammar = language({
  name: "Relap5Deck",
  word: ($) => $.Identifier,
  extras: ($) => [/[ \t\r\n]+/, $.CommentLine],
  lsp: {
    folding: ["VolumeCard", "JunctionCard", "HeatStructureCard", "KineticsCard", "TripCard"],
    outline: ["TitleCard", "VolumeCard", "JunctionCard", "HeatStructureCard", "KineticsCard", "TripCard"],
  },
  rules: {
    Deck: ($) => seq(repeat($.TitleCard), repeat($.Card), optional($.TerminalCard)),

    Card: ($) =>
      choice(
        $.ControlCard,
        $.TimeStepCard,
        $.VolumeCard,
        $.JunctionCard,
        $.HeatStructureCard,
        $.KineticsCard,
        $.TripCard,
        $.GenericCard,
      ),

    GenericCard: ($) => choice(seq(field("cardNumber", $.CardNumber), $.CardWords1), field("cardNumber", $.CardNumber)),

    TitleCard: ($) =>
      choice($.EqualsTitle, seq(semanticToken("keyword", $.TitleCardNum), repeat(field("word", $.TitleWord)))),

    ControlCard: ($) => seq(field("cardNumber", $.ControlCardNum), $.CardWords1),

    TimeStepCard: ($) => seq(field("cardNumber", $.TimeStepCardNum), $.CardWords1),

    VolumeCard: ($) =>
      choice(
        seq(
          field("cardNumber", $.ComponentCardNum),
          field("componentName", $.Identifier),
          field("componentType", $.VolumeType),
          optional($.CardWords1),
        ),
        seq(field("cardNumber", $.ComponentCardNum), field("componentType", $.VolumeType), optional($.CardWords1)),
      ),

    JunctionCard: ($) =>
      choice(
        seq(
          field("cardNumber", $.ComponentCardNum),
          field("componentName", $.Identifier),
          field("componentType", $.JunctionType),
          optional($.CardWords1),
        ),
        seq(field("cardNumber", $.ComponentCardNum), field("componentType", $.JunctionType), optional($.CardWords1)),
      ),

    HeatStructureCard: ($) => seq(field("cardNumber", $.HeatCardNum), $.CardWords1),

    KineticsCard: ($) => seq(field("cardNumber", $.KineticsCardNum), $.CardWords1),

    TripCard: ($) => seq(field("cardNumber", $.TripCardNum), $.CardWords1),

    CardWords1: ($) => repeat1(field("word", $.CardWord)),

    TerminalCard: ($) => choice(seq(".", optional($.EndKw)), "/", $.EndKw),

    TitleWord: ($) =>
      choice($.NumberLiteral, $.Identifier, $.HyphenWord, $.StringLiteral, $.VolumeType, $.JunctionType, ","),

    CardWord: ($) => choice($.TitleWord, $.TitleCardNum),

    EqualsTitle: () => /=[^\r\n]*/,
    TitleCardNum: () => choice("0000100", "100"),
    ControlCardNum: () => choice("0000101", "101", "0000102", "102"),
    TimeStepCardNum: () => choice("0000201", "201", "0000202", "202"),
    VolumeType: () =>
      choice("pipe", "branch", "annulus", "single_volume", "snglvol", "tmdv", "tmdpvol", "pump", "accum", "prizer"),
    JunctionType: () => choice("snglj", "sngljn", "tmdpj", "tmdj", "valve", "mtplj"),
    EndKw: () => choice("end", "END"),
    ComponentCardNum: () => /(?:1[0-9]{2}|20[0-5]|20[7-9]|2[1-9][0-9])0000/,
    HeatCardNum: () => /1[0-9]{3}0000/,
    KineticsCardNum: () => /(?:300|600)0000/,
    TripCardNum: () => /(?:206[0-9]{4}|5[0-9]{6})/,
    CardNumber: () => /[0-9]{6,8}/,

    CommentLine: () => /(?:\*|\$|\/\/)[^\r\n]*/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_.:-]*/,
    HyphenWord: () => /[0-9]+-[a-zA-Z0-9_.:-]+/,
    NumberLiteral: () => /[-+]?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/,
    StringLiteral: () => /"([^"\\\r\n]|\\.)*"|'([^'\\\r\n]|\\.)*'/,
  },
});
