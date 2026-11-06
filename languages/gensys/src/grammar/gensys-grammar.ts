// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gensys — Formal DSL Grammar Specification.
 *
 * Declarative GENSYS rail vehicle dynamics deck grammar defined via @modelscript/dsl language combinators,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";

export const gensysDeckGrammar = language({
  name: "GensysDeck",
  word: ($) => $.Identifier,
  extras: ($) => [/\s+/, $.CommentLine],
  conflicts: ($) => [[$.WheelsetDef], [$.TrackDef]],
  lsp: {
    folding: ["SubsystemDef", "BodyDef", "CouplingDef"],
    outline: ["SubsystemDef", "BodyDef", "WheelsetDef", "CouplingDef", "TrackDef"],
  },
  rules: {
    Deck: ($) => repeat(choice($.Statement, $.CommentLine)),

    Statement: ($) =>
      choice(
        $.ParameterDef,
        $.SubsystemDef,
        $.BodyDef,
        $.WheelsetDef,
        $.BogieDef,
        $.CouplingDef,
        $.TrackDef,
        $.SimulationDef,
      ),

    ParameterDef: ($) =>
      seq(
        optional(semanticToken("keyword", "set")),
        field("name", $.Identifier),
        "=",
        field("value", choice($.NumberLiteral, $.StringLiteral, $.Identifier)),
      ),

    SubsystemDef: ($) =>
      seq(
        semanticToken("keyword", choice("subsystem", "sub_system")),
        field("name", $.Identifier),
        optional(field("file", $.StringLiteral)),
      ),

    BodyDef: ($) =>
      seq(
        semanticToken("keyword", choice("sub_body", "body")),
        field("name", $.Identifier),
        field("mass", choice($.NumberLiteral, $.Identifier)),
        field("jx", choice($.NumberLiteral, $.Identifier)),
        field("jy", choice($.NumberLiteral, $.Identifier)),
        field("jz", choice($.NumberLiteral, $.Identifier)),
        field("x", choice($.NumberLiteral, $.Identifier)),
        field("y", choice($.NumberLiteral, $.Identifier)),
        field("z", choice($.NumberLiteral, $.Identifier)),
      ),

    WheelsetDef: ($) =>
      seq(
        semanticToken("keyword", choice("sub_wheelset", "wheelset")),
        field("name", $.Identifier),
        field("mass", choice($.NumberLiteral, $.Identifier)),
        field("jx", choice($.NumberLiteral, $.Identifier)),
        field("jy", choice($.NumberLiteral, $.Identifier)),
        field("jz", choice($.NumberLiteral, $.Identifier)),
        field("gauge", choice($.NumberLiteral, $.Identifier)),
        field("radius", choice($.NumberLiteral, $.Identifier)),
        optional(field("conicity", choice($.NumberLiteral, $.Identifier))),
        optional(field("profile", choice($.StringLiteral, $.Identifier))),
      ),

    BogieDef: ($) =>
      seq(
        semanticToken("keyword", choice("sub_bogie", "bogie")),
        field("name", $.Identifier),
        field("frameBody", $.Identifier),
        field("wheelset1", $.Identifier),
        field("wheelset2", $.Identifier),
      ),

    CouplingDef: ($) => choice($.SpringCoupling, $.DamperCoupling, $.GenericCoupling),

    SpringCoupling: ($) =>
      seq(
        semanticToken("keyword", choice("spring_k", "spring")),
        field("name", $.Identifier),
        field("body1", $.Identifier),
        field("body2", $.Identifier),
        field("kx", choice($.NumberLiteral, $.Identifier)),
        field("ky", choice($.NumberLiteral, $.Identifier)),
        field("kz", choice($.NumberLiteral, $.Identifier)),
      ),

    DamperCoupling: ($) =>
      seq(
        semanticToken("keyword", choice("damper_c", "damper")),
        field("name", $.Identifier),
        field("body1", $.Identifier),
        field("body2", $.Identifier),
        field("cx", choice($.NumberLiteral, $.Identifier)),
        field("cy", choice($.NumberLiteral, $.Identifier)),
        field("cz", choice($.NumberLiteral, $.Identifier)),
      ),

    GenericCoupling: ($) =>
      seq(
        semanticToken("keyword", choice("coupling", "coupl")),
        field("name", $.Identifier),
        field("type", choice("linear", "nonlinear", "series")),
        field("body1", $.Identifier),
        field("body2", $.Identifier),
      ),

    TrackDef: ($) =>
      seq(
        semanticToken("keyword", "track"),
        field("name", $.Identifier),
        field("gauge", choice($.NumberLiteral, $.Identifier)),
        optional(field("profile", choice($.StringLiteral, $.Identifier))),
      ),

    SimulationDef: ($) =>
      choice(
        seq(semanticToken("keyword", "speed"), field("value", choice($.NumberLiteral, $.Identifier))),
        seq(
          semanticToken("keyword", "run"),
          field("tStart", choice($.NumberLiteral, $.Identifier)),
          field("tStop", choice($.NumberLiteral, $.Identifier)),
          field("dt", choice($.NumberLiteral, $.Identifier)),
        ),
      ),

    CommentLine: () => /([#!%].*)/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_.]*/,
    NumberLiteral: () => /[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/,
    StringLiteral: () => /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/,
  },
});
