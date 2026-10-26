// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sima — Formal DSL Grammar Specification.
 *
 * Declarative SIMO/RIFLEX card deck grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear memory CST.
 */

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";

export const simaCardGrammar = language({
  name: "SimaCardDeck",
  word: ($) => $.Identifier,
  extras: ($) => [/\s+/, $.CommentLine],
  lsp: {
    folding: ["VesselBlock", "MooringLineBlock"],
    outline: ["SysCard", "BodyCard", "LineCard"],
  },
  rules: {
    Deck: ($) => repeat(choice($.CardRecord, $.VesselBlock, $.MooringLineBlock)),

    VesselBlock: ($) => seq($.BodyCard, repeat(choice($.MassCard, $.DampCard, $.PositionCard))),

    MooringLineBlock: ($) => seq($.LineCard, repeat(choice($.SegmentCard, $.FairleadCard, $.AnchorCard))),

    CardRecord: ($) => choice($.SysCard, $.WaveCard, $.WindCard, $.CurrentCard, $.EnvironmentCard, $.SimuCard),

    SysCard: ($) =>
      seq(choice("SYS", "SYSTEM"), field("name", $.Identifier), optional(field("title", $.StringLiteral))),

    BodyCard: ($) => seq(choice("BODY", "VESSEL"), field("name", $.Identifier), optional(field("type", $.Identifier))),

    MassCard: ($) =>
      seq(
        "MASS",
        field("mass", $.NumberLiteral),
        optional(field("ixx", $.NumberLiteral)),
        optional(field("iyy", $.NumberLiteral)),
        optional(field("izz", $.NumberLiteral)),
      ),

    DampCard: ($) => seq("DAMP", repeat($.NumberLiteral)),

    PositionCard: ($) =>
      seq(
        choice("POS", "POSITION"),
        field("x", $.NumberLiteral),
        field("y", $.NumberLiteral),
        field("z", $.NumberLiteral),
        optional(field("heading", $.NumberLiteral)),
      ),

    LineCard: ($) => seq(choice("LINE", "MOORING"), field("name", $.Identifier), optional(field("type", $.Identifier))),

    SegmentCard: ($) =>
      seq(
        choice("SEGM", "SEGMENT"),
        field("name", $.Identifier),
        field("length", $.NumberLiteral),
        field("diameter", $.NumberLiteral),
        field("mass", $.NumberLiteral),
        optional(field("stiffness", $.NumberLiteral)),
      ),

    FairleadCard: ($) =>
      seq(
        "FAIRLEAD",
        field("x", $.NumberLiteral),
        field("y", $.NumberLiteral),
        field("z", $.NumberLiteral),
        optional(field("vessel", $.Identifier)),
      ),

    AnchorCard: ($) =>
      seq("ANCHOR", field("x", $.NumberLiteral), field("y", $.NumberLiteral), field("z", $.NumberLiteral)),

    WaveCard: ($) =>
      seq(
        "WAVE",
        field("spectrum", choice("JONSWAP", "PIERSON_MOSKOWITZ", "jonswap", "pm")),
        field("hs", $.NumberLiteral),
        field("tp", $.NumberLiteral),
        optional(field("gamma", $.NumberLiteral)),
        optional(field("direction", $.NumberLiteral)),
      ),

    WindCard: ($) => seq("WIND", field("speed", $.NumberLiteral), optional(field("direction", $.NumberLiteral))),

    CurrentCard: ($) =>
      seq(choice("CURR", "CURRENT"), field("speed", $.NumberLiteral), optional(field("direction", $.NumberLiteral))),

    EnvironmentCard: ($) =>
      seq(choice("ENV", "ENVIRONMENT"), field("depth", $.NumberLiteral), optional(field("density", $.NumberLiteral))),

    SimuCard: ($) =>
      seq(
        choice("SIMU", "SIMULATION"),
        field("timeStep", $.NumberLiteral),
        field("duration", $.NumberLiteral),
        optional(field("solver", $.Identifier)),
      ),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[-+]?(?:[0-9]*\.[0-9]+|[0-9]+)(?:[eE][-+]?[0-9]+)?/,
    StringLiteral: () => /"[^"\r\n]*"|'[^'\r\n]*'/,
    CommentLine: () => /[*#!][^\r\n]*/,
  },
});
